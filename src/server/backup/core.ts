// Tam yedeğin dışa aktarımı: veritabanının bütün tabloları tek tutarlı anlık görüntüden JSON satırları olarak
// (biçim: src/lib/backup/format.ts, docs/YEDEK.md). Panelin indirme rotası (/api/yedek), komut satırı
// (npm run db:backup, geri yükleme öncesi kopya) ve testler kullanır; bu yüzden "server-only" yok
// (src/server/db/index.ts gibi). Geri yükleme ayrı modülde (./restore.ts): rota migration dosyalarını taşımasın.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import type postgres from "postgres";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  encodeLine,
  excludedFor,
  rowLine,
  TABLE_RULES,
  type BackupHeader,
  type BackupMigration,
  type TableRule,
} from "@/lib/backup/format";

export interface BackupOptions {
  /** Panelden yüklenmiş fatura belgeleri de yazılsın */
  documents: boolean;
  createdBy: string;
  app: string;
  now?: Date;
}

export interface BackupSummary {
  tables: Record<string, number>;
  rows: number;
  sha256: string;
  documents: boolean;
  docCount: number;
}

/** Yedeği alan sürüm: Vercel'de commit'in ilk 7 karakteri */
export function appVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "yerel";
}

/** Tanımlayıcı yalnız information_schema'dan gelir; yine de tırnaklanır (içindeki " ikilenir) */
export const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

type Query = postgres.Sql | postgres.ReservedSql | postgres.TransactionSql;

/** public şemasındaki tablolar, alfabe sırasıyla */
export async function publicTables(q: Query): Promise<string[]> {
  const rows = await q.unsafe<{ name: string }[]>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  return rows.map((r) => r.name).sort();
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  serial: boolean;
}

/** Tablonun sütunları (sıra: ordinal_position); hesaplanan (GENERATED) sütunlar yazılmaz, geri yüklenmez */
export async function columnsOf(q: Query, table: string): Promise<ColumnInfo[]> {
  const rows = await q.unsafe<{ name: string; type: string; nullable: string; def: string | null }[]>(
    `SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS def
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => ({ name: r.name, type: r.type, nullable: r.nullable === "YES", serial: Boolean(r.def?.startsWith("nextval(")) }));
}

/** Kaynağın uyguladığı migration'lar (şema sürümü); drizzle şeması yoksa boş */
async function appliedMigrations(q: Query): Promise<BackupMigration[]> {
  const [{ exists }] = await q.unsafe<{ exists: boolean }[]>(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`);
  if (!exists) return [];
  const rows = await q.unsafe<{ hash: string; created_at: string }[]>(`SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`);
  return rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

const INTEGER_TYPES = new Set(["integer", "bigint", "smallint"]);
/** Bir sorguda okunan satır: belgeler (her biri 4 MB'a kadar) için az, ötekiler için çok */
const pageSize = (rule: TableRule | undefined) => (rule?.documents ? 10 : 2000);

/**
 * Tablonun satırları row_to_json metni olarak. Tamsayı `id`'si olan tablolar sayfa sayfa (id > son), ötekiler tek
 * sorguda (küçük tablolar: ayarlar, aylar, eşleştirmeler). row_to_json tek satırdır; düz `json` sütunu satır sonu
 * taşıyabilirdi, o zaman yeniden yazılır (dosyada satır = kayıt).
 */
async function* tableRows(q: Query, table: string, cols: ColumnInfo[], rule: TableRule | undefined): AsyncGenerator<string> {
  const list = cols.map((c) => ident(c.name)).join(", ");
  const where = rule?.where ? ` AND (${rule.where})` : "";
  const flat = (j: string) => (j.includes("\n") ? JSON.stringify(JSON.parse(j)) : j);
  const id = cols.find((c) => c.name === "id" && INTEGER_TYPES.has(c.type));
  if (!id) {
    const rows = await q.unsafe<{ j: string }[]>(`SELECT row_to_json(x)::text AS j FROM (SELECT ${list} FROM public.${ident(table)} WHERE TRUE${where} ORDER BY 1) x`);
    for (const r of rows) yield flat(r.j);
    return;
  }
  const limit = pageSize(rule);
  let last = "-9223372036854775808";
  for (;;) {
    const rows = await q.unsafe<{ k: string; j: string }[]>(
      `SELECT x.id::text AS k, row_to_json(x)::text AS j
         FROM (SELECT ${list} FROM public.${ident(table)} WHERE id > $1::bigint${where} ORDER BY id LIMIT ${limit}) x
        ORDER BY x.id`,
      [last],
    );
    for (const r of rows) yield flat(r.j);
    if (rows.length < limit) return;
    last = rows[rows.length - 1].k;
  }
}

/**
 * Yedeğin satırları (her biri "\n" ile biter), son satırdan sonra özet döner. Bütün tablolar tek bir REPEATABLE READ
 * READ ONLY işlemden okunur: indirme sürerken yapılan değişiklikler dosyayı yarım bırakmaz. Bağlantı ayrılır, okuma
 * bitince ya da okuyan vazgeçince (generator.return, indirme iptal edildi) bırakılır; son satır veritabanı işi
 * bittikten sonra verilir (okuyan son satırda durursa da bağlantı açık kalmaz).
 */
export async function* backupLines(sql: postgres.Sql, opts: BackupOptions): AsyncGenerator<string, BackupSummary, undefined> {
  const conn = await sql.reserve();
  let open = false;
  const hash = createHash("sha256");
  const out = (line: string) => {
    hash.update(line, "utf8");
    return line;
  };
  const counts: Record<string, number> = {};
  let rows = 0;
  try {
    await conn.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const [migrations, tables] = [await appliedMigrations(conn), await publicTables(conn)];
    const header: BackupHeader = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: (opts.now ?? new Date()).toISOString(),
      createdBy: opts.createdBy,
      app: opts.app,
      documents: opts.documents,
      migrations,
      excluded: excludedFor(tables, opts.documents),
    };
    yield out(encodeLine(header));
    const skipped = new Set(header.excluded.tables);
    for (const table of tables) {
      if (skipped.has(table)) continue;
      const rule = TABLE_RULES[table];
      const cols = (await columnsOf(conn, table)).filter((c) => !rule?.dropColumns?.includes(c.name));
      yield out(encodeLine({ table, columns: cols.map((c) => c.name) }));
      let n = 0;
      for await (const j of tableRows(conn, table, cols, rule)) {
        yield out(rowLine(j));
        n++;
      }
      counts[table] = n;
      rows += n;
    }
    await conn.unsafe("COMMIT");
    open = false;
  } finally {
    if (open) await conn.unsafe("ROLLBACK").catch(() => {});
    conn.release();
  }
  const sha256 = hash.digest("hex");
  yield encodeLine({ end: { tables: counts, rows, sha256 } });
  const docCount = Object.entries(counts).reduce((sum, [t, n]) => sum + (TABLE_RULES[t]?.documents ? n : 0), 0);
  return { tables: counts, rows, sha256, documents: opts.documents, docCount };
}

/**
 * Satırları web akışı olarak verir (indirme rotası). ReadableStream.from yerine pull: TypeScript'in dom türlerinde yok,
 * Node'da var; ikisi de aynı işi görür. `first`: rotanın yanıttan önce okuduğu başlık. Satırlar bitince `onEnd` özeti
 * alır. İndirme iptal edilirse generator kapatılır (işlem kapanır, bağlantı havuza döner, backupLines › finally); o
 * sırada okunmakta olan satır sessizce bırakılır: kapanmış akışa yazılamaz, bu bir hata değil (günlüğe "yarıda kaldı"
 * düşmesin).
 */
export function backupStream(
  lines: AsyncGenerator<string, BackupSummary, undefined>,
  first: IteratorResult<string, BackupSummary> | null,
  onEnd: (summary: BackupSummary) => void,
): ReadableStream<string> {
  let pending = first;
  let cancelled = false;
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const r = pending ?? (await lines.next());
        pending = null;
        if (cancelled) return;
        if (r.done) {
          onEnd(r.value);
          controller.close();
        } else {
          controller.enqueue(r.value);
        }
      } catch (e) {
        if (cancelled) return;
        console.error("[yedek] yarıda kaldı", e);
        controller.error(e);
      }
    },
    async cancel() {
      cancelled = true;
      await lines.return(undefined as never).catch(() => {});
    },
  });
}

/**
 * Yedeği gzip'li dosyaya yazar (komut satırı ve geri yükleme öncesi kopya). Var olan dosyanın üzerine yazmaz. Yarıda
 * kalırsa yazdığı dosyayı siler: eksik dosya yedek sanılmasın (son satırı olmadığı için zaten geri yüklenmez).
 */
export async function writeBackupFile(sql: postgres.Sql, path: string, opts: BackupOptions): Promise<BackupSummary & { bytes: number }> {
  let summary: BackupSummary | null = null;
  async function* lines() {
    summary = yield* backupLines(sql, opts);
  }
  const file = createWriteStream(path, { flags: "wx" });
  // Dosya açıldıysa (adı boştaydı) hata durumunda silinecek olan bizimkidir; "wx" var olan dosyada açılmaz
  let created = false;
  file.once("open", () => {
    created = true;
  });
  try {
    await pipeline(Readable.from(lines()), createGzip(), file);
  } catch (e) {
    if (created) await unlink(path).catch(() => {});
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Dosya zaten var, üzerine yazılmadı: ${path}`);
    throw e;
  }
  return { ...summary!, bytes: file.bytesWritten };
}

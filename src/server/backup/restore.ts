// Tam yedeğin geri yüklenmesi (yalnız komut satırından: npm run db:restore; adımlar docs/YEDEK.md). Dosya önce
// baştan sona okunup doğrulanır (özet, son satır, sürüm), sonra tek bir işlemde yüklenir: herhangi bir hata hedefi
// olduğu gibi bırakır. "server-only" yok: komut satırı ve testler kullanır; panel kullanmaz (tek dokunuşla bütün veri
// değişmesin, Vercel 4,5 MB'tan büyük isteği zaten almaz). Dışa aktarımdan ayrı modül: indirme rotası migration
// dosyalarını ve parola özetini taşımasın.

import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";

import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import type postgres from "postgres";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupSchemaPlan,
  END_PREFIX,
  mergeUserRows,
  orderTables,
  ROW_PREFIX,
  USER_CREDENTIAL_COLUMNS,
  type BackupEnd,
  type BackupHeader,
  type SavedCredentials,
  type SchemaPlan,
} from "@/lib/backup/format";
import { hashPassword } from "@/server/auth/password";
import { INVITE_PASSWORD_HASH } from "@/server/auth/tokens";
import { WATCH_SINCE_KEY } from "@/server/jobs/watch";

import { appVersion, columnsOf, ident, publicTables, writeBackupFile, type ColumnInfo } from "./core";

/** Dosya okunamadı ya da doğrulanamadı; komut satırı mesajı olduğu gibi yazar */
export class BackupFileError extends Error {}
/** Geri yükleme yapılmadı (hedef dolu, sürüm uymuyor…); hedef değişmedi */
export class RestoreError extends Error {}

export interface BackupTable {
  columns: string[];
  /** Satırların JSON metni, dosyadaki gibi (sayılar ve tarihler yeniden yazılmaz) */
  rows: string[];
}

export interface ParsedBackup {
  header: BackupHeader;
  tables: Map<string, BackupTable>;
  end: BackupEnd;
}

const broken = (why: string) => new BackupFileError(`Dosya eksik ya da bozuk (indirme yarıda kesilmiş olabilir): ${why}`);

/**
 * Satırları okur ve doğrular: ilk satır başlık (biçim ve sürüm), son satır özet; sha256 ve tablo başına satır sayısı
 * tutmalı. Herhangi biri tutmazsa BackupFileError. Yazıcı boş satır üretmez: yalnız dosyanın sonundaki "\n"den sonraki
 * boş parça kabul edilir.
 */
export async function parseBackupLines(lines: AsyncIterable<string> | Iterable<string>): Promise<ParsedBackup> {
  const hash = createHash("sha256");
  let header: BackupHeader | null = null;
  let end: BackupEnd | null = null;
  let trailing = false;
  const tables = new Map<string, BackupTable>();
  let current: BackupTable | null = null;
  let n = 0;
  for await (const line of lines) {
    n++;
    if (trailing) throw broken(`${n - 1}. satır boş`);
    if (line === "") {
      trailing = true;
      continue;
    }
    if (end) throw broken("son satırdan sonra veri var");
    if (line.startsWith(END_PREFIX)) {
      end = parseJson<{ end: BackupEnd }>(line, n).end;
      continue;
    }
    hash.update(`${line}\n`, "utf8");
    if (!header) {
      const h = parseJson<Partial<BackupHeader>>(line, n);
      if (h.format !== BACKUP_FORMAT) throw new BackupFileError("Bu dosya bir L'Affogato yedeği değil.");
      if (h.version !== BACKUP_VERSION) throw new BackupFileError(`Bu yedek biçimi (sürüm ${h.version}) bu kodla okunamıyor; kodu güncelleyin.`);
      header = h as BackupHeader;
      continue;
    }
    if (line.startsWith(ROW_PREFIX)) {
      if (!current || !line.endsWith("}")) throw broken(`${n}. satır okunamadı`);
      current.rows.push(line.slice(ROW_PREFIX.length, -1));
      continue;
    }
    const t = parseJson<{ table?: unknown; columns?: unknown }>(line, n);
    if (typeof t.table !== "string" || !Array.isArray(t.columns) || tables.has(t.table)) throw broken(`${n}. satır okunamadı`);
    current = { columns: t.columns.map(String), rows: [] };
    tables.set(t.table, current);
  }
  if (!header) throw broken("dosya boş");
  if (!end || typeof end.sha256 !== "string" || !end.tables || typeof end.tables !== "object") throw broken("son satır yok");
  if (hash.digest("hex") !== end.sha256) throw broken("özet tutmuyor");
  for (const [name, t] of tables) {
    if (end.tables[name] !== t.rows.length) throw broken(`${name} tablosunun satır sayısı tutmuyor`);
  }
  if (Object.keys(end.tables).some((name) => !tables.has(name))) throw broken("bir tablo eksik");
  return { header, tables, end };
}

function parseJson<T>(line: string, n: number): T {
  try {
    return JSON.parse(line) as T;
  } catch {
    throw broken(`${n}. satır okunamadı`);
  }
}

/** Akıştaki metni satırlara böler (son satırdaki "\n" sonrası boş parça da verilir) */
async function* splitLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of chunks) {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  yield rest;
}

/** .json.gz dosyasını okuyup doğrular; gzip bozuksa ya da yarıda kesildiyse BackupFileError */
export async function readBackupFile(path: string): Promise<ParsedBackup> {
  const gunzip = createGunzip();
  const file = createReadStream(path);
  file.on("error", (e) => gunzip.destroy(e));
  file.pipe(gunzip);
  gunzip.setEncoding("utf8");
  try {
    return await parseBackupLines(splitLines(gunzip));
  } catch (e) {
    if (e instanceof BackupFileError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new BackupFileError(`Dosya bulunamadı: ${path}`);
    // zlib: "unexpected end of file", "incorrect header check"…
    throw broken(`sıkıştırılmış veri yarıda bitiyor ya da bozuk (${(e as Error).message})`);
  } finally {
    file.destroy();
  }
}

/** Koddaki migration'lar (drizzle'ın kendi okuyucusu) ve günlükteki adları */
export function loadMigrations(folder = "drizzle"): { meta: MigrationMeta; tag: string }[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  return readMigrationFiles({ migrationsFolder: folder }).map((meta, i) => ({ meta, tag: journal.entries[i].tag }));
}

/** Yedeğin şema sürümü bu kodla geri yüklenebilir mi (komut satırı onay sormadan önce de bakar) */
export function planFor(backup: ParsedBackup, folder = "drizzle"): SchemaPlan {
  return backupSchemaPlan(
    backup.header.migrations,
    loadMigrations(folder).map((m) => ({ when: m.meta.folderMillis, tag: m.tag })),
  );
}

type Tx = postgres.Sql | postgres.TransactionSql;

/**
 * drizzle'ın migrate döngüsünün kopyası (drizzle-orm/pg-core/dialect.js › migrate), verilen işlemin içinde ve
 * verilen migration'larla: geri yükleme yedeğin sürümünde durup veriyi yükleyebilsin, sonra kalanları uygulasın,
 * hepsi tek işlemde (bir hata hedefi olduğu gibi bırakır). drizzle'ın migrate'i kendi işlemini açar ve hep sonuna
 * kadar gider.
 */
export async function applyMigrations(tx: Tx, migrations: MigrationMeta[]): Promise<void> {
  await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await tx.unsafe(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
  for (const m of migrations) {
    for (const stmt of m.sql) if (stmt.trim()) await tx.unsafe(stmt);
    await tx.unsafe(`INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2::bigint)`, [m.hash, String(m.folderMillis)]);
  }
}

export interface TargetInfo {
  /** public'teki tablolar ve satır sayıları (çoktan aza) */
  tables: { name: string; rows: number }[];
  drizzle: boolean;
  /** Panelden yüklenmiş belge sayısı (yedekte belge yoksa bunlar silinir) */
  uploads: number;
}

/** Hedef veritabanının durumu: boş mu, neler var */
export async function inspectTarget(sql: Tx): Promise<TargetInfo> {
  const names = await publicTables(sql);
  const tables: TargetInfo["tables"] = [];
  for (const name of names) {
    const [{ n }] = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.${ident(name)}`);
    tables.push({ name, rows: n });
  }
  tables.sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
  const [{ drizzle }] = await sql.unsafe<{ drizzle: boolean }[]>(`SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') AS drizzle`);
  let uploads = 0;
  if (names.includes("invoice_documents")) {
    const [{ n }] = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.invoice_documents WHERE source = 'upload'`).catch(() => [{ n: 0 }]);
    uploads = n;
  }
  return { tables, drizzle, uploads };
}

export const targetIsEmpty = (t: TargetInfo) => !t.tables.length && !t.drizzle;

/** "invoices 111 satır, sales_lines 125 satır, …" */
export function targetSummary(t: TargetInfo): string {
  const top = t.tables.slice(0, 3).map((x) => `${x.name} ${x.rows} satır`);
  return t.tables.length > 3 ? `${top.join(", ")}, …` : top.join(", ") || "drizzle şeması";
}

/** Dolu hedefe --sil olmadan yazılmaz */
export function targetNotEmptyError(t: TargetInfo): RestoreError {
  return new RestoreError(
    `Hedefte tablolar var (${targetSummary(t)}). Boş bir veritabanı verin ya da üzerine yazmak için --sil ekleyin; önce hedefin yedeği alınır.`,
  );
}

export interface RestoreOptions {
  /** --sil: hedefteki bütün tablolar silinip yedekle değiştirilir */
  wipe: boolean;
  /** Hedef doluysa (--sil) değişiklikten önce hedefin yedeği buraya alınır; dolu hedefte zorunlu */
  safetyCopyPath?: string | null;
  /**
   * ADMIN_EMAIL + ADMIN_PASSWORD: o kişi yönetici olur, parolası bu olur (yoksa eklenir). `onlyIfLockedOut`: hedef
   * dolu ve yerel değilse (canlı) yalnız hiçbir yöneticinin parolası korunmadıysa (mergeUserRows › mode)
   */
  admin?: { email: string; password: string; name?: string; onlyIfLockedOut?: boolean } | null;
  migrationsFolder?: string;
  now?: Date;
}

export interface RestoreResult {
  tables: number;
  rows: number;
  fromTag: string;
  toTag: string;
  later: number;
  safetyCopy: string | null;
  /** Hedef boş değildi: oradaki bütün oturumlar kapandı */
  replaced: boolean;
  /** Parolası ADMIN_PASSWORD yapılan yönetici; ortamda verildi ama kullanılmadıysa `adminSkipped` */
  admin: string | null;
  adminCreated: boolean;
  adminSkipped: boolean;
  /** Geri yüklemeden sonra en az bir aktif yönetici parolasıyla girebilir; yoksa komut satırı ne yapılacağını yazar */
  adminLogin: boolean;
  kept: string[];
  invited: string[];
  warnings: string[];
}

/** Hedefteki kişilerin giriş bilgileri (yedekte yok); eski şemada sütun yoksa varsayılanı */
async function savedCredentials(sql: Tx): Promise<{ saved: SavedCredentials[]; maxSv: number }> {
  if (!(await publicTables(sql)).includes("users")) return { saved: [], maxSv: 0 };
  const have = new Set((await columnsOf(sql, "users")).map((c) => c.name));
  const pick = (col: string, fallback: string) => (have.has(col) ? ident(col) : `${fallback} AS ${ident(col)}`);
  const rows = await sql.unsafe<SavedCredentials[]>(
    `SELECT email, password_hash, ${pick("totp_secret", "NULL::text")}, ${pick("totp_enabled", "false")}, ${pick("totp_last_step", "NULL::int")},
            ${pick("recovery_codes", "NULL::jsonb")}, ${pick("session_version", "1")} FROM public.users`,
  );
  return { saved: rows, maxSv: Math.max(0, ...rows.map((r) => Number(r.session_version) || 0)) };
}

/** Hedefteki her şeyi siler (public şeması kalır: yetkileri korunur) */
async function wipeTarget(tx: Tx) {
  const tables = await publicTables(tx);
  if (tables.length) await tx.unsafe(`DROP TABLE ${tables.map((t) => `public.${ident(t)}`).join(", ")} CASCADE`);
  const seqs = await tx.unsafe<{ name: string }[]>(`SELECT sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = 'public'`);
  for (const s of seqs) await tx.unsafe(`DROP SEQUENCE IF EXISTS public.${ident(s.name)} CASCADE`);
  const types = await tx.unsafe<{ name: string }[]>(
    `SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')`,
  );
  for (const t of types) await tx.unsafe(`DROP TYPE IF EXISTS public.${ident(t.name)} CASCADE`);
  await tx.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
}

/** Bir sorguda gönderilen satırlar: en çok 500 ya da ~8 MB (belgeler büyük) */
const BATCH_ROWS = 500;
const BATCH_CHARS = 8 * 1024 * 1024;

/**
 * Satırları json_populate_recordset ile ekler: sütunlar açıkça yazılır (dosyada olmayan sütun varsayılanını alır).
 * Boş olamayan jsonb/json sütununda JSON null, SQL NULL'a dönüşmesin diye yeniden 'null' yapılır.
 */
async function insertRows(tx: Tx, table: string, cols: ColumnInfo[], rows: string[]) {
  const list = cols.map((c) => ident(c.name)).join(", ");
  const exprs = cols
    .map((c) => (!c.nullable && (c.type === "jsonb" || c.type === "json") ? `COALESCE(${ident(c.name)}, 'null'::${c.type})` : ident(c.name)))
    .join(", ");
  const query = `INSERT INTO public.${ident(table)} (${list}) SELECT ${exprs} FROM json_populate_recordset(NULL::public.${ident(table)}, $1::json)`;
  let batch: string[] = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    await tx.unsafe(query, [`[${batch.join(",")}]`]);
    batch = [];
    size = 0;
  };
  for (const r of rows) {
    batch.push(r);
    size += r.length;
    if (batch.length >= BATCH_ROWS || size >= BATCH_CHARS) await flush();
  }
  await flush();
}

/** Sayaçlar en büyük kimliğin ardına (seed.ts'teki gibi, her serial sütun için) */
async function resetSequences(tx: Tx) {
  const cols = await tx.unsafe<{ t: string; c: string }[]>(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`,
  );
  for (const { t, c } of cols) {
    await tx.unsafe(
      `SELECT setval(pg_get_serial_sequence($1, $2), GREATEST(COALESCE(MAX(${ident(c)}), 0), 1), COUNT(*) > 0) FROM public.${ident(t)}`,
      [`public.${ident(t)}`, c],
    );
  }
}

const trTime = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/**
 * Yedeği hedefe yükler. Hedef boş değilse `wipe` gerekir; o zaman önce hedefin yedeği alınır (`safetyCopyPath`), giriş
 * bilgileri okunur, sonra tek işlemde: hedef silinir, şema yedeğin sürümüne kurulur, tablolar yabancı anahtar sırasıyla
 * yüklenir, satır sayıları dosyayla karşılaştırılır, sayaçlar ilerletilir, kalan migration'lar uygulanır. Sayılar
 * tutmazsa ya da herhangi bir adım hata verirse işlem geri alınır, hedef değişmez.
 */
export async function restoreBackup(sql: postgres.Sql, backup: ParsedBackup, opts: RestoreOptions): Promise<RestoreResult> {
  const migrations = loadMigrations(opts.migrationsFolder);
  const plan = backupSchemaPlan(
    backup.header.migrations,
    migrations.map((m) => ({ when: m.meta.folderMillis, tag: m.tag })),
  );
  if (plan.error !== null) throw new RestoreError(plan.error);
  const warnings: string[] = [];
  if (plan.unknown.length) warnings.push(`Yedekte bu kodun günlüğünde olmayan ${plan.unknown.length} migration kaydı var (bir önizleme uygulamış olabilir); yok sayıldı.`);
  if (plan.missing.length) warnings.push(`Yedeğin veritabanında kaydı olmayan migration'lar veriden önce uygulandı: ${plan.missing.join(", ")}.`);

  const target = await inspectTarget(sql);
  const empty = targetIsEmpty(target);
  if (!empty && !opts.wipe) throw targetNotEmptyError(target);
  let safetyCopy: string | null = null;
  if (!empty) {
    // Hedefin bugünkü hâli, hiçbir şey değişmeden önce dosyaya (belgeler dahil): yanlış dosya verildiyse geri dönülür
    if (!opts.safetyCopyPath) throw new RestoreError("Dolu bir hedefin üzerine yazmadan önce yedeği alınmalı (geri yükleme öncesi kopya).");
    await writeBackupFile(sql, opts.safetyCopyPath, { documents: true, createdBy: "geri yükleme öncesi", app: appVersion(), now: opts.now });
    safetyCopy = opts.safetyCopyPath;
  }
  const { saved, maxSv } = empty ? { saved: [], maxSv: 0 } : await savedCredentials(sql);
  const admin =
    opts.admin?.email && opts.admin.password
      ? { email: opts.admin.email, hash: await hashPassword(opts.admin.password), name: opts.admin.name || "Yönetici" }
      : null;
  const mode = !empty && opts.admin?.onlyIfLockedOut ? "lockout" : "always";

  const first = migrations.filter((m) => m.meta.folderMillis <= plan.upTo).map((m) => m.meta);
  const rest = migrations.filter((m) => m.meta.folderMillis > plan.upTo).map((m) => m.meta);
  const result = await sql.begin(async (tx) => {
    if (opts.wipe) await wipeTarget(tx);
    await applyMigrations(tx, first);
    // Hedef boştu (ya da silindi): şimdi tablolarda olan her satırı migration'lar ekledi (ör. 0011'in varsayılan
    // harcama kategorileri). Yedeğin kaynağında da eklenmişlerdi; sonra değiştirilmiş ya da silinmiş olabilirler.
    // Doğrusu dosyadaki: tablolar boşaltılır, veri yalnız dosyadan gelir
    const present = new Set(await publicTables(tx));
    if (present.size) await tx.unsafe(`TRUNCATE ${[...present].map((t) => `public.${ident(t)}`).join(", ")} RESTART IDENTITY CASCADE`);

    const names = [...backup.tables.keys()].filter((t) => {
      if (present.has(t)) return true;
      warnings.push(`${t} tablosu bu sürümde yok; atlandı.`);
      return false;
    });
    const edges = await tx.unsafe<{ child: string; parent: string }[]>(
      `SELECT ch.relname AS child, pa.relname AS parent
         FROM pg_constraint c
         JOIN pg_class ch ON ch.oid = c.conrelid
         JOIN pg_class pa ON pa.oid = c.confrelid
         JOIN pg_namespace n ON n.oid = ch.relnamespace
        WHERE c.contype = 'f' AND n.nspname = 'public'`,
    );

    let users: ReturnType<typeof mergeUserRows> | null = null;
    let rows = 0;
    for (const table of orderTables(names, edges)) {
      const data = backup.tables.get(table)!;
      const targetCols = await columnsOf(tx, table);
      const byName = new Map(targetCols.map((c) => [c.name, c]));
      const missingCols = data.columns.filter((c) => !byName.has(c));
      if (missingCols.length) warnings.push(`${table}: bu sürümde olmayan sütunlar atlandı (${missingCols.join(", ")}).`);
      let cols = data.columns.filter((c) => byName.has(c)).map((c) => byName.get(c)!);
      let lines = data.rows;
      if (table === "users") {
        users = mergeUserRows(lines.map((l) => JSON.parse(l) as Record<string, unknown>), saved, { inviteHash: INVITE_PASSWORD_HASH, maxSv, admin, mode });
        // Giriş bilgileri dosyada yok: hedeften korunan ya da davet değerleri ayrıca yazılır (rol ve aktiflik zaten listede)
        const extra = USER_CREDENTIAL_COLUMNS.filter((c) => byName.has(c) && !data.columns.includes(c)).map((c) => byName.get(c)!);
        cols = [...cols, ...extra];
        lines = users.rows.map((r) => JSON.stringify(r));
      }
      await insertRows(tx, table, cols, lines);
      rows += lines.length;
    }

    // Dosyadaki sayılarla karşılaştır: tutmazsa hepsi geri alınır
    for (const table of names) {
      const [{ n }] = await tx.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.${ident(table)}`);
      if (n !== backup.end.tables[table]) {
        throw new RestoreError(`${table} tablosuna ${n} satır yüklendi, dosyada ${backup.end.tables[table]} var; geri yükleme geri alındı, hedef değişmedi.`);
      }
    }
    await resetSequences(tx);

    let adminCreated = false;
    const u = users as ReturnType<typeof mergeUserRows> | null;
    const newAdmin = u ? u.newAdmin : admin ? mergeUserRows([], [], { inviteHash: INVITE_PASSWORD_HASH, maxSv, admin }).newAdmin : null;
    if (newAdmin) {
      // ADMIN_EMAIL yedekte yok (ya da yedekte hiç kullanıcı yok): yönetici eklenir (kimliği sayaçtan)
      const have = new Set((await columnsOf(tx, "users")).map((c) => c.name));
      const keys = Object.keys(newAdmin).filter((k) => have.has(k));
      await tx.unsafe(
        `INSERT INTO public.users (${keys.map(ident).join(", ")}) SELECT ${keys.map(ident).join(", ")} FROM json_populate_record(NULL::public.users, $1::json)`,
        [JSON.stringify(newAdmin)],
      );
      adminCreated = true;
    }

    await applyMigrations(tx, rest);
    // Günlük işlerin izlenmesi geri yükleme anından yeniden başlar (src/server/jobs/watch.ts): dosyadaki çalışma
    // kayıtları yedeğin gününde kaldı, bugünün işi çalıştıysa kaydı da silindi; yoksa canlıda "Sabah işi çalışmadı"
    // yanlış alarmı çıkardı. İşler gerçekten çalışmıyorsa ertesi sabahın penceresinden sonra yine söylenir
    await tx.unsafe(
      `INSERT INTO public.integration_state (key, value) VALUES ($1, to_jsonb($2::text))
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [WATCH_SINCE_KEY, new Date().toISOString()],
    );
    const h = backup.header;
    await tx.unsafe(`INSERT INTO public.activity_log (user_name, action, detail) VALUES ('Sistem', 'Yedekten geri yüklendi', $1)`, [
      `${trTime(h.createdAt)} yedeği · ${h.createdBy} · ${new Intl.NumberFormat("tr-TR").format(rows)} satır`.slice(0, 500),
    ]);
    const adminUsed = u ? u.admin : newAdmin ? (admin?.email.trim().toLowerCase() ?? null) : null;
    const adminLogin = adminCreated || Boolean(u?.rows.some((r) => r.role === "admin" && r.active !== false && r.password_hash !== INVITE_PASSWORD_HASH));
    return {
      tables: names.length,
      rows,
      admin: adminUsed,
      adminCreated,
      adminSkipped: Boolean(admin) && !adminUsed,
      adminLogin,
      kept: u?.kept ?? [],
      invited: u?.invited ?? [],
    };
  });
  return { ...result, fromTag: plan.fromTag, toTag: plan.toTag, later: plan.later, safetyCopy, replaced: !empty, warnings };
}

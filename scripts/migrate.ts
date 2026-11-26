// Veritabanı şemasını günceller (drizzle/ klasöründeki SQL migration'ları uygular) ve hepsinin gerçekten
// uygulandığını doğrular (scripts/migration-check.ts): atlanan varsa hata verir, canlı derleme durur.
// Kullanım: npm run db:migrate  (başka bir veritabanına: DATABASE_URL=postgres://… npm run db:migrate)
//
// Hedef db:backup ve db:restore'daki gibi bulunur (src/lib/backup/format.ts › databaseUrl): kabukta verilen adres
// .env.local'dakinden önce gelir (yoksa .env.local'daki canlının havuzsuz adresi öne geçer, dalın migration'ı canlıya
// giderdi; denetim AL-02), boş değer verilmemiş sayılır (AL-03). Hedef "sunucu/veritabanı" olarak yazılır.
//
// Aynı anda tek migration (26 Kasım 2026). İki canlı derleme üst üste bindi: #151'in derlemesi 0087–0092'yi tek
// işlemde uygularken (11:27:34–11:45:58 UTC) #152'ninki 11:43'te başladı, drizzle.__drizzle_migrations'ı ilk işlem
// commit olmadan okudu, 0087'yi bekliyor sandı; ALTER TABLE ilk işlemin tablo kilidini bekledi, kilit kalkınca sütun
// vardı: `column "company_wide" of relation "invoices" already exists` (42701), derleme düştü. Artık:
// - Migration tek bir bağlantıda bir danışma kilidi (MIGRATION_LOCK) altında çalışır. İkinci derleme kilidi bekler,
//   kilidi aldıktan SONRA uygulanmış migration'ları okur: öteki bitirdiyse uygulanacak bir şey kalmaz, "güncel" der.
//   Kilit oturum kilididir, işlem kilidi (pg_advisory_xact_lock) olamaz: drizzle son kaydı kendi işlemini açmadan
//   önce okur (drizzle-orm/pg-core/dialect.js › migrate) ve işlemine dışarıdan sorgu eklenemez. Oturum kilidi ancak
//   kilit, okuma ve işlem aynı sunucu oturumunda olursa korur: bağlantı tektir (max 1), boşta ya da ömrü dolunca
//   kapanmaz, kopan sorguyu yeni bağlantıda yeniden göndermez (createDb'nin yeniden denemesi yok) ve havuzlu adrese
//   (Neon "-pooler", PgBouncer işlem kipi: sorgular farklı sunucu oturumlarına gider) hiç gidilmez (poolerRefusal).
// - Her tablo kilidi en çok MIGRATION_LIMITS.lockTimeoutMs beklenir (lock_timeout). ALTER TABLE tabloyu tutan her açık
//   işlemi bekler ve beklerken canlı uygulamanın o tabloya her sorgusu onun arkasında sıraya girer: #151'in 18 dakikası
//   büyük olasılıkla buydu. Süre dolunca işlem geri alınır (hiçbir şey değişmez), kısa bir aradan sonra yeniden denenir;
//   denemeler bitince derleme, kilidi tutuyor olabilecek açık işlemleri yazarak durur (yayındaki sürüm değişmez).
// Belge: docs/DEPLOY.md § 7 › Aynı anda iki canlı derleme. Test: tests/migration-kilidi-db.test.ts.

import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { databaseTarget, databaseUrl } from "../src/lib/backup/format";
import { sslOption, type DB } from "../src/server/db";
import * as schema from "../src/server/db/schema";

import { migrationReport, readJournal } from "./migration-check";

/**
 * Migration kilidinin anahtarı (pg_advisory_lock, tek bigint). int4 aralığının dışında: uygulamanın tek sayılı danışma
 * kilitleri (hashtext(...) ve Paraşüt'ün 7_340_21x'leri) int4'tür, buna denk gelemez.
 */
export const MIGRATION_LOCK = 7_340_299_001;
/** Migration bağlantısının adı (pg_stat_activity.application_name): bekleyen derleme kilidi kimin tuttuğunu yazar */
export const MIGRATION_APP = "laffogato-migrate";

export interface MigrationLimits {
  /** Başka bir migration'ın (öteki derlemenin) bitmesi en çok bu kadar beklenir, ms */
  waitForOtherMs: number;
  /** Her tablo kilidinin bekleme sınırı (lock_timeout), ms */
  lockTimeoutMs: number;
  /** Tablo kilidi alınamazsa migration toplam kaç kez denenir */
  attempts: number;
  /** Denemeler arası bekleme, ms */
  retryPauseMs: number;
}

/**
 * Vercel'in derleme sınırı 45 dakika. En kötü durumda öteki derlemenin migration'ı 10 dakika beklenir, sonra dört
 * deneme ve araları birkaç dakika sürer; derlemenin kendisi ~3 dakika. Tablo kilidinin 15 saniyelik sınırı canlı
 * uygulamanın o tabloda en çok bu kadar beklemesi demektir; panelin işlevleri 60 saniyede kesilir (maxDuration), olağan
 * bir işlem birkaç denemenin birinde biter.
 */
export const MIGRATION_LIMITS: MigrationLimits = { waitForOtherMs: 10 * 60_000, lockTimeoutMs: 15_000, attempts: 4, retryPauseMs: 15_000 };

export interface MigrateOptions extends Partial<MigrationLimits> {
  /** Migration klasörü (testler kendi küçük klasörünü verir) */
  folder?: string;
}

export interface MigrateResult {
  /** Bu çalıştırmanın uyguladığı migration sayısı (öteki derleme uyguladıysa 0) */
  applied: number;
  /** Öteki migration'ın bitmesi için beklenen süre, ms (beklenmediyse 0) */
  waitedMs: number;
}

/** Postgres'in kodları: kilit beklemesi süreyi aştı (lock_timeout), kilitlenme (deadlock) */
const LOCK_NOT_AVAILABLE = "55P03";
const DEADLOCK = "40P01";

/** `url`: hedef; verilmezse ortamdan (komut satırı ve derleme kabuktakini öne alarak verir) */
export async function runMigrations(url = databaseUrl(process.env), options: MigrateOptions = {}): Promise<MigrateResult> {
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const target = databaseTarget(url);
  console.log(`Hedef: ${target.label}${target.local ? " (bu bilgisayar)" : ""}`);
  const refusal = poolerRefusal(url);
  if (refusal) throw new Error(refusal);
  const { folder = "drizzle", ...given } = options;
  const limits: MigrationLimits = { ...MIGRATION_LIMITS, ...given };
  const db = migrationDb(url);
  try {
    const waitedMs = await takeMigrationLock(db, limits.waitForOtherMs);
    await db.execute(sql.raw(`set lock_timeout = ${Math.max(1, Math.round(limits.lockTimeoutMs))}`));
    const applied = await applyMigrations(db, limits, folder);
    await verifyMigrations(db, folder);
    const [lock] = await db.execute<{ released: boolean }>(sql`select pg_advisory_unlock(${sql.raw(String(MIGRATION_LOCK))}) as released`);
    if (!lock?.released) console.warn("! Migration kilidi bırakılırken bulunamadı (bağlantı yenilenmiş olabilir); migration'lar yine de doğrulandı.");
    return { applied, waitedMs };
  } finally {
    // Hata olsa da bağlantı kapanır: sunucu oturum kilidini kendisi bırakır
    await db.$client.end();
  }
}

/**
 * Migration'ın tek bağlantısı: kilit, drizzle'ın okuması ve işlemi aynı sunucu oturumunda. createDb'den farkları
 * bilerek: boşta (idle_timeout) ya da ömrü dolunca (max_lifetime) kapanmaz, bağlantı hatasında sorguyu yeni bağlantıda
 * yeniden göndermez (src/server/db/retry.ts): yeni bağlantıda kilit olmazdı. Kopan bağlantı migration'ı düşürür.
 */
function migrationDb(url: string): DB {
  const client = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 0,
    max_lifetime: 0,
    connect_timeout: 10,
    ssl: sslOption(url),
    connection: { application_name: MIGRATION_APP },
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

/**
 * Havuzlu (PgBouncer, işlem kipi) adreste oturum kilidi tutulmaz: kilidi alan sorgu bir sunucu oturumuna, sonraki
 * sorgular başkalarına gider; kilit o oturumda asılı kalır, sonraki derlemeler onu bekler. Neon'un havuzlu sunucu adı
 * "-pooler" taşır. Derlemede migration DATABASE_URL_UNPOOLED'la yapılır (databaseUrl); bu ret yalnız o yoksa çıkar.
 */
export function poolerRefusal(url: string): string | null {
  const { host } = databaseTarget(url);
  if (!/-pooler\./i.test(host)) return null;
  return `Migration havuzlu adrese gidiyor (${host}): PgBouncer'dan geçen bağlantıda migration kilidi tutulmaz, aynı anda iki derleme aynı migration'ı uygulayabilir. Havuzsuz adresi DATABASE_URL_UNPOOLED olarak verin (Neon'da adın "-pooler"sız hâli). Şemaya dokunulmadı.`;
}

/** Kilit alınır; başka bir migration tutuyorsa en çok `waitMs` beklenir. Dönen: beklenen süre (ms) */
async function takeMigrationLock(db: DB, waitMs: number): Promise<number> {
  const [first] = await db.execute<{ ok: boolean }>(sql`select pg_try_advisory_lock(${sql.raw(String(MIGRATION_LOCK))}) as ok`);
  if (first?.ok) return 0;
  const holder = await lockHolder(db);
  console.log(`… Başka bir migration sürüyor (${holder}); bitmesi bekleniyor, en çok ${duration(waitMs)}`);
  const started = Date.now();
  await db.execute(sql.raw(`set lock_timeout = ${Math.max(1, Math.round(waitMs))}`));
  try {
    await db.execute(sql`select pg_advisory_lock(${sql.raw(String(MIGRATION_LOCK))})`);
  } catch (e) {
    if (errorCode(e) !== LOCK_NOT_AVAILABLE) throw e;
    throw new Error(lockWaitMessage(waitMs, await lockHolder(db)));
  }
  const waited = Date.now() - started;
  console.log(`✓ Öteki migration bitti, kilit alındı (${duration(waited)} beklendi)`);
  return waited;
}

/** Kilidi tutan oturum: "pid 123 · laffogato-migrate · 4 dk önce bağlandı" */
async function lockHolder(db: DB): Promise<string> {
  try {
    const rows = await db.execute<{ pid: number; app: string; ms: number }>(sql`
      select a.pid, coalesce(nullif(a.application_name, ''), '?') as app,
             (extract(epoch from now() - a.backend_start) * 1000)::bigint as ms
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.granted and l.objsubid = 1
        and l.database = (select oid from pg_database where datname = current_database())
        and l.classid::bigint * 4294967296 + l.objid::bigint = ${sql.raw(String(MIGRATION_LOCK))}`);
    const h = rows[0];
    return h ? `pid ${h.pid} · ${h.app} · ${duration(Number(h.ms))} önce bağlandı` : "tutan oturum görünmüyor";
  } catch {
    return "tutan oturum okunamadı";
  }
}

/** Öteki migration bitmedi: derleme durur (yayındaki sürüm ve şema değişmez) */
export function lockWaitMessage(waitMs: number, holder: string): string {
  return `Migration kilidi ${duration(waitMs)} içinde alınamadı: başka bir migration hâlâ sürüyor (${holder}). Şemaya dokunulmadı, yayındaki sürüm değişmedi. Öteki derleme bitince yeniden dağıtın; kilidi tutan oturum takılı kaldıysa: select pg_terminate_backend(<pid>). Ayrıntı: docs/DEPLOY.md § 7.`;
}

/**
 * drizzle'ın migrate'i; tablo kilidi süresinde alınamazsa (ya da kilitlenme) işlem geri alınmıştır, biraz sonra
 * yeniden denenir. Dönen: uygulanan migration sayısı.
 */
async function applyMigrations(db: DB, limits: MigrationLimits, folder: string): Promise<number> {
  const before = await recordedCount(db);
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(db, { migrationsFolder: folder });
      break;
    } catch (e) {
      const code = errorCode(e);
      if (code !== LOCK_NOT_AVAILABLE && code !== DEADLOCK) throw e;
      const blockers = await openTransactions(db, limits.lockTimeoutMs);
      if (attempt >= limits.attempts) throw new Error(tableLockMessage(limits, failedStatement(e), blockers), { cause: e });
      const why = code === DEADLOCK ? "kilitlenme (deadlock)" : `tablo kilidi ${duration(limits.lockTimeoutMs)} içinde alınamadı`;
      console.warn(
        `! Migration denemesi ${attempt}/${limits.attempts}: ${why} (${failedStatement(e)}). İşlem geri alındı, hiçbir şey değişmedi; ${duration(limits.retryPauseMs)} sonra yeniden denenecek.${blockerLines(blockers)}`,
      );
      await new Promise((r) => setTimeout(r, limits.retryPauseMs));
    }
  }
  const applied = (await recordedCount(db)) - before;
  if (applied > 0) console.log(`✓ ${applied} migration uygulandı (${duration(Date.now() - started)})`);
  return applied;
}

/** drizzle.__drizzle_migrations'taki kayıt sayısı (tablo yoksa 0) */
async function recordedCount(db: DB): Promise<number> {
  const [t] = await db.execute<{ exists: boolean }>(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`);
  if (!t?.exists) return 0;
  const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return Number(r?.n ?? 0);
}

// Tür takma adı (interface değil): drizzle'ın execute<T> sınırı Record<string, unknown> ister
export type OpenTransaction = {
  pid: number;
  state: string;
  app: string;
  /** İşlemin ne kadardır açık olduğu */
  ms: number;
  tables: string | null;
  query: string;
};

/**
 * Kilidi tutuyor olabilecek işlemler: bekleme sınırından uzun süredir açık olanlar (migration'ı bekleten işlem en az
 * o kadar açıktı). Tuttukları tablolar ve son sorgularıyla; okunamazsa boş.
 */
async function openTransactions(db: DB, olderThanMs: number): Promise<OpenTransaction[]> {
  try {
    const rows = await db.execute<OpenTransaction>(sql`
      select a.pid, coalesce(a.state, '?') as state, coalesce(nullif(a.application_name, ''), '?') as app,
             (extract(epoch from now() - a.xact_start) * 1000)::bigint as ms,
             (select string_agg(distinct c.relname::text, ', ' order by c.relname::text)
                from pg_locks l join pg_class c on c.oid = l.relation
               where l.pid = a.pid and l.granted and c.relkind in ('r', 'p')) as tables,
             left(regexp_replace(coalesce(a.query, ''), '[[:space:]]+', ' ', 'g'), 100) as query
      from pg_stat_activity a
      where a.datname = current_database() and a.pid <> pg_backend_pid() and a.backend_type = 'client backend'
        and a.xact_start < now() - make_interval(secs => ${olderThanMs / 1000})
      order by a.xact_start
      limit 5`);
    return [...rows];
  } catch {
    return [];
  }
}

const blockerLines = (list: OpenTransaction[]) =>
  list.length
    ? `\nUzun süredir açık işlemler:${list
        .map((b) => `\n  pid ${b.pid} · ${b.state} · açık: ${duration(Number(b.ms))} · ${b.app} · tablolar: ${b.tables ?? "-"} · son sorgu: ${b.query || "-"}`)
        .join("")}`
    : "";

/** Denemeler bitti: derleme durur, kilidi tutuyor olabilecek işlemler yazılır */
export function tableLockMessage(limits: MigrationLimits, statement: string, blockers: OpenTransaction[]): string {
  return (
    `Migration ${limits.attempts} denemede de tablo kilidini alamadı (her bekleyiş en çok ${duration(limits.lockTimeoutMs)}; takılan: ${statement}). ` +
    `Tabloyu açık bir işlem (büyük olasılıkla canlı uygulamanın) tutuyor. Şemaya dokunulmadı (işlem geri alındı), yayındaki sürüm değişmedi. ` +
    `Açık işlem bitince yeniden dağıtın; "idle in transaction" bir oturum takılı kaldıysa: select pg_terminate_backend(<pid>). Ayrıntı: docs/DEPLOY.md § 7.` +
    blockerLines(blockers)
  );
}

/** drizzle'ın düşen sorgusunun ilk satırı (DrizzleQueryError.query) */
function failedStatement(e: unknown): string {
  const q = (e as { query?: unknown })?.query;
  if (typeof q !== "string") return "?";
  const line = q.trim().split("\n")[0].replace(/\s+/g, " ");
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

/** Postgres hata kodu (drizzle'ın sardığı hatada `cause`'ta) */
function errorCode(e: unknown): string | null {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 3; cur = (cur as { cause?: unknown }).cause, depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/** "0,2 sn", "15 sn", "10 dk", "18 dk 24 sn" */
export function duration(ms: number): string {
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toLocaleString("tr-TR")} sn`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} sn`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec ? `${min} dk ${sec} sn` : `${min} dk`;
}

/** Günlükteki her migration'ın veritabanında kaydı var mı: eksik varsa hata, günlükte olmayan kayıt uyarı */
export async function verifyMigrations(db: DB, folder = "drizzle") {
  const rows = await db.execute<{ created_at: string | number }>(sql`select created_at from drizzle.__drizzle_migrations`);
  const report = migrationReport(readJournal(folder), rows.map((r) => Number(r.created_at)));
  if (report.warning) console.warn(report.warning);
  if (report.error) throw new Error(report.error);
  console.log(report.ok);
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  // Komut satırında verilen hedef .env.local'dakinden önce gelir
  const shell = { ...process.env };
  loadEnvConfig(process.cwd());
  runMigrations(databaseUrl(shell, process.env)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

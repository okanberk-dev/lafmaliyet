// Hata kaydının veritabanı tarafı (docs/HATA-KAYDI.md; kurallar src/lib/error-log.ts). Yazma, okuma, "Çözüldü" ve saklama
// süresi. "server-only" yok: Next'in hata kancası (src/instrumentation.ts) ve canlı derleme betiği de kullanır
// (src/server/jobs/watch.ts gibi).
//
// Kayıt hiçbir zaman isteği bozmaz ya da bekletmez: `reportError` beklenmez (işlev açık kalsın diye Next'in isteğe bağlı
// waitUntil'ine verilir), en çok WRITE_TIMEOUT_MS sürer, kendi hatasını yutar (yalnız günlüğe bir satır). Kritik
// hatanın e-postası ayrıca en çok ALERT_TIMEOUT_MS açık tutulur. Kayıt kendini kaydetmez: yazma hatası yalnız
// console.error'a gider (hata kancası çağrılmaz). Bağlantı düşünce o kaynağın kapısı bir dakika kapanır; satırın
// kendisi yazılamıyorsa (veri hatası) kapı açık kalır, öteki hatalar yazılmaya devam eder.

import { createHash } from "node:crypto";

import { and, count, desc, eq, gte, inArray, isNull, lt, notLike, sql } from "drizzle-orm";

import {
  ALERT_TIMEOUT_MS,
  DAILY_NEW_CAP,
  DIGEST_KEEP,
  ERROR_SOURCES,
  fingerprintBasis,
  GATE_PER_MINUTE,
  isCritical,
  isOverflowFingerprint,
  LIST_LIMIT,
  MAX_ROWS,
  overflowFingerprint,
  overflowMessage,
  RETENTION_DAYS,
  sanitizeEntry,
  splitDigests,
  trDay,
  trDayStart,
  WRITE_TIMEOUT_MS,
  createWriteGate,
  type CleanEntry,
  type ErrorEntry,
  type ErrorRow,
  type ErrorSource,
  type WriteGate,
} from "@/lib/error-log";
import { capped } from "@/server/jobs/capped";
import { getDb, type DB } from "@/server/db";
import * as s from "@/server/db/schema";

/** Kaydın başladığı an (CSP kararı: "en az 7 gündür kayıt var mı"); canlı derleme ve sabah işi yalnız yoksa yazar */
export const ERRORS_SINCE_KEY = "errors.since";

export type RecordOutcome = "inserted" | "updated" | "capped" | "throttled" | "skipped" | "error" | "timeout";

/** Sunucu örneğinin kapıları, kaynak başına (src/lib/error-log.ts createWriteGate, GATE_PER_MINUTE) */
const globalGates = globalThis as unknown as { __lafErrorGates?: Record<ErrorSource, WriteGate> };
const makeGates = () => Object.fromEntries(ERROR_SOURCES.map((source) => [source, createWriteGate({ perMinute: GATE_PER_MINUTE[source] })])) as Record<ErrorSource, WriteGate>;
const sharedGate = (source: ErrorSource) => (globalGates.__lafErrorGates ??= makeGates())[source];

/** Testler için: sunucu örneğinin kapılarını siler */
export function resetErrorGates() {
  delete globalGates.__lafErrorGates;
}

/**
 * Satırın kendisi yazılamıyor mu (Postgres veri hatası 22xxx, kısıt 23xxx; drizzle'ın sarmaladığı nedende de): bu
 * durumda kapı kapanmaz. Kapanırsa tek bir bozuk girdi (oturumsuz bir CSP raporu) o kaynağın bütün hatalarını bir
 * dakika kayıttan düşürürdü.
 */
function isRowError(err: unknown): boolean {
  let c: unknown = err;
  for (let i = 0; i < 3 && c && typeof c === "object"; i++) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === "string" && /^2[23][0-9A-Z]{3}$/.test(code)) return true;
    c = (c as { cause?: unknown }).cause;
  }
  return false;
}

/** Hata kodları sütunu: yeni kod öne, aynısı bir kez, en çok DIGEST_KEEP (boşlukla ayrılmış; kod boşluk içermez) */
const digestsSql = (column: typeof s.errorLog.digest, digest: string) =>
  sql`array_to_string((array_prepend(${digest}::text, array_remove(string_to_array(coalesce(${column}, ''), ' '), ${digest}::text)))[1:${sql.raw(String(DIGEST_KEEP))}], ' ')`;

/** Satırın özeti: kaynak, ad, sayıları atılmış ileti ve yol kalıbının sha256'sı */
export function fingerprint(e: CleanEntry): string {
  return createHash("sha256").update(fingerprintBasis(e)).digest("hex").slice(0, 40);
}

/**
 * Hatayı yazar: aynı özet varsa sayısı artar, son görülüşü, son iletisi ve yolu yazılır, hata kodu son kodlara eklenir,
 * "Çözüldü" kalkar; yoksa kaynağın bugünkü yeni satır sınırına bakılır (DAILY_NEW_CAP), aşıldıysa yalnız günün "sınır
 * doldu" satırı sayılır.
 */
export async function writeError(db: DB, e: CleanEntry, fp: string, increment: number, now: Date): Promise<"inserted" | "updated" | "capped"> {
  const t = s.errorLog;
  const set = {
    count: sql`${t.count} + ${increment}`,
    lastSeen: now,
    resolvedAt: null,
    message: e.message,
    path: e.path,
    detail: e.detail,
    ...(e.digest ? { digest: digestsSql(t.digest, e.digest) } : {}),
    ...(e.stack ? { stack: e.stack } : {}),
  };
  const updated = await db.update(t).set(set).where(eq(t.fingerprint, fp)).returning({ id: t.id });
  if (updated.length) return "updated";
  const [{ n }] = await db
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.source, e.source), gte(t.firstSeen, trDayStart(now)), notLike(t.fingerprint, "sinir:%")));
  if (n >= DAILY_NEW_CAP[e.source]) {
    await db
      .insert(t)
      .values({
        fingerprint: overflowFingerprint(e.source, trDay(now)),
        source: e.source,
        level: "warning",
        name: "Sınır",
        message: overflowMessage(e.source, trDay(now)),
        count: increment,
        firstSeen: now,
        lastSeen: now,
      })
      .onConflictDoUpdate({ target: t.fingerprint, set: { count: sql`${t.count} + ${increment}`, lastSeen: now, resolvedAt: null } });
    return "capped";
  }
  await db
    .insert(t)
    .values({ fingerprint: fp, source: e.source, level: e.level, name: e.name, message: e.message, path: e.path, detail: e.detail, digest: e.digest, stack: e.stack, count: increment, firstSeen: now, lastSeen: now })
    .onConflictDoUpdate({ target: t.fingerprint, set });
  return "inserted";
}

export interface RecordOptions {
  db?: DB;
  now?: Date;
  gate?: WriteGate;
  /** Kritik hatanın e-postası (testte verilir); yoksa src/server/errors/alert.ts */
  alert?: (e: CleanEntry, now: Date) => Promise<unknown>;
  /** reportError'ın bekleme sınırı (testte kısaltılır); yoksa WRITE_TIMEOUT_MS */
  timeoutMs?: number;
  /** E-postanın bekleme sınırı (testte kısaltılır); yoksa ALERT_TIMEOUT_MS */
  alertTimeoutMs?: number;
}

/** Derleme sırasında (önceden oluşturma) ya da kapatılmışsa kayıt yok */
function disabled(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" || /^(1|true)$/i.test(process.env.ERROR_LOG_DISABLED?.trim() ?? "");
}

/** Varsayılan e-posta: yalnız gerekince yüklenir (oturum ve e-posta modülleri kancanın ilk yüklemesine girmesin) */
async function defaultAlert(e: CleanEntry, now: Date): Promise<unknown> {
  const { sendCriticalAlert } = await import("./alert");
  return sendCriticalAlert(e, now);
}

/**
 * Hatayı temizleyip yazar (beklenebilir; testler ve kayıt yolları). Fırlatmaz: sonucu döner. Kritik hata (sunucu ve
 * eylem) yazılınca günde bir e-posta denenir: en çok ALERT_TIMEOUT_MS, işlev o süre ayrıca açık tutulur (reportError'ın
 * 3 sn'lik sınırı yazımı keser, e-postayı değil; yoksa Vercel işlevi anahtar alınmış ama e-posta gitmemişken
 * dondurabilirdi).
 */
export async function recordError(raw: ErrorEntry, opts: RecordOptions = {}): Promise<RecordOutcome> {
  if (disabled() && !opts.db) return "skipped";
  let e: CleanEntry;
  let fp: string;
  try {
    e = sanitizeEntry(raw);
    fp = fingerprint(e);
  } catch (err) {
    console.error("[hata kaydı] hazırlanamadı", (err as Error)?.message?.slice(0, 120));
    return "error";
  }
  const now = opts.now ?? new Date();
  const gate = opts.gate ?? sharedGate(e.source);
  const increment = gate.take(fp, now.getTime());
  if (increment === null) return "throttled";
  let outcome: "inserted" | "updated" | "capped";
  try {
    outcome = await writeError(opts.db ?? getDb(), e, fp, increment, now);
  } catch (err) {
    if (!isRowError(err)) gate.failed(fp, increment, now.getTime());
    // Yalnız iletinin başı: drizzle'ın iletisi parametreleri (kişisel veri) taşıyabilir
    console.error("[hata kaydı] yazılamadı", (err as Error)?.message?.split("\n")[0]?.slice(0, 160));
    return "error";
  }
  if (outcome !== "capped" && isCritical(e)) {
    const alerting = capped(
      Promise.resolve()
        .then(() => (opts.alert ?? defaultAlert)(e, now))
        .then(
          () => undefined,
          (err) => void console.error("[hata kaydı] e-posta denenemedi", (err as Error)?.message?.slice(0, 160)),
        ),
      opts.alertTimeoutMs ?? ALERT_TIMEOUT_MS,
      undefined,
    );
    keepAlive(alerting);
    await alerting;
  }
  return outcome;
}

/** Next'in isteğe bağlı bağlamı: Vercel'de işlev yanıttan sonra da bu söz bitene kadar açık kalır */
function keepAlive(p: Promise<unknown>) {
  try {
    const ctx = (globalThis as { [k: symbol]: { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined })[Symbol.for("@next/request-context")];
    ctx?.get?.()?.waitUntil?.(p);
  } catch {
    // bağlam yoksa (yerel sunucu, betik) süreç zaten açık
  }
}

/**
 * Bekletmeden kaydeder (istek yolları): hata kancası, attempt(), /api/hata, /api/csp-rapor. Girdi bir işlev olabilir
 * (eylemin sayfası başlıktan okunur); null dönerse kayıt yok. En çok WRITE_TIMEOUT_MS; hiçbir hata dışarı çıkmaz.
 */
export function reportError(input: ErrorEntry | (() => Promise<ErrorEntry | null> | ErrorEntry | null), opts: RecordOptions = {}): Promise<RecordOutcome> {
  let p: Promise<RecordOutcome>;
  try {
    const run = async (): Promise<RecordOutcome> => {
      const entry = typeof input === "function" ? await input() : input;
      return entry ? recordError(entry, opts) : "skipped";
    };
    p = capped(
      run().catch((): RecordOutcome => "error"),
      opts.timeoutMs ?? WRITE_TIMEOUT_MS,
      "timeout",
    );
  } catch {
    p = Promise.resolve("error");
  }
  keepAlive(p);
  return p;
}

// ---------------------------------------------------------------- Okuma ve yönetici eylemleri

const toRow = (r: typeof s.errorLog.$inferSelect): ErrorRow => ({
  id: r.id,
  source: r.source,
  level: r.level,
  name: r.name,
  message: r.message,
  path: r.path,
  detail: r.detail,
  digests: splitDigests(r.digest),
  stack: r.stack,
  count: r.count,
  firstSeen: r.firstSeen,
  lastSeen: r.lastSeen,
  resolvedAt: r.resolvedAt,
  overflow: isOverflowFingerprint(r.fingerprint),
});

export interface ErrorLogView {
  /** Açık satırlar, son görülüşe göre yeni önce (en çok LIST_LIMIT) */
  open: ErrorRow[];
  /** Açık satırların hepsinin sayısı */
  openCount: number;
  /** Çözülmüş satır sayısı */
  resolvedCount: number;
  /** CSP satırları (açık ve çözülmüş; karar için) */
  csp: ErrorRow[];
  since: string | null;
}

/** Ayarlar › Hata kaydı */
export async function loadErrorLog(db: DB = getDb()): Promise<ErrorLogView> {
  const t = s.errorLog;
  const [open, counts, csp, since] = await Promise.all([
    db.select().from(t).where(isNull(t.resolvedAt)).orderBy(desc(t.lastSeen), desc(t.id)).limit(LIST_LIMIT),
    db
      .select({ open: sql<number>`count(*) filter (where ${t.resolvedAt} is null)`.mapWith(Number), resolved: sql<number>`count(*) filter (where ${t.resolvedAt} is not null)`.mapWith(Number) })
      .from(t),
    db.select().from(t).where(eq(t.source, "csp")).orderBy(desc(t.lastSeen)).limit(200),
    readErrorsSince(db),
  ]);
  return { open: open.map(toRow), openCount: counts[0]?.open ?? 0, resolvedCount: counts[0]?.resolved ?? 0, csp: csp.map(toRow), since };
}

/** "Çözüldü": verilen satırlar ya da (ids yoksa) açık satırların hepsi; kaç satır */
export async function resolveErrors(db: DB, ids: number[] | "all", now = new Date()): Promise<number> {
  const t = s.errorLog;
  const where = ids === "all" ? isNull(t.resolvedAt) : and(isNull(t.resolvedAt), inArray(t.id, ids.length ? ids : [-1]));
  const rows = await db.update(t).set({ resolvedAt: now }).where(where).returning({ id: t.id });
  return rows.length;
}

/**
 * Saklama süresi (sabah işi): RETENTION_DAYS gündür görülmeyen satırlar silinir, tablo MAX_ROWS'u aşarsa en eski son
 * görülüşten fazlası. Kayıt başlangıcı yoksa yazılır. Silinen satır sayısı.
 */
export async function pruneErrorLog(db: DB, now = new Date()): Promise<number> {
  const t = s.errorLog;
  const old = await db
    .delete(t)
    .where(lt(t.lastSeen, new Date(now.getTime() - RETENTION_DAYS * 86_400_000)))
    .returning({ id: t.id });
  const extra = await db
    .select({ id: t.id })
    .from(t)
    .orderBy(desc(t.lastSeen), desc(t.id))
    .offset(MAX_ROWS);
  if (extra.length) await db.delete(t).where(inArray(t.id, extra.map((r) => r.id)));
  await markErrorsSince(db, now);
  return old.length + extra.length;
}

/** Kaydın başladığı an (yalnız yoksa yazılır) */
export async function markErrorsSince(db: DB, at = new Date()): Promise<void> {
  await db.insert(s.integrationState).values({ key: ERRORS_SINCE_KEY, value: at.toISOString() }).onConflictDoNothing();
}

export async function readErrorsSince(db: DB = getDb()): Promise<string | null> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, ERRORS_SINCE_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : null;
}


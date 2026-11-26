/*
 * Veritabanı kotası uyarısının saf kuralları (tests/db-kota.test.ts; docs/YEDEK.md › Veritabanı kotası).
 *
 * Panelin veritabanı (Neon) ücretsiz planda 0,5 GB tutar; dolunca yazma durur (laffogato.net'in veritabanı 24 Kasım
 * 2026'da böyle doldu). Sabah işi her gün boyuta bakar (pg_database_size); %70 ve %90 eşiği ilk geçildiğinde
 * yöneticilere zil uyarısı ve e-posta gider. Eşik başına bir kez: kullanım eşiğin altına inip yeniden geçerse yine.
 * Kota `DB_QUOTA_MB` ortam değişkeninden (varsayılan 512).
 */

export const DB_QUOTA_DEFAULT_MB = 512;
export const QUOTA_THRESHOLDS = [70, 90] as const;
export type QuotaLevel = 0 | 70 | 90;
/** Eşiğin bu kadar puan altına inmeden seviye düşmez: %70 çevresinde gidip gelen boyut her gün e-posta atmasın */
export const QUOTA_REARM_POINTS = 2;
export const DB_QUOTA_STATE_KEY = "db.quota";
export const DB_QUOTA_HREF = "/panel/ayarlar#veritabani";

const MB = 1024 * 1024;

/** `DB_QUOTA_MB`: pozitif sayı değilse varsayılan */
export function quotaMb(env: string | undefined): number {
  const n = Number(env?.trim() || NaN);
  return Number.isFinite(n) && n > 0 ? n : DB_QUOTA_DEFAULT_MB;
}

/** Kullanım yüzdesi (ondalıklı; 100'ü aşabilir) */
export function quotaPct(bytes: number, mb: number): number {
  return mb > 0 ? (Math.max(0, bytes) / (mb * MB)) * 100 : 0;
}

/**
 * Yeni seviye ve bildirilecek eşik. Yukarı geçişte yalnız varılan en yüksek eşik bildirilir (%65'ten %93'e sıçrayan
 * tek "%90" uyarısı alır). Aşağı inişte seviye, eşiğin QUOTA_REARM_POINTS altına inilince düşer; sonra yeniden
 * geçilirse yeniden bildirilir.
 */
export function quotaTransition(prev: QuotaLevel, pct: number): { level: QuotaLevel; notify: 70 | 90 | null } {
  const reached: QuotaLevel = pct >= 90 ? 90 : pct >= 70 ? 70 : 0;
  if (reached > prev) return { level: reached, notify: reached as 70 | 90 };
  // Tutulan seviye: eşiğin biraz altına inmek seviyeyi düşürmez
  const held: QuotaLevel = prev === 90 && pct >= 90 - QUOTA_REARM_POINTS ? 90 : prev >= 70 && pct >= 70 - QUOTA_REARM_POINTS ? 70 : 0;
  return { level: held > reached ? held : reached, notify: null };
}

/** integration_state › db.quota: son ölçüm ve bildirilmiş seviye */
export interface DbQuotaState {
  level: QuotaLevel;
  /** Seviyeye varılan an (zildeki uyarının kimliği; okundu işareti yeni bir geçişe kadar kalır) */
  since: string | null;
  /** O geçişin e-postası gitti mi (gidemediyse ertesi sabah yeniden denenir) */
  mailed: boolean;
  bytes: number;
  quotaMb: number;
  checkedAt: string | null;
}

export const EMPTY_DB_QUOTA_STATE: DbQuotaState = { level: 0, since: null, mailed: true, bytes: 0, quotaMb: DB_QUOTA_DEFAULT_MB, checkedAt: null };

export function asDbQuotaState(v: unknown): DbQuotaState {
  if (!v || typeof v !== "object") return EMPTY_DB_QUOTA_STATE;
  const o = v as Record<string, unknown>;
  const iso = (x: unknown) => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : d);
  return {
    level: o.level === 70 || o.level === 90 ? o.level : 0,
    since: iso(o.since),
    mailed: o.mailed !== false,
    bytes: n(o.bytes, 0),
    quotaMb: n(o.quotaMb, DB_QUOTA_DEFAULT_MB) || DB_QUOTA_DEFAULT_MB,
    checkedAt: iso(o.checkedAt),
  };
}

const num = (n: number, digits = 0) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

/** "361 MB / 512 MB" (1 GB ve üstü kota "1 GB", "1,5 GB") */
export function quotaUsageText(bytes: number, mb: number): string {
  const used = bytes / MB;
  const quota = mb >= 1024 ? `${num(mb / 1024, mb % 1024 ? 1 : 0)} GB` : `${num(mb)} MB`;
  return `${num(used, used < 10 ? 1 : 0)} MB / ${quota}`;
}

/** Yüzde, aşağı yuvarlanır ("%70" yazıyorsa eşik gerçekten geçilmiştir) */
export const quotaPctText = (pct: number) => `%${Math.floor(pct)}`;

/** Çubuğun rengi: %90 ve üstü kırmızı, %70 ve üstü turuncu */
export function quotaTone(pct: number): "ok" | "warn" | "bad" {
  return pct >= 90 ? "bad" : pct >= 70 ? "warn" : "ok";
}

const ADVICE = "Neon'da ücretli plana geçin ya da geliştiriciden eski kayıtların temizlenmesini isteyin.";

/** Bildirimin başlığı ve gövdesi (zil ve e-posta aynı sözü kullanır) */
export function quotaMessage(level: 70 | 90, bytes: number, mb: number): { title: string; body: string } {
  const usage = `${quotaUsageText(bytes, mb)} (${quotaPctText(quotaPct(bytes, mb))})`;
  return level === 90
    ? { title: "Veritabanı kotasının %90'ı doldu", body: `${usage}. Kota dolarsa panel kayıt yazamaz: satış, fatura ve kasa raporu girilemez. ${ADVICE}` }
    : { title: "Veritabanı kotasının %70'i doldu", body: `${usage}. Henüz bir şey bozulmadı; %90'da yeniden uyarılır. ${ADVICE}` };
}

/** Zildeki uyarı (src/lib/job-health.ts › systemAlerts ekler); seviye 0'sa null. %90 Genel bakış şeridinde de görünür */
export function quotaAlert(state: DbQuotaState): { id: string; level: "warning"; title: string; body: string; banner?: boolean; actionLabel?: string } | null {
  if (state.level === 0) return null;
  const msg = quotaMessage(state.level, state.bytes, state.quotaMb);
  return {
    id: `db-kota-${state.level}-${(state.since ?? "").slice(0, 10) || "x"}`,
    level: "warning",
    ...msg,
    ...(state.level === 90 ? { banner: true, actionLabel: "Veritabanı" } : {}),
  };
}

/** Sabah işindeki sonucu (src/server/db-quota/check.ts runQuotaCheck) */
export type QuotaCheckResult =
  | { status: "ok"; pct: number; level: QuotaLevel; notified: 70 | 90 | null; mail: "sent" | "none" | "error" }
  | { status: "error"; error: string };

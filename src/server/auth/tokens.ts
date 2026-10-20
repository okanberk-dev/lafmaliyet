import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tek kullanımlık bağlantı anahtarları (davet ve parola sıfırlama). Saf yardımcılar: veritabanına dokunmaz,
 * testlerde doğrudan çalışır. Ham anahtar 32 rastgele bayt (base64url, 43 karakter) olarak yalnızca bir kez
 * gösterilir; veritabanında sha256 özeti durur, karşılaştırma özetler üzerinden sabit sürede yapılır.
 */

export type TokenKind = "invite" | "reset";

/** Davet bağlantısı 72 saat, yöneticinin verdiği sıfırlama 24 saat, "Parolamı unuttum" bağlantısı 2 saat geçerli */
export const TOKEN_HOURS = { invite: 72, reset: 24, forgot: 2 } as const;
/** Bir bağlantıyla en fazla bu kadar parola denemesi (sonra yenisi istenir) */
export const MAX_TOKEN_ATTEMPTS = 10;

/**
 * Davetle eklenen kişinin parolası henüz yok: bu değer hiçbir parolayla eşleşmez (verifyPassword yalnızca "scrypt$"
 * ile başlayan özeti kabul eder), kişi bağlantıdan parolasını belirleyene kadar giriş yapılamaz.
 */
export const INVITE_PASSWORD_HASH = "!davet-bekliyor";

export function isPendingInvite(passwordHash: string): boolean {
  return passwordHash === INVITE_PASSWORD_HASH;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Biçimi tutmayan anahtar veritabanına sorulmadan reddedilir */
export function isTokenShaped(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(`laf-token:${raw}`).digest("hex");
}

/** Ham anahtarın kayıtlı özetle eşleşip eşleşmediği (sabit süreli karşılaştırma) */
export function tokenMatches(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(raw), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function tokenExpiry(hours: number, now = new Date()): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}

export type TokenStatus = "ok" | "used" | "expired" | "blocked" | "inactive";

/** Kayıtlı bağlantının şu anki durumu; "ok" dışındaki her durumda sayfa dostça bir açıklama gösterir */
export function tokenStatus(
  row: { expiresAt: Date; usedAt: Date | null; attempts: number },
  user: { active: boolean },
  now = new Date(),
): TokenStatus {
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.attempts >= MAX_TOKEN_ATTEMPTS) return "blocked";
  if (!user.active) return "inactive";
  return "ok";
}

/** Panelin adresi (APP_URL ya da canlı adres), sonunda / olmadan */
export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "https://ladmin.laffogato.net").replace(/\/+$/, "");
}

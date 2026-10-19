import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * İki adımlı doğrulama: RFC 6238 TOTP (30 saniye, 6 hane, HMAC-SHA1). Google Authenticator, Microsoft
 * Authenticator, 1Password, Authy… hepsiyle çalışır. Saat kaymasına karşı bir önceki ve bir sonraki adım da kabul
 * edilir; aynı kod iki kez kullanılamaz (son kullanılan adım saklanır).
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD = 30;
const DIGITS = 6;
export const TOTP_ISSUER = "L'Affogato Panel";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Geçersiz base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bit rastgele anahtar (base32) */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, "0");
}

/**
 * Kodu doğrular; geçerliyse eşleşen zaman adımını döndürür. `lastStep` ve öncesi reddedilir (tekrar kullanım).
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const current = totpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

export function otpauthUri(account: string, secret: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  const params = new URLSearchParams({ secret, issuer: TOTP_ISSUER, algorithm: "SHA1", digits: String(DIGITS), period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, "%20")}`;
}

/** Anahtarı elle girmek için 4'lü gruplar */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

// ---------------------------------------------------------------- Kurtarma kodları

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // karışan harfler (i, l, o, 0, 1) yok
export const RECOVERY_COUNT = 8;

/** Telefon kaybolursa kullanılacak tek seferlik kodlar: "k7m2p-9xq4t" */
export function generateRecoveryCodes(count = RECOVERY_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`laf-recovery:${normalizeRecoveryCode(code)}`).digest("hex");
}

/** Kod listede varsa listeden çıkarılmış hâlini döndürür (tek kullanımlık) */
export function consumeRecoveryCode(hashes: string[], code: string): string[] | null {
  if (normalizeRecoveryCode(code).length !== 10) return null;
  const h = hashRecoveryCode(code);
  const i = hashes.indexOf(h);
  return i < 0 ? null : [...hashes.slice(0, i), ...hashes.slice(i + 1)];
}

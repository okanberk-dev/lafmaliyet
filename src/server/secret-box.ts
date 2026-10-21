import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Veritabanında duran gizli değerler (Paraşüt belirteçleri, iki adımlı doğrulama anahtarları, Web Push'un VAPID özel
 * anahtarı) AES-256-GCM ile şifrelenir. Anahtar AUTH_SECRET'tan, kullanım amacına göre ayrı türetilir; AUTH_SECRET
 * değişirse bu değerler okunamaz (Paraşüt belirteci yeniden alınır, iki adımlı doğrulama yeniden kurulur, bildirim
 * anahtarı yenilenir ve cihazlar bir sonraki açılışta yeniden abone olur).
 */
export type SealPurpose = "parasut-token" | "totp" | "webpush";

function key(purpose: SealPurpose): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET tanımlı değil");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function seal(plain: string, purpose: SealPurpose = "parasut-token"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string, purpose: SealPurpose = "parasut-token"): string | null {
  try {
    const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(purpose), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

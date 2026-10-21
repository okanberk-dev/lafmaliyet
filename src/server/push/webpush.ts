import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

import { importJWK, SignJWT } from "jose";

/**
 * Web Push'un iki parçası, kütüphanesiz (tests/web-push.test.ts RFC 8291'in örneğiyle sınar):
 * - VAPID (RFC 8292): gönderen sunucunun kimliği; ES256 imzalı kısa ömürlü JWT, "vapid t=…, k=…" başlığı.
 * - aes128gcm şifreleme (RFC 8291 + RFC 8188): bildirimin içeriği yalnız aboneliğin tarayıcısında açılır; Google /
 *   Mozilla / Apple'ın push servisi içeriği göremez.
 * Anahtarlar base64url (dolgusuz) metindir: genel anahtar 65 baytlık sıkıştırılmamış P-256 noktası, özel anahtar 32
 * baytlık d.
 */

export const b64u = {
  encode: (buf: Uint8Array) => Buffer.from(buf).toString("base64url"),
  decode: (s: string) => Buffer.from(s, "base64url"),
};

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u.encode(ecdh.getPublicKey()), privateKey: b64u.encode(ecdh.getPrivateKey()) };
}

/** Özel anahtardan genel anahtarı yeniden üretir (ikisi birbirini tutuyor mu denetimi için) */
export function publicKeyOf(privateKey: string): string {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(b64u.decode(privateKey));
  return b64u.encode(ecdh.getPublicKey());
}

/**
 * VAPID başlığı: JWT'nin hedefi aboneliğin push servisinin kökü (https://fcm.googleapis.com gibi), en çok 24 saat
 * geçerli (12 saat verilir), `sub` iletişim adresi (mailto: ya da https:).
 */
export async function vapidAuthorization(input: { endpoint: string; keys: VapidKeys; subject: string; now?: number }): Promise<string> {
  const pub = b64u.decode(input.keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID genel anahtarı geçersiz");
  const key = await importJWK(
    { kty: "EC", crv: "P-256", x: b64u.encode(pub.subarray(1, 33)), y: b64u.encode(pub.subarray(33, 65)), d: input.keys.privateKey },
    "ES256",
  );
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const jwt = await new SignJWT({ sub: input.subject })
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(new URL(input.endpoint).origin)
    .setExpirationTime(now + 12 * 3600)
    .sign(key);
  return `vapid t=${jwt}, k=${input.keys.publicKey}`;
}

/** Tek kayıtlık aes128gcm gövdesinin kayıt boyutu; içerik 4 KB'den küçük tutulur */
const RECORD_SIZE = 4096;
/** Push servisleri en az 4096 baytlık gövdeyi kabul eder; başlık (86 bayt), ayraç ve etiket payı düşülür */
export const MAX_PAYLOAD_BYTES = 3000;

/**
 * RFC 8291: aboneliğin genel anahtarı (p256dh) ve doğrulama sırrı (auth) ile içeriği şifreler. `salt` ve
 * `senderPrivateKey` yalnız testte verilir (RFC örneğinin çıktısını üretmek için); normalde her gönderim rastgeledir.
 */
export function encryptPayload(input: { p256dh: string; auth: string; payload: string | Uint8Array; salt?: Uint8Array; senderPrivateKey?: Uint8Array }): Buffer {
  const uaPublic = b64u.decode(input.p256dh);
  const authSecret = b64u.decode(input.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Abonelik anahtarları geçersiz");
  const plain = typeof input.payload === "string" ? Buffer.from(input.payload, "utf8") : Buffer.from(input.payload);
  if (plain.length > MAX_PAYLOAD_BYTES) throw new Error("Bildirim içeriği çok uzun");

  const sender = createECDH("prime256v1");
  if (input.senderPrivateKey) sender.setPrivateKey(Buffer.from(input.senderPrivateKey));
  else sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const shared = sender.computeSecret(uaPublic);
  const salt = input.salt ? Buffer.from(input.salt) : randomBytes(16);

  // IKM = HKDF(auth, ECDH, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12));

  // Tek (son) kayıt: içerik + 0x02 ayracı, dolgu yok
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, encrypted]);
}

/** Abonelik adresi yalnız bilinen push servislerine gidebilir (sunucu panelden verilen rastgele adrese istek atmasın) */
export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const h = url.hostname.toLowerCase();
  return (
    h === "fcm.googleapis.com" ||
    h === "android.googleapis.com" ||
    h === "push.services.mozilla.com" ||
    h.endsWith(".push.services.mozilla.com") ||
    h === "web.push.apple.com" ||
    h.endsWith(".push.apple.com") ||
    h.endsWith(".notify.windows.com")
  );
}

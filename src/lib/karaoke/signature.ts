import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * laffogato.net ile panel arasındaki isteklerin imzası (iki yönde de aynı; sitedeki karşılığı
 * src/lib/panel/karaoke-sync-core.ts, iki tarafın testleri aynı vektörleri sabitler, tests/karaoke.test.ts):
 *
 *   kanonik = zaman (unix saniye) \n YÖNTEM \n yol \n sıralı sorgu \n sha256(gövde)
 *   imza    = hex(HMAC-SHA256(KARAOKE_SYNC_SECRET, kanonik))
 *   başlıklar: x-laf-timestamp, x-laf-signature: v1=<imza>
 *
 * Alıcı 5 dakikadan eski ya da ileri zamanı, bozuk başlığı ve tutmayan imzayı reddeder; karşılaştırma sabit sürelidir.
 */

export const TIMESTAMP_HEADER = "x-laf-timestamp";
export const SIGNATURE_HEADER = "x-laf-signature";
export const MAX_SKEW_SECONDS = 300;

/** Sorgu anahtara, sonra değere göre sıralanır: parametrelerin sırası imzayı değiştirmez */
export function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function canonicalString(input: { timestamp: number; method: string; url: URL; body: string }): string {
  return [
    String(input.timestamp),
    input.method.toUpperCase(),
    input.url.pathname,
    canonicalQuery(input.url.searchParams),
    createHash("sha256").update(input.body, "utf8").digest("hex"),
  ].join("\n");
}

export function sign(secret: string, input: { timestamp: number; method: string; url: URL; body: string }): string {
  return createHmac("sha256", secret).update(canonicalString(input)).digest("hex");
}

/** İmzalı istek başlıkları */
export function signedHeaders(secret: string, method: string, url: URL, body = "", now = Date.now()): Record<string, string> {
  const timestamp = Math.floor(now / 1000);
  return { [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: `v1=${sign(secret, { timestamp, method, url, body })}` };
}

export function verifySignature(
  secret: string,
  input: { method: string; url: URL; body: string; timestamp: string | null; signature: string | null; now?: number },
): boolean {
  if (!input.timestamp || !input.signature || !/^\d{9,12}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  if (Math.abs(Math.floor((input.now ?? Date.now()) / 1000) - timestamp) > MAX_SKEW_SECONDS) return false;
  const m = /^v1=([0-9a-f]{64})$/.exec(input.signature.trim());
  if (!m) return false;
  const want = Buffer.from(sign(secret, { timestamp, method: input.method, url: input.url, body: input.body }), "hex");
  const got = Buffer.from(m[1], "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

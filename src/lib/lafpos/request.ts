import { verifySignature } from "@/lib/karaoke/signature";

/**
 * LafPOS'un imzalı isteklerinin denetimi (saf; uçlar ve testler paylaşır). İmza laffogato.net bağlantısınınkiyle aynı
 * kural ve aynı kod (src/lib/karaoke/signature.ts: zaman, yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı; ±5 dakika,
 * sabit süreli karşılaştırma); anahtarı ayrı: LAFPOS_SYNC_SECRET (LafPOS'ta LAFMALIYET_SYNC_SECRET). Böylece kafedeki
 * makinede sitenin anahtarı durmaz, iki anahtar ayrı döndürülür. Ayrıntı: docs/LAFPOS.md.
 */

/** Anahtar en az bu kadar karakter; kısaysa yok sayılır (uçlar 503) */
export const LAFPOS_SECRET_MIN = 32;

/** LafPOS'un anahtarı; yoksa ya da 32 karakterden kısaysa null (bağlantı kapalı) */
export function lafposSecretFrom(env: Record<string, string | undefined>): string | null {
  const v = env.LAFPOS_SYNC_SECRET?.trim();
  return v && v.length >= LAFPOS_SECRET_MIN ? v : null;
}

export type LafposCheck = { ok: true } | { ok: false; status: 401 | 413 | 503; error: "unauthorized" | "too_large" | "not_configured" };

/**
 * Anahtar yoksa 503, gövde sınırı aşarsa 413, imza yok / yanlış / 5 dakikadan eski ya da ileriyse 401 (ayrıntı
 * verilmez). İmza yolu da kapsar: bir ucun imzası öteki uçta geçmez.
 */
export function checkLafposRequest(input: {
  secret: string | null;
  method: "GET" | "POST";
  url: URL;
  body: string;
  timestamp: string | null;
  signature: string | null;
  maxBytes: number;
  now?: number;
}): LafposCheck {
  if (!input.secret) return { ok: false, status: 503, error: "not_configured" };
  if (Buffer.byteLength(input.body, "utf8") > input.maxBytes) return { ok: false, status: 413, error: "too_large" };
  const ok = verifySignature(input.secret, {
    method: input.method,
    url: input.url,
    body: input.body,
    timestamp: input.timestamp,
    signature: input.signature,
    now: input.now,
  });
  return ok ? { ok: true } : { ok: false, status: 401, error: "unauthorized" };
}

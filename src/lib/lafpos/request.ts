import { verifySignature } from "@/lib/karaoke/signature";

/**
 * LafPOS'un imzalı isteklerinin denetimi (saf; uçlar ve testler paylaşır). İmza laffogato.net bağlantısınınkiyle aynı
 * kural ve aynı kod (src/lib/karaoke/signature.ts: zaman, yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı; ±5 dakika,
 * sabit süreli karşılaştırma); anahtarı ayrı: LAFPOS_SYNC_SECRET (LafPOS'ta LAFMALIYET_SYNC_SECRET). Böylece kafedeki
 * makinede sitenin anahtarı durmaz, iki anahtar ayrı döndürülür. Ayrıntı: docs/LAFPOS.md.
 */

/** Anahtar en az bu kadar karakter; kısaysa yok sayılır (uçlar 503) */
export const LAFPOS_SECRET_MIN = 32;

/**
 * Anahtarın neden kullanılmadığı (Ayarlar'daki LafPOS kartı söyler): yok, 32 karakterden kısa ya da sitenin anahtarıyla
 * (KARAOKE_SYNC_SECRET) aynı. Aynıysa bağlantı kapalı kalır: kafedeki makinede sitenin anahtarı durmamalı, ikisi ayrı
 * döndürülür (laffogato'nun signed-callers.ts'i aynı engeli koyar). Sorun yoksa null.
 */
export function lafposSecretProblem(env: Record<string, string | undefined>): "missing" | "short" | "same_as_site" | null {
  const v = env.LAFPOS_SYNC_SECRET?.trim();
  if (!v) return "missing";
  if (v.length < LAFPOS_SECRET_MIN) return "short";
  if (v === env.KARAOKE_SYNC_SECRET?.trim()) return "same_as_site";
  return null;
}

/** LafPOS'un anahtarı; yoksa, 32 karakterden kısaysa ya da sitenin anahtarıyla aynıysa null (bağlantı kapalı, uçlar 503) */
export function lafposSecretFrom(env: Record<string, string | undefined>): string | null {
  return lafposSecretProblem(env) === null ? env.LAFPOS_SYNC_SECRET!.trim() : null;
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

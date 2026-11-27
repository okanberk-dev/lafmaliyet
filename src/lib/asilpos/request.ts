import { verifySignature } from "@/lib/karaoke/signature";

import { posEnv } from "./env";
import { ASILPOS_SECRET_MIN } from "./secret-rules";

export { ASILPOS_SECRET_MIN };

/**
 * AsilPOS'un imzalı isteklerinin denetimi (saf; uçlar ve testler paylaşır). İmza laffogato.net bağlantısınınkiyle aynı
 * kural ve aynı kod (src/lib/karaoke/signature.ts: zaman, yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı; ±5 dakika,
 * sabit süreli karşılaştırma); anahtarı ayrı: ASILPOS_SYNC_SECRET, eski adı da okunur (AsilPOS'ta LAFMALIYET_SYNC_SECRET). Böylece kafedeki
 * makinede sitenin anahtarı durmaz, iki anahtar ayrı döndürülür. Ayrıntı: docs/ASILPOS.md.
 */

type Env = Record<string, string | undefined>;

export type SecretProblem = "missing" | "short" | "same_as_site";

/**
 * Anahtarın neden kullanılmadığı (Ayarlar'daki AsilPOS kartı söyler): yok, 32 karakterden kısa ya da sitenin anahtarıyla
 * (KARAOKE_SYNC_SECRET) aynı. Aynıysa bağlantı kapalı kalır: kafedeki makinede sitenin anahtarı durmamalı, ikisi ayrı
 * döndürülür (laffogato'nun signed-callers.ts'i aynı engeli koyar). Sorun yoksa null. `secret`: kullanılan anahtarın
 * değeri (panelde saklanan ya da ortamdaki, src/server/asilpos/branch.ts)
 */
export function secretProblem(secret: string | null | undefined, env: Env = process.env): SecretProblem | null {
  const v = secret?.trim();
  if (!v) return "missing";
  if (v.length < ASILPOS_SECRET_MIN) return "short";
  if (v === env.KARAOKE_SYNC_SECRET?.trim()) return "same_as_site";
  return null;
}

/** Anahtar kullanılabiliyorsa kırpılmış değeri; yoksa, 32 karakterden kısaysa ya da sitenin anahtarıyla aynıysa null */
export function secretFrom(secret: string | null | undefined, env: Env = process.env): string | null {
  return secretProblem(secret, env) === null ? secret!.trim() : null;
}

/** Ortamdaki anahtar: ASILPOS_SYNC_SECRET, boşsa eski adı (src/lib/asilpos/env.ts) */
export const envSyncSecret = (env: Env = process.env): string | undefined => posEnv("SYNC_SECRET", env);

/** Ortamdaki anahtarın sorunu (panelde saklanan anahtar yokken) */
export function asilposSecretProblem(env: Env): SecretProblem | null {
  return secretProblem(envSyncSecret(env), env);
}

/** Ortamdaki AsilPOS anahtarı; yoksa, 32 karakterden kısaysa ya da sitenin anahtarıyla aynıysa null (uçlar 503) */
export function asilposSecretFrom(env: Env): string | null {
  return secretFrom(envSyncSecret(env), env);
}

export type AsilposCheck = { ok: true } | { ok: false; status: 401 | 413 | 503; error: "unauthorized" | "too_large" | "not_configured" };

/**
 * Anahtar yoksa 503, gövde sınırı aşarsa 413, imza yok / yanlış / 5 dakikadan eski ya da ileriyse 401 (ayrıntı
 * verilmez). İmza yolu da kapsar: bir ucun imzası öteki uçta geçmez.
 */
export function checkAsilposRequest(input: {
  secret: string | null;
  method: "GET" | "POST";
  url: URL;
  body: string;
  timestamp: string | null;
  signature: string | null;
  maxBytes: number;
  now?: number;
}): AsilposCheck {
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

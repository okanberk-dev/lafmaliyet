import "server-only";

import { signedRequest } from "@/lib/karaoke/signature";

/**
 * laffogato.net ile panelin bütün bağlantısının ortak parçası: paylaşılan anahtar, sitenin adresi ve imzalı istek.
 * Karaoke (src/server/karaoke/sync.ts) ve menü (src/server/site-menu/) aynı anahtarı ve aynı imzayı kullanır
 * (src/lib/karaoke/signature.ts; sitedeki karşılığı src/lib/panel/karaoke-sync-core.ts). Anahtarın adı tarihsel:
 * KARAOKE_SYNC_SECRET sitenin panelle bütün bağlantısının anahtarıdır.
 */

/** Bir istek en çok bu kadar bekler; site yanıt vermezse bağlantı hatası sayılır */
export const SITE_TIMEOUT_MS = 8000;

/** Paylaşılan anahtar (iki projede aynı, en az 32 karakter); yoksa bağlantı kapalı */
export function siteLinkSecret(): string | null {
  const v = process.env.KARAOKE_SYNC_SECRET?.trim();
  return v && v.length >= 32 ? v : null;
}

/** Sitenin adresi (LAFFOGATO_URL; boşsa https://laffogato.net), sonda eğik çizgi yok */
export function siteUrl(): string {
  return (process.env.LAFFOGATO_URL?.trim() || "https://laffogato.net").replace(/\/+$/, "");
}

/**
 * Siteye imzalı istek: 8 saniyede yanıt yoksa TimeoutError fırlatır, önbelleğe alınmaz. Gövdeli istekte imzalanan
 * metin gönderilen metnin kendisidir (aynı dize).
 */
export function signedSiteFetch(secret: string, url: URL, init: { method?: "GET" | "POST"; body?: string } = {}): Promise<Response> {
  const req = signedRequest(secret, init.method ?? "GET", url, init.body ?? "");
  return fetch(url, { ...req, signal: AbortSignal.timeout(SITE_TIMEOUT_MS), cache: "no-store" });
}

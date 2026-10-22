import { verifySignature } from "@/lib/karaoke/signature";

/**
 * laffogato.net'in pinglerinin ortak denetimi (saf; uçlar ve testler paylaşır): menü (`POST /api/menu/ping`,
 * docs/SITE-MENU.md) ve siparişler (`POST /api/orders/ping`, docs/SITE-SIPARIS.md). Karaoke pingiyle aynı kurallar:
 * anahtar yoksa 503, gövde 4 KB'tan büyükse 413, imza yok / yanlış / 5 dakikadan eski ya da ileriyse 401 (ayrıntı
 * verilmez). Gövde ({"event":"…","at"}) içerik taşımaz; içeriğine bakılmaz, imza yeter. İmza yolu da kapsar: bir
 * bağlantının pingi ötekinin ucunda geçmez.
 */

export const PING_MAX_BYTES = 4096;

export type PingCheck = { ok: true } | { ok: false; status: 401 | 413 | 503; error: "unauthorized" | "too_large" | "not_configured" };

export function checkSitePing(input: {
  secret: string | null;
  url: URL;
  body: string;
  timestamp: string | null;
  signature: string | null;
  now?: number;
}): PingCheck {
  if (!input.secret) return { ok: false, status: 503, error: "not_configured" };
  if (Buffer.byteLength(input.body, "utf8") > PING_MAX_BYTES) return { ok: false, status: 413, error: "too_large" };
  const ok = verifySignature(input.secret, {
    method: "POST",
    url: input.url,
    body: input.body,
    timestamp: input.timestamp,
    signature: input.signature,
    now: input.now,
  });
  return ok ? { ok: true } : { ok: false, status: 401, error: "unauthorized" };
}

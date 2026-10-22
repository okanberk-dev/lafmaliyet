import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { checkSitePing } from "@/lib/site-ping";
import { siteLinkSecret } from "@/server/site-link";
import { noteOrdersPing, syncSiteOrders } from "@/server/site-orders/sync";

export const maxDuration = 30;

/** Ping çekmesi geçici bir hatayla biterse bir kez daha denenir (sipariş ekranı beklemesin) */
const RETRY_DELAY_MS = 4000;

/**
 * laffogato.net'in sipariş pingi: sitede bir sipariş yazıldı (açıldı, ödendi, ilerletildi, iade edildi; mağaza kolisi
 * de). İçerik taşımaz ({"event":"orders.changed","at"}); imza (KARAOKE_SYNC_SECRET, src/lib/karaoke/signature.ts)
 * doğrulanınca hemen 202 döner, panel sitenin açık kafe siparişlerini yanıttan sonra imzalı çeker ve bar ekranına
 * verir (docs/SITE-SIPARIS.md). Anahtar yoksa 503, gövde 4 KB'tan büyükse 413, imza tutmazsa 401 (ayrıntı verilmez).
 * Denetim src/lib/site-ping.ts'te (menü pingiyle ortak).
 */
export async function POST(request: NextRequest) {
  await connection();
  const secret = siteLinkSecret();
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4096) return Response.json({ error: "too_large" }, { status: 413 });
  const body = await request.text();
  const check = checkSitePing({
    secret,
    url: new URL(request.url),
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });
  after(async () => {
    try {
      await noteOrdersPing();
      let r = await syncSiteOrders("ping");
      if (r.status === "error") {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        r = await syncSiteOrders("ping");
      }
      if (r.status === "error") console.warn("[siparis] ping çekmesi:", r.error);
    } catch (e) {
      console.error("[siparis] ping", e);
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}

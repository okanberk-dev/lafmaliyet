import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { runPingWork } from "@/lib/ping-work";
import { checkSitePing } from "@/lib/site-ping";
import { siteLinkSecret } from "@/server/site-link";
import { noteOrdersPing, syncSiteOrders } from "@/server/site-orders/sync";

export const maxDuration = 30;

/**
 * laffogato.net'in sipariş pingi: sitede bir sipariş yazıldı (açıldı, ödendi, ilerletildi, iade edildi; mağaza kolisi
 * de). İçerik taşımaz ({"event":"orders.changed","at"}); imza (KARAOKE_SYNC_SECRET, src/lib/karaoke/signature.ts)
 * doğrulanınca hemen 202 döner, panel sitenin açık kafe siparişlerini yanıttan sonra imzalı çeker ve bar ekranına
 * verir (docs/SITE-SIPARIS.md). Anahtar yoksa 503, gövde 4 KB'tan büyükse 413, imza tutmazsa 401 (ayrıntı verilmez).
 * Denetim src/lib/site-ping.ts'te (menü pingiyle ortak). Ping kaydı yazılamasa da çekilir; çekme hata verir ya da
 * düşerse 4 saniye sonra bir kez daha denenir (src/lib/ping-work.ts; sipariş ekranı beklemesin).
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
    await runPingWork("[siparis]", { note: noteOrdersPing, pull: () => syncSiteOrders("ping") });
  });
  return Response.json({ ok: true }, { status: 202 });
}

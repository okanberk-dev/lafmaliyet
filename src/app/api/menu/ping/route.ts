import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { checkMenuPing } from "@/lib/site-menu/ping";
import { siteLinkSecret } from "@/server/site-link";
import { notePing, syncSiteMenu } from "@/server/site-menu/sync";

export const maxDuration = 30;

/**
 * laffogato.net'in menü pingi: sitede bir menü kalemi değişti (fiyat, Satışta / Tükendi, yeni ya da silinen kalem).
 * İçerik taşımaz; imza (KARAOKE_SYNC_SECRET, src/lib/karaoke/signature.ts) doğrulanınca hemen 202 döner, panel
 * sitenin bütün menüsünü yanıttan sonra imzalı çeker ve bağlı ürünlere uygular (docs/SITE-MENU.md). Anahtar yoksa
 * 503, gövde 4 KB'tan büyükse 413, imza tutmazsa 401 (ayrıntı verilmez). Denetim src/lib/site-menu/ping.ts'te.
 */
export async function POST(request: NextRequest) {
  await connection();
  const secret = siteLinkSecret();
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4096) return Response.json({ error: "too_large" }, { status: 413 });
  const body = await request.text();
  const check = checkMenuPing({
    secret,
    url: new URL(request.url),
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });
  after(async () => {
    try {
      await notePing();
      const r = await syncSiteMenu("ping");
      if (r.status === "error") console.warn("[menu] ping eşitlemesi:", r.error);
    } catch (e) {
      console.error("[menu] ping", e);
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}

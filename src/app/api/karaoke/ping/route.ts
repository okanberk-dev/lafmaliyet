import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { runPingWork } from "@/lib/ping-work";
import { checkSitePing } from "@/lib/site-ping";
import { karaokeSecret, notePing, syncKaraoke } from "@/server/karaoke/sync";

export const maxDuration = 30;

/**
 * laffogato.net'in pingi: bir karaoke rezervasyonu değişti (yeni, ödendi, iptal, saat). İçerik taşımaz; imza
 * (KARAOKE_SYNC_SECRET, src/lib/karaoke/signature.ts) doğrulanınca hemen 202 döner, panel değişenleri yanıttan sonra
 * sitenin imzalı ucundan çeker ve cihazlara bildirir. Anahtar yoksa 503, gövde 4 KB'tan büyükse 413, imza tutmazsa 401
 * (ayrıntı verilmez). Denetim src/lib/site-ping.ts'te (menü ve sipariş pingleriyle ortak). Site 202'den sonra pingi
 * yinelemez: kayıt yazılamasa da çekilir, çekme düşerse bir kez daha denenir (src/lib/ping-work.ts).
 */
export async function POST(request: NextRequest) {
  await connection();
  const secret = karaokeSecret();
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
    await runPingWork("[karaoke]", { note: notePing, pull: () => syncKaraoke("ping") });
  });
  return Response.json({ ok: true }, { status: 202 });
}

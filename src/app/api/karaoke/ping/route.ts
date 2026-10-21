import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/karaoke/signature";
import { karaokeSecret, notePing, syncKaraoke } from "@/server/karaoke/sync";

export const maxDuration = 30;

/**
 * laffogato.net'in pingi: bir karaoke rezervasyonu değişti (yeni, ödendi, iptal, saat). İçerik taşımaz; imza
 * (KARAOKE_SYNC_SECRET, src/lib/karaoke/signature.ts) doğrulanınca hemen 202 döner, panel değişenleri yanıttan sonra
 * sitenin imzalı ucundan çeker ve cihazlara bildirir. Anahtar yoksa 503, imza tutmazsa 401 (ayrıntı verilmez).
 */
export async function POST(request: NextRequest) {
  await connection();
  const secret = karaokeSecret();
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const body = await request.text();
  if (body.length > 4096) return Response.json({ error: "too_large" }, { status: 413 });
  const ok = verifySignature(secret, {
    method: "POST",
    url: new URL(request.url),
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  after(async () => {
    try {
      await notePing();
      const r = await syncKaraoke("ping");
      if (r.status === "error") console.warn("[karaoke] ping eşitlemesi:", r.error);
    } catch (e) {
      console.error("[karaoke] ping", e);
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}

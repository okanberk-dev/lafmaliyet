import { connection, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/server/auth/dal";
import { ensureOrdersFresh } from "@/server/site-orders/sync";

export const maxDuration = 30;

const bodySchema = z.object({
  /** Son çekme bundan eskiyse site sorulur (ms); 0 = "Yenile" düğmesi */
  maxAgeMs: z.number().int().min(0).max(2 * 60 * 60_000),
});

/** "Yenile" düğmesi bile siteyi bundan sık sormaz (art arda basılırsa); son çekme hatalıysa hemen dener */
const MANUAL_MIN_MS = 10_000;

/**
 * Bar ekranının isteği (docs/SITE-SIPARIS.md): ekran açılınca ya da öne gelince (son çekme bir dakikadan eskiyse),
 * arka planda birkaç dakikada bir (ping kaçtıysa diye) ve "Yenile" ile laffogato.net'in açık siparişleri yeniden
 * çekilir; ekran sonucu canlı uçtan (/api/canli) alır. Sunucu eylemi değil uç: site 8 saniye bekletse de ekrandaki
 * öteki eylemler (sayaç, uzatma) sıraya girmez. Oturum gerekir (personel ve yönetici).
 */
export async function POST(request: NextRequest) {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Giriş gerekli" }, { status: 401, headers });
  let maxAgeMs: number;
  try {
    maxAgeMs = bodySchema.parse(await request.json()).maxAgeMs;
  } catch {
    return Response.json({ error: "Geçersiz istek" }, { status: 400, headers });
  }
  const r = await ensureOrdersFresh(Math.max(maxAgeMs, MANUAL_MIN_MS), { manual: maxAgeMs === 0 });
  return Response.json(r.status === "error" ? { status: "error", error: r.error } : { status: r.status }, { headers });
}

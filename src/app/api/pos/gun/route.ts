import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { POS_DAY_MAX_BYTES } from "@/lib/lafpos/day";
import { getDb } from "@/server/db";
import { lafposSecret } from "@/server/lafpos/ingest";
import { handlePosDay, noteUnverified } from "@/server/lafpos/status";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LafPOS'un gün sonu (docs/LAFPOS.md): kafedeki kasa internetten erişilemediği için her iş gününü kapanışta (ve
 * düzeltmede yeniden) buraya iter; aynı gün aynı Z no ile öncekinin yerine geçer. İmza laffogato.net bağlantısınınki
 * gibi, anahtarı LAFPOS_SYNC_SECRET. Anahtar yoksa 503, gövde 256 KB'tan büyükse 413, imza tutmazsa 401 (ayrıntı
 * verilmez), gövde sözleşmeye uymazsa 400 `{ error: "invalid", field }`, o güne başka bir Z ile yazılmış özet varsa
 * 409 `{ error: "z_conflict", date, zNo }` (hiçbir şey yazılmaz); yazılınca 200 `{ ok: true, date, lines, counted,
 * switchDay }` (`counted`: gün LafPOS'a geçiş gününden önce değil). Denetim ve yazım src/server/lafpos/ingest.ts'te;
 * sonuç Ayarlar'daki LafPOS kartı için durum satırına yazılır (src/server/lafpos/status.ts; anahtar yokken hiçbir şey).
 */
export async function POST(request: NextRequest) {
  await connection();
  const secret = lafposSecret();
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > POS_DAY_MAX_BYTES) {
    await noteUnverified(getDb(), 413);
    return Response.json({ error: "too_large" }, { status: 413, headers: NO_STORE });
  }
  const body = await request.text();
  try {
    const r = await handlePosDay(getDb(), {
      secret,
      url: new URL(request.url),
      body,
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[lafpos] gün sonu yazılamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

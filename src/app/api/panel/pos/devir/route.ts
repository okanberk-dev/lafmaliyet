import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { getDb } from "@/server/db";
import { servePosDevir } from "@/server/lafpos/devir";
import { lafposSecret } from "@/server/lafpos/ingest";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LafPOS'un kasa zinciri (docs/LAFPOS.md › Kasa zinciri): bir günün devri, yani ertesi günün beklenen açılışı
 * `{ version: 1, date, nextOpening: { amount, source: "kasa_raporu" | "lafpos" } | null }` (TL; gün sonu yanıtındakiyle
 * aynı nesne). LafPOS gün kapalıyken, en sık 5 dakikada bir sorar. Makine ucu: yalnız LafPOS'un imzasıyla
 * (LAFPOS_SYNC_SECRET; sorgu imzaya girer), oturumla açılmaz; önbelleğe alınmaz. Anahtar yoksa 503, imza tutmazsa 401,
 * gün okunamazsa 400 `{ error: "invalid", field: "date" }`.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await servePosDevir(getDb(), {
      secret: await lafposSecret(),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[lafpos] devir okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

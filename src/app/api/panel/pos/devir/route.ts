import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { getDb } from "@/server/db";
import { servePosDevir } from "@/server/asilpos/devir";
import { asilposRequestSecret } from "@/server/asilpos/ingest";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AsilPOS'un kasa zinciri (docs/ASILPOS.md › Kasa zinciri): bir günün devri, yani ertesi günün beklenen açılışı
 * `{ version: 1, date, nextOpening: { amount, source: "kasa_raporu" | TEL_KAYNAK } | null }` (TL; gün sonu yanıtındakiyle
 * aynı nesne). AsilPOS gün kapalıyken, en sık 5 dakikada bir sorar. Makine ucu: yalnız AsilPOS'un imzasıyla
 * (ASILPOS_SYNC_SECRET; sorgu imzaya girer), oturumla açılmaz; önbelleğe alınmaz. Anahtar yoksa 503, imza tutmazsa 401,
 * gün okunamazsa 400 `{ error: "invalid", field: "date" }`.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await servePosDevir(getDb(), {
      // Önbellekteki anahtar ön süzgeç: imza tutarsa anahtar veritabanından yeniden okunur (döndürülen eski anahtar geçmez)
      secret: await asilposRequestSecret(request),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[asilpos] devir okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

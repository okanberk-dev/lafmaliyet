import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { lafposSecret } from "@/server/lafpos/ingest";
import { serveModposDays } from "@/server/lafpos/modpos-gunler";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LafPOS'un ModPOS dönemi (docs/LAFPOS.md › ModPOS dönemi): `?sube=marina` için geçiş gününden önceki ModPOS günleri
 * (ciro, ödeme türleri, indirim, ödenmez, fiş, Z no, KDV) ve dönemin ModPOS ürün listesi
 * `{ version: 1, now, sube, switchDay, days, urunler }`. Makine ucu: yalnız LafPOS'un imzasıyla (LAFPOS_SYNC_SECRET),
 * oturumla açılmaz; önbelleğe alınmaz. Anahtar yoksa 503, imza tutmazsa 401, şube yoksa 400, başka şubeyse 409.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await serveModposDays({
      secret: lafposSecret(),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[lafpos] ModPOS dönemi okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

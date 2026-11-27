import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { posRequestCaller } from "@/server/asilpos/ingest";
import { serveModposDays } from "@/server/asilpos/modpos-gunler";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AsilPOS'un ModPOS dönemi (docs/ASILPOS.md › ModPOS dönemi): `?sube=marina` için geçiş gününden önceki ModPOS günleri
 * (ciro, ödeme türleri, indirim, ödenmez, fiş, Z no, KDV) ve dönemin ModPOS ürün listesi
 * `{ version: 1, now, sube, switchDay, days, urunler }`. Makine ucu: yalnız AsilPOS'un imzasıyla (ASILPOS_SYNC_SECRET),
 * oturumla açılmaz; önbelleğe alınmaz. Anahtar yoksa 503, imza tutmazsa 401, şube yoksa 400, başka şubeyse 409.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await serveModposDays({
      // Kasanın şubesi ve anahtarı (resolvePosCaller): imza önbellekteki anahtarla tutarsa anahtarlar yeniden okunur
      ...(await posRequestCaller(request)),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[asilpos] ModPOS dönemi okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

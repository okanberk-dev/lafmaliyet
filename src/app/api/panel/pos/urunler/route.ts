import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { lafposSecret } from "@/server/lafpos/ingest";
import { servePosProducts } from "@/server/lafpos/products";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LafPOS'un ürün maliyetleri (docs/LAFPOS.md › Ürün maliyetleri): siteye bağlı ürünlerin reçete birim maliyeti (kuruş,
 * KDV hariç) `{ version: 1, now, items: [{ siteMenuId, slot, name, size, costMinor, active }] }`. Makine ucu: yalnız
 * LafPOS'un imzasıyla (LAFPOS_SYNC_SECRET), oturumla açılmaz; önbelleğe alınmaz. Anahtar yoksa 503, imza tutmazsa 401.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await servePosProducts({
      secret: await lafposSecret(),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[lafpos] ürün maliyetleri okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

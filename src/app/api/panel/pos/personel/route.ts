import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { lafposSecret } from "@/server/lafpos/ingest";
import { servePosStaff } from "@/server/lafpos/personel";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LafPOS'un personel listesi (docs/LAFPOS.md › Personel bağlantısı): `?sube=marina` için şubenin bu ay ya da geçen ay
 * maaş hesabındaki satırları `{ version: 1, now, sube, items: [{ ref: "s:<id>", name, active, account }] }`; hesap başına
 * tek öğe; maaş, e-posta ve ay gitmez. LafPOS yalnız bağlantı ekranı isteyince sorar. Makine ucu: yalnız LafPOS'un
 * imzasıyla (LAFPOS_SYNC_SECRET; sorgu imzaya girer), oturumla açılmaz; önbelleğe alınmaz. Anahtar yoksa 503, imza
 * tutmazsa 401, şube yoksa 400, başka şubeyse 409.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await servePosStaff({
      secret: lafposSecret(),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[lafpos] personel listesi okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

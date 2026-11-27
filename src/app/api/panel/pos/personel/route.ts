import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { posRequestCaller } from "@/server/asilpos/ingest";
import { servePosStaff } from "@/server/asilpos/personel";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AsilPOS'un personel listesi (docs/ASILPOS.md › Personel bağlantısı): `?sube=marina` için şubenin bu ay ya da geçen ay
 * maaş hesabındaki satırları `{ version: 1, now, sube, items: [{ ref: "s:<id>", name, active, account }] }`; hesap başına
 * tek öğe; maaş, e-posta ve ay gitmez. AsilPOS yalnız bağlantı ekranı isteyince sorar. Makine ucu: yalnız AsilPOS'un
 * imzasıyla (ASILPOS_SYNC_SECRET; sorgu imzaya girer), oturumla açılmaz; önbelleğe alınmaz. Anahtar yoksa 503, imza
 * tutmazsa 401, şube yoksa 400, başka şubeyse 409.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await servePosStaff({
      // Kasanın şubesi ve anahtarı (resolvePosCaller): imza önbellekteki anahtarla tutarsa anahtarlar yeniden okunur
      ...(await posRequestCaller(request)),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[asilpos] personel listesi okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { getDb } from "@/server/db";
import { servePosExpenseCategories } from "@/server/asilpos/categories";
import { posRequestCaller } from "@/server/asilpos/ingest";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AsilPOS'un harcama kategorileri (docs/ASILPOS.md › Kasadan çıkanlar AsilPOS'tan): personelin seçebildiği gider
 * kategorileri `{ version: 1, now, items: [{ id, name, section }] }` (tutar yok). AsilPOS harcama penceresi açılınca, en
 * sık 5 dakikada bir sorar. Makine ucu: yalnız AsilPOS'un imzasıyla (ASILPOS_SYNC_SECRET), oturumla açılmaz; önbelleğe
 * alınmaz. Anahtar yoksa 503, imza tutmazsa 401.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await servePosExpenseCategories(getDb(), {
      // Kasanın şubesi ve anahtarı (resolvePosCaller): imza önbellekteki anahtarla tutarsa anahtarlar yeniden okunur
      ...(await posRequestCaller(request)),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[asilpos] gider kategorileri okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

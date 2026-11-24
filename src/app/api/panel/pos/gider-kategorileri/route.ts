import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { getDb } from "@/server/db";
import { servePosExpenseCategories } from "@/server/lafpos/categories";
import { lafposSecret } from "@/server/lafpos/ingest";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LafPOS'un harcama kategorileri (docs/LAFPOS.md › Kasadan çıkanlar LafPOS'tan): personelin seçebildiği gider
 * kategorileri `{ version: 1, now, items: [{ id, name, section }] }` (tutar yok). LafPOS harcama penceresi açılınca, en
 * sık 5 dakikada bir sorar. Makine ucu: yalnız LafPOS'un imzasıyla (LAFPOS_SYNC_SECRET), oturumla açılmaz; önbelleğe
 * alınmaz. Anahtar yoksa 503, imza tutmazsa 401.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const r = await servePosExpenseCategories(getDb(), {
      secret: lafposSecret(),
      url: new URL(request.url),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[lafpos] gider kategorileri okunamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

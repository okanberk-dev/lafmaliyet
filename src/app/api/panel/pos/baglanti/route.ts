import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { dagitilanBaglantilar } from "@/lib/asilpos/baglanti-dagitim";
import { checkAsilposRequest } from "@/lib/asilpos/request";
import { noteBaglantiRaporu } from "@/server/asilpos/anahtar-uyumu";
import { posRequestCaller } from "@/server/asilpos/ingest";
import { getDb } from "@/server/db";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Kasaların bağlantı bilgileri (docs/ASILPOS.md › Şube kurulumu › Anahtar değişimi): AsilPOS Uzaktan ve site adresi ile
 * anahtarı, panelin ortamından (`ASILPOS_CLOUD_URL` + `ASILPOS_CLOUD_SECRET`, `ASILPOS_SITE_URL` + `ASILPOS_SITE_SECRET`).
 * Kasa 10 dakikada bir sorar; değer değiştiyse saklar ve gün kapanınca ayarlar dosyasına yazar. Yanıt
 * `{ ok: true, surum, baglanti }`. Yalnız AsilPOS'un imzasıyla (ASILPOS_SYNC_SECRET; sorgu imzaya girer): anahtar yoksa
 * 503, imza tutmazsa 401. Günlüğe anahtarın şubesi (çok şube: kasa imzasının tuttuğu anahtardan), sorgudaki `sube` ve
 * `uygulanan` (kasanın yazdığı sürüm) düşer: anahtar değişiminden önce kasanın yenisini aldığı buradan görülür. Bağlantılar
 * şubeye göre değişmez. Yanıttan sonra (`after`) kasanın uyguladığı ve güncel sürüm şubenin satırına yazılır; bu değerler
 * son bir saatte sınanmadıysa (kasanın raporu değişmese de) Uzaktan ve site panelin anahtarıyla sınanır
 * (src/server/asilpos/anahtar-uyumu.ts noteBaglantiRaporu): reddeden uç Ayarlar › AsilPOS'ta ve zilde uyarı olur
 */
export async function GET(request: NextRequest) {
  await connection();
  const url = new URL(request.url);
  const caller = await posRequestCaller(request);
  const check = checkAsilposRequest({
    secret: caller.secret,
    method: "GET",
    url,
    body: "",
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    maxBytes: 0,
  });
  if (!check.ok || caller.branchId === null) return Response.json({ error: check.ok ? "unauthorized" : check.error }, { status: check.ok ? 401 : check.status, headers: NO_STORE });
  const out = dagitilanBaglantilar();
  const sube = (url.searchParams.get("sube") ?? "?").slice(0, 24);
  const uygulanan = (url.searchParams.get("uygulanan") ?? "").slice(0, 16);
  console.info(`[asilpos baglanti] anahtar=${caller.branchId} sube=${sube} uygulanan=${uygulanan || "-"} guncel=${out.surum || "-"}`);
  const branchId = caller.branchId;
  if (out.surum) after(() => noteBaglantiRaporu(getDb(), branchId, { uygulanan, guncel: out.surum }));
  return Response.json({ ok: true, ...out }, { headers: NO_STORE });
}

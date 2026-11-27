import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { dagitilanBaglantilar } from "@/lib/asilpos/baglanti-dagitim";
import { checkAsilposRequest } from "@/lib/asilpos/request";
import { asilposRequestSecret } from "@/server/asilpos/ingest";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Kasaların bağlantı bilgileri (docs/ASILPOS.md › Şube kurulumu › Anahtar değişimi): AsilPOS Uzaktan ve site adresi ile
 * anahtarı, panelin ortamından (`ASILPOS_CLOUD_URL` + `ASILPOS_CLOUD_SECRET`, `ASILPOS_SITE_URL` + `ASILPOS_SITE_SECRET`).
 * Kasa 10 dakikada bir sorar; değer değiştiyse saklar ve gün kapanınca ayarlar dosyasına yazar. Yanıt
 * `{ ok: true, surum, baglanti }`. Yalnız AsilPOS'un imzasıyla (ASILPOS_SYNC_SECRET; sorgu imzaya girer): anahtar yoksa
 * 503, imza tutmazsa 401. Sorgudaki `uygulanan` (kasanın yazdığı sürüm) ve `sube` günlüğe düşer: anahtar değişiminden
 * önce kasanın yenisini aldığı buradan görülür
 */
export async function GET(request: NextRequest) {
  await connection();
  const url = new URL(request.url);
  const check = checkAsilposRequest({
    secret: await asilposRequestSecret(request),
    method: "GET",
    url,
    body: "",
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    maxBytes: 0,
  });
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status, headers: NO_STORE });
  const out = dagitilanBaglantilar();
  const sube = (url.searchParams.get("sube") ?? "?").slice(0, 24);
  const uygulanan = (url.searchParams.get("uygulanan") ?? "").slice(0, 16);
  console.info(`[asilpos baglanti] sube=${sube} uygulanan=${uygulanan || "-"} guncel=${out.surum || "-"}`);
  return Response.json({ ok: true, ...out }, { headers: NO_STORE });
}

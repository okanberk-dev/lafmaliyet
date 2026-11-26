import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { dagitilanBaglantilar } from "@/lib/lafpos/baglanti-dagitim";
import { checkLafposRequest } from "@/lib/lafpos/request";
import { lafposRequestSecret } from "@/server/lafpos/ingest";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Kasaların bağlantı bilgileri (docs/LAFPOS.md › Şube kurulumu › Anahtar değişimi): LafPOS Uzaktan ve site adresi ile
 * anahtarı, panelin ortamından (`LAFPOS_CLOUD_URL` + `LAFPOS_CLOUD_SECRET`, `LAFPOS_SITE_URL` + `LAFPOS_SITE_SECRET`).
 * Kasa 10 dakikada bir sorar; değer değiştiyse saklar ve gün kapanınca ayarlar dosyasına yazar. Yanıt
 * `{ ok: true, surum, baglanti }`. Yalnız LafPOS'un imzasıyla (LAFPOS_SYNC_SECRET; sorgu imzaya girer): anahtar yoksa
 * 503, imza tutmazsa 401. Sorgudaki `uygulanan` (kasanın yazdığı sürüm) ve `sube` günlüğe düşer: anahtar değişiminden
 * önce kasanın yenisini aldığı buradan görülür
 */
export async function GET(request: NextRequest) {
  await connection();
  const url = new URL(request.url);
  const check = checkLafposRequest({
    secret: await lafposRequestSecret(request),
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
  console.info(`[lafpos baglanti] sube=${sube} uygulanan=${uygulanan || "-"} guncel=${out.surum || "-"}`);
  return Response.json({ ok: true, ...out }, { headers: NO_STORE });
}

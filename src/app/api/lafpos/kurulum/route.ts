import { connection, type NextRequest } from "next/server";

import { KOD_RE } from "@/lib/lafpos/kurulum";
import { clientIp, createLimiter } from "@/server/auth/rate-limit";
import { redeemInstallCode } from "@/server/lafpos/kurulum";

const NO_STORE = { "Cache-Control": "no-store" };
/** Kod tahmini olanaksız (32 bayt) ama uç herkese açık: IP başına 15 dakikada 20 deneme */
const ipLimit = createLimiter({ limit: 20, windowMs: 15 * 60_000 });

/**
 * Şube kurulumu (docs/LAFPOS.md › Şube kurulumu): ladmin'in şubeye özel kurucusuyla kurulan kasa ilk açılışta
 * tek kullanımlık kodu verir; yanıt şube (kimlik, ad) ve kasanın bağlantı bilgileri (lafmaliyet adresi ve anahtarı;
 * tanımlıysa LafPOS Uzaktan ve site). 400 gövde, 404 kod yok, 410 kullanılmış / iptal / süresi dolmuş, 429 çok deneme.
 * Kasa tarafı: lafpos `server/sync/kurulum-kodu.ts`
 */
export async function POST(request: NextRequest) {
  await connection();
  const ip = clientIp(request.headers);
  if (!ipLimit.hit(ip)) return Response.json({ ok: false, error: "Çok fazla deneme; biraz sonra yeniden deneyin" }, { status: 429, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { kod?: unknown } | null;
  const kod = typeof body?.kod === "string" ? body.kod : "";
  if (!KOD_RE.test(kod)) return Response.json({ ok: false, error: "Kurulum kodu anlaşılamadı" }, { status: 400, headers: NO_STORE });
  const res = await redeemInstallCode(kod);
  if (res.status === 200) ipLimit.undo(ip);
  return Response.json(res.body, { status: res.status, headers: NO_STORE });
}

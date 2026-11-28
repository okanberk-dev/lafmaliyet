import "server-only";

import { connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { clientIp, createLimiter } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db";
import { posRequestCaller } from "@/server/asilpos/branch";
import { ACILIS_MAX_BYTES, acilisBagla, acilisGiris, acilisTeslim, type Yanit } from "@/server/asilpos/acilis";

// Kasa açılışının üç ucu (docs/ASILPOS.md › Kasa açılışı); işleyiciler src/server/asilpos/acilis.ts'te. Oturumsuz
// (proxy bu yolları kapsamaz), çerez yazmaz, önbelleğe alınmaz. Gövde en çok 4 KB (teslim 1 KB).

const NO_STORE = { "Cache-Control": "no-store" };
const json = (r: Yanit) => Response.json(r.body, { status: r.status, headers: NO_STORE });
/** Bağla ucu: IP başına 15 dakikada 30 istek (belirteç tahmin edilemez; yine de sınırsız deneme olmasın) */
const baglaIp = createLimiter({ limit: 30, windowMs: 15 * 60_000 });
/** Teslim ucu: IP başına 15 dakikada 30 istek */
const teslimIp = createLimiter({ limit: 30, windowMs: 15 * 60_000 });

/** Gövde: en çok `max` bayt, JSON; boş gövde `{}`. Okunamazsa null */
async function readBody(request: NextRequest, max: number): Promise<{ text: string; value: unknown } | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > max) return null;
  if (!text.trim()) return { text, value: {} };
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

/** İstek bir şubenin kasa anahtarıyla da imzalıysa o şube ("bu kasa"); imza başlıkları yoksa veritabanına bakılmaz */
async function signedBranch(request: NextRequest, body: string): Promise<string | null> {
  if (!request.headers.get(SIGNATURE_HEADER) || !request.headers.get(TIMESTAMP_HEADER)) return null;
  return (await posRequestCaller(request, body)).branchId;
}

const bozuk = () => json({ status: 400, body: { ok: false, error: "gecersiz", mesaj: "İstek anlaşılmadı" } });

/** POST /api/asilpos/acilis/giris */
export async function girisPOST(request: NextRequest) {
  await connection();
  const body = await readBody(request, ACILIS_MAX_BYTES);
  if (!body) return bozuk();
  try {
    return json(await acilisGiris({ body: body.value, ip: clientIp(request.headers), imzaSubesi: await signedBranch(request, body.text) }));
  } catch (e) {
    console.error("[asilpos] kasa açılışı girişi:", e instanceof Error ? e.message : "hata");
    return json({ status: 500, body: { ok: false, error: "sunucu", mesaj: "ladmin şu an yanıt veremedi; biraz sonra yeniden deneyin" } });
  }
}

/** POST /api/asilpos/acilis/bagla */
export async function baglaPOST(request: NextRequest) {
  await connection();
  const ip = clientIp(request.headers);
  if (!baglaIp.hit(ip)) return json({ status: 429, body: { ok: false, error: "cok_deneme", mesaj: "Çok fazla deneme; biraz sonra yeniden deneyin" } });
  const body = await readBody(request, ACILIS_MAX_BYTES);
  if (!body) return bozuk();
  try {
    return json(await acilisBagla({ body: body.value, imzaSubesi: await signedBranch(request, body.text) }));
  } catch (e) {
    console.error("[asilpos] kasa açılışı bağlama:", e instanceof Error ? e.message : "hata");
    return json({ status: 500, body: { ok: false, error: "sunucu", mesaj: "ladmin şu an yanıt veremedi; biraz sonra yeniden deneyin" } });
  }
}

/** POST /api/asilpos/acilis/teslim (şube anahtarıyla imzalı) */
export async function teslimPOST(request: NextRequest) {
  await connection();
  const ip = clientIp(request.headers);
  if (!teslimIp.hit(ip)) return json({ status: 429, body: { ok: false, error: "cok_deneme", mesaj: "Çok fazla deneme; biraz sonra yeniden deneyin" } });
  const body = await readBody(request, 1024);
  if (!body || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) return bozuk();
  try {
    const caller = await posRequestCaller(request, body.text);
    if (!caller.secret) return json({ status: 503, body: { ok: false, error: "not_configured", mesaj: "Hiçbir kasanın anahtarı yok" } });
    if (!caller.branchId) return json({ status: 401, body: { ok: false, error: "unauthorized", mesaj: "İmza tutmadı" } });
    return json(await acilisTeslim(caller.branchId, getDb()));
  } catch (e) {
    console.error("[asilpos] ilk personel teslimi:", e instanceof Error ? e.message : "hata");
    return json({ status: 500, body: { ok: false, error: "sunucu", mesaj: "ladmin şu an yanıt veremedi; biraz sonra yeniden deneyin" } });
  }
}

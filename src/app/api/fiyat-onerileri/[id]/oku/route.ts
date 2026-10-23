import { connection } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { readHold } from "@/server/invoice-reading/hold";
import { sameOrigin } from "@/server/same-origin";

/**
 * Onay bekleyen fiyat kartının kendiliğinden okuması (POST /api/fiyat-onerileri/{id}/oku; yalnız yönetici). Sunucu
 * eylemi değil: Next eylemleri istemci başına tek tek yollar, 55 sn'ye varan okuma sayfadaki Onayla / Reddet'i
 * bekletirdi. Yalnız `auto` kipi: saklanan okuma ya da okunamama nedeni varsa yeniden sorulmaz, günlük sınırın
 * fotoğraflara ayrılan payına dokunmaz (src/server/invoice-reading/read.ts). Kart bitince sayfayı tazeler.
 */
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!sameOrigin(request)) return Response.json({ error: "Geçersiz istek" }, { status: 403 });
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Geçersiz istek" }, { status: 400 });
  try {
    const out = await readHold(me, id, "auto");
    return Response.json({ status: out.status }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[fatura] kendiliğinden okuma", id, e instanceof Error ? e.message : e);
    return Response.json({ error: "Fatura okunamadı" }, { status: 500 });
  }
}

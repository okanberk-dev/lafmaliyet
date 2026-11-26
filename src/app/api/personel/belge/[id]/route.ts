import { connection, type NextRequest } from "next/server";

import { contentDisposition } from "@/lib/documents";
import { getCurrentUser } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { DOC_NOT_FOUND_TEXT, readStaffDocFile } from "@/server/staff-docs";
import { UserError } from "@/server/user-error";

/**
 * Personel belgesinin dosyası (yalnız yönetici; docs/PERSONEL-BELGE.md):
 * - GET /api/personel/belge/{id}          → tarayıcı içinde açılır
 * - GET /api/personel/belge/{id}?indir=1  → indirme
 * Depoya hiçbir zaman yönlendirmez. Tarayıcı saklamaz (no-store): ortak bilgisayarda yönetici çıkış yaptıktan sonra
 * personel geçmişten sağlık raporunu açamasın. Fotoğraf belge olarak açılırsa hiçbir şey çalıştırmaz (CSP sandbox); PDF
 * tarayıcının kendi görüntüleyicisinde açılır (sandbox onu da kapatırdı).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın." }, { status: 401 });
  if (me.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: DOC_NOT_FOUND_TEXT }, { status: 404 });
  try {
    const file = await readStaffDocFile(getDb(), id);
    if (!file) return Response.json({ error: DOC_NOT_FOUND_TEXT }, { status: 404 });
    const pdf = file.contentType === "application/pdf";
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(pdf ? {} : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
        "Content-Disposition": contentDisposition(request.nextUrl.searchParams.get("indir") ? "attachment" : "inline", file.fileName),
      },
    });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 503 });
    console.error("[personel-belge] okunamadı", id, e instanceof Error ? e.message : e);
    return Response.json({ error: "Belge açılamadı; biraz sonra yeniden deneyin." }, { status: 500 });
  }
}

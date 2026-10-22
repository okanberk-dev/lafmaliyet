import { connection, type NextRequest } from "next/server";

import { contentDisposition } from "@/lib/documents";
import { photoExt, type PhotoMime } from "@/lib/photo-rules";
import { getCurrentUser } from "@/server/auth/dal";
import { canViewPhoto, FORBIDDEN_TEXT } from "@/server/storage/photo-access";
import { getPhoto, NOT_FOUND_TEXT, PhotoError, readPhoto } from "@/server/storage/photos";

/**
 * Fotoğrafın kendisi (GET /api/foto/{id}): panelde fotoğrafın tek adresi. Giriş, sonra türün kuralı (yönetici hepsini,
 * personel yalnız hâlâ düzenleyebildiği günleri görür), sonra baytlar. Blob'a hiçbir zaman yönlendirmez. Yanıt özel
 * önbellekli (bir saat), tür koklanmaz, belge olarak açılırsa hiçbir şey çalıştırmaz (CSP sandbox).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: NOT_FOUND_TEXT }, { status: 404 });
  const photo = await getPhoto(id);
  if (!photo || (photo.expiresAt && photo.expiresAt.getTime() <= Date.now())) return Response.json({ error: NOT_FOUND_TEXT }, { status: 404 });
  if (!(await canViewPhoto(me, photo))) return Response.json({ error: FORBIDDEN_TEXT }, { status: 403 });
  try {
    const file = await readPhoto(id);
    if (!file) return Response.json({ error: NOT_FOUND_TEXT }, { status: 404 });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": contentDisposition("inline", `foto-${id}.${photoExt(file.contentType as PhotoMime)}`),
      },
    });
  } catch (e) {
    if (e instanceof PhotoError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[foto] okunamadı", id, e instanceof Error ? e.message : e);
    return Response.json({ error: "Fotoğraf açılamadı; biraz sonra yeniden deneyin." }, { status: 500 });
  }
}

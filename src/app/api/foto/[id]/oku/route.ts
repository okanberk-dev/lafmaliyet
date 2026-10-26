import { connection, type NextRequest } from "next/server";
import { z } from "zod";

import { validDay } from "@/lib/photo-read/common";
import { photoUrl, type PhotoKind, type PhotoMime } from "@/lib/photo-rules";
import { getCurrentUser } from "@/server/auth/dal";
import { readPhotoFor } from "@/server/photo-read/read";
import { canUploadPhoto } from "@/server/photo-read/rules";
import { sameOrigin } from "@/server/same-origin";
import { FORBIDDEN_TEXT } from "@/server/storage/photo-access";
import { getPhoto, linkable, NOT_FOUND_TEXT, PhotoError, readPhoto, setPhotoKind } from "@/server/storage/photos";

/**
 * Saklanmış ama henüz bir kayda bağlanmamış fotoğrafı yeniden okur (POST /api/foto/{id}/oku, JSON { tur, gun }):
 * "Yeniden dene" ve yanlış bölüme okutulan fişi öteki bölüme okutma (ModPOS Z ↔ yazarkasa Z; fotoğrafın türü değişir).
 * Yalnız yükleyen ya da yönetici; bir fotoğraf en çok 3 kez okunur.
 *
 * Geçiş (docs/planlar/okc-z.md D2): eski sayfanın `{ tur: "kasa-pos" }` isteği reddedilmez; fotoğraf `kasa-okc` yapılır,
 * yazarkasa Z'si olarak okunur ve yanıt eski biçimde döner (tür "kasa-pos", değerde yalnız banka gün sonu fişinin neti).
 */
export const maxDuration = 60;

const body = z.object({ tur: z.enum(["kasa-z", "kasa-okc", "kasa-pos", "fis"]), gun: z.string() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!sameOrigin(request)) return Response.json({ error: "Geçersiz istek" }, { status: 403 });
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın." }, { status: 401 });
  const id = Number((await params).id);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || id <= 0 || !parsed.success || !validDay(parsed.data.gun)) return Response.json({ error: "Geçersiz istek" }, { status: 400 });
  const { tur: kind, gun: day } = parsed.data;
  const photo = await getPhoto(id);
  if (!photo || !linkable(photo)) return Response.json({ error: NOT_FOUND_TEXT }, { status: 404 });
  if (me.role !== "admin" && photo.createdBy !== me.id) return Response.json({ error: FORBIDDEN_TEXT }, { status: 403 });
  // Kasa fotoğrafı ModPOS Z ile yazarkasa Z arasında değişebilir (eski kasa-pos → kasa-okc); fiş fiş kalır
  const cash = (k: string) => k === "kasa-z" || k === "kasa-pos" || k === "kasa-okc";
  const target: PhotoKind = kind === "kasa-pos" ? "kasa-okc" : kind;
  if (cash(photo.kind) !== cash(kind) || photo.kind === "kontrol") return Response.json({ error: "Geçersiz istek" }, { status: 400 });
  if (!(await canUploadPhoto(me, kind, day))) return Response.json({ error: "Bu gün için fotoğraf ekleyemezsiniz." }, { status: 403 });
  try {
    const file = await readPhoto(id);
    if (!file) return Response.json({ error: NOT_FOUND_TEXT }, { status: 404 });
    if (target !== photo.kind) await setPhotoKind(id, target);
    const out = await readPhotoFor(kind, { photoId: id, bytes: file.bytes, contentType: file.contentType as PhotoMime, day, me });
    return Response.json({ ok: true, photo: { id, kind, url: photoUrl(id) }, ...out });
  } catch (e) {
    if (e instanceof PhotoError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[foto] yeniden okuma", id, e instanceof Error ? e.message : e);
    return Response.json({ error: "Fotoğraf okunamadı; rakamları elle yazın." }, { status: 500 });
  }
}

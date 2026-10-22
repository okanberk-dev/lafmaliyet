import { connection, type NextRequest } from "next/server";

import { sniffMime } from "@/lib/documents";
import { validDay } from "@/lib/photo-read/common";
import { isPhotoKind, MAX_PHOTO_BYTES, PHOTO_MIMES, photoUrl, UPLOADS_PER_HOUR, type PhotoMime } from "@/lib/photo-rules";
import { getCurrentUser } from "@/server/auth/dal";
import { readPhotoFor, type ReadOutcome } from "@/server/photo-read/read";
import { canUploadPhoto } from "@/server/photo-read/rules";
import { sameOrigin } from "@/server/same-origin";
import { PhotoError, recentUploads, savePhoto } from "@/server/storage/photos";

/**
 * Fotoğraf yükleme ve ilk okuma tek istekte (POST /api/foto, form: dosya, tur, gun, oku=1). Okuma başarısız olsa da
 * fotoğraf saklanır (yanıtta readError); personel rakamları elle yazar ya da /api/foto/{id}/oku ile yeniden dener.
 * Fotoğraf telefonda 1600 px JPEG'e küçültülmüş gelir; boyut, tür ve ölçü savePhoto'da denetlenir. Okuma en çok 45 sn.
 */
export const maxDuration = 60;

const TOO_BIG = "Fotoğraf 2 MB'tan büyük; uygulama küçültemedi, yeniden deneyin.";
const BAD_FORM = "Fotoğraf okunamadı. Yeniden çekin.";

const NO_READING: ReadOutcome = { reading: null, readError: null, readCode: null, canRetry: false };

export async function POST(request: NextRequest) {
  await connection();
  if (!sameOrigin(request)) return Response.json({ error: "Geçersiz istek" }, { status: 403 });
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın." }, { status: 401 });
  // Gövde okunmadan: 2 MB'tan çok büyük istek belleğe alınmasın (form alanlarına pay bırakılır)
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES + 64 * 1024) return Response.json({ error: TOO_BIG }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: BAD_FORM }, { status: 400 });
  }
  const file = form.get("dosya");
  const kind = form.get("tur");
  const gun = form.get("gun");
  const day = typeof gun === "string" && validDay(gun) ? gun : null;
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: BAD_FORM }, { status: 400 });
  if (!isPhotoKind(kind) || kind === "kontrol") return Response.json({ error: "Geçersiz fotoğraf türü." }, { status: 400 });
  if (!canUploadPhoto(me, kind, day)) return Response.json({ error: "Bu gün için fotoğraf ekleyemezsiniz." }, { status: 403 });
  if ((await recentUploads(me.id)) >= UPLOADS_PER_HOUR) {
    return Response.json({ error: "Kısa sürede çok fotoğraf yüklendi; biraz sonra yeniden deneyin." }, { status: 429 });
  }
  if (file.size > MAX_PHOTO_BYTES) return Response.json({ error: TOO_BIG }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Tür içerikten (tarayıcının söylediğine güvenilmez)
  const mime = sniffMime(bytes);
  if (!mime || !(PHOTO_MIMES as readonly string[]).includes(mime)) return Response.json({ error: "Yalnız JPG, PNG ya da WebP fotoğraf eklenebilir." }, { status: 415 });
  let id: number;
  try {
    ({ id } = await savePhoto({ kind, bytes, contentType: mime as PhotoMime, userId: me.id }));
  } catch (e) {
    if (e instanceof PhotoError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[foto] kaydedilemedi", e);
    return Response.json({ error: "Fotoğraf kaydedilemedi; yeniden deneyin." }, { status: 500 });
  }
  let out = NO_READING;
  if (form.get("oku") === "1") {
    try {
      out = await readPhotoFor(kind, { photoId: id, bytes, contentType: mime as PhotoMime, day: day!, me });
    } catch (e) {
      console.error("[foto] okuma", e instanceof Error ? e.message : e);
      out = { reading: null, readError: "Fotoğraf okunamadı; rakamları elle yazın.", readCode: null, canRetry: true };
    }
  }
  return Response.json({ ok: true, photo: { id, kind, url: photoUrl(id) }, ...out });
}

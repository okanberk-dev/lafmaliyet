import { after, connection, type NextRequest } from "next/server";
import { z } from "zod";

import { MAX_PHOTO_BYTES, PHOTO_MIMES, UPLOADS_PER_HOUR, type PhotoMime } from "@/lib/photo-rules";
import { can, READ_ONLY_TEXT } from "@/lib/roles";
import { getCurrentUser } from "@/server/auth/dal";
import { ChecklistError, checkPhotoTarget, logAnswerActivity, writeChecklistAnswer, type WriteResult } from "@/server/data/checklists";
import { sameOrigin } from "@/server/same-origin";
import { deletePhoto, PhotoError, recentUploads, savePhoto } from "@/server/storage/photos";

/**
 * Kontrol listesinin fotoğrafı (POST /api/kontrol/foto; form: foto, templateId, date, itemId): fotoğraf saklanır ve
 * yanıt aynı istekte yazılır. Sunucu eylemleri istemcide sırayla gider; yavaş bağlantıda bir fotoğraf her işareti
 * bekletmesin diye fotoğraf bu yoldan, ayrı istekle gelir. Fotoğraf telefonda JPEG'e küçültülmüş gelir
 * (photo-compress PHOTO_COMPRESS); boyut, tür ve ölçü savePhoto'da denetlenir. Fotoğraf bağlanmamış (2 günlük)
 * saklanır, yanıt yazılırken aynı işlemde 60 gün için bağlanır; yanıt yazılamazsa fotoğraf hemen silinir, yerine
 * çekilen eski fotoğraf yanıttan sonra silinir. Yanıtta fotoğraf adresi yok: panel /api/foto/{id}'den gösterir.
 */
export const maxDuration = 30;

const TOO_BIG = "Fotoğraf 2 MB'tan büyük; uygulama küçültemedi, yeniden deneyin.";
const BAD_FORM = "Fotoğraf okunamadı; yeniden çekin.";

const fields = z.object({
  templateId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemId: z.coerce.number().int().positive(),
});

const log = (what: string, id: number) => (e: unknown) => console.error(`[kontrol] ${what}`, id, e instanceof Error ? e.message : e);

export async function POST(request: NextRequest) {
  await connection();
  // Yol işleyicileri sunucu eylemlerinin köken denetimini almaz
  if (!sameOrigin(request)) return Response.json({ error: "Geçersiz istek" }, { status: 403 });
  // Proxy /api/kontrol'ü kapsamaz: giriş burada
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın." }, { status: 401 });
  // Muhasebeci salt okur (docs/ROLLER.md): fotoğraf yükleyemez
  if (!can(me.role, "kayit.yaz")) return Response.json({ error: READ_ONLY_TEXT }, { status: 403 });
  // Gövde okunmadan: 2 MB'tan çok büyük istek belleğe alınmasın (form alanlarına pay bırakılır)
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES + 64 * 1024) return Response.json({ error: TOO_BIG }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: BAD_FORM }, { status: 400 });
  }
  const parsed = fields.safeParse({ templateId: form.get("templateId"), date: form.get("date"), itemId: form.get("itemId") });
  if (!parsed.success) return Response.json({ error: "Liste değişti; sayfayı yenileyin." }, { status: 400 });
  const target = parsed.data;
  const file = form.get("foto");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Fotoğraf seçin" }, { status: 400 });

  const now = new Date();
  try {
    // Olmayacak bir yanıt için fotoğraf depoya girmesin (liste kapalı, gün kapandı, madde değişti…)
    await checkPhotoTarget(me, target, now);
  } catch (e) {
    if (e instanceof ChecklistError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[kontrol] fotoğrafın maddesi okunamadı", e);
    return Response.json({ error: "Fotoğraf kaydedilemedi; tekrar deneyin." }, { status: 500 });
  }
  if ((await recentUploads(me.id)) >= UPLOADS_PER_HOUR) {
    return Response.json({ error: "Kısa sürede çok fotoğraf yüklendi; biraz sonra yeniden deneyin." }, { status: 429 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Tür içerikten denetlenir (savePhoto); tarayıcının söylediği yalnız karşılaştırma için
  const contentType: PhotoMime = (PHOTO_MIMES as readonly string[]).includes(file.type) ? (file.type as PhotoMime) : "image/jpeg";
  let photoId: number;
  try {
    ({ id: photoId } = await savePhoto({ kind: "kontrol", bytes, contentType, userId: me.id }));
  } catch (e) {
    if (e instanceof PhotoError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[kontrol] fotoğraf kaydedilemedi", e);
    return Response.json({ error: "Fotoğraf kaydedilemedi; tekrar deneyin." }, { status: 500 });
  }

  let r: WriteResult;
  try {
    r = await writeChecklistAnswer(me, { op: "photo", photoId, ...target }, now);
  } catch (e) {
    await deletePhoto(photoId).catch(log("yazılamayan yanıtın fotoğrafı silinemedi", photoId));
    if (e instanceof ChecklistError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[kontrol] yanıt yazılamadı", e);
    return Response.json({ error: "Fotoğraf kaydedilemedi; tekrar deneyin." }, { status: 500 });
  }
  // Yeniden çekilen fotoğrafın eskisi yanıttan sonra
  const old = r.previousPhotoId;
  if (old) after(() => deletePhoto(old).catch(log("eski fotoğraf silinemedi", old)));
  await logAnswerActivity(me, r);
  return Response.json({ ok: true, answer: r.answer, summary: r.summary, completedNow: r.completedNow });
}

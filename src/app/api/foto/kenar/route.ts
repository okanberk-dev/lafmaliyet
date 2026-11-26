import { connection, type NextRequest } from "next/server";

import { HINT_MAX_BYTES } from "@/lib/photo-scan";
import { getCurrentUser } from "@/server/auth/dal";
import { scanHintFor } from "@/server/photo-read/scan-hint";
import { sameOrigin } from "@/server/same-origin";

/**
 * Belge taramada yapay zekânın köşe ipucu (POST /api/foto/kenar, form: dosya = en çok 1024 px JPEG): belge mi, kâğıdın
 * dört köşesi (0–1000), üst kenar. Telefondaki kod emin değilken ve okuma açıkken sorulur; yanıt `{ ok: true, hint }`
 * ya da `{ ok: false }` (anahtar yok, okuma kapalı, sınır doldu, servis hatası: tarama kodun sonucuyla sürer, ekranda
 * hata çıkmaz). Görüntü saklanmaz. Ayrıntı: src/server/photo-read/scan-hint.ts, docs/FOTOGRAF.md › Belge tarama.
 */
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  await connection();
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "Geçersiz istek" }, { status: 403 });
  const me = await getCurrentUser();
  if (!me) return Response.json({ ok: false, error: "Oturum kapanmış" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > HINT_MAX_BYTES + 16 * 1024) return Response.json({ ok: false, error: "Görüntü çok büyük." }, { status: 413 });
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("dosya");
  } catch {
    return Response.json({ ok: false, error: "Geçersiz istek" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0 || file.size > HINT_MAX_BYTES) return Response.json({ ok: false, error: "Geçersiz görüntü" }, { status: 400 });
  try {
    const out = await scanHintFor({ bytes: new Uint8Array(await file.arrayBuffer()), userId: me.id });
    if (!out.ok) return Response.json({ ok: false, error: out.error }, { status: out.status });
    return Response.json({ ok: true, hint: out.hint });
  } catch (e) {
    console.error("[tarama] köşe ipucu", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "Köşe ipucu alınamadı" }, { status: 500 });
  }
}

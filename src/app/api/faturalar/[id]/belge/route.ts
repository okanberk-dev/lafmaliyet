import { connection, type NextRequest } from "next/server";

import { contentDisposition, MAX_UPLOAD_BYTES, sniffMime } from "@/lib/documents";
import { logActivity } from "@/server/actions/log";
import { getCurrentUser } from "@/server/auth/dal";
import { DocumentError, getInvoiceDocument, storeUpload } from "@/server/documents";
import { ParasutError } from "@/server/parasut/client";
import { sameOrigin } from "@/server/same-origin";

/**
 * Fatura belgesi (yalnız yönetici):
 * - GET  /api/faturalar/{id}/belge            → belge (önizleme; tarayıcı içinde açılır)
 * - GET  /api/faturalar/{id}/belge?indir=1    → indirme
 * - GET  /api/faturalar/{id}/belge?belge={n}  → belirli bir yüklenmiş dosya
 * - POST /api/faturalar/{id}/belge  (form "dosya") → PDF ya da fotoğraf yükler (en çok 4 MB; tür içerikten denetlenir)
 * Paraşüt e-fatura PDF'i ilk açılışta Paraşüt'ten indirilip saklanır; sonraki açılışlar anında gelir.
 */
export const maxDuration = 30;

async function admin() {
  const me = await getCurrentUser();
  return me && me.role === "admin" ? me : null;
}

function invoiceIdOf(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!(await admin())) return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const invoiceId = invoiceIdOf((await params).id);
  if (!invoiceId) return Response.json({ error: "Geçersiz fatura" }, { status: 400 });
  const sp = request.nextUrl.searchParams;
  const docId = sp.get("belge") ? Number(sp.get("belge")) : null;
  try {
    const doc = await getInvoiceDocument(invoiceId, docId && Number.isInteger(docId) && docId > 0 ? docId : null);
    return new Response(new Uint8Array(doc.bytes), {
      headers: {
        "Content-Type": doc.mime,
        "Content-Length": String(doc.bytes.length),
        "Content-Disposition": contentDisposition(sp.get("indir") ? "attachment" : "inline", doc.fileName),
        "Cache-Control": "private, max-age=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DocumentError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof ParasutError) return Response.json({ error: `Paraşüt'ten alınamadı: ${e.message}` }, { status: 502 });
    console.error("Fatura belgesi", e);
    return Response.json({ error: "Belge açılamadı; biraz sonra yeniden deneyin." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!sameOrigin(request)) return Response.json({ error: "Geçersiz istek" }, { status: 403 });
  const me = await admin();
  if (!me) return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const invoiceId = invoiceIdOf((await params).id);
  if (!invoiceId) return Response.json({ error: "Geçersiz fatura" }, { status: 400 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Dosya okunamadı. 4 MB'tan küçük bir PDF ya da fotoğraf seçin." }, { status: 400 });
  }
  const file = form.get("dosya");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Dosya seçin" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "Dosya 4 MB'tan büyük; fotoğrafı küçültüp yeniden deneyin." }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) return Response.json({ error: "Yalnız PDF, JPG, PNG ya da WebP yüklenebilir." }, { status: 415 });
  try {
    const doc = await storeUpload(invoiceId, { bytes, mime, originalName: file.name || null }, me.name);
    await logActivity(me, "Fatura belgesi eklendi", doc.fileName);
    return Response.json({ ok: true, document: doc });
  } catch (e) {
    if (e instanceof DocumentError) return Response.json({ error: e.message }, { status: e.status });
    console.error("Fatura belgesi yükleme", e);
    return Response.json({ error: "Dosya kaydedilemedi; yeniden deneyin." }, { status: 500 });
  }
}

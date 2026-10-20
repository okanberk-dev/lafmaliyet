/**
 * Tarayıcıda belge işleri: fotoğrafı JPEG'e küçültme, POST /api/faturalar/{id}/belge ile yükleme, önizleme için
 * indirme. Kurallar (ne küçültülür, hata metinleri) document-rules.ts'te; burası yalnızca tarayıcı API'lerini kullanır.
 */
import type { DocumentMeta } from "@/server/documents";

import {
  documentErrorText,
  documentKind,
  documentUrl,
  fileNameFromDisposition,
  fitWithin,
  isRetryable,
  JPEG_QUALITY,
  jpegName,
  sizeError,
  uploadErrorText,
  uploadPlan,
} from "./document-rules";

export type Prepared = { ok: true; file: File; compressed: boolean } | { ok: false; error: string };

/** Görseli çözer; iOS ve Android'de çekilen fotoğrafın yönü (EXIF) tarayıcıda zaten uygulanır */
async function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

/** En uzun kenarı 2000px'i aşmayan JPEG; saydam alan beyaz olur */
async function toJpeg(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("toBlob");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Seçilen dosyayı yüklemeye hazırlar: PDF ve küçük JPEG olduğu gibi, diğer fotoğraflar küçültülerek */
export async function prepareDocument(file: File): Promise<Prepared> {
  const plan = uploadPlan(file);
  if (plan.action === "reject") return { ok: false, error: plan.error };
  if (plan.action === "send") return { ok: true, file, compressed: false };
  let blob: Blob;
  try {
    blob = await toJpeg(file);
  } catch {
    return { ok: false, error: "Fotoğraf açılamadı. JPG, PNG ya da PDF seçin (iPhone'da Ayarlar › Kamera › Biçimler › En Uyumlu)." };
  }
  const tooBig = sizeError(blob.size);
  if (tooBig) return { ok: false, error: tooBig };
  return { ok: true, file: new File([blob], jpegName(file.name), { type: "image/jpeg" }), compressed: true };
}

export type UploadResult = { ok: true; document: DocumentMeta } | { ok: false; error: string };

/** Hazırlanmış dosyayı faturaya ekler (form alanı "dosya") */
export async function uploadDocument(invoiceId: number, file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("dosya", file, file.name);
  let res: Response;
  try {
    res = await fetch(documentUrl(invoiceId), { method: "POST", body: form });
  } catch {
    return { ok: false, error: uploadErrorText(0, null) };
  }
  const body: unknown = await res.json().catch(() => null);
  const doc = body && typeof body === "object" && (body as { ok?: unknown }).ok === true ? (body as { document?: DocumentMeta }).document : undefined;
  if (!res.ok || !doc) return { ok: false, error: uploadErrorText(res.status, body) };
  return { ok: true, document: doc };
}

export type LoadedDocument =
  | { ok: true; blob: Blob; mime: string; fileName: string }
  | { ok: false; status: number; error: string; retryable: boolean };

/**
 * Önizleme için belgeyi indirir. Paraşüt e-fatura PDF'i ilk açılışta sunucuda Paraşüt'ten alınır (birkaç saniye
 * sürebilir); hata JSON {error} olarak döner ve olduğu gibi gösterilir.
 */
export async function loadDocument(url: string, fallbackName: string, opts: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<LoadedDocument> {
  const { signal } = opts;
  let res: Response;
  try {
    // Asıl belgenin içeriği değişebilir (yükleme silindi, Paraşüt kopyası geldi): tarayıcı önbelleği yeniden sorulur
    res = await fetch(url, { signal, cache: opts.fresh ? "no-cache" : "default" });
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false, status: 0, error: documentErrorText(0, null), retryable: true };
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("json")) {
    const body: unknown = await res.json().catch(() => null);
    const status = res.ok ? 500 : res.status;
    return { ok: false, status, error: documentErrorText(status, body), retryable: isRetryable(status) };
  }
  const blob = await res.blob();
  const mime = type.split(";")[0].trim() || blob.type;
  const named = fileNameFromDisposition(res.headers.get("content-disposition"));
  const ext = documentKind(mime) === "pdf" ? ".pdf" : documentKind(mime) === "image" ? `.${mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg"}` : "";
  return { ok: true, blob, mime, fileName: named ?? `${fallbackName}${ext}` };
}

/** Paylaşım menüsü dosya kabul ediyor mu (iOS, Android; masaüstünde çoğunlukla yok) */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

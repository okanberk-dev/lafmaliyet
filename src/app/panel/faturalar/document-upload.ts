/**
 * Tarayıcıda belge işleri: fotoğrafı JPEG'e küçültme, POST /api/faturalar/{id}/belge ile yükleme, önizleme için
 * indirme. Kurallar (ne küçültülür, hata metinleri) document-rules.ts'te; burası yalnızca tarayıcı API'lerini kullanır.
 */
import { compressImage } from "@/lib/photo-compress";
import type { DocumentMeta } from "@/server/documents";

import {
  documentErrorText,
  documentKind,
  documentUrl,
  fileNameFromDisposition,
  isRetryable,
  JPEG_QUALITY,
  jpegName,
  MAX_IMAGE_SIDE,
  sizeError,
  uploadErrorText,
  uploadKindOf,
  uploadPlan,
} from "./document-rules";

/** `cancelled`: tarama ekranı kapatıldı (hata değil; hiçbir şey yüklenmez) */
export type Prepared = { ok: true; file: File; compressed: boolean } | { ok: false; error: string; cancelled?: boolean };

/** En uzun kenarı 2000px'i aşmayan JPEG (fatura yazısı okunur kalır); saydam alan beyaz olur */
const toJpeg = (file: Blob) => compressImage(file, { maxEdge: MAX_IMAGE_SIDE, quality: JPEG_QUALITY });

/**
 * Fotoğraf seçildiyse önce tarama ekranı (src/components/panel/scan-editor.tsx; docs/FOTOGRAF.md › Belge tarama):
 * taranmış hâl faturanın belgesi olur. Faturanın belgesinde asıl fotoğraf ayrıca saklanmaz (asıl hâli isteyen
 * "Taramadan kullan"ı seçer); yapay zekâya köşe sorulmaz. Ekran yüklenemezse fotoğraf taramasız sürer; kapatılırsa null.
 */
async function scanDocumentPhoto(file: File): Promise<File | "skip" | null> {
  let mod: typeof import("@/components/panel/scan-editor");
  try {
    mod = await import("@/components/panel/scan-editor");
  } catch {
    return "skip";
  }
  const choice = await mod.openScanEditor(file, { hint: false }).result;
  if (!choice) return null;
  if (choice.kind === "skip") return "skip";
  return new File([choice.scanned], jpegName(file.name), { type: "image/jpeg" });
}

/**
 * Seçilen dosyayı yüklemeye hazırlar: PDF olduğu gibi; fotoğraf önce taranır (ya da taramadan), sonra küçük JPEG olduğu
 * gibi, ötekiler küçültülerek
 */
export async function prepareDocument(input: File): Promise<Prepared> {
  let file = input;
  let plan = uploadPlan(file);
  if (plan.action === "reject") return { ok: false, error: plan.error };
  if (uploadKindOf(file) === "image") {
    const scanned = await scanDocumentPhoto(file);
    if (!scanned) return { ok: false, error: "", cancelled: true };
    if (scanned !== "skip") {
      file = scanned;
      plan = uploadPlan(file);
    }
  }
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

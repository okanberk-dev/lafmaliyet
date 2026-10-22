/**
 * Fatura belgesinin (Paraşüt e-fatura PDF'i, panelden yüklenen fotoğraf ya da PDF) ekrandaki kuralları: hangi dosya
 * olduğu gibi gider, hangisi küçültülür, adres, dosya adı, hata metinleri. Saf; tarayıcıya ya da React'e bağlı değil.
 * Testleri: tests/faturalar-belge.test.ts. Sunucu tarafı: src/server/documents.ts, api/faturalar/[id]/belge.
 */
import { formatBytes, MAX_UPLOAD_BYTES } from "@/lib/documents";
import { fitWithin as fitWithinEdge } from "@/lib/photo-compress";

/** Bundan büyük ya da JPEG olmayan fotoğraflar yüklenmeden önce tarayıcıda JPEG'e küçültülür */
export const COMPRESS_OVER_BYTES = 1.5 * 1024 * 1024;
/** Küçültülen fotoğrafın en uzun kenarı (px): fatura yazısı okunur kalır */
export const MAX_IMAGE_SIDE = 2000;
export const JPEG_QUALITY = 0.82;

export type FileLike = { name: string; type: string; size: number };

/** Belgenin türü: tarayıcının bildirdiğine, boşsa (bazı Android seçicileri) uzantıya bakılır */
export function uploadKindOf(f: Pick<FileLike, "name" | "type">): "pdf" | "image" | null {
  const type = f.type.toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (!type || type === "application/octet-stream") {
    if (/\.pdf$/i.test(f.name)) return "pdf";
    if (/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return "image";
  }
  return null;
}

export type UploadPlan = { action: "send" } | { action: "compress" } | { action: "reject"; error: string };

/** Seçilen dosya ne olacak: olduğu gibi gönderilir, önce küçültülür ya da reddedilir (sunucu türü ayrıca denetler) */
export function uploadPlan(f: FileLike): UploadPlan {
  if (f.size <= 0) return { action: "reject", error: "Dosya boş; yeniden seçin." };
  const kind = uploadKindOf(f);
  if (!kind) return { action: "reject", error: "Yalnız PDF ya da fotoğraf (JPG, PNG, WebP) yüklenebilir." };
  if (kind === "pdf") {
    return f.size > MAX_UPLOAD_BYTES ? { action: "reject", error: `PDF ${formatBytes(f.size)}; en çok 4 MB yüklenebilir. Küçültüp yeniden deneyin.` } : { action: "send" };
  }
  const jpeg = f.type.toLowerCase() === "image/jpeg" || (!f.type && /\.jpe?g$/i.test(f.name));
  return jpeg && f.size <= COMPRESS_OVER_BYTES ? { action: "send" } : { action: "compress" };
}

/** Küçültmeden sonra da sınırı aşan dosya */
export function sizeError(size: number): string | null {
  return size > MAX_UPLOAD_BYTES ? `Dosya ${formatBytes(size)}; en çok 4 MB yüklenebilir.` : null;
}

/** En uzun kenarı `max`'ı aşmayacak boyut; küçük görsel büyütülmez (ortak hesap src/lib/photo-compress.ts'te) */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  return fitWithinEdge(width, height, max);
}

/** Küçültülen fotoğrafın adı: "IMG_1234.HEIC" → "IMG_1234.jpg" */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, "").trim();
  return `${base || "fotograf"}.jpg`;
}

/** Content-Disposition başlığındaki dosya adı (UTF-8 adı önce; Türkçe harfler korunur) */
export function fileNameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      const name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
      if (name) return name;
    } catch {
      // Bozuk kodlama: düz ada düşülür
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1].trim() || null;
}

export type DocumentKind = "pdf" | "image" | "other";

export function documentKind(mime: string | null | undefined): DocumentKind {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  return "other";
}

/**
 * Belge adresi. `docId` yoksa faturanın asıl belgesi: Paraşüt e-fatura PDF'i (ilk açılışta Paraşüt'ten alınıp
 * saklanır) ya da son yüklenen dosya. `download` indirir.
 */
export function documentUrl(invoiceId: number, opts: { docId?: number | null; download?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (opts.docId) q.set("belge", String(opts.docId));
  if (opts.download) q.set("indir", "1");
  const query = q.toString();
  return `/api/faturalar/${invoiceId}/belge${query ? `?${query}` : ""}`;
}

/** Paraşüt'ten belge gelebilir mi (gelen e-fatura ya da gider faturası) */
export function isParasutDocument(i: { eInvoiceId?: string | null; externalId?: string | null }): boolean {
  return Boolean(i.eInvoiceId || i.externalId);
}

/** Satırda "Belgeyi aç" çıkar mı: Paraşüt'e bağlı ya da dosya yüklenmiş */
export function canHaveDocument(i: { eInvoiceId?: string | null; externalId?: string | null }, docCount: number): boolean {
  return isParasutDocument(i) || docCount > 0;
}

/** Sayfa yükleyicisi için: faturaya göre belgeler (gelen sıra korunur: yeni önce) */
export function groupDocuments<T extends { invoiceId: number }>(docs: readonly T[]): Record<number, T[]> {
  const out: Record<number, T[]> = {};
  for (const d of docs) (out[d.invoiceId] ??= []).push(d);
  return out;
}

/** Pencere ve satırdaki belge özeti */
export function documentSummary(
  i: { eInvoiceId?: string | null; externalId?: string | null },
  docs: readonly { source: "parasut" | "upload" }[],
): { title: string; hint: string } {
  const uploads = docs.filter((d) => d.source === "upload").length;
  const added = uploads ? `${uploads} dosya eklendi` : "";
  if (i.eInvoiceId) return { title: "E-fatura PDF'i", hint: ["Paraşüt'ten gelir", added].filter(Boolean).join(" · ") };
  if (i.externalId) return { title: "Paraşüt belgesi", hint: ["Paraşüt'teki PDF ya da fiş fotoğrafı", added].filter(Boolean).join(" · ") };
  if (uploads) return { title: uploads === 1 ? "1 dosya eklendi" : `${uploads} dosya eklendi`, hint: "Fotoğraf ya da PDF" };
  return { title: "Belge yok", hint: "Kâğıt faturanın fotoğrafını çekin ya da PDF'ini ekleyin." };
}

function errorOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const e = (body as { error?: unknown }).error;
  return typeof e === "string" && e.trim() ? e.trim() : null;
}

/** Belge açılamadığında gösterilecek metin: sunucunun JSON hatası, yoksa durum koduna göre */
export function documentErrorText(status: number, body: unknown): string {
  const msg = errorOf(body);
  if (msg) return msg;
  if (status === 0) return "Bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.";
  if (status === 401 || status === 403) return "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın.";
  if (status === 404) return "Belge bulunamadı; silinmiş olabilir.";
  if (status === 502 || status === 504) return "Paraşüt'e ulaşılamadı; biraz sonra yeniden deneyin.";
  return `Belge açılamadı (hata ${status}); biraz sonra yeniden deneyin.`;
}

/** Yükleme hatası: sunucunun JSON hatası, yoksa (ör. barındırmanın 413'ü) durum koduna göre */
export function uploadErrorText(status: number, body: unknown): string {
  const msg = errorOf(body);
  if (msg) return msg;
  if (status === 0) return "Bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.";
  if (status === 413) return "Dosya çok büyük; en çok 4 MB yüklenebilir.";
  if (status === 401 || status === 403) return "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın.";
  if (status >= 500) return "Dosya kaydedilemedi; biraz sonra yeniden deneyin.";
  return `Dosya yüklenemedi (hata ${status}).`;
}

/** Yeniden denemek anlamlı mı (bağlantı ya da sunucu hatası; yok olan belge için değil) */
export function isRetryable(status: number): boolean {
  return status === 0 || status >= 500;
}

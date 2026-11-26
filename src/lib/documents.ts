/**
 * Fatura belgeleri (Paraşüt e-fatura PDF'i, Paraşüt fiş fotoğrafı ya da panelden yüklenen dosya) için saf
 * yardımcılar: dosya türünü içerikten tanıma, güvenli dosya adı, indirme başlığı. Sunucu ve istemci birlikte kullanır.
 */

export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** Panelden yüklenebilen dosyalar; fotoğraflar istemcide küçültülür, PDF olduğu gibi gider */
export const UPLOAD_MIMES: readonly DocumentMime[] = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
/** Vercel işlev isteği 4,5 MB ile sınırlı; biraz pay bırakılır */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Paraşüt'ten indirilen belge için üst sınır (veritabanında saklanır) */
export const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

const EXT: Record<DocumentMime, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Dosya türünü ilk baytlardan tanır (istemcinin söylediği türe güvenilmez); tanınmazsa null */
export function sniffMime(bytes: Uint8Array): DocumentMime | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf"; // %PDF-
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp"; // RIFF....WEBP
  return null;
}

export function extensionFor(mime: DocumentMime): string {
  return EXT[mime];
}

const TR_ASCII: Record<string, string> = { ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U" };

/** Dosya adında sorun çıkarmayacak ASCII parça: Türkçe harfler sadeleşir, geri kalan işaretler "-" olur */
export function fileSlug(text: string, max = 40): string {
  return slug(text, max);
}

function slug(text: string, max = 40): string {
  const ascii = text
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_ASCII[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return ascii
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** "Kaldi_2026-10-12_KLA2026000000625.pdf" — tedarikçi, tarih ve fatura numarasından */
export function documentFileName(input: { supplier: string; date: string; invoiceNo?: string | null; mime: DocumentMime }): string {
  const parts = [slug(input.supplier) || "fatura", input.date.slice(0, 10), input.invoiceNo ? slug(input.invoiceNo, 30) : ""].filter(Boolean);
  return `${parts.join("_")}.${extensionFor(input.mime)}`;
}

/** RFC 6266/5987: ASCII ad + UTF-8 ad (Türkçe karakterli adlar da doğru iner) */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Paraşüt gider faturasındaki `photo` alanı (Paraşüt mobil uygulamasıyla eklenen fiş/fatura görseli). Biçimi
 * belgelenmemiş: düz adres, {url}, {original: {url}} ya da boş olabilir.
 */
export function parasutPhotoUrl(photo: unknown): string | null {
  const ok = (v: unknown): v is string => typeof v === "string" && /^https:\/\//i.test(v.trim());
  if (ok(photo)) return photo.trim();
  if (photo && typeof photo === "object") {
    const o = photo as Record<string, unknown>;
    if (ok(o.url)) return o.url.trim();
    for (const k of ["original", "large", "medium"]) {
      const inner = o[k];
      if (inner && typeof inner === "object" && ok((inner as Record<string, unknown>).url)) return ((inner as Record<string, unknown>).url as string).trim();
    }
  }
  return null;
}

/** "1,2 MB" / "86 KB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

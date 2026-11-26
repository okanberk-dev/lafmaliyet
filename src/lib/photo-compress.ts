/**
 * Fotoğrafı telefonda küçültme (tarayıcıda çalışır; `fitWithin` saf ve testli: tests/foto-altyapi.test.ts). Her fotoğraf
 * JPEG'e yeniden kodlanır: EXIF (konum dahil) düşer, tarayıcı çözerken telefonun döndürmesini zaten uygular, saydam
 * alan beyaz olur. Fatura belgeleri de aynısını kendi ölçüsüyle kullanır (faturalar/document-upload.ts).
 */

/**
 * Fotoğraftan okuma: Claude'un ayrıntısını kaybetmeden okuduğu en büyük ölçü (en uzun kenar 2576 px, ~3,75 megapiksel;
 * büyüğünü API kendisi küçültür). Telefon fotoğrafı 3:4 olduğundan sınırı megapiksel belirler (~1670×2220 px; tek
 * fotoğraftaki uzun Z rulosu ~375 px eninde kalır, 1600 px'te ~270 px kalıyordu); kırpılmış uzun fiş 2576 px'e kadar
 * çıkar. Çoğu ~0,4–1,2 MB; `maxBytes`'ı aşan görsel önce daha düşük kaliteyle, gerekirse daha küçük yeniden kodlanır
 * (sunucu 2 MB'ı keser, photo-rules MAX_PHOTO_BYTES).
 */
export const PHOTO_COMPRESS = { maxEdge: 2576, maxPixels: 3_700_000, quality: 0.7, maxBytes: 1_800_000 } as const;

/** `maxBytes` aşılınca sırayla denenen kodlamalar (ölçek ilk ölçüye göre) */
const SHRINK_STEPS = [
  { quality: 0.6, scale: 1 },
  { quality: 0.5, scale: 1 },
  { quality: 0.5, scale: 0.8 },
  { quality: 0.5, scale: 0.64 },
] as const;

/** Görsel çözülemedi (HEIC'i açamayan tarayıcı, bozuk dosya) */
export class PhotoCompressError extends Error {}

export const COMPRESS_ERROR_TEXT = "Fotoğraf açılamadı. JPG ya da PNG seçin (iPhone'da Ayarlar › Kamera › Biçimler › En Uyumlu).";

/** En uzun kenarı `max`'ı, alanı `maxPixels`'ı (yuvarlamayla ≈) aşmayacak boyut; oran korunur, küçük görsel büyütülmez */
export function fitWithin(width: number, height: number, max: number, maxPixels = Infinity): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  if (!(k < 1)) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Görseli çözer; iOS ve Android'de çekilen fotoğrafın yönü (EXIF) tarayıcıda zaten uygulanır (belge tarama da kullanır) */
export async function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

/** Çözülmüş görseli verilen ölçüde ve kalitede JPEG'e kodlar */
async function encodeJpeg(img: HTMLImageElement, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoCompressError(COMPRESS_ERROR_TEXT);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  // Tuvalin belleği hemen bırakılır: iOS Safari tuvallerin toplam belleğini sınırlar, çöp toplayıcıyı beklemeden dolabilir
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new PhotoCompressError(COMPRESS_ERROR_TEXT);
  return blob;
}

/**
 * En uzun kenarı `maxEdge`'i (ve verildiyse alanı `maxPixels`'ı) aşmayan JPEG; `maxBytes` verildiyse aşan görsel
 * SHRINK_STEPS ile yeniden kodlanır (yine aşarsa son hâli döner, sunucu 2 MB'ta keser). Çözülemezse PhotoCompressError.
 */
export async function compressImage(
  file: Blob,
  opts: { maxEdge?: number; maxPixels?: number; quality?: number; maxBytes?: number } = PHOTO_COMPRESS,
): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? PHOTO_COMPRESS.maxEdge;
  const quality = opts.quality ?? PHOTO_COMPRESS.quality;
  const url = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await decodeImage(url);
    } catch {
      throw new PhotoCompressError(COMPRESS_ERROR_TEXT);
    }
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge, opts.maxPixels);
    let blob = await encodeJpeg(img, width, height, quality);
    if (opts.maxBytes) {
      for (const step of SHRINK_STEPS) {
        if (blob.size <= opts.maxBytes) break;
        blob = await encodeJpeg(img, Math.max(1, Math.round(width * step.scale)), Math.max(1, Math.round(height * step.scale)), step.quality);
      }
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

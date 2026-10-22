/**
 * Fotoğrafı telefonda küçültme (tarayıcıda çalışır; `fitWithin` saf ve testli: tests/foto-altyapi.test.ts). Her fotoğraf
 * JPEG'e yeniden kodlanır: EXIF (konum dahil) düşer, tarayıcı çözerken telefonun döndürmesini zaten uygular, saydam
 * alan beyaz olur. Fatura belgeleri de aynısını kendi ölçüsüyle kullanır (faturalar/document-upload.ts).
 */

/** Fotoğraftan okuma için yeterli ve ~150–450 KB: soluk fiş okunmuyorsa önce bu iki sayı büyütülür (2000 / 0,8) */
export const PHOTO_COMPRESS = { maxEdge: 1600, quality: 0.7 } as const;

/** Görsel çözülemedi (HEIC'i açamayan tarayıcı, bozuk dosya) */
export class PhotoCompressError extends Error {}

export const COMPRESS_ERROR_TEXT = "Fotoğraf açılamadı. JPG ya da PNG seçin (iPhone'da Ayarlar › Kamera › Biçimler › En Uyumlu).";

/** En uzun kenarı `max`'ı aşmayacak boyut; küçük görsel büyütülmez */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > max)) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Görseli çözer; iOS ve Android'de çekilen fotoğrafın yönü (EXIF) tarayıcıda zaten uygulanır */
async function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

/** En uzun kenarı `maxEdge`'i aşmayan JPEG; çözülemezse PhotoCompressError */
export async function compressImage(file: Blob, opts: { maxEdge?: number; quality?: number } = PHOTO_COMPRESS): Promise<Blob> {
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
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
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
    if (!blob) throw new PhotoCompressError(COMPRESS_ERROR_TEXT);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

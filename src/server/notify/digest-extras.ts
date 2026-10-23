import "server-only";

import { collectDigestExtras, type DigestExtrasResult, type DigestExtraSource } from "./digest-template";

/**
 * Sabah e-postasının ek kutularının kaynakları (docs/planlar/CRITIQUE2.md R11): komisyon ve hakediş (komisyon grubu),
 * dünkü kontrol listeleri (kontrol), satış tahmini (tahmin). Her grup kutusunu kendi saf modülünde kurup sınar ve buraya
 * bir satır ekler; e-postanın konusu, başlığı, düğmesi, gövdedeki yeri ve tekil anahtarı digest-template.ts'te tek
 * yerde. Kurallar:
 *
 * - `load(today, { preview })` kutuyu ya da null döner; önizlemede (`preview: true`) hiçbir şey yazmaz. Daha önce
 *   bildirilmiş olanı (notification_log'da anahtarı olan) kaynağın kendisi eler: haber yoksa null.
 * - Her kaynak en çok 4 sn (DIGEST_EXTRA_MS); hata ya da süre aşımı kutuyu düşürür, e-postayı asla bozmaz.
 * - `news: true` kutu e-postayı tek başına gönderir; tahmin hep `news: false` (yalnız zaten giden e-postaya eklenir).
 * - `logKeys` ("komisyon:<uyarı>", "kontrol:<gün>") tekil anahtarın tohumuna girer ve yalnız başarılı gönderimden sonra
 *   notification_log'a yazılır.
 *
 * Liste boşken e-posta, konusu, tekil anahtarı ve günlük satırları kutusuz hâliyle birebir aynı.
 */
export const DIGEST_EXTRA_SOURCES: DigestExtraSource[] = [];

/** Ek kutuları aynı anda yükler (her biri en çok 4 sn); asla hata fırlatmaz. `preview`: yalnız okuyan önizleme */
export function loadDigestExtras(today: string, o: { preview?: boolean } = {}): Promise<DigestExtrasResult> {
  return collectDigestExtras(DIGEST_EXTRA_SOURCES, today, { preview: o.preview ?? false });
}

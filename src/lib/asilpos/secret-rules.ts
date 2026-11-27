/**
 * AsilPOS anahtarının tarayıcıya da giden kuralı (Şube ayarları › AsilPOS kartı). İmza denetimi (`./request.ts`) `node:crypto`
 * kullanır: tarayıcı bileşeni onu içe aktarırsa paketleyici crypto-browserify'ı (~0,5 MB) sayfaya koyar ve onunla gelen
 * `Function(...)` denemesi her açılışta CSP ihlali ürettirir (docs/DEPLOY.md › Güvenlik başlıkları). Tarayıcı bu dosyadan
 * okur; `request.ts` aynı değeri buradan alır.
 */

/** Anahtar en az bu kadar karakter; kısaysa yok sayılır (uçlar 503) */
export const ASILPOS_SECRET_MIN = 32;

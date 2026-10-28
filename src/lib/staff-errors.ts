import type { Role } from "./constants";

/**
 * Personele giden hata metinleri (denetim E-64, D-08): kurulum ayrıntısı (anahtar adı, imza, sitenin sürümü, Resend
 * anahtarı, alıcı listesi) yalnız yöneticiye. Personel ne olmadığını ve kime haber vereceğini görür; ayrıntı yöneticinin
 * ekranında kalır (Ayarlar › laffogato.net, bar ekranının yönetici satırı, kasa raporunun e-posta satırı). Ağ hatası,
 * zaman aşımı ve "sipariş bu arada değişti" gibi yeniden denenecek durumlar kendi metniyle kalır: onlarda kurulum
 * ayrıntısı yoktur, personel ne yapacağını görür. Saf: sunucu eylemleri, uçlar ve testler paylaşır.
 */

/** Site bağlantısı sorunu (karaoke, bar ekranı siparişleri): personelin gördüğü tek metin */
export const STAFF_SITE_ERROR = "Site bağlantısında sorun var; yöneticiye haber verin.";

/**
 * Personelin dokunuşu sitede yapılmadı (Tükendi, sipariş aşaması): `consequence` ne olmadığı ("sipariş ilerletilmedi",
 * "ürün tükendi yapılmadı"). Yoksa STAFF_SITE_ERROR.
 */
export function staffSiteText(consequence?: string): string {
  return consequence ? `Site bağlantısında sorun var; ${consequence}. Yöneticiye haber verin.` : STAFF_SITE_ERROR;
}

/** Canlı uçların (/api/canli, /api/siparisler) hata alanı: yöneticiye olduğu gibi, personele sabit metin; hata yoksa null */
export function siteErrorFor(role: Role, error: string | null | undefined): string | null {
  if (!error) return null;
  return role === "admin" ? error : STAFF_SITE_ERROR;
}

/** Kasa raporunun e-postası gitmedi: personelin gördüğü tam cümle (Resend anahtarı ve alıcı ayrıntısı yöneticide) */
export const STAFF_EMAIL_ERROR = "E-posta gitmedi; yöneticiye haber verin. Raporu WhatsApp ile gönderebilirsiniz.";

/** Kasa e-postasının hata metni okuyana göre: yöneticiye olduğu gibi, personele sabit metin; hata yoksa null */
export function emailErrorFor(role: Role, error: string | null | undefined): string | null {
  if (!error) return null;
  return role === "admin" ? error : STAFF_EMAIL_ERROR;
}

/** Kayıtlı raporun e-posta satırı: "E-posta gitmedi: …"; personelin metni zaten tam cümle */
export function emailFailedLine(error: string | null | undefined): string {
  if (error === STAFF_EMAIL_ERROR) return error;
  return `E-posta gitmedi: ${error ?? "bilinmeyen hata"}`;
}

/**
 * E-posta HTML'inin küçük yardımcıları (saf). Kullanıcıdan ya da veriden gelen her metin esc()'ten geçer; bileşenler
 * metni kendileri kaçışlar (ham HTML yalnız `…Html` adlı alanlarla ve `html: true` ile girer).
 */

/** HTML'e giden her kullanıcı metni buradan geçer (öteki e-postalardaki esc ile aynı: ' → &#39;) */
export const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** İlk harf büyük, Türkçe ("i" → "İ") */
export const upperFirst = (v: string): string => `${v.charAt(0).toLocaleUpperCase("tr-TR")}${v.slice(1)}`;

/** Boş, null ve false parçaları atar */
export const compact = <T>(xs: readonly (T | null | undefined | false | "")[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined && x !== false && x !== "");

/** Etiketsiz görünür metin uzunluğu (karakter varlıkları tek harf sayılır): satırın telefonda alta kayıp kaymayacağı */
export const visibleLength = (html: string): number => html.replace(/<[^>]*>/g, "").replace(/&[#a-z0-9]+;/gi, "x").length;

/**
 * "Z raporu tutuyor: fotoğraftaki rakamlar LafPOS'la aynı" → başlık "Z raporu tutuyor", alt satır "Fotoğraftaki rakamlar
 * LafPOS'la aynı". İki nokta yoksa hepsi başlık. Durum bandında uzun cümle büyük yazılmasın diye; metin aynı kalır
 * (yalnız alt satırın ilk harfi büyür)
 */
export function splitHeadline(text: string): { title: string; sub?: string } {
  const i = text.indexOf(": ");
  if (i <= 0) return { title: text };
  return { title: text.slice(0, i), sub: upperFirst(text.slice(i + 2)) };
}

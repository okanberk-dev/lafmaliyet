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
 * Durum bandının başlığı ve alt satırı: cümle ilk ": " ya da "; " ayracından (parantez dışında) bölünür. "Z raporu
 * tutuyor: fotoğraftaki rakamlar LafPOS'la aynı" → başlık "Z raporu tutuyor", alt satır "Fotoğraftaki rakamlar LafPOS'la
 * aynı"; "Z raporu okunamadı ya da yanlış belge; personelden yeniden çekmesi istendi" → "Z raporu okunamadı ya da yanlış
 * belge" + "Personelden yeniden çekmesi istendi". Ayraç yoksa hepsi başlık. Bantta uzun cümle büyük yazılmasın diye;
 * sözcükler aynı kalır (yalnız alt satırın ilk harfi büyür)
 */
export function splitHeadline(text: string): { title: string; sub?: string } {
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if ((c === ":" || c === ";") && text[i + 1] === " " && depth === 0 && i > 0) {
      const sub = text.slice(i + 2).trim();
      return sub ? { title: text.slice(0, i), sub: upperFirst(sub) } : { title: text.slice(0, i) };
    }
  }
  return { title: text };
}

import { EMAIL_LOGO_HTML } from "../../src/lib/email-kit";

/**
 * E-posta testlerinde HTML'in görünen metni: etiketler, değişiklik kalmayana dek çıkarılır (tek geçişlik regex iç içe
 * kalan bir etiketi bırakabilir; CodeQL "incomplete multi-character sanitization"). Yalnız test denetimi içindir,
 * güvenlik süzgeci değildir: e-postalar kullanıcı metnini kaçışlayarak (src/lib/email-kit.ts esc) üretir
 */
export function htmlText(html: string): string {
  let prev: string;
  let out = html;
  do {
    prev = out;
    out = out.replace(/<[^<>]*>/g, "");
  } while (out !== prev);
  return out;
}

/**
 * Kabuğun başa koyduğu şirket logosu (email-kit EMAIL_LOGO_HTML) bir kez çıkarılmış HTML: "logo dışında görsel yok"
 * denetimleri için. Yalnız ilk logo çıkar; ikinci bir logo ya da başka bir <img> denetimde kalır
 */
export function withoutLogo(html: string): string {
  return html.replace(EMAIL_LOGO_HTML, "");
}

// Asıl yönetici (docs/ROLLER.md › Asıl yönetici; sahibin kararı, 28 Kasım 2026): yönetici rolünde ve e-postası
// LADMIN_ANA_ADMIN (varsayılan info@nextgenlab.com.tr) olan tek hesap. Şubeyi açmak, kapatmak, silmek, kasa programını
// değiştirmek, kasasını kurmak ve serbest bırakmak, ilk personelini ayarlamak, kasa anahtarını ve AsilPOS'a geçiş gününü
// değiştirmek ve kasayı açılışta şubeye bağlamak (docs/ASILPOS.md › Kasa açılışı) yalnız onundur; hesabı öteki
// yöneticilere karşı korunur. Tek tanım burada: sunucu eylemleri `requireAnaAdmin` (src/server/auth/dal.ts) ve buradaki
// ret metinleriyle, arayüz aynı `isAnaAdmin` ile karar verir. Bu dosya saf (tests/asil-yonetici.test.ts).
//
// Kodda eski ad ("ana yönetici": isAnaAdmin, LADMIN_ANA_ADMIN) kalır; arayüzde ve belgede tek ad "Asıl yönetici".

import { anaAdminEmail, isAnaAdmin } from "./asilpos/kurulum";

export { ANA_ADMIN_EMAIL, anaAdminEmail, isAnaAdmin } from "./asilpos/kurulum";

type Env = Record<string, string | undefined>;

/** Arayüzdeki tek ad (etiket, rozet) */
export const ASIL_YONETICI = "Asıl yönetici";

/**
 * Yalnız asıl yöneticinin yaptığı işlemler. Şubeler: şubenin öteki alanları (ad, sıra, POS oranı, özellikler, e-posta)
 * her yöneticide kalır. Hesap: başka yönetici asıl yöneticinin hesabında bunları yapamaz (adı değişebilir)
 */
export const ASIL_YONETICI_ISLERI = {
  subeAcma: "şube açmak",
  subeSilme: "şube silmek",
  subeKapatma: "şubeyi kapatmak ya da yeniden açmak",
  kasaProgrami: "şubenin kasa programını değiştirmek",
  kasaKurma: "kasa kurmak (kurulum bağlantısı göndermek)",
  kasaSerbest: "şubenin kasasını serbest bırakmak",
  ilkPersonel: "şubenin ilk personelini (patron, müdür, barista PIN'leri) ayarlamak",
  kasaAnahtari: "kasa anahtarını değiştirmek ya da silmek",
  gecisGunu: "AsilPOS'a geçiş gününü değiştirmek",
  hesapDuzenleme: "asıl yöneticinin e-postasını, parolasını, rolünü ya da erişimini değiştirmek",
  hesapErisimi: "asıl yöneticinin hesabını açıp kapatmak",
  hesapSilme: "asıl yöneticinin hesabını silmek",
  hesapIkiAdim: "asıl yöneticinin iki adımlı doğrulamasını sıfırlamak",
  hesapKilidi: "asıl yöneticinin hesap kilidini açmak",
  hesapOturumlari: "asıl yöneticinin oturumlarını kapatmak",
  hesapBaglantisi: "asıl yöneticiye giriş ya da parola sıfırlama bağlantısı oluşturmak",
} as const;

export type AsilYoneticiIsi = keyof typeof ASIL_YONETICI_ISLERI;

/** Reddedilen işlemin cümlesi: "Bu işlemi yalnız asıl yönetici yapar: şube açmak" */
export function yalnizAsilYonetici(is: AsilYoneticiIsi): string {
  return `Bu işlemi yalnız asıl yönetici yapar: ${ASIL_YONETICI_ISLERI[is]}`;
}

/** Adres asıl yöneticinin adresi mi (büyük-küçük harf ve boşluk fark etmez) */
export function isAnaAdminEmail(email: string | null | undefined, env: Env = process.env): boolean {
  return !!email && email.trim().toLowerCase() === anaAdminEmail(env);
}

/**
 * Hesap koruması: hedef hesap asıl yöneticininse (adresi LADMIN_ANA_ADMIN) ve işlemi yapan asıl yönetici değilse ret
 * cümlesi, değilse null. Asıl yönetici kendi hesabında bugünkü kurallarla kalır (kendi parolası ve e-postası Hesabım'da)
 */
export function asilHesapRet(me: { role: string; email: string }, target: { email: string }, is: AsilYoneticiIsi, env: Env = process.env): string | null {
  return isAnaAdminEmail(target.email, env) && !isAnaAdmin(me, env) ? yalnizAsilYonetici(is) : null;
}

/** Bir hesabın adresi asıl yöneticinin adresine çevrilemez; açılmış asıl yönetici hesabının adresiyle yeni hesap açılamaz */
export const ASIL_ADRES_ALINAMAZ = "Bu adres asıl yöneticinin; başka bir hesaba verilemez";

/**
 * Yeni adres asıl yöneticinin adresi mi ve verilebilir mi:
 * - Var olan hesabın adresi (`before`) asıl yönetici adresine çevrilemez (o adres zaten o hesabınsa değişiklik yok).
 * - Yeni hesap (`before` null) o adresle açılamaz, ama yalnız asıl yönetici hesabı varken (`accountExists`). Hesap hiç
 *   yoksa bugünkü davranış kalır: bir yönetici onu açabilir (canlıda hesabın olup olmadığı bilinmiyordu; kilitlenme
 *   olmasın). Asıl yönetici hesabı açıldıktan sonra kimse adresi devralamaz.
 */
export function asilAdresRet(o: { next: string; before: string | null; accountExists: boolean }, env: Env = process.env): string | null {
  if (!isAnaAdminEmail(o.next, env)) return null;
  if (o.before !== null) return isAnaAdminEmail(o.before, env) ? null : ASIL_ADRES_ALINAMAZ;
  return o.accountExists ? ASIL_ADRES_ALINAMAZ : null;
}

/** Asıl yönetici kendi e-postasını değiştiremez (Hesabım): yetki bu adrese bağlı, değişirse yetki giderdi */
export const ASIL_EPOSTA_SABIT = "Asıl yöneticinin e-postası değişmez: asıl yönetici yetkisi bu adrese bağlıdır";

/** Arayüzde, asıl yönetici olmayan yöneticiye korunan düğmenin yanında (tek cümle) */
export function asilYoneticiNotu(is: AsilYoneticiIsi): string {
  const metin = ASIL_YONETICI_ISLERI[is];
  return `${metin.charAt(0).toLocaleUpperCase("tr-TR")}${metin.slice(1)} yalnız asıl yöneticinin işidir.`;
}

/** Kullanıcılar & roller: asıl yöneticinin hesabı korunur (öteki yöneticiye pencerede) */
export const ASIL_HESAP_KORUNUR = "Asıl yöneticinin hesabı korunur: e-postasını, parolasını, rolünü ve erişimini yalnız kendisi değiştirir.";

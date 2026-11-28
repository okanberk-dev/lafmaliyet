// Asıl yönetici (docs/ROLLER.md › Asıl yönetici; sahibin kararı, 28 Kasım 2026): yönetici rolünde ve e-postası
// LADMIN_ANA_ADMIN (varsayılan info@nextgenlab.com.tr) olan tek hesap. Şubeyi açmak, kapatmak, silmek, kasa programını
// değiştirmek, kasasını kurmak ve serbest bırakmak, ilk personelini ayarlamak, kasa anahtarını ve AsilPOS'a geçiş gününü
// değiştirmek ve kasayı açılışta şubeye bağlamak (docs/ASILPOS.md › Kasa açılışı) yalnız onundur; hesabı öteki
// yöneticilere karşı korunur. Yönetici hesaplarını da yalnız o yönetir (yonetici* işleri; Yönetim konsolu › Yöneticiler):
// öteki yöneticiler müdür, muhasebeci ve personel hesaplarını bugünkü gibi yönetir, başka bir yöneticinin yalnız adını
// değiştirebilir. Tek tanım burada: sunucu eylemleri `requireAnaAdmin` (src/server/auth/dal.ts) ve buradaki ret
// metinleriyle, arayüz aynı `isAnaAdmin` ile karar verir. Bu işler yalnız Yönetim konsolunun oturumuyla yapılır (K-C):
// asıl yönetici ladmin'den gelirse KONSOLDA_YAPILIR alır. Bu dosya saf (tests/asil-yonetici.test.ts).
//
// Kodda eski ad ("ana yönetici": isAnaAdmin, LADMIN_ANA_ADMIN) kalır; arayüzde ve belgede tek ad "Asıl yönetici".

import { anaAdminEmail, isAnaAdmin } from "./asilpos/kurulum";

export { ANA_ADMIN_EMAIL, anaAdminEmail, isAnaAdmin } from "./asilpos/kurulum";

type Env = Record<string, string | undefined>;

/** Arayüzdeki tek ad (etiket, rozet) */
export const ASIL_YONETICI = "Asıl yönetici";

/**
 * Yalnız asıl yöneticinin yaptığı işlemler. Şubeler: şubenin öteki alanları (ad, sıra, POS oranı, özellikler, e-posta)
 * her yöneticide kalır. Hesap: başka yönetici asıl yöneticinin hesabında bunları yapamaz (adı değişebilir). Yönetici
 * hesapları (yonetici*): işlemden önceki ya da sonraki rol yöneticiyse işi yalnız asıl yönetici yapar; yalnız ad
 * değişikliği serbest (docs/ROLLER.md › Yönetici hesapları)
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
  yoneticiAcma: "yönetici hesabı açmak",
  yoneticilikVerme: "bir hesaba yöneticilik vermek",
  yoneticilikAlma: "bir yöneticinin yöneticiliğini almak",
  yoneticiDuzenleme: "bir yöneticinin e-postasını, parolasını ya da erişimini değiştirmek",
  yoneticiErisimi: "bir yönetici hesabını pasif ya da yeniden aktif yapmak",
  yoneticiSilme: "bir yönetici hesabını silmek",
  yoneticiIkiAdim: "bir yöneticinin iki adımlı doğrulamasını sıfırlamak",
  yoneticiKilidi: "bir yöneticinin hesap kilidini açmak",
  yoneticiOturumlari: "bir yöneticinin oturumlarını kapatmak",
  yoneticiBaglantisi: "bir yöneticiye giriş ya da parola sıfırlama bağlantısı oluşturmak",
} as const;

export type AsilYoneticiIsi = keyof typeof ASIL_YONETICI_ISLERI;

/** Reddedilen işlemin cümlesi: "Bu işlemi yalnız asıl yönetici yapar: şube açmak" */
export function yalnizAsilYonetici(is: AsilYoneticiIsi): string {
  return `Bu işlemi yalnız asıl yönetici yapar: ${ASIL_YONETICI_ISLERI[is]}`;
}

/**
 * Asıl yöneticinin işleri yalnız Yönetim konsolunun oturumuyla yapılır (docs/planlar/yonetim-konsolu.md › K-C): asıl
 * yönetici ladmin'in (panel) oturumuyla gelirse eylem bu cümleyle reddeder; ladmin'de taşınan düğmelerin yerinde de bu
 * cümle durur (asıl yöneticiye konsolun ilgili sayfasına bağlantıyla). Öteki yönetici yalnizAsilYonetici'yi alır
 */
export const KONSOLDA_YAPILIR = "Bu iş Yönetim konsolunda yapılır";

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

/** Hiçbir hesabın adresi asıl yöneticinin adresine çevrilemez; o adresle yeni hesap açılamaz */
export const ASIL_ADRES_ALINAMAZ = "Bu adres asıl yöneticinin; başka bir hesaba verilemez";

/**
 * Yeni adres asıl yöneticinin adresi mi ve verilebilir mi:
 * - Var olan hesabın adresi (`before`) asıl yönetici adresine çevrilemez (o adres zaten o hesabınsa değişiklik yok).
 * - Yeni hesap (`before` null) o adresle hiçbir koşulda açılamaz. Önceden asıl yönetici hesabı yokken bir yönetici onu
 *   açabiliyordu (canlıda hesabın olup olmadığı bilinmiyordu); hesap canlıda var, istisna kapandı (28 Kasım 2026): adres
 *   başka bir yöneticinin eliyle alınamaz. Hesap bir gün yok olursa yalnız veritabanından ya da LADMIN_ANA_ADMIN
 *   değiştirilerek düzelir (docs/DEPLOY.md › Asıl yönetici kilitlenirse)
 */
export function asilAdresRet(o: { next: string; before: string | null }, env: Env = process.env): string | null {
  if (!isAnaAdminEmail(o.next, env)) return null;
  if (o.before !== null && isAnaAdminEmail(o.before, env)) return null;
  return ASIL_ADRES_ALINAMAZ;
}

/** Asıl yönetici kendi e-postasını değiştiremez (Hesabım): yetki bu adrese bağlı, değişirse yetki giderdi */
export const ASIL_EPOSTA_SABIT = "Asıl yöneticinin e-postası değişmez: asıl yönetici yetkisi bu adrese bağlıdır";

/**
 * İş bir yönetici hesabına dokunuyor mu: işlemden önceki ya da sonraki rol yönetici (docs/ROLLER.md › Yönetici
 * hesapları). Dokunuyorsa eylem, parola sorusundan önce `requireAnaAdmin(yonetici…)` ister
 */
export function yoneticiHesabi(...roller: (string | null | undefined)[]): boolean {
  return roller.includes("admin");
}

/**
 * Düzenlemede hangi iş: rol yöneticiye çıkıyorsa yöneticilik vermek, yöneticiden iniyorsa yöneticiliği almak, ikisi de
 * yöneticiyse yöneticinin e-postası, parolası ya da erişimi. Hiçbiri yönetici değilse null (müdür, muhasebeci, personel)
 */
export function yoneticiDuzenlemeIsi(once: string, sonra: string): AsilYoneticiIsi | null {
  if (once !== "admin" && sonra === "admin") return "yoneticilikVerme";
  if (once === "admin" && sonra !== "admin") return "yoneticilikAlma";
  return once === "admin" ? "yoneticiDuzenleme" : null;
}

/** ladmin › Kullanıcılar: yönetici satırları herkese salt okunur, satırda ve pencerede bu cümle */
export const YONETICI_KONSOLDA = "Yönetici hesapları Yönetim konsolunda yönetilir";

/** ladmin › Kullanıcılar: kullanıcı ekleme ve düzenlemede "Yönetici" rolü kapalı; seçeneğin altında nedeni */
export const YONETICI_ROLU_KAPALI = "Yönetici rolü burada verilmez: yönetici hesaplarını asıl yönetici Yönetim konsolunda açar ve yönetir.";

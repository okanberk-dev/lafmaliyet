/**
 * Yönetici hesaplarının güvenliği (Dalga 2, 25 Kasım 2026; docs/DEPLOY.md › 6a). Sahibin isteği: "Yönetici hesaplarında
 * iki adımlı doğrulama zorunlu olsun; yeni cihazdan girişte uyarı." Saf kurallar ve metinler; oturum tarafı
 * src/server/auth/dal.ts (requireUser / requireSignedIn), giriş src/server/actions/auth.ts, uyarının gönderimi
 * src/server/auth/new-device.ts. Testler: tests/yonetici-guvenlik.test.ts.
 *
 * - Zorunluluk: iki adımlısı kapalı yönetici girişten sonra panel yerine kurulum ekranına (TWO_FACTOR_SETUP_PATH) gider;
 *   kurana kadar panelin hiçbir ekranı, eylemi ve veri ucu açılmaz. Kilitlenme olmasın: kurulum o ekranda hemen yapılır;
 *   acil durumda ortam değişkeni ADMIN_2FA_OPTIONAL=1 zorunluluğu kapatır (iki adımlı yine isteğe bağlı kalır).
 * - Yeni cihaz: bu tarayıcıdan bu hesapla daha önce hiç giriş yapılmadıysa (cihaz çerezi), başarılı girişte hesabın
 *   sahibine e-posta ve zil uyarısı. Kişisel veri en azda: tarayıcı ve işletim sisteminin adı ("Chrome · Windows") ve
 *   kısaltılmış IP ("85.105.12.x"); tam IP ve tarayıcı kimliği saklanmaz.
 */

import { TWO_FACTOR_ROLES } from "./roles";

/** İki adımlı kurulum ekranı (panelin dışında: kabuk, zil ve canlı veri yüklenmez) */
export const TWO_FACTOR_SETUP_PATH = "/giris/iki-adim";

/** Zorunluluğu kapatan ortam değişkeni (acil durum: telefon kayboldu, kurtarma kodu yok, başka yönetici yok) */
export const ADMIN_2FA_OPTIONAL_ENV = "ADMIN_2FA_OPTIONAL";

/** Yönetici hesaplarında iki adımlı zorunlu mu: ADMIN_2FA_OPTIONAL=1 değilse evet */
export function adminTwoFactorRequired(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[ADMIN_2FA_OPTIONAL_ENV]?.trim() !== "1";
}

/**
 * Bu rolde iki adımlı zorunlu mu (rakam gören rol: yönetici, müdür, muhasebeci; src/lib/roles.ts › TWO_FACTOR_ROLES; ve
 * zorunluluk açık); Hesabım ve Kullanıcılar metinleri buna göre. Personel ortak tablette sırayla girer: isteğe bağlı.
 */
export function twoFactorRequiredFor(role: string, required: boolean = adminTwoFactorRequired()): boolean {
  return required && (TWO_FACTOR_ROLES as readonly string[]).includes(role);
}

/** Bu hesap panele girmeden önce iki adımlıyı kurmalı mı (zorunlu rol, kapalı, zorunluluk açık) */
export function needsTwoFactorSetup(u: { role: string; totpEnabled: boolean }, required: boolean = adminTwoFactorRequired()): boolean {
  return twoFactorRequiredFor(u.role, required) && !u.totpEnabled;
}

/** Kurulum ekranının açıklaması */
export const ADMIN_2FA_REQUIRED_TEXT = "Yönetici, müdür ve muhasebeci hesaplarında iki adımlı doğrulama zorunludur. Kurulum bitince panel açılır.";

/**
 * Kullanıcılar › Güvenlik › İki adımlı doğrulamayı sıfırla (telefonunu kaybeden yönetici): zorunluyken kişi girişte
 * parolanın ardından kurulum ekranına gider ve yeni telefonuyla hemen kurar; zorunluluk kapalıyken yalnız parola
 */
export function twoFactorResetText(required: boolean): string {
  return required
    ? "Telefonunu kaybeden yönetici, müdür ya da muhasebeci için. Girişte parolanın ardından kurulum ekranı açılır: yeni telefonuyla hemen yeniden kurar, kurana kadar paneli kullanamaz."
    : "Telefonunu kaybeden kullanıcı için. Girişte yalnızca parola istenir; kişi Hesabım'dan yeniden kurabilir.";
}

/** Hesabım'da kapatma penceresinin uyarısı (zorunluyken yönetici) */
export const ADMIN_2FA_DISABLE_NOTE =
  "Yönetici, müdür ve muhasebeci hesaplarında iki adımlı doğrulama zorunludur: kapatınca panel yerine kurulum ekranı açılır, yeniden kurana kadar paneli kullanamazsınız (telefon değiştirirken böyle yapılır).";

/**
 * Kurulumdan sonra gidilecek adres: yalnız panel içi ya da Claude bağlantısının onay ekranı (girişin `safeNext`'inden
 * gelir ama adresten okunur, yeniden denetlenir); değilse rolün ana sayfası
 */
export function setupContinueHref(next: unknown, home: string): string {
  if (typeof next !== "string" || !(next.startsWith("/panel") || next.startsWith("/baglan?")) || next.startsWith("//") || next.includes("\\")) return home;
  return next;
}

/** Kurulum ekranının adresi, kurulumdan sonra dönülecek yerle */
export const twoFactorSetupHref = (next: string | null) => (next ? `${TWO_FACTOR_SETUP_PATH}?next=${encodeURIComponent(next)}` : TWO_FACTOR_SETUP_PATH);

// ---------------------------------------------------------------- Yeni cihaz

/** İşlem geçmişindeki satırın adı (zil bunu okur) */
export const NEW_DEVICE_ACTION = "Yeni cihazdan giriş";

/** Zil uyarıyı bu kadar gün gösterir */
export const NEW_DEVICE_BELL_DAYS = 7;

/**
 * Yeni cihaz uyarısı bu hesaba gider mi: iki adımlısı zorunlu (rakam gören) hesaplar, yönetici, müdür, muhasebeci (istek yönetici hesapları içindi; personel ortak
 * tablette sırayla giriş yapar, her biri o tablette ilk girişinde uyarı alırdı)
 */
export const alertsNewDevice = (u: { role: string }) => (TWO_FACTOR_ROLES as readonly string[]).includes(u.role);

/** "Chrome · Windows", "Safari · iPhone" (tarayıcı kimliğinin kendisi saklanmaz) */
export function userAgentLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Tarayıcı";
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X/.test(s) ? "Mac" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Kısaltılmış IP (KVKK: kişiyi tek başına belirlemesin, yine de "hiç tanımadığım bir yer" ayırt edilsin): IPv4'te son
 * hane ("85.105.12.x"), IPv6'da ilk üç blok ("2a02:4e0:2d1::/48"). Okunamıyorsa null.
 */
export function maskIp(ip: string | null | undefined): string | null {
  const raw = ip?.trim() ?? "";
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(raw);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (/^[0-9a-f:]+$/i.test(raw) && raw.includes(":")) {
    const head = raw.split("::")[0].split(":").filter(Boolean).slice(0, 3);
    return head.length ? `${head.join(":")}::/48` : null;
  }
  return null;
}

/** İşlem geçmişinin ayrıntısı (zil ve e-posta aynı metni kullanır): "Chrome · Windows · IP 85.105.12.x" */
export function newDeviceDetail(o: { device: string; ip: string | null }): string {
  return [o.device, o.ip ? `IP ${o.ip}` : null].filter(Boolean).join(" · ");
}

/** Siz değilseniz ne yapılır (zil, e-posta) */
export const NEW_DEVICE_ADVICE = "Siz değilseniz hemen parolanızı değiştirin ve Hesabım › Oturumlar'dan diğer cihazlardaki oturumları kapatın.";

/** Zil satırı: başlık cihazı, gövde zamanı ve ne yapılacağını söyler */
export function newDeviceBell(o: { id: number; detail: string | null; at: string }): { id: string; title: string; body: string } {
  return { id: `yeni-cihaz-${o.id}`, title: `Yeni cihazdan giriş${o.detail ? `: ${o.detail}` : ""}`, body: `${o.at}. ${NEW_DEVICE_ADVICE}` };
}

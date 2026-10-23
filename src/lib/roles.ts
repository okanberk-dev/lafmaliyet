/**
 * Rollerin erişebildiği ekranlar: tek kaynak. proxy.ts (sayfa yönlendirmesi), giriş sonrası yönlendirme, menü ve alt
 * menü bu listeye bakar; testler (tests/roller.test.ts) menüdeki her öğenin rolüyle buradaki kuralın aynı olduğunu
 * denetler. Asıl yetki yine her sayfada ve her sunucu eyleminde ayrıca denetlenir (src/server/auth/dal.ts).
 */

import type { Role } from "./constants";

/**
 * Personelin girebildiği ekranlar (alt sayfaları dahil). Maliyet, fiyat, kâr, maaş ve ayar ekranları yok; günün
 * işlerini (Bugün; yönetici bilgisi yüklenmez) görür, reçete defterinde değişiklik önerir (yönetici onaylar), karaoke
 * sayacını, gün sonu kasa raporunu, zayi / ikram kaydını, stok sayımını ve kendi hatırlatıcılarını kullanır.
 */
export const STAFF_PATHS = [
  "/panel/bugun",
  "/panel/karaoke",
  "/panel/kasa",
  "/panel/zayi",
  "/panel/receteler",
  "/panel/hatirlaticilarim",
  "/panel/sayim",
  "/panel/hesap",
] as const;

/**
 * Personel yolunun altında yalnız yöneticinin ekranı (tutar gösterir): proxy personeli buraya sokmaz, sayfa ve
 * eylemleri ayrıca requireAdmin ile denetler. canOpen önce buna bakar.
 */
export const ADMIN_ONLY_PATHS = ["/panel/karaoke/doluluk"] as const;

/**
 * Personelin girişte açılan ve izinsiz bir adrese gidince döndüğü ekran: Bugün (günün işleri; ay sonu sayımı da orada
 * satır olarak çıkar). Ana ekrana eklenmiş uygulama /panel'den açılır, proxy personeli buraya götürür.
 */
export const STAFF_HOME = "/panel/bugun";

export function homeFor(role: Role): string {
  return role === "admin" ? "/panel" : STAFF_HOME;
}

/** Adres yol parçası sınırında eşleşir: "/panel/sayim" ve "/panel/sayim/…" evet, "/panel/sayimlar" hayır */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Bu rol bu panel adresini açabilir mi (panel dışı adreslere karışmaz) */
export function canOpen(role: Role, pathname: string): boolean {
  if (role === "admin" || !under(pathname, "/panel")) return true;
  if (ADMIN_ONLY_PATHS.some((p) => under(pathname, p))) return false;
  return STAFF_PATHS.some((p) => under(pathname, p));
}

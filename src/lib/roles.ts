/**
 * Rollerin erişebildiği ekranlar: tek kaynak. proxy.ts (sayfa yönlendirmesi), giriş sonrası yönlendirme, menü ve alt
 * menü bu listeye bakar; testler (tests/roller.test.ts) menüdeki her öğenin rolüyle buradaki kuralın aynı olduğunu
 * denetler. Asıl yetki yine her sayfada ve her sunucu eyleminde ayrıca denetlenir (src/server/auth/dal.ts).
 */

import type { Role } from "./constants";

/**
 * Personelin girebildiği ekranlar (alt sayfaları dahil). Maliyet, alış fiyatı, kâr, maaş ve ayar ekranları yok; günün
 * işlerini (Bugün; yönetici bilgisi yüklenmez) görür, reçete defterinde değişiklik önerir (yönetici onaylar), karaoke
 * sayacını ve bar ekranını (tükenen ürün dahil), gün sonu kasa raporunu ve ModPOS'ta değişecek satış fiyatlarını
 * (Kasadaki fiyatlar), açılış / kapanış kontrol listelerini ve son 7 günün geçmişini, zayi / ikram kaydını, stok
 * sayımını, haftalık hızlı sayımı, gelen mal işaretini ("Geldi") ve sipariş taslağını (fiyatsız; mal siparişinin
 * listesi ve fiyatları yöneticide), özel günleri, kendi Yardım'ını ve kendi hatırlatıcılarını kullanır. Önemli
 * düzeltmeler isteğe döner, yönetici Onaylar'da karar verir (docs/ONAYLAR.md). Personel yolunun altındaki yönetici
 * ekranları (Karaoke doluluğu, Kontrol listelerini düzenleme) ADMIN_ONLY_PATHS'te; sayfa ve eylemler ayrıca
 * requireAdmin ile denetlenir.
 */
export const STAFF_PATHS = [
  "/panel/bugun",
  "/panel/karaoke",
  "/panel/kasa",
  "/panel/kontrol",
  "/panel/zayi",
  "/panel/receteler",
  "/panel/hatirlaticilarim",
  "/panel/sayim",
  "/panel/hizli-sayim",
  "/panel/ozel-gunler",
  "/panel/yardim/personel",
  "/panel/hesap",
] as const;

/**
 * Personel yolunun altında yalnız yöneticinin ekranı: proxy personeli buraya sokmaz, sayfa ve eylemleri ayrıca
 * requireAdmin ile denetler. canOpen önce buna bakar. Karaoke doluluğu tutar gösterir; kontrol listelerini düzenlemek
 * yöneticinin işidir (Geçmiş personele de açık).
 */
export const ADMIN_ONLY_PATHS = ["/panel/karaoke/doluluk", "/panel/kontrol/duzenle"] as const;

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

/**
 * Personelin rolü tek cümlede: Kullanıcılar & roller'deki rol seçicinin açıklaması. Yardım'daki "Personele hesap
 * açmak" da aynı ekranları sayar; ikisi STAFF_PATHS'le birlikte güncellenir (tests/personel-yetkileri.test.ts).
 */
export const STAFF_ROLE_HINT =
  "Bugün, kasa raporu ve kasadaki fiyatlar, açılış / kapanış listeleri ve son 7 günü, zayi ve ikram, stok sayımı, hızlı sayım ve sipariş taslağı, reçete defteri (öneri), karaoke, bar ekranı ve tükenen ürün, özel günler, yardım; önemli düzeltmeler yöneticinin onayıyla; maliyet, maaş ve kâr görmez";

/**
 * Kullanıcılar & roller'deki yetki tablosu. `paths`: satırın anlattığı personel ekranları; personelin her ekranı
 * tabloda bir satırda geçer (tests/personel-yetkileri.test.ts), ekran eklenince tablo eskimesin.
 */
export const ROLE_PERMISSIONS: readonly { label: string; admin: boolean; staff: boolean; paths?: readonly string[] }[] = [
  { label: "Bugün: günün işleri (kasa raporu, açılış ve kapanış listeleri, zayi, ay sonu sayımı)", admin: true, staff: true, paths: ["/panel/bugun"] },
  { label: "Karaoke ve bar ekranı: uygulama siparişleri, oda sayacı, rezervasyonlar, tükenen ürünü işaretleme (personel tutarları görmez)", admin: true, staff: true, paths: ["/panel/karaoke"] },
  {
    label:
      "Gün sonu kasa raporu; Z raporu ve fişler fotoğraftan, kasadan çıkanlar; ModPOS'ta değişecek satış fiyatları; ertesi gün kasa düzeltmesi, kilitli ve eski güne ekleme, 14 güne kadar geç rapor, silme ve fotoğraf kaldırma isteği (yönetici onaylar)",
    admin: true,
    staff: true,
    paths: ["/panel/kasa"],
  },
  { label: "Açılış ve kapanış kontrol listeleri; son 7 günün geçmişi (salt okunur)", admin: true, staff: true, paths: ["/panel/kontrol"] },
  { label: "Zayi ve ikram kaydı; 14 güne kadar geç kayıt ve başkasının kaydını silme isteği (yönetici onaylar)", admin: true, staff: true, paths: ["/panel/zayi"] },
  { label: "Reçete defteri; değişiklik ve yeni ürün önerisi, önerirken satış fiyatı (yönetici onaylar)", admin: true, staff: true, paths: ["/panel/receteler"] },
  { label: "Stok sayımı; sayım listesine kalem ekleme (Listeye ekle)", admin: true, staff: true, paths: ["/panel/sayim"] },
  { label: "Haftalık hızlı sayım, gelen mal işareti ve sipariş taslağı (yönetici onaylar; fiyat yok)", admin: true, staff: true, paths: ["/panel/hizli-sayim"] },
  { label: "Özel günler: maç, AVM etkinliği, kampanya; dünü “kafe kapalıydı” diye bildirme (yönetici onaylar)", admin: true, staff: true, paths: ["/panel/ozel-gunler"] },
  { label: "Kendi hatırlatıcıları ve bildirimleri", admin: true, staff: true, paths: ["/panel/hatirlaticilarim"] },
  { label: "Kendi parolası ve iki adımlı doğrulama", admin: true, staff: true, paths: ["/panel/hesap"] },
  { label: "Yardım: kendi ekranlarının anlatımı (yönetici bölümleri gönderilmez)", admin: true, staff: true, paths: ["/panel/yardim/personel"] },
  { label: "Reçeteyi doğrudan düzenleme; personelin önerilerini ve isteklerini onaylama (Onaylar)", admin: true, staff: false },
  { label: "Ürün maliyeti, fiyat değiştirme ve kârlılık", admin: true, staff: false },
  { label: "Hammadde fiyatları", admin: true, staff: false },
  { label: "Mal siparişi: fiyatlı liste, doğrudan gönderme, taslak onayı, teslim kontrolü", admin: true, staff: false },
  { label: "Satış, fatura, gelir-gider, kasa raporlarının geçmişi", admin: true, staff: false },
  { label: "Sabit gider, maaş ve personel", admin: true, staff: false },
  { label: "Ödemeler, hatırlatıcılar, e-posta bildirimleri", admin: true, staff: false },
  { label: "Kontrol listelerini düzenleme, 7 günden eski geçmiş, karaoke doluluğu", admin: true, staff: false },
  { label: "Paraşüt, ayarlar, yedek, kullanıcı yönetimi, Claude bağlantısı", admin: true, staff: false },
];

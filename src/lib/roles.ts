/**
 * Rollerin erişebildiği ekranlar ve yapabildikleri: TEK KAYNAK (docs/ROLLER.md). proxy.ts (sayfa yönlendirmesi), giriş
 * sonrası yönlendirme, menü ve alt menü ekran listelerine (`canOpen`), sayfalar ve sunucu eylemleri yetenek tablosuna
 * (`can`; src/server/auth/dal.ts › requireCan) bakar. Testler (tests/roller.test.ts) menüdeki her öğenin rolüyle buradaki
 * kuralın aynı olduğunu, her sunucu eyleminin bir yetki kapısından geçtiğini ve muhasebeciye yazma izni veren eylem
 * olmadığını denetler. Asıl yetki yine her sayfada ve her sunucu eyleminde ayrıca denetlenir.
 *
 * Dört rol (src/lib/constants.ts › ROLES):
 * - Yönetici (admin): her şey.
 * - Müdür (manager): şubesinin günlük işletmesi; şubesine KİLİTLİ (hesabında şube zorunlu). Personelin her ekranı, kasa
 *   raporlarının rakamları ve onaysız düzeltme, Onaylar (şubesinin istekleri), vardiya yazma, Teslim defteri, şubesinin
 *   günü ve İşçilik / ciro. Maaş ve kişisel ücret, Paraşüt, ayarlar, kullanıcılar, yedek, anahtarlar ve öteki
 *   şubeler yok.
 * - Personel (staff): günün işleri (değişmedi).
 * - Muhasebeci (accountant): SALT OKUNUR; faturalar, gelir-gider, aylık harcamalar, kasa raporları (rakamlarıyla),
 *   muhasebeci paketi. Hiçbir kayıt değiştiremez (her sunucu eylemi reddeder), ayar görmez; kişi başı maaş (Maaşlar) ve
 *   personel belgeleri yok. Vergi bölümü 27 Kasım 2026'da kaldırıldı (vergiyi muhasebeci yürütüyor).
 * Varsayılan KAPALI: tabloda olmayan her şey yalnız yöneticinin.
 */

import type { Role } from "./constants";

// ---------------------------------------------------------------- Yetenekler (eylem düzeyi)

/**
 * Eylem düzeyi yetenekler: rol → yapabildikleri. Sayfa ve eylemler `requireCan(yetenek)` (src/server/auth/dal.ts),
 * istemci ve saf kurallar `can(rol, yetenek)` ile sorar. Yeni bir yetenek eklenince satırı burada yazılır; rol listesinde
 * olmayan her rol için KAPALIDIR.
 */
export const CAPABILITIES = {
  /** İş kaydı yazmak (kasa raporu, zayi, sayım, kontrol listesi, sipariş aşaması …): her yazan eylemin tabanı */
  "kayit.yaz": ["admin", "manager", "staff"],
  /**
   * Şubenin günlük işletmesini doğrudan yönetmek: kasa raporunu onaysız düzeltmek ve silmek, kilitli ya da eski güne
   * yazmak, kasadan çıkanı ve zayi / ikramı doğrudan, kafe kapalı günü işaretlemek
   */
  "isletme.yonet": ["admin", "manager"],
  /** Kasa raporlarının rakamları ve geçmişi (fark, devir, beklenen nakit, yazarkasa kümülatifi; kör kasa yok) */
  "kasa.rakam": ["admin", "manager", "accountant"],
  /**
   * Karaoke tutarları (ön ödeme; Kasa raporunun site satırı): kasa e-postasının kitlesiyle aynı. Müdür ve personel
   * görmez, online toplamı herkes görür (docs/ROLLER.md › Müdür)
   */
  "karaoke.tutar": ["admin", "accountant"],
  /** Personelin isteklerini onaylamak ya da reddetmek (Onaylar; müdür yalnız şubesininkileri, reçete önerisi hariç) */
  onay: ["admin", "manager"],
  /** Vardiya planını yazmak (müdür şubesinin) */
  "vardiya.yaz": ["admin", "manager"],
  /** Şubenin işletme raporları: Bugün'ün şube günü (ciro, kasa farkı, geçen hafta), İşçilik / ciro */
  "rapor.sube": ["admin", "manager"],
  /** Muhasebe ekranları (salt okunur): faturalar, gelir-gider, aylık harcamalar, muhasebeci paketi */
  "muhasebe.oku": ["admin", "accountant"],
  /**
   * Kasadan çıkanın bütün gider kategorileri (maaş, kira, reklam): seçmek ve satırda adını görmek. Müdür personelin
   * kategorilerini seçer (malzeme, bakım, temizlik); öbür satırın yalnız türünü ve tutarını görür, kategori adını ve
   * satırın metnini görmez (kasadan ödenen maaş ve avans kişisel ücrettir; `ownerRowAmountOnly`)
   */
  "kategori.tum": ["admin", "accountant"],
  /** Maaşlar ve kişisel ücretler: Maaşlar, avanslar, personel belgeleri */
  maas: ["admin"],
  /** Yönetim: ayarlar, kullanıcılar, Paraşüt, yedek, anahtarlar, şube ayarları, Claude bağlantısı, tam dışa aktarım */
  yonetim: ["admin"],
  /** Bütün şubeleri görmek ve seçmek (müdür ve şubesi seçilmiş personel şubesine kilitli) */
  "sube.tumu": ["admin", "accountant"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

/** Bu rol bu yeteneğe sahip mi (tabloda olmayan rol için hayır) */
export function can(role: Role | null | undefined, cap: Capability): boolean {
  return !!role && (CAPABILITIES[cap] as readonly Role[]).includes(role);
}

/** Bilinen bir rol mü (oturum çerezi ve veritabanı satırı için) */
export function isRole(v: unknown): v is Role {
  return v === "admin" || v === "manager" || v === "staff" || v === "accountant";
}

/**
 * Hesabı şubesine kilitli olabilen roller: personel (şubesi seçiliyse) ve müdür (şube ZORUNLU; şubesi yoksa ya da pasifse
 * oturum açılmaz, src/server/auth/dal.ts). Kilit oturumdan okunur (src/server/branch-scope.ts › lockedBranch); eylemlere
 * gelen `role` değerine güvenilmez.
 */
export const BRANCH_ROLES: readonly Role[] = ["manager", "staff"];

/** Hesabında şube zorunlu olan roller (Kullanıcılar & roller, davet ve veritabanı kısıtı users_manager_branch_ck) */
export const BRANCH_REQUIRED_ROLES: readonly Role[] = ["manager"];

/**
 * Çekirdeklerin (kasa, zayi, kasadan çıkan, kapalı gün, istekler) iki düzeyi: "admin" doğrudan yazar, "staff" kurallara ve
 * onaya bağlı. Müdür çekirdeğe "admin" düzeyinde girer, şubesi oturumdan kilitli kalır. Muhasebeci hiçbir yazma eylemine
 * giremez (requireCan("kayit.yaz")); okuma düzeyi için `cashAudience`.
 */
export function opsLevel(role: Role): "admin" | "staff" {
  return can(role, "isletme.yonet") ? "admin" : "staff";
}

/** Kasa okumalarının (DTO, kör kasa, fotoğraf) düzeyi: rakamları gören rol "admin" DTO'sunu alır */
export function cashAudience(role: Role): "admin" | "staff" {
  return can(role, "kasa.rakam") ? "admin" : "staff";
}

/**
 * Müdürün personel gibi kullandığı ekranların çekirdek düzeyi (karaoke, kontrol listesi, sayım, reçete önerisi, sipariş,
 * özel gün, kasadaki fiyatlar): yalnız yönetici "admin", öteki her rol "staff" (varsayılan kapalı)
 */
export function adminLevel(role: Role): "admin" | "staff" {
  return role === "admin" ? "admin" : "staff";
}

/** Çekirdeğe giden kişi: düzeyi (`role`) ve gerçek rolü (`realRole`) */
export type Actor<T extends { role: Role }> = Omit<T, "role" | "realRole"> & { role: "admin" | "staff"; realRole: Role };

/**
 * Çekirdeğe giden kişi: rolü çekirdeğin iki düzeyinden birine çevrilmiş (`opsLevel` ya da `adminLevel`). Çekirdekler
 * "admin" | "staff" bekler; gerçek rol eylemin kapısında (requireCan) denetlenmiştir, şube kilidi oturumdan okunur.
 * Gerçek rol `realRole`'de kalır: düzey yazım yolunu seçer, yalnız yöneticinin olanlara (bütün kategoriler, başkasının
 * yüklediği fotoğraf, tedarikçi ödemesine bağlı satır) çekirdek gerçek role bakar (`realRoleOf`; docs/ROLLER.md).
 */
export function asActor<T extends { role: Role }>(me: T, level: "admin" | "staff"): Actor<T> {
  return { ...me, role: level, realRole: (me as { realRole?: Role }).realRole ?? me.role };
}

/**
 * Çekirdekteki kişinin gerçek rolü: `asActor`'ın yazdığı `realRole`; elle kurulan kişide (AsilPOS eşitlemesi, fatura
 * eşleme, testler) düzeyin kendisi. Müdür "admin" düzeyinde yazar ama yöneticinin yetkileri onda yoktur.
 */
export function realRoleOf(actor: { role: Role; realRole?: Role }): Role {
  return actor.realRole ?? actor.role;
}

/**
 * Başkasının yüklediği fotoğrafı bir kayda (kasa raporu, kasadan çıkan, AsilPOS gün sonu) bağlayabilir mi: yalnız gerçek
 * yönetici; "admin" düzeyindeki müdür yalnız onayladığı isteğin tuttuğu fotoğrafı (`held`), öbür her yolda kendi
 * yüklediğini. Fotoğrafta şube yok: müdür öteki şubenin bağsız fotoğrafını kendi kaydına bağlayıp okuyamasın
 * (docs/ROLLER.md › Müdür)
 */
export function linksAnyPhoto(actor: { role: Role; realRole?: Role }, held = false): boolean {
  return realRoleOf(actor) === "admin" || (actor.role === "admin" && held);
}

/**
 * Yöneticinin kategorisindeki (maaş, kira, avans) kasadan çıkan satırını yalnız türü ve tutarıyla mı görür: kasanın
 * rakamlarını okuyan ama bütün kategorileri görmeyen rol (müdür). Satırın yeri, açıklaması, fişin bilgileri ve
 * fotoğrafı gitmez: serbest metin kişinin adını ve ücretini taşır ("Ayşe · Kasım avansı"; docs/ROLLER.md › Kararlar).
 * Personel değişmedi: o satırın metnini düzeltme isteği açar (docs/KASA-RAPORU.md); yönetici ve muhasebeci tümünü görür
 */
export function ownerRowAmountOnly(role: Role): boolean {
  return can(role, "kasa.rakam") && !can(role, "kategori.tum");
}

/** Müdürün personel gibi kullandığı ekranların eylemleri: yalnız yönetici "admin" düzeyinde (`adminLevel`) */
export function adminActor<T extends { role: Role }>(me: T): Actor<T> {
  return asActor(me, adminLevel(me.role));
}

/** Şubenin günlük işletmesi (kasa, zayi, kasadan çıkan, kapalı gün, onay): müdür "admin" düzeyinde (`opsLevel`) */
export function opsActor<T extends { role: Role }>(me: T): Actor<T> {
  return asActor(me, opsLevel(me.role));
}

/**
 * ADMIN_2FA_REQUIRED=1 iken iki adımlının zorunlu olduğu roller (src/lib/admin-security.ts; varsayılan herkeste isteğe
 * bağlı): rakam gören her rol (yönetici, müdür, muhasebeci). Yeni cihaz uyarısı da bunlarda (zorunluluktan bağımsız).
 * Personel ortak tablette sırayla girer; onda her zaman isteğe bağlı.
 */
export const TWO_FACTOR_ROLES: readonly Role[] = ["admin", "manager", "accountant"];

// ---------------------------------------------------------------- Ekranlar

/**
 * Personelin girebildiği ekranlar (alt sayfaları dahil). Maliyet, alış fiyatı, kâr, maaş ve ayar ekranları yok; günün
 * işlerini (Bugün; yönetici bilgisi yüklenmez) görür, reçete defterinde değişiklik önerir (yönetici onaylar), uygulama
 * siparişlerini ve masa çağrılarını (Siparişler; tükenen ürün dahil), karaoke sayacını ve bar ekranını, gün sonu kasa raporunu ve ModPOS'ta değişecek satış fiyatlarını
 * (Kasadaki fiyatlar), açılış / kapanış kontrol listelerini ve son 7 günün geçmişini, zayi / ikram kaydını, stok
 * sayımını, özel günleri, kendi Yardım'ını ve kendi hatırlatıcılarını kullanır; vardiya planını görür (yazamaz). Önemli
 * düzeltmeler isteğe döner, yönetici Onaylar'da karar verir (docs/ONAYLAR.md). Personel yolunun altındaki yönetici
 * ekranları (Karaoke doluluğu, Kontrol listelerini düzenleme) ADMIN_ONLY_PATHS'te; sayfa ve eylemler ayrıca
 * requireAdmin ile denetlenir.
 */
export const STAFF_PATHS = [
  "/panel/bugun",
  "/panel/siparisler",
  "/panel/karaoke",
  "/panel/kasa",
  "/panel/kontrol",
  "/panel/vardiya",
  "/panel/zayi",
  "/panel/receteler",
  "/panel/hatirlaticilarim",
  "/panel/sayim",
  "/panel/ozel-gunler",
  "/panel/yardim/personel",
  "/panel/hesap",
] as const;

/**
 * Personel yolunun altında yalnız yöneticinin ekranı: proxy personeli buraya sokmaz, sayfa ve eylemleri ayrıca
 * requireAdmin ile denetler. canOpen önce buna bakar. Karaoke doluluğu tutar gösterir; kontrol listelerini düzenlemek
 * yöneticinin işidir (Geçmiş personele de açık); Teslim defteri bütün teslimleri ve alanlarını gösterir (Kasa raporu
 * personele açık, defteri değil).
 */
export const ADMIN_ONLY_PATHS = ["/panel/karaoke/doluluk", "/panel/kontrol/duzenle", "/panel/kasa/teslim"] as const;

/**
 * Müdürün personelin ekranlarına EK olarak girdikleri: Onaylar (şubesinin istekleri; reçete önerileri yöneticinin), İşçilik /
 * ciro (yalnız şubesi). Personel yolunun altındaki yönetici ekranlarından Teslim defteri müdüre açık (şubesinin teslimleri);
 * Karaoke doluluğu (tutar) ve Kontrol listelerini düzenleme (şablonlar şubeler arası ortak olabilir) yöneticinin kalır.
 * Genel bakış, Şube karşılaştırma, Kaçak ve Kayıp önleme açılmadı: işletme geneli kâr, kira, maaş ve öteki şubeleri bir
 * arada gösteriyorlar (docs/ROLLER.md › Kararlar).
 */
export const MANAGER_EXTRA_PATHS = ["/panel/onaylar", "/panel/raporlar/iscilik"] as const;

/** Personel yolunun altında müdüre de kapalı olanlar (ADMIN_ONLY_PATHS'ten Teslim defteri müdüre açık) */
export const MANAGER_CLOSED_PATHS = ["/panel/karaoke/doluluk", "/panel/kontrol/duzenle"] as const;

/**
 * Muhasebecinin ekranları (salt okunur): kendi ana ekranı (muhasebe ekranlarının listesi ve muhasebeci paketi), faturalar,
 * gelir-gider, aylık harcamalar, kasa raporları, Hesabım. Ekranlardaki yazma düğmeleri gizlidir;
 * sunucu eylemlerinin hepsi muhasebeciyi reddeder (tests/roller.test.ts).
 */
export const ACCOUNTANT_PATHS = [
  "/panel/muhasebe",
  "/panel/faturalar",
  "/panel/gelir-gider",
  "/panel/harcamalar",
  "/panel/kasa",
  "/panel/hesap",
] as const;

/** Muhasebecinin ekranlarının altında ona kapalı olanlar: Kasadaki fiyatlar (işaretleme yazar), Teslim defteri */
export const ACCOUNTANT_CLOSED_PATHS = ["/panel/kasa/fiyatlar", "/panel/kasa/teslim"] as const;

/** Rolün açık yolları ve onların altında kapalı olanlar (kapalı olan önce gelir); yönetici her yere */
const ROLE_PATHS: Record<Exclude<Role, "admin">, { open: readonly string[]; closed: readonly string[] }> = {
  staff: { open: STAFF_PATHS, closed: ADMIN_ONLY_PATHS },
  manager: { open: [...STAFF_PATHS, ...MANAGER_EXTRA_PATHS], closed: MANAGER_CLOSED_PATHS },
  accountant: { open: ACCOUNTANT_PATHS, closed: ACCOUNTANT_CLOSED_PATHS },
};

/** Rolün açabildiği panel yolları (alt sayfaları dahil; `closed` hariç). Yönetici için null: her yer */
export function rolePaths(role: Role): { open: readonly string[]; closed: readonly string[] } | null {
  return role === "admin" ? null : (ROLE_PATHS[role] ?? null);
}

/**
 * Personelin girişte açılan ve izinsiz bir adrese gidince döndüğü ekran: Bugün (günün işleri; ay sonu sayımı da orada
 * satır olarak çıkar). Ana ekrana eklenmiş uygulama /panel'den açılır, proxy personeli buraya götürür.
 */
export const STAFF_HOME = "/panel/bugun";

/** Muhasebecinin ana ekranı: muhasebe ekranlarının listesi ve muhasebeci paketi */
export const ACCOUNTANT_HOME = "/panel/muhasebe";

/** Rolün girişte açılan ve izinsiz bir adrese gidince döndüğü ekran (müdür personel gibi Bugün'de açılır) */
export function homeFor(role: Role): string {
  if (role === "admin") return "/panel";
  if (role === "accountant") return ACCOUNTANT_HOME;
  return STAFF_HOME;
}

/** Adres yol parçası sınırında eşleşir: "/panel/sayim" ve "/panel/sayim/…" evet, "/panel/sayimlar" hayır */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Kaldırılan ekranların eski adresleri ve gidecekleri ekran: yer iminden, eski bildirimden ya da e-postadan gelen istek
 * 404 yerine yaşayan bir ekrana gider. proxy.ts oturumdan önce yönlendirir (geçici, 307); eski sorgu ve çapa düşer.
 * - Hızlı sayım ve Mal siparişi (26 Eki 2026, sahibin isteği: "Hızlı sayım ile mal siparişi kısmını kaldır, normal sayım
 *   olsun"): aylık Stok sayımı.
 * - Vergi, KDV, SGK bölümü ve alt sayfaları (27 Kasım 2026, sahibin kararı: vergiyi muhasebeci yürütüyor; kayıtlı
 *   veriler silinmedi): Genel bakış, kısa notla (`?kaldirildi=vergi`; REMOVED_NOTICES). Muhasebeci Genel bakış'ı
 *   açamaz: proxy notu onun ana ekranına (Muhasebe) taşır.
 */
export const RETIRED_PATHS: readonly { path: string; target: string }[] = [
  { path: "/panel/hizli-sayim", target: "/panel/sayim" },
  { path: "/panel/mal-siparisi", target: "/panel/sayim" },
  { path: "/panel/vergi", target: "/panel?kaldirildi=vergi" },
];

/** Kaldırılan bir ekranın (ya da alt sayfasının) adresiyse gidilecek ekran (sorgusuyla), değilse null */
export function retiredRedirect(pathname: string): string | null {
  return RETIRED_PATHS.find((r) => under(pathname, r.path))?.target ?? null;
}

/** Kaldırılan bölümün notu (`?kaldirildi=`): yönlendirilen ekranın başındaki kısa açıklama */
export const REMOVED_NOTICES: Readonly<Record<string, { title: string; text: string }>> = {
  vergi: {
    title: "Vergi bölümü kaldırıldı",
    text: "Vergiyi ve beyannameleri muhasebeciniz yürütüyor; panel vergi tahmini yapmıyor. Kayıtlı veriler silinmedi. Vergi ödemelerini isterseniz Ödemeler'e tutarıyla yazın.",
  },
};

/** Sorgudaki `kaldirildi` değerinin notu; bilinmeyen değerde null */
export function removedNotice(value: string | string[] | null | undefined): { title: string; text: string } | null {
  const key = Array.isArray(value) ? value[0] : value;
  return key && Object.hasOwn(REMOVED_NOTICES, key) ? REMOVED_NOTICES[key] : null;
}

/** Kaldırılan ekranın notunun sorgu adı (yönlendirmede rolün ana ekranına taşınır) */
export const REMOVED_PARAM = "kaldirildi";

/**
 * Bu rol bu panel adresini açabilir mi (panel dışı adreslere karışmaz). Tanınmayan rol hiçbir panel adresini açamaz
 * (varsayılan kapalı).
 */
export function canOpen(role: Role, pathname: string): boolean {
  if (!under(pathname, "/panel")) return true;
  if (role === "admin") return true;
  const rule = rolePaths(role);
  if (!rule) return false;
  if (rule.closed.some((p) => under(pathname, p))) return false;
  return rule.open.some((p) => under(pathname, p));
}

/**
 * Ekranın çizeceği bir bağlantı: rol hedefi açabiliyorsa adresin kendisi, açamıyorsa null (sorgu ve çapa yola girmez).
 * Ekran rolün açamadığı ekrana bağlantı çizmez; tıklayan kendi ana ekranına dönerdi (proxy). Örnek: müdür vardiya
 * planını yazar ama Şube ayarları'nı ve Ayarlar'ı açamaz (src/lib/vardiya.ts › shiftGridLinks).
 */
export function openableHref(role: Role, href: string): string | null {
  return canOpen(role, href.split(/[?#]/, 1)[0]) ? href : null;
}

/**
 * Personelin rolü tek cümlede: Kullanıcılar & roller'deki rol seçicinin açıklaması. Yardım'daki "Personele hesap
 * açmak" da aynı ekranları sayar; ikisi STAFF_PATHS'le birlikte güncellenir (tests/personel-yetkileri.test.ts).
 */
export const STAFF_ROLE_HINT =
  "Bugün, kasa raporu ve kasadaki fiyatlar, açılış / kapanış listeleri ve son 7 günü, zayi ve ikram, stok sayımı, reçete defteri (öneri), uygulama siparişleri, masa çağrıları ve tükenen ürün, karaoke ve bar ekranı, özel günler, vardiya planı, yardım; önemli düzeltmeler yöneticinin onayıyla; maliyet, maaş ve kâr görmez";


/** Müdürün rolü tek cümlede (rol seçicinin açıklaması) */
export const MANAGER_ROLE_HINT =
  "Şubesinin günlük işletmesi: personelin her ekranı, kasa raporlarının rakamları ve onaysız düzeltme, personelin isteklerini onaylama, vardiya yazma, teslim defteri, şubesinin günü ve işçilik / ciro; şubesine kilitli (şube zorunlu); maaş, Paraşüt, ayarlar ve kullanıcılar yok";

/** Muhasebecinin rolü tek cümlede (rol seçicinin açıklaması) */
export const ACCOUNTANT_ROLE_HINT =
  "Salt okunur: faturalar, gelir-gider, aylık harcamalar, kasa raporları ve muhasebeci paketi; hiçbir kaydı değiştiremez, ayar ve kişi başı maaş (Maaşlar, personel belgeleri) görmez";

/** Yöneticinin rolü tek cümlede */
export const ADMIN_ROLE_HINT = "Her şey (maliyet, kâr, ayarlar, reçete onayı dahil)";

/** Rol seçicinin açıklamaları (Kullanıcılar & roller) */
export const ROLE_HINTS: Record<Role, string> = {
  admin: ADMIN_ROLE_HINT,
  manager: MANAGER_ROLE_HINT,
  staff: STAFF_ROLE_HINT,
  accountant: ACCOUNTANT_ROLE_HINT,
};

/**
 * Kullanıcılar & roller'deki yetki tablosu. `paths`: satırın anlattığı personel ekranları; personelin her ekranı
 * tabloda bir satırda geçer (tests/personel-yetkileri.test.ts), ekran eklenince tablo eskimesin. Müdür ve muhasebeci
 * sütunları ekran ve yetenek kuralıyla aynıdır (tests/roller.test.ts): müdür personelin her satırını yapar.
 */
export const ROLE_PERMISSIONS: readonly { label: string; admin: boolean; manager: boolean; staff: boolean; accountant: boolean; paths?: readonly string[] }[] = [
  { label: "Bugün: günün işleri (kasa raporu, açılış ve kapanış listeleri, zayi, ay sonu sayımı)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/bugun"] },
  {
    label: "Siparişler: uygulama siparişlerinin aşaması (Hazırlanıyor, Hazır, Teslim edildi), masa çağrısında Gördüm, tükenen ürünü işaretleme; iade ve iptal sitenin panelinde",
    admin: true,
    manager: true,
    staff: true,
    accountant: false,
    paths: ["/panel/siparisler"],
  },
  { label: "Karaoke ve bar ekranı: oda sayacı, rezervasyonlar (personel tutarları görmez)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/karaoke"] },
  {
    label:
      "Gün sonu kasa raporu; Z raporu ve fişler fotoğraftan, kasadan çıkanlar; ModPOS'ta değişecek satış fiyatları; ertesi gün kasa düzeltmesi, kilitli ve eski güne ekleme, 14 güne kadar geç rapor, silme ve fotoğraf kaldırma isteği (yönetici onaylar)",
    admin: true,
    manager: true,
    staff: true,
    accountant: false,
    paths: ["/panel/kasa"],
  },
  { label: "Açılış ve kapanış kontrol listeleri; son 7 günün geçmişi (salt okunur)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/kontrol"] },
  { label: "Vardiya planı: haftanın vardiyalarını görme ve PDF'ini alma (planı yönetici ve müdür yazar)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/vardiya"] },
  { label: "Zayi ve ikram kaydı; 14 güne kadar geç kayıt ve başkasının kaydını silme isteği (yönetici onaylar)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/zayi"] },
  { label: "Reçete defteri; değişiklik ve yeni ürün önerisi, önerirken satış fiyatı (yönetici onaylar)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/receteler"] },
  { label: "Stok sayımı; sayım listesine kalem ekleme (Listeye ekle)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/sayim"] },
  { label: "Özel günler: maç, AVM etkinliği, kampanya; dünü “kafe kapalıydı” diye bildirme (yönetici onaylar)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/ozel-gunler"] },
  { label: "Kendi hatırlatıcıları ve bildirimleri", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/hatirlaticilarim"] },
  { label: "Kendi parolası ve iki adımlı doğrulama", admin: true, manager: true, staff: true, accountant: true, paths: ["/panel/hesap"] },
  { label: "Yardım: kendi ekranlarının anlatımı (yönetici bölümleri gönderilmez)", admin: true, manager: true, staff: true, accountant: false, paths: ["/panel/yardim/personel"] },
  { label: "Kasa raporlarının rakamları ve geçmişi: fark, devir, beklenen nakit, yazarkasa Z'si (müdür şubesinin)", admin: true, manager: true, staff: false, accountant: true },
  { label: "Kasa raporunu onaysız düzeltme ve silme, kilitli ya da eski güne yazma, kafe kapalı günü işaretleme (müdür şubesinin)", admin: true, manager: true, staff: false, accountant: false },
  { label: "Personelin isteklerini onaylama (Onaylar; müdür yalnız şubesininkileri)", admin: true, manager: true, staff: false, accountant: false },
  { label: "Vardiya planını yazma (müdür şubesinin)", admin: true, manager: true, staff: false, accountant: false },
  { label: "Teslim defteri: ayın teslimleri ve kimin aldığı (müdür şubesinin)", admin: true, manager: true, staff: false, accountant: false },
  { label: "Şubenin günü (ciro, kasa farkı, geçen hafta) ve İşçilik / ciro (müdür yalnız şubesinin; kişi başı ücret yok)", admin: true, manager: true, staff: false, accountant: false },
  { label: "Faturalar, gelir-gider, aylık harcamalar ve muhasebeci paketi (muhasebecide salt okunur)", admin: true, manager: false, staff: false, accountant: true },
  { label: "Bütün şubeler (müdür şubesine kilitli)", admin: true, manager: false, staff: false, accountant: true },
  { label: "Reçeteyi doğrudan düzenleme; reçete önerilerini onaylama", admin: true, manager: false, staff: false, accountant: false },
  { label: "Genel bakış, şube karşılaştırma, kaçak ve kayıp önleme raporları", admin: true, manager: false, staff: false, accountant: false },
  { label: "Ürün maliyeti, fiyat değiştirme ve kârlılık", admin: true, manager: false, staff: false, accountant: false },
  { label: "Hammadde fiyatları", admin: true, manager: false, staff: false, accountant: false },
  { label: "Satışlar, komisyon ve analiz", admin: true, manager: false, staff: false, accountant: false },
  { label: "Maaşlar, kişisel ücretler, avanslar ve personel belgeleri; sabit giderleri düzenleme", admin: true, manager: false, staff: false, accountant: false },
  { label: "Ödemeler, hatırlatıcılar, e-posta bildirimleri", admin: true, manager: false, staff: false, accountant: false },
  { label: "Mutabakat: banka ve tedarikçi ekstresi, POS hakedişi", admin: true, manager: false, staff: false, accountant: false },
  { label: "Kontrol listelerini düzenleme, 7 günden eski geçmiş, karaoke doluluğu", admin: true, manager: false, staff: false, accountant: false },
  { label: "Paraşüt, ayarlar, yedek, tam dışa aktarım, kullanıcı yönetimi, Claude bağlantısı", admin: true, manager: false, staff: false, accountant: false },
];

/**
 * Vardiyada çalışan ve sahada uyarı alan roller (vardiya planının kişileri, kontrol listesi ve karaoke uyarısının
 * personel alıcıları): personel ve müdür. Muhasebeci sahada değil
 */
export const SHIFT_ROLES: readonly Role[] = ["manager", "staff"];

export const isShiftRole = (role: Role | string): boolean => (SHIFT_ROLES as readonly string[]).includes(role);

/** Salt okunur hesabın yazma denemesine yanıt (veri uçları; sunucu eylemleri requireCan ile ana ekrana gönderir) */
export const READ_ONLY_TEXT = "Hesabınız salt okunur: bu işlemi yapamazsınız.";

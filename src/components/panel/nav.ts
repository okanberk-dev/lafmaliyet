import {
  AlarmClock,
  Banknote,
  BarChart3,
  BellRing,
  BookOpen,
  Boxes,
  Building2,
  CalendarClock,
  CalendarHeart,
  CalendarRange,
  ChartNoAxesColumn,
  ClipboardCheck,
  ClipboardList,
  Coffee,
  FileText,
  FileWarning,
  Gift,
  Globe,
  Grid3x3,
  HardDriveDownload,
  HelpCircle,
  History,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  ListTodo,
  MicVocal,
  Package,
  Percent,
  Plug,
  Receipt,
  Scale,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  SunMoon,
  Tags,
  Truck,
  type LucideIcon,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";

import type { BranchFeature } from "@/lib/branch-features";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Excel'deki karşılığı */
  excel?: string;
  roles: ("admin" | "staff")[];
  /** Bu öğeyi etkin gösteren diğer yollar (aynı bölümün sekmeleri) */
  match?: string[];
  /** Komut paletinde bulunsun diye ek arama sözcükleri */
  keywords?: string;
}

/**
 * Komut paletinin ve Yardım'ın ekran listesi. Başlıklar kenar çubuğu ağacının (NAV_TREE) başlıklarıyla aynı sırada;
 * birbirine yakın ekranlar aynı öğenin altında sekme: Giderler & maaşlar = Sabit giderler + Aylık harcamalar + Maaşlar.
 * Bir ekran bir ad (29 Eki 2026, docs/planlar/ux-sade.md §3.6): etiket kenar çubuğundaki ve başlıktaki adla aynı; eski
 * ad `keywords`'te kalır, alışkanlıkla yazılan da bulunur. Kare adresli kayıtlar (ör. "KDV" → /panel/vergi#kdv) bir
 * ekranın bölümünü adıyla açar; kenar çubuğuna ve telefon başlığına girmez. Adresler değişmedi.
 */
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Genel",
    items: [
      { href: "/panel", label: "Genel bakış", icon: LayoutDashboard, excel: "Panel", roles: ["admin"], keywords: "panel özet dashboard kâr zarar başabaş" },
      {
        href: "/panel/bugun",
        label: "Bugün",
        icon: ListTodo,
        roles: ["admin", "staff"],
        keywords: "bugün yapılacaklar günün işleri liste kontrol kasa zayi sayım",
      },
      // Personelin onaya giden istekleri ve reçete önerileri (docs/ONAYLAR.md); kenar çubuğunda Bugün'ün hemen altında, tek tıkla
      {
        href: "/panel/onaylar",
        label: "Onaylar",
        icon: ClipboardCheck,
        roles: ["admin"],
        keywords: "onay bekleyen reçete değişikliği personel önerisi istek kasa düzeltme geç rapor zayi kapalı gün",
      },
      { href: "/panel/kasa", label: "Kasa raporu", icon: Banknote, roles: ["admin", "staff"], keywords: "kasa z raporu gün sonu modpos nakit sayım eksik fazla kapanış whatsapp" },
    ],
  },
  {
    title: "Kafe",
    items: [
      // Uygulama siparişleri ve masa çağrıları (docs/SITE-SIPARIS.md); 6 Kas 2026'da Karaoke'den kendi ekranına
      {
        href: "/panel/siparisler",
        label: "Siparişler",
        icon: ShoppingBag,
        roles: ["admin", "staff"],
        keywords: "sipariş uygulama siparişi masa gel-al kurye laffogato.net garson çağır masa çağrısı su peçete zil bar ekranı hazır aşama tükendi tükenen satışa aç",
      },
      { href: "/panel/karaoke", label: "Karaoke", icon: MicVocal, roles: ["admin", "staff"], keywords: "karaoke rezervasyon sayaç süre alarm oda bar ekranı laffogato.net" },
      // Karaoke'nin alt ekranı, yalnız yönetici (kenar çubuğunda ayrı öğesi yok, ⌘K'da bulunur; docs/KARAOKE.md)
      {
        href: "/panel/karaoke/doluluk",
        label: "Karaoke doluluğu",
        icon: Grid3x3,
        roles: ["admin"],
        keywords: "karaoke doluluk ısı haritası boş saat dolu saat oda gelir saat başı uzatma iptal son dakika rezervasyon kaç gün önceden ay karşılaştırma",
      },
      {
        href: "/panel/kontrol",
        label: "Kontrol listeleri",
        icon: ListChecks,
        roles: ["admin", "staff"],
        keywords: "açılış kapanış kontrol listesi checklist temizlik hijyen buzdolabı sıcaklık derece haccp denetim fotoğraf mikrofon",
      },
      // Vardiya planı (docs/VARDIYA.md): yönetici haftayı yazar ve PDF'ini alır, personel görür. Yöneticinin kenar
      // çubuğunda adı "Vardiya ayarlama"; palet ve telefon başlığı iki rolde "Vardiya"
      {
        href: "/panel/vardiya",
        label: "Vardiya",
        icon: CalendarClock,
        roles: ["admin", "staff"],
        keywords: "vardiya ayarlama vardiya planı çizelge shift nöbet izin haftalık program çalışma saatleri kim çalışıyor pdf yazdır",
      },
      // Özel günler (maç, AVM etkinliği, kampanya; docs/OZEL-GUNLER.md): takvim notu
      { href: "/panel/ozel-gunler", label: "Özel günler", icon: CalendarHeart, roles: ["admin", "staff"], keywords: "özel gün derbi maç avm etkinlik kampanya kafe kapalı yoğun gün" },
      { href: "/panel/hatirlaticilarim", label: "Hatırlatıcılarım", icon: AlarmClock, roles: ["admin", "staff"], keywords: "hatırlatma not yapılacak kişisel alarm" },
    ],
  },
  {
    title: "Menü",
    items: [
      {
        href: "/panel/urunler",
        label: "Ürünler & kârlılık",
        icon: Coffee,
        excel: "Ürün Kârlılık + Reçete Kartları",
        roles: ["admin"],
        keywords: "reçete kartı fiyat marj kârlılık ürünler kâr düşük az kazandıran",
      },
      // Ürünler'in alt ekranı (kenar çubuğunda ayrı öğesi yok, ⌘K'da bulunur)
      {
        href: "/panel/urunler/site",
        label: "Site menüsü",
        icon: Globe,
        roles: ["admin"],
        keywords: "laffogato.net site menü eşleştirme bağlantı bağla fiyat satışta tükendi eşitle",
      },
      // Ürünler'in alt ekranı: toplu fiyat, kasaya (ModPOS) işle, fiyat geçmişi (docs/FIYATLAR.md)
      {
        href: "/panel/urunler/fiyatlar",
        label: "Fiyatlar",
        icon: Tags,
        roles: ["admin"],
        keywords: "toplu fiyat zam indirim yüzde yuvarla modpos kasa fiyat geçmişi geri al",
      },
      { href: "/panel/hammaddeler", label: "Hammaddeler", icon: Package, excel: "Hammaddeler", roles: ["admin"], keywords: "birim fiyat tedarikçi" },
      { href: "/panel/receteler", label: "Reçete defteri", icon: BookOpen, roles: ["admin", "staff"], keywords: "barista tarif öneri değişiklik" },
    ],
  },
  {
    title: "Stok",
    items: [
      {
        href: "/panel/sayim",
        label: "Stok sayımı",
        icon: ClipboardList,
        excel: "Sayım + Tutarlılık Kontrolü",
        roles: ["admin", "staff"],
        keywords: "envanter tutarlılık fark",
      },
      { href: "/panel/zayi", label: "Zayi & ikram", icon: Gift, roles: ["admin", "staff"], keywords: "zayi fire atılan bozulan ikram ödenmez personel tadım" },
      // Stok'un üçüncü sekmesi, yalnız yönetici; kendi adıyla aranır (eskiden Stok sayımı'nın eşi olarak)
      { href: "/panel/tutarlilik", label: "Tutarlılık", icon: ClipboardList, roles: ["admin"], keywords: "tutarlılık kontrolü fark sapma reçeteden fazla alım" },
    ],
  },
  {
    title: "Satış",
    items: [
      { href: "/panel/satislar", label: "Satışlar", icon: Receipt, excel: "Satış Raporu", roles: ["admin"], keywords: "pos rapor içe aktar" },
      // Yemek kartı ve platform komisyonunun gerçek oranı, faturadaki ücretler ve hakediş takibi (docs/KOMISYON.md)
      {
        href: "/panel/komisyonlar",
        label: "Komisyon & hakediş",
        icon: Percent,
        roles: ["admin"],
        keywords: "komisyon hakediş yemek kartı pluxee sodexo multinet edenred setcard metropol yemeksepeti trendyol getir migros oran yüzde 6 erken ödeme kesinti platform",
      },
      { href: "/panel/analiz", label: "Analiz & senaryo", icon: BarChart3, roles: ["admin"], keywords: "menü mühendisliği senaryo simülatör" },
    ],
  },
  {
    title: "Alış & gider",
    items: [
      { href: "/panel/faturalar", label: "Faturalar", icon: FileText, excel: "Faturalar", roles: ["admin"], keywords: "alış tedarikçi gider" },
      {
        href: "/panel/tedarikciler",
        label: "Tedarikçiler",
        icon: Truck,
        roles: ["admin"],
        keywords: "cari hesap kart unvan vergi no vkn vergi dairesi iban banka telefon borç bakiye ödeme talebi ödendi ödenmedi vade",
      },
      {
        href: "/panel/giderler",
        label: "Giderler & maaşlar",
        icon: Wallet,
        excel: "Sabit Giderler + Personel",
        roles: ["admin"],
        match: ["/panel/personel", "/panel/harcamalar"],
        keywords: "kira fatura maaş sgk yatırım reklam influencer harcama nakit fatura dışı aylık gider giderler & personel sabit gider kira aidat",
      },
      // Giderler & maaşlar'ın sekmeleri ve bölümü: kenar çubuğunda tek öğenin altında, burada adıyla
      { href: "/panel/harcamalar", label: "Aylık harcamalar", icon: Wallet, roles: ["admin"], keywords: "harcama reklam influencer nakit alım bakım fatura dışı" },
      { href: "/panel/personel", label: "Maaşlar", icon: UserRound, excel: "Personel", roles: ["admin"], keywords: "personel maaş net brüt bordro çalışan işveren maliyeti" },
      { href: "/panel/personel#sgk-oranlari", label: "SGK oranı", icon: Percent, roles: ["admin"], keywords: "sgk oranı işveren payı işsizlik prim oranı" },
    ],
  },
  {
    // Kâr ettim mi (Gelir-gider), ne ödeyeceğim (Ödemeler), param yeter mi (Nakit planı)
    title: "Kâr & ödemeler",
    items: [
      { href: "/panel/gelir-gider", label: "Gelir-gider", icon: CalendarRange, excel: "Genel Maliyet", roles: ["admin"], keywords: "aylık tablo kâr zarar online satış laffogato.net site uygulama ciro" },
      { href: "/panel/gelir-gider#kar-zarar", label: "Kâr / zarar", icon: Scale, roles: ["admin"], keywords: "kâr zarar kar zarar net kâr yıl" },
      {
        href: "/panel/hatirlaticilar",
        label: "Ödemeler",
        icon: BellRing,
        roles: ["admin"],
        keywords: "ödeme vade kira vergi kdv sgk maaş bildirim e-posta hatırlatma haftalık özet ödemeler & hatırlatıcılar ödeme ekle ödendi",
      },
      {
        href: "/panel/hatirlaticilar/nakit",
        label: "Nakit planı",
        icon: ChartNoAxesColumn,
        roles: ["admin"],
        keywords: "nakit akış tahmin bakiye kalan para haftalık plan sıkışık kdv devreden kdv hesabı devreden kdv param yeter mi",
      },
    ],
  },
  {
    // Devlete ödemeler (dalga 12, docs/VERGI.md): tahmin, beyanname değil. Takvimin satırları (KDV, SGK, muhtasar) ve kâr
    // vergisi kartı kare adresle adıyla bulunur
    title: "Vergi, KDV, SGK",
    items: [
      {
        href: "/panel/vergi",
        label: "Vergi, KDV, SGK",
        icon: Landmark,
        roles: ["admin"],
        keywords:
          "vergi kurumlar vergisi geçici vergi muhtasar stopaj damga vergisi sgk prim bordro gelir vergisi kdv beyanname tahakkuk muhasebeci amortisman demirbaş çevre temizlik ilan reklam vergi takvimi vergi özet vergi takvimi devlete ödemeler",
      },
      {
        href: "/panel/vergi#kdv",
        label: "KDV",
        icon: Percent,
        roles: ["admin"],
        keywords: "kdv katma değer bu ay ne kadar devreden indirilecek hesaplanan beyanname damga",
      },
      { href: "/panel/vergi#sgk", label: "SGK primi", icon: Users, roles: ["admin"], keywords: "sgk prim işveren sigorta tahakkuk" },
      { href: "/panel/vergi#muhtasar", label: "Maaş vergileri (muhtasar)", icon: Receipt, roles: ["admin"], keywords: "muhtasar stopaj ücret gelir vergisi prim hizmet" },
      { href: "/panel/vergi#kar-vergisi", label: "Kâr vergisi (geçici, kurumlar)", icon: Landmark, roles: ["admin"], keywords: "geçici vergi kurumlar vergisi peşin mahsup matrah" },
      {
        href: "/panel/vergi/gelir-gider",
        label: "Vergi kârı",
        icon: Receipt,
        roles: ["admin"],
        keywords:
          "vergi matrah gider sınıflandırma belgesi muhasebecide kdv beyannamesi satışları çeyrek vergiye göre gelir-gider vergiye göre kâr kurum kazancı matrah çeyrek",
      },
      {
        href: "/panel/vergi/gelir-gider#siniflandir",
        label: "Eksik belgeler",
        icon: FileWarning,
        roles: ["admin"],
        keywords: "belgesi seçilmemiş sınıflandır stopaj vergi kesintisi",
      },
      { href: "/panel/vergi/demirbas", label: "Demirbaş", icon: Package, roles: ["admin"], keywords: "vergi demirbaş amortisman faydalı ömür varlık doğrudan gider demirbaş & amortisman varlık" },
      {
        href: "/panel/vergi/kurallar",
        label: "Muhasebeci",
        icon: BookOpen,
        roles: ["admin"],
        keywords: "vergi oran dayanak kaynak 2026 elle değer ayarlar vergi kuralları vergi ayarları şirket nasıl kuruldu",
      },
      { href: "/panel/vergi/kurallar#sorular", label: "Muhasebeciye sorulacaklar", icon: ListChecks, roles: ["admin"], keywords: "vergi muhasebeci soru konuştum gözden geçir" },
    ],
  },
];

/**
 * Paletin "Ayarlar" kayıtları (kenar çubuğunda Ayarlar başlığı). Yalnız paletin kaynağı: profil menüsü ayrı
 * (sidebar.tsx); kare adresli kayıtlar (Ayarlar'ın bölümleri, Paraşüt'ün ürün bağlantıları) başka yere girmez.
 */
export const NAV_FOOTER: NavItem[] = [
  { href: "/panel/parasut", label: "Paraşüt entegrasyonu", icon: Plug, roles: ["admin"], keywords: "parasut fatura eşitleme muhasebe e-fatura" },
  {
    href: "/panel/parasut#urun-baglantilari",
    label: "Fatura kalemini hammaddeye bağla",
    icon: Plug,
    roles: ["admin"],
    keywords: "ürün hammadde bağlantısı eşleştir fatura kalemi",
  },
  { href: "/panel/ayarlar", label: "Ayarlar", icon: Settings, excel: "Ayarlar", roles: ["admin"], keywords: "kdv komisyon qr menü yedek kategori laffogato.net bağlantı lafpos kasa geçiş günü modpos api kasa föyü" },
  { href: "/panel/ayarlar#gorunum", label: "Görünüm (açık / koyu tema)", icon: SunMoon, roles: ["admin"], keywords: "koyu tema karanlık mod gece modu dark mode açık tema renk görünüm siyah" },
  { href: "/panel/ayarlar#oranlar", label: "KDV ve komisyon oranları", icon: Percent, roles: ["admin"], keywords: "kdv oranı %10 %20 hizmet pos komisyon oranı" },
  { href: "/panel/ayarlar#gecmis", label: "İşlem geçmişi", icon: History, roles: ["admin"], keywords: "kim neyi değiştirdi kayıt geçmiş log" },
  { href: "/panel/ayarlar#yedek", label: "Yedek", icon: HardDriveDownload, roles: ["admin"], keywords: "yedek indir excel" },
  { href: "/panel/kullanicilar", label: "Kullanıcılar & roller", icon: Users, roles: ["admin"], keywords: "kullanıcı rol yetki personel yönetici parola iki adımlı 2fa güvenlik" },
  { href: "/panel/subeler", label: "Şubeler", icon: Building2, roles: ["admin"], keywords: "şube sube marina tuzla kanal laffogato.net online yeni şube kasa kaynağı modpos lafpos" },
  { href: "/panel/yardim", label: "Yardım", icon: HelpCircle, excel: "Nasıl Kullanılır", roles: ["admin"], keywords: "nasıl kullanılır" },
  { href: "/panel/hesap", label: "Hesabım", icon: UserRound, roles: ["admin", "staff"], keywords: "parola şifre e-posta iki adımlı doğrulama 2fa authenticator" },
];

export function isNavActive(item: Pick<NavItem, "href" | "match">, pathname: string) {
  if (item.href === "/panel") return pathname === "/panel";
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** AkmanOS kenar çubuğu ağacı: üst öğeler ikon karolu, alt sayfalar açılır listede */
export interface NavNode {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  roles: ("admin" | "staff")[];
  /** Rolüne göre başka ad (aynı ekranı yönetici ayarlar, personel yalnız görür): navTreeFor uygular */
  labelFor?: Partial<Record<"admin" | "staff", string>>;
  /** Satırda canlı sayı: "orders" açık uygulama siparişi ve masa çağrısı (canlı veriden; orders-badge.tsx) */
  badge?: "orders";
  children?: { id: string; label: string; href: string; roles: ("admin" | "staff")[]; match?: string[]; badge?: "orders" }[];
}

/**
 * Ağaç (26 Eki 2026, docs/TASARIM.md "Menü ağacı"): yöneticide en sık açılan dört ekran (Genel bakış, Bugün, Onaylar,
 * Kasa raporu) tek tıkla üst düzeyde, gerisi konu başlıkları altında: işletme (Kafe, Menü, Stok), para (Satış, Alış &
 * gider, Kâr & ödemeler), devlete ödemeler (Vergi, KDV, SGK), Ayarlar. 29 Eki 2026 (docs/planlar/ux-sade.md §3.1):
 * "Finans" → "Kâr & ödemeler" (Gelir-gider, Ödemeler, Nakit planı); Vergi kendi grubunda, adı KDV ve SGK'yı da söyler,
 * kapalı kenar çubuğunda görünür; Menü'ye Fiyatlar, Kâr & ödemeler'e Nakit planı girdi. Başlık satırı yalnız grubu
 * açıp kapatır; etkin sayfanın grubu kendiliğinden açık (sidebar-nav.tsx). Personelin ağacı aynı kalır: üst düzey
 * öğeleri (Siparişler, Karaoke, Kontrol listeleri, Hatırlatıcılarım) yalnız personelde, yönetici aynı ekranları Kafe
 * altında görür. 6 Kas 2026: Siparişler (uygulama siparişleri ve masa çağrıları) personelde Bugün'ün altına, yönetici
 * Kafe'nin başına; satırında açık sayısı. Personelin görebildiği düğümlerin sırası değişmez (tests/kenar-cubugu.test.ts personelin ağacını olduğu gibi
 * sabitler). Adresler değişmedi, yalnız gruplama. 22 Kas 2026: Vardiya (docs/VARDIYA.md) iki rolde üst düzeyde, Kasa
 * raporu'nun altında; yöneticide adı "Vardiya ayarlama", personelde "Vardiya" (`labelFor`).
 */
export const NAV_TREE: NavNode[] = [
  { id: "genel", label: "Genel bakış", icon: LayoutDashboard, href: "/panel", roles: ["admin"] },
  // Günün işleri (docs/BUGUN.md); personelde ağacın ilk öğesi ve girişte açılan ekran
  { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun", roles: ["admin", "staff"] },
  // Personelin istekleri ve reçete önerileri (docs/ONAYLAR.md); yalnız yönetici, Bugün'ün hemen altında
  { id: "onaylar", label: "Onaylar", icon: ClipboardCheck, href: "/panel/onaylar", roles: ["admin"] },
  // Uygulama siparişleri ve masa çağrıları (6 Kas 2026): personelin üst düzey öğesi, Bugün'ün hemen altında; yönetici
  // Kafe altında görür. Satırda açık sipariş + çağrı sayısı
  { id: "siparisler", label: "Siparişler", icon: ShoppingBag, href: "/panel/siparisler", roles: ["staff"], badge: "orders" },
  // Personelin üst düzey öğesi; yönetici Kafe altında görür
  { id: "karaoke", label: "Karaoke", icon: MicVocal, href: "/panel/karaoke", roles: ["staff"] },
  // Gün sonu kasa raporu: iki rolde de üst düzeyde, tek tıkla
  { id: "kasa", label: "Kasa raporu", icon: Banknote, href: "/panel/kasa", roles: ["admin", "staff"] },
  // Vardiya planı (22 Kas 2026, sahibin isteği: "vardiya ayarlama diye ayrı sekme"; docs/VARDIYA.md): iki rolde üst
  // düzeyde, tek tıkla. Yönetici planı yazar (adı "Vardiya ayarlama"), personel yalnız görür ("Vardiya")
  { id: "vardiya", label: "Vardiya", labelFor: { admin: "Vardiya ayarlama" }, icon: CalendarClock, href: "/panel/vardiya", roles: ["admin", "staff"] },
  // Açılış ve kapanış listeleri (docs/KONTROL-LISTELERI.md); personelde üst düzeyde, yönetici Kafe altında görür
  { id: "kontrol", label: "Kontrol listeleri", icon: ListChecks, href: "/panel/kontrol", roles: ["staff"] },
  // Özel günler (takvim notu; docs/OZEL-GUNLER.md): personelde üst düzeyde, yönetici Kafe altında görür
  { id: "ozel-gunler", label: "Özel günler", icon: CalendarHeart, href: "/panel/ozel-gunler", roles: ["staff"] },
  {
    // Kafenin günlük işleyişi: uygulama siparişleri, karaoke odası, açılış / kapanış, özel günler, kişisel hatırlatıcılar
    id: "kafe",
    label: "Kafe",
    icon: Store,
    roles: ["admin"],
    children: [
      { id: "siparisler-yonetici", label: "Siparişler", href: "/panel/siparisler", roles: ["admin", "staff"], badge: "orders" },
      { id: "karaoke-yonetici", label: "Karaoke", href: "/panel/karaoke", roles: ["admin", "staff"] },
      { id: "kontrol-listeleri", label: "Kontrol listeleri", href: "/panel/kontrol", roles: ["admin", "staff"] },
      { id: "ozel-gunler-yonetici", label: "Özel günler", href: "/panel/ozel-gunler", roles: ["admin", "staff"] },
      { id: "hatirlaticilarim-yonetici", label: "Hatırlatıcılarım", href: "/panel/hatirlaticilarim", roles: ["admin", "staff"] },
    ],
  },
  {
    id: "menu",
    label: "Menü",
    icon: Coffee,
    roles: ["admin", "staff"],
    children: [
      { id: "urunler", label: "Ürünler & kârlılık", href: "/panel/urunler", roles: ["admin"] },
      // Toplu fiyat ve kasaya işleme (docs/FIYATLAR.md); Ürünler'in alt adresi ama kendi satırı (activeChildOf)
      { id: "fiyatlar", label: "Fiyatlar", href: "/panel/urunler/fiyatlar", roles: ["admin"] },
      { id: "hammaddeler", label: "Hammaddeler", href: "/panel/hammaddeler", roles: ["admin"] },
      { id: "receteler", label: "Reçete defteri", href: "/panel/receteler", roles: ["admin", "staff"] },
    ],
  },
  {
    id: "stok",
    label: "Stok",
    icon: Boxes,
    roles: ["admin", "staff"],
    children: [
      { id: "sayim", label: "Stok sayımı", href: "/panel/sayim", roles: ["admin", "staff"] },
      { id: "zayi", label: "Zayi & ikram", href: "/panel/zayi", roles: ["admin", "staff"] },
      { id: "tutarlilik", label: "Tutarlılık", href: "/panel/tutarlilik", roles: ["admin"] },
    ],
  },
  {
    // Gelen para: satış listesi, yemek kartı / platform kesintisi, menü mühendisliği
    id: "satis",
    label: "Satış",
    icon: Receipt,
    roles: ["admin"],
    children: [
      { id: "satislar", label: "Satışlar", href: "/panel/satislar", roles: ["admin"] },
      { id: "komisyonlar", label: "Komisyon & hakediş", href: "/panel/komisyonlar", roles: ["admin"] },
      { id: "analiz", label: "Analiz & senaryo", href: "/panel/analiz", roles: ["admin"] },
    ],
  },
  {
    // Giden para: alış faturaları, cari hesaplar, sabit giderler ve maaşlar
    id: "alis",
    label: "Alış & gider",
    icon: Truck,
    roles: ["admin"],
    children: [
      { id: "faturalar", label: "Faturalar", href: "/panel/faturalar", roles: ["admin"] },
      { id: "tedarikciler", label: "Tedarikçiler", href: "/panel/tedarikciler", roles: ["admin"] },
      // Sabit giderler, Aylık harcamalar ve Maaşlar tek satırın sekmeleri (SECTION_TABS.giderler)
      { id: "giderler", label: "Giderler & maaşlar", href: "/panel/giderler", roles: ["admin"], match: ["/panel/personel", "/panel/harcamalar"] },
    ],
  },
  {
    // Kâr ve ödemeler: aylık tablo (kâr ettim mi), ödemeler (ne ödeyeceğim), nakit planı (param yeter mi)
    id: "finans",
    label: "Kâr & ödemeler",
    icon: Scale,
    roles: ["admin"],
    children: [
      { id: "gelir-gider", label: "Gelir-gider", href: "/panel/gelir-gider", roles: ["admin"] },
      { id: "hatirlaticilar", label: "Ödemeler", href: "/panel/hatirlaticilar", roles: ["admin"] },
      { id: "nakit", label: "Nakit planı", href: "/panel/hatirlaticilar/nakit", roles: ["admin"] },
    ],
  },
  {
    // Devlete ödemeler (dalga 12, docs/VERGI.md): dört ekran, sekmeleri bu gruptan türer (SECTION_TABS.vergi)
    id: "vergi",
    label: "Vergi, KDV, SGK",
    icon: Landmark,
    roles: ["admin"],
    children: [
      { id: "vergi-ozet", label: "Özet", href: "/panel/vergi", roles: ["admin"] },
      { id: "vergi-kari", label: "Vergi kârı", href: "/panel/vergi/gelir-gider", roles: ["admin"] },
      { id: "demirbas", label: "Demirbaş", href: "/panel/vergi/demirbas", roles: ["admin"] },
      { id: "muhasebeci", label: "Muhasebeci", href: "/panel/vergi/kurallar", roles: ["admin"] },
    ],
  },
  // Personelde üst düzeyde; yönetici Kafe altında görür
  { id: "hatirlaticilarim", label: "Hatırlatıcılarım", icon: AlarmClock, href: "/panel/hatirlaticilarim", roles: ["staff"] },
  {
    id: "ayarlar",
    label: "Ayarlar",
    icon: Settings,
    roles: ["admin"],
    children: [
      { id: "genel-ayarlar", label: "Genel ayarlar", href: "/panel/ayarlar", roles: ["admin"] },
      { id: "kullanicilar", label: "Kullanıcılar & roller", href: "/panel/kullanicilar", roles: ["admin"] },
      { id: "subeler", label: "Şubeler", href: "/panel/subeler", roles: ["admin"] },
      { id: "parasut", label: "Paraşüt entegrasyonu", href: "/panel/parasut", roles: ["admin"] },
    ],
  },
  { id: "yardim", label: "Yardım", icon: HelpCircle, href: "/panel/yardim", roles: ["admin"] },
  // Personelin kendi Yardım'ı (yönetici bölümleri gönderilmez); ağacın en altında
  { id: "yardim-personel", label: "Yardım", icon: HelpCircle, href: "/panel/yardim/personel", roles: ["staff"] },
];

/** Bölüm sekmesi; `roles`: sekmeyi kimin gördüğü (sayfanın kendi yetkisiyle aynı) */
export interface SectionTab {
  href: string;
  label: string;
  roles: readonly ("admin" | "staff")[];
}

/** Sekmede kısa ad: başlık zaten "Stok", sekme "Sayım" der (Excel karşılığı da bu adla bulunur, yardim/nav-paths.ts) */
const TAB_LABELS: Record<string, string> = { "/panel/sayim": "Sayım" };

/** Kenar çubuğundaki bir grubun alt sayfaları, aynı sırada ve aynı rollerle */
function treeTabs(id: string): SectionTab[] {
  return (NAV_TREE.find((n) => n.id === id)?.children ?? []).map((c) => ({ href: c.href, label: TAB_LABELS[c.href] ?? c.label, roles: c.roles }));
}

/**
 * Bölüm içi sekmeler: aynı menü öğesinin altındaki ekranlar. Stok ve Vergi sekmeleri kenar çubuğunun grubundan türer
 * (denetim E-56, 27 Eki 2026; Vergi 29 Eki 2026'dan beri kendi grubu "Vergi, KDV, SGK"): menüye eklenen ya da çıkan
 * sayfa sekmelerde de aynı sırayla görünür; telefonda (kenar çubuğu gizli) sayfalar arasında hamburger menü açmadan
 * geçilir. Giderler'in sekmeleri kenar çubuğunda tek öğedir (Giderler & maaşlar), o yüzden elle. Ödemeler ile Nakit
 * planı kenar çubuğunda iki ayrı satır, sekmeyle de birbirine bağlı (docs/planlar/ux-sade.md K7).
 */
export const SECTION_TABS: Record<"giderler" | "stok" | "vergi" | "odeme", readonly SectionTab[]> = {
  giderler: [
    { href: "/panel/giderler", label: "Sabit giderler", roles: ["admin"] },
    { href: "/panel/harcamalar", label: "Aylık harcamalar", roles: ["admin"] },
    { href: "/panel/personel", label: "Maaşlar", roles: ["admin"] },
  ],
  stok: treeTabs("stok"),
  // Özet · Vergi kârı · Demirbaş · Muhasebeci (390 px'te kaydırmasız)
  vergi: treeTabs("vergi"),
  odeme: [
    { href: "/panel/hatirlaticilar", label: "Ödemeler", roles: ["admin"] },
    { href: "/panel/hatirlaticilar/nakit", label: "Nakit planı", roles: ["admin"] },
  ],
};

/** Kişinin açabildiği sekmeler (personel Tutarlılık'ı görmez); tek sekme kalırsa sekme çubuğu çizilmez (boş dizi) */
export function sectionTabsFor(section: keyof typeof SECTION_TABS, role: "admin" | "staff"): SectionTab[] {
  const tabs = SECTION_TABS[section].filter((t) => t.roles.includes(role));
  return tabs.length > 1 ? tabs : [];
}

/**
 * Şube özelliğine bağlı ekranlar (şube kapsamı B6; src/lib/branch-features.ts, docs/SUBE.md › Şube özellikleri): seçili
 * kapsamda özelliklerinden hiçbiri açık değilse ekran menüde (kenar çubuğu, çekmece, alt menü, komut paleti) yoktur;
 * adresiyle açılırsa "Bu şubede kullanılmıyor" der. Alt sayfalar da (Karaoke › Doluluk) aynı kurala uyar. Siparişler
 * uygulama siparişi ya da garson çağırdan biri açıkken görünür (ikisi tek ekranda)
 */
export const FEATURE_SCREENS: readonly { href: string; any: readonly BranchFeature[] }[] = [
  { href: "/panel/siparisler", any: ["siparis", "garson"] },
  { href: "/panel/karaoke", any: ["karaoke"] },
  { href: "/panel/komisyonlar", any: ["yemek_karti"] },
];

/** Ekran seçili kapsamın özellikleriyle (`on`) görünür mü; `on` verilmezse süzme yok (Yardım, asistanın ekran listesi) */
export function screenFeatureOn(href: string, on?: readonly BranchFeature[]): boolean {
  if (!on) return true;
  const path = href.split(/[?#]/)[0];
  const rule = FEATURE_SCREENS.find((r) => path === r.href || path.startsWith(`${r.href}/`));
  return !rule || rule.any.some((f) => on.includes(f));
}

/**
 * Ağacı role (ve verilirse seçili kapsamın şube özelliklerine, `screenFeatureOn`) göre süzer; tek alt sayfası kalan grup
 * doğrudan o sayfaya bağlanır
 */
export function navTreeFor(role: "admin" | "staff", features?: readonly BranchFeature[]): NavNode[] {
  return NAV_TREE.filter((n) => n.roles.includes(role) && (!n.href || screenFeatureOn(n.href, features)))
    .map((n) => (n.labelFor?.[role] ? { ...n, label: n.labelFor[role] } : n))
    .map((n) => (n.children ? { ...n, children: n.children.filter((c) => c.roles.includes(role) && screenFeatureOn(c.href, features)) } : n))
    .map((n) => (n.children && n.children.length === 1 ? { ...n, label: n.children[0].label, href: n.children[0].href, children: undefined } : n))
    .filter((n) => n.href || n.children?.length);
}

export function pathMatches(pathname: string, href: string, match: string[] = []) {
  if (href === "/panel") return pathname === "/panel";
  return [href, ...match].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Etkin sayfanın grubu: kenar çubuğunda kendiliğinden açık durur. Sayfa üst düzeyde ya da menüde değilse undefined */
export function activeGroupOf(items: NavNode[], pathname: string): string | undefined {
  return items.find((i) => i.children?.some((c) => pathMatches(pathname, c.href, c.match)))?.id;
}

/** Grubun etkin alt öğesi: adresle eşleşenlerden en uzun href (Fiyatlar'da Ürünler, Nakit planı'nda Ödemeler, Muhasebeci'de Özet yanmaz) */
export function activeChildOf(children: NonNullable<NavNode["children"]>, pathname: string): string | undefined {
  return children.filter((c) => pathMatches(pathname, c.href, c.match)).sort((a, b) => b.href.length - a.href.length)[0]?.id;
}

/** Sayfa başlığının bağlam satırı: rolün ağacında bu adresi açan grubun adı; üst düzey ekranda ya da ağaçta yoksa undefined */
export function groupLabelOf(pathname: string, role: "admin" | "staff"): string | undefined {
  const tree = navTreeFor(role);
  const id = activeGroupOf(tree, pathname);
  return tree.find((n) => n.id === id)?.label;
}

/**
 * Başlığın üstündeki bağlam satırı (page-header.tsx): grubun adı. Grubun giriş ekranı grubun adını taşıyorsa ("Vergi,
 * KDV, SGK" Özet'te, "Ayarlar") satır yok: başlığı bir kez daha yazmaz.
 */
export function contextLineOf(pathname: string, role: "admin" | "staff", title: string): string | undefined {
  const group = groupLabelOf(pathname, role);
  return group === title ? undefined : group;
}

/**
 * Kenar çubuğunun kaydırma kutusunda etkin sayfanın satırı görünmüyorsa kutunun ne kadar kaydırılacağı (artı: aşağı),
 * görünüyorsa 0 (sidebar-nav.tsx). Satır kenara yapışmasın diye `pad` kadar pay kalır; kutudan uzun satırda üst kenar
 * esastır. Vergi grubu listenin sonunda: 900 px yüksek dizüstünde Muhasebeci kutunun altında kalıyordu.
 */
export function revealDelta(box: { top: number; bottom: number }, item: { top: number; bottom: number }, pad = 8): number {
  const up = item.top - (box.top + pad);
  if (up < 0) return up;
  const down = item.bottom - (box.bottom - pad);
  return down > 0 ? Math.min(down, up) : 0;
}

/**
 * Kenar çubuğundaki tek vurgunun yeri: fare (yoksa klavye odağı) bir öğenin üstündeyse o öğe, değilse etkin sayfa.
 * `pointed` yalnız fareyle ve klavyeyle dolar; fareyle tıklamanın odağı ve dokunmatik "üstüne gelme" saymaz
 * (sidebar-nav.tsx): tıklama sırasında vurgu yer değiştirmez.
 */
export function navLit(key: string, active: boolean, pointed: string | null): boolean {
  return pointed === null ? active : pointed === key;
}

/**
 * Başka bir bölüme gidilince önceki etkin grubun açıklığı sabitlenir: kendiliğinden kapanıp alttaki satırları
 * yukarı kaydırmaz (tıklanan öğe imlecin altından kaçmaz). Kullanıcının açtığı ya da kapattığı grup olduğu gibi kalır.
 */
export function keepGroupOpen(toggled: Record<string, boolean>, previous: string | null | undefined): Record<string, boolean> {
  if (!previous || previous in toggled) return toggled;
  return { ...toggled, [previous]: true };
}

/** Bağlantı bulunulan ekranı mı açıyor (adres değişmeyecek): çekmece o zaman hemen kapanır, yoksa geçiş bitince */
export function isSamePage(href: string | null | undefined, pathname: string): boolean {
  if (href == null) return false;
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
  return trim(href.split(/[?#]/)[0] || pathname) === trim(pathname);
}

/**
 * ⌘K'nın kare adresli kaydı bulunulan ekranın bir bölümünü mü açıyor (yol aynı; adreste sorgu yok ya da bugünküyle
 * aynı): öyleyse "#bölüm", değilse null. Next'in yönlendiricisi adresi pushState ile değiştirir; o yol hashchange
 * göndermez, :target'ı güncellemez: kapalı bölüm (Maaşlar'ın SGK oranları, telefonda Ayarlar'ın kartları) açılmaz,
 * takvim satırının halkası çıkmaz. Bu kayıtta palet tarayıcının kendi çapa gezinmesini kullanır (command-palette.tsx).
 * Sorgusuz kayıt sayfanın süzgecini korur, sayfadaki bir #bölüm bağlantısı gibi.
 */
export function samePageHash(href: string, current: { pathname: string; search: string }): string | null {
  const at = href.indexOf("#");
  if (at < 0 || at === href.length - 1 || !isSamePage(href, current.pathname)) return null;
  const q = href.indexOf("?");
  const search = q < 0 || q > at ? "" : href.slice(q, at);
  return search === "" || search === current.search ? href.slice(at) : null;
}

/**
 * Telefon ve tabletteki alt menü (lg altında), beş öğe. Yönetici: dört sık ekran + "Tümü" (çekmeceyi açar, her şey
 * orada; ayda bir açılan Satışlar ve Faturalar da; kenar çubuğundaki Menü grubuyla karışmasın diye "Menü" değil). Personel: günün beş ekranı; Zayi, Sayım ve Hatırlatıcılarım
 * çekmecede (üst çubuktaki menü düğmesi), Sayım Zayi'nin Stok sekmelerinde de; ay sonu sayımı gerektiği gün Bugün'de satır olarak çıkar. `badge: "overdue"` öğesinde
 * gecikmiş ödeme sayısı, `badge: "orders"` öğesinde (Siparişler) açık uygulama siparişi ve masa çağrısı sayısı görünür.
 */
export interface BottomNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Yoksa öğe bağlantı değil, düğmedir: çekmeceyi açar ya da (`action: "assistant"`) panel asistanını açıp kapatır */
  href?: string;
  /** Bağlantısız öğenin işi: "assistant" panel asistanı; yoksa çekmece ("Tümü") */
  action?: "assistant";
  match?: string[];
  /** "overdue": gecikmiş ödeme sayısı (kırmızı); "orders": açık uygulama siparişi ve masa çağrısı (turuncu) */
  badge?: "overdue" | "orders";
}

export const BOTTOM_NAV: Record<"admin" | "staff", BottomNavItem[]> = {
  admin: [
    { id: "genel", label: "Genel bakış", icon: LayoutDashboard, href: "/panel" },
    { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun" },
    { id: "kasa", label: "Kasa", icon: Banknote, href: "/panel/kasa" },
    { id: "odemeler", label: "Ödemeler", icon: BellRing, href: "/panel/hatirlaticilar", badge: "overdue" },
    { id: "menu", label: "Tümü", icon: LayoutGrid },
  ],
  // Günün işleri; Zayi, Sayım ve Hatırlatıcılarım çekmece menüde (Stok grubunda; Zayi ve ay sonu sayımı Bugün'de satır
  // olarak da, Hatırlatıcılarım zilde de), Hesabım profil menüsünde. Siparişler 6 Kas 2026'da Zayi'nin yerine geldi
  // (uygulama siparişleri ve masa çağrıları Karaoke'den kendi ekranına taşındı; satırda açık sayısı)
  staff: [
    { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun" },
    { id: "siparisler", label: "Siparişler", icon: ShoppingBag, href: "/panel/siparisler", badge: "orders" },
    { id: "karaoke", label: "Karaoke", icon: MicVocal, href: "/panel/karaoke" },
    { id: "kasa", label: "Kasa", icon: Banknote, href: "/panel/kasa" },
    { id: "receteler", label: "Reçeteler", icon: BookOpen, href: "/panel/receteler" },
  ],
};

/**
 * Seçili şubede kullanılmayan ekranın (Siparişler, Karaoke; `screenFeatureOn`) alt menüdeki yedeği: personelin beş
 * hücresi beş kalır, boşalan hücreye çekmecedeki günlük ekranlar sırayla girer (Zayi & ikram, Kontrol listeleri)
 */
export const BOTTOM_SPARES: Record<"admin" | "staff", BottomNavItem[]> = {
  admin: [],
  staff: [
    { id: "zayi", label: "Zayi", icon: Gift, href: "/panel/zayi" },
    { id: "kontrol", label: "Kontrol", icon: ListChecks, href: "/panel/kontrol" },
  ],
};

/** Özelliği kapalı ekranın öğesi yerinde yedekle değişir (yedek kalmazsa öğe düşer); `features` yoksa süzme yok */
export function withSpares(items: readonly BottomNavItem[], spares: readonly BottomNavItem[], features?: readonly BranchFeature[]): BottomNavItem[] {
  const queue = spares.filter((sp) => !items.some((i) => i.href === sp.href));
  return items.flatMap((i) => (!i.href || screenFeatureOn(i.href, features) ? [i] : queue.length ? [queue.shift()!] : []));
}

/**
 * Panel asistanının alt menü sekmesi (docs/ASISTAN.md › Telefonda). Telefonda sağ alttaki yüzen düğme yoktur; asistan
 * alt menünün ortasındaki bu sekmeden açılır. Yalnız yöneticide ve asistan bu kurulumda açıkken (ASISTAN_KAPALI değil):
 * bottomNavFor.
 */
export const ASSISTANT_TAB: BottomNavItem = { id: "asistan", label: "Asistan", icon: Sparkles, action: "assistant" };

/**
 * Rolün alt menüsü. Yönetici ve asistan açıkken beş öğe yine beş kalır (390 px'te hücre başına 78 px; altıncı öğe
 * 360 px'te "Genel bakış"ı keser, 60 px hücre): Asistan ortaya girer, Genel bakış çubuktan çıkar. Neden Genel bakış:
 * öğelerden yalnız onun her ekranda tek dokunuşluk ikinci yolu var (üst çubuktaki L'Af karosu ana sayfaya, yani Genel
 * bakış'a gider; çekmecede de durur); Bugün, Kasa ve Ödemeler'in (gecikmiş rozeti) başka tek dokunuşluk yolu yok.
 * Giriş de zaten Genel bakış'ta açılır. Personelin alt menüsü değişmez.
 */
export function bottomNavFor(role: "admin" | "staff", opts: { assistant?: boolean; features?: readonly BranchFeature[] } = {}): BottomNavItem[] {
  const items = withSpares(BOTTOM_NAV[role], BOTTOM_SPARES[role], opts.features);
  if (role !== "admin" || !opts.assistant) return items;
  const rest = items.filter((i) => i.id !== "genel");
  return [...rest.slice(0, 2), ASSISTANT_TAB, ...rest.slice(2)];
}

/**
 * Alt menüde etkin öğe: asistan açıksa "Asistan"; çekmece açıksa "Tümü"; değilse adresle eşleşen öğe; hiçbiri
 * eşleşmiyorsa (Ürünler, Ayarlar gibi çekmecedeki bir ekran) "Tümü". Ana sayfa (`/panel`, Genel bakış) çubukta
 * değilse (yönetici, asistan açık: bottomNavFor) orada hiçbir öğe etkin değildir: girişten sonraki ilk ekranda çekmece
 * kapalıyken "Tümü" yanmasın. Çekmeceyi açan öğesi olmayan listede eşleşme yoksa null.
 */
export function bottomNavActive(items: BottomNavItem[], pathname: string, menuOpen = false, assistantOpen = false): string | null {
  const assistant = items.find((i) => i.action === "assistant");
  if (assistantOpen && assistant) return assistant.id;
  const menu = items.find((i) => !i.href && !i.action);
  if (menuOpen && menu) return menu.id;
  const hit = items.find((i) => i.href && pathMatches(pathname, i.href, i.match));
  if (hit) return hit.id;
  const home = (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname) === "/panel";
  return home ? null : (menu?.id ?? null);
}

/** Alt menüdeki "Ödemeler" rozeti: zildeki ödeme bildirimlerinden gecikmiş olanlar */
export function overdueCount(items: { group?: string; kind: string }[] | null | undefined): number {
  return (items ?? []).filter((n) => n.group === "odeme" && n.kind === "danger").length;
}

/** Rozette gösterilecek metin (9'dan fazlası "9+") */
export function badgeText(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 9 ? "9+" : String(Math.floor(n));
}

/**
 * Telefonun üst çubuğundaki kısa başlıklar; listede olmayan ekran menüdeki adını alır. Bir ekran bir ad
 * (docs/planlar/ux-sade.md §3.6): üst çubuk yalnız kısaltır, başka ad koymaz.
 */
const SHORT_TITLES: Record<string, string> = {
  "/panel": "Genel bakış",
  "/panel/urunler": "Ürünler",
  "/panel/urunler/site": "Site menüsü",
  "/panel/urunler/fiyatlar": "Fiyatlar",
  "/panel/giderler": "Sabit giderler",
  "/panel/personel": "Maaşlar",
  "/panel/harcamalar": "Harcamalar",
  "/panel/hatirlaticilar": "Ödemeler",
  "/panel/hatirlaticilar/nakit": "Nakit planı",
  "/panel/sayim": "Stok sayımı",
  // Stok sayımı'nın alt ekranı (yalnız Marina; docs/STOK-TAHMINI.md)
  "/panel/sayim/tahmini": "Tahmini stok",
  "/panel/tutarlilik": "Tutarlılık",
  "/panel/kullanicilar": "Kullanıcılar",
  "/panel/parasut": "Paraşüt",
  "/panel/onaylar": "Onaylar",
  "/panel/kontrol/gecmis": "Kontrol geçmişi",
  "/panel/kasa/fiyatlar": "Kasadaki fiyatlar",
  "/panel/kontrol/duzenle": "Listeleri düzenle",
  "/panel/karaoke/doluluk": "Doluluk",
  "/panel/komisyonlar": "Komisyonlar",
  "/panel/vergi": "Vergi, KDV, SGK",
  "/panel/vergi/gelir-gider": "Vergi kârı",
  "/panel/vergi/demirbas": "Demirbaş",
  "/panel/vergi/kurallar": "Muhasebeci",
};

/** Üst çubuk başlığı: en uzun eşleşen yol kazanır (/panel/urunler/12 → "Ürünler") */
export function mobileTitleFor(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const known = new Map<string, string>();
  for (const item of [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER]) known.set(item.href, item.label);
  for (const [href, label] of Object.entries(SHORT_TITLES)) known.set(href, label);
  let best: { href: string; label: string } | null = null;
  for (const [href, label] of known) {
    const hit = href === "/panel" ? path === "/panel" : path === href || path.startsWith(`${href}/`);
    if (hit && (!best || href.length > best.href.length)) best = { href, label };
  }
  return best?.label ?? "L'Affogato";
}

import {
  AlarmClock,
  Banknote,
  BarChart3,
  BellRing,
  Boxes,
  ChartNoAxesColumn,
  Plug,
  BookOpen,
  CalendarHeart,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Coffee,
  FileText,
  Gift,
  Globe,
  Grid3x3,
  HelpCircle,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  ListTodo,
  MicVocal,
  Package,
  Percent,
  Receipt,
  Settings,
  Store,
  Tags,
  TrendingUp,
  Truck,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

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
 * birbirine yakın ekranlar aynı öğenin altında sekme: Giderler = Sabit giderler + Personel, Stok = Sayım + Tutarlılık.
 * Adresler değişmedi.
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
      { href: "/panel/karaoke", label: "Karaoke", icon: MicVocal, roles: ["admin", "staff"], keywords: "karaoke rezervasyon sayaç süre alarm oda bar ekranı uygulama sipariş masa gel-al kurye laffogato.net" },
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
      // Personelin özel günleri (maç, AVM etkinliği, kampanya; docs/SATIS-TAHMINI.md); yönetici Satış tahmini'nde görür
      { href: "/panel/ozel-gunler", label: "Özel günler", icon: CalendarHeart, roles: ["staff"], keywords: "özel gün derbi maç avm etkinlik kampanya kafe kapalı yoğun gün" },
      // Önümüzdeki 7 günün satışı, kaç kişi, kaç tatlı (docs/SATIS-TAHMINI.md); kenar çubuğunda Kafe altında
      {
        href: "/panel/tahmin",
        label: "Satış tahmini",
        icon: TrendingUp,
        roles: ["admin"],
        keywords: "tahmin yoğunluk ciro kaç kişi personel vardiya tatlı pasta hazırlık bayram ramazan tatil okul hava durumu derbi maç kampanya özel gün",
      },
      { href: "/panel/hatirlaticilarim", label: "Hatırlatıcılarım", icon: AlarmClock, roles: ["admin", "staff"], keywords: "hatırlatma not yapılacak kişisel alarm" },
    ],
  },
  {
    title: "Menü",
    items: [
      { href: "/panel/urunler", label: "Ürünler", icon: Coffee, excel: "Ürün Kârlılık + Reçete Kartları", roles: ["admin"], keywords: "reçete kartı fiyat marj kârlılık" },
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
        match: ["/panel/tutarlilik"],
        keywords: "envanter tutarlılık fark",
      },
      { href: "/panel/zayi", label: "Zayi & ikram", icon: Gift, roles: ["admin", "staff"], keywords: "zayi fire atılan bozulan ikram ödenmez personel tadım" },
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
        label: "Giderler & personel",
        icon: Wallet,
        excel: "Sabit Giderler + Personel",
        roles: ["admin"],
        match: ["/panel/personel", "/panel/harcamalar"],
        keywords: "kira fatura maaş sgk yatırım reklam influencer harcama nakit fatura dışı aylık gider",
      },
    ],
  },
  {
    title: "Finans",
    items: [
      { href: "/panel/gelir-gider", label: "Gelir-gider", icon: CalendarRange, excel: "Genel Maliyet", roles: ["admin"], keywords: "aylık tablo kâr zarar online satış laffogato.net site uygulama ciro" },
      { href: "/panel/hatirlaticilar", label: "Ödemeler & hatırlatıcılar", icon: BellRing, roles: ["admin"], keywords: "ödeme vade kira vergi kdv sgk maaş bildirim e-posta hatırlatma haftalık özet" },
      // Ödemeler'in alt ekranı (kenar çubuğunda ayrı öğesi yok, ⌘K'da bulunur)
      {
        href: "/panel/hatirlaticilar/nakit",
        label: "Nakit planı",
        icon: ChartNoAxesColumn,
        roles: ["admin"],
        keywords: "nakit akış tahmin bakiye kalan para haftalık plan sıkışık kdv devreden",
      },
    ],
  },
];

/** Kenar çubuğunun altındaki sistem bağlantıları (kenar çubuğunda Ayarlar başlığı ve profil menüsü) */
export const NAV_FOOTER: NavItem[] = [
  { href: "/panel/parasut", label: "Paraşüt entegrasyonu", icon: Plug, roles: ["admin"], keywords: "parasut fatura eşitleme muhasebe e-fatura" },
  { href: "/panel/ayarlar", label: "Ayarlar", icon: Settings, excel: "Ayarlar", roles: ["admin"], keywords: "kdv komisyon qr menü yedek kategori laffogato.net bağlantı lafpos kasa geçiş günü" },
  { href: "/panel/kullanicilar", label: "Kullanıcılar & roller", icon: Users, roles: ["admin"], keywords: "kullanıcı rol yetki personel yönetici parola iki adımlı 2fa güvenlik" },
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
  children?: { id: string; label: string; href: string; roles: ("admin" | "staff")[]; match?: string[] }[];
}

/**
 * Ağaç (26 Eki 2026, docs/TASARIM.md "Menü ağacı"): yöneticide en sık açılan dört ekran (Genel bakış, Bugün, Onaylar,
 * Kasa raporu) tek tıkla üst düzeyde, gerisi konu başlıkları altında: işletme (Kafe, Menü, Stok), para (Satış, Alış &
 * gider, Finans), Ayarlar. Başlık satırı yalnız grubu açıp kapatır; etkin sayfanın grubu kendiliğinden açık
 * (sidebar-nav.tsx). Personelin ağacı aynı kalır: üst düzey öğeleri (Karaoke, Kontrol listeleri, Hatırlatıcılarım)
 * yalnız personelde, yönetici aynı ekranları Kafe altında görür. Personelin görebildiği düğümlerin sırası değişmez
 * (tests/kenar-cubugu.test.ts personelin ağacını olduğu gibi sabitler). Adresler değişmedi, yalnız gruplama.
 */
export const NAV_TREE: NavNode[] = [
  { id: "genel", label: "Genel bakış", icon: LayoutDashboard, href: "/panel", roles: ["admin"] },
  // Günün işleri (docs/BUGUN.md); personelde ağacın ilk öğesi ve girişte açılan ekran
  { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun", roles: ["admin", "staff"] },
  // Personelin istekleri ve reçete önerileri (docs/ONAYLAR.md); yalnız yönetici, Bugün'ün hemen altında
  { id: "onaylar", label: "Onaylar", icon: ClipboardCheck, href: "/panel/onaylar", roles: ["admin"] },
  // Personelin üst düzey öğesi; yönetici Kafe altında görür
  { id: "karaoke", label: "Karaoke", icon: MicVocal, href: "/panel/karaoke", roles: ["staff"] },
  // Gün sonu kasa raporu: iki rolde de üst düzeyde, tek tıkla
  { id: "kasa", label: "Kasa raporu", icon: Banknote, href: "/panel/kasa", roles: ["admin", "staff"] },
  // Açılış ve kapanış listeleri (docs/KONTROL-LISTELERI.md); personelde üst düzeyde, yönetici Kafe altında görür
  { id: "kontrol", label: "Kontrol listeleri", icon: ListChecks, href: "/panel/kontrol", roles: ["staff"] },
  // Personelin özel günleri; yönetici aynı listeyi Satış tahmini'nde düzenler
  { id: "ozel-gunler", label: "Özel günler", icon: CalendarHeart, href: "/panel/ozel-gunler", roles: ["staff"] },
  {
    // Kafenin günlük işleyişi: karaoke odası, açılış / kapanış, önümüzdeki günlerin tahmini, kişisel hatırlatıcılar
    id: "kafe",
    label: "Kafe",
    icon: Store,
    roles: ["admin"],
    children: [
      { id: "karaoke-yonetici", label: "Karaoke", href: "/panel/karaoke", roles: ["admin", "staff"] },
      { id: "kontrol-listeleri", label: "Kontrol listeleri", href: "/panel/kontrol", roles: ["admin", "staff"] },
      { id: "tahmin", label: "Satış tahmini", href: "/panel/tahmin", roles: ["admin"] },
      { id: "hatirlaticilarim-yonetici", label: "Hatırlatıcılarım", href: "/panel/hatirlaticilarim", roles: ["admin", "staff"] },
    ],
  },
  {
    id: "menu",
    label: "Menü",
    icon: Coffee,
    roles: ["admin", "staff"],
    children: [
      { id: "urunler", label: "Ürünler", href: "/panel/urunler", roles: ["admin"] },
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
      { id: "giderler", label: "Giderler & personel", href: "/panel/giderler", roles: ["admin"], match: ["/panel/personel", "/panel/harcamalar"] },
    ],
  },
  {
    // Aylık tablo, ödemeler ve nakit planı (Ödemeler'in sekmesi); Vergi de buraya gelecek (docs/planlar/vergi.md)
    id: "finans",
    label: "Finans",
    icon: Landmark,
    roles: ["admin"],
    children: [
      { id: "gelir-gider", label: "Gelir-gider", href: "/panel/gelir-gider", roles: ["admin"] },
      { id: "hatirlaticilar", label: "Ödemeler & hatırlatıcılar", href: "/panel/hatirlaticilar", roles: ["admin"] },
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
 * Bölüm içi sekmeler: aynı menü öğesinin altındaki ekranlar. Stok sekmeleri kenar çubuğunun Stok grubundan türer
 * (denetim E-56, 27 Eki 2026): menüye eklenen ya da çıkan Stok sayfası sekmelerde de aynı sırayla görünür; telefonda
 * (kenar çubuğu gizli) Sayım, Zayi & ikram ve Tutarlılık arasında hamburger menü açmadan geçilir. Giderler'in
 * sekmeleri kenar çubuğunda tek öğedir (Giderler & personel), o yüzden elle. Vergi'nin dört ekranı da kenar
 * çubuğunda tek öğedir (Finans › Vergi; alt ekranlar adresin önekiyle eşleşir), yalnız yönetici (docs/planlar/vergi.md §4.0).
 */
export const SECTION_TABS: Record<"giderler" | "stok" | "vergi", readonly SectionTab[]> = {
  giderler: [
    { href: "/panel/giderler", label: "Sabit giderler", roles: ["admin"] },
    { href: "/panel/harcamalar", label: "Aylık harcamalar", roles: ["admin"] },
    { href: "/panel/personel", label: "Personel", roles: ["admin"] },
  ],
  stok: treeTabs("stok"),
  vergi: [
    { href: "/panel/vergi", label: "Özet", roles: ["admin"] },
    { href: "/panel/vergi/gelir-gider", label: "Vergiye göre", roles: ["admin"] },
    { href: "/panel/vergi/demirbas", label: "Demirbaş", roles: ["admin"] },
    { href: "/panel/vergi/kurallar", label: "Kurallar", roles: ["admin"] },
  ],
};

/** Kişinin açabildiği sekmeler (personel Tutarlılık'ı görmez); tek sekme kalırsa sekme çubuğu çizilmez (boş dizi) */
export function sectionTabsFor(section: keyof typeof SECTION_TABS, role: "admin" | "staff"): SectionTab[] {
  const tabs = SECTION_TABS[section].filter((t) => t.roles.includes(role));
  return tabs.length > 1 ? tabs : [];
}

/** Ağacı role göre süzer; tek alt sayfası kalan grup doğrudan o sayfaya bağlanır */
export function navTreeFor(role: "admin" | "staff"): NavNode[] {
  return NAV_TREE.filter((n) => n.roles.includes(role))
    .map((n) => (n.children ? { ...n, children: n.children.filter((c) => c.roles.includes(role)) } : n))
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
 * Telefon ve tabletteki alt menü (lg altında), beş öğe. Yönetici: dört sık ekran + "Menü" (çekmeceyi açar, her şey
 * orada; ayda bir açılan Satışlar ve Faturalar da). Personel: günün beş ekranı; Sayım ve Hatırlatıcılarım çekmecede
 * (üst çubuktaki menü düğmesi), Sayım Zayi'nin Stok sekmelerinde de; ay sonu sayımı gerektiği gün Bugün'de satır olarak çıkar. `badge: "overdue"` öğesinde
 * gecikmiş ödeme sayısı görünür.
 */
export interface BottomNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Yoksa öğe bağlantı değil, çekmeceyi açan düğmedir */
  href?: string;
  match?: string[];
  badge?: "overdue";
}

export const BOTTOM_NAV: Record<"admin" | "staff", BottomNavItem[]> = {
  admin: [
    { id: "genel", label: "Genel bakış", icon: LayoutDashboard, href: "/panel" },
    { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun" },
    { id: "kasa", label: "Kasa", icon: Banknote, href: "/panel/kasa" },
    { id: "odemeler", label: "Ödemeler", icon: BellRing, href: "/panel/hatirlaticilar", badge: "overdue" },
    { id: "menu", label: "Menü", icon: LayoutGrid },
  ],
  // Günün işleri; Sayım ve Hatırlatıcılarım çekmece menüde (Sayım Zayi'nin sekmesinde, Hatırlatıcılarım zilde de), Hesabım profil menüsünde
  staff: [
    { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun" },
    { id: "karaoke", label: "Karaoke", icon: MicVocal, href: "/panel/karaoke" },
    { id: "kasa", label: "Kasa", icon: Banknote, href: "/panel/kasa" },
    { id: "zayi", label: "Zayi", icon: Gift, href: "/panel/zayi" },
    { id: "receteler", label: "Reçeteler", icon: BookOpen, href: "/panel/receteler" },
  ],
};

/**
 * Alt menüde etkin öğe: çekmece açıksa "Menü"; değilse adresle eşleşen öğe; hiçbiri eşleşmiyorsa (Ürünler,
 * Ayarlar gibi çekmecedeki bir ekran) "Menü". Menü öğesi olmayan listede eşleşme yoksa null.
 */
export function bottomNavActive(items: BottomNavItem[], pathname: string, menuOpen = false): string | null {
  const menu = items.find((i) => !i.href);
  if (menuOpen && menu) return menu.id;
  const hit = items.find((i) => i.href && pathMatches(pathname, i.href, i.match));
  return hit?.id ?? menu?.id ?? null;
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

/** Telefonun üst çubuğundaki kısa başlıklar; listede olmayan ekran menüdeki adını alır */
const SHORT_TITLES: Record<string, string> = {
  "/panel": "Genel bakış",
  "/panel/urunler": "Ürünler",
  "/panel/urunler/site": "Site menüsü",
  "/panel/urunler/fiyatlar": "Fiyatlar",
  "/panel/giderler": "Sabit giderler",
  "/panel/personel": "Personel",
  "/panel/harcamalar": "Harcamalar",
  "/panel/hatirlaticilar": "Ödemeler",
  "/panel/hatirlaticilar/nakit": "Nakit planı",
  "/panel/sayim": "Stok sayımı",
  "/panel/tutarlilik": "Tutarlılık",
  "/panel/kullanicilar": "Kullanıcılar",
  "/panel/parasut": "Paraşüt",
  "/panel/onaylar": "Onaylar",
  "/panel/kontrol/gecmis": "Kontrol geçmişi",
  "/panel/kasa/fiyatlar": "Kasadaki fiyatlar",
  "/panel/kontrol/duzenle": "Listeleri düzenle",
  "/panel/karaoke/doluluk": "Doluluk",
  "/panel/komisyonlar": "Komisyonlar",
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

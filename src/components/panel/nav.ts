import {
  AlarmClock,
  Banknote,
  BarChart3,
  BellRing,
  Boxes,
  ChartNoAxesColumn,
  Plug,
  BookOpen,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  Coffee,
  FileText,
  Gift,
  Globe,
  Grid3x3,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  ListTodo,
  MicVocal,
  Package,
  Receipt,
  Settings,
  ShoppingBasket,
  Tags,
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
 * Sadeleştirilmiş menü: 15 ekran 10 öğeye indi. Birbirine yakın ekranlar aynı öğenin altında sekme oldu:
 * Giderler = Sabit giderler + Personel, Stok = Sayım + Tutarlılık. Adresler değişmedi.
 */
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Genel",
    items: [
      { href: "/panel", label: "Genel bakış", icon: LayoutDashboard, excel: "Panel", roles: ["admin"], keywords: "panel özet dashboard kâr zarar başabaş" },
      { href: "/panel/analiz", label: "Analiz & senaryo", icon: BarChart3, roles: ["admin"], keywords: "menü mühendisliği senaryo simülatör" },
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
      { href: "/panel/onaylar", label: "Reçete onayları", icon: ClipboardCheck, roles: ["admin"], keywords: "onay bekleyen reçete değişikliği personel önerisi" },
    ],
  },
  {
    title: "Günlük",
    items: [
      {
        href: "/panel/bugun",
        label: "Bugün",
        icon: ListTodo,
        roles: ["admin", "staff"],
        keywords: "bugün yapılacaklar günün işleri liste kontrol kasa zayi sayım",
      },
      { href: "/panel/karaoke", label: "Karaoke", icon: MicVocal, roles: ["admin", "staff"], keywords: "karaoke rezervasyon sayaç süre alarm oda bar ekranı uygulama sipariş masa gel-al kurye laffogato.net" },
      // Karaoke'nin alt ekranı, yalnız yönetici (kenar çubuğunda ayrı öğesi yok, ⌘K'da bulunur; docs/KARAOKE.md)
      {
        href: "/panel/karaoke/doluluk",
        label: "Karaoke doluluğu",
        icon: Grid3x3,
        roles: ["admin"],
        keywords: "karaoke doluluk ısı haritası boş saat dolu saat oda gelir saat başı uzatma iptal son dakika rezervasyon kaç gün önceden ay karşılaştırma",
      },
      { href: "/panel/kasa", label: "Kasa raporu", icon: Banknote, roles: ["admin", "staff"], keywords: "kasa z raporu gün sonu modpos nakit sayım eksik fazla kapanış whatsapp" },
      {
        href: "/panel/kontrol",
        label: "Kontrol listeleri",
        icon: ListChecks,
        roles: ["admin", "staff"],
        keywords: "açılış kapanış kontrol listesi checklist temizlik hijyen buzdolabı sıcaklık derece haccp denetim fotoğraf mikrofon",
      },
      { href: "/panel/hatirlaticilarim", label: "Hatırlatıcılarım", icon: AlarmClock, roles: ["admin", "staff"], keywords: "hatırlatma not yapılacak kişisel alarm" },
    ],
  },
  {
    title: "Para",
    items: [
      { href: "/panel/satislar", label: "Satışlar", icon: Receipt, excel: "Satış Raporu", roles: ["admin"], keywords: "pos rapor içe aktar" },
      { href: "/panel/faturalar", label: "Faturalar", icon: FileText, excel: "Faturalar", roles: ["admin"], keywords: "alış tedarikçi gider" },
      {
        href: "/panel/tedarikciler",
        label: "Tedarikçiler",
        icon: Truck,
        roles: ["admin"],
        keywords: "cari hesap kart unvan vergi no vkn vergi dairesi iban banka telefon borç bakiye ödeme talebi ödendi ödenmedi vade",
      },
      { href: "/panel/gelir-gider", label: "Gelir-gider", icon: CalendarRange, excel: "Genel Maliyet", roles: ["admin"], keywords: "aylık tablo kâr zarar online satış laffogato.net site uygulama ciro" },
      // Ödemeler'in alt ekranı (kenar çubuğunda ayrı öğesi yok, ⌘K'da bulunur)
      {
        href: "/panel/hatirlaticilar/nakit",
        label: "Nakit planı",
        icon: ChartNoAxesColumn,
        roles: ["admin"],
        keywords: "nakit akış tahmin bakiye kalan para haftalık plan sıkışık kdv devreden",
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
      // Haftalık kısa sayım ve mal siparişi (docs/MAL-SIPARISI.md); "Sipariş" tek başına uygulama siparişi demek
      {
        href: "/panel/hizli-sayim",
        label: "Hızlı sayım",
        icon: ClipboardPen,
        roles: ["admin", "staff"],
        keywords: "haftalık sayım kritik kalem eldeki stok sipariş öncesi gelen mal geldi",
      },
      {
        href: "/panel/mal-siparisi",
        label: "Mal siparişi",
        icon: ShoppingBasket,
        roles: ["admin"],
        keywords: "sipariş öneri tedarikçi whatsapp hedef stok en az teslim kontrolü eksik fazla fiyat farkı gönderilenler kalemler",
      },
      { href: "/panel/zayi", label: "Zayi & ikram", icon: Gift, roles: ["admin", "staff"], keywords: "zayi fire atılan bozulan ikram ödenmez personel tadım" },
    ],
  },
];

/** Kenar çubuğunun altındaki sistem bağlantıları */
export const NAV_FOOTER: NavItem[] = [
  { href: "/panel/hatirlaticilar", label: "Ödemeler & hatırlatıcılar", icon: BellRing, roles: ["admin"], keywords: "ödeme vade kira vergi kdv sgk maaş bildirim e-posta hatırlatma" },
  { href: "/panel/parasut", label: "Paraşüt entegrasyonu", icon: Plug, roles: ["admin"], keywords: "parasut fatura eşitleme muhasebe e-fatura" },
  { href: "/panel/ayarlar", label: "Ayarlar", icon: Settings, excel: "Ayarlar", roles: ["admin"], keywords: "kdv komisyon qr menü yedek kategori laffogato.net bağlantı" },
  { href: "/panel/kullanicilar", label: "Kullanıcılar & roller", icon: Users, roles: ["admin"], keywords: "kullanıcı rol yetki personel yönetici parola iki adımlı 2fa güvenlik" },
  { href: "/panel/yardim", label: "Yardım", icon: HelpCircle, excel: "Nasıl Kullanılır", roles: ["admin"], keywords: "nasıl kullanılır" },
  { href: "/panel/hesap", label: "Hesabım", icon: UserRound, roles: ["admin", "staff"], keywords: "parola şifre e-posta iki adımlı doğrulama 2fa authenticator" },
];

/** Bölüm içi sekmeler: aynı menü öğesinin altındaki ekranlar */
export const SECTION_TABS = {
  giderler: [
    { href: "/panel/giderler", label: "Sabit giderler" },
    { href: "/panel/harcamalar", label: "Aylık harcamalar" },
    { href: "/panel/personel", label: "Personel" },
  ],
  stok: [
    { href: "/panel/sayim", label: "Sayım" },
    { href: "/panel/tutarlilik", label: "Tutarlılık" },
  ],
  // Mal siparişi (docs/MAL-SIPARISI.md); Hızlı sayım personele de açık, sekmeleri yalnız yöneticiye çizilir
  malSiparisi: [
    { href: "/panel/mal-siparisi", label: "Sipariş listesi" },
    { href: "/panel/hizli-sayim", label: "Hızlı sayım" },
    { href: "/panel/mal-siparisi/gonderilen", label: "Gönderilenler" },
    { href: "/panel/mal-siparisi/kalemler", label: "Kalemler" },
  ],
} as const;

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

export const NAV_TREE: NavNode[] = [
  { id: "genel", label: "Genel bakış", icon: LayoutDashboard, href: "/panel", roles: ["admin"] },
  // Günün işleri (docs/BUGUN.md); personelde ağacın ilk öğesi ve girişte açılan ekran
  { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun", roles: ["admin", "staff"] },
  { id: "karaoke", label: "Karaoke", icon: MicVocal, href: "/panel/karaoke", roles: ["admin", "staff"] },
  // Personelde üst düzeyde; yönetici Satış & gider altında görür (aynı ekran)
  { id: "kasa", label: "Kasa raporu", icon: Banknote, href: "/panel/kasa", roles: ["staff"] },
  // Açılış ve kapanış listeleri (docs/KONTROL-LISTELERI.md); iki rolde de üst düzeyde
  { id: "kontrol", label: "Kontrol listeleri", icon: ListChecks, href: "/panel/kontrol", roles: ["admin", "staff"] },
  {
    id: "menu",
    label: "Menü",
    icon: Coffee,
    roles: ["admin", "staff"],
    children: [
      { id: "urunler", label: "Ürünler", href: "/panel/urunler", roles: ["admin"] },
      { id: "hammaddeler", label: "Hammaddeler", href: "/panel/hammaddeler", roles: ["admin"] },
      { id: "receteler", label: "Reçete defteri", href: "/panel/receteler", roles: ["admin", "staff"] },
      { id: "onaylar", label: "Reçete onayları", href: "/panel/onaylar", roles: ["admin"] },
    ],
  },
  {
    id: "para",
    label: "Satış & gider",
    icon: Wallet,
    roles: ["admin"],
    children: [
      // Ekran personele de açık; personel bu grubu görmez, kendi üst düzey "Kasa raporu" öğesinden girer
      { id: "kasa-raporlari", label: "Kasa raporları", href: "/panel/kasa", roles: ["admin", "staff"] },
      { id: "satislar", label: "Satışlar", href: "/panel/satislar", roles: ["admin"] },
      { id: "faturalar", label: "Faturalar", href: "/panel/faturalar", roles: ["admin"] },
      { id: "tedarikciler", label: "Tedarikçiler", href: "/panel/tedarikciler", roles: ["admin"] },
      { id: "gelir-gider", label: "Gelir-gider", href: "/panel/gelir-gider", roles: ["admin"] },
      { id: "giderler", label: "Giderler & personel", href: "/panel/giderler", roles: ["admin"], match: ["/panel/personel", "/panel/harcamalar"] },
      { id: "hatirlaticilar", label: "Ödemeler & hatırlatıcılar", href: "/panel/hatirlaticilar", roles: ["admin"] },
    ],
  },
  {
    id: "stok",
    label: "Stok",
    icon: Boxes,
    roles: ["admin", "staff"],
    children: [
      { id: "sayim", label: "Stok sayımı", href: "/panel/sayim", roles: ["admin", "staff"] },
      { id: "hizli-sayim", label: "Hızlı sayım", href: "/panel/hizli-sayim", roles: ["admin", "staff"] },
      { id: "mal-siparisi", label: "Mal siparişi", href: "/panel/mal-siparisi", roles: ["admin"] },
      { id: "zayi", label: "Zayi & ikram", href: "/panel/zayi", roles: ["admin", "staff"] },
      { id: "tutarlilik", label: "Tutarlılık", href: "/panel/tutarlilik", roles: ["admin"] },
    ],
  },
  { id: "hatirlaticilarim", label: "Hatırlatıcılarım", icon: AlarmClock, href: "/panel/hatirlaticilarim", roles: ["admin", "staff"] },
  { id: "analiz", label: "Analiz & senaryo", icon: BarChart3, href: "/panel/analiz", roles: ["admin"] },
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
];

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
 * (üst çubuktaki menü düğmesi), ay sonu sayımı gerektiği gün Bugün'de satır olarak çıkar. `badge: "overdue"` öğesinde
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
  // Günün işleri; Sayım ve Hatırlatıcılarım çekmece menüde (Hatırlatıcılarım zilde de), Hesabım profil menüsünde
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
  "/panel/onaylar": "Reçete onayları",
  "/panel/kontrol/gecmis": "Kontrol geçmişi",
  "/panel/kontrol/duzenle": "Listeleri düzenle",
  "/panel/karaoke/doluluk": "Doluluk",
  "/panel/mal-siparisi": "Mal siparişi",
  "/panel/mal-siparisi/gonderilen": "Gönderilenler",
  "/panel/mal-siparisi/kalemler": "Sipariş kalemleri",
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

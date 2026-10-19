import {
  BarChart3,
  BellRing,
  Boxes,
  Plug,
  BookOpen,
  CalendarRange,
  ClipboardList,
  Coffee,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
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
      { href: "/panel/hammaddeler", label: "Hammaddeler", icon: Package, excel: "Hammaddeler", roles: ["admin"], keywords: "birim fiyat tedarikçi" },
      { href: "/panel/receteler", label: "Reçete defteri", icon: BookOpen, roles: ["admin", "staff"], keywords: "barista tarif" },
    ],
  },
  {
    title: "Para",
    items: [
      { href: "/panel/satislar", label: "Satışlar", icon: Receipt, excel: "Satış Raporu", roles: ["admin"], keywords: "pos rapor içe aktar" },
      { href: "/panel/faturalar", label: "Faturalar", icon: FileText, excel: "Faturalar", roles: ["admin"], keywords: "alış tedarikçi gider" },
      { href: "/panel/gelir-gider", label: "Gelir-gider", icon: CalendarRange, excel: "Genel Maliyet", roles: ["admin"], keywords: "aylık tablo kâr zarar" },
      {
        href: "/panel/giderler",
        label: "Giderler & personel",
        icon: Wallet,
        excel: "Sabit Giderler + Personel",
        roles: ["admin"],
        match: ["/panel/personel"],
        keywords: "kira fatura maaş sgk yatırım",
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
    ],
  },
];

/** Kenar çubuğunun altındaki sistem bağlantıları */
export const NAV_FOOTER: NavItem[] = [
  { href: "/panel/hatirlaticilar", label: "Ödemeler & hatırlatıcılar", icon: BellRing, roles: ["admin"], keywords: "ödeme vade kira vergi kdv sgk maaş bildirim e-posta hatırlatma" },
  { href: "/panel/parasut", label: "Paraşüt entegrasyonu", icon: Plug, roles: ["admin"], keywords: "parasut fatura eşitleme muhasebe e-fatura" },
  { href: "/panel/ayarlar", label: "Ayarlar", icon: Settings, excel: "Ayarlar", roles: ["admin"], keywords: "kdv komisyon qr menü yedek kategori" },
  { href: "/panel/kullanicilar", label: "Kullanıcılar & roller", icon: Users, roles: ["admin"], keywords: "kullanıcı rol yetki personel yönetici parola iki adımlı 2fa güvenlik" },
  { href: "/panel/yardim", label: "Yardım", icon: HelpCircle, excel: "Nasıl Kullanılır", roles: ["admin"], keywords: "nasıl kullanılır" },
  { href: "/panel/hesap", label: "Hesabım", icon: UserRound, roles: ["admin", "staff"], keywords: "parola şifre e-posta iki adımlı doğrulama 2fa authenticator" },
];

/** Bölüm içi sekmeler: aynı menü öğesinin altındaki ekranlar */
export const SECTION_TABS = {
  giderler: [
    { href: "/panel/giderler", label: "Sabit giderler" },
    { href: "/panel/personel", label: "Personel" },
  ],
  stok: [
    { href: "/panel/sayim", label: "Sayım" },
    { href: "/panel/tutarlilik", label: "Tutarlılık" },
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
    id: "para",
    label: "Satış & gider",
    icon: Wallet,
    roles: ["admin"],
    children: [
      { id: "satislar", label: "Satışlar", href: "/panel/satislar", roles: ["admin"] },
      { id: "faturalar", label: "Faturalar", href: "/panel/faturalar", roles: ["admin"] },
      { id: "gelir-gider", label: "Gelir-gider", href: "/panel/gelir-gider", roles: ["admin"] },
      { id: "giderler", label: "Giderler & personel", href: "/panel/giderler", roles: ["admin"], match: ["/panel/personel"] },
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
      { id: "tutarlilik", label: "Tutarlılık", href: "/panel/tutarlilik", roles: ["admin"] },
    ],
  },
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

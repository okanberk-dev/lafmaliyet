import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarRange,
  ClipboardList,
  Coffee,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Excel'deki karşılığı */
  excel?: string;
  roles: ("admin" | "staff")[];
}

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Genel",
    items: [{ href: "/panel", label: "Panel", icon: LayoutDashboard, excel: "Panel", roles: ["admin"] }],
  },
  {
    title: "Menü & maliyet",
    items: [
      { href: "/panel/urunler", label: "Ürünler & kârlılık", icon: Coffee, excel: "Ürün Kârlılık + Reçete Kartları", roles: ["admin"] },
      { href: "/panel/hammaddeler", label: "Hammaddeler", icon: Package, excel: "Hammaddeler", roles: ["admin"] },
      { href: "/panel/receteler", label: "Reçete defteri", icon: BookOpen, roles: ["admin", "staff"] },
    ],
  },
  {
    title: "Satış & alış",
    items: [
      { href: "/panel/satislar", label: "Satışlar", icon: Receipt, excel: "Satış Raporu", roles: ["admin"] },
      { href: "/panel/faturalar", label: "Faturalar", icon: FileText, excel: "Faturalar", roles: ["admin"] },
    ],
  },
  {
    title: "Muhasebe",
    items: [
      { href: "/panel/gelir-gider", label: "Gelir-gider", icon: CalendarRange, excel: "Genel Maliyet", roles: ["admin"] },
      { href: "/panel/giderler", label: "Sabit giderler", icon: Building2, excel: "Sabit Giderler", roles: ["admin"] },
      { href: "/panel/personel", label: "Personel", icon: Users, excel: "Personel", roles: ["admin"] },
    ],
  },
  {
    title: "Kontrol",
    items: [
      { href: "/panel/sayim", label: "Stok sayımı", icon: ClipboardList, excel: "Sayım", roles: ["admin", "staff"] },
      { href: "/panel/tutarlilik", label: "Tutarlılık", icon: ShieldCheck, excel: "Tutarlılık Kontrolü", roles: ["admin"] },
      { href: "/panel/analiz", label: "Analiz & senaryo", icon: BarChart3, roles: ["admin"] },
    ],
  },
  {
    title: "Sistem",
    items: [
      { href: "/panel/ayarlar", label: "Ayarlar", icon: Settings, excel: "Ayarlar", roles: ["admin"] },
      { href: "/panel/hesap", label: "Hesabım", icon: UserRound, roles: ["admin", "staff"] },
      { href: "/panel/yardim", label: "Yardım", icon: HelpCircle, excel: "Nasıl Kullanılır", roles: ["admin"] },
    ],
  },
];

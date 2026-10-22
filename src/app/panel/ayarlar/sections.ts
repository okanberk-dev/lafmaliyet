import { Droplets, Globe, HardDriveDownload, History, Percent, QrCode, Ruler, Tags, Users, type LucideIcon } from "lucide-react";

/**
 * Ayarlar sayfasının bölümleri: kenardaki gezinme bu sırayla listelenir, her kart `id` olarak bunu taşır.
 * Sunucu bileşeni (kartlar) ve istemci gezinmesi aynı listeyi okusun diye ayrı, düz bir modülde.
 */
export const SETTINGS_SECTIONS = [
  // Kullanıcı yönetimi ayrı sayfada; bu bölüm oraya giden kart
  { id: "kullanicilar", label: "Kullanıcılar", icon: Users },
  { id: "oranlar", label: "Oranlar", icon: Percent },
  { id: "olculer", label: "Reçete ölçüleri", icon: Ruler },
  { id: "su", label: "Su + buz", icon: Droplets },
  { id: "qr-menu", label: "QR menü", icon: QrCode },
  { id: "kategoriler", label: "Kategoriler", icon: Tags },
  { id: "gecmis", label: "İşlem geçmişi", icon: History },
  // laffogato.net bağlantılarının durumu (karaoke, menü, siparişler, online satışlar) ve sitenin paneli
  { id: "site", label: "laffogato.net", icon: Globe },
  { id: "yedek", label: "Yedek", icon: HardDriveDownload },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * Bölüm kartlarının kaydırma payı: telefonda yalnızca üst çubuk (bölüm şeridi yok, bölümler akordeon), tablette
 * üst çubuk + bölüm şeridi, geniş ekranda yalnızca boşluk
 */
export const SECTION_SCROLL_MARGIN = "scroll-mt-20 sm:scroll-mt-32 lg:scroll-mt-20 xl:scroll-mt-8";

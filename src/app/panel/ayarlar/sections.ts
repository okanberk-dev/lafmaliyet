import { Droplets, HardDriveDownload, History, Percent, QrCode, Ruler, Tags, type LucideIcon } from "lucide-react";

/**
 * Ayarlar sayfasının bölümleri: kenardaki gezinme bu sırayla listelenir, her kart `id` olarak bunu taşır.
 * Sunucu bileşeni (kartlar) ve istemci gezinmesi aynı listeyi okusun diye ayrı, düz bir modülde.
 */
export const SETTINGS_SECTIONS = [
  { id: "oranlar", label: "Oranlar", icon: Percent },
  { id: "olculer", label: "Reçete ölçüleri", icon: Ruler },
  { id: "su", label: "Su + buz", icon: Droplets },
  { id: "qr-menu", label: "QR menü", icon: QrCode },
  { id: "kategoriler", label: "Kategoriler", icon: Tags },
  { id: "gecmis", label: "İşlem geçmişi", icon: History },
  { id: "yedek", label: "Yedek", icon: HardDriveDownload },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Bölüm kartlarının kaydırma payı: telefonda üst çubuk + bölüm şeridi, geniş ekranda yalnızca boşluk */
export const SECTION_SCROLL_MARGIN = "scroll-mt-32 lg:scroll-mt-20 xl:scroll-mt-8";

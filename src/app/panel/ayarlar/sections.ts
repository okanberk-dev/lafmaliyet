import { Droplets, Globe, HardDriveDownload, History, Layers, Percent, QrCode, ReceiptTurkishLira, Ruler, ScanText, Store, Tags, Timer, Users, type LucideIcon } from "lucide-react";

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
  // Ay sonu stoğunun değerleme yöntemi: ilk giren ilk çıkar (FIFO) başlangıç ayı (docs/STOK-DEGERLEME.md)
  { id: "stok", label: "Stok değerleme", icon: Layers },
  { id: "kategoriler", label: "Kategoriler", icon: Tags },
  { id: "gecmis", label: "İşlem geçmişi", icon: History },
  // Zamanlanmış işlerin (Paraşüt eşitlemesi, sabah işi) son çalışması; uyarılar buraya getirir
  { id: "isler", label: "Günlük işler", icon: Timer },
  // laffogato.net bağlantılarının durumu (karaoke, menü, siparişler, online satışlar) ve sitenin paneli
  { id: "site", label: "laffogato.net", icon: Globe },
  // Kafenin kasası LafPOS: bağlantının durumu, son ret ve günü silme, LafPOS'a geçiş günü (docs/LAFPOS.md)
  { id: "lafpos", label: "LafPOS (kasa)", icon: Store },
  // ModPOS'un kasa föyü (API, günde 2 çekim): durum, kalan hak, "Bu günü çek", son günler, ay rakamına yedek (docs/MODPOS-API.md)
  { id: "modpos", label: "ModPOS (kasa föyü)", icon: ReceiptTurkishLira },
  // Z raporu, POS fişi ve kasadan çıkan fişlerin fotoğraftan okunması (Claude): aç / kapat, günlük sınır, tutar
  { id: "foto", label: "Fotoğraftan okuma", icon: ScanText },
  { id: "yedek", label: "Yedek", icon: HardDriveDownload },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * Bölüm kartlarının kaydırma payı: telefonda yalnızca üst çubuk (bölüm şeridi yok, bölümler akordeon), tablette
 * üst çubuk + bölüm şeridi, geniş ekranda yalnızca boşluk
 */
export const SECTION_SCROLL_MARGIN = "scroll-mt-20 sm:scroll-mt-32 lg:scroll-mt-20 xl:scroll-mt-8";

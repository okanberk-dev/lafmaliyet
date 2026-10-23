import type { MetadataRoute } from "next";

/**
 * Web uygulaması bildirimi (/manifest.webmanifest): panel telefonun ana ekranına eklenince kendi penceresinde açılır.
 * Renkler tasarım belirteçlerinden (globals.css --background: beyaz zemin); ikonlar uygulama ikonundan
 * (src/app/icon.png) üretildi: public/icons/icon-192.png, icon-512.png. Logo ikonun merkezindeki güvenli alanın
 * (çapın %80'i) içinde kaldığı için aynı görsel "maskable" olarak da kullanılır. Panel arama motorlarına kapalı kalır
 * (robots.ts, X-Robots-Tag); bildirim yalnızca kurulum içindir.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/panel",
    name: "L'Affogato Yönetim",
    short_name: "L'Affogato",
    description: "L'Affogato maliyet, kârlılık ve stok yönetim paneli",
    lang: "tr",
    dir: "ltr",
    start_url: "/panel",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Uzun basınca açılan kısayollar: günün ekranları (iki rol). Personel yöneticinin ekranına (Ödemeler) dokunursa proxy
    // onu kendi ana ekranına (Bugün) götürür
    shortcuts: [
      { name: "Bugün", url: "/panel/bugun", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Kasa raporu", url: "/panel/kasa", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Ödemeler", url: "/panel/hatirlaticilar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Karaoke", url: "/panel/karaoke", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Stok sayımı", url: "/panel/sayim", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}

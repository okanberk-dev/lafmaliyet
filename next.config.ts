import type { NextConfig } from "next";

/** Panelin tek adresi; Vercel'in proje adresi (lafmaliyet.vercel.app) buraya yönlenir */
const PANEL_HOST = "ladmin.laffogato.net";

const SECURITY_HEADERS = [
  // Arama motorlarına kapalı: dizine ekleme, bağlantı izleme, önbellek, önizleme, görsel yok
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

/**
 * Panel sayfalarında mikrofon yalnız bu site için açık: Chrome hoparlörlerin adını (uyarıların hangi hoparlörden
 * çalacağı seçilsin diye, ör. müzik Bluetooth'tayken bilgisayarın kendi hoparlörü) ancak mikrofon izniyle gösterir.
 * Mikrofon hiçbir yerde kullanılmaz; izin istenince açılan akış hemen kapatılır (src/components/panel/live/output-client.ts).
 */
const PANEL_PERMISSIONS = { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" };

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Yalnız geliştirmede: Next göstergesi sol altta telefonun alt menüsündeki "Genel bakış"ı örtüyordu. Sol üstte
  // yalnızca üst çubuktaki L'Af karosuyla (ana sayfa bağlantısı, alt menüde de var) çakışır.
  devIndicators: { position: "top-left" },
  // Satış raporu Server Action ile yüklenir (en fazla 4 MB, src/app/panel/satislar/sales-logic.ts); varsayılan 1 MB
  // yerine dosya + form payı. Vercel 4,5 MB üstünü zaten reddeder.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  turbopack: {
    rules: {
      "*.css": {
        // CSS modülleri (Arc UI grafikleri, src/components/arc) Tailwind'den geçmez: `as: "*.css"` onları
        // `*.module.css.css` yapıp düz CSS'e çevirirdi (sınıf adları kapsamsız kalırdı)
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    // Aynı başlık iki kurala uyarsa sonraki geçerli: panelde yalnız Permissions-Policy değişir
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/panel/:path*", headers: [PANEL_PERMISSIONS] },
      { source: "/panel", headers: [PANEL_PERMISSIONS] },
    ];
  },
  async redirects() {
    // Yalnızca sayfalar; zamanlanmış işler (/api/cron) yönlendirmeyi izlemediği için /api hariç
    return [
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "lafmaliyet.vercel.app" }],
        destination: `https://${PANEL_HOST}/:path`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

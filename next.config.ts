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

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Yalnız geliştirmede: Next göstergesi sol altta telefonun alt menüsündeki "Genel bakış"ı örtüyordu. Sol üstte
  // yalnızca üst çubuktaki L'Af karosuyla (ana sayfa bağlantısı, alt menüde de var) çakışır.
  devIndicators: { position: "top-left" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
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

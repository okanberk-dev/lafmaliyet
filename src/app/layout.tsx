import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TopLayerToaster } from "@/components/ui/toaster";

import "./globals.css";

// AkmanOS'un yazı tipleri: Geist Sans ve Geist Mono
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ladmin.laffogato.net"),
  title: {
    default: "L'Affogato Yönetim",
    template: "%s · L'Affogato",
  },
  description: "L'Affogato maliyet, kârlılık ve stok yönetim paneli",
  applicationName: "L'Affogato Yönetim",
  // Panel arama motorlarında görünmez (ayrıca her yanıtta X-Robots-Tag başlığı; robots.txt taramayı açık bırakır ki
  // Google bu noindex'i görsün)
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true, "max-snippet": 0, "max-image-preview": "none", "max-video-preview": 0 },
  },
  formatDetection: { telephone: false, email: false, address: false },
  // Ana ekrana eklenince uygulama gibi açılır (manifest: src/app/manifest.ts). Durum çubuğu beyaz zeminde koyu
  // yazı ("default"): içerik çubuğun altından başlar, üst çubuğa güvenli alan payı gerekmez.
  appleWebApp: { capable: true, title: "L'Affogato", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  // env(safe-area-inset-*) dolsun: alt menü ve alttan açılan pencereler ana ekran çubuğunun üstünde kalır
  viewportFit: "cover",
  // Android'de ekran klavyesi açılınca düzen küçülür (dvh, alttan açılan pencere klavyenin üstünde kalır)
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        {children}
        {/* Bildirim balonu üst katmanda durur, açık bir pencerenin (alttan açılan sayfa) içinde dokunulabilir; yeri
            ekrana göre değişir (telefonda panelde altta, alt menünün üstünde): components/ui/toast-layout.ts */}
        <TopLayerToaster closeButton toastOptions={{ classNames: { toast: "!rounded-2xl !font-sans" } }} />
      </body>
    </html>
  );
}

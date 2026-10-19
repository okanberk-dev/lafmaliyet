import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";

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
  // Panel arama motorlarına kapalı (ayrıca robots.txt ve X-Robots-Tag başlığı)
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true, "max-snippet": 0, "max-image-preview": "none", "max-video-preview": 0 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        {children}
        {/* Telefonda bildirim balonu 56px'lik üst çubuğun (menü, arama, zil) altında açılır, düğmeleri örtmez */}
        <Toaster
          position="top-center"
          closeButton
          mobileOffset={{ top: 64, left: 16, right: 16 }}
          toastOptions={{ classNames: { toast: "!rounded-2xl !font-sans" } }}
        />
      </body>
    </html>
  );
}

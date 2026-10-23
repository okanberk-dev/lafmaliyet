"use client";

import "./globals.css";

import { ErrorView } from "@/components/panel/error-view";

/**
 * En dıştaki hata ekranı: kök düzenin (src/app/layout.tsx) kendisi çizilemezse. Kök düzenin yerine geçer, bu yüzden
 * kendi <html>, <body> ve stilleri var (yazı tipi sistemin; Geist kök düzende yüklenir).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full bg-background px-4 py-6 font-sans text-foreground">
        <title>Bir şeyler ters gitti · L&apos;Affogato</title>
        <ErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}

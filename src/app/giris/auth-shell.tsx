import type { ReactNode } from "react";

import { LafMark } from "@/components/brand";

/**
 * Giriş ve parola belirleme sayfalarının çerçevesi: sayfa baştan sona yeşil, üstte L'Af işareti, ortada beyaz kart,
 * altta kısa not. Süs yok; telefonda kart üstten başlar, büyük ekranda ortalanır. `subtitle`: işaretin altındaki ad
 * (Yönetim konsolunun girişi "Yönetim konsolu" der)
 */
export function AuthShell({ children, subtitle = "Yönetim paneli" }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-[#006241] dark:bg-canvas px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:justify-center sm:py-12">
      <header className="mb-7 flex flex-col items-center gap-2.5">
        <LafMark tone="cream" className="h-12 sm:h-14" title="L'Affogato" />
        <p className="text-sm font-semibold text-white/85">{subtitle}</p>
      </header>
      <main className="w-full max-w-[460px]">{children}</main>
      <footer className="mt-6 flex flex-col items-center gap-0.5 text-center text-[13px] text-white/75">
        <p>Ortak cihazda işiniz bitince çıkış yapın.</p>
        <a href="https://laffogato.net" className="inline-flex min-h-11 items-center px-1 font-semibold text-white underline underline-offset-2">
          laffogato.net
        </a>
      </footer>
    </div>
  );
}

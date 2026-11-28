import { ExternalLink, LogOut } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LafMark } from "@/components/brand";
import { buttonClass } from "@/components/ui/button";
import { panelBaglantilari } from "@/lib/yonetim-host";
import { yonetimCikisAction } from "@/server/actions/yonetim-giris";
import { requireYonetim } from "@/server/auth/dal";

import { KonsolSekmeleri, KonsolSekmeleriYedek } from "./sekmeler";

export const metadata: Metadata = {
  title: { default: "Yönetim konsolu", template: "%s · Yönetim konsolu" },
  robots: { index: false, follow: false },
};

/**
 * Yönetim konsolunun kabuğu (docs/planlar/yonetim-konsolu.md › K-A): panelin kabuğunu (menü, asistan, şube seçici)
 * almaz. Üstte "Yönetim konsolu", kişinin adı, "ladmin'e git" (APP_URL) ve Çıkış; altında iki sekme. Kişi satırı
 * requireYonetim ister; sayfalar da ayrıca ister (layout sayfa geçişinde yeniden koşmaz, ona güvenilmez).
 */
export default function KonsolLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-component="yonetim-kabuk" className="min-h-dvh bg-background text-foreground">
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-on-solid"
      >
        İçeriğe geç
      </a>
      <header className="border-b border-line bg-panel pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <LafMark className="h-7 shrink-0" title="L'Affogato" />
            <p className="truncate text-[15px] font-semibold tracking-tight text-ink">Yönetim konsolu</p>
          </div>
          <Suspense fallback={<div aria-hidden className="h-8 w-40 animate-pulse rounded-lg bg-surface" />}>
            <Kisi />
          </Suspense>
        </div>
        <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6">
          {/* Dinamik yolda (/yonetim/sube/[id]) usePathname ön çizimde bilinmez: Suspense olmadan derleme durur */}
          <Suspense fallback={<KonsolSekmeleriYedek />}>
            <KonsolSekmeleri />
          </Suspense>
        </div>
      </header>
      <main id="icerik" tabIndex={-1} className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-6 outline-none sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}

/** Kişinin adı, ladmin bağlantısı ve konsoldan çıkış (yalnız konsol çerezi silinir) */
async function Kisi() {
  const me = await requireYonetim();
  const ladmin = panelBaglantilari().ladmin;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="max-w-[12rem] truncate text-[13px] text-ink-mute" title={me.email}>
        {me.name}
      </span>
      <a href={ladmin} className={buttonClass("ghost", "sm")}>
        <ExternalLink className="size-3.5" aria-hidden />
        ladmin&apos;e git
      </a>
      <form action={yonetimCikisAction}>
        <button type="submit" className={buttonClass("secondary", "sm")}>
          <LogOut className="size-3.5" aria-hidden />
          Çıkış
        </button>
      </form>
    </div>
  );
}

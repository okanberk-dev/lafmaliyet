"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { KONSOL_SEKMELERI, sekmeAcik } from "@/lib/yonetim-host";

/**
 * Konsolun üç sekmesi (şubenin işlem sayfasında Şubeler ve kasalar seçili); telefonda sığmazsa yatay kayar (sayfa
 * taşmaz). Kabuk bunu Suspense içinde çizer: /yonetim/sube/[id] dinamik yolunda usePathname ön çizimde bilinmez (Next 16
 * cacheComponents; node_modules/next/dist/docs › use-pathname), o sırada seçimsiz aynı sekmeler görünür
 */
export function KonsolSekmeleri() {
  return <SekmeListesi yol={usePathname()} />;
}

/** Ön çizimin yedeği: aynı sekmeler, seçili sekme yok */
export function KonsolSekmeleriYedek() {
  return <SekmeListesi yol={null} />;
}

function SekmeListesi({ yol }: { yol: string | null }) {
  return (
    <nav aria-label="Konsol bölümleri" className="-mb-px flex gap-1 overflow-x-auto pt-2 [scrollbar-width:none]">
      {KONSOL_SEKMELERI.map((s) => {
        const acik = yol !== null && sekmeAcik(s.href, yol);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={acik ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
              acik ? "border-ink text-ink" : "border-transparent text-ink-mute hover:text-ink",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

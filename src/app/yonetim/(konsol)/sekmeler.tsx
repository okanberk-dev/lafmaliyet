"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { KONSOL_SEKMELERI } from "@/lib/yonetim-host";

/** Konsolun iki sekmesi; telefonda yan yana sığmazsa yatay kayar (sayfa taşmaz) */
export function KonsolSekmeleri() {
  const yol = usePathname();
  return (
    <nav aria-label="Konsol bölümleri" className="-mb-px flex gap-1 overflow-x-auto pt-2 [scrollbar-width:none]">
      {KONSOL_SEKMELERI.map((s) => {
        const acik = yol === s.href;
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

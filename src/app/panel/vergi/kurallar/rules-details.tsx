"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * Kural tablosunun kapalı gövdesi (docs/planlar/ux-sade.md §7.9): kanun tablosu her ziyarette gerekmiyor, telefonda
 * ~15.000 px. Adres `#kurallar` ise (bayat kural uyarısının "Kural tablosu" bağlantısı, yer imi) açık gelir: Ayarlar
 * bölümlerinin deseni. Uygulamanın içinden gelince Next adresi pushState ile değiştirdiği için çapa bir kare sonra
 * okunur (HashScroll ile aynı). Bu sayfanın kendisinde (bant Muhasebeci'de de çizilir) Next'in bağlantısı `hashchange`
 * göndermez: `#kurallar`'a giden her bağlantının tıklaması tabloyu açar
 */
export function RulesDetails({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#kurallar" && ref.current) ref.current.open = true;
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('a[href$="#kurallar"]') && ref.current) ref.current.open = true;
    };
    const frame = requestAnimationFrame(fromHash);
    window.addEventListener("hashchange", fromHash);
    document.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", fromHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return (
    <details ref={ref} className="group/kural">
      <summary className="relative inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-soft underline decoration-current/40 underline-offset-2 outline-none select-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        <span className="group-open/kural:hidden">Kural tablosunu göster ({count} kural)</span>
        <span className="hidden group-open/kural:inline">Kural tablosunu gizle</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="size-3.5 motion-safe:transition-transform group-open/kural:rotate-180" />
      </summary>
      <div className="mt-3 space-y-5">{children}</div>
    </details>
  );
}

"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Kasa formunun katlanır bölümü (seyrek alanlar: Z'nin öteki ödeme türleri, indirim, fiş sayısı): kapalıyken başlıkta
 * içindeki dolu değerlerin kısa özeti görünür, hiçbir değer gizli kalmaz. Turuncu, hata ya da denetim (`attention`)
 * gelince kendiliğinden açılır ve kişi kapatana kadar açık kalır (yazarken turuncu kaybolunca kapanmaz, odak kaybolmasın).
 * Okc kartının Ayrıntılar'ıyla aynı görünüm (okc-card.tsx).
 */
export function Fold({ label, summary, attention, children, className }: { label: string; summary: ReactNode; attention: number; children?: ReactNode; className?: string }) {
  const uid = useId();
  const [chosen, setChosen] = useState<boolean | null>(() => (attention > 0 ? true : null));
  const [seen, setSeen] = useState(attention);
  if (attention !== seen) {
    setSeen(attention);
    if (attention > seen) setChosen(true);
  }
  const open = chosen ?? attention > 0;
  return (
    <div className={cn("sm:col-span-2", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${uid}fold`}
        onClick={() => setChosen(!open)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] leading-5 ring-1 ring-line pointer-coarse:min-h-11",
          attention ? "bg-warn-soft text-warn ring-warn/30" : "bg-surface text-ink-soft hover:bg-surface/70",
        )}
      >
        <ChevronDown size={15} className={cn("shrink-0 transition-transform", open ? "rotate-180" : undefined)} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{label}</span>
          {summary ? (
            <>
              {" · "}
              {summary}
            </>
          ) : null}
        </span>
      </button>
      <div id={`${uid}fold`} hidden={!open} className="mt-3 grid gap-3 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

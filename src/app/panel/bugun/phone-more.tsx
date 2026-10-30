"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Telefonda "Diğer N iş" düğmesi (docs/planlar/ux-sade.md §4.8): içindeki `data-more-row` satırları telefonda kapalıyken
 * gizlidir (`max-sm:hidden`), düğme açar; açıkken "Gizle". Satırlar sunucuda çizilir, burada yalnız durum tutulur;
 * geniş ekranda düğme yok, satırlar hep görünür.
 */
export function PhoneMore({ count, controls, children }: { count: number; controls: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group/more" data-more={open ? "open" : "closed"}>
      {children}
      {count > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={controls}
          onClick={() => setOpen((o) => !o)}
          className="mt-2 flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-mute ring-1 ring-line transition-colors ring-inset hover:bg-ink/[0.04] hover:text-ink sm:hidden"
        >
          <ChevronDown size={15} aria-hidden="true" className={cn("motion-safe:transition-transform", open && "rotate-180")} />
          {open ? "Gizle" : `Diğer ${count} iş`}
        </button>
      ) : null}
    </div>
  );
}

/** Telefonda alt satırın katlanan grubu: düğmesi satırda, listesi satırın altında */
export interface PhoneFold {
  id: string;
  title: string;
  count: number;
  /** <li> satırları */
  children: ReactNode;
}

/**
 * Telefonda Yapılacaklar kartının alt satırı (docs/planlar/ux-sade.md §4.8, §13 Bugün ≤ 340 px): "Sonra (N)",
 * "Tamamlananlar (N)" ve (yöneticide) "Ayın işleri" bağlantısı alt alta üç 44 px'lik satır yerine yan yana tek satır;
 * her biri görünür 20 px, görünmez kenarla 44 px dokunma alanı. Açılan grubun listesi satırın altında tam genişlikte
 * (düğme yerinde kalır). Geniş ekranda bu satır yok (sm:hidden); orada Sonra bölümü ve Tamamlananlar ayrı çizilir.
 */
export function PhoneFoldBar({ folds, link }: { folds: PhoneFold[]; link?: ReactNode }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className="sm:hidden">
      {/* Aralık 16 px: komşu dokunma alanları (±8 px) birbirine değer, üst üste binmez */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {folds.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-expanded={open.has(f.id)}
            aria-controls={f.id}
            onClick={() => toggle(f.id)}
            className="relative inline-flex min-h-5 cursor-pointer items-center gap-1 text-[13px] font-semibold text-ink-soft outline-none after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-ink focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30"
          >
            <ChevronDown size={15} aria-hidden="true" className={cn("motion-safe:transition-transform", open.has(f.id) && "rotate-180")} />
            {f.title} <span className="font-normal text-ink-mute tabular">({f.count})</span>
          </button>
        ))}
        {link}
      </div>
      {folds.map((f) => (
        <ul key={f.id} id={f.id} hidden={!open.has(f.id)} className="mt-3 grid gap-2">
          {f.children}
        </ul>
      ))}
    </div>
  );
}

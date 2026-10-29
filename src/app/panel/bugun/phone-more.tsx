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

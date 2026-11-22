"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type RoutineStep = { title: string; href: string; icon: ReactNode; body: ReactNode };

/**
 * Yardım · "Her ay ne yapmalı?" adımları. Geniş ekranda her adım açıklamasıyla bir kart. Telefonda önce altı adımın
 * adı tek satır (sayfa kısa kalır, Nasıl yapılır? araması ilk ekrana yaklaşır); "Adımların açıklamasını göster"
 * hepsini açar. Açıklama gizliyken de ekran okuyucu okur. Her adım ilgili ekrana gider.
 */
export function RoutineSteps({ steps }: { steps: RoutineStep[] }) {
  const [details, setDetails] = useState(false);
  const listId = useId();
  return (
    <>
      <ol id={listId} className="grid gap-3 max-sm:gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {steps.map((r, i) => (
          <li key={r.title}>
            <Link
              href={r.href}
              className={cn(
                "group flex h-full flex-col gap-2 rounded-2xl bg-surface p-4 ring-1 ring-line transition-shadow outline-none hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ink/30",
                !details && "max-sm:min-h-12 max-sm:justify-center max-sm:py-2.5",
              )}
            >
              <span className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-on-solid tabular">{i + 1}</span>
                <span className="min-w-0 flex-1 font-semibold text-pretty text-ink group-hover:underline">{r.title}</span>
                {r.icon}
              </span>
              <span className={cn("text-[13px] leading-5 text-ink-mute", !details && "max-sm:sr-only")}>{r.body}</span>
            </Link>
          </li>
        ))}
      </ol>
      <button
        type="button"
        aria-expanded={details}
        aria-controls={listId}
        onClick={() => setDetails((d) => !d)}
        className="mt-2 flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-mute ring-1 ring-line transition-colors ring-inset hover:bg-ink/[0.04] hover:text-ink sm:hidden"
      >
        <ChevronDown size={15} aria-hidden="true" className={cn("transition-transform", details && "rotate-180")} />
        {details ? "Açıklamaları gizle" : "Adımların açıklamasını göster"}
      </button>
    </>
  );
}

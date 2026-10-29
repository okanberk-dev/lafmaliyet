"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/utils";

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

const arrow =
  "flex h-full w-8 cursor-pointer items-center justify-center rounded-xl text-ink-mute hover:text-ink disabled:cursor-default disabled:opacity-30 pointer-coarse:w-11";

/**
 * Yıl (`?yil=`) ya da çeyrek (`?ceyrek=2026-Q3`) seçici: ay seçicinin (MonthPicker) görünümü, okları ve 44 px dokunma
 * alanıyla. `Segmented` değil (seçilmedi durumu yok, dar ekranda yatay kayar; plan §4.2). Diğer parametreler korunur,
 * `omit` değişince düşenler (yıl değişince çeyrek).
 */
export function PeriodPicker({
  options,
  value,
  param,
  label,
  omit,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  param: string;
  /** "Yıl", "Çeyrek" */
  label: string;
  omit?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const idx = options.findIndex((o) => o.value === value);
  const lower = label.toLocaleLowerCase("tr-TR");

  const go = (v: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set(param, v);
    for (const k of omit ?? []) sp.delete(k);
    start(() => router.push(`${pathname}?${sp.toString()}`));
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-9 items-center rounded-xl bg-surface ring-1 ring-inset ring-line-strong shadow-[0_1px_1px_rgb(33_28_24/0.03)] transition-opacity pointer-coarse:h-11",
        pending && "opacity-60",
      )}
    >
      <button type="button" className={arrow} disabled={idx <= 0} onClick={() => go(options[idx - 1].value)} aria-label={`Önceki ${lower}`}>
        <ChevronLeft size={18} />
      </button>
      <select
        value={value}
        onChange={(e) => go(e.target.value)}
        className="h-full cursor-pointer appearance-none border-x border-line bg-transparent bg-[length:14px] bg-[right_6px_center] bg-no-repeat pr-6 pl-2.5 text-base font-medium text-ink tabular focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset sm:text-sm"
        style={{ backgroundImage: CHEVRON }}
        aria-label={`${label} seçin`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="button" className={arrow} disabled={idx < 0 || idx >= options.length - 1} onClick={() => go(options[idx + 1].value)} aria-label={`Sonraki ${lower}`}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

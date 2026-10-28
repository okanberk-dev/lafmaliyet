"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { GridData } from "./grid";

/**
 * Vergiye göre, telefon (md altı; plan docs/planlar/vergi.md §4.2): Gelir-gider'in ay görünümü gibi yapışkan seçici
 * (ay, çeyrek toplamı ya da kümülatif) ve tek kart; satırlar alt alta, dökümü olan satır açılır.
 */
export function QuarterPhone({ grid }: { grid: GridData }) {
  const months = grid.columns.length - 2;
  // Açılışta çeyrek toplamı
  const [col, setCol] = useState(months);
  const c = grid.columns[col];
  const step = "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink disabled:cursor-default disabled:opacity-30";
  return (
    <div className="md:hidden">
      <div className="sticky top-(--mobile-top-h) z-20 border-y border-line bg-panel/95 px-4 py-2 backdrop-blur-md">
        <div role="group" aria-label="Sütun" className="flex items-center gap-2">
          <button type="button" className={step} disabled={col <= 0} onClick={() => setCol((i) => Math.max(0, i - 1))} aria-label="Önceki">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <select
            value={col}
            onChange={(e) => setCol(Number(e.target.value))}
            aria-label="Ay, çeyrek ya da kümülatif"
            className="h-11 min-w-0 flex-1 cursor-pointer appearance-none rounded-xl border-0 bg-surface px-3 text-center text-base font-semibold text-ink ring-1 ring-line-strong ring-inset focus:ring-2 focus:ring-ink/25 focus:outline-none"
          >
            {grid.columns.map((x, i) => (
              <option key={x.key} value={i}>
                {x.label}
                {x.sub && i < months ? ` · ${x.sub}` : ""}
              </option>
            ))}
          </select>
          <button type="button" className={step} disabled={col >= grid.columns.length - 1} onClick={() => setCol((i) => Math.min(grid.columns.length - 1, i + 1))} aria-label="Sonraki">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div aria-live="polite">
        {grid.groups.map((g) => {
          const rows = g.rows.filter((r) => r.values[col] !== null);
          if (!rows.length) return null;
          return (
            <section key={g.key} aria-label={g.label} className="mt-4">
              <h3 className="px-5 pb-2 text-[13px] font-semibold text-ink-soft">{g.label}</h3>
              <ul className="mx-4 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {rows.map((r) => {
                  const v = r.values[col] ?? 0;
                  const items = r.items[col] ?? [];
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[15px] leading-5 break-words", r.strong ? "font-semibold text-ink" : "text-ink-soft", r.tone === "bad" && "text-bad")}>{r.label}</span>
                        {r.badge ? (
                          <Badge tone={r.badge.startsWith("Yönetim verisi") ? "amber" : r.badge.startsWith("mali belge") ? "green" : "gray"} className="mt-1 whitespace-normal">
                            {r.badge}
                          </Badge>
                        ) : null}
                        {r.note && col < months ? <span className="mt-0.5 block text-xs leading-4 break-words text-ink-mute">{r.note}</span> : null}
                      </span>
                      <span className={cn("shrink-0 text-right text-[15px] tabular", r.strong ? "font-semibold text-ink" : "text-ink", v < 0 && "text-bad")}>{money(v)}</span>
                    </>
                  );
                  return (
                    <li key={r.key}>
                      {items.length ? (
                        <details className="group/item">
                          <summary className="flex min-h-12 cursor-pointer list-none items-start gap-3 px-4 py-2.5 outline-none select-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                            {body}
                            <ChevronDown size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-quiet transition-transform group-open/item:rotate-180" />
                          </summary>
                          <dl className="mx-4 mb-3 divide-y divide-line rounded-xl bg-panel px-3">
                            {items.map((x) => (
                              <div key={x.label} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px] leading-5">
                                <dt className="min-w-0 break-words text-ink-mute">{x.label}</dt>
                                <dd className={cn("shrink-0 text-ink tabular", x.amount < 0 && "text-bad")}>{money(x.amount)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : (
                        <div className="flex min-h-12 items-start gap-3 px-4 py-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <p className="px-5 pt-3 text-xs text-ink-mute">{c.label === "Kümülatif (yılbaşından)" ? "Hesap döneminin başından seçilen çeyreğin sonuna." : "KDV hariç; dökümü olan satıra dokunun."}</p>
      </div>
    </div>
  );
}

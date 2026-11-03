import type { ReactNode } from "react";

import type { DayFact, DayLine, DayTone } from "@/lib/cash-ladmin";
import { cn } from "@/lib/utils";

/**
 * Yöneticinin gün görünümündeki ModPOS ve ladmin bölümlerinin ortak parçaları (sunucu bileşenleri): karo ızgarası,
 * satır listesi ve alt başlık. İki bölüm aynı düzenle çizilir: yan yana okunurken aynı bilgi aynı yerde.
 */

const TONE: Record<DayTone, string> = { warn: "text-warn", good: "text-good" };

export const H3 = "border-b border-line pb-1 text-[13px] font-semibold text-ink-soft";

/** Karolar: telefonda iki, geniş ekranda üç sütun */
export function FactGrid({ facts, label }: { facts: DayFact[]; label: string }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={label}>
      {facts.map((f) => (
        <div key={f.label} className="min-w-0 rounded-2xl bg-surface px-3 py-2.5">
          <dt className="text-xs leading-4 text-ink-mute">{f.label}</dt>
          <dd className={cn("mt-1 text-base font-semibold break-words text-ink tabular", f.tone ? TONE[f.tone] : null)}>{f.value}</dd>
          {f.sub ? <dd className="text-xs leading-4 break-words text-ink-mute">{f.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** Başlıklı satır listesi (ödemeler, nakit kasa, kart…); boşsa hiçbir şey */
export function LineList({ title, lines, children }: { title: ReactNode; lines: DayLine[]; children?: ReactNode }) {
  if (!lines.length) return null;
  return (
    <section aria-label={typeof title === "string" ? title : undefined}>
      <h3 className={H3}>{title}</h3>
      <ul className="divide-y divide-line">
        {lines.map((l, i) => (
          <li key={`${l.label}:${i}`} className="py-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className={cn("min-w-0 break-words", l.strong ? "font-medium text-ink" : "text-ink-soft")}>{l.label}</span>
              <span className={cn("text-right tabular", l.wrap ? "min-w-0 break-words" : "shrink-0", l.strong ? "font-semibold" : null, l.tone ? TONE[l.tone] : "text-ink")}>{l.value}</span>
            </div>
            {l.sub ? <p className="text-xs break-words text-ink-mute">{l.sub}</p> : null}
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}

/** Soluk not satırları (künye, açıklamalar) */
export function MutedLines({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="space-y-1 text-[13px] leading-5 break-words text-ink-mute">
      {lines.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </div>
  );
}

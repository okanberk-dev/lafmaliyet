"use client";

import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { useMemo } from "react";

import { money, num } from "@/lib/format";
import { longDateTR, monthGrid, monthTitleTR, repeatLabel, shiftMonth } from "@/lib/reminders";
import { cn } from "@/lib/utils";

import { monthTotals, type CalendarEntry } from "./calendar-entries";
import { CategoryWell, categoryOf, DateTile, URGENCY, urgencyOf } from "./payment-ui";

export type { CalendarEntry };

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export function CalendarView({
  month,
  onMonth,
  today,
  entries,
  onDay,
}: {
  month: string;
  onMonth: (m: string) => void;
  today: string;
  entries: CalendarEntry[];
  onDay: (date: string) => void;
}) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [entries]);
  const { count, total } = monthTotals(entries, month);
  const thisMonth = today.slice(0, 7);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-6 font-semibold tracking-tight text-ink">{monthTitleTR(month)}</h3>
          <p className="text-[13px] text-ink-mute tabular">{count ? `${num(count)} ödeme · ${money(total)}` : "Bu ayda ödeme yok"}</p>
        </div>
        {month !== thisMonth ? (
          <button
            type="button"
            onClick={() => onMonth(thisMonth)}
            className="h-11 cursor-pointer rounded-xl bg-surface px-3 text-[13px] font-medium text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink sm:pointer-fine:h-9"
          >
            Bugün
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onMonth(shiftMonth(month, -1))}
          aria-label="Önceki ay"
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink sm:pointer-fine:size-9"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => onMonth(shiftMonth(month, 1))}
          aria-label="Sonraki ay"
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink sm:pointer-fine:size-9"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="-mx-1 rounded-2xl bg-surface p-1 ring-1 ring-line sm:mx-0 sm:p-2">
        <div className="grid grid-cols-7 pb-1" aria-hidden="true">
          {WEEKDAYS.map((d, i) => (
            <span key={d} className={cn("py-1 text-center text-[11px] font-medium text-ink-mute", i >= 5 && "text-ink-quiet")}>
              {d}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={monthTitleTR(month)} className="grid gap-y-0.5">
          {weeks.map((week) => (
            <div key={week[0]} role="row" className="grid grid-cols-7 sm:gap-0.5">
              {week.map((date) => {
                const list = byDay.get(date) ?? [];
                const outside = !date.startsWith(month);
                const isToday = date === today;
                const sum = list.reduce((a, e) => a + (e.item.amount ?? 0), 0);
                const label = `${longDateTR(date)}${list.length ? ` · ${list.length} ödeme${sum ? ` · ${money(sum)}` : ""}` : ""}`;
                return (
                  <button
                    key={date}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => onDay(date)}
                    className={cn(
                      "flex min-h-12 cursor-pointer flex-col items-center gap-1 rounded-xl px-0.5 pt-1 pb-1.5 transition-colors hover:bg-panel focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none sm:min-h-[5.5rem] sm:items-stretch sm:px-1.5",
                      list.length && !outside && "bg-panel/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center self-center rounded-full text-[13px] font-medium tabular sm:self-start",
                        isToday ? "bg-ink text-on-solid" : outside ? "text-ink-quiet" : "text-ink",
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </span>
                    {/* Telefonda noktalar */}
                    <span className="flex h-1.5 items-center justify-center gap-0.5 sm:hidden" aria-hidden="true">
                      {list.slice(0, 3).map((e) => (
                        <span key={e.key} className={cn("size-1.5 rounded-full", e.forecast ? "border border-ink-quiet" : URGENCY[urgencyOf(e.item.daysLeft)].dot)} />
                      ))}
                    </span>
                    {/* Masaüstünde ilk iki ödemenin adı */}
                    <span className="hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden="true">
                      {list.slice(0, 2).map((e) => (
                        <span
                          key={e.key}
                          className={cn(
                            "flex min-w-0 items-center gap-1 rounded-md px-1 py-px text-[11px] leading-4",
                            e.forecast ? "text-ink-mute ring-1 ring-line ring-inset" : "bg-surface text-ink ring-1 ring-line ring-inset",
                          )}
                        >
                          <span className={cn("size-1.5 shrink-0 rounded-full", e.forecast ? "border border-ink-quiet" : URGENCY[urgencyOf(e.item.daysLeft)].dot)} />
                          <span className="min-w-0 truncate">{e.item.title}</span>
                        </span>
                      ))}
                      {list.length > 2 ? <span className="px-1 text-[11px] text-ink-mute">+{list.length - 2}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-ink-mute" aria-label="Renkler">
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-bad" aria-hidden="true" /> Gecikti
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-brass-500" aria-hidden="true" /> Bugün
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-brass-300" aria-hidden="true" /> 7 gün içinde
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-ink-quiet" aria-hidden="true" /> Daha sonra
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border border-ink-quiet" aria-hidden="true" /> Sıradaki tekrarlar
        </li>
      </ul>
    </div>
  );
}

/** Gün sayfasında öngörülen (henüz sırası gelmemiş) dönem: yalnız bilgi */
export function ForecastRow({ entry }: { entry: CalendarEntry }) {
  const { item } = entry;
  const repeat = repeatLabel(item.repeat, entry.date, entry.anchorDate);
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-panel/70 p-3 ring-1 ring-line ring-inset">
      <DateTile date={entry.date} daysLeft={item.daysLeft} muted />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-5 font-semibold text-pretty break-words text-ink-soft">{item.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-mute">
          <CategoryWell category={categoryOf(item)} size="xs" />
          {repeat ? (
            <span className="inline-flex items-center gap-1">
              <Repeat size={11} aria-hidden="true" /> {repeat}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-mute">Sıradaki tekrar; önceki dönem ödendi işaretlenince listeye gelir.</p>
      </div>
      <span className="text-[15px] font-semibold whitespace-nowrap text-ink-soft tabular">{item.amount !== null ? money(item.amount) : "–"}</span>
    </li>
  );
}

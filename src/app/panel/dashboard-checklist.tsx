import { ArrowRight, ChevronDown, CircleAlert, CircleCheck, CircleDashed, Clock3, ListChecks } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { MonthState } from "@/lib/calc/insights";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import { taskSummary, type MonthTask, type TaskStatus } from "./dashboard-tasks";

const STYLE: Record<TaskStatus, { icon: ReactNode; well: string; bar: string; tone: Tone; label: string }> = {
  done: { icon: <CircleCheck />, well: "bg-lime/25 text-good-ink", bar: "bg-good", tone: "green", label: "Tamam" },
  todo: { icon: <CircleDashed />, well: "bg-warn-soft text-warn", bar: "bg-brass-500", tone: "amber", label: "Yapılacak" },
  warn: { icon: <CircleAlert />, well: "bg-bad-soft text-bad", bar: "bg-bad", tone: "red", label: "Sorun var" },
  later: { icon: <Clock3 />, well: "bg-panel text-ink-mute ring-1 ring-inset ring-line", bar: "bg-panel-deep", tone: "gray", label: "Sonra" },
};

/**
 * Genel bakış · "Bu ayın işleri": seçili ay için her ay yapılan işlerin (satış raporu, ay bilgileri, faturalar,
 * su faturası, stok sayımı, ödemeler) durumu. Her satır ilgili ekranın tam yerine götürür; sıradaki iş
 * (önce sorunlar, sonra eksikler) siyah çerçeveyle tek birincil eylem olarak öne çıkar.
 * Açık iş yoksa kart tek satıra kapanır (<details>; JavaScript'siz de açılıp kapanır).
 */
export function DashboardChecklist({ month, state, tasks, className }: { month: string; state: MonthState; tasks: MonthTask[]; className?: string }) {
  const s = taskSummary(tasks);
  const laterLabel = state === "running" ? "Ay sonunda" : state === "future" ? "Ay başlamadı" : "Sonra";
  const description = s.allDone ? (
    s.later ? (
      `Şimdilik yapılacak iş yok; ${s.later} iş ${state === "running" ? "ay sonunda" : "sonra"} yapılır.`
    ) : (
      "Bu ayın bütün işleri tamam; rakamlar eksiksiz veriyle hesaplanıyor."
    )
  ) : s.monthOpen === 0 ? (
    // Yalnızca ödeme işi açık: ödemeler bugüne bağlı, ayın rakamlarını etkilemez
    <>
      {s.later ? `Şimdilik eksik veri yok; ${s.later} iş ${state === "running" ? "ay sonunda" : "sonra"} yapılır.` : "Bu ayın verileri tamam."}{" "}
      {s.next?.status === "warn" ? "Geciken ödeme var" : "Yaklaşan ödeme var"}; ödemeler bugüne göre izlenir, ayın kâr/zararını değiştirmez.
    </>
  ) : (
    <>
      {s.open} iş bekliyor{s.warn ? ` (${s.warn} sorun)` : ""}.
      <span className="max-sm:hidden"> Bitince bu ayın kâr/zarar ve maliyet rakamları eksiksiz olur.</span>
    </>
  );

  return (
    <Card className={className}>
      {/* key: ay değişince kartın açık/kapalı durumu o ayın durumuna göre yeniden kurulur */}
      <details key={month} open={s.monthOpen > 0} className="group/cl">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-3xl px-5 pt-5 pb-4 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">
              {s.allDone ? <CircleCheck /> : <ListChecks />}
            </span>
            <span className="min-w-0">
              <span role="heading" aria-level={2} className="block text-base leading-6 font-semibold tracking-tight text-ink">
                Bu ayın işleri · {monthLabel(month)}
              </span>
              <span className="mt-0.5 block text-[13px] leading-5 text-pretty text-ink-mute">{description}</span>
            </span>
          </span>
          <span className="ml-12 flex items-center gap-3 sm:ml-0">
            <span className="flex items-center gap-2 text-[13px] text-ink-mute">
              <span aria-hidden="true" className="flex gap-1">
                {tasks.map((t) => (
                  <span key={t.key} className={cn("h-1.5 w-3.5 rounded-full", STYLE[t.status].bar)} />
                ))}
              </span>
              <span className="font-medium whitespace-nowrap text-ink tabular">
                {s.done} / {s.total} tamam
              </span>
            </span>
            <span className="flex size-8 items-center justify-center rounded-lg text-ink-mute transition-colors group-hover/cl:bg-ink/[0.05] group-hover/cl:text-ink">
              <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open/cl:rotate-180" />
              <span className="sr-only">Listeyi aç / kapat</span>
            </span>
          </span>
        </summary>
        <ul className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((t) => {
            const st = STYLE[t.status];
            const isNext = s.next?.key === t.key;
            // Telefonda biten ve zamanı gelmemiş işler tek satır: açıklama yalnızca yapılacaklarda
            const quiet = t.status === "done" || t.status === "later";
            return (
              // Telefonda sıradaki iş en üstte: tek birincil eylem ilk ekranda görünsün
              <li key={t.key} className={cn(isNext && "max-sm:-order-1")}>
                <Link
                  href={t.href}
                  className={cn(
                    "group flex h-full items-start gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line transition-shadow outline-none hover:shadow-lift hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/30",
                    quiet && "max-sm:items-center max-sm:py-2.5",
                    isNext && "ring-2 ring-ink hover:ring-ink",
                  )}
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[17px] [&>svg]:stroke-[2]", st.well)} aria-hidden="true">
                    {st.icon}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-ink">{t.title}</span>
                      <Badge tone={st.tone}>{t.status === "later" ? laterLabel : st.label}</Badge>
                    </span>
                    <span className={cn("mt-1 block text-[13px] leading-5 text-pretty text-ink-mute", quiet && "max-sm:sr-only")}>{t.detail}</span>
                    <span className={cn("mt-auto pt-2.5", quiet && "max-sm:hidden")}>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[13px] font-medium",
                          isNext ? "rounded-full bg-ink px-3 py-1.5 text-white" : "text-ink group-hover:underline",
                        )}
                      >
                        {isNext ? <span className="font-normal text-white/70">Sıradaki:</span> : null}
                        {t.action}
                        <ArrowRight size={14} aria-hidden="true" />
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </details>
    </Card>
  );
}

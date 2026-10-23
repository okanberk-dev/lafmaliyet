import { ChevronDown, CircleCheck, ListChecks } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { MonthState } from "@/lib/calc/insights";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ChecklistTasks } from "./dashboard-checklist-tasks";
import { taskSummary, type MonthTask } from "./dashboard-tasks";
import { TASK_BAR } from "./task-style";

/**
 * Genel bakış · "Bu ayın işleri": seçili ay için her ay yapılan işlerin (satış raporu, ay bilgileri, faturalar,
 * su faturası, stok sayımı, ödemeler) durumu. Her satır ilgili ekranın tam yerine götürür; sıradaki iş
 * (önce sorunlar, sonra eksikler) siyah çerçeveyle tek birincil eylem olarak öne çıkar.
 * Açık iş yoksa kart tek satıra kapanır (<details>; JavaScript'siz de açılıp kapanır). Telefonda liste kısadır:
 * sıradaki iş tam kart, diğerleri tek satır (dashboard-checklist-tasks.tsx).
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
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-3xl px-5 pt-5 pb-4 outline-none max-sm:px-4 max-sm:pt-4 max-sm:pb-3 focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
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
                  <span key={t.key} className={cn("h-1.5 w-3.5 rounded-full", TASK_BAR[t.status])} />
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
        <ChecklistTasks tasks={tasks} laterLabel={laterLabel} />
      </details>
    </Card>
  );
}

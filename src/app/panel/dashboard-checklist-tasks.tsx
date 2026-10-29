"use client";

import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { phoneChecklist, type ChecklistView, type MonthTask } from "./dashboard-tasks";
import { TASK_STYLE } from "./task-style";

/** Telefonda / geniş ekranda gizlenen kopyalar (phoneChecklist: DOM sırası görünen sırayla aynı kalsın diye) */
const VIEW: Record<ChecklistView, string | undefined> = { phone: "sm:hidden", wide: "max-sm:hidden", all: undefined };

/**
 * Ayın işleri kartının listesi. Geniş ekranda her iş açıklaması ve eylemiyle bir kart. Telefonda ilk ekran rakama
 * dönsün diye kısa: sıradaki iş en üstte tam kart (siyah çerçeve, tek birincil eylem), diğerleri "Diğer N iş"
 * düğmesinin arkasında; açılınca tek satır (ad + durum + ok). Açıklama tek satırda da ekran okuyucu için kalır.
 * Sunucu HTML'i telefon görünümünü CSS ile verir: ilk boyamada yer kaymaz.
 */
export function ChecklistTasks({ tasks, laterLabel }: { tasks: MonthTask[]; laterLabel: string }) {
  const [more, setMore] = useState(false);
  const listId = useId();
  const { rows, toggle } = phoneChecklist(tasks);
  // Telefonda gizlenen satırlar: sıradaki işin dışındakiler (geniş ekranda hepsi görünür)
  const others = rows.filter((r) => r.compact).length;

  return (
    <div className="px-5 pb-5 max-sm:px-4 max-sm:pb-4">
      <ul id={listId} className="grid gap-2.5 max-sm:gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ task: t, next, compact, view }) => {
          const st = TASK_STYLE[t.status];
          // Yalnızca telefonda tek satır (sm ve üstünde sınıfların etkisi yok); kapalıyken telefonda hiç görünmez
          const short = compact;
          return (
            <li key={`${t.key}-${view}`} className={cn(VIEW[view], compact && !more && "max-sm:hidden")}>
              <Link
                href={t.href}
                className={cn(
                  "group flex h-full items-start gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line transition-shadow outline-none hover:shadow-lift hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/30",
                  // Tek satır: ikon ve aralıklar biraz daralır, "Açık gün ve POS cirosu" rozetiyle 375px'te tek satıra sığar
                  short && "max-sm:min-h-12 max-sm:items-center max-sm:gap-2.5 max-sm:py-2.5",
                  next && "ring-2 ring-ink hover:ring-ink",
                )}
              >
                <span
                  className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[17px] [&>svg]:stroke-[2]", short && "max-sm:size-7 max-sm:[&>svg]:size-4", st.well)}
                  aria-hidden="true"
                >
                  {st.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("flex flex-wrap items-center justify-between gap-x-2 gap-y-1", short && "max-sm:gap-x-1.5")}>
                    <span className="text-sm font-semibold text-ink">{t.title}</span>
                    <Badge tone={st.tone}>{t.status === "later" ? laterLabel : st.label}</Badge>
                  </span>
                  <span className={cn("mt-1 block text-[13px] leading-5 text-pretty text-ink-mute", short && "max-sm:sr-only")}>{t.detail}</span>
                  <span className={cn("mt-auto pt-2.5", short && "max-sm:hidden")}>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-[13px] font-medium",
                        next ? "rounded-full bg-ink px-3 py-1.5 text-white max-sm:py-2" : "text-ink group-hover:underline",
                      )}
                    >
                      {next ? <span className="font-normal text-white/70">Sıradaki:</span> : null}
                      {t.action}
                      <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  </span>
                </span>
                {short ? <ChevronRight size={16} className="shrink-0 text-ink-quiet sm:hidden" aria-hidden="true" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {toggle ? (
        <button
          type="button"
          aria-expanded={more}
          aria-controls={listId}
          onClick={() => setMore((m) => !m)}
          className="mt-2 flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-mute ring-1 ring-line transition-colors ring-inset hover:bg-ink/[0.04] hover:text-ink sm:hidden"
        >
          <ChevronDown size={15} aria-hidden="true" className={cn("motion-safe:transition-transform", more && "rotate-180")} />
          {more ? "Gizle" : `Diğer ${others} iş`}
        </button>
      ) : null}
    </div>
  );
}

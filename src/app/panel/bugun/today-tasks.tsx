import { ArrowRight, ChevronDown, ListTodo } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { TASK_BAR, TASK_STYLE } from "../task-style";
import { splitTasks, type DayTask } from "./logic";

/**
 * Bugün · "Yapılacaklar": Şimdi (sorunlu ve yapılacak işler), Sonra (zamanı gelmemiş, gri) ve kapalı Tamamlananlar.
 * Her satır bütünüyle ilgili ekrana giden bağlantıdır; satırın görünümü Genel bakış'taki "Bu ayın işleri"nin geniş
 * ekran kartıyla aynı (durum stilleri task-style.tsx). Sıradaki iş (ilk sorunlu, yoksa ilk yapılacak) siyah çerçeve
 * ve siyah hapla öne çıkar. Sunucu bileşeni: JavaScript'siz de açılıp kapanır.
 */
export function TodayTasks({ tasks, admin }: { tasks: DayTask[]; admin: boolean }) {
  const { now, later, done, next } = splitTasks(tasks);
  return (
    <Card className="min-w-0">
      <CardHeader
        icon={<ListTodo />}
        title="Yapılacaklar"
        meta={
          tasks.length ? (
            <>
              <span aria-hidden="true" className="flex gap-1">
                {tasks.map((t) => (
                  <span key={t.key} className={cn("h-1.5 w-3.5 rounded-full", TASK_BAR[t.status])} />
                ))}
              </span>
              <span className="font-medium whitespace-nowrap text-ink tabular">
                {done.length} / {tasks.length} tamam
              </span>
            </>
          ) : undefined
        }
      />
      <div className="space-y-5 px-5 pb-5 max-sm:px-4 max-sm:pb-4">
        {now.length ? (
          <TaskSection title="Şimdi">
            {now.map((t) => (
              <TaskRow key={t.key} task={t} next={t.key === next?.key} />
            ))}
          </TaskSection>
        ) : null}
        {later.length ? (
          <TaskSection title="Sonra">
            {later.map((t) => (
              <TaskRow key={t.key} task={t} next={false} />
            ))}
          </TaskSection>
        ) : null}
        {done.length ? (
          <details className="group/done">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl text-[13px] font-semibold text-ink-soft outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
              <ChevronDown size={15} aria-hidden="true" className="transition-transform group-open/done:rotate-180" />
              Tamamlananlar <span className="font-normal text-ink-mute tabular">({done.length})</span>
            </summary>
            <ul className="mt-1 grid gap-2.5 sm:grid-cols-2">
              {done.map((t) => (
                <TaskRow key={t.key} task={t} next={false} />
              ))}
            </ul>
          </details>
        ) : null}
        {!tasks.length ? <p className="text-sm text-ink-mute">Bugün için iş yok.</p> : null}
        {admin ? (
          <Link href="/panel" className="inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-mute outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ink/30">
            Bu ayın işleri Genel bakış&apos;ta <ArrowRight size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

function TaskSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">{title}</h3>
      <ul className="grid gap-2.5 sm:grid-cols-2">{children}</ul>
    </section>
  );
}

function TaskRow({ task: t, next }: { task: DayTask; next: boolean }) {
  const st = TASK_STYLE[t.status];
  return (
    <li>
      <Link
        href={t.href}
        className={cn(
          "group flex h-full items-start gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line transition-shadow outline-none hover:shadow-lift hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/30",
          next && "ring-2 ring-ink hover:ring-ink",
        )}
      >
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[17px] [&>svg]:stroke-[2]", st.well)} aria-hidden="true">
          {st.icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-ink">{t.title}</span>
            <Badge tone={st.tone}>{t.badge ?? st.label}</Badge>
          </span>
          <span className="mt-1 block text-[13px] leading-5 text-pretty break-words text-ink-mute">{t.detail}</span>
          <span className="mt-auto pt-2.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[13px] font-medium",
                // Telefonda sıradaki işin hapı 44 px: başparmakla rahat dokunulsun
                next ? "rounded-full bg-ink px-3 py-1.5 text-white max-sm:min-h-11 max-sm:px-4" : "text-ink group-hover:underline",
              )}
            >
              {next ? <span className="font-normal text-white/70">Sıradaki:</span> : null}
              {t.action}
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

import { ArrowRight, ChevronDown, ChevronRight, ListTodo } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { TASK_BAR, TASK_STYLE } from "../task-style";
import { splitTasks, type DayTask } from "./logic";
import { PhoneFoldBar, PhoneMore, type PhoneFold } from "./phone-more";

/**
 * Bugün · "Yapılacaklar": Şimdi (sorunlu ve yapılacak işler), Sonra (zamanı gelmemiş, gri) ve kapalı Tamamlananlar.
 * Her satır bütünüyle ilgili ekrana giden bağlantıdır; satırın görünümü Genel bakış'taki ayın işlerinin geniş ekran
 * kartıyla aynı (durum stilleri task-style.tsx). Sıradaki iş (ilk sorunlu, yoksa ilk yapılacak) siyah çerçeve ve siyah
 * hapla öne çıkar. Telefonda ilk ekran kısa kalsın diye (docs/planlar/ux-sade.md §4.8, §13) sıradaki iş tam kart,
 * Şimdi'nin öbür işleri tek satır olarak "Diğer N iş" arkasında; "Sonra (N)", "Tamamlananlar (N)" ve "Ayın işleri"
 * bağlantısı en altta yan yana tek satır (PhoneFoldBar). Geniş ekran aynı: Sonra açık bölüm, Tamamlananlar kapalı.
 * Sunucu bileşeni: telefondaki düğmeler istemcide (PhoneMore, PhoneFoldBar), geniş ekrandaki Tamamlananlar
 * JavaScript'siz de açılıp kapanır.
 */
export function TodayTasks({ tasks, admin }: { tasks: DayTask[]; admin: boolean }) {
  const { now, later, done, next } = splitTasks(tasks);
  // Telefondaki tam kart: sıradaki iş; Şimdi'nin ilki değilse telefona ayrı bir kopyası en üste çizilir (DOM sırası
  // görünen sırayla aynı kalsın diye; geniş ekranda kopya gizli, satır yerinde)
  const lead = next ?? now[0] ?? null;
  const leadCopy = lead !== null && now[0]?.key !== lead.key;
  const others = now.filter((t) => t.key !== lead?.key).length;
  const nowId = "yapilacaklar-simdi";
  // Telefonun alt satırı: Sonra ve Tamamlananlar tek satır (açıklama ekran okuyucuya), bağlantı yanlarında
  const rowsOf = (list: DayTask[]) =>
    list.map((t) => (
      <li key={t.key}>
        <TaskLink task={t} next={false} compact />
      </li>
    ));
  const phoneFolds: PhoneFold[] = [
    ...(later.length ? [{ id: "yapilacaklar-sonra", title: "Sonra", count: later.length, children: rowsOf(later) }] : []),
    ...(done.length ? [{ id: "yapilacaklar-tamam", title: "Tamamlananlar", count: done.length, children: rowsOf(done) }] : []),
  ];
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
      <div className="space-y-5 px-5 pb-5 max-sm:space-y-3 max-sm:px-4 max-sm:pb-4">
        {now.length ? (
          <section aria-label="Şimdi">
            {/* Telefonda yalnız ekran okuyucuya: orada tek kart + "Diğer N iş" var, Sonra alt satırda (§13: kart ≤ 340 px) */}
            <h3 className="mb-2 text-[13px] font-semibold text-ink-soft max-sm:sr-only">Şimdi</h3>
            <PhoneMore count={others} controls={nowId}>
              <ul id={nowId} className="grid gap-2.5 max-sm:gap-2 sm:grid-cols-2">
                {leadCopy && lead ? (
                  <li className="sm:hidden">
                    <TaskLink task={lead} next={lead.key === next?.key} />
                  </li>
                ) : null}
                {now.map((t) => {
                  const isLead = t.key === lead?.key;
                  return (
                    <li
                      key={t.key}
                      className={cn(
                        isLead ? leadCopy && "max-sm:hidden" : "max-sm:hidden max-sm:group-data-[more=open]/more:block",
                      )}
                    >
                      <TaskLink task={t} next={t.key === next?.key} compact={!isLead} />
                    </li>
                  );
                })}
              </ul>
            </PhoneMore>
          </section>
        ) : null}
        {later.length ? (
          <section aria-label="Sonra" className="max-sm:hidden">
            <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">Sonra</h3>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {later.map((t) => (
                <li key={t.key}>
                  <TaskLink task={t} next={false} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {done.length ? (
          <Fold title="Tamamlananlar" count={done.length} className="max-sm:hidden">
            {done.map((t) => (
              <li key={t.key}>
                <TaskLink task={t} next={false} />
              </li>
            ))}
          </Fold>
        ) : null}
        {!tasks.length ? <p className="text-sm text-ink-mute">Bugün için iş yok.</p> : null}
        {admin ? (
          <Link href="/panel" className="inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-mute outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ink/30 max-sm:hidden">
            Ayın işleri Genel bakış&apos;ta <ArrowRight size={14} aria-hidden="true" />
          </Link>
        ) : null}
        {phoneFolds.length || admin ? (
          <PhoneFoldBar
            folds={phoneFolds}
            link={
              admin ? (
                <Link
                  href="/panel"
                  className="relative inline-flex min-h-5 items-center gap-1 text-[13px] text-ink-mute outline-none after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-ink hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30"
                >
                  Ayın işleri Genel bakış&apos;ta <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : undefined
            }
          />
        ) : null}
      </div>
    </Card>
  );
}

/** Kapalı başlayan grup (geniş ekran): "Tamamlananlar (N)" */
function Fold({ title, count, className, children }: { title: string; count: number; className?: string; children: ReactNode }) {
  return (
    <details className={cn("group/fold", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl text-[13px] font-semibold text-ink-soft outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        <ChevronDown size={15} aria-hidden="true" className="motion-safe:transition-transform group-open/fold:rotate-180" />
        {title} <span className="font-normal text-ink-mute tabular">({count})</span>
      </summary>
      <ul className="mt-1 grid gap-2.5 max-sm:gap-2 sm:grid-cols-2">{children}</ul>
    </details>
  );
}

/**
 * İşin satırı. `compact`: telefonda tek satır (ad + rozet + ok; açıklama yalnız ekran okuyucuya), geniş ekranda tam
 * kart (sm ve üstünde `max-sm:` sınıflarının etkisi yok).
 */
function TaskLink({ task: t, next, compact = false }: { task: DayTask; next: boolean; compact?: boolean }) {
  const st = TASK_STYLE[t.status];
  return (
    <Link
      href={t.href}
      className={cn(
        "group flex h-full items-start gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line transition-shadow outline-none hover:shadow-lift hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/30",
        compact && "max-sm:min-h-12 max-sm:items-center max-sm:gap-2.5 max-sm:py-2.5",
        next && "ring-2 ring-ink hover:ring-ink",
      )}
    >
      <span
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[17px] [&>svg]:stroke-[2]", compact && "max-sm:size-7 max-sm:[&>svg]:size-4", st.well)}
        aria-hidden="true"
      >
        {st.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("flex flex-wrap items-center justify-between gap-x-2 gap-y-1", compact && "max-sm:gap-x-1.5")}>
          <span className="text-sm font-semibold text-ink">{t.title}</span>
          <Badge tone={st.tone}>{t.badge ?? st.label}</Badge>
        </span>
        <span className={cn("mt-1 block text-[13px] leading-5 text-pretty break-words text-ink-mute", compact && "max-sm:sr-only")}>{t.detail}</span>
        <span className={cn("mt-auto pt-2.5", compact && "max-sm:hidden")}>
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
      {compact ? <ChevronRight size={16} className="shrink-0 self-center text-ink-quiet sm:hidden" aria-hidden="true" /> : null}
    </Link>
  );
}

import { ArrowLeft, ChevronLeft, ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { checklistDay, isStarted, lateFinish, listState, nowBusinessMinute, timeTR, type ChecklistLite } from "@/lib/checklists";
import { num } from "@/lib/format";
import { keepUntil } from "@/lib/photo-rules";
import { addDays, longDateTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { firstChecklistDay, loadChecklistHistory, type HistoryList } from "@/server/data/checklists";

import { RunView } from "../run-view";
import { KontrolTabs } from "../tabs";

export const metadata: Metadata = { title: "Kontrol geçmişi" };

const DESCRIPTION =
  "Hangi gün hangi liste, kim, ne zaman doldurdu; eksik maddeler, aralık dışı değerler ve fotoğraflar. Fotoğraflar 60 gün saklanır, kayıtlar silinmez.";
/** Gün listesinde bir sayfada gösterilen gün */
const PAGE_DAYS = 14;

/** Kontrol geçmişi (yalnız yönetici): son 14 günün listeleri ya da bir günün ayrıntısı (?gun=YYYY-MM-DD) */
export default function ChecklistHistoryPage({ searchParams }: PageProps<"/panel/kontrol/gecmis">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Kontrol listeleri" title="Geçmiş" description={DESCRIPTION} />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <HistoryContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDay = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)));

async function HistoryContent({ searchParams }: { searchParams: PageProps<"/panel/kontrol/gecmis">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const now = new Date();
  const today = checklistDay(now);
  const first = await firstChecklistDay();
  const gun = pick(sp.gun);
  const bitis = pick(sp.bitis);
  const header = <PageHeader eyebrow="Kontrol listeleri" title="Geçmiş" description={DESCRIPTION} tabs={<KontrolTabs current="/panel/kontrol/gecmis" />} />;
  if (!first) {
    return (
      <>
        {header}
        <EmptyState icon={<History />} title="Henüz kayıt yok" description="Listeler doldurulmaya başlanınca günler burada görünür." />
      </>
    );
  }
  if (isDay(gun) && gun <= today) {
    return (
      <>
        {header}
        <DayDetail day={gun} today={today} first={first} now={now} />
      </>
    );
  }
  const end = isDay(bitis) && bitis <= today ? bitis : today;
  const from = addDays(end, -(PAGE_DAYS - 1)) < first ? first : addDays(end, -(PAGE_DAYS - 1));
  const days = end < first ? [] : await loadChecklistHistory(from, end, now);
  return (
    <>
      {header}
      <Card>
        <CardHeader icon={<History />} title="Günler" description="Bir güne dokunun: listeler madde madde, fotoğraflarıyla." />
        {days.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {days.map((d) => (
              <DayRow key={d.day} day={d.day} lists={d.lists} today={today} now={now} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-4 text-sm text-ink-mute">Bu aralıkta kayıt yok.</p>
        )}
        {from > first ? (
          <CardFooter>
            <ButtonLink href={`/panel/kontrol/gecmis?bitis=${addDays(from, -1)}`} variant="ghost" size="sm">
              <ChevronLeft size={14} aria-hidden="true" /> Daha eski günler
            </ButtonLink>
          </CardFooter>
        ) : null}
      </Card>
    </>
  );
}

/** Gün satırındaki bir listenin çipi: "Açılış 09:42", "Kapanış geç 03:10", "Kapanış 3 eksik", "Açılış yapılmadı" … */
function chip(l: ChecklistLite, day: string, today: string, now: Date): { tone: Tone; text: string } {
  const run = l.run;
  if (run?.complete) {
    const at = run.completedAt ? timeTR(run.completedAt) : "";
    return lateFinish({ date: day, dueAt: l.dueAt, completedAt: run.completedAt }) ? { tone: "amber", text: `${l.name} geç ${at}` } : { tone: "green", text: `${l.name} ${at}` };
  }
  if (day === today) {
    const state = listState(l, nowBusinessMinute(now), false);
    if (state === "overdue") return { tone: "amber", text: `${l.name} gecikti` };
    if (isStarted(l) && run) return { tone: "blue", text: `${l.name} ${num(run.done)} / ${num(run.required)}` };
    return { tone: "gray", text: `${l.name} bekliyor` };
  }
  if (isStarted(l) && run) return { tone: "amber", text: `${l.name} ${num(run.required - run.done)} eksik` };
  return { tone: "red", text: `${l.name} yapılmadı` };
}

function DayRow({ day, lists, today, now }: { day: string; lists: HistoryList[]; today: string; now: Date }) {
  const issues = lists.flatMap((l) => l.lite.run?.issues ?? []);
  const ranges = issues.filter((x) => x.kind === "range").length;
  const others = issues.length - ranges;
  return (
    <li>
      <Link
        href={`/panel/kontrol/gecmis?gun=${day}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 outline-none hover:bg-surface/60 focus-visible:bg-surface/60 focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-inset max-sm:py-3.5"
      >
        <span className="w-36 shrink-0 text-sm font-medium text-ink">{longDateTR(day)}</span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {lists.length ? (
            lists.map((l) => {
              const c = chip(l.lite, day, today, now);
              return (
                <Badge key={l.template.id} tone={c.tone} dot>
                  {c.text}
                </Badge>
              );
            })
          ) : (
            <span className="text-[13px] text-ink-mute">Liste yok</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {ranges ? <Badge tone="red">{num(ranges)} aralık dışı</Badge> : null}
          {others ? <Badge tone="amber">{num(others)} sorun</Badge> : null}
          <ChevronRight size={16} className="text-ink-quiet" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

async function DayDetail({ day, today, first, now }: { day: string; today: string; first: string; now: Date }) {
  const [entry] = await loadChecklistHistory(day, day, now);
  const lists = entry?.lists ?? [];
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  // Fotoğraflar günün 60. gününde silinir (src/lib/photo-rules.ts keepUntil)
  const photosExpired = now.getTime() >= keepUntil("kontrol", day).getTime();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gün">
        <ButtonLink href="/panel/kontrol/gecmis" variant="ghost" size="sm">
          <ArrowLeft size={14} aria-hidden="true" /> Günler
        </ButtonLink>
        <Badge tone="blue">{longDateTR(day)}</Badge>
        <span className="ml-auto flex gap-2">
          {prev >= first ? (
            <ButtonLink href={`/panel/kontrol/gecmis?gun=${prev}`} variant="secondary" size="sm">
              <ChevronLeft size={14} aria-hidden="true" /> Önceki gün
            </ButtonLink>
          ) : null}
          {next <= today ? (
            <ButtonLink href={`/panel/kontrol/gecmis?gun=${next}`} variant="secondary" size="sm">
              Sonraki gün <ChevronRight size={14} aria-hidden="true" />
            </ButtonLink>
          ) : null}
        </span>
      </div>
      {lists.length ? (
        lists.map((l) => (
          <RunView
            key={l.template.id}
            name={l.lite.name}
            day={day}
            today={day === today}
            opensAt={l.lite.opensAt}
            dueAt={l.lite.dueAt}
            run={l.run !== null}
            completedAt={l.run?.completedAt ?? null}
            items={l.items}
            answers={l.answers}
            photosExpired={photosExpired}
          />
        ))
      ) : (
        <EmptyState icon={<History />} title="Bu gün liste yok" description="O gün beklenen bir kontrol listesi yoktu ve doldurulan da olmadı." />
      )}
    </div>
  );
}

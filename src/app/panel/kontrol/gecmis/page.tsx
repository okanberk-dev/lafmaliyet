import { ArrowLeft, ChevronLeft, ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { ALL_BRANCHES } from "@/lib/branches";
import { checklistDay, historyRange, isStarted, lateFinish, listState, nowBusinessMinute, STAFF_HISTORY_DAYS, timeTR, type ChecklistLite, type HistoryRange } from "@/lib/checklists";
import { monthTitle, prevMonth } from "@/lib/closed-period";
import { num } from "@/lib/format";
import { keepUntil } from "@/lib/photo-rules";
import { longDateTR } from "@/lib/reminders";
import { requireUser } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { firstChecklistDay, loadChecklistHistory, type HistoryList } from "@/server/data/checklists";

import { RunView } from "../run-view";
import { KontrolTabs } from "../tabs";
import { MonthPdfLink } from "./month-pdf";

export const metadata: Metadata = { title: "Kontrol geçmişi" };

const DESCRIPTION =
  "Hangi gün hangi liste, kim, ne zaman doldurdu; eksik maddeler, aralık dışı değerler ve fotoğraflar. Fotoğraflar 60 gün saklanır, kayıtlar silinmez.";
const STAFF_DESCRIPTION = `Son ${STAFF_HISTORY_DAYS} gün: hangi listeyi kim, ne zaman doldurdu; eksik maddeler ve sorunlar. Geçmiş gün doldurulamaz.`;

/**
 * Kontrol geçmişi: günlerin listeleri ya da bir günün ayrıntısı (?gun=YYYY-MM-DD). Yönetici ilk kayda kadar geriye 14
 * günlük sayfalarla gider; personel (dalga 10 §2.5) yalnız doldurabildiği listelerin son 7 gününü görür, salt okunur,
 * "Erken dolduruldu" rozeti olmadan. Pencere sunucuda (historyRange); fotoğraf yolu aynı sınırı uygular.
 */
export default function ChecklistHistoryPage({ searchParams }: PageProps<"/panel/kontrol/gecmis">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path="/panel/kontrol/gecmis" role="staff" title="Geçmiş" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <HistoryContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function HistoryContent({ searchParams }: { searchParams: PageProps<"/panel/kontrol/gecmis">["searchParams"] }) {
  const user = await requireUser();
  const admin = user.role === "admin";
  const sp = await searchParams;
  const now = new Date();
  const today = checklistDay(now);
  const first = await firstChecklistDay();
  // Aylık PDF (yalnız yönetici): ilk kaydın ayından bu aya, en yeni önce; şube panelde seçili olandan başlar
  const pdf = admin && first ? await monthPdfProps(first, today) : null;
  const header = (
    <PageHeader
      path="/panel/kontrol/gecmis"
      role={user.role}
      title="Geçmiş"
      description={admin ? DESCRIPTION : STAFF_DESCRIPTION}
      tabs={<KontrolTabs current="/panel/kontrol/gecmis" role={user.role} />}
      actions={pdf ? <MonthPdfLink {...pdf} /> : undefined}
    />
  );
  if (!first) {
    return (
      <>
        {header}
        <EmptyState icon={<History />} title="Henüz kayıt yok" description="Listeler doldurulmaya başlanınca günler burada görünür." />
      </>
    );
  }
  const range = historyRange({ role: user.role, today, first, gun: pick(sp.gun), bitis: pick(sp.bitis) });
  if (range.kind === "day") {
    return (
      <>
        {header}
        <DayDetail range={range} today={today} now={now} role={user.role} />
      </>
    );
  }
  const days = range.to < range.from ? [] : await loadChecklistHistory(range.from, range.to, user.role, now);
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
        {range.older ? (
          <CardFooter>
            <ButtonLink href={`/panel/kontrol/gecmis?bitis=${range.older}`} variant="ghost" size="sm">
              <ChevronLeft size={14} aria-hidden="true" /> Daha eski günler
            </ButtonLink>
          </CardFooter>
        ) : null}
      </Card>
    </>
  );
}

/** Aylık PDF'in seçenekleri: ilk kaydın ayından bu aya (en çok 24 ay), şubeler ("Bütün şubeler" dahil) ve seçili şube */
async function monthPdfProps(first: string, today: string) {
  const [branches, scope] = await Promise.all([listBranches(), currentBranchScope()]);
  const months: { month: string; title: string }[] = [];
  for (let m = today.slice(0, 7); m >= first.slice(0, 7) && months.length < 24; m = prevMonth(m)) months.push({ month: m, title: monthTitle(m) });
  const physical = branches.filter((b) => b.active && b.kind === "fiziksel").map((b) => ({ id: b.id, name: b.name }));
  const options = [...physical, { id: ALL_BRANCHES, name: "Bütün şubeler" }];
  return { months, branches: options, branch: options.some((o) => o.id === scope) ? scope : ALL_BRANCHES };
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
        {/* Telefonda çipler kendi satırına iner: tarih ve sorun rozetleri üstte, çipler altta (üst üste binmez) */}
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5 max-sm:order-last max-sm:basis-full">
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
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {ranges ? <Badge tone="red">{num(ranges)} aralık dışı</Badge> : null}
          {others ? <Badge tone="amber">{num(others)} sorun</Badge> : null}
          <ChevronRight size={16} className="text-ink-quiet" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

async function DayDetail({ range, today, now, role }: { range: Extract<HistoryRange, { kind: "day" }>; today: string; now: Date; role: "admin" | "staff" }) {
  const day = range.day;
  const admin = role === "admin";
  const [entry] = await loadChecklistHistory(day, day, role, now);
  const lists = entry?.lists ?? [];
  const nowBm = nowBusinessMinute(now);
  // Fotoğraflar günün 60. gününde silinir (src/lib/photo-rules.ts keepUntil)
  const photosExpired = now.getTime() >= keepUntil("kontrol", day).getTime();
  // Bugün: başlamış ya da aralığı açılmış liste hâlâ doldurulur (geçmiş gün doldurulamaz)
  const openHref = (l: HistoryList) => {
    if (day !== today || !l.template.active) return null;
    const state = listState(l.lite, nowBm, false);
    return isStarted(l.lite) || state === "open" || state === "overdue" ? `/panel/kontrol/${l.template.id}` : null;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gün">
        <ButtonLink href="/panel/kontrol/gecmis" variant="ghost" size="sm">
          <ArrowLeft size={14} aria-hidden="true" /> Günler
        </ButtonLink>
        <Badge tone="blue">{longDateTR(day)}</Badge>
        <span className="ml-auto flex gap-2">
          {range.prev ? (
            <ButtonLink href={`/panel/kontrol/gecmis?gun=${range.prev}`} variant="secondary" size="sm">
              <ChevronLeft size={14} aria-hidden="true" /> Önceki gün
            </ButtonLink>
          ) : null}
          {range.next ? (
            <ButtonLink href={`/panel/kontrol/gecmis?gun=${range.next}`} variant="secondary" size="sm">
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
            audit={admin}
            openHref={openHref(l)}
          />
        ))
      ) : (
        <EmptyState icon={<History />} title="Bu gün liste yok" description="O gün beklenen bir kontrol listesi yoktu ve doldurulan da olmadı." />
      )}
    </div>
  );
}

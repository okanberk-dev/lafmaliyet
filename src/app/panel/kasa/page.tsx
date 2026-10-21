import { ArrowLeft, Gift, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { businessDate, CASH_TOLERANCE, diffKind, diffText, staffCanReport, whatsappLink, whatsappText } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { addDays, longDateTR, monthTitleTR, shiftMonth } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/dal";
import { cashReportsBetween, getCashReport, loadCashSettings, previousCarryOver, type CashReportDTO } from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { isEmailConfigured } from "@/server/notify/resend";

import { CashForm } from "./cash-form";
import { CashHistory, type CashMonthTotals } from "./cash-history";
import { CashSettingsCard } from "./cash-settings";
import { DIFF_TONE } from "./cash-summary";

export const metadata: Metadata = { title: "Kasa raporu" };

export default function CashPage({ searchParams }: PageProps<"/panel/kasa">) {
  return (
    <>
      <PageHeader
        title="Kasa raporu"
        eyebrow="Günlük"
        description="Her akşam kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayın ve buraya girin. Eksik / fazla kendiliğinden hesaplanır; gönderince yöneticiye e-posta gider, WhatsApp ile de paylaşılır."
      />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <CashContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDay = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** Ayın günleri (en yeni önce): bugünün raporu yoksa bugün listede yok (akşam girilecek) */
function monthDays(month: string, today: string, reports: CashReportDTO[]): { date: string; report: CashReportDTO | null }[] {
  const byDate = new Map(reports.map((r) => [r.date, r]));
  const start = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const end = last < today ? last : byDate.has(today) ? today : addDays(today, -1);
  const days: { date: string; report: CashReportDTO | null }[] = [];
  for (let d = end; d >= start; d = addDays(d, -1)) days.push({ date: d, report: byDate.get(d) ?? null });
  return days;
}

function totalsOf(days: { report: CashReportDTO | null }[]): CashMonthTotals {
  const reports = days.flatMap((d) => (d.report ? [d.report] : []));
  const sum = (f: (r: CashReportDTO) => number) => Math.round(reports.reduce((a, r) => a + f(r), 0) * 100) / 100;
  return {
    zTotal: sum((r) => r.zTotal),
    cash: sum((r) => r.cash),
    card: sum((r) => r.card),
    short: sum((r) => (r.cashDiff <= -CASH_TOLERANCE ? -r.cashDiff : 0)),
    over: sum((r) => (r.cashDiff >= CASH_TOLERANCE ? r.cashDiff : 0)),
    reported: reports.length,
    days: days.length,
  };
}

async function CashContent({ searchParams }: { searchParams: PageProps<"/panel/kasa">["searchParams"] }) {
  const user = await requireUser();
  const admin = user.role === "admin";
  const sp = await searchParams;
  const today = businessDate();
  const gun = pick(sp.gun);
  // Personel bugünü ve dünü girer; yönetici herhangi bir geçmiş günü açar
  let date = isDay(gun) && gun <= today ? gun : today;
  if (!admin && !staffCanReport(date)) date = today;
  const showForm = !admin || isDay(gun);

  const settings = await loadCashSettings();
  const [report, carry, recent, waste] = await Promise.all([
    showForm ? getCashReport(date) : Promise.resolve(null),
    showForm ? previousCarryOver(date) : Promise.resolve(null),
    admin ? Promise.resolve([]) : cashReportsBetween(addDays(today, -6), today),
    showForm ? dayWaste(date) : Promise.resolve(null),
  ]);
  const whatsapp = report
    ? (() => {
        const text = whatsappText(report, { by: report.submittedByName, revision: report.revision, waste });
        return { text, link: whatsappLink(text, settings.whatsapp) };
      })()
    : null;
  // Günün zayi ve ikramı: kasa raporuyla birlikte gider (ModPOS'ta ödenmez görünen ikramla karşılaştırılır)
  const wasteCard = waste ? (
    <Card>
      <CardHeader icon={<Gift />} title="Günün zayi & ikramı" description="Rapora, e-postaya ve WhatsApp metnine eklenir" />
      <div className="space-y-2 px-5 pb-5 text-sm">
        {waste.ikram || waste.zayi ? (
          <>
            {waste.ikram ? (
              <p className="break-words">
                <span className="font-medium text-ink">İkram:</span> <span className="text-ink-soft">{waste.ikram}</span>
              </p>
            ) : null}
            {waste.zayi ? (
              <p className="break-words">
                <span className="font-medium text-ink">Zayi:</span> <span className="text-ink-soft">{waste.zayi}</span>
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-ink-mute">Bu gün zayi ya da ikram girilmedi. Ödenmeden verilen ya da atılan bir şey olduysa kasa raporundan önce girin.</p>
        )}
        <ButtonLink href={`/panel/zayi?gun=${date}`} variant="secondary" size="sm">
          <Gift size={14} /> Zayi / ikram ekle
        </ButtonLink>
      </div>
    </Card>
  ) : null;
  const form = showForm ? (
    <CashForm
      key={`${date}:${report?.revision ?? 0}`}
      date={date}
      report={report}
      carry={carry}
      whatsapp={whatsapp}
      recipients={settings.emailEnabled ? settings.recipients.length : 0}
      canEdit={admin || staffCanReport(date)}
    />
  ) : null;
  const yesterday = addDays(today, -1);
  const dayChips = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rapor günü">
      {admin && isDay(gun) ? (
        <ButtonLink href="/panel/kasa" variant="ghost" size="sm">
          <ArrowLeft size={14} /> Günden güne
        </ButtonLink>
      ) : null}
      {[today, yesterday].map((d) => (
        <ButtonLink key={d} href={`/panel/kasa?gun=${d}`} variant={d === date ? "primary" : "secondary"} size="sm" aria-current={d === date ? "page" : undefined}>
          {d === today ? "Bugün" : "Dün"} · {longDateTR(d).split(" ").slice(0, 2).join(" ")}
        </ButtonLink>
      ))}
      {admin && isDay(gun) && date !== today && date !== yesterday ? <Badge tone="blue">{longDateTR(date)}</Badge> : null}
    </div>
  );

  if (!admin) {
    return (
      <div className="space-y-4">
        {dayChips}
        {form}
        {wasteCard}
        <Card>
          <CardHeader icon={<ReceiptText />} title="Son 7 gün" description="Gönderilen raporlar" />
          <ul className="divide-y divide-line border-t border-line">
            {recent.length ? (
              recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                  <span className="w-[8.5rem] shrink-0 font-medium text-ink">{longDateTR(r.date)}</span>
                  <span className="min-w-0 flex-1 text-ink-mute">
                    {r.submittedByName} · Z {money(r.zTotal)}
                  </span>
                  <Badge tone={DIFF_TONE[diffKind(r.cashDiff)]} dot>
                    {diffText(r.cashDiff)}
                  </Badge>
                </li>
              ))
            ) : (
              <li className="px-5 py-4 text-sm text-ink-mute">Henüz rapor yok.</li>
            )}
          </ul>
        </Card>
      </div>
    );
  }

  const ay = pick(sp.ay);
  const month = ay && /^\d{4}-(0[1-9]|1[0-2])$/.test(ay) && ay <= today.slice(0, 7) ? ay : today.slice(0, 7);
  const monthReports = await cashReportsBetween(`${month}-01`, addDays(`${shiftMonth(month, 1)}-01`, -1));
  const days = monthDays(month, today, monthReports);
  const todays = monthReports.find((r) => r.date === today) ?? (month === today.slice(0, 7) ? null : await getCashReport(today));
  return (
    <div className="space-y-4">
      {showForm ? (
        <>
          {dayChips}
          {form}
          {wasteCard}
        </>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <CashHistory
            monthLabel={monthTitleTR(month)}
            prevHref={`/panel/kasa?ay=${shiftMonth(month, -1)}`}
            nextHref={month < today.slice(0, 7) ? `/panel/kasa?ay=${shiftMonth(month, 1)}` : null}
            days={days}
            totals={totalsOf(days)}
            whatsappPhone={settings.whatsapp}
          />
        </div>
        <div className="space-y-4">
          {!showForm ? (
            <Card>
              <CardHeader icon={<ReceiptText />} title="Bugün" description={longDateTR(today)} />
              <div className="space-y-3 px-5 pb-5">
                {todays ? (
                  <p className={cn("text-2xl font-semibold tracking-tight", diffKind(todays.cashDiff) === "short" ? "text-bad" : diffKind(todays.cashDiff) === "over" ? "text-warn" : "text-good")}>
                    {diffText(todays.cashDiff)}
                    <span className="block text-sm font-normal text-ink-mute">
                      {todays.submittedByName} · Z {money(todays.zTotal)}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-ink-mute">Bugünün raporu henüz girilmedi; personel kapanışta girer.</p>
                )}
                <ButtonLink href={`/panel/kasa?gun=${today}`} variant={todays ? "secondary" : "primary"} className="w-full">
                  {todays ? "Raporu aç" : "Raporu gir"}
                </ButtonLink>
              </div>
            </Card>
          ) : null}
          <CashSettingsCard settings={settings} emailConfigured={isEmailConfigured()} />
        </div>
      </div>
    </div>
  );
}

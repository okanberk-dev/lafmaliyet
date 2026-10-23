import { ArrowLeft, Gift, Globe, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { kasaMonthLine, resolveMonth, tillMonths } from "@/lib/cash-month";
import {
  businessDate,
  carryCheck,
  carryChecks,
  CASH_TOLERANCE,
  computeCash,
  diffKind,
  diffText,
  integrityOf,
  staffCanReport,
  staffDayEditable,
  whatsappLink,
  whatsappText,
  type CarryCheck,
  type CashRevisionRow,
} from "@/lib/cash-report";
import { money } from "@/lib/format";
import { photoDiffs, savedFields, suspiciousDiffs } from "@/lib/photo-read/kasa";
import { addDays, longDateTR, monthTitleTR, shiftMonth } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { aiStatus } from "@/server/ai/claude";
import { requireUser } from "@/server/auth/dal";
import { cashOutCategories, cashOutsBetween, cashOutsOn } from "@/server/data/cash-outs";
import { cashReportPhotoInfo, extrasFrom } from "@/server/data/cash-photos";
import {
  cashCounters,
  cashReportsBetween,
  cashRevisionsFor,
  firstCashReportDate,
  getCashReport,
  loadCashSettings,
  loadMonthEntry,
  nextReportAfter,
  previousCarryOver,
  type CashReportDTO,
} from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { isEmailConfigured } from "@/server/notify/resend";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { photoStorage } from "@/server/storage/photos";

import { CashForm } from "./cash-form";
import { CashHistory, type CashHistoryPhotos, type CashMonthTotals } from "./cash-history";
import { CashOutsCard } from "./cash-outs";
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
  const storage = photoStorage();
  const [report, carry, recent, waste, ai, outs, categories, next, counters] = await Promise.all([
    showForm ? getCashReport(date) : Promise.resolve(null),
    showForm ? previousCarryOver(date) : Promise.resolve(null),
    admin ? Promise.resolve([]) : cashReportsBetween(addDays(today, -6), today),
    showForm ? dayWaste(date) : Promise.resolve(null),
    aiStatus(),
    showForm ? cashOutsOn(date) : Promise.resolve([]),
    showForm ? cashOutCategories(user.role) : Promise.resolve([]),
    // Sonraki günün raporu: açılışı bu raporun devriyle karşılaştırılır; varsa personel bu raporu düzeltemez
    showForm ? nextReportAfter(date) : Promise.resolve(null),
    showForm ? cashCounters() : Promise.resolve([]),
  ]);
  const revisions = report && report.revision > 1 ? await cashRevisionsFor([report.id]) : [];
  // Personel bugünü ve dünü düzenler; ertesi günün raporu girildiyse o gün kapanır (kasadan çıkanlar ve fotoğraflar da)
  const staffOpen = staffDayEditable(date, { hasReport: Boolean(report), laterReport: next !== null });
  const canEdit = admin || staffOpen;
  // Personel yalnız kendi seçebildiği kategorilerin adını görür (yöneticinin maaş, kira gibi seçimi adıyla görünmez)
  const staffCats = new Set(categories.map((c) => c.id));
  const dayOuts = admin ? outs : outs.map((o) => (o.categoryId !== null && !staffCats.has(o.categoryId) ? { ...o, categoryName: null } : o));
  // Raporun fotoğrafları: yönetici hepsini, personel hâlâ düzenleyebildiği günü görür (fotoğraf erişimiyle aynı kural)
  const photoInfo = report && canEdit ? (await cashReportPhotoInfo([report])).get(report.id) : undefined;
  const whatsapp = report
    ? (() => {
        const text = whatsappText(report, {
          by: report.submittedByName,
          revision: report.revision,
          waste,
          ...extrasFrom(photoInfo, outs, report),
          ...integrityOf(report, carry, next, revisions),
        });
        return { text, link: whatsappLink(text, settings.whatsapp) };
      })()
    : null;
  // Kasayı sayan: etkin kullanıcılar; raporda kayıtlı sayan artık pasifse "(pasif)" ekiyle seçili kalır
  const counterId = report ? (report.countedBy ?? report.submittedBy) : user.id;
  const counterOptions =
    report && counterId !== null && !counters.some((c) => c.id === counterId)
      ? [...counters, { id: counterId, name: `${report.countedByName ?? report.submittedByName} (pasif)` }]
      : counters;
  const photoUi = { storage: storage.available, reading: ai.state, admin, me: user.name };
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
  // laffogato.net'in o günkü online satışı: bilgi satırı, sayfayı bekletmez (site gelene kadar boş, gelmezse yok)
  const siteRow = showForm ? (
    <Suspense fallback={null}>
      <SiteDayRow date={date} admin={admin} />
    </Suspense>
  ) : null;
  const form = showForm ? (
    <CashForm
      key={`${date}:${report?.revision ?? 0}`}
      date={date}
      report={report}
      carry={carry}
      whatsapp={whatsapp}
      recipients={settings.emailEnabled ? settings.recipients.length : 0}
      canEdit={canEdit}
      photoUi={photoUi}
      saved={report ? (photoInfo ?? { photos: [], readings: [] }) : null}
      cashOuts={dayOuts}
      next={next}
      counters={counterOptions}
      me={{ id: user.id, name: user.name }}
      revisions={revisions}
      locked={!admin && Boolean(report) && !staffOpen && next !== null}
    />
  ) : null;
  // Gün içinde kasadan çıkanlar: gün boyunca kullanılan kart (akşam formu boşken de)
  const outsCard = showForm ? (
    <CashOutsCard
      date={date}
      today={date === today}
      lines={dayOuts}
      categories={categories}
      canEdit={canEdit}
      admin={admin}
      me={user.name}
      storage={storage.available}
      reading={ai.state}
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
        {outsCard}
        {form}
        {siteRow}
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
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const [monthReports, monthOuts, before, after, firstEver, entry] = await Promise.all([
    cashReportsBetween(`${month}-01`, monthEnd),
    cashOutsBetween(`${month}-01`, monthEnd),
    // Açılış ↔ devir zinciri: ayın ilk raporu önceki ayın son raporuyla, son raporu sonraki ayın ilkiyle karşılaştırılır
    previousCarryOver(`${month}-01`),
    nextReportAfter(monthEnd),
    firstCashReportDate(),
    loadMonthEntry(month),
  ]);
  const days = monthDays(month, today, monthReports);
  const monthRevisions = await cashRevisionsFor(monthReports.filter((r) => r.revision > 1).map((r) => r.id));
  const checks = carryChecks(monthReports, before);
  const lastReport = monthReports[0];
  const afterCheck = after && lastReport ? carryCheck(after.date, after.openingCash, { date: lastReport.date, amount: computeCash(lastReport).carryOver }) : null;
  const carryByDate: Record<string, CarryCheck> = Object.fromEntries([...checks, ...(afterCheck ? [[after!.date, afterCheck] as const] : [])]);
  const revisionsById: Record<number, CashRevisionRow[]> = {};
  for (const r of monthRevisions) (revisionsById[r.reportId] ??= []).push(r);
  // Ayın açık günü ve cirosu nereden (Satışlar'daki ay bilgisi): tek satır, Satışlar'a bağlantı
  const monthLine = kasaMonthLine(resolveMonth(month, entry ?? undefined, tillMonths(monthReports, addDays(today, -1), firstEver)[0]));
  const todays = monthReports.find((r) => r.date === today) ?? (month === today.slice(0, 7) ? null : await getCashReport(today));
  // Günden güne: fotoğraflı raporlar, fotoğraftan farklı yazılanlar ve günlerin kasadan çıkanları
  const infos = await cashReportPhotoInfo(monthReports);
  const outsByDate: Record<string, typeof monthOuts> = {};
  for (const o of monthOuts) (outsByDate[o.date] ??= []).push(o);
  const historyPhotos: CashHistoryPhotos = Object.fromEntries(
    monthReports.map((r) => {
      const info = infos.get(r.id);
      const saved = savedFields(r);
      return [
        r.id,
        {
          photos: info?.photos ?? [],
          diffs: info ? photoDiffs(info.readings, saved) : [],
          suspicious: info ? suspiciousDiffs(info.readings, saved) : [],
          extras: extrasFrom(info, outsByDate[r.date] ?? [], r),
        },
      ];
    }),
  );
  return (
    <div className="space-y-4">
      {showForm ? (
        <>
          {dayChips}
          {outsCard}
          {form}
          {siteRow}
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
            photos={historyPhotos}
            cashOuts={outsByDate}
            carry={carryByDate}
            revisions={revisionsById}
            monthLine={
              monthLine ? (
                <Link href={`/panel/satislar?ay=${month}#m-days`} className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:inline-block pointer-coarse:py-2.5">
                  {monthLine} → Satışlar
                </Link>
              ) : null
            }
          />
        </div>
        <div className="space-y-4">
          {!showForm ? (
            <Card>
              <CardHeader icon={<ReceiptText />} title="Bugünün raporu" description={longDateTR(today)} />
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

/**
 * laffogato.net'in o günkü online satışı (docs/SITE-SATIS.md): uygulama ve web siparişleri ve karaoke ön ödemesi,
 * kasadan geçmez. Bilgi satırıdır: kasa farkına, Z raporuna ve hiçbir kasa rakamına girmez. Sayfa açılınca sorulur;
 * bağlantı kapalıysa, site ulaşılamazsa ya da 8 saniyede yanıt vermezse satır görünmez (rapor beklemez). Personele
 * karaoke tutarı gösterilmez (README: karaoke tutarları yalnız yöneticiye).
 */
async function SiteDayRow({ date, admin }: { date: string; admin: boolean }) {
  const row = await fetchTillOnlineRow(date);
  if (!row) return null;
  return (
    <div role="note" className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info">
      <Globe size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">laffogato.net · {longDateTR(date)}:</span> Online (site + uygulama) {money(row.online)}
        {admin ? <> · Karaoke ön ödeme {money(row.karaoke)}</> : null} — kasadan geçmez.
        <span className="block text-[13px] text-info/80">
          Bilgi için: kasa farkına ve Z raporuna girmez; ModPOS&apos;un &quot;Online&quot; ödemesi (Yemeksepeti, Getir…) ayrı. Sitenin günü gece yarısında biter.
        </span>
      </p>
    </div>
  );
}

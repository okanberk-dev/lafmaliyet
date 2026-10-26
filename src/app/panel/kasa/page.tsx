import { ArrowLeft, ClipboardCheck, Gift, Globe, ReceiptText } from "lucide-react";
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
  staffLateDay,
  whatsappLink,
  whatsappText,
  type CarryCheck,
  type CashRevisionRow,
} from "@/lib/cash-report";
import { staffCashOutRow } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import { shortDayTR } from "@/lib/cash-requests";
import { genitive } from "@/lib/recipe-change";
import { cumulativeRejectedText, okcCumulativeToStore, okcHasFigures, okcMonth, type OkcPrev } from "@/lib/okc-z";
import { photoDiffs, savedFields, suspiciousDiffs, type CashReading } from "@/lib/photo-read/kasa";
import { okcReadFigures } from "@/lib/photo-read/okc";
import { addDays, dayLocativeTR, longDateTR, monthTitleTR, shiftMonth, todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { closedEvidenceText } from "@/lib/closed-days";
import { aiStatus } from "@/server/ai/claude";
import { requireUser } from "@/server/auth/dal";
import { chainNeighbours } from "@/server/cash/late-chain";
import { cashEmailRecipients } from "@/server/cash/report-store";
import { closedDayEvidence, isClosedDay, staffClosedState } from "@/server/closed-days";
import { loadKasaCariHints, loadLinkedCashOuts, loadSupplierNames } from "@/server/data/cari";
import { lateRequestFor, lateRequestsByReport, pendingLateByDay, staffLateDays } from "@/server/data/cash-late";
import { photoRemovalStates, staffCashOutRequests, staffOldCashOutDays } from "@/server/data/cash-out-requests";
import { cashOutCategories, cashOutsBetween, cashOutsOn, type CashOutView } from "@/server/data/cash-outs";
import { cashReportPhotoInfo, extrasFrom } from "@/server/data/cash-photos";
import { myCashRequests, pendingCashForDay, pendingCashForDayAdmin, proposedByForReports } from "@/server/data/cash-requests";
import {
  cashCounters,
  cashReportsBetween,
  cashRevisionsFor,
  firstCashReportDate,
  firstOkcReportDate,
  getCashReport,
  loadCashSettings,
  loadMonthEntry,
  nextReportAfter,
  okcRows,
  previousCarryOver,
  previousOkc,
  type CashReportDTO,
} from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { getDb } from "@/server/db";
import { isEmailConfigured } from "@/server/notify/resend";
import { staffLateDayOpen } from "@/server/photo-read/rules";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { photoStorage } from "@/server/storage/photos";

import { CashForm } from "./cash-form";
import { ClosedDayBar } from "./closed-day";
import { CashHistory, type CashHistoryPhotos, type CashMonthTotals } from "./cash-history";
import { CashOutsCard } from "./cash-outs";
import { MyCashRequests } from "./cash-requests";
import { LateDaysCard, LateReport } from "./late-report";
import { CashSettingsCard } from "./cash-settings";
import { DIFF_TONE, type OkcAdminView } from "./cash-summary";

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
  // Personel bugünü ve dünü girer; yönetici herhangi bir geçmiş günü açar. Dünden eski, raporu girilmemiş son 14 gün
  // personele geç rapor olarak açılır (yöneticinin onayıyla; docs/KASA-RAPORU.md › Geç rapor)
  if (!admin && isDay(gun) && staffLateDay(gun) && (await staffLateDayOpen(gun))) return <StaffLateDay date={gun} user={user} />;
  let date = isDay(gun) && gun <= today ? gun : today;
  if (!admin && !staffCanReport(date)) date = today;
  const showForm = !admin || isDay(gun);

  const settings = await loadCashSettings();
  // E-postanın gittiği adres sayısı: personel hesabına ait adres gönderimde düşer (report-email.ts)
  const mailTo = settings.emailEnabled && showForm ? (await cashEmailRecipients(getDb(), settings.recipients)).length : 0;
  const storage = photoStorage();
  const [report, carry, recent, waste, ai, outs, categories, next, counters, prevOkc] = await Promise.all([
    // Sunucu sütunları (yazarkasa kümülatifi, yazarkasa dışı tahsilat) yalnız yöneticinin DTO'sunda
    showForm ? getCashReport(date, user.role) : Promise.resolve(null),
    showForm ? previousCarryOver(date) : Promise.resolve(null),
    admin ? Promise.resolve([]) : cashReportsBetween(addDays(today, -6), today),
    showForm ? dayWaste(date) : Promise.resolve(null),
    aiStatus(),
    showForm ? cashOutsOn(date) : Promise.resolve([]),
    showForm ? cashOutCategories(user.role) : Promise.resolve([]),
    // Sonraki günün raporu: açılışı bu raporun devriyle karşılaştırılır; varsa personel bu raporu düzeltemez
    showForm ? nextReportAfter(date) : Promise.resolve(null),
    showForm ? cashCounters() : Promise.resolve([]),
    // Önceki yazarkasa Z'si: forma yalnız gün ve numara gider (Z no denetimi); kümülatif yalnız yöneticinin satırında
    showForm ? previousOkc(date) : Promise.resolve<OkcPrev>({ z: null, cum: null }),
  ]);
  const [revisions, proposedMap, dayRequests, adminRequests, myRequests, lateDays, outRequests, oldDays] = await Promise.all([
    report && report.revision > 1 ? cashRevisionsFor([report.id]) : Promise.resolve([]),
    report && report.revision > 1 ? proposedByForReports([report.id]) : Promise.resolve(new Map<number, Map<number, string>>()),
    // Personel: bu raporun bekleyen istekleri (kendisininki tam, başkalarınınki yalnız adı); yönetici: formdaki bant
    !admin && report ? pendingCashForDay(date, user) : Promise.resolve(null),
    admin && showForm ? pendingCashForDayAdmin(date) : Promise.resolve([]),
    admin ? Promise.resolve([]) : myCashRequests(user.id),
    // Personel: dünden eski, raporu girilmemiş son 14 gün (geç rapor)
    admin ? Promise.resolve([]) : staffLateDays(user),
    // Personel: bu günün kasadan çıkan istekleri (kendisininki satırın kendisi, başkalarınınki yalnız ad) ve eski günler
    admin ? Promise.resolve(null) : staffCashOutRequests(date, user),
    admin ? Promise.resolve([]) : staffOldCashOutDays(),
  ]);
  const proposedBy = report ? Object.fromEntries(proposedMap.get(report.id) ?? []) : undefined;
  // Personel bugünü ve dünü düzenler; ertesi günün raporu girildiyse o gün kapanır (kasadan çıkanlar ve fotoğraflar da)
  const staffOpen = staffDayEditable(date, { hasReport: Boolean(report), laterReport: next !== null });
  const canEdit = admin || staffOpen;
  // Personel yalnız kendi seçebildiği kategorilerin adını görür (yöneticinin maaş, kira gibi seçimi adıyla görünmez)
  const staffCats = new Set(categories.map((c) => c.id));
  // Tedarikçi ödemesine bağlı satırlar (docs/TEDARIKCILER.md "Hesap hareketleri"): yönetici satırda tedarikçiyi ve
  // önerileri görür, personel yalnız kilidi; personelin satır verisi beyaz listeyle kurulur (ödeme bağı gitmez)
  const ids = outs.map((o) => o.id);
  const [linked, supplierNames, cariHints] = showForm
    ? await Promise.all([admin ? Promise.resolve(new Set<number>()) : loadLinkedCashOuts(ids), loadSupplierNames(), admin ? loadKasaCariHints(ids, today) : Promise.resolve({})])
    : [new Set<number>(), [], {}];
  const dayOuts: CashOutView[] = admin
    ? outs
    : outs.map((o) => staffCashOutRow(o.categoryId !== null && !staffCats.has(o.categoryId) ? { ...o, categoryName: null } : o, linked.has(o.id)));
  // Raporun fotoğraf bilgisi: WhatsApp metninin "📷 … fotoğrafı panelde" ve "Fotoğraftan farklı yazılan" satırları
  // e-postadakiyle aynı olsun diye personelin girebildiği her günde (cashReportWhatsapp'ın kuralı). Fotoğrafların
  // kendisini (küçük resim, büyütme) yalnız görebilen görür: yönetici ya da personelin hâlâ düzenleyebildiği gün
  // (/api/foto'nun kuralı, staffDayOpen); kapanan günde personel küçük resim yerine fiş simgesini görür (403 olmasın)
  const photoInfo = report && (admin || staffCanReport(date)) ? (await cashReportPhotoInfo([report], user.role)).get(report.id) : undefined;
  const showPhotos = canEdit;
  // Personel: rapora bağlı Z / POS fotoğrafının kaldırılmasını isteyebilir mi (fotoğraf başına; tek Z ya da okuma farkı varsa hayır)
  const removal = !admin && report && showPhotos && photoInfo?.photos.length ? await photoRemovalStates(report, photoInfo.photos) : undefined;
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
      recipients={mailTo}
      canEdit={canEdit}
      photoUi={photoUi}
      saved={report ? { photos: showPhotos ? (photoInfo?.photos ?? []) : [], readings: photoInfo?.readings ?? [] } : null}
      cashOuts={dayOuts}
      next={next}
      counters={counterOptions}
      me={{ id: user.id, name: user.name }}
      revisions={revisions}
      locked={!admin && Boolean(report) && !staffOpen && next !== null}
      requests={dayRequests}
      proposedBy={proposedBy}
      photoRemoval={removal}
      prevOkcZ={prevOkc.z}
      // Kümülatif ve yazarkasa dışı tahsilat yalnız yöneticiye: personelin yükünde anahtarı da yok
      {...(admin && report ? { okcAdmin: okcAdminView(report, photoInfo?.readings ?? [], prevOkc.cum ?? null) } : {})}
    />
  ) : null;
  // Yönetici: bu gün için personelin bekleyen istekleri (Onaylar'daki karta götürür; yöneticinin düzeltmesi isteği kapatmaz)
  const adminBand = adminRequests.length ? (
    <div role="note" className="space-y-1 rounded-2xl bg-warn-soft px-4 py-3 text-sm leading-5 text-warn">
      {adminRequests.map((r) => (
        <p key={r.id} className="flex flex-wrap items-center gap-x-2">
          <ClipboardCheck size={15} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {r.kind === "kasa-silme"
              ? `${r.requestedByName} raporun silinmesini istedi`
              : r.kind === "kasa-gec"
                ? `${r.requestedByName} bu günün raporunu ${dayLocativeTR(todayTR(new Date(r.createdAt)))} onaya gönderdi. Burada girerseniz onun isteği kapanır.`
                : `${genitive(r.requestedByName)} düzeltme önerisi bekliyor`}
          </span>
          <Link href={`/panel/onaylar#istek-${r.id}`} className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:inline-block pointer-coarse:py-2.5">
            Onaylar&apos;da bakın
          </Link>
        </p>
      ))}
    </div>
  ) : null;
  // Gün içinde kasadan çıkanlar: gün boyunca kullanılan kart (akşam formu boşken de)
  const outsCard = showForm ? (
    <CashOutsCard
      date={date}
      today={date === today}
      lines={dayOuts}
      categories={categories}
      canEdit={canEdit}
      showPhotos={showPhotos}
      admin={admin}
      me={user.name}
      storage={storage.available}
      reading={ai.state}
      reported={report ? { amount: report.cashOut, note: report.cashOutNote } : null}
      locked={!admin && !staffOpen}
      requests={outRequests}
      oldDays={oldDays}
      supplierNames={supplierNames}
      hints={cariHints}
    />
  ) : null;
  const yesterday = addDays(today, -1);
  // Raporsuz geçmiş gün: "Kafe kapalıydı" (personel yalnız dün için, yöneticinin onayıyla; yönetici doğrudan)
  const closedBar = showForm && !report && date < today ? await closedBarFor(date, admin, user, yesterday) : null;
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
        {closedBar}
        {outsCard}
        {form}
        {siteRow}
        {wasteCard}
        <LateDaysCard days={lateDays} storage={storage.available} />
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
        <MyCashRequests requests={myRequests} />
      </div>
    );
  }

  const ay = pick(sp.ay);
  const month = ay && /^\d{4}-(0[1-9]|1[0-2])$/.test(ay) && ay <= today.slice(0, 7) ? ay : today.slice(0, 7);
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const [monthReports, monthOuts, before, after, firstEver, entry, monthOkc, okcFirst, okcBefore] = await Promise.all([
    cashReportsBetween(`${month}-01`, monthEnd, "admin"),
    cashOutsBetween(`${month}-01`, monthEnd),
    // Açılış ↔ devir zinciri: ayın ilk raporu önceki ayın son raporuyla, son raporu sonraki ayın ilkiyle karşılaştırılır
    previousCarryOver(`${month}-01`),
    nextReportAfter(monthEnd),
    firstCashReportDate(),
    loadMonthEntry(month),
    // Yazarkasa (mali) Z'leri: ay kartının satırı, "Yazarkasa Z yok" rozetinin başlangıcı ve kümülatif zinciri (ayın
    // satırları; zincirin başı, önceki ayın son saklanan kümülatifi, previousOkc'tan okcMonthLine'a satır olarak eklenir)
    okcRows(`${month}-01`, monthEnd),
    firstOkcReportDate(),
    previousOkc(`${month}-01`),
  ]);
  const days = monthDays(month, today, monthReports);
  const revised = monthReports.filter((r) => r.revision > 1).map((r) => r.id);
  const [monthRevisions, monthProposed, lateApproved, latePending] = await Promise.all([
    cashRevisionsFor(revised),
    proposedByForReports(revised),
    // Geç raporlar: onaylananlar (rapora göre) ve onay bekleyenler (güne göre)
    lateRequestsByReport(monthReports.map((r) => r.id)),
    pendingLateByDay(`${month}-01`, monthEnd),
  ]);
  const checks = carryChecks(monthReports, before);
  const lastReport = monthReports[0];
  const afterCheck = after && lastReport ? carryCheck(after.date, after.openingCash, { date: lastReport.date, amount: computeCash(lastReport).carryOver }) : null;
  const carryByDate: Record<string, CarryCheck> = Object.fromEntries([...checks, ...(afterCheck ? [[after!.date, afterCheck] as const] : [])]);
  const revisionsById: Record<number, CashRevisionRow[]> = {};
  for (const r of monthRevisions) (revisionsById[r.reportId] ??= []).push(r);
  // Ayın açık günü ve cirosu nereden (Satışlar'daki ay bilgisi): tek satır, Satışlar'a bağlantı
  const monthLine = kasaMonthLine(resolveMonth(month, entry ?? undefined, tillMonths(monthReports, addDays(today, -1), firstEver)[0]));
  const todays = monthReports.find((r) => r.date === today) ?? (month === today.slice(0, 7) ? null : await getCashReport(today, "admin"));
  // Günden güne: fotoğraflı raporlar, fotoğraftan farklı yazılanlar ve günlerin kasadan çıkanları
  const infos = await cashReportPhotoInfo(monthReports, "admin");
  const outsByDate: Record<string, typeof monthOuts> = {};
  for (const o of monthOuts) (outsByDate[o.date] ??= []).push(o);
  // Yöneticinin kayıtlı rapordaki kümülatif satırı: zincir ayın içinde eskiden yeniye son saklanan kümülatife bağlanır
  const okcAdmin: Record<number, OkcAdminView> = {};
  let lastCum = okcBefore.cum ?? null;
  for (const r of [...monthReports].reverse()) {
    const view = okcAdminView(r, infos.get(r.id)?.readings ?? [], lastCum);
    if (view) okcAdmin[r.id] = view;
    if (r.okcCumTotal != null && r.okcZNo) lastCum = { date: r.date, zNo: r.okcZNo, cumTotal: r.okcCumTotal, cumVat: r.okcCumVat ?? null };
  }
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
          {adminBand}
          {closedBar}
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
            proposedBy={Object.fromEntries([...monthProposed].map(([id, m]) => [id, Object.fromEntries(m)]))}
            lateApproved={Object.fromEntries(lateApproved)}
            latePending={latePending}
            okcAdmin={okcAdmin}
            okcFirst={okcFirst}
            okcLine={okcMonthLine(okcBefore.cum ? [{ date: okcBefore.cum.date, zTotal: 0, okcZNo: okcBefore.cum.zNo, okcCumTotal: okcBefore.cum.cumTotal, okcCumVat: okcBefore.cum.cumVat }, ...monthOkc] : monthOkc, month)}
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
 * Personelin geç kasa raporu (`/panel/kasa?gun=D`, dünden eski, raporu girilmemiş son 14 gün; docs/KASA-RAPORU.md ›
 * Geç rapor): kendi isteği ya da formu, açılış önerisi zincirin önceki halkasından (rapor ya da bekleyen geç rapor).
 * Kasadan çıkanlar, e-posta, WhatsApp ve karaoke yok; zayi / ikram için Zayi sayfasının istek yolu.
 */
async function StaffLateDay({ date, user }: { date: string; user: { id: number; name: string } }) {
  const today = businessDate();
  const [request, chain, counters, ai, myRequests, prevOkc] = await Promise.all([
    lateRequestFor(date, user),
    chainNeighbours(getDb(), date, { prefer: user.id }),
    cashCounters(),
    aiStatus(),
    myCashRequests(user.id),
    previousOkc(date),
  ]);
  const storage = photoStorage();
  const yesterday = addDays(today, -1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rapor günü">
        {[today, yesterday].map((d) => (
          <ButtonLink key={d} href={`/panel/kasa?gun=${d}`} variant="secondary" size="sm">
            {d === today ? "Bugün" : "Dün"} · {longDateTR(d).split(" ").slice(0, 2).join(" ")}
          </ButtonLink>
        ))}
        <ButtonLink href={`/panel/kasa?gun=${date}`} variant="primary" size="sm" aria-current="page">
          {shortDayTR(date)}
        </ButtonLink>
      </div>
      <LateReport
        date={date}
        own={request.own}
        closedCount={request.closedCount}
        others={request.others}
        carry={chain.prev ? { date: chain.prev.date, amount: chain.prev.carry } : null}
        counters={counters}
        photoUi={{ storage: storage.available, reading: ai.state, admin: false, me: user.name }}
        prevOkcZ={prevOkc.z}
      />
      <Card>
        <CardHeader icon={<Gift />} title="Günün zayi & ikramı" description="Geç rapora eklenmez" />
        <div className="space-y-2 px-5 pb-5 text-sm">
          <p className="text-ink-mute">Bu günün zayi / ikramı için Zayi &amp; ikram › Önceki gün&apos;den istek gönderin.</p>
          <ButtonLink href={`/panel/zayi?gun=${date}`} variant="secondary" size="sm">
            <Gift size={14} /> Zayi &amp; ikram
          </ButtonLink>
        </div>
      </Card>
      <MyCashRequests requests={myRequests} />
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

/**
 * Raporsuz geçmiş günün "Kafe kapalıydı" çubuğu: gün kapalı işaretliyse yalnız bilgi; personelde yalnız dün için
 * (bekleyen ya da reddedilen bildirim, düğme), yöneticide pencerede o günün izleri uyarı olarak
 */
async function closedBarFor(date: string, admin: boolean, user: { id: number }, yesterday: string) {
  if (!admin && date !== yesterday) return null;
  const marked = await isClosedDay(date);
  if (admin) {
    const evidence = marked ? null : await closedDayEvidence(getDb(), date);
    const lines = evidence ? closedEvidenceText(evidence) : { red: [], warn: [], info: [] };
    return <ClosedDayBar role="admin" date={date} marked={marked} warnings={[...lines.red, ...lines.warn]} />;
  }
  const state = await staffClosedState(date, user);
  return <ClosedDayBar role="staff" date={date} marked={marked} pending={state.pending} rejected={state.rejected} canAsk={state.canAsk} />;
}

/**
 * Yöneticinin kayıtlı rapordaki yazarkasa satırı (docs/planlar/okc-z.md §3.7): saklanan kümülatif ve yazarkasa dışı
 * tahsilat; kümülatif saklı değilse ama okunduysa nedeni (önceki saklanan kümülatifle tutmadı ya da yönetici temizledi).
 * Yalnız yönetici dalında çağrılır (personelin DTO'sunda sunucu sütunları yok)
 */
function okcAdminView(r: CashReportDTO, readings: CashReading[], prevCum: OkcPrev["cum"]): OkcAdminView | null {
  if (!okcHasFigures(r)) return null;
  let note: string | null = null;
  const read = r.okcCumTotal == null ? okcReadFigures(readings) : null;
  if (read && read.cumTotal !== null) {
    const res = okcCumulativeToStore({
      savedZNo: r.okcZNo,
      savedTotal: r.okcTotal,
      readZNo: read.zNo,
      readTotal: read.total,
      readVatTotal: read.vatTotal,
      cumTotal: read.cumTotal,
      cumVat: read.cumVat,
      outside: read.outside,
      prevCum,
    });
    if (res.rejected !== null) note = cumulativeRejectedText(res.rejected);
    // Temizlenmiş de olabilir, yazıldığı an önceki bir kümülatifle tutmamış da: hangisi olduğu kayıtlı değil
    else if (res.cumTotal !== null) note = `Kümülatif saklı değil (okunan ${money(res.cumTotal)}). Yeni bir Banka POS Z fotoğrafı okununca yeniden yazılır.`;
  }
  return { reportId: r.id, cumTotal: r.okcCumTotal ?? null, cumVat: r.okcCumVat ?? null, outside: r.okcOutside ?? null, note };
}

/**
 * Yönetici ay kartının yazarkasa satırı (plan §8, §9): ayın mali toplamı, kapsamı, ModPOS'la oranı ve KDV dökümü.
 * Yalnız bilgi; hiçbir hesaba girmez. Yazarkasa Z'si girilmemiş ayda yok
 */
function okcMonthLine(rows: Awaited<ReturnType<typeof okcRows>>, month: string): string[] | null {
  const m = okcMonth(rows, month);
  if (!m.days) return null;
  const modpos = rows.filter((r) => r.date.slice(0, 7) === month && r.okcTotal != null).reduce((a, r) => a + r.zTotal, 0);
  const share = modpos > 0 ? Math.round(((modpos - m.total) / modpos) * 100) : null;
  const vs = share === null ? "" : share === 0 ? " · ModPOS toplamıyla aynı" : ` · ModPOS toplamından %${Math.abs(share)} ${share > 0 ? "az" : "fazla"}`;
  const out = [`Yazarkasa (mali) toplamı: ${money(m.total)} · ${m.days} / ${m.reportDays} gün${vs}`];
  if (m.byRate.length) out.push(`KDV: ${m.byRate.map((g) => `%${g.rate} ${money(g.vat)}`).join(" · ")}${m.vatMissing.length ? ` · Yazarkasa KDV dökümü eksik: ${m.vatMissing.length} gün` : ""}`);
  else if (m.vatMissing.length) out.push(`Yazarkasa KDV dökümü eksik: ${m.vatMissing.length} gün`);
  return out;
}

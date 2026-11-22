import { ArrowLeft, Gift, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { KasaText } from "@/components/panel/kasa-text";
import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { kasaMonthLine, resolveMonth, tillMonths, tillOpenedOn } from "@/lib/cash-month";
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
import type { KasaName, MonthKasa } from "@/lib/lafpos/kasa";
import { genitive } from "@/lib/recipe-change";
import { cumulativeRejectedText, okcCumulativeToStore, okcHasFigures, okcMonth, type OkcPrev } from "@/lib/okc-z";
import { photoDiffs, savedFields, suspiciousDiffs, type CashReading } from "@/lib/photo-read/kasa";
import { okcReadFigures } from "@/lib/photo-read/okc";
import { addDays, dayLocativeTR, isCalendarDate, longDateTR, monthTitleTR, shiftMonth, todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { ALL_BRANCHES, branchScopeLabel, sortBranches } from "@/lib/branches";
import { closedEvidenceText } from "@/lib/closed-days";
import { modposDayView, type ModposDayView } from "@/lib/cash-modpos";
import { aiStatus } from "@/server/ai/claude";
import { requireUser, type CurrentUser } from "@/server/auth/dal";
import { currentBranchScope, currentTillBranch, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
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
  firstModposTillDay,
  firstOkcReportDate,
  getCashReport,
  lafposTillRows,
  loadCashSettings,
  loadMonthEntry,
  modposTillRows,
  nextReportAfter,
  okcRows,
  previousCarryOver,
  previousOkc,
  type CashReportDTO,
} from "@/server/data/cash-reports";
import { loadKasaLafpos, loadKasaLafposDays } from "@/server/data/lafpos-day";
import { loadKasaModpos, loadKasaModposDays, modposKeySet, NO_MODPOS } from "@/server/data/modpos-day";
import { dayWaste } from "@/server/data/waste";
import { getDb } from "@/server/db";
import { sendableRecipients } from "@/server/notify/recipients";
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
import { ModposSections } from "./modpos-sheet";

export const metadata: Metadata = { title: "Kasa raporu" };

/** Açıklama role göre (docs/planlar/ux-sade.md §8): personel ne yapacağını, yönetici neye baktığını okur */
const STAFF_DESCRIPTION = "Kapanışta Z raporunu alın, kasadaki nakdi sayın ve buraya girin.";
const ADMIN_DESCRIPTION = "Personelin akşam raporları: eksik, fazla ve gelmeyen günler.";

/** Yöneticinin "Nasıl çalışır?"u: eski uzun açıklama, günün kasasına göre */
const MORE = (
  <KasaText
    modpos="Her akşam kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayın ve buraya girin. Eksik / fazla kendiliğinden hesaplanır; gönderince yöneticiye e-posta gider, WhatsApp ile de paylaşılır."
    lafpos="Her akşam kapanışta LafPOS'ta Günü kapat'a basın: gün sonu buraya gelir, form ondan dolar. Kasadaki nakdi sayıp girin; eksik / fazla kendiliğinden hesaplanır, gönderince yöneticiye e-posta gider, WhatsApp ile de paylaşılır."
  />
);

/** Başlık iki rolün açtığı sayfada içerikten önce çizilir: rol okunana kadar personelin cümlesi (en dar olan) */
async function CashDescription() {
  const user = await requireUser();
  if (user.role !== "admin") return STAFF_DESCRIPTION;
  return (
    <>
      {ADMIN_DESCRIPTION} <InfoTip text={MORE} label="Nasıl çalışır?" />
    </>
  );
}

export default function CashPage({ searchParams }: PageProps<"/panel/kasa">) {
  return (
    <>
      <PageHeader
        title="Kasa raporu"
        path="/panel/kasa"
        description={
          <Suspense fallback={STAFF_DESCRIPTION}>
            <CashDescription />
          </Suspense>
        }
      />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <CashContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** LafPOS günü değil (geçiş günü boş ya da gün ondan önce): form ModPOS'a göre */
const NO_LAFPOS = { lafpos: false, day: null } as const;
/** Takvimde olan gün (KP-09: ?gun=2026-02-30 formu açmaz, ?gun=2026-00-10 sayfayı çökertmez; bugüne düşer) */
const isDay = (v: string | undefined): v is string => v !== undefined && isCalendarDate(v);

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

/** Sayfanın gösterdiği kasa (docs/SUBE.md › Kasa raporu) */
interface KasaView {
  /**
   * Formların kasası (kasa raporu, geç rapor, istekler, kasadan çıkan): forma konur, yazım bu şubeye iner
   * (formTillBranch). Gönderim anındaki seçime göre yazılsaydı başka sekmede seçici değişince bu sayfanın Tuzla formu
   * Marina'ya yazardı (çerez sekmeler arasında ortak)
   */
  till: string;
  /** Birden çok şube açıkken kasanın şubesi (başlıkta adı, bağlantılarda `?sube=`); tek şubede null */
  branch: { id: string; name: string } | null;
  /** Seçili kapsamın adı kasanın şubesi değilse ("Tümü", "laffogato.net"): form hangi şubeye yazdığını söyler */
  scopeLabel: string | null;
  /** Kasa raporu ayarları kartı ("Tümü"nün şube bölümlerinde yalnız ilkinde) */
  settings: boolean;
}

/**
 * Kasa raporu şube başınadır: günün raporu, devir zinciri, yazarkasa Z sırası, ModPOS föyü ve ay satırı şubenin kendi
 * kasasınındır. Sayfa bu yüzden hep TEK kasanın kapsamında okunur (`withBranchScope`):
 * - "Tümü"de yöneticinin günden güne görünümü her açık şubeyi kendi bölümünde gösterir. Tek listede aynı günün iki
 *   raporundan biri düşüyor, toplamlar tek şubeyi sayıyor ve devir şubeler arasında karşılaştırılıyordu.
 * - Form (personel, yöneticinin günü) raporun yazılacağı şubenin kasasıdır: seçili fiziksel şube, "Tümü" ya da online
 *   kanalda Tuzla (`currentTillBranch`). Form kasanın kimliğini gönderir, kaydetme oraya yazar (`formTillBranch`;
 *   başka sekmede seçici değişse de). Önceden form "Tümü"de koşulsuz okuyup Marina'nın raporunu gösterirken kayıt
 *   Tuzla'ya iniyordu.
 */
async function CashContent({ searchParams }: { searchParams: PageProps<"/panel/kasa">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  const tills = sortBranches(branches.filter((b) => b.kind === "fiziksel" && b.active));
  const many = tills.length > 1;
  if (user.role === "admin" && scope === ALL_BRANCHES && many && !isDay(pick(sp.gun))) {
    const parts = await Promise.all(
      tills.map((b, i) => withBranchScope(b.id, () => cashContentFor(user, sp, { till: b.id, branch: { id: b.id, name: b.name }, scopeLabel: null, settings: i === 0 }))),
    );
    return (
      <div className="space-y-8">
        <nav className="flex flex-wrap items-center gap-2" aria-label="Şubelerin kasaları">
          <span className="text-sm text-ink-mute">Tümü: her şubenin kasası ayrı</span>
          {tills.map((b) => (
            <ButtonLink key={b.id} href={`#kasa-${b.id}`} variant="secondary" size="sm">
              {b.name}
            </ButtonLink>
          ))}
        </nav>
        {parts.map((part, i) => (
          <section key={tills[i].id} id={`kasa-${tills[i].id}`} aria-label={`${tills[i].name} kasası`} className="scroll-mt-20">
            {part}
          </section>
        ))}
      </div>
    );
  }
  const till = await currentTillBranch();
  const own = branches.find((b) => b.id === till);
  const view: KasaView = {
    till,
    branch: many && own ? { id: own.id, name: own.name } : null,
    scopeLabel: many && scope !== till ? branchScopeLabel(scope, branches) : null,
    settings: true,
  };
  return withBranchScope(till, () => cashContentFor(user, sp, view));
}

/** Tek kasanın sayfası; çağıran `withBranchScope` içinde çağırır (bütün okumalar o şubenin) */
async function cashContentFor(user: CurrentUser, sp: Awaited<PageProps<"/panel/kasa">["searchParams"]>, view: KasaView) {
  const admin = user.role === "admin";
  const today = businessDate();
  const gun = pick(sp.gun);
  // Personel bugünü ve dünü girer; yönetici herhangi bir geçmiş günü açar. Dünden eski, raporu girilmemiş son 14 gün
  // personele geç rapor olarak açılır (yöneticinin onayıyla; docs/KASA-RAPORU.md › Geç rapor)
  // İşlev olarak çağrılır (bileşen olarak değil): okumaları bu kasanın kapsamında kalsın
  if (!admin && isDay(gun) && staffLateDay(gun) && (await staffLateDayOpen(gun))) return StaffLateDay({ date: gun, user, view });
  let date = isDay(gun) && gun <= today ? gun : today;
  if (!admin && !staffCanReport(date)) date = today;
  const showForm = !admin || isDay(gun);

  const settings = await loadCashSettings();
  // E-postanın gittiği adres sayısı: personel hesabına ait adres gönderimde düşer (report-email.ts)
  const mailTo = settings.emailEnabled && showForm ? (await cashEmailRecipients(getDb(), settings.recipients)).length : 0;
  const storage = photoStorage();
  const [report, carry, recent, waste, ai, outs, categories, next, counters, prevOkc, lafposState] = await Promise.all([
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
    // Günün kasası ve LafPOS'un bu günün sonu ("LafPOS'tan doldur", docs/LAFPOS.md): yalnız geçiş gününden sonraki
    // günlerde; okunamazsa form ModPOS'a göre açılır, bant görünmez
    showForm ? loadKasaLafpos(date).catch(() => NO_LAFPOS) : Promise.resolve(NO_LAFPOS),
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
          // Birden çok kasa açıkken başlıkta kasanın şubesi (e-postadaki gibi)
          branchName: view.branch?.name ?? null,
          ...extrasFrom(photoInfo, outs, report, lafposState),
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
          <p className="text-ink-mute">
            {waste.lafpos
              ? "Bu gün zayi ya da ikram yok. Atılan bir şey ya da hammadde ikramı olduysa kasa raporundan önce girin; ürün ikramı LafPOS'ta işaretlenir."
              : "Bu gün zayi ya da ikram girilmedi. Ödenmeden verilen ya da atılan bir şey olduysa kasa raporundan önce girin."}
          </p>
        )}
        {waste.lafpos ? (
          // LafPOS gününde (geçiş gününden itibaren) ürün ikramı LafPOS'tan; panele girilen ürün ikramı sayılmaz
          <p className="text-[13px] text-ink-mute">
            {waste.lafpos.received
              ? "Ürün ikramı ve LafPOS'ta zayi yazılanlar LafPOS'un gün sonundan."
              : "Ürün ikramı LafPOS'ta işaretlenir, gün sonuyla gelir."}
            {waste.lafpos.received && waste.lafpos.notCounted ? ` Panele girilen ${waste.lafpos.notCounted} ürün ikramı sayılmıyor: LafPOS'taki sayılıyor.` : ""}
          </p>
        ) : null}
        <ButtonLink href={`/panel/zayi?gun=${date}`} variant="secondary" size="sm">
          <Gift size={14} /> Zayi / ikram ekle
        </ButtonLink>
      </div>
    </Card>
  ) : null;
  // laffogato.net'in o günkü online satışı: bilgi satırı, sayfayı bekletmez (site gelene kadar boş, gelmezse yok)
  const siteRow = showForm ? (
    <Suspense fallback={null}>
      <SiteDayRow date={date} till={view.till} admin={admin} kasa={lafposState.lafpos ? "LafPOS" : "ModPOS"} />
    </Suspense>
  ) : null;
  const form = showForm ? (
    <CashForm
      // Kasa da anahtarda: seçici değişince yarım kalan form öbür kasanın formu olarak kalmasın
      key={`${view.till}:${date}:${report?.revision ?? 0}`}
      date={date}
      branchId={view.till}
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
      // Kartla bahşiş ve cari tahsilatı personelde de düşer: form, kayıtlı görünüm ve WhatsApp aynı kuralla (G11)
      lafpos={lafposState.day}
      lafposMode={lafposState.lafpos}
      // Kümülatif ve yazarkasa dışı tahsilat yalnız yöneticiye: personelin yükünde anahtarı da yok
      {...(admin && report ? { okcAdmin: okcAdminView(report, photoInfo?.readings ?? [], prevOkc.cum ?? null) } : {})}
    />
  ) : null;
  // Yönetici: bu gün için personelin bekleyen istekleri (Onaylar'daki karta götürür; yöneticinin düzeltmesi isteği kapatmaz)
  const adminBand = adminRequests.length ? (
    <Notice
      tone="warn"
      title={`Bu gün için ${adminRequests.length} personel isteği bekliyor`}
      text={adminRequests.map((r) => (
        <span key={r.id} className="flex flex-wrap items-center gap-x-2">
          <span className="min-w-0">
            {r.kind === "kasa-silme"
              ? `${r.requestedByName} raporun silinmesini istedi`
              : r.kind === "kasa-gec"
                ? `${r.requestedByName} bu günün raporunu ${dayLocativeTR(todayTR(new Date(r.createdAt)))} onaya gönderdi. Burada girerseniz onun isteği kapanır.`
                : `${genitive(r.requestedByName)} düzeltme önerisi bekliyor`}
          </span>
          <NoticeLink href={`/panel/onaylar#istek-${r.id}`}>Onaylar&apos;da bakın</NoticeLink>
        </span>
      ))}
    />
  ) : null;
  // Gün içinde kasadan çıkanlar: gün boyunca kullanılan kart (akşam formu boşken de)
  const outsCard = showForm ? (
    <CashOutsCard
      date={date}
      branchId={view.till}
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
  const closedBar = showForm && !report && date < today ? await closedBarFor(date, admin, user, yesterday, view) : null;
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
      <TillBadge view={view} />
    </div>
  );

  if (!admin) {
    return (
      <div className="space-y-4">
        <ScopeNote view={view} />
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
  const [monthReports, monthOuts, before, after, firstEver, entry, monthOkc, okcFirst, okcBefore, lafposOf, monthLafpos] = await Promise.all([
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
    // Ayın LafPOS günleri (yalnız geçiş gününden sonra): "LafPOS'tan farklı" rozeti ve ayrıntısı (E-09)
    loadKasaLafposDays(`${month}-01`, monthEnd).catch(() => () => NO_LAFPOS),
    // Raporsuz LafPOS günlerinin yedek ay satırları (G6; yalnız geçiş gününden sonra): Gelir-gider'deki ay rakamıyla aynı
    lafposTillRows(getDb(), `${month}-01`, monthEnd),
  ]);
  // Rapor alıcılarından personel ya da pasif hesabın olanlar (E-53): gönderimde düşer, kartta söylenir
  const { dropped: blockedRecipients } = await sendableRecipients(getDb(), settings.recipients);
  const days = monthDays(month, today, monthReports);
  const revised = monthReports.filter((r) => r.revision > 1).map((r) => r.id);
  const [monthRevisions, monthProposed, lateApproved, latePending, modposDay, modposOf] = await Promise.all([
    cashRevisionsFor(revised),
    proposedByForReports(revised),
    // Geç raporlar: onaylananlar (rapora göre) ve onay bekleyenler (güne göre)
    lateRequestsByReport(monthReports.map((r) => r.id)),
    pendingLateByDay(`${month}-01`, monthEnd),
    // ModPOS kasa föyü (docs/MODPOS-API.md › Nerede görünür), yalnız yöneticiye: saklanan föy okunur, ModPOS'a istek
    // gitmez; okunamazsa kart, rozet ve satır görünmez, sayfa bozulmaz. Personel dalı bunları hiç okumaz
    // Föy ekrandaki raporun şubesinin (şube, gün); rapor yoksa seçili şubenin ("Tümü"de Tuzla): başka şubenin föyü bu
    // raporla karşılaştırılmaz (docs/MODPOS-API.md › Şubeler)
    showForm ? loadKasaModpos(date, undefined, report?.branchId).catch(() => null) : Promise.resolve(null),
    loadKasaModposDays(`${month}-01`, monthEnd).catch(() => () => NO_MODPOS),
  ]);
  const checks = carryChecks(monthReports, before);
  const lastReport = monthReports[0];
  const afterCheck = after && lastReport ? carryCheck(after.date, after.openingCash, { date: lastReport.date, amount: computeCash(lastReport).carryOver }) : null;
  const carryByDate: Record<string, CarryCheck> = Object.fromEntries([...checks, ...(afterCheck ? [[after!.date, afterCheck] as const] : [])]);
  const revisionsById: Record<number, CashRevisionRow[]> = {};
  for (const r of monthRevisions) (revisionsById[r.reportId] ??= []).push(r);
  // Ayın açık günü ve cirosu nereden (Satışlar'daki ay bilgisi): tek satır, Satışlar'a bağlantı. Ay rakamına yedek açıksa
  // raporsuz günün kapanmış ModPOS föyü de (docs/MODPOS-API.md › Ay rakamına yedek; kapalıyken föy okunmaz): Gelir-gider'deki
  // ay rakamıyla aynı. Ay ortasında başlayan ilk ay ilk satırla (rapor ya da föy), eksik gün ilk kasa raporundan.
  // Sonradan açılan şubenin açılış ayı yarım sayılmaz (tillOpenedOn; Gelir-gider'deki şube görünümüyle aynı)
  const [monthModpos, firstModpos, tillScope, branchList] = await Promise.all([
    modposTillRows(getDb(), `${month}-01`, monthEnd),
    firstModposTillDay(getDb()),
    currentBranchScope(),
    listBranches(),
  ]);
  const firstRow = firstModpos !== null && (firstEver === null || firstModpos < firstEver) ? firstModpos : firstEver;
  const opened = tillOpenedOn(branchList.find((b) => b.id === tillScope));
  const monthLine = kasaMonthLine(
    resolveMonth(
      month,
      entry ?? undefined,
      tillMonths([...monthReports, ...monthLafpos, ...monthModpos], addDays(today, -1), firstRow, undefined, undefined, firstEver ?? undefined, firstModpos, opened)[0],
    ),
  );
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
          extras: extrasFrom(info, outsByDate[r.date] ?? [], r, lafposOf(r.date)),
        },
      ];
    }),
  );
  // Gün görünümünün ladmin bölümü (ModPOS bölümünün yanında, panelde yazılan raporun ayrıntısı): günün kasadan
  // çıkanları, fotoğraf sayısı, sürümler, devir zinciri (önceki raporun devri, sonraki raporun açılışı) ve panelde
  // girilen zayi / ikram (ModPOS'un ödenmez / ikram dökümünün karşılığı)
  const ladmin = { outs: dayOuts, photos: photoInfo?.photos.length ?? 0, revisions, prev: carry, next, waste: waste ? { ikram: waste.ikram, zayi: waste.zayi } : null };
  // Günden güne listesinin ModPOS günleri (tarihe göre; extras'a girmez: o WhatsApp'a ve personele de gider)
  const modposDays: Record<string, ModposDayView> = {};
  for (const d of days) {
    const m = modposOf(d.date, d.report?.branchId);
    if (m.z) modposDays[d.date] = modposDayView(d.report, m.z);
  }
  return (
    <div className="space-y-4">
      {showForm ? (
        <>
          <ScopeNote view={view} />
          {dayChips}
          {adminBand}
          {closedBar}
          {outsCard}
          {form}
          {modposDay?.modpos ? <ModposSections date={date} today={today} sheet={modposDay.sheet} z={modposDay.z} report={report} ladmin={ladmin} keySet={modposKeySet(process.env, modposDay.sheet?.branchId ?? report?.branchId)} now={new Date()} /> : null}
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
            modposDays={modposDays}
            okcFirst={okcFirst}
            branch={view.branch}
            okcLine={okcMonthLine(
              okcBefore.cum ? [{ date: okcBefore.cum.date, zTotal: 0, okcZNo: okcBefore.cum.zNo, okcCumTotal: okcBefore.cum.cumTotal, okcCumVat: okcBefore.cum.cumVat }, ...monthOkc] : monthOkc,
              month,
              // Ayın kasası (E-39): ayın 1'i LafPOS günüyse LafPOS, yalnız sonu LafPOS ise geçiş ayı ("Kasa")
              lafposOf(`${month}-01`).lafpos ? "LafPOS" : lafposOf(monthEnd).lafpos ? "Kasa" : "ModPOS",
            )}
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
              <CardHeader icon={<ReceiptText />} title={view.branch ? `Bugünün raporu · ${view.branch.name}` : "Bugünün raporu"} description={longDateTR(today)} />
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
                <ButtonLink href={`/panel/kasa?gun=${today}${view.branch ? `&sube=${encodeURIComponent(view.branch.id)}` : ""}`} variant={todays ? "secondary" : "primary"} className="w-full">
                  {todays ? "Raporu aç" : "Raporu gir"}
                </ButtonLink>
              </div>
            </Card>
          ) : null}
          {view.settings ? <CashSettingsCard settings={settings} emailConfigured={isEmailConfigured()} blocked={blockedRecipients} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Personelin geç kasa raporu (`/panel/kasa?gun=D`, dünden eski, raporu girilmemiş son 14 gün; docs/KASA-RAPORU.md ›
 * Geç rapor): kendi isteği ya da formu, açılış önerisi zincirin önceki halkasından (rapor ya da bekleyen geç rapor).
 * LafPOS gününde form LafPOS'un gün sonuyla açılır (yalnız geçiş gününden sonra; G8).
 * Kasadan çıkanlar, e-posta, WhatsApp ve karaoke yok; zayi / ikram için Zayi sayfasının istek yolu.
 */
async function StaffLateDay({ date, user, view }: { date: string; user: { id: number; name: string }; view: KasaView }) {
  const today = businessDate();
  const [request, chain, counters, ai, myRequests, prevOkc, lafposState] = await Promise.all([
    lateRequestFor(date, user),
    chainNeighbours(getDb(), date, { prefer: user.id, branchId: view.till }),
    cashCounters(),
    aiStatus(),
    myCashRequests(user.id),
    previousOkc(date),
    // LafPOS gününde Z LafPOS'un gün sonundan dolar, fotoğraf gerekmez; gelmediyse yazarkasa Z'si (G8)
    loadKasaLafpos(date).catch(() => NO_LAFPOS),
  ]);
  const storage = photoStorage();
  const yesterday = addDays(today, -1);
  return (
    <div className="space-y-4">
      <ScopeNote view={view} />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rapor günü">
        {[today, yesterday].map((d) => (
          <ButtonLink key={d} href={`/panel/kasa?gun=${d}`} variant="secondary" size="sm">
            {d === today ? "Bugün" : "Dün"} · {longDateTR(d).split(" ").slice(0, 2).join(" ")}
          </ButtonLink>
        ))}
        <ButtonLink href={`/panel/kasa?gun=${date}`} variant="primary" size="sm" aria-current="page">
          {shortDayTR(date)}
        </ButtonLink>
        <TillBadge view={view} />
      </div>
      <LateReport
        date={date}
        branchId={view.till}
        own={request.own}
        closedCount={request.closedCount}
        others={request.others}
        carry={chain.prev ? { date: chain.prev.date, amount: chain.prev.carry } : null}
        counters={counters}
        photoUi={{ storage: storage.available, reading: ai.state, admin: false, me: user.name }}
        prevOkcZ={prevOkc.z}
        lafpos={lafposState.day}
        lafposMode={lafposState.lafpos}
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

/** Birden çok şube açıkken formun kasası: hangi şubenin raporu */
function TillBadge({ view }: { view: KasaView }) {
  return view.branch ? (
    <Badge tone="blue" dot>
      {view.branch.name} kasası
    </Badge>
  ) : null;
}

/**
 * Seçili kapsam bir şubenin kasası değilken ("Tümü", online kanal): form raporun yazılacağı şubenin kasasıdır ve bunu
 * söyler (docs/SUBE.md › Yazarken hangi şube)
 */
function ScopeNote({ view }: { view: KasaView }) {
  if (!view.branch || !view.scopeLabel) return null;
  return (
    <Notice tone="neutral" title={`${view.scopeLabel} seçili: bu sayfa ${genitive(view.branch.name)} kasası`}>
      Kasa raporu şube başına girilir; buraya girilen rapor ve kasadan çıkanlar {genitive(view.branch.name)} kasasına yazılır. Başka bir şubenin kasası için soldan o şubeyi seçin.
    </Notice>
  );
}

/**
 * laffogato.net'in o günkü online satışı (docs/SITE-SATIS.md): uygulama ve web siparişleri ve karaoke ön ödemesi,
 * kasadan geçmez. Bilgi satırıdır: kasa farkına, Z raporuna ve hiçbir kasa rakamına girmez. Sayfa açılınca sorulur;
 * bağlantı kapalıysa, site ulaşılamazsa ya da 8 saniyede yanıt vermezse satır görünmez (rapor beklemez). Personele
 * karaoke tutarı gösterilmez (README: karaoke tutarları yalnız yöneticiye).
 */
async function SiteDayRow({ date, till, admin, kasa }: { date: string; till: string; admin: boolean; kasa: KasaName }) {
  // Kasanın şubesinin online satışı (Marina'nın masa siparişi Tuzla'nın satırına yazılmaz; docs/SITE-SATIS.md)
  const row = await fetchTillOnlineRow(date, till);
  if (!row) return null;
  return (
    <Notice
      tone="neutral"
      title={`laffogato.net · ${longDateTR(date)}: online ${money(row.online)}${admin ? ` · karaoke ön ödeme ${money(row.karaoke)}` : ""}, kasadan geçmez`}
    >
      Kasa farkına ve Z raporuna girmez; {kasa}&apos;un &quot;Online&quot; ödemesi (Yemeksepeti, Getir…) ayrı. Sitenin günü gece yarısında biter.
    </Notice>
  );
}

/**
 * Raporsuz geçmiş günün "Kafe kapalıydı" çubuğu: gün kapalı işaretliyse yalnız bilgi; personelde yalnız dün için
 * (bekleyen ya da reddedilen bildirim, düğme), yöneticide pencerede o günün izleri uyarı olarak
 */
async function closedBarFor(date: string, admin: boolean, user: { id: number }, yesterday: string, view: KasaView) {
  if (!admin && date !== yesterday) return null;
  // Kapalı gün kasanın şubesinin (docs/SUBE.md › Kapalı gün): işaret, kanıt ve bildirim o şubenin; düğme kasayı gönderir
  const till = { id: view.till, name: view.branch?.name ?? null };
  const marked = await isClosedDay(date, getDb(), view.till);
  if (admin) {
    const evidence = marked ? null : await closedDayEvidence(getDb(), date, view.till);
    const lines = evidence ? closedEvidenceText(evidence) : { red: [], warn: [], info: [] };
    return <ClosedDayBar role="admin" date={date} till={till} marked={marked} warnings={[...lines.red, ...lines.warn]} />;
  }
  const state = await staffClosedState(date, user);
  return <ClosedDayBar role="staff" date={date} till={till} marked={marked} pending={state.pending} rejected={state.rejected} canAsk={state.canAsk} />;
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
 * Yalnız bilgi; hiçbir hesaba girmez. Yazarkasa Z'si girilmemiş ayda yok. `kasa` ayın kasası (geçiş gününden
 * itibaren LafPOS, geçiş ayında "Kasa"; denetim E-39)
 */
function okcMonthLine(rows: Awaited<ReturnType<typeof okcRows>>, month: string, kasa: MonthKasa["short"]): string[] | null {
  const m = okcMonth(rows, month);
  if (!m.days) return null;
  const modpos = rows.filter((r) => r.date.slice(0, 7) === month && r.okcTotal != null).reduce((a, r) => a + r.zTotal, 0);
  const share = modpos > 0 ? Math.round(((modpos - m.total) / modpos) * 100) : null;
  const vs = share === null ? "" : share === 0 ? ` · ${kasa} toplamıyla aynı` : ` · ${kasa} toplamından %${Math.abs(share)} ${share > 0 ? "az" : "fazla"}`;
  const out = [`Yazarkasa (mali) toplamı: ${money(m.total)} · ${m.days} / ${m.reportDays} gün${vs}`];
  if (m.byRate.length) out.push(`KDV: ${m.byRate.map((g) => `%${g.rate} ${money(g.vat)}`).join(" · ")}${m.vatMissing.length ? ` · Yazarkasa KDV dökümü eksik: ${m.vatMissing.length} gün` : ""}`);
  else if (m.vatMissing.length) out.push(`Yazarkasa KDV dökümü eksik: ${m.vatMissing.length} gün`);
  return out;
}

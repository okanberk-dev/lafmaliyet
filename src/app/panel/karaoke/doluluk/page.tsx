import { ArrowLeft, CircleAlert, Info, Lightbulb, MicVocal, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, InfoTip, PageSkeleton, Stat } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { dateTimeTR } from "@/lib/format";
import { historyProgress } from "@/lib/karaoke/history";
import {
  businessDay,
  computeOccupancy,
  dayStart,
  KARAOKE_ROOMS,
  monthPeriod,
  monthRows,
  occupancyDelta,
  previousPeriod,
  recentMonths,
  resolvePeriod,
} from "@/lib/karaoke/occupancy";
import {
  bucket,
  cellDetail,
  cellLabel,
  cellNumber,
  hourLabel,
  hourRangesText,
  hoursText,
  insightLines,
  kpiTexts,
  longDayText,
  minutesText,
  monthsRange,
  periodLine,
} from "@/lib/karaoke/occupancy-text";
import { todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { readHistoryState } from "@/server/karaoke/history";
import { karaokeCoverage, loadOccupancySessions, readKaraokeHours } from "@/server/karaoke/occupancy";
import { karaokeSecret } from "@/server/karaoke/sync";

import { Heatmap, type HeatmapView } from "./heatmap";
import { HistoryButton } from "./history-button";
import { HoursButton } from "./hours-dialog";
import { MonthCompare, PointsPill } from "./month-compare";

export const metadata: Metadata = { title: "Karaoke doluluğu" };
// Geçmişi siteden alma bu sayfanın sunucu eylemiyle çalışır (en çok 45 sn, ay ay okur): eylemler sayfanın süresini kullanır
export const maxDuration = 60;

const TITLE = "Karaoke doluluğu";
const DESCRIPTION =
  "Oda hangi gün ve saatte dolu, hangisinde boş; saat başına gelir, uzatma, son dakika iptali ve rezervasyonların kaç gün önceden yapıldığı. Yalnız yönetici görür.";

function Header({ tabs }: { tabs?: ReactNode }) {
  return (
    <PageHeader
      eyebrow="Günlük"
      title={TITLE}
      description={DESCRIPTION}
      actions={
        <ButtonLink href="/panel/karaoke" variant="ghost" size="sm">
          <ArrowLeft size={16} aria-hidden="true" /> Karaoke
        </ButtonLink>
      }
      tabs={tabs}
    />
  );
}

export default function OccupancyPage({ searchParams }: PageProps<"/panel/karaoke/doluluk">) {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <OccupancyContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const INFO = {
  occupancy:
    "Odanın dolu olduğu süre ÷ oda saatlerindeki toplam süre. Rezervasyonlar (uzatma dahil) ve rezervasyonsuz sayaçlar sayılır; erken bitirilen oturum bittiği anda boşalır; iptal, süresi dolan ödeme ve iade sayılmaz. Bugün sayılmaz.",
  revenue:
    "Dolu bir oda-saatin getirdiği para (KDV dahil). Sitede ödenen ya da kasada ödenecek rezervasyon ücretleri, o rezervasyonların kullanılan saatlerine bölünür (uzatma hariç). Uzatmaların, rezervasyonsuz oturumların ve odadaki siparişlerin parası kasada alınır, oturuma bağlı değildir: burada sayılmaz. Altındaki açık saat başına rakamı fiyatla doluluğu birlikte gösterir.",
  extension: "+15 / +30 dk ile süresi uzatılan oturumlar (rezervasyonlu ve rezervasyonsuz).",
  cancel:
    "Başlangıçtan önceki 24 saat içinde (ya da sonra) iptal edilen rezervasyonlar ÷ bütün rezervasyonlar. Ödeme sayfasında bırakılıp süresi dolanlar rezervasyon sayılmaz. İptal anı, panelin iptali gördüğü andır; geçmişten alınan iptallerin çoğunun zamanı bilinmez ve son dakika sayılmaz.",
  lead: "Sitede rezervasyonun yapıldığı gün ile oturumun günü arasındaki fark (gece 05:00'e kadarki oturum önceki güne sayılır). Rezervasyonsuz oturumlar girmez.",
};

/** Karaoke'nin alt ekranı (docs/KARAOKE.md › Doluluk haritası); yalnız yönetici, proxy personeli buraya sokmaz */
async function OccupancyContent({ searchParams }: { searchParams: PageProps<"/panel/karaoke/doluluk">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  // Çerez okunduktan sonra (istek anı): önbelleğe alınan kabukta saat okunmaz
  const now = new Date().getTime();
  const [{ hours, saved }, coverage, history] = await Promise.all([readKaraokeHours(), karaokeCoverage(), readHistoryState()]);
  const configured = Boolean(karaokeSecret());
  const progress = historyProgress(history, todayTR(new Date(now)));
  const historyLabel = progress.complete && progress.done ? "Yeniden al" : progress.done ? "Devam et" : "Geçmişi siteden al";

  if (!coverage.total) {
    return (
      <>
        <Header />
        <Card>
          <EmptyState
            icon={<MicVocal />}
            title="Henüz karaoke verisi yok"
            description={
              !configured
                ? "laffogato.net bağlantısı kurulunca rezervasyonlar gelir; rezervasyonsuz gruplar bar ekranındaki hızlı sayaçla sayılır."
                : progress.done
                  ? "Sitede geçmiş karaoke rezervasyonu bulunamadı; yeni rezervasyonlar ve bar ekranındaki hızlı sayaç geldikçe harita dolar."
                  : "Sitedeki geçmiş rezervasyonları alarak başlayın."
            }
            action={
              configured ? (
                <HistoryButton label={historyLabel} variant="primary" />
              ) : (
                <ButtonLink href="/panel/karaoke" variant="primary">
                  Bar ekranı
                </ButtonLink>
              )
            }
          />
          {configured && history.lastError ? <p className="px-5 pb-5 text-center text-[13px] text-bad">Son deneme: {history.lastError}</p> : null}
        </Card>
      </>
    );
  }

  const today = businessDay(now);
  const period = resolvePeriod(pick(sp.donem), pick(sp.ay), now);
  const prev = previousPeriod(period);
  const months = recentMonths(today, coverage.firstMonth, 6);
  const pickerMonths = recentMonths(today, coverage.firstMonth, 24).reverse();
  const oldest = [period.from, prev.from, monthPeriod(months[months.length - 1], today).from].sort()[0];
  const sessions = await loadOccupancySessions(new Date(dayStart(oldest)), new Date(dayStart(today)));

  const opts = { hours, rooms: KARAOKE_ROOMS };
  const { grid, summary } = computeOccupancy(sessions, period, opts);
  const before = computeOccupancy(sessions, prev, opts).summary;
  const rows = monthRows(sessions, months, today, { ...opts, firstTimerDay: coverage.firstTimerDay });
  const insights = insightLines(grid, summary, period);
  const kpi = kpiTexts(summary);
  // Verinin başladığı yer: site için geçmiş alındıysa alınan ilk ayın başı (yoksa eşitlemenin ilk günü), sayaç için ilk sayaç
  const imported = progress.done && progress.first ? `${progress.first}-01` : null;
  const siteSince = [imported, coverage.firstSiteDay].filter((d): d is string => d !== null).sort()[0] ?? null;
  const since = { siteSince, timerSince: coverage.firstTimerDay };
  const delta = occupancyDelta({ period, summary }, { period: prev, summary: before }, since);

  const heat: HeatmapView = {
    hours: grid.hours.map((h) => ({ hour: h, label: hourLabel(h), short: hourLabel(h).slice(0, 2) })),
    rows: grid.rows.map((row) =>
      row.map((c) => ({ bucket: bucket(c.ratio), number: cellNumber(c), label: cellLabel(c), detail: cellDetail(c), open: c.open, outside: !c.open && c.outsideMin > 0 })),
    ),
    outsideNote: summary.outsideMin > 0 ? `Oda saatleri dışında ${minutesText(summary.outsideMin)} dolu oturum var (${hourRangesText(summary.outsideHours)}).` : null,
    overlapNote:
      summary.overlapMin > 0
        ? `Aynı anda iki oturum: toplam ${minutesText(summary.overlapMin)}. Oda tek olduğu için bir kez sayıldı (çoğunlukla rezervasyonlu grup için ayrıca sayaç açılmıştır).`
        : null,
  };

  const current = today.slice(0, 7);
  const periodControls = (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedLinks
        label="Dönem"
        value={period.kind}
        options={[
          { value: "4h", label: "Son 4 hafta", href: "/panel/karaoke/doluluk" },
          { value: "12h", label: "Son 12 hafta", href: "/panel/karaoke/doluluk?donem=12h" },
          { value: "ay", label: "Ay", href: `/panel/karaoke/doluluk?donem=ay&ay=${period.month ?? current}` },
        ]}
      />
      {period.kind === "ay" && period.month ? <MonthPicker months={pickerMonths} value={period.month} /> : null}
    </div>
  );

  const siteText = progress.done && progress.first ? `${monthsRange([progress.first])} ve sonrası` : coverage.firstSiteDay ? `${longDayText(coverage.firstSiteDay)} ve sonrası` : "Henüz yok";
  const firstDay = [coverage.firstSiteDay, coverage.firstTimerDay].filter((d): d is string => d !== null).sort()[0];

  return (
    <>
      <Header tabs={periodControls} />
      <p className="-mt-3 mb-4 text-[13px] leading-5 text-ink-mute">{periodLine(period, hours)}</p>

      <div className="space-y-4">
        {configured && !progress.complete ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-info-soft px-4 py-3 text-[13px] leading-5 text-info">
            {/* Telefonda düğme metnin altına iner (metin sıkışmasın) */}
            <span className="flex min-w-0 flex-[1_1_16rem] items-start gap-2">
              <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {progress.done
                ? `Geçmiş rezervasyonların ${progress.done} / ${progress.total} ayı alındı.`
                : `Geçmiş rezervasyonlar henüz siteden alınmadı; harita yalnız ${firstDay ? longDayText(firstDay) : "bugün"} ve sonrasını gösteriyor.`}
            </span>
            <HistoryButton label={historyLabel} />
          </div>
        ) : null}
        {!saved ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-panel px-4 py-2.5 text-[13px] leading-5 text-ink-mute">
            <span className="min-w-0 flex-[1_1_16rem]">Oda saatleri varsayılan: her gün {hoursText(hours)}. Doğru değilse değiştirin; doluluk bu saatlere göre hesaplanır.</span>
            <HoursButton hours={hours} variant="ghost" />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Stat
            compact
            label="Doluluk"
            value={kpi.occupancy.value}
            sub={kpi.occupancy.sub}
            info={INFO.occupancy}
            badge={delta !== null ? <PointsPill delta={delta} /> : undefined}
          />
          <Stat compact label="Saat başına gelir" value={kpi.revenue.value} sub={kpi.revenue.sub} info={INFO.revenue} />
          <Stat compact label="Uzatma" value={kpi.extension.value} sub={kpi.extension.sub} info={INFO.extension} />
          <Stat
            compact
            label="Son dakika iptal"
            value={kpi.cancel.value}
            sub={kpi.cancel.sub}
            info={INFO.cancel}
            tone={summary.cancellations.lateRate !== null && summary.cancellations.lateRate >= 0.15 ? "warn" : "default"}
          />
          <Stat compact className="col-span-2 lg:col-span-1" label="Kaç gün önceden" value={kpi.lead.value} sub={kpi.lead.sub} info={INFO.lead} />
        </div>

        <Card>
          <CardHeader icon={<Lightbulb />} title="Öne çıkanlar" />
          <div className="px-5 pb-5 text-sm leading-6">
            {insights.lines.length ? (
              <ul className="space-y-1.5">
                {insights.lines.map((l) => (
                  <li key={l} className="flex items-start gap-2 text-ink">
                    <span aria-hidden="true" className="mt-[9px] size-1.5 shrink-0 rounded-full bg-ink" />
                    {l}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-mute">{insights.reason}</p>
            )}
          </div>
        </Card>

        {/* Dönem ya da oda saatleri değişince seçili hücre sıfırlanır (aynı sıradaki hücre başka bir saat olabilir) */}
        <Heatmap key={`${period.from}|${period.to}|${hours.open}|${hours.close}`} view={heat} hours={hours} />

        <MonthCompare rows={rows} coverage={since} />

        <Card>
          <CardHeader icon={<Settings2 />} title="Veri ve ayarlar" />
          <dl className="mx-5 mb-5 divide-y divide-line rounded-2xl bg-surface px-4 text-sm ring-1 ring-line">
            <DataRow label="Oda saatleri">
              <span className="inline-flex flex-wrap items-center gap-2">
                Her gün {hoursText(hours)}
                {!saved ? <Badge tone="gray">Varsayılan</Badge> : null}
              </span>
              <HoursButton hours={hours} />
            </DataRow>
            <DataRow label="Site rezervasyonları">
              <span className="min-w-0">
                {siteText}
                {history.lastRunAt && progress.done ? <span className="text-ink-mute"> · son alma {dateTimeTR(history.lastRunAt)}</span> : null}
              </span>
              {configured ? <HistoryButton label={historyLabel} /> : null}
              <span className="basis-full text-[13px] text-ink-mute">
                {configured ? "Geçmişten alınan rezervasyonlar ad ve not olmadan saklanır." : "laffogato.net bağlantısı kurulmadı; geçmiş alınamaz."}
              </span>
              {configured && history.lastError ? (
                <span className="flex basis-full items-start gap-1.5 text-[13px] text-bad">
                  <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  Son deneme: {history.lastError}
                </span>
              ) : null}
            </DataRow>
            <DataRow label="Rezervasyonsuz oturumlar">
              {coverage.firstTimerDay ? `${longDayText(coverage.firstTimerDay)} ve sonrası (bar ekranındaki hızlı sayaç)` : "Henüz yok (bar ekranındaki hızlı sayaçla sayılır)"}
            </DataRow>
            <DataRow label="Kasadaki karaoke ve odadaki siparişler">
              <span className="inline-flex items-center gap-1.5">
                Saat başına gelire girmez
                <InfoTip text="Uzatmaların, rezervasyonsuz oturumların ve odadaki siparişlerin parası kasada (ModPOS) alınır; hangi oturuma ait olduğu ayrılmıyor. Uygulama siparişleri bar ekranına “Masa” olarak gelir ve panel sipariş geçmişi tutmaz." />
              </span>
            </DataRow>
            <DataRow label="Gelmeyenler">Personel “Erken bitir”e basarsa oda o andan boş sayılır; basılmazsa rezervasyonun süresi dolu sayılır.</DataRow>
          </dl>
        </Card>
      </div>
    </>
  );
}

/** Veri ve ayarlar kartının satırı: telefonda etiket üstte, değer altta */
function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-ink-mute">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-ink">{children}</dd>
    </div>
  );
}

import { and, desc, eq, ne } from "drizzle-orm";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ChartScatter,
  Coins,
  Download,
  Flame,
  Percent,
  Receipt,
  Scale,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { TrendChart } from "@/components/charts";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { Gauge } from "@/components/ui/gauge";
import { EmptyState, GrowthPill, InfoTip, KeyValue, PageSkeleton, Progress, SegmentStrip, Signed, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { shiftMonth, type ProductStatus } from "@/lib/calc/engine";
import {
  alerts,
  dailyChange,
  dashboard,
  forecastMonthOf,
  unpaidSummary,
  yearTrend,
  type DashboardData,
} from "@/lib/calc/insights";
import { priceAlert } from "@/lib/calc/price-impact";
import { monthLabel, monthShort, num, pct, tl } from "@/lib/format";
import { holdAlert } from "@/lib/price-hold";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { loadCashPlan } from "@/server/data/cash-plan";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { pendingHoldSummary } from "@/server/data/price-holds";
import { getDb, schema as s } from "@/server/db";
import { loadUpcoming } from "@/server/notify/digest";
import { isParasutConfigured } from "@/server/parasut/config";

import { DashboardAlerts } from "./dashboard-alerts";
import { DashboardCashPlan } from "./dashboard-cash-plan";
import {
  actualProfitBreakdown,
  breakEvenBreakdown,
  dailyAvgBreakdown,
  forecastBreakdown,
  grossProfitBreakdown,
  netProfitBreakdown,
  netSalesBreakdown,
  posRevenueBreakdown,
  withComparison,
  type CardBreakdown,
} from "./dashboard-breakdowns";
import { CategoriesPanel } from "./dashboard-categories";
import { DashboardChecklist } from "./dashboard-checklist";
import { differs, FixedReconcile, fixedBreakdownText } from "./dashboard-fixed";
import { Meter, MoneyFlow, type FlowRow } from "./dashboard-flow";
import { CountUp } from "./dashboard-number";
import { DashboardPayments } from "./dashboard-payments";
import { DashboardTabs, type DashboardTab } from "./dashboard-tabs";
import { monthTaskFacts, monthTasks, paymentFacts, type ParasutFacts } from "./dashboard-tasks";
import { SystemBanner } from "./system-banner";
import { menuAverages, productHref } from "./urunler/logic";

export const metadata: Metadata = { title: "Genel bakış" };

export default function DashboardPage({ searchParams }: PageProps<"/panel">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Genel" title="Genel bakış" excel="Panel" description="Yükleniyor…" />
          <PageSkeleton />
        </>
      }
    >
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

type Theoretical = NonNullable<DashboardData["theoretical"]>;
type Forecast = NonNullable<DashboardData["forecast"]>;
type YearMonth = ReturnType<typeof yearTrend>[number];

/** Başabaşa göre ilerleme: ≥ %100 yeşil, %85 üstü turuncu, altı kırmızı */
const progressTone = (p: number) => (p >= 1 ? "green" : p > 0.85 ? "amber" : "red");

/** Önceki aya göre değişim oranı; karşılaştırılacak değer yoksa ya da 0 ise null */
function growthOf(cur: number | null | undefined, before: number | null | undefined): number | null {
  if (cur === null || cur === undefined || before === null || before === undefined) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(before) || before === 0) return null;
  return (cur - before) / Math.abs(before);
}

/** AkmanOS büyüme rozeti: önceki aya göre % değişim (olumlu limon, olumsuz kırmızı, nötr gri) */
function Change({ g, prevMonth, prevValue, basis }: { g: number | null; prevMonth: string; prevValue: number | null | undefined; basis?: string }) {
  if (g === null) return null;
  return (
    <span className="inline-flex" title={`${monthLabel(prevMonth)}: ${tl(prevValue)}${basis ? ` (${basis})` : ""}`}>
      <GrowthPill value={g}>
        {g >= 0.0005 ? "+" : ""}
        {pct(g, Math.abs(g) >= 1 ? 0 : 1)}
        <span className="sr-only"> ({monthLabel(prevMonth)} ayına göre)</span>
      </GrowthPill>
    </span>
  );
}

/**
 * Ödemeler & hatırlatıcılar (liste, hatırlatıcılar, ayarlar); okunamazsa sayfa yine açılır ("Bu ayın işleri" bunu
 * söyler). Nakit planı kartı aynı sonucu paylaşır (ikinci kez okunmaz).
 */
async function loadPayments(): Promise<Awaited<ReturnType<typeof loadUpcoming>> | null> {
  try {
    return await loadUpcoming();
  } catch {
    return null;
  }
}

/** Paraşüt bağlıysa son eşitleme; bağlı değilse null */
async function loadParasut(): Promise<ParasutFacts | null> {
  if (!isParasutConfigured()) return null;
  try {
    const db = getDb();
    const runs = s.parasutSyncRuns;
    const [[last], [ok]] = await Promise.all([
      // Tedarikçi geçmişi (tek tedarikçi, elle) eşitleme sayılmaz
      db.select({ status: runs.status, startedAt: runs.startedAt, message: runs.message }).from(runs).where(ne(runs.trigger, "history")).orderBy(desc(runs.startedAt)).limit(1),
      db
        .select({ startedAt: runs.startedAt, finishedAt: runs.finishedAt })
        .from(runs)
        .where(and(eq(runs.status, "ok"), ne(runs.trigger, "history")))
        .orderBy(desc(runs.startedAt))
        .limit(1),
    ]);
    return {
      lastStatus: last?.status ?? null,
      lastRunAt: last?.startedAt.toISOString() ?? null,
      lastOkAt: ok ? (ok.finishedAt ?? ok.startedAt).toISOString() : null,
      message: last?.message ?? null,
    };
  } catch {
    return null;
  }
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/panel">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const [model, upcoming, parasut] = await Promise.all([loadModel(), loadPayments(), loadParasut()]);
  const month = resolveMonth(sp.ay, model);
  const months = availableMonths(model);
  const d = dashboard(model, month);
  // "Bu ayın işleri" kartı eşleşmeyen POS ürünlerini ve ödenmemiş faturaları zaten gösterir: uyarılarda tekrarlanmaz
  // (bildirimlerde alerts() olduğu gibi kalır)
  // Hammadde zammı yüzünden fiyatı hedefin altına düşen ürünler (Ürünler sayfasındaki zam bölümüne götürür) ve 6
  // haftalık nakit planı (model ve ödemeler paylaşılır; yüklenemezse kart görünmez, sayfa açılır)
  const [priceAlerts, cashPlan] = await Promise.all([
    loadPriceAlerts(model).catch(() => null),
    upcoming ? loadCashPlan(model, upcoming).catch(() => null) : null,
  ]);
  const zam = priceAlerts ? priceAlert(priceAlerts.changes, priceAlerts.actionable, priceAlerts.loss.totalLoss) : null;
  // Paraşüt faturasında %40'tan fazla farklı gelen, onay bekleyen fiyatlar (Hammaddeler › Onay bekleyen fiyatlar)
  const hold = holdAlert((await pendingHoldSummary().catch(() => null))?.items ?? []);
  const alertItems = [...(hold ? [hold] : []), ...(zam ? [zam] : []), ...alerts(model, month).filter((a) => !a.href || !/durum=(eslesmeyen|odenmedi)/.test(a.href))];
  const year = Number(month.slice(0, 4));
  const yearMonths = yearTrend(model, year);
  const trend = yearMonths.filter((x) => x.active);
  const st = model.settings;

  // Süren ayın gidişatı (Excel "Ekim tahmini", Panel B19): yalnızca bugünün ayı için, bitmiş aylar için asla
  const forecastMonth = forecastMonthOf(model);
  const current = forecastMonth && forecastMonth !== month ? dashboard(model, forecastMonth) : d;
  const forecast = forecastMonth ? current.forecast : null;

  const t = d.theoretical;
  const purchases = model.goodsPurchases(month);

  // "Para nereye gitti?": Excel Panel'in 4 grubu (Kira, Personel, Reklam, Diğer) + varsa bu aya özel giderler
  const waterfall: FlowRow[] = t
    ? [
        { label: "Satışlar (net ciro)", value: t.netSales, sub: "Ürün satışları ÷ (1 + KDV)", sign: 1 },
        { label: "İndirimler", value: -t.discountsNet, sub: "Yönetici indirimleri (KDV hariç)", sign: -1 },
        { label: "Malzeme + ambalaj", value: -t.material, sub: "Satılan her ürün × reçete maliyeti", sign: -1 },
        { label: "Kart / POS komisyonu", value: -t.commission, sub: `Ciro × %${num(st.komisyon * 100, 1)} × kartlı oran %${num(st.kartOrani * 100, 1)}`, sign: -1 },
        ...t.fixedFlow.map((l) => ({
          label: l.label,
          value: -l.amount,
          // Tek kalem grubun adıyla aynıysa ("Kira") alt satır tekrar etmesin
          sub: l.items.length === 1 && l.items[0] === l.label ? "" : l.items.join(", "),
          sign: -1,
          info: l.hint,
          edited: l.overridden,
        })),
      ]
    : [];

  const showBreakEven = !!d.dailyAvg && d.breakEvenProgress !== null;
  const showForecast = !!t && !!forecast;
  const projected = d.forecast?.projectedProfit ?? 0;

  // Önceki ayla karşılaştırma (aynı metrik, aynı hesap). Süren ayın toplamları tam bir ayla kıyaslanmaz;
  // günlük ortalama iki ayda da aynı temelde (POS ÷ açık gün ya da liste ÷ açık gün) kıyaslanır.
  const prevMonth = shiftMonth(month, -1);
  const prev = dashboard(model, prevMonth);
  const pt = prev.theoretical;
  const fullMonths = d.monthState === "closed";
  const daily = dailyChange(d, prev);
  const g = {
    netSales: t && pt && fullMonths ? growthOf(t.netSales, pt.netSales) : null,
    gross: t && pt && fullMonths ? growthOf(t.grossProfit, pt.grossProfit) : null,
    net: t && pt && fullMonths ? growthOf(t.netProfit, pt.netProfit) : null,
    pos: fullMonths ? growthOf(d.info?.posRevenue, prev.info?.posRevenue) : null,
    daily: daily.growth,
  };
  const changeNote = (x: number | null) => (x !== null ? ` Rozet: ${monthLabel(prevMonth)} ayına göre değişim.` : "");
  const dailyBasis = daily.basis === "pos" ? "POS cirosu ÷ açık gün" : daily.basis === "list" ? "satış listesi ÷ açık gün" : undefined;

  // Bu ayın işleri: satış raporu, ay bilgileri, faturalar, su, sayım, ödemeler
  const tasks = monthTasks(
    monthTaskFacts(model, month, d.monthState, d.refMonth, {
      payments: upcoming ? paymentFacts(upcoming.items, unpaidSummary(model.ds.invoices)) : null,
      parasut,
    }),
  );

  const fm = d.fixedMonth;
  const netTip = t
    ? `Brüt kâr − indirimler (KDV hariç) − o ayın Gelir-gider sabit giderleri (açık gün oranı + bu aya özel giderler), reçeteye göre. Excel Panel'i her ay standart aylık sabit gideri düşer; fark olduğunda altta "Excel temeli" yazar. Faturaya göre değer Gelir-gider tablosundan gelir; stok sayımı yoksa alınan malın tamamı gider sayılır.${changeNote(g.net)}`
    : "";

  const tabs: DashboardTab[] = [
    { value: "kategori", label: "Kategoriler", content: <CategoriesTab d={d} target={st.hedefMaliyet} menu={menuAverageRow(model.products.filter((p) => p.product.active))} /> },
    ...(d.hasSales
      ? [
          {
            value: "karli",
            label: "En kârlı ürünler",
            short: "En kârlı",
            content: (
              <ProductRank
                month={month}
                icon={<Trophy />}
                title="En çok kâr getiren"
                description="Birim kâr × satış adedi"
                columns={[{ label: "Satış", numeric: true }, { label: "Toplam kâr", numeric: true }]}
                rows={d.topProducts.map((x) => ({
                  id: x.p.product.id,
                  name: x.p.key,
                  cells: [`${num(x.qty)} adet`, <span key="v" className="font-semibold">{tl(x.profit)}</span>],
                }))}
              />
            ),
          },
          {
            value: "satan",
            label: "En çok satan",
            short: "Çok satan",
            content: (
              <ProductRank
                month={month}
                icon={<Flame />}
                title="En çok satan"
                description="Satış adedine göre"
                columns={[{ label: "Marj", numeric: true }, { label: "Satış", numeric: true }]}
                rows={d.bestSellers.map((x) => ({
                  id: x.p.product.id,
                  name: x.p.key,
                  cells: [pct(x.p.margin), <span key="v" className="font-semibold">{`${num(x.qty)} adet`}</span>],
                }))}
              />
            ),
          },
          {
            value: "zayif",
            label: "En az kârlı",
            short: "Az kârlı",
            content: (
              <ProductRank
                month={month}
                icon={<TrendingDown />}
                title="Satılanlar içinde en düşük marj"
                description="Fiyatını gözden geçirin"
                columns={[{ label: "Durum", bare: true }, { label: "Fiyat", numeric: true }, { label: "Önerilen fiyat", numeric: true }, { label: "Marj", numeric: true }]}
                rows={d.weakest.map((x) => ({
                  id: x.p.product.id,
                  name: x.p.key,
                  cells: [
                    <StatusBadge key="s" status={x.p.status} />,
                    tl(x.p.price),
                    <span key="o" className={cn(x.p.price < x.p.suggestedPrice && "text-bad")}>
                      {tl(x.p.suggestedPrice)}
                    </span>,
                    <span key="v" className="font-semibold">
                      {pct(x.p.margin)}
                    </span>,
                  ],
                }))}
              />
            ),
          },
        ]
      : []),
    { value: "gider", label: "En büyük giderler", short: "Giderler", content: <ExpensesTab month={month} items={d.topExpenses} total={d.fixedStandardTotal} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Genel"
        title="Genel bakış"
        excel="Panel"
        description={
          <>
            {monthLabel(month)}
            {d.monthState === "running" ? " · devam ediyor" : d.monthState === "future" ? " · başlamadı" : ""}
            {d.info?.openDays ? ` · ${d.info.openDays} açık gün` : ""}
            {d.hasSales ? ` · ${num(d.sales.qty)} ürün satıldı` : ""}
          </>
        }
        actions={
          <>
            <MonthPicker months={months} value={month} />
            {/* Dosya indiren rota: düz bağlantı (istemci yönlendirmesi rotayı iki kez istemesin) */}
            {/* Telefonda kısa ad: ay seçici ile aynı satıra sığar */}
            <a href={`/api/export?ay=${month}`} download className={buttonClass("secondary")} aria-label={`${monthLabel(month)} Excel'e aktar`}>
              <Download size={16} aria-hidden="true" />
              <span className="max-[420px]:hidden">Excel&apos;e aktar</span>
              <span className="min-[421px]:hidden">Excel</span>
            </a>
          </>
        }
      />

      <div className="space-y-4">
        {/* Günlük işler çalışmadıysa ya da hata verdiyse kırmızı şerit (yalnız canlıda; kendi başına yüklenir) */}
        <Suspense fallback={null}>
          <SystemBanner />
        </Suspense>
        {/* 0. Bu ayın işleri: eksik veri, sıradaki iş (ürün satışları yoksa kâr oranının hangi aydan geldiği de burada) */}
        <DashboardChecklist month={month} state={d.monthState} tasks={tasks} />

        {/* 1. Metrikler (AkmanOS statistic-cards: rakam sayılır, yanında önceki aya göre rozet) */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {t ? (
            <>
              <StatBreakdown {...withComparison(netSalesBreakdown(model, d), { month: prevMonth, value: pt?.netSales, growth: g.netSales })}>
                <Stat
                  compact
                  icon={<Receipt />}
                  label="Net satış"
                  info={`Patron (ModPOS) ürün satışları ÷ (1 + KDV). Kasanıza kalan gerçek gelir.${changeNote(g.netSales)}`}
                  value={<CountUp value={t.netSales} />}
                  badge={<Change g={g.netSales} prevMonth={prevMonth} prevValue={pt?.netSales} />}
                  sub={`${tl(d.sales.revenue)} KDV dahil`}
                />
              </StatBreakdown>
              <StatBreakdown {...withComparison(grossProfitBreakdown(model, d), { month: prevMonth, value: pt?.grossProfit, growth: g.gross })}>
                <Stat
                  compact
                  icon={<Coins />}
                  label="Brüt kâr"
                  info={`Net satış − malzeme/ambalaj − POS komisyonu. Kira ve personel öncesi kâr.${changeNote(g.gross)}`}
                  value={<CountUp value={t.grossProfit} />}
                  badge={<Change g={g.gross} prevMonth={prevMonth} prevValue={pt?.grossProfit} />}
                  sub={`Marj ${pct(t.grossProfit / t.netSales)} · kira ve personel öncesi`}
                />
              </StatBreakdown>
              <StatBreakdown {...withComparison(netProfitBreakdown(model, d), { month: prevMonth, value: pt?.netProfit, growth: g.net })}>
                <Stat
                  compact
                  icon={t.netProfit < 0 ? <TrendingDown /> : <TrendingUp />}
                  label="Net kâr / zarar"
                  info={netTip}
                  value={<CountUp value={t.netProfit} />}
                  badge={<Change g={g.net} prevMonth={prevMonth} prevValue={pt?.netProfit} />}
                  tone={t.netProfit < 0 ? "bad" : "good"}
                  sub={
                    <>
                      {differs(t.netProfit, t.netProfitStandard) ? (
                        <span className="flex flex-wrap items-center gap-x-1.5">
                          Excel temeli:
                          <Signed value={t.netProfitStandard} className="whitespace-nowrap">
                            {tl(t.netProfitStandard)}
                          </Signed>
                          <InfoTip text={fixedBreakdownText(fm)} />
                        </span>
                      ) : null}
                      {d.actual.hasRevenue ? (
                        <span className="block">
                          Faturaya göre:{" "}
                          <Signed value={d.actual.profit} className="whitespace-nowrap">
                            {tl(d.actual.profit)}
                          </Signed>
                        </span>
                      ) : null}
                    </>
                  }
                />
              </StatBreakdown>
            </>
          ) : (
            <>
              <StatBreakdown {...withComparison(posRevenueBreakdown(model, d), { month: prevMonth, value: prev.info?.posRevenue, growth: g.pos })}>
                <Stat
                  compact
                  icon={<Receipt />}
                  label="POS cirosu (KDV dahil)"
                  info={g.pos !== null ? changeNote(g.pos).trim() : undefined}
                  value={<CountUp value={d.info?.posRevenue ?? null} />}
                  badge={<Change g={g.pos} prevMonth={prevMonth} prevValue={prev.info?.posRevenue} />}
                  sub={d.info?.openDays ? `${d.info.openDays} günde` : null}
                />
              </StatBreakdown>
              <StatBreakdown {...withComparison(dailyAvgBreakdown(d), { month: prevMonth, value: daily.previous, growth: g.daily, basis: dailyBasis })}>
                <Stat
                  compact
                  icon={<CalendarDays />}
                  label="Günlük ortalama ciro"
                  info={`POS cirosu ÷ açık gün (KDV dahil).${g.daily !== null ? ` Rozet: ${monthLabel(prevMonth)} ayına göre, iki ayda da ${dailyBasis}.` : ""}`}
                  value={<CountUp value={d.dailyAvg} />}
                  badge={<Change g={g.daily} prevMonth={prevMonth} prevValue={daily.previous} basis={dailyBasis} />}
                  sub="KDV dahil"
                />
              </StatBreakdown>
              <ThirdStat d={d} projected={projected} breakdown={d.monthState === "closed" ? actualProfitBreakdown(model, d) : forecastBreakdown(d)} />
            </>
          )}
          <StatBreakdown {...breakEvenBreakdown(model, d)}>
            <Stat
              compact
              icon={<Target />}
              label="Başabaş günlük ciro"
              info={`Zarar etmemek için gereken günlük ciro (KDV dahil): standart aylık sabit gider ${tl(d.fixedStandardTotal)} ÷ ${
                d.refMonth ? `${monthLabel(d.refMonth)} ` : ""
              }brüt kâr oranı (brüt kâr ÷ ciro, ${pct(d.grossRatio)}) ÷ ayda açık gün (${st.acikGun}, Ayarlar).`}
              value={<CountUp value={d.breakEvenDaily} />}
              sub={
                showBreakEven ? (
                  <>
                    Günlük ortalama <span className="whitespace-nowrap">{tl(d.dailyAvg)}</span> · başabaşa göre{" "}
                    <span className="whitespace-nowrap">{pct(d.breakEvenProgress, 0)}</span>
                  </>
                ) : null
              }
            >
              {showBreakEven && d.breakEvenProgress !== null ? <Progress value={d.breakEvenProgress} tone={progressTone(d.breakEvenProgress)} /> : null}
            </Stat>
          </StatBreakdown>
        </div>

        {/* 2. Uyarılar + maliyet göstergesi. Yan yana yalnız geniş ekranda: 1024'te kenar çubuğuyla içerik ~750 px
            kalır, 5/12'lik maliyet kartı 270 px'e iner ve "ürün “Düşük kâr”" kutuları sözcük sözcük kırılırdı */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
            {upcoming ? <DashboardPayments items={upcoming.items} /> : null}
            {cashPlan?.plan.hasData ? <DashboardCashPlan plan={cashPlan.plan} /> : null}
            <DashboardAlerts items={alertItems} className="flex-1" />
          </div>
          <CostCard
            className="xl:col-span-5"
            recipeRatio={d.recipeCostRatio}
            invoiceRatio={d.invoiceCostRatio}
            target={st.hedefMaliyet}
            lowCount={d.lowProfitCount}
            attentionCount={d.attentionCount}
            year={year}
            month={month}
            months={yearMonths}
          />
        </div>

        {/* 3. Para nereye gitti + reçete/fatura karşılaştırması (yan yana xl'de: 1024'te kartlar 330 px'e iner) */}
        {t ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <WaterfallCard month={month} t={t} rows={waterfall} />
            <Card>
              <CardHeader
                icon={<Scale />}
                title="Reçeteye göre mi, faturaya göre mi?"
                description="Aradaki fark fire, ikram, stokta bekleyen mal ya da reçetede eksik malzemeyi gösterir."
              />
              <CardContent className="@container flex flex-1 flex-col gap-4">
                {/* Telefonda da yan yana (iki tutar birlikte okunur); çok dar ekranda alt alta */}
                <div className="grid grid-cols-1 gap-2.5 @[18rem]:grid-cols-2 sm:gap-3">
                  <Well className="p-3 sm:p-3.5">
                    <p className="text-xs font-medium text-ink-mute">Reçeteye göre maliyet</p>
                    <p className="mt-1 text-lg font-semibold tracking-tight whitespace-nowrap text-ink tabular sm:text-xl">{tl(t.material)}</p>
                    <p className="text-xs text-ink-mute">Maliyet oranı {pct(d.recipeCostRatio)}</p>
                  </Well>
                  <Well className="p-3 sm:p-3.5">
                    <p className="text-xs font-medium text-ink-mute">Faturaya göre alım</p>
                    <p className="mt-1 text-lg font-semibold tracking-tight whitespace-nowrap text-ink tabular sm:text-xl">{tl(purchases)}</p>
                    <p className="text-xs text-ink-mute">
                      {/* ⓘ oranla birlikte kırılır: dar kutuda tek başına alt satıra düşmez */}
                      Maliyet oranı{" "}
                      <span className="whitespace-nowrap">
                        {pct(d.invoiceCostRatio)}
                        <InfoTip
                          className="ml-1.5 align-middle"
                          text="Faturayla alınan mal (kahve, süt, gıda, ambalaj; KDV hariç) ÷ net satış. Stok sayımı yoksa ay içinde alınan her şey o ayın maliyeti sayılır."
                        />
                      </span>
                    </p>
                  </Well>
                </div>
                <div className="divide-y divide-line">
                  <KeyValue
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        Fark (alınan − harcanan)
                        <InfoTip text="Faturayla alınan mal − reçeteye göre satışlarda harcanan malzeme. Artı değer: fire, ikram, stokta bekleyen mal ya da reçetede eksik malzeme." />
                      </span>
                    }
                    value={<span className="font-semibold whitespace-nowrap">{tl(purchases - t.material)}</span>}
                  />
                  <KeyValue
                    label="Kâr/zarar · reçeteye göre"
                    value={
                      <Signed value={t.netProfit} className="font-semibold whitespace-nowrap">
                        {tl(t.netProfit)}
                      </Signed>
                    }
                  />
                  <KeyValue
                    label="Kâr/zarar · faturaya göre"
                    value={
                      <Signed value={d.actual.profit} className="font-semibold whitespace-nowrap">
                        {tl(d.actual.profit)}
                      </Signed>
                    }
                  />
                  {d.info?.offRevenue ? (
                    <KeyValue
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          Ödenmez / ikram
                          <InfoTip text="Ciro dışı satışlar: malzemesi harcanıyor ama geliri yok. Tahmini maliyet = tutar ÷ (1+KDV) × ortalama maliyet oranı." />
                        </span>
                      }
                      value={
                        <>
                          <span className="whitespace-nowrap">{tl(d.info.offRevenue)}</span>
                          <span className="block text-xs whitespace-nowrap text-ink-mute">maliyet ≈ {tl((d.info.offRevenue / (1 + st.kdv)) * d.sales.avgCostRatio)}</span>
                        </>
                      }
                    />
                  ) : null}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <ButtonLink href={`/panel/tutarlilik?ay=${month}`} variant="secondary">
                    Tutarlılık kontrolü
                  </ButtonLink>
                  <ButtonLink href={`/panel/sayim?ay=${month}`} variant="ghost">
                    Stok sayımı gir
                  </ButtonLink>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* 4. Yıl grafiği + ay gidişatı */}
        {trend.length || showForecast ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            {trend.length ? (
              <Card className={showForecast ? "xl:col-span-8" : "xl:col-span-12"}>
                <CardHeader
                  icon={<ChartColumn />}
                  title={`${year} aylık gelir-gider`}
                  description={
                    <span className="inline-flex items-center gap-1.5">
                      Gelir-gider tablosundan, faturaya göre
                      <InfoTip text="Kira, personel gibi aylık giderler açık gün sayısına göre bölünür. Ciro KDV hariçtir." />
                    </span>
                  }
                  actions={
                    <ButtonLink href={`/panel/gelir-gider?yil=${year}`} variant="secondary" size="sm">
                      Tabloyu aç <ArrowRight size={15} aria-hidden="true" />
                    </ButtonLink>
                  }
                />
                <CardContent className="space-y-3">
                  <YearTotals months={trend} />
                  {/* Telefonda dar iç boşluk: grafiğin lejantı tek satıra sığar, eksen etiketinin üstüne binmez */}
                  <Well className="p-2 sm:p-4">
                    <TrendChart
                      data={trend.map((x) => ({
                        label: monthShort(x.month),
                        revenue: Math.round(x.revenueNet),
                        expenses: Math.round(x.expenses),
                        profit: Math.round(x.profit),
                      }))}
                    />
                  </Well>
                </CardContent>
              </Card>
            ) : null}
            {showForecast && forecast && forecastMonth ? (
              <ForecastCard
                className={trend.length ? "xl:col-span-4" : "xl:col-span-12"}
                month={forecastMonth}
                forecast={forecast}
                dailyAvg={current.dailyAvg}
                progress={current.breakEvenProgress}
                grossRatio={current.grossRatio}
                fixedStandard={current.fixedStandardTotal}
              />
            ) : null}
          </div>
        ) : null}

        {/* 5. Ayrıntı listeleri tek kartta */}
        <DashboardTabs label="Ayrıntı listesi" tabs={tabs} />
      </div>
    </>
  );
}

/**
 * Satış listesi olmayan ayın üçüncü rakamı: süren ayda ay sonu tahmini (Excel B19), bitmiş ayda
 * Gelir-gider'deki gerçek (faturaya göre) sonuç; tahmin yalnızca süren ay için yapılır. Dökümü sayfa kurar
 * (bitmiş ayda Gelir-gider satırları, süren ayda tahminin girdileri).
 */
function ThirdStat({ d, projected, breakdown }: { d: DashboardData; projected: number; breakdown: CardBreakdown }) {
  if (d.monthState === "closed") {
    const has = d.actual.hasRevenue || d.actual.expenses > 0;
    return (
      <StatBreakdown {...breakdown}>
        <Stat
          compact
          icon={d.actual.profit < 0 ? <TrendingDown /> : <TrendingUp />}
          label="Kâr / zarar (faturaya göre)"
          info="Ay bitti; tahmin yerine gerçekleşen sonuç: Gelir-gider tablosunda KDV hariç ciro − satılan malın maliyeti − giderler. Ürün satış raporu yüklenince reçeteye göre kâr da hesaplanır."
          value={<CountUp value={has ? d.actual.profit : null} />}
          tone={!has ? "default" : d.actual.profit < 0 ? "bad" : "good"}
          sub={
            // Dokunmatikte satır yüksekliğini büyütmeden görünmez kenarla 44px dokunma alanı
            <Link
              href={`/panel/gelir-gider?yil=${d.month.slice(0, 4)}`}
              className="relative hover:text-ink hover:underline pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:content-['']"
            >
              Gelir-gider tablosundan
            </Link>
          }
        />
      </StatBreakdown>
    );
  }
  return (
    <StatBreakdown {...breakdown}>
      <Stat
        compact
        icon={projected < 0 ? <TrendingDown /> : <TrendingUp />}
        label="Ay sonu tahmini kâr/zarar"
        info={`Bu tempo sürerse: POS cirosu ÷ açık gün × ayın gün sayısı × ${
          d.refMonth ? `${monthLabel(d.refMonth)} ` : "son satış ayının "
        }brüt kâr oranı − standart aylık sabit gider (Excel Panel B19). Açık gün sayısı bugüne kadar geçen gün olarak kullanılır.`}
        value={<CountUp value={d.forecast?.projectedProfit ?? null} />}
        tone={!d.forecast ? "default" : projected < 0 ? "bad" : "good"}
        sub={
          d.forecast ? (
            <>
              Tahmini ciro <span className="whitespace-nowrap">{tl(d.forecast.projectedRevenue)}</span> · {d.forecast.daysElapsed} / {d.forecast.dim} gün
            </>
          ) : d.monthState === "future" ? (
            "Ay başlamadı"
          ) : (
            "Açık gün ve POS cirosu girilince hesaplanır"
          )
        }
      />
    </StatBreakdown>
  );
}


function CostCard({
  className,
  recipeRatio,
  invoiceRatio,
  target,
  lowCount,
  attentionCount,
  year,
  month,
  months,
}: {
  className?: string;
  recipeRatio: number | null;
  invoiceRatio: number | null;
  target: number;
  lowCount: number;
  attentionCount: number;
  year: number;
  month: string;
  months: YearMonth[];
}) {
  const gaugeTone = recipeRatio === null ? "brand" : recipeRatio > target + 0.1 ? "bad" : recipeRatio > target ? "warn" : "brand";
  const segTone = (m: YearMonth): "good" | "bad" | "empty" => (!m.active ? "empty" : m.profit < 0 ? "bad" : "good");
  const profitMonths = months.filter((m) => segTone(m) === "good").length;
  const lossMonths = months.filter((m) => segTone(m) === "bad").length;
  return (
    <Card className={className}>
      <CardHeader icon={<Percent />} title="Maliyet hedefi" description={`Malzeme maliyeti ÷ net satış · hedef ${pct(target, 0)}`} />
      <CardContent className="space-y-5">
        <Well className="pt-5">
          {recipeRatio !== null ? (
            <Gauge value={recipeRatio} target={target} display={pct(recipeRatio)} label="Reçeteye göre maliyet oranı" tone={gaugeTone} />
          ) : (
            <p className="py-6 text-center text-sm text-ink-mute">Satış raporu yüklenince bu ayın maliyet oranı burada görünür.</p>
          )}
          <div className="mt-4 grid grid-cols-2 divide-x divide-line border-t border-line pt-3 text-center">
            <div>
              <p className="text-xs text-ink-mute">Hedef</p>
              <p className="text-sm font-semibold text-ink tabular">{pct(target, 0)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-mute">Faturaya göre</p>
              <p className="text-sm font-semibold text-ink tabular">{pct(invoiceRatio)}</p>
            </div>
          </div>
        </Well>

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            Fiyat kontrolü
            <InfoTip text={`Hedef maliyet oranı %${num(target * 100)}. Önerilen fiyat maliyetin hedef orana denk geldiği, 5 ₺'ye yuvarlanmış fiyattır.`} />
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <CountLink href="/panel/urunler?durum=Düşük kâr" value={lowCount} label="ürün “Düşük kâr”" tone="bad" />
            <CountLink href="/panel/urunler?durum=Dikkat" value={attentionCount} label="ürün “Dikkat”" tone="warn" />
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              {year} kâr / zarar
              <InfoTip text="Her ay Gelir-gider tablosundaki (faturaya göre) kâr ya da zarar. Gri: o ay için POS cirosu girilmedi ya da veri yok; ciro girilmeden kâr/zarar sayılmaz. Çerçeveli parça seçili ay." />
            </h3>
            <p className="flex items-center gap-1.5">
              <Badge tone="green" className="tabular">
                {profitMonths} ay kâr
              </Badge>
              <Badge tone="red" className="tabular">
                {lossMonths} ay zarar
              </Badge>
            </p>
          </div>
          <SegmentStrip
            className="mt-3"
            activeKey={month}
            showLabels
            segments={months.map((m) => ({
              key: m.month,
              tone: segTone(m),
              short: monthShort(m.month),
              // Renk tek başına anlam taşımasın: ipucu ve ekran okuyucu metni kâr/zarar ve seçili ayı da söyler
              label: `${monthLabel(m.month)}: ${m.active ? `${m.profit < 0 ? "zarar" : "kâr"} ${tl(Math.abs(m.profit))}` : m.missingRevenue ? "ciro girilmedi" : "veri yok"}${
                m.month === month ? " (seçili ay)" : ""
              }`,
            }))}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CountLink({ href, value, label, tone }: { href: string; value: number; label: string; tone: "bad" | "warn" }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-2 rounded-2xl bg-surface px-3.5 py-3 ring-1 ring-line transition-shadow outline-none hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/30"
    >
      <span className="min-w-0">
        <span className={cn("block text-2xl leading-7 font-semibold tracking-tight tabular", value ? (tone === "bad" ? "text-bad" : "text-warn") : "text-ink")}>
          {value}
        </span>
        <span className="text-xs text-ink-mute">{label}</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-ink-quiet transition-colors group-hover:text-ink" aria-hidden="true" />
    </Link>
  );
}

function WaterfallCard({ month, t, rows }: { month: string; t: Theoretical; rows: FlowRow[] }) {
  const loss = t.netProfit < 0;
  const f = t.fixedBreakdown;
  const showStandard = differs(t.netProfit, t.netProfitStandard);
  return (
    <Card>
      <CardHeader
        icon={<Wallet />}
        title={`${monthLabel(month)}: para nereye gitti?`}
        description={
          <>
            KDV hariç. Malzeme maliyeti reçetelere göre hesaplanır.
            <InfoTip
              className="ml-1.5"
              text="Sabit giderler Excel Panel'deki gibi 4 grupta: Kira (yalnızca kira satırı), Personel (maaş + SGK, part-time, yemek), Reklam (Instagram, influencer) ve Diğer (elektrik, muhasebe, güvenlik, yazılım, ortak gider…). Tutarlar o ayın Gelir-gider değerleridir. Gelir-gider tablosu kendi bölümlerini (Personel giderleri, Faturalar, Kira, İşletme genel giderleri) kullanır; toplam aynıdır."
            />
          </>
        }
      />
      <CardContent className="flex flex-1 flex-col gap-3">
        <MoneyFlow rows={rows} netSales={t.netSales} netProfit={t.netProfit} />
        <FixedReconcile f={f} />
        <div className="rounded-2xl bg-panel-deep px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-ink">
              <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-[3px]", loss ? "bg-bad" : "bg-lime")} />
              {monthLabel(month)} net kâr / zarar
            </span>
            <span className="flex items-baseline gap-1.5">
              <Signed value={t.netProfit} className={cn("text-lg font-semibold tracking-tight", !loss && "text-good")}>
                {tl(t.netProfit)}
              </Signed>
              <span className="text-xs text-ink-mute tabular" title="Net satışa oranı">
                {pct(t.netSales ? t.netProfit / t.netSales : null, 0)}
              </span>
            </span>
          </div>
          {showStandard ? (
            <p className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-ink-mute">
              <span>Excel temeli (standart aylık sabit gider)</span>
              <Signed value={t.netProfitStandard} className="font-medium whitespace-nowrap">
                {tl(t.netProfitStandard)}
              </Signed>
            </p>
          ) : null}
        </div>
        <p className="text-xs text-ink-mute">Vergi ve tek seferlik yatırımlar hariç.</p>
      </CardContent>
    </Card>
  );
}

function ForecastCard({
  className,
  month,
  forecast,
  dailyAvg,
  progress,
  grossRatio,
  fixedStandard,
}: {
  className?: string;
  month: string;
  forecast: Forecast;
  dailyAvg: number | null;
  progress: number | null;
  grossRatio: number;
  fixedStandard: number;
}) {
  return (
    <Card className={className}>
      <CardHeader
        icon={<CalendarClock />}
        title={
          <span className="inline-flex items-center gap-1.5">
            {monthLabel(month)} gidişatı
            <InfoTip
              text={`Bu tempo sürerse: POS cirosu ÷ açık gün × ayın gün sayısı × ${
                forecast.refMonth ? `${monthLabel(forecast.refMonth)} ` : "son satış ayının "
              }brüt kâr oranı − standart aylık sabit gider (Excel Panel B19). Açık gün sayısı bugüne kadar geçen gün olarak kullanılır; ay bitince gerçek açık gün sayısını yazın.`}
            />
          </span>
        }
        description={`${forecast.daysElapsed} / ${forecast.dim} gün geçti`}
      />
      <CardContent className="flex-1">
        <Well className="py-2">
          <KeyValue label="Günlük ortalama ciro" value={<span className="font-semibold whitespace-nowrap">{tl(dailyAvg)}</span>} />
          {progress !== null ? (
            <div className="pb-2">
              <Progress value={progress} tone={progressTone(progress)} />
              <p className="mt-1 text-xs text-ink-mute tabular">Başabaşa göre {pct(progress, 0)}</p>
            </div>
          ) : null}
          <div className="divide-y divide-line border-t border-line">
            <KeyValue label="Bu tempoyla ay sonu ciro" value={<span className="whitespace-nowrap">{tl(forecast.projectedRevenue)}</span>} />
            <KeyValue
              label={forecast.refMonth ? `Brüt kâr oranı · ${monthLabel(forecast.refMonth)}` : "Brüt kâr oranı"}
              value={<span className="whitespace-nowrap">{pct(grossRatio)}</span>}
            />
            <KeyValue label="Standart aylık sabit gider" value={<span className="whitespace-nowrap">{tl(fixedStandard)}</span>} />
            <KeyValue
              label="Tahmini net kâr / zarar"
              strong
              value={
                <Signed value={forecast.projectedProfit} className="whitespace-nowrap">
                  {tl(forecast.projectedProfit)}
                </Signed>
              }
            />
          </div>
        </Well>
      </CardContent>
    </Card>
  );
}

/**
 * "Bütün menü" alt satırının ortalamaları: Excel Ürün Kârlılık satır 134 (K134 / L134) gibi basit ortalama,
 * reçetesi olmayan ürün katılmaz (Ürünler listesinin alt satırıyla aynı kural: menuAverages).
 */
function menuAverageRow(products: { status: ProductStatus; costRatio: number; margin: number; unitProfit: number }[]) {
  const avg = menuAverages(products);
  const reciped = products.filter((p) => p.status !== "Reçete yok");
  return {
    count: avg.count,
    margin: avg.margin,
    costRatio: avg.costRatio,
    unitProfit: reciped.length ? reciped.reduce((a, p) => a + p.unitProfit, 0) / reciped.length : null,
  };
}

function CategoriesTab({ d, target, menu }: { d: DashboardData; target: number; menu: ReturnType<typeof menuAverageRow> }) {
  const other = d.categoryMonthIsOther && d.categoryMonth;
  return (
    <CategoriesPanel
      cats={d.categories}
      target={target}
      menu={menu}
      salesMonth={other ? `${monthShort(d.categoryMonth!)} ${d.categoryMonth!.slice(0, 4)}` : null}
      description={`Ort. değerler menüdeki ürünlerin basit ortalamasıdır (Excel'deki gibi). ${
        !d.categoryMonth
          ? "Satış verisi yok."
          : other
            ? `${monthLabel(d.month)} ürün satış raporu yok; satış adedi ve satış ağırlıklı marj ${monthLabel(d.categoryMonth)} satışlarından.`
            : `Satış adedi ve satış ağırlıklı marj ${monthLabel(d.categoryMonth)} satışlarına göredir.`
      }`}
    />
  );
}

function ProductRank({
  icon,
  title,
  description,
  columns,
  rows,
  month,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  /** `bare`: telefon listesinde etiketsiz (rozet kendini anlatır) */
  columns: { label: string; numeric?: boolean; bare?: boolean }[];
  rows: { id: number; name: string; cells: ReactNode[] }[];
  month: string;
}) {
  return (
    <>
      <CardHeader
        icon={icon}
        title={title}
        description={description}
        actions={
          <ButtonLink href={`/panel/analiz?ay=${month}`} variant="secondary" size="sm">
            <ChartScatter size={15} aria-hidden="true" />
            Bütün ürünler
          </ButtonLink>
        }
      />
      {rows.length ? (
        <>
          {/* Telefon: sıra + ürün adı + asıl değer (son sütun) bir satırda, diğer sütunlar altında etiketleriyle.
              Asıl değerin adı listenin üstünde bir kez görünür (tablo başlığı gibi); ekran okuyucu her satırda okur. */}
          <div className="mx-4 flex items-end justify-between gap-3 border-b border-line pb-1.5 text-xs font-medium text-ink-mute sm:hidden" aria-hidden="true">
            <span className="pl-8">Ürün</span>
            <span>{columns[columns.length - 1]?.label}</span>
          </div>
          <ol className="divide-y divide-line px-4 pb-2 sm:hidden" aria-label={title}>
            {rows.map((r, i) => {
              const last = r.cells.length - 1;
              return (
                <li key={r.id} className="flex gap-3 py-2.5">
                  <span className="w-5 shrink-0 pt-2.5 text-right text-[13px] text-ink-mute tabular">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={productHref(r.id, month)} className="flex min-h-11 min-w-0 items-center text-[15px] font-medium text-pretty text-ink hover:underline">
                        {r.name.replace("|", " · ")}
                      </Link>
                      <span className="shrink-0 pt-2 text-right text-[15px] whitespace-nowrap text-ink tabular">
                        <span className="sr-only">{columns[last]?.label}: </span>
                        {r.cells[last]}
                      </span>
                    </div>
                    {last > 0 ? (
                      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                        {r.cells.slice(0, last).map((cell, j) => (
                          <div key={columns[j]?.label ?? j} className="flex items-center gap-1.5">
                            <dt className={columns[j]?.bare ? "sr-only" : "text-ink-mute"}>{columns[j]?.label}</dt>
                            <dd className="text-ink tabular">{cell}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <TableWrap className="max-sm:hidden">
            <Table>
              <THead>
                <tr>
                  <TH className="w-10">#</TH>
                  <TH>Ürün</TH>
                  {columns.map((c) => (
                    <TH key={c.label} numeric={c.numeric}>
                      {c.label}
                    </TH>
                  ))}
                </tr>
              </THead>
              <tbody>
                {rows.map((r, i) => (
                  <TR key={r.id}>
                    <TD className="text-ink-mute tabular">{i + 1}</TD>
                    <TD className="py-1">
                      <Link href={productHref(r.id, month)} className="inline-flex min-h-9 items-center font-medium pointer-coarse:min-h-11 text-ink hover:underline">
                        {r.name.replace("|", " · ")}
                      </Link>
                    </TD>
                    {r.cells.map((cell, j) => (
                      <TD key={j} numeric={columns[j]?.numeric}>
                        {cell}
                      </TD>
                    ))}
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      ) : (
        <EmptyState
          title="Veri yok"
          description="Bu ay menüdeki ürünlerle eşleşen satış bulunamadı. Satış raporundaki ürün adları menüdekilerle eşleşiyor mu, Satışlar sayfasından bakın."
          action={
            <ButtonLink href={`/panel/satislar?ay=${month}`} variant="secondary" size="sm">
              Satışlara git
            </ButtonLink>
          }
        />
      )}
      {rows.length ? <CardFooter>İlk {rows.length} ürün. Bütün menünün sıralaması ve grupları Analiz &amp; senaryo sayfasında.</CardFooter> : null}
    </>
  );
}

/** Kaç gider kalemi tek tek listelensin; kalanı tek satırda toplanır */
const TOP_EXPENSES = 6;

function ExpensesTab({ month, items, total }: { month: string; items: { name: string; amount: number }[]; total: number }) {
  const top = items.slice(0, TOP_EXPENSES);
  const rest = items.slice(TOP_EXPENSES);
  const restSum = rest.reduce((s, e) => s + e.amount, 0);
  const share = (v: number) => (total > 0 ? pct(v / total, 0) : "–");
  return (
    <>
      <CardHeader
        icon={<Wallet />}
        title="En büyük aylık gider kalemleri"
        description={
          <>
            {monthLabel(month)} standart aylık sabit gider <span className="font-medium whitespace-nowrap text-ink tabular">{tl(total)}</span> · yüzde: toplamdaki
            payı
          </>
        }
        actions={
          <ButtonLink href="/panel/giderler" variant="secondary" size="sm">
            Sabit giderler <ArrowRight size={15} aria-hidden="true" />
          </ButtonLink>
        }
      />
      <CardContent>
        {top.length ? (
          <Well>
            <ul className="space-y-3.5">
              {top.map((e, i) => (
                <li key={`${e.name}-${i}`}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    {/* Telefonda uzun kalem adı alt satıra geçer (kısaltılmaz) */}
                    <span className="min-w-0 text-pretty break-words text-ink sm:truncate" title={e.name}>
                      {e.name}
                    </span>
                    <span className="shrink-0 whitespace-nowrap">
                      <span className="font-semibold text-ink tabular">{tl(e.amount)}</span>
                      <span className="ml-1.5 inline-block min-w-9 text-right text-xs text-ink-mute tabular">{share(e.amount)}</span>
                    </span>
                  </div>
                  <Meter value={e.amount / top[0].amount} index={i} />
                </li>
              ))}
            </ul>
            {rest.length ? (
              <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-sm text-ink-mute">
                <span className="min-w-0">Diğer {rest.length} kalem</span>
                <span className="shrink-0 whitespace-nowrap">
                  <span className="font-medium text-ink tabular">{tl(restSum)}</span>
                  <span className="ml-1.5 inline-block min-w-9 text-right text-xs tabular">{share(restSum)}</span>
                </span>
              </p>
            ) : null}
          </Well>
        ) : (
          <EmptyState
            title="Gider kalemi yok"
            description="Sabit giderleri ve personeli girince en büyük kalemler burada sıralanır."
            action={
              <ButtonLink href="/panel/giderler" variant="primary" size="sm">
                Gider ekle
              </ButtonLink>
            }
          />
        )}
      </CardContent>
    </>
  );
}

/** Yıl grafiğinin üstünde: veri olan ayların toplam cirosu, gideri ve kâr/zararı */
function YearTotals({ months }: { months: YearMonth[] }) {
  const revenue = months.reduce((s, m) => s + m.revenueNet, 0);
  const expenses = months.reduce((s, m) => s + m.expenses, 0);
  const profit = months.reduce((s, m) => s + m.profit, 0);
  const cells = [
    { label: "Ciro (KDV hariç)", value: <span className="whitespace-nowrap">{tl(revenue)}</span> },
    { label: "Giderler", value: <span className="whitespace-nowrap">{tl(expenses)}</span> },
    {
      label: "Kâr / zarar",
      value: (
        <Signed value={profit} className="whitespace-nowrap">
          {tl(profit)}
        </Signed>
      ),
    },
  ];
  return (
    <div>
      <p className="mb-1.5 text-xs text-ink-mute">{months.length} ayın toplamı</p>
      {/* Telefonda üç tutar yan yana sığmaz: alt alta, etiket solda tutar sağda */}
      <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-2">
        {cells.map((c) => (
          <div key={c.label} className="flex min-w-0 items-baseline justify-between gap-3 rounded-xl bg-surface px-3 py-2 sm:block">
            <dt className="truncate text-xs text-ink-mute">{c.label}</dt>
            <dd className="text-sm font-semibold text-ink tabular sm:mt-0.5 sm:text-base">{c.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

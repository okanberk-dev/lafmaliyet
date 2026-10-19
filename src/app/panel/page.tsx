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
  Upload,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { TrendChart } from "@/components/charts";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { Gauge } from "@/components/ui/gauge";
import { EmptyState, GrowthPill, InfoTip, KeyValue, PageSkeleton, Progress, SegmentStrip, Signed, Stat } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { daysInMonth, fixedForMonth, shiftMonth } from "@/lib/calc/engine";
import { alerts, dashboard, yearTrend, type DashboardData } from "@/lib/calc/insights";
import { FIXED_SECTIONS } from "@/lib/constants";
import { monthLabel, monthShort, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";

import { DashboardAlerts } from "./dashboard-alerts";
import { CategoriesPanel } from "./dashboard-categories";
import { Meter, MoneyFlow, type FlowRow } from "./dashboard-flow";
import { CountUp } from "./dashboard-number";
import { DashboardPayments } from "./dashboard-payments";
import { DashboardTabs, type DashboardTab } from "./dashboard-tabs";

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
function Change({ g, prevMonth, prevValue }: { g: number | null; prevMonth: string; prevValue: number | null | undefined }) {
  if (g === null) return null;
  return (
    <span className="inline-flex" title={`${monthLabel(prevMonth)}: ${tl(prevValue)}`}>
      <GrowthPill value={g}>
        {g >= 0.0005 ? "+" : ""}
        {pct(g, Math.abs(g) >= 1 ? 0 : 1)}
        <span className="sr-only"> ({monthLabel(prevMonth)} ayına göre)</span>
      </GrowthPill>
    </span>
  );
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/panel">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const model = await loadModel();
  const month = resolveMonth(sp.ay, model);
  const months = availableMonths(model);
  const d = dashboard(model, month);
  const alertItems = alerts(model, month);
  const year = Number(month.slice(0, 4));
  const yearMonths = yearTrend(model, year);
  const trend = yearMonths.filter((x) => x.active);
  const st = model.settings;

  // En son (eksik) ayın gidişatı: Excel'deki "Ekim tahmini"
  const latest = [...model.monthInfo.values()]
    .filter((m) => m.openDays && m.posRevenue)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  const forecastMonth = latest && latest.month !== month ? latest.month : month;
  const current = forecastMonth !== month ? dashboard(model, forecastMonth) : d;
  const forecast = current.forecast;

  const t = d.theoretical;
  const pm = model.pnlMonth(month);
  const purchases = model.goodsPurchases(month);
  const sectionItems = (key: string) =>
    model.activeFixed
      .filter((f) => f.section === key)
      .map((f) => ({ name: f.name, v: fixedForMonth(f, st, pm.openDays, daysInMonth(month)) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => x.name)
      .join(", ");

  const waterfall: FlowRow[] = t
    ? [
        { label: "Satışlar (net ciro)", value: t.netSales, sub: "Ürün satışları ÷ (1 + KDV)", sign: 1 },
        { label: "İndirimler", value: -t.discountsNet, sub: "Yönetici indirimleri (KDV hariç)", sign: -1 },
        { label: "Malzeme + ambalaj", value: -t.material, sub: "Satılan her ürün × reçete maliyeti", sign: -1 },
        { label: "Kart / POS komisyonu", value: -t.commission, sub: `Ciro × %${num(st.komisyon * 100, 1)} × kartlı oran %${num(st.kartOrani * 100, 1)}`, sign: -1 },
        ...FIXED_SECTIONS.map((s) => ({
          label: s.label,
          value: -t.fixed[s.key],
          sub: s.key === "personel" ? ["Maaş + SGK", sectionItems(s.key)].filter(Boolean).join(", ") : sectionItems(s.key),
          sign: -1,
        })),
      ]
    : [];

  const showBreakEven = !!d.dailyAvg && d.breakEvenProgress !== null;
  const showForecast = !!t && !!forecast;
  const projected = d.forecast?.projectedProfit ?? 0;

  // Önceki ayla karşılaştırma (aynı metrik, aynı hesap). Eksik (devam eden) ayın toplamları tam bir ayla
  // kıyaslanmaz; günlük ortalama her durumda kıyaslanabilir.
  const prevMonth = shiftMonth(month, -1);
  const prev = dashboard(model, prevMonth);
  const pt = prev.theoretical;
  const fullMonths = !d.forecast && !prev.forecast;
  const g = {
    netSales: t && pt && fullMonths ? growthOf(t.netSales, pt.netSales) : null,
    gross: t && pt && fullMonths ? growthOf(t.grossProfit, pt.grossProfit) : null,
    net: t && pt && fullMonths ? growthOf(t.netProfit, pt.netProfit) : null,
    pos: fullMonths ? growthOf(d.info?.posRevenue, prev.info?.posRevenue) : null,
    daily: growthOf(d.dailyAvg, prev.dailyAvg),
  };
  const changeNote = (x: number | null) => (x !== null ? ` Rozet: ${monthLabel(prevMonth)} ayına göre değişim.` : "");

  const tabs: DashboardTab[] = [
    { value: "kategori", label: "Kategoriler", content: <CategoriesTab d={d} target={st.hedefMaliyet} /> },
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
                columns={[{ label: "Durum" }, { label: "Fiyat", numeric: true }, { label: "Önerilen fiyat", numeric: true }, { label: "Marj", numeric: true }]}
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
    { value: "gider", label: "En büyük giderler", short: "Giderler", content: <ExpensesTab items={d.topExpenses} total={d.fixedStandardTotal} /> },
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
            {d.info?.openDays ? ` · ${d.info.openDays} açık gün` : ""}
            {d.hasSales ? ` · ${num(d.sales.qty)} ürün satıldı` : ""}
          </>
        }
        actions={
          <>
            <MonthPicker months={months} value={month} />
            <ButtonLink href={`/api/export?ay=${month}`} variant="secondary" prefetch={false}>
              <Download size={16} aria-hidden="true" />
              Excel&apos;e aktar
            </ButtonLink>
          </>
        }
      />

      <div className="space-y-4">
        {!d.hasSales ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-soft px-5 py-4 text-warn">
            <div className="flex min-w-0 items-start gap-3">
              <Upload size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold">{monthLabel(month)} ürün satışları henüz yüklenmedi</p>
                <p className="mt-0.5 text-sm">
                  Reçeteye göre kâr hesabı için Patron&apos;dan ürün satış raporunu yükleyin. Aşağıdaki kâr oranı{" "}
                  {d.refMonth ? monthLabel(d.refMonth) : "son ay"} satışlarından alınıyor.
                </p>
              </div>
            </div>
            <ButtonLink href={`/panel/satislar?ay=${month}`} variant="primary">
              Satış raporu yükle
            </ButtonLink>
          </div>
        ) : null}

        {/* 1. Metrikler (AkmanOS statistic-cards: rakam sayılır, yanında önceki aya göre rozet) */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {t ? (
            <>
              <Stat
                icon={<Receipt />}
                label="Net satış"
                info={`Patron (ModPOS) ürün satışları ÷ (1 + KDV). Kasanıza kalan gerçek gelir.${changeNote(g.netSales)}`}
                value={<CountUp value={t.netSales} />}
                badge={<Change g={g.netSales} prevMonth={prevMonth} prevValue={pt?.netSales} />}
                sub={`${tl(d.sales.revenue)} KDV dahil`}
              />
              <Stat
                icon={<Coins />}
                label="Brüt kâr"
                info={`Net satış − malzeme/ambalaj − POS komisyonu. Kira ve personel öncesi kâr.${changeNote(g.gross)}`}
                value={<CountUp value={t.grossProfit} />}
                badge={<Change g={g.gross} prevMonth={prevMonth} prevValue={pt?.grossProfit} />}
                sub={`Marj ${pct(t.grossProfit / t.netSales)} · kira ve personel öncesi`}
              />
              <Stat
                icon={t.netProfit < 0 ? <TrendingDown /> : <TrendingUp />}
                label="Net kâr / zarar"
                info={`Brüt kâr − indirimler − sabit giderler (reçeteye göre). Faturaya göre değer Gelir-gider tablosundan gelir; stok sayımı yoksa alınan malın tamamı gider sayılır.${changeNote(g.net)}`}
                value={<CountUp value={t.netProfit} />}
                badge={<Change g={g.net} prevMonth={prevMonth} prevValue={pt?.netProfit} />}
                tone={t.netProfit < 0 ? "bad" : "good"}
                sub={
                  d.actual.hasRevenue ? (
                    <>
                      Faturaya göre:{" "}
                      <Signed value={d.actual.profit} className="whitespace-nowrap">
                        {tl(d.actual.profit)}
                      </Signed>
                    </>
                  ) : null
                }
              />
            </>
          ) : (
            <>
              <Stat
                icon={<Receipt />}
                label="POS cirosu (KDV dahil)"
                info={g.pos !== null ? changeNote(g.pos).trim() : undefined}
                value={<CountUp value={d.info?.posRevenue ?? null} />}
                badge={<Change g={g.pos} prevMonth={prevMonth} prevValue={prev.info?.posRevenue} />}
                sub={d.info?.openDays ? `${d.info.openDays} günde` : null}
              />
              <Stat
                icon={<CalendarDays />}
                label="Günlük ortalama ciro"
                info={g.daily !== null ? changeNote(g.daily).trim() : undefined}
                value={<CountUp value={d.dailyAvg} />}
                badge={<Change g={g.daily} prevMonth={prevMonth} prevValue={prev.dailyAvg} />}
                sub="KDV dahil"
              />
              <Stat
                icon={projected < 0 ? <TrendingDown /> : <TrendingUp />}
                label="Ay sonu tahmini kâr/zarar"
                info="Bu tempoda ay sonu cirosu × son satış ayının brüt kâr oranı − aylık sabit giderler."
                value={<CountUp value={d.forecast?.projectedProfit ?? null} />}
                tone={projected < 0 ? "bad" : "good"}
                sub={
                  d.forecast ? (
                    <>
                      Tahmini ciro <span className="whitespace-nowrap">{tl(d.forecast.projectedRevenue)}</span>
                    </>
                  ) : (
                    "Ay tamamlandı"
                  )
                }
              />
            </>
          )}
          <Stat
            icon={<Target />}
            label="Başabaş günlük ciro"
            info="Zarar etmemek için gereken günlük ciro. Başabaş noktası: aylık sabit giderler ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün. KDV dahil."
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
        </div>

        {/* 2. Uyarılar + maliyet göstergesi */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
            <Suspense fallback={null}>
              <DashboardPayments />
            </Suspense>
            <DashboardAlerts items={alertItems} className="flex-1" />
          </div>
          <CostCard
            className="lg:col-span-5"
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

        {/* 3. Para nereye gitti + reçete/fatura karşılaştırması */}
        {t ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <WaterfallCard month={month} t={t} rows={waterfall} />
            <Card>
              <CardHeader
                icon={<Scale />}
                title="Reçeteye göre mi, faturaya göre mi?"
                description="Aradaki fark fire, ikram, stokta bekleyen mal ya da reçetede eksik malzemeyi gösterir."
              />
              <CardContent className="@container flex flex-1 flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
                  <Well className="p-3.5">
                    <p className="text-xs font-medium text-ink-mute">Reçeteye göre maliyet</p>
                    <p className="mt-1 text-xl font-semibold tracking-tight whitespace-nowrap text-ink tabular">{tl(t.material)}</p>
                    <p className="text-xs text-ink-mute">Maliyet oranı {pct(d.recipeCostRatio)}</p>
                  </Well>
                  <Well className="p-3.5">
                    <p className="text-xs font-medium text-ink-mute">Faturaya göre alım</p>
                    <p className="mt-1 text-xl font-semibold tracking-tight whitespace-nowrap text-ink tabular">{tl(purchases)}</p>
                    <p className="text-xs text-ink-mute">Maliyet oranı {pct(d.invoiceCostRatio)}</p>
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
            {showForecast && forecast ? (
              <ForecastCard
                className={trend.length ? "xl:col-span-4" : "xl:col-span-12"}
                month={forecastMonth}
                forecast={forecast}
                dailyAvg={current.dailyAvg}
                progress={current.breakEvenProgress}
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
              <InfoTip text="Her ay Gelir-gider tablosundaki (faturaya göre) kâr ya da zarar. Gri: o ay için veri yok. Çerçeveli parça seçili ay." />
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
              label: `${monthLabel(m.month)}: ${m.active ? `${m.profit < 0 ? "zarar" : "kâr"} ${tl(Math.abs(m.profit))}` : "veri yok"}${
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
  return (
    <Card>
      <CardHeader icon={<Wallet />} title={`${monthLabel(month)}: para nereye gitti?`} description="KDV hariç. Malzeme maliyeti reçetelere göre hesaplanır." />
      <CardContent className="flex flex-1 flex-col gap-3">
        <MoneyFlow rows={rows} netSales={t.netSales} netProfit={t.netProfit} />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl bg-panel-deep px-4 py-3">
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
}: {
  className?: string;
  month: string;
  forecast: Forecast;
  dailyAvg: number | null;
  progress: number | null;
}) {
  return (
    <Card className={className}>
      <CardHeader icon={<CalendarClock />} title={`${monthLabel(month)} gidişatı`} description={`${forecast.daysElapsed} / ${forecast.dim} gün geçti`} />
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
              label="Tahmini net kâr / zarar"
              value={
                <Signed value={forecast.projectedProfit} className="font-semibold whitespace-nowrap">
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

function CategoriesTab({ d, target }: { d: DashboardData; target: number }) {
  return (
    <CategoriesPanel
      cats={d.categories}
      target={target}
      description={`Ort. değerler menüdeki ürünlerin basit ortalamasıdır (Excel'deki gibi). ${
        d.refMonth ? `Satış ağırlıklı marj ${monthLabel(d.refMonth)} satışlarına göredir.` : "Satış verisi yok."
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
  columns: { label: string; numeric?: boolean }[];
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
        <TableWrap>
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
                    <Link href={`/panel/urunler/${r.id}`} className="inline-flex min-h-9 items-center font-medium pointer-coarse:min-h-10 text-ink hover:underline">
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

function ExpensesTab({ items, total }: { items: { name: string; amount: number }[]; total: number }) {
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
            Aylık sabit gider toplamı <span className="font-medium whitespace-nowrap text-ink tabular">{tl(total)}</span> · yüzde: toplamdaki payı
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
                    <span className="min-w-0 truncate text-ink" title={e.name}>
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

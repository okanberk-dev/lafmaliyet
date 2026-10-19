import { AlertTriangle, ArrowRight, CircleAlert, Info, TrendingDown, TrendingUp, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { HBarChart, TrendChart } from "@/components/charts";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InfoTip, PageSkeleton, Progress, Signed, Stat } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { daysInMonth, fixedForMonth } from "@/lib/calc/engine";
import { alerts, dashboard, yearTrend, type Alert } from "@/lib/calc/insights";
import { FIXED_SECTIONS } from "@/lib/constants";
import { monthLabel, monthShort, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";

export const metadata: Metadata = { title: "Panel" };

export default function DashboardPage({ searchParams }: PageProps<"/panel">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Panel" description="Yükleniyor…" />
          <PageSkeleton />
        </>
      }
    >
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

const ALERT_ICON = { danger: CircleAlert, warning: AlertTriangle, info: Info };
const ALERT_TONE = {
  danger: "border-rose-200 bg-rose-50/60 text-rose-900",
  warning: "border-amber-200 bg-amber-50/60 text-amber-900",
  info: "border-sky-200 bg-sky-50/50 text-sky-900",
};

function AlertList({ items }: { items: Alert[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader title="Dikkat edilmesi gerekenler" description="Sistem verileri otomatik kontrol eder; tıklayınca ilgili sayfaya gidersiniz." />
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {items.map((a, i) => {
          const Icon = ALERT_ICON[a.level];
          const body = (
            <div className={cn("flex h-full gap-3 rounded-xl border px-3 py-2.5", ALERT_TONE[a.level], a.href && "transition hover:brightness-[0.98]")}>
              <Icon size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="mt-0.5 text-xs opacity-80">{a.detail}</p>
              </div>
              {a.href ? <ArrowRight size={16} className="mt-0.5 ml-auto shrink-0 opacity-50" /> : null}
            </div>
          );
          return a.href ? (
            <Link key={i} href={a.href}>
              {body}
            </Link>
          ) : (
            <div key={i}>{body}</div>
          );
        })}
      </CardContent>
    </Card>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/panel">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const model = await loadModel();
  const month = resolveMonth(sp.ay, model);
  const months = availableMonths(model);
  const d = dashboard(model, month);
  const alertItems = alerts(model, month);
  const year = Number(month.slice(0, 4));
  const trend = yearTrend(model, year).filter((t) => t.active);
  const st = model.settings;

  // En son (eksik) ayın gidişatı: Excel'deki "Ekim tahmini"
  const latest = [...model.monthInfo.values()]
    .filter((m) => m.openDays && m.posRevenue)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  const current = latest && latest.month !== month ? dashboard(model, latest.month) : d;
  const forecast = current.forecast;

  const t = d.theoretical;
  const pm = model.pnlMonth(month);
  const sectionItems = (key: string) =>
    model.activeFixed
      .filter((f) => f.section === key)
      .map((f) => ({ name: f.name, v: fixedForMonth(f, st, pm.openDays, daysInMonth(month)) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => x.name)
      .join(", ");

  const waterfall = t
    ? [
        { label: "Satışlar (net ciro)", value: t.netSales, sub: "Ürün satışları ÷ (1 + KDV)", sign: 1 },
        { label: "İndirimler", value: -t.discountsNet, sub: "Yönetici indirimleri (KDV hariç)", sign: -1 },
        { label: "Malzeme + ambalaj", value: -t.material, sub: "Satılan her ürün × reçete maliyeti", sign: -1 },
        { label: "Kart / POS komisyonu", value: -t.commission, sub: `Ciro × %${num(st.komisyon * 100, 1)} × kartlı oran %${num(st.kartOrani * 100, 1)}`, sign: -1 },
        ...FIXED_SECTIONS.map((s) => ({
          label: s.label,
          value: -t.fixed[s.key],
          sub: s.key === "personel" ? `Maaş + SGK, ${sectionItems(s.key)}` : sectionItems(s.key),
          sign: -1,
        })),
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Panel"
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
            <ButtonLink href={`/api/export?ay=${month}`} variant="outline" prefetch={false}>
              Excel&apos;e aktar
            </ButtonLink>
          </>
        }
      />

      <div className="space-y-6">
        {!d.hasSales ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
            <div className="flex items-start gap-3">
              <Upload size={20} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{monthLabel(month)} ürün satışları henüz yüklenmedi</p>
                <p className="text-sm opacity-80">
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

        {/* KPI satırı */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {t ? (
            <>
              <Stat
                label="Net satış"
                info="Patron (ModPOS) ürün satışları ÷ (1 + KDV). Kasanıza kalan gerçek gelir."
                value={tl(t.netSales)}
                sub={`${tl(d.sales.revenue)} KDV dahil`}
              />
              <Stat
                label="Brüt kâr"
                info="Net satış − malzeme/ambalaj − POS komisyonu. Kira ve personel öncesi kâr."
                value={tl(t.grossProfit)}
                sub={`Marj ${pct(t.grossProfit / t.netSales)} · kira ve personel öncesi`}
              />
              <Stat
                label="Net kâr / zarar"
                info="Brüt kâr − indirimler − sabit giderler (reçeteye göre). Faturaya göre değer Gelir-gider tablosundan gelir; stok sayımı yoksa alınan malın tamamı gider sayılır."
                value={tl(t.netProfit)}
                tone={t.netProfit < 0 ? "bad" : "good"}
                icon={t.netProfit < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
                sub={d.actual.hasRevenue ? <>Faturaya göre: <Signed value={d.actual.profit}>{tl(d.actual.profit)}</Signed></> : null}
              />
            </>
          ) : (
            <>
              <Stat label="POS cirosu (KDV dahil)" value={tl(d.info?.posRevenue ?? null)} sub={d.info?.openDays ? `${d.info.openDays} günde` : null} />
              <Stat label="Günlük ortalama ciro" value={tl(d.dailyAvg)} sub="KDV dahil" />
              <Stat
                label="Ay sonu tahmini kâr/zarar"
                value={tl(d.forecast?.projectedProfit ?? null)}
                tone={(d.forecast?.projectedProfit ?? 0) < 0 ? "bad" : "good"}
                sub={d.forecast ? `Tahmini ciro ${tl(d.forecast.projectedRevenue)}` : "Ay tamamlandı"}
                info="Bu tempoda ay sonu cirosu × son satış ayının brüt kâr oranı − aylık sabit giderler."
              />
            </>
          )}
          <Stat
            label="Zarar etmemek için günlük ciro"
            info="Başabaş noktası: aylık sabit giderler ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün. KDV dahil."
            value={tl(d.breakEvenDaily)}
            sub={
              d.dailyAvg && d.breakEvenProgress !== null ? (
                <div className="space-y-1.5">
                  <span>
                    Günlük ortalama {tl(d.dailyAvg)} · başabaşa göre {pct(d.breakEvenProgress, 0)}
                  </span>
                  <Progress value={d.breakEvenProgress} tone={d.breakEvenProgress >= 1 ? "green" : d.breakEvenProgress > 0.85 ? "amber" : "red"} />
                </div>
              ) : null
            }
          />
        </div>

        <AlertList items={alertItems} />

        {t ? (
          <div className="grid gap-6 xl:grid-cols-12">
            <Card className="xl:col-span-7">
              <CardHeader
                title={`${monthLabel(month)}: para nereye gitti?`}
                description="KDV hariç. Malzeme maliyeti reçetelere göre hesaplanır."
              />
              <CardContent className="space-y-3">
                {waterfall.map((w) => {
                  const share = Math.abs(w.value) / t.netSales;
                  return (
                    <div key={w.label}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-coffee-900">
                          {w.sign < 0 ? "– " : ""}
                          {w.label}
                        </span>
                        <span className="shrink-0 font-semibold tabular text-coffee-950">
                          {tl(Math.abs(w.value))} <span className="ml-1 text-xs font-normal text-coffee-500">{pct(share, 0)}</span>
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-coffee-50">
                          <div
                            className={cn("h-full rounded-full", w.sign > 0 ? "bg-[#1baf7a]" : "bg-[#b8682a]")}
                            style={{ width: `${Math.min(100, share * 100)}%` }}
                          />
                        </div>
                      </div>
                      {w.sub ? <p className="mt-0.5 truncate text-xs text-coffee-500">{w.sub}</p> : null}
                    </div>
                  );
                })}
                <div className="mt-2 flex items-baseline justify-between rounded-xl bg-coffee-50 px-4 py-3">
                  <span className="text-sm font-semibold text-coffee-900">{monthLabel(month)} net kâr / zarar</span>
                  <Signed value={t.netProfit} className="text-lg font-semibold">
                    {tl(t.netProfit)}
                  </Signed>
                </div>
                <p className="text-xs text-coffee-500">Vergi ve tek seferlik yatırımlar hariç.</p>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2 xl:col-span-5 xl:grid-cols-1 xl:content-start">
              <Card>
                <CardHeader
                  title="Reçeteye göre mi, faturaya göre mi?"
                  description="Aradaki fark fire, ikram, stokta bekleyen mal ya da reçetede eksik malzemeyi gösterir."
                />
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-coffee-50 p-3">
                      <p className="text-xs font-medium text-coffee-600">Reçeteye göre maliyet</p>
                      <p className="mt-1 text-xl font-semibold whitespace-nowrap">{tl(t.material)}</p>
                      <p className="text-xs text-coffee-500">Maliyet oranı {pct(d.recipeCostRatio)}</p>
                    </div>
                    <div className="rounded-xl bg-coffee-50 p-3">
                      <p className="text-xs font-medium text-coffee-600">Faturaya göre alım</p>
                      <p className="mt-1 text-xl font-semibold whitespace-nowrap">{tl(model.goodsPurchases(month))}</p>
                      <p className="text-xs text-coffee-500">Maliyet oranı {pct(d.invoiceCostRatio)}</p>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-coffee-700">Fark (alınan − reçeteye göre harcanan)</span>
                    <span className="font-semibold tabular">{tl(model.goodsPurchases(month) - t.material)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-coffee-700">Kâr/zarar: reçeteye göre → faturaya göre</span>
                    <span className="font-semibold tabular">
                      <Signed value={t.netProfit}>{tl(t.netProfit)}</Signed> → <Signed value={d.actual.profit}>{tl(d.actual.profit)}</Signed>
                    </span>
                  </div>
                  {d.info?.offRevenue ? (
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-coffee-700">
                        Ödenmez / ikram <InfoTip text="Ciro dışı satışlar: malzemesi harcanıyor ama geliri yok. Tahmini maliyet = tutar ÷ (1+KDV) × ortalama maliyet oranı." />
                      </span>
                      <span className="tabular">
                        {tl(d.info.offRevenue)} <span className="text-xs text-coffee-500">(maliyet ≈ {tl((d.info.offRevenue / (1 + st.kdv)) * d.sales.avgCostRatio)})</span>
                      </span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink href={`/panel/tutarlilik?ay=${month}`} size="sm">
                      Tutarlılık kontrolü
                    </ButtonLink>
                    <ButtonLink href={`/panel/sayim?ay=${month}`} size="sm" variant="ghost">
                      Stok sayımı gir
                    </ButtonLink>
                  </div>
                </CardContent>
              </Card>

              {forecast ? (
                <Card>
                  <CardHeader
                    title={`${monthLabel(forecast === d.forecast ? month : latest!.month)} gidişatı`}
                    description={`${forecast.daysElapsed} / ${forecast.dim} gün geçti`}
                  />
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-coffee-700">Günlük ortalama ciro</span>
                      <span className="font-semibold tabular">{tl(current.dailyAvg)}</span>
                    </div>
                    {current.breakEvenProgress !== null ? (
                      <Progress value={current.breakEvenProgress} tone={current.breakEvenProgress >= 1 ? "green" : current.breakEvenProgress > 0.85 ? "amber" : "red"} />
                    ) : null}
                    <div className="flex justify-between">
                      <span className="text-coffee-700">Bu tempoyla ay sonu ciro</span>
                      <span className="tabular">{tl(forecast.projectedRevenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-coffee-700">Tahmini net kâr / zarar</span>
                      <Signed value={forecast.projectedProfit} className="font-semibold">
                        {tl(forecast.projectedProfit)}
                      </Signed>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        ) : null}

        {trend.length ? (
          <Card>
            <CardHeader
              title={`${year} aylık gelir-gider`}
              description="Gelir-gider tablosundan (faturaya göre). Kira, personel gibi aylık giderler açık gün sayısına göre bölünür."
              actions={
                <ButtonLink href={`/panel/gelir-gider?yil=${year}`} size="sm" variant="ghost">
                  Tabloyu aç <ArrowRight size={14} />
                </ButtonLink>
              }
            />
            <CardContent>
              <TrendChart
                data={trend.map((x) => ({
                  label: monthShort(x.month),
                  revenue: Math.round(x.revenueNet),
                  expenses: Math.round(x.expenses),
                  profit: Math.round(x.profit),
                }))}
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-12">
          <Card className="xl:col-span-7">
            <CardHeader
              title="Kategori bazında"
              description={`Ort. değerler menüdeki ürünlerin basit ortalamasıdır (Excel'deki gibi). Satış ağırlıklı marj ${d.refMonth ? monthLabel(d.refMonth) : ""} satışlarına göredir.`}
            />
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Kategori</TH>
                    <TH numeric>Ürün</TH>
                    <TH numeric>Ort. kâr marjı</TH>
                    <TH numeric>Ort. birim kâr</TH>
                    <TH numeric>Ort. maliyet oranı</TH>
                    <TH numeric>Satış</TH>
                    <TH numeric>Satış ağırlıklı marj</TH>
                  </tr>
                </THead>
                <tbody>
                  {d.categories.map((c) => (
                    <TR key={c.categoryId}>
                      <TD>
                        <Link href={`/panel/urunler?kategori=${c.categoryId}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                      </TD>
                      <TD numeric>{c.count}</TD>
                      <TD numeric>{pct(c.avgMargin)}</TD>
                      <TD numeric>{tl(c.avgUnitProfit, 2)}</TD>
                      <TD numeric className={cn(c.avgCostRatio > st.hedefMaliyet + 0.1 && "text-rose-700", c.avgCostRatio > st.hedefMaliyet && c.avgCostRatio <= st.hedefMaliyet + 0.1 && "text-amber-700")}>
                        {pct(c.avgCostRatio)}
                      </TD>
                      <TD numeric>{num(c.soldQty)}</TD>
                      <TD numeric>{c.soldQty ? pct(c.weightedMargin) : "–"}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
          <Card className="xl:col-span-5">
            <CardHeader title="Kategoriye göre ortalama kâr marjı" />
            <CardContent>
              <HBarChart
                data={d.categories.map((c) => ({ label: c.name, value: c.avgMargin }))}
                format="percent"
                valueLabel="Ort. kâr marjı"
              />
            </CardContent>
          </Card>
        </div>

        {d.hasSales ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <ProductList
              title="En çok kâr getiren"
              description="Birim kâr × satış adedi"
              rows={d.topProducts.map((x) => ({ id: x.p.product.id, name: x.p.key, value: tl(x.profit), sub: `${num(x.qty)} adet` }))}
            />
            <ProductList
              title="En çok satan"
              description="Adet"
              rows={d.bestSellers.map((x) => ({ id: x.p.product.id, name: x.p.key, value: `${num(x.qty)} adet`, sub: `marj ${pct(x.p.margin)}` }))}
            />
            <ProductList
              title="Satılanlar içinde en düşük marj"
              description="Fiyatını gözden geçirin"
              rows={d.weakest.map((x) => ({
                id: x.p.product.id,
                name: x.p.key,
                value: pct(x.p.margin),
                sub: `önerilen ${tl(x.p.suggestedPrice)}`,
                status: x.p.status,
              }))}
            />
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Fiyat kontrolü"
              description={`Hedef maliyet oranı %${num(st.hedefMaliyet * 100)}. Önerilen fiyat maliyetin hedef orana denk geldiği, 5 ₺'ye yuvarlanmış fiyattır.`}
            />
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl font-semibold text-rose-700">{d.lowProfitCount}</span>
                <span className="text-sm text-coffee-700">ürün &quot;Düşük kâr&quot;</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-semibold text-amber-700">{d.attentionCount}</span>
                <span className="text-sm text-coffee-700">ürün &quot;Dikkat&quot;</span>
              </div>
              <ButtonLink href="/panel/urunler?durum=Düşük kâr" size="sm" className="ml-auto">
                Ürünleri gör <ArrowRight size={14} />
              </ButtonLink>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="En büyük aylık gider kalemleri" description={`Aylık sabit gider toplamı ${tl(d.fixedStandardTotal)}`} />
            <CardContent className="space-y-2">
              {d.topExpenses.slice(0, 6).map((e) => (
                <div key={e.name} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 truncate text-coffee-800">{e.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-coffee-50">
                    <div className="h-full rounded-full bg-[#b8682a]" style={{ width: `${(e.amount / d.topExpenses[0].amount) * 100}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right font-medium tabular">{tl(e.amount)}</span>
                </div>
              ))}
              <div className="pt-1">
                <ButtonLink href="/panel/giderler" size="sm" variant="ghost">
                  Sabit giderler <ArrowRight size={14} />
                </ButtonLink>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function ProductList({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: { id: number; name: string; value: string; sub: string; status?: Parameters<typeof StatusBadge>[0]["status"] }[];
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <ul className="divide-y divide-coffee-50">
        {rows.map((r, i) => (
          <li key={r.id}>
            <Link href={`/panel/urunler/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-coffee-50/60">
              <span className="w-5 text-xs font-semibold text-coffee-400">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-coffee-950">{r.name.replace("|", " · ")}</span>
                <span className="text-xs text-coffee-500">{r.sub}</span>
              </span>
              {r.status ? <StatusBadge status={r.status} /> : null}
              <span className="text-sm font-semibold tabular">{r.value}</span>
            </Link>
          </li>
        ))}
        {!rows.length ? <li className="px-5 py-4 text-sm text-coffee-500">Veri yok</li> : null}
      </ul>
    </Card>
  );
}

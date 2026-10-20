import { Banknote, ShoppingBag, TrendingUp, Unlink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { GrowthPill, PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { salesBreakdowns } from "./breakdowns";
import { CountUp, ImportCard, MatchCoverage, MonthInfoForm, SalesTable, type ProductOption, type SalesRow } from "./sales-client";

export const metadata: Metadata = { title: "Satışlar" };

const DESCRIPTION =
  "Patron (ModPOS) ürün satış raporu. Her POS ürünü menüdeki bir ürünle eşleştirilir; eşleştirmeler hatırlanır ve sonraki aylarda otomatik uygulanır.";

export default function SalesPage({ searchParams }: PageProps<"/panel/satislar">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Satışlar" eyebrow="Para" excel="Satış Raporu" description={DESCRIPTION} />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <SalesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SalesContent({ searchParams }: { searchParams: PageProps<"/panel/satislar">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const [model, mappings] = await Promise.all([loadModel(), getDb().select().from(s.posMappings)]);
  const month = resolveMonth(sp.ay, model);
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);

  const products: ProductOption[] = model.products.map((p) => ({
    id: p.product.id,
    name: p.product.name,
    size: p.product.size,
    category: p.category?.name ?? "",
    cost: p.cost,
    price: p.price,
    active: p.product.active,
  }));
  const rows: SalesRow[] = sales.lines.map((l) => ({
    id: l.line.id,
    posName: l.line.posName,
    qty: l.line.qty,
    revenue: l.line.revenue,
    productId: l.line.productId,
    productLabel: l.product ? `${l.product.product.name} · ${l.product.product.size}` : null,
    isService: l.line.isService,
    matched: l.matched,
    unitCost: l.unitCost,
    net: l.net,
    cost: l.cost,
    commission: l.commission,
    grossProfit: l.grossProfit,
    margin: l.margin,
    note: l.line.note,
    avgPrice: l.line.qty ? l.line.revenue / l.line.qty : 0,
    menuPrice: l.product?.price ?? null,
  }));
  const unmatched = sales.unmatched.length;
  const mappingList = mappings.map((m) => ({ posName: m.posName, productId: m.productId, isService: m.isService, updatedAt: m.updatedAt }));
  const infoValues = {
    openDays: info?.openDays ?? null,
    posRevenue: info?.posRevenue ?? null,
    discounts: info?.discounts ?? 0,
    offRevenue: info?.offRevenue ?? 0,
    note: info?.note ?? null,
  };
  const hasInfo =
    infoValues.openDays !== null || infoValues.posRevenue !== null || !!infoValues.discounts || !!infoValues.offRevenue || !!infoValues.note;
  // Bir ürüne ya da HİZMET'e bağlanmış satırların ciro payı (kalanın maliyeti tahmini)
  const assignedRevenue = rows.reduce((a, r) => a + (r.matched || r.isService ? r.revenue : 0), 0);
  const coverage = sales.revenue ? assignedRevenue / sales.revenue : 0;
  // Kartların dökümü (karta dokununca açılan pencere): aynı ay satırlarından, yeni sorgu yok
  const breakdown = salesBreakdowns(sales, model.settings, month);
  const label = monthLabel(month);

  return (
    <>
      <PageHeader
        title="Satışlar"
        eyebrow="Para"
        excel="Satış Raporu"
        description={DESCRIPTION}
        actions={<MonthPicker months={availableMonths(model)} value={month} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title={`${label} cirosu`}
          description="Satış raporundaki ciro (KDV dahil), kategori kategori, ürün ürün. Eşleşmeyen ve HİZMET satırları ayrı bölümde; kaleme dokununca tabloda açılır."
          groups={breakdown.revenue}
          total={sales.revenue}
          totalLabel="Ciro (KDV dahil)"
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<Banknote />}
            label="Ciro (KDV dahil)"
            value={<CountUp value={sales.revenue} />}
            sub={`Net ${tl(sales.net)} · POS komisyonu ${tl(sales.commission)}`}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${label} brüt kâr`}
          description={`Net ciro − malzeme + ambalaj − POS komisyonu (KDV hariç, kira ve personel öncesi).${
            sales.net ? ` Marj ${pct(sales.margin)} (brüt kâr ÷ net ciro), maliyet oranı ${pct(sales.cost / sales.net)}.` : ""
          }`}
          groups={breakdown.grossProfit}
          total={sales.grossProfit}
          totalLabel="Brüt kâr"
          order="given"
          shares={false}
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<TrendingUp />}
            label="Brüt kâr"
            value={<CountUp value={sales.grossProfit} />}
            tone={sales.grossProfit < 0 ? "bad" : "default"}
            badge={<GrowthPill value={sales.margin}>Marj {pct(sales.margin)}</GrowthPill>}
            sub={
              <>
                Kira ve personel öncesi
                <span className="block">
                  Malzeme + ambalaj {tl(sales.cost)}
                  {sales.net ? ` · maliyet oranı ${pct(sales.cost / sales.net)}` : null}
                </span>
              </>
            }
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${label} satılan ürün`}
          description={`${num(rows.length)} POS kalemi, kategori kategori, ürün ürün (adet). HİZMET satırları da sayılır; kaleme dokununca tabloda açılır.`}
          groups={breakdown.qty}
          total={sales.qty}
          totalLabel="Satılan ürün"
          unit="count"
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<ShoppingBag />}
            label="Satılan ürün"
            value={<CountUp value={sales.qty} kind="num" />}
            suffix="adet"
            sub={`${num(rows.length)} POS kalemi`}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${label} eşleşmeyen ürünler`}
          description="Menüdeki bir ürüne ya da HİZMET'e bağlanmamış POS kalemleri. Maliyetleri, eşleşenlerin ortalama maliyet oranıyla tahmin edilir."
          groups={breakdown.unmatched}
          total={unmatched}
          totalLabel="Eşleşmeyen ürün"
          totalDisplay={`${num(unmatched)} kalem`}
          order="given"
          shares={false}
          unit="count"
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<Unlink />}
            label="Eşleşmeyen ürün"
            value={<CountUp value={unmatched} kind="num" />}
            tone={unmatched ? "warn" : "good"}
            info="Reçetesi olmayan ürünlere eşleşenlerin ortalama maliyet oranı uygulanır (Excel'deki gibi)."
            sub={
              <>
                Ort. maliyet oranı {pct(sales.avgCostRatio)}
                {unmatched ? (
                  // Kartın döküm düğmesinin üstünde kalır (konumlu): dokununca doğrudan tabloya iner
                  <Link
                    href={`/panel/satislar?ay=${month}&durum=eslesmeyen#satirlar`}
                    className="relative flex w-fit items-center font-medium text-warn underline-offset-2 hover:underline pointer-coarse:min-h-11"
                  >
                    Eşleştirmeye git →
                  </Link>
                ) : null}
              </>
            }
          >
            {rows.length ? <MatchCoverage share={coverage} /> : null}
          </Stat>
        </StatBreakdown>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <ImportCard
          className="xl:col-span-7"
          month={month}
          label={monthLabel(month)}
          lineCount={rows.length}
          mappings={mappingList}
          products={products}
          hasInfo={hasInfo}
        />
        <MonthInfoForm
          // Ay bilgisi başka yerden değişince (Ayı temizle, Gelir-gider) form yeni değerlerle açılsın
          key={`${month}|${JSON.stringify(infoValues)}`}
          className="xl:col-span-5"
          month={month}
          label={monthLabel(month)}
          info={infoValues}
          listTotal={sales.revenue}
          currentMonth={model.currentMonth}
        />
      </div>

      <div className="mt-4">
        {/* Süzgeçler (?durum=eslesmeyen, ?ara, ?sirala) adreste; tablo istemcide okur, sunucuya istek gitmez */}
        <SalesTable
          rows={rows}
          products={products}
          mappings={mappingList}
          month={month}
          totals={{
            qty: sales.qty,
            revenue: sales.revenue,
            net: sales.net,
            cost: sales.cost,
            commission: sales.commission,
            grossProfit: sales.grossProfit,
            margin: sales.margin,
          }}
        />
      </div>
    </>
  );
}

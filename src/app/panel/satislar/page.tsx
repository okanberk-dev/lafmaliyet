import { Banknote, ShoppingBag, TrendingUp, Unlink } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { GrowthPill, PageSkeleton, Stat } from "@/components/ui/misc";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { CountUp, ImportCard, MatchCoverage, MonthInfoForm, SalesTable, type ProductOption, type SalesFilter, type SalesRow } from "./sales-client";

export const metadata: Metadata = { title: "Satışlar" };

const DESCRIPTION =
  "Patron (ModPOS) ürün satış raporu. Her POS ürünü menüdeki bir ürünle eşleştirilir; eşleştirmeler hatırlanır ve sonraki aylarda otomatik uygulanır.";

/** ?filtre= değeri → tablo filtresi */
const FILTERS = new Map<string, SalesFilter>([
  ["eslesmeyen", "unmatched"],
  ["eslesen", "matched"],
  ["hizmet", "service"],
]);

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
  const filtre = Array.isArray(sp.filtre) ? sp.filtre[0] : sp.filtre;

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
  // Bir ürüne ya da HİZMET'e bağlanmış satırların ciro payı (kalanın maliyeti tahmini)
  const assignedRevenue = rows.reduce((a, r) => a + (r.matched || r.isService ? r.revenue : 0), 0);
  const coverage = sales.revenue ? assignedRevenue / sales.revenue : 0;

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
        <Stat
          icon={<Banknote />}
          label="Ciro (KDV dahil)"
          value={<CountUp value={sales.revenue} />}
          sub={`Net ${tl(sales.net)} · POS komisyonu ${tl(sales.commission)}`}
        />
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
        <Stat
          icon={<ShoppingBag />}
          label="Satılan ürün"
          value={<CountUp value={sales.qty} kind="num" />}
          suffix="adet"
          sub={`${num(rows.length)} POS kalemi`}
        />
        <Stat
          icon={<Unlink />}
          label="Eşleşmeyen ürün"
          value={<CountUp value={unmatched} kind="num" />}
          tone={unmatched ? "warn" : "good"}
          info="Reçetesi olmayan ürünlere eşleşenlerin ortalama maliyet oranı uygulanır (Excel'deki gibi)."
          sub={`Ort. maliyet oranı ${pct(sales.avgCostRatio)}`}
        >
          {rows.length ? <MatchCoverage share={coverage} /> : null}
        </Stat>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <ImportCard
          className="xl:col-span-7"
          month={month}
          label={monthLabel(month)}
          lineCount={rows.length}
          mappings={mappings.map((m) => ({
            posName: m.posName,
            productId: m.productId,
            isService: m.isService,
          }))}
          products={products}
        />
        <MonthInfoForm
          key={month}
          className="xl:col-span-5"
          month={month}
          label={monthLabel(month)}
          info={{
            openDays: info?.openDays ?? null,
            posRevenue: info?.posRevenue ?? null,
            discounts: info?.discounts ?? 0,
            offRevenue: info?.offRevenue ?? 0,
            note: info?.note ?? null,
          }}
          listTotal={sales.revenue}
        />
      </div>

      <div className="mt-4">
        <SalesTable
          key={filtre ?? ""}
          rows={rows}
          products={products}
          month={month}
          initialFilter={(filtre && FILTERS.get(filtre)) || "all"}
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

import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { ImportButton, MonthInfoForm, SalesTable, type ProductOption, type SalesRow } from "./sales-client";

export const metadata: Metadata = { title: "Satışlar" };

export default function SalesPage({ searchParams }: PageProps<"/panel/satislar">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Satışlar" excel="Satış Raporu" />
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

  return (
    <>
      <PageHeader
        title="Satışlar"
        excel="Satış Raporu"
        description="Patron (ModPOS) ürün satış raporu. Her POS ürünü menüdeki bir ürünle eşleştirilir; eşleştirmeler hatırlanır ve sonraki aylarda otomatik uygulanır."
        actions={
          <>
            <MonthPicker months={availableMonths(model)} value={month} />
            <ImportButton month={month} hasLines={rows.length > 0} mappings={mappings.map((m) => ({ posName: m.posName, productId: m.productId, isService: m.isService }))} products={products} />
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <MonthInfoForm
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
        <div className="grid grid-cols-2 gap-3 self-start xl:col-span-8 xl:grid-cols-3">
          <Stat label="Satılan ürün" value={`${num(sales.qty)} adet`} sub={`${rows.length} POS kalemi`} />
          <Stat label="Ciro (KDV dahil)" value={tl(sales.revenue)} sub={`Net ${tl(sales.net)}`} />
          <Stat label="Malzeme + ambalaj" value={tl(sales.cost)} sub={sales.net ? `Maliyet oranı ${pct(sales.cost / sales.net)}` : null} />
          <Stat label="POS komisyonu" value={tl(sales.commission)} />
          <Stat label="Brüt kâr" value={tl(sales.grossProfit)} sub={`Marj ${pct(sales.margin)} · kira ve personel öncesi`} tone={sales.grossProfit < 0 ? "bad" : "default"} />
          <Stat
            label="Eşleşmeyen ürün"
            value={num(sales.unmatched.length)}
            tone={sales.unmatched.length ? "warn" : "good"}
            info="Reçetesi olmayan ürünlere eşleşenlerin ortalama maliyet oranı uygulanır (Excel'deki gibi)."
            sub={`Ort. maliyet oranı ${pct(sales.avgCostRatio)}`}
          />
        </div>
      </div>

      <div className="mt-6">
        <SalesTable rows={rows} products={products} month={month} initialFilter={filtre === "eslesmeyen" ? "unmatched" : "all"} totals={{ qty: sales.qty, revenue: sales.revenue, net: sales.net, cost: sales.cost, commission: sales.commission, grossProfit: sales.grossProfit, margin: sales.margin }} />
      </div>
    </>
  );
}

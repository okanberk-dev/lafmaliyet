import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";

import { NewProductButton } from "./new-product";
import { ProductsTable, type ProductRow } from "./products-table";

export const metadata: Metadata = { title: "Ürünler & kârlılık" };

export default function ProductsPage({ searchParams }: PageProps<"/panel/urunler">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Ürünler & kârlılık" excel="Ürün Kârlılık" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <ProductsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ProductsContent({ searchParams }: { searchParams: PageProps<"/panel/urunler">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const model = await loadModel();
  const month = resolveMonth(sp.ay, model);
  const sold = model.soldByProduct(month);
  const st = model.settings;

  const rows: ProductRow[] = model.products.map((p) => {
    const qty = sold.get(p.product.id) ?? 0;
    return {
      id: p.product.id,
      name: p.product.name,
      size: p.product.size,
      categoryId: p.product.categoryId,
      category: p.category?.name ?? "—",
      note: p.product.note,
      active: p.product.active,
      price: p.price,
      net: p.net,
      commission: p.commission,
      cost: p.cost,
      totalCost: p.totalCost,
      unitProfit: p.unitProfit,
      margin: p.margin,
      costRatio: p.costRatio,
      suggestedPrice: p.suggestedPrice,
      status: p.status,
      fireRate: p.fireRate,
      fireOverridden: p.fireOverridden,
      soldQty: qty,
      monthProfit: p.unitProfit * qty,
      monthNet: p.net * qty,
      lineCount: p.lines.length,
      hasEstimate: p.lines.some((l) => l.ingredient?.isEstimate),
    };
  });

  const active = rows.filter((r) => r.active);
  const soldRows = active.filter((r) => r.soldQty > 0);
  const totalProfit = soldRows.reduce((a, r) => a + r.monthProfit, 0);
  const totalNet = soldRows.reduce((a, r) => a + r.monthNet, 0);

  const kategori = Array.isArray(sp.kategori) ? sp.kategori[0] : sp.kategori;
  const durum = Array.isArray(sp.durum) ? sp.durum[0] : sp.durum;

  return (
    <>
      <PageHeader
        title="Ürünler & kârlılık"
        excel="Ürün Kârlılık + Reçete Kartları"
        description="Her ürün ve boy için satış fiyatı, maliyet, birim kâr, kâr marjı ve önerilen fiyat. Ürün adına tıklayınca reçete kartı açılır."
        actions={
          <>
            <MonthPicker months={availableMonths(model)} value={month} />
            <NewProductButton categories={model.categories.map((c) => ({ id: c.id, name: c.name }))} products={rows.map((r) => ({ id: r.id, label: `${r.name} · ${r.size}` }))} />
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Menüdeki ürün" value={num(active.length)} sub={`${model.categories.length} kategori`} />
        <Stat
          label="İyi / Dikkat / Düşük kâr"
          value={
            <span>
              <span className="text-emerald-700">{active.filter((r) => r.status === "İyi").length}</span>
              <span className="text-coffee-300"> / </span>
              <span className="text-amber-700">{active.filter((r) => r.status === "Dikkat").length}</span>
              <span className="text-coffee-300"> / </span>
              <span className="text-rose-700">{active.filter((r) => r.status === "Düşük kâr").length}</span>
            </span>
          }
          sub={`Hedef maliyet oranı %${num(st.hedefMaliyet * 100)}`}
        />
        <Stat label={`${monthLabel(month)} satılan çeşit`} value={num(soldRows.length)} sub={`${num(soldRows.reduce((a, r) => a + r.soldQty, 0))} adet`} />
        <Stat
          label={`${monthLabel(month)} brüt kâr (eşleşen ürünler)`}
          value={tl(totalProfit)}
          sub={totalNet ? `Ağırlıklı marj ${pct(totalProfit / totalNet)}` : "Satış yok"}
        />
      </div>
      <ProductsTable
        rows={rows}
        categories={model.categories.map((c) => ({ id: c.id, name: c.name }))}
        monthLabel={monthLabel(month)}
        target={st.hedefMaliyet}
        initialCategory={kategori ? Number(kategori) : null}
        initialStatus={durum ?? null}
      />
    </>
  );
}

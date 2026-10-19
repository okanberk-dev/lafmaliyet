import { Coffee, ShoppingBag, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { monthLabel, num, pct } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";

import { NewProductButton } from "./new-product";
import { CountUp, ProductsTable, StatusShare, type ProductRow } from "./products-table";

export const metadata: Metadata = { title: "Ürünler & kârlılık" };

const EXCEL = "Ürün Kârlılık + Reçete Kartları";

export default function ProductsPage({ searchParams }: PageProps<"/panel/urunler">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Ürünler & kârlılık" eyebrow="Menü" excel={EXCEL} />
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
  const count = (s: ProductRow["status"]) => active.filter((r) => r.status === s).length;
  const good = count("İyi");
  const warn = count("Dikkat");
  const low = count("Düşük kâr");
  const noRecipe = count("Reçete yok");
  const categories = model.categories.map((c) => ({ id: c.id, name: c.name }));
  const ml = monthLabel(month);
  const target = num(st.hedefMaliyet * 100);

  return (
    <>
      <PageHeader
        eyebrow="Menü"
        title="Ürünler & kârlılık"
        excel={EXCEL}
        description="Her ürün ve boy için satış fiyatı, maliyet, birim kâr, kâr marjı ve önerilen fiyat. Ürün adına tıklayınca reçete kartı açılır."
        actions={
          <>
            <MonthPicker months={availableMonths(model)} value={month} />
            <NewProductButton
              categories={categories}
              products={rows.map((r) => ({
                id: r.id,
                name: r.name,
                size: r.size,
                label: `${r.name} · ${r.size}`,
                categoryId: r.categoryId,
                active: r.active,
                price: r.price,
              }))}
            />
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Coffee />} label="Menüdeki ürün" value={<CountUp value={active.length} />} sub={`${num(model.categories.length)} kategori`} />
        <Stat
          icon={<Target />}
          label="Hedefin dışında"
          value={<CountUp value={warn + low} />}
          tone={low ? "bad" : warn ? "warn" : "good"}
          info={`Hedef maliyet oranı %${target}. İyi = hedefin altında, Dikkat = hedefin 10 puan üstüne kadar, Düşük kâr = daha fazlası.`}
          sub={`Hedef maliyet oranı %${target}`}
        >
          <StatusShare
            parts={[
              { status: "İyi", count: good },
              { status: "Dikkat", count: warn },
              { status: "Düşük kâr", count: low },
              { status: "Reçete yok", count: noRecipe },
            ]}
          />
        </Stat>
        <Stat
          icon={<ShoppingBag />}
          label={`${ml} satılan çeşit`}
          value={<CountUp value={soldRows.length} />}
          sub={`${num(soldRows.reduce((a, r) => a + r.soldQty, 0))} adet`}
        />
        <Stat
          icon={<TrendingUp />}
          label={`${ml} brüt kâr`}
          value={<CountUp value={totalProfit} suffix=" ₺" />}
          tone={totalProfit < 0 ? "bad" : "default"}
          info="Eşleşen ürünler: satış raporunda bir ürünle eşleşen satırların birim kâr × adet toplamı. Eşleşmeyen satırlar dahil değildir."
          sub={totalNet ? `Ağırlıklı marj ${pct(totalProfit / totalNet)}` : "Satış yok"}
        />
      </div>
      {/* Süzgeçler (?ara, ?kategori, ?durum, ?pasif, ?sira) tablonun içinde adresten okunur; ⌘K paleti ve
          genel bakış bağlantıları aynı adları kullanır. Sunucuya yeniden gidilmez. */}
      <ProductsTable rows={rows} categories={categories} monthLabel={ml} target={st.hedefMaliyet} />
    </>
  );
}

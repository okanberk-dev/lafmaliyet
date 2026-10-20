import { Coffee, ShoppingBag, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { monthLabel, num, pct } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";

import { menuAverages } from "./logic";
import { NewProductButton } from "./new-product";
import { PriceImpactPanel } from "./price-impact-panel";
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
  // Hammadde zamları (son 30 gün) ve kârı düşen ürünler; genel bakış, zil ve sabah e-postası buraya getirir
  const prices = await loadPriceAlerts(model).catch(() => null);
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
  // Excel Ürün Kârlılık satır 134: menünün basit ortalaması (her ürün bir oy)
  const avg = menuAverages(active);

  return (
    <>
      <PageHeader
        eyebrow="Menü"
        title="Ürünler & kârlılık"
        excel={EXCEL}
        description={
          <>
            Her ürün ve boy için satış fiyatı, maliyet, birim kâr, kâr marjı ve önerilen fiyat.{" "}
            <span className="pointer-coarse:hidden">Ürün adına tıklayınca reçete kartı açılır.</span>
            <span className="hidden pointer-coarse:inline">Ürüne dokununca reçete kartı açılır.</span>
          </>
        }
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
                fireOverride: r.fireOverridden ? r.fireRate : null,
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
          info={`Hedef maliyet oranı %${target}. İyi = hedefin altında, Dikkat = hedefin 10 puan üstüne kadar, Düşük kâr = daha fazlası. Menü ortalaması: maliyet oranı ${pct(avg.costRatio)}, kâr marjı ${pct(avg.margin)} (Excel'deki ORTALAMA satırı, her ürün bir oy).`}
          sub={`Hedef %${target} · menü ort. ${pct(avg.costRatio)}`}
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
          info={`Eşleşen ürünler: satış raporunda bir ürünle eşleşen satırların birim kâr × adet toplamı. Eşleşmeyen satırlar dahil değildir. Ağırlıklı marj = brüt kâr ÷ net ciro (çok satan ürün daha çok sayılır); menünün basit ortalama marjı ${pct(avg.margin)}.`}
          sub={totalNet ? `Ağırlıklı marj ${pct(totalProfit / totalNet)}` : "Satış yok"}
        />
      </div>
      {prices && prices.impacts.length ? <PriceImpactPanel changes={prices.changes} impacts={prices.impacts} target={st.hedefMaliyet} month={month} /> : null}
      {/* Süzgeçler (?ara, ?kategori, ?boy, ?durum, ?pasif, ?sirala, ?goster) tablonun içinde adresten okunur; ⌘K
          paleti ve genel bakış bağlantıları aynı adları kullanır. Sunucuya yeniden gidilmez. */}
      <ProductsTable rows={rows} categories={categories} month={month} monthLabel={ml} target={st.hedefMaliyet} />
    </>
  );
}

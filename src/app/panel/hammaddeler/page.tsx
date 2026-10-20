import { asc, count } from "drizzle-orm";
import { Droplets, Package, TriangleAlert, Unlink } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { latestSalesMonth } from "@/lib/calc/insights";
import { num, pct } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { waterSource } from "../ayarlar/water-text";

import { sortCategories } from "./categories";
import { CountUp, IngredientsClient, NewIngredientButton, type IngredientRow } from "./ingredients-client";

export const metadata: Metadata = { title: "Hammaddeler" };

export default function IngredientsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Hammaddeler" eyebrow="Menü" excel="Hammaddeler" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <IngredientsContent />
    </Suspense>
  );
}

async function IngredientsContent() {
  await requireAdmin();
  const db = getDb();
  const [model, history, links] = await Promise.all([
    loadModel(),
    db.select().from(s.ingredientPrices).orderBy(asc(s.ingredientPrices.changedAt), asc(s.ingredientPrices.id)),
    db.select({ id: s.parasutProductLinks.ingredientId, n: count() }).from(s.parasutProductLinks).groupBy(s.parasutProductLinks.ingredientId),
  ]);
  const usageMonth = latestSalesMonth(model);
  const usage = usageMonth ? model.ingredientUsage(usageMonth) : new Map<number, number>();
  const histBy = new Map<number, IngredientRow["history"]>();
  for (const h of history) {
    const list = histBy.get(h.ingredientId) ?? [];
    list.push({ at: h.changedAt.toISOString(), price: h.packagePrice, size: h.packageSize, by: h.changedBy, note: h.note });
    histBy.set(h.ingredientId, list);
  }
  // Silmeyi engelleyen geçmiş: sayım, alım miktarı, Paraşüt eşleştirmesi (silinirse geçmiş ayların stok değeri değişir)
  const tally = (ids: number[]) => {
    const m = new Map<number, number>();
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const countsBy = tally(model.ds.stockCounts.map((c) => c.ingredientId));
  const purchasesBy = tally(model.ds.purchaseQuantities.map((p) => p.ingredientId));
  const linksBy = new Map(links.map((l) => [l.id, l.n]));

  const rows: IngredientRow[] = model.ds.ingredients.map((i) => ({
    ...i,
    unitCost: model.unitCost.get(i.id) ?? 0,
    usedIn: (model.usedIn.get(i.id) ?? []).map((pid) => {
      const p = model.productById.get(pid);
      return { id: pid, label: p ? `${p.name} · ${p.size}` : `#${pid}` };
    }),
    monthUsage: usage.get(i.id) ?? 0,
    history: histBy.get(i.id) ?? [],
    deps: { counts: countsBy.get(i.id) ?? 0, purchases: purchasesBy.get(i.id) ?? 0, links: linksBy.get(i.id) ?? 0 },
  }));

  // Süzgeçler (?ara, ?durum, ?kategori, ?sirala) istemcide adresten okunur; ⌘K paleti ?ara=<ad> ile gönderir
  const active = rows.filter((r) => r.active);
  const categories = sortCategories(rows.map((r) => r.category));
  const estimates = active.filter((r) => r.isEstimate).length;
  const unused = active.filter((r) => !r.usedIn.length).length;

  return (
    <>
      <PageHeader
        eyebrow="Menü"
        title="Hammaddeler"
        excel="Hammaddeler"
        description="Faturalardan gelen paket fiyatları (KDV hariç, iskonto düşülmüş). Paket fiyatı değişince bütün ürün maliyetleri kendiliğinden güncellenir, fiyat geçmişi saklanır."
        actions={<NewIngredientButton categories={categories} rows={rows} />}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Package />}
          label="Hammadde"
          value={<CountUp value={active.length} />}
          sub={`${num(new Set(active.map((r) => r.category)).size)} kategori`}
        />
        <Stat
          icon={<TriangleAlert />}
          label="Tahmini değer"
          value={<CountUp value={estimates} />}
          tone={estimates ? "warn" : "good"}
          badge={
            active.length ? (
              <Badge tone={estimates ? "amber" : "green"} title="Aktif malzemeler içindeki payı">
                {pct(estimates / active.length, 0)}
              </Badge>
            ) : null
          }
          sub="Varsayımı doğrulanmalı (notuna bakın)"
        />
        <Stat icon={<Unlink />} label="Hiçbir reçetede yok" value={<CountUp value={unused} />} sub="Reçeteye eklenmesi gerekebilir" />
        <Stat
          icon={<Droplets />}
          label="Su + buz birim maliyeti"
          value={<CountUp value={model.water.perLiter} digits={4} suffix=" ₺" />}
          suffix="/L"
          tone={model.water.reason === "no-usage" ? "warn" : "default"}
          sub={<span title={waterSource(model.water)}>{waterSource(model.water, true)}</span>}
          info={`${waterSource(model.water)}. Hesap: Gelir-gider tablosundaki SU GİDERİ ÷ reçetelere göre o ay harcanan su + buz (litre); ürün satış listesi olan en son ayın faturası kullanılır.`}
        />
      </div>
      <IngredientsClient rows={rows} categories={categories} />
    </>
  );
}

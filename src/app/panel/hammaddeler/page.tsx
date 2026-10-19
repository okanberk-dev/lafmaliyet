import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { num, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { IngredientsClient, type IngredientRow } from "./ingredients-client";

export const metadata: Metadata = { title: "Hammaddeler" };

export default function IngredientsPage({ searchParams }: PageProps<"/panel/hammaddeler">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Hammaddeler" excel="Hammaddeler" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <IngredientsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function IngredientsContent({ searchParams }: { searchParams: PageProps<"/panel/hammaddeler">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const [model, history] = await Promise.all([
    loadModel(),
    getDb().select().from(s.ingredientPrices).orderBy(asc(s.ingredientPrices.changedAt), asc(s.ingredientPrices.id)),
  ]);
  const usage = model.salesMonths.length ? model.ingredientUsage(model.salesMonths[model.salesMonths.length - 1]) : new Map<number, number>();
  const histBy = new Map<number, { at: string; price: number; size: number; by: string | null }[]>();
  for (const h of history) {
    const list = histBy.get(h.ingredientId) ?? [];
    list.push({ at: h.changedAt.toISOString(), price: h.packagePrice, size: h.packageSize, by: h.changedBy });
    histBy.set(h.ingredientId, list);
  }

  const rows: IngredientRow[] = model.ds.ingredients.map((i) => ({
    ...i,
    unitCost: model.unitCost.get(i.id) ?? 0,
    usedIn: (model.usedIn.get(i.id) ?? []).map((pid) => {
      const p = model.productById.get(pid);
      return { id: pid, label: p ? `${p.name} · ${p.size}` : `#${pid}` };
    }),
    monthUsage: usage.get(i.id) ?? 0,
    history: histBy.get(i.id) ?? [],
  }));

  const filtre = Array.isArray(sp.filtre) ? sp.filtre[0] : sp.filtre;
  const active = rows.filter((r) => r.active);

  return (
    <>
      <PageHeader
        title="Hammaddeler"
        excel="Hammaddeler"
        description="Faturalardan gelen paket fiyatları (KDV hariç, iskonto düşülmüş). Paket fiyatını değiştirdiğinizde bütün ürün maliyetleri kendiliğinden güncellenir ve fiyat geçmişi saklanır."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hammadde" value={num(active.length)} sub={`${new Set(active.map((r) => r.category)).size} kategori`} />
        <Stat label="Tahmini fiyat" value={num(active.filter((r) => r.isEstimate).length)} tone={active.some((r) => r.isEstimate) ? "warn" : "good"} sub="Faturada bulunamayanlar" />
        <Stat label="Hiçbir reçetede yok" value={num(active.filter((r) => !r.usedIn.length).length)} sub="Reçeteye eklenmesi gerekebilir" />
        <Stat
          label="Su + buz birim maliyeti"
          value={`${tl(model.water.perLiter, 2)}/L`}
          sub={model.water.month ? `${model.water.month} su faturasından` : model.settings.suBirimLTOverride !== null ? "Ayarlar'dan elle" : "Su faturası girilmedi"}
          info="Gelir-gider tablosundaki SU GİDERİ ÷ reçetelere göre o ay harcanan su + buz (litre)."
        />
      </div>
      <IngredientsClient rows={rows} initialFilter={filtre ?? null} />
    </>
  );
}

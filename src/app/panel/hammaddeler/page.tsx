import { asc } from "drizzle-orm";
import { Droplets, Package, TriangleAlert, Unlink } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { num, pct } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { sortCategories } from "./categories";
import { CountUp, IngredientsClient, NewIngredientButton, type IngredientRow } from "./ingredients-client";

export const metadata: Metadata = { title: "Hammaddeler" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function IngredientsPage({ searchParams }: PageProps<"/panel/hammaddeler">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Hammaddeler" eyebrow="Menü" excel="Hammaddeler" />
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

  const filtre = first(sp.filtre);
  // ⌘K komut paleti /panel/hammaddeler?ara=<ad> adresine gönderir
  const ara = first(sp.ara);
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
        actions={<NewIngredientButton categories={categories} />}
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
          label="Tahmini fiyat"
          value={<CountUp value={estimates} />}
          tone={estimates ? "warn" : "good"}
          badge={
            active.length ? (
              <Badge tone={estimates ? "amber" : "green"} title="Aktif malzemeler içindeki payı">
                {pct(estimates / active.length, 0)}
              </Badge>
            ) : null
          }
          sub="Faturada bulunamayanlar"
        />
        <Stat icon={<Unlink />} label="Hiçbir reçetede yok" value={<CountUp value={unused} />} sub="Reçeteye eklenmesi gerekebilir" />
        <Stat
          icon={<Droplets />}
          label="Su + buz birim maliyeti"
          value={<CountUp value={model.water.perLiter} digits={2} suffix=" ₺" />}
          suffix="/L"
          sub={model.water.month ? `${model.water.month} su faturasından` : model.settings.suBirimLTOverride !== null ? "Ayarlar'dan elle" : "Su faturası girilmedi"}
          info="Gelir-gider tablosundaki SU GİDERİ ÷ reçetelere göre o ay harcanan su + buz (litre)."
        />
      </div>
      <IngredientsClient key={`${filtre ?? ""}|${ara ?? ""}`} rows={rows} categories={categories} initialFilter={filtre ?? null} initialQuery={ara ?? ""} />
    </>
  );
}

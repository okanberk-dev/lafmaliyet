import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { monthLabel } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel, resolveMonth } from "@/server/data/dataset";

import { RecipeEditor } from "./recipe-editor";

export const metadata: Metadata = { title: "Reçete kartı" };

export default function RecipePage({ params, searchParams }: PageProps<"/panel/urunler/[id]">) {
  return (
    <Suspense fallback={<RecipeSkeleton />}>
      <RecipeContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** Yüklenirken reçete kartının iki sütunlu iskeleti (telefonda özet üstte); geri bağlantısı hemen kullanılabilir */
function RecipeSkeleton() {
  return (
    <>
      <PageHeader
        eyebrow="Menü"
        excel="Reçete Kartları"
        title="Reçete kartı"
        actions={
          <ButtonLink href="/panel/urunler" variant="ghost" size="sm">
            <ArrowLeft size={16} /> Ürünler
          </ButtonLink>
        }
      />
      <div
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]"
        aria-busy="true"
        aria-label="Yükleniyor"
      >
        <div className="min-w-0 space-y-4">
          <div className="space-y-2.5 rounded-3xl bg-panel p-5">
            <div className="mb-4 flex items-center gap-3">
              <Skeleton className="size-9 rounded-lg bg-surface" />
              <Skeleton className="h-9 w-56 bg-surface" />
            </div>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 shrink-0 bg-surface" />
                <Skeleton className="h-11 flex-1 bg-surface/70" />
              </div>
            ))}
          </div>
          <Skeleton className="h-56 rounded-3xl" />
        </div>
        <div className="order-first space-y-3 rounded-3xl bg-panel p-5 lg:order-none">
          <Skeleton className="h-10 w-44 bg-surface" />
          <Skeleton className="h-52 rounded-2xl bg-surface" />
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
            <Skeleton className="h-9 bg-surface" />
            <Skeleton className="h-9 bg-surface" />
          </div>
          <Skeleton className="h-10 bg-surface" />
          <Skeleton className="h-32 bg-surface/70" />
        </div>
      </div>
    </>
  );
}

async function RecipeContent({
  params,
  searchParams,
}: {
  params: PageProps<"/panel/urunler/[id]">["params"];
  searchParams: PageProps<"/panel/urunler/[id]">["searchParams"];
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const model = await loadModel();
  const product = model.productById.get(Number(id));
  if (!product) notFound();
  const pc = model.computeProduct(product);
  const month = resolveMonth(sp.ay, model);

  const history = model.salesMonths.map((m) => ({ month: m, label: monthLabel(m), qty: model.soldByProduct(m).get(product.id) ?? 0 }));
  const siblings = model.products
    .filter((p) => p.product.name === product.name)
    .map((p) => ({ id: p.product.id, size: p.product.size }));
  const usedIds = new Set(pc.lines.map((l) => l.item.ingredientId));
  const ingredients = model.ds.ingredients
    .filter((i) => i.active || usedIds.has(i.id))
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      unitCost: model.unitCost.get(i.id) ?? 0,
      vatRate: i.vatRate,
      isEstimate: i.isEstimate,
      priceSource: i.priceSource,
    }));

  return (
    <RecipeEditor
      key={`${product.id}-${pc.lines.length}-${product.price}`}
      product={{
        id: product.id,
        name: product.name,
        size: product.size,
        categoryId: product.categoryId,
        price: product.price,
        fireOverride: product.fireOverride,
        note: product.note,
        active: product.active,
        showOnMenu: product.showOnMenu,
      }}
      items={pc.lines.map((l) => ({
        ingredientId: l.item.ingredientId,
        qty: l.item.qty,
        qtyExpr: l.item.qtyExpr,
        note: l.item.note,
      }))}
      categories={model.categories.map((c) => ({ id: c.id, name: c.name }))}
      ingredients={ingredients}
      settings={model.settings}
      soldQty={model.soldByProduct(month).get(product.id) ?? 0}
      monthLabel={monthLabel(month)}
      history={history}
      siblings={siblings}
      waterPerLiter={model.water.perLiter}
    />
  );
}

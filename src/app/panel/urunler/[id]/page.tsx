import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { monthLabel } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel, resolveMonth } from "@/server/data/dataset";

import { RecipeEditor } from "./recipe-editor";

export const metadata: Metadata = { title: "Reçete kartı" };

export default function RecipePage({ params, searchParams }: PageProps<"/panel/urunler/[id]">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Reçete kartı" excel="Reçete Kartları" />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <RecipeContent params={params} searchParams={searchParams} />
    </Suspense>
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

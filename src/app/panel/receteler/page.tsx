import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { RecipeBook } from "./recipe-book";

export const metadata: Metadata = { title: "Reçete defteri" };

export default function RecipeBookPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Reçete defteri" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <RecipeBookContent />
    </Suspense>
  );
}

async function RecipeBookContent() {
  const user = await requireUser();
  const model = await loadModel();
  const groups = model.categories
    .map((c) => {
      const products = model.activeProducts.filter((p) => p.product.categoryId === c.id);
      const byName = new Map<string, typeof products>();
      for (const p of products) {
        const list = byName.get(p.product.name) ?? [];
        list.push(p);
        byName.set(p.product.name, list);
      }
      return {
        id: c.id,
        name: c.name,
        products: [...byName.entries()].map(([name, variants]) => ({
          name,
          variants: variants.map((v) => ({
            id: v.product.id,
            size: v.product.size,
            note: v.product.note,
            lines: v.lines.map((l) => ({
              name: l.ingredient?.name ?? "?",
              qty: l.qty,
              unit: l.ingredient?.unit ?? "",
              packaging: l.isPackaging,
            })),
          })),
        })),
      };
    })
    .filter((g) => g.products.length);

  return (
    <>
      <PageHeader
        title="Reçete defteri"
        description="Baristalar için standart reçeteler: her ürünün her boyunda ne kadar malzeme kullanılacağı. Herkes aynı ölçüyle hazırlarsa fire ve maliyet farkı azalır."
      />
      <RecipeBook groups={groups} canEdit={user.role === "admin"} />
    </>
  );
}

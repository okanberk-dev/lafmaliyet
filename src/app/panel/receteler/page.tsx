import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Skeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { PrintButton } from "./print-button";
import { RecipeBook, type RecipeGroup } from "./recipe-book";

export const metadata: Metadata = { title: "Reçete defteri" };

export default function RecipeBookPage() {
  return (
    <>
      <PageHeader
        title="Reçete defteri"
        eyebrow="Menü"
        description="Baristalar için standart reçeteler: her ürünün her boyunda ne kadar malzeme kullanılacağı. Herkes aynı ölçüyle hazırlarsa fire ve maliyet farkı azalır."
        actions={<PrintButton />}
      />
      <Suspense fallback={<RecipeBookSkeleton />}>
        <RecipeBookContent />
      </Suspense>
    </>
  );
}

function RecipeBookSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yükleniyor">
      <div className="mb-6 space-y-2.5">
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-28 sm:w-40" />
        </div>
        <Skeleton className="h-10 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

async function RecipeBookContent() {
  const user = await requireUser();
  const model = await loadModel();
  // Personel de bu sayfayı görür: buraya yalnızca ad, boy, miktar ve not geçer; maliyet, fiyat ve kâr asla geçmez.
  const groups: RecipeGroup[] = model.categories
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

  return <RecipeBook groups={groups} canEdit={user.role === "admin"} />;
}

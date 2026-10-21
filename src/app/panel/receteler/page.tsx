import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Skeleton } from "@/components/ui/misc";
import { PACKAGING_CATEGORY, RECIPE_PARAMS } from "@/lib/constants";
import { requireUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { countPendingRequests, loadMyRequests, pendingByProduct } from "@/server/data/recipe-requests";

import { PrintButton } from "./print-button";
import { RecipeBook, type MyRequest, type ProposeKit, type RecipeGroup } from "./recipe-book";

export const metadata: Metadata = { title: "Reçete defteri" };

export default function RecipeBookPage() {
  return (
    <>
      <PageHeader
        title="Reçete defteri"
        eyebrow="Menü"
        description="Baristalar için standart reçeteler: her ürünün her boyunda ne kadar malzeme kullanılacağı. Herkes aynı ölçüyle hazırlarsa fire ve maliyet farkı azalır. Personel değişiklik önerir, yönetici onaylayınca reçete değişir."
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
  const isAdmin = user.role === "admin";
  const [model, mine, pendingTotal, pendingMap] = await Promise.all([
    loadModel(),
    isAdmin ? Promise.resolve([]) : loadMyRequests(user.id),
    isAdmin ? countPendingRequests() : Promise.resolve(0),
    isAdmin ? pendingByProduct() : Promise.resolve(new Map<number, number>()),
  ]);
  const myPending = new Map(mine.filter((r) => r.status === "pending").map((r) => [r.productId, r]));
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
          variants: variants.map((v) => {
            const pending = myPending.get(v.product.id);
            return {
              id: v.product.id,
              size: v.product.size,
              note: v.product.note,
              lines: v.lines.map((l) => ({
                ingredientId: l.item.ingredientId,
                name: l.ingredient?.name ?? "?",
                qty: l.qty,
                qtyExpr: l.item.qtyExpr,
                unit: l.ingredient?.unit ?? "",
                packaging: l.isPackaging,
                note: l.item.note,
              })),
              myPending: pending ? { id: pending.id, after: pending.after, updatedAt: pending.updatedAt.toISOString() } : null,
              pendingCount: pendingMap.get(v.product.id) ?? 0,
            };
          }),
        })),
      };
    })
    .filter((g) => g.products.length);

  // Personelin öneri penceresi: malzeme adları, birimleri ve formüllerdeki ölçüler (shot, pompa…); fiyat yok
  let propose: ProposeKit | null = null;
  if (!isAdmin) {
    const used = new Set(model.activeProducts.flatMap((p) => p.lines.map((l) => l.item.ingredientId)));
    propose = {
      ingredients: model.ds.ingredients
        .filter((i) => i.active || used.has(i.id))
        .map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category, active: i.active, packaging: i.category === PACKAGING_CATEGORY })),
      params: RECIPE_PARAMS.map((p) => ({ name: p.name, key: p.key, label: p.label, unit: p.unit, value: Number(model.settings[p.key]) })),
    };
  }

  const myRequests: MyRequest[] = mine.map((r) => ({
    id: r.id,
    productId: r.productId,
    productName: r.productName,
    size: r.size,
    status: r.status,
    before: r.before,
    after: r.after,
    message: r.message,
    reviewNote: r.reviewNote,
    reviewedByName: r.reviewedByName,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return <RecipeBook groups={groups} canEdit={isAdmin} propose={propose} myRequests={myRequests} pendingTotal={pendingTotal} />;
}

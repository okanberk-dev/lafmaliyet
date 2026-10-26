import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { PACKAGING_CATEGORY, RECIPE_PARAMS } from "@/lib/constants";
import { countGroupOptions } from "@/lib/count-item";
import { pumpHint } from "@/lib/recipe-pump";
import { requireUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { countPendingByKind, loadMyRequests, pendingByProduct, pendingNewProposals } from "@/server/data/recipe-requests";

import { countComplete, defaultCountMonth } from "../sayim/logic";

import { ProposeProductButton, type NewProductKit } from "./new-product-sheet";
import { PrintButton } from "./print-button";
import { RecipeBook, type MyRequest, type ProposeKit, type RecipeGroup } from "./recipe-book";

export const metadata: Metadata = { title: "Reçete defteri" };

export default function RecipeBookPage() {
  return (
    // Başlıktaki "Yeni ürün öner" / "Yeni ürün" role göre: başlık içerikle birlikte çizilir (bekleme sırasında eylemsiz)
    <Suspense
      fallback={
        <>
          <RecipeBookHeader />
          <RecipeBookSkeleton />
        </>
      }
    >
      <RecipeBookContent />
    </Suspense>
  );
}

function RecipeBookHeader({ action }: { action?: ReactNode }) {
  return (
    <PageHeader
      title="Reçete defteri"
      eyebrow="Menü"
      description="Baristalar için standart reçeteler: her ürünün her boyunda ne kadar malzeme kullanılacağı. Herkes aynı ölçüyle hazırlarsa fire ve maliyet farkı azalır. Personel değişiklik ya da yeni ürün önerir, yönetici onaylayınca uygulanır."
      actions={
        <>
          {action}
          <PrintButton />
        </>
      }
    />
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
  const [model, mine, pendingKinds, pendingMap, pendingNew] = await Promise.all([
    loadModel(),
    isAdmin ? Promise.resolve([]) : loadMyRequests(user.id),
    isAdmin ? countPendingByKind() : Promise.resolve({ change: 0, new: 0 }),
    isAdmin ? pendingByProduct() : Promise.resolve(new Map<number, number>()),
    isAdmin ? Promise.resolve([]) : pendingNewProposals(),
  ]);
  // Kartın "Önerin onayda" rozeti yalnız reçete değişikliğinden (yeni ürün önerisinin ürünü henüz yok)
  const myPending = new Map(mine.flatMap((r) => (r.status === "pending" && r.kind === "change" && r.productId !== null ? [[r.productId, r] as const] : [])));
  // Personel de bu sayfayı görür: buraya yalnızca ad, boy, miktar ve not geçer; maliyet, fiyat ve kâr asla geçmez.
  // Şurup, sos ve püre satırlarının pompa karşılığı ("1,5 pompa") burada hesaplanır, sayfaya yalnız metni gider.
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
                pump: pumpHint(
                  { qty: l.qty, unit: l.ingredient?.unit ?? "", qtyExpr: l.item.qtyExpr, category: l.ingredient?.category, name: l.ingredient?.name, packaging: l.isPackaging },
                  model.settings,
                ),
              })),
              myPending: pending ? { id: pending.id, after: pending.after, updatedAt: pending.updatedAt.toISOString() } : null,
              pendingCount: pendingMap.get(v.product.id) ?? 0,
            };
          }),
        })),
      };
    })
    .filter((g) => g.products.length);

  // Personelin öneri pencereleri: malzeme adları, birimleri ve formüllerdeki ölçüler (shot, pompa…); yeni ürün için
  // kategoriler ve var olan ürünlerin ad + boyu (aynısı önerilmesin). Hiçbirinde tutar yok.
  let propose: ProposeKit | null = null;
  let newProduct: NewProductKit | null = null;
  if (!isAdmin) {
    const used = new Set(model.activeProducts.flatMap((p) => p.lines.map((l) => l.item.ingredientId)));
    // "Yeni malzeme" (listede olmayan malzeme, Stok sayımı › Listeye ekle'nin kuralı): kalem sayım sayfasının açtığı
    // aydan itibaren listeye girer (ay başında geçen ayın sayımı tamamlanmadıysa geçen ay); gruplar sayım listesinin sırasıyla
    const countMonth = defaultCountMonth(new Date(), (m) => countComplete(model.stockSheet(m)));
    const groupOptions = countGroupOptions(
      model.stockSheet(countMonth).groups.map((g) => g.name),
      [...model.ds.ingredients].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    );
    propose = {
      ingredients: model.ds.ingredients
        .filter((i) => i.active || used.has(i.id))
        .map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category, active: i.active, packaging: i.category === PACKAGING_CATEGORY })),
      params: RECIPE_PARAMS.map((p) => ({ name: p.name, key: p.key, label: p.label, unit: p.unit, value: Number(model.settings[p.key]) })),
      newIngredient: groupOptions.length ? { month: countMonth, groups: groupOptions } : null,
    };
    newProduct = {
      categories: model.categories.map((c) => ({ id: c.id, name: c.name })),
      taken: model.ds.products.map((p) => ({ name: p.name, size: p.size })),
      pending: pendingNew,
    };
  }

  const myRequests: MyRequest[] = mine.map((r) => ({
    id: r.id,
    kind: r.kind,
    productId: r.productId,
    productName: r.productName,
    size: r.size,
    status: r.status,
    // Personelin kendi yazdığı satış fiyatı yalnız öneri beklerken (onaydan sonra menü fiyatını yönetici belirler)
    proposedPrice: r.status === "pending" ? r.proposedPrice : null,
    before: r.before,
    after: r.after,
    message: r.message,
    reviewNote: r.reviewNote,
    reviewedByName: r.reviewedByName,
    updatedAt: r.updatedAt.toISOString(),
  }));

  // Yönetici ürünü doğrudan Ürünler › Yeni ürün'den açar; personel önerir
  const action = isAdmin ? (
    <ButtonLink href="/panel/urunler" variant="secondary">
      <Plus size={16} aria-hidden="true" /> Yeni ürün
    </ButtonLink>
  ) : propose && newProduct ? (
    <ProposeProductButton kit={propose} product={newProduct} />
  ) : null;

  return (
    <>
      <RecipeBookHeader action={action} />
      <RecipeBook groups={groups} canEdit={isAdmin} propose={propose} myRequests={myRequests} pending={pendingKinds} />
    </>
  );
}

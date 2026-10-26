import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { priceProduct } from "@/lib/calc/engine";
import { evaluateExpression } from "@/lib/calc/expr";
import { PACKAGING_CATEGORY } from "@/lib/constants";
import { isUnpriced } from "@/lib/count-item";
import { estimateNames, qtyLabel, sameRecipe, type RecipeSnapshot } from "@/lib/recipe-change";
import { requireAdmin } from "@/server/auth/dal";
import { loadModelOnce } from "@/server/data/model-once";
import { loadReviewQueue } from "@/server/data/recipe-requests";

import { categoryFireDefault } from "../urunler/logic";

import { KasaRequests } from "./kasa-section";
import { OpsRequests } from "./ops-section";
import { RecentDecisions } from "./recent-decisions";
import { ReviewList, type NewProductEnv, type NewProductItem, type RecentItem, type ReviewItem } from "./review-list";

export const metadata: Metadata = { title: "Onaylar" };

/**
 * Onaylar (docs/ONAYLAR.md): personelin yöneticinin onayına giden istekleri ve önerileri, sırayla kasa, zayi ve ikram,
 * reçete; en altta personel isteklerinin son kararları. Her bölüm kendi Suspense'inde ve kendi requireAdmin'iyle;
 * maliyet modeli istek başına bir kez kurulur (loadModelOnce). Kartların çapası `#istek-<id>`, reçete kartlarınınki
 * `#oneri-<id>`.
 */
export default function ApprovalsPage() {
  return (
    <>
      <PageHeader
        title="Onaylar"
        eyebrow="Günlük"
        description="Personelin onay isteyen önerileri ve istekleri: kasa, zayi ve ikram, reçete. Reddederseniz notunuz personele görünür; tutar yazmayın."
        actions={
          <ButtonLink href="/panel/receteler" variant="secondary">
            <BookOpen size={16} aria-hidden="true" /> Reçete defteri
          </ButtonLink>
        }
      />
      <div className="space-y-6">
        <Suspense fallback={null}>
          <KasaRequests />
        </Suspense>
        <Suspense fallback={null}>
          <OpsRequests />
        </Suspense>
        <Suspense fallback={<PageSkeleton rows={6} />}>
          <ApprovalsContent />
        </Suspense>
        <Suspense fallback={null}>
          <RecentDecisions />
        </Suspense>
      </div>
    </>
  );
}

type Model = Awaited<ReturnType<typeof loadModelOnce>>;

/** Bugünkü reçete (onayda "öneriden sonra değişti mi" diye bakılır) */
function modelSnapshot(model: Model, productId: number): RecipeSnapshot | null {
  const product = model.productById.get(productId);
  if (!product) return null;
  return {
    note: product.note,
    items: model.computeProduct(product).lines.map((l) => ({
      ingredientId: l.item.ingredientId,
      name: l.ingredient?.name ?? "?",
      unit: l.ingredient?.unit ?? "",
      qty: l.qty,
      qtyExpr: l.item.qtyExpr,
      note: l.item.note,
    })),
  };
}

/** Önerideki satırın bugünkü ayarlarla miktarı (formül yeniden hesaplanır, okunamazsa öneri anındaki değer) */
function lineQty(model: Model, l: RecipeSnapshot["items"][number]): number {
  if (!l.qtyExpr) return l.qty;
  try {
    return evaluateExpression(l.qtyExpr, model.settings);
  } catch {
    return l.qty;
  }
}

/** Reçetenin bugünkü fiyatlarla maliyeti ve maliyet oranı (formüller bugünkü ayarlarla) */
function economics(model: Model, productId: number, snap: RecipeSnapshot) {
  const product = model.productById.get(productId);
  if (!product) return null;
  const lines = snap.items.map((l) => {
    const ing = model.ingById.get(l.ingredientId);
    return { qty: lineQty(model, l), unitCost: model.unitCost.get(l.ingredientId) ?? 0, vatRate: ing?.vatRate ?? 0, isPackaging: ing?.category === PACKAGING_CATEGORY };
  });
  return priceProduct({ price: product.price, fireOverride: product.fireOverride }, lines, model.settings);
}

/** Reçete önerileri: değişiklikler ve yeni ürünler (bugünkü fiyatlarla maliyet etkisi), reçetenin son kararları */
async function ApprovalsContent() {
  await requireAdmin();
  const [model, queue] = await Promise.all([loadModelOnce(), loadReviewQueue()]);
  const pending: (ReviewItem | NewProductItem)[] = queue.pending.map((r): ReviewItem | NewProductItem => {
    if (r.kind === "new" || r.productId === null) {
      // Yeni ürün: maliyet satır satır bugünkü fiyatlarla; satış fiyatı ve marj yöneticinin yazdığı fiyatla tarayıcıda
      // (personel fiyat yazdıysa alan onunla dolu gelir)
      return {
        kind: "new",
        id: r.id,
        name: r.proposed?.name ?? r.productName,
        size: r.size,
        categoryId: r.proposed?.categoryId ?? 0,
        requestedByName: r.requestedByName,
        updatedAt: r.updatedAt.toISOString(),
        message: r.message,
        version: r.version,
        proposedPrice: r.proposedPrice,
        lines: r.after.items.map((l) => {
          const ing = model.ingById.get(l.ingredientId);
          const unpriced = !!ing && isUnpriced(ing);
          return {
            name: l.name,
            qtyLabel: qtyLabel({ ...l, qty: lineQty(model, l) }),
            note: l.note,
            qty: lineQty(model, l),
            unitCost: model.unitCost.get(l.ingredientId) ?? 0,
            vatRate: ing?.vatRate ?? 0,
            isPackaging: ing?.category === PACKAGING_CATEGORY,
            missing: !ing,
            unpriced,
            // Fiyatı tahmini (öneride "Yeni malzeme" ile açılan ya da faturada bulunmayan): maliyet kesin değil
            estimate: !!ing && ing.isEstimate && !unpriced,
          };
        }),
      };
    }
    const productId = r.productId;
    const current = modelSnapshot(model, productId);
    const product = model.productById.get(productId);
    const before = economics(model, productId, r.before);
    const after = economics(model, productId, r.after);
    return {
      kind: "change",
      id: r.id,
      productId,
      productName: r.productName,
      size: r.size,
      categoryName: product ? (model.catById.get(product.categoryId)?.name ?? null) : null,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      message: r.message,
      version: r.version,
      before: r.before,
      after: r.after,
      current,
      changedSince: current ? !sameRecipe(current, r.before) : false,
      cost:
        before && after && product
          ? { before: before.cost, after: after.cost, price: product.price, ratioBefore: before.costRatio, ratioAfter: after.costRatio, target: model.settings.hedefMaliyet }
          : null,
      unpriced: [
        ...new Set(
          r.after.items.flatMap((l) => {
            const ing = model.ingById.get(l.ingredientId);
            return ing && isUnpriced(ing) ? [ing.name] : [];
          }),
        ),
      ],
      estimates: estimateNames(r.before, r.after, model.ingById),
    };
  });
  const recent: RecentItem[] = queue.recent.map((r) => ({
    id: r.id,
    kind: r.kind,
    productId: r.productId,
    productName: r.productName,
    size: r.size,
    status: r.status,
    requestedByName: r.requestedByName,
    reviewedByName: r.reviewedByName,
    reviewNote: r.reviewNote,
    message: r.message,
    at: (r.reviewedAt ?? r.updatedAt).toISOString(),
    before: r.before,
    after: r.after,
  }));
  // Yeni ürünün zayi oranı kategorisinden gelir (Ürünler › Yeni ürün ile aynı kural): yönetici kategoriyi değiştirince
  // maliyet de değişir
  const env: NewProductEnv = {
    categories: model.categories.map((c) => ({ id: c.id, name: c.name })),
    fireByCategory: Object.fromEntries(
      model.categories.map((c) => [c.id, categoryFireDefault(model.ds.products.filter((p) => p.categoryId === c.id).map((p) => ({ id: p.id, fireOverride: p.fireOverride })))]),
    ),
    settings: model.settings,
    taken: model.ds.products.map((p) => ({ name: p.name, size: p.size })),
  };
  return <ReviewList pending={pending} recent={recent} env={env} />;
}

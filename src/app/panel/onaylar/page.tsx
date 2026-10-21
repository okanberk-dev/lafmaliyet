import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { priceProduct } from "@/lib/calc/engine";
import { evaluateExpression } from "@/lib/calc/expr";
import { PACKAGING_CATEGORY } from "@/lib/constants";
import { sameRecipe, type RecipeSnapshot } from "@/lib/recipe-change";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadReviewQueue } from "@/server/data/recipe-requests";

import { ReviewList, type RecentItem, type ReviewItem } from "./review-list";

export const metadata: Metadata = { title: "Reçete onayları" };

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader
        title="Reçete onayları"
        eyebrow="Menü"
        description="Personelin reçete defterinden önerdiği değişiklikler. Önceki ve önerilen reçeteyi yan yana görün; onaylayınca reçete kartı değişir, reddederseniz notunuz personele görünür."
        actions={
          <ButtonLink href="/panel/receteler" variant="secondary">
            <BookOpen size={16} aria-hidden="true" /> Reçete defteri
          </ButtonLink>
        }
      />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <ApprovalsContent />
      </Suspense>
    </>
  );
}

type Model = Awaited<ReturnType<typeof loadModel>>;

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

/** Reçetenin bugünkü fiyatlarla maliyeti ve maliyet oranı (formüller bugünkü ayarlarla) */
function economics(model: Model, productId: number, snap: RecipeSnapshot) {
  const product = model.productById.get(productId);
  if (!product) return null;
  const lines = snap.items.map((l) => {
    const ing = model.ingById.get(l.ingredientId);
    let qty = l.qty;
    if (l.qtyExpr) {
      try {
        qty = evaluateExpression(l.qtyExpr, model.settings);
      } catch {
        // Kayıtlı (öneri anındaki) değer kalır
      }
    }
    return { qty, unitCost: model.unitCost.get(l.ingredientId) ?? 0, vatRate: ing?.vatRate ?? 0, isPackaging: ing?.category === PACKAGING_CATEGORY };
  });
  return priceProduct({ price: product.price, fireOverride: product.fireOverride }, lines, model.settings);
}

async function ApprovalsContent() {
  await requireAdmin();
  const [model, queue] = await Promise.all([loadModel(), loadReviewQueue()]);
  const pending: ReviewItem[] = queue.pending.map((r) => {
    const current = modelSnapshot(model, r.productId);
    const product = model.productById.get(r.productId);
    const before = economics(model, r.productId, r.before);
    const after = economics(model, r.productId, r.after);
    return {
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      size: r.size,
      categoryName: product ? (model.catById.get(product.categoryId)?.name ?? null) : null,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      message: r.message,
      before: r.before,
      after: r.after,
      current,
      changedSince: current ? !sameRecipe(current, r.before) : false,
      cost:
        before && after && product
          ? { before: before.cost, after: after.cost, price: product.price, ratioBefore: before.costRatio, ratioAfter: after.costRatio, target: model.settings.hedefMaliyet }
          : null,
    };
  });
  const recent: RecentItem[] = queue.recent.map((r) => ({
    id: r.id,
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
  return <ReviewList pending={pending} recent={recent} />;
}

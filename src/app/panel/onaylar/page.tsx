import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { ALL_BRANCHES, BRANCH_PARAM, branchScopeLabel } from "@/lib/branches";
import { priceProduct } from "@/lib/calc/engine";
import { evaluateExpression } from "@/lib/calc/expr";
import { PACKAGING_CATEGORY } from "@/lib/constants";
import { num } from "@/lib/format";
import { isUnpriced } from "@/lib/count-item";
import { estimateNames, negativeQtyIssue, proposalGroupKey, qtyLabel, sameRecipe, type RecipeSnapshot } from "@/lib/recipe-change";
import { requireAdmin, requireCan } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadModelOnce } from "@/server/data/model-once";
import { approvedNewPairs, loadReviewQueue } from "@/server/data/recipe-requests";
import { getDb } from "@/server/db";
import { pendingOutOfScope } from "@/server/staff-requests/branch";

import { categoryFireDefault } from "../urunler/logic";

import { KaraokeRequests } from "./karaoke-section";
import { KasaRequests } from "./kasa-section";
import { OpsRequests } from "./ops-section";
import { RecentDecisions } from "./recent-decisions";
import { ReviewList, type NewProductEnv, type NewProductItem, type RecentItem, type ReviewItem } from "./review-list";

export const metadata: Metadata = { title: "Onaylar" };

/**
 * Onaylar (docs/ONAYLAR.md): personelin yöneticinin onayına giden istekleri ve önerileri, sırayla kasa, zayi ve ikram,
 * karaoke, reçete; en altta personel isteklerinin son kararları. Her bölüm kendi Suspense'inde ve kendi requireAdmin'iyle;
 * maliyet modeli istek başına bir kez kurulur (loadModelOnce). Kartların çapası `#istek-<id>`, reçete kartlarınınki
 * `#oneri-<id>`.
 */
export default function ApprovalsPage() {
  return (
    <>
      <PageHeader
        title="Onaylar"
        path="/panel/onaylar"
        description="Personelin onay isteyen önerileri ve istekleri: kasa, zayi ve ikram, karaoke, reçete. Reddederseniz notunuz personele görünür; tutar yazmayın."
        actions={
          <ButtonLink href="/panel/receteler" variant="secondary">
            <BookOpen size={16} aria-hidden="true" /> Reçete defteri
          </ButtonLink>
        }
      />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <ApprovalSections />
      </Suspense>
    </>
  );
}

/**
 * Rolün bölümleri (docs/ROLLER.md): müdür yalnız şubesinin kasa ve zayi / ikram isteklerini karara bağlar (bölümler
 * kendi `requireCan("onay")`'ıyla, kartlar şubesine süzülür); öbür şubelerin sayısı, karaoke istekleri, reçete önerileri
 * ve son kararlar yöneticinin
 */
async function ApprovalSections() {
  const me = await requireCan("onay");
  const admin = me.role === "admin";
  return (
    <div className="space-y-6">
      {admin ? (
        <Suspense fallback={null}>
          <OtherBranchRequests />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <KasaRequests />
      </Suspense>
      <Suspense fallback={null}>
        <OpsRequests />
      </Suspense>
      {admin ? (
        <>
          <Suspense fallback={null}>
            <KaraokeRequests />
          </Suspense>
          <Suspense fallback={<PageSkeleton rows={6} />}>
            <ApprovalsContent />
          </Suspense>
          <Suspense fallback={null}>
            <RecentDecisions />
          </Suspense>
        </>
      ) : (
        <Notice tone="neutral" size="sm" title="Şubenizin kasa ve zayi / ikram istekleri" text="Reçete önerileri ve karaoke istekleri yöneticinin Onaylar'ında. Bekleyen istek yoksa bu sayfa boştur." />
      )}
    </div>
  );
}

/**
 * Tek şube seçiliyken Onaylar yalnız o şubenin isteklerini gösterir (şube kapsamı C P1-1); öbür şubelerde bekleyen
 * istek varsa sayısı ve "Tümü"nü açan bağlantı (seçici `?sube=`'yi benimser). Reçete önerileri işletme genelidir, sayılmaz
 */
async function OtherBranchRequests() {
  await requireAdmin();
  const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  const n = await pendingOutOfScope(getDb(), scope);
  if (!n) return null;
  return (
    <Notice
      tone="neutral"
      size="sm"
      title={`${branchScopeLabel(scope, branches)} seçili: öbür şubelerde ${num(n)} istek daha onay bekliyor`}
      action={<NoticeLink href={`/panel/onaylar?${BRANCH_PARAM}=${ALL_BRANCHES}`}>Tümünü göster</NoticeLink>}
    />
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
  return lineCheck(model, l).qty;
}

/**
 * Önerideki satırın bugünkü ayarlarla miktarı ve onayı engelleyen sorunu: formül eksiye düşüyor (negativeQtyIssue) ya da
 * hesaplanamıyor. Onay eylemleri aynı satırı aynı kuralla reddeder; kart düğmeyi kapatıp nedenini önceden söyler.
 */
function lineCheck(model: Model, l: RecipeSnapshot["items"][number]): { qty: number; issue: string | null } {
  if (!l.qtyExpr) return { qty: l.qty, issue: negativeQtyIssue(l, l.qty) };
  try {
    const qty = evaluateExpression(l.qtyExpr, model.settings);
    return { qty, issue: negativeQtyIssue(l, qty) };
  } catch (e) {
    return {
      qty: l.qty,
      issue: `${l.name}: formül hatası (${l.qtyExpr}): ${(e as Error).message}; öneri onaylanamaz. Ayarlar'daki ölçüyü düzeltin ya da öneriyi reddedin`,
    };
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
  // Yeni ürün önerisinin daha önce eklenmiş öteki boyu: bu boy onun adını alır (denetim E-55)
  const pairs = await approvedNewPairs(
    getDb(),
    queue.pending
      .filter((r) => r.kind === "new" || r.productId === null)
      .map((r) => ({ id: r.id, requestedBy: r.requestedBy, requestedByName: r.requestedByName, name: r.proposed?.name ?? r.productName, size: r.size })),
  );
  const pending: (ReviewItem | NewProductItem)[] = queue.pending.map((r): ReviewItem | NewProductItem => {
    if (r.kind === "new" || r.productId === null) {
      // Yeni ürün: maliyet satır satır bugünkü fiyatlarla; satış fiyatı ve marj yöneticinin yazdığı fiyatla tarayıcıda
      // (personel fiyat yazdıysa alan onunla dolu gelir)
      const pair = pairs.get(r.id);
      return {
        kind: "new",
        id: r.id,
        name: r.proposed?.name ?? r.productName,
        size: r.size,
        categoryId: r.proposed?.categoryId ?? 0,
        group: proposalGroupKey({ requestedBy: r.requestedBy, requestedByName: r.requestedByName, name: r.proposed?.name ?? r.productName }),
        pair: pair ? { name: pair.name, size: pair.size, categoryId: pair.categoryId } : null,
        requestedByName: r.requestedByName,
        updatedAt: r.updatedAt.toISOString(),
        message: r.message,
        version: r.version,
        proposedPrice: r.proposedPrice,
        lines: r.after.items.map((l) => {
          const ing = model.ingById.get(l.ingredientId);
          const unpriced = !!ing && isUnpriced(ing);
          const { qty, issue } = lineCheck(model, l);
          return {
            name: l.name,
            qtyLabel: qtyLabel({ ...l, qty }),
            note: l.note,
            qty,
            unitCost: model.unitCost.get(l.ingredientId) ?? 0,
            vatRate: ing?.vatRate ?? 0,
            isPackaging: ing?.category === PACKAGING_CATEGORY,
            missing: !ing,
            // Öneriden sonra pasife alındı ya da formülü bugünkü ayarlarla eksiye düşüyor: onay olmaz (sunucu da reddeder)
            inactive: !!ing && !ing.active,
            qtyIssue: issue,
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
      // Ayar öneriden sonra değiştiyse formül eksiye düşebilir: onay olmaz (reviewRecipeChange da reddeder)
      qtyIssues: [...new Set(r.after.items.flatMap((l) => lineCheck(model, l).issue ?? []))],
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
    taken: model.ds.products.map((p) => ({ id: p.id, name: p.name, size: p.size })),
  };
  return <ReviewList pending={pending} recent={recent} env={env} />;
}

import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { ALL_BRANCHES } from "@/lib/branches";
import { productSalesHistory, soldWithOnline } from "@/lib/calc/insights";
import { monthLabel } from "@/lib/format";
import { productBranchPrice } from "@/lib/prices/branch-view";
import { productDeleteBlocker } from "@/lib/product-delete";
import { suggestLinks } from "@/lib/site-menu/names";
import { soldOutWhen } from "@/lib/site-menu/sold-out";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { loadBranchPrices } from "@/server/data/branch-prices";
import { soldOutNoteFor } from "@/server/data/menu-status";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { loadProductPriceHistory } from "@/server/data/prices";
import { productHistoryCounts } from "@/server/data/product-history";
import { loadRecipeVersions } from "@/server/data/recipe-versions";
import { syncSiteMenu } from "@/server/site-menu/sync";
import { loadSiteLinks } from "@/server/site-menu/view";

import { waterSource } from "../../ayarlar/water-text";
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
        path="/panel/urunler"
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
  // laffogato.net menüsü en çok beş dakikada bir (Ürünler sayfasıyla aynı kural; sayfa beklemez)
  after(async () => {
    try {
      await syncSiteMenu("page");
    } catch (e) {
      console.error("[menu] sayfa eşitlemesi", e);
    }
  });
  const { id } = await params;
  const sp = await searchParams;
  const [model, siteLinks, scope] = await Promise.all([loadModel(), loadSiteLinks(), currentBranchScope()]);
  const product = model.productById.get(Number(id));
  if (!product) notFound();
  const link = siteLinks.links.find((l) => l.productId === product.id) ?? null;
  // Şube seçiliyken şubenin kendi fiyatı (şube ayrımı parça 5): kartta kutudaki fiyat "Taban fiyat", şubenin fiyatı ve
  // o fiyatla birim kâr ayrıca; okunamazsa yok
  const branchPrices = link && scope !== ALL_BRANCHES ? await loadBranchPrices(scope).catch(() => null) : null;
  const branchPriceValue = branchPrices?.branch?.id === scope ? productBranchPrice(link, branchPrices.items, product.price) : null;
  const siteItems = siteLinks.snapshot.at ? siteLinks.snapshot.items : [];
  const pc = model.computeProduct(product);
  const month = resolveMonth(sp.ay, model);
  // Fiyat geçmişi kartı (son 20 değişiklik ve kasanın durumu) okunamazsa kart görünmez, reçete kartı açılır
  // Siparişler ekranının Tükenenler kartıyla kapatıldıysa kim ve ne zaman (dalga 10 §2.1; okunamazsa not yok)
  const [prices, priceHistory, soldOut, counts, recipeHistory] = await Promise.all([
    loadPriceAlerts(model).catch(() => null),
    loadProductPriceHistory(product.id).catch(() => null),
    soldOutNoteFor(link?.siteMenuId ?? null).catch(() => null),
    // Silme engelinin sayıları eylemin sayacından, bütün şubelerden (şube kapsamı C P2-6): şubenin modeli Marina
    // seçiliyken Tuzla'nın zayisini görmüyordu. Okunamazsa kart düğmeyi açık bırakır, eylem yine veritabanından sayar
    productHistoryCounts({ id: product.id, siteMenuId: link?.siteMenuId ?? null, siteMenuSlot: link?.slot ?? null }).catch(() => null),
    // Reçete geçmişi (son 30 değişiklik); okunamazsa kart görünmez
    loadRecipeVersions(product.id).catch(() => null),
  ]);
  const impact = prices?.impacts.find((i) => i.productId === product.id) ?? null;

  // Satılan adet ModPOS + laffogato.net online: Ürünler, Genel bakış ve Claude aracının (panelAdresi) sayısıyla aynı
  const history = productSalesHistory(model, product.id).map((h) => ({ ...h, label: monthLabel(h.month) }));
  // Silme engeli (src/lib/product-delete.ts; eylem aynı kuralı veritabanından yeniden sayar): kart silmek yerine pasif
  // yapmayı önerir. Fiyat geçmişinin ilk 20 satırı yeter: bir değişiklik bile engeldir
  const deleteBlocker = counts ? productDeleteBlocker(counts) : null;
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
      // Yalnızca ürün değişince baştan kurulur: kayıttan sonra sayfa yeniden çizilmez (sekme, deneme fiyatı korunur);
      // editör alanları kaydedilen biçime kendisi getirir
      key={product.id}
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
      soldQty={soldWithOnline(model, month).get(product.id) ?? 0}
      month={month}
      months={availableMonths(model)}
      monthLabel={monthLabel(month)}
      history={history}
      deleteBlocker={deleteBlocker}
      siblings={siblings}
      water={{
        perLiter: model.water.perLiter,
        costed: model.water.reason === "ok" || model.water.reason === "override",
        text: waterSource(model.water),
        short: waterSource(model.water, true),
      }}
      site={{
        configured: siteLinks.configured,
        link: link ? { siteMenuId: link.siteMenuId, slot: link.slot } : null,
        item: link ? (siteItems.find((i) => i.id === link.siteMenuId) ?? null) : null,
        snapshotAt: siteLinks.snapshot.at,
        lastError: siteLinks.state.lastError,
        // Bağlı değilse ada göre öneri (yalnız gösterilir; bağlamak yöneticinin)
        suggestion:
          !link && siteLinks.configured
            ? (suggestLinks([{ id: product.id, name: product.name, size: product.size, price: product.price }], siteItems, siteLinks.links)[0] ?? null)
            : null,
      }}
      priceHistory={priceHistory}
      branchPrice={branchPriceValue !== null && branchPrices?.branch ? { value: branchPriceValue, label: branchPrices.branch.name } : null}
      recipeHistory={recipeHistory}
      soldOutNote={soldOut ? `${soldOut.staff ? "Personel tükendi yaptı" : "Siparişler ekranında tükendi yapıldı"} · ${soldOut.by} ${soldOutWhen(soldOut.at, new Date())}` : null}
      priceImpact={
        impact
          ? {
              costBefore: impact.costBefore,
              costAfter: impact.costAfter,
              ratioBefore: impact.ratioBefore,
              ratioAfter: impact.ratioAfter,
              suggestedPrice: impact.suggestedPrice,
              basis: impact.basis,
              needsPrice: impact.needsPrice,
              acknowledged: impact.acknowledged,
              drivers: impact.drivers.map((d) => ({ name: d.name, pct: d.pct })),
              // Zammın bu üründen ayda götürdüğü kâr (son satış ayıyla; satış verisi yoksa cümle yok)
              monthly: impact.monthly,
              monthlyQty: impact.monthlyQty,
              lossBasis: prices?.loss.basis ? { month: prices.loss.basis.month, scale: prices.loss.basis.scale } : null,
            }
          : null
      }
    />
  );
}

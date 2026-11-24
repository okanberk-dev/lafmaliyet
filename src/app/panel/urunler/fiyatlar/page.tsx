import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PosChecklist } from "@/components/panel/pos-checklist";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { latestSalesMonth } from "@/lib/calc/insights";
import { salesBasis } from "@/lib/calc/price-loss";
import type { KasaName } from "@/lib/lafpos/kasa";
import type { BulkRow } from "@/lib/prices/bulk";
import { todayTR } from "@/lib/reminders";
import { salesSourceOf } from "@/lib/sales-source";
import { siteMarker } from "@/lib/site-menu/view";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadBranchBulk, loadBranchPrices, loadOldPriceReport, pickBranch } from "@/server/data/branch-prices";
import { loadPosChecklist, loadPriceHistory, loadRecentPosMarks, posPendingSummary } from "@/server/data/prices";
import { loadTillScope } from "@/server/data/till-scope";
import { loadSiteLinks } from "@/server/site-menu/view";

import { BranchPrices } from "./branch-prices";
import { BulkEditor } from "./bulk-editor";
import { tabHref, tabOf, type FiyatlarTab } from "./logic";
import { OldPriceReportView } from "./old-price-report";
import { PriceHistory } from "./price-history";
import { RecentPosMarks } from "./recent-marks";

export const metadata: Metadata = { title: "Fiyatlar" };
// Toplu değişiklik ve geri alması siteye bağlı ürünleri tek tek yazar (en çok 40 sn; batch.ts): bu sayfanın sunucu
// eylemleri sayfanın süresini kullanır
export const maxDuration = 60;

const TITLE = "Fiyatlar";
const DESCRIPTION = "Menü fiyatlarını toplu değiştirin; kasada değiştirdiklerinizi işaretleyin.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE = "Menü fiyatlarını toplu değiştirin, kasada (ModPOS) elle değiştirdiklerinizi işaretleyin; her fiyat değişikliği geçmişte kalır.";
/** LafPOS'a geçiş gününden itibaren (denetim E-39): siteye bağlı ürünün fiyatını LafPOS siteden alır */
const MORE_LAFPOS =
  "Menü fiyatlarını toplu değiştirin; LafPOS siteye bağlı ürünlerin fiyatını siteden alır, bağlı olmayanlar Kasaya işle'de. Her fiyat değişikliği geçmişte kalır.";

function Header({ tabs, kasa = "ModPOS" }: { tabs?: ReactNode; kasa?: KasaName }) {
  return (
    <PageHeader
      path="/panel/urunler/fiyatlar"
      title={TITLE}
      description={DESCRIPTION}
      more={kasa === "LafPOS" ? MORE_LAFPOS : MORE}
      actions={
        <ButtonLink href="/panel/urunler" variant="ghost" size="sm">
          <ArrowLeft size={16} aria-hidden="true" /> Ürünler
        </ButtonLink>
      }
      tabs={tabs}
    />
  );
}

export default function PricesPage({ searchParams }: PageProps<"/panel/urunler/fiyatlar">) {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <PricesContent searchParams={searchParams} />
    </Suspense>
  );
}

/** Toplu sekmede süzgeçler adreste kalır (Ürün listesinden gelen bağlantı); öteki sekmelere taşınmaz */
function bulkQuery(sp: Record<string, string | string[] | undefined>): string {
  const keep = new URLSearchParams();
  for (const k of ["kategori", "boy", "ara", "pasif"]) {
    const v = sp[k];
    if (typeof v === "string" && v) keep.set(k, v);
  }
  return keep.toString();
}

/** Ürünler'in alt ekranı (docs/FIYATLAR.md); yalnız yönetici. Her sekme yalnız kendi verisini okur */
async function PricesContent({ searchParams }: { searchParams: PageProps<"/panel/urunler/fiyatlar">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = tabOf(sp.sekme);
  // Bugünün kasası: LafPOS gününde Kasaya işle'de yalnız siteye bağlı olmayan ürünler (denetim E-39)
  const scope = await loadTillScope();
  const pending = await posPendingSummary(scope);
  const options: { value: FiyatlarTab; label: string; href: string; count?: number }[] = [
    { value: "toplu", label: "Toplu değiştir", href: tabHref("toplu", tab === "toplu" ? bulkQuery(sp) : undefined) },
    // Sayı yalnız kasada bekleyen varken (boş listede "0" yazmasın)
    { value: "kasa", label: "Kasaya işle", href: tabHref("kasa"), count: pending.count || undefined },
    { value: "gecmis", label: "Geçmiş", href: tabHref("gecmis") },
    // Şube fiyatı (docs/FIYATLAR.md › Şube fiyatı): şubenin kendi fiyatları ve LafPOS'ta uygulanıp uygulanmadığı
    { value: "sube", label: "Şube fiyatı", href: tabHref("sube") },
    { value: "eski", label: "Eski fiyattan satılanlar", href: tabHref("eski") },
  ];
  const header = <Header kasa={scope.kasa} tabs={<SegmentedLinks label="Fiyatlar" value={tab} options={options} />} />;

  if (tab === "kasa") {
    const now = new Date();
    const [items, marks] = await Promise.all([loadPosChecklist(scope), loadRecentPosMarks({ days: 14, now })]);
    return (
      <>
        {header}
        <div className="space-y-4">
          <PosChecklist items={items} kasa={scope.kasa} />
          <RecentPosMarks marks={marks} now={now.toISOString()} />
        </div>
      </>
    );
  }
  if (tab === "sube" || tab === "eski") {
    const now = new Date();
    const data = tab === "sube" ? await loadBranchPrices(sp.sube, now) : null;
    const report = tab === "eski" ? await loadOldPriceReport(sp.sube, now) : null;
    const ctx = data?.ctx ?? report!.ctx;
    const branch = pickBranch(ctx.branches, sp.sube);
    // İki şube olunca seçici (bugün yalnız Marina)
    const picker =
      ctx.branches.length > 1 && branch ? (
        <SegmentedLinks label="Şube" value={branch.id} options={ctx.branches.map((b) => ({ value: b.id, label: b.name, href: `${tabHref(tab)}&sube=${b.id}` }))} />
      ) : null;
    return (
      <>
        {header}
        <div className="space-y-4">
          {picker}
          {data ? (
            data.branch ? (
              <BranchPrices ctx={data.ctx} branch={data.branch} items={data.items} now={now.toISOString()} />
            ) : (
              <EmptyState title="Şube yok" description="Şube fiyatı Tuzla dışındaki açık bir şubede yazılır (Ayarlar › Şubeler)." />
            )
          ) : (
            <OldPriceReportView report={report!} />
          )}
        </div>
      </>
    );
  }
  if (tab === "gecmis") {
    const history = await loadPriceHistory({ limit: 500 });
    return (
      <>
        {header}
        <PriceHistory rows={history.rows} products={history.products} kasa={scope.kasa} />
      </>
    );
  }

  const [model, site, branchBulk] = await Promise.all([loadModel(), loadSiteLinks(), loadBranchBulk()]);
  // "Aylık etki": zam etkisiyle aynı dayanak (son satış ayı, standart aya ölçekli; price-loss.ts salesBasis)
  const month = latestSalesMonth(model);
  const sb = month ? salesBasis(model, month) : null;
  const linkOf = new Map(site.links.map((l) => [l.productId, l]));
  const items = site.snapshot.at ? site.snapshot.items : null;
  const rows: BulkRow[] = model.products.map((p) => {
    const link = linkOf.get(p.product.id) ?? null;
    // Ürün listesindeki işaretle aynı (bağlantı kuruluysa bağlı olmayan da "Bağlı değil"): arama aynı ürünleri bulsun
    const marker = site.configured || link ? siteMarker(link, items) : null;
    return {
      id: p.product.id,
      name: p.product.name,
      size: p.product.size,
      categoryId: p.product.categoryId,
      category: p.category?.name ?? "—",
      active: p.product.active,
      price: p.price,
      cost: p.cost,
      suggestedPrice: p.suggestedPrice,
      site: link && marker ? marker.kind : null,
      note: p.product.note,
      siteText: marker?.text ?? null,
      monthlyQty: sb?.perMonth.get(p.product.id) ?? 0,
      siteMenuId: link?.siteMenuId ?? null,
      siteMenuSlot: link?.slot ?? null,
    };
  });
  const st = model.settings;
  return (
    <>
      {header}
      <BulkEditor
        rows={rows}
        categories={model.categories.map((c) => ({ id: c.id, name: c.name }))}
        settings={{ kdv: st.kdv, komisyon: st.komisyon, kartOrani: st.kartOrani, hedefMaliyet: st.hedefMaliyet }}
        siteConfigured={site.configured}
        basis={sb?.basis ?? null}
        // Satış verisi yokken ne yapılacağı ayın kaynağından (bugünün ayı; docs/planlar/ux-sade.md §10)
        salesMissing={salesSourceOf(todayTR().slice(0, 7), st.lafposGecisGunu, model.ds.lafposSales).missing}
        kasa={scope.kasa}
        // Şube seçimi yalnız site şube fiyatını duyurduysa (writes.branchPrice) ve yazılabilen şube varsa
        branchPrice={branchBulk}
      />
    </>
  );
}

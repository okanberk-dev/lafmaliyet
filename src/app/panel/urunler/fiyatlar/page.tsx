import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { latestSalesMonth } from "@/lib/calc/insights";
import { salesBasis } from "@/lib/calc/price-loss";
import type { BulkRow } from "@/lib/prices/bulk";
import { siteMarker } from "@/lib/site-menu/view";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadPosChecklist, loadPriceHistory, posPendingSummary } from "@/server/data/prices";
import { loadSiteLinks } from "@/server/site-menu/view";

import { BulkEditor } from "./bulk-editor";
import { tabHref, tabOf, type FiyatlarTab } from "./logic";
import { PosChecklist } from "./pos-checklist";
import { PriceHistory } from "./price-history";

export const metadata: Metadata = { title: "Fiyatlar" };
// Toplu değişiklik ve geri alması siteye bağlı ürünleri tek tek yazar (en çok 40 sn; batch.ts): bu sayfanın sunucu
// eylemleri sayfanın süresini kullanır
export const maxDuration = 60;

const TITLE = "Fiyatlar";
const DESCRIPTION = "Menü fiyatlarını toplu değiştirin, kasada (ModPOS) elle değiştirdiklerinizi işaretleyin; her fiyat değişikliği geçmişte kalır.";

function Header({ tabs }: { tabs?: ReactNode }) {
  return (
    <PageHeader
      eyebrow="Menü"
      title={TITLE}
      description={DESCRIPTION}
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
  const pending = await posPendingSummary();
  const options: { value: FiyatlarTab; label: string; href: string; count?: number }[] = [
    { value: "toplu", label: "Toplu değiştir", href: tabHref("toplu", tab === "toplu" ? bulkQuery(sp) : undefined) },
    // Sayı yalnız kasada bekleyen varken (boş listede "0" yazmasın)
    { value: "kasa", label: "Kasaya işle", href: tabHref("kasa"), count: pending.count || undefined },
    { value: "gecmis", label: "Geçmiş", href: tabHref("gecmis") },
  ];
  const header = <Header tabs={<SegmentedLinks label="Fiyatlar" value={tab} options={options} />} />;

  if (tab === "kasa") {
    const items = await loadPosChecklist();
    return (
      <>
        {header}
        <PosChecklist items={items} />
      </>
    );
  }
  if (tab === "gecmis") {
    const history = await loadPriceHistory({ limit: 500 });
    return (
      <>
        {header}
        <PriceHistory rows={history.rows} products={history.products} />
      </>
    );
  }

  const [model, site] = await Promise.all([loadModel(), loadSiteLinks()]);
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
      />
    </>
  );
}

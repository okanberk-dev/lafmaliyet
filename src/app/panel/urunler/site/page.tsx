import { asc, eq } from "drizzle-orm";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { buttonClass, ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { siteGaps, suggestLinks } from "@/lib/site-menu/names";
import { requireAdmin } from "@/server/auth/dal";
import { loadTillScope } from "@/server/data/till-scope";
import { getDb, schema as s } from "@/server/db";
import { siteUrl } from "@/server/site-link";
import { syncSiteMenu } from "@/server/site-menu/sync";
import { loadSiteLinks } from "@/server/site-menu/view";

import { SiteMenuMatching, type MatchProduct } from "./site-menu-matching";

export const metadata: Metadata = { title: "Site menüsü" };
// "Siteyle eşitle" ve "Önerileri bağla" bu sayfanın sunucu eylemleriyle siteye gider (en çok 8 saniye)
export const maxDuration = 30;

const TITLE = "Site menüsü";

function Header() {
  return (
    <PageHeader
      eyebrow="Menü"
      title={TITLE}
      description="Panel ürünlerini laffogato.net menüsündeki kalemlere bağlayın: bağlı ürünün satış fiyatı ve menü durumu iki yerde aynı kalır, doğru kaynak sitedir. Ad, kategori, reçete ve maliyet eşitlenmez."
      actions={
        <>
          <ButtonLink href="/panel/urunler" variant="ghost" size="sm">
            <ArrowLeft size={16} aria-hidden="true" /> Ürünler
          </ButtonLink>
          {/* Bağlantının öbür ucu: kalemler sitenin panelinde açılır, silinir, adlandırılır */}
          <a href={`${siteUrl()}/admin`} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
            laffogato.net paneli <ExternalLink size={14} aria-hidden="true" />
          </a>
        </>
      }
    />
  );
}

export default function SiteMenuPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <SiteMenuContent />
    </Suspense>
  );
}

async function SiteMenuContent() {
  await requireAdmin();
  // Ping kaçtıysa diye site en çok beş dakikada bir sorulur; sayfa beklemez ("Siteyle eşitle" hemen sorar)
  after(async () => {
    try {
      await syncSiteMenu("page");
    } catch (e) {
      console.error("[menu] sayfa eşitlemesi", e);
    }
  });
  const [site, till, rows] = await Promise.all([
    loadSiteLinks(),
    // Bugünün kasası (bilgi metni: LafPOS fiyatı siteden alır; denetim E-39)
    loadTillScope().catch(() => null),
    getDb()
      .select({
        id: s.products.id,
        name: s.products.name,
        size: s.products.size,
        category: s.categories.name,
        price: s.products.price,
        active: s.products.active,
        showOnMenu: s.products.showOnMenu,
        siteMenuId: s.products.siteMenuId,
        siteMenuSlot: s.products.siteMenuSlot,
      })
      .from(s.products)
      .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId))
      .orderBy(asc(s.categories.sortOrder), asc(s.products.sortOrder), asc(s.products.id)),
  ]);
  const items = site.snapshot.at ? site.snapshot.items : [];
  const products: MatchProduct[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size,
    category: r.category,
    price: r.price,
    active: r.active,
    showOnMenu: r.showOnMenu,
    link: r.siteMenuId && r.siteMenuSlot ? { siteMenuId: r.siteMenuId, slot: r.siteMenuSlot } : null,
  }));
  // Öneri yalnız bağlı olmayan ürünlere; önce aktif ürünler (pasif bir ürün aktif olanın kalemini almasın)
  const unlinked = products.filter((p) => !p.link);
  const forActive = items.length ? suggestLinks(unlinked.filter((p) => p.active), items, site.links) : [];
  const forInactive = items.length ? suggestLinks(unlinked.filter((p) => !p.active), items, [...site.links, ...forActive]) : [];
  const suggestions = [...forActive, ...forInactive];
  const gaps = siteGaps(items, site.links);

  return (
    <>
      <Header />
      <SiteMenuMatching
        configured={site.configured}
        state={site.state}
        snapshotAt={site.snapshot.at}
        items={items}
        products={products}
        suggestions={suggestions}
        gaps={gaps}
        kasa={till?.kasa ?? "ModPOS"}
      />
    </>
  );
}

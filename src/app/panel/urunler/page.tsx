import { Coffee, Globe, ShoppingBag, Tags, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { soldWithOnline } from "@/lib/calc/insights";
import { monthLabel, num, pct } from "@/lib/format";
import { siteMarker } from "@/lib/site-menu/view";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { posPendingSummary } from "@/server/data/prices";
import { syncSiteMenu } from "@/server/site-menu/sync";
import { loadSiteLinks } from "@/server/site-menu/view";

import { productBreakdowns } from "./breakdowns";
import { menuAverages } from "./logic";
import { NewProductButton } from "./new-product";
import { PriceImpactPanel } from "./price-impact-panel";
import { CountUp, ProductsTable, StatusShare, type ProductRow } from "./products-table";

export const metadata: Metadata = { title: "Ürünler & kârlılık" };

const EXCEL = "Ürün Kârlılık + Reçete Kartları";

export default function ProductsPage({ searchParams }: PageProps<"/panel/urunler">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Ürünler & kârlılık" eyebrow="Menü" excel={EXCEL} />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <ProductsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ProductsContent({ searchParams }: { searchParams: PageProps<"/panel/urunler">["searchParams"] }) {
  await requireAdmin();
  // laffogato.net menüsü: ping kaçtıysa diye site en çok beş dakikada bir sorulur; sayfa beklemez, değişen fiyat
  // ve menü durumu sonraki açılışta görünür (docs/SITE-MENU.md)
  after(async () => {
    try {
      await syncSiteMenu("page");
    } catch (e) {
      console.error("[menu] sayfa eşitlemesi", e);
    }
  });
  const sp = await searchParams;
  // Kasada (ModPOS) değişecek fiyatlar: Fiyatlar düğmesinin rozeti (okunamazsa rozet yok)
  const [model, site, pos] = await Promise.all([loadModel(), loadSiteLinks(), posPendingSummary().catch(() => null)]);
  const month = resolveMonth(sp.ay, model);
  // Hammadde zamları (son 30 gün) ve kârı düşen ürünler; genel bakış, zil ve sabah e-postası buraya getirir
  const prices = await loadPriceAlerts(model).catch(() => null);
  // Satılan adet ModPOS + laffogato.net online: Genel bakış, Analiz, ürün kartı, Excel ve Claude aracıyla aynı sayı
  const sold = soldWithOnline(model, month);
  const st = model.settings;
  const linkOf = new Map(site.links.map((l) => [l.productId, l]));
  const siteItems = site.snapshot.at ? site.snapshot.items : null;

  const rows: ProductRow[] = model.products.map((p) => {
    const qty = sold.get(p.product.id) ?? 0;
    const link = linkOf.get(p.product.id) ?? null;
    return {
      id: p.product.id,
      name: p.product.name,
      size: p.product.size,
      categoryId: p.product.categoryId,
      category: p.category?.name ?? "—",
      note: p.product.note,
      active: p.product.active,
      price: p.price,
      net: p.net,
      commission: p.commission,
      cost: p.cost,
      totalCost: p.totalCost,
      unitProfit: p.unitProfit,
      margin: p.margin,
      costRatio: p.costRatio,
      suggestedPrice: p.suggestedPrice,
      status: p.status,
      fireRate: p.fireRate,
      fireOverridden: p.fireOverridden,
      soldQty: qty,
      monthProfit: p.unitProfit * qty,
      monthNet: p.net * qty,
      lineCount: p.lines.length,
      hasEstimate: p.lines.some((l) => l.ingredient?.isEstimate),
      // Bağlantı kapalıysa (anahtar yok) işaret yok; bağlı kalmış ürün yine gösterilir
      site: site.configured || link ? { ...siteMarker(link, siteItems), ref: link ? `${link.siteMenuId} ${link.slot}` : null } : null,
    };
  });
  const siteProblems = rows.filter((r) => r.site?.kind === "broken" || r.site?.kind === "missing").length;

  const active = rows.filter((r) => r.active);
  const soldRows = active.filter((r) => r.soldQty > 0);
  const totalProfit = soldRows.reduce((a, r) => a + r.monthProfit, 0);
  const totalNet = soldRows.reduce((a, r) => a + r.monthNet, 0);
  const count = (s: ProductRow["status"]) => active.filter((r) => r.status === s).length;
  const good = count("İyi");
  const warn = count("Dikkat");
  const low = count("Düşük kâr");
  const noRecipe = count("Reçete yok");
  const categories = model.categories.map((c) => ({ id: c.id, name: c.name }));
  const ml = monthLabel(month);
  const target = num(st.hedefMaliyet * 100);
  // Excel Ürün Kârlılık satır 134: menünün basit ortalaması (her ürün bir oy)
  const avg = menuAverages(active);
  // Kartlara dokununca açılan dökümler: aynı satırlardan, kartla aynı ay ve sayılar
  const bd = productBreakdowns(rows, categories, month, st.hedefMaliyet);

  return (
    <>
      <PageHeader
        eyebrow="Menü"
        title="Ürünler & kârlılık"
        excel={EXCEL}
        description={
          <>
            Her ürün ve boy için satış fiyatı, maliyet, birim kâr, kâr marjı ve önerilen fiyat.{" "}
            <span className="pointer-coarse:hidden">Ürün adına tıklayınca reçete kartı açılır.</span>
            <span className="hidden pointer-coarse:inline">Ürüne dokununca reçete kartı açılır.</span>
          </>
        }
        actions={
          <>
            <MonthPicker months={availableMonths(model)} value={month} />
            <ButtonLink
              href="/panel/urunler/site"
              variant="secondary"
              title={
                !site.configured
                  ? "laffogato.net menü bağlantısı kurulmamış"
                  : siteProblems
                    ? `${num(siteProblems)} ürünün site bağlantısında sorun var`
                    : site.state.lastError
                      ? `Son eşitleme hatası: ${site.state.lastError}`
                      : "Ürünleri laffogato.net menüsündeki kalemlere bağlayın; fiyat ve menü durumu iki yerde aynı kalır"
              }
            >
              <Globe size={16} aria-hidden="true" /> Site menüsü
              {site.configured && (siteProblems || site.state.lastError) ? <span className="size-2 rounded-full bg-bad" aria-label="sorun var" /> : null}
            </ButtonLink>
            {/* Toplu fiyat, kasaya (ModPOS) işle, fiyat geçmişi; kasada bekleyen varsa doğrudan o liste */}
            <ButtonLink
              href={pos?.count ? "/panel/urunler/fiyatlar?sekme=kasa" : "/panel/urunler/fiyatlar"}
              variant="secondary"
              title={pos?.count ? `Kasada (${pos.kasa}) değişecek ${num(pos.count)} fiyat` : "Menü fiyatlarını toplu değiştirin; fiyat geçmişi"}
            >
              <Tags size={16} aria-hidden="true" /> Fiyatlar
              {pos?.count ? (
                <span className="-mr-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-warn tabular">Kasa {num(pos.count)}</span>
              ) : null}
            </ButtonLink>
            <NewProductButton
              categories={categories}
              products={rows.map((r) => ({
                id: r.id,
                name: r.name,
                size: r.size,
                label: `${r.name} · ${r.size}`,
                categoryId: r.categoryId,
                active: r.active,
                price: r.price,
                fireOverride: r.fireOverridden ? r.fireRate : null,
              }))}
            />
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title="Menüdeki ürünler"
          description={`Menüde (aktif) olan ürünler, kategori kategori; her boy ayrı sayılır (${bd.menuSizes}). Kategoriye dokununca liste o kategoriyle açılır.`}
          groups={bd.menu}
          total={active.length}
          totalLabel="Menüdeki ürün"
          unit="count"
          empty="Menüde ürün yok."
        >
          <Stat icon={<Coffee />} label="Menüdeki ürün" value={<CountUp value={active.length} />} sub={`${num(model.categories.length)} kategori`} />
        </StatBreakdown>
        <StatBreakdown
          title="Hedefin dışındaki ürünler"
          description="Maliyet oranı (malzeme maliyeti ÷ net satış) hedefin üstünde kalan menü ürünleri, en yüksek oran önce. Ürüne dokununca reçete kartı açılır."
          groups={bd.offTarget}
          total={warn + low}
          totalLabel="Hedefin dışında"
          unit="count"
          order="given"
          shares={false}
        >
          <Stat
            icon={<Target />}
            label="Hedefin dışında"
            value={<CountUp value={warn + low} />}
            tone={low ? "bad" : warn ? "warn" : "good"}
            info={`Hedef maliyet oranı %${target}. İyi = hedefin altında, Dikkat = hedefin 10 puan üstüne kadar, Düşük kâr = daha fazlası. Menü ortalaması: maliyet oranı ${pct(avg.costRatio)}, kâr marjı ${pct(avg.margin)} (Excel'deki ORTALAMA satırı, her ürün bir oy).`}
            sub={`Hedef %${target} · menü ort. ${pct(avg.costRatio)}`}
          >
            <StatusShare
              parts={[
                { status: "İyi", count: good },
                { status: "Dikkat", count: warn },
                { status: "Düşük kâr", count: low },
                { status: "Reçete yok", count: noRecipe },
              ]}
            />
          </Stat>
        </StatBreakdown>
        <StatBreakdown
          title={`${ml} satılan çeşit`}
          description={`${ml} satış raporunda ve laffogato.net online siparişlerinde bir menü ürünüyle eşleşen satırlar, kategori kategori; her ürün ve boy bir çeşit, yanında satılan adet. Eşleşmeyen satış satırları sayılmaz. Ürüne dokununca reçete kartı açılır.`}
          groups={bd.sold}
          total={soldRows.length}
          totalLabel="Satılan çeşit"
          totalDisplay={bd.soldTotal}
          unit="count"
          order="given"
          shares={false}
          empty="Bu ay satış raporunda eşleşen ürün yok."
        >
          <Stat
            icon={<ShoppingBag />}
            label={`${ml} satılan çeşit`}
            value={<CountUp value={soldRows.length} />}
            sub={`${num(soldRows.reduce((a, r) => a + r.soldQty, 0))} adet`}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${ml} brüt kâr`}
          description="Eşleşen ürünlerin birim kârı × satılan adet (ModPOS ve laffogato.net online), kategori kategori (KDV ve komisyon düşülmüş). Eşleşmeyen satış satırları dahil değil. Ürüne dokununca reçete kartı açılır."
          groups={bd.profit}
          total={totalProfit}
          totalLabel="Brüt kâr"
          order="given"
          shares={!bd.profitHasLoss}
          empty="Bu ay satış raporunda eşleşen ürün yok."
        >
          <Stat
            icon={<TrendingUp />}
            label={`${ml} brüt kâr`}
            value={<CountUp value={totalProfit} suffix=" ₺" />}
            tone={totalProfit < 0 ? "bad" : "default"}
            info={`Eşleşen ürünler: satış raporunda ve laffogato.net online siparişlerinde bir ürünle eşleşen satırların birim kâr × adet toplamı. Eşleşmeyen satırlar dahil değildir. Ağırlıklı marj = brüt kâr ÷ net ciro (çok satan ürün daha çok sayılır); menünün basit ortalama marjı ${pct(avg.margin)}.`}
            sub={totalNet ? `Ağırlıklı marj ${pct(totalProfit / totalNet)}` : "Satış yok"}
          />
        </StatBreakdown>
      </div>
      {prices && prices.impacts.length ? <PriceImpactPanel changes={prices.changes} impacts={prices.impacts} target={st.hedefMaliyet} month={month} loss={prices.loss} /> : null}
      {/* Süzgeçler (?ara, ?kategori, ?boy, ?durum, ?pasif, ?sirala, ?goster) tablonun içinde adresten okunur; ⌘K
          paleti ve genel bakış bağlantıları aynı adları kullanır. Sunucuya yeniden gidilmez. */}
      <ProductsTable rows={rows} categories={categories} month={month} monthLabel={ml} target={st.hedefMaliyet} siteConfigured={site.configured} />
    </>
  );
}

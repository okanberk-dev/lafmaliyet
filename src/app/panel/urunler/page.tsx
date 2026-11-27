import { Coffee, Globe, ShoppingBag, Tags, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";

import { AnchorNote } from "@/components/panel/anchor-note";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SalesSourceLine } from "@/components/panel/sales-source-line";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { ALL_BRANCHES } from "@/lib/branches";
import { soldWithOnline } from "@/lib/calc/insights";
import { monthLabel, num, pct } from "@/lib/format";
import { monthKasa } from "@/lib/asilpos/kasa";
import { economicsAtPrice, productBranchPrice } from "@/lib/prices/branch-view";
import { combineTillPos } from "@/lib/prices/pos";
import { salesSourceOf } from "@/lib/sales-source";
import { siteMarker } from "@/lib/site-menu/view";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { loadBranchPrices } from "@/server/data/branch-prices";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { posPendingSummaries } from "@/server/data/prices";
import { syncSiteMenu } from "@/server/site-menu/sync";
import { loadSiteLinks } from "@/server/site-menu/view";

import { productBreakdowns } from "./breakdowns";
import { menuAverages, soldProfit } from "./logic";
import { NewProductButton } from "./new-product";
import { PriceImpactPanel } from "./price-impact-panel";
import { CountUp, ProductsTable, StatusShare, type ProductRow } from "./products-table";

export const metadata: Metadata = { title: "Ürünler & kârlılık" };

const DESCRIPTION = "Her ürünün fiyatı, maliyeti ve kârı; ürüne dokunun, reçete kartı açılır.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE = "Her ürün ve boy için satış fiyatı, maliyet, birim kâr, kâr marjı ve önerilen fiyat. Ürün adına dokununca reçete kartı açılır.";

export default function ProductsPage({ searchParams }: PageProps<"/panel/urunler">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Ürünler & kârlılık" path="/panel/urunler" description={DESCRIPTION} more={MORE} />
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
  // Kasada (ModPOS) değişecek fiyatlar: Fiyatlar düğmesinin rozeti (okunamazsa rozet yok); seçimin kasalarının toplamı
  // (şube kapsamı A3: "Tümü"de birden çok kasa açıkken hepsi)
  const [model, site, pos, branchPrices] = await Promise.all([
    loadModel(),
    loadSiteLinks(),
    posPendingSummaries()
      .then(combineTillPos)
      .catch(() => null),
    // Şube seçiliyken şubenin fiyatı (şube ayrımı parça 5; sitenin şube satırları, docs/FIYATLAR.md › Şube fiyatı):
    // birim kâr ve maliyet oranı şubede geçerli fiyatla, panelin fiyatı "Taban fiyat"
    currentBranchScope().then((scope) =>
      scope === ALL_BRANCHES
        ? null
        : loadBranchPrices(scope)
            .then((r) => (r.branch?.id === scope ? { name: r.branch.name, items: r.items } : null))
            .catch(() => null),
    ),
  ]);
  const month = resolveMonth(sp.ay, model);
  // Hammadde zamları (son 30 gün) ve kârı düşen ürünler; genel bakış, zil ve sabah e-postası buraya getirir
  const prices = await loadPriceAlerts(model).catch(() => null);
  // Satılan adet ModPOS + laffogato.net online: Genel bakış, Analiz, ürün kartı, dışa aktarım ve Claude aracıyla aynı sayı
  const sold = soldWithOnline(model, month);
  const st = model.settings;
  // Ayın kasası (metinler; geçiş günü boşken ve öncesinde "ModPOS", sonra "AsilPOS"; denetim E-39)
  const mk = monthKasa(month, st.asilposGecisGunu);
  const linkOf = new Map(site.links.map((l) => [l.productId, l]));
  const siteItems = site.snapshot.at ? site.snapshot.items : null;

  const rows: ProductRow[] = model.products.map((pc) => {
    const qty = sold.get(pc.product.id) ?? 0;
    const link = linkOf.get(pc.product.id) ?? null;
    const branchPrice = branchPrices ? productBranchPrice(link, branchPrices.items, pc.price) : null;
    const p = branchPrice !== null ? economicsAtPrice(pc, branchPrice, st) : pc;
    return {
      id: p.product.id,
      name: p.product.name,
      size: p.product.size,
      categoryId: p.product.categoryId,
      category: p.category?.name ?? "—",
      note: p.product.note,
      active: p.product.active,
      // Düzenlenen fiyat panelin (taban) fiyatı; şubenin fiyatı ayrıca (kâr ve oran onunla)
      price: pc.price,
      branchPrice: branchPrice !== null && branchPrices ? { value: branchPrice, label: branchPrices.name } : null,
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
  // Brüt kâr kartı satılan reçeteli ürünlerden: reçetesi boş ürünün kârı ~cirosu kadar görünürdü (denetim E-47)
  const { profit: totalProfit, net: totalNet, noRecipe: soldNoRecipe } = soldProfit(active);
  const count = (s: ProductRow["status"]) => active.filter((r) => r.status === s).length;
  const good = count("İyi");
  const warn = count("Dikkat");
  const low = count("Düşük kâr");
  const noRecipe = count("Reçete yok");
  const categories = model.categories.map((c) => ({ id: c.id, name: c.name }));
  const ml = monthLabel(month);
  const target = num(st.hedefMaliyet * 100);
  // Menünün basit ortalaması (her ürün bir oy)
  const avg = menuAverages(active);
  // Kartlara dokununca açılan dökümler: aynı satırlardan, kartla aynı ay ve sayılar
  const bd = productBreakdowns(rows, categories, month, st.hedefMaliyet);

  return (
    <>
      <PageHeader
        path="/panel/urunler"
        title="Ürünler & kârlılık"
        description={DESCRIPTION}
        more={MORE}
        meta={<SalesSourceLine source={salesSourceOf(month, st.asilposGecisGunu, model.ds.asilposSales)} />}
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
            info={`Hedef maliyet oranı %${target}. İyi = hedefin altında, Dikkat = hedefin 10 puan üstüne kadar, Düşük kâr = daha fazlası. Menü ortalaması: maliyet oranı ${pct(avg.costRatio)}, kâr marjı ${pct(avg.margin)} (basit ortalama, her ürün bir oy).`}
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
          description={`Eşleşen reçeteli ürünlerin birim kârı × satılan adet (${mk.both} ve laffogato.net online), kategori kategori (KDV ve komisyon düşülmüş). Eşleşmeyen satış satırları ve reçetesi boş ürünler dahil değil. Ürüne dokununca reçete kartı açılır.`}
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
            info={`Eşleşen ürünler: satış raporunda ve laffogato.net online siparişlerinde bir ürünle eşleşen satırların birim kâr × adet toplamı. Eşleşmeyen satırlar ve reçetesi boş ürünler dahil değildir (reçetesiz ürünün maliyeti 0 görünür, kârı neredeyse cirosu kadar olurdu). Ağırlıklı marj = brüt kâr ÷ net ciro (çok satan ürün daha çok sayılır); menünün basit ortalama marjı ${pct(avg.margin)}.`}
            sub={
              soldNoRecipe.length
                ? `${totalNet ? `Marj ${pct(totalProfit / totalNet)} · ` : ""}reçetesiz ${num(soldNoRecipe.length)} ürün hariç`
                : totalNet
                  ? `Ağırlıklı marj ${pct(totalProfit / totalNet)}`
                  : "Satış yok"
            }
          />
        </StatBreakdown>
      </div>
      {prices && prices.impacts.length ? <PriceImpactPanel
          changes={prices.changes}
          impacts={prices.impacts}
          target={st.hedefMaliyet}
          month={month}
          loss={prices.loss}
          salesMissing={salesSourceOf(month, st.asilposGecisGunu, model.ds.asilposSales).missing}
        /> : (
        // Kart yalnız zam varken çizilir; çapalı bağlantı (Yardım, zil, sabah e-postası: #zamlar) kısa satıra iner (UI-08)
        <AnchorNote id="zamlar" className="mb-6">
          {prices ? "Hammadde zamları: son 30 günde maliyeti artan ürün şu an yok." : "Hammadde zamları okunamadı; sayfayı yenileyin."}
        </AnchorNote>
      )}
      {/* Süzgeçler (?ara, ?kategori, ?boy, ?durum, ?pasif, ?sirala, ?goster) tablonun içinde adresten okunur; ⌘K
          paleti ve genel bakış bağlantıları aynı adları kullanır. Sunucuya yeniden gidilmez. */}
      <ProductsTable rows={rows} categories={categories} month={month} monthLabel={ml} target={st.hedefMaliyet} siteConfigured={site.configured} kasa={mk.both} />
    </>
  );
}

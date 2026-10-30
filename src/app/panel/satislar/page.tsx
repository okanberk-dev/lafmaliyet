import { Banknote, ShoppingBag, TrendingUp, Unlink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SalesSourceLine } from "@/components/panel/sales-source-line";
import { GrowthPill, PageSkeleton, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { listDaysText } from "@/lib/calc/insights";
import { manualOf } from "@/lib/cash-month";
import { RECIPE_COST_NOTE } from "@/lib/constants";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { dayRangeTR, lafposMonthNotes, lafposMonthStatus, type LafposMonthNotes } from "@/lib/lafpos/sales";
import { addDays, dayAblativeTR, todayTR } from "@/lib/reminders";
import { coverageFor } from "@/lib/sales-coverage";
import { salesSourceOf, type SalesSourceKind } from "@/lib/sales-source";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { salesBreakdowns } from "./breakdowns";
import { CountUp, ImportCard, MatchCoverage, MonthInfoForm, SalesTable, type ProductOption, type SalesRow } from "./sales-client";

export const metadata: Metadata = { title: "Satışlar" };

/**
 * Açıklama ayın satış kaynağına göre (docs/planlar/ux-sade.md §8, §10; src/lib/sales-source.ts). ModPOS bağlantısı
 * gelince (bugün hiçbir ay) dördüncü cümle kendiliğinden kullanılır
 */
const DESCRIPTION: Record<SalesSourceKind, string> = {
  "modpos-rapor": "Ay sonunda ModPOS ürün satış raporunu yükleyin, eşleşmeyen ürünleri bağlayın.",
  lafpos: "LafPOS'un gün sonları her gece gelir; eşleşmeyen ürünleri bağlayın.",
  gecis: "Geçiş ayı: önce ModPOS raporu, sonra LafPOS gün sonları; eşleşmeyenleri bağlayın.",
  "modpos-baglanti": "ModPOS bağlantısından kendiliğinden gelir; eşleşmeyen ürünleri bağlayın.",
};

/** Eski uzun açıklamalar: başlıktaki ⓘ "Nasıl çalışır?", kaynağa göre (docs/LAFPOS.md › Günlük satış) */
const MORE: Record<SalesSourceKind, string> = {
  "modpos-rapor": `ModPOS ürün satış raporu. Her POS ürünü menüdeki bir ürünle eşleştirilir; eşleştirmeler hatırlanır ve sonraki aylarda otomatik uygulanır. ${RECIPE_COST_NOTE}`,
  lafpos: `LafPOS'un gün sonlarından gelen ürün satışları, ay toplamı. Her POS ürünü menüdeki bir ürünle eşleştirilir; eşleştirmeler hatırlanır. ${RECIPE_COST_NOTE}`,
  gecis: `Geçiş ayı: geçiş gününden önceki günler ModPOS ürün satış raporundan, sonrası LafPOS'un gün sonlarından. Her POS ürünü menüdeki bir ürünle eşleştirilir; eşleştirmeler hatırlanır. ${RECIPE_COST_NOTE}`,
  "modpos-baglanti": `ModPOS bağlantısından gelen ürün satışları. Her POS ürünü menüdeki bir ürünle eşleştirilir; eşleştirmeler hatırlanır. ${RECIPE_COST_NOTE}`,
};

export default function SalesPage({ searchParams }: PageProps<"/panel/satislar">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Satışlar" path="/panel/satislar" description={DESCRIPTION["modpos-rapor"]} more={MORE["modpos-rapor"]} />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <SalesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SalesContent({ searchParams }: { searchParams: PageProps<"/panel/satislar">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const [model, mappings] = await Promise.all([loadModel(), getDb().select().from(s.posMappings)]);
  const month = resolveMonth(sp.ay, model);
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  // Süren ayda yüklenen listenin son günü (varsayılan dün) ve liste kasa raporlarından kısaysa dönemi (sales-coverage.ts)
  const today = todayTR();
  // LafPOS'a geçiş günü seçiliyse ayın kaynağı (src/lib/lafpos/sales.ts); seçilmediyse ya da ay ondan önceyse null ve
  // sayfa bugünkü gibi: LafPOS'un deneme günleri burada hiç görünmez
  const switchDay = model.settings.lafposGecisGunu;
  const lafpos = switchDay
    ? (model.ds.lafposSales?.months.find((m) => m.month === month) ?? lafposMonthStatus({ month, switchDay, today, modpos: null, lafpos: null }))
    : null;
  const notes = lafpos && switchDay ? lafposMonthNotes(lafpos, switchDay) : null;
  // Ayın satış kaynağı: başlığın açıklaması ve altındaki satır (docs/planlar/ux-sade.md §10)
  const source = salesSourceOf(month, switchDay, model.ds.lafposSales);
  const defaultThrough = coverageFor(month, today);
  // Geçiş ayında liste en çok geçiş gününden önceki güne kadar (biten ayda da gün seçilir; sunucu aynı kuralla kırpar)
  const lastModpos = switchDay ? addDays(switchDay, -1) : null;
  const gecisMax = lafpos?.source === "gecis" && lastModpos ? (defaultThrough && today < lastModpos ? today : lastModpos) : null;
  const runningImport =
    gecisMax && lastModpos
      ? { today: gecisMax, defaultThrough: defaultThrough && defaultThrough < gecisMax ? defaultThrough : gecisMax }
      : defaultThrough
        ? { today, defaultThrough }
        : null;
  const listPeriod = sales.lines.length ? model.listPeriod(month) : null;

  const products: ProductOption[] = model.products.map((p) => ({
    id: p.product.id,
    name: p.product.name,
    size: p.product.size,
    category: p.category?.name ?? "",
    cost: p.cost,
    price: p.price,
    active: p.product.active,
  }));
  const rows: SalesRow[] = sales.lines.map((l) => ({
    id: l.line.id,
    lafposDays: l.line.lafpos?.days ?? null,
    posName: l.line.posName,
    qty: l.line.qty,
    revenue: l.line.revenue,
    productId: l.line.productId,
    productLabel: l.product ? `${l.product.product.name} · ${l.product.product.size}` : null,
    isService: l.line.isService,
    matched: l.matched,
    noRecipe: l.noRecipe,
    unitCost: l.unitCost,
    net: l.net,
    cost: l.cost,
    commission: l.commission,
    grossProfit: l.grossProfit,
    margin: l.margin,
    note: l.line.note,
    avgPrice: l.line.qty ? l.line.revenue / l.line.qty : 0,
    menuPrice: l.product?.price ?? null,
  }));
  const unmatched = sales.unmatched.length;
  const mappingList = mappings.map((m) => ({ posName: m.posName, productId: m.productId, isService: m.isService, updatedAt: m.updatedAt }));
  // Formda yalnız elle yazılanlar; kasa raporlarından gelenler formda "Kasadan" olarak ayrıca gösterilir
  const infoValues = {
    openDays: manualOf(info, "openDays"),
    posRevenue: manualOf(info, "posRevenue"),
    discounts: manualOf(info, "discounts"),
    offRevenue: manualOf(info, "offRevenue"),
    cardShare: manualOf(info, "cardShare"),
    note: info?.note ?? null,
  };
  // "Ayı temizle › ay bilgileri de" yalnız elle yazılanları siler (kasadan gelenler raporlarla kalır)
  const hasInfo = Object.values(infoValues).some((v) => v !== null && v !== "");
  // Bir ürüne ya da HİZMET'e bağlanmış satırların ciro payı (kalanın maliyeti tahmini)
  const assignedRevenue = rows.reduce((a, r) => a + (r.matched || r.isService ? r.revenue : 0), 0);
  const coverage = sales.revenue ? assignedRevenue / sales.revenue : 0;
  // Kartların dökümü (karta dokununca açılan pencere): aynı ay satırlarından, yeni sorgu yok
  const breakdown = salesBreakdowns(sales, model.settings, month, model.cardShareOf(month).rate);
  const label = monthLabel(month);
  // ModPOS listesinin satırları (LafPOS'un ay toplamları ayrı); LafPOS ayında sayılmayan listenin satırları
  const modposLines = lafpos?.source === "lafpos" ? (lafpos.modpos?.lines ?? 0) : rows.filter((r) => r.lafposDays === null).length;
  // Tablodaki LafPOS satırları (geçiş ayında kartın metinleri iki kaynağı ayrı söyler)
  const lafposLines = rows.filter((r) => r.lafposDays !== null).length;

  return (
    <>
      <PageHeader
        title="Satışlar"
        path="/panel/satislar"
        description={DESCRIPTION[source.kind]}
        more={MORE[source.kind]}
        meta={<SalesSourceLine source={source} />}
        actions={<MonthPicker months={availableMonths(model)} value={month} />}
      />

      {notes ? <LafposBand notes={notes} source={lafpos!.source} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title={`${label} cirosu`}
          description="Satış raporundaki ciro (KDV dahil), kategori kategori, ürün ürün. Eşleşmeyen ve HİZMET satırları ayrı bölümde; kaleme dokununca tabloda açılır."
          groups={breakdown.revenue}
          total={sales.revenue}
          totalLabel="Ciro (KDV dahil)"
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<Banknote />}
            label="Ciro (KDV dahil)"
            value={<CountUp value={sales.revenue} />}
            sub={`Net ${tl(sales.net)} · POS komisyonu ${tl(sales.commission)}`}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${label} brüt kâr`}
          description={`Net ciro − malzeme + ambalaj − POS komisyonu (KDV hariç, kira ve personel öncesi).${
            sales.net ? ` Marj ${pct(sales.margin)} (brüt kâr ÷ net ciro), maliyet oranı ${pct(sales.cost / sales.net)}.` : ""
          }`}
          groups={breakdown.grossProfit}
          total={sales.grossProfit}
          totalLabel="Brüt kâr"
          order="given"
          shares={false}
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<TrendingUp />}
            label="Brüt kâr"
            value={<CountUp value={sales.grossProfit} />}
            tone={sales.grossProfit < 0 ? "bad" : "default"}
            badge={<GrowthPill value={sales.margin}>Marj {pct(sales.margin)}</GrowthPill>}
            sub={
              <>
                Kira ve personel öncesi
                <span className="block">
                  Malzeme + ambalaj {tl(sales.cost)}
                  {sales.net ? ` · maliyet oranı ${pct(sales.cost / sales.net)}` : null}
                </span>
              </>
            }
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${label} satılan ürün`}
          description={`${num(rows.length)} POS kalemi, kategori kategori, ürün ürün (adet). HİZMET satırları da sayılır; kaleme dokununca tabloda açılır.`}
          groups={breakdown.qty}
          total={sales.qty}
          totalLabel="Satılan ürün"
          unit="count"
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<ShoppingBag />}
            label="Satılan ürün"
            value={<CountUp value={sales.qty} kind="num" />}
            suffix="adet"
            sub={`${num(rows.length)} POS kalemi`}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${label} eşleşmeyen ürünler`}
          description="Menüdeki bir ürüne ya da HİZMET'e bağlanmamış POS kalemleri. Maliyetleri, eşleşenlerin ortalama maliyet oranıyla tahmin edilir."
          groups={breakdown.unmatched}
          total={unmatched}
          totalLabel="Eşleşmeyen ürün"
          totalDisplay={`${num(unmatched)} kalem`}
          order="given"
          shares={false}
          unit="count"
          empty="Bu ay satış yok."
        >
          <Stat
            icon={<Unlink />}
            label="Eşleşmeyen ürün"
            value={<CountUp value={unmatched} kind="num" />}
            tone={unmatched ? "warn" : "good"}
            info="Reçetesi olmayan ürünlere eşleşenlerin ortalama maliyet oranı uygulanır (Excel'deki gibi)."
            sub={
              <>
                Ort. maliyet oranı {pct(sales.avgCostRatio)}
                {unmatched ? (
                  // Kartın döküm düğmesinin üstünde kalır (konumlu): dokununca doğrudan tabloya iner
                  <Link
                    href={`/panel/satislar?ay=${month}&durum=eslesmeyen#satirlar`}
                    className="relative flex w-fit items-center font-medium text-warn underline-offset-2 hover:underline pointer-coarse:min-h-11"
                  >
                    Eşleştirmeye git →
                  </Link>
                ) : null}
              </>
            }
          >
            {rows.length ? <MatchCoverage share={coverage} /> : null}
          </Stat>
        </StatBreakdown>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <ImportCard
          className="xl:col-span-7"
          month={month}
          label={monthLabel(month)}
          lineCount={modposLines}
          lafposLines={lafposLines}
          mappings={mappingList}
          products={products}
          hasInfo={hasInfo}
          running={runningImport}
          coveredThrough={lafpos ? (lafpos.modpos?.through ?? null) : (model.ds.salesCoverage?.find((c) => c.month === month)?.through ?? null)}
          listDays={listPeriod ? listDaysText(listPeriod) : null}
          lafpos={
            lafpos?.source === "lafpos"
              ? { source: "lafpos", days: lafpos.lafpos?.days ?? 0, last: lafpos.lafpos?.last ?? null }
              : lafpos?.source === "gecis" && switchDay && lastModpos
                ? {
                    source: "gecis",
                    throughHint: `Geçiş ayı: ModPOS listesi en çok ${dayRangeTR(`${month}-01`, lastModpos)} günlerini kapsar, LafPOS ${dayAblativeTR(switchDay)} itibaren sayılır. Liste daha kısaysa son gününü seçin; aradaki günler hiçbir kaynakta olmaz.`,
                  }
                : null
          }
        />
        <MonthInfoForm
          // Ay bilgisi başka yerden değişince (Ayı temizle, Gelir-gider, yeni kasa raporu) form yeni değerlerle açılsın
          key={`${month}|${JSON.stringify(infoValues)}|${JSON.stringify(info?.kasa?.values ?? null)}`}
          className="xl:col-span-5"
          month={month}
          label={monthLabel(month)}
          info={infoValues}
          kasa={info?.kasa ?? null}
          settingsCardShare={model.settings.kartOrani}
          listTotal={sales.revenue}
          listPeriod={listPeriod ? { label: listDaysText(listPeriod), posRevenue: listPeriod.posRevenue, discounts: listPeriod.discounts } : null}
          currentMonth={model.currentMonth}
          recordedIkram={model.wasteSummary(month).ikram}
        />
      </div>

      <div className="mt-4">
        {/* Süzgeçler (?durum=eslesmeyen, ?ara, ?sirala) adreste; tablo istemcide okur, sunucuya istek gitmez */}
        <SalesTable
          rows={rows}
          products={products}
          mappings={mappingList}
          month={month}
          lafposMonth={lafpos?.source === "lafpos"}
          totals={{
            qty: sales.qty,
            revenue: sales.revenue,
            net: sales.net,
            cost: sales.cost,
            commission: sales.commission,
            grossProfit: sales.grossProfit,
            margin: sales.margin,
          }}
        />
      </div>
    </>
  );
}

/**
 * LafPOS'a geçildiyse ayın kaynağı ve sorunları (src/lib/lafpos/sales.ts › lafposMonthNotes): geçiş ayında bilgi satırı
 * ve uyarılar (eksik günler, sayılmayan LafPOS günleri, liste ↔ Z farkı); LafPOS ayında bilgi İçe aktar kartında, burada
 * yalnız uyarı (sayılmayan ModPOS listesi). Yalnız yönetici (sayfa requireAdmin)
 */
function LafposBand({ notes, source }: { notes: LafposMonthNotes; source: "gecis" | "lafpos" }) {
  if (source === "lafpos" && !notes.warnings.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {source === "gecis" ? <Notice tone="neutral" title={notes.info} /> : null}
      {/* Her ay uyarısı ayrı kutu; ayın rakamını bozar, katlanmaz (veri) */}
      {notes.warnings.map((w) => (
        <Notice key={w} tone="warn" risk="veri" title={w} />
      ))}
    </div>
  );
}

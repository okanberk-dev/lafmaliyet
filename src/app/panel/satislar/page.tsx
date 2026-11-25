import { eq, sql } from "drizzle-orm";
import { Banknote, ShoppingBag, TrendingUp, Unlink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BranchChooser } from "@/components/panel/branch-chooser";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SalesSourceLine } from "@/components/panel/sales-source-line";
import { GrowthPill, PageSkeleton, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { ALL_BRANCHES, DEFAULT_BRANCH_ID, tillBranches } from "@/lib/branches";
import { listDaysText } from "@/lib/calc/insights";
import { lafposListPart, manualOf, MONTH_FIELDS } from "@/lib/cash-month";
import { RECIPE_COST_NOTE } from "@/lib/constants";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { commonListText, dayRangeTR, lafposMonthNotes, lafposMonthStatus, type LafposMonthNotes } from "@/lib/lafpos/sales";
import { branchSwitchDay, isLafposBranch, lafposBranchOf, monthSource } from "@/lib/lafpos/switch";
import { addDays, dayAblativeTR, todayTR } from "@/lib/reminders";
import { coverageFor } from "@/lib/sales-coverage";
import { salesSourceOf, type SalesSourceKind } from "@/lib/sales-source";
import { requireAdmin } from "@/server/auth/dal";
import { andWhere, branchWhere, currentBranchScope, currentWriteBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
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
  const common = model.ds.commonLists?.find((c) => c.month === month) ?? null;

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
    // LafPOS satırının indirimden önceki liste değeri ve eki (Faz 2); ModPOS satırında yok
    gross: l.line.gross ?? null,
    isAddon: l.line.isAddon ?? false,
  }));
  const unmatched = sales.unmatched.length;
  const mappingList = mappings.map((m) => ({ posName: m.posName, productId: m.productId, isService: m.isService, updatedAt: m.updatedAt }));
  // Formda yalnız elle yazılanlar; kasa raporlarından gelenler formda "Kasadan" olarak ayrıca gösterilir. Form şubenin ay
  // satırını düzenler, Tümü'nün toplamını değil (toplam forma yazılıp kaydedilseydi öteki şubenin cirosu iki kez
  // sayılırdı; denetim 13 Kasım HM-02). "Tümü"de birden çok kasa açıkken form çizilmez, şube sorulur (aşağıda); tek kasada
  // o kasanın
  const [writeId, scope, branches] = await Promise.all([currentWriteBranch(), currentBranchScope(), listBranches()]);
  const formInfo = info?.byBranch ? info.byBranch[writeId] : info;
  // Birden çok kasanın toplamıyken form hangi şubeye yazdığını adıyla söyler; liste ↔ POS kutusu çıkmaz (liste bütün
  // şubelerin, POS cirosu yalnız yazılan şubenin olurdu)
  const formBranch = model.ds.monthTotalsLocked ? (branches.find((b) => b.id === writeId)?.name ?? writeId) : null;
  // Online kanal seçili: kanalın kasa satışı yok, liste ve ay bilgisi yazılmaz (sunucu da reddeder, formBranch "sales")
  const channel = branches.find((b) => b.id === scope && b.kind !== "fiziksel") ?? null;
  // Listenin ve elle satırın yazılabileceği şubeler (docs/SUBE.md › Yazarken hangi şube): tek şubede o şube; "Tümü"de
  // açık kasalar, ayı LafPOS'tan gelen şube hariç. Birden çoksa form şubeyi sorar, varsayılan yok. Her şubenin bu ayki
  // ModPOS satırları "Yenisiyle değiştir"in onayı için
  const tills = channel ? [] : scope === ALL_BRANCHES ? tillBranches(branches) : branches.filter((b) => b.id === scope);
  const linesOf = (id: string) => sales.lines.filter((l) => !l.line.lafpos && (l.line.branchId ?? DEFAULT_BRANCH_ID) === id).length;
  // LafPOS'un şubesi kütükten (lafposBranchOf): ayı LafPOS'tan gelen şube yalnız o
  const lafposBranch = lafposBranchOf(branches);
  const writable = tills
    .filter((b) => monthSource(month, branchSwitchDay(model.settings.lafposGecisGunu, b.id, lafposBranch)) !== "lafpos")
    .map((b) => ({ id: b.id, name: b.name, lines: linesOf(b.id) }));
  // "Ayı temizle"nin sileceği satırlar (pencerenin kapsamı; sunucu aynı sayımla karşılaştırır)
  const [{ n: clearCount }] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.salesLines)
    .where(andWhere(eq(s.salesLines.month, month), branchWhere(s.salesLines.branchId, scope)));
  const infoValues = {
    openDays: manualOf(formInfo, "openDays"),
    posRevenue: manualOf(formInfo, "posRevenue"),
    discounts: manualOf(formInfo, "discounts"),
    offRevenue: manualOf(formInfo, "offRevenue"),
    cardShare: manualOf(formInfo, "cardShare"),
    note: formInfo?.note ?? null,
  };
  // "Ayı temizle › ay bilgileri de" yalnız elle yazılanları siler (kasadan gelenler raporlarla kalır)
  // "Tümü"de temizlik bütün şubelerin ay bilgisini siler: şubelerden birinde elle yazılan varsa seçenek çıkar (Tümü'nün
  // kaynağı o zaman "manual"; formun gösterdiği yalnız Tuzla'nınkidir)
  const hasInfo = MONTH_FIELDS.some((f) => manualOf(info, f) !== null) || Boolean(info?.note);
  // Bir ürüne ya da HİZMET'e bağlanmış satırların ciro payı (kalanın maliyeti tahmini)
  const assignedRevenue = rows.reduce((a, r) => a + (r.matched || r.isService ? r.revenue : 0), 0);
  const coverage = sales.revenue ? assignedRevenue / sales.revenue : 0;
  // Kartların dökümü (karta dokununca açılan pencere): aynı ay satırlarından, yeni sorgu yok
  const breakdown = salesBreakdowns(sales, model.settings, month, model.cardShareOf(month).rate, model.salesPosCommission(month));
  const label = monthLabel(month);
  // ModPOS listesinin satırları (LafPOS'un ay toplamları ayrı); LafPOS ayında sayılmayan listenin satırları
  const modposLines = lafpos?.source === "lafpos" ? (lafpos.modpos?.lines ?? 0) : rows.filter((r) => r.lafposDays === null).length;
  // Tablodaki LafPOS satırları (geçiş ayında kartın metinleri iki kaynağı ayrı söyler)
  const lafposLines = rows.filter((r) => r.lafposDays !== null).length;
  // Yüklü listenin son günü (kartın "… tarihine kadar"ı): yeni yüklemenin değiştireceği ya da ekleneceği liste, yani
  // yazılan şubeninki: kendi kaydı (writeCoverage; ay yoksa ayın tamamı), Marina'nın listesinin günü (lafpos.modpos) ya
  // da son yükleyenin ortak kaydı değil. Yazılan şubenin listesi yoksa geçiş gününden sonra LafPOS'un şubesinin listesi,
  // öncesinde görünümün kapsamı. "Tümü"de birden çok şubeye yüklenebiliyorsa kart şubeyi sorar: tek bir gün (Tuzla'nınki)
  // yazılmaz, satır sayısı bütün şubelerin
  const writeHasList = sales.lines.some((l) => !l.line.lafpos && (l.line.branchId ?? DEFAULT_BRANCH_ID) === writeId);
  const coveredThrough =
    writable.length > 1
      ? null
      : writeHasList
        ? (model.ds.writeCoverage?.[month] ?? null)
        : lafpos
          ? (lafpos.modpos?.through ?? null)
          : (model.ds.salesCoverage?.find((c) => c.month === month)?.through ?? null);

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
      {/* "Tümü"nün dönemi şubelerin en kısa listesiyle (bulgu 62): kısaltan şube adıyla */}
      {common ? <Notice tone="neutral" size="sm" title="Tümü'de satışlar şubelerin ortak döneminden" text={commonListText(month, common.branch, common.through)} /> : null}

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
            info="Reçetesi olmayan ürünlere eşleşenlerin ortalama maliyet oranı uygulanır (tahmini maliyet)."
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

      {channel ? (
        // Online kanal: kasa satışı yok; liste ve ay bilgisi şubelerde yazılır (formBranch "sales" reddeder)
        <Notice
          tone="neutral"
          className="mt-4"
          title={`${channel.name} kanalında kasa satışı yok`}
          text="ModPOS listesi ve ay bilgisi şubelerde yazılır; yüklemek için şube seçiciden şubeyi seçin."
        />
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-12">
          <ImportCard
            className="xl:col-span-7"
            month={month}
            label={monthLabel(month)}
            branches={writable}
            scope={scope}
            clearCount={clearCount}
            lineCount={modposLines}
            lafposLines={lafposLines}
            mappings={mappingList}
            products={products}
            hasInfo={hasInfo}
            running={runningImport}
            coveredThrough={coveredThrough}
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
          {model.ds.monthTotalsLocked && tills.length > 1 ? (
            // "Tümü"de birden çok kasa: ay bilgisi (ciro, açık gün, indirim, ödenmez, not) şube başınadır, Tümü toplamdır.
            // Gelir-gider gibi yazılmaz, şube sorulur (önceden form sessizce Tuzla'nınkini açıp yazıyordu; şube kapsamı
            // inceleme bulgusu). Düğme sayfayı o şubeyle açar
            <div className="xl:col-span-5">
              <BranchChooser
                title="Hangi şubenin ay bilgisi?"
                description="Ciro, açık gün, indirim, ödenmez ve ay notu şube başına girilir; Tümü şubelerin toplamıdır. Şubeyi seçin, form o şubenin bilgisiyle açılır."
                path="/panel/satislar"
                params={{ ay: month }}
                branches={tills}
              />
            </div>
          ) : (
            <MonthInfoForm
              // Ay bilgisi başka yerden değişince (Ayı temizle, Gelir-gider, yeni kasa raporu) form yeni değerlerle açılsın
              key={`${month}|${JSON.stringify(infoValues)}|${JSON.stringify(formInfo?.kasa?.values ?? null)}`}
              className="xl:col-span-5"
              month={month}
              label={monthLabel(month)}
              branchId={writeId}
              branchName={formBranch}
              info={infoValues}
              kasa={formInfo?.kasa ?? null}
              settingsCardShare={model.settings.kartOrani}
              listTotal={formBranch ? null : sales.revenue}
              listPeriod={
                !formBranch && listPeriod ? { label: listDaysText(listPeriod), posRevenue: listPeriod.posRevenue, discounts: listPeriod.discounts } : null
              }
              // LafPOS günlerinin indirimi satırlarda zaten düşülmüş (engine listDiscounts); "Tümü"de yalnız formun şubesi LafPOS'unsa
              lafposList={
                !formBranch && formInfo && (!info?.byBranch || isLafposBranch(writeId, lafposBranch)) ? lafposListPart(formInfo, model.ds.lafposSales?.countFrom ?? null) : null
              }
              currentMonth={model.currentMonth}
              recordedIkram={model.wasteSummary(month).ikram}
            />
          )}
        </div>
      )}

      <div className="mt-4">
        {/* Süzgeçler (?durum=eslesmeyen, ?ara, ?sirala) adreste; tablo istemcide okur, sunucuya istek gitmez */}
        <SalesTable
          rows={rows}
          products={products}
          mappings={mappingList}
          month={month}
          lafposMonth={lafpos?.source === "lafpos"}
          lineBranches={writable.map((b) => ({ id: b.id, name: b.name }))}
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
  // Tutmayan denetim (ModPOS listesi − indirim ↔ Z) bilgi kutusu: %5'i aşan fark ayrıca uyarılarda (modposOverZText),
  // aynı fark iki kez uyarı tonunda görünmez. Tutanlar tek satır (sakin)
  const off = notes.checks.filter((c) => !c.ok);
  const ok = notes.checks.filter((c) => c.ok);
  if (source === "lafpos" && !notes.warnings.length && !off.length && !ok.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {source === "gecis" ? <Notice tone="neutral" title={notes.info} /> : null}
      {/* Her ay uyarısı ayrı kutu; ayın rakamını bozar, katlanmaz (veri) */}
      {notes.warnings.map((w) => (
        <Notice key={w} tone="warn" risk="veri" title={w} />
      ))}
      {off.map((c) => (
        <Notice key={c.text} tone="neutral" title={c.text} />
      ))}
      {ok.length ? <p className="px-1 text-xs text-ink-mute">{ok.map((c) => c.text).join(" · ")}</p> : null}
    </div>
  );
}

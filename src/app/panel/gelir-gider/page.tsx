import { Banknote, Percent, PiggyBank, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { daysInMonth, yearMonths, type PnlRowDef } from "@/lib/calc/engine";
import { manualOf } from "@/lib/cash-month";
import { missingRevenueText, yearTotals } from "@/lib/calc/insights";
import { MONTH_NAMES } from "@/lib/constants";
import { monthLabel, pct, tl } from "@/lib/format";
import { periodKasa } from "@/lib/lafpos/kasa";
import { salesMonthsToPull } from "@/lib/site-sales/calc";
import { employerRateNotice, rateText } from "@/lib/tax/edit";
import { requireAdmin } from "@/server/auth/dal";
import { loadExpectedDebtsInYear } from "@/server/data/cari";
import { loadModel } from "@/server/data/dataset";
import { loadTaxSettings } from "@/server/data/tax";
import { siteLinkSecret, siteUrl } from "@/server/site-link";
import { readSalesState, SITE_SALES_FIRST_MONTH } from "@/server/site-sales/sync";

import { pnlRowLabel, revenueBreakdown, yearBreakdowns } from "./breakdowns";
import { CountUp, PnlGrid, YearPicker, type GridSection, type StripMonth } from "./pnl-grid";
import { SgkRateNotice } from "./sgk-rate-notice";
import { SiteSalesCard, type SiteSalesCardData } from "./site-sales-card";

export const metadata: Metadata = { title: "Gelir-gider" };

const DESCRIPTION = "Aylık gelir-gider tablosu (KDV hariç). Mal alışları faturalardan, sabit giderler ayın gün oranıyla otomatik gelir.";

const SECTION_LABELS: Record<string, string> = {
  mal: "Mal alışları",
  devir: "Devirler",
  personel: "Personel giderleri",
  faturalar: "Faturalar",
  kira: "Kira",
  genel: "İşletme genel giderleri",
  komisyon: "Komisyon giderleri",
  toplam: "Toplamlar",
  sonuc: "Maliyet",
  oran: "Oranlar",
};

const NO_TOTAL = new Set(["stock:opening", "stock:closing"]);

const MAX_YEAR_TABS = 5;

export default function PnlPage({ searchParams }: PageProps<"/panel/gelir-gider">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Finans" title="Gelir-gider" excel="Genel Maliyet" description={DESCRIPTION} />
          <PageSkeleton rows={14} />
        </>
      }
    >
      <PnlContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PnlContent({ searchParams }: { searchParams: PageProps<"/panel/gelir-gider">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  // Vergi ayarları yalnız SGK oranı uyarısı için (K19); okunamazsa uyarı çıkmaz, tablo etkilenmez
  const [model, salesState, taxSettings] = await Promise.all([
    loadModel(),
    readSalesState(),
    loadTaxSettings().catch((e) => {
      console.error("[gelir-gider] vergi ayarları", e);
      return null;
    }),
  ]);
  const known = [...model.monthInfo.keys(), ...model.ds.invoices.map((i) => i.date.slice(0, 7))].sort();
  const knownYears = new Set(known.map((k) => Number(k.slice(0, 4))));
  // Varsayılan yıl: bu yıl (verisi varsa); yoksa verisi olan son yıl. İleri tarihli tek bir kayıt tabloyu boş bir yıla atmasın.
  const thisYear = Number(model.currentMonth.slice(0, 4));
  const latestYear = knownYears.has(thisYear) ? thisYear : known.length ? Number(known[known.length - 1].slice(0, 4)) : thisYear;
  const yilParam = Array.isArray(sp.yil) ? sp.yil[0] : sp.yil;
  const year = yilParam && /^\d{4}$/.test(yilParam) ? Number(yilParam) : latestYear;
  const months = yearMonths(year);
  const calcs = months.map((m) => model.pnlMonth(m));
  const current = model.currentMonth;
  // Yıl toplamları (kartlar ve tablonun yıl sütunu) tek kuraldan: bu aya kadar, POS cirosu girilmiş aylar (yearTotals;
  // Genel bakış, Claude ve Excel'in yıl sütunu da aynı). Bu ay sayılınca sonraki ayın açılış stoğu ay başlamadan onun
  // gideri görünürdü (denetim E-16); cirosu girilmemiş ayın gideri de kâra girmez (NEW-02, inceleme B02-D4). Tablo o
  // ayların sütunlarını yine gösterir
  const indexes = (keep: (m: string) => boolean) => months.flatMap((m, i) => (keep(m) ? [i] : []));
  const throughIdx = indexes((m) => m <= current);
  const yt = yearTotals(model, year);
  const countedIdx = indexes((m) => yt.counted.includes(m));
  // Faturası beklenen cari alımlar (bilgi satırı; gidere girmez, fatura gelince fatura gider olur). Okunamazsa satır yok
  const expected = await loadExpectedDebtsInYear(year).catch((e) => {
    console.error("[gelir-gider] faturası beklenen alımlar", e);
    return {};
  });
  const defs = model.pnlRowDefs(months);
  const years = [...new Set([...known.map((k) => Number(k.slice(0, 4))), year])].sort();

  const totalOf = (key: string, idx: number[] = countedIdx): number | null => {
    const picked = idx.map((i) => calcs[i]);
    if (key.startsWith("ratio:")) {
      // Oranlar bütün cironun (ModPOS + laffogato.net online) payı
      const rn = picked.reduce((a, c) => a + (c.revenueTotalNet ?? 0), 0);
      if (!rn) return null;
      const num =
        key === "ratio:expenses" ? totalOf("total:expenses", idx) : key === "ratio:profit" ? totalOf("profit", idx) : totalOf(`total:${key.slice(6)}`, idx);
      return num === null ? null : num / rn;
    }
    if (NO_TOTAL.has(key)) return null;
    const vals = picked.map((c) => model.pnlValue(c, key).value);
    if (vals.every((v) => v === null)) return null;
    return vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  };

  // Satır adları: tedarikçi ve sabit gider adları girildiği gibi, diğerleri cümle düzeninde
  const fixedNames = new Map(model.ds.fixedExpenses.map((f) => [`fixed:${f.id}`, f.name]));
  // Sabit gider satırının alt yazısı: yıl içinde başlayan ya da biten kalem hangi aylarda sayıldığını söylesin
  const yearStart = months[0];
  const yearEnd = months[months.length - 1];
  const fixedSub = new Map<string, string | undefined>(
    model.fixedList.map((f) => {
      const parts: string[] = [];
      if (f.startMonth && f.startMonth > yearStart && f.startMonth <= yearEnd && (!model.firstDataMonth || f.startMonth > model.firstDataMonth)) {
        parts.push(`${monthLabel(f.startMonth)} itibarıyla`);
      }
      if (f.endMonth && f.endMonth >= yearStart && f.endMonth < yearEnd) parts.push(`son ay ${monthLabel(f.endMonth)}`);
      return [`fixed:${f.id}`, parts.length ? parts.join(" · ") : undefined];
    }),
  );
  const rowLabel = (def: PnlRowDef): string => pnlRowLabel(def, fixedNames);

  const sections: GridSection[] = [];
  for (const def of defs) {
    let sec = sections.find((x) => x.key === def.section);
    if (!sec) {
      sec = { key: def.section, label: SECTION_LABELS[def.section] ?? def.section, rows: [] };
      sections.push(sec);
    }
    sec.rows.push({
      def: { ...def, label: rowLabel(def), sub: def.sub ?? fixedSub.get(def.key) },
      cells: calcs.map((c) => model.pnlValue(c, def.key)),
      total: totalOf(def.key),
    });
  }

  const openDays = calcs.map((c) => c.info?.openDays ?? null);
  // Açık gün kasa raporlarından da gelir: kasanın değeri hesaplanan gibi, elle yazılan onun üzerine yazılmış sayılır
  const openDaysKasa = calcs.map((c) => c.info?.kasa?.values.openDays ?? null);
  const openDaysManual = calcs.map((c) => manualOf(c.info, "openDays"));
  // Ay sütunu başlığındaki not (Satışlar'daki ay notuyla aynı alan) ve ayın gün sayısı (açık gün sınırı)
  const monthNotes = calcs.map((c) => c.info?.note ?? null);
  const dims = months.map(daysInMonth);
  const activeMonths = months.filter(
    (m, i) => m <= current && (calcs[i].revenue !== null || calcs[i].expenses !== 0 || openDays[i] !== null || calcs[i].site !== null),
  );
  // Ciro: ModPOS (KDV hariç) + laffogato.net online satışı (KDV hariç; çekilmemiş ayda yok); yalnız cirosu girilmiş aylar
  const { revenueNet, online, expenses, profit } = yt;

  // laffogato.net online satışları kartı: yılın çekilmiş ayları, elle çekilebilecek aylar
  const siteCard: SiteSalesCardData = {
    configured: Boolean(siteLinkSecret()),
    lastPullAt: salesState.lastPullAt,
    lastOkAt: salesState.lastOkAt,
    lastError: salesState.lastError,
    months: months
      .map((m) => ({ m, rec: model.siteSales(m), rev: model.siteRevenue(m) }))
      .filter((x) => x.rec && x.rev)
      .reverse()
      .map(({ m, rec, rev }) => ({
        month: m,
        pulledAt: rec!.pulledAt,
        closed: rec!.closed,
        cafe: rev!.cafe,
        shop: rev!.shop,
        karaoke: rev!.karaoke,
        total: rev!.total,
        cafeOrders: rec!.cafe.orders,
        shopOrders: rec!.shop.orders,
        bookings: rec!.karaoke.bookings,
        manualOrders: rec!.manual.orders,
        manualNet: rec!.manual.netMinor / 100,
        // Kasada ödenen uygulama / web siparişleri (ModPOS'ta da var) ve iadesi bekleyen karaoke: bilgi, ciroya girmez
        counterOrders: rec!.counter?.orders ?? 0,
        counterNet: (rec!.counter?.netMinor ?? 0) / 100,
        refundPending: rec!.karaoke.refundPendingMinor / 100,
        unmapped: model.siteLines(m).unmapped.length,
      })),
    choices: months.filter((m) => m <= current && m >= SITE_SALES_FIRST_MONTH).reverse(),
    // Günlük işle aynı aylar: bu ay ve önceki iki ay (geç gelen iadeler kapanmış ayı düşürür)
    refreshMonths: salesMonthsToPull(`${current}-01`).filter((m) => m >= SITE_SALES_FIRST_MONTH),
    sitePanelUrl: `${siteUrl()}/admin`,
    kdvRate: model.settings.kdv,
    serviceKdvRate: model.settings.kdvHizmet,
    switchDay: model.settings.lafposGecisGunu,
    current,
  };

  // Yılın 12 ayı: kâr yeşil, zarar kırmızı, cirosu girilmemiş aktif ay sarı, boş ay ve bu aydan sonrası gri; verisi olan
  // son ay çerçeveli. Kapanış sayımı olmayan ayda mal maliyeti tahmini (kapanış stoğu 0)
  const latestMonth = activeMonths[activeMonths.length - 1];
  const strip: StripMonth[] = months.map((m, i) => {
    const c = calcs[i];
    const name = MONTH_NAMES[i];
    const short = name.slice(0, 3);
    const last = m === latestMonth ? " (son ay)" : "";
    if (!activeMonths.includes(m)) return { key: m, short, tone: "empty", label: m > current ? `${name}: henüz başlamadı` : `${name}: veri yok` };
    if (c.revenue === null) return { key: m, short, tone: "warn", label: `${name}${last}: ciro girilmedi · giderler ${tl(c.expenses)} (yıl kârına girmez)` };
    const guess = yt.uncounted.includes(m) ? " · ay sayılmadı: mal maliyeti tahmini" : "";
    return { key: m, short, tone: c.profit < 0 ? "bad" : "good", label: `${name}${last}: ${c.profit < 0 ? "zarar" : "kâr"} ${tl(c.profit)}${guess}` };
  });
  const cogs = yt.cogs;
  const cogsRatio = revenueNet ? cogs / revenueNet : null;
  // Kartların dökümü (karta dokununca): tablonun yıl sütunuyla aynı aylardan (cirosu girilmiş, bu ay ya da öncesi), sunucuda
  const breakdown = {
    ...yearBreakdowns(
      sections,
      countedIdx.map((i) => calcs[i]),
      periodKasa(
        countedIdx.map((i) => months[i]),
        model.settings.lafposGecisGunu,
      ).short,
    ),
    revenue: revenueBreakdown(
      throughIdx.map((i) => calcs[i]),
      activeMonths,
    ),
  };
  // Yıl kartlarının notu: toplama girmeyen aylar ve sayımı olmayan aylar (tablo bu ayları yine gösterir)
  // Ayarlar'daki işveren SGK oranı (bu tablo ve Excel) vergi ve nakit planının yasal oranından farklıysa (K17, K19)
  const sgkNotice = taxSettings ? employerRateNotice(model.settings.isverenSgk, taxSettings, Number(current.slice(0, 4))) : null;
  const yearNotes = [
    ...yt.missingRevenue.map(missingRevenueText),
    ...(yt.uncounted.length ? [`${yt.uncounted.map((m) => monthLabel(m)).join(", ")}: ay sonu sayımı yok, mal maliyeti tahmini (kapanış stoğu 0 sayıldı)`] : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Finans"
        title="Gelir-gider"
        excel="Genel Maliyet"
        description={DESCRIPTION}
        actions={
          // Tek yıl varsa seçim göstermeyiz (tek seçenekli sekme düğme gibi durur, bir şey yapmaz)
          years.length < 2 ? null : years.length <= MAX_YEAR_TABS ? (
            <SegmentedLinks
              label="Yıl"
              value={String(year)}
              options={years.map((y) => ({ value: String(y), label: String(y), href: `/panel/gelir-gider?yil=${y}` }))}
            />
          ) : (
            <YearPicker year={year} years={years} />
          )
        }
      />
      {/* Vergi bölümündeki karşılığı (dalga 12, docs/VERGI.md) */}
      <p className="-mt-2 mb-4 text-[13px] text-ink-mute">
        Vergiye göre karşılığı:{" "}
        <Link href="/panel/vergi/gelir-gider" className="font-medium text-ink underline underline-offset-2">
          Vergi › Vergiye göre
        </Link>
      </p>
      {sgkNotice ? <SgkRateNotice text={sgkNotice.text} target={sgkNotice.target} targetText={rateText(sgkNotice.target)} canApply={sgkNotice.canApply} /> : null}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title={`${year} cirosu`}
          description={`Ay ay ciro (KDV hariç): Satışlar'a girilen POS cirosundan ${pct(model.ds.settings.kdv, 0)} KDV düşülür (HİZMET işaretli satırlar, karaoke odası: ${pct(model.ds.settings.kdvHizmet, 0)}); laffogato.net online satışları (KDV hariç) eklenir. Yıl kartlarına bu aya kadar, POS cirosu girilmiş aylar girer (Genel bakış ve Claude da aynı kuralla). Aya dokununca Satışlar'da o ay açılır.`}
          groups={breakdown.revenue}
          total={revenueNet}
          totalLabel="Ciro (KDV hariç)"
          order="given"
          empty="Bu yıl ciro girilmedi."
        >
          <Stat
            icon={<Banknote />}
            label={`${year} ciro (KDV hariç)`}
            value={<CountUp value={revenueNet} />}
            sub={online ? `${yt.counted.length} ay · online ${tl(online)}` : `${yt.counted.length} ayın toplamı`}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${year} giderleri`}
          description="Yılın giderleri bölüm bölüm, kalem kalem (KDV hariç). Pay, yılın bütün giderleri içinde."
          groups={breakdown.expenses}
          total={expenses}
          totalLabel="Giderler toplamı"
          empty="Bu yıl gider yok."
        >
          <Stat
            icon={<Wallet />}
            label={`${year} giderler`}
            value={<CountUp value={expenses} />}
            sub={revenueNet ? `Cironun ${pct(expenses / revenueNet, 0)}` : null}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${year} kâr / zarar`}
          description={`Ciro (KDV hariç) − giderler, bölüm bölüm; bu aya kadar, POS cirosu girilmiş ${yt.counted.length} ay. Ayrıntısı Giderler kartında.${yearNotes.length ? ` ${yearNotes.join(". ")}.` : ""}`}
          groups={breakdown.profit}
          total={profit}
          totalLabel="Kâr / zarar"
          order="given"
          shares={false}
          empty="Bu yıl ciro ya da gider yok."
        >
          <Stat
            icon={<PiggyBank />}
            label={`${year} kâr / zarar`}
            value={<CountUp value={profit} />}
            tone={profit < 0 ? "bad" : "good"}
            sub={revenueNet ? `Kâr oranı ${pct(profit / revenueNet)}` : null}
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${year} satılan mal maliyeti`}
          description={`Mal alışları (tedarikçi tedarikçi) ve stok devri, yıl toplamı (KDV hariç).${cogsRatio !== null ? ` Ciroya oranı ${pct(cogsRatio)}.` : ""}`}
          groups={breakdown.cogs}
          total={cogs}
          totalLabel="Satılan mal maliyeti"
          empty="Bu yıl mal alışı yok."
        >
          <Stat
            icon={<Percent />}
            label="Mal maliyeti oranı"
            value={<CountUp value={cogsRatio} format="pct" />}
            sub="Stok sayımı girilirse devir düşülür"
            info="Ay içinde satılan mal maliyeti = önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)."
          />
        </StatBreakdown>
      </div>
      {/* Yıl kartlarına girmeyen aylar (tablo onları yine gösterir): cirosu girilmemiş ayın gideri, sayımı olmayan ay */}
      {yearNotes.length ? (
        <p className="-mt-3 mb-6 text-xs text-pretty text-ink-mute" role="note">
          Yıl kartları bu aya kadar, POS cirosu girilmiş {yt.counted.length} ayın toplamı. {yearNotes.join(" · ")}.
        </p>
      ) : null}
      <div className="mb-6">
        <SiteSalesCard data={siteCard} />
      </div>
      {/* Yıl değişince tablo yeniden kurulur: "Aktif aylar / 12 ay" seçimi o yılın verisine göre baştan belirlenir */}
      <PnlGrid
        key={year}
        year={year}
        months={months}
        activeMonths={activeMonths}
        sections={sections}
        openDays={openDays}
        openDaysKasa={openDaysKasa}
        openDaysManual={openDaysManual}
        dims={dims}
        monthNotes={monthNotes}
        currentMonth={model.currentMonth}
        strip={strip}
        latestMonth={latestMonth}
        expectedDebts={expected}
        lafposSwitch={model.settings.lafposGecisGunu}
        yearNote={
          yt.counted.length < activeMonths.length
            ? { short: `cirosu girilmiş ${yt.counted.length} ay`, long: [`${year} yılı: bu aya kadar, POS cirosu girilmiş ${yt.counted.length} ay (yıl kartları gibi)`, ...yearNotes].join(". ") }
            : null
        }
      />
    </>
  );
}

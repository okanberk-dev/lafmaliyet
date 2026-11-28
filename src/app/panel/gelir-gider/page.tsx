import { Banknote, Percent, PiggyBank, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { HashScroll } from "@/components/panel/hash-scroll";
import { BranchViewChip } from "@/components/panel/branch-view-chip";
import { PageHeader } from "@/components/panel/page-header";
import { SalesSourceLine } from "@/components/panel/sales-source-line";
import { Card, CardHeader } from "@/components/ui/card";
import { InfoTip, PageSkeleton, Stat } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { branchBreakdown, type BranchBreakdown } from "@/lib/branch-breakdown";
import { branchViewNote, monthWriteBranch, monthWriteLock, monthWriteNote } from "@/lib/branches";
import { daysInMonth, uncountedCogsSummary, yearMonths, type PnlRowDef } from "@/lib/calc/engine";
import { manualOf } from "@/lib/cash-month";
import { missingRevenueText, yearTotals } from "@/lib/calc/insights";
import { MONTH_NAMES } from "@/lib/constants";
import { monthLabel, pct, tl } from "@/lib/format";
import { periodKasa } from "@/lib/asilpos/kasa";
import { can, isReadOnly, openableHref, removedNotice } from "@/lib/roles";
import { periodSalesSource } from "@/lib/sales-source";
import { cn } from "@/lib/utils";
import { salesMonthsToPull, siteGross } from "@/lib/site-sales/calc";
import { requireCan } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadExpectedDebtsInYear } from "@/server/data/cari";
import { loadModel } from "@/server/data/dataset";
import { siteLinkSecret, siteUrl } from "@/server/site-link";
import { readSalesState, SITE_SALES_FIRST_MONTH } from "@/server/site-sales/sync";

import { pnlRowLabel, revenueBreakdown, yearBreakdowns } from "./breakdowns";
import { CountUp, PnlGrid, YearPicker, type GridSection, type StripMonth } from "./pnl-grid";
import { SiteSalesCard, type SiteSalesCardData } from "./site-sales-card";

export const metadata: Metadata = { title: "Gelir-gider" };

const DESCRIPTION = "Ay ay gelir, gider ve kâr / zarar (KDV hariç); su faturası gibi tutarları yazın.";
/**
 * Salt okunur hesabın (muhasebeci; docs/ROLLER.md) ve yükleme iskeletinin açıklaması: tutar yazmayı önermez. Rol okunana
 * kadar iki rolün ortak cümlesi çizilir (Kasa raporu'ndaki gibi en dar olan)
 */
const READ_ONLY_DESCRIPTION = "Ay ay gelir, gider ve kâr / zarar (KDV hariç).";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE = "Aylık gelir-gider tablosu (KDV hariç). Mal alışları faturalardan, sabit giderler ayın gün oranıyla otomatik gelir.";

const SECTION_LABELS: Record<string, string> = {
  mal: "Mal alışları",
  devir: "Devirler",
  personel: "Personel giderleri",
  faturalar: "Faturalar",
  kira: "Kira",
  genel: "İşletme genel giderleri",
  komisyon: "Komisyon giderleri",
  // Yalnız şube seçiliyken: işletme geneli giderlerin toplamı, kâra girmez (Faz 5)
  isletme: "İşletme geneli (bilgi)",
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
          {/* Rol okunana kadar en dar başlık (iki rolün açtığı ekran): yazmayı önermeyen açıklama, muhasebecinin bağlamı */}
          <PageHeader path="/panel/gelir-gider" role="accountant" title="Gelir-gider" description={READ_ONLY_DESCRIPTION} />
          <PageSkeleton rows={14} />
        </>
      }
    >
      <PnlContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PnlContent({ searchParams }: { searchParams: PageProps<"/panel/gelir-gider">["searchParams"] }) {
  // Yönetici ve muhasebeci (docs/ROLLER.md). Muhasebeci salt okur: tablo ona girilebilir hücre, ay notu, "Siteden yenile"
  // ve açamayacağı ekrana (Satışlar, Stok sayımı, Maaşlar, Sabit giderler, Tedarikçiler) bağlantı çizmez (isReadOnly,
  // openableHref); sunucu eylemleri ayrıca reddeder
  const viewer = await requireCan("muhasebe.oku");
  const readOnly = isReadOnly(viewer.role);
  // Personel hücrelerinin kişi kişi metni (part-time'ın adı, günü, günlük ücreti; yemek kartının AsilPOS'lularının adı)
  // yalnız maaşı görenin: muhasebeci personel giderlerini toplam olarak görür (docs/ROLLER.md › Muhasebeci). Hücreler
  // istemciye (PnlGrid, ay görünümü) ipucu ve uyarısıyla gider, metin motorda kişisiz kurulur
  const personal = can(viewer.role, "maas");
  const sp = await searchParams;
  // Kaldırılan Mutabakat'ın eski adresinden gelindi (/panel/mutabakat → ?kaldirildi=mutabakat; src/lib/roles.ts RETIRED_PATHS)
  const removed = removedNotice(sp.kaldirildi);
  const [model, salesState, monthWrite, branchList] = await Promise.all([
    loadModel({ personal }),
    readSalesState(),
    // Ay hücrelerinin (ciro, açık gün, ay notu) yazdığı şube ve yazılamıyorsa nedeni: "Tümü"de (birden çok kasa açıkken)
    // şubelerin toplamıdır, online kanalın kasa satışı yok. Hücre şubeyi gönderir (gönderim anındaki seçime değil);
    // okunamazsa hücreler kilitli
    Promise.all([currentBranchScope(), listBranches()])
      .then(([scope, branches]) => ({ note: monthWriteNote(scope, branches), lock: monthWriteLock(scope, branches), branch: monthWriteBranch(scope, branches) }))
      .catch(() => ({ note: null, lock: "Şube seçimi okunamadı; sayfayı yenileyin.", branch: null })),
    // Tümü'nün şube kırılımı (Faz 5): açık fiziksel şubeler; okunamazsa kart yok
    listBranches().catch(() => []),
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
  // Genel bakış, Claude ve dışa aktarımın yıl sütunu da aynı). Bu ay sayılınca sonraki ayın açılış stoğu ay başlamadan onun
  // gideri görünürdü (denetim E-16); cirosu girilmemiş ayın gideri de kâra girmez (NEW-02, inceleme B02-D4). Tablo o
  // ayların sütunlarını yine gösterir
  const indexes = (keep: (m: string) => boolean) => months.flatMap((m, i) => (keep(m) ? [i] : []));
  const throughIdx = indexes((m) => m <= current);
  // Başlığın satış kaynağı satırı yılın bu aya kadarki aylarından (yıl tablosu; karışık yılda "ModPOS / AsilPOS"). Henüz
  // başlamamış yılda yılın ilk ayı
  const sourceMonths = throughIdx.length ? throughIdx.map((i) => months[i]) : months.slice(0, 1);
  const yt = yearTotals(model, year);
  // Şube görünümü (soldaki seçici; docs/SUBE.md): bilgi notu, mal maliyeti şubenin satışından reçeteye göre
  const branchNote = model.ds.branchView ? branchViewNote(model.ds.branchView, { sharedHidden: Boolean(model.ds.sharedCostsHidden) }) : null;
  // "Tümü"nün şube kırılımı (Faz 5, sahibin kararı 4; docs/SUBE.md): birden çok fiziksel şube açıkken, yıl kartlarıyla aynı
  // aylar. Her şube kendi görünümündeki gibi (işletme geneli şubeye bölünmez), işletme geneli ayrı sütunda bir kez.
  // Okunamazsa kart çizilmez
  const physical = branchList.filter((b) => b.active && b.kind === "fiziksel");
  const branchSplit =
    !model.ds.branchView && physical.length > 1 && yt.counted.length
      ? await Promise.all(physical.map(async (b) => ({ id: b.id, name: b.name, model: await loadModel({ scope: b.id, personal }) })))
          .then((list) =>
            branchBreakdown(
              list.map((x) => ({ id: x.id, name: x.name, months: yt.counted.map((m) => x.model.pnlMonth(m)) })),
              yt.counted.map((m) => model.pnlMonth(m)),
              // Fiziksel olmayan kanala (online) yazılan giderin sütunu kanalın adıyla (inceleme bulgusu 5)
              Object.fromEntries(branchList.map((b) => [b.id, b.name])),
            ),
          )
          .catch((e) => {
            console.error("[gelir-gider] şube kırılımı", e);
            return null;
          })
      : null;
  const countedIdx = indexes((m) => yt.counted.includes(m));
  // Faturası beklenen cari alımlar (bilgi satırı; gidere girmez, fatura gelince fatura gider olur). Okunamazsa satır yok.
  // Şube seçiliyken satır yok (şube ayrımı, 27 Kasım 2026): cari kaydının şubesi yok (supplier_entries.branch_id
  // gelene kadar), önceden Marina'nın Gelir-gider'inde Tuzla'nın beklenen alımları da görünüyordu
  const expected = model.ds.branchView
    ? {}
    : await loadExpectedDebtsInYear(year).catch((e) => {
        console.error("[gelir-gider] faturası beklenen alımlar", e);
        return {};
      });
  // Tutar herkese; tedarikçinin sayfasına bağlantı yalnız orayı açabilene (Tedarikçiler muhasebeciye kapalı)
  const expectedShown = Object.fromEntries(Object.entries(expected).map(([m, e]) => [m, { ...e, href: e.href ? openableHref(viewer.role, e.href) : null }]));
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
        // KDV dahil döküm: kafe + mağaza + karaoke (kasada ödenen ve elle girilen siparişler bu üçünün dışında)
        ...siteGross(rec!, model.settings.kdv, model.settings.kdvHizmet),
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
    switchDay: model.settings.asilposGecisGunu,
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
        model.settings.asilposGecisGunu,
      ).short,
    ),
    revenue: revenueBreakdown(
      throughIdx.map((i) => calcs[i]),
      activeMonths,
      viewer.role,
    ),
  };
  // Yıl kartlarının notu: toplama girmeyen aylar ve sayımı olmayan aylar (tablo bu ayları yine gösterir)
  // "Sayım gir" Stok sayımı'na götürür: yalnız orayı açabilene (muhasebeciye kapalı; uyarının kendisi kalır)
  const countHref = yt.uncounted.length ? openableHref(viewer.role, `/panel/sayim?ay=${yt.uncounted[yt.uncounted.length - 1]}`) : null;
  const yearNotes = [
    ...yt.missingRevenue.map(missingRevenueText),
    ...(yt.uncounted.length ? [`Ay sonu sayımı yok: ${uncountedCogsSummary((m) => model.pnlMonth(m).cogsMethod, yt.uncounted)}`] : []),
  ];

  return (
    <>
      <PageHeader
        path="/panel/gelir-gider"
        role={viewer.role}
        title="Gelir-gider"
        description={readOnly ? READ_ONLY_DESCRIPTION : DESCRIPTION}
        more={MORE}
        meta={<SalesSourceLine source={periodSalesSource(sourceMonths, model.settings.asilposGecisGunu, model.ds.asilposSales)} />}
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
      {removed ? <Notice tone="neutral" size="sm" live="polite" className="mb-4" title={removed.title} text={removed.text} /> : null}
      {/* ⌘K "Kâr / zarar" (#kar-zarar) başka sayfadan gelince içerik akınca iner */}
      <HashScroll key={`capa-${year}`} />
      {/* ⌘K "Kâr / zarar" buraya iner (docs/planlar/ux-sade.md §3.7) */}
      <div id="kar-zarar" className="mb-6 grid scroll-mt-20 grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title={`${year} cirosu`}
          description={`Ay ay ciro (KDV hariç): Satışlar'a girilen POS cirosundan ${pct(model.ds.settings.kdv, 0)} KDV düşülür (HİZMET işaretli satırlar, karaoke odası: ${pct(model.ds.settings.kdvHizmet, 0)}); laffogato.net online satışları (KDV hariç) eklenir. Yıl kartlarına bu aya kadar, POS cirosu girilmiş aylar girer (Genel bakış ve Claude da aynı kuralla).${openableHref(viewer.role, "/panel/satislar") ? " Aya dokununca Satışlar'da o ay açılır." : ""}`}
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
            sub={branchNote ? "Şubenin satışından reçeteye göre" : "Stok sayımı girilirse devir düşülür"}
            info={
              branchNote
                ? "Şube seçiliyken: şubenin satışındaki ürünlerin reçete maliyeti × (1 + genel fire) + ödenmezlerin malzeme maliyeti. Faturalar ve stok devri işletme genelinde."
                : "Ay içinde satılan mal maliyeti = önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)."
            }
          />
        </StatBreakdown>
      </div>
      {/* "Tümü": şube kırılımı, işletme geneli ayrı sütunda bir kez (Faz 5) */}
      {branchSplit ? <BranchSplitCard year={year} months={yt.counted.length} split={branchSplit} /> : null}
      {/* Şube seçili (soldaki seçici): neyin şubenin, neyin işletme genelinin olduğu (docs/SUBE.md) */}
      {branchNote ? (
        <Notice tone="neutral" size="sm" className="-mt-2 mb-4" title={branchNote.title}>
          {branchNote.text}
        </Notice>
      ) : null}
      {/* İşletme geneli giderler alanının çipi (şube ayrımı parça 6): "Yalnız not" ya da "Tutarla göster" */}
      <BranchViewChip area="ortak_gider" className="mb-4" />
      {/* Sayımı olmayan ay: mal maliyeti tahmini (para riski, katlanmaz); cirosu girilmemiş ayın gideri gri dipnot.
          Yıl kartlarına girmeyen aylar tabloda yine görünür */}
      {yt.uncounted.length ? (
        <Notice
          tone="warn"
          size="sm"
          risk="para"
          className="-mt-2 mb-4"
          title={`${yt.uncounted.map((m) => monthLabel(m)).join(", ")} sayımı yok: mal maliyeti tahmini`}
          action={countHref ? <NoticeLink href={countHref}>Sayım gir</NoticeLink> : undefined}
        >
          {`${uncountedCogsSummary((m) => model.pnlMonth(m).cogsMethod, yt.uncounted)}.`}
        </Notice>
      ) : null}
      {/* "Tümü"de birden çok kasa açıkken: elle yazılan ay bilgisi Tuzla'nın ay satırına iner (docs/SUBE.md › Yazarken hangi şube) */}
      {monthWrite.note ? <Notice tone="neutral" size="line" className="-mt-2 mb-4" title={monthWrite.note} /> : null}
      {yt.missingRevenue.length ? (
        <p className="-mt-2 mb-6 text-xs text-pretty text-ink-mute" role="note">
          Yıl kartları POS cirosu girilmiş {yt.counted.length} ayın toplamı. {yt.missingRevenue.map(missingRevenueText).join(" · ")}.
        </p>
      ) : null}
      {/* Online satış işletmenin cirosudur: fiziksel şube seçiliyken kart yok (docs/SUBE.md) */}
      {model.ds.branchView?.kind === "fiziksel" ? null : (
        <div className="mb-6">
          <SiteSalesCard data={siteCard} readOnly={readOnly} />
        </div>
      )}
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
        expectedDebts={expectedShown}
        asilposSwitch={model.settings.asilposGecisGunu}
        openDaysLocked={monthWrite.lock}
        writeBranch={monthWrite.branch}
        role={viewer.role}
        yearNote={
          yt.counted.length < activeMonths.length
            ? { short: `cirosu girilmiş ${yt.counted.length} ay`, long: [`${year} yılı: bu aya kadar, POS cirosu girilmiş ${yt.counted.length} ay (yıl kartları gibi)`, ...yearNotes].join(". ") }
            : null
        }
      />
    </>
  );
}

/**
 * "Tümü"nün şube kırılımı (Faz 5, sahibin kararı 4; docs/SUBE.md › Dalga 2'nin kararları): her şubenin kârı kendi
 * görünümündeki gibi, işletme geneli giderler ayrı sütunda bir kez (bölüştürme yok), Tümü işletmenin toplamı
 */
function BranchSplitCard({ year, months, split }: { year: number; months: number; split: BranchBreakdown }) {
  const rows: { key: "revenue" | "expenses" | "profit"; label: string }[] = [
    { key: "revenue", label: "Ciro (KDV hariç)" },
    { key: "expenses", label: "Mal maliyeti ve giderler" },
    { key: "profit", label: "Kâr / zarar" },
  ];
  return (
    <Card className="mb-6">
      <CardHeader
        title={`Şube kırılımı · ${year}`}
        description={
          <>
            Yıl kartlarıyla aynı {months} ay. Şubenin kârı kendi görünümündeki gibi: işletme geneli giderler şubeye bölünmez, ayrı sütunda bir kez sayılır.{" "}
            <InfoTip text="İşletme geneli: şubesi seçilmemiş sabit giderler ve stopajı, şubesi boş harcamalar ve harcamaya bağlı faturalar, Gelir-gider'e elle yazılan tutarlar, komisyon faturaları; cirosu laffogato.net online satışı. Fiziksel şube olmayan kanala (online) yazılan sabit gider, harcama ve personel varsa kendi sütununda (tek kanalsa onun adıyla, yoksa Diğer kanallar). Şubelerin mal maliyeti satışından reçeteye göre, Tümü'nün sayımla." />
          </>
        }
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH sticky>
                <span className="sr-only">Satır</span>
              </TH>
              {split.columns.map((c) => (
                <TH key={c.key} numeric>
                  {c.label}
                </TH>
              ))}
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD sticky className={r.key === "profit" ? "font-semibold" : undefined}>
                  {r.label}
                </TD>
                {split.columns.map((c) => (
                  <TD key={c.key} numeric className={cn(r.key === "profit" && "font-semibold", r.key === "profit" && c[r.key] < 0 && "text-bad")}>
                    {tl(c[r.key])}
                  </TD>
                ))}
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {split.residual ? (
        <p className="px-5 pb-4 text-xs text-pretty text-ink-mute">
          Sütunların toplamı Tümü&apos;yü {tl(split.residual)} farkla verir: Tümü&apos;nün mal maliyeti sayım ve faturalardan, şubelerinki satıştan reçeteye
          göre; Tümü&apos;de elle yazılan personel ve POS komisyonu da şubelere bölünmez. Hiçbir gider iki kez sayılmaz.
        </p>
      ) : null}
    </Card>
  );
}

import { withRemainder, type BreakdownGroup, type BreakdownRow } from "@/lib/breakdown";
import type { Model } from "@/lib/calc/engine";
import type { DashboardData, FixedLine, FixedMonthBreakdown } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY } from "@/lib/constants";
import { monthLabel, num, pct, tl } from "@/lib/format";

import { pnlRowLabel, sentenceCase } from "./gelir-gider/breakdowns";
import { productHref } from "./urunler/logic";

/**
 * Genel bakış'taki özet kartlarının dökümü (karta dokununca açılan pencere). Saf fonksiyonlar: sayfa sunucuda
 * `dashboard(model, ay)` sonucundan kurar, kartın gösterdiği rakamla aynı hesap ve aynı ay. Toplamlar kartın
 * rakamını tutar (fark varsa "Diğer" kalemi); oran ve ortalama kartlarında girdiler bilgi satırı olarak yazılır.
 */

/** Kartın dökümü: `StatBreakdown`a olduğu gibi verilir (başlık, açıklama, bölümler, toplam) */
export interface CardBreakdown {
  title: string;
  description: string;
  groups: BreakdownGroup[];
  total?: number;
  totalLabel?: string;
  totalDisplay?: string;
  hideTotal?: boolean;
  order?: "amount" | "given";
  shares?: boolean;
  empty?: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Kuruş altı farklar yok sayılır (kartlardaki "Excel temeli" kuralıyla aynı: 1 ₺'den küçük fark yok) */
const differs = (a: number, b: number) => Math.abs(a - b) >= 1;
const safeDiv = (a: number, b: number) => (b ? a / b : 0);
/** "%10": ayarlardaki oran (0,1) yazı olarak */
const rate = (v: number) => `%${num(v * 100, 1)}`;
/** Önce en büyük gider (eksi tutarlar) / önce en büyük tutar */
const costFirst = (rows: BreakdownRow[]) => [...rows].sort((a, b) => a.amount - b.amount);
const biggestFirst = (rows: BreakdownRow[]) => [...rows].sort((a, b) => b.amount - a.amount);

// ---------------------------------------------------------------- Bağlantılar

const salesHref = (month: string, durum?: string) => `/panel/satislar?ay=${month}${durum ? `&durum=${durum}#satirlar` : ""}`;
/** Gelir-gider: ayın yılı; telefondaki tek ay görünümü de o ayla açılır (month-view.tsx ile aynı adres) */
const pnlHref = (month: string) => `/panel/gelir-gider?yil=${month.slice(0, 4)}&ay=${month}`;
const invoicesHref = (filters: { kategori?: string; ay?: string; ara?: string }) =>
  `/panel/faturalar?${new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])))}#fatura-listesi`;

/** Gider kaleminin girildiği sayfa: personel, sabit gider, aylık harcama; ötekiler Gelir-gider tablosunda */
function lineHref(key: string, month: string): string {
  if (key.startsWith("personnel:")) return "/panel/personel";
  if (key.startsWith("fixed:")) return "/panel/giderler";
  if (key.startsWith("expense:")) return `/panel/harcamalar?ay=${month}`;
  if (key.startsWith("purchase:")) return invoicesHref({ ay: month, ara: key.slice("purchase:".length) });
  if (key.startsWith("commission:") && key !== "commission:pos") return invoicesHref({ kategori: COMMISSION_CATEGORY, ay: month, ara: key.slice("commission:".length) });
  return pnlHref(month);
}

// ---------------------------------------------------------------- Ürün satışları

interface SalesItem {
  key: string;
  label: string;
  href: string;
  qty: number;
  net: number;
  gross: number;
}

interface SalesBucket {
  key: string;
  label: string;
  note?: string;
  items: Map<string, SalesItem>;
}

/**
 * Ayın satış satırları kategori kategori, kategoride ürün ürün (aynı ürünün POS satırları birleşir). Ürün kartına
 * bağlanmamış satırlar ve hizmetler (karaoke vb.) ayrı bölüm; hepsi birlikte ayın net satışını tutar.
 */
function salesBuckets(d: DashboardData): SalesBucket[] {
  const buckets = new Map<string, SalesBucket>();
  for (const l of d.sales.lines) {
    const pc = l.product;
    const where = l.line.isService
      ? { key: "hizmet", label: "Hizmetler", item: `pos:${l.line.posName}`, name: l.line.posName, href: salesHref(d.month, "hizmet") }
      : !l.matched || !pc
        ? { key: "eslesmeyen", label: "Menüyle eşleşmeyen", item: `pos:${l.line.posName}`, name: l.line.posName, href: salesHref(d.month, "eslesmeyen") }
        : {
            key: `kategori:${pc.category?.id ?? 0}`,
            label: pc.category?.name ?? "Kategorisiz",
            item: `urun:${pc.product.id}`,
            name: pc.product.size ? `${pc.product.name} · ${pc.product.size}` : pc.product.name,
            href: productHref(pc.product.id, d.month),
          };
    let b = buckets.get(where.key);
    if (!b) {
      const note = where.key === "eslesmeyen" ? "Ürün kartına bağlanmamış POS satırları; Satışlar sayfasından eşleştirilir." : undefined;
      b = { key: where.key, label: where.label, note, items: new Map() };
      buckets.set(where.key, b);
    }
    const it = b.items.get(where.item) ?? { key: where.item, label: where.name, href: where.href, qty: 0, net: 0, gross: 0 };
    b.items.set(where.item, { ...it, qty: it.qty + l.line.qty, net: it.net + l.net, gross: it.gross + l.grossProfit });
  }
  return [...buckets.values()];
}

/** Net satış: kategori kategori, ürün ürün (KDV hariç) */
export function netSalesBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const t = d.theoretical;
  return {
    title: `${monthLabel(d.month)} net satış`,
    description: `Patron (ModPOS) ürün satışları ÷ (1 + KDV ${rate(model.settings.kdv)}), kategori kategori, ürün ürün. KDV dahil ${tl(d.sales.revenue)}; ürüne dokununca ürün kartı açılır.`,
    groups: t
      ? salesBuckets(d).map((b) => ({
          key: b.key,
          label: b.label,
          note: b.note,
          rows: [...b.items.values()].map((i) => ({ key: i.key, label: i.label, sub: `${num(i.qty)} adet`, amount: i.net, href: i.href })),
        }))
      : [],
    total: t?.netSales,
    totalLabel: "Net satış",
    empty: "Bu ay ürün satış raporu yok.",
  };
}

/** Brüt kârın üç kalemi: net satış − malzeme / ambalaj − kart / POS komisyonu */
function grossRows(model: Model, d: DashboardData): BreakdownRow[] {
  const t = d.theoretical!;
  const st = model.settings;
  return [
    { key: "net", label: "Net satış", sub: `KDV dahil ${tl(d.sales.revenue)} ÷ (1 + KDV ${rate(st.kdv)})`, amount: t.netSales, href: salesHref(d.month) },
    {
      key: "malzeme",
      label: "Malzeme + ambalaj",
      sub: `Satılan her ürün × reçete maliyeti${d.sales.unmatched.length ? "; eşleşmeyen satırlar ortalama maliyet oranıyla" : ""}`,
      amount: -t.material,
    },
    { key: "komisyon", label: "Kart / POS komisyonu", sub: `Ciro × ${rate(st.komisyon)} × kartlı oran ${rate(st.kartOrani)}`, amount: -t.commission },
  ];
}

/** Brüt kâr: net satış − malzeme − komisyon; altta (toplama girmeden) aynı kâr kategori kategori */
export function grossProfitBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const t = d.theoretical;
  const byCategory = t
    ? biggestFirst(
        salesBuckets(d).map((b) => {
          const items = [...b.items.values()];
          const net = sum(items.map((i) => i.net));
          const gross = sum(items.map((i) => i.gross));
          return { key: b.key, label: b.label, sub: `Net satış ${tl(net)} · marj ${pct(safeDiv(gross, net))}`, amount: gross };
        }),
      )
    : [];
  return {
    title: `${monthLabel(d.month)} brüt kâr`,
    description: `Net satış − malzeme ve ambalaj (reçeteye göre) − kart / POS komisyonu, KDV hariç. Kira ve personel öncesi kâr${
      t ? `; marj ${pct(safeDiv(t.grossProfit, t.netSales))}` : ""
    }.`,
    groups: t
      ? [
          { key: "hesap", rows: grossRows(model, d) },
          { key: "kategori", label: "Kategorilere göre", apart: true, rows: byCategory },
        ]
      : [],
    total: t?.grossProfit,
    totalLabel: "Brüt kâr",
    order: "given",
    shares: false,
    empty: "Bu ay ürün satış raporu yok.",
  };
}

// ---------------------------------------------------------------- Sabit giderler

/** Kalemin alt satırı: elle düzeltildiyse ya da açık gün oranıyla standarttan farklıysa */
function lineSub(l: FixedLine, f: FixedMonthBreakdown): string | undefined {
  if (l.key.startsWith("expense:")) return "Aylık harcamalar (bu ay girilen)";
  if (l.overridden) return "Gelir-gider'de elle düzeltildi";
  if (f.basis === "month" && differs(l.computed, l.standard)) return `Standart ${tl(l.standard)} · ${f.openDays} / ${f.dim} gün açık`;
  return undefined;
}

/**
 * Bu ay düşülen sabit giderler, Excel Panel grupları (Kira, Personel, Reklam, Diğer, bu aya özel) bölüm bölüm,
 * kalem kalem, eksi tutarla. Her bölüm "Para nereye gitti?" kartındaki tutarı tutar.
 */
function fixedGroups(f: FixedMonthBreakdown): BreakdownGroup[] {
  return f.flow.map((fl) => {
    const rows: BreakdownRow[] =
      fl.key === "extras"
        ? f.manualRows.map((r) => ({ key: r.key, label: sentenceCase(r.label), amount: -r.amount, href: pnlHref(f.month) }))
        : f.lines.filter((l) => l.group === fl.key).map((l) => ({ key: l.key, label: l.label, sub: lineSub(l, f), amount: -l.value, href: lineHref(l.key, f.month) }));
    return { key: `sabit:${fl.key}`, label: fl.label, rows: withRemainder(costFirst(rows), -fl.amount, "Diğer", `sabit:${fl.key}:diger`) };
  });
}

/**
 * Standart aylık sabit gider (Excel SabitGiderToplam) Panel grupları satır satır; aylık harcamalar standarda girmez.
 * Toplam her zaman `d.fixedStandardTotal`ı tutar.
 */
function standardRows(d: DashboardData, sign: 1 | -1): BreakdownRow[] {
  const f = d.fixedMonth;
  const rows = f.flow
    .filter((fl) => fl.key !== "extras")
    .map((fl) => {
      const names = f.lines
        .filter((l) => l.group === fl.key && !l.key.startsWith("expense:") && l.standard > 0)
        .sort((a, b) => b.standard - a.standard)
        .map((l) => (l.key.startsWith("personnel:") ? "Maaş + SGK" : l.label))
        .filter((n, i, xs) => xs.indexOf(n) === i);
      // Tek kalem grubun adıyla aynıysa ("Kira") alt satır tekrar etmesin ("Para nereye gitti?" kartındaki gibi)
      const same = names.length === 1 && names[0] === fl.label;
      return {
        key: `standart:${fl.key}`,
        label: fl.label,
        sub: names.length && !same ? names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "") : undefined,
        amount: sign * fl.standard,
        href: fl.key === "personel" ? "/panel/personel" : "/panel/giderler",
      };
    });
  return withRemainder(sign < 0 ? costFirst(rows) : biggestFirst(rows), sign * d.fixedStandardTotal, "Diğer", "standart:diger");
}

/** Net kâr / zarar: brüt kâr − indirimler − bu ayın sabit giderleri; karttaki iki karşılaştırma toplamın altında */
export function netProfitBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const t = d.theoretical;
  if (!t) return { title: `${monthLabel(d.month)} net kâr / zarar`, description: "", groups: [], empty: "Bu ay ürün satış raporu yok." };
  const f = t.fixedBreakdown;
  const compare: BreakdownRow[] = [];
  if (differs(t.netProfit, t.netProfitStandard)) {
    compare.push({
      key: "excel",
      label: "Excel temeli",
      sub: `Bu ayın sabit gideri yerine standart aylık sabit gider (${tl(d.fixedStandardTotal)}) düşülürse`,
      amount: t.netProfitStandard,
      display: tl(t.netProfitStandard),
    });
  }
  if (d.actual.hasRevenue) {
    compare.push({
      key: "fatura",
      label: "Faturaya göre (Gelir-gider)",
      sub: "Ciro − alınan malın maliyeti (stok devriyle) − giderler",
      amount: d.actual.profit,
      display: tl(d.actual.profit),
      href: pnlHref(d.month),
    });
  }
  return {
    title: `${monthLabel(d.month)} net kâr / zarar`,
    description: `Brüt kâr − indirimler − o ayın Gelir-gider sabit giderleri (açık gün oranı, düzeltmeler, bu aya özel satırlar, aylık harcamalar), KDV hariç, reçeteye göre.${
      f.waterExcluded > 0 ? ` SU GİDERİ (${tl(f.waterExcluded)}) reçetelerde sayıldığı için burada ikinci kez düşülmedi.` : ""
    }`,
    groups: [
      { key: "brut", label: "Brüt kâr", rows: grossRows(model, d) },
      {
        key: "indirim",
        label: "İndirimler",
        rows: [
          {
            key: "indirim",
            label: "Yönetici indirimleri (KDV hariç)",
            sub: `KDV dahil ${tl(d.info?.discounts ?? 0)}`,
            amount: -t.discountsNet,
            href: salesHref(d.month),
          },
        ],
      },
      ...fixedGroups(f),
      { key: "karsilastirma", label: "Karşılaştırma", apart: true, noSubtotal: true, rows: compare },
    ],
    total: t.netProfit,
    totalLabel: "Net kâr / zarar",
    order: "given",
    shares: false,
  };
}

// ---------------------------------------------------------------- Satış listesi olmayan ay

/** POS cirosu: KDV hariç ciro + KDV; ayın indirim, ikram ve açık gün bilgisi toplamın altında */
export function posRevenueBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const pos = d.info?.posRevenue ?? 0;
  const kdv = model.settings.kdv;
  const net = pos / (1 + kdv);
  const info: BreakdownRow[] = [];
  if (d.info?.openDays) info.push({ key: "gun", label: "Açık gün", display: `${num(d.info.openDays)} gün`, amount: 0, href: salesHref(d.month) });
  if (d.info?.discounts) info.push({ key: "indirim", label: "Yönetici indirimleri", sub: "KDV dahil; cirodan düşülmüş", display: tl(d.info.discounts), amount: 0 });
  if (d.info?.offRevenue) info.push({ key: "odenmez", label: "Ödenmez / ikram", sub: "KDV dahil; ciroya girmez", display: tl(d.info.offRevenue), amount: 0 });
  return {
    title: `${monthLabel(d.month)} POS cirosu`,
    description:
      "Patron (ModPOS) ciro raporu, KDV dahil: indirimler düşülmüş, ödenmez / ikram hariç. Bu ayın ürün satış raporu yüklenince kart ürün ürün net satışı gösterir.",
    groups: pos
      ? [
          {
            key: "pos",
            rows: [
              { key: "net", label: "Ciro (KDV hariç)", sub: `POS cirosu ÷ (1 + KDV ${rate(kdv)})`, amount: net, href: salesHref(d.month) },
              { key: "kdv", label: `KDV (${rate(kdv)})`, amount: pos - net },
            ],
          },
          { key: "bilgi", label: "Ay bilgileri", apart: true, noSubtotal: true, rows: info },
        ]
      : [],
    total: pos,
    totalLabel: "POS cirosu (KDV dahil)",
    order: "given",
    empty: "Bu ay POS cirosu girilmedi; Satışlar sayfasındaki ay bilgilerinden girilir.",
  };
}

/** Günlük ortalama ciro (satış listesi yokken): POS cirosu ÷ açık gün */
export function dailyAvgBreakdown(d: DashboardData): CardBreakdown {
  const openDays = d.info?.openDays ?? 0;
  return {
    title: `${monthLabel(d.month)} günlük ortalama ciro`,
    description: `POS cirosu ÷ açık gün (KDV dahil).${d.monthState === "running" ? " Ay sürüyor: açık gün bugüne kadar geçen gün sayısıdır." : ""}`,
    groups:
      d.dailyAvg !== null
        ? [
            {
              key: "hesap",
              noSubtotal: true,
              rows: [
                { key: "pos", label: "POS cirosu (KDV dahil)", display: tl(d.info?.posRevenue ?? 0), amount: 0, href: salesHref(d.month) },
                { key: "gun", label: d.monthState === "running" ? "Açık gün (bugüne kadar)" : "Açık gün", display: `${num(openDays)} gün`, amount: 0 },
              ],
            },
          ]
        : [],
    totalLabel: "Günlük ortalama ciro",
    totalDisplay: tl(d.dailyAvg),
    order: "given",
    shares: false,
    empty: "Açık gün sayısı girilince hesaplanır (Satışlar sayfasındaki ay bilgileri).",
  };
}

/** Gelir-gider bölümleri (tablodaki sırayla); satılan mal maliyeti ayrıca */
const PNL_SECTIONS = [
  { key: "personel", label: "Personel giderleri" },
  { key: "faturalar", label: "Faturalar" },
  { key: "kira", label: "Kira" },
  { key: "genel", label: "İşletme genel giderleri" },
  { key: "komisyon", label: "Komisyon giderleri" },
] as const;

/**
 * Bitmiş ayın faturaya göre kâr / zararı, Gelir-gider tablosunun satırlarından: ciro (KDV hariç), satılan mal
 * maliyeti (mal alışları + stok devri) ve bölüm bölüm giderler, eksi tutarla, büyük gider önce.
 */
export function actualProfitBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const month = d.month;
  const pm = model.pnlMonth(month);
  const defs = model.pnlRowDefs([month]).filter((r) => r.kind !== "total");
  const value = (key: string) => (pm.cells.get(key)?.value as number | null | undefined) ?? 0;
  // Satır adları Gelir-gider tablosundaki gibi: tedarikçi ve sabit gider adı girildiği gibi, diğerleri cümle düzeninde
  const fixedNames = new Map(model.ds.fixedExpenses.map((f) => [`fixed:${f.id}`, f.name]));
  const rowsOf = (section: string): BreakdownRow[] =>
    defs
      .filter((r) => r.section === section)
      .map((r) => ({ key: r.key, label: pnlRowLabel(r, fixedNames), sub: r.sub, amount: -value(r.key), href: lineHref(r.key, month) }));
  const cogsRows = withRemainder(
    costFirst([
      ...rowsOf("mal"),
      {
        key: "stock:change",
        label: "Stok devri",
        sub: `Önceki aydan devir ${tl(pm.opening)} − ay sonu stok ${tl(pm.closing)}`,
        amount: -(pm.opening - pm.closing),
        href: `/panel/sayim?ay=${month}`,
      },
    ]),
    -pm.cogs,
    "Diğer (tabloda ayrı satırı yok)",
    "cogs:other",
  );
  const expenses: BreakdownGroup[] = [
    { key: "cogs", label: "Satılan mal maliyeti", rows: cogsRows },
    ...PNL_SECTIONS.map(({ key, label }) => ({
      key,
      label,
      rows: withRemainder(costFirst(rowsOf(key)), -pm.sections[key], "Diğer (tabloda ayrı satırı yok)", `${key}:other`),
    })),
  ].sort((a, b) => sum(a.rows.map((r) => r.amount)) - sum(b.rows.map((r) => r.amount)));
  const has = d.actual.hasRevenue || d.actual.expenses > 0;
  return {
    title: `${monthLabel(month)} kâr / zarar (faturaya göre)`,
    description:
      "Gelir-gider tablosundaki sonuç, KDV hariç: ciro − satılan mal maliyeti − giderler, bölüm bölüm. Stok sayımı yoksa ay içinde alınan malın tamamı maliyet sayılır.",
    groups: has
      ? [
          {
            key: "gelir",
            label: "Gelir",
            rows: [{ key: "revenueNet", label: "Ciro (KDV hariç)", sub: `POS cirosu ${tl(pm.revenue)} ÷ (1 + KDV ${rate(model.settings.kdv)})`, amount: pm.revenueNet ?? 0, href: salesHref(month) }],
          },
          ...expenses,
        ]
      : [],
    total: d.actual.profit,
    totalLabel: "Kâr / zarar",
    order: "given",
    shares: false,
    empty: "Bu ay Gelir-gider tablosunda ciro ya da gider yok.",
  };
}

/**
 * Süren ayın ay sonu tahmini (Excel Panel B19): bu tempoyla ay sonu ciro × brüt kâr oranı − standart aylık sabit
 * gider. Girdiler üstte bilgi satırı, sabit gider Panel grupları satır satır.
 */
export function forecastBreakdown(d: DashboardData): CardBreakdown {
  const fc = d.forecast;
  const title = `${monthLabel(d.month)} ay sonu tahmini`;
  if (!fc) {
    return {
      title,
      description: "Tahmin yalnızca süren ay için yapılır: POS cirosu ÷ açık gün × ayın gün sayısı × brüt kâr oranı − standart aylık sabit gider.",
      groups: [],
      empty: d.monthState === "future" ? "Ay başlamadı." : "Açık gün ve POS cirosu girilince hesaplanır.",
    };
  }
  const gross = fc.projectedRevenue * d.grossRatio;
  return {
    title,
    description: `Bu tempo sürerse: POS cirosu ÷ açık gün × ayın gün sayısı × ${
      fc.refMonth ? `${monthLabel(fc.refMonth)} ` : "son satış ayının "
    }brüt kâr oranı − standart aylık sabit gider (Excel Panel B19). Açık gün bugüne kadar geçen gün sayılır.`,
    groups: [
      {
        key: "ciro",
        label: "Tahmini ciro",
        noSubtotal: true,
        rows: [
          { key: "pos", label: "POS cirosu (bugüne kadar, KDV dahil)", display: tl(d.info?.posRevenue ?? 0), amount: 0, href: salesHref(d.month) },
          { key: "gun", label: "Geçen gün", display: `${num(fc.daysElapsed)} / ${num(fc.dim)} gün`, amount: 0 },
          { key: "ciro", label: "Bu tempoyla ay sonu ciro", sub: "POS cirosu ÷ geçen gün × ayın gün sayısı", display: tl(fc.projectedRevenue), amount: 0 },
        ],
      },
      {
        key: "brut",
        label: "Tahmini brüt kâr",
        rows: [
          {
            key: "brut",
            label: `Ay sonu ciro × brüt kâr oranı ${pct(d.grossRatio)}`,
            sub: fc.refMonth ? `${monthLabel(fc.refMonth)} brüt kâr ÷ ciro (KDV dahil)` : undefined,
            amount: gross,
          },
        ],
      },
      { key: "sabit", label: "Standart aylık sabit gider", rows: standardRows(d, -1) },
    ],
    total: fc.projectedProfit,
    totalLabel: "Tahmini kâr / zarar",
    order: "given",
    shares: false,
  };
}

/**
 * Başabaş günlük ciro = standart aylık sabit gider ÷ brüt kâr oranı ÷ ayda açık gün. Girdiler bilgi satırı,
 * sabit gider Panel grupları satır satır; seçili ayın temposu (günlük ortalama, başabaşa göre) toplamın altında.
 */
export function breakEvenBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const st = model.settings;
  const ref = d.refMonth ? model.monthSales(d.refMonth) : null;
  const monthly = d.grossRatio > 0 ? d.fixedStandardTotal / d.grossRatio : null;
  const progress = d.breakEvenProgress;
  const tempo: BreakdownRow[] =
    d.dailyAvg && progress !== null
      ? [
          {
            key: "ortalama",
            label: "Günlük ortalama ciro",
            sub: d.hasSales ? "Satış listesi (indirim öncesi) ÷ açık gün" : "POS cirosu ÷ açık gün",
            display: tl(d.dailyAvg),
            amount: 0,
          },
          { key: "ilerleme", label: "Başabaşa göre", display: pct(progress, 0), amount: 0, tone: progress >= 1 ? "good" : progress > 0.85 ? "warn" : "bad" },
        ]
      : [];
  return {
    title: "Başabaş günlük ciro",
    description: `Zarar etmemek için gereken günlük ciro (KDV dahil): standart aylık sabit gider ÷ brüt kâr oranı ÷ ayda açık gün.${
      d.refMonth ? ` Brüt kâr oranı ${monthLabel(d.refMonth)} satışlarından.` : ""
    }`,
    groups: [
      { key: "sabit", label: "Standart aylık sabit gider", rows: standardRows(d, 1) },
      {
        key: "hesap",
        label: "Hesap",
        noSubtotal: true,
        rows: [
          {
            key: "oran",
            label: "Brüt kâr oranı",
            sub: ref ? `${monthLabel(ref.month)}: brüt kâr ${tl(ref.grossProfit)} ÷ ciro ${tl(ref.revenue)} (KDV dahil)` : "Ürün satış raporu olan ay yok",
            display: pct(d.grossRatio),
            amount: 0,
            tone: ref ? undefined : "warn",
          },
          { key: "aylik", label: "Başabaş aylık ciro", sub: "Sabit gider ÷ brüt kâr oranı", display: tl(monthly), amount: 0 },
          { key: "gun", label: "Ayda açık gün", sub: "Ayarlar", display: `${num(st.acikGun)} gün`, amount: 0, href: "/panel/ayarlar" },
        ],
      },
      { key: "tempo", label: `${monthLabel(d.month)} temposu`, apart: true, noSubtotal: true, rows: tempo },
    ],
    totalLabel: "Başabaş günlük ciro",
    totalDisplay: tl(d.breakEvenDaily),
    order: "given",
    shares: false,
  };
}

// ---------------------------------------------------------------- Önceki ay

/**
 * Karttaki büyüme rozetinin karşılığı (rozetin üzerine gelince görünen önceki ay tutarı kartın düğmesinin altında
 * kalır): önceki ayın aynı rakamı ve değişim, toplamın altında ayrı bölüm. Karşılaştırma yoksa döküm aynen döner.
 */
export function withComparison(b: CardBreakdown, c: { month: string; value: number | null | undefined; growth: number | null; basis?: string }): CardBreakdown {
  if (c.growth === null || c.value === null || c.value === undefined || !b.groups.length) return b;
  const g = c.growth;
  return {
    ...b,
    groups: [
      ...b.groups,
      {
        key: "onceki-ay",
        label: "Önceki ayla karşılaştırma",
        apart: true,
        noSubtotal: true,
        rows: [
          { key: "onceki", label: monthLabel(c.month), sub: c.basis, amount: c.value, display: tl(c.value) },
          {
            key: "degisim",
            label: "Değişim",
            display: `${g >= 0.0005 ? "+" : ""}${pct(g, Math.abs(g) >= 1 ? 0 : 1)}`,
            amount: 0,
            tone: g >= 0.0005 ? "good" : g <= -0.0005 ? "bad" : undefined,
          },
        ],
      },
    ],
  };
}

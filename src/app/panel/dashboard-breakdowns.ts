import { withRemainder, type BreakdownGroup, type BreakdownRow } from "@/lib/breakdown";
import type { Model, SalesPosCommission } from "@/lib/calc/engine";
import { expensePlanSub, listDaysText, listShareFactor, type DashboardData, type FixedLine, type FixedMonthBreakdown } from "@/lib/calc/insights";
import { money, monthLabel, num, numPossessive, pct, tl } from "@/lib/format";
import { monthKasa, salesMonthKasa, type MonthKasa } from "@/lib/lafpos/kasa";
import { dayRangeTR } from "@/lib/lafpos/sales";
import { siteGross } from "@/lib/site-sales/calc";

import { pnlRowLabel, sentenceCase } from "./gelir-gider/breakdowns";
import { rowLink } from "./gelir-gider/row-links";
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

/**
 * Komisyon satırının alt yazısı, kasa kartı olan ayda (SalesPosCommission): ay bitince ya da liste kasaya yetişince
 * Gelir-gider'le aynı tutar; süren ayda liste kısaysa listenin günleri ve Gelir-gider'in tutarı. Kasa kartı yoksa null
 */
export function salesPosSub(spc: SalesPosCommission | null): string | null {
  if (!spc) return null;
  if (!spc.period) return "Kart × şubenin POS oranı (yemek kartı hariç), Gelir-gider'le aynı";
  return `Kart × şubenin POS oranı (yemek kartı hariç), listenin günleri ${dayRangeTR(spc.period.from, spc.period.through)}; Gelir-gider'de ayın tamamı ${money(spc.month.amount)}`;
}

/** Satış listesinin KDV hariç hesabı: ürünler satış KDV'siyle, HİZMET satırları (karaoke) hizmet KDV'siyle */
const salesNetSub = (model: Model, d: DashboardData) =>
  `KDV dahil ${tl(d.sales.revenue)} ÷ (1 + KDV ${rate(model.settings.kdv)})${d.sales.serviceRevenue ? `; hizmet (karaoke) ${tl(d.sales.serviceRevenue)} ÷ (1 + ${rate(model.settings.kdvHizmet)})` : ""}`;

/**
 * POS cirosunun KDV hariç hesabı (gelir-gider tablosuyla aynı, engine.ts posNet): hizmet payı varsa kendi oranıyla;
 * LafPOS'un şubesinin ayında gün gün (LafPOS günü kendi KDV dökümüyle, öteki günler günün oranıyla, ay günlerin toplamı)
 */
const posNetSub = (model: Model, pm: { month: string; revenue: number | null; serviceRevenue: number }) => {
  const service = pm.serviceRevenue ? `, hizmet (karaoke) ÷ (1 + ${rate(model.settings.kdvHizmet)})` : "";
  if (model.posNet(pm.month)?.byDay) return `POS cirosu ${tl(pm.revenue ?? 0)} gün gün: LafPOS günü kendi KDV dökümüyle, öteki günler ÷ (1 + KDV ${rate(model.settings.kdv)})${service}; ay günlerin toplamı`;
  return pm.serviceRevenue
    ? `POS cirosu ${tl(pm.revenue ?? 0)}: hizmet (karaoke) ${tl(pm.serviceRevenue)} ÷ (1 + ${rate(model.settings.kdvHizmet)}), kalanı ÷ (1 + KDV ${rate(model.settings.kdv)})`
    : `POS cirosu ${tl(pm.revenue ?? 0)} ÷ (1 + KDV ${rate(model.settings.kdv)})`;
};
/** Önce en büyük gider (eksi tutarlar) / önce en büyük tutar */
const costFirst = (rows: BreakdownRow[]) => [...rows].sort((a, b) => a.amount - b.amount);
const biggestFirst = (rows: BreakdownRow[]) => [...rows].sort((a, b) => b.amount - a.amount);

// ---------------------------------------------------------------- Bağlantılar

/**
 * Genel bakış'ın "Kart / POS komisyonu" satış raporunun tahminidir: ciro × komisyon × kartlı oran (yemek kartı dahil).
 * Gelir-gider'in banka POS komisyonu yalnız banka kartı payıyla (denetim E-43); iki rakam kasa raporu olan ayda ayrışır
 */
export const POS_COMMISSION_SALES_NOTE =
  "Satış raporunun tahmini: kartlı oran yemek kartı satışını da içerir. Gelir-gider'deki banka POS komisyonu yalnız banka kartı payıyla hesaplanır, yemek kartlarının komisyonu kendi faturalarıyla sayılır; kasa raporu olan ayda iki rakam farklı çıkar.";

const salesHref = (month: string, durum?: string) => `/panel/satislar?ay=${month}${durum ? `&durum=${durum}#satirlar` : ""}`;
/** Gelir-gider: ayın yılı; telefondaki tek ay görünümü de o ayla açılır (month-view.tsx ile aynı adres) */
const pnlHref = (month: string) => `/panel/gelir-gider?yil=${month.slice(0, 4)}&ay=${month}`;
/**
 * Gider kaleminin kaynağı, Gelir-gider tablosundakiyle aynı (rowLink): personel, sabit gider, aylık harcama, faturalar,
 * komisyon. POS komisyonu ve kaynağı olmayan satırlar Gelir-gider tablosunda (POS komisyonu orada düzeltilir)
 */
function lineHref(key: string, month: string): string {
  return (key === "commission:pos" ? null : rowLink(key, month)?.href) ?? pnlHref(month);
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

/** Online satışın Gelir-gider'deki üç satırı (KDV hariç), listenin dönemine düşen payla */
function onlineRows(d: DashboardData): BreakdownRow[] {
  const o = d.theoretical?.online;
  if (!o) return [];
  const share = o.share < 1 ? ` · ayın bugüne kadarki satışının %${numPossessive(o.share * 100)} (satış listesinin günleri)` : "";
  const href = pnlHref(d.month);
  return [
    { key: "online:cafe", label: "Kafe online (site + uygulama)", sub: `KDV hariç${share}`, amount: o.cafe, href },
    { key: "online:shop", label: "Mağaza (online)", sub: `KDV hariç${share}`, amount: o.shop, href },
    { key: "online:karaoke", label: "Karaoke (ön ödemeli)", sub: `KDV hariç${share}`, amount: o.karaoke, href },
    // Yalnız sıfır olan atlanır: satırlar net satışı kuruşu kuruşuna tutsun
  ].filter((r) => Math.abs(r.amount) >= 0.005);
}

/** Net satış: kategori kategori, ürün ürün (KDV hariç); online satış ayrı bölüm */
export function netSalesBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const t = d.theoretical;
  const online = onlineRows(d);
  const mk = salesKasaOf(model, d.month);
  return {
    title: `${monthLabel(d.month)} net satış`,
    description: `${mk.report} ürün satışları ÷ (1 + KDV ${rate(model.settings.kdv)})${d.sales.serviceRevenue ? `, hizmet satırları (karaoke) ÷ (1 + ${rate(model.settings.kdvHizmet)})` : ""}, kategori kategori, ürün ürün. KDV dahil ${tl(d.sales.revenue)}; ürüne dokununca ürün kartı açılır.${
      t?.online ? " laffogato.net online satışı (kafe, mağaza, karaoke) Gelir-gider'deki gibi KDV hariç, ayrı bölümde." : ""
    }`,
    groups: t
      ? [
          ...salesBuckets(d).map((b) => ({
            key: b.key,
            label: b.label,
            note: b.note,
            rows: [...b.items.values()].map((i) => ({ key: i.key, label: i.label, sub: `${num(i.qty)} adet`, amount: i.net, href: i.href })),
          })),
          ...(online.length ? [{ key: "online", label: "laffogato.net online", note: `Uygulama ve web siparişleri; kasadan (${mk.both}) geçmez.`, rows: online }] : []),
        ]
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
  const o = t.online;
  return [
    { key: "net", label: o ? `Net satış (${salesKasaOf(model, d.month).short})` : "Net satış", sub: salesNetSub(model, d), amount: t.posNetSales, href: salesHref(d.month) },
    ...(o ? [{ key: "online", label: "Online satış (laffogato.net)", sub: "Kafe, mağaza, karaoke; KDV hariç", amount: o.revenue, href: pnlHref(d.month) }] : []),
    {
      key: "malzeme",
      label: "Malzeme + ambalaj",
      sub: `Satılan her ürün × reçete maliyeti${
        d.sales.unmatched.length || d.sales.noRecipe.length
          ? `; ${[d.sales.unmatched.length ? "eşleşmeyen satırlar" : "", d.sales.noRecipe.length ? "reçetesi boş ürünler" : ""].filter(Boolean).join(" ve ")} ortalama maliyet oranıyla`
          : ""
      }${
        o
          ? `; laffogato.net ${tl(o.material)}${o.estimatedCost > 0 ? ` (${o.noRecipe ? "menüye bağlı olmayan satırlar, reçetesi boş ürünler" : "menüye bağlı olmayan satırlar"} ve mağaza kolileri ortalama maliyet oranıyla, %${num(o.avgCostRatio * 100, 1)})` : ""}`
          : ""
      }`,
      amount: -t.material,
    },
    {
      key: "komisyon",
      label: "Kart / POS komisyonu",
      // Kasa kartı olan ayda Gelir-gider'in banka POS komisyonunun kuralı (engine salesPosCommission): ay bitince aynı tutar,
      // süren ayda liste kasa raporlarından kısaysa listenin günleriyle. Yoksa satış raporunun tahmini: kartlı oran yemek
      // kartını da içerir (Gelir-gider'in banka POS komisyonu yalnız banka kartı payıyla)
      sub: salesPosSub(model.salesPosCommission(d.month)) ?? `Ciro × ${rate(st.komisyon)} × kartlı oran ${rate(model.cardShareOf(d.month).rate)} (yemek kartı dahil)`,
      amount: -t.commission,
    },
  ];
}

/** Brüt kâr: net satış − malzeme − komisyon; altta (toplama girmeden) aynı kâr kategori kategori */
export function grossProfitBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const t = d.theoretical;
  const byCategory = t
    ? biggestFirst([
        ...salesBuckets(d).map((b) => {
          const items = [...b.items.values()];
          const net = sum(items.map((i) => i.net));
          const gross = sum(items.map((i) => i.gross));
          return { key: b.key, label: b.label, sub: `Net satış ${tl(net)} · marj ${pct(safeDiv(gross, net))}`, amount: gross };
        }),
        ...(t.online
          ? [{ key: "online", label: "laffogato.net online", sub: `Net satış ${tl(t.online.revenue)} · marj ${pct(safeDiv(t.online.grossProfit, t.online.revenue))}`, amount: t.online.grossProfit }]
          : []),
      ])
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
  if (f.basis === "month" && differs(l.computed, l.standard)) {
    return f.prorationBasis === "takvim" ? `Standart ${tl(l.standard)} · ayın ${f.prorationDays} / ${f.dim} günü` : `Standart ${tl(l.standard)} · ${f.prorationDays} / ${f.dim} gün açık`;
  }
  return undefined;
}

/**
 * Bu ay düşülen sabit giderler, Excel Panel grupları (Kira, Personel, Reklam, Diğer, bu aya özel) bölüm bölüm,
 * kalem kalem, eksi tutarla. Her bölüm "Para nereye gitti?" kartındaki tutarı tutar.
 */
function fixedGroups(f: FixedMonthBreakdown): BreakdownGroup[] {
  // Süren ayda satış listesi ayın bir kısmını kapsıyorsa kalemler o günlere düşen payla (gruplar da öyle)
  const k = listShareFactor(f);
  const note = f.listShare ? `Ayın tutarı × ${f.listShare.days} / ${f.listShare.of} gün (satış listesinin günleri)` : undefined;
  return f.flow.map((fl) => {
    const rows: BreakdownRow[] =
      fl.key === "extras"
        ? f.manualRows.map((r) => ({ key: r.key, label: sentenceCase(r.label), sub: note, amount: -r.amount * k, href: pnlHref(f.month) }))
        : f.lines.filter((l) => l.group === fl.key).map((l) => ({ key: l.key, label: l.label, sub: note ?? lineSub(l, f), amount: -l.value * k, href: lineHref(l.key, f.month) }));
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

/**
 * Başabaşa ve ay sonu tahminine standart sabit giderle birlikte giren, her ay girilen harcamalar (Aylık harcamalar,
 * denetim E-13): kategori kategori, tutarın ayıyla. Yoksa grup yok
 */
function expensePlanGroup(d: DashboardData, sign: 1 | -1): BreakdownGroup[] {
  const xs = d.breakEven.expenses;
  if (!xs.length) return [];
  const rows: BreakdownRow[] = xs.map((x) => ({
    key: `harcama:${x.cat.id}`,
    label: x.cat.name,
    sub: expensePlanSub(x),
    amount: sign * x.amount,
    href: `/panel/harcamalar?ay=${x.from}`,
  }));
  return [{ key: "harcama", label: "Her ay girilen harcamalar", rows: sign < 0 ? costFirst(rows) : biggestFirst(rows) }];
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
    description: `Brüt kâr${t.online ? " (laffogato.net online satışı dahil)" : ""} − indirimler − o ayın Gelir-gider sabit giderleri (gün oranı, düzeltmeler, bu aya özel satırlar, aylık harcamalar), KDV hariç, reçeteye göre.${
      t.listPeriod ? ` Satış listesi ${listDaysText(t.listPeriod)} günlerini kapsıyor (ayın ${t.listPeriod.of} gününün ${numPossessive(t.listPeriod.days)}): indirim o günlerin kasa raporlarından, sabit gider ve laffogato.net online satışı o günlere düşen payla.` : ""
    }${f.waterExcluded > 0 ? ` SU GİDERİ (${tl(f.waterExcluded)}) reçetelerde sayıldığı için burada ikinci kez düşülmedi.` : ""}`,
    groups: [
      { key: "brut", label: "Brüt kâr", rows: grossRows(model, d) },
      {
        key: "indirim",
        label: "İndirimler",
        rows: [
          {
            key: "indirim",
            label: "Yönetici indirimleri (KDV hariç)",
            sub: t.listPeriod ? `${listDaysText(t.listPeriod)}, KDV dahil ${tl(t.listPeriod.discounts)}` : `KDV dahil ${tl(d.info?.discounts ?? 0)}`,
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

/** Ayın kasası (metinler; denetim E-39): geçiş günü boşken ve öncesinde "Patron (ModPOS)", sonra "LafPOS" */
const kasaOf = (model: Model, month: string) => monthKasa(month, model.settings.lafposGecisGunu);

/** Ürün satışlarının kasası: geçiş ayında modelin saydığı bölünmeyle (ModPOS listesinin son günü, LafPOS'un sayılan günleri) */
function salesKasaOf(model: Model, month: string) {
  return salesMonthKasa(month, model.settings.lafposGecisGunu, model.ds.lafposSales);
}

/** POS cirosu kartının açıklaması: ModPOS ayında bugünkü metin; LafPOS (ya da geçiş) ayında gün sonlarının cirosu */
function posRevenueText(mk: MonthKasa): string {
  return mk.source === "modpos"
    ? "Patron (ModPOS) ciro raporu, KDV dahil: indirimler düşülmüş, ödenmez / ikram hariç. Bu ayın ürün satış raporu yüklenince kart ürün ürün net satışı gösterir."
    : `${mk.long} gün sonlarının cirosu, KDV dahil: indirimler düşülmüş, ödenmez / ikram hariç. Bu ayın ürün satışları gelince kart ürün ürün net satışı gösterir.`;
}

/**
 * POS cirosu dökümünün laffogato.net bölümü (docs/SITE-SATIS.md): uygulama ve web kafe siparişleri, mağaza kolileri ve
 * ön ödemeli karaoke, KDV dahil. Kasadan geçmediği için POS cirosunun toplamına girmez (`apart`), kendi ara toplamıyla
 * ayrı durur; altında kasada ödenen ve panelden elle girilen siparişler bilgi satırı olur. Ay siteden hiç çekilmediyse
 * bölüm yok (0 değil: docs/SITE-SATIS.md › Kâr-zarar).
 */
function onlineGroups(model: Model, month: string): BreakdownGroup[] {
  const rec = model.siteSales(month);
  if (!rec) return [];
  const g = siteGross(rec, model.settings.kdv, model.settings.kdvHizmet);
  const rows: BreakdownRow[] = [
    { key: "kafe", label: "Kafe online (site + uygulama)", sub: `${num(rec.cafe.orders)} sipariş`, amount: rec.cafe.netMinor / 100 },
    { key: "magaza", label: "Mağaza (online)", sub: `${num(rec.shop.orders)} sipariş · kargo dahil`, amount: rec.shop.netMinor / 100 },
    { key: "karaoke", label: "Karaoke (ön ödemeli)", sub: `${num(rec.karaoke.bookings)} rezervasyon`, amount: rec.karaoke.netMinor / 100 },
  ];
  const info: BreakdownRow[] = [
    { key: "online-kdv", label: "Bunun KDV'si", sub: `kafe ve mağaza ${rate(model.settings.kdv)}, karaoke ${rate(model.settings.kdvHizmet)}`, display: tl(g.vat), amount: 0 },
    ...(g.refunded ? [{ key: "online-iade", label: "İade edilen", sub: "tutardan düşülmüş", display: tl(g.refunded), amount: 0 }] : []),
    ...(rec.counter?.orders
      ? [{ key: "online-kasa", label: "Kasada ödenen uygulama siparişi", sub: "POS cirosunda var: eklenmedi", display: tl(rec.counter.netMinor / 100), amount: 0 }]
      : []),
    ...(rec.manual.orders
      ? [{ key: "online-elle", label: "Panelden elle girilen sipariş", sub: "POS cirosunda var: eklenmedi", display: tl(rec.manual.netMinor / 100), amount: 0 }]
      : []),
  ];
  return [
    { key: "online", label: "laffogato.net online (KDV dahil)", note: "Kasadan geçmez: POS cirosuna eklenmez. Kâr ve oranlar ikisinin toplamıyla hesaplanır.", apart: true, rows },
    { key: "online-bilgi", label: "laffogato.net ayrıntısı", apart: true, noSubtotal: true, rows: info },
  ];
}

/** POS cirosu: KDV hariç ciro + KDV; ayın indirim, ikram ve açık gün bilgisi toplamın altında */
export function posRevenueBreakdown(model: Model, d: DashboardData): CardBreakdown {
  const pos = d.info?.posRevenue ?? 0;
  // Gelir-gider tablosunun hesabı: hizmet (karaoke) payı varsa kendi KDV oranıyla
  const pm = model.pnlMonth(d.month);
  const net = pm.revenueNet ?? 0;
  const info: BreakdownRow[] = [];
  if (d.info?.openDays) info.push({ key: "gun", label: "Açık gün", display: `${num(d.info.openDays)} gün`, amount: 0, href: salesHref(d.month) });
  if (d.info?.discounts) info.push({ key: "indirim", label: "Yönetici indirimleri", sub: "KDV dahil; cirodan düşülmüş", display: tl(d.info.discounts), amount: 0 });
  // Z toplamından düşülen ödenmez (docs/KASA-RAPORU.md › Ciro ve ödenmez): ciro Patron › Ciro raporuyla aynı kalsın
  const offInPos = d.info?.sources?.posRevenue === "kasa" ? (d.info.kasa?.till.offInPos ?? 0) : 0;
  if (offInPos) info.push({ key: "z-toplami", label: "Z toplamları (ödenmez dahil)", sub: "Kasanın ham toplamı", display: tl(d.info!.kasa!.till.zTotalSum ?? pos + offInPos), amount: 0 });
  if (d.info?.offRevenue)
    info.push({
      key: "odenmez",
      label: "Ödenmez / ikram",
      sub: offInPos ? "KDV dahil; ciroya girmez: Z toplamından düşüldü" : "KDV dahil; ciroya girmez",
      display: offInPos ? `− ${tl(offInPos)}` : tl(d.info.offRevenue),
      amount: 0,
    });
  return {
    title: `${monthLabel(d.month)} POS cirosu`,
    description: posRevenueText(kasaOf(model, d.month)),
    groups: pos
      ? [
          {
            key: "pos",
            rows: [
              { key: "net", label: "Ciro (KDV hariç)", sub: posNetSub(model, pm), amount: net, href: salesHref(d.month) },
              {
                key: "kdv",
                label: `KDV (${pm.serviceRevenue ? `${rate(model.settings.kdv)} ve ${rate(model.settings.kdvHizmet)}` : rate(model.settings.kdv)})`,
                amount: pos - net,
              },
            ],
          },
          ...onlineGroups(model, d.month),
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
      "Gelir-gider tablosundaki sonuç, KDV hariç: ciro − satılan mal maliyeti − giderler, bölüm bölüm. Stok sayımı olmayan ayda mal maliyeti tahminidir (sayım aralığına dağıtılır ya da reçeteye göre; hiç sayım yokken alınan malın tamamı).",
    groups: has
      ? [
          {
            key: "gelir",
            label: "Gelir",
            rows: [
              { key: "revenueNet", label: "Ciro (KDV hariç)", sub: posNetSub(model, pm), amount: pm.revenueNet ?? 0, href: salesHref(month) },
              // laffogato.net online satışı (KDV hariç): ay çekildiyse ayrı satırlar (docs/SITE-SATIS.md)
              ...(pm.site
                ? [
                    { key: "site:cafe", label: "Kafe online (site + uygulama)", sub: "laffogato.net · KDV hariç", amount: pm.site.cafe, href: "/panel/gelir-gider" },
                    { key: "site:shop", label: "Mağaza (online)", sub: "laffogato.net · KDV hariç", amount: pm.site.shop, href: "/panel/gelir-gider" },
                    { key: "site:karaoke", label: "Karaoke (ön ödemeli)", sub: "laffogato.net · KDV hariç", amount: pm.site.karaoke, href: "/panel/gelir-gider" },
                  ]
                : []),
            ],
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
  const days = fc.closedDays ? "ayın açık günü" : "ayın gün sayısı";
  return {
    title,
    description: `Bu tempo sürerse: POS cirosu ÷ açık gün × ${days}${fc.closedDays ? ` (kapalı işaretli ${num(fc.closedDays)} gün hariç)` : ""} × ${
      fc.refMonth ? `${monthLabel(fc.refMonth)} ` : "son satış ayının "
    }brüt kâr oranı${fc.projectedOnline !== null ? " + laffogato.net online satışın brüt kârı (aynı tempoyla)" : ""} − standart aylık sabit gider${
      d.breakEven.expensesTotal ? " − her ay girilen harcamalar" : ""
    } (Excel Panel B19). Açık gün bugüne kadar geçen gün sayılır.`,
    groups: [
      {
        key: "ciro",
        label: "Tahmini ciro",
        noSubtotal: true,
        rows: [
          { key: "pos", label: "POS cirosu (bugüne kadar, KDV dahil)", display: tl(d.info?.posRevenue ?? 0), amount: 0, href: salesHref(d.month) },
          { key: "gun", label: "Geçen gün", display: `${num(fc.daysElapsed)} / ${num(fc.dim)} gün`, amount: 0 },
          ...(fc.closedDays
            ? [{ key: "kapali", label: "Kafe kapalı işaretli", sub: "Özel günler; ay sonu öngörüsüne açık gün olarak girmez", display: `${num(fc.closedDays)} gün`, amount: 0, href: "/panel/ozel-gunler" }]
            : []),
          { key: "ciro", label: "Bu tempoyla ay sonu ciro", sub: `POS cirosu ÷ geçen gün × ${days}`, display: tl(fc.projectedRevenue), amount: 0 },
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
          ...(fc.projectedOnline !== null
            ? [
                {
                  key: "online",
                  label: "laffogato.net online brüt kârı",
                  sub: `Bugüne kadarki ÷ geçen gün × ${days}, reçeteye göre`,
                  amount: fc.projectedOnline,
                  href: pnlHref(d.month),
                },
              ]
            : []),
        ],
      },
      { key: "sabit", label: "Standart aylık sabit gider", rows: standardRows(d, -1) },
      ...expensePlanGroup(d, -1),
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
  const cover = d.onlineCover;
  const monthly = d.breakEven.monthly;
  const exp = d.breakEven.expensesTotal > 0;
  const progress = d.breakEvenProgress;
  const lp = d.theoretical?.listPeriod;
  const tempo: BreakdownRow[] =
    d.dailyAvg && progress !== null
      ? [
          {
            key: "ortalama",
            label: "Günlük ortalama ciro",
            sub: d.hasSales ? (lp ? `Satış listesi (indirim öncesi) ÷ listenin açık günü (${listDaysText(lp)}, ${num(lp.openDays)} gün)` : "Satış listesi (indirim öncesi) ÷ açık gün") : "POS cirosu ÷ açık gün",
            display: tl(d.dailyAvg),
            amount: 0,
          },
          { key: "ilerleme", label: "Başabaşa göre", display: pct(progress, 0), amount: 0, tone: progress >= 1 ? "good" : progress > 0.85 ? "warn" : "bad" },
        ]
      : [];
  return {
    title: "Başabaş günlük ciro",
    description: `Zarar etmemek için gereken günlük ciro (KDV dahil): ${exp || cover ? "(" : ""}standart aylık sabit gider${exp ? " + her ay girilen harcamalar" : ""}${cover ? " − laffogato.net online satışın brüt kârı" : ""}${exp || cover ? ")" : ""} ÷ brüt kâr oranı ÷ ayda açık gün.${
      d.refMonth ? ` Brüt kâr oranı ${monthLabel(d.refMonth)} satışlarından.` : ""
    }${cover ? ` Online satış (laffogato.net) sabit giderin bir kısmını karşılar: ${monthLabel(cover.month)} brüt kârı düşülür, kalanı kasanın cirosu karşılar.` : ""}${
      d.breakEven.shared > 0 ? ` Şube seçili: işletme geneli sabit giderler (${tl(d.breakEven.shared)}, bilgi) şubenin başabaşına girmez; Tümü'de bir kez sayılır.` : ""
    }`,
    groups: [
      { key: "sabit", label: "Standart aylık sabit gider", rows: standardRows(d, 1) },
      ...expensePlanGroup(d, 1),
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
          ...(cover
            ? [
                {
                  key: "online",
                  label: "laffogato.net online brüt kârı",
                  sub: `${monthLabel(cover.month)}, reçeteye göre; sabit giderden düşülür`,
                  display: tl(cover.grossProfit),
                  amount: 0,
                  href: pnlHref(cover.month),
                },
              ]
            : []),
          {
            key: "aylik",
            label: "Başabaş aylık ciro",
            sub: `${exp || cover ? "(" : ""}${exp ? "Sabit gider + aylık harcamalar" : "Sabit gider"}${cover ? " − laffogato.net brüt kârı" : ""}${exp || cover ? ")" : ""} ÷ brüt kâr oranı`,
            display: tl(monthly),
            amount: 0,
          },
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

import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import type { MonthSales, SalesLineCalc } from "@/lib/calc/engine";
import type { Settings } from "@/lib/calc/types";
import { num, pct, tl } from "@/lib/format";

/** Dökümün kullandığı ay satışı alanları (`model.monthSales`); sayfanın zaten yüklediği veri, yeni sorgu yok */
export type SalesMonth = Pick<
  MonthSales,
  "lines" | "qty" | "revenue" | "net" | "cost" | "commission" | "grossProfit" | "matchedNet" | "matchedCost" | "avgCostRatio" | "serviceRevenue"
>;

/** Satışlar'daki dört özet kartının dökümü */
export interface SalesBreakdowns {
  /** Ciro (KDV dahil): kategori altında ürün ürün; eşleşmeyen ve HİZMET satırları ayrı bölüm. KDV ve komisyon ayrı bilgi */
  revenue: BreakdownGroup[];
  /** Brüt kâr: net ciro − malzeme + ambalaj − POS komisyonu (verilen sırayla); kategori kategori ayrı bilgi */
  grossProfit: BreakdownGroup[];
  /** Satılan ürün (adet): ciro dökümüyle aynı bölümler */
  qty: BreakdownGroup[];
  /** Eşleşmeyen ürün (kalem): ciroya göre; bütün kalemlerin durumu ve maliyet tahmini ayrı bilgi */
  unmatched: BreakdownGroup[];
}

type Kind = "matched" | "unmatched" | "service";

const kindOf = (l: SalesLineCalc): Kind => (l.line.isService ? "service" : l.matched ? "matched" : "unmatched");

/** Tablodaki ?durum= değerleri (sales-client.tsx FILTER_STATUS) */
const DURUM: Record<Kind, string> = { matched: "eslesen", unmatched: "eslesmeyen", service: "hizmet" };

/** Satış tablosuna inen bağlantı: durum ve arama süzgeci adreste, tablo istemcide süzer */
export function salesListHref(month: string, kind: Kind, ara?: string): string {
  return `/panel/satislar?ay=${month}&durum=${DURUM[kind]}${ara ? `&ara=${encodeURIComponent(ara)}` : ""}#satirlar`;
}

/** Oran yazısı: tam yüzdede ondalıksız (%10), küsuratlıda bir ondalık (%85,6) */
const rate = (v: number) => pct(v, Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? 0 : 1);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Dökümde bir kalem: menü ürünü (aynı ürüne bağlı POS satırları birlikte) ya da tek POS satırı */
interface Item {
  key: string;
  label: string;
  lines: SalesLineCalc[];
  href: string;
}

/** Bölüm: menü kategorisi, "Eşleşmeyen" ya da "HİZMET" */
interface Bucket {
  key: string;
  label: string;
  note?: string;
  items: Item[];
  lines: SalesLineCalc[];
}

/**
 * Ayın satırlarını bölümlere ayırır: reçeteli ürüne bağlı satırlar ürünün kategorisinde ürün ürün (bir ürüne birden
 * çok POS adı bağlıysa tek kalem), eşleşmeyen ve HİZMET satırları kendi bölümünde satır satır.
 */
function bucketsOf(lines: SalesLineCalc[], month: string): Bucket[] {
  const buckets = new Map<string, Bucket>();
  const items = new Map<string, Item>();
  for (const l of lines) {
    const kind = kindOf(l);
    const p = l.product;
    const b =
      kind === "matched"
        ? { key: `kat:${p?.category?.name ?? ""}`, label: p?.category?.name || "Kategorisiz" }
        : kind === "service"
          ? { key: "hizmet", label: "HİZMET (maliyetsiz)", note: "Ürüne bağlanmayan hizmet satırları; malzeme maliyeti yok." }
          : { key: "eslesmeyen", label: "Eşleşmeyen", note: "Menüye bağlanmamış satırlar; maliyeti ortalama orandan tahmin edilir." };
    const bucket = buckets.get(b.key) ?? { ...b, items: [], lines: [] };
    buckets.set(b.key, bucket);
    bucket.lines.push(l);
    const itemKey = kind === "matched" && p ? `p${p.product.id}` : `l${l.line.id}`;
    const item = items.get(itemKey);
    if (item) {
      item.lines.push(l);
      continue;
    }
    const next: Item = {
      key: itemKey,
      label: kind === "matched" && p ? `${p.product.name} · ${p.product.size}` : l.line.posName,
      lines: [l],
      href: salesListHref(month, kind, l.line.posName),
    };
    items.set(itemKey, next);
    bucket.items.push(next);
  }
  // Bir ürüne birden çok POS adı bağlıysa tabloda ürün adıyla aranır (ürün etiketi aramaya girer)
  for (const it of items.values()) {
    const p = it.lines[0].product;
    if (it.lines.length > 1 && p) it.href = salesListHref(month, "matched", p.product.name);
  }
  return [...buckets.values()];
}

const total = (ls: SalesLineCalc[], f: (l: SalesLineCalc) => number) => sum(ls.map(f));
const linesNote = (n: number) => (n > 1 ? ` · ${num(n)} POS kalemi` : "");

/**
 * Satışlar kartlarının dökümü, ayın satış satırlarından (`model.monthSales`). Her döküm kartın rakamını tutar:
 * ciro ve adet satır toplamı, brüt kâr net ciro − maliyet − komisyon, eşleşmeyen kalem sayısı. `cardShare`: ayın kartlı
 * satış oranı (`model.cardShareOf(ay).rate`: kasa raporlarından ya da elle; verilmezse Ayarlar'daki).
 */
export function salesBreakdowns(
  sales: SalesMonth,
  settings: Pick<Settings, "kdv" | "kdvHizmet" | "komisyon" | "kartOrani">,
  month: string,
  cardShare: number = settings.kartOrani,
): SalesBreakdowns {
  if (!sales.lines.length) return { revenue: [], grossProfit: [], qty: [], unmatched: [] };
  const buckets = bucketsOf(sales.lines, month);
  const byKind = (k: Kind) => sales.lines.filter((l) => kindOf(l) === k);
  const matched = byKind("matched");
  const unmatched = byKind("unmatched");
  const services = byKind("service");
  const unmatchedNet = total(unmatched, (l) => l.net);
  const unmatchedCost = total(unmatched, (l) => l.cost);
  const commissionSub = `Ciro × kartlı satış ${rate(cardShare)} × komisyon ${rate(settings.komisyon)}`;

  const itemRows = (b: Bucket, amount: (ls: SalesLineCalc[]) => number, sub: (ls: SalesLineCalc[]) => string): BreakdownRow[] =>
    b.items.map((it) => ({ key: it.key, label: it.label, sub: sub(it.lines), amount: amount(it.lines), href: it.href }));

  const revenue: BreakdownGroup[] = [
    ...buckets.map((b) => ({
      key: b.key,
      label: b.label,
      note: b.note,
      rows: itemRows(
        b,
        (ls) => total(ls, (l) => l.line.revenue),
        (ls) => `${num(total(ls, (l) => l.line.qty))} adet${linesNote(ls.length)}`,
      ),
    })),
    // Karttaki alt satır (net ve POS komisyonu): toplama girmez, cironun nereye gittiğini gösterir
    {
      key: "kdv-komisyon",
      label: "Net ciro ve POS komisyonu",
      apart: true,
      noSubtotal: true,
      rows: [
        {
          key: "net",
          label: "Net ciro (KDV hariç)",
          sub: sales.serviceRevenue
            ? `Ürünler ÷ (1 + ${rate(settings.kdv)} KDV), hizmet (karaoke) ÷ (1 + ${rate(settings.kdvHizmet)} KDV)`
            : `Ciro ÷ (1 + ${rate(settings.kdv)} KDV)`,
          amount: sales.net,
        },
        {
          key: "kdv",
          label: "KDV",
          sub: `${sales.serviceRevenue ? `${rate(settings.kdv)} ve ${rate(settings.kdvHizmet)} (hizmet)` : rate(settings.kdv)}, ciro − net ciro`,
          amount: sales.revenue - sales.net,
        },
        { key: "commission", label: "POS komisyonu", sub: `${commissionSub}; brüt kârdan düşülür`, amount: sales.commission },
      ],
    },
  ];

  const qty: BreakdownGroup[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    rows: itemRows(
      b,
      (ls) => total(ls, (l) => l.line.qty),
      (ls) => `Ciro ${tl(total(ls, (l) => l.line.revenue))}${linesNote(ls.length)}`,
    ),
  }));

  // Brüt kâr: önce gelir, sonra giderler eksi olarak (verilen sırayla); kategori kategori kâr ayrı bilgi
  const grossProfit: BreakdownGroup[] = [
    {
      key: "gelir",
      label: "Gelir",
      rows: [{ key: "net", label: "Net ciro (KDV hariç)", sub: `Ciro ${tl(sales.revenue)} − KDV ${tl(sales.revenue - sales.net)}`, amount: sales.net }],
    },
    {
      key: "malzeme",
      label: "Malzeme + ambalaj",
      rows: [
        {
          key: "recipe",
          label: "Reçeteli ürünler",
          sub: `${num(matched.length)} POS kalemi · reçete maliyeti × adet`,
          amount: -total(matched, (l) => l.cost),
        },
        {
          key: "estimate",
          label: "Eşleşmeyen ürünler (tahmini)",
          sub: `Net ciro ${tl(unmatchedNet)} × ort. maliyet oranı ${pct(sales.avgCostRatio)}`,
          amount: -unmatchedCost,
        },
      ],
    },
    { key: "komisyon", label: "Komisyon", rows: [{ key: "commission", label: "POS komisyonu", sub: commissionSub, amount: -sales.commission }] },
    {
      key: "kategori",
      label: "Kategorilere göre",
      apart: true,
      rows: buckets
        .map((b) => {
          const net = total(b.lines, (l) => l.net);
          const gp = total(b.lines, (l) => l.grossProfit);
          return { key: b.key, label: b.label, sub: `Net ciro ${tl(net)}${net ? ` · marj ${pct(gp / net)}` : ""}`, amount: gp };
        })
        .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "tr")),
    },
  ];

  const revenueOf = (ls: SalesLineCalc[]) => total(ls, (l) => l.line.revenue);
  const assigned = revenueOf(matched) + revenueOf(services);
  const unmatchedGroups: BreakdownGroup[] = [
    // Her kalem bir sayılır (kartın rakamı kalem sayısı); sağda kalemin cirosu, en çok ciro getiren önce
    {
      key: "eslesmeyen",
      label: "Eşleşmeyen POS kalemleri",
      display: tl(revenueOf(unmatched)),
      note: "Ciroya göre; kaleme dokununca eşleştirmek için tabloda açılır.",
      rows: [...unmatched]
        .sort((a, b) => b.line.revenue - a.line.revenue || a.line.posName.localeCompare(b.line.posName, "tr"))
        .map((l) => ({
          key: `l${l.line.id}`,
          label: l.line.posName,
          sub: `${num(l.line.qty)} adet · tahmini maliyet ${tl(l.cost)}`,
          amount: 1,
          display: tl(l.line.revenue),
          href: salesListHref(month, "unmatched", l.line.posName),
        })),
    },
    {
      key: "durum",
      label: "Bütün POS kalemleri",
      apart: true,
      rows: [
        { key: "matched", label: "Eşleşen", sub: `Ciro ${tl(revenueOf(matched))}`, amount: matched.length, href: salesListHref(month, "matched") },
        { key: "service", label: "HİZMET", sub: `Ciro ${tl(revenueOf(services))}`, amount: services.length, href: salesListHref(month, "service") },
        { key: "unmatched", label: "Eşleşmeyen", sub: `Ciro ${tl(revenueOf(unmatched))}`, amount: unmatched.length, href: salesListHref(month, "unmatched") },
      ],
    },
    {
      key: "tahmin",
      label: "Maliyet tahmini",
      apart: true,
      noSubtotal: true,
      rows: [
        {
          key: "coverage",
          label: "Eşleştirilmiş ciro",
          sub: `Ürüne ya da HİZMET'e bağlı ${tl(assigned)} / ciro ${tl(sales.revenue)}`,
          amount: 0,
          display: pct(sales.revenue ? assigned / sales.revenue : 0, 0),
        },
        {
          key: "avg",
          label: "Ort. maliyet oranı",
          sub: `Reçeteli ürünlerin malzeme maliyeti ${tl(sales.matchedCost)} ÷ net cirosu ${tl(sales.matchedNet)}`,
          amount: 0,
          display: pct(sales.avgCostRatio),
        },
        {
          key: "estimate",
          label: "Eşleşmeyenlere eklenen maliyet",
          sub: `Net ciro ${tl(unmatchedNet)} × ${pct(sales.avgCostRatio)}`,
          amount: 0,
          display: tl(unmatchedCost),
        },
      ],
    },
  ];

  return { revenue, grossProfit, qty, unmatched: unmatchedGroups };
}

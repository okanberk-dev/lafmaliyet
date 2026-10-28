// Ürünler sayfasındaki dört özet kartının dökümü (karta dokununca açılan pencere): menüdeki ürünler kategori
// kategori, hedefin dışında kalanlar durum durum, ayın satılan çeşitleri ve brüt kârı ürün ürün. Saf fonksiyonlar;
// veri sayfanın zaten kurduğu ürün satırlarından gelir. tests/urunler-dokum.test.ts ile sınanır.

import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import type { ProductStatus } from "@/lib/calc/engine";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS, SIZES } from "@/lib/constants";
import { num, pct, tl, tl2 } from "@/lib/format";

import { menuAverages, productHref, soldProfit } from "./logic";
import type { ProductRow } from "./products-table";

/** Dökümün kullandığı ürün alanları (sayfadaki `ProductRow`) */
export type BreakdownProduct = Pick<
  ProductRow,
  "id" | "name" | "size" | "categoryId" | "category" | "active" | "price" | "net" | "cost" | "costRatio" | "margin" | "unitProfit" | "status" | "soldQty" | "monthProfit" | "monthNet"
>;

export interface ProductBreakdowns {
  /** Menüdeki ürün: kategori kategori adet; pasifler ve ürünü olmayan kategoriler ayrı */
  menu: BreakdownGroup[];
  /** Menüdeki ürünlerin boy boy sayısı (açıklamada): "Medium 30 · Large 30 · Tek boy 12" */
  menuSizes: string;
  /** Hedefin dışında: hedef ve menü ortalaması, Düşük kâr ve Dikkat ürünleri; diğer durumlar ayrı */
  offTarget: BreakdownGroup[];
  /** Satılan çeşit: kategori kategori ürünler, satılan adetle; satılmayanlar ayrı */
  sold: BreakdownGroup[];
  /** Satılan çeşit toplam satırı: "24 çeşit · 1.250 adet" (kartın rakamı ve alt satırı) */
  soldTotal: string;
  /** Brüt kâr: kategori kategori reçeteli ürünlerin birim kâr × adedi; ağırlıklı marj ve reçetesi boş satılanlar ayrı */
  profit: BreakdownGroup[];
  /** Zararına satılan ürün var: pay sütunu kapanır (artı/eksi karışık) */
  profitHasLoss: boolean;
}

/** Listeye inen bağlantı: süzgeçler tablonun okuduğu adlarla (?kategori, ?durum, ?pasif), seçili ay korunur */
export function listLink(month: string, filters: Record<string, string>): string {
  const sp = new URLSearchParams(filters);
  sp.set("ay", month);
  return `/panel/urunler?${sp.toString()}`;
}

/** Ürünün dökümdeki adı: "Latte · Large"; tek boylu üründe yalnızca ad */
export const productLabel = (r: Pick<BreakdownProduct, "name" | "size">) =>
  r.size === "Tek" ? r.name : `${r.name} · ${SIZE_LABELS[r.size as Size] ?? r.size}`;

/** Boy boy sayı: "Medium 5 · Large 5"; boş boylar yazılmaz, bilinmeyen boy sonda */
function sizeSplit(rows: Pick<BreakdownProduct, "size">[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.size, (counts.get(r.size) ?? 0) + 1);
  const order = [...SIZES.filter((s) => counts.has(s)), ...[...counts.keys()].filter((s) => !SIZES.includes(s as Size))];
  return order.map((s) => `${SIZE_LABELS[s as Size] ?? s} ${num(counts.get(s))}`).join(" · ");
}

/** Kategoriler sayfadaki sırayla; ürünü olup listede olmayan (silinmiş) kategori sonda */
function byCategory<T extends Pick<BreakdownProduct, "categoryId" | "category">>(
  rows: T[],
  categories: { id: number; name: string }[],
): { id: number; name: string; rows: T[] }[] {
  const known = new Set(categories.map((c) => c.id));
  const extra = [...new Map(rows.filter((r) => !known.has(r.categoryId)).map((r) => [r.categoryId, r.category])).entries()].map(([id, name]) => ({ id, name }));
  return [...categories, ...extra].map((c) => ({ ...c, rows: rows.filter((r) => r.categoryId === c.id) }));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byName = (a: BreakdownProduct, b: BreakdownProduct) => a.name.localeCompare(b.name, "tr") || a.size.localeCompare(b.size, "tr");

/** Fiyatı girilmemiş ürünün oranı anlamsız (%0 görünür ama zararına satılır); tabloda da tire */
const noPrice = (r: BreakdownProduct) => r.price <= 0;

export function productBreakdowns(rows: BreakdownProduct[], categories: { id: number; name: string }[], month: string, target: number): ProductBreakdowns {
  const active = rows.filter((r) => r.active);
  const inactive = rows.filter((r) => !r.active);
  const cats = byCategory(rows, categories);
  const card = (r: BreakdownProduct) => productHref(r.id, month);

  // ------------------------------------------------ Menüdeki ürün
  const menu: BreakdownGroup[] = [
    {
      key: "menu",
      rows: cats
        .map((c) => ({ ...c, live: c.rows.filter((r) => r.active) }))
        .filter((c) => c.live.length)
        .map((c) => ({ key: `kat:${c.id}`, label: c.name, sub: sizeSplit(c.live), amount: c.live.length, href: listLink(month, { kategori: String(c.id) }) })),
    },
    {
      key: "pasif",
      label: "Pasif ürünler",
      note: "Menüden kaldırılmış ürün ve boylar; kartta sayılmaz. Listede “Pasifler dahil” ile görünür.",
      apart: true,
      rows: cats
        .map((c) => ({ ...c, off: c.rows.filter((r) => !r.active) }))
        .filter((c) => c.off.length)
        .map((c) => ({ key: `pasif:${c.id}`, label: c.name, sub: sizeSplit(c.off), amount: c.off.length, href: listLink(month, { kategori: String(c.id), pasif: "1" }) })),
    },
    {
      // Kartın alt satırındaki kategori sayısı bunları da sayar: hepsi dökümde görünsün
      key: "bos",
      label: "Menüde ürünü olmayan kategoriler",
      apart: true,
      noSubtotal: true,
      rows: cats
        .filter((c) => categories.some((k) => k.id === c.id) && !c.rows.some((r) => r.active))
        .map((c) => ({ key: `bos:${c.id}`, label: c.name, amount: 0, display: c.rows.length ? "Yalnızca pasif" : "Ürün yok" })),
    },
  ];

  // ------------------------------------------------ Hedefin dışında
  const avg = menuAverages(active);
  const ratioTone = (v: number | null): BreakdownRow["tone"] => (v === null ? undefined : v > target + 0.1 ? "bad" : v > target ? "warn" : "good");
  const statusRows = (status: ProductStatus, tone: "bad" | "warn"): BreakdownRow[] =>
    active
      .filter((r) => r.status === status)
      // En yüksek oran önce; fiyatı girilmemiş ürün en üstte (oranı yok, zararına satılır)
      .sort((a, b) => Number(noPrice(b)) - Number(noPrice(a)) || b.costRatio - a.costRatio || byName(a, b))
      .map((r) => ({
        key: `urun:${r.id}`,
        label: productLabel(r),
        sub: noPrice(r) ? `${r.category} · satış fiyatı girilmemiş` : `${r.category} · maliyet ${tl2(r.cost)} ÷ net ${tl2(r.net)}`,
        amount: 1,
        display: noPrice(r) ? "Fiyat yok" : pct(r.costRatio),
        tone,
        href: card(r),
      }));
  const targetText = `%${num(target * 100)}`;
  const offTarget: BreakdownGroup[] = [
    {
      key: "hedef",
      label: "Hedef ve menü ortalaması",
      noSubtotal: true,
      rows: [
        { key: "hedef", label: "Hedef maliyet oranı", sub: "Malzeme maliyeti ÷ net satış (Ayarlar)", amount: 0, display: targetText },
        {
          key: "ort-oran",
          label: "Menü ortalama maliyet oranı",
          sub: `${num(avg.count)} ürünün basit ortalaması (her ürün bir oy); reçetesizler katılmaz`,
          amount: 0,
          display: pct(avg.costRatio),
          tone: ratioTone(avg.costRatio),
        },
        { key: "ort-marj", label: "Menü ortalama kâr marjı", sub: "Birim kâr ÷ net satış, aynı ürünlerin ortalaması", amount: 0, display: pct(avg.margin) },
      ],
    },
    { key: "dusuk", label: "Düşük kâr", note: `Maliyet oranı hedefin 10 puandan fazla üstünde (> %${num(target * 100 + 10)}).`, rows: statusRows("Düşük kâr", "bad") },
    { key: "dikkat", label: "Dikkat", note: `Maliyet oranı hedefin üstünde, en fazla 10 puan (${targetText}–%${num(target * 100 + 10)}).`, rows: statusRows("Dikkat", "warn") },
    {
      key: "diger",
      label: "Diğer durumlar",
      apart: true,
      rows: [
        { key: "iyi", label: "İyi", sub: "Maliyet oranı hedefin altında", amount: active.filter((r) => r.status === "İyi").length, href: listLink(month, { durum: "İyi" }) },
        {
          key: "recetesiz",
          label: "Reçete yok",
          sub: "Reçete kartı boş; oran hesaplanmaz",
          amount: active.filter((r) => r.status === "Reçete yok").length,
          href: listLink(month, { durum: "Reçete yok" }),
        },
      ],
    },
  ];

  // ------------------------------------------------ Satılan çeşit ve brüt kâr
  const soldRows = active.filter((r) => r.soldQty > 0);
  const soldQty = sum(soldRows.map((r) => r.soldQty));
  const kinds = (n: number, qty: number) => `${num(n)} çeşit · ${num(qty)} adet`;
  const byQty = (a: BreakdownProduct, b: BreakdownProduct) => b.soldQty - a.soldQty || byName(a, b);
  const qtyRow = (r: BreakdownProduct): BreakdownRow => ({ key: `urun:${r.id}`, label: productLabel(r), amount: 1, display: `${num(r.soldQty)} adet`, href: card(r) });
  // Menüden kaldırılmış ama bu ay satılmış ürün (eski ay): kartlarda sayılmaz, dökümde ayrı
  const soldInactive = inactive.filter((r) => r.soldQty > 0).sort(byQty);
  const inactiveNote = "Menüden kaldırılmış ama bu ay satılmış ürünler; kartta sayılmaz.";

  const sold: BreakdownGroup[] = soldRows.length
    ? [
        ...cats
          .map((c) => ({ ...c, live: soldRows.filter((r) => r.categoryId === c.id).sort(byQty) }))
          .filter((c) => c.live.length)
          .map((c) => ({ ...c, qty: sum(c.live.map((r) => r.soldQty)) }))
          .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "tr"))
          .map((c) => ({ key: `kat:${c.id}`, label: c.name, display: kinds(c.live.length, c.qty), rows: c.live.map(qtyRow) })),
        {
          key: "satilmayan",
          label: "Bu ay satılmayan",
          note: "Menüde olup bu ay satış raporunda eşleşen satırı olmayan ürünler.",
          apart: true,
          display: `${num(active.length - soldRows.length)} çeşit`,
          rows: active
            .filter((r) => !(r.soldQty > 0))
            .map((r) => ({ key: `urun:${r.id}`, label: productLabel(r), sub: r.category, amount: 1, display: "0 adet", href: card(r) })),
        },
        {
          key: "pasif",
          label: "Pasif ürünler",
          note: inactiveNote,
          apart: true,
          display: kinds(soldInactive.length, sum(soldInactive.map((r) => r.soldQty))),
          rows: soldInactive.map(qtyRow),
        },
      ]
    : [];

  // Kârın ürünleri: satılan reçeteliler (reçetesi boş ürünün kârı ~cirosu kadar görünürdü; denetim E-47)
  const { profit: totalProfit, net: totalNet, counted: profitRows, noRecipe: soldNoRecipe } = soldProfit(active);
  const profitRow = (r: BreakdownProduct): BreakdownRow => ({
    key: `urun:${r.id}`,
    label: productLabel(r),
    sub: `${num(r.soldQty)} adet × ${tl2(r.unitProfit)} birim kâr`,
    amount: r.monthProfit,
    href: card(r),
  });
  const profit: BreakdownGroup[] = soldRows.length
    ? [
        // Kategoriler kârı büyükten küçüğe; zarardaki kategori sonda
        ...cats
          .map((c) => ({ ...c, live: profitRows.filter((r) => r.categoryId === c.id) }))
          .filter((c) => c.live.length)
          .map((c) => ({ ...c, total: sum(c.live.map((r) => r.monthProfit)) }))
          .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "tr"))
          .map((c) => ({ key: `kat:${c.id}`, label: c.name, rows: [...c.live].sort((a, b) => b.monthProfit - a.monthProfit || byName(a, b)).map(profitRow) })),
        {
          key: "marj",
          label: "Net satış ve ağırlıklı marj",
          apart: true,
          noSubtotal: true,
          rows: [
            { key: "net", label: "Net satış", sub: "Eşleşen reçeteli ürünler: fiyat ÷ (1 + KDV) × adet", amount: 0, display: tl(totalNet) },
            { key: "kar", label: "Brüt kâr", sub: "Net satış − malzeme maliyeti − komisyon", amount: 0, display: tl(totalProfit), tone: totalProfit < 0 ? "bad" : undefined },
            {
              key: "oran",
              label: "Ağırlıklı marj",
              sub: `Brüt kâr ÷ net satış; çok satan ürün daha çok sayılır. Menünün basit ortalaması ${pct(avg.margin)}.`,
              amount: 0,
              display: totalNet ? pct(totalProfit / totalNet) : "–",
            },
          ],
        },
        {
          key: "recetesiz",
          label: "Reçetesi boş (kâra girmedi)",
          note: "Bu ay satılan ama reçete kartı boş ürünler: maliyeti bilinmiyor, kârı neredeyse cirosu kadar görünürdü. Reçetesini girince kâra katılır.",
          apart: true,
          noSubtotal: true,
          rows: [...soldNoRecipe]
            .sort((a, b) => b.soldQty - a.soldQty || byName(a, b))
            .map((r) => ({ key: `urun:${r.id}`, label: productLabel(r), sub: `${r.category} · net ${tl(r.monthNet)}`, amount: 0, display: `${num(r.soldQty)} adet`, tone: "warn" as const, href: card(r) })),
        },
        {
          key: "pasif",
          label: "Pasif ürünler",
          note: inactiveNote,
          apart: true,
          // Reçetesi boş pasif ürünün kârı da hesaplanmaz (yukarıdaki grupla aynı kural): tutarı yok, sonda
          rows: [...soldInactive]
            .sort((a, b) => Number(a.status === "Reçete yok") - Number(b.status === "Reçete yok") || b.monthProfit - a.monthProfit || byName(a, b))
            .map((r) =>
              r.status === "Reçete yok"
                ? { key: `urun:${r.id}`, label: productLabel(r), sub: `${num(r.soldQty)} adet · reçete boş`, amount: 0, display: "–", tone: "warn" as const, href: card(r) }
                : profitRow(r),
            ),
        },
      ]
    : [];

  return {
    menu,
    menuSizes: sizeSplit(active),
    offTarget,
    sold,
    soldTotal: kinds(soldRows.length, soldQty),
    profit,
    profitHasLoss: profitRows.some((r) => r.monthProfit < 0),
  };
}

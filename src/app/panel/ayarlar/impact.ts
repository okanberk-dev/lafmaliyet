// Ayar değişikliğinin etkisi (kaydetmeden önce): Excel'de mavi hücreyi değiştirince Ürün Kârlılık, durumlar ve
// başabaş anında güncellenir; panelde aynı hesap, kaydedilmemiş değerlerle tarayıcıda yeniden çalıştırılır.
// Saf modül: hem sunucu sayfası (veriyi hazırlar) hem istemci (hesaplar) hem testler kullanır.

import { createModel, type Model, type ProductStatus } from "@/lib/calc/engine";
import { latestSalesMonth, requiredDailyRevenue } from "@/lib/calc/insights";
import type { Dataset, Settings } from "@/lib/calc/types";

/**
 * Önizleme için hesaplama motorunun ihtiyaç duyduğu en küçük veri: ürünler, reçeteler, hammaddeler, son satış ayının
 * ve su faturası ayının satış listesi, su faturası ayının laffogato.net satışı (litre online siparişleri de sayar,
 * denetim E-57), SU GİDERİ satırları, personel ve sabit giderler. Faturalar, sayımlar ve öteki gelir-gider satırları
 * ayarlardan etkilenmediği için gönderilmez.
 */
export type ImpactData = Pick<
  Dataset,
  | "settings"
  | "ingredients"
  | "categories"
  | "products"
  | "recipeItems"
  | "salesLines"
  | "siteSales"
  | "months"
  | "pnlEntries"
  | "staff"
  | "staffVersions"
  | "fixedExpenses"
  | "fixedExpenseVersions"
  | "currentMonth"
>;

export function impactData(model: Model): ImpactData {
  const ds = model.ds;
  const keep = new Set([latestSalesMonth(model), model.water.month].filter((m): m is string => Boolean(m)));
  return {
    settings: ds.settings,
    // Notlar ve açıklamalar hesaba girmez; istemciye giden veri küçük kalsın
    ingredients: ds.ingredients.map((i) => ({ ...i, note: null, packageDesc: null, supplier: null })),
    categories: ds.categories,
    products: ds.products.map((p) => ({ ...p, note: null })),
    recipeItems: ds.recipeItems.map((r) => ({ ...r, note: null })),
    salesLines: ds.salesLines.filter((l) => keep.has(l.month)).map((l) => ({ ...l, note: null })),
    // Su litresi online siparişleri de sayar: önizlemenin litre fiyatı Hammaddeler'dekiyle aynı kalsın
    siteSales: (ds.siteSales ?? []).filter((r) => r.month === model.water.month),
    months: ds.months.filter((m) => keep.has(m.month)),
    pnlEntries: ds.pnlEntries.filter((e) => e.rowKey === "manual:su").map((e) => ({ ...e, note: null })),
    staff: ds.staff,
    staffVersions: ds.staffVersions,
    fixedExpenses: ds.fixedExpenses,
    fixedExpenseVersions: ds.fixedExpenseVersions,
    currentMonth: ds.currentMonth ?? model.currentMonth,
  };
}

export function impactModel(data: ImpactData, settings: Settings = data.settings): Model {
  return createModel({ ...data, settings, invoices: [], stockCounts: [], stockExtras: [], purchaseQuantities: [] });
}

export interface StatusChange {
  id: number;
  label: string;
  before: ProductStatus;
  after: ProductStatus;
  costRatioBefore: number;
  costRatioAfter: number;
  /** true: durum kötüleşti (İyi → Dikkat, Dikkat → Düşük kâr …) */
  worse: boolean;
}

export interface Change {
  before: number;
  after: number;
}

export interface SettingsImpact {
  /** Hesaba etki eden bir fark var mı (yalnızca QR menü değiştiyse false) */
  any: boolean;
  /** Aktif, reçeteli ürün sayısı */
  products: number;
  statusChanges: StatusChange[];
  costChanged: number;
  suggestedChanged: number;
  /** Aktif reçeteli ürünlerin ortalama maliyet oranı (maliyet ÷ KDV hariç fiyat) */
  avgCostRatio: Change;
  /** Son satış ayı (satış listesine göre brüt kâr, ağırlıklı maliyet oranı) */
  month: string | null;
  grossProfit: Change | null;
  salesCostRatio: Change | null;
  /** Bu ayın başabaş günlük cirosu (KDV dahil) */
  breakEvenDaily: Change | null;
  /** Bu ayın standart sabit gider toplamı (günlük giderler açık gün sayısıyla çarpılır) */
  fixedStandard: Change;
  waterPerLiter: Change;
}

const RANK: Record<ProductStatus, number> = { İyi: 0, Dikkat: 1, "Düşük kâr": 2, "Reçete yok": -1 };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const differs = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) > eps;

/**
 * Kayıtlı ayarlarla (before) yeni ayarları (after) karşılaştırır. Ürünler ürün kimliğiyle eşlenir; yalnızca aktif ve
 * reçetesi olan ürünler sayılır (Ürün Kârlılık tablosunun kapsamı).
 */
export function settingsImpact(before: Model, after: Model): SettingsImpact {
  const afterById = new Map(after.products.map((p) => [p.product.id, p]));
  const pairs = before.products
    .filter((p) => p.product.active && p.cost > 0)
    .map((b) => ({ b, a: afterById.get(b.product.id)! }))
    .filter((x) => x.a);

  const statusChanges: StatusChange[] = pairs
    .filter(({ a, b }) => a.status !== b.status)
    .map(({ a, b }) => ({
      id: b.product.id,
      label: `${b.product.name} · ${b.product.size}`,
      before: b.status,
      after: a.status,
      costRatioBefore: b.costRatio,
      costRatioAfter: a.costRatio,
      worse: RANK[a.status] > RANK[b.status],
    }))
    // Kötüleşenler önce, sonra oran farkı büyük olanlar
    .sort((x, y) => Number(y.worse) - Number(x.worse) || Math.abs(y.costRatioAfter - y.costRatioBefore) - Math.abs(x.costRatioAfter - x.costRatioBefore));

  const month = latestSalesMonth(before);
  const salesB = month ? before.monthSales(month) : null;
  const salesA = month ? after.monthSales(month) : null;
  const beB = requiredDailyRevenue(before, before.currentMonth, 0);
  const beA = requiredDailyRevenue(after, after.currentMonth, 0);

  const impact: SettingsImpact = {
    any: false,
    products: pairs.length,
    statusChanges,
    costChanged: pairs.filter(({ a, b }) => differs(a.cost, b.cost, 0.005)).length,
    suggestedChanged: pairs.filter(({ a, b }) => differs(a.suggestedPrice, b.suggestedPrice, 0.5)).length,
    avgCostRatio: { before: mean(pairs.map((x) => x.b.costRatio)), after: mean(pairs.map((x) => x.a.costRatio)) },
    month,
    grossProfit: salesB && salesA && salesB.lines.length ? { before: salesB.grossProfit, after: salesA.grossProfit } : null,
    salesCostRatio: salesB && salesA && salesB.matchedNet ? { before: salesB.avgCostRatio, after: salesA.avgCostRatio } : null,
    breakEvenDaily: beB !== null && beA !== null ? { before: beB, after: beA } : null,
    fixedStandard: { before: before.fixedStandardTotal, after: after.fixedStandardTotal },
    waterPerLiter: { before: before.water.perLiter, after: after.water.perLiter },
  };
  impact.any =
    statusChanges.length > 0 ||
    impact.costChanged > 0 ||
    impact.suggestedChanged > 0 ||
    changed(impact.avgCostRatio) ||
    changed(impact.grossProfit, 0.5) ||
    changed(impact.breakEvenDaily, 0.5) ||
    changed(impact.fixedStandard, 0.5) ||
    changed(impact.waterPerLiter);
  return impact;
}

/** Önce ve sonra arasında anlamlı fark var mı (kuruş altı gürültü sayılmaz) */
export function changed(c: Change | null, eps = 1e-6): c is Change {
  return c !== null && differs(c.before, c.after, eps);
}

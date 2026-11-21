// Ayar değişikliğinin etkisi (kaydetmeden önce): Excel'de mavi hücreyi değiştirince Ürün Kârlılık, durumlar ve
// başabaş anında güncellenir; panelde aynı hesap, kaydedilmemiş değerlerle tarayıcıda yeniden çalıştırılır.
// Saf modül: hem sunucu sayfası (veriyi hazırlar) hem istemci (hesaplar) hem testler kullanır.

import { createModel, shiftMonth, type Model, type ProductStatus } from "@/lib/calc/engine";
import { latestSalesMonth, onlineCoverFor, referenceSalesMonth, requiredDailyRevenue } from "@/lib/calc/insights";
import type { Dataset, Settings } from "@/lib/calc/types";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";

/**
 * Önizleme için hesaplama motorunun ihtiyaç duyduğu en küçük veri: ürünler, reçeteler, hammaddeler, son satış ayının
 * ve su faturası ayının satış listesi, aynı ayların laffogato.net satışı (litre online siparişleri de sayar,
 * denetim E-57; şube seçiliyken su ayının bütün şubelerdeki satışı da, denetim 21 Kasım #4), SU GİDERİ satırları,
 * personel ve sabit giderler. Başabaş Genel bakış'takiyle aynı kalsın diye (denetim E-59, E-13) başabaşın düştüğü son
 * kapanmış online ay, her ay girilen harcamalar (geçen ay ve bu ay) ve bunlara bağlı fatura kategorisinin faturaları da
 * gelir. Öteki faturalar, sayımlar ve gelir-gider satırları ayarlardan etkilenmediği için gönderilmez.
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
  | "expenseCategories"
  | "expenseEntries"
  | "invoices"
  | "waterSales"
>;

/** Önizlemeye giden işletme geneli su satışı: litre fiyatının ayı; elle fiyat varken (ay boş) satışı olan son fatura ayı */
function companyWaterSales(sales: NonNullable<Dataset["waterSales"]>, waterMonth: string | null): NonNullable<Dataset["waterSales"]> {
  const month = waterMonth ?? sales.salesLines.reduce<string | null>((a, l) => (a === null || l.month > a ? l.month : a), null);
  return {
    salesLines: sales.salesLines.filter((l) => l.month === month).map((l) => ({ ...l, note: null })),
    siteSales: sales.siteSales.filter((r) => r.month === month),
  };
}

export function impactData(model: Model): ImpactData {
  const ds = model.ds;
  const cur = ds.currentMonth ?? model.currentMonth;
  const ref = referenceSalesMonth(model, cur);
  const keep = new Set([latestSalesMonth(model), ref, model.water.month].filter((m): m is string => Boolean(m)));
  // Başabaşın düştüğü online brüt kâr (son kapanmış online ay, breakEvenOf): o ayın satışı da gelir
  const cover = onlineCoverFor(model, ref)?.month;
  // Başabaşın her ay girilen harcamaları (monthlyExpensePlan: geçen aydan bu aya) ve bağlı fatura kategorileri
  const from = shiftMonth(cur, -1);
  const linked = new Set(
    (ds.expenseCategories ?? [])
      .map((c) => c.invoiceCategory)
      .filter((c): c is string => Boolean(c) && !GOODS_CATEGORIES.includes(c!) && c !== COMMISSION_CATEGORY && !SEPARATE_CATEGORIES.includes(c!)),
  );
  return {
    settings: ds.settings,
    // Notlar ve açıklamalar hesaba girmez; istemciye giden veri küçük kalsın
    ingredients: ds.ingredients.map((i) => ({ ...i, note: null, packageDesc: null, supplier: null })),
    categories: ds.categories,
    products: ds.products.map((p) => ({ ...p, note: null })),
    recipeItems: ds.recipeItems.map((r) => ({ ...r, note: null })),
    salesLines: ds.salesLines.filter((l) => keep.has(l.month)).map((l) => ({ ...l, note: null })),
    // Su litresi online siparişleri de sayar: önizlemenin litre fiyatı Hammaddeler'dekiyle aynı kalsın. Elle girilmiş
    // su fiyatı varken water.month boştur; fiyat önizlemede silinince fatura ayı son satış ayı olur, onun online
    // satışı da gitsin (satış listesiyle aynı aylar)
    siteSales: (ds.siteSales ?? []).filter((r) => keep.has(r.month) || r.month === cover),
    months: ds.months.filter((m) => keep.has(m.month)),
    pnlEntries: ds.pnlEntries.filter((e) => e.rowKey === "manual:su").map((e) => ({ ...e, note: null })),
    // Şube seçiliyken su litresi işletme genelinin satışından (denetim 21 Kasım #4): su ayının (elle fiyat varken
    // faturası ve satışı olan son ayın) bütün şubelerdeki satışı da gider, önizlemenin litre fiyatı modelinkiyle aynı
    ...(ds.waterSales ? { waterSales: companyWaterSales(ds.waterSales, model.water.month) } : {}),
    staff: ds.staff,
    staffVersions: ds.staffVersions,
    fixedExpenses: ds.fixedExpenses,
    fixedExpenseVersions: ds.fixedExpenseVersions,
    currentMonth: cur,
    expenseCategories: ds.expenseCategories ?? [],
    expenseEntries: (ds.expenseEntries ?? []).filter((e) => e.date.slice(0, 7) >= from).map((e) => ({ ...e, description: null, note: null })),
    // Mal, komisyon ve kafe dışı faturalar harcamaya bağlanamaz (motor da saymaz); yalnız bağlı kategoriler
    invoices: ds.invoices
      .filter((i) => linked.has(i.category) && i.date.slice(0, 7) >= from)
      .map((i) => ({ id: i.id, date: i.date, supplier: i.supplier, description: null, invoiceNo: null, category: i.category, amount: i.amount, discount: i.discount, payable: i.payable, unpaid: i.unpaid, note: null })),
  };
}

export function impactModel(data: ImpactData, settings: Settings = data.settings): Model {
  return createModel({ ...data, settings, invoices: data.invoices ?? [], stockCounts: [], stockExtras: [], purchaseQuantities: [] });
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

import {
  COMMISSION_CATEGORY,
  FIXED_SECTIONS,
  GOODS_CATEGORIES,
  MANUAL_PNL_ROWS,
  PACKAGING_CATEGORY,
} from "../constants";
import { evaluateExpression } from "./expr";
import type {
  Category,
  Dataset,
  FixedExpense,
  FixedSection,
  Ingredient,
  Month,
  Product,
  RecipeItem,
  SalesLine,
  Settings,
  Staff,
} from "./types";

// ============================================================================
// Yardımcılar
// ============================================================================

export const productKey = (p: { name: string; size: string }) => `${p.name}|${p.size}`;

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const monthOfDate = (date: string) => date.slice(0, 7);

export function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** Excel'deki TAVAN(x; adım) — kayan nokta gürültüsüne karşı toleranslı */
export function ceilTo(x: number, step: number): number {
  if (!Number.isFinite(x) || step <= 0) return 0;
  const q = x / step;
  const r = Math.round(q);
  return (Math.abs(q - r) < 1e-9 ? r : Math.ceil(q)) * step;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const safeDiv = (a: number, b: number) => (b ? a / b : 0);

/** Tedarikçi adından parantez içindeki açıklamayı atar: "Kaldi (ödenmedi)" -> "Kaldi" */
export function normalizeSupplier(s: string): string {
  return s.replace(/\s*\(.*\)\s*$/, "").trim();
}

/** POS ürün adlarını eşleştirme için normalleştirir */
export function normalizePosName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

// ============================================================================
// Ürün ekonomisi (Reçete Kartı / Ürün Kârlılık)
// ============================================================================

export type ProductStatus = "İyi" | "Dikkat" | "Düşük kâr" | "Reçete yok";

export interface LineInput {
  qty: number;
  unitCost: number;
  vatRate: number;
  isPackaging: boolean;
}

export interface ProductEconomics {
  ingredientTotal: number;
  totalVatIncl: number;
  fireRate: number;
  fireOverridden: boolean;
  fireBase: number;
  fire: number;
  cost: number;
  price: number;
  net: number;
  commission: number;
  totalCost: number;
  unitProfit: number;
  margin: number;
  costRatio: number;
  suggestedPrice: number;
  status: ProductStatus;
}

export function statusFor(cost: number, costRatio: number, target: number): ProductStatus {
  if (cost === 0) return "Reçete yok";
  if (costRatio <= target) return "İyi";
  if (costRatio <= target + 0.1) return "Dikkat";
  return "Düşük kâr";
}

/**
 * Reçete Kartı formüllerinin birebir karşılığı:
 * TOPLAM = Σ miktar × birim maliyet
 * FİRE = TOPLAM × (ürün fire oranı | genel oran)
 * ÜRÜN MALİYETİ = TOPLAM + FİRE
 * NET = Fiyat ÷ (1 + KDV); KOMİSYON = Fiyat × Komisyon × Kartlı oran
 * KÂR = NET − MALİYET − KOMİSYON
 */
export function priceProduct(
  input: { price: number; fireOverride: number | null },
  lines: LineInput[],
  st: Settings,
): ProductEconomics {
  const totals = lines.map((l) => l.qty * l.unitCost);
  const ingredientTotal = sum(totals);
  const totalVatIncl = sum(lines.map((l, i) => totals[i] * (1 + l.vatRate)));
  const fireOverridden = input.fireOverride !== null && input.fireOverride !== undefined;
  const fireRate = fireOverridden ? (input.fireOverride as number) : st.fire;
  const fireBase = st.fireExcludesPackaging
    ? sum(lines.map((l, i) => (l.isPackaging ? 0 : totals[i])))
    : ingredientTotal;
  const fire = fireBase * fireRate;
  const cost = ingredientTotal + fire;
  const price = input.price;
  const net = price / (1 + st.kdv);
  const commission = price * st.komisyon * st.kartOrani;
  const totalCost = cost + commission;
  const unitProfit = net - cost - commission;
  const margin = safeDiv(unitProfit, net);
  const costRatio = safeDiv(cost, net);
  const suggestedPrice = ceilTo((cost / st.hedefMaliyet) * (1 + st.kdv), 5);
  return {
    ingredientTotal,
    totalVatIncl,
    fireRate,
    fireOverridden,
    fireBase,
    fire,
    cost,
    price,
    net,
    commission,
    totalCost,
    unitProfit,
    margin,
    costRatio,
    suggestedPrice,
    status: statusFor(cost, costRatio, st.hedefMaliyet),
  };
}

/** Hedef maliyet oranına ulaşmak için gereken KDV dahil fiyat (yuvarlanmamış) */
export function priceForMargin(cost: number, targetCostRatio: number, st: Settings): number {
  return safeDiv(cost, targetCostRatio) * (1 + st.kdv);
}

// ============================================================================
// Personel
// ============================================================================

export interface StaffCost {
  staff: Staff;
  gross: number;
  deductions: number;
  employerSgk: number;
  employerUnemployment: number;
  total: number;
}

export function staffCost(s: Staff, st: Settings): StaffCost {
  const gross = s.netSalary / (1 - st.isciSgk - st.isciIssizlik);
  const deductions = gross * (st.isciSgk + st.isciIssizlik);
  const employerSgk = gross * st.isverenSgk;
  const employerUnemployment = gross * st.isverenIssizlik;
  return {
    staff: s,
    gross,
    deductions,
    employerSgk,
    employerUnemployment,
    total: gross + employerSgk + employerUnemployment + s.extras,
  };
}

export function personnelSummary(staff: Staff[], st: Settings) {
  const rows = staff.filter((s) => s.active).map((s) => staffCost(s, st));
  return {
    rows,
    net: sum(rows.map((r) => r.staff.netSalary)),
    gross: sum(rows.map((r) => r.gross)),
    deductions: sum(rows.map((r) => r.deductions)),
    employerSgk: sum(rows.map((r) => r.employerSgk)),
    employerUnemployment: sum(rows.map((r) => r.employerUnemployment)),
    extras: sum(rows.map((r) => r.staff.extras)),
    total: sum(rows.map((r) => r.total)),
  };
}

// ============================================================================
// Sabit giderler
// ============================================================================

/** Standart bir ay için aylık karşılık (Sabit Giderler sayfası) */
export function fixedMonthly(fe: FixedExpense, st: Settings): number {
  switch (fe.period) {
    case "gunluk":
      return fe.amount * st.acikGun;
    case "haftalik":
      return (fe.amount * 52) / 12;
    case "yillik":
      return fe.amount / 12;
    default:
      return fe.amount;
  }
}

/** Belirli bir ay için tutar: açık gün ÷ ayın gün sayısı oranıyla (Genel Maliyet sayfası) */
export function fixedForMonth(fe: FixedExpense, st: Settings, openDays: number, dim: number): number {
  if (fe.period === "gunluk") return fe.amount * openDays;
  return (fixedMonthly(fe, st) * openDays) / dim;
}

// ============================================================================
// Model
// ============================================================================

export interface RecipeLineCalc {
  item: RecipeItem;
  ingredient: Ingredient | undefined;
  qty: number;
  qtyError: string | null;
  unitCost: number;
  vatRate: number;
  total: number;
  totalVatIncl: number;
  isPackaging: boolean;
}

export interface ProductCalc extends ProductEconomics {
  product: Product;
  category: Category | undefined;
  key: string;
  lines: RecipeLineCalc[];
}

export interface SalesLineCalc {
  line: SalesLine;
  product: ProductCalc | undefined;
  matched: boolean;
  unitCost: number | null;
  net: number;
  cost: number;
  commission: number;
  grossProfit: number;
  margin: number;
}

export interface MonthSales {
  month: string;
  info: Month | undefined;
  lines: SalesLineCalc[];
  qty: number;
  revenue: number;
  net: number;
  cost: number;
  commission: number;
  grossProfit: number;
  margin: number;
  matchedNet: number;
  matchedCost: number;
  avgCostRatio: number;
  unmatched: SalesLineCalc[];
  services: SalesLineCalc[];
  soldByProduct: Map<number, number>;
}

export type PnlRowKind = "auto" | "manual" | "total" | "ratio" | "info";

export interface PnlCell {
  value: number | null;
  computed: number | null;
  overridden: boolean;
}

export interface PnlRowDef {
  key: string;
  label: string;
  section: string;
  kind: PnlRowKind;
  /** Kullanıcı bu hücreyi değiştirebilir mi? (auto satırlar üzerine yazılabilir) */
  editable: boolean;
  hint?: string;
  /** Formatlama: para mı oran mı gün mü */
  format?: "money" | "percent" | "days";
  strong?: boolean;
}

export interface PnlMonthCalc {
  month: string;
  info: Month | undefined;
  openDays: number;
  dim: number;
  ratio: number;
  cells: Map<string, PnlCell>;
  purchases: number;
  opening: number;
  closing: number;
  cogs: number;
  sections: Record<FixedSection | "komisyon", number>;
  expenses: number;
  revenue: number | null;
  revenueNet: number | null;
  profit: number;
}

export interface StockLine {
  ingredient: Ingredient;
  qty: number | null;
  factor: number;
  unitPrice: number;
  amount: number;
  amountVatIncl: number;
}

export interface StockSheet {
  month: string;
  groups: { name: string; lines: StockLine[]; total: number; totalVatIncl: number }[];
  extras: { id: number; name: string; unit: string; qty: number; unitPrice: number; amount: number }[];
  extrasTotal: number;
  total: number;
  totalVatIncl: number;
  hasData: boolean;
}

export type Model = ReturnType<typeof createModel>;

export function countFactor(countUnit: string | null): number {
  return countUnit === "KG" || countUnit === "LT" ? 1000 : 1;
}

export function createModel(ds: Dataset) {
  const st = ds.settings;
  const ingById = new Map(ds.ingredients.map((i) => [i.id, i]));
  const catById = new Map(ds.categories.map((c) => [c.id, c]));
  const productById = new Map(ds.products.map((p) => [p.id, p]));
  const itemsByProduct = new Map<number, RecipeItem[]>();
  for (const it of [...ds.recipeItems].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
    const list = itemsByProduct.get(it.productId) ?? [];
    list.push(it);
    itemsByProduct.set(it.productId, list);
  }
  const monthInfo = new Map(ds.months.map((m) => [m.month, m]));
  const pnlByMonth = new Map<string, Map<string, number>>();
  for (const e of ds.pnlEntries) {
    const m = pnlByMonth.get(e.month) ?? new Map<string, number>();
    m.set(e.rowKey, e.amount);
    pnlByMonth.set(e.month, m);
  }
  const linesByMonth = new Map<string, SalesLine[]>();
  for (const l of ds.salesLines) {
    const list = linesByMonth.get(l.month) ?? [];
    list.push(l);
    linesByMonth.set(l.month, list);
  }

  // --- Reçete miktarları (maliyetten bağımsız) -------------------------------
  const qtyCache = new Map<number, { qty: number; error: string | null }>();
  function evalQty(it: RecipeItem) {
    let r = qtyCache.get(it.id);
    if (!r) {
      if (it.qtyExpr) {
        try {
          r = { qty: evaluateExpression(it.qtyExpr, st), error: null };
        } catch (e) {
          r = { qty: it.qty ?? 0, error: e instanceof Error ? e.message : "Formül hatası" };
        }
      } else {
        r = { qty: it.qty ?? 0, error: null };
      }
      qtyCache.set(it.id, r);
    }
    return r;
  }

  // --- Satış adetleri -----------------------------------------------------------
  const soldCache = new Map<string, Map<number, number>>();
  function soldByProduct(month: string): Map<number, number> {
    let m = soldCache.get(month);
    if (!m) {
      m = new Map();
      for (const l of linesByMonth.get(month) ?? []) {
        if (l.productId && productById.has(l.productId)) {
          m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
        }
      }
      soldCache.set(month, m);
    }
    return m;
  }

  /** Reçeteye göre bir ayda harcanan malzeme (fire hariç), malzemenin kendi biriminde */
  const usageCache = new Map<string, Map<number, number>>();
  function ingredientUsage(month: string): Map<number, number> {
    let u = usageCache.get(month);
    if (!u) {
      u = new Map();
      for (const [pid, sold] of soldByProduct(month)) {
        for (const it of itemsByProduct.get(pid) ?? []) {
          u.set(it.ingredientId, (u.get(it.ingredientId) ?? 0) + evalQty(it).qty * sold);
        }
      }
      usageCache.set(month, u);
    }
    return u;
  }

  // --- Su + buz birim maliyeti (Ayarlar!B17) -----------------------------------
  const waterIngredients = ds.ingredients.filter((i) => i.priceSource === "water");
  function computeWater(): { perLiter: number; month: string | null; bill: number; liters: number } {
    if (st.suBirimLTOverride !== null && st.suBirimLTOverride !== undefined) {
      return { perLiter: st.suBirimLTOverride, month: null, bill: 0, liters: 0 };
    }
    const candidates = [...pnlByMonth.entries()]
      .filter(([, rows]) => (rows.get("manual:su") ?? 0) > 0)
      .map(([m]) => m)
      .sort()
      .reverse();
    for (const m of candidates) {
      const usage = ingredientUsage(m);
      const liters = sum(waterIngredients.map((i) => usage.get(i.id) ?? 0)) / 1000;
      if (liters > 0) {
        const bill = pnlByMonth.get(m)!.get("manual:su")!;
        return { perLiter: bill / liters, month: m, bill, liters };
      }
    }
    return { perLiter: 0, month: null, bill: 0, liters: 0 };
  }
  const water = computeWater();

  // --- Hammadde birim maliyeti --------------------------------------------------
  function unitCostOf(ing: Ingredient | undefined): number {
    if (!ing) return 0;
    if (ing.priceSource === "water") return water.perLiter / 1000;
    return ing.packageSize ? ing.packagePrice / ing.packageSize : 0;
  }
  const unitCost = new Map(ds.ingredients.map((i) => [i.id, unitCostOf(i)]));

  // --- Ürünler -----------------------------------------------------------------
  const productCache = new Map<number, ProductCalc>();
  function computeProduct(p: Product): ProductCalc {
    let pc = productCache.get(p.id);
    if (pc) return pc;
    const lines: RecipeLineCalc[] = (itemsByProduct.get(p.id) ?? []).map((item) => {
      const ingredient = ingById.get(item.ingredientId);
      const { qty, error } = evalQty(item);
      const uc = unitCost.get(item.ingredientId) ?? 0;
      const vatRate = ingredient?.vatRate ?? 0;
      return {
        item,
        ingredient,
        qty,
        qtyError: error,
        unitCost: uc,
        vatRate,
        total: qty * uc,
        totalVatIncl: qty * uc * (1 + vatRate),
        isPackaging: ingredient?.category === PACKAGING_CATEGORY,
      };
    });
    const econ = priceProduct(p, lines, st);
    pc = { ...econ, product: p, category: catById.get(p.categoryId), key: productKey(p), lines };
    productCache.set(p.id, pc);
    return pc;
  }

  const sortedCategories = [...ds.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const catOrder = new Map(sortedCategories.map((c, i) => [c.id, i]));
  const products: ProductCalc[] = [...ds.products]
    .sort(
      (a, b) =>
        (catOrder.get(a.categoryId) ?? 99) - (catOrder.get(b.categoryId) ?? 99) ||
        a.sortOrder - b.sortOrder ||
        a.id - b.id,
    )
    .map(computeProduct);
  const activeProducts = products.filter((p) => p.product.active);

  /** Her hammaddenin kaç ürün kartında kullanıldığı */
  const usedIn = new Map<number, number[]>();
  for (const it of ds.recipeItems) {
    const list = usedIn.get(it.ingredientId) ?? [];
    if (!list.includes(it.productId)) list.push(it.productId);
    usedIn.set(it.ingredientId, list);
  }

  // --- Aylık satış analizi (Satış Raporu) ------------------------------------
  const salesCache = new Map<string, MonthSales>();
  function monthSales(month: string): MonthSales {
    let ms = salesCache.get(month);
    if (ms) return ms;
    const raw = linesByMonth.get(month) ?? [];
    const base = raw.map((line) => {
      const product = line.productId ? productById.get(line.productId) : undefined;
      const pc = product ? computeProduct(product) : undefined;
      const net = line.revenue / (1 + st.kdv);
      const commission = line.revenue * st.komisyon * st.kartOrani;
      return { line, pc, net, commission };
    });
    const matched = base.filter((b) => b.pc && !b.line.isService);
    const matchedNet = sum(matched.map((b) => b.net));
    const matchedCost = sum(matched.map((b) => b.line.qty * b.pc!.cost));
    const avgCostRatio = safeDiv(matchedCost, matchedNet);
    const lines: SalesLineCalc[] = base.map(({ line, pc, net, commission }) => {
      const isMatched = !!pc && !line.isService;
      const cost = line.isService ? 0 : isMatched ? line.qty * pc!.cost : net * avgCostRatio;
      const grossProfit = net - cost - commission;
      return {
        line,
        product: pc,
        matched: isMatched,
        unitCost: isMatched ? pc!.cost : null,
        net,
        cost,
        commission,
        grossProfit,
        margin: safeDiv(grossProfit, net),
      };
    });
    const revenue = sum(lines.map((l) => l.line.revenue));
    const net = sum(lines.map((l) => l.net));
    const grossProfit = sum(lines.map((l) => l.grossProfit));
    ms = {
      month,
      info: monthInfo.get(month),
      lines,
      qty: sum(lines.map((l) => l.line.qty)),
      revenue,
      net,
      cost: sum(lines.map((l) => l.cost)),
      commission: sum(lines.map((l) => l.commission)),
      grossProfit,
      margin: safeDiv(grossProfit, net),
      matchedNet,
      matchedCost,
      avgCostRatio,
      unmatched: lines.filter((l) => !l.matched && !l.line.isService),
      services: lines.filter((l) => l.line.isService),
      soldByProduct: soldByProduct(month),
    };
    salesCache.set(month, ms);
    return ms;
  }

  const salesMonths = [...linesByMonth.keys()].sort();

  // --- Personel ve sabit giderler ------------------------------------------------
  const personnel = personnelSummary(ds.staff, st);
  const activeFixed = ds.fixedExpenses.filter((f) => f.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const fixedStandardTotal = personnel.total + sum(activeFixed.map((f) => fixedMonthly(f, st)));

  // --- Stok sayımı -------------------------------------------------------------
  const countsByMonth = new Map<string, Map<number, number>>();
  for (const c of ds.stockCounts) {
    const m = countsByMonth.get(c.month) ?? new Map<number, number>();
    m.set(c.ingredientId, c.qty);
    countsByMonth.set(c.month, m);
  }
  const extrasByMonth = new Map<string, typeof ds.stockExtras>();
  for (const e of ds.stockExtras) {
    const list = extrasByMonth.get(e.month) ?? [];
    list.push(e);
    extrasByMonth.set(e.month, list);
  }
  const countable = ds.ingredients
    .filter((i) => i.countUnit && i.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const stockCache = new Map<string, StockSheet>();
  function stockSheet(month: string): StockSheet {
    let s = stockCache.get(month);
    if (s) return s;
    const counts = countsByMonth.get(month) ?? new Map<number, number>();
    const groupMap = new Map<string, StockLine[]>();
    for (const ing of countable) {
      const factor = countFactor(ing.countUnit);
      const unitPrice = (unitCost.get(ing.id) ?? 0) * factor;
      const qty = counts.has(ing.id) ? counts.get(ing.id)! : null;
      const amount = (qty ?? 0) * unitPrice;
      const g = ing.countGroup ?? "DİĞER";
      const list = groupMap.get(g) ?? [];
      list.push({ ingredient: ing, qty, factor, unitPrice, amount, amountVatIncl: amount * (1 + ing.vatRate) });
      groupMap.set(g, list);
    }
    const groups = [...groupMap.entries()].map(([name, lines]) => ({
      name,
      lines,
      total: sum(lines.map((l) => l.amount)),
      totalVatIncl: sum(lines.map((l) => l.amountVatIncl)),
    }));
    const extras = (extrasByMonth.get(month) ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      unit: e.unit,
      qty: e.qty,
      unitPrice: e.unitPrice,
      amount: e.qty * e.unitPrice,
    }));
    const extrasTotal = sum(extras.map((e) => e.amount));
    s = {
      month,
      groups,
      extras,
      extrasTotal,
      total: sum(groups.map((g) => g.total)) + extrasTotal,
      totalVatIncl: sum(groups.map((g) => g.totalVatIncl)) + extrasTotal * 1.01,
      hasData: counts.size > 0 || extras.length > 0,
    };
    stockCache.set(month, s);
    return s;
  }

  // --- Faturalar -----------------------------------------------------------------
  const invoiceNet = (i: { amount: number; discount: number }) => i.amount - i.discount;
  const invoicesByMonth = new Map<string, typeof ds.invoices>();
  for (const inv of ds.invoices) {
    const m = monthOfDate(inv.date);
    const list = invoicesByMonth.get(m) ?? [];
    list.push(inv);
    invoicesByMonth.set(m, list);
  }
  function goodsPurchases(month: string): number {
    return sum(
      (invoicesByMonth.get(month) ?? [])
        .filter((i) => GOODS_CATEGORIES.includes(i.category))
        .map(invoiceNet),
    );
  }

  // --- Genel Maliyet (aylık gelir-gider) --------------------------------------
  function closingStock(month: string): { value: number; computed: number; overridden: boolean } {
    const computed = stockSheet(month).total;
    const ov = pnlByMonth.get(month)?.get("stock:closing");
    return ov !== undefined ? { value: ov, computed, overridden: true } : { value: computed, computed, overridden: false };
  }

  const pnlCache = new Map<string, PnlMonthCalc>();
  function pnlMonth(month: string): PnlMonthCalc {
    let pm = pnlCache.get(month);
    if (pm) return pm;
    const info = monthInfo.get(month);
    const overrides = pnlByMonth.get(month) ?? new Map<string, number>();
    const dim = daysInMonth(month);
    const openDays = info?.openDays ?? 0;
    const ratio = openDays / dim;
    const cells = new Map<string, PnlCell>();
    const auto = (key: string, computed: number) => {
      const ov = overrides.get(key);
      const cell = ov !== undefined ? { value: ov, computed, overridden: true } : { value: computed, computed, overridden: false };
      cells.set(key, cell);
      return cell.value as number;
    };
    const manual = (key: string) => {
      const v = overrides.get(key) ?? 0;
      cells.set(key, { value: overrides.has(key) ? v : null, computed: null, overridden: overrides.has(key) });
      return v;
    };

    // Mal alışları (fatura → tedarikçi)
    const invs = invoicesByMonth.get(month) ?? [];
    const bySupplier = new Map<string, number>();
    for (const inv of invs.filter((i) => GOODS_CATEGORIES.includes(i.category))) {
      const s = normalizeSupplier(inv.supplier);
      bySupplier.set(s, (bySupplier.get(s) ?? 0) + invoiceNet(inv));
    }
    let purchases = 0;
    for (const [s, v] of bySupplier) {
      cells.set(`purchase:${s}`, { value: v, computed: v, overridden: false });
      purchases += v;
    }
    purchases += manual("manual:diger_mal");

    // Devirler
    const prevClosing = closingStock(shiftMonth(month, -1)).value;
    const opening = auto("stock:opening", prevClosing);
    cells.set("stock:purchased", { value: purchases, computed: purchases, overridden: false });
    const cl = closingStock(month);
    cells.set("stock:closing", { value: cl.value, computed: cl.computed, overridden: cl.overridden });
    const closing = cl.value;
    const cogs = opening + purchases - closing;

    // Personel, faturalar, kira, genel
    const sections: Record<FixedSection | "komisyon", number> = { personel: 0, faturalar: 0, kira: 0, genel: 0, komisyon: 0 };
    sections.personel += auto("personnel:net", personnel.net * ratio);
    sections.personel += auto("personnel:employer", (personnel.total - personnel.net) * ratio);
    for (const fe of activeFixed) {
      sections[fe.section] += auto(`fixed:${fe.id}`, fixedForMonth(fe, st, openDays, dim));
    }
    for (const row of MANUAL_PNL_ROWS) {
      if (row.section === "mal") continue;
      sections[row.section] += manual(row.key);
    }

    // Komisyonlar
    const revenue = info?.posRevenue ?? null;
    sections.komisyon += auto("commission:pos", (revenue ?? 0) * st.komisyon * st.kartOrani);
    const commBySupplier = new Map<string, number>();
    for (const inv of invs.filter((i) => i.category === COMMISSION_CATEGORY)) {
      const s = normalizeSupplier(inv.supplier);
      commBySupplier.set(s, (commBySupplier.get(s) ?? 0) + invoiceNet(inv));
    }
    for (const [s, v] of commBySupplier) {
      cells.set(`commission:${s}`, { value: v, computed: v, overridden: false });
      sections.komisyon += v;
    }

    const expenses = cogs + sections.personel + sections.faturalar + sections.kira + sections.genel + sections.komisyon;
    const revenueNet = revenue === null ? null : revenue / (1 + st.kdv);
    pm = {
      month,
      info,
      openDays,
      dim,
      ratio,
      cells,
      purchases,
      opening,
      closing,
      cogs,
      sections,
      expenses,
      revenue,
      revenueNet,
      profit: (revenueNet ?? 0) - expenses,
    };
    pnlCache.set(month, pm);
    return pm;
  }

  /** Genel Maliyet yıllık tablo satır tanımları (aylardan bağımsız sabit sıra) */
  function pnlRowDefs(months: string[]): PnlRowDef[] {
    const monthsCalc = months.map(pnlMonth);
    const supplierTotals = new Map<string, number>();
    const commSuppliers = new Set<string>();
    for (const pm of monthsCalc) {
      for (const [k, c] of pm.cells) {
        if (k.startsWith("purchase:")) supplierTotals.set(k, (supplierTotals.get(k) ?? 0) + (c.value ?? 0));
        if (k.startsWith("commission:") && k !== "commission:pos") commSuppliers.add(k);
      }
    }
    const rows: PnlRowDef[] = [];
    const sec = (section: string) => (r: Omit<PnlRowDef, "section">) => rows.push({ ...r, section });

    const mal = sec("mal");
    for (const [k] of [...supplierTotals.entries()].sort((a, b) => b[1] - a[1])) {
      mal({ key: k, label: k.slice("purchase:".length).toLocaleUpperCase("tr-TR"), kind: "auto", editable: false, hint: "Faturalar sayfasından otomatik (KDV hariç, iskonto düşülmüş)." });
    }
    for (const r of MANUAL_PNL_ROWS.filter((r) => r.section === "mal")) mal({ key: r.key, label: r.label, kind: "manual", editable: true, hint: r.hint });
    mal({ key: "total:mal", label: "AYLIK MAL ALIMI TOPLAMI", kind: "total", editable: false, strong: true });

    const devir = sec("devir");
    devir({ key: "stock:opening", label: "ÖNCEKİ AYDAN DEVİR", kind: "auto", editable: true, hint: "Bir önceki ayın sayım değeri (sonraki aya devreden mal)." });
    devir({ key: "stock:purchased", label: "AY İÇİNDE ALINAN", kind: "auto", editable: false });
    devir({ key: "stock:closing", label: "SONRAKİ AYA DEVREDEN MAL (ay sonu stok)", kind: "auto", editable: true, hint: "Stok Sayımı sayfasındaki o ayın toplamı (KDV hariç). Sayım girilmezse 0 olur ve alınan malın tamamı o ayın maliyeti sayılır." });
    devir({ key: "total:cogs", label: "CİRO İÇİN KULLANILAN MALIN MALİYETİ", kind: "total", editable: false, strong: true, hint: "Devir + Alınan − Devreden" });

    const sectionLabels: Record<FixedSection, string> = {
      personel: "PERSONEL GİDERLERİ TOPLAMI",
      faturalar: "FATURA GİDERLERİ TOPLAMI",
      kira: "KİRA GİDERLERİ TOPLAMI",
      genel: "İŞLETME GENEL GİDERLERİ TOPLAMI",
    };
    for (const { key } of FIXED_SECTIONS) {
      const add = sec(key);
      if (key === "personel") {
        add({ key: "personnel:net", label: "PERSONEL MAAŞ (net)", kind: "auto", editable: true, hint: "Personel sayfasındaki net maaşlar × (açık gün ÷ ayın gün sayısı)." });
        add({ key: "personnel:employer", label: "PERSONEL SGK + İŞSİZLİK (işveren)", kind: "auto", editable: true, hint: "Personel sayfasındaki tahmini işveren maliyeti − net maaş. Bordrodaki gerçek tutarı yazabilirsiniz." });
      }
      for (const fe of activeFixed.filter((f) => f.section === key)) {
        add({ key: `fixed:${fe.id}`, label: fe.name.toLocaleUpperCase("tr-TR"), kind: "auto", editable: true, hint: fe.note ?? undefined });
      }
      for (const r of MANUAL_PNL_ROWS.filter((r) => r.section === key)) add({ key: r.key, label: r.label, kind: "manual", editable: true, hint: r.hint });
      add({ key: `total:${key}`, label: sectionLabels[key], kind: "total", editable: false, strong: true });
    }

    const kom = sec("komisyon");
    kom({ key: "commission:pos", label: `BANKA POS KOMİSYONU (%${(st.komisyon * 100).toLocaleString("tr-TR")})`, kind: "auto", editable: true, hint: "Aylık ciro (KDV dahil) × komisyon × kartlı satış oranı. Banka ekstresindeki gerçek tutarı yazabilirsiniz." });
    for (const k of [...commSuppliers].sort()) {
      kom({ key: k, label: `${k.slice("commission:".length).toLocaleUpperCase("tr-TR")} KOMİSYONU`, kind: "auto", editable: false, hint: "Faturalar sayfasından otomatik (Komisyon kategorisi)." });
    }
    kom({ key: "total:komisyon", label: "KOMİSYON GİDERLERİ TOPLAMI", kind: "total", editable: false, strong: true });

    const top = sec("toplam");
    top({ key: "total:cogs", label: "AY İÇERİSİNDE SATILAN MAL MALİYETİ", kind: "total", editable: false });
    for (const { key, label } of FIXED_SECTIONS) top({ key: `total:${key}`, label: label.toLocaleUpperCase("tr-TR"), kind: "total", editable: false });
    top({ key: "total:komisyon", label: "KOMİSYON GİDERLERİ", kind: "total", editable: false });
    top({ key: "total:expenses", label: "GİDERLER GENEL TOPLAMI", kind: "total", editable: false, strong: true });

    const sonuc = sec("sonuc");
    sonuc({ key: "revenue", label: "AYLIK CİRO (KDV dahil – POS)", kind: "manual", editable: true, hint: "Patron > Raporlar > Ciro (indirimler düşülmüş, ödenmezler hariç). Satışlar sayfasındaki ay bilgisiyle aynıdır." });
    sonuc({ key: "revenueNet", label: "AYLIK CİRO (KDV hariç)", kind: "total", editable: false });
    sonuc({ key: "total:expenses", label: "MAL MALİYETİ VE GİDER TOPLAMLARI", kind: "total", editable: false });
    sonuc({ key: "profit", label: "KÂR / ZARAR", kind: "total", editable: false, strong: true });
    sonuc({ key: "ratio:expenses", label: "MALİYET ORANI (tüm giderler ÷ ciro)", kind: "ratio", editable: false, format: "percent" });

    const oran = sec("oran");
    oran({ key: "ratio:cogs", label: "MAL MALİYETİ", kind: "ratio", editable: false, format: "percent" });
    for (const { key, label } of FIXED_SECTIONS) oran({ key: `ratio:${key}`, label: label.toLocaleUpperCase("tr-TR"), kind: "ratio", editable: false, format: "percent" });
    oran({ key: "ratio:komisyon", label: "KOMİSYON GİDERLERİ", kind: "ratio", editable: false, format: "percent" });
    oran({ key: "ratio:profit", label: "KÂR", kind: "ratio", editable: false, format: "percent", strong: true });
    return rows;
  }

  /** Bir satırın belirli aydaki değeri (tablo için) */
  function pnlValue(pm: PnlMonthCalc, key: string): PnlCell {
    const c = pm.cells.get(key);
    if (c) return c;
    const v = (value: number | null): PnlCell => ({ value, computed: value, overridden: false });
    const rn = pm.revenueNet;
    const r = (x: number) => (rn ? x / rn : null);
    switch (key) {
      case "total:mal":
        return v(pm.purchases);
      case "total:cogs":
        return v(pm.cogs);
      case "total:personel":
      case "total:faturalar":
      case "total:kira":
      case "total:genel":
      case "total:komisyon":
        return v(pm.sections[key.slice(6) as FixedSection | "komisyon"]);
      case "total:expenses":
        return v(pm.expenses);
      case "revenue":
        return { value: pm.revenue, computed: null, overridden: pm.revenue !== null };
      case "revenueNet":
        return v(rn);
      case "profit":
        return v(pm.profit);
      case "ratio:expenses":
        return v(r(pm.expenses));
      case "ratio:cogs":
        return v(r(pm.cogs));
      case "ratio:personel":
      case "ratio:faturalar":
      case "ratio:kira":
      case "ratio:genel":
      case "ratio:komisyon":
        return v(r(pm.sections[key.slice(6) as FixedSection | "komisyon"]));
      case "ratio:profit":
        return v(r(pm.profit));
      default:
        return v(null);
    }
  }

  return {
    settings: st,
    ds,
    water,
    unitCost,
    ingById,
    catById,
    productById,
    itemsByProduct,
    categories: sortedCategories,
    products,
    activeProducts,
    computeProduct,
    evalQty,
    usedIn,
    monthInfo,
    salesMonths,
    monthSales,
    soldByProduct,
    ingredientUsage,
    personnel,
    activeFixed,
    fixedStandardTotal,
    stockSheet,
    closingStock,
    invoicesByMonth,
    goodsPurchases,
    pnlMonth,
    pnlRowDefs,
    pnlValue,
  };
}

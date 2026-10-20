import {
  COMMISSION_CATEGORY,
  FIXED_SECTIONS,
  GOODS_CATEGORIES,
  MANUAL_PNL_ROWS,
  PACKAGING_CATEGORY,
  SEPARATE_CATEGORIES,
} from "../constants";
import { evaluateExpression } from "./expr";
import type {
  Category,
  CountUnit,
  Dataset,
  ExpenseCategory,
  FixedExpense,
  FixedExpenseVersion,
  FixedPeriod,
  FixedSection,
  Ingredient,
  Month,
  MonthRange,
  Product,
  RecipeItem,
  SalesLine,
  Settings,
  Staff,
  StaffVersion,
  Unit,
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

/** Türkiye saatine göre bu ay, "YYYY-MM" (sunucu UTC'de çalışsa da ay başında doğru ay döner) */
export function currentMonthTR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .slice(0, 7);
}

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

/**
 * Eski eşleştirme anahtarı (tr büyük harf, tek boşluk). Yalnızca eski kayıtlarla uyumluluk için duruyor: satış ekranları
 * ve eylemleri posMatchKey / createPosMappingIndex kullanır (src/lib/calc/pos-paste.ts), o da bu anahtarı tanır.
 */
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
    // Reçeteli ürünün fiyatı 0 (fiyatı sonra girilecek, editörde boş alan): oran 0 ("İyi") değil, zararına satış.
    // Excel'de #SAYI/0! olurdu; golden veride fiyatı 0 ürün yok, sonuç aynı
    status: cost > 0 && !(net > 0) ? "Düşük kâr" : statusFor(cost, costRatio, st.hedefMaliyet),
  };
}

/** Hedef maliyet oranına ulaşmak için gereken KDV dahil fiyat (yuvarlanmamış) */
export function priceForMargin(cost: number, targetCostRatio: number, st: Settings): number {
  return safeDiv(cost, targetCostRatio) * (1 + st.kdv);
}

// ============================================================================
// Geçerlilik aralığı ve "şu aydan itibaren" sürümler (personel, sabit giderler)
// ============================================================================
//
// Excel'de Genel Maliyet'in her ay sütunu kendi sabit tutarını taşır (J40 =(160000)*J$2/31); kira
// değişince geçmiş aylar değişmez. Panelde aynı sonucu iki şey verir:
//  - startMonth / endMonth: kalem yalnızca bu aralıktaki aylarda hesaba girer (null = sınırsız)
//  - sürümler: tutar "X ayından itibaren" değişir; ilk sürümden önceki aylarda taban değer geçerlidir.

/** Kalem bu ayda hesaba giriyor mu? Aralık hiç verilmemişse (eski biçim veri) `active` bakılır. */
export function inRange(item: MonthRange & { active?: boolean }, month: string): boolean {
  if (item.startMonth === undefined && item.endMonth === undefined) return item.active !== false;
  return (!item.startMonth || item.startMonth <= month) && (!item.endMonth || item.endMonth >= month);
}

/** Veritabanındaki active sütununun karşılığı: bitiş ayı yok ya da bu aydan sonra */
export function activeFromRange(endMonth: string | null | undefined, currentMonth: string): boolean {
  return !endMonth || endMonth >= currentMonth;
}

/** Sürümleri kaleme göre gruplar, her grubu fromMonth'a göre sıralar */
function groupVersions<V extends { fromMonth: string }>(versions: V[] | undefined, keyOf: (v: V) => number): Map<number, V[]> {
  const out = new Map<number, V[]>();
  for (const v of versions ?? []) {
    const list = out.get(keyOf(v)) ?? [];
    list.push(v);
    out.set(keyOf(v), list);
  }
  for (const list of out.values()) list.sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  return out;
}

/** Ayda geçerli sürüm: fromMonth ≤ ay olan en son sürüm (yoksa undefined = taban değer) */
function versionAt<V extends { fromMonth: string }>(versions: V[] | undefined, month: string): V | undefined {
  let found: V | undefined;
  for (const v of versions ?? []) {
    if (v.fromMonth <= month && (!found || v.fromMonth >= found.fromMonth)) found = v;
  }
  return found;
}

/** Sabit giderin o aydaki dönemi ve tutarı (sürüm varsa sürümden, yoksa tabandan) */
export function fixedAt(fe: FixedExpense, versions: FixedExpenseVersion[] | undefined, month: string): FixedExpense {
  const v = versionAt(versions?.filter((x) => x.fixedExpenseId === fe.id), month);
  return v ? { ...fe, period: v.period, amount: v.amount } : fe;
}

/** Personelin o aydaki net maaşı ve ek ödemeleri (sürüm varsa sürümden, yoksa tabandan) */
export function staffAt(s: Staff, versions: StaffVersion[] | undefined, month: string): Staff {
  const v = versionAt(versions?.filter((x) => x.staffId === s.id), month);
  return v ? { ...s, netSalary: v.netSalary, extras: v.extras } : s;
}

/** Tutar geçmişi, eskiden yeniye. İlk satır tabandır (fromMonth = kalemin başlangıç ayı ya da null = baştan beri). */
export interface FixedHistoryEntry {
  fromMonth: string | null;
  /** Silinebilir sürüm kimliği (taban satırında null) */
  versionId: number | null;
  period: FixedPeriod;
  amount: number;
}

export interface StaffHistoryEntry {
  fromMonth: string | null;
  versionId: number | null;
  netSalary: number;
  extras: number;
}

export function fixedHistory(fe: FixedExpense, versions: FixedExpenseVersion[] | undefined): FixedHistoryEntry[] {
  const own = (versions ?? []).filter((v) => v.fixedExpenseId === fe.id).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  return [
    { fromMonth: fe.startMonth ?? null, versionId: null, period: fe.period, amount: fe.amount },
    ...own.map((v) => ({ fromMonth: v.fromMonth, versionId: v.id, period: v.period, amount: v.amount })),
  ];
}

export function staffHistory(s: Staff, versions: StaffVersion[] | undefined): StaffHistoryEntry[] {
  const own = (versions ?? []).filter((v) => v.staffId === s.id).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  return [
    { fromMonth: s.startMonth ?? null, versionId: null, netSalary: s.netSalary, extras: s.extras },
    ...own.map((v) => ({ fromMonth: v.fromMonth, versionId: v.id, netSalary: v.netSalary, extras: v.extras })),
  ];
}

/**
 * Bir tutar değişikliğinin nasıl kaydedileceği (sunucu eylemleri kullanır; saf olduğu için test edilir).
 * - effectiveFrom "all": taban yeniden yazılır, bütün sürümler silinir (yanlış girilmiş tutarı düzeltmek)
 * - effectiveFrom ayı: o aydaki geçerli değer zaten aynıysa hiçbir şey; o aydan önce kalemin geçerli olduğu
 *   verili bir ay yoksa (ve öncesinde sürüm yoksa) taban değişir; aksi halde o aya sürüm yazılır. Yeni değer
 *   bir önceki ayın değerine eşitse o aydaki sürüm gereksizdir ve silinir.
 */
export type VersionPlan =
  | { action: "none" }
  | { action: "base"; clearVersions: boolean }
  | { action: "upsert"; fromMonth: string }
  | { action: "delete"; fromMonth: string };

export function planVersionChange<T>(opts: {
  base: T;
  versions: (T & { fromMonth: string })[];
  next: T;
  effectiveFrom: string;
  startMonth: string | null;
  /** Hesabı olan ilk ay (bundan önceki aylar boş sayılır) */
  firstDataMonth: string | null;
  equal: (a: T, b: T) => boolean;
}): VersionPlan {
  const { base, versions, next, effectiveFrom: from, startMonth, firstDataMonth, equal } = opts;
  if (from === "all") {
    return equal(base, next) && !versions.length ? { action: "none" } : { action: "base", clearVersions: versions.length > 0 };
  }
  const at = versionAt(versions, from) ?? base;
  if (equal(at, next)) return { action: "none" };
  const earliest = startMonth && firstDataMonth ? (startMonth > firstDataMonth ? startMonth : firstDataMonth) : (startMonth ?? firstDataMonth);
  if (!versions.some((v) => v.fromMonth <= from) && (!earliest || from <= earliest)) return { action: "base", clearVersions: false };
  const prev = versionAt(
    versions.filter((v) => v.fromMonth < from),
    from,
  ) ?? base;
  return equal(prev, next) ? { action: "delete", fromMonth: from } : { action: "upsert", fromMonth: from };
}

/** Listelerde gösterilecek ay: bu ay; kalem bitmişse son ayı, henüz başlamadıysa ilk ayı */
export function valueMonthFor(item: MonthRange, currentMonth: string): string {
  if (item.endMonth && item.endMonth < currentMonth) return item.endMonth;
  if (item.startMonth && item.startMonth > currentMonth) return item.startMonth;
  return currentMonth;
}

/** Kalemin bu aya göre durumu */
export type RangeStatus = "active" | "ended" | "upcoming";
export function rangeStatus(item: MonthRange & { active?: boolean }, currentMonth: string): RangeStatus {
  if (item.startMonth === undefined && item.endMonth === undefined) return item.active === false ? "ended" : "active";
  if (item.endMonth && item.endMonth < currentMonth) return "ended";
  if (item.startMonth && item.startMonth > currentMonth) return "upcoming";
  return "active";
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

export type PersonnelSummary = ReturnType<typeof personnelSummary>;

/**
 * Personel toplamları. `month` verilirse o ayda aralığı tutan personel o ayın maaşıyla (sürümler) sayılır;
 * verilmezse (eski kullanım) yalnızca active bakılır ve taban değerler kullanılır.
 */
export function personnelSummary(staff: Staff[], st: Settings, month?: string, versions?: StaffVersion[]) {
  const list = month === undefined ? staff.filter((s) => s.active) : staff.filter((s) => inRange(s, month)).map((s) => staffAt(s, versions, month));
  const rows = list.map((s) => staffCost(s, st));
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
export function fixedMonthly(fe: Pick<FixedExpense, "period" | "amount">, st: Settings): number {
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
export function fixedForMonth(fe: Pick<FixedExpense, "period" | "amount">, st: Settings, openDays: number, dim: number): number {
  if (fe.period === "gunluk") return fe.amount * openDays;
  return (fixedMonthly(fe, st) * openDays) / dim;
}

// ============================================================================
// Sayım birimi
// ============================================================================

export function countFactor(countUnit: string | null): number {
  return countUnit === "KG" || countUnit === "LT" ? 1000 : 1;
}

/** Malzeme birimine uyan sayım birimleri (ilki önerilen). gr → KG, ml → LT, adet → ADET, dilim → DİLİM ya da ADET. */
export function countUnitsFor(unit: Unit): CountUnit[] {
  switch (unit) {
    case "gr":
      return ["KG"];
    case "ml":
      return ["LT"];
    case "adet":
      return ["ADET"];
    case "dilim":
      return ["DİLİM", "ADET"];
  }
}

/** Kaydedilmiş çarpandan sayım birimi adı (eski sayımı hangi birimle girildiyse onunla göstermek için) */
export function countUnitForFactor(ing: Pick<Ingredient, "unit" | "countUnit">, factor: number): string {
  if (ing.countUnit && countFactor(ing.countUnit) === factor) return ing.countUnit;
  if (factor === 1000) return ing.unit === "ml" ? "LT" : "KG";
  return ing.unit === "dilim" ? "DİLİM" : "ADET";
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
  /** Elle girilen hücrenin notu (pnl_entries.note) */
  note?: string | null;
  /**
   * Sabit gider satırında: kalem bu ayda geçerlilik aralığının dışında (başlamadı ya da bitti).
   * Elle girilmiş tutar varsa yine de sayılır (overridden = true).
   */
  outOfRange?: boolean;
}

export interface PnlRowDef {
  key: string;
  label: string;
  section: string;
  kind: PnlRowKind;
  /** Kullanıcı bu hücreyi değiştirebilir mi? (auto satırlar üzerine yazılabilir) */
  editable: boolean;
  hint?: string;
  /** Satır adının altında soluk alt yazı (ör. tedarikçinin sattığı ürünler: "kahve, süt") */
  sub?: string;
  /** fixed:<id> satırlarında sabit gider kimliği (silinmiş kalemde kimlik var, kalem yok) */
  fixedId?: number;
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
  /** Birim çarpanı: kayıtlı sayımda sayıldığı andaki, sayılmamış satırda bugünkü sayım birimininki */
  factor: number;
  /** Miktarın birimi (KG, LT, ADET, DİLİM); eski sayımda sayıldığı andaki birim */
  countUnit: string;
  unitPrice: number;
  amount: number;
  amountVatIncl: number;
  /**
   * Malzeme artık sayım listesinde değil (pasif ya da "Sayılmaz") ama bu ay için kayıtlı sayımı var.
   * Satır geçmiş ayın değerini korumak için gösterilir; formda salt okunur olmalı.
   */
  archived: boolean;
  /** Kayıtlı sayımın birimi bugünkü sayım biriminden farklı (değer eski birimle hesaplanır) */
  unitChanged: boolean;
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

/**
 * Su + buz litre maliyeti ve neden o değer çıktığı (ekranlar doğru mesajı gösterebilsin):
 * - "override": Ayarlar'da elle girildi
 * - "ok": `month` ayının SU GİDERİ ÷ o ayın satışlarına göre su + buz litresi
 * - "no-bill": hiçbir ayda SU GİDERİ girilmedi
 * - "no-usage": SU GİDERİ girildi (`latestBillMonth`) ama o ay(lar)ın ürün satış listesi yok; litre hesaplanamadı
 * reason "ok" iken latestBillMonth ≠ month ise daha yeni ayın faturası satış listesi olmadığı için atlandı.
 */
export interface WaterCost {
  perLiter: number;
  month: string | null;
  bill: number;
  liters: number;
  reason: "override" | "ok" | "no-bill" | "no-usage";
  /** SU GİDERİ girilmiş en son ay (satış listesi olsun olmasın) */
  latestBillMonth: string | null;
}

/** Sabit gider listesi satırı: tutar ve dönem bu aya (ya da kalemin son/ilk ayına) göre */
export interface FixedItemView extends FixedExpense {
  /** İlk sürümden önceki (taban) değerler */
  base: { period: FixedPeriod; amount: number };
  /** Tutar geçmişi, eskiden yeniye (ilk satır taban) */
  history: FixedHistoryEntry[];
  /** Bu ayki (bitmişse son ayki, başlamadıysa ilk ayki) aylık karşılık */
  monthly: number;
  /** Bu ay hesaba giriyor mu */
  inRangeNow: boolean;
  status: RangeStatus;
  /** amount / period hangi ayın değeri */
  valueMonth: string;
  /** Bu aydan sonra başlayacak ilk değişiklik (ör. Kasım'dan itibaren zam) */
  nextChange: FixedHistoryEntry | null;
}

/** Personel listesi satırı: maaş bu aya (ya da kişinin son/ilk ayına) göre */
export interface StaffView extends Staff {
  base: { netSalary: number; extras: number };
  history: StaffHistoryEntry[];
  cost: StaffCost;
  inRangeNow: boolean;
  status: RangeStatus;
  valueMonth: string;
  nextChange: StaffHistoryEntry | null;
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
  /** "Bu ay": listelerde gösterilen güncel tutar ve aktiflik buna göre */
  const currentMonth = ds.currentMonth ?? currentMonthTR();
  const pnlByMonth = new Map<string, Map<string, number>>();
  const pnlNotes = new Map<string, Map<string, string>>();
  for (const e of ds.pnlEntries) {
    const m = pnlByMonth.get(e.month) ?? new Map<string, number>();
    m.set(e.rowKey, e.amount);
    pnlByMonth.set(e.month, m);
    if (e.note) {
      const n = pnlNotes.get(e.month) ?? new Map<string, string>();
      n.set(e.rowKey, e.note);
      pnlNotes.set(e.month, n);
    }
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
  // Excel her zaman Eylül SU GİDERİ ÷ Eylül su + buz litresini kullanır. Panel SU GİDERİ girilmiş ve
  // satış listesinden (reçeteye göre) su kullanımı çıkan en son ayı alır; Excel verisinde ikisi aynı sonucu verir.
  const waterIngredients = ds.ingredients.filter((i) => i.priceSource === "water");
  function computeWater(): WaterCost {
    if (st.suBirimLTOverride !== null && st.suBirimLTOverride !== undefined) {
      return { perLiter: st.suBirimLTOverride, month: null, bill: 0, liters: 0, reason: "override", latestBillMonth: null };
    }
    const candidates = [...pnlByMonth.entries()]
      .filter(([, rows]) => (rows.get("manual:su") ?? 0) > 0)
      .map(([m]) => m)
      .sort()
      .reverse();
    const latestBillMonth = candidates[0] ?? null;
    for (const m of candidates) {
      const usage = ingredientUsage(m);
      const liters = sum(waterIngredients.map((i) => usage.get(i.id) ?? 0)) / 1000;
      if (liters > 0) {
        const bill = pnlByMonth.get(m)!.get("manual:su")!;
        return { perLiter: bill / liters, month: m, bill, liters, reason: "ok", latestBillMonth };
      }
    }
    return { perLiter: 0, month: null, bill: 0, liters: 0, reason: latestBillMonth ? "no-usage" : "no-bill", latestBillMonth };
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
  // Her ay kendi aralığı ve sürümüyle hesaplanır; böylece bir zam ya da yeni kalem geçmiş ayları değiştirmez.
  const fixedVersions = groupVersions(ds.fixedExpenseVersions, (v) => v.fixedExpenseId);
  const staffVersions = groupVersions(ds.staffVersions, (v) => v.staffId);
  const allFixed = [...ds.fixedExpenses].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const fixedById = new Map(allFixed.map((f) => [f.id, f]));

  /** Sabit giderin o aydaki dönemi ve tutarı */
  function fixedAtMonth(fe: FixedExpense, month: string): FixedExpense {
    const v = versionAt(fixedVersions.get(fe.id), month);
    return v ? { ...fe, period: v.period, amount: v.amount } : fe;
  }
  /** Personelin o aydaki maaşı */
  function staffAtMonth(x: Staff, month: string): Staff {
    const v = versionAt(staffVersions.get(x.id), month);
    return v ? { ...x, netSalary: v.netSalary, extras: v.extras } : x;
  }

  const fixedInMonthCache = new Map<string, FixedExpense[]>();
  /** O ayda hesaba giren sabit giderler, o ayın tutarıyla (sıralı) */
  function fixedInMonth(month: string): FixedExpense[] {
    let list = fixedInMonthCache.get(month);
    if (!list) {
      list = allFixed.filter((f) => inRange(f, month)).map((f) => fixedAtMonth(f, month));
      fixedInMonthCache.set(month, list);
    }
    return list;
  }

  const personnelCache = new Map<string, PersonnelSummary>();
  /** O ayda çalışan personel, o ayın maaşıyla */
  function personnelFor(month: string): PersonnelSummary {
    let p = personnelCache.get(month);
    if (!p) {
      p = personnelSummary(ds.staff, st, month, ds.staffVersions);
      personnelCache.set(month, p);
    }
    return p;
  }

  /** Standart bir ayın sabit gider toplamı (personel dahil), o ayın kalemleri ve tutarlarıyla */
  function fixedStandardTotalFor(month: string): number {
    return personnelFor(month).total + sum(fixedInMonth(month).map((f) => fixedMonthly(f, st)));
  }

  // Bugünkü değerler (listeler, başabaş, tahmin): bu ayın kalemleri ve tutarları
  const personnel = personnelFor(currentMonth);
  const activeFixed = fixedInMonth(currentMonth);
  const fixedStandardTotal = fixedStandardTotalFor(currentMonth);

  /** Sabit gider listesi: bütün kalemler (bitmiş ve başlamamış dahil), bugünkü tutar + geçmiş */
  const fixedList: FixedItemView[] = allFixed.map((f) => {
    const valueMonth = valueMonthFor(f, currentMonth);
    const cur = fixedAtMonth(f, valueMonth);
    const history = fixedHistory(f, fixedVersions.get(f.id));
    return {
      ...cur,
      active: f.startMonth === undefined && f.endMonth === undefined ? f.active : activeFromRange(f.endMonth, currentMonth),
      base: { period: f.period, amount: f.amount },
      history,
      monthly: fixedMonthly(cur, st),
      inRangeNow: inRange(f, currentMonth),
      status: rangeStatus(f, currentMonth),
      valueMonth,
      nextChange: history.find((h) => h.versionId !== null && h.fromMonth! > valueMonth) ?? null,
    };
  });

  /** Personel listesi: herkes (ayrılmış ve başlamamış dahil), bugünkü maaş + geçmiş */
  const staffList: StaffView[] = ds.staff.map((x) => {
    const valueMonth = valueMonthFor(x, currentMonth);
    const cur = staffAtMonth(x, valueMonth);
    const history = staffHistory(x, staffVersions.get(x.id));
    return {
      ...cur,
      active: x.startMonth === undefined && x.endMonth === undefined ? x.active : activeFromRange(x.endMonth, currentMonth),
      base: { netSalary: x.netSalary, extras: x.extras },
      history,
      cost: staffCost(cur, st),
      inRangeNow: inRange(x, currentMonth),
      status: rangeStatus(x, currentMonth),
      valueMonth,
      nextChange: history.find((h) => h.versionId !== null && h.fromMonth! > valueMonth) ?? null,
    };
  });

  // --- Stok sayımı -------------------------------------------------------------
  const countsByMonth = new Map<string, Map<number, { qty: number; factor: number | null }>>();
  for (const c of ds.stockCounts) {
    const m = countsByMonth.get(c.month) ?? new Map<number, { qty: number; factor: number | null }>();
    m.set(c.ingredientId, { qty: c.qty, factor: c.factor ?? null });
    countsByMonth.set(c.month, m);
  }
  const extrasByMonth = new Map<string, typeof ds.stockExtras>();
  for (const e of ds.stockExtras) {
    const list = extrasByMonth.get(e.month) ?? [];
    list.push(e);
    extrasByMonth.set(e.month, list);
  }
  const bySortOrder = (a: Ingredient, b: Ingredient) => a.sortOrder - b.sortOrder || a.id - b.id;
  /** Bugünkü sayım listesi: aktif ve sayım birimi olan malzemeler */
  const countable = ds.ingredients.filter((i) => i.countUnit && i.active).sort(bySortOrder);
  const countableIds = new Set(countable.map((i) => i.id));

  /**
   * Kayıtlı sayımın malzemenin kendi birimindeki miktarı (ör. 2,5 KG → 2500 gr), sayıldığı andaki çarpanla.
   * Sayım yoksa null.
   */
  function countInBaseUnit(month: string, ingredientId: number): number | null {
    const c = countsByMonth.get(month)?.get(ingredientId);
    if (!c) return null;
    const ing = ingById.get(ingredientId);
    return c.qty * (c.factor ?? countFactor(ing?.countUnit ?? null));
  }

  const stockCache = new Map<string, StockSheet>();
  function stockSheet(month: string): StockSheet {
    let s = stockCache.get(month);
    if (s) return s;
    const counts = countsByMonth.get(month) ?? new Map<number, { qty: number; factor: number | null }>();
    // Bugünkü liste + o ay sayılmış ama sonradan pasif / "Sayılmaz" yapılmış malzemeler (geçmiş ay değeri korunur)
    const archivedIngs = [...counts.keys()]
      .filter((id) => !countableIds.has(id))
      .map((id) => ingById.get(id))
      .filter((i): i is Ingredient => !!i);
    const lines = [...countable, ...archivedIngs].sort(bySortOrder);
    const groupMap = new Map<string, StockLine[]>();
    for (const ing of lines) {
      const c = counts.get(ing.id);
      const currentFactor = countFactor(ing.countUnit);
      const factor = c?.factor ?? currentFactor;
      const unitPrice = (unitCost.get(ing.id) ?? 0) * factor;
      const qty = c ? c.qty : null;
      const amount = (qty ?? 0) * unitPrice;
      const archived = !countableIds.has(ing.id);
      const g = ing.countGroup ?? "DİĞER";
      const list = groupMap.get(g) ?? [];
      list.push({
        ingredient: ing,
        qty,
        factor,
        countUnit: countUnitForFactor(ing, factor),
        unitPrice,
        amount,
        amountVatIncl: amount * (1 + ing.vatRate),
        archived,
        unitChanged: !!c && !archived && factor !== currentFactor,
      });
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

  // --- Aylık harcamalar (reklam, influencer, fatura dışı) -------------------------
  const expenseCats: ExpenseCategory[] = [...(ds.expenseCategories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const expenseByMonth = new Map<string, Map<number, number>>();
  for (const e of ds.expenseEntries ?? []) {
    const m = monthOfDate(e.date);
    const byCat = expenseByMonth.get(m) ?? new Map<number, number>();
    byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amount);
    expenseByMonth.set(m, byCat);
  }
  /** Kategorinin ilk kaydının ayı: "her ay girilir" hatırlatması bundan önceki aylar için yapılmaz */
  const expenseFirstMonth = new Map<number, string>();
  for (const e of ds.expenseEntries ?? []) {
    const m = monthOfDate(e.date);
    const cur = expenseFirstMonth.get(e.categoryId);
    if (!cur || m < cur) expenseFirstMonth.set(e.categoryId, m);
  }
  /** Her ay girilecek kategori bu ay için bekleniyor mu: ilk kaydından (kaydı yoksa bu aydan) itibaren */
  const expenseExpected = (cat: ExpenseCategory, month: string) => cat.active && cat.monthly && month >= (expenseFirstMonth.get(cat.id) ?? ds.currentMonth ?? currentMonthTR());
  /** Fatura kategorisi harcamaya bağlanabilir mi: mal, komisyon ve kafe dışı faturalar zaten ayrı sayılır */
  const invoiceCategoryMappable = (c: string | null): c is string =>
    Boolean(c) && !GOODS_CATEGORIES.includes(c!) && c !== COMMISSION_CATEGORY && !SEPARATE_CATEGORIES.includes(c!);
  /** Kategorilerin aydaki tutarı: girilen harcamalar + bağlı fatura kategorisindeki faturalar (KDV hariç, iskonto düşülmüş) */
  function expenseAmounts(month: string): { cat: ExpenseCategory; entries: number; invoices: number; total: number }[] {
    const invs = invoicesByMonth.get(month) ?? [];
    return expenseCats.map((cat) => {
      const entries = expenseByMonth.get(month)?.get(cat.id) ?? 0;
      const invoices = invoiceCategoryMappable(cat.invoiceCategory) ? sum(invs.filter((i) => i.category === cat.invoiceCategory).map(invoiceNet)) : 0;
      return { cat, entries, invoices, total: entries + invoices };
    });
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
    const notes = pnlNotes.get(month);
    const noteOf = (key: string) => notes?.get(key) ?? null;
    const dim = daysInMonth(month);
    const openDays = info?.openDays ?? 0;
    const ratio = openDays / dim;
    const cells = new Map<string, PnlCell>();
    const auto = (key: string, computed: number) => {
      const ov = overrides.get(key);
      const cell: PnlCell =
        ov !== undefined
          ? { value: ov, computed, overridden: true, note: noteOf(key) }
          : { value: computed, computed, overridden: false, note: null };
      cells.set(key, cell);
      return cell.value as number;
    };
    const manual = (key: string) => {
      const v = overrides.get(key) ?? 0;
      cells.set(key, { value: overrides.has(key) ? v : null, computed: null, overridden: overrides.has(key), note: noteOf(key) });
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
    // Aylık harcamalar: mal kategorileri mal alımına (devir hesabından önce), ötekiler aşağıda bölümlerine
    const exp = expenseAmounts(month).filter((x) => x.total || x.cat.active);
    for (const x of exp) {
      if (x.cat.section !== "mal") continue;
      cells.set(`expense:${x.cat.id}`, { value: x.total, computed: x.total, overridden: false });
      purchases += x.total;
    }

    // Devirler
    const prevClosing = closingStock(shiftMonth(month, -1)).value;
    const opening = auto("stock:opening", prevClosing);
    cells.set("stock:purchased", { value: purchases, computed: purchases, overridden: false });
    const cl = closingStock(month);
    cells.set("stock:closing", { value: cl.value, computed: cl.computed, overridden: cl.overridden, note: cl.overridden ? noteOf("stock:closing") : null });
    const closing = cl.value;
    const cogs = opening + purchases - closing;

    // Personel, faturalar, kira, genel
    const sections: Record<FixedSection | "komisyon", number> = { personel: 0, faturalar: 0, kira: 0, genel: 0, komisyon: 0 };
    // Personel: o ay çalışanlar, o ayın maaşıyla (elle girilen bordro tutarı her zaman geçerli)
    const pers = personnelFor(month);
    sections.personel += auto("personnel:net", pers.net * ratio);
    sections.personel += auto("personnel:employer", (pers.total - pers.net) * ratio);
    // Sabit giderler: aralıktaki kalemler o ayın tutarıyla. Aralık dışındaki (ya da silinmiş) kalemin
    // elle girilmiş tutarı yine de sayılır; böylece dondurulmuş geçmiş ay kaybolmaz.
    for (const fe of allFixed) {
      const key = `fixed:${fe.id}`;
      if (inRange(fe, month)) {
        sections[fe.section] += auto(key, fixedForMonth(fixedAtMonth(fe, month), st, openDays, dim));
      } else {
        const ov = overrides.get(key);
        cells.set(key, { value: ov ?? null, computed: null, overridden: ov !== undefined, note: ov !== undefined ? noteOf(key) : null, outOfRange: true });
        if (ov !== undefined) sections[fe.section] += ov;
      }
    }
    for (const [key, ov] of overrides) {
      if (!key.startsWith("fixed:") || cells.has(key)) continue;
      // Kalemi silinmiş eski bir elle giriş: İşletme genel giderlerinde sayılır
      cells.set(key, { value: ov, computed: null, overridden: true, note: noteOf(key), outOfRange: true });
      sections.genel += ov;
    }
    for (const row of MANUAL_PNL_ROWS) {
      if (row.section === "mal") continue;
      sections[row.section] += manual(row.key);
    }
    for (const x of exp) {
      if (x.cat.section === "mal") continue;
      cells.set(`expense:${x.cat.id}`, { value: x.total, computed: x.total, overridden: false });
      sections[x.cat.section] += x.total;
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

  /** Verisi olan ilk ay (ay bilgisi, fatura, satış, sayım ya da elle giriş); daha önceki aylar boş sayılır */
  const firstDataMonth =
    [
      ...ds.months.map((m) => m.month),
      ...ds.invoices.map((i) => monthOfDate(i.date)),
      ...salesMonths,
      ...ds.stockCounts.map((c) => c.month),
      ...pnlByMonth.keys(),
    ].sort()[0] ?? null;

  /** Tedarikçinin sattığı ürünler (Hammaddeler'deki tedarikçi adından): Excel'deki "SÜTAŞ (süt)" açıklaması */
  const firstWord = (x: string) => x.trim().split(/\s+/)[0]?.toLocaleLowerCase("tr-TR") ?? "";
  function supplierProducts(supplier: string): string | undefined {
    const key = firstWord(supplier);
    if (!key) return undefined;
    const cats: string[] = [];
    const others: string[] = [];
    for (const i of ds.ingredients) {
      if (!i.active || !i.supplier) continue;
      if (!i.supplier.split("/").some((part) => firstWord(normalizeSupplier(part)) === key)) continue;
      if (i.category === "Diğer") {
        if (!others.includes(i.name)) others.push(i.name);
      } else if (!cats.includes(i.category)) cats.push(i.category);
    }
    const parts = [...cats, ...others.slice(0, 2)].map((x) => x.toLocaleLowerCase("tr-TR"));
    return parts.length ? parts.slice(0, 4).join(", ") : undefined;
  }

  /** Genel Maliyet yıllık tablo satır tanımları (aylardan bağımsız sabit sıra) */
  function pnlRowDefs(months: string[]): PnlRowDef[] {
    const monthsCalc = months.map(pnlMonth);
    const suppliers = new Set<string>();
    const commSuppliers = new Set<string>();
    const fixedKeysWithValue = new Set<string>();
    const expenseKeysWithValue = new Set<string>();
    for (const pm of monthsCalc) {
      for (const [k, c] of pm.cells) {
        if (k.startsWith("purchase:")) suppliers.add(k);
        if (k.startsWith("commission:") && k !== "commission:pos") commSuppliers.add(k);
        if (k.startsWith("fixed:") && c.overridden) fixedKeysWithValue.add(k);
        if (k.startsWith("expense:") && c.value) expenseKeysWithValue.add(k);
      }
    }
    // Aylık harcama kategorileri: etkin olanlar ve bu aylarda tutarı olan pasifler
    const expenseRows = (section: string) =>
      expenseCats
        .filter((c) => c.section === section && (c.active || expenseKeysWithValue.has(`expense:${c.id}`)))
        .map((c) => ({
          key: `expense:${c.id}`,
          label: c.name.toLocaleUpperCase("tr-TR"),
          kind: "auto" as const,
          editable: false,
          hint: `Giderler › Aylık harcamalar'dan${invoiceCategoryMappable(c.invoiceCategory) ? ` + Faturalar'daki "${c.invoiceCategory}" faturaları (KDV hariç)` : ""}. Tutarı orada girin.`,
        }));
    const rows: PnlRowDef[] = [];
    const sec = (section: string) => (r: Omit<PnlRowDef, "section">) => rows.push({ ...r, section });

    // Tedarikçiler alfabetik ve sabit sırada (tutar değiştikçe satırlar yer değiştirmez)
    const mal = sec("mal");
    for (const k of [...suppliers].sort((a, b) => a.localeCompare(b, "tr-TR"))) {
      const name = k.slice("purchase:".length);
      mal({ key: k, label: name.toLocaleUpperCase("tr-TR"), sub: supplierProducts(name), kind: "auto", editable: false, hint: "Faturalar sayfasından otomatik (KDV hariç, iskonto düşülmüş)." });
    }
    for (const r of expenseRows("mal")) mal(r);
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
      // Bu aylardan en az birinde (verisi olan dönemde) geçerli olan ya da elle tutarı girilmiş kalemler
      for (const fe of allFixed.filter((f) => f.section === key)) {
        const shown =
          fixedKeysWithValue.has(`fixed:${fe.id}`) ||
          months.some((m) => (!firstDataMonth || m >= firstDataMonth) && inRange(fe, m));
        if (!shown) continue;
        add({ key: `fixed:${fe.id}`, fixedId: fe.id, label: fe.name.toLocaleUpperCase("tr-TR"), kind: "auto", editable: true, hint: fe.note ?? undefined });
      }
      if (key === "genel") {
        for (const k of [...fixedKeysWithValue].filter((k) => !fixedById.has(Number(k.slice(6)))).sort()) {
          add({ key: k, fixedId: Number(k.slice(6)), label: `SİLİNMİŞ GİDER (#${k.slice(6)})`, kind: "auto", editable: true, hint: "Bu sabit gider silinmiş; elle girilen tutarı korunuyor. Boşaltırsanız satır kaybolur." });
        }
      }
      for (const r of expenseRows(key)) add(r);
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
    /** "Bu ay" (YYYY-MM, Türkiye saati) */
    currentMonth,
    /** Verisi olan ilk ay */
    firstDataMonth,
    /** Bu ayın personel toplamı (listeler); belirli bir ay için personnelFor(ay) */
    personnel,
    personnelFor,
    /** Bu ay hesaba giren sabit giderler, bu ayın tutarıyla; belirli bir ay için fixedInMonth(ay) */
    activeFixed,
    fixedInMonth,
    /** Sabit giderin o aydaki dönemi ve tutarı: fixedAtMonth(kalem, "2026-11") */
    fixedAtMonth,
    /** Personelin o aydaki maaşı: staffAtMonth(kişi, "2026-11") */
    staffAtMonth,
    /** Bütün sabit giderler (bitmiş / başlamamış dahil), bugünkü tutar + geçmiş */
    fixedList,
    /** Bütün personel (ayrılmış / başlamamış dahil), bugünkü maaş + geçmiş */
    staffList,
    /** Bu ayın standart sabit gider toplamı; belirli bir ay için fixedStandardTotalFor(ay) */
    fixedStandardTotal,
    fixedStandardTotalFor,
    stockSheet,
    countInBaseUnit,
    closingStock,
    invoicesByMonth,
    goodsPurchases,
    pnlMonth,
    pnlRowDefs,
    pnlValue,
    /** Aylık harcama kategorileri (sıralı) ve bir aydaki tutarları */
    expenseCategories: expenseCats,
    expenseAmounts,
    expenseExpected,
  };
}

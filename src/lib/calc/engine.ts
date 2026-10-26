import {
  COMMISSION_CATEGORY,
  FIXED_SECTIONS,
  GOODS_CATEGORIES,
  MANUAL_PNL_ROWS,
  PACKAGING_CATEGORY,
  SEPARATE_CATEGORIES,
} from "../constants";
import { isCountable } from "../ingredient-usage";
import { buildSiteLinkIndex, mapSiteLines, OPTION_KINDS, optionProductId, optionTotals, siteRevenue, type OptionKind, type SiteRevenue } from "../site-sales/calc";
import type { SiteSalesLine, SiteSalesMonth } from "../site-sales/schema";
import { evaluateExpression } from "./expr";
import { closingLayers, FIFO_LOOKBACK_MONTHS, invoiceLayer, layersValue, monthPool, lotPool, openingLayer, valuationFor, type PurchaseLot, type StockLayer } from "./fifo";
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
  WasteEntry,
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

/**
 * Belirli bir ay için tutar (Genel Maliyet sayfası): günlük kalem × açık gün; ötekiler aylık karşılık × gün ÷ ayın gün
 * sayısı. `days` aylık kalemlerin günü (prorationDays): açık gün elle girildiyse o (Excel), kasa raporlarından geliyorsa
 * raporların kapsadığı takvim günü
 */
export function fixedForMonth(fe: Pick<FixedExpense, "period" | "amount">, st: Settings, openDays: number, dim: number, days = openDays): number {
  if (fe.period === "gunluk") return fe.amount * openDays;
  return (fixedMonthly(fe, st) * days) / dim;
}

/**
 * Aylık kalemlerin (aylık, haftalık, yıllık sabit giderler ve personel) ayın kaçta kaçına düştüğü gün sayısı. Açık gün
 * elle girildiyse (Excel: açılış ayı Temmuz 23 gün) o gün; kasa raporlarından geliyorsa raporların kapsadığı takvim
 * günü (biten ayda ayın tamamı, süren ayda bugüne kadar). Kapalı bir gün (bayram, raporu hiç girilmemiş gün) kira ve
 * maaşı düşürmez: cirosu zaten 0'dır, gider ise tam ödenir. Günlük kalemler yine açık günle çarpılır.
 */
export function prorationDays(info: Pick<Month, "month" | "openDays" | "sources" | "kasa"> | undefined): number {
  const open = info?.openDays ?? 0;
  const till = info?.kasa?.till;
  if (!info || info.sources?.openDays !== "kasa" || !till) return open;
  const span = Math.round((Date.parse(`${till.to}T00:00:00Z`) - Date.parse(`${till.from}T00:00:00Z`)) / 86_400_000) + 1;
  return Number.isFinite(span) ? Math.max(open, Math.min(daysInMonth(info.month), span)) : open;
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
  /** HİZMET işaretli satırların cirosu (KDV dahil): net'i hizmet KDV oranıyla ayrılır */
  serviceRevenue: number;
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
  /** Aylık kalemlerin ve personelin günü (prorationDays): elle açık gün ya da kasa raporlarının kapsadığı takvim günü */
  prorationDays: number;
  dim: number;
  /** prorationDays ÷ ayın gün sayısı */
  ratio: number;
  cells: Map<string, PnlCell>;
  purchases: number;
  opening: number;
  closing: number;
  cogs: number;
  sections: Record<FixedSection | "komisyon", number>;
  expenses: number;
  /** ModPOS cirosu (KDV dahil, Satışlar'a girilen); girilmediyse null */
  revenue: number | null;
  /**
   * ModPOS cirosunun hizmet (karaoke) payı, KDV dahil: Satışlar'da HİZMET işaretli satırların cirosu, ay cirosuyla
   * sınırlı. revenueNet'te hizmet KDV oranıyla, kalanı satış KDV oranıyla ayrılır; satış listesi yoksa 0.
   */
  serviceRevenue: number;
  /** ModPOS cirosu, KDV hariç */
  revenueNet: number | null;
  /** laffogato.net'in online satışı (KDV hariç); ay hiç çekilmediyse null (0 değil) */
  site: SiteMonthRevenue | null;
  /** Kârın ve oranların cirosu: ModPOS (KDV hariç) + online; ikisi de yoksa null */
  revenueTotalNet: number | null;
  /** revenueTotalNet − giderler */
  profit: number;
}

/** Bir ayın online geliri (KDV hariç, TL) ve kaydın bilgisi */
export interface SiteMonthRevenue extends SiteRevenue {
  /** Panelin siteden çektiği an */
  pulledAt: string;
  /** Ay köşkte bitti (rakamlar yalnız sonradan gelen iadeyle değişir) */
  closed: boolean;
}

/** Online kafe satırlarının panel ürünlerine eşlenmesi (menü bağlantısıyla) */
export interface SiteLinesCalc {
  mapped: { line: SiteSalesLine; product: Product }[];
  /** Bağlı ürünü olmayan satırlar: tüketime girmez, eşleştirme için listelenir */
  unmapped: SiteSalesLine[];
  /**
   * Satırların seçenekleri (ekstra shot, şurup, alternatif süt; site gönderiyorsa): adet ve panel ürünü (Extra Shot,
   * Syrup, Alternatif Süt). Ürünü olan seçenek o ürünün reçetesiyle tüketime ve maliyete girer; olmayan listelenir
   */
  options: { kind: OptionKind; qty: number; product: Product | null }[];
}

/**
 * Bir ayın laffogato.net online satışı, reçeteye göre (Genel bakış, zam etkisi; docs/SITE-SATIS.md). Gelir KDV hariç
 * (Gelir-gider'deki üç satırla aynı). Malzeme: ürüne eşlenen kafe satırları ve ürünü olan seçenekler adet × ürünün
 * reçete maliyeti; eşlenmeyen kafe satırları ve mağaza kolileri (kargo hariç) KDV hariç tutar × ayın ortalama maliyet
 * oranı (ModPOS'ta eşleşmeyen satırın kuralı). Karaokenin malzemesi yok; online ödemenin komisyonu faturasıyla
 * Gelir-gider'de (reçeteye göre görünümde yok).
 */
export interface OnlineMonthCalc {
  month: string;
  revenue: SiteMonthRevenue;
  /** Ürüne eşlenen satırların ve seçeneklerin reçete maliyeti */
  mappedCost: number;
  /** Ortalama maliyet oranıyla tahmin edilen kısmın dayanağı (KDV hariç) ve maliyeti */
  estimatedBase: number;
  estimatedCost: number;
  /** Ayın ModPOS ortalama maliyet oranı (ayın satış listesi yoksa son satış ayınınki; hiç yoksa 0) */
  avgCostRatio: number;
  material: number;
  /** revenue.total − material */
  grossProfit: number;
  /** Ürüne eşlenen kafe adedi (seçenekler dahil: Extra Shot ürünü gibi) */
  mappedQty: number;
  soldByProduct: Map<number, number>;
}

export interface StockLine {
  ingredient: Ingredient;
  qty: number | null;
  /** Birim çarpanı: kayıtlı sayımda sayıldığı andaki, sayılmamış satırda bugünkü sayım birimininki */
  factor: number;
  /** Miktarın birimi (KG, LT, ADET, DİLİM); eski sayımda sayıldığı andaki birim */
  countUnit: string;
  /** Sayım biriminin fiyatı, ayın sonunda geçerli hammadde fiyatıyla (süren ayda bugünkü) */
  unitPrice: number;
  amount: number;
  amountVatIncl: number;
  /**
   * Malzeme artık sayım listesinde değil (pasif ya da "Sayılmaz") ama bu ay için kayıtlı sayımı var.
   * Satır geçmiş ayın değerini korumak için gösterilir; formda salt okunur olmalı.
   */
  archived: boolean;
  /** Malzeme pasif ama aktif bir ürünün reçetesinde: tüketildiği için listede kalır, sayılır */
  passiveInUse: boolean;
  /** Kayıtlı sayımın birimi bugünkü sayım biriminden farklı (değer eski birimle hesaplanır) */
  unitChanged: boolean;
  /**
   * Değerleme: "fifo" = sayılan miktar en yeni faturalardan geriye, her parça kendi faturasının fiyatıyla (Ayarlar'daki
   * başlangıç ayından itibaren, faturası olan kalemde); "son-fiyat" = miktar × ay sonu fiyatı. unitPrice FIFO'da
   * tutar ÷ miktardır. valuation, layers, uncoveredQty, pool ve fallbackUnit yalnız yöneticiye gider
   */
  valuation: "fifo" | "son-fiyat";
  /** FIFO katmanları, hammaddenin kendi biriminde (gr, ml, adet); son-fiyatta boş */
  layers: StockLayer[];
  /** Faturayla karşılanmayan, ay sonu fiyatıyla değerlenen miktar (hammaddenin biriminde) */
  uncoveredQty: number;
  /** Ayın havuzu (en yeniden eskiye): formda değişen miktar bununla değerlenir; son-fiyatta boş */
  pool: StockLayer[];
  /** Ay sonu fiyatı, hammaddenin kendi biriminde: havuzun yetmediği kısım */
  fallbackUnit: number;
}

export interface StockSheet {
  month: string;
  /** Ay FIFO ile mi değerlendi (Ayarlar › Stok değerleme başlangıcı) */
  valuation: "fifo" | "son-fiyat";
  /** Malzeme satırlarının faturalardan (FIFO katmanlarından) gelen tutarı; kalan ay sonu fiyatıyla */
  fifoCovered: number;
  groups: { name: string; lines: StockLine[]; total: number; totalVatIncl: number }[];
  extras: { id: number; name: string; unit: string; qty: number; unitPrice: number; amount: number }[];
  extrasTotal: number;
  total: number;
  totalVatIncl: number;
  hasData: boolean;
}

/**
 * Süren ayda yapıştırılan satış listesinin dönemi, kasa raporlarından kısaysa (engine listPeriod): listenin ilk ve son
 * günü, o güne kadarki kasa açık günü, Z toplamı ve indirimi, takvim günü
 */
export interface ListPeriod {
  from: string;
  through: string;
  openDays: number;
  posRevenue: number;
  discounts: number;
  /** Takvim günü (ilk günden son güne) */
  days: number;
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
  /**
   * Ayın kartlı satış oranı: elle yazılan ya da o ayın kasa raporlarından (kart + yemek kartı ÷ Z toplamı); yoksa
   * Ayarlar › kartlı satış oranı. POS komisyonu bununla hesaplanır; ürün fiyatı hesabı Ayarlar'daki oranla kalır.
   */
  function cardShareOf(month: string): { rate: number; source: "manual" | "kasa" | "ayar" } {
    const info = monthInfo.get(month);
    const v = info?.cardShare ?? null;
    if (v === null) return { rate: st.kartOrani, source: "ayar" };
    return { rate: v, source: info?.sources?.cardShare === "kasa" ? "kasa" : "manual" };
  }
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

  // --- Zayi ve ikram (personelin kaydı) -----------------------------------------
  const wasteByMonth = new Map<string, WasteEntry[]>();
  for (const w of ds.wasteEntries ?? []) {
    const m = w.date.slice(0, 7);
    wasteByMonth.set(m, [...(wasteByMonth.get(m) ?? []), w]);
  }
  /**
   * Kayıtlı zayi ve ikramın malzeme tüketimi (malzemenin kendi biriminde): ürün reçetesinden (fire payı olmadan),
   * hammadde doğrudan. Satış raporu yalnız ödenen satışları taşır; bunlar ona eklenmez, ayrı gösterilir.
   */
  const recordedCache = new Map<string, Map<number, { zayi: number; ikram: number }>>();
  function recordedUsage(month: string): Map<number, { zayi: number; ikram: number }> {
    let u = recordedCache.get(month);
    if (!u) {
      u = new Map();
      const add = (id: number, kind: WasteEntry["kind"], amount: number) => {
        const cur = u!.get(id) ?? { zayi: 0, ikram: 0 };
        cur[kind] += amount;
        u!.set(id, cur);
      };
      for (const w of wasteByMonth.get(month) ?? []) {
        if (w.productId !== null && productById.has(w.productId)) {
          for (const it of itemsByProduct.get(w.productId) ?? []) add(it.ingredientId, w.kind, evalQty(it).qty * w.qty);
        } else if (w.ingredientId !== null && ingById.has(w.ingredientId)) {
          add(w.ingredientId, w.kind, w.qty * w.factor);
        }
      }
      recordedCache.set(month, u);
    }
    return u;
  }

  // --- Satış listesinin dönemi (src/lib/sales-coverage.ts) --------------------------
  const coverageByMonth = new Map((ds.salesCoverage ?? []).map((c) => [c.month, c]));
  /**
   * Süren ayda yapıştırılan satış listesi kasa raporlarından kısa bir dönemi kapsıyorsa o dönem: liste ↔ POS cirosu
   * karşılaştırması, günlük ortalama, "ayda …" adetleri ve reçeteye göre kârın sabit gideri listenin günleriyle yapılır.
   * Liste kasayla aynı dönemi kapsıyorsa (ay bitince yüklenen liste) ya da ayın açık günü ve cirosu kasadan gelmiyorsa
   * (elle yazıldı: Excel'deki gibi listeye göre yazılmıştır) null.
   */
  function listPeriod(month: string): ListPeriod | null {
    const c = coverageByMonth.get(month);
    const info = monthInfo.get(month);
    const till = info?.kasa?.till;
    if (!c?.till || !till || info?.sources?.openDays !== "kasa" || info.sources.posRevenue !== "kasa") return null;
    if (c.through >= till.to || c.till.openDays <= 0) return null;
    const days = Math.round((Date.parse(`${c.through}T00:00:00Z`) - Date.parse(`${c.till.from}T00:00:00Z`)) / 86_400_000) + 1;
    return {
      from: c.till.from,
      through: c.through,
      openDays: c.till.openDays,
      posRevenue: c.till.posRevenue,
      // İndirim kasadan geliyorsa listenin günlerine kadarki; elle yazıldıysa ayın yazılan tutarı
      discounts: info.sources.discounts === "kasa" ? (c.till.discounts ?? 0) : info.discounts,
      days: Math.max(1, days),
    };
  }

  // --- laffogato.net online satışları (docs/SITE-SATIS.md) -------------------------
  // Ay başına bir kayıt; kafe satırları menü bağlantısıyla (products.site_menu_id + yuva) ürünlere eşlenir. ModPOS
  // satışlarından (sales_lines) ayrı bir kaynaktır: satış raporuna yazılmaz, tüketimde ve kâr-zararda ayrı görünür.
  const siteByMonth = new Map((ds.siteSales ?? []).map((r) => [r.month, r]));
  const siteIndex = buildSiteLinkIndex(ds.products);
  function siteSalesOf(month: string): SiteSalesMonth | null {
    return siteByMonth.get(month) ?? null;
  }
  // Seçeneklerin panel ürünü (Extra Shot, Syrup, Alternatif Süt): menü bağlantısı ya da ad (site-sales/calc.ts)
  const optionProduct = new Map<OptionKind, Product | null>(
    OPTION_KINDS.map((k) => {
      const id = optionProductId(k, siteIndex, ds.products);
      return [k, id === null ? null : (productById.get(id) ?? null)];
    }),
  );
  const siteLinesCache = new Map<string, SiteLinesCalc>();
  function siteLines(month: string): SiteLinesCalc {
    let c = siteLinesCache.get(month);
    if (!c) {
      const lines = siteByMonth.get(month)?.cafe.lines ?? [];
      const { mapped, unmapped } = mapSiteLines(lines, siteIndex);
      const totals = optionTotals(lines);
      c = {
        mapped: [],
        unmapped,
        // Bağlı olmayan satırın seçeneği de satılmıştır: seçenekler bütün satırlardan
        options: OPTION_KINDS.filter((k) => totals[k] > 0).map((k) => ({ kind: k, qty: totals[k], product: optionProduct.get(k) ?? null })),
      };
      for (const m of mapped) {
        const product = productById.get(m.productId);
        if (product) c.mapped.push({ line: m.line, product });
        else c.unmapped.push(m.line);
      }
      siteLinesCache.set(month, c);
    }
    return c;
  }
  /** Online satışın ürün başına adedi: eşlenen kafe satırları ve ürünü olan seçenekler (Extra Shot gibi) */
  function onlineSold(month: string): Map<number, number> {
    const sold = new Map<number, number>();
    const c = siteLines(month);
    for (const { line, product } of c.mapped) sold.set(product.id, (sold.get(product.id) ?? 0) + line.qty);
    for (const o of c.options) if (o.product) sold.set(o.product.id, (sold.get(o.product.id) ?? 0) + o.qty);
    return sold;
  }
  /**
   * Online kafe siparişlerinin reçeteye göre harcadığı malzeme (fire hariç, malzemenin kendi biriminde): eşlenen
   * satırlar ve ürünü olan seçenekler (ekstra shot → Extra Shot ürününün reçetesi). ModPOS satışlarının tüketimine
   * (ingredientUsage) eklenmez; tutarlılıkta ayrı kaynak olarak gösterilir.
   */
  const onlineCache = new Map<string, Map<number, number>>();
  function onlineUsage(month: string): Map<number, number> {
    let u = onlineCache.get(month);
    if (!u) {
      u = new Map();
      for (const [productId, qty] of onlineSold(month)) {
        for (const it of itemsByProduct.get(productId) ?? []) {
          u.set(it.ingredientId, (u.get(it.ingredientId) ?? 0) + evalQty(it).qty * qty);
        }
      }
      onlineCache.set(month, u);
    }
    return u;
  }
  /**
   * Ayın online geliri (KDV hariç; oranı saklı olmayanlar Ayarlar'daki oranla: kafe ve mağaza satış KDV'si, karaoke
   * hizmet KDV'si); çekilmemiş ayda null
   */
  function siteRevenueOf(month: string): SiteMonthRevenue | null {
    const r = siteByMonth.get(month);
    return r ? { ...siteRevenue(r, st.kdv, st.kdvHizmet), pulledAt: r.pulledAt, closed: r.closed } : null;
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

  // --- Ay sonunda geçerli birim fiyat (sayımın değeri) ---------------------------
  // Kapanmış ayın devreden malı o ayın sonundaki fiyatla değerlenir: sonraki bir zam (Paraşüt faturası, elle) geçmiş
  // ayın kârını değiştirmez. Fiyat geçmişindeki ay sonundan önceki son kayıt geçerlidir; ondan sonra değişiklik yoksa
  // bugünkü fiyat (aynısı). İlk kayıttan önceki ay (Excel aktarımı ya da fiyatsız eklenen kalem, kayıt sonradan) bilinen
  // ilk fiyatla. Sayımdan fiyatıyla eklenen kalemin geçmişi eklendiği anki fiyatla başlar (count-item.ts
  // countItemPriceRow); kalem Tahmini iken yöneticinin düzeltmesi o satırın yerine geçer (correctsCountItemStart), yani
  // eklendiği ay da düzeltilen fiyatla değerlenir. Su ve buz su faturasından gelir (geçmişi yok).
  const priceHistory = new Map<number, { at: number; unit: number }[]>();
  for (const r of ds.ingredientPrices ?? []) {
    const at = Date.parse(r.changedAt);
    if (!Number.isFinite(at)) continue;
    const list = priceHistory.get(r.ingredientId) ?? [];
    list.push({ at, unit: r.packageSize ? r.packagePrice / r.packageSize : 0 });
    priceHistory.set(r.ingredientId, list);
  }
  for (const list of priceHistory.values()) list.sort((a, b) => a.at - b.at);
  /** Ayın bittiği an: sonraki ayın 1'i 00:00, Türkiye saati */
  const monthEndAt = (month: string) => Date.parse(`${shiftMonth(month, 1)}-01T00:00:00+03:00`);
  function unitCostAtMonthEnd(ingredientId: number, month: string): number {
    const now = unitCost.get(ingredientId) ?? 0;
    const hist = priceHistory.get(ingredientId);
    if (!hist?.length || ingById.get(ingredientId)?.priceSource === "water") return now;
    const end = monthEndAt(month);
    let i = -1;
    while (i + 1 < hist.length && hist[i + 1].at < end) i++;
    if (i === hist.length - 1) return now;
    return hist[Math.max(i, 0)].unit;
  }

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

  /** Her hammaddenin kaç ürün kartında kullanıldığı (pasif ürünler dahil: silme engeli) */
  const usedIn = new Map<number, number[]>();
  /**
   * Yalnız aktif ürünlerin reçeteleri: satışla tüketilen malzeme. "Hiçbir reçetede yok" uyarısı ve çipi bunu kullanır
   * (yalnız emekli ürünlerin kullandığı malzeme "reçetede yok" sayılır); pasif malzeme burada geçiyorsa sayım listesinde
   * kalır (denetim E-04, E-58)
   */
  const usedInActive = new Map<number, number[]>();
  for (const it of ds.recipeItems) {
    const list = usedIn.get(it.ingredientId) ?? [];
    if (!list.includes(it.productId)) list.push(it.productId);
    usedIn.set(it.ingredientId, list);
    if (!productById.get(it.productId)?.active) continue;
    const act = usedInActive.get(it.ingredientId) ?? [];
    if (!act.includes(it.productId)) act.push(it.productId);
    usedInActive.set(it.ingredientId, act);
  }

  /**
   * Ayın zayi ve ikram özeti: malzeme maliyeti (KDV hariç; ürün reçetesinin malzeme toplamı, fire payı olmadan;
   * hammadde birim maliyetiyle) ve ikramın menü fiyatıyla değeri (KDV dahil; ModPOS'un ödenmez tutarıyla
   * karşılaştırılır). Malzeme maliyeti zaten sayım farkının içindedir: gelir-gidere ayrıca gider yazılmaz. Bir kaydın
   * malzeme maliyeti wasteCost (ay özeti, zayi sayfasının kalemleri ve Onaylar'daki geç kayıt kartı aynı fonksiyonu
   * kullanır; bugünkü fiyatlarla).
   */
  function wasteCost(w: Pick<WasteEntry, "productId" | "ingredientId" | "qty" | "factor">): number {
    const product = w.productId !== null ? productById.get(w.productId) : undefined;
    if (product) return computeProduct(product).ingredientTotal * w.qty;
    return w.ingredientId !== null ? (unitCost.get(w.ingredientId) ?? 0) * w.qty * w.factor : 0;
  }

  function wasteSummary(month: string) {
    const out = { zayi: { count: 0, cost: 0 }, ikram: { count: 0, cost: 0, menuValue: 0 } };
    for (const w of wasteByMonth.get(month) ?? []) {
      const product = w.productId !== null ? productById.get(w.productId) : undefined;
      const cost = wasteCost(w);
      out[w.kind].count += 1;
      out[w.kind].cost += cost;
      if (w.kind === "ikram" && product) out.ikram.menuValue += product.price * w.qty;
    }
    return out;
  }

  // --- Aylık satış analizi (Satış Raporu) ------------------------------------
  const salesCache = new Map<string, MonthSales>();
  function monthSales(month: string): MonthSales {
    let ms = salesCache.get(month);
    if (ms) return ms;
    const raw = linesByMonth.get(month) ?? [];
    const cardShare = cardShareOf(month).rate;
    const base = raw.map((line) => {
      const product = line.productId ? productById.get(line.productId) : undefined;
      const pc = product ? computeProduct(product) : undefined;
      // Hizmet satışı (karaoke odası) kendi KDV oranıyla; ürünler satış KDV'siyle
      const net = line.revenue / (1 + (line.isService ? st.kdvHizmet : st.kdv));
      const commission = line.revenue * st.komisyon * cardShare;
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
      serviceRevenue: sum(lines.filter((l) => l.line.isService).map((l) => l.line.revenue)),
      soldByProduct: soldByProduct(month),
    };
    salesCache.set(month, ms);
    return ms;
  }

  const salesMonths = [...linesByMonth.keys()].sort();

  // --- Online satış, reçeteye göre (OnlineMonthCalc) ------------------------------
  const onlineMonthCache = new Map<string, OnlineMonthCalc | null>();
  /** Ayın online satışının reçeteye göre hesabı; ay çekilmediyse null */
  function onlineMonth(month: string): OnlineMonthCalc | null {
    if (onlineMonthCache.has(month)) return onlineMonthCache.get(month)!;
    const r = siteByMonth.get(month);
    let out: OnlineMonthCalc | null = null;
    if (r) {
      const revenue = siteRevenueOf(month)!;
      const soldBy = onlineSold(month);
      let mappedCost = 0;
      let mappedQty = 0;
      for (const [productId, qty] of soldBy) {
        const product = productById.get(productId);
        if (!product) continue;
        mappedCost += qty * computeProduct(product).cost;
        mappedQty += qty;
      }
      // Eşlenmeyen kafe satırları liste fiyatıyla, mağaza kolileri kargo ücreti (taşıma hizmeti, hizmet KDV'si) düşülerek
      const unmappedNet = sum(siteLines(month).unmapped.map((l) => l.listMinor)) / 100 / (1 + st.kdv);
      const shopGoods = Math.max(0, revenue.shop - r.shop.deliveryMinor / 100 / (1 + st.kdvHizmet));
      // Ayın satış listesi yoksa (süren ay, liste ay sonunda) son satış ayının oranı
      const ratioMonth = linesByMonth.has(month) ? month : (salesMonths.filter((m) => m <= month).at(-1) ?? salesMonths[0]);
      const avgCostRatio = ratioMonth ? monthSales(ratioMonth).avgCostRatio : 0;
      const estimatedBase = unmappedNet + shopGoods;
      const estimatedCost = estimatedBase * avgCostRatio;
      const material = mappedCost + estimatedCost;
      out = { month, revenue, mappedCost, estimatedBase, estimatedCost, avgCostRatio, material, grossProfit: revenue.total - material, mappedQty, soldByProduct: soldBy };
    }
    onlineMonthCache.set(month, out);
    return out;
  }

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
  /**
   * Bugünkü sayım listesi: sayım birimi olan aktif malzemeler ve aktif bir ürünün reçetesinde geçen pasif malzemeler
   * (satışla tüketilmeye devam eder: listeden düşerse kalan stoğu 0 sayılır, mal maliyeti şişer; denetim E-04).
   * Kural tek yerde: src/lib/ingredient-usage.ts isCountable (sayım kaydı da onu kullanır)
   */
  const countable = ds.ingredients.filter((i) => isCountable(i, usedInActive.has(i.id))).sort(bySortOrder);
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

  // --- Stok değerleme: ilk giren ilk çıkar (src/lib/calc/fifo.ts, docs/STOK-DEGERLEME.md) ---------------------
  const fifoStart = ds.settings.stokFifoBaslangic ?? null;
  const lotsByIng = new Map<number, Map<string, PurchaseLot[]>>();
  for (const l of ds.purchaseLots ?? []) {
    const byMonth = lotsByIng.get(l.ingredientId) ?? new Map<string, PurchaseLot[]>();
    const m = l.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), l]);
    lotsByIng.set(l.ingredientId, byMonth);
  }
  type FifoCalc = { pool: StockLayer[]; layers: StockLayer[]; uncovered: number; fallbackUnit: number };
  const fifoCache = new Map<string, FifoCalc | null>();
  /**
   * Malzemenin ay sonu katmanları, `from` başlangıç ayıyla (Ayarlar önizlemesi başka bir başlangıcı da sorar).
   * Havuz: bu ayın faturaları en yeniden eskiye + son 12 ayda en son sayıldığı aydan sonraki (boş bırakılmış) ayların
   * faturaları + o sayımın katmanları (tükenmiş parti yeniden sayılmaz); hiç sayılmadıysa son 12 ayın faturaları.
   * O sayım başlangıçtan önceki bir aydaysa (ay sonu fiyatıyla değerlendi) katmanları yerine sayılan miktarın tamamı tek
   * parça, o ayın ay sonu fiyatıyla taşınır: başlangıç ayının açılışı (önceki ayın kapanışı) aynı fiyatta olduğu için
   * hiç tüketilmemiş malın eski fatura fiyatıyla yeniden değerlenmesi mal maliyetine yazılmaz (denetim E-05). `from`
   * null: zincir hiç kesilmez (her ay FIFO). Havuz boşsa (faturası ve taşınan sayımı yok, su) null: ay sonu fiyatı.
   */
  function fifoLayersFrom(month: string, ingredientId: number, from: string | null): FifoCalc | null {
    const key = `${from ?? "-"}|${month}|${ingredientId}`;
    if (fifoCache.has(key)) return fifoCache.get(key)!;
    let out: FifoCalc | null = null;
    const byMonth = lotsByIng.get(ingredientId);
    if (byMonth && ingById.get(ingredientId)?.priceSource !== "water") {
      // Son 12 ay içinde en son sayıldığı ay: aradaki sayılmamış (boş bırakılmış) ayların faturaları + o ayın
      // katmanları. Hiç sayılmadıysa son 12 ayın faturaları.
      const raw: PurchaseLot[] = [];
      let counted: string | null = null;
      for (let i = 1; i <= FIFO_LOOKBACK_MONTHS; i++) {
        const m = shiftMonth(month, -i);
        if (countsByMonth.get(m)?.has(ingredientId)) {
          counted = m;
          break;
        }
        raw.push(...(byMonth.get(m) ?? []));
      }
      const countedLayers = !counted
        ? []
        : from && counted < from
          ? [openingLayer(countInBaseUnit(counted, ingredientId) ?? 0, unitCostAtMonthEnd(ingredientId, counted), counted)]
          : (fifoLayersFrom(counted, ingredientId, from)?.layers ?? []);
      const carried = [...lotPool(raw), ...countedLayers];
      const pool = monthPool(byMonth.get(month) ?? [], carried);
      if (pool.length) {
        const fallbackUnit = unitCostAtMonthEnd(ingredientId, month);
        const { layers, uncovered } = closingLayers(countInBaseUnit(month, ingredientId) ?? 0, pool, fallbackUnit);
        out = { pool, layers, uncovered, fallbackUnit };
      }
    }
    fifoCache.set(key, out);
    return out;
  }
  /** Malzemenin ay sonu katmanları, Ayarlar'daki başlangıç ayıyla (stockSheet'in kullandığı) */
  const fifoLayers = (month: string, ingredientId: number) => fifoLayersFrom(month, ingredientId, fifoStart);

  const stockCache = new Map<string, StockSheet>();
  function stockSheet(month: string): StockSheet {
    let s = stockCache.get(month);
    if (s) return s;
    const useFifo = valuationFor(month, fifoStart) === "fifo";
    const counts = countsByMonth.get(month) ?? new Map<number, { qty: number; factor: number | null }>();
    // Bugünkü liste + o ay sayılmış ama sonradan pasif / "Sayılmaz" yapılmış malzemeler (geçmiş ay değeri korunur)
    const archivedIngs = [...counts.keys()]
      .filter((id) => !countableIds.has(id))
      .map((id) => ingById.get(id))
      .filter((i): i is Ingredient => !!i);
    // Sonradan listeye eklenen kalem (sayımda "Listeye ekle", sayim_yeni_kalemler) eklendiği aydan önceki aylarda, o ay
    // sayılmadıysa çıkmaz: sayımı bitmiş eski ay "kalem kaldı" demesin, yazdırılan listeye girmesin
    const listed = countable.filter((i) => !i.countFrom || i.countFrom <= month || counts.has(i.id));
    const lines = [...listed, ...archivedIngs].sort(bySortOrder);
    const groupMap = new Map<string, StockLine[]>();
    for (const ing of lines) {
      const c = counts.get(ing.id);
      const currentFactor = countFactor(ing.countUnit);
      const factor = c?.factor ?? currentFactor;
      const qty = c ? c.qty : null;
      const fallbackUnit = unitCostAtMonthEnd(ing.id, month);
      const f = useFifo ? fifoLayers(month, ing.id) : null;
      const lastPrice = fallbackUnit * factor;
      const amount = f ? layersValue(f.layers) : (qty ?? 0) * lastPrice;
      // FIFO'da birim fiyat tutar ÷ miktar; sayılmamış ya da 0 satırda ay sonu fiyatı (ekrandaki ve boş sayım
      // formundaki fiyatla aynı)
      const unitPrice = f && qty ? amount / qty : lastPrice;
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
        passiveInUse: !archived && !ing.active,
        unitChanged: !!c && !archived && factor !== currentFactor,
        valuation: f ? "fifo" : "son-fiyat",
        layers: f?.layers ?? [],
        uncoveredQty: f?.uncovered ?? 0,
        pool: f?.pool ?? [],
        fallbackUnit,
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
    const fifoCovered = sum(groups.flatMap((g) => g.lines.flatMap((l) => l.layers.filter(invoiceLayer).map((x) => x.qty * x.unitCost))));
    s = {
      month,
      valuation: useFifo ? "fifo" : "son-fiyat",
      fifoCovered,
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

  /**
   * Ayarlar önizlemesi: ayın sayımı iki yöntemle (ay sonu fiyatı ve `from` başlangıç ayıyla FIFO; varsayılan kayıtlı
   * başlangıç). FIFO tutarı başlangıca bağlıdır: başlangıçtan önceki sayım ay sonu fiyatıyla taşınır (fifoLayersFrom).
   * Ek kalemler ikisinde aynı. `covered` FIFO tutarının faturalardan gelen kısmı.
   */
  function valuationPreview(month: string, from: string | null = fifoStart): { old: number; fifo: number; covered: number } {
    let old = 0;
    let fifo = 0;
    let covered = 0;
    for (const [id, c] of countsByMonth.get(month) ?? []) {
      const ing = ingById.get(id);
      if (!ing) continue;
      const last = c.qty * (unitCostAtMonthEnd(id, month) * (c.factor ?? countFactor(ing.countUnit)));
      old += last;
      const f = fifoLayersFrom(month, id, from);
      if (!f) {
        fifo += last;
        continue;
      }
      fifo += layersValue(f.layers);
      covered += layersValue(f.layers.filter(invoiceLayer));
    }
    const extras = sum((extrasByMonth.get(month) ?? []).map((e) => e.qty * e.unitPrice));
    return { old: old + extras, fifo: fifo + extras, covered };
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
    // Aylık kalemler ve personel bu günle (kasa raporlarından gelen ayda takvim günü; prorationDays)
    const days = prorationDays(info);
    const ratio = days / dim;
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
        sections[fe.section] += auto(key, fixedForMonth(fixedAtMonth(fe, month), st, openDays, dim, days));
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
    sections.komisyon += auto("commission:pos", (revenue ?? 0) * st.komisyon * cardShareOf(month).rate);
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
    // Kasadan geçen hizmet satışı (karaoke odası) %20, ürünler %10: ayın satış listesindeki HİZMET satırları kadarı
    // hizmet KDV oranıyla ayrılır (ay cirosundan büyük olamaz); satış listesi yüklenmemiş ayda bütün ciro satış KDV'siyle
    const serviceRevenue = revenue === null ? 0 : Math.min(Math.max(revenue, 0), monthSales(month).serviceRevenue);
    const revenueNet = revenue === null ? null : (revenue - serviceRevenue) / (1 + st.kdv) + serviceRevenue / (1 + st.kdvHizmet);
    // Online satış: ModPOS cirosuna dokunmadan ayrı gelir satırları (KDV hariç); çekilmemiş ayda hücre yok (boş)
    const site = siteRevenueOf(month);
    if (site) {
      for (const k of ["cafe", "shop", "karaoke"] as const) cells.set(`site:${k}`, { value: site[k], computed: site[k], overridden: false });
    }
    const revenueTotalNet = revenueNet === null && !site ? null : (revenueNet ?? 0) + (site?.total ?? 0);
    pm = {
      month,
      info,
      openDays,
      prorationDays: days,
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
      serviceRevenue,
      revenueNet,
      site,
      revenueTotalNet,
      profit: (revenueTotalNet ?? 0) - expenses,
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
    devir({ key: "stock:closing", label: "SONRAKİ AYA DEVREDEN MAL (ay sonu stok)", kind: "auto", editable: true, hint: "Stok Sayımı sayfasındaki o ayın toplamı (KDV hariç). Ayarlar'daki başlangıç ayından itibaren ilk giren ilk çıkar (FIFO): sayılan miktar en son faturalardan geriye doğru, her parça kendi faturasının fiyatıyla; faturası bulunamayan kısım ay sonu fiyatıyla. Sayım girilmezse 0 olur ve alınan malın tamamı o ayın maliyeti sayılır." });
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
        add({
          key: "personnel:net",
          label: "PERSONEL MAAŞ (net)",
          kind: "auto",
          editable: true,
          hint: "Personel sayfasındaki net maaşlar × (açık gün ÷ ayın gün sayısı). Açık günü kasa raporlarından gelen ayda raporların kapsadığı takvim günüyle: kapalı gün maaşı düşürmez.",
        });
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
    kom({
      key: "commission:pos",
      label: `BANKA POS KOMİSYONU (%${(st.komisyon * 100).toLocaleString("tr-TR")})`,
      kind: "auto",
      editable: true,
      hint: "Aylık ciro (KDV dahil) × komisyon × kartlı satış oranı (kasa raporu olan ayda o ayın oranı, yoksa Ayarlar'daki). Banka ekstresindeki gerçek tutarı yazabilirsiniz.",
    });
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
    const pctOf = (r: number) => `%${(r * 100).toLocaleString("tr-TR")}`;
    sonuc({
      key: "revenue",
      label: "AYLIK CİRO (KDV dahil – POS)",
      kind: "manual",
      editable: true,
      hint: "Patron > Raporlar > Ciro (indirimler düşülmüş, ödenmezler hariç). Satışlar sayfasındaki ay bilgisiyle aynıdır. Boşsa kasa raporlarının Z toplamı kullanılır.",
    });
    sonuc({
      key: "revenueNet",
      label: "AYLIK CİRO (KDV hariç)",
      kind: "total",
      editable: false,
      hint: `AYLIK CİRO'dan ${pctOf(st.kdv)} KDV düşülür; Satışlar'da HİZMET işaretli satırların (karaoke odası) cirosu ${pctOf(st.kdvHizmet)} ile ayrılır (Ayarlar › Oranlar).`,
    });
    // laffogato.net online satışları: yalnız bu aylardan en az biri siteden çekildiyse (çekilmemiş ay boş kalır, 0 değil)
    if (months.some((m) => siteByMonth.has(m))) {
      const from = "laffogato.net'ten çekilir (Gelir-gider › laffogato.net online satışları, her sabah ve Siteden yenile).";
      const vat = (what: string, r: number) => `KDV hariç: net − KDV − oranı bilinmeyen ${what} ${pctOf(r)} KDV'si. Kasadan (ModPOS) geçmez; AYLIK CİRO'ya eklenmez.`;
      sonuc({ key: "site:cafe", label: "KAFE ONLİNE (SİTE + UYGULAMA)", sub: "laffogato.net · KDV hariç", kind: "auto", editable: false, hint: `Uygulama ve web kafe siparişleri (masa, gel-al, kurye), iadeler düşülmüş. Panelden elle girilen siparişler ModPOS'ta olduğu için girmez. ${vat("siparişlerin", st.kdv)} ${from}` });
      sonuc({ key: "site:shop", label: "MAĞAZA (ONLİNE)", sub: "laffogato.net · KDV hariç", kind: "auto", editable: false, hint: `Sitenin mağaza kolileri (kargo ücreti dahil), iadeler düşülmüş. ${vat("siparişlerin", st.kdv)} ${from}` });
      sonuc({ key: "site:karaoke", label: "KARAOKE (ÖN ÖDEMELİ)", sub: "laffogato.net · KDV hariç", kind: "auto", editable: false, hint: `Sitede ödenen karaoke rezervasyonlarının köşkte kalan tutarı, parasının alındığı ayda. ${vat("rezervasyonların", st.kdvHizmet)} ${from}` });
      sonuc({ key: "revenue:total", label: "TOPLAM CİRO (KDV hariç)", kind: "total", editable: false, hint: "ModPOS cirosu + online satışlar (KDV hariç). Kâr / zarar ve oranlar bununla hesaplanır." });
    }
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
    // Oranlar bütün cironun (ModPOS + online) payı; online satış yoksa ModPOS cirosuyla aynı
    const rn = pm.revenueTotalNet;
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
      case "revenue": {
        // Kasa raporlarından gelen ciro hesaplanan değer gibidir: elle yazılan onun üzerine yazılmıştır, boşaltınca kasaya döner
        const info = pm.info;
        return {
          value: pm.revenue,
          computed: info?.kasa?.values.posRevenue ?? null,
          overridden: info?.sources ? info.sources.posRevenue === "manual" : pm.revenue !== null,
        };
      }
      case "revenueNet":
        return v(pm.revenueNet);
      case "revenue:total":
        return v(pm.revenueTotalNet);
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
    /** Yalnız aktif ürünlerin reçeteleri: "hiçbir (aktif) reçetede yok" ve sayım listesi */
    usedInActive,
    monthInfo,
    /** Ayın kartlı satış oranı ve kaynağı (elle, kasa raporlarından ya da Ayarlar) */
    cardShareOf,
    salesMonths,
    monthSales,
    /** Süren ayda yapıştırılan satış listesinin dönemi (kasa raporlarından kısaysa; yoksa null) */
    listPeriod,
    /** Ayın online satışı reçeteye göre (gelir, malzeme, brüt kâr); çekilmemiş ayda null */
    onlineMonth,
    /** Online satışın ürün başına adedi (eşlenen kafe satırları ve seçenek ürünleri) */
    onlineSold,
    soldByProduct,
    ingredientUsage,
    recordedUsage,
    wasteCost,
    wasteSummary,
    /** laffogato.net online satışları: ayın kaydı, ürünlere eşlenen satırlar, tüketim ve KDV hariç gelir */
    siteSales: siteSalesOf,
    siteLines,
    onlineUsage,
    siteRevenue: siteRevenueOf,
    /** Online satışı çekilmiş aylar */
    siteMonths: [...siteByMonth.keys()].sort(),
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
    /** Malzemenin ay sonu FIFO katmanları ve havuzu, Ayarlar'daki başlangıç ayıyla */
    fifoLayers,
    /** Aynısı başka bir başlangıç ayıyla (null: zincir kesilmez) */
    fifoLayersFrom,
    /** Stok değerleme başlangıcı (Ayarlar; null = her ay ay sonu fiyatı) */
    fifoStart,
    valuationPreview,
    /** Sayım girilmiş aylar (sıralı) */
    countedMonths: [...countsByMonth.keys()].sort(),
    /** Sayımın birim fiyatı: ayın sonunda geçerli fiyat (kapanmış ay sonraki zamla değişmez); FIFO'da fallback */
    unitCostAtMonthEnd,
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

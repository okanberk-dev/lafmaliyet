import {
  COMMISSION_CATEGORY,
  FIXED_SECTIONS,
  GOODS_CATEGORIES,
  MANUAL_PNL_ROWS,
  PACKAGING_CATEGORY,
  SEPARATE_CATEGORIES,
} from "../constants";
import { DEFAULT_BRANCH_ID, MONTH_TOTALS_LOCKED_TEXT } from "../branches";
import { listDiscountOf } from "../cash-month";
import { duplicateCellWarn, duplicateExpenses as findDuplicateExpenses, type DuplicateExpense } from "./duplicate-expense";
import { fixedIdOfKey } from "../fixed-expense-rules";
import { channelOf } from "../commission/channels";
import { paidWithholdingRate } from "../tax/rules";
import { money, monthLabel, num, pct, tl } from "../format";
import { isCountable } from "../ingredient-usage";
import { panelWasteCounts } from "../lafpos/ikram";
import { periodKasa } from "../lafpos/kasa";
import { lafposWorkedDays, lafposWorkedUnseen } from "../lafpos/personel";
import { dayRangeTR } from "../lafpos/sales";
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

/** Sürümün tutarları kişiye (net maaş, ek ödemeler, yemek kartı) */
const withVersion = (s: Staff, v: StaffVersion): Staff => ({ ...s, netSalary: v.netSalary, extras: v.extras, mealCard: v.mealCard ?? false, dailyWage: v.dailyWage ?? 0 });

/** Personelin o aydaki net maaşı, ek ödemeleri ve yemek kartı (sürüm varsa sürümden, yoksa tabandan) */
export function staffAt(s: Staff, versions: StaffVersion[] | undefined, month: string): Staff {
  const v = versionAt(versions?.filter((x) => x.staffId === s.id), month);
  return v ? withVersion(s, v) : s;
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
  mealCard: boolean;
  dailyWage: number;
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
    { fromMonth: s.startMonth ?? null, versionId: null, netSalary: s.netSalary, extras: s.extras, mealCard: s.mealCard ?? false, dailyWage: s.dailyWage ?? 0 },
    ...own.map((v) => ({ fromMonth: v.fromMonth, versionId: v.id, netSalary: v.netSalary, extras: v.extras, mealCard: v.mealCard ?? false, dailyWage: v.dailyWage ?? 0 })),
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

/**
 * Yemek kartı işareti "şu aydan itibaren" değişince sonraki sürümlere taşınır (inceleme bulgusu 8). Sürüm maaşın tam
 * anlık görüntüsüdür: önceden girilmiş bir zam sürümü eski işareti taşır ve kart o ayda sessizce düşerdi. `from` ayından
 * sonraki sürümler sırayla, eski işareti (`before`) taşıdıkça yeni işarete (`after`) çevrilir; eski işaretten farklı
 * işaretli ilk sürümde (sahibin o aydaki ayrı kararı) durulur. Döner: güncellenecek sürümler (sıralı)
 */
export function mealCardCarry<V extends { fromMonth: string; mealCard: boolean }>(versions: readonly V[], from: string, before: boolean, after: boolean): V[] {
  if (before === after) return [];
  const out: V[] = [];
  for (const v of [...versions].filter((x) => x.fromMonth > from).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth))) {
    if (v.mealCard !== before) break;
    out.push(v);
  }
  return out;
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
  /** Yemek kartı: Ayarlar'daki günlük tutar × gün (işaretli kişide), brütleştirilmez; işaretsizde 0 */
  mealCard: number;
  /** Yemek kartının günü: Ayarlar'daki gün, verilen çalışılan gün ya da part-time'ın çağrıldığı gün; işaretsizde 0 */
  mealDays: number;
  /** Part-time: günlük ücret × çağrıldığı gün (brütleştirilmez); tam zamanlıda 0 */
  dailyWages: number;
  /** Part-time: Vardiya'da çağrıldığı gün; bağlantısız part-time ve tam zamanlıda null */
  calledDays: number | null;
  /**
   * LafPOS'ta çalıştığı gün (LM-4b; model.lafposMealDaysOf, yalnız biten ay): ayın her sayılan LafPOS günü çalışan
   * listesini taşıyorsa. Tam zamanlıda yemek kartının günü budur (gün oranıyla bir daha oranlanmaz); part-time'da yalnız
   * bilgi (yemek kartı çağrıldığı günle). Bilinmiyorsa null
   */
  lafposDays: number | null;
  total: number;
}

export interface StaffCostOptions {
  /**
   * Yemek kartının günü (Faz 5 kancası, LM-4b): verilirse Ayarlar'daki gün yerine bu (LafPOS'un çalışılan günleri ayın
   * her sayılan gününde geldiğinde). Verilmezse Ayarlar › Yemek kartı günü (26). Part-time'da kullanılmaz
   */
  mealDays?: number;
  /** Part-time: Vardiya'da çağrıldığı gün (model.calledDaysOf); bağlantısızsa null ya da verilmez (tutar tahmin edilmez) */
  calledDays?: number | null;
  /**
   * LafPOS'ta çalıştığı gün (LM-4b, model.lafposMealDaysOf): verilirse tam zamanlının yemek kartı bu günle (mealDays'ten önce);
   * null ya da verilmezse Ayarlar'daki gün. Part-time'da yalnız satıra yazılır
   */
  lafposDays?: number | null;
}

/** Yemek kartı ayda: günlük tutar × gün (işaretsiz kişide 0) */
export function mealCardOf(s: Pick<Staff, "mealCard">, st: Pick<Settings, "mealCardDaily" | "mealCardDays">, days: number = st.mealCardDays): number {
  return s.mealCard ? st.mealCardDaily * days : 0;
}

/** Part-time mı (Faz 5; tür yoksa tam zamanlı) */
export const isPartTime = (s: Pick<Staff, "kind">) => s.kind === "part_time";

/**
 * Kişinin Vardiya anahtarı (Faz 5; src/lib/vardiya.ts): bağlı panel hesabı "u:<id>", hesabı olmayan "n:<ad>"; bağlantı
 * yoksa null (part-time'ın günü bilinmez, tahmin edilmez)
 */
export function staffShiftRef(s: Pick<Staff, "userId" | "personRef">): string | null {
  if (s.userId) return `u:${s.userId}`;
  return s.personRef && /^n:./.test(s.personRef) ? s.personRef : null;
}

/**
 * Kişinin aylık işveren maliyeti (Gelir-gider ve Maaşlar):
 * - tam zamanlı: brüt = net ÷ (1 − işçi kesintileri), işveren SGK + işsizlik brütten; ek ödemeler (yol, prim) ve yemek
 *   kartı brütleştirilmeden eklenir;
 * - part-time (Faz 5): günlük ücret × çağrıldığı gün + yemek kartı × çağrıldığı gün + ek ödeme; SGK brütleştirmesi yok
 *   (günlük ücret işletmenin gün başına maliyetidir). Günü bilinmeyen (bağlantısız) part-time'ın ücreti 0: tahmin yok
 */
export function staffCost(s: Staff, st: Settings, opts: StaffCostOptions = {}): StaffCost {
  if (isPartTime(s)) {
    const calledDays = opts.calledDays ?? null;
    const days = calledDays ?? 0;
    const dailyWages = (s.dailyWage ?? 0) * days;
    const mealCard = mealCardOf(s, st, days);
    return {
      staff: s,
      gross: 0,
      deductions: 0,
      employerSgk: 0,
      employerUnemployment: 0,
      mealCard,
      mealDays: s.mealCard ? days : 0,
      dailyWages,
      calledDays,
      lafposDays: opts.lafposDays ?? null,
      total: dailyWages + mealCard + s.extras,
    };
  }
  const gross = s.netSalary / (1 - st.isciSgk - st.isciIssizlik);
  const deductions = gross * (st.isciSgk + st.isciIssizlik);
  const employerSgk = gross * st.isverenSgk;
  const employerUnemployment = gross * st.isverenIssizlik;
  const lafposDays = opts.lafposDays ?? null;
  const mealDays = s.mealCard ? (lafposDays ?? opts.mealDays ?? st.mealCardDays) : 0;
  const mealCard = mealCardOf(s, st, mealDays);
  return {
    staff: s,
    gross,
    deductions,
    employerSgk,
    employerUnemployment,
    mealCard,
    mealDays,
    dailyWages: 0,
    calledDays: null,
    lafposDays,
    total: gross + employerSgk + employerUnemployment + s.extras + mealCard,
  };
}

export type PersonnelSummary = ReturnType<typeof personnelSummary>;

/**
 * Personel toplamları. `month` verilirse o ayda aralığı tutan personel o ayın maaşıyla (sürümler) sayılır;
 * verilmezse (eski kullanım) yalnızca active bakılır ve taban değerler kullanılır. Net, brüt, kesintiler, işveren
 * payları, ekler ve `mealCard` tam zamanlıların (Gelir-gider'in maaş, maliyet − net ve yemek kartı satırları); part-time
 * kişiler `partTime`'da (ücret, yemek kartı, ek; Faz 5). `total` hepsini içerir. `calledDays`: part-time'ın çağrıldığı
 * gün (model.calledDaysOf; verilmezse bilinmiyor). `lafposDays`: LafPOS'ta çalıştığı gün (model.lafposMealDaysOf, LM-4b;
 * verilmezse ya da null ise yemek kartı Ayarlar'daki günle)
 */
export function personnelSummary(
  staff: Staff[],
  st: Settings,
  month?: string,
  versions?: StaffVersion[],
  calledDays?: (s: Staff) => number | null,
  lafposDays?: (s: Staff) => number | null,
) {
  const list = month === undefined ? staff.filter((s) => s.active) : staff.filter((s) => inRange(s, month)).map((s) => staffAt(s, versions, month));
  const rows = list.map((s) =>
    staffCost(s, st, isPartTime(s) ? { calledDays: calledDays?.(s) ?? null, lafposDays: lafposDays?.(s) ?? null } : { lafposDays: lafposDays?.(s) ?? null }),
  );
  const full = rows.filter((r) => !isPartTime(r.staff));
  const part = rows.filter((r) => isPartTime(r.staff));
  return {
    rows,
    net: sum(full.map((r) => r.staff.netSalary)),
    gross: sum(full.map((r) => r.gross)),
    deductions: sum(full.map((r) => r.deductions)),
    employerSgk: sum(full.map((r) => r.employerSgk)),
    employerUnemployment: sum(full.map((r) => r.employerUnemployment)),
    extras: sum(full.map((r) => r.staff.extras)),
    mealCard: sum(full.map((r) => r.mealCard)),
    /** `mealCard`'ın LafPOS'ta çalıştığı günle sayılan kısmı (LM-4b): Gelir-gider'de gün oranıyla bir daha oranlanmaz */
    mealCardLafpos: sum(full.filter((r) => r.lafposDays !== null).map((r) => r.mealCard)),
    partTime: {
      people: part.length,
      wages: sum(part.map((r) => r.dailyWages)),
      mealCard: sum(part.map((r) => r.mealCard)),
      extras: sum(part.map((r) => r.staff.extras)),
      total: sum(part.map((r) => r.total)),
      /** Vardiya bağlantısı olmayan part-time kişiler: günü bilinmez, ücreti sayılmadı */
      unlinked: part.filter((r) => r.calledDays === null).map((r) => r.staff),
    },
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

/** Kira stopajı oranı (yılın vergi kuralından; 2026: %20) */
export function rentWithholdingRate(month: string): number {
  return paidWithholdingRate("kira", Number(month.slice(0, 4)));
}

/**
 * Resmi kiranın brütü: brüt girildiyse o, net girildiyse net ÷ (1 − stopaj oranı); resmi kira yoksa null. Ev sahibi şirketse
 * (Faz 5) stopaj yoktur: resmi kira yazılı olsa da null
 */
export function officialRentGross(fe: Pick<FixedExpense, "officialAmount" | "officialBasis" | "landlordType">, rate: number): number | null {
  if (fe.landlordType === "sirket") return null;
  const a = fe.officialAmount;
  if (a === null || a === undefined || !(a > 0)) return null;
  return fe.officialBasis === "net" && rate < 1 ? a / (1 - rate) : a;
}

/** Ayrıca girilmiş "Kira stopajı" sabit gideri (Faz 5): resmi kiradan hesaplanan stopajla aynı tutar olabilir */
export function isRentStopajItem(f: Pick<FixedExpense, "name">): boolean {
  return /kira\s*stopaj/.test(f.name.toLocaleLowerCase("tr-TR"));
}

/** Resmi kiranın stopaj hücresinin çift sayım uyarısı */
export const rentStopajTwinText = (name: string) =>
  `"${name}" sabit gideri de sayılıyor: kira stopajı resmi kiradan bu satırda hesaplanır, aynı stopaj iki kez girer. Sabit gideri bitirin (Giderler › Sabit giderler). Tutar kendiliğinden değişmez.`;

/** Kira stopajının çift sayım uyarısının başlığı (Genel bakış) */
export const RENT_STOPAJ_TWIN_TITLE = "Kira stopajı iki kez sayılabilir";

/** Gelir-gider'in kira stopajı satırının anahtarı (kalem başına) */
export const stopajKey = (fixedId: number) => `stopaj:${fixedId}`;

/**
 * Aylık kalemlerin (aylık, haftalık, yıllık sabit giderler ve personel) ayın kaçta kaçına düştüğü gün sayısı. Açık gün
 * elle girildiyse (Excel: açılış ayı Temmuz 23 gün) o gün; kasa raporlarından geliyorsa raporların kapsadığı takvim
 * günü (biten ayda ayın tamamı, süren ayda bugüne kadar). Kapalı bir gün (bayram, raporu hiç girilmemiş gün) kira ve
 * maaşı düşürmez: cirosu zaten 0'dır, gider ise tam ödenir. Günlük kalemler yine açık günle çarpılır.
 *
 * Hiçbir zaman ayın gün sayısını aşmaz: iki şube aynı gün açıkken de oran en çok 1'dir (denetim 13 Kasım KP-X1).
 * `closed`: ay bitti (takvim ayı geçti). Kasadan gelen ay o zaman ayın sonuna kadar sayılır; ayın 1'inde 00:00-05:00
 * arası son günün raporu daha beklenirken (iş günü 05:00'te değişir) personel ve sabit gider bir gün eksik oranlanmaz
 * (HM-10)
 */
export function prorationDays(info: Pick<Month, "month" | "openDays" | "sources" | "kasa"> | undefined, closed = false): number {
  if (!info) return 0;
  const dim = daysInMonth(info.month);
  const open = Math.min(dim, info.openDays ?? 0);
  const till = info.kasa?.till;
  if (info.sources?.openDays !== "kasa" || !till) return open;
  const to = closed ? `${info.month}-${String(dim).padStart(2, "0")}` : till.to;
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${till.from}T00:00:00Z`)) / 86_400_000) + 1;
  return Number.isFinite(span) ? Math.min(dim, Math.max(open, span)) : open;
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
  /** Satır bir menü ürününe bağlı (HİZMET değil); reçetesi boş olsa da (bkz. noRecipe) */
  matched: boolean;
  /**
   * Bağlı ürünün reçetesi boş ya da malzemeleri fiyatsız (maliyeti 0, durumu "Reçete yok"): maliyeti eşleşmeyen satır
   * gibi net × ayın ortalama maliyet oranıyla tahmin edilir ve ortalama orana girmez (denetim E-47). Ürün kâr
   * sıralamalarında olduğu gibi burada da sıfır maliyet sayılmaz: yoksa satırın bütün cirosu kâr görünürdü
   */
  noRecipe: boolean;
  /** Reçeteye göre birim maliyet; eşleşmeyen, HİZMET ve reçetesi boş satırda null (maliyet tahmini ya da yok) */
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
  /** Reçeteli (maliyeti > 0) ürüne bağlı satırların net cirosu ve reçete maliyeti: ortalama maliyet oranının dayanağı */
  matchedNet: number;
  matchedCost: number;
  /** matchedCost ÷ matchedNet: eşleşmeyen, reçetesi boş ve online tahmini satırlara uygulanır */
  avgCostRatio: number;
  unmatched: SalesLineCalc[];
  /** Ürüne bağlı ama ürünün reçetesi boş satırlar (SalesLineCalc.noRecipe); maliyetleri ortalama oranla tahmini */
  noRecipe: SalesLineCalc[];
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
   * Sabit gider ve stopaj satırında: kalem bu ayda geçerlilik aralığının dışında (başlamadı ya da bitti) ya da silinmiş.
   * Elle girilmiş tutar varsa yine de sayılır (overridden = true); yoksa Gelir-gider'de hücre salt okunur
   */
  outOfRange?: boolean;
  /** Bu ayın hesabı nasıl yapıldı (hücrenin ipucuna eklenir), ör. POS komisyonunun kart payı */
  info?: string;
  /** Bu ayda dikkat edilecek bir durum (hücrede görünür), ör. POS komisyonu bir faturayla çift sayılabilir */
  warn?: string;
  /** Değerin altında küçük yazı: hesabın yöntemi, ör. mal maliyetinde "sayım" ya da "reçeteye göre tahmini" */
  tag?: string;
}

/**
 * Gelir-gider'in personel satırı `personnel:employer`: Personel'deki maliyet − net maaş. Yalnız işveren SGK'sı değil,
 * çalışanların kendi SGK + işsizlik kesintisi ve yemek / yol / prim ekleri de içindedir (denetim E-44): bordrodaki
 * işveren payı yazılırsa ödenen kesintiler ve ekler giderden düşerdi. Genel bakış da aynı adı kullanır (insights.ts)
 */
export const PERSONNEL_EXTRA_LABEL = "PERSONEL SGK, KESİNTİLER + EK ÖDEMELER (maliyet − net)";
export const PERSONNEL_EXTRA_HINT =
  "Personel sayfasındaki maliyet − net maaş: çalışanların SGK + işsizlik kesintisi, işveren SGK + işsizlik payı ve yemek / yol / prim ekleri; × (açık gün ÷ ayın gün sayısı), maaş satırı gibi. Yemek kartı kendi satırındadır (PERSONEL YEMEK KARTI). Elle yazacaksanız bordrodaki toplam işveren maliyeti − net maaşlar − yemek kartı (yemek / yol / prim dahil); yalnız işveren payını yazmayın.";

/** Gelir-gider'in işletme geneli payı satırı (Faz 5, sahibin kararı 4; yalnız şube seçiliyken, bilgi) */
export const SHARED_KEY = "shared:total";
export const SHARED_ROW_LABEL = "İŞLETME GENELİ PAYI (bilgi)";
export const SHARED_ROW_HINT =
  "Şubenin kârına girmez; Tümü'de bir kez sayılır. İşletme geneli giderlerin dönemdeki tamamı (bölüştürme değil): şubesi seçilmemiş sabit giderler ve stopajı, şubesi boş harcamalar ve harcamaya bağlı faturalar, Gelir-gider'e elle yazılan tutarlar (su, doğalgaz, harici…), komisyon faturaları. Tümü'nün günüyle oranlanır. Yazmak ya da düzeltmek için soldan Tümü'nü seçin.";

/** İşletme geneli payının bileşimi: en büyük kalemler ("Instagram reklamı 30.000 ₺, SU GİDERİ 2.000 ₺ …") */
export function sharedInfoText(parts: readonly { label: string; amount: number }[]): string {
  if (!parts.length) return "Bu ay işletme geneli gider yok.";
  const top = [...parts].sort((a, b) => b.amount - a.amount);
  const head = top.slice(0, 5).map((x) => `${x.label} ${tl(x.amount)}`);
  return `İşletme geneli: ${head.join(", ")}${top.length > 5 ? ` ve ${top.length - 5} kalem daha` : ""}. Şubenin kârına girmez; Tümü'de bir kez sayılır.`;
}

/** Gelir-gider'in personel yemek kartı satırı (Faz 5; işaretli kişilerin günlük tutar × günü) */
export const MEAL_CARD_KEY = "personnel:meal";
/** Gelir-gider'in part-time satırı (Faz 5; günlük ücret × çağrıldığı gün + ek ödeme) */
export const PART_TIME_KEY = "personnel:parttime";
export const PART_TIME_ROW_LABEL = "PART-TIME (GÜNLÜK ÜCRET)";
export const PART_TIME_HINT =
  "Maaşlar'da part-time kişiler: günlük ücret × Vardiya'da o şubede çağrıldığı gün + ek ödeme (yemek kartı kendi satırında). Günlük ücret işletmenin gün başına maliyetidir, SGK brütleştirmesi yok. Gün oranı uygulanmaz; süren ayda bugüne kadarki vardiyalar (kasa raporlarının son günü, rapor yoksa elle girilen açık gün; ay bilgisi yoksa 0, maaş satırı gibi). Vardiya kişisi bağlı değilse tutar tahmin edilmez, hücre uyarır.";
/** Net maaş dışındaki personel hücreleri (vergi köprüsü bunları maliyet − net ile birlikte sayar) */
export const PERSONNEL_SUB_KEYS: readonly string[] = ["personnel:employer", MEAL_CARD_KEY, PART_TIME_KEY];

/** Part-time hücresinin bileşimi: "Ayşe: 10 gün × 1.500 ₺ + ek 2.000 ₺" */
export function partTimeText(rows: readonly Pick<StaffCost, "staff" | "calledDays" | "dailyWages">[]): string {
  const parts = rows
    .filter((r) => r.calledDays !== null)
    .map((r) => `${r.staff.name}: ${r.calledDays} gün × ${tl(r.staff.dailyWage ?? 0)}${r.staff.extras ? ` + ek ${tl(r.staff.extras)}` : ""}`);
  return parts.length ? `${parts.join(" · ")}. Vardiya'daki çalışma günleri; brütleştirilmez.` : "Vardiya'ya bağlı part-time kişi yok.";
}

/** Bağlantısız part-time uyarısı (hücre ve Maaşlar) */
export function partTimeUnlinkedText(people: readonly Pick<Staff, "name">[]): string {
  return `${people.map((p) => p.name).join(", ")}: Vardiya kişisi bağlı değil, çağrıldığı gün bilinmiyor; günlük ücret sayılmadı (tahmin yok). Maaşlar'da Vardiya bağlantısını seçin.`;
}
export const MEAL_CARD_ROW_LABEL = "PERSONEL YEMEK KARTI";
export const MEAL_CARD_HINT =
  "Maaşlar'da yemek kartı işaretli kişiler: günlük tutar × ayda gün (Ayarlar › Personel yemek kartı, 330 ₺ × 26); brütleştirilmez, SGK'ya girmez. × (açık gün ÷ ayın gün sayısı), maaş satırı gibi; biten ayın her LafPOS günü çalışanlarıyla geldiyse gün LafPOS'ta çalıştığı gündür, oranlanmaz. İşletme geneli \"Personel yemeği\" sabit gideri de varsa aynı yemek iki kez sayılabilir (Genel bakış uyarır).";

/**
 * Yemek kartı hücresinin bu ayki bileşimi: "2 kişi × 330 ₺ × 26 gün = 17.160 ₺" (gün oranıyla). LafPOS'ta çalıştığı
 * günle sayılan kişiler (LM-4b) adıyla ve günüyle yazılır; onların payı oranlanmaz (`ratio` yalnız ötekilere)
 */
export function mealCardText(
  rows: readonly (Pick<StaffCost, "mealCard" | "mealDays"> & Partial<Pick<StaffCost, "lafposDays">> & { staff?: Pick<Staff, "name" | "kind"> })[],
  st: Pick<Settings, "mealCardDaily">,
  ratio: number,
  days: number,
  dim: number,
): string {
  const flagged = rows.filter((r) => r.mealCard > 0);
  const isLafpos = (r: (typeof flagged)[number]) => r.lafposDays != null && r.staff?.kind !== "part_time";
  // Oran yalnız varsayılan günle sayılanlara: baş onların toplamı, LafPOS'lular ayrı (hücre değeri = baş × oran + LafPOS)
  const rest = flagged.filter((r) => !isLafpos(r));
  const fromLafpos = flagged.filter(isLafpos);
  const parts: string[] = [];
  if (rest.length || !fromLafpos.length) {
    const total = sum(rest.map((r) => r.mealCard));
    const dayCounts = [...new Set(rest.map((r) => r.mealDays))];
    const head =
      dayCounts.length === 1
        ? `${rest.length} kişi × ${tl(st.mealCardDaily)} × ${dayCounts[0]} gün = ${tl(total)}`
        : `${rest.length} kişi, günlük ${tl(st.mealCardDaily)}: ${tl(total)}`;
    parts.push(`${head}${Math.abs(ratio - 1) > 1e-9 ? ` × ${days} / ${dim} gün` : ""}`);
  }
  if (fromLafpos.length) {
    const who = fromLafpos.map((r) => `${r.staff?.name ?? "kişi"} ${r.lafposDays} gün`).join(", ");
    parts.push(`LafPOS'ta çalıştığı günle (oranlanmaz): ${who} = ${tl(sum(fromLafpos.map((r) => r.mealCard)))}`);
  }
  return `Yemek kartı ${parts.join("; ")}; brütleştirilmez.`;
}

/** `personnel:employer` hücresinin bu ayki bileşimi (gün oranıyla; parçaların toplamı hücrenin hesaplanan değeri) */
export function personnelExtraText(
  p: Pick<PersonnelSummary, "deductions" | "employerSgk" | "employerUnemployment" | "extras">,
  ratio: number,
  days: number,
  dim: number,
): string {
  const parts = [
    `çalışanların SGK + işsizlik kesintisi ${tl(p.deductions * ratio)}`,
    `işveren SGK + işsizlik ${tl((p.employerSgk + p.employerUnemployment) * ratio)}`,
    `yemek / yol / prim ${tl(p.extras * ratio)}`,
  ];
  return `Bu ay${Math.abs(ratio - 1) > 1e-9 ? ` (${days} / ${dim} gün)` : ""}: ${parts.join(", ")}.`;
}

/** Banka POS komisyonunun bir şubesi (posCommission): kasa kartı varsa kart × oran, yoksa ciro × oran × banka kartı payı */
export interface PosCommissionPart {
  branchId: string | null;
  /** Kasa raporlarındaki banka kartı (KDV dahil, yemek kartı hariç); kasa kartı uygulanmıyorsa null */
  card: number | null;
  rate: number;
  amount: number;
}

/** Ayın banka POS komisyonu (Gelir-gider ve Satışlar aynı tutar) ve şube şube kırılımı */
export interface PosCommission {
  amount: number;
  parts: PosCommissionPart[];
}

/** Kuruşa yuvarlama (yarım kuruş yukarı; kayan nokta 495,485'i 495,48 yapmasın) */
const kurus = (v: number) => Math.round(v * 100 + 1e-7) / 100;

/** Oran: %2, %1,5 */
const ratePct = (r: number) => `%${num(r * 100, 2)}`;

/** Satışlar'ın ve Genel bakış'ın komisyon satırı açıklaması (kasa kartı olan ay, liste kasa raporlarına yetişmiş) */
export const POS_COMMISSION_SAME_NOTE =
  "Banka POS komisyonu Gelir-gider'deki tutarın aynısıdır: şube şube kasa raporlarındaki banka kartı (yemek kartı hariç) × şubenin POS oranı (Şubeler), satırlara ciro payıyla dağıtılır. Yemek kartlarının komisyonu kendi faturalarıyla sayılır.";

/**
 * Satışlar'ın banka POS komisyonu (model.salesPosCommission): aynı kural (şube şube kart × oran), satış listesinin
 * dönemiyle. Ay bitince ya da liste kasa raporlarına yetişince Gelir-gider'in tutarıdır (`period` null); süren ayda liste
 * kasa raporlarından kısaysa (listPeriod) listenin günlerinin kartıyla: satırlar o günlerin satışıdır, Genel bakış'ın
 * reçeteye göre kârı da o dönemle hesaplanır
 */
export interface SalesPosCommission {
  /** Satışlar'ın tutarı (satırlara ciro payıyla) */
  amount: number;
  /** Gelir-gider'in tutarı (posCommission: ayın bugüne kadarki kasa raporları) */
  month: PosCommission;
  /** Tutar yalnız listenin günleri içinse o dönem; null: ayın tamamı, Gelir-gider'le aynı */
  period: { from: string; through: string } | null;
}

/** Satışlar'ın ve Genel bakış'ın komisyon satırı açıklaması: listenin dönemiyle sayıldıysa neden Gelir-gider'den farklı */
export function posCommissionNote(spc: SalesPosCommission): string {
  if (!spc.period) return POS_COMMISSION_SAME_NOTE;
  return `Banka POS komisyonu satış listesinin günleri (${dayRangeTR(spc.period.from, spc.period.through)}) için: o günlerin kasa raporlarındaki banka kartı (yemek kartı hariç) × şubenin POS oranı, satırlara ciro payıyla dağıtılır. Gelir-gider ayın bugüne kadarki bütün kasa raporlarıyla sayar (${money(spc.month.amount)}); liste kasa raporlarına yetişince iki tutar aynı olur. Yemek kartlarının komisyonu kendi faturalarıyla sayılır.`;
}

/** Banka POS komisyonunun kısa açıklaması: "Marina kart 24.774,25 ₺ × %2 = 495,49 ₺" */
export function posCommissionText(pc: PosCommission, nameOf: (id: string | null) => string | null = (id) => id): string {
  const parts = pc.parts.map((p) => {
    const name = nameOf(p.branchId);
    const who = name ? `${name} ` : "";
    return p.card !== null
      ? `${who}kart ${money(p.card)} × ${ratePct(p.rate)} = ${money(p.amount)}`
      : `${who}ciro × ${ratePct(p.rate)} × banka kartı payı = ${money(p.amount)} (kasa kartı yok)`;
  });
  return `Banka POS komisyonu, yemek kartı hariç: ${parts.join("; ")}.`;
}

/** POS komisyonu hücresinin bu ayki kart payı: nereden ve yemek kartı hariç mi (bankShareOf) */
export function bankShareText(b: { rate: number; source: "manual" | "kasa" | "ayar"; split: boolean; meal: number | null }): string {
  const p = (r: number) => pct(r);
  if (b.split && b.source === "kasa") return `Kart payı ${p(b.rate)}: kasa raporlarından kart ÷ Z toplamı${b.meal ? ` (yemek kartı ${p(b.meal)} hariç)` : ""}.`;
  if (b.split) return `Kart payı ${p(b.rate)}: elle yazılan kartlı orandan kasa raporlarındaki yemek kartı payı (${p(b.meal ?? 0)}) düşüldü.`;
  if (b.source === "manual") return `Kartlı satış oranı ${p(b.rate)} (elle yazılan; kasa raporu yok, yemek kartı payı ayrılamadı).`;
  return `Kartlı satış oranı ${p(b.rate)} (Ayarlar; bu ay kasa raporu yok, yemek kartı payı ayrılamadı).`;
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

/** Her ay girilen bir harcama kategorisinin bir ayın başabaşına ve tahminine giren tutarı (model.monthlyExpensePlan) */
export interface MonthlyExpensePlan {
  cat: ExpenseCategory;
  /** Girilen harcamalar + bağlı fatura kategorisindeki faturalar (Aylık harcamalar'daki satırın tutarı) */
  amount: number;
  /** Bunun girilen harcamalardan gelen kısmı (ödenen tutar) */
  entries: number;
  /**
   * Nakit karşılığı: girilen harcamalar + bağlı faturaların ödenecek tutarı (KDV dahil; nakit planı bunu yayar). Bağlı
   * fatura yoksa `entries`
   */
  cash: number;
  /** Ayın kendi tutarı (taşınan tutarda "bu ay girilmedi" mi "daha az girildi" mi; E-13) */
  entered: number;
  /** entered: ayın kendi girişi; carried: önceki bir ayın (geçen ay ya da süren ay) tutarı taşındı */
  source: "entered" | "carried";
  /** Tutarın alındığı ay */
  from: string;
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
  /** Açılış ve kapanış: sayım ya da sayımsız ayda tahmini devir (stockFlow); mal maliyeti = açılış + alınan − kapanış */
  opening: number;
  closing: number;
  cogs: number;
  /** Mal maliyetinin yöntemi ve açıklaması; bu aydan sonraki ya da verisi olmayan ayda null */
  cogsMethod: CogsMethod | null;
  cogsInfo: string | null;
  /** Yalnız sayımla açılış ve kapanış (sayım yoksa 0; elle yazılan geçer): vergi hesabı bunu kullanır */
  countOpening: number;
  countClosing: number;
  /** Resmi kirası olan kalemler: bu aya düşen resmi brüt kira (kiranın gün payıyla) ve stopaj hücresinin değeri */
  officialRent: { id: number; gross: number; stopaj: number }[];
  sections: Record<FixedSection | "komisyon", number>;
  /**
   * İşletme geneli giderler (Faz 5, sahibin kararı 4): şubesi boş sabit gider ve stopajı, silinmiş kalemin elle girişi,
   * elle hücreler, şubesi boş harcama ve harcamaya bağlı faturalar, komisyon faturaları. "Tümü"de bölümlerinin içinde
   * (bir kez); tek şube seçiliyken bölümlere ve kâra girmez, "İşletme geneli payı (bilgi)" satırıdır. `keys`: tamamı
   * işletme geneli olan hücreler (harcama hücresi şubede şubenin kendi kaydıdır, işletme geneli kısmı `parts`'ta)
   */
  shared: { total: number; parts: { key: string; label: string; amount: number }[]; keys: ReadonlySet<string> };
  /**
   * Şubeye yazılan giderler, şube kimliği başına (Faz 5; Tümü'nün şube kırılımı, src/lib/branch-breakdown.ts): şubesi
   * seçilmiş sabit gider ve stopajı, şubesi seçilmiş harcama kaydı (mal dışı), kişinin şubesine göre personel. Fiziksel
   * olmayan kanala (online) yazılan gider kırılımda kendi sütununda görünür. Elle yazılmış personel hücresi bölünmez
   */
  byBranch: Readonly<Record<string, number>>;
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

/**
 * Mal maliyetinin yöntemi (Gelir-gider'in ay sütununda): "sayim" açılış + alınan − ay sonu sayımı; "dagitim" sayım
 * aralığına reçeteye göre tüketim oranında dağıtıldı (tahmini); "tahmin" kapanışı henüz bilinmeyen ay, reçeteye göre;
 * "sube" tek şube seçili: faturalar ve stok devri işletme geneli olduğundan şubenin satışından reçeteye göre
 */
export type CogsMethod = "sayim" | "dagitim" | "tahmin" | "sube";

export const COGS_METHOD_LABELS: Record<CogsMethod, string> = {
  sayim: "sayım",
  dagitim: "sayım aralığına dağıtıldı (tahmini)",
  tahmin: "reçeteye göre tahmini",
  sube: "şubenin satışından reçeteye göre",
};

/**
 * Sayımı olmayan ayın mal maliyeti nasıl hesaplandı (uyarı metinleri; küçük harfle başlar, sonda nokta yok). Yöntem yoksa
 * (hiç sayım yok) eski kural: kapanış 0
 */
export function uncountedCogsText(method: CogsMethod | null): string {
  if (method === "sube") return "mal maliyeti şubenin satışından reçeteye göre (faturalar ve stok devri işletme genelinde)";
  if (method === "dagitim") return "mal maliyeti sayım aralığına reçeteye göre tüketim oranında dağıtıldı (tahmini)";
  if (method === "tahmin") return "mal maliyeti reçeteye göre tahmini; ay sonu sayımı girilince gerçek hesaba döner";
  return "kapanış stoğu 0 sayıldı, alınan malın tamamı maliyet";
}

/** Sayımı olmayan aylar yöntemlerine göre: "Temmuz 2026, Ağustos 2026: mal maliyeti … ; Kasım 2026: mal maliyeti …" */
export function uncountedCogsSummary(methodOf: (month: string) => CogsMethod | null, months: readonly string[]): string {
  const groups = new Map<CogsMethod | null, string[]>();
  for (const m of months) {
    const k = methodOf(m) === "sayim" ? null : methodOf(m);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups].map(([k, ms]) => `${ms.map(monthLabel).join(", ")}: ${uncountedCogsText(k)}`).join("; ");
}

/** Ayın reçeteye göre mal tüketimi (KDV hariç; engine.ts cogsConsumption) */
export interface CogsConsumption {
  /** "recipe": satış listesi / online; "revenue": liste yok, ciro × maliyet oranı; "none": ikisi de yok */
  basis: "recipe" | "revenue" | "none";
  /** Satışlar'daki malzeme + ambalaj (ürün fire payı dahil) */
  material: number;
  /** Ürün fire payı çıkarılmış tüketim */
  fireFree: number;
  fireRate: number;
  /** fireFree × (1 + genel fire) */
  recipe: number;
  /** Ödenmezlerin tahmini malzeme maliyeti */
  offCost: number;
  /** recipe + offCost: açık ayın tahmini maliyeti ve aralık dağıtımının ağırlığı */
  total: number;
}

/** Ayın stok akışı (engine.ts stockFlow) */
export interface StockFlow {
  opening: number;
  closing: number;
  cogs: number;
  /** Bu aydan sonraki ya da verisi olmayan ayda null (eski kural: sayım ya da 0) */
  method: CogsMethod | null;
  /** Kapanış sayım değil, tahmini devir */
  estimatedClosing: boolean;
  /** Hesabın açıklaması (Gelir-gider hücresinin ipucu) */
  info: string | null;
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
 * reçete maliyeti; eşlenmeyen kafe satırları, reçetesi boş ürüne eşlenenler ve mağaza kolileri (kargo hariç) KDV hariç
 * tutar × ayın ortalama maliyet oranı (ModPOS'ta eşleşmeyen ve reçetesi boş satırın kuralı). Karaokenin malzemesi yok;
 * online ödemenin komisyonu faturasıyla Gelir-gider'de (reçeteye göre görünümde yok).
 */
export interface OnlineMonthCalc {
  month: string;
  revenue: SiteMonthRevenue;
  /** Reçeteli ürüne eşlenen satırların ve seçeneklerin reçete maliyeti */
  mappedCost: number;
  /**
   * Ortalama maliyet oranıyla tahmin edilen kısmın dayanağı (KDV hariç) ve maliyeti: eşlenmeyen kafe satırları,
   * reçetesi boş ürüne eşlenen satırlar ve seçenekler (noRecipe), mağaza kolileri
   */
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
  /**
   * Reçetesi boş (maliyeti 0) ürüne eşlenen online satış: ürün, adet ve tahminin dayanağı (KDV hariç; satırın liste
   * tutarı, seçenekte ürünün menü fiyatı). estimatedBase'in içinde (denetim E-47)
   */
  noRecipe: { productId: number; qty: number; base: number }[];
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
  /** Faturanın bölündüğü su + buz litresi: satış listesi (ModPOS / LafPOS) ve laffogato.net online siparişleri */
  liters: number;
  /** liters'ın online siparişlerden gelen kısmı (reçeteye göre; denetim E-57) */
  onlineLiters: number;
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
  base: { netSalary: number; extras: number; mealCard: boolean; dailyWage: number };
  history: StaffHistoryEntry[];
  cost: StaffCost;
  /**
   * Gösterilen ayda LafPOS'ta çalıştığı gün (LM-4b; model.lafposDaysOf; süren ayda bugüne kadar). Yemek kartının günü
   * `cost.lafposDays`'tir (yalnız biten ayda); bu yalnız bilgi. Bilinmiyorsa null
   */
  lafposDays: number | null;
  /** Ay biliniyor ama kişinin kimliği ayın LafPOS günlerinde hiç yok (bağlı değil ya da eski satıra bağlı; model.lafposUnseenOf) */
  lafposUnseen: boolean;
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
  /** "Tümü"nün ay bilgisi (şube seçiliyken; işletme geneli kalemin günü, Faz 5): yoksa boş */
  const companyInfo = new Map((ds.companyMonths ?? []).map((m) => [m.month, m]));
  /**
   * Ayın kartlı satış oranı: elle yazılan ya da o ayın kasa raporlarından (kart + yemek kartı ÷ Z toplamı); yoksa
   * Ayarlar › kartlı satış oranı. POS komisyonu bununla hesaplanır; ürün fiyatı hesabı Ayarlar'daki oranla kalır.
   */
  function cardShareOf(month: string): { rate: number; source: "manual" | "kasa" | "ayar" } {
    return cardShareOfInfo(monthInfo.get(month));
  }
  function cardShareOfInfo(info: Month | undefined): { rate: number; source: "manual" | "kasa" | "ayar" } {
    const v = info?.cardShare ?? null;
    if (v === null) return { rate: st.kartOrani, source: "ayar" };
    return { rate: v, source: info?.sources?.cardShare === "kasa" ? "kasa" : "manual" };
  }
  /**
   * Banka POS komisyonunun kart payı (Gelir-gider `commission:pos`; denetim E-43, vergi planı K12a): yalnız banka kartı.
   * Yemek kartlarının komisyonu kendi faturalarıyla (Pluxee, Multinet …) Komisyon giderlerinde zaten sayılır; kartlı
   * satış oranı (kart + yemek kartı) kullanılsaydı yemek kartı satışına bir de banka oranı uygulanırdı.
   * - Ayın kasa raporu varsa: kart ÷ Z toplamı. Kartlı oran elle yazıldıysa ondan kasa raporlarındaki yemek kartı payı
   *   düşülür (elle yazılan oran yemek kartını da içerir).
   * - Yoksa kartlı satış oranı (elle ya da Ayarlar'daki): yemek kartı payı ayrılamaz (`split: false`).
   * `meal`: düşülen yemek kartı payı (ayrılamadıysa null)
   */
  function bankShareOf(month: string): { rate: number; source: "manual" | "kasa" | "ayar"; split: boolean; meal: number | null } {
    return bankShareOfInfo(monthInfo.get(month));
  }
  function bankShareOfInfo(info: Month | undefined): { rate: number; source: "manual" | "kasa" | "ayar"; split: boolean; meal: number | null } {
    const base = cardShareOfInfo(info);
    const till = info?.kasa?.till;
    const bank = till?.bankShare ?? null;
    if (!till || bank === null || base.source === "ayar") return { ...base, split: false, meal: null };
    const meal = Math.max(0, Math.round(((till.cardShare ?? bank) - bank) * 10_000) / 10_000);
    if (base.source === "kasa") return { rate: bank, source: "kasa", split: true, meal };
    return { rate: Math.max(0, Math.round((base.rate - meal) * 10_000) / 10_000), source: "manual", split: true, meal };
  }
  /**
   * Şubenin banka POS oranı (Şubeler › POS oranı; sahibin kararı 23 Kasım 2026: iki şube %2). Kütükte olmayan şube
   * (testler, Excel verisi) Ayarlar'daki eski genel oranla (`komisyon`)
   */
  const branchRateById = new Map((ds.branchRates ?? []).map((b) => [b.id, b]));
  const posRateOf = (branchId: string | null): number => (branchId !== null ? branchRateById.get(branchId)?.posRate : undefined) ?? st.komisyon;
  /**
   * Ayın kasadan gelen banka kartı (yemek kartı hariç): ciro kasadan geliyor ve kartlı oran elle yazılmamışsa; yoksa null
   * (elle yazılan ciro ya da oran geçerlidir: o ay eski formülle)
   */
  const kasaCardOf = (m: Month): number | null =>
    m.sources?.posRevenue === "kasa" && m.sources.cardShare !== "manual" && typeof m.kasa?.till.card === "number" ? m.kasa.till.card : null;
  /**
   * Banka POS komisyonu, tek fonksiyon (hesap sözleşmesi §10; 23 Kasım 2026): Σ şube (banka kartı × şubenin POS oranı).
   * Yemek kartının komisyonu kendi faturasıyla (Komisyon giderleri), banka kartına girmez. Gelir-gider'in
   * `commission:pos` hücresi bu tutardır, Satışlar onu satırlara ciro payıyla dağıtır: iki sayfa aynı rakamı gösterir.
   * "Tümü"de şube şube (Month.byBranch); şubenin kasa kartı yoksa (elle yazılmış ciro) o şube ciro × oran × banka kartı
   * payıyla. Ayın hiçbir şubesinde kasa kartı yoksa null: eski formüller (Satışlar satır × komisyon × kartlı oran,
   * Gelir-gider ciro × komisyon × banka kartı payı; Excel'in değerleri, tests/calc.test.ts)
   */
  function posCommission(month: string): PosCommission | null {
    const info = monthInfo.get(month);
    if (!info) return null;
    const entries: [string | null, Month][] = info.byBranch ? Object.entries(info.byBranch) : [[ds.branchView?.id ?? null, info]];
    if (!entries.some(([, m]) => kasaCardOf(m) !== null)) return null;
    const parts = entries.flatMap(([branchId, m]): PosCommissionPart[] => {
      const rate = posRateOf(branchId);
      const card = kasaCardOf(m);
      if (card !== null) return [{ branchId, card, rate, amount: kurus(card * rate) }];
      if (!((m.posRevenue ?? 0) > 0)) return [];
      return [{ branchId, card: null, rate, amount: kurus((m.posRevenue ?? 0) * rate * bankShareOfInfo(m).rate) }];
    });
    return { amount: kurus(parts.reduce((a, p) => a + p.amount, 0)), parts };
  }
  /** Şubenin adı (komisyonun açıklaması); kütükte yoksa kimliği */
  const branchNameOf = (id: string | null) => (id === null ? null : (branchRateById.get(id)?.name ?? (ds.branchView?.id === id ? ds.branchView.name : id)));

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
  /** Satış satırlarının ürün başına adedi (ürünü bulunan satırlar) */
  function soldOfLines(lines: readonly SalesLine[]): Map<number, number> {
    const m = new Map<number, number>();
    for (const l of lines) {
      if (l.productId && productById.has(l.productId)) {
        m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
      }
    }
    return m;
  }
  const soldCache = new Map<string, Map<number, number>>();
  function soldByProduct(month: string): Map<number, number> {
    let m = soldCache.get(month);
    if (!m) {
      m = soldOfLines(linesByMonth.get(month) ?? []);
      soldCache.set(month, m);
    }
    return m;
  }

  /** Ürün başına adetlerin reçeteye göre harcadığı malzeme (fire hariç), malzemenin kendi biriminde */
  function usageOfSold(sold: ReadonlyMap<number, number>): Map<number, number> {
    const u = new Map<number, number>();
    for (const [pid, qty] of sold) {
      for (const it of itemsByProduct.get(pid) ?? []) {
        u.set(it.ingredientId, (u.get(it.ingredientId) ?? 0) + evalQty(it).qty * qty);
      }
    }
    return u;
  }

  /** Reçeteye göre bir ayda harcanan malzeme (fire hariç), malzemenin kendi biriminde */
  const usageCache = new Map<string, Map<number, number>>();
  function ingredientUsage(month: string): Map<number, number> {
    let u = usageCache.get(month);
    if (!u) {
      u = usageOfSold(soldByProduct(month));
      usageCache.set(month, u);
    }
    return u;
  }

  // --- Zayi ve ikram (personelin kaydı; geçiş gününden itibaren LafPOS'un ikramı ve zayisi) ----------
  // LafPOS'un gün sonu gelen günde ürün ikramı LafPOS'tan sayılır, paneldeki o günkü ürün ikramı sayılmaz (her gün tek
  // kaynak; src/lib/lafpos/ikram.ts). LafPOS'un "Zayi: …" satırı zayi olarak girer (kendi türüyle). Geçiş günü yoksa
  // lafposIkram yok: kayıtlar bugünkü gibi yalnız panelden
  const lafposIkramDays = new Set(ds.lafposIkram?.days ?? []);
  const countedWaste: WasteEntry[] = [
    ...(ds.wasteEntries ?? []).filter((w) => panelWasteCounts(w, lafposIkramDays, ds.lafposBranch)),
    ...(ds.lafposIkram?.lines ?? []).map(
      (l): WasteEntry => ({
        date: l.date,
        kind: l.kind,
        productId: l.productId,
        ingredientId: null,
        qty: l.qty,
        factor: 1,
        source: "lafpos",
        name: l.posName,
        menuValue: l.menuValue,
        // Hazırlanmış iptal: zayi tüketimi, ödenmez tutarında yok (recordedOffRevenue onu saymaz)
        ...(l.iptal ? { iptal: true } : {}),
      }),
    ),
  ];
  const wasteByMonth = new Map<string, WasteEntry[]>();
  for (const w of countedWaste) {
    const m = w.date.slice(0, 7);
    const list = wasteByMonth.get(m);
    if (list) list.push(w);
    else wasteByMonth.set(m, [w]);
  }
  /** Ayın sayılmayan panel kayıtları: LafPOS'un gün sonu gelen günde girilmiş ürün ikramı */
  const notCountedOf = (month: string) => (ds.wasteEntries ?? []).filter((w) => w.date.slice(0, 7) === month && !panelWasteCounts(w, lafposIkramDays, ds.lafposBranch)).length;
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
      // İndirim kasadan geliyorsa listenin günlerine kadarki; elle yazıldıysa ayın yazılan tutarı. İkisinde de yalnız
      // ModPOS listesi günlerininki: LafPOS'un satırları indirimden sonradır (listDiscounts)
      discounts:
        info.sources.discounts === "kasa"
          ? Math.max(0, Math.round(((c.till.discounts ?? 0) - (c.till.lafposDiscounts ?? 0)) * 100) / 100)
          : listDiscounts(month),
      days: Math.max(1, days),
    };
  }

  /**
   * Ayın satış listesinden düşülecek indirim (hesap sözleşmesi §11; −90 ₺ hatası, 23 Kasım 2026): ModPOS listesi
   * indirimden öncedir, LafPOS'un satırları indirimden sonra; LafPOS günlerinin indirimi satırlardan bir daha düşülmez.
   * Geçiş günü yoksa ayın indirimi (Month.discounts)
   */
  function listDiscounts(month: string): number {
    return listDiscountOf(monthInfo.get(month), ds.lafposSales?.countFrom ?? null, ds.lafposBranch);
  }

  /** Ayın "aynı gider iki kez" bulguları (pnlMonth'un hesabından; duplicate-expense.ts) */
  function duplicateExpenses(month: string): DuplicateExpense[] {
    pnlMonth(month);
    return duplicateCache.get(month) ?? [];
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
  /** Online kafe satırlarının ürünlere eşlenmesi (menü bağlantısı) ve seçenekleri */
  function siteLinesOf(month: SiteSalesMonth | undefined): SiteLinesCalc {
    const lines = month?.cafe.lines ?? [];
    const { mapped, unmapped } = mapSiteLines(lines, siteIndex);
    const totals = optionTotals(lines);
    const c: SiteLinesCalc = {
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
    return c;
  }
  const siteLinesCache = new Map<string, SiteLinesCalc>();
  function siteLines(month: string): SiteLinesCalc {
    let c = siteLinesCache.get(month);
    if (!c) {
      c = siteLinesOf(siteByMonth.get(month));
      siteLinesCache.set(month, c);
    }
    return c;
  }
  /** Online satışın ürün başına adedi: eşlenen kafe satırları ve ürünü olan seçenekler (Extra Shot gibi) */
  function soldOfSite(c: SiteLinesCalc): Map<number, number> {
    const sold = new Map<number, number>();
    for (const { line, product } of c.mapped) sold.set(product.id, (sold.get(product.id) ?? 0) + line.qty);
    for (const o of c.options) if (o.product) sold.set(o.product.id, (sold.get(o.product.id) ?? 0) + o.qty);
    return sold;
  }
  function onlineSold(month: string): Map<number, number> {
    return soldOfSite(siteLines(month));
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
      u = usageOfSold(onlineSold(month));
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
  // Fatura kafede harcanan bütün suyu kapsar: litreye aynı ayın laffogato.net / uygulama siparişlerinin su ve buzu da
  // girer (denetim E-57; LafPOS'un satırları satış listesinin içinde). Ay yine satış listesiyle seçilir: listesi
  // yüklenmemiş ayın faturası yalnız online litreye bölünürse litre fiyatı katlarca şişerdi.
  // Fatura işletmenindir (manual:su her şubede): tek şube seçiliyken litre de bütün şubelerin ve laffogato.net'in
  // satışından (ds.waterSales; denetim 21 Kasım #4). Şubenin litresine bölünseydi ürün maliyeti şubeye göre değişirdi.
  const waterIngredients = ds.ingredients.filter((i) => i.priceSource === "water");
  const waterLiters = (usage: ReadonlyMap<number, number>) => sum(waterIngredients.map((i) => usage.get(i.id) ?? 0)) / 1000;
  const companyLines = new Map<string, SalesLine[]>();
  for (const l of ds.waterSales?.salesLines ?? []) {
    const list = companyLines.get(l.month);
    if (list) list.push(l);
    else companyLines.set(l.month, [l]);
  }
  const companySite = new Map((ds.waterSales?.siteSales ?? []).map((r) => [r.month, r]));
  const waterUsageCache = new Map<string, { list: Map<number, number>; online: Map<number, number> }>();
  /**
   * Su faturasının bölündüğü ayın reçeteye göre tüketimi: `list` satış listesinin (ModPOS / LafPOS), `online`
   * laffogato.net siparişlerinin. "Tümü"de ingredientUsage / onlineUsage; tek şube seçiliyken işletme genelinin
   * satışından (ds.waterSales). Hammaddeler'in su dökümü de bunu kullanır, kart ile döküm aynı litreyi gösterir.
   */
  function waterUsage(month: string): { list: Map<number, number>; online: Map<number, number> } {
    if (!ds.waterSales) return { list: ingredientUsage(month), online: onlineUsage(month) };
    let u = waterUsageCache.get(month);
    if (!u) {
      u = { list: usageOfSold(soldOfLines(companyLines.get(month) ?? [])), online: usageOfSold(soldOfSite(siteLinesOf(companySite.get(month)))) };
      waterUsageCache.set(month, u);
    }
    return u;
  }
  function computeWater(): WaterCost {
    if (st.suBirimLTOverride !== null && st.suBirimLTOverride !== undefined) {
      return { perLiter: st.suBirimLTOverride, month: null, bill: 0, liters: 0, onlineLiters: 0, reason: "override", latestBillMonth: null };
    }
    const candidates = [...pnlByMonth.entries()]
      .filter(([, rows]) => (rows.get("manual:su") ?? 0) > 0)
      .map(([m]) => m)
      .sort()
      .reverse();
    const latestBillMonth = candidates[0] ?? null;
    for (const m of candidates) {
      const usage = waterUsage(m);
      const listLiters = waterLiters(usage.list);
      if (listLiters > 0) {
        const onlineLiters = waterLiters(usage.online);
        const liters = listLiters + onlineLiters;
        const bill = pnlByMonth.get(m)!.get("manual:su")!;
        return { perLiter: bill / liters, month: m, bill, liters, onlineLiters, reason: "ok", latestBillMonth };
      }
    }
    return { perLiter: 0, month: null, bill: 0, liters: 0, onlineLiters: 0, reason: latestBillMonth ? "no-usage" : "no-bill", latestBillMonth };
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

  /**
   * `ikram.lafpos` / `zayi.lafpos`: LafPOS'tan gelen ikram ve zayi satırı sayısı (count'un içinde; ikramın menü değeri
   * LafPOS'unki); `notCounted`: LafPOS'un gün sonu gelen günde panele girilmiş, sayılmayan ürün ikramı kaydı. Geçiş günü
   * yoksa hepsi 0
   */
  function wasteSummary(month: string) {
    const out = { zayi: { count: 0, cost: 0, lafpos: 0 }, ikram: { count: 0, cost: 0, menuValue: 0, lafpos: 0 }, notCounted: notCountedOf(month) };
    for (const w of wasteByMonth.get(month) ?? []) {
      const product = w.productId !== null ? productById.get(w.productId) : undefined;
      const cost = wasteCost(w);
      out[w.kind].count += 1;
      out[w.kind].cost += cost;
      if (w.source === "lafpos") out[w.kind].lafpos += 1;
      // İkramın menü değeri: LafPOS'unki kendi hesabıyla, panelinki menü fiyatıyla (zayinin menü değeri yok)
      if (w.kind === "ikram" && w.source === "lafpos") out.ikram.menuValue += w.menuValue ?? 0;
      else if (w.kind === "ikram" && product) out.ikram.menuValue += product.price * w.qty;
    }
    return out;
  }

  /**
   * Satışlar'ın banka POS komisyonu (SalesPosCommission; posCommission'ın kuralı): süren ayda liste kasa raporlarından
   * kısaysa (listPeriod) listenin günlerinin kartıyla, şube şube oranla, `period` o dönem (Gelir-gider'in tutarından farklı
   * olabilir; metin posCommissionNote); değilse Gelir-gider'in tutarı. Kasa kartı olmayan ayda null (eski formül)
   */
  function salesPosCommission(month: string): SalesPosCommission | null {
    const pc = posCommission(month);
    if (!pc) return null;
    const lp = listPeriod(month);
    const t = lp ? coverageByMonth.get(month)?.till : null;
    if (!lp || !t || typeof t.card !== "number") return { amount: pc.amount, month: pc, period: null };
    const amount = t.cardByBranch
      ? kurus(Object.entries(t.cardByBranch).reduce((a, [b, card]) => a + kurus(card * posRateOf(b)), 0))
      : kurus(t.card * posRateOf(ds.branchView?.id ?? null));
    return { amount, month: pc, period: { from: lp.from, through: lp.through } };
  }

  // --- Aylık satış analizi (Satış Raporu) ------------------------------------
  const salesCache = new Map<string, MonthSales>();
  function monthSales(month: string): MonthSales {
    let ms = salesCache.get(month);
    if (ms) return ms;
    const raw = linesByMonth.get(month) ?? [];
    const cardShare = cardShareOf(month).rate;
    // Banka POS komisyonu Gelir-gider'in kuralıyla (salesPosCommission: ay bitince aynı tutar, süren ayda liste kısaysa
    // listenin günleriyle), satırlara ciro payıyla; kasa kartı olmayan ayda eski formül (satır cirosu × komisyon × kartlı
    // oran; Excel)
    const pos = salesPosCommission(month)?.amount ?? null;
    const listRevenue = raw.reduce((a, l) => a + l.revenue, 0);
    const base = raw.map((line) => {
      const product = line.productId ? productById.get(line.productId) : undefined;
      const pc = product ? computeProduct(product) : undefined;
      // Hizmet satışı (karaoke odası) kendi KDV oranıyla; ürünler satış KDV'siyle
      const net = line.revenue / (1 + (line.isService ? st.kdvHizmet : st.kdv));
      const commission = pos === null ? line.revenue * st.komisyon * cardShare : listRevenue > 0 ? (pos * line.revenue) / listRevenue : 0;
      return { line, pc, net, commission };
    });
    // Ortalama maliyet oranı yalnız reçeteli ürünlerden: reçetesi boş ürünün maliyeti 0 sayılırsa oranı düşürür, o
    // düşük oran da eşleşmeyen ve online satırlara uygulanırdı (denetim E-47)
    const costed = base.filter((b) => b.pc && !b.line.isService && b.pc.cost > 0);
    const matchedNet = sum(costed.map((b) => b.net));
    const matchedCost = sum(costed.map((b) => b.line.qty * b.pc!.cost));
    const avgCostRatio = safeDiv(matchedCost, matchedNet);
    const lines: SalesLineCalc[] = base.map(({ line, pc, net, commission }) => {
      const isMatched = !!pc && !line.isService;
      const noRecipe = isMatched && !(pc!.cost > 0);
      const cost = line.isService ? 0 : isMatched && !noRecipe ? line.qty * pc!.cost : net * avgCostRatio;
      const grossProfit = net - cost - commission;
      return {
        line,
        product: pc,
        matched: isMatched,
        noRecipe,
        unitCost: isMatched && !noRecipe ? pc!.cost : null,
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
      noRecipe: lines.filter((l) => l.noRecipe),
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
      const lines = siteLines(month);
      let mappedCost = 0;
      let mappedQty = 0;
      // Reçetesi boş ürün sıfır maliyet sayılmaz: satırı eşlenmemiş gibi ortalama oranla maliyetlenir (denetim E-47)
      const noRecipeBase = new Map<number, number>();
      for (const [productId, qty] of soldBy) {
        const product = productById.get(productId);
        if (!product) continue;
        const pc = computeProduct(product);
        if (pc.cost > 0) mappedCost += qty * pc.cost;
        else noRecipeBase.set(productId, 0);
        mappedQty += qty;
      }
      // Dayanak: satırın liste tutarı (eşlenmeyen satırınki gibi), seçenekte ürünün menü fiyatı (satırın tutarı yok)
      for (const { line, product } of lines.mapped) {
        if (noRecipeBase.has(product.id)) noRecipeBase.set(product.id, noRecipeBase.get(product.id)! + line.listMinor / 100 / (1 + st.kdv));
      }
      for (const o of lines.options) {
        if (o.product && noRecipeBase.has(o.product.id)) noRecipeBase.set(o.product.id, noRecipeBase.get(o.product.id)! + o.qty * computeProduct(o.product).net);
      }
      const noRecipe = [...noRecipeBase].map(([productId, base]) => ({ productId, qty: soldBy.get(productId) ?? 0, base }));
      // Eşlenmeyen kafe satırları liste fiyatıyla, mağaza kolileri kargo ücreti (taşıma hizmeti, hizmet KDV'si) düşülerek
      const unmappedNet = sum(lines.unmapped.map((l) => l.listMinor)) / 100 / (1 + st.kdv);
      const shopGoods = Math.max(0, revenue.shop - r.shop.deliveryMinor / 100 / (1 + st.kdvHizmet));
      // Ayın satış listesi yoksa (süren ay, liste ay sonunda) son satış ayının oranı
      const ratioMonth = linesByMonth.has(month) ? month : (salesMonths.filter((m) => m <= month).at(-1) ?? salesMonths[0]);
      const avgCostRatio = ratioMonth ? monthSales(ratioMonth).avgCostRatio : 0;
      const estimatedBase = unmappedNet + shopGoods + sum(noRecipe.map((x) => x.base));
      const estimatedCost = estimatedBase * avgCostRatio;
      const material = mappedCost + estimatedCost;
      out = {
        month,
        revenue,
        mappedCost,
        estimatedBase,
        estimatedCost,
        avgCostRatio,
        material,
        grossProfit: revenue.total - material,
        mappedQty,
        soldByProduct: soldBy,
        noRecipe,
      };
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
  /** Personelin o aydaki maaşı (net, ek ödemeler, yemek kartı) */
  function staffAtMonth(x: Staff, month: string): Staff {
    const v = versionAt(staffVersions.get(x.id), month);
    return v ? withVersion(x, v) : x;
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

  // Vardiya'nın çalışma günleri (Faz 5): şube + kişi anahtarı + ay → günler (sıralı)
  const shiftDaysByKey = new Map<string, string[]>();
  for (const d of ds.shifts ?? []) {
    const k = `${d.branchId}|${d.personRef}|${d.date.slice(0, 7)}`;
    const list = shiftDaysByKey.get(k) ?? [];
    list.push(d.date);
    shiftDaysByKey.set(k, list);
  }
  for (const list of shiftDaysByKey.values()) list.sort();
  /**
   * Part-time kişinin aydaki çağrıldığı gün (Faz 5): Vardiya'da kişinin anahtarıyla (staffShiftRef), kendi şubesindeki
   * çalışma günleri. Bağlantısızsa null (tahmin yok). Gelir-gider (planned yok): süren ayda bugüne kadar
   * (calledDaysCutoff; ileri günlerin planı sayılmaz, maaş satırının gün oranı gibi); `planned` (vergi bordrosu, nakit
   * planı): ayın bütün planı
   */
  function calledDaysOf(x: Pick<Staff, "userId" | "personRef" | "branchId">, month: string, opts: { planned?: boolean } = {}): number | null {
    const ref = staffShiftRef(x);
    if (!ref) return null;
    const branchId = x.branchId ?? DEFAULT_BRANCH_ID;
    const days = shiftDaysByKey.get(`${branchId}|${ref}|${month}`) ?? [];
    if (opts.planned || month !== currentMonth) return days.length;
    const to = calledDaysCutoff(month, branchId);
    return days.filter((d) => d <= to).length;
  }
  /**
   * Süren ayda Gelir-gider'in saydığı son vardiya günü (inceleme bulgusu LM-4 2. tur, 2): maaş satırının gün oranıyla aynı
   * kaynak (prorationDays). Kasa raporları varsa son raporun günü; yoksa elle girilen açık gün kadar (ayın başından); ay
   * bilgisi yoksa hiç ("-00": maaş satırı gibi 0). "Tümü"de kişinin şubesinin ay bilgisi (varsa; branchDays gibi): raporu
   * geride kalan şubenin günleri öteki şubenin raporlarıyla sayılmaz
   */
  function calledDaysCutoff(month: string, branchId: string): string {
    const all = monthInfo.get(month);
    const info = (!ds.branchView ? all?.byBranch?.[branchId] : undefined) ?? all;
    const to = info?.kasa?.till.to;
    if (to) return to;
    return `${month}-${String(prorationDays(info)).padStart(2, "0")}`;
  }
  /**
   * Hesabıyla bağlı part-time kişinin, o ay maaş satırı olmayan bir şubedeki çalışma günleri (inceleme bulgusu LM-4 2. tur,
   * 1): başka şubedeki vardiya o şubenin satırına aittir; o şubede kişiye bağlı satır yoksa günler hiçbir yere girmez.
   * Uyarı içindir (personnel.ts parttime-other-branch), tutar değişmez. Yalnız seçili kapsamdaki vardiyalar görülür
   * ("Tümü"de hepsi). Hesabı olmayan ad (n:) şube başınadır: başka şubedeki aynı ad başka kişi sayılır
   */
  function strayPartTimeShifts(month: string): { staff: Staff; branchId: string; branchName: string; days: number }[] {
    const rowsOf = ds.staff.filter((x) => inRange(x, month));
    const linked = new Set(rowsOf.flatMap((x) => (staffShiftRef(x) ? [`${x.branchId ?? DEFAULT_BRANCH_ID}|${staffShiftRef(x)}`] : [])));
    const out: { staff: Staff; branchId: string; branchName: string; days: number }[] = [];
    const seen = new Set<string>();
    for (const x of rowsOf) {
      const ref = staffShiftRef(x);
      if (!ref?.startsWith("u:") || !isPartTime(staffAtMonth(x, month))) continue;
      for (const [key, days] of shiftDaysByKey) {
        const [branchId, r, m] = key.split("|");
        if (r !== ref || m !== month || linked.has(`${branchId}|${ref}`) || seen.has(`${branchId}|${ref}`)) continue;
        seen.add(`${branchId}|${ref}`);
        out.push({ staff: x, branchId, branchName: branchNameOf(branchId) ?? branchId, days: days.length });
      }
    }
    return out;
  }

  /**
   * Kişinin ayda LafPOS'ta çalıştığı gün (LM-4b; src/lib/lafpos/personel.ts lafposWorkedDays): LafPOS'un şubesinde, ayın
   * tamamı LafPOS döneminde, ayın her sayılan günü çalışan listesini taşıyor ve kişinin kimliği en az bir günde geçiyorsa;
   * yoksa null. Süren ayda bugüne kadar gelen gün sonları (bilgi; Maaşlar gösterir)
   */
  function lafposDaysOf(x: Pick<Staff, "id" | "branchId">, month: string): number | null {
    return lafposWorkedDays(ds.lafposWorked, x, month);
  }
  /**
   * Yemek kartının LafPOS günü: yalnız biten ayda lafposDaysOf; süren ve ileri ayda null (Ayarlar'daki gün). Süren ayın
   * aylık / standart rakamları (başa baş, sabit gider standardı, Maaşlar'ın "Size maliyeti") bugüne kadar gelen günle
   * küçülmesin. Gelir-gider, Maaşlar, Excel ve vergi bordrosu bunu okur
   */
  function lafposMealDaysOf(x: Pick<Staff, "id" | "branchId">, month: string): number | null {
    return month < currentMonth ? lafposDaysOf(x, month) : null;
  }
  /** Ay biliniyor ama kişinin kimliği ayın LafPOS günlerinde hiç yok (src/lib/lafpos/personel.ts lafposWorkedUnseen) */
  function lafposUnseenOf(x: Pick<Staff, "id" | "branchId">, month: string): boolean {
    return lafposWorkedUnseen(ds.lafposWorked, x, month);
  }

  const personnelCache = new Map<string, PersonnelSummary>();
  /** O ayda çalışan personel, o ayın maaşıyla (part-time: Vardiya'da çağrıldığı günle; yemek kartı LafPOS'un günüyle) */
  function personnelFor(month: string): PersonnelSummary {
    let p = personnelCache.get(month);
    if (!p) {
      p = personnelSummary(
        ds.staff,
        st,
        month,
        ds.staffVersions,
        (x) => calledDaysOf(x, month),
        (x) => lafposMealDaysOf(x, month),
      );
      personnelCache.set(month, p);
    }
    return p;
  }

  /** Kalem şube seçiliyken işletme geneli mi (şubesi boş; Faz 5, sahibin kararı 4): şubenin kârına ve başabaşına girmez */
  const sharedInView = (f: Pick<FixedExpense, "branchId">) => Boolean(ds.branchView) && (f.branchId ?? null) === null;
  /**
   * O ayda şubenin hesabına giren sabit giderler: "Tümü"de hepsi, şube seçiliyken işletme geneli kalemler hariç
   * (Gelir-gider'in bölümleri gibi; başabaş, "Excel temeli", Analiz ve Sabit giderler'in özeti bunlarla)
   */
  function fixedOwnInMonth(month: string): FixedExpense[] {
    return ds.branchView ? fixedInMonth(month).filter((f) => !sharedInView(f)) : fixedInMonth(month);
  }
  /**
   * Standart bir ayın sabit gider toplamı (personel dahil), o ayın kalemleri ve tutarlarıyla (Excel SabitGiderToplam).
   * Şube seçiliyken işletme geneli kalemler girmez (sahibin kararı 4, inceleme bulgusu 3): şubenin "Excel temeli" net
   * kârı ve başabaşı kârın temeliyle aynı kalemlerden; dışarıda kalan fixedStandardSharedFor
   */
  function fixedStandardTotalFor(month: string): number {
    return personnelFor(month).total + sum(fixedOwnInMonth(month).map((f) => fixedMonthly(f, st) + rentStopajMonthly(f, month)));
  }
  /** Şube seçiliyken standart sabit gidere girmeyen işletme geneli kalemlerin toplamı (stopajıyla; bilgi). "Tümü"de 0 */
  function fixedStandardSharedFor(month: string): number {
    return sum(fixedInMonth(month).filter(sharedInView).map((f) => fixedMonthly(f, st) + rentStopajMonthly(f, month)));
  }

  /** Kalemin aylık kira stopajı (resmi brüt × kira stopajı oranı; resmi kirası yoksa 0): standart sabit gidere dahil */
  function rentStopajMonthly(f: FixedExpense, month: string): number {
    const rate = rentWithholdingRate(month);
    const gross = officialRentGross(f, rate);
    return gross === null ? 0 : gross * rate;
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
      base: { netSalary: x.netSalary, extras: x.extras, mealCard: x.mealCard ?? false, dailyWage: x.dailyWage ?? 0 },
      history,
      cost: staffCost(
        cur,
        st,
        isPartTime(cur) ? { calledDays: calledDaysOf(cur, valueMonth), lafposDays: lafposMealDaysOf(cur, valueMonth) } : { lafposDays: lafposMealDaysOf(cur, valueMonth) },
      ),
      lafposDays: lafposDaysOf(cur, valueMonth),
      lafposUnseen: lafposUnseenOf(cur, valueMonth),
      inRangeNow: inRange(x, currentMonth),
      status: rangeStatus(x, currentMonth),
      valueMonth,
      nextChange: history.find((h) => h.versionId !== null && h.fromMonth! > valueMonth) ?? null,
    };
  });

  // --- Stok sayımı -------------------------------------------------------------
  // Sayım şube başınadır (docs/SUBE.md): "Tümü"de aynı ayın aynı malzemesi her şubeden bir satır gelir ve işletmenin
  // stoğu toplamıdır. Çarpanlar farklıysa (birimi sayımlar arasında değişmiş) ilk satırın birimine çevrilerek toplanır
  const countsByMonth = new Map<string, Map<number, { qty: number; factor: number | null }>>();
  // Ayın malzemesini sayan şubeler: iki ayın sayımı aynı şubelerden değilse karşılaştırılamaz (tutarlılık)
  const countBranchesByMonth = new Map<string, Map<number, Set<string>>>();
  for (const c of ds.stockCounts) {
    const bm = countBranchesByMonth.get(c.month) ?? new Map<number, Set<string>>();
    bm.set(c.ingredientId, (bm.get(c.ingredientId) ?? new Set<string>()).add(c.branchId ?? ""));
    countBranchesByMonth.set(c.month, bm);
    const m = countsByMonth.get(c.month) ?? new Map<number, { qty: number; factor: number | null }>();
    const prev = m.get(c.ingredientId);
    const factor = c.factor ?? null;
    if (!prev) m.set(c.ingredientId, { qty: c.qty, factor });
    else if (prev.factor === factor) m.set(c.ingredientId, { qty: prev.qty + c.qty, factor });
    else {
      const unit = countFactor(ingById.get(c.ingredientId)?.countUnit ?? null);
      const base = prev.qty * (prev.factor ?? unit) + c.qty * (factor ?? unit);
      const into = prev.factor ?? unit;
      m.set(c.ingredientId, { qty: into ? base / into : base, factor: into });
    }
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
  /**
   * İki ayın sayımı aynı şubelerden mi (tutarlılığın açılışı ile kapanışı karşılaştırılabilir mi): "Tümü"de bir ay yalnız
   * Tuzla, sonraki ay Tuzla + Marina saydıysa açılış Tuzla, kapanış iki şube olur ve fark tüketim değildir. İkisinden
   * biri sayılmamışsa false
   */
  function sameCountBranches(monthA: string, monthB: string, ingredientId: number): boolean {
    const a = countBranchesByMonth.get(monthA)?.get(ingredientId);
    const b = countBranchesByMonth.get(monthB)?.get(ingredientId);
    return Boolean(a && b && a.size === b.size && [...a].every((x) => b.has(x)));
  }

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
   * null: zincir hiç kesilmez (her ay FIFO). Havuz boşsa (faturası yok, su) ya da yalnız taşınan parçadan oluşuyorsa
   * (bu ayda ve aradaki aylarda fatura yok) null: ay sonu fiyatı. Karar yalnız pencerenin içindeki veriden: pencere
   * dışındaki bir fatura kapanmış ayın değerini değiştirmez.
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
      const opening = !!counted && !!from && counted < from;
      const countedLayers = !counted
        ? []
        : opening
          ? [openingLayer(countInBaseUnit(counted, ingredientId) ?? 0, unitCostAtMonthEnd(ingredientId, counted), counted)]
          : (fifoLayersFrom(counted, ingredientId, from)?.layers ?? []);
      const carried = [...lotPool(raw), ...countedLayers];
      const pool = monthPool(byMonth.get(month) ?? [], carried);
      // Taşınan açılış tek başına havuz kurmaz: bu ayda ve aradaki boş aylarda faturası yoksa malzeme faturasız
      // malzeme gibi ay sonu fiyatıyla değerlenir. Yoksa kapanmış bir ayın değeri, malzemenin pencere dışındaki (ör.
      // sonraki bir aydaki) ilk faturası ya da Paraşüt bağlantısı gelince değişirdi (inceleme B02-D2)
      const invoiceInWindow = raw.length > 0 || (byMonth.get(month)?.length ?? 0) > 0;
      if (pool.length && (!opening || invoiceInWindow)) {
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
  // Faz 5: harcamanın şubenin kendi kaydı (şube seçiliyken) ve işletme geneli (şubesi boş) kısmı, ay ve kategori başına
  const expenseOwnByMonth = new Map<string, Map<number, number>>();
  const expenseSharedByMonth = new Map<string, Map<number, number>>();
  const addTo = (map: Map<string, Map<number, number>>, m: string, cat: number, v: number) => {
    const byCat = map.get(m) ?? new Map<number, number>();
    byCat.set(cat, (byCat.get(cat) ?? 0) + v);
    map.set(m, byCat);
  };
  // Şubesi seçilmiş kayıtlar şube başına (ay|kategori → şube → tutar): Tümü'nün şube kırılımı (PnlMonthCalc.byBranch)
  const expenseByBranch = new Map<string, Map<string, number>>();
  for (const e of ds.expenseEntries ?? []) {
    const m = monthOfDate(e.date);
    addTo(expenseByMonth, m, e.categoryId, e.amount);
    addTo((e.branchId ?? null) === null ? expenseSharedByMonth : expenseOwnByMonth, m, e.categoryId, e.amount);
    if (e.branchId) {
      const k = `${m}|${e.categoryId}`;
      const byB = expenseByBranch.get(k) ?? new Map<string, number>();
      byB.set(e.branchId, (byB.get(e.branchId) ?? 0) + e.amount);
      expenseByBranch.set(k, byB);
    }
  }
  /** Ayın harcama kayıtları (aynı gider iki kez: duplicateExpenses) */
  const expenseEntriesByMonth = new Map<string, NonNullable<Dataset["expenseEntries"]>>();
  for (const e of ds.expenseEntries ?? []) {
    const m = monthOfDate(e.date);
    const list = expenseEntriesByMonth.get(m) ?? [];
    list.push(e);
    expenseEntriesByMonth.set(m, list);
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
  /**
   * Kategorilerin aydaki tutarı: girilen harcamalar + bağlı fatura kategorisindeki faturalar (KDV hariç, iskonto
   * düşülmüş). `invoicesOwn`: şubesi seçilmiş faturalar (şube seçiliyken o şubenin; docs/SUBE.md › Faturanın şubesi),
   * `invoicesShared`: işletme geneli olanlar; `invoicesByBranch` "Tümü"nün şube kırılımı için
   */
  function expenseAmounts(month: string): {
    cat: ExpenseCategory;
    entries: number;
    invoices: number;
    invoicesOwn: number;
    invoicesShared: number;
    invoicesByBranch: Map<string, number>;
    invoicesPayable: number;
    total: number;
  }[] {
    const invs = invoicesByMonth.get(month) ?? [];
    return expenseCats.map((cat) => {
      const entries = expenseByMonth.get(month)?.get(cat.id) ?? 0;
      const linked = invoiceCategoryMappable(cat.invoiceCategory) ? invs.filter((i) => i.category === cat.invoiceCategory) : [];
      const invoices = sum(linked.map(invoiceNet));
      const invoicesByBranch = new Map<string, number>();
      let invoicesOwn = 0;
      for (const i of linked) {
        if (!i.branchId) continue;
        invoicesOwn += invoiceNet(i);
        invoicesByBranch.set(i.branchId, (invoicesByBranch.get(i.branchId) ?? 0) + invoiceNet(i));
      }
      // Ödenecek tutar (KDV dahil); Excel'den gelen ödenecek tutarı boş faturada KDV hariç tutar
      const invoicesPayable = sum(linked.map((i) => (i.payable > 0 ? i.payable : invoiceNet(i))));
      return { cat, entries, invoices, invoicesOwn, invoicesShared: invoices - invoicesOwn, invoicesByBranch, invoicesPayable, total: entries + invoices };
    });
  }

  /**
   * Her ay girilen harcamaların (Aylık harcamalar'da "her ay girilir", mal dışı kategori: reklam, influencer…) bir ayın
   * hesabına giren tutarı (denetim E-13). Sabit gider "aylık girişe çevrilince" başabaştan, ay sonu tahmininden ve
   * nakit planından düşmesin diye bunlar Excel temeline (fixedStandardTotalFor) ek olarak sayılır:
   * - biten ay: o ayın girilen tutarı;
   * - süren ve gelecek ay: geçen aydan o aya kadarki ayların en büyüğü (süren ay girildiyse ve daha büyükse o; değilse
   *   geçen ayın gerçekleşeni taşınır). Pasif kategori yalnız kendi ayının tutarıyla.
   * Sahibe soru 7 (geçen ayın gerçekleşeni mi, son 3 ay ortalaması mı) cevaplanana kadar geçerli kural.
   * `entries`: tutarın girilen harcamalardan gelen kısmı; `cash`: nakit planının yaydığı ödeme (bağlı faturalar KDV dahil)
   */
  function monthlyExpensePlan(month: string): MonthlyExpensePlan[] {
    const cats = expenseCats.filter((c) => c.monthly && c.section !== "mal");
    if (!cats.length) return [];
    // Şube seçiliyken şubenin kendi kayıtları ve faturaları: şubesi boş kayıtlar ve işletme geneli faturalar dışarıda
    // (Gelir-gider'in harcama hücresi gibi; inceleme bulgusu 3, docs/SUBE.md › Faturanın şubesi). Ödenecek tutar
    // faturaların payıyla
    const amountsOf = (m: string) =>
      new Map(
        expenseAmounts(m).map((x) => {
          if (!ds.branchView) return [x.cat.id, x];
          const own = expenseOwnByMonth.get(m)?.get(x.cat.id) ?? 0;
          const payable = x.invoices ? x.invoicesPayable * (x.invoicesOwn / x.invoices) : 0;
          return [x.cat.id, { ...x, entries: own, invoices: x.invoicesOwn, invoicesPayable: payable, total: own + x.invoicesOwn }];
        }),
      );
    const own = amountsOf(month);
    const out: MonthlyExpensePlan[] = [];
    const window: string[] = [];
    if (month >= currentMonth) for (let m = shiftMonth(currentMonth, -1); m <= month; m = shiftMonth(m, 1)) window.push(m);
    const byMonth = new Map(window.map((m) => [m, m === month ? own : amountsOf(m)]));
    for (const cat of cats) {
      const mine = own.get(cat.id);
      const entered = mine?.total ?? 0;
      let best = { from: month, total: entered, entries: mine?.entries ?? 0, cash: (mine?.entries ?? 0) + (mine?.invoicesPayable ?? 0) };
      if (cat.active && month >= currentMonth) {
        for (const m of window) {
          const x = byMonth.get(m)?.get(cat.id);
          // Eşitlikte ayın kendisi (girilen tutar), sonra en yakın ay
          if (x && x.total > best.total + 0.005) best = { from: m, total: x.total, entries: x.entries, cash: x.entries + x.invoicesPayable };
        }
      }
      if (!(best.total > 0.005)) continue;
      out.push({ cat, amount: best.total, entries: best.entries, cash: best.cash, entered, source: best.from === month ? "entered" : "carried", from: best.from });
    }
    return out;
  }

  const closedByMonth = new Map<string, string[]>();
  for (const d of ds.closedDays ?? []) {
    const m = d.slice(0, 7);
    closedByMonth.set(m, [...(closedByMonth.get(m) ?? []), d]);
  }
  /** Ayın kafe kapalı işaretli günleri (raporsuz; ileri tarihliler dahil): ay sonu öngörüsü bunları açık saymaz (E-41) */
  const closedDaysOf = (month: string): string[] => closedByMonth.get(month) ?? [];

  /**
   * Başabaşın ve ay sonu tahmininin sabit gideri: standart aylık sabit gider (Excel temeli, personel dahil) + her ay
   * girilen harcamalar (monthlyExpensePlan). Genel bakış, Sabit giderler, Analiz ve Ayarlar aynı toplamı kullanır
   */
  function breakEvenFixedFor(month: string): number {
    return fixedStandardTotalFor(month) + sum(monthlyExpensePlan(month).map((x) => x.amount));
  }

  // --- Genel Maliyet (aylık gelir-gider) --------------------------------------
  function closingStock(month: string): { value: number; computed: number; overridden: boolean } {
    const computed = stockSheet(month).total;
    const ov = pnlByMonth.get(month)?.get("stock:closing");
    return ov !== undefined ? { value: ov, computed, overridden: true } : { value: computed, computed, overridden: false };
  }

  // --- Mal maliyeti: sayım aralığına dağıtım ve sayımsız ayın tahmini (docs/STOK-DEGERLEME.md › Mal maliyeti) -------
  /** Ayın alınan malı (Gelir-gider'in "ALINAN MAL"ı): mal faturaları + elle "diğer mal" + mal bölümündeki harcamalar */
  function goodsInTotal(month: string): number {
    const manualOther = pnlByMonth.get(month)?.get("manual:diger_mal") ?? 0;
    const expenses = sum(expenseAmounts(month).filter((x) => x.cat.section === "mal").map((x) => x.total));
    return goodsPurchases(month) + manualOther + expenses;
  }

  /**
   * Ayın kapanışı biliniyor mu: Gelir-gider'de elle yazılan devreden mal, o ayın sayımı ya da sonraki ayın elle yazılan
   * "Önceki aydan devir"i (bir sonraki ayın açılışı bu ayın kapanışıdır). Biliniyorsa değeri, yoksa null
   */
  function knownClosing(month: string): number | null {
    const ov = pnlByMonth.get(month)?.get("stock:closing");
    if (ov !== undefined) return ov;
    if (countsByMonth.has(month)) return stockSheet(month).total;
    const nextOpening = pnlByMonth.get(shiftMonth(month, 1))?.get("stock:opening");
    return nextOpening ?? null;
  }

  const consumptionCache = new Map<string, CogsConsumption>();
  /**
   * Ayın reçeteye göre mal tüketimi (KDV hariç), fire bir kez: ürün maliyetindeki ürün fire payı çıkarılır
   * (ingredientTotal ÷ maliyet oranıyla, eşleşen reçeteli satırlardan), genel fire oranı (Ayarlar, %5) bütün tüketime
   * eklenir. Malzeme + ambalaj Satışlar'daki gibi (ModPOS satış listesi + laffogato.net online). Satış listesi ve online
   * yoksa ciroya göre: KDV hariç ciro × son satış ayının maliyet oranı. Ödenmezlerin tahmini malzeme maliyeti Tutarlılık'taki
   * gibi: ödenmez ÷ (1 + KDV) × ortalama maliyet oranı (ayın listesi yoksa son satış ayınınki).
   */
  function cogsConsumption(month: string): CogsConsumption {
    const hit = consumptionCache.get(month);
    if (hit) return hit;
    const sales = monthSales(month);
    const online = onlineMonth(month);
    // Oranın ayı: ayın listesi, yoksa son satış ayı (öncesinde yoksa ilk satış ayı; onlineMonth'taki gibi)
    const ratioMonth = sales.lines.length ? month : (salesMonths.filter((m) => m <= month).at(-1) ?? salesMonths[0] ?? null);
    const ref = ratioMonth ? monthSales(ratioMonth) : null;
    // Ürün fire payının dışındaki oran: eşleşen reçeteli satırların malzeme toplamı ÷ maliyeti
    let ing = 0;
    let cost = 0;
    for (const l of ref?.lines ?? []) {
      if (!l.product || l.noRecipe || !l.matched || !(l.product.cost > 0)) continue;
      ing += l.line.qty * l.product.ingredientTotal;
      cost += l.line.qty * l.product.cost;
    }
    const fireFreeRatio = cost > 0 ? ing / cost : 1 / (1 + st.fire);
    let basis: CogsConsumption["basis"] = "recipe";
    let material = sales.cost + (online?.material ?? 0);
    if (!sales.lines.length && !online) {
      const info = monthInfo.get(month);
      const revenue = info?.posRevenue ?? null;
      material = revenue && ref ? (revenue / (1 + st.kdv)) * ref.avgCostRatio : 0;
      basis = material > 0 ? "revenue" : "none";
    }
    const fireFree = material * fireFreeRatio;
    const recipe = fireFree * (1 + st.fire);
    const offRevenue = monthInfo.get(month)?.offRevenue ?? 0;
    const offCost = ref ? (offRevenue / (1 + st.kdv)) * ref.avgCostRatio : 0;
    const out: CogsConsumption = { basis, material, fireFree, fireRate: st.fire, recipe, offCost, total: recipe + offCost };
    consumptionCache.set(month, out);
    return out;
  }

  let anyKnownClosing: boolean | null = null;
  /** Bu aya kadar en az bir ayın kapanışı biliniyor (sayım ya da Gelir-gider'de elle yazılan devir) */
  function hasKnownClosing(): boolean {
    if (anyKnownClosing === null) {
      anyKnownClosing = [...countsByMonth.keys(), ...[...pnlByMonth].filter(([, m]) => m.has("stock:closing") || m.has("stock:opening")).map(([k]) => k)].some(
        (m) => m <= shiftMonth(currentMonth, 1),
      );
    }
    return anyKnownClosing;
  }

  const flowCache = new Map<string, StockFlow>();
  /**
   * Ayın stok akışı: açılış, kapanış (sayım ya da tahmini devir), mal maliyeti ve yöntemi.
   * - Kapanışı bilinen ay (knownClosing) ve önceki ayın kapanışı da biliniyorsa: sayım (açılış + alınan − kapanış).
   * - İki bilinen kapanış (ya da ilk veri ayı) arasındaki aylar: aralığın toplam maliyeti (açılış + aralıktaki alınan −
   *   aralığın sonundaki kapanış) aylara reçeteye göre tüketim (cogsConsumption) oranında dağıtılır; ara ayların devri
   *   açılış + alınan − dağıtılan maliyet. Tüketim yoksa alınan mal oranında, o da yoksa hepsi aralığın son ayına.
   * - Ardından kapanışı henüz bilinmeyen aylar (şu an süren ay): reçeteye göre tahmini; tahmini kapanış açılış + alınan −
   *   tahmini maliyet. Ay sonu sayımı girilince aralık dağıtımına döner.
   * Bu aydan sonraki aylarda, verisi olan ilk aydan önce ve hiç bilinen kapanış yokken eski kural (sayım ya da 0; Excel'den
 * aktarılan veri). Vergi bu hesabı kullanmaz
   * (countOpening / countClosing: yalnız sayım).
   */
  function stockFlow(month: string): StockFlow {
    const hit = flowCache.get(month);
    if (hit) return hit;
    // Tek şube seçili: faturalar (alınan mal) ve stok devri işletme genelidir, şubeye bölünmez. Şubenin mal maliyeti
    // kendi satışından reçeteye göre (sahibin kararı, 4 Kasım 2026; docs/SUBE.md › Şube görünümünde maliyet)
    if (ds.branchView) {
      const c = cogsConsumption(month);
      const basis =
        c.basis === "revenue"
          ? `satış listesi yok: KDV hariç ciro × son satış ayının maliyet oranı ${tl(c.material)}`
          : c.basis === "none"
            ? "satış listesi ve ciro yok: 0"
            : `reçeteye göre tüketim (fire hariç) ${tl(c.fireFree)}`;
      const info = `${ds.branchView.name}: şubenin satışından reçeteye göre: ${basis} × (1 + %${Math.round(c.fireRate * 100)} fire)${c.offCost ? ` + ödenmezlerin tahmini malzeme maliyeti ${tl(c.offCost)}` : ""}. Faturalar ve stok devri işletme genelinde, şubeye bölünmez; sayımlı mal maliyeti için Tümü'ne geçin.`;
      const out: StockFlow = { opening: 0, closing: 0, cogs: c.total, method: "sube", estimatedClosing: false, info };
      flowCache.set(month, out);
      return out;
    }
    const first = firstDataMonth;
    // Hiç bilinen kapanış (sayım ya da elle yazılan devir) yoksa dağıtılacak aralık da tahminin dayanağı da yok: eski
    // kural (devreden 0; Excel'den aktarılan veri böyledir). İlk sayımla yeni hesap başlar
    if (!first || month < first || month > currentMonth || !hasKnownClosing()) {
      const opening = pnlByMonth.get(month)?.get("stock:opening") ?? closingStock(shiftMonth(month, -1)).value;
      const closing = closingStock(month).value;
      const out: StockFlow = { opening, closing, cogs: opening + goodsInTotal(month) - closing, method: null, estimatedClosing: false, info: null };
      flowCache.set(month, out);
      return out;
    }
    // Aralığın başı: bu aydan geriye, kapanışı bilinen ilk ayın ertesi (yoksa verisi olan ilk ay)
    let start = month;
    while (start > first && knownClosing(shiftMonth(start, -1)) === null) start = shiftMonth(start, -1);
    // Açılış: elle yazılan, önceki ayın bilinen kapanışı; verisi olan ilk ayda (kafenin açıldığı ay) 0
    const startOpening = pnlByMonth.get(start)?.get("stock:opening") ?? knownClosing(shiftMonth(start, -1)) ?? 0;
    // Aralığın sonu: bu aydan ileriye, kapanışı bilinen ilk ay (bu aya kadar); yoksa açık aralık
    let end: string | null = null;
    for (let m = month; m <= currentMonth; m = shiftMonth(m, 1)) {
      if (knownClosing(m) !== null) {
        end = m;
        break;
      }
    }
    const months: string[] = [];
    for (let m = start; m <= (end ?? currentMonth); m = shiftMonth(m, 1)) months.push(m);
    if (end !== null) {
      const closingEnd = knownClosing(end)!;
      const purchases = months.map(goodsInTotal);
      const total = startOpening + sum(purchases) - closingEnd;
      // Tek aylık aralık (önceki ayın kapanışı da biliniyor ya da kafenin ilk ayı): düz sayım
      const single = months.length === 1;
      let weights = months.map((m) => cogsConsumption(m).total);
      if (!(sum(weights) > 0.005)) weights = purchases.map((p) => Math.max(0, p));
      if (!(sum(weights) > 0.005)) weights = months.map((m) => (m === end ? 1 : 0));
      const wsum = sum(weights);
      const span = `${monthLabel(start)} – ${monthLabel(end)}`;
      let opening = startOpening;
      months.forEach((m, i) => {
        const last = m === end;
        const cogs = last ? opening + purchases[i] - closingEnd : (total * weights[i]) / wsum;
        const closing = last ? closingEnd : opening + purchases[i] - cogs;
        const info = single
          ? `Sayım: açılış ${tl(opening)} + alınan ${tl(purchases[i])} − ay sonu sayımı ${tl(closingEnd)}.`
          : `Sayım aralığına dağıtıldı (tahmini): ${span} toplam mal maliyeti ${tl(total)} (açılış ${tl(startOpening)} + alınan ${tl(sum(purchases))} − ${monthLabel(end)} sayımı ${tl(closingEnd)}), ayların reçeteye göre tüketimi oranında; bu ayın payı ${pct(weights[i] / wsum)}.${last ? "" : " Devreden mal tahminidir: açılış + alınan − dağıtılan maliyet."}`;
        flowCache.set(m, { opening, closing, cogs, method: single ? "sayim" : "dagitim", estimatedClosing: !last, info });
        opening = closing;
      });
    } else {
      let opening = startOpening;
      for (const m of months) {
        const c = cogsConsumption(m);
        const purchases = goodsInTotal(m);
        const cogs = c.total;
        const closing = opening + purchases - cogs;
        const basis =
          c.basis === "revenue"
            ? `satış listesi yok: KDV hariç ciro × son satış ayının maliyet oranı ${tl(c.material)}`
            : c.basis === "none"
              ? "satış listesi ve ciro yok: 0"
              : `reçeteye göre tüketim (fire hariç) ${tl(c.fireFree)}`;
        const info = `Reçeteye göre tahmini: ${basis} × (1 + %${Math.round(c.fireRate * 100)} fire)${c.offCost ? ` + ödenmezlerin tahmini malzeme maliyeti ${tl(c.offCost)}` : ""}. Tahmini devreden mal: açılış + alınan − tahmini maliyet. Ay sonu sayımı girilince gerçek hesaba döner.`;
        flowCache.set(m, { opening, closing, cogs, method: "tahmin", estimatedClosing: true, info });
        opening = closing;
      }
    }
    return flowCache.get(month)!;
  }

  const pnlCache = new Map<string, PnlMonthCalc>();
  /**
   * Ayın kasa cirosunun KDV hariç tutarı ve KDV'si (Gelir-gider'in AYLIK CİRO (KDV hariç)'i, KDV tahmini; hesap
   * sözleşmesi, 23 Kasım 2026). Ciro kasadan geliyor ve ayda LafPOS'un şubesinin günü varsa gün gün (`byDay`): LafPOS
   * gününün KDV'si LafPOS'un kendi dökümünden (z.vat; yeniden hesaplanmaz), ModPOS günü günün oranıyla (satış KDV'si,
   * %10) ayrı ayrı kuruşa yuvarlanır, ay günlerin toplamıdır (Marina Kasım: 30.576,15; ay toplamından 30.576,14 olurdu).
   * Öteki şubelerin günleri ve elle yazılan ciro bugünkü gibi ay toplamından: HİZMET satırları (karaoke) hizmet KDV'siyle,
   * gerisi satış KDV'siyle. LafPOS'un dökümü hizmeti zaten kendi oranıyla taşır: o günlerin HİZMET satırları bir daha
   * ayrılmaz. Ciro yoksa null
   */
  function posNet(month: string): { net: number; vat: number; byDay: boolean } | null {
    const info = monthInfo.get(month);
    const revenue = info?.posRevenue ?? null;
    if (revenue === null) return null;
    const service = Math.min(Math.max(revenue, 0), monthSales(month).serviceRevenue);
    const dv = info?.kasa?.till.dayVat;
    if (!dv || info?.sources?.posRevenue !== "kasa") {
      const net = (revenue - service) / (1 + st.kdv) + service / (1 + st.kdvHizmet);
      return { net, vat: revenue - net, byDay: false };
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    // LafPOS'un dökümü bilinen günlerin HİZMET satırları (LafPOS'un ay satırları) o dökümün içinde
    const lafService = dv.known.days ? sum((linesByMonth.get(month) ?? []).filter((l) => l.lafpos && l.isService).map((l) => l.revenue)) : 0;
    const rest = Math.max(0, revenue - dv.known.revenue);
    const restService = Math.min(rest, Math.max(0, service - lafService));
    const daysNet = sum(dv.days.map((d) => r2(d / (1 + st.kdv))));
    // Öteki şubelerin cirosu ("Tümü"de): ay toplamından
    const other = Math.max(0, rest - sum(dv.days));
    const net = r2(dv.known.base + daysNet + other / (1 + st.kdv) - restService * (1 / (1 + st.kdv) - 1 / (1 + st.kdvHizmet)));
    return { net, vat: r2(revenue - net), byDay: true };
  }

  /** Ayın "aynı gider iki kez" bulguları (pnlMonth hesaplar; duplicateExpenses okur) */
  const duplicateCache = new Map<string, DuplicateExpense[]>();
  function pnlMonth(month: string): PnlMonthCalc {
    let pm = pnlCache.get(month);
    if (pm) return pm;
    const info = monthInfo.get(month);
    const overrides = pnlByMonth.get(month) ?? new Map<string, number>();
    const notes = pnlNotes.get(month);
    const noteOf = (key: string) => notes?.get(key) ?? null;
    const dim = daysInMonth(month);
    const openDays = info?.openDays ?? 0;
    // Aylık kalemler ve personel bu günle (kasa raporlarından gelen ayda takvim günü; biten ayda ayın sonuna kadar;
    // prorationDays)
    const closedMonth = month < currentMonth;
    const days = prorationDays(info, closedMonth);
    const ratio = days / dim;
    // "Tümü": şubeye bağlı kişi ve kalem kendi şubesinin günüyle (şubenin açılış ayında açılış gününden; şube görünümüyle
    // aynı, Tümü şubelerin toplamı). İşletme geneli kalem ve o ay bilgisi olmayan şube işletmenin günüyle
    const branchDays = (branchId: string | null | undefined): { days: number; open: number } => {
      const own = !ds.branchView && branchId ? info?.byBranch?.[branchId] : undefined;
      return own ? { days: prorationDays(own, closedMonth), open: own.openDays ?? 0 } : { days, open: openDays };
    };
    // İşletme geneli kalemin günü (Faz 5): "Tümü"de işletmenin günü; şube seçiliyken de işletmenin (Dataset.companyMonths,
    // "Tümü"nün ay bilgisi): bilgi satırı Tümü'nün saydığı tutarı gösterir. Verilmemişse (test, eski çağıran) şubenin günü
    const companyDays = (): { days: number; open: number } => {
      if (!ds.branchView || !ds.companyMonths) return { days, open: openDays };
      const c = companyInfo.get(month);
      return c ? { days: prorationDays(c, closedMonth), open: c.openDays ?? 0 } : { days, open: openDays };
    };
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

    // Devirler: stok akışından (sayım, sayım aralığına dağıtılmış ya da reçeteye göre tahmini devir; stockFlow). Vergi
    // yalnız sayımı kullanır: countOpening / countClosing eski kuraldır (sayım ya da 0)
    const flow = stockFlow(month);
    const prevCount = closingStock(shiftMonth(month, -1)).value;
    const cl = closingStock(month);
    let opening: number;
    let closing: number;
    let cogs: number;
    if (ds.branchView) {
      // Şube görünümü: devir işletmenindir, şubenin maliyeti reçeteden (stockFlow); alınan mal bilgi olarak kalır
      const shared = `${ds.branchView.name} seçili: stok devri işletme genelinde, şubeye bölünmez. Şubenin mal maliyeti satışından reçeteye göre.`;
      cells.set("stock:opening", { value: null, computed: null, overridden: false, info: shared });
      cells.set("stock:closing", { value: null, computed: null, overridden: false, info: shared });
      cells.set("stock:purchased", { value: purchases, computed: purchases, overridden: false, info: "Bilgi: şubenin ve İşletme geneli seçilmiş mal faturaları; mal maliyetine girmez (şubenin mal maliyeti reçeteden)." });
      opening = 0;
      closing = 0;
      cogs = flow.cogs;
    } else {
      opening = auto("stock:opening", overrides.has("stock:opening") ? prevCount : flow.opening);
      cells.set("stock:purchased", { value: purchases, computed: purchases, overridden: false });
      const closingCell: PnlCell = { value: flow.closing, computed: cl.overridden ? cl.computed : flow.closing, overridden: cl.overridden, note: cl.overridden ? noteOf("stock:closing") : null };
      if (flow.estimatedClosing) closingCell.info = "Ay sonu sayımı yok: tahmini devir (açılış + alınan − tahmini mal maliyeti). Sayım girilince ya da buraya yazılınca o tutar geçer.";
      if (flow.method) closingCell.tag = flow.estimatedClosing ? "tahmini" : "sayım";
      cells.set("stock:closing", closingCell);
      closing = flow.closing;
      cogs = opening + purchases - closing;
    }
    const countOpening = overrides.get("stock:opening") ?? prevCount;

    // Personel, faturalar, kira, genel
    const sections: Record<FixedSection | "komisyon", number> = { personel: 0, faturalar: 0, kira: 0, genel: 0, komisyon: 0 };
    // Personel: o ay çalışanlar, o ayın maaşıyla (elle girilen bordro tutarı her zaman geçerli)
    const pers = personnelFor(month);
    // Tam zamanlı kişinin oranı şubesinin günüyle; şubelerin günü farklıysa (bir şubenin açılış ayı) parçalar kişi kişi
    // oranlanır. Part-time (Faz 5) oranlanmaz: çağrıldığı gün zaten o ayın (bugüne kadarki) günüdür
    const fullRows = pers.rows.filter((r) => !isPartTime(r.staff));
    const partRows = pers.rows.filter((r) => isPartTime(r.staff));
    const rowRatio = (r: PersonnelSummary["rows"][number]) => branchDays(r.staff.branchId).days / dim;
    const mixed = fullRows.some((r) => Math.abs(rowRatio(r) - ratio) > 1e-9);
    const scaled = mixed
      ? {
          net: sum(fullRows.map((r) => r.staff.netSalary * rowRatio(r))),
          total: sum(fullRows.map((r) => r.total * rowRatio(r))),
          deductions: sum(fullRows.map((r) => r.deductions * rowRatio(r))),
          employerSgk: sum(fullRows.map((r) => r.employerSgk * rowRatio(r))),
          employerUnemployment: sum(fullRows.map((r) => r.employerUnemployment * rowRatio(r))),
          extras: sum(fullRows.map((r) => r.staff.extras * rowRatio(r))),
          mealCard: sum(fullRows.map((r) => r.mealCard * rowRatio(r))),
        }
      : null;
    const fullTotal = pers.total - pers.partTime.total;
    sections.personel += auto("personnel:net", scaled ? scaled.net : pers.net * ratio);
    // Maliyet − net: çalışanların SGK + işsizlik kesintisi, işveren payları ve yemek / yol / prim ekleri (denetim E-44;
    // yalnız işveren payı değil). Yemek kartı kendi alt satırında (Faz 5). Hücre bu ayın bileşimini taşır
    sections.personel += auto("personnel:employer", scaled ? scaled.total - scaled.net - scaled.mealCard : (fullTotal - pers.net - pers.mealCard) * ratio);
    cells.get("personnel:employer")!.info = scaled
      ? `${personnelExtraText(scaled, 1, dim, dim)} Her kişi kendi şubesinin günüyle oranlandı.`
      : personnelExtraText(pers, ratio, days, dim);
    // Yemek kartı (Faz 5): işaretli kişilerin günlük tutar × günü, brütleştirilmez; tam zamanlıda maaş gibi gün oranıyla,
    // part-time'da çağrıldığı günle. Kimsede yoksa (ve elle yazılmamışsa) hücre yok: eski tablo değişmez
    // LafPOS'ta çalıştığı günle sayılan yemek kartı (LM-4b; yalnız biten ay) gerçek gündür: gün oranıyla bir daha
    // oranlanmaz. Süren ayda yemek kartı Ayarlar'daki günle, maaş gibi oranlanır
    const mealAll = pers.mealCard + pers.partTime.mealCard;
    if (mealAll > 0 || overrides.has(MEAL_CARD_KEY)) {
      const fullMeal = scaled
        ? sum(fullRows.map((r) => (r.lafposDays !== null ? r.mealCard : r.mealCard * rowRatio(r))))
        : (pers.mealCard - pers.mealCardLafpos) * ratio + pers.mealCardLafpos;
      sections.personel += auto(MEAL_CARD_KEY, fullMeal + pers.partTime.mealCard);
      cells.get(MEAL_CARD_KEY)!.info =
        mealCardText(pers.rows, st, scaled || pers.mealCard === pers.mealCardLafpos ? 1 : ratio, days, dim) + (scaled ? " Tam zamanlılar kendi şubesinin günüyle oranlandı." : "");
    }
    // Part-time (Faz 5): günlük ücret × çağrıldığı gün + ek ödeme; gün oranı yok. Bağlantısız kişi uyarılır (tahmin yok)
    if (partRows.length || overrides.has(PART_TIME_KEY)) {
      sections.personel += auto(PART_TIME_KEY, pers.partTime.wages + pers.partTime.extras);
      const cell = cells.get(PART_TIME_KEY)!;
      cell.info = partTimeText(partRows);
      if (pers.partTime.unlinked.length) cell.warn = partTimeUnlinkedText(pers.partTime.unlinked);
    }
    // Şubeye yazılan giderler (Tümü'nün şube kırılımı): personel kişinin şubesine, tam zamanlı kendi şubesinin günüyle
    const byBranch: Record<string, number> = {};
    const toBranch = (branchId: string | null | undefined, amount: number) => {
      if (branchId && amount) byBranch[branchId] = (byBranch[branchId] ?? 0) + amount;
    };
    for (const r of pers.rows) toBranch(r.staff.branchId ?? DEFAULT_BRANCH_ID, isPartTime(r.staff) ? r.total : r.total * rowRatio(r));
    // Sabit giderler: aralıktaki kalemler o ayın tutarıyla. Aralık dışındaki (ya da silinmiş) kalemin
    // elle girilmiş tutarı yine de sayılır; böylece dondurulmuş geçmiş ay kaybolmaz.
    // "Açık güne göre oranla" kapalı kalem (kira varsayılanı) biten ayda tam ay; süren ayda bugüne kadarki pay (ciroyla
    // aynı dönem). Resmi kirası olan kalemin stopajı ayrı satır: resmi brüt × kira stopajı oranı, kiranın gün payıyla
    // Tam ay yalnız kafenin verisi olan aylarda (ilk veri ayından önce, başlangıç ayı yazılmamış kalem 0 kalır)
    const fullDays = month < currentMonth && firstDataMonth !== null && month >= firstDataMonth ? dim : days;
    // İşletme geneli tam ay kalem (Faz 5): şube seçiliyken de işletmenin günüyle ve ilk veri ayıyla (bilgi satırı Tümü'nün
    // saydığı tutar; süren ayda işletmenin günü, şubenin verisinden önceki kapanmış ayda tam ay)
    const sharedFullDays = month < currentMonth && companyFirstDataMonth !== null && month >= companyFirstDataMonth ? dim : companyDays().days;
    const rentRate = rentWithholdingRate(month);
    const officialRent: PnlMonthCalc["officialRent"] = [];
    // İşletme geneli (Faz 5, sahibin kararı 4): şubesi boş sabit gider ve stopajı, silinmiş kalemin elle girişi, elle
    // hücreler, şubesi boş harcama ve harcamaya bağlı faturalar, komisyon faturaları. "Tümü"de bölümlerinde bir kez
    // sayılır; tek şube seçiliyken şubenin kârına girmez, "İşletme geneli payı (bilgi)" satırında toplamı görünür
    // (bölüştürme değil, işletmenin tamamı; işletmenin günüyle oranlanır: companyDays)
    const sharedParts: PnlMonthCalc["shared"]["parts"] = [];
    const sharedKeys = new Set<string>();
    /** Tutarı bölümüne (Tümü ya da şubenin kendi kalemi) ya da şube görünümünde işletme geneli payına yazar */
    const book = (section: FixedSection | "komisyon", key: string, label: string, amount: number, sharedItem: boolean, branchId?: string | null) => {
      if (sharedItem) {
        sharedKeys.add(key);
        if (amount) sharedParts.push({ key, label, amount });
        if (ds.branchView) return;
      } else toBranch(branchId, amount);
      sections[section] += amount;
    };
    for (const fe of allFixed) {
      const key = `fixed:${fe.id}`;
      const sKey = stopajKey(fe.id);
      const sharedItem = (fe.branchId ?? null) === null;
      if (inRange(fe, month)) {
        const own = sharedItem ? companyDays() : branchDays(fe.branchId);
        const d = fe.prorate === false ? (sharedItem ? sharedFullDays : fullDays) : own.days;
        book(fe.section, key, fe.name, auto(key, fixedForMonth(fixedAtMonth(fe, month), st, own.open, dim, d)), sharedItem, fe.branchId);
        if (fe.prorate === false && d !== own.days) cells.get(key)!.info = "Tam ay: açık güne göre oranlanmıyor (Sabit giderler › Açık güne göre oranla).";
        const gross = officialRentGross(fe, rentRate);
        if (gross !== null) {
          const share = dim ? d / dim : 0;
          const stopaj = auto(sKey, gross * rentRate * share);
          book(fe.section, sKey, `${fe.name} stopajı`, stopaj, sharedItem, fe.branchId);
          cells.get(sKey)!.info = `Resmi brüt kira ${tl(gross)}${fe.officialBasis === "net" ? ` (net ${tl(fe.officialAmount ?? 0)} ÷ ${num(1 - rentRate, 2)})` : ""} × %${num(rentRate * 100)} stopaj${share < 1 ? ` × ${d}/${dim} gün` : ""}. Muhtasarla izleyen ayın 26'sında ödenir.`;
          // Tek kaynak (Faz 5): stopaj resmi kiradan bu satırda; "Kira stopajı" adlı ayrı bir sabit gider de sayılıyorsa
          // aynı stopaj iki kez girer. Tutar değişmez, hücre uyarır (Genel bakış da)
          const twin = allFixed.find((x) => x.id !== fe.id && inRange(x, month) && isRentStopajItem(x));
          if (twin) cells.get(sKey)!.warn = rentStopajTwinText(twin.name);
          officialRent.push({ id: fe.id, gross: gross * share, stopaj });
        }
      } else {
        const ov = overrides.get(key);
        cells.set(key, { value: ov ?? null, computed: null, overridden: ov !== undefined, note: ov !== undefined ? noteOf(key) : null, outOfRange: true });
        if (ov !== undefined) book(fe.section, key, fe.name, ov, sharedItem, fe.branchId);
        const sov = overrides.get(sKey);
        if (sov !== undefined) {
          cells.set(sKey, { value: sov, computed: null, overridden: true, note: noteOf(sKey), outOfRange: true });
          book(fe.section, sKey, `${fe.name} stopajı`, sov, sharedItem, fe.branchId);
        }
      }
    }
    for (const [key, ov] of overrides) {
      // Kalemi silinmiş ya da resmi kirası kaldırılmış stopajın elle girişi: kira bölümünde sayılır
      // (işletme geneli: kalemi yok, şubesi bilinmez)
      if (key.startsWith("stopaj:") && !cells.has(key)) {
        cells.set(key, { value: ov, computed: null, overridden: true, note: noteOf(key), outOfRange: true });
        book("kira", key, "Kira stopajı (silinmiş kalem)", ov, true);
        continue;
      }
      if (!key.startsWith("fixed:") || cells.has(key)) continue;
      // Kalemi silinmiş eski bir elle giriş: İşletme genel giderlerinde sayılır (işletme geneli)
      cells.set(key, { value: ov, computed: null, overridden: true, note: noteOf(key), outOfRange: true });
      book("genel", key, `Silinmiş gider (#${key.slice(6)})`, ov, true);
    }
    // Elle yazılan hücreler (su, doğalgaz, harici…): pnl_entries şubesizdir, işletme geneli
    for (const row of MANUAL_PNL_ROWS) {
      if (row.section === "mal") continue;
      book(row.section, row.key, row.label, manual(row.key), true);
    }
    // Harcamalar: şubesi boş kayıtlar ve kategoriye bağlı faturalar işletme geneli; şube seçiliyken hücre şubenin kendi
    // kayıtlarıdır
    for (const x of exp) {
      if (x.cat.section === "mal") continue;
      const key = `expense:${x.cat.id}`;
      // Şube seçiliyken: şubenin kendi kayıtları ve şubenin faturaları; işletme geneli faturalar bilgi satırında
      const own = ds.branchView ? (expenseOwnByMonth.get(month)?.get(x.cat.id) ?? 0) + x.invoicesOwn : x.total;
      cells.set(key, { value: own, computed: own, overridden: false });
      sections[x.cat.section] += own;
      for (const [b, v] of expenseByBranch.get(`${month}|${x.cat.id}`) ?? []) toBranch(b, v);
      for (const [b, v] of x.invoicesByBranch) toBranch(b, v);
      const sharedPart = (expenseSharedByMonth.get(month)?.get(x.cat.id) ?? 0) + x.invoicesShared;
      if (sharedPart) sharedParts.push({ key, label: x.cat.name, amount: sharedPart });
    }
    // Aynı gider iki kez (23 Kasım 2026; duplicate-expense.ts): bu ay sayılan sabit gider kalemi aynı adla bir faturada
    // (Gelir-gider'e giren), harcamada ya da elle yazılmış hücrede de varsa hücrede işaret; Genel bakış'ta uyarı (alerts).
    // Tutar değişmez
    const catById = new Map(expenseCats.map((c) => [c.id, c]));
    const linkedInvoiceCats = new Set(expenseCats.filter((c) => invoiceCategoryMappable(c.invoiceCategory)).map((c) => c.invoiceCategory!));
    const duplicates = findDuplicateExpenses({
      fixed: allFixed.map((fe) => ({ id: fe.id, name: fe.name, amount: cells.get(`fixed:${fe.id}`)?.value ?? 0, branchId: fe.branchId ?? null })),
      invoices: invs
        .filter((i) => GOODS_CATEGORIES.includes(i.category) || i.category === COMMISSION_CATEGORY || linkedInvoiceCats.has(i.category))
        .map((i) => ({ supplier: i.supplier, category: i.category, amount: invoiceNet(i) })),
      expenses: (expenseEntriesByMonth.get(month) ?? []).map((e) => ({
        label: catById.get(e.categoryId)?.name ?? "Harcama",
        description: e.description,
        amount: e.amount,
        branchId: e.branchId ?? null,
      })),
      manual: MANUAL_PNL_ROWS.map((r) => ({ label: r.label, key: r.key, amount: overrides.get(r.key) ?? 0 })),
    });
    for (const d of duplicates) {
      const cell = cells.get(`fixed:${d.fixedId}`);
      if (cell) cell.warn = duplicateCellWarn(d);
    }
    duplicateCache.set(month, duplicates);

    // Komisyonlar. Banka POS komisyonu yalnız banka kartı payıyla (yemek kartınınki aşağıda kendi faturalarıyla; E-43)
    const revenue = info?.posRevenue ?? null;
    const bank = bankShareOf(month);
    // Kasa kartı olan ayda Σ şube (kart × şubenin oranı), Satışlar'la aynı (posCommission); yoksa eski formül
    const pos = posCommission(month);
    sections.komisyon += auto("commission:pos", pos ? pos.amount : (revenue ?? 0) * st.komisyon * bank.rate);
    const commBySupplier = new Map<string, number>();
    const commInvs = invs.filter((i) => i.category === COMMISSION_CATEGORY);
    for (const inv of commInvs) {
      const s = normalizeSupplier(inv.supplier);
      commBySupplier.set(s, (commBySupplier.get(s) ?? 0) + invoiceNet(inv));
    }
    for (const [s, v] of commBySupplier) {
      cells.set(`commission:${s}`, { value: v, computed: v, overridden: false });
      // Komisyon faturaları şubeye bölünmez (işletme geneli)
      book("komisyon", `commission:${s}`, `${s} komisyonu`, v, true);
    }
    const posCell = cells.get("commission:pos")!;
    posCell.info = pos ? posCommissionText(pos, branchNameOf) : bankShareText(bank);
    // Kanalı bulunamayan Komisyon faturası (yemek kartı ya da platform değil): bankanın POS komisyonu faturasıysa tahmin
    // onu ikinci kez sayar. Elle yazılmış hücrede sahip karar vermiştir, uyarı yok (sahibe soru 9; docs/KOMISYON.md).
    // Kanal Komisyon & hakediş'teki gibi tedarikçi kartının adları ve diğer adlarıyla da aranır (channelNames)
    const unknown = [...new Set(commInvs.filter((i) => !channelOf(i.channelNames ?? [i.supplier])).map((i) => normalizeSupplier(i.supplier)))];
    if (unknown.length && !posCell.overridden && posCell.value) {
      posCell.warn = `Bu ay kanalı bulunamayan komisyon faturası var (${unknown.join(", ")}). Bankanın POS komisyonu faturasıysa bu tahmin onu ikinci kez sayar: hücreye 0 yazın (fatura gerçek tutardır).`;
    }

    const expenses = cogs + sections.personel + sections.faturalar + sections.kira + sections.genel + sections.komisyon;
    // Kasadan geçen hizmet satışı (karaoke odası) %20, ürünler %10: ayın satış listesindeki HİZMET satırları kadarı
    // hizmet KDV oranıyla ayrılır (ay cirosundan büyük olamaz); satış listesi yüklenmemiş ayda bütün ciro satış KDV'siyle.
    // LafPOS'un şubesinin günleri gün gün (posNet): LafPOS gününün KDV'si kendi dökümünden, ay günlerin toplamı
    const serviceRevenue = revenue === null ? 0 : Math.min(Math.max(revenue, 0), monthSales(month).serviceRevenue);
    const revenueNet = posNet(month)?.net ?? null;
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
      cogsMethod: flow.method,
      cogsInfo: flow.info,
      countOpening,
      countClosing: cl.value,
      officialRent,
      sections,
      shared: { total: sum(sharedParts.map((x) => x.amount)), parts: sharedParts, keys: sharedKeys },
      byBranch,
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
  /** İşletmenin ("Tümü"nün) ilk veri ayı: şube seçiliyken Tümü'nün ay bilgisi de sayılır (işletme geneli tam ay kalem) */
  const companyFirstDataMonth =
    ds.branchView && ds.companyMonths ? ([...(firstDataMonth ? [firstDataMonth] : []), ...ds.companyMonths.map((x) => x.month)].sort()[0] ?? null) : firstDataMonth;

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
    const stopajKeysWithValue = new Set<string>();
    const expenseKeysWithValue = new Set<string>();
    for (const pm of monthsCalc) {
      for (const [k, c] of pm.cells) {
        if (k.startsWith("purchase:")) suppliers.add(k);
        if (k.startsWith("commission:") && k !== "commission:pos") commSuppliers.add(k);
        if (k.startsWith("fixed:") && c.overridden) fixedKeysWithValue.add(k);
        if (k.startsWith("stopaj:") && c.overridden) stopajKeysWithValue.add(k);
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
    // İşletmenin toplamı olan hücreler (devir, personel, POS komisyonu) şube seçiliyken yazılmaz: elle girilen tutar
    // işletmenindir, şubede hesaplanan değer geçer (veri yükleyici bu hücreleri şube görünümüne almaz)
    const companyCell = !ds.branchView;

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
    devir({ key: "stock:opening", label: "ÖNCEKİ AYDAN DEVİR", kind: "auto", editable: companyCell, hint: "Bir önceki ayın sayım değeri (sonraki aya devreden mal). Elle yazılırsa Stok sayımı kartındaki açılış da bu tutarı gösterir." });
    devir({ key: "stock:purchased", label: "AY İÇİNDE ALINAN", kind: "auto", editable: false });
    devir({ key: "stock:closing", label: "SONRAKİ AYA DEVREDEN MAL (ay sonu stok)", kind: "auto", editable: companyCell, hint: "Stok sayımı sayfasındaki o ayın toplamı (KDV hariç). Ayarlar'daki başlangıç ayından itibaren ilk giren ilk çıkar (FIFO): sayılan miktar en son faturalardan geriye doğru, her parça kendi faturasının fiyatıyla; faturası bulunamayan kısım ay sonu fiyatıyla. Sayım girilmeyen ayda tahmini devir: iki sayım arasındaki aylarda aralığın mal maliyeti reçeteye göre tüketim oranında dağıtılır, son sayımdan sonraki ayda reçeteye göre tahmin düşülür (açılış + alınan − tahmini maliyet); sayım girilince gerçek hesaba döner. Hiç sayım yokken 0." });
    devir({
      key: "total:cogs",
      label: "CİRO İÇİN KULLANILAN MALIN MALİYETİ",
      kind: "total",
      editable: false,
      strong: true,
      hint: "Devir + Alınan − Devreden. Altındaki küçük yazı yöntemi söyler: sayım (açılış ve kapanış sayımla), sayım aralığına dağıtıldı (iki sayım arasındaki toplam maliyet ayların reçeteye göre tüketimi oranında; tahmini) ya da reçeteye göre tahmini (son sayımdan sonra: fire hariç tüketim × (1 + genel fire) + ödenmezlerin tahmini malzeme maliyeti).",
    });

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
          editable: companyCell,
          hint: "Personel sayfasındaki net maaşlar × (açık gün ÷ ayın gün sayısı). Açık günü kasa raporlarından gelen ayda raporların kapsadığı takvim günüyle: kapalı gün maaşı düşürmez.",
        });
        add({ key: "personnel:employer", label: PERSONNEL_EXTRA_LABEL, kind: "auto", editable: companyCell, hint: PERSONNEL_EXTRA_HINT });
        // Yemek kartı ve part-time (Faz 5): yalnız bu aylardan birinde işaretli / part-time kişi ya da elle tutar varsa
        if (monthsCalc.some((pm) => pm.cells.has(MEAL_CARD_KEY))) {
          add({ key: MEAL_CARD_KEY, label: MEAL_CARD_ROW_LABEL, kind: "auto", editable: companyCell, hint: MEAL_CARD_HINT });
        }
        if (monthsCalc.some((pm) => pm.cells.has(PART_TIME_KEY))) {
          add({ key: PART_TIME_KEY, label: PART_TIME_ROW_LABEL, kind: "auto", editable: companyCell, hint: PART_TIME_HINT });
        }
      }
      // Bu aylardan en az birinde (verisi olan dönemde) geçerli olan ya da elle tutarı girilmiş kalemler. Şube seçiliyken
      // işletme geneli kalemler (şubesi boş) satır olmaz: "İşletme geneli payı (bilgi)" satırındadır (Faz 5)
      for (const fe of allFixed.filter((f) => f.section === key && !(ds.branchView && (f.branchId ?? null) === null))) {
        const shown =
          fixedKeysWithValue.has(`fixed:${fe.id}`) ||
          months.some((m) => (!firstDataMonth || m >= firstDataMonth) && inRange(fe, m));
        if (!shown) continue;
        add({ key: `fixed:${fe.id}`, fixedId: fe.id, label: fe.name.toLocaleUpperCase("tr-TR"), kind: "auto", editable: true, hint: fe.note ?? undefined });
        if (officialRentGross(fe, 0.2) !== null || stopajKeysWithValue.has(stopajKey(fe.id))) {
          add({
            key: stopajKey(fe.id),
            fixedId: fe.id,
            // Şirkete kirada saklı resmi kira stopaja girmez (officialRentGross): ad yalnız stopajlı kalemler sayılarak
            label: allFixed.filter((f) => officialRentGross(f, 0.2) !== null).length > 1 ? `${fe.name.toLocaleUpperCase("tr-TR")} STOPAJI` : "KİRA STOPAJI",
            kind: "auto",
            editable: true,
            hint: "Resmi (sözleşmedeki) brüt kira × kira stopajı oranı (%20); net girildiyse brüt = net ÷ 0,8. Sabit giderler'de kira kaleminin resmi kirasından. Muhtasarla izleyen ayın 26'sında ödenir (Ödemeler ve nakit planı).",
          });
        }
      }
      if (key === "genel" && !ds.branchView) {
        for (const k of [...fixedKeysWithValue].filter((k) => !fixedById.has(Number(k.slice(6)))).sort()) {
          add({ key: k, fixedId: Number(k.slice(6)), label: `SİLİNMİŞ GİDER (#${k.slice(6)})`, kind: "auto", editable: true, hint: "Bu sabit gider silinmiş; elle girilen tutarı korunuyor. Boşaltırsanız satır kaybolur." });
        }
      }
      for (const r of expenseRows(key)) add(r);
      // Elle hücreler işletme genelidir: şube seçiliyken satır yok, Tümü'de yazılır (Faz 5)
      if (!ds.branchView) for (const r of MANUAL_PNL_ROWS.filter((r) => r.section === key)) add({ key: r.key, label: r.label, kind: "manual", editable: true, hint: r.hint });
      add({ key: `total:${key}`, label: sectionLabels[key], kind: "total", editable: false, strong: true });
    }

    const kom = sec("komisyon");
    // Etiketin oranı: gösterilen ayların hepsinde aynıysa (kasa kartı olan ayda şubenin oranı, olmayanda Ayarlar'daki)
    const posRates = new Set(months.flatMap((m) => posCommission(m)?.parts.map((p) => p.rate) ?? [st.komisyon]));
    kom({
      key: "commission:pos",
      label: posRates.size === 1 ? `BANKA POS KOMİSYONU (%${([...posRates][0] * 100).toLocaleString("tr-TR")})` : "BANKA POS KOMİSYONU",
      kind: "auto",
      editable: companyCell,
      hint: "Tahmin: şube şube kasa raporlarındaki banka kartı (KDV dahil, yemek kartı hariç) × şubenin POS oranı (Şubeler); Satışlar'daki komisyon aynı tutardır, satırlara ciro payıyla dağılır (süren ayda satış listesi kasa raporlarından kısaysa Satışlar listenin günleriyle sayar). Yemek kartlarının komisyonu kendi faturalarıyla aşağıda sayılır. Kasa raporu olmayan ayda aylık ciro × komisyon (Ayarlar) × kartlı satış oranı. Banka dekontundaki gerçek tutarı yazabilirsiniz; banka POS komisyonunu Komisyon faturası olarak kesiyorsa 0 yazın.",
    });
    // Komisyon faturaları işletme genelidir: şube seçiliyken satır yok (Faz 5)
    for (const k of ds.branchView ? [] : [...commSuppliers].sort()) {
      kom({ key: k, label: `${k.slice("commission:".length).toLocaleUpperCase("tr-TR")} KOMİSYONU`, kind: "auto", editable: false, hint: "Faturalar sayfasından otomatik (Komisyon kategorisi)." });
    }
    kom({ key: "total:komisyon", label: "KOMİSYON GİDERLERİ TOPLAMI", kind: "total", editable: false, strong: true });
    // İşletme geneli payı (Faz 5, sahibin kararı 4): yalnız şube seçiliyken, bilgi satırı (kâra girmez)
    if (ds.branchView) {
      sec("isletme")({ key: SHARED_KEY, label: SHARED_ROW_LABEL, kind: "info", editable: false, hint: SHARED_ROW_HINT });
    }

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
      // "Tümü" birden çok kasanın toplamıyken yazılmaz: yazılan tek şubenin ay satırına inerdi (monthTotalsLocked)
      editable: !ds.monthTotalsLocked,
      hint: `Patron > Raporlar > Ciro (indirimler düşülmüş, ödenmezler hariç). Satışlar sayfasındaki ay bilgisiyle aynıdır. Boşsa kasa raporlarının Z toplamı kullanılır.${ds.monthTotalsLocked ? ` ${ds.monthLockText ?? MONTH_TOTALS_LOCKED_TEXT}` : ""}`,
    });
    sonuc({
      key: "revenueNet",
      label: "AYLIK CİRO (KDV hariç)",
      kind: "total",
      editable: false,
      hint: `AYLIK CİRO'dan ${pctOf(st.kdv)} KDV düşülür; Satışlar'da HİZMET işaretli satırların (karaoke odası) cirosu ${pctOf(st.kdvHizmet)} ile ayrılır (Ayarlar › Oranlar). Ciro kasa raporlarından geliyorsa LafPOS'un şubesinin günleri gün gün: LafPOS gününün KDV'si kendi dökümünden, öteki günler günün oranıyla; ay günlerin toplamı.`,
    });
    // laffogato.net online satışları: yalnız bu aylardan en az biri siteden çekildiyse (çekilmemiş ay boş kalır, 0 değil)
    if (months.some((m) => siteByMonth.has(m))) {
      // Yılın kasası (metinler; geçiş günü boşken "ModPOS", sonra "LafPOS", iki kasalı yılda ikisi; denetim E-39)
      const yk = periodKasa(months, st.lafposGecisGunu);
      const from = "laffogato.net'ten çekilir (Gelir-gider › laffogato.net online satışları, her sabah ve Siteden yenile).";
      const vat = (what: string, r: number) => `KDV hariç: net − KDV − oranı bilinmeyen ${what} ${pctOf(r)} KDV'si. Kasadan (${yk.both}) geçmez; AYLIK CİRO'ya eklenmez.`;
      sonuc({ key: "site:cafe", label: "KAFE ONLİNE (SİTE + UYGULAMA)", sub: "laffogato.net · KDV hariç", kind: "auto", editable: false, hint: `Uygulama ve web kafe siparişleri (masa, gel-al, kurye), iadeler düşülmüş. Panelden elle girilen siparişler ${yk.short === "Kasa" ? "kasada" : `${yk.short}'ta`} olduğu için girmez. ${vat("siparişlerin", st.kdv)} ${from}` });
      sonuc({ key: "site:shop", label: "MAĞAZA (ONLİNE)", sub: "laffogato.net · KDV hariç", kind: "auto", editable: false, hint: `Sitenin mağaza kolileri (kargo ücreti dahil), iadeler düşülmüş. ${vat("siparişlerin", st.kdv)} ${from}` });
      sonuc({ key: "site:karaoke", label: "KARAOKE (ÖN ÖDEMELİ)", sub: "laffogato.net · KDV hariç", kind: "auto", editable: false, hint: `Sitede ödenen karaoke rezervasyonlarının köşkte kalan tutarı, parasının alındığı ayda. ${vat("rezervasyonların", st.kdvHizmet)} ${from}` });
      sonuc({ key: "revenue:total", label: "TOPLAM CİRO (KDV hariç)", kind: "total", editable: false, hint: `${yk.short} cirosu + online satışlar (KDV hariç). Kâr / zarar ve oranlar bununla hesaplanır.` });
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
        return { ...v(pm.cogs), ...(pm.cogsMethod ? { tag: COGS_METHOD_LABELS[pm.cogsMethod], info: pm.cogsInfo ?? undefined } : {}) };
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
      case SHARED_KEY:
        // Şube seçiliyken işletme geneli giderlerin toplamı (bilgi; kâra girmez) ve bileşimi
        return { ...v(pm.shared.total), info: sharedInfoText(pm.shared.parts) };
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
      default: {
        // Sabit gider ve stopaj satırının hesapta olmayan hücresi: kalem bu ay aralık dışında (başlamadı ya da bitti) ya da
        // silinmiş, elle girişi de yok. Gelir-gider'de salt okunur (aralık dışı; setPnlCell de yeni tutarı reddeder,
        // fixed-expense-rules.ts). Hücre listesine (pm.cells) eklenmez: vergi ve dışa aktarma onu okur
        const id = fixedIdOfKey(key);
        if (id !== null) {
          const fe = fixedById.get(id);
          if (!fe || !inRange(fe, pm.month)) return { ...v(null), outOfRange: true };
        }
        return v(null);
      }
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
    /** Banka POS komisyonunun kart payı: yemek kartı hariç (kasa raporu olan ayda; E-43) */
    bankShareOf,
    /** Banka POS komisyonu: Σ şube (kart × şubenin oranı); kasa kartı olmayan ayda null (eski formül). İki sayfada aynı */
    posCommission,
    /** Satışlar'ın banka POS komisyonu: süren ayda listenin dönemiyle (SalesPosCommission) */
    salesPosCommission,
    salesMonths,
    monthSales,
    /** Süren ayda yapıştırılan satış listesinin dönemi (kasa raporlarından kısaysa; yoksa null) */
    listPeriod,
    /** Ayın satış listesinden düşülecek indirim: yalnız ModPOS listesi günlerininki (LafPOS satırları indirimden sonra) */
    listDiscounts,
    /**
     * Ayın "aynı gider iki kez" bulguları: sabit gider kalemi aynı adla fatura, harcama ya da elle hücre olarak da sayılıyor
     * (duplicate-expense.ts; Genel bakış uyarısı ve Gelir-gider hücresinin işareti)
     */
    duplicateExpenses,
    /** Ayın online satışı reçeteye göre (gelir, malzeme, brüt kâr); çekilmemiş ayda null */
    onlineMonth,
    /** Online satışın ürün başına adedi (eşlenen kafe satırları ve seçenek ürünleri) */
    onlineSold,
    soldByProduct,
    ingredientUsage,
    recordedUsage,
    /** Sayılan zayi ve ikram kayıtları: panelinkiler (LafPOS gününde ürün ikramı hariç) ve LafPOS'un ikramı */
    countedWaste,
    wasteCost,
    wasteSummary,
    /** laffogato.net online satışları: ayın kaydı, ürünlere eşlenen satırlar, tüketim ve KDV hariç gelir */
    siteSales: siteSalesOf,
    siteLines,
    onlineUsage,
    /** Su faturası ayının su + buz tüketimi (satış listesi ve online); şube seçiliyken işletme genelinin satışından */
    waterUsage,
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
    /** Part-time kişinin aydaki çağrıldığı gün (Vardiya; bağlantısızsa null; `planned`: ayın bütün planı) */
    calledDaysOf,
    /** LafPOS'ta çalıştığı gün (LM-4b): `lafposDaysOf` bilgi (süren ayda bugüne kadar), `lafposMealDaysOf` yemek kartının günü (yalnız biten ay) */
    lafposDaysOf,
    lafposMealDaysOf,
    lafposUnseenOf,
    strayPartTimeShifts,
    /** Bütün sabit giderler (bitmiş / başlamamış dahil), bugünkü tutar + geçmiş */
    fixedList,
    /** Bütün personel (ayrılmış / başlamamış dahil), bugünkü maaş + geçmiş */
    staffList,
    /** Bu ayın standart sabit gider toplamı; belirli bir ay için fixedStandardTotalFor(ay) */
    fixedStandardTotal,
    fixedStandardTotalFor,
    /** Şube seçiliyken standart sabit gidere girmeyen işletme geneli kalemler (bilgi); "Tümü"de 0 */
    fixedStandardSharedFor,
    /** O ayın şubenin hesabına giren sabit giderleri ("Tümü"de hepsi; şube seçiliyken işletme geneli hariç) */
    fixedOwnInMonth,
    rentStopajMonthly,
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
    sameCountBranches,
    closingStock,
    /** Ayın reçeteye göre mal tüketimi (mal maliyetinin tahmini ve sayım aralığı dağıtımının ağırlığı) */
    cogsConsumption,
    invoicesByMonth,
    goodsPurchases,
    pnlMonth,
    posNet,
    pnlRowDefs,
    pnlValue,
    /** Aylık harcama kategorileri (sıralı) ve bir aydaki tutarları */
    expenseCategories: expenseCats,
    expenseAmounts,
    expenseExpected,
    /** Her ay girilen harcamaların bir ayın başabaşına ve tahminine giren tutarı (E-13) */
    monthlyExpensePlan,
    /** Başabaşın sabit gideri: standart aylık sabit gider + her ay girilen harcamalar */
    breakEvenFixedFor,
    closedDaysOf,
  };
}

import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { SEPARATE_CATEGORIES, settingsFromRows } from "@/lib/constants";
import { isCountable } from "@/lib/ingredient-usage";
import { asilposSalesCountFrom } from "@/lib/asilpos/sales";
import { singleTill } from "@/lib/pos/tills";
import { addDays } from "@/lib/reminders";
import { readCoverage, SALES_COVERAGE_BRANCH_KEY, SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import { buildSiteLinkIndex, siteBranchOf } from "@/lib/site-sales/calc";
import {
  AVG_DAYS,
  displayUnit,
  estimateOnlineMonth,
  estimateStock,
  onlineMonthsNeeded,
  stockQty,
  receiptsInScope,
  recipePerUnit,
  showsStockEstimate,
  STOCK_ESTIMATE_BRANCH,
  stockAlertItems,
  type EstimateIngredient,
  type StockAlertItem,
  type StockEstimate,
} from "@/lib/stock-estimate";
import { productLabel } from "@/lib/waste";
import { currentBranchScope } from "@/server/branch-scope";
import { closedDaysBetween } from "@/server/closed-days";
import { getDb, schema as s, type DB } from "@/server/db";
import { switchDayOf } from "@/server/pos/tills";
import { siteLinkSecret } from "@/server/site-link";
import { loadBranchSiteSales } from "@/server/site-sales/sync";

import { loadAsilposIkram } from "./asilpos-ikram";
import { suspectFactorLine } from "./purchase-lots-query";

/**
 * Tahmini stoğun okuyucusu (docs/STOK-TAHMINI.md; hesap src/lib/stock-estimate.ts). Yalnız okur ve yalnız Marina'nın
 * (AsilPOS'un şubesi) satırlarını: sayım, AsilPOS gün sonları ve satırları, zayi ve ikram, eşikler, Marina'ya geldiği
 * işaretli faturalar. Stok sayımına, faturalara, FIFO'ya ve mal maliyetine yazmaz. Geçiş günü boşken (kasa ModPOS)
 * null: tahmin yok.
 */

export interface StockEstimateData {
  /** İş günü (05:00 kuralı) */
  today: string;
  /** AsilPOS'a geçiş günü (Marina) */
  switchDay: string;
  /** AsilPOS satışlarının sayıldığı ilk gün */
  asilposFrom: string;
  estimate: StockEstimate;
}

/**
/**
 * Marina'nın tahmini stoğu; geçiş günü yoksa null. `asOf` (YYYY-MM-DD) verilirse tahmin o günün sonundaki stoktur: o
 * ayın sayımı başlangıç sayılmaz (yalnız önceki ayların), dönem o güne kadar. Kaçak raporu (docs/RAPORLAR.md) ayın son
 * günüyle okur ve ayın sayımıyla karşılaştırır. `leadDays`: eşik önerisinin tedarik süresi (Tahmini stok › Tedarik
 * süresi; verilmezse DEFAULT_LEAD_DAYS)
 */
export async function loadStockEstimate(
  db: DB = getDb(),
  now: Date = new Date(),
  opts: { asOf?: string; leadDays?: number } = {},
): Promise<StockEstimateData | null> {
  const today = opts.asOf ?? businessDate(now);
  const [settingRows, ingredients, products, recipeRows, counts, thresholds] = await Promise.all([
    db.select({ key: s.settings.key, value: s.settings.value }).from(s.settings),
    db
      .select({
        id: s.ingredients.id,
        name: s.ingredients.name,
        unit: s.ingredients.unit,
        countUnit: s.ingredients.countUnit,
        category: s.ingredients.category,
        sortOrder: s.ingredients.sortOrder,
        active: s.ingredients.active,
      })
      .from(s.ingredients)
      .orderBy(asc(s.ingredients.sortOrder), asc(s.ingredients.id)),
    db
      .select({ id: s.products.id, name: s.products.name, size: s.products.size, active: s.products.active, siteMenuId: s.products.siteMenuId, siteMenuSlot: s.products.siteMenuSlot })
      .from(s.products),
    db.select({ productId: s.recipeItems.productId, ingredientId: s.recipeItems.ingredientId, qty: s.recipeItems.qty, qtyExpr: s.recipeItems.qtyExpr }).from(s.recipeItems),
    db
      .select({ month: s.stockCounts.month, ingredientId: s.stockCounts.ingredientId, qty: s.stockCounts.qty, factor: s.stockCounts.factor })
      .from(s.stockCounts)
      .where(eq(s.stockCounts.branchId, STOCK_ESTIMATE_BRANCH)),
    db
      .select({ ingredientId: s.stockThresholds.ingredientId, qty: s.stockThresholds.qty })
      .from(s.stockThresholds)
      .where(eq(s.stockThresholds.branchId, STOCK_ESTIMATE_BRANCH)),
  ]);
  const settings = settingsFromRows(settingRows);
  // Tahmin Marina'nın AsilPOS gün sonlarıyla: Marina'nın kasası AsilPOS değilse tahmin yok (öteki kasalar için tahmin ayrı
  // dilim; docs/SUBE.md › Sırada ne var). Geçiş günü Marina'nın şube ayarından (switchDayOf; çok şube)
  const switchDay = await switchDayOf(STOCK_ESTIMATE_BRANCH, db);
  if (!switchDay) return null;

  // AsilPOS'un sayıldığı ilk gün: geçiş ayında Marina'nın ModPOS listesi varsa onun son gününden sonra (veri kümesiyle
  // aynı kural, src/lib/asilpos/sales.ts)
  const switchMonth = switchDay.slice(0, 7);
  const switchList = await db
    .select({ month: s.salesLines.month, branchId: s.salesLines.branchId })
    .from(s.salesLines)
    .where(and(eq(s.salesLines.month, switchMonth), eq(s.salesLines.branchId, STOCK_ESTIMATE_BRANCH)))
    .limit(1);
  // Ayın satış listesinin son günü integration_state'te (src/server/actions/sales.ts writeCoverage; veri kümesi de oradan
  // okur, src/server/data/dataset.ts): settings'te aranırsa hep boş kalır ve "AsilPOS satışları şu günden beri" yanlış görünür.
  // Marina'nın kendi kaydı, kaydı olmayan ayda ortak kayıt (readCoverage): ortak kayıt son yükleyenindir, Tuzla'nın aynı aya
  // yüklediği liste sınırı kaydırırdı
  const coverageRows = await db
    .select({ key: s.integrationState.key, value: s.integrationState.value })
    .from(s.integrationState)
    .where(inArray(s.integrationState.key, [SALES_COVERAGE_KEY, SALES_COVERAGE_BRANCH_KEY]));
  const stored = (key: string) => coverageRows.find((r) => r.key === key)?.value;
  const coverage = readCoverage(stored(SALES_COVERAGE_KEY), stored(SALES_COVERAGE_BRANCH_KEY), STOCK_ESTIMATE_BRANCH);
  // Tahminin şubesi burada AsilPOS'un şubesidir (switchDay yalnız öyleyse dolu)
  const asilposFrom = asilposSalesCountFrom(switchDay, switchList, coverage, STOCK_ESTIMATE_BRANCH) ?? switchDay;

  // Dönem en erken AsilPOS'un sayıldığı ilk günde başlar (öncesi "AsilPOS öncesi sayım"): okumalar oradan bugüne
  const range = (col: PgColumn) => and(gte(col, asilposFrom), lte(col, today));
  // Online siparişin ayları: dönem en erken AsilPOS'un sayıldığı ilk günde, ortalamanın penceresi dünden geriye
  // AVG_DAYS gün önce başlar; hangisi eskiyse onun ayından bu aya (gerekenleri ve eksikleri saf hesap ayırır)
  const branch = siteBranchOf(STOCK_ESTIMATE_BRANCH);
  const onlineOn = Boolean(siteLinkSecret()) && branch !== null;
  const onlineFrom = [asilposFrom, addDays(today, -AVG_DAYS)].reduce((a, b) => (b < a ? b : a));
  const [days, sales, panelWaste, ikram, purchases, closed, onlineRecords] = await Promise.all([
    db
      .select({ date: s.posDayReports.date })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.branchId, STOCK_ESTIMATE_BRANCH), range(s.posDayReports.date))),
    db
      .select({ date: s.posDailySales.date, posName: s.posDailySales.posName, productId: s.posDailySales.productId, isService: s.posDailySales.isService, qty: s.posDailySales.qty })
      .from(s.posDailySales)
      .where(and(eq(s.posDailySales.branchId, STOCK_ESTIMATE_BRANCH), range(s.posDailySales.date))),
    db
      .select({
        date: s.wasteEntries.date,
        kind: s.wasteEntries.kind,
        productId: s.wasteEntries.productId,
        ingredientId: s.wasteEntries.ingredientId,
        name: s.wasteEntries.name,
        qty: s.wasteEntries.qty,
        factor: s.wasteEntries.factor,
      })
      .from(s.wasteEntries)
      .where(and(eq(s.wasteEntries.branchId, STOCK_ESTIMATE_BRANCH), range(s.wasteEntries.date))),
    loadAsilposIkram(db, singleTill(STOCK_ESTIMATE_BRANCH, switchDay), { from: asilposFrom, to: today }, STOCK_ESTIMATE_BRANCH),
    receiptLots(db, asilposFrom, today),
    closedDaysBetween(asilposFrom, addDays(today, -1), db, STOCK_ESTIMATE_BRANCH),
    onlineOn && branch ? loadBranchSiteSales(branch, onlineMonthsNeeded(onlineFrom, today, 0), db) : Promise.resolve([]),
  ]);

  const byProduct = new Map(products.map((p) => [p.id, p]));
  const siteIndex = buildSiteLinkIndex(products);
  const nameOf = (id: number | null) => {
    const p = id !== null ? byProduct.get(id) : undefined;
    return p ? productLabel(p) : null;
  };
  // Sayım listesindekiler (motorla aynı kural, isCountable): sayım birimi olan aktif malzeme ya da aktif reçetede geçen
  const inActiveRecipe = new Set(recipeRows.filter((r) => byProduct.get(r.productId)?.active).map((r) => r.ingredientId));
  const listed: EstimateIngredient[] = ingredients.filter((i) => isCountable(i, inActiveRecipe.has(i.id)));

  const estimate = estimateStock({
    today,
    asilposFrom,
    receivedDays: days.map((d) => d.date),
    closedDays: closed,
    ingredients: listed,
    counts,
    purchases,
    sales: sales.map((x) => ({ ...x, productName: nameOf(x.productId) })),
    panelWaste,
    asilposWaste: ikram.lines.map((l) => ({ date: l.date, kind: l.kind, posName: l.posName, productId: l.productId, productName: nameOf(l.productId), isService: l.isService, qty: l.qty })),
    // Kasadan geçmeyen online siparişler (site bağlantısı yoksa düşülmez, uyarı da yok)
    online: onlineOn ? { months: onlineRecords.map((r) => estimateOnlineMonth(r, siteIndex, products)) } : null,
    leadDays: opts.leadDays,
    recipe: recipePerUnit(recipeRows, settings),
    fireRate: settings.fire,
    fireExcludesPackaging: settings.fireExcludesPackaging,
    thresholds: new Map(thresholds.map((t) => [t.ingredientId, t.qty])),
  });
  return { today, switchDay, asilposFrom, estimate };
}

/**
 * Marina'ya geldiği işaretli faturaların hammaddeye düşen miktarları, fatura ve hammadde başına (kendi biriminde; iade
 * faturasında eksi). Süzgeç stok değerlemenin partileriyle aynı: Paraşüt kaleminin bağlantısı, kafe dışı fatura ve
 * çarpanı şüpheli kalem girmez (src/server/data/purchase-lots-query.ts).
 */
async function receiptLots(db: DB, from: string, to: string) {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const rows = await db
    .select({
      invoiceId: inv.id,
      ingredientId: ln.ingredientId,
      date: inv.date,
      qty: sql<number>`sum(${bl.quantity} * ${ln.factor})`.mapWith(Number),
    })
    .from(bl)
    .innerJoin(inv, eq(inv.id, bl.invoiceId))
    .innerJoin(ln, eq(ln.productKey, bl.productKey))
    .where(
      and(
        // Faturanın şubesi tek kaynak (invoices.branch_id; docs/SUBE.md › Faturanın şubesi): işletme geneli ve şubesi
        // seçilmemiş fatura hiçbir şubenin tahminine girmez
        eq(inv.branchId, STOCK_ESTIMATE_BRANCH),
        gte(inv.date, from),
        lte(inv.date, to),
        notInArray(inv.category, SEPARATE_CATEGORIES),
        sql`not ${suspectFactorLine(bl)}`,
      ),
    )
    .groupBy(inv.id, ln.ingredientId, inv.date);
  return rows.filter((r) => Number.isFinite(r.qty));
}

/** Kartın verisi (Genel bakış, Bugün): Marina ya da "Tümü" seçiliyken ve kritik kalem varsa; yoksa null */
export interface StockAlertData {
  items: StockAlertItem[];
  more: number;
  total: number;
}

export async function loadStockAlert(): Promise<StockAlertData | null> {
  // Tuzla ve online kanal seçiliyken (Tuzla'ya kilitli personelde de) hiçbir şey okunmaz
  if (!showsStockEstimate(await currentBranchScope())) return null;
  const data = await loadStockEstimate();
  if (!data || !data.estimate.critical.length) return null;
  return { ...stockAlertItems(data.estimate.critical), total: data.estimate.critical.length };
}

/** Faturanın şubesi kartının satırı (yönetici; tutar yok) */
export interface ReceiptInvoice {
  id: number;
  date: string;
  supplier: string;
  /** Faturanın şubesi (invoices.branch_id); işletme geneli ya da seçilmediyse null */
  branchId: string | null;
  /** Bilinçli işletme geneli (hiçbir şubenin tahminine girmez) */
  companyWide: boolean;
  /** Hammaddeler ve miktarları ("Süt 24 LT"), en çok üçü */
  items: string[];
  more: number;
}

/** Kartta en çok kaç fatura listelenir */
export const RECEIPT_LIMIT = 100;

/** Faturanın şubesi kartı: listelenen faturalar ve dönemin bütün sayıları (liste kesilse de) */
export interface ReceiptList {
  invoices: ReceiptInvoice[];
  /** Dönemin hammaddeye bağlı kalemi olan bütün faturaları (şube seçiliyken listeye girenler) */
  total: number;
  /** Bunlardan şubesi seçilmemiş olanlar (hiçbir şubenin tahminine girmez) */
  unassigned: number;
  /**
   * Şube seçiliyken listede olmayanlar (şube ayrımı parça 5): öbür şubeye ve işletme geneline seçilmiş faturalar ("N
   * fatura başka şubede"). "Tümü"de 0
   */
  elsewhere?: { branches: number; shared: number };
}


/**
 * Dönemin (`from` – `to`) hammaddeye bağlı kalemi olan faturaları ve seçilmiş şubeleri (yönetici; Tahmini stok ›
 * Marina'ya gelen faturalar). Süzgeç stok değerlemenin partileriyle aynı. Önce şubesi seçilmeyenler (iş bekleyen), sonra
 * seçilmişler, ikisi de en yeni önce; en çok RECEIPT_LIMIT. Sayılar kesilmeden önce bütün dönemden (bulgu 42: liste
 * 100'de sessizce kesiliyor, sayaç da yalnız ilk 100'ü sayıyordu; dönem uzunsa eski seçilmeyen fatura görünmüyordu).
 */
export async function loadReceiptInvoices(from: string, to: string, db: DB = getDb(), limit = RECEIPT_LIMIT, scope: BranchScope = ALL_BRANCHES): Promise<ReceiptList> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const rows = await db
    .select({
      id: inv.id,
      date: inv.date,
      supplier: inv.supplier,
      branchId: inv.branchId,
      companyWide: inv.companyWide,
      ingredientId: ln.ingredientId,
      qty: sql<number>`sum(${bl.quantity} * ${ln.factor})`.mapWith(Number),
    })
    .from(bl)
    .innerJoin(inv, eq(inv.id, bl.invoiceId))
    .innerJoin(ln, eq(ln.productKey, bl.productKey))
    .where(and(gte(inv.date, from), lte(inv.date, to), notInArray(inv.category, SEPARATE_CATEGORIES), sql`not ${suspectFactorLine(bl)}`))
    .groupBy(inv.id, inv.date, inv.supplier, inv.branchId, inv.companyWide, ln.ingredientId)
    .orderBy(desc(inv.date), desc(inv.id));
  const ids = [...new Set(rows.map((r) => r.ingredientId))];
  const ings = ids.length
    ? await db.select({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, countUnit: s.ingredients.countUnit }).from(s.ingredients).where(inArray(s.ingredients.id, ids))
    : [];
  const ingById = new Map(ings.map((i) => [i.id, i]));
  const out = new Map<number, ReceiptInvoice & { all: string[] }>();
  for (const r of rows) {
    const ing = ingById.get(r.ingredientId);
    if (!ing || !Number.isFinite(r.qty)) continue;
    const cur = out.get(r.id) ?? { id: r.id, date: r.date, supplier: r.supplier, branchId: r.branchId ?? null, companyWide: r.companyWide, items: [], more: 0, all: [] };
    cur.all.push(`${ing.name} ${stockQty(r.qty, displayUnit(ing))}`);
    out.set(r.id, cur);
  }
  const { shown: list, elsewhere } = receiptsInScope([...out.values()], scope);
  // Şubesi seçilmemiş: ne şube ne işletme geneli (işletme geneli bilinçli bir seçimdir, iş beklemez)
  const isOpen = (i: { branchId: string | null; companyWide: boolean }) => i.branchId === null && !i.companyWide;
  const open = list.filter(isOpen);
  const ordered = [...open, ...list.filter((i) => !isOpen(i))];
  return {
    invoices: ordered.slice(0, Math.max(0, limit)).map(({ all, ...x }) => {
      const sorted = all.sort((a, b) => a.localeCompare(b, "tr"));
      return { ...x, items: sorted.slice(0, 3), more: Math.max(0, sorted.length - 3) };
    }),
    total: list.length,
    unassigned: open.length,
    ...(scope === ALL_BRANCHES ? {} : { elsewhere }),
  };
}

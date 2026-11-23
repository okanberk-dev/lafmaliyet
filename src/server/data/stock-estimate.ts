import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { businessDate } from "@/lib/cash-report";
import { SEPARATE_CATEGORIES, settingsFromRows } from "@/lib/constants";
import { isCountable } from "@/lib/ingredient-usage";
import { lafposSalesCountFrom } from "@/lib/lafpos/sales";
import { branchSwitchDay } from "@/lib/lafpos/switch";
import { addDays } from "@/lib/reminders";
import { readCoverage, SALES_COVERAGE_BRANCH_KEY, SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import {
  displayUnit,
  estimateStock,
  stockQty,
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

import { loadLafposIkram } from "./lafpos-ikram";
import { suspectFactorLine } from "./purchase-lots-query";

/**
 * Tahmini stoğun okuyucusu (docs/STOK-TAHMINI.md; hesap src/lib/stock-estimate.ts). Yalnız okur ve yalnız Marina'nın
 * (LafPOS'un şubesi) satırlarını: sayım, LafPOS gün sonları ve satırları, zayi ve ikram, eşikler, Marina'ya geldiği
 * işaretli faturalar. Stok sayımına, faturalara, FIFO'ya ve mal maliyetine yazmaz. Geçiş günü boşken (kasa ModPOS)
 * null: tahmin yok.
 */

export interface StockEstimateData {
  /** İş günü (05:00 kuralı) */
  today: string;
  /** LafPOS'a geçiş günü (Marina) */
  switchDay: string;
  /** LafPOS satışlarının sayıldığı ilk gün */
  lafposFrom: string;
  estimate: StockEstimate;
}

/** Marina'nın tahmini stoğu; geçiş günü yoksa null */
export async function loadStockEstimate(db: DB = getDb(), now: Date = new Date()): Promise<StockEstimateData | null> {
  const today = businessDate(now);
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
    db.select({ id: s.products.id, name: s.products.name, size: s.products.size, active: s.products.active }).from(s.products),
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
  const switchDay = branchSwitchDay(settings.lafposGecisGunu, STOCK_ESTIMATE_BRANCH);
  if (!switchDay) return null;

  // LafPOS'un sayıldığı ilk gün: geçiş ayında Marina'nın ModPOS listesi varsa onun son gününden sonra (veri kümesiyle
  // aynı kural, src/lib/lafpos/sales.ts)
  const switchMonth = switchDay.slice(0, 7);
  const switchList = await db
    .select({ month: s.salesLines.month, branchId: s.salesLines.branchId })
    .from(s.salesLines)
    .where(and(eq(s.salesLines.month, switchMonth), eq(s.salesLines.branchId, STOCK_ESTIMATE_BRANCH)))
    .limit(1);
  // Ayın satış listesinin son günü integration_state'te (src/server/actions/sales.ts writeCoverage; veri kümesi de oradan
  // okur, src/server/data/dataset.ts): settings'te aranırsa hep boş kalır ve "LafPOS satışları şu günden beri" yanlış görünür.
  // Marina'nın kendi kaydı, kaydı olmayan ayda ortak kayıt (readCoverage): ortak kayıt son yükleyenindir, Tuzla'nın aynı aya
  // yüklediği liste sınırı kaydırırdı
  const coverageRows = await db
    .select({ key: s.integrationState.key, value: s.integrationState.value })
    .from(s.integrationState)
    .where(inArray(s.integrationState.key, [SALES_COVERAGE_KEY, SALES_COVERAGE_BRANCH_KEY]));
  const stored = (key: string) => coverageRows.find((r) => r.key === key)?.value;
  const coverage = readCoverage(stored(SALES_COVERAGE_KEY), stored(SALES_COVERAGE_BRANCH_KEY), STOCK_ESTIMATE_BRANCH);
  const lafposFrom = lafposSalesCountFrom(switchDay, switchList, coverage) ?? switchDay;

  // Dönem en erken LafPOS'un sayıldığı ilk günde başlar (öncesi "LafPOS öncesi sayım"): okumalar oradan bugüne
  const range = (col: PgColumn) => and(gte(col, lafposFrom), lte(col, today));
  const [days, sales, panelWaste, ikram, purchases, closed] = await Promise.all([
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
    loadLafposIkram(db, switchDay, { from: lafposFrom, to: today }, STOCK_ESTIMATE_BRANCH),
    receiptLots(db, lafposFrom, today),
    closedDaysBetween(lafposFrom, addDays(today, -1), db, STOCK_ESTIMATE_BRANCH),
  ]);

  const byProduct = new Map(products.map((p) => [p.id, p]));
  const nameOf = (id: number | null) => {
    const p = id !== null ? byProduct.get(id) : undefined;
    return p ? productLabel(p) : null;
  };
  // Sayım listesindekiler (motorla aynı kural, isCountable): sayım birimi olan aktif malzeme ya da aktif reçetede geçen
  const inActiveRecipe = new Set(recipeRows.filter((r) => byProduct.get(r.productId)?.active).map((r) => r.ingredientId));
  const listed: EstimateIngredient[] = ingredients.filter((i) => isCountable(i, inActiveRecipe.has(i.id)));

  const estimate = estimateStock({
    today,
    lafposFrom,
    receivedDays: days.map((d) => d.date),
    closedDays: closed,
    ingredients: listed,
    counts,
    purchases,
    sales: sales.map((x) => ({ ...x, productName: nameOf(x.productId) })),
    panelWaste,
    lafposWaste: ikram.lines.map((l) => ({ date: l.date, kind: l.kind, posName: l.posName, productId: l.productId, productName: nameOf(l.productId), isService: l.isService, qty: l.qty })),
    recipe: recipePerUnit(recipeRows, settings),
    fireRate: settings.fire,
    fireExcludesPackaging: settings.fireExcludesPackaging,
    thresholds: new Map(thresholds.map((t) => [t.ingredientId, t.qty])),
  });
  return { today, switchDay, lafposFrom, estimate };
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
    .innerJoin(s.stockReceipts, eq(s.stockReceipts.invoiceId, inv.id))
    .where(
      and(
        eq(s.stockReceipts.branchId, STOCK_ESTIMATE_BRANCH),
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
  /** Seçilen şube; seçilmediyse null */
  branchId: string | null;
  /** Hammaddeler ve miktarları ("Süt 24 LT"), en çok üçü */
  items: string[];
  more: number;
}

/**
 * Dönemin (`from` – `to`) hammaddeye bağlı kalemi olan faturaları ve seçilmiş şubeleri, en yeni önce (yönetici; Tahmini
 * stok › Marina'ya gelen faturalar). Süzgeç stok değerlemenin partileriyle aynı.
 */
export async function loadReceiptInvoices(from: string, to: string, db: DB = getDb()): Promise<ReceiptInvoice[]> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const rows = await db
    .select({
      id: inv.id,
      date: inv.date,
      supplier: inv.supplier,
      branchId: s.stockReceipts.branchId,
      ingredientId: ln.ingredientId,
      qty: sql<number>`sum(${bl.quantity} * ${ln.factor})`.mapWith(Number),
    })
    .from(bl)
    .innerJoin(inv, eq(inv.id, bl.invoiceId))
    .innerJoin(ln, eq(ln.productKey, bl.productKey))
    .leftJoin(s.stockReceipts, eq(s.stockReceipts.invoiceId, inv.id))
    .where(and(gte(inv.date, from), lte(inv.date, to), notInArray(inv.category, SEPARATE_CATEGORIES), sql`not ${suspectFactorLine(bl)}`))
    .groupBy(inv.id, inv.date, inv.supplier, s.stockReceipts.branchId, ln.ingredientId)
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
    const cur = out.get(r.id) ?? { id: r.id, date: r.date, supplier: r.supplier, branchId: r.branchId ?? null, items: [], more: 0, all: [] };
    cur.all.push(`${ing.name} ${stockQty(r.qty, displayUnit(ing))}`);
    out.set(r.id, cur);
  }
  return [...out.values()].slice(0, 100).map(({ all, ...x }) => {
    const sorted = all.sort((a, b) => a.localeCompare(b, "tr"));
    return { ...x, items: sorted.slice(0, 3), more: Math.max(0, sorted.length - 3) };
  });
}

/** Şubesi seçilmemiş fatura sayısı (dönemin içinde) */
export function unassignedCount(invoices: readonly ReceiptInvoice[]): number {
  return invoices.filter((i) => i.branchId === null).length;
}

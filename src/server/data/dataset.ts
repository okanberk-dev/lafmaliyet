import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { activeFromRange, createModel, currentMonthTR } from "@/lib/calc/engine";
import { defaultMonthOf } from "@/lib/calc/insights";
import type { Dataset, Settings } from "@/lib/calc/types";
import { resolveMonths, tillMonths } from "@/lib/cash-month";
import { businessDate } from "@/lib/cash-report";
import { closedDaysIn } from "@/lib/closed-days";
import { settingsFromRows } from "@/lib/constants";
import { addDays } from "@/lib/reminders";
import { parseCoverage, SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import { getDb, schema as s } from "@/server/db";
import { loadSiteSales } from "@/server/site-sales/sync";

import { tillRows } from "./cash-reports";
import { mergeWithLafpos } from "./lafpos-sales";
import { loadPurchaseLots } from "./purchase-lots";

/** Kaydı olmayan ayar varsayılanı okur (settingsFromRows): yeni bir ayar için veri taşıması gerekmez */
export async function loadSettings(): Promise<Settings> {
  return settingsFromRows(await getDb().select().from(s.settings));
}

/** Hesaplama motorunun ihtiyaç duyduğu bütün veriyi tek seferde, paralel okur. */
export async function loadDataset(): Promise<Dataset> {
  const db = getDb();
  const [
    settings,
    ingredients,
    categories,
    products,
    recipeItems,
    months,
    salesLines,
    invoices,
    staff,
    staffVersions,
    fixedExpenses,
    fixedExpenseVersions,
    pnlEntries,
    stockCounts,
    ingredientPrices,
    purchaseLots,
    stockExtras,
    purchaseQuantities,
    expenseCategories,
    expenseEntries,
    wasteEntries,
    siteSales,
    coverageRow,
    till,
    lateWaiting,
    closedRows,
  ] = await Promise.all([
    loadSettings(),
    db.select().from(s.ingredients).orderBy(asc(s.ingredients.sortOrder), asc(s.ingredients.id)),
    db.select().from(s.categories).orderBy(asc(s.categories.sortOrder)),
    db.select().from(s.products).orderBy(asc(s.products.sortOrder), asc(s.products.id)),
    db.select().from(s.recipeItems).orderBy(asc(s.recipeItems.sortOrder), asc(s.recipeItems.id)),
    db.select().from(s.months).orderBy(asc(s.months.month)),
    db.select().from(s.salesLines).orderBy(asc(s.salesLines.sortOrder), asc(s.salesLines.id)),
    db.select().from(s.invoices).orderBy(asc(s.invoices.date), asc(s.invoices.id)),
    db.select().from(s.staff).orderBy(asc(s.staff.sortOrder), asc(s.staff.id)),
    db.select().from(s.staffVersions).orderBy(asc(s.staffVersions.staffId), asc(s.staffVersions.fromMonth)),
    db.select().from(s.fixedExpenses).orderBy(asc(s.fixedExpenses.sortOrder), asc(s.fixedExpenses.id)),
    db.select().from(s.fixedExpenseVersions).orderBy(asc(s.fixedExpenseVersions.fixedExpenseId), asc(s.fixedExpenseVersions.fromMonth)),
    db.select().from(s.pnlEntries),
    db.select().from(s.stockCounts),
    // Sayımlar ay sonunda geçerli fiyatla değerlenir (engine.ts stockSheet)
    db
      .select({
        ingredientId: s.ingredientPrices.ingredientId,
        packagePrice: s.ingredientPrices.packagePrice,
        packageSize: s.ingredientPrices.packageSize,
        changedAt: s.ingredientPrices.changedAt,
      })
      .from(s.ingredientPrices)
      .orderBy(asc(s.ingredientPrices.changedAt), asc(s.ingredientPrices.id)),
    // Stok değerleme (FIFO) partileri: Paraşüt faturalarının hammaddeye bağlı kalemleri (purchase-lots.ts)
    loadPurchaseLots(),
    db.select().from(s.stockExtras).orderBy(asc(s.stockExtras.id)),
    db.select().from(s.purchaseQuantities),
    db.select().from(s.expenseCategories).orderBy(asc(s.expenseCategories.sortOrder), asc(s.expenseCategories.id)),
    db.select().from(s.expenseEntries).orderBy(asc(s.expenseEntries.date), asc(s.expenseEntries.id)),
    db
      .select({
        date: s.wasteEntries.date,
        kind: s.wasteEntries.kind,
        productId: s.wasteEntries.productId,
        ingredientId: s.wasteEntries.ingredientId,
        qty: s.wasteEntries.qty,
        factor: s.wasteEntries.factor,
      })
      .from(s.wasteEntries),
    // laffogato.net online satışları (ay başına kayıt; docs/SITE-SATIS.md)
    loadSiteSales(),
    // Süren ayda yüklenen satış listesinin son günü (src/lib/sales-coverage.ts)
    db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, SALES_COVERAGE_KEY)).limit(1),
    // Kasa raporlarının ay bilgisine giden sütunları (src/lib/cash-month.ts)
    tillRows(),
    // Personelin onay bekleyen geç kasa raporlarının günleri: ay bilgisinde eksik sayılmaya devam eder, "onay bekliyor"
    db
      .selectDistinct({ day: s.staffRequests.day })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kasa-gec"), eq(s.staffRequests.status, "pending"))),
    // Kapalı işaretli günler (özel günlerin `kapali` satırı): ay bilgisinde eksik sayılmaz, ayrı yazılır
    db.select({ kind: s.specialDays.kind, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo }).from(s.specialDays).where(eq(s.specialDays.kind, "kapali")),
  ]);

  // Okumalardan sonra: "bu ay" Türkiye saatine göre (aktiflik ve listelerdeki güncel tutar buna bakar)
  const currentMonth = currentMonthTR();
  // Kasa raporlarının eksik günleri düne kadar aranır (bugünün raporu akşam girilir); saat de okumalardan sonra
  const today = businessDate();
  const through = addDays(today, -1);
  // Satış satırları: Satışlar'a yüklenen ModPOS listeleri; LafPOS'a geçiş günü seçiliyse o günden itibaren LafPOS'un
  // günlük satışları ay toplamı olarak (her gün tek kaynak; src/lib/lafpos/sales.ts). Geçiş günü yoksa LafPOS okunmaz,
  // satırlar ve kapsam bugünkü gibi
  const sales = await mergeWithLafpos(db, {
    switchDay: settings.lafposGecisGunu,
    salesLines: salesLines.map((l) => ({
      id: l.id,
      month: l.month,
      posName: l.posName,
      qty: l.qty,
      revenue: l.revenue,
      productId: l.productId,
      isService: l.isService,
      note: l.note,
    })),
    coverage: parseCoverage(coverageRow[0]?.value),
    today,
    // Kasa raporlarının son günü (till tarihe göre sıralı): süren ayın sonraki LafPOS günleri rapor girilince sayılır
    lastTillDay: till.at(-1)?.date ?? null,
    zOf: (from, upto) => {
      const rows = till.filter((r) => r.date >= from && r.date <= upto);
      return rows.length ? Math.round(rows.reduce((a, r) => a + r.zTotal, 0) * 100) / 100 : null;
    },
  });
  // Satış listesinin son gününe kadarki kasa raporları (aynı ilk rapor günüyle: ay ortasında başlayan ilk ay aynı tanınır)
  const firstEver = till.reduce<string | null>((a, r) => (a === null || r.date < a ? r.date : a), null);
  const salesCoverage = Object.entries(sales.coverage).map(([month, upto]) => ({
    month,
    through: upto,
    till: tillMonths(till.filter((r) => r.date.slice(0, 7) === month && r.date <= upto), upto, firstEver)[0] ?? null,
  }));

  return {
    settings,
    currentMonth,
    salesCoverage,
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      supplier: i.supplier,
      packageDesc: i.packageDesc,
      packagePrice: i.packagePrice,
      packageSize: i.packageSize,
      unit: i.unit,
      vatRate: i.vatRate,
      note: i.note,
      isEstimate: i.isEstimate,
      priceSource: i.priceSource,
      countUnit: i.countUnit,
      countGroup: i.countGroup,
      countFrom: i.countFrom,
      sortOrder: i.sortOrder,
      active: i.active,
    })),
    categories,
    products: products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      size: p.size,
      price: p.price,
      fireOverride: p.fireOverride,
      note: p.note,
      active: p.active,
      showOnMenu: p.showOnMenu,
      sortOrder: p.sortOrder,
      siteMenuId: p.siteMenuId,
      siteMenuSlot: p.siteMenuSlot,
    })),
    recipeItems,
    // Etkin ay bilgisi: elle yazılan, yoksa kasa raporlarından (hiçbir şey months'a kopyalanmaz); yalnız kasa raporu
    // olan ay da gelir. Kaynaklar (sources) ve kasanın değerleri (kasa) ekranlar için Month'ta taşınır
    months: resolveMonths(
      months.map((m) => ({
        month: m.month,
        openDays: m.openDays,
        posRevenue: m.posRevenue,
        discounts: m.discounts,
        offRevenue: m.offRevenue,
        cardShare: m.cardShare,
        note: m.note,
      })),
      tillMonths(
        till,
        through,
        undefined,
        lateWaiting.flatMap((r) => (r.day ? [r.day] : [])),
        closedDaysIn(closedRows, "2000-01-01", through, till.map((r) => r.date)),
      ),
    ),
    salesLines: sales.salesLines,
    ...(sales.lafposSales ? { lafposSales: sales.lafposSales } : {}),
    invoices: invoices.map((i) => ({
      id: i.id,
      date: i.date,
      supplier: i.supplier,
      description: i.description,
      invoiceNo: i.invoiceNo,
      category: i.category,
      amount: i.amount,
      discount: i.discount,
      payable: i.payable,
      vat: i.vat,
      unpaid: i.unpaid,
      note: i.note,
      source: i.source,
      externalId: i.externalId,
      dueDate: i.dueDate,
      outstanding: i.outstanding,
      allocated: i.allocated,
      ledgerBase: i.ledgerBase,
      paidByLedger: i.paidByLedger,
      eInvoiceId: i.eInvoiceId,
      needsReview: i.needsReview,
      paidAt: i.paidAt,
      paymentRequestedAt: i.paymentRequestedAt,
    })),
    // netSalary / extras ve period / amount taban değerlerdir (ilk sürümden önceki aylar).
    // active sütuna değil aralığa göre hesaplanır: ay değişince kendiliğinden doğru olur.
    staff: staff.map((x) => ({
      id: x.id,
      name: x.name,
      netSalary: x.netSalary,
      extras: x.extras,
      active: activeFromRange(x.endMonth, currentMonth),
      startMonth: x.startMonth,
      endMonth: x.endMonth,
    })),
    staffVersions: staffVersions.map((v) => ({ id: v.id, staffId: v.staffId, fromMonth: v.fromMonth, netSalary: v.netSalary, extras: v.extras })),
    fixedExpenses: fixedExpenses.map((f) => ({
      id: f.id,
      name: f.name,
      section: f.section,
      period: f.period,
      amount: f.amount,
      vatRate: f.vatRate,
      note: f.note,
      active: activeFromRange(f.endMonth, currentMonth),
      startMonth: f.startMonth,
      endMonth: f.endMonth,
      sortOrder: f.sortOrder,
    })),
    fixedExpenseVersions: fixedExpenseVersions.map((v) => ({
      id: v.id,
      fixedExpenseId: v.fixedExpenseId,
      fromMonth: v.fromMonth,
      period: v.period,
      amount: v.amount,
    })),
    pnlEntries: pnlEntries.map((e) => ({ month: e.month, rowKey: e.rowKey, amount: e.amount, note: e.note })),
    stockCounts: stockCounts.map((c) => ({ month: c.month, ingredientId: c.ingredientId, qty: c.qty, factor: c.factor })),
    ingredientPrices: ingredientPrices.map((r) => ({ ...r, changedAt: r.changedAt.toISOString() })),
    purchaseLots,
    stockExtras: stockExtras.map((e) => ({
      id: e.id,
      month: e.month,
      name: e.name,
      unit: e.unit,
      qty: e.qty,
      unitPrice: e.unitPrice,
    })),
    purchaseQuantities: purchaseQuantities.map((p) => ({
      month: p.month,
      ingredientId: p.ingredientId,
      qty: p.qty,
      note: p.note,
    })),
    expenseCategories: expenseCategories.map((c) => ({
      id: c.id,
      name: c.name,
      section: c.section,
      panelGroup: c.panelGroup,
      invoiceCategory: c.invoiceCategory,
      monthly: c.monthly,
      active: c.active,
      sortOrder: c.sortOrder,
    })),
    wasteEntries,
    siteSales,
    expenseEntries: expenseEntries.map((e) => ({
      id: e.id,
      date: e.date,
      categoryId: e.categoryId,
      description: e.description,
      amount: e.amount,
      paymentMethod: e.paymentMethod,
      note: e.note,
    })),
  };
}

export async function loadModel() {
  return createModel(await loadDataset());
}

/**
 * URL'deki ?ay= değerini doğrular; yoksa satış verisi olan son ayı döner (bu aydan sonraki aylar, ör. ileri tarihli
 * deneme verisi, varsayılan olmaz). Kural: defaultMonthOf (src/lib/calc/insights.ts, tests/insights-month.test.ts).
 */
export function resolveMonth(param: string | string[] | undefined, model: ReturnType<typeof createModel>): string {
  const v = Array.isArray(param) ? param[0] : param;
  if (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  return defaultMonthOf(model.salesMonths, [...model.monthInfo.keys()], model.ds.currentMonth ?? currentMonthTR());
}

/** Ay seçicide gösterilecek aylar (veri olan aylar + bir sonraki ay) */
export function availableMonths(model: ReturnType<typeof createModel>): string[] {
  const set = new Set<string>(model.monthInfo.keys());
  for (const m of model.salesMonths) set.add(m);
  for (const inv of model.ds.invoices) set.add(inv.date.slice(0, 7));
  for (const c of model.ds.stockCounts) set.add(c.month);
  const sorted = [...set].sort();
  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    const [y, m] = last.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    sorted.push(next);
  }
  return sorted;
}

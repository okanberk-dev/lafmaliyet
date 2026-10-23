import "server-only";

import { asc } from "drizzle-orm";

import { activeFromRange, createModel, currentMonthTR } from "@/lib/calc/engine";
import { defaultMonthOf } from "@/lib/calc/insights";
import type { Dataset, Settings } from "@/lib/calc/types";
import { resolveMonths, tillMonths } from "@/lib/cash-month";
import { businessDate } from "@/lib/cash-report";
import { settingsFromRows } from "@/lib/constants";
import { addDays } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { loadSiteSales } from "@/server/site-sales/sync";

import { tillRows } from "./cash-reports";

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
    stockExtras,
    purchaseQuantities,
    expenseCategories,
    expenseEntries,
    wasteEntries,
    siteSales,
    till,
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
    // Kasa raporlarının ay bilgisine giden sütunları (src/lib/cash-month.ts)
    tillRows(),
  ]);

  // Okumalardan sonra: "bu ay" Türkiye saatine göre (aktiflik ve listelerdeki güncel tutar buna bakar)
  const currentMonth = currentMonthTR();
  // Kasa raporlarının eksik günleri düne kadar aranır (bugünün raporu akşam girilir); saat de okumalardan sonra
  const through = addDays(businessDate(), -1);

  return {
    settings,
    currentMonth,
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
      tillMonths(till, through),
    ),
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
      unpaid: i.unpaid,
      note: i.note,
      source: i.source,
      externalId: i.externalId,
      dueDate: i.dueDate,
      outstanding: i.outstanding,
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

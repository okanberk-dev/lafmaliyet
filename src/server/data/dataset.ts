import "server-only";

import { asc } from "drizzle-orm";

import { createModel } from "@/lib/calc/engine";
import type { Dataset, Settings } from "@/lib/calc/types";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { getDb, schema as s } from "@/server/db";

export async function loadSettings(): Promise<Settings> {
  const rows = await getDb().select().from(s.settings);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  }
  return out as unknown as Settings;
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
    fixedExpenses,
    pnlEntries,
    stockCounts,
    stockExtras,
    purchaseQuantities,
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
    db.select().from(s.fixedExpenses).orderBy(asc(s.fixedExpenses.sortOrder), asc(s.fixedExpenses.id)),
    db.select().from(s.pnlEntries),
    db.select().from(s.stockCounts),
    db.select().from(s.stockExtras).orderBy(asc(s.stockExtras.id)),
    db.select().from(s.purchaseQuantities),
  ]);

  return {
    settings,
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
    })),
    recipeItems,
    months: months.map((m) => ({
      month: m.month,
      openDays: m.openDays,
      posRevenue: m.posRevenue,
      discounts: m.discounts,
      offRevenue: m.offRevenue,
      note: m.note,
    })),
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
    })),
    staff: staff.map((x) => ({ id: x.id, name: x.name, netSalary: x.netSalary, extras: x.extras, active: x.active })),
    fixedExpenses: fixedExpenses.map((f) => ({
      id: f.id,
      name: f.name,
      section: f.section,
      period: f.period,
      amount: f.amount,
      note: f.note,
      active: f.active,
      sortOrder: f.sortOrder,
    })),
    pnlEntries: pnlEntries.map((e) => ({ month: e.month, rowKey: e.rowKey, amount: e.amount })),
    stockCounts: stockCounts.map((c) => ({ month: c.month, ingredientId: c.ingredientId, qty: c.qty })),
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
  };
}

export async function loadModel() {
  return createModel(await loadDataset());
}

/** URL'deki ?ay= değerini doğrular; yoksa satış verisi olan son ayı döner. */
export function resolveMonth(param: string | string[] | undefined, model: ReturnType<typeof createModel>): string {
  const v = Array.isArray(param) ? param[0] : param;
  if (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  if (model.salesMonths.length) return model.salesMonths[model.salesMonths.length - 1];
  const months = [...model.monthInfo.keys()].sort();
  if (months.length) return months[months.length - 1];
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

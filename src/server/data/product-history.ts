import "server-only";

import { and, count, eq, isNotNull, ne } from "drizzle-orm";

import type { ProductHistoryCounts } from "@/lib/product-delete";
import { buildSiteLinkIndex, productForLine } from "@/lib/site-sales/calc";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadSiteSales } from "@/server/site-sales/sync";

/**
 * Ürünün geçmişi (silme engeli, src/lib/product-delete.ts): ModPOS satış satırı, AsilPOS'un günlük satış satırı, zayi /
 * ikram, ilk kayıt dışındaki fiyat değişiklikleri ve bağlı olduğu site kaleminin online satışı olan aylar
 */
export async function productHistoryCounts(p: { id: number; siteMenuId: string | null; siteMenuSlot: "M" | "L" | null }): Promise<ProductHistoryCounts> {
  const db = getDb();
  const [salesLines, posDailySales, [waste], [prices], siteMonths] = await Promise.all([
    salesLinesCount(p.id),
    posDailySalesCount(p.id),
    db.select({ n: count() }).from(s.wasteEntries).where(eq(s.wasteEntries.productId, p.id)),
    db.select({ n: count() }).from(s.productPrices).where(and(eq(s.productPrices.productId, p.id), ne(s.productPrices.source, "create"))),
    p.siteMenuId && p.siteMenuSlot ? loadSiteSales() : Promise.resolve([]),
  ]);
  const index = buildSiteLinkIndex([p]);
  const onlineMonths = siteMonths.filter((m) => m.cafe.lines.some((l) => productForLine(l, index) === p.id)).length;
  return { salesLines, posDailySales, waste: waste.n, priceChanges: prices.n, onlineMonths };
}

/**
 * Ürüne bağlı ModPOS satış satırı (sales_lines; sayılmayan aydaki liste dahil). Ürün kartı da bunu okur: aylık modelin
 * satırları AsilPOS'a geçilen ayların listesini içermez, kart ile eylem ayrı sayardı (denetim B08 incelemesi)
 */
export async function salesLinesCount(productId: number, db: DB = getDb()): Promise<number> {
  // ŞUBEYE GÖRE SÜZÜLMEZ: bu bir görünüm değil, silme güvenliği. Marina'ya bakarken Tuzla'da satılmış ürün
  // silinebilir olurdu (tests/urunler.test.ts bekçisi).
  const [r] = await db.select({ n: count() }).from(s.salesLines).where(eq(s.salesLines.productId, productId));
  return r?.n ?? 0;
}

/** Ürüne bağlı AsilPOS günlük satış satırı (pos_daily_sales; silinirse bağı sessizce kopardı: FK "set null") */
export async function posDailySalesCount(productId: number, db: DB = getDb()): Promise<number> {
  const [r] = await db.select({ n: count() }).from(s.posDailySales).where(eq(s.posDailySales.productId, productId));
  return r?.n ?? 0;
}

/**
 * Hammaddelerin silmeyi engelleyen geçmişi (deleteIngredient'ın saydığı tablolar; şube kapsamı C P2-6): sayım, alım
 * miktarı ve zayi / ikram, BÜTÜN ŞUBELERDEN. Hammaddeler ekranı önceden şubenin modelinden sayıyordu: Marina seçiliyken
 * yalnız Tuzla'da sayılmış malzeme "silinebilir" görünüp eylemde reddediliyordu. Paraşüt eşleştirmesi sayfanın kendi
 * sorgusunda
 */
export async function ingredientHistoryCounts(db: DB = getDb()): Promise<Map<number, { counts: number; purchases: number; waste: number }>> {
  const [counts, purchases, waste] = await Promise.all([
    db.select({ id: s.stockCounts.ingredientId, n: count() }).from(s.stockCounts).groupBy(s.stockCounts.ingredientId),
    db.select({ id: s.purchaseQuantities.ingredientId, n: count() }).from(s.purchaseQuantities).groupBy(s.purchaseQuantities.ingredientId),
    db.select({ id: s.wasteEntries.ingredientId, n: count() }).from(s.wasteEntries).where(isNotNull(s.wasteEntries.ingredientId)).groupBy(s.wasteEntries.ingredientId),
  ]);
  const out = new Map<number, { counts: number; purchases: number; waste: number }>();
  const at = (id: number) => out.get(id) ?? out.set(id, { counts: 0, purchases: 0, waste: 0 }).get(id)!;
  for (const r of counts) at(r.id).counts = r.n;
  for (const r of purchases) at(r.id).purchases = r.n;
  for (const r of waste) if (r.id !== null) at(r.id).waste = r.n;
  return out;
}

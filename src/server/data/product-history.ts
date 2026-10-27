import "server-only";

import { and, count, eq, ne } from "drizzle-orm";

import type { ProductHistoryCounts } from "@/lib/product-delete";
import { buildSiteLinkIndex, productForLine } from "@/lib/site-sales/calc";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadSiteSales } from "@/server/site-sales/sync";

/**
 * Ürünün geçmişi (silme engeli, src/lib/product-delete.ts): ModPOS satış satırı, LafPOS'un günlük satış satırı, zayi /
 * ikram, ilk kayıt dışındaki fiyat değişiklikleri ve bağlı olduğu site kaleminin online satışı olan aylar
 */
export async function productHistoryCounts(p: { id: number; siteMenuId: string | null; siteMenuSlot: "M" | "L" | null }): Promise<ProductHistoryCounts> {
  const db = getDb();
  const [[sales], posDailySales, [waste], [prices], siteMonths] = await Promise.all([
    db.select({ n: count() }).from(s.salesLines).where(eq(s.salesLines.productId, p.id)),
    posDailySalesCount(p.id),
    db.select({ n: count() }).from(s.wasteEntries).where(eq(s.wasteEntries.productId, p.id)),
    db.select({ n: count() }).from(s.productPrices).where(and(eq(s.productPrices.productId, p.id), ne(s.productPrices.source, "create"))),
    p.siteMenuId && p.siteMenuSlot ? loadSiteSales() : Promise.resolve([]),
  ]);
  const index = buildSiteLinkIndex([p]);
  const onlineMonths = siteMonths.filter((m) => m.cafe.lines.some((l) => productForLine(l, index) === p.id)).length;
  return { salesLines: sales.n, posDailySales, waste: waste.n, priceChanges: prices.n, onlineMonths };
}

/** Ürüne bağlı LafPOS günlük satış satırı (pos_daily_sales; silinirse bağı sessizce kopardı: FK "set null") */
export async function posDailySalesCount(productId: number, db: DB = getDb()): Promise<number> {
  const [r] = await db.select({ n: count() }).from(s.posDailySales).where(eq(s.posDailySales.productId, productId));
  return r?.n ?? 0;
}

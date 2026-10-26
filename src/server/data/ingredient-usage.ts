import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import type { UsageProduct } from "@/lib/ingredient-usage";
import { schema as s, type DB } from "@/server/db";

/** Veritabanı ya da işlem (transaction): yalnız okur */
type Reader = Pick<DB, "select">;

/**
 * Malzemeleri reçetesinde kullanan aktif ürünler (malzeme kimliği → ürünler, ürün sırasıyla). Pasif yapma engeli ve
 * sayım kaydının "listede mi" denetimi bunu kullanır (kural src/lib/ingredient-usage.ts; motorda engine.ts usedInActive).
 */
export async function activeProductsUsing(db: Reader, ingredientIds: number[]): Promise<Map<number, UsageProduct[]>> {
  const out = new Map<number, UsageProduct[]>();
  if (!ingredientIds.length) return out;
  const rows = await db
    .select({ ingredientId: s.recipeItems.ingredientId, id: s.products.id, name: s.products.name, size: s.products.size })
    .from(s.recipeItems)
    .innerJoin(s.products, eq(s.products.id, s.recipeItems.productId))
    .where(and(eq(s.products.active, true), inArray(s.recipeItems.ingredientId, ingredientIds)))
    .orderBy(asc(s.products.sortOrder), asc(s.products.id));
  for (const r of rows) {
    const list = out.get(r.ingredientId) ?? [];
    if (!list.some((p) => p.id === r.id)) list.push({ id: r.id, name: r.name, size: r.size });
    out.set(r.ingredientId, list);
  }
  return out;
}

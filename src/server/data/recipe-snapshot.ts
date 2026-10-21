import "server-only";

import { asc, eq } from "drizzle-orm";

import type { RecipeSnapshot } from "@/lib/recipe-change";
import { getDb, schema as s } from "@/server/db";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Ürünün bugünkü reçetesi (satırlar sırasıyla, malzeme adı ve birimiyle) ve hazırlama notu */
export async function currentSnapshot(productId: number, db: Tx | ReturnType<typeof getDb> = getDb()): Promise<RecipeSnapshot | null> {
  const [product] = await db.select({ note: s.products.note }).from(s.products).where(eq(s.products.id, productId)).limit(1);
  if (!product) return null;
  const items = await db
    .select({
      ingredientId: s.recipeItems.ingredientId,
      name: s.ingredients.name,
      unit: s.ingredients.unit,
      qty: s.recipeItems.qty,
      qtyExpr: s.recipeItems.qtyExpr,
      note: s.recipeItems.note,
    })
    .from(s.recipeItems)
    .innerJoin(s.ingredients, eq(s.ingredients.id, s.recipeItems.ingredientId))
    .where(eq(s.recipeItems.productId, productId))
    .orderBy(asc(s.recipeItems.sortOrder), asc(s.recipeItems.id));
  return { note: product.note, items };
}

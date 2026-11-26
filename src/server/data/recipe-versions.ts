import "server-only";

import { desc, eq } from "drizzle-orm";

import { diffRecipe, sameRecipe, summarizeDiff, type RecipeSnapshot } from "@/lib/recipe-change";
import { getDb, schema as s } from "@/server/db";

import { currentSnapshot } from "./recipe-snapshot";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Reader = Tx | ReturnType<typeof getDb>;

/** Reçete geçmişinin kaynağı: ürün kartı, personelin onaylanan önerisi, ürün açılırken yazılan ilk reçete */
export type RecipeVersionSource = "edit" | "approval" | "create";

/**
 * Reçete geçmişine bir sürüm yazar (docs/DONEM-KAPANISI.md › Reçete geçmişi): reçeteyi değiştiren işlemin içinde,
 * değişiklikten sonra çağrılır. `after` verilmezse ürünün yazılmış reçetesi okunur. Reçete değişmediyse (yalnız ad,
 * fiyat, fire kaydedildi) yazılmaz. Döner: yazıldı mı.
 */
export async function recordRecipeVersion(
  tx: Reader,
  v: { productId: number; before: RecipeSnapshot; after?: RecipeSnapshot; source: RecipeVersionSource; by: { id?: number | null; name: string }; requestedByName?: string | null },
): Promise<boolean> {
  const after = v.after ?? (await currentSnapshot(v.productId, tx));
  if (!after || sameRecipe(v.before, after)) return false;
  await tx.insert(s.recipeVersions).values({
    productId: v.productId,
    source: v.source,
    before: v.before,
    after,
    summary: summarizeDiff(diffRecipe(v.before, after)),
    changedBy: v.by.id ?? null,
    changedByName: v.by.name,
    requestedByName: v.requestedByName ?? null,
  });
  return true;
}

export interface RecipeVersionRow {
  id: number;
  source: RecipeVersionSource;
  before: RecipeSnapshot;
  after: RecipeSnapshot;
  summary: string;
  changedByName: string;
  requestedByName: string | null;
  /** ISO an */
  at: string;
}

/** Ürünün reçete geçmişi, yeniden eskiye (ürün kartı en çok son 30'u gösterir) */
export async function loadRecipeVersions(productId: number, limit = 30, db: Reader = getDb()): Promise<RecipeVersionRow[]> {
  const rows = await db
    .select()
    .from(s.recipeVersions)
    .where(eq(s.recipeVersions.productId, productId))
    .orderBy(desc(s.recipeVersions.createdAt), desc(s.recipeVersions.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    before: r.before,
    after: r.after,
    summary: r.summary,
    changedByName: r.changedByName,
    requestedByName: r.requestedByName,
    at: r.createdAt.toISOString(),
  }));
}

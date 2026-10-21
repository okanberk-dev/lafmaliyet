import "server-only";

import { and, count, desc, eq, gt, inArray, or } from "drizzle-orm";

import type { RequestStatus } from "@/lib/recipe-change";
import { getDb, schema as s } from "@/server/db";

export interface RecipeRequestRow {
  id: number;
  productId: number;
  productName: string;
  size: "M" | "L" | "Tek";
  status: RequestStatus;
  requestedBy: number | null;
  requestedByName: string;
  before: typeof s.recipeChangeRequests.$inferSelect.before;
  after: typeof s.recipeChangeRequests.$inferSelect.after;
  message: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
}

const columns = {
  id: s.recipeChangeRequests.id,
  productId: s.recipeChangeRequests.productId,
  productName: s.products.name,
  size: s.products.size,
  status: s.recipeChangeRequests.status,
  requestedBy: s.recipeChangeRequests.requestedBy,
  requestedByName: s.recipeChangeRequests.requestedByName,
  before: s.recipeChangeRequests.before,
  after: s.recipeChangeRequests.after,
  message: s.recipeChangeRequests.message,
  reviewNote: s.recipeChangeRequests.reviewNote,
  reviewedByName: s.recipeChangeRequests.reviewedByName,
  createdAt: s.recipeChangeRequests.createdAt,
  updatedAt: s.recipeChangeRequests.updatedAt,
  reviewedAt: s.recipeChangeRequests.reviewedAt,
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/** Onay bekleyen öneri sayısı (zil ve reçete defterindeki şerit) */
export async function countPendingRequests(): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(s.recipeChangeRequests).where(eq(s.recipeChangeRequests.status, "pending"));
  return row?.n ?? 0;
}

/** Yönetici: bekleyenler (eskiden yeniye) ve son `days` günde karara bağlananlar (yeniden eskiye) */
export async function loadReviewQueue(days = 30): Promise<{ pending: RecipeRequestRow[]; recent: RecipeRequestRow[] }> {
  const db = getDb();
  const [pending, recent] = await Promise.all([
    db
      .select(columns)
      .from(s.recipeChangeRequests)
      .innerJoin(s.products, eq(s.products.id, s.recipeChangeRequests.productId))
      .where(eq(s.recipeChangeRequests.status, "pending"))
      .orderBy(s.recipeChangeRequests.createdAt),
    db
      .select(columns)
      .from(s.recipeChangeRequests)
      .innerJoin(s.products, eq(s.products.id, s.recipeChangeRequests.productId))
      .where(and(inArray(s.recipeChangeRequests.status, ["approved", "rejected", "withdrawn"]), gt(s.recipeChangeRequests.updatedAt, daysAgo(days))))
      .orderBy(desc(s.recipeChangeRequests.updatedAt))
      .limit(40),
  ]);
  return { pending, recent };
}

/** Kişinin önerileri: bekleyenler ve son `days` günde sonuçlananlar (yeniden eskiye) */
export async function loadMyRequests(userId: number, days = 14): Promise<RecipeRequestRow[]> {
  return getDb()
    .select(columns)
    .from(s.recipeChangeRequests)
    .innerJoin(s.products, eq(s.products.id, s.recipeChangeRequests.productId))
    .where(
      and(
        eq(s.recipeChangeRequests.requestedBy, userId),
        or(eq(s.recipeChangeRequests.status, "pending"), gt(s.recipeChangeRequests.updatedAt, daysAgo(days))),
      ),
    )
    .orderBy(desc(s.recipeChangeRequests.updatedAt))
    .limit(50);
}

/** Ürün başına bekleyen öneri sayısı (yöneticinin reçete defterindeki rozet) */
export async function pendingByProduct(): Promise<Map<number, number>> {
  const rows = await getDb()
    .select({ productId: s.recipeChangeRequests.productId, n: count() })
    .from(s.recipeChangeRequests)
    .where(eq(s.recipeChangeRequests.status, "pending"))
    .groupBy(s.recipeChangeRequests.productId);
  return new Map(rows.map((r) => [r.productId, r.n]));
}

import "server-only";

import { and, count, desc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";

import type { ProductSize, ProposedProduct, RequestKind, RequestStatus } from "@/lib/recipe-change";
import { getDb, schema as s } from "@/server/db";

export interface RecipeRequestRow {
  id: number;
  kind: RequestKind;
  /** Değişiklik önerisinde ürün; yeni ürün önerisinde onaylanana kadar null (onayda açılan ürün) */
  productId: number | null;
  /** Ürün varsa bugünkü adı ve boyu, yoksa önerilen */
  productName: string;
  size: ProductSize;
  /** Yalnız yeni ürün önerisinde: önerilen ad, boy ve kategori */
  proposed: ProposedProduct | null;
  /** Yeni ürün önerisinde personelin yazdığı satış fiyatı (yazılmadıysa ya da eski öneride null) */
  proposedPrice: number | null;
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
  kind: s.recipeChangeRequests.kind,
  productId: s.recipeChangeRequests.productId,
  currentName: s.products.name,
  currentSize: s.products.size,
  proposed: s.recipeChangeRequests.proposed,
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

/**
 * Yeni ürün önerisinin ürünü onaylanana kadar yok (productId boş): ürün tablosu sol birleşimle okunur, ad ve boy
 * ürün yoksa önerilenden gelir.
 */
function toRow({
  currentName,
  currentSize,
  ...r
}: Omit<RecipeRequestRow, "productName" | "size" | "proposedPrice"> & { currentName: string | null; currentSize: ProductSize | null }): RecipeRequestRow {
  const proposedPrice = r.proposed?.price;
  return {
    ...r,
    productName: currentName ?? r.proposed?.name ?? "?",
    size: currentSize ?? r.proposed?.size ?? "M",
    proposedPrice: typeof proposedPrice === "number" && proposedPrice > 0 ? proposedPrice : null,
  };
}

const select = () => getDb().select(columns).from(s.recipeChangeRequests).leftJoin(s.products, eq(s.products.id, s.recipeChangeRequests.productId));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/** Onay bekleyen öneri sayısı, iki tür birlikte */
export async function countPendingRequests(): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(s.recipeChangeRequests).where(eq(s.recipeChangeRequests.status, "pending"));
  return row?.n ?? 0;
}

/** Onay bekleyenler türüne göre: reçete değişikliği ve yeni ürün önerisi (reçete defterindeki şerit) */
export async function countPendingByKind(): Promise<Record<RequestKind, number>> {
  const rows = await getDb()
    .select({ kind: s.recipeChangeRequests.kind, n: count() })
    .from(s.recipeChangeRequests)
    .where(eq(s.recipeChangeRequests.status, "pending"))
    .groupBy(s.recipeChangeRequests.kind);
  return { change: rows.find((r) => r.kind === "change")?.n ?? 0, new: rows.find((r) => r.kind === "new")?.n ?? 0 };
}

/** Yönetici: bekleyenler (eskiden yeniye) ve son `days` günde karara bağlananlar (yeniden eskiye) */
export async function loadReviewQueue(days = 30): Promise<{ pending: RecipeRequestRow[]; recent: RecipeRequestRow[] }> {
  const [pending, recent] = await Promise.all([
    select().where(eq(s.recipeChangeRequests.status, "pending")).orderBy(s.recipeChangeRequests.createdAt, s.recipeChangeRequests.id),
    select()
      .where(and(inArray(s.recipeChangeRequests.status, ["approved", "rejected", "withdrawn"]), gt(s.recipeChangeRequests.updatedAt, daysAgo(days))))
      .orderBy(desc(s.recipeChangeRequests.updatedAt), s.recipeChangeRequests.id)
      .limit(40),
  ]);
  return { pending: pending.map(toRow), recent: recent.map(toRow) };
}

/** Kişinin önerileri: bekleyenler ve son `days` günde sonuçlananlar (yeniden eskiye) */
export async function loadMyRequests(userId: number, days = 14): Promise<RecipeRequestRow[]> {
  const rows = await select()
    .where(
      and(
        eq(s.recipeChangeRequests.requestedBy, userId),
        or(eq(s.recipeChangeRequests.status, "pending"), gt(s.recipeChangeRequests.updatedAt, daysAgo(days))),
      ),
    )
    // Aynı işlemde açılan boylar (yeni ürün önerisi) kendi sırasıyla: M, L
    .orderBy(desc(s.recipeChangeRequests.updatedAt), s.recipeChangeRequests.id)
    .limit(50);
  return rows.map(toRow);
}

/** Ürün başına bekleyen değişiklik önerisi sayısı (yöneticinin reçete defterindeki rozet) */
export async function pendingByProduct(): Promise<Map<number, number>> {
  const rows = await getDb()
    .select({ productId: s.recipeChangeRequests.productId, n: count() })
    .from(s.recipeChangeRequests)
    .where(and(eq(s.recipeChangeRequests.status, "pending"), eq(s.recipeChangeRequests.kind, "change"), isNotNull(s.recipeChangeRequests.productId)))
    .groupBy(s.recipeChangeRequests.productId);
  return new Map(rows.flatMap((r) => (r.productId === null ? [] : [[r.productId, r.n] as const])));
}

/** Bekleyen yeni ürün önerilerinin ad ve boyu (öneri penceresi aynı ad + boyu göndermeden uyarır) */
export async function pendingNewProposals(): Promise<{ name: string; size: ProductSize }[]> {
  const rows = await getDb()
    .select({ proposed: s.recipeChangeRequests.proposed })
    .from(s.recipeChangeRequests)
    .where(and(eq(s.recipeChangeRequests.status, "pending"), eq(s.recipeChangeRequests.kind, "new")));
  return rows.flatMap((r) => (r.proposed ? [{ name: r.proposed.name, size: r.proposed.size }] : []));
}

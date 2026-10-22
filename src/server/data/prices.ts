import "server-only";

import { and, asc, count, desc, eq, inArray, isNotNull, max, min, notInArray } from "drizzle-orm";

import type { HistoryRow, PriceSource } from "@/lib/prices/history";
import type { PosItem } from "@/lib/prices/pos";
import { getDb, schema as s } from "@/server/db";

/**
 * Fiyatlar ekranının, ürün kartının, zilin ve (sonra) Bugün ekranının okumaları: kasada (ModPOS) değişecek fiyatlar,
 * satış fiyatı geçmişi (docs/FIYATLAR.md). Hepsi yalnız okur.
 */

export interface PosPendingSummary {
  count: number;
  /** Kasanın en eski ve en yeni geri kalışı */
  oldest: Date | null;
  newest: Date | null;
}

/** Kasada değişecek fiyat sayısı (tek sorgu): Ürünler başlığı, sekme rozeti, zil ve Bugün ekranı */
export async function posPendingSummary(): Promise<PosPendingSummary> {
  const [r] = await getDb()
    .select({ n: count(), oldest: min(s.products.posStaleSince), newest: max(s.products.posStaleSince) })
    .from(s.products)
    .where(isNotNull(s.products.posStalePrice));
  return { count: r?.n ?? 0, oldest: r?.oldest ?? null, newest: r?.newest ?? null };
}

export interface PosChecklistItem extends PosItem {
  /** Kasanın geri kaldığı an (ISO) */
  since: string;
  /** Son değişikliğin kaynağı, kimin yaptığı ve anı (geçmişten) */
  source: PriceSource | null;
  changedBy: string | null;
  changedAt: string | null;
}

/** Kasaya işle listesi: kasada eski fiyatı duran ürünler, ModPOS adları ve son değişikliğin kaynağı */
export async function loadPosChecklist(): Promise<PosChecklistItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: s.products.id,
      name: s.products.name,
      size: s.products.size,
      price: s.products.price,
      stalePrice: s.products.posStalePrice,
      since: s.products.posStaleSince,
      sortOrder: s.products.sortOrder,
      category: s.categories.name,
      categoryOrder: s.categories.sortOrder,
    })
    .from(s.products)
    .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId))
    .where(isNotNull(s.products.posStalePrice));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [names, latest] = await Promise.all([
    db
      .select({ posName: s.posMappings.posName, productId: s.posMappings.productId })
      .from(s.posMappings)
      .where(inArray(s.posMappings.productId, ids))
      .orderBy(asc(s.posMappings.posName)),
    db
      .selectDistinctOn([s.productPrices.productId], {
        productId: s.productPrices.productId,
        source: s.productPrices.source,
        changedBy: s.productPrices.changedBy,
        changedAt: s.productPrices.changedAt,
      })
      .from(s.productPrices)
      .where(inArray(s.productPrices.productId, ids))
      .orderBy(s.productPrices.productId, desc(s.productPrices.changedAt), desc(s.productPrices.id)),
  ]);
  const namesOf = new Map<number, string[]>();
  for (const n of names) if (n.productId) namesOf.set(n.productId, [...(namesOf.get(n.productId) ?? []), n.posName]);
  const lastOf = new Map(latest.map((l) => [l.productId, l]));
  return rows.map((r) => {
    const last = lastOf.get(r.id);
    return {
      productId: r.id,
      name: r.name,
      size: r.size,
      category: r.category,
      categoryOrder: r.categoryOrder,
      sortOrder: r.sortOrder,
      posNames: namesOf.get(r.id) ?? [],
      stalePrice: r.stalePrice!,
      price: r.price,
      since: (r.since ?? new Date()).toISOString(),
      source: last?.source ?? null,
      changedBy: last?.changedBy ?? null,
      changedAt: last?.changedAt.toISOString() ?? null,
    };
  });
}

const historyColumns = {
  id: s.productPrices.id,
  productId: s.productPrices.productId,
  name: s.products.name,
  size: s.products.size,
  priceBefore: s.productPrices.priceBefore,
  price: s.productPrices.price,
  source: s.productPrices.source,
  onSite: s.productPrices.onSite,
  batchId: s.productPrices.batchId,
  note: s.productPrices.note,
  changedBy: s.productPrices.changedBy,
  changedAt: s.productPrices.changedAt,
};

const toHistoryRow = (r: Omit<HistoryRow, "changedAt"> & { changedAt: Date }): HistoryRow => ({ ...r, changedAt: r.changedAt.toISOString() });

export interface PriceHistoryData {
  rows: HistoryRow[];
  /** Geçmişteki ürünlerin bugünkü fiyatı ve siteye bağlı olup olmadığı (geri alma planı ve onay metni) */
  products: { id: number; price: number; linked: boolean }[];
}

/**
 * Bütün menünün fiyat geçmişi, en yeni önce (son `limit` satır). Sınıra denk gelen toplu değişikliğin geri kalan
 * satırları da gelir: toplu kayıt eksik sayılmasın, geri alma planı bütün satırlarıyla hesaplansın.
 */
export async function loadPriceHistory({ limit = 500 }: { limit?: number } = {}): Promise<PriceHistoryData> {
  const db = getDb();
  const head = await db
    .select(historyColumns)
    .from(s.productPrices)
    .innerJoin(s.products, eq(s.products.id, s.productPrices.productId))
    .orderBy(desc(s.productPrices.changedAt), desc(s.productPrices.id))
    .limit(limit);
  const batchIds = [...new Set(head.map((r) => r.batchId).filter((b): b is string => !!b))];
  const rest =
    batchIds.length && head.length >= limit
      ? await db
          .select(historyColumns)
          .from(s.productPrices)
          .innerJoin(s.products, eq(s.products.id, s.productPrices.productId))
          .where(and(inArray(s.productPrices.batchId, batchIds), notInArray(s.productPrices.id, head.map((r) => r.id))))
      : [];
  const rows = [...head, ...rest].map(toHistoryRow);
  const ids = [...new Set(rows.map((r) => r.productId))];
  const products = ids.length
    ? await db.select({ id: s.products.id, price: s.products.price, siteMenuId: s.products.siteMenuId }).from(s.products).where(inArray(s.products.id, ids))
    : [];
  return { rows, products: products.map((p) => ({ id: p.id, price: p.price, linked: !!p.siteMenuId })) };
}

export interface ProductPriceHistory {
  rows: HistoryRow[];
  /** Panelin bugünkü fiyatı ("Kasada değiştirdim" kasaya bunun yazıldığını söyler); ürün yoksa null */
  price: number | null;
  /** Kasada duran eski fiyat ve ne zamandan beri (ISO); kasa güncelse null */
  posStalePrice: number | null;
  posStaleSince: string | null;
}

/** Ürün kartındaki "Fiyat geçmişi": son `limit` değişiklik ve kasanın durumu */
export async function loadProductPriceHistory(productId: number, limit = 20): Promise<ProductPriceHistory> {
  const db = getDb();
  const [rows, [p]] = await Promise.all([
    db
      .select(historyColumns)
      .from(s.productPrices)
      .innerJoin(s.products, eq(s.products.id, s.productPrices.productId))
      .where(eq(s.productPrices.productId, productId))
      .orderBy(desc(s.productPrices.changedAt), desc(s.productPrices.id))
      .limit(limit),
    db
      .select({ price: s.products.price, stalePrice: s.products.posStalePrice, since: s.products.posStaleSince })
      .from(s.products)
      .where(eq(s.products.id, productId))
      .limit(1),
  ]);
  return { rows: rows.map(toHistoryRow), price: p?.price ?? null, posStalePrice: p?.stalePrice ?? null, posStaleSince: p?.since?.toISOString() ?? null };
}

/** Bir toplu değişikliğin bütün satırları (geri alma), ürünün bugünkü fiyatıyla */
export async function loadBatch(batchId: string) {
  return getDb()
    .select({ ...historyColumns, current: s.products.price })
    .from(s.productPrices)
    .innerJoin(s.products, eq(s.products.id, s.productPrices.productId))
    .where(eq(s.productPrices.batchId, batchId))
    .orderBy(asc(s.productPrices.changedAt), asc(s.productPrices.id));
}

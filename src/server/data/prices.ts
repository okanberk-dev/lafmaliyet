import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, max, min, notInArray } from "drizzle-orm";

import { logPerson } from "@/lib/activity-person";
import { tillPriceManual, type KasaName, type TillScope } from "@/lib/lafpos/kasa";
import type { HistoryRow, PriceSource } from "@/lib/prices/history";
import { POS_MARKS_RECENT_MS, posUndoRefusal, type PosItem, type RecentPosMark } from "@/lib/prices/pos";
import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";

import { kasaNameFilter } from "./pos-staff";
import { loadTillScope, tillProductFilter } from "./till-scope";

/**
 * Fiyatlar ekranının, ürün kartının, zilin ve (sonra) Bugün ekranının okumaları: kasada (ModPOS) değişecek fiyatlar,
 * satış fiyatı geçmişi (docs/FIYATLAR.md). Hepsi yalnız okur. Kasa listesi bugünün kasasına göre (till-scope.ts):
 * geçiş gününden itibaren (LafPOS) siteye bağlı ürünler sayılmaz, LafPOS onların fiyatını siteden alır (denetim E-39).
 */

export interface PosPendingSummary {
  count: number;
  /** Kasanın en eski ve en yeni geri kalışı */
  oldest: Date | null;
  newest: Date | null;
  /** Bugünün kasası (metinler: "ModPOS'ta" / "LafPOS'ta") */
  kasa: KasaName;
}

/** Kasada değişecek fiyat sayısı (tek sorgu ve geçiş günü): Ürünler başlığı, sekme rozeti, zil ve Bugün ekranı */
export async function posPendingSummary(scope?: TillScope): Promise<PosPendingSummary> {
  const sc = scope ?? (await loadTillScope());
  const [r] = await getDb()
    .select({ n: count(), oldest: min(s.products.posStaleSince), newest: max(s.products.posStaleSince) })
    .from(s.products)
    .where(and(isNotNull(s.products.posStalePrice), tillProductFilter(sc)));
  return { count: r?.n ?? 0, oldest: r?.oldest ?? null, newest: r?.newest ?? null, kasa: sc.kasa };
}

export interface PosChecklistItem extends PosItem {
  /** Kasanın geri kaldığı an (ISO) */
  since: string;
  /** Son değişikliğin kaynağı, kimin yaptığı ve anı (geçmişten) */
  source: PriceSource | null;
  changedBy: string | null;
  changedAt: string | null;
}

/**
 * Kasaya işle listesi: kasada eski fiyatı duran ürünler, ModPOS adları ve son değişikliğin kaynağı. LafPOS gününde
 * yalnız siteye bağlı olmayanlar (till-scope.ts)
 */
export async function loadPosChecklist(scope?: TillScope): Promise<PosChecklistItem[]> {
  const db = getDb();
  const sc = scope ?? (await loadTillScope(db));
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
    .where(and(isNotNull(s.products.posStalePrice), tillProductFilter(sc)));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [names, latest, inModpos] = await Promise.all([
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
    // Yalnız LafPOS'tan öğrenilmiş ad ModPOS'ta yok, ModPOS'un adı LafPOS'ta (pos-staff.ts kasaNameFilter)
    kasaNameFilter(db, sc.kasa),
  ]);
  const namesOf = new Map<number, string[]>();
  for (const n of names) if (n.productId && inModpos(n.posName)) namesOf.set(n.productId, [...(namesOf.get(n.productId) ?? []), n.posName]);
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

/**
 * Yönetici: Fiyatlar › Kasaya işle › "Son işaretlenenler" (son `days` gün, en yeni önce, en çok 500). Herkesin işareti
 * (yöneticininki de); kişi İşlem geçmişindeki gibi (logPerson). Geri alınamayanın nedeni yöneticinin kuralıyla
 * (posUndoRefusal): ürünün son işareti değilse, ürün listeye yeniden girdiyse ya da fiyat kasadakine döndüyse.
 */
export async function loadRecentPosMarks({ days = 14, now }: { days?: number; now: Date }): Promise<RecentPosMark[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: s.posMarks.id,
      productId: s.posMarks.productId,
      price: s.posMarks.price,
      stalePrice: s.posMarks.stalePrice,
      markedBy: s.posMarks.markedBy,
      markedByName: s.posMarks.markedByName,
      markedAt: s.posMarks.markedAt,
      undoneAt: s.posMarks.undoneAt,
      undoneByName: s.posMarks.undoneByName,
      name: s.products.name,
      size: s.products.size,
      current: s.products.price,
      currentStale: s.products.posStalePrice,
    })
    .from(s.posMarks)
    .innerJoin(s.products, eq(s.products.id, s.posMarks.productId))
    .where(gt(s.posMarks.markedAt, new Date(now.getTime() - days * 86_400_000)))
    .orderBy(desc(s.posMarks.markedAt), desc(s.posMarks.id))
    .limit(500);
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.productId))];
  const [latest, accounts] = await Promise.all([
    db
      .selectDistinctOn([s.posMarks.productId], { productId: s.posMarks.productId, id: s.posMarks.id })
      .from(s.posMarks)
      .where(inArray(s.posMarks.productId, ids))
      .orderBy(s.posMarks.productId, desc(s.posMarks.id)),
    db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users),
  ]);
  const latestOf = new Map(latest.map((l) => [l.productId, l.id]));
  const accountOf = new Map(accounts.map((a) => [a.id, a]));
  return rows.map((r) => {
    const mark = { id: r.id, markedBy: r.markedBy, markedAt: r.markedAt, undoneAt: r.undoneAt, price: r.price, stalePrice: r.stalePrice };
    const refusal = r.undoneAt ? null : posUndoRefusal({ role: "admin", meId: 0, now }, mark, { price: r.current, posStalePrice: r.currentStale }, latestOf.get(r.productId) ?? null);
    return {
      markId: r.id,
      productId: r.productId,
      name: r.name,
      size: r.size,
      price: r.price,
      stalePrice: r.stalePrice,
      byId: r.markedBy,
      by: logPerson(r.markedByName, (r.markedBy !== null && accountOf.get(r.markedBy)) || null, accounts).label,
      markedAt: r.markedAt.toISOString(),
      undoneAt: r.undoneAt?.toISOString() ?? null,
      undoneBy: r.undoneByName,
      refusal,
    };
  });
}

/**
 * Yöneticinin Bugün satırı: personelin son 48 saatte kasada işaretledikleri, kişi ve Türkiye günü başına (en yeni önce;
 * `at` o günün son işareti). Geri alınanlar ve yöneticilerin işaretleri sayılmaz. Ad işaretin anındaki ad.
 */
export async function staffPosMarksRecent(now: Date): Promise<{ by: string; count: number; at: string }[]> {
  const rows = await getDb()
    .select({ by: s.posMarks.markedBy, name: s.posMarks.markedByName, at: s.posMarks.markedAt })
    .from(s.posMarks)
    .innerJoin(s.users, eq(s.users.id, s.posMarks.markedBy))
    .where(and(eq(s.users.role, "staff"), gt(s.posMarks.markedAt, new Date(now.getTime() - POS_MARKS_RECENT_MS)), isNull(s.posMarks.undoneAt)))
    .orderBy(desc(s.posMarks.markedAt))
    .limit(500);
  const groups = new Map<string, { by: string; count: number; at: string }>();
  for (const r of rows) {
    const key = `${r.by}|${todayTR(r.at)}`;
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { by: r.name, count: 1, at: r.at.toISOString() });
  }
  return [...groups.values()];
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
  /**
   * Kasada duran eski fiyat ve ne zamandan beri (ISO); kasa güncelse null. LafPOS gününde siteye bağlı üründe hep null
   * (LafPOS fiyatı siteden alır; eski işaret gösterilmez)
   */
  posStalePrice: number | null;
  posStaleSince: string | null;
  /** Bugünün kasası ("Kasada (ModPOS) hâlâ …") */
  kasa: KasaName;
}

/** Ürün kartındaki "Fiyat geçmişi": son `limit` değişiklik ve kasanın durumu */
export async function loadProductPriceHistory(productId: number, limit = 20): Promise<ProductPriceHistory> {
  const db = getDb();
  const [rows, [p], scope] = await Promise.all([
    db
      .select(historyColumns)
      .from(s.productPrices)
      .innerJoin(s.products, eq(s.products.id, s.productPrices.productId))
      .where(eq(s.productPrices.productId, productId))
      .orderBy(desc(s.productPrices.changedAt), desc(s.productPrices.id))
      .limit(limit),
    db
      .select({ price: s.products.price, stalePrice: s.products.posStalePrice, since: s.products.posStaleSince, siteMenuId: s.products.siteMenuId })
      .from(s.products)
      .where(eq(s.products.id, productId))
      .limit(1),
    loadTillScope(db),
  ]);
  const stale = p && tillPriceManual(scope, p.siteMenuId !== null) ? p : null;
  return {
    rows: rows.map(toHistoryRow),
    price: p?.price ?? null,
    posStalePrice: stale?.stalePrice ?? null,
    posStaleSince: stale?.since?.toISOString() ?? null,
    kasa: scope.kasa,
  };
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

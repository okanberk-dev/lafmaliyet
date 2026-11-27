import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, max, min, notInArray } from "drizzle-orm";

import { logPerson } from "@/lib/activity-person";
import type { KasaName } from "@/lib/asilpos/kasa";
import type { HistoryRow, PriceSource } from "@/lib/prices/history";
import { POS_MARKS_RECENT_MS, posUndoRefusal, type PosItem, type RecentPosMark } from "@/lib/prices/pos";
import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";

import { kasaNameFilter } from "./pos-staff";
import { type BranchTill, loadTillScope, loadTillScopes, posStaleJoin, tillProductFilter, tillSince } from "./till-scope";

/**
 * Fiyatlar ekranının, ürün kartının, zilin ve (sonra) Bugün ekranının okumaları: kasada (ModPOS) değişecek fiyatlar,
 * satış fiyatı geçmişi (docs/FIYATLAR.md). Hepsi yalnız okur. Kasa listesi bugünün kasasına göre (till-scope.ts):
 * geçiş gününden itibaren (AsilPOS) siteye bağlı ürünler sayılmaz, AsilPOS onların fiyatını siteden alır; bağlı olmayan
 * da yalnız fiyatı AsilPOS başladıktan sonra değiştiyse sayılır (denetim E-39). Kasa şube başınadır (pos_stale; şube
 * kapsamı A3): her okuma bir şubenin kasasına bakar (`BranchTill`), "Tümü"de birden çok kasa açıkken çağıran her kasayı
 * ayrı okur (loadTillScopes).
 */

export interface PosPendingSummary {
  count: number;
  /** Kasanın en eski ve en yeni geri kalışı */
  oldest: Date | null;
  newest: Date | null;
  /** Bugünün kasası (metinler: "ModPOS'ta" / "AsilPOS'ta") */
  kasa: KasaName;
  /** Kasanın şubesi; `name` yalnız "Tümü"de birden çok kasa yan yanayken (BranchTill) */
  branchId: string;
  name: string | null;
}

/** Bir şubenin kasasında değişecek fiyat sayısı (tek sorgu ve geçiş günü): Ürünler başlığı, sekme rozeti, zil ve Bugün */
export async function posPendingSummary(scope?: BranchTill): Promise<PosPendingSummary> {
  const db = getDb();
  const sc = scope ?? (await loadTillScope(db));
  const [r] = await db
    .select({ n: count(), oldest: min(s.posStale.staleSince), newest: max(s.posStale.staleSince) })
    .from(s.products)
    .innerJoin(s.posStale, posStaleJoin(sc))
    .where(tillProductFilter(sc, db));
  return { count: r?.n ?? 0, oldest: tillSince(sc, r?.oldest ?? null), newest: tillSince(sc, r?.newest ?? null), kasa: sc.kasa, branchId: sc.branchId, name: sc.name };
}

/** Seçimin her kasası için posPendingSummary (tek şubede bir, "Tümü"de birden çok kasa açıkken her kasa) */
export async function posPendingSummaries(now: Date = new Date()): Promise<PosPendingSummary[]> {
  return Promise.all((await loadTillScopes(undefined, now)).map((t) => posPendingSummary(t)));
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
 * Kasaya işle listesi: şubenin kasasında eski fiyatı duran ürünler, ModPOS adları ve son değişikliğin kaynağı. AsilPOS
 * gününde yalnız siteye bağlı olmayan ve fiyatı AsilPOS başladıktan sonra değişenler (till-scope.ts tillProductFilter)
 */
export async function loadPosChecklist(scope?: BranchTill): Promise<PosChecklistItem[]> {
  const db = getDb();
  const sc = scope ?? (await loadTillScope(db));
  const rows = await db
    .select({
      id: s.products.id,
      name: s.products.name,
      size: s.products.size,
      price: s.products.price,
      stalePrice: s.posStale.stalePrice,
      since: s.posStale.staleSince,
      sortOrder: s.products.sortOrder,
      category: s.categories.name,
      categoryOrder: s.categories.sortOrder,
    })
    .from(s.products)
    .innerJoin(s.posStale, posStaleJoin(sc))
    .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId))
    .where(tillProductFilter(sc, db));
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
    // Yalnız AsilPOS'tan öğrenilmiş ad ModPOS'ta yok, ModPOS'un adı AsilPOS'ta (pos-staff.ts kasaNameFilter)
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
      stalePrice: r.stalePrice,
      price: r.price,
      since: tillSince(sc, r.since).toISOString(),
      source: last?.source ?? null,
      changedBy: last?.changedBy ?? null,
      changedAt: last?.changedAt.toISOString() ?? null,
    };
  });
}

/**
 * Yönetici: Fiyatlar › Kasaya işle › "Son işaretlenenler" (son `days` gün, en yeni önce, en çok 500). Herkesin işareti
 * (yöneticininki de); kişi İşlem geçmişindeki gibi (logPerson). Geri alınamayanın nedeni yöneticinin kuralıyla
 * (posUndoRefusal): ürünün o şubedeki son işareti değilse, ürün o şubenin listesine yeniden girdiyse ya da fiyat
 * kasadakine döndüyse. Yalnız seçimin kasalarının işaretleri (`tills`; "Tümü"de birden çok kasa açıkken hepsi, satır
 * kasasının adını taşır).
 */
export async function loadRecentPosMarks({ days = 14, now, tills }: { days?: number; now: Date; tills?: readonly BranchTill[] }): Promise<RecentPosMark[]> {
  const db = getDb();
  const scopeTills = tills ?? (await loadTillScopes(db, now));
  const branchIds = scopeTills.map((t) => t.branchId);
  // Online kanal seçiliyken kasa yok (loadTillScopes boş)
  if (!branchIds.length) return [];
  const m = s.posMarks;
  const rows = await db
    .select({
      id: m.id,
      productId: m.productId,
      branchId: m.branchId,
      price: m.price,
      stalePrice: m.stalePrice,
      markedBy: m.markedBy,
      markedByName: m.markedByName,
      markedAt: m.markedAt,
      undoneAt: m.undoneAt,
      undoneByName: m.undoneByName,
      name: s.products.name,
      size: s.products.size,
      current: s.products.price,
      currentStale: s.posStale.stalePrice,
    })
    .from(m)
    .innerJoin(s.products, eq(s.products.id, m.productId))
    .leftJoin(s.posStale, and(eq(s.posStale.productId, m.productId), eq(s.posStale.branchId, m.branchId)))
    .where(and(gt(m.markedAt, new Date(now.getTime() - days * 86_400_000)), inArray(m.branchId, branchIds)))
    .orderBy(desc(m.markedAt), desc(m.id))
    .limit(500);
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.productId))];
  const [latest, accounts] = await Promise.all([
    db
      .selectDistinctOn([m.productId, m.branchId], { productId: m.productId, branchId: m.branchId, id: m.id })
      .from(m)
      .where(and(inArray(m.productId, ids), inArray(m.branchId, branchIds)))
      .orderBy(m.productId, m.branchId, desc(m.id)),
    db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users),
  ]);
  const latestOf = new Map(latest.map((l) => [`${l.branchId}|${l.productId}`, l.id]));
  const accountOf = new Map(accounts.map((a) => [a.id, a]));
  const nameOf = new Map(scopeTills.map((t) => [t.branchId, t.name]));
  return rows.map((r) => {
    const mark = { id: r.id, markedBy: r.markedBy, markedAt: r.markedAt, undoneAt: r.undoneAt, price: r.price, stalePrice: r.stalePrice };
    const refusal = r.undoneAt
      ? null
      : posUndoRefusal({ role: "admin", meId: 0, now }, mark, { price: r.current, posStalePrice: r.currentStale }, latestOf.get(`${r.branchId}|${r.productId}`) ?? null);
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
      tillName: nameOf.get(r.branchId) ?? null,
    };
  });
}

/**
 * Yöneticinin Bugün satırı: personelin son 48 saatte kasada işaretledikleri, kişi ve Türkiye günü başına (en yeni önce;
 * `at` o günün son işareti). Geri alınanlar ve yöneticilerin işaretleri sayılmaz. Ad işaretin anındaki ad. Yalnız
 * seçimin kasalarınınkiler (`branchIds`).
 */
export async function staffPosMarksRecent(now: Date, branchIds: readonly string[]): Promise<{ by: string; count: number; at: string }[]> {
  if (!branchIds.length) return [];
  const rows = await getDb()
    .select({ by: s.posMarks.markedBy, name: s.posMarks.markedByName, at: s.posMarks.markedAt })
    .from(s.posMarks)
    .innerJoin(s.users, eq(s.users.id, s.posMarks.markedBy))
    .where(
      and(
        eq(s.users.role, "staff"),
        gt(s.posMarks.markedAt, new Date(now.getTime() - POS_MARKS_RECENT_MS)),
        isNull(s.posMarks.undoneAt),
        inArray(s.posMarks.branchId, [...branchIds]),
      ),
    )
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

/** Bir kasada ürünün bekleyen fiyatı (ürün kartı) */
export interface ProductPosState {
  branchId: string;
  /** Yalnız "Tümü"de birden çok kasa yan yanayken şubenin adı */
  name: string | null;
  kasa: KasaName;
  /** Kasada duran eski fiyat ve ne zamandan beri (ISO) */
  stalePrice: number;
  since: string;
}

export interface ProductPriceHistory {
  rows: HistoryRow[];
  /** Panelin bugünkü fiyatı ("Kasada değiştirdim" kasaya bunun yazıldığını söyler); ürün yoksa null */
  price: number | null;
  /**
   * Ürünün eski fiyatı duran kasaları (seçimin kasaları; kasa güncelse yok). AsilPOS gününde kasa listesindeki gibi
   * (till-scope.ts tillProductFilter): siteye bağlı üründe ve ModPOS'tan kalan işarette yok (silinmez, gösterilmez)
   */
  pos: ProductPosState[];
  /** Bugünün kasası ("Kasada (ModPOS) hâlâ …"; "Tümü"de ilk kasanınki) */
  kasa: KasaName;
}

/** Ürün kartındaki "Fiyat geçmişi": son `limit` değişiklik ve seçimin kasalarının durumu */
export async function loadProductPriceHistory(productId: number, limit = 20): Promise<ProductPriceHistory> {
  const db = getDb();
  const tills = await loadTillScopes(db);
  const [rows, [p], pos] = await Promise.all([
    db
      .select(historyColumns)
      .from(s.productPrices)
      .innerJoin(s.products, eq(s.products.id, s.productPrices.productId))
      .where(eq(s.productPrices.productId, productId))
      .orderBy(desc(s.productPrices.changedAt), desc(s.productPrices.id))
      .limit(limit),
    db.select({ price: s.products.price }).from(s.products).where(eq(s.products.id, productId)).limit(1),
    // Her kasada ürün listede mi (AsilPOS gününde süzgeçle; ModPOS gününde süzgeç yok)
    Promise.all(
      tills.map(async (t): Promise<ProductPosState | null> => {
        const [r] = await db
          .select({ stalePrice: s.posStale.stalePrice, since: s.posStale.staleSince })
          .from(s.products)
          .innerJoin(s.posStale, posStaleJoin(t))
          .where(and(eq(s.products.id, productId), tillProductFilter(t, db)))
          .limit(1);
        return r ? { branchId: t.branchId, name: t.name, kasa: t.kasa, stalePrice: r.stalePrice, since: tillSince(t, r.since).toISOString() } : null;
      }),
    ),
  ]);
  return {
    rows: rows.map(toHistoryRow),
    price: p?.price ?? null,
    pos: p ? pos.filter((x): x is ProductPosState => x !== null) : [],
    // Online kanal seçiliyken kasa yok (loadTillScopes boş): metinler ModPOS'a göre
    kasa: tills[0]?.kasa ?? "ModPOS",
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

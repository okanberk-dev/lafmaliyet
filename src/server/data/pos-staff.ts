import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, max, min, notExists } from "drizzle-orm";

import { posMatchKey } from "@/lib/calc/pos-paste";
import type { KasaName } from "@/lib/lafpos/kasa";
import { POS_UNDO_WINDOW_MS, type MyPosMark, type PosSummaryLite, type StaffPosItem } from "@/lib/prices/pos";
import { getDb, schema as s, type DB } from "@/server/db";

import { type BranchTill, loadTillScope, posStaleJoin, tillProductFilter, tillSince } from "./till-scope";

/*
 * Personelin Kasadaki fiyatlar okumaları (/panel/kasa/fiyatlar, Bugün, zil; plan docs/planlar/personel-yetki.md §2.2).
 * Sabit sütun beyaz listesi (tests/fiyatlar.test.ts sabitler): ürünün kimliği, adı, boyu, satış fiyatı, kasada duran
 * eski satış fiyatı ve ne zamandan beri, sırası ve etkinliği; kategorinin adı ve sırası; kasadaki (ModPOS) ad;
 * personelin kendi işaretlerinin kimliği, fiyatı ve anı. Yalnız etkin ürünler. Fiyat geçmişi, değişikliğin kaynağı ve
 * kimin yaptığı, not, site alanları ve maliyet okunmaz (geçiş gününden itibaren siteye bağlı ürünler yalnız süzgeçte
 * ayrılır, LafPOS onların fiyatını siteden alır: till-scope.ts; site alanı satıra okunmaz). Kasa şube başınadır
 * (pos_stale; şube kapsamı A3): her okuma bir şubenin kasasına bakar.
 */

/**
 * Kasadaki (ModPOS) adların süzgeci: POS adı hafızası ModPOS listeleriyle LafPOS'un ortak hafızasıdır (Satışlar ve
 * Ayarlar › LafPOS › Bağla aynı tabloya yazar). Yalnız LafPOS'tan gelmiş, hiçbir ModPOS listesinde geçmeyen ad
 * ModPOS'ta yoktur; kasadaki fiyat listesinde "Kasada: …" diye gösterilmez (denetim B08 incelemesi). Hiçbir tabloda
 * geçmeyen ad (ör. ayı temizlenmiş listeden) bugünkü gibi kalır. Anahtar posMatchKey (büyük / küçük harf, boşluk farkı yok).
 */
// ŞUBEYE GÖRE SÜZÜLMEZ: "bu ad ModPOS döneminden mi" sorusu işletme geneli; şubeye bakmak, şubesi yeni açılmış
// bir kafede bütün adları ModPOS dönemine sayardı.
export async function modposNameFilter(db: DB): Promise<(posName: string) => boolean> {
  const [modpos, lafpos] = await Promise.all([
    db.select({ posName: s.salesLines.posName }).from(s.salesLines).groupBy(s.salesLines.posName),
    db.select({ posName: s.posDailySales.posName }).from(s.posDailySales).groupBy(s.posDailySales.posName),
  ]);
  if (!lafpos.length) return () => true;
  const inModpos = new Set(modpos.map((r) => posMatchKey(r.posName)));
  const onlyLafpos = new Set(lafpos.map((r) => posMatchKey(r.posName)).filter((k) => !inModpos.has(k)));
  return (posName) => !onlyLafpos.has(posMatchKey(posName));
}

/**
 * Günün kasasındaki adların süzgeci ("Kasada: …"): ModPOS gününde modposNameFilter; LafPOS gününde (geçiş gününden
 * itibaren; denetim E-39) yalnız LafPOS'un gün sonlarında geçen adlar (ModPOS'un adı LafPOS'ta aranmaz)
 */
export async function kasaNameFilter(db: DB, kasa: KasaName): Promise<(posName: string) => boolean> {
  if (kasa === "ModPOS") return modposNameFilter(db);
  const rows = await db.select({ posName: s.posDailySales.posName }).from(s.posDailySales).groupBy(s.posDailySales.posName);
  const inLafpos = new Set(rows.map((r) => posMatchKey(r.posName)));
  return (posName) => inLafpos.has(posMatchKey(posName));
}

/**
 * Şubenin kasasında (ModPOS) değişecek satış fiyatları, kategori ve ürün sırasıyla gruplanmak üzere (yalnız etkin
 * ürünler; LafPOS gününde yalnız siteye bağlı olmayanlar)
 */
export async function loadStaffPosList(scope?: BranchTill): Promise<StaffPosItem[]> {
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
    .where(and(eq(s.products.active, true), tillProductFilter(sc, db)));
  if (!rows.length) return [];
  const [names, inModpos] = await Promise.all([
    db
      .select({ posName: s.posMappings.posName, productId: s.posMappings.productId })
      .from(s.posMappings)
      .where(inArray(s.posMappings.productId, rows.map((r) => r.id)))
      .orderBy(asc(s.posMappings.posName)),
    kasaNameFilter(db, sc.kasa),
  ]);
  const namesOf = new Map<number, string[]>();
  for (const n of names) if (n.productId && inModpos(n.posName)) namesOf.set(n.productId, [...(namesOf.get(n.productId) ?? []), n.posName]);
  return rows.map((r) => ({
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
  }));
}

/**
 * Kişinin son 30 dakikada `branchId` şubesinin kasasında işaretledikleri ("Son işaretledikleriniz", en yeni önce): geri
 * alınmamış, ürün o şubenin listesine yeniden girmemiş (yeni fiyat listede) ve etkin. Geri alma kuralının kalanını eylem
 * denetler (posUndoRefusal).
 */
export async function loadMyPosMarks(userId: number, now: Date, branchId: string): Promise<MyPosMark[]> {
  const db = getDb();
  const ps = s.posStale;
  const rows = await db
    .select({
      markId: s.posMarks.id,
      productId: s.posMarks.productId,
      price: s.posMarks.price,
      markedAt: s.posMarks.markedAt,
      name: s.products.name,
      size: s.products.size,
    })
    .from(s.posMarks)
    .innerJoin(s.products, eq(s.products.id, s.posMarks.productId))
    .where(
      and(
        eq(s.posMarks.markedBy, userId),
        eq(s.posMarks.branchId, branchId),
        gt(s.posMarks.markedAt, new Date(now.getTime() - POS_UNDO_WINDOW_MS)),
        isNull(s.posMarks.undoneAt),
        notExists(
          db
            .select({ id: ps.productId })
            .from(ps)
            .where(and(eq(ps.productId, s.posMarks.productId), eq(ps.branchId, s.posMarks.branchId))),
        ),
        eq(s.products.active, true),
      ),
    )
    .orderBy(desc(s.posMarks.markedAt), desc(s.posMarks.id))
    .limit(20);
  return rows.map((r) => ({ ...r, markedAt: r.markedAt.toISOString() }));
}

/**
 * Bugün ve zil: şubenin kasasında değişecek fiyat sayısı, en eski ve en yeni geri kalış (yalnız etkin ürünler; tek
 * sorgu ve geçiş günü) ve bugünün kasası
 */
export async function staffPosSummary(scope?: BranchTill): Promise<PosSummaryLite & { kasa: KasaName; branchId: string; name: string | null }> {
  const db = getDb();
  const sc = scope ?? (await loadTillScope(db));
  const [r] = await db
    .select({ n: count(), oldest: min(s.posStale.staleSince), newest: max(s.posStale.staleSince) })
    .from(s.products)
    .innerJoin(s.posStale, posStaleJoin(sc))
    .where(and(eq(s.products.active, true), tillProductFilter(sc, db)));
  return { count: r?.n ?? 0, oldest: tillSince(sc, r?.oldest ?? null), newest: tillSince(sc, r?.newest ?? null), kasa: sc.kasa, branchId: sc.branchId, name: sc.name };
}

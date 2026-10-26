import "server-only";

import { and, asc, eq, exists, inArray, isNotNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { currentMonthTR } from "@/lib/calc/engine";
import { listedFromMonth } from "@/lib/count-item";
import type { UsageProduct } from "@/lib/ingredient-usage";
import { schema as s, type DB } from "@/server/db";

/** Veritabanı ya da işlem (transaction): yalnız okur */
type Reader = Pick<DB, "select">;
/** Veritabanı ya da işlem: okur ve yazar */
type Writer = Pick<DB, "select" | "update">;

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

/** SQL: malzeme (`ingredientId` sütunu, dış sorgudan) aktif bir ürünün reçetesinde */
export function inActiveRecipeSql(db: Reader, ingredientId: AnyPgColumn): SQL {
  return exists(
    db
      .select({ x: s.recipeItems.id })
      .from(s.recipeItems)
      .innerJoin(s.products, eq(s.products.id, s.recipeItems.productId))
      .where(and(eq(s.recipeItems.ingredientId, ingredientId), eq(s.products.active, true))),
  );
}

/**
 * SQL karşılığı isCountable (src/lib/ingredient-usage.ts): sayım birimi olan, aktif ya da aktif bir ürünün reçetesinde
 * geçen malzeme. Sayım ilerlemesi (Bugün, zil, ay sonu bildirimi, sabah e-postası) Stok sayımı listesiyle aynı kalemleri
 * saysın diye (count-progress.ts).
 */
export function countableSql(db: Reader): SQL {
  const i = s.ingredients;
  return and(isNotNull(i.countUnit), or(eq(i.active, true), inActiveRecipeSql(db, i.id)))!;
}

/** Malzemelerden pasif olup sayım birimi olan ve aktif bir ürünün reçetesinde geçenler (sayım listesine reçeteden giren) */
export async function passiveInUse(db: Reader, ingredientIds: number[]): Promise<Set<number>> {
  if (!ingredientIds.length) return new Set();
  const i = s.ingredients;
  const rows = await db
    .select({ id: i.id })
    .from(i)
    .where(and(inArray(i.id, ingredientIds), eq(i.active, false), isNotNull(i.countUnit), inActiveRecipeSql(db, i.id)));
  return new Set(rows.map((r) => r.id));
}

/** Ürünlerin reçetelerindeki malzemeler (tekrarsız) */
export async function recipeIngredientIds(db: Reader, productIds: number[]): Promise<number[]> {
  if (!productIds.length) return [];
  const rows = await db.select({ id: s.recipeItems.ingredientId }).from(s.recipeItems).where(inArray(s.recipeItems.productId, productIds));
  return [...new Set(rows.map((r) => r.id))];
}

/**
 * Pasif malzeme yazımla aktif bir ürünün reçetesine girdiyse (ürün yeniden aktif oldu, reçeteye pasif malzeme yazıldı,
 * pasif malzemeli ürün kopyalandı) sayım listesine bu aydan girer: count_from bu ay (Hammaddeler'de yeniden aktif
 * yapılan kalem gibi, listedFromMonth). Boş ya da eski kalsaydı sayımı bitmiş her geçmiş ay "yarım" görünür, sayım
 * ekranı ve hatırlatmalar kapanmış aya giderdi. `before`: yazımdan önce zaten reçeteden listede olanlar (passiveInUse);
 * onlara dokunulmaz (listede oldukları aylar sayılmadıysa yarım kalmalı).
 */
export async function relistPassiveInUse(db: Writer, ingredientIds: number[], before: Set<number>, current = currentMonthTR()): Promise<number[]> {
  const after = await passiveInUse(db, ingredientIds);
  const added = [...after].filter((id) => !before.has(id));
  if (!added.length) return [];
  const i = s.ingredients;
  const rows = await db.select({ id: i.id, countFrom: i.countFrom }).from(i).where(inArray(i.id, added));
  for (const r of rows) {
    const next = listedFromMonth(r.countFrom, current);
    if (next !== r.countFrom) await db.update(i).set({ countFrom: next, updatedAt: new Date() }).where(eq(i.id, r.id));
  }
  return added;
}

/**
 * Ürün aktifliğini ya da reçetesini değiştiren yazımı sarar: önce ürünlerin reçete malzemelerinden (ve `ingredientIds`
 * ile yazılacak malzemelerden) reçeteden listede olan pasifler okunur, yazımdan sonra yeni girenlerin count_from'u bu
 * aya taşınır (relistPassiveInUse). Aynı işlemin (transaction) içinde çağrılır.
 */
export async function withPassiveRelist<T>(db: Writer, productIds: number[], ingredientIds: number[], write: () => Promise<T>): Promise<T> {
  const ids = [...new Set([...(await recipeIngredientIds(db, productIds)), ...ingredientIds])];
  const before = await passiveInUse(db, ids);
  const out = await write();
  await relistPassiveInUse(db, ids, before);
  return out;
}

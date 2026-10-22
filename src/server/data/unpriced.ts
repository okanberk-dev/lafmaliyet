import "server-only";

import { and, asc, count, desc, eq } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

/**
 * Fiyatı girilmemiş aktif hammaddeler (paket fiyatı 0, fiyatı elle girilen; kural isUnpriced, src/lib/count-item.ts):
 * çoğu, sayımda "Listeye ekle" ile eklenen kalem. Yöneticinin zili okur (Bugün ekranı da aynı sayıyı kullanabilir).
 * Hafif: bir sayım ve ilk birkaç ad. `newestId` zil kimliğine girer (yeni kalem gelince yeniden okunmamış olur).
 */
export async function loadUnpricedIngredients(limit = 3): Promise<{ count: number; names: string[]; newestId: number }> {
  const db = getDb();
  const where = and(eq(s.ingredients.active, true), eq(s.ingredients.priceSource, "manual"), eq(s.ingredients.packagePrice, 0));
  const [[total], first, [newest]] = await Promise.all([
    db.select({ n: count() }).from(s.ingredients).where(where),
    db.select({ name: s.ingredients.name }).from(s.ingredients).where(where).orderBy(asc(s.ingredients.sortOrder), asc(s.ingredients.id)).limit(limit),
    db.select({ id: s.ingredients.id }).from(s.ingredients).where(where).orderBy(desc(s.ingredients.id)).limit(1),
  ]);
  return { count: total?.n ?? 0, names: first.map((r) => r.name), newestId: newest?.id ?? 0 };
}

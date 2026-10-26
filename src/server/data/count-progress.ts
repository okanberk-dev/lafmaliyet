import "server-only";

import { and, count, eq, exists, isNotNull, isNull, lte, or } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

/**
 * Bir ayın sayım ilerlemesi: o ay sayılan kalem ve sayılacak kalem (Stok sayımı ekranının listesi: etkin, sayım birimi
 * olan, listeye girdiği ay gelmiş ya da o ay sayılmış; engine.ts stockSheet). Arşivlenen (pasif ya da "Sayılmaz") kalem
 * sayılmaz.
 */
export async function countProgress(month: string): Promise<{ counted: number; total: number }> {
  const db = getDb();
  const i = s.ingredients;
  const sc = s.stockCounts;
  const listed = and(eq(i.active, true), isNotNull(i.countUnit));
  const countedThatMonth = exists(
    db
      .select({ id: sc.id })
      .from(sc)
      .where(and(eq(sc.month, month), eq(sc.ingredientId, i.id))),
  );
  const [[counted], [total]] = await Promise.all([
    db
      .select({ n: count() })
      .from(sc)
      .innerJoin(i, eq(i.id, sc.ingredientId))
      .where(and(eq(sc.month, month), listed)),
    db
      .select({ n: count() })
      .from(i)
      .where(and(listed, or(isNull(i.countFrom), lte(i.countFrom, month), countedThatMonth))),
  ]);
  return { counted: counted?.n ?? 0, total: total?.n ?? 0 };
}

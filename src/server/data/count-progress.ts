import "server-only";

import { and, count, eq, exists, isNull, lte, or } from "drizzle-orm";

import { currentPhysicalBranch } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";
import { countableSql } from "@/server/data/ingredient-usage";

/**
 * Bir ayın sayım ilerlemesi: o ay sayılan kalem ve sayılacak kalem (Stok sayımı ekranının listesi: sayım birimi olan,
 * aktif ya da aktif bir ürünün reçetesinde geçen, listeye girdiği ay gelmiş ya da o ay sayılmış; engine.ts stockSheet,
 * kural src/lib/ingredient-usage.ts isCountable). Arşivlenen (listeden düşmüş pasif ya da "Sayılmaz") kalem sayılmaz.
 * Bugün, zil, ay sonu bildirimi ve sabah e-postası bunu kullanır: Stok sayımı ekranının "N / M"siyle aynı olmalı.
 */
export async function countProgress(month: string): Promise<{ counted: number; total: number }> {
  const db = getDb();
  const i = s.ingredients;
  const sc = s.stockCounts;
  // Sayım şube başına: seçili fiziksel şubenin ("Tümü"de Tuzla) ilerlemesi, Stok sayımı ekranıyla aynı şube
  const sube = eq(sc.branchId, (await currentPhysicalBranch()).id);
  const listed = countableSql(db);
  const countedThatMonth = exists(
    db
      .select({ id: sc.id })
      .from(sc)
      .where(and(eq(sc.month, month), sube, eq(sc.ingredientId, i.id))),
  );
  const [[counted], [total]] = await Promise.all([
    db
      .select({ n: count() })
      .from(sc)
      .innerJoin(i, eq(i.id, sc.ingredientId))
      .where(and(eq(sc.month, month), sube, listed)),
    db
      .select({ n: count() })
      .from(i)
      .where(and(listed, or(isNull(i.countFrom), lte(i.countFrom, month), countedThatMonth))),
  ]);
  return { counted: counted?.n ?? 0, total: total?.n ?? 0 };
}

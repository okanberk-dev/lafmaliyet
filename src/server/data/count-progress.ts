import "server-only";

import { and, count, eq, exists, isNull, lte, or } from "drizzle-orm";

import { ALL_BRANCHES, branchOpenIn, cashBranchLabel } from "@/lib/branches";
import { currentBranchScope, currentPhysicalBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { countableSql } from "@/server/data/ingredient-usage";

/**
 * Bir ayın sayım ilerlemesi: o ay sayılan kalem ve sayılacak kalem (Stok sayımı ekranının listesi: sayım birimi olan,
 * aktif ya da aktif bir ürünün reçetesinde geçen, listeye girdiği ay gelmiş ya da o ay sayılmış; engine.ts stockSheet,
 * kural src/lib/ingredient-usage.ts isCountable). Arşivlenen (listeden düşmüş pasif ya da "Sayılmaz") kalem sayılmaz.
 * Bugün, zil, ay sonu bildirimi ve sabah e-postası bunu kullanır: Stok sayımı ekranının "N / M"siyle aynı olmalı.
 * `branchId` verilmezse seçili fiziksel şubenin ("Tümü"de Tuzla) ilerlemesi, Stok sayımı ekranıyla aynı şube.
 */
export async function countProgress(month: string, branchId?: string): Promise<{ counted: number; total: number }> {
  const db = getDb();
  const i = s.ingredients;
  const sc = s.stockCounts;
  // Sayım şube başına
  const sube = eq(sc.branchId, branchId ?? (await currentPhysicalBranch()).id);
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

/** Sayımı hatırlatılan şube: kimlik ve birden çok fiziksel şube açıkken adı (metne girer; tek şubede null) */
export interface CountBranch {
  id: string;
  label: string | null;
}

/**
 * Sayımı hatırlatılacak şubeler (ay sonu bildirimi, sabah e-postası, yöneticinin zili; denetim ST-04). Tek şube
 * seçiliyken o şube (online kanal seçiliyken Tuzla, Stok sayımı ekranıyla aynı). "Tümü"de ve istek dışında (günlük
 * iş, sabah e-postası: çerez yok) `month`'ta açık her fiziksel şube (branchOpenIn; açılış günü sonraki bir aydaysa
 * yok): Tuzla sayımını bitirdi diye Marina'nın eksik sayımı susmaz; "Tümü"nün kapanış stoğu şubelerin toplamıdır.
 */
export async function countBranchesInScope(month: string): Promise<CountBranch[]> {
  const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  const of = (id: string): CountBranch => ({ id, label: cashBranchLabel(id, branches) });
  if (scope !== ALL_BRANCHES) return [of((await currentPhysicalBranch()).id)];
  return branches.filter((b) => b.active && b.kind === "fiziksel" && branchOpenIn(b, month)).map((b) => of(b.id));
}

/** Hatırlatılacak her şubenin ilerlemesi (countBranchesInScope sırasıyla) */
export async function countProgressByBranch(month: string): Promise<(CountBranch & { counted: number; total: number })[]> {
  const branches = await countBranchesInScope(month);
  return Promise.all(branches.map(async (b) => ({ ...b, ...(await countProgress(month, b.id)) })));
}

import "server-only";

import { and, count, eq, exists, isNull, lte, or } from "drizzle-orm";

import type { BranchCount } from "@/app/panel/sayim/logic";
import { tillBranches } from "@/lib/branches";
import { currentPhysicalBranch, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
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

/**
 * Bir ayın sayım ilerlemesi şube şube (sayım şube başına; docs/SUBE.md): o ay açık olan her fiziksel şube kendi
 * kapsamında okunur (`withBranchScope`; açılışı aydan sonra olan şube o ayı saymaz). Seçiciden bağımsız okuyanlar (sabah
 * e-postası, ay sonu bildirimi) bunu kullanır: günlük işte şube seçimi yok, `countProgress` "Tümü"de Tuzla'yı okuyordu
 * ve Marina'nın yarım sayımı hiç söylenmiyordu (denetim 21 Kasım #16). `named`: birden çok şube açık (metin şubenin
 * adını, adres `&sube=`'yi taşır); `open`: açık fiziksel şubelerin kimlikleri (bildirimin alıcıları).
 */
export async function countProgressByBranch(month: string): Promise<{ named: boolean; open: string[]; counts: BranchCount[] }> {
  const tills = tillBranches(await listBranches());
  const counted = tills.length ? tills.filter((b) => !b.openedOn || b.openedOn.slice(0, 7) <= month) : [await currentPhysicalBranch()];
  const counts = await Promise.all(counted.map(async (b) => ({ id: b.id, name: b.name, progress: await withBranchScope(b.id, () => countProgress(month)) })));
  return { named: tills.length > 1, open: tills.map((b) => b.id), counts };
}

import "server-only";

import { asc, count, eq } from "drizzle-orm";

import { type BranchRow, sortBranches } from "@/lib/branches";

import { getDb, schema as s, type DB } from "./db";

/**
 * Şube ve kanal kütüğünün okunması (docs/SUBE.md). Kurallar saf dosyada (src/lib/branches.ts); burada yalnız
 * veritabanı var. Liste her istekte okunur: üç-dört satırdır, önbelleğe alınmaz ki yeni açılan şube her ekranda
 * hemen görünsün.
 */
export async function listBranches(db: DB = getDb()): Promise<BranchRow[]> {
  const rows = await db
    .select({
      id: s.branches.id,
      name: s.branches.name,
      kind: s.branches.kind,
      posSource: s.branches.posSource,
      active: s.branches.active,
      openedOn: s.branches.openedOn,
      sortOrder: s.branches.sortOrder,
    })
    .from(s.branches)
    .orderBy(asc(s.branches.sortOrder), asc(s.branches.name));
  return sortBranches(rows);
}

export async function getBranch(db: DB, id: string): Promise<BranchRow | null> {
  const [row] = await db
    .select({
      id: s.branches.id,
      name: s.branches.name,
      kind: s.branches.kind,
      posSource: s.branches.posSource,
      active: s.branches.active,
      openedOn: s.branches.openedOn,
      sortOrder: s.branches.sortOrder,
    })
    .from(s.branches)
    .where(eq(s.branches.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Şubeye yazılmış kayıt sayısı: silmeden önce sorulur (src/lib/branches.ts branchDeleteError).
 *
 * Şube sütunu taşıyan her tablo sayılır (migration 0056). Giderin şubesi boş olabilir ("işletme geneli", sahibin
 * kararı): boş satır hiçbir şubeye sayılmaz, zaten `eq` onu dışarıda bırakır. Tek sorguda toplanır ki şube listesi
 * ekranı tablo başına bir gidiş dönüş yapmasın.
 */
export async function branchUsageCount(db: DB, id: string): Promise<number> {
  const tables = [
    s.cashReports,
    s.posDayReports,
    s.posDailySales,
    s.lafposDayEnds,
    s.modposCashSheets,
    s.months,
    s.salesLines,
    s.stockCounts,
    s.stockExtras,
    s.wasteEntries,
    s.cashOuts,
    s.staff,
    s.expenseEntries,
    s.fixedExpenses,
    // Şubeye bağlı kontrol listesi, ödeme ve personel hesabı: şube silinirse yabancı anahtar düşerdi
    s.reminders,
    s.checklistTemplates,
    s.users,
    // Şubenin kapalı günü (denetim 13 Kasım KP-05)
    s.specialDays,
  ];
  const counts = await Promise.all(
    tables.map(async (table) => {
      const [row] = await db.select({ n: count() }).from(table).where(eq(table.branchId, id));
      return Number(row?.n ?? 0);
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}

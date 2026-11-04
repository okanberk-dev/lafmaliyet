import "server-only";

import { asc, eq } from "drizzle-orm";

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
 * Dalga 1'de hiçbir ciro tablosunda şube sütunu YOK (docs/planlar/sube.md › Dalga 2), yani yeni açılmış bir şubeye
 * bağlı kayıt da olamaz: sayı sıfırdır ve kural yalnız sabit kayıtları (Tuzla, laffogato.net) korur. Dalga 2'de
 * kasa raporu, günlük satış ve giderler sayılacak; o zamana kadar çağıran sıfır geçer ve bu dosyada sahte bir
 * sorgu durmaz.
 */

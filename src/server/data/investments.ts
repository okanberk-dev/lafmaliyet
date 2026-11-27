import "server-only";

import { asc } from "drizzle-orm";

import type { BranchScope } from "@/lib/branches";
import { branchWhereWithShared } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Tek seferlik yatırımlar (Sabit giderler, dışa aktarımın Sabit Giderler sekmesi): tek şube seçiliyken o şubenin ve
 * işletme genelinin (şubesi boş) kayıtları, "Tümü"de hepsi (şube ayrımı, migration 0101; toplamı src/lib/investments.ts)
 */
export async function loadInvestments(scope: BranchScope, db: DB = getDb()) {
  return db.select().from(s.investments).where(branchWhereWithShared(s.investments.branchId, scope)).orderBy(asc(s.investments.id));
}

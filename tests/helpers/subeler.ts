// Veritabanı testlerinin şube kütüğü: canlıda Tuzla, Marina ve laffogato.net tohumla gelir (scripts/seed.ts
// ensureBranchSeed; docs/SUBE.md › Kütük), migration yalnız Tuzla'yı yazar. AsilPOS'un şubesi Marina olduğundan
// (ASILPOS_BRANCH_ID, 21 Kasım 2026) gün sonunu yazan her test bu tohumu ister: `pos_day_reports.branch_id` ve
// `pos_daily_sales.branch_id` şubeler kütüğüne bağlıdır, Marina yokken yazım yabancı anahtar hatasıyla düşer.

import { DEFAULT_BRANCHES } from "../../src/lib/branches";
import { ASILPOS_BRANCH_ID } from "../../src/lib/asilpos/switch";
import type { DB } from "../../src/server/db";
import * as s from "../../src/server/db/schema";

/** AsilPOS'un şubesi (Marina): testler kasa raporunu, föyü ve okumaları bu şubede kurar */
export const ASILPOS_SUBE = ASILPOS_BRANCH_ID;
/** ModPOS'ta kalan şube (Tuzla): geçiş günü onu etkilemez */
export const MODPOS_SUBE = "tuzla";

/** Tohumun yazdığı üç kayıt (var olan kayda dokunmaz) */
export async function seedBranches(db: DB): Promise<void> {
  await db
    .insert(s.branches)
    .values(DEFAULT_BRANCHES.map((b) => ({ ...b })))
    .onConflictDoNothing();
}

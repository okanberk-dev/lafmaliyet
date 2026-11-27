import "server-only";

import { asc } from "drizzle-orm";

import { staffCategory } from "@/lib/cash-outs";
import { ASILPOS_VERSION } from "@/lib/asilpos/day";
import { checkAsilposRequest } from "@/lib/asilpos/request";
import { schema as s, type DB } from "@/server/db";

import type { EndpointResult } from "./ingest";

/**
 * `GET /api/panel/pos/gider-kategorileri`'nin çekirdeği (Faz 3, 23 Kasım 2026; docs/ASILPOS.md › Kasadan çıkanlar
 * AsilPOS'tan): AsilPOS'un harcama penceresindeki kategori çipleri. Yalnız personelin seçebildiği kategoriler (Kasa'nın
 * personel listesiyle aynı kural: src/lib/cash-outs.ts staffCategory; etkin, alım ya da genel gider, "diğer" grubu),
 * panelin sırasıyla; tutar, grup ve ayar gitmez. Yalnız AsilPOS'un imzasıyla. 200 `{ version: 1, now, items: [{ id,
 * name, section }] }`, 401, 503
 */
export async function servePosExpenseCategories(db: DB, input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date }): Promise<EndpointResult> {
  const now = input.now ?? new Date();
  const check = checkAsilposRequest({ ...input, method: "GET", body: "", maxBytes: 0, now: now.getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  const rows = await db.select().from(s.expenseCategories).orderBy(asc(s.expenseCategories.sortOrder), asc(s.expenseCategories.id));
  const items = rows.filter(staffCategory).map((c) => ({ id: c.id, name: c.name, section: c.section }));
  return { status: 200, body: { version: ASILPOS_VERSION, now: now.toISOString(), items } };
}

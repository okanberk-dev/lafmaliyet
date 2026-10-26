import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";

import { extrasBase } from "@/app/panel/sayim/logic";
import type { getDb } from "@/server/db";
import { schema as s } from "@/server/db";
import { UserError } from "@/server/user-error";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Ek kalemler formun gördüğünden farklıysa (arada başkası kaydetti) */
export const EXTRAS_CHANGED_MESSAGE =
  "Listede olmayanlar bu arada başkası tarafından kaydedildi; ek kalemlerde hiçbir şey kaydedilmedi. Güncel listeyi kontrol edip yeniden kaydedin.";

/**
 * Ayın ek kalemlerini aynı anda tek kayıt yazsın (işlem kilidi) ve formun gördüğü listeyle karşılaştırsın (`base`:
 * sayim/logic.ts extrasBase). Fark varsa yazılmaz, sayfa yenilenir; form yeni listeyi birleştirir (mergeExtras).
 * `base` göndermeyen eski istemci denetimsiz yazar. Yöneticinin (saveStockExtras) ve personelin (saveStaffStockExtras)
 * kaydı aynı kapıdan geçer. Ayın kayıtlı ek kalemlerini döner.
 */
export async function lockExtras(tx: Tx, month: string, base: string | undefined) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sayim-ek-${month}`}))`);
  const existing = await tx.select().from(s.stockExtras).where(eq(s.stockExtras.month, month)).orderBy(asc(s.stockExtras.id));
  if (base !== undefined && extrasBase(existing) !== base) {
    refresh();
    throw new UserError(EXTRAS_CHANGED_MESSAGE);
  }
  return existing;
}

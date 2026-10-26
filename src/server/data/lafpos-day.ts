import "server-only";

import { eq } from "drizzle-orm";

import { posZSchema } from "@/lib/lafpos/day";
import { lafposPrefill, type LafposDay } from "@/lib/lafpos/prefill";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Kasa raporunun "LafPOS'tan doldur"u (docs/LAFPOS.md › Kasa raporu): günün LafPOS özeti, iki rolde. Yalnız Z özeti ve
 * geliş anı okunur (sabit sütunlar); ödeme kanalları ve ikramlar okunmaz, personele gitmez. Gün gelmediyse ya da özet
 * okunamıyorsa null: düğme görünmez, form her zamanki gibi elle doldurulur.
 */
export async function loadLafposDay(date: string, db: DB = getDb()): Promise<LafposDay | null> {
  const [row] = await db
    .select({ z: s.posDayReports.z, receivedAt: s.posDayReports.receivedAt })
    .from(s.posDayReports)
    .where(eq(s.posDayReports.date, date))
    .limit(1);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  return z.success ? { receivedAt: row.receivedAt.toISOString(), prefill: lafposPrefill(z.data) } : null;
}

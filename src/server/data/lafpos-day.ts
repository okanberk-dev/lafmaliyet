import "server-only";

import { eq } from "drizzle-orm";

import { posZSchema } from "@/lib/lafpos/day";
import { lafposPrefill, type LafposDay } from "@/lib/lafpos/prefill";
import { isLafposDay } from "@/lib/lafpos/switch";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

/**
 * Kasa raporunun okuduğu (docs/LAFPOS.md › Kasa raporu): yalnız LafPOS günlerinde, yani geçiş günü seçili ve gün ondan
 * önce değilse (src/lib/lafpos/switch.ts). Geçiş günü boşken ya da önceki bir günde LafPOS'un gönderdiği gün (deneme)
 * hiçbir role görünmez, bant çıkmaz, form bugünkü gibi ModPOS'a göre elle doldurulur (sahibin 26 Ekim kararı).
 */
export async function loadKasaLafposDay(date: string, db: DB = getDb()): Promise<LafposDay | null> {
  return isLafposDay(date, await loadLafposSwitchDay(db)) ? loadLafposDay(date, db) : null;
}

/**
 * Günün LafPOS özeti, geçiş gününe bakmadan (Kasa raporu loadKasaLafposDay'den geçer): "LafPOS'tan doldur"un verisi.
 * Yalnız Z özeti ve geliş anı okunur (sabit sütunlar); ödeme kanalları ve ikramlar okunmaz, personele gitmez. Gün
 * gelmediyse ya da özet okunamıyorsa null: düğme görünmez, form her zamanki gibi elle doldurulur.
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

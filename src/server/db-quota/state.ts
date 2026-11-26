import "server-only";

import { eq, sql } from "drizzle-orm";

import { asDbQuotaState, DB_QUOTA_STATE_KEY, quotaMb, quotaPct, type DbQuotaState } from "@/lib/db-quota";
import { getDb, schema as s, type DB } from "@/server/db";

/** Veritabanının diskteki boyutu (bütün tablolar, dizinler ve boş alan; Neon'un kotası da buna bakar) */
export async function readDbSizeBytes(db: DB = getDb()): Promise<number> {
  const rows = await db.execute<{ bytes: string }>(sql`SELECT pg_database_size(current_database())::text AS bytes`);
  return Number(rows[0]?.bytes ?? 0);
}

/** Ayarlar › Veritabanı: o anki boyut, kota (`DB_QUOTA_MB`, varsayılan 512) ve yüzde */
export async function loadDbUsage(db: DB = getDb()): Promise<{ bytes: number; quotaMb: number; pct: number }> {
  const bytes = await readDbSizeBytes(db);
  const mb = quotaMb(process.env.DB_QUOTA_MB);
  return { bytes, quotaMb: mb, pct: quotaPct(bytes, mb) };
}

/** Sabah işinin son ölçümü ve bildirilmiş seviye (integration_state › db.quota) */
export async function readDbQuotaState(db: DB = getDb()): Promise<DbQuotaState> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, DB_QUOTA_STATE_KEY)).limit(1);
  return asDbQuotaState(row?.value);
}

export async function saveDbQuotaState(db: DB, v: DbQuotaState): Promise<void> {
  await db
    .insert(s.integrationState)
    .values({ key: DB_QUOTA_STATE_KEY, value: v })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: v, updatedAt: new Date() } });
}

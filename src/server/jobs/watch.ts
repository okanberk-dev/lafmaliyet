// Günlük işlerin izlenmeye başladığı an (integration_state › jobs.watchSince). İş bu andan önce hiç çalışmadıysa
// "çalışmadı" denmez: ilk yayının sabahı yanlış alarm vermez (src/lib/job-health.ts › jobHealth). Her işin başında
// (runs.ts › startJobRun) yalnız yoksa yazılır; canlı derlemede (scripts/predeploy.ts) işler bir günden uzun süredir
// kayıt yazmıyorsa o yayının anıyla değiştirilir (job-health › watchRestarts). Okuyan ekranlar yazmaz.
// "server-only" yok: derleme betiği de kullanır (src/server/db/index.ts gibi).

import { desc, inArray } from "drizzle-orm";

import { watchRestarts } from "@/lib/job-health";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

export const WATCH_SINCE_KEY = "jobs.watchSince";

export async function markWatchSince(db: DB, at = new Date()): Promise<void> {
  await db.insert(s.integrationState).values({ key: WATCH_SINCE_KEY, value: at.toISOString() }).onConflictDoNothing();
}

/** Canlı derlemede: işler son bir günde kayıt yazdıysa başlangıç kalır, yazmadıysa izleme bu yayından başlar */
export async function restartWatchOnDeploy(db: DB, now = new Date()): Promise<boolean> {
  // Yalnız iki günlük iş: kontrol listesi işinin kayıtları sabah işlerinin kayıt yazdığını göstermez
  const [last] = await db
    .select({ at: s.jobRuns.startedAt })
    .from(s.jobRuns)
    .where(inArray(s.jobRuns.job, ["parasut", "gunluk"]))
    .orderBy(desc(s.jobRuns.startedAt))
    .limit(1);
  if (!watchRestarts(last?.at.toISOString() ?? null, now)) return false;
  const value = now.toISOString();
  await db
    .insert(s.integrationState)
    .values({ key: WATCH_SINCE_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: now } });
  return true;
}

// Günlük işlerin izlenmeye başladığı an (integration_state › jobs.watchSince). İş bu andan önce hiç çalışmadıysa
// "çalışmadı" denmez: ilk yayının sabahı yanlış alarm vermez (src/lib/job-health.ts › jobHealth). Yalnız yoksa
// yazılır: canlı derlemede (scripts/predeploy.ts) ve her işin başında (runs.ts › startJobRun). Okuyan ekranlar yazmaz.
// "server-only" yok: derleme betiği de kullanır (src/server/db/index.ts gibi).

import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

export const WATCH_SINCE_KEY = "jobs.watchSince";

export async function markWatchSince(db: DB, at = new Date()): Promise<void> {
  await db.insert(s.integrationState).values({ key: WATCH_SINCE_KEY, value: at.toISOString() }).onConflictDoNothing();
}

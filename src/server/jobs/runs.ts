import "server-only";

import { and, desc, eq, gte, lt, ne } from "drizzle-orm";

import { CUT_OFF_MESSAGE, RUNS_KEEP_DAYS, STUCK_MS, type JobKey, type JobOutcome, type JobRunLite } from "@/lib/job-health";
import { getDb, schema as s } from "@/server/db";

import { markWatchSince, WATCH_SINCE_KEY } from "./watch";

/**
 * Günlük işin çalışma kaydını açar: aynı işin yarıda kalmış (işlev süresi dolmuş) çalışması "hata" olur (iletisi
 * CUT_OFF_MESSAGE; durumu yine "yarıda kesildi" sayılır), 90 günden eski kayıtlar silinir, izleme başlangıcı yoksa
 * yazılır. Kayıt yazılamazsa (veritabanı yok) iş yine çalışır: null.
 */
export async function startJobRun(job: JobKey): Promise<number | null> {
  try {
    const db = getDb();
    const now = Date.now();
    await Promise.all([
      db
        .update(s.jobRuns)
        .set({ status: "error", finishedAt: new Date(now), message: CUT_OFF_MESSAGE })
        .where(and(eq(s.jobRuns.job, job), eq(s.jobRuns.status, "running"), lt(s.jobRuns.startedAt, new Date(now - STUCK_MS)))),
      db.delete(s.jobRuns).where(lt(s.jobRuns.startedAt, new Date(now - RUNS_KEEP_DAYS * 86_400_000))),
      markWatchSince(db),
    ]);
    const [row] = await db.insert(s.jobRuns).values({ job }).returning({ id: s.jobRuns.id });
    return row.id;
  } catch (e) {
    console.error(`[cron] ${job} çalışma kaydı açılamadı`, e);
    return null;
  }
}

/** Çalışmanın sonucunu yazar (hata olursa yalnız günlüğe) */
export async function finishJobRun(id: number | null, outcome: JobOutcome): Promise<void> {
  if (id === null) return;
  try {
    await getDb()
      .update(s.jobRuns)
      .set({ status: outcome.status, finishedAt: new Date(), steps: outcome.steps, message: outcome.message?.slice(0, 500) ?? null })
      .where(eq(s.jobRuns.id, id));
  } catch (e) {
    console.error("[cron] çalışma sonucu yazılamadı", e);
  }
}

/** Son `days` günün çalışmaları, yeni önce */
export async function loadJobRuns(days = 8): Promise<JobRunLite[]> {
  const rows = await getDb()
    .select()
    .from(s.jobRuns)
    .where(gte(s.jobRuns.startedAt, new Date(Date.now() - days * 86_400_000)))
    .orderBy(desc(s.jobRuns.startedAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    job: r.job,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    steps: r.steps ?? null,
    message: r.message,
  }));
}

/** İzlemenin başladığı an (yalnız okur; yazan canlı derleme ve startJobRun) */
export async function readWatchSince(): Promise<string | null> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, WATCH_SINCE_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : null;
}

/** Bugün (İstanbul) başarılı bir Paraşüt eşitlemesi var mı (tedarikçi geçmişi sayılmaz) */
export async function parasutSyncedToday(): Promise<boolean> {
  const start = new Date();
  // İstanbul gece yarısı (UTC+3, yaz saati yok)
  start.setUTCHours(-3, 0, 0, 0);
  if (start.getTime() > Date.now()) start.setUTCDate(start.getUTCDate() - 1);
  const [run] = await getDb()
    .select({ id: s.parasutSyncRuns.id })
    .from(s.parasutSyncRuns)
    .where(and(eq(s.parasutSyncRuns.status, "ok"), ne(s.parasutSyncRuns.trigger, "history"), gte(s.parasutSyncRuns.startedAt, start)))
    .orderBy(desc(s.parasutSyncRuns.startedAt))
    .limit(1);
  return Boolean(run);
}

/** Günlük eşitlemenin (tedarikçi geçmişi hariç) son hatalı çalışmasının başlangıcı */
export async function lastParasutSyncErrorAt(): Promise<string | null> {
  const [run] = await getDb()
    .select({ startedAt: s.parasutSyncRuns.startedAt })
    .from(s.parasutSyncRuns)
    .where(and(eq(s.parasutSyncRuns.status, "error"), ne(s.parasutSyncRuns.trigger, "history")))
    .orderBy(desc(s.parasutSyncRuns.startedAt))
    .limit(1);
  return run?.startedAt.toISOString() ?? null;
}

/**
 * Günlük eşitlemenin (tedarikçi geçmişi hariç) son başarılı çalışmasının başlangıcı (cron, sabah işinin yeniden
 * denemesi ya da "Şimdi eşitle"). Bugün ekranı, Paraşüt işinin hatasından sonra başarılı bir eşitleme olduysa o hatayı
 * göstermez (src/app/panel/bugun/logic.ts systemIssues).
 */
export async function lastParasutSyncOkAt(): Promise<string | null> {
  const [run] = await getDb()
    .select({ startedAt: s.parasutSyncRuns.startedAt })
    .from(s.parasutSyncRuns)
    .where(and(eq(s.parasutSyncRuns.status, "ok"), ne(s.parasutSyncRuns.trigger, "history")))
    .orderBy(desc(s.parasutSyncRuns.startedAt))
    .limit(1);
  return run?.startedAt.toISOString() ?? null;
}

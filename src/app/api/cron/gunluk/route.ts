import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getDb, schema as s } from "@/server/db";
import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { runReminderDigest } from "@/server/notify/digest";
import { isParasutConfigured } from "@/server/parasut/config";
import { syncParasut } from "@/server/parasut/sync";

// Her sabah 08:00–09:00 (05:00 UTC; Vercel Hobby'de saat esnek, bir saatlik pencere): sabah e-postası (ödemeler +
// Paraşüt'ten gelen yeni faturalar). Paraşüt eşitlemesi bir saat önce ayrı bir işte çalışır (/api/cron/parasut);
// o iş bu sabah başarıyla çalışmadıysa (atlandı, hata verdi) e-postadan önce burada bir kez daha denenir.
export const maxDuration = 60;

/** Bugün (İstanbul) başarılı bir eşitleme var mı */
async function syncedToday(): Promise<boolean> {
  const start = new Date();
  // İstanbul gece yarısı (UTC+3, yaz saati yok)
  start.setUTCHours(-3, 0, 0, 0);
  if (start.getTime() > Date.now()) start.setUTCDate(start.getUTCDate() - 1);
  const [run] = await getDb()
    .select({ id: s.parasutSyncRuns.id })
    .from(s.parasutSyncRuns)
    .where(and(eq(s.parasutSyncRuns.status, "ok"), gte(s.parasutSyncRuns.startedAt, start)))
    .orderBy(desc(s.parasutSyncRuns.startedAt))
    .limit(1);
  return Boolean(run);
}

export async function GET(request: NextRequest) {
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  let sync: { ok: boolean; summary?: string; error?: string } | null = null;
  try {
    if (isParasutConfigured() && !(await syncedToday())) {
      const r = await syncParasut("cron", { deadlineMs: 35_000 });
      sync = r.ok ? { ok: true, summary: r.summary } : { ok: false, error: r.error };
    }
  } catch (e) {
    sync = { ok: false, error: (e as Error).message };
  }
  try {
    const result = await runReminderDigest("cron");
    return NextResponse.json({ ...result, sync }, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ status: "error", error: (e as Error).message, sync }, { status: 500 });
  }
}

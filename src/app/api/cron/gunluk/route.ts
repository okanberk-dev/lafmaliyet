import { and, desc, eq, gte, ne } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getDb, schema as s } from "@/server/db";
import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { syncKaraoke } from "@/server/karaoke/sync";
import { runReminderDigest } from "@/server/notify/digest";
import { pushReminderSummaries } from "@/server/notify/reminder-push";
import { isParasutConfigured } from "@/server/parasut/config";
import { syncParasut } from "@/server/parasut/sync";
import { syncSiteMenu } from "@/server/site-menu/sync";

// Her sabah 08:00–09:00 (05:00 UTC; Vercel Hobby'de saat esnek, bir saatlik pencere): sabah e-postası (ödemeler +
// Paraşüt'ten gelen yeni faturalar). Paraşüt eşitlemesi bir saat önce ayrı bir işte çalışır (/api/cron/parasut);
// o iş bu sabah başarıyla çalışmadıysa (atlandı, hata verdi) e-postadan önce burada bir kez daha denenir. Ardından
// kişisel hatırlatıcıların sabah bildirimi, karaoke rezervasyonlarının ve laffogato.net menüsünün (fiyat, Satışta /
// Tükendi; docs/SITE-MENU.md) günlük yedek eşitlemesi (ping kaçtıysa).
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
    // Tedarikçi geçmişi (tek tedarikçi) günün eşitlemesi sayılmaz
    .where(and(eq(s.parasutSyncRuns.status, "ok"), ne(s.parasutSyncRuns.trigger, "history"), gte(s.parasutSyncRuns.startedAt, start)))
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
  // Kişisel hatırlatıcı bildirimi, karaoke ve menü eşitlemesi sabah e-postasını bekletmez, bozamaz
  const extras = async () => {
    const [reminders, karaoke, menu] = await Promise.all([
      pushReminderSummaries().catch((e: Error) => ({ error: e.message })),
      syncKaraoke("cron").catch((e: Error) => ({ status: "error" as const, error: e.message })),
      syncSiteMenu("cron").catch((e: Error) => ({ status: "error" as const, error: e.message })),
    ]);
    return { reminders, karaoke: karaoke.status, menu: menu.status };
  };
  try {
    const result = await runReminderDigest("cron");
    return NextResponse.json({ ...result, sync, ...(await extras()) }, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ status: "error", error: (e as Error).message, sync, ...(await extras()) }, { status: 500 });
  }
}

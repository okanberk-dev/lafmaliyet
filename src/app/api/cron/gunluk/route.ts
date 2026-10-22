import { NextResponse, type NextRequest } from "next/server";

import { dailyOutcome, digestStep, reminderStep, type DailyStep, type JobOutcome, type StepResult } from "@/lib/job-health";
import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { finishJobRun, parasutSyncedToday, startJobRun } from "@/server/jobs/runs";
import { syncKaraoke } from "@/server/karaoke/sync";
import { runReminderDigest } from "@/server/notify/digest";
import { pushReminderSummaries } from "@/server/notify/reminder-push";
import { isParasutConfigured } from "@/server/parasut/config";
import { syncParasut } from "@/server/parasut/sync";
import { syncSiteMenu } from "@/server/site-menu/sync";
import { syncSiteSales } from "@/server/site-sales/sync";

// Her sabah 08:00–09:00 (05:00 UTC; Vercel Hobby'de saat esnek, bir saatlik pencere): sabah e-postası (ödemeler +
// Paraşüt'ten gelen yeni faturalar). Paraşüt eşitlemesi bir saat önce ayrı bir işte çalışır (/api/cron/parasut);
// o iş bu sabah başarıyla çalışmadıysa (atlandı, hata verdi) e-postadan önce burada bir kez daha denenir. Ardından
// kişisel hatırlatıcıların sabah bildirimi, karaoke rezervasyonlarının ve laffogato.net menüsünün (fiyat, Satışta /
// Tükendi; docs/SITE-MENU.md) günlük yedek eşitlemesi (ping kaçtıysa) ve laffogato.net'in online satışları (bu ay;
// ayın ilk 7 gününde geçen ay da; docs/SITE-SATIS.md). Her çalışma ve adımlarının sonucu job_runs'a yazılır
// (Ayarlar › Günlük işler); e-posta gidemezse ya da iş hiç çalışmazsa ertesi sabah Paraşüt işinin bekçisi söyler.
export const maxDuration = 60;

/** Site eşitlemelerinin sonucu adım koduna (hata metniyle) */
function siteStep(r: { status: string; error?: string; results?: { month: string; status: string; error?: string }[] }): StepResult {
  if (r.status !== "error") return { code: r.status };
  const months = (r.results ?? []).filter((x) => x.status === "error").map((x) => `${x.month}: ${x.error ?? "hata"}`);
  return { code: "error", error: r.error ?? (months.join(" · ") || null) };
}

export async function GET(request: NextRequest) {
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  const runId = await startJobRun("gunluk");
  const configured = isParasutConfigured();
  let alreadySynced = false;
  let sync: { ok: boolean; summary?: string; error?: string } | null = null;
  let syncStep: StepResult = { code: configured ? "today" : "off" };
  try {
    if (configured) {
      alreadySynced = await parasutSyncedToday();
      if (!alreadySynced) {
        const r = await syncParasut("cron", { deadlineMs: 35_000 });
        sync = r.ok ? { ok: true, summary: r.summary } : { ok: false, error: r.error };
        syncStep = r.ok ? { code: "ok" } : "busy" in r && r.busy ? { code: "busy" } : { code: "error", error: r.error };
      }
    }
  } catch (e) {
    sync = { ok: false, error: (e as Error).message };
    syncStep = { code: "error", error: sync.error };
  }
  // Kişisel hatırlatıcı bildirimi, karaoke ve menü eşitlemesi, online satışlar sabah e-postasını bekletmez, bozamaz;
  // her biri kendi hatasını yakalar, biri bozulsa öteki çalışır
  const extras = async () => {
    const [reminders, karaoke, menu, sales] = await Promise.all([
      pushReminderSummaries().catch((e: Error) => ({ error: e.message })),
      syncKaraoke("cron").catch((e: Error) => ({ status: "error" as const, error: e.message })),
      syncSiteMenu("cron").catch((e: Error) => ({ status: "error" as const, error: e.message })),
      syncSiteSales().catch((e: Error) => ({ status: "error" as const, error: e.message })),
    ]);
    const steps: Record<Exclude<DailyStep, "sync" | "digest">, StepResult> = {
      reminders: reminderStep(reminders),
      karaoke: siteStep(karaoke),
      menu: siteStep(menu),
      sales: siteStep(sales),
    };
    return { body: { reminders, karaoke: karaoke.status, menu: menu.status, sales: sales.status }, steps };
  };
  let outcome: JobOutcome = { status: "error", steps: {}, message: "İş yarıda kaldı" };
  try {
    // Sistem bölümü (bu sabahki Paraşüt işi) eşitlemenin bugün yapılıp yapılmadığını söyler
    const result = await runReminderDigest("cron", { syncedToday: alreadySynced || Boolean(sync?.ok) });
    const ex = await extras();
    outcome = dailyOutcome({ sync: syncStep, digest: digestStep(result), ...ex.steps });
    return NextResponse.json({ ...result, sync, ...ex.body }, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    const ex = await extras();
    outcome = dailyOutcome({ sync: syncStep, digest: { code: "error", error: (e as Error).message }, ...ex.steps });
    return NextResponse.json({ status: "error", error: (e as Error).message, sync, ...ex.body }, { status: 500 });
  } finally {
    await finishJobRun(runId, outcome);
  }
}

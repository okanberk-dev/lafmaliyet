import { NextResponse, type NextRequest } from "next/server";

import { parasutOutcome, type JobOutcome } from "@/lib/job-health";
import { sendWatchdogAlert } from "@/server/jobs/alerts";
import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { finishJobRun, startJobRun } from "@/server/jobs/runs";
import { isParasutConfigured } from "@/server/parasut/config";
import { syncParasut } from "@/server/parasut/sync";

// Her sabah 07:00–08:00 (04:30 UTC; vercel.json → crons; Hobby planında saat bir saatlik pencerede esnek):
// Paraşüt'ten gider faturaları ve gelen e-faturalar (Paraşüt'te "içeri al" yapılmamışlar dahil). 45 sn'de kalan
// sayfalar bir sonraki çalışmada kaldığı yerden sürer; sabah e-postası işi bu çalışma başarısızsa bir kez daha dener.
// Her çalışma job_runs'a yazılır (Ayarlar › Günlük işler). Eşitlemeden önce bekçi: dünkü sabah işi çalışmadıysa ya da
// hata verdiyse e-posta alıcılarına kısa bir uyarı gider (src/server/jobs/alerts.ts). Bekçi en çok 8 sn bekletir,
// eşitlemeye kalan süre verilir (en az 20 sn): işlev 60 sn'yi aşıp iki kayıt da "sürüyor"da kalmasın.
export const maxDuration = 60;

const WATCHDOG_MS = 8_000;

/** Bekçi e-postası; 8 sn'de bitmezse beklemeden geçilir (gönderim arkada sürebilir, Resend tekil anahtarı yineletmez) */
async function watchdog(): Promise<"sent" | "none" | "error"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"error">((resolve) => {
    timer = setTimeout(() => {
      console.error("[cron] sistem uyarısı 8 sn'de bitmedi");
      resolve("error");
    }, WATCHDOG_MS);
  });
  const send = sendWatchdogAlert().catch((e) => {
    console.error("[cron] sistem uyarısı", e);
    return "error" as const;
  });
  try {
    return await Promise.race([send, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  const started = Date.now();
  const runId = await startJobRun("parasut");
  const watch = await watchdog();
  const configured = await isParasutConfigured();
  let outcome: JobOutcome = parasutOutcome({ configured, watchdog: watch });
  try {
    if (!configured) return NextResponse.json({ status: "skipped", reason: "Paraşüt bağlantısı tanımlı değil" });
    const result = await syncParasut("cron", { deadlineMs: Math.max(20_000, 45_000 - (Date.now() - started)) });
    outcome = parasutOutcome({ configured, result, watchdog: watch });
    // Başka bir eşitleme sürerken başlamayan çalışma hata değildir (Vercel cron günlüğünde başarısız görünmesin)
    return NextResponse.json(result, { status: result.ok || ("busy" in result && result.busy) ? 200 : 500 });
  } catch (e) {
    outcome = parasutOutcome({ configured, error: (e as Error).message, watchdog: watch });
    throw e;
  } finally {
    await finishJobRun(runId, outcome);
    // Başarıda da tek satır: Vercel günlüğünden işin çalıştığı görülür (job_runs'a bakmadan)
    console.info("[cron] parasut", { status: outcome.status, ...outcome.steps, ms: Date.now() - started });
  }
}

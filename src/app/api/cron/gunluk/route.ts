import { NextResponse, type NextRequest } from "next/server";

import { countStep, dailyOutcome, digestStep, gunSonuStep, modposStep, photosStep, reminderStep, requestsStep, type CoreStep, type JobOutcome, type OptionalStep, type StepResult } from "@/lib/job-health";
import { weeklyStep, WEEKLY_DEADLINE_MS, type WeeklyRunResult } from "@/lib/weekly/core";
import { capped, JOB_SEND_DEADLINE_MS, tailStepDeadline } from "@/server/jobs/capped";
import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { getDb } from "@/server/db";
import { finishJobRun, parasutSyncedToday, startJobRun } from "@/server/jobs/runs";
import { dailyKaraoke } from "@/server/karaoke/history";
import { catchUpLafposDayEnds } from "@/server/lafpos/gun-sonu";
import { pruneMcp } from "@/server/mcp/store";
import { isModposConfigured } from "@/server/modpos/client";
import { syncModposAll, type ModposSyncResult } from "@/server/modpos/sync";
import { pushMonthEndCount } from "@/server/notify/count-push";
import { runReminderDigest } from "@/server/notify/digest";
import { pushReminderSummaries } from "@/server/notify/reminder-push";
import { isParasutConfigured } from "@/server/parasut/config";
import { syncParasut } from "@/server/parasut/sync";
import { syncSiteMenu } from "@/server/site-menu/sync";
import { syncSiteSales } from "@/server/site-sales/sync";
import { expireStaffRequests } from "@/server/staff-requests/core";
import { cleanupPhotos } from "@/server/storage/photos";
import { runWeeklyStep } from "@/server/weekly/send";

// Her sabah 08:00–09:00 (05:00 UTC; Vercel Hobby'de saat esnek, bir saatlik pencere): sabah e-postası (ödemeler +
// Paraşüt'ten gelen yeni faturalar). Paraşüt eşitlemesi bir saat önce ayrı bir işte çalışır (/api/cron/parasut);
// o iş bu sabah başarıyla çalışmadıysa (atlandı, hata verdi) e-postadan önce burada bir kez daha denenir. Ardından
// kişisel hatırlatıcıların sabah bildirimi, karaoke rezervasyonlarının ve laffogato.net menüsünün (fiyat, Satışta /
// Tükendi; docs/SITE-MENU.md) günlük yedek eşitlemesi (ping kaçtıysa) ve laffogato.net'in online satışları (bu ay ve
// önceki iki ay: geç iadeler; salesMonthsToPull, docs/SITE-SATIS.md), süresi dolan fotoğrafların silinmesi (docs/FOTOGRAF.md),
// Claude bağlantısının eski kod, anahtar ve kayıtlarının temizliği (docs/CLAUDE-BAGLANTISI.md), ayın son günü ay sonu
// stok sayımı bildirimi (tamamlanmadıysa). Pazartesi (gönderilemezse salı, çarşamba) yöneticilere haftalık özet
// (docs/HAFTALIK-OZET.md). Satış tahmini (hava durumu ve günün tahmin kaydı; docs/SATIS-TAHMINI.md) Paraşüt'ün
// yeniden denemesiyle aynı anda çalışır, sabah e-postasından önce beklenir. Süresi dolan personel istekleri (kasadan
// çıkan) kapanır ve tuttukları fotoğraflar bırakılır (docs/ONAYLAR.md). ModPOS'un kasa föyü (dün ve bir geçmiş gün,
// günde 2 hak; docs/MODPOS-API.md) de Paraşüt'le aynı anda yalnız bir kez çekilir, sabah e-postasından önce beklenir.
// Her çalışma ve adımlarının sonucu job_runs'a yazılır (Ayarlar › Günlük işler); e-posta gidemezse ya da iş hiç
// çalışmazsa ertesi sabah Paraşüt işinin bekçisi söyler. Zaman bütçesi jobStart'tan: sabah e-postasının gönderimi en
// geç 48 sn'de kesilir (takılan Resend işlevi bitirmesin), kuyruk en geç 55 sn'de biter (src/server/jobs/capped.ts).
export const maxDuration = 60;


/**
 * ModPOS kasa föyünün son anı (jobStart'tan sonra; src/server/modpos/sync.ts): istekler bu ana kadar biter, 5 sn'den
 * azı kaldıysa yeni istek başlamaz. Belge 60 sn'lik zaman aşımı önerir; Paraşüt'ün 35 sn'lik yeniden denemesiyle aynı
 * anda biter, sabah e-postasının 48 sn'lik sınırına pay kalır (docs/MODPOS-API.md › Kota ve çekme sırası)
 */
const MODPOS_DEADLINE_MS = 30_000;
/** ModPOS adımının beklenme sınırı (jobStart'tan sonra): son anın üstüne föyü ve çalışmayı yazma payı */
const MODPOS_CAP_MS = 32_000;
/** Anahtar yoksa çekme hiç başlamaz (veritabanına da gidilmez); adım yazılmaz (modposStep) */
const MODPOS_OFF: ModposSyncResult = { status: "off", days: [], left: null };

/** Site eşitlemelerinin sonucu adım koduna (hata metniyle) */
function siteStep(r: { status: string; error?: string; results?: { month: string; status: string; error?: string }[] }): StepResult {
  if (r.status !== "error") return { code: r.status };
  const months = (r.results ?? []).filter((x) => x.status === "error").map((x) => `${x.month}: ${x.error ?? "hata"}`);
  return { code: "error", error: r.error ?? (months.join(" · ") || null) };
}

export async function GET(request: NextRequest) {
  // Zaman bütçesinin başı: işlevin 60 sn'si istekle başlar
  const jobStart = Date.now();
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  const runId = await startJobRun("gunluk");
  // Satış tahmini Paraşüt'ün yeniden denemesiyle aynı anda başlar; e-postadan önce beklenir (kutusu taze havayla ve
  // kaydedilen sayılarla). Hata fırlatmaz, en çok 7 sn
  // ModPOS kasa föyü (docs/MODPOS-API.md): yalnız burada ve bir kez başlar; ModPOS'lu her şube kendi anahtarı ve hakkıyla,
  // sırayla (docs/MODPOS-API.md › Şubeler) (extras() iki kez çalışabilir, günde 2 hak
  // var). Paraşüt'le aynı anda sürer, e-postadan önce beklenir: e-posta, zil ve Bugün taze föyü görür. Hata fırlatmaz,
  // en çok jobStart + 32 sn
  const modposP = capped<ModposSyncResult>(
    (isModposConfigured() ? syncModposAll("cron", { deadlineAt: jobStart + MODPOS_DEADLINE_MS }) : Promise.resolve(MODPOS_OFF)).catch(
      (e: Error): ModposSyncResult => ({ status: "error", days: [], left: null, error: e.message }),
    ),
    jobStart + MODPOS_CAP_MS - Date.now(),
    { status: "error", days: [], left: null, error: "süre doldu" },
  );
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
  // Süresi dolan fotoğraflar: en çok 100 adet, kendi sınırında (en çok 8 sn, kuyruğun 55 sn'sini aşmadan)
  const photosTask = () => {
    const deadlineAt = tailStepDeadline(jobStart);
    return capped(
      cleanupPhotos({ limit: 100, deadlineAt }).catch((e: Error) => ({ error: e.message })),
      deadlineAt - Date.now() + 500,
      { error: "süre doldu" },
    );
  };
  // Claude bağlantısının temizliği (süresi dolan kod ve anahtarlar, eski kayıtlar; docs/CLAUDE-BAGLANTISI.md): en çok
  // 3 sn, sonucu yalnız yanıtta (body.mcp). İş adımı değil: temizlik aksarsa "Günlük işler" uyarısı açılmaz
  const mcpTask = () =>
    capped(
      pruneMcp(getDb(), new Date())
        .then(() => "ok" as const)
        .catch((e: Error) => {
          console.error("[mcp] temizlik", e);
          return "error" as const;
        }),
      Math.min(3_000, tailStepDeadline(jobStart) - Date.now()),
      "süre doldu" as const,
    );
  // Ay sonu stok sayımı bildirimi (ayın son günü, sayım tamamlanmadıysa): en çok 8 sn, kuyruğun 55 sn'sini aşmadan;
  // adım yalnız bildirim gönderilince yazılır
  const countTask = () =>
    capped(
      pushMonthEndCount().catch((e: Error) => ({ error: e.message })),
      Math.min(8_000, tailStepDeadline(jobStart) - Date.now()),
      { error: "süre doldu" },
    );
  // Haftalık özet (docs/HAFTALIK-OZET.md): sabah e-postasından sonra (bugün ilk kez bildirileni yinelemesin), kuyruktaki
  // öteki adımlarla aynı anda; kendi son anı jobStart + 52 sn (okuma 4 sn, gönderim tek deneme 4 sn), takılan veritabanı
  // için kuyruğun sınırında (55 sn) bırakılır. Adım yalnız çalıştığı gün yazılır, sonucu yanıtta (body.weekly)
  const weeklyTask = () =>
    capped<WeeklyRunResult>(
      runWeeklyStep(new Date(), { deadlineAt: jobStart + WEEKLY_DEADLINE_MS }).catch((e: Error): WeeklyRunResult => ({ status: "error", weekday: 0, error: e.message })),
      jobStart + WEEKLY_DEADLINE_MS + 3_000 - Date.now(),
      { status: "error", weekday: 0, error: "süre doldu" },
    );
  // Personel istekleri (docs/ONAYLAR.md): süresi dolan bekleyen ve onaylanmış istekler "Süresi doldu" olur; en çok 3 sn,
  // kuyruğun 55 sn'sini aşmadan. Adım yalnız bir istek kapanınca ya da hata verince yazılır
  const requestsTask = () =>
    capped(
      expireStaffRequests(getDb(), new Date()).catch((e: Error) => ({ error: e.message })),
      Math.min(3_000, tailStepDeadline(jobStart) - Date.now()),
      { error: "süre doldu" },
    );
  // LafPOS gün sonu (docs/LAFPOS.md › Gün sonu otomasyonu): son 7 günün Kasa raporu ve gün sonu e-postası eksikse
  // tamamlanır (gece gönderilemeyen e-posta, geçiş günü sonradan girildiyse eksik günler); işlenmiş gün bir şey göndermez.
  // E-posta tek deneme, kuyruğun 55 sn'sini aşmadan
  const gunSonuTask = () => {
    const deadlineAt = tailStepDeadline(jobStart);
    return capped(
      catchUpLafposDayEnds(getDb(), new Date(), { attempts: 1, deadlineAt }).catch((e: Error) => ({ error: e.message })),
      deadlineAt - Date.now() + 500,
      { error: "süre doldu" },
    );
  };
  const extras = async () => {
    const [reminders, karaoke, menu, sales, photos, mcp, count, weekly, requests, gunSonu] = await Promise.all([
      pushReminderSummaries().catch((e: Error) => ({ error: e.message })),
      // Karaoke eşitlemesi ve KVKK: 3 × 366 günden eski oturumların adı ve notu silinir (docs/KARAOKE.md › KVKK)
      dailyKaraoke().catch((e: Error) => ({ status: "error" as const, error: e.message })),
      syncSiteMenu("cron").catch((e: Error) => ({ status: "error" as const, error: e.message })),
      syncSiteSales().catch((e: Error) => ({ status: "error" as const, error: e.message })),
      photosTask(),
      mcpTask(),
      countTask(),
      weeklyTask(),
      requestsTask(),
      gunSonuTask(),
    ]);
    const countResult = countStep(count);
    const weeklyResult = weeklyStep(weekly);
    const requestsResult = requestsStep(requests);
    const gunSonuResult = gunSonuStep(gunSonu);
    const steps: Record<Exclude<CoreStep, "sync" | "digest">, StepResult> & Partial<Record<OptionalStep, StepResult>> = {
      reminders: reminderStep(reminders),
      karaoke: siteStep(karaoke),
      menu: siteStep(menu),
      sales: siteStep(sales),
      photos: photosStep(photos),
      ...(countResult ? { count: countResult } : {}),
      ...(weeklyResult ? { weekly: weeklyResult } : {}),
      ...(requestsResult ? { requests: requestsResult } : {}),
      ...(gunSonuResult ? { gunSonu: gunSonuResult } : {}),
    };
    return { body: { reminders, karaoke: karaoke.status, menu: menu.status, sales: sales.status, photos, mcp, requests }, steps, weekly: weekly.status };
  };
  // Paraşüt bitince çoğunlukla bitmiştir; adım yalnız anahtar varken yazılır
  const modpos = await modposP;
  const modposResult = modposStep(modpos);
  const mpStep = modposResult ? { modpos: modposResult } : {};
  let outcome: JobOutcome = { status: "error", steps: {}, message: "İş yarıda kaldı" };
  try {
    // Sistem bölümü (bu sabahki Paraşüt işi) eşitlemenin bugün yapılıp yapılmadığını söyler
    const result = await runReminderDigest("cron", { syncedToday: alreadySynced || Boolean(sync?.ok), sendDeadlineAt: jobStart + JOB_SEND_DEADLINE_MS });
    const ex = await extras();
    outcome = dailyOutcome({ sync: syncStep, digest: digestStep(result), ...ex.steps, ...mpStep });
    return NextResponse.json({ ...result, sync, modpos: modpos.status, ...ex.body, weekly: ex.weekly }, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    const ex = await extras();
    outcome = dailyOutcome({ sync: syncStep, digest: { code: "error", error: (e as Error).message }, ...ex.steps, ...mpStep });
    return NextResponse.json({ status: "error", error: (e as Error).message, sync, modpos: modpos.status, ...ex.body, weekly: ex.weekly }, { status: 500 });
  } finally {
    await finishJobRun(runId, outcome);
  }
}

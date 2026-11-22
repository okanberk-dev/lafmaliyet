import "server-only";

import { createHash } from "node:crypto";

import { inArray } from "drizzle-orm";

import { emailProblems, jobHealth, systemAlerts, trClock, type EmailProblem, type JobHealth, type JobKey, type JobRunLite, type SystemAlert } from "@/lib/job-health";
import { droppedLogSuffix } from "@/lib/notify-recipients";
import { logActivity } from "@/server/actions/log";
import { readLastBackup } from "@/server/backup/state";
import { getDb, schema as s } from "@/server/db";
import { renderSystemAlert } from "@/server/notify/digest-template";
import { activeDigestEmails, sendableRecipients } from "@/server/notify/recipients";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { parasutConnection } from "@/server/parasut/client";
import { legacyEnvPresent } from "@/server/parasut/legacy";

import { lastParasutSyncErrorAt, loadJobRuns, parasutSyncedToday, readWatchSince } from "./runs";

/** Günlük işler yalnız canlıda (Vercel Cron) çalışır; önizlemede ve yerelde uyarı verilmez */
export function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production";
}

export interface JobsOverview {
  production: boolean;
  cronSecret: boolean;
  runs: JobRunLite[];
  health: Record<JobKey, JobHealth>;
  alerts: SystemAlert[];
}

/**
 * Ayarlar › Günlük işler ve /api/health?isler=1: son çalışmalar, iki işin durumu ve uyarılar (yalnız okur). Uyarılara
 * yedek hatırlatması da girer (Ayarlar › Yedek); son yedek okunamazsa yalnız o atlanır, iş uyarıları etkilenmez.
 */
export async function loadJobsOverview(now = new Date()): Promise<JobsOverview> {
  const [runs, watchSince, parasutSyncErrorAt, lastBackup] = await Promise.all([
    loadJobRuns(),
    readWatchSince(),
    lastParasutSyncErrorAt(),
    readLastBackup().catch((e) => {
      console.error("[sistem uyarıları] son yedek okunamadı", e);
      return undefined;
    }),
  ]);
  const production = isProductionRuntime();
  const cronSecret = Boolean(process.env.CRON_SECRET);
  const health = { parasut: jobHealth("parasut", runs, now, { watchSince }), gunluk: jobHealth("gunluk", runs, now, { watchSince }) };
  const lastBackupAt = lastBackup === undefined ? undefined : (lastBackup?.at ?? null);
  // Hesap yeni yöntemle bağlanınca geçiş uyarısı kalkar; eski değişkenler silinince "silebilirsiniz" notu da kalkar
  const legacyParasutAuth = legacyEnvPresent();
  const parasutConnected = legacyParasutAuth
    ? await parasutConnection(now.getTime())
        .then((c) => c.connected)
        .catch((e) => {
          console.error("[sistem uyarıları] Paraşüt bağlantı durumu okunamadı", e);
          return false;
        })
    : false;
  return {
    production,
    cronSecret,
    runs,
    health,
    alerts: systemAlerts({ production, cronSecret, now, health, parasutSyncErrorAt, lastBackupAt, legacyParasutAuth, parasutConnected }),
  };
}

/** Zil, Genel bakış ve (Bugün) için sistem uyarıları; canlı değilse sorgu yapmadan boş */
export async function loadSystemAlerts(now = new Date()): Promise<SystemAlert[]> {
  if (!isProductionRuntime()) return [];
  return (await loadJobsOverview(now)).alerts;
}

/**
 * E-postaya girecek sistem uyarıları: daha önce e-postayla gitmemiş olanlar (notification_log anahtarı). Sabah
 * e-postasında Paraşüt işinin metni bugün eşitleme yapılıp yapılmadığına göre değişir; verilmezse sorulur.
 */
export async function loadEmailProblems(mode: "digest" | "watchdog", opts: { now?: Date; syncedToday?: boolean } = {}): Promise<EmailProblem[]> {
  const now = opts.now ?? new Date();
  const [runs, watchSince, syncedToday] = await Promise.all([
    loadJobRuns(),
    readWatchSince(),
    mode === "digest" ? (opts.syncedToday ?? parasutSyncedToday()) : false,
  ]);
  const items = emailProblems({ now, mode, runs, watchSince, syncedToday });
  if (!items.length) return [];
  const sent = await getDb().select({ key: s.notificationLog.key }).from(s.notificationLog).where(inArray(s.notificationLog.key, items.map((i) => i.key)));
  const done = new Set(sent.map((r) => r.key));
  return items.filter((i) => !done.has(i.key));
}

/**
 * Bekçi: Paraşüt işi (07:00–08:00) dünkü sabah işinin çalışıp çalışmadığına bakar; çalışmadıysa ya da hata verdiyse
 * sabah e-postasının alıcılarına kısa bir uyarı gider. Sabah işi kendi bozulduğunu e-postayla söyleyemez. Yalnız
 * canlıda, e-posta açık ve yapılandırılmışsa, etkin alıcı varsa ve sorun daha önce bildirilmemişse.
 */
export async function sendWatchdogAlert(now = new Date()): Promise<"sent" | "none" | "error"> {
  if (!isProductionRuntime()) return "none";
  const settings = await loadNotifySettings();
  if (!settings.emailEnabled || !isEmailConfigured()) return "none";
  const db = getDb();
  // Personel hesabının ya da pasif hesabın adresi düşer (E-53; sabah e-postasıyla aynı alıcılar, aynı kural)
  const [items, recipients] = await Promise.all([loadEmailProblems("watchdog", { now }), activeDigestEmails(db).then((emails) => sendableRecipients(db, emails))]);
  const to = recipients.to;
  if (!items.length || !to.length) return "none";
  const today = trClock(now).day;
  const { subject, html, text } = renderSystemAlert(items, today);
  const keys = items.map((i) => i.key);
  const res = await sendEmail({
    from: resolveFrom(settings.from),
    to,
    subject,
    html,
    text,
    idempotencyKey: `system-${today}-${createHash("sha256").update(keys.join("|")).digest("hex").slice(0, 40)}`,
  });
  if (!res.ok) {
    await db
      .insert(s.notificationLog)
      .values({ key: `error:${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: false, error: res.error })
      .onConflictDoNothing();
    return "error";
  }
  await db
    .insert(s.notificationLog)
    .values(keys.map((key) => ({ key, subject, recipients: to.join(", "), ok: true })))
    .onConflictDoNothing();
  await logActivity(null, "Sistem uyarısı e-postası", `${subject} → ${to.length} adres${droppedLogSuffix(recipients.dropped)}`);
  return "sent";
}

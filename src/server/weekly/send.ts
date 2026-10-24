import "server-only";

import { and, desc, eq, gte, like } from "drizzle-orm";

import { businessDate, trHour } from "@/lib/cash-report";
import {
  CLAIM_RETRY,
  CLAIM_SENDING,
  CLAIM_UNCERTAIN,
  claimStateOf,
  isoWeekId,
  parseWeeklyHistory,
  parseWeeklySettings,
  pruneHistory,
  weekInfo,
  weeklyDecision,
  weeklyRetryText,
  WEEKLY_COLLECT_MS,
  WEEKLY_HISTORY_KEY,
  WEEKLY_HISTORY_WEEKS,
  WEEKLY_LAST_WEEKDAY,
  WEEKLY_LOG_PREFIX,
  WEEKLY_SAMPLE_PREFIX,
  WEEKLY_SEND_MS,
  WEEKLY_SETTINGS_KEY,
  type WeeklyHistory,
  type WeeklyRunResult,
  type WeeklySettings,
} from "@/lib/weekly/core";
import { addDays } from "@/lib/reminders";
import { weeklyStatusText } from "@/lib/weekly/text";
import { logActivity } from "@/server/actions/log";
import type { CurrentUser } from "@/server/auth/dal";
import { isPendingInvite } from "@/server/auth/tokens";
import { getDb, schema as s } from "@/server/db";
import { isProductionRuntime } from "@/server/jobs/alerts";
import { isEmailConfigured, resolveFrom, sendEmail, sendFailureText } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { renderWeekly } from "@/server/notify/weekly-template";

import { buildWeekly } from "./collect";

/*
 * Haftalık özetin gönderimi (docs/HAFTALIK-OZET.md): sabah işinin adımı (pazartesi; gidemezse salı ve çarşamba),
 * Ödemeler'deki satırın verisi ve yöneticinin kendine örnek göndermesi. Haftada en çok bir kez: gönderimden hemen önce
 * notification_log'a "haftalik:<hafta>" satırı yazılır (tekil anahtar, yarışı tek çalışma kazanır), başarılı gönderim
 * haftalik.gecmis'e de yazılır (db:reset bildirim günlüğünü siler, geçmişi silmez). Resend açıkça reddederse ertesi
 * uygun gün yeniden denenir; gönderim belirsizse (zaman aşımı, ağ, 409) asla.
 */

/** Hiçbir kaynak okunamadığında önizleme ve örneğin iletisi */
export const WEEKLY_ALL_FAILED_TEXT = "Özet hazırlanamadı: hiçbir bilgi okunamadı. Biraz sonra yeniden deneyin.";

/** Ayar; yoksa ya da bozuksa açık */
export async function loadWeeklySettings(): Promise<WeeklySettings> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, WEEKLY_SETTINGS_KEY)).limit(1);
  return parseWeeklySettings(row?.value);
}

export async function saveWeeklySettings(v: WeeklySettings): Promise<void> {
  await getDb()
    .insert(s.integrationState)
    .values({ key: WEEKLY_SETTINGS_KEY, value: v })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: v, updatedAt: new Date() } });
}

async function loadWeeklyHistory(): Promise<WeeklyHistory> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, WEEKLY_HISTORY_KEY)).limit(1);
  return parseWeeklyHistory(row?.value);
}

/**
 * Alıcılar: etkin yöneticilerin giriş e-postaları (daveti kabul edilmemiş hesap hariç). Bildirim adresleri (muhasebeci
 * olabilir) almaz: e-posta kâr ve kasa rakamları taşır, personel maliyet görmez (src/lib/roles.ts).
 */
export async function weeklyRecipients(): Promise<{ name: string; email: string }[]> {
  const rows = await getDb()
    .select({ name: s.users.name, email: s.users.email, passwordHash: s.users.passwordHash })
    .from(s.users)
    .where(and(eq(s.users.role, "admin"), eq(s.users.active, true)))
    .orderBy(s.users.id);
  return rows.filter((r) => !isPendingInvite(r.passwordHash)).map((r) => ({ name: r.name, email: r.email }));
}

type LogRow = { id: number; ok: boolean; error: string | null; sentAt: Date };

async function weekRow(weekId: string): Promise<LogRow | null> {
  const [row] = await getDb()
    .select({ id: s.notificationLog.id, ok: s.notificationLog.ok, error: s.notificationLog.error, sentAt: s.notificationLog.sentAt })
    .from(s.notificationLog)
    .where(eq(s.notificationLog.key, `${WEEKLY_LOG_PREFIX}${weekId}`))
    .limit(1);
  return row ?? null;
}

const asClaim = (r: LogRow | null) => (r ? { ok: r.ok, error: r.error, sentAt: r.sentAt.toISOString() } : null);
/** Kayda yazılan hata kısalır (sütun metin; ekranda tek satır) */
const cut = (v: string) => (v.length > 300 ? `${v.slice(0, 299)}…` : v);

/**
 * Sabah işinin `weekly` adımı (src/app/api/cron/gunluk/route.ts, kuyrukta öteki adımlarla aynı anda). `deadlineAt`:
 * jobStart + 52 sn. Yalnız canlıda, pazartesi–çarşamba; okuma en çok 4 sn, gönderim tek deneme, en çok 4 sn.
 * Veritabanı hatası fırlatılır: çağıran yakalar, adım "error" olur.
 */
export async function runWeeklyStep(now: Date, o: { deadlineAt: number }): Promise<WeeklyRunResult> {
  const week = weekInfo(businessDate(now));
  if (!isProductionRuntime() || week.weekday > WEEKLY_LAST_WEEKDAY) return { status: "skip", weekday: week.weekday };
  const [settings, history] = await Promise.all([loadWeeklySettings(), loadWeeklyHistory()]);
  const decision = weeklyDecision({
    now: Date.now(),
    deadlineAt: o.deadlineAt,
    production: true,
    week,
    enabled: settings.enabled,
    emailConfigured: isEmailConfigured(),
    weekSent: Boolean(history.weeks[week.id]),
  });
  if (!decision.run) return decision.result;
  const row = await weekRow(week.id);
  const state = claimStateOf(asClaim(row), Date.now());
  if (state === "sent" || state === "busy" || state === "unknown") return { status: "skip", weekday: week.weekday };

  const { summary, allFailed } = await buildWeekly(now, { budgetMs: Math.min(WEEKLY_COLLECT_MS, o.deadlineAt - Date.now() - WEEKLY_SEND_MS - 500) });
  if (allFailed) return { status: "error", weekday: week.weekday, error: `hiçbir bilgi okunamadı; ${weeklyRetryText(week.weekday)}` };
  const [recipients, notify] = await Promise.all([weeklyRecipients(), loadNotifySettings()]);
  if (!recipients.length) return { status: "norecipient", weekday: week.weekday };
  // Gönderime yetecek süre kalmadıysa yazmadan bırakılır: yarın yeniden (yarıda kesilen gönderim belirsiz kalırdı)
  if (o.deadlineAt - Date.now() < 1_500) return { status: "late", weekday: week.weekday };
  const { subject, html, text } = renderWeekly(summary, { today: week.day });
  const to = recipients.map((r) => r.email);

  // Haftanın kaydı: ilk deneme ekler, açıkça reddedilmiş denemeyi yeniden dener; satır dönmezse başka çalışma kazandı
  const db = getDb();
  const key = `${WEEKLY_LOG_PREFIX}${week.id}`;
  const claimed =
    state === "free"
      ? await db
          .insert(s.notificationLog)
          .values({ key, subject, recipients: to.join(", "), ok: false, error: CLAIM_SENDING })
          .onConflictDoNothing()
          .returning({ id: s.notificationLog.id })
      : await db
          .update(s.notificationLog)
          .set({ subject, recipients: to.join(", "), error: CLAIM_SENDING, sentAt: new Date() })
          .where(and(eq(s.notificationLog.key, key), eq(s.notificationLog.ok, false), like(s.notificationLog.error, `${CLAIM_RETRY}%`)))
          .returning({ id: s.notificationLog.id });
  const id = claimed[0]?.id;
  if (id === undefined) return { status: "skip", weekday: week.weekday };

  // Resend'in tekil anahtarı 24 saat yaşar ve aynı anahtarla farklı içerik 409 alır; ertesi günün denemesi pencerenin
  // erken ucunda 24 saatten önce gelebilir (e-postanın tarihi de değişir): anahtar günü de taşır. Haftada tek gönderimi
  // yukarıdaki kayıt sağlar.
  const res = await sendEmail(
    { from: resolveFrom(notify.from), to, subject, html, text, idempotencyKey: `haftalik-${week.id}-${week.weekday}` },
    { timeoutMs: Math.max(1, Math.min(WEEKLY_SEND_MS, o.deadlineAt - Date.now() - 300)), attempts: 1, deadlineAt: o.deadlineAt - 300 },
  );
  if (!res.ok) {
    const msg = sendFailureText(res);
    if (res.uncertain) console.error("[haftalik] gönderim belirsiz:", res.error);
    await db
      .update(s.notificationLog)
      .set({ error: cut(`${res.uncertain ? CLAIM_UNCERTAIN : CLAIM_RETRY} ${msg}`), sentAt: new Date() })
      .where(eq(s.notificationLog.id, id))
      .catch((e) => console.error("[haftalik] kayıt", e));
    return { status: res.uncertain ? "uncertain" : "retry", weekday: week.weekday, error: msg };
  }
  // Gönderildi. Kayıt yazılamazsa satır "Gönderiliyor" kalır: ertesi gün "belirsiz" sayılır, yeniden gönderilmez
  try {
    await db.update(s.notificationLog).set({ ok: true, error: null, sentAt: new Date() }).where(eq(s.notificationLog.id, id));
    const fresh = await loadWeeklyHistory();
    fresh.weeks[week.id] = { at: new Date().toISOString(), subject, keys: summary.items.map((i) => i.key) };
    const value = pruneHistory(fresh, isoWeekId(addDays(week.monday, -7 * (WEEKLY_HISTORY_WEEKS - 1))));
    await db
      .insert(s.integrationState)
      .values({ key: WEEKLY_HISTORY_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
  } catch (e) {
    console.error("[haftalik] gönderildi, kayıt yazılamadı", e);
  }
  await logActivity(null, "Haftalık özet (otomatik)", `${subject} → ${to.length} adres`);
  return { status: "sent", weekday: week.weekday, items: summary.items.length };
}

/**
 * "Örneği bana gönder": bu haftanın özeti, yalnız tıklayan yöneticinin adresine, "Örnek · " konusuyla. Haftanın kaydına
 * ve geçmişe dokunmaz (asıl özeti engellemez); notification_log'a kendi satırı ("Son gönderimler"de görünür).
 */
export async function sendWeeklySampleTo(me: CurrentUser, now: Date): Promise<{ ok: true; to: string; items: number } | { ok: false; error: string }> {
  const { summary, allFailed } = await buildWeekly(now, { budgetMs: 6_000 });
  if (allFailed) return { ok: false, error: WEEKLY_ALL_FAILED_TEXT };
  const notify = await loadNotifySettings();
  const { subject, html, text } = renderWeekly(summary, { today: summary.week.day, sample: true });
  const ms = Date.now();
  const res = await sendEmail({ from: resolveFrom(notify.from), to: [me.email], subject, html, text, idempotencyKey: `haftalik-ornek-${ms}` }, { timeoutMs: 10_000, attempts: 1 });
  const error = res.ok ? null : sendFailureText(res);
  await getDb()
    .insert(s.notificationLog)
    .values({ key: `${WEEKLY_SAMPLE_PREFIX}${ms}`, subject, recipients: me.email, ok: res.ok, error: error ? cut(error) : null })
    .onConflictDoNothing()
    .catch((e) => console.error("[haftalik] örnek kaydı", e));
  return res.ok ? { ok: true, to: me.email, items: summary.items.length } : { ok: false, error: error! };
}

/** Ödemeler › E-posta bildirimleri › Haftalık özet satırı: açık mı, kime gider, bu haftanın durumu */
export async function loadWeeklyPanel(now: Date): Promise<{ enabled: boolean; recipients: string[]; status: string }> {
  const week = weekInfo(businessDate(now));
  const db = getDb();
  const [settings, recipients, row, [lastOk], history, runs] = await Promise.all([
    loadWeeklySettings(),
    weeklyRecipients(),
    weekRow(week.id),
    db
      .select({ sentAt: s.notificationLog.sentAt })
      .from(s.notificationLog)
      .where(and(like(s.notificationLog.key, `${WEEKLY_LOG_PREFIX}%`), eq(s.notificationLog.ok, true)))
      .orderBy(desc(s.notificationLog.sentAt))
      .limit(1),
    loadWeeklyHistory(),
    // Bu haftanın sabah işleri (iş günü pazartesi 05:00'te başlar; İstanbul sabit UTC+3): kayıt yazmadan biten haftalık
    // adım (süre yetmedi, Resend yok, hiçbir bilgi okunamadı) yalnız burada görünür
    db
      .select({ startedAt: s.jobRuns.startedAt, steps: s.jobRuns.steps })
      .from(s.jobRuns)
      .where(and(eq(s.jobRuns.job, "gunluk"), gte(s.jobRuns.startedAt, new Date(`${week.monday}T05:00:00+03:00`))))
      .orderBy(desc(s.jobRuns.startedAt))
      .limit(10),
  ]);
  const run = runs.find((r) => r.steps?.weekly);
  const status = weeklyStatusText({
    enabled: settings.enabled,
    week,
    row: asClaim(row),
    rowDay: row ? businessDate(row.sentAt) : null,
    weekSentAt: history.weeks[week.id]?.at ?? null,
    lastStep: run ? { day: businessDate(run.startedAt), code: run.steps!.weekly } : null,
    lastSentAt: lastOk?.sentAt.toISOString() ?? Object.values(history.weeks).map((w) => w.at).sort().at(-1) ?? null,
    now: now.getTime(),
    hourTR: trHour(now),
  });
  return { enabled: settings.enabled, recipients: recipients.map((r) => r.name), status };
}

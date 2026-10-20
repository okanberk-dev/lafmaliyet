import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { dueNotifications, laterInvoiceItems, todayTR, upcomingItems, type UpcomingItem } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { getDb, schema as s } from "@/server/db";

import { renderDigest } from "./digest-template";
import { isEmailConfigured, resolveFrom, sendEmail } from "./resend";
import { loadNotifySettings } from "./settings";

export { APP_URL, renderDigest } from "./digest-template";

/** Etkin hatırlatıcılar + ödenmemiş faturalardan yaklaşan ödemeler */
export async function loadUpcoming(today = todayTR()) {
  const db = getDb();
  const [settings, reminders, invoices] = await Promise.all([
    loadNotifySettings(),
    db.select().from(s.reminders).orderBy(asc(s.reminders.dueDate)),
    db
      .select({
        id: s.invoices.id,
        supplier: s.invoices.supplier,
        invoiceNo: s.invoices.invoiceNo,
        date: s.invoices.date,
        dueDate: s.invoices.dueDate,
        payable: s.invoices.payable,
        outstanding: s.invoices.outstanding,
      })
      .from(s.invoices)
      .where(eq(s.invoices.unpaid, true)),
  ]);
  const opts = { invoiceDaysBefore: settings.invoiceDaysBefore, invoiceTermDays: settings.invoiceTermDays };
  const items = upcomingItems(reminders, invoices, today, opts);
  // Takvim için: vadesi listenin ufkundan sonra olan faturalar (listede ve e-postada yer almaz)
  const laterInvoices: UpcomingItem[] = laterInvoiceItems(invoices, today, opts);
  return { today, settings, reminders, items, laterInvoices };
}

export type DigestResult =
  | { status: "sent"; count: number; recipients: number }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

/** Günlük hatırlatma e-postası: bugün haber verilmesi gereken ve daha önce gitmemiş her şey tek iletide */
export async function runReminderDigest(trigger: "cron" | "manual"): Promise<DigestResult> {
  const db = getDb();
  const { today, settings, items } = await loadUpcoming();
  if (!settings.emailEnabled) return { status: "skipped", reason: "Hatırlatma e-postaları kapalı." };
  if (!isEmailConfigured()) return { status: "skipped", reason: "RESEND_API_KEY tanımlı değil." };

  const due = dueNotifications(items);
  if (!due.length) return { status: "skipped", reason: "Bugün haber verilecek bir ödeme yok." };
  const sent = await db.select({ key: s.notificationLog.key }).from(s.notificationLog).where(inArray(s.notificationLog.key, due.map((d) => d.key)));
  const sentKeys = new Set(sent.map((r) => r.key));
  const fresh = due.filter((d) => !sentKeys.has(d.key));
  if (!fresh.length) return { status: "skipped", reason: "Bugünkü hatırlatmalar zaten gönderildi." };

  const recipients = await db.select().from(s.notificationRecipients).where(eq(s.notificationRecipients.active, true));
  if (!recipients.length) return { status: "skipped", reason: "Etkin bildirim adresi yok." };

  const { subject, html, text } = renderDigest(fresh, today);
  const to = recipients.map((r) => r.email);
  const res = await sendEmail({ from: resolveFrom(settings.from), to, subject, html, text, idempotencyKey: `digest-${today}-${createHash("sha256").update(fresh.map((f) => f.key).join("|")).digest("hex").slice(0, 40)}` });
  if (!res.ok) {
    await db
      .insert(s.notificationLog)
      .values({ key: `error:${today}:${Date.now()}`, subject, recipients: to.join(", "), ok: false, error: res.error })
      .onConflictDoNothing();
    return { status: "error", error: res.error };
  }
  await db
    .insert(s.notificationLog)
    .values(fresh.map((f) => ({ key: f.key, subject, recipients: to.join(", "), ok: true })))
    .onConflictDoNothing();
  await logActivity(null, trigger === "cron" ? "Hatırlatma e-postası (otomatik)" : "Hatırlatma e-postası", `${subject} → ${to.length} adres`);
  return { status: "sent", count: fresh.length, recipients: to.length };
}

/** Son gönderimler (ekrandaki günlük) */
export async function recentNotifications(limit = 12) {
  return getDb().select().from(s.notificationLog).orderBy(desc(s.notificationLog.sentAt)).limit(limit);
}

/** Deneme e-postası: kayıtlı gönderenle, etkin adreslere */
export async function sendTestEmail(): Promise<{ ok: true; recipients: number } | { ok: false; error: string }> {
  const db = getDb();
  const settings = await loadNotifySettings();
  const recipients = await db.select().from(s.notificationRecipients).where(and(eq(s.notificationRecipients.active, true)));
  if (!recipients.length) return { ok: false, error: "Önce bir bildirim adresi ekleyin." };
  const today = todayTR();
  const sample: UpcomingItem = {
    ref: "test:0",
    source: "reminder",
    sourceId: 0,
    kind: "odeme",
    title: "Deneme hatırlatması",
    detail: "Bu ileti bildirim ayarlarını sınamak için gönderildi",
    amount: 1234,
    dueDate: today,
    daysLeft: 0,
    status: "today",
    remindDaysBefore: 0,
    repeat: "none",
  };
  const { html, text } = renderDigest([{ item: sample, stage: "due" }], today);
  const res = await sendEmail({ from: resolveFrom(settings.from), to: recipients.map((r) => r.email), subject: "L'Affogato · deneme bildirimi", html, text });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, recipients: recipients.length };
}

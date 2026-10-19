import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { dateTR, tl } from "@/lib/format";
import { daysLeftLabel, dueNotifications, todayTR, upcomingItems, type NotifyStage, type UpcomingItem } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { getDb, schema as s } from "@/server/db";

import { isEmailConfigured, resolveFrom, sendEmail } from "./resend";
import { loadNotifySettings } from "./settings";

export const APP_URL = (process.env.APP_URL?.trim() || "https://ladmin.laffogato.net").replace(/\/+$/, "");

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
  const items = upcomingItems(reminders, invoices, today, {
    invoiceDaysBefore: settings.invoiceDaysBefore,
    invoiceTermDays: settings.invoiceTermDays,
  });
  return { today, settings, reminders, items };
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAGE: Record<NotifyStage, { label: string; bg: string; fg: string }> = {
  overdue: { label: "Gecikti", bg: "#fef2f2", fg: "#dc2626" },
  due: { label: "Bugün", bg: "#fff7ed", fg: "#c2410c" },
  before: { label: "Yaklaşıyor", bg: "#f4f4f5", fg: "#3f3f46" },
};

/** AkmanOS açık temasında, satır içi stilli basit e-posta */
export function renderDigest(rows: { item: UpcomingItem; stage: NotifyStage }[], today: string) {
  const counts = { overdue: 0, due: 0, before: 0 };
  for (const r of rows) counts[r.stage]++;
  const parts = [counts.overdue ? `${counts.overdue} gecikmiş` : null, counts.due ? `${counts.due} bugün` : null, counts.before ? `${counts.before} yaklaşan` : null].filter(Boolean);
  const subject = `Ödeme hatırlatması: ${parts.join(", ")}`;
  const total = rows.reduce((a, r) => a + (r.item.amount ?? 0), 0);
  const link = `${APP_URL}/panel/hatirlaticilar`;

  const tr = rows
    .map(({ item, stage }) => {
      const st = STAGE[stage];
      return `<tr>
  <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;vertical-align:top">
    <div style="font-size:15px;font-weight:600;color:#171717">${esc(item.title)}</div>
    <div style="font-size:13px;color:#71717a;margin-top:2px">${esc(dateTR(item.dueDate))} · ${esc(daysLeftLabel(item.daysLeft))}${item.detail ? ` · ${esc(item.detail)}` : ""}</div>
  </td>
  <td style="padding:12px 0 12px 12px;border-bottom:1px solid #e4e4e7;text-align:right;vertical-align:top;white-space:nowrap">
    <div style="font-size:15px;font-weight:600;color:#171717">${item.amount !== null ? esc(tl(item.amount)) : "–"}</div>
    <span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${st.bg};color:${st.fg}">${st.label}</span>
  </td>
</tr>`;
    })
    .join("\n");

  const html = `<!doctype html><html lang="tr"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#ffffff;border-radius:24px;padding:24px">
    <div style="font-size:13px;color:#71717a">L'Affogato · ${esc(dateTR(today))}</div>
    <h1 style="margin:6px 0 4px;font-size:20px;letter-spacing:-0.01em;color:#171717">${esc(subject)}</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#71717a">Toplam ${esc(tl(total))}. Ödediklerinizi panelde "Ödendi" olarak işaretleyin.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${tr}</table>
    <a href="${link}" style="display:inline-block;margin-top:20px;background:#171717;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 18px;border-radius:12px">Hatırlatıcıları aç</a>
  </div>
  <p style="font-size:12px;color:#a1a1aa;text-align:center;margin-top:16px">Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler &amp; hatırlatıcılar sayfasından değiştirebilirsiniz.</p>
</div></body></html>`;

  const text = [
    `L'Affogato · ${dateTR(today)}`,
    subject,
    `Toplam ${tl(total)}`,
    "",
    ...rows.map(({ item, stage }) => `- ${item.title} · ${dateTR(item.dueDate)} (${daysLeftLabel(item.daysLeft)}) · ${item.amount !== null ? tl(item.amount) : "–"} · ${STAGE[stage].label}`),
    "",
    link,
  ].join("\n");

  return { subject, html, text };
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

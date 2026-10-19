"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { dateTR, tl } from "@/lib/format";
import { advancePast, nextOccurrence, presetAnchor, presetFirstDate, REMINDER_PRESETS, todayTR, type ReminderRepeat } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { runReminderDigest, sendTestEmail } from "@/server/notify/digest";
import { saveNotifySettings, type NotifySettings } from "@/server/notify/settings";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText, zText } from "./util";

const zId = z.number().int().positive();

const reminderSchema = z.object({
  id: z.number().int().positive().nullable(),
  title: zText("Başlık", 120),
  kind: z.enum(["odeme", "vergi", "kira", "maas", "fatura", "diger"]),
  amount: z.number().finite().min(0).nullable(),
  dueDate: zDate,
  repeat: z.enum(["none", "weekly", "monthly", "quarterly", "yearly"]),
  remindDaysBefore: z.number().int().min(0, "Gün negatif olamaz").max(60, "En fazla 60 gün"),
  note: zOptText(500),
  active: z.boolean(),
});

export async function saveReminder(input: z.input<typeof reminderSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = reminderSchema.parse(input);
    const db = getDb();
    if (id) {
      const [prev] = await db.select().from(s.reminders).where(eq(s.reminders.id, id)).limit(1);
      if (!prev) throw new UserError("Hatırlatıcı bulunamadı");
      // Tarih elle değişirse tekrarların günü de yeni tarihe bağlanır
      const anchorDate = prev.dueDate !== data.dueDate ? data.dueDate : prev.anchorDate;
      await db.update(s.reminders).set({ ...data, anchorDate }).where(eq(s.reminders.id, id));
    } else {
      await db.insert(s.reminders).values({ ...data, anchorDate: data.dueDate });
    }
    await logActivity(me, id ? "Hatırlatıcı düzenlendi" : "Hatırlatıcı eklendi", `${data.title} · ${dateTR(data.dueDate)}`);
    refresh();
    return null;
  });
}

export async function deleteReminder(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.reminders).where(eq(s.reminders.id, zId.parse(id))).returning();
    if (d) await logActivity(me, "Hatırlatıcı silindi", d.title);
    refresh();
    return null;
  });
}

export async function setReminderActive(id: number, active: boolean) {
  return attempt(async () => {
    await requireAdmin();
    const rid = zId.parse(id);
    const on = z.boolean().parse(active);
    const db = getDb();
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    // Yeniden açılan tekrarlı hatırlatıcı geçmişte kalmasın: bugünden sonraki ilk döneme alınır
    const today = todayTR();
    const dueDate = on && r.repeat !== "none" && r.dueDate < today ? (advancePast(r.dueDate, r.repeat as ReminderRepeat, r.anchorDate, addDaysBack(today)) ?? r.dueDate) : r.dueDate;
    await db.update(s.reminders).set({ active: on, dueDate }).where(eq(s.reminders.id, rid));
    refresh();
    return null;
  });
}

/** advancePast "geçene kadar" ilerletir; bugünün kendisi de geçerli bir tarih olsun diye bir gün öncesi verilir */
function addDaysBack(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ödendi: tekrar edenler bir sonraki döneme ilerler, tek seferlikler kapanır. `through` verilirse (gecikmiş
 * dönemden sonraki öngörülen dönem ödendiğinde) o tarihe kadarki bütün dönemler kapanır.
 */
export async function markReminderDone(id: number, through?: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const rid = zId.parse(id);
    const until = through === undefined ? null : zDate.parse(through);
    const db = getDb();
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    const repeat = r.repeat as ReminderRepeat;
    const next = until && until >= r.dueDate ? advancePast(r.dueDate, repeat, r.anchorDate, until) : nextOccurrence(r.dueDate, repeat, r.anchorDate);
    await db
      .update(s.reminders)
      .set(next ? { dueDate: next, lastDoneAt: new Date() } : { active: false, lastDoneAt: new Date() })
      .where(eq(s.reminders.id, rid));
    await logActivity(me, "Ödeme yapıldı", `${r.title} · ${dateTR(r.dueDate)}${r.amount ? ` · ${tl(r.amount)}` : ""}${next ? ` → sıradaki ${dateTR(next)}` : ""}`);
    refresh();
    return { next };
  });
}

/** Ödenmemiş faturanın vadesi (Faturalar ve hatırlatıcılar ekranından) */
export async function setInvoiceDueDate(id: number, dueDate: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const parsed = dueDate === null ? null : zDate.parse(dueDate);
    const [d] = await getDb().update(s.invoices).set({ dueDate: parsed }).where(eq(s.invoices.id, zId.parse(id))).returning();
    if (d) await logActivity(me, "Fatura vadesi", `${d.supplier} · ${parsed ? dateTR(parsed) : "vade kaldırıldı"}`);
    refresh();
    return null;
  });
}

/** Hazır şablondan (KDV, muhtasar, SGK, geçici vergi, maaş) hatırlatıcı */
export async function addPresetReminder(key: string, amount: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const p = REMINDER_PRESETS.find((x) => x.key === z.string().max(40).parse(key));
    if (!p) throw new UserError("Şablon bulunamadı");
    const amt = z.number().finite().min(0).max(1e10).nullable().parse(amount);
    const dueDate = presetFirstDate(p, todayTR());
    await getDb()
      .insert(s.reminders)
      .values({ title: p.title, kind: p.kind, amount: amt && amt > 0 ? amt : null, dueDate, anchorDate: presetAnchor(p, dueDate), repeat: p.repeat, remindDaysBefore: p.remindDaysBefore, note: p.note });
    await logActivity(me, "Hatırlatıcı eklendi", `${p.title} · ${dateTR(dueDate)}`);
    refresh();
    return { dueDate };
  });
}

/** Sabit giderden hatırlatıcı (kira, aidat, internet …): ilk ödeme tarihi verilir, gider döneminde tekrar eder */
export async function addFixedExpenseReminder(fixedExpenseId: number, firstDate: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const dueDate = zDate.parse(firstDate);
    const db = getDb();
    const [f] = await db.select().from(s.fixedExpenses).where(eq(s.fixedExpenses.id, zId.parse(fixedExpenseId))).limit(1);
    if (!f) throw new UserError("Sabit gider bulunamadı");
    if (f.period === "gunluk") throw new UserError("Günlük giderler için hatırlatıcı oluşturulmaz");
    const repeat = f.period === "yillik" ? "yearly" : f.period === "haftalik" ? "weekly" : "monthly";
    const kind = f.section === "kira" ? "kira" : f.section === "personel" ? "maas" : "odeme";
    await db.insert(s.reminders).values({
      title: f.name,
      kind,
      amount: f.amount > 0 ? f.amount : null,
      dueDate,
      anchorDate: dueDate,
      repeat,
      remindDaysBefore: 3,
      note: "Sabit giderlerden",
    });
    await logActivity(me, "Hatırlatıcı eklendi", `${f.name} · ${dateTR(dueDate)}`);
    refresh();
    return { dueDate };
  });
}

// ---------------------------------------------------------------- Bildirim adresleri ve ayarlar
const emailSchema = z.string().trim().toLowerCase().email("Geçerli bir e-posta girin");

export async function addRecipient(email: string, name: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const e = emailSchema.parse(email);
    const n = zOptText(80).parse(name);
    await getDb()
      .insert(s.notificationRecipients)
      .values({ email: e, name: n });
    await logActivity(me, "Bildirim adresi eklendi", e);
    refresh();
    return null;
  });
}

export async function setRecipientActive(id: number, active: boolean) {
  return attempt(async () => {
    await requireAdmin();
    await getDb()
      .update(s.notificationRecipients)
      .set({ active: z.boolean().parse(active) })
      .where(eq(s.notificationRecipients.id, zId.parse(id)));
    refresh();
    return null;
  });
}

export async function deleteRecipient(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.notificationRecipients).where(eq(s.notificationRecipients.id, zId.parse(id))).returning();
    if (d) await logActivity(me, "Bildirim adresi silindi", d.email);
    refresh();
    return null;
  });
}

const notifySchema = z.object({
  emailEnabled: z.boolean(),
  from: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^(?:[^<>]+<\s*)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>?$/.test(v), "Gönderen biçimi: Ad <ad@laffogato.net>"),
  invoiceDaysBefore: z.number().int().min(0).max(30),
  invoiceTermDays: z.number().int().min(0).max(120),
});

export async function saveNotificationSettings(input: z.input<typeof notifySchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const value: NotifySettings = notifySchema.parse(input);
    await saveNotifySettings(value);
    await logActivity(me, "Bildirim ayarları", value.emailEnabled ? `açık · ${value.from ?? "varsayılan gönderen"}` : "kapalı");
    refresh();
    return null;
  });
}

export async function sendTestNotification() {
  return attempt(async () => {
    await requireAdmin();
    const r = await sendTestEmail();
    if (!r.ok) throw new UserError(r.error);
    return { recipients: r.recipients };
  });
}

/** Bugünün hatırlatma e-postasını şimdi gönder (otomatik gönderimi beklemeden) */
export async function runDigestNow() {
  return attempt(async () => {
    await requireAdmin();
    const r = await runReminderDigest("manual");
    if (r.status === "error") throw new UserError(r.error);
    refresh();
    return r;
  });
}

"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { dateTR, tl } from "@/lib/format";
import {
  addDays,
  advancePast,
  dueNotifications,
  endOfMonthAnchor,
  isLastDayOfMonth,
  nextOccurrence,
  postponeDate,
  postponePlan,
  todayTR,
  type ReminderRepeat,
  type UpcomingItem,
} from "@/lib/reminders";
import { reminderUnchanged } from "@/lib/recent-paid";
import { requireAdmin } from "@/server/auth/dal";
import { forgetChangedReminder, forgetPaid, loadRecentPaid, rememberPaid } from "@/server/data/recent-paid";
import { getDb, schema as s } from "@/server/db";
import { loadDigestInvoices, loadDigestPrices, loadUpcoming, renderDigest, runReminderDigest, sendTestEmail } from "@/server/notify/digest";
import { loadNotifySettings, saveNotifySettings, type NotifySettings } from "@/server/notify/settings";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText, zText } from "./util";

const zId = z.number().int().positive();

const reminderSchema = z.object({
  id: z.number().int().positive().nullable(),
  title: zText("Başlık", 120),
  kind: z.enum(["odeme", "vergi", "kira", "maas", "fatura", "diger"]),
  amount: z.number({ message: "Tutar sayı olmalı" }).finite("Tutar sayı olmalı").min(0, "Tutar negatif olamaz").nullable(),
  dueDate: zDate,
  repeat: z.enum(["none", "weekly", "monthly", "quarterly", "yearly"]),
  remindDaysBefore: z.number().int().min(0, "Gün negatif olamaz").max(60, "En fazla 60 gün"),
  note: zOptText(500),
  active: z.boolean(),
  /** Ayın son günü seçiliyse tekrarlar her ayın son gününe kayar (SGK gibi); verilmezse eski davranış */
  endOfMonth: z.boolean().optional(),
});

export async function saveReminder(input: z.input<typeof reminderSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, endOfMonth, ...data } = reminderSchema.parse(input);
    const db = getDb();
    const eom = Boolean(endOfMonth) && isLastDayOfMonth(data.dueDate) && (data.repeat === "monthly" || data.repeat === "quarterly");
    const fresh = eom ? endOfMonthAnchor(data.dueDate) : data.dueDate;
    if (id) {
      const [prev] = await db.select().from(s.reminders).where(eq(s.reminders.id, id)).limit(1);
      if (!prev) throw new UserError("Hatırlatıcı bulunamadı");
      // Tarih elle değişirse tekrarların günü de yeni tarihe bağlanır
      let anchorDate = prev.dueDate !== data.dueDate ? fresh : prev.anchorDate;
      // Aynı tarihte "ayın son günü" açıldı ya da kapandı
      if (prev.dueDate === data.dueDate && endOfMonth !== undefined) {
        const wasEom = Number(prev.anchorDate.slice(8, 10)) >= 31;
        if (eom && !wasEom) anchorDate = fresh;
        if (!endOfMonth && wasEom) anchorDate = data.dueDate;
      }
      await db.update(s.reminders).set({ ...data, anchorDate }).where(eq(s.reminders.id, id));
    } else {
      await db.insert(s.reminders).values({ ...data, anchorDate: fresh });
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
    if (d) {
      await forgetPaid("reminder", [d.id]);
      await logActivity(me, "Hatırlatıcı silindi", d.title);
    }
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
    await rememberPaid([{ kind: "reminder", id: rid, title: r.title, amount: r.amount, dueDate: r.dueDate, prev: snapshot(r), next }]);
    await logActivity(me, "Ödeme yapıldı", `${r.title} · ${dateTR(r.dueDate)}${r.amount ? ` · ${tl(r.amount)}` : ""}${next ? ` → sıradaki ${dateTR(next)}` : ""}`);
    refresh();
    // prev: "Geri al" düğmesi kaydı bu hâline döndürür (restoreReminder)
    return { next, prev: snapshot(r) };
  });
}

type ReminderDbRow = typeof s.reminders.$inferSelect;

function snapshot(r: ReminderDbRow) {
  return { dueDate: r.dueDate, anchorDate: r.anchorDate, active: r.active, lastDoneAt: r.lastDoneAt ? r.lastDoneAt.toISOString() : null };
}

const snapshotSchema = z.object({
  dueDate: zDate,
  anchorDate: zDate,
  active: z.boolean(),
  lastDoneAt: z
    .string()
    .max(40)
    .nullable()
    .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), "Geçersiz tarih"),
});

/**
 * Geri al: "Ödendi" ya da "Ertele"den önceki hâl geri yazılır. Ertelemede tekrar eden hatırlatıcı için açılan tek
 * seferlik kayıt (removeId) silinir.
 */
export async function restoreReminder(id: number, prev: z.input<typeof snapshotSchema>, removeId?: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const rid = zId.parse(id);
    const snap = snapshotSchema.parse(prev);
    const extra = removeId === undefined || removeId === null ? null : zId.parse(removeId);
    if (extra === rid) throw new UserError("Geçersiz geri alma");
    const db = getDb();
    const title = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(s.reminders)
        .set({ dueDate: snap.dueDate, anchorDate: snap.anchorDate, active: snap.active, lastDoneAt: snap.lastDoneAt ? new Date(snap.lastDoneAt) : null })
        .where(eq(s.reminders.id, rid))
        .returning({ title: s.reminders.title });
      if (!r) throw new UserError("Hatırlatıcı bulunamadı");
      if (extra) await tx.delete(s.reminders).where(eq(s.reminders.id, extra));
      return r.title;
    });
    // "Ödendi"nin geri alınması Son ödenenler kaydını siler; ödemeden sonraki "Ertele"nin geri alınması ise
    // hatırlatıcıyı ödendikten sonraki hâline döndürür, o kayıt geri alınabilir kalır
    await forgetChangedReminder({ id: rid, dueDate: snap.dueDate, anchorDate: snap.anchorDate, active: snap.active });
    await logActivity(me, "Hatırlatıcı geri alındı", `${title} · ${dateTR(snap.dueDate)}`);
    refresh();
    return null;
  });
}

/**
 * Ödemeler › Son ödenenler: 30 gün içinde "Ödendi" işaretlenen faturayı ödenmemişe, hatırlatıcıyı ödenmeden önceki
 * tarihine döndürür. Hatırlatıcı o zamandan beri değiştiyse (yeniden ödendi, ertelendi, düzenlendi) eski hâl yazılmaz.
 */
export async function undoRecentPaid(kind: "invoice" | "reminder", id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const k = z.enum(["invoice", "reminder"]).parse(kind);
    const rid = zId.parse(id);
    const entry = (await loadRecentPaid()).find((e) => e.kind === k && e.id === rid);
    // Hata dönen durumlarda da liste yenilenir: geri alınamayan satır ekranda kalmasın (liveRecentPaid gizler)
    if (!entry) {
      refresh();
      throw new UserError("Bu ödeme artık listede yok (geri alınmış ya da 30 günü geçmiş olabilir)");
    }
    const db = getDb();
    if (k === "invoice") {
      const [row] = await db.update(s.invoices).set({ unpaid: true }).where(eq(s.invoices.id, rid)).returning({ supplier: s.invoices.supplier, payable: s.invoices.payable });
      await forgetPaid("invoice", [rid]);
      if (!row) {
        refresh();
        throw new UserError("Fatura bulunamadı (silinmiş olabilir)");
      }
      await logActivity(me, "Fatura ödenmedi işaretlendi", `${row.supplier} ${tl(row.payable, 2)} · son ödenenlerden geri alındı`);
    } else {
      const [cur] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
      if (!cur) {
        await forgetPaid("reminder", [rid]);
        refresh();
        throw new UserError("Hatırlatıcı bulunamadı (silinmiş olabilir)");
      }
      const prev = entry.prev;
      if (!prev || !reminderUnchanged(entry, cur)) {
        refresh();
        throw new UserError("Hatırlatıcı ödendikten sonra değişti (yeniden ödendi, ertelendi ya da düzenlendi); tarihini düzenleyerek düzeltin");
      }
      // Yalnız okunan hâl hâlâ duruyorsa yazılır (okuma ile yazma arasında başka sekmeden ödenmiş / ertelenmiş olabilir)
      const [done] = await db
        .update(s.reminders)
        .set({ dueDate: prev.dueDate, anchorDate: prev.anchorDate, active: prev.active, lastDoneAt: prev.lastDoneAt ? new Date(prev.lastDoneAt) : null })
        .where(and(eq(s.reminders.id, rid), eq(s.reminders.dueDate, cur.dueDate), eq(s.reminders.anchorDate, cur.anchorDate), eq(s.reminders.active, cur.active)))
        .returning({ id: s.reminders.id });
      if (!done) {
        refresh();
        throw new UserError("Hatırlatıcı bu arada değişti; sayfa yenilendi, yeniden deneyin");
      }
      await forgetPaid("reminder", [rid]);
      await logActivity(me, "Hatırlatıcı geri alındı", `${cur.title} · ${dateTR(prev.dueDate)} · son ödenenlerden`);
    }
    refresh();
    return null;
  });
}

const zPostpone = z.enum(["week", "month"]);

/**
 * Ertele (+1 hafta / +1 ay). Tek seferlik hatırlatıcının tarihi kayar. Tekrar edende seri bozulmasın diye bu dönem
 * ertelenen tarihte tek seferlik bir hatırlatıcıya taşınır, seri sıradaki döneme geçer (Kira 1 Kas → 8 Kas tek
 * sefer; aylık kira 1 Ara'dan devam eder).
 */
export async function postponeReminder(id: number, by: "week" | "month") {
  return attempt(async () => {
    const me = await requireAdmin();
    const rid = zId.parse(id);
    const step = zPostpone.parse(by);
    const db = getDb();
    const [r] = await db.select().from(s.reminders).where(eq(s.reminders.id, rid)).limit(1);
    if (!r) throw new UserError("Hatırlatıcı bulunamadı");
    if (!r.active) throw new UserError("Kapalı hatırlatıcı ertelenemez");
    // Gecikmiş dönem bugünden ertelenir; tekrar edenin yeni tarihi sıradaki dönemin üstüne binemez
    const repeat = r.repeat as ReminderRepeat;
    const { target, next, conflict } = postponePlan({ dueDate: r.dueDate, repeat, anchorDate: r.anchorDate }, step, todayTR());
    if (conflict && next) {
      throw new UserError(`Sıradaki dönem ${dateTR(next)} tarihinde; ${step === "month" ? "1 ay" : "1 hafta"} ertelemek aynı ödemeyi iki kez gösterirdi. Daha kısa erteleyin ya da tarihi düzenleyin.`);
    }
    const prev = snapshot(r);
    let createdId: number | null = null;
    if (!next) {
      await db.update(s.reminders).set({ dueDate: target, anchorDate: target }).where(eq(s.reminders.id, rid));
    } else {
      createdId = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(s.reminders)
          .values({
            title: r.title,
            kind: r.kind,
            amount: r.amount,
            dueDate: target,
            anchorDate: target,
            repeat: "none",
            remindDaysBefore: r.remindDaysBefore,
            note: `Ertelendi · asıl tarih ${dateTR(r.dueDate)}${r.note && !r.note.startsWith("Ertelendi") ? ` · ${r.note}` : ""}`.slice(0, 500),
          })
          .returning({ id: s.reminders.id });
        await tx.update(s.reminders).set({ dueDate: next }).where(eq(s.reminders.id, rid));
        return c.id;
      });
    }
    await logActivity(me, "Hatırlatıcı ertelendi", `${r.title} · ${dateTR(r.dueDate)} → ${dateTR(target)}${next ? ` · seri ${dateTR(next)} tarihinden sürer` : ""}`);
    refresh();
    return { dueDate: target, next, createdId, prev };
  });
}

/** Ödenmemiş faturanın vadesini ertele; vadesizse tahmini vadeden (fatura tarihi + ayardaki gün) ileri alınır */
export async function postponeInvoice(id: number, by: "week" | "month") {
  return attempt(async () => {
    const me = await requireAdmin();
    const iid = zId.parse(id);
    const step = zPostpone.parse(by);
    const db = getDb();
    const [inv] = await db
      .select({ id: s.invoices.id, supplier: s.invoices.supplier, date: s.invoices.date, dueDate: s.invoices.dueDate, unpaid: s.invoices.unpaid })
      .from(s.invoices)
      .where(eq(s.invoices.id, iid))
      .limit(1);
    if (!inv) throw new UserError("Fatura bulunamadı");
    if (!inv.unpaid) throw new UserError("Bu fatura ödenmiş görünüyor");
    const settings = await loadNotifySettings();
    const current = inv.dueDate ?? addDays(inv.date, settings.invoiceTermDays);
    // Gecikmiş vade bugünden ertelenir (eski vadeden sayılsa yine geçmişte kalırdı)
    const target = postponeDate(current, step, todayTR());
    await db.update(s.invoices).set({ dueDate: target }).where(eq(s.invoices.id, iid));
    await logActivity(me, "Fatura vadesi ertelendi", `${inv.supplier} · ${dateTR(current)} → ${dateTR(target)}`);
    refresh();
    return { dueDate: target, prev: inv.dueDate };
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
    const db = getDb();
    const [dup] = await db.select({ id: s.notificationRecipients.id }).from(s.notificationRecipients).where(eq(s.notificationRecipients.email, e)).limit(1);
    if (dup) throw new UserError(`${e} zaten listede`);
    await db.insert(s.notificationRecipients).values({ email: e, name: n });
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
  invoiceDaysBefore: z.number().int("Tam gün girin").min(0, "Gün negatif olamaz").max(30, "En fazla 30 gün önce"),
  invoiceTermDays: z.number().int("Tam gün girin").min(0, "Gün negatif olamaz").max(120, "Vade en fazla 120 gün"),
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

/**
 * E-posta önizlemesi: bugün gidecek sabah e-postasının HTML'i (gönderilmez, günlüğe yazılmaz). Gerçek gönderim gibi
 * Paraşüt bölümü (yeni faturalar, kontrol bekleyenler, eşitleme hatası) ve yeni zamlar da girer; ödeme, yeni fatura
 * ya da zam yoksa örnek bir ödeme satırıyla gösterilir.
 */
export async function previewDigest() {
  return attempt(async () => {
    await requireAdmin();
    const { today, items } = await loadUpcoming();
    const due = dueNotifications(items);
    // Yükleyiciler yalnız okur; failedRunKey gönderimden sonra günlüğe yazmak içindir, burada kullanılmaz
    const [sent, { invoices }, prices] = await Promise.all([
      due.length
        ? getDb()
            .select({ key: s.notificationLog.key })
            .from(s.notificationLog)
            .where(inArray(s.notificationLog.key, due.map((d) => d.key)))
        : [],
      loadDigestInvoices(),
      loadDigestPrices().catch(() => null),
    ]);
    const invoiceNews = invoices.items.length > 0 || Boolean(invoices.syncError);
    const example: UpcomingItem = {
      ref: "preview:0",
      source: "reminder",
      sourceId: 0,
      kind: "kira",
      title: "Örnek: Kira",
      detail: "Bugün haber verilecek ödeme, yeni fatura ya da zam yok; e-posta böyle görünür",
      amount: 25000,
      dueDate: today,
      daysLeft: 0,
      status: "today",
      remindDaysBefore: 3,
      repeat: "monthly",
    };
    // Gerçek gönderim de yalnız bunlardan biri varsa gider; hiçbiri yoksa örnek satırla gösterilir
    const sample = !due.length && !invoiceNews && !prices;
    const rows = sample ? [{ item: example, stage: "due" as const }] : due;
    const { subject, html } = renderDigest(rows, today, invoiceNews || invoices.reviewCount ? invoices : null, prices);
    return {
      subject,
      html,
      count: due.length,
      alreadySent: sent.length,
      invoices: invoices.items.length,
      prices: prices?.changes.length ?? 0,
      syncError: Boolean(invoices.syncError),
      sample,
    };
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

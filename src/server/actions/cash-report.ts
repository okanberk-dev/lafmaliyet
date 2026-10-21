"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate, computeCash, diffText, parseEmails, staffCanReport, waPhone, whatsappLink, whatsappText, type CashReportFields } from "@/lib/cash-report";
import { longDateTR } from "@/lib/reminders";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { cashReportsBetween, getCashReport, loadCashSettings, saveCashSettings, toCashDTO } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";
import { renderCashReport } from "@/server/notify/cash-report-template";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText } from "./util";

// Gün sonu kasa raporu: personel (ve yönetici) her akşam girer; kayıt iş günü başına bir tane, yeniden gönderilince
// güncellenir. Gönderilince kasa raporu alıcılarına e-posta gider; WhatsApp metni ekranda hazırlanır (docs/KASA-RAPORU.md).

const zAmount = z.number({ message: "Tutar girin" }).finite("Geçersiz tutar").min(0, "Tutar eksi olamaz").max(100_000_000, "Tutar çok büyük");

const reportSchema = z.object({
  date: zDate,
  zNo: zOptText(30),
  receipts: z.number().int().min(0).max(100_000).nullable(),
  zTotal: zAmount,
  cash: zAmount,
  card: zAmount,
  mealCard: zAmount,
  online: zAmount,
  other: zAmount,
  openingCash: zAmount,
  cashOut: zAmount,
  cashOutNote: zOptText(200),
  countedCash: zAmount,
  handedOver: zAmount,
  bankPos: zAmount.nullable(),
  note: zOptText(1000),
  /** Formun açıldığı andaki sürüm (0: yeni): arada başkası gönderdiyse üzerine yazılmaz */
  revision: z.number().int().min(0),
});

export type CashEmailOutcome = { status: "sent" | "failed" | "off"; error: string | null; to: number };

async function emailReport(reportId: number): Promise<CashEmailOutcome> {
  const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.id, reportId)).limit(1);
  if (!row) throw new UserError("Rapor bulunamadı");
  const settings = await loadCashSettings();
  let outcome: CashEmailOutcome;
  if (!settings.emailEnabled || !settings.recipients.length) {
    outcome = { status: "off", error: null, to: 0 };
  } else if (!isEmailConfigured()) {
    outcome = { status: "failed", error: "E-posta kurulmamış (RESEND_API_KEY); rapor kaydedildi, WhatsApp ile gönderebilirsiniz.", to: 0 };
  } else {
    const dto = toCashDTO(row);
    const msg = renderCashReport(dto, { by: dto.submittedByName, revision: dto.revision, submittedAt: row.updatedAt });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: settings.recipients, ...msg, idempotencyKey: `cash-${row.date}-r${row.revision}` });
    outcome = res.ok ? { status: "sent", error: null, to: settings.recipients.length } : { status: "failed", error: res.error, to: 0 };
    await getDb()
      .insert(s.notificationLog)
      .values({ key: `cash:${row.date}:r${row.revision}`, channel: "email", subject: msg.subject, recipients: settings.recipients.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
  }
  await getDb()
    .update(s.cashReports)
    .set({ emailStatus: outcome.status, emailError: outcome.error, emailedAt: outcome.status === "sent" ? new Date() : row.emailedAt })
    .where(eq(s.cashReports.id, row.id));
  return outcome;
}

/** Raporu kaydeder (yoksa ekler, varsa günceller), alıcılara e-postalar; WhatsApp metnini ve bağlantısını döner */
export async function submitCashReport(input: z.input<typeof reportSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const { revision, ...data } = reportSchema.parse(input);
    const today = businessDate();
    if (data.date > today) throw new UserError("İleri bir günün raporu girilemez");
    if (me.role !== "admin" && !staffCanReport(data.date)) throw new UserError("Personel yalnız bugünün ve dünün raporunu girebilir; daha eskisi için yöneticiye yazın");
    if (data.handedOver > data.countedCash) throw new UserError("Teslim edilen, sayılan nakitten fazla olamaz");
    const fields: CashReportFields = data;
    const c = computeCash(fields);
    const db = getDb();
    const saved = await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(s.cashReports).where(eq(s.cashReports.date, data.date)).for("update").limit(1);
      if (prev && prev.revision !== revision) {
        throw new UserError(`Bu günün raporunu az önce ${prev.submittedByName} gönderdi; sayfayı yenileyip onun girdiklerini kontrol edin`);
      }
      if (!prev && revision !== 0) throw new UserError("Rapor bu arada silinmiş; sayfayı yenileyin");
      const values = { ...data, cashDiff: c.cashDiff, submittedBy: me.id, submittedByName: me.name, emailStatus: null, emailError: null, updatedAt: new Date() };
      if (prev) {
        const [row] = await tx
          .update(s.cashReports)
          .set({ ...values, revision: prev.revision + 1 })
          .where(eq(s.cashReports.id, prev.id))
          .returning();
        return row;
      }
      const [row] = await tx.insert(s.cashReports).values(values).returning();
      return row;
    });
    const email = await emailReport(saved.id);
    await logActivity(me, saved.revision > 1 ? "Kasa raporu güncellendi" : "Kasa raporu", `${longDateTR(data.date)}: ${diffText(c.cashDiff)}`);
    refresh();
    const settings = await loadCashSettings();
    const text = whatsappText(fields, { by: me.name, revision: saved.revision });
    return { id: saved.id, revision: saved.revision, cashDiff: c.cashDiff, email, whatsapp: { text, link: whatsappLink(text, settings.whatsapp) } };
  });
}

/** E-posta gitmediyse yeniden dener (yönetici ya da raporu gönderen, raporun günü geçmeden) */
export async function resendCashReportEmail(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.id, z.number().int().positive().parse(id))).limit(1);
    if (!row) throw new UserError("Rapor bulunamadı");
    if (me.role !== "admin" && (row.submittedBy !== me.id || !staffCanReport(row.date))) throw new UserError("Bu raporu yalnız yönetici yeniden gönderebilir");
    const email = await emailReport(row.id);
    refresh();
    return email;
  });
}

export async function deleteCashReport(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [row] = await getDb()
      .delete(s.cashReports)
      .where(eq(s.cashReports.id, z.number().int().positive().parse(id)))
      .returning({ date: s.cashReports.date });
    if (!row) throw new UserError("Rapor bulunamadı");
    await logActivity(me, "Kasa raporu silindi", longDateTR(row.date));
    refresh();
    return null;
  });
}

const settingsSchema = z.object({
  recipients: z.string().max(2000),
  emailEnabled: z.boolean(),
  whatsapp: z.string().max(40),
});

export async function updateCashSettings(input: z.input<typeof settingsSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = settingsSchema.parse(input);
    const { valid, invalid } = parseEmails(data.recipients);
    if (invalid.length) throw new UserError(`Geçersiz e-posta: ${invalid.slice(0, 3).join(", ")}`);
    if (valid.length > 10) throw new UserError("En çok 10 adres girilebilir");
    if (data.emailEnabled && !valid.length) throw new UserError("E-posta açıkken en az bir adres girin");
    const whatsapp = data.whatsapp.trim() ? waPhone(data.whatsapp) : null;
    if (data.whatsapp.trim() && !whatsapp) throw new UserError("WhatsApp numarası geçersiz (ör. 0532 123 45 67)");
    await saveCashSettings({ recipients: valid, emailEnabled: data.emailEnabled, whatsapp });
    await logActivity(me, "Kasa raporu alıcıları", valid.join(", ") || "e-posta kapalı");
    refresh();
    return { recipients: valid, whatsapp };
  });
}

/** Alıcılara deneme e-postası: son raporla (yoksa örnek bir raporla), konusu "[Deneme]" */
export async function sendCashTestEmail() {
  return attempt(async () => {
    await requireAdmin();
    const settings = await loadCashSettings();
    if (!settings.recipients.length) throw new UserError("Önce bir adres girin");
    if (!isEmailConfigured()) throw new UserError("E-posta kurulmamış: Vercel'de RESEND_API_KEY tanımlı değil");
    const [last] = await cashReportsBetween("2000-01-01", businessDate());
    const sample: CashReportFields = last ?? {
      date: businessDate(),
      zNo: "0001",
      receipts: 42,
      zTotal: 10_000,
      cash: 2_500,
      card: 7_000,
      mealCard: 500,
      online: 0,
      other: 0,
      openingCash: 500,
      cashOut: 100,
      cashOutNote: "süt",
      countedCash: 2_880,
      handedOver: 2_400,
      bankPos: 7_000,
      note: "Örnek rapor",
    };
    const msg = renderCashReport(sample, { by: last?.submittedByName ?? "Örnek", revision: 1, submittedAt: new Date() });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: settings.recipients, ...msg, subject: `[Deneme] ${msg.subject}` });
    if (!res.ok) throw new UserError(res.error);
    return { to: settings.recipients.length };
  });
}

/** Ekranda kayıtlı raporun WhatsApp metni (rapor zaten gönderilmişken "WhatsApp ile gönder" için) */
export async function cashReportWhatsapp(date: string) {
  return attempt(async () => {
    const me = await requireUser();
    const d = zDate.parse(date);
    if (me.role !== "admin" && !staffCanReport(d)) throw new UserError("Bu raporu yalnız yönetici görebilir");
    const r = await getCashReport(d);
    if (!r) throw new UserError("Bu günün raporu yok");
    const settings = await loadCashSettings();
    const text = whatsappText(r, { by: r.submittedByName, revision: r.revision });
    return { text, link: whatsappLink(text, settings.whatsapp) };
  });
}

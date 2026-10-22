"use server";

import { count, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate, computeCash, diffText, parseEmails, staffCanReport, waPhone, whatsappLink, whatsappText, type CashReportFields } from "@/lib/cash-report";
import { DELETED_REPORT_DAYS, linkedUntil, MAX_REPORT_PHOTOS } from "@/lib/photo-rules";
import { longDateTR, todayTR } from "@/lib/reminders";
import type { TillOnlineRow } from "@/lib/site-sales/calc";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { cashReportExtras } from "@/server/data/cash-photos";
import { cashReportsBetween, getCashReport, loadCashSettings, saveCashSettings, toCashDTO } from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { getDb, schema as s } from "@/server/db";
import { renderCashReport } from "@/server/notify/cash-report-template";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { getPhoto, keepPhoto, linkable, releasePhoto } from "@/server/storage/photos";

import { logActivity } from "./log";
import { attempt, UserError, zAmount, zDate, zOptText } from "./util";

// Gün sonu kasa raporu: personel (ve yönetici) her akşam girer; kayıt iş günü başına bir tane, yeniden gönderilince
// güncellenir. Gönderilince kasa raporu alıcılarına e-posta gider; WhatsApp metni ekranda hazırlanır (docs/KASA-RAPORU.md).

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
  offRevenue: zAmount.nullable(),
  note: zOptText(1000),
  /** Formun açıldığı andaki sürüm (0: yeni): arada başkası gönderdiyse üzerine yazılmaz */
  revision: z.number().int().min(0),
  /** Bu gönderimle eklenen Z ve banka POS fotoğrafları (henüz bağlanmamış; eskileri bağlı kalır) */
  photos: z.array(z.number().int().positive()).max(MAX_REPORT_PHOTOS).default([]),
});

export type CashEmailOutcome = { status: "sent" | "failed" | "off"; error: string | null; to: number };

/**
 * Raporu alıcılara e-postalar. `site`: laffogato.net'in o günkü online satış satırı (önceden başlatılmış istek; yoksa
 * burada sorulur). Site ulaşılamazsa ya da 8 saniyede yanıt vermezse satır yazılmaz; e-posta yine gider.
 */
async function emailReport(reportId: number, site?: Promise<TillOnlineRow | null>): Promise<CashEmailOutcome> {
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
    const waste = await dayWaste(row.date);
    const online = await (site ?? fetchTillOnlineRow(row.date));
    const extras = await cashReportExtras(dto);
    const msg = renderCashReport(dto, { by: dto.submittedByName, revision: dto.revision, submittedAt: row.updatedAt, waste, ikramValue: waste.ikramValue || null, online, ...extras });
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
    const { revision, photos, ...data } = reportSchema.parse(input);
    const today = businessDate();
    if (data.date > today) throw new UserError("İleri bir günün raporu girilemez");
    if (me.role !== "admin" && !staffCanReport(data.date)) throw new UserError("Personel yalnız bugünün ve dünün raporunu girebilir; daha eskisi için yöneticiye yazın");
    if (data.handedOver > data.countedCash) throw new UserError("Teslim edilen, sayılan nakitten fazla olamaz");
    const fields: CashReportFields = data;
    const c = computeCash(fields);
    // laffogato.net'in o günkü online satışı e-postaya bilgi satırı olarak girer: istek kayıtla aynı anda başlar, site
    // yavaşsa e-posta en çok 8 saniye bekler, ulaşılamazsa satırsız gider (kasa rakamlarına hiç girmez)
    const site = fetchTillOnlineRow(data.date);
    const db = getDb();
    const saved = await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(s.cashReports).where(eq(s.cashReports.date, data.date)).for("update").limit(1);
      if (prev && prev.revision !== revision) {
        throw new UserError(`Bu günün raporunu az önce ${prev.submittedByName} gönderdi; sayfayı yenileyip onun girdiklerini kontrol edin`);
      }
      if (!prev && revision !== 0) throw new UserError("Rapor bu arada silinmiş; sayfayı yenileyin");
      const values = { ...data, cashDiff: c.cashDiff, submittedBy: me.id, submittedByName: me.name, emailStatus: null, emailError: null, updatedAt: new Date() };
      const [row] = prev
        ? await tx
            .update(s.cashReports)
            .set({ ...values, revision: prev.revision + 1 })
            .where(eq(s.cashReports.id, prev.id))
            .returning()
        : await tx.insert(s.cashReports).values(values).returning();
      // Fotoğraflar kanıttır: yalnız eklenir (yeniden gönderimde eskileri bağlı kalır), rapor gününden 180 gün saklanır
      // (geçmiş bir güne sonradan eklenen bugünden)
      const ids = [...new Set(photos)];
      if (ids.length) {
        const [{ n }] = await tx.select({ n: count() }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, row.id));
        if (n + ids.length > MAX_REPORT_PHOTOS) throw new UserError(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
        for (const id of ids) {
          const p = await getPhoto(id, tx);
          if (!p || (p.kind !== "kasa-z" && p.kind !== "kasa-pos") || !linkable(p) || (me.role !== "admin" && p.createdBy !== me.id)) {
            throw new UserError("Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin");
          }
          await tx.insert(s.cashReportPhotos).values({ reportId: row.id, photoId: id, kind: p.kind });
          await keepPhoto(id, linkedUntil(p.kind, data.date, todayTR()), tx);
        }
      }
      return row;
    });
    const email = await emailReport(saved.id, site);
    await logActivity(me, saved.revision > 1 ? "Kasa raporu güncellendi" : "Kasa raporu", `${longDateTR(data.date)}: ${diffText(c.cashDiff)}`);
    refresh();
    const settings = await loadCashSettings();
    const text = whatsappText(fields, { by: me.name, revision: saved.revision, waste: await dayWaste(data.date), ...(await cashReportExtras({ ...fields, id: saved.id })) });
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
    const reportId = z.number().int().positive().parse(id);
    // Yanlışlıkla silinen raporun fotoğrafları 30 gün daha saklanır (bağları raporla birlikte silinir)
    const { row, photos } = await getDb().transaction(async (tx) => {
      const links = await tx.select({ photoId: s.cashReportPhotos.photoId }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, reportId));
      for (const l of links) await releasePhoto(l.photoId, DELETED_REPORT_DAYS, tx);
      const [row] = await tx.delete(s.cashReports).where(eq(s.cashReports.id, reportId)).returning({ date: s.cashReports.date });
      if (!row) throw new UserError("Rapor bulunamadı");
      return { row, photos: links.length };
    });
    await logActivity(me, "Kasa raporu silindi", `${longDateTR(row.date)}${photos ? ` · ${photos} fotoğraf` : ""}`);
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
      offRevenue: null,
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
    const text = whatsappText(r, { by: r.submittedByName, revision: r.revision, waste: await dayWaste(d), ...(await cashReportExtras(r)) });
    return { text, link: whatsappLink(text, settings.whatsapp) };
  });
}

"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate, carryCheck, changesText, diffText, parseEmails, staffCanReport, waPhone, whatsappLink, whatsappText, type CashReportFields } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { emailReport } from "@/server/cash/report-email";
import { removeCashReport, reportSchema, saveCashReport, staffEmailsIn } from "@/server/cash/report-store";
import { cashReportExtras } from "@/server/data/cash-photos";
import { cashReportIntegrity, cashReportsBetween, getCashReport, loadCashSettings, nextReportAfter, saveCashSettings, toCashDTO } from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { getDb, schema as s } from "@/server/db";
import { renderCashReport } from "@/server/notify/cash-report-template";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";

import { logActivity } from "./log";
import { attempt, UserError, zDate } from "./util";

// Gün sonu kasa raporu: personel (ve yönetici) her akşam girer; kayıt iş günü başına bir tane, yeniden gönderilince
// güncellenir. Gönderilince kasa raporu alıcılarına e-posta gider; WhatsApp metni ekranda hazırlanır (docs/KASA-RAPORU.md).
// Yazım yolu src/server/cash/report-store.ts, e-posta src/server/cash/report-email.ts; bu dosyada yalnız uçlar.

/**
 * Raporu kaydeder (yoksa ekler, varsa günceller), alıcılara e-postalar; WhatsApp metnini ve bağlantısını döner.
 * Personelin değişikliği yöneticinin onayını gerektiriyorsa (ertesi gün kasa alanı ya da sayan, kilitli gün) hiçbir şey
 * yazılmaz, `needsApproval` döner: form yazılanları korur ve "Onaya gönder"e geçer (requestCashCorrection).
 */
export async function submitCashReport(input: z.input<typeof reportSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = reportSchema.parse(input);
    // laffogato.net'in o günkü online satışı e-postaya bilgi satırı olarak girer: istek kayıtla aynı anda başlar, site
    // yavaşsa e-posta en çok 8 saniye bekler, ulaşılamazsa satırsız gider (kasa rakamlarına hiç girmez)
    const site = fetchTillOnlineRow(data.date);
    const out = await saveCashReport(getDb(), me, data);
    if (out.kind === "needsApproval") return { needsApproval: true as const, request: out.request, gate: out.gate };
    const { row: saved, changes, prevCarry } = out;
    const cashDiff = saved.cashDiff;
    const email = await emailReport(saved.id, { site });
    await logActivity(
      me,
      saved.revision > 1 ? "Kasa raporu güncellendi" : "Kasa raporu",
      `${longDateTR(data.date)}: ${diffText(cashDiff)}${changes.length ? ` · ${changesText(changes)}` : ""}`,
    );
    refresh();
    const dto = toCashDTO(saved);
    const [settings, waste, extras, integrity, nextReport] = await Promise.all([
      loadCashSettings(),
      dayWaste(data.date),
      cashReportExtras(dto),
      cashReportIntegrity(dto),
      nextReportAfter(data.date),
    ]);
    const text = whatsappText(dto, { by: me.name, revision: saved.revision, waste, ...extras, ...integrity });
    return {
      needsApproval: false as const,
      id: saved.id,
      revision: saved.revision,
      cashDiff,
      email,
      whatsapp: { text, link: whatsappLink(text, settings.whatsapp) },
      next: integrity.next ?? null,
      // Bu düzeltmeyle mi bozuldu: sonraki raporun açılışı önceki sürümün devriyle tutuyordu
      nextBroken: Boolean(
        integrity.next && nextReport && prevCarry !== null && !carryCheck(nextReport.date, nextReport.openingCash, { date: data.date, amount: prevCarry }),
      ),
    };
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
    const { row, photos } = await getDb().transaction((tx) => removeCashReport(tx, reportId));
    await logActivity(
      me,
      "Kasa raporu silindi",
      [longDateTR(row.date), `Z ${money(row.zTotal)}`, `sayılan ${money(row.countedCash)}`, diffText(row.cashDiff), row.countedByName ?? row.by, photos ? `${photos} fotoğraf` : null]
        .filter(Boolean)
        .join(" · "),
    );
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
    // Kasa e-postasında karaoke ön ödemesi var: personel tutarları görmez, adresi alıcı olamaz
    if ((await staffEmailsIn(getDb(), valid)).length) throw new UserError("Bu adres bir personel hesabının; kasa e-postasında karaoke ön ödemesi var.");
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
      discounts: null,
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
    const [settings, waste, extras, integrity] = await Promise.all([loadCashSettings(), dayWaste(d), cashReportExtras(r), cashReportIntegrity(r)]);
    const text = whatsappText(r, { by: r.submittedByName, revision: r.revision, waste, ...extras, ...integrity });
    return { text, link: whatsappLink(text, settings.whatsapp) };
  });
}

"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_ID_MAX, namedTill } from "@/lib/branches";
import { businessDate, carryCheck, changesText, diffText, parseEmails, staffCanReport, waPhone, whatsappLink, whatsappText, type CashReportFields } from "@/lib/cash-report";
import type { Role } from "@/lib/constants";
import { money } from "@/lib/format";
import { allDroppedSentence, droppedListText, recipientRefusal } from "@/lib/notify-recipients";
import { longDateTR } from "@/lib/reminders";
import { emailErrorFor } from "@/lib/staff-errors";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { formTillBranch, staffBranchRefusal, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { emailReport, type CashEmailOutcome } from "@/server/cash/report-email";
import { clearOkcCumulativeCore, removeCashReport, reportSchema, saveCashReport } from "@/server/cash/report-store";
import { cashReportExtras } from "@/server/data/cash-photos";
import { cashReportIntegrity, cashReportsBetween, getCashReport, loadCashSettings, nextReportAfter, saveCashSettings, toCashDTO } from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { getDb, schema as s } from "@/server/db";
import { renderCashReport } from "@/server/notify/cash-report-template";
import { blockedAccounts, sendableRecipients } from "@/server/notify/recipients";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";

import { logActivity } from "./log";
import { attempt, UserError, zDate } from "./util";

// Gün sonu kasa raporu: personel (ve yönetici) her akşam girer; kayıt iş günü başına bir tane, yeniden gönderilince
// güncellenir. Gönderilince kasa raporu alıcılarına e-posta gider; WhatsApp metni ekranda hazırlanır (docs/KASA-RAPORU.md).
// Yazım yolu src/server/cash/report-store.ts, e-posta src/server/cash/report-email.ts; bu dosyada yalnız uçlar.

/**
 * E-postanın sonucu okuyana göre (E-64): personel neden gitmediğini (Resend anahtarı, alıcı listesi) görmez, sabit metni
 * görür ("E-posta gitmedi; yöneticiye haber verin…"); yönetici olduğu gibi. Kayıtlı raporun satırı da aynı kuralla
 * (toCashDTO).
 */
const outcomeFor = (role: Role, e: CashEmailOutcome): CashEmailOutcome => ({ ...e, error: emailErrorFor(role, e.error) });

const submitSchema = reportSchema.extend({
  /** Formun gösterdiği kasa (docs/SUBE.md › Yazarken hangi şube); göndermeyen eski sekmede seçili kasa */
  branchId: z.string().max(BRANCH_ID_MAX).nullish(),
});

/**
 * Raporu kaydeder (yoksa ekler, varsa günceller), alıcılara e-postalar; WhatsApp metnini ve bağlantısını döner.
 * Personelin değişikliği yöneticinin onayını gerektiriyorsa (ertesi gün kasa alanı ya da sayan, kilitli gün) hiçbir şey
 * yazılmaz, `needsApproval` döner: form yazılanları korur ve "Onaya gönder"e geçer (requestCashCorrection). Rapor
 * formun gösterdiği kasaya yazılır (formTillBranch), gönderim anındaki seçime değil.
 */
export async function submitCashReport(input: z.input<typeof submitSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const { branchId, ...data } = submitSchema.parse(input);
    const till = await formTillBranch(branchId);
    // laffogato.net'in o günkü online satışı e-postaya bilgi satırı olarak girer: istek kayıtla aynı anda başlar, site
    // yavaşsa e-posta en çok 8 saniye bekler, ulaşılamazsa satırsız gider (kasa rakamlarına hiç girmez)
    const site = fetchTillOnlineRow(data.date, till);
    // Kayıt formun kasasının kapsamında: başka sekmede seçici değiştiyse de Tuzla'nın formu Tuzla'ya yazar
    const out = await withBranchScope(till, () => saveCashReport(getDb(), me, data));
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
    const [settings, waste, extras, integrity, nextReport, branches] = await Promise.all([
      loadCashSettings(),
      dayWaste(data.date, saved.branchId),
      cashReportExtras(dto),
      cashReportIntegrity(dto),
      nextReportAfter(data.date, saved.branchId),
      listBranches(),
    ]);
    // Birden çok kasa açıkken metnin başlığında raporun şubesi (iki şubenin metni aynı sohbete düşer)
    const branchName = namedTill(branches, saved.branchId)?.name ?? null;
    const text = whatsappText(dto, { by: me.name, revision: saved.revision, waste, branchName, ...extras, ...integrity });
    return {
      needsApproval: false as const,
      id: saved.id,
      revision: saved.revision,
      cashDiff,
      email: outcomeFor(me.role, email),
      whatsapp: { text, link: whatsappLink(text, settings.whatsapp) },
      next: integrity.next ?? null,
      // Bu düzeltmeyle mi bozuldu: sonraki raporun açılışı önceki sürümün devriyle tutuyordu
      nextBroken: Boolean(
        integrity.next && nextReport && prevCarry !== null && !carryCheck(nextReport.date, nextReport.openingCash, { date: data.date, amount: prevCarry }),
      ),
    };
  });
}

/**
 * E-posta gitmediyse yeniden dener (yönetici ya da raporu gönderen, raporun günü geçmeden; şubesine kilitli personel
 * yalnız kendi şubesinin raporunu, staffBranchRefusal)
 */
export async function resendCashReportEmail(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.id, z.number().int().positive().parse(id))).limit(1);
    if (!row) throw new UserError("Rapor bulunamadı");
    const otherBranch = await staffBranchRefusal(me, row.branchId);
    if (otherBranch) throw new UserError(otherBranch);
    if (me.role !== "admin" && (row.submittedBy !== me.id || !staffCanReport(row.date))) throw new UserError("Bu raporu yalnız yönetici yeniden gönderebilir");
    const email = await emailReport(row.id);
    refresh();
    return outcomeFor(me.role, email);
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

/**
 * Yönetici: yanlış okunup saklanmış yazarkasa kümülatifini temizler (docs/planlar/okc-z.md §3.7, §6.1). Raporun sürümü
 * değişmez, işlem geçmişine düşer (çekirdekte, aynı işlemde)
 */
export async function clearOkcCumulative(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    await clearOkcCumulativeCore(getDb(), me, z.number().int().positive().parse(id));
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
    // Kasa e-postasında karaoke ön ödemesi var: personel hesabının adresi alıcı olamaz; pasif hesaba e-posta gitmez (E-53).
    // Gönderim aynı kuralla süzer (kayıttan sonra personele indirilen ya da pasif yapılan hesap da düşer)
    const blocked = await blockedAccounts(getDb(), valid);
    const first = valid.find((e) => blocked.has(e));
    if (first) throw new UserError(recipientRefusal("cash", { email: first, reason: blocked.get(first)! }));
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
    // Personel hesabının ya da pasif hesabın adresi (ayar kaydedildikten sonra değişen) deneme e-postasını da almaz
    const { to: recipients, dropped } = await sendableRecipients(getDb(), settings.recipients);
    if (!recipients.length) throw new UserError(`${allDroppedSentence("Alıcıların", dropped)} Yöneticinin ya da muhasebecinin adresini girin.`);
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
      cashIn: 0,
      cashOut: 100,
      cashOutNote: "süt",
      countedCash: 2_880,
      handedOver: 2_400,
      bankPos: 7_000,
      offRevenue: null,
      discounts: null,
      note: "Örnek rapor",
      // Banka POS Z (yazarkasa) bölümü de görünsün (docs/planlar/okc-z.md §8): tek oranlı gün, kart ModPOS'la aynı
      okcZNo: "0001",
      okcReceipts: 42,
      okcTotal: 10_000,
      okcVatTotal: 909.09,
      okcVat: [{ rate: 10, total: 10_000, vat: 909.09 }],
      okcCash: 2_500,
      okcCard: 7_000,
      okcMealCard: 500,
      okcOther: 0,
    };
    // Son rapor birden çok kasa açıkken şubesiyle (gerçek e-postadaki gibi konuda ve "Panelde aç"ta)
    const branch = last ? namedTill(await listBranches(), last.branchId) : null;
    const msg = renderCashReport(sample, { by: last?.submittedByName ?? "Örnek", revision: 1, submittedAt: new Date(), branch });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: recipients, ...msg, subject: `[Deneme] ${msg.subject}` });
    if (!res.ok) throw new UserError(res.error);
    return { to: recipients.length, skipped: dropped.length ? droppedListText(dropped) : null };
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
    const [settings, waste, extras, integrity, branches] = await Promise.all([
      loadCashSettings(),
      dayWaste(d, r.branchId),
      cashReportExtras(r),
      cashReportIntegrity(r),
      listBranches(),
    ]);
    const branchName = namedTill(branches, r.branchId)?.name ?? null;
    const text = whatsappText(r, { by: r.submittedByName, revision: r.revision, waste, branchName, ...extras, ...integrity });
    return { text, link: whatsappLink(text, settings.whatsapp) };
  });
}

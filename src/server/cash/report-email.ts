import "server-only";

import { eq } from "drizzle-orm";

import { namedTill } from "@/lib/branches";
import { cashEmailKey, cashLogKey } from "@/lib/cash-report";
import { allDroppedSentence, type DroppedRecipient } from "@/lib/notify-recipients";
import type { TillOnlineRow } from "@/lib/site-sales/calc";
import { listBranches } from "@/server/branches";
import { cashReportExtras } from "@/server/data/cash-photos";
import { cashReportIntegrity, loadCashSettings, toCashDTO } from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { getDb, schema as s } from "@/server/db";
import { renderCashReport } from "@/server/notify/cash-report-template";
import { sendableRecipients } from "@/server/notify/recipients";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { UserError } from "@/server/user-error";

/*
 * Kasa raporunun e-postası (docs/KASA-RAPORU.md › Gönderince): rapor her kaydedildiğinde (gönderim, düzeltme,
 * yöneticinin onayı) alıcılara gider. Sunucu eylemi değil: rapor eylemleri ve onay eylemleri çağırır.
 */

export type CashEmailOutcome = { status: "sent" | "failed" | "off"; error: string | null; to: number };

/**
 * Kayıtlı adreslerin hepsi personel ya da pasif hesabın: yöneticinin gördüğü neden (personel sabit metni görür). Formda
 * "E-posta gitmedi: " ile başlar (emailFailedLine); burada yinelenmez
 */
export function allDroppedText(dropped: readonly DroppedRecipient[]): string {
  return `${allDroppedSentence("Alıcıların", dropped)} Kasa › Rapor alıcıları'na yöneticinin ya da muhasebecinin adresini yazın.`;
}

/**
 * Raporu alıcılara e-postalar. `site`: laffogato.net'in o günkü online satış satırı (önceden başlatılmış istek; yoksa
 * burada sorulur). Site ulaşılamazsa ya da 8 saniyede yanıt vermezse satır yazılmaz; e-posta yine gider. `approval`:
 * başlığın altına yazılan onay satırı ("Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı."). `idempotencyKey`:
 * verilmezse `cash-{rapor}-r{sürüm}` (cashEmailKey: aynı sürüm iki kez gitmez; silinip yeniden girilen gün yeni
 * satırdır, anahtarı da yenidir).
 */
export async function emailReport(
  reportId: number,
  o: { site?: Promise<TillOnlineRow | null>; approval?: string | null; idempotencyKey?: string } = {},
): Promise<CashEmailOutcome> {
  const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.id, reportId)).limit(1);
  if (!row) throw new UserError("Rapor bulunamadı");
  const settings = await loadCashSettings();
  // Personel hesabının ya da pasif hesabın adresi (ayar kaydedildikten sonra personele indirilen, pasif yapılan) gönderim
  // anında düşer (E-53). Düşen adres yöneticinin zilinde ve Rapor alıcıları kartında görünür; hepsi düştüyse e-posta
  // gitmedi sayılır (kapalı değil): yönetici nedenini formda görür, personel sabit metni (staff-errors.ts)
  const { to: recipients, dropped } = settings.emailEnabled ? await sendableRecipients(getDb(), settings.recipients) : { to: [], dropped: [] };
  if (dropped.length) console.warn(`[kasa e-postası] ${dropped.length} alıcı atlandı (personel ya da pasif hesap)`);
  let outcome: CashEmailOutcome;
  if (!settings.emailEnabled || !settings.recipients.length) {
    outcome = { status: "off", error: null, to: 0 };
  } else if (!recipients.length) {
    outcome = { status: "failed", error: allDroppedText(dropped), to: 0 };
  } else if (!isEmailConfigured()) {
    outcome = { status: "failed", error: "E-posta kurulmamış (RESEND_API_KEY); rapor kaydedildi, WhatsApp ile gönderebilirsiniz.", to: 0 };
  } else {
    const dto = toCashDTO(row);
    const waste = await dayWaste(row.date, row.branchId);
    const online = await (o.site ?? fetchTillOnlineRow(row.date, row.branchId));
    // Yeniden gönderimde de değişenler aynı: son kopya yeniden okunur (anahtar cash-{rapor}-r{sürüm} değişmez). Birden çok
    // kasa açıkken raporun şubesi konuda, başlıkta ve "Panelde aç"ta (iki şubenin aynı günkü e-postası ayırt edilir)
    const [extras, integrity, branches] = await Promise.all([cashReportExtras(dto), cashReportIntegrity(dto), listBranches()]);
    // Yazarkasa dışı tahsilat (sunucu sütunu) yalnız bu yönetici metnine: K4 onu da sayar, "tutmuyor" yanlış alarmı olmaz
    const msg = renderCashReport({ ...dto, okcOutside: row.okcOutside }, {
      by: dto.submittedByName,
      revision: dto.revision,
      submittedAt: row.updatedAt,
      waste,
      ikramValue: waste.ikramValue || null,
      // LafPOS gününde gün sonu geldiyse ikram denetimi LafPOS'un rakamlarıyla (geçiş günü boşken null)
      lafposIkram: waste.lafpos?.received ? waste.lafpos : null,
      online,
      approval: o.approval ?? null,
      branch: namedTill(branches, row.branchId),
      ...extras,
      ...integrity,
    });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: recipients, ...msg, idempotencyKey: o.idempotencyKey ?? cashEmailKey(row) });
    outcome = res.ok ? { status: "sent", error: null, to: recipients.length } : { status: "failed", error: res.error, to: 0 };
    await getDb()
      .insert(s.notificationLog)
      // İşlem geçmişinin anahtarı şubenin günü: iki şubenin aynı günkü raporu birbirinin kaydını ezmez
      .values({ key: cashLogKey(row), channel: "email", subject: msg.subject, recipients: recipients.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
  }
  await getDb()
    .update(s.cashReports)
    .set({ emailStatus: outcome.status, emailError: outcome.error, emailedAt: outcome.status === "sent" ? new Date() : row.emailedAt })
    .where(eq(s.cashReports.id, row.id));
  return outcome;
}

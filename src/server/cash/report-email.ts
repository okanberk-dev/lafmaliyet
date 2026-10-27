import "server-only";

import { eq } from "drizzle-orm";

import { cashEmailKey } from "@/lib/cash-report";
import type { TillOnlineRow } from "@/lib/site-sales/calc";
import { cashReportExtras } from "@/server/data/cash-photos";
import { cashReportIntegrity, loadCashSettings, toCashDTO } from "@/server/data/cash-reports";
import { dayWaste } from "@/server/data/waste";
import { getDb, schema as s } from "@/server/db";
import { renderCashReport } from "@/server/notify/cash-report-template";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { fetchTillOnlineRow } from "@/server/site-sales/sync";
import { UserError } from "@/server/user-error";

import { cashEmailRecipients } from "./report-store";

/*
 * Kasa raporunun e-postası (docs/KASA-RAPORU.md › Gönderince): rapor her kaydedildiğinde (gönderim, düzeltme,
 * yöneticinin onayı) alıcılara gider. Sunucu eylemi değil: rapor eylemleri ve onay eylemleri çağırır.
 */

export type CashEmailOutcome = { status: "sent" | "failed" | "off"; error: string | null; to: number };

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
  // Personel hesabına ait adres (ayar kaydedildikten sonra personel olan) gönderim anında düşer; kalmazsa e-posta kapalı
  const recipients = settings.emailEnabled ? await cashEmailRecipients(getDb(), settings.recipients) : [];
  let outcome: CashEmailOutcome;
  if (!settings.emailEnabled || !recipients.length) {
    outcome = { status: "off", error: null, to: 0 };
  } else if (!isEmailConfigured()) {
    outcome = { status: "failed", error: "E-posta kurulmamış (RESEND_API_KEY); rapor kaydedildi, WhatsApp ile gönderebilirsiniz.", to: 0 };
  } else {
    const dto = toCashDTO(row);
    const waste = await dayWaste(row.date);
    const online = await (o.site ?? fetchTillOnlineRow(row.date));
    // Yeniden gönderimde de değişenler aynı: son kopya yeniden okunur (anahtar cash-{rapor}-r{sürüm} değişmez)
    const [extras, integrity] = await Promise.all([cashReportExtras(dto), cashReportIntegrity(dto)]);
    // Yazarkasa dışı tahsilat (sunucu sütunu) yalnız bu yönetici metnine: K4 onu da sayar, "tutmuyor" yanlış alarmı olmaz
    const msg = renderCashReport({ ...dto, okcOutside: row.okcOutside }, {
      by: dto.submittedByName,
      revision: dto.revision,
      submittedAt: row.updatedAt,
      waste,
      ikramValue: waste.ikramValue || null,
      online,
      approval: o.approval ?? null,
      ...extras,
      ...integrity,
    });
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: recipients, ...msg, idempotencyKey: o.idempotencyKey ?? cashEmailKey(row) });
    outcome = res.ok ? { status: "sent", error: null, to: recipients.length } : { status: "failed", error: res.error, to: 0 };
    await getDb()
      .insert(s.notificationLog)
      .values({ key: `cash:${row.date}:r${row.revision}`, channel: "email", subject: msg.subject, recipients: recipients.join(", "), ok: res.ok, error: res.ok ? null : res.error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { ok: res.ok, error: res.ok ? null : res.error, sentAt: new Date() } });
  }
  await getDb()
    .update(s.cashReports)
    .set({ emailStatus: outcome.status, emailError: outcome.error, emailedAt: outcome.status === "sent" ? new Date() : row.emailedAt })
    .where(eq(s.cashReports.id, row.id));
  return outcome;
}

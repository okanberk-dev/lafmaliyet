import "server-only";

import { eq } from "drizzle-orm";

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

/*
 * Kasa raporunun e-postası (docs/KASA-RAPORU.md › Gönderince): rapor her kaydedildiğinde (gönderim, düzeltme,
 * yöneticinin onayı) alıcılara gider. Sunucu eylemi değil: rapor eylemleri ve onay eylemleri çağırır.
 */

export type CashEmailOutcome = { status: "sent" | "failed" | "off"; error: string | null; to: number };

/**
 * Raporu alıcılara e-postalar. `site`: laffogato.net'in o günkü online satış satırı (önceden başlatılmış istek; yoksa
 * burada sorulur). Site ulaşılamazsa ya da 8 saniyede yanıt vermezse satır yazılmaz; e-posta yine gider. `approval`:
 * başlığın altına yazılan onay satırı ("Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı."). `idempotencyKey`:
 * verilmezse `cash-{gün}-r{sürüm}` (aynı sürüm iki kez gitmez).
 */
export async function emailReport(
  reportId: number,
  o: { site?: Promise<TillOnlineRow | null>; approval?: string | null; idempotencyKey?: string } = {},
): Promise<CashEmailOutcome> {
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
    const online = await (o.site ?? fetchTillOnlineRow(row.date));
    // Yeniden gönderimde de değişenler aynı: son kopya yeniden okunur (anahtar cash-{gün}-r{sürüm} değişmez)
    const [extras, integrity] = await Promise.all([cashReportExtras(dto), cashReportIntegrity(dto)]);
    const msg = renderCashReport(dto, {
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
    const res = await sendEmail({ from: resolveFrom(notify.from), to: settings.recipients, ...msg, idempotencyKey: o.idempotencyKey ?? `cash-${row.date}-r${row.revision}` });
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

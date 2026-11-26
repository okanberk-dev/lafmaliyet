import "server-only";

import { quotaMb, quotaMessage, quotaPct, quotaPctText, quotaTransition, quotaUsageText, type QuotaCheckResult } from "@/lib/db-quota";
import type { EmailProblem } from "@/lib/job-health";
import { logActivity } from "@/server/actions/log";
import { getDb, type DB } from "@/server/db";
import { sendSystemEmail } from "@/server/jobs/alerts";
import { DB_QUOTA_ABOUT } from "@/server/notify/digest-template";

import { readDbQuotaState, readDbSizeBytes, saveDbQuotaState } from "./state";

/**
 * Sabah işinin kota denetimi (docs/YEDEK.md › Veritabanı kotası; kurallar src/lib/db-quota.ts): boyutu ölçer, %70 ya da
 * %90 eşiği ilk geçildiyse durumu yazar (zil uyarısı durumdan okunur, src/lib/job-health.ts › systemAlerts), işlem
 * geçmişine düşer ve yöneticilere e-posta gönderir. Eşik başına bir kez; e-posta gidemediyse (Resend hatası) ertesi
 * sabah yeniden denenir. E-posta yalnız canlıda gider (sendSystemEmail). Hata fırlatmaz. `bytes` ve `send` testte verilir.
 */
export async function runQuotaCheck(
  now = new Date(),
  opts: { db?: DB; bytes?: number; send?: (items: EmailProblem[], now: Date) => Promise<"sent" | "none" | "error"> } = {},
): Promise<QuotaCheckResult> {
  try {
    const db = opts.db ?? getDb();
    const send = opts.send ?? ((items: EmailProblem[], at: Date) => sendSystemEmail(items, at, DB_QUOTA_ABOUT));
    const [bytes, prev] = await Promise.all([opts.bytes ?? readDbSizeBytes(db), readDbQuotaState(db)]);
    const mb = quotaMb(process.env.DB_QUOTA_MB);
    const pct = quotaPct(bytes, mb);
    const { level, notify } = quotaTransition(prev.level, pct);
    const since = notify ? now.toISOString() : level === 0 ? null : level === prev.level ? prev.since : now.toISOString();
    // Yeni geçişte ya da önceki geçişin e-postası gidemediyse (seviye sürüyorsa) gönderilir
    const mailLevel = notify ?? (level !== 0 && level === prev.level && !prev.mailed ? level : null);
    let mail: "sent" | "none" | "error" = "none";
    if (notify) await logActivity(null, "Veritabanı kotası uyarısı", `${quotaPctText(pct)} · ${quotaUsageText(bytes, mb)} · %${notify} eşiği geçildi`);
    if (mailLevel) {
      const day = (since ?? now.toISOString()).slice(0, 10);
      mail = await send([{ key: `db-kota:${mailLevel}:${day}`, ...quotaMessage(mailLevel, bytes, mb) }], now).catch((e: Error) => {
        console.error("[kota] e-posta gönderilemedi", e);
        return "error" as const;
      });
    }
    // "none" (e-posta kapalı, alıcı yok, canlı değil) yeniden denenmez: zil uyarısı zaten durur
    const mailed = mailLevel ? mail !== "error" : level === 0 ? true : prev.mailed;
    await saveDbQuotaState(db, { level, since, mailed, bytes, quotaMb: mb, checkedAt: now.toISOString() });
    return { status: "ok", pct, level, notified: notify, mail };
  } catch (e) {
    console.error("[kota] denetlenemedi", e);
    return { status: "error", error: (e as Error).message || "bilinmeyen hata" };
  }
}

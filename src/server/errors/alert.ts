// Kritik hatanın e-postası (docs/HATA-KAYDI.md › E-posta): sunucuda (sayfa, API yolu, sunucu eylemi) bir hata yazılınca
// yöneticilere sistem uyarısı e-postası, günde (İstanbul) en çok bir kez. Mevcut sistem uyarısı altyapısıyla
// (src/server/jobs/alerts.ts › sendSystemEmail: yalnız canlıda, e-posta açık ve Resend kuruluysa, sabah e-postasının
// etkin alıcılarına, personel ve pasif hesap düşer). Hata kaydı bu modülü yalnız kritik hata yazılınca yükler.

import { eq } from "drizzle-orm";

import { alertItem, trDay, type CleanEntry } from "@/lib/error-log";
import type { EmailProblem } from "@/lib/job-health";
import { getDb, type DB } from "@/server/db";
import * as s from "@/server/db/schema";
import { isProductionRuntime, sendSystemEmail } from "@/server/jobs/alerts";
import { ERROR_LOG_ABOUT } from "@/server/notify/digest-template";

type SendResult = "sent" | "none" | "error";

/** Sunucu örneğinin hafızası: bugün bir daha denenmesin (ya da "error"dan sonra 10 dakika) */
const memo = globalThis as unknown as { __lafErrorAlert?: { day: string; retryAt: number } };
const RETRY_MS = 10 * 60_000;

/**
 * Günün ilk kritik hatasında e-posta. Önce `notification_log` anahtarı (`hata-kaydi:<gün>`) alınır: aynı gün ikinci
 * hata, başka bir sunucu örneğinde de olsa, e-posta göndermez. Gönderilemezse ya da gönderilecek yer yoksa anahtar
 * bırakılır (gönderim hatasında 10 dakika sonra, sonraki hatayla yeniden denenir). `send`, `production` ve `db` testte.
 */
export async function sendCriticalAlert(
  e: CleanEntry,
  now = new Date(),
  opts: { db?: DB; production?: boolean; send?: (items: EmailProblem[], now: Date) => Promise<SendResult> } = {},
): Promise<SendResult | "done" | "skip"> {
  if (!(opts.production ?? isProductionRuntime())) return "none";
  const day = trDay(now);
  const m = memo.__lafErrorAlert;
  if (m && m.day === day && now.getTime() < m.retryAt) return "skip";
  const db = opts.db ?? getDb();
  const item = alertItem(e, now);
  const claimed = await db
    .insert(s.notificationLog)
    .values({ key: item.key, subject: item.title, ok: true })
    .onConflictDoNothing()
    .returning({ id: s.notificationLog.id });
  if (!claimed.length) {
    memo.__lafErrorAlert = { day, retryAt: Number.POSITIVE_INFINITY };
    return "done";
  }
  const send = opts.send ?? ((items: EmailProblem[], at: Date) => sendSystemEmail(items, at, ERROR_LOG_ABOUT));
  const res: SendResult = await send([item], now).catch(() => "error" as const);
  if (res !== "sent") await db.delete(s.notificationLog).where(eq(s.notificationLog.key, item.key));
  memo.__lafErrorAlert = { day, retryAt: res === "error" ? now.getTime() + RETRY_MS : Number.POSITIVE_INFINITY };
  return res;
}

/** Testler için: sunucu örneğinin hafızasını siler */
export function resetAlertMemo() {
  delete memo.__lafErrorAlert;
}

// Kritik hatanın e-postası (docs/HATA-KAYDI.md › E-posta): sunucuda (sayfa, API yolu, sunucu eylemi) bir hata yazılınca
// yöneticilere sistem uyarısı e-postası, günde (İstanbul) en çok bir kez. Mevcut sistem uyarısı altyapısıyla
// (src/server/jobs/alerts.ts › sendSystemEmail: yalnız canlıda, e-posta açık ve Resend kuruluysa, sabah e-postasının
// etkin alıcılarına, personel ve pasif hesap düşer). Hata kaydı bu modülü yalnız kritik hata yazılınca yükler.

import { and, eq, lt } from "drizzle-orm";

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
/** Anahtar "gönderiliyor" diye alınır; bu kadar sonra hâlâ öyleyse (işlev gönderemeden durdu) yeniden alınabilir */
export const PENDING_MS = 5 * 60_000;
export const PENDING = "gönderiliyor";

/**
 * Günün ilk kritik hatasında e-posta. Önce `notification_log` anahtarı (`hata-kaydi:<gün>`) "gönderiliyor" (ok
 * false) diye alınır: aynı gün ikinci hata, başka bir sunucu örneğinde de olsa, e-posta göndermez. Gidince anahtar
 * "gönderildi" (ok) olur; gidemezse ya da gönderilecek yer yoksa bırakılır (gönderim hatasında 10 dakika sonra,
 * sonraki hatayla yeniden denenir). İşlev gönderim sürerken durdurulursa (Vercel dondurdu) anahtar 5 dakika sonra
 * sonraki hatayla yeniden alınır; Resend'in aynı gün anahtarı (`system-<gün>-…`) iki kez göndermeyi önler.
 * `send`, `production` ve `db` testte.
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
  const log = s.notificationLog;
  const claimed = await db
    .insert(log)
    .values({ key: item.key, subject: item.title, ok: false, error: PENDING, sentAt: now })
    .onConflictDoUpdate({
      target: log.key,
      set: { subject: item.title, sentAt: now },
      setWhere: and(eq(log.ok, false), eq(log.error, PENDING), lt(log.sentAt, new Date(now.getTime() - PENDING_MS))),
    })
    .returning({ id: log.id });
  if (!claimed.length) {
    // Gitti: bugün bir daha sorulmaz. Başka örnekte gönderiliyor: o takılırsa 5 dakika sonra yeniden alınabilir
    const [held] = await db.select({ ok: log.ok, at: log.sentAt }).from(log).where(eq(log.key, item.key)).limit(1);
    memo.__lafErrorAlert = { day, retryAt: held && !held.ok ? held.at.getTime() + PENDING_MS : Number.POSITIVE_INFINITY };
    return "done";
  }
  const send = opts.send ?? ((items: EmailProblem[], at: Date) => sendSystemEmail(items, at, ERROR_LOG_ABOUT));
  const res: SendResult = await send([item], now).catch(() => "error" as const);
  if (res === "sent") await db.update(log).set({ ok: true, error: null }).where(eq(log.key, item.key));
  else await db.delete(log).where(eq(log.key, item.key));
  memo.__lafErrorAlert = { day, retryAt: res === "error" ? now.getTime() + RETRY_MS : Number.POSITIVE_INFINITY };
  return res;
}

/** Testler için: sunucu örneğinin hafızasını siler */
export function resetAlertMemo() {
  delete memo.__lafErrorAlert;
}

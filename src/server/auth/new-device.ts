import "server-only";

import { and, desc, eq, gte } from "drizzle-orm";
import { after } from "next/server";

import { alertsNewDevice, maskIp, NEW_DEVICE_ACTION, NEW_DEVICE_BELL_DAYS, newDeviceBell, newDeviceDetail, userAgentLabel } from "@/lib/admin-security";
import { dateTimeTR } from "@/lib/format";
import type { PanelNotification } from "@/server/actions/notifications";
import { logActivity } from "@/server/actions/log";
import { appUrl } from "@/server/auth/tokens";
import { getDb, schema as s } from "@/server/db";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";

import { renderNewDeviceNotice, SESSIONS_HREF } from "./new-device-notice";
import { clientIp } from "./rate-limit";

/**
 * Yeni cihazdan başarılı giriş (src/lib/admin-security.ts; docs/DEPLOY.md › 6a): işlem geçmişine "Yeni cihazdan giriş"
 * yazılır (zil bunu okur, sahibi de İşlem geçmişi'nde görür) ve hesabın adresine e-posta gider. Saklanan yalnız
 * tarayıcı / işletim sistemi adı ve kısaltılmış IP; tam IP ve tarayıcı kimliği hiçbir yere yazılmaz. E-posta yanıttan
 * sonra (after) gider, girişi bekletmez; Resend kurulu değilse yalnız zil ve işlem geçmişi. Hiçbir hata girişi bozmaz.
 */
export async function noteNewDevice(user: { id: number; name: string; email: string; role: string }, h: { get(name: string): string | null }): Promise<void> {
  if (!alertsNewDevice(user)) return;
  const at = new Date();
  const detail = newDeviceDetail({ device: userAgentLabel(h.get("user-agent")), ip: maskIp(clientIp(h)) });
  // logActivity kendi hatasını yutar (günlüğe yazar)
  await logActivity({ id: user.id, name: user.name }, NEW_DEVICE_ACTION, detail);
  if (!isEmailConfigured()) return;
  try {
    after(() => sendNewDeviceEmail(user, detail, at));
  } catch {
    // İstek dışında (betik, test) e-posta gönderilmez; giriş bozulmaz
  }
}

/** Uyarı e-postası hesabın kendi adresine (Resend; gönderen Ödemeler & hatırlatıcılar › Gönderim ayarları). Hata fırlatmaz */
export async function sendNewDeviceEmail(user: { id: number; name: string; email: string }, detail: string, at: Date): Promise<boolean> {
  try {
    const settings = await loadNotifySettings();
    const mail = renderNewDeviceNotice({ name: user.name, detail, at, base: appUrl() });
    const res = await sendEmail({ from: resolveFrom(settings.from), to: [user.email], ...mail, idempotencyKey: `yeni-cihaz-${user.id}-${at.getTime()}` });
    if (!res.ok) console.error("[giriş] yeni cihaz e-postası gitmedi:", res.error);
    return res.ok;
  } catch (e) {
    console.error("[giriş] yeni cihaz e-postası", e);
    return false;
  }
}

/**
 * Zilde "Yeni cihazdan giriş" (Sistem başlığı): kişinin kendi hesabına son NEW_DEVICE_BELL_DAYS günde yeni cihazdan
 * yapılan girişler, en yenisi üstte, en çok 3 satır; Hesabım › Oturumlar'a götürür. Kimlik işlem geçmişi satırından:
 * okununca okunmuş kalır, yeni giriş yeni satırdır.
 */
export async function newDeviceBellRows(user: { id: number; role: string }, now: Date = new Date()): Promise<PanelNotification[]> {
  if (!alertsNewDevice(user)) return [];
  const since = new Date(now.getTime() - NEW_DEVICE_BELL_DAYS * 86_400_000);
  const rows = await getDb()
    .select({ id: s.activityLog.id, at: s.activityLog.at, detail: s.activityLog.detail })
    .from(s.activityLog)
    .where(and(eq(s.activityLog.userId, user.id), eq(s.activityLog.action, NEW_DEVICE_ACTION), gte(s.activityLog.at, since)))
    .orderBy(desc(s.activityLog.at))
    .limit(3);
  return rows.map((r) => {
    const b = newDeviceBell({ id: r.id, detail: r.detail, at: dateTimeTR(r.at).replace(/ /g, " ") });
    return { id: b.id, kind: "warning", title: b.title, body: b.body, timeLabel: "", unread: true, href: SESSIONS_HREF, group: "sistem" };
  });
}

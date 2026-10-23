import "server-only";

import { appUrl } from "@/server/auth/tokens";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";

import { renderConnectedNotice } from "./notice";

/**
 * Yeni Claude bağlantısının e-postası, yöneticinin kendi adresine (onaydan sonra after() ile; yönlendirmeyi
 * bekletmez). Resend kurulu değilse gönderilmez. Aynı kod için ikinci kez gitmez (Resend tekil anahtarı).
 */
export async function sendConnectedNotice(me: { name: string; email: string }, app: { label: string; host: string }, codeId: number, at: Date): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const settings = await loadNotifySettings();
    const mail = renderConnectedNotice({ name: me.name, label: app.label, host: app.host, at, base: appUrl() });
    const res = await sendEmail({ from: resolveFrom(settings.from), to: [me.email], ...mail, idempotencyKey: `mcp-grant-${codeId}` });
    if (!res.ok) console.error("[mcp] bağlantı e-postası gitmedi:", res.error);
  } catch (e) {
    console.error("[mcp] bağlantı e-postası", e);
  }
}

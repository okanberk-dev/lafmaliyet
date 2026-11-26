// "server-only" yok: e-postanın şablonu saftır (tests/yonetici-guvenlik.test.ts sınar); gönderen src/server/auth/new-device.ts.

import { NEW_DEVICE_ADVICE } from "@/lib/admin-security";
import { dateTimeTR } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { emailLayout, esc, FONT } from "@/server/notify/digest-template";

/** Oturumlar kartı (Hesabım): diğer cihazlardaki oturumlar buradan kapatılır */
export const SESSIONS_HREF = "/panel/hesap#oturumlar";

/**
 * "Yeni cihazdan giriş" e-postası (hesabın kendi adresine): ne zaman, hangi tarayıcı ve kısaltılmış IP; kendisi
 * değilse ne yapacağı. İşlemsel bir güvenlik bildirimi: hatırlatma e-postalarının açık/kapalı ayarına bağlı değil.
 * Tam IP ve tarayıcı kimliği e-postada da yoktur (src/lib/admin-security.ts).
 */
export function renderNewDeviceNotice(i: { name: string; detail: string; at: Date; base: string }) {
  const subject = "Hesabınıza yeni bir cihazdan giriş yapıldı";
  const link = `${i.base}${SESSIONS_HREF}`;
  const when = dateTimeTR(i.at).replace(/ /g, " ");
  const first = i.name.trim().split(/\s+/)[0] || "Merhaba";
  const lead = `${first}, ${when} itibarıyla L'Affogato panelindeki hesabınıza daha önce giriş yapılmamış bir tarayıcıdan girildi${i.detail ? `: ${i.detail}` : ""}.`;
  const ok = "Giriş sizinse bir şey yapmanız gerekmez.";
  const p = `margin:12px 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:#3f3f46`;
  const html = emailLayout({
    subject,
    preheader: i.detail || "Daha önce giriş yapılmamış bir tarayıcı",
    brandSub: "Güvenlik bildirimi",
    today: todayTR(i.at),
    footer: "Bu e-posta, hesabınıza yeni bir cihazdan giriş yapıldığı için hesabınızın adresine gönderildi.",
    card: `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a;font-weight:600">Yeni cihaz</div>
    <h1 style="margin:4px 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(subject)}</h1>
    <p style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;color:#3f3f46">${esc(lead)}</p>
    <p style="${p}">${esc(ok)}</p>
    <p style="${p}">${esc(NEW_DEVICE_ADVICE)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${esc(link)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Oturumlarım</a>
      </td></tr>
    </table>`,
  });
  return { subject, html, text: [subject, "", lead, ok, NEW_DEVICE_ADVICE, "", `Oturumlarım: ${link}`].join("\n") };
}

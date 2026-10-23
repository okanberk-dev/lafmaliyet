// "server-only" yok: e-postanın şablonu saftır (tests/claude-baglanti.test.ts sınar); gönderen src/server/mcp/notify.ts.

import { dateTimeTR } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { emailLayout, esc, FONT } from "@/server/notify/digest-template";

/** Bağlı uygulamalar kartı (Hesabım) */
export const CONNECTIONS_HREF = "/panel/hesap#bagli-uygulamalar";

/**
 * Yeni bağlantı e-postası (yöneticinin kendi adresine): ne zaman, hangi uygulama ve bunu kendisi yapmadıysa ne yapacağı.
 * İşlemsel bir güvenlik bildirimi; hatırlatma e-postalarının açık/kapalı ayarına bağlı değil.
 */
export function renderConnectedNotice(i: { name: string; label: string; host: string; at: Date; base: string }) {
  const subject = "Panelinize Claude bağlandı";
  const link = `${i.base}${CONNECTIONS_HREF}`;
  const when = dateTimeTR(i.at).replace(/\u00a0/g, " ");
  const app = i.label === i.host ? i.host : `${i.label} (${i.host})`;
  const body = `${i.name}, ${when} itibarıyla ${app} L'Affogato panelinizi salt okunur olarak okuyabiliyor. Bunu siz yapmadıysanız hemen Hesabım › Bağlı uygulamalar'dan kaldırın ve parolanızı değiştirin: ${link}`;
  const html = emailLayout({
    subject,
    preheader: `${app} panelinizi salt okunur olarak okuyabiliyor`,
    brandSub: "Güvenlik bildirimi",
    today: todayTR(i.at),
    footer: "Bu e-posta, panelinize yeni bir uygulama bağlandığı için hesabınızın adresine gönderildi.",
    card: `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a;font-weight:600">Claude bağlantısı</div>
    <h1 style="margin:4px 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(subject)}</h1>
    <p style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;color:#3f3f46">${esc(i.name)}, ${esc(when)} itibarıyla <strong>${esc(app)}</strong> L'Affogato panelinizi salt okunur olarak okuyabiliyor.</p>
    <p style="margin:12px 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:#3f3f46">Bunu siz yapmadıysanız hemen Hesabım › Bağlı uygulamalar'dan kaldırın ve parolanızı değiştirin.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${esc(link)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Bağlı uygulamalar</a>
      </td></tr>
    </table>`,
  });
  return { subject, html, text: [subject, "", body].join("\n") };
}

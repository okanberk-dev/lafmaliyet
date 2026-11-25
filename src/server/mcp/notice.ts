// "server-only" yok: e-postanın şablonu saftır (tests/claude-baglanti.test.ts sınar); gönderen src/server/mcp/notify.ts.

import { button, C, callout, emailShell, esc, FONT, heading } from "@/lib/email-kit";
import { dateTimeTR } from "@/lib/format";
import { longDateTR, todayTR } from "@/lib/reminders";

/** Bağlı uygulamalar kartı (Hesabım) */
export const CONNECTIONS_HREF = "/panel/hesap#bagli-uygulamalar";

/**
 * Yeni bağlantı e-postası (yöneticinin kendi adresine): ne zaman, hangi uygulama ve bunu kendisi yapmadıysa ne yapacağı.
 * İşlemsel bir güvenlik bildirimi; hatırlatma e-postalarının açık/kapalı ayarına bağlı değil. E-postaların ortak
 * tasarımı (src/lib/email-kit.ts); ne yapılacağı turuncu uyarı kutusunda, ana eylem "Bağlı uygulamalar" düğmesi.
 */
export function renderConnectedNotice(i: { name: string; label: string; host: string; at: Date; base: string }) {
  const subject = "Panelinize Claude bağlandı";
  const link = `${i.base}${CONNECTIONS_HREF}`;
  const when = dateTimeTR(i.at).replace(/ /g, " ");
  const app = i.label === i.host ? i.host : `${i.label} (${i.host})`;
  const body = `${i.name}, ${when} itibarıyla ${app} L'Affogato panelinizi salt okunur olarak okuyabiliyor. Bunu siz yapmadıysanız hemen Hesabım › Bağlı uygulamalar'dan kaldırın ve parolanızı değiştirin: ${link}`;
  // Uygulamanın adı kalın (email-kit'in para()'sı düz metin alır: aynı ölçülerle yerel paragraf)
  const lead = `<p style="margin:16px 0 0;font-family:${FONT};font-size:16px;line-height:25px;color:${C.soft};word-break:break-word">${esc(`${i.name}, ${when} itibarıyla `)}<strong style="font-weight:600;color:${C.ink}">${esc(app)}</strong>${esc(" L'Affogato panelinizi salt okunur olarak okuyabiliyor.")}</p>`;
  const html = emailShell({
    subject,
    preheader: `${app} panelinizi salt okunur olarak okuyabiliyor`,
    brandSubHtml: "Güvenlik bildirimi",
    dateLabel: longDateTR(todayTR(i.at)),
    footer: "Bu e-posta, panelinize yeni bir uygulama bağlandığı için hesabınızın adresine gönderildi.",
    cardHtml: [
      heading(subject, { eyebrow: "Claude bağlantısı" }),
      lead,
      callout("warn", ["Bunu siz yapmadıysanız hemen Hesabım › Bağlı uygulamalar'dan kaldırın ve parolanızı değiştirin."], { top: 20 }),
      button(link, "Bağlı uygulamalar", { top: 26 }),
    ].join("\n"),
  });
  return { subject, html, text: [subject, "", body].join("\n") };
}

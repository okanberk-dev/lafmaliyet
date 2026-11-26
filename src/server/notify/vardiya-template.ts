/**
 * "Vardiyanız değişti" e-postası (saf; "server-only" yok, tests/vardiya-bildirim.test.ts sınar): bildirimi açık cihazı
 * olmayan personele, vardiyası değişince (kurallar src/lib/vardiya-bildirim.ts, gönderen src/server/vardiya/notify.ts;
 * docs/VARDIYA.md › Bildirimler). Gün gün eski → yeni saat ve "Vardiyayı aç" düğmesi. Tutar yok. Kabuk sabah
 * e-postasıyla aynı (emailLayout).
 */

import { dateTR } from "@/lib/format";

import { APP_URL, emailLayout, esc, FONT } from "./digest-template";

export const SHIFT_MAIL_FOOTER = "Bu e-posta vardiyası değişen personele gönderilir. Bildirimleri telefonunuzda açarsanız (Hatırlatıcılarım › Bu cihazda uyarılar) e-posta yerine bildirim gelir.";

export function renderShiftChange(o: { name: string; title: string; branchName: string; week: string; lines: readonly string[]; url: string }, today: string) {
  const subject = o.title;
  const link = `${APP_URL}${o.url}`;
  const first = o.name.trim().split(/\s+/)[0] || "Merhaba";
  const card = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-family:${FONT}">
  <div style="font-size:13px;line-height:18px;font-weight:600;color:#71717a">${esc(o.branchName)} · ${esc(o.week)}</div>
  <h1 style="margin:4px 0 8px;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(subject)}</h1>
  <div style="font-size:15px;line-height:22px;color:#3f3f46">${esc(first)}, planınızda şu günler değişti:</div>
  <ul style="margin:10px 0 0;padding-left:18px;font-size:15px;line-height:23px;color:#171717">${o.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px"><tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
    <a href="${esc(link)}" style="display:block;padding:14px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Vardiyayı aç</a>
  </td></tr></table>
</td></tr></table>`;
  const html = emailLayout({ subject, preheader: o.lines.slice(0, 2).join(" · "), brandSub: "Vardiya", today, card, footer: SHIFT_MAIL_FOOTER });
  const text = [`L'Affogato · ${dateTR(today)}`, subject, `${o.branchName} · ${o.week}`, "", `${first}, planınızda şu günler değişti:`, ...o.lines.map((l) => `- ${l}`), "", `Vardiyayı aç: ${link}`, "", SHIFT_MAIL_FOOTER].join("\n");
  return { subject, html, text };
}

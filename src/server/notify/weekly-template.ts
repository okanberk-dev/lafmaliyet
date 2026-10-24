/**
 * Haftalık özetin e-postası (saf; "server-only" yok, tests/haftalik-ozet.test.ts sınar): sabah e-postasıyla aynı kabuk
 * (emailLayout), satır içi stiller ve tablolar, açık tema, en çok 560 px, telefonda tek sütun. Maddeler numaralı; başlık
 * ve "… →" bağlantısı aynı panel ekranını açar (Outlook blok bağlantıyı tanımaz, iki ayrı <a>). Bütün kullanıcı metni
 * (ürün, hammadde, kanal adı) esc()'ten geçer. Veriyi src/server/weekly/collect.ts toplar, gönderim send.ts'te.
 */

import type { WeeklySummary } from "@/lib/weekly/core";
import { failedText, headlineOf, subjectOf, weekRangeText } from "@/lib/weekly/text";

import { APP_URL, emailLayout, esc, FONT } from "./digest-template";

/** E-postanın alt notu (kabuğun alıcı notunun yerine) */
export const WEEKLY_FOOTER = "Bu özet her pazartesi panel yöneticilerine gider. Kapatmak için: Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet.";
export const WEEKLY_NOTE = "Maddeler kasanıza etkisine göre sıralandı; ≈ işaretli tutarlar tahmindir.";
const QUIET_LINE = "Paneldeki kontrollerde bu hafta öne çıkan bir şey yok.";
const SAMPLE_LINE = "Bu bir örnektir; asıl özet pazartesi sabahı gider.";

/**
 * Bağlantı yalnız panelin bir yolu olabilir (harf, rakam, tire; sorgu ve # serbest); başka her adres panelin girişine
 * düşer (sabah e-postasının kutu kuralıyla aynı, digest-template.ts boxUrl)
 */
const PANEL_PATH = /^\/panel(?:\/[\w-]+)*\/?(?:[?#]\S*)?$/;
export const weeklyUrl = (href: string) => `${APP_URL}${PANEL_PATH.test(href) ? href : "/panel"}`;

export function renderWeekly(s: WeeklySummary, o: { today: string; sample?: boolean }): { subject: string; html: string; text: string } {
  const sample = Boolean(o.sample);
  const range = weekRangeText(s.week.lastFrom, s.week.lastTo);
  const subject = subjectOf(s, sample);
  const headline = headlineOf(s);
  const n = s.items.length;
  const preheader = n ? `${range} · ${n} konu` : `${range} · dikkat isteyen bir şey yok`;
  const failed = failedText(s.failed);
  const note = [n ? WEEKLY_NOTE : null, failed].filter(Boolean).join(" ");
  const eyebrow = `${sample ? "Örnek · " : ""}Haftalık özet · ${range}`;
  const panel = `${APP_URL}/panel`;

  const rows = s.items
    .map((item, i) => {
      const url = esc(weeklyUrl(item.href));
      return `<tr>
  <td width="28" style="width:28px;padding:12px 6px 12px 0;border-top:1px solid #e4e4e7;vertical-align:top">
    <table role="presentation" width="22" cellspacing="0" cellpadding="0" border="0"><tr><td width="22" height="22" align="center" style="width:22px;height:22px;border-radius:11px;background:#f4f4f5;color:#3f3f46;font-family:${FONT};font-size:12px;line-height:22px;font-weight:600">${i + 1}</td></tr></table>
  </td>
  <td style="padding:12px 0;border-top:1px solid #e4e4e7;vertical-align:top;font-family:${FONT};word-break:break-word">
    <a href="${url}" style="font-size:15px;line-height:20px;font-weight:600;color:#171717;text-decoration:none">${esc(item.title)}</a>
    ${item.detail ? `<div style="font-size:13px;line-height:18px;color:#71717a;margin-top:2px">${esc(item.detail)}</div>` : ""}
    <div style="margin-top:4px"><a href="${url}" style="font-size:13px;line-height:18px;font-weight:600;color:#171717;text-decoration:underline">${esc(item.action)} →</a></div>
  </td>
</tr>`;
    })
    .join("\n");

  const html = emailLayout({
    subject,
    preheader,
    brandSub: "Haftalık özet",
    today: o.today,
    footer: WEEKLY_FOOTER,
    card: `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a">${esc(eyebrow)}</div>
    <h1 style="margin:4px 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(headline)}</h1>
    ${sample ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:18px;color:#c2410c">${esc(SAMPLE_LINE)}</p>` : ""}
    ${n ? "" : `<p style="margin:0 0 10px;font-family:${FONT};font-size:14px;line-height:20px;color:#3f3f46">${esc(QUIET_LINE)}</p>`}
    ${s.lines.map((l) => `<div style="font-family:${FONT};font-size:13px;line-height:19px;color:#3f3f46;margin-top:2px">${esc(l)}</div>`).join("\n    ")}
    ${n ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:14px">${rows}</table>` : ""}
    ${note ? `<p style="margin:12px 0 0;font-family:${FONT};font-size:12px;line-height:17px;color:#a1a1aa">${esc(note)}</p>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${panel}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Paneli aç</a>
      </td></tr>
    </table>`,
  });

  const text = [
    `L'Affogato · ${eyebrow}`,
    subject,
    ...(sample ? [SAMPLE_LINE] : []),
    ...(n ? [] : [QUIET_LINE]),
    ...(s.lines.length ? ["", ...s.lines] : []),
    ...s.items.flatMap((item, i) => ["", `${i + 1}. ${item.title}`, ...(item.detail ? [`   ${item.detail}`] : []), `   ${item.action}: ${weeklyUrl(item.href)}`]),
    ...(note ? ["", note] : []),
    "",
    `Paneli aç: ${panel}`,
  ].join("\n");

  return { subject, html, text };
}

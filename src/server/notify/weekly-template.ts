/**
 * Haftalık özetin e-postası (saf; "server-only" yok, tests/haftalik-ozet.test.ts sınar): e-postaların ortak tasarımı
 * (src/lib/email-kit.ts: ferah kart, en çok 600 px, telefonda tek sütun). Maddeler numaralı; başlık ve "… →" bağlantısı
 * aynı panel ekranını açar (Outlook blok bağlantıyı tanımaz, iki ayrı <a>). Bütün kullanıcı metni (ürün, hammadde, kanal
 * adı) esc()'ten geçer. Veriyi src/server/weekly/collect.ts toplar, gönderim send.ts'te.
 */

import { button, C, callout, emailShell, esc, FONT, heading, para, TABLE } from "@/lib/email-kit";
import { longDateTR } from "@/lib/reminders";
import type { WeeklyItem, WeeklySummary } from "@/lib/weekly/core";
import { failedText, headlineOf, subjectOf, weekRangeText } from "@/lib/weekly/text";

import { APP_URL } from "./digest-template";

/** E-postanın alt notu (kabuğun alıcı notunun yerine) */
export const WEEKLY_FOOTER = "Bu özet her pazartesi panel yöneticilerine gider. Kapatmak için: Ödemeler › E-posta bildirimleri › Haftalık özet.";
export const WEEKLY_NOTE = "Maddeler kasanıza etkisine göre sıralandı; ≈ işaretli tutarlar tahmindir.";
const QUIET_LINE = "Paneldeki kontrollerde bu hafta öne çıkan bir şey yok.";
const SAMPLE_LINE = "Bu bir örnektir; asıl özet pazartesi sabahı gider.";

/**
 * Bağlantı yalnız panelin bir yolu olabilir (harf, rakam, tire; sorgu ve # serbest); başka her adres panelin girişine
 * düşer (sabah e-postasının kutu kuralıyla aynı, digest-template.ts boxUrl)
 */
const PANEL_PATH = /^\/panel(?:\/[\w-]+)*\/?(?:[?#]\S*)?$/;
export const weeklyUrl = (href: string) => `${APP_URL}${PANEL_PATH.test(href) ? href : "/panel"}`;

/**
 * Numaralı madde (email-kit'te numaralı liste yok; kitin renk ve yazısıyla): solda sıra karosu, sağda başlık
 * (bağlantı), açıklama ve "… →" bağlantısı. İki bağlantı aynı adresi açar; metin sarılır (telefonda taşmaz)
 */
function itemRow(item: WeeklyItem, i: number): string {
  const url = esc(weeklyUrl(item.href));
  const border = `border-top:1px solid ${i ? C.hair : C.line};`;
  return `<tr>
  <td width="42" style="${border}width:42px;padding:18px 14px 18px 0;vertical-align:top">
    <table role="presentation" width="28" cellspacing="0" cellpadding="0" border="0"><tr><td width="28" height="28" align="center" style="width:28px;height:28px;border-radius:14px;background:${C.note};color:${C.soft};font-family:${FONT};font-size:13px;line-height:28px;font-weight:700">${i + 1}</td></tr></table>
  </td>
  <td style="${border}padding:20px 0 18px;vertical-align:top;font-family:${FONT};word-break:break-word">
    <a href="${url}" style="font-size:16px;line-height:23px;font-weight:600;color:${C.ink};text-decoration:none">${esc(item.title)}</a>${
      item.detail ? `\n    <div style="font-size:14px;line-height:21px;color:${C.mute};margin-top:4px">${esc(item.detail)}</div>` : ""
    }
    <div style="margin-top:10px"><a href="${url}" style="font-size:14px;line-height:21px;font-weight:600;color:${C.ink};text-decoration:underline">${esc(item.action)} →</a></div>
  </td>
</tr>`;
}

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

  // Sakin hafta yeşil kutuda; bir kaynak okunamadıysa nötr (okunamayan turuncu kutuda ayrıca söylenir). Haftanın
  // satırları (ciro, tahmin) gri kutuda, aralarında boşlukla
  const linesHtml = s.lines.map((l, i) => `<div style="margin-top:${i ? 8 : 0}px">${esc(l)}</div>`).join("");
  const cardHtml = [
    heading(headline, { eyebrow }),
    sample ? callout("warn", [SAMPLE_LINE], { top: 18 }) : "",
    n ? "" : callout(failed ? "neutral" : "good", [QUIET_LINE], { top: 18 }),
    s.lines.length ? callout("neutral", [], { html: linesHtml, top: sample || !n ? 10 : 18 }) : "",
    n ? `<table ${TABLE} style="border-collapse:collapse;margin-top:24px">${s.items.map(itemRow).join("\n")}</table>` : "",
    n ? para(WEEKLY_NOTE, { top: 6, muted: true, size: 13 }) : "",
    failed ? callout("warn", [failed], { top: n ? 14 : 10 }) : "",
    button(panel, "Paneli aç", { top: 28 }),
  ]
    .filter(Boolean)
    .join("\n");

  const html = emailShell({
    subject,
    preheader,
    brandSubHtml: "Haftalık özet",
    dateLabel: longDateTR(o.today),
    cardHtml,
    footer: WEEKLY_FOOTER,
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

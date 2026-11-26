/**
 * Haftalık özetin e-postası (saf; "server-only" yok, tests/haftalik-ozet.test.ts sınar): sabah e-postasıyla aynı e-posta
 * kiti (src/lib/email; docs/BILDIRIMLER.md › E-posta tasarımı), açık ve koyu tema, telefonda tek sütun. Üstte başlık,
 * geçen haftanın satırları (kasa cirosu) gri kutuda; maddeler numaralı, başlık ve "… →" bağlantısı aynı panel ekranını
 * açar (Outlook blok bağlantıyı tanımaz, iki ayrı <a>). Bütün kullanıcı metni (ürün, hammadde, kanal adı) esc()'ten
 * geçer. Veriyi src/server/weekly/collect.ts toplar, gönderim send.ts'te.
 */

import { button, esc, LIGHT, layout, link, list, note, paragraph } from "@/lib/email";
import type { WeeklySummary } from "@/lib/weekly/core";
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

export function renderWeekly(s: WeeklySummary, o: { today: string; sample?: boolean }): { subject: string; html: string; text: string } {
  const sample = Boolean(o.sample);
  const range = weekRangeText(s.week.lastFrom, s.week.lastTo);
  const subject = subjectOf(s, sample);
  const headline = headlineOf(s);
  const n = s.items.length;
  const preheader = n ? `${range} · ${n} konu` : `${range} · dikkat isteyen bir şey yok`;
  const failed = failedText(s.failed);
  const footnote = [n ? WEEKLY_NOTE : null, failed].filter(Boolean).join(" ");
  const eyebrow = `${sample ? "Örnek · " : ""}Haftalık özet · ${range}`;
  const panel = `${APP_URL}/panel`;

  // Madde: başlık (kalın, bağlantı), açıklama (gri), "… →" bağlantısı; maddeler arasında nefes payı (kitin listesi 8 px
  // bırakır, bu maddeler üç satırlık)
  const items = s.items.map((item, i) => {
    const url = weeklyUrl(item.href);
    const title = `<a class="e-link" href="${esc(url)}" style="font-size:16px;line-height:22px;font-weight:600;color:${LIGHT.ink};text-decoration:none">${esc(item.title)}</a>`;
    const detail = item.detail ? `<div class="e-mute" style="margin-top:2px;font-size:14px;line-height:20px;color:${LIGHT.mute}">${esc(item.detail)}</div>` : "";
    const action = `<div style="margin-top:6px;font-size:14px;line-height:20px">${link(url, `${item.action} →`)}</div>`;
    return `<div style="padding-bottom:${i < n - 1 ? 10 : 0}px">${title}${detail}${action}</div>`;
  });

  // Görünüş (src/lib/email): başlık, sakin haftada altında tek cümle; örnekte turuncu not, geçen haftanın satırları gri
  // kutuda, numaralı maddeler, küçük dipnot ve düğme
  const html = layout({
    subject,
    preheader,
    meta: "Haftalık özet",
    date: o.today,
    eyebrow,
    title: headline,
    lead: n ? null : QUIET_LINE,
    body: [
      sample ? note(SAMPLE_LINE, { tone: "warn" }) : null,
      s.lines.length ? note(s.lines) : null,
      n ? list(items, { ordered: true, html: true }) : null,
      footnote ? paragraph(footnote, { small: true }) : null,
      button(panel, "Paneli aç"),
    ],
    footer: WEEKLY_FOOTER,
  });

  const text = [
    `L'Affogato · ${eyebrow}`,
    subject,
    ...(sample ? [SAMPLE_LINE] : []),
    ...(n ? [] : [QUIET_LINE]),
    ...(s.lines.length ? ["", ...s.lines] : []),
    ...s.items.flatMap((item, i) => ["", `${i + 1}. ${item.title}`, ...(item.detail ? [`   ${item.detail}`] : []), `   ${item.action}: ${weeklyUrl(item.href)}`]),
    ...(footnote ? ["", footnote] : []),
    "",
    `Paneli aç: ${panel}`,
  ].join("\n");

  return { subject, html, text };
}

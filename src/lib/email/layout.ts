/**
 * E-postanın kabuğu (saf): <head> (renk şeması, telefon ve koyu tema stilleri, Outlook ayarları), gizli önizleme metni,
 * L'Affogato başlığı, beyaz kart (üst etiket, başlık, gövde) ve alt bilgi. Gövdeyi blocks.ts'in bileşenleri kurar.
 *
 * E-posta istemcilerinin gerçeği: yerleşim tablolarla, her stil satır içinde (inline). <head>'deki <style> yalnız
 * iyileştirir: telefonda (≤ 620 px) kart tam genişlik ve daha az dolgu, büyük rakamlar ve uzun satırlar alt alta; koyu
 * temada panelin koyu renkleri. Gmail, Apple Mail ve iOS Mail <style>'ı okur; okumayan istemcide e-posta açık temada,
 * masaüstü düzeniyle (600 px'e kadar akışkan) görünür. Gmail tanımadığı kuralın bütün bloğunu atabildiği için telefon,
 * koyu tema ve Outlook.com stilleri ayrı <style> bloklarında.
 */

import { longDateTR } from "@/lib/reminders";

import { stack } from "./blocks";
import { esc } from "./html";
import { DARK, DARK_TONES, FONT, LIGHT, PHONE_MAX, SPACE, TONES, type Tone } from "./tokens";

const TONE_KEYS = Object.keys(TONES) as Tone[];

/** Telefon uyarlaması: kart tam genişlik, dolgu 20 px, büyük rakamlar ve uzun satırlar alt alta */
const PHONE_CSS = `@media only screen and (max-width:${PHONE_MAX}px){
.e-wrap{padding:8px 0 24px!important}
.e-head{padding:8px ${SPACE.cardPadPhone}px 14px!important}
.e-foot{padding:18px ${SPACE.cardPadPhone}px 0!important}
.e-card{border-radius:0!important;padding:${SPACE.cardPadPhone + 4}px ${SPACE.cardPadPhone}px ${SPACE.cardPadPhone + 8}px!important}
.e-gap td{height:${SPACE.gapPhone}px!important}
.e-h1{font-size:22px!important;line-height:28px!important}
.e-kpi{display:block!important;width:100%!important;box-sizing:border-box!important}
.e-kpi-gap{display:block!important;width:100%!important;height:10px!important;line-height:10px!important}
.e-kv-s .e-kv-l,.e-kv-s .e-kv-v{display:block!important;width:100%!important;text-align:left!important;box-sizing:border-box!important}
.e-kv-s .e-kv-l{padding-bottom:2px!important;padding-right:0!important}
.e-kv-s .e-kv-v{border-top:0!important;padding-top:0!important;white-space:normal!important}
.e-banner{padding:16px!important}
.e-date{display:none!important}
.e-date-phone{display:block!important;max-height:none!important;overflow:visible!important}
}`;

/** Koyu tema kuralları; `scope` Outlook.com'un [data-ogsc] / [data-ogsb] önekleri için */
function darkRules(scope = ""): string {
  const s = (sel: string) =>
    sel
      .split(",")
      .map((x) => `${scope}${x}`)
      .join(",");
  const rules = [
    `${s(".e-bg")}{background:${DARK.bg}!important;background-color:${DARK.bg}!important}`,
    `${s(".e-card")}{background:${DARK.card}!important;background-color:${DARK.card}!important}`,
    `${s(".e-well")}{background:${DARK.well}!important;background-color:${DARK.well}!important}`,
    `${s(".e-ink")}{color:${DARK.ink}!important}`,
    `${s(".e-soft")}{color:${DARK.soft}!important}`,
    `${s(".e-mute")}{color:${DARK.mute}!important}`,
    `${s(".e-line")}{border-color:${DARK.line}!important}`,
    `${s(".e-tile")}{background:${DARK.tile}!important;background-color:${DARK.tile}!important;color:${DARK.tileInk}!important}`,
    `${s(".e-btn")}{background:${DARK.primary}!important;background-color:${DARK.primary}!important}`,
    `${s(".e-btn a,.e-btn-a")}{color:${DARK.onPrimary}!important}`,
    `${s(".e-link")}{color:${DARK.ink}!important}`,
    ...TONE_KEYS.flatMap((t) => {
      const d = DARK_TONES[t];
      return [
        `${s(`.e-t-${t}`)}{background:${d.bg}!important;background-color:${d.bg}!important;color:${d.ink}!important}`,
        `${s(`.e-tt-${t}`)}{color:${d.title}!important}`,
        `${s(`.e-ti-${t}`)}{color:${d.ink}!important}`,
        `${s(`.e-v-${t}`)}{color:${d.value}!important}`,
        `${s(`.e-m-${t}`)}{background:${d.mark}!important;background-color:${d.mark}!important;color:${d.markInk}!important}`,
      ];
    }),
  ];
  return rules.join("\n");
}

const DARK_CSS = `@media (prefers-color-scheme:dark){\n${darkRules()}\n}`;
/** Outlook.com koyu temada öğelere data-ogsc (yazı) / data-ogsb (zemin) koyar; aynı renkler */
const OUTLOOK_DARK_CSS = `${darkRules("[data-ogsc] ")}\n${darkRules("[data-ogsb] ")}`;

/** <head>'in stilleri; testte ve önizlemede de kullanılabilir */
export const EMAIL_CSS = { phone: PHONE_CSS, dark: DARK_CSS, outlookDark: OUTLOOK_DARK_CSS } as const;

/**
 * Önizleme metninin dolgusu: gelen kutusu önizlemesi gövdedeki ilk yazıya taşmasın (görünmez boşluklar). Ekran
 * okuyucuya ve düz metne girmez
 */
const PREHEADER_FILL = "&#847;&zwnj;&nbsp;".repeat(60);

export interface LayoutOptions {
  /** Belgenin <title>'ı (çoğunlukla konu) */
  subject: string;
  /** Gelen kutusunda konunun yanında görünen gizli önizleme metni; verilmezse yok */
  preheader?: string | null;
  /** Şube adı: başlıkta "L'Affogato · Marina" */
  branch?: string | null;
  /** Başlığın altındaki küçük satır (düz metin): "LafPOS gün sonu · 22 Kasım Pazar 2026" */
  meta?: string | null;
  /** Sağdaki tarih (YYYY-MM-DD ya da hazır metin); telefonda meta satırının altına iner */
  date?: string | null;
  /** Kartın üst etiketi (küçük, gri; düz metin) */
  eyebrow?: string | null;
  /** Üst etiketin tonu (ör. sistem uyarısında kırmızı); verilmezse gri */
  eyebrowTone?: Tone | null;
  /** Kartın başlığı (h1, düz metin) */
  title?: string | null;
  /** Başlığın altındaki paragraf (düz metin) */
  lead?: string | null;
  /**
   * Kartın gövdesi: hazır HTML ya da blokların dizisi (boş, null ve false atlanır). Dizide bloklar arasına eşit boşluk
   * (SPACE.gap; telefonda gapPhone) girer
   */
  body: string | readonly (string | null | undefined | false)[];
  /** Kartın altındaki not (düz metin); null: yok */
  footer?: string | null;
  /** iOS'un telefon numarasını bağlantıya çevirmesi (misafir e-postasında açık); verilmezse kapalı */
  detectPhones?: boolean;
}

/** Sağdaki tarih: YYYY-MM-DD ise "22 Kasım Pazar", değilse olduğu gibi */
const dateText = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? longDateTR(date) : date);

/** L'Af karosu, marka adı, şube, meta satırı ve sağda tarih */
function header(o: LayoutOptions): string {
  const date = o.date ? esc(dateText(o.date)) : "";
  const branch = o.branch ? `<span class="e-mute" style="font-weight:500;color:${LIGHT.mute}"> · ${esc(o.branch)}</span>` : "";
  const meta = o.meta
    ? `<div class="e-mute" style="font-size:13px;line-height:18px;color:${LIGHT.mute};margin-top:2px">${esc(o.meta)}</div>`
    : "";
  const datePhone = date ? `<div class="e-mute e-date-phone" style="display:none;max-height:0;overflow:hidden;font-size:13px;line-height:18px;color:${LIGHT.mute}">${date}</div>` : "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="vertical-align:middle"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td class="e-tile" width="40" height="40" align="center" bgcolor="${LIGHT.tile}" style="width:40px;height:40px;background:${LIGHT.tile};border-radius:12px;color:${LIGHT.tileInk};font-size:13px;line-height:40px;font-weight:700;letter-spacing:-0.02em;text-align:center;vertical-align:middle">L'Af</td>
<td style="padding-left:12px;vertical-align:middle"><div class="e-ink" style="font-size:16px;line-height:22px;font-weight:600;color:${LIGHT.ink}">L'Affogato${branch}</div>${meta}${datePhone}</td>
</tr></table></td>
${date ? `<td class="e-mute e-date" align="right" style="vertical-align:middle;padding-left:12px;font-size:13px;line-height:18px;color:${LIGHT.mute};white-space:nowrap">${date}</td>` : ""}
</tr></table>`;
}

/** Kartın başı: üst etiket, başlık, paragraf (hepsi isteğe bağlı) */
function cardHead(o: LayoutOptions): string {
  const tone = o.eyebrowTone && o.eyebrowTone !== "neutral" ? o.eyebrowTone : null;
  const parts = [
    o.eyebrow
      ? `<div class="${tone ? `e-v-${tone}` : "e-mute"}" style="font-size:13px;line-height:18px;font-weight:600;color:${tone ? TONES[tone].value : LIGHT.mute}">${esc(o.eyebrow)}</div>`
      : "",
    o.title
      ? `<h1 class="e-ink e-h1" style="margin:${o.eyebrow ? 6 : 0}px 0 0;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.02em;color:${LIGHT.ink}">${esc(o.title)}</h1>`
      : "",
    o.lead ? `<p class="e-soft" style="margin:${o.title || o.eyebrow ? 10 : 0}px 0 0;font-size:16px;line-height:24px;color:${LIGHT.soft}">${esc(o.lead)}</p>` : "",
  ].join("");
  return parts;
}

/**
 * E-postanın bütün HTML'i. Örnek:
 *
 *   layout({ subject, preheader: "Z raporu tutuyor · 1.190 ₺", branch: "Marina", meta: "Gün sonu fotoğrafı · 24 Kasım",
 *     body: [statusBanner({ tone: "good", title: "Z raporu tutuyor" }), section("Satış", [["Toplam", "1.190 ₺"]]),
 *       button(link, "Panelde aç")], footer: "Bu e-posta kasa raporu alıcılarına gönderildi." })
 */
export function layout(o: LayoutOptions): string {
  const head = cardHead(o);
  const body = typeof o.body === "string" ? o.body : stack(o.body);
  const card = head && body ? stack([head, body]) : head || body;
  const footer = o.footer
    ? `<tr><td class="e-mute e-foot" align="center" style="padding:20px 24px 0;font-size:13px;line-height:20px;color:${LIGHT.mute};text-align:center">${esc(o.footer)}</td></tr>`
    : "";
  const preheader = o.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(o.preheader)}${PREHEADER_FILL}</div>`
    : "";
  return `<!doctype html>
<html lang="tr" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="${o.detectPhones ? "" : "telephone=no,"}date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(o.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if mso]><style>table,td,div,p,a,span,h1{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;width:100%!important}
table{border-collapse:collapse}
a{text-decoration:none}
${PHONE_CSS}
</style>
<style>
${DARK_CSS}
</style>
<style>
${OUTLOOK_DARK_CSS}
</style>
</head>
<body class="e-bg" style="margin:0;padding:0;width:100%;background:${LIGHT.bg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;font-family:${FONT}">
${preheader}<table role="presentation" class="e-bg" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${LIGHT.bg}" style="background:${LIGHT.bg};font-family:${FONT};font-size:16px;line-height:24px;color:${LIGHT.ink}">
<tr><td class="e-wrap" align="center" style="padding:32px 16px 40px">
<!--[if mso]><table role="presentation" width="${SPACE.width}" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:${SPACE.width}px;margin:0 auto">
<tr><td class="e-head" style="padding:0 8px 16px">${header(o)}</td></tr>
<tr><td class="e-card" bgcolor="${LIGHT.card}" style="background:${LIGHT.card};border-radius:${SPACE.radius}px;padding:${SPACE.cardPad}px;font-family:${FONT};color:${LIGHT.ink}">
${card}
</td></tr>
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

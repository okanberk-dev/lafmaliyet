/**
 * E-postaların ortak tasarımı (saf; "server-only" yok). Bütün e-postalar (gün sonu, kasa raporu, sabah ve haftalık özet,
 * kontrol, karaoke, davet ve erişim) aynı kabuğu ve parçaları kullanır: tek yerden ferah aralıklar, büyük ve okunur yazı,
 * telefonda tek sütun. Renkler panelin açık temasından (docs/TASARIM.md §1).
 *
 * E-posta istemcileri için kurallar:
 * - Düzen tablo; her stil satır içi. Head'deki <style> yalnız telefon (≤ 620 px) ayarı içindir: Gmail, Apple Mail ve
 *   Outlook mobil okur; okumayan istemci masaüstü düzenini (zaten akışkan, en çok 600 px) gösterir.
 * - Outlook masaüstü max-width'i bilmez: kart koşullu 600 px'lik tabloyla sarılır.
 * - Yalnız açık renk (`color-scheme: light`): Apple Mail kendi koyu dönüşümünü yapmaz, uyarı kutularının rengi bozulmaz.
 * - Parçalar hazır (kaçışlı) HTML döndürür; düz metin alan her argüman burada kaçışlanır (`esc`). "…Html" adlı argümanlar
 *   hazır HTML'dir, çağıran kaçışlar.
 */

/** HTML'e giden her kullanıcı metni buradan geçer */
export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,Roboto,Helvetica,Arial,sans-serif";

/** Panelin açık teması (docs/TASARIM.md §1) */
export const C = {
  canvas: "#f6f6f7",
  card: "#ffffff",
  ink: "#171717",
  soft: "#3f3f46",
  mute: "#71717a",
  quiet: "#a1a1aa",
  line: "#e4e4e7",
  hair: "#efeff1",
  note: "#f5f5f5",
  lime: "#c0f21e",
  goodBg: "#f0fdf4",
  goodInk: "#166534",
  warnBg: "#fff7ed",
  warnInk: "#9a3412",
  badBg: "#fef2f2",
  badInk: "#b91c1c",
  infoBg: "#eff6ff",
  infoInk: "#1e40af",
} as const;

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

/** Tonun kutu zemini ve mürekkebi (kutudaki metin AA: docs/TASARIM.md "Uyarı kutusunun mürekkebi") */
export const TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: C.note, fg: C.soft, dot: C.quiet },
  good: { bg: C.goodBg, fg: C.goodInk, dot: "#16a34a" },
  warn: { bg: C.warnBg, fg: C.warnInk, dot: "#ea580c" },
  bad: { bg: C.badBg, fg: C.badInk, dot: "#dc2626" },
  info: { bg: C.infoBg, fg: C.infoInk, dot: "#2563eb" },
};

/** Sunum tablosunun açılışı (her istemcide boşluksuz, kenarlıksız) */
export const TABLE = `role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"`;

const NUM = "font-variant-numeric:tabular-nums";

/** Telefon ayarı: kenar boşlukları daralır, yan yana kutular alt alta iner, büyük rakam küçülür */
const MOBILE_CSS = `@media only screen and (max-width:620px){
.em-outer{padding:20px 10px 32px !important}
.em-head{padding:4px 12px 22px !important}
.em-card{padding:28px 20px 26px !important;border-radius:18px !important}
.em-col{display:block !important;width:100% !important;box-sizing:border-box !important;padding:0 0 10px 0 !important}
.em-hero{font-size:34px !important;line-height:40px !important}
.em-h1{font-size:22px !important;line-height:28px !important}
.em-foot{padding:20px 16px 0 !important}
}`;

/** Önizleme satırının arkasına gövdenin sızmaması için doldurma (Gmail ve Apple Mail ilk ~100 karakteri gösterir) */
const PREHEADER_FILL = "&#847;&zwnj;&nbsp;".repeat(60);

/**
 * Şirketin logosu (L'Affogato yazısı; panelin herkese açık dosyası public/brand/logo-wordmark.png, 456×113): her
 * e-postanın başında, ortada. Görseli göstermeyen istemcide yerine aynı yazı (alt) serif yazıyla görünür
 */
export const EMAIL_LOGO_URL = "https://ladmin.laffogato.net/brand/logo-wordmark.png";
/** Logonun e-postadaki ölçüsü (en × boy, px): kaynağın oranı korunur, kaynak 3 kat netlikte */
const LOGO_W = 140;
const LOGO_H = 35;
const SERIF = "Georgia,'Times New Roman',Times,serif";
/** Logonun etiketi: kabuk her e-postaya bir kez koyar; testler "logo dışında görsel yok" denetiminde bunu ayıklar */
export const EMAIL_LOGO_HTML = `<img src="${EMAIL_LOGO_URL}" width="${LOGO_W}" height="${LOGO_H}" alt="L'Affogato" style="display:block;margin:0 auto;width:${LOGO_W}px;height:${LOGO_H}px;border:0;outline:none;text-decoration:none;font-family:${SERIF};font-size:24px;line-height:${LOGO_H}px;color:${C.ink};text-align:center">`;

export interface ShellOptions {
  /** <title> ve istemcinin sekme adı (düz metin) */
  subject: string;
  /** Gelen kutusunda konunun yanında görünen tek satır (düz metin) */
  preheader: string;
  /** Logonun altındaki küçük satır (hazır HTML; ör. "Kasa raporu · Marina") */
  brandSubHtml: string;
  /** Tarih (düz metin): logonun altındaki satırın sonunda, "·" ile */
  dateLabel?: string | null;
  /** Kartın içi (hazır HTML) */
  cardHtml: string;
  /** Kartın altındaki not (düz metin) */
  footer?: string | null;
  /** Kartın altında, notun üstünde ikinci bir satır (düz metin; ör. "Panelde aç: adres") */
  footerExtra?: string | null;
}

/**
 * E-postanın kabuğu (sade): açık zeminde ortada şirketin logosu ve altında tek satır (ne e-postası · tarih), ince
 * çerçeveli beyaz kart (en çok 600 px; telefonda kenara yakın, iç boşluk daralır), altta ortalı küçük alıcı notu
 */
export function emailShell(o: ShellOptions): string {
  const date = o.dateLabel ? esc(o.dateLabel) : "";
  return `<!doctype html><html lang="tr" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(o.subject)}</title>
<style>:root{color-scheme:light;supported-color-schemes:light}body{margin:0;padding:0}table{border-collapse:collapse}a{text-decoration:none}img{-ms-interpolation-mode:bicubic}
${MOBILE_CSS}</style></head>
<body style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;font-family:${FONT};color:${C.ink}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas}">${esc(o.preheader)}${PREHEADER_FILL}</div>
<table ${TABLE} style="background:${C.canvas}"><tr><td align="center" class="em-outer" style="padding:40px 16px 48px">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table ${TABLE} style="max-width:600px">
  <tr><td align="center" class="em-head" style="padding:0 16px 26px;text-align:center">
    ${EMAIL_LOGO_HTML}
    <div style="margin-top:14px;font-family:${FONT};font-size:13px;line-height:19px;color:${C.mute}">${o.brandSubHtml}${date ? `<span style="color:${C.quiet}"> &middot; </span><span style="white-space:nowrap">${date}</span>` : ""}</div>
  </td></tr>
  <tr><td class="em-card" style="background:${C.card};border:1px solid ${C.line};border-radius:20px;padding:40px 40px 36px">
${o.cardHtml}
  </td></tr>${o.footerExtra ? `\n  <tr><td class="em-foot" style="padding:24px 24px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.mute};text-align:center;word-break:break-word">${esc(o.footerExtra)}</td></tr>` : ""}${o.footer ? `\n  <tr><td class="em-foot" style="padding:${o.footerExtra ? 8 : 24}px 24px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.quiet};text-align:center">${esc(o.footer)}</td></tr>` : ""}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

/** Kartın başlığı (h1; testler ve ekran okuyucu bunu arar). `eyebrow` üstte küçük gri satır */
export function heading(text: string, o: { eyebrow?: string | null; sub?: string | null; color?: string } = {}): string {
  return `${o.eyebrow ? `<div style="font-family:${FONT};font-size:14px;line-height:20px;color:${C.mute};margin:0 0 6px">${esc(o.eyebrow)}</div>` : ""}<h1 class="em-h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:31px;font-weight:700;letter-spacing:-0.015em;color:${o.color ?? C.ink}">${esc(text)}</h1>${o.sub ? `<div style="font-family:${FONT};font-size:15px;line-height:23px;color:${C.soft};margin-top:8px">${esc(o.sub)}</div>` : ""}`;
}

/**
 * Büyük rakam: üstte etiket, ortada tutar, altta açıklama. `tone` verilirse yumuşak renkli kutunun içinde (kasa sonucu
 * gibi), verilmezse kartın üstünde düz
 */
export function hero(o: { label: string; value: string; sub?: string | null; subHtml?: string | null; tone?: Tone | null }): string {
  const t = o.tone ? TONE[o.tone] : null;
  const fg = t ? t.fg : C.ink;
  const sub = o.subHtml ?? (o.sub ? esc(o.sub) : "");
  const inner = `<div style="font-family:${FONT};font-size:14px;line-height:20px;color:${t ? t.fg : C.mute}">${esc(o.label)}</div>
<div class="em-hero" style="font-family:${FONT};font-size:40px;line-height:46px;font-weight:700;letter-spacing:-0.025em;color:${fg};${NUM};margin-top:4px">${esc(o.value)}</div>${sub ? `\n<div style="font-family:${FONT};font-size:14px;line-height:21px;color:${t ? t.fg : C.soft};margin-top:8px">${sub}</div>` : ""}`;
  if (!t) return inner;
  return `<table ${TABLE}><tr><td style="background:${t.bg};border-radius:18px;padding:20px 22px">${inner}</td></tr></table>`;
}

export interface Stat {
  label: string;
  value: string;
  sub?: string | null;
  tone?: Tone | null;
}

/** Yan yana küçük rakam kutuları (iki ya da üç; telefonda alt alta). Boş liste boş metin */
export function stats(items: readonly Stat[], o: { top?: number } = {}): string {
  if (!items.length) return "";
  const per = items.length >= 3 ? 3 : items.length;
  const width = Math.floor(100 / per);
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += per) {
    const chunk = items.slice(i, i + per);
    const cells = chunk.map((s, j) => {
      const t = s.tone ? TONE[s.tone] : null;
      const pad = j < chunk.length - 1 ? "0 10px 0 0" : "0";
      // Sade: tonsuz kutu çerçeveli beyaz, tonlu kutu (kasa sonucu) yumuşak renkli
      const box = t ? `background:${t.bg}` : `background:${C.card};border:1px solid ${C.line}`;
      return `<td class="em-col" width="${width}%" style="width:${width}%;padding:${pad};vertical-align:top"><table ${TABLE}><tr><td style="${box};border-radius:14px;padding:14px 16px">
  <div style="font-family:${FONT};font-size:13px;line-height:18px;color:${t ? t.fg : C.mute}">${esc(s.label)}</div>
  <div style="font-family:${FONT};font-size:19px;line-height:26px;font-weight:700;color:${t ? t.fg : C.ink};${NUM};margin-top:2px;white-space:nowrap">${esc(s.value)}</div>${s.sub ? `\n  <div style="font-family:${FONT};font-size:12px;line-height:17px;color:${t ? t.fg : C.mute};margin-top:2px">${esc(s.sub)}</div>` : ""}
</td></tr></table></td>`;
    });
    // Eksik hücreler boş kalır (son satırda tek kutu yayılmaz)
    for (let k = chunk.length; k < per; k++) cells.push(`<td class="em-col" width="${width}%" style="width:${width}%;padding:0"></td>`);
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<table ${TABLE} style="margin-top:${o.top ?? 18}px">${rows.join(`<tr><td colspan="${per}" style="height:10px;line-height:10px;font-size:0">&nbsp;</td></tr>`)}</table>`;
}

/** Bölüm başlığı: kalın kısa başlık, sağda isteğe bağlı küçük not (ör. toplam) */
export function sectionTitle(title: string, o: { aside?: string | null; top?: number; dot?: Tone | null } = {}): string {
  const dot = o.dot ? `<span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${TONE[o.dot].dot};margin-right:8px;vertical-align:middle"></span>` : "";
  return `<table ${TABLE} style="margin-top:${o.top ?? 32}px"><tr>
  <td style="padding:0 0 10px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;line-height:21px;font-weight:600;color:${C.ink}">${dot}<span style="vertical-align:middle">${esc(title)}</span></td>${o.aside ? `\n  <td align="right" style="padding:0 0 10px 12px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:13px;line-height:21px;color:${C.mute};white-space:nowrap;${NUM}">${esc(o.aside)}</td>` : ""}
</tr></table>`;
}

export interface Row {
  label: string;
  value: string;
  /** Etiketin altında küçük gri açıklama */
  sub?: string | null;
  /** Toplam satırı: büyük ve kalın */
  strong?: boolean;
  /** Değerin rengi (eksik kırmızı, fazla turuncu, tutuyor yeşil) */
  tone?: Tone | null;
  /** Değerin altında küçük gri açıklama */
  valueSub?: string | null;
}

/** Tek satır: solda etiket (sarılır), sağda değer (sarılmaz) */
export function rowHtml(r: Row, first = false): string {
  const border = first ? "" : `border-top:1px solid ${C.hair};`;
  const color = r.tone ? TONE[r.tone].fg : C.ink;
  return `<tr>
  <td style="${border}padding:12px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.soft};vertical-align:top;word-break:break-word">${esc(r.label)}${r.sub ? `<div style="font-size:13px;line-height:19px;color:${C.mute};margin-top:1px">${esc(r.sub)}</div>` : ""}</td>
  <td align="right" style="${border}padding:12px 0 12px 16px;font-family:${FONT};font-size:${r.strong ? 17 : 15}px;line-height:22px;font-weight:${r.strong ? 700 : 600};color:${color};white-space:nowrap;vertical-align:top;${NUM}">${esc(r.value)}${r.valueSub ? `<div style="font-size:12px;line-height:18px;font-weight:400;color:${C.mute}">${esc(r.valueSub)}</div>` : ""}</td>
</tr>`;
}

/** Uzun metin satırı (kalem listesi gibi): iki sütuna yayılır, sarılır */
export function textRowHtml(label: string | null, text: string, first = false, o: { muted?: boolean; indent?: boolean } = {}): string {
  const border = first || o.indent ? "" : `border-top:1px solid ${C.hair};`;
  const pad = o.indent ? "0 0 8px 14px" : "12px 0";
  const size = o.muted ? "13px;line-height:19px" : "15px;line-height:22px";
  return `<tr><td colspan="2" style="${border}padding:${pad};font-family:${FONT};font-size:${size};color:${o.muted ? C.mute : C.ink};word-break:break-word">${label ? `<span style="color:${C.soft}">${esc(label)}:</span> ` : ""}${esc(text)}</td></tr>`;
}

/** Etiket–değer satırlarının tablosu. Hazır satır HTML'i de alır (rowHtml / textRowHtml ile üretilmiş) */
export function rows(list: readonly (Row | string)[]): string {
  if (!list.length) return "";
  return `<table ${TABLE} style="border-collapse:collapse">${list.map((r, i) => (typeof r === "string" ? r : rowHtml(r, i === 0))).join("")}</table>`;
}

/** Başlıklı bölüm: başlık + satırlar (+ altında isteğe bağlı kutular) */
export function section(title: string, list: readonly (Row | string)[], o: { aside?: string | null; top?: number; after?: string; dot?: Tone | null } = {}): string {
  return `${sectionTitle(title, { aside: o.aside, top: o.top, dot: o.dot })}${rows(list)}${o.after ?? ""}`;
}

/**
 * Renkli not kutusu: uyarı (turuncu), sorun (kırmızı), iyi (yeşil), bilgi ya da nötr. `lines` düz metin (her biri ayrı
 * satır); `title` kalın ilk satır; `linkHref`/`linkLabel` altta bağlantı
 */
export function callout(
  tone: Tone,
  lines: readonly (string | null | undefined)[],
  o: { title?: string | null; top?: number; linkHref?: string | null; linkLabel?: string | null; html?: string | null } = {},
): string {
  const list = lines.filter((l): l is string => Boolean(l));
  if (!list.length && !o.title && !o.html) return "";
  const t = TONE[tone];
  const body = list.map((l) => `<div style="margin-top:${o.title ? 4 : 0}px">${esc(l)}</div>`).join("");
  const link = o.linkHref && o.linkLabel ? `<div style="margin-top:10px"><a href="${esc(o.linkHref)}" style="color:${t.fg};font-weight:600;text-decoration:underline">${esc(o.linkLabel)} →</a></div>` : "";
  return `<table ${TABLE} style="margin-top:${o.top ?? 14}px"><tr><td style="background:${t.bg};border-radius:16px;padding:14px 18px;font-family:${FONT};font-size:14px;line-height:21px;color:${t.fg};word-break:break-word">${o.title ? `<div style="font-weight:600">${esc(o.title)}</div>` : ""}${body}${o.html ?? ""}${link}</td></tr></table>`;
}

/**
 * Ana eylem düğmesi: tam genişlik, 52 px (parmakla rahat); `secondary` beyaz zeminde çerçeveli. `color`: markalı e-postanın
 * kendi rengi (misafirin karaoke e-postası sitenin yeşili); yazı beyaz. `newTab`: bağlantı yeni sekmede açılır
 */
export function button(href: string, label: string, o: { top?: number; secondary?: boolean; color?: string; newTab?: boolean } = {}): string {
  const bg = o.secondary ? C.card : (o.color ?? C.ink);
  const fg = o.secondary ? C.ink : "#ffffff";
  const border = o.secondary ? `border:1px solid ${C.line};` : "";
  return `<table ${TABLE} style="margin-top:${o.top ?? 30}px"><tr><td align="center" bgcolor="${bg}" style="border-radius:14px;background:${bg};${border}">
  <a href="${esc(href)}"${o.newTab ? ` target="_blank" rel="noopener noreferrer"` : ""} style="display:block;padding:16px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${fg};text-decoration:none;border-radius:14px">${esc(label)}</a>
</td></tr></table>`;
}

/** Paragraf (düz metin) */
export function para(text: string, o: { top?: number; muted?: boolean; size?: number } = {}): string {
  const size = o.size ?? 15;
  return `<p style="margin:${o.top ?? 14}px 0 0;font-family:${FONT};font-size:${size}px;line-height:${Math.round(size * 1.55)}px;color:${o.muted ? C.mute : C.soft};word-break:break-word">${esc(text)}</p>`;
}

/** Küçük yuvarlak etiket (rozet) */
export function pill(text: string, tone: Tone = "neutral"): string {
  const t = TONE[tone];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${t.bg};color:${t.fg};font-family:${FONT};font-size:12px;line-height:18px;font-weight:600;white-space:nowrap">${esc(text)}</span>`;
}

/** İnce ayraç */
export function divider(top = 28): string {
  return `<table ${TABLE} style="margin-top:${top}px"><tr><td style="height:1px;line-height:1px;font-size:0;background:${C.line}">&nbsp;</td></tr></table>`;
}

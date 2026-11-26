/**
 * E-postanın yapı taşları (saf; her biri tek başına bir HTML parçası döndürür, layout()'un `body` dizisine girer).
 * Tablolar ve satır içi stiller; sınıflar (e-…) yalnız <head>'deki telefon ve koyu tema kurallarının tutamağı.
 * Metin parametreleri düz metindir, kaçışı burada; ham HTML yalnız `html: true` ile ya da adı …Html olan alanla girer.
 *
 * Bileşenler: statusBanner (durum bandı), kpiGrid (büyük rakamlar), section + kvRow (başlıklı satırlar), list, note
 * (açıklama kutusu), button ("Panelde aç"), divider, badge, paragraph, stack / gap (boşluk).
 */

import { compact, esc, visibleLength } from "./html";
import { LIGHT, SPACE, TONES, type Tone } from "./tokens";

const TABLE = 'role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"';
const NUM = "font-variant-numeric:tabular-nums";

// ---------------------------------------------------------------- Boşluk

/**
 * Dikey boşluk (Outlook'ta da tutan tablo satırı). `phone: true` (varsayılan) olan boşluk telefonda SPACE.gapPhone olur;
 * küçük iç boşluklar için `phone: false`
 */
export function gap(px: number = SPACE.gap, o: { phone?: boolean } = {}): string {
  const cls = o.phone === false ? "" : ' class="e-gap"';
  return `<table ${TABLE}${cls}><tr><td height="${px}" style="height:${px}px;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

/** Blokları alt alta, aralarında eşit boşlukla dizer (boş, null ve false atlanır) */
export function stack(blocks: readonly (string | null | undefined | false)[], px: number = SPACE.gap): string {
  return compact(blocks.map((b) => (typeof b === "string" ? b.trim() : b))).join(`\n${gap(px, { phone: px === SPACE.gap })}\n`);
}

// ---------------------------------------------------------------- Rozet

/** Küçük hap rozet (satırın içinde, metnin yanında): "FARK", "aynı", "Ödendi" */
export function badge(text: string, tone: Tone = "neutral"): string {
  const t = TONES[tone];
  return `<span class="e-t-${tone}" style="display:inline-block;padding:2px 9px;border-radius:999px;background:${t.bg};color:${t.ink};font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.01em;white-space:nowrap;vertical-align:1px">${esc(text)}</span>`;
}

// ---------------------------------------------------------------- Durum bandı

export interface StatusBannerOptions {
  tone: Tone;
  /** Büyük satır: "Z raporu tutuyor", "120 ₺ eksik" */
  title: string;
  /** Altındaki satır (düz metin) */
  sub?: string | null;
  /** Başlığın üstündeki küçük etiket: "Kasa" */
  eyebrow?: string | null;
  /** "lg" büyük rakam (28 px), "md" varsayılan (20 px; 44 karakterden uzun başlıkta 18), "sm" bölüm içi (16 px) */
  size?: "lg" | "md" | "sm";
  /** Soldaki işaret dairesi (✓ ! × i); verilmezse var ("sm"de yok) */
  mark?: boolean;
}

/**
 * Durum bandı: tonun yumuşak zemininde işaret, büyük başlık ve alt satır. Renk tek başına anlam taşımaz: işaret ve
 * metin aynı şeyi söyler. Örnek: statusBanner({ tone: "bad", eyebrow: "Kasa", title: "120 ₺ eksik", sub: "Olması gereken
 * 9.470 ₺ · sayılan 9.350 ₺", size: "lg" })
 */
export function statusBanner(o: StatusBannerOptions): string {
  const t = TONES[o.tone];
  const size = o.size ?? "md";
  // Uzun başlık (cümle) bir boy küçük yazılır: bant ağırlaşmasın
  const long = o.title.length > 44;
  const title =
    size === "lg" && !long ? { fs: 28, lh: 34, ls: "-0.02em" } : size !== "sm" ? (long ? { fs: 18, lh: 25, ls: "-0.01em" } : { fs: 20, lh: 27, ls: "-0.01em" }) : { fs: 16, lh: 23, ls: "0" };
  const mark = o.mark ?? size !== "sm";
  const pad = size === "sm" ? "14px 16px" : "20px 22px";
  // İşaret başlığın ortasına hizalanır
  const markTop = (o.eyebrow ? 20 : 0) + Math.max(0, Math.round((title.lh - 28) / 2));
  const markCell = mark
    ? `<td width="28" valign="top" style="width:28px;padding:${markTop}px 14px 0 0;vertical-align:top"><div class="e-m-${o.tone}" aria-hidden="true" style="width:28px;height:28px;border-radius:14px;background:${t.mark};color:${t.markInk};font-size:15px;line-height:28px;font-weight:700;text-align:center">${t.glyph}</div></td>`
    : "";
  const body = [
    o.eyebrow ? `<div class="e-ti-${o.tone}" style="font-size:13px;line-height:18px;font-weight:600;color:${t.ink}">${esc(o.eyebrow)}</div>` : "",
    `<div class="e-tt-${o.tone}" style="${o.eyebrow ? "margin-top:2px;" : ""}font-size:${title.fs}px;line-height:${title.lh}px;font-weight:700;letter-spacing:${title.ls};color:${t.title};${NUM}">${esc(o.title)}</div>`,
    o.sub ? `<div class="e-ti-${o.tone}" style="margin-top:${size === "sm" ? 2 : 4}px;font-size:${size === "sm" ? 14 : 15}px;line-height:${size === "sm" ? 20 : 22}px;color:${t.ink}">${esc(o.sub)}</div>` : "",
  ].join("");
  return `<table ${TABLE}><tr><td class="e-t-${o.tone}${size === "sm" ? "" : " e-banner"}" bgcolor="${t.bg}" style="background:${t.bg};border-radius:${SPACE.radiusInner}px;padding:${pad}">
<table ${TABLE}><tr>${markCell}<td valign="top" style="vertical-align:top">${body}</td></tr></table>
</td></tr></table>`;
}

// ---------------------------------------------------------------- Büyük rakamlar

export interface Kpi {
  label: string;
  value: string;
  /** Rakamın altındaki küçük satır: "LafPOS'ta 1.190 ₺ · aynı" */
  sub?: string | null;
  /** Rakamın rengi (kötü kırmızı…); verilmezse mürekkep */
  tone?: Tone | null;
  /** Alt satırın rengi; verilmezse gri */
  subTone?: Tone | null;
  /** Alt satırın sonunda rozet ("aynı", "FARK"); sığmazsa bütün olarak alt satıra geçer */
  badge?: { text: string; tone: Tone } | null;
}

/**
 * 1–3 büyük rakam kutusu yan yana (telefonda alt alta). Örnek: kpiGrid([{ label: "Günün toplamı", value: "1.190 ₺" },
 * { label: "Nakit", value: "390 ₺", sub: "LafPOS'ta 420 ₺", tone: "bad", badge: { text: "FARK", tone: "bad" } },
 * { label: "Kart", value: "800 ₺" }])
 */
export function kpiGrid(items: readonly Kpi[]): string {
  const list = items.slice(0, 3);
  if (!list.length) return "";
  // Aradaki 12 px'lik boşluklara yer kalsın diye yüzdeler 100'ü doldurmaz (yoksa tablo boşlukları sıkıştırır)
  const width = Math.floor(100 / list.length) - (list.length > 1 ? 1 : 0);
  const cell = (k: Kpi) => {
    const valueTone = k.tone && k.tone !== "neutral" ? k.tone : null;
    const subTone = k.subTone && k.subTone !== "neutral" ? k.subTone : null;
    return `<td class="e-kpi e-well" width="${width}%" valign="top" bgcolor="${LIGHT.well}" style="width:${width}%;background:${LIGHT.well};border-radius:${SPACE.radiusInner}px;padding:16px 18px 15px;vertical-align:top">
<div class="e-mute" style="font-size:13px;line-height:18px;color:${LIGHT.mute}">${esc(k.label)}</div>
<div class="${valueTone ? `e-v-${valueTone}` : "e-ink"}" style="margin-top:4px;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-0.02em;color:${valueTone ? TONES[valueTone].value : LIGHT.ink};white-space:nowrap;${NUM}">${esc(k.value)}</div>${
      k.sub || k.badge
        ? `\n<div class="${subTone ? `e-v-${subTone}` : "e-mute"}" style="margin-top:6px;font-size:13px;line-height:20px;color:${subTone ? TONES[subTone].value : LIGHT.mute};${NUM}">${k.sub ? esc(k.sub) : ""}${k.sub && k.badge ? " " : ""}${k.badge ? badge(k.badge.text, k.badge.tone) : ""}</div>`
        : ""
    }
</td>`;
  };
  const gapCell = `<td class="e-kpi-gap" width="12" style="width:12px;font-size:0;line-height:0">&nbsp;</td>`;
  return `<table ${TABLE}><tr>
${list.map(cell).join(`\n${gapCell}\n`)}
</tr></table>`;
}

// ---------------------------------------------------------------- Satırlar

export interface KvOptions {
  /** Değerin rengi: good yeşil, warn turuncu, bad kırmızı */
  tone?: Tone | null;
  /** Kalın ve biraz büyük değer (toplam, fark) */
  strong?: boolean;
  /** İnce, gri değer (döküm satırı: batch, banka) */
  quiet?: boolean;
  /** Etiketin altındaki küçük satır */
  sub?: string | null;
  /** Değerin altındaki küçük satır */
  valueSub?: string | null;
  /** Değerin yanında rozet */
  badge?: { text: string; tone: Tone } | null;
  /**
   * Değer etiketin altına iner: true telefonda, "always" her genişlikte. Verilmezse değerin görünür uzunluğuna göre:
   * kısa (tutar, 22 karaktere kadar) yanında kalır, uzun telefonda iner, çok uzun (48 karakterden fazla) her yerde
   */
  stack?: boolean | "always";
  /** `value` hazır HTML (kaçışlanmaz) */
  html?: boolean;
  /** Üst çizgi yok (bölümün dışında tek başına satır) */
  bare?: boolean;
}

/**
 * Etiket solda, değer sağda bir satır (üstünde ince çizgi). Tutar gibi kısa değer kaydırılmaz; uzun değer masaüstünde
 * sarılır, telefonda etiketin altına iner; çok uzun değer (cümle) her genişlikte etiketin altında, sola dayalı (sağa
 * dayalı çok satırlı metin zor okunur). Örnek: kvRow("Kasa farkı", "120 ₺ eksik", { tone: "bad", strong: true }) ya da
 * kvRow("Yazarkasa nakdi", "fotoğrafta 3.270 ₺", { badge: { text: "FARK", tone: "bad" }, valueSub: "LafPOS'ta 3.390 ₺" })
 */
export function kvRow(label: string, value: string, o: KvOptions = {}): string {
  const valueHtml = o.html ? value : esc(value);
  const length = visibleLength(valueHtml) + (o.badge ? o.badge.text.length + 2 : 0);
  const long = length > 22;
  const always = o.stack === "always" || (o.stack === undefined && length > 48);
  const stacked = o.stack === undefined ? long : o.stack !== false;
  const tone = o.tone && o.tone !== "neutral" ? o.tone : null;
  const line = o.bare ? "" : `border-top:1px solid ${LIGHT.line};`;
  const lineCls = o.bare ? "" : " e-line";
  const valueCls = tone ? `e-v-${tone}` : o.quiet ? "e-soft" : "e-ink";
  const color = tone ? TONES[tone].value : o.quiet ? LIGHT.soft : LIGHT.ink;
  const weight = o.strong ? 700 : o.quiet ? 400 : 600;
  const size = o.strong ? 16 : 15;
  const labelSub = o.sub ? `<div class="e-mute" style="font-size:13px;line-height:18px;color:${LIGHT.mute}">${esc(o.sub)}</div>` : "";
  const valueSub = o.valueSub ? `<div class="e-mute" style="margin-top:2px;font-size:13px;line-height:18px;font-weight:400;color:${LIGHT.mute}">${esc(o.valueSub)}</div>` : "";
  const badgeHtml = o.badge ? `${long ? " " : "&nbsp;"}${badge(o.badge.text, o.badge.tone)}` : "";
  const labelStyle = `${line}font-size:15px;line-height:22px;color:${LIGHT.soft};vertical-align:top`;
  const valueStyle = `font-size:${size}px;line-height:22px;font-weight:${weight};color:${color};vertical-align:top;${NUM}`;
  if (always) {
    // Etiket üstte, değer altında (iki satır, her genişlikte)
    return `<table ${TABLE} class="e-kv"><tr><td class="e-kv-l e-soft${lineCls}" style="padding:${SPACE.rowPad}px 0 2px;${labelStyle}">${esc(label)}${labelSub}</td></tr><tr><td class="e-kv-v ${valueCls}" style="padding:0 0 ${SPACE.rowPad}px;${valueStyle};word-break:break-word">${valueHtml}${badgeHtml}${valueSub}</td></tr></table>`;
  }
  // Kısa değer kendi genişliğinde (1%), etiket kalan yerde; uzun değerde etiket etiketin boyuna göre %28–42 (kısa
  // etiketin yanında uzun değer tek satıra sığsın)
  const labelWidth = long ? ` width="${label.length <= 12 ? 28 : label.length <= 20 ? 36 : 42}%"` : "";
  const valueWidth = long ? "" : ' width="1%"';
  return `<table ${TABLE} class="e-kv${stacked ? " e-kv-s" : ""}"><tr><td class="e-kv-l e-soft${lineCls}"${labelWidth} style="padding:${SPACE.rowPad}px 16px ${SPACE.rowPad}px 0;${labelStyle}">${esc(label)}${labelSub}</td><td class="e-kv-v ${valueCls}${lineCls}"${valueWidth} align="right" style="padding:${SPACE.rowPad}px 0;${line}text-align:right;${long ? "" : "white-space:nowrap;"}${valueStyle}">${valueHtml}${badgeHtml}${valueSub}</td></tr></table>`;
}

/** Bölümün satırı: hazır HTML (kvRow, list…) ya da [etiket, değer] (varsayılan kvRow) */
export type Row = string | readonly [string, string];

export interface SectionOptions {
  /** Başlığın sağındaki küçük yazı (toplam, sayı) */
  aside?: string | null;
  /** Başlığın altındaki açıklama satırı */
  sub?: string | null;
  /** Başlıkla satırlar arasına giren hazır HTML (ör. küçük durum bandı) */
  leadHtml?: string | null;
  /** Satırlardan sonra giren hazır HTML (ör. uyarı notu) */
  afterHtml?: string | null;
}

/**
 * Başlıklı bölüm: başlık (16 px, kalın), isteğe bağlı açıklama, satırlar (her biri ince çizgiyle ayrılır). Örnek:
 * section("Satış", [["Toplam satış (Z)", "20.000 ₺"], kvRow("İndirim", "100 ₺", { quiet: true })])
 */
export function section(title: string | null, rows: readonly Row[], o: SectionOptions = {}): string {
  const head = title
    ? `<table ${TABLE}><tr><td class="e-ink" style="padding:0 0 8px;font-size:16px;line-height:24px;font-weight:600;color:${LIGHT.ink}">${esc(title)}</td>${
        o.aside ? `<td class="e-mute" align="right" style="padding:0 0 8px 12px;font-size:14px;line-height:24px;color:${LIGHT.mute};white-space:nowrap;${NUM}">${esc(o.aside)}</td>` : ""
      }</tr>${o.sub ? `<tr><td colspan="2" class="e-mute" style="padding:0 0 8px;font-size:14px;line-height:20px;color:${LIGHT.mute}">${esc(o.sub)}</td></tr>` : ""}</table>`
    : "";
  const body = rows.map((r) => (typeof r === "string" ? r : kvRow(r[0], r[1]))).join("\n");
  const lead = o.leadHtml ? `${o.leadHtml}\n${gap(12, { phone: false })}` : "";
  const after = o.afterHtml ? `${gap(12, { phone: false })}\n${o.afterHtml}` : "";
  return `${head}\n${lead}${body}${after ? `\n${after}` : ""}`;
}

// ---------------------------------------------------------------- Liste

/**
 * Madde listesi (noktalı ya da numaralı); her madde sarılır. Örnek: list(["Buzdolabı ısısı", "Kahve makinesi
 * temizliği"]) ya da list(maddeler, { ordered: true })
 */
export function list(items: readonly string[], o: { ordered?: boolean; html?: boolean } = {}): string {
  if (!items.length) return "";
  const rows = items.map((item, i) => {
    const mark = o.ordered
      ? `<div class="e-well e-soft" style="width:22px;height:22px;border-radius:11px;background:${LIGHT.well};color:${LIGHT.soft};font-size:12px;line-height:22px;font-weight:600;text-align:center">${i + 1}</div>`
      : `<div class="e-mute" style="font-size:15px;line-height:22px;color:${LIGHT.mute}">•</div>`;
    return `<tr><td width="${o.ordered ? 34 : 18}" valign="top" style="width:${o.ordered ? 34 : 18}px;padding:${i ? 8 : 0}px 0 0;vertical-align:top">${mark}</td><td class="e-soft" valign="top" style="padding:${i ? 8 : 0}px 0 0;font-size:15px;line-height:22px;color:${LIGHT.soft};vertical-align:top;word-break:break-word">${o.html ? item : esc(item)}</td></tr>`;
  });
  return `<table ${TABLE}>${rows.join("")}</table>`;
}

// ---------------------------------------------------------------- Not

/**
 * Açıklama kutusu: tonun yumuşak zemini (nötrde gri), isteğe bağlı kalın başlık, satırlar alt alta. Örnek: note(["Ekleyen:
 * Ayşe", "Fotoğraf ek olarak bu e-postada."]) ya da note("Paraşüt eşitlemesi başarısız.", { tone: "bad" })
 */
export function note(content: string | readonly string[], o: { tone?: Tone; title?: string | null; html?: boolean } = {}): string {
  const tone = o.tone ?? "neutral";
  const t = TONES[tone];
  const lines = (typeof content === "string" ? [content] : content).filter(Boolean);
  if (!lines.length && !o.title) return "";
  const body = lines.map((l, i) => `<div${i ? ' style="margin-top:6px"' : ""}>${o.html ? l : esc(l)}</div>`).join("");
  return `<table ${TABLE}><tr><td class="e-t-${tone}" bgcolor="${t.bg}" style="background:${t.bg};border-radius:${SPACE.radiusInner}px;padding:16px 18px;font-size:15px;line-height:22px;color:${t.ink};word-break:break-word">${
    o.title ? `<div class="e-tt-${tone}" style="font-weight:700;color:${t.title};margin-bottom:${lines.length ? 4 : 0}px">${esc(o.title)}</div>` : ""
  }${body}</td></tr></table>`;
}

// ---------------------------------------------------------------- Düğme ve bağlantı

/**
 * Tam genişlikte düğme ("Panelde aç"): tablo hücresinin zemini düğmenin kendisi (resim yok, Outlook'ta mso-padding-alt ile
 * aynı yükseklik). `secondary` beyaz zeminde çerçeveli. Örnek: button(link, "Panelde aç")
 */
export function button(href: string, label: string, o: { variant?: "primary" | "secondary" } = {}): string {
  if (o.variant === "secondary") {
    return `<table ${TABLE}><tr><td class="e-card e-line" align="center" bgcolor="${LIGHT.card}" style="border:1px solid #d4d4d8;border-radius:${SPACE.radiusInner}px;background:${LIGHT.card};mso-padding-alt:15px 24px"><a class="e-ink" href="${esc(href)}" style="display:block;padding:15px 24px;font-size:16px;line-height:20px;font-weight:600;color:${LIGHT.ink};text-decoration:none;border-radius:${SPACE.radiusInner}px">${esc(label)}</a></td></tr></table>`;
  }
  return `<table ${TABLE}><tr><td class="e-btn" align="center" bgcolor="${LIGHT.primary}" style="border-radius:${SPACE.radiusInner}px;background:${LIGHT.primary};mso-padding-alt:16px 24px"><a class="e-btn-a" href="${esc(href)}" style="display:block;padding:16px 24px;font-size:16px;line-height:20px;font-weight:600;color:${LIGHT.onPrimary};text-decoration:none;border-radius:${SPACE.radiusInner}px">${esc(label)}</a></td></tr></table>`;
}

/** Metnin içindeki bağlantı ("Kontrol edin →"): altı çizili, kalın; ton verilirse o renkte */
export function link(href: string, label: string, tone?: Tone): string {
  const color = tone ? TONES[tone].ink : LIGHT.ink;
  return `<a class="${tone ? `e-ti-${tone}` : "e-link"}" href="${esc(href)}" style="color:${color};font-weight:600;text-decoration:underline">${esc(label)}</a>`;
}

// ---------------------------------------------------------------- Ayraç ve paragraf

/** İnce yatay çizgi */
export function divider(): string {
  return `<table ${TABLE}><tr><td class="e-line" style="border-top:1px solid ${LIGHT.line};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>`;
}

/**
 * Paragraf: 16 px / 24 px gövde metni (`small`: 14 px gri açıklama). Örnek: paragraph("Odayı saatinden önce hazırlayın.")
 */
export function paragraph(text: string, o: { small?: boolean; tone?: Tone | null; align?: "left" | "center"; html?: boolean } = {}): string {
  const tone = o.tone && o.tone !== "neutral" ? o.tone : null;
  const cls = tone ? `e-v-${tone}` : o.small ? "e-mute" : "e-soft";
  const color = tone ? TONES[tone].value : o.small ? LIGHT.mute : LIGHT.soft;
  return `<p class="${cls}" style="margin:0;font-size:${o.small ? 14 : 16}px;line-height:${o.small ? 20 : 24}px;color:${color}${o.align === "center" ? ";text-align:center" : ""}">${o.html ? text : esc(text)}</p>`;
}

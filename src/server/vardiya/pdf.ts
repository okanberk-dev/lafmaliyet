import { readFileSync } from "node:fs";
import { join } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

import { DAY_NAMES, dayHeadcount, hoursLabel, plannedRows, presetOf, presetText, rowMinutes, shiftPresets, shiftTimes, weekDays, weekLabel, type ShiftRow } from "@/lib/vardiya";

import { LAF_MARK_WHITE_PNG, LAF_MARK_WHITE_SIZE } from "./logo";

/**
 * Vardiya planının PDF'i (docs/VARDIYA.md › PDF): A4 yatay; üstte markanın yeşil bandı ve L'Af logosu (sitenin
 * e-postalarındaki işaret ve renkler), altında kişi × gün tablosu. Sabahçı altın, akşamcı yeşil kutuda adıyla; başka saat
 * gri kutuda, izin kesik çizgili. Haftalık saat toplamı, gün gün çalışan sayısı ve renklerin açıklaması. Her istekte kaydedilen plandan yeniden çizilir (dosya saklanmaz): plan değişince PDF de değişir. "server-only"
 * yok: tests/vardiya.test.ts doğrudan çizdirir.
 *
 * Yazı tipi Inter'in (SIL OFL 1.1; fonts/OFL.txt) Latin ve Türkçe harflere indirilmiş kopyası (fonts/README.md):
 * PDF'in 14 standart yazı tipinde ğ, ş, ı, İ yoktur. Dosyalar çalışma anında diskten okunur; Vercel işlevine
 * `outputFileTracingIncludes` ile konur (next.config.ts).
 */

const FONT_DIR = join(process.cwd(), "src", "server", "vardiya", "fonts");
export const SHIFT_FONT_FILES = { regular: "Inter-Regular.subset.ttf", bold: "Inter-SemiBold.subset.ttf" } as const;

let fontBytes: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts() {
  fontBytes ??= { regular: readFileSync(join(FONT_DIR, SHIFT_FONT_FILES.regular)), bold: readFileSync(join(FONT_DIR, SHIFT_FONT_FILES.bold)) };
  return fontBytes;
}

export interface ShiftPdfInput {
  /** Şubenin kimliği: hazır vardiyalar (sabahçı / akşamcı) ona göre adlandırılır; yoksa adsız */
  branchId?: string;
  branchName: string;
  monday: string;
  rows: readonly ShiftRow[];
  /** Plana en son kim, ne zaman dokundu */
  updated: { by: string | null; at: string } | null;
  generatedAt: Date;
}

// A4 yatay (punto)
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 32;
const hex = (v: string): RGB => rgb(parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255);
const INK = hex("#1e2a25");
const MUTE = hex("#5b6a63");
const QUIET = hex("#a3b4ab");
const LINE = hex("#dfe6e1");
const WHITE = rgb(1, 1, 1);
// laffogato.net e-postalarının renkleri: derin yeşil bant, altın vurgu, adaçayı
const GREEN = hex("#173f35");
const GOLD = hex("#cba258");
const SAGE = hex("#c3d3cb");
const HEAD_FILL = hex("#eef4f0");
/** Hücre kutuları: sabahçı altın, akşamcı yeşil, başka saat gri */
const TONE = {
  morning: { fill: hex("#f8f0dc"), label: hex("#8a6a1f"), bar: GOLD },
  evening: { fill: hex("#e2ede7"), label: GREEN, bar: GREEN },
  other: { fill: hex("#f1f3f2"), label: MUTE, bar: QUIET },
} as const;

const BAND_H = 62;
const NAME_W = 132;
const TOTAL_W = 58;
const DAY_W = (PAGE_W - 2 * MARGIN - NAME_W - TOTAL_W) / 7;
const HEAD_H = 32;
/** Satır yüksekliği plana göre: 9 kişiye kadar ferah, 11'e kadar orta, daha kalabalıkta sıkı (tek sayfaya 13 kişi) */
const DENSITY = [
  { max: 9, rowH: 40, label: 6.5, time: 10 },
  { max: 11, rowH: 32, label: 6, time: 9.5 },
  { max: Infinity, rowH: 28, label: 5.5, time: 9 },
] as const;
const FOOT_ROW_H = 22;
/** Sayfanın altında (kenar boşluğu dahil) açıklama ve alt bilgi için ayrılan yükseklik */
const BOTTOM_RESERVE = MARGIN + 36;

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const shortDate = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1]}`;
const upperTR = (v: string) => v.toLocaleUpperCase("tr-TR");

/** Türkiye saatiyle "22 Kasım 2026 16:45" */
function stampTR(at: Date): string {
  const tr = new Date(at.getTime() + 3 * 3_600_000).toISOString();
  return `${Number(tr.slice(8, 10))} ${MONTHS[Number(tr.slice(5, 7)) - 1]} ${tr.slice(0, 4)} ${tr.slice(11, 16)}`;
}

/** Genişliğe sığmayan metin "…" ile kısalır */
function fit(text: string, font: PDFFont, size: number, max: number): string {
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Yazı tipinde olmayan karakter (emoji, başka alfabe) çizimi düşürmesin: "?" olur */
function safe(text: string, font: PDFFont): string {
  const set = new Set(font.getCharacterSet());
  return [...text].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

/** Köşeleri yuvarlak dikdörtgen (pdf-lib'in dikdörtgeni köşesiz): sol üst köşeden SVG yolu; `dash` verilirse yalnız kesik çerçeve */
function roundRect(page: PDFPage, x: number, top: number, w: number, h: number, r: number, color: RGB, dash = false) {
  const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  if (dash) page.drawSvgPath(path, { x, y: top, borderColor: color, borderWidth: 0.8, borderDashArray: [3, 2.5] });
  else page.drawSvgPath(path, { x, y: top, color });
}

/** Harf aralıklı küçük etiket (pdf-lib'de harf aralığı yok: harf harf çizilir); çizilen genişliği döner */
function spaced(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: RGB, track: number): number {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + track;
  }
  return cx - x - track;
}
const spacedWidth = (text: string, size: number, font: PDFFont, track: number) => [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + track, -track);

export async function renderShiftPdf(input: ShiftPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = loadFonts();
  // Dosyalar zaten Latin ve Türkçe harflere indirilmiş (≈52 KB): yeniden alt küme çıkarılmaz
  const regular = await doc.embedFont(bytes.regular, { subset: false });
  const bold = await doc.embedFont(bytes.bold, { subset: false });
  const logo = await doc.embedPng(Buffer.from(LAF_MARK_WHITE_PNG, "base64"));
  const title = `Vardiya planı · ${input.branchName} · ${weekLabel(input.monday)}`;
  doc.setTitle(title);
  doc.setAuthor("L'Affogato");
  doc.setCreator("ladmin.laffogato.net");
  doc.setProducer("ladmin.laffogato.net");
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);
  doc.setLanguage("tr-TR");

  const branchId = input.branchId ?? "";
  const presets = shiftPresets(branchId);
  const days = weekDays(input.monday);
  const rows = [...plannedRows(input.rows)];
  const branch = safe(input.branchName, bold);
  const bandTop = PAGE_H - MARGIN;
  const tableTop = bandTop - BAND_H - 10;
  const density = DENSITY.find((d) => rows.length <= d.max)!;
  const rowH = density.rowH;
  const perPage = Math.max(1, Math.floor((tableTop - HEAD_H - FOOT_ROW_H - BOTTOM_RESERVE) / rowH));
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const headcount = dayHeadcount(rows);
  const totalMinutes = rows.reduce((sum, r) => sum + rowMinutes(r), 0);
  const tableW = PAGE_W - 2 * MARGIN;

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    // ---- Başlık bandı: markanın yeşili, solda logo ve ad, sağda hafta
    roundRect(page, MARGIN, bandTop, tableW, BAND_H, 16, GREEN);
    const logoH = 36;
    const logoW = (logoH * LAF_MARK_WHITE_SIZE.width) / LAF_MARK_WHITE_SIZE.height;
    page.drawImage(logo, { x: MARGIN + 20, y: bandTop - BAND_H + (BAND_H - logoH) / 2, width: logoW, height: logoH });
    const textX = MARGIN + 20 + logoW + 16;
    spaced(page, upperTR(`L'Affogato · ${branch}`), textX, bandTop - 25, 8, bold, GOLD, 1.3);
    page.drawText("Vardiya planı", { x: textX, y: bandTop - 47, size: 20, font: bold, color: WHITE });
    const week = weekLabel(input.monday);
    page.drawText(week, { x: MARGIN + tableW - 22 - bold.widthOfTextAtSize(week, 16), y: bandTop - 31, size: 16, font: bold, color: WHITE });
    const range = `${DAY_NAMES[0]} – ${DAY_NAMES[6]}${pages > 1 ? ` · sayfa ${p + 1} / ${pages}` : ""}`;
    page.drawText(range, { x: MARGIN + tableW - 22 - regular.widthOfTextAtSize(range, 9.5), y: bandTop - 47, size: 9.5, font: regular, color: SAGE });

    // ---- Tablo başlığı
    let y = tableTop;
    roundRect(page, MARGIN, y, tableW, HEAD_H, 9, HEAD_FILL);
    spaced(page, "KİŞİ", MARGIN + 12, y - 20, 7.5, bold, MUTE, 1);
    days.forEach((date, i) => {
      const x = MARGIN + NAME_W + i * DAY_W;
      page.drawText(DAY_NAMES[i], { x: x + 9, y: y - 14, size: 10, font: bold, color: GREEN });
      page.drawText(shortDate(date), { x: x + 9, y: y - 25.5, size: 8, font: regular, color: MUTE });
    });
    const totalHead = "TOPLAM";
    spaced(page, totalHead, PAGE_W - MARGIN - 12 - spacedWidth(totalHead, 7.5, bold, 1), y - 20, 7.5, bold, MUTE, 1);
    y -= HEAD_H;

    // ---- Satırlar
    const slice = rows.slice(p * perPage, (p + 1) * perPage);
    if (!rows.length) {
      page.drawText("Bu hafta için vardiya yazılmadı.", { x: MARGIN + 12, y: y - 24, size: 11, font: regular, color: MUTE });
      y -= rowH;
    }
    const boxH = rowH - 8;
    const mid = rowH / 2 + density.time * 0.36;
    for (const row of slice) {
      page.drawText(fit(safe(row.name, bold), bold, 10.5, NAME_W - 22), { x: MARGIN + 12, y: y - (rowH / 2 + 3.6), size: 10.5, font: bold, color: INK });
      row.cells.forEach((cell, i) => {
        const x = MARGIN + NAME_W + i * DAY_W;
        const bx = x + 3;
        const bw = DAY_W - 6;
        if (!cell) return void page.drawText("·", { x: x + DAY_W / 2 - 1.5, y: y - (rowH / 2 + 3), size: 10, font: regular, color: QUIET });
        const note = cell.note ? safe(cell.note, regular) : null;
        if (cell.kind === "off") {
          roundRect(page, bx, y - 4, bw, boxH, 7, QUIET, true);
          page.drawText("İzin", { x: bx + 9, y: y - (note ? rowH / 2 - 1.5 : mid), size: density.time - 0.5, font: regular, color: MUTE });
          if (note) page.drawText(fit(note, regular, density.label + 1, bw - 16), { x: bx + 9, y: y - (rowH / 2 + density.label + 3.5), size: density.label + 1, font: regular, color: MUTE });
          return;
        }
        const preset = presetOf(branchId, cell);
        const tone = TONE[preset?.key ?? "other"];
        roundRect(page, bx, y - 4, bw, boxH, 7, tone.fill);
        // Sol kenarda vardiyanın rengi (renk tek başına anlam taşımaz: adı da yazılır)
        roundRect(page, bx + 4, y - 4 - (boxH - (boxH - 10)) / 2, 2.4, boxH - 10, 1.2, tone.bar);
        // Üst satır: hazır vardiyanın adı (ve not), yoksa not; alt satır: saatler
        const upper = preset ? upperTR(preset.label) : null;
        const tail = note ? (upper ? ` · ${note}` : note) : "";
        if (upper || tail) {
          const ly = y - (4 + boxH / 2 - 2.8);
          const used = upper ? spaced(page, upper, bx + 11, ly, density.label, bold, tone.label, 0.6) + 1 : 0;
          if (tail) page.drawText(fit(tail, regular, density.label + 0.5, bw - 16 - used), { x: bx + 11 + used, y: ly, size: density.label + 0.5, font: regular, color: tone.label });
          page.drawText(shiftTimes(cell), { x: bx + 11, y: y - (4 + boxH / 2 + density.time * 0.82), size: density.time, font: bold, color: INK });
        } else {
          page.drawText(shiftTimes(cell), { x: bx + 11, y: y - mid, size: density.time, font: bold, color: INK });
        }
      });
      const minutes = rowMinutes(row);
      const total = minutes ? hoursLabel(minutes) : "–";
      page.drawText(total, { x: PAGE_W - MARGIN - 12 - bold.widthOfTextAtSize(total, 10.5), y: y - (rowH / 2 + 3.6), size: 10.5, font: bold, color: minutes ? INK : QUIET });
      y -= rowH;
      page.drawLine({ start: { x: MARGIN + 6, y }, end: { x: PAGE_W - MARGIN - 6, y }, thickness: 0.6, color: LINE });
    }

    // ---- Son sayfada özet: gün gün çalışan sayısı ve toplam saat
    if (p === pages - 1 && rows.length) {
      spaced(page, "ÇALIŞAN", MARGIN + 12, y - 15, 7.5, bold, MUTE, 1);
      headcount.forEach((n, i) => {
        const text = n ? `${n} kişi` : "–";
        page.drawText(text, { x: MARGIN + NAME_W + i * DAY_W + 9, y: y - 15.5, size: 9.5, font: n ? bold : regular, color: n ? GREEN : QUIET });
      });
      const sum = hoursLabel(totalMinutes);
      page.drawText(sum, { x: PAGE_W - MARGIN - 12 - bold.widthOfTextAtSize(sum, 10.5), y: y - 15.5, size: 10.5, font: bold, color: GREEN });
    }

    // ---- Renklerin açıklaması: şubenin hazır vardiyaları ve izin
    let lx = MARGIN;
    const ly = MARGIN + 22;
    const legend = (text: string, draw: (x: number) => void) => {
      draw(lx);
      page.drawText(text, { x: lx + 17, y: ly, size: 8.5, font: regular, color: MUTE });
      lx += 17 + regular.widthOfTextAtSize(text, 8.5) + 20;
    };
    for (const preset of presets) {
      const tone = TONE[preset.key];
      legend(`${preset.label} ${presetText(preset)}`, (x) => {
        roundRect(page, x, ly + 8.5, 11, 11, 3, tone.fill);
        roundRect(page, x + 2, ly + 6.5, 2, 7, 1, tone.bar);
      });
    }
    if (presets.length) legend("Başka saat", (x) => roundRect(page, x, ly + 8.5, 11, 11, 3, TONE.other.fill));
    legend("İzin", (x) => roundRect(page, x, ly + 8.5, 11, 11, 3, QUIET, true));

    // ---- Alt bilgi
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 12 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 12 }, thickness: 0.6, color: LINE });
    const changed = input.updated ? ` · Son değişiklik: ${[input.updated.by ? safe(input.updated.by, regular) : null, stampTR(new Date(input.updated.at))].filter(Boolean).join(", ")}` : "";
    page.drawText(fit(`Oluşturulma: ${stampTR(input.generatedAt)}${changed}`, regular, 8, tableW - 130), { x: MARGIN, y: MARGIN, size: 8, font: regular, color: QUIET });
    const site = "ladmin.laffogato.net";
    page.drawText(site, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(site, 8), y: MARGIN, size: 8, font: regular, color: QUIET });
  }
  return doc.save();
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

import { DAY_NAMES, dayHeadcount, hoursLabel, plannedRows, rowMinutes, shiftTimes, weekDays, weekLabel, type ShiftRow } from "@/lib/vardiya";

/**
 * Vardiya planının PDF'i (docs/VARDIYA.md › PDF): A4 yatay, kişi × gün tablosu, haftalık saat toplamı ve gün gün çalışan
 * sayısı. Her istekte kaydedilen plandan yeniden çizilir (dosya saklanmaz): plan değişince PDF de değişir. "server-only"
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
const MARGIN = 36;
const INK = rgb(0.09, 0.09, 0.09);
const MUTE = rgb(0.44, 0.44, 0.48);
const QUIET = rgb(0.63, 0.63, 0.67);
const LINE = rgb(0.89, 0.89, 0.91);
const PANEL = rgb(0.957, 0.957, 0.961);
const OFF_FILL = rgb(0.975, 0.975, 0.98);
const LIME = rgb(0.753, 0.949, 0.118);

const NAME_W = 150;
const TOTAL_W = 64;
const DAY_W = (PAGE_W - 2 * MARGIN - NAME_W - TOTAL_W) / 7;
const HEAD_H = 34;
/** Satır yüksekliği: 11 kişiye kadar ferah, daha kalabalık planda sıkı (tek sayfaya 13 kişi) */
const ROW_H = 34;
const ROW_H_TIGHT = 28;
const ROWS_ROOMY = 11;
const FOOT_ROW_H = 26;

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const shortDate = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1]}`;

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

/** Köşeleri yuvarlak dikdörtgen (pdf-lib'in dikdörtgeni köşesiz): sol üst köşeden SVG yolu */
function roundRect(page: PDFPage, x: number, top: number, w: number, h: number, r: number, color: RGB) {
  const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  page.drawSvgPath(path, { x, y: top, color });
}

export async function renderShiftPdf(input: ShiftPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = loadFonts();
  // Dosyalar zaten Latin ve Türkçe harflere indirilmiş (≈52 KB): yeniden alt küme çıkarılmaz
  const regular = await doc.embedFont(bytes.regular, { subset: false });
  const bold = await doc.embedFont(bytes.bold, { subset: false });
  const title = `Vardiya planı · ${input.branchName} · ${weekLabel(input.monday)}`;
  doc.setTitle(title);
  doc.setAuthor("L'Affogato");
  doc.setCreator("ladmin.laffogato.net");
  doc.setProducer("ladmin.laffogato.net");
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);
  doc.setLanguage("tr-TR");

  const days = weekDays(input.monday);
  const rows = [...plannedRows(input.rows)];
  const branch = safe(input.branchName, bold);
  // Sayfa başına satır: başlık ve tablo başlığından sonra kalan yükseklik (son sayfada özet satırı ve alt bilgi)
  const tableTop = PAGE_H - MARGIN - 62;
  const rowH = rows.length <= ROWS_ROOMY ? ROW_H : ROW_H_TIGHT;
  // Satırın içinde taban çizgileri: tek satırlı metin ortada, notlu hücrede saat üstte not altta
  const oneLine = rowH / 2 + 3.5;
  const upper = rowH / 2 - 2.5;
  const lower = rowH / 2 + 8.5;
  const perPage = Math.max(1, Math.floor((tableTop - HEAD_H - FOOT_ROW_H - MARGIN - 22) / rowH));
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const headcount = dayHeadcount(rows);
  const totalMinutes = rows.reduce((sum, r) => sum + rowMinutes(r), 0);

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    // ---- Başlık: marka karosu, şube ve ad, sağda hafta
    const top = PAGE_H - MARGIN;
    roundRect(page, MARGIN, top, 34, 34, 9, INK);
    const mark = "L'Af";
    page.drawText(mark, { x: MARGIN + (34 - bold.widthOfTextAtSize(mark, 11)) / 2, y: top - 21, size: 11, font: bold, color: LIME });
    page.drawText(`L'Affogato · ${branch}`, { x: MARGIN + 46, y: top - 12, size: 10.5, font: regular, color: MUTE });
    page.drawText("Vardiya planı", { x: MARGIN + 46, y: top - 31, size: 18, font: bold, color: INK });
    const week = weekLabel(input.monday);
    page.drawText(week, { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(week, 15), y: top - 14, size: 15, font: bold, color: INK });
    const range = `${DAY_NAMES[0]} – ${DAY_NAMES[6]}${pages > 1 ? ` · sayfa ${p + 1} / ${pages}` : ""}`;
    page.drawText(range, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(range, 10), y: top - 30, size: 10, font: regular, color: MUTE });

    // ---- Tablo başlığı
    let y = tableTop;
    roundRect(page, MARGIN, y, PAGE_W - 2 * MARGIN, HEAD_H, 8, PANEL);
    page.drawText("Kişi", { x: MARGIN + 10, y: y - 21, size: 10, font: bold, color: INK });
    days.forEach((date, i) => {
      const x = MARGIN + NAME_W + i * DAY_W;
      page.drawText(DAY_NAMES[i], { x: x + 8, y: y - 15, size: 10, font: bold, color: INK });
      page.drawText(shortDate(date), { x: x + 8, y: y - 27, size: 8.5, font: regular, color: MUTE });
    });
    const totalHead = "Toplam";
    page.drawText(totalHead, { x: PAGE_W - MARGIN - 10 - bold.widthOfTextAtSize(totalHead, 10), y: y - 21, size: 10, font: bold, color: INK });
    y -= HEAD_H;

    // ---- Satırlar
    const slice = rows.slice(p * perPage, (p + 1) * perPage);
    if (!rows.length) {
      const empty = "Bu hafta için vardiya yazılmadı.";
      page.drawText(empty, { x: MARGIN + 10, y: y - 24, size: 11, font: regular, color: MUTE });
      y -= rowH;
    }
    for (const row of slice) {
      page.drawText(fit(safe(row.name, bold), bold, 10.5, NAME_W - 18), { x: MARGIN + 10, y: y - oneLine, size: 10.5, font: bold, color: INK });
      row.cells.forEach((cell, i) => {
        const x = MARGIN + NAME_W + i * DAY_W;
        if (!cell) return void page.drawText("–", { x: x + 8, y: y - oneLine, size: 10, font: regular, color: LINE });
        if (cell.kind === "off") {
          roundRect(page, x + 3, y - 4, DAY_W - 6, rowH - 8, 6, OFF_FILL);
          page.drawText("İzin", { x: x + 8, y: y - (cell.note ? upper : oneLine), size: 10, font: regular, color: MUTE });
        } else {
          page.drawText(shiftTimes(cell), { x: x + 8, y: y - (cell.note ? upper : oneLine), size: 10.5, font: bold, color: INK });
        }
        if (cell.note) page.drawText(fit(safe(cell.note, regular), regular, 8, DAY_W - 14), { x: x + 8, y: y - lower, size: 8, font: regular, color: MUTE });
      });
      const total = rowMinutes(row) ? hoursLabel(rowMinutes(row)) : "–";
      page.drawText(total, { x: PAGE_W - MARGIN - 10 - bold.widthOfTextAtSize(total, 10), y: y - oneLine, size: 10, font: bold, color: rowMinutes(row) ? INK : QUIET });
      y -= rowH;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.6, color: LINE });
    }

    // ---- Son sayfada özet: gün gün çalışan sayısı ve toplam saat
    if (p === pages - 1 && rows.length) {
      page.drawText("Çalışan", { x: MARGIN + 10, y: y - 17, size: 9.5, font: bold, color: MUTE });
      headcount.forEach((n, i) => {
        const text = n ? `${n} kişi` : "–";
        page.drawText(text, { x: MARGIN + NAME_W + i * DAY_W + 8, y: y - 17, size: 9.5, font: regular, color: n ? MUTE : QUIET });
      });
      const sum = hoursLabel(totalMinutes);
      page.drawText(sum, { x: PAGE_W - MARGIN - 10 - bold.widthOfTextAtSize(sum, 9.5), y: y - 17, size: 9.5, font: bold, color: MUTE });
    }

    // ---- Alt bilgi
    const changed = input.updated ? ` · Son değişiklik: ${[input.updated.by ? safe(input.updated.by, regular) : null, stampTR(new Date(input.updated.at))].filter(Boolean).join(", ")}` : "";
    page.drawText(fit(`Oluşturulma: ${stampTR(input.generatedAt)}${changed}`, regular, 8.5, PAGE_W - 2 * MARGIN - 130), { x: MARGIN, y: MARGIN - 8, size: 8.5, font: regular, color: QUIET });
    const site = "ladmin.laffogato.net";
    page.drawText(site, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(site, 8.5), y: MARGIN - 8, size: 8.5, font: regular, color: QUIET });
  }
  return doc.save();
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

import { DAY_NAMES, dayHeadcount, hoursLabel, plannedRows, presetOf, presetShort, presetText, rowMinutes, shiftPresets, shiftTimes, weekDays, weekLabel, type ShiftRow } from "@/lib/vardiya";

import { LAF_BEAN_PATH, LAF_LETTERS_PATH, LAF_MARK_BOX } from "./logo";

/**
 * Vardiya planının PDF'i (docs/VARDIYA.md › PDF): A4 yatay, sade (22 Kasım 2026: "daha tasarımsal ve minimalist").
 * Beyaz sayfa, ince çizgiler, renk yalnız iki yerde: logonun yeşili ve altını, vardiyanın harfi. Üstte L'Af logosu
 * (vektör), hafta ve şube; altında kişi × gün tablosu: sabahçı altın "S", akşamcı yeşil "A" daireyle ve saatleriyle,
 * başka saat boş daireyle, izin "İ" ile; planlanmayan gün boş. Sağda haftalık saat, altta gün gün çalışan sayısı ve
 * harflerin açıklaması. Her istekte kaydedilen plandan yeniden çizilir (dosya saklanmaz). "server-only" yok:
 * tests/vardiya.test.ts doğrudan çizdirir.
 *
 * Yazı tipi Inter'in (SIL OFL 1.1; fonts/OFL.txt) Latin ve Türkçe harflere indirilmiş kopyası (fonts/README.md):
 * PDF'in 14 standart yazı tipinde ğ, ş, ı, İ yoktur. Dosyalar çalışma anında diskten okunur; Vercel işlevine
 * `outputFileTracingIncludes` ile konur (next.config.ts).
 */

const FONT_DIR = join(process.cwd(), "src", "server", "vardiya", "fonts");
export const SHIFT_FONT_FILES = { regular: "Inter-Regular.subset.ttf", bold: "Inter-SemiBold.subset.ttf" } as const;

let fontBytes: { regular: Buffer; bold: Buffer } | null = null;
/** Inter'in Türkçe alt kümesi (normal ve kalın); kontrol listelerinin aylık PDF'i de kullanır (src/server/checklists/month-pdf.ts) */
export function loadFonts() {
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
const MARGIN = 44;
const hex = (v: string): RGB => rgb(parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255);
const INK = hex("#1e2a25");
const MUTE = hex("#6b7872");
const QUIET = hex("#aab5af");
const HAIR = hex("#e3e8e4");
const WHITE = rgb(1, 1, 1);
// Markanın renkleri (laffogato.net): derin yeşil ve altın
const GREEN = hex("#173f35");
const GOLD = hex("#c39a4f");
/** Vardiyanın dairesi: sabahçı altın, akşamcı yeşil */
const DOT = { morning: GOLD, evening: GREEN } as const;

const HEADER_H = 50;
const NAME_W = 128;
const TOTAL_W = 52;
const TABLE_W = PAGE_W - 2 * MARGIN;
const DAY_W = (TABLE_W - NAME_W - TOTAL_W) / 7;
const HEAD_H = 36;
/** Satır yüksekliği plana göre: 9 kişiye kadar ferah, 11'e kadar orta, daha kalabalıkta sıkı (tek sayfaya 13 kişi) */
const DENSITY = [
  { max: 9, rowH: 38, dot: 6.5, time: 9.2, note: 7 },
  { max: 11, rowH: 32, dot: 6, time: 9, note: 6.5 },
  { max: Infinity, rowH: 27, dot: 5.5, time: 8.6, note: 6 },
] as const;
const FOOT_ROW_H = 22;
/** Sayfanın altında (kenar boşluğu dahil) açıklama ve alt bilgi için ayrılan yükseklik */
const BOTTOM_RESERVE = MARGIN + 26;

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
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

/** Harf aralıklı küçük etiket (pdf-lib'de harf aralığı yok: harf harf çizilir) */
function spaced(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: RGB, track: number) {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + track;
  }
}
const spacedWidth = (text: string, size: number, font: PDFFont, track: number) => [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + track, -track);

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

  const branchId = input.branchId ?? "";
  const presets = shiftPresets(branchId);
  const days = weekDays(input.monday);
  const rows = [...plannedRows(input.rows)];
  const branch = safe(input.branchName, regular);
  const top = PAGE_H - MARGIN;
  const tableTop = top - HEADER_H - 10;
  const density = DENSITY.find((d) => rows.length <= d.max)!;
  const rowH = density.rowH;
  const perPage = Math.max(1, Math.floor((tableTop - HEAD_H - FOOT_ROW_H - BOTTOM_RESERVE) / rowH));
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const headcount = dayHeadcount(rows);
  const totalMinutes = rows.reduce((sum, r) => sum + rowMinutes(r), 0);
  const right = PAGE_W - MARGIN;

  /** Vardiyanın dairesi: dolu ve harfli (hazır vardiya), boş (başka saat) ya da boş ve harfli (izin); (cx, cy) merkezi */
  const mark = (page: PDFPage, cx: number, cy: number, r: number, o: { fill?: RGB; letter?: string }) => {
    if (o.fill) page.drawCircle({ x: cx, y: cy, size: r, color: o.fill });
    else page.drawCircle({ x: cx, y: cy, size: r - 0.4, borderColor: QUIET, borderWidth: 0.8 });
    if (!o.letter) return;
    const size = r * 1.15;
    page.drawText(o.letter, { x: cx - bold.widthOfTextAtSize(o.letter, size) / 2, y: cy - size * 0.36, size, font: bold, color: o.fill ? WHITE : MUTE });
  };

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    // ---- Başlık: solda logo (harfler yeşil, çekirdek altın), yanında hafta; sağda şube. Altında tek ince çizgi
    const logoH = 34;
    const scale = logoH / LAF_MARK_BOX.height;
    const logoW = LAF_MARK_BOX.width * scale;
    page.drawSvgPath(LAF_LETTERS_PATH, { x: MARGIN, y: top, scale, color: GREEN });
    page.drawSvgPath(LAF_BEAN_PATH, { x: MARGIN, y: top, scale, color: GOLD });
    const textX = MARGIN + logoW + 18;
    spaced(page, "VARDİYA PLANI", textX, top - 9, 7.5, bold, MUTE, 1.6);
    page.drawText(weekLabel(input.monday), { x: textX, y: top - 31, size: 21, font: bold, color: INK });
    const tag = pages > 1 ? `ŞUBE · SAYFA ${p + 1} / ${pages}` : "ŞUBE";
    spaced(page, tag, right - spacedWidth(tag, 7.5, bold, 1.6), top - 9, 7.5, bold, MUTE, 1.6);
    page.drawText(branch, { x: right - regular.widthOfTextAtSize(branch, 21), y: top - 31, size: 21, font: regular, color: GREEN });
    page.drawLine({ start: { x: MARGIN, y: top - HEADER_H + 4 }, end: { x: right, y: top - HEADER_H + 4 }, thickness: 1, color: GREEN });

    // ---- Tablo başlığı: günün adı küçük ve aralıklı, altında günün sayısı
    let y = tableTop;
    spaced(page, "KİŞİ", MARGIN, y - 12, 7, bold, MUTE, 1.2);
    days.forEach((date, i) => {
      const x = MARGIN + NAME_W + i * DAY_W;
      spaced(page, upperTR(DAY_NAMES[i]), x + 2, y - 12, 7, bold, MUTE, 1.2);
      const num = String(Number(date.slice(8, 10)));
      page.drawText(num, { x: x + 2, y: y - 28, size: 14, font: bold, color: INK });
      page.drawText(MONTHS_SHORT[Number(date.slice(5, 7)) - 1], { x: x + 2 + bold.widthOfTextAtSize(num, 14) + 4, y: y - 28, size: 8.5, font: regular, color: MUTE });
    });
    const totalHead = "TOPLAM";
    spaced(page, totalHead, right - spacedWidth(totalHead, 7, bold, 1.2), y - 12, 7, bold, MUTE, 1.2);
    y -= HEAD_H;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.6, color: QUIET });

    // ---- Satırlar: kutu yok; daire, saat ve altında not. Aralarında ince çizgi
    const slice = rows.slice(p * perPage, (p + 1) * perPage);
    if (!rows.length) {
      page.drawText("Bu hafta için vardiya yazılmadı.", { x: MARGIN, y: y - 24, size: 11, font: regular, color: MUTE });
      y -= rowH;
    }
    const r = density.dot;
    for (const row of slice) {
      const mid = y - rowH / 2;
      page.drawText(fit(safe(row.name, bold), bold, 10.5, NAME_W - 12), { x: MARGIN, y: mid - 3.7, size: 10.5, font: bold, color: INK });
      row.cells.forEach((cell, i) => {
        if (!cell) return;
        const x = MARGIN + NAME_W + i * DAY_W;
        const note = cell.note ? fit(safe(cell.note, regular), regular, density.note, DAY_W - 2 * r - 12) : null;
        // Notlu hücrede saat biraz yukarı, not altına
        const cy = note ? mid + density.note * 0.55 : mid;
        const tx = x + 2 + 2 * r + 5;
        if (cell.kind === "off") {
          mark(page, x + 2 + r, cy, r, { letter: "İ" });
          page.drawText("İzin", { x: tx, y: cy - density.time * 0.36, size: density.time, font: regular, color: MUTE });
        } else {
          const preset = presetOf(branchId, cell);
          mark(page, x + 2 + r, cy, r, preset ? { fill: DOT[preset.key], letter: presetShort(preset) } : {});
          page.drawText(shiftTimes(cell), { x: tx, y: cy - density.time * 0.36, size: density.time, font: regular, color: INK });
        }
        if (note) page.drawText(note, { x: tx, y: cy - density.time * 0.36 - density.note - 2, size: density.note, font: regular, color: MUTE });
      });
      const minutes = rowMinutes(row);
      const total = minutes ? hoursLabel(minutes) : "–";
      page.drawText(total, { x: right - bold.widthOfTextAtSize(total, 10), y: mid - 3.5, size: 10, font: bold, color: minutes ? INK : QUIET });
      y -= rowH;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.5, color: HAIR });
    }

    // ---- Son sayfada özet: gün gün çalışan sayısı ve toplam saat
    if (p === pages - 1 && rows.length) {
      spaced(page, "ÇALIŞAN", MARGIN, y - 14.5, 7, bold, MUTE, 1.2);
      headcount.forEach((n, i) => {
        if (n) page.drawText(`${n} kişi`, { x: MARGIN + NAME_W + i * DAY_W + 2, y: y - 15, size: 9, font: regular, color: MUTE });
      });
      const sum = hoursLabel(totalMinutes);
      page.drawText(sum, { x: right - bold.widthOfTextAtSize(sum, 10), y: y - 15, size: 10, font: bold, color: GREEN });
    }

    // ---- Alt bilgi: solda harflerin açıklaması, sağda oluşturulma anı
    const fy = MARGIN + 2;
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 16 }, end: { x: right, y: MARGIN + 16 }, thickness: 0.5, color: HAIR });
    let lx = MARGIN;
    const legend = (text: string, o: { fill?: RGB; letter?: string }) => {
      mark(page, lx + 5, fy + 3, 5, o);
      page.drawText(text, { x: lx + 14, y: fy, size: 8, font: regular, color: MUTE });
      lx += 14 + regular.widthOfTextAtSize(text, 8) + 18;
    };
    for (const preset of presets) legend(`${preset.label} ${presetText(preset)}`, { fill: DOT[preset.key], letter: presetShort(preset) });
    if (presets.length) legend("Başka saat", {});
    legend("İzin", { letter: "İ" });
    const changed = input.updated ? ` · Son değişiklik: ${[input.updated.by ? safe(input.updated.by, regular) : null, stampTR(new Date(input.updated.at))].filter(Boolean).join(", ")}` : "";
    const stamp = fit(`Oluşturulma: ${stampTR(input.generatedAt)}${changed}`, regular, 7.5, right - lx - 8);
    page.drawText(stamp, { x: right - regular.widthOfTextAtSize(stamp, 7.5), y: fy, size: 7.5, font: regular, color: QUIET });
  }
  return doc.save();
}

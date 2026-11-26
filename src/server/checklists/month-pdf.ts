import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

import type { MonthListBlock, MonthReport } from "@/lib/checklist-month";
import { longDateTR } from "@/lib/reminders";

import { LAF_BEAN_PATH, LAF_LETTERS_PATH, LAF_MARK_BOX } from "../vardiya/logo";
import { loadFonts } from "../vardiya/pdf";

/**
 * Kontrol listelerinin aylık PDF'i (docs/KONTROL-LISTELERI.md › Aylık PDF): A4 dikey, denetime hazır. İlk sayfada ayın
 * özeti (beklenen, tamamlanan, eksik, doldurulmayan liste; kapalı gün, sorun, fotoğraf) ve eksik günler; sonra gün gün
 * listeler: her maddenin yanıtı, işaretleyen, saat ve fotoğraf (Var / Yok). Doldurulmamış listenin maddeleri yazılmaz,
 * tek satır söyler. Vardiya PDF'inin yazı tipi (Inter, Türkçe alt küme) ve logosu. "server-only" yok:
 * tests/kontrol-aylik.test.ts doğrudan çizdirir. Her istekte kayıtlardan yeniden çizilir (dosya saklanmaz).
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const RIGHT = PAGE_W - MARGIN;
const WIDTH = PAGE_W - 2 * MARGIN;
const hex = (v: string): RGB => rgb(parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255);
const INK = hex("#1e2a25");
const MUTE = hex("#6b7872");
const QUIET = hex("#aab5af");
const HAIR = hex("#e3e8e4");
const BAND = hex("#f3f5f3");
const GREEN = hex("#173f35");
const GOLD = hex("#c39a4f");
const BAD = hex("#b42318");
const WARN = hex("#a15c07");

/** Madde tablosunun sütunları (x başlangıcı ve genişlik) */
const COLS = { label: { x: 0, w: 180 }, answer: { x: 184, w: 177 }, by: { x: 365, w: 80 }, time: { x: 449, w: 32 }, photo: { x: 485, w: 30 } } as const;
const ROW_SIZE = 8.4;
const LINE_H = 10.6;
const BOTTOM = MARGIN + 24;

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
function stampTR(at: Date): string {
  const tr = new Date(at.getTime() + 3 * 3_600_000).toISOString();
  return `${Number(tr.slice(8, 10))} ${MONTHS[Number(tr.slice(5, 7)) - 1]} ${tr.slice(0, 4)} ${tr.slice(11, 16)}`;
}

/** Yazı tipinde olmayan karakter (emoji, başka alfabe) çizimi düşürmesin: "?" olur */
function safeWith(set: Set<number>) {
  return (text: string) => [...text].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

/** Metni genişliğe göre satırlara böler; `max` satırı aşarsa son satır "…" ile biter */
export function wrapText(text: string, font: PDFFont, size: number, width: number, max = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
      // Tek kelime sığmıyorsa harf harf kırpılır
      while (font.widthOfTextAtSize(cur, size) > width && cur.length > 1) {
        let cut = cur.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(cur.slice(0, cut), size) > width) cut--;
        lines.push(cur.slice(0, cut));
        cur = cur.slice(cut);
      }
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= max) return lines.length ? lines : [""];
  const kept = lines.slice(0, max);
  let last = `${kept[max - 1]}…`;
  while (font.widthOfTextAtSize(last, size) > width && last.length > 1) last = `${last.slice(0, -2)}…`;
  kept[max - 1] = last;
  return kept;
}

export async function renderChecklistMonthPdf(report: MonthReport, generatedAt: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = loadFonts();
  const regular = await doc.embedFont(bytes.regular, { subset: false });
  const bold = await doc.embedFont(bytes.bold, { subset: false });
  const safe = safeWith(new Set(regular.getCharacterSet()));
  const title = `Kontrol listeleri · ${report.title} · ${report.branch}`;
  doc.setTitle(title);
  doc.setAuthor("L'Affogato");
  doc.setCreator("ladmin.laffogato.net");
  doc.setProducer("ladmin.laffogato.net");
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);
  doc.setLanguage("tr-TR");

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const text = (t: string, x: number, yy: number, size: number, font: PDFFont = regular, color: RGB = INK) => page.drawText(safe(t), { x, y: yy, size, font, color });

  /** Sonraki sayfalarda ince başlık */
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    text(`Kontrol listeleri · ${report.title}`, MARGIN, y - 9, 9, bold, GREEN);
    const b = safe(report.branch);
    page.drawText(b, { x: RIGHT - regular.widthOfTextAtSize(b, 9), y: y - 9, size: 9, font: regular, color: MUTE });
    y -= 16;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.6, color: HAIR });
    y -= 10;
  };
  const need = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };

  // ---- İlk sayfa: logo, başlık, özet ve eksik günler
  const logoH = 34;
  const scale = logoH / LAF_MARK_BOX.height;
  const logoW = LAF_MARK_BOX.width * scale;
  page.drawSvgPath(LAF_LETTERS_PATH, { x: MARGIN, y, scale, color: GREEN });
  page.drawSvgPath(LAF_BEAN_PATH, { x: MARGIN, y, scale, color: GOLD });
  const tx = MARGIN + logoW + 16;
  text("KONTROL LİSTELERİ · AYLIK KAYIT", tx, y - 9, 7.5, bold, MUTE);
  text(report.title, tx, y - 31, 20, bold, INK);
  const branch = safe(report.branch);
  page.drawText(branch, { x: RIGHT - regular.widthOfTextAtSize(branch, 16), y: y - 31, size: 16, font: regular, color: GREEN });
  y -= 46;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 1, color: GREEN });
  y -= 22;

  const t = report.totals;
  const stats: [string, string, RGB][] = [
    ["Beklenen liste", String(t.expected), INK],
    ["Tamamlanan", String(t.complete), GREEN],
    ["Eksik", String(t.partial), t.partial ? WARN : INK],
    ["Doldurulmadı", String(t.missing), t.missing ? BAD : INK],
    ["Kapalı gün", String(t.closedDays), INK],
    ["Sorun / aralık dışı", String(t.issues), t.issues ? WARN : INK],
    ["Fotoğraf", String(t.photos), INK],
  ];
  const cellW = WIDTH / stats.length;
  stats.forEach(([label, value, color], i) => {
    const x = MARGIN + i * cellW;
    text(value, x, y - 16, 16, bold, color);
    text(label, x, y - 28, 7.5, regular, MUTE);
  });
  y -= 44;

  text(report.gaps.length ? "Eksik ya da doldurulmamış listesi olan günler" : "Bütün günlerin listeleri tamamlandı.", MARGIN, y, 10, bold, report.gaps.length ? INK : GREEN);
  y -= 14;
  for (const g of report.gaps) {
    const lines = wrapText(safe(g.lists.join(" · ")), regular, 8.5, WIDTH - 110, 4);
    need(lines.length * 11 + 2);
    text(longDateTR(g.day), MARGIN, y, 8.5, bold);
    lines.forEach((l, i) => text(l, MARGIN + 110, y - i * 11, 8.5, regular, MUTE));
    y -= lines.length * 11 + 2;
  }
  y -= 8;
  const note = wrapText(
    "Her madde listede işaretlendiği hâliyle: yanıt, işaretleyen kişi ve saat (Türkiye). Fotoğraf sütunu fotoğrafın çekilip çekilmediğini söyler; fotoğraflar panelde 60 gün saklanır, kayıt silinmez. Kafenin kapalı işaretli günlerinde doldurulmamış liste eksik sayılmaz.",
    regular,
    7.5,
    WIDTH,
    4,
  );
  need(note.length * 10);
  note.forEach((l, i) => text(l, MARGIN, y - i * 10, 7.5, regular, QUIET));
  y -= note.length * 10 + 6;

  // ---- Gün gün
  const listHeader = (b: MonthListBlock) => {
    need(40);
    page.drawRectangle({ x: MARGIN, y: y - 14, width: WIDTH, height: 18, color: BAND });
    text(`${b.name}  ·  ${b.window}`, MARGIN + 6, y - 9, 9, bold);
    const color = b.state === "complete" ? GREEN : b.state === "partial" ? WARN : BAD;
    const st = safe(b.stateText);
    page.drawText(st, { x: RIGHT - 6 - bold.widthOfTextAtSize(st, 8.5), y: y - 9, size: 8.5, font: bold, color });
    y -= 22;
  };
  const tableHead = () => {
    text("Madde", MARGIN + COLS.label.x, y, 7, bold, MUTE);
    text("Yanıt", MARGIN + COLS.answer.x, y, 7, bold, MUTE);
    text("İşaretleyen", MARGIN + COLS.by.x, y, 7, bold, MUTE);
    text("Saat", MARGIN + COLS.time.x, y, 7, bold, MUTE);
    text("Foto", MARGIN + COLS.photo.x, y, 7, bold, MUTE);
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: QUIET });
    y -= 10;
  };

  for (const d of report.days) {
    need(48);
    y -= 6;
    text(longDateTR(d.day), MARGIN, y, 11.5, bold, GREEN);
    if (d.closed) text("Kafe kapalıydı", MARGIN + bold.widthOfTextAtSize(safe(longDateTR(d.day)), 11.5) + 10, y, 9, regular, MUTE);
    y -= 14;
    if (!d.lists.length) {
      text(d.closed ? "Liste doldurulmadı (kapalı gün)." : "Bu gün beklenen liste yok.", MARGIN, y, 8.5, regular, MUTE);
      y -= 14;
      continue;
    }
    for (const b of d.lists) {
      listHeader(b);
      if (b.state === "missing") {
        const required = b.items.filter((i) => i.missing).length;
        text(`Liste doldurulmadı: ${required} zorunlu madde yanıtsız.`, MARGIN + 6, y, 8.5, regular, BAD);
        y -= 16;
        continue;
      }
      tableHead();
      let section: string | null = null;
      for (const it of b.items) {
        if (it.section && it.section !== section) {
          need(14);
          text(it.section.toLocaleUpperCase("tr-TR"), MARGIN, y, 6.8, bold, MUTE);
          y -= 10;
          section = it.section;
        }
        const label = wrapText(safe(it.label), regular, ROW_SIZE, COLS.label.w);
        const answer = wrapText(safe(it.answer), it.issue || it.missing ? bold : regular, ROW_SIZE, COLS.answer.w);
        const by = wrapText(safe(it.by ?? "–"), regular, ROW_SIZE, COLS.by.w, 2);
        const lines = Math.max(label.length, answer.length, by.length);
        need(lines * LINE_H + 4);
        const color = it.missing ? BAD : it.issue ? WARN : INK;
        label.forEach((l, i) => text(l, MARGIN + COLS.label.x, y - i * LINE_H, ROW_SIZE));
        answer.forEach((l, i) => text(l, MARGIN + COLS.answer.x, y - i * LINE_H, ROW_SIZE, it.issue || it.missing ? bold : regular, color));
        by.forEach((l, i) => text(l, MARGIN + COLS.by.x, y - i * LINE_H, ROW_SIZE, regular, MUTE));
        text(it.time ?? "–", MARGIN + COLS.time.x, y, ROW_SIZE, regular, MUTE);
        text(it.photo ?? "", MARGIN + COLS.photo.x, y, ROW_SIZE, it.photo === "Yok" ? bold : regular, it.photo === "Yok" ? BAD : MUTE);
        y -= lines * LINE_H;
        page.drawLine({ start: { x: MARGIN, y: y + 3 }, end: { x: RIGHT, y: y + 3 }, thickness: 0.4, color: HAIR });
        y -= 4;
      }
      y -= 6;
    }
  }

  // ---- Alt bilgi: oluşturulma ve sayfa numarası (bütün sayfalar çizildikten sonra)
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 12 }, end: { x: RIGHT, y: MARGIN + 12 }, thickness: 0.5, color: HAIR });
    p.drawText(safe(`L'Affogato · ${title} · Oluşturulma: ${stampTR(generatedAt)}`), { x: MARGIN, y: MARGIN, size: 7, font: regular, color: QUIET });
    const n = `Sayfa ${i + 1} / ${pages.length}`;
    p.drawText(n, { x: RIGHT - regular.widthOfTextAtSize(n, 7), y: MARGIN, size: 7, font: regular, color: QUIET });
  });
  return doc.save();
}

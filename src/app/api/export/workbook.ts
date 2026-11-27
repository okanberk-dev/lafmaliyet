// "Dışa aktar" dosyası: panelin bütün sayfaları tek .xlsx çalışma kitabında. Saf işlev: veritabanına dokunmaz,
// testleri tests/export-workbook.test.ts (rakamlar) ve tests/export-bicim.test.ts (biçim).
//
// Sekmeler: Nasıl Okunur (kapak: dönem, kapsam, oluşturma zamanı, sayfa listesi) · Özet · Gelir-Gider · Sayım ·
// Tutarlılık · Ürün Kârlılık · Reçete Kartları · Satış · Hammaddeler · Faturalar · Aylık Alımlar · Personel · Sabit
// Giderler · Vergi (tahmin, dalga 12; vergi görünümü verildiyse) · Ayarlar, ardından gri sekmelerde yedek için bütün
// ayların ham kayıtları (Satış Kayıtları, Ay Bilgileri, Gelir-Gider Kayıtları, Sayım Kayıtları, Alım Miktarları). Dosya
// Özet'te açılır.

import ExcelJS from "exceljs";

import { fixedMonthly, inRange, isPartTime, monthOfDate, shiftMonth, yearMonths, type Model, type PnlMonthCalc } from "../../../lib/calc/engine";
import { layerText } from "../../../lib/calc/fifo";
import { consistency, dashboard, forecastMonthOf, missingRevenueText, openBalance, soldWithOnline, stockVatSummary, yearTotals } from "../../../lib/calc/insights";
import type { FixedPeriod, MonthField, MonthRange } from "../../../lib/calc/types";
import { MONTH_FIELDS } from "../../../lib/cash-month";
import { FIXED_PERIODS, FIXED_SECTIONS, GOODS_CATEGORIES, INVOICE_CATEGORIES, MONTH_NAMES, SEPARATE_CATEGORIES } from "../../../lib/constants";
import { dateTimeTR, dateTR, monthLabel, num, pct, tl } from "../../../lib/format";
import { purchaseVat, purchaseWithheld } from "../../../lib/kdv";
import { invoiceSourceLabel } from "../../../lib/import-labels";
import { SHARED_LABEL, UNASSIGNED_LABEL } from "../../../lib/invoice-branch";
import { monthKasa, salesMonthKasa, type MonthKasa } from "../../../lib/asilpos/kasa";
import { QUARTER_DEPRECIATION_LABELS } from "../../../lib/tax/assets";
import { monthName as taxMonthName, quarterLabel, quarterMonths } from "../../../lib/tax/calendar";
import { ACCOUNTANT_CHECKS } from "../../../lib/tax/checks";
import type { QuarterCalc } from "../../../lib/tax/corporate";
import { revenueDocumented, type RevenueSource, type TaxMonth, type TaxRow } from "../../../lib/tax/pnl";
import { allRules, CONFIDENCE_LABELS, overrideText, RULE_GROUPS, RULES_COMPILED_AT, RULES_VERIFIED_AT, rulesCompiledText, rulesFor, ruleValueText } from "../../../lib/tax/rules";
import type { TaxSettings } from "../../../lib/tax/settings";
import { CALENDAR_DAYS, INFLATION_LINE, type TaxView } from "../../../lib/tax/view";

// ---------------------------------------------------------------------------- Biçimler

const MONEY = '#,##0.00 "₺";[Red]-#,##0.00 "₺"';
const MONEY0 = '#,##0 "₺";[Red]-#,##0 "₺"';
/** Gelir-gider tablosu için: sıfır "-" görünür */
const MONEY0Z = '#,##0 "₺";[Red]-#,##0 "₺";"-"';
const PCT = "0.0%";
const PCTZ = '0.0%;[Red]-0.0%;"-"';
const RATE = "0.00%";
const QTY = "#,##0.###";
const UNIT_COST = "#,##0.0000";
const DATE = "dd.mm.yyyy";
/** Ay adları her dilde Türkçe görünsün (LCID 041F = tr-TR) */
const MONTH_SHORT = "[$-41F]mmm yyyy";
const MONTH_LONG = "[$-41F]mmmm yyyy";

/** Tablo başlığının zemini (koyu kahve, beyaz kalın yazı); testler de bu rengi arar */
export const HEADER_ARGB = "FF33211A";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
const SUBHEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
/** Toplam satırının zemini (açık kahve) ve üst çizgisi */
export const TOTAL_ARGB = "FFF3ECE6";
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_ARGB } };
const TOTAL_BORDER: Partial<ExcelJS.Borders> = { top: { style: "thin", color: { argb: "FF64412A" } } };
const SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FF64412A" } };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 16, color: { argb: HEADER_ARGB } };
const MUTED_FONT: Partial<ExcelJS.Font> = { color: { argb: "FF71717A" } };
/** Ham kayıt (yedek) sekmelerinin rengi: asıl sekmelerden ayrılsın */
const RAW_TAB: Partial<ExcelJS.Color> = { argb: "FFA1A1AA" };
const BRAND_TAB: Partial<ExcelJS.Color> = { argb: "FF64412A" };
/** Kendiliğinden genişleyen sütunun en çok genişliği (karakter): uzun açıklamalar sarılır ya da taşar */
const MAX_AUTO_WIDTH = 48;
/** Raporun adı (kapak, dosya özellikleri, sayfa üst bilgisi) */
export const REPORT_TITLE = "L'Affogato – Maliyet ve Kârlılık Raporu";

/** Gelir-gider bölüm başlıkları (ekrandaki SECTION_LABELS'ın büyük harfi) */
export const PNL_SECTION_LABELS: Record<string, string> = {
  mal: "MAL ALIŞLARI",
  devir: "DEVİRLER",
  personel: "PERSONEL GİDERLERİ",
  faturalar: "FATURALAR",
  kira: "KİRA",
  genel: "İŞLETME GENEL GİDERLERİ",
  komisyon: "KOMİSYON GİDERLERİ",
  toplam: "TOPLAMLAR",
  sonuc: "MALİYET",
  oran: "ORANLAR",
};

/** Yıl toplamı olmayan satırlar: stok bir andaki değerdir, toplanmaz */
const NO_YEAR_TOTAL = new Set(["stock:opening", "stock:closing"]);

const STATUS_LABEL = { active: "Devam ediyor", ended: "Bitti", upcoming: "Başlamadı" } as const;

// ---------------------------------------------------------------------------- Girdi

export interface ExportExtras {
  /**
   * Tek seferlik yatırımlar (Sabit Giderler altında, aylık gidere dahil değil). Şube dosyasında o şubenin ve işletme
   * genelinin (boş şube) yatırımları; "Tümü"de hepsi (şube ayrımı)
   */
  investments: { name: string; amount: number; date: string | null; note: string | null; branchId?: string | null }[];
  /** Tutarlılık bulguları (reçetede olmayan alımlar, fiyat ve fatura kontrolü) */
  findings: { section: string; title: string; detail: string | null; resolved: boolean; createdAt?: Date | null }[];
  /** Kısmen ödenmiş Paraşüt faturasının kalan borcu (fatura kimliği → TL, KDV dahil); verilmezse faturanın kendi alanı */
  outstanding?: Map<number, number | null>;
  /** Tedarikçilere elle girilen cari kayıtlar (borç ve ödeme); yoksa "Cari hareketleri" sekmesi yok */
  cari?: CariExportRow[];
  /** Vergi sayfasının görünümü ve ayarları (dalga 12); yoksa "Vergi" sekmesi yok */
  tax?: TaxExport | null;
  /** Dosyanın hazırlandığı an (testte sabitlenir) */
  now?: Date;
  /**
   * Dosyanın şube kapsamı (şube kapsamı C P1-9; şube ayrımı parça 6): Genel bakış'ın ve Ayarlar'ın düğmesi şube
   * seçiliyken seçimi gönderir. İlk sayfa (Nasıl Okunur) kapsamı ve alanların kipini yazar (`exportScopeText`). Verilmezse
   * "Tümü"
   */
  scope?: { label: string; branch: boolean; areas?: ExportAreas };
  /**
   * Şube dosyasının Tutarlılık sekmesi (Tutarlılık alanının kipiyle; şube ayrımı parça 6): firma kipinde bütün şubelerin
   * modeli, şube kipinde şubenin modeli ve şubeye seçilmiş faturaların alımı. Verilmezse dosyanın modeli
   */
  consistency?: { model: Model; label: string; note: string | null };
  /** Şubelerin adları (kimlik → ad): Faturalar sekmesinin Şube sütunu; verilmezse kimlik yazılır */
  branchNames?: ReadonlyMap<string, string>;
}

/** Şube dosyasında alanların kipi (src/app/api/export/route.ts: kişinin Şube görünümü; şube ayrımı parça 6) */
export interface ExportAreas {
  tutarlilik: "sube" | "firma";
  tedarikciler: "sube" | "firma";
  /** İşletme geneli giderler "Yalnız not" kipinde: tutarları dosyada yok */
  sharedHidden: boolean;
}

/**
 * Kapağın "Kapsam" satırı (şube ayrımı parça 6): "Tümü" dosyasında bütün şubeler; şube dosyasında satış, kasa, personel ve
 * şubenin giderleri şubenin, öbür sekmeler alanlarının kipiyle. Bulgular ve Alım Miktarları her dosyada firmanın
 */
export function exportScopeText(scope: ExportExtras["scope"]): string {
  if (!scope?.branch) return "Tümü: bütün şubeler ve laffogato.net birlikte; işletme geneli giderler bir kez sayılır.";
  const n = scope.label;
  const a = scope.areas;
  return [
    `${n} şubesi: satış, kasa, personel ve ${n} şubesine bağlı giderler yalnız bu şubenin.`,
    a?.sharedHidden
      ? `İşletme geneli giderler (şubesi seçilmemiş) ${n} şubesinin kârına girmez, tutarları bu dosyada yok (Tümü'de sayılır).`
      : `İşletme geneli giderler (şubesi seçilmemiş) "İşletme geneli payı" olarak bilgi.`,
    "Faturalar bu şubenin ve işletme geneli olanlar (şubesi seçilmemişler Tümü'de).",
    a?.tutarlilik === "sube" ? `Tutarlılık ${n} şubesinin; alınan yalnız şubeye seçilmiş faturalardan.` : "Tutarlılık firma geneli.",
    a?.tedarikciler === "sube" ? `Cari hareketleri: ${n} şubesinin ödemeleri; faturasız borç İşletme geneli.` : "Cari hareketleri firma geneli.",
    "Vergi firma geneli: vergi beyanı firmanın tek vergi numarasıyla, şubeye bölünmez.",
    "Tutarlılık bulguları ve Alım Miktarları firma geneli (şubesi yok).",
    "Sayfaların kipi Hesabım › Şube görünümü'nden; bütün şubeler için panelde soldan Tümü'nü seçip yeniden indirin.",
  ].join(" ");
}

/** "Vergi" sekmesinin girdisi (src/app/api/export/route.ts kurar: loadTaxView, vergi ayarları) */
export interface TaxExport {
  view: TaxView;
  settings: TaxSettings;
}

/** "Cari hareketleri" sekmesinin satırı (src/app/api/export/route.ts kurar; tutarlar KDV dahil) */
export interface CariExportRow {
  date: string;
  supplier: string;
  /** "Faturasız alım (faturası gelecek)", "Eski borç (devir)", "Ödeme" */
  movement: string;
  description: string | null;
  debt: number | null;
  payment: number | null;
  /** Ödemenin şekli ("Havale / EFT", "Kasadan (Teslim · Sütaş)") */
  method: string | null;
  /** Ödemenin sayıldığı kalemler ("SUT123 8.450,50 · hesapta 0,00") ya da borca sayılan ("ödenen 600,00") */
  counted: string | null;
  /** Borcun bağlandığı fatura */
  invoice: string | null;
  note: string | null;
}

// ---------------------------------------------------------------------------- Yardımcılar

interface Col {
  key: string;
  header?: string;
  width?: number;
  fmt?: string;
}

/** Sayfanın sütun başlıkları (addSheet'e verilen sırayla), headerRow(ws, colHeaders(ws)) için */
const HEADERS = new WeakMap<ExcelJS.Worksheet, Record<string, string>>();
/** Sayfanın ilk tablo başlığının satırı: yazdırmada her sayfada tekrarlanır */
const HEADER_ROW = new WeakMap<ExcelJS.Worksheet, number>();

/** Sayfanın tanımlı sütun sayısı (addSheet) */
const colCount = (ws: ExcelJS.Worksheet) => ws.columns?.length ?? ws.columnCount;

function addSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], opts: { x?: number; y?: number; landscape?: boolean; raw?: boolean } = {}) {
  const ws = wb.addWorksheet(name, {
    views: opts.x || opts.y ? [{ state: "frozen", xSplit: opts.x ?? 0, ySplit: opts.y ?? 0 }] : [],
    pageSetup: { paperSize: 9, orientation: opts.landscape ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: opts.raw ? { tabColor: RAW_TAB } : {},
  });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width ?? 16, style: c.fmt ? { numFmt: c.fmt } : {} }));
  HEADERS.set(ws, Object.fromEntries(cols.filter((c) => c.header !== undefined).map((c) => [c.key, c.header!])));
  return ws;
}

function colHeaders(ws: ExcelJS.Worksheet): Record<string, string> {
  return HEADERS.get(ws) ?? {};
}

/**
 * Koyu başlık satırı (tablonun sütun adları): sayfanın bütün sütunlarında koyu zemin, beyaz kalın yazı, alt çizgi;
 * sayı sütununun başlığı sağa yaslı. Satırın kendisine değil hücrelere uygulanır (zemin tablonun sağına taşmasın).
 */
function headerRow(ws: ExcelJS.Worksheet, values: Record<string, ExcelJS.CellValue>) {
  const r = ws.addRow(values);
  r.height = 30;
  for (let c = 1; c <= colCount(ws); c++) {
    const cell = r.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: ws.getColumn(c).numFmt ? "right" : "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF64412A" } } };
  }
  if (!HEADER_ROW.has(ws)) HEADER_ROW.set(ws, r.number);
  return r;
}

/** Sayfa içindeki ikinci tablonun açık renkli başlığı (sayfanın bütün sütunlarında) */
function subHeaderRow(ws: ExcelJS.Worksheet, values: Record<string, ExcelJS.CellValue>) {
  const r = ws.addRow(values);
  for (let c = 1; c <= colCount(ws); c++) {
    const cell = r.getCell(c);
    cell.font = { bold: true };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.fill = SUBHEADER_FILL;
    cell.border = { bottom: { style: "thin", color: { argb: "FFE4E4E7" } } };
  }
  return r;
}

/** Toplam satırı: kalın, açık kahve zemin, üstte ince çizgi (sayfanın bütün sütunlarında); yazı rengi korunur */
function totalRow(ws: ExcelJS.Worksheet, r: ExcelJS.Row) {
  for (let c = 1; c <= colCount(ws); c++) {
    const cell = r.getCell(c);
    cell.font = { ...cell.font, bold: true };
    cell.fill = TOTAL_FILL;
    cell.border = TOTAL_BORDER;
  }
  return r;
}

/**
 * Süzgeçle birlikte çalışan toplam: SUBTOTAL(109; aralık) yalnız görünen satırları toplar. Sonuç (dosya açılınca
 * yeniden hesaplanır) panelin toplamıdır; aralık boşsa 0
 */
function subtotal(col: string, from: number, to: number, result: number): ExcelJS.CellFormulaValue {
  return { formula: `SUBTOTAL(109,${col}${from}:${col}${to})`, result: round2(result) };
}

function sectionRow(ws: ExcelJS.Worksheet, key: string, text: string) {
  const r = ws.addRow({ [key]: text });
  r.font = SECTION_FONT;
  return r;
}

function setFmt(row: ExcelJS.Row, keys: string[], fmt: string) {
  for (const k of keys) row.getCell(k).numFmt = fmt;
}

/**
 * Hücrenin ekranda kapladığı yaklaşık karakter sayısı (sütun genişliği için). Sayı biçimiyle: binlik ayraç, ondalık,
 * "₺" ve "%" dahil; tarih 10 karakter. 40 karakterden uzun metin sayılmaz (açıklama, bölüm başlığı: sarılır ya da yan
 * hücreye taşar); sarılan başlık iki satıra bölünür.
 */
export function cellWidth(cell: ExcelJS.Cell): number {
  let v = cell.value as unknown;
  if (v && typeof v === "object" && "formula" in (v as object)) v = (v as ExcelJS.CellFormulaValue).result;
  if (v && typeof v === "object" && "result" in (v as object)) v = (v as { result: unknown }).result;
  const fmt = cell.numFmt ?? "";
  if (typeof v === "number") {
    const pct = fmt.includes("%");
    const int = Math.floor(Math.abs(pct ? v * 100 : v)).toString().length;
    const decimals = (fmt.match(/\.(0+)/)?.[1].length ?? 0) + (fmt.match(/\.(#+)/)?.[1].length ?? 0);
    return int + Math.floor((int - 1) / 3) + (decimals ? decimals + 1 : 0) + (v < 0 ? 1 : 0) + (fmt.includes("₺") ? 2 : 0) + (pct ? 1 : 0);
  }
  if (v instanceof Date) return fmt.includes("mmmm") ? 14 : 10;
  if (typeof v !== "string") return 0;
  if (cell.alignment?.wrapText) return Math.ceil(Math.max(...v.split(/\s+/).map((w) => w.length), v.length / 2));
  return v.length <= 40 ? v.length : 0;
}

/** Sütunu içeriğine göre genişletir (daraltmaz): rakam "####" görünmesin, kısa metin kesilmesin; en çok MAX_AUTO_WIDTH */
function fitColumns(ws: ExcelJS.Worksheet) {
  for (let c = 1; c <= colCount(ws); c++) {
    const col = ws.getColumn(c);
    let need = 0;
    col.eachCell({ includeEmpty: false }, (cell) => {
      need = Math.max(need, cellWidth(cell));
    });
    const cur = col.width ?? 10;
    const want = Math.min(need + 2, MAX_AUTO_WIDTH);
    if (want > cur) col.width = want;
  }
}

/** Otomatik süzgeç: başlık satırından son veri satırına, sayfanın bütün sütunları (toplam satırı dışarıda) */
function filterRows(ws: ExcelJS.Worksheet, head: number, last: number) {
  ws.autoFilter = { from: { row: head, column: 1 }, to: { row: Math.max(head, last), column: colCount(ws) } };
}

/** Üst ve alt bilgideki metin: "&" denetim karakteri, ikilenir */
const hfText = (s: string) => s.replace(/&/g, "&&");

/**
 * Yazdırma ve son biçim: A4, sayfaya sığdır, kenar boşlukları, üst bilgi (rapor · sayfa · dönem ve kapsam), alt bilgi
 * (oluşturulma, sayfa numarası), tablo başlığı her sayfada tekrar; sütun genişlikleri içeriğe göre
 */
function finishSheet(ws: ExcelJS.Worksheet, period: string, created: string) {
  ws.pageSetup.margins = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  ws.headerFooter.oddHeader = `&L&B${hfText("L'Affogato")}&B&C${hfText(ws.name)}&R${hfText(period)}`;
  ws.headerFooter.oddFooter = `&L${hfText(`Oluşturulma: ${created}`)}&RSayfa &P / &N`;
  const head = HEADER_ROW.get(ws);
  if (head && !ws.pageSetup.printTitlesRow) ws.pageSetup.printTitlesRow = `${head}:${head}`;
  fitColumns(ws);
}

/** Sütun harfi (1 → A, 27 → AA) */
function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/**
 * "YYYY-MM-DD" → çalışma kitabının tarihi. ExcelJS tarihi UTC'ye göre seri sayıya çevirir; yerel gece yarısı
 * (Türkiye UTC+3) bir önceki güne düşerdi, bu yüzden UTC gece yarısı kullanılır.
 */
export function excelDate(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d || 1));
}

const monthName = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
const round2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Aralık metni: "Temmuz 2026 – Eylül 2026", "Ekim 2026 ve sonrası", "Baştan beri" */
function rangeText(r: MonthRange): string {
  const s = r.startMonth ?? null;
  const e = r.endMonth ?? null;
  if (s && e) return s === e ? monthLabel(s) : `${monthLabel(s)} – ${monthLabel(e)}`;
  if (s) return `${monthLabel(s)} ve sonrası`;
  if (e) return `${monthLabel(e)} sonuna kadar`;
  return "Baştan beri";
}

/**
 * Gelir-gider yılı içinde başlayan ya da biten sabit gider: "Ekim 2026 itibarıyla · son ay Kasım 2026".
 * Gelir-gider ekranındaki satır alt yazısıyla aynı kural (verinin başladığı ayda başlayan kalem "baştan beri" sayılır).
 */
export function fixedRangeInYear(f: MonthRange | undefined, months: string[], firstDataMonth: string | null): string | null {
  if (!f || !months.length) return null;
  const first = months[0];
  const last = months[months.length - 1];
  const parts: string[] = [];
  if (f.startMonth && f.startMonth > first && f.startMonth <= last && (!firstDataMonth || f.startMonth > firstDataMonth)) parts.push(`${monthLabel(f.startMonth)} itibarıyla`);
  if (f.endMonth && f.endMonth >= first && f.endMonth < last) parts.push(`son ay ${monthLabel(f.endMonth)}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Yatırım tarihi serbest metindir: "2026-07" → "Temmuz 2026", "2026-07-06" → "06.07.2026", diğerleri olduğu gibi */
export function investmentDate(date: string | null): string | null {
  const v = date?.trim();
  if (!v) return null;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return monthLabel(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return dateTR(v);
  return v;
}

/** Aynı dosyadaki sekmeye bağlantı (HYPERLINK formülü: yaygın tablo programlarının hepsinde çalışır) */
function sheetLink(name: string): ExcelJS.CellFormulaValue {
  const target = `#'${name.replace(/'/g, "''")}'!A1`;
  return { formula: `HYPERLINK("${target.replace(/"/g, '""')}","${name.replace(/"/g, '""')}")`, result: name };
}

const periodLabel = (p: FixedPeriod) => FIXED_PERIODS.find((x) => x.key === p)?.label.toLocaleLowerCase("tr-TR") ?? p;

/** "160.000 ₺ aylık → Kasım 2026 itibarıyla 175.000 ₺ aylık" */
function historyText<T extends { fromMonth: string | null; versionId: number | null }>(entries: T[], value: (e: T) => string): string {
  return entries.map((e, i) => (i === 0 || !e.fromMonth ? value(e) : `${monthLabel(e.fromMonth)} itibarıyla ${value(e)}`)).join(" → ");
}

/**
 * Gelir-gider satırının yıl toplamı ("2026 YILI" sütunu).
 * Tutar satırları aylar toplanarak (hiç değer yoksa boş); stok devirleri toplanmaz; oranlar yıllık toplam ÷
 * yıllık KDV hariç ciro (ör. maliyet oranı = yılın giderleri ÷ yılın cirosu). Gelir-gider ekranının yıl sütunuyla aynı kural.
 */
export function pnlYearTotal(model: Pick<Model, "pnlValue">, calcs: PnlMonthCalc[], key: string): number | null {
  if (key.startsWith("ratio:")) {
    // Oranlar bütün cironun (ModPOS + laffogato.net online) payı; online satış yoksa ModPOS cirosu
    const rn = sum(calcs.map((c) => c.revenueTotalNet ?? 0));
    if (!rn) return null;
    const of = key.slice(6);
    const numerator = pnlYearTotal(model, calcs, of === "expenses" ? "total:expenses" : of === "profit" ? "profit" : `total:${of}`);
    return numerator === null ? null : numerator / rn;
  }
  if (NO_YEAR_TOTAL.has(key)) return null;
  const vals = calcs.map((c) => model.pnlValue(c, key).value);
  if (vals.every((v) => v === null)) return null;
  return sum(vals.map((v) => v ?? 0));
}

/** Su + buz birim maliyetinin nereden geldiği (Ayarlar sekmesindeki açıklama) */
export function waterExplanation(water: Model["water"]): string {
  switch (water.reason) {
    case "override":
      return "Ayarlar'da elle girildi; su faturasından hesaplanmıyor.";
    case "ok": {
      const web = water.onlineLiters > 0 ? ` (${num(water.onlineLiters, 1)} L laffogato.net siparişlerinden)` : "";
      const base = `${monthLabel(water.month!)} SU GİDERİ (${tl(water.bill)}) ÷ reçetelere göre ${num(water.liters, 1)} L su + buz${web}.`;
      return water.latestBillMonth && water.latestBillMonth !== water.month
        ? `${base} ${monthName(water.latestBillMonth)} su faturası da girildi ama ${monthName(water.latestBillMonth)} satış listesi yok; o ay litre hesaplanamadı.`
        : base;
    }
    case "no-usage":
      return `${monthName(water.latestBillMonth!)} su faturası girildi ama ${monthName(water.latestBillMonth!)} satış listesi yok; litre hesaplanamadı. Su ve buz reçetelerde 0 ₺ sayılıyor.`;
    default:
      return "Gelir-gider tablosuna SU GİDERİ girilmemiş; su ve buz reçetelerde 0 ₺ sayılıyor.";
  }
}

// ---------------------------------------------------------------------------- Çalışma kitabı

export function buildWorkbook(model: Model, month: string, extras: ExportExtras): ExcelJS.Workbook {
  const st = model.settings;
  const now = extras.now ?? new Date();
  const wb = new ExcelJS.Workbook();
  // Dosya özellikleri (Dosya › Bilgi): rapor adı, dönem, kapsam
  wb.creator = "L'Affogato Panel";
  wb.lastModifiedBy = "L'Affogato Panel";
  wb.created = now;
  wb.modified = now;
  wb.company = "L'Affogato";
  wb.title = `${REPORT_TITLE} · ${monthLabel(month)}`;
  wb.subject = `${monthLabel(month)} · ${extras.scope?.label ?? "Tümü"}`;
  wb.keywords = "maliyet, kârlılık, gelir-gider, faturalar, sayım";
  wb.description = "Yönetim paneli dışa aktarımı. Rakamlar paneldeki hesapla aynıdır; dosyadaki değişiklik panele geri gitmez.";
  // Faturalar'daki Net / KDV / Ay ve Aylık Alımlar formülleri dosya açılınca yeniden hesaplansın
  wb.calcProperties.fullCalcOnLoad = true;

  const label = monthLabel(month);
  // Ürün Kârlılık ve Reçete Kartları: satılan adet ModPOS + laffogato.net online (paneldeki Ürünler ve ürün kartı gibi)
  const sold = soldWithOnline(model, month);
  const d = dashboard(model, month);

  // İlk sekme kapak ve okuma rehberi; içeriği bütün sekmeler eklendikten sonra yazılır (sayfa listesi)
  const guide = addSheet(wb, GUIDE_SHEET, [
    { key: "a", width: 30 },
    { key: "b", width: 110 },
  ]);
  addOverview(wb, model, month, d, now);
  addPnl(wb, model, month);
  addStock(wb, model, month);
  addConsistency(wb, extras.consistency?.model ?? model, month, extras.findings, { label: extras.consistency?.label ?? null, note: extras.consistency?.note ?? null, firmFindings: extras.scope?.branch === true });

  // ---------------------------------------------------------------- Ürün Kârlılık
  const uk = addSheet(
    wb,
    "Ürün Kârlılık",
    [
      { key: "cat", header: "Kategori", width: 18 },
      { key: "name", header: "Ürün", width: 30 },
      { key: "size", header: "Boy", width: 7 },
      { key: "key", header: "Anahtar", width: 30 },
      { key: "price", header: "Satış fiyatı (KDV dahil)", fmt: MONEY },
      { key: "net", header: "Net satış (KDV hariç)", fmt: MONEY },
      { key: "kom", header: "POS komisyonu", fmt: MONEY },
      { key: "cost", header: "Malzeme + ambalaj maliyeti", fmt: MONEY },
      { key: "total", header: "Toplam maliyet", fmt: MONEY },
      { key: "profit", header: "Birim kâr", fmt: MONEY },
      { key: "margin", header: "Kâr marjı %", fmt: PCT },
      { key: "ratio", header: "Maliyet oranı %", fmt: PCT },
      { key: "sug", header: "Önerilen fiyat (KDV dahil)", fmt: MONEY0 },
      { key: "status", header: "Durum", width: 12 },
      { key: "qty", header: `${label} satış adedi`, fmt: "#,##0" },
      { key: "mp", header: `${label} brüt kâr`, fmt: MONEY0 },
      { key: "mn", header: `${label} net ciro`, fmt: MONEY0 },
      { key: "fire", header: "Fire oranı", fmt: PCT },
      { key: "active", header: "Satışta", width: 9 },
    ],
    { x: 3, y: 1, landscape: true },
  );
  const ukHeader = headerRow(uk, colHeaders(uk));
  ukHeader.getCell("mp").note = "Birim kâr × satış adedi. Reçetesi boş (Durum: Reçete yok) üründe boş: maliyeti bilinmiyor.";
  for (const k of ["profit", "margin", "ratio", "sug"]) ukHeader.getCell(k).note = "Reçetesi boş (Durum: Reçete yok) üründe boş: maliyeti bilinmiyor.";
  for (const p of model.products) {
    const qty = sold.get(p.product.id) ?? 0;
    // Reçetesi boş üründe kâr, marj, oran ve önerilen fiyat boş: maliyeti bilinmiyor, ~%98 marjla sıralamanın başına
    // çıkardı (Ürünler'deki tire; denetim E-47)
    const nr = p.status === "Reçete yok";
    uk.addRow({
      cat: p.category?.name,
      name: p.product.name,
      size: p.product.size,
      key: p.key,
      price: p.price,
      net: p.net,
      kom: p.commission,
      cost: p.cost,
      total: p.totalCost,
      profit: nr ? null : p.unitProfit,
      margin: nr ? null : p.margin,
      ratio: nr ? null : p.costRatio,
      sug: nr ? null : p.suggestedPrice,
      status: p.status,
      qty,
      mp: nr ? null : p.unitProfit * qty,
      mn: p.net * qty,
      fire: p.fireRate,
      active: p.product.active ? "Evet" : "Pasif",
    });
  }
  // Süzgeç yalnız ürün satırlarında; toplam bir boş satır altta ve süzülen ürünleri toplar (SUBTOTAL)
  const ukLast = uk.rowCount;
  filterRows(uk, 1, ukLast);
  if (model.products.length) {
    const col = (k: string) => colLetter(uk.getColumn(k).number);
    const qtys = model.products.map((p) => sold.get(p.product.id) ?? 0);
    uk.addRow({});
    const ut = uk.addRow({
      cat: "TOPLAM",
      qty: { formula: `SUBTOTAL(109,${col("qty")}2:${col("qty")}${ukLast})`, result: sum(qtys) },
      mp: subtotal(col("mp"), 2, ukLast, sum(model.products.map((p, i) => (p.status === "Reçete yok" ? 0 : p.unitProfit * qtys[i])))),
      mn: subtotal(col("mn"), 2, ukLast, sum(model.products.map((p, i) => p.net * qtys[i]))),
    });
    ut.getCell("cat").note = "Süzgeçte görünen ürünlerin satış adedi, brüt kârı ve net cirosu. Reçetesi boş ürünün brüt kârı toplama girmez.";
    totalRow(uk, ut);
  }

  // ---------------------------------------------------------------- Reçete Kartları
  const rc = addSheet(
    wb,
    "Reçete Kartları",
    [
      { key: "p", header: "Ürün", width: 30 },
      { key: "s", header: "Boy", width: 7 },
      { key: "i", header: "Malzeme", width: 30 },
      { key: "u", header: "Birim", width: 8 },
      { key: "q", header: "Miktar", fmt: QTY },
      { key: "f", header: "Formül", width: 18 },
      { key: "uc", header: "Birim maliyet (KDV hariç)", fmt: UNIT_COST },
      { key: "v", header: "KDV", width: 8, fmt: "0%" },
      { key: "t", header: "Toplam", fmt: MONEY },
      { key: "tv", header: "KDV dahil toplam", fmt: MONEY },
      { key: "use", header: `${label} kullanım`, fmt: QTY },
    ],
    { y: 1, landscape: true },
  );
  headerRow(rc, colHeaders(rc));
  for (const p of model.products) {
    const qtySold = sold.get(p.product.id) ?? 0;
    for (const l of p.lines) {
      const r = rc.addRow({ p: p.product.name, s: p.product.size, i: l.ingredient?.name, u: l.ingredient?.unit, q: l.qty, f: l.item.qtyExpr ?? "", uc: l.unitCost, v: l.vatRate, t: l.total, tv: l.totalVatIncl, use: qtySold ? l.qty * qtySold : null });
      if (l.qtyError) r.getCell("f").note = `Formül hatası: ${l.qtyError}`;
    }
    const r = rc.addRow({ p: p.product.name, s: p.product.size, i: `ÜRÜN MALİYETİ (fire %${num(p.fireRate * 100, 1)} dahil)`, t: p.cost });
    totalRow(rc, r);
  }
  // Süzgeç (ürüne, malzemeye göre): ürünün bütün satırları ve maliyet satırı aynı adla süzülür
  filterRows(rc, 1, rc.rowCount);

  addSales(wb, model, month);

  // ---------------------------------------------------------------- Hammaddeler
  const hm = addSheet(
    wb,
    "Hammaddeler",
    [
      { key: "n", header: "Malzeme", width: 30 },
      { key: "c", header: "Kategori", width: 14 },
      { key: "s", header: "Tedarikçi", width: 18 },
      { key: "pd", header: "Paket", width: 36 },
      { key: "pp", header: "Paket fiyatı (KDV hariç)", fmt: MONEY },
      { key: "ps", header: "Paket içeriği", fmt: QTY },
      { key: "u", header: "Birim", width: 8 },
      { key: "uc", header: "Birim maliyet", fmt: UNIT_COST },
      { key: "v", header: "Alış KDV", width: 9, fmt: "0%" },
      { key: "e", header: "Tahmini", width: 9 },
      { key: "cu", header: "Sayım birimi", width: 10 },
      { key: "cg", header: "Sayım grubu", width: 24 },
      { key: "a", header: "Durum", width: 9 },
      { key: "note", header: "Kaynak / not", width: 60 },
    ],
    { x: 1, y: 1, landscape: true },
  );
  headerRow(hm, colHeaders(hm));
  for (const i of model.ds.ingredients) {
    hm.addRow({
      n: i.name,
      c: i.category,
      s: i.supplier,
      pd: i.packageDesc,
      pp: i.priceSource === "water" ? null : i.packagePrice,
      ps: i.priceSource === "water" ? null : i.packageSize,
      u: i.unit,
      uc: model.unitCost.get(i.id),
      v: i.vatRate,
      e: i.isEstimate ? "Evet" : "",
      cu: i.countUnit ?? "Sayılmaz",
      cg: i.countUnit ? i.countGroup : null,
      a: i.active ? "Aktif" : "Pasif",
      note: i.priceSource === "water" ? [`Su + buz: ${waterExplanation(model.water)}`, i.note].filter(Boolean).join(" · ") : i.note,
    });
  }
  filterRows(hm, 1, hm.rowCount);

  addInvoices(wb, model, extras.outstanding, extras.branchNames);
  if (extras.cari?.length) addCari(wb, extras.cari, extras.scope?.branch ? (extras.scope.areas?.tedarikciler === "sube" ? `${extras.scope.label} şubesi` : "Firma geneli") : null);
  addPeople(wb, model, month, extras.investments, extras.scope?.branch === true);
  // Vergi (dalga 12): tahmin, beyanname değil; Personel ve Sabit Giderler'den sonra
  if (extras.tax) addTax(wb, extras.tax, { branchFile: extras.scope?.branch === true });

  // ---------------------------------------------------------------- Ayarlar
  const ay = addSheet(
    wb,
    "Ayarlar",
    [
      { key: "k", header: "Ayar", width: 40 },
      { key: "v", header: "Değer", width: 14 },
      { key: "x", header: "Açıklama", width: 90 },
    ],
    { y: 1 },
  );
  headerRow(ay, colHeaders(ay));
  const settingRows: [string, number | string, string | null, string][] = [
    ["Satış KDV oranı", st.kdv, PCT, "Menü fiyatları KDV dahil kabul edilir; net satış = fiyat ÷ (1 + KDV)."],
    ["Hizmet satışı KDV oranı", st.kdvHizmet, PCT, "Satışlar'da HİZMET işaretli satırlar (karaoke odası); ayın cirosundan bu satırlar kadarı bu oranla ayrılır."],
    ["Banka / POS komisyon oranı", st.komisyon, PCT, "Kasa raporu (kart tutarı) olmayan aylarda; kasa kartı olan ayda her şubenin kendi oranı (Şubeler) geçer."],
    ["Kartlı satış oranı (kredi kartı + yemek kartı)", st.kartOrani, PCT, "Kasa kartı olmayan ayda POS komisyonu = ciro × komisyon oranı × kartlı satış oranı; kasa kartı olan ayda şube şube kart (yemek kartı hariç) × şubenin POS oranı."],
    ["Hedef maliyet oranı (food cost)", st.hedefMaliyet, PCT, "Önerilen fiyat bu orana göre hesaplanır."],
    ["Fire / kayıp payı", st.fire, PCT, "Malzeme maliyetine eklenen dökülen / atılan mal payı (ürün kartında ayrı oran verilebilir)."],
    ["Fire ambalaja uygulanmaz", st.fireExcludesPackaging ? "Evet" : "Hayır", null, "Evet: fire payı bardak, kapak, peçete hariç malzemelere uygulanır."],
    ["Ambalajın alış KDV'si", st.alisKdvAmbalaj, PCT, "Sayımın Ambalaj grubunun olağan oranı: Hammaddeler'de yeni malzemeye önerilir; malzemenin kendi Alış KDV'si geçer."],
    ["Gıdanın alış KDV'si", st.alisKdvGida, PCT, "Sayımın öteki gruplarının olağan oranı; sayımda listede olmayan kalemlerin KDV dahil değeri bununla."],
    ["Tek shot kahve (gr)", st.shotTek, null, "Reçetelerdeki ShotTek formülü."],
    ["Çift shot kahve (gr)", st.shotCift, null, "Reçetelerdeki ShotCift formülü."],
    ["1 pompa şurup (ml)", st.pompa, null, "Reçetelerdeki Pompa formülü."],
    ["1 pompa püre (ml)", st.pompaPure, null, "Reçetelerdeki PurePompa formülü."],
    ["Filtre kahve: tam pot kahve (gr)", st.potGr, null, "Reçetelerdeki PotGr formülü."],
    ["Filtre kahve: tam pottan çıkan (ml)", st.potMl, null, "Reçetelerdeki PotMl formülü."],
    ["1 top dondurma (ml)", st.dondurmaTop, null, "Reçetelerdeki DondurmaTop formülü."],
    ["Türk kahvesi 1 fincan (gr)", st.tkGr, null, "Reçetelerdeki TKGr formülü."],
    ["Ayda kaç gün açıksınız", st.acikGun, null, "Başabaş günlük cirosu ve günlük sabit giderlerin standart ayı için."],
    ["İşçi SGK primi payı", st.isciSgk, RATE, "Brüt maaştan kesilir (Personel sekmesi)."],
    ["İşçi işsizlik sigortası payı", st.isciIssizlik, RATE, "Brüt maaştan kesilir."],
    ["İşveren SGK primi", st.isverenSgk, RATE, "Brüt maaşın üstüne işverence ödenir."],
    ["İşveren işsizlik sigortası payı", st.isverenIssizlik, RATE, "Brüt maaşın üstüne işverence ödenir."],
    ["Su + buz birim maliyeti (₺/litre)", model.water.perLiter, UNIT_COST, waterExplanation(model.water)],
  ];
  for (const [k, v, fmt, x] of settingRows) {
    const r = ay.addRow({ k, v, x });
    if (fmt) r.getCell("v").numFmt = fmt;
  }

  addRawRecords(wb, model);
  addRawStock(wb, model, extras.scope?.branch === true);
  fillGuide(guide, wb, model, month, now, extras.scope);
  // Son biçim: yazdırma düzeni, üst / alt bilgi, sütun genişlikleri (kapakta açıklama sütunu sabit)
  const period = `${label} · ${extras.scope?.label ?? "Tümü"}`;
  for (const ws of wb.worksheets) {
    if (ws === guide) {
      ws.pageSetup.margins = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
      ws.headerFooter.oddFooter = `&L${hfText(`Oluşturulma: ${dateTimeTR(now)}`)}&RSayfa &P / &N`;
    } else finishSheet(ws, period, dateTimeTR(now));
  }
  // Dosya Özet'te açılsın (rehber hemen solunda)
  wb.views = [{ x: 0, y: 0, width: 28800, height: 17000, firstSheet: 0, activeTab: 1, visibility: "visible" }];
  return wb;
}

// ---------------------------------------------------------------------------- Nasıl Okunur (kapak)

export const GUIDE_SHEET = "Nasıl Okunur";

/** Sekme adının başına göre bir satırlık açıklama (seçili ay ve yıl adlarda) */
function sheetPurpose(name: string, label: string, kasa: MonthKasa["both"] = "ModPOS", branchFile = false): string {
  const year = name.match(/^Gelir-Gider (\d{4})$/)?.[1];
  if (name === "Özet") return `Yönetim özeti: ${label} para nereye gitti, net kâr / zarar, başabaş cirosu, süren ayın tahmini, en kârlı ürün, kategori ortalamaları (sağda).`;
  if (year) return `Gelir-gider tablosu: Ocak–Aralık ve ${year} YILI toplamı. Elle düzeltilen hücrelerde not var.`;
  if (name.startsWith("Sayım ") && name !== "Sayım Kayıtları") return `${label} ay sonu stok sayımı: sayım biriminde miktar, grup toplamları ve KDV dahil değer. Değer Ayarlar'daki başlangıç ayından itibaren ilk giren ilk çıkar (FIFO; katmanlar Not sütununda), öncesinde ay sonu fiyatıyla. Boşsa sayım formu olarak yazdırılabilir.`;
  if (name.startsWith("Tutarlılık ")) return `${label}: POS ↔ satış listesi, reçete ↔ fatura ↔ sayım karşılaştırması ve bulgular.`;
  if (name.startsWith("Satış ") && name !== "Satış Kayıtları") return `${label} POS ürün satışları: eşleşen ürün, maliyet, kâr, durum ve not; üstte POS ciro, ödenmez, indirim ve ortalama maliyet oranı.`;
  const fixed: Record<string, string> = {
    "Ürün Kârlılık": `Her ürün ve boy: fiyat, maliyet, birim kâr, marj, önerilen fiyat, ${label} satış adedi (${kasa} + laffogato.net online). Süzgeç açık.`,
    "Reçete Kartları": "Her ürünün malzemeleri, miktarı, birim maliyeti ve KDV dahil tutarı; son satır fire dahil ürün maliyeti.",
    Hammaddeler: "Malzemelerin paket fiyatı, birim maliyeti, alış KDV'si, sayım birimi ve grubu.",
    Faturalar: "Bütün alış faturaları: tarih, kategori, net, KDV, tevkifat, durum, kalan borç, vade, not, vergi no, ETTN ve şube. Net ve Ay sütunları formül; KDV faturanın KDV toplamı (tevkifat düşülmeden), bilinmiyorsa formül.",
    "Aylık Alımlar": "Aylara göre net alımlar: kategori × ay (formülle Faturalar'dan), TOPLAM ve mal maliyeti.",
    Vergi: "Tahmin, beyanname değil: vergiye göre gelir-gider (yalnız geliri mali belgeden gelen aylar), kafenin geçici ve kurumlar vergisine katkısı, vergi takvimi, kullanılan kurallar ve sahibin notları.",
    "Cari hareketleri": "Tedarikçilere elle girilen faturasız alımlar, eski borçlar ve ödemeler: tutar, şekil, ödemenin sayıldığı kalemler ve bağlandığı fatura. Ödeme gider değildir.",
    Personel: `${label} maaş + SGK işveren maliyeti, yemek kartı ve part-time ücreti (sütunlar toplamı verir), TOPLAM, SGK oranları; varsa başlangıç / bitiş ve maaş geçmişi.`,
    "Sabit Giderler": `${label} sabit giderleri, aylık karşılığı ve TOPLAM; tek seferlik yatırımlar; varsa tutar geçmişi.`,
    Ayarlar: "KDV, komisyon, kartlı satış, hedef maliyet, fire, gramajlar, SGK oranları ve su + buz birim maliyeti.",
    "Satış Kayıtları": "Yedek: bütün ayların POS satış satırları (eşleşen ürün, hizmet, not).",
    "Ay Bilgileri": "Yedek: her ayın açık gün sayısı, POS cirosu, yönetici indirimi, ödenmez tutarı, kartlı satış oranı ve ay notu; kasa raporlarından gelenler ayrıca yazılır.",
    "Gelir-Gider Kayıtları": "Yedek: Gelir-gider tablosunda elle girilen ya da düzeltilen bütün hücreler ve notları.",
    "Sayım Kayıtları": "Yedek: bütün ayların stok sayımları (sayım biriminde ve malzemenin biriminde) ve listede olmayan kalemler.",
    "Alım Miktarları": `Yedek: Tutarlılık için girilen aylık faturayla alınan miktarlar.${branchFile ? " Firma geneli (şubesi yok)." : ""}`,
  };
  return fixed[name] ?? "";
}

function fillGuide(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook, model: Model, month: string, now: Date, scope: ExportExtras["scope"]) {
  const label = monthLabel(month);
  ws.properties.tabColor = BRAND_TAB;
  ws.pageSetup.fitToPage = true;
  const t = ws.addRow({ a: REPORT_TITLE });
  t.font = TITLE_FONT;
  t.height = 26;
  ws.addRow({ a: "Yönetim paneli dışa aktarımı · tutarlar Türk lirası (₺)" }).font = MUTED_FONT;

  const block = (title: string, rows: [string | ExcelJS.CellValue, string][]) => {
    ws.addRow({});
    sectionRow(ws, "a", title);
    for (const [a, b] of rows) {
      const r = ws.addRow({ a, b });
      r.getCell("b").alignment = { wrapText: true, vertical: "top" };
      r.getCell("a").alignment = { vertical: "top" };
      r.getCell("a").font = { bold: true };
    }
  };

  // Kapak: dönem, kapsam, oluşturulma, sayfa sayısı
  const sheets = wb.worksheets.filter((w) => w.name !== ws.name);
  const raw = sheets.filter((w) => w.properties.tabColor?.argb === RAW_TAB.argb).length;
  block("RAPOR BİLGİLERİ", [
    ["Dönem", `${label} · Gelir-Gider sayfası ${month.slice(0, 4)} yılının 12 ayı`],
    [
      "Kapsam",
      exportScopeText(scope),
    ],
    ["Oluşturulma", dateTimeTR(now)],
    ["Kaynak", "L'Affogato yönetim paneli (paneldeki kayıtların o anki hâli)"],
    ["Sayfalar", `${num(sheets.length)} sayfa${raw ? ` (${num(raw)} tanesi gri sekmede ham kayıt)` : ""}; liste aşağıda`],
  ]);
  block("BU DOSYA", [
    ["Panelin kopyası", "Rakamlar paneldeki hesapla aynıdır. Bu dosyada yaptığınız değişiklik panele geri gitmez: fiyatı, reçeteyi, faturayı ve gideri panelde değiştirip dosyayı yeniden indirin."],
    ["Seçili ay", `Özet, Sayım, Tutarlılık, Satış, Personel, Sabit Giderler ve Ürün Kârlılık'taki satış adetleri ${label} içindir. Başka bir ay için panelin Genel bakış ekranında ayı seçip 'Dışa aktar'a basın.`],
    ["Yedek", "Gri sekmeler bütün ayların ham kayıtlarıdır (satış, ay bilgisi, gelir-gider düzeltmeleri, sayım, alım miktarı). Seçili ay dışındaki veriler de buradadır."],
  ]);
  block("NASIL OKUNUR", [
    ["Köşesinde üçgen olan hücre", "Üzerine gelince açıklama çıkar: hesabın ne yaptığı, elle düzeltilen tutarın hesaplanan değeri ya da hücre notu."],
    ["Kırmızı sayı", "Eksi tutar: gider, zarar ya da fark."],
    ["\"-\"", "Gelir-gider tablosunda sıfır. Boş hücre o ay için veri yok demektir."],
    ["Formüller", "Faturalar'daki Net, Ay ve Tedarikçiye ödenen KDV sütunları ile Aylık Alımlar tablosu formüldür; Faturalar'da bir tutarı düzeltirseniz özet de güncellenir. KDV sütunu KDV toplamı bilinen (Paraşüt'ten gelen) faturada tutardır, tevkifatı ayrı sütunda. Diğer sekmelerdeki rakamlar panelin hesapladığı değerlerdir."],
    [
      "KDV",
      `Menü fiyatları KDV dahil (%${num(model.settings.kdv * 100, 1)}; karaoke gibi hizmet satışları %${num(model.settings.kdvHizmet * 100, 1)}); malzeme ve gider tutarları KDV hariçtir (alışta ödenen KDV indirilebildiği için).`,
    ],
  ]);
  // Sayfa listesi: başlıklı tablo, adına tıklayınca sayfa açılır
  ws.addRow({});
  sectionRow(ws, "a", "SAYFALAR (adına tıklayınca açılır)");
  subHeaderRow(ws, { a: "Sayfa", b: "İçerik" });
  // Ayın kasası (geçiş günü boşken ve öncesinde ModPOS; denetim E-39)
  const kasa = monthKasa(month, model.settings.asilposGecisGunu).both;
  for (const w of sheets) {
    const r = ws.addRow({ a: sheetLink(w.name), b: sheetPurpose(w.name, label, kasa, scope?.branch === true) });
    r.getCell("b").alignment = { wrapText: true, vertical: "top" };
    r.getCell("a").alignment = { vertical: "top" };
    // Bağlantılar mavi ve altı çizili görünsün
    r.getCell("a").font = { color: { argb: "FF1D4ED8" }, underline: true };
  }
}

// ---------------------------------------------------------------------------- Özet

function addOverview(wb: ExcelJS.Workbook, model: Model, month: string, d: ReturnType<typeof dashboard>, now: Date) {
  const label = monthLabel(month);
  const name = monthName(month);
  const catLabel = d.categoryMonth ? monthLabel(d.categoryMonth) : label;
  const ws = addSheet(
    wb,
    "Özet",
    [
      { key: "k", header: "Gösterge", width: 50 },
      { key: "v", header: label, width: 22, fmt: MONEY0 },
      { key: "gap", header: "", width: 3 },
      { key: "cn", header: "Kategori", width: 22 },
      { key: "cc", header: "Ürün sayısı", width: 11 },
      { key: "cm", header: "Ort. kâr marjı", width: 13, fmt: PCT },
      { key: "cu", header: "Ort. birim kâr", width: 14, fmt: MONEY },
      { key: "cr", header: "Ort. maliyet oranı", width: 14, fmt: PCT },
      { key: "cq", header: `Satış (adet) · ${catLabel}`, width: 16, fmt: "#,##0" },
      { key: "cp", header: `Brüt kâr · ${catLabel}`, width: 16, fmt: MONEY0 },
    ],
    { y: 1 },
  );
  // Dosya bu sekmede açılır (wb.views activeTab)
  const view: Partial<ExcelJS.WorksheetView> & { tabSelected: boolean } = { state: "frozen", xSplit: 0, ySplit: 1, tabSelected: true };
  ws.views = [view];
  headerRow(ws, colHeaders(ws));

  const t = d.theoretical;
  type Line = { k: string; v?: ExcelJS.CellValue; fmt?: string; strong?: boolean; section?: boolean; note?: string };
  const lines: Line[] = [{ k: `${label.toLocaleUpperCase("tr-TR")} – PARA NEREYE GİTTİ? (KDV hariç)`, section: true }];
  if (!t) {
    lines.push({ k: "Bu ayın satış listesi yüklenmemiş: reçeteye göre satırlar boş. Faturaya göre kâr yine aşağıda.", v: null });
  }
  // Ayın kasası (metinler; geçiş günü boşken ve öncesinde ModPOS, sonra AsilPOS; denetim E-39)
  const mk = salesMonthKasa(month, model.settings.asilposGecisGunu, model.ds.asilposSales);
  const kasaSales = mk.source === "modpos" ? `${mk.report} satış listesi` : `${mk.report} satışları`;
  lines.push(
    // ModPOS + laffogato.net online (kâr-zarardaki gibi); online ayrıca alt satırda
    { k: "Satışlar (net ciro)", v: t?.netSales ?? null, note: t?.online ? `${kasaSales} + laffogato.net online satışı, KDV hariç.` : undefined },
    ...(t?.online
      ? [
          { k: `   ${mk.source === "modpos" ? "ModPOS satış listesi" : `${mk.short} satışları`}`, v: t.posNetSales },
          {
            k: "   laffogato.net online (kafe, mağaza, karaoke)",
            v: t.online.revenue,
            note: "Gelir-gider'deki online satırlar, KDV hariç; malzemesi reçeteye göre (menüye bağlı olmayan satırlar ve mağaza kolileri ortalama maliyet oranıyla).",
          },
        ]
      : []),
    { k: "– İndirimler (yönetici indirimi)", v: t ? -t.discountsNet : null },
    { k: "– Malzeme + ambalaj (reçeteye göre)", v: t ? -t.material : null },
    { k: "– Kart / POS komisyonu", v: t ? -t.commission : null },
    { k: "Brüt kâr (indirim öncesi)", v: t?.grossProfit ?? null },
  );
  // Sabit gider grupları: Kira / Personel / Reklam / Diğer (+ varsa bu aya özel Gelir-gider satırları)
  const flow = t?.fixedFlow ?? d.fixedMonth.flow;
  for (const l of flow) {
    lines.push({ k: `– ${l.label}`, v: t ? -l.amount : null, note: [l.hint, l.items.length ? `En büyük kalemler: ${l.items.join(", ")}` : ""].filter(Boolean).join(" ") });
  }
  lines.push({
    k: `${name.toLocaleUpperCase("tr-TR")} NET KÂR / ZARAR (reçeteye göre)`,
    v: t?.netProfit ?? null,
    strong: true,
    note: `Brüt kâr${t?.online ? " (laffogato.net online satışı dahil)" : ""} − indirim − o ayın Gelir-gider sabit giderleri (gün oranı ve bu aya özel giderler dahil). SU GİDERİ reçetelerde su + buz olarak sayıldıysa burada ikinci kez düşülmez.${
      t?.listPeriod ? ` Satış listesi ayın ${t.listPeriod.of} gününün ${t.listPeriod.days}'ini kapsıyor: indirim o günlerin kasa raporlarından, sabit gider ve online satış o günlere düşen payla.` : ""
    }`,
  });
  // Standart aylık sabit giderle net kâr (her ay aynı sabit gider toplamı): o ayın Gelir-gider'inden farklıysa
  if (t && Math.abs(t.netProfit - t.netProfitStandard) >= 1) {
    lines.push({
      k: "Net kâr / zarar (standart sabit giderle)",
      v: t.netProfitStandard,
      note: `Her ay aynı standart sabit gider toplamı düşülür (${tl(d.fixedStandardTotal)}). Fark: gün etkisi ${tl(d.fixedMonth.proration)}, Gelir-gider'de düzeltilen tutarlar ${tl(d.fixedMonth.overrides)}, bu aya özel giderler ${tl(d.fixedMonth.manual)}${d.fixedMonth.expenses ? `, aylık harcamalar ${tl(d.fixedMonth.expenses)}` : ""}${
        t.fixedBreakdown.listShare ? `, satış listesinin günleri ${tl(t.fixedBreakdown.listShare.amount)}` : ""
      }.`,
    });
  }
  // Hiç verisi olmayan ayda (ay bilgisi, fatura, Gelir-gider girişi, sayım yok) 0 yazılmaz: "veri yok" ile "kâr 0" karışmasın
  const monthHasData =
    model.monthInfo.has(month) ||
    model.ds.invoices.some((i) => i.date.startsWith(month)) ||
    model.ds.pnlEntries.some((e) => e.month === month) ||
    model.ds.stockCounts.some((c) => c.month === month);
  // Şube seçiliyken mal maliyeti şubenin satışından reçeteye göre: "faturaya göre" denmez (profitBasisOf; bulgu 64)
  const actualKey = d.profitBasis.invoices ? "Kâr / zarar (faturaya göre, Gelir-gider)" : "Kâr / zarar (Gelir-gider)";
  lines.push({
    k: monthHasData ? actualKey : `${actualKey} · bu ay veri yok`,
    v: monthHasData ? d.actual.profit : null,
    note: d.profitBasis.invoices
      ? "Gelir-gider sekmesindeki KÂR / ZARAR: POS cirosu (KDV hariç) − mal maliyeti (devir + alış − devreden) − bütün giderler."
      : "Gelir-gider sekmesindeki KÂR / ZARAR: POS cirosu (KDV hariç) − şubenin satışından reçeteye göre mal maliyeti − şubenin giderleri. Faturalar işletme genelinde, şubeye bölünmez.",
  });

  lines.push({ k: "HEDEF", section: true });
  lines.push({
    k: "Zarar etmemek için GÜNLÜK ciro (KDV dahil)",
    v: d.breakEvenDaily,
    note: `(Standart sabit gider${d.breakEven.expensesTotal ? ` + her ay girilen harcamalar ${tl(d.breakEven.expensesTotal)}` : ""}${
      d.onlineCover ? ` − laffogato.net online brüt kârı ${tl(d.onlineCover.grossProfit)}` : ""
    }) ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün.`,
  });
  lines.push({ k: `${name} günlük ortalama ciro (KDV dahil)`, v: d.dailyAvg });
  // Süren ayın ilk günlerine göre ay sonu tahmini (seçili ay hangisi olursa olsun)
  const fm = forecastMonthOf(model);
  const fd = fm ? (fm === month ? d : dashboard(model, fm)) : null;
  if (fm && fd?.forecast) {
    const f = fd.forecast;
    const fn = monthName(fm);
    // Seçili ay süren aysa üstteki günlük ortalama aynı rakamdır; ikinci kez yazılmaz
    const sameAsAbove = fm === month && d.dailyAvg !== null && fd.dailyPosAvg !== null && Math.abs(d.dailyAvg - fd.dailyPosAvg) < 1;
    if (!sameAsAbove) lines.push({ k: `${fn} günlük ortalama ciro (1–${f.daysElapsed} ${fn}, POS)`, v: fd.dailyPosAvg });
    lines.push({
      k: `${fn} ay sonu ciro tahmini (KDV dahil)`,
      v: f.projectedRevenue,
      note: `Günlük ortalama × ${f.monthDays} gün${f.closedDays ? ` (kapalı işaretli ${f.closedDays} gün hariç)` : ""}.`,
    });
    lines.push({
      k: `${fn} tahmini net kâr / zarar`,
      v: f.projectedProfit,
      strong: true,
      note: `Ay sonu ciro tahmini × ${f.refMonth ? monthLabel(f.refMonth) : "son satış ayı"} brüt kâr oranı${f.projectedOnline !== null ? " + online brüt kâr" : ""} − standart sabit gider${
        fd.breakEven.expensesTotal ? " − her ay girilen harcamalar" : ""
      }.`,
    });
  }

  lines.push({ k: "MALİYET ORANI (düşük = iyi)", section: true });
  lines.push({ k: "Reçeteye göre maliyet oranı", v: d.recipeCostRatio, fmt: PCT });
  lines.push({ k: `Faturaya göre maliyet oranı (${name} alımları)`, v: d.invoiceCostRatio, fmt: PCT, note: d.profitBasis.sharedNote ?? undefined });
  const best = d.bestProduct;
  lines.push({ k: `${name} ayında en çok kâr getiren ürün`, v: best ? (best.p.product.size === "Tek" ? best.p.product.name : `${best.p.product.name} (${best.p.product.size})`) : null });
  if (best) lines.push({ k: "… o ürünün brüt kârı", v: best.profit });
  lines.push({ k: "Fiyatı gözden geçirilmesi gereken ürün sayısı (Düşük kâr)", v: d.lowProfitCount, fmt: "#,##0" });

  lines.push({ k: "" });
  lines.push({ k: "Dosyanın hazırlandığı an", v: dateTimeTR(now) });

  for (const l of lines) {
    if (l.section) {
      sectionRow(ws, "k", l.k);
      continue;
    }
    if (!l.k) {
      ws.addRow({});
      continue;
    }
    const r = ws.addRow({ k: l.k, v: l.v ?? null });
    if (l.fmt) r.getCell("v").numFmt = l.fmt;
    if (typeof l.v === "string") r.getCell("v").alignment = { horizontal: "right" };
    if (l.strong) {
      r.getCell("k").font = { bold: true };
      r.getCell("v").font = { bold: true };
      for (const k of ["k", "v"]) {
        r.getCell(k).fill = TOTAL_FILL;
        r.getCell(k).border = TOTAL_BORDER;
      }
    }
    if (l.note) r.getCell("k").note = l.note;
  }

  // Kategori tablosu, sağda
  d.categories.forEach((c, i) => {
    const row = ws.getRow(i + 2);
    row.getCell("cn").value = c.name;
    row.getCell("cc").value = c.count;
    row.getCell("cm").value = c.avgMargin;
    row.getCell("cu").value = c.avgUnitProfit;
    row.getCell("cr").value = c.avgCostRatio;
    row.getCell("cq").value = c.soldQty;
    row.getCell("cp").value = c.profit;
  });
  if (d.categoryMonthIsOther && d.categoryMonth) {
    ws.getCell(1, ws.getColumn("cq").number).note = `${label} satış listesi yok; adetler ${monthLabel(d.categoryMonth)} ayından.`;
  }
}

// ---------------------------------------------------------------------------- Gelir-Gider

function addPnl(wb: ExcelJS.Workbook, model: Model, month: string) {
  const year = Number(month.slice(0, 4));
  const months = yearMonths(year);
  const calcs = months.map((m) => model.pnlMonth(m));
  const yearKey = "year";
  const ws = addSheet(
    wb,
    `Gelir-Gider ${year}`,
    [
      { key: "sec", header: "", width: 24 },
      { key: "l", header: `L'AFFOGATO ${year}`, width: 46 },
      ...months.map((m, i) => ({ key: m, header: MONTH_NAMES[i].toLocaleUpperCase("tr-TR"), width: 13, fmt: MONEY0Z })),
      { key: yearKey, header: `${year} YILI`, width: 15, fmt: MONEY0Z },
    ],
    { x: 2, y: 1, landscape: true },
  );
  const head = headerRow(ws, colHeaders(ws));
  // Ay notu (Satışlar / Gelir-gider ay bilgisi) başlık hücresinde
  months.forEach((m, i) => {
    const note = calcs[i].info?.note;
    if (note) head.getCell(m).note = note;
  });
  // Yıl sütunu panelin yıl kartlarıyla, Gelir-gider tablosunun yıl sütunuyla, Genel bakış ve Claude ile aynı aylardan
  // (yearTotals): bu aya kadar, POS cirosu girilmiş aylar. Sonraki ay sayılmaz (bu ay sayılınca açılış stoğu, ay
  // başlamadan onun gideri olurdu; denetim E-16); cirosu girilmemiş ayın gideri de kâra girmez (NEW-02). Toplama
  // girmeyen aylar başlık notunda
  const yt = yearTotals(model, year);
  const counted = calcs.filter((c) => yt.counted.includes(c.month));
  head.getCell(yearKey).note = [
    `${monthLabel(model.currentMonth)} ve öncesi, POS cirosu girilmiş ${yt.counted.length} ay (panelin yıl kartları, Genel bakış ve Claude ile aynı).`,
    ...(calcs.some((c) => c.month > model.currentMonth) ? ["Sonraki aylar henüz başlamadı."] : []),
    ...yt.missingRevenue.map((m) => `${missingRevenueText(m)}.`),
    ...(yt.uncounted.length ? [`Ay sonu sayımı yok, mal maliyeti tahmini: ${yt.uncounted.map((m) => monthLabel(m)).join(", ")}.`] : []),
  ].join("\n");

  const fixedById = new Map(model.fixedList.map((f) => [f.id, f]));
  const od = ws.addRow({ l: "AÇIK GÜN SAYISI", ...Object.fromEntries(months.map((m, i) => [m, calcs[i].info?.openDays ?? null])) });
  setFmt(od, months, "0");
  od.getCell("l").note =
    "O ay işletmenin açık olduğu gün. Aylık sabit giderler gün ÷ ayın gün sayısı oranıyla hesaplanır: açık gün elle yazıldıysa o gün, kasa raporlarından geliyorsa raporların kapsadığı takvim günü (kapalı bir gün kirayı ve maaşı düşürmez). Günlük giderler × açık gün.";

  let lastSection = "";
  for (const def of model.pnlRowDefs(months)) {
    const first = def.section !== lastSection;
    if (first && lastSection) ws.addRow({});
    lastSection = def.section;
    const cells = calcs.map((c) => model.pnlValue(c, def.key));
    const total = pnlYearTotal(model, counted, def.key);
    const r = ws.addRow({
      sec: first ? (PNL_SECTION_LABELS[def.section] ?? def.section.toLocaleUpperCase("tr-TR")) : null,
      l: def.sub ? `${def.label} (${def.sub})` : def.label,
      ...Object.fromEntries(months.map((m, i) => [m, cells[i].value])),
      [yearKey]: total,
    });
    if (first) r.getCell("sec").font = SECTION_FONT;
    // Toplam satırları (mal alımı, bölüm toplamları, kâr / zarar): kalın, açık zemin, üst çizgi
    if (def.strong) totalRow(ws, r);
    if (def.format === "percent") setFmt(r, [...months, yearKey], PCTZ);
    // Yıl içinde başlayan ya da biten sabit gider: hangi aylarda sayıldığı (ekrandaki alt yazı gibi)
    const range = def.fixedId !== undefined ? fixedRangeInYear(fixedById.get(def.fixedId), months, model.firstDataMonth) : null;
    const labelNote = [range, def.hint].filter(Boolean).join("\n");
    if (labelNote) r.getCell("l").note = labelNote;
    // Elle düzeltilen hücre ve hücre notu: hücrenin notunda
    months.forEach((m, i) => {
      const c = cells[i];
      const parts: string[] = [];
      if (c.overridden && c.computed !== null && c.value !== null && Math.abs(c.value - c.computed) >= 0.005) {
        // Aylık ciroda hesaplanan, kasa raporlarının Z toplamıdır
        parts.push(def.key === "revenue" ? `Elle girildi (kasa raporlarından ${tl(c.computed)}).` : `Elle düzeltildi (hesaplanan ${tl(c.computed)}).`);
      }
      if (c.note) parts.push(c.note);
      if (parts.length) r.getCell(m).note = parts.join(" ");
    });
  }
}

// ---------------------------------------------------------------------------- Sayım

function addStock(wb: ExcelJS.Workbook, model: Model, month: string) {
  const label = monthLabel(month);
  const sheet = model.stockSheet(month);
  const vat = stockVatSummary(sheet, model.settings);
  const ws = addSheet(
    wb,
    `Sayım ${label}`,
    [
      { key: "g", header: "Ürün grubu", width: 26 },
      { key: "n", header: "Malzeme açıklaması", width: 44 },
      { key: "u", header: "Birim", width: 8 },
      { key: "q", header: `Miktar (${label})`, width: 13, fmt: QTY },
      { key: "p", header: "Birim fiyatı (KDV hariç)", width: 13, fmt: MONEY },
      { key: "a", header: "Tutar (KDV hariç)", width: 14, fmt: MONEY },
      { key: "v", header: "KDV", width: 7, fmt: "0%" },
      { key: "av", header: "KDV dahil", width: 14, fmt: MONEY },
      { key: "x", header: "Not", width: 40 },
    ],
    { y: 1 },
  );
  ws.pageSetup.printTitlesRow = "1:1";
  headerRow(ws, colHeaders(ws));

  sheet.groups.forEach((g, gi) => {
    const r = ws.addRow({ g: g.name, a: g.total, av: g.totalVatIncl });
    r.font = { bold: true };
    for (let c = 1; c <= colCount(ws); c++) r.getCell(c).fill = SUBHEADER_FILL;
    const mismatch = vat.groups[gi]?.mismatches ?? [];
    if (mismatch.length) {
      r.getCell("av").note = `KDV her malzemenin Alış KDV'siyle hesaplandı. Bu grubun olağan alış KDV'si %${num(vat.groups[gi].rate * 100)} (Ayarlar); farklı olanlar: ${mismatch
        .map((x) => `${x.ingredient.name} %${num(x.vatRate * 100)}`)
        .join(", ")}.`;
    }
    for (const l of g.lines) {
      const notes = [
        l.archived ? "Pasif ya da Sayılmaz yapılmış; bu ayın kayıtlı sayımı korunuyor." : "",
        l.unitChanged ? `Sayım birimi sonradan değişti; bu ay ${l.countUnit} ile sayılmıştı.` : "",
        l.valuation === "fifo" && l.qty ? `FIFO: ${layerText(l.layers, l.factor, l.countUnit)}` : "",
      ].filter(Boolean);
      ws.addRow({ n: l.ingredient.name, u: l.countUnit, q: l.qty, p: l.unitPrice, a: l.qty === null ? null : l.amount, v: l.ingredient.vatRate, av: l.qty === null ? null : l.amountVatIncl, x: notes.join(" ") || null });
    }
  });
  // Listede olmayanlar: malzeme kaydı yok, KDV'si gıdanın alış KDV'si (Ayarlar, %1)
  const er = ws.addRow({ g: "LİSTEDE OLMAYANLAR", a: sheet.extrasTotal, av: vat.extras.totalVatIncl });
  er.font = { bold: true };
  for (let c = 1; c <= colCount(ws); c++) er.getCell(c).fill = SUBHEADER_FILL;
  for (const e of sheet.extras) {
    ws.addRow({ n: e.name, u: e.unit, q: e.qty, p: e.unitPrice, a: e.amount, v: vat.extras.rate, av: e.amount * (1 + vat.extras.rate) });
  }
  ws.addRow({});
  const t = ws.addRow({ g: `AY TOPLAMI – ${label.toLocaleUpperCase("tr-TR")}`, a: sheet.total, av: sheet.totalVatIncl });
  totalRow(ws, t);
  t.getCell("g").note = "Gelir-gider sekmesindeki 'SONRAKİ AYA DEVREDEN MAL' bu ayın KDV hariç toplamıdır (elle düzeltilmediyse).";
  if (!sheet.hasData) ws.addRow({ g: "Bu ay sayım girilmemiş. Sayfayı boş sayım formu olarak yazdırabilirsiniz." });
}

// ---------------------------------------------------------------------------- Tutarlılık

function addConsistency(
  wb: ExcelJS.Workbook,
  model: Model,
  month: string,
  findings: ExportExtras["findings"],
  opts: { label?: string | null; note?: string | null; firmFindings?: boolean } = {},
) {
  const label = monthLabel(month);
  const c = consistency(model, month);
  const ws = addSheet(
    wb,
    `Tutarlılık ${label}`,
    [
      { key: "a", width: 40 },
      { key: "b", width: 16 },
      { key: "c", width: 16 },
      { key: "d", width: 8 },
      { key: "e", width: 12 },
      { key: "f", width: 14 },
      { key: "g", width: 14 },
      { key: "h", width: 14 },
      { key: "i", width: 14 },
      { key: "j", width: 13 },
      { key: "k", width: 14 },
      { key: "l", width: 34 },
      { key: "m", width: 50 },
    ],
    { y: 1, landscape: true },
  );
  const title = ws.addRow({ a: `Tutarlılık kontrolü – ${label}${opts.label ? ` · ${opts.label}` : ""}` });
  title.font = { ...TITLE_FONT, size: 13 };
  // Şube dosyasında Tutarlılık alanının kipi (şube ayrımı parça 6)
  if (opts.note) ws.addRow({ a: opts.note }).font = MUTED_FONT;

  // 1) Satış kaynakları
  ws.addRow({});
  sectionRow(ws, "a", "1) SATIŞ KAYNAKLARI – POS ile satış listesi tutuyor mu?");
  const s = c.sales;
  const diffText =
    s.diff === null
      ? "POS cirosu ya da satış listesi girilmemiş."
      : s.ok
        ? `✓ TUTARLI (fark ${pct(s.pos ? Math.abs(s.diff) / s.pos : 0)})`
        : "✗ KONTROL EDİN (fark 1.000 ₺'den büyük)";
  const salesRows: [string, number | null, string?][] = [
    ["Ürün listesi toplamı (indirim öncesi)", s.hasLines ? s.listTotal : null, `Satış sekmesindeki ${model.monthSales(month).lines.length} satır.`],
    ["– Yönetici indirimleri", -s.discounts],
    ["Hesaplanan ciro (liste – indirim)", s.hasLines ? s.computed : null],
    ["POS ciro raporu", s.pos],
    ["Fark", s.diff, diffText],
    ["Ödenmez (sahip / personel tüketimi) – satış listesinde yok", s.offRevenue, "Malzemesi harcanıyor, geliri yok."],
    ["Ödenmezlerin tahmini malzeme maliyeti", s.offRevenueCost, "Ödenmez tutarı (KDV hariç) × eşleşen ürünlerin ortalama maliyet oranı. Bu maliyet Özet'teki kâra dahil değil."],
  ];
  for (const [k, v, note] of salesRows) {
    const r = ws.addRow({ a: k, b: v, c: note ?? null });
    r.getCell("b").numFmt = MONEY0;
  }

  // 2) Reçete ↔ fatura ↔ sayım
  ws.addRow({});
  sectionRow(ws, "a", `2) REÇETE ↔ FATURA ↔ SAYIM – satılanlara göre harcanması gereken ile ${label} içinde alınan malzeme`);
  const prev = monthLabel(shiftMonth(month, -1));
  const h = subHeaderRow(ws, {
    a: "Malzeme",
    b: `Reçeteye göre kullanım`,
    c: "Faturayla alınan",
    d: "Birim",
    e: "Alınan ÷ kullanılan",
    f: "Fark tutarı (₺)",
    g: `Önceki ay sayımı (${prev})`,
    h: `Bu ay sayımı (${label})`,
    i: "Gerçek tüketim",
    j: "Sapma (miktar)",
    k: "Sapma (₺)",
    l: "Durum",
    m: "Yorum / kaynak faturalar",
  });
  h.getCell("f").note = "(Alınan − kullanılan) × birim maliyet. Pozitif = reçeteye göre fazla alınan malın parası (stokta duruyor ya da fire / ikram oldu).";
  h.getCell("i").note = "Geçen ay sayımı + alınan − bu ay sayımı. İki ayın sayımı ve bu ayın alım miktarı girildiyse hesaplanır.";
  h.getCell("k").note = "(Gerçek tüketim − reçeteye göre kullanım) × birim maliyet. Pozitif = fire, ikram, porsiyon kaçağı.";
  if (!c.hasCounts) {
    h.getCell("l").note = "Stok karşılaştırması için önceki ayın ve bu ayın sayımı gerekli; bu iki ayda ortak sayılmış malzeme yok.";
  }
  const firstRow = ws.rowCount + 1;
  for (const row of c.rows) {
    // İki ayda da hiç sayım yoksa her satıra "sayım eksik" yazmak yerine sütun boş kalır (başlıkta açıklama)
    const state = !c.hasCounts
      ? ""
      : row.stock === "complete"
        ? "Sayım + alım tamam"
        : row.stock === "needsPurchase"
          ? "Alım girilmeli (alınmadıysa 0 yazın)"
          : row.stock === "held"
            ? `Fiyat onayı bekliyor (${row.held?.invoices ?? 0} fatura alınana girmedi)`
            : row.stock === "rejected"
              ? `Reddedilen fatura alınana girmedi (${row.rejected?.invoices ?? 0} fatura); ayın alımını elle yazın`
              : "Sayım eksik (iki ay sayılmalı)";
    const unreciped = !row.inRecipe && (row.stockDrop ?? 0) > 0 ? " · Reçetesiz tüketim" : "";
    const r = ws.addRow({
      a: row.ingredient.name,
      b: row.usage,
      c: row.purchased,
      d: row.ingredient.unit,
      e: row.ratio,
      f: row.diffAmount,
      g: row.opening,
      h: row.closing,
      i: row.actualUsage,
      j: row.variance,
      k: row.varianceAmount,
      l: state + unreciped || null,
      m: row.note,
    });
    setFmt(r, ["b", "c", "g", "h", "i", "j"], QTY);
    setFmt(r, ["f", "k"], MONEY0);
    r.getCell("e").numFmt = '0.00"×"';
  }
  if (!c.rows.length) ws.addRow({ a: "Bu ay satış listesi, alım miktarı ya da iki aylık sayım yok." });
  const lastRow = ws.rowCount;
  const tot = ws.addRow({ a: "TOPLAM fark (alınan – reçeteye göre kullanılan)", f: c.totalDiff, k: c.hasStockComparison ? c.totalVariance : null });
  totalRow(ws, tot);
  setFmt(tot, ["f", "k"], MONEY0);
  if (c.rows.length) filterRows(ws, firstRow - 1, lastRow);
  if (c.needsPurchaseCount) ws.addRow({ a: `${c.needsPurchaseCount} malzemenin iki ayı sayıldı ama alım miktarı girilmedi; sapma hesaplanmadı.` });
  if (c.heldCount) ws.addRow({ a: `${c.heldCount} malzemenin bu ayki faturasının çarpanı onay bekliyor; o faturalar alınana girmedi, sapma onaydan sonra.` });
  if (c.rejectedCount) ws.addRow({ a: `${c.rejectedCount} malzemenin bu ayki fiyatı reddedilen faturası alınana girmedi; sapma için ayın alımı Tutarlılık'ta elle yazılmalı.` });
  if (c.unreciped.count) ws.addRow({ a: `Reçetesiz tüketim: ${c.unreciped.count} malzeme hiçbir reçetede yok ama stoktan düştü (en az ${tl(c.unreciped.amount)}).` });

  // 3) Bulgular: reçetede olmayan alımlar, fiyat ve fatura kontrolü
  ws.addRow({});
  sectionRow(ws, "a", `3) BULGULAR VE NOTLAR${opts.firmFindings ? " · Firma geneli (bulgunun şubesi yok)" : ""}`);
  subHeaderRow(ws, { a: "Başlık", b: "Bölüm", c: "Durum", d: "Ayrıntı" });
  const sorted = [...findings].sort((x, y) => Number(x.resolved) - Number(y.resolved) || x.section.localeCompare(y.section, "tr-TR"));
  for (const f of sorted) ws.addRow({ a: f.title, b: f.section, c: f.resolved ? "Çözüldü" : "Açık", d: f.detail });
  if (!findings.length) ws.addRow({ a: "Kayıtlı bulgu yok." });
}

// ---------------------------------------------------------------------------- Satış

function addSales(wb: ExcelJS.Workbook, model: Model, month: string) {
  const label = monthLabel(month);
  const sales = model.monthSales(month);
  const info = sales.info;
  const c = consistency(model, month);
  const ws = addSheet(
    wb,
    `Satış ${label}`,
    [
      { key: "n", width: 34 },
      { key: "q", width: 8, fmt: "#,##0" },
      { key: "r", width: 16, fmt: MONEY },
      { key: "m", width: 30 },
      { key: "uc", width: 13, fmt: MONEY },
      { key: "net", width: 14, fmt: MONEY },
      { key: "c", width: 14, fmt: MONEY },
      { key: "k", width: 13, fmt: MONEY },
      { key: "g", width: 14, fmt: MONEY },
      { key: "mg", width: 10, fmt: PCT },
      { key: "st", width: 34 },
      { key: "note", width: 40 },
    ],
    { landscape: true },
  );
  const title = ws.addRow({ n: `Satış raporu – ${label}` });
  title.font = { ...TITLE_FONT, size: 13 };
  // Ayın özeti: POS cirosu, ciro dışı, indirim, açık gün, ortalama maliyet oranı, liste farkı
  const summary: [string, number | null, string, string?][] = [
    ["POS toplam ciro (KDV dahil)", info?.posRevenue ?? null, MONEY0, "POS > Raporlar > Ciro: indirimler düşülmüş, ödenmezler hariç."],
    ["Ciro dışı (ödenmez / ikram)", info?.offRevenue ?? null, MONEY0, "Malzemesi harcanan ama geliri olmayan siparişler."],
    ["Yönetici indirimleri", info?.discounts ?? null, MONEY0, "Ürün listesi indirim öncesi fiyatlardır; Özet bu tutarı cirodan düşer."],
    ["Açık gün", info?.openDays ?? null, "0"],
    ["Eşleşen ürünlerin ortalama maliyet oranı", sales.lines.length ? sales.avgCostRatio : null, PCT, "Reçetesi olan ürünlerin toplam maliyeti ÷ net cirosu. Eşleşmeyen satırlara ve reçetesi boş ürünlere bu oran uygulanır."],
    ["Liste – indirim – POS cirosu (fark)", c.sales.diff, MONEY0, "Satış listesi toplamı − yönetici indirimleri − POS cirosu. 1.000 ₺'nin altı tutarlı sayılır."],
  ];
  for (const [k, v, fmt, note] of summary) {
    const r = ws.addRow({ n: k, r: v });
    r.getCell("r").numFmt = fmt;
    if (note) r.getCell("n").note = note;
  }
  ws.addRow({});
  const head = headerRow(ws, {
    n: "POS ürün adı",
    q: "Adet",
    r: "Ciro (KDV dahil)",
    m: "Eşleşen ürün (anahtar)",
    uc: "Birim maliyet",
    net: "Net ciro (KDV hariç)",
    c: "Malzeme + ambalaj maliyeti",
    k: "POS komisyonu",
    g: "Brüt kâr",
    mg: "Kâr marjı %",
    st: "Durum",
    note: "Not",
  });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: head.number }];
  head.getCell("c").note = "Eşleşen ürünlerde Adet × Birim maliyet; eşleşmeyenlerde ve reçetesi boş ürünlerde Net ciro × ortalama maliyet oranı; hizmette 0.";
  const ratio = pct(sales.avgCostRatio);
  for (const l of sales.lines) {
    const st = l.line.isService
      ? "Hizmet – malzeme maliyeti yok"
      : l.noRecipe
        ? `Eşleşti, reçete boş – ortalama maliyet oranı (${ratio}) uygulandı`
        : l.matched
          ? "Eşleşti"
          : `Eşleşmedi – ortalama maliyet oranı (${ratio}) uygulandı`;
    ws.addRow({ n: l.line.posName, q: l.line.qty, r: l.line.revenue, m: l.line.isService ? "HİZMET" : l.product ? l.product.key : "", uc: l.unitCost, net: l.net, c: l.cost, k: l.commission, g: l.grossProfit, mg: l.margin, st, note: l.line.note });
  }
  if (!sales.lines.length) ws.addRow({ n: "Bu ay satış listesi yüklenmemiş." });
  // Satış listesi yoksa TOPLAM satırı boş kalır (0 adet / 0 ₺ "satış yok" ile "satış 0" ayrımını bozmasın)
  const tot = sales.lines.length
    ? ws.addRow({ n: "TOPLAM", q: sales.qty, r: sales.revenue, net: sales.net, c: sales.cost, k: sales.commission, g: sales.grossProfit, mg: sales.margin })
    : ws.addRow({ n: "TOPLAM" });
  totalRow(ws, tot);
  filterRows(ws, head.number, tot.number - 1);
}

// ---------------------------------------------------------------------------- Faturalar + Aylık Alımlar

/** Tedarikçilere elle girilen cari kayıtlar, gün sırasıyla */
/** `scopeNote`: şube dosyasında sekmenin kapsamı ("Marina şubesi" ya da "Firma geneli"; Tedarikçi bakiyeleri alanı) */
function addCari(wb: ExcelJS.Workbook, rows: readonly CariExportRow[], scopeNote: string | null = null) {
  const ws = addSheet(
    wb,
    "Cari hareketleri",
    [
      { key: "d", header: "Tarih", width: 11, fmt: DATE },
      { key: "s", header: "Tedarikçi", width: 24 },
      { key: "h", header: "Hareket", width: 30 },
      { key: "de", header: "Açıklama", width: 28 },
      { key: "b", header: "Borç", width: 13, fmt: MONEY },
      { key: "o", header: "Ödeme", width: 13, fmt: MONEY },
      { key: "m", header: "Şekil", width: 22 },
      { key: "c", header: "Sayıldığı", width: 40 },
      { key: "f", header: "Fatura bağı", width: 18 },
      { key: "n", header: "Not", width: 32 },
    ],
    { y: 1, landscape: true },
  );
  const head = headerRow(ws, colHeaders(ws));
  head.getCell("b").note = "Faturasız alım ya da eski borç (KDV dahil). Faturası gelecek alım ve eski borç gider değildir; faturası yok denen alımın gideri Aylık harcamalar'dadır.";
  head.getCell("o").note = "Tedarikçiye ödeme. Gider ya da KDV değildir; borçtan düşer.";
  if (scopeNote) {
    head.getCell("h").note =
      scopeNote === "Firma geneli"
        ? "Firma geneli: tedarikçilerin carisi firmanındır, bütün şubelerin hareketleri."
        : `${scopeNote}: şubenin kasasından yapılan ödemeler ve öbür ödemelerin şubenin faturalarına sayılan kısmı. Faturasız borç firmanındır ("İşletme geneli"); öbür şubenin faturası adıyla yazılmaz.`;
  }
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier, "tr"))) {
    ws.addRow({
      d: excelDate(r.date),
      s: r.supplier,
      h: r.movement,
      de: r.description,
      b: r.debt,
      o: r.payment,
      m: r.method,
      c: r.counted,
      f: r.invoice,
      n: r.note,
    });
  }
  const last = ws.rowCount;
  filterRows(ws, 1, last);
  // Toplam bir boş satır altta: süzgeçte görünen hareketlerin borcu ve ödemesi (SUBTOTAL)
  ws.addRow({});
  const tot = ws.addRow({
    d: "TOPLAM",
    b: subtotal("E", 2, last, sum(rows.map((r) => r.debt ?? 0))),
    o: subtotal("F", 2, last, sum(rows.map((r) => r.payment ?? 0))),
  });
  totalRow(ws, tot);
}

// ---------------------------------------------------------------------------- Vergi (dalga 12, docs/VERGI.md)

export const TAX_SHEET = "Vergi";
/** Sayfanın ilk satırı (plan docs/planlar/vergi.md §9) */
export const TAX_SHEET_FIRST_LINE = "Tahmin; beyanname değildir. Kafenin payı; şirketin beyannamesi muhasebecidedir.";
/** Geliri yönetim verisinden (ModPOS / AsilPOS) gelen ayın ve çeyreğin yerine (K11, K31) */
export const TAX_NOT_FISCAL = "Gelir mali belgeden girilmedi; hesap ekranda (taslak)";

const REVENUE_SOURCE_TEXT: Record<RevenueSource, string> = { beyanname: "beyanname", z: "Z", yonetim: "yönetim verisi" };
const isFiscal = revenueDocumented;
/** Gelir kaynağı satırı: biten ve gelirsiz ay "gelir yok" (belge beklemez) */
const revenueSourceText = (m: TaxMonth) => (m.revenueSource === "yonetim" ? "gelir yok" : REVENUE_SOURCE_TEXT[m.revenueSource]);
const dotted = (d: string) => d.split("-").reverse().join(".");

/**
 * Çeyreğin geçici vergi hesabı dışa aktarıma yazılabilir mi: hesap kümülatiftir, çapadan (muhasebecinin matrahlı kaydı) ya da
 * hesap döneminin başından çeyreğin sonuna her ayın geliri mali belgeden (beyanname ya da Z) gelmeli (K11, K31)
 */
export function taxQuarterFiscal(months: readonly TaxMonth[], calc: Pick<QuarterCalc, "to" | "anchor">): boolean {
  const end = calc.to.slice(0, 7);
  const anchorEnd = calc.anchor ? (quarterMonths(calc.anchor.period).at(-1) ?? "") : "";
  const span = months.filter((m) => m.month <= end && m.month > anchorEnd);
  return span.length > 0 && span.every(isFiscal);
}

/**
 * "Vergi" sayfası: vergiye göre gelir-gider (yalnız geliri mali belgeden gelen aylar), geçici ve kurumlar vergisi
 * hesabı (yalnız mali belgeli çeyrekler), takvim, kullanılan kurallar ve sahibin notları. ModPOS ile mali belge farkı,
 * belgesi yok işaretli kalemler ve sınıflandırılmamış kalemlerin adları yazılmaz (K11, K12, K31)
 */
function addTax(wb: ExcelJS.Workbook, tax: TaxExport, opts: { branchFile?: boolean } = {}) {
  const { view, settings } = tax;
  const { rules, fromYear } = rulesFor(view.year, settings.overrides);
  const ws = addSheet(
    wb,
    TAX_SHEET,
    [
      { key: "a", width: 52 },
      { key: "b", width: 16 },
      { key: "c", width: 16 },
      { key: "d", width: 16 },
      { key: "e", width: 16 },
      { key: "f", width: 80 },
    ],
    { y: 1, landscape: true },
  );
  const grey = MUTED_FONT;
  const first = ws.addRow({ a: TAX_SHEET_FIRST_LINE });
  first.font = { ...TITLE_FONT, size: 13 };
  ws.addRow({ a: `${view.year} hesap dönemi · tutarlar KDV hariç, Türk lirası · ${rulesCompiledText(fromYear)}` }).font = grey;
  // Şube dosyasında da firmanın: vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026; tek vergi numarası)
  if (opts.branchFile) ws.addRow({ a: "Firma geneli · beyan: bütün şubelerin satışı, faturaları ve giderleri (tek vergi numarası; vergi şubeye bölünmez)." }).font = grey;
  const money = (r: ExcelJS.Row, keys: string[]) => setFmt(r, keys, MONEY);
  const wrap = (r: ExcelJS.Row) => (r.getCell("f").alignment = { wrapText: true, vertical: "top" });

  // ---- 1. Vergiye göre gelir-gider
  ws.addRow({});
  sectionRow(ws, "a", "1. VERGİYE GÖRE GELİR-GİDER (ay ay, KDV hariç)");
  wrap(
    ws.addRow({
      a: "Okuma notu",
      f: "Gelir kaynağı beyanname: muhasebecinin girdiği KDV beyannamesi satışları · Z: yazarkasanın mali Z raporları. Geliri yönetim verisinden gelen ay ve çeyrek yazılmaz. Sınıflandırılmamış giderlerin yalnız toplamı yazılır.",
    }),
  );
  for (const q of view.quarters) {
    const months = view.months.filter((m) => q.months.includes(m.month));
    const fiscal = months.filter(isFiscal);
    const whole = months.length > 0 && fiscal.length === months.length;
    const title = `${quarterLabel(q.key)} (${dotted(q.from)} – ${dotted(q.to)})`;
    ws.addRow({});
    if (!fiscal.length) {
      const r = ws.addRow({ a: title, f: TAX_NOT_FISCAL });
      r.getCell("a").font = { bold: true };
      continue;
    }
    const cols = ["b", "c", "d"].slice(0, fiscal.length);
    const missing = months.filter((m) => !isFiscal(m)).map((m) => taxMonthName(m.month));
    subHeaderRow(ws, {
      a: title,
      ...Object.fromEntries(fiscal.map((m, i) => [cols[i], `${taxMonthName(m.month)}${m.inProgress ? " (bugüne kadar)" : ""}`])),
      ...(whole ? { e: "Çeyrek" } : {}),
      f: whole ? "Esas / not" : `${missing.join(", ")}: ${TAX_NOT_FISCAL}`,
    });
    ws.addRow({ a: "Gelir kaynağı", ...Object.fromEntries(fiscal.map((m, i) => [cols[i], revenueSourceText(m)])) });
    const block = (pick: (m: TaxMonth) => readonly TaxRow[]) => {
      const keys: { id: string; label: string; badge: string | null }[] = [];
      for (const m of fiscal) for (const r of pick(m)) if (!keys.some((k) => k.id === `${r.key}|${r.label}`)) keys.push({ id: `${r.key}|${r.label}`, label: r.label, badge: r.badge ?? null });
      for (const k of keys) {
        const vals = fiscal.map((m) => pick(m).find((r) => `${r.key}|${r.label}` === k.id)?.amount ?? null);
        const notes = fiscal.flatMap((m) => {
          const note = pick(m).find((r) => `${r.key}|${r.label}` === k.id)?.note;
          return note ? [`${taxMonthName(m.month)}: ${note}`] : [];
        });
        const r = ws.addRow({
          a: k.label,
          ...Object.fromEntries(vals.map((v, i) => [cols[i], v])),
          ...(whole ? { e: round2(sum(vals.map((v) => v ?? 0))) } : {}),
          f: [k.badge, ...notes].filter(Boolean).join(" · ") || null,
        });
        money(r, [...cols, "e"]);
      }
    };
    const total = (a: string, vals: number[], quarter: number) => {
      const r = ws.addRow({ a, ...Object.fromEntries(vals.map((v, i) => [cols[i], v])), ...(whole ? { e: quarter } : {}) });
      totalRow(ws, r);
      money(r, [...cols, "e"]);
      return r;
    };
    // Gelirsiz ayın (belge beklemez) yönetim verisi satırı yazılmaz: ModPOS / AsilPOS dışa aktarıma girmez (K31)
    block((m) => (m.revenueSource === "yonetim" ? m.income.rows.filter((r) => r.key !== "pos") : m.income.rows));
    total("Gelir toplamı", fiscal.map((m) => m.income.total), q.income);
    block((m) => m.expense.rows);
    if (whole && Math.abs(q.stock.adjust) >= 0.005) {
      const r = ws.addRow({
        a: "Çeyrek sonu stoğu (en son sayım)",
        e: round2(q.expense - sum(months.map((m) => m.expense.total))),
        f: q.stock.warning ?? (q.stock.usedFrom ? `${taxMonthName(q.stock.usedFrom)} sonu sayımı kullanıldı` : "sayım yok: stok 0 sayıldı"),
      });
      money(r, ["e"]);
    }
    total("Gider toplamı", fiscal.map((m) => m.expense.total), q.expense);
    total("Sonuç (amortisman öncesi)", fiscal.map((m) => m.result), q.result);
    if (whole && q.unclassified.count) {
      const r = ws.addRow({ a: "Sınıflandırılmamış giderler (sayılmadı)", e: q.unclassified.total, f: "Yalnız toplam; kalemler panelde (Vergi, KDV, SGK › Vergi kârı)" });
      money(r, ["e"]);
    }
    if (whole && q.candidates.count) {
      const r = ws.addRow({ a: "Demirbaş olabilir (sayılmadı)", e: q.candidates.total, f: `${q.candidates.count} fatura` });
      money(r, ["e"]);
    }
    for (const w of q.warnings) wrap(ws.addRow({ a: "Uyarı", f: w }));
  }

  // ---- 2. Geçici vergi ve kurumlar vergisi
  ws.addRow({});
  sectionRow(ws, "a", "2. GEÇİCİ VERGİ VE KURUMLAR VERGİSİ (yalnız kafe; yalnız geliri mali belgeden gelen çeyrekler)");
  wrap(ws.addRow({ a: "Kafenin katkısı", f: "Şirketin geçici ve kurumlar vergisi muhasebecinin beyannamesidir; burada kafenin matraha katkısı hesaplanır." }));
  const pctOf = (x: number) => `%${num(x * 100, 2).replace(/,00$/, "")}`;
  const line = (a: string, v: number | null, f: string | null, opts: { bold?: boolean; text?: string } = {}) => {
    const r = ws.addRow({ a, b: opts.text ?? v, f });
    if (opts.text === undefined) money(r, ["b"]);
    if (opts.bold) r.font = { bold: true };
    wrap(r);
    return r;
  };
  const minText = (s: QuarterCalc["minTax"]) => (s === "muaf" ? "muaf (ilk 3 hesap dönemi)" : s === "bilinmiyor" ? "uygulandı (şirketin kuruluşu sorulmadı)" : "uygulandı");
  for (const c of view.corp) {
    const qp = view.quarters.find((x) => x.key === c.key);
    ws.addRow({});
    const title = `Geçici vergi ${quarterLabel(c.key)} · ${c.state === "hazir" ? "Hazır" : "Taslak"}${c.source === "Muhasebeci" ? " · Muhasebeci" : ""}`;
    if (!qp || !taxQuarterFiscal(view.months, c)) {
      const r = ws.addRow({ a: title, f: TAX_NOT_FISCAL });
      r.getCell("a").font = { bold: true };
      continue;
    }
    subHeaderRow(ws, { a: title, b: "Tutar", f: "Formül" });
    line("Çeyreğin sonucu", qp.result, "gelir − gider (çeyrek sonu stoğu dahil), yukarıdaki tablodan");
    line("Amortisman", -c.depreciation, `Demirbaş listesinden; ${QUARTER_DEPRECIATION_LABELS[settings.quarterDepreciation].toLocaleLowerCase("tr-TR")}`);
    if (c.direct) line("Doğrudan gider yazılan demirbaş", -c.direct, "Demirbaş listesinden");
    if (c.kkeg) line("İndirilemeyen gider (eklenir)", c.kkeg, "Düzeltmelerden");
    line("Dönem kazancı", c.periodResult, "sonuç − amortisman − doğrudan gider + indirilemeyen gider", { bold: true });
    line(
      "Kümülatif kurum kazancı",
      c.cumulative,
      c.anchor
        ? `${quarterLabel(c.anchor.period)} muhasebeci kaydının matrahı (${tl(c.anchor.matrah, 2)})${c.anchor.deducted ? ` + matrahından düşülmüş zarar ve indirim (${tl(c.anchor.deducted, 2)})` : ""} + sonraki dönem kazançları`
        : `hesap döneminin başından (${dotted(c.from)}) bu çeyreğin sonuna dönem kazançlarının toplamı`,
    );
    if (c.loss) line("Devreden zarar", -c.loss, "Önceki yılın kurumlar vergisi kaydındaki 'Sonraki yıllara devreden zarar'");
    if (c.indirim) line("İndirim", -c.indirim, "Düzeltmelerden");
    line("Matrah", c.matrah, "kümülatif kazanç − devreden zarar − indirim; eksiyse 0", { bold: true });
    line("Hesaplanan geçici vergi", c.hesaplanan, `matrah × ${pctOf(rules.gecici.oran.value)}`);
    if (c.asgari === null) line("Asgari kurumlar vergisi", null, minText(c.minTax), { text: "muaf" });
    else line("Asgari kurumlar vergisi", c.asgari, `kümülatif kazanç × ${pctOf(rules.kv.asgariOran.value)}; ${minText(c.minTax)}`);
    line("Kümülatif vergi", c.cumulativeTax, "hesaplanan ile asgariden büyük olan");
    line("Önceki dönemler", -c.previous, c.anchor ? "çapa kaydının hesaplanan vergisi + aradaki dönemlerin ödenecekleri" : "önceki çeyreklerin ödenecekleri");
    line("Kafenin katkısı (tahmini ödenecek)", c.estimate, "kümülatif vergi − önceki dönemler; eksiyse 0", { bold: true });
    line("Beyanname damgası", c.stamp, c.stampEstimated ? "tahmini (yılın tutarı açıklanmadı)" : "maktu");
    if (c.filing) line("Muhasebecinin rakamı (ödenecek)", c.filing.payable, `Muhasebeci kaydı · ${c.filing.enteredByName ?? ""}`.replace(/ · $/, ""), { bold: true });
  }
  const kv = view.kv;
  ws.addRow({});
  const kvTitle = `Kurumlar vergisi ${kv.year}${kv.inProgress ? " (yıl sürüyor: bugüne kadarki kârla)" : ""}${kv.source === "Muhasebeci" ? " · Muhasebeci" : ""}`;
  const lastCorp = view.corp.at(-1);
  if (!lastCorp || !taxQuarterFiscal(view.months, lastCorp)) {
    const r = ws.addRow({ a: kvTitle, f: TAX_NOT_FISCAL });
    r.getCell("a").font = { bold: true };
  } else {
    subHeaderRow(ws, { a: kvTitle, b: "Tutar", f: "Formül" });
    line("Yıllık kurum kazancı", kv.income, kv.filing ? "Muhasebeci kaydının kurum kazancı" : "son çeyreğin kümülatif kazancı");
    if (kv.loss) line("Devreden zarar", -kv.loss, "Önceki yıllardan");
    if (kv.indirim) line("İndirim", -kv.indirim, "Düzeltmelerden");
    line("Matrah", kv.matrah, "kazanç − devreden zarar − indirim; eksiyse 0", { bold: true });
    line("Hesaplanan kurumlar vergisi", kv.hesaplanan, `matrah × ${pctOf(rules.kv.oran.value)}`);
    if (kv.asgari === null) line("Asgari kurumlar vergisi", null, minText(kv.minTax), { text: "muaf" });
    else line("Asgari kurumlar vergisi", kv.asgari, `kazanç × ${pctOf(rules.kv.asgariOran.value)}; ${minText(kv.minTax)}`);
    line("Kurumlar vergisi", kv.tax, "hesaplanan ile asgariden büyük olan", { bold: true });
    line("Mahsup edilen geçici vergi", -kv.paidProvisional, kv.paidQuarters.length ? `Ödendi işaretli: ${kv.paidQuarters.map((p) => quarterLabel(p.period)).join(", ")}` : "Ödendi işaretli geçici vergi yok");
    if (kv.refund) line("İade / mahsup alacağı", kv.refund, "mahsup edilen − kurumlar vergisi");
    else line("Ödenecek", kv.payable, "kurumlar vergisi − mahsup edilen geçici vergi", { bold: true });
    line("Beyanname, bilanço ve gelir tablosu damgası", kv.stamps.total, "maktu");
  }

  // ---- 3. Takvim
  ws.addRow({});
  sectionRow(ws, "a", "3. VERGİ TAKVİMİ");
  if (view.calendar.length) {
    subHeaderRow(ws, { a: "Ödeme", b: "Son gün", c: "Tutar", d: "Kaynak", f: "Not" });
    for (const r of view.calendar) {
      // Tutarı bilinmeyen satırda tutar sütunu notun kendisi: not bir kez yazılır
      const note = r.note && r.note !== r.amountText ? r.note : null;
      const row = ws.addRow({ a: r.title, b: excelDate(r.due), c: r.amountText, d: r.badge, f: [note, r.shift].filter(Boolean).join(" · ") || null });
      row.getCell("b").numFmt = DATE;
      wrap(row);
    }
  } else ws.addRow({ a: "Önümüzdeki günlerde vergi ödemesi yok." });
  for (const l of view.later) {
    const row = ws.addRow({ a: l.title, b: excelDate(l.due), c: "Tutarı bilinmiyor", f: `Sonra (önümüzdeki ${CALENDAR_DAYS} günün dışında)` });
    row.getCell("b").numFmt = DATE;
    wrap(row);
  }
  ws.addRow({ a: INFLATION_LINE.split(" · ")[0] });

  // ---- 4. Kullanılan kurallar
  ws.addRow({});
  sectionRow(ws, "a", "4. KULLANILAN KURALLAR");
  ws.addRow({ a: `Derlendi ${dotted(RULES_COMPILED_AT)}; ${RULES_VERIFIED_AT ? `resmî metinlerle karşılaştırıldı: ${dotted(RULES_VERIFIED_AT)}` : "resmî metinlerle karşılaştırılmadı"}` }).font = grey;
  subHeaderRow(ws, { a: "Kural", b: "Değer", c: "Güven", d: "Anahtar", f: "Dayanak · kaynak" });
  for (const g of RULE_GROUPS) {
    for (const rule of allRules(rules).filter((x) => x.key === g.key || x.key.startsWith(`${g.key}.`))) {
      const r = ws.addRow({
        a: rule.title,
        b: ruleValueText(rule),
        c: CONFIDENCE_LABELS[rule.confidence],
        d: rule.key,
        f: [rule.basis, overrideText(rule), ...rule.sources.map((s) => `${s.label}: ${s.url}`)].filter(Boolean).join(" · "),
      });
      r.getCell("b").alignment = { horizontal: "right" };
      wrap(r);
    }
  }

  // ---- 5. Sahibin notları (Muhasebeciye sorulacaklar'da işaretlenenler)
  ws.addRow({});
  sectionRow(ws, "a", "5. SAHİBİN NOTLARI");
  const marked = ACCOUNTANT_CHECKS.filter((c) => settings.checks[c.key]);
  if (!marked.length) ws.addRow({ a: "Muhasebeciye sorulacaklar'da henüz işaretlenen madde yok." });
  for (const c of marked) {
    const m = settings.checks[c.key]!;
    wrap(ws.addRow({ a: c.title, f: ["Sahibin notu: muhasebecimle konuştum", dotted(m.date), m.note].filter(Boolean).join(" · ") }));
  }
}

/** Fatura özetinde gösterilen kategoriler: hepsi (boş olanlar da), sonra listede olmayanlar */
export function invoiceCategories(invoices: { category: string }[]): string[] {
  const out = [...INVOICE_CATEGORIES];
  for (const i of invoices) if (!out.includes(i.category)) out.push(i.category);
  return out;
}

function addInvoices(wb: ExcelJS.Workbook, model: Model, outstanding?: Map<number, number | null>, branchNames?: ReadonlyMap<string, string>) {
  const invoices = model.ds.invoices;
  const ws = addSheet(
    wb,
    "Faturalar",
    [
      { key: "d", header: "Tarih", width: 11, fmt: DATE },
      { key: "s", header: "Tedarikçi", width: 28 },
      { key: "de", header: "Açıklama", width: 24 },
      { key: "no", header: "Fatura no", width: 20 },
      { key: "c", header: "Kategori", width: 20 },
      { key: "a", header: "Mal/hizmet tutarı", width: 14, fmt: MONEY },
      { key: "i", header: "İskonto", width: 12, fmt: MONEY },
      { key: "n", header: "Net (KDV hariç)", width: 14, fmt: MONEY },
      { key: "v", header: "KDV", width: 12, fmt: MONEY },
      { key: "p", header: "Ödenecek (KDV dahil)", width: 14, fmt: MONEY },
      { key: "m", header: "Ay", width: 10, fmt: MONTH_SHORT },
      { key: "u", header: "Durum", width: 10 },
      { key: "ob", header: "Kalan borç", width: 13, fmt: MONEY },
      { key: "pp", header: "Panelde ödenen", width: 13, fmt: MONEY },
      { key: "due", header: "Vade", width: 11, fmt: DATE },
      { key: "note", header: "Not", width: 40 },
      { key: "src", header: "Kaynak", width: 9 },
      // Vergi ve mutabakat sütunları sonda (bulgu 17): eski sütunların yeri değişmesin (Aylık Alımlar'ın SUMIFS'i H, E, K)
      { key: "w", header: "Tevkifat (KDV-2)", width: 13, fmt: MONEY },
      { key: "pv", header: "Tedarikçiye ödenen KDV", width: 14, fmt: MONEY },
      { key: "vkn", header: "Vergi no", width: 13 },
      { key: "ettn", header: "ETTN", width: 38 },
      { key: "br", header: "Şube", width: 14 },
    ],
    { y: 1, landscape: true },
  );
  const head = headerRow(ws, colHeaders(ws));
  head.getCell("n").note = "Mal/hizmet tutarı − iskonto. Gerçek maliyet budur (KDV indirilebildiği için).";
  head.getCell("v").note =
    "İndirilecek KDV: faturanın KDV toplamı, tevkifat düşülmeden (Paraşüt'ten gelen; panelin KDV tahmini ve Vergi bunu kullanır). KDV toplamı bilinmeyen faturada (elle girilen ya da içe aktarılmış) ödenecek − net, formülle.";
  head.getCell("w").note = "KDV tevkifatı: KDV toplamından tedarikçiye ödenmeyen kısım (ör. 3/10). Alıcı bunu 2 No.lu KDV beyannamesiyle öder; 1 No.lu beyannamede indirilecek KDV yine tam KDV'dir.";
  head.getCell("pv").note = "Ödenecek − net (formül): tedarikçiye ödenen KDV, tevkifat düşülmüş. Faturada ÖTV ya da ÖİV gibi başka bir vergi varsa o da bu farktadır; indirilecek KDV için KDV sütununa bakın.";
  head.getCell("vkn").note = "Tedarikçinin VKN / TCKN'si (Paraşüt'ten ya da e-faturadan; elle girilen faturada boş).";
  head.getCell("ettn").note = "E-faturanın ETTN'si (GİB): Paraşüt ya da GİB listesiyle satır satır karşılaştırmak için.";
  head.getCell("br").note =
    "Faturanın şubesi: panelde seçilen şube (ayrı Paraşüt hesabının faturası o şubenin, öbürleri tedarikçinin varsayılanıyla ya da elle), bilinçli seçilmiş İşletme geneli ya da Şubesi seçilmemiş.";
  head.getCell("m").note = "Faturanın ayı (Aylık Alımlar sekmesi bu sütuna göre toplar).";
  head.getCell("ob").note = "Ödenmemiş faturanın kalan borcu; kısmen ödenmiş Paraşüt faturasında kalan tutar, tedarikçiye panelde ödeme girildiyse sayılan ödemeler düşülmüş.";
  head.getCell("pp").note = "Bu faturaya sayılan, panelde girilen ödemeler (Tedarikçiler › Hesap hareketleri). Boşsa yok.";
  for (const inv of invoices) {
    const r = ws.rowCount + 1;
    const net = inv.amount - inv.discount;
    // Cari takipteki faturada panelde sayılan ödemeler düşülür (allocated, ledgerBase; src/lib/cari/balance.ts)
    const balance = openBalance({ payable: inv.payable, unpaid: inv.unpaid, outstanding: outstanding?.get(inv.id) ?? inv.outstanding ?? null, allocated: inv.allocated, ledgerBase: inv.ledgerBase });
    const vat = purchaseVat(inv);
    const withheld = purchaseWithheld(inv);
    ws.addRow({
      d: excelDate(inv.date),
      s: inv.supplier,
      de: inv.description,
      no: inv.invoiceNo,
      c: inv.category,
      a: inv.amount,
      i: inv.discount,
      n: { formula: `F${r}-G${r}`, result: round2(net) },
      // İndirilecek KDV panelin KDV tahminiyle aynı (src/lib/kdv.ts purchaseVat): KDV toplamı biliniyorsa o (tevkifatlı
      // faturada ödenecek − net KDV'yi eksik, ÖTV'li faturada fazla gösterirdi; bulgu 17), bilinmiyorsa formül
      v: Math.abs(vat - (inv.payable - net)) < 0.005 ? { formula: `J${r}-H${r}`, result: round2(vat) } : round2(vat),
      p: inv.payable,
      m: { formula: `DATE(YEAR(A${r}),MONTH(A${r}),1)`, result: excelDate(`${monthOfDate(inv.date)}-01`) },
      w: withheld > 0 ? round2(withheld) : null,
      pv: { formula: `J${r}-H${r}`, result: round2(inv.payable - net) },
      vkn: inv.supplierTaxNumber ?? null,
      ettn: inv.eInvoiceUuid ?? null,
      // Faturanın şubesi (docs/SUBE.md › Faturanın şubesi): şube, işletme geneli ya da şubesi seçilmemiş. `companyWide`
      // bilinmeyen (içe aktarılmış, testler) şubesiz fatura işletme geneli
      br: inv.branchId ? (branchNames?.get(inv.branchId) ?? inv.branchId) : inv.companyWide === false ? UNASSIGNED_LABEL : SHARED_LABEL,
      u: inv.unpaid ? "Ödenmedi" : "Ödendi",
      ob: inv.unpaid ? balance : null,
      pp: inv.allocated && inv.allocated > 0.005 ? round2(inv.allocated) : null,
      due: inv.dueDate ? excelDate(inv.dueDate) : null,
      note: inv.note,
      src: invoiceSourceLabel(inv.source),
    });
  }
  const last = ws.rowCount;
  filterRows(ws, 1, last);
  // Toplam bir boş satır altta: süzgeçte görünen faturaların tutarları (SUBTOTAL; Aylık Alımlar'ın aralığı dışında)
  if (invoices.length) {
    const nets = invoices.map((i) => round2(i.amount - i.discount));
    const cell = (key: string, result: number) => subtotal(colLetter(ws.getColumn(key).number), 2, last, result);
    ws.addRow({});
    const tot = ws.addRow({
      d: "TOPLAM",
      a: cell("a", sum(invoices.map((i) => i.amount))),
      i: cell("i", sum(invoices.map((i) => i.discount))),
      n: cell("n", sum(nets)),
      v: cell("v", sum(invoices.map((i) => round2(purchaseVat(i))))),
      p: cell("p", sum(invoices.map((i) => i.payable))),
      ob: cell(
        "ob",
        sum(
          invoices.map((i) =>
            i.unpaid ? (openBalance({ payable: i.payable, unpaid: i.unpaid, outstanding: outstanding?.get(i.id) ?? i.outstanding ?? null, allocated: i.allocated, ledgerBase: i.ledgerBase }) ?? 0) : 0,
          ),
        ),
      ),
      pp: cell("pp", sum(invoices.map((i) => (i.allocated && i.allocated > 0.005 ? round2(i.allocated) : 0)))),
      w: cell("w", sum(invoices.map((i) => (purchaseWithheld(i) > 0 ? round2(purchaseWithheld(i)) : 0)))),
      pv: cell("pv", sum(invoices.map((i) => round2(i.payable - (i.amount - i.discount))))),
    });
    tot.getCell("d").note = "Süzgeçte görünen faturaların toplamı. Aylık Alımlar bu satırı saymaz.";
    totalRow(ws, tot);
  }

  // "Aylara göre net alımlar": ayrı sekmede, süzgeç satırları gizlemesin diye
  const months = [...new Set(invoices.map((i) => monthOfDate(i.date)))].sort();
  const cats = invoiceCategories(invoices);
  const al = addSheet(
    wb,
    "Aylık Alımlar",
    [{ key: "c", header: "Kategori (net, KDV hariç)", width: 34 }, ...months.map((m) => ({ key: m, width: 15, fmt: MONEY0 })), { key: "t", header: "Toplam", width: 16, fmt: MONEY0 }],
    { x: 1, y: 1, landscape: true },
  );
  const ah = headerRow(al, { c: "Kategori (net, KDV hariç)", ...Object.fromEntries(months.map((m) => [m, excelDate(`${m}-01`)])), t: "Toplam" });
  for (const m of months) ah.getCell(m).numFmt = MONTH_LONG;
  ah.getCell("c").note = "Faturalar sekmesinden (SUMIFS): net tutar, kategori ve ay sütunlarına göre. Faturalar'da değişiklik yaparsanız burası da güncellenir.";
  const net = (i: { amount: number; discount: number }) => i.amount - i.discount;
  const mCol = (j: number) => colLetter(2 + j);
  const tCol = colLetter(2 + months.length);
  const hasRows = invoices.length > 0;
  const rowOf = new Map<string, number>();
  const byCat = new Map<string, number[]>();
  // Kafe dışı (karaoke box, Alp Koç) kategoriler TOPLAM'a girmez: TOPLAM ve mal maliyetinden sonra ayrı satırda
  const cafeCats = cats.filter((c) => !SEPARATE_CATEGORIES.includes(c));
  const separateCats = cats.filter((c) => SEPARATE_CATEGORIES.includes(c));
  const addCategoryRow = (cat: string, label: string) => {
    const r = al.rowCount + 1;
    rowOf.set(cat, r);
    const vals = months.map((m) => sum(invoices.filter((i) => i.category === cat && monthOfDate(i.date) === m).map(net)));
    byCat.set(cat, vals);
    return al.addRow({
      c: label,
      ...Object.fromEntries(
        months.map((m, j) => [
          m,
          hasRows ? { formula: `SUMIFS(Faturalar!$H$2:$H$${last},Faturalar!$E$2:$E$${last},$A${r},Faturalar!$K$2:$K$${last},${mCol(j)}$1)`, result: round2(vals[j]) } : 0,
        ]),
      ),
      t: months.length ? { formula: `SUM(B${r}:${mCol(months.length - 1)}${r})`, result: round2(sum(vals)) } : 0,
    });
  };
  for (const cat of cafeCats) addCategoryRow(cat, cat);
  const firstCatRow = 2;
  const lastCatRow = al.rowCount;
  const colTotal = (j: number) => sum(cafeCats.map((cat) => byCat.get(cat)![j]));
  const tr = al.addRow({
    c: "TOPLAM",
    ...Object.fromEntries(months.map((m, j) => [m, { formula: `SUM(${mCol(j)}${firstCatRow}:${mCol(j)}${lastCatRow})`, result: round2(colTotal(j)) }])),
    t: months.length ? { formula: `SUM(${tCol}${firstCatRow}:${tCol}${lastCatRow})`, result: round2(sum(months.map((_, j) => colTotal(j)))) } : 0,
  });
  totalRow(al, tr);
  // Kalem kalem sınıflandırma (src/lib/invoice-split.ts): karışık faturanın hammaddeye bağlı kalemleri mal alışı,
  // mal faturasının nedenli "hammadde değil" kalemi gider. Kategori satırları faturanın kategorisiyle (SUMIFS) kalır;
  // fark ayrı satırda, mal maliyeti panelinkiyle aynı
  const shift = months.map((m) => round2(model.goodsPurchases(m) - sum(GOODS_CATEGORIES.map((g) => byCat.get(g)?.[months.indexOf(m)] ?? 0))));
  if (shift.some((v) => Math.abs(v) >= 0.01)) {
    const r = al.rowCount + 1;
    rowOf.set("__kalem", r);
    const sr = al.addRow({
      c: "Kalem kalem: mal alışına geçen (karışık faturalar)",
      ...Object.fromEntries(months.map((m, j) => [m, shift[j]])),
      t: { formula: `SUM(B${r}:${mCol(months.length - 1)}${r})`, result: round2(sum(shift)) },
    });
    sr.font = { italic: true };
    sr.getCell("c").note =
      "Kategorisi mal alışı olmayan faturanın hammaddeye bağlı kalemleri mal alışı sayılır; mal faturasında Sarf / Demirbaş / Hizmet denmiş kalem kendi giderine geçer (eksi). Faturanın tutarı kalemlerine net tutarlarıyla orantılı bölünür.";
  }
  const goodsRows = [...GOODS_CATEGORIES.map((g) => rowOf.get(g)!), rowOf.get("__kalem")!].filter(Boolean);
  const goodsVal = (j: number) => sum(GOODS_CATEGORIES.map((g) => byCat.get(g)?.[j] ?? 0)) + (rowOf.has("__kalem") ? shift[j] : 0);
  const gr = al.addRow({
    c: `Mal maliyeti (${GOODS_CATEGORIES.join(" + ")})`,
    ...Object.fromEntries(months.map((m, j) => [m, { formula: goodsRows.map((r) => `${mCol(j)}${r}`).join("+"), result: round2(goodsVal(j)) }])),
    t: { formula: goodsRows.map((r) => `${tCol}${r}`).join("+"), result: round2(sum(months.map((_, j) => goodsVal(j)))) },
  });
  gr.font = { bold: true, color: { argb: "FF3F6212" } };
  gr.getCell("c").note = "Gelir-gider sekmesindeki AYLIK MAL ALIMI TOPLAMI (elle girilen DİĞER market alımları hariç) ile aynıdır.";
  // Panelin mal maliyeti hesabıyla aynı olduğunu iç denetim olarak doğrula (farklıysa formülde sorun var)
  months.forEach((m, j) => {
    if (Math.abs(model.goodsPurchases(m) - goodsVal(j)) >= 0.01) gr.getCell(m).note = `Panel bu ay ${tl(model.goodsPurchases(m))} hesaplıyor.`;
  });
  for (const cat of separateCats) {
    const row = addCategoryRow(cat, `${cat} (kafe dışı, TOPLAM'a girmez)`);
    row.font = { italic: true, color: { argb: "FF6B21A8" } };
  }
}

// ---------------------------------------------------------------------------- Personel + Sabit Giderler

/**
 * `branchFile`: şube dosyası (`?sube=`): yatırım toplamı yalnız şubenin, işletme geneli yatırım notunda "İşletme geneli
 * (bilgi)" ve ayrı satırda toplanır (şube ayrımı)
 */
function addPeople(wb: ExcelJS.Workbook, model: Model, month: string, investments: ExportExtras["investments"], branchFile = false) {
  const st = model.settings;
  const label = monthLabel(month);

  // ---------------------------------------------------------------- Personel
  const pers = model.personnelFor(month);
  const pr = addSheet(
    wb,
    "Personel",
    [
      { key: "n", header: `Personel (${label})`, width: 30 },
      { key: "net", header: "Net maaş", width: 14, fmt: MONEY0 },
      { key: "g", header: "Tahmini brüt maaş", width: 15, fmt: MONEY0 },
      { key: "d", header: "İşçi kesintileri (SGK + işsizlik)", width: 18, fmt: MONEY0 },
      { key: "e", header: "İşveren SGK primi", width: 15, fmt: MONEY0 },
      { key: "u", header: "İşveren işsizlik primi", width: 15, fmt: MONEY0 },
      { key: "x", header: "Yemek / yol / prim", width: 15, fmt: MONEY0 },
      { key: "meal", header: "Yemek kartı", width: 13, fmt: MONEY0 },
      { key: "pt", header: "Part-time ücreti (günlük × gün)", width: 17, fmt: MONEY0 },
      { key: "t", header: "Toplam işveren maliyeti", width: 18, fmt: MONEY0 },
    ],
    { y: 1, landscape: true },
  );
  headerRow(pr, colHeaders(pr));
  // Satır tutar (inceleme bulgusu 4): brüt + işveren payları + ek + yemek kartı + part-time ücreti = toplam (brüt = net +
  // kesintiler). Part-time kişinin neti ve brütü yok (SGK brütleştirmesi yok); yemek kartı brütleştirilmez
  for (const r of pers.rows) {
    const part = isPartTime(r.staff);
    const row = pr.addRow({
      n: r.staff.name,
      net: part ? 0 : r.staff.netSalary,
      g: r.gross,
      d: r.deductions,
      e: r.employerSgk,
      u: r.employerUnemployment,
      x: r.staff.extras,
      meal: r.mealCard,
      pt: r.dailyWages,
      t: r.total,
    });
    if (part) row.getCell("pt").note = r.calledDays === null ? "Vardiya bağlantısı yok: çağrıldığı gün bilinmiyor, ücret sayılmadı." : `${num(r.calledDays)} gün × ${tl(r.staff.dailyWage ?? 0)}`;
    if (r.mealCard) row.getCell("meal").note = `${num(r.mealDays)} gün × ${tl(st.mealCardDaily)}${!part && r.asilposDays !== null ? " (AsilPOS'ta çalıştığı gün)" : ""}`;
  }
  if (!pers.rows.length) pr.addRow({ n: `${label} ayında çalışan personel yok.` });
  // TOPLAM herkesi kapsar: tam zamanlıların net, brüt ve payları; ek ve yemek kartı part-time dahil
  const pt = pr.addRow({
    n: "TOPLAM",
    net: pers.net,
    g: pers.gross,
    d: pers.deductions,
    e: pers.employerSgk,
    u: pers.employerUnemployment,
    x: pers.extras + pers.partTime.extras,
    meal: pers.mealCard + pers.partTime.mealCard,
    pt: pers.partTime.wages,
    t: pers.total,
  });
  totalRow(pr, pt);
  filterRows(pr, 1, pt.number - 1);
  pr.addRow({});
  // SGK oranları (Ayarlar)
  sectionRow(pr, "n", "Oranlar");
  for (const [k, v] of [
    ["İşçi SGK primi payı", st.isciSgk],
    ["İşçi işsizlik sigortası payı", st.isciIssizlik],
    ["İşveren SGK primi", st.isverenSgk],
    ["İşveren işsizlik sigortası payı", st.isverenIssizlik],
  ] as [string, number][]) {
    const r = pr.addRow({ n: k, net: v });
    r.getCell("net").numFmt = RATE;
  }
  pr.addRow({ n: "Brüt = net ÷ (1 − işçi SGK − işçi işsizlik). SGK oranları tahminidir; bordrodaki toplam işveren maliyetiyle kontrol edin." });
  // Yalnızca bu ayın listesinde görünmeyen bilgi varsa: ayrılan / başlamayan kişi, başlangıç-bitiş ayı ya da maaş değişikliği
  const staffMore = model.staffList.filter((x) => x.history.length > 1 || x.startMonth || x.endMonth || !inRange(x, month));
  if (staffMore.length) {
    pr.addRow({});
    sectionRow(pr, "n", "Başlangıç, bitiş ve maaş geçmişi (ayrılan ve başlamayan dahil)");
    subHeaderRow(pr, { n: "Personel", net: "Bugünkü net maaş", g: "Başlangıç", d: "Bitiş", e: "Durum (bugün)", u: "Maaş geçmişi" });
  }
  for (const x of staffMore) {
    pr.addRow({
      n: x.name,
      net: x.netSalary,
      g: x.startMonth ? monthLabel(x.startMonth) : "Baştan beri",
      d: x.endMonth ? monthLabel(x.endMonth) : "–",
      e: STATUS_LABEL[x.status],
      u: historyText(x.history, (h) => `${tl(h.netSalary)} net${h.extras ? ` + ${tl(h.extras)} ek` : ""}`),
    });
  }

  // ---------------------------------------------------------------- Sabit Giderler
  const fixed = model.fixedInMonth(month);
  const sg = addSheet(
    wb,
    "Sabit Giderler",
    [
      { key: "n", header: `Gider kalemi (${label})`, width: 40 },
      { key: "s", header: "Bölüm", width: 24 },
      { key: "a", header: "Tutar", width: 14, fmt: MONEY },
      { key: "p", header: "Dönem", width: 12 },
      { key: "m", header: "Aylık karşılığı", width: 15, fmt: MONEY },
      { key: "note", header: "Not", width: 70 },
    ],
    { y: 1, landscape: true },
  );
  headerRow(sg, colHeaders(sg));
  sg.addRow({ n: "Personel (maaş + SGK)", s: "Personel giderleri", m: pers.total, note: "Personel sekmesindeki toplam işveren maliyeti." });
  for (const f of fixed) {
    sg.addRow({ n: f.name, s: FIXED_SECTIONS.find((x) => x.key === f.section)?.label, a: f.amount, p: FIXED_PERIODS.find((x) => x.key === f.period)?.label, m: fixedMonthly(f, st), note: f.note });
  }
  const sgt = sg.addRow({ n: "TOPLAM", m: model.fixedStandardTotalFor(month) });
  totalRow(sg, sgt);
  filterRows(sg, 1, sgt.number - 1);
  sgt.getCell("n").note = "Standart aylık sabit gider: standart bir ayın sabit gider toplamı (personel dahil). Gelir-gider her ayı gün oranıyla hesaplar (Gelir-Gider sekmesinde AÇIK GÜN SAYISI notu).";

  sg.addRow({});
  sectionRow(sg, "n", "Tek seferlik yatırımlar (bilgi amaçlı, aylık gidere dahil değil)");
  subHeaderRow(sg, { n: "Yatırım", s: "Tarih / dönem", a: "Tutar (KDV hariç)", note: "Not" });
  // Şube dosyasında işletme geneli yatırım listede bilgi olarak, toplamda değil (Sabit giderler ekranıyla aynı)
  const sharedInv = branchFile ? investments.filter((i) => !i.branchId) : [];
  const ownInv = branchFile ? investments.filter((i) => i.branchId) : investments;
  for (const i of ownInv) sg.addRow({ n: i.name, s: investmentDate(i.date), a: i.amount, note: i.note });
  for (const i of sharedInv) sg.addRow({ n: i.name, s: investmentDate(i.date), a: i.amount, note: ["İşletme geneli (bilgi; toplama girmez)", i.note].filter(Boolean).join(" · ") });
  if (!investments.length) sg.addRow({ n: "Kayıtlı yatırım yok." });
  const it = sg.addRow({ n: "YATIRIM TOPLAMI", a: sum(ownInv.map((i) => i.amount)) });
  totalRow(sg, it);
  if (sharedInv.length) sg.addRow({ n: "İşletme geneli yatırımlar (bilgi)", a: sum(sharedInv.map((i) => i.amount)), note: "Şubenin toplamına girmez; Tümü dosyasında bir kez sayılır." });

  // Yalnızca bu ayın listesinde görünmeyen bilgi varsa: bitmiş / başlamamış kalem, aralık ya da tutar değişikliği
  const fixedMore = model.fixedList.filter((f) => f.history.length > 1 || f.startMonth || f.endMonth || !inRange(f, month));
  if (fixedMore.length) {
    sg.addRow({});
    sectionRow(sg, "n", "Aralık ve tutar geçmişi (bitmiş ve başlamamış kalemler dahil)");
    subHeaderRow(sg, { n: "Gider kalemi", s: "Hangi aylarda", a: "Bugünkü tutar", p: "Durum (bugün)", m: "Aylık karşılığı (bugün)", note: "Tutar geçmişi" });
  }
  for (const f of fixedMore) {
    sg.addRow({
      n: f.name,
      s: rangeText(f),
      a: f.amount,
      p: STATUS_LABEL[f.status],
      m: f.monthly,
      note: historyText(f.history, (h) => `${tl(h.amount, h.amount < 100 && h.amount !== 0 ? 2 : 0)} ${periodLabel(h.period)}`),
    });
  }
}

// ---------------------------------------------------------------------------- Ham kayıtlar (yedek)

/** Bütün ayların satış satırları, ay bilgileri ve Gelir-gider'de elle girilen hücreler (seçili aydan bağımsız) */
function addRawRecords(wb: ExcelJS.Workbook, model: Model) {
  const ds = model.ds;

  // ---------------------------------------------------------------- Satış Kayıtları
  const keyOf = new Map(model.products.map((p) => [p.product.id, p.key]));
  const sl = addSheet(
    wb,
    "Satış Kayıtları",
    [
      { key: "m", header: "Ay", width: 10, fmt: MONTH_SHORT },
      { key: "n", header: "POS ürün adı", width: 36 },
      { key: "q", header: "Adet", width: 8, fmt: "#,##0" },
      { key: "r", header: "Ciro (KDV dahil)", width: 15, fmt: MONEY },
      { key: "p", header: "Eşleşen ürün (anahtar)", width: 30 },
      { key: "note", header: "Not", width: 50 },
    ],
    { y: 1, raw: true },
  );
  headerRow(sl, colHeaders(sl));
  const lines = ds.salesLines.map((l, i) => ({ l, i })).sort((a, b) => a.l.month.localeCompare(b.l.month) || a.i - b.i);
  for (const { l } of lines) {
    sl.addRow({
      m: excelDate(`${l.month}-01`),
      n: l.posName,
      q: l.qty,
      r: l.revenue,
      p: l.isService ? "HİZMET" : l.productId !== null ? (keyOf.get(l.productId) ?? `#${l.productId}`) : null,
      note: l.note,
    });
  }
  if (!lines.length) sl.addRow({ n: "Kayıtlı satış satırı yok." });
  filterRows(sl, 1, sl.rowCount);

  // ---------------------------------------------------------------- Ay Bilgileri
  const ai = addSheet(
    wb,
    "Ay Bilgileri",
    [
      { key: "m", header: "Ay", width: 12, fmt: MONTH_LONG },
      { key: "o", header: "Açık gün", width: 9, fmt: "0" },
      { key: "r", header: "POS ciro (KDV dahil)", width: 16, fmt: MONEY0 },
      { key: "d", header: "Yönetici indirimleri", width: 15, fmt: MONEY0 },
      { key: "x", header: "Ciro dışı (ödenmez / ikram)", width: 16, fmt: MONEY0 },
      { key: "c", header: "Kartlı satış oranı", width: 11, fmt: PCT },
      { key: "k", header: "Kasa raporundan", width: 24 },
      { key: "note", header: "Ay notu", width: 70 },
    ],
    { y: 1, raw: true },
  );
  headerRow(ai, colHeaders(ai));
  const months = [...ds.months].sort((a, b) => a.month.localeCompare(b.month));
  // Değerler etkin olanlar (elle yazılan, yoksa kasa raporlarından); kasadan gelen alanlar ayrıca adıyla
  const KASA_NAMES: Record<MonthField, string> = { openDays: "açık gün", posRevenue: "ciro", discounts: "indirim", offRevenue: "ödenmez", cardShare: "kartlı oran" };
  for (const m of months) {
    const fromKasa = MONTH_FIELDS.filter((f) => m.sources?.[f] === "kasa").map((f) => KASA_NAMES[f]);
    ai.addRow({ m: excelDate(`${m.month}-01`), o: m.openDays, r: m.posRevenue, d: m.discounts, x: m.offRevenue, c: m.cardShare ?? null, k: fromKasa.join(", ") || null, note: m.note });
  }
  if (!months.length) ai.addRow({ note: "Kayıtlı ay bilgisi yok." });
  filterRows(ai, 1, ai.rowCount);

  // ---------------------------------------------------------------- Gelir-Gider Kayıtları
  const gk = addSheet(
    wb,
    "Gelir-Gider Kayıtları",
    [
      { key: "m", header: "Ay", width: 10, fmt: MONTH_SHORT },
      { key: "s", header: "Bölüm", width: 24 },
      { key: "l", header: "Satır", width: 44 },
      { key: "a", header: "Girilen tutar", width: 15, fmt: MONEY },
      { key: "c", header: "Panelin hesapladığı", width: 15, fmt: MONEY },
      { key: "note", header: "Hücre notu", width: 50 },
      { key: "k", header: "Satır anahtarı", width: 22 },
    ],
    { y: 1, raw: true },
  );
  const gh = headerRow(gk, colHeaders(gk));
  gh.getCell("c").note = "Elle girilmeseydi panelin bu hücre için hesaplayacağı tutar (boşsa hesaplanan bir değer yok: elle girilen satır).";
  // Satır adı ve sırası: o yılın Gelir-gider tablosundan
  const defsByYear = new Map<number, Map<string, { label: string; section: string; order: number }>>();
  const defsOf = (year: number) => {
    let map = defsByYear.get(year);
    if (!map) {
      map = new Map();
      model.pnlRowDefs(yearMonths(year)).forEach((d, order) => {
        if (!map!.has(d.key)) map!.set(d.key, { label: d.sub ? `${d.label} (${d.sub})` : d.label, section: d.section, order });
      });
      defsByYear.set(year, map);
    }
    return map;
  };
  const calcs = new Map<string, PnlMonthCalc>();
  const calcOf = (m: string) => {
    let c = calcs.get(m);
    if (!c) calcs.set(m, (c = model.pnlMonth(m)));
    return c;
  };
  const entries = ds.pnlEntries
    .map((e) => ({ e, def: defsOf(Number(e.month.slice(0, 4))).get(e.rowKey) }))
    .sort((a, b) => a.e.month.localeCompare(b.e.month) || (a.def?.order ?? 999) - (b.def?.order ?? 999) || a.e.rowKey.localeCompare(b.e.rowKey));
  for (const { e, def } of entries) {
    const computed = calcOf(e.month).cells.get(e.rowKey)?.computed ?? null;
    gk.addRow({
      m: excelDate(`${e.month}-01`),
      s: def ? (PNL_SECTION_LABELS[def.section] ?? def.section) : null,
      l: def?.label ?? e.rowKey,
      a: e.amount,
      c: computed,
      note: e.note ?? null,
      k: e.rowKey,
    });
  }
  if (!entries.length) gk.addRow({ l: "Gelir-gider tablosunda elle girilen hücre yok." });
  filterRows(gk, 1, gk.rowCount);
}

function addRawStock(wb: ExcelJS.Workbook, model: Model, branchFile = false) {
  const ds = model.ds;
  const sk = addSheet(
    wb,
    "Sayım Kayıtları",
    [
      { key: "m", header: "Ay", width: 10, fmt: MONTH_SHORT },
      { key: "t", header: "Tür", width: 16 },
      { key: "n", header: "Malzeme / kalem", width: 40 },
      { key: "g", header: "Sayım grubu", width: 24 },
      { key: "q", header: "Miktar", width: 11, fmt: QTY },
      { key: "u", header: "Sayım birimi", width: 10 },
      { key: "b", header: "Malzemenin biriminde", width: 14, fmt: QTY },
      { key: "bu", header: "Birim", width: 8 },
      { key: "p", header: "Birim fiyatı (sayım birimi)", width: 14, fmt: MONEY },
      { key: "a", header: "Tutar (KDV hariç)", width: 14, fmt: MONEY },
      { key: "x", header: "Değerleme", width: 48 },
    ],
    { y: 1, landscape: true, raw: true },
  );
  headerRow(sk, colHeaders(sk));
  const months = [...new Set([...ds.stockCounts.map((c) => c.month), ...ds.stockExtras.map((e) => e.month)])].sort();
  for (const m of months) {
    const sheet = model.stockSheet(m);
    for (const g of sheet.groups) {
      for (const l of g.lines) {
        if (l.qty === null) continue;
        sk.addRow({ m: excelDate(`${m}-01`), t: "Sayım", n: l.ingredient.name, g: g.name, q: l.qty, u: l.countUnit, b: model.countInBaseUnit(m, l.ingredient.id), bu: l.ingredient.unit, p: l.unitPrice, a: l.amount, x: l.valuation === "fifo" && l.qty ? `FIFO: ${layerText(l.layers, l.factor, l.countUnit)}` : "Ay sonu fiyatı" });
      }
    }
    for (const e of sheet.extras) sk.addRow({ m: excelDate(`${m}-01`), t: "Listede olmayan", n: e.name, q: e.qty, u: e.unit, p: e.unitPrice, a: e.amount });
  }
  if (!months.length) sk.addRow({ t: "Kayıtlı sayım yok." });
  filterRows(sk, 1, sk.rowCount);

  const pq = addSheet(
    wb,
    "Alım Miktarları",
    [
      { key: "m", header: "Ay", width: 10, fmt: MONTH_SHORT },
      { key: "n", header: "Malzeme", width: 34 },
      { key: "q", header: "Faturayla alınan miktar", width: 16, fmt: QTY },
      { key: "u", header: "Birim", width: 8 },
      { key: "note", header: "Kaynak faturalar / yorum", width: 70 },
    ],
    { y: 1, raw: true },
  );
  const pqHead = headerRow(pq, colHeaders(pq));
  // Alım miktarlarının şubesi yok: şube dosyasında da firmanın (şube ayrımı parça 6)
  if (branchFile) pqHead.getCell("q").note = "Firma geneli: elle yazılan alım miktarlarının şubesi yok, bütün şubelerin alımıdır.";
  const order = new Map(ds.ingredients.map((i) => [i.id, i.sortOrder]));
  const rows = [...ds.purchaseQuantities].sort((a, b) => a.month.localeCompare(b.month) || (order.get(a.ingredientId) ?? 0) - (order.get(b.ingredientId) ?? 0));
  for (const p of rows) {
    const ing = model.ingById.get(p.ingredientId);
    pq.addRow({ m: excelDate(`${p.month}-01`), n: ing?.name ?? `#${p.ingredientId}`, q: p.qty, u: ing?.unit, note: p.note });
  }
  if (!rows.length) pq.addRow({ n: "Kayıtlı alım miktarı yok." });
  filterRows(pq, 1, pq.rowCount);
}

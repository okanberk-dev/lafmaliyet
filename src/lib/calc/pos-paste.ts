// Patron (ModPOS) ürün satış listesini okuyan saf yardımcılar. Hem tarayıcıda (Yapıştır) hem sunucuda
// (dosya yükleme) aynı kurallar çalışır: toplam ve başlık satırları ürün sayılmaz, kaç satırın neden
// atlandığı raporlanır (sessiz veri değişikliği yok). POS adı eşleştirme anahtarı da buradadır.

import { SALES_HEADER_NAMES, SALES_SUMMARY_PATTERNS } from "../constants";
import { parseNumberTR } from "./expr";

export interface SalesRow {
  posName: string;
  qty: number;
  /** Ciro, KDV dahil */
  revenue: number;
}

export type SkipReason = "summary" | "header" | "invalid";

export interface SkippedRow {
  /** 1'den başlayan satır numarası (yapıştırılan metinde ya da dosyada) */
  line: number;
  text: string;
  reason: SkipReason;
}

export interface SalesParseResult {
  rows: SalesRow[];
  /** Atlanan satır sayıları: toplam satırı, başlık, adet/ciro okunamayan satır */
  skipped: Record<SkipReason, number>;
  /** Atlanan satırların ilk 50'si (önizlemede "neden atlandı" göstermek için) */
  skippedRows: SkippedRow[];
  /**
   * Cirosu diğer bütün satırların toplamına neredeyse eşit olan satırların `rows` içindeki sırası.
   * Adı "TOPLAM" olmayan bir toplam satırı olabilir; otomatik atlanmaz, kullanıcıya sorulmalıdır.
   */
  suspectTotals: number[];
}

const MAX_SKIPPED_ROWS = 50;

/** Karşılaştırma için: Türkçe küçük harf, ı→i, aksanlar atılır ("GENEL TOPLAM (KDV dahil):" → "genel toplam (kdv dahil):") */
function fold(s: string): string {
  return s
    .normalize("NFC")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parantez içi açıklamayı ve sondaki ":" / "=" işaretini atar */
function bareLabel(name: string): string {
  return fold(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[:=*.\-–]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "TOPLAM", "Genel Toplam (KDV dahil)", "ARA TOPLAM:", "Toplamlar", "Grand total" gibi özet satırları */
export function isSummaryRow(name: string): boolean {
  const s = bareLabel(name);
  return !!s && SALES_SUMMARY_PATTERNS.some((re) => re.test(s));
}

/** "Ürün Adı", "Ürün", "Product" gibi başlık hücresi */
export function isHeaderName(name: string): boolean {
  return SALES_HEADER_NAMES.includes(bareLabel(name));
}

const HEADER_WORDS = /\b(adet|miktar|tutar|ciro|fiyat|quantity|qty|amount|total)\b/;

function cleanName(s: string): string {
  return s.replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").trim();
}

/** Hücredeki sayı: "12", "1.250,50", "1250.5 ₺", "5 adet" */
function cellNumber(c: unknown): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c !== "string") return null;
  const t = c.replace(/^["']+|["']+$/g, "").replace(/\b(adet|ad\.?|pcs)\b/gi, "").trim();
  if (!t || /%/.test(t)) return null;
  return parseNumberTR(t);
}

const isNameCell = (c: unknown): c is string => typeof c === "string" && cleanName(c) !== "" && cellNumber(c) === null;

/**
 * Başlık satırından sütun düzeni: ad sütunundan sonraki sayı sütunları içinde adet ve ciro kaçıncı sırada.
 * "Ürün | Kategori | Adet | Birim fiyat | Tutar" → adet 0., ciro 2. sayı (birim fiyat ciro sanılmasın).
 * Adet ve ciro sütunu bulunamazsa null (ad sonrası ilk iki sayı kuralı geçerli kalır).
 */
export interface SalesLayout {
  qty: number;
  revenue: number;
  /** Başlıktaki sayı sütunu sayısı; satırdaki sayı adedi buna eşitse düzen uygulanır */
  count: number;
}

const QTY_HEAD = /\b(adet|adedi|miktar|miktari|qty|quantity)\b/;
const REV_HEAD = /\b(tutar|tutari|ciro|cirosu|amount|total|toplam)\b/;
const PRICE_HEAD = /\b(birim|fiyat|fiyati|price)\b/;
const OTHER_NUM_HEAD = /\b(kdv|indirim|iskonto|oran|barkod|kod|kodu|code|no|sira)\b|%/;
const NAME_HEAD = /\b(urun|stok|product|item|kalem)\b/;

export function headerLayout(cells: unknown[]): SalesLayout | null {
  const texts = cells.map((c) => (typeof c === "string" ? bareLabel(c) : ""));
  const nameIdx = texts.findIndex((t) => t !== "" && (SALES_HEADER_NAMES.includes(t) || NAME_HEAD.test(t)));
  if (nameIdx < 0) return null;
  let qty = -1;
  let revenue = -1;
  let count = 0;
  for (const t of texts.slice(nameIdx + 1)) {
    if (!t) continue;
    const price = PRICE_HEAD.test(t);
    // "KDV tutarı" ciro değildir; "KDV dahil tutar" ciro
    const vatOnly = /\bkdv\b/.test(t) && !/\bdahil\b/.test(t);
    if (!price && qty < 0 && QTY_HEAD.test(t)) qty = count++;
    else if (!price && !vatOnly && REV_HEAD.test(t)) revenue = count++;
    else if (price || vatOnly || OTHER_NUM_HEAD.test(t) || QTY_HEAD.test(t)) count++;
  }
  return qty >= 0 && revenue >= 0 ? { qty, revenue, count } : null;
}

/**
 * Ad hücresinden sonra gelen sayılar: adet ve ciro. Başlıktan sütun düzeni okunduysa (layout) ve satırdaki sayı
 * adedi başlığa uyuyorsa o sütunlar; yoksa ilk iki sayı.
 */
function rowFromCells(cells: unknown[], layout: SalesLayout | null = null): { kind: "row"; row: SalesRow } | { kind: SkipReason } {
  const nameIdx = cells.findIndex(isNameCell);
  if (nameIdx < 0) return { kind: "invalid" };
  const posName = cleanName(cells[nameIdx] as string);
  const nums = cells
    .slice(nameIdx + 1)
    .map(cellNumber)
    .filter((v): v is number => v !== null);
  if (isSummaryRow(posName)) return { kind: "summary" };
  if (nums.length < 2) {
    const texts = cells.filter((c): c is string => typeof c === "string").map(fold);
    if (isHeaderName(posName) || texts.some((t) => HEADER_WORDS.test(t))) return { kind: "header" };
    return { kind: "invalid" };
  }
  if (isHeaderName(posName)) return { kind: "header" };
  if (layout && nums.length === layout.count) return { kind: "row", row: { posName, qty: nums[layout.qty], revenue: nums[layout.revenue] } };
  return { kind: "row", row: { posName, qty: nums[0], revenue: nums[1] } };
}

// Sekme / noktalı virgül / iki boşluk yoksa: "Ad 12 2.400" ya da "Ad, 12, 1.250,50" (adet tam sayı kabul edilir)
const TAIL_RE = /^(.+?)[\s,;]+(-?\d{1,3}(?:\.\d{3})+|-?\d+)\s*(?:adet)?[\s,;]+(-?[\d.]*\d(?:,\d+)?)\s*(?:₺|tl)?$/i;

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  if (/\S\s{2,}\S/.test(line)) return line.split(/\s{2,}/);
  const m = TAIL_RE.exec(line);
  if (m) return [m[1], m[2], m[3]];
  return line.split(",");
}

function finish(rows: SalesRow[], skippedRows: SkippedRow[], skipped: Record<SkipReason, number>): SalesParseResult {
  return { rows, skipped, skippedRows: skippedRows.slice(0, MAX_SKIPPED_ROWS), suspectTotals: suspectTotalRows(rows) };
}

/**
 * Yapıştırılan metni (Patron ekranından ya da bir tablo programından kopyalanan liste) okur.
 * Her satır: ürün adı, adet, ciro (KDV dahil). Sekme, noktalı virgül, iki boşluk ya da virgülle ayrılabilir.
 */
export function parsePastedSales(text: string): SalesParseResult {
  const rows: SalesRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const skipped: Record<SkipReason, number> = { summary: 0, header: 0, invalid: 0 };
  let layout: SalesLayout | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = splitLine(line).map((p) => p.trim()).filter(Boolean);
    const r = rowFromCells(cells, layout);
    if (r.kind === "row") rows.push(r.row);
    else {
      if (r.kind === "header") layout = headerLayout(cells) ?? layout;
      skipped[r.kind]++;
      skippedRows.push({ line: i + 1, text: line.slice(0, 120), reason: r.kind });
    }
  });
  return finish(rows, skippedRows, skipped);
}

/** Dosyadan (xlsx / csv) okunan tabloyu satırlara çevirir; hücreler sayı ya da metin olabilir. */
export function extractSalesRows(table: unknown[][]): SalesParseResult {
  const rows: SalesRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const skipped: Record<SkipReason, number> = { summary: 0, header: 0, invalid: 0 };
  let layout: SalesLayout | null = null;
  table.forEach((r, i) => {
    const cells = (r ?? []).map((c) => (c === null || c === undefined ? "" : c instanceof Date ? "" : c));
    if (!cells.some((c) => (typeof c === "string" ? c.trim() !== "" : typeof c === "number"))) return;
    const res = rowFromCells(cells, layout);
    if (res.kind === "row") rows.push(res.row);
    else {
      if (res.kind === "header") layout = headerLayout(cells) ?? layout;
      skipped[res.kind]++;
      skippedRows.push({ line: i + 1, text: cells.map(String).filter(Boolean).join(" · ").slice(0, 120), reason: res.kind });
    }
  });
  return finish(rows, skippedRows, skipped);
}

/** Cirosu geri kalan satırların toplamına (±%0,5) eşit olan satırlar: büyük olasılıkla toplam satırı */
export function suspectTotalRows(rows: SalesRow[]): number[] {
  if (rows.length < 4) return [];
  const total = rows.reduce((a, r) => a + r.revenue, 0);
  const out: number[] = [];
  rows.forEach((r, i) => {
    const others = total - r.revenue;
    if (others > 0 && Math.abs(r.revenue - others) <= Math.max(1, others * 0.005)) out.push(i);
  });
  return out;
}

/** "1 toplam satırı ve 1 başlık atlandı; 2 satır okunamadı" — atlanan yoksa null */
export function describeSkipped(skipped: Record<SkipReason, number>): string | null {
  const parts: string[] = [];
  if (skipped.summary) parts.push(`${skipped.summary} toplam satırı`);
  if (skipped.header) parts.push(`${skipped.header} başlık satırı`);
  const head = parts.length ? `${parts.join(" ve ")} atlandı` : "";
  const tail = skipped.invalid ? `${skipped.invalid} satırda adet ve ciro okunamadı` : "";
  return [head, tail].filter(Boolean).join("; ") || null;
}

// ---------------------------------------------------------------- POS adı eşleştirme anahtarı

/**
 * Hatırlanan eşleştirmelerin karşılaştırma anahtarı: boşluklar sadeleşir, büyük/küçük harf ve
 * I / İ / ı / i farkı yok sayılır, ’ ‘ ` ´ kesme işaretine çevrilir.
 * "Caramel Latte Medium", "CARAMEL LATTE MEDİUM" ve "CARAMEL LATTE MEDIUM" aynı anahtarı verir.
 * Diğer Türkçe harfler (Ç, Ş, Ğ, Ö, Ü) korunur.
 *
 * Eski kayıtlar normalizePosName (tr-TR büyük harf) ile saklandığı için iki tarafa da uygulanmalıdır:
 * `posMatchKey(kayıtlıAd) === posMatchKey(yeniAd)`. Bu sayede veri taşımadan eski kayıtlar eşleşmeye devam eder.
 */
export function posMatchKey(name: string): string {
  return name
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[’‘`´]/g, "'")
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/̇/g, "");
}

export const samePosName = (a: string, b: string) => posMatchKey(a) === posMatchKey(b);

const time = (v: Date | string | number | null | undefined) => (v === null || v === undefined ? 0 : new Date(v).getTime() || 0);

/**
 * Kayıtlı eşleştirmelerden arama tablosu. Aynı anahtara düşen birden fazla kayıt varsa
 * (ör. eski "LATTE MEDİUM" ve yeni "LATTE MEDIUM") en son güncellenen kazanır.
 */
export function createPosMappingIndex<T extends { posName: string; updatedAt?: Date | string | number | null }>(mappings: T[]) {
  const byKey = new Map<string, T>();
  for (const m of mappings) {
    const k = posMatchKey(m.posName);
    const prev = byKey.get(k);
    if (!prev || time(m.updatedAt) >= time(prev.updatedAt)) byKey.set(k, m);
  }
  return {
    get: (posName: string) => byKey.get(posMatchKey(posName)),
    /** Aynı anahtara düşen bütün kayıtlı adlar (silerken ya da güncellerken hepsine uygulamak için) */
    storedNames: (posName: string) => mappings.filter((m) => posMatchKey(m.posName) === posMatchKey(posName)).map((m) => m.posName),
    size: byKey.size,
  };
}

/**
 * Mutabakat: banka ve tedarikçi ekstresini okuma (saf; tests/mutabakat-okuma.test.ts, docs/MUTABAKAT.md).
 *
 * Bankaların dışa aktarımı birbirine benzemez: başlık satırı dosyanın ortasında olabilir (üstte hesap bilgisi), tutar
 * tek sütunda (eksi = çıkış) ya da iki sütunda (Borç / Alacak), sayılar "1.234,56" ya da "1,234.56", tarihler
 * "05.11.2026", "05/11/2026 14:32", "2026-11-05" ya da Excel tarihi gelir. Okuma esnek sütun eşlemesiyle yapılır:
 * başlık satırı ve sütunlar adlarından tanınır (`detectColumns`); tanınmazsa yönetici sütunları kendisi seçer
 * (`ColumnMap`). Dosya saklanmaz: yalnız okunan satırlar (gün, açıklama, tutar, belge no, bakiye) döner.
 */

export type Cell = string | number | Date | null | undefined;
export type Grid = readonly (readonly Cell[])[];

/** Ekstrenin türü: tutarın işareti buna göre okunur */
export type StatementKind = "banka" | "tedarikci";

export interface ColumnMap {
  /** Başlık satırının sırası (0'dan); veri sonraki satırdan başlar */
  headerRow: number;
  date: number;
  description: number | null;
  /** Tek tutar sütunu (işaretli); `debit` / `credit` ile birlikte verilmez */
  amount: number | null;
  /** Borç sütunu: bankada hesaptan çıkan, tedarikçi ekstresinde bize kesilen fatura */
  debit: number | null;
  /** Alacak sütunu: bankada hesaba giren, tedarikçi ekstresinde ödememiz */
  credit: number | null;
  balance: number | null;
  ref: number | null;
}

export interface ParsedLine {
  /** Dosyadaki satır (1'den; başlık dahil sayılır) */
  rowNo: number;
  date: string;
  description: string;
  /**
   * İşaretli tutar. Banka: + hesaba giren, − hesaptan çıkan. Tedarikçi ekstresi: + borcumuzu artıran (fatura),
   * − azaltan (ödeme, iade).
   */
  amount: number;
  balance: number | null;
  ref: string | null;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** Tarihi ya da tutarı okunamadığı için atlanan veri satırı sayısı (boş satırlar sayılmaz) */
  skipped: number;
  map: ColumnMap;
  /** Başlık satırındaki adlar (elle eşleme için) */
  headers: string[];
}

/** Bir ekstreden en çok bu kadar satır okunur (yanlış dosya seçilirse veritabanı dolmasın) */
export const MAX_LINES = 3000;
/** Yüklenen dosyanın en büyük boyutu (Server Action sınırı 4,5 MB; next.config.ts) */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Açıklamanın saklanan en uzun hâli */
export const MAX_DESCRIPTION = 300;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Karşılaştırma anahtarı: küçük harf, Türkçe harfler sadeleşmiş, harf ve rakam dışı her şey boşluk */
export function fold(text: string): string {
  return text
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? "" : c.toISOString().slice(0, 10);
  return String(c).trim();
}

/**
 * Tutar: "1.234,56", "1,234.56", "1234,5", "-1.234,56", "(1.234,56)", "1.234,56-", "1.234,56 TL", "₺1.234" → sayı.
 * Son ayraç ondalıktır; tek ayraç varsa ve ardından tam üç rakam geliyorsa binliktir ("1.234" = 1234). Okunamazsa null.
 */
export function parseAmount(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? r2(c) : null;
  let s = cellText(c);
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\s|₺|TL|TRY|try|tl/g, "");
  // Sondaki "B" / "A" (borç / alacak) eki işareti değiştirmez: sütun zaten yönü söyler
  s = s.replace(/[−–]/g, "-");
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    normal = s.split(group).join("").replace(decimal, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    // "1.234.567" ya da "1.234": binlik; "12,5" / "12.50": ondalık
    const grouped = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== "0");
    normal = grouped ? parts.join("") : parts.join(".");
  } else normal = s;
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  return r2(negative ? -n : n);
}

const pad = (n: number) => String(n).padStart(2, "0");
const validDay = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * Gün: "05.11.2026", "5/11/2026 14:32", "05-11-26", "2026-11-05T…", Excel tarihi (Date ya da seri numarası) →
 * "YYYY-MM-DD". Türk biçimi gün-ay-yıldır; ay / gün / yıl (ABD) biçimi desteklenmez. Okunamazsa null.
 */
export function parseDay(c: Cell): string | null {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return null;
    // Excel tarihleri UTC gece yarısı gelir; saatli hücrede Türkiye günü
    const shifted = new Date(c.getTime() + (c.getUTCHours() || c.getUTCMinutes() ? 3 * 3_600_000 : 0));
    return validDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }
  if (typeof c === "number") {
    // Excel seri numarası (1900 takvimi): 36526 = 1 Ocak 2000
    if (c < 36526 || c > 73415) return null;
    const dt = new Date(Math.round((Math.floor(c) - 25569) * 86_400_000));
    return validDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = cellText(c);
  if (!s) return null;
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\D|$)/.exec(s);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})(?:\D|$)/.exec(s);
  if (m) return validDay(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// ---------------------------------------------------------------- Sütunları tanıma

type Role = "date" | "description" | "amount" | "debit" | "credit" | "balance" | "ref";

/**
 * Başlık adları (sadeleşmiş). Sıra önemlidir: bir başlık ilk uyan role gider; "işlem tarihi" tarih, "işlem tutarı"
 * tutar, "bakiye" bakiye. Valör tarihi ikinci tercihtir (işlem tarihi yoksa kullanılır).
 */
const HEADER_RULES: { role: Role; test: (h: string) => boolean }[] = [
  { role: "balance", test: (h) => /\bbakiye\b|\bbalance\b|kalan/.test(h) },
  { role: "date", test: (h) => /tarih|\bdate\b|^gun$/.test(h) },
  { role: "debit", test: (h) => /^borc\b|\bborc( tutari?)?$|cikan|\bcikis\b|odenen|\bdebit\b|\bcekilen\b/.test(h) },
  { role: "credit", test: (h) => /^alacak\b|\balacak( tutari?)?$|giren|\bgiris\b|yatan|\bcredit\b|tahsilat/.test(h) },
  { role: "amount", test: (h) => /tutar|\bamount\b|\bmeblag\b|islem tl/.test(h) },
  { role: "ref", test: (h) => /dekont|fis no|belge no|evrak|referans|\bref\b|fatura no|islem no|sira no|belge numarasi/.test(h) },
  { role: "description", test: (h) => /aciklama|\bdescription\b|detay|islem adi|islem turu|\bislem\b|karsi hesap|alici|gonderen|unvan/.test(h) },
];

function roleOf(header: string): Role | null {
  const h = fold(header);
  if (!h) return null;
  return HEADER_RULES.find((r) => r.test(h))?.role ?? null;
}

/**
 * Başlık satırını ve sütunları bulur: ilk 40 satırda bir tarih sütunu ile bir tutar (ya da borç / alacak) sütunu
 * taşıyan ilk satır başlıktır. Bulunamazsa null (yönetici sütunları kendisi seçer).
 */
export function detectColumns(grid: Grid): ColumnMap | null {
  const limit = Math.min(grid.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = grid[r] ?? [];
    const found: Partial<Record<Role, number>> = {};
    let valueDate: number | null = null;
    row.forEach((c, i) => {
      if (typeof c !== "string") return;
      const role = roleOf(c);
      if (!role) return;
      if (role === "date") {
        // "Valör" işlem gününden sonra olabilir: işlem tarihi varsa o
        if (/valor/.test(fold(c))) {
          valueDate ??= i;
          return;
        }
      }
      if (found[role] === undefined) found[role] = i;
    });
    const date = found.date ?? valueDate;
    if (date === null || date === undefined) continue;
    const paired = found.debit !== undefined || found.credit !== undefined;
    if (!paired && found.amount === undefined) continue;
    return {
      headerRow: r,
      date,
      description: found.description ?? null,
      // Borç / Alacak varsa tek tutar sütunu kullanılmaz (bazı bankalar ikisini de verir)
      amount: paired ? null : (found.amount ?? null),
      debit: paired ? (found.debit ?? null) : null,
      credit: paired ? (found.credit ?? null) : null,
      balance: found.balance ?? null,
      ref: found.ref ?? null,
    };
  }
  return null;
}

/** Başlık satırı adayı: elle eşlemede gösterilecek satır (en çok dolu metin hücresi olan ilk 40 satırdan biri) */
export function guessHeaderRow(grid: Grid): number {
  let best = 0;
  let bestCount = -1;
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const count = (grid[r] ?? []).filter((c) => typeof c === "string" && c.trim() && parseAmount(c) === null && parseDay(c) === null).length;
    if (count > bestCount) {
      best = r;
      bestCount = count;
    }
  }
  return best;
}

export const headersOf = (grid: Grid, headerRow: number): string[] => (grid[headerRow] ?? []).map((c, i) => cellText(c) || `Sütun ${i + 1}`);

/** Eşlemenin eksiği: kullanıcıya gösterilecek metin, yoksa null */
export function columnMapProblem(map: ColumnMap, width: number): string | null {
  const cols = [map.date, map.description, map.amount, map.debit, map.credit, map.balance, map.ref].filter((c): c is number => c !== null);
  if (cols.some((c) => !Number.isInteger(c) || c < 0 || c >= Math.max(width, 1))) return "Seçilen sütun dosyada yok";
  if (map.amount === null && map.debit === null && map.credit === null) return "Tutar sütununu (ya da Borç / Alacak sütunlarını) seçin";
  if (map.amount !== null && (map.debit !== null || map.credit !== null)) return "Tek tutar sütunu ile Borç / Alacak birlikte seçilemez";
  return null;
}

// ---------------------------------------------------------------- KVKK: açıklamayı sadeleştirme

/**
 * Açıklamadaki kişisel ya da hassas numaralar saklanmaz (KVKK, veri en azı): IBAN, kart numarası ve 11 hane ve üstü
 * rakam dizileri (TCKN, hesap no) son dört hane kalacak biçimde örtülür. Ad ve işlem metni kalır: eşleştirme ona bakar.
 */
export function maskSensitive(text: string): string {
  return text
    .replace(/\bTR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi, (m) => `TR••${m.replace(/\s/g, "").slice(-4)}`)
    .replace(/\b\d(?:[ -]?[\d*]){10,}\b/g, (m) => {
      const digits = m.replace(/[^\d]/g, "");
      return `••${digits.slice(-4)}`;
    });
}

// ---------------------------------------------------------------- Satırları okuma

export interface ParseOptions {
  kind: StatementKind;
  /** Elle seçilen sütunlar; verilmezse başlıktan tanınır */
  map?: ColumnMap | null;
  /** Tutarın işaretini çevir (tek tutar sütununda çıkışı artı yazan banka, ödemeyi artı yazan tedarikçi) */
  flip?: boolean;
}

/**
 * Tablodan ekstre satırları. Borç / Alacak sütunlu dosyada: banka → tutar = alacak − borç (hesaba giren artı);
 * tedarikçi → tutar = borç − alacak (fatura artı). Tek sütunda işaret dosyadaki gibi. Tarihi okunamayan satır
 * (ara toplam, devir, sayfa altlığı) atlanır; tutarı 0 olan satır da.
 */
export function parseStatement(grid: Grid, opts: ParseOptions): ParseResult | { error: string; headers: string[]; headerRow: number } {
  const map = opts.map ?? detectColumns(grid);
  if (!map) {
    const headerRow = guessHeaderRow(grid);
    return { error: "Sütunlar tanınamadı: tarih ve tutar sütunlarını seçin", headers: headersOf(grid, headerRow), headerRow };
  }
  const width = Math.max(0, ...grid.slice(0, 200).map((r) => r?.length ?? 0));
  const problem = columnMapProblem(map, width);
  if (problem) return { error: problem, headers: headersOf(grid, map.headerRow), headerRow: map.headerRow };

  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (let r = map.headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (!row.some((c) => cellText(c))) continue;
    const date = parseDay(row[map.date]);
    let amount: number | null;
    if (map.amount !== null) amount = parseAmount(row[map.amount]);
    else {
      const debit = map.debit !== null ? parseAmount(row[map.debit]) : null;
      const credit = map.credit !== null ? parseAmount(row[map.credit]) : null;
      if (debit === null && credit === null) amount = null;
      else {
        // Bazı bankalar borcu eksi yazar: sütun yönü belirler, işaret değil
        const d = Math.abs(debit ?? 0);
        const c = Math.abs(credit ?? 0);
        amount = r2(opts.kind === "banka" ? c - d : d - c);
      }
    }
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    if (opts.flip) amount = r2(-amount);
    if (Math.abs(amount) < 0.005) continue;
    const rawText = map.description !== null ? cellText(row[map.description]).replace(/\s+/g, " ") : "";
    // Tedarikçi ekstresinde açıklama fatura numarasıdır (eşleşme ona bakar); kişisel numara bankanın açıklamasında olur
    const description = (opts.kind === "banka" ? maskSensitive(rawText) : rawText).slice(0, MAX_DESCRIPTION);
    const ref = map.ref !== null ? cellText(row[map.ref]).slice(0, 60) || null : null;
    const balance = map.balance !== null ? parseAmount(row[map.balance]) : null;
    lines.push({ rowNo: r + 1, date, description, amount, balance, ref });
    if (lines.length > MAX_LINES) return { error: `Dosyada ${MAX_LINES} satırdan fazla hareket var; daha kısa bir dönem seçip yeniden indirin`, headers: headersOf(grid, map.headerRow), headerRow: map.headerRow };
  }
  return { lines, skipped, map, headers: headersOf(grid, map.headerRow) };
}

// ---------------------------------------------------------------- CSV

/**
 * CSV metni → tablo. Ayraç ilk dolu satırlardan seçilir (sekme, noktalı virgül, virgül, dikey çizgi); tırnaklı
 * hücrenin içindeki ayraç ve satır sonu hücrede kalır, çift tırnak tek tırnaktır. BOM atılır.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sample = src.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  const count = (ch: string) => sample.reduce((n, l) => n + (l.split(ch).length - 1), 0);
  const seps = ["\t", ";", "|", ","] as const;
  // Virgül ondalık ayraç da olabilir: öteki ayraçlardan biri satır başına en az bir kez geçiyorsa o seçilir
  const sep = seps.find((ch) => ch !== "," && count(ch) >= sample.length) ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && !cell.trim()) {
      quoted = true;
      cell = "";
    } else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.trim() || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/**
 * CSV baytları → metin: UTF-8 (BOM'lu ya da geçerli) değilse Türk bankalarının eski dışa aktarımı sayılır
 * (Windows-1254).
 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1254").decode(bytes);
  }
}

// ---------------------------------------------------------------- Yinelenen yükleme

/**
 * Satırın parmak izi: aynı dönem ikinci kez yüklenince aynı hareket ikinci kez yazılmaz. Dosyada birebir aynı iki
 * hareket (aynı gün iki eşit POS girişi) sıra numarasıyla ayrılır: ikisi de yazılır, yeniden yüklemede ikisi de atlanır.
 */
export function lineFingerprints(lines: readonly Pick<ParsedLine, "date" | "amount" | "description" | "ref" | "balance">[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [l.date, l.amount.toFixed(2), fold(l.description), l.ref ?? "", l.balance === null ? "" : l.balance.toFixed(2)].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** Ekstrenin kapsadığı dönem (ilk ve son hareket günü); satır yoksa null */
export function periodOf(lines: readonly { date: string }[]): { from: string; to: string } | null {
  if (!lines.length) return null;
  let from = lines[0].date;
  let to = lines[0].date;
  for (const l of lines) {
    if (l.date < from) from = l.date;
    if (l.date > to) to = l.date;
  }
  return { from, to };
}

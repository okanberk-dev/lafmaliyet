import "server-only";

import { decodeCsv, MAX_FILE_BYTES, parseCsv, type Cell, type Grid } from "@/lib/mutabakat/parse";
import { UserError } from "@/server/user-error";

// Ekstre dosyasını tabloya çevirir (docs/MUTABAKAT.md › Dosya). Dosya YALNIZ BELLEKTE okunur: diske, depoya ya da
// veritabanına yazılmaz (KVKK); okunan satırlar ayrıca süzülür ve örtülür (src/lib/mutabakat/parse.ts).

/** Tablonun en çok bu kadar satırı okunur (başlık ve boş satırlar dahil) */
const MAX_ROWS = 12_000;

/** exceljs hücresi → düz değer (formülde sonucu, zengin metinde metni, bağlantıda yazısı) */
function plain(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || v instanceof Date) return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.result !== undefined) return plain(o.result);
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return plain(o.text);
    if (o.error !== undefined) return null;
  }
  return null;
}

async function readXlsx(bytes: ArrayBuffer): Promise<Grid> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    throw new UserError("Excel dosyası okunamadı. Dosyayı Excel'de açıp yeniden .xlsx olarak kaydedin ya da CSV indirin.");
  }
  // En çok dolu satırı olan sayfa (bazı bankalar ilk sayfaya yalnız kapak yazar)
  const sheet = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!sheet || sheet.actualRowCount === 0) throw new UserError("Dosyada dolu sayfa yok");
  const grid: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    if (n > MAX_ROWS) return;
    const values = (row.values as unknown[]).slice(1).map(plain);
    grid[n - 1] = values;
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return grid;
}

/**
 * Yüklenen dosya → tablo. .xlsx (exceljs) ve CSV / TXT / TSV (ayraç ve kodlama kendiliğinden: UTF-8 ya da Windows-1254).
 * Eski Excel biçimi (.xls) okunmaz: bankalar çoğunlukla .xlsx ya da CSV de verir.
 */
export async function readStatementFile(file: unknown): Promise<{ grid: Grid; name: string }> {
  if (!(file instanceof File) || !file.size) throw new UserError("Dosya seçin");
  if (file.size > MAX_FILE_BYTES) throw new UserError(`Dosya en çok ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB olabilir; daha kısa bir dönem seçip yeniden indirin`);
  const name = file.name.slice(0, 120);
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) return { grid: await readXlsx(await file.arrayBuffer()), name };
  if (/\.(csv|txt|tsv)$/.test(lower)) {
    const rows = parseCsv(decodeCsv(new Uint8Array(await file.arrayBuffer())));
    return { grid: rows.slice(0, MAX_ROWS), name };
  }
  if (lower.endsWith(".xls")) throw new UserError("Eski Excel biçimi (.xls) okunamıyor: dosyayı Excel'de açıp .xlsx olarak kaydedin ya da bankadan CSV indirin");
  throw new UserError("Desteklenen dosyalar: .xlsx, .csv, .txt");
}

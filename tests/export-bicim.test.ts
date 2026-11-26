// Dışa aktarılan çalışma kitabının biçimi: kapak, biçimli başlık satırları, sütun genişlikleri, para / yüzde / tarih
// biçimleri, dondurulmuş başlık, otomatik süzgeç, toplam satırları ve yazdırma düzeni. Rakamlar
// tests/export-workbook.test.ts'te (kilitli); burada toplamların o rakamlardan geldiği sınanır.
// Çalıştırma: npx tsx --test tests/export-bicim.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { buildWorkbook, cellWidth, GUIDE_SHEET, HEADER_ARGB, REPORT_TITLE, TOTAL_ARGB, type CariExportRow } from "../src/app/api/export/workbook";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { dateTimeTR } from "../src/lib/format";
import { datasetFromSeed, investmentSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const NOW = new Date("2026-10-20T10:00:00Z");

function dataset(): Dataset {
  const ds = datasetFromSeed(data);
  ds.currentMonth = "2026-10";
  return ds;
}
const cari: CariExportRow[] = [
  { date: "2026-10-20", supplier: "Sütaş", movement: "Faturasız alım (faturası gelecek)", description: "süt", debt: 1250, payment: null, method: null, counted: null, invoice: null, note: null },
  { date: "2026-10-22", supplier: "Sütaş", movement: "Ödeme", description: null, debt: null, payment: 10000, method: "Havale / EFT", counted: null, invoice: null, note: null },
];
const model = createModel(dataset());
const wb = buildWorkbook(model, "2026-09", {
  investments: data.investments.map(investmentSeed),
  findings: data.findings,
  now: NOW,
  cari,
  scope: { label: "Marina", branch: true },
});
const sheet = (name: string) => {
  const ws = wb.getWorksheet(name);
  assert.ok(ws, `sekme yok: ${name}`);
  return ws!;
};
const val = (c: ExcelJS.Cell) => (c.type === ExcelJS.ValueType.Formula ? c.result : c.value);
const fillOf = (c: ExcelJS.Cell) => ((c.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb ?? null);
/** Başlık satırında adı `name` olan sütun */
function colOf(ws: ExcelJS.Worksheet, name: string, row = 1): number {
  for (let c = 1; c <= ws.columnCount; c++) if (ws.getRow(row).getCell(c).value === name) return c;
  assert.fail(`${ws.name}: sütun yok: ${name}`);
}
/** Birinci sütunda (ya da `col`) metni `text` olan son satır */
function lastRowOf(ws: ExcelJS.Worksheet, text: string, col = 1): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((r) => {
    if (r.getCell(col).value === text) found = r;
  });
  assert.ok(found, `${ws.name}: "${text}" satırı yok`);
  return found!;
}

// ---------------------------------------------------------------- Kapak

test("kapak: rapor adı, dönem, kapsam (şube), oluşturulma zamanı ve sayfa listesi", () => {
  const ws = sheet(GUIDE_SHEET);
  assert.equal(wb.worksheets[0].name, GUIDE_SHEET, "ilk sayfa");
  assert.equal(ws.getCell("A1").value, REPORT_TITLE);
  assert.equal(ws.getCell("A1").font?.bold, true);
  assert.ok((ws.getCell("A1").font?.size ?? 0) >= 14, "büyük başlık");
  const valueOf = (key: string) => {
    let v: unknown;
    ws.eachRow((r) => {
      if (r.getCell(1).value === key && v === undefined) v = r.getCell(2).value;
    });
    return String(v ?? "");
  };
  assert.match(valueOf("Dönem"), /^Eylül 2026 · Gelir-Gider sayfası 2026 yılının 12 ayı$/);
  assert.match(valueOf("Kapsam"), /^Marina şubesi: /);
  assert.equal(valueOf("Oluşturulma"), dateTimeTR(NOW));
  assert.match(valueOf("Sayfalar"), new RegExp(`^${wb.worksheets.length - 1} sayfa \\(5 tanesi gri sekmede ham kayıt\\)`));
  // Sayfa listesi başlıklı tablo: her sayfaya bağlantı, sırasıyla
  const head = lastRowOf(ws, "Sayfa");
  assert.equal(head.getCell(2).value, "İçerik");
  assert.equal(head.getCell(1).font?.bold, true);
  const links: string[] = [];
  ws.eachRow((r, n) => {
    const v = r.getCell(1).value as ExcelJS.CellFormulaValue | null;
    if (n > head.number && v && typeof v === "object" && "formula" in v) links.push(String(v.result));
  });
  assert.deepEqual(
    links,
    wb.worksheets.slice(1).map((w) => w.name),
  );
  // Tümü dosyası kapsamı öyle yazar
  const all = buildWorkbook(model, "2026-09", { investments: [], findings: [], now: NOW }).getWorksheet(GUIDE_SHEET)!;
  let scope = "";
  all.eachRow((r) => {
    if (r.getCell(1).value === "Kapsam") scope = String(r.getCell(2).value);
  });
  assert.match(scope, /^Tümü: bütün şubeler/);
});

test("dosya özellikleri: başlık, konu (dönem ve kapsam), oluşturan ve zaman", () => {
  assert.equal(wb.title, `${REPORT_TITLE} · Eylül 2026`);
  assert.equal(wb.subject, "Eylül 2026 · Marina");
  assert.equal(wb.creator, "L'Affogato Panel");
  assert.equal(wb.company, "L'Affogato");
  assert.equal(wb.created.getTime(), NOW.getTime());
  for (const v of [wb.title, wb.subject, wb.keywords, wb.description]) assert.doesNotMatch(String(v), /excel/i);
});

// ---------------------------------------------------------------- Başlık satırı, dondurma, süzgeç

/** İlk tablo başlığı 1. satırda olan sekmeler */
const ROW1_TABLES = [
  "Özet",
  "Gelir-Gider 2026",
  "Sayım Eylül 2026",
  "Ürün Kârlılık",
  "Reçete Kartları",
  "Hammaddeler",
  "Faturalar",
  "Aylık Alımlar",
  "Cari hareketleri",
  "Personel",
  "Sabit Giderler",
  "Ayarlar",
  "Satış Kayıtları",
  "Ay Bilgileri",
  "Gelir-Gider Kayıtları",
  "Sayım Kayıtları",
  "Alım Miktarları",
];

test("her tablonun başlık satırı biçimli: koyu zemin, beyaz kalın yazı, sarılan metin; zemin tablonun dışına taşmaz", () => {
  for (const name of ROW1_TABLES) {
    const ws = sheet(name);
    const row = ws.getRow(1);
    const n = ws.columns.length;
    // Zemin son sütunda biter: satırda tanımlı sütunlardan fazla hücre yok, satırın kendi biçimi yok (hücreler biçimli)
    assert.ok(row.cellCount <= n, `${name}: başlık satırı ${row.cellCount} hücre`);
    assert.equal(row.fill, undefined, `${name}: satırın kendisi boyanmaz`);
    for (let c = 1; c <= n; c++) {
      const cell = row.getCell(c);
      assert.equal(fillOf(cell), HEADER_ARGB, `${name} ${cell.address} zemin`);
      assert.equal(cell.font?.bold, true, `${name} ${cell.address} kalın`);
      assert.equal(cell.font?.color?.argb, "FFFFFFFF", `${name} ${cell.address} beyaz`);
      assert.equal(cell.alignment?.wrapText, true, `${name} ${cell.address} sarılır`);
    }
  }
  // Satış'ın tablosu ayın özetinin altında başlar
  const sa = sheet("Satış Eylül 2026");
  const head = lastRowOf(sa, "POS ürün adı");
  assert.equal(fillOf(head.getCell(1)), HEADER_ARGB);
});

test("başlık her sekmede dondurulur (kapak hariç)", () => {
  for (const ws of wb.worksheets) {
    if (ws.name === GUIDE_SHEET) continue;
    const v = ws.views[0] as { state?: string; ySplit?: number } | undefined;
    assert.equal(v?.state, "frozen", `${ws.name} dondurulmuş`);
    assert.ok((v?.ySplit ?? 0) >= 1, `${ws.name} en az bir satır`);
  }
});

test("liste sekmelerinde otomatik süzgeç başlıktan son veri satırına; toplam satırı süzgecin dışında", () => {
  const ranges = new Map<string, string>();
  for (const ws of wb.worksheets) if (ws.autoFilter) ranges.set(ws.name, JSON.stringify(ws.autoFilter));
  for (const name of ["Ürün Kârlılık", "Reçete Kartları", "Hammaddeler", "Faturalar", "Cari hareketleri", "Personel", "Sabit Giderler", "Satış Eylül 2026", "Tutarlılık Eylül 2026", "Satış Kayıtları", "Ay Bilgileri", "Gelir-Gider Kayıtları", "Sayım Kayıtları", "Alım Miktarları"]) {
    assert.ok(ranges.has(name), `${name}: süzgeç yok`);
  }
  const fa = sheet("Faturalar");
  const af = fa.autoFilter as { from: { row: number; column: number }; to: { row: number; column: number } };
  assert.equal(af.from.row, 1);
  assert.equal(af.to.row, model.ds.invoices.length + 1, "son fatura satırı");
  assert.equal(af.to.column, fa.columns.length, "bütün sütunlar");
  assert.ok(lastRowOf(fa, "TOPLAM").number > af.to.row, "TOPLAM süzgecin altında");
});

// ---------------------------------------------------------------- Biçimler ve genişlikler

test("para, yüzde, adet ve tarih biçimleri: ₺ ve binlik ayraç, yüzde, tarih gg.aa.yyyy", () => {
  const fa = sheet("Faturalar");
  for (const name of ["Mal/hizmet tutarı", "Net (KDV hariç)", "KDV", "Ödenecek (KDV dahil)", "Kalan borç"]) {
    const fmt = fa.getRow(2).getCell(colOf(fa, name)).numFmt;
    assert.match(fmt, /#,##0\.00 "₺"/, `Faturalar ${name}`);
  }
  assert.equal(fa.getRow(2).getCell(colOf(fa, "Tarih")).numFmt, "dd.mm.yyyy");
  const uk = sheet("Ürün Kârlılık");
  assert.match(uk.getRow(2).getCell(colOf(uk, "Kâr marjı %")).numFmt, /%/);
  assert.match(uk.getRow(2).getCell(colOf(uk, "Satış fiyatı (KDV dahil)")).numFmt, /₺/);
  assert.equal(uk.getRow(2).getCell(colOf(uk, "Eylül 2026 satış adedi")).numFmt, "#,##0");
  const pr = sheet("Personel");
  assert.match(pr.getRow(2).getCell(colOf(pr, "Net maaş")).numFmt, /#,##0 "₺"/);
  assert.equal(sheet("Cari hareketleri").getRow(2).getCell(1).numFmt, "dd.mm.yyyy");
  const ay = sheet("Ayarlar");
  assert.match(lastRowOf(ay, "Ambalajın alış KDV'si").getCell(2).numFmt, /%/);
});

test("sütun genişliği içeriğe yeter: hiçbir para, yüzde ya da tarih hücresi '####' olmaz", () => {
  const tooNarrow: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = val(cell);
        if (typeof v !== "number" && !(v instanceof Date)) return;
        const width = ws.getColumn(cell.col).width ?? 10;
        if (cellWidth(cell) + 1 > width) tooNarrow.push(`${ws.name}!${cell.address} (${cellWidth(cell)} > ${width})`);
      }),
    );
  }
  assert.deepEqual(tooNarrow, []);
  // Çok uzun açıklama sütunu sınırsız genişlemez
  for (const ws of wb.worksheets) for (const col of ws.columns) assert.ok((col.width ?? 10) <= 120, `${ws.name} ${col.letter}`);
});

test("cellWidth: binlik ayraç, ondalık, ₺, yüzde ve eksi işaretini sayar", () => {
  const ws = new ExcelJS.Workbook().addWorksheet("x");
  const c = (v: ExcelJS.CellValue, fmt: string) => {
    const cell = ws.getCell("A1");
    cell.value = v;
    cell.numFmt = fmt;
    return cellWidth(cell);
  };
  assert.equal(c(1234567.5, '#,##0.00 "₺";[Red]-#,##0.00 "₺"'), "1.234.567,50 ₺".length);
  assert.equal(c(-1234, '#,##0 "₺";[Red]-#,##0 "₺"'), "-1.234 ₺".length);
  assert.equal(c(0.305, "0.0%"), "30,5%".length);
  assert.equal(c(new Date(Date.UTC(2026, 8, 1)), "dd.mm.yyyy"), 10);
  assert.equal(c("kısa", ""), 4);
  assert.equal(c("x".repeat(60), ""), 0, "uzun açıklama genişlik istemez");
});

// ---------------------------------------------------------------- Toplam satırları

test("toplam satırları biçimli; Faturalar ve Ürün Kârlılık toplamı süzgeçle çalışır (SUBTOTAL) ve satırların toplamıdır", () => {
  const fa = sheet("Faturalar");
  const tot = lastRowOf(fa, "TOPLAM");
  for (const name of ["Mal/hizmet tutarı", "İskonto", "Net (KDV hariç)", "KDV", "Ödenecek (KDV dahil)", "Kalan borç", "Tedarikçiye ödenen KDV"]) {
    const col = colOf(fa, name);
    const cell = tot.getCell(col);
    const f = cell.value as ExcelJS.CellFormulaValue;
    const letter = fa.getColumn(col).letter;
    assert.equal(f.formula, `SUBTOTAL(109,${letter}2:${letter}${model.ds.invoices.length + 1})`, name);
    let rows = 0;
    for (let r = 2; r <= model.ds.invoices.length + 1; r++) rows += Number(val(fa.getRow(r).getCell(col)) ?? 0);
    assert.ok(Math.abs(Number(f.result ?? 0) - rows) < 0.011, `${name}: ${f.result} ≠ ${rows}`);
  }
  assert.equal(fillOf(tot.getCell(1)), TOTAL_ARGB);
  assert.equal(tot.getCell(1).font?.bold, true);
  // Aylık Alımlar'ın SUMIFS'i toplam satırını saymaz
  const al = sheet("Aylık Alımlar");
  assert.match((al.getRow(2).getCell(2).value as ExcelJS.CellFormulaValue).formula, new RegExp(`\\$H\\$${model.ds.invoices.length + 1},`));

  const uk = sheet("Ürün Kârlılık");
  const ut = lastRowOf(uk, "TOPLAM");
  const qty = colOf(uk, "Eylül 2026 satış adedi");
  let sold = 0;
  for (let r = 2; r <= model.products.length + 1; r++) sold += Number(uk.getRow(r).getCell(qty).value ?? 0);
  assert.equal(val(ut.getCell(qty)), sold);
  assert.match((ut.getCell(qty).value as ExcelJS.CellFormulaValue).formula, /^SUBTOTAL\(109,/);

  const ca = sheet("Cari hareketleri");
  const ct = lastRowOf(ca, "TOPLAM");
  assert.equal(val(ct.getCell(colOf(ca, "Borç"))), 1250);
  assert.equal(val(ct.getCell(colOf(ca, "Ödeme"))), 10000);

  // Var olan toplamlar da aynı görünümde
  for (const [name, text] of [
    ["Personel", "TOPLAM"],
    ["Sabit Giderler", "TOPLAM"],
    ["Aylık Alımlar", "TOPLAM"],
    ["Satış Eylül 2026", "TOPLAM"],
  ] as const) {
    assert.equal(fillOf(lastRowOf(sheet(name), text).getCell(1)), TOTAL_ARGB, `${name} ${text}`);
  }
  // Gelir-gider'in toplam satırları (KÂR / ZARAR …)
  const gg = sheet("Gelir-Gider 2026");
  let profit: ExcelJS.Row | undefined;
  gg.eachRow((r) => {
    if (r.getCell(2).value === "KÂR / ZARAR") profit = r;
  });
  assert.equal(fillOf(profit!.getCell(2)), TOTAL_ARGB);
});

// ---------------------------------------------------------------- Yazdırma ve dosya

test("yazdırma: A4, sayfaya sığar, üst bilgide rapor / sayfa / dönem, alt bilgide sayfa numarası, başlık her sayfada", () => {
  for (const ws of wb.worksheets) {
    assert.equal(ws.pageSetup.paperSize, 9, `${ws.name} A4`);
    assert.equal(ws.pageSetup.fitToPage, true, `${ws.name} sığdır`);
    assert.match(ws.headerFooter.oddFooter ?? "", /Sayfa &P \/ &N/, `${ws.name} sayfa no`);
    if (ws.name === GUIDE_SHEET) continue;
    assert.match(ws.headerFooter.oddHeader ?? "", /L'Affogato/);
    assert.ok((ws.headerFooter.oddHeader ?? "").includes(ws.name), `${ws.name} üst bilgide adı`);
    assert.match(ws.headerFooter.oddHeader ?? "", /Eylül 2026 · Marina/);
  }
  assert.equal(sheet("Faturalar").pageSetup.printTitlesRow, "1:1");
  const sa = sheet("Satış Eylül 2026");
  const head = lastRowOf(sa, "POS ürün adı").number;
  assert.equal(sa.pageSetup.printTitlesRow, `${head}:${head}`);
});

test("yazılan dosya geri okununca biçim korunur: başlık zemini, süzgeç, dondurma, alt bilgi, toplam formülü", async () => {
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  const fa = back.getWorksheet("Faturalar")!;
  assert.equal(fillOf(fa.getCell("A1")), HEADER_ARGB);
  assert.ok(fa.autoFilter);
  assert.equal((fa.views[0] as { state?: string }).state, "frozen");
  assert.match(fa.headerFooter.oddFooter ?? "", /Sayfa &P/);
  const tot = lastRowOf(fa, "TOPLAM");
  assert.match((tot.getCell(6).value as ExcelJS.CellFormulaValue).formula, /^SUBTOTAL\(109,F2:F\d+\)$/);
  assert.equal(back.title, wb.title);
});

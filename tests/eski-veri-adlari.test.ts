// İlk kurulumda eski hesap tablosundan aktarılan verinin adları ve eski tablonun kalıntıları: kullanıcı "Excel" görmez,
// rakamlar aynı kalır (src/lib/import-labels.ts, Ayarlar › Oranlar'daki sayım KDV'leri, dışa aktarım).
// Çalıştırma: npx tsx --test tests/eski-veri-adlari.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { buildWorkbook } from "../src/app/api/export/workbook";
import { vatForGroup } from "../src/app/panel/hammaddeler/form-helpers";
import { NAV_FOOTER, NAV_GROUPS, NAV_TREE } from "../src/components/panel/nav";
import { createModel } from "../src/lib/calc/engine";
import { stockVatSummary } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS, groupVatRate, PACKAGING_COUNT_GROUP, settingsFromRows } from "../src/lib/constants";
import { activityActionLabel, IMPORT_ACTIVITY_LABEL, IMPORT_AUTHOR_LABEL, IMPORTED_LABEL, importedPriceRow, INVOICE_SOURCE_LABEL, INVOICE_SOURCE_PHRASE, invoiceSourceLabel } from "../src/lib/import-labels";
import { excelToDataset, investmentSeed, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const close = (a: number, b: number, label: string, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} ≠ ${b}`);

function dataset(): Dataset {
  const ds = excelToDataset(data);
  ds.currentMonth = "2026-10";
  return ds;
}

// ---------------------------------------------------------------- Adlar (veri değişmez)

test("faturanın kaynağı: 'excel' kaydı 'İçe aktarılmış (eski)' görünür; şemanın değerleri aynı", () => {
  assert.deepEqual(Object.keys(INVOICE_SOURCE_LABEL).sort(), ["excel", "manual", "parasut"]);
  assert.equal(INVOICE_SOURCE_LABEL.excel, "İçe aktarılmış (eski)");
  assert.equal(invoiceSourceLabel("excel"), IMPORTED_LABEL);
  assert.equal(invoiceSourceLabel("manual"), "Elle");
  assert.equal(invoiceSourceLabel("parasut"), "Paraşüt");
  assert.equal(invoiceSourceLabel(null), null);
  assert.equal(INVOICE_SOURCE_PHRASE.excel, "içe aktarılmış (eski)");
  for (const v of [...Object.values(INVOICE_SOURCE_LABEL), ...Object.values(INVOICE_SOURCE_PHRASE)]) assert.doesNotMatch(v, /excel/i);
});

test("fiyat geçmişinin ilk aktarım satırı ve işlem geçmişi eski adla kayıtlı olsa da yeni adla görünür", () => {
  const old = { id: 1, changedBy: "Excel", note: "Excel'den aktarıldı", packagePrice: 100 };
  const shown = importedPriceRow(old);
  assert.deepEqual(shown, { id: 1, changedBy: IMPORT_AUTHOR_LABEL, note: IMPORTED_LABEL, packagePrice: 100 });
  assert.equal(old.changedBy, "Excel", "kayıt değişmez");
  // Başka satır olduğu gibi (aynı nesne)
  const other = { changedBy: "Ayşe", note: "Paraşüt SUT-12" };
  assert.equal(importedPriceRow(other), other);
  assert.equal(activityActionLabel("Excel'den aktarım"), IMPORT_ACTIVITY_LABEL);
  assert.equal(activityActionLabel("Ayarlar"), "Ayarlar");
});

// ---------------------------------------------------------------- Sayım grubunun alış KDV'si (Ayarlar)

test("sayım gruplarının alış KDV'si ayardan; varsayılan eski sabitlerle aynı (ambalaj %20, gıda %1)", () => {
  assert.equal(DEFAULT_SETTINGS.alisKdvAmbalaj, 0.2);
  assert.equal(DEFAULT_SETTINGS.alisKdvGida, 0.01);
  assert.equal(groupVatRate(DEFAULT_SETTINGS, PACKAGING_COUNT_GROUP), 0.2);
  assert.equal(groupVatRate(DEFAULT_SETTINGS, "KAHVE & ÇAY"), 0.01);
  assert.equal(groupVatRate(DEFAULT_SETTINGS, null), 0.01);
  assert.equal(vatForGroup(PACKAGING_COUNT_GROUP), 0.2);
  // Satırı olmayan eski veritabanı varsayılanı okur; bozuk değer varsayılana döner
  const s = settingsFromRows([{ key: "alisKdvAmbalaj", value: 0.18 }, { key: "alisKdvGida", value: "bozuk" }]);
  assert.equal(s.alisKdvAmbalaj, 0.18);
  assert.equal(s.alisKdvGida, 0.01);
  assert.equal(settingsFromRows([{ key: "alisKdvGida", value: 2 }]).alisKdvGida, 0.01, "1'den büyük oran olmaz");
  assert.equal(settingsFromRows([]).alisKdvAmbalaj, 0.2);
});

test("sayımın KDV dahil değeri varsayılan ayarla eskisiyle aynı: listede olmayan kalem × 1,01, malzeme kendi KDV'siyle", () => {
  const ds = dataset();
  const esp = ds.ingredients.find((i) => i.name === "Espresso çekirdeği")!;
  ds.stockCounts.push({ month: "2026-09", ingredientId: esp.id, qty: 4, factor: 1000 });
  ds.stockExtras.push({ id: 1, month: "2026-09", name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 12.5 });
  const sheet = createModel(ds).stockSheet("2026-09");
  const groupsVat = sheet.groups.reduce((a, g) => a + g.totalVatIncl, 0);
  close(sheet.totalVatIncl, groupsVat + 37.5 * 1.01, "KDV dahil toplam (eski formül)");
  const line = sheet.groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === esp.id)!;
  close(line.amountVatIncl, line.amount * (1 + esp.vatRate), "malzeme kendi Alış KDV'siyle");
  const v = stockVatSummary(sheet, DEFAULT_SETTINGS);
  close(v.extras.totalVatIncl, 37.5 * 1.01, "ek kalem");
  close(v.totalVatIncl, sheet.totalVatIncl, "özet aynı toplam");
});

// ---------------------------------------------------------------- Dışa aktarım: Excel adı yok, kaynak yeni adla

/** Çalışma kitabındaki bütün metin: hücre değerleri, formül sonuçları, bağlantı adları ve notlar */
function workbookTexts(wb: ExcelJS.Workbook): string[] {
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    out.push(ws.name);
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (c) => {
        const v = c.value as unknown;
        if (typeof v === "string") out.push(v);
        else if (v && typeof v === "object" && "result" in v && typeof (v as { result: unknown }).result === "string") out.push((v as { result: string }).result);
        const note = c.note as unknown;
        if (typeof note === "string") out.push(note);
        else if (note && typeof note === "object" && "texts" in note) out.push(((note as { texts: { text: string }[] }).texts ?? []).map((t) => t.text).join(""));
      }),
    );
  }
  return out;
}

test("dışa aktarım: hiçbir sekme, hücre ya da notta 'Excel' geçmez; içe aktarılmış fatura 'İçe aktarılmış (eski)'", () => {
  const ds = dataset();
  ds.invoices = ds.invoices.map((i, n) => ({ ...i, source: n === 0 ? ("excel" as const) : i.source }));
  // Açık günü eksik ay: eskiden standart sabit giderle ikinci bir net kâr satırı çıkardı
  ds.months = ds.months.map((m) => (m.month === "2026-09" ? { ...m, openDays: 24 } : m));
  const model = createModel(ds);
  const wb = buildWorkbook(model, "2026-09", { investments: data.investments.map(investmentSeed), findings: data.findings, now: new Date("2026-10-20T10:00:00Z") });
  const hits = workbookTexts(wb).filter((t) => /excel/i.test(t));
  assert.deepEqual(hits, []);
  // Faturalar › Kaynak
  const fa = wb.getWorksheet("Faturalar")!;
  const head = fa.getRow(1);
  let src = 0;
  head.eachCell((c, n) => {
    if (c.value === "Kaynak") src = n;
  });
  assert.ok(src > 0, "Kaynak sütunu");
  assert.equal(fa.getRow(2).getCell(src).value, "İçe aktarılmış (eski)");
  // Özet: tek net kâr satırı (reçeteye göre); rakam Genel bakış'la aynı
  const oz = wb.getWorksheet("Özet")!;
  const netRows: number[] = [];
  oz.eachRow((r) => {
    const k = r.getCell(1).value;
    if (typeof k === "string" && /net kâr \/ zarar/i.test(k) && !/tahmini/i.test(k)) netRows.push(Number(r.getCell(2).value));
  });
  assert.equal(netRows.length, 1, "standart sabit giderli ikinci kâr satırı yok");
  const t = model.monthSales("2026-09");
  assert.ok(t.lines.length > 0);
});

// ---------------------------------------------------------------- Menü ve ⌘K

test("menü öğelerinde eski tablonun sayfa adı yok", () => {
  const items = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER, ...NAV_TREE.flatMap((n) => [n, ...(n.children ?? [])])];
  assert.ok(items.length > 20);
  for (const i of items) assert.equal(Object.hasOwn(i, "excel"), false, `${i.label}: excel alanı`);
});

// ---------------------------------------------------------------- Kaynakta kullanıcıya görünen metin

/** Yorumları atar (satır ve blok; JSX içindeki {/* … *\/} dahil) */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

test("ekran, e-posta, asistan ve dışa aktarım kodunda 'Excel' metni kalmadı (ExcelJS kütüphanesi ve şema değeri hariç)", () => {
  const files = ["src/app", "src/components", "src/lib", "src/server"]
    .flatMap((d) => walk(join(root, d)))
    // İlk kurulumun veri aktarımı (seed) eski tablonun kendisini okur; bilgi tabanı belgelerden üretilir (ayrı test)
    .filter((f) => !f.includes(join("src", "server", "db", "seed")) && !f.endsWith(join("assistant", "knowledge-data.ts")));
  assert.ok(files.length > 300, "tarama dosya bulamadı");
  const bad: string[] = [];
  for (const f of files) {
    const code = stripComments(readFileSync(f, "utf8"));
    for (const m of code.matchAll(/Excel(?!JS)/g)) {
      const line = code.slice(code.lastIndexOf("\n", m.index) + 1, code.indexOf("\n", m.index));
      // Eski kayıtların kayıtlı değerleri (yalnız eşleştirme için; ekrana yeni adla çıkar)
      if (f.endsWith(join("lib", "import-labels.ts"))) continue;
      bad.push(`${f.slice(root.length + 1)}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("asistanın bilgi tabanında eski tablonun adı yok", () => {
  const kb = readFileSync(join(root, "src/lib/assistant/knowledge-data.ts"), "utf8");
  const hits = [...kb.matchAll(/[^"]{0,60}Excel[^"]{0,60}/g)].map((m) => m[0]);
  assert.deepEqual(hits, []);
});

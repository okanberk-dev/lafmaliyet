// Stok değerleme: dönemsel ilk giren ilk çıkar (FIFO). Saf çekirdek (src/lib/calc/fifo.ts), motor (engine.ts
// stockSheet / closingStock / pnlMonth), sayım formunun canlı toplamı (src/app/panel/sayim/logic.ts lineAmount) ve
// personele fiyat gitmemesi. Belge: docs/STOK-DEGERLEME.md
// Çalıştırma: npx tsx --test tests/stok-fifo.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { coverageText, layerText, lineAmount, liveTotals, type CountLineValue } from "../src/app/panel/sayim/logic";
import { countFactor, createModel, type Model } from "../src/lib/calc/engine";
import { buildLots, closingLayers, layersValue, lotPool, valuationFor, type PurchaseLot } from "../src/lib/calc/fifo";
import { stockVatSummary } from "../src/lib/calc/insights";
import type { Dataset, Ingredient } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };

function close(actual: number | null | undefined, expected: number, label: string, tol = 1e-9) {
  assert.ok(actual !== null && actual !== undefined, `${label}: değer yok`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol * Math.max(1, Math.abs(expected)), `${label}: beklenen ${expected}, bulunan ${actual} (fark ${diff})`);
}

// KG ile sayılan bir malzeme (çarpan 1000) ve su
const kgIng = base.ingredients.find((i) => i.countUnit === "KG" && i.active && i.priceSource !== "water")!;
const water = base.ingredients.find((i) => i.priceSource === "water");
assert.ok(kgIng, "KG ile sayılan malzeme yok");
const ID = kgIng.id;

/** Malzemenin bugünkü fiyatı ₺/KG (ay sonu fiyatı = fallback, geçmişi yok) */
function withPrice(ing: Ingredient, perKg: number): Ingredient {
  return { ...ing, packagePrice: perKg, packageSize: 1000 };
}
/** Fatura partisi: KG ve ₺/KG ile (motor gram ve ₺ toplam bekler) */
const lot = (date: string, kg: number, perKg: number, invoiceId = Number(date.replaceAll("-", "")), ingredientId = ID): PurchaseLot => ({
  ingredientId,
  invoiceId,
  date,
  qty: kg * 1000,
  cost: kg * perKg,
});
const count = (month: string, kg: number, ingredientId = ID) => ({ month, ingredientId, qty: kg, factor: 1000 });

function model(opts: {
  lots?: PurchaseLot[];
  counts?: { month: string; ingredientId: number; qty: number; factor: number }[];
  perKg?: number;
  start?: string | null;
  invoices?: Dataset["invoices"];
}): Model {
  return createModel({
    ...base,
    settings: { ...base.settings, stokFifoBaslangic: opts.start === undefined ? "2026-10" : opts.start },
    ingredients: base.ingredients.map((i) => (i.id === ID ? withPrice(i, opts.perKg ?? 380) : i)),
    stockCounts: opts.counts ?? [],
    stockExtras: [],
    purchaseLots: opts.lots ?? [],
    invoices: opts.invoices ?? base.invoices,
  });
}
const lineOf = (m: Model, month: string, id = ID) => m.stockSheet(month).groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === id)!;

test("1: tek parti sayımı karşılıyorsa tutar eski yöntemle aynı (fiyat aynıysa)", () => {
  const fifo = model({ lots: [lot("2026-10-10", 10, 400)], counts: [count("2026-10", 5)], perKg: 400 });
  const old = model({ lots: [lot("2026-10-10", 10, 400)], counts: [count("2026-10", 5)], perKg: 400, start: null });
  const l = lineOf(fifo, "2026-10");
  assert.equal(l.valuation, "fifo");
  assert.equal(lineOf(old, "2026-10").valuation, "son-fiyat");
  close(l.amount, 2000, "FIFO");
  close(lineOf(old, "2026-10").amount, 2000, "eski");
  close(l.unitPrice, 400, "birim fiyat = tutar ÷ miktar");
  assert.equal(l.uncoveredQty, 0);
});

test("2: iki partiye yayılan sayım: en yeniden geriye, 6 × 400 + 4 × 350", () => {
  const m = model({ lots: [lot("2026-10-03", 8, 350), lot("2026-10-20", 6, 400)], counts: [count("2026-10", 10)] });
  const l = lineOf(m, "2026-10");
  close(l.amount, 6 * 400 + 4 * 350, "tutar");
  assert.deepEqual(
    l.layers.map((x) => [x.date, x.qty / 1000, Math.round(x.unitCost * 1000)]),
    [
      ["2026-10-20", 6, 400],
      ["2026-10-03", 4, 350],
    ],
  );
  close(m.stockSheet("2026-10").fifoCovered, 3800, "faturalardan gelen");
});

test("3: parti yetmezse kalan ay sonu fiyatıyla (fallback)", () => {
  const m = model({ lots: [lot("2026-10-12", 3, 400)], counts: [count("2026-10", 5)], perKg: 380 });
  const l = lineOf(m, "2026-10");
  close(l.amount, 3 * 400 + 2 * 380, "tutar");
  close(l.uncoveredQty, 2000, "karşılanmayan (gr)");
  assert.equal(l.layers.at(-1)!.fallback, true);
  close(m.stockSheet("2026-10").fifoCovered, 1200, "faturalardan gelen");
});

test("4: geçen ayın katmanları taşınır, tükenmiş parti (250) yeniden sayılmaz", () => {
  const m = model({
    lots: [lot("2026-09-02", 10, 250), lot("2026-09-20", 5, 300), lot("2026-10-15", 3, 400)],
    counts: [count("2026-09", 5), count("2026-10", 9)],
    perKg: 450,
  });
  // Eylül FIFO başlangıcından önce: tutarı ay sonu fiyatıyla, katmanları taşınmak için yine hesaplanır
  assert.equal(lineOf(m, "2026-09").valuation, "son-fiyat");
  const sept = m.fifoLayers("2026-09", ID)!;
  assert.deepEqual(
    sept.layers.map((x) => [x.qty / 1000, Math.round(x.unitCost * 1000)]),
    [[5, 300]],
  );
  const l = lineOf(m, "2026-10");
  close(l.amount, 3 * 400 + 5 * 300 + 1 * 450, "Ekim: 3@400 + 5@300 + 1 ay sonu fiyatı");
  assert.ok(!l.layers.some((x) => Math.round(x.unitCost * 1000) === 250));
});

test("5: geçen ay sayılmadıysa son 12 ayın partileri (daha eskisi değil)", () => {
  const lots = [lot("2025-09-01", 100, 100), lot("2026-09-02", 10, 250), lot("2026-09-20", 5, 300), lot("2026-10-15", 3, 400)];
  const m = model({ lots, counts: [count("2026-10", 20)], perKg: 450 });
  const l = lineOf(m, "2026-10");
  // 3@400 + 5@300 + 10@250 + 2 ay sonu fiyatı; Eylül 2025 penceredeki 12 ayın dışında
  close(l.amount, 1200 + 1500 + 2500 + 2 * 450, "tutar");
  assert.ok(!l.layers.some((x) => x.date === "2025-09-01"));
  // 9 KG: 3@400 + 5@300 + 1@250
  close(lineOf(model({ lots, counts: [count("2026-10", 9)] }), "2026-10").amount, 1200 + 1500 + 250, "9 KG");
});

test("6: ayın 31'inde tarihli fatura dahil, 1'inde tarihli değil; eşitleme zamanı önemsiz", () => {
  const m = createModel({
    ...base,
    settings: { ...base.settings, stokFifoBaslangic: "2026-10" },
    ingredients: base.ingredients.map((i) => (i.id === ID ? withPrice(i, 380) : i)),
    stockCounts: [count("2026-10", 2)],
    stockExtras: [],
    purchaseLots: [lot("2026-10-01", 5, 300), lot("2026-10-31", 1, 500), lot("2026-11-01", 5, 900)],
    // Ekim faturası Kasım'da eşitlenip fiyatı 900'e çekse de Ekim'in partileri değişmez (fallback'e de gerek yok)
    ingredientPrices: [{ ingredientId: ID, packagePrice: 900, packageSize: 1000, changedAt: "2026-11-02T09:00:00.000Z" }],
  });
  close(lineOf(m, "2026-10").amount, 500 + 300, "1@500 (31 Eki) + 1@300");
});

test("7: aynı faturadaki ücretli ve bedava satır birleşir, iade netleşir", () => {
  const lots = buildLots([
    { ingredientId: 1, invoiceId: 10, date: "2026-10-05", quantity: 10, factor: 1000, netTotal: 4000 },
    { ingredientId: 1, invoiceId: 10, date: "2026-10-05", quantity: 2, factor: 1000, netTotal: 0 },
    { ingredientId: 1, invoiceId: 11, date: "2026-10-06", quantity: 5, factor: 1000, netTotal: 2000 },
    { ingredientId: 1, invoiceId: 11, date: "2026-10-06", quantity: -1, factor: 1000, netTotal: -400 },
    // Yalnız iade faturası: miktar eksi, parti olmaz
    { ingredientId: 1, invoiceId: 12, date: "2026-10-07", quantity: -3, factor: 1000, netTotal: -1200 },
  ]);
  assert.equal(lots.length, 2);
  const a = lots.find((l) => l.invoiceId === 10)!;
  close(a.qty, 12000, "bedava satır miktara girer");
  close(a.cost / a.qty, 4000 / 12000, "birim maliyet düşer");
  const b = lots.find((l) => l.invoiceId === 11)!;
  close(b.qty, 4000, "iade netleşir");
  close(b.cost, 1600, "iade tutarı netleşir");
});

test("8: onay bekleyen / reddedilen fiyat, fiyatı güncellenmeyen bağlantı ve kafe dışı fatura parti olmaz", () => {
  const row = { ingredientId: 1, date: "2026-10-05", quantity: 1, factor: 1000, netTotal: 400 };
  const lots = buildLots([
    { ...row, invoiceId: 1 },
    { ...row, invoiceId: 2, held: true },
    { ...row, invoiceId: 3, updatePrice: false },
    { ...row, invoiceId: 4, category: "Karaoke box" },
    { ...row, invoiceId: 5, category: "Hammadde & İçecek" },
  ]);
  assert.deepEqual(lots.map((l) => l.invoiceId).sort(), [1, 5]);
});

test("9: su ve buz eski yöntemle (faturası olsa bile)", { skip: !water }, () => {
  const w = water!;
  const m = model({ lots: [lot("2026-10-10", 10, 400, 1, w.id)], counts: [{ month: "2026-10", ingredientId: w.id, qty: 5, factor: countFactor(w.countUnit) }] });
  assert.equal(m.fifoLayers("2026-10", w.id), null);
  const l = m.stockSheet("2026-10").groups.flatMap((g) => g.lines).find((x) => x.ingredient.id === w.id);
  if (l) assert.equal(l.valuation, "son-fiyat");
});

test("10: başlangıçtan önceki aylar eski değerle; Excel verisinde (parti yok) golden SMM değişmez", () => {
  const m = model({ lots: [lot("2026-09-10", 10, 250)], counts: [count("2026-09", 4)], perKg: 380 });
  const sept = lineOf(m, "2026-09");
  assert.equal(sept.valuation, "son-fiyat");
  close(sept.amount, 4 * 380, "Eylül ay sonu fiyatıyla");
  assert.equal(m.stockSheet("2026-09").valuation, "son-fiyat");
  assert.equal(m.stockSheet("2026-10").valuation, "fifo");
  assert.equal(valuationFor("2026-09", "2026-10"), "son-fiyat");
  assert.equal(valuationFor("2026-10", "2026-10"), "fifo");
  assert.equal(valuationFor("2026-12", null), "son-fiyat");
  // Varsayılan ayarla (FIFO Ekim'den) Excel verisi: parti olmadığı için kâr-zarar golden'la aynı
  const excel = createModel({ ...base, settings: { ...base.settings, kdvHizmet: base.settings.kdv } });
  assert.equal(base.settings.stokFifoBaslangic, "2026-10");
  for (const month of Object.keys(golden.pnl)) close(excel.pnlMonth(month).cogs, golden.pnl[month].cogs, `${month} SMM`, 1e-6);
});

test("11: SMM = açılış + alış − FIFO kapanış; sonraki ayın açılışı bu kapanış", () => {
  const m = model({
    lots: [lot("2026-10-03", 8, 350), lot("2026-10-20", 6, 400), lot("2026-11-05", 4, 420)],
    counts: [count("2026-09", 0), count("2026-10", 10), count("2026-11", 7)],
  });
  const oct = m.pnlMonth("2026-10");
  const closingOct = m.stockSheet("2026-10").total;
  close(closingOct, 3800, "Ekim kapanışı FIFO");
  close(m.closingStock("2026-10").value, closingOct, "closingStock");
  const cells = oct.cells;
  close(oct.cogs, (cells.get("stock:opening")!.value as number) + (cells.get("stock:purchased")!.value as number) - closingOct, "SMM");
  const nov = m.pnlMonth("2026-11");
  close(nov.cells.get("stock:opening")!.value as number, closingOct, "Kasım açılışı = Ekim kapanışı");
  // Kasım: 4@420 + Ekim'den taşınan 6@400'den 3 = 1680 + 1200
  close(m.stockSheet("2026-11").total, 4 * 420 + 3 * 400, "Kasım kapanışı");
});

/** sayim/page.tsx ile aynı eşleme (yönetici) */
function formGroups(m: Model, month: string) {
  const sheet = m.stockSheet(month);
  const vat = stockVatSummary(sheet);
  return sheet.groups.map((g, gi) => ({
    name: g.name,
    excelRate: vat.groups[gi].excelRate,
    lines: g.lines.map(
      (l): CountLineValue => ({
        id: l.ingredient.id,
        qty: l.qty,
        unitPrice: l.unitPrice,
        unitPriceNow: m.unitCostAtMonthEnd(l.ingredient.id, month) * countFactor(l.ingredient.countUnit),
        vatRate: l.ingredient.vatRate,
        archived: l.archived,
        amount: l.amount,
        pool: l.pool,
        fallbackUnit: l.fallbackUnit,
        factor: l.factor,
        factorNow: countFactor(l.ingredient.countUnit),
      }),
    ),
  }));
}

test("12: değişiklik yokken canlı toplam = stockSheet; değişen miktar eski katmanlara taşar, kayıttan sonra aynı", () => {
  const lots = [lot("2026-09-20", 5, 300), lot("2026-10-03", 8, 350), lot("2026-10-20", 6, 400)];
  const counts = [count("2026-09", 5), count("2026-10", 10)];
  const m = model({ lots, counts, perKg: 450 });
  const sheet = m.stockSheet("2026-10");
  const groups = formGroups(m, "2026-10");
  const live = liveTotals(groups, (l) => l.qty, []);
  close(live.total, sheet.total, "değişiklik yok");
  close(live.totalVat, sheet.totalVatIncl, "KDV dahil");
  // 10 → 17 KG: 6@400 + 8@350 + Eylül'den 3@300
  const line = groups.flatMap((g) => g.lines).find((l) => l.id === ID)!;
  close(lineAmount(line, 17), 6 * 400 + 8 * 350 + 3 * 300, "17 KG");
  // 21 KG: havuz 19 KG, 2 KG ay sonu fiyatıyla
  close(lineAmount(line, 21), 6 * 400 + 8 * 350 + 5 * 300 + 2 * 450, "21 KG");
  const live17 = liveTotals(groups, (l) => (l.id === ID ? 17 : l.qty), []);
  const saved = model({ lots, counts: [count("2026-09", 5), count("2026-10", 17)], perKg: 450 });
  close(live17.total, saved.stockSheet("2026-10").total, "kaydedilince sunucu aynı tutarı hesaplar");
  // İpucu metni
  const tip = layerText(closingLayers(21000, line.pool!, 0.45).layers, 1000, "KG");
  assert.match(tip, /^6 KG · 20 Eki faturası 400,00\s₺\/KG \+ 8 KG · 3 Eki faturası 350,00\s₺\/KG \+ 5 KG · 20 Eyl faturası 300,00\s₺\/KG · 2 KG faturası bulunamadı: ay sonu fiyatıyla/);
  assert.equal(coverageText(0.86), "%86'sı");
  assert.equal(coverageText(0.14), "%14'ü");
  assert.equal(coverageText(1), "%100'ü");
  assert.equal(coverageText(0.4), "%40'ı");
  close(layersValue(lotPool([lot("2026-10-01", 1, 100)])), 100, "lotPool");
});

test("13: personele katman, havuz, tutar ve fiyat gitmez (sayım sayfası eşlemesi)", () => {
  const page = readFileSync(join(root, "src/app/panel/sayim/page.tsx"), "utf8");
  for (const field of ["amount: isAdmin ? l.amount : 0", "pool: isAdmin ? l.pool : []", "fallbackUnit: isAdmin ? l.fallbackUnit : 0", "unitPrice: isAdmin ? l.unitPrice : 0"]) {
    assert.ok(page.includes(field), `sayim/page.tsx: ${field}`);
  }
  // Değerleme kartı yalnız yöneticiye; katmanlar (layers) forma hiç gönderilmez (form havuzdan kendisi hesaplar)
  assert.ok(page.includes('valuation={isAdmin ? {'), "valuation yalnız yöneticiye");
  assert.ok(!/layers:\s*l\.layers/.test(page), "layers forma gitmez");
});

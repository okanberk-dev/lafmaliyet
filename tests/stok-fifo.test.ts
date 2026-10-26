// Stok değerleme: dönemsel ilk giren ilk çıkar (FIFO). Saf çekirdek (src/lib/calc/fifo.ts), motor (engine.ts
// stockSheet / closingStock / pnlMonth), sayım formunun canlı toplamı (src/app/panel/sayim/logic.ts lineAmount) ve
// personele fiyat gitmemesi. Belge: docs/STOK-DEGERLEME.md
// Çalıştırma: npx tsx --test tests/stok-fifo.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { coverageSplit, coverageText, layerText, lineAmount, liveTotals, type CountLineValue } from "../src/app/panel/sayim/logic";
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
  // İki ay da FIFO (başlangıç Eylül): Eylül'ün katmanları Ekim'in havuzuna taşınır
  const m = model({
    lots: [lot("2026-09-02", 10, 250), lot("2026-09-20", 5, 300), lot("2026-10-15", 3, 400)],
    counts: [count("2026-09", 5), count("2026-10", 9)],
    perKg: 450,
    start: "2026-09",
  });
  assert.equal(lineOf(m, "2026-09").valuation, "fifo");
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
    // Daha eski partisi olmayan iade faturası: düşecek parti yok, kendisi de parti olmaz
    { ingredientId: 1, invoiceId: 12, date: "2026-10-01", quantity: -3, factor: 1000, netTotal: -1200 },
  ]);
  assert.equal(lots.length, 2);
  const a = lots.find((l) => l.invoiceId === 10)!;
  close(a.qty, 12000, "bedava satır miktara girer");
  close(a.cost / a.qty, 4000 / 12000, "birim maliyet düşer");
  const b = lots.find((l) => l.invoiceId === 11)!;
  close(b.qty, 4000, "iade netleşir");
  close(b.cost, 1600, "iade tutarı netleşir");
});

test("7b: ayrı iade faturası tarihinde ya da öncesinde alınmış en yeni partiden düşer, kendi birim maliyetiyle", () => {
  const lots = buildLots([
    { ingredientId: 1, invoiceId: 20, date: "2026-10-05", quantity: 10, factor: 1000, netTotal: 4000 },
    { ingredientId: 1, invoiceId: 21, date: "2026-10-25", quantity: 5, factor: 1000, netTotal: 2500 },
    // 27 Eki: 25 Eki faturasının tamamı ve 1 KG fazlası iade (fazlası 5 Eki partisinden, 400'den)
    { ingredientId: 1, invoiceId: 22, date: "2026-10-27", quantity: -6, factor: 1000, netTotal: -2900 },
    // 30 Eki'de alınan parti, 27 Eki iadesinden etkilenmez; başka malzemenin iadesi de
    { ingredientId: 1, invoiceId: 23, date: "2026-10-30", quantity: 2, factor: 1000, netTotal: 900 },
    { ingredientId: 2, invoiceId: 24, date: "2026-10-28", quantity: -9, factor: 1000, netTotal: -9 },
  ]);
  assert.deepEqual(
    lots.map((l) => [l.invoiceId, l.qty / 1000, Math.round(l.cost)]).sort((x, y) => x[0] - y[0]),
    [
      [20, 9, 3600],
      [23, 2, 900],
    ],
  );
  // Ekim sayımı 8 KG: 2@450 (30 Eki) + 6@400; iade edilen 25 Eki partisi (500) havuzda yok
  const m = model({ lots: lots.map((l) => ({ ...l, ingredientId: ID, qty: l.qty, cost: l.cost })), counts: [count("2026-10", 8)] });
  close(lineOf(m, "2026-10").amount, 2 * 450 + 6 * 400, "iade edilen parti sayılmaz");
});

test("8: onay bekleyen / reddedilen fiyat ve kafe dışı fatura parti olmaz", () => {
  // "Fiyatı güncelle" kapalı bağlantının faturası gerçek alıştır: süzgeç yükleyicide değil, parti olur
  const row = { ingredientId: 1, date: "2026-10-05", quantity: 1, factor: 1000, netTotal: 400 };
  const lots = buildLots([
    { ...row, invoiceId: 1 },
    { ...row, invoiceId: 2, held: true },
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
  const m = model({ lots, counts, perKg: 450, start: "2026-09" });
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
  const saved = model({ lots, counts: [count("2026-09", 5), count("2026-10", 17)], perKg: 450, start: "2026-09" });
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

test("14: boş bırakılan ay atlanır: havuz son sayımın katmanlarından devam eder, tükenmiş eski parti dirilmez", () => {
  const lots = [lot("2026-07-10", 100, 100), lot("2026-09-12", 2, 300), lot("2026-10-15", 3, 400)];
  // Ağustos 0 sayıldı, Eylül boş (satır yok), Ekim 9 KG: 3@400 + Eylül'ün 2@300 + 4 ay sonu fiyatı (450)
  const m = model({ lots, counts: [count("2026-08", 0), count("2026-10", 9)], perKg: 450 });
  const l = lineOf(m, "2026-10");
  close(l.amount, 3 * 400 + 2 * 300 + 4 * 450, "Temmuz partisi (100) Ağustos'ta tükendi");
  assert.ok(!l.layers.some((x) => x.date === "2026-07-10"));
  // Eylül'e sonradan 0 yazılsa da aynı (Eylül'ün partisi Eylül'de tükenir)
  const zero = model({ lots, counts: [count("2026-08", 0), count("2026-09", 0), count("2026-10", 9)], perKg: 450 });
  close(lineOf(zero, "2026-10").amount, 3 * 400 + 6 * 450, "Eylül 0 sayıldıysa yalnız Ekim partisi");
  // 12 ayda hiç sayım yoksa son 12 ayın partileri
  const none = model({ lots, counts: [count("2026-10", 9)], perKg: 450 });
  close(lineOf(none, "2026-10").amount, 3 * 400 + 2 * 300 + 4 * 100, "sayımsız: ham partiler");
});

test("15: sayılmamış ya da 0 sayılmış FIFO satırının birim fiyatı ay sonu fiyatıdır (ekran ve boş sayım formu aynı)", () => {
  const m = model({ lots: [lot("2026-10-15", 3, 400)], counts: [count("2026-10", 0)], perKg: 450 });
  const l = lineOf(m, "2026-10");
  assert.equal(l.valuation, "fifo");
  close(l.unitPrice, 450, "0 sayıldı");
  close(l.amount, 0, "tutar 0");
  const u = lineOf(model({ lots: [lot("2026-10-15", 3, 400)], counts: [count("2026-10", 1, ID + 100000)], perKg: 450 }), "2026-10");
  assert.equal(u.qty, null);
  close(u.unitPrice, 450, "sayılmadı");
});

test("16: kapsama satırı 100'e tamamlanır (%13 + %87)", () => {
  assert.deepEqual(coverageSplit(0.125), { covered: "%13'ü", rest: "%87'si" });
  assert.deepEqual(coverageSplit(0.86), { covered: "%86'sı", rest: "%14'ü" });
  assert.deepEqual(coverageSplit(1), { covered: "%100'ü", rest: "%0'ı" });
  const src = readFileSync(join(root, "src/app/panel/sayim/stock-form.tsx"), "utf8");
  assert.ok(!src.includes("coverageText(1 - coveredShare)"), "kalan ayrı yuvarlanmaz");
});

test("17 (E-05): başlangıç ayı yeniden değerleme yazmaz: önceki ayın sayımı ay sonu fiyatıyla taşınır", () => {
  // Eylül 5 KG (Eylül faturası 300), Ekim 5 KG, Ekim'de alım ve kullanım yok; bugünkü fiyat 450
  const lots = [lot("2026-09-02", 10, 250), lot("2026-09-20", 5, 300)];
  const counts = [count("2026-09", 5), count("2026-10", 5)];
  const stockDelta = (m: Model) => m.closingStock("2026-09").value - m.closingStock("2026-10").value;
  // Başlangıç Ekim: Eylül kapanışı 5 × 450 = 2.250, Ekim'e aynı fiyatla tek parça taşınır → Ekim kapanışı 2.250
  const oct = model({ lots, counts, perKg: 450, start: "2026-10" });
  close(oct.closingStock("2026-09").value, 2250, "Eylül ay sonu fiyatıyla");
  close(oct.closingStock("2026-10").value, 2250, "Ekim: taşınan parça Eylül'ün ay sonu fiyatıyla");
  close(stockDelta(oct), 0, "Ekim stok değişimi (mal maliyetine giren) 0");
  const l = lineOf(oct, "2026-10");
  assert.equal(l.valuation, "fifo");
  assert.deepEqual(
    l.layers.map((x) => [x.countMonth ?? x.date, x.qty / 1000, Math.round(x.unitCost * 1000)]),
    [["2026-09", 5, 450]],
  );
  // Taşınan açılış "faturalardan" payına girmez (ay sonu fiyatıyla)
  close(oct.stockSheet("2026-10").fifoCovered, 0, "faturadan gelen yok");
  assert.match(layerText(l.layers, 1000, "KG"), /^5 KG · Eyl sayımından 450,00\s₺\/KG \(FIFO başlangıcından önce: ay sonu fiyatı\)\.$/);
  // Kapalı ve Eylül başlangıcı da 0 (ikisinde de iki ay aynı yöntemle)
  close(stockDelta(model({ lots, counts, perKg: 450, start: null })), 0, "kapalı");
  close(stockDelta(model({ lots, counts, perKg: 450, start: "2026-09" })), 0, "Eylül'den FIFO");
  // Ekim'de alım varsa önce o tüketilir: 3 KG @400 + Eylül'den 2 KG @450
  const withBuy = model({ lots: [...lots, lot("2026-10-15", 3, 400)], counts, perKg: 450, start: "2026-10" });
  close(withBuy.closingStock("2026-10").value, 3 * 400 + 2 * 450, "Ekim alımı önce");
  close(withBuy.stockSheet("2026-10").fifoCovered, 1200, "faturadan gelen yalnız Ekim alımı");
  // Kâr-zarar: Ekim'in açılışı Eylül kapanışı, taşınan parçayla aynı fiyat
  close(oct.pnlMonth("2026-10").cells.get("stock:opening")!.value as number, 2250, "Ekim açılışı");
});

test("18 (E-05): Ayarlar önizlemesi başlangıca göre: aynı sayım, başlangıcı Ekim seçmek kâr değiştirmez", () => {
  const lots = [lot("2026-09-02", 10, 250), lot("2026-09-20", 5, 300)];
  const counts = [count("2026-09", 5), count("2026-10", 5)];
  const m = model({ lots, counts, perKg: 450, start: null });
  const sep = m.valuationPreview("2026-09", "2026-09");
  const octFromOct = m.valuationPreview("2026-10", "2026-10");
  const octFromSep = m.valuationPreview("2026-10", "2026-09");
  close(sep.old, 2250, "Eylül eski");
  close(sep.fifo, 1500, "Eylül FIFO (Eylül'den): 5 × 300");
  close(octFromOct.fifo, 2250, "Ekim FIFO, başlangıç Ekim: Eylül ay sonu fiyatıyla taşındı");
  close(octFromOct.covered, 0, "faturadan yok");
  close(octFromSep.fifo, 1500, "Ekim FIFO, başlangıç Eylül: Eylül'ün katmanları");
  // Kayıtlı başlangıç (kapalı) varsayılan: zincir kesilmez
  close(m.valuationPreview("2026-10").fifo, 1500, "from = null");
  // fifoLayersFrom önbelleği başlangıçlar arasında karışmaz
  close(layersValue(m.fifoLayersFrom("2026-10", ID, "2026-10")!.layers), 2250, "önbellek Ekim");
  close(layersValue(m.fifoLayersFrom("2026-10", ID, "2026-09")!.layers), 1500, "önbellek Eylül");
});

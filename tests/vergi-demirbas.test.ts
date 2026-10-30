// Demirbaş ve amortisman (plan docs/planlar/vergi.md §3.3, §11-E): yıllık ve çeyrek payları (kalan çeyreklere eşit ya
// da kümülatif ay ÷ 12), son yıl kalanı alır, ömür girilmezse 0, doğrudan gider sınırı, "demirbaş olabilir" adayları,
// faturası silinen varlık ve aday faturaları.
// Çalıştırma: npx tsx --test tests/vergi-demirbas.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { Invoice } from "../src/lib/calc/types";
import {
  assetCandidates,
  assetRows,
  assetTotals,
  depreciation,
  directExpenseAllowed,
  invoiceLabelOf,
  invoiceRemaining,
  LIFE_MISSING_WARNING,
  orphanAssets,
  parseInvoiceLabel,
  relinkCandidates,
  type TaxAsset,
  unlistedAssetInvoices,
} from "../src/lib/tax/assets";
import { rulesFor } from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const R = rulesFor(2026).rules;
const S = DEFAULT_TAX_SETTINGS;
/** Örnek A: şirket 2026-01-01'de başlar */
const A = { ...DEFAULT_TAX_SETTINGS, periodStart: "2026-01-01" };
const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const invoices = excelToDataset(data).invoices;

const asset = (over: Partial<TaxAsset>): TaxAsset => ({
  id: 1,
  name: "Varlık",
  invoiceId: null,
  invoiceLabel: null,
  acquiredOn: "2026-07-13",
  cost: 1000,
  kind: "demirbas",
  method: "amortisman",
  lifeYears: 5,
  ...over,
});
const q = (d: ReturnType<typeof depreciation>) => Object.fromEntries([...d.quarters].filter(([k]) => k.startsWith("2026-")));

test("E, Örnek A: yıllık ve çeyrek payları (kalan çeyreklere eşit; kümülatif ay ÷ 12)", () => {
  const a1 = depreciation(asset({ cost: 600000, acquiredOn: "2026-02-10", lifeYears: 5 }), "kalan", A);
  assert.deepEqual(a1.years, [2026, 2027, 2028, 2029, 2030].map((year) => ({ year, amount: 120000 })));
  assert.deepEqual(q(a1), { "2026-Q1": 30000, "2026-Q2": 30000, "2026-Q3": 30000, "2026-Q4": 30000 });
  const a2 = depreciation(asset({ cost: 240000, acquiredOn: "2026-08-15", lifeYears: 4 }), "kalan", A);
  assert.deepEqual(a2.years, [2026, 2027, 2028, 2029].map((year) => ({ year, amount: 60000 })));
  assert.deepEqual(q(a2), { "2026-Q3": 30000, "2026-Q4": 30000 });
  const a2m = depreciation(asset({ cost: 240000, acquiredOn: "2026-08-15", lifeYears: 4 }), "ay12", A);
  assert.deepEqual(q(a2m), { "2026-Q3": 45000, "2026-Q4": 15000 });
  assert.equal(a2m.years.reduce((s, y) => s + y.amount, 0), 240000);
  // Sonraki yıllar 4 çeyreğe eşit (kalan) ya da 3/12'şer (ay12)
  assert.equal(a2.quarters.get("2027-Q1"), 15000);
  assert.equal(a2m.quarters.get("2027-Q1"), 15000);
  // A3: doğrudan gider, edinilen ayın gideri
  const a3 = depreciation(asset({ cost: 10000, acquiredOn: "2026-05-05", method: "dogrudan_gider", lifeYears: null }), "kalan", A);
  assert.deepEqual(a3.direct, { month: "2026-05", amount: 10000 });
  assert.equal(a3.quarters.size, 0);
});

test("E: son yıl kalanı kuruş farkını kapatır (1.000 ₺, 3 yıl)", () => {
  assert.deepEqual(
    depreciation(asset({ cost: 1000, lifeYears: 3 }), "kalan", S).years.map((y) => y.amount),
    [333.33, 333.33, 333.34],
  );
});

test("E: ömür girilmezse amortisman 0 ve uyarı", () => {
  const d = depreciation(asset({ lifeYears: null }), "kalan", S);
  assert.deepEqual(d.years, []);
  assert.equal(d.quarters.size, 0);
  assert.equal(d.warning, LIFE_MISSING_WARNING);
  const t = assetTotals([asset({ id: 1, lifeYears: null, cost: 5000 }), asset({ id: 2, lifeYears: null }), asset({ id: 3, lifeYears: 5 })], 2026, S);
  assert.deepEqual(t.warnings, ["2 demirbaşın faydalı ömrü girilmedi; amortisman hesaplanmadı (vergi yüksek çıkar)."]);
  assert.equal(t.missingLife.cost.get("2026-Q3"), 6000);
});

test("E: doğrudan gider sınırı 12.000 ₺ (12.000 kabul, 12.000,01 ret)", () => {
  assert.equal(directExpenseAllowed(12000, R), true);
  assert.equal(directExpenseAllowed(12000.01, R), false);
});

test("E: 2026'da Temmuz'da edinilen varlık: kalan Q3 ve Q4'e yarı yarıya, ay12 9/12 ve 3/12; Q1 ve Q2 payı yok", () => {
  const k = depreciation(asset({ cost: 12000, lifeYears: 1 }), "kalan", S);
  assert.deepEqual(q(k), { "2026-Q3": 6000, "2026-Q4": 6000 });
  const m = depreciation(asset({ cost: 12000, lifeYears: 1 }), "ay12", S);
  assert.deepEqual(q(m), { "2026-Q3": 9000, "2026-Q4": 3000 });
});

test("E: XND üç varlık, 5 yıl: 2026 189.736,09; kalan 94.868,05 / 94.868,04; ay12 142.302,07 / 47.434,02", () => {
  const xnd = [338169.58, 540586.5, 69924.33].map((cost, i) => asset({ id: i + 1, cost, acquiredOn: "2026-07-13", lifeYears: 5 }));
  const k = assetTotals(xnd, 2026, S);
  assert.equal(k.yearDepreciation, 189736.09);
  assert.equal(k.depreciation.get("2026-Q3"), 94868.05);
  assert.equal(k.depreciation.get("2026-Q4"), 94868.04);
  assert.equal(k.depreciation.get("2026-Q2"), undefined);
  const m = assetTotals(xnd, 2026, { ...S, quarterDepreciation: "ay12" });
  assert.equal(m.depreciation.get("2026-Q3"), 142302.07);
  assert.equal(m.depreciation.get("2026-Q4"), 47434.02);
  const rows = assetRows(xnd, 2026, S);
  assert.equal(rows[0].thisYear, 67633.92);
  assert.equal(rows[0].netValue, 270535.66);
});

const inv = (id: number, date: string, supplier: string, category: string, amount: number, over: Partial<Invoice> = {}): Invoice => ({
  id,
  date,
  supplier,
  description: null,
  invoiceNo: null,
  category,
  amount,
  discount: 0,
  payable: amount * 1.2,
  unpaid: false,
  note: null,
  ...over,
});

test("E: demirbaş adayı: 12.000 ₺'yi aşan ve önceki 90 günde aynı tedarikçi ve kategoride faturası olmayan", () => {
  const list = [
    inv(1, "2026-07-01", "Tabelacı", "Reklam & Tabela", 12000.01),
    inv(2, "2026-07-01", "Ajans", "Reklam & Tabela", 12000),
    inv(3, "2026-05-01", "Yazılımcı", "Yazılım & POS", 5000),
    inv(4, "2026-07-20", "Yazılımcı", "Yazılım & POS", 20000), // 80 gün önce faturası var
    inv(5, "2026-01-01", "Bakımcı", "Hizmet", 5000),
    inv(6, "2026-07-20", "Bakımcı", "Hizmet", 20000), // önceki fatura 200 gün önce
    inv(7, "2026-07-01", "AVM", "Kira & AVM", 50000),
    inv(8, "2026-07-01", "Yemek kartı", "Komisyon", 50000),
    inv(9, "2026-07-01", "Pruva", "Alp Koç", 50000),
    inv(10, "2026-07-01", "XND", "Kuruluş & Demirbaş", 50000),
    inv(11, "2026-07-01", "Kararlı", "Hizmet", 50000, { taxNotAsset: true }),
    inv(12, "2026-07-01", "Hammaddeci", "Hammadde & İçecek", 50000),
  ];
  assert.deepEqual(
    assetCandidates(list, [], R).map((c) => c.invoice.id),
    [1, 6],
  );
  // Varlığa bağlanan fatura aday değildir
  assert.deepEqual(
    assetCandidates(list, [{ invoiceId: 6, cost: 20000 }], R).map((c) => c.invoice.id),
    [1],
  );
  // Excel verisinde: Aria Yazılım (7 Temmuz, 39.780) ve bir şahsın reklam faturası (17 Eylül, 30.000)
  assert.deepEqual(
    assetCandidates(invoices, [], R).map((c) => [c.invoice.supplier, c.invoice.date, c.net]),
    [
      ["Aria Yazılım", "2026-07-07", 39780],
      ["Beyza Karaman", "2026-09-17", 30000],
    ],
  );
  // Kuruluş & Demirbaş: 4 fatura varlık listesinde değil, 951.430,41
  const unlisted = unlistedAssetInvoices(invoices, []);
  assert.equal(unlisted.length, 4);
  assert.equal(Math.round(unlisted.reduce((s, x) => s + x.remaining, 0) * 100) / 100, 951430.41);
});

test("E: faturası silinen varlık: uyarı ve aday faturalar (aynı tedarikçi, ±%5, ±60 gün)", () => {
  const original = inv(20, "2026-07-13", "XND Teknoloji", "Kuruluş & Demirbaş", 338169.58);
  const label = invoiceLabelOf(original);
  assert.equal(label, "XND Teknoloji · 13.07.2026 · 338.169,58");
  assert.deepEqual(parseInvoiceLabel(label), { supplier: "XND Teknoloji", date: "2026-07-13", amount: 338169.58 });
  const orphan = asset({ id: 5, invoiceId: null, invoiceLabel: label, cost: 338169.58 });
  const list = [
    inv(21, "2026-07-20", "XND Teknoloji", "Hizmet", 340000), // ±%5, 7 gün: aday (gider sayılıyor)
    inv(22, "2026-07-20", "XND Teknoloji", "Kuruluş & Demirbaş", 330000), // aday
    inv(23, "2026-07-20", "XND Teknoloji", "Hizmet", 400000), // tutar tutmuyor
    inv(24, "2026-10-20", "XND Teknoloji", "Hizmet", 338169.58), // 99 gün
    inv(25, "2026-07-20", "Başkası", "Hizmet", 338169.58),
  ];
  assert.deepEqual(
    relinkCandidates(orphan, list).map((i) => i.id),
    [21, 22],
  );
  const o = orphanAssets([orphan, asset({ id: 6, invoiceId: 99 })], list);
  assert.equal(o.length, 1);
  assert.equal(o[0].doubleCounted, 340000);
  // R7: "demirbaş olabilir" (karar verilmemiş) aday gider sayılmıyor, hesap döneminden önceki fatura da: çift sayım yok
  assert.equal(orphanAssets([orphan], list, { notExpense: new Set([21]) })[0].doubleCounted, 0);
  assert.equal(orphanAssets([orphan], list, { periodStart: "2026-08-01" })[0].doubleCounted, 0);
  assert.equal(orphanAssets([orphan], list, { notExpense: new Set([99]), periodStart: "2026-06-25" })[0].doubleCounted, 340000);
  // Bağlı varlıklar faturanın netini aşamaz: kalan tutar
  assert.equal(invoiceRemaining(original, [asset({ id: 1, invoiceId: 20, cost: 300000 })]), 38169.58);
  assert.equal(invoiceRemaining(original, [asset({ id: 1, invoiceId: 20, cost: 300000 })], 1), 338169.58);
});

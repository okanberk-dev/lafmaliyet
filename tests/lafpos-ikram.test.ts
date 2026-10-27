// LafPOS'un ikramları (denetim B10, E-38; src/lib/lafpos/ikram.ts, docs/LAFPOS.md › İkram, docs/ZAYI-IKRAM.md):
// geçiş günü boşken hiçbir şey değişmez; geçiş gününden itibaren LafPOS'un gün sonu gelen günde ikram satırları
// kayıtlı tüketime bir kez girer, paneldeki o günkü ürün ikramı sayılmaz (hammadde ikramı ve zayi sayılır), yeni ürün
// ikramı reddedilir; kasa e-postası LafPOS'un ödenmez tutarını ikram listesiyle karşılaştırır.
// Çalıştırma: npx tsx --test tests/lafpos-ikram.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { countFactor, createModel } from "../src/lib/calc/engine";
import { consistency } from "../src/lib/calc/insights";
import type { Dataset, WasteEntry } from "../src/lib/calc/types";
import type { CashReportFields } from "../src/lib/cash-report";
import { lafposIkramCheck, panelWasteCounts, productIkramNote, productIkramRefusal, type LafposIkramData } from "../src/lib/lafpos/ikram";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import { renderCashReport } from "../src/server/notify/cash-report-template";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-11" };
const plain = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

const S = "2026-11-10";

test("kural: LafPOS'un gün sonu gelen günde paneldeki ürün ikramı sayılmaz; zayi ve hammadde ikramı sayılır", () => {
  const days = new Set(["2026-11-12"]);
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5 }, days), false);
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: null }, days), true, "hammadde ikramı");
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "zayi", productId: 5 }, days), true, "ürün zayisi");
  assert.equal(panelWasteCounts({ date: "2026-11-11", kind: "ikram", productId: 5 }, days), true, "gün sonu gelmeyen gün");
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5 }, new Set()), true, "geçiş günü boş");
});

test("yeni kayıt: LafPOS gününde ürün ikramı reddedilir (geçiş günü boşken ve öncesinde değil)", () => {
  const ikram = { date: "2026-11-12", kind: "ikram" as const, productId: 5 };
  assert.equal(productIkramRefusal(ikram, null), null);
  assert.equal(productIkramRefusal({ ...ikram, date: "2026-11-09" }, S), null);
  assert.equal(productIkramRefusal({ ...ikram, productId: null }, S), null);
  assert.equal(productIkramRefusal({ ...ikram, kind: "zayi" }, S), null);
  assert.equal(
    plain(productIkramRefusal(ikram, S)),
    "Ürün ikramı 10 Kasım'dan beri LafPOS'ta işaretlenir, panele girilmez. Burada hammadde ikramı ve zayi girilir.",
  );
  assert.equal(plain(productIkramRefusal({ ...ikram, date: S }, S)), plain(productIkramRefusal(ikram, S)));
  assert.equal(plain(productIkramNote(S)), "Ürün ikramı 10 Kasım'dan beri LafPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir.");
});

test("motor: LafPOS ikramı kayıtlı tüketime bir kez girer; paneldeki o günkü ürün ikramı çıkar; özet ve Tutarlılık", () => {
  const product = ds.products.find((p) => p.active && ds.recipeItems.some((r) => r.productId === p.id))!;
  const ing = ds.ingredients.find((i) => i.countUnit === "LT" || i.countUnit === "KG")!;
  const panel: WasteEntry[] = [
    // LafPOS'un gün sonu gelen günde: ürün ikramı sayılmaz, hammadde ikramı ve zayi sayılır
    { date: "2026-11-12", kind: "ikram", productId: product.id, ingredientId: null, qty: 3, factor: 1 },
    { date: "2026-11-12", kind: "ikram", productId: null, ingredientId: ing.id, qty: 1, factor: countFactor(ing.countUnit) },
    { date: "2026-11-12", kind: "zayi", productId: product.id, ingredientId: null, qty: 1, factor: 1 },
    // Gün sonu gelmeyen LafPOS günü: paneldeki ürün ikramı sayılır
    { date: "2026-11-13", kind: "ikram", productId: product.id, ingredientId: null, qty: 1, factor: 1 },
  ];
  const lafposIkram: LafposIkramData = {
    switchDay: S,
    days: ["2026-11-10", "2026-11-11", "2026-11-12"],
    lines: [
      { date: "2026-11-12", posName: "LATTE MEDIUM", productId: product.id, qty: 2, menuValue: 340, reason: "Müşteri" },
      // Ürüne bağlanamayan satır: tüketime girmez, özette sayılır
      { date: "2026-11-11", posName: "PUMPKIN CHAI", productId: null, qty: 1, menuValue: 180, reason: null },
    ],
  };
  const without = createModel({ ...ds, wasteEntries: panel });
  const model = createModel({ ...ds, wasteEntries: panel, lafposIkram });
  const perUnit = new Map((model.itemsByProduct.get(product.id) ?? []).map((it) => [it.ingredientId, model.evalQty(it).qty]));
  const used = model.recordedUsage("2026-11");
  for (const [id, q] of perUnit) {
    // LafPOS'un 2'si + 13 Kasım'daki panel ikramının 1'i = 3; 12 Kasım'daki panel ikramının 3'ü yok
    const extra = id === ing.id ? 1000 * (ing.countUnit === "KG" || ing.countUnit === "LT" ? 1 : 0) : 0;
    assert.ok(Math.abs((used.get(id)?.ikram ?? 0) - (q * 3 + extra)) < 1e-9, `${id}: ikram`);
    assert.ok(Math.abs((used.get(id)?.zayi ?? 0) - q * 1) < 1e-9, `${id}: zayi`);
  }
  // Geçiş günü yokken (lafposIkram yok) panelin dört kaydı da sayılır
  const usedWithout = without.recordedUsage("2026-11");
  for (const [id, q] of perUnit) {
    const extra = id === ing.id ? 1000 : 0;
    assert.ok(Math.abs((usedWithout.get(id)?.ikram ?? 0) - (q * 4 + extra)) < 1e-9, `${id}: geçiş günü yokken`);
  }
  const sum = model.wasteSummary("2026-11");
  assert.equal(sum.ikram.count, 4, "panelin hammadde ikramı ve 13 Kasım'ı, LafPOS'un iki satırı");
  assert.equal(sum.ikram.lafpos, 2);
  assert.equal(sum.notCounted, 1);
  assert.equal(sum.ikram.menuValue, 340 + 180 + product.price * 1);
  assert.ok(Math.abs(sum.ikram.cost - (model.computeProduct(product).ingredientTotal * 3 + (model.unitCost.get(ing.id) ?? 0) * 1000)) < 1e-6);
  assert.deepEqual(without.wasteSummary("2026-11").ikram.lafpos, 0);
  assert.equal(without.wasteSummary("2026-11").notCounted, 0);
  // Motorun saydığı kayıtlar (haftalık özet de okur): LafPOS satırı adıyla
  assert.deepEqual(
    model.countedWaste.filter((w) => w.source === "lafpos").map((w) => [w.date, w.name, w.qty, w.menuValue]),
    [
      ["2026-11-12", "LATTE MEDIUM", 2, 340],
      ["2026-11-11", "PUMPKIN CHAI", 1, 180],
    ],
  );
  assert.equal(without.countedWaste.length, 4);
  // Tutarlılık: ikram sütunu ve özet LafPOS'u da sayar
  const c = consistency(model, "2026-11");
  assert.equal(c.waste.ikram.lafpos, 2);
  const row = c.rows.find((r) => perUnit.has(r.ingredient.id));
  assert.ok(row && row.ikram > 0);
});

test("kasa e-postası: LafPOS gününde ikram LafPOS'un iki rakamıyla karşılaştırılır; panelin uyarısı çıkmaz", () => {
  assert.equal(lafposIkramCheck(340, 340), null);
  assert.equal(lafposIkramCheck(340, 339.5), null, "1 TL'den az fark yok sayılır");
  assert.equal(
    plain(lafposIkramCheck(520, 340)),
    "LafPOS'un ödenmez tutarı (Z) ikram listesinden 180 ₺ fazla: LafPOS'ta ödenmez işaretlenen ama ikram listesine girmeyen (ya da iptal edilen adisyonda kalan) satır olabilir.",
  );
  const f: CashReportFields & { discounts: number | null } = {
    date: "2026-11-12",
    zNo: "3",
    receipts: 40,
    zTotal: 10_000,
    cash: 6_000,
    card: 4_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 1_000,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 7_000,
    handedOver: 0,
    bankPos: null,
    offRevenue: 340,
    note: null,
    discounts: 0,
  };
  const meta = { by: "Ayşe", revision: 1, submittedAt: new Date("2026-11-12T22:00:00+03:00"), kasa: "LafPOS" as const };
  // Bugünkü (ModPOS) kural: ödenmez tutarı paneldeki ikramla
  const modpos = renderCashReport(f, { ...meta, kasa: "ModPOS", ikramValue: 170 });
  assert.match(plain(modpos.html), /ModPOS'un ödenmez tutarı panelde kayıtlı ikramdan 170 ₺ fazla: kaydı eksik ikram olabilir\./);
  assert.match(plain(modpos.html), /Panelde kayıtlı ikram/);
  // LafPOS günü: LafPOS'un ikramı, tutar aynı, panele girilen 1 ürün ikramı sayılmadı
  const same = renderCashReport(f, { ...meta, ikramValue: 340, lafposIkram: { offRevenue: 340, ikramValue: 340, notCounted: 1 } });
  const html = plain(same.html);
  assert.match(html, /LafPOS'taki ikram/);
  assert.doesNotMatch(html, /Panelde kayıtlı ikram/);
  assert.doesNotMatch(html, /panelde kayıtlı ikramdan/);
  assert.doesNotMatch(html, /ikram listesinden/);
  assert.match(html, /Panele bu güne girilen 1 ürün ikramı sayılmadı: ikram LafPOS'tan geliyor\./);
  // LafPOS'un iki rakamı farklı: bilgi satırı
  const diff = plain(renderCashReport(f, { ...meta, ikramValue: 340, lafposIkram: { offRevenue: 520, ikramValue: 340, notCounted: 0 } }).html);
  assert.match(diff, /LafPOS'un ödenmez tutarı \(Z\) ikram listesinden 180 ₺ fazla/);
  assert.doesNotMatch(diff, /sayılmadı/);
});

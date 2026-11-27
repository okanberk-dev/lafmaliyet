// Zayi ve ikram: kalem adı ve özet (src/lib/waste.ts), hesap motorunda malzeme tüketimi ve maliyeti
// (engine.recordedUsage / wasteSummary), tutarlılıkta sapmadan düşülmesi (insights.consistency), kasa raporuna geçişi ve
// yetki kuralları.
// Çalıştırma: npx tsx --test tests/zayi-ikram.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { whatsappText, type CashReportFields } from "../src/lib/cash-report";
import { countFactor, createModel } from "../src/lib/calc/engine";
import { consistency } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { matchesChoice, productLabel, summarize } from "../src/lib/waste";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };

test("kalem adı, arama ve günün özeti", () => {
  assert.equal(productLabel({ name: "Latte", size: "M" }), "Latte M");
  assert.equal(productLabel({ name: "Cookie", size: "Tek" }), "Cookie");
  assert.equal(matchesChoice({ name: "Süt (Tam yağlı)", group: "Süt ürünleri" }, "sut tam"), true);
  assert.equal(matchesChoice({ name: "Kruvasan", group: "Unlu" }, "KRUVASAN"), true);
  assert.equal(matchesChoice({ name: "Latte M", group: "Kahve" }, "mocha"), false);
  const lines = [
    { kind: "ikram" as const, name: "Latte M", qty: 1, unit: "adet" },
    { kind: "ikram" as const, name: "Latte M", qty: 1, unit: "adet" },
    { kind: "ikram" as const, name: "Cookie", qty: 1, unit: "adet" },
    { kind: "zayi" as const, name: "Süt", qty: 1.5, unit: "LT" },
  ];
  assert.equal(summarize(lines, "ikram"), "2× Latte M, 1× Cookie");
  assert.equal(summarize(lines, "zayi"), "Süt 1,5 LT");
  assert.equal(summarize([], "zayi"), null);
  const many = Array.from({ length: 9 }, (_, i) => ({ kind: "zayi" as const, name: `Kalem ${i}`, qty: 1, unit: "adet" }));
  assert.match(summarize(many, "zayi", 6)!, /\+3$/);
});

test("hesap: ikram edilen ürünün malzemesi reçeteden, zayi hammadde doğrudan (KG → gr); maliyet ve menü değeri", () => {
  const product = ds.products.find((p) => p.active && ds.recipeItems.some((r) => r.productId === p.id))!;
  const ing = ds.ingredients.find((i) => i.countUnit === "LT" || i.countUnit === "KG")!;
  const model0 = createModel(ds);
  const model = createModel({
    ...ds,
    wasteEntries: [
      { date: "2026-09-10", kind: "ikram", productId: product.id, ingredientId: null, qty: 2, factor: 1 },
      { date: "2026-09-11", kind: "zayi", productId: null, ingredientId: ing.id, qty: 1.5, factor: countFactor(ing.countUnit) },
      // Başka ayın kaydı bu aya girmez
      { date: "2026-08-31", kind: "zayi", productId: null, ingredientId: ing.id, qty: 9, factor: 1000 },
    ],
  });
  const used = model.recordedUsage("2026-09");
  for (const it of model.itemsByProduct.get(product.id) ?? []) {
    const expected = model.evalQty(it).qty * 2 + (it.ingredientId === ing.id ? 1500 : 0);
    const got = (used.get(it.ingredientId)?.ikram ?? 0) + (it.ingredientId === ing.id ? (used.get(ing.id)?.zayi ?? 0) : 0);
    assert.ok(Math.abs(got - expected) < 1e-9, `${it.ingredientId}: ${got} ≠ ${expected}`);
  }
  assert.equal(used.get(ing.id)?.zayi, 1500);
  const sum = model.wasteSummary("2026-09");
  assert.equal(sum.ikram.count, 1);
  assert.equal(sum.zayi.count, 1);
  assert.ok(Math.abs(sum.ikram.cost - model0.computeProduct(product).ingredientTotal * 2) < 1e-9);
  assert.ok(Math.abs(sum.zayi.cost - (model0.unitCost.get(ing.id) ?? 0) * 1500) < 1e-9);
  assert.equal(sum.ikram.menuValue, product.price * 2);
  // Kayıtsız aylar ve eski veri kümesi (wasteEntries yok) bozulmaz
  assert.equal(model0.recordedUsage("2026-09").size, 0);
  assert.deepEqual(model0.wasteSummary("2026-09"), { zayi: { count: 0, cost: 0, asilpos: 0 }, ikram: { count: 0, cost: 0, menuValue: 0, asilpos: 0 }, notCounted: 0 });
});

test("tutarlılık: sapmadan kayıtlı zayi ve ikram düşülür; eski alanlar değişmez", () => {
  const month = "2026-09";
  // Satışta kullanılan, sayım birimi olan bir malzeme: iki ayın sayımı ve bu ayın alımı girilince sapma hesaplanır
  const usage = createModel(ds).ingredientUsage(month);
  const ing = ds.ingredients.find((i) => i.countUnit && (usage.get(i.id) ?? 0) > 0)!;
  assert.ok(ing, "satışta kullanılan sayım birimli malzeme yok");
  const f = countFactor(ing.countUnit);
  const withCounts: Dataset = {
    ...ds,
    stockCounts: [
      ...ds.stockCounts,
      { month: "2026-08", ingredientId: ing.id, qty: 10, factor: f },
      { month, ingredientId: ing.id, qty: 4, factor: f },
    ],
    purchaseQuantities: [...ds.purchaseQuantities.filter((x) => !(x.month === month && x.ingredientId === ing.id)), { month, ingredientId: ing.id, qty: 5 * f, note: null }],
  };
  const before = consistency(createModel(withCounts), month).rows.find((r) => r.ingredient.id === ing.id)!;
  assert.equal(before.stock, "complete");
  assert.equal(before.zayi, 0);
  assert.equal(before.unexplained, before.variance, "kayıt yokken açıklanamayan = sapma");
  const c = consistency(
    createModel({ ...withCounts, wasteEntries: [{ date: `${month}-15`, kind: "zayi", productId: null, ingredientId: ing.id, qty: 0.5, factor: f }] }),
    month,
  );
  const r = c.rows.find((x) => x.ingredient.id === ing.id)!;
  // Sapma, kullanım ve fatura farkı aynı: kayıt yalnız açıklamaya girer
  assert.equal(r.variance, before.variance);
  assert.equal(r.usage, before.usage);
  assert.equal(r.diffAmount, before.diffAmount);
  assert.equal(r.zayi, 0.5 * f);
  assert.ok(Math.abs(r.unexplained! - (before.variance! - 0.5 * f)) < 1e-9);
  assert.ok(Math.abs(r.unexplainedAmount! - r.unexplained! * r.unitCost) < 1e-9);
  assert.ok(Math.abs(c.totalUnexplained - (c.totalVariance - c.totalRecorded)) < 1e-6);
  assert.ok(Math.abs(c.totalRecorded - 0.5 * f * r.unitCost) < 1e-9);
  assert.equal(c.waste.zayi.count, 1);
});

test("kasa raporu: ödenmez tutarı ve günün zayi / ikramı WhatsApp metninde", () => {
  const f: CashReportFields = {
    date: "2026-10-21",
    zNo: null,
    receipts: null,
    zTotal: 1000,
    cash: 400,
    card: 600,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 0,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 400,
    handedOver: 0,
    bankPos: null,
    offRevenue: 180,
    note: null,
  };
  const t = whatsappText(f, { by: "Zeynep", waste: { ikram: "2× Latte M", zayi: "Süt 1 LT" } }).replace(/ /g, " ");
  assert.match(t, /• Ödenmez \/ ikram \(ciro dışı\): 180 ₺/);
  assert.match(t, /\*Zayi & ikram\*\nİkram: 2× Latte M\nZayi: Süt 1 LT/);
  assert.doesNotMatch(whatsappText({ ...f, offRevenue: null }, { by: "Z" }), /Ödenmez|Zayi & ikram/);
});

test("yetki: personel bugüne ve düne (dün kilitlenene kadar) girer, kendi kaydını o yolda siler; maliyet personele gitmez", () => {
  const src = readFileSync(join(root, "src/server/actions/waste.ts"), "utf8");
  assert.match(src, /\.refine\(\(d\) => \(d\.productId === null\) !== \(d\.ingredientId === null\)/);
  // Kip çekirdekte (dalga 10 §2.8; tests/zayi-istek.test.ts): personelde doğrudan değilse ret
  const core = readFileSync(join(root, "src/server/waste/core.ts"), "utf8");
  // Kilit şube başına (denetim 21 Kasım #13): yeni kayıtta kaydın ineceği şube, silmede kaydın kendi şubesi
  assert.match(core, /if \(me\.role !== "admin"\) \{\s+const mode = staffWasteMode\(data\.date, now, await wasteLock\(tx, data\.date, branchId\)\);\s+if \(mode !== "direct"\)/);
  assert.match(core, /if \(me\.role !== "admin" && staffDeleteMode\(row, me, now, await wasteLock\(tx, row\.date, row\.branchId\)\) !== "direct"\)/);
  const page = readFileSync(join(root, "src/app/panel/zayi/page.tsx"), "utf8");
  // Ay özeti (maliyet) yalnız yöneticiye: personel dalı ondan önce döner
  assert.ok(page.indexOf("if (!admin)") < page.indexOf("<WasteMonth"), "personel maliyet özetini görmez");
  // Müdür "admin" düzeyinde yazar (opsLevel) ama ay özeti gerçek role bakar; özetin kendisi de yöneticiyi ister (bulgu 4)
  assert.match(page, /const costs = user\.role === "admin";/, "müdür ('admin' düzeyi) ay özetinin malzeme maliyetini görmez");
  assert.match(page, /\{costs \? <WasteMonth month=\{month\} today=\{today\} \/> : null\}/, "müdür ('admin' düzeyi) ay özetinin malzeme maliyetini görmez");
  assert.match(page.slice(page.indexOf("async function WasteMonth(")), /^async function WasteMonth\([^)]*\) \{\s+await requireAdmin\(\);/, "müdür ('admin' düzeyi) ay özetinin malzeme maliyetini görmez");
  const choices = readFileSync(join(root, "src/server/data/waste.ts"), "utf8");
  assert.doesNotMatch(choices.slice(0, choices.indexOf("export interface WasteEntryDTO")), /price|cost/i, "seçenekler fiyat taşımaz");
});

test("ikram formu: uygulamanın ödül içeceği ikram değildir (online satışta sayılır; iki kez düşülmesin)", () => {
  const board = readFileSync(join(root, "src/app/panel/zayi/waste-board.tsx"), "utf8");
  // AsilPOS gününde (ürün ikramı AsilPOS'ta) not AsilPOS'unkiyle yer değiştirir; öteki günlerde bu not
  assert.match(board, /kind === "ikram" \? \(\s*<p[^>]*>\s*Uygulamadaki ödülle \(damga kartı, davet kuponu\) verilen içecek ikram değildir/);
});

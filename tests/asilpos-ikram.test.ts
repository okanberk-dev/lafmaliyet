// AsilPOS'un ikramları (denetim B10, E-38; src/lib/asilpos/ikram.ts, docs/ASILPOS.md › İkram, docs/ZAYI-IKRAM.md):
// geçiş günü boşken hiçbir şey değişmez; geçiş gününden itibaren AsilPOS'un gün sonu gelen günde ikram satırları
// kayıtlı tüketime bir kez girer, paneldeki o günkü ürün ikramı sayılmaz (hammadde ikramı ve zayi sayılır), yeni ürün
// ikramı reddedilir; kasa e-postası AsilPOS'un ödenmez tutarını ikram listesiyle karşılaştırır.
// Çalıştırma: npx tsx --test tests/asilpos-ikram.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { countFactor, createModel } from "../src/lib/calc/engine";
import { consistency } from "../src/lib/calc/insights";
import type { Dataset, WasteEntry } from "../src/lib/calc/types";
import type { CashReportFields } from "../src/lib/cash-report";
import {
  asilposIkramCheck,
  asilposLineKind,
  panelWasteCounts,
  productIkramClosed,
  productIkramNote,
  productIkramRefusal,
  unmatchedIkramNames,
  type AsilposIkramData,
} from "../src/lib/asilpos/ikram";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";
import { renderCashReport } from "../src/server/notify/cash-report-template";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-11" };
const plain = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

const S = "2026-11-10";

test("kural: AsilPOS'un gün sonu gelen günde paneldeki ürün ikramı sayılmaz; zayi ve hammadde ikramı sayılır", () => {
  const days = new Set(["2026-11-12"]);
  const m = "marina";
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5, branchId: m }, days), false);
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: null, branchId: m }, days), true, "hammadde ikramı");
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "zayi", productId: 5, branchId: m }, days), true, "ürün zayisi");
  assert.equal(panelWasteCounts({ date: "2026-11-11", kind: "ikram", productId: 5, branchId: m }, days), true, "gün sonu gelmeyen gün");
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5, branchId: m }, new Set()), true, "geçiş günü boş");
  // Gün sonları AsilPOS'un şubesinin (Marina): ModPOS'ta kalan Tuzla'nın (şubesiz eski kayıt da Tuzla'nın) aynı günkü ürün
  // ikramı sayılır (21 Kasım kararı)
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5, branchId: "tuzla" }, days), true, "Tuzla");
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5 }, days), true, "şubesiz (Tuzla)");
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5, branchId: null }, days), true, "şubesi null (Tuzla)");
  assert.equal(panelWasteCounts({ date: "2026-11-12", kind: "ikram", productId: 5, branchId: "marina" }, days), false, "Marina");
});

test("yeni kayıt: ürün ikramı AsilPOS'un gün sonu gelen günde ve bugün reddedilir; gün sonu gelmeyen geçmiş günde girilir", () => {
  const ikram = { date: "2026-11-12", kind: "ikram" as const, productId: 5 };
  const got = { received: true, today: "2026-11-14" };
  const waiting = { received: false, today: "2026-11-14" };
  assert.equal(productIkramRefusal(ikram, null, got), null, "geçiş günü boş");
  assert.equal(productIkramRefusal({ ...ikram, date: "2026-11-09" }, S, got), null, "geçişten önce");
  assert.equal(productIkramRefusal({ ...ikram, productId: null }, S, got), null, "hammadde ikramı");
  assert.equal(productIkramRefusal({ ...ikram, kind: "zayi" }, S, got), null, "ürün zayisi");
  assert.equal(
    plain(productIkramRefusal(ikram, S, got)),
    "Ürün ikramı 10 Kasım'dan beri AsilPOS'ta işaretlenir, panele girilmez. Burada hammadde ikramı ve zayi girilir.",
  );
  assert.equal(plain(productIkramRefusal({ ...ikram, date: S }, S, got)), plain(productIkramRefusal(ikram, S, got)));
  // Gün sonu gelmeyen geçmiş gün (kasa bilgisayarı bozuldu, gün gönderilmedi): panelden girilir, o gün panelinki sayılır
  assert.equal(productIkramRefusal(ikram, S, waiting), null);
  assert.equal(productIkramClosed("2026-11-12", S, waiting), false);
  // Bugün: gün sonu bekleniyor, kapalı
  assert.equal(productIkramClosed("2026-11-14", S, waiting), true);
  assert.ok(productIkramRefusal({ ...ikram, date: "2026-11-14" }, S, waiting));
  // Onaylar'da kaydın nereye girildiği söylenir ("Burada" değil)
  assert.equal(
    plain(productIkramRefusal(ikram, S, got, "onay")),
    "Ürün ikramı 10 Kasım'dan beri AsilPOS'ta işaretlenir, panele girilmez. Hammadde ikramı ve zayi Zayi & ikram'da girilir.",
  );
  assert.equal(plain(productIkramNote(S)), "Ürün ikramı 10 Kasım'dan beri AsilPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir.");
});

test("AsilPOS satırının türü nedenin ön ekinden: \"Zayi: …\" zayi, \"Ödenmez: …\" ve öteki her şey ikram", () => {
  assert.deepEqual(asilposLineKind("Zayi: Döküldü"), { kind: "zayi", reason: "Döküldü" });
  assert.deepEqual(asilposLineKind("Zayi:"), { kind: "zayi", reason: null }, "nedensiz zayi (AsilPOS'un 'Zayi: ' öneki kırpılmış)");
  assert.deepEqual(asilposLineKind("zayi : bozuk"), { kind: "zayi", reason: "bozuk" });
  assert.deepEqual(asilposLineKind("Ödenmez: Personel yemeği"), { kind: "ikram", reason: "Ödenmez: Personel yemeği" });
  assert.deepEqual(asilposLineKind("Müşteri"), { kind: "ikram", reason: "Müşteri" });
  assert.deepEqual(asilposLineKind(null), { kind: "ikram", reason: null });
  assert.deepEqual(asilposLineKind("Zayiat değil"), { kind: "ikram", reason: "Zayiat değil" }, "ön ek iki noktayla");
});

test("motor: AsilPOS ikramı kayıtlı tüketime bir kez girer; paneldeki o günkü ürün ikramı çıkar; özet ve Tutarlılık", () => {
  const product = ds.products.find((p) => p.active && ds.recipeItems.some((r) => r.productId === p.id))!;
  const ing = ds.ingredients.find((i) => i.countUnit === "LT" || i.countUnit === "KG")!;
  const panel: WasteEntry[] = [
    // AsilPOS'un gün sonu gelen günde: ürün ikramı sayılmaz, hammadde ikramı ve zayi sayılır
    { date: "2026-11-12", kind: "ikram", productId: product.id, ingredientId: null, qty: 3, factor: 1, branchId: "marina" },
    { date: "2026-11-12", kind: "ikram", productId: null, ingredientId: ing.id, qty: 1, factor: countFactor(ing.countUnit), branchId: "marina" },
    { date: "2026-11-12", kind: "zayi", productId: product.id, ingredientId: null, qty: 1, factor: 1, branchId: "marina" },
    // Gün sonu gelmeyen AsilPOS günü: paneldeki ürün ikramı sayılır
    { date: "2026-11-13", kind: "ikram", productId: product.id, ingredientId: null, qty: 1, factor: 1, branchId: "marina" },
  ];
  const asilposIkram: AsilposIkramData = {
    switchDay: S,
    days: ["2026-11-10", "2026-11-11", "2026-11-12"],
    lines: [
      { date: "2026-11-12", kind: "ikram", posName: "LATTE MEDIUM", productId: product.id, qty: 2, menuValue: 340, reason: "Müşteri" },
      // Ürüne bağlanamayan satır: tüketime girmez, özette sayılır
      { date: "2026-11-11", kind: "ikram", posName: "PUMPKIN CHAI", productId: null, qty: 1, menuValue: 180, reason: null },
    ],
  };
  const without = createModel({ ...ds, wasteEntries: panel });
  const model = createModel({ ...ds, wasteEntries: panel, asilposIkram });
  const perUnit = new Map((model.itemsByProduct.get(product.id) ?? []).map((it) => [it.ingredientId, model.evalQty(it).qty]));
  const used = model.recordedUsage("2026-11");
  for (const [id, q] of perUnit) {
    // AsilPOS'un 2'si + 13 Kasım'daki panel ikramının 1'i = 3; 12 Kasım'daki panel ikramının 3'ü yok
    const extra = id === ing.id ? 1000 * (ing.countUnit === "KG" || ing.countUnit === "LT" ? 1 : 0) : 0;
    assert.ok(Math.abs((used.get(id)?.ikram ?? 0) - (q * 3 + extra)) < 1e-9, `${id}: ikram`);
    assert.ok(Math.abs((used.get(id)?.zayi ?? 0) - q * 1) < 1e-9, `${id}: zayi`);
  }
  // Geçiş günü yokken (asilposIkram yok) panelin dört kaydı da sayılır
  const usedWithout = without.recordedUsage("2026-11");
  for (const [id, q] of perUnit) {
    const extra = id === ing.id ? 1000 : 0;
    assert.ok(Math.abs((usedWithout.get(id)?.ikram ?? 0) - (q * 4 + extra)) < 1e-9, `${id}: geçiş günü yokken`);
  }
  const sum = model.wasteSummary("2026-11");
  assert.equal(sum.ikram.count, 4, "panelin hammadde ikramı ve 13 Kasım'ı, AsilPOS'un iki satırı");
  assert.equal(sum.ikram.asilpos, 2);
  assert.equal(sum.notCounted, 1);
  assert.equal(sum.ikram.menuValue, 340 + 180 + product.price * 1);
  assert.ok(Math.abs(sum.ikram.cost - (model.computeProduct(product).ingredientTotal * 3 + (model.unitCost.get(ing.id) ?? 0) * 1000)) < 1e-6);
  assert.deepEqual(without.wasteSummary("2026-11").ikram.asilpos, 0);
  assert.equal(without.wasteSummary("2026-11").notCounted, 0);
  // Motorun saydığı kayıtlar (haftalık özet de okur): AsilPOS satırı adıyla
  assert.deepEqual(
    model.countedWaste.filter((w) => w.source === "asilpos").map((w) => [w.date, w.name, w.qty, w.menuValue]),
    [
      ["2026-11-12", "LATTE MEDIUM", 2, 340],
      ["2026-11-11", "PUMPKIN CHAI", 1, 180],
    ],
  );
  assert.equal(without.countedWaste.length, 4);
  // Tutarlılık: ikram sütunu ve özet AsilPOS'u da sayar
  const c = consistency(model, "2026-11");
  assert.equal(c.waste.ikram.asilpos, 2);
  const row = c.rows.find((r) => perUnit.has(r.ingredient.id));
  assert.ok(row && row.ikram > 0);
});

test("motor: AsilPOS'ta zayi yazılan satır zayi olarak bir kez girer, ikram olarak değil; panel zayisi de sayılır", () => {
  const product = ds.products.find((p) => p.active && ds.recipeItems.some((r) => r.productId === p.id))!;
  const panel: WasteEntry[] = [{ date: "2026-11-12", kind: "zayi", productId: product.id, ingredientId: null, qty: 1, factor: 1 }];
  const zayiLine = { date: "2026-11-12", kind: "zayi" as const, posName: "LATTE MEDIUM", productId: product.id, qty: 1, menuValue: 170, reason: "Döküldü" };
  const onlyAsilpos = createModel({ ...ds, wasteEntries: [], asilposIkram: { switchDay: S, days: ["2026-11-12"], lines: [zayiLine] } });
  const perUnit = new Map((onlyAsilpos.itemsByProduct.get(product.id) ?? []).map((it) => [it.ingredientId, onlyAsilpos.evalQty(it).qty]));
  for (const [id, q] of perUnit) {
    assert.ok(Math.abs((onlyAsilpos.recordedUsage("2026-11").get(id)?.zayi ?? 0) - q) < 1e-9, `${id}: zayi bir kez`);
    assert.equal(onlyAsilpos.recordedUsage("2026-11").get(id)?.ikram ?? 0, 0, `${id}: ikram değil`);
  }
  const sum = onlyAsilpos.wasteSummary("2026-11");
  assert.deepEqual([sum.zayi.count, sum.zayi.asilpos, sum.ikram.count, sum.ikram.menuValue], [1, 1, 0, 0]);
  // Panelde de girildiyse (sahibin sorusu açık) ikisi de sayılır: Zayi'nin gün listesi "AsilPOS'ta da zayi" der
  const both = createModel({ ...ds, wasteEntries: panel, asilposIkram: { switchDay: S, days: ["2026-11-12"], lines: [zayiLine] } });
  for (const [id, q] of perUnit) assert.ok(Math.abs((both.recordedUsage("2026-11").get(id)?.zayi ?? 0) - 2 * q) < 1e-9);
  assert.equal(both.wasteSummary("2026-11").ikram.count, 0);
});

test("kasa e-postası: AsilPOS gününde ikram AsilPOS'un iki rakamıyla karşılaştırılır; panelin uyarısı çıkmaz", () => {
  assert.equal(asilposIkramCheck(340, 340), null);
  assert.equal(asilposIkramCheck(340, 339.5), null, "1 TL'den az fark yok sayılır");
  // Z büyük: listeye girmeyen ödenmez satır; Z küçük: listede kalan iptal edilmiş adisyonun ikramı
  assert.equal(
    plain(asilposIkramCheck(520, 340)),
    "AsilPOS'un ödenmez tutarı (Z) ikram ve zayi listesinden 180 ₺ fazla: AsilPOS'ta ödenmez işaretlenen ama listeye girmeyen satır olabilir.",
  );
  assert.equal(
    plain(asilposIkramCheck(640, 760)),
    "AsilPOS'un ödenmez tutarı (Z) ikram ve zayi listesinden 120 ₺ az: iptal edilen adisyonun ikramı listede kalmış olabilir.",
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
  const meta = { by: "Ayşe", revision: 1, submittedAt: new Date("2026-11-12T22:00:00+03:00"), kasa: "AsilPOS" as const };
  // Bugünkü (ModPOS) kural: ödenmez tutarı paneldeki ikramla
  const modpos = renderCashReport(f, { ...meta, kasa: "ModPOS", ikramValue: 170 });
  assert.match(plain(modpos.html), /ModPOS'un ödenmez tutarı panelde kayıtlı ikramdan 170 ₺ fazla: kaydı eksik ikram olabilir\./);
  assert.match(plain(modpos.html), /Panelde kayıtlı ikram/);
  // AsilPOS günü: AsilPOS'un ikramı, tutar aynı, panele girilen 1 ürün ikramı sayılmadı
  const same = renderCashReport(f, { ...meta, ikramValue: 340, asilposIkram: { offRevenue: 340, ikramValue: 340, notCounted: 1 } });
  const html = plain(same.html);
  assert.match(html, /AsilPOS'taki ikram/);
  assert.doesNotMatch(html, /Panelde kayıtlı ikram/);
  assert.doesNotMatch(html, /panelde kayıtlı ikramdan/);
  assert.doesNotMatch(html, /ikram listesinden/);
  assert.match(html, /Panele bu güne girilen 1 ürün ikramı sayılmadı: ikram AsilPOS'tan geliyor\./);
  // AsilPOS'un iki rakamı farklı: bilgi satırı
  const diff = plain(renderCashReport(f, { ...meta, ikramValue: 340, asilposIkram: { offRevenue: 520, ikramValue: 340, notCounted: 0 } }).html);
  assert.match(diff, /AsilPOS'un ödenmez tutarı \(Z\) ikram ve zayi listesinden 180 ₺ fazla/);
  assert.doesNotMatch(diff, /sayılmadı/);
  // AsilPOS'ta zayi yazılan kalem de ödenmez tutarındadır: Z, listenin tamamıyla karşılaştırılır; zayi ayrı satır
  const withZayi = plain(
    renderCashReport(f, { ...meta, ikramValue: 340, asilposIkram: { offRevenue: 520, ikramValue: 340, zayiValue: 180, listValue: 520, notCounted: 0 } }).html,
  );
  assert.match(withZayi, /AsilPOS'ta zayi yazılan/);
  assert.doesNotMatch(withZayi, /ikram ve zayi listesinden/);
});

test("Ayarlar › AsilPOS: ikramda bağlanamayan adlar gün ve adetle; satış listesinde görünen ad tekrar edilmez", () => {
  const lines = [
    { date: "2026-11-11", posName: "PERSONEL KAHVESİ", productId: null, qty: 2 },
    { date: "2026-11-12", posName: "Personel  Kahvesi", productId: null, qty: 1 },
    { date: "2026-11-12", posName: "TADIM BARDAĞI", productId: null, qty: 5 },
    { date: "2026-11-12", posName: "PUMPKIN CHAI", productId: null, qty: 9 },
    { date: "2026-11-12", posName: "LATTE MEDIUM", productId: 3, qty: 4 },
  ];
  assert.deepEqual(unmatchedIkramNames(lines, ["Pumpkin Chai"]), {
    items: [
      { posName: "TADIM BARDAĞI", qty: 5, days: 1 },
      { posName: "PERSONEL KAHVESİ", qty: 3, days: 2 },
    ],
    count: 2,
  });
  assert.equal(unmatchedIkramNames(lines, [], 1).items.length, 1);
  assert.equal(unmatchedIkramNames(lines, [], 1).count, 3);
});

// Tutarlılık sayfasındaki dört özet kartının dökümü (karta dokununca açılan pencere): büyük fark (adet), fatura
// farkı, sayım sapması, satış ↔ POS. Döküm her zaman kartın rakamını tutmalı; bilgi bölümleri toplama girmez.
// Çalıştırma: npx tsx --test tests/tutarlilik-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { consistencyBreakdowns, hasNegative, tableHref } from "../src/app/panel/tutarlilik/breakdowns";
import { severityOf } from "../src/app/panel/tutarlilik/severity";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import { createModel } from "../src/lib/calc/engine";
import { consistency } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
const MONTH = "2026-09";
const ingId = (name: string) => {
  const i = ds.ingredients.find((x) => x.name === name);
  assert.ok(i, `hammadde yok: ${name}`);
  return i.id;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const close = (a: number, b: number, label: string, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} ≠ ${b}`);
const inTotal = (gs: BreakdownGroup[]) => gs.filter((g) => !g.apart);
const totalOf = (gs: BreakdownGroup[]) => sum(inTotal(gs).flatMap((g) => g.rows.map((r) => r.amount)));
const group = (gs: BreakdownGroup[], key: string) => {
  const g = gs.find((x) => x.key === key);
  assert.ok(g, `bölüm yok: ${key}`);
  return g;
};

/** Sayım karşılaştırması da olsun: espresso (alımı var), bardak (alımı yok), reçetesiz sos (iki ay sayıldı) */
const model = createModel({
  ...ds,
  stockCounts: [
    { month: "2026-08", ingredientId: ingId("Espresso çekirdeği"), qty: 10, factor: 1000 },
    { month: "2026-09", ingredientId: ingId("Espresso çekirdeği"), qty: 12.5, factor: 1000 },
    { month: "2026-08", ingredientId: ingId("Plastik bardak 12oz"), qty: 500, factor: 1 },
    { month: "2026-09", ingredientId: ingId("Plastik bardak 12oz"), qty: 1500, factor: 1 },
    { month: "2026-08", ingredientId: ingId("Callei waffle sos sütlü"), qty: 4, factor: 1000 },
    { month: "2026-09", ingredientId: ingId("Callei waffle sos sütlü"), qty: 2, factor: 1000 },
  ],
});
const c = consistency(model, MONTH);
const bd = consistencyBreakdowns(c, MONTH);

test("Büyük fark: kartın sayısı kadar malzeme; fark var ve tutarlı olanlar toplama girmeden altta", () => {
  // page.tsx ile aynı sayım
  const sev = c.rows.map((r) => severityOf(r));
  const bigCount = sev.filter((x) => x === "big").length;
  const diffCount = sev.filter((x) => x === "big" || x === "diff").length;
  const purchasedCount = c.rows.filter((r) => r.purchased !== null).length;
  assert.ok(purchasedCount > 0 && bigCount > 0, "Excel verisinde Eylül alımları var");
  assert.equal(totalOf(bd.severity), bigCount);
  assert.equal(group(bd.severity, "diff").rows.length, diffCount - bigCount);
  assert.equal(group(bd.severity, "ok").rows.length, purchasedCount - diffCount);
  assert.deepEqual(bd.severity.map((g) => [g.key, Boolean(g.apart)]), [["big", false], ["diff", true], ["ok", true]]);
  // Oran yazılı, en çok sapan önce; kullanılmadan alınan "Kullanım yok"
  const big = group(bd.severity, "big").rows;
  for (const r of big) assert.ok(r.display === "Kullanım yok" || /^[\d.,]+×$/.test(r.display ?? ""), `oran yazısı: ${r.display}`);
  const ratios = big.map((r) => c.rows.find((x) => `big:${x.ingredient.id}` === r.key)!).map((x) => x.ratio ?? Infinity);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => b - a), "büyükten küçüğe");
  assert.ok(big.every((r) => r.tone === "bad" && r.href?.startsWith(`/panel/tutarlilik?ay=${MONTH}&ara=`)));
  // Pencere verilen sırayı korur, toplam kartın sayısıdır
  const p = prepareBreakdown(bd.severity, { total: bigCount, order: "given" });
  assert.equal(p.total, bigCount);
  assert.deepEqual(p.groups.map((g) => g.key), bd.severity.filter((g) => g.rows.length).map((g) => g.key));
});

test("Fatura farkı: kalemler kartın toplamını tutar; fazla alınan artı, az alınan eksi bölümde", () => {
  close(totalOf(bd.diff), c.totalDiff, "fatura farkı");
  assert.ok(group(bd.diff, "fazla").rows.every((r) => r.amount > 0));
  assert.ok(group(bd.diff, "az").rows.every((r) => r.amount < 0));
  assert.equal(sum(bd.diff.map((g) => g.rows.length)), c.rows.filter((r) => r.diffAmount !== null && r.diffAmount !== 0).length);
  close(prepareBreakdown(bd.diff, { total: c.totalDiff }).base, c.totalDiff, "pencerenin toplamı");
  // Eksi kalem varsa pay sütunu kapanır
  assert.equal(hasNegative(bd.diff), group(bd.diff, "az").rows.length > 0);
  const espresso = group(bd.diff, "fazla").rows.concat(group(bd.diff, "az").rows).find((r) => r.label === "Espresso çekirdeği");
  assert.ok(espresso, "espressonun alımı var");
  assert.match(espresso.sub ?? "", /^Alınan .+ gr · reçeteye göre .+ gr · .+₺\/gr$/);
});

test("Sayım sapması: kalemler kartın toplamını tutar; alım girilmeli ve reçetesiz tüketim kartın alt satırıyla aynı", () => {
  assert.ok(c.hasStockComparison);
  close(totalOf(bd.variance), c.totalVariance, "sayım sapması");
  assert.equal(sum(inTotal(bd.variance).map((g) => g.rows.length)), c.rows.filter((r) => r.stock === "complete" && r.varianceAmount).length);
  const needs = group(bd.variance, "eksik");
  assert.ok(needs.apart);
  assert.equal(needs.rows.length, c.needsPurchaseCount);
  assert.equal(needs.display, `${c.needsPurchaseCount} malzeme`);
  assert.ok(needs.rows.some((r) => r.label === "Plastik bardak 12oz" && r.display === "Alım yok" && r.amount === 0));
  const unreciped = group(bd.variance, "recetesiz");
  assert.ok(unreciped.apart);
  assert.equal(unreciped.rows.length, c.unreciped.count);
  close(sum(unreciped.rows.map((r) => r.amount)), c.unreciped.amount, "reçetesiz tüketim");
  assert.ok(unreciped.rows.some((r) => r.label === "Callei waffle sos sütlü"));
  // Pencerede bilgi satırları (tutarı 0) kalır, toplama girmez
  const p = prepareBreakdown(bd.variance, { total: c.totalVariance });
  close(p.total, c.totalVariance, "toplam satırı");
  assert.equal(p.groups.find((g) => g.key === "eksik")?.rows.length, c.needsPurchaseCount);
  close(p.base, c.totalVariance, "payların paydası yalnızca sapma");
});

test("Sayım sapması: sayım yoksa döküm boş, yalnızca alım eksikse bilgi bölümü kalır", () => {
  const none = consistencyBreakdowns(consistency(createModel(ds), MONTH), MONTH);
  assert.equal(prepareBreakdown(none.variance).groups.length, 0);
  const onlyCup = consistency(
    createModel({
      ...ds,
      stockCounts: [
        { month: "2026-08", ingredientId: ingId("Plastik bardak 12oz"), qty: 500, factor: 1 },
        { month: "2026-09", ingredientId: ingId("Plastik bardak 12oz"), qty: 1500, factor: 1 },
      ],
    }),
    MONTH,
  );
  assert.equal(onlyCup.hasStockComparison, false);
  const p = prepareBreakdown(consistencyBreakdowns(onlyCup, MONTH).variance, { total: 0 });
  assert.deepEqual(p.groups.map((g) => g.key), ["eksik"]);
});

test("Satış ↔ POS: ürün listesi − indirim − POS = kartın farkı; POS yoksa 'Girilmedi', rapor yoksa boş", () => {
  const s = c.sales;
  assert.ok(s.hasLines && s.pos !== null && s.diff !== null);
  close(totalOf(bd.sales), s.diff, "satış farkı");
  close(sum(group(bd.sales, "hesap").rows.map((r) => r.amount)), s.computed, "hesaplanan ciro");
  assert.equal(group(bd.sales, "hesap").rows[0].href, `/panel/satislar?ay=${MONTH}#satirlar`);
  const off = group(bd.sales, "odenmez");
  assert.ok(off.apart && off.noSubtotal);
  close(off.rows[0].amount, s.offRevenue, "ödenmez");
  close(off.rows[1].amount, s.offRevenueCost, "ödenmez maliyeti");
  const p = prepareBreakdown(bd.sales, { total: s.diff, order: "given" });
  assert.deepEqual(p.groups.map((g) => g.key), ["hesap", "pos", "odenmez"]);

  const noPos = consistencyBreakdowns({ rows: [], sales: { ...s, pos: null, diff: null, ok: false } }, MONTH).sales;
  const posRow = group(noPos, "pos").rows[0];
  assert.equal(posRow.display, "Girilmedi");
  assert.equal(posRow.tone, "warn");
  assert.ok(group(noPos, "pos").noSubtotal);
  assert.deepEqual(consistencyBreakdowns({ rows: [], sales: { ...s, hasLines: false } }, MONTH).sales, []);
});

test("Tablo bağlantısı: ay ve malzeme adı adreste, tabloya kayar", () => {
  assert.equal(tableHref("2026-09", "Süt %2,5"), "/panel/tutarlilik?ay=2026-09&ara=S%C3%BCt%20%252%2C5#malzeme-tablosu");
});

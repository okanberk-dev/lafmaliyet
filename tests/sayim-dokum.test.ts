// Sayım sayfasındaki "Toplam stok (KDV hariç)" kartının dökümü: grup grup malzemeler, ek kalemler, fiyatı
// olmayanlar ayrı. Döküm her zaman kartın rakamını (liveTotals) tutmalı.
// Çalıştırma: npx tsx --test tests/sayim-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { lineUnit, stockBreakdown, type StockBreakdownLine } from "../src/app/panel/sayim/breakdowns";
import { liveTotals, type CountLineValue } from "../src/app/panel/sayim/logic";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import { countFactor, createModel, type Model } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const data: SeedData = JSON.parse(readFileSync(join(__dirname, "..", "tests/fixtures/baslangic/veri.json"), "utf8"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupsSum = (gs: BreakdownGroup[]) => sum(gs.filter((g) => !g.apart).flatMap((g) => g.rows.map((r) => r.amount)));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** sayim/page.tsx ile aynı eşleme (yönetici): StockSheet → formun satırları */
function formGroups(model: Model, month: string) {
  const sheet = model.stockSheet(month);
  return sheet.groups.map((g) => ({
    name: g.name,
    lines: g.lines.map(
      (l): StockBreakdownLine => ({
        id: l.ingredient.id,
        name: l.ingredient.name,
        countUnit: l.countUnit,
        unitNow: l.ingredient.countUnit,
        qty: l.qty,
        unitPrice: l.unitPrice,
        unitPriceNow: (model.unitCost.get(l.ingredient.id) ?? 0) * countFactor(l.ingredient.countUnit),
        vatRate: l.ingredient.vatRate,
        archived: l.archived,
      }),
    ),
  }));
}
const saved = (l: CountLineValue) => l.qty;

test("Sayım dökümü: grup grup, kartın rakamını (engine.stockSheet ve liveTotals) tutar (Excel verisi)", () => {
  // Her sayılabilir kalemden 2, bir ek kalem fiyatlı, biri fiyatsız
  const counts = ds.ingredients.filter((i) => i.countUnit && i.active).map((i) => ({ month: "2026-09", ingredientId: i.id, qty: 2, factor: countFactor(i.countUnit) }));
  const model = createModel({
    ...ds,
    stockCounts: counts,
    stockExtras: [
      { id: 1, month: "2026-09", name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 12.5 },
      { id: 2, month: "2026-09", name: "Islak mendil", unit: "KUTU", qty: 4, unitPrice: 0 },
    ],
  });
  const sheet = model.stockSheet("2026-09");
  const groups = formGroups(model, "2026-09");
  const extras = sheet.extras.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, unitPrice: e.unitPrice }));
  const live = liveTotals(groups, saved, extras);
  const b = stockBreakdown(groups, saved, extras);
  assert.ok(live.total > 0);
  close(groupsSum(b), live.total);
  close(groupsSum(b), sheet.total);
  close(prepareBreakdown(b, { total: live.total }).base, live.total);

  // Her grup kendi toplamını tutar; ek kalemler ayrı bölüm (37,5 ₺)
  sheet.groups.forEach((g) => {
    const got = b.find((x) => x.label === g.name);
    assert.ok(got, `grup yok: ${g.name}`);
    close(sum(got.rows.map((r) => r.amount)), g.total);
  });
  const ek = b.find((g) => g.key === "ek")!;
  assert.deepEqual(ek.rows.map((r) => [r.label, r.amount, r.sub]), [["Peçete", 37.5, "3 PAKET × 12,50 ₺"]]);

  // Fiyatsız ek kalem toplama girmeyen bölümde, yazılı değerle
  const fiyatsiz = b.find((g) => g.key === "fiyatsiz")!;
  assert.equal(fiyatsiz.apart, true);
  assert.equal(fiyatsiz.noSubtotal, true);
  const mendil = fiyatsiz.rows.find((r) => r.label === "Islak mendil");
  assert.ok(mendil);
  assert.equal(mendil.display, "Fiyat yok");
  assert.equal(mendil.amount, 0);
  // Fiyatı olmayan malzemeler (varsa) Hammaddeler'e gider
  for (const r of fiyatsiz.rows.filter((x) => x.key.startsWith("l"))) assert.match(r.href ?? "", /^\/panel\/hammaddeler\?ara=/);
});

test("Sayım dökümü: formda değişen miktar bugünkü birimle; arşiv satırı kayıtlı miktarla; boş ve sıfır düşer", () => {
  const line = (p: Partial<StockBreakdownLine> & Pick<StockBreakdownLine, "id" | "name">): StockBreakdownLine => ({
    countUnit: "KG",
    unitNow: "KG",
    qty: null,
    unitPrice: 100,
    unitPriceNow: 100,
    vatRate: 0.01,
    archived: false,
    ...p,
  });
  const groups = [
    {
      name: "Kahve",
      lines: [
        // Kayıtlı 2 KG, formda 3 yazıldı; birimi bugün ADET (gram): yeni miktar bugünkü fiyatla
        line({ id: 1, name: "Espresso", qty: 2, countUnit: "KG", unitNow: "ADET", unitPrice: 800, unitPriceNow: 0.8 }),
        // Arşivde: formdaki değer yok sayılır, kayıtlı miktar ve fiyat
        line({ id: 2, name: "Eski çekirdek", qty: 1.5, unitPrice: 600, archived: true }),
        line({ id: 3, name: "Boş", qty: null }),
        line({ id: 4, name: "Sıfır", qty: 0 }),
      ],
    },
    { name: "Süt", lines: [line({ id: 5, name: "Süt", qty: 10, countUnit: "LT", unitNow: "LT", unitPrice: 30, unitPriceNow: 32 })] },
  ];
  const typed: Record<number, number | null> = { 1: 3000, 2: 99, 3: null, 4: 0, 5: 10 };
  const valueOf = (l: CountLineValue) => typed[l.id];
  const extras = [
    { name: "  ", unit: "", qty: 2, unitPrice: 5 },
    { name: "Boş satır", unit: "ADET", qty: null, unitPrice: null },
  ];
  const b = stockBreakdown(groups, valueOf, extras);
  const live = liveTotals(groups, valueOf, extras);
  close(groupsSum(b), live.total);
  close(live.total, 3000 * 0.8 + 1.5 * 600 + 10 * 30 + 2 * 5);

  const kahve = b.find((g) => g.label === "Kahve")!;
  assert.deepEqual(
    kahve.rows.map((r) => [r.label, r.amount, r.sub]),
    [
      ["Espresso", 2400, "3.000 ADET × 0,80 ₺"],
      ["Eski çekirdek", 900, "1,5 KG × 600,00 ₺ · arşiv kalemi"],
    ],
  );
  // Değişmeyen miktar kayıtlı fiyatla (30 ₺/LT, bugünkü 32 değil)
  assert.deepEqual(b.find((g) => g.label === "Süt")!.rows.map((r) => r.amount), [300]);
  // Adı yazılmamış ek kalem de toplamda: dökümde adıyla görünsün
  assert.deepEqual(b.find((g) => g.key === "ek")!.rows.map((r) => [r.label, r.sub]), [["Adı yazılmamış kalem", "2 ADET × 5,00 ₺"]]);
  assert.equal(b.find((g) => g.key === "fiyatsiz")!.rows.length, 0);

  assert.equal(lineUnit(groups[0].lines[0], 2), "KG", "kayıtlı miktar: sayıldığı birim");
  assert.equal(lineUnit(groups[0].lines[0], 3000), "ADET", "değişen miktar: bugünkü birim");
  assert.equal(lineUnit({ ...groups[0].lines[0], unitNow: null }, 3000), "KG", "Sayılmaz yapılmış: kayıtlı birim");
});

test("Sayım dökümü: hiç sayım yoksa boş (pencere 'kalem yok' der)", () => {
  const model = createModel(ds);
  const groups = formGroups(model, "2026-09");
  const b = stockBreakdown(groups, saved, []);
  assert.equal(groupsSum(b), 0);
  assert.equal(prepareBreakdown(b).groups.length, 0);
});

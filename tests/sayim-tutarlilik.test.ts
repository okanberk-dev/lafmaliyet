// Stok sayımı ve tutarlılık ekranlarının saf hesapları: formdaki canlı stok toplamı (engine.stockSheet ile aynı),
// personelin ek kalem kaydı, varsayılan sayım ayı, tutarlılık tablosunun kapsamı ve alt toplamı.
// Çalıştırma: npx tsx --test tests/sayim-tutarlilik.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { counterLine, defaultCountMonth, extraKey, linePrice, liveTotals, planStaffExtras, todayTR, type CountLineValue, type SavedExtra } from "../src/app/panel/sayim/logic";
import { RATIO_GUIDE, scopeTotals, severityOf, tableScope } from "../src/app/panel/tutarlilik/severity";
import { countFactor, createModel, type Model } from "../src/lib/calc/engine";
import { consistency, stockVatSummary } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const ingId = (name: string) => {
  const i = ds.ingredients.find((x) => x.name === name);
  assert.ok(i, `hammadde yok: ${name}`);
  return i.id;
};

function close(actual: number | null | undefined, expected: number, label: string, tol = 1e-9) {
  assert.ok(actual !== null && actual !== undefined, `${label}: değer yok`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol * Math.max(1, Math.abs(expected)), `${label}: beklenen ${expected}, bulunan ${actual} (fark ${diff})`);
}

/** sayim/page.tsx ile aynı eşleme: StockSheet → formun satırları */
function formGroups(model: Model, month: string) {
  const sheet = model.stockSheet(month);
  const vat = stockVatSummary(sheet);
  return sheet.groups.map((g, gi) => ({
    name: g.name,
    excelRate: vat.groups[gi].excelRate,
    lines: g.lines.map(
      (l): CountLineValue => ({
        id: l.ingredient.id,
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

// ---------------------------------------------------------------- Canlı stok toplamı

test("Sayım formu: değişiklik yokken canlı toplam engine.stockSheet ile aynı (KDV hariç, KDV dahil, Excel usulü)", () => {
  // Her sayılabilir kalemden 1, ek kalem 3 × 12,5
  const counts = ds.ingredients.filter((i) => i.countUnit && i.active).map((i) => ({ month: "2026-09", ingredientId: i.id, qty: 1, factor: countFactor(i.countUnit) }));
  const model = createModel({ ...ds, stockCounts: counts, stockExtras: [{ id: 1, month: "2026-09", name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 12.5 }] });
  const sheet = model.stockSheet("2026-09");
  const live = liveTotals(formGroups(model, "2026-09"), saved, sheet.extras.map((e) => ({ qty: e.qty, unitPrice: e.unitPrice })));
  close(live.total, sheet.total, "KDV hariç");
  close(live.totalVat, sheet.totalVatIncl, "KDV dahil");
  close(live.extrasTotal, 37.5, "ek kalemler");
  close(live.totalVatExcel, stockVatSummary(sheet).excelTotalVatIncl, "Excel grup oranıyla KDV dahil");
  sheet.groups.forEach((g, i) => close(live.groups[i].total, g.total, `${g.name} grup toplamı`));
  // Yalnızca Yenilebilir bardak (%10, grup %20) Excel usulünden ayrılır
  assert.ok(live.totalVatExcel > live.totalVat);
});

test("Sayım formu: Excel'in Eylül verisinde sayım yok, toplam 0 (Excel Sayım boş)", () => {
  const model = createModel(ds);
  const sheet = model.stockSheet("2026-09");
  const live = liveTotals(formGroups(model, "2026-09"), saved, []);
  assert.equal(sheet.total, 0);
  assert.equal(live.total, 0);
  // Excel'in kâr-zararı sayımdan etkilenmez: Eylül SMM golden ile aynı
  close(model.pnlMonth("2026-09").cogs, golden.pnl["2026-09"].cogs, "Eylül SMM", 1e-6);
});

test("Sayım formu: pasif yapılan malzemenin kayıtlı sayımı toplamda kalır, birimi değişende eski miktar eski fiyatla", () => {
  const esp = ingId("Espresso çekirdeği");
  const counts = [{ month: "2026-09", ingredientId: esp, qty: 12.5, factor: 1000 }];
  const before = createModel({ ...ds, stockCounts: counts });
  const total = before.stockSheet("2026-09").total;
  assert.ok(total > 0);

  // Pasif: satır arşivde, değer aynı; formda yazılan değer yok sayılır
  const inactive = createModel({ ...ds, stockCounts: counts, ingredients: ds.ingredients.map((i) => (i.id === esp ? { ...i, active: false } : i)) });
  const g = formGroups(inactive, "2026-09");
  const line = g.flatMap((x) => x.lines).find((l) => l.id === esp)!;
  assert.equal(line.archived, true);
  close(liveTotals(g, (l) => (l.id === esp ? 999 : l.qty), []).total, total, "arşiv satırı değiştirilemez");

  // Birim KG → ADET: kayıtlı 12,5 aynı kaldıkça KG fiyatı; değişen miktar ADET (gram) fiyatıyla
  const adet = createModel({ ...ds, stockCounts: counts, ingredients: ds.ingredients.map((i) => (i.id === esp ? { ...i, countUnit: "ADET" as const } : i)) });
  const ga = formGroups(adet, "2026-09");
  const la = ga.flatMap((x) => x.lines).find((l) => l.id === esp)!;
  close(liveTotals(ga, saved, []).total, total, "değişmeyen miktar eski birimle");
  close(linePrice(la, 12.5), la.unitPrice, "kayıtlı miktar: eski fiyat");
  close(linePrice(la, 13), la.unitPriceNow, "yeni miktar: bugünkü birim fiyatı");
  close(la.unitPrice / la.unitPriceNow, 1000, "KG fiyatı = 1000 × gram fiyatı");
  close(
    liveTotals(ga, (l) => (l.id === esp ? 13 : l.qty), []).total,
    13 * la.unitPriceNow,
    "değişen miktar bugünkü birimle (sunucunun kaydedeceği değer)",
  );
});

// ---------------------------------------------------------------- Varsayılan sayım ayı

test("Sayım sayfası adreste ay yokken: ayın ilk 10 gününde geçen ay sayılmadıysa geçen ay, yoksa bu ay (Türkiye saati)", () => {
  const none = () => false;
  const all = () => true;
  assert.equal(defaultCountMonth(new Date("2026-10-05T09:00:00Z"), none), "2026-09");
  assert.equal(defaultCountMonth(new Date("2026-10-05T09:00:00Z"), all), "2026-10");
  assert.equal(defaultCountMonth(new Date("2026-10-20T09:00:00Z"), none), "2026-10");
  assert.equal(defaultCountMonth(new Date("2026-10-10T20:00:00Z"), none), "2026-09", "10. gün dahil");
  assert.equal(defaultCountMonth(new Date("2026-10-31T20:59:00Z"), none), "2026-10", "31 Ekim 23:59 TR");
  // 30 Eylül 22:30 UTC = 1 Ekim 01:30 İstanbul
  assert.equal(todayTR(new Date("2026-09-30T22:30:00Z")), "2026-10-01");
  assert.equal(defaultCountMonth(new Date("2026-09-30T22:30:00Z"), (m) => m !== "2026-09"), "2026-09");
  assert.equal(defaultCountMonth(new Date("2027-01-03T08:00:00Z"), none), "2026-12", "yıl dönümü");
});

// ---------------------------------------------------------------- Listede olmayanlar (personel)

const ex = (id: number, month: string, name: string, unit: string, qty: number, unitPrice: number): SavedExtra => ({ id, month, name, unit, qty, unitPrice });

test("Personel ek kalemleri: miktar güncellenir, fiyat korunur; yeni kalemin fiyatı son aydan gelir", () => {
  const existing = [ex(10, "2026-10", "Peçete", "PAKET", 3, 12.5), ex(11, "2026-10", "Sünger", "ADET", 2, 0)];
  const history = [ex(1, "2026-08", "Deterjan", "ŞİŞE", 1, 80), ex(2, "2026-09", "deterjan ", "şişe", 2, 95), ex(3, "2026-09", "Eldiven", "KUTU", 1, 0)];
  const res = planStaffExtras(
    existing,
    [
      { name: " peçete", unit: "paket", qty: 5 },
      { name: "Sünger", unit: "ADET", qty: 2 },
      { name: "Deterjan", unit: "ŞİŞE", qty: 1 },
      { name: "Eldiven", unit: "KUTU", qty: 4 },
    ],
    history,
  );
  assert.ok(res.ok);
  assert.deepEqual(res.plan.updates, [{ id: 10, qty: 5 }], "Peçete adı büyük-küçük harf / boşluktan bağımsız eşleşir");
  assert.deepEqual(res.plan.deletes, []);
  assert.deepEqual(res.plan.inserts, [
    { name: "Deterjan", unit: "ŞİŞE", qty: 1, unitPrice: 95 },
    { name: "Eldiven", unit: "KUTU", qty: 4, unitPrice: 0 },
  ]);
  assert.equal(extraKey(" peçete ", "paket"), extraKey("Peçete", "PAKET"));
});

test("Personel ek kalemleri: fiyatsız satırı silebilir, fiyatlı satırı silemez, aynı kalemi iki kez yazamaz", () => {
  const existing = [ex(10, "2026-10", "Peçete", "PAKET", 3, 12.5), ex(11, "2026-10", "Sünger", "ADET", 2, 0)];
  const keepPriced = planStaffExtras(existing, [{ name: "Peçete", unit: "PAKET", qty: 0 }], []);
  assert.ok(keepPriced.ok);
  assert.deepEqual(keepPriced.plan.deletes, [11]);
  assert.deepEqual(keepPriced.plan.updates, [{ id: 10, qty: 0 }]);

  const dropPriced = planStaffExtras(existing, [{ name: "Sünger", unit: "ADET", qty: 2 }], []);
  assert.equal(dropPriced.ok, false);
  if (!dropPriced.ok) assert.match(dropPriced.error, /Peçete.*yalnızca yönetici/);

  // Fiyatlı satırın adını değiştirmek = silmek: reddedilir
  assert.equal(planStaffExtras(existing, [{ name: "Peçete büyük", unit: "PAKET", qty: 3 }, { name: "Sünger", unit: "ADET", qty: 2 }], []).ok, false);

  const dup = planStaffExtras([], [{ name: "Peçete", unit: "PAKET", qty: 1 }, { name: "peçete", unit: "paket", qty: 2 }], []);
  assert.equal(dup.ok, false);
});

test("Sayan ve son kayıt satırı", () => {
  assert.equal(counterLine([]), null);
  const line = counterLine([
    { by: "Ayşe", last: new Date("2026-10-01T06:12:00Z") },
    { by: "Mehmet", last: new Date("2026-10-01T07:30:00Z") },
  ]);
  assert.ok(line?.startsWith("Sayanlar: Mehmet, Ayşe · son kayıt 01.10.2026"), line ?? "");
  assert.ok(line?.includes("10:30"), "İstanbul saati");
  assert.equal(counterLine([{ by: null, last: "2026-10-01T07:30:00Z" }])?.startsWith("son kayıt"), true);
});

// ---------------------------------------------------------------- Tutarlılık tablosu

test("Tutarlılık tablosu: varsayılan kapsam alımı girilen + iki ayı sayılan malzemeler; alt toplam Stat ile aynı", () => {
  const m = createModel({
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
  const c = consistency(m, "2026-09");
  const { scope, focus, hidden } = tableScope(c.rows, false);
  assert.equal(scope, focus);
  const names = new Set(scope.map((r) => r.ingredient.name));
  for (const n of ["Espresso çekirdeği", "Plastik bardak 12oz", "Callei waffle sos sütlü"]) assert.ok(names.has(n), `${n} varsayılan görünümde`);
  assert.equal(hidden, c.rows.filter((r) => r.purchased === null && r.stock === "noCount").length);
  assert.equal(tableScope(c.rows, true).scope.length, c.rows.length);
  // Varsayılan alt toplam = sayfadaki "Sayım sapması" ve "Fatura farkı"
  const t = scopeTotals(scope);
  close(t.variance, c.totalVariance, "sapma");
  close(t.diff, c.totalDiff, "fark");
  close(c.totalDiff, golden.consistency.totalDiff, "Excel toplam fark");
  // Alım girilmemiş satır sapmaya girmez, 0 alım girilince girer
  const cup = c.rows.find((r) => r.ingredient.name === "Plastik bardak 12oz")!;
  assert.equal(cup.stock, "needsPurchase");
  assert.equal(severityOf(cup), "none");
  const withZero = consistency(
    createModel({ ...m.ds, purchaseQuantities: [...m.ds.purchaseQuantities, { month: "2026-09", ingredientId: cup.ingredient.id, qty: 0, note: null }] }),
    "2026-09",
  );
  const cup0 = withZero.rows.find((r) => r.ingredient.id === cup.ingredient.id)!;
  assert.equal(cup0.stock, "complete");
  close(cup0.actualUsage, 500 - 1500, "0 alımla gerçek tüketim (stok arttı: eksik alım faturası olabilir)");
  close(scopeTotals(tableScope(withZero.rows, false).scope).variance, withZero.totalVariance, "0 alımdan sonra da aynı");
});

test("Tutarlılık rehberi: Excel E14 notundaki iki cümle", () => {
  assert.match(RATIO_GUIDE.below1, /1×'in altı/);
  assert.match(RATIO_GUIDE.fastMovers, /espresso, süt, dondurma, tatlılar, şişe su/);
});

// Stok sayımı ve tutarlılık ekranlarının saf hesapları: formdaki canlı stok toplamı (engine.stockSheet ile aynı),
// personelin ek kalem kaydı, varsayılan sayım ayı, tutarlılık tablosunun kapsamı ve alt toplamı.
// Çalıştırma: npx tsx --test tests/sayim-tutarlilik.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { counterLine, countComplete, countStatus, defaultCountMonth, extraKey, linePrice, liveTotals, planStaffExtras, todayTR, type CountLineValue, type SavedExtra } from "../src/app/panel/sayim/logic";
import { RATIO_GUIDE, scopeTotals, severityOf, tableScope } from "../src/app/panel/tutarlilik/severity";
import { countFactor, createModel, type Model } from "../src/lib/calc/engine";
import { consistency, stockVatSummary } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import { MANAGED_QTY_NOTE, NO_PURCHASE_NOTE } from "../src/lib/purchase-notes";

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

  // Pasif ve onu kullanan ürünler de emekli: satır arşivde, değer aynı; formda yazılan değer yok sayılır. (Aktif ürünlerin
  // reçetesinde kalsaydı listede kalır, sayılırdı: denetim E-04, tests/sayim-deger.test.ts)
  const users = new Set(ds.recipeItems.filter((r) => r.ingredientId === esp).map((r) => r.productId));
  const passiveIngs = ds.ingredients.map((i) => (i.id === esp ? { ...i, active: false } : i));
  const stillUsed = createModel({ ...ds, stockCounts: counts, ingredients: passiveIngs });
  assert.equal(formGroups(stillUsed, "2026-09").flatMap((x) => x.lines).find((l) => l.id === esp)!.archived, false, "aktif reçetede: sayılır");
  const inactive = createModel({ ...ds, stockCounts: counts, ingredients: passiveIngs, products: ds.products.map((p) => (users.has(p.id) ? { ...p, active: false } : p)) });
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

test("Sayım ay sonunda geçerli fiyatla değerlenir: sonraki zam kapanmış ayın devreden malını ve kârını değiştirmez", () => {
  const coffee = ingId("Espresso çekirdeği");
  const milk = ingId("Süt %2,5");
  const base = ds.ingredients.find((i) => i.id === coffee)!;
  const milkBase = ds.ingredients.find((i) => i.id === milk)!;
  const counts = [
    { month: "2026-09", ingredientId: coffee, qty: 40, factor: 1000 },
    { month: "2026-09", ingredientId: milk, qty: 60, factor: 1000 },
    { month: "2026-10", ingredientId: coffee, qty: 30, factor: 1000 },
  ];
  // Excel aktarımı 17 Ekim'de (Eylül'den sonra) fiyat geçmişine yazıldı: Eylül bilinen ilk fiyatla değerlenir
  const excelRows = [coffee, milk].map((id) => {
    const i = ds.ingredients.find((x) => x.id === id)!;
    return { ingredientId: id, packagePrice: i.packagePrice, packageSize: i.packageSize, changedAt: "2026-10-17T09:00:00.000Z" };
  });
  const before = createModel({ ...ds, stockCounts: counts, ingredientPrices: excelRows });
  const sepBefore = before.pnlMonth("2026-09");
  // 20 Ekim'de iki fiyat da %25 arttı (Paraşüt faturası): bugünkü fiyat ve geçmiş satırı
  const raised = [base, milkBase].map((i) => ({ ingredientId: i.id, packagePrice: i.packagePrice * 1.25, packageSize: i.packageSize, changedAt: "2026-10-20T05:00:00.000Z" }));
  const after = createModel({
    ...ds,
    ingredients: ds.ingredients.map((i) => (i.id === coffee || i.id === milk ? { ...i, packagePrice: i.packagePrice * 1.25 } : i)),
    stockCounts: counts,
    ingredientPrices: [...excelRows, ...raised],
  });
  const sepAfter = after.pnlMonth("2026-09");
  close(sepAfter.closing, sepBefore.closing, "Eylül devreden mal aynı");
  close(sepAfter.cogs, sepBefore.cogs, "Eylül mal maliyeti aynı");
  close(sepAfter.profit, sepBefore.profit, "Eylül kârı aynı");
  close(sepBefore.closing, 40 * (base.packagePrice / base.packageSize) * 1000 + 60 * (milkBase.packagePrice / milkBase.packageSize) * 1000, "Eylül eski fiyatla");
  // Ekim'in açılışı Eylül'ün kapanışı; Ekim'in kendi sayımı (süren ay) bugünkü fiyatla
  close(after.pnlMonth("2026-10").opening, sepAfter.closing, "Ekim devir");
  close(after.stockSheet("2026-10").total, 30 * (base.packagePrice * 1.25 / base.packageSize) * 1000, "Ekim yeni fiyatla");
  // Ay içindeki değişiklik o ayın sonunda geçerlidir: 15 Eylül'de değişen fiyat Eylül'ü değerler
  const midSep = createModel({
    ...ds,
    stockCounts: counts,
    ingredientPrices: [
      { ingredientId: coffee, packagePrice: base.packagePrice * 0.8, packageSize: base.packageSize, changedAt: "2026-07-01T09:00:00.000Z" },
      { ingredientId: coffee, packagePrice: base.packagePrice * 0.9, packageSize: base.packageSize, changedAt: "2026-09-15T09:00:00.000Z" },
      { ingredientId: coffee, packagePrice: base.packagePrice, packageSize: base.packageSize, changedAt: "2026-10-01T06:00:00.000Z" },
    ],
  });
  close(midSep.unitCostAtMonthEnd(coffee, "2026-09"), (base.packagePrice * 0.9) / base.packageSize, "15 Eylül fiyatı");
  close(midSep.unitCostAtMonthEnd(coffee, "2026-08"), (base.packagePrice * 0.8) / base.packageSize, "Ağustos'ta Temmuz fiyatı");
  // 1 Ekim 09:00 (Türkiye) değişikliği Eylül'e girmez; sonrasında değişiklik yoksa bugünkü fiyat
  close(midSep.unitCostAtMonthEnd(coffee, "2026-10"), base.packagePrice / base.packageSize, "Ekim bugünkü");
  // Geçmişi olmayan malzeme ve fiyat geçmişi hiç verilmezse bugünkü fiyat (eski davranış)
  close(createModel({ ...ds, stockCounts: counts }).stockSheet("2026-09").total, sepBefore.closing, "geçmişsiz");
});

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
  // Gün kasanın iş günü (05:00'te döner): 31 Ekim 23:50'de başlayan sayım 1 Kasım 00:10'da da Ekim
  const octPartial = (m: string) => m !== "2026-10";
  assert.equal(defaultCountMonth(new Date("2026-10-31T21:10:00Z"), (m) => m === "2026-10"), "2026-10", "1 Kasım 00:10 TR");
  assert.equal(defaultCountMonth(new Date("2026-10-31T21:10:00Z"), octPartial), "2026-10");
  // 3 Kasım: Ekim yarım (tamam değil) → Ekim açılır; 11 Kasım 09:00'da Kasım
  assert.equal(defaultCountMonth(new Date("2026-11-03T06:00:00Z"), octPartial), "2026-10");
  assert.equal(defaultCountMonth(new Date("2026-11-11T06:00:00Z"), octPartial), "2026-11");
  // 11 Kasım 03:00 TR hâlâ 10 Kasım iş günü
  assert.equal(defaultCountMonth(new Date("2026-11-11T00:00:00Z"), octPartial), "2026-10");
});

test("Sayım tamam mı: listelenen, arşivsiz her kalem sayıldı (countStatus tek kural)", () => {
  const line = (qty: number | null, archived = false) => ({ qty, archived });
  assert.deepEqual(countStatus({ groups: [{ lines: [line(1), line(null)] }, { lines: [line(2)] }] }), { counted: 2, total: 3, complete: false });
  assert.deepEqual(countStatus({ groups: [{ lines: [line(1), line(0)] }, { lines: [line(2), line(null, true)] }] }), { counted: 3, total: 3, complete: true }, "arşiv satırı sayılmaz, 0 sayılmıştır");
  assert.deepEqual(countStatus({ groups: [] }), { counted: 0, total: 0, complete: false }, "boş liste tamam değil");
  assert.equal(countComplete({ groups: [{ lines: [line(5)] }] }), true);
  // Gerçek sayım listesinde: tek satır kaydedilmiş ay tamam değil (hasData true olsa da)
  const sep = createModel({ ...ds, stockCounts: [{ month: "2026-09", ingredientId: ingId("Espresso çekirdeği"), qty: 5, factor: 1000 }] }).stockSheet("2026-09");
  assert.equal(sep.hasData, true);
  const st = countStatus(sep);
  assert.equal(st.counted, 1);
  assert.ok(st.total > 1);
  assert.equal(st.complete, false);
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

test("Tutarlılık (E-27): faturası olmayan bağlı malzemeye 0 yazılınca sapma tam; çarpanı onay bekleyen fatura sapmayı bekletir", () => {
  const cup = ingId("Plastik bardak 12oz");
  const coffee = ingId("Espresso çekirdeği");
  const counts = [
    { month: "2026-08", ingredientId: cup, qty: 1500, factor: 1 },
    { month: "2026-09", ingredientId: cup, qty: 500, factor: 1 },
    { month: "2026-08", ingredientId: coffee, qty: 10, factor: 1000 },
    { month: "2026-09", ingredientId: coffee, qty: 12.5, factor: 1000 },
  ];
  const base = { ...ds, stockCounts: counts, purchaseQuantities: ds.purchaseQuantities.filter((p) => p.ingredientId !== cup || p.month !== "2026-09") };
  // Faturası yok: "Alım girilmeli"; "Alım yok (0)" satırıyla tamam ve sapma tam (devir − devreden − reçeteye göre)
  const before = consistency(createModel(base), "2026-09").rows.find((r) => r.ingredient.id === cup)!;
  assert.equal(before.stock, "needsPurchase");
  assert.equal(before.held, null);
  const zero = consistency(createModel({ ...base, purchaseQuantities: [...base.purchaseQuantities, { month: "2026-09", ingredientId: cup, qty: 0, note: "Bu ay alım yok" }] }), "2026-09");
  const z = zero.rows.find((r) => r.ingredient.id === cup)!;
  assert.deepEqual([z.stock, z.purchased], ["complete", 0]);
  close(z.actualUsage, 1500 - 500, "0 alımla gerçek tüketim");
  close(z.variance, 1000 - z.usage, "sapma tam");
  assert.ok(zero.rows.filter((r) => r.stock === "complete").some((r) => r.ingredient.id === cup));
  assert.equal(zero.heldCount, 0);

  // Kahvenin Eylül faturasının çarpanı onay bekliyor: o fatura alınana girmedi (eşitleme dışladı), alınan eksik.
  // Satır "held": oran, fark ve sapma yok, toplamlara girmez; derece verilmez; varsayılan kapsamda görünür. Kahvenin
  // Eylül alımı eşitlemenin yazdığı satır (elle yazılan alım işareti kaldırır, aşağıda)
  const managed = base.purchaseQuantities.map((p) => (p.ingredientId === coffee && p.month === "2026-09" ? { ...p, note: MANAGED_QTY_NOTE } : p));
  const heldDs = {
    ...base,
    purchaseQuantities: managed,
    heldPurchases: [
      { month: "2026-09", ingredientId: coffee, invoices: 1, rejected: 0 },
      { month: "2026-08", ingredientId: cup, invoices: 2, rejected: 0 },
    ],
  };
  const h = consistency(createModel(heldDs), "2026-09");
  const k = h.rows.find((r) => r.ingredient.id === coffee)!;
  assert.deepEqual([k.stock, k.held, k.rejected, k.ratio, k.diffAmount, k.actualUsage, k.variance, k.varianceAmount], ["held", { invoices: 1 }, null, null, null, null, null, null]);
  assert.equal(severityOf(k), "none");
  assert.equal(h.heldCount, 1, "yalnız bu ayın onay bekleyeni");
  assert.equal(h.rejectedCount, 0);
  assert.ok(tableScope(h.rows, false).scope.includes(k));
  const plain = consistency(createModel(base), "2026-09");
  const kPlain = plain.rows.find((r) => r.ingredient.id === coffee)!;
  close(h.totalVariance, plain.totalVariance - (kPlain.varianceAmount ?? 0), "sapma toplamı onay bekleyeni saymaz");
  close(h.totalDiff, plain.totalDiff - (kPlain.diffAmount ?? 0), "fark toplamı onay bekleyeni saymaz");
  // Alımı hiç olmayan ama faturası onay bekleyen malzeme de listelenir (alım girilmeli değil, onay bekliyor)
  const other = ds.ingredients.find(
    (i) => i.active && i.priceSource === "manual" && !counts.some((c) => c.ingredientId === i.id) && !base.purchaseQuantities.some((p) => p.ingredientId === i.id && p.month === "2026-09"),
  )!;
  assert.ok(other, "alımı olmayan malzeme");
  const onlyHeld = consistency(createModel({ ...heldDs, heldPurchases: [{ month: "2026-09", ingredientId: other.id, invoices: 1, rejected: 0 }] }), "2026-09").rows.find(
    (r) => r.ingredient.id === other.id,
  )!;
  assert.deepEqual([onlyHeld.stock, onlyHeld.purchased, onlyHeld.held], ["noCount", null, { invoices: 1 }]);
  assert.ok(tableScope([onlyHeld], false).focus.length === 1, "varsayılan kapsamda");

  // Elle yazılan alım (ör. Excel'den gelen, notu sahibin) ayın alımıdır: bekleyen onay sapmayı bekletmez (denetim B03)
  const manualHeld = consistency(createModel({ ...heldDs, purchaseQuantities: base.purchaseQuantities }), "2026-09");
  const km = manualHeld.rows.find((r) => r.ingredient.id === coffee)!;
  assert.deepEqual([km.stock, km.held, km.rejected], ["complete", null, null]);
  assert.equal(typeof km.variance, "number");
  close(km.variance, kPlain.variance ?? NaN, "elle yazılan alımla sapma");
  assert.equal(manualHeld.heldCount, 0, "üst karttaki onay sayısına girmez");
  close(manualHeld.totalVariance, plain.totalVariance, "toplama girer");
});

test("Tutarlılık (denetim B03): fiyatı reddedilen fatura onaya götürmez, alımı elle yazdırır; elle yazılan alımla sapma hesaplanır", () => {
  const coffee = ingId("Espresso çekirdeği");
  const counts = [
    { month: "2026-08", ingredientId: coffee, qty: 10, factor: 1000 },
    { month: "2026-09", ingredientId: coffee, qty: 12.5, factor: 1000 },
  ];
  // Eşitleme Eylül'ün normal faturasını yazdı; pahalı faturanın fiyatı reddedildi, o fatura alınana girmedi
  const managed = ds.purchaseQuantities.map((p) => (p.ingredientId === coffee && p.month === "2026-09" ? { ...p, qty: 30000, note: MANAGED_QTY_NOTE } : p));
  const rejectedDs = { ...ds, stockCounts: counts, purchaseQuantities: managed, heldPurchases: [{ month: "2026-09", ingredientId: coffee, invoices: 0, rejected: 1 }] };
  const c = consistency(createModel(rejectedDs), "2026-09");
  const k = c.rows.find((r) => r.ingredient.id === coffee)!;
  assert.deepEqual([k.stock, k.held, k.rejected, k.purchased, k.actualUsage, k.variance, k.ratio, k.diffAmount], ["rejected", null, { invoices: 1 }, 30000, null, null, null, null]);
  assert.equal(c.heldCount, 0, "onay bekleyen yok: onaya götürmez");
  assert.equal(c.rejectedCount, 1);
  assert.equal(severityOf(k), "none");
  assert.ok(tableScope(c.rows, false).focus.includes(k), "varsayılan kapsamda");
  assert.equal(c.needsPurchaseCount, 0, "toplu “Alım yok (0)”a girmez");
  // Sahip ayın alımını yazdı (36 kg; not yok): reddedilen işaret kalkar, sapma hesaplanır
  const typed = managed.map((p) => (p.ingredientId === coffee && p.month === "2026-09" ? { ...p, qty: 36000, note: null } : p));
  const after = consistency(createModel({ ...rejectedDs, purchaseQuantities: typed }), "2026-09");
  const t = after.rows.find((r) => r.ingredient.id === coffee)!;
  assert.deepEqual([t.stock, t.held, t.rejected], ["complete", null, null]);
  close(t.actualUsage, 10000 + 36000 - 12500, "gerçek tüketim elle yazılan alımla");
  assert.equal(typeof t.variance, "number");
  assert.equal(after.rejectedCount, 0);
  // "Alım yok (0)" satırı elle yazılmış sayılmaz: işaret kalır
  const zero = managed.map((p) => (p.ingredientId === coffee && p.month === "2026-09" ? { ...p, qty: 0, note: NO_PURCHASE_NOTE } : p));
  assert.equal(consistency(createModel({ ...rejectedDs, purchaseQuantities: zero }), "2026-09").rows.find((r) => r.ingredient.id === coffee)!.stock, "rejected");
  // Bekleyen ve reddedilen birlikte: bekleyen öne geçer (onaya götürür)
  const both = consistency(createModel({ ...rejectedDs, heldPurchases: [{ month: "2026-09", ingredientId: coffee, invoices: 1, rejected: 1 }] }), "2026-09");
  const b = both.rows.find((r) => r.ingredient.id === coffee)!;
  assert.deepEqual([b.stock, both.heldCount, both.rejectedCount], ["held", 1, 0]);
});

test("Tutarlılık rehberi: Excel E14 notundaki iki cümle", () => {
  assert.match(RATIO_GUIDE.below1, /1×'in altı/);
  assert.match(RATIO_GUIDE.fastMovers, /espresso, süt, dondurma, tatlılar, şişe su/);
});

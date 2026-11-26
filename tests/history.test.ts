// Geçmiş ayların korunması: tutar değişiklikleri "şu aydan itibaren", kalemlerin başlangıç / bitiş ayı,
// elle girilen gelir-gider hücreleri, sayım çarpanı ve su maliyeti nedeni.
// Çalıştırma: npx tsx --test tests/history.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  activeFromRange,
  countUnitForFactor,
  countUnitsFor,
  createModel,
  currentMonthTR,
  fixedAt,
  fixedHistory,
  inRange,
  personnelSummary,
  planVersionChange,
  rangeStatus,
  staffAt,
  valueMonthFor,
} from "../src/lib/calc/engine";
import type { Dataset, FixedExpense, Staff } from "../src/lib/calc/types";
import { cleanInvoiceDescription, datasetFromSeed, investmentSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
// Excel bütün satışa tek KDV oranı uyguluyordu (karaoke dahil %10): Excel'le karşılaştırma onun varsayımıyla (calc.test.ts)
const excel = datasetFromSeed(data);
const base: Dataset = { ...excel, settings: { ...excel.settings, kdvHizmet: excel.settings.kdv }, currentMonth: "2026-10" };
const MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10"];

function close(actual: number | null | undefined, expected: number, label: string, tol = 1e-6) {
  assert.ok(actual !== null && actual !== undefined, `${label}: değer yok`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol * Math.max(1, Math.abs(expected)), `${label}: beklenen ${expected}, bulunan ${actual} (fark ${diff})`);
}

/** Excel'in Temmuz–Ekim kâr/zararı değişmedi mi */
function assertPastUnchanged(model: ReturnType<typeof createModel>, months = MONTHS) {
  for (const m of months) {
    const g = golden.pnl[m];
    const pm = model.pnlMonth(m);
    close(pm.sections.personel, g.personnel, `${m} personel`);
    close(pm.sections.kira, g.rent, `${m} kira`);
    close(pm.sections.genel, g.general, `${m} genel`);
    close(pm.sections.faturalar, g.bills, `${m} faturalar`);
    close(pm.profit, g.profit, `${m} kâr/zarar`);
  }
}

const withMonth = (ds: Dataset, month: string, openDays: number): Dataset => ({
  ...ds,
  months: [...ds.months, { month, openDays, posRevenue: null, discounts: 0, offRevenue: 0, note: null }],
});
const kira = base.fixedExpenses.find((f) => f.name === "Kira")!;
const influencer = base.fixedExpenses.find((f) => f.name === "Influencer")!;

// ---------------------------------------------------------------- Yardımcılar

test("Aralık: başlangıç ≤ ay ≤ bitiş; aralık hiç verilmemişse active bakılır", () => {
  assert.equal(inRange({ startMonth: null, endMonth: null }, "2026-07"), true);
  assert.equal(inRange({ startMonth: "2026-08", endMonth: null }, "2026-07"), false);
  assert.equal(inRange({ startMonth: "2026-08", endMonth: null }, "2026-08"), true);
  assert.equal(inRange({ startMonth: null, endMonth: "2026-09" }, "2026-09"), true);
  assert.equal(inRange({ startMonth: null, endMonth: "2026-09" }, "2026-10"), false);
  // Eski biçim veri: aralık alanları yok
  assert.equal(inRange({ active: false }, "2026-09"), false);
  assert.equal(inRange({ active: true }, "2026-09"), true);
  // Aralık varsa active'e bakılmaz
  assert.equal(inRange({ active: false, startMonth: null, endMonth: null }, "2026-09"), true);

  assert.equal(activeFromRange(null, "2026-10"), true);
  assert.equal(activeFromRange("2026-10", "2026-10"), true);
  assert.equal(activeFromRange("2026-09", "2026-10"), false);

  assert.equal(valueMonthFor({ startMonth: null, endMonth: "2026-08" }, "2026-10"), "2026-08");
  assert.equal(valueMonthFor({ startMonth: "2026-12", endMonth: null }, "2026-10"), "2026-12");
  assert.equal(valueMonthFor({ startMonth: null, endMonth: null }, "2026-10"), "2026-10");
  assert.equal(rangeStatus({ startMonth: null, endMonth: "2026-08" }, "2026-10"), "ended");
  assert.equal(rangeStatus({ startMonth: "2026-12", endMonth: null }, "2026-10"), "upcoming");
  assert.equal(rangeStatus({ startMonth: null, endMonth: null }, "2026-10"), "active");
});

test("Bu ay Türkiye saatine göre (UTC 31 Ekim 22:30 = İstanbul 1 Kasım)", () => {
  assert.equal(currentMonthTR(new Date("2026-10-31T22:30:00Z")), "2026-11");
  assert.equal(currentMonthTR(new Date("2026-10-31T20:30:00Z")), "2026-10");
});

test("Sürüm: fromMonth ≤ ay olan en son sürüm, yoksa taban", () => {
  const fe: FixedExpense = { ...kira };
  const versions = [
    { id: 1, fixedExpenseId: kira.id, fromMonth: "2026-11", period: "aylik" as const, amount: 175000 },
    { id: 2, fixedExpenseId: kira.id, fromMonth: "2027-03", period: "aylik" as const, amount: 190000 },
    { id: 3, fixedExpenseId: 999, fromMonth: "2026-08", period: "aylik" as const, amount: 1 },
  ];
  assert.equal(fixedAt(fe, versions, "2026-10").amount, 160000);
  assert.equal(fixedAt(fe, versions, "2026-11").amount, 175000);
  assert.equal(fixedAt(fe, versions, "2027-02").amount, 175000);
  assert.equal(fixedAt(fe, versions, "2027-03").amount, 190000);
  const h = fixedHistory(fe, versions);
  assert.deepEqual(
    h.map((x) => [x.fromMonth, x.amount, x.versionId]),
    [
      [null, 160000, null],
      ["2026-11", 175000, 1],
      ["2027-03", 190000, 2],
    ],
  );

  const p: Staff = { ...base.staff[0] };
  const sv = [{ id: 7, staffId: p.id, fromMonth: "2026-11", netSalary: 35000, extras: 500 }];
  assert.equal(staffAt(p, sv, "2026-10").netSalary, 30000);
  assert.equal(staffAt(p, sv, "2026-11").netSalary, 35000);
  assert.equal(staffAt(p, sv, "2026-11").extras, 500);
});

test("Tutar değişikliği planı: taban mı, sürüm mü, hiçbiri mi", () => {
  type V = { amount: number };
  const eq = (a: V, b: V) => a.amount === b.amount;
  const plan = (o: { versions?: (V & { fromMonth: string })[]; next: number; from: string; start?: string | null; first?: string | null }) =>
    planVersionChange<V>({
      base: { amount: 160000 },
      versions: o.versions ?? [],
      next: { amount: o.next },
      effectiveFrom: o.from,
      startMonth: o.start ?? null,
      firstDataMonth: o.first === undefined ? "2026-07" : o.first,
      equal: eq,
    });
  // Değişiklik yok
  assert.deepEqual(plan({ next: 160000, from: "2026-11" }), { action: "none" });
  // Geçmiş aylar varken bu aydan itibaren: sürüm
  assert.deepEqual(plan({ next: 175000, from: "2026-10" }), { action: "upsert", fromMonth: "2026-10" });
  // İlk veri ayından itibaren (öncesinde hesap yok): taban
  assert.deepEqual(plan({ next: 175000, from: "2026-07" }), { action: "base", clearVersions: false });
  // Hiç veri yok: taban
  assert.deepEqual(plan({ next: 175000, from: "2026-10", first: null }), { action: "base", clearVersions: false });
  // Bu ay eklenen kalem bu ay düzeltilince: taban (gereksiz sürüm açılmaz)
  assert.deepEqual(plan({ next: 175000, from: "2026-10", start: "2026-10" }), { action: "base", clearVersions: false });
  // Bütün aylar: taban + sürümleri sil
  const versions = [{ fromMonth: "2026-11", amount: 175000 }];
  assert.deepEqual(plan({ versions, next: 170000, from: "all" }), { action: "base", clearVersions: true });
  assert.deepEqual(plan({ next: 160000, from: "all" }), { action: "none" });
  // Var olan sürüm ayında yeni tutar: sürümü güncelle
  assert.deepEqual(plan({ versions, next: 180000, from: "2026-11" }), { action: "upsert", fromMonth: "2026-11" });
  // Sürüm ayında önceki tutara dönüş: sürüm gereksiz, sil
  assert.deepEqual(plan({ versions, next: 160000, from: "2026-11" }), { action: "delete", fromMonth: "2026-11" });
  // Sürümden sonraki ay zaten aynı tutar: hiçbir şey
  assert.deepEqual(plan({ versions, next: 175000, from: "2026-12" }), { action: "none" });
  // Sürümden önceki ay (ilk veri ayı) değişirse sonraki sürüm korunur: taban değişir
  assert.deepEqual(plan({ versions, next: 150000, from: "2026-07" }), { action: "base", clearVersions: false });
});

test("personnelSummary ay verilince aralık ve sürümle, verilmeyince eski davranışla hesaplar", () => {
  const staff: Staff[] = [
    { id: 1, name: "A", netSalary: 30000, extras: 0, active: true, startMonth: null, endMonth: null },
    { id: 2, name: "B", netSalary: 30000, extras: 0, active: true, startMonth: null, endMonth: "2026-09" },
    { id: 3, name: "C", netSalary: 20000, extras: 0, active: true, startMonth: "2026-11", endMonth: null },
  ];
  const versions = [{ id: 1, staffId: 1, fromMonth: "2026-10", netSalary: 33000, extras: 0 }];
  assert.equal(personnelSummary(staff, base.settings, "2026-09", versions).net, 60000);
  assert.equal(personnelSummary(staff, base.settings, "2026-10", versions).net, 33000);
  assert.equal(personnelSummary(staff, base.settings, "2026-11", versions).net, 53000);
  // Ay verilmezse: active olanlar, taban değerle (eski kullanım)
  assert.equal(personnelSummary(staff, base.settings).net, 80000);
});

// ---------------------------------------------------------------- Sabit giderler

test("Kira Kasım'dan itibaren 175.000: Temmuz–Ekim Excel'deki gibi kalır, Kasım yeni tutarla", () => {
  const ds = withMonth(
    { ...base, fixedExpenseVersions: [{ id: 1, fixedExpenseId: kira.id, fromMonth: "2026-11", period: "aylik", amount: 175000 }] },
    "2026-11",
    30,
  );
  const model = createModel(ds);
  assertPastUnchanged(model);
  close(model.pnlMonth("2026-07").cells.get(`fixed:${kira.id}`)!.value, (160000 * 23) / 31, "Temmuz kira");
  close(model.pnlMonth("2026-11").cells.get(`fixed:${kira.id}`)!.value, 175000, "Kasım kira");
  // Bugünkü (Ekim) liste ve toplam eski tutarda; değişiklik "sıradaki" olarak görünür
  const item = model.fixedList.find((f) => f.id === kira.id)!;
  assert.equal(item.amount, 160000);
  assert.equal(item.nextChange?.fromMonth, "2026-11");
  assert.equal(item.nextChange?.amount, 175000);
  close(model.fixedStandardTotal, golden.fixedTotal, "bugünkü sabit gider toplamı");
  close(model.fixedStandardTotalFor("2026-11"), golden.fixedTotal + 15000, "Kasım sabit gider toplamı");
  // Bu ay Kasım olunca liste yeni tutarı gösterir
  const nov = createModel({ ...ds, currentMonth: "2026-11" });
  assert.equal(nov.fixedList.find((f) => f.id === kira.id)!.amount, 175000);
  assert.equal(nov.activeFixed.find((f) => f.id === kira.id)!.amount, 175000);
});

test("Dönem de sürümle değişir (aylık → günlük)", () => {
  const ds = withMonth(
    { ...base, fixedExpenseVersions: [{ id: 1, fixedExpenseId: influencer.id, fromMonth: "2026-11", period: "gunluk", amount: 1000 }] },
    "2026-11",
    20,
  );
  const model = createModel(ds);
  assertPastUnchanged(model);
  close(model.pnlMonth("2026-11").cells.get(`fixed:${influencer.id}`)!.value, 20000, "Kasım influencer (20 gün × 1.000)");
});

test("Yeni sabit gider Kasım'da başlarsa geçmiş aylar değişmez", () => {
  const added: FixedExpense = { id: 900, name: "TEST yeni gider", section: "genel", period: "aylik", amount: 9000, note: null, active: true, sortOrder: 99, startMonth: "2026-11", endMonth: null };
  const model = createModel(withMonth({ ...base, fixedExpenses: [...base.fixedExpenses, added] }, "2026-11", 30));
  assertPastUnchanged(model);
  close(model.pnlMonth("2026-11").cells.get("fixed:900")!.value, 9000, "Kasım yeni gider");
  assert.equal(model.pnlMonth("2026-10").cells.get("fixed:900")!.outOfRange, true);
  // Ekim'de başlamadığı için bugünkü toplama girmez, listede "upcoming"
  assert.equal(model.fixedList.find((f) => f.id === 900)!.status, "upcoming");
  close(model.fixedStandardTotal, golden.fixedTotal, "bugünkü toplam");
});

test("Influencer Eylül'de biterse: Temmuz–Eylül korunur, Ekim'den itibaren girmez, satır listede kalır", () => {
  const ds: Dataset = { ...base, fixedExpenses: base.fixedExpenses.map((f) => (f.id === influencer.id ? { ...f, endMonth: "2026-09" } : f)) };
  const model = createModel(ds);
  assertPastUnchanged(model, ["2026-07", "2026-08", "2026-09"]);
  const oct = model.pnlMonth("2026-10");
  const g = golden.pnl["2026-10"];
  close(oct.sections.genel, g.general - (50000 * 16) / 31, "Ekim genel (influencer yok)");
  assert.equal(oct.cells.get(`fixed:${influencer.id}`)!.value, null);
  assert.equal(oct.cells.get(`fixed:${influencer.id}`)!.outOfRange, true);
  const defs = model.pnlRowDefs(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  assert.ok(defs.some((d) => d.key === `fixed:${influencer.id}` && d.fixedId === influencer.id), "satır listede");
  // Bugün (Ekim) pasif görünür
  const item = model.fixedList.find((f) => f.id === influencer.id)!;
  assert.equal(item.active, false);
  assert.equal(item.status, "ended");
  assert.ok(!model.activeFixed.some((f) => f.id === influencer.id));
});

test("Aralık dışındaki ya da silinmiş kalemin elle girilen tutarı her zaman sayılır", () => {
  const ds: Dataset = {
    ...base,
    fixedExpenses: base.fixedExpenses.map((f) => (f.id === influencer.id ? { ...f, endMonth: "2026-08" } : f)),
    pnlEntries: [
      { month: "2026-09", rowKey: `fixed:${influencer.id}`, amount: 45000, note: "Eylül'de son ödeme" },
      { month: "2026-09", rowKey: "fixed:999", amount: 1234 },
    ],
  };
  const model = createModel(ds);
  const sep = model.pnlMonth("2026-09");
  const g = golden.pnl["2026-09"];
  // Excel Eylül genel gideri 50.000 influencer içeriyor; burada 45.000 elle + 1.234 silinmiş kalem
  close(sep.sections.genel, g.general - 50000 + 45000 + 1234, "Eylül genel");
  const cell = sep.cells.get(`fixed:${influencer.id}`)!;
  assert.equal(cell.overridden, true);
  assert.equal(cell.outOfRange, true);
  assert.equal(cell.note, "Eylül'de son ödeme");
  const defs = model.pnlRowDefs(MONTHS);
  assert.ok(defs.some((d) => d.key === "fixed:999" && d.section === "genel"), "silinmiş kalemin satırı");
  assert.ok(defs.some((d) => d.key === `fixed:${influencer.id}`), "bitmiş kalemin satırı");
});

test("Eski biçim pasif kalem (aralık yok) de elle girilen tutarı kaybetmez", () => {
  const ds: Dataset = {
    ...base,
    fixedExpenses: base.fixedExpenses.map((f) => {
      if (f.id !== influencer.id) return f;
      const { startMonth: _s, endMonth: _e, ...rest } = f;
      void _s;
      void _e;
      return { ...rest, active: false };
    }),
    pnlEntries: [{ month: "2026-09", rowKey: `fixed:${influencer.id}`, amount: 45000 }],
  };
  const sep = createModel(ds).pnlMonth("2026-09");
  close(sep.sections.genel, golden.pnl["2026-09"].general - 5000, "Eylül genel (45.000 elle)");
});

test("Pasif kalemler 2026-06'da bitmiş sayılır: rakamlar aynı, 2026 tablosunda satır yok", () => {
  const legacy = createModel({
    ...base,
    fixedExpenses: base.fixedExpenses.map((f) => {
      if (f.id !== influencer.id) return f;
      const { startMonth: _s, endMonth: _e, ...rest } = f;
      void _s;
      void _e;
      return { ...rest, active: false };
    }),
  });
  const migrated = createModel({
    ...base,
    fixedExpenses: base.fixedExpenses.map((f) => (f.id === influencer.id ? { ...f, active: false, endMonth: "2026-06" } : f)),
  });
  for (const m of MONTHS) close(migrated.pnlMonth(m).profit, legacy.pnlMonth(m).profit, `${m} kâr`);
  const months2026 = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  assert.ok(!migrated.pnlRowDefs(months2026).some((d) => d.key === `fixed:${influencer.id}`), "verisi olan ayda geçerli değil");
});

// ---------------------------------------------------------------- Personel

test("Üçüncü kişi Kasım'da başlar, zam Kasım'dan: Temmuz–Ekim personel gideri Excel'deki gibi", () => {
  const third: Staff = { id: 3, name: "TEST Personel 3", netSalary: 30000, extras: 0, active: true, startMonth: "2026-11", endMonth: null };
  const ds = withMonth(
    {
      ...base,
      staff: [...base.staff, third],
      staffVersions: [{ id: 1, staffId: base.staff[0].id, fromMonth: "2026-11", netSalary: 35000, extras: 0 }],
    },
    "2026-11",
    30,
  );
  const model = createModel(ds);
  assertPastUnchanged(model);
  close(model.personnel.net, golden.personnel.net, "bugünkü net maaş");
  close(model.personnel.total, golden.personnel.total, "bugünkü işveren maliyeti");
  close(model.personnelFor("2026-11").net, 95000, "Kasım net maaş");
  close(model.pnlMonth("2026-11").cells.get("personnel:net")!.value, 95000, "Kasım PERSONEL MAAŞ");
  const list = model.staffList;
  assert.equal(list.find((x) => x.id === 3)!.status, "upcoming");
  assert.equal(list.find((x) => x.id === base.staff[0].id)!.netSalary, 30000);
  assert.equal(list.find((x) => x.id === base.staff[0].id)!.nextChange?.netSalary, 35000);
});

test("Ayrılan personel: bitiş ayından sonra maaş hesabına girmez, önceki aylar korunur", () => {
  const ds: Dataset = { ...base, staff: base.staff.map((x, i) => (i === 1 ? { ...x, endMonth: "2026-09", active: false } : x)) };
  const model = createModel(ds);
  assertPastUnchanged(model, ["2026-07", "2026-08", "2026-09"]);
  close(model.personnelFor("2026-10").net, 30000, "Ekim net maaş (tek kişi)");
  assert.equal(model.staffList[1].status, "ended");
  assert.equal(model.staffList[1].active, false);
});

test("personnel:* elle girilen bordro tutarı personel olmasa da sayılır", () => {
  const ds: Dataset = {
    ...base,
    staff: base.staff.map((x) => ({ ...x, endMonth: "2026-08" })),
    pnlEntries: [{ month: "2026-09", rowKey: "personnel:net", amount: 61000 }],
  };
  const sep = createModel(ds).pnlMonth("2026-09");
  close(sep.cells.get("personnel:net")!.value, 61000, "Eylül net maaş (elle)");
  close(sep.cells.get("personnel:employer")!.value, 0, "Eylül işveren payı (personel yok)");
});

// ---------------------------------------------------------------- Gelir-gider notları ve tedarikçi sırası

test("Hücre notu PnlCell.note olarak gelir; ay notu Month.note'ta", () => {
  const model = createModel({
    ...base,
    pnlEntries: [
      { month: "2026-09", rowKey: "manual:harici", amount: 2500, note: "Makine servisi" },
      { month: "2026-09", rowKey: "stock:closing", amount: 20000, note: "Elle sayıldı" },
    ],
  });
  const sep = model.pnlMonth("2026-09");
  assert.equal(sep.cells.get("manual:harici")!.note, "Makine servisi");
  assert.equal(sep.cells.get("stock:closing")!.note, "Elle sayıldı");
  assert.equal(sep.cells.get("manual:su")!.note, null);
  assert.equal(model.monthInfo.get("2026-10")?.note?.startsWith("1-16 Ekim"), true);
});

test("Tedarikçi satırları alfabetik ve sabit sırada, sattıkları ürünle", () => {
  const model = createModel(base);
  const rows = model.pnlRowDefs(MONTHS).filter((r) => r.key.startsWith("purchase:"));
  const names = rows.map((r) => r.key.slice(9));
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "tr-TR")));
  assert.equal(rows.find((r) => r.key === "purchase:Sütaş")?.sub, "süt");
  assert.ok(rows.find((r) => r.key === "purchase:Kaldi")?.sub?.includes("kahve"));
  assert.equal(rows.find((r) => r.key === "purchase:Serendi Ambalaj")?.sub, "ambalaj");
  // Tutarlar sıralamadan bağımsız aynı
  for (const m of MONTHS) close(model.pnlMonth(m).purchases, golden.pnl[m].purchases, `${m} mal alımı`);
});

// ---------------------------------------------------------------- Stok sayımı

test("Sayım çarpanı saklanır: pasif / Sayılmaz yapılan ya da birimi değişen malzemenin geçmiş değeri değişmez", () => {
  const esp = base.ingredients.find((i) => i.countUnit === "KG" && i.name.toLocaleLowerCase("tr-TR").includes("espresso"))!;
  assert.ok(esp, "espresso çekirdeği");
  const counts = [
    { month: "2026-08", ingredientId: esp.id, qty: 10, factor: 1000 },
    { month: "2026-09", ingredientId: esp.id, qty: 12.5, factor: 1000 },
  ];
  const before = createModel({ ...base, stockCounts: counts });
  const sepBefore = before.stockSheet("2026-09").total;
  const cogsBefore = before.pnlMonth("2026-09").cogs;
  assert.ok(sepBefore > 0);
  close(before.countInBaseUnit("2026-09", esp.id), 12500, "gram cinsinden sayım");

  // Pasif malzeme aktif bir ürünün reçetesindeyse listede kalır (denetim E-04): pasif durumunda onu kullanan ürünler de emekli
  const users = new Set(base.recipeItems.filter((r) => r.ingredientId === esp.id).map((r) => r.productId));
  const retired = base.products.map((p) => (users.has(p.id) ? { ...p, active: false } : p));
  for (const change of [{ active: false }, { countUnit: null }, { countUnit: "ADET" as const }]) {
    const products = "active" in change ? retired : base.products;
    const after = createModel({ ...base, products, stockCounts: counts, ingredients: base.ingredients.map((i) => (i.id === esp.id ? { ...i, ...change } : i)) });
    close(after.stockSheet("2026-09").total, sepBefore, `Eylül stok ${JSON.stringify(change)}`);
    close(after.pnlMonth("2026-09").cogs, cogsBefore, `Eylül SMM ${JSON.stringify(change)}`);
    const line = after.stockSheet("2026-09").groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === esp.id)!;
    assert.equal(line.factor, 1000);
    assert.equal(line.countUnit, "KG");
    if (change.countUnit === "ADET") assert.equal(line.unitChanged, true);
    else assert.equal(line.archived, true);
    // Sayımı olmayan ayda pasif / sayılmaz malzeme listede yok, ADET'e geçen var
    const oct = after.stockSheet("2026-10").groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === esp.id);
    assert.equal(!!oct, change.countUnit === "ADET");
  }
});

test("Çarpanı olmayan eski sayım bugünkü birimle değerlenir (geriye dönük uyumluluk)", () => {
  const esp = base.ingredients.find((i) => i.countUnit === "KG")!;
  const a = createModel({ ...base, stockCounts: [{ month: "2026-09", ingredientId: esp.id, qty: 2 }] });
  const b = createModel({ ...base, stockCounts: [{ month: "2026-09", ingredientId: esp.id, qty: 2, factor: 1000 }] });
  close(a.stockSheet("2026-09").total, b.stockSheet("2026-09").total, "aynı değer");
});

test("Sayım birimi malzeme birimine uymalı", () => {
  assert.deepEqual(countUnitsFor("gr"), ["KG"]);
  assert.deepEqual(countUnitsFor("ml"), ["LT"]);
  assert.deepEqual(countUnitsFor("adet"), ["ADET"]);
  assert.deepEqual(countUnitsFor("dilim"), ["DİLİM", "ADET"]);
  // Excel'deki bütün malzemeler uyumlu
  for (const i of base.ingredients) {
    if (i.countUnit) assert.ok(countUnitsFor(i.unit).includes(i.countUnit), `${i.name}: ${i.unit} / ${i.countUnit}`);
  }
  assert.equal(countUnitForFactor({ unit: "ml", countUnit: null }, 1000), "LT");
  assert.equal(countUnitForFactor({ unit: "gr", countUnit: "ADET" }, 1000), "KG");
  assert.equal(countUnitForFactor({ unit: "dilim", countUnit: null }, 1), "DİLİM");
});

// ---------------------------------------------------------------- Su + buz

test("Su maliyeti nedeni: fatura yok / satış listesi yok / tamam / elle", () => {
  assert.equal(createModel({ ...base, pnlEntries: [] }).water.reason, "no-bill");

  const onlyOct = createModel({ ...base, pnlEntries: [{ month: "2026-10", rowKey: "manual:su", amount: 1500 }] }).water;
  assert.equal(onlyOct.reason, "no-usage");
  assert.equal(onlyOct.latestBillMonth, "2026-10");
  assert.equal(onlyOct.perLiter, 0);

  const sep = createModel({ ...base, pnlEntries: [{ month: "2026-09", rowKey: "manual:su", amount: 1500 }] }).water;
  assert.equal(sep.reason, "ok");
  assert.equal(sep.month, "2026-09");
  close(sep.perLiter, 1500 / 314.89, "Eylül ₺/L (Excel Ayarlar!B17)", 1e-4);

  // Ekim faturası satış listesi olmadığı için atlanır, Eylül kullanılır
  const both = createModel({
    ...base,
    pnlEntries: [
      { month: "2026-09", rowKey: "manual:su", amount: 1500 },
      { month: "2026-10", rowKey: "manual:su", amount: 1200 },
    ],
  }).water;
  assert.equal(both.reason, "ok");
  assert.equal(both.month, "2026-09");
  assert.equal(both.latestBillMonth, "2026-10");

  const ov = createModel({ ...base, settings: { ...base.settings, suBirimLTOverride: 5 } }).water;
  assert.equal(ov.reason, "override");
  assert.equal(ov.perLiter, 5);
});

// ---------------------------------------------------------------- Excel aktarımı düzeltmeleri

test("Fatura açıklamasındaki ödeme durumu atılır", () => {
  assert.equal(cleanInvoiceDescription("Gider listesi, ödenmedi"), "Gider listesi");
  assert.equal(cleanInvoiceDescription("Gider listesi, ödendi"), "Gider listesi");
  assert.equal(cleanInvoiceDescription("Dekorasyon"), "Dekorasyon");
  assert.equal(cleanInvoiceDescription(null), null);
  assert.ok(!base.invoices.some((i) => /öden(me)?di/i.test(i.description ?? "")));
});

test("Yatırım dönemleri fatura tarihlerinden", () => {
  const byName = new Map(data.investments.map((x) => [x.name, investmentSeed(x)]));
  assert.equal(byName.get("Dekorasyon & ekipman (XND Teknoloji)")?.date, "2026-07");
  assert.equal(byName.get("POS / yazarkasa / ModPOS (Aria)")?.date, "2026-07");
  assert.equal(byName.get("Reklam (Beyza Karaman)")?.date, "2026-09");
  assert.equal(byName.get("Tabela, baskı (Murat Şeimen, Tuzla Baskı)")?.date, null);
  assert.ok(byName.get("Tabela, baskı (Murat Şeimen, Tuzla Baskı)")?.note?.includes("Temmuz–Eylül"));
  assert.equal(byName.get("Bardak baskı klişe bedelleri (Serendi)")?.date, null);
});

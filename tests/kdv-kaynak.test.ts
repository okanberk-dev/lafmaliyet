// KDV tahmininin kasa KDV'si gün gün kaynağından (Dalga 2, 26 Kasım 2026; docs/NAKIT-PLANI.md › KDV tahmini › Kasa
// KDV'sinin kaynağı): kasa raporunda yazarkasa Z'sinin KDV'si girilmiş gün Z'den, LafPOS'un dökümü olan gün LafPOS'tan,
// kalanı oranla; kaynak ekranda yazar ("12 gün yazarkasa Z'sinden, 3 gün tahmin"). Gelir-gider'in KDV hariç cirosu
// değişmez. Çalıştırma: npx tsx --test tests/kdv-kaynak.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { resolveMonth, tillMonths, vatDaysOf, type TillRow } from "../src/lib/cash-month";
import { posVatByDays, vatEstimates, vatLineDetail, vatMonthInputs, vatSourceText } from "../src/lib/kdv";
import { okcDayVat } from "../src/lib/okc-z";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const r2 = (v: number) => Math.round(v * 100) / 100;
const close = (a: number | null | undefined, b: number, msg: string, eps = 0.005) => assert.ok(a != null && Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

/** Kasım'ın on günü (tests/lafpos-gun-alanlari.test.ts ile aynı günler): gün, ciro; ödeme dökümü ciroyu tutar */
const DAYS: [string, number][] = [
  ["2026-11-13", 390],
  ["2026-11-14", 3311],
  ["2026-11-15", 5753],
  ["2026-11-16", 2670],
  ["2026-11-17", 1641.25],
  ["2026-11-18", 2419.25],
  ["2026-11-19", 2535.75],
  ["2026-11-20", 4008],
  ["2026-11-21", 4620.5],
  ["2026-11-22", 6285],
];
const REVENUE = 33_633.75;

/** Günün satırı; `extra` ile yazarkasa Z'si ya da LafPOS dökümü */
const rowsOf = (branchId: string, extra: Record<string, Partial<TillRow>> = {}): TillRow[] =>
  DAYS.map(([date, z]) => ({ date, zTotal: z, card: z, mealCard: 0, discounts: 0, offRevenue: 0, payments: z, branchId, ...extra[date] }));

function novemberModel(rows: TillRow[], switchDay: string | null, typed?: { posRevenue: number; openDays: number }) {
  const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
  const base: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-12" };
  const [till] = tillMonths(rows, "2026-11-30", undefined, undefined, undefined, undefined, undefined, true, switchDay);
  const stored = typed ? { month: "2026-11", discounts: null, offRevenue: null, cardShare: null, note: null, ...typed } : undefined;
  const nov = resolveMonth("2026-11", stored, till);
  const ds: Dataset = { ...base, settings: { ...base.settings, lafposGecisGunu: switchDay }, salesLines: base.salesLines.filter((l) => l.month !== "2026-11"), months: [...base.months.filter((m) => m.month !== "2026-11"), nov] };
  return { model: createModel(ds), till };
}

const novInput = (model: ReturnType<typeof createModel>) => vatMonthInputs(model, "2026-12-10").months.find((m) => m.month === "2026-11")!;

test("okcDayVat: KDV toplamı girilmişse o, yoksa dökümün KDV'leri; toplam ya da KDV yoksa null", () => {
  assert.deepEqual(okcDayVat({ okcTotal: 2670, okcVatTotal: 300, okcVat: [{ rate: 10, total: 2670, vat: 242.73 }] }), { total: 2670, vat: 300 });
  assert.deepEqual(okcDayVat({ okcTotal: 2670, okcVatTotal: null, okcVat: [{ rate: 10, total: 1100, vat: 100 }, { rate: 20, total: 1570, vat: 261.67 }] }), { total: 2670, vat: 361.67 });
  assert.equal(okcDayVat({ okcTotal: 2670, okcVatTotal: null, okcVat: null }), null, "KDV girilmemiş");
  assert.equal(okcDayVat({ okcTotal: null, okcVatTotal: 300, okcVat: null }), null, "toplam yok");
  assert.equal(okcDayVat({ okcTotal: 0, okcVatTotal: 0, okcVat: null }), null, "satışsız Z");
});

test("vatDaysOf: Z'li gün Z'den (kapsanan kısım ciroyla sınırlı), akla yatmayan KDV ve Z'siz gün tahmin, satışsız gün sayılmaz", () => {
  const rows = rowsOf("tuzla", {
    "2026-11-13": { okc: { total: 390, vat: 35.45 } },
    // Yazarkasa toplamı cirodan büyük (ödenmez yazarkasadan geçmiş): kapsanan ciro kadar
    "2026-11-16": { okc: { total: 2800, vat: 300 } },
    // Cironun 620,50'si yazarkasadan geçmemiş (online platform): o kısım oranla kalır
    "2026-11-21": { okc: { total: 4000, vat: 363.64 } },
    // KDV toplamın %20'lik payından büyük: yanlış okunmuş, gün tahmin
    "2026-11-14": { okc: { total: 3311, vat: 900 } },
  });
  const d = vatDaysOf([...rows, { date: "2026-11-23", zTotal: 0, card: 0, mealCard: 0, discounts: 0, offRevenue: 0, payments: 0, branchId: "tuzla", okc: { total: 10, vat: 1 } }]);
  assert.deepEqual(d, { z: { days: 3, revenue: 7680.5, covered: 7060, vat: 699.09 }, lafpos: 0, estimate: 7 });
});

test("KDV tahmini: Z'si girilmiş günlerin KDV'si Z'den, kalanı oranla; kaynak yazar; Gelir-gider'in cirosu değişmez", () => {
  const z = {
    "2026-11-13": { okc: { total: 390, vat: 35.45 } },
    "2026-11-16": { okc: { total: 2670, vat: 300 } },
    "2026-11-21": { okc: { total: 4000, vat: 363.64 } },
  };
  const plain = novemberModel(rowsOf("tuzla"), null);
  const withZ = novemberModel(rowsOf("tuzla", z), null);
  assert.equal(plain.till.vatDays, undefined, "Z'siz ay: alan yok");
  const before = novInput(plain.model).pos!;
  close(before.vat, REVENUE / 11, "bugünkü yöntem: ciro × %10 ÷ 1,10", 1e-6);
  assert.equal(before.source, undefined);
  const after = novInput(withZ.model).pos!;
  // Yazarkasadan geçen 7.060 ₺'nin oranlı tahmini (÷ 11) çıkar, Z'lerin KDV'si (699,09) girer
  assert.equal(after.vat, r2(REVENUE / 11 - 7060 / 11 + 699.09));
  assert.equal(after.vat, 3114.89);
  assert.deepEqual(after.source, { z: 3, lafpos: 0, estimate: 7 });
  assert.deepEqual(withZ.model.posNet("2026-11"), plain.model.posNet("2026-11"), "Gelir-gider'in KDV hariç cirosu aynı");
  const est = (m: ReturnType<typeof createModel>) => {
    const inp = vatMonthInputs(m, "2026-12-10");
    return vatEstimates({ today: "2026-12-10", months: inp.months, firstSalesMonth: inp.firstSalesMonth, anchor: null, known: new Map(), periods: ["2026-11"], hasSite: false }).get("2026-11")!;
  };
  const e = est(withZ.model);
  assert.deepEqual(e.basis.posSource, { z: 3, lafpos: 0, estimate: 7 });
  assert.equal(e.pos, 3100, "100'e yuvarlı");
  assert.match(vatLineDetail(e), /Kasa KDV'si: 3 gün yazarkasa Z'sinden, 7 gün tahmin\./);
  assert.equal(est(plain.model).basis.posSource, undefined);
  assert.doesNotMatch(vatLineDetail(est(plain.model)), /Kasa KDV'si/);
});

test("KDV tahmini: LafPOS'un dökümü olan gün LafPOS'tan kalır (Z'si girilmiş olsa da), öteki Z'li gün Z'den", () => {
  const laf = { vat: [{ rate: 10, base: 5713.64, vat: 571.36 }], okc: { total: 6285, vat: 600 } };
  const only = novemberModel(rowsOf("marina", { "2026-11-22": laf }), "2026-11-22");
  assert.deepEqual(only.till.vatDays, { z: { days: 0, revenue: 0, covered: 0, vat: 0 }, lafpos: 1, estimate: 9 });
  const base = only.model.posNet("2026-11")!;
  assert.equal(base.byDay, true);
  assert.equal(novInput(only.model).pos!.vat, base.vat, "yalnız LafPOS dökümü: KDV değişmez");
  assert.deepEqual(novInput(only.model).pos!.source, { z: 0, lafpos: 1, estimate: 9 });
  const both = novemberModel(rowsOf("marina", { "2026-11-22": laf, "2026-11-13": { okc: { total: 390, vat: 40 } } }), "2026-11-22");
  const pos = novInput(both.model).pos!;
  // LafPOS dışı cironun etkin oranı: (KDV − LafPOS'un KDV'si) ÷ (ciro − LafPOS'un cirosu); 390 ₺'nin tahmini çıkar, 40 ₺ girer
  const rate = (base.vat - 571.36) / (REVENUE - 6285);
  assert.equal(pos.vat, r2(base.vat - 390 * rate + 40));
  assert.deepEqual(pos.source, { z: 1, lafpos: 1, estimate: 8 });
  assert.equal(vatSourceText(pos.source), "1 gün yazarkasa Z'sinden, 1 gün LafPOS'un KDV dökümünden, 8 gün tahmin");
});

test("KDV tahmini: elle yazılan ciroda kasa günleri ayın tamamı olmayabilir, Z'ye bakılmaz", () => {
  const typed = novemberModel(rowsOf("tuzla", { "2026-11-13": { okc: { total: 390, vat: 80 } } }), null, { posRevenue: 50_000, openDays: 26 });
  const pos = novInput(typed.model).pos!;
  close(pos.vat, 50_000 / 11, "oranla", 1e-6);
  assert.equal(pos.source, undefined);
});

test("posVatByDays ve vatSourceText: kaynak yoksa null; bütün günler Z'liyse KDV Z'lerin toplamı", () => {
  assert.deepEqual(posVatByDays({ revenue: 1100, vat: 100, lafposKnown: null, days: undefined }), { vat: 100, source: null });
  assert.deepEqual(posVatByDays({ revenue: 1100, vat: 100, lafposKnown: null, days: { z: { days: 0, revenue: 0, covered: 0, vat: 0 }, lafpos: 0, estimate: 4 } }), { vat: 100, source: null });
  assert.deepEqual(posVatByDays({ revenue: 1100, vat: 100, lafposKnown: null, days: { z: { days: 2, revenue: 1100, covered: 1100, vat: 131.5 }, lafpos: 0, estimate: 0 } }), {
    vat: 131.5,
    source: { z: 2, lafpos: 0, estimate: 0 },
  });
  assert.equal(vatSourceText({ z: 12, lafpos: 0, estimate: 3 }), "12 gün yazarkasa Z'sinden, 3 gün tahmin");
  assert.equal(vatSourceText({ z: 30, lafpos: 0, estimate: 0 }), "30 gün yazarkasa Z'sinden");
  assert.equal(vatSourceText({ z: 0, lafpos: 0, estimate: 30 }), null);
  assert.equal(vatSourceText(null), null);
  // Kaynak ekranda: kapalı satırda ve dökümde
  const card = read("src/app/panel/hatirlaticilar/nakit/vat-card.tsx");
  assert.match(card, /Kasa KDV&apos;si: \{source\}/);
  assert.match(card, /Kaynak: \{posSource\}/);
});

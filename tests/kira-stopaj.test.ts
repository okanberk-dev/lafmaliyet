// Kira: resmi (sözleşme) kira, otomatik stopaj, vergi kârında yalnız resmi brüt, muhtasarın kira stopajı satırı ve
// "açık güne göre oranla" (sahibin kararı, 4 Kasım 2026). Excel verisi: Kira 160.000 ₺/ay (KDV yok), Temmuz 23 açık gün.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, officialRentGross, stopajKey } from "../src/lib/calc/engine";
import type { Dataset, FixedExpense } from "../src/lib/calc/types";
import { muhtasarItemsFromModel } from "../src/lib/tax/muhtasar";
import { bridge, taxMonths, taxPnlInputFromModel } from "../src/lib/tax/pnl";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-11" };
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const kira = base.fixedExpenses.find((f) => f.name === "Kira")!;
const withKira = (patch: Partial<FixedExpense>): Dataset => ({ ...base, fixedExpenses: base.fixedExpenses.map((f) => (f.id === kira.id ? { ...f, vatRate: 0, ...patch } : f)) });

test("resmi brüt kira 100.000: Gelir-gider'de KİRA STOPAJI 20.000 (kira bölümünde); net 80.000 da aynı brüt", () => {
  const m = createModel(withKira({ officialAmount: 100_000, officialBasis: "brut", prorate: false }));
  const oct = m.pnlMonth("2026-10");
  close(oct.cells.get(`fixed:${kira.id}`)!.value!, 160_000, "kira");
  close(oct.cells.get(stopajKey(kira.id))!.value!, 20_000, "stopaj");
  assert.match(oct.cells.get(stopajKey(kira.id))!.info!, /^Resmi brüt kira 100\.000\s₺ × %20 stopaj\./);
  const before = createModel(withKira({ prorate: false })).pnlMonth("2026-10");
  close(oct.sections.kira - before.sections.kira, 20_000, "kira bölümüne stopaj eklendi");
  const row = m.pnlRowDefs(["2026-10"]).find((r) => r.key === stopajKey(kira.id))!;
  assert.deepEqual([row.label, row.section, row.editable], ["KİRA STOPAJI", "kira", true]);
  // Net 80.000 → brüt 80.000 ÷ 0,8 = 100.000
  const net = createModel(withKira({ officialAmount: 80_000, officialBasis: "net", prorate: false })).pnlMonth("2026-10");
  close(net.cells.get(stopajKey(kira.id))!.value!, 20_000, "net → brüt");
  assert.equal(officialRentGross({ officialAmount: 80_000, officialBasis: "net" }, 0.2), 100_000);
  assert.equal(officialRentGross({ officialAmount: null, officialBasis: null }, 0.2), null);
  // Resmi kirası olmayan kalemde satır ve stopaj yok
  assert.equal(createModel(base).pnlMonth("2026-10").cells.get(stopajKey(kira.id)), undefined);
  // Elle yazılan stopaj hücresi geçer
  const manual = createModel({ ...withKira({ officialAmount: 100_000, prorate: false }), pnlEntries: [...base.pnlEntries, { month: "2026-10", rowKey: stopajKey(kira.id), amount: 21_000 }] });
  close(manual.pnlMonth("2026-10").cells.get(stopajKey(kira.id))!.value!, 21_000, "elle");
});

test("açık güne göre oranlama: kira tam ay (Temmuz 160.000, 23/31 değil); seçilirse oranlı; süren ayda bugüne kadarki pay", () => {
  const prorated = createModel(base).pnlMonth("2026-07");
  close(prorated.cells.get(`fixed:${kira.id}`)!.value!, (160_000 * 23) / 31, "eski: 23/31");
  const full = createModel(withKira({ prorate: false, officialAmount: 100_000 })).pnlMonth("2026-07");
  close(full.cells.get(`fixed:${kira.id}`)!.value!, 160_000, "tam ay");
  close(full.cells.get(stopajKey(kira.id))!.value!, 20_000, "stopaj da tam ay");
  assert.match(full.cells.get(`fixed:${kira.id}`)!.info!, /^Tam ay/);
  // Verisi olan ilk aydan (Temmuz) önce başlangıç ayı yazılmamış kalem yine 0
  const june = createModel(withKira({ prorate: false, officialAmount: 100_000 })).pnlMonth("2026-06");
  assert.equal(june.cells.get(`fixed:${kira.id}`)!.value, 0);
  assert.equal(june.cells.get(stopajKey(kira.id))!.value, 0);
  // Süren ay (Kasım, 3 açık gün elle): bugüne kadarki pay
  const nov = createModel({
    ...withKira({ prorate: false }),
    months: [...base.months, { month: "2026-11", openDays: 3, posRevenue: 30_000, discounts: 0, offRevenue: 0, note: null }],
  }).pnlMonth("2026-11");
  close(nov.cells.get(`fixed:${kira.id}`)!.value!, (160_000 * 3) / 30, "süren ay: 3/30");
});

test("vergi kârı: kira gideri yalnız resmi brüt 100.000; belgesiz 80.000 (160.000 + 20.000 − 100.000); stopaj ayrıca yok; köprü tutar", () => {
  const model = createModel(withKira({ officialAmount: 100_000, officialBasis: "brut", prorate: false, taxDoc: "belgeli" }));
  const input = taxPnlInputFromModel(model, { settings: DEFAULT_TAX_SETTINGS, today: "2026-11-04", adjustments: [], assets: [], filings: [] });
  const oct = taxMonths(input, 2026).find((m) => m.month === "2026-10")!;
  const belgeli = oct.expense.rows.find((r) => r.key === "belgeli")!;
  const item = belgeli.items!.find((i) => i.label.startsWith("Kira"))!;
  assert.equal(item.label, "Kira (resmi brüt kira)");
  close(item.amount, 100_000, "resmi brüt gider");
  assert.ok(!belgeli.items!.some((i) => /stopaj/i.test(i.label)), "stopaj ayrıca gider değil");
  const rest = oct.excluded.find((x) => x.key === `fixed:${kira.id}`)!;
  assert.equal(rest.reason, "yok");
  close(rest.amount, 80_000, "belgesiz");
  assert.match(rest.note!, /^Belgesiz, vergide sayılmaz: ödenen kira 160\.000\s₺ \+ stopaj 20\.000\s₺ − resmi brüt 100\.000\s₺$/);
  // Köprü: Gelir-gider'deki gider (kira + stopaj) → vergideki gider (resmi brüt); kalan kuruş farkı yok
  const b = bridge(oct).rows;
  const sum = b.filter((r) => r.key !== "start" && r.key !== "end").reduce((a, r) => a + r.amount, 0);
  close(b[0].amount + sum, b.at(-1)!.amount, "köprü");
});

test("muhtasar: resmi kirası olan kalemin stopajı resmi brütten (160.000'den değil), profil seçilmemiş olsa da", () => {
  const model = createModel(withKira({ officialAmount: 100_000, officialBasis: "brut", prorate: false, taxWithholding: null }));
  const items = muhtasarItemsFromModel(model, "2026-10");
  const k = items.find((i) => i.id === kira.id)!;
  assert.deepEqual([k.amount, k.withholding], [100_000, "kira"]);
});

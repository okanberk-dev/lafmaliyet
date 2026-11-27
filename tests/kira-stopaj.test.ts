// Kira: resmi (sözleşme) kira, Gelir-gider'in otomatik "Kira stopajı" maliyeti ve "açık güne göre oranla" (sahibin
// kararı, 4 Kasım 2026). Vergi kârı ve muhtasar Vergi bölümüyle birlikte 27 Kasım 2026'da kaldırıldı. Excel verisi: Kira 160.000 ₺/ay (KDV yok), Temmuz 23 açık gün.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, officialRentGross, stopajKey } from "../src/lib/calc/engine";
import type { Dataset, FixedExpense } from "../src/lib/calc/types";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const base: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-11" };
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

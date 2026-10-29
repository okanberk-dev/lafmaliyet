// Vergi bordrosu (plan docs/planlar/vergi.md §3.4, §11-B): asgari ücret istisnası, netten brüt, kümülatif matrah,
// prime esas kazancın üst sınırı, ek ödemeler, asgari ücret desteği, yıl değişimi ve Ayarlar'dan bağımsızlık.
// Oranlar kural tablosunun: işçi %14 + %1, işveren %19,75 + %2. Tutarlar kuruşuna kadar.
// Çalıştırma: npx tsx --test tests/vergi-bordro.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, staffCost } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import {
  incomeTax,
  minWageExemption,
  payrollRates,
  payslipFromGross,
  payslipFromNet,
  taxPayroll,
  taxPayrollFromModel,
  type StaffMonths,
} from "../src/lib/tax/payroll";
import { r2, rulesFor } from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const R = rulesFor(2026).rules;
const rates = payrollRates(R);
const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
const months = (from: number, to: number, net: number, extras = 0) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ month: `2026-${String(from + i).padStart(2, "0")}`, net, extras }));

test("A2: tarife kümülatifleri (ücret ve ücret dışı)", () => {
  assert.equal(incomeTax(190000, R.ucret.tarife.value), 28500);
  assert.equal(incomeTax(400000, R.ucret.tarife.value), 70500);
  assert.equal(incomeTax(1500000, R.ucret.tarife.value), 367500);
  assert.equal(incomeTax(5300000, R.ucret.tarife.value), 1697500);
  assert.equal(incomeTax(1000000, R.ucret.tarifeDiger.value), 232500);
  assert.equal(incomeTax(5300000, R.ucret.tarifeDiger.value), 1737500);
  assert.equal(incomeTax(0, R.ucret.tarife.value), 0);
});

test("A4: elle sgk.isverenOran bordroya geçer (%14,75)", () => {
  const r = payrollRates(rulesFor(2026, { "sgk.isverenOran": 0.1475 }).rules);
  assert.equal(r.isverenSgk, 0.1475);
  assert.equal(payslipFromGross(33030, { month: 1, cumPrev: 0, rates: r }).isverenSgk, r2(33030 * 0.1475));
});

test("B1: asgari ücret istisnası ay ay; yıllık 57.881,23, damga istisnası 250,70", () => {
  const gv = Array.from({ length: 12 }, (_, i) => minWageExemption(i + 1, R).gv);
  assert.deepEqual(gv, [4211.33, 4211.33, 4211.33, 4211.33, 4211.33, 4211.33, 4537.75, 5615.1, 5615.1, 5615.1, 5615.1, 5615.1]);
  assert.deepEqual(gv, [...R.ucret.asgariIstisna.value], "kural tablosundaki ay ay değerlerle aynı");
  assert.equal(sum(gv), 57881.23);
  for (let m = 1; m <= 12; m++) assert.equal(minWageExemption(m, R).dv, 250.7);
});

test("B2: asgari ücretli: net 28.075,50, vergi 0, işveren maliyeti 40.214,03; netten aynı brüt", () => {
  const s = payslipFromGross(33030, { month: 1, cumPrev: 0, rates });
  assert.equal(s.isciSgk, 4624.2);
  assert.equal(s.isciIssizlik, 330.3);
  assert.equal(s.gv, 0);
  assert.equal(s.dv, 0);
  assert.equal(s.net, 28075.5);
  assert.equal(s.isverenSgk, 6523.43);
  assert.equal(s.isverenIssizlik, 660.6);
  assert.equal(s.cost, 40214.03);
  assert.equal(payslipFromNet(28075.5, { month: 1, cumPrev: 0, rates }).gross, 33030);
  for (const m of [6, 7, 12]) assert.equal(payslipFromNet(28075.5, { month: m, cumPrev: r2(28075.5 * (m - 1)), rates }).gross, 33030, `${m}. ay`);
});

test("B3: net 40.000 ₺, Ocak–Aralık 2026 (tek kişi)", () => {
  const p = taxPayroll([{ id: 1, name: "A", months: months(1, 12, 40000) }], 2026, R, { minWageSupport: false, from: "2026-01" });
  const rows = [...p.values()].map((m) => m.people[0]);
  const expect: [number, number, number, number, number][] = [
    [49709.72, 42253.26, 2126.66, 126.6, 60521.58],
    [49709.72, 84506.52, 2126.66, 126.6, 60521.58],
    [49709.72, 126759.78, 2126.66, 126.6, 60521.58],
    [49709.72, 169013.04, 2126.66, 126.6, 60521.58],
    [51291.06, 212610.44, 3458.8, 138.6, 62446.86],
    [52851.64, 257534.33, 4773.45, 150.44, 64346.87],
    [52366.19, 302045.59, 4364.5, 146.76, 63755.83],
    [50763.96, 345194.96, 3014.77, 134.6, 61805.12],
    [50763.96, 388344.33, 3014.77, 134.6, 61805.12],
    [54360.84, 434551.04, 6044.81, 161.9, 66184.33],
    [55692.02, 481889.26, 7166.22, 172, 67805.03],
    [55692.02, 529227.48, 7166.22, 172, 67805.03],
  ];
  assert.equal(rows.length, 12);
  rows.forEach((s, i) => {
    assert.deepEqual([s.gross, s.cumBase, s.gv, s.dv, s.cost], expect[i], `${i + 1}. ay`);
    assert.equal(s.net, 40000, `${i + 1}. ay net`);
  });
  assert.equal(sum(rows.map((s) => s.gross)), 622620.57);
  assert.equal(sum(rows.map((s) => s.gv)), 47510.18);
  assert.equal(sum(rows.map((s) => s.dv)), 1717.3);
  assert.equal(sum(rows.map((s) => s.cost)), 758040.51);
  // Elle kontrol (1. ay): 49.709,72 − 6.959,36 − 497,10 = 42.253,26; %15 → 6.337,99 − 4.211,33 = 2.126,66
  assert.equal(rows[0].isciSgk, 6959.36);
  assert.equal(rows[0].isciIssizlik, 497.1);
  assert.equal(rows[0].gvHesap, 6337.99);
  assert.equal(rows[0].gvIstisna, 4211.33);
});

test("B4: net 30.000 ₺, Temmuz–Aralık 2026, iki kişi: SGK 25.956,18; panelin basit brütü 35.294,12", () => {
  const staff: StaffMonths[] = [1, 2].map((id) => ({ id, name: `Personel ${id}`, months: months(7, 12, 30000) }));
  const p = taxPayroll(staff, 2026, R, { minWageSupport: false, from: "2026-06" });
  assert.deepEqual([...p.keys()], ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  for (const m of p.values()) {
    for (const s of m.people) {
      assert.equal(s.gross, 35314.52, m.month);
      assert.equal(s.gv, 0, m.month);
      assert.equal(s.dv, 17.34, m.month);
      assert.equal(s.cost, 42995.43, m.month);
      assert.deepEqual([s.isciSgk, s.isciIssizlik, s.isverenSgk, s.isverenIssizlik], [4944.03, 353.15, 6974.62, 706.29]);
    }
    assert.equal(m.totals.sgkTotal, 25956.18, m.month);
    assert.equal(m.totals.people, 2);
  }
  // Hesaplanan vergi istisnanın altında: Temmuz 4.502,60 < 4.537,75
  assert.equal(p.get("2026-07")!.people[0].gvHesap, 4502.6);
  const one = [...p.values()].map((m) => m.people[0]);
  assert.equal(sum(one.map((s) => s.gross)), 211887.12);
  assert.equal(sum(one.map((s) => s.dv)), 104.04);
  assert.equal(sum(one.map((s) => s.cost)), 257972.58);
  assert.equal(r2(staffCost({ id: 1, name: "x", netSalary: 30000, extras: 0, active: true }, ds.settings).gross), 35294.12);
});

test("B5: prime esas kazancın üst sınırı", () => {
  const s = payslipFromGross(400000, { month: 1, cumPrev: 0, rates });
  assert.equal(s.pekBase, 297270);
  assert.equal(s.isciSgk, 41617.8);
  assert.equal(s.isverenSgk, r2(297270 * 0.1975));
  assert.equal(s.gvMatrah, r2(400000 - 41617.8 - 2972.7));
});

test("B6: ek ödemeler yalnız maliyete eklenir; gelir vergisi matrahına girmez", () => {
  const a = payslipFromNet(30000, { month: 9, cumPrev: 0, rates });
  const b = payslipFromNet(30000, { month: 9, cumPrev: 0, rates, extras: 2500 });
  assert.equal(b.gross, a.gross);
  assert.equal(b.gvMatrah, a.gvMatrah);
  assert.equal(b.gv, a.gv);
  assert.equal(b.cost, r2(a.cost + 2500));
  assert.equal(b.extras, 2500);
});

test("B7: asgari ücret desteği açıksa iki kişide SGK'dan 2.539,80 düşülür", () => {
  const staff: StaffMonths[] = [1, 2].map((id) => ({ id, name: `P${id}`, months: months(9, 9, 30000) }));
  const off = taxPayroll(staff, 2026, R, { minWageSupport: false, from: "2026-01" }).get("2026-09")!;
  const on = taxPayroll(staff, 2026, R, { minWageSupport: true, from: "2026-01" }).get("2026-09")!;
  assert.equal(on.totals.support, 2539.8);
  assert.equal(on.totals.sgkTotal, r2(off.totals.sgkTotal - 2539.8));
});

test("B8: kümülatif matrah yılbaşında sıfırlanır", () => {
  const dec = taxPayroll([{ id: 1, name: "A", months: months(1, 12, 40000) }], 2026, R, { minWageSupport: false, from: "2026-01" }).get("2026-12")!;
  const jan = taxPayroll([{ id: 1, name: "A", months: [{ month: "2027-01", net: 40000, extras: 0 }] }], 2027, R, { minWageSupport: false, from: "2027-01" }).get("2027-01")!;
  assert.ok(dec.people[0].cumBase > 500000);
  assert.equal(jan.people[0].cumBase, 42253.26);
  assert.equal(jan.people[0].gross, 49709.72);
  // Hesap döneminden önceki aylar hesaplanmaz
  const late = taxPayroll([{ id: 1, name: "A", months: months(1, 12, 40000) }], 2026, R, { minWageSupport: false, from: "2026-06" });
  assert.equal([...late.keys()][0], "2026-06");
  assert.equal(late.get("2026-06")!.people[0].cumBase, 42253.26);
});

test("B9: modelden bordro Ayarlar'dan bağımsız (yasal %19,75); Gelir-gider'in staffCost'u değişmez", () => {
  assert.equal(ds.settings.isverenSgk, 0.1575);
  const model = createModel(ds);
  const p = taxPayrollFromModel(model, 2026, DEFAULT_TAX_SETTINGS);
  // Personelin başlangıç ayı boş: ilk satış ayından (Temmuz) başlar; hesap dönemi 25.06'da başlar
  assert.equal([...p.keys()][0], "2026-07");
  assert.deepEqual([...p.keys()].at(-1), "2026-12");
  const sep = p.get("2026-09")!;
  assert.equal(sep.totals.isverenSgk, r2(2 * 6974.62));
  assert.equal(sep.totals.sgkTotal, 25956.18);
  assert.equal(sep.totals.cost, 85990.86);
  // Gelir-gider Ayarlar'ın oranıyla kalır: Eylül 60.000 + 23.117,65
  const pnl = model.pnlMonth("2026-09");
  assert.equal(r2(pnl.cells.get("personnel:net")!.value! + pnl.cells.get("personnel:employer")!.value!), 83117.65);
  // Elle oran ve destek ayardan
  const ov = taxPayrollFromModel(model, 2026, { ...DEFAULT_TAX_SETTINGS, minWageSupport: true }, { "sgk.isverenOran": 0.1475 }).get("2026-09")!;
  assert.equal(ov.totals.isverenSgk, r2(2 * r2(35314.52 * 0.1475)));
  assert.equal(ov.totals.support, 2539.8);
  // 2027: tablo yok, 2026 kurallarıyla (tahmini) ve kümülatif sıfırdan
  const next = taxPayrollFromModel(model, 2027, DEFAULT_TAX_SETTINGS);
  assert.equal(next.get("2027-01")!.estimated, true);
  const jan = next.get("2027-01")!.people[0];
  assert.equal(jan.cumBase, jan.gvMatrah);
  assert.equal(jan.net, 30000);
});

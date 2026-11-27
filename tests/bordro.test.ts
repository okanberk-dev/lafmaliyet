// Yasal bordro ve stopaj kuralları (src/lib/bordro; eski Vergi bölümünden, Vergi bölümü 27 Kasım 2026'da kaldırıldı):
// kural tablosunun bütünlüğü, bilinmeyen yıl, elle SGK işveren oranı, saklı ayarın okunması, stopaj oranları; bordro:
// asgari ücret istisnası, netten brüt, kümülatif matrah, prime esas kazancın üst sınırı, ek ödemeler, asgari ücret
// desteği, yıl değişimi ve Ayarlar'dan bağımsızlık. Oranlar kural tablosunun: işçi %14 + %1, işveren %19,75 + %2.
// Nakit planının maaş ve SGK satırı bu bordroyla; rakamlar Vergi bölümündekiyle kuruşuna kadar aynı kalır.
// Çalıştırma: npx tsx --test tests/bordro.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  incomeTax,
  minWageExemption,
  payrollByMonth,
  payrollFromModel,
  payrollRates,
  payslipFromGross,
  payslipFromNet,
  type StaffMonths,
} from "../src/lib/bordro/payroll";
import { allRules, findRule, PAYROLL_RULES, r2, RULES_COMPILED_AT, rulesFor } from "../src/lib/bordro/rules";
import { DEFAULT_PAYROLL_SETTINGS, parsePayrollSettings, PAYROLL_SETTINGS_KEY } from "../src/lib/bordro/settings";
import { isForeignWithholding, paidFixedRates, paidWithholdingRate, withholdingRate } from "../src/lib/bordro/stopaj";
import { createModel, rentWithholdingRate, staffCost } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
const R = rulesFor(2026).rules;
const rates = payrollRates(R);
const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
const months = (from: number, to: number, net: number, extras = 0) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ month: `2026-${String(from + i).padStart(2, "0")}`, net, extras }));

// ---------------------------------------------------------------- Kural tablosu

test("A1: her kuralda başlık, dayanak, https kaynak (kısa adlı), güven ve başlangıç günü var; anahtar yoluyla aynı", () => {
  const rules = allRules(R);
  assert.equal(rules.length, 13, `kural sayısı ${rules.length}`);
  const keys = new Set<string>();
  for (const r of rules) {
    assert.ok(r.title.trim().length > 3, r.key);
    assert.ok(r.basis.trim().length > 3, `${r.key} dayanak`);
    assert.ok(r.sources.length >= 1, `${r.key} kaynak`);
    for (const s of r.sources) {
      assert.match(s.url, /^https:\/\//, `${r.key} ${s.url}`);
      assert.ok(s.label.length >= 3 && s.label.length <= 60, `${r.key} kaynak adı kısa: ${s.label}`);
    }
    assert.ok(["kesin", "muhtemel", "belirsiz"].includes(r.confidence), r.key);
    assert.match(r.appliesFrom, /^\d{4}-\d{2}-\d{2}$/, r.key);
    assert.equal(findRule(R, r.key), r, `${r.key} tablodaki yoluyla bulunur`);
    assert.ok(!keys.has(r.key), `${r.key} tekrar`);
    keys.add(r.key);
  }
  assert.equal(RULES_COMPILED_AT, "2026-10-24");
  // Yalnız SGK işveren payı elle değişir (saklı ayardan); üst sınırı indirimsiz yasal oran
  assert.deepEqual(
    rules.filter((r) => r.overridable).map((r) => r.key),
    ["sgk.isverenOran"],
  );
});

test("A2: 2026 değerleri ve türetilen kontroller", () => {
  assert.equal(R.ucret.asgariBrut.value, 33030);
  assert.equal(R.sgk.pek.value.ust, 9 * R.sgk.pek.value.alt);
  assert.equal(R.sgk.pek.value.ust, 297270);
  assert.equal(r2(R.ucret.asgariBrut.value * R.ucret.damgaOrani.value), 250.7);
  assert.equal(R.sgk.isverenOran.value, 0.1975);
  assert.equal(R.sgk.isverenOran.overrideMax, 0.2175);
  assert.equal(Math.round((R.sgk.isverenOran.overrideMax! - 0.02) * 10_000) / 10_000, R.sgk.isverenOran.value);
  // Asgari net: 33.030 − %14 − %1
  assert.equal(r2(R.ucret.asgariBrut.value * (1 - R.sgk.isciOran.value - R.sgk.isciIssizlik.value)), 28075.5);
  assert.equal(r2(R.ucret.asgariIstisna.value.reduce((a, b) => a + b, 0)), 57881.23);
  assert.equal(R.sgk.asgariUcretDestegi.value, 42.33);
});

test("A3: 2027 tablosu yok → 2026 değerleri, tahmini; tablo kopyalanır", () => {
  const r = rulesFor(2027);
  assert.equal(r.estimated, true);
  assert.equal(r.fromYear, 2026);
  assert.equal(r.year, 2027);
  assert.deepEqual(allRules(r.rules).map((x) => [x.key, x.value]), allRules(R).map((x) => [x.key, x.value]));
  assert.equal(rulesFor(2026).estimated, false);
  assert.equal(rulesFor(2029).fromYear, 2026);
  assert.equal(rulesFor(2020).fromYear, 2026, "bilinen ilk yıldan önce: ilk yıl");
  rulesFor(2026, { "sgk.isverenOran": 0.1475 });
  assert.equal(PAYROLL_RULES[2026].sgk.isverenOran.value, 0.1975, "elle değer başka çağrıya sızmaz");
});

test("A4: elle değer yalnız SGK işveren payına ve sınırı içinde uygulanır", () => {
  const r = rulesFor(2026, { "sgk.isverenOran": 0.1475 }).rules.sgk.isverenOran;
  assert.equal(r.value, 0.1475);
  assert.equal(r.override?.table, 0.1975);
  assert.equal(rulesFor(2026, { "sgk.isverenOran": { value: 0.1675 } }).rules.sgk.isverenOran.value, 0.1675, "saklanan biçim");
  assert.equal(rulesFor(2026, { "sgk.isverenOran": 0.3 }).rules.sgk.isverenOran.value, 0.1975, "üst sınırı aşan");
  assert.equal(rulesFor(2026, { "sgk.isverenOran": -0.1 }).rules.sgk.isverenOran.value, 0.1975);
  assert.equal(rulesFor(2026, { "sgk.isverenOran": Number.NaN }).rules.sgk.isverenOran.value, 0.1975);
  assert.equal(rulesFor(2026, { "sgk.isciOran": 0.1 }).rules.sgk.isciOran.value, 0.14, "elle değiştirilemeyen kural");
  assert.equal(rulesFor(2026, { "stopaj.kira": 0.1 }).rules.stopaj.kira.value, 0.2);
  assert.equal(rulesFor(2026, { "yok.boyle": 1 }).rules.sgk.isverenOran.value, 0.1975);
});

test("saklı ayar (tax.settings, eski Vergi ayarları): yalnız bordronun üç alanı okunur; bozuk alan varsayılana düşer", () => {
  assert.equal(PAYROLL_SETTINGS_KEY, "tax.settings");
  assert.deepEqual(parsePayrollSettings(undefined), DEFAULT_PAYROLL_SETTINGS);
  assert.deepEqual(DEFAULT_PAYROLL_SETTINGS, { periodStart: "2026-06-25", minWageSupport: false, overrides: {} });
  // Eski Vergi ayarlarının bütün kaydı: bordroya ait olmayan alanlar ve elle değerler atılır
  const stored = {
    periodStart: "2026-07-01",
    firstActivity: "ilk",
    quarterDepreciation: "ay12",
    muhtasarQuarterly: true,
    minWageSupport: true,
    includeSeparate: true,
    carriedLoss: { amount: 1000, note: "", by: "", date: "" },
    manualRows: { "manual:su": "belgeli" },
    overrides: {
      "sgk.isverenOran": { value: 0.1475, note: "muhasebeci", by: "Okan", date: "2026-11-01" },
      "damga.gecici": { value: 820, note: "", by: "", date: "" },
      "sgk.isciOran": { value: 0.1, note: "", by: "", date: "" },
    },
    checks: { sgk_oran: { by: "Okan", date: "2026-11-01", note: null } },
  };
  assert.deepEqual(parsePayrollSettings(stored), { periodStart: "2026-07-01", minWageSupport: true, overrides: { "sgk.isverenOran": { value: 0.1475 } } });
  // Bozuk alanlar
  assert.deepEqual(parsePayrollSettings({ periodStart: "2026-13-40", minWageSupport: "evet", overrides: { "sgk.isverenOran": { value: 0.5 } } }), DEFAULT_PAYROLL_SETTINGS);
  assert.equal(parsePayrollSettings({ periodStart: "1999-12-31" }).periodStart, "2026-06-25");
  assert.deepEqual(parsePayrollSettings([]), DEFAULT_PAYROLL_SETTINGS);
});

test("stopaj: profilin oranı; ödemeden kesilen yalnız Türkiye'de şahsa; yurt dışında KDV yok; Gelir-gider'in kira stopajı %20", () => {
  assert.equal(withholdingRate("kira", R), 0.2);
  assert.equal(withholdingRate("serbest_meslek", R), 0.2);
  assert.equal(withholdingRate("internet_reklam", R), 0.15);
  assert.equal(withholdingRate("internet_reklam_yurtdisi", R), 0.15);
  assert.equal(withholdingRate("yurt_disi_hizmet", R), 0);
  assert.equal(withholdingRate("yok", R), 0);
  assert.equal(withholdingRate(null, R), 0);
  assert.equal(paidWithholdingRate("kira", 2026), 0.2);
  assert.equal(paidWithholdingRate("internet_reklam", 2026), 0.15);
  assert.equal(paidWithholdingRate("internet_reklam_yurtdisi", 2026), 0, "yurt dışına ödenende ödemeden kesilmez");
  assert.equal(paidWithholdingRate("yurt_disi_hizmet", 2026), 0);
  assert.equal(paidWithholdingRate(null, 2027), 0);
  assert.equal(paidWithholdingRate("kira", 2027), 0.2, "2027 tablosu yok: 2026 oranı");
  assert.equal(isForeignWithholding("yurt_disi_hizmet"), true);
  assert.equal(isForeignWithholding("kira"), false);
  assert.deepEqual(paidFixedRates({ taxWithholding: "kira", vatRate: 0 }, 2026), { taxWithholding: "kira", vatRate: 0, withholdingRate: 0.2 });
  assert.deepEqual(paidFixedRates({ taxWithholding: "yurt_disi_hizmet", vatRate: 0.2 }, 2026), { taxWithholding: "yurt_disi_hizmet", vatRate: 0, withholdingRate: 0 });
  assert.deepEqual(paidFixedRates({ taxWithholding: null, vatRate: 0.2 }, 2026), { taxWithholding: null, vatRate: 0.2, withholdingRate: 0 });
  assert.equal(rentWithholdingRate("2026-10"), 0.2);
  assert.equal(rentWithholdingRate("2027-01"), 0.2);
});

// ---------------------------------------------------------------- Bordro

test("A2: ücret tarifesinin kümülatifleri", () => {
  assert.equal(incomeTax(190000, R.ucret.tarife.value), 28500);
  assert.equal(incomeTax(400000, R.ucret.tarife.value), 70500);
  assert.equal(incomeTax(1500000, R.ucret.tarife.value), 367500);
  assert.equal(incomeTax(5300000, R.ucret.tarife.value), 1697500);
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
  const p = payrollByMonth([{ id: 1, name: "A", months: months(1, 12, 40000) }], 2026, R, { minWageSupport: false, from: "2026-01" });
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
  const p = payrollByMonth(staff, 2026, R, { minWageSupport: false, from: "2026-06" });
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
  const off = payrollByMonth(staff, 2026, R, { minWageSupport: false, from: "2026-01" }).get("2026-09")!;
  const on = payrollByMonth(staff, 2026, R, { minWageSupport: true, from: "2026-01" }).get("2026-09")!;
  assert.equal(on.totals.support, 2539.8);
  assert.equal(on.totals.sgkTotal, r2(off.totals.sgkTotal - 2539.8));
});

test("B8: kümülatif matrah yılbaşında sıfırlanır", () => {
  const dec = payrollByMonth([{ id: 1, name: "A", months: months(1, 12, 40000) }], 2026, R, { minWageSupport: false, from: "2026-01" }).get("2026-12")!;
  const jan = payrollByMonth([{ id: 1, name: "A", months: [{ month: "2027-01", net: 40000, extras: 0 }] }], 2027, R, { minWageSupport: false, from: "2027-01" }).get("2027-01")!;
  assert.ok(dec.people[0].cumBase > 500000);
  assert.equal(jan.people[0].cumBase, 42253.26);
  assert.equal(jan.people[0].gross, 49709.72);
  // Hesap döneminden önceki aylar hesaplanmaz
  const late = payrollByMonth([{ id: 1, name: "A", months: months(1, 12, 40000) }], 2026, R, { minWageSupport: false, from: "2026-06" });
  assert.equal([...late.keys()][0], "2026-06");
  assert.equal(late.get("2026-06")!.people[0].cumBase, 42253.26);
});

test("B9: modelden bordro Ayarlar'dan bağımsız (yasal %19,75); Gelir-gider'in staffCost'u değişmez", () => {
  assert.equal(ds.settings.isverenSgk, 0.1575);
  const model = createModel(ds);
  const p = payrollFromModel(model, 2026, DEFAULT_PAYROLL_SETTINGS);
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
  const ov = payrollFromModel(model, 2026, { ...DEFAULT_PAYROLL_SETTINGS, minWageSupport: true }, { "sgk.isverenOran": 0.1475 }).get("2026-09")!;
  assert.equal(ov.totals.isverenSgk, r2(2 * r2(35314.52 * 0.1475)));
  assert.equal(ov.totals.support, 2539.8);
  // 2027: tablo yok, 2026 kurallarıyla (tahmini) ve kümülatif sıfırdan
  const next = payrollFromModel(model, 2027, DEFAULT_PAYROLL_SETTINGS);
  assert.equal(next.get("2027-01")!.estimated, true);
  const jan = next.get("2027-01")!.people[0];
  assert.equal(jan.cumBase, jan.gvMatrah);
  assert.equal(jan.net, 30000);
});

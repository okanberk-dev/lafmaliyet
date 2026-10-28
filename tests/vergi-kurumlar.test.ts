// Geçici ve kurumlar vergisi (plan docs/planlar/vergi.md §3.7, §3.8, §11-C): kümülatif hesap, asgari kurumlar vergisi
// ve muafiyeti, önceki dönemlerin mahsubu, muhasebecinin kaydı (çapa ya da matrahsız), yalnız "Ödendi" işaretli geçici
// verginin mahsubu, damgalar, taslak ve hazır durumu; Excel verisinde kafenin 2026/3 katkısı (Örnek C).
// Çalıştırma: npx tsx --test tests/vergi-kurumlar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { MANUAL_PNL_ROWS } from "../src/lib/constants";
import { assetTotals, type TaxAsset } from "../src/lib/tax/assets";
import { type CorpInput, type CorpQuarterInput, corporateTax, minTaxText, quarterTaxes, type TaxFiling, unpaidText } from "../src/lib/tax/corporate";
import { taxMonths, taxPnlInputFromModel, taxQuarters } from "../src/lib/tax/pnl";
import { r2 } from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from "../src/lib/tax/settings";
import { geciciStamp, kvStamps } from "../src/lib/tax/stamp";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const S_A: TaxSettings = { ...DEFAULT_TAX_SETTINGS, periodStart: "2026-01-01" };
const close = (a: number, b: number, msg: string, eps = 0.0101) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

// ---------------------------------------------------------------- Örnek A: tam yıl 2026 (varsayımsal)

/** 2 asgari ücretli, çeyrekte 3 × 2 × 40.214,03 */
const PERSONEL_Q = r2(3 * 2 * 40214.03);
const ASSETS: TaxAsset[] = [
  { id: 1, name: "A1", invoiceId: null, invoiceLabel: null, acquiredOn: "2026-02-10", cost: 600000, kind: "demirbas", method: "amortisman", lifeYears: 5 },
  { id: 2, name: "A2", invoiceId: null, invoiceLabel: null, acquiredOn: "2026-08-15", cost: 240000, kind: "demirbas", method: "amortisman", lifeYears: 4 },
  { id: 3, name: "A3", invoiceId: null, invoiceLabel: null, acquiredOn: "2026-05-05", cost: 10000, kind: "demirbas", method: "dogrudan_gider", lifeYears: null },
];

function exampleA(settings: TaxSettings = S_A): CorpQuarterInput[] {
  const t = assetTotals(ASSETS, 2026, settings);
  const rows = [
    { gelir: 900000, gider: 1000000, kkeg: 0, indirim: 0 },
    { gelir: 1200000, gider: 800000, kkeg: 5000, indirim: 0 },
    { gelir: 1500000, gider: 900000, kkeg: 0, indirim: 0 },
    { gelir: 1400000, gider: 950000, kkeg: 2000, indirim: 3000 },
  ];
  return rows.map((r, i) => {
    const key = `2026-Q${i + 1}`;
    const result = r2(r.gelir - r.gider - PERSONEL_Q);
    return {
      key,
      q: i + 1,
      from: `2026-${String(3 * i + 1).padStart(2, "0")}-01`,
      to: ["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"][i],
      result,
      depreciation: t.depreciation.get(key) ?? 0,
      direct: t.direct.get(key) ?? 0,
      kkeg: r.kkeg,
      indirim: r.indirim,
      floorResult: result,
      state: "hazir",
    };
  });
}
const input = (over: Partial<CorpInput> = {}): CorpInput => ({ year: 2026, quarters: exampleA(), filings: [], settings: S_A, today: "2027-03-01", ...over });

test("C, Örnek A: geçici vergi dört çeyrek (kalan çeyreklere eşit amortisman)", () => {
  assert.equal(PERSONEL_Q, 241284.18);
  const qs = quarterTaxes(input());
  const table = qs.map((q) => [q.depreciation, q.direct, q.kkeg, q.periodResult, q.cumulative, q.matrah, q.hesaplanan, q.asgari, q.previous, q.estimate]);
  assert.deepEqual(table, [
    [30000, 0, 0, -371284.18, -371284.18, 0, 0, 0, 0, 0],
    [30000, 10000, 5000, 123715.82, -247568.36, 0, 0, 0, 0, 0],
    [60000, 0, 0, 298715.82, 51147.46, 51147.46, 12786.87, 5114.75, 0, 12786.87],
    [60000, 0, 2000, 150715.82, 201863.28, 198863.28, 49715.82, 20186.33, 12786.87, 36928.95],
  ]);
  assert.equal(qs[3].indirim, 3000);
  // Damgalar: her dönem 791,00 (sıfır beyanlar dahil); 4. dönem 2027'de verilir
  assert.equal(r2(qs.reduce((s, q) => s + q.stamp, 0)), 3164);
  assert.equal(qs[3].stampEstimated, true);
  assert.equal(qs.every((q) => q.source === "tahmin" && q.minTax === "bilinmiyor"), true);
});

test("C, Örnek A: yıllık kurumlar vergisi; yalnız ödendi işaretli geçici vergi mahsup edilir", () => {
  const all = ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"].map((period) => ({ period, amount: null }));
  const paid = corporateTax(input({ paidQuarters: all }));
  assert.equal(paid.matrah, 198863.28);
  assert.equal(paid.hesaplanan, 49715.82);
  assert.equal(paid.asgari, 20186.33);
  assert.equal(paid.minTaxBinding, false);
  assert.equal(paid.tax, 49715.82);
  assert.equal(paid.paidProvisional, 49715.82);
  assert.equal(paid.payable, 0);
  assert.equal(paid.refund, 0);
  assert.deepEqual(paid.unpaid, []);
  const q4open = corporateTax(input({ paidQuarters: all.slice(0, 3) }));
  assert.equal(q4open.paidProvisional, 12786.87);
  assert.equal(q4open.payable, 36928.95);
  assert.deepEqual(q4open.unpaid, [{ period: "2026-Q4", amount: 36928.95 }]);
  assert.equal(unpaidText("2026-Q4"), "2026/4 ödendi olarak işaretlenmedi: ödenmezse yıllık beyannamede mahsup edilemez.");
  // Ödendi anındaki hatırlatıcı tutarı mahsup edilir (kaydı yoksa); tahakkuk toplamıdır, beyanname damgası (791) düşülür
  assert.equal(corporateTax(input({ paidQuarters: [{ period: "2026-Q3", amount: 15791 }] })).paidProvisional, 15000);
  const k = kvStamps(2026);
  assert.equal(paid.stamps.total, 2516.3);
  assert.equal(k.estimated, true);
  assert.equal(paid.inProgress, false);
});

test("C: 2026/4'ün matrahlı kaydı yıllık kurumlar vergisinin çapası; ödenen dördüncü dönem iade göstermez", () => {
  const all = ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"].map((period) => ({ period, amount: null }));
  const q4: TaxFiling = { id: 9, kind: "gecici", period: "2026-Q4", payable: 112213.13, stamp: 791, values: { matrah: 500000, hesaplanan: 125000 } };
  const kv = corporateTax(input({ filings: [q4], paidQuarters: all }));
  assert.equal(kv.income, 500000);
  assert.equal(kv.indirim, 0, "çapadan sonra indirim yok");
  assert.equal(kv.matrah, 500000);
  assert.equal(kv.tax, 125000);
  assert.equal(kv.paidProvisional, 125000);
  assert.equal(kv.payable, 0);
  assert.equal(kv.refund, 0);
  // Devreden zarar çapadan da düşülür
  const loss = corporateTax(input({ filings: [q4], paidQuarters: all, settings: { ...S_A, carriedLoss: { amount: 100000, note: "2025 KV", by: "x", date: "2026-10-01" } } }));
  assert.equal(loss.loss, 100000);
  assert.equal(loss.matrah, 400000);
  // Matrahsız 2026/4 kaydı çapa değil: panelin kümülatifi
  const bare = corporateTax(input({ filings: [{ ...q4, values: {} }], paidQuarters: all }));
  assert.equal(bare.income, 201863.28);
  assert.equal(bare.matrah, 198863.28);
});

test("C: hatırlatıcının tahakkuk toplamındaki beyanname damgası mahsup edilmez (sıfır beyan yalnız damga)", () => {
  const qs: CorpQuarterInput[] = [
    { key: "2026-Q2", q: 2, from: "2026-06-25", to: "2026-06-30", result: -5000, depreciation: 0, direct: 0, kkeg: 0, indirim: 0, floorResult: 0, state: "hazir" },
    { key: "2026-Q3", q: 3, from: "2026-07-01", to: "2026-09-30", result: 100000, depreciation: 0, direct: 0, kkeg: 0, indirim: 0, floorResult: 0, state: "hazir" },
    { key: "2026-Q4", q: 4, from: "2026-10-01", to: "2026-12-31", result: 100000, depreciation: 0, direct: 0, kkeg: 0, indirim: 3000, floorResult: 0, state: "hazir" },
  ];
  const base = { year: 2026, quarters: qs, filings: [], settings: { ...DEFAULT_TAX_SETTINGS }, today: "2027-03-01" };
  const c = quarterTaxes(base);
  assert.deepEqual(
    c.map((x) => [x.key, x.estimate, x.stamp]),
    [
      ["2026-Q2", 0, 791],
      ["2026-Q3", 23750, 791],
      ["2026-Q4", 24250, 791],
    ],
  );
  // Ödemeler'deki hatırlatıcıya tahakkuk toplamı (vergi + 791 damga) yazılıp "Ödendi" denmiş
  const paid = c.map((x) => ({ period: x.key, amount: r2(x.estimate + x.stamp) }));
  const kv = corporateTax({ ...base, paidQuarters: paid }, c);
  assert.deepEqual([kv.tax, kv.paidProvisional, kv.payable, kv.refund], [48000, 48000, 0, 0]);
  // Yalnız damga ödenmiş sıfır beyan 0 mahsup eder
  assert.deepEqual(corporateTax({ ...base, paidQuarters: [{ period: "2026-Q2", amount: 791 }] }, c).paidQuarters, [{ period: "2026-Q2", amount: 0 }]);
});

test("C: asgari vergi: ilk defa faaliyete başlayan şirkette 2026–2028 uygulanmaz; işaretlenmediyse hesaplanır", () => {
  const ilk = { ...S_A, firstActivity: "ilk" as const };
  const qs = quarterTaxes(input({ settings: ilk }));
  assert.ok(qs.every((q) => q.asgari === null && q.minTax === "muaf"));
  assert.deepEqual(
    qs.map((q) => q.estimate),
    [0, 0, 12786.87, 36928.95],
  );
  assert.equal(minTaxText(2026, ilk), "Asgari kurumlar vergisi: uygulanmaz (ilk 3 hesap dönemi, 2026–2028)");
  assert.equal(minTaxText(2026, S_A), "Asgari kurumlar vergisi: uygulandı; muafiyet için ilk defa faaliyete başlama işaretlenmedi (Kurallar › Vergi ayarları)");
  assert.equal(corporateTax(input({ settings: ilk })).asgari, null);
});

test("C, Örnek B: asgari vergi bağlar (2029; 2026 kuralları); zarar asgari matrahtan düşülmez", () => {
  const q = (n: number, result: number): CorpQuarterInput => ({
    key: `2029-Q${n}`,
    q: n,
    from: `2029-${String(3 * n - 2).padStart(2, "0")}-01`,
    to: ["2029-03-31", "2029-06-30", "2029-09-30", "2029-12-31"][n - 1],
    result,
    depreciation: 0,
    direct: 0,
    kkeg: 0,
    indirim: 0,
    floorResult: result,
    state: "hazir",
  });
  const settings = (loss: number): TaxSettings => ({ ...S_A, firstActivity: "ilk", carriedLoss: { amount: loss, note: "2028 KV", by: "x", date: "2029-04-20" } });
  const base = { year: 2029, quarters: [q(1, 0), q(2, 0), q(3, 0), q(4, 1000000)], filings: [], today: "2030-03-01" };
  const b = corporateTax({ ...base, settings: settings(900000) });
  assert.equal(b.matrah, 100000);
  assert.equal(b.hesaplanan, 25000);
  assert.equal(b.asgari, 100000);
  assert.equal(b.tax, 100000);
  assert.equal(b.minTaxBinding, true);
  assert.equal(b.loss, 900000);
  const over = corporateTax({ ...base, settings: settings(1200000) });
  assert.equal(over.loss, 1000000);
  assert.equal(over.matrah, 0);
  assert.equal(over.tax, 100000);
  // Devreden zarar önceki yılın kurumlar vergisi kaydından da gelir
  const viaFiling = corporateTax({ ...base, settings: { ...S_A, firstActivity: "ilk" }, filings: [{ id: 1, kind: "kv", period: "2028", payable: 0, stamp: 0, values: { devredenZarar: 900000 } }] });
  assert.equal(viaFiling.matrah, 100000);
});

test("C: muhasebecinin kaydı: matrahlı kayıt sonraki dönemin çapası; matrahsız kayıt kesin ama çapa değil", () => {
  const anchor: TaxFiling = { id: 1, kind: "gecici", period: "2026-Q3", payable: 100000, stamp: 791, values: { matrah: 400000, hesaplanan: 100000 } };
  const qs = quarterTaxes(input({ filings: [anchor] }));
  assert.equal(qs[2].payable, 100000);
  assert.equal(qs[2].source, "Muhasebeci");
  assert.equal(qs[3].anchor?.period, "2026-Q3");
  assert.equal(qs[3].cumulative, 550715.82);
  assert.equal(qs[3].matrah, 547715.82);
  assert.equal(qs[3].hesaplanan, 136928.96);
  assert.equal(qs[3].previous, 100000);
  assert.equal(qs[3].estimate, 36928.96);
  const bare: TaxFiling = { id: 2, kind: "gecici", period: "2026-Q3", payable: 100000, stamp: 791, values: {} };
  const qb = quarterTaxes(input({ filings: [bare] }));
  assert.equal(qb[2].payable, 100000);
  assert.equal(qb[2].noAnchor, true);
  assert.equal(qb[3].anchor, null);
  assert.equal(qb[3].cumulativeTax, 49715.82);
  assert.equal(qb[3].previous, 100000);
  assert.equal(qb[3].estimate, 0);
});

test("C: indirim zarar yaratmaz (kümülatif 2.000, indirim 3.000 → matrah 0)", () => {
  const one: CorpQuarterInput = { key: "2026-Q1", q: 1, from: "2026-01-01", to: "2026-03-31", result: 2000, depreciation: 0, direct: 0, kkeg: 0, indirim: 3000, floorResult: 2000, state: "hazir" };
  const [q] = quarterTaxes(input({ quarters: [one] }));
  assert.equal(q.cumulative, 2000);
  assert.equal(q.matrah, 0);
  assert.equal(q.hesaplanan, 0);
  assert.equal(q.asgari, 200);
  assert.equal(geciciStamp("2026-Q1").amount, 791);
});

// ---------------------------------------------------------------- Excel verisi (Örnek C) ve durum

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const TODAY = "2026-10-24";

function excel(dsOver: Partial<Dataset> = {}, settings: TaxSettings = DEFAULT_TAX_SETTINGS, filings: TaxFiling[] = []) {
  const model = createModel({ ...base, ...dsOver });
  const pnl = taxPnlInputFromModel(model, { settings, today: TODAY, adjustments: [], assets: [], filings });
  const months = taxMonths(pnl, 2026);
  const quarters = taxQuarters(pnl, months, 2026);
  return { quarters, corp: quarterTaxes({ year: 2026, quarters, filings, settings, today: TODAY }) };
}

test("C, Örnek C: kafenin 2026/3 katkısı: hesaplanan 68.887,00, asgari 27.554,80 (bağlamıyor), taslak, alt sınır 0", () => {
  const { corp } = excel();
  const q3 = corp.find((q) => q.key === "2026-Q3")!;
  assert.equal(q3.state, "taslak");
  assert.equal(q3.minTax, "bilinmiyor");
  close(q3.hesaplanan, 68887.0, "hesaplanan");
  close(q3.asgari!, 27554.8, "asgari");
  close(q3.estimate, 68887.0, "kafenin katkısı");
  assert.equal(q3.floor.estimate, 0);
  assert.equal(q3.floor.matrah, 0);
  assert.equal(q3.from, "2026-06-25");
  // 2026/2: yalnız 25–30 Haziran, veri yok
  assert.equal(corp.find((q) => q.key === "2026-Q2")!.estimate, 0);
});

test("C: durum: sınıflandırma tam, gelir mali belgeden ve kafe dışı işler konuşulunca 'hazır'", () => {
  const fixedExpenses = base.fixedExpenses.map((f) => ({ ...f, taxDoc: f.section === "personel" ? ("bordro" as const) : ("belgeli" as const) }));
  const invoices = base.invoices.map((i) => (["Aria Yazılım", "Beyza Karaman"].includes(i.supplier) ? { ...i, taxNotAsset: true } : i));
  const manualRows = Object.fromEntries(MANUAL_PNL_ROWS.map((r) => [r.key, r.section === "personel" ? "bordro" : "belgeli"])) as TaxSettings["manualRows"];
  const filings: TaxFiling[] = ["2026-07", "2026-08", "2026-09"].map((period, i) => ({ id: i + 1, kind: "kdv_matrah", period, payable: 0, stamp: 0, values: { m10: 100000, m20: 0, kafeDisi: 0 } }));
  const mark = { by: "Ayşe", date: "2026-10-24", note: null };
  // Yalnız sınıflandırma: gelir hâlâ yönetim verisi → taslak
  const partly = excel({ fixedExpenses, invoices }, { ...DEFAULT_TAX_SETTINGS, manualRows });
  const p3 = partly.quarters.find((q) => q.key === "2026-Q3")!;
  assert.equal(p3.state, "taslak");
  assert.deepEqual(p3.stateReasons, ["Gelir mali belgeden girilmedi", "Kafe dışı işler muhasebeciyle konuşulmadı"]);
  const ready = excel({ fixedExpenses, invoices }, { ...DEFAULT_TAX_SETTINGS, manualRows, checks: { kafe_disi: mark } }, filings);
  const r3 = ready.quarters.find((q) => q.key === "2026-Q3")!;
  assert.deepEqual(r3.stateReasons, []);
  assert.equal(r3.state, "hazir");
  assert.equal(ready.corp.find((q) => q.key === "2026-Q3")!.state, "hazir");
  // Ekim hâlâ yönetim verisi: 2026/4 taslak
  assert.equal(ready.quarters.find((q) => q.key === "2026-Q4")!.state, "taslak");
});

// Muhtasar ve prim hizmet beyannamesinin vergi kısmı (plan docs/planlar/vergi.md §3.5, §11-F): Excel'in iki personeli
// (Örnek D), stopaj profilleri ve yurt dışı hizmetin KDV-2'si, "en az", personelsiz ay, üç aylık seçenek, muhasebecinin
// kaydı.
// Çalıştırma: npx tsx --test tests/vergi-muhtasar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset, FixedExpense } from "../src/lib/calc/types";
import { type MuhtasarItem, muhtasarItemsFromModel, muhtasarMonth, muhtasarMonths, muhtasarTitle, withholdingUnknown } from "../src/lib/tax/muhtasar";
import { taxPayrollFromModel } from "../src/lib/tax/payroll";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };

function setup(fixed: FixedExpense[] = base.fixedExpenses) {
  const model = createModel({ ...base, fixedExpenses: fixed });
  const payroll = taxPayrollFromModel(model, 2026, DEFAULT_TAX_SETTINGS);
  const input = (period: string) => ({ period, payroll: payroll.get(period), items: muhtasarItemsFromModel(model, period) });
  return { model, payroll, input };
}
const withProfile = (profiles: Record<string, FixedExpense["taxWithholding"]>) =>
  base.fixedExpenses.map((f) => (f.name in profiles ? { ...f, taxDoc: "belgeli" as const, taxWithholding: profiles[f.name] } : f));

test("F, Örnek D (Eylül 2026, iki personel, profil yok): en az 974,38; 4 kalemin stopajı bilinmiyor", () => {
  const { input } = setup();
  const m = muhtasarMonth(input("2026-09"));
  assert.equal(m.ucretGv, 0);
  assert.equal(m.ucretDv, 34.68);
  assert.equal(m.damga, 939.7);
  assert.equal(m.damgaKind, "mphb");
  assert.equal(m.payable, 974.38);
  assert.equal(m.atLeast, true);
  assert.deepEqual(m.unknown, ["Kira", "Instagram reklamı", "Influencer", "Muhasebeci"]);
  assert.equal(m.nominal, "2026-10-26");
  assert.equal(m.due, "2026-10-26");
  assert.equal(m.source, "tahmin");
  assert.equal(m.empty, false);
  assert.equal(muhtasarTitle("2026-09"), "Muhtasar ve prim hizmet (Eylül)");
});

test("F: stopaj profilleri: kira %20, serbest meslek %20, yurt dışına internet reklamı %15 + KDV-2 %20; toplam 39.474,38", () => {
  const { input } = setup(withProfile({ Kira: "kira", Muhasebeci: "serbest_meslek", "Instagram reklamı": "internet_reklam_yurtdisi", Influencer: "yok" }));
  const m = muhtasarMonth(input("2026-09"));
  assert.deepEqual(
    m.stopaj.map((s) => [s.name, s.base, s.rate, s.amount]),
    [
      ["Kira", 160000, 0.2, 32000],
      ["Instagram reklamı", 30000, 0.15, 4500],
      ["Muhasebeci", 10000, 0.2, 2000],
    ],
  );
  assert.equal(m.kdv2Hizmet, 6000);
  assert.deepEqual(m.unknown, []);
  assert.equal(m.atLeast, false);
  assert.equal(m.payable, 39474.38);
});

test("F: 'Stopaj yok' seçilen kalem bilinmeyen sayılmaz; Paraşüt faturası, bordro ve belgesiz kalem de", () => {
  const item = (over: Partial<MuhtasarItem>): MuhtasarItem => ({ id: 1, name: "Kira", section: "kira", amount: 1000, withholding: null, doc: null, ...over });
  assert.equal(withholdingUnknown(item({})), true);
  assert.equal(withholdingUnknown(item({ withholding: "yok" })), false);
  assert.equal(withholdingUnknown(item({ doc: "fatura" })), false);
  assert.equal(withholdingUnknown(item({ name: "Ortak gider avansı (Opera)" })), false);
  assert.equal(withholdingUnknown(item({ name: "Depo kirası", section: "genel" })), true);
  assert.equal(withholdingUnknown(item({ name: "Elektrik", section: "faturalar" })), false);
  // Sabit giderden aylık girişe çevrilen reklam kategorisi "en az"dan düşmez
  assert.equal(withholdingUnknown(item({ name: "Sosyal medya ajansı", section: "genel", category: true, panelGroup: "reklam" })), true);
  assert.equal(withholdingUnknown(item({ amount: 0 })), false);
});

test("F: personelsiz, yalnız stopaj: muhtasar damgası 791,00; hiçbiri yoksa beyanname yok", () => {
  const only = muhtasarMonth({ period: "2026-09", items: [{ id: 1, name: "Kira", section: "kira", amount: 10000, withholding: "kira", doc: "belgeli" }] });
  assert.equal(only.people, 0);
  assert.equal(only.damga, 791);
  assert.equal(only.damgaKind, "muhtasar");
  assert.equal(only.payable, 2791);
  const none = muhtasarMonth({ period: "2026-09", items: [] });
  assert.equal(none.empty, true);
  assert.equal(none.payable, 0);
});

test("F: üç aylık seçenek: Temmuz ve Ağustos'ta yalnız damga, Eylül'de üç ayın vergisi + damga", () => {
  const { input } = setup(withProfile({ Kira: "kira" }));
  const ms = muhtasarMonths(["2026-07", "2026-08", "2026-09"].map(input), { quarterly: true });
  const jul = ms.get("2026-07")!;
  const aug = ms.get("2026-08")!;
  const sep = ms.get("2026-09")!;
  assert.equal(jul.deferred, true);
  assert.equal(jul.payable, 939.7);
  assert.equal(aug.payable, 939.7);
  assert.equal(sep.deferred, false);
  assert.equal(sep.vergiPayable, Math.round((jul.vergi + aug.vergi + sep.vergi) * 100) / 100);
  assert.equal(sep.payable, Math.round((sep.vergiPayable + 939.7) * 100) / 100);
  // Aylıkta her ay kendi vergisi
  const monthly = muhtasarMonths(["2026-07", "2026-08", "2026-09"].map(input));
  assert.equal(monthly.get("2026-07")!.payable, Math.round((jul.vergi + 939.7) * 100) / 100);
});

test("F: muhasebecinin kaydı tahminin yerine geçer: 120 + 939,70 = 1.059,70", () => {
  const { input } = setup();
  const m = muhtasarMonth(input("2026-09"), { filings: [{ id: 1, kind: "mphb", period: "2026-09", payable: 120, stamp: 939.7, values: {} }] });
  assert.equal(m.payable, 1059.7);
  assert.equal(m.source, "Muhasebeci");
  assert.equal(m.atLeast, false);
});

test("F: Aralık beyannamesi Ocak 2027'de: damga 2026 tutarıyla, tahmini", () => {
  const { input } = setup();
  const m = muhtasarMonth(input("2026-12"));
  assert.equal(m.damga, 939.7);
  assert.equal(m.stampEstimated, true);
  assert.equal(m.due, "2027-01-26");
});

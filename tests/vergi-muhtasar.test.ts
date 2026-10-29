// Muhtasar ve prim hizmet beyannamesinin vergi kısmı (plan docs/planlar/vergi.md §3.5, §11-F): Excel'in iki personeli
// (Örnek D), stopaj profilleri ve yurt dışı hizmetin KDV-2'si, "en az", personelsiz ay, üç aylık seçenek, muhasebecinin
// kaydı.
// Çalıştırma: npx tsx --test tests/vergi-muhtasar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, shiftMonth } from "../src/lib/calc/engine";
import type { Dataset, FixedExpense } from "../src/lib/calc/types";
import { type MuhtasarItem, muhtasarItemsFromModel, muhtasarMonth, muhtasarMonths, muhtasarTitle, withholdingUnknown } from "../src/lib/tax/muhtasar";
import { taxPayrollFromModel } from "../src/lib/tax/payroll";
import { taxPnlInputFromModel } from "../src/lib/tax/pnl";
import { r2 } from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from "../src/lib/tax/settings";
import { buildTaxView } from "../src/lib/tax/view";
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

/** Vergi sayfasının görünümü (takvim ve nakit planı beslemesi); kalemler bugünden 6 ay önceden 4 ay sonrasına */
function view(today: string, over: { ds?: Partial<Dataset>; settings?: Partial<TaxSettings> } = {}) {
  const model = createModel({ ...base, currentMonth: today.slice(0, 7), ...over.ds });
  const settings = { ...DEFAULT_TAX_SETTINGS, ...over.settings };
  const pnl = taxPnlInputFromModel(model, { settings, today, adjustments: [], assets: [], filings: [] });
  const items = new Map<string, MuhtasarItem[]>();
  for (let p = shiftMonth(today.slice(0, 7), -6); p <= shiftMonth(today.slice(0, 7), 4); p = shiftMonth(p, 1)) items.set(p, muhtasarItemsFromModel(model, p));
  return buildTaxView({ today, settings, pnl, muhtasarItems: items, filings: [], reminders: [], vat: null });
}
const nb = (s: string) => s.replace(/\u00a0/g, " ");

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

test("F: personelsiz ay, stopajı bilinmeyen kalemle: beyanname boş sayılmaz; takvimde 'Tutarı bilinmiyor' ve 4 kalem, plana girmez", () => {
  const { input } = setup();
  const noStaff = (period: string) => ({ ...input(period), payroll: undefined });
  const m = muhtasarMonth(noStaff("2026-09"));
  assert.deepEqual([m.people, m.vergi, m.payable, m.atLeast, m.empty], [0, 0, 0, true, false]);
  assert.deepEqual(m.unknown, ["Kira", "Instagram reklamı", "Influencer", "Muhasebeci"]);
  const v = view("2026-10-24", { ds: { staff: [] } });
  const rows = v.calendar.filter((r) => r.kind === "mphb");
  assert.deepEqual(
    rows.map((r) => [r.period, r.amount, r.atLeast, r.amountText]),
    [
      ["2026-09", null, true, "Tahakkuk fişindeki tutarı girin"],
      ["2026-10", null, true, "Tutarı bilinmiyor"],
      ["2026-11", null, true, "Tutarı bilinmiyor"],
      ["2026-12", null, true, "Tutarı bilinmiyor"],
    ],
  );
  assert.ok(rows[0].notes.includes("4 kalemin stopajı bilinmiyor: Kira, Instagram reklamı, Influencer, Muhasebeci."));
  assert.equal(rows[0].addHref, "/panel/hatirlaticilar?yeni=muhtasar");
  // Tutarı 0 olan ay nakit planına satır olarak girmez (hatırlatıcısı "Tutarı girilmemiş ödemeler"de kalır)
  assert.deepEqual(
    v.planFeed.items.filter((i) => i.kind === "muhtasar"),
    [],
  );
  assert.deepEqual([v.stats.next.value, nb(v.stats.next.sub!)], ["Tutarı bilinmiyor", "Muhtasar · 26 Ekim"]);
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
  // Her ay ücret DV 34,68 + kira stopajı 32.000 = 32.034,68; Eylül'de üçü: 96.104,04 + 939,70 damga
  assert.deepEqual([jul.vergi, aug.vergi, sep.vergi], [32034.68, 32034.68, 32034.68]);
  assert.equal(sep.vergiPayable, 96104.04);
  assert.equal(sep.payable, 97043.74);
  // Aylıkta her ay kendi vergisi
  const monthly = muhtasarMonths(["2026-07", "2026-08", "2026-09"].map(input));
  assert.equal(monthly.get("2026-07")!.payable, Math.round((jul.vergi + 939.7) * 100) / 100);
});

test("F: üç aylık seçenek nakit planı beslemesinde: ara ayın vergisi çeyrek sonunda, döküm tutara eşit; çeyreğin ilk ayı pencerenin dışında da", () => {
  const settings = { muhtasarQuarterly: true };
  const ds = { fixedExpenses: withProfile({ Kira: "kira" }).map((f) => (f.name === "Kira" ? { ...f, vatRate: 0 } : f)) };
  const feed = (today: string) => view(today, { ds, settings }).planFeed.items.filter((i) => i.kind === "muhtasar");
  const at = feed("2026-10-24");
  const jul = at.find((i) => i.period === "2026-07")!;
  const sep = at.find((i) => i.period === "2026-09")!;
  assert.equal(jul.amount, 939.7);
  assert.match(
    nb(jul.detail),
    /^Damga 939,70; vergi kısmı \(Ücret GV 0 \+ DV 34,68 \+ Kira stopajı 32\.000\) çeyrek sonunda ödenir \(üç aylık\); en az \(3 kalemin stopajı bilinmiyor\)\. Tahmin; kesin tutar tahakkuk fişindedir\. Son gün 26 Ağustos Çarşamba\.$/,
  );
  assert.equal(sep.amount, 97043.74);
  assert.match(nb(sep.detail), /^Ücret GV 0 \+ DV 34,68 \+ Kira stopajı 32\.000 \+ çeyreğin önceki ayları 64\.069,36 \+ damga 939,70; en az /);
  // Döküm tutara eşit
  assert.equal(r2(0 + 34.68 + 32000 + 64069.36 + 939.7), sep.amount);
  // Takvimde aynı döküm (muhtasarBreakdown)
  const cal = view("2026-10-24", { ds, settings }).calendar.find((r) => r.kind === "mphb" && r.period === "2026-09")!;
  assert.deepEqual(
    cal.detail.map((d) => d.label),
    ["Ücret gelir vergisi", "Ücret damga vergisi", "Kira: Şahsa işyeri kirası (%20)", "Çeyreğin önceki ayları (üç aylık)", "Muhtasar ve prim hizmet damgası"],
  );
  // 1 Aralık'ta pencere Ağustos'tan başlar; Eylül yine Temmuz'u da sayar (gecikmiş Eylül muhtasarı)
  assert.equal(feed("2026-11-24").find((i) => i.period === "2026-09")!.amount, 97043.74);
  assert.equal(feed("2026-12-01").find((i) => i.period === "2026-09")!.amount, 97043.74);
  assert.equal(feed("2026-12-01").some((i) => i.period === "2026-07"), false, "pencere dışındaki ay beslemede yok");
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

// Vergi eylemlerinin saf kuralları ve kaynak bekçileri (plan docs/planlar/vergi.md §7, §8.1, §11-I; docs/VERGI.md):
// muhasebeci kaydının dönemi, alanları ve Ödemeler'deki karşılığı; düzeltme, varlık, sınıflandırma, elle değer ve
// ayarların sınırları ve metinleri; vergi girdilerinden görünüm girdisi; nakit planının hafif beslemesi Vergi sayfasının
// beslemesiyle aynı; her eylem yöneticiyi kendisi denetler, işlem geçmişine yazar, sayfayı yeniler.
// Veritabanıyla: tests/vergi-eylemler-db.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import ts from "typescript";

import { createModel, shiftMonth } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import type { ReminderRow } from "../src/lib/reminders";
import type { TaxFiling } from "../src/lib/tax/corporate";
import {
  adjustmentRefusal,
  assetRefusal,
  categoryClassificationRefusal,
  cleanFiling,
  filingLogText,
  filingPeriodRefusal,
  filingReminders,
  filingSavedText,
  fixedClassificationRefusal,
  overrideLogText,
  overrideRefusal,
  periodStartRefusal,
  rateText,
  settingsChangeText,
} from "../src/lib/tax/edit";
import { paidQuartersOf, taxViewInputFromModel, type TaxInputs, zMonthOf } from "../src/lib/tax/inputs";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { buildTaxView, taxPlanFeed } from "../src/lib/tax/view";
import type { VatPaidEntry } from "../src/lib/vat-paid";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const TODAY = "2026-10-28";
const S = DEFAULT_TAX_SETTINGS;
const nb = (x: string | null) => (x ?? "").replace(/ /g, " ");

// ---------------------------------------------------------------- Muhasebecinin rakamı

test("muhasebeci kaydının dönemi: geçici ve kurumlar vergisi hesap döneminde ve başlamış; muhtasar ve KDV satışları son 24 ay", () => {
  assert.equal(filingPeriodRefusal("gecici", "2026-Q1", S, TODAY), "Dönem hesap döneminin içinde olmalı");
  assert.equal(filingPeriodRefusal("gecici", "2026-Q2", S, TODAY), null);
  assert.equal(filingPeriodRefusal("gecici", "2026-Q4", S, TODAY), null);
  assert.equal(filingPeriodRefusal("gecici", "2027-Q1", S, TODAY), "Bu dönem henüz başlamadı");
  assert.equal(filingPeriodRefusal("gecici", "2026-3", S, TODAY), "Geçersiz dönem");
  assert.equal(filingPeriodRefusal("kv", "2025", S, TODAY), "Dönem hesap döneminin içinde olmalı");
  assert.equal(filingPeriodRefusal("kv", "2026", S, TODAY), null);
  assert.equal(filingPeriodRefusal("kv", "2027", S, TODAY), "Bu dönem henüz başlamadı");
  assert.equal(filingPeriodRefusal("mphb", "2026-10", S, TODAY), null);
  assert.equal(filingPeriodRefusal("mphb", "2026-11", S, TODAY), "Dönem son 24 aydan biri olmalı");
  assert.equal(filingPeriodRefusal("kdv_matrah", "2024-10", S, TODAY), null);
  assert.equal(filingPeriodRefusal("kdv_matrah", "2024-09", S, TODAY), "Dönem son 24 aydan biri olmalı");
  assert.equal(filingPeriodRefusal("kdv_matrah", "2026-13", S, TODAY), "Geçersiz dönem");
});

test("muhasebeci kaydının tutarları: zorunlu alan, eksi tutar (matrah hariç), bilinmeyen alan; KDV satışlarında ödenecek 0", () => {
  assert.deepEqual(cleanFiling("gecici", { payable: null, stamp: 791, values: {} }), { ok: false, error: "Ödenecek: Tutar girin (0 olabilir)" });
  assert.deepEqual(cleanFiling("gecici", { payable: 0, stamp: -1, values: {} }), { ok: false, error: "Damga vergisi: Tutar eksi olamaz" });
  assert.deepEqual(cleanFiling("gecici", { payable: 41_200, stamp: 791, values: { matrah: -12_000.004, hesaplanan: null, bilinmeyen: 5 } }), {
    ok: true,
    payable: 41_200,
    stamp: 791,
    values: { matrah: -12_000 },
  });
  assert.deepEqual(cleanFiling("kv", { payable: 0, stamp: 2516.3, values: { hesaplanan: -1 } }), { ok: false, error: "Hesaplanan kurumlar vergisi: Tutar eksi olamaz" });
  assert.deepEqual(cleanFiling("kdv_matrah", { payable: 5, stamp: 791, values: { m10: 300_000 } }), { ok: false, error: "%20 matrah: Tutar girin (0 olabilir)" });
  assert.deepEqual(cleanFiling("kdv_matrah", { payable: 5, stamp: 791, values: { m10: 300_000, m20: 0, kafeDisi: 12_000 } }), {
    ok: true,
    payable: 0,
    stamp: 0,
    values: { m10: 300_000, m20: 0, kafeDisi: 12_000 },
  });
});

const rem = (over: Partial<ReminderRow>): ReminderRow => ({
  id: 1,
  title: "Geçici vergi beyanı ve ödemesi",
  kind: "vergi",
  amount: null,
  dueDate: "2026-11-17",
  anchorDate: "2026-11-17",
  repeat: "quarterly",
  remindDaysBefore: 7,
  note: null,
  active: true,
  ...over,
});

test("Ödemeler'deki karşılık: sıradaki günü o döneme düşen etkin hatırlatıcı; kira stopajı muhtasar kaydına bağlanmaz", () => {
  const gecici = rem({ id: 1 });
  const muhtasar = rem({ id: 2, title: "Muhtasar ve prim hizmet beyannamesi", dueDate: "2026-11-26", anchorDate: "2026-11-26", repeat: "monthly" });
  const stopaj = rem({ id: 3, title: "Kira stopajı", kind: "kira", dueDate: "2026-11-26", anchorDate: "2026-11-26", repeat: "monthly", amount: 8_000 });
  const kv = rem({ id: 4, title: "Kurumlar vergisi beyannamesi ve ödemesi", dueDate: "2027-04-30", anchorDate: "2027-04-30", repeat: "yearly" });
  const closed = rem({ id: 5, active: false });
  // Ertelenmiş kopya asıl gününün dönemini taşır (günü Şubat'a düşse de 2026/3'ün)
  const postponed = rem({ id: 6, dueDate: "2027-02-20", anchorDate: "2027-02-20", repeat: "none", note: "Ertelendi · asıl tarih 17.11.2026" });
  const all = [gecici, muhtasar, stopaj, kv, closed];
  assert.deepEqual(filingReminders(all, "gecici", "2026-Q3").map((r) => r.id), [1]);
  assert.deepEqual(filingReminders(all, "gecici", "2026-Q4").map((r) => r.id), []);
  assert.deepEqual(filingReminders(all, "mphb", "2026-10").map((r) => r.id), [2]);
  assert.deepEqual(filingReminders(all, "kv", "2026").map((r) => r.id), [4]);
  assert.deepEqual(filingReminders(all, "kdv_matrah", "2026-09"), []);
  assert.deepEqual(filingReminders([postponed], "gecici", "2026-Q3").map((r) => r.id), [6]);
  assert.deepEqual(filingReminders([postponed], "gecici", "2026-Q4"), []);
  assert.equal(filingReminders([gecici, rem({ id: 7, title: "Geçici vergi 2026/3" })], "gecici", "2026-Q3").length, 2);
});

test("muhasebeci kaydının bildirimi ve işlem geçmişi (§4.5-a, §7.2)", () => {
  assert.equal(filingSavedText("gecici", "2026-Q3", "yazildi"), "Muhasebecinin rakamı kaydedildi: Geçici vergi 2026/3 · Ödemeler'e de yazıldı");
  assert.equal(filingSavedText("gecici", "2026-Q3", null), "Muhasebecinin rakamı kaydedildi: Geçici vergi 2026/3");
  assert.equal(filingSavedText("mphb", "2026-09", "yok"), "Muhasebecinin rakamı kaydedildi: Muhtasar ve prim hizmet Eylül 2026 · Ödemeler'de karşılığı yok");
  assert.match(filingSavedText("kv", "2026", "birden_cok"), /Kurumlar vergisi 2026 · Ödemeler'de birden çok karşılığı var/);
  assert.equal(nb(filingLogText("gecici", "2026-Q3", 41_200, "yazildi")), "Geçici vergi 2026/3 · ödenecek 41.200 ₺ · Ödemeler'e de yazıldı");
  assert.equal(filingLogText("kdv_matrah", "2026-09", 0, null), "KDV beyannamesi satışları Eylül 2026");
});

// ---------------------------------------------------------------- Düzeltme, varlık, sınıflandırma

test("düzeltmenin dönemi: hesap döneminde ve bu ay ya da öncesi; çeyrek yalnız kafe dışında, çeyreğin son ayında", () => {
  assert.equal(adjustmentRefusal({ month: "2026-09", span: "ay", kind: "gider_belgeli" }, S, TODAY), null);
  assert.equal(adjustmentRefusal({ month: "2026-05", span: "ay", kind: "gider_belgeli" }, S, TODAY), "Dönem hesap döneminin içinde olmalı");
  assert.equal(adjustmentRefusal({ month: "2026-11", span: "ay", kind: "kkeg" }, S, TODAY), "Gelecek ay için düzeltme girilemez");
  assert.equal(adjustmentRefusal({ month: "2026-09", span: "ceyrek", kind: "gelir_kafe_disi" }, S, TODAY), null);
  assert.equal(adjustmentRefusal({ month: "2026-06", span: "ceyrek", kind: "gider_kafe_disi" }, S, TODAY), null);
  assert.equal(adjustmentRefusal({ month: "2026-09", span: "ceyrek", kind: "gider_belgeli" }, S, TODAY), "Çeyrek yalnız kafe dışı gelir ve giderde seçilebilir");
  assert.equal(adjustmentRefusal({ month: "2026-08", span: "ceyrek", kind: "gelir_kafe_disi" }, S, TODAY), "Çeyreğin tutarı çeyreğin son ayına yazılır");
  assert.equal(adjustmentRefusal({ month: "2026-12", span: "ceyrek", kind: "gelir_kafe_disi" }, S, TODAY), "Çeyrek bitmeden girilemez");
  assert.equal(adjustmentRefusal({ month: "2026-03", span: "ceyrek", kind: "gelir_kafe_disi" }, S, TODAY), "Dönem hesap döneminin içinde olmalı");
});

test("varlık: ömür 1–50, doğrudan gider 12.000 ₺'ye kadar, faturanın kalanını aşmaz, kafe dışı fatura bağlanmaz (§4.5-c)", () => {
  const a = { acquiredOn: "2026-07-13", cost: 10_000, method: "amortisman" as const, lifeYears: 5 };
  assert.equal(assetRefusal(a, null, TODAY), null);
  assert.equal(assetRefusal({ ...a, lifeYears: null }, null, TODAY), null);
  assert.equal(assetRefusal({ ...a, lifeYears: 0 }, null, TODAY), "Ömür 1–50 yıl olmalı");
  assert.equal(assetRefusal({ ...a, lifeYears: 51 }, null, TODAY), "Ömür 1–50 yıl olmalı");
  assert.equal(assetRefusal({ ...a, method: "dogrudan_gider", cost: 12_000 }, null, TODAY), null);
  assert.equal(assetRefusal({ ...a, method: "dogrudan_gider", cost: 12_000.5 }, null, TODAY), "Doğrudan gider yalnız 12.000 ₺'ye kadar");
  assert.equal(assetRefusal({ ...a, cost: 12_345.68 }, { category: "Kuruluş & Demirbaş", remaining: 12_345.67 }, TODAY), null);
  assert.equal(nb(assetRefusal({ ...a, cost: 12_345.7 }, { category: "Kuruluş & Demirbaş", remaining: 12_345.67 }, TODAY)), "Maliyet faturanın kalan tutarını aşıyor (en çok 12.345,67 ₺)");
  assert.equal(assetRefusal(a, { category: "Alp Koç", remaining: 50_000 }, TODAY), "Kafe dışı fatura varlığa bağlanamaz");
  assert.equal(assetRefusal({ ...a, acquiredOn: "2026-10-29" }, null, TODAY), "Edinme günü bugünden sonra olamaz");
});

test("sınıflandırma bölüme uygun: bordro yalnız personelde, 'belgesi yok' personelde değil, stopaj kira, genel ve dışarıdan hizmette", () => {
  assert.equal(fixedClassificationRefusal("kira", { doc: "bordro" }), "Bordro yalnız personel giderinde seçilebilir");
  assert.equal(fixedClassificationRefusal("personel", { doc: "yok" }), "Personel giderinde 'Belgesi yok' seçilemez");
  assert.equal(fixedClassificationRefusal("personel", { doc: "bordro" }), null);
  assert.equal(fixedClassificationRefusal("kira", { doc: "belgeli", withholding: "kira", vatToZero: true }), null);
  assert.equal(fixedClassificationRefusal("genel", { doc: null, withholding: "internet_reklam_yurtdisi" }), null);
  assert.equal(fixedClassificationRefusal("faturalar", { doc: "fatura", withholding: "yok" }), "Stopaj yalnız kira, genel giderler ve dışarıdan hizmette seçilebilir");
  assert.equal(fixedClassificationRefusal("personel", { doc: "bordro", withholding: "serbest_meslek" }), "Stopaj yalnız kira, genel giderler ve dışarıdan hizmette seçilebilir");
  assert.equal(fixedClassificationRefusal("personel", { doc: "belgeli", withholding: "serbest_meslek" }), null);
  assert.equal(fixedClassificationRefusal("genel", { doc: "belgeli", withholding: "serbest_meslek", vatToZero: true }), "'KDV yok' yalnız şahsa işyeri kirasında seçilebilir");
  assert.equal(categoryClassificationRefusal("mal", "belgeli"), null);
  assert.equal(categoryClassificationRefusal("personel", "yok"), "Personel giderinde 'Belgesi yok' seçilemez");
  assert.equal(categoryClassificationRefusal("genel", "bordro"), "Bordro yalnız sabit personel giderinde seçilebilir");
  assert.equal(categoryClassificationRefusal("genel", null), null);
});

// ---------------------------------------------------------------- Elle değer, ayarlar, SGK oranı

test("elle değer: yalnız elle değiştirilebilen kural, sıfır ya da büyük, SGK işveren oranı en çok %21,75 (§2.4)", () => {
  assert.equal(overrideRefusal("sgk.isverenOran", 0.1475), null);
  assert.equal(overrideRefusal("sgk.isverenOran", 0.2175), null);
  assert.equal(overrideRefusal("sgk.isverenOran", 0.25), "Değer en çok 0.2175");
  assert.equal(overrideRefusal("sgk.isverenOran", -0.01), "Değer sıfır ya da daha büyük olmalı");
  assert.equal(overrideRefusal("damga.gecici", 820), null);
  // Beyanname damgaları yalnız tahmini yılda uygulanır ama saklanabilir
  assert.equal(overrideRefusal("damga.beyanname.kdv", 850), null);
  assert.equal(overrideRefusal("kv.oran", 0.2), "Bu kural elle değiştirilemez");
  assert.equal(overrideRefusal("yok.boyle", 1), "Bu kural elle değiştirilemez");
  assert.equal(overrideRefusal("damga.gecici", null), null);
  assert.equal(overrideLogText("damga.gecici", 791, 820, "71 Seri No 2027"), "damga.gecici 791 → 820 (71 Seri No 2027)");
  assert.equal(overrideLogText("sgk.isverenOran", 0.1975, null, ""), "sgk.isverenOran 0,1975 → tablodaki değer");
  assert.equal(rateText(0.1575), "%15,75");
  assert.equal(rateText(0.1975), "%19,75");
});

test("ayarlar: hesap dönemi 2000 … bugün; işlem geçmişinde yalnız değişen alanlar", () => {
  assert.equal(periodStartRefusal("2026-06-25", TODAY), null);
  assert.equal(periodStartRefusal("1999-12-31", TODAY), "Tarih 2000'den önce olamaz");
  assert.equal(periodStartRefusal("2026-10-29", TODAY), "Hesap dönemi bugünden sonra başlayamaz");
  assert.equal(periodStartRefusal("2026-02-30", TODAY), periodStartRefusal("2026-02-30", TODAY));
  assert.deepEqual(settingsChangeText(S, S), []);
  assert.deepEqual(
    settingsChangeText(S, { ...S, firstActivity: "ilk", muhtasarQuarterly: true, quarterDepreciation: "ay12", carriedLoss: { amount: 12_000, note: "2025 beyannamesi", by: "Mehmet", date: TODAY } }).map(nb),
    ["kuruluş: ilk defa faaliyete başladı", "amortisman: kümülatif ay ÷ 12", "muhtasar 3 aylık: açık", "devreden zarar 12.000 ₺"],
  );
});

// ---------------------------------------------------------------- Girdiler ve nakit planının beslemesi

test("Ödendi kaydından geçici vergi dönemleri: tutar ilk dönemin, KDV kayıtları sayılmaz", () => {
  const e = (over: Partial<VatPaidEntry>): VatPaidEntry => ({ id: 1, kind: "gecici", dueDate: "2026-08-17", next: "2026-11-17", periods: ["2026-Q2"], amount: 1_200, at: "2026-08-17T10:00:00.000Z", ...over });
  assert.deepEqual(
    paidQuartersOf([e({}), e({ id: 2, kind: "kdv", periods: ["2026-09"], amount: 9_000 }), e({ id: 3, dueDate: "2026-11-17", next: "2027-05-17", periods: ["2026-Q3", "2026-Q4"], amount: 41_991 })]),
    [
      { period: "2026-Q2", amount: 1_200 },
      { period: "2026-Q3", amount: 41_991 },
      { period: "2026-Q4", amount: null },
    ],
  );
  assert.deepEqual(zMonthOf({ byRate: [{ base: 100.004 }, { base: 50 }], days: 3, complete: true }), { base: 150, days: 3, complete: true });
});

const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);
const inputs = (over: Partial<TaxInputs> = {}): TaxInputs => ({
  settings: DEFAULT_TAX_SETTINGS,
  filings: [],
  adjustments: [],
  assets: [],
  zMonths: new Map(),
  invoicedCashOuts: new Set(),
  vatPaid: [],
  ...over,
});

test("nakit planının beslemesi (taxPlanFeed) Vergi sayfasınınkiyle aynı: aylık ve üç aylık muhtasar, muhasebeci kaydı, yıl dönümü", () => {
  const filings: TaxFiling[] = [{ id: 1, kind: "gecici", period: "2026-Q3", payable: 41_200, stamp: 791, values: {} }];
  for (const today of ["2026-10-22", "2026-10-28", "2026-12-01", "2027-01-15", "2027-03-01"]) {
    for (const over of [{}, { settings: { ...DEFAULT_TAX_SETTINGS, muhtasarQuarterly: true } }, { filings }]) {
      const input = taxViewInputFromModel(model, inputs(over), { today });
      assert.deepEqual(taxPlanFeed(input), buildTaxView(input).planFeed, `${today} ${JSON.stringify(Object.keys(over))}`);
    }
  }
  // Kayıtlı geçici vergi beslemede muhasebecinin rakamı
  const feed = taxPlanFeed(taxViewInputFromModel(model, inputs({ filings }), { today: TODAY }));
  const q3 = feed.items.find((i) => i.kind === "gecici" && i.period === "2026-Q3")!;
  assert.equal(q3.amount, 41_991);
  assert.equal(q3.source, "filing");
});

test("görünüm girdisi modelden: Ayarlar'daki işveren oranı, ödenmiş çeyrekler, muhtasar kalemlerinin penceresi, yıl ve çeyrek", () => {
  const vatPaid: VatPaidEntry[] = [{ id: 9, kind: "gecici", dueDate: "2026-08-17", next: "2026-11-17", periods: ["2026-Q2"], amount: 0, at: "2026-08-17T10:00:00.000Z" }];
  const input = taxViewInputFromModel(model, inputs({ vatPaid }), { today: TODAY, year: 2026, quarter: "2026-Q3" });
  assert.equal(input.settingsEmployerRate, model.settings.isverenSgk);
  assert.deepEqual(input.paidQuarters, [{ period: "2026-Q2", amount: 0 }]);
  assert.equal(input.year, 2026);
  assert.equal(input.quarter, "2026-Q3");
  assert.equal(input.vat, null);
  assert.deepEqual(input.reminders, []);
  // Hesap döneminden (Haziran) takvim penceresinin sonuna (bugün + 100 gün: Şubat)
  const months = [...input.muhtasarItems.keys()];
  assert.equal(months[0], "2026-06");
  assert.equal(months.at(-1), "2027-02");
  assert.equal(months.length, 9);
  for (let m = "2026-06"; m <= "2027-02"; m = shiftMonth(m, 1)) assert.ok(input.muhtasarItems.has(m), m);
});

// ---------------------------------------------------------------- Kaynak bekçileri

function exportedFunctions(path: string): { name: string; body: string; async: boolean }[] {
  const src = read(path);
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true);
  const out: { name: string; body: string; async: boolean }[] = [];
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(st) && st.name) out.push({ name: st.name.text, body: st.getText(sf), async: Boolean(ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) });
    else if (!ts.isTypeAliasDeclaration(st) && !ts.isInterfaceDeclaration(st)) out.push({ name: st.getText(sf).slice(0, 40), body: "", async: false });
  }
  return out;
}

test("vergi eylemleri: dosyada yalnız async eylemler; her biri yöneticiyi kendisi denetler, işlem geçmişine yazar, sayfayı yeniler", () => {
  const path = "src/server/actions/tax.ts";
  assert.match(read(path), /^"use server";/);
  const fns = exportedFunctions(path);
  assert.deepEqual(
    fns.map((f) => f.name),
    [
      "saveTaxSettings",
      "saveTaxOverride",
      "saveTaxCheck",
      "saveTaxClassifications",
      "saveTaxFiling",
      "deleteTaxFiling",
      "saveTaxAdjustment",
      "deleteTaxAdjustment",
      "saveTaxAsset",
      "deleteTaxAsset",
      "setEmployerSgkRate",
    ],
  );
  for (const f of fns) {
    assert.ok(f.async, `${f.name} async değil`);
    assert.match(f.body, /return attempt\(async \(\) => \{\n {4}const me = await requireAdmin\(\);/, `${f.name}: ilk iş requireAdmin`);
    assert.match(f.body, /await logActivity\(me, /, `${f.name}: işlem geçmişi`);
    assert.match(f.body, /refresh\(\);/, `${f.name}: refresh`);
  }
  const set = fns.find((f) => f.name === "setEmployerSgkRate")!.body;
  // Yalnız isverenSgk anahtarı (saveStaffRates dört oranı birden yazar)
  assert.deepEqual([...set.matchAll(/key: "(\w+)"/g)].map((m) => m[1]), ["isverenSgk"]);
  assert.doesNotMatch(set, /saveStaffRates|isciSgk|isverenIssizlik/);
  const classify = fns.find((f) => f.name === "saveTaxClassifications")!.body;
  // Kalem adı ve belge işlem geçmişine yazılmaz
  assert.match(classify, /await logActivity\(me, "Vergi: sınıflandırma", classificationLogText\(items\.length\)\);/);
});

test("vergi yükleyicileri: Özet nakit planını vergi girdisiyle okur; nakit planı beslemeyi okur, hatada vergisiz çalışır; saf kodda sunucu yok", () => {
  const data = read("src/server/data/tax.ts");
  assert.match(data, /loadCashPlan\(model, upcoming \?\? undefined, \{ taxInputs \}\)/);
  assert.match(data, /Promise\.all\(\[/);
  const plan = read("src/server/data/cash-plan.ts");
  assert.match(plan, /export async function loadCashPlan\(model: Model, upcoming\?: Awaited<ReturnType<typeof loadUpcoming>>, opts: \{ taxInputs\?: TaxInputs \} = \{\}\)/);
  assert.match(plan, /opts\.taxInputs \?\? taxInputsForPlan\(\)/);
  assert.match(plan, /tax = loadTaxPlanFeed\(model, today, taxInputs\);/);
  assert.match(plan, /planInputFromModel\(model, today, taxInputs\?\.settings\)/);
  assert.match(plan, /console\.error\("\[vergi\] nakit planı: vergi beslemesi hesaplanamadı", e\)/);
  // Saf vergi kodu sunucuya ve veritabanına uzanmaz
  for (const f of ["assets", "calendar", "checks", "corporate", "edit", "inputs", "muhtasar", "payroll", "pnl", "rules", "rules-2026", "settings", "stamp", "view"]) {
    const src = read(`src/lib/tax/${f}.ts`);
    assert.doesNotMatch(src, /from "@\/server|from "drizzle-orm|from "\.\.\/\.\.\/server/, f);
  }
});

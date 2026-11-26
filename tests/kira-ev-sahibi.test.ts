// Kira ev sahibi türü (Faz 5): kira bölümündeki sabit giderde `landlordType` şahıs | şirket | boş.
// - şahıs: KDV hiçbir yerde yok (nakit planı kiranın KDV'sini eklemez, kalemin KDV'si boş ya da %20 olsa da); stopaj %20
//   resmi kiradan (resmi tutar + brüt / net) tek kaynak: Gelir-gider'in stopaj satırı ve muhtasarın matrahı. Sabit tutarlı
//   "Kira stopajı" hatırlatıcısı muhtasarın yalnız kira stopajının yerine geçer (VG-02; tests/nakit-plani.test.ts);
//   "Kira stopajı" adlı ayrı bir sabit gider varsa stopaj satırı uyarır (iki kez sayılabilir).
// - şirket: %20 KDV, stopaj yok (resmi kira yazılmış olsa da), muhtasar "en az"a düşmez (belgesi fatura sayılır).
// - boş: bugünkü davranış.
// §6: Tuzla 160.000 ₺/ay şahsa, KDV yok, stopaj resmi 100.000 ₺ brütten (20.000); Marina Kasım 0 (Aralık'tan), Aralık'tan
// 160.000 KDV hariç, nakit planı 192.000, KDV 32.000.
// Çalıştırma: npx tsx --test tests/kira-ev-sahibi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { rentSaveFields } from "../src/app/panel/giderler/rent-fields";
import { planInputFromModel } from "../src/lib/cash-plan";
import { createModel, stopajKey } from "../src/lib/calc/engine";
import { alerts } from "../src/lib/calc/insights";
import type { Dataset, FixedExpense } from "../src/lib/calc/types";
import { fixedVatRate } from "../src/lib/constants";
import { muhtasarItemsFromModel, muhtasarMonth, withholdingUnknown } from "../src/lib/tax/muhtasar";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const kira = excel.fixedExpenses.find((f) => f.name === "Kira")!;
const months = [
  ...excel.months,
  { month: "2026-11", openDays: 30, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null },
  { month: "2026-12", openDays: 31, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null },
];
/** Kira satırı yamasıyla veri kümesi (KDV oranına dokunulmaz: bölümün varsayılanı %20) */
const withKira = (patch: Partial<FixedExpense>, extra: FixedExpense[] = []): Dataset => ({
  ...excel,
  currentMonth: "2027-01",
  months,
  fixedExpenses: [...excel.fixedExpenses.map((f) => (f.id === kira.id ? { ...f, ...patch } : f)), ...extra],
});
/** Nakit planının bu kalem için bankadan çıkardığı aylık tutar (KDV dahil, stopaj düşülmüş) */
const paidMonthly = (ds: Dataset, month: string) => {
  const f = planInputFromModel(createModel(ds), `${month}-05`).months[month].fixed.find((x) => x.id === kira.id)!;
  return { paid: f.amount * (1 + (f.vatRate ?? 0) - (f.withholdingRate ?? 0)), vatRate: f.vatRate ?? 0, withholding: f.withholding ?? null };
};

test("§6 Tuzla: şahsa kira 160.000, KDV yok, stopaj resmi 100.000 brütten 20.000 (tek kaynak: Gelir-gider ve muhtasar)", () => {
  const ds = withKira({ landlordType: "sahis", officialAmount: 100_000, officialBasis: "brut", prorate: false, branchId: "tuzla" });
  assert.equal(ds.fixedExpenses.find((f) => f.id === kira.id)!.vatRate ?? null, null, "kalemin KDV'si boş (bölüm varsayılanı %20)");
  const pm = createModel(ds).pnlMonth("2026-11");
  close(pm.cells.get(`fixed:${kira.id}`)!.value!, 160_000, "kira");
  close(pm.cells.get(stopajKey(kira.id))!.value!, 20_000, "stopaj resmi brütten");
  // Nakit planı: ev sahibine KDV'siz 160.000 (192.000 değil); stopaj muhtasarla ayrıca
  const p = paidMonthly(ds, "2026-11");
  close(p.paid, 160_000, "nakit planı");
  assert.equal(p.vatRate, 0);
  assert.equal(p.withholding, null, "resmi kiralı kalemde ev sahibine giden kesintisiz");
  // KDV oranı %20 yazılmış olsa da şahsa kirada KDV yok
  close(paidMonthly(withKira({ landlordType: "sahis", officialAmount: 100_000, vatRate: 0.2, branchId: "tuzla" }), "2026-11").paid, 160_000, "kalemde %20 yazılı");
  assert.equal(fixedVatRate({ section: "kira", vatRate: 0.2, landlordType: "sahis" }), 0);
  // Muhtasar: matrah resmi brüt 100.000, stopaj 20.000; "en az" değil
  const item = muhtasarItemsFromModel(createModel(ds), "2026-11").find((i) => i.id === kira.id)!;
  assert.deepEqual([item.amount, item.withholding], [100_000, "kira"]);
  assert.equal(withholdingUnknown(item), false);
  const m = muhtasarMonth({ period: "2026-11", items: [item] });
  assert.equal(m.stopajTotal, 20_000);
  // Net resmi kira 80.000 → brüt 100.000 (aynı stopaj)
  close(createModel(withKira({ landlordType: "sahis", officialAmount: 80_000, officialBasis: "net" })).pnlMonth("2026-11").cells.get(stopajKey(kira.id))!.value!, 20_000, "net → brüt");
});

test("şahıs, resmi kira yazılmamış: tutar brüt sayılır, stopaj ödemeden kesilir (bankadan %80), KDV yok; Gelir-gider'de ayrı stopaj satırı yok", () => {
  const ds = withKira({ landlordType: "sahis", officialAmount: null });
  const p = paidMonthly(ds, "2026-11");
  close(p.paid, 128_000, "160.000 × 0,8");
  assert.equal(p.withholding, "kira");
  assert.equal(createModel(ds).pnlMonth("2026-11").cells.get(stopajKey(kira.id)), undefined);
  const item = muhtasarItemsFromModel(createModel(ds), "2026-11").find((i) => i.id === kira.id)!;
  assert.deepEqual([item.amount, item.withholding], [160_000, "kira"]);
});

test("§6 Marina: şirkete kira Kasım 0, Aralık'tan 160.000 KDV hariç; nakit planı 192.000 (KDV 32.000); stopaj yok, muhtasar 'en az' değil", () => {
  // Resmi kira yazılmış olsa da şirkete kirada stopaj yok
  const ds = withKira({ landlordType: "sirket", officialAmount: 100_000, officialBasis: "brut", startMonth: "2026-12", prorate: false, branchId: "marina", taxDoc: null, taxWithholding: null });
  const m = createModel(ds);
  assert.equal(m.pnlMonth("2026-11").cells.get(`fixed:${kira.id}`)!.value, null, "Kasım: kalem başlamadı");
  close(m.pnlMonth("2026-12").cells.get(`fixed:${kira.id}`)!.value!, 160_000, "Aralık");
  assert.equal(m.pnlMonth("2026-12").cells.get(stopajKey(kira.id)), undefined, "stopaj satırı yok");
  assert.equal(m.pnlRowDefs(["2026-12"]).some((r) => r.key === stopajKey(kira.id)), false);
  const p = paidMonthly(ds, "2026-12");
  close(p.paid, 192_000, "nakit planı KDV dahil");
  close(p.paid - 160_000, 32_000, "KDV");
  assert.equal(p.withholding, null);
  assert.equal(fixedVatRate({ section: "kira", vatRate: 0, landlordType: "sirket" }), 0.2, "şirkete kirada %20");
  const item = muhtasarItemsFromModel(m, "2026-12").find((i) => i.id === kira.id)!;
  assert.equal(item.withholding, null);
  assert.equal(item.doc, "fatura", "belgesi fatura sayılır");
  assert.equal(withholdingUnknown(item), false, "muhtasar 'en az'a düşmez");
});

test("ev sahibi türü boş: bugünkü davranış (resmi kiralı kalemde stopaj satırı, nakit planı kalemin KDV'siyle)", () => {
  const ds = withKira({ officialAmount: 100_000, officialBasis: "brut", prorate: false });
  close(createModel(ds).pnlMonth("2026-11").cells.get(stopajKey(kira.id))!.value!, 20_000, "stopaj");
  close(paidMonthly(ds, "2026-11").paid, 192_000, "bölümün varsayılanı %20");
  const plain = muhtasarItemsFromModel(createModel(withKira({})), "2026-11").find((i) => i.id === kira.id)!;
  assert.equal(withholdingUnknown(plain), true, "profili seçilmemiş kira 'en az'");
});

test("tek kaynak: 'Kira stopajı' adlı ayrı bir sabit gider varken stopaj satırı ve Genel bakış uyarır (tutar değişmez)", () => {
  const extra: FixedExpense = { ...kira, id: 900, name: "Kira stopajı", amount: 20_000, officialAmount: null, landlordType: null, sortOrder: 99 };
  const m = createModel(withKira({ landlordType: "sahis", officialAmount: 100_000, prorate: false }, [extra]));
  const pm = m.pnlMonth("2026-11");
  assert.match(pm.cells.get(stopajKey(kira.id))!.warn!, /Kira stopajı/);
  close(pm.cells.get(stopajKey(kira.id))!.value!, 20_000, "stopaj değişmez");
  assert.ok(alerts(m, "2026-11").some((a) => /stopajı iki kez/.test(a.title)), "Genel bakış uyarısı");
  // Ayrı kalem yoksa uyarı yok
  assert.equal(createModel(withKira({ landlordType: "sahis", officialAmount: 100_000 })).pnlMonth("2026-11").cells.get(stopajKey(kira.id))!.warn, undefined);
});

test("ekran ve eylem: kira kaleminde ev sahibi türü seçilir", () => {
  const costs = read("src/server/actions/costs.ts");
  assert.match(costs, /landlordType: z\.enum\(\["sahis", "sirket"\]\)\.nullable\(\)\.optional\(\)/);
  const ui = read("src/app/panel/giderler/expenses-client.tsx");
  assert.match(ui, /id="fx-landlord"/);
  assert.match(ui, /LANDLORD_TYPES\.map/);
  const labels = read("src/lib/constants.ts");
  assert.match(labels, /label: "Şahıs \(KDV yok, stopaj %20\)"/);
  assert.match(labels, /label: "Şirket \(%20 KDV, stopaj yok\)"/);
});

test("Ödemeler: 'Sabit giderlerden ekle', izleme ve tutarsızlık denetimi ev sahibi türünü nakit planıyla aynı kuralla sayar", async () => {
  const { paidFixedRatesOf } = await import("../src/lib/cash-plan");
  const { fixedReminderAt } = await import("../src/lib/reminders");
  const at = (patch: Partial<FixedExpense>) => fixedReminderAt(paidFixedRatesOf({ ...kira, ...patch }, 2026), [], "2026-11").amount ?? NaN;
  // Şahıs, resmi kira yok: bankadan 160.000 × 0,8 (nakit planının yayılımıyla aynı; stopaj muhtasarla ayrıca)
  close(at({ landlordType: "sahis", officialAmount: null, vatRate: 0, taxWithholding: null }), 128_000, "şahıs, resmi kira yok");
  close(paidMonthly(withKira({ landlordType: "sahis", officialAmount: null, vatRate: 0, taxWithholding: null }), "2026-11").paid, 128_000, "yayılım");
  // Şahıs, resmi kiralı: ev sahibine kesintisiz, KDV yok
  close(at({ landlordType: "sahis", officialAmount: 100_000, officialBasis: "brut" }), 160_000, "şahıs, resmi kiralı");
  // Şirket, eski Vergi profili 'kira' kalmış: %20 KDV, stopaj yok
  close(at({ landlordType: "sirket", taxWithholding: "kira", vatRate: 0 }), 192_000, "şirket");
  close(paidMonthly(withKira({ landlordType: "sirket", taxWithholding: "kira", vatRate: 0 }), "2026-11").paid, 192_000, "yayılım");
  // Üç yol da aynı fonksiyondan geçer; yükleyici ev sahibi türünü ve resmi kirayı okur
  for (const p of ["src/server/data/fixed-reminders.ts", "src/server/data/fixed-follow.ts", "src/server/actions/reminders.ts"]) {
    assert.match(read(p), /paidFixedRatesOf\(/, p);
    assert.doesNotMatch(read(p), /[^f]paidFixedRates\(/, p);
  }
  const loader = read("src/server/data/fixed-reminders.ts");
  for (const c of ["landlordType", "officialAmount", "officialBasis"]) assert.match(loader, new RegExp(`${c}: s\\.fixedExpenses\\.${c}`), c);
});

test("ev sahibi türü seçmek kayıtlı resmi kirayı ve KDV seçimini silmez; tür geri alınınca eski davranış döner", () => {
  // İnceleme bulgusu 7: Tuzla'nın kirası (resmi 100.000 brüt) yanlışlıkla Şirket seçilip kaydedilince resmi kira siliniyor,
  // Şahıs / Şirket seçimi kalemin KDV'sini 0 / 0,2 diye eziyordu. Motor türe uymayan alanları zaten saymaz
  const stored = { section: "kira" as const, vatRate: null, official: 100_000, basis: "brut" as const };
  const sirket = rentSaveFields({ ...stored, landlord: "sirket" });
  assert.equal(sirket.landlordType, "sirket");
  assert.equal(sirket.officialAmount, 100_000, "şirket: resmi kira saklı kalır (stopaja girmez: officialRentGross)");
  assert.equal(sirket.officialBasis, "brut");
  assert.equal(sirket.vatRate, 0.2, "şirket: kalemin KDV seçimi (bölümün varsayılanı) yazılır, türün oranı değil");
  // Motor şirkette resmi kirayı saymaz: stopaj satırı yok, KDV %20
  const m = createModel(withKira({ landlordType: "sirket", officialAmount: sirket.officialAmount, officialBasis: sirket.officialBasis, vatRate: sirket.vatRate }));
  assert.equal(m.pnlMonth("2026-11").cells.get(stopajKey(kira.id)), undefined, "şirkette stopaj satırı yok");
  // Şahsa geri dönülünce resmi kira yine stopajın kaynağı
  const back = rentSaveFields({ ...stored, official: sirket.officialAmount, landlord: "sahis" });
  assert.equal(back.officialAmount, 100_000);
  close(createModel(withKira({ ...back, prorate: false })).pnlMonth("2026-11").cells.get(stopajKey(kira.id))!.value!, 20_000, "şahıs: stopaj resmi kiradan");
  // Sahibin KDV seçimi (%10) ezilmez; tür kaldırılınca o oran geçerli
  const sahis = rentSaveFields({ ...stored, vatRate: 0.1, landlord: "sahis" });
  assert.equal(sahis.vatRate, 0.1, "şahıs: kalemin KDV seçimi saklı (nakit planı yine KDV'siz öder: fixedVatRate)");
  assert.equal(fixedVatRate({ section: "kira", vatRate: sahis.vatRate, landlordType: "sahis" }), 0);
  assert.equal(rentSaveFields({ ...stored, vatRate: 0.1, landlord: "" }).vatRate, 0.1, "tür yok: kalemin oranı");
  assert.equal(rentSaveFields({ ...stored, landlord: "" }).vatRate, 0.2, "tür yok, seçim yok: bölümün varsayılanı %20 (0 değil)");
  // Kira dışı bölümde resmi kira ve tür gitmez (bugünkü kural)
  const genel = rentSaveFields({ ...stored, section: "genel", landlord: "sahis" });
  assert.deepEqual([genel.officialAmount, genel.officialBasis, genel.landlordType], [null, null, null]);
});

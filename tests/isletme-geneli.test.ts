// İşletme geneli payı (Faz 5, sahibin kararı 4, 23 Kasım 2026): tek şube seçiliyken işletme geneli giderler (şubesi boş
// sabit gider ve stopajı, şubesi boş harcama ve harcamaya bağlı faturalar, Gelir-gider'e elle yazılan tutarlar, komisyon
// faturaları, silinmiş kalemin elle girişi) şubenin kârını düşürmez; tek bir bilgi satırı "İşletme geneli payı (bilgi)"
// dönemin toplamını gösterir (bölüştürme değil, işletme genelinin tamamı). "Tümü" onları bir kez sayar: Marina kârı +
// Tuzla kârı − işletme geneli = Tümü kârı; hiçbir şey iki kez sayılmaz. Veri kümeleri dataset.ts'in şube süzmesini taklit
// eder (personel ve ay şubenin; sabit gider ve harcama şubenin + işletme genelinin; elle hücreler branchPnlEntry).
// Çalıştırma: npx tsx --test tests/isletme-geneli.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { branchBreakdown } from "../src/lib/branch-breakdown";
import { branchPnlEntry } from "../src/lib/branches";
import { createModel, stopajKey } from "../src/lib/calc/engine";
import { fixedCostsForMonth } from "../src/lib/calc/insights";
import type { Dataset, ExpenseCategory, ExpenseEntry, FixedExpense, Invoice, Month, Staff } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const excel: Dataset = excelToDataset(data);
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const kira = excel.fixedExpenses.find((f) => f.name === "Kira")!;
/** Sabit giderler: Excel'in kalemleri işletme geneli; kira Tuzla'nın (şahsa, resmi 100.000), Marina'nın kirası Aralık'tan */
const fixed: FixedExpense[] = [
  ...excel.fixedExpenses.map((f) => (f.id === kira.id ? { ...f, branchId: "tuzla", landlordType: "sahis" as const, officialAmount: 100_000, officialBasis: "brut" as const, prorate: false } : { ...f, branchId: null })),
  { ...kira, id: 500, name: "Marina kira", branchId: "marina", landlordType: "sirket", officialAmount: null, startMonth: "2026-12", sortOrder: 50 },
  { ...kira, id: 501, name: "Marina güvenlik", section: "faturalar", amount: 2_500, branchId: "marina", officialAmount: null, prorate: true, sortOrder: 51 },
];
const staff: Staff[] = [
  { id: 1, name: "Alper", netSalary: 35_000, extras: 0, mealCard: true, active: true, startMonth: null, endMonth: null, branchId: "marina" },
  { id: 2, name: "Berkan", netSalary: 32_000, extras: 0, active: true, startMonth: null, endMonth: null, branchId: "tuzla" },
];
const reklam: ExpenseCategory = { id: 1, name: "Reklam", section: "genel", panelGroup: "reklam", invoiceCategory: "Reklam & Tabela", monthly: false, active: true, sortOrder: 1 };
const entry = (id: number, amount: number, branchId: string | null): ExpenseEntry => ({ id, date: "2026-11-10", categoryId: 1, description: null, amount, paymentMethod: null, note: null, branchId });
const entries = [entry(1, 3_000, "marina"), entry(2, 4_000, null), entry(3, 5_000, "tuzla")];
const invoice = (id: number, category: string, supplier: string, amount: number): Invoice =>
  ({ id, date: "2026-11-15", supplier, description: null, invoiceNo: null, category, amount, discount: 0, payable: amount * 1.2, vat: amount * 0.2, unpaid: false, note: null }) as Invoice;
/** İşletme geneli faturalar: komisyon (Pluxee) ve harcamaya bağlı reklam faturası */
const invoices = [invoice(1, "Komisyon", "Pluxee", 1_000), invoice(2, "Reklam & Tabela", "Tabelacı", 6_000)];
const pnlEntries = [
  { month: "2026-11", rowKey: "manual:su", amount: 2_000, note: null },
  { month: "2026-11", rowKey: "manual:harici", amount: 1_500, note: null },
  // Silinmiş bir kalemin elle girişi: işletme geneli
  { month: "2026-11", rowKey: "fixed:999", amount: 700, note: null },
];
const m = (month: string, posRevenue: number, openDays: number): Month => ({ month, openDays, posRevenue, discounts: 0, offRevenue: 0, note: null });
const tuzlaMonths = [m("2026-11", 200_000, 30), m("2026-12", 210_000, 31)];
const marinaMonths = [m("2026-11", 100_000, 30), m("2026-12", 120_000, 31)];
const allMonths = tuzlaMonths.map((t, i) => ({ ...t, posRevenue: t.posRevenue! + marinaMonths[i].posRevenue!, byBranch: { tuzla: t, marina: marinaMonths[i] } }));

const common: Dataset = {
  ...excel,
  currentMonth: "2027-01",
  salesLines: [],
  stockCounts: [],
  invoices,
  expenseCategories: [reklam],
  pnlEntries: [],
  staff: [],
  fixedExpenses: [],
  months: [],
};
const ALL: Dataset = { ...common, months: allMonths, staff, fixedExpenses: fixed, expenseEntries: entries, pnlEntries };
/** Şube görünümü: dataset.ts'in süzmesi (personel, ay şubenin; sabit gider ve harcama şubenin + işletme genelinin) */
function view(id: "tuzla" | "marina", months: Month[], companyMonths: Month[] | null = allMonths): Dataset {
  const inScope = fixed.filter((f) => f.branchId === null || f.branchId === id);
  const ids = new Set(inScope.map((f) => f.id));
  const allIds = new Set(fixed.map((f) => f.id));
  return {
    ...common,
    branchView: { id, name: id === "tuzla" ? "Tuzla" : "Marina", kind: "fiziksel" },
    months,
    staff: staff.filter((s) => s.branchId === id),
    fixedExpenses: inScope,
    expenseEntries: entries.filter((e) => e.branchId === null || e.branchId === id),
    pnlEntries: pnlEntries.filter((e) => branchPnlEntry(e.rowKey, ids, allIds)),
    ...(companyMonths ? { companyMonths } : {}),
  };
}

test("tek şube: işletme geneli giderler kâra girmez, 'İşletme geneli payı (bilgi)' satırı toplamını gösterir; Tümü bir kez sayar", () => {
  const all = createModel(ALL).pnlMonth("2026-11");
  const marina = createModel(view("marina", marinaMonths)).pnlMonth("2026-11");
  const tuzla = createModel(view("tuzla", tuzlaMonths)).pnlMonth("2026-11");
  // İşletme genelinin bileşimi: şubesi boş sabit giderler, elle hücreler (su 2.000 + harici 1.500 + silinmiş kalem 700),
  // şubesi boş harcama (4.000) + harcamaya bağlı fatura (6.000), komisyon faturası (1.000)
  const sharedFixed = fixed.filter((f) => f.branchId === null).reduce((a, f) => a + (all.cells.get(`fixed:${f.id}`)?.value ?? 0), 0);
  close(all.shared.total, sharedFixed + 2_000 + 1_500 + 700 + 4_000 + 6_000 + 1_000, "Tümü'nün işletme geneli");
  close(marina.shared.total, all.shared.total, "Marina'nın bilgi satırı: işletme genelinin tamamı (bölüştürme değil)");
  close(tuzla.shared.total, all.shared.total, "Tuzla'nın bilgi satırı");
  // Kabul: Marina kârı + Tuzla kârı − işletme geneli = Tümü kârı (hiçbir şey iki kez sayılmaz)
  close(marina.profit + tuzla.profit - all.shared.total, all.profit, "Marina + Tuzla − işletme geneli = Tümü");
  close(marina.expenses + tuzla.expenses + all.shared.total, all.expenses, "giderler");
  // Şube giderinde işletme geneli yok: Marina'nın harcaması yalnız kendi 3.000'i, komisyon faturası yok
  assert.equal(marina.cells.get("expense:1")!.value, 3_000);
  assert.equal(tuzla.cells.get("expense:1")!.value, 5_000);
  assert.equal(all.cells.get("expense:1")!.value, 3_000 + 4_000 + 5_000 + 6_000);
  assert.equal(marina.sections.komisyon, marina.cells.get("commission:pos")!.value, "komisyon faturası şubede sayılmaz");
});

test("bilgi satırı: etiket, ipucu, tür; şubede işletme geneli kalemlerin satırı yok, şubenin kalemleri var; Tümü'de bilgi satırı yok", () => {
  const rows = createModel(view("marina", marinaMonths)).pnlRowDefs(["2026-11", "2026-12"]);
  const info = rows.find((r) => r.key === "shared:total")!;
  assert.ok(info, "bilgi satırı");
  assert.equal(info.label, "İŞLETME GENELİ PAYI (bilgi)");
  assert.equal(info.kind, "info");
  assert.equal(info.editable, false);
  assert.match(info.hint!, /Şubenin kârına girmez; Tümü'de bir kez sayılır/);
  const keys = new Set(rows.map((r) => r.key));
  const instagram = fixed.find((f) => f.name === "Instagram reklamı")!;
  assert.equal(keys.has(`fixed:${instagram.id}`), false, "işletme geneli sabit gider satırı yok");
  assert.equal(keys.has("manual:su"), false, "elle hücre (su) şubede yok: Tümü'de yazılır");
  assert.equal(keys.has("commission:pluxee") || [...keys].some((k) => /^commission:(?!pos)/.test(k)), false, "komisyon faturası satırı yok");
  assert.equal(keys.has("fixed:500"), true, "Marina'nın kirası");
  assert.equal(keys.has("fixed:501"), true, "Marina'nın güvenliği");
  assert.equal(createModel(ALL).pnlRowDefs(["2026-11"]).some((r) => r.key === "shared:total"), false, "Tümü'de bilgi satırı yok");
  // Bilgi satırının hücresi dönemin toplamını ve bileşimini söyler
  const cell = createModel(view("marina", marinaMonths)).pnlValue(createModel(view("marina", marinaMonths)).pnlMonth("2026-11"), "shared:total");
  assert.match(cell.info!, /^İşletme geneli: Influencer 50\.000\s₺, Instagram reklamı 30\.000\s₺/);
  assert.match(cell.info!, /Şubenin kârına girmez; Tümü'de bir kez sayılır\.$/);
});

test("Tuzla'nın şahsa kirası yalnız Tuzla'da: kira 160.000 + stopaj 20.000 Tuzla'nın kârında, Marina'da yok", () => {
  const tuzla = createModel(view("tuzla", tuzlaMonths)).pnlMonth("2026-11");
  const marina = createModel(view("marina", marinaMonths)).pnlMonth("2026-11");
  close(tuzla.cells.get(`fixed:${kira.id}`)!.value!, 160_000, "Tuzla kira");
  close(tuzla.cells.get(stopajKey(kira.id))!.value!, 20_000, "Tuzla stopaj");
  assert.equal(marina.cells.get(`fixed:${kira.id}`), undefined);
  assert.equal(marina.cells.get(stopajKey(kira.id)), undefined);
  // Marina'nın şirkete kirası Aralık'tan: Kasım 0, Aralık 160.000 (KDV hariç)
  assert.equal(marina.cells.get("fixed:500")!.value, null);
  close(createModel(view("marina", marinaMonths)).pnlMonth("2026-12").cells.get("fixed:500")!.value!, 160_000, "Marina Aralık");
});

test("açılış ayı: şubenin günü az olsa da bilgi satırı işletmenin günüyle (Tümü'nün saydığı tutar)", () => {
  // Marina Kasım'da 18 gün açık (açılış ayı); işletme genelinin günü 30
  const opening = [m("2026-11", 100_000, 18), marinaMonths[1]];
  const marina = createModel(view("marina", opening)).pnlMonth("2026-11");
  const all = createModel(ALL).pnlMonth("2026-11");
  close(marina.shared.total, all.shared.total, "işletme geneli Tümü'nün günüyle");
  // İşletmenin günü verilmezse (eski çağıran) şubenin günüyle oranlanır: daha küçük
  const fallback = createModel(view("marina", opening, null)).pnlMonth("2026-11");
  assert.ok(fallback.shared.total < all.shared.total, "yedek: şubenin günü");
});

test("tam ay kalem (oranlanmayan kira) işletme geneliyken bilgi satırı Tümü'nün saydığı tutarı gösterir: süren ay ve şubenin verisinden önceki ay", () => {
  // Kira işletme geneli (şubesi henüz seçilmemiş), açık güne göre oranlanmıyor, resmi kiralı (stopajıyla)
  const sharedRent = fixed.map((f) => (f.id === kira.id ? { ...f, branchId: null } : f));
  const viewWith = (id: "tuzla" | "marina", months: Month[], company: Month[], currentMonth: string): Dataset => ({
    ...view(id, months, company),
    currentMonth,
    fixedExpenses: sharedRent.filter((f) => f.branchId === null || f.branchId === id),
  });
  // Süren Kasım: Marina 12 gün, işletme 24 gün
  const runMarina = [m("2026-11", 40_000, 12)];
  const runAll = [{ ...m("2026-11", 200_000, 24), byBranch: { tuzla: m("2026-11", 160_000, 24), marina: runMarina[0] } }];
  const allRun = createModel({ ...ALL, currentMonth: "2026-11", months: runAll, fixedExpenses: sharedRent }).pnlMonth("2026-11");
  const marinaRun = createModel(viewWith("marina", runMarina, runAll, "2026-11")).pnlMonth("2026-11");
  close(marinaRun.shared.parts.find((p) => p.key === `fixed:${kira.id}`)!.amount, allRun.cells.get(`fixed:${kira.id}`)!.value!, "süren ay: kira");
  close(marinaRun.shared.parts.find((p) => p.key === stopajKey(kira.id))!.amount, allRun.cells.get(stopajKey(kira.id))!.value!, "süren ay: stopaj");
  close(marinaRun.shared.total, allRun.shared.total, "süren ay: bilgi satırı = Tümü");
  // Kapanmış Ekim: yalnız Tuzla'nın verisi var (Marina'nın ilk veri ayı Kasım); Tümü kirayı tam ay sayar
  const oct = m("2026-10", 150_000, 31);
  const allOct = [{ ...oct, byBranch: { tuzla: oct } }, ...allMonths];
  const allClosed = createModel({ ...ALL, months: allOct, fixedExpenses: sharedRent }).pnlMonth("2026-10");
  close(allClosed.cells.get(`fixed:${kira.id}`)!.value!, 160_000, "Tümü Ekim: tam ay");
  const marinaClosed = createModel(viewWith("marina", marinaMonths, allOct, "2027-01")).pnlMonth("2026-10");
  close(marinaClosed.shared.total, allClosed.shared.total, "Marina'nın verisinden önceki ay: bilgi satırı = Tümü");
});

test("Genel bakış: şube seçiliyken sabit gider dökümü işletme genelini saymaz, bölümlerle tutar (eksi 'diğer' satırı yok)", () => {
  const model = createModel(view("marina", marinaMonths));
  const f = fixedCostsForMonth(model, "2026-11");
  const pm = model.pnlMonth("2026-11");
  close(f.total, pm.sections.personel + pm.sections.faturalar + pm.sections.kira + pm.sections.genel, "döküm = bölümler");
  assert.equal(f.manualRows.some((r) => r.amount < 0), false, "eksi düzeltme satırı yok");
  const instagram = fixed.find((x) => x.name === "Instagram reklamı")!;
  assert.equal(f.lines.some((l) => l.key === `fixed:${instagram.id}`), false);
  close(f.shared, pm.shared.total, "bilgi: işletme geneli payı");
});

test("Tümü'nün şube kırılımı: şubeler + 'İşletme geneli' sütunu = Tümü (fark yok), işletme geneli bir kez", () => {
  const months = ["2026-11", "2026-12"];
  const of = (ds: Dataset) => {
    const model = createModel(ds);
    return months.map((x) => model.pnlMonth(x));
  };
  const b = branchBreakdown(
    [
      { id: "tuzla", name: "Tuzla", months: of(view("tuzla", tuzlaMonths)) },
      { id: "marina", name: "Marina", months: of(view("marina", marinaMonths)) },
    ],
    of(ALL),
  );
  assert.deepEqual(
    b.columns.map((c) => c.label),
    ["Tuzla", "Marina", "İşletme geneli", "Tümü"],
  );
  assert.equal(b.residual, 0, "fark yok");
  const [tuzla, marina, shared, tumu] = b.columns;
  close(tuzla.profit + marina.profit + shared.profit, tumu.profit, "kâr");
  close(tuzla.expenses + marina.expenses + shared.expenses, tumu.expenses, "gider");
  close(tuzla.revenue + marina.revenue + shared.revenue, tumu.revenue, "ciro");
  const all = of(ALL);
  close(shared.expenses, all[0].shared.total + all[1].shared.total, "işletme geneli Tümü'nün toplamı");
});

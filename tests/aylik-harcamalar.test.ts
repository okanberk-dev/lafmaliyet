// Aylık harcamalar (reklam, influencer, fatura dışı): gelir-gider, mal maliyeti, "Para nereye gitti" ve Bu ayın
// işleri. Excel verisinin (Temmuz–Ekim 2026) üzerine kategori ve kayıt eklenir; Excel'in kendi rakamları değişmez.
// Çalıştırma: npx tsx --test tests/aylik-harcamalar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { monthTaskFacts, monthTasks } from "../src/app/panel/dashboard-tasks";
import { createModel } from "../src/lib/calc/engine";
import { fixedCostsForMonth } from "../src/lib/calc/insights";
import type { Dataset, ExpenseCategory, ExpenseEntry } from "../src/lib/calc/types";
import { FIXED_ESTIMATE_DESCRIPTION } from "../src/lib/constants";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const M = "2026-09";

const cat = (p: Partial<ExpenseCategory> & Pick<ExpenseCategory, "id" | "name">): ExpenseCategory => ({
  section: "genel",
  panelGroup: "diger",
  invoiceCategory: null,
  monthly: false,
  active: true,
  sortOrder: p.id,
  ...p,
});
const entry = (id: number, categoryId: number, date: string, amount: number): ExpenseEntry => ({ id, date, categoryId, amount, description: null, paymentMethod: null, note: null });

const CATS = [
  cat({ id: 1, name: "Influencer", panelGroup: "reklam", monthly: true }),
  cat({ id: 2, name: "Nakit malzeme alımı", section: "mal" }),
  cat({ id: 3, name: "Reklam (faturalı)", panelGroup: "reklam", invoiceCategory: "Reklam & Tabela" }),
  cat({ id: 4, name: "Eski kategori", active: false }),
];
const ENTRIES = [entry(1, 1, "2026-09-05", 40_000), entry(2, 1, "2026-09-20", 25_000), entry(3, 2, "2026-09-12", 1_500), entry(4, 1, "2026-10-02", 10_000)];
const withExpenses = (extra: Partial<Dataset> = {}) => createModel({ ...base, expenseCategories: CATS, expenseEntries: ENTRIES, ...extra });

test("harcamalar: kategori satırı kendi bölümünde, mal kategorisi mal alımında; Excel rakamları değişmez", () => {
  const before = createModel(base).pnlMonth(M);
  const model = withExpenses();
  const pm = model.pnlMonth(M);
  assert.equal(pm.cells.get("expense:1")?.value, 65_000);
  assert.equal(pm.cells.get("expense:2")?.value, 1_500);
  assert.ok(Math.abs(pm.sections.genel - before.sections.genel - 65_000 - (pm.cells.get("expense:3")?.value as number)) < 1e-6);
  assert.ok(Math.abs(pm.purchases - before.purchases - 1_500) < 1e-6);
  assert.ok(Math.abs(pm.cogs - before.cogs - 1_500) < 1e-6);
  assert.ok(Math.abs(before.profit - pm.profit - (pm.expenses - before.expenses)) < 1e-6);
  // Kategori yokken sonuç tıpatıp aynı (Excel uyumu)
  assert.equal(createModel({ ...base, expenseCategories: [], expenseEntries: [] }).pnlMonth(M).profit, before.profit);
  // Satırlar: etkin kategoriler bölümlerinde; boş pasif kategori yok
  const rows = model.pnlRowDefs([M]);
  assert.equal(rows.find((r) => r.key === "expense:1")?.section, "genel");
  assert.equal(rows.find((r) => r.key === "expense:2")?.section, "mal");
  assert.equal(rows.find((r) => r.key === "expense:1")?.editable, false);
  assert.equal(rows.some((r) => r.key === "expense:4"), false);
});

test("harcamalar: bağlı fatura kategorisi satıra eklenir; mal ve komisyon faturaları bağlanmaz", () => {
  const ads = base.invoices.filter((i) => i.category === "Reklam & Tabela");
  const month = ads.length ? ads[0].date.slice(0, 7) : M;
  const fromInvoices = ads.filter((i) => i.date.startsWith(month)).reduce((a, i) => a + i.amount - i.discount, 0);
  const model = withExpenses();
  assert.ok(Math.abs((model.pnlMonth(month).cells.get("expense:3")?.value as number) - fromInvoices) < 1e-6);
  // Mal kategorisi bağlanırsa yok sayılır (zaten mal alımında)
  const goods = createModel({ ...base, expenseCategories: [cat({ id: 9, name: "Yanlış", invoiceCategory: "Hammadde & İçecek" })], expenseEntries: [] });
  assert.equal(goods.pnlMonth(M).cells.get("expense:9")?.value, 0);
});

test("harcamalar: Para nereye gitti'de reklam grubunda, artık 'bu aya özel' olarak görünmez", () => {
  const before = fixedCostsForMonth(createModel(base), M);
  const after = fixedCostsForMonth(withExpenses(), M);
  const reklam = (x: typeof before) => x.flow.find((f) => f.key === "reklam")!.amount;
  const ads = after.lines.find((l) => l.key === "expense:3")?.value ?? 0;
  assert.ok(Math.abs(reklam(after) - reklam(before) - 65_000 - ads) < 1e-6);
  assert.ok(Math.abs(after.manual - before.manual) < 1e-6, "harcamalar 'bu aya özel giderler'e karışmaz");
  // Mal kategorisi sabit gider akışında yok
  assert.equal(after.lines.some((l) => l.key === "expense:2"), false);
});

test("harcamalar: standarda (Excel temeli) karışmaz; sabit gider kutusunda ve net kâr ipucunda ayrı satır", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { FixedReconcile, fixedBreakdownText } = await import("../src/app/panel/dashboard-fixed");
  const { dashboard } = await import("../src/lib/calc/insights");
  const model = withExpenses();
  const d = dashboard(model, M);
  const f = d.fixedMonth;
  const t = d.theoretical!;
  const ads = f.lines.find((l) => l.key === "expense:3")?.value ?? 0;
  // Standart = Excel SabitGiderToplam (Eylül tam ay: açık gün etkisi yok); harcamalar ayrı bileşen
  assert.ok(Math.abs(f.standard - d.fixedStandardTotal) < 1e-6, "standart = Excel temeli");
  assert.ok(Math.abs(f.standard - fixedCostsForMonth(createModel(base), M).standard) < 1e-6);
  assert.ok(Math.abs(f.expenses - 65_000 - ads) < 1e-6);
  assert.ok(Math.abs(f.standard + f.proration + f.overrides + f.manual + f.expenses - f.total) < 1e-6);
  assert.ok(Math.abs(t.netProfitStandard - t.netProfit - f.expenses) < 1e-6, "Excel temeli ile net kâr farkı = harcamalar");
  assert.ok(Math.abs(f.flow.find((x) => x.key === "reklam")!.standard - fixedCostsForMonth(createModel(base), M).flow.find((x) => x.key === "reklam")!.standard) < 1e-6);
  const html = renderToStaticMarkup(createElement(FixedReconcile, { f })).replace(/ /g, " ");
  assert.match(html, /Aylık harcamalar/);
  assert.match(html, /Influencer/);
  assert.ok(!/standart aylık tutarlarla düşüldü/.test(html), "fark varken tek satırlık 'aynı temel' notu çıkmaz");
  assert.match(fixedBreakdownText(f).replace(/ /g, " "), /aylık harcamalar \+/);
  // Harcama yoksa bileşen 0, kutu eskisi gibi
  assert.equal(fixedCostsForMonth(createModel(base), M).expenses, 0);
});

test("harcamalar: her ay girilecek kategori girilmediyse Bu ayın işleri hatırlatır", () => {
  const model = withExpenses();
  const facts = (m: string, state: "running" | "closed") => monthTaskFacts(model, m, state, null, { payments: null, parasut: null });
  // Eylül: girildi
  const sep = monthTasks(facts(M, "closed")).find((t) => t.key === "harcama")!;
  assert.equal(sep.status, "done");
  // Ekim (süren ay, ilk kayıttan sonra) kaydı var; Ağustos ilk kayıttan (Eylül) önce: hatırlatılmaz
  const aug = monthTasks(facts("2026-08", "closed")).find((t) => t.key === "harcama");
  assert.ok(!aug || (aug.status === "done" && !/Influencer/.test(aug.detail)), "ilk kayıttan önceki ay hatırlatılmaz");
  // Ekim'in kaydını silince Ekim için hatırlatılır (süren ay: "sonra")
  const noOct = createModel({ ...base, expenseCategories: CATS, expenseEntries: ENTRIES.filter((e) => !e.date.startsWith("2026-10")) });
  const oct = monthTasks(monthTaskFacts(noOct, "2026-10", "running", null, { payments: null, parasut: null })).find((t) => t.key === "harcama")!;
  assert.equal(oct.status, "later");
  assert.match(oct.detail, /Influencer/);
  assert.equal(oct.href, "/panel/harcamalar?ay=2026-10");
  // Kapanmış ayda eksikse yapılacak
  const closed = monthTasks(monthTaskFacts(noOct, "2026-10", "closed", null, { payments: null, parasut: null })).find((t) => t.key === "harcama")!;
  assert.equal(closed.status, "todo");
  // Kategori yoksa görev hiç çıkmaz
  const plain = createModel(base);
  assert.equal(monthTasks(monthTaskFacts(plain, M, "closed", null, { payments: null, parasut: null })).some((t) => t.key === "harcama"), false);
});

test("harcamalar (E-60): girilen fiş KDV dahil ödenen tutarıyla sayılır; kartlar bunu söyler, 'KDV hariç' demez", () => {
  // 1.200 ₺'lik market fişi (200 ₺ KDV): gelir-giderde 1.200 ₺ (fişin KDV'si ayrılmaz; sahibe soru 8)
  const before = createModel({ ...base, expenseCategories: [cat({ id: 7, name: "Market" })], expenseEntries: [] }).pnlMonth(M);
  const after = createModel({ ...base, expenseCategories: [cat({ id: 7, name: "Market" })], expenseEntries: [entry(1, 7, "2026-09-10", 1_200)] }).pnlMonth(M);
  assert.equal(after.cells.get("expense:7")?.value, 1_200);
  assert.ok(Math.abs(after.expenses - before.expenses - 1_200) < 1e-6);
  const page = readFileSync(join(__dirname, "..", "src/app/panel/harcamalar/monthly-expenses.tsx"), "utf8");
  assert.match(page, /girilen harcamalar \(ödenen tutar, KDV dahil\) ve bağlı faturalar \(KDV hariç\)/);
  assert.match(page, /girilen harcamalar \(ödenen tutar, KDV dahil; fişin KDV'si ayrılmaz\) ve kategoriye bağlı faturalar \(KDV hariç\)/);
  assert.doesNotMatch(page, /girilen harcamalar ve (kategoriye )?bağlı faturalar \(KDV hariç\)/);
  // Çevirmede yazılan tahmini kayıt KDV hariç olduğunu söyler
  assert.equal(FIXED_ESTIMATE_DESCRIPTION, "Sabit giderdeki KDV hariç tutar (tahmini): ödediğiniz tutarı yazın");
  const actions = readFileSync(join(__dirname, "..", "src/server/actions/expenses.ts"), "utf8");
  assert.match(actions, /description: FIXED_ESTIMATE_DESCRIPTION, amount: planned/);
});

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

test("harcamalar: her ay girilecek kategori girilmediyse Bu ayın işleri hatırlatır", () => {
  const model = withExpenses();
  const facts = (m: string, state: "running" | "closed") => monthTaskFacts(model, m, state, null, { payments: null, parasut: null });
  // Eylül: girildi
  const sep = monthTasks(facts(M, "closed")).find((t) => t.key === "harcama")!;
  assert.equal(sep.status, "done");
  // Ağustos (kapanmış): Influencer girilmedi → yapılacak
  const aug = monthTasks(facts("2026-08", "closed")).find((t) => t.key === "harcama")!;
  assert.equal(aug.status, "todo");
  assert.match(aug.detail, /Influencer/);
  assert.equal(aug.href, "/panel/harcamalar?ay=2026-08");
  // Kategori yoksa görev hiç çıkmaz
  const plain = createModel(base);
  assert.equal(monthTasks(monthTaskFacts(plain, M, "closed", null, { payments: null, parasut: null })).some((t) => t.key === "harcama"), false);
});

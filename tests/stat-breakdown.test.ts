// Özet kartlarının dökümü (karta dokununca açılan pencere): sıralama, pay, toplam ve üç sayfanın döküm verisi
// (Aylık harcamalar, Gelir-gider, Faturalar). Döküm her zaman kartın rakamını tutmalı.
// Çalıştırma: npx tsx --test tests/stat-breakdown.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { invoiceBreakdowns, type ListHref } from "../src/app/panel/faturalar/breakdowns";
import type { InvoiceRow } from "../src/app/panel/faturalar/rules";
import { yearBreakdowns } from "../src/app/panel/gelir-gider/breakdowns";
import type { GridSection } from "../src/app/panel/gelir-gider/pnl-grid";
import type { CategoryRow, EntryRow, InvoiceItem } from "../src/app/panel/harcamalar/monthly-expenses";
import { expenseBreakdowns, missingCategories } from "../src/app/panel/harcamalar/summary";
import { prepareBreakdown, shareLabel, withRemainder, type BreakdownGroup } from "../src/lib/breakdown";
import { createModel, monthOfDate, yearMonths } from "../src/lib/calc/engine";
import { unpaidSummary } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { COMMISSION_CATEGORY, SEPARATE_CATEGORIES } from "../src/lib/constants";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupsSum = (gs: BreakdownGroup[]) => sum(gs.filter((g) => !g.apart).flatMap((g) => g.rows.map((r) => r.amount)));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// ---------------------------------------------------------------- Ortak döküm

test("prepareBreakdown: büyükten küçüğe, boş kalem ve bölüm düşer, kafe dışı en sonda ve toplama girmez", () => {
  const p = prepareBreakdown([
    { key: "ayri", label: "Kafe dışı", apart: true, rows: [{ key: "k", label: "Karaoke box", amount: 900 }] },
    { key: "a", label: "Küçük", rows: [{ key: "a1", label: "A1", amount: 100 }, { key: "a0", label: "Sıfır", amount: 0 }] },
    { key: "b", label: "Büyük", rows: [{ key: "b1", label: "B1", amount: 200 }, { key: "b2", label: "B2", amount: 500 }, { key: "b3", label: "İade", amount: -50 }] },
    { key: "bos", label: "Boş", rows: [{ key: "x", label: "X", amount: 0.001 }] },
  ]);
  assert.deepEqual(p.groups.map((g) => g.key), ["b", "a", "ayri"]);
  assert.deepEqual(p.groups[0].rows.map((r) => r.key), ["b2", "b1", "b3"]);
  assert.deepEqual(p.groups[1].rows.map((r) => r.key), ["a1"]);
  assert.equal(p.total, 750);
  assert.equal(p.base, 750);
  close(p.groups[0].share!, 650 / 750);
  close(p.groups[0].rows[0].share!, 500 / 750);
  assert.equal(p.groups[2].share, null);
  assert.equal(p.groups[2].rows[0].share, null);
});

test("prepareBreakdown: kartın rakamı toplamdır; eksi bölümde en büyük gider önce; verilen sıra korunabilir", () => {
  assert.equal(prepareBreakdown([{ key: "a", rows: [{ key: "x", label: "X", amount: 10 }] }], { total: 12 }).total, 12);
  const neg = prepareBreakdown([{ key: "g", rows: [{ key: "k", label: "Kira", amount: -100 }, { key: "m", label: "Mal", amount: -300 }] }]);
  assert.deepEqual(neg.groups[0].rows.map((r) => r.key), ["m", "k"]);
  assert.equal(neg.groups[0].rows[0].share, null, "eksi toplamda pay yok");
  const given = prepareBreakdown(
    [
      { key: "gelir", rows: [{ key: "ciro", label: "Ciro", amount: 50 }] },
      { key: "gider", rows: [{ key: "k", label: "Kira", amount: -10 }, { key: "m", label: "Mal", amount: -30 }] },
    ],
    { order: "given", total: 10 },
  );
  assert.deepEqual(given.groups.map((g) => g.key), ["gelir", "gider"]);
  assert.deepEqual(given.groups[1].rows.map((r) => r.key), ["k", "m"]);
  assert.equal(prepareBreakdown([]).groups.length, 0);
});

test("withRemainder ve shareLabel", () => {
  const rows = [{ key: "a", label: "A", amount: 100 }];
  assert.equal(withRemainder(rows, 100.3, "Diğer"), rows, "yuvarlama farkı satır olmaz");
  assert.deepEqual(withRemainder(rows, 130, "Diğer").at(-1), { key: "remainder", label: "Diğer", amount: 30 });
  assert.equal(shareLabel(0.254), "%25");
  assert.equal(shareLabel(0.043), "%4,3");
  assert.equal(shareLabel(1), "%100");
  assert.equal(shareLabel(0.0001), "%0,1'den az");
});

// ---------------------------------------------------------------- Aylık harcamalar

const crow = (p: Partial<CategoryRow> & Pick<CategoryRow, "id" | "name">): CategoryRow => ({
  section: "genel",
  panelGroup: "diger",
  invoiceCategory: null,
  monthly: false,
  active: true,
  expected: false,
  entryCount: 0,
  monthEntries: 0,
  monthInvoices: 0,
  monthTotal: 0,
  prevTotal: 0,
  ...p,
});
const erow = (id: number, categoryId: number, amount: number, description: string | null = null): EntryRow => ({ id, date: "2026-10-05", categoryId, description, amount, paymentMethod: null, note: null });

test("Aylık harcamalar: kartların dökümü kartın rakamını tutar; fatura satırı Faturalar'da açılır", () => {
  const cats = [
    crow({ id: 1, name: "Influencer", panelGroup: "reklam", monthly: true, monthEntries: 12_500.5, monthTotal: 12_500.5 }),
    crow({ id: 2, name: "Reklam", panelGroup: "reklam", invoiceCategory: "Reklam & Tabela", monthEntries: 1_000, monthInvoices: 3_000, monthTotal: 4_000 }),
    crow({ id: 3, name: "Bakım", monthEntries: 800, monthTotal: 800 }),
  ];
  const entries = [erow(1, 1, 10_000, "@kahvesever"), erow(2, 1, 2_500.5), erow(3, 2, 1_000), erow(4, 3, 800)];
  const invoices: InvoiceItem[] = [{ id: 7, date: "2026-10-03", supplier: "Tabelacı (ödenmedi)", net: 3_000, categoryId: 2, invoiceCategory: "Reklam & Tabela" }];
  const b = expenseBreakdowns("2026-10", cats, entries, invoices);
  close(groupsSum(b.total), 17_300.5);
  close(groupsSum(b.ads), 16_500.5);
  close(groupsSum(b.offInvoice), 14_300.5);
  close(groupsSum(b.fromInvoices), 3_000);
  assert.deepEqual(b.ads.map((g) => g.label), ["Influencer", "Reklam"]);
  assert.equal(b.total[0].rows.find((r) => r.key === "c2")?.sub, "1 kayıt · 1 fatura");
  assert.equal(b.ads[0].rows[1].label, "Harcama", "açıklamasız kayıt");
  assert.equal(b.fromInvoices[0].rows[0].href, `/panel/faturalar?ay=2026-10&ara=${encodeURIComponent("Tabelacı (ödenmedi)")}#fatura-listesi`);
});

test("Aylık harcamalar: bağlı faturası gelen 'her ay' kategorisi girilmemiş sayılmaz", () => {
  const cats = [
    crow({ id: 1, name: "Influencer", monthly: true, expected: true }),
    crow({ id: 2, name: "Reklam", monthly: true, expected: true, invoiceCategory: "Reklam & Tabela", monthInvoices: 3_000, monthTotal: 3_000 }),
    crow({ id: 3, name: "Kira farkı", monthly: true, expected: true, monthEntries: 500, monthTotal: 500 }),
  ];
  assert.deepEqual(missingCategories(cats).map((c) => c.id), [1]);
});

// ---------------------------------------------------------------- Gelir-gider

/** Sayfanın kurduğu tablo bölümleri (yıl toplamı sütunuyla), page.tsx'teki gibi */
function gridSections(model: ReturnType<typeof createModel>, months: string[]): GridSection[] {
  const calcs = months.map((m) => model.pnlMonth(m));
  const out: GridSection[] = [];
  for (const def of model.pnlRowDefs(months)) {
    let sec = out.find((s) => s.key === def.section);
    if (!sec) out.push((sec = { key: def.section, label: def.section, rows: [] }));
    const cells = calcs.map((c) => model.pnlValue(c, def.key));
    sec.rows.push({ def, cells, total: cells.every((c) => c.value === null) ? null : sum(cells.map((c) => c.value ?? 0)) });
  }
  return out;
}

test("Gelir-gider: yıl dökümü giderler, kâr ve mal maliyeti kartlarını tutar (Excel verisi)", () => {
  const model = createModel(base);
  const months = yearMonths(2026);
  const calcs = months.map((m) => model.pnlMonth(m));
  const b = yearBreakdowns(gridSections(model, months), calcs);
  const expenses = sum(calcs.map((c) => c.expenses));
  const revenueNet = sum(calcs.map((c) => c.revenueNet ?? 0));
  assert.ok(expenses > 0);
  close(groupsSum(b.expenses), expenses, 0.5);
  close(groupsSum(b.cogs), sum(calcs.map((c) => c.cogs)), 0.5);
  close(groupsSum(b.profit), revenueNet - expenses, 0.5);
  assert.deepEqual(b.expenses.map((g) => g.key), ["cogs", "personel", "faturalar", "kira", "genel", "komisyon"]);
  // Bölümler tablodaki bölüm toplamlarını tutar
  for (const key of ["personel", "faturalar", "kira", "genel", "komisyon"] as const) {
    close(sum(b.expenses.find((g) => g.key === key)!.rows.map((r) => r.amount)), sum(calcs.map((c) => c.sections[key])), 0.5);
  }
  // Kâr: önce ciro, giderler eksi ve en büyüğü önce
  assert.equal(b.profit[0].rows[0].amount, revenueNet);
  const gider = b.profit[1].rows.map((r) => r.amount);
  assert.ok(gider.every((v, i) => v <= 0 && (i === 0 || gider[i - 1] <= v)));
});

test("Gelir-gider: tabloda satırı olmayan tutar 'Diğer' olur, döküm yine kartı tutar", () => {
  const calcs = [{ opening: 0, closing: 0, cogs: 0, revenueNet: 1_000, sections: { personel: 0, faturalar: 0, kira: 500, genel: 120, komisyon: 0 } }];
  const sections: GridSection[] = [
    { key: "kira", label: "Kira", rows: [{ def: { key: "fixed:1", label: "Dükkan kirası", section: "kira", kind: "auto", editable: true }, cells: [], total: 500 }] },
  ];
  const b = yearBreakdowns(sections, calcs);
  assert.deepEqual(b.expenses.find((g) => g.key === "genel")?.rows, [{ key: "genel:other", label: "Diğer (tabloda ayrı satırı yok)", amount: 120 }]);
  close(groupsSum(b.expenses), 620);
});

// ---------------------------------------------------------------- Faturalar

const href: ListHref = (f) => `/panel/faturalar?${new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => Boolean(e[1])))}#fatura-listesi`;

test("Faturalar: kategori dökümü; kafe dışı ayrı; ay kartları ve ödenmemiş kartın rakamını tutar (Excel verisi)", () => {
  const model = createModel(base);
  const invoices: InvoiceRow[] = base.invoices.map((i) => ({ ...i, outstanding: i.outstanding ?? null }));
  const months = [...new Set(invoices.map((i) => monthOfDate(i.date)))].sort();
  const b = invoiceBreakdowns(invoices, months, href);
  const net = (xs: InvoiceRow[]) => sum(xs.map((i) => i.amount - i.discount));
  close(groupsSum(b.all), net(invoices.filter((i) => !SEPARATE_CATEGORIES.includes(i.category))));
  assert.ok(b.all[1].apart && b.all[1].rows.every((r) => SEPARATE_CATEGORIES.includes(r.label)));
  for (const m of months) {
    close(groupsSum(b.goods[m]), model.goodsPurchases(m));
    close(groupsSum(b.commission[m]), net(invoices.filter((i) => i.category === COMMISSION_CATEGORY && monthOfDate(i.date) === m)));
  }
  close(groupsSum(b.unpaid), unpaidSummary(invoices).total);
});

test("Faturalar: tedarikçi notu ayrı tedarikçi sayılmaz; satır listede süzülmüş açılır", () => {
  const inv = (id: number, supplier: string, amount: number, unpaid = false): InvoiceRow => ({
    id,
    date: "2026-10-04",
    supplier,
    description: null,
    invoiceNo: null,
    category: "Hammadde & İçecek",
    amount,
    discount: 0,
    payable: amount * 1.2,
    unpaid,
    note: null,
    outstanding: null,
  });
  const b = invoiceBreakdowns([inv(1, "Kaldi", 100), inv(2, "Kaldi (ödenmedi)", 50, true)], ["2026-10"], href);
  const rows = b.goods["2026-10"].find((g) => g.key === "Hammadde & İçecek")!.rows;
  assert.deepEqual(
    rows.map((r) => [r.label, r.amount, r.sub]),
    [["Kaldi", 150, "2 fatura"]],
  );
  assert.equal(rows[0].href, "/panel/faturalar?kategori=Hammadde+%26+%C4%B0%C3%A7ecek&ay=2026-10&ara=Kaldi#fatura-listesi");
  assert.deepEqual(b.unpaid[0].rows.map((r) => [r.label, r.amount]), [["Kaldi", 60]]);
});

test("prepareBreakdown: yazılı değeri olan bilgi satırı tutarı 0 olsa da kalır", () => {
  const p = prepareBreakdown(
    [
      {
        key: "durum",
        noSubtotal: true,
        rows: [
          { key: "bag", label: "Bağlantı", amount: 0, display: "Tanımlı", tone: "good" },
          { key: "bos", label: "Boş", amount: 0 },
          { key: "son", label: "Son eşitleme", amount: 0, display: "20.10.2026 14:41" },
        ],
      },
    ],
    { order: "given" },
  );
  assert.deepEqual(
    p.groups[0].rows.map((r) => r.display),
    ["Tanımlı", "20.10.2026 14:41"],
  );
  assert.equal(p.groups[0].noSubtotal, true);
});

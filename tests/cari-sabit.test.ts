// Hiç cari kaydı yokken bugünkü rakamlar değişmez (docs/planlar: cari §9 sabit testleri). Planın tabanındaki
// fonksiyonlar (main @ 48a984c; aşağıda harfi harfine kopyalandı) yeni fonksiyonlarla yan yana, seed verisinin
// faturalarıyla (excel-data.json) ve onlardan türetilen rastgele ödeme durumlarıyla (tohumlu): tedarikçinin Kalan
// borç, Vadesi geçen ve 7 gün içinde kartları (summarize → accountOf), Ödemeler'in tutarları ve sırası
// (upcomingItems, laterInvoiceItems), nakit planının toplamları (buildCashPlan), Bu ay ödenen (paidInMonth →
// paymentEvents), Son ödeme, Excel'in Kalan borç sütunu, ödenmemiş fatura özeti ve Genel bakış uyarısı.
// Çalıştırma: npx tsx --test tests/cari-sabit.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildWorkbook } from "../src/app/api/export/workbook";
import { paidInMonth as newPaidInMonth } from "../src/app/panel/tedarikciler/breakdowns";
import { groupSuppliers, summarize, type LedgerInvoice, type SupplierSummary } from "../src/app/panel/tedarikciler/logic";
import { createModel } from "../src/lib/calc/engine";
import { alerts, unpaidSummary } from "../src/lib/calc/insights";
import type { Dataset, Invoice } from "../src/lib/calc/types";
import { accountOf, lastPaymentOf, netCredit, paidInMonthOf, paymentEvents } from "../src/lib/cari/account";
import { buildCashPlan, type CashPlanInput } from "../src/lib/cash-plan";
import { addDays, daysBetween, laterInvoiceItems, upcomingItems, type UnpaidInvoiceRow } from "../src/lib/reminders";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));

// ---------------------------------------------------------------- Tabandaki kurallar (harfi harfine)

type OldBalance = { payable: number; unpaid: boolean; outstanding?: number | null };
function oldOpenBalance(inv: OldBalance): number {
  if (!inv.unpaid) return 0;
  return inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 ? inv.outstanding : inv.payable;
}
function oldIsPartiallyPaid(inv: OldBalance): boolean {
  return inv.unpaid && inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 && inv.outstanding < inv.payable - 0.005;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function oldUnpaidSummary(invoices: OldBalance[]) {
  const open = invoices.filter((i) => i.unpaid);
  return { count: open.length, total: sum(open.map(oldOpenBalance)), payableTotal: sum(open.map((i) => i.payable)), partialCount: open.filter(oldIsPartiallyPaid).length };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const oldDueOf = (i: { date: string; dueDate?: string | null }, termDays: number) => (i.dueDate ? { date: i.dueDate, estimated: false } : { date: addDays(i.date, termDays), estimated: true });
function oldSummarize(invoices: readonly LedgerInvoice[], opts: { today: string; termDays: number }): SupplierSummary {
  const year = opts.today.slice(0, 4);
  const s: SupplierSummary = { count: 0, invoiced: 0, year: 0, openCount: 0, open: 0, requestedCount: 0, requested: 0, overdueCount: 0, overdue: 0, soonCount: 0, soon: 0, nextDue: null, nextSoonDue: null, lastInvoice: null, lastPaid: null };
  for (const i of invoices) {
    s.count++;
    s.invoiced += i.payable;
    if (i.date.startsWith(year)) s.year += i.payable;
    if (!s.lastInvoice || i.date > s.lastInvoice) s.lastInvoice = i.date;
    if (!i.unpaid) {
      if (i.paidAt && (!s.lastPaid || i.paidAt > s.lastPaid)) s.lastPaid = i.paidAt;
      continue;
    }
    const balance = oldOpenBalance(i);
    s.openCount++;
    s.open += balance;
    if (i.paymentRequestedAt) {
      s.requestedCount++;
      s.requested += balance;
    }
    if (balance <= 0) continue;
    const due = oldDueOf(i, opts.termDays);
    const left = daysBetween(opts.today, due.date);
    if (left < 0) {
      s.overdueCount++;
      s.overdue += balance;
    } else if (left <= 7) {
      s.soonCount++;
      s.soon += balance;
      if (!s.nextSoonDue || due.date < s.nextSoonDue) s.nextSoonDue = due.date;
    }
    if (!s.nextDue || due.date < s.nextDue.date) s.nextDue = due;
  }
  for (const k of ["invoiced", "year", "open", "requested", "overdue", "soon"] as const) s[k] = round2(s[k]);
  return s;
}
function oldPaidInMonth(invoices: readonly LedgerInvoice[], month: string): { amount: number; count: number } {
  let amount = 0;
  let n = 0;
  for (const i of invoices) {
    if (i.unpaid || !i.paidAt?.startsWith(month)) continue;
    amount += i.payable;
    n++;
  }
  return { amount: Math.round(amount * 100) / 100, count: n };
}
/** Tedarikçi sayfasının "Son ödeme" alt satırı (page.tsx): o gün ödenen faturaların toplamı */
const oldLastPaidAmount = (invoices: readonly LedgerInvoice[], lastPaid: string | null) => (lastPaid ? invoices.filter((i) => !i.unpaid && i.paidAt === lastPaid).reduce((a, i) => a + i.payable, 0) : 0);
const oldInvoiceAmount = (inv: UnpaidInvoiceRow) => (inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 ? inv.outstanding : inv.payable);

// ---------------------------------------------------------------- Örnek veri: seed faturaları + rastgele ödeme durumları

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed faturaları olduğu gibi, sonra her tohumda ödeme durumu, Paraşüt kalanı, vade ve talep rastgele */
function variants(): Invoice[][] {
  const base = excelToDataset(data).invoices;
  const out: Invoice[][] = [base.map((i) => ({ ...i, outstanding: null }))];
  for (let seed = 1; seed <= 12; seed++) {
    const r = rng(seed);
    out.push(
      base.map((i) => {
        const unpaid = r() < 0.55;
        const partial = unpaid && r() < 0.25 ? Math.round(i.payable * r() * 100) / 100 : r() < 0.1 ? 0 : null;
        const day = `2026-${String(7 + Math.floor(r() * 4)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
        return {
          ...i,
          payable: r() < 0.05 ? -Math.abs(i.payable) : i.payable,
          unpaid,
          outstanding: partial,
          paidAt: unpaid ? null : r() < 0.85 ? day : null,
          dueDate: r() < 0.4 ? day : null,
          paymentRequestedAt: unpaid && r() < 0.2 ? day : null,
        };
      }),
    );
  }
  return out;
}

const TODAYS = ["2026-09-15", "2026-10-24", "2026-11-03"];

// ---------------------------------------------------------------- Testler

test("tedarikçi kartları: Kalan borç, Vadesi geçen, 7 gün, son fatura ve son ödeme aynı (summarize → accountOf)", () => {
  let groups = 0;
  for (const list of variants()) {
    for (const today of TODAYS) {
      for (const termDays of [0, 30, 45]) {
        for (const g of groupSuppliers(list, [], { today, termDays })) {
          assert.deepEqual(g.summary, oldSummarize(g.invoices, { today, termDays }), `${g.name} · ${today}`);
          assert.deepEqual(summarize(g.invoices, { today, termDays }), oldSummarize(g.invoices, { today, termDays }));
          const acc = accountOf({ invoices: g.invoices }, { today, termDays });
          assert.equal(acc.balance, g.summary.open, "bakiye = Kalan borç");
          assert.equal(acc.credit, 0);
          assert.equal(acc.debtOpen, 0);
          assert.equal(acc.covered.length, 0);
          groups++;
        }
      }
    }
  }
  assert.ok(groups > 1000);
});

test("Bu ay ödenen ve Son ödeme aynı (paidInMonth → paymentEvents)", () => {
  for (const list of variants()) {
    for (const g of groupSuppliers(list, [], { today: "2026-10-24", termDays: 30 })) {
      const events = paymentEvents(g.invoices);
      for (const month of ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) {
        assert.deepEqual(paidInMonthOf(events, month), oldPaidInMonth(g.invoices, month), `${g.name} · ${month}`);
        assert.deepEqual(newPaidInMonth(g.invoices, month), oldPaidInMonth(g.invoices, month));
      }
      const last = lastPaymentOf(events);
      assert.equal(last?.date ?? null, g.summary.lastPaid);
      assert.equal(last?.amount ?? 0, round2(oldLastPaidAmount(g.invoices, g.summary.lastPaid)));
    }
  }
});

test("Ödemeler: fatura kalemlerinin tutarları ve sırası aynı (upcomingItems, laterInvoiceItems); mahsup yokken net = tutar", () => {
  for (const list of variants()) {
    const unpaid: UnpaidInvoiceRow[] = list
      .filter((i) => i.unpaid)
      .map((i) => ({ id: i.id, supplier: i.supplier, invoiceNo: i.invoiceNo, date: i.date, dueDate: i.dueDate ?? null, payable: i.payable, outstanding: i.outstanding ?? null, termDays: null }));
    for (const today of TODAYS) {
      const items = upcomingItems([], unpaid, today);
      const later = laterInvoiceItems(unpaid, today);
      const byId = new Map(unpaid.map((i) => [i.id, i]));
      for (const it of [...items, ...later]) assert.equal(it.amount, oldInvoiceAmount(byId.get(it.sourceId)!), `${it.title} ${it.ref}`);
      assert.equal(items.length + later.length, unpaid.length);
      // Sıra: vade, sonra başlık (tutar sıraya katılmaz)
      for (let k = 1; k < items.length; k++) assert.ok(items[k - 1].dueDate <= items[k].dueDate);
      // Mahsup: hesapta para yokken her kalemin neti kendi tutarı, sıraları değişmez
      const net = netCredit(
        items.map((i) => ({ kind: "invoice" as const, id: i.sourceId, date: byId.get(i.sourceId)!.date, due: i.dueDate, balance: i.amount ?? 0 })),
        0,
      );
      assert.equal(net.covered.length, 0);
      assert.deepEqual(new Map(net.items.map((x) => [x.id, x.net])), new Map(items.map((i) => [i.sourceId, i.amount])));
    }
  }
});

test("nakit planı: fatura kalemleri aynı olduğu için bütün toplamlar aynı", () => {
  const today = "2026-10-24";
  for (const list of variants().slice(0, 4)) {
    const unpaid: UnpaidInvoiceRow[] = list
      .filter((i) => i.unpaid)
      .map((i) => ({ id: i.id, supplier: i.supplier, invoiceNo: i.invoiceNo, date: i.date, dueDate: i.dueDate ?? null, payable: i.payable, outstanding: i.outstanding ?? null }));
    const items = upcomingItems([], unpaid, today);
    const legacy = items.map((it) => ({ ...it, amount: oldInvoiceAmount(unpaid.find((u) => u.id === it.sourceId)!) }));
    const input = (invoices: CashPlanInput["invoices"]): CashPlanInput => ({
      today,
      opening: { amount: 50_000, date: today },
      excluded: [],
      settings: { komisyon: 0.025, kartOrani: 0.8, acikGun: 30, kdv: 0.1, kdvHizmet: 0.2 },
      invoiceTermDays: 30,
      cashReports: [],
      posMonth: { month: "2026-09", posRevenue: 300_000, openDays: 30 },
      online: null,
      invoices,
      reminders: [],
      goods: [],
      goodsSpanDays: 0,
      months: {},
      fixedNames: [],
      vat: { months: [], firstSalesMonth: null, hasSite: false },
      vatAnchor: null,
    });
    const a = buildCashPlan(input(items));
    const b = buildCashPlan(input(legacy));
    assert.deepEqual(a, b);
    assert.ok(a.weeks.some((w) => w.lines.some((l) => l.key.startsWith("invoice:"))), "faturalar plana girdi");
  }
});

test("ödenmemiş fatura özeti ve Genel bakış uyarısı aynı", () => {
  for (const list of variants()) {
    assert.deepEqual(unpaidSummary(list), oldUnpaidSummary(list));
    const ds: Dataset = { ...excelToDataset(data), invoices: list, currentMonth: "2026-10" };
    const model = createModel(ds);
    const alert = alerts(model, "2026-10").find((a) => a.title.endsWith("fatura ödenmemiş görünüyor"));
    const open = list.filter((i) => i.unpaid);
    if (!open.length) {
      assert.equal(alert, undefined);
      continue;
    }
    assert.equal(alert?.title, `${open.length} fatura ödenmemiş görünüyor`);
    assert.equal(
      alert?.detail,
      open
        .slice(0, 3)
        .map((i) => `${i.supplier} ${Math.round(oldOpenBalance(i)).toLocaleString("tr-TR")} ₺${oldIsPartiallyPaid(i) ? " kalan" : ""}`)
        .join(", "),
    );
  }
});

test("Excel: Faturalar sekmesinin Kalan borç sütunu aynı", () => {
  for (const list of variants().slice(0, 4)) {
    const ds: Dataset = { ...excelToDataset(data), invoices: list, currentMonth: "2026-10" };
    const model = createModel(ds);
    const wb = buildWorkbook(model, "2026-09", { investments: [], findings: [], now: new Date("2026-10-24T10:00:00Z"), outstanding: new Map(list.map((i) => [i.id, i.outstanding ?? null])) });
    const ws = wb.getWorksheet("Faturalar")!;
    assert.equal(ws.getRow(1).getCell(13).value, "Kalan borç");
    model.ds.invoices.forEach((inv, k) => {
      const cell = ws.getRow(k + 2).getCell(13).value;
      assert.equal(cell, inv.unpaid ? oldOpenBalance(inv) : null, `${inv.supplier} ${inv.date}`);
    });
  }
});

// Tedarikçi sayfasının ve listesinin cari kuralları (docs/planlar: cari §6.1, §6.3): kayıt yokken kart dökümleri,
// liste süzgeci ve gizli tedarikçi bugünküyle aynı; kayıt varken dökümler faturasız alımları ve hesaptaki parayı,
// gizli tedarikçi açık kalemi ve parası olunca listeye döner, ödeme talebi metni faturasız alımları ve hesaptaki
// ödemeyi yazar. Kaynak taraması: cari pencereleri eylemleri yalnız src/server/actions/cari*.ts'ten çağırır.
// Çalıştırma: npx tsx --test tests/cari-sayfa.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { accountBreakdowns, supplierBreakdowns, type BreakdownDebt, type BreakdownInvoice } from "../src/app/panel/tedarikciler/breakdowns";
import { isHiddenSupplier, matchesSupplierFilter, paymentRequestText } from "../src/app/panel/tedarikciler/logic";
import { accountOf, debtRemaining, type CariAllocation, type CariPayment } from "../src/lib/cari/account";

const TODAY = "2026-10-24";
const opts = { today: TODAY, termDays: 30, rowHref: (id: number) => `?fatura=${id}`, debtHref: () => "?sekme=hareketler" };

let nextId = 1;
const inv = (p: Partial<BreakdownInvoice> & { payable: number }): BreakdownInvoice => ({
  id: nextId++,
  invoiceNo: null,
  date: "2026-10-01",
  supplier: "Sütaş",
  unpaid: true,
  outstanding: null,
  dueDate: null,
  paidAt: null,
  paymentRequestedAt: null,
  ...p,
});

test("kart dökümleri: kayıt yokken supplierBreakdowns'un aynısı", () => {
  const invoices = [
    inv({ payable: 1000, date: "2026-09-01" }),
    inv({ payable: 3000, date: "2026-10-18", outstanding: 1800, invoiceNo: "SUT140" }),
    inv({ payable: 4000, unpaid: false, paidAt: "2026-10-10" }),
    inv({ payable: -200, date: "2026-10-05" }),
  ];
  const account = accountOf({ invoices }, { today: TODAY, termDays: 30 });
  assert.deepEqual(accountBreakdowns(invoices, { debts: [], account, remaining: () => 0 }, opts), supplierBreakdowns(invoices, opts));
});

test("kart dökümleri: faturasız alımlar, hesaptaki ödeme (eksi), mahsuptan sonra gecikme, ödeme olayları", () => {
  const f1 = inv({ payable: 1000, date: "2026-09-01", invoiceNo: "A1", ledgerBase: 0, allocated: 0 });
  const invoices = [f1];
  const debts: (BreakdownDebt & { dueDate: string | null })[] = [
    { id: 101, date: "2026-10-20", description: "süt", amount: 1250, costMode: "fatura", invoiceId: null, dueDate: null },
    { id: 102, date: "2025-12-01", description: "eski", amount: 500, costMode: "devir", invoiceId: null, dueDate: null },
  ];
  const payments: CariPayment[] = [{ id: 201, date: "2026-10-22", amount: 1300, method: "havale" }];
  const allocations: CariAllocation[] = [{ id: 1, paymentId: 201, invoiceId: null, debtId: 102, amount: 500 }];
  const account = accountOf({ invoices, debts, payments, allocations }, { today: TODAY, termDays: 30 });
  assert.equal(account.credit, 800);
  const remaining = (id: number) => debtRemaining(debts.find((d) => d.id === id)!, allocations);
  const b = accountBreakdowns(invoices, { debts, account, remaining }, opts);
  assert.deepEqual(
    b.open.map((g) => [g.label, g.rows.map((r) => [r.label, r.amount])]),
    [
      ["Faturalar", [["01.09.2026 · A1", 1000]]],
      ["Faturasız alımlar", [["20.10.2026 · süt", 1250]]],
      ["Hesaptaki ödeme", [["Hesapta sayılmamış ödeme", -800]]],
    ],
  );
  // A1 vadesi 01.10'da geçti; hesaptaki 800 ondan düşülür
  assert.deepEqual(
    b.overdue[0].rows.map((r) => [r.label, r.amount]),
    [["01.09.2026 · A1", 200]],
  );
  // Yıl: eski borç (devir) hariç; ödemeler: ödeme kaydı
  assert.deepEqual(b.year[0].rows.map((r) => [r.key, r.amount, r.sub]), [
    ["2026-10", 1250, "1 faturasız alım"],
    ["2026-09", 1000, "1 fatura"],
  ]);
  assert.deepEqual(b.paid[0].rows.map((r) => [r.label, r.amount, r.sub]), [["22.10.2026", 1300, "1 ödeme"]]);
});

test("liste: Borcu olanlar hesaptaki parayı sayar; para yokken bugünkü kural (iade dahil)", () => {
  const base = { count: 1, invoiced: 0, year: 0, openCount: 1, open: 500, requestedCount: 0, requested: 0, overdueCount: 0, overdue: 0, soonCount: 0, soon: 0, nextDue: null, nextSoonDue: null, lastInvoice: null, lastPaid: null };
  const row = (open: number, credit?: number) => ({ hasCard: true, missing: [], summary: { ...base, open }, credit });
  assert.equal(matchesSupplierFilter(row(500), "borclu"), true);
  assert.equal(matchesSupplierFilter(row(-200), "borclu"), true, "yalnız ödenmemiş iade: bugünkü gibi");
  assert.equal(matchesSupplierFilter(row(-99.5, 99.5), "borclu"), false, "hesaptaki para borcu karşılıyor");
  assert.equal(matchesSupplierFilter(row(100, 400), "borclu"), true);
});

test("gizli tedarikçi: açık kalem, hesapta para ya da sonraki kayıt listeye geri getirir (K23)", () => {
  const card = { hiddenOn: "2026-10-10" };
  const summary = { openCount: 0, lastInvoice: "2026-09-01" };
  assert.equal(isHiddenSupplier(card, summary), true);
  assert.equal(isHiddenSupplier(card, summary, { openCount: 0, credit: 0, lastEntry: null }), true);
  assert.equal(isHiddenSupplier(card, summary, { openCount: 1, credit: 0, lastEntry: null }), false);
  assert.equal(isHiddenSupplier(card, summary, { openCount: 0, credit: 99.5, lastEntry: null }), false);
  assert.equal(isHiddenSupplier(card, summary, { openCount: 0, credit: 0, lastEntry: "2026-10-10" }), true, "kaldırıldığı günün kaydı getirmez");
  assert.equal(isHiddenSupplier(card, summary, { openCount: 0, credit: 0, lastEntry: "2026-10-11" }), false);
});

test("ödeme talebi metni: faturasız alımlar ve hesaptaki ödeme; yokken metin aynı", () => {
  const card = { legalName: "SÜTAŞ A.Ş.", iban: null, bankName: null, accountHolder: null, taxNumber: null };
  const lines = [{ date: "2026-10-12", invoiceNo: "SUT123", amount: 8450.5, dueDate: null }];
  const plain = paymentRequestText({ name: "Sütaş", card, lines });
  assert.equal(paymentRequestText({ name: "Sütaş", card, lines, purchases: [], accountCredit: 0 }), plain);
  const text = paymentRequestText({ name: "Sütaş", card, lines, purchases: [{ date: "2026-10-20", description: "süt", amount: 1250 }], accountCredit: 99.5 });
  assert.match(text, /Tutar: 9\.601\s₺\n/);
  assert.match(text, /Faturasız alımlar \(1\):\n• 20\.10\.2026 · Faturasız alım \(süt\) · 1\.250\s₺/);
  assert.match(text, /\nHesaptaki ödeme: −99,50\s₺/);
});

test("kaynak: cari pencereleri yazımı yalnız cari eylemleriyle yapar, eylem dosyasında yardımcı dışa aktarım yok", () => {
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  for (const f of [
    "src/app/panel/tedarikciler/cari-payment-dialog.tsx",
    "src/app/panel/tedarikciler/[cari]/debt-dialog.tsx",
    "src/app/panel/tedarikciler/[cari]/link-dialog.tsx",
    "src/app/panel/tedarikciler/[cari]/allocation-dialog.tsx",
  ]) {
    const src = read(f);
    assert.match(src, /^"use client";/);
    assert.match(src, /useActionTransition\(\)/, `${f}: geçiş useActionTransition ile`);
    assert.doesNotMatch(src, /\buseTransition\(\)/);
    for (const m of src.matchAll(/from "@\/server\/([^"]+)"/g)) assert.match(m[1], /^actions\/cari(-options)?$/, `${f}: ${m[1]}`);
  }
  const options = read("src/server/actions/cari-options.ts");
  assert.match(options, /^"use server";/);
  const exports = [...options.matchAll(/^export (.*)$/gm)].map((m) => m[1]);
  for (const e of exports) assert.match(e, /^async function \w+\(/);
  assert.equal([...options.matchAll(/return attempt\(async \(\) => \{\n\s+await requireAdmin\(\);/g)].length, exports.length);
});

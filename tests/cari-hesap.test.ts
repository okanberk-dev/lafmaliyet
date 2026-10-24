// Cari hesabın saf kuralları (src/lib/cari/account.ts, statement.ts): dağıtım sırası, "Seçerek" dağıtımın denetimi,
// önizleme metni, okuma anında mahsup, ödeme olayları ve Bu ay ödenen, defterin ödendi işareti, sığdırma. Planın
// Sütaş örneği (docs/planlar: cari §4.9) adım adım bütün rakamlarıyla, ekstre tablosu satır satır; rastgele hesaplarda
// (tohumlu) ekstrenin son bakiyesi = açık − hesaptaki para.
// Çalıştırma: npx tsx --test tests/cari-hesap.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountOf,
  allocateFifo,
  allocationPreview,
  compareOpenItems,
  debtRemaining,
  fitAllocations,
  invoiceRoom,
  netCredit,
  openItems,
  paidInMonthOf,
  paymentCredit,
  paymentEvents,
  payableFloorProblem,
  settlePatch,
  validateManual,
  type AccountInvoice,
  type CariAllocation,
  type CariDebt,
  type CariPayment,
  type OpenItem,
} from "../src/lib/cari/account";
import { trackingBase, type CariMethod } from "../src/lib/cari/balance";
import { linkCandidates } from "../src/lib/cari/match";
import { statementRows } from "../src/lib/cari/statement";

const plain = (s: string) => s.replace(/ /g, " ");

// ---------------------------------------------------------------- Küçük bellek içi defter (settle.ts'in saf kopyası)

type Inv = AccountInvoice & { invoiceNo: string; category: string };

interface Ledger {
  invoices: Inv[];
  debts: CariDebt[];
  payments: CariPayment[];
  allocations: CariAllocation[];
  nextAlloc: number;
}

const TERM = 30;

function recompute(l: Ledger) {
  for (const i of l.invoices) i.allocated = Math.round(l.allocations.filter((a) => a.invoiceId === i.id).reduce((x, a) => x + a.amount, 0) * 100) / 100;
  for (const i of l.invoices) {
    const mine = l.allocations.filter((a) => a.invoiceId === i.id);
    const lastPay = mine.map((a) => l.payments.find((p) => p.id === a.paymentId)!).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).at(-1);
    const patch = settlePatch(i, lastPay ? { date: lastPay.date, method: lastPay.method } : null);
    if (patch) Object.assign(i, patch.set);
  }
}

function startTracking(l: Ledger) {
  for (const i of l.invoices) if (i.ledgerBase === null || i.ledgerBase === undefined) i.ledgerBase = trackingBase(i);
}

function pay(l: Ledger, p: { id: number; date: string; amount: number; method: CariMethod; cashOutStore?: string }) {
  if (!l.payments.length) startTracking(l);
  l.payments.push({ ...p });
  const { lines } = allocateFifo(openItems(l, TERM), p.amount);
  for (const x of lines) l.allocations.push({ id: l.nextAlloc++, paymentId: p.id, invoiceId: x.kind === "invoice" ? x.id : null, debtId: x.kind === "debt" ? x.id : null, amount: x.amount });
  recompute(l);
  return lines;
}

function applyCredit(l: Ledger) {
  for (const p of [...l.payments].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    const credit = paymentCredit(p, l.allocations);
    if (credit <= 0.005) continue;
    for (const x of allocateFifo(openItems(l, TERM), credit).lines) {
      l.allocations.push({ id: l.nextAlloc++, paymentId: p.id, invoiceId: x.kind === "invoice" ? x.id : null, debtId: x.kind === "debt" ? x.id : null, amount: x.amount });
    }
    recompute(l);
  }
}

function link(l: Ledger, debtIds: number[], invoiceId: number) {
  const inv = l.invoices.find((i) => i.id === invoiceId)!;
  for (const id of debtIds) l.debts.find((d) => d.id === id)!.invoiceId = invoiceId;
  const moving = l.allocations.filter((a) => a.debtId !== null && debtIds.includes(a.debtId));
  for (const a of moving) Object.assign(a, { originDebtId: a.debtId, debtId: null, invoiceId });
  recompute(l);
  const fit = fitAllocations(
    l.allocations.filter((a) => a.invoiceId === invoiceId),
    inv.payable - (inv.ledgerBase ?? 0),
  );
  for (const k of fit.keep) l.allocations.find((a) => a.id === k.id)!.amount = k.amount;
  l.allocations = l.allocations.filter((a) => !fit.drop.includes(a.id));
  recompute(l);
}

const balanceOf = (l: Ledger, today = "2026-10-30") => accountOf(l, { today, termDays: TERM }).balance;

// ---------------------------------------------------------------- Sütaş (§4.9)

function sutas(): Ledger {
  return {
    invoices: [
      { id: 1, date: "2026-10-01", invoiceNo: "SUT098", category: "Hammadde & İçecek", payable: 4000, unpaid: false, paidAt: "2026-10-10", paidVia: "havale", outstanding: null, ledgerBase: null, allocated: 0, paidByLedger: false },
      { id: 2, date: "2026-10-12", invoiceNo: "SUT123", category: "Hammadde & İçecek", payable: 8450.5, unpaid: true, outstanding: null, ledgerBase: null, allocated: 0, paidByLedger: false },
      { id: 3, date: "2026-10-18", invoiceNo: "SUT140", category: "Hammadde & İçecek", payable: 3000, unpaid: true, outstanding: 1800, ledgerBase: null, allocated: 0, paidByLedger: false },
    ],
    debts: [],
    payments: [],
    allocations: [],
    nextAlloc: 1,
  };
}

test("Sütaş örneği: her adımın Kalan borcu, kapanan faturalar, Ekim'de ödenen ve ekstre", () => {
  const l = sutas();
  assert.equal(balanceOf(l, "2026-10-19"), 10250.5, "başlangıç: bugünkü kural");
  // 1. Borç ekle: B1 süt 1.250 (faturası gelecek)
  l.debts.push({ id: 101, date: "2026-10-20", amount: 1250, description: "süt", costMode: "fatura", dueDate: null, invoiceId: null });
  assert.equal(balanceOf(l), 11500.5);
  // 2. Borç ekle: B2 beyaz peynir 600 (faturası yok · gider yaz)
  l.debts.push({ id: 102, date: "2026-10-21", amount: 600, description: "beyaz peynir", costMode: "gider", dueDate: null, invoiceId: null });
  assert.equal(balanceOf(l), 12100.5);
  // 3. Ödeme ekle: 10.000 havale, en eski borçtan; önizleme takip başlamadan da aynı
  const items3 = openItems(l, TERM);
  assert.deepEqual(
    items3.map((i) => [i.label, i.due]),
    [
      ["SUT123", "2026-11-11"],
      ["SUT140", "2026-11-17"],
      ["süt", "2026-11-19"],
      ["beyaz peynir", "2026-11-20"],
    ],
  );
  const plan3 = allocateFifo(items3, 10000);
  assert.equal(plain(allocationPreview(plan3.lines, items3, plan3.left)), "Kapanacak: SUT123 8.450,50 ₺ · Kısmen: SUT140 1.549,50 / 1.800,00 ₺ · Hesapta kalacak: 0,00 ₺");
  pay(l, { id: 201, date: "2026-10-22", amount: 10000, method: "havale" });
  assert.deepEqual(
    l.invoices.map((i) => i.ledgerBase),
    [0, 0, 1200],
    "takip başladı: F3'e Paraşüt'ün ödendi gösterdiği 1.200",
  );
  const f2 = l.invoices[1];
  assert.deepEqual([f2.unpaid, f2.paidAt, f2.paidVia, f2.paidByLedger], [false, "2026-10-22", "havale", true], "SUT123 defterle kapandı");
  assert.equal(l.invoices[2].allocated, 1549.5);
  assert.equal(balanceOf(l), 2100.5);
  // 4. Muhasebeci aynı ödemeyi Paraşüt'te işler: takipli fatura Paraşüt'ün kalanını okumaz
  l.invoices[2].outstanding = 250.5;
  assert.equal(balanceOf(l), 2100.5);
  // 5. Kasadan 2.200 (Teslim · Sütaş), en eski borçtan: F3, B1, B2 kapanır, hesapta 99,50 kalır
  pay(l, { id: 202, date: "2026-10-24", amount: 2200, method: "kasa", cashOutStore: "Sütaş" });
  const f3 = l.invoices[2];
  assert.deepEqual([f3.unpaid, f3.paidAt, f3.paidVia, f3.paidByLedger], [false, "2026-10-24", "nakit", true]);
  assert.equal(debtRemaining(l.debts[0], l.allocations), 0);
  assert.equal(debtRemaining(l.debts[1], l.allocations), 0);
  const a5 = accountOf(l, { today: "2026-10-24", termDays: TERM });
  assert.equal(a5.balance, -99.5);
  assert.equal(a5.credit, 99.5);
  assert.equal(a5.open, 0);
  assert.equal(a5.overdueCount + a5.soonCount, 0);
  // 6. Eşitleme SUT149'u getirir (takipli kart: taban 0); B1 için güçlü aday
  l.invoices.push({ id: 4, date: "2026-10-28", invoiceNo: "SUT149", category: "Hammadde & İçecek", payable: 1250, unpaid: true, outstanding: 1250, ledgerBase: 0, allocated: 0, paidByLedger: false });
  assert.equal(balanceOf(l), 1150.5);
  assert.deepEqual(
    linkCandidates(l.debts, l.invoices).strong.map((c) => [c.invoiceId, c.debtIds]),
    [[4, [101]]],
  );
  // 7. Bağla: B1 → SUT149; B1'e sayılan 1.250 faturaya geçer, SUT149 defterle kapanır (24.10, nakit)
  link(l, [101], 4);
  const sut149 = l.invoices[3];
  assert.deepEqual([sut149.unpaid, sut149.paidAt, sut149.paidVia, sut149.paidByLedger, sut149.allocated], [false, "2026-10-24", "nakit", true, 1250]);
  assert.equal(l.allocations.find((a) => a.invoiceId === 4)?.originDebtId, 101);
  assert.equal(balanceOf(l), -99.5);
  // 8. Eşitleme SUT151'i getirir: mahsup hesaptaki 99,50'yi düşer, "Borçlara say" kalıcı yazar; rakam değişmez
  l.invoices.push({ id: 5, date: "2026-10-30", invoiceNo: "SUT151", category: "Hammadde & İçecek", payable: 3100, unpaid: true, outstanding: 3100, ledgerBase: 0, allocated: 0, paidByLedger: false, dueDate: "2026-11-29" });
  const a8 = accountOf(l, { today: "2026-10-30", termDays: TERM });
  assert.equal(a8.balance, 3000.5);
  assert.deepEqual(
    a8.items.map((i) => [i.label, i.net, i.credited]),
    [["SUT151", 3000.5, 99.5]],
    "Ödemeler SUT151'i 3.000,50 gösterir",
  );
  applyCredit(l);
  assert.equal(l.invoices[4].allocated, 99.5);
  assert.equal(balanceOf(l), 3000.5);
  assert.equal(accountOf(l, { today: "2026-10-30", termDays: TERM }).credit, 0);

  // Ekim'de ödenen: F1 örtük 4.000 + 10.000 + 2.200; defterin kapattığı faturalar 0 katar
  const events = paymentEvents(l.invoices, l.payments);
  assert.deepEqual(paidInMonthOf(events, "2026-10"), { amount: 16200, count: 3 });
  assert.equal(accountOf(l, { today: "2026-10-30", termDays: TERM }).lastPaid, "2026-10-24");

  // Ekstre (30.10, Tümü)
  const st = statementRows(l);
  const table = st.rows.map((r) => [r.date.slice(8, 10) + "." + r.date.slice(5, 7), plain(r.label), r.muted ? `(${r.debit})` : r.debit || "", r.credit || "", r.balance]);
  assert.deepEqual(table, [
    ["01.10", "Fatura SUT098", 4000, "", 4000],
    ["10.10", "Faturada işaretli ödeme · Havale / EFT", "", 4000, 0],
    ["12.10", "Fatura SUT123", 8450.5, "", 8450.5],
    ["18.10", "Fatura SUT140", 3000, "", 11450.5],
    ["18.10", "Paraşüt'te ödenen kısım (gün bilinmiyor)", "", 1200, 10250.5],
    ["20.10", "Faturasız alım · süt → SUT149 faturasına bağlandı", "(1250)", "", 10250.5],
    ["21.10", "Faturasız alım · beyaz peynir (gider yazıldı)", 600, "", 10850.5],
    ["22.10", "Ödeme · Havale / EFT", "", 10000, 850.5],
    ["24.10", "Ödeme · Kasadan, Teslim · Sütaş", "", 2200, -1349.5],
    ["28.10", "Fatura SUT149", 1250, "", -99.5],
    ["30.10", "Fatura SUT151", 3100, "", 3000.5],
  ]);
  assert.deepEqual(
    st.rows.filter((r) => r.kind === "odeme").map((r) => [r.allocations?.map((a) => `${a.label} ${a.amount}`), r.left]),
    [
      [["SUT123 8450.5", "SUT140 1549.5"], 0],
      [["SUT140 250.5", "SUT149 1250", "beyaz peynir 600", "SUT151 99.5"], 0],
    ],
  );
  assert.equal(st.closing, 3000.5);
  // 19.10 itibarıyla aynı ekstrenin bakiyesi bugünkü sayı
  assert.equal(st.rows.filter((r) => r.date <= "2026-10-19").at(-1)?.balance, 10250.5);
});

// ---------------------------------------------------------------- Parça parça

const item = (p: Partial<OpenItem> & { kind: OpenItem["kind"]; id: number }): OpenItem => ({ date: "2026-10-01", due: "2026-10-31", dueEstimated: true, balance: 100, label: `K${p.id}`, ...p });

test("dağıtım sırası: vade, sonra gün, sonra önce faturalar, sonra kimlik; sayılamayan hesapta kalır", () => {
  const items = [
    item({ kind: "debt", id: 1, due: "2026-11-01" }),
    item({ kind: "invoice", id: 9, due: "2026-11-01" }),
    item({ kind: "invoice", id: 3, due: "2026-10-20", date: "2026-10-05" }),
    item({ kind: "invoice", id: 2, due: "2026-10-20", date: "2026-10-01" }),
    item({ kind: "debt", id: 5, due: "2026-10-20", date: "2026-10-01" }),
  ];
  assert.deepEqual(
    [...items].sort(compareOpenItems).map((i) => `${i.kind}:${i.id}`),
    ["invoice:2", "debt:5", "invoice:3", "invoice:9", "debt:1"],
  );
  const { lines, left } = allocateFifo(items, 350);
  assert.deepEqual(
    lines.map((x) => `${x.kind}:${x.id}:${x.amount}`),
    ["invoice:2:100", "debt:5:100", "invoice:3:100", "invoice:9:50"],
  );
  assert.equal(left, 0);
  assert.equal(allocateFifo(items, 600).left, 100);
  assert.deepEqual(allocateFifo([], 99.5), { lines: [], left: 99.5 });
});

test("seçerek dağıtım: kalem, kalan ve toplam denetimi", () => {
  const items = [item({ kind: "invoice", id: 1, label: "SUT140", balance: 1800 }), item({ kind: "debt", id: 2, label: "süt", balance: 1250 })];
  assert.equal(validateManual([{ kind: "invoice", id: 1, amount: 1800 }], items, 2000), null);
  assert.equal(plain(validateManual([{ kind: "invoice", id: 1, amount: 1800.01 }], items, 5000) ?? ""), "SUT140 kalanı 1.800,00 ₺");
  assert.equal(validateManual([{ kind: "invoice", id: 1, amount: 1000 }, { kind: "debt", id: 2, amount: 1000.5 }], items, 2000), "Sayılan tutar ödemeden fazla");
  assert.match(validateManual([{ kind: "invoice", id: 7, amount: 10 }], items, 2000) ?? "", /açık kalemi değil/);
  assert.match(validateManual([{ kind: "debt", id: 2, amount: 0 }], items, 2000) ?? "", /tutar girin/);
  assert.match(validateManual([{ kind: "debt", id: 2, amount: 10 }, { kind: "debt", id: 2, amount: 10 }], items, 2000) ?? "", /iki kez/);
});

test("mahsup: tam, kısmi; sessiz 'link' kalemi atlanır; para yokken net = kalan", () => {
  const items = [
    { ...item({ kind: "invoice", id: 1, due: "2026-10-10", balance: 50 }) },
    { ...item({ kind: "invoice", id: 2, due: "2026-10-12", balance: 300 }), quiet: "link" as const },
    { ...item({ kind: "debt", id: 3, due: "2026-10-15", balance: 200 }) },
  ];
  const r = netCredit(items, 120);
  assert.deepEqual(r.covered.map((x) => [x.id, x.credited]), [[1, 50]]);
  assert.deepEqual(
    r.items.map((x) => [x.id, x.net, x.credited]),
    [
      [2, 300, 0],
      [3, 130, 70],
    ],
  );
  assert.equal(r.left, 0);
  const none = netCredit(items, 0);
  assert.deepEqual(none.items.map((x) => x.net), [50, 300, 200]);
  assert.equal(none.covered.length, 0);
  assert.equal(netCredit(items, 1000).left, 750, "sessiz kalem paradan pay almaz");
});

test("ödeme olayları: kayıtlar ve örtük ✓; defterin kapattığı fatura 0 katar, takip öncesi kısım sayılmaz", () => {
  const invoices: AccountInvoice[] = [
    { id: 1, date: "2026-10-01", payable: 4000, unpaid: false, paidAt: "2026-10-10", ledgerBase: null },
    { id: 2, date: "2026-10-01", payable: 1000, unpaid: false, paidAt: "2026-10-12", ledgerBase: 200, allocated: 300 },
    { id: 3, date: "2026-10-01", payable: 500, unpaid: false, paidAt: "2026-10-13", ledgerBase: 0, allocated: 500, paidByLedger: true },
    { id: 4, date: "2026-10-01", payable: -150, unpaid: false, paidAt: "2026-10-14", ledgerBase: null },
    { id: 5, date: "2026-10-01", payable: 700, unpaid: false, paidAt: null },
    { id: 6, date: "2026-10-01", payable: 900, unpaid: true, paidAt: null },
    { id: 7, date: "2026-10-01", payable: 300, unpaid: false, paidAt: "2026-10-15", ledgerBase: 0, allocated: 300 },
  ];
  const ev = paymentEvents(invoices, [{ id: 9, date: "2026-10-11", amount: 800, method: "havale" }]);
  assert.deepEqual(
    ev.map((e) => [e.kind, e.id, e.amount]),
    [
      ["invoice", 4, -150],
      ["invoice", 2, 500],
      ["payment", 9, 800],
      ["invoice", 1, 4000],
    ],
  );
  assert.deepEqual(paidInMonthOf(ev, "2026-10"), { amount: 5150, count: 4 });
  assert.deepEqual(paidInMonthOf(ev, "2026-09"), { amount: 0, count: 0 });
});

test("ödendi işareti: dağıtım kapatır, karşılık düşünce yalnız defterin kapattığını açar; elle ✓'ye dokunmaz", () => {
  const base = { payable: 1000, ledgerBase: 0 };
  assert.deepEqual(settlePatch({ ...base, unpaid: true, allocated: 1000 }, { date: "2026-10-22", method: "elden" }), {
    action: "close",
    set: { unpaid: false, paidAt: "2026-10-22", paidVia: "nakit", paymentRequestedAt: null, paidByLedger: true },
  });
  assert.equal(settlePatch({ ...base, unpaid: true, allocated: 999 }, null), null, "kısmi: açık kalır");
  assert.deepEqual(settlePatch({ ...base, unpaid: false, allocated: 400, paidByLedger: true, paidAt: "2026-10-22", paidVia: "nakit" }, null), {
    action: "reopen",
    set: { unpaid: true, paidAt: null, paidVia: null, paidByLedger: false },
  });
  assert.equal(settlePatch({ ...base, unpaid: false, allocated: 400, paidByLedger: false, paidAt: "2026-10-22" }, null), null, "elle ✓");
  assert.deepEqual(settlePatch({ ...base, unpaid: false, allocated: 1000, paidByLedger: true, paidAt: "2026-10-22", paidVia: "nakit" }, { date: "2026-10-25", method: "havale" }), {
    action: "touch",
    set: { paidAt: "2026-10-25", paidVia: "havale" },
  });
  assert.equal(settlePatch({ payable: 1000, ledgerBase: null, unpaid: true, allocated: 1000 }, null), null, "takipsiz kapanmaz");
});

test("sığdırma: eskiden yeniye sığan kalır, en yeniden kırpılır", () => {
  const allocs = [
    { id: 3, amount: 300 },
    { id: 1, amount: 500 },
    { id: 2, amount: 400 },
  ];
  assert.deepEqual(fitAllocations(allocs, 1000), { keep: [{ id: 1, amount: 500 }, { id: 2, amount: 400 }, { id: 3, amount: 100 }], drop: [], trimmed: 200 });
  assert.deepEqual(fitAllocations(allocs, 500), { keep: [{ id: 1, amount: 500 }], drop: [2, 3], trimmed: 700 });
  assert.deepEqual(fitAllocations(allocs, 5000).trimmed, 0);
  assert.equal(invoiceRoom({ payable: 3000, ledgerBase: 1200, allocated: 1549.5 }), 250.5);
  assert.equal(invoiceRoom({ payable: -200, ledgerBase: 0, allocated: 0 }), 0);
});

test("elle faturanın tutar sınırı: sayılan (takip öncesi + panelde) altına inemez; takipsiz ve iade serbest", () => {
  assert.equal(payableFloorProblem({ ledgerBase: 0, allocated: 1549.5 }, 1549.5), null, "tam sayılan kadar olur");
  assert.equal(payableFloorProblem({ ledgerBase: 0, allocated: 1549.5 }, 1549.496), null, "kuruş altı fark");
  assert.equal(payableFloorProblem({ ledgerBase: 0, allocated: 1549.5 }, 1500), "Bu faturaya 1.549,50\u00a0₺ ödeme sayılmış; tutar bundan az olamaz");
  assert.equal(payableFloorProblem({ ledgerBase: 1200, allocated: 349.5 }, 1500), "Bu faturaya 1.549,50\u00a0₺ ödeme sayılmış; tutar bundan az olamaz");
  assert.equal(payableFloorProblem({ ledgerBase: null, allocated: 0 }, -50), null, "takipsiz iade");
  assert.equal(payableFloorProblem({ ledgerBase: 0, allocated: 0 }, -50), null, "takipli, sayılmamış iade");
});

test("borç ve ödeme: kalan ve hesaptaki para; bağlı borç 0", () => {
  const allocations: CariAllocation[] = [
    { id: 1, paymentId: 9, invoiceId: null, debtId: 1, amount: 400 },
    { id: 2, paymentId: 9, invoiceId: 7, debtId: null, amount: 100 },
  ];
  assert.equal(debtRemaining({ id: 1, amount: 1250, invoiceId: null }, allocations), 850);
  assert.equal(debtRemaining({ id: 1, amount: 1250, invoiceId: 4 }, allocations), 0);
  assert.equal(paymentCredit({ id: 9, amount: 600 }, allocations), 100);
  assert.equal(paymentCredit({ id: 8, amount: 600 }, allocations), 600);
});

// ---------------------------------------------------------------- Rastgele: ekstrenin son satırı = bakiye

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

test("rastgele hesaplar (tohumlu): ekstrenin son bakiyesi = açık − hesaptaki para", () => {
  const METHODS: CariMethod[] = ["kasa", "elden", "havale", "kart", "cek", "diger"];
  const seen = { credit: 0, ledger: 0, manual: 0, linked: 0, partial: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const money = (max: number) => Math.round(r() * max * 100) / 100 + 0.01;
    const day = () => `2026-${String(8 + Math.floor(r() * 3)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
    const l: Ledger = { invoices: [], debts: [], payments: [], allocations: [], nextAlloc: 1 };
    const n = Math.floor(r() * 7);
    for (let i = 0; i < n; i++) {
      const refund = r() < 0.12;
      const payable = refund ? -money(500) : money(9000);
      const unpaid = r() < 0.65;
      const outstanding = unpaid && !refund && r() < 0.3 ? Math.round(payable * r() * 100) / 100 : null;
      const paidAt = unpaid ? null : r() < 0.85 ? day() : null;
      l.invoices.push({ id: i + 1, date: day(), invoiceNo: `F${i + 1}`, category: "Hammadde & İçecek", payable, unpaid, outstanding, paidAt, paidVia: paidAt ? "havale" : null, ledgerBase: null, allocated: 0, paidByLedger: false });
    }
    const tracked = r() < 0.7;
    if (tracked) {
      const debts = Math.floor(r() * 4);
      for (let d = 0; d < debts; d++) {
        const modes = ["fatura", "gider", "mevcut", "devir"] as const;
        const linkTo = r() < 0.2 && l.invoices.length ? l.invoices[Math.floor(r() * l.invoices.length)].id : null;
        l.debts.push({ id: 100 + d, date: day(), amount: money(3000), description: `alım ${d}`, costMode: modes[Math.floor(r() * 4)], dueDate: null, invoiceId: linkTo });
      }
      const payments = 1 + Math.floor(r() * 3);
      for (let p = 0; p < payments; p++) {
        if (!l.payments.length) startTracking(l);
        const amount = money(8000);
        l.payments.push({ id: 200 + p, date: day(), amount, method: METHODS[Math.floor(r() * METHODS.length)] });
        const share = r() < 0.2 ? 0 : amount * (r() < 0.5 ? 1 : r());
        for (const x of allocateFifo(openItems(l, TERM), Math.round(share * 100) / 100).lines) {
          l.allocations.push({ id: l.nextAlloc++, paymentId: 200 + p, invoiceId: x.kind === "invoice" ? x.id : null, debtId: x.kind === "debt" ? x.id : null, amount: x.amount });
        }
        recompute(l);
        // Arada elle ✓: kalan kısım ödendi işaretlenir (defterin kapatmadığı)
        for (const inv of l.invoices) {
          if (inv.unpaid && r() < 0.15) Object.assign(inv, { unpaid: false, paidByLedger: false, paidAt: day(), paidVia: "nakit" });
        }
      }
    }
    const today = "2026-10-30";
    const acc = accountOf(l, { today, termDays: TERM });
    const st = statementRows(l);
    assert.ok(Math.abs(st.closing - acc.balance) < 0.011, `tohum ${seed}: ekstre ${st.closing}, bakiye ${acc.balance}`);
    // Süzgeç: devreden + süzgeçteki satırlar aynı son bakiyeyi verir
    const from = "2026-09-15";
    const part = statementRows(l, { from });
    assert.ok(Math.abs(part.closing - st.closing) < 1e-9);
    assert.ok(part.rows.every((x) => x.date >= from));
    if (!tracked) assert.equal(acc.credit, 0);
    if (acc.credit > 0) seen.credit++;
    if (l.invoices.some((i) => i.paidByLedger)) seen.ledger++;
    if (l.invoices.some((i) => !i.unpaid && !i.paidByLedger && (i.allocated ?? 0) > 0)) seen.manual++;
    if (l.debts.some((d) => d.invoiceId !== null)) seen.linked++;
    if (l.invoices.some((i) => i.unpaid && (i.allocated ?? 0) > 0)) seen.partial++;
  }
  // Örnekler bütün yolları dolaşsın: hesapta para, defterle kapanan, elle ✓ + dağıtım, bağlı borç, kısmi
  for (const [k, v] of Object.entries(seen)) assert.ok(v >= 10, `${k}: ${v}`);
});

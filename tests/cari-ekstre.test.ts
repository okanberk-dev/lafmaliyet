// Hesap hareketleri (src/lib/cari/statement.ts): örtük satırlar (faturada işaretli ödeme, Paraşüt'te ödenen kısım,
// iade ve iadenin düşülmesi), sıra, devreden bakiye, gri bağlı borç ve "Ekstreyi kopyala" metni.
// Çalıştırma: npx tsx --test tests/cari-ekstre.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { accountOf, type AccountInvoice } from "../src/lib/cari/account";
import { statementFooter, statementRows, statementText } from "../src/lib/cari/statement";

const plain = (s: string) => s.replace(/ /g, " ");

const invoices: AccountInvoice[] = [
  { id: 1, date: "2026-08-05", invoiceNo: "A1", payable: 1000, unpaid: false, paidAt: "2026-08-20", paidVia: "havale" },
  { id: 2, date: "2026-09-10", invoiceNo: "A2", payable: 2000, unpaid: true, outstanding: 500 },
  { id: 3, date: "2026-09-12", invoiceNo: "I1", payable: -300, unpaid: true },
  { id: 4, date: "2026-09-15", invoiceNo: "I2", payable: -100, unpaid: false, paidAt: "2026-10-01" },
  { id: 5, date: "2026-10-02", invoiceNo: null, payable: 400, unpaid: false, paidAt: null },
];

test("veri değişmeden: örtük satırlar ve son bakiye bugünkü Kalan borç", () => {
  const st = statementRows({ invoices });
  assert.deepEqual(
    st.rows.map((r) => [r.date, r.kind, plain(r.label), r.debit, r.credit, r.balance]),
    [
      ["2026-08-05", "fatura", "Fatura A1", 1000, 0, 1000],
      ["2026-08-20", "isaretli", "Faturada işaretli ödeme · Havale / EFT", 0, 1000, 0],
      ["2026-09-10", "fatura", "Fatura A2", 2000, 0, 2000],
      ["2026-09-10", "parasut-kismi", "Paraşüt'te ödenen kısım (gün bilinmiyor)", 0, 1500, 500],
      ["2026-09-12", "iade", "İade faturası I1", 0, 300, 200],
      ["2026-09-15", "iade", "İade faturası I2", 0, 100, 100],
      ["2026-10-01", "iade-dusuldu", "İade düşüldü", 100, 0, 200],
      ["2026-10-02", "fatura", "Fatura", 400, 0, 600],
      ["2026-10-02", "isaretli", "Faturada işaretli ödeme (gün bilinmiyor)", 0, 400, 200],
    ],
  );
  assert.equal(st.rows.at(-1)?.unknownDay, true);
  assert.equal(st.opening, null);
  assert.equal(st.closing, accountOf({ invoices }, { today: "2026-10-24", termDays: 30 }).balance);
  assert.equal(st.closing, 200, "500 kalan − 300 iade");
});

test("süzgeç: öncesi devreden bakiyede, son bakiye aynı", () => {
  const st = statementRows({ invoices }, { from: "2026-09-12" });
  assert.equal(st.opening, 500);
  assert.equal(st.rows[0].label, "İade faturası I1");
  assert.equal(st.closing, 200);
  assert.equal(statementRows({ invoices }, { from: "2027-01-01" }).rows.length, 0);
  assert.equal(statementRows({ invoices: [] }, { from: "2026-01-01" }).opening, 0);
});

test("borçlar, bağlı borç (gri) ve ödeme: aynı günde önce borç, sonra ödeme", () => {
  const st = statementRows({
    invoices: [{ id: 7, date: "2026-10-28", invoiceNo: "SUT149", payable: 1250, unpaid: false, paidAt: "2026-10-24", ledgerBase: 0, allocated: 1250, paidByLedger: true }],
    debts: [
      { id: 1, date: "2026-10-20", amount: 1250, description: "süt", costMode: "fatura", dueDate: null, invoiceId: 7 },
      { id: 2, date: "2026-10-24", amount: 600, description: "beyaz peynir", costMode: "mevcut", dueDate: null, invoiceId: null },
      { id: 3, date: "2026-10-24", amount: 900, description: null, costMode: "devir", dueDate: null, invoiceId: null },
    ],
    payments: [{ id: 9, date: "2026-10-24", amount: 2000, method: "elden" }],
    allocations: [
      { id: 1, paymentId: 9, invoiceId: 7, debtId: null, originDebtId: 1, amount: 1250 },
      { id: 2, paymentId: 9, invoiceId: null, debtId: 2, amount: 600 },
    ],
  });
  assert.deepEqual(
    st.rows.map((r) => [r.date, plain(r.label), r.muted ?? false, r.balance]),
    [
      ["2026-10-20", "Faturasız alım · süt → SUT149 faturasına bağlandı", true, 0],
      ["2026-10-24", "Faturasız alım · beyaz peynir (gideri zaten girildi)", false, 600],
      ["2026-10-24", "Eski borç (devir) · 24.10.2026 alımı", false, 1500],
      ["2026-10-24", "Ödeme · Elden (kasa dışı)", false, -500],
      ["2026-10-28", "Fatura SUT149", false, 750],
    ],
  );
  const pay = st.rows.find((r) => r.kind === "odeme")!;
  assert.deepEqual(pay.allocations, [
    { label: "SUT149", amount: 1250 },
    { label: "beyaz peynir", amount: 600 },
  ]);
  assert.equal(pay.left, 150);
  assert.equal(st.closing, 750, "devir 900 − hesapta 150");
});

test("numarasız faturaya bağlı borç: 'faturası faturasına' değil, '20.10.2026 faturasına bağlandı'", () => {
  const st = statementRows({
    invoices: [{ id: 7, date: "2026-10-20", invoiceNo: null, payable: 1250, unpaid: true, ledgerBase: 0 }],
    debts: [{ id: 1, date: "2026-10-18", amount: 1250, description: "süt", costMode: "fatura", dueDate: null, invoiceId: 7 }],
  });
  assert.equal(plain(st.rows.find((r) => r.kind === "bagli")!.label), "Faturasız alım · süt → 20.10.2026 faturasına bağlandı");
  // Fatura okunamıyorsa (başka tedarikçide): "faturaya bağlandı"
  const away = statementRows({ invoices: [], debts: [{ id: 1, date: "2026-10-18", amount: 1250, description: "süt", costMode: "fatura", dueDate: null, invoiceId: 99 }] });
  assert.equal(plain(away.rows.find((r) => r.kind === "bagli")!.label), "Faturasız alım · süt → faturaya bağlandı");
});

test("başka tedarikçide görünen faturaya sayılan kısım ekstrede ayrı satır: son bakiye hesapla aynı", () => {
  const input = {
    invoices: [] as AccountInvoice[],
    payments: [{ id: 9, date: "2026-10-24", amount: 1000, method: "havale" as const }],
    allocations: [{ id: 1, paymentId: 9, invoiceId: 55, debtId: null, amount: 400 }],
  };
  const st = statementRows(input);
  assert.deepEqual(
    st.rows.map((r) => [r.kind, r.debit, r.credit]),
    [
      ["baska", 400, 0],
      ["odeme", 0, 1000],
    ],
  );
  assert.equal(st.closing, accountOf(input, { today: "2026-10-30", termDays: 30 }).balance);
});

test("Ekstreyi kopyala: başlık, devreden, satırlar, bakiye ve imza", () => {
  const st = statementRows({ invoices }, { from: "2026-08-01" });
  assert.equal(
    plain(statementText("Sütaş", st, { from: "2026-08-01", to: "2026-10-30" })),
    [
      "Sütaş · hesap özeti (01.08.2026 – 30.10.2026)",
      "Devreden bakiye: 0,00 ₺",
      "05.08.2026 · Fatura A1 · 1.000,00 ₺",
      "20.08.2026 · Ödeme (havale) · −1.000,00 ₺",
      "10.09.2026 · Fatura A2 · 2.000,00 ₺",
      "10.09.2026 · Paraşüt'te ödenen kısım (gün bilinmiyor) · −1.500,00 ₺",
      "12.09.2026 · İade faturası I1 · −300,00 ₺",
      "15.09.2026 · İade faturası I2 · −100,00 ₺",
      "01.10.2026 · İade düşüldü · 100,00 ₺",
      "02.10.2026 · Fatura · 400,00 ₺",
      "02.10.2026 · Ödeme (gün bilinmiyor) · −400,00 ₺",
      "Bakiye: 200,00 ₺ (borcumuz)",
      "L'Affogato",
    ].join("\n"),
  );
  const credit = statementRows({ invoices: [], payments: [{ id: 1, date: "2026-10-24", amount: 99.5, method: "kasa", cashOutStore: "Sütaş" }] });
  assert.match(plain(statementText("Sütaş", credit, { from: "2026-10-01", to: "2026-10-30" })), /24\.10\.2026 · Ödeme \(nakit\) · −99,50 ₺\nBakiye: 99,50 ₺ \(alacağımız\)/);
  assert.doesNotMatch(statementText("Sütaş", st, { from: "2026-08-01", to: "2026-10-30" }), /—/, "uzun tire yok");
});

test("Ekstreyi kopyala: işaretli ödemenin bilinmeyen günü söylenir, faturasız alımın iç notu yazılmaz", () => {
  const st = statementRows({
    invoices: [{ id: 21, date: "2026-08-13", invoiceNo: "SUT050", payable: 3742.17, unpaid: false, paidAt: null, paidVia: "havale" }],
    debts: [
      { id: 1, date: "2026-10-21", amount: 600, description: "beyaz peynir", costMode: "gider", dueDate: null, invoiceId: null },
      { id: 2, date: "2026-10-22", amount: 100, description: "kaymak", costMode: "mevcut", dueDate: null, invoiceId: null },
      { id: 3, date: "2026-10-23", amount: 50, description: "süt", costMode: "fatura", dueDate: null, invoiceId: null },
    ],
  });
  const text = plain(statementText("Sütaş", st, { from: "2026-08-01", to: "2026-10-30" }));
  assert.match(text, /13\.08\.2026 · Ödeme \(havale, gün bilinmiyor\) · −3\.742,17 ₺/);
  assert.match(text, /21\.10\.2026 · Faturasız alım · beyaz peynir · 600,00 ₺/);
  assert.match(text, /22\.10\.2026 · Faturasız alım · kaymak · 100,00 ₺/);
  assert.doesNotMatch(text, /gider yazıldı|gideri zaten girildi|faturası gelecek/);
  // Ekranda iç not durur
  assert.equal(plain(st.rows.find((r) => r.ref.type === "debt" && r.ref.id === 1)!.label), "Faturasız alım · beyaz peynir (gider yazıldı)");
});

test("grubun faturasına başka kartın ödemesinden sayılan para ekstrede ödeme satırı: son bakiye Kalan borçla aynı", () => {
  // Sütaş'ın ödemesi Pınar'da görünen PNR1'e (1.250) ve PNR2'ye 600 sayıldı (R3d bağlama)
  const invoicesP: AccountInvoice[] = [
    { id: 31, date: "2026-10-20", invoiceNo: "PNR1", payable: 1250, unpaid: false, paidAt: "2026-10-24", paidVia: "havale", ledgerBase: 0, allocated: 1250, paidByLedger: true },
    { id: 32, date: "2026-10-21", invoiceNo: "PNR2", payable: 1250, unpaid: true, ledgerBase: 0, allocated: 600 },
  ];
  const foreign = [
    { invoiceId: 31, paymentId: 2, date: "2026-10-24", card: "Sütaş", amount: 1250, method: "havale" as const },
    { invoiceId: 32, paymentId: 4, date: "2026-10-25", card: "Sütaş", amount: 600 },
  ];
  const st = statementRows({ invoices: invoicesP, foreign });
  const balance = accountOf({ invoices: invoicesP }, { today: "2026-10-30", termDays: 30 }).balance;
  assert.equal(balance, 650);
  assert.equal(st.closing, balance);
  assert.deepEqual(
    st.rows.filter((r) => r.kind === "baska-odeme").map((r) => [r.date, plain(r.label), r.credit]),
    [
      ["2026-10-24", "Sütaş ödemesinden sayılan · PNR1", 1250],
      ["2026-10-25", "Sütaş ödemesinden sayılan · PNR2", 600],
    ],
  );
  // Tedarikçiye giden metinde öteki kartın adı (iç not) yok: ödeme satırı, şekliyle ve sayıldığı faturayla
  const text = plain(statementText("Pınar", st, { from: "2026-10-01", to: "2026-10-30" }));
  assert.match(text, /24\.10\.2026 · Ödeme \(havale\) · PNR1 · −1\.250,00 ₺\n25\.10\.2026 · Ödeme · PNR2 · −600,00 ₺[\s\S]*Bakiye: 650,00 ₺ \(borcumuz\)/);
  assert.doesNotMatch(text, /Sütaş|sayılan/);
});

test("ekstrenin alt satırı: bakiye 0'da ek yok, eksi alacak, artı borcumuz", () => {
  assert.equal(plain(statementFooter(0)), "Bakiye 0,00 ₺");
  assert.equal(plain(statementFooter(0.004)), "Bakiye 0,00 ₺");
  assert.equal(plain(statementFooter(1250)), "Bakiye 1.250,00 ₺ (borcumuz)");
  assert.equal(plain(statementFooter(-99.5)), "99,50 ₺ alacak (hesapta)");
});

// Kasadan faturalı alımlar (denetim E-42; src/lib/cash-outs.ts, src/app/panel/faturalar/rules.ts): personelin Kasa'ya
// girdiği e-Arşiv / faturalı alışveriş, faturası gelene kadar yöneticinin bekleyen listesinde. Eşleşme (aynı mağaza,
// ±7 gün, ±1 ₺, bir fatura tek satıra), mağaza adı kuralı, özet metni ve fatura penceresinin ön dolumu.
// Çalıştırma: npx tsx --test tests/kasa-faturali.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { cashOutInvoiceDraft, type CashOutInvoiceSource } from "../src/app/panel/faturalar/rules";
import { CASH_OUT_INVOICES_HREF, cashOutInvoiceDay, isInvoiceDoc, matchCashOutInvoices, pendingCashOutSummary, sameStoreName, staffToExpenses } from "../src/lib/cash-outs";

const out = (id: number, p: { date?: string; receiptDate?: string | null; store?: string | null; amount?: number } = {}) => ({
  id,
  date: p.date ?? "2026-10-24",
  receiptDate: p.receiptDate ?? null,
  store: p.store === undefined ? "Migros" : p.store,
  amount: p.amount ?? 2400,
});
const inv = (id: number, supplier: string, date: string, payable: number) => ({ id, supplier, date, payable });

test("personelin fatura ve e-Arşiv satırı Aylık harcamalar'a yazılmaz; bekleyen listenin konusu bunlar", () => {
  assert.equal(staffToExpenses("harcama", "e_arsiv"), false);
  assert.equal(staffToExpenses("harcama", "fatura"), false);
  assert.equal(staffToExpenses("harcama", "fis"), true);
  assert.deepEqual(["fis", "e_arsiv", "fatura", "yok"].map((d) => isInvoiceDoc(d as never)), [false, true, true, false]);
  assert.equal(CASH_OUT_INVOICES_HREF, "/panel/faturalar?durum=kontrol#kasa-faturali");
});

test("aynı mağaza: aynı ad (büyük-küçük harf, I/ı, boşluk, parantez), adın baştan kelimeleri (en az 3 harf)", () => {
  assert.ok(sameStoreName("Migros", "MİGROS"));
  assert.ok(sameStoreName("migros ", "Migros (ödenmedi)"));
  assert.ok(sameStoreName("Migros", "MİGROS TİCARET A.Ş."));
  assert.ok(sameStoreName("Migros Ticaret A.Ş.", "migros"), "iki yönde");
  assert.ok(sameStoreName("Şok", "ŞOK MARKETLER TİC. A.Ş."));
  assert.ok(!sameStoreName("Mig", "Migros"), "kelimenin parçası değil");
  assert.ok(!sameStoreName("A", "A101 Yeni Mağazacılık"));
  assert.ok(!sameStoreName("Ab", "Ab Gıda"), "iki harf yetmez");
  assert.ok(!sameStoreName("Metro", "Migros"));
  assert.ok(!sameStoreName("", "Migros"));
});

test("eşleşme: fişin günü ±7 gün, tutar ±1 ₺, aynı mağaza; yoksa bekler", () => {
  const o = out(1, { receiptDate: "2026-10-23" });
  assert.equal(cashOutInvoiceDay(o), "2026-10-23");
  assert.equal(cashOutInvoiceDay(out(1)), "2026-10-24", "fiş günü okunmadıysa kasanın günü");
  const pending = (invs: ReturnType<typeof inv>[]) => matchCashOutInvoices([o], invs).pending.map((r) => r.id);
  assert.deepEqual(pending([inv(10, "MİGROS TİCARET A.Ş.", "2026-10-30", 2400.9)]), [], "7 gün sonra, 0,90 ₺ fark");
  assert.deepEqual(pending([inv(10, "Migros", "2026-10-16", 2399)]), [], "7 gün önce, 1 ₺ fark");
  assert.deepEqual(pending([inv(10, "Migros", "2026-10-31", 2400)]), [1], "8 gün sonra");
  assert.deepEqual(pending([inv(10, "Migros", "2026-10-24", 2401.5)]), [1], "1,50 ₺ fark");
  assert.deepEqual(pending([inv(10, "Metro", "2026-10-24", 2400)]), [1], "başka mağaza");
  assert.deepEqual(pending([]), [1]);
  // Yeri yazılmamış satır hiçbir faturayla eşleşmez
  assert.deepEqual(matchCashOutInvoices([out(2, { store: null })], [inv(10, "Migros", "2026-10-24", 2400)]).pending.map((r) => r.id), [2]);
  assert.deepEqual(matchCashOutInvoices([out(2, { store: "  " })], [inv(10, "Migros", "2026-10-24", 2400)]).pending.map((r) => r.id), [2]);
});

test("eşleşme: bir fatura tek satırı kapatır; önce günü, sonra tutarı yakın olan", () => {
  const outs = [out(1, { date: "2026-10-20" }), out(2, { date: "2026-10-24" })];
  const r = matchCashOutInvoices(outs, [inv(10, "Migros", "2026-10-25", 2400)]);
  assert.deepEqual([...r.matched], [[2, 10]], "günü yakın olan");
  assert.deepEqual(r.pending.map((o) => o.id), [1]);
  const two = matchCashOutInvoices(outs, [inv(10, "Migros", "2026-10-25", 2400), inv(11, "Migros", "2026-10-21", 2400)]);
  assert.deepEqual(two.pending, []);
  assert.deepEqual(new Map(two.matched), new Map([[1, 11], [2, 10]]));
  // Aynı gün: tutarı yakın olan
  const close = matchCashOutInvoices([out(1, { amount: 100 }), out(2, { amount: 100.8 })], [inv(10, "Migros", "2026-10-24", 100.9)]);
  assert.deepEqual([...close.matched], [[2, 10]]);
  // Kart kuralı çağırandan (diğer ad, vergi no): adı tutmayan fatura da eşleşir
  const card = matchCashOutInvoices([out(1, { store: "Kasap" })], [inv(10, "Öz Et Ltd.", "2026-10-24", 2400)], (o, i) => o.store === "Kasap" && i.supplier === "Öz Et Ltd.");
  assert.deepEqual(card.pending, []);
});

test("özet: ilk satır ve kalanı", () => {
  assert.equal(pendingCashOutSummary([]), "");
  assert.match(pendingCashOutSummary([out(1)]), /^Migros 2\.400\s₺$/);
  assert.match(pendingCashOutSummary([out(1), out(2, { store: null }), out(3)]), /^Migros 2\.400\s₺ ve 2 alım daha$/);
  assert.match(pendingCashOutSummary([out(2, { store: null })]), /^Yeri yazılmamış alım/);
});

test("fatura penceresinin ön dolumu: fişin günü, yer, fiş no, Ödenecek kasadan; net fişteki KDV'yle", () => {
  const src: CashOutInvoiceSource = {
    id: 7,
    date: "2026-10-24",
    receiptDate: "2026-10-23",
    store: " Migros ",
    description: "süt",
    amount: 2400,
    vat: 23.76,
    docType: "e_arsiv",
    receiptNo: "GIB2026000000123",
    photoId: 5,
    createdByName: "Ayşe",
  };
  const d = cashOutInvoiceDraft(src);
  assert.deepEqual(
    { ...d },
    {
      date: "2026-10-23",
      supplier: "Migros",
      description: "süt",
      invoiceNo: "GIB2026000000123",
      category: "Hammadde & İçecek",
      amount: 2376.24,
      payable: 2400,
      vatRate: "1",
      unpaid: false,
      paidAt: "2026-10-24",
      vatGuessed: false,
    },
  );
  // %20'lik fiş: oran KDV'den
  assert.equal(cashOutInvoiceDraft({ ...src, amount: 1200, vat: 200 }).vatRate, "20");
  assert.equal(cashOutInvoiceDraft({ ...src, amount: 1200, vat: 200 }).amount, 1000);
  // KDV okunmadı: tedarikçinin son faturasının oranı ve kategorisi, net geri hesaplanır
  const guessed = cashOutInvoiceDraft({ ...src, vat: null, amount: 1100, receiptDate: null }, { category: "Tatlı & Hazır Ürün", vatRate: "10" });
  assert.deepEqual([guessed.amount, guessed.vatRate, guessed.category, guessed.vatGuessed, guessed.date], [1000, "10", "Tatlı & Hazır Ürün", true, "2026-10-24"]);
  // Önerisiz: %1
  assert.deepEqual([cashOutInvoiceDraft({ ...src, vat: null, amount: 101 }).amount, cashOutInvoiceDraft({ ...src, vat: null }).vatRate], [100, "1"]);
  // Anlamsız KDV (tutara eşit ya da büyük) okunmamış sayılır
  assert.equal(cashOutInvoiceDraft({ ...src, vat: 2400 }).vatGuessed, true);
});

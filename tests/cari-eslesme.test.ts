// Cari eşleşmeleri (src/lib/cari/match.ts): faturasız alımın faturası (güçlü tek / n → 1, zayıf, pencere sınırları,
// "Ayrı alım"), Kasa satırları (±3 gün, tutardan bağımsız, ayrı tutulanlar, fişsiz alışveriş yalnız açık kalem
// varken), Aylık harcamalar'daki benzer kayıt ve "Gideri zaten girildi" adayları, borcun varsayılan gideri.
// Çalıştırma: npx tsx --test tests/cari-eslesme.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CariDebt } from "../src/lib/cari/account";
import { adoptCandidates, defaultCostMode, expenseDuplicates, kasaMatches, linkCandidates, type ExpenseLite, type KasaLine } from "../src/lib/cari/match";

const debt = (p: Partial<CariDebt> & { id: number; date: string; amount: number }): CariDebt => ({ description: null, costMode: "fatura", dueDate: null, invoiceId: null, ...p });
const inv = (id: number, date: string, payable: number, category = "Hammadde & İçecek") => ({ id, date, payable, category });

test("fatura adayı: güçlü tek borç (±max(1 ₺, %2)), n → 1 toplam, zayıf", () => {
  const debts = [debt({ id: 1, date: "2026-10-20", amount: 1250 })];
  assert.deepEqual(linkCandidates(debts, [inv(10, "2026-10-28", 1250)]).strong, [{ invoiceId: 10, debtIds: [1], diff: 0 }]);
  assert.deepEqual(linkCandidates(debts, [inv(10, "2026-10-28", 1274)]).strong, [{ invoiceId: 10, debtIds: [1], diff: 24 }], "%2 içinde");
  const weak = linkCandidates(debts, [inv(10, "2026-10-28", 1280)]);
  assert.deepEqual(weak.strong, []);
  assert.deepEqual(weak.weak, [{ invoiceId: 10, debtIds: [1], diff: 30 }]);
  assert.equal(linkCandidates([debt({ id: 1, date: "2026-10-20", amount: 30 })], [inv(10, "2026-10-28", 31)]).strong.length, 1, "küçük tutarda 1 ₺");
  // Haftalık irsaliye, aylık fatura: penceredeki bütün borçların toplamı
  const weekly = [debt({ id: 1, date: "2026-10-01", amount: 1000 }), debt({ id: 2, date: "2026-10-08", amount: 1200, costMode: "gider" }), debt({ id: 3, date: "2026-10-15", amount: 800, costMode: "mevcut" })];
  assert.deepEqual(linkCandidates(weekly, [inv(10, "2026-10-31", 3010)]).strong, [{ invoiceId: 10, debtIds: [1, 2, 3], diff: 10 }]);
});

test("fatura adayı: pencere (7 gün önce, 45 gün sonra), devir, bağlı, iade, komisyon ve Ayrı alım", () => {
  const d = debt({ id: 1, date: "2026-10-20", amount: 500 });
  assert.equal(linkCandidates([d], [inv(10, "2026-10-13", 500)]).strong.length, 1, "7 gün önce");
  assert.equal(linkCandidates([d], [inv(10, "2026-10-12", 500)]).strong.length, 0, "8 gün önce");
  assert.equal(linkCandidates([d], [inv(10, "2026-12-04", 500)]).strong.length, 1, "45 gün sonra");
  assert.equal(linkCandidates([d], [inv(10, "2026-12-05", 500)]).strong.length, 0, "46 gün sonra");
  assert.equal(linkCandidates([{ ...d, costMode: "devir" }], [inv(10, "2026-10-28", 500)]).strong.length, 0, "eski borç aday değil");
  assert.equal(linkCandidates([{ ...d, invoiceId: 99 }], [inv(10, "2026-10-28", 500)]).strong.length, 0, "bağlı borç aday değil");
  assert.equal(linkCandidates([d, debt({ id: 2, date: "2026-10-01", amount: 9, invoiceId: 10 })], [inv(10, "2026-10-28", 500)]).strong.length, 0, "borç bağlanmış fatura aday değil");
  assert.equal(linkCandidates([d], [inv(10, "2026-10-28", -500)]).strong.length, 0, "iade");
  assert.equal(linkCandidates([d], [inv(10, "2026-10-28", 500, "Komisyon")]).strong.length, 0, "komisyon");
  assert.equal(linkCandidates([d], [inv(10, "2026-10-28", 500, "Karaoke box")]).strong.length, 0, "kafe dışı");
  const dismissed = linkCandidates([{ ...d, dismissedInvoiceIds: [10] }], [inv(10, "2026-10-28", 500)]);
  assert.deepEqual([dismissed.strong, dismissed.weak], [[], []], "Ayrı alım denmiş çift");
  // Gider yazılmış (fatura beklemeyen) borçta tutar tutmazsa zayıf aday da yok
  assert.deepEqual(linkCandidates([{ ...d, costMode: "gider" }], [inv(10, "2026-10-28", 900)]).weak, []);
});

const line = (p: Partial<KasaLine> & { id: number; date: string }): KasaLine => ({ kind: "teslim", store: "Sütaş", docType: "yok", amount: 900, ...p });

test("Kasa satırları: ad eşleşir, tutara bakılmaz, ±3 gün, işlenmiş ve ayrı tutulan atlanır", () => {
  const lines = [
    line({ id: 1, date: "2026-10-17" }),
    line({ id: 2, date: "2026-10-18", amount: 905, kind: "harcama", docType: "fis" }),
    line({ id: 3, date: "2026-10-23" }),
    line({ id: 4, date: "2026-10-24" }),
    line({ id: 5, date: "2026-10-20", store: "Pınar" }),
    line({ id: 6, date: "2026-10-20", store: "SÜTAŞ (şoför)" }),
    line({ id: 7, date: "2026-10-21", store: null }),
  ];
  const opts = { keys: ["sütaş"], handled: new Set([3]), from: "2026-10-17", to: "2026-10-23", kinds: ["teslim", "harcama"] as const };
  assert.deepEqual(
    kasaMatches(lines, opts).map((l) => l.id),
    [1, 2, 6],
  );
  assert.deepEqual(
    kasaMatches(lines, { ...opts, kinds: ["teslim"] }).map((l) => l.id),
    [1, 6],
  );
  assert.deepEqual(kasaMatches(lines, { ...opts, receiptless: true }).map((l) => l.id), [1, 6], "fişli alışveriş ipucuna girmez");
  const shop = [line({ id: 8, date: "2026-10-20", kind: "harcama" }), line({ id: 9, date: "2026-10-21", kind: "harcama" })];
  assert.deepEqual(kasaMatches(shop, { ...opts, receiptless: true, harcamaDays: new Set(["2026-10-21"]) }).map((l) => l.id), [9], "fişsiz alışveriş yalnız açık kalem olan gün");
});

const exp = (p: Partial<ExpenseLite> & { id: number; date: string; amount: number }): ExpenseLite => ({ categoryId: 1, description: null, supplierEntryId: null, cashOutId: null, ...p });

test("Aylık harcamalar: kopya uyarısı (mal, ±3 gün, ±1 ₺) ve 'Gideri zaten girildi' adayları", () => {
  const goods = new Set([1]);
  const entries = [
    exp({ id: 1, date: "2026-10-05", amount: 900 }),
    exp({ id: 2, date: "2026-10-09", amount: 900 }),
    exp({ id: 3, date: "2026-10-06", amount: 901.5 }),
    exp({ id: 4, date: "2026-10-04", amount: 899.5, categoryId: 2 }),
    exp({ id: 5, date: "2026-10-05", amount: 900, supplierEntryId: 7 }),
    exp({ id: 6, date: "2026-10-06", amount: 900.4 }),
    exp({ id: 7, date: "2026-10-05", amount: 900, cashOutId: 3 }),
  ];
  assert.deepEqual(
    expenseDuplicates(entries, { date: "2026-10-05", amount: 900 }, goods).map((e) => e.id),
    [1, 7, 6],
  );
  assert.deepEqual(
    adoptCandidates(entries, { date: "2026-10-05", amount: 900 }, goods).map((e) => e.id),
    [1, 2, 6, 3, 4],
    "mal önce, sonra tutar farkı; başka borcun ve Kasa'nın kaydı değil",
  );
  assert.deepEqual(adoptCandidates([exp({ id: 1, date: "2026-11-06", amount: 900 })], { date: "2026-10-05", amount: 900 }, goods), [], "31 günden uzak");
  assert.deepEqual(adoptCandidates(entries, { date: "2026-10-05", amount: 900 }, goods, 7).map((e) => e.id).includes(5), true, "kendi kaydı düzenlemede görünür");
});

test("varsayılan gider: son 90 günde Paraşüt faturası varsa 'Faturası gelecek'", () => {
  const today = "2026-10-24";
  assert.equal(defaultCostMode([{ origin: "parasut", date: "2026-07-26" }], today), "fatura");
  assert.equal(defaultCostMode([{ origin: "parasut", date: "2026-07-25" }], today), "gider", "91 gün önce");
  assert.equal(defaultCostMode([{ origin: "manual", date: "2026-10-20" }, { origin: "excel", date: "2026-10-01" }], today), "gider");
  assert.equal(defaultCostMode([], today), "gider");
});

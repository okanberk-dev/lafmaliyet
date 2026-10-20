// Faturalar: "Kontrol bekleyen" kuyruğu (?durum=kontrol), durum sayaçları, onay bildirimi ve e-fatura rozeti
// (src/app/panel/faturalar/rules.ts).
// Çalıştırma: npx tsx --test tests/faturalar-kontrol.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { confirmToast, isEInvoiceOnly, matchesStatus, parseStatus, statusCounts } from "../src/app/panel/faturalar/rules";

const rows = [
  { id: 1, unpaid: true, needsReview: true },
  { id: 2, unpaid: false, needsReview: true },
  { id: 3, unpaid: true, needsReview: false },
  { id: 4, unpaid: false },
];

test("parseStatus: bilinen değerler, bozuk bağlantı tümüne düşer", () => {
  assert.equal(parseStatus("kontrol"), "kontrol");
  assert.equal(parseStatus("odenmedi"), "odenmedi");
  assert.equal(parseStatus("odendi"), "odendi");
  assert.equal(parseStatus("tumu"), "tumu");
  assert.equal(parseStatus("KONTROL"), "tumu");
  assert.equal(parseStatus(""), "tumu");
  assert.equal(parseStatus(null), "tumu");
});

test("matchesStatus: kontrol bekleyen ödeme durumundan bağımsız", () => {
  const ids = (s: Parameters<typeof matchesStatus>[1]) => rows.filter((r) => matchesStatus(r, s)).map((r) => r.id);
  assert.deepEqual(ids("kontrol"), [1, 2]);
  assert.deepEqual(ids("odenmedi"), [1, 3]);
  assert.deepEqual(ids("odendi"), [2, 4]);
  assert.deepEqual(ids("tumu"), [1, 2, 3, 4]);
});

test("statusCounts: çip sayaçları", () => {
  assert.deepEqual(statusCounts(rows), { all: 4, review: 2, unpaid: 2, paid: 2 });
  assert.deepEqual(statusCounts([]), { all: 0, review: 0, unpaid: 0, paid: 0 });
});

test("confirmToast: tek faturada tedarikçi (parantezli not atılır) ve kategori, çoğunda sayı", () => {
  assert.deepEqual(confirmToast([{ supplier: "Kaldi (ödenmedi)", category: "Hammadde & İçecek" }]), {
    title: "Kategori onaylandı",
    description: "Kaldi · Hammadde & İçecek",
  });
  assert.deepEqual(
    confirmToast([
      { supplier: "Sütaş", category: "Hammadde & İçecek" },
      { supplier: "Metro", category: "Hammadde & İçecek" },
    ]),
    { title: "2 faturanın kategorisi onaylandı", description: "Hammadde & İçecek" },
  );
  assert.deepEqual(
    confirmToast([
      { supplier: "Sütaş", category: "Hammadde & İçecek" },
      { supplier: "Yemek Sepeti", category: "Komisyon" },
      { supplier: "Ambalajcı", category: "Ambalaj" },
    ]),
    { title: "3 faturanın kategorisi onaylandı", description: "3 kategori" },
  );
});

test("isEInvoiceOnly: içeri alınmamış e-fatura (gider faturası yok) e-fatura rozeti alır", () => {
  assert.equal(isEInvoiceOnly({ eInvoiceId: "e1", externalId: null }), true);
  assert.equal(isEInvoiceOnly({ eInvoiceId: "e1", externalId: "9001" }), false);
  assert.equal(isEInvoiceOnly({ externalId: "9001" }), false);
  assert.equal(isEInvoiceOnly({}), false);
});

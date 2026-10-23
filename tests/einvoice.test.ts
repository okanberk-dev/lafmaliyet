import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanTaxNumber, taxKey } from "../src/app/panel/tedarikciler/logic";
import { purchaseVat, purchaseWithheld } from "../src/lib/kdv";
import { categoryNeedsReview, eInvoiceToDraft, shouldImportEInvoice, withholdingVatFill } from "../src/server/parasut/einvoice";

const base = {
  id: "1074821121",
  type: "e_invoices",
  attributes: {
    external_id: "KLA2026000000625",
    uuid: "f3a1c0de-0000-4000-8000-000000000001",
    direction: "inbound",
    contact_name: "KALDI KAHVE GIDA SAN. TİC. LTD. ŞTİ.",
    from_vkn: "1234567890",
    issue_date: "2026-10-12",
    net_total: "46322.4",
    total_vat: "7720.4",
    currency: "TRL",
    invoice_type_code: "SATIS",
    response_type: null,
    archived: false,
  },
  relationships: { invoice: { data: null } },
};

test("e-fatura panel faturasına çevrilir (KDV dahil toplamdan KDV hariç tutar)", () => {
  const d = eInvoiceToDraft(base);
  assert.equal(d.eInvoiceId, "1074821121");
  assert.equal(d.invoiceNo, "KLA2026000000625");
  assert.equal(d.date, "2026-10-12");
  assert.equal(d.supplier, "KALDI KAHVE GIDA SAN. TİC. LTD. ŞTİ.");
  assert.equal(d.payable, 46322.4);
  assert.equal(d.vat, 7720.4);
  assert.equal(d.amount, 38602);
  assert.equal(d.importedBillId, null);
  assert.deepEqual(shouldImportEInvoice(d), { ok: true });
});

test("içeri alınmış e-fatura gider faturasının kimliğini taşır", () => {
  const d = eInvoiceToDraft({ ...base, relationships: { invoice: { data: { id: "1044539909", type: "purchase_bills" } } } });
  assert.equal(d.importedBillId, "1044539909");
});

test("iade, tevkifat, giden, reddedilen, arşivlenen ve döviz", () => {
  const iade = eInvoiceToDraft({ ...base, attributes: { ...base.attributes, invoice_type_code: "IADE" } });
  assert.equal(iade.refund, true);
  assert.equal(iade.payable, -46322.4);
  assert.equal(iade.amount, -38602);
  assert.equal(eInvoiceToDraft({ ...base, attributes: { ...base.attributes, invoice_type_code: "TEVKIFAT" } }).withholding, true);
  assert.equal(shouldImportEInvoice(eInvoiceToDraft({ ...base, attributes: { ...base.attributes, direction: "outbound" } })).ok, false);
  assert.deepEqual(shouldImportEInvoice(eInvoiceToDraft({ ...base, attributes: { ...base.attributes, response_type: "rejected" } })), { ok: false, reason: "reddedildi" });
  assert.deepEqual(shouldImportEInvoice(eInvoiceToDraft({ ...base, attributes: { ...base.attributes, archived: true } })), { ok: false, reason: "arşivlendi" });
  assert.deepEqual(shouldImportEInvoice(eInvoiceToDraft({ ...base, attributes: { ...base.attributes, currency: "USD" } })), { ok: false, reason: "döviz (USD)" });
});

test("eksik alanlar güvenli varsayılana düşer", () => {
  const d = eInvoiceToDraft({ id: "9", type: "e_invoices", attributes: { direction: "inbound", issue_date: "2026-10-01T00:00:00+03:00", net_total: 120, total_vat: null } });
  assert.equal(d.supplier, "Paraşüt tedarikçisi");
  assert.equal(d.date, "2026-10-01");
  assert.equal(d.amount, 120);
  assert.equal(d.vat, 0);
  assert.equal(d.invoiceNo, null);
});

test("kategori tahmini kontrol gerektirir mi", () => {
  assert.equal(categoryNeedsReview("kural: tedarikçi “sütaş”"), false);
  assert.equal(categoryNeedsReview("tedarikçinin önceki faturaları"), false);
  assert.equal(categoryNeedsReview("komisyon platformu"), false);
  assert.equal(categoryNeedsReview("Paraşüt kategorisi / kalem adları"), true);
  assert.equal(categoryNeedsReview("eşleşme yok"), true);
});

test("tedarikçinin vergi nosu: belgedeki numara saklanır; örnek numara eşleşmede kullanılmaz", () => {
  const d = eInvoiceToDraft(base);
  assert.equal(d.supplierTaxNo, "1234567890");
  // Saklanan biçim numarayı tutar (faturada görünür) ama 1234567890 yer tutucu: iki firmayı birleştirmez
  assert.equal(cleanTaxNumber(d.supplierTaxNo), "1234567890");
  assert.equal(taxKey(d.supplierTaxNo), null);
  const real = eInvoiceToDraft({ ...base, attributes: { ...base.attributes, from_vkn: " 7810030532 " } });
  assert.equal(cleanTaxNumber(real.supplierTaxNo), "7810030532");
  assert.equal(taxKey(real.supplierTaxNo), "7810030532");
  assert.equal(eInvoiceToDraft({ ...base, attributes: { ...base.attributes, from_vkn: null } }).supplierTaxNo, null);
});

test("tevkifatlı e-faturaya bağlı Excel kaydının boş KDV'si belgedeki tam KDV'yle dolar (Eylül 2026 reklam faturası)", () => {
  // Liste tevkifat düşülmüş ödenecek tutarı (34.200) ve tam KDV'yi (6.000) verir; Excel kaydında KDV yok
  const d = eInvoiceToDraft({ ...base, attributes: { ...base.attributes, invoice_type_code: "TEVKIFAT", net_total: "34200", total_vat: "6000" } });
  const excel = { amount: 30_000, discount: 0, payable: 34_200, vat: 0 };
  assert.equal(purchaseVat(excel), 4_200);
  const vat = withholdingVatFill(excel, d);
  assert.equal(vat, 6_000);
  // KDV tahmini artık tamamını indirir, farkı KDV-2'ye yazar
  assert.equal(purchaseVat({ ...excel, vat: vat! }), 6_000);
  assert.equal(purchaseWithheld({ ...excel, vat: vat! }), 1_800);
  // Kayıttaki KDV'ye, elle değişmiş ödenecek tutara, tevkifatsız faturaya ve iadeye dokunulmaz
  assert.equal(withholdingVatFill({ ...excel, vat: 4_200 }, d), null);
  assert.equal(withholdingVatFill({ ...excel, payable: 36_000 }, d), null);
  assert.equal(withholdingVatFill(excel, { ...d, withholding: false }), null);
  assert.equal(withholdingVatFill(excel, { ...d, refund: true }), null);
});

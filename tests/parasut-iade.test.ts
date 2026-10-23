// Paraşüt'te iadeler (docs/PARASUT.md §2a): sitenin (laffogato.net e-Arşiv / e-Fatura) ya da kafenin faturaladığı
// satışın iadesi gider faturası olarak gelir, gider sayılmaz (müşteri kartı, sitenin LAF- ürünleri, gelen iade
// e-faturası); tedarikçi kartlı iade faturası eskisi gibi eksi gider; kafenin tedarikçiye iadesi (giden iade
// e-faturası) panele girmez, listelenir ve Faturalar'a eksi tutarla girilince listeden düşer.
// Çalıştırma: npx tsx --test tests/parasut-iade.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { eInvoiceToDraft, isSupplierReturn, shouldImportEInvoice } from "../src/server/parasut/einvoice";
import type { Resource } from "../src/server/parasut/jsonapi";
import { billToDraft, customerContactBill, isSalesReturn, SALES_RETURN, shouldImport } from "../src/server/parasut/mapping";
import { mergeReturns, parseReturnLog, supplierReturnEntered } from "../src/server/parasut/returns";

/** Sitenin bir siparişinin iadesi: Paraşüt'te satış faturasından "İade oluştur" (gider listesine düşer) */
function siteRefund(over: { itemType?: string; accountType?: string; code?: string; eDoc?: Record<string, unknown> } = {}) {
  const bill: Resource = {
    id: "5001",
    type: "purchase_bills",
    attributes: {
      item_type: over.itemType ?? "refund",
      issue_date: "2026-11-15",
      invoice_no: null,
      currency: "TRL",
      gross_total: "1000.0",
      total_vat: "200.0",
      net_total: "1200.0",
      remaining: "0.0",
      payment_status: "paid",
    },
    relationships: {
      supplier: { data: { id: "c9", type: "contacts" } },
      details: { data: [{ id: "d9", type: "purchase_bill_details" }] },
      ...(over.eDoc ? { active_e_document: { data: { id: "e9", type: "e_invoices" } } } : {}),
    },
  };
  const included: Resource[] = [
    { id: "c9", type: "contacts", attributes: { name: "Ayşe Yılmaz", account_type: over.accountType ?? "customer", tax_number: "11111111111" } },
    { id: "d9", type: "purchase_bill_details", attributes: { quantity: "1", unit_price: "1000", vat_rate: "20", net_total: "1000" }, relationships: { product: { data: { id: "p55", type: "products" } } } },
    { id: "p55", type: "products", attributes: { name: "Mağaza ürünü (KDV %20)", code: over.code ?? "LAF-SHOP-20", unit: "Adet" } },
    ...(over.eDoc ? [{ id: "e9", type: "e_invoices", attributes: over.eDoc }] : []),
  ];
  return billToDraft(bill, included);
}

test("satış iadesi gider faturası olarak gelir ama gider sayılmaz: müşteri kartı, sitenin ürünü, gelen iade e-faturası", () => {
  const d = siteRefund();
  assert.equal(d.contactType, "customer");
  assert.equal(d.siteProducts, true);
  assert.equal(isSalesReturn(d), true);
  assert.deepEqual(shouldImport(d), { ok: false, reason: SALES_RETURN });
  // Tek işaret yeter: sitenin ürünü olmasa da müşteri kartlı iade
  assert.deepEqual(shouldImport(siteRefund({ code: "X-1" })), { ok: false, reason: SALES_RETURN });
  // Tedarikçi kartlı ama kalemleri sitenin ürünü (satış faturasından açılmış)
  assert.deepEqual(shouldImport(siteRefund({ accountType: "supplier" })), { ok: false, reason: SALES_RETURN });
  // Şirket müşterisinin gelen iade e-faturası içeri alınmış (kalem kodu yok, kart tedarikçi seçilmiş)
  const imported = siteRefund({ accountType: "supplier", code: "KOD", eDoc: { direction: "inbound", invoice_type_code: "IADE", from_vkn: "7810030532" } });
  assert.equal(imported.eDocumentKind, "IADE");
  assert.deepEqual(shouldImport(imported), { ok: false, reason: SALES_RETURN });
  // Giden e-belge (sitenin kendi faturası) türü sayılmaz
  assert.equal(siteRefund({ accountType: "supplier", code: "KOD", eDoc: { direction: "outbound", invoice_type_code: "IADE" } }).eDocumentKind, null);
});

test("tedarikçi kartlı iade faturası eskisi gibi eksi gider; müşteri kartlı alış kontrol bekler", () => {
  const supplierRefund = siteRefund({ accountType: "supplier", code: "SUT1" });
  assert.equal(isSalesReturn(supplierRefund), false);
  assert.deepEqual(shouldImport(supplierRefund), { ok: true });
  assert.equal(supplierRefund.payable, -1200);
  assert.equal(supplierRefund.vat, -200);
  assert.equal(supplierRefund.amount - supplierRefund.discount, -1000);
  // Müşteri kartıyla girilmiş normal alış: sessizce atılmaz, kontrol bekler
  const purchase = siteRefund({ itemType: "purchase_bill", code: "SUT1" });
  assert.deepEqual(shouldImport(purchase), { ok: true });
  assert.equal(customerContactBill(purchase), true);
  assert.equal(customerContactBill(supplierRefund), false);
  // Kişi kartı okunamadı (eski önbellek): tür bilinmez, yalnız diğer işaretler bakılır
  assert.equal(customerContactBill({ ...purchase, contactType: null }), false);
});

const eBase = {
  id: "777",
  type: "e_invoices",
  attributes: {
    external_id: "ABC2026000000777",
    direction: "inbound",
    contact_name: "ÖRNEK GIDA A.Ş.",
    from_vkn: "7810030532",
    to_vkn: "1111111111",
    issue_date: "2026-11-10",
    net_total: "600",
    total_vat: "100",
    currency: "TRL",
    invoice_type_code: "IADE",
  },
};

test("gelen iade e-faturası satış iadesidir (tevkifatlı iade de); giden iade e-faturası tedarikçiye iadedir", () => {
  const inbound = eInvoiceToDraft(eBase);
  assert.equal(inbound.refund, true);
  assert.deepEqual(shouldImportEInvoice(inbound), { ok: false, reason: SALES_RETURN });
  // TEVKIFATIADE eskiden artı gider yazılıyordu
  const withholding = eInvoiceToDraft({ ...eBase, attributes: { ...eBase.attributes, invoice_type_code: "TEVKIFATIADE" } });
  assert.equal(withholding.refund, true);
  assert.equal(withholding.withholding, false);
  assert.equal(withholding.payable, -600);
  assert.deepEqual(shouldImportEInvoice(withholding), { ok: false, reason: SALES_RETURN });
  assert.equal(isSupplierReturn(inbound), false);
  // Kafenin tedarikçiye iadesi: giden, iade türünde; alıcının vergi nosu to_vkn
  const outbound = eInvoiceToDraft({ ...eBase, attributes: { ...eBase.attributes, direction: "outbound", contact_name: "SÜTAŞ A.Ş.", to_vkn: "7810030532" } });
  assert.equal(isSupplierReturn(outbound), true);
  assert.equal(outbound.receiverTaxNo, "7810030532");
  assert.deepEqual(shouldImportEInvoice(outbound), { ok: false, reason: "giden fatura" });
  // Sitenin giden satış faturası iade değildir
  assert.equal(isSupplierReturn(eInvoiceToDraft({ ...eBase, attributes: { ...eBase.attributes, direction: "outbound", invoice_type_code: "SATIS" } })), false);
  // Normal gelen e-fatura eskisi gibi
  assert.deepEqual(shouldImportEInvoice(eInvoiceToDraft({ ...eBase, attributes: { ...eBase.attributes, invoice_type_code: "SATIS" } })), { ok: true });
});

test("iade listesi: ilk görülme anı korunur, yalnız yeniler sayılır, eskiler ve bozuk kayıtlar düşer", () => {
  const stored = parseReturnLog({
    sales: [{ id: "5001", date: "2026-11-15", amount: 1200, invoiceNo: null, seenAt: "2026-11-16T05:00:00.000Z" }, { id: "x", date: "bozuk", amount: 1 }],
    supplier: "bozuk",
  });
  assert.equal(stored.sales.length, 1);
  assert.deepEqual(stored.supplier, []);
  const { log, fresh } = mergeReturns(
    stored,
    {
      sales: [
        { id: "5001", date: "2026-11-15", amount: 1200, invoiceNo: null },
        { id: "ei:777", date: "2026-11-10", amount: 600, invoiceNo: "ABC2026000000777" },
        { id: "eski", date: "2026-06-01", amount: 50, invoiceNo: null },
      ],
      supplier: [{ id: "ei:888", date: "2026-11-12", amount: 2200, invoiceNo: "LAF2026000000001", supplier: "SÜTAŞ A.Ş.", taxNumber: "7810030532" }],
    },
    { now: "2026-11-17T05:00:00.000Z", cutoff: "2026-07-20" },
  );
  assert.deepEqual(fresh, { sales: 2, supplier: 1 });
  assert.deepEqual(log.sales.map((e) => e.id), ["5001", "ei:777"], "en yeni önce; 120 günden eski düşer");
  assert.equal(log.sales[0].seenAt, "2026-11-16T05:00:00.000Z", "ilk görülme anı korunur");
  assert.equal(log.supplier[0].seenAt, "2026-11-17T05:00:00.000Z");
  // Satış iadesinde müşterinin adı yok (KVKK): yalnız tarih, tutar, belge no
  assert.equal("supplier" in log.sales[1], false);
});

test("tedarikçiye iade Faturalar'a eksi tutarla girilince listeden düşer (ad ya da vergi no, ±31 gün, ±1 ₺)", () => {
  const r = { date: "2026-11-12", amount: 2200, supplier: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", taxNumber: "7810030532" };
  const inv = (over: Partial<{ date: string; supplier: string; payable: number; supplierTaxNumber: string | null }>) => ({ date: "2026-11-14", supplier: "Sütaş", payable: -2200, supplierTaxNumber: null, ...over });
  assert.equal(supplierReturnEntered(r, [inv({})]), true, "kısa adla");
  assert.equal(supplierReturnEntered(r, [inv({ supplier: "Başka", supplierTaxNumber: "7810030532" })]), true, "vergi noyla");
  assert.equal(supplierReturnEntered(r, [inv({ payable: 2200 })]), false, "artı tutar iade değil");
  assert.equal(supplierReturnEntered(r, [inv({ payable: -2150 })]), false, "tutar tutmuyor");
  assert.equal(supplierReturnEntered(r, [inv({ date: "2026-12-20" })]), false, "31 günden uzak");
  assert.equal(supplierReturnEntered(r, [inv({ supplier: "Kaldi" })]), false, "başka tedarikçi");
});

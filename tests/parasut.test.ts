import assert from "node:assert/strict";
import { test } from "node:test";

import { INVOICE_CATEGORIES } from "../src/lib/constants";
import type { Resource } from "../src/server/parasut/jsonapi";
import { billToDraft, findExisting, pickCategory, shouldImport, supplierHistory, supplierKey } from "../src/server/parasut/mapping";

/** Paraşüt API v4 purchase_bills yanıtı biçiminde örnek (JSON:API; ondalıklar metin) */
const bill: Resource = {
  id: "9001",
  type: "purchase_bills",
  attributes: {
    item_type: "purchase_bill",
    description: "Ekim süt alımı",
    issue_date: "2026-10-05",
    due_date: "2026-10-20",
    invoice_no: "SUT2026000123",
    currency: "TRL",
    gross_total: "1000.0",
    total_vat: "100.0",
    net_total: "1100.0",
    remaining: "1100.0",
    payment_status: "unpaid",
    archived: false,
    updated_at: "2026-10-05T10:00:00.000+03:00",
  },
  relationships: {
    supplier: { data: { id: "77", type: "contacts" } },
    category: { data: { id: "5", type: "item_categories" } },
    details: { data: [{ id: "d1", type: "purchase_bill_details" }, { id: "d2", type: "purchase_bill_details" }] },
  },
};
const included: Resource[] = [
  { id: "77", type: "contacts", attributes: { name: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", tax_number: "1234567890" } },
  { id: "5", type: "item_categories", attributes: { name: "Gıda" } },
  { id: "d1", type: "purchase_bill_details", attributes: { quantity: "20.0", unit_price: "40.0", vat_rate: "10.0", net_total: "800.0", description: "Süt 1 lt" }, relationships: { product: { data: { id: "p1", type: "products" } } } },
  { id: "d2", type: "purchase_bill_details", attributes: { quantity: "10.0", unit_price: "25.0", vat_rate: "10.0", discount_type: "percentage", discount_value: "20", net_total: "200.0", description: "Krema" }, relationships: { product: { data: null } } },
  { id: "p1", type: "products", attributes: { name: "Tam Yağlı Süt 1L", code: "SUT1", unit: "Adet" } },
];

test("gider faturası panel faturasına dönüşür", () => {
  const d = billToDraft(bill, included);
  assert.equal(d.externalId, "9001");
  assert.equal(d.date, "2026-10-05");
  assert.equal(d.dueDate, "2026-10-20");
  assert.equal(d.supplier, "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.");
  assert.equal(d.amount, 1000);
  assert.equal(d.vat, 100);
  assert.equal(d.payable, 1100);
  assert.equal(d.unpaid, true);
  assert.equal(d.parasutCategory, "Gıda");
  assert.equal(d.lines.length, 2);
  assert.deepEqual([d.lines[0].productKey, d.lines[0].productName, d.lines[0].quantity, d.lines[0].unit], ["p:p1", "Tam Yağlı Süt 1L", 20, "Adet"]);
  assert.equal(d.lines[1].productKey.startsWith("d:"), true);
  assert.equal(d.lines[1].discount, 50);
  assert.deepEqual(shouldImport(d), { ok: true });
});

test("iskontolu fatura: net = brüt − iskonto + KDV", () => {
  const d = billToDraft(
    { ...bill, attributes: { ...bill.attributes, gross_total: "2000.0", total_discount: "100.0", total_invoice_discount: "0.0", total_vat: "190.0", net_total: "2090.0", remaining: "2090.0" } },
    included,
  );
  assert.equal(d.amount, 2000);
  assert.equal(d.discount, 100);
  assert.equal(d.amount - d.discount, 1900);
  assert.equal(d.payable, 2090);
  const withInvoiceDiscount = billToDraft(
    { ...bill, attributes: { ...bill.attributes, gross_total: "1000.0", total_discount: "0", total_invoice_discount: "100.0", total_vat: "90.0", net_total: "990.0" } },
    included,
  );
  assert.equal(withInvoiceDiscount.amount - withInvoiceDiscount.discount, 900);
  // 1000 TL'lik kalemlere 100 TL fatura altı iskonto oranla dağıtılır
  assert.deepEqual(withInvoiceDiscount.lines.map((l) => l.netTotal), [720, 180]);
});

test("net KDV hariç gelirse ve iade faturası", () => {
  const exVat = billToDraft({ ...bill, attributes: { ...bill.attributes, gross_total: "1000.0", net_total: "1000.0", total_vat: "100.0", remaining: "1100.0" } }, included);
  assert.equal(exVat.amount, 1000);
  assert.equal(exVat.payable, 1100);
  const refund = billToDraft({ ...bill, attributes: { ...bill.attributes, item_type: "refund", remaining: "0", payment_status: "paid" } }, included);
  assert.equal(refund.amount, -1000);
  assert.equal(refund.payable, -1100);
  assert.equal(refund.unpaid, false);
});

test("döviz faturası kurla TL'ye çevrilir; iptal alınmaz, arşivlenmiş alınır", () => {
  const usd = billToDraft({ ...bill, attributes: { ...bill.attributes, currency: "USD", exchange_rate: "40.0" } }, included);
  assert.equal(usd.payable, 44000);
  assert.equal(shouldImport(billToDraft({ ...bill, attributes: { ...bill.attributes, item_type: "cancelled" } }, included)).ok, false);
  assert.equal(shouldImport(billToDraft({ ...bill, attributes: { ...bill.attributes, archived: true } }, included)).ok, true);
});

test("iade faturasının kalemleri eksi sayılır", () => {
  const refund = billToDraft({ ...bill, attributes: { ...bill.attributes, item_type: "refund" } }, included);
  assert.deepEqual(refund.lines.map((l) => [l.quantity, l.netTotal]), [[-20, -800], [-10, -200]]);
});

test("kategori: kural → tedarikçi geçmişi → komisyon → ipucu → Diğer", () => {
  const d = billToDraft(bill, included);
  const history = supplierHistory([
    { supplier: "Sütaş", category: "Hammadde & İçecek" },
    { supplier: "Sütaş", category: "Hammadde & İçecek" },
    { supplier: "Sütaş", category: "Diğer" },
  ]);
  assert.equal(pickCategory({ ...d, supplier: "Sütaş" }, [], history, INVOICE_CATEGORIES).category, "Hammadde & İçecek");
  assert.equal(
    pickCategory(d, [{ matchType: "supplier", pattern: "sütaş", category: "Tatlı & Hazır Ürün", priority: 1 }], history, INVOICE_CATEGORIES).category,
    "Tatlı & Hazır Ürün",
  );
  assert.equal(pickCategory({ ...d, supplier: "Trendyol Go", lines: [], parasutCategory: null, description: null }, [], new Map(), INVOICE_CATEGORIES).category, "Komisyon");
  assert.equal(pickCategory({ ...d, supplier: "Yeni Tedarikçi" }, [], new Map(), INVOICE_CATEGORIES).category, "Hammadde & İçecek");
  assert.equal(pickCategory({ supplier: "X", description: null, parasutCategory: null, lines: [] }, [], new Map(), INVOICE_CATEGORIES).category, "Diğer");
});

test("başka tedarikçinin aynı numaralı faturası ve boş/kısa adlar eşleşmez", () => {
  const d = billToDraft(bill, included);
  // Farklı firmalar aynı e-fatura önekini kullanabilir
  assert.equal(findExisting(d, [{ id: 5, externalId: null, invoiceNo: "SUT2026000123", supplier: "Kasap Mehmet", date: "2026-10-05", payable: 1100 }]), null);
  // Aynı tedarikçi ama numara çok farklı tarihte: eşleşmez
  assert.equal(findExisting(d, [{ id: 6, externalId: null, invoiceNo: "SUT2026000123", supplier: "Sütaş", date: "2026-03-01", payable: 9000 }]), null);
  // Adı boşa düşen kayıt ya da kelime içinden eşleşme olmaz
  assert.equal(findExisting(d, [{ id: 7, externalId: null, invoiceNo: null, supplier: "A.Ş.", date: "2026-10-05", payable: 1100 }]), null);
  assert.equal(findExisting({ ...d, supplier: "Alişan Gıda San. Tic." }, [{ id: 8, externalId: null, invoiceNo: null, supplier: "Ali", date: "2026-10-05", payable: 1100 }]), null);
});

test("aynı fatura iki kez sayılmaz", () => {
  const d = billToDraft(bill, included);
  const existing = [
    { id: 1, externalId: null, invoiceNo: "SUT-2026-000123", supplier: "Sütaş", date: "2026-10-05", payable: 1100 },
    { id: 2, externalId: null, invoiceNo: null, supplier: "Sütaş", date: "2026-10-05", payable: 1100.4 },
  ];
  assert.equal(findExisting(d, existing)?.id, 1);
  assert.equal(findExisting(d, [existing[1]])?.id, 2);
  assert.equal(findExisting(d, [{ ...existing[1], payable: 1300 }]), null);
  assert.equal(findExisting(d, [{ id: 3, externalId: "9001", invoiceNo: null, supplier: "?", date: "2020-01-01", payable: 0 }])?.id, 3);
});

test("tedarikçi anahtarı Türkçe karakter ve şirket ekinden bağımsız", () => {
  assert.equal(supplierKey("SÜTAŞ SÜT ÜRÜNLERİ A.Ş."), supplierKey("Sütaş Süt Ürünleri"));
  assert.equal(supplierKey("Kaldi (Kahve çekirdeği)"), "kaldi");
});

test("tam e-fatura numarası farklı yazılmış tedarikçi adında da eşleşir", () => {
  const d = billToDraft(
    { ...bill, attributes: { ...bill.attributes, invoice_no: "M012026001165554", issue_date: "2026-10-14", gross_total: "171.6", total_vat: "17.16", net_total: "188.76" } },
    [{ ...included[0], attributes: { name: "YEMEKSEPETİ ELEKTRONİK İLETİŞİM PERAKENDE GIDA LOJİSTİK A.Ş." } }, ...included.slice(1)],
  );
  const excel = { id: 11, externalId: null, invoiceNo: "M012026001165554", supplier: "Yemek Sepeti", date: "2026-10-14", payable: 188.76 };
  assert.equal(findExisting(d, [excel])?.id, 11);
  // Aynı numara ama tutar ve tarih uymuyor: başka firma, eşleşmez
  assert.equal(findExisting(d, [{ ...excel, date: "2026-10-01", payable: 5000 }]), null);
});

test("KDV tevkifatlı fatura: maliyet brüt − iskonto, ödenecek net", () => {
  const d = billToDraft(
    { ...bill, attributes: { ...bill.attributes, gross_total: "1000", total_discount: "0", total_vat: "200", total_vat_withholding: "100", net_total: "1100", remaining: "1100" } },
    included,
  );
  assert.equal(d.amount - d.discount, 1000);
  assert.equal(d.payable, 1100);
  assert.equal(d.outstanding, 1100);
});

test("iskontolu iadede iskonto pozitif kalır", () => {
  const d = billToDraft(
    { ...bill, attributes: { ...bill.attributes, item_type: "refund", gross_total: "2000", total_discount: "100", total_vat: "190", net_total: "2090", remaining: "0" } },
    included,
  );
  assert.equal(d.discount, 100);
  assert.equal(d.amount - d.discount, -1900);
  assert.equal(d.payable, -2090);
});

test("kategori ipuçları kelime içinden eşleşmez", () => {
  const pick = (description: string, supplier = "Yeni Firma") => pickCategory({ supplier, description, parasutCategory: null, lines: [] }, [], new Map(), INVOICE_CATEGORIES).category;
  assert.equal(pick("Sosyal medya yönetimi"), "Reklam & Tabela");
  assert.equal(pick("Erkek tuvaleti tabelası"), "Reklam & Tabela");
  assert.equal(pick("Posta gönderimi"), "Diğer");
  assert.equal(pick("Ekim kira", "Metropol İstanbul AVM"), "Kira & AVM");
  assert.equal(pick("Ekim komisyon", "Metropol Kart"), "Komisyon");
});

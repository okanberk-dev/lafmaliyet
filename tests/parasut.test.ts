import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { INVOICE_CATEGORIES } from "../src/lib/constants";
import { eInvoiceUpdateNote } from "../src/server/parasut/einvoice";
import type { Resource } from "../src/server/parasut/jsonapi";
import {
  billToDraft,
  eInvoiceDeleted,
  feedsSupplierHistory,
  findByEInvoiceNo,
  findExisting,
  gibNoClash,
  gibNoClashNote,
  missingRateNote,
  nextTaxNumber,
  pickCategory,
  recategorizeFromLines,
  shouldImport,
  supplierHistory,
  supplierKey,
} from "../src/server/parasut/mapping";

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

test("Türkçe ekli yiyecek adları ve kiraz/kira ayrımı", () => {
  const pick = (description: string) => pickCategory({ supplier: "Yeni Firma", description, parasutCategory: null, lines: [] }, [], new Map(), INVOICE_CATEGORIES).category;
  assert.equal(pick("Kiraz Püresi 1 kg"), "Diğer");
  assert.equal(pick("Mağaza kirası Ekim"), "Kira & AVM");
  assert.equal(pick("Türk Kahvesi 1 kg"), "Hammadde & İçecek");
  assert.equal(pick("Çikolata Sosu"), "Hammadde & İçecek");
  assert.equal(pick("Vanilya Şurubu"), "Hammadde & İçecek");
  assert.equal(pick("Kekler"), "Tatlı & Hazır Ürün");
  assert.equal(pick("Vanilyalı Dondurması"), "Hammadde & İçecek");
});

test("e-fatura Paraşüt'e elle girilmiş gider faturasına tam numarayla bağlanır (tedarikçi adına bakılmaz)", () => {
  // Gider faturası aynı çalışmada önce yazılır: kaydı Paraşüt kimliğiyle durur, e-faturası yok
  const billRow = { id: 21, externalId: "456", invoiceNo: "ABC2026000000123", supplier: "Sütaş", date: "2026-10-14", payable: 1320 };
  const e = { invoiceNo: "ABC-2026-000000123", date: "2026-10-14", payable: 1320.4 };
  assert.equal(findByEInvoiceNo(e, [billRow])?.id, 21);
  // Elle girilirken tarih bir gün kaymış ama tutar aynı: yine aynı fatura
  assert.equal(findByEInvoiceNo({ ...e, date: "2026-10-15" }, [billRow])?.id, 21);
  // Aynı numara ama başka tarih ve tutar (ortak önekli başka firma), ya da ±31 günden uzak: bağlanmaz
  assert.equal(findByEInvoiceNo({ ...e, date: "2026-10-20", payable: 5000 }, [billRow]), null);
  assert.equal(findByEInvoiceNo({ ...e, date: "2026-12-01" }, [billRow]), null);
  // Tam e-fatura numarası değilse (kısa, serbest numara) bu yolla bağlanmaz
  assert.equal(findByEInvoiceNo({ ...e, invoiceNo: "SUT2026000123" }, [{ ...billRow, invoiceNo: "SUT2026000123" }]), null);
  // findExisting yalnız bağsız kayıtlara bakar; bu kayıt Paraşüt'e bağlı olduğu için orada aday değil
  assert.equal(findExisting({ ...e, externalId: "ei:1", supplier: "Sütaş" }, [billRow]), null);
});

test("FC-03: GİB portalı numarası (GIB…) yalnız aynı tedarikçide (ad ya da vergi no) eşleşir; öteki tam numaralar adsız da", () => {
  // Elle girilmiş "Ahmet Usta" faturası; aynı gün, aynı numarayla başka bir ustanın Paraşüt faturası gelir
  const ahmet = { id: 31, externalId: null, invoiceNo: "GIB2026000000012", supplier: "Ahmet Usta", date: "2026-11-08", payable: 500 };
  const mehmet = { externalId: "901", invoiceNo: "GIB2026000000012", date: "2026-11-08", payable: 960, supplier: "MEHMET TESİSAT", taxNumber: "12345678950" };
  assert.equal(findByEInvoiceNo(mehmet, [ahmet]), null, "başka tedarikçi: güçlü kimlik değil");
  assert.equal(findExisting(mehmet, [ahmet]), null, "yeni kayıt açılır, Ahmet'in kaydına dokunulmaz");
  // Aynı tedarikçi (adı farklı yazılmış): bağlanır
  assert.equal(findExisting({ ...mehmet, supplier: "AHMET USTA TESİSAT", payable: 500 }, [ahmet])?.id, 31);
  // Adı tutmayan ama vergi nosu aynı kayıt (daha önce Paraşüt'ten numarasını almış): bağlanır
  const withTax = { ...ahmet, supplier: "Kombici", supplierTaxNumber: "12345678950" };
  assert.equal(findByEInvoiceNo(mehmet, [withTax])?.id, 31);
  assert.equal(findByEInvoiceNo({ ...mehmet, taxNumber: "1234567808" }, [withTax]), null);
  // Geçersiz (örnek) vergi no eşleşmede kullanılmaz
  assert.equal(findByEInvoiceNo({ ...mehmet, taxNumber: "9876543210" }, [{ ...withTax, supplierTaxNumber: "9876543210" }]), null);
  // E-fatura yolu: Paraşüt'e elle girilmiş başka tedarikçinin gider faturasına da bağlanmaz
  const bill = { id: 32, externalId: "455", invoiceNo: "GIB2026000000007", supplier: "Hasan Elektrik", date: "2026-11-05", payable: 300 };
  assert.equal(findByEInvoiceNo({ invoiceNo: "GIB2026000000007", date: "2026-11-08", payable: 300, supplier: "VELİ BOYA SAN.", taxNumber: "1234567808" }, [bill]), null);
  // Öteki önekler eskisi gibi: tam numara tedarikçi adına bakmadan (Yemek Sepeti ~ YEMEKSEPETİ)
  assert.equal(findByEInvoiceNo({ invoiceNo: "ABC2026000000123", date: "2026-10-14", payable: 1320, supplier: "Başka Ad" }, [{ ...bill, invoiceNo: "ABC2026000000123", date: "2026-10-14", payable: 1320 }])?.id, 32);
});

test("FC-03: adı tutmayan aynı tedarikçi Tedarikçiler kartıyla tanınır; tutmayan aday yeni kayda not düşer", () => {
  // Elle "Ahmet Usta" (vergi nosuz); Paraşüt'te "AHMET YILMAZ". Kart "Ahmet Usta": diğer adı "AHMET YILMAZ", vergi nosu …950
  const manual = { id: 41, externalId: null, invoiceNo: "GIB2026000000012", supplier: "Ahmet Usta", date: "2026-11-08", payable: 960 };
  const yilmaz = { externalId: "903", invoiceNo: "GIB2026000000012", date: "2026-11-08", payable: 960, supplier: "AHMET YILMAZ", taxNumber: "12345678950" };
  const card = (names: string[], tax: string | null) => (supplier: string, taxNumber?: string | null) =>
    names.includes(supplier) || (tax !== null && taxNumber === tax) ? 7 : null;
  assert.equal(findExisting(yilmaz, [manual]), null, "kart çözücüsüz: ad da vergi no da tutmuyor");
  assert.equal(findExisting(yilmaz, [manual], card(["Ahmet Usta"], "12345678950"))?.id, 41, "kartın vergi nosu");
  assert.equal(findExisting({ ...yilmaz, taxNumber: null }, [manual], card(["Ahmet Usta", "AHMET YILMAZ"], null))?.id, 41, "kartın diğer adı");
  // Başka karta ya da karta hiç düşmeyen ad: bağlanmaz
  assert.equal(findByEInvoiceNo(yilmaz, [manual], (n) => (n === "Ahmet Usta" ? 7 : n === "AHMET YILMAZ" ? 8 : null)), null);
  assert.equal(findByEInvoiceNo(yilmaz, [manual], () => null), null);
  // Bağlanmayan GİB adayı: yeni kayıt kontrol bekler, notu elle kaydı söyler
  assert.equal(gibNoClash(yilmaz, [manual])?.id, 41);
  assert.equal(gibNoClashNote({ ...manual, origin: "manual" }), "aynı numaralı elle girilmiş fatura var (Ahmet Usta, 08.11.2026); aynı faturaysa birini silin");
  assert.match(gibNoClashNote({ ...manual, origin: "excel" }), /^aynı numaralı Excel'den alınmış fatura var/);
  // Paraşüt'e bağlı kayıt, ±31 gün dışı ya da tarih ve tutar ikisi farklıysa, GİB dışı numarada aday yok
  assert.equal(gibNoClash(yilmaz, [{ ...manual, externalId: "455" }]), null);
  assert.equal(gibNoClash({ ...yilmaz, date: "2026-12-20" }, [manual]), null);
  assert.equal(gibNoClash({ ...yilmaz, date: "2026-11-09", payable: 500 }, [manual]), null);
  assert.equal(gibNoClash({ ...yilmaz, invoiceNo: "ABC2026000000012" }, [{ ...manual, invoiceNo: "ABC2026000000012" }]), null);
});

test("FC-05: kuru gelmeyen döviz faturası işaretlenir (kur 1 sayılır, kayıt kontrol bekler); kur gelince ya da TL'de işaret yok", () => {
  const usd = (rate?: string) => billToDraft({ ...bill, attributes: { ...bill.attributes, currency: "USD", ...(rate === undefined ? {} : { exchange_rate: rate }) } }, included);
  assert.deepEqual([usd().missingRate, usd().payable], ["USD", 1100]);
  assert.equal(usd("0.0").missingRate, "USD");
  assert.deepEqual([usd("34.5").missingRate, usd("34.5").payable], [null, 37950]);
  assert.equal(billToDraft(bill, included).missingRate, null);
  assert.equal(billToDraft({ ...bill, attributes: { ...bill.attributes, currency: "TRY" } }, included).missingRate, null);
  assert.equal(missingRateNote("USD"), "USD faturası: döviz kuru okunamadı, tutarı kontrol edin");
});

test("FC-X1: e-faturaya bağlanan kaydın notu değişen alanı söyler (tutar, tarih ya da ikisi)", () => {
  const prev = { payable: 1100, date: "2026-11-07" };
  assert.equal(eInvoiceUpdateNote(prev, { payable: 1100, date: "2026-11-09" }), "tarih e-faturaya göre güncellendi (önce 07.11.2026)");
  assert.equal(eInvoiceUpdateNote(prev, { payable: 1250, date: "2026-11-07" }), "tutar e-faturaya göre güncellendi (önce 1.100 ₺)");
  assert.equal(eInvoiceUpdateNote(prev, { payable: 1250, date: "2026-11-09" }), "tutar ve tarih e-faturaya göre güncellendi (önce 1.100 ₺, 07.11.2026)");
  // ±1 ₺ tutar farkı sayılmaz
  assert.equal(eInvoiceUpdateNote(prev, { payable: 1100.6, date: "2026-11-09" }), "tarih e-faturaya göre güncellendi (önce 07.11.2026)");
});

test("panelde silinen e-fatura içeri alınınca gider faturası olarak geri gelmez", () => {
  const d = billToDraft({ ...bill, relationships: { ...bill.relationships, active_e_document: { data: { id: "123", type: "e_invoices" } } } }, included);
  assert.deepEqual(d.eDocument, { type: "e_invoices", id: "123" });
  assert.equal(eInvoiceDeleted(d, new Set(["ei:123"])), true);
  assert.equal(eInvoiceDeleted(d, new Set(["ei:999", "123"])), false);
  // e-arşiv ya da e-belgesiz gider faturası
  assert.equal(eInvoiceDeleted({ eDocument: { type: "e_archives", id: "123" } }, new Set(["ei:123"])), false);
  assert.equal(eInvoiceDeleted(billToDraft(bill, included), new Set(["ei:123"])), false);
});

test("tedarikçi geçmişi: Excel/elle kayıtlar ve kontrol edilmiş Paraşüt kayıtları, kontrol bekleyen tahminler değil", () => {
  const rows = [
    { supplier: "Yeni Ambalaj Ltd.", category: "Ambalaj", origin: "parasut", needsReview: false },
    { supplier: "Yeni Ambalaj Ltd.", category: "Diğer", origin: "parasut", needsReview: true },
    { supplier: "Yeni Ambalaj Ltd.", category: "Diğer", origin: "parasut", needsReview: true },
    { supplier: "Sütaş", category: "Hammadde & İçecek", origin: "excel", needsReview: false },
    { supplier: "Sütaş", category: "Hammadde & İçecek", origin: "manual", needsReview: true },
  ];
  const history = supplierHistory(rows.filter(feedsSupplierHistory));
  assert.equal(history.get(supplierKey("Yeni Ambalaj")), "Ambalaj");
  assert.equal(history.get(supplierKey("Sütaş")), "Hammadde & İçecek");
  const d = { supplier: "YENİ AMBALAJ LTD. ŞTİ.", description: null, parasutCategory: null, lines: [] };
  assert.deepEqual(pickCategory(d, [], history, INVOICE_CATEGORIES), { category: "Ambalaj", reason: "tedarikçinin önceki faturaları" });
});

test("e-faturadan kalemsiz açılan kaydın kategorisi kalemler okununca yeniden denenir", () => {
  const row = {
    origin: "parasut",
    needsReview: true,
    supplier: "Yeni Firma Gıda",
    category: "Diğer",
    note: "Paraşüt e-faturası (içeri alınmadan) · kategori: eşleşme yok · vade e-faturadan: 13.11.2026",
  };
  const lines = [{ productName: "ESPRESSO ÇEKİRDEK 1 KG" }, { productName: "SÜT 1 L" }];
  assert.deepEqual(recategorizeFromLines(row, lines, [], INVOICE_CATEGORIES), {
    category: "Hammadde & İçecek",
    note: "Paraşüt e-faturası (içeri alınmadan) · kategori: Paraşüt kategorisi / kalem adları · vade e-faturadan: 13.11.2026",
    reason: "Paraşüt kategorisi / kalem adları",
  });
  // Kalem adında geçen anahtar kelime kuralı ipucundan önce gelir
  const rule = { matchType: "keyword" as const, pattern: "karton bardak", category: "Ambalaj", priority: 1 };
  assert.equal(recategorizeFromLines(row, [{ productName: "KARTON BARDAK 8 OZ" }], [rule], INVOICE_CATEGORIES)?.category, "Ambalaj");
  // Kalem adlarından da bir şey çıkmazsa, kalem yoksa, kayıt onaylanmışsa/kategorisi değiştirilmişse, Excel kaydıysa
  // ya da kategori zaten bir nedene dayanıyorsa dokunulmaz
  assert.equal(recategorizeFromLines(row, [{ productName: "XYZ-42" }], [], INVOICE_CATEGORIES), null);
  assert.equal(recategorizeFromLines(row, [], [], INVOICE_CATEGORIES), null);
  assert.equal(recategorizeFromLines({ ...row, needsReview: false }, lines, [], INVOICE_CATEGORIES), null);
  assert.equal(recategorizeFromLines({ ...row, origin: "excel" }, lines, [], INVOICE_CATEGORIES), null);
  assert.equal(recategorizeFromLines({ ...row, note: "Paraşüt e-faturası (içeri alınmadan) · kategori: Paraşüt kategorisi / kalem adları" }, lines, [], INVOICE_CATEGORIES), null);
});

test("vergi no: gider faturasında gelen e-belgenin numarası (from_vkn) ve kişi kartınınki ayrı okunur", () => {
  const plain = billToDraft(bill, included);
  assert.equal(plain.supplierTaxNo, "1234567890", "kişi kartı");
  assert.equal(plain.eDocumentTaxNo, null, "e-belge yok");
  const withDoc = { ...bill, relationships: { ...bill.relationships, active_e_document: { data: { id: "4401", type: "e_invoices" } } } };
  const doc = (attributes: Record<string, unknown>): Resource => ({ id: "4401", type: "e_invoices", attributes });
  const d = billToDraft(withDoc, [...included, doc({ direction: "inbound", uuid: "8f1c", from_vkn: " 7810030532 " })]);
  assert.equal(d.eDocumentTaxNo, "7810030532", "imzalı belgedeki numara");
  assert.equal(d.supplierTaxNo, "1234567890", "kişi kartınınki yine okunur");
  assert.deepEqual(d.eDocument, { type: "e_invoices", id: "4401" });
  // Yönü yazılmamış belge gelen sayılır; giden belgedeki from_vkn işletmenin kendi numarasıdır, alınmaz
  assert.equal(billToDraft(withDoc, [...included, doc({ from_vkn: "7810030532" })]).eDocumentTaxNo, "7810030532");
  assert.equal(billToDraft(withDoc, [...included, doc({ direction: "outbound", from_vkn: "7810030532" })]).eDocumentTaxNo, null);
  // E-belge include edilmediyse (ya da e-Arşiv ise) numara yok
  assert.equal(billToDraft(withDoc, included).eDocumentTaxNo, null);
  const archive = { ...bill, relationships: { ...bill.relationships, active_e_document: { data: { id: "9", type: "e_archives" } } } };
  assert.equal(billToDraft(archive, [...included, { id: "9", type: "e_archives", attributes: { from_vkn: "7810030532" } }]).eDocumentTaxNo, null);
});

test("vergi no: boş kayda yazılır; e-fatura numarası geçer; kişi kartınınki e-faturalı kaydı ezmez", () => {
  // Boş kayıt: nereden gelirse gelsin yazılır (saklanan biçim: yalnız rakam)
  assert.equal(nextTaxNumber(null, " 781 003 0532 ", { from: "bill", hasEInvoice: false }), "7810030532");
  assert.equal(nextTaxNumber(null, "7810030532", { from: "bill", hasEInvoice: true }), "7810030532");
  // Aynıysa ya da gelen boş / yanlış uzunluktaysa değişiklik yok
  assert.equal(nextTaxNumber("7810030532", "7810030532", { from: "einvoice", hasEInvoice: true }), null);
  assert.equal(nextTaxNumber("7810030532", null, { from: "einvoice", hasEInvoice: true }), null);
  assert.equal(nextTaxNumber("7810030532", "123", { from: "bill", hasEInvoice: false }), null);
  assert.equal(nextTaxNumber(null, "", { from: "bill", hasEInvoice: false }), null);
  // İmzalı belge her zaman geçer
  assert.equal(nextTaxNumber("4567890128", "7810030532", { from: "einvoice", hasEInvoice: true }), "7810030532");
  // Kişi kartı Paraşüt'te düzeltildiyse e-faturasız kayıtta yazılır; e-faturalı kayıtta belgenin numarası kalır
  assert.equal(nextTaxNumber("4567890128", "7810030532", { from: "bill", hasEInvoice: false }), "7810030532");
  assert.equal(nextTaxNumber("4567890128", "7810030532", { from: "bill", hasEInvoice: true }), null);
  // Kontrol hanesi tutmayan numara da saklanır (faturada görünür, eşleşmede kullanılmaz)
  assert.equal(nextTaxNumber(null, "1234567891", { from: "bill", hasEInvoice: false }), "1234567891");
});

test("vergi no kaynağı: eşitleme numarayı yeni ve var olan faturaya yazar, var olanın güncellemesini değiştirmez", () => {
  const sync = readFileSync(join(process.cwd(), "src/server/parasut/sync.ts"), "utf8");
  // Gider faturası: gelen e-belgenin numarası önce, yoksa kişi kartınınki
  assert.match(sync, /const taxRaw = d\.eDocumentTaxNo \?\? d\.supplierTaxNo;/);
  // Yeni kayıtlar numarasıyla açılır (gider faturası ve içeri alınmamış e-fatura)
  assert.equal(sync.match(/^\s+supplierTaxNumber,$/gm)?.length, 4, "iki yeni kayıt: insert ve bellekteki kopya");
  assert.match(sync, /const supplierTaxNumber = cleanTaxNumber\(taxRaw\);/);
  assert.match(sync, /const supplierTaxNumber = cleanTaxNumber\(d\.supplierTaxNo\);/);
  // Var olan kayıtta ayrı yazılır (nextTaxNumber): gider faturası güncellemesinden sonra, e-faturanın üç yolunda
  assert.equal(sync.match(/await fillTaxNumber\(ctx, /g)?.length, 4);
  // Eski faturaların tamamlaması eşitlemenin artan süresinde, sıfırlamada baştan
  assert.match(sync, /backfillSupplierTaxNumbers\(client, \{ until: started \+ deadline - 3_000 \}\)/);
  assert.match(readFileSync(join(process.cwd(), "src/server/parasut/keys.ts"), "utf8"), /PARASUT_STATE_KEYS = \[[^\]]*TAX_BACKFILL_KEY\]/);
  assert.match(sync, /`\$\{taxFilled\} faturaya vergi no yazıldı`/);
});

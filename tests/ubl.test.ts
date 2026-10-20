import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { extractUblXml, parseUbl, paymentPlan, ublLinesMatchTotal, ublLinesToDrafts } from "../src/server/parasut/ubl";

/** Paraşüt'ün signed_ubl yanıtı gibi tek dosyalı ZIP */
function zip(name: string, content: string, method: 0 | 8 = 8): Buffer {
  const raw = Buffer.from(content, "utf8");
  const body = method === 8 ? deflateRawSync(raw) : raw;
  const fileName = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + fileName.length + body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + fileName.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, fileName, body, central, fileName, eocd]);
}

const line = (o: { id: string; name: string; qty: string; unit: string; price: string; ext: string; pct: string; code?: string; allowance?: string | string[]; taxable?: string; note?: string }) => `
  <cac:InvoiceLine>
    <cbc:ID>${o.id}</cbc:ID>
    ${o.note ? `<cbc:Note>${o.note}</cbc:Note>` : ""}
    <cbc:InvoicedQuantity unitCode="${o.unit}">${o.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">${o.ext}</cbc:LineExtensionAmount>
    ${[o.allowance ?? []]
      .flat()
      .map((a) => `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="TRY">${a}</cbc:Amount></cac:AllowanceCharge>`)
      .join("")}
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="TRY">0</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="TRY">${o.taxable ?? o.ext}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="TRY">0</cbc:TaxAmount>
        <cbc:Percent>${o.pct}</cbc:Percent>
        <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${o.name}</cbc:Name>
      ${o.code ? `<cac:SellersItemIdentification><cbc:ID>${o.code}</cbc:ID></cac:SellersItemIdentification>` : ""}
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">${o.price}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;

const ubl = (opts: { type?: string; lines: string; invoiceAllowance?: string; taxExclusive: string; payable: string; vat?: string; withholding?: string }) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>ABC2026000000123</cbc:ID>
  <cbc:UUID>0f8fad5b-d9cb-469f-a165-70867728950e</cbc:UUID>
  <cbc:IssueDate>2026-10-14</cbc:IssueDate>
  <cbc:InvoiceTypeCode>${opts.type ?? "SATIS"}</cbc:InvoiceTypeCode>
  <cbc:Note>Yalnız dörtyüz TL</cbc:Note>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference><cbc:ID>xslt</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/xml">PD94bWw=</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0123456789000015</cbc:ID></cac:PartyIdentification>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>ÖRNEK GIDA SAN. VE TİC. A.Ş.</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">9876543210</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>L'AFFOGATO</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-11-13</cbc:PaymentDueDate></cac:PaymentMeans>
  ${opts.invoiceAllowance ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="TRY">${opts.invoiceAllowance}</cbc:Amount></cac:AllowanceCharge>` : ""}
  ${opts.vat ? `<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">${opts.withholding ? Number(opts.vat) - Number(opts.withholding) : opts.vat}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">${opts.taxExclusive}</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">${opts.vat}</cbc:TaxAmount><cbc:Percent>20</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>` : ""}
  ${opts.withholding ? `<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">${opts.withholding}</cbc:TaxAmount></cac:WithholdingTaxTotal>` : ""}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">0</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">${opts.taxExclusive}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">${opts.payable}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="TRY">${opts.payable}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${opts.lines}
</Invoice>`;

const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

const twoLines =
  line({ id: "1", name: "SÜT 1 LT", qty: "12", unit: "C62", price: "30", ext: "324", pct: "1", code: "SUT-1L", allowance: "36", note: "Lot 55" }) +
  line({ id: "2", name: "Espresso Çekirdeği 1 KG", qty: "2.5", unit: "KGM", price: "800", ext: "2000", pct: "10" });

test("UBL: ZIP'ten XML'i çıkarır (deflate ve stored), düz XML'i olduğu gibi bırakır", () => {
    const xml = ubl({ lines: twoLines, taxExclusive: "2324", payable: "2527.24" });
    assert.equal(extractUblXml(zip("signed_ubl_0f8fad5b.xml", xml)), xml);
    assert.equal(extractUblXml(zip("signed_ubl_0f8fad5b.xml", xml, 0)), xml);
    assert.equal(extractUblXml(Buffer.from(`﻿${xml}`, "utf8")), xml);
    assert.throws(() => extractUblXml(Buffer.from("%PDF-1.4")));
  });

test("UBL: başlığı ve kalemleri okur", () => {
    const inv = parseUbl(ubl({ lines: twoLines, taxExclusive: "2324", payable: "2527.24" }));
    assert.deepEqual(pick(inv, ["invoiceNo", "uuid", "issueDate", "typeCode", "currency", "supplierName", "supplierTaxId", "dueDate", "taxExclusive", "payable"]), {
      invoiceNo: "ABC2026000000123",
      uuid: "0f8fad5b-d9cb-469f-a165-70867728950e",
      issueDate: "2026-10-14",
      typeCode: "SATIS",
      currency: "TRY",
      supplierName: "ÖRNEK GIDA SAN. VE TİC. A.Ş.",
      supplierTaxId: "1234567890",
      dueDate: "2026-11-13",
      taxExclusive: 2324,
      payable: 2527.24,
    });
    assert.deepEqual(inv.lines, [
      { id: "1", name: "SÜT 1 LT", description: "Lot 55", sellerCode: "SUT-1L", quantity: 12, unitCode: "C62", unitPrice: 30, discount: 36, lineTotal: 324, vatRate: 1 },
      { id: "2", name: "Espresso Çekirdeği 1 KG", description: null, sellerCode: null, quantity: 2.5, unitCode: "KGM", unitPrice: 800, discount: 0, lineTotal: 2000, vatRate: 10 },
    ]);
    assert.equal(ublLinesMatchTotal(inv), true);
  });

test("UBL: panel kalemine çevirir; ürün anahtarı tedarikçi VKN'si + satıcı kodu ya da ad", () => {
    const inv = parseUbl(ubl({ lines: twoLines, taxExclusive: "2324", payable: "2527.24" }));
    const drafts = ublLinesToDrafts(inv, "9001", "Örnek Gıda");
    assert.deepEqual(drafts, [
      { externalId: "ubl:9001:1", productKey: "e:1234567890:#SUT-1L", productName: "SÜT 1 LT", description: "Lot 55", quantity: 12, unit: "Adet", unitPrice: 30, discount: 36, vatRate: 1, netTotal: 324 },
      { externalId: "ubl:9001:2", productKey: "e:1234567890:espresso cekirdegi kg", productName: "Espresso Çekirdeği 1 KG", description: null, quantity: 2.5, unit: "kg", unitPrice: 800, discount: 0, vatRate: 10, netTotal: 2000 },
    ]);
  });

test("UBL: fatura altı iskontoyu kalemlere dağıtır, iadede miktarı eksi yazar", () => {
    const withDiscount = parseUbl(ubl({ lines: twoLines, invoiceAllowance: "232.4", taxExclusive: "2091.6", payable: "2280" }));
    const d = ublLinesToDrafts(withDiscount, "9002", "x");
    assert.deepEqual(d.map((l) => l.netTotal), [291.6, 1800]);
    assert.equal(d[1].discount, 200);
    assert.equal(ublLinesMatchTotal(withDiscount), true);

    const refund = ublLinesToDrafts(parseUbl(ubl({ type: "IADE", lines: twoLines, taxExclusive: "2324", payable: "2527.24" })), "9003", "x");
    assert.deepEqual(refund.map((l) => [l.quantity, l.netTotal]), [
      [-12, -324],
      [-2.5, -2000],
    ]);
  });

test("UBL: her kaleme aynı kodu yazan sağlayıcıda ada göre anahtarlar; tutmayan toplamı bildirir", () => {
    const same =
      line({ id: "1", name: "Bardak 8oz", qty: "1000", unit: "C62", price: "1", ext: "1000", pct: "20", code: "0" }) +
      line({ id: "2", name: "Kapak 8oz", qty: "1000", unit: "C62", price: "0.5", ext: "500", pct: "20", code: "STK" }) +
      line({ id: "3", name: "Pipet", qty: "500", unit: "C62", price: "0.2", ext: "100", pct: "20", code: "STK" });
    const inv = parseUbl(ubl({ lines: same, taxExclusive: "1700", payable: "2040" }));
    assert.deepEqual(ublLinesToDrafts(inv, "9004", "x").map((l) => l.productKey), ["e:1234567890:bardak 8oz", "e:1234567890:kapak 8oz", "e:1234567890:pipet"]);
    assert.equal(ublLinesMatchTotal(inv), false);
  });

test("UBL: kalem iskontosunu fatura altında yineleyen sağlayıcı (Sütaş) iki kez düşülmez", () => {
  // Kalem tutarı brüt, kalem iskontosu bilgi amaçlı; iskonto toplamı fatura altında düşülür
  const gross =
    line({ id: "1", name: "SÜT %2,5 YAĞLI 1 L", qty: "120", unit: "C62", price: "55.75", ext: "6690", pct: "1", code: "512109", allowance: "468.3" }) +
    line({ id: "2", name: "SÜT LAKTOZSUZ 1 L", qty: "24", unit: "C62", price: "53.25", ext: "1278", pct: "1", code: "540300", allowance: "89.46" });
  const sutas = parseUbl(ubl({ lines: gross, invoiceAllowance: "557.76", taxExclusive: "7410.24", payable: "7484.34" }));
  assert.deepEqual(
    ublLinesToDrafts(sutas, "9005", "x").map((l) => [l.netTotal, l.discount]),
    [
      [6221.7, 468.3],
      [1188.54, 89.46],
    ],
  );
  assert.equal(ublLinesMatchTotal(sutas), true);

  // Kalem tutarı zaten net, fatura altındaki iskonto yalnız bilgi: toplam tutuyor, ikinci kez düşülmez
  const net =
    line({ id: "1", name: "SÜT %2,5 YAĞLI 1 L", qty: "120", unit: "C62", price: "55.75", ext: "6221.7", pct: "1", allowance: "468.3" }) +
    line({ id: "2", name: "SÜT LAKTOZSUZ 1 L", qty: "24", unit: "C62", price: "53.25", ext: "1188.54", pct: "1", allowance: "89.46" });
  const info = parseUbl(ubl({ lines: net, invoiceAllowance: "557.76", taxExclusive: "7410.24", payable: "7484.34" }));
  assert.deepEqual(
    ublLinesToDrafts(info, "9006", "x").map((l) => l.netTotal),
    [6221.7, 1188.54],
  );
  assert.equal(ublLinesMatchTotal(info), true);
});

test("UBL: adı kod olan kalemde okunur açıklama ad olur, kod anahtarda kalır", () => {
  const coded = line({ id: "1", name: "21012940", qty: "5", unit: "C62", price: "1603.96", ext: "6816.83", pct: "1", allowance: "1202.97", note: "TOST EKMEĞİ 1500 GR" });
  const inv = parseUbl(ubl({ lines: coded, taxExclusive: "6816.83", payable: "6885" }));
  assert.equal(inv.lines[0].name, "TOST EKMEĞİ 1500 GR");
  assert.equal(inv.lines[0].sellerCode, "21012940");
  assert.equal(inv.lines[0].description, "21012940");
  const [d] = ublLinesToDrafts(inv, "9007", "x");
  assert.equal(d.productKey, "e:1234567890:#21012940");
  assert.equal(d.productName, "TOST EKMEĞİ 1500 GR");

  // Okunur metin yoksa kod ad olarak kalır
  const bare = parseUbl(ubl({ lines: line({ id: "1", name: "600.02.022", qty: "302", unit: "KWH", price: "5.47", ext: "1653.3", pct: "20" }), taxExclusive: "1653.3", payable: "1983.96" }));
  assert.equal(bare.lines[0].name, "600.02.022");
  assert.equal(ublLinesToDrafts(bare, "9008", "x")[0].unit, "kWh");
});

test("UBL: kalemi brüt yazıp iskontoyu ayrıca veren sağlayıcı (Erbak) ve %100 iskontolu bedava koli", () => {
  const erbak =
    line({ id: "1", name: "PRE.KAY.SUYU 40CL PET 12TV", qty: "10", unit: "NPL", price: "266.49725916", ext: "2664.9725916", pct: "1", code: "15214500002", allowance: "1347.29727433", taxable: "1317.68", note: "Aciklama: " }) +
    line({ id: "2", name: "PRE.KAY.SUYU 33CL TYN 12TV", qty: "10", unit: "NPL", price: "333.03042252", ext: "3330.3042252", pct: "1", code: "15214500000", allowance: ["338.02901434", "658.30054639"], taxable: "2333.97" }) +
    line({ id: "3", name: "PRE.KAY.SUYU 40CL PET 12TV", qty: "2", unit: "NPL", price: "266.49725916", ext: "532.99451832", pct: "1", code: "15214500002", allowance: "532.99451832", taxable: "0", note: "KOLI" });
  const inv = parseUbl(ubl({ lines: erbak, taxExclusive: "3651.65", payable: "3688.17" }));
  assert.equal(inv.lineMode, "ext-allowance");
  assert.equal(inv.linesMatch, true);
  const d = ublLinesToDrafts(inv, "9009", "x");
  assert.deepEqual(
    d.map((l) => [l.quantity, l.unit, l.netTotal]),
    [
      [10, "Koli", 1317.68],
      [10, "Koli", 2333.97],
      [2, "Koli", 0],
    ],
  );
  // Boş etiket notu açıklamaya yazılmaz, anlamlı not yazılır
  assert.equal(inv.lines[0].description, null);
  assert.equal(inv.lines[2].description, "KOLI");
  // Aynı ürün aynı anahtarla gelir (bedava koli dahil)
  assert.equal(d[0].productKey, d[2].productKey);
});

test("UBL: tevkifatlı faturada KDV hariç tutar, KDV ve tevkifat ayrı okunur", () => {
  const inv = parseUbl(
    ubl({
      type: "TEVKIFAT",
      lines: line({ id: "1", name: "REKLAM BEDELİ", qty: "1", unit: "C62", price: "30000", ext: "30000", pct: "20" }),
      taxExclusive: "30000",
      payable: "34200",
      vat: "6000",
      withholding: "1800",
    }),
  );
  assert.equal(inv.typeCode, "TEVKIFAT");
  assert.equal(inv.taxExclusive, 30000);
  assert.equal(inv.vat, 6000);
  assert.equal(inv.withholding, 1800);
  assert.equal(inv.payable, 34200);
  assert.equal(inv.linesMatch, true);
});

/** Ödeme bilgisi denemeleri için en küçük fatura: yalnız tarih, notlar ve verilen ödeme blokları */
const payDoc = (opts: { issue?: string; notes?: string[]; means?: string; terms?: string }) => `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>X1</cbc:ID><cbc:IssueDate>${opts.issue ?? "2026-10-14"}</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  ${(opts.notes ?? []).map((n) => `<cbc:Note>${n}</cbc:Note>`).join("")}
  ${opts.means ?? ""}${opts.terms ?? ""}
  <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="TRY">0</cbc:TaxExclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`;

test("UBL ödeme: vade ödeme alanından, koşullardan ya da nottan; ödeme şekli ve peşin", () => {
  // Ödeme alanı (Sütaş gibi): havale, 15 gün vade
  const sutas = parseUbl(payDoc({ means: "<cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-10-29</cbc:PaymentDueDate></cac:PaymentMeans>" }));
  assert.deepEqual([sutas.dueDate, sutas.dueSource, sutas.paymentMeans, sutas.cashOnDelivery], ["2026-10-29", "payment-means", "havale", false]);
  // Ödeme koşulları + "Ödeme Tipi: Peşin" (Erbak): vade fatura günü, peşin
  const erbak = parseUbl(payDoc({ issue: "2026-09-26", notes: ["Vade Günü: 0", "Ödeme Tipi: Peşin"], terms: "<cac:PaymentTerms><cbc:Note /><cbc:PaymentDueDate>2026-09-26</cbc:PaymentDueDate></cac:PaymentTerms>" }));
  assert.deepEqual([erbak.dueDate, erbak.dueSource, erbak.cashOnDelivery], ["2026-09-26", "payment-terms", true]);
  // Not: tarihli ("Son Ödeme Tarihi: 05.11.2026") ve gün sayılı ("30 gün vade", "VADE: 45")
  assert.deepEqual([parseUbl(payDoc({ notes: ["Sevk Tarihi: 14-10-2026", "SON ÖDEME TARİHİ: 05.11.2026"] })).dueDate], ["2026-11-05"]);
  assert.equal(parseUbl(payDoc({ notes: ["Ödeme: 30 gün vade"] })).dueDate, "2026-11-13");
  assert.equal(parseUbl(payDoc({ notes: ["VADE: 45"] })).dueDate, "2026-11-28");
  assert.equal(parseUbl(payDoc({ notes: ["Valör Tarihi: 2026-10-24"] })).dueSource, "note");
  // Fatura gününden önceki ya da yıldan uzun "vade" yazım hatası sayılır; sonraki geçerli kaynağa bakılır
  const bad = parseUbl(
    payDoc({
      means: "<cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-01-01</cbc:PaymentDueDate></cac:PaymentMeans>",
      terms: "<cac:PaymentTerms><cbc:PaymentDueDate>2031-01-01</cbc:PaymentDueDate></cac:PaymentTerms>",
      notes: ["Vade Tarihi: 21.10.2026"],
    }),
  );
  assert.deepEqual([bad.dueDate, bad.dueSource, bad.paymentMeans], ["2026-10-21", "note", "nakit"]);
  // Hiç vade yok
  assert.deepEqual([parseUbl(payDoc({})).dueDate, parseUbl(payDoc({})).cashOnDelivery], [null, false]);
});

test("UBL ödeme planı: vadesi gelmemiş ödenmedi, peşin ve vadesi geçmiş ödendi", () => {
  const today = "2026-10-20";
  assert.deepEqual(paymentPlan({ dueDate: "2026-10-29", cashOnDelivery: false }, "2026-10-14", today), { dueDate: "2026-10-29", unpaid: true });
  assert.deepEqual(paymentPlan({ dueDate: "2026-10-20", cashOnDelivery: false }, "2026-10-05", today), { dueDate: "2026-10-20", unpaid: true });
  assert.deepEqual(paymentPlan({ dueDate: "2026-10-04", cashOnDelivery: false }, "2026-09-19", today), { dueDate: "2026-10-04", unpaid: false });
  assert.deepEqual(paymentPlan({ dueDate: "2026-10-14", cashOnDelivery: true }, "2026-10-14", today), { dueDate: "2026-10-14", unpaid: false });
  assert.deepEqual(paymentPlan({ dueDate: "2026-10-30", cashOnDelivery: true }, "2026-10-14", today), { dueDate: "2026-10-30", unpaid: false });
  assert.deepEqual(paymentPlan({ dueDate: null, cashOnDelivery: false }, "2026-10-14", today), { dueDate: null, unpaid: false });
});

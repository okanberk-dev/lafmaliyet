/**
 * Gelen e-faturanın UBL-TR belgesi: kalemler (ürün, miktar, birim, birim fiyat, iskonto, KDV oranı) buradan okunur.
 * Canlı denemeyle doğrulandı (20 Eki 2026): `GET /{firma}/e_invoices/{id}/signed_ubl` imzalı UBL'yi ZIP içinde
 * (`application/zip`, tek .xml) verir; /ubl, /xml, /html uçları yok (404).
 *
 * Tutarlar (UBL-TR 1.2): kalemde LineExtensionAmount = miktar × birim fiyat − kalem iskontoları + kalem artırımları,
 * KDV hariç. Fatura altı iskonto (belge düzeyi AllowanceCharge) kalemlere net tutarlarına oranla dağıtılır; iade
 * faturasında miktar ve tutar eksi yazılır (alınan miktardan düşsün). Saf modül; tests/ubl.test.ts.
 */
import { inflateRawSync } from "node:zlib";

import { XMLParser } from "fast-xml-parser";

import { supplierKey } from "@/server/parasut/mapping";

// GEÇİCİ teşhis kopyası (kalıcı modül: src/server/parasut/ubl.ts)
type LineDraft = { externalId: string; productKey: string; productName: string; description: string | null; quantity: number; unit: string | null; unitPrice: number; discount: number; vatRate: number; netTotal: number };
function eInvoiceProductKey(seller: string, sellerCode: string | null, name: string): string {
  const who = /^\d{10,11}$/.test(seller.trim()) ? seller.trim() : supplierKey(seller) || "x";
  const code = sellerCode?.trim().toLocaleUpperCase("tr-TR");
  return code ? `e:${who}:#${code}` : `e:${who}:${supplierKey(name) || name.trim().toLocaleLowerCase("tr-TR")}`;
}

export interface UblLine {
  id: string;
  name: string;
  description: string | null;
  sellerCode: string | null;
  quantity: number;
  /** UN/ECE birim kodu (C62, KGM, LTR…) */
  unitCode: string | null;
  unitPrice: number;
  /** Kalem iskontoları (artırımlar düşülmüş) */
  discount: number;
  /** KDV hariç, kalem iskontosu sonrası */
  lineTotal: number;
  /** Yüzde (ör. 10) */
  vatRate: number;
}

export interface UblInvoice {
  invoiceNo: string | null;
  uuid: string | null;
  issueDate: string | null;
  typeCode: string | null;
  profileId: string | null;
  currency: string | null;
  supplierName: string | null;
  /** VKN ya da TCKN */
  supplierTaxId: string | null;
  dueDate: string | null;
  /** Fatura altı iskonto (artırımlar düşülmüş) */
  invoiceDiscount: number;
  taxExclusive: number;
  payable: number;
  lines: UblLine[];
}

// ------------------------------------------------------------------ ZIP
const MAX_XML_BYTES = 20 * 1024 * 1024;

/**
 * Paraşüt'ün verdiği ZIP'ten UBL XML'ini çıkarır (yalnız "stored" ve "deflate"; tek dosya beklenir, birden çoksa
 * ilk .xml). Gelen veri zaten XML ise olduğu gibi döner.
 */
export function extractUblXml(data: Buffer): string {
  const head = data.subarray(0, 64).toString("utf8").replace(/^﻿/, "").trimStart();
  if (head.startsWith("<")) return decode(data);
  if (data.readUInt32LE(0) !== 0x04034b50) throw new Error("UBL dosyası ZIP ya da XML değil");

  // Merkez dizin sonu (EOCD): sondan geriye, yorum en çok 64 KB
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP dizini bulunamadı");
  const entries = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  let fallback: { method: number; size: number; offset: number } | null = null;
  for (let n = 0; n < entries; n++) {
    if (data.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP dizini bozuk");
    const method = data.readUInt16LE(p + 10);
    const size = data.readUInt32LE(p + 20);
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    const offset = data.readUInt32LE(p + 42);
    const name = data.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const entry = { method, size, offset };
    if (/\.xml$/i.test(name)) return decode(readEntry(data, entry));
    fallback ??= entry;
  }
  if (fallback) return decode(readEntry(data, fallback));
  throw new Error("ZIP içinde UBL yok");
}

function readEntry(data: Buffer, e: { method: number; size: number; offset: number }): Buffer {
  if (data.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("ZIP kaydı bozuk");
  const start = e.offset + 30 + data.readUInt16LE(e.offset + 26) + data.readUInt16LE(e.offset + 28);
  const raw = data.subarray(start, start + e.size);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_XML_BYTES });
  throw new Error(`ZIP sıkıştırma türü desteklenmiyor (${e.method})`);
}

const decode = (b: Buffer) => b.toString("utf8").replace(/^﻿/, "");

// ------------------------------------------------------------------ UBL
const ARRAYS = new Set(["InvoiceLine", "TaxSubtotal", "AllowanceCharge", "PartyIdentification", "PaymentMeans", "Note", "Description"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Gömülü XSLT ve imza büyük olabilir; içerikleri okunmaz
  stopNodes: ["*.UBLExtensions", "*.Signature", "*.EmbeddedDocumentBinaryObject"],
  isArray: (name) => ARRAYS.has(name),
});

type Node = Record<string, unknown>;
const obj = (v: unknown): Node | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : Array.isArray(v) ? obj(v[0]) : undefined);
const list = (v: unknown): Node[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(obj).filter((x): x is Node => Boolean(x));
/** Öğenin metni (öznitelikli öğede #text) */
function text(v: unknown): string | null {
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  const o = obj(v);
  return o ? text(o["#text"]) : null;
}
const attr = (v: unknown, name: string): string | null => {
  const o = obj(v);
  const a = o?.[`@_${name}`];
  return typeof a === "string" && a.trim() ? a.trim() : null;
};
/** UBL sayıları noktalıdır; virgüllü yazan sağlayıcılar için de denenir */
function amount(v: unknown): number {
  const t = text(v);
  if (!t) return 0;
  const n = Number(/^-?\d+(,\d+)$/.test(t) ? t.replace(",", ".") : t);
  return Number.isFinite(n) ? n : 0;
}
/** Tekrarlanabilen metin öğeleri (Note, Description) */
const texts = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(text).filter((x): x is string => Boolean(x));
const path = (o: Node | undefined, ...keys: string[]): unknown => keys.reduce<unknown>((cur, k) => obj(cur)?.[k], o);
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Artırım (ChargeIndicator true) eksi, iskonto artı */
function discountOf(charges: unknown): number {
  let total = 0;
  for (const c of list(charges)) {
    const isCharge = text(c.ChargeIndicator)?.toLowerCase() === "true";
    total += (isCharge ? -1 : 1) * amount(c.Amount);
  }
  return total;
}

/** KDV oranı: KDV (0015) alt toplamı, yoksa ilk alt toplam */
function vatRateOf(taxTotal: unknown): number {
  const subs = list(path(obj(taxTotal), "TaxSubtotal"));
  const vat = subs.find((t) => text(path(t, "TaxCategory", "TaxScheme", "TaxTypeCode")) === "0015") ?? subs[0];
  if (!vat) return 0;
  const pct = text(vat.Percent);
  if (pct !== null) return amount(vat.Percent);
  const base = amount(vat.TaxableAmount);
  return base ? round2((amount(vat.TaxAmount) / base) * 100) : 0;
}

function partyName(party: Node | undefined): string | null {
  const name = text(path(party, "PartyName", "Name"));
  if (name) return name;
  const first = text(path(party, "Person", "FirstName"));
  const family = text(path(party, "Person", "FamilyName"));
  return [first, family].filter(Boolean).join(" ") || null;
}

function partyTaxId(party: Node | undefined): string | null {
  const ids = list(party?.PartyIdentification).map((p) => ({ scheme: attr(p.ID, "schemeID")?.toUpperCase() ?? "", id: text(p.ID) }));
  return (ids.find((i) => i.scheme === "VKN") ?? ids.find((i) => i.scheme === "TCKN"))?.id ?? null;
}

/** UBL-TR fatura XML'ini okur */
export function parseUbl(xml: string): UblInvoice {
  const doc = parser.parse(xml) as Node;
  const inv = obj(doc.Invoice);
  if (!inv) throw new Error("UBL belgesinde fatura yok");
  const supplier = obj(path(inv, "AccountingSupplierParty", "Party"));
  const due =
    list(inv.PaymentMeans)
      .map((m) => text(m.PaymentDueDate))
      .find(Boolean) ??
    text(path(inv, "PaymentTerms", "PaymentDueDate")) ??
    null;

  const lines: UblLine[] = list(inv.InvoiceLine).map((l, i) => {
    const item = obj(l.Item);
    const quantity = amount(l.InvoicedQuantity);
    const unitPrice = amount(path(l, "Price", "PriceAmount"));
    const discount = discountOf(l.AllowanceCharge);
    const lineExt = text(l.LineExtensionAmount) !== null ? amount(l.LineExtensionAmount) : quantity * unitPrice - discount;
    const descriptions = texts(item?.Description);
    const notes = texts(l.Note);
    const name = text(item?.Name) ?? descriptions[0] ?? `Kalem ${text(l.ID) ?? i + 1}`;
    const description = [...new Set([...descriptions, ...notes])].filter((d) => d !== name).join(" · ") || null;
    return {
      id: text(l.ID) ?? String(i + 1),
      name: name.replace(/\s+/g, " "),
      description,
      sellerCode: text(path(item, "SellersItemIdentification", "ID")),
      quantity,
      unitCode: attr(l.InvoicedQuantity, "unitCode"),
      unitPrice,
      discount: round2(discount),
      lineTotal: round2(lineExt),
      vatRate: vatRateOf(l.TaxTotal),
    };
  });

  const totals = obj(inv.LegalMonetaryTotal);
  return {
    invoiceNo: text(inv.ID),
    uuid: text(inv.UUID),
    issueDate: text(inv.IssueDate)?.slice(0, 10) ?? null,
    typeCode: text(inv.InvoiceTypeCode)?.toUpperCase() ?? null,
    profileId: text(inv.ProfileID),
    currency: text(inv.DocumentCurrencyCode)?.toUpperCase() ?? null,
    supplierName: partyName(supplier),
    supplierTaxId: partyTaxId(supplier),
    dueDate: due?.slice(0, 10) ?? null,
    invoiceDiscount: round2(discountOf(inv.AllowanceCharge)),
    taxExclusive: amount(totals?.TaxExclusiveAmount),
    payable: amount(totals?.PayableAmount),
    lines,
  };
}

/** UN/ECE birim kodları → panelde okunan birim (bilinmeyen kod olduğu gibi kalır) */
const UNIT_NAMES: Record<string, string> = {
  C62: "Adet",
  NIU: "Adet",
  H87: "Adet",
  EA: "Adet",
  KGM: "kg",
  GRM: "gr",
  LTR: "lt",
  MLT: "ml",
  MTR: "m",
  MTK: "m²",
  BX: "Kutu",
  CS: "Koli",
  CT: "Koli",
  PA: "Paket",
  PK: "Paket",
  PR: "Çift",
  SET: "Set",
  KT: "Set",
  TNE: "ton",
  DZN: "Düzine",
  BG: "Torba",
  BO: "Şişe",
  CA: "Teneke",
  TU: "Tüp",
  ROL: "Rulo",
  RO: "Rulo",
  HUR: "Saat",
  DAY: "Gün",
  MON: "Ay",
};

export function unitName(code: string | null): string | null {
  if (!code) return null;
  return UNIT_NAMES[code.toUpperCase()] ?? code;
}

/** İade faturası mı (kalemler alınan miktardan düşer) */
const isRefund = (typeCode: string | null) => typeCode === "IADE";

/**
 * UBL kalemlerini panel kalemlerine çevirir. Ürün anahtarı tedarikçinin vergi numarası + satıcı ürün kodu (yoksa ad):
 * aynı tedarikçinin aynı ürünü her faturada aynı anahtarla gelir, hammaddeye bir kez bağlamak yeter.
 */
export function ublLinesToDrafts(inv: UblInvoice, eInvoiceId: string, fallbackSupplier: string): LineDraft[] {
  const sign = isRefund(inv.typeCode) ? -1 : 1;
  const seller = inv.supplierTaxId ?? fallbackSupplier;
  const lines = inv.lines.filter((l) => l.quantity !== 0 || l.lineTotal !== 0);
  // Fatura altı iskonto kalemlere oranla dağıtılır (birim maliyet doğru çıksın)
  const lineSum = lines.reduce((s, l) => s + l.lineTotal, 0);
  const k = inv.invoiceDiscount > 0 && lineSum > inv.invoiceDiscount ? (lineSum - inv.invoiceDiscount) / lineSum : 1;
  // Satıcı kodu ancak kalemleri ayırıyorsa kullanılır (bazı sağlayıcılar her kaleme aynı kodu yazar)
  const namesByCode = new Map<string, Set<string>>();
  for (const l of lines) if (l.sellerCode) namesByCode.set(l.sellerCode, (namesByCode.get(l.sellerCode) ?? new Set()).add(l.name.toLocaleLowerCase("tr-TR")));
  const usableCode = (code: string | null) => (code && code.trim().length >= 2 && namesByCode.get(code)!.size === 1 ? code : null);
  const seen = new Map<string, number>();
  return lines.map((l) => {
    // Aynı kalem numarası iki kez gelirse (bozuk belge) ikinci kayıt ezilmesin
    const n = (seen.get(l.id) ?? 0) + 1;
    seen.set(l.id, n);
    const net = l.lineTotal * k;
    return {
      externalId: `ubl:${eInvoiceId}:${l.id}${n > 1 ? `#${n}` : ""}`,
      productKey: eInvoiceProductKey(seller, usableCode(l.sellerCode), l.name),
      productName: l.name,
      description: l.description,
      quantity: round4(sign * l.quantity),
      unit: unitName(l.unitCode),
      unitPrice: round2(l.unitPrice),
      discount: round2(l.discount + (l.lineTotal - net)),
      vatRate: l.vatRate,
      netTotal: round2(sign * net),
    };
  });
}

/** Kalemlerin toplamı faturanın KDV hariç tutarını tutuyor mu (tutmuyorsa kalemler yine yazılır, notta belirtilir) */
export function ublLinesMatchTotal(inv: UblInvoice): boolean {
  if (!inv.taxExclusive) return true;
  const sum = inv.lines.reduce((s, l) => s + l.lineTotal, 0) - inv.invoiceDiscount;
  return Math.abs(sum - inv.taxExclusive) <= Math.max(1, Math.abs(inv.taxExclusive) * 0.005);
}

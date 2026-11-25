/**
 * Paraşüt gider faturası (purchase_bill) → panel faturası eşlemesi. Saf fonksiyonlar; tests/parasut.test.ts.
 *
 * Tutarlar (Paraşüt API v4): gross_total iskonto ve vergiler öncesi brüt, total_discount + total_invoice_discount
 * iskontolar, total_vat KDV, net_total KDV dahil genel toplamdır. Her faturada şu eşitlik sınanır:
 *   net ≈ brüt − iskontolar + KDV + ÖTV + ÖİV
 * Tutarsa maliyet (KDV hariç) = net − KDV. Tutmazsa net'in KDV hariç olduğu durum, sonra ödenmemiş faturada
 * "kalan = net" denenir; hiçbiri tutmazsa net KDV dahil sayılır. Döviz faturaları exchange_rate ile TL'ye çevrilir.
 * Fatura altı iskonto kalemlerin net tutarına oranla dağıtılır (birim maliyet doğru çıksın).
 */

import { cleanTaxNumber, taxKey } from "@/app/panel/tedarikciler/logic";
import { dateTR } from "@/lib/format";
import { INVOICE_SOURCE_PHRASE } from "@/lib/import-labels";

import { dec, indexIncluded, relMany, relOne, str, type Resource } from "./jsonapi";

export interface LineDraft {
  externalId: string;
  productKey: string;
  productName: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  discount: number;
  vatRate: number;
  netTotal: number;
}

export interface BillDraft {
  externalId: string;
  itemType: string;
  archived: boolean;
  date: string;
  dueDate: string | null;
  supplier: string;
  /** Paraşüt kişi/kurum kimliği; tedarikçi "included"da gelmezse adı ayrıca okunur */
  supplierId: string | null;
  /** Ad gerçekten Paraşüt kişi kaydından mı geldi (açıklamadan tahmin değil) */
  supplierResolved: boolean;
  supplierTaxNo: string | null;
  description: string | null;
  invoiceNo: string | null;
  /** KDV hariç, iskonto öncesi (panelde amount − discount = KDV hariç maliyet) */
  amount: number;
  /** Kalem + fatura altı iskontolar */
  discount: number;
  vat: number;
  /** KDV dahil ödenecek */
  payable: number;
  /** Kalan borç (TL); ödenmişse 0 */
  outstanding: number;
  unpaid: boolean;
  parasutCategory: string | null;
  updatedAt: string | null;
  lines: LineDraft[];
  /** Paraşüt'teki e-belge bağı (`active_e_document`): e-fatura PDF'i buradan alınır; e-fatura eşitlemesi aynı kaydı tanır */
  eDocument: { type: string; id: string } | null;
  /**
   * E-belgedeki satıcı vergi nosu (`active_e_document` include edildiyse `from_vkn`): imzalı belgedeki numara, kişi
   * kartındakinden (`supplierTaxNo`) önce gelir
   */
  eDocumentTaxNo: string | null;
  /** Kişi kartının türü (`account_type`: "supplier" | "customer"); kart okunamadıysa null */
  contactType: string | null;
  /** Bütün kalemler laffogato.net'in Paraşüt ürünleri (SITE_PRODUCT_CODE): satış faturasından açılmış iade */
  siteProducts: boolean;
  /** Bağlı gelen e-belgenin türü (`invoice_type_code`, büyük harf: "SATIS", "IADE"…); yoksa ya da giden belgede null */
  eDocumentKind: string | null;
  /**
   * Döviz faturasında kur okunamadı (`exchange_rate` yok ya da 0): para birimi ("USD"). Tutarlar kur 1 sayılarak yazılır,
   * kayıt kontrol bekler (FC-05; missingRateNote). TL faturada ve kur geldiyse null
   */
  missingRate: string | null;
}

/** Kuru okunamayan döviz faturasının notu (kayıt kontrol bekler) */
export const missingRateNote = (currency: string) => `${currency} faturası: döviz kuru okunamadı, tutarı kontrol edin`;

/**
 * Sitenin (laffogato.net e-Arşiv / e-Fatura) Paraşüt'te açtığı ürünlerin kodu, alış faturasında bulunmaz: LAF-<grup>-<KDV
 * oranı> (KAFE, MAGAZA, TESLIMAT, HIZMET; karaoke'nin eski kodu LAF-KARAOKE-20). Yalnız bu biçim: muhasebecinin kendi
 * "LAF-…" kodlu ürünleri (ör. LAF-SUT-1L) sitenin ürünü sayılsaydı o alış faturaları sessizce gider dışı kalırdı
 */
export const SITE_PRODUCT_CODE = /^LAF-(KAFE|MAGAZA|TESLIMAT|HIZMET|KARAOKE)-\d{1,3}$/i;
/** Gelen iade e-faturası: GİB kuralıyla iadeyi malı geri veren alıcı keser, gelen iade kafenin sattığı bir malındır */
export const RETURN_DOC_TYPES: readonly string[] = ["IADE", "TEVKIFATIADE"];
/** Panele gider olarak girmeyen satış iadesinin nedeni (eşitleme özeti, bağlı kaydın notu) */
export const SALES_RETURN = "satış iadesi";

/**
 * Bu gider faturası aslında bir satış iadesi mi (docs/PARASUT.md §2a). Paraşüt bir satış faturasına karşı kesilen
 * iadeyi Giderler'e yazar: sitenin faturaladığı bir siparişin iadesi gider faturası olarak gelir, müşteri tedarikçi
 * olurdu. İşaretler: kalemlerin hepsi sitenin ürünü (LAF-KAFE-10 gibi), bağlı gelen e-belge iade türünde ya da iade
 * faturasının kişisi müşteri kartı. Tedarikçi kartlı iade faturası eskisi gibi eksi gider sayılır.
 */
export function isSalesReturn(d: Pick<BillDraft, "itemType" | "contactType" | "siteProducts" | "eDocumentKind">): boolean {
  if (d.siteProducts) return true;
  if (d.eDocumentKind && RETURN_DOC_TYPES.includes(d.eDocumentKind)) return true;
  return d.itemType === "refund" && d.contactType === "customer";
}

/**
 * Müşteri kartıyla girilmiş (iade türünde olmayan) gider faturası: gerçek bir alış da olabilir, elle girilmiş bir satış
 * iadesi (gider pusulası) de. Sessizce atılmaz; yeni kayıt kontrol bekleyen açılır, notu bunu söyler.
 */
export const CUSTOMER_CONTACT_NOTE = "Paraşüt'te müşteri kartıyla girilmiş: satış iadesiyse silin";
export const customerContactBill = (d: Pick<BillDraft, "itemType" | "contactType" | "siteProducts" | "eDocumentKind">) => d.contactType === "customer" && !isSalesReturn(d);

/** Komisyon faturası kesen platformlar (Excel aktarımındaki listeyle aynı) */
export const COMMISSION_SUPPLIERS = ["Trendyol", "Set Kart", "Pluxee", "Yemek Sepeti", "Multinet", "Edenred", "Metropol", "Getir", "Migros Yemek"];

/** Şirket türü ekleri ve bağlaçlar karşılaştırmada yok sayılır */
const STOP = new Set(["as", "ltd", "sti", "san", "tic", "ve", "limited", "sirketi", "anonim", "ticaret", "sanayi", "ltdsti"]);

const norm = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t))
    .join(" ");

/** Tedarikçi adını karşılaştırma için sadeleştirir ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş." ~ "Sütaş") */
export function supplierKey(name: string): string {
  return norm(name.replace(/\s*\(.*\)\s*$/, ""));
}

/**
 * Gider faturası kaleminin ürün anahtarı: Paraşüt ürününün kimliği (p:…), ürünsüz kalemde sadeleştirilmiş ad (d:…).
 * `ns`: hesabın öneki (src/lib/parasut/accounts.ts accountNs): varsayılan hesapta boş (p:123), öbürlerinde p:marina:123;
 * iki firmanın ürün kimlikleri çakışsa da hammadde bağlantısı karışmasın. Ada dayalı anahtar firmadan bağımsızdır
 */
export function productKeyFor(productId: string | null, name: string, ns = ""): string {
  return productId ? `p:${ns}${productId}` : `d:${norm(name)}`;
}

/**
 * E-fatura (UBL) kaleminin ürün anahtarı: tedarikçinin vergi numarası (yoksa sadeleştirilmiş adı) + satıcının ürün
 * kodu, kod yoksa sadeleştirilmiş ürün adı. Aynı tedarikçinin aynı ürünü her faturada aynı anahtarla gelir.
 */
export function eInvoiceProductKey(seller: string, sellerCode: string | null, name: string): string {
  const who = /^\d{10,11}$/.test(seller.trim()) ? seller.trim() : supplierKey(seller) || "x";
  const code = sellerCode?.trim().toLocaleUpperCase("tr-TR");
  return code ? `e:${who}:#${code}` : `e:${who}:${norm(name) || name.trim().toLocaleLowerCase("tr-TR")}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Paraşüt gider faturası → taslak. `ns`: hesabın öneki (kalem kimliği ve ürün anahtarı; varsayılan hesapta boş) */
export function billToDraft(bill: Resource, included: Resource[] | undefined, ns = ""): BillDraft {
  const a = bill.attributes as Record<string, unknown>;
  const index = indexIncluded(included);
  const supplier = relOne(bill, "supplier", index);
  const category = relOne(bill, "category", index);
  const details = relMany(bill, "details", index);
  const eDoc = relOne(bill, "active_e_document", index);

  const currency = (str(a.currency) ?? "TRL").toUpperCase();
  const foreign = currency !== "TRL" && currency !== "TRY";
  const fx = foreign ? dec(a.exchange_rate) : 1;
  // Kur gelmediyse (yok, 0) tutar kur 1 sayılır ama sessizce TL'ye dönmez: kayıt kontrol bekler (FC-05)
  const rate = fx > 0 ? fx : 1;

  let siteLines = 0;
  const lines: LineDraft[] = details.map((d) => {
    const da = d.attributes as Record<string, unknown>;
    const product = relOne(d, "product", index);
    const pa = (product?.attributes ?? {}) as Record<string, unknown>;
    const code = str(pa.code);
    if (code && SITE_PRODUCT_CODE.test(code)) siteLines++;
    const name = str(pa.name) ?? str(da.description) ?? "Kalem";
    const qty = dec(da.quantity);
    const unitPrice = dec(da.unit_price) * rate;
    const discountValue = dec(da.discount_value);
    const discount = str(da.discount_type) === "percentage" ? (qty * unitPrice * discountValue) / 100 : discountValue * rate;
    const net = da.net_total !== undefined ? dec(da.net_total) * rate : qty * unitPrice - discount;
    return {
      externalId: `${ns}${d.id}`,
      productKey: productKeyFor(product?.id ?? null, name, ns),
      productName: name,
      description: str(da.description),
      quantity: qty,
      unit: str(pa.unit) ?? str(da.unit),
      unitPrice: round2(unitPrice),
      discount: round2(discount),
      vatRate: dec(da.vat_rate),
      netTotal: round2(net),
    };
  });

  const gross = dec(a.gross_total) * rate;
  const vat = dec(a.total_vat) * rate;
  const net = dec(a.net_total) * rate;
  const discounts = (dec(a.total_discount) + dec(a.total_invoice_discount)) * rate;
  const otherTax = (dec(a.total_excise_duty) + dec(a.total_communications_tax)) * rate;
  // KDV tevkifatı: alıcı KDV'nin bir kısmını kendisi öder; tedarikçiye ödenecek tutardan düşer, maliyeti değiştirmez
  const withholding = dec(a.total_vat_withholding) * rate;
  const remainingRaw = a.remaining_in_trl !== undefined ? dec(a.remaining_in_trl) : dec(a.remaining) * rate;
  const tol = (x: number) => 0.05 + Math.abs(x) * 0.0005;
  let cost: number; // KDV hariç, iskontolar düşülmüş
  let payable: number; // KDV dahil
  if (gross && Math.abs(gross - discounts + vat + otherTax - net) < tol(net)) {
    cost = net - vat;
    payable = net;
  } else if (gross && withholding && Math.abs(gross - discounts + vat - withholding + otherTax - net) < tol(net)) {
    cost = gross - discounts + otherTax;
    payable = net;
  } else if (gross && Math.abs(gross - discounts + otherTax - net) < tol(net)) {
    // net KDV hariç gelmiş
    cost = net;
    payable = net + vat;
  } else if (remainingRaw > 0 && Math.abs(remainingRaw - net - vat) < tol(net)) {
    cost = net;
    payable = net + vat;
  } else {
    cost = net - vat;
    payable = net;
  }
  const itemType = str(a.item_type) ?? "purchase_bill";
  const sign = itemType === "refund" ? -1 : 1;
  // İade faturasının kalemleri alınan miktardan düşülür
  if (sign < 0) for (const l of lines) {
    l.quantity = -l.quantity;
    l.netTotal = -l.netTotal;
  }
  // Fatura altı iskonto kalemlere oranla dağıtılır
  const invoiceDiscount = dec(a.total_invoice_discount) * rate;
  const lineSum = Math.abs(lines.reduce((s, l) => s + l.netTotal, 0));
  if (invoiceDiscount > 0 && lineSum > invoiceDiscount) {
    const k = (lineSum - invoiceDiscount) / lineSum;
    for (const l of lines) l.netTotal = round2(l.netTotal * k);
  }

  const status = str(a.payment_status);

  return {
    externalId: bill.id,
    itemType,
    archived: a.archived === true,
    date: (str(a.issue_date) ?? "").slice(0, 10),
    dueDate: str(a.due_date)?.slice(0, 10) ?? null,
    supplier: str((supplier?.attributes as Record<string, unknown> | undefined)?.name) ?? str(a.description) ?? "Paraşüt tedarikçisi",
    supplierResolved: Boolean(str((supplier?.attributes as Record<string, unknown> | undefined)?.name)),
    supplierId: (() => {
      const r = bill.relationships?.supplier?.data;
      return r && !Array.isArray(r) ? r.id : null;
    })(),
    supplierTaxNo: str((supplier?.attributes as Record<string, unknown> | undefined)?.tax_number),
    eDocument: (() => {
      const r = bill.relationships?.active_e_document?.data;
      return r && !Array.isArray(r) ? { type: r.type, id: r.id } : null;
    })(),
    eDocumentTaxNo: eDocumentTaxNo(eDoc),
    contactType: str((supplier?.attributes as Record<string, unknown> | undefined)?.account_type)?.toLowerCase() ?? null,
    siteProducts: lines.length > 0 && siteLines === lines.length,
    eDocumentKind: eDocumentKind(eDoc),
    missingRate: foreign && !(fx > 0) ? currency : null,
    description: str(a.description),
    invoiceNo: str(a.invoice_no) ?? str(a.invoice_id),
    // İadede iskonto pozitif kalır (amount − discount = eksi maliyet; fatura formu negatif iskontoyu kabul etmez)
    amount: round2(sign * cost + discounts),
    discount: round2(discounts),
    vat: round2(sign * vat),
    payable: round2(sign * payable),
    outstanding: round2(sign > 0 ? Math.max(0, remainingRaw) : 0),
    unpaid: sign > 0 && (remainingRaw > 0.009 || status === "unpaid" || status === "overdue" || status === "partially_paid"),
    parasutCategory: str((category?.attributes as Record<string, unknown> | undefined)?.name),
    updatedAt: str(a.updated_at),
    lines,
  };
}

// ---------------------------------------------------------------- Tedarikçinin vergi nosu (invoices.supplier_tax_number)

/**
 * Gider faturasının e-belgesindeki satıcı vergi nosu (`from_vkn`), yalnız gelen e-faturada. Giden bir belgede
 * `from_vkn` işletmenin kendi numarası olurdu (aynı Paraşüt şirketinde sitenin satış faturaları da kesiliyor) ve
 * bütün tedarikçileri tek firmada toplardı.
 */
function eDocumentTaxNo(doc: Resource | null): string | null {
  if (doc?.type !== "e_invoices") return null;
  const a = doc.attributes as Record<string, unknown>;
  const direction = str(a.direction)?.toLowerCase();
  return direction && direction !== "inbound" ? null : str(a.from_vkn);
}

/** Bağlı gelen e-belgenin türü (`invoice_type_code`); giden belgede ya da tür yoksa null */
function eDocumentKind(doc: Resource | null): string | null {
  if (doc?.type !== "e_invoices") return null;
  const a = doc.attributes as Record<string, unknown>;
  const direction = str(a.direction)?.toLowerCase();
  if (direction && direction !== "inbound") return null;
  return str(a.invoice_type_code)?.toUpperCase() ?? null;
}

/**
 * Faturada saklı tedarikçi vergi nosunun yeni değeri; null: değişiklik yok. Boş kayda gelen numara yazılır. E-fatura
 * (imzalı belgedeki `from_vkn`) her zaman geçer. Gider faturasının kişi kartındaki numara e-faturaya bağlı kaydın
 * numarasını ezmez; e-faturasız kayıtta yazılır (kişi kartı Paraşüt'te düzeltilmiş olabilir). Boş ya da 10/11 hane
 * olmayan numara yazılmaz.
 */
export function nextTaxNumber(
  stored: string | null,
  incoming: string | null | undefined,
  opts: { from: "bill" | "einvoice"; hasEInvoice: boolean },
): string | null {
  const t = cleanTaxNumber(incoming);
  if (!t || t === stored) return null;
  if (!stored || opts.from === "einvoice") return t;
  return opts.hasEInvoice ? null : t;
}

// ---------------------------------------------------------------- Tedarikçinin kişi kartı (contacts)

/**
 * Paraşüt'teki kişi kartı (contacts: name, tax_number, tax_office, address, district, city, phone, email, iban) →
 * cari bilgileri. Tedarikçiler › Faturadan doldur, e-fatura belgesinde olmayan alanları buradan tamamlar.
 */
export function contactInfo(a: Record<string, unknown>): {
  legalName: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  iban: string | null;
  bankName: string | null;
} {
  const place = [str(a.postal_code), [str(a.district), str(a.city)].filter(Boolean).join("/")].filter(Boolean).join(" ");
  const country = str(a.country);
  const foreign = country && !/^t[üu]rk[iı]ye$|^turkey$|^tr$/i.test(country) ? country : null;
  return {
    legalName: str(a.name),
    taxNumber: str(a.tax_number),
    taxOffice: str(a.tax_office),
    address: [str(a.address), place, foreign].filter(Boolean).join(", ") || null,
    phone: str(a.phone),
    email: str(a.email),
    iban: str(a.iban),
    bankName: null,
  };
}

// ---------------------------------------------------------------- Ödeme durumu (docs/TEDARIKCILER.md)

/** Panelin ödeme alanları (yeni açılan faturada) */
export interface NewInvoicePayment {
  unpaid: boolean;
  paidAt: string | null;
  paidVia: "havale" | "nakit" | "kart" | "cek" | "diger" | null;
}

/**
 * Eşitlemenin açtığı yeni faturanın ödeme durumu. Ödendiğini kullanıcı işaretler: fatura "ödenmedi" gelir (Paraşüt'ün
 * bildirdiği yalnız ipucu olarak parasutUnpaid'e yazılır). İade (eksi) faturası ödenmez. Komisyon faturası
 * (`commission`: Trendyol, Yemek Sepeti, yemek kartları) ödenmez, platformun hakedişinden düşülür: ödendi gelir
 * (fatura günü). Peşin çalışılan tedarikçinin (`onDelivery`, kartta "Faturaları ödendi gelsin") faturası da ödendi
 * gelir: fatura günü, kartın ödeme şekliyle. Takip başlamadan (`since`) önceki fatura geçmişi yeniden alırken gelir:
 * Paraşüt'ün bildirdiği durumla açılır (`parasutUnpaid`; e-faturada bilgi yok, null: ödendi), yoksa eski faturalar
 * "ödenmedi" yığılırdı.
 */
export function newInvoicePayment(
  d: { payable: number; date: string; parasutUnpaid: boolean | null; commission: boolean },
  onDelivery: { paymentMethod: NewInvoicePayment["paidVia"] } | null,
  since: string,
): NewInvoicePayment {
  if (d.payable <= 0) return { unpaid: false, paidAt: null, paidVia: null };
  if (d.commission) return { unpaid: false, paidAt: d.date, paidVia: null };
  if (onDelivery) return { unpaid: false, paidAt: d.date, paidVia: onDelivery.paymentMethod };
  if (d.date < since) return { unpaid: d.parasutUnpaid ?? false, paidAt: null, paidVia: null };
  return { unpaid: true, paidAt: null, paidVia: null };
}

/**
 * Bu fatura panele alınmalı mı. İptal ve tekrarlayan şablonlar alınmaz; arşivlenmiş fatura (Paraşüt'te yalnızca
 * listeden gizlenmiş) geçerli bir giderdir ve alınır. Satış iadesi (isSalesReturn) tedarikçi faturası değildir.
 */
export function shouldImport(d: BillDraft): { ok: true } | { ok: false; reason: string } {
  if (d.itemType === "cancelled") return { ok: false, reason: "iptal" };
  if (d.itemType.startsWith("recurring")) return { ok: false, reason: "tekrarlayan şablon" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { ok: false, reason: "tarihsiz" };
  if (isSalesReturn(d)) return { ok: false, reason: SALES_RETURN };
  return { ok: true };
}

export interface CategoryRule {
  matchType: "supplier" | "parasut_category" | "keyword";
  pattern: string;
  category: string;
  priority: number;
}

/**
 * Paraşüt kategori adından ve kalem adlarından panel kategorisi (son çare). Sadeleştirilmiş metinde (küçük harf,
 * Türkçe işaretsiz) tam kelime ya da kelime başı eşleşir; reklam/hizmet kuralları gıda kurallarından önce gelir.
 */
const CATEGORY_HINTS: [RegExp, string][] = [
  [/\b(komisyon|yemek karti|platform)/, "Komisyon"],
  [/\b(reklam|tabela|baski|matbaa|sosyal medya|afis|brosur)/, "Reklam & Tabela"],
  [/\b(kira(?!z)\w*|aidat\w*|avm|ortak alan)/, "Kira & AVM"],
  [/\b(yazilim|pos|abonelik|internet|bilisim|telekom|lisans)\b/, "Yazılım & POS"],
  [/\b(demirbas|makine|ekipman|mobilya|tadilat|kurulus)/, "Kuruluş & Demirbaş"],
  [/\b(hizmet|danisman|muhasebe|temizlik|lojistik|kargo|bakim|ilaclama)/, "Hizmet"],
  [/\b(ambalaj|bardak|kapak|pipet|pecete|poset|karton)/, "Ambalaj"],
  [/\b(tatli\w*|pasta\w*|kek(ler|i|leri)?\b|cheesecake|hazir\w*|tiramisu|kurabiye\w*|brownie)/, "Tatlı & Hazır Ürün"],
  [/\b(gida\w*|hammadde\w*|icecek\w*|kahve\w*|sut\w*|surub\w*|surup\w*|meyve\w*|sos(u|lu|lar|lari)?\b|espresso\w*|cikolata\w*|vanilya\w*|krema\w*|seker\w*|dondurma\w*)/, "Hammadde & İçecek"],
];

/**
 * Kategori seçimi, sırasıyla: elle yazılmış kurallar → aynı tedarikçinin geçmiş faturaları →
 * komisyon platformları → Paraşüt kategori adı ve açıklamadaki ipuçları → "Diğer".
 */
export function pickCategory(
  d: Pick<BillDraft, "supplier" | "description" | "parasutCategory"> & { lines: Pick<LineDraft, "productName">[] },
  rules: CategoryRule[],
  history: Map<string, string>,
  allowed: readonly string[],
): { category: string; reason: string } {
  const sk = supplierKey(d.supplier);
  const text = norm([d.supplier, d.description ?? "", d.parasutCategory ?? "", ...d.lines.map((l) => l.productName)].join(" "));
  for (const r of [...rules].sort((x, y) => x.priority - y.priority)) {
    if (!allowed.includes(r.category)) continue;
    const p = norm(r.pattern);
    if (!p) continue;
    if (r.matchType === "supplier" && (sk === p || sk.includes(p))) return { category: r.category, reason: `kural: tedarikçi “${r.pattern}”` };
    if (r.matchType === "parasut_category" && d.parasutCategory && norm(d.parasutCategory) === p) return { category: r.category, reason: `kural: Paraşüt kategorisi “${r.pattern}”` };
    if (r.matchType === "keyword" && text.includes(p)) return { category: r.category, reason: `kural: “${r.pattern}”` };
  }
  const past = history.get(sk);
  if (past && allowed.includes(past)) return { category: past, reason: "tedarikçinin önceki faturaları" };
  const isPlatform = COMMISSION_SUPPLIERS.some((c) => {
    const k = norm(c);
    // "Metropol" yemek kartı ≠ "Metropol İstanbul AVM": devamında mekân/kira sözcüğü varsa platform sayılmaz
    return sk === k || (sk.startsWith(`${k} `) && !/\b(avm|kira|alisveris|merkezi|plaza|residence)\b/.test(sk));
  });
  if (isPlatform && allowed.includes("Komisyon")) {
    return { category: "Komisyon", reason: "komisyon platformu" };
  }
  const hintText = norm([d.parasutCategory ?? "", d.description ?? "", ...d.lines.map((l) => l.productName)].join(" "));
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(hintText) && allowed.includes(cat)) return { category: cat, reason: "Paraşüt kategorisi / kalem adları" };
  return { category: allowed.includes("Diğer") ? "Diğer" : allowed[allowed.length - 1], reason: "eşleşme yok" };
}

const NO_MATCH_NOTE = "kategori: eşleşme yok";

/**
 * E-faturadan kalemsiz açılıp "eşleşme yok" kalan kaydın kategorisi, belge okununca kalem adlarıyla yeniden denenir
 * (anahtar kelime kuralları ve ipuçları; tedarikçi geçmişi açılışta zaten denendi). Yalnız eşitlemenin açtığı, hâlâ
 * kontrol bekleyen kayıtta: kullanıcının değiştirdiği ya da onayladığı kategoriye dokunulmaz. Yeni eşleşme yoksa null.
 */
export function recategorizeFromLines(
  row: { origin: string; needsReview: boolean; supplier: string; category: string; note: string | null },
  lines: Pick<LineDraft, "productName">[],
  rules: CategoryRule[],
  allowed: readonly string[],
): { category: string; note: string; reason: string } | null {
  if (row.origin !== "parasut" || !row.needsReview || !lines.length || !row.note?.includes(NO_MATCH_NOTE)) return null;
  const pick = pickCategory({ supplier: row.supplier, description: null, parasutCategory: null, lines }, rules, new Map(), allowed);
  if (pick.reason === "eşleşme yok") return null;
  return { category: pick.category, note: row.note.replace(NO_MATCH_NOTE, `kategori: ${pick.reason}`), reason: pick.reason };
}

/**
 * Tedarikçi geçmişine katılan fatura: kaydı eşitleme açmadıysa (Excel, elle) ya da eşitlemenin açtığı kayıt kontrol
 * edilmişse (onaylanmış, kategorisi elle değiştirilmiş ya da kurala, geçmişe dayanan). Kontrol bekleyen tahminler
 * katılmaz: yanlış bir tahmin kendini çoğaltmasın.
 */
export const feedsSupplierHistory = (i: { origin: string; needsReview: boolean }) => i.origin !== "parasut" || !i.needsReview;

/** En sık kategori (tedarikçi geçmişi) */
export function supplierHistory(invoices: { supplier: string; category: string }[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const inv of invoices) {
    const k = supplierKey(inv.supplier);
    const m = counts.get(k) ?? new Map<string, number>();
    m.set(inv.category, (m.get(inv.category) ?? 0) + 1);
    counts.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of counts) out.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

export interface ExistingInvoice {
  id: number;
  externalId: string | null;
  invoiceNo: string | null;
  supplier: string;
  date: string;
  payable: number;
  /** Tedarikçinin vergi nosu (Paraşüt'ten gelmişse; elle ve Excel'le girilende yok) */
  supplierTaxNumber?: string | null;
}

/** Eşleştirilen belgenin tedarikçisi: ad ve (biliniyorsa) vergi no */
type Issuer = { supplier?: string; taxNumber?: string | null };

/** Faturanın Tedarikçiler kartı (cardResolver: ad ve diğer adlar önce, sonra vergi no); kartsızsa null */
export type CardOf = (supplier: string, taxNumber?: string | null) => number | null;

const invNo = (s: string | null) => (s ? s.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "");

/** İki tedarikçi adı aynı firmayı mı gösteriyor: anahtarlar eşit ya da biri ötekinin baştaki tam kelimeleri */
export function sameSupplier(a: string, b: string): boolean {
  const ka = supplierKey(a);
  const kb = supplierKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return short.length >= 3 && long.startsWith(`${short} `);
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * GİB e-Arşiv portalının numarası (GIB + yıl + sıra): portalı kullanan bütün küçük tedarikçilerde aynı biçimde, iki
 * ustanın 12. faturası aynı numarayı taşır. Tek başına kimlik değildir (FC-03)
 */
const isGibPortalNo = (invoiceNo: string | null) => invNo(invoiceNo).startsWith("GIB");

/** Tam e-fatura/e-arşiv numarası (3 harf/rakam + 13 rakam; ayraçsız, büyük harf) mı */
const isFullEInvoiceNo = (no: string) => /^[A-Z0-9]{3}\d{13}$/.test(no);

/** Aynı tam numara, ±31 gün ve aynı tarih ya da tutar (±1 ₺) */
const sameEInvoiceNo = (e: ExistingInvoice, d: Pick<BillDraft, "date" | "payable">, no: string) =>
  invNo(e.invoiceNo) === no && dayDiff(e.date, d.date) <= 31 && (e.date === d.date || Math.abs(Math.abs(e.payable) - Math.abs(d.payable)) <= 1);

/**
 * Aynı tedarikçi mi: ad (sameSupplier), geçerli vergi no ya da ikisi Tedarikçiler'de aynı karta düşüyor (`cardOf`: kartın
 * adı, diğer adları, vergi nosu). Elle ve Excel'le girilen kayıtta vergi no yoktur; adı farklı yazılmış aynı usta kartla
 * tanınır
 */
function sameIssuer(e: Pick<ExistingInvoice, "supplier" | "supplierTaxNumber">, d: Issuer, cardOf?: CardOf): boolean {
  if (d.supplier && sameSupplier(e.supplier, d.supplier)) return true;
  const tax = taxKey(d.taxNumber);
  if (tax !== null && tax === taxKey(e.supplierTaxNumber)) return true;
  if (!cardOf) return false;
  const card = cardOf(d.supplier ?? "", d.taxNumber);
  return card !== null && card === cardOf(e.supplier, e.supplierTaxNumber);
}

/**
 * Tam e-fatura/e-arşiv numarası (3 harf/rakam + 13 rakam) güçlü bir kimliktir; tedarikçi adı farklı yazılmış olabilir
 * (Yemek Sepeti ~ YEMEKSEPETİ ELEKTRONİK). Ortak önek riskine karşı ±31 gün ve aynı tarih ya da tutar (±1 ₺) da
 * bakılır. GİB portalının numarası (GIB…) mükellefler arasında çakışır: onda tedarikçi de aynı olmalı (sameIssuer: ad,
 * vergi no ya da Tedarikçiler kartı); öteki numaralarda tedarikçi adına bakılmaz.
 */
export function findByEInvoiceNo<T extends ExistingInvoice>(d: Pick<BillDraft, "invoiceNo" | "date" | "payable"> & Issuer, existing: T[], cardOf?: CardOf): T | null {
  const no = invNo(d.invoiceNo);
  if (!isFullEInvoiceNo(no)) return null;
  const portal = isGibPortalNo(no);
  return existing.find((e) => sameEInvoiceNo(e, d, no) && (!portal || sameIssuer(e, d, cardOf))) ?? null;
}

/**
 * Yeni açılacak kaydın GİB portalı numarası bağsız (elle girilmiş ya da içe aktarılmış) bir kayıtta da var (±31 gün, aynı tarih ya
 * da tutar) ama tedarikçi tutmadı (findByEInvoiceNo bağlamadı): başka ustanın aynı numarası da olabilir, adı başka
 * yazılmış aynı fatura da. Yeni kayıt açılır ama kontrol bekler (gibNoClashNote); yoksa null
 */
export function gibNoClash<T extends ExistingInvoice>(d: Pick<BillDraft, "invoiceNo" | "date" | "payable">, existing: T[]): T | null {
  const no = invNo(d.invoiceNo);
  if (!isFullEInvoiceNo(no) || !isGibPortalNo(no)) return null;
  return existing.find((e) => !e.externalId && sameEInvoiceNo(e, d, no)) ?? null;
}

/** gibNoClash'ın yeni kayda düşen notu */
export function gibNoClashNote(e: Pick<ExistingInvoice, "supplier" | "date"> & { origin?: string }): string {
  const kind = e.origin === "manual" || e.origin === "excel" ? INVOICE_SOURCE_PHRASE[e.origin] : "başka bir";
  return `aynı numaralı ${kind} fatura var (${e.supplier}, ${dateTR(e.date)}); aynı faturaysa birini silin`;
}

/** Fatura numarasının karşılaştırma anahtarı: ayraçsız, büyük harf ("ABC-2026/001" → "ABC2026001"); numara yoksa "" */
export const invoiceNoKey = invNo;

/**
 * Elle eklenecek faturayla aynı tedarikçinin aynı numaralı faturası (denetim UI-02): numara ayraçsız ve büyük harfle
 * aynı, tedarikçi ad (sameSupplier) ya da Tedarikçiler kartıyla (`cardOf`) aynı; tarih ve tutara bakılmaz (aynı fatura
 * eşitlemeden sonra elle ya da iki kişi tarafından girilmiş olabilir). Paraşüt'ten gelen kayıt da sayılır. Numarasız
 * yeni faturada null
 */
export function findSameInvoiceNo<T extends Pick<ExistingInvoice, "invoiceNo" | "supplier" | "supplierTaxNumber">>(
  d: { supplier: string; invoiceNo: string | null },
  existing: T[],
  cardOf?: CardOf,
): T | null {
  const no = invNo(d.invoiceNo);
  if (!no) return null;
  return existing.find((e) => invNo(e.invoiceNo) === no && sameIssuer(e, { supplier: d.supplier }, cardOf)) ?? null;
}

/**
 * Gider faturasının e-belgesi panelde silinmiş (yok sayılan, `ei:<kimlik>`) bir e-fatura mı: e-fatura Paraşüt'te
 * sonradan içeri alınınca silinen kayıt gider faturası olarak geri gelmesin.
 */
export function eInvoiceDeleted(d: Pick<BillDraft, "eDocument">, ignored: ReadonlySet<string>): boolean {
  return d.eDocument?.type === "e_invoices" && ignored.has(`ei:${d.eDocument.id}`);
}

/**
 * Elle ya da Excel'den girilmiş aynı faturayı bulur (çift sayımı önlemek için): önce Paraşüt kimliği; sonra tam
 * e-fatura numarası (findByEInvoiceNo; GİB portalı numarasında aynı tedarikçi de); sonra aynı tedarikçi + fatura
 * numarası (tarih ±31 gün; farklı firmalar aynı e-fatura önekini kullanabilir); sonra aynı tedarikçi + aynı tarih +
 * aynı tutar (±1 ₺). GİB numarasında adı farklı yazılmış aynı tedarikçi `taxNumber` (belgenin vergi nosu) ya da
 * `cardOf` (Tedarikçiler kartı) ile tanınır
 */
export function findExisting(
  d: Pick<BillDraft, "externalId" | "invoiceNo" | "date" | "payable" | "supplier"> & { taxNumber?: string | null },
  existing: ExistingInvoice[],
  cardOf?: CardOf,
): ExistingInvoice | null {
  const byExt = existing.find((e) => e.externalId === d.externalId);
  if (byExt) return byExt;
  const unlinked = existing.filter((e) => !e.externalId);
  const no = invNo(d.invoiceNo);
  const strong = findByEInvoiceNo(d, unlinked, cardOf);
  if (strong) return strong;
  const free = unlinked.filter((e) => sameSupplier(e.supplier, d.supplier));
  if (no.length >= 6) {
    const byNo = free.find((e) => invNo(e.invoiceNo) === no && dayDiff(e.date, d.date) <= 31);
    if (byNo) return byNo;
  }
  return free.find((e) => e.date === d.date && Math.abs(e.payable - d.payable) <= 1) ?? null;
}

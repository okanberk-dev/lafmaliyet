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
}

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

export function productKeyFor(productId: string | null, name: string): string {
  return productId ? `p:${productId}` : `d:${norm(name)}`;
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

export function billToDraft(bill: Resource, included: Resource[] | undefined): BillDraft {
  const a = bill.attributes as Record<string, unknown>;
  const index = indexIncluded(included);
  const supplier = relOne(bill, "supplier", index);
  const category = relOne(bill, "category", index);
  const details = relMany(bill, "details", index);

  const currency = (str(a.currency) ?? "TRL").toUpperCase();
  const rate = currency === "TRL" || currency === "TRY" ? 1 : dec(a.exchange_rate) || 1;

  const lines: LineDraft[] = details.map((d) => {
    const da = d.attributes as Record<string, unknown>;
    const product = relOne(d, "product", index);
    const pa = (product?.attributes ?? {}) as Record<string, unknown>;
    const name = str(pa.name) ?? str(da.description) ?? "Kalem";
    const qty = dec(da.quantity);
    const unitPrice = dec(da.unit_price) * rate;
    const discountValue = dec(da.discount_value);
    const discount = str(da.discount_type) === "percentage" ? (qty * unitPrice * discountValue) / 100 : discountValue * rate;
    const net = da.net_total !== undefined ? dec(da.net_total) * rate : qty * unitPrice - discount;
    return {
      externalId: d.id,
      productKey: productKeyFor(product?.id ?? null, name),
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

/**
 * Bu fatura panele alınmalı mı. İptal ve tekrarlayan şablonlar alınmaz; arşivlenmiş fatura (Paraşüt'te yalnızca
 * listeden gizlenmiş) geçerli bir giderdir ve alınır.
 */
export function shouldImport(d: BillDraft): { ok: true } | { ok: false; reason: string } {
  if (d.itemType === "cancelled") return { ok: false, reason: "iptal" };
  if (d.itemType.startsWith("recurring")) return { ok: false, reason: "tekrarlayan şablon" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { ok: false, reason: "tarihsiz" };
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
  d: Pick<BillDraft, "supplier" | "description" | "parasutCategory" | "lines">,
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
}

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
 * Elle ya da Excel'den girilmiş aynı faturayı bulur (çift sayımı önlemek için): önce Paraşüt kimliği; sonra aynı
 * tedarikçi + fatura numarası (tarih ±31 gün; farklı firmalar aynı e-fatura önekini kullanabilir); sonra aynı
 * tedarikçi + aynı tarih + aynı tutar (±1 ₺).
 */
export function findExisting(d: Pick<BillDraft, "externalId" | "invoiceNo" | "date" | "payable" | "supplier">, existing: ExistingInvoice[]): ExistingInvoice | null {
  const byExt = existing.find((e) => e.externalId === d.externalId);
  if (byExt) return byExt;
  const unlinked = existing.filter((e) => !e.externalId);
  const no = invNo(d.invoiceNo);
  // Tam e-fatura/e-arşiv numarası (3 harf/rakam + 13 rakam) tek başına güçlü bir kimliktir; tedarikçi adı Excel'de
  // farklı yazılmış olabilir (Yemek Sepeti ~ YEMEKSEPETİ ELEKTRONİK). Ortak önek riskine karşı tarih ve tutar da bakılır.
  if (/^[A-Z0-9]{3}\d{13}$/.test(no)) {
    const strong = unlinked.find((e) => invNo(e.invoiceNo) === no && dayDiff(e.date, d.date) <= 31 && (e.date === d.date || Math.abs(Math.abs(e.payable) - Math.abs(d.payable)) <= 1));
    if (strong) return strong;
  }
  const free = unlinked.filter((e) => sameSupplier(e.supplier, d.supplier));
  if (no.length >= 6) {
    const byNo = free.find((e) => invNo(e.invoiceNo) === no && dayDiff(e.date, d.date) <= 31);
    if (byNo) return byNo;
  }
  return free.find((e) => e.date === d.date && Math.abs(e.payable - d.payable) <= 1) ?? null;
}

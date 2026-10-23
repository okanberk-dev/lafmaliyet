/**
 * Paraşüt'e gelen e-faturalar (GET /{firma}/e_invoices, belgelenmemiş ama çalışıyor). Kullanıcı Paraşüt'te
 * "içeri al" yapmasa da fatura panele buradan gelir. Canlı denemeyle doğrulandı (20 Eki 2026):
 * - yalnız `sort=-issue_date` kabul ediliyor (süzgeç ve diğer sıralamalar 400; sırasız istek yanıt vermiyor);
 * - `external_id` fatura numarasıdır (ABC2026000000123), `net_total` KDV dahil ödenecek, `total_vat` KDV;
 * - `relationships.invoice` içeri alınmışsa gider faturasını (purchase_bill) gösterir;
 * - `e_invoices/{id}/signed_ubl` imzalı UBL'yi (ZIP) verir: kalemler oradan okunur (ubl.ts, lines.ts);
 * - tevkifatlı faturada `net_total` tedarikçiye ödenecek tutardır (tevkifat düşülmüş), `total_vat` tam KDV:
 *   "ödenecek − KDV" maliyeti eksik verir; doğru KDV hariç tutar belge okununca yazılır.
 * Saf modül: testlerde de kullanılır.
 */
import type { Resource } from "./jsonapi";
import { SALES_RETURN } from "./mapping";

export interface EInvoiceAttrs {
  external_id?: string | null;
  uuid?: string | null;
  direction?: string | null;
  contact_name?: string | null;
  from_vkn?: string | null;
  to_vkn?: string | null;
  issue_date?: string | null;
  net_total?: string | number | null;
  total_vat?: string | number | null;
  currency?: string | null;
  invoice_type_code?: string | null;
  response_type?: string | null;
  archived?: boolean | null;
  status?: string | null;
}

export interface EInvoiceDraft {
  eInvoiceId: string;
  uuid: string | null;
  invoiceNo: string | null;
  date: string;
  /** Karşı taraf (`contact_name`): gelende satıcı, gidende alıcı */
  supplier: string;
  /** Gelende satıcının vergi nosu (`from_vkn`) */
  supplierTaxNo: string | null;
  /** Gidende alıcının vergi nosu (`to_vkn`; tedarikçiye iade) */
  receiverTaxNo: string | null;
  /** KDV hariç (iskonto bilgisi gelmez: iskonto sonrası tutar) */
  amount: number;
  vat: number;
  /** KDV dahil ödenecek */
  payable: number;
  inbound: boolean;
  archived: boolean;
  /** Reddedilen ya da iade edilen e-fatura gider sayılmaz */
  answered: boolean;
  currency: string;
  /** Tevkifatlı faturada Paraşüt'ün toplamları tevkifat sonrası olabilir: tutar kontrol edilmeli */
  withholding: boolean;
  /**
   * İade faturası (IADE, TEVKIFATIADE): tutarlar eksi. GİB kuralıyla iadeyi malı geri veren alıcı keser: gelen iade
   * kafenin sattığı bir malın iadesidir (satış iadesi, gider sayılmaz), giden iade kafenin tedarikçiye iadesidir
   */
  refund: boolean;
  /** İçeri alınmışsa Paraşüt gider faturası kimliği */
  importedBillId: string | null;
}

export const PLACEHOLDER_E_SUPPLIER = "Paraşüt tedarikçisi";

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export function eInvoiceToDraft(r: Resource<EInvoiceAttrs>): EInvoiceDraft {
  const a = r.attributes ?? {};
  const inv = r.relationships?.invoice?.data;
  const importedBillId = inv && !Array.isArray(inv) ? inv.id : null;
  const type = String(a.invoice_type_code ?? "").toUpperCase();
  const refund = type === "IADE" || type === "TEVKIFATIADE";
  const sign = refund ? -1 : 1;
  const payable = round2(num(a.net_total));
  const vat = round2(num(a.total_vat));
  const response = String(a.response_type ?? "").toLowerCase();
  return {
    eInvoiceId: r.id,
    uuid: a.uuid?.trim() || null,
    invoiceNo: a.external_id?.trim() || null,
    date: String(a.issue_date ?? "").slice(0, 10),
    supplier: a.contact_name?.trim() || PLACEHOLDER_E_SUPPLIER,
    supplierTaxNo: a.from_vkn?.trim() || null,
    receiverTaxNo: a.to_vkn?.trim() || null,
    amount: sign * round2(payable - vat),
    vat: sign * vat,
    payable: sign * payable,
    inbound: String(a.direction ?? "").toLowerCase() === "inbound",
    archived: Boolean(a.archived),
    answered: response === "rejected" || response === "refunded",
    currency: String(a.currency ?? "TRL").toUpperCase(),
    withholding: type === "TEVKIFAT",
    refund,
    importedBillId,
  };
}

/**
 * Tevkifatlı e-faturaya bağlı Excel / elle kaydın boş KDV'si için belgedeki tam KDV (`total_vat`). Liste tevkifat
 * düşülmüş ödenecek tutarı verir, kayıtta KDV yoksa KDV tahmini (src/lib/kdv.ts) "ödenecek − tutar"a düşer ve
 * tevkifatı göremez (Eylül 2026 reklam faturası: 4.200 indirildi, 6.000 indirilmeliydi). Kayıttaki KDV'ye
 * dokunulmaz; ödenecek tutar e-faturayı tutmuyorsa (elle değişmiş) ya da iadeyse null.
 */
export function withholdingVatFill(row: { vat: number | null; payable: number }, d: Pick<EInvoiceDraft, "withholding" | "refund" | "vat" | "payable">): number | null {
  if (!d.withholding || d.refund || !(d.vat > 0)) return null;
  if ((row.vat ?? 0) > 0) return null;
  return Math.abs(row.payable - d.payable) <= 1 ? d.vat : null;
}

/** Panele gider olarak girmeli mi; girmemeliyse nedeni (mevcut kaydı kaldırırken nota yazılır) */
export function shouldImportEInvoice(d: EInvoiceDraft): { ok: true } | { ok: false; reason: string } {
  if (!d.inbound) return { ok: false, reason: "giden fatura" };
  // Gelen iade e-faturası bir müşterinin (sitenin e-Fatura kestiği şirketin) iadesidir: tedarikçi faturası değil
  if (d.refund) return { ok: false, reason: SALES_RETURN };
  if (d.answered) return { ok: false, reason: "reddedildi" };
  if (d.archived) return { ok: false, reason: "arşivlendi" };
  if (d.currency !== "TRL" && d.currency !== "TRY") return { ok: false, reason: `döviz (${d.currency})` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { ok: false, reason: "tarih yok" };
  return { ok: true };
}

/**
 * Kafenin tedarikçiye iadesi (giden iade e-faturası). Paraşüt bunu satış faturası olarak tutar, panel satış
 * faturalarını okumaz: tutarı panele girmez, Paraşüt sayfasında listelenir (docs/PARASUT.md §2a)
 */
export const isSupplierReturn = (d: Pick<EInvoiceDraft, "inbound" | "refund">) => !d.inbound && d.refund;

/**
 * Yeni faturada kategori tahmini güvenilir mi: kural, tedarikçinin geçmişi ya da komisyon platformu değilse
 * fatura "kontrol bekleyen" olarak işaretlenir.
 */
export function categoryNeedsReview(reason: string): boolean {
  return !(reason.startsWith("kural") || reason === "tedarikçinin önceki faturaları" || reason === "komisyon platformu");
}

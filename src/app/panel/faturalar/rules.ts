/**
 * Faturalar ekranının saf kuralları: hem istemci (liste, pencere) hem sunucu eylemi (actions/invoices.ts) kullanır.
 * Veritabanına ya da React'e bağlı değildir; tests/invoices.test.ts ile sınanır.
 */
import { normalizeSupplier } from "../../../lib/calc/engine";
import type { Invoice } from "../../../lib/calc/types";

/** Kalan borç alanıyla fatura (çekirdek Invoice tipine `outstanding` eklenene kadar sayfa bunu doldurur) */
export type InvoiceRow = Invoice & { outstanding?: number | null };

// ---------------------------------------------------------------- Paraşüt kilidi

/**
 * Paraşüt'e bağlı faturada eşitlemenin her çalışmada yeniden yazdığı alanlar (sync.ts applyDraft `common`).
 * Panelde değiştirilse ertesi sabah sessizce geri dönerdi; bu yüzden panelde salt okunur, sunucu da yazmaz.
 * Kategori, tedarikçi adı, açıklama, not, vade ve ödeme durumu eşitlemede korunur, düzenlenebilir.
 */
export const PARASUT_LOCKED_FIELDS = ["date", "invoiceNo", "amount", "discount", "payable"] as const;
export type LockedField = (typeof PARASUT_LOCKED_FIELDS)[number];

export const LOCKED_LABELS: Record<LockedField, string> = {
  date: "tarih",
  invoiceNo: "fatura no",
  amount: "mal/hizmet tutarı",
  discount: "iskonto",
  payable: "ödenecek",
};

/** Paraşüt'e bağlı mı (eşitleme bu satırı her çalışmada günceller) */
export function isParasutLinked(i: { source?: string | null; externalId?: string | null }): boolean {
  return Boolean(i.externalId) || i.source === "parasut";
}

type LockedValues = { date: string; invoiceNo: string | null; amount: number; discount: number; payable: number };

/** Formdan gelen kilitli alanlardan kayıtlıdan farklı olanlar (kuruş altı fark sayılmaz) */
export function lockedChanges(stored: LockedValues, input: LockedValues): LockedField[] {
  const out: LockedField[] = [];
  if (stored.date !== input.date) out.push("date");
  if ((stored.invoiceNo ?? "").trim() !== (input.invoiceNo ?? "").trim()) out.push("invoiceNo");
  for (const k of ["amount", "discount", "payable"] as const) if (Math.abs(stored[k] - input[k]) >= 0.005) out.push(k);
  return out;
}

/** "tarih ve iskonto", "tarih, tutar ve iskonto" */
export function joinTR(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} ve ${words[words.length - 1]}`;
}

/** Paraşüt'te faturayı açan adres */
export function parasutBillUrl(companyId: string, externalId: string): string {
  return `https://uygulama.parasut.com/${encodeURIComponent(companyId)}/fis-faturalar/${encodeURIComponent(externalId)}`;
}

// ---------------------------------------------------------------- Tedarikçi, not, tahmin

/**
 * Tedarikçi adını gelir-giderdeki gruplamayla aynı biçimde böler:
 * "Kaldi (ödenmedi)" -> { base: "Kaldi", note: "ödenmedi" }
 */
export function splitSupplier(supplier: string) {
  const base = normalizeSupplier(supplier);
  if (!base) return { base: supplier, note: "" };
  const note = supplier
    .trim()
    .slice(base.length)
    .trim()
    .replace(/^\(\s*/, "")
    .replace(/\s*\)$/, "");
  return { base, note };
}

/** Paraşüt'ün her yeni faturaya yazdığı otomatik not ("Paraşüt'ten alındı · kategori: kural: “süt”") */
const AUTO_NOTE = /^Paraşüt'ten alındı(?:\s*·\s*kategori:(?:[^·“]|“[^”]*”)*)?/;

/**
 * Listede gösterilecek not: Paraşüt'ün otomatik notu atılır, kalan (ör. "Paraşüt'te iptal — kontrol edin" ya da
 * Excel hücre notu) döner. Gösterilecek bir şey yoksa null.
 */
export function visibleNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const rest = note
    .trim()
    .replace(AUTO_NOTE, "")
    .replace(/^\s*·\s*/, "")
    .trim();
  return rest || null;
}

/** Listedeki not önizlemesi (ilk ~140 karakter, kelime ortasında kesilmez) */
export function notePreview(note: string, max = 140): string {
  const t = note.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/**
 * Tahmini (varsayımla hesaplanmış) fatura: Excel'de sarı satır (ör. Kaldi 14.08, "%1 KDV varsayılarak").
 * Tedarikçi adındaki parantezli "tahmini" notu ya da faturanın notunda "tahmin" / "varsay" geçmesi yeter.
 */
export function isEstimate(i: { supplier: string; note?: string | null }): boolean {
  return /tahmin/i.test(splitSupplier(i.supplier).note) || /varsay|tahmin/i.test(visibleNote(i.note) ?? "");
}

// ---------------------------------------------------------------- KDV ve tedarikçi varsayılanları

export const VAT_RATES = ["0", "1", "10", "20"];

/** Kayıtlı faturanın KDV oranına en yakın seçenek (Hesapla düğmesi aynı oranla başlasın) */
export function guessVat(invoice: { amount: number; discount: number; payable: number } | null): string {
  if (!invoice) return "1";
  const net = invoice.amount - invoice.discount;
  if (net <= 0) return "1";
  if (Math.abs(invoice.payable - net) < 0.005) return "0";
  if (invoice.payable < net) return "1";
  const rate = (invoice.payable / net - 1) * 100;
  return VAT_RATES.reduce((best, r) => (Math.abs(Number(r) - rate) < Math.abs(Number(best) - rate) ? r : best));
}

/** Tedarikçi eşleştirme anahtarı: parantezli not atılır; büyük/küçük harf, I/ı ve boşluk farkı sayılmaz ("KALDI" = "Kaldi") */
export function supplierMatchKey(supplier: string): string {
  return splitSupplier(supplier).base.replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
}

export interface SupplierDefault {
  /** Listede görünen ad (en son faturadaki) */
  name: string;
  category: string;
  vatRate: string;
  date: string;
  count: number;
}

/**
 * Her tedarikçinin en son faturasından kategori ve KDV oranı: yeni faturada tedarikçi seçilince bunlar önerilir
 * (Excel'de her satırda kategori açılır listeden seçiliyordu).
 */
export function supplierDefaults(invoices: Pick<Invoice, "id" | "supplier" | "date" | "category" | "amount" | "discount" | "payable">[]) {
  const map = new Map<string, SupplierDefault>();
  for (const i of invoices) {
    const k = supplierMatchKey(i.supplier);
    if (!k) continue;
    const cur = map.get(k);
    const newer = !cur || i.date > cur.date;
    map.set(k, newer ? { name: i.supplier, category: i.category, vatRate: guessVat(i), date: i.date, count: (cur?.count ?? 0) + 1 } : { ...cur, count: cur.count + 1 });
  }
  return map;
}

/** Aynı tedarikçinin, kategorisi `category` olmayan diğer faturaları (satır içi değişiklikten sonra "hepsine uygula") */
export function sameSupplierOthers(invoices: Pick<Invoice, "id" | "supplier" | "category">[], target: Pick<Invoice, "id" | "supplier">, category: string): number[] {
  const k = supplierMatchKey(target.supplier);
  return invoices.filter((i) => i.id !== target.id && i.category !== category && supplierMatchKey(i.supplier) === k).map((i) => i.id);
}

// ---------------------------------------------------------------- Silinen Paraşüt faturaları

/** Panelde silinen Paraşüt faturalarının özeti ve geri alma kopyası (integration_state; sync.ts yalnızca kimlik listesini okur) */
export const DELETED_BILLS_KEY = "parasut.deleted";
/** Saklanan en fazla kopya (eskiler düşer; kimlik yok sayılanlar listesinde kalır) */
export const DELETED_BILLS_LIMIT = 200;

/** Ekranda gösterilen satır */
export interface IgnoredBill {
  externalId: string;
  supplier: string | null;
  date: string | null;
  invoiceNo: string | null;
  payable: number | null;
  deletedAt: string | null;
  deletedBy: string | null;
  /** Kopya saklı: geri alınca hemen listeye döner. Yoksa (eski silme) yalnızca sonraki eşitlemede gelir. */
  restorable: boolean;
}

type DeletedEntry = { externalId: string; deletedAt?: string; deletedBy?: string; row?: { supplier?: string; date?: string; invoiceNo?: string | null; payable?: number } };

/** parasut.ignore (kimlikler) + parasut.deleted (kopyalar) → yeniden eskiye liste */
export function ignoredBills(ignore: unknown, deleted: unknown): IgnoredBill[] {
  const ids = Array.isArray(ignore) ? ignore.filter((x): x is string => typeof x === "string") : [];
  const entries = Array.isArray(deleted) ? (deleted as DeletedEntry[]).filter((e) => e && typeof e.externalId === "string") : [];
  const byId = new Map(entries.map((e) => [e.externalId, e]));
  return ids
    .map((id, idx) => {
      const e = byId.get(id);
      return {
        idx,
        bill: {
          externalId: id,
          supplier: e?.row?.supplier ?? null,
          date: e?.row?.date ?? null,
          invoiceNo: e?.row?.invoiceNo ?? null,
          payable: typeof e?.row?.payable === "number" ? e.row.payable : null,
          deletedAt: e?.deletedAt ?? null,
          deletedBy: e?.deletedBy ?? null,
          restorable: Boolean(e?.row),
        },
      };
    })
    .sort((a, b) => (b.bill.deletedAt ?? "").localeCompare(a.bill.deletedAt ?? "") || b.idx - a.idx)
    .map((x) => x.bill);
}

import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import { dateTR, num } from "@/lib/format";

import type { CategoryRow, EntryRow, InvoiceItem } from "./monthly-expenses";

/**
 * Bu ay henüz girilmemiş "her ay" kategorileri (sayfadaki uyarı). Bağlı fatura kategorisinden faturası gelen ay
 * girilmiş sayılır: kategori kartı da öyle gösterir, aynısını elle girmek gideri iki kez sayar.
 */
export function missingCategories(categories: CategoryRow[]): CategoryRow[] {
  return categories.filter((c) => c.active && c.expected && !c.monthEntries && !c.monthInvoices);
}

/** Aylık harcamalar'daki dört özet kartının dökümü; sayfaya gelen ay verisinden kurulur (yeni sorgu yok) */
export interface ExpenseBreakdowns {
  /** Ayın toplamı: kategori kategori (girilenler + bağlı faturalar) */
  total: BreakdownGroup[];
  /** Reklam grubundaki kategoriler: kayıt kayıt */
  ads: BreakdownGroup[];
  /** Bu sayfada girilenler: kategori altında kayıt kayıt */
  offInvoice: BreakdownGroup[];
  /** Bağlı fatura kategorilerinden gelenler: kategori altında fatura fatura */
  fromInvoices: BreakdownGroup[];
}

export function expenseBreakdowns(month: string, categories: CategoryRow[], entries: EntryRow[], invoices: InvoiceItem[]): ExpenseBreakdowns {
  const entriesOf = (c: CategoryRow) => entries.filter((e) => e.categoryId === c.id);
  const invoicesOf = (c: CategoryRow) => invoices.filter((i) => i.categoryId === c.id);
  const entryRow = (e: EntryRow): BreakdownRow => ({ key: `e${e.id}`, label: e.description || "Harcama", sub: `${dateTR(e.date)}${e.note ? ` · ${e.note}` : ""}`, amount: e.amount });
  // Fatura Faturalar'da düzeltilir: dokununca o ayın o tedarikçi faturaları listede açılır
  const invoiceRow = (i: InvoiceItem): BreakdownRow => ({
    key: `i${i.id}`,
    label: i.supplier,
    sub: `${dateTR(i.date)} · faturadan (${i.invoiceCategory}, KDV hariç)`,
    amount: i.net,
    href: `/panel/faturalar?ay=${month}&ara=${encodeURIComponent(i.supplier)}#fatura-listesi`,
  });
  const counts = (c: CategoryRow) => {
    const parts = [entriesOf(c).length ? `${num(entriesOf(c).length)} kayıt` : null, invoicesOf(c).length ? `${num(invoicesOf(c).length)} fatura` : null];
    return parts.filter(Boolean).join(" · ") || undefined;
  };
  return {
    total: [{ key: "all", rows: categories.map((c) => ({ key: `c${c.id}`, label: c.name, sub: counts(c), amount: c.monthTotal })) }],
    ads: categories
      .filter((c) => c.panelGroup === "reklam")
      .map((c) => ({ key: `c${c.id}`, label: c.name, rows: [...entriesOf(c).map(entryRow), ...invoicesOf(c).map(invoiceRow)] })),
    offInvoice: categories.map((c) => ({ key: `c${c.id}`, label: c.name, rows: entriesOf(c).map(entryRow) })),
    fromInvoices: categories
      .filter((c) => c.invoiceCategory)
      .map((c) => ({ key: `c${c.id}`, label: c.name, note: `“${c.invoiceCategory}” faturaları`, rows: invoicesOf(c).map(invoiceRow) })),
  };
}

import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import { dateTR, num } from "@/lib/format";

import type { CategoryRow, EntryRow, InvoiceItem } from "./monthly-expenses";

/**
 * Bu ay henüz girilmemiş "her ay" kategorileri (sayfadaki uyarı). Bağlı fatura kategorisinden faturası gelen ay
 * girilmiş sayılır: kategori kartı da öyle gösterir, aynısını elle girmek gideri iki kez sayar.
 */
export function missingCategories(categories: CategoryRow[]): CategoryRow[] {
  return categories.filter((c) => c.active && c.expected && !c.monthEntries && !c.monthInvoices && !c.sharedTotal);
}

/**
 * Şube seçiliyken kategorinin aylık tutarı (şube kapsamı C P1-4; Gelir-gider'in `expense:<id>` hücresiyle aynı kural,
 * src/lib/calc/engine.ts): şubenin kendi kayıtları sayfanın toplamıdır; şubesi boş kayıtlar ve kategoriye bağlı faturalar
 * işletme genelidir, ayrı "İşletme geneli" tutarında gösterilir, şubenin toplamına girmez. "Tümü"de (`branch` null) her
 * şey toplamdadır, işletme geneli ayrı tutulmaz. Kategori kimliği → { own: toplama giren kayıtlar, shared: işletme geneli
 * kayıtlar (faturalar hariç) }
 */
export function expenseSplit(entries: readonly { categoryId: number; amount: number; branchId?: string | null }[], branch: string | null): Map<number, { own: number; shared: number }> {
  const out = new Map<number, { own: number; shared: number }>();
  for (const e of entries) {
    const x = out.get(e.categoryId) ?? { own: 0, shared: 0 };
    if (branch !== null && (e.branchId ?? null) === null) x.shared += e.amount;
    else x.own += e.amount;
    out.set(e.categoryId, x);
  }
  return out;
}

/**
 * Aylık harcamalar'daki dört özet kartının dökümü; sayfaya gelen ay verisinden kurulur (yeni sorgu yok). Şube seçiliyken
 * (`branchView`) toplam, reklam ve fatura dışı kartları yalnız şubenin kendi kayıtlarını sayar (işletme geneli kayıtlar ve
 * bağlı faturalar şubenin toplamına girmez; `expenseSplit`); "Faturadan" kartı faturaları yine gösterir
 */
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

export function expenseBreakdowns(month: string, categories: CategoryRow[], entries: EntryRow[], invoices: InvoiceItem[], branchView = false): ExpenseBreakdowns {
  const entriesOf = (c: CategoryRow) => entries.filter((e) => e.categoryId === c.id && !(branchView && e.shared));
  const invoicesOf = (c: CategoryRow) => invoices.filter((i) => i.categoryId === c.id);
  const countedInvoicesOf = (c: CategoryRow) => (branchView ? [] : invoicesOf(c));
  const entryRow = (e: EntryRow): BreakdownRow => ({
    key: `e${e.id}`,
    label: e.description || "Harcama",
    sub: `${dateTR(e.date)}${e.note ? ` · ${e.note}` : ""}${e.photoId ? " · fişli" : ""}`,
    amount: e.amount,
  });
  // Fatura Faturalar'da düzeltilir: dokununca o ayın o tedarikçi faturaları listede açılır
  const invoiceRow = (i: InvoiceItem): BreakdownRow => ({
    key: `i${i.id}`,
    label: i.supplier,
    sub: `${dateTR(i.date)} · faturadan (${i.invoiceCategory}, KDV hariç)`,
    amount: i.net,
    href: `/panel/faturalar?ay=${month}&ara=${encodeURIComponent(i.supplier)}#fatura-listesi`,
  });
  const counts = (c: CategoryRow) => {
    const parts = [entriesOf(c).length ? `${num(entriesOf(c).length)} kayıt` : null, countedInvoicesOf(c).length ? `${num(countedInvoicesOf(c).length)} fatura` : null];
    return parts.filter(Boolean).join(" · ") || undefined;
  };
  return {
    total: [{ key: "all", rows: categories.map((c) => ({ key: `c${c.id}`, label: c.name, sub: counts(c), amount: c.monthTotal })) }],
    ads: categories
      .filter((c) => c.panelGroup === "reklam")
      .map((c) => ({ key: `c${c.id}`, label: c.name, rows: [...entriesOf(c).map(entryRow), ...countedInvoicesOf(c).map(invoiceRow)] })),
    offInvoice: categories.map((c) => ({ key: `c${c.id}`, label: c.name, rows: entriesOf(c).map(entryRow) })),
    fromInvoices: categories
      .filter((c) => c.invoiceCategory)
      .map((c) => ({ key: `c${c.id}`, label: c.name, note: `“${c.invoiceCategory}” faturaları`, rows: invoicesOf(c).map(invoiceRow) })),
  };
}

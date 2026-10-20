import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import { monthOfDate, normalizeSupplier } from "@/lib/calc/engine";
import { openBalance } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { num } from "@/lib/format";

import type { InvoiceRow } from "./rules";

/** Listeye inen bağlantı (süzgeçler adreste) */
export type ListHref = (filters: { kategori?: string; ay?: string; durum?: string; ara?: string }) => string;

/** Faturalar'daki özet kartlarının dökümü: kategori kategori, kategoride tedarikçi tedarikçi */
export interface InvoiceBreakdowns {
  /** Bütün faturalar (Toplam fatura kartı): kafe kategorileri, kafe dışı ayrı */
  all: BreakdownGroup[];
  /** Ay ay mal alımı: mal kategorisi altında tedarikçiler */
  goods: Record<string, BreakdownGroup[]>;
  /** Ay ay komisyon: tedarikçiler (platformlar) */
  commission: Record<string, BreakdownGroup[]>;
  /** Ödenmemişlerin kalan borcu (KDV dahil): kategori altında tedarikçiler */
  unpaid: BreakdownGroup[];
}

const net = (i: InvoiceRow) => i.amount - i.discount;
const count = (n: number) => `${num(n)} fatura`;

/** Tedarikçi tedarikçi toplar; adın sonundaki parantezli not ("Kaldi (ödenmedi)") ayrı tedarikçi sayılmaz */
function bySupplier(invs: InvoiceRow[], amount: (i: InvoiceRow) => number, href: (supplier: string) => string): BreakdownRow[] {
  const map = new Map<string, { amount: number; n: number }>();
  for (const i of invs) {
    const s = normalizeSupplier(i.supplier);
    const x = map.get(s) ?? { amount: 0, n: 0 };
    map.set(s, { amount: x.amount + amount(i), n: x.n + 1 });
  }
  return [...map].map(([s, x]) => ({ key: s, label: s, sub: count(x.n), amount: x.amount, href: href(s) }));
}

/** Kategoriler: bilinen sırayla, listede olmayan (eski) kategoriler sonda */
function categoriesOf(invoices: InvoiceRow[]): string[] {
  const seen = new Set(invoices.map((i) => i.category));
  return [...INVOICE_CATEGORIES.filter((c) => seen.has(c)), ...[...seen].filter((c) => !INVOICE_CATEGORIES.includes(c)).sort((a, b) => a.localeCompare(b, "tr"))];
}

export function invoiceBreakdowns(invoices: InvoiceRow[], months: string[], href: ListHref): InvoiceBreakdowns {
  const cats = categoriesOf(invoices);
  const categoryRow = (c: string): BreakdownRow => {
    const xs = invoices.filter((i) => i.category === c);
    return { key: c, label: c, sub: count(xs.length), amount: xs.reduce((a, i) => a + net(i), 0), href: href({ kategori: c }) };
  };
  const inMonth = (m: string, c: string) => invoices.filter((i) => i.category === c && monthOfDate(i.date) === m);
  const open = invoices.filter((i) => i.unpaid);
  return {
    all: [
      { key: "kafe", rows: cats.filter((c) => !SEPARATE_CATEGORIES.includes(c)).map(categoryRow) },
      { key: "kafe-disi", label: "Kafe dışı", apart: true, rows: cats.filter((c) => SEPARATE_CATEGORIES.includes(c)).map(categoryRow) },
    ],
    goods: Object.fromEntries(
      months.map((m) => [m, GOODS_CATEGORIES.map((c) => ({ key: c, label: c, rows: bySupplier(inMonth(m, c), net, (s) => href({ kategori: c, ay: m, ara: s })) }))]),
    ),
    commission: Object.fromEntries(
      months.map((m) => [m, [{ key: "komisyon", rows: bySupplier(inMonth(m, COMMISSION_CATEGORY), net, (s) => href({ kategori: COMMISSION_CATEGORY, ay: m, ara: s })) }]]),
    ),
    // Kafe dışı ödenmemişler de kartın sayısında: toplama girer, adında belirtilir
    unpaid: categoriesOf(open).map((c) => ({
      key: c,
      label: SEPARATE_CATEGORIES.includes(c) ? `${c} (kafe dışı)` : c,
      rows: bySupplier(
        open.filter((i) => i.category === c),
        openBalance,
        (s) => href({ durum: "odenmedi", ara: s }),
      ),
    })),
  };
}

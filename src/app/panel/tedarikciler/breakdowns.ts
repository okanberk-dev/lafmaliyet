/**
 * Tedarikçiler ekranlarının özet kartı dökümleri (karta dokununca açılan pencere; components/ui/stat-breakdown.tsx).
 * Liste: tedarikçi tedarikçi; tedarikçi sayfası: fatura fatura ya da ay ay. Saf; tests/tedarikciler.test.ts.
 */
import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import { openBalance } from "@/lib/calc/insights";
import { dateTR, monthLabel, num } from "@/lib/format";
import { daysBetween } from "@/lib/reminders";

import { dueOf, dueWhen, SOON_DAYS, supplierHref, type LedgerInvoice, type SupplierSummary } from "./logic";

const count = (n: number) => `${num(n)} fatura`;

// ---------------------------------------------------------------- Liste (bütün tedarikçiler)

/** Liste kartlarının dökümü için tedarikçi başına gereken alanlar */
export interface BreakdownSupplier {
  slug: string;
  name: string;
  summary: SupplierSummary;
  /** Bu ay ödenen (ödeme günü bu ayda olan faturalar, KDV dahil) ve sayısı */
  paidThisMonth: number;
  paidThisMonthCount: number;
}

export interface ListBreakdowns {
  open: BreakdownGroup[];
  overdue: BreakdownGroup[];
  soon: BreakdownGroup[];
  paid: BreakdownGroup[];
}

function rows(list: readonly BreakdownSupplier[], amount: (s: BreakdownSupplier) => number, sub: (s: BreakdownSupplier) => string): BreakdownRow[] {
  return list.filter((s) => Math.abs(amount(s)) >= 0.005).map((s) => ({ key: s.slug, label: s.name, sub: sub(s), amount: amount(s), href: supplierHref(s.slug) }));
}

export function listBreakdowns(list: readonly BreakdownSupplier[]): ListBreakdowns {
  const next = (s: BreakdownSupplier) => (s.summary.nextDue ? ` · en yakın vade ${dateTR(s.summary.nextDue.date)}` : "");
  return {
    open: [{ key: "borc", rows: rows(list, (s) => s.summary.open, (s) => `${count(s.summary.openCount)}${next(s)}`) }],
    overdue: [{ key: "geciken", rows: rows(list, (s) => s.summary.overdue, (s) => `${count(s.summary.overdueCount)}${next(s)}`) }],
    soon: [{ key: "yakin", rows: rows(list, (s) => s.summary.soon, (s) => count(s.summary.soonCount)) }],
    paid: [{ key: "odenen", rows: rows(list, (s) => s.paidThisMonth, (s) => count(s.paidThisMonthCount)) }],
  };
}

// ---------------------------------------------------------------- Tedarikçi sayfası (tek tedarikçi)

/** Fatura satırı: tarih ve numara; dökümdeki kalem faturanın satırına iner */
export interface BreakdownInvoice extends LedgerInvoice {
  id: number;
  invoiceNo: string | null;
}

export interface SupplierBreakdowns {
  open: BreakdownGroup[];
  overdue: BreakdownGroup[];
  year: BreakdownGroup[];
  paid: BreakdownGroup[];
}

const invoiceLabel = (i: BreakdownInvoice) => `${dateTR(i.date)}${i.invoiceNo ? ` · ${i.invoiceNo}` : ""}`;

export function supplierBreakdowns(invoices: readonly BreakdownInvoice[], opts: { today: string; termDays: number; rowHref: (id: number) => string }): SupplierBreakdowns {
  const year = opts.today.slice(0, 4);
  const open = invoices.filter((i) => i.unpaid);
  const dueSub = (i: BreakdownInvoice) => {
    const due = dueOf(i, opts.termDays);
    return `${due.estimated ? "tahmini vade" : "vade"} ${dateTR(due.date)} · ${dueWhen(due.date, opts.today)}`;
  };
  const invoiceRow = (i: BreakdownInvoice): BreakdownRow => ({ key: String(i.id), label: invoiceLabel(i), sub: dueSub(i), amount: openBalance(i), href: opts.rowHref(i.id) });
  // Ay ay alım (bu yıl), yeniden eskiye sıralanmasın diye ayın adıyla; tutar sırasına dizilir
  const months = new Map<string, { amount: number; n: number }>();
  for (const i of invoices) {
    if (!i.date.startsWith(year)) continue;
    const m = i.date.slice(0, 7);
    const x = months.get(m) ?? { amount: 0, n: 0 };
    months.set(m, { amount: x.amount + i.payable, n: x.n + 1 });
  }
  // Ödeme günleri (son 12): aynı gün ödenen faturalar tek kalem
  const days = new Map<string, { amount: number; n: number }>();
  for (const i of invoices) {
    if (i.unpaid || !i.paidAt) continue;
    const x = days.get(i.paidAt) ?? { amount: 0, n: 0 };
    days.set(i.paidAt, { amount: x.amount + i.payable, n: x.n + 1 });
  }
  return {
    open: [{ key: "borc", rows: open.map(invoiceRow) }],
    overdue: [
      {
        key: "geciken",
        // Kartla aynı: yalnız borç (ödenmedi duran iade gecikmiş sayılmaz)
        rows: open.filter((i) => openBalance(i) > 0 && daysBetween(opts.today, dueOf(i, opts.termDays).date) < 0).map(invoiceRow),
      },
    ],
    year: [{ key: "yil", rows: [...months].sort((a, b) => b[0].localeCompare(a[0])).map(([m, x]) => ({ key: m, label: monthLabel(m), sub: count(x.n), amount: x.amount })) }],
    paid: [
      {
        key: "odemeler",
        rows: [...days]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 12)
          .map(([d, x]) => ({ key: d, label: dateTR(d), sub: count(x.n), amount: x.amount })),
      },
    ],
  };
}

/** Bu ay ödenen (ödeme günü bu ayda; KDV dahil) */
export function paidInMonth(invoices: readonly LedgerInvoice[], month: string): { amount: number; count: number } {
  let amount = 0;
  let n = 0;
  for (const i of invoices) {
    if (i.unpaid || !i.paidAt?.startsWith(month)) continue;
    amount += i.payable;
    n++;
  }
  return { amount: Math.round(amount * 100) / 100, count: n };
}

/** "7 gün içinde" kartının açıklaması (gün sayısı tek yerden) */
export const SOON_TEXT = `Vadesi bugünden ${SOON_DAYS} gün içinde (gecikmişler hariç)`;

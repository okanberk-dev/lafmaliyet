import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import type { CariAllocation, CariDebt, CariPayment } from "@/lib/cari/account";
import type { CariMethod } from "@/lib/cari/balance";
import { getDb, schema as s } from "@/server/db";

/** Cari kayıtlarının okunması (borç, ödeme, dağıtım); Tedarikçiler'in yükleyicisi ve cari ekranları birlikte kullanır */

type EntryRow = typeof s.supplierEntries.$inferSelect;

export type CardDebt = CariDebt & {
  supplierId: number;
  photoId: number | null;
  createdByName: string;
  updatedAt: Date;
  /** Borç ekle'nin Kasa denetiminde "Ayrı alım" denmiş Teslim satırları (bu borcun ödemesi değil) */
  dismissedCashOutIds: number[];
};

const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []);
export type CardPayment = CariPayment & { supplierId: number; cashOutCreated: boolean; photoId: number | null; createdByName: string; updatedAt: Date };

export function toDebt(r: EntryRow): CardDebt {
  return {
    id: r.id,
    supplierId: r.supplierId,
    date: r.date,
    amount: r.amount,
    description: r.description,
    note: r.note,
    costMode: r.costMode ?? "fatura",
    categoryId: r.categoryId,
    dueDate: r.dueDate,
    invoiceId: r.invoiceId,
    remindAfter: r.remindAfter,
    dismissedInvoiceIds: ids(r.dismissedInvoiceIds),
    dismissedCashOutIds: ids(r.dismissedCashOutIds),
    photoId: r.photoId,
    createdByName: r.createdByName,
    updatedAt: r.updatedAt,
  };
}

export function toPayment(r: EntryRow, cashOutStore: string | null = null): CardPayment {
  return {
    id: r.id,
    supplierId: r.supplierId,
    date: r.date,
    amount: r.amount,
    method: (r.method ?? "diger") as CariMethod,
    note: r.note,
    cashOutId: r.cashOutId,
    cashOutStore,
    cashOutCreated: r.cashOutCreated,
    photoId: r.photoId,
    createdByName: r.createdByName,
    updatedAt: r.updatedAt,
  };
}

/** Kartların (verilmezse bütün kartların) kayıtları ve kayıtların dağıtımları */
export async function loadCardEntries(cardIds?: readonly number[]): Promise<{ debts: CardDebt[]; payments: CardPayment[]; allocations: CariAllocation[] }> {
  const db = getDb();
  if (cardIds && !cardIds.length) return { debts: [], payments: [], allocations: [] };
  const rows = await db
    .select({ e: s.supplierEntries, store: s.cashOuts.store })
    .from(s.supplierEntries)
    .leftJoin(s.cashOuts, eq(s.supplierEntries.cashOutId, s.cashOuts.id))
    .where(cardIds ? inArray(s.supplierEntries.supplierId, [...cardIds]) : undefined)
    .orderBy(asc(s.supplierEntries.date), asc(s.supplierEntries.id));
  if (!rows.length) return { debts: [], payments: [], allocations: [] };
  const ids = rows.map((r) => r.e.id);
  const allocs = await db
    .select()
    .from(s.supplierAllocations)
    .where(inArray(s.supplierAllocations.paymentId, ids))
    .orderBy(asc(s.supplierAllocations.id));
  // Bu kartların borçlarına başka kartların ödemesinden sayılanlar da (ad değişikliğinden kalan eski veri)
  const debtIds = rows.filter((r) => r.e.kind === "borc").map((r) => r.e.id);
  const foreign = debtIds.length
    ? await db
        .select()
        .from(s.supplierAllocations)
        .where(inArray(s.supplierAllocations.debtId, debtIds))
    : [];
  const seen = new Set(allocs.map((a) => a.id));
  const allocations: CariAllocation[] = [...allocs, ...foreign.filter((a) => !seen.has(a.id))].map((a) => ({
    id: a.id,
    paymentId: a.paymentId,
    invoiceId: a.invoiceId,
    debtId: a.debtId,
    originDebtId: a.originDebtId,
    amount: a.amount,
  }));
  return {
    debts: rows.filter((r) => r.e.kind === "borc").map((r) => toDebt(r.e)),
    payments: rows.filter((r) => r.e.kind === "odeme").map((r) => toPayment(r.e, r.store)),
    allocations,
  };
}


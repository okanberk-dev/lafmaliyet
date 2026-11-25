import "server-only";

import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { ALL_BRANCHES, type BranchRow, type BranchScope } from "@/lib/branches";
import {
  INVOICE_SHARED,
  invoiceBranchValue,
  suggestInvoiceBranch,
  supplierDefaultValue,
  unassignedGroups,
  type BranchEvidence,
  type BranchSuggestion,
  type UnassignedGroup,
} from "@/lib/invoice-branch";
import { listBranches } from "@/server/branches";
import { cardResolver } from "@/server/cari/settle";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Faturanın şubesinin okumaları (docs/SUBE.md › Faturanın şubesi): "Şubesi seçilmemiş" kutusu ve uyarısı, kanıta dayalı
 * öneri. Öneri yazılmaz; yönetici "Uygula" der (setInvoiceBranch).
 */

/** Şubesi seçilmemiş faturalar: sayı ve KDV hariç tutar (bütün şubeler; uyarı satırları) */
export async function unassignedInvoiceCount(db: DB = getDb()): Promise<{ count: number; total: number }> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number), total: sql<number>`coalesce(sum(${s.invoices.amount} - ${s.invoices.discount}), 0)`.mapWith(Number) })
    .from(s.invoices)
    .where(and(isNull(s.invoices.branchId), eq(s.invoices.companyWide, false)));
  return { count: row?.n ?? 0, total: row?.total ?? 0 };
}

/** Bir kaydın tedarikçi anahtarı: Tedarikçiler kartı varsa kartı (diğer adları, vergi no), yoksa adın anahtarı */
type KeyOf = (supplier: string, taxNumber?: string | null) => string;

/**
 * Öneri için kanıtlar, tedarikçi anahtarı başına: şubesi seçilmiş (ya da işletme geneli) faturaları ve kasadan ödenen
 * alımları (Kasadan çıkanlar'ın mağaza adı; kasanın şubesi). Tedarikçi kartının varsayılanı ayrıca
 */
async function evidenceOf(db: DB, keyOf: KeyOf, cardOf: (supplier: string, taxNumber?: string | null) => number | null) {
  const [assigned, cash, cards] = await Promise.all([
    db
      .select({ supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber, branchId: s.invoices.branchId, companyWide: s.invoices.companyWide })
      .from(s.invoices)
      .where(or(isNotNull(s.invoices.branchId), eq(s.invoices.companyWide, true))),
    db.select({ store: s.cashOuts.store, branchId: s.cashOuts.branchId }).from(s.cashOuts).where(isNotNull(s.cashOuts.store)),
    db.select({ id: s.suppliers.id, defaultBranchId: s.suppliers.defaultBranchId, defaultCompanyWide: s.suppliers.defaultCompanyWide }).from(s.suppliers),
  ]);
  const evidence = new Map<string, BranchEvidence[]>();
  const add = (k: string, e: BranchEvidence) => evidence.set(k, [...(evidence.get(k) ?? []), e]);
  for (const r of assigned) {
    const v = invoiceBranchValue(r);
    if (v) add(keyOf(r.supplier, r.tax), { value: v, source: "fatura" });
  }
  for (const r of cash) if (r.store?.trim()) add(keyOf(r.store), { value: r.branchId, source: "kasa" });
  const defaults = new Map(cards.map((c) => [c.id, supplierDefaultValue(c)]));
  const defaultOf = (supplier: string, tax?: string | null) => {
    const card = cardOf(supplier, tax);
    return card === null ? null : (defaults.get(card) ?? null);
  };
  return { evidence, defaultOf };
}

export interface UnassignedInvoice {
  id: number;
  date: string;
  supplier: string;
  category: string;
  amount: number;
  discount: number;
}

export interface UnassignedBox {
  count: number;
  total: number;
  groups: (UnassignedGroup & { invoices: UnassignedInvoice[] })[];
  /** Önerisi olan fatura sayısı ("Önerilenleri uygula") */
  suggested: number;
}

/**
 * "Şubesi seçilmemiş" kutusu: faturalar tedarikçi tedarikçi, her grubun önerisi (src/lib/invoice-branch.ts
 * suggestInvoiceBranch). En çok `limit` grup; sayı ve tutar hepsinin
 */
export async function loadUnassignedBox(opts: { limit?: number; branches?: BranchRow[] } = {}, db: DB = getDb()): Promise<UnassignedBox> {
  const rows = await db
    .select({
      id: s.invoices.id,
      date: s.invoices.date,
      supplier: s.invoices.supplier,
      tax: s.invoices.supplierTaxNumber,
      category: s.invoices.category,
      amount: s.invoices.amount,
      discount: s.invoices.discount,
    })
    .from(s.invoices)
    .where(and(isNull(s.invoices.branchId), eq(s.invoices.companyWide, false)))
    .orderBy(sql`${s.invoices.date} desc`, sql`${s.invoices.id} desc`);
  if (!rows.length) return { count: 0, total: 0, groups: [], suggested: 0 };
  const [branches, cardOf] = await Promise.all([opts.branches ? Promise.resolve(opts.branches) : listBranches(db), cardResolver(db)]);
  const keyOf: KeyOf = (supplier, tax) => {
    const card = cardOf(supplier, tax);
    return card === null ? `ad:${supplierMatchKey(supplier)}` : `kart:${card}`;
  };
  const { evidence, defaultOf } = await evidenceOf(db, keyOf, cardOf);
  const suggestionOf = new Map<number, BranchSuggestion | null>();
  for (const r of rows) {
    suggestionOf.set(
      r.id,
      suggestInvoiceBranch({ date: r.date, supplierDefault: defaultOf(r.supplier, r.tax), evidence: evidence.get(keyOf(r.supplier, r.tax)) ?? [], branches }),
    );
  }
  const groups = unassignedGroups(rows, (r) => suggestionOf.get(r.id) ?? null, (r) => keyOf(r.supplier, r.tax));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const limited = groups.slice(0, opts.limit ?? 40).map((g) => ({
    ...g,
    invoices: g.ids.map((id) => {
      const r = byId.get(id)!;
      return { id: r.id, date: r.date, supplier: r.supplier, category: r.category, amount: r.amount, discount: r.discount };
    }),
  }));
  return {
    count: rows.length,
    total: rows.reduce((a, r) => a + r.amount - r.discount, 0),
    groups: limited,
    suggested: [...suggestionOf.values()].filter(Boolean).length,
  };
}

/** Kapsamda görünmeyen ama şubesi seçilmemiş faturalar var mı (tek şube seçiliyken uyarı; "Tümü"de kutu) */
export function scopeHidesUnassigned(scope: BranchScope): boolean {
  return scope !== ALL_BRANCHES;
}

export { INVOICE_SHARED };

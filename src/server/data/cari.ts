import "server-only";

import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { supplierResolver } from "@/app/panel/tedarikciler/logic";
import { accountOf, debtRemaining, paymentCredit, type AccountInvoice, type CariAccount, type CariAllocation, type CariDebt, type CariPayment } from "@/lib/cari/account";
import { EPS, round2, type CariMethod } from "@/lib/cari/balance";
import { KASA_LOOKBACK_DAYS, kasaMatches, linkCandidates, type KasaLine, type LinkCandidate } from "@/lib/cari/match";
import { addDays, todayTR } from "@/lib/reminders";
import { loadSupplierRefs } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";

/**
 * Cari hesabın okumaları (docs/TEDARIKCILER.md "Hesap hareketleri"): kayıtlar ve dağıtımlar, kart başına hesaptaki
 * para, açık borçlar, fatura adayları, işlenmemiş Kasa satırları. Yazan tek yer src/server/cari/settle.ts.
 */

/** "Ayrı tut" / "Ayrı alım" denmiş Kasa satırlarının kimlikleri (integration_state; en çok 2000, yedeğe girer) */
export const KASA_AYRI_KEY = "cari.kasa-ayri";
export const KASA_AYRI_LIMIT = 2000;

type EntryRow = typeof s.supplierEntries.$inferSelect;

export type CardDebt = CariDebt & { supplierId: number; photoId: number | null; createdByName: string; updatedAt: Date };
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
    dismissedInvoiceIds: Array.isArray(r.dismissedInvoiceIds) ? r.dismissedInvoiceIds.filter((x): x is number => Number.isInteger(x)) : [],
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

/** İşlenmiş Kasa satırları: bir ödemeye bağlı olanlar ve "Ayrı tut" denmişler */
export async function loadKasaHandled(): Promise<Set<number>> {
  const db = getDb();
  const [linked, [state]] = await Promise.all([
    db.select({ id: s.supplierEntries.cashOutId }).from(s.supplierEntries).where(eq(s.supplierEntries.kind, "odeme")),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, KASA_AYRI_KEY)).limit(1),
  ]);
  const out = new Set<number>();
  for (const r of linked) if (r.id !== null) out.add(r.id);
  if (Array.isArray(state?.value)) for (const x of state.value) if (Number.isInteger(x)) out.add(x as number);
  return out;
}

export interface CariIndex {
  /** Faturanın (ad, vergi no) kartı; kartsızsa null */
  resolveCard: (supplier: string, taxNumber?: string | null) => number | null;
  /** Kartın vade günü (loadTermDays ile aynı sonuç) */
  termDays: (supplier: string, taxNumber?: string | null) => number | null;
  cards: Map<number, { id: number; name: string; aliases: string[]; paymentTermDays: number | null; paymentMethod: string | null; paidOnDelivery: boolean }>;
  /** Ödeme kaydı olan kartlar (panel takibinde) */
  tracked: Set<number>;
  /** Kart → hesaptaki (sayılmamış) para */
  credit: Map<number, number>;
  /** Bağsız, kalanı olan borçlar */
  openDebts: (CardDebt & { remaining: number })[];
  /** Faturasız alımın faturası olabilecek faturalar (güçlü: Ödemeler'de sessiz; zayıf: yalnız tedarikçi sayfası) */
  strong: (LinkCandidate & { cardId: number })[];
  weak: (LinkCandidate & { cardId: number })[];
  /** Son 60 günün işlenmemiş, bir kartın adıyla eşleşen Kasa satırları (Teslim ve fişsiz Alışveriş) */
  kasaPending: (KasaLine & { cardId: number })[];
}

/**
 * Cari hesabın tek okuması (Ödemeler, zil, sabah e-postası, Genel bakış, nakit planı): kartlar ve eşleşme, takip,
 * hesaptaki para, açık borçlar, fatura adayları ve işlenmemiş Kasa satırları. Hiç cari kaydı yokken kayıt sorguları
 * boş döner ve fatura adayı aranmaz; Kasa satırları kartı olan tedarikçiler için yine aranır (personelin girdiği
 * "Teslim · ödeme" yöneticiye düşsün).
 */
export async function loadCariIndex(today = todayTR()): Promise<CariIndex> {
  const db = getDb();
  const [cards, refs, entries] = await Promise.all([
    db
      .select({
        id: s.suppliers.id,
        name: s.suppliers.name,
        aliases: s.suppliers.aliases,
        taxNumber: s.suppliers.taxNumber,
        paymentTermDays: s.suppliers.paymentTermDays,
        paymentMethod: s.suppliers.paymentMethod,
        paidOnDelivery: s.suppliers.paidOnDelivery,
      })
      .from(s.suppliers),
    loadSupplierRefs(),
    loadCardEntries(),
  ]);
  const { resolve } = supplierResolver(cards, refs);
  const resolveCard = (supplier: string, taxNumber?: string | null) => resolve(supplier, taxNumber).card?.id ?? null;
  const termDays = (supplier: string, taxNumber?: string | null) => resolve(supplier, taxNumber).card?.paymentTermDays ?? null;
  const cardMap = new Map(cards.map((c) => [c.id, { ...c, aliases: Array.isArray(c.aliases) ? c.aliases : [] }]));
  const tracked = new Set(entries.payments.map((p) => p.supplierId));
  const credit = new Map<number, number>();
  for (const p of entries.payments) {
    const c = paymentCredit(p, entries.allocations);
    if (c > EPS) credit.set(p.supplierId, round2((credit.get(p.supplierId) ?? 0) + c));
  }
  const openDebts = entries.debts
    .filter((d) => d.invoiceId === null)
    .map((d) => ({ ...d, remaining: debtRemaining(d, entries.allocations) }))
    .filter((d) => d.remaining > EPS);
  const out: CariIndex = { resolveCard, termDays, cards: cardMap, tracked, credit, openDebts, strong: [], weak: [], kasaPending: [] };
  if (!cards.length) return out;

  // Fatura adayları: bağsız borcu olan kartların penceredeki faturaları
  const candidateDebts = entries.debts.filter((d) => d.invoiceId === null && d.costMode !== "devir");
  if (candidateDebts.length) {
    const from = addDays(candidateDebts.reduce((m, d) => (d.date < m ? d.date : m), candidateDebts[0].date), -7);
    const invoices = await db
      .select({ id: s.invoices.id, date: s.invoices.date, payable: s.invoices.payable, category: s.invoices.category, supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber })
      .from(s.invoices)
      .where(gte(s.invoices.date, from));
    const linkedDebts = entries.debts.filter((d) => d.invoiceId !== null);
    for (const cardId of new Set(candidateDebts.map((d) => d.supplierId))) {
      const own = invoices.filter((i) => resolveCard(i.supplier, i.tax) === cardId);
      const { strong, weak } = linkCandidates([...entries.debts.filter((d) => d.supplierId === cardId), ...linkedDebts.filter((d) => d.supplierId !== cardId)], own);
      out.strong.push(...strong.map((c) => ({ ...c, cardId })));
      out.weak.push(...weak.map((c) => ({ ...c, cardId })));
    }
  }

  // İşlenmemiş Kasa satırları: Teslim ve (o gün açık kalemi olan kartta) fişsiz Alışveriş
  const since = addDays(today, -KASA_LOOKBACK_DAYS);
  const [lines, handled, unpaid] = await Promise.all([
    db
      .select({ id: s.cashOuts.id, date: s.cashOuts.date, kind: s.cashOuts.kind, store: s.cashOuts.store, docType: s.cashOuts.docType, amount: s.cashOuts.amount })
      .from(s.cashOuts)
      .where(gte(s.cashOuts.date, since)),
    loadKasaHandled(),
    db.select({ date: s.invoices.date, supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices).where(eq(s.invoices.unpaid, true)),
  ]);
  const openSince = new Map<number, string>();
  const mark = (cardId: number | null, date: string) => {
    if (cardId === null) return;
    const cur = openSince.get(cardId);
    if (!cur || date < cur) openSince.set(cardId, date);
  };
  for (const i of unpaid) mark(resolveCard(i.supplier, i.tax), i.date);
  for (const d of openDebts) mark(d.supplierId, d.date);
  for (const [cardId, c] of cardMap) {
    const keys = [c.name, ...c.aliases].map(supplierMatchKey).filter(Boolean);
    const first = openSince.get(cardId);
    const days = new Set(first ? lines.filter((l) => l.date >= first).map((l) => l.date) : []);
    const found = kasaMatches(lines, { keys, handled, from: since, to: today, kinds: ["teslim", "harcama"], receiptless: true, harcamaDays: days });
    out.kasaPending.push(...found.map((l) => ({ ...l, cardId })));
  }
  return out;
}

/** Tedarikçi sayfasının hesabı: kayıtlar, dağıtımlar, özet ve `allocated` sapması (K12) */
export async function loadSupplierAccount<I extends AccountInvoice>(
  group: { card: { id: number } | null; invoices: readonly I[] },
  opts: { today: string; termDays: number },
): Promise<{ debts: CardDebt[]; payments: CardPayment[]; allocations: CariAllocation[]; account: CariAccount; drift: number[] }> {
  const cardId = group.card?.id ?? null;
  const entries = cardId === null ? { debts: [], payments: [], allocations: [] } : await loadCardEntries([cardId]);
  // Faturalara doğrudan sayılanlar (başka kartın ödemesinden de olabilir): sapma denetimi
  const ids = group.invoices.map((i) => i.id);
  const onInvoices = ids.length ? await getDb().select({ invoiceId: s.supplierAllocations.invoiceId, amount: s.supplierAllocations.amount }).from(s.supplierAllocations).where(inArray(s.supplierAllocations.invoiceId, ids)) : [];
  const sums = new Map<number, number>();
  for (const a of onInvoices) if (a.invoiceId !== null) sums.set(a.invoiceId, (sums.get(a.invoiceId) ?? 0) + a.amount);
  const drift = group.invoices.filter((i) => Math.abs(round2(sums.get(i.id) ?? 0) - round2(i.allocated ?? 0)) > EPS).map((i) => i.id);
  const account = accountOf({ invoices: group.invoices, debts: entries.debts, payments: entries.payments, allocations: entries.allocations }, opts);
  return { ...entries, account, drift };
}

/** Gelir-gider bilgi satırı (§5.6): o ayda tarihli bağsız "Faturası gelecek" borçlar, kart kart */
export async function loadExpectedDebts(month: string): Promise<{ total: number; cards: { cardId: number; name: string; amount: number }[] }> {
  const rows = await getDb()
    .select({ supplierId: s.supplierEntries.supplierId, amount: s.supplierEntries.amount, date: s.supplierEntries.date, name: s.suppliers.name })
    .from(s.supplierEntries)
    .innerJoin(s.suppliers, eq(s.supplierEntries.supplierId, s.suppliers.id))
    .where(and(eq(s.supplierEntries.kind, "borc"), eq(s.supplierEntries.costMode, "fatura"), isNull(s.supplierEntries.invoiceId)));
  const byCard = new Map<number, { cardId: number; name: string; amount: number }>();
  for (const r of rows) {
    if (!r.date.startsWith(month)) continue;
    const c = byCard.get(r.supplierId) ?? { cardId: r.supplierId, name: r.name, amount: 0 };
    c.amount = round2(c.amount + r.amount);
    byCard.set(r.supplierId, c);
  }
  const cards = [...byCard.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "tr"));
  return { total: round2(cards.reduce((a, c) => a + c.amount, 0)), cards };
}

/**
 * Nakit planının mal tahmini için (K19): kart başına açık "Faturası gelecek" borçların kalanı ve kartın ad anahtarları
 * (adı ve diğer adları)
 */
export async function loadExpectedDebtsByCard(): Promise<{ cardId: number; keys: string[]; amount: number }[]> {
  const entries = await loadCardEntries();
  const open = entries.debts.filter((d) => d.invoiceId === null && d.costMode === "fatura");
  if (!open.length) return [];
  const cards = await getDb()
    .select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases })
    .from(s.suppliers)
    .where(inArray(s.suppliers.id, [...new Set(open.map((d) => d.supplierId))]));
  return cards
    .map((c) => ({
      cardId: c.id,
      keys: [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])].map(supplierMatchKey).filter(Boolean),
      amount: round2(open.filter((d) => d.supplierId === c.id).reduce((a, d) => a + debtRemaining(d, entries.allocations), 0)),
    }))
    .filter((c) => c.amount > EPS);
}

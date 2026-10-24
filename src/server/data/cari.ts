import "server-only";

import { and, asc, eq, gte, inArray, isNull, ne } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { supplierResolver } from "@/app/panel/tedarikciler/logic";
import { accountOf, debtRemaining, paymentCredit, type AccountInvoice, type CariAccount, type CariAllocation } from "@/lib/cari/account";
import { EPS, round2 } from "@/lib/cari/balance";
import { KASA_LOOKBACK_DAYS, kasaMatches, linkCandidates, type KasaLine, type LinkCandidate } from "@/lib/cari/match";
import { addDays, todayTR } from "@/lib/reminders";
import { loadSupplierRefs } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";

import { loadCardEntries, toDebt, type CardDebt, type CardPayment } from "./cari-entries";

/**
 * Cari hesabın okumaları (docs/TEDARIKCILER.md "Hesap hareketleri"): kayıtlar ve dağıtımlar, kart başına hesaptaki
 * para, açık borçlar, fatura adayları, işlenmemiş Kasa satırları. Yazan tek yer src/server/cari/settle.ts.
 */

/** "Ayrı tut" / "Ayrı alım" denmiş Kasa satırlarının kimlikleri (integration_state; en çok 2000, yedeğe girer) */
export const KASA_AYRI_KEY = "cari.kasa-ayri";
export const KASA_AYRI_LIMIT = 2000;

export { loadCardEntries, toDebt, toPayment, type CardDebt, type CardPayment } from "./cari-entries";

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

/** Faturası 45 gündür gelmeyen alım (§5.2): bağsız "Faturası gelecek" borç bu kadar gün açık kalınca uyarı */
export const DEBT_INVOICE_WAIT_DAYS = 45;

/** Borç penceresinin kategorileri: etkin harcama kategorileri (mal bölümü önce) */
export interface DebtCategory {
  id: number;
  name: string;
  section: string;
}

/** Varsayılan kategorinin adı (K9): yeni kategori açılmaz, var olan kullanılır */
export const NAKIT_MALZEME = "Nakit malzeme alımı";

/** Tedarikçi sayfasının cari verisi: hesap, kayıtlar, şeritler ve pencerelerin seçenekleri */
export interface SupplierCari {
  debts: CardDebt[];
  payments: CardPayment[];
  allocations: CariAllocation[];
  account: CariAccount;
  /** `invoices.allocated` dağıtım toplamını tutmayan faturalar (K12; "Düzelt") */
  drift: number[];
  strong: LinkCandidate[];
  weak: LinkCandidate[];
  /** Faturası 45 gündür gelmeyen alımlar */
  late: number[];
  /** Kasadan bu tedarikçiye çıkan, hesaba işlenmemiş satırlar (son 60 gün) */
  kasa: (KasaLine & { createdByName: string })[];
  /** Kartın ödemelerinden başka tedarikçide görünen faturalara sayılan (eski veri; "Ödemeden çıkar") */
  foreign: { paymentId: number; allocationIds: number[]; amount: number }[];
  /** Borçların gider kayıtları ("gider" ve "mevcut") */
  expenses: Record<number, { id: number; date: string; amount: number; categoryId: number; categoryName: string }>;
  categories: DebtCategory[];
  defaultCategoryId: number | null;
}

/**
 * Tedarikçi sayfasının cari okuması: kartın kayıtları ve dağıtımları, hesap özeti (güçlü fatura adayı mahsuptan
 * atlanır), `allocated` sapması (K12), fatura adayları, 45 gün uyarısı, işlenmemiş Kasa satırları, başka gruptaki
 * faturaya sayılanlar ve Borç ekle'nin kategorileri. Kartsız tedarikçide kayıt yoktur; hesap faturalardan ibarettir.
 */
export async function loadSupplierCari<I extends AccountInvoice & { category: string }>(
  group: { card: { id: number; name: string; aliases: readonly string[] } | null; invoices: readonly I[] },
  opts: { today: string; termDays: number },
): Promise<SupplierCari> {
  const db = getDb();
  const cardId = group.card?.id ?? null;
  const entries = cardId === null ? { debts: [], payments: [], allocations: [] } : await loadCardEntries([cardId]);
  const ids = group.invoices.map((i) => i.id);
  const [onInvoices, categories, otherLinked] = await Promise.all([
    ids.length ? db.select({ invoiceId: s.supplierAllocations.invoiceId, amount: s.supplierAllocations.amount }).from(s.supplierAllocations).where(inArray(s.supplierAllocations.invoiceId, ids)) : [],
    db
      .select({ id: s.expenseCategories.id, name: s.expenseCategories.name, section: s.expenseCategories.section, active: s.expenseCategories.active, sortOrder: s.expenseCategories.sortOrder })
      .from(s.expenseCategories)
      .orderBy(asc(s.expenseCategories.sortOrder), asc(s.expenseCategories.name)),
    ids.length && cardId !== null
      ? db.select().from(s.supplierEntries).where(and(inArray(s.supplierEntries.invoiceId, ids), ne(s.supplierEntries.supplierId, cardId)))
      : [],
  ]);
  const sums = new Map<number, number>();
  for (const a of onInvoices) if (a.invoiceId !== null) sums.set(a.invoiceId, (sums.get(a.invoiceId) ?? 0) + a.amount);
  const drift = group.invoices.filter((i) => Math.abs(round2(sums.get(i.id) ?? 0) - round2(i.allocated ?? 0)) > EPS).map((i) => i.id);

  const { strong, weak } = entries.debts.length
    ? linkCandidates([...entries.debts, ...otherLinked.map(toDebt)], group.invoices.map((i) => ({ id: i.id, date: i.date, payable: i.payable, category: i.category })))
    : { strong: [], weak: [] };
  const quiet = new Set(strong.map((c) => c.invoiceId));
  const account = accountOf({ invoices: group.invoices, debts: entries.debts, payments: entries.payments, allocations: entries.allocations }, { ...opts, quietInvoiceIds: quiet });

  const lateFrom = addDays(opts.today, -DEBT_INVOICE_WAIT_DAYS);
  const late = entries.debts
    .filter((d) => d.invoiceId === null && d.costMode === "fatura" && d.date <= lateFrom && (!d.remindAfter || d.remindAfter <= opts.today) && debtRemaining(d, entries.allocations) > EPS)
    .map((d) => d.id);
  // Kart ödemelerinin bu grubun dışındaki faturalara sayılan kısmı
  const own = new Set(ids);
  const foreignBy = new Map<number, { paymentId: number; allocationIds: number[]; amount: number }>();
  for (const a of entries.allocations) {
    if (a.invoiceId === null || own.has(a.invoiceId) || !entries.payments.some((p) => p.id === a.paymentId)) continue;
    const f = foreignBy.get(a.paymentId) ?? { paymentId: a.paymentId, allocationIds: [], amount: 0 };
    f.allocationIds.push(a.id);
    f.amount = round2(f.amount + a.amount);
    foreignBy.set(a.paymentId, f);
  }

  // Borçların gider kayıtları
  const expenses: SupplierCari["expenses"] = {};
  const debtIds = entries.debts.map((d) => d.id);
  if (debtIds.length) {
    const rows = await db
      .select({ id: s.expenseEntries.id, owner: s.expenseEntries.supplierEntryId, date: s.expenseEntries.date, amount: s.expenseEntries.amount, categoryId: s.expenseEntries.categoryId, categoryName: s.expenseCategories.name })
      .from(s.expenseEntries)
      .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(inArray(s.expenseEntries.supplierEntryId, debtIds));
    for (const r of rows) if (r.owner !== null) expenses[r.owner] = { id: r.id, date: r.date, amount: r.amount, categoryId: r.categoryId, categoryName: r.categoryName };
  }

  // İşlenmemiş Kasa satırları: Teslim ve (grubun o gün açık kalemi varken) fişsiz Alışveriş
  let kasa: SupplierCari["kasa"] = [];
  if (group.card) {
    const since = addDays(opts.today, -KASA_LOOKBACK_DAYS);
    const [lines, handled] = await Promise.all([
      db
        .select({ id: s.cashOuts.id, date: s.cashOuts.date, kind: s.cashOuts.kind, store: s.cashOuts.store, docType: s.cashOuts.docType, amount: s.cashOuts.amount, createdByName: s.cashOuts.createdByName })
        .from(s.cashOuts)
        .where(gte(s.cashOuts.date, since)),
      loadKasaHandled(),
    ]);
    const keys = [group.card.name, ...group.card.aliases].map(supplierMatchKey).filter(Boolean);
    const openSince = [...group.invoices.filter((i) => i.unpaid).map((i) => i.date), ...entries.debts.filter((d) => d.invoiceId === null && debtRemaining(d, entries.allocations) > EPS).map((d) => d.date)].sort()[0];
    const days = new Set(openSince ? lines.filter((l) => l.date >= openSince).map((l) => l.date) : []);
    kasa = kasaMatches(lines, { keys, handled, from: since, to: opts.today, kinds: ["teslim", "harcama"], receiptless: true, harcamaDays: days });
  }

  const usedCategories = new Set([...entries.debts.map((d) => d.categoryId), ...Object.values(expenses).map((e) => e.categoryId)]);
  const shown = categories.filter((c) => c.active || usedCategories.has(c.id)).sort((a, b) => Number(b.section === "mal") - Number(a.section === "mal"));
  // Varsayılan (K9): kartın son "Faturası yok" borcunun kategorisi, yoksa "Nakit malzeme alımı", o da yoksa ilk mal kategorisi
  const lastGider = [...entries.debts].reverse().find((d) => d.costMode === "gider" && d.categoryId !== null && categories.some((c) => c.id === d.categoryId && c.active));
  const nakit = categories.find((c) => c.active && c.name.toLocaleLowerCase("tr") === NAKIT_MALZEME.toLocaleLowerCase("tr"));
  const defaultCategoryId = lastGider?.categoryId ?? nakit?.id ?? categories.find((c) => c.active && c.section === "mal")?.id ?? categories.find((c) => c.active)?.id ?? null;

  return {
    ...entries,
    account,
    drift,
    strong,
    weak,
    late,
    kasa,
    foreign: [...foreignBy.values()],
    expenses,
    categories: shown.map((c) => ({ id: c.id, name: c.name, section: c.section })),
    defaultCategoryId,
  };
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

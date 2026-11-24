import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { groupSuppliers, supplierHref, supplierResolver } from "@/app/panel/tedarikciler/logic";
import type { CariExportRow } from "@/app/api/export/workbook";
import {
  accountOf,
  debtLabel,
  debtRemaining,
  invoiceLabel,
  paymentCredit,
  type AccountInvoice,
  type CariAccount,
  type CariAllocation,
  type CostMode,
  type InvoiceCariLinks,
} from "@/lib/cari/account";
import type { CariMethod } from "@/lib/cari/balance";
import { EPS, METHOD_LABEL, round2 } from "@/lib/cari/balance";
import type { ForeignCredit } from "@/lib/cari/statement";
import { tl } from "@/lib/format";
import { candidateOf, KASA_LOOKBACK_DAYS, kasaMatches, linkCandidates, type KasaLine, type LinkCandidate } from "@/lib/cari/match";
import { addDays, todayTR } from "@/lib/reminders";
import { loadSupplierRefs, supplierSlugOf } from "@/server/data/suppliers";
import type { Tx } from "@/server/cari/settle";
import { getDb, schema as s, type DB } from "@/server/db";

import { loadCardEntries, toDebt, type CardDebt, type CardPayment } from "./cari-entries";

/**
 * Cari hesabın okumaları (docs/TEDARIKCILER.md "Hesap hareketleri"): kayıtlar ve dağıtımlar, kart başına hesaptaki
 * para, açık borçlar, fatura adayları, işlenmemiş Kasa satırları. Yazan tek yer src/server/cari/settle.ts.
 */

/** "Ayrı tut" / "Ayrı alım" denmiş Kasa satırlarının kimlikleri (integration_state; en çok 2000, yedeğe girer) */
export const KASA_AYRI_KEY = "cari.kasa-ayri";
export const KASA_AYRI_LIMIT = 2000;

export { loadCardEntries, toDebt, toPayment, type CardDebt, type CardPayment } from "./cari-entries";

/** İşlenmiş Kasa satırları: bir ödemeye bağlı olanlar ve "Ayrı tut" denmişler (işlemin içinden de okunur) */
export async function loadKasaHandled(db: DB | Tx = getDb()): Promise<Set<number>> {
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
  /** Faturası 45 gündür gelmeyen alımlar (ödenmiş olsa da; lateDebts) */
  lateDebts: CardDebt[];
  /**
   * Faturasız alımın faturası olabilecek faturalar (güçlü: Ödemeler'de sessiz; zayıf: yalnız tedarikçi sayfası) ve
   * alımların günü ile ne alındığı (ödenmiş alım da olabilir: fatura o zaman zaten ödenmiş bir alımın faturasıdır)
   */
  strong: (LinkCandidate & { cardId: number; debts: { id: number; date: string; description: string | null }[] })[];
  weak: (LinkCandidate & { cardId: number; debts: { id: number; date: string; description: string | null }[] })[];
  /** Son 60 günün işlenmemiş, bir kartın adıyla eşleşen Kasa satırları (Teslim ve fişsiz Alışveriş) */
  kasaPending: (KasaLine & { cardId: number })[];
  /**
   * Fatura → faturaya bağlı borçlarda Borç ekle'nin Kasa denetiminde "Ayrı alım" denmiş Teslim satırları (borcun
   * `dismissedCashOutIds` birleşimi): alım faturasına bağlanınca fatura da o satırla sessize alınmaz
   */
  kasaApartByInvoice: Map<number, number[]>;
  /** Kartın tedarikçi sayfası (/panel/tedarikciler/<slug>); yalnız gerektiğinde hesaplanır */
  hrefOf: (cardId: number) => string | undefined;
}

/** Ödenmemiş faturanın tedarikçisini bulmaya yeten alanları (Kasa satırlarının "o gün açık kalemi var" kuralı) */
export interface UnpaidRef {
  date: string;
  supplier: string;
  tax: string | null;
}

/**
 * Cari hesabın tek okuması (Ödemeler, zil, sabah e-postası, Genel bakış, nakit planı): kartlar ve eşleşme, takip,
 * hesaptaki para, açık borçlar, fatura adayları ve işlenmemiş Kasa satırları. Hiç cari kaydı yokken kayıt sorguları
 * boş döner ve fatura adayı aranmaz; Kasa satırları kartı olan tedarikçiler için yine aranır (personelin girdiği
 * "Teslim · ödeme" yöneticiye düşsün).
 */
export async function loadCariIndex(today = todayTR(), opts: { unpaid?: Promise<UnpaidRef[]> } = {}): Promise<CariIndex> {
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
  // Adres parçaları Tedarikçiler'deki atamayla aynı (assignSlugs bütün grupların anahtarlarına bakar): ilk istekte bir kez
  let slugs: Map<number, string> | null = null;
  const hrefOf = (cardId: number) => {
    slugs ??= new Map(
      groupSuppliers(
        refs.map((r) => ({ ...r, date: r.date ?? "", payable: 0, unpaid: false })),
        [...cardMap.values()],
        { today, termDays: 0 },
      ).flatMap((g) => (g.card ? [[g.card.id, g.slug] as const] : [])),
    );
    const slug = slugs.get(cardId);
    return slug ? supplierHref(slug) : undefined;
  };
  const kasaApartByInvoice = new Map<number, number[]>();
  for (const d of entries.debts) {
    if (d.invoiceId === null || !d.dismissedCashOutIds.length) continue;
    kasaApartByInvoice.set(d.invoiceId, [...new Set([...(kasaApartByInvoice.get(d.invoiceId) ?? []), ...d.dismissedCashOutIds])]);
  }
  const out: CariIndex = {
    resolveCard,
    termDays,
    cards: cardMap,
    tracked,
    credit,
    openDebts,
    lateDebts: lateDebts(entries.debts, today),
    strong: [],
    weak: [],
    kasaPending: [],
    kasaApartByInvoice,
    hrefOf,
  };
  if (!cards.length) return out;

  // Fatura adayları: bağsız borcu olan kartların penceredeki faturaları
  const candidateDebts = entries.debts.filter((d) => d.invoiceId === null && d.costMode !== "devir");
  if (candidateDebts.length) {
    const from = addDays(candidateDebts.reduce((m, d) => (d.date < m ? d.date : m), candidateDebts[0].date), -7);
    const invoices = await db
      .select({
        id: s.invoices.id,
        date: s.invoices.date,
        payable: s.invoices.payable,
        category: s.invoices.category,
        supplier: s.invoices.supplier,
        tax: s.invoices.supplierTaxNumber,
        unpaid: s.invoices.unpaid,
        outstanding: s.invoices.outstanding,
        allocated: s.invoices.allocated,
        ledgerBase: s.invoices.ledgerBase,
      })
      .from(s.invoices)
      .where(gte(s.invoices.date, from));
    const linkedDebts = entries.debts.filter((d) => d.invoiceId !== null);
    for (const cardId of new Set(candidateDebts.map((d) => d.supplierId))) {
      const own = invoices.filter((i) => resolveCard(i.supplier, i.tax) === cardId).map(candidateOf);
      const { strong, weak } = linkCandidates([...entries.debts.filter((d) => d.supplierId === cardId), ...linkedDebts.filter((d) => d.supplierId !== cardId)], own);
      const debtsOf = (c: LinkCandidate) =>
        c.debtIds.flatMap((id) => {
          const d = entries.debts.find((x) => x.id === id);
          return d ? [{ id: d.id, date: d.date, description: d.description }] : [];
        });
      out.strong.push(...strong.map((c) => ({ ...c, cardId, debts: debtsOf(c) })));
      out.weak.push(...weak.map((c) => ({ ...c, cardId, debts: debtsOf(c) })));
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
    opts.unpaid ?? db.select({ date: s.invoices.date, supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices).where(eq(s.invoices.unpaid, true)),
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

/**
 * Faturası 45 gündür gelmeyen alımlar: bağsız "Faturası gelecek" borç, alım günü 45 günden eski, "Beklemeye devam"
 * süresi dolmuş. Ödeme durumuna bakılmaz (§4.6: ödeme vadesiyle ilgisi yok): teslimde ödenmiş alımın faturası hiç
 * gelmezse gideri de hiç yazılmaz, uyarı onu söyler.
 */
export function lateDebts<D extends Pick<CardDebt, "invoiceId" | "costMode" | "date" | "remindAfter">>(debts: readonly D[], today: string): D[] {
  const lateFrom = addDays(today, -DEBT_INVOICE_WAIT_DAYS);
  return debts.filter((d) => d.invoiceId === null && d.costMode === "fatura" && d.date <= lateFrom && (!d.remindAfter || d.remindAfter <= today));
}

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
  /** Başka kartların ödemelerinden bu grubun faturalarına sayılanlar (ekstrenin ödeme satırları) */
  foreignIn: ForeignCredit[];
  /** Borçların gider kayıtları ("gider" ve "mevcut") */
  expenses: Record<number, { id: number; date: string; amount: number; categoryId: number; categoryName: string; branchId: string | null }>;
  categories: DebtCategory[];
  /** Gelir-gider'de bir harcama kalemine bağlı fatura kategorileri (mal dışı faturanın gideri orada sayılır) */
  countedCategories: string[];
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
    ids.length
      ? db
          .select({
            invoiceId: s.supplierAllocations.invoiceId,
            amount: s.supplierAllocations.amount,
            paymentId: s.supplierAllocations.paymentId,
            date: s.supplierEntries.date,
            method: s.supplierEntries.method,
            cardId: s.supplierEntries.supplierId,
            card: s.suppliers.name,
          })
          .from(s.supplierAllocations)
          .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
          .innerJoin(s.suppliers, eq(s.supplierEntries.supplierId, s.suppliers.id))
          .where(inArray(s.supplierAllocations.invoiceId, ids))
      : [],
    db
      .select({
        id: s.expenseCategories.id,
        name: s.expenseCategories.name,
        section: s.expenseCategories.section,
        active: s.expenseCategories.active,
        sortOrder: s.expenseCategories.sortOrder,
        invoiceCategory: s.expenseCategories.invoiceCategory,
      })
      .from(s.expenseCategories)
      .orderBy(asc(s.expenseCategories.sortOrder), asc(s.expenseCategories.name)),
    ids.length && cardId !== null
      ? db.select().from(s.supplierEntries).where(and(inArray(s.supplierEntries.invoiceId, ids), ne(s.supplierEntries.supplierId, cardId)))
      : [],
  ]);
  const sums = new Map<number, number>();
  for (const a of onInvoices) if (a.invoiceId !== null) sums.set(a.invoiceId, (sums.get(a.invoiceId) ?? 0) + a.amount);
  const drift = group.invoices.filter((i) => Math.abs(round2(sums.get(i.id) ?? 0) - round2(i.allocated ?? 0)) > EPS).map((i) => i.id);
  // Başka kartların ödemelerinden grubun faturalarına sayılanlar (ekstrede ödeme satırı; yoksa son bakiye Kalan borçtan sapar)
  const foreignInBy = new Map<string, ForeignCredit>();
  for (const a of onInvoices) {
    if (a.invoiceId === null || a.cardId === cardId) continue;
    const k = `${a.paymentId}:${a.invoiceId}`;
    const f = foreignInBy.get(k) ?? { invoiceId: a.invoiceId, paymentId: a.paymentId, date: a.date, card: a.card, amount: 0, method: a.method };
    f.amount = round2(f.amount + a.amount);
    foreignInBy.set(k, f);
  }

  const { strong, weak } = entries.debts.length
    ? linkCandidates([...entries.debts, ...otherLinked.map(toDebt)], group.invoices.map(candidateOf))
    : { strong: [], weak: [] };
  const quiet = new Set(strong.map((c) => c.invoiceId));
  const account = accountOf({ invoices: group.invoices, debts: entries.debts, payments: entries.payments, allocations: entries.allocations }, { ...opts, quietInvoiceIds: quiet });

  const late = lateDebts(entries.debts, opts.today).map((d) => d.id);
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
      .select({
        id: s.expenseEntries.id,
        owner: s.expenseEntries.supplierEntryId,
        date: s.expenseEntries.date,
        amount: s.expenseEntries.amount,
        categoryId: s.expenseEntries.categoryId,
        categoryName: s.expenseCategories.name,
        branchId: s.expenseEntries.branchId,
      })
      .from(s.expenseEntries)
      .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(inArray(s.expenseEntries.supplierEntryId, debtIds));
    for (const r of rows)
      if (r.owner !== null) expenses[r.owner] = { id: r.id, date: r.date, amount: r.amount, categoryId: r.categoryId, categoryName: r.categoryName, branchId: r.branchId };
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
    foreignIn: [...foreignInBy.values()],
    expenses,
    categories: shown.map((c) => ({ id: c.id, name: c.name, section: c.section })),
    countedCategories: [...new Set(categories.flatMap((c) => (c.invoiceCategory ? [c.invoiceCategory] : [])))],
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
 * Gelir-gider bilgi satırı (§5.6), yılın ayları: ayda tarihli bağsız "Faturası gelecek" borçların toplamı ve en çok
 * borcu olan tedarikçinin sayfası. Satır yalnız bilgi verir, toplamlara katılmaz. Kayıt yokken boş.
 */
export async function loadExpectedDebtsInYear(year: number): Promise<Record<string, { total: number; href: string | null; name: string }>> {
  const rows = await getDb()
    .select({ supplierId: s.supplierEntries.supplierId, amount: s.supplierEntries.amount, date: s.supplierEntries.date, name: s.suppliers.name })
    .from(s.supplierEntries)
    .innerJoin(s.suppliers, eq(s.supplierEntries.supplierId, s.suppliers.id))
    .where(and(eq(s.supplierEntries.kind, "borc"), eq(s.supplierEntries.costMode, "fatura"), isNull(s.supplierEntries.invoiceId), gte(s.supplierEntries.date, `${year}-01-01`), lte(s.supplierEntries.date, `${year}-12-31`)));
  const byMonth = new Map<string, Map<number, { name: string; amount: number }>>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const cards = byMonth.get(m) ?? new Map<number, { name: string; amount: number }>();
    const c = cards.get(r.supplierId) ?? { name: r.name, amount: 0 };
    c.amount = round2(c.amount + r.amount);
    cards.set(r.supplierId, c);
    byMonth.set(m, cards);
  }
  const out: Record<string, { total: number; href: string | null; name: string }> = {};
  const slugs = new Map<number, string | null>();
  for (const [m, cards] of byMonth) {
    const [topId, top] = [...cards].sort((a, b) => b[1].amount - a[1].amount || a[1].name.localeCompare(b[1].name, "tr"))[0];
    if (!slugs.has(topId)) slugs.set(topId, await supplierSlugOf(topId));
    const slug = slugs.get(topId);
    out[m] = { total: round2([...cards.values()].reduce((a, c) => a + c.amount, 0)), href: slug ? supplierHref(slug) : null, name: top.name };
  }
  return out;
}

/**
 * Nakit planının mal tahmini için (K19): kart başına açık "Faturası gelecek" borçların kalanı ve kartın ad anahtarları:
 * adı, diğer adları ve faturalarda vergi noyla bu karta düşen adlar (Paraşüt'ten tüzel adıyla gelen faturalar;
 * tahmin faturanın adını okur)
 */
export async function loadExpectedDebtsByCard(): Promise<{ cardId: number; name: string; keys: string[]; amount: number }[]> {
  const entries = await loadCardEntries();
  const open = entries.debts.filter((d) => d.invoiceId === null && d.costMode === "fatura");
  if (!open.length) return [];
  const db = getDb();
  const [cards, allCards, refs] = await Promise.all([
    db
      .select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases })
      .from(s.suppliers)
      .where(inArray(s.suppliers.id, [...new Set(open.map((d) => d.supplierId))])),
    db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber }).from(s.suppliers),
    loadSupplierRefs(),
  ]);
  const { resolve } = supplierResolver(allCards.map((c) => ({ ...c, aliases: Array.isArray(c.aliases) ? c.aliases : [] })), refs);
  const invoiceNames = new Map<number, string[]>();
  for (const r of refs) {
    const id = resolve(r.supplier, r.supplierTaxNumber).card?.id;
    if (id !== undefined) invoiceNames.set(id, [...(invoiceNames.get(id) ?? []), r.supplier]);
  }
  return cards
    .map((c) => ({
      cardId: c.id,
      name: c.name,
      keys: [...new Set([c.name, ...(Array.isArray(c.aliases) ? c.aliases : []), ...(invoiceNames.get(c.id) ?? [])].map(supplierMatchKey).filter(Boolean))],
      amount: round2(open.filter((d) => d.supplierId === c.id).reduce((a, d) => a + debtRemaining(d, entries.allocations), 0)),
    }))
    .filter((c) => c.amount > EPS);
}

/**
 * Excel'in "Cari hareketleri" sekmesi: bütün elle kayıtlar (borç ve ödeme), kartın adı, ödemenin sayıldığı kalemler,
 * borcun bağlandığı fatura. Kayıt yokken boş (sekme eklenmez).
 */
export async function loadCariExport(): Promise<CariExportRow[]> {
  const entries = await loadCardEntries();
  if (!entries.debts.length && !entries.payments.length) return [];
  const db = getDb();
  const cardIds = [...new Set([...entries.debts, ...entries.payments].map((e) => e.supplierId))];
  const invoiceIds = [...new Set([...entries.allocations.flatMap((a) => (a.invoiceId !== null ? [a.invoiceId] : [])), ...entries.debts.flatMap((d) => (d.invoiceId !== null ? [d.invoiceId] : []))])];
  const [cards, invoices] = await Promise.all([
    db.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers).where(inArray(s.suppliers.id, cardIds)),
    invoiceIds.length ? db.select({ id: s.invoices.id, invoiceNo: s.invoices.invoiceNo, date: s.invoices.date }).from(s.invoices).where(inArray(s.invoices.id, invoiceIds)) : [],
  ]);
  const cardName = new Map(cards.map((c) => [c.id, c.name]));
  const invoiceName = new Map(invoices.map((i) => [i.id, invoiceLabel(i)]));
  const debtName = new Map(entries.debts.map((d) => [d.id, debtLabel(d)]));
  const num2 = (v: number) => tl(v, 2).replace(/\s*₺$/u, "");
  const movement: Record<CostMode, string> = {
    fatura: "Faturasız alım (faturası gelecek)",
    gider: "Faturasız alım (gider yazıldı)",
    mevcut: "Faturasız alım (gideri zaten girildi)",
    devir: "Eski borç (devir)",
  };
  const rows: CariExportRow[] = [];
  for (const d of entries.debts) {
    const paid = round2(entries.allocations.filter((a) => a.debtId === d.id || a.originDebtId === d.id).reduce((x, a) => x + a.amount, 0));
    rows.push({
      date: d.date,
      supplier: cardName.get(d.supplierId) ?? "",
      movement: movement[d.costMode],
      description: d.description,
      debt: d.amount,
      payment: null,
      method: null,
      counted: paid > EPS ? `ödenen ${num2(paid)}` : null,
      invoice: d.invoiceId !== null ? (invoiceName.get(d.invoiceId) ?? null) : null,
      note: d.note ?? null,
    });
  }
  for (const p of entries.payments) {
    const mine = entries.allocations.filter((a) => a.paymentId === p.id);
    const parts = mine.map((a) => `${a.invoiceId !== null ? (invoiceName.get(a.invoiceId) ?? "fatura") : (debtName.get(a.debtId ?? 0) ?? "alım")} ${num2(a.amount)}`);
    rows.push({
      date: p.date,
      supplier: cardName.get(p.supplierId) ?? "",
      movement: "Ödeme",
      description: null,
      debt: null,
      payment: p.amount,
      method: p.method === "kasa" ? `Kasadan (Teslim · ${p.cashOutStore ?? cardName.get(p.supplierId) ?? ""})` : METHOD_LABEL[p.method],
      counted: [...parts, `hesapta ${num2(paymentCredit(p, entries.allocations))}`].join(" · "),
      invoice: null,
      note: p.note ?? null,
    });
  }
  return rows;
}

/**
 * Faturalar'ın cari bilgisi (§6.4): faturaya sayılan ödemeler (gün, şekil, tutar) ve faturaya bağlanmış faturasız
 * alımlar (fotoğrafıyla). Yalnız bağı olan faturalar; kayıt yokken boş.
 */
export async function loadInvoiceCariLinks(): Promise<Record<number, InvoiceCariLinks>> {
  const db = getDb();
  const [allocs, debts] = await Promise.all([
    db
      .select({ invoiceId: s.supplierAllocations.invoiceId, amount: s.supplierAllocations.amount, date: s.supplierEntries.date, method: s.supplierEntries.method, card: s.suppliers.name })
      .from(s.supplierAllocations)
      .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
      .innerJoin(s.suppliers, eq(s.supplierEntries.supplierId, s.suppliers.id))
      .where(isNotNull(s.supplierAllocations.invoiceId))
      .orderBy(asc(s.supplierEntries.date), asc(s.supplierAllocations.id)),
    db
      .select({ id: s.supplierEntries.id, invoiceId: s.supplierEntries.invoiceId, date: s.supplierEntries.date, description: s.supplierEntries.description, amount: s.supplierEntries.amount, photoId: s.supplierEntries.photoId, card: s.suppliers.name })
      .from(s.supplierEntries)
      .innerJoin(s.suppliers, eq(s.supplierEntries.supplierId, s.suppliers.id))
      .where(and(eq(s.supplierEntries.kind, "borc"), isNotNull(s.supplierEntries.invoiceId)))
      .orderBy(asc(s.supplierEntries.date), asc(s.supplierEntries.id)),
  ]);
  const out: Record<number, InvoiceCariLinks> = {};
  const of = (id: number, card: string) => (out[id] ??= { card, payments: [], debts: [] });
  for (const a of allocs) if (a.invoiceId !== null) of(a.invoiceId, a.card).payments.push({ date: a.date, method: (a.method ?? "diger") as CariMethod, amount: a.amount });
  for (const d of debts) if (d.invoiceId !== null) of(d.invoiceId, d.card).debts.push({ id: d.id, date: d.date, description: d.description, amount: d.amount, photoId: d.photoId });
  return out;
}

/** Kasa'da yöneticinin satır ipucu (§6.8): ödemeye bağlı satır, hesaba işlenmemiş Teslim, ödeme olabilecek fişsiz alışveriş */
export type KasaCariHint =
  | { kind: "linked"; name: string; href: string | null }
  | { kind: "teslim"; name: string; href: string | null }
  | { kind: "fissiz"; name: string; href: string | null };

/**
 * Kasa'nın gün görünümünde (yalnız yönetici) satırların cari bağı: bir ödemeye bağlı satır o tedarikçinin sayfasına
 * götürür; işlenmemiş ve adı bir kartla eşleşen Teslim "Hesaba işle", grubun o gün açık kalemi varken fişsiz
 * Alışveriş "Ödemeye çevir" önerir (Tedarikçiler şeridiyle aynı kural, son 60 gün). Satır yoksa okuma yapılmaz.
 */
export async function loadKasaCariHints(lineIds: readonly number[], today = todayTR()): Promise<Record<number, KasaCariHint>> {
  if (!lineIds.length) return {};
  const db = getDb();
  const [linked, index] = await Promise.all([
    db
      .select({ cashOutId: s.supplierEntries.cashOutId, cardId: s.supplierEntries.supplierId, name: s.suppliers.name })
      .from(s.supplierEntries)
      .innerJoin(s.suppliers, eq(s.supplierEntries.supplierId, s.suppliers.id))
      .where(inArray(s.supplierEntries.cashOutId, [...lineIds])),
    loadCariIndex(today),
  ]);
  const out: Record<number, KasaCariHint> = {};
  const ids = new Set(lineIds);
  for (const l of index.kasaPending) {
    const card = index.cards.get(l.cardId);
    if (!ids.has(l.id) || !card || out[l.id]) continue;
    out[l.id] = { kind: l.kind === "teslim" ? "teslim" : "fissiz", name: card.name, href: index.hrefOf(l.cardId) ?? null };
  }
  for (const r of linked) if (r.cashOutId !== null) out[r.cashOutId] = { kind: "linked", name: r.name, href: index.hrefOf(r.cardId) ?? null };
  return out;
}

/** Kasa satırlarından bir tedarikçi ödemesine bağlı olanlar (personel düzeltemez ve silemez; §8) */
export async function loadLinkedCashOuts(lineIds: readonly number[]): Promise<Set<number>> {
  if (!lineIds.length) return new Set();
  const rows = await getDb().select({ id: s.supplierEntries.cashOutId }).from(s.supplierEntries).where(inArray(s.supplierEntries.cashOutId, [...lineIds]));
  return new Set(rows.flatMap((r) => (r.id !== null ? [r.id] : [])));
}

/**
 * Kasa penceresinin ad ipucu (§8, R9d): tedarikçi kartlarının adları ve diğer adları. Yalnız adlar; tutar, borç ya da
 * fatura yok, borca göre süzülmez (personel de görür).
 */
export async function loadSupplierNames(): Promise<string[]> {
  const cards = await getDb().select({ name: s.suppliers.name, aliases: s.suppliers.aliases }).from(s.suppliers).orderBy(asc(s.suppliers.name));
  const names = cards.flatMap((c) => [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])]).map((n) => n.trim()).filter(Boolean);
  return [...new Set(names)].slice(0, 2000);
}

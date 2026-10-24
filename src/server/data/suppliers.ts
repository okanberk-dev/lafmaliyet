import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";

import { groupSuppliers, supplierResolver, type PaymentMethod, type SupplierCard, type SupplierRef } from "@/app/panel/tedarikciler/logic";
import { addDays, todayTR } from "@/lib/reminders";
import { accountOf } from "@/lib/cari/account";
import { linkCandidates } from "@/lib/cari/match";
import { getDb, schema as s } from "@/server/db";
import { loadNotifySettings } from "@/server/notify/settings";

import { loadCardEntries } from "./cari-entries";

type SupplierRow = typeof s.suppliers.$inferSelect;

export function toCard(r: SupplierRow): SupplierCard {
  return {
    id: r.id,
    name: r.name,
    aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === "string") : [],
    legalName: r.legalName,
    taxNumber: r.taxNumber,
    taxOffice: r.taxOffice,
    iban: r.iban,
    bankName: r.bankName,
    accountHolder: r.accountHolder,
    contactName: r.contactName,
    phone: r.phone,
    email: r.email,
    address: r.address,
    paymentTermDays: r.paymentTermDays,
    paymentMethod: (r.paymentMethod as PaymentMethod | null) ?? null,
    paidOnDelivery: r.paidOnDelivery,
    note: r.note,
    hiddenOn: r.hiddenOn,
  };
}

export async function loadSupplierCards(): Promise<SupplierCard[]> {
  const rows = await getDb().select().from(s.suppliers).orderBy(asc(s.suppliers.name));
  return rows.map(toCard);
}

/**
 * Faturalardaki (ad, vergi no) çiftleri, tekrarsız: tedarikçiyi bulan her yer (adres parçası, ⌘K, vade günü, peşin
 * kuralı) aynı çiftlerle Tedarikçiler ekranıyla aynı eşleşmeyi kurar (supplierResolver). Tek sorgu, faturalar okunmaz.
 */
export async function loadSupplierRefs(): Promise<SupplierRef[]> {
  return getDb()
    .select({ supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber, date: sql<string>`max(${s.invoices.date})` })
    .from(s.invoices)
    .groupBy(s.invoices.supplier, s.invoices.supplierTaxNumber);
}

/**
 * Faturanın tedarikçisi (ad ve varsa vergi no) → kartındaki vade günü (yoksa null): Ödemeler'in, zilin, sabah
 * e-postasının ve ertelemenin tahmini vadesi. Vergi no verilmezse yalnız adla bulunur (ör. gelecek tahmini faturalar).
 */
export async function loadTermDays(): Promise<(supplier: string, taxNumber?: string | null) => number | null> {
  const [cards, refs] = await Promise.all([
    getDb()
      .select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber, paymentTermDays: s.suppliers.paymentTermDays })
      .from(s.suppliers),
    loadSupplierRefs(),
  ]);
  const { resolve } = supplierResolver(cards, refs);
  return (supplier, taxNumber) => resolve(supplier, taxNumber).card?.paymentTermDays ?? null;
}

/** Faturanın tedarikçisi → kartı peşin çalışılansa ("Faturaları ödendi gelsin") kartın ödeme şekli, değilse null */
export type PaidOnDelivery = (supplier: string, taxNumber?: string | null) => { paymentMethod: PaymentMethod | null } | null;

/**
 * Peşin çalışılan tedarikçiler: Paraşüt'ten gelen yeni faturaları ödendi açılır (fatura günü, kartın ödeme şekliyle;
 * newInvoicePayment). Tedarikçi Tedarikçiler'deki kuralla bulunur (ad önce, sonra vergi no): başka bir kartın adı peşin
 * karta düşmez, vergi noyla peşin karta bağlanan yeni ad da ödendi gelir.
 */
export async function loadPaidOnDelivery(): Promise<PaidOnDelivery> {
  const [cards, refs] = await Promise.all([
    getDb()
      .select({
        id: s.suppliers.id,
        name: s.suppliers.name,
        aliases: s.suppliers.aliases,
        taxNumber: s.suppliers.taxNumber,
        paidOnDelivery: s.suppliers.paidOnDelivery,
        paymentMethod: s.suppliers.paymentMethod,
      })
      .from(s.suppliers),
    loadSupplierRefs(),
  ]);
  const { resolve } = supplierResolver(cards, refs);
  return (supplier, taxNumber) => {
    const c = resolve(supplier, taxNumber).card;
    return c?.paidOnDelivery ? { paymentMethod: c.paymentMethod } : null;
  };
}

/** Ödeme takibinin başladığı gün (integration_state); db:reset siler, sonraki eşitleme yeniden belirler */
const PAYMENTS_SINCE_KEY = "payments.since";
/** İlk eşitlemede takip bu kadar gün geriden başlar: son ayın ödenmemiş olabilecek faturaları da takibe girer */
const PAYMENTS_LOOKBACK_DAYS = 30;

/**
 * Ödeme takibinin başlangıcı (YYYY-MM-DD). Paraşüt'ten bu günden eski bir fatura yeni gelirse (geçmişi yeniden alırken:
 * Tarihten eşitle) "ödenmedi" yığılmasın diye Paraşüt'teki durumuyla açılır
 * (newInvoicePayment). İlk çağrıda bugünden PAYMENTS_LOOKBACK_DAYS gün önce olarak kaydedilir.
 */
export async function loadPaymentsSince(): Promise<string> {
  const db = getDb();
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, PAYMENTS_SINCE_KEY)).limit(1);
  if (typeof row?.value === "string") return row.value;
  const since = addDays(todayTR(), -PAYMENTS_LOOKBACK_DAYS);
  await db.insert(s.integrationState).values({ key: PAYMENTS_SINCE_KEY, value: since }).onConflictDoNothing();
  return since;
}

/** Tedarikçiler ekranının fatura alanları (kalemler ve belge hariç) */
const LEDGER_COLUMNS = {
  id: s.invoices.id,
  date: s.invoices.date,
  supplier: s.invoices.supplier,
  description: s.invoices.description,
  invoiceNo: s.invoices.invoiceNo,
  category: s.invoices.category,
  amount: s.invoices.amount,
  discount: s.invoices.discount,
  payable: s.invoices.payable,
  unpaid: s.invoices.unpaid,
  note: s.invoices.note,
  outstanding: s.invoices.outstanding,
  allocated: s.invoices.allocated,
  ledgerBase: s.invoices.ledgerBase,
  paidByLedger: s.invoices.paidByLedger,
  dueDate: s.invoices.dueDate,
  paidAt: s.invoices.paidAt,
  paidVia: s.invoices.paidVia,
  paymentRequestedAt: s.invoices.paymentRequestedAt,
  parasutUnpaid: s.invoices.parasutUnpaid,
  source: s.invoices.source,
  origin: s.invoices.origin,
  externalId: s.invoices.externalId,
  eInvoiceId: s.invoices.eInvoiceId,
  needsReview: s.invoices.needsReview,
  supplierTaxNumber: s.invoices.supplierTaxNumber,
};

export async function loadLedgerInvoices() {
  return getDb().select(LEDGER_COLUMNS).from(s.invoices).orderBy(desc(s.invoices.date), desc(s.invoices.id));
}

export type LedgerRow = Awaited<ReturnType<typeof loadLedgerInvoices>>[number];

/**
 * Kartın adres parçası (/panel/tedarikciler/<parça>): listedeki ve tedarikçi sayfasındaki atamayla aynı, bütün kart
 * ve fatura adlarının anahtarlarından (assignSlugs). Kart kaydedilince sayfa yeni adrese geçer.
 */
export async function supplierSlugOf(cardId: number): Promise<string | null> {
  return (await slugGroups()).find((g) => g.card?.id === cardId)?.slug ?? null;
}

/**
 * Kartsız tedarikçinin (faturalardaki adlarından birinin anahtarı) adres parçası; listedeki atamayla aynı. Vergi noyla
 * birleşen adların grubu en küçük anahtarı taşır: verilen anahtar grubun adlarından biriyse de o grup bulunur.
 */
export async function supplierSlugOfKey(key: string): Promise<string | null> {
  const groups = await slugGroups();
  return (groups.find((g) => !g.card && g.key === key) ?? groups.find((g) => !g.card && g.keys.includes(key)))?.slug ?? null;
}

async function slugGroups() {
  const [cards, refs] = await Promise.all([loadSupplierCards(), loadSupplierRefs()]);
  // Yalnız (ad, vergi no) çiftleri gerekir: tutar ve tarih atamaya katılmaz
  return groupSuppliers(
    refs.map((r) => ({ ...r, date: r.date ?? "", payable: 0, unpaid: false })),
    cards,
    { today: todayTR(), termDays: 0 },
  );
}

/**
 * Tedarikçiler ekranının verisi: kartlar, faturalar tedarikçi tedarikçi (src/app/panel/tedarikciler/logic.ts) ve genel
 * vade günü. Bugün Türkiye saatine göre.
 */
export async function loadSupplierLedger() {
  const [cards, invoices, notify, entries] = await Promise.all([loadSupplierCards(), loadLedgerInvoices(), loadNotifySettings(), loadCardEntries()]);
  const today = todayTR();
  // Cari hesap (docs/TEDARIKCILER.md "Hesap hareketleri"): kartın elle kayıtları faturalarıyla birlikte; kayıt yokken
  // `account` faturaların özetiyle aynı
  const groups = groupSuppliers(invoices, cards, { today, termDays: notify.invoiceTermDays }).map((g) => {
    const mine = g.card ? cardEntries(entries, g.card.id) : null;
    // Faturasız alımın faturası olabilecek fatura (güçlü aday) mahsuptan atlanır (tedarikçi sayfasıyla aynı)
    const quiet =
      g.card && mine?.debts.some((d) => d.invoiceId === null)
        ? new Set(
            linkCandidates(
              [...mine.debts, ...entries.debts.filter((d) => d.invoiceId !== null && d.supplierId !== g.card!.id)],
              g.invoices.map((i) => ({ id: i.id, date: i.date, payable: i.payable, category: i.category })),
            ).strong.map((c) => c.invoiceId),
          )
        : undefined;
    const account = accountOf({ invoices: g.invoices, ...(mine ?? {}) }, { today, termDays: g.termDays, quietInvoiceIds: quiet });
    const lastEntry = mine ? [...mine.debts, ...mine.payments].reduce<string | null>((m, e) => (!m || e.date > m ? e.date : m), null) : null;
    // Ödeme kayıtları, en yeni önce (Claude'un tedarikci_ozeti'si: gün, tutar, şekil, sayıldığı kalem sayısı)
    const cariPayments = (mine?.payments ?? [])
      .map((p) => ({ date: p.date, amount: p.amount, method: p.method, items: mine!.allocations.filter((a) => a.paymentId === p.id).length }))
      .sort((a, b) => b.date.localeCompare(a.date));
    return { ...g, account, lastEntry, cariPayments };
  });
  return { today, termDays: notify.invoiceTermDays, groups };
}

/** Kartın kayıtları ve onlara (ya da onlardan) yazılan dağıtımlar */
function cardEntries(all: Awaited<ReturnType<typeof loadCardEntries>>, cardId: number) {
  const debts = all.debts.filter((d) => d.supplierId === cardId);
  const payments = all.payments.filter((p) => p.supplierId === cardId);
  if (!debts.length && !payments.length) return null;
  const ids = new Set([...debts.map((d) => d.id), ...payments.map((p) => p.id)]);
  return { debts, payments, allocations: all.allocations.filter((a) => ids.has(a.paymentId) || (a.debtId !== null && ids.has(a.debtId))) };
}

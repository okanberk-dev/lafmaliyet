import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { groupSuppliers, nameMoveBlock, nameMoves, PLACEHOLDER_SUPPLIER_NAME, supplierResolver, taxNameIndex } from "@/app/panel/tedarikciler/logic";
import {
  debtLabel,
  dueOf,
  fitAllocations,
  invoiceLabel,
  invoiceRoom,
  settlePatch,
  type AllocationLine,
  type LastAllocation,
  type LinkPrev,
} from "@/lib/cari/account";
import { coveredByAllocations, EPS, paidViaOf, round2, trackingBase, type CariMethod } from "@/lib/cari/balance";
import { linkableInvoice } from "@/lib/cari/match";
import { dateTR, tl } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { UserError } from "@/server/actions/util";
import { toCard } from "@/server/data/suppliers";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Cari hesabın veritabanına yazan tek yeri (docs/TEDARIKCILER.md "Hesap hareketleri"): ödemenin dağıtımı
 * (supplier_allocations), faturanın sayılan toplamı (`invoices.allocated`), takip tabanı (`ledger_base`) ve defterin
 * ödendi işareti (`paid_by_ledger`). Kurallar saf modüllerde (src/lib/cari); burası onları kilit altında uygular.
 *
 * Kilit sırası (K24): önce kart satırı (FOR UPDATE), sonra faturalar, sonra kayıtlar; faturalar ve kayıtlar kimlik
 * sırasıyla. Kart kimliği değişmez: aynı kartın iki ödemesi sırayla çalışır, aynı faturayı aşırı ödeyemez.
 * Her para işleminin sonunda recomputeAllocated + resettle çalışır.
 */

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const byId = (a: number, b: number) => a - b;
const uniq = (ids: Iterable<number>) => [...new Set(ids)].sort(byId);

// ---------------------------------------------------------------- Kart ve grup

/** Kart satırını kilitler (K24); yoksa kullanıcıya söylenir */
export async function lockCard(tx: Tx, cardId: number) {
  const [card] = await tx.select().from(s.suppliers).where(eq(s.suppliers.id, cardId)).for("update").limit(1);
  if (!card) throw new UserError("Tedarikçi bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
  return card;
}

/** Cari kaydının hedefi: sayfanın kartı ya da kartsız grubun adlarından birinin anahtarı (istemciden ad alınmaz) */
export type CardTarget = { cardId: number } | { key: string };

/**
 * Cari kaydının kartı (K2), kilitli. Kartı olan tedarikçide kart kilitlenir. Kartsız tedarikçiye ilk kayıtta yalnız
 * görünen adıyla bir kart açılır: removeSupplier'ın kuralı. Ad önce geldiği için o adla gelip vergi nosuyla başka
 * kartlarda duran faturalar da yeni karta geçecekse açılmaz (nameMoves); Paraşüt'ün geçici adına kart açılmaz. Grup
 * işlemin içinden okunur; aynı grubun iki ilk kaydı aynı kartı bulur (anahtar tekil).
 */
export async function ensureCard(tx: Tx, target: CardTarget): Promise<{ card: typeof s.suppliers.$inferSelect; created: boolean }> {
  if ("cardId" in target) return { card: await lockCard(tx, target.cardId), created: false };
  const [cards, rows] = await Promise.all([
    tx.select().from(s.suppliers),
    tx.select({ id: s.invoices.id, supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber, date: s.invoices.date }).from(s.invoices),
  ]);
  // Yalnız adlar ve vergi nosu gerekir: tutar ve ödeme durumu gruplamaya katılmaz
  const groups = groupSuppliers(
    rows.map((r) => ({ ...r, payable: 0, unpaid: false })),
    cards.map(toCard),
    { today: todayTR(), termDays: 0 },
  );
  // Sayfa açıldıktan sonra bu adla bir kart açılmış olabilir: o kart kullanılır
  const g = groups.find((x) => !x.card && x.keys.includes(target.key)) ?? groups.find((x) => x.card && x.keys.includes(target.key));
  if (!g) throw new UserError("Tedarikçi bulunamadı; başka bir oturumda değişmiş olabilir. Sayfayı yenileyin.");
  if (g.card) return { card: await lockCard(tx, g.card.id), created: false };
  if (g.key === supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME)) {
    throw new UserError("Bunlar Paraşüt'te adı okunamayan faturalar; sonraki eşitlemede gerçek tedarikçilerine geçer.");
  }
  const moves = nameMoves(taxNameIndex(groups), g.names, null);
  if (moves.count) throw new UserError(nameMoveBlock(g.name, moves, g.invoices.length, "bu tedarikçiye borç ya da ödeme girilse"));
  const key = supplierMatchKey(g.name);
  const [made] = await tx.insert(s.suppliers).values({ name: g.name, key, aliases: [] }).onConflictDoNothing({ target: s.suppliers.key }).returning({ id: s.suppliers.id });
  const [card] = await tx.select().from(s.suppliers).where(eq(s.suppliers.key, key)).for("update").limit(1);
  if (!card) throw new UserError("Tedarikçi bulunamadı; başka bir oturumda değişmiş olabilir. Sayfayı yenileyin.");
  return { card, created: Boolean(made) };
}

/** Kartlar kimlik sırasıyla kilitlenir (iki kartlı işlem, eşitlemenin son adımları) */
export async function lockCards(tx: Tx, cardIds: Iterable<number>) {
  for (const id of uniq(cardIds)) await tx.select({ id: s.suppliers.id }).from(s.suppliers).where(eq(s.suppliers.id, id)).for("update");
}

/** Faturaları kimlik sırasıyla kilitler ve okur */
export async function lockInvoices(tx: Tx, ids: Iterable<number>) {
  const list = uniq(ids);
  if (!list.length) return [];
  return tx.select().from(s.invoices).where(inArray(s.invoices.id, list)).orderBy(asc(s.invoices.id)).for("update");
}

/**
 * Faturanın tedarikçisini Tedarikçiler'deki kuralla bulan çözücü (supplierResolver: ad önce, sonra vergi no), işlemin
 * içinden okunarak
 */
export async function cardResolver(db: DB | Tx) {
  const [cards, refs] = await Promise.all([
    db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber }).from(s.suppliers),
    db.selectDistinct({ supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber }).from(s.invoices),
  ]);
  const { resolve } = supplierResolver(cards, refs);
  return (supplier: string, taxNumber?: string | null) => resolve(supplier, taxNumber).card?.id ?? null;
}

/** Kartın grubundaki faturaların kimlikleri (adı, diğer adları ve vergi noyla) */
export async function cardInvoiceIds(tx: Tx, cardId: number): Promise<number[]> {
  const [resolve, rows] = await Promise.all([cardResolver(tx), tx.select({ id: s.invoices.id, supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices)]);
  return rows.filter((r) => resolve(r.supplier, r.tax) === cardId).map((r) => r.id);
}

/**
 * Takibin başlaması (K4): kartın grubundaki tabanı boş faturalara Paraşüt'ün o ana kadar ödendi gösterdiği kısım
 * (ödenmemiş ve kısmen ödenmişte Ödenecek − kalan), ötekilere 0 yazılır. Kalan borç değişmez.
 */
export async function startTracking(tx: Tx, invoiceIds: readonly number[]) {
  const rows = await lockInvoices(tx, invoiceIds);
  for (const r of rows) {
    if (r.ledgerBase !== null) continue;
    await tx.update(s.invoices).set({ ledgerBase: trackingBase(r) }).where(eq(s.invoices.id, r.id));
  }
}

// ---------------------------------------------------------------- Dağıtım ve ödendi işareti

/**
 * Ödemenin dağıtımını yazar. Fatura hedefinin tabanı boşsa (sonradan gruba girmiş fatura) önce doldurulur. Toplamları
 * çağıran recomputeAllocated + resettle ile tazeler.
 */
export async function writeAllocations(tx: Tx, paymentId: number, lines: readonly AllocationLine[], by: string): Promise<number[]> {
  const real = lines.filter((l) => l.amount > EPS);
  if (!real.length) return [];
  const invoiceIds = real.filter((l) => l.kind === "invoice").map((l) => l.id);
  if (invoiceIds.length) {
    const missing = await tx.select({ id: s.invoices.id }).from(s.invoices).where(and(inArray(s.invoices.id, invoiceIds), isNull(s.invoices.ledgerBase)));
    if (missing.length) await startTracking(tx, missing.map((m) => m.id));
  }
  const rows = await tx
    .insert(s.supplierAllocations)
    .values(
      real.map((l) => ({
        paymentId,
        invoiceId: l.kind === "invoice" ? l.id : null,
        debtId: l.kind === "debt" ? l.id : null,
        amount: round2(l.amount),
        createdByName: by,
      })),
    )
    .returning({ id: s.supplierAllocations.id });
  return rows.map((r) => r.id);
}

/** Silinen dağıtımın alanları ("Geri al" ve işlem geçmişi) */
export interface RemovedAllocation {
  id: number;
  paymentId: number;
  invoiceId: number | null;
  debtId: number | null;
  originDebtId: number | null;
  amount: number;
}

/**
 * Dağıtımları siler: verilen kimlikler ya da bir ödemenin bütün dağıtımları (Ödemeden çıkar, Neye sayıldı'nın yeniden
 * yazımı, Borçlara say'ın geri alınması). Para ödemenin hesabına döner. Toplamları çağıran recomputeAllocated +
 * resettle ile tazeler; kart(lar) çağıranda kilitli olmalı.
 */
export async function deleteAllocations(tx: Tx, where: { ids: readonly number[] } | { paymentId: number }): Promise<RemovedAllocation[]> {
  if ("ids" in where && !where.ids.length) return [];
  const cond = "ids" in where ? inArray(s.supplierAllocations.id, uniq(where.ids)) : eq(s.supplierAllocations.paymentId, where.paymentId);
  return tx.delete(s.supplierAllocations).where(cond).returning({
    id: s.supplierAllocations.id,
    paymentId: s.supplierAllocations.paymentId,
    invoiceId: s.supplierAllocations.invoiceId,
    debtId: s.supplierAllocations.debtId,
    originDebtId: s.supplierAllocations.originDebtId,
    amount: s.supplierAllocations.amount,
  });
}

/** Hesaptaki paranın sayılabileceği kalem ve yeri (kalan) */
export interface CreditTarget {
  kind: "invoice" | "debt";
  id: number;
  room: number;
}

/**
 * Kartın hesabındaki parayı, en eski ödemeden başlayarak, verilen kalemlere verilen sırayla kalanlarına kadar sayar
 * (Borçlara say, Borç ekle'nin "Hesaptaki ödemeyi say"ı, Ödemeler'in "Ödendi"si). Kart kilitli olmalı; toplamları
 * çağıran tazeler. Döner: yazılan dağıtımlar ve kalem başına sayılan.
 */
export async function spendCredit(tx: Tx, cardId: number, targets: readonly CreditTarget[], by: string): Promise<{ allocationIds: number[]; used: Map<string, number>; total: number }> {
  const out = { allocationIds: [] as number[], used: new Map<string, number>(), total: 0 };
  const credits = (await paymentCredits(tx, cardId)).filter((p) => p.credit > EPS);
  if (!credits.length) return out;
  for (const t of targets) {
    let room = round2(t.room);
    for (const p of credits) {
      if (room <= EPS) break;
      if (p.credit <= EPS) continue;
      const take = round2(Math.min(room, p.credit));
      const [id] = await writeAllocations(tx, p.id, [{ kind: t.kind, id: t.id, amount: take }], by);
      if (id !== undefined) out.allocationIds.push(id);
      const k = `${t.kind}:${t.id}`;
      out.used.set(k, round2((out.used.get(k) ?? 0) + take));
      out.total = round2(out.total + take);
      p.credit = round2(p.credit - take);
      room = round2(room - take);
    }
  }
  return out;
}

/** `invoices.allocated`'ı dağıtımların toplamıyla yeniden yazar (K12: saklanan tek toplam, yalnız burada) */
export async function recomputeAllocated(tx: Tx, invoiceIds: Iterable<number>) {
  const ids = uniq(invoiceIds);
  if (!ids.length) return;
  const sums = await tx
    .select({ invoiceId: s.supplierAllocations.invoiceId, amount: s.supplierAllocations.amount })
    .from(s.supplierAllocations)
    .where(inArray(s.supplierAllocations.invoiceId, ids));
  const total = new Map<number, number>();
  for (const r of sums) if (r.invoiceId !== null) total.set(r.invoiceId, (total.get(r.invoiceId) ?? 0) + r.amount);
  for (const id of ids) {
    await tx
      .update(s.invoices)
      .set({ allocated: round2(total.get(id) ?? 0) })
      .where(and(eq(s.invoices.id, id), sql`${s.invoices.allocated} is distinct from ${round2(total.get(id) ?? 0)}`));
  }
}

/** Faturaya en son dağıtım yapan ödemenin günü ve şekli */
async function lastAllocations(tx: Tx, invoiceIds: readonly number[]): Promise<Map<number, LastAllocation & { id: number }>> {
  const out = new Map<number, LastAllocation & { id: number }>();
  if (!invoiceIds.length) return out;
  const rows = await tx
    .select({ invoiceId: s.supplierAllocations.invoiceId, id: s.supplierEntries.id, date: s.supplierEntries.date, method: s.supplierEntries.method })
    .from(s.supplierAllocations)
    .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
    .where(inArray(s.supplierAllocations.invoiceId, invoiceIds));
  for (const r of rows) {
    if (r.invoiceId === null || !r.method) continue;
    const cur = out.get(r.invoiceId);
    if (!cur || r.date > cur.date || (r.date === cur.date && r.id > cur.id)) out.set(r.invoiceId, { id: r.id, date: r.date, method: r.method });
  }
  return out;
}

export interface ResettleResult {
  closed: number[];
  reopened: number[];
}

/**
 * Dağıtımdan sonra ödendi işareti (§4.5, settlePatch): tamamen karşılanan ödenmemiş fatura defterle kapanır (gün ve
 * şekil son dağıtım yapan ödemeden), defterin kapattığı ama artık karşılanmayan fatura yeniden açılır. Elle konmuş
 * ödendi işaretine dokunulmaz.
 */
export async function resettle(tx: Tx, invoiceIds: Iterable<number>): Promise<ResettleResult> {
  const ids = uniq(invoiceIds);
  const out: ResettleResult = { closed: [], reopened: [] };
  if (!ids.length) return out;
  const rows = await lockInvoices(tx, ids);
  const last = await lastAllocations(tx, ids);
  for (const r of rows) {
    const patch = settlePatch(r, last.get(r.id) ?? null);
    if (!patch) continue;
    await tx.update(s.invoices).set(patch.set).where(eq(s.invoices.id, r.id));
    if (patch.action === "close") out.closed.push(r.id);
    if (patch.action === "reopen") out.reopened.push(r.id);
  }
  return out;
}

/** Faturaya sayılan dağıtımlar faturanın yerine sığmazsa (Ödenecek düştü) en yeniden kırpılır; kırpılan hesaba geçer */
export async function trimToFit(tx: Tx, invoiceIds: Iterable<number>): Promise<Map<number, number>> {
  const ids = uniq(invoiceIds);
  const trimmed = new Map<number, number>();
  if (!ids.length) return trimmed;
  const rows = await lockInvoices(tx, ids);
  for (const r of rows) {
    const allocs = await tx.select({ id: s.supplierAllocations.id, amount: s.supplierAllocations.amount }).from(s.supplierAllocations).where(eq(s.supplierAllocations.invoiceId, r.id));
    if (!allocs.length) continue;
    const fit = fitAllocations(allocs, invoiceRoom({ payable: r.payable, ledgerBase: r.ledgerBase, allocated: 0 }));
    if (fit.trimmed <= EPS) continue;
    for (const k of fit.keep) {
      const was = allocs.find((a) => a.id === k.id)!;
      if (Math.abs(was.amount - k.amount) > EPS) await tx.update(s.supplierAllocations).set({ amount: k.amount }).where(eq(s.supplierAllocations.id, k.id));
    }
    if (fit.drop.length) await tx.delete(s.supplierAllocations).where(inArray(s.supplierAllocations.id, fit.drop));
    trimmed.set(r.id, fit.trimmed);
  }
  return trimmed;
}

// ---------------------------------------------------------------- Hesaptaki para

/** Kartın ödemeleri ve her birinin hesapta duran kısmı, en eski önce */
export async function paymentCredits(tx: DB | Tx, cardId: number): Promise<{ id: number; date: string; method: CariMethod; credit: number }[]> {
  const payments = await tx
    .select({ id: s.supplierEntries.id, date: s.supplierEntries.date, amount: s.supplierEntries.amount, method: s.supplierEntries.method })
    .from(s.supplierEntries)
    .where(and(eq(s.supplierEntries.supplierId, cardId), eq(s.supplierEntries.kind, "odeme")))
    .orderBy(asc(s.supplierEntries.date), asc(s.supplierEntries.id));
  if (!payments.length) return [];
  const used = await tx
    .select({ paymentId: s.supplierAllocations.paymentId, amount: s.supplierAllocations.amount })
    .from(s.supplierAllocations)
    .where(inArray(s.supplierAllocations.paymentId, payments.map((p) => p.id)));
  const usedBy = new Map<number, number>();
  for (const u of used) usedBy.set(u.paymentId, (usedBy.get(u.paymentId) ?? 0) + u.amount);
  return payments.map((p) => ({ id: p.id, date: p.date, method: p.method ?? "diger", credit: round2(Math.max(0, p.amount - (usedBy.get(p.id) ?? 0))) }));
}

/** Hesabında sayılmamış ödeme olan kartlar (ucuz: ödeme kaydı yoksa boş döner) */
export async function cardsWithCredit(db: DB | Tx = getDb()): Promise<Map<number, number>> {
  const payments = await db
    .select({ id: s.supplierEntries.id, supplierId: s.supplierEntries.supplierId, amount: s.supplierEntries.amount })
    .from(s.supplierEntries)
    .where(eq(s.supplierEntries.kind, "odeme"));
  const out = new Map<number, number>();
  if (!payments.length) return out;
  const used = await db
    .select({ paymentId: s.supplierAllocations.paymentId, amount: s.supplierAllocations.amount })
    .from(s.supplierAllocations)
    .where(inArray(s.supplierAllocations.paymentId, payments.map((p) => p.id)));
  const usedBy = new Map<number, number>();
  for (const u of used) usedBy.set(u.paymentId, (usedBy.get(u.paymentId) ?? 0) + u.amount);
  for (const p of payments) {
    const c = round2(p.amount - (usedBy.get(p.id) ?? 0));
    if (c > EPS) out.set(p.supplierId, round2((out.get(p.supplierId) ?? 0) + c));
  }
  return out;
}

/**
 * Eşitlemenin yeni faturası için: faturanın kartı takipliyse (ödeme kaydı var) kartın kimliği, değilse null. Kart
 * kayıt yokken hiç sorgulanmaz.
 */
export async function trackedCardResolver(db: DB | Tx = getDb()): Promise<(supplier: string, taxNumber?: string | null) => number | null> {
  const tracked = await trackedCardIds(db);
  if (!tracked.size) return () => null;
  const resolve = await cardResolver(db);
  return (supplier, taxNumber) => {
    const c = resolve(supplier, taxNumber);
    return c !== null && tracked.has(c) ? c : null;
  };
}

/** Takipli kartlar: ödeme kaydı olan kartlar (yeni gelen fatura `ledger_base = 0` alır) */
export async function trackedCardIds(db: DB | Tx = getDb()): Promise<Set<number>> {
  const rows = await db.selectDistinct({ id: s.supplierEntries.supplierId }).from(s.supplierEntries).where(eq(s.supplierEntries.kind, "odeme"));
  return new Set(rows.map((r) => r.id));
}

export interface CreditUse {
  /** Yazılan dağıtımlar ("Geri al" önce bunları siler) */
  allocationIds: number[];
  /** Fatura → hesaptaki paradan sayılan tutar */
  used: Map<number, number>;
  /** Hesaptaki parayla tamamen karşılanıp defterle kapanan faturalar */
  closed: number[];
}

/**
 * Önce hesaptaki para (K6): faturalar ödendiye geçerken kartın hesabındaki para, en eski ödemeden başlayarak,
 * faturaların kalanına kadar vade sırasıyla dağıtılır. Tamamen karşılanan fatura defterle kapanır; kalanı çağıran
 * bugünkü gibi işaretler. Kart kilitli olmalı.
 */
export async function creditFirst(tx: Tx, cardId: number, invoiceIds: readonly number[], by: string, termDays = 30): Promise<CreditUse> {
  const out: CreditUse = { allocationIds: [], used: new Map(), closed: [] };
  const credits = (await paymentCredits(tx, cardId)).filter((p) => p.credit > EPS);
  if (!credits.length || !invoiceIds.length) return out;
  await startTracking(tx, invoiceIds);
  const rows = (await lockInvoices(tx, invoiceIds))
    .filter((r) => r.unpaid && r.payable > 0)
    .sort((a, b) => dueOf(a, termDays).date.localeCompare(dueOf(b, termDays).date) || a.date.localeCompare(b.date) || a.id - b.id);
  for (const r of rows) {
    let room = invoiceRoom(r);
    for (const p of credits) {
      if (room <= EPS) break;
      if (p.credit <= EPS) continue;
      const take = round2(Math.min(room, p.credit));
      const [id] = await writeAllocations(tx, p.id, [{ kind: "invoice", id: r.id, amount: take }], by);
      out.allocationIds.push(id);
      out.used.set(r.id, round2((out.used.get(r.id) ?? 0) + take));
      p.credit = round2(p.credit - take);
      room = round2(room - take);
    }
  }
  const touched = [...out.used.keys()];
  await recomputeAllocated(tx, touched);
  out.closed = (await resettle(tx, touched)).closed;
  return out;
}

// ---------------------------------------------------------------- "Ödenmedi" engeli (K7)

/**
 * Tamamen karşılanmış (dağıtımla kapanmış ya da kapanacak) faturada "Ödenmedi" ve "Talep edildi" reddedilir: ödeme
 * kaydının parası faturada durur. Kısmen sayılmış faturada izin verilir (yalnız işaretli kısım kalkar). Dört yazıcı
 * çağırır: applyPayment, saveInvoice, restoreInvoicePayment, undoRecentPaid.
 */
export async function assertNotCovered(db: DB | Tx, invoiceIds: readonly number[]) {
  const ids = uniq(invoiceIds);
  if (!ids.length) return;
  const rows = await db
    .select({ id: s.invoices.id, payable: s.invoices.payable, ledgerBase: s.invoices.ledgerBase, allocated: s.invoices.allocated, invoiceNo: s.invoices.invoiceNo, date: s.invoices.date, unpaid: s.invoices.unpaid })
    .from(s.invoices)
    .where(and(inArray(s.invoices.id, ids), isNotNull(s.invoices.ledgerBase), sql`${s.invoices.allocated} > 0`));
  const covered = rows.filter((r) => coveredByAllocations(r));
  if (!covered.length) return;
  const first = covered[0];
  const pays = await db
    .select({ date: s.supplierEntries.date })
    .from(s.supplierAllocations)
    .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
    .where(eq(s.supplierAllocations.invoiceId, first.id));
  const days = [...new Set(pays.map((p) => p.date))].sort().map((d) => dateTR(d).slice(0, 5));
  const from = days.length > 1 ? `${days.slice(0, -1).join(", ")} ve ${days.at(-1)} ödemelerinden` : `${days[0] ?? "cari"} ödemesinden`;
  const who = covered.length > 1 || ids.length > 1 ? `${invoiceLabel(first)}: ` : "";
  throw new UserError(`${who}Bu faturaya ${from} ${tl(first.allocated, 2)} sayılmış; ödenmedi yapmak için Hesap hareketleri'nde 'Ödemeden çıkar'.`);
}

// ---------------------------------------------------------------- Faturası geldi (bağlama) ve bağın çözülmesi

/** Borcun sahip olduğu gider kaydı ("gider" ve "mevcut") */
async function ownedExpense(tx: Tx, debtId: number) {
  const [e] = await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.supplierEntryId, debtId)).limit(1);
  return e ?? null;
}

export interface LinkResult {
  /** Bağlamanın sildiği gider kayıtları (geçmiş ay onayı ve işlem geçmişi için) */
  removedExpenses: { debtId: number; date: string; amount: number; categoryId: number }[];
  /** Faturaya sığmayıp hesaba geçen tutar */
  trimmed: number;
}

/**
 * "Faturası geldi" (§5.2): borçlar faturaya bağlanır (n → 1). Aynı işlemde borcun önceki hâli saklanır, borca sayılmış
 * ödemeler faturaya geçer (`origin_debt_id`; sığmayan en yeniden kırpılıp hesaba geçer), borcun gider kaydı silinir ve
 * fatura yeniden dengelenir. Kart(lar) çağıranda kilitli olmalı.
 */
export async function linkDebts(tx: Tx, debtIds: readonly number[], invoiceId: number): Promise<LinkResult> {
  const out: LinkResult = { removedExpenses: [], trimmed: 0 };
  const [inv] = await lockInvoices(tx, [invoiceId]);
  if (!inv) throw new UserError("Fatura bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  // Kafe dışı ve komisyon faturası kafenin mal alışına girmez: bağlama borcun gider kaydını siler, gider sessizce düşerdi
  if (!linkableInvoice(inv)) {
    throw new UserError(inv.payable > 0 ? `${inv.category} faturası kafenin mal alışına girmez; faturasız alım ona bağlanamaz.` : "İade faturasına faturasız alım bağlanamaz.");
  }
  const debts = await tx.select().from(s.supplierEntries).where(inArray(s.supplierEntries.id, uniq(debtIds))).orderBy(asc(s.supplierEntries.id)).for("update");
  if (debts.length !== new Set(debtIds).size) throw new UserError("Alım bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  for (const d of debts) {
    if (d.kind !== "borc") throw new UserError("Yalnız alımlar faturaya bağlanır.");
    if (d.invoiceId !== null) throw new UserError(`${debtLabel(d)} zaten bir faturaya bağlı; önce bağı kaldırın.`);
  }
  if (inv.ledgerBase === null) await startTracking(tx, [inv.id]);
  const now = new Date();
  for (const d of debts) {
    const exp = d.costMode === "gider" || d.costMode === "mevcut" ? await ownedExpense(tx, d.id) : null;
    const prev: LinkPrev = {
      costMode: d.costMode ?? "fatura",
      categoryId: d.categoryId,
      expense: exp
        ? { categoryId: exp.categoryId, description: exp.description, note: exp.note, amount: exp.amount, date: exp.date, id: exp.id, paymentMethod: exp.paymentMethod, createdBy: exp.createdBy }
        : null,
    };
    await tx.update(s.supplierEntries).set({ invoiceId: inv.id, linkedAt: now, linkPrev: prev, updatedAt: now }).where(eq(s.supplierEntries.id, d.id));
    if (exp) {
      await tx.delete(s.expenseEntries).where(eq(s.expenseEntries.id, exp.id));
      out.removedExpenses.push({ debtId: d.id, date: exp.date, amount: exp.amount, categoryId: exp.categoryId });
    }
  }
  // Borca sayılmış ödemeler faturaya geçer; nereden geldikleri saklanır (bağ kaldırılınca geri döner)
  await tx
    .update(s.supplierAllocations)
    .set({ invoiceId: inv.id, originDebtId: sql`${s.supplierAllocations.debtId}`, debtId: null })
    .where(inArray(s.supplierAllocations.debtId, debts.map((d) => d.id)));
  out.trimmed = (await trimToFit(tx, [inv.id])).get(inv.id) ?? 0;
  await recomputeAllocated(tx, [inv.id]);
  await resettle(tx, [inv.id]);
  return out;
}

/**
 * Tek bir borcun bağını çözer (bağ kaldırma ve fatura silinmeden önce): faturaya borçtan gelmiş dağıtımlar borca
 * döner (yer yoksa kırpılır, para hesaba geçer), önceki kip ve kategori geri gelir, gider kaydı yeniden yazılır.
 * Faturayı çağıran yeniden dengeler. Döner: yeniden yazılan gider (varsa).
 */
async function releaseDebt(tx: Tx, debt: typeof s.supplierEntries.$inferSelect, invoiceId: number, by: string) {
  const moved = await tx
    .update(s.supplierAllocations)
    .set({ debtId: debt.id, invoiceId: null, originDebtId: null })
    .where(and(eq(s.supplierAllocations.invoiceId, invoiceId), eq(s.supplierAllocations.originDebtId, debt.id)))
    .returning({ id: s.supplierAllocations.id, amount: s.supplierAllocations.amount });
  if (moved.length) {
    const all = await tx.select({ id: s.supplierAllocations.id, amount: s.supplierAllocations.amount }).from(s.supplierAllocations).where(eq(s.supplierAllocations.debtId, debt.id));
    const fit = fitAllocations(all, debt.amount);
    for (const k of fit.keep) {
      const was = all.find((a) => a.id === k.id)!;
      if (Math.abs(was.amount - k.amount) > EPS) await tx.update(s.supplierAllocations).set({ amount: k.amount }).where(eq(s.supplierAllocations.id, k.id));
    }
    if (fit.drop.length) await tx.delete(s.supplierAllocations).where(inArray(s.supplierAllocations.id, fit.drop));
  }
  const prev = debt.linkPrev;
  const costMode = prev?.costMode ?? "fatura";
  // Bağlıyken silinmiş kategori geri yazılmaz (yabancı anahtar)
  const wanted = [prev?.categoryId, prev?.expense?.categoryId].filter((x): x is number => typeof x === "number");
  const alive = new Set(
    wanted.length ? (await tx.select({ id: s.expenseCategories.id }).from(s.expenseCategories).where(inArray(s.expenseCategories.id, wanted))).map((c) => c.id) : [],
  );
  const categoryId = prev?.categoryId != null && alive.has(prev.categoryId) ? prev.categoryId : null;
  let expense: { date: string; amount: number; categoryId: number } | null = null;
  let adoptPrev = debt.adoptPrev ?? null;
  if (prev?.expense && (costMode === "gider" || costMode === "mevcut") && alive.has(prev.expense.categoryId)) {
    const e = prev.expense;
    // Kayıt eski kimliğiyle (boştaysa), ödeme şekli ve yazanıyla geri gelir: Aylık harcamalar'daki bağlantılar bozulmasın
    const [taken] = e.id ? await tx.select({ id: s.expenseEntries.id }).from(s.expenseEntries).where(eq(s.expenseEntries.id, e.id)).limit(1) : [];
    const [row] = await tx
      .insert(s.expenseEntries)
      .values({
        ...(e.id && !taken ? { id: e.id } : {}),
        date: e.date,
        categoryId: e.categoryId,
        description: e.description,
        amount: e.amount,
        note: e.note,
        paymentMethod: e.paymentMethod ?? null,
        createdBy: e.createdBy ?? by,
        supplierEntryId: debt.id,
      })
      .returning({ id: s.expenseEntries.id });
    expense = { date: e.date, amount: e.amount, categoryId: e.categoryId };
    // "Gideri zaten girildi": sahiplenilen kayıt yeni kimlikle döndüyse eski değerleri ona bağlı kalır
    if (adoptPrev && e.id && adoptPrev.id === e.id && row.id !== e.id) adoptPrev = { ...adoptPrev, id: row.id };
  }
  // Gideri geri gelmeyen "gider" ya da "mevcut" kipi (kategori ya da kayıt yok) faturası gelecek sayılır: CHECK kategori ister
  const mode = (costMode === "gider" && categoryId === null) || (costMode === "mevcut" && !expense) ? "fatura" : costMode;
  await tx
    .update(s.supplierEntries)
    .set({ invoiceId: null, linkedAt: null, linkPrev: null, costMode: mode, categoryId, adoptPrev: mode === "mevcut" ? adoptPrev : null, updatedAt: new Date() })
    .where(eq(s.supplierEntries.id, debt.id));
  return expense;
}

/** Bağ kaldırma (§5.2): borç bağsız olur, önceki hâli geri gelir; fatura yeniden dengelenir. Kart kilitli olmalı. */
export async function unlinkDebt(tx: Tx, debtId: number, by: string) {
  const [debt] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debtId)).for("update").limit(1);
  if (!debt || debt.kind !== "borc") throw new UserError("Alım bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  if (debt.invoiceId === null) throw new UserError("Bu alım bir faturaya bağlı değil.");
  const invoiceId = debt.invoiceId;
  await lockInvoices(tx, [invoiceId]);
  const expense = await releaseDebt(tx, debt, invoiceId, by);
  await recomputeAllocated(tx, [invoiceId]);
  const settled = await resettle(tx, [invoiceId]);
  return { invoiceId, expense, reopened: settled.reopened.length > 0 };
}

/** Silinen faturanın cari bağları: geri alınınca yeniden kurulur (reattachInvoiceLinks) */
export interface InvoiceLinks {
  /** Faturaya doğrudan sayılmış ödemeler (silinince hesaba geçer) */
  allocations: { paymentId: number; amount: number; originDebtId: number | null }[];
  /** Faturaya bağlı borçlar (silinince eski hâline döner) */
  debtIds: number[];
}

/**
 * Fatura silinmeden önce bağları çözülür (K11; elle silme, Paraşüt iptali, e-fatura yolu): bağlı borçlar eski hâline
 * döner, borçtan gelen dağıtımlar borca taşınır; kalan dağıtımlar fatura silinince CASCADE ile kalkar ve para
 * ödemenin hesabına geçer. Satırın dağıtımı ya da bağlı borcu yoksa hiçbir şey yazılmaz. Kartların kilidi: ödemelerin
 * ve borçların kartları kimlik sırasıyla.
 */
export async function releaseInvoiceLinks(tx: Tx, invoiceId: number, by = "Sistem"): Promise<InvoiceLinks & { expenses: { date: string; amount: number; categoryId: number }[] }> {
  const out = { allocations: [] as InvoiceLinks["allocations"], debtIds: [] as number[], expenses: [] as { date: string; amount: number; categoryId: number }[] };
  const [allocs, debts] = await Promise.all([
    tx
      .select({ id: s.supplierAllocations.id, paymentId: s.supplierAllocations.paymentId, amount: s.supplierAllocations.amount, originDebtId: s.supplierAllocations.originDebtId, card: s.supplierEntries.supplierId })
      .from(s.supplierAllocations)
      .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
      .where(eq(s.supplierAllocations.invoiceId, invoiceId)),
    tx.select({ id: s.supplierEntries.id, card: s.supplierEntries.supplierId }).from(s.supplierEntries).where(eq(s.supplierEntries.invoiceId, invoiceId)),
  ]);
  if (!allocs.length && !debts.length) return out;
  await lockCards(tx, [...allocs.map((a) => a.card), ...debts.map((d) => d.card)]);
  await lockInvoices(tx, [invoiceId]);
  const linked = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.invoiceId, invoiceId)).orderBy(asc(s.supplierEntries.id)).for("update");
  for (const d of linked) {
    const e = await releaseDebt(tx, d, invoiceId, by);
    if (e) out.expenses.push(e);
    out.debtIds.push(d.id);
  }
  const rest = await tx
    .select({ paymentId: s.supplierAllocations.paymentId, amount: s.supplierAllocations.amount, originDebtId: s.supplierAllocations.originDebtId })
    .from(s.supplierAllocations)
    .where(eq(s.supplierAllocations.invoiceId, invoiceId))
    .orderBy(asc(s.supplierAllocations.id));
  out.allocations = rest.map((r) => ({ paymentId: r.paymentId, amount: r.amount, originDebtId: r.originDebtId }));
  return out;
}

/**
 * Silinen fatura geri gelince (yeni kimlikle) bağları yeniden kurulur: borç hâlâ bağsızsa yeniden bağlanır, ödemenin
 * hesabında yer varsa dağıtım yeniden yazılır; yoksa para hesapta kalır. Döner: yeniden yazılamayan tutar.
 */
export async function reattachInvoiceLinks(
  tx: Tx,
  invoiceId: number,
  links: InvoiceLinks,
  by: string,
  owner: { supplier: string; taxNumber: string | null },
): Promise<{ relinked: number; lost: number }> {
  let lost = 0;
  // Yalnız faturanın kartının kayıtları (kopya istemciden gelir: yeniden doğrulanır, başka kartın parası sayılmaz)
  const cardId = (await cardResolver(tx))(owner.supplier, owner.taxNumber);
  const mine = <R extends { card: number }>(rows: R[]) => rows.filter((r) => cardId !== null && r.card === cardId);
  const payments = links.allocations.length
    ? mine(
        await tx
          .select({ id: s.supplierEntries.id, card: s.supplierEntries.supplierId })
          .from(s.supplierEntries)
          .where(and(inArray(s.supplierEntries.id, uniq(links.allocations.map((a) => a.paymentId))), eq(s.supplierEntries.kind, "odeme"))),
      )
    : [];
  const debts = links.debtIds.length
    ? mine(
        await tx
          .select({ id: s.supplierEntries.id, card: s.supplierEntries.supplierId, invoiceId: s.supplierEntries.invoiceId, kind: s.supplierEntries.kind })
          .from(s.supplierEntries)
          .where(inArray(s.supplierEntries.id, uniq(links.debtIds))),
      )
    : [];
  await lockCards(tx, [...payments.map((p) => p.card), ...debts.map((d) => d.card)]);
  const free = debts.filter((d) => d.kind === "borc" && d.invoiceId === null).map((d) => d.id);
  if (free.length) await linkDebts(tx, free, invoiceId);
  const credits = new Map<number, number>();
  for (const card of new Set(payments.map((p) => p.card))) for (const p of await paymentCredits(tx, card)) credits.set(p.id, p.credit);
  for (const a of links.allocations) {
    const [inv] = await lockInvoices(tx, [invoiceId]);
    if (!inv) break;
    const take = round2(Math.min(a.amount, credits.get(a.paymentId) ?? 0, invoiceRoom(inv)));
    if (take > EPS) {
      await writeAllocations(tx, a.paymentId, [{ kind: "invoice", id: invoiceId, amount: take }], by);
      credits.set(a.paymentId, round2((credits.get(a.paymentId) ?? 0) - take));
      await recomputeAllocated(tx, [invoiceId]);
    }
    lost = round2(lost + a.amount - Math.max(0, take));
  }
  await recomputeAllocated(tx, [invoiceId]);
  await resettle(tx, [invoiceId]);
  return { relinked: free.length, lost };
}

// ---------------------------------------------------------------- Eşitlemenin son adımları (K20, K21)

/** Faturanın dağıtımlarını yapan ödemelerin kartları */
async function allocationCards(db: DB | Tx, invoiceIds: readonly number[]): Promise<Map<number, number[]>> {
  const rows = invoiceIds.length
    ? await db
        .selectDistinct({ invoiceId: s.supplierAllocations.invoiceId, card: s.supplierEntries.supplierId })
        .from(s.supplierAllocations)
        .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
        .where(inArray(s.supplierAllocations.invoiceId, [...invoiceIds]))
    : [];
  const out = new Map<number, number[]>();
  for (const r of rows) if (r.invoiceId !== null) out.set(r.invoiceId, [...(out.get(r.invoiceId) ?? []), r.card]);
  return out;
}

/**
 * Eşitlemede tutarı değişen ve dağıtımı olan faturalar (K20): tutar düştüyse fazla sayılan para en yeni dağıtımdan
 * kırpılıp hesaba geçer; tutar arttıysa defterin kapattığı fatura yeniden açılır. Her kart (faturanın dağıtımını yapan
 * ödemelerin kartları) için ayrı kısa işlem; "Sistem" kaydı. Hatası eşitlemeyi bozmaz (çağıran yakalar).
 */
export async function resettleAfterSync(changes: readonly { id: number; from: number; to: number }[]): Promise<{ moved: number; movedInvoices: number; reopened: number; invoices: number }> {
  const db = getDb();
  const out = { moved: 0, movedInvoices: 0, reopened: 0, invoices: 0 };
  if (!changes.length) return out;
  const cards = await allocationCards(db, changes.map((c) => c.id));
  for (const c of changes) {
    const cardIds = cards.get(c.id);
    if (!cardIds?.length) {
      // Dağıtımı olmayan takipli fatura: tutar takip öncesi kısma indiyse (kalan 0) kapanır, ödenmedi görünmesin
      const settled = await db.transaction(async (tx) => {
        const [inv] = await lockInvoices(tx, [c.id]);
        return inv && inv.ledgerBase !== null ? resettle(tx, [c.id]) : null;
      });
      if (settled?.closed.length) out.invoices++;
      continue;
    }
    const r = await db.transaction(async (tx) => {
      await lockCards(tx, cardIds);
      const trimmed = (await trimToFit(tx, [c.id])).get(c.id) ?? 0;
      await recomputeAllocated(tx, [c.id]);
      const settled = await resettle(tx, [c.id]);
      const [inv] = await tx.select({ invoiceNo: s.invoices.invoiceNo, date: s.invoices.date }).from(s.invoices).where(eq(s.invoices.id, c.id)).limit(1);
      return { trimmed, reopened: settled.reopened.length, label: inv ? invoiceLabel(inv) : `#${c.id}` };
    });
    out.invoices++;
    out.moved = round2(out.moved + r.trimmed);
    if (r.trimmed > EPS) out.movedInvoices++;
    out.reopened += r.reopened;
    const parts = [`${r.label} ${tl(c.from, 2)} → ${tl(c.to, 2)}`, r.trimmed > EPS ? `${tl(r.trimmed, 2)} hesaba geçti` : "", r.reopened ? "fatura yeniden ödenmedi" : ""].filter(Boolean);
    await logActivity(null, "Sistem · Fatura tutarı değişti", parts.join(" · "));
  }
  return out;
}

/**
 * Peşin çalışılan takipli kartın hesabında para varken Paraşüt'ten yeni fatura gelince (K21) önce hesaptaki para
 * faturaya sayılır, bir kez, fatura geldiği anda. Tamamen karşılanırsa fatura defterle kapanmış sayılır (gün ve şekil
 * ödemeden); kısmen karşılanırsa peşin işaret kalır (kalanı faturada işaretli ödeme). Kart başına ayrı işlem.
 */
export async function applyCreditOnArrival(arrivals: readonly { id: number; cardId: number }[]): Promise<{ invoices: number; amount: number }> {
  const db = getDb();
  const out = { invoices: 0, amount: 0 };
  for (const a of [...arrivals].sort((x, y) => x.cardId - y.cardId || x.id - y.id)) {
    const r = await db.transaction(async (tx) => {
      await lockCard(tx, a.cardId);
      const credits = (await paymentCredits(tx, a.cardId)).filter((p) => p.credit > EPS);
      if (!credits.length) return null;
      const [inv] = await lockInvoices(tx, [a.id]);
      if (!inv || inv.payable <= 0 || inv.paidByLedger) return null;
      if (inv.ledgerBase === null) await startTracking(tx, [inv.id]);
      let room = invoiceRoom({ ...inv, ledgerBase: inv.ledgerBase ?? 0 });
      let used = 0;
      let last: (typeof credits)[number] | null = null;
      for (const p of credits) {
        if (room <= EPS) break;
        const take = round2(Math.min(room, p.credit));
        await writeAllocations(tx, p.id, [{ kind: "invoice", id: inv.id, amount: take }], "Sistem");
        used = round2(used + take);
        room = round2(room - take);
        last = p;
      }
      if (used <= EPS) return null;
      await recomputeAllocated(tx, [inv.id]);
      const [now] = await lockInvoices(tx, [inv.id]);
      if (now && coveredByAllocations(now) && last) {
        await tx
          .update(s.invoices)
          .set({ unpaid: false, paidAt: last.date, paidVia: paidViaOf(last.method), paymentRequestedAt: null, paidByLedger: true })
          .where(eq(s.invoices.id, inv.id));
      } else await resettle(tx, [inv.id]);
      return { used, label: invoiceLabel(inv), supplier: inv.supplier };
    });
    if (!r) continue;
    out.invoices++;
    out.amount = round2(out.amount + r.used);
    await logActivity(null, "Sistem · Peşin faturaya hesaptaki ödeme sayıldı", `${r.supplier} · ${r.label} · ${tl(r.used, 2)}`);
  }
  return out;
}

// ---------------------------------------------------------------- Var olan eylemlerin kullandıkları

/**
 * Faturalar ödendiye geçerken hesaptaki para önce (applyPayment, saveInvoice): faturaların kartları bulunur, hesabında
 * para olan her kart için ayrı işlemde creditFirst. Hiçbir kartın hesabında para yoksa (cari kaydı yoksa hep) tek bir
 * okumadan sonra döner: davranış bugünküyle aynı.
 */
export async function creditFirstForInvoices(invoiceIds: readonly number[], by: string): Promise<CreditUse> {
  const out: CreditUse = { allocationIds: [], used: new Map(), closed: [] };
  if (!invoiceIds.length) return out;
  const db = getDb();
  const credit = await cardsWithCredit(db);
  if (!credit.size) return out;
  const [resolve, rows] = await Promise.all([
    cardResolver(db),
    db.select({ id: s.invoices.id, supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices).where(inArray(s.invoices.id, uniq(invoiceIds))),
  ]);
  const byCard = new Map<number, number[]>();
  for (const r of rows) {
    const c = resolve(r.supplier, r.tax);
    if (c !== null && credit.has(c)) byCard.set(c, [...(byCard.get(c) ?? []), r.id]);
  }
  for (const [cardId, ids] of [...byCard].sort((a, b) => a[0] - b[0])) {
    const r = await db.transaction(async (tx) => {
      const card = await lockCard(tx, cardId);
      return creditFirst(tx, cardId, ids, by, card.paymentTermDays ?? 30);
    });
    out.allocationIds.push(...r.allocationIds);
    for (const [k, v] of r.used) out.used.set(k, v);
    out.closed.push(...r.closed);
  }
  return out;
}

/** Elle ya da Excel'den eklenen faturanın tabanı: kartı takipliyse 0 (yalnız panel sayar), değilse boş */
export async function ledgerBaseForNew(supplier: string, taxNumber: string | null, db: DB | Tx = getDb()): Promise<number | null> {
  const tracked = await trackedCardIds(db);
  if (!tracked.size) return null;
  const card = (await cardResolver(db))(supplier, taxNumber);
  return card !== null && tracked.has(card) ? 0 : null;
}

/**
 * "Geri al": ✓'nin hesaptaki paradan yazdığı dağıtımlar silinir (yalnız verilen faturalarınkiler), faturalar yeniden
 * dengelenir. Ödemenin parası hesaba döner.
 */
export async function dropAllocations(allocationIds: readonly number[], invoiceIds: readonly number[]) {
  const ids = uniq(allocationIds);
  if (!ids.length || !invoiceIds.length) return;
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: s.supplierAllocations.id, invoiceId: s.supplierAllocations.invoiceId, card: s.supplierEntries.supplierId })
      .from(s.supplierAllocations)
      .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
      .where(and(inArray(s.supplierAllocations.id, ids), inArray(s.supplierAllocations.invoiceId, uniq(invoiceIds))));
    if (!rows.length) return;
    await lockCards(tx, rows.map((r) => r.card));
    await tx.delete(s.supplierAllocations).where(inArray(s.supplierAllocations.id, rows.map((r) => r.id)));
    const touched = rows.map((r) => r.invoiceId!).filter((x) => x !== null);
    await recomputeAllocated(tx, touched);
    await resettle(tx, touched);
  });
}

/**
 * Tutarı değişen elle faturanın dağıtımları ve ödendi işareti: sığmayan dağıtım en yeniden kırpılıp hesaba geçer,
 * Ödenecek arttıysa defterin kapattığı fatura açılır, takip öncesi kısım ve dağıtımlar tamamen karşılıyorsa kapanır.
 * Dağıtımı olmayan takipli fatura da dengelenir (yalnız fatura kilitlenir). Takipsiz faturada iş yok.
 */
export async function resettleInvoices(invoiceIds: readonly number[]) {
  const ids = uniq(invoiceIds);
  if (!ids.length) return;
  const cards = await allocationCards(getDb(), ids);
  await getDb().transaction(async (tx) => {
    await lockCards(tx, [...cards.values()].flat());
    await trimToFit(tx, cards.keys());
    await recomputeAllocated(tx, ids);
    await resettle(tx, ids);
  });
}

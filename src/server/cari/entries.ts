import "server-only";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { splitSupplier } from "@/app/panel/faturalar/rules";
import { cleanAliases, nameConflict } from "@/app/panel/tedarikciler/logic";
import {
  allocateFifo,
  compareOpenItems,
  debtLabel,
  dueOf,
  invoiceLabel,
  invoiceRoom,
  netCredit,
  openItems,
  validateManual,
  type AllocationLine,
  type CariAllocation,
  type CostMode,
  type OpenItem,
} from "@/lib/cari/account";
import { EPS, round2, type CariMethod } from "@/lib/cari/balance";
import { candidateOf, linkCandidates } from "@/lib/cari/match";
import { missingPastConfirm, pastMonthEffects, type MonthEffect } from "@/lib/cari/months";
import { businessDate } from "@/lib/cash-report";
import { dateTR, tl } from "@/lib/format";
import { linkedUntil, RELEASED_DAYS } from "@/lib/photo-rules";
import { paymentUnchanged, type RecentPaid } from "@/lib/recent-paid";
import { daysBetween, todayTR } from "@/lib/reminders";
import { UserError } from "@/server/actions/util";
import { toDebt } from "@/server/data/cari";
import { currentExpenseBranch, currentTillBranch } from "@/server/branch-scope";
import { schema as s } from "@/server/db";
import { getPhoto, keepPhoto, releasePhoto } from "@/server/storage/photos";

import {
  cardInvoiceIds,
  cardResolver,
  deleteAllocations,
  linkDebts,
  lockCard,
  lockCards,
  lockInvoices,
  paymentCredits,
  recomputeAllocated,
  resettle,
  spendCredit,
  startTracking,
  writeAllocations,
  type RemovedAllocation,
  type Tx,
} from "./settle";

/**
 * Cari kayıtlarının yazımı (borç ve ödeme; docs/TEDARIKCILER.md "Hesap hareketleri"): src/server/actions/cari.ts'in
 * eylemleri ve Ödemeler'in "Son ödenenler"i bunları çağırır. Kurallar saf modüllerde (src/lib/cari), dağıtım ve ödeme
 * durumu src/server/cari/settle.ts'te; burası kayıt, gider kaydı, Kasa satırı ve fotoğraf bağlarını aynı işlemde yazar.
 * Kilit sırası (K24): önce kart, sonra faturalar, sonra kayıtlar.
 */

export interface Actor {
  id: number;
  name: string;
}

export type Card = typeof s.suppliers.$inferSelect;
type EntryRow = typeof s.supplierEntries.$inferSelect;
type ExpenseRow = typeof s.expenseEntries.$inferSelect;
type CashOutRow = typeof s.cashOuts.$inferSelect;

const GONE = "Kayıt bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.";
const PHOTO_GONE = "Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin";

/** Geçmiş ay onayı eksik (K18): işlem yazılmadan geri döner, istemci ayları gösterip onay ister */
export class NeedsPastConfirm extends Error {
  constructor(readonly effects: MonthEffect[]) {
    super("Geçmiş ay onayı gerekli");
  }
}

/** Gider değişimlerinin geçmiş aylara etkisi; onaylanmamış ay varsa işlem durur (NeedsPastConfirm) */
export function checkPast(changes: readonly { date: string; delta: number }[], confirmed: readonly string[]): MonthEffect[] {
  const effects = pastMonthEffects(changes, todayTR());
  if (missingPastConfirm(effects, confirmed)) throw new NeedsPastConfirm(effects);
  return effects;
}

/** Satırın zaman damgaları olmadan kopyası (geri alma kopyası JSON'a yazılır; yeniden yazılırken damgalar yenilenir) */
function withoutStamps<T extends { createdAt: Date; updatedAt?: Date }>(row: T): Omit<T, "createdAt" | "updatedAt"> {
  const copy: Partial<T> = { ...row };
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as Omit<T, "createdAt" | "updatedAt">;
}

const toAllocation = (a: typeof s.supplierAllocations.$inferSelect): CariAllocation => ({
  id: a.id,
  paymentId: a.paymentId,
  invoiceId: a.invoiceId,
  debtId: a.debtId,
  originDebtId: a.originDebtId,
  amount: a.amount,
});

// ---------------------------------------------------------------- Kartın hesabı, kilit altında

export interface LockedAccount {
  invoiceIds: number[];
  invoices: (typeof s.invoices.$inferSelect)[];
  debts: EntryRow[];
  /** Ödemenin sayılabileceği kalemler, dağıtım sırasıyla; güçlü fatura adayı `quiet: "link"` */
  items: OpenItem[];
}

/**
 * Kartın grubu kilit altında (K24): faturalar kimlik sırasıyla, sonra kartın borçları. Açık kalemler kalanlarıyla
 * (fatura: openBalance, borç: tutar − sayılanlar). Faturasız alımın faturası olabilecek fatura (güçlü aday, K17)
 * `quiet: "link"` taşır: "En eski borçtan" ve "Borçlara say" onu atlar, aynı mal iki kez ödenmez.
 */
export async function lockAccount(tx: Tx, cardId: number, termDays: number): Promise<LockedAccount> {
  const invoiceIds = await cardInvoiceIds(tx, cardId);
  const invoices = await lockInvoices(tx, invoiceIds);
  const debts = await tx
    .select()
    .from(s.supplierEntries)
    .where(and(eq(s.supplierEntries.supplierId, cardId), eq(s.supplierEntries.kind, "borc")))
    .orderBy(asc(s.supplierEntries.id))
    .for("update");
  const allocations = debts.length ? (await tx.select().from(s.supplierAllocations).where(inArray(s.supplierAllocations.debtId, debts.map((d) => d.id)))).map(toAllocation) : [];
  // Başka kartın bu faturalara bağlı borçları da "bağlı fatura" sayılır (aday olmaz)
  const others = invoiceIds.length ? await tx.select().from(s.supplierEntries).where(and(inArray(s.supplierEntries.invoiceId, invoiceIds), ne(s.supplierEntries.supplierId, cardId))) : [];
  const cariDebts = debts.map(toDebt);
  const { strong } = linkCandidates(
    [...cariDebts, ...others.map(toDebt)],
    invoices.map(candidateOf),
  );
  const quiet = new Set(strong.map((c) => c.invoiceId));
  const items = openItems({ invoices, debts: cariDebts, allocations }, termDays).map((it) => (it.kind === "invoice" && quiet.has(it.id) ? { ...it, quiet: "link" as const } : it));
  return { invoiceIds, invoices, debts, items };
}

/** Borca sayılan toplam */
async function debtAllocated(tx: Tx, debtId: number): Promise<number> {
  const [r] = await tx
    .select({ total: sql<number>`coalesce(sum(${s.supplierAllocations.amount}), 0)` })
    .from(s.supplierAllocations)
    .where(eq(s.supplierAllocations.debtId, debtId));
  return round2(Number(r?.total ?? 0));
}

/** Ödemenin sayılan toplamı */
async function paymentAllocated(tx: Tx, paymentId: number): Promise<number> {
  const [r] = await tx
    .select({ total: sql<number>`coalesce(sum(${s.supplierAllocations.amount}), 0)` })
    .from(s.supplierAllocations)
    .where(eq(s.supplierAllocations.paymentId, paymentId));
  return round2(Number(r?.total ?? 0));
}

/** Fotoğraf (irsaliye, el fişi, dekont): yeni seçilen bağlanır (fiş gibi 400 gün), değişen eskisi bırakılır */
async function linkPhoto(tx: Tx, photoId: number | null, prevId: number | null, date: string) {
  if (photoId && photoId !== prevId) {
    const p = await getPhoto(photoId, tx);
    const expired = !p || (p.expiresAt !== null && p.expiresAt.getTime() <= Date.now());
    if (expired || p.kind !== "fis" || p.linkedAt !== null) throw new UserError(PHOTO_GONE);
  }
  if (photoId) await keepPhoto(photoId, linkedUntil("fis", date, todayTR()), tx);
  if (prevId && prevId !== photoId) await releasePhoto(prevId, RELEASED_DAYS, tx);
}

// ---------------------------------------------------------------- Ödeme

/** Kasadan ödemenin Kasa satırı: o günün işlenmemiş Teslim satırı ya da yeni satır */
export type CashOutChoice = { mode: "existing"; id: number } | { mode: "new" };

export interface PaymentWrite {
  id: number | null;
  date: string;
  amount: number;
  method: CariMethod;
  cashOut: CashOutChoice | null;
  /** Yalnız yeni ödemede: En eski borçtan, Seçerek, Hesapta beklesin (düzeltmede dağıtım "Neye sayıldı"dan) */
  allocation: { mode: "auto" | "manual" | "none"; lines: readonly AllocationLine[] };
  note: string | null;
  photoId: number | null;
}

export interface PaymentResult {
  id: number;
  created: boolean;
  /** Bu yazımda sayılan kalemler (adıyla) */
  lines: { kind: "invoice" | "debt"; id: number; amount: number; label: string; closed: boolean }[];
  /** Hesapta kalan (ödemenin sayılmamış kısmı) */
  left: number;
  preview: string;
  cashOut: { id: number; created: boolean } | null;
  prev: { amount: number; date: string; method: CariMethod } | null;
}

/**
 * Ödeme ekler ya da düzeltir (§3.2, §3.4). Kart çağıranda kilitli. İlk ödemede grubun takibi başlar (startTracking;
 * tekrar çağrılması zararsız). Kasadan ödeme her zaman bir Kasa satırıdır: o günün işlenmemiş Teslim satırı ya da
 * yeni Teslim satırı (Kime: kartın adı; gider yazmaz). Düzeltmede tutar sayılan toplamdan aşağı inemez; Kasadan
 * ödemenin günü ve tutarı satırına da geçer; Kasadan'dan çıkınca ödemenin açtığı satır silinir, var olan satır
 * işlenmemişe döner.
 */
export async function writePayment(tx: Tx, me: Actor, card: Card, input: PaymentWrite, termDays: number): Promise<PaymentResult> {
  let cur: EntryRow | null = null;
  let counted = 0;
  if (input.id) {
    [cur] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, input.id)).for("update").limit(1);
    if (!cur || cur.kind !== "odeme" || cur.supplierId !== card.id) throw new UserError(GONE);
    counted = await paymentAllocated(tx, cur.id);
    if (input.amount < counted - EPS) throw new UserError(`Bu ödemenin ${tl(counted, 2)}'si faturalara sayılmış; önce 'Neye sayıldı'dan azaltın`);
  }
  const amount = round2(input.amount);

  // Kasa satırı
  let cashOutId: number | null = null;
  let cashOutCreated = false;
  let dropLine: number | null = null;
  if (input.method === "kasa") {
    if (input.date > businessDate()) throw new UserError("Kasadan ödemenin günü kasanın bugünkü gününden ileri olamaz");
    if (cur?.method === "kasa" && cur.cashOutId !== null && !input.cashOut) {
      // Aynı satır: günü ve tutarı ödemeyi izler
      cashOutId = cur.cashOutId;
      cashOutCreated = cur.cashOutCreated;
      await tx.update(s.cashOuts).set({ date: input.date, amount, updatedAt: new Date() }).where(eq(s.cashOuts.id, cashOutId));
    } else {
      const choice = input.cashOut;
      if (!choice) throw new UserError("Kasa satırını seçin ya da kasaya yeni satır ekleyin");
      if (choice.mode === "existing") {
        const [line] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, choice.id)).for("update").limit(1);
        if (!line) throw new UserError("Kasa satırı bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
        if (line.kind !== "teslim") throw new UserError("Alışveriş satırı ödemeye bağlanamaz; Teslim satırı seçin ya da kasaya yeni satır ekleyin.");
        const [taken] = await tx
          .select({ id: s.supplierEntries.id })
          .from(s.supplierEntries)
          .where(cur ? and(eq(s.supplierEntries.cashOutId, line.id), ne(s.supplierEntries.id, cur.id)) : eq(s.supplierEntries.cashOutId, line.id))
          .limit(1);
        if (taken) throw new UserError("Bu kasa satırı başka bir ödemeye bağlı");
        if (line.date !== input.date) throw new UserError(`Kasa satırı ${dateTR(line.date)} gününün; ödeme günü de o gün olmalı`);
        if (Math.abs(line.amount - amount) > EPS) throw new UserError(`Tutar kasa satırıyla aynı olmalı (${tl(line.amount, 2)})`);
        cashOutId = line.id;
      } else {
        const [line] = await tx
          .insert(s.cashOuts)
          // Kasa şube başına: satır panelde seçili şubede açılır (docs/SUBE.md)
          .values({ date: input.date, kind: "teslim", amount, store: card.name, description: null, docType: "yok", branchId: await currentTillBranch(), createdBy: me.id, createdByName: me.name })
          .returning({ id: s.cashOuts.id });
        cashOutId = line.id;
        cashOutCreated = true;
      }
      if (cur?.cashOutId && cur.cashOutId !== cashOutId && cur.cashOutCreated) dropLine = cur.cashOutId;
    }
  } else if (cur?.cashOutId && cur.cashOutCreated) dropLine = cur.cashOutId;

  // Takip: grubun faturaları panelde sayılır (ilk ödemede başlar; tabanı dolu faturaya dokunmaz)
  await startTracking(tx, await cardInvoiceIds(tx, card.id));

  const values = {
    supplierId: card.id,
    kind: "odeme" as const,
    date: input.date,
    amount,
    description: null,
    note: input.note,
    method: input.method,
    cashOutId,
    cashOutCreated,
    photoId: input.photoId,
  };
  const [row] = cur
    ? await tx
        .update(s.supplierEntries)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.supplierEntries.id, cur.id))
        .returning()
    : await tx
        .insert(s.supplierEntries)
        .values({ ...values, createdBy: me.id, createdByName: me.name })
        .returning();
  if (dropLine) await tx.delete(s.cashOuts).where(eq(s.cashOuts.id, dropLine));
  await linkPhoto(tx, input.photoId, cur?.photoId ?? null, input.date);

  let lines: AllocationLine[] = [];
  let items: OpenItem[] = [];
  if (!cur && input.allocation.mode !== "none") {
    items = (await lockAccount(tx, card.id, termDays)).items;
    if (input.allocation.mode === "auto") lines = allocateFifo(items.filter((i) => i.quiet !== "link"), amount).lines;
    else {
      const problem = validateManual(input.allocation.lines, items, amount);
      if (problem) throw new UserError(problem);
      lines = input.allocation.lines.map((l) => ({ kind: l.kind, id: l.id, amount: round2(l.amount) })).filter((l) => l.amount > EPS);
    }
    await writeAllocations(tx, row.id, lines, me.name);
    const touched = lines.filter((l) => l.kind === "invoice").map((l) => l.id);
    await recomputeAllocated(tx, touched);
    await resettle(tx, touched);
  }
  if (cur) {
    // Düzeltilen ödemenin (gün, şekil) kapattığı faturaların ödeme günü ve şekli ödemeyi izler
    const mine = await tx.select({ invoiceId: s.supplierAllocations.invoiceId }).from(s.supplierAllocations).where(eq(s.supplierAllocations.paymentId, cur.id));
    await resettle(tx, mine.flatMap((a) => (a.invoiceId !== null ? [a.invoiceId] : [])));
  }
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  const used = round2(lines.reduce((a, l) => a + l.amount, 0));
  const left = round2(Math.max(0, amount - (cur ? counted : used)));
  return {
    id: row.id,
    created: !cur,
    lines: lines.map((l) => {
      const it = byKey.get(`${l.kind}:${l.id}`);
      return { ...l, label: it?.label ?? "", closed: Boolean(it && l.amount >= it.balance - EPS) };
    }),
    left,
    preview: "",
    cashOut: cashOutId ? { id: cashOutId, created: cashOutCreated } : null,
    prev: cur ? { amount: cur.amount, date: cur.date, method: (cur.method ?? "diger") as CariMethod } : null,
  };
}

// ---------------------------------------------------------------- Borç

export interface DebtWrite {
  id: number | null;
  date: string;
  amount: number;
  description: string;
  costMode: CostMode;
  /** "Faturası yok · gider yaz": gider kaydının kategorisi */
  categoryId: number | null;
  /** "Gideri zaten girildi": borcun olacak Aylık harcamalar kaydı */
  adoptExpenseId: number | null;
  dueDate: string | null;
  note: string | null;
  photoId: number | null;
  /** Kartın hesabındaki sayılmamış ödemeyi bu borca say */
  applyCredit: boolean;
  /**
   * "Ödendi": borç, ödeme ve tam dağıtım tek işlemde. `amount`: ödemenin tutarı kalandan farklıysa (Kasa denetiminde
   * "Bu satırla kapat": ödeme satırın tutarıdır, borcun kalanı kadarı sayılır, fazlası hesapta kalır)
   */
  paid: { method: CariMethod; date: string; cashOut: CashOutChoice | null; amount?: number } | null;
  /** Onaylanan geçmiş aylar (K18) */
  confirmPast: readonly string[];
  /** Yeni borçta Kasa denetiminin "Ayrı alım"ı: bu alımın ödemesi olmayan Teslim satırları */
  kasaApart?: readonly number[];
}

export interface DebtResult {
  id: number;
  created: boolean;
  /** Hesaptaki paradan bu borca sayılan ve yazılan dağıtımlar (düzeltmenin "Geri al"ı siler) */
  credited: number;
  creditAllocationIds: number[];
  paid: PaymentResult | null;
  effects: MonthEffect[];
  prev: { amount: number; date: string; costMode: CostMode } | null;
  /** "Faturası yok · gider yaz"da gider kaydının kategorisi */
  categoryName: string | null;
}

/**
 * Borç ekler ya da düzeltir (§3.1, §3.4). Kart çağıranda kilitli. Gider seçimine göre Aylık harcamalar kaydı aynı
 * işlemde açılır, güncellenir, sahiplenilir ya da bırakılır (K8, K9): "gider" borcun kendi kaydı (KDV dahil tutar,
 * alım günü, seçilen kategori), "mevcut" var olan kaydın tutarı ve günü borcunkine eşitlenip borcun olur, "fatura" ve
 * "devir" kayıt tutmaz (borcun kendi kaydı silinir, sahiplenilen kayıt bırakılır). Geçmiş ayın giderini değiştiren
 * yazım onay ister (K18). Faturaya bağlı borç düzeltilmez; tutar sayılan ödemelerden aşağı inemez.
 */
export async function writeDebt(tx: Tx, me: Actor, card: Card, input: DebtWrite, termDays: number): Promise<DebtResult> {
  let cur: EntryRow | null = null;
  if (input.id) {
    [cur] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, input.id)).for("update").limit(1);
    if (!cur || cur.kind !== "borc" || cur.supplierId !== card.id) throw new UserError(GONE);
    if (cur.invoiceId !== null) throw new UserError("Faturaya bağlı; önce bağı kaldırın");
    const counted = await debtAllocated(tx, cur.id);
    if (input.amount < counted - EPS) throw new UserError(`Bu alıma ${tl(counted, 2)} ödeme sayılmış; tutar bundan az olamaz`);
  }
  const amount = round2(input.amount);
  const description = input.description.trim();

  let category: { id: number; name: string } | null = null;
  if (input.costMode === "gider") {
    if (!input.categoryId) throw new UserError("Kategori seçin");
    const [cat] = await tx.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, input.categoryId)).limit(1);
    if (!cat || (!cat.active && cat.id !== cur?.categoryId)) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
    category = { id: cat.id, name: cat.name };
  }

  // Borcun şimdiki gider kaydı ve sahiplenilecek kayıt
  const [owned] = cur ? await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.supplierEntryId, cur.id)).for("update").limit(1) : [];
  let adopt: ExpenseRow | null = null;
  if (input.costMode === "mevcut") {
    if (!input.adoptExpenseId) throw new UserError("Harcama kaydını seçin");
    [adopt] = await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, input.adoptExpenseId)).for("update").limit(1);
    if (!adopt) throw new UserError("Harcama kaydı bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
    if (adopt.supplierEntryId !== null && adopt.supplierEntryId !== cur?.id) throw new UserError("Bu harcama kaydı başka bir borca bağlı");
    if (adopt.cashOutId !== null) throw new UserError("Kasadan yazılan harcama peşin alımdır; borca bağlanamaz");
    if (Math.abs(daysBetween(input.date, adopt.date)) > 31) throw new UserError("Harcama kaydı alım gününden en çok 31 gün uzakta olabilir");
  }

  // Gider kaydının değişimleri (sıra önemli: borcun kaydı tekil, eskisi önce bırakılır)
  type Op = { op: "delete" | "unown" | "update" | "adopt"; row: ExpenseRow } | { op: "insert" };
  const ops: Op[] = [];
  const changes: { date: string; delta: number; moved?: number }[] = [];
  const curMode = cur?.costMode ?? null;
  // "Gideri zaten girildi"nin bıraktığı kayıt sahiplenmeden önceki gününe ve tutarına döner (adopt_prev)
  const prevOf = (row: ExpenseRow) => (cur?.adoptPrev && cur.adoptPrev.id === row.id ? cur.adoptPrev : null);
  if (owned) {
    const keep = (input.costMode === "gider" && curMode === "gider") || (input.costMode === "mevcut" && adopt?.id === owned.id);
    if (!keep) {
      if (curMode === "gider") {
        ops.push({ op: "delete", row: owned });
        changes.push({ date: owned.date, delta: -owned.amount });
      } else {
        ops.push({ op: "unown", row: owned });
        const back = prevOf(owned);
        if (back) changes.push({ date: owned.date, delta: -owned.amount }, { date: back.date, delta: back.amount });
      }
    }
  }
  if (input.costMode === "gider") {
    if (owned && curMode === "gider") {
      ops.push({ op: "update", row: owned });
      changes.push({ date: owned.date, delta: -owned.amount }, { date: input.date, delta: amount });
      // Yalnız kategori değişse de geçmiş ayın satırları değişir (K18): toplamı değişmeyen ay da onay ister
      if (category && owned.categoryId !== category.id) changes.push({ date: owned.date, delta: 0, moved: owned.amount }, { date: input.date, delta: 0, moved: amount });
    } else {
      ops.push({ op: "insert" });
      changes.push({ date: input.date, delta: amount });
    }
  }
  if (adopt) {
    ops.push({ op: "adopt", row: adopt });
    changes.push({ date: adopt.date, delta: -adopt.amount }, { date: input.date, delta: amount });
  }
  const effects = checkPast(changes, input.confirmPast);

  const values = {
    supplierId: card.id,
    kind: "borc" as const,
    date: input.date,
    amount,
    description,
    note: input.note,
    costMode: input.costMode,
    categoryId: category?.id ?? null,
    dueDate: input.dueDate,
    photoId: input.photoId,
    // Sahiplenilen kaydın eski günü ve tutarı: aynı kayıt kaldıkça ilk sahiplenmedeki değerler
    adoptPrev: adopt ? (prevOf(adopt) ?? { id: adopt.id, date: adopt.date, amount: adopt.amount }) : null,
  };
  const [row] = cur
    ? await tx
        .update(s.supplierEntries)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.supplierEntries.id, cur.id))
        .returning()
    : await tx
        .insert(s.supplierEntries)
        .values({ ...values, dismissedCashOutIds: [...(input.kasaApart ?? [])], createdBy: me.id, createdByName: me.name })
        .returning();

  const expenseDescription = `${card.name} · ${description}`.slice(0, 200);
  const now = new Date();
  for (const o of ops) {
    if (o.op === "delete") await tx.delete(s.expenseEntries).where(eq(s.expenseEntries.id, o.row.id));
    else if (o.op === "unown") {
      const back = prevOf(o.row);
      await tx
        .update(s.expenseEntries)
        .set({ supplierEntryId: null, ...(back ? { date: back.date, amount: back.amount } : {}), updatedAt: now })
        .where(eq(s.expenseEntries.id, o.row.id));
    }
    else if (o.op === "update")
      await tx
        .update(s.expenseEntries)
        .set({ date: input.date, amount, categoryId: category!.id, description: expenseDescription, updatedAt: now })
        .where(eq(s.expenseEntries.id, o.row.id));
    else if (o.op === "adopt") await tx.update(s.expenseEntries).set({ date: input.date, amount, supplierEntryId: row.id, updatedAt: now }).where(eq(s.expenseEntries.id, o.row.id));
    else
      await tx.insert(s.expenseEntries).values({
        date: input.date,
        categoryId: category!.id,
        description: expenseDescription,
        amount,
        // Tek şube seçiliyse borcun gideri o şubenin, "Tümü"de işletme geneli
        branchId: await currentExpenseBranch(),
        paymentMethod: null,
        note: "Cari · faturasız",
        createdBy: me.name,
        supplierEntryId: row.id,
      });
  }
  await linkPhoto(tx, input.photoId, cur?.photoId ?? null, input.date);

  // Hesaptaki para önce, sonra "Ödendi"nin ödemesi (kalan kadar). Kasa denetiminde "Bu satırla kapat" (ödemenin tutarı
  // satırın tutarı): önce satırın ödemesi sayılır, kalan varsa hesaptaki para
  let credited = 0;
  const creditAllocationIds: number[] = [];
  const spend = async () => {
    if (!input.applyCredit) return;
    const room = round2(amount - (await debtAllocated(tx, row.id)));
    if (room <= EPS) return;
    const r = await spendCredit(tx, card.id, [{ kind: "debt", id: row.id, room }], me.name);
    credited = r.total;
    creditAllocationIds.push(...r.allocationIds);
  };
  const kasaFirst = input.paid?.amount !== undefined;
  if (!kasaFirst) await spend();
  let paid: PaymentResult | null = null;
  if (input.paid) {
    const rest = round2(amount - (await debtAllocated(tx, row.id)));
    const payAmount = round2(input.paid.amount ?? rest);
    const take = round2(Math.min(rest, payAmount));
    if (payAmount > EPS && (rest > EPS || input.paid.amount !== undefined)) {
      paid = await writePayment(
        tx,
        me,
        card,
        {
          id: null,
          date: input.paid.date,
          amount: payAmount,
          method: input.paid.method,
          cashOut: input.paid.cashOut,
          allocation: take > EPS ? { mode: "manual", lines: [{ kind: "debt", id: row.id, amount: take }] } : { mode: "none", lines: [] },
          note: null,
          photoId: null,
        },
        termDays,
      );
    }
  }
  if (kasaFirst) await spend();
  return {
    id: row.id,
    created: !cur,
    credited,
    creditAllocationIds,
    paid,
    effects,
    prev: cur ? { amount: cur.amount, date: cur.date, costMode: cur.costMode ?? "fatura" } : null,
    categoryName: category?.name ?? null,
  };
}

// ---------------------------------------------------------------- Silme ve geri alma

/** Silinen kaydın geri alınabilir kopyası ("Geri al"; mühürlü gider, istemci okuyamaz ve değiştiremez) */
export interface EntrySnapshot {
  entry: Omit<EntryRow, "createdAt" | "updatedAt" | "linkedAt"> & { linkedAt: string | null };
  allocations: RemovedAllocation[];
  /** Borcun gider kaydı: kendi kaydı silindi (alanlarıyla) ya da sahiplendiği kayıt bırakıldı (kimliğiyle) */
  expense: { mode: "owned"; row: Omit<ExpenseRow, "createdAt" | "updatedAt"> } | { mode: "adopted"; id: number } | null;
  /** Ödemenin açtığı (onunla silinen) Kasa satırı */
  cashOut: Omit<CashOutRow, "createdAt" | "updatedAt"> | null;
  /**
   * Ödemenin sayıldığı ve silinirken elle ödendi işaretli kalan faturalar (✓ hesaptaki bu parayı saymıştı) ve işaretleri:
   * Geri al işaret değişmediyse payı aynen geri yazar (eski kopyalarda yok)
   */
  kept?: { id: number; paidAt: string | null; paidVia: string | null }[];
}

export interface DeleteResult {
  snapshot: EntrySnapshot;
  effects: MonthEffect[];
  /** Ödeme silinince yeniden ödenmedi olan faturalar ve başka biçimde ödendi işaretli kalanlar */
  reopened: number;
  kept: number;
  /** Ödemenin sayıldığı kalemler (adıyla) ya da borca sayılan ödemeler */
  touched: string[];
}

/**
 * Kaydı siler (§3.4). Borç: faturaya bağlıysa silinmez; borca sayılan ödemeler CASCADE ile kalkar (para ödemenin
 * hesabına döner), kendi gider kaydı silinir (geçmiş aysa onay), sahiplendiği kayıt bırakılır. Ödeme: dağıtımları
 * kalkar, defterin kapattığı ve o günden beri değişmemiş faturalar yeniden açılır (elle konmuş ✓ kalır), ödemenin
 * açtığı Kasa satırı silinir, var olan satır işlenmemişe döner. Kart kilitlenir.
 */
export async function deleteEntry(tx: Tx, id: number, confirmPast: readonly string[]): Promise<DeleteResult & { card: Card }> {
  const [peek] = await tx.select({ supplierId: s.supplierEntries.supplierId }).from(s.supplierEntries).where(eq(s.supplierEntries.id, id)).limit(1);
  if (!peek) throw new UserError(GONE);
  const card = await lockCard(tx, peek.supplierId);
  const [e] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, id)).for("update").limit(1);
  if (!e) throw new UserError(GONE);
  const entry: EntrySnapshot["entry"] = { ...withoutStamps(e), linkedAt: e.linkedAt ? e.linkedAt.toISOString() : null };
  const out: DeleteResult = { snapshot: { entry, allocations: [], expense: null, cashOut: null }, effects: [], reopened: 0, kept: 0, touched: [] };
  if (e.kind === "borc") {
    if (e.invoiceId !== null) throw new UserError("Faturaya bağlı alım silinemez; önce bağı kaldırın");
    const [owned] = await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.supplierEntryId, e.id)).for("update").limit(1);
    // "Gideri zaten girildi": kayıt durur, sahiplenmeden önceki gününe ve tutarına döner (borç eklemenin "Geri al"ı dahil)
    const back = owned && e.costMode !== "gider" && e.adoptPrev?.id === owned.id ? e.adoptPrev : null;
    out.effects = checkPast(
      owned && e.costMode === "gider" ? [{ date: owned.date, delta: -owned.amount }] : back ? [{ date: owned!.date, delta: -owned!.amount }, { date: back.date, delta: back.amount }] : [],
      confirmPast,
    );
    out.snapshot.allocations = (await tx.select().from(s.supplierAllocations).where(eq(s.supplierAllocations.debtId, e.id)).orderBy(asc(s.supplierAllocations.id))).map(toAllocation) as RemovedAllocation[];
    if (owned) {
      if (e.costMode === "gider") {
        out.snapshot.expense = { mode: "owned", row: withoutStamps(owned) };
        await tx.delete(s.expenseEntries).where(eq(s.expenseEntries.id, owned.id));
      } else {
        out.snapshot.expense = { mode: "adopted", id: owned.id };
        await tx
          .update(s.expenseEntries)
          .set({ supplierEntryId: null, ...(back ? { date: back.date, amount: back.amount } : {}), updatedAt: new Date() })
          .where(eq(s.expenseEntries.id, owned.id));
      }
    }
    if (e.photoId) await releasePhoto(e.photoId, RELEASED_DAYS, tx);
    await tx.delete(s.supplierEntries).where(eq(s.supplierEntries.id, e.id));
    out.touched = out.snapshot.allocations.length ? [`${out.snapshot.allocations.length} ödemeden ${tl(round2(out.snapshot.allocations.reduce((a, x) => a + x.amount, 0)), 2)} hesaba geçti`] : [];
    return { ...out, card };
  }
  const allocations = (await tx.select().from(s.supplierAllocations).where(eq(s.supplierAllocations.paymentId, e.id)).orderBy(asc(s.supplierAllocations.id))).map(toAllocation) as RemovedAllocation[];
  out.snapshot.allocations = allocations;
  const invoiceIds = [...new Set(allocations.flatMap((a) => (a.invoiceId !== null ? [a.invoiceId] : [])))];
  const debtIds = [...new Set(allocations.flatMap((a) => (a.debtId !== null ? [a.debtId] : [])))];
  const [invs, debts] = await Promise.all([
    invoiceIds.length ? lockInvoices(tx, invoiceIds) : Promise.resolve([]),
    debtIds.length ? tx.select({ id: s.supplierEntries.id, description: s.supplierEntries.description, date: s.supplierEntries.date }).from(s.supplierEntries).where(inArray(s.supplierEntries.id, debtIds)) : Promise.resolve([]),
  ]);
  out.touched = [...invs.map((i) => invoiceLabel(i)), ...debts.map((d) => debtLabel(d))];
  if (e.cashOutId && e.cashOutCreated) {
    const [line] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, e.cashOutId)).for("update").limit(1);
    if (line) out.snapshot.cashOut = withoutStamps(line);
  }
  if (e.photoId) await releasePhoto(e.photoId, RELEASED_DAYS, tx);
  await tx.delete(s.supplierEntries).where(eq(s.supplierEntries.id, e.id));
  if (out.snapshot.cashOut) await tx.delete(s.cashOuts).where(eq(s.cashOuts.id, out.snapshot.cashOut.id));
  await recomputeAllocated(tx, invoiceIds);
  out.reopened = (await resettle(tx, invoiceIds)).reopened.length;
  // Elle ödendi işaretli (defterin kapatmadığı) ve bu ödemenin sayıldığı fatura olduğu gibi kalır
  const kept = invs.filter((i) => !i.unpaid && !i.paidByLedger);
  out.kept = kept.length;
  out.snapshot.kept = kept.map((i) => ({ id: i.id, paidAt: i.paidAt, paidVia: i.paidVia }));
  return { ...out, card };
}

/**
 * Silinen kaydı aynı kimlikle geri yazar ("Geri al"). Kopya yeniden doğrulanır (R4b): dağıtımlar ancak hedef hâlâ
 * duruyorsa ve yeri varsa yazılır, sığmayan para hesapta kalır (silinirken elle ödendi işaretli kalan faturanın payı,
 * işaret değişmediyse aynen geri gelir; bu arada elle ödendi yapılana yazılmaz); ödemenin açtığı Kasa satırı aynı kimlikle geri gelir,
 * bağlandığı var olan satır başka bir ödemeye geçtiyse ya da silindiyse kayıt geri alınmaz. Borcun kendi gider kaydı
 * yeniden yazılır (kategorisi duruyorsa), sahiplendiği kayıt hâlâ boştaysa yeniden sahiplenilir; geçmiş ayın gideri
 * değişiyorsa o ay onaylanmış olmalı (K18; yoksa NeedsPastConfirm, hiçbir şey yazılmaz). Döner: hesapta kalan.
 */
export async function restoreEntry(tx: Tx, me: Actor, snap: EntrySnapshot, confirmPast: readonly string[]): Promise<{ card: Card; lost: number; effects: MonthEffect[] }> {
  const card = await lockCard(tx, snap.entry.supplierId);
  const [taken] = await tx.select({ id: s.supplierEntries.id }).from(s.supplierEntries).where(eq(s.supplierEntries.id, snap.entry.id)).limit(1);
  if (taken) throw new UserError("Bu kayıt zaten geri alındı");
  const e = snap.entry;
  let costMode = e.costMode;
  let categoryId = e.categoryId;
  if (e.kind === "odeme" && e.cashOutId !== null) {
    const [line] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, e.cashOutId)).for("update").limit(1);
    if (snap.cashOut && !line) await tx.insert(s.cashOuts).values({ ...snap.cashOut });
    else if (!line) throw new UserError("Ödemenin bağlı olduğu kasa satırı silinmiş; ödemeyi yeniden girin");
    const [other] = await tx.select({ id: s.supplierEntries.id }).from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, e.cashOutId)).limit(1);
    if (other) throw new UserError("Kasa satırı bu arada başka bir ödemeye bağlandı; ödemeyi yeniden girin");
  }
  // Kategori silinmişse gider kaydı geri gelmez; borç "Faturası gelecek" olur (CHECK kategori ister)
  if (categoryId !== null) {
    const [cat] = await tx.select({ id: s.expenseCategories.id }).from(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId)).limit(1);
    if (!cat) categoryId = null;
  }
  let adoptId: number | null = null;
  let ownedRow: Omit<ExpenseRow, "createdAt" | "updatedAt"> | null = null;
  // Gider değişimleri (geçmiş ay onayı): yeniden yazılan kendi kaydı, borca yeniden eşitlenen sahiplenilmiş kayıt
  const changes: { date: string; delta: number }[] = [];
  if (e.kind === "borc" && snap.expense?.mode === "adopted") {
    const [x] = await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, snap.expense.id)).for("update").limit(1);
    if (x && x.supplierEntryId === null) {
      adoptId = x.id;
      changes.push({ date: x.date, delta: -x.amount }, { date: e.date, delta: e.amount });
    }
  } else if (e.kind === "borc" && snap.expense?.mode === "owned") {
    const r = snap.expense.row;
    const [cat] = await tx.select({ id: s.expenseCategories.id }).from(s.expenseCategories).where(eq(s.expenseCategories.id, r.categoryId)).limit(1);
    if (cat) {
      ownedRow = r;
      changes.push({ date: r.date, delta: r.amount });
    }
  }
  const effects = checkPast(changes, confirmPast);
  if ((costMode === "gider" && (categoryId === null || !ownedRow)) || (costMode === "mevcut" && adoptId === null)) {
    costMode = "fatura";
    categoryId = null;
  }
  await tx.insert(s.supplierEntries).values({
    ...e,
    costMode,
    categoryId: e.kind === "borc" ? categoryId : null,
    adoptPrev: costMode === "mevcut" ? (e.adoptPrev ?? null) : null,
    linkedAt: e.linkedAt ? new Date(e.linkedAt) : null,
    // Fotoğraf bu arada başka bir kayda bağlandıysa kayıt fotoğrafsız döner
    photoId: null,
    updatedAt: new Date(),
  });
  if (e.photoId) {
    const p = await getPhoto(e.photoId, tx);
    if (p && p.linkedAt === null && (p.expiresAt === null || p.expiresAt.getTime() > Date.now())) {
      await tx.update(s.supplierEntries).set({ photoId: p.id }).where(eq(s.supplierEntries.id, e.id));
      await keepPhoto(p.id, linkedUntil("fis", e.date, todayTR()), tx);
    }
  }
  if (ownedRow) {
    // Eski kimlik boştaysa onunla (Aylık harcamalar'daki bağlantılar bozulmasın)
    const [exists] = await tx.select({ id: s.expenseEntries.id }).from(s.expenseEntries).where(eq(s.expenseEntries.id, ownedRow.id)).limit(1);
    const values = { ...ownedRow, supplierEntryId: e.id, photoId: null, cashOutId: null };
    if (exists) await tx.insert(s.expenseEntries).values({ ...values, id: undefined });
    else await tx.insert(s.expenseEntries).values(values);
  }
  // Yeniden sahiplenilen kayıt borca eşitlenir (silinirken eski gününe ve tutarına dönmüştü)
  if (adoptId !== null) await tx.update(s.expenseEntries).set({ supplierEntryId: e.id, date: e.date, amount: e.amount, updatedAt: new Date() }).where(eq(s.expenseEntries.id, adoptId));

  // Dağıtımlar yeniden doğrulanır: hedef duruyor, aynı kartın ve yeri var; ödemenin parası yetiyor
  let lost = 0;
  const touched = new Set<number>();
  if (e.kind === "odeme") {
    let rest = round2(e.amount);
    const kept = new Map((snap.kept ?? []).map((k) => [k.id, k]));
    for (const a of snap.allocations) {
      let room = 0;
      if (a.invoiceId !== null) {
        const [inv] = await lockInvoices(tx, [a.invoiceId]);
        // Silinirken elle ödendi işaretli kalan fatura (✓ bu ödemenin parasını saymıştı), işareti değişmediyse payını
        // aynen geri alır; bu arada elle ödendi işaretlenen faturaya para yazılmaz (orada yer yok; hesapta kalır)
        const k = inv ? kept.get(inv.id) : undefined;
        const sameMark = Boolean(inv && k && !inv.unpaid && !inv.paidByLedger && inv.paidAt === k.paidAt && inv.paidVia === k.paidVia);
        if (inv && (inv.unpaid || inv.paidByLedger || sameMark)) room = invoiceRoom(inv);
      } else if (a.debtId !== null) {
        const [d] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, a.debtId)).for("update").limit(1);
        if (d && d.kind === "borc" && d.supplierId === card.id && d.invoiceId === null) room = round2(Math.max(0, d.amount - (await debtAllocated(tx, d.id))));
      }
      const take = round2(Math.min(a.amount, room, rest));
      if (take > EPS) {
        await writeAllocations(tx, e.id, [{ kind: a.invoiceId !== null ? "invoice" : "debt", id: (a.invoiceId ?? a.debtId)!, amount: take }], me.name);
        rest = round2(rest - take);
        if (a.invoiceId !== null) {
          touched.add(a.invoiceId);
          await recomputeAllocated(tx, [a.invoiceId]);
        }
      }
      lost = round2(lost + a.amount - Math.max(0, take));
    }
  } else {
    let room = round2(e.amount);
    const credits = new Map((await paymentCredits(tx, card.id)).map((p) => [p.id, p.credit]));
    for (const a of snap.allocations) {
      const take = round2(Math.min(a.amount, credits.get(a.paymentId) ?? 0, room));
      if (take > EPS) {
        await writeAllocations(tx, a.paymentId, [{ kind: "debt", id: e.id, amount: take }], me.name);
        credits.set(a.paymentId, round2((credits.get(a.paymentId) ?? 0) - take));
        room = round2(room - take);
      }
      lost = round2(lost + a.amount - Math.max(0, take));
    }
  }
  if (touched.size) {
    await recomputeAllocated(tx, touched);
    await resettle(tx, touched);
  }
  return { card, lost, effects };
}

// ---------------------------------------------------------------- Dağıtım

/**
 * Ödemenin dağıtımını baştan yazar (Neye sayıldı; geri almada önceki küme): eski dağıtımlar silinir, toplamlar
 * tazelenir, yeni satırlar açık kalemlere göre denetlenir (ödemenin kendi parası serbest kalmış olarak; elle ödendi
 * işaretli faturadaki eski payı kadar o fatura da seçenek). Kart çağıranda
 * kilitli. Döner: önceki satırlar ("Geri al").
 */
export async function rewriteAllocation(
  tx: Tx,
  me: Actor,
  card: Card,
  paymentId: number,
  allocation: { mode: "auto" | "manual" | "none"; lines: readonly AllocationLine[] },
  termDays: number,
): Promise<{ previous: AllocationLine[]; lines: (AllocationLine & { label: string; closed: boolean })[]; left: number; amount: number; date: string }> {
  const [p] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, paymentId)).for("update").limit(1);
  if (!p || p.kind !== "odeme" || p.supplierId !== card.id) throw new UserError(GONE);
  const removed = await deleteAllocations(tx, { paymentId });
  const before = removed.flatMap((a) => (a.invoiceId !== null ? [a.invoiceId] : []));
  await recomputeAllocated(tx, before);
  // Ödemenin kapattığı faturalar açılır: açık kalemler onların kalanlarıyla okunur (pencerenin seçenekleri gibi)
  await resettle(tx, before);
  const { items: open, invoices } = await lockAccount(tx, card.id, termDays);
  // Elle ödendi işaretli faturadaki payı (✓ hesaptaki bu parayı saymıştı; işaret kalır) da seçenektir, payı kadar yerle
  // (pencere de öyle gösterir); yoksa para hesaba geçer, aynı ödeme hem ödeme hem işaretli kısım olarak sayılırdı
  const held = new Map<number, number>();
  for (const a of removed) if (a.invoiceId !== null) held.set(a.invoiceId, round2((held.get(a.invoiceId) ?? 0) + a.amount));
  const items: OpenItem[] = [...open];
  for (const i of invoices) {
    const balance = round2(Math.min(held.get(i.id) ?? 0, invoiceRoom(i)));
    if (i.unpaid || i.paidByLedger || !(balance > EPS)) continue;
    const due = dueOf(i, termDays);
    items.push({ kind: "invoice", id: i.id, date: i.date, due: due.date, dueEstimated: due.estimated, balance, label: invoiceLabel(i) });
  }
  items.sort(compareOpenItems);
  let lines: AllocationLine[] = [];
  if (allocation.mode === "auto") lines = allocateFifo(items.filter((i) => i.quiet !== "link"), p.amount).lines;
  else if (allocation.mode === "manual") {
    const problem = validateManual(allocation.lines, items, p.amount);
    if (problem) throw new UserError(problem);
    lines = allocation.lines.map((l) => ({ kind: l.kind, id: l.id, amount: round2(l.amount) })).filter((l) => l.amount > EPS);
  }
  await writeAllocations(tx, p.id, lines, me.name);
  const touched = new Set([...before, ...lines.filter((l) => l.kind === "invoice").map((l) => l.id)]);
  await recomputeAllocated(tx, touched);
  await resettle(tx, touched);
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  return {
    previous: removed.map((a) => ({ kind: a.invoiceId !== null ? ("invoice" as const) : ("debt" as const), id: (a.invoiceId ?? a.debtId)!, amount: a.amount })),
    lines: lines.map((l) => {
      const it = byKey.get(`${l.kind}:${l.id}`);
      return { ...l, label: it?.label ?? "", closed: Boolean(it && l.amount >= it.balance - EPS) };
    }),
    left: round2(p.amount - lines.reduce((a, l) => a + l.amount, 0)),
    amount: p.amount,
    date: p.date,
  };
}

/**
 * Borçlara say: kartın hesabındaki para en eski vadeden açık kalemlere kalıcı olarak sayılır (güçlü fatura adayı
 * atlanır). Kart çağıranda kilitli. Döner: yazılan dağıtımlar ("Geri al" onları siler) ve kalem başına tutar.
 */
export async function applyCredit(tx: Tx, me: Actor, card: Card, termDays: number): Promise<{ allocationIds: number[]; total: number; lines: { label: string; amount: number }[] }> {
  const { items } = await lockAccount(tx, card.id, termDays);
  const targets = items.filter((i) => i.quiet !== "link").map((i) => ({ kind: i.kind, id: i.id, room: i.balance }));
  const r = await spendCredit(tx, card.id, targets, me.name);
  const touched = targets.filter((t) => t.kind === "invoice" && r.used.has(`invoice:${t.id}`)).map((t) => t.id);
  await recomputeAllocated(tx, touched);
  await resettle(tx, touched);
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  return { allocationIds: r.allocationIds, total: r.total, lines: [...r.used].map(([k, amount]) => ({ label: byKey.get(k)?.label ?? "", amount })) };
}

/**
 * Ödemeler'deki "Ödendi" (cari kalem): hesaptaki para önce borca sayılır, kalan için ödeme kaydı açılır (bugün, kartın
 * ödeme şekli; "Nakit" kasa dışı elden) ve borca sayılır. Kart çağıranda kilitli.
 */
export async function payDebtTx(
  tx: Tx,
  me: Actor,
  card: Card,
  debtId: number,
  method: CariMethod,
  termDays: number,
): Promise<{ credited: number; creditAllocationIds: number[]; payment: PaymentResult | null; label: string; amount: number }> {
  // Kilit sırası (K24): kartın faturaları ve borçları, sonra bu borç
  const { items } = await lockAccount(tx, card.id, termDays);
  const [d] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debtId)).for("update").limit(1);
  if (!d || d.kind !== "borc" || d.supplierId !== card.id) throw new UserError(GONE);
  if (d.invoiceId !== null) throw new UserError("Bu alım bir faturaya bağlı; faturayı ödendi yapın");
  const room = round2(d.amount - (await debtAllocated(tx, d.id)));
  if (room <= EPS) throw new UserError("Bu alım zaten ödenmiş");
  // Hesaptaki paradan yalnız bu kaleme düşen pay (Ödemeler'deki satırın gösterdiği mahsup: para önce daha erken
  // vadeli kalemlere düşer); ödeme kaydı satırda görünen kalan kadar açılır
  const credit = round2((await paymentCredits(tx, card.id)).reduce((a, p) => a + p.credit, 0));
  const net = netCredit(items, credit);
  const share = round2(Math.min(room, [...net.items, ...net.covered].find((i) => i.kind === "debt" && i.id === d.id)?.credited ?? 0));
  const spent = share > EPS ? await spendCredit(tx, card.id, [{ kind: "debt", id: d.id, room: share }], me.name) : { total: 0, allocationIds: [] as number[] };
  const credited = spent.total;
  const rest = round2(room - credited);
  const payment =
    rest > EPS
      ? await writePayment(
          tx,
          me,
          card,
          { id: null, date: todayTR(), amount: rest, method, cashOut: null, allocation: { mode: "manual", lines: [{ kind: "debt", id: d.id, amount: rest }] }, note: null, photoId: null },
          termDays,
        )
      : null;
  return { credited, creditAllocationIds: spent.allocationIds, payment, label: debtLabel(d), amount: room };
}

// ---------------------------------------------------------------- Faturası geldi ve Son ödenenler

export interface LinkWrite {
  cardId: number;
  debtIds: readonly number[];
  invoiceId: number;
  /** Faturanın adı kartsızsa kartın diğer adı olsun (R3d) */
  addAlias: boolean;
  confirmPast: readonly string[];
}

/**
 * Faturası geldi (§5.2): bir ya da birkaç faturasız alım tek faturaya bağlanır (dağıtımlar settle.ts'te). Fatura başka
 * bir tedarikçide görünebilir (R3d): adı kartsızsa `addAlias` ile kartın diğer adı olur (o adla gelen faturalar bu
 * karta geçer); başka bir kartınsa iki kart kimlik sırasıyla kilitlenir (K24), ad eklenmez, fatura o tedarikçide
 * görünmeye devam eder. Borçların gider kayıtları silinir (geçmiş aysa onay, NeedsPastConfirm).
 */
export async function linkToInvoice(tx: Tx, l: LinkWrite) {
  // Faturanın tedarikçisi: bu kart, kartsız ya da başka bir kart (iki kartlı işlemde kartlar kimlik sırasıyla kilitlenir)
  const [peek] = await tx.select({ supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices).where(eq(s.invoices.id, l.invoiceId)).limit(1);
  if (!peek) throw new UserError("Fatura bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  const owner = (await cardResolver(tx))(peek.supplier, peek.tax);
  await lockCards(tx, owner !== null && owner !== l.cardId ? [l.cardId, owner] : [l.cardId]);
  const card = await lockCard(tx, l.cardId);
  const debts = await tx.select().from(s.supplierEntries).where(inArray(s.supplierEntries.id, [...l.debtIds]));
  if (debts.length !== new Set(l.debtIds).size || debts.some((d) => d.supplierId !== card.id || d.kind !== "borc")) throw new UserError("Alım bulunamadı; değişmiş olabilir. Sayfayı yenileyin.");
  let aliasAdded: string | null = null;
  let elsewhere: string | null = null;
  if (owner !== card.id) {
    if (owner === null && l.addAlias) {
      const alias = splitSupplier(peek.supplier).base.trim() || peek.supplier.trim();
      const all = await tx.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases }).from(s.suppliers);
      const conflict = nameConflict({ id: card.id, name: card.name, aliases: [alias] }, all);
      if (conflict) throw new UserError(`‘${alias}’ adı ${conflict.owner} tedarikçisinde kayıtlı; diğer ad olarak eklenemez.`);
      await tx
        .update(s.suppliers)
        .set({ aliases: cleanAliases(card.name, [...card.aliases, alias], null), updatedAt: new Date() })
        .where(eq(s.suppliers.id, card.id));
      aliasAdded = alias;
    } else if (owner !== null) {
      const [o] = await tx.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, owner)).limit(1);
      elsewhere = o?.name ?? peek.supplier;
    } else {
      elsewhere = splitSupplier(peek.supplier).base.trim() || peek.supplier;
    }
  }
  const owned = await tx
    .select({ date: s.expenseEntries.date, amount: s.expenseEntries.amount })
    .from(s.expenseEntries)
    .where(inArray(s.expenseEntries.supplierEntryId, [...l.debtIds]));
  // Bağlama borçların gider kayıtlarını siler
  const effects = checkPast(owned.map((o) => ({ date: o.date, delta: -o.amount })), l.confirmPast);
  const res = await linkDebts(tx, l.debtIds, l.invoiceId);
  const [inv] = await tx.select({ invoiceNo: s.invoices.invoiceNo, date: s.invoices.date, payable: s.invoices.payable }).from(s.invoices).where(eq(s.invoices.id, l.invoiceId)).limit(1);
  return { card, debts, inv, res, effects, aliasAdded, elsewhere };
}

/**
 * Ödemeler › Son ödenenler'in "Geri al"ı (cari ödeme): kart, sonra kayıt kilitlenir (K24); ödeme kaydedildikten sonra
 * düzenlendiyse silinmez (Tedarikçiler'den silinir), düzenlenmediyse deleteEntry ile silinir. Kayıt yoksa ya da ödeme
 * değilse null.
 */
export async function deleteRecentPayment(tx: Tx, id: number, recorded: Pick<RecentPaid, "at" | "stamp">): Promise<(DeleteResult & { card: Card }) | null> {
  const [peek] = await tx.select({ supplierId: s.supplierEntries.supplierId, kind: s.supplierEntries.kind }).from(s.supplierEntries).where(eq(s.supplierEntries.id, id)).limit(1);
  if (!peek || peek.kind !== "odeme") return null;
  await lockCard(tx, peek.supplierId);
  const [cur] = await tx.select({ updatedAt: s.supplierEntries.updatedAt }).from(s.supplierEntries).where(eq(s.supplierEntries.id, id)).for("update").limit(1);
  if (!cur) return null;
  if (!paymentUnchanged(recorded, cur.updatedAt.toISOString())) throw new UserError("Ödeme sonradan düzenlendi; Tedarikçiler'den silin");
  return deleteEntry(tx, id, []);
}

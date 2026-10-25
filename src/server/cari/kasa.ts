import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import type { AllocationLine } from "@/lib/cari/account";
import { EPS, round2 } from "@/lib/cari/balance";
import { KASA_DEBT_DAYS, kasaMatches, type KasaFound } from "@/lib/cari/match";
import type { MonthEffect } from "@/lib/cari/months";
import { dateTR, tl } from "@/lib/format";
import { addDays } from "@/lib/reminders";
import { UserError } from "@/server/actions/util";
import { KASA_AYRI_KEY, KASA_AYRI_LIMIT, loadKasaHandled } from "@/server/data/cari";
import { schema as s } from "@/server/db";

import { checkPast, deleteEntry, writePayment, type Actor, type Card, type PaymentResult } from "./entries";
import { lockCard, resettle, type Tx } from "./settle";

export type { KasaFound };

/**
 * Cari hesabın Kasa bağları (docs/TEDARIKCILER.md "Hesap hareketleri", docs/KASA-RAPORU.md): Borç ekle'nin Kasa
 * denetimi (K15), "Ayrı tut" listesi, alışveriş satırının ödemeye çevrilmesi (K14) ve geri alınması, ödemeye bağlı
 * satırın Kasa'dan düzeltilmesi ve silinmesi (§6.8, §8). Kilit sırası (K24): önce kart, sonra Kasa satırı, sonra kayıt.
 */

type CashOutRow = typeof s.cashOuts.$inferSelect;
type ExpenseRow = typeof s.expenseEntries.$inferSelect;

/** Personelin bağlı satırda gördüğü sabit mesaj: tutar ve tedarikçi söylenmez (R9a) */
export const CARI_LOCKED_STAFF = "Bu satır yöneticinin kaydına bağlı; düzeltmek için yöneticiye haber verin.";

// ---------------------------------------------------------------- Ayrı tut

/** "Ayrı tut" / "Ayrı alım" listesine ekler ya da çıkarır (`undo`); liste en çok 2000 satır, en yenileri kalır */
export async function keepKasaApart(tx: Tx, ids: readonly number[], undo = false) {
  if (!ids.length) return;
  await tx.insert(s.integrationState).values({ key: KASA_AYRI_KEY, value: [] }).onConflictDoNothing();
  const [state] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, KASA_AYRI_KEY)).for("update").limit(1);
  const cur = Array.isArray(state?.value) ? (state.value as unknown[]).filter((x): x is number => Number.isInteger(x)) : [];
  const drop = new Set(ids);
  const next = undo ? cur.filter((x) => !drop.has(x)) : [...cur.filter((x) => !drop.has(x)), ...ids].slice(-KASA_AYRI_LIMIT);
  if (undo && next.length === cur.length) return;
  await tx.update(s.integrationState).set({ value: next, updatedAt: new Date() }).where(eq(s.integrationState.key, KASA_AYRI_KEY));
}

// ---------------------------------------------------------------- Borç ekle'nin Kasa denetimi (K15)

/** Kasa denetimi seçimi gerekiyor: kayıt yapılmadı, pencere bulunan satırları gösterip seçim ister */
export class NeedsKasa extends Error {
  constructor(readonly lines: KasaFound[]) {
    super("Kasa seçimi gerekli");
  }
}

/** Pencerenin seçimi: gördüğü satırlar ve ne yapılacağı */
export type KasaChoice = { action: "pesin" | "kapat"; cashOutId: number; seen: number[] } | { action: "ayri"; seen: number[] };

/**
 * Kartın adlarıyla (adı, diğer adları) eşleşen, alım gününün ±3 günündeki işlenmemiş Kasa satırları: Teslim ve
 * Alışveriş (gider yazmış ya da yazmamış). Tutara bakılmaz (900 ile 905 aynı alım olabilir).
 */
export async function kasaCheck(tx: Tx, card: Pick<Card, "name" | "aliases">, date: string): Promise<KasaFound[]> {
  const keys = [card.name, ...(Array.isArray(card.aliases) ? card.aliases : [])].map(supplierMatchKey).filter(Boolean);
  const from = addDays(date, -KASA_DEBT_DAYS);
  const to = addDays(date, KASA_DEBT_DAYS);
  const [lines, handled] = await Promise.all([
    tx
      .select({
        id: s.cashOuts.id,
        date: s.cashOuts.date,
        kind: s.cashOuts.kind,
        amount: s.cashOuts.amount,
        store: s.cashOuts.store,
        docType: s.cashOuts.docType,
        createdByName: s.cashOuts.createdByName,
        expenseAmount: s.expenseEntries.amount,
        expenseDate: s.expenseEntries.date,
        categoryName: s.expenseCategories.name,
      })
      .from(s.cashOuts)
      .leftJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, s.cashOuts.id))
      .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(and(gte(s.cashOuts.date, from), lte(s.cashOuts.date, to))),
    loadKasaHandled(tx),
  ]);
  return kasaMatches(lines, { keys, handled, from, to, kinds: ["teslim", "harcama"] }).map((l) => ({
    id: l.id,
    date: l.date,
    kind: l.kind,
    amount: l.amount,
    store: l.store,
    docType: l.docType,
    createdByName: l.createdByName,
    expense: l.expenseAmount !== null && l.expenseDate !== null ? { categoryName: l.categoryName ?? "", amount: l.expenseAmount, date: l.expenseDate } : null,
  }));
}

/**
 * Kasa denetiminin sonucu: satır yoksa seçim gerekmez. Satır varken seçim yoksa ya da pencerenin görmediği bir satır
 * çıktıysa NeedsKasa. "Ayrı alım": görülen alışveriş satırları ayrı tutulur, borç açılır; Teslim satırları işlenmemiş
 * kalır ama yalnız bu borç için ayrı sayılır (`teslim`, borcun `dismissed_cash_out_ids`'i: bu borcu "Kasadan ödenmiş
 * olabilir" diye sessize almaz). "Kasadan peşin ödendi": seçilen alışveriş satırı ayrı tutulur, borç açılmaz. "Bu
 * satırla kapat": borç açılır ve seçilen Teslim satırıyla ödenir.
 */
export async function resolveKasaChoice(
  tx: Tx,
  found: readonly KasaFound[],
  choice: KasaChoice | null,
): Promise<{ action: "none" } | { action: "ayri"; apart: number[]; teslim: number[] } | { action: "pesin" | "kapat"; line: KasaFound }> {
  if (choice && choice.action !== "ayri" && !found.some((l) => l.id === choice.cashOutId)) {
    if (found.length) throw new NeedsKasa([...found]);
    throw new UserError("Kasa satırı bu arada işlendi ya da silindi; yeniden kaydedin.");
  }
  if (!found.length) return { action: "none" };
  const seen = new Set(choice?.seen ?? []);
  if (!choice || found.some((l) => !seen.has(l.id))) throw new NeedsKasa([...found]);
  if (choice.action === "ayri") {
    // Yalnız alışveriş satırı ayrı tutulur: Teslim satırı tedarikçiye gerçek bir ödemedir (bu alım için değilse de),
    // işlenmemiş kalır ve Ödeme ekle › Kasadan, şerit ve zilden ödemeye bağlanabilir
    const apart = found.filter((l) => l.kind === "harcama").map((l) => l.id);
    await keepKasaApart(tx, apart);
    return { action: "ayri", apart, teslim: found.filter((l) => l.kind === "teslim").map((l) => l.id) };
  }
  const line = found.find((l) => l.id === choice.cashOutId)!;
  if (choice.action === "pesin") {
    if (line.kind !== "harcama") throw new UserError("Teslim satırı peşin alım değildir; “Bu satırla kapat” ya da “Ayrı alım” seçin.");
    await keepKasaApart(tx, [line.id]);
    return { action: "pesin", line };
  }
  if (line.kind !== "teslim") throw new UserError("Alışveriş satırıyla borç kapatılmaz; “Kasadan peşin ödendi” ya da “Ayrı alım” seçin.");
  return { action: "kapat", line };
}

// ---------------------------------------------------------------- Ödemeye çevir (K14)

/** Çevirmenin geri alınabilir kopyası (mühürlü; istemci okuyamaz ve değiştiremez) */
export interface ConvertSnapshot {
  cardId: number;
  paymentId: number;
  /** Ödemenin yazıldığı andaki düzenlenme anı: sonradan düzenlenen ödeme geri alınmaz */
  stamp: string;
  cashOutId: number;
  line: Pick<CashOutRow, "kind" | "docType" | "receiptDate" | "receiptNo" | "vat">;
  expense: Omit<ExpenseRow, "createdAt" | "updatedAt"> | null;
}

export interface ConvertResult {
  payment: PaymentResult;
  effects: MonthEffect[];
  line: CashOutRow;
  /** Silinen gider kaydı (işlem geçmişi ve bildirim) */
  expense: { date: string; amount: number; categoryName: string } | null;
  snapshot: ConvertSnapshot;
}

/**
 * Kasadaki alışveriş satırını tedarikçiye ödemeye çevirir (K14): satırın gider kaydı silinir (geçmiş aysa onay, K18),
 * satır Teslim olur (fiş alanları boşalır, fotoğrafı kalır) ve satıra bağlı Kasadan ödeme açılır (satırın günü ve
 * tutarıyla). Hepsi tek işlem; kart çağıranda kilitli.
 */
export async function convertCashOut(
  tx: Tx,
  me: Actor,
  card: Card,
  input: { cashOutId: number; allocation: { mode: "auto" | "manual" | "none"; lines: readonly AllocationLine[] }; note: string | null; photoId: number | null; confirmPast: readonly string[] },
  termDays: number,
): Promise<ConvertResult> {
  const [line] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, input.cashOutId)).for("update").limit(1);
  if (!line) throw new UserError("Kasa satırı bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
  if (line.kind !== "harcama") throw new UserError("Satır zaten Teslim · ödeme; Ödeme ekle › Kasadan ile bağlayın.");
  const [taken] = await tx.select({ id: s.supplierEntries.id }).from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, line.id)).limit(1);
  if (taken) throw new UserError("Bu kasa satırı başka bir ödemeye bağlı");
  const [exp] = await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, line.id)).for("update").limit(1);
  const [cat] = exp ? await tx.select({ name: s.expenseCategories.name }).from(s.expenseCategories).where(eq(s.expenseCategories.id, exp.categoryId)).limit(1) : [];
  // Ödeme gider değildir: satırın gideri silinir
  const effects = checkPast(exp ? [{ date: exp.date, delta: -exp.amount }] : [], input.confirmPast);
  if (exp) await tx.delete(s.expenseEntries).where(eq(s.expenseEntries.id, exp.id));
  await tx.update(s.cashOuts).set({ kind: "teslim", docType: "yok", receiptDate: null, receiptNo: null, vat: null, updatedAt: new Date() }).where(eq(s.cashOuts.id, line.id));
  await keepKasaApart(tx, [line.id], true);
  const payment = await writePayment(
    tx,
    me,
    card,
    { id: null, date: line.date, amount: line.amount, method: "kasa", cashOut: { mode: "existing", id: line.id }, allocation: input.allocation, note: input.note, photoId: input.photoId },
    termDays,
  );
  const [row] = await tx.select({ updatedAt: s.supplierEntries.updatedAt }).from(s.supplierEntries).where(eq(s.supplierEntries.id, payment.id)).limit(1);
  let expense: ConvertSnapshot["expense"] = null;
  if (exp) {
    const copy: Partial<ExpenseRow> = { ...exp };
    delete copy.createdAt;
    delete copy.updatedAt;
    expense = copy as Omit<ExpenseRow, "createdAt" | "updatedAt">;
  }
  return {
    payment,
    effects,
    line,
    expense: exp ? { date: exp.date, amount: exp.amount, categoryName: cat?.name ?? "" } : null,
    snapshot: {
      cardId: card.id,
      paymentId: payment.id,
      stamp: row?.updatedAt.toISOString() ?? "",
      cashOutId: line.id,
      line: { kind: line.kind, docType: line.docType, receiptDate: line.receiptDate, receiptNo: line.receiptNo, vat: line.vat },
      expense,
    },
  };
}

/**
 * Ödemeye çevirmeyi geri alır: ödeme silinir (dağıtımları kalkar, defterin kapattığı faturalar yeniden açılır), satır
 * eski türüne ve fiş alanlarına döner, gider kaydı (kategorisi duruyorsa) eski kimliğiyle yeniden yazılır. Gider kaydı
 * geçmiş aya dönüyorsa o ay onaylanmış olmalı (K18; yoksa NeedsPastConfirm, hiçbir şey yazılmaz). Ödeme sonradan
 * düzenlendiyse ya da satır silindiyse yapılmaz.
 */
export async function undoConversion(
  tx: Tx,
  snap: ConvertSnapshot,
  confirmPast: readonly string[],
): Promise<{ card: Card; line: CashOutRow; expenseRestored: boolean; effects: MonthEffect[] }> {
  const card = await lockCard(tx, snap.cardId);
  const [p] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, snap.paymentId)).for("update").limit(1);
  if (!p || p.cashOutId !== snap.cashOutId) throw new UserError("Ödeme bu arada silindi ya da değişti; Tedarikçiler'den düzeltin.");
  if (snap.stamp && p.updatedAt.toISOString() !== snap.stamp) throw new UserError("Ödeme sonradan düzenlendi; Tedarikçiler'den silin.");
  const [line] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, snap.cashOutId)).for("update").limit(1);
  if (!line) throw new UserError("Kasa satırı silinmiş; geri alınamaz.");
  // Gider kaydı ancak kategorisi duruyor ve satıra bu arada başka kayıt yazılmamışsa geri gelir; geçmiş aya geliyorsa
  // ay sorulur (yazımdan önce)
  let restore: ConvertSnapshot["expense"] = null;
  if (snap.expense) {
    const [cat] = await tx.select({ id: s.expenseCategories.id }).from(s.expenseCategories).where(eq(s.expenseCategories.id, snap.expense.categoryId)).limit(1);
    const [busy] = await tx.select({ id: s.expenseEntries.id }).from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, line.id)).limit(1);
    if (cat && !busy) restore = snap.expense;
  }
  const effects = checkPast(restore ? [{ date: restore.date, delta: restore.amount }] : [], confirmPast);
  await deleteEntry(tx, p.id, []);
  const [restored] = await tx
    .update(s.cashOuts)
    .set({ ...snap.line, updatedAt: new Date() })
    .where(eq(s.cashOuts.id, line.id))
    .returning();
  if (restore) {
    const [exists] = await tx.select({ id: s.expenseEntries.id }).from(s.expenseEntries).where(eq(s.expenseEntries.id, restore.id)).limit(1);
    const values = { ...restore, cashOutId: line.id, supplierEntryId: null };
    if (exists) await tx.insert(s.expenseEntries).values({ ...values, id: undefined });
    else await tx.insert(s.expenseEntries).values(values);
  }
  return { card, line: restored, expenseRestored: restore !== null, effects };
}

// ---------------------------------------------------------------- Kasa'dan bağlı satır (§6.8, §8)

/** Satırın bağlı olduğu ödeme (varsa) */
export async function cashOutPayment(tx: Tx, cashOutId: number): Promise<{ id: number; supplierId: number } | null> {
  const [r] = await tx.select({ id: s.supplierEntries.id, supplierId: s.supplierEntries.supplierId }).from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, cashOutId)).limit(1);
  return r ?? null;
}

/**
 * Kasa satırını düzeltmeden önce, satır kilitlenmeden (K24: önce kart): satır bir ödemeye bağlıysa personel reddedilir
 * (sabit mesaj), yöneticide kart kilitlenir. Döner: o anki bağ.
 */
export async function lockCashOutLink(tx: Tx, cashOutId: number, admin: boolean): Promise<{ id: number; supplierId: number } | null> {
  const link = await cashOutPayment(tx, cashOutId);
  if (!link) return null;
  if (!admin) throw new UserError(CARI_LOCKED_STAFF);
  await lockCard(tx, link.supplierId);
  return link;
}

/**
 * Satır kilitlendikten sonra yeniden: bu arada bağlandıysa personel reddedilir. Yöneticinin düzeltmesi ödemeye geçer
 * (§6.8): tür Teslim kalmalı, tutar sayılan toplamın altına inemez, gün ve tutar ödemenin olur. Döner: tedarikçinin adı
 * (işlem geçmişi) ya da null.
 */
export async function syncLinkedCashOut(
  tx: Tx,
  cashOutId: number,
  peeked: { id: number; supplierId: number } | null,
  next: { admin: boolean; kind: "harcama" | "teslim"; amount: number; date: string },
): Promise<string | null> {
  const link = await cashOutPayment(tx, cashOutId);
  if (!link) return null;
  if (!next.admin) throw new UserError(CARI_LOCKED_STAFF);
  if (!peeked || peeked.id !== link.id) throw new UserError("Satır bu arada bir ödemeye bağlandı; sayfayı yenileyin.");
  const [card] = await tx.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, link.supplierId)).limit(1);
  if (next.kind !== "teslim") throw new UserError("Ödemeye bağlı satır alışverişe çevrilemez; önce Tedarikçiler'de ödemeyi silin.");
  const [p] = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, link.id)).for("update").limit(1);
  const [sum] = await tx
    .select({ total: sql<number>`coalesce(sum(${s.supplierAllocations.amount}), 0)` })
    .from(s.supplierAllocations)
    .where(eq(s.supplierAllocations.paymentId, link.id));
  const total = round2(Number(sum?.total ?? 0));
  const amount = round2(next.amount);
  if (amount < total - EPS) throw new UserError(`Bu satırın ödemesinin ${tl(total, 2)}'si kalemlere sayılmış; tutar bundan az olamaz. Önce Tedarikçiler'de 'Neye sayıldı'dan azaltın.`);
  if (p && (Math.abs(p.amount - amount) > EPS || p.date !== next.date)) {
    await tx.update(s.supplierEntries).set({ amount, date: next.date, updatedAt: new Date() }).where(eq(s.supplierEntries.id, link.id));
    // Ödemenin kapattığı faturaların ödeme günü ödemeyi izler
    const mine = await tx.select({ invoiceId: s.supplierAllocations.invoiceId }).from(s.supplierAllocations).where(eq(s.supplierAllocations.paymentId, link.id));
    await resettle(tx, mine.flatMap((a) => (a.invoiceId !== null ? [a.invoiceId] : [])));
  }
  return card?.name ?? "";
}

/** Bağlı satır Kasa'dan silinmez (FK ON DELETE RESTRICT de korur): personel sabit mesajı, yönetici nerede silineceğini görür */
export async function assertCashOutDeletable(tx: Tx, cashOutId: number, admin: boolean) {
  const link = await cashOutPayment(tx, cashOutId);
  if (!link) return;
  if (!admin) throw new UserError(CARI_LOCKED_STAFF);
  const [card] = await tx.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, link.supplierId)).limit(1);
  const [p] = await tx.select({ date: s.supplierEntries.date, created: s.supplierEntries.cashOutCreated }).from(s.supplierEntries).where(eq(s.supplierEntries.id, link.id)).limit(1);
  throw new UserError(
    `Bu satır bir tedarikçi ödemesine bağlı (${card?.name ?? "tedarikçi"}${p ? `, ${dateTR(p.date)}` : ""}); ödemeyi Tedarikçiler'den silin${p?.created ? ", kasaya açtığı bu satır da silinir" : ""}.`,
  );
}

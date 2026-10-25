"use server";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { amountsChanged, DELETED_BILLS_KEY, DELETED_BILLS_LIMIT, isParasutLinked, joinTR, LOCKED_LABELS, lockedChanges, splitSupplier, type LockedField } from "@/app/panel/faturalar/rules";
import { cleanTaxNumber, methodLabel, PAYMENT_METHOD_VALUES } from "@/app/panel/tedarikciler/logic";
import { INVOICE_CATEGORIES } from "@/lib/constants";
import { payableFloorProblem } from "@/lib/cari/account";
import { round2 } from "@/lib/cari/balance";
import { dateTR, tl } from "@/lib/format";
import { crossesSeparate, separateMoveMonths } from "@/lib/invoice-linking";
import { addDays, todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import {
  assertNotCovered,
  cardResolver,
  creditFirstForInvoices,
  dropAllocations,
  ledgerBaseForNew,
  reattachInvoiceLinks,
  releaseInvoiceLinks,
  resettleInvoices,
  type CreditUse,
} from "@/server/cari/settle";
import { forgetPaid, rememberPaid } from "@/server/data/recent-paid";
import { getDb, schema as s } from "@/server/db";
import { applyProductLinks, IGNORE_KEY } from "@/server/parasut/sync";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText, zText } from "./util";

const zId = z.number().int().positive();
const zCategory = z.enum(INVOICE_CATEGORIES as [string, ...string[]], { message: "Kategori seçin" });

const invoiceSchema = z.object({
  id: zId.nullable(),
  date: zDate,
  supplier: zText("Tedarikçi", 120),
  description: zOptText(200),
  invoiceNo: zOptText(60),
  category: zCategory,
  amount: z.number().finite(),
  discount: z.number().finite().min(0),
  payable: z.number().finite(),
  unpaid: z.boolean(),
  note: zOptText(1000),
  /** Vade; gönderilmezse değişmez */
  dueDate: zDate.nullable().optional(),
  /** Ödeme günü (ödendi faturada; null: bilinmiyor); gönderilmezse ödenmemişten ödendiye geçerken bugün, yoksa değişmez */
  paidAt: zDate.nullable().optional(),
});

/**
 * Kafe içi ↔ kafe dışı (karaoke box, Alp Koç) geçen faturalardan kalemi okunmuş olanların aylarında alınan miktar
 * (ve bağlı fiyat) yeniden hesaplanır: applyProductLinks kafe dışı kalemleri saymaz, eşitleme de yalnız kategorisi
 * değişen faturanın ayına dönmez. Silme ve geri almadaki gibi.
 */
async function recomputeSeparateMoves(moves: { id: number; date: string; from: string; to: string }[]) {
  const crossed = moves.filter((m) => crossesSeparate(m.from, m.to));
  if (!crossed.length) return;
  const withLines = await getDb()
    .selectDistinct({ id: s.parasutBillLines.invoiceId })
    .from(s.parasutBillLines)
    .where(inArray(s.parasutBillLines.invoiceId, crossed.map((m) => m.id)));
  const months = separateMoveMonths(crossed, new Set(withLines.map((r) => r.id)));
  if (months.length) await applyProductLinks(months);
}

/**
 * Faturayı ekler ya da günceller. Paraşüt'e bağlı faturada tarih, fatura no ve tutarlar yazılmaz: eşitleme onları
 * her çalışmada Paraşüt'ten yeniden yazar (bkz. rules.ts PARASUT_LOCKED_FIELDS). Formdan farklı değer geldiyse
 * (eski açık pencere) `kept` ile bildirilir, sessizce yutulmaz.
 */
export async function saveInvoice(input: z.input<typeof invoiceSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, paidAt, ...data } = invoiceSchema.parse(input);
    if (paidAt && paidAt > addDays(todayTR(), 1)) throw new UserError("Ödeme günü ileri bir tarih olamaz");
    const db = getDb();
    const none: CreditUse = { allocationIds: [], used: new Map(), closed: [] };
    if (!id) {
      // Cari takipteki kartın yeni faturası panelde sayılır (taban 0; src/lib/cari/balance.ts)
      const ledgerBase = await ledgerBaseForNew(data.supplier, null);
      // Ödendi eklenen fatura (pencerenin varsayılanı) takipli kartta önce hesaptaki parayı kullanır (K6): ödenmemiş
      // yazılır, hesaptaki para sayılır, karşılanmayan kalan kullanıcının günüyle ödendi işaretlenir
      const viaCredit = !data.unpaid && ledgerBase !== null;
      const [row] = await db
        .insert(s.invoices)
        .values({ ...data, unpaid: data.unpaid || viaCredit, paidAt: data.unpaid || viaCredit ? null : (paidAt ?? null), ledgerBase })
        .returning({ id: s.invoices.id });
      const credit = viaCredit ? await creditFirstForInvoices([row.id], me.name) : none;
      if (viaCredit && !credit.closed.includes(row.id)) {
        await db
          .update(s.invoices)
          .set({ unpaid: false, paidAt: paidAt ?? null, paidByLedger: false })
          .where(and(eq(s.invoices.id, row.id), eq(s.invoices.unpaid, true)));
      }
      await logActivity(me, "Fatura eklendi", `${dateTR(data.date)} ${data.supplier}: ${tl(data.amount - data.discount, 2)} (KDV hariç)${creditText(credit, [row.id])}`);
      refresh();
      return { id: row.id, kept: [] as LockedField[], message: null as string | null, credit: creditSummary(credit) };
    }
    const [cur] = await db.select().from(s.invoices).where(eq(s.invoices.id, id)).limit(1);
    if (!cur) throw new UserError("Fatura bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    // Cari ödemesi sayılmış faturanın tutarı sayılandan aşağı inemez (Paraşüt'e bağlıda tutar kilitli)
    const floor = isParasutLinked(cur) ? null : payableFloorProblem(cur, data.payable);
    if (floor) throw new UserError(floor);
    // Ödenmedi: hesaptaki ödemeyle kapanmış fatura ödemeden çıkarılmadan açılamaz
    if (!cur.unpaid && data.unpaid) await assertNotCovered(db, [id]);
    // Cari (K23): ödemesi sayılmış ya da faturasız alımı bağlı faturanın tedarikçi adı onu başka tedarikçiye taşımaz
    if (data.supplier !== cur.supplier) await assertInvoiceStays(cur, data.supplier);
    const kept: LockedField[] = isParasutLinked(cur) ? lockedChanges(cur, data) : [];
    // Kilitli alanlar (Paraşüt'e bağlıda tarih, no, tutarlar) atılır; kalanlar yazılır. Kaydetmek faturayı kontrol
    // edilmiş sayar. Bağı çözülmüş kaydın eşitlemeden kalan KDV toplamı tutarlar değişince silinir: KDV ödenecek − net
    // olur (pencerede görünen), fark tevkifat sanılmaz (rules.ts amountsChanged)
    const fields = isParasutLinked(cur)
      ? { supplier: data.supplier, description: data.description, category: data.category, note: data.note, dueDate: data.dueDate, needsReview: false }
      : { ...data, ...(amountsChanged(cur, data) ? { vat: 0 } : {}), needsReview: false };
    const payableChanged = !isParasutLinked(cur) && data.payable !== cur.payable && (cur.allocated > 0 || cur.ledgerBase !== null);
    let credit = none;
    if (cur.unpaid && !data.unpaid) {
      // Ödendiye geçiş: önce alanlar (yeni Ödenecek dahil, fatura henüz ödenmemiş), sonra hesaptaki para yeni tutara
      // göre sayılır (tamamen karşılarsa fatura defterle kapanır, ödeme alanları defterin), en son karşılanmayan
      // kalan kullanıcının günüyle ödendi işaretlenir; yazım hâlâ ödenmemiş olana koşullu
      await db.update(s.invoices).set({ ...fields, unpaid: true }).where(eq(s.invoices.id, id));
      if (payableChanged) await resettleInvoices([id]);
      credit = await creditFirstForInvoices([id], me.name);
      if (!credit.closed.includes(id)) {
        await db
          .update(s.invoices)
          .set({ unpaid: false, paidAt: paidAt === undefined ? todayTR() : paidAt, paymentRequestedAt: null, paidByLedger: false })
          .where(and(eq(s.invoices.id, id), eq(s.invoices.unpaid, true)));
      }
    } else {
      // Ödeme günü: ödenmediye dönünce silinir (ödeme şekliyle); ödendi kalan faturada gönderildiyse düzeltilir. Ödeme
      // durumunu ya da gününü kullanıcı değiştirince fatura defterin kapattığı fatura sayılmaz; pencere günü hep
      // gönderir, aynı gün işareti bozmaz
      const written = data.unpaid ? (cur.unpaid ? {} : { paidAt: null, paidVia: null }) : paidAt !== undefined ? { paidAt } : {};
      const userPaid = cur.unpaid !== data.unpaid || ("paidAt" in written && written.paidAt !== cur.paidAt);
      await db
        .update(s.invoices)
        .set({ ...fields, unpaid: data.unpaid, ...written, ...(userPaid ? { paidByLedger: false } : {}) })
        .where(eq(s.invoices.id, id));
      // Ödenecek değişince dağıtım ve ödendi işareti yeniden dengelenir (arttıysa defterin kapattığı açılır)
      if (payableChanged) await resettleInvoices([id]);
    }
    // Pencereden "Ödendi" yapılan fatura da Ödemeler › Son ödenenler'den geri alınabilir
    if (cur.unpaid && !data.unpaid)
      await rememberPaid([
        {
          kind: "invoice",
          id,
          title: data.supplier,
          amount: cur.payable,
          dueDate: data.dueDate ?? cur.dueDate ?? cur.date,
          requestedAt: cur.paymentRequestedAt,
          ...(credit.allocationIds.length ? { allocationIds: credit.allocationIds } : {}),
        },
      ]);
    else if (!cur.unpaid && data.unpaid) await forgetPaid("invoice", [id]);
    // Kalem yalnız Paraşüt'e bağlı faturada olur (bağı çözülünce silinir); tarihi kilitli, kalemler kayıtlı ayda
    if (isParasutLinked(cur)) await recomputeSeparateMoves([{ id, date: cur.date, from: cur.category, to: data.category }]);
    const net = isParasutLinked(cur) ? cur.amount - cur.discount : data.amount - data.discount;
    const usedText = creditText(credit, [id]);
    await logActivity(me, "Fatura düzenlendi", `${dateTR(isParasutLinked(cur) ? cur.date : data.date)} ${data.supplier}: ${tl(net, 2)} (KDV hariç)${usedText}`);
    refresh();
    const names = joinTR(kept.map((k) => LOCKED_LABELS[k]));
    const message = kept.length
      ? // Kilitli alanlar formda salt okunur: fark ancak pencere açıkken eşitleme değeri değiştirdiyse çıkar
        `${names.charAt(0).toLocaleUpperCase("tr-TR")}${names.slice(1)} bu pencere açıkken Paraşüt eşitlemesiyle güncellendi; Paraşüt'teki yeni değer geçerli kaldı. Diğer değişiklikleriniz kaydedildi.`
      : null;
    return { id, kept, message, credit: creditSummary(credit) };
  });
}

/**
 * Tedarikçi adı değişen faturada cari ödemesi sayılmışsa ya da faturasız alımı bağlıysa fatura aynı kartta kalmalı:
 * yoksa para iki tedarikçi sayfasına bölünür (K23)
 */
async function assertInvoiceStays(cur: Pick<typeof s.invoices.$inferSelect, "id" | "supplier" | "supplierTaxNumber" | "allocated">, supplier: string) {
  const db = getDb();
  const [linked] = await db.select({ id: s.supplierEntries.id }).from(s.supplierEntries).where(eq(s.supplierEntries.invoiceId, cur.id)).limit(1);
  if (!(cur.allocated > 0) && !linked) return;
  const resolve = await cardResolver(db);
  const from = resolve(cur.supplier, cur.supplierTaxNumber);
  if (from === null || from === resolve(supplier, cur.supplierTaxNumber)) return;
  throw new UserError("Bu faturaya tedarikçinin cari ödemesi sayılmış ya da faturasız alımı bağlı; tedarikçi adını değiştirmek onu başka tedarikçiye taşır. Önce Hesap hareketleri'nde ödemeden çıkarın ya da bağı kaldırın.");
}

/** İşlem geçmişinin eki: " · hesaptaki 99,50 ₺ sayıldı" (hesaptaki para kullanılmadıysa boş) */
function creditText(credit: CreditUse, ids: readonly number[]): string {
  const used = ids.reduce((a, id) => a + (credit.used.get(id) ?? 0), 0);
  return used > 0.005 ? ` · hesaptaki ${tl(round2(used), 2)} sayıldı` : "";
}

const categoryChangesSchema = z
  .array(z.object({ id: zId, category: zCategory }))
  .min(1, "Fatura seçin")
  .max(1000, "Tek seferde en fazla 1000 fatura");

/**
 * Bir ya da birçok faturanın kategorisini değiştirir (satır içi seçim, toplu değiştirme, geri alma).
 * Önceki kategoriler döner; "Geri al" aynı eylemle onları geri yazar. Paraşüt eşitlemesi kategoriyi korur.
 */
export async function setInvoiceCategory(changes: z.input<typeof categoryChangesSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = categoryChangesSchema.parse(changes);
    const wanted = new Map(list.map((c) => [c.id, c.category]));
    const db = getDb();
    const rows = await db
      .select({ id: s.invoices.id, category: s.invoices.category, supplier: s.invoices.supplier, date: s.invoices.date })
      .from(s.invoices)
      .where(inArray(s.invoices.id, [...wanted.keys()]));
    if (!rows.length) throw new UserError("Faturalar bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
    const changed = rows.filter((r) => wanted.get(r.id) !== r.category);
    if (changed.length) {
      const byCategory = new Map<string, number[]>();
      for (const r of changed) {
        const c = wanted.get(r.id)!;
        byCategory.set(c, [...(byCategory.get(c) ?? []), r.id]);
      }
      await db.transaction(async (tx) => {
        for (const [category, ids] of byCategory) await tx.update(s.invoices).set({ category, needsReview: false }).where(inArray(s.invoices.id, ids));
      });
      const targets = [...byCategory.keys()];
      const detail =
        changed.length === 1
          ? `${splitSupplier(changed[0].supplier).base}: ${changed[0].category} → ${wanted.get(changed[0].id)}`
          : `${changed.length} fatura → ${targets.length === 1 ? targets[0] : "önceki kategorileri"}`;
      await logActivity(me, "Fatura kategorisi değişti", detail);
      // Karaoke box / Alp Koç'a giren ya da çıkan faturanın kalemleri o ayın alınan miktarından düşer / eklenir ("Geri al" da)
      await recomputeSeparateMoves(changed.map((r) => ({ id: r.id, date: r.date, from: r.category, to: wanted.get(r.id)! })));
      refresh();
    }
    // Kategorisi zaten doğru olan seçilmiş faturalar da kontrol edilmiş sayılır
    const same = rows.filter((r) => wanted.get(r.id) === r.category).map((r) => r.id);
    if (same.length) {
      await db.update(s.invoices).set({ needsReview: false }).where(and(inArray(s.invoices.id, same), eq(s.invoices.needsReview, true)));
      if (!changed.length) refresh();
    }
    return {
      previous: changed.map((r) => ({ id: r.id, category: r.category })),
      changed: changed.length,
      missing: wanted.size - rows.length,
    };
  });
}

/**
 * Eşitlemenin kategorisini tahmin ettiği faturaları "kontrol edildi" yapar (Onayla / Hepsini onayla). `undo`
 * verilirse aynı faturalar yeniden kontrol bekleyene döner (bildirimdeki "Geri al").
 */
export async function confirmInvoices(ids: number[], undo = false) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = z.array(zId).min(1, "Fatura seçin").max(1000).parse(ids);
    const rows = await getDb()
      .update(s.invoices)
      .set({ needsReview: z.boolean().parse(undo) })
      .where(and(inArray(s.invoices.id, list), eq(s.invoices.needsReview, !undo)))
      .returning({ id: s.invoices.id, supplier: s.invoices.supplier });
    if (rows.length && !undo) await logActivity(me, "Faturalar onaylandı", rows.length === 1 ? splitSupplier(rows[0].supplier).base : `${rows.length} fatura`);
    refresh();
    return { changed: rows.length, ids: rows.map((r) => r.id) };
  });
}

/** Panelden yüklenmiş bir belgeyi siler (Paraşüt'ten gelen PDF'in kopyası da silinebilir; gerekirse yeniden indirilir) */
export async function deleteInvoiceDocument(documentId: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.parse(documentId);
    const [row] = await getDb().delete(s.invoiceDocuments).where(eq(s.invoiceDocuments.id, id)).returning({ fileName: s.invoiceDocuments.fileName, source: s.invoiceDocuments.source });
    if (!row) throw new UserError("Belge bulunamadı; silinmiş olabilir.");
    await logActivity(me, "Fatura belgesi silindi", row.fileName);
    refresh();
    return { source: row.source };
  });
}

// ---------------------------------------------------------------- Ödeme durumu (ödendi, talep edildi, ödenmedi)

const zMethod = z.enum(PAYMENT_METHOD_VALUES);

/**
 * Ödeme durumu değişikliği. "paid": ödendi (gün verilmezse bugün, Türkiye; null ise gün bilinmiyor), ödeme talebi
 * kapanır; "requested": ödenmedi ama ödemesi istendi (ödeme talebi); "unpaid": ödenmedi, talep de silinir.
 */
const paymentChangeSchema = z.discriminatedUnion("status", [
  // date: null = ödeme günü bilinmiyor (ör. Paraşüt'te ödenmiş görünen faturayı ödendi yapmak)
  z.object({ status: z.literal("paid"), date: zDate.nullable().optional(), via: zMethod.nullable().optional() }),
  z.object({ status: z.literal("requested"), date: zDate.optional() }),
  z.object({ status: z.literal("unpaid") }),
]);
type PaymentChange = z.infer<typeof paymentChangeSchema>;

/** Faturanın ödeme alanları ("Geri al" bunları olduğu gibi geri yazar) */
const paymentStateSchema = z.object({
  id: zId,
  unpaid: z.boolean(),
  paidAt: zDate.nullable(),
  paidVia: zMethod.nullable(),
  paymentRequestedAt: zDate.nullable(),
  /** ✓'nin hesaptaki paradan yazdığı dağıtımlar: "Geri al" önce bunları siler (yalnız cari takipte) */
  allocationIds: z.array(zId).max(1000).optional(),
  /** Defterin (cari ödemelerinin) kapattığı fatura: "Geri al" işareti settle.ts'e yeniden koydurur */
  paidByLedger: z.boolean().optional(),
});
export type InvoicePaymentState = z.infer<typeof paymentStateSchema>;

const zIds = z.array(zId).min(1, "Fatura seçin").max(1000, "Tek seferde en fazla 1000 fatura");

/**
 * Hangi faturalara yazılır: "changing" yalnız ödendi ↔ ödenmedi değişenlere (Faturalar, Ödemeler); "open" ödendi ya
 * da talep edildi seçilince yalnız ödenmemişlere (toplu işlemde zaten ödenmiş faturanın ödeme günü bozulmasın);
 * "all" hepsine (tek faturada ödeme gününü düzeltmek).
 */
type PaymentScope = "changing" | "open" | "all";

/**
 * Ödeme durumunu yazar (`scope`'taki faturalara). Ödenmemişten ödendiye geçen "son ödenenler"e yazılır (Ödemeler'den
 * 30 gün geri alınır), ödendiden geri dönen oradan düşer. Önceki durumlar döner: "Geri al" restoreInvoicePayment ile
 * geri yazar.
 */
async function applyPayment(ids: number[], change: PaymentChange, scope: PaymentScope, opts: { by: string; separately?: boolean }) {
  const db = getDb();
  const before = await db
    .select({
      id: s.invoices.id,
      unpaid: s.invoices.unpaid,
      paidAt: s.invoices.paidAt,
      paidVia: s.invoices.paidVia,
      paymentRequestedAt: s.invoices.paymentRequestedAt,
      paidByLedger: s.invoices.paidByLedger,
    })
    .from(s.invoices)
    .where(inArray(s.invoices.id, ids));
  const paid = change.status === "paid";
  const targets =
    scope === "changing" ? before.filter((r) => r.unpaid === paid) : scope === "open" && change.status !== "unpaid" ? before.filter((r) => r.unpaid) : before;
  const none: CreditUse = { allocationIds: [], used: new Map(), closed: [] };
  if (!targets.length) return { rows: [], previous: [] as InvoicePaymentState[], missing: ids.length - before.length, credit: none, unchanged: 0 };
  // Ödenmedi / Talep edildi: hesaptaki ödemeyle kapanmış fatura önce ödemeden çıkarılır (K7)
  if (!paid) await assertNotCovered(db, targets.map((r) => r.id));
  // Ödendi: önce kartın hesabındaki para (K6); tamamen karşılanan fatura defterle kapanır, kalanı bugünkü gibi
  // işaretlenir. "Ayrıca ödendi" seçilirse hesaptaki para kullanılmaz
  const credit = paid && !opts.separately ? await creditFirstForInvoices(targets.filter((r) => r.unpaid).map((r) => r.id), opts.by) : none;
  const closed = new Set(credit.closed);
  const today = todayTR();
  // Ödeme alanlarını kullanıcı yazdı: fatura defterin kapattığı fatura sayılmaz
  const set =
    change.status === "paid"
      ? { unpaid: false, paidAt: change.date === undefined ? today : change.date, paidVia: change.via ?? null, paymentRequestedAt: null, paidByLedger: false }
      : change.status === "requested"
        ? { unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: change.date ?? today, paidByLedger: false }
        : { unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: null, paidByLedger: false };
  const returning = { id: s.invoices.id, supplier: s.invoices.supplier, payable: s.invoices.payable, date: s.invoices.date, dueDate: s.invoices.dueDate };
  const open = targets.filter((r) => !closed.has(r.id));
  // Yazım şimdiki duruma koşullu (okuma kilitsizdi): "ödendi" yalnız hâlâ ödenmemiş faturaya yazılır, bu arada
  // hesaptaki parayla kapanan (eşzamanlı ✓ ya da ödeme) ezilmez; zaten ödenmiş faturada yalnız gün ya da şekil
  // gerçekten değişince yazılır (aynı değerlerle Kaydet defterin işaretini bozmaz)
  const written: { id: number; supplier: string; payable: number; date: string; dueDate: string | null }[] = [];
  if (change.status === "paid") {
    const wasOpen = open.filter((r) => r.unpaid).map((r) => r.id);
    const wasPaid = open.filter((r) => !r.unpaid).map((r) => r.id);
    if (wasOpen.length) written.push(...(await db.update(s.invoices).set(set).where(and(inArray(s.invoices.id, wasOpen), eq(s.invoices.unpaid, true))).returning(returning)));
    if (wasPaid.length)
      written.push(
        ...(await db
          .update(s.invoices)
          .set(set)
          .where(
            and(
              inArray(s.invoices.id, wasPaid),
              eq(s.invoices.unpaid, false),
              or(sql`${s.invoices.paidAt} is distinct from ${set.paidAt}`, sql`${s.invoices.paidVia} is distinct from ${set.paidVia}`),
            ),
          )
          .returning(returning)),
      );
  } else if (open.length) written.push(...(await db.update(s.invoices).set(set).where(inArray(s.invoices.id, open.map((r) => r.id))).returning(returning)));
  const ledger = closed.size ? await db.select(returning).from(s.invoices).where(inArray(s.invoices.id, [...closed])) : [];
  const rows = [...written, ...ledger];
  const wasUnpaid = new Set(targets.filter((r) => r.unpaid).map((r) => r.id));
  const requested = new Map(targets.map((r) => [r.id, r.paymentRequestedAt]));
  // Fatura → ✓'nin hesaptaki paradan yazdığı dağıtımlar ("Geri al" önce bunları siler)
  const allocationsOf = new Map<number, number[]>();
  if (credit.allocationIds.length) {
    const rowsA = await db
      .select({ id: s.supplierAllocations.id, invoiceId: s.supplierAllocations.invoiceId })
      .from(s.supplierAllocations)
      .where(inArray(s.supplierAllocations.id, credit.allocationIds));
    for (const a of rowsA) if (a.invoiceId !== null) allocationsOf.set(a.invoiceId, [...(allocationsOf.get(a.invoiceId) ?? []), a.id]);
  }
  if (paid) {
    // Yalnız durumu gerçekten değişenler "son ödenenler"e yazılır (zaten ödenmiş fatura geri alınacaklara girmesin);
    // ödeme talebi günü de saklanır: oradan geri alınınca "talep edildi" geri gelir
    await rememberPaid(
      rows
        .filter((r) => wasUnpaid.has(r.id))
        .map((r) => ({
          kind: "invoice" as const,
          id: r.id,
          title: r.supplier,
          amount: r.payable,
          dueDate: r.dueDate ?? r.date,
          requestedAt: requested.get(r.id) ?? null,
          ...(allocationsOf.has(r.id) ? { allocationIds: allocationsOf.get(r.id) } : {}),
        })),
    );
  } else {
    await forgetPaid("invoice", rows.map((r) => r.id));
  }
  // "Geri al" yalnız bu işlemin değiştirdiği faturaları geri yazar
  const changed = new Set(rows.map((r) => r.id));
  const previous = targets.filter((r) => changed.has(r.id)).map((r) => paymentStateSchema.parse({ ...r, ...(allocationsOf.has(r.id) ? { allocationIds: allocationsOf.get(r.id) } : {}) }));
  return { rows, previous, missing: ids.length - before.length, credit, unchanged: targets.length - rows.length };
}

const PAYMENT_LOG: Record<PaymentChange["status"], [one: string, many: string]> = {
  paid: ["Fatura ödendi", "Faturalar ödendi"],
  requested: ["Faturanın ödemesi talep edildi", "Faturaların ödemesi talep edildi"],
  unpaid: ["Fatura ödenmedi işaretlendi", "Faturalar ödenmedi işaretlendi"],
};

async function logPayment(me: { name: string }, change: PaymentChange, rows: { id: number; supplier: string; payable: number }[], credit?: CreditUse) {
  if (!rows.length) return;
  const [one, many] = PAYMENT_LOG[change.status];
  const when = change.status === "paid" && change.date ? ` · ${dateTR(change.date)}` : "";
  const via = change.status === "paid" && change.via ? ` · ${methodLabel(change.via)}` : "";
  const used = credit ? creditText(credit, rows.map((r) => r.id)) : "";
  if (rows.length === 1) await logActivity(me, one, `${rows[0].supplier} ${tl(rows[0].payable, 2)}${when}${via}${used}`);
  else await logActivity(me, many, `${rows.length} fatura · ${tl(rows.reduce((a, r) => a + r.payable, 0), 2)}${when}${via}${used}`);
}

/** Bildirim için: hesaptaki paradan sayılan toplam ve defterle kapanan fatura sayısı */
const creditSummary = (credit: CreditUse) => ({ used: round2([...credit.used.values()].reduce((a, v) => a + v, 0)), closed: credit.closed.length });

/**
 * Bir ya da birçok faturayı ödendi / ödenmedi işaretler (Faturalar, Ödemeler). Ödendi işaretlenene ödeme günü olarak
 * bugün yazılır; ödenmediye dönen faturanın ödeme günü silinir. Değişen faturaların önceki durumu döner ("Geri al"
 * restoreInvoicePayment ile geri yazar).
 */
export async function setInvoicePaid(id: number | number[], paid: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const ids = zIds.parse(Array.isArray(id) ? id : [id]);
    const change: PaymentChange = z.boolean().parse(paid) ? { status: "paid" } : { status: "unpaid" };
    const { rows, previous, credit } = await applyPayment(ids, change, "changing", { by: me.name });
    await logPayment(me, change, rows, credit);
    refresh();
    return { changed: rows.length, previous, credit: creditSummary(credit) };
  });
}

/**
 * Tedarikçiler'den ödeme durumu: ödendi (gün ve ödeme şekliyle), ödemesi talep edildi ya da ödenmedi. Ödeme
 * penceresinde tek faturanın ödeme günü de düzeltilir; birden çok faturada ve `onlyOpen` ile (✓ Ödendi, ödeme talebi,
 * "Ödendi yap": ekranda ödenmemiş görünen faturalar) ödendi / talep edildi yalnız ödenmemişlere yazılır, başka bir
 * oturumda ödenmiş faturanın ödeme günü ezilmez. Önceki durumlar "Geri al" için döner.
 */
export async function setInvoicePayment(ids: number[], change: z.input<typeof paymentChangeSchema>, opts: { onlyOpen?: boolean; separately?: boolean } = {}) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = zIds.parse(ids);
    const c = paymentChangeSchema.parse(change);
    if (c.status === "paid" && c.date && c.date > addDays(todayTR(), 1)) throw new UserError("Ödeme günü ileri bir tarih olamaz");
    // separately: "Ayrıca ödendi" (hesaptaki cari ödemesi kullanılmaz)
    const { rows, previous, missing, credit, unchanged } = await applyPayment(list, c, list.length > 1 || z.boolean().optional().parse(opts.onlyOpen) ? "open" : "all", {
      by: me.name,
      separately: z.boolean().optional().parse(opts.separately),
    });
    if (missing === list.length) throw new UserError("Faturalar bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
    // Ödenmiş faturada aynı gün ve şekille Kaydet: yazılacak bir şey yok
    if (!rows.length && unchanged && list.length === 1 && c.status === "paid") return { changed: 0, previous: [] as InvoicePaymentState[], missing, credit: creditSummary(credit) };
    if (!rows.length) {
      // Başka bir oturumda ödenmiş: ekran yenilenir, satır güncel hâliyle görünür
      refresh();
      throw new UserError("Seçilen faturalar zaten ödenmiş; değişiklik yapılmadı.");
    }
    await logPayment(me, c, rows, credit);
    refresh();
    return { changed: rows.length, previous, missing, credit: creditSummary(credit) };
  });
}

/**
 * "Geri al": faturaların ödeme alanlarını setInvoicePayment'tan önceki hâline döndürür. ✓ hesaptaki cari ödemesini
 * kullandıysa önce o dağıtımlar silinir (para hesaba döner); hesaptaki ödemeyle kapanmış fatura ödenmediye dönmez.
 */
export async function restoreInvoicePayment(states: z.input<typeof paymentStateSchema>[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = z.array(paymentStateSchema).min(1, "Geri alınacak değişiklik yok").max(1000).parse(states);
    const db = getDb();
    await dropAllocations(
      list.flatMap((x) => x.allocationIds ?? []),
      list.map((x) => x.id),
    );
    await assertNotCovered(
      db,
      list.filter((x) => x.unpaid).map((x) => x.id),
    );
    const current = await db
      .select({ id: s.invoices.id, unpaid: s.invoices.unpaid })
      .from(s.invoices)
      .where(inArray(s.invoices.id, list.map((x) => x.id)));
    const wasUnpaid = new Set(current.filter((r) => r.unpaid).map((r) => r.id));
    // Defterin kapattığı fatura ödenmemiş yazılır, settle.ts dağıtımlarına bakıp yeniden kapatır (gün ve şekil son
    // ödemeden); hâlâ karşılanmıyorsa açık kalır
    const ledger = list.filter((x) => x.paidByLedger === true && !x.unpaid).map((x) => x.id);
    const rows = await db.transaction(async (tx) => {
      const out: { id: number; supplier: string; payable: number; date: string; dueDate: string | null }[] = [];
      for (const { id, unpaid, paidAt, paidVia, paymentRequestedAt } of list) {
        const state = ledger.includes(id) ? { unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: null } : { unpaid, paidAt, paidVia, paymentRequestedAt };
        const [r] = await tx
          .update(s.invoices)
          .set({ ...state, paidByLedger: false })
          .where(eq(s.invoices.id, id))
          .returning({ id: s.invoices.id, supplier: s.invoices.supplier, payable: s.invoices.payable, date: s.invoices.date, dueDate: s.invoices.dueDate });
        if (r) out.push(r);
      }
      return out;
    });
    if (ledger.length) await resettleInvoices(ledger);
    // Son ödenenler de geri döner: yeniden ödenmemiş olan düşer, yeniden ödenmiş olan (ödenmediyken) yazılır
    const unpaidNow = new Set(list.filter((x) => x.unpaid).map((x) => x.id));
    await forgetPaid("invoice", rows.filter((r) => unpaidNow.has(r.id)).map((r) => r.id));
    // Geri alınan değişiklikten önceki talep günü bilinmez (şimdiki, geri alınan değişikliğinki): boş yazılır
    await rememberPaid(
      rows
        .filter((r) => !unpaidNow.has(r.id) && wasUnpaid.has(r.id))
        .map((r) => ({ kind: "invoice" as const, id: r.id, title: r.supplier, amount: r.payable, dueDate: r.dueDate ?? r.date, requestedAt: null })),
    );
    if (rows.length) await logActivity(me, "Ödeme durumu geri alındı", rows.length === 1 ? `${rows[0].supplier} ${tl(rows[0].payable, 2)}` : `${rows.length} fatura`);
    refresh();
    return { changed: rows.length };
  });
}

// ---------------------------------------------------------------- Silme ve geri alma

type InvoiceRow = typeof s.invoices.$inferSelect;
type BillLineRow = typeof s.parasutBillLines.$inferSelect;

/** Silinen satırın yeniden yazılabilir kopyası (kimlik, oluşturma ve eşitleme zamanı hariç) */
function snapshotOf(r: InvoiceRow) {
  return {
    date: r.date,
    supplier: r.supplier,
    description: r.description,
    invoiceNo: r.invoiceNo,
    category: r.category,
    amount: r.amount,
    discount: r.discount,
    payable: r.payable,
    unpaid: r.unpaid,
    note: r.note,
    source: r.source,
    origin: r.origin,
    externalId: r.externalId,
    vat: r.vat,
    dueDate: r.dueDate,
    parasutUnpaid: r.parasutUnpaid,
    outstanding: r.outstanding,
    eInvoiceId: r.eInvoiceId,
    eInvoiceUuid: r.eInvoiceUuid,
    paidAt: r.paidAt,
    paidVia: r.paidVia,
    paymentRequestedAt: r.paymentRequestedAt,
    supplierTaxNumber: r.supplierTaxNumber,
    ledgerBase: r.ledgerBase,
    paidByLedger: r.paidByLedger,
  };
}

/** Eşitlemenin tanıdığı Paraşüt anahtarı: gider faturası kimliği ya da (içeri alınmamış) "ei:" + e-fatura kimliği */
function parasutKeyOf(r: { externalId: string | null; eInvoiceId?: string | null }): string | null {
  return r.externalId ?? (r.eInvoiceId ? `ei:${r.eInvoiceId}` : null);
}

// Geri alınan kayıt veritabanındaki satırın kopyasıdır: Paraşüt'ten gelen uzun açıklama / tedarikçi adı
// (sınırsız yazılır) geri almayı engellemesin diye sınırlar formdakinden geniştir.
const snapshotSchema = z.object({
  date: zDate,
  supplier: zText("Tedarikçi", 2000),
  description: z.string().max(10000).nullable(),
  invoiceNo: z.string().max(500).nullable(),
  category: zCategory,
  amount: z.number().finite(),
  discount: z.number().finite(),
  payable: z.number().finite(),
  unpaid: z.boolean(),
  note: z.string().max(10000).nullable(),
  source: z.enum(["manual", "excel", "parasut"]),
  origin: z.enum(["manual", "excel", "parasut"]),
  externalId: z.string().nullable(),
  vat: z.number().finite(),
  dueDate: zDate.nullable(),
  parasutUnpaid: z.boolean().nullable(),
  outstanding: z.number().finite().nullable(),
  eInvoiceId: z.string().max(64).nullable().optional(),
  eInvoiceUuid: z.string().max(64).nullable().optional(),
  // Ödeme alanları sonradan eklendi: eski kopyalarda yoktur
  paidAt: zDate.nullable().optional(),
  paidVia: zMethod.nullable().optional(),
  paymentRequestedAt: zDate.nullable().optional(),
  // Tedarikçinin vergi nosu da sonradan eklendi (eski kopya boş geri gelir); saklanan biçimde (yalnız rakam) yazılır
  supplierTaxNumber: z.string().max(20).nullable().optional().transform((v) => cleanTaxNumber(v)),
  // Cari takip (sonradan eklendi; eski kopyada yok): taban ve defterin kapattığı fatura. Sayılan toplam (allocated)
  // kopyada durmaz, dağıtımlar yeniden yazılınca hesaplanır
  ledgerBase: z.number().finite().min(0).nullable().optional(),
  paidByLedger: z.boolean().optional(),
});

/** Silinen faturanın cari bağları (releaseInvoiceLinks): geri alınınca yeniden kurulur, sığmayan para hesapta kalır */
const cariLinksSchema = z.object({
  allocations: z
    .array(z.object({ paymentId: zId, amount: z.number().finite().positive(), originDebtId: zId.nullable() }))
    .max(500),
  debtIds: z.array(zId).max(500),
});
type Snapshot = z.infer<typeof snapshotSchema>;
type DeletedEntry = {
  externalId: string;
  deletedAt: string;
  deletedBy: string;
  row: Snapshot;
  lines: Omit<BillLineRow, "id" | "invoiceId">[];
  /** Silinirken cari ödemesi sayılmış ya da faturasız alım bağlıydı (eski kopyalar; yenilerde `cari`) */
  hadCari?: boolean;
  /**
   * Silinirken bağlı faturasız alımlar (geri alınınca hâlâ bağsızsa yeniden bağlanır) ve faturaya doğrudan sayılmış
   * ödemelerin toplamı (hesaba geçti; yeniden sayılmaz, söylenir)
   */
  cari?: { debtIds: number[]; paid: number };
};

/** Kalemin yeniden yazılabilir kopyası (satır ve fatura kimliği hariç) */
function lineCopy(l: BillLineRow): DeletedEntry["lines"][number] {
  return {
    externalId: l.externalId,
    productKey: l.productKey,
    productName: l.productName,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.unitPrice,
    discount: l.discount,
    vatRate: l.vatRate,
    netTotal: l.netTotal,
  };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** integration_state değerini satırı kilitleyerek okur (aynı anda iki silme listeyi ezmesin) */
async function readStateForUpdate<T>(tx: Tx, key: string): Promise<T | null> {
  const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, key)).for("update").limit(1);
  return (row?.value as T | undefined) ?? null;
}

async function writeState(tx: Tx, key: string, value: unknown) {
  await tx
    .insert(s.integrationState)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/**
 * Faturayı siler. Elle/Excel'le girilmiş faturanın kopyası döner (bildirimdeki "Geri al" restoreInvoice ile
 * geri yazar). Paraşüt faturası yok sayılanlara (parasut.ignore) eklenir, sonraki eşitlemede geri gelmez; kopyası
 * kalemleriyle parasut.deleted'da saklanır, Faturalar'daki "Silinen Paraşüt faturaları"ndan geri alınabilir.
 */
export async function deleteInvoice(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const invoiceId = zId.parse(id);
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      // Önce cari bağları (K11): bağlı faturasız alımlar eski hâline döner, borçtan gelen ödemeler borca geri taşınır;
      // faturaya sayılan öteki ödemeler fatura silinince hesaba geçer
      const links = await releaseInvoiceLinks(tx, invoiceId, me.name);
      const hadCari = links.allocations.length > 0 || links.debtIds.length > 0;
      const lines = await tx.select().from(s.parasutBillLines).where(eq(s.parasutBillLines.invoiceId, invoiceId));
      const [d] = await tx.delete(s.invoices).where(eq(s.invoices.id, invoiceId)).returning();
      if (!d) return null;
      const key = parasutKeyOf(d);
      if (key) {
        const ignore = (await readStateForUpdate<string[]>(tx, IGNORE_KEY)) ?? [];
        if (!ignore.includes(key)) await writeState(tx, IGNORE_KEY, [...ignore, key].slice(-2000));
        const deleted = ((await readStateForUpdate<DeletedEntry[]>(tx, DELETED_BILLS_KEY)) ?? []).filter((e) => e.externalId !== key);
        const entry: DeletedEntry = {
          externalId: key,
          deletedAt: new Date().toISOString(),
          deletedBy: me.name,
          row: snapshotOf(d),
          lines: lines.map(lineCopy),
          ...(hadCari ? { hadCari, cari: { debtIds: links.debtIds, paid: round2(links.allocations.reduce((a, x) => a + x.amount, 0)) } } : {}),
        };
        await writeState(tx, DELETED_BILLS_KEY, [...deleted, entry].slice(-DELETED_BILLS_LIMIT));
      }
      return { d, lines: lines.length, links: hadCari ? { allocations: links.allocations, debtIds: links.debtIds } : null };
    });
    if (!result) throw new UserError("Fatura bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    const { d } = result;
    // Kalemleri hammaddeye bağlıysa o ayın alınan miktarı silinen fatura olmadan yeniden hesaplanır
    if (result.lines) await applyProductLinks([d.date.slice(0, 7)]);
    // Silinen fatura Ödemeler › Son ödenenler'de kalmasın ("Geri al" bulamayacağı bir satır olurdu)
    await forgetPaid("invoice", [invoiceId]);
    const cari = result.links
      ? ` · ${[
          result.links.allocations.length ? `${tl(round2(result.links.allocations.reduce((a, x) => a + x.amount, 0)), 2)} ödeme hesaba geçti` : "",
          result.links.debtIds.length ? `${result.links.debtIds.length} faturasız alım yeniden açık` : "",
        ]
          .filter(Boolean)
          .join(" · ")}`
      : "";
    await logActivity(me, "Fatura silindi", `${dateTR(d.date)} ${d.supplier} ${d.invoiceNo ?? ""}`.trim() + cari);
    refresh();
    return {
      externalId: parasutKeyOf(d),
      /** Elle/Excel faturası için geri alma kopyası (cari bağlarıyla); Paraşüt faturası sunucuda saklanır */
      snapshot: parasutKeyOf(d) ? null : { ...snapshotOf(d), ...(result.links ? { cari: result.links } : {}) },
      quantitiesRecomputed: result.lines > 0,
    };
  });
}

/**
 * Az önce silinen elle/Excel faturasını geri yazar (bildirimdeki "Geri al"). Paraşüt faturası için unignoreParasutBill.
 * Cari bağları varsa yeniden kurulur ve yeniden doğrulanır: bağsız kalmış alım yeniden bağlanır, ödemenin hesabında
 * hâlâ duran para yeniden sayılır; sığmayan hesapta kalır.
 */
export async function restoreInvoice(snapshot: z.input<typeof snapshotSchema> & { cari?: z.input<typeof cariLinksSchema> }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const row = snapshotSchema.parse(snapshot);
    const links = snapshot.cari ? cariLinksSchema.parse(snapshot.cari) : null;
    if (row.externalId || row.eInvoiceId) throw new UserError("Paraşüt faturası “Silinen Paraşüt faturaları” listesinden geri alınır.");
    const db = getDb();
    const out = await db.transaction(async (tx) => {
      const [r] = await tx.insert(s.invoices).values(row).returning({ id: s.invoices.id });
      if (!links) return { id: r.id, lost: 0 };
      const res = await reattachInvoiceLinks(tx, r.id, links, me.name, { supplier: row.supplier, taxNumber: row.supplierTaxNumber ?? null });
      return { id: r.id, lost: res.lost };
    });
    const lost = out.lost > 0.005 ? ` · ${tl(out.lost, 2)} ödeme yeniden sayılamadı, hesapta kaldı` : "";
    await logActivity(me, "Silinen fatura geri alındı", `${dateTR(row.date)} ${row.supplier} ${row.invoiceNo ?? ""}`.trim() + lost);
    refresh();
    return { id: out.id };
  });
}

/**
 * Silinen bir Paraşüt faturasını yok sayılanlardan çıkarır. Kopyası saklıysa fatura (kalemleriyle) hemen listeye
 * döner ve eşitleme onu yeniden günceller; kopya yoksa (bu özellikten önce silinmiş) sonraki eşitlemede gelir.
 */
export async function unignoreParasutBill(externalId: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const ext = z.string().trim().min(1, "Paraşüt kimliği gerekli").max(64).parse(externalId);
    const db = getDb();
    const out = await db.transaction(async (tx) => {
      const ignore = (await readStateForUpdate<string[]>(tx, IGNORE_KEY)) ?? [];
      const deleted = (await readStateForUpdate<DeletedEntry[]>(tx, DELETED_BILLS_KEY)) ?? [];
      const entry = deleted.find((e) => e.externalId === ext) ?? null;
      if (!ignore.includes(ext) && !entry) return { status: "missing" as const, entry: null, lines: 0 };
      await writeState(tx, IGNORE_KEY, ignore.filter((x) => x !== ext));
      if (entry) await writeState(tx, DELETED_BILLS_KEY, deleted.filter((e) => e.externalId !== ext));
      if (!entry) return { status: "unignored" as const, entry: null, lines: 0 };
      const [existing] = await tx
        .select({ id: s.invoices.id })
        .from(s.invoices)
        .where(ext.startsWith("ei:") ? eq(s.invoices.eInvoiceId, ext.slice(3)) : eq(s.invoices.externalId, ext))
        .limit(1);
      if (existing) return { status: "exists" as const, entry, lines: 0 };
      // Cari ödemeleri bu faturaya yeniden sayılmaz (silinirken hesaba geçtiler): defterin kapattığı fatura ödenmemiş döner
      const parsed = snapshotSchema.parse(entry.row);
      const row = parsed.paidByLedger ? { ...parsed, unpaid: true, paidAt: null, paidVia: null, paidByLedger: false } : parsed;
      const [r] = await tx.insert(s.invoices).values(row).returning({ id: s.invoices.id });
      // Silinirken bağlı faturasız alımlar hâlâ bağsızsa yeniden bağlanır (silme gider kayıtlarını yeniden yazmıştı;
      // bağlanmazsa alım hem faturada hem Aylık harcamalar'da gider olurdu)
      const debtIds = (entry.cari?.debtIds ?? []).filter((x) => Number.isInteger(x) && x > 0);
      const relinked = debtIds.length
        ? (await reattachInvoiceLinks(tx, r.id, { allocations: [], debtIds }, me.name, { supplier: row.supplier, taxNumber: row.supplierTaxNumber ?? null })).relinked
        : 0;
      let lines = 0;
      if (entry.lines?.length) {
        // Aynı Paraşüt kalemi bu arada başka satıra yazıldıysa (benzersiz kimlik) o kalem atlanır
        const taken = new Set(
          (
            await tx
              .select({ externalId: s.parasutBillLines.externalId })
              .from(s.parasutBillLines)
              .where(inArray(s.parasutBillLines.externalId, entry.lines.map((l) => l.externalId)))
          ).map((x) => x.externalId),
        );
        const fresh = entry.lines.filter((l) => !taken.has(l.externalId));
        if (fresh.length) await tx.insert(s.parasutBillLines).values(fresh.map((l) => ({ ...l, invoiceId: r.id })));
        lines = fresh.length;
      }
      return { status: "restored" as const, entry, lines, relinked };
    });
    if (out.status === "missing") throw new UserError("Bu Paraşüt faturası yok sayılanlar listesinde değil; sayfayı yenileyin.");
    if (out.lines && out.entry) await applyProductLinks([out.entry.row.date.slice(0, 7)]);
    const label = out.entry ? `${dateTR(out.entry.row.date)} ${splitSupplier(out.entry.row.supplier).base}` : `Paraşüt #${ext}`;
    await logActivity(me, "Silinen Paraşüt faturası geri alındı", label);
    refresh();
    const relinked = out.status === "restored" ? out.relinked : 0;
    const paidBack = out.entry?.cari ? out.entry.cari.paid > 0.005 : Boolean(out.entry?.hadCari);
    const cariNote = [
      relinked ? ` ${relinked} faturasız alım faturaya yeniden bağlandı.` : "",
      out.status === "restored" && out.entry?.cari && out.entry.cari.debtIds.length > relinked ? " Bağlı alımlardan bazıları bu arada değişti; Tedarikçiler'den Faturası geldi ile bağlayın." : "",
      paidBack ? " Ödemeler bu faturaya yeniden sayılmadı; Tedarikçiler'den Borçlara say." : "",
    ].join("");
    const message =
      out.status === "restored"
        ? `${label} listeye geri döndü. Sonraki eşitleme tutarları Paraşüt'ten günceller.${cariNote}`
        : out.status === "exists"
          ? `${label} zaten listede; yok sayma kaldırıldı.`
          : "Yok sayma kaldırıldı. Fatura sonraki Paraşüt eşitlemesinde yeniden alınır; eski bir faturaysa Paraşüt sayfasından o tarihten eşitleyin.";
    return { status: out.status, message };
  });
}

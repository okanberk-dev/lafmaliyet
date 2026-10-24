"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { amountsChanged, DELETED_BILLS_KEY, DELETED_BILLS_LIMIT, isParasutLinked, joinTR, LOCKED_LABELS, lockedChanges, splitSupplier, type LockedField } from "@/app/panel/faturalar/rules";
import { cleanTaxNumber, methodLabel, PAYMENT_METHOD_VALUES } from "@/app/panel/tedarikciler/logic";
import { INVOICE_CATEGORIES } from "@/lib/constants";
import { round2 } from "@/lib/cari/balance";
import { dateTR, tl } from "@/lib/format";
import { crossesSeparate, separateMoveMonths } from "@/lib/invoice-linking";
import { addDays, todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import {
  assertNotCovered,
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
    if (!id) {
      // Cari takipteki kartın yeni faturası panelde sayılır (taban 0; src/lib/cari/balance.ts)
      const ledgerBase = await ledgerBaseForNew(data.supplier, null);
      const [row] = await db
        .insert(s.invoices)
        .values({ ...data, paidAt: data.unpaid ? null : (paidAt ?? null), ledgerBase })
        .returning({ id: s.invoices.id });
      await logActivity(me, "Fatura eklendi", `${dateTR(data.date)} ${data.supplier}: ${tl(data.amount - data.discount, 2)} (KDV hariç)`);
      refresh();
      return { id: row.id, kept: [] as LockedField[], message: null as string | null };
    }
    const [cur] = await db.select().from(s.invoices).where(eq(s.invoices.id, id)).limit(1);
    if (!cur) throw new UserError("Fatura bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    // Cari ödemesi sayılmış faturanın tutarı sayılandan aşağı inemez (Paraşüt'e bağlıda tutar kilitli)
    const counted = round2((cur.ledgerBase ?? 0) + cur.allocated);
    if (!isParasutLinked(cur) && cur.allocated > 0 && data.payable < counted - 0.005) {
      throw new UserError(`Bu faturaya ${tl(counted, 2)} ödeme sayılmış; tutar bundan az olamaz`);
    }
    // Ödenmedi: hesaptaki ödemeyle kapanmış fatura ödemeden çıkarılmadan açılamaz
    if (!cur.unpaid && data.unpaid) await assertNotCovered(db, [id]);
    let kept: LockedField[] = [];
    // Ödendiye geçerken önce kartın hesabındaki para sayılır; tamamen karşılanırsa fatura defterle kapanır, ödeme
    // alanları defterinkidir
    const credit: CreditUse = cur.unpaid && !data.unpaid ? await creditFirstForInvoices([id], me.name) : { allocationIds: [], used: new Map(), closed: [] };
    const closedByLedger = credit.closed.includes(id);
    // Ödeme günü: ödendiye geçerken gönderilmediyse bugün (null: bilinmiyor), ödeme talebi kapanır; ödenmediye dönünce
    // silinir (ödeme şekliyle); ödendi kalan faturada gönderildiyse düzeltilir. Ödeme alanlarını kullanıcı yazınca
    // fatura defterin kapattığı fatura sayılmaz
    const written = data.unpaid
      ? cur.unpaid
        ? {}
        : { paidAt: null, paidVia: null }
      : cur.unpaid
        ? { paidAt: paidAt === undefined ? todayTR() : paidAt, paymentRequestedAt: null }
        : paidAt !== undefined
          ? { paidAt }
          : {};
    const payment = closedByLedger ? {} : Object.keys(written).length ? { ...written, paidByLedger: false } : {};
    if (isParasutLinked(cur)) {
      kept = lockedChanges(cur, data);
      // Kilitli alanlar atılır; kalanlar (kategori, tedarikçi adı, açıklama, not, vade, ödeme durumu) yazılır
      const free = { supplier: data.supplier, description: data.description, category: data.category, unpaid: data.unpaid, note: data.note, dueDate: data.dueDate };
      // Kaydetmek faturayı kontrol edilmiş sayar
      await db.update(s.invoices).set({ ...free, ...payment, needsReview: false }).where(eq(s.invoices.id, id));
    } else {
      // Bağı çözülmüş kaydın eşitlemeden kalan KDV toplamı tutarlar değişince silinir: KDV ödenecek − net olur
      // (pencerede görünen), fark tevkifat sanılmaz (rules.ts amountsChanged)
      await db
        .update(s.invoices)
        .set({ ...data, ...payment, ...(amountsChanged(cur, data) ? { vat: 0 } : {}), needsReview: false })
        .where(eq(s.invoices.id, id));
      // Ödenecek arttıysa defterin kapattığı fatura yeniden açılır
      if (cur.allocated > 0 && data.payable !== cur.payable) await resettleInvoices([id]);
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
    const fields = joinTR(kept.map((k) => LOCKED_LABELS[k]));
    const message = kept.length
      ? // Kilitli alanlar formda salt okunur: fark ancak pencere açıkken eşitleme değeri değiştirdiyse çıkar
        `${fields.charAt(0).toLocaleUpperCase("tr-TR")}${fields.slice(1)} bu pencere açıkken Paraşüt eşitlemesiyle güncellendi; Paraşüt'teki yeni değer geçerli kaldı. Diğer değişiklikleriniz kaydedildi.`
      : null;
    return { id, kept, message };
  });
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
    })
    .from(s.invoices)
    .where(inArray(s.invoices.id, ids));
  const paid = change.status === "paid";
  const targets =
    scope === "changing" ? before.filter((r) => r.unpaid === paid) : scope === "open" && change.status !== "unpaid" ? before.filter((r) => r.unpaid) : before;
  const none: CreditUse = { allocationIds: [], used: new Map(), closed: [] };
  if (!targets.length) return { rows: [], previous: [] as InvoicePaymentState[], missing: ids.length - before.length, credit: none };
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
  const written = open.length ? await db.update(s.invoices).set(set).where(inArray(s.invoices.id, open.map((r) => r.id))).returning(returning) : [];
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
  const previous = targets.map((r) => paymentStateSchema.parse({ ...r, ...(allocationsOf.has(r.id) ? { allocationIds: allocationsOf.get(r.id) } : {}) }));
  return { rows, previous, missing: ids.length - before.length, credit };
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
    const { rows, previous, missing, credit } = await applyPayment(list, c, list.length > 1 || z.boolean().optional().parse(opts.onlyOpen) ? "open" : "all", {
      by: me.name,
      separately: z.boolean().optional().parse(opts.separately),
    });
    if (missing === list.length) throw new UserError("Faturalar bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
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
    const rows = await db.transaction(async (tx) => {
      const out: { id: number; supplier: string; payable: number; date: string; dueDate: string | null }[] = [];
      for (const { id, unpaid, paidAt, paidVia, paymentRequestedAt } of list) {
        const [r] = await tx
          .update(s.invoices)
          .set({ unpaid, paidAt, paidVia, paymentRequestedAt, paidByLedger: false })
          .where(eq(s.invoices.id, id))
          .returning({ id: s.invoices.id, supplier: s.invoices.supplier, payable: s.invoices.payable, date: s.invoices.date, dueDate: s.invoices.dueDate });
        if (r) out.push(r);
      }
      return out;
    });
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
  /** Silinirken cari ödemesi sayılmış ya da faturasız alım bağlıydı (geri alınınca bağlar gelmez, söylenir) */
  hadCari?: boolean;
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
          ...(hadCari ? { hadCari } : {}),
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
      return { status: "restored" as const, entry, lines };
    });
    if (out.status === "missing") throw new UserError("Bu Paraşüt faturası yok sayılanlar listesinde değil; sayfayı yenileyin.");
    if (out.lines && out.entry) await applyProductLinks([out.entry.row.date.slice(0, 7)]);
    const label = out.entry ? `${dateTR(out.entry.row.date)} ${splitSupplier(out.entry.row.supplier).base}` : `Paraşüt #${ext}`;
    await logActivity(me, "Silinen Paraşüt faturası geri alındı", label);
    refresh();
    const cariNote = out.entry?.hadCari ? " Ödemeler bu faturaya yeniden sayılmadı; Tedarikçiler'den Borçlara say." : "";
    const message =
      out.status === "restored"
        ? `${label} listeye geri döndü. Sonraki eşitleme tutarları Paraşüt'ten günceller.${cariNote}`
        : out.status === "exists"
          ? `${label} zaten listede; yok sayma kaldırıldı.`
          : "Yok sayma kaldırıldı. Fatura sonraki Paraşüt eşitlemesinde yeniden alınır; eski bir faturaysa Paraşüt sayfasından o tarihten eşitleyin.";
    return { status: out.status, message };
  });
}

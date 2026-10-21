"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { DELETED_BILLS_KEY, DELETED_BILLS_LIMIT, isParasutLinked, joinTR, LOCKED_LABELS, lockedChanges, splitSupplier, type LockedField } from "@/app/panel/faturalar/rules";
import { methodLabel, PAYMENT_METHOD_VALUES } from "@/app/panel/tedarikciler/logic";
import { INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, tl } from "@/lib/format";
import { crossesSeparate, separateMoveMonths } from "@/lib/invoice-linking";
import { addDays, todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
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
      const [row] = await db
        .insert(s.invoices)
        .values({ ...data, paidAt: data.unpaid ? null : (paidAt ?? null) })
        .returning({ id: s.invoices.id });
      await logActivity(me, "Fatura eklendi", `${dateTR(data.date)} ${data.supplier}: ${tl(data.amount - data.discount, 2)} (KDV hariç)`);
      refresh();
      return { id: row.id, kept: [] as LockedField[], message: null as string | null };
    }
    const [cur] = await db.select().from(s.invoices).where(eq(s.invoices.id, id)).limit(1);
    if (!cur) throw new UserError("Fatura bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    let kept: LockedField[] = [];
    // Ödeme günü: ödendiye geçerken gönderilmediyse bugün (null: bilinmiyor), ödeme talebi kapanır; ödenmediye dönünce
    // silinir (ödeme şekliyle); ödendi kalan faturada gönderildiyse düzeltilir
    const payment = data.unpaid
      ? cur.unpaid
        ? {}
        : { paidAt: null, paidVia: null }
      : cur.unpaid
        ? { paidAt: paidAt === undefined ? todayTR() : paidAt, paymentRequestedAt: null }
        : paidAt !== undefined
          ? { paidAt }
          : {};
    if (isParasutLinked(cur)) {
      kept = lockedChanges(cur, data);
      // Kilitli alanlar atılır; kalanlar (kategori, tedarikçi adı, açıklama, not, vade, ödeme durumu) yazılır
      const free = { supplier: data.supplier, description: data.description, category: data.category, unpaid: data.unpaid, note: data.note, dueDate: data.dueDate };
      // Kaydetmek faturayı kontrol edilmiş sayar
      await db.update(s.invoices).set({ ...free, ...payment, needsReview: false }).where(eq(s.invoices.id, id));
    } else {
      await db.update(s.invoices).set({ ...data, ...payment, needsReview: false }).where(eq(s.invoices.id, id));
    }
    // Pencereden "Ödendi" yapılan fatura da Ödemeler › Son ödenenler'den geri alınabilir
    if (cur.unpaid && !data.unpaid) await rememberPaid([{ kind: "invoice", id, title: data.supplier, amount: cur.payable, dueDate: data.dueDate ?? cur.dueDate ?? cur.date }]);
    else if (!cur.unpaid && data.unpaid) await forgetPaid("invoice", [id]);
    // Kalem yalnız Paraşüt'e bağlı faturada olur (bağı çözülünce silinir); tarihi kilitli, kalemler kayıtlı ayda
    if (isParasutLinked(cur)) await recomputeSeparateMoves([{ id, date: cur.date, from: cur.category, to: data.category }]);
    const net = isParasutLinked(cur) ? cur.amount - cur.discount : data.amount - data.discount;
    await logActivity(me, "Fatura düzenlendi", `${dateTR(isParasutLinked(cur) ? cur.date : data.date)} ${data.supplier}: ${tl(net, 2)} (KDV hariç)`);
    refresh();
    const fields = joinTR(kept.map((k) => LOCKED_LABELS[k]));
    const message = kept.length
      ? // Kilitli alanlar formda salt okunur: fark ancak pencere açıkken eşitleme değeri değiştirdiyse çıkar
        `${fields.charAt(0).toLocaleUpperCase("tr-TR")}${fields.slice(1)} bu pencere açıkken Paraşüt eşitlemesiyle güncellendi; Paraşüt'teki yeni değer geçerli kaldı. Diğer değişiklikleriniz kaydedildi.`
      : null;
    return { id, kept, message };
  });
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
async function applyPayment(ids: number[], change: PaymentChange, scope: PaymentScope) {
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
  if (!targets.length) return { rows: [], previous: [] as InvoicePaymentState[], missing: ids.length - before.length };
  const today = todayTR();
  const set =
    change.status === "paid"
      ? { unpaid: false, paidAt: change.date === undefined ? today : change.date, paidVia: change.via ?? null, paymentRequestedAt: null }
      : change.status === "requested"
        ? { unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: change.date ?? today }
        : { unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: null };
  const rows = await db
    .update(s.invoices)
    .set(set)
    .where(inArray(s.invoices.id, targets.map((r) => r.id)))
    .returning({ id: s.invoices.id, supplier: s.invoices.supplier, payable: s.invoices.payable, date: s.invoices.date, dueDate: s.invoices.dueDate });
  const wasUnpaid = new Set(targets.filter((r) => r.unpaid).map((r) => r.id));
  if (paid) {
    // Yalnız durumu gerçekten değişenler "son ödenenler"e yazılır (zaten ödenmiş fatura geri alınacaklara girmesin)
    await rememberPaid(rows.filter((r) => wasUnpaid.has(r.id)).map((r) => ({ kind: "invoice" as const, id: r.id, title: r.supplier, amount: r.payable, dueDate: r.dueDate ?? r.date })));
  } else {
    await forgetPaid("invoice", rows.map((r) => r.id));
  }
  const previous = targets.map((r) => paymentStateSchema.parse(r));
  return { rows, previous, missing: ids.length - before.length };
}

const PAYMENT_LOG: Record<PaymentChange["status"], [one: string, many: string]> = {
  paid: ["Fatura ödendi", "Faturalar ödendi"],
  requested: ["Faturanın ödemesi talep edildi", "Faturaların ödemesi talep edildi"],
  unpaid: ["Fatura ödenmedi işaretlendi", "Faturalar ödenmedi işaretlendi"],
};

async function logPayment(me: { name: string }, change: PaymentChange, rows: { supplier: string; payable: number }[]) {
  if (!rows.length) return;
  const [one, many] = PAYMENT_LOG[change.status];
  const when = change.status === "paid" && change.date ? ` · ${dateTR(change.date)}` : "";
  const via = change.status === "paid" && change.via ? ` · ${methodLabel(change.via)}` : "";
  if (rows.length === 1) await logActivity(me, one, `${rows[0].supplier} ${tl(rows[0].payable, 2)}${when}${via}`);
  else await logActivity(me, many, `${rows.length} fatura · ${tl(rows.reduce((a, r) => a + r.payable, 0), 2)}${when}${via}`);
}

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
    const { rows, previous } = await applyPayment(ids, change, "changing");
    await logPayment(me, change, rows);
    refresh();
    return { changed: rows.length, previous };
  });
}

/**
 * Tedarikçiler'den ödeme durumu: ödendi (gün ve ödeme şekliyle), ödemesi talep edildi ya da ödenmedi. Tek faturada
 * ödenmiş faturanın ödeme günü de düzeltilir; birden çok faturada ödendi / talep edildi yalnız ödenmemişlere yazılır.
 * Önceki durumlar "Geri al" için döner.
 */
export async function setInvoicePayment(ids: number[], change: z.input<typeof paymentChangeSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = zIds.parse(ids);
    const c = paymentChangeSchema.parse(change);
    if (c.status === "paid" && c.date && c.date > addDays(todayTR(), 1)) throw new UserError("Ödeme günü ileri bir tarih olamaz");
    const { rows, previous, missing } = await applyPayment(list, c, list.length > 1 ? "open" : "all");
    if (missing === list.length) throw new UserError("Faturalar bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
    if (!rows.length) throw new UserError("Seçilen faturalar zaten ödenmiş; değişiklik yapılmadı.");
    await logPayment(me, c, rows);
    refresh();
    return { changed: rows.length, previous, missing };
  });
}

/** "Geri al": faturaların ödeme alanlarını setInvoicePayment'tan önceki hâline döndürür */
export async function restoreInvoicePayment(states: z.input<typeof paymentStateSchema>[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = z.array(paymentStateSchema).min(1).max(1000).parse(states);
    const db = getDb();
    const current = await db.select({ id: s.invoices.id, unpaid: s.invoices.unpaid }).from(s.invoices).where(inArray(s.invoices.id, list.map((x) => x.id)));
    const wasUnpaid = new Set(current.filter((r) => r.unpaid).map((r) => r.id));
    const rows = await db.transaction(async (tx) => {
      const out: { id: number; supplier: string; payable: number; date: string; dueDate: string | null }[] = [];
      for (const { id, ...state } of list) {
        const [r] = await tx
          .update(s.invoices)
          .set(state)
          .where(eq(s.invoices.id, id))
          .returning({ id: s.invoices.id, supplier: s.invoices.supplier, payable: s.invoices.payable, date: s.invoices.date, dueDate: s.invoices.dueDate });
        if (r) out.push(r);
      }
      return out;
    });
    // Son ödenenler de geri döner: yeniden ödenmemiş olan düşer, yeniden ödenmiş olan (ödenmediyken) yazılır
    const unpaidNow = new Set(list.filter((x) => x.unpaid).map((x) => x.id));
    await forgetPaid("invoice", rows.filter((r) => unpaidNow.has(r.id)).map((r) => r.id));
    await rememberPaid(rows.filter((r) => !unpaidNow.has(r.id) && wasUnpaid.has(r.id)).map((r) => ({ kind: "invoice" as const, id: r.id, title: r.supplier, amount: r.payable, dueDate: r.dueDate ?? r.date })));
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
});
type Snapshot = z.infer<typeof snapshotSchema>;
type DeletedEntry = {
  externalId: string;
  deletedAt: string;
  deletedBy: string;
  row: Snapshot;
  lines: Omit<BillLineRow, "id" | "invoiceId">[];
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
        };
        await writeState(tx, DELETED_BILLS_KEY, [...deleted, entry].slice(-DELETED_BILLS_LIMIT));
      }
      return { d, lines: lines.length };
    });
    if (!result) throw new UserError("Fatura bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    const { d } = result;
    // Kalemleri hammaddeye bağlıysa o ayın alınan miktarı silinen fatura olmadan yeniden hesaplanır
    if (result.lines) await applyProductLinks([d.date.slice(0, 7)]);
    // Silinen fatura Ödemeler › Son ödenenler'de kalmasın ("Geri al" bulamayacağı bir satır olurdu)
    await forgetPaid("invoice", [invoiceId]);
    await logActivity(me, "Fatura silindi", `${dateTR(d.date)} ${d.supplier} ${d.invoiceNo ?? ""}`.trim());
    refresh();
    return {
      externalId: parasutKeyOf(d),
      /** Elle/Excel faturası için geri alma kopyası; Paraşüt faturası sunucuda saklanır */
      snapshot: parasutKeyOf(d) ? null : snapshotOf(d),
      quantitiesRecomputed: result.lines > 0,
    };
  });
}

/** Az önce silinen elle/Excel faturasını geri yazar (bildirimdeki "Geri al"). Paraşüt faturası için unignoreParasutBill. */
export async function restoreInvoice(snapshot: z.input<typeof snapshotSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const row = snapshotSchema.parse(snapshot);
    if (row.externalId || row.eInvoiceId) throw new UserError("Paraşüt faturası “Silinen Paraşüt faturaları” listesinden geri alınır.");
    const [r] = await getDb().insert(s.invoices).values(row).returning({ id: s.invoices.id });
    await logActivity(me, "Silinen fatura geri alındı", `${dateTR(row.date)} ${row.supplier} ${row.invoiceNo ?? ""}`.trim());
    refresh();
    return { id: r.id };
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
      const row = snapshotSchema.parse(entry.row);
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
    const message =
      out.status === "restored"
        ? `${label} listeye geri döndü. Sonraki eşitleme tutarları Paraşüt'ten günceller.`
        : out.status === "exists"
          ? `${label} zaten listede; yok sayma kaldırıldı.`
          : "Yok sayma kaldırıldı. Fatura sonraki Paraşüt eşitlemesinde yeniden alınır; eski bir faturaysa Paraşüt sayfasından o tarihten eşitleyin.";
    return { status: out.status, message };
  });
}

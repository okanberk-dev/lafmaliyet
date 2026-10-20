"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { DELETED_BILLS_KEY, DELETED_BILLS_LIMIT, isParasutLinked, joinTR, LOCKED_LABELS, lockedChanges, splitSupplier, type LockedField } from "@/app/panel/faturalar/rules";
import { INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
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
});

/**
 * Faturayı ekler ya da günceller. Paraşüt'e bağlı faturada tarih, fatura no ve tutarlar yazılmaz: eşitleme onları
 * her çalışmada Paraşüt'ten yeniden yazar (bkz. rules.ts PARASUT_LOCKED_FIELDS). Formdan farklı değer geldiyse
 * (eski açık pencere) `kept` ile bildirilir, sessizce yutulmaz.
 */
export async function saveInvoice(input: z.input<typeof invoiceSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = invoiceSchema.parse(input);
    const db = getDb();
    if (!id) {
      const [row] = await db.insert(s.invoices).values(data).returning({ id: s.invoices.id });
      await logActivity(me, "Fatura eklendi", `${dateTR(data.date)} ${data.supplier}: ${tl(data.amount - data.discount, 2)} (KDV hariç)`);
      refresh();
      return { id: row.id, kept: [] as LockedField[], message: null as string | null };
    }
    const [cur] = await db.select().from(s.invoices).where(eq(s.invoices.id, id)).limit(1);
    if (!cur) throw new UserError("Fatura bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    let kept: LockedField[] = [];
    if (isParasutLinked(cur)) {
      kept = lockedChanges(cur, data);
      // Kilitli alanlar atılır; kalanlar (kategori, tedarikçi adı, açıklama, not, vade, ödeme durumu) yazılır
      const free = { supplier: data.supplier, description: data.description, category: data.category, unpaid: data.unpaid, note: data.note, dueDate: data.dueDate };
      // Kaydetmek faturayı kontrol edilmiş sayar
      await db.update(s.invoices).set({ ...free, needsReview: false }).where(eq(s.invoices.id, id));
    } else {
      await db.update(s.invoices).set({ ...data, needsReview: false }).where(eq(s.invoices.id, id));
    }
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
      .select({ id: s.invoices.id, category: s.invoices.category, supplier: s.invoices.supplier })
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

/** Bir ya da birçok faturayı ödendi / ödenmedi işaretler (Hatırlatıcılar tek kimlikle çağırır) */
export async function setInvoicePaid(id: number | number[], paid: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const ids = z.array(zId).min(1, "Fatura seçin").max(1000).parse(Array.isArray(id) ? id : [id]);
    const rows = await getDb()
      .update(s.invoices)
      .set({ unpaid: !z.boolean().parse(paid) })
      .where(inArray(s.invoices.id, ids))
      .returning({ supplier: s.invoices.supplier, payable: s.invoices.payable });
    if (rows.length === 1) await logActivity(me, paid ? "Fatura ödendi" : "Fatura ödenmedi işaretlendi", `${rows[0].supplier} ${tl(rows[0].payable, 2)}`);
    else if (rows.length > 1)
      await logActivity(me, paid ? "Faturalar ödendi" : "Faturalar ödenmedi işaretlendi", `${rows.length} fatura · ${tl(rows.reduce((a, r) => a + r.payable, 0), 2)}`);
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

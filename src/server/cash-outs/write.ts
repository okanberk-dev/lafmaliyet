import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { cashOutWritesExpense, isInvoiceDoc, staffCategory, staffExpenseLocked, staffToExpenses, type CashOutSnapshot } from "@/lib/cash-outs";
import { LAFPOS_CASH_OUT_TEXT, lafposCashOutChange } from "@/lib/lafpos/cash-moves";
import { expenseDateFor } from "@/lib/photo-read/receipt";
import { linkedUntil, RELEASED_DAYS } from "@/lib/photo-rules";
import { longDateTR, todayTR } from "@/lib/reminders";
import { zAmount, zDate, zOptText } from "@/server/actions/util";
import { currentTillBranch } from "@/server/branch-scope";
import { loadPendingCashOutInvoices } from "@/server/data/cash-out-invoices";
import { lafposAwaitingCategoryIds } from "@/server/data/cash-outs";
import { schema as s, type DB } from "@/server/db";
import { assertNotHeld, supersede } from "@/server/staff-requests/core";
import { getPhoto, keepPhoto, releasePhoto } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

/*
 * Kasadan çıkanın yazım yolu (docs/KASA-RAPORU.md › Gün içinde kasadan çıkanlar): satırın kaydı (yeni, düzeltme, geri
 * alma) ve bağlı harcama kaydı, fiş fotoğrafının bağı, silme. Personelin ve yöneticinin doğrudan eylemleri
 * (src/server/actions/cash-outs.ts) ve yöneticinin onayladığı istekler (src/server/cash-outs/requests.ts) aynı
 * işlevlerden geçer. Sunucu eylemi değil: oturum, rol ve personelin kapısı (guard.ts staffCashOutGate) çağıranda.
 * İşlemi parametre alır (tests/kasa-istek-db.test.ts doğrudan çalıştırır).
 */

/** Açık bir işlem */
export type CashOutTx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Yazan hesap (CurrentUser'ın gereken alanları) */
export interface CashOutActor {
  id: number;
  name: string;
  role: "admin" | "staff";
}

export type CashOutRow = typeof s.cashOuts.$inferSelect;

export const cashOutSchema = z.object({
  id: z.number().int().positive().nullable(),
  date: zDate,
  kind: z.enum(["harcama", "teslim"]),
  amount: zAmount.refine((v) => v > 0, "Tutar girin"),
  store: zOptText(60),
  description: zOptText(200),
  receiptDate: zDate.nullable(),
  receiptNo: zOptText(40),
  vat: zAmount.nullable(),
  docType: z.enum(["fis", "e_arsiv", "fatura", "yok"]),
  categoryId: z.number().int().positive().nullable(),
  /** Yöneticinin "Aylık harcamalar'a da yaz" anahtarı (personel için sunucu karar verir) */
  toExpenses: z.boolean(),
  photoId: z.number().int().positive().nullable(),
  /** Harcama kaydının notu, açıklaması ve ödeme şekli (yalnız geri almada: silinmeden önceki gibi) */
  expenseNote: zOptText(500).optional(),
  expenseDescription: zOptText(200).optional(),
  expensePaymentMethod: z.enum(["nakit", "kart", "havale", "diger"]).nullish(),
});

export type CashOutInput = z.input<typeof cashOutSchema>;
export type CashOutData = z.output<typeof cashOutSchema>;

const PHOTO_GONE = "Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin";
const EXPENSE_LOCKED_EDIT = "Bu satır yöneticinin harcama kaydına bağlı; türünü ve kategorisini yönetici değiştirir";

/**
 * Geri al: satır silinince fotoğrafı bırakılır (7 gün). Personel başkasının yüklediği fotoğrafı yalnız az önce
 * bırakılmışsa (geri alma penceresinde) yeniden bağlar.
 */
const UNDO_WINDOW_MS = 15 * 60_000;
const justReleased = (expiresAt: Date | null) => expiresAt !== null && expiresAt.getTime() > Date.now() + RELEASED_DAYS * 86_400_000 - UNDO_WINDOW_MS;

/** Satırı kilitleyerek okur (FOR UPDATE); yoksa null */
export async function lockCashOut(tx: CashOutTx, id: number): Promise<CashOutRow | null> {
  const [row] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, id)).for("update").limit(1);
  return row ?? null;
}

export interface WriteCashOutOptions {
  /**
   * Satırın şubesi. Verilmezse panelde seçili şubeye iner (`currentTillBranch`). Personelin isteği
   * onaylanırken ve "geri al"da çağıran bunu AÇIKÇA geçer: yoksa yöneticinin o anki seçimi yazılır ve
   * Marina'nın satırı Tuzla'ya kayar (docs/SUBE.md).
   */
  branchId?: string | null;
  /** Silinen satırın geri alınması: harcama kaydı silinmeden önceki gibi, satır eski numarasıyla */
  restore?: boolean;
  restoreId?: number;
  /** Satırı açan kişi (yöneticinin onayladığı ekleme isteğinde isteyen personel); verilmezse yazan hesap */
  author?: { id: number | null; name: string };
  /** Fiş fotoğrafını tutan istek (onayda o isteğin fişi bağlanabilir; başka bir bekleyen isteğinki hiçbir zaman) */
  heldBy?: number;
  /** İşlemin içinde kilitlenmiş satır (düzeltmede; verilmezse burada kilitlenir) */
  prev?: CashOutRow | null;
  /**
   * LafPOS'un kasa hareketinin eşitlemesi (src/server/lafpos/cash-moves.ts; başka çağıran vermez): LafPOS satırının
   * kilidi bu yazıma uygulanmaz; yeni satıra hareketin kimliği ve anı yazılır
   */
  lafpos?: { id: string; at: Date };
}

/**
 * Satırı yazar (yeni ya da düzeltme) ve bağlı harcama kaydını kurar, günceller ya da siler; fiş fotoğrafını bağlar
 * (satırın gününden 400 gün) ya da değiştiyse eskisini bırakır. İşlemin içinde. Personelin kuralları yazana göre:
 * kategori yalnız personelin kategorilerinden (satırın şimdiki kategorisi kalabilir), yöneticinin kategorisindeki kaydı
 * kaldıramaz ve taşıyamaz, fotoğraf kendisinin. Yönetici (doğrudan ya da bir isteği onaylarken) serbest.
 */
export async function writeCashOut(tx: CashOutTx, me: CashOutActor, d: CashOutData, o: WriteCashOutOptions = {}): Promise<{ id: number; expenseId: number | null; updated: boolean }> {
  const admin = me.role === "admin";
  const harcama = d.kind === "harcama";
  const prev = o.prev !== undefined ? o.prev : d.id ? await lockCashOut(tx, d.id) : null;
  if (d.id && !prev) throw new UserError("Satır bulunamadı; silinmiş olabilir");
  // LafPOS satırı (Faz 3): tutar, tür ve gün LafPOS'undur; yönetici de değiştiremez (yeniden gönderim geri yazardı)
  const lafposLock = prev && !o.lafpos ? lafposCashOutChange(prev, d) : null;
  if (lafposLock) throw new UserError(lafposLock);
  const [existing] = prev ? await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, prev.id)).limit(1) : [];
  const mode = o.restore ? "restore" : prev ? "edit" : "new";
  // Personel faturalı satırı fişe düzeltiyor: satır hâlâ faturasını bekliyorsa kayıt açılır (faturası geldiyse ya da
  // yönetici kapattıysa açılmaz: iki kez sayılırdı). Bakış yazımdan önce, satırın kayıtlı hâliyle
  const leavesInvoice = !admin && mode === "edit" && prev !== null && !existing && isInvoiceDoc(prev.docType) && staffToExpenses(d.kind, d.docType);
  const awaitingInvoice = leavesInvoice ? (await loadPendingCashOutInvoices(tx, { ids: [prev.id] })).length > 0 : undefined;
  // Kategorisini bekleyen LafPOS harcaması (Faz 3; inceleme LM-3): LafPOS'un kategorisiz yazdığı harcamada personel
  // kategori seçince kayıt açılır. Kaydı yöneticinin kaldırdığı LafPOS satırı ve sahiplenilen elle satır beklemez
  const lafposAwaiting =
    !admin && mode === "edit" && prev?.lafposId && !existing && d.kind === "harcama"
      ? (await lafposAwaitingCategoryIds(tx, [{ ...prev, hasExpense: false }])).has(prev.id)
      : false;
  const toExpenses = cashOutWritesExpense({
    admin,
    mode,
    kind: d.kind,
    docType: d.docType,
    requested: d.toExpenses,
    hasExpense: Boolean(existing),
    prevDocType: prev?.docType ?? null,
    awaitingInvoice,
    lafposAwaitingCategory: lafposAwaiting,
  });

  // Yöneticinin kategorisindeki kayıt: personel tutarı düzeltir, kaydı kaldıramaz (teslime çevirerek) ve taşıyamaz
  if (!admin && existing && (!toExpenses || d.categoryId !== existing.categoryId)) {
    const [cur] = await tx.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, existing.categoryId)).limit(1);
    if (staffExpenseLocked(cur)) throw new UserError(EXPENSE_LOCKED_EDIT);
  }

  // Kategori: personel yalnız alım kategorilerinden (satırın şimdiki kategorisi kalabilir). Geri almada silinen
  // kaydın kategorisi sonradan kapatılmış olsa da geri gelir (kayıt onu taşıyordu)
  if (toExpenses) {
    if (!d.categoryId) throw new UserError("Kategori seçin");
    const [cat] = await tx.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, d.categoryId)).limit(1);
    const unchanged = existing?.categoryId === d.categoryId;
    if (!cat || (!cat.active && !unchanged && !o.restore)) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
    if (!admin && !staffCategory(cat) && !unchanged) throw new UserError("Bu kategoriye yalnız yönetici yazabilir");
  }

  if (d.photoId && d.photoId !== prev?.photoId) {
    const p = await getPhoto(d.photoId, tx);
    const expired = !p || (p.expiresAt !== null && p.expiresAt.getTime() <= Date.now());
    const foreign = !admin && p?.createdBy !== me.id && !(o.restore && justReleased(p?.expiresAt ?? null));
    if (expired || p.kind !== "fis" || p.linkedAt !== null || foreign) throw new UserError(PHOTO_GONE);
    // Onay bekleyen bir isteğin tuttuğu fotoğraf (geç kasa raporu, kasadan çıkan isteği) satıra bağlanmaz; onaylanan
    // isteğin kendi fişi (heldBy) bağlanır
    await assertNotHeld(tx, d.photoId, o.heldBy);
  }

  const values = {
    date: d.date,
    kind: d.kind,
    amount: d.amount,
    store: d.store,
    description: d.description,
    receiptDate: harcama ? d.receiptDate : null,
    receiptNo: harcama ? d.receiptNo : null,
    vat: harcama ? d.vat : null,
    docType: harcama ? d.docType : ("yok" as const),
    photoId: d.photoId,
    // LafPOS'un eşitlemesi: hareketin kimliği ve anı (satırın saati hareketinki)
    ...(o.lafpos ? { lafposId: o.lafpos.id, createdAt: o.lafpos.at } : {}),
  };
  const author = o.author ?? { id: me.id, name: me.name };
  const [row] = prev
    ? await tx
        .update(s.cashOuts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.cashOuts.id, prev.id))
        .returning()
    : await tx
        .insert(s.cashOuts)
        // Kasanın şubesi (kasa raporuyla aynı; docs/SUBE.md): seçili şube, "Tümü"nde Tuzla
        .values({ ...values, ...(o.restoreId ? { id: o.restoreId } : {}), branchId: o.branchId ?? (await currentTillBranch()), createdBy: author.id, createdByName: author.name })
        .returning();

  // Harcama kaydı: tarih fişin tarihi (kasanın gününden en çok 3 gün önceyse), nakit, "Kasadan · 21 Ekim Salı"
  let expenseId: number | null = null;
  if (toExpenses) {
    // Satırdan gelenler (tutar ve tarih yalnız buradan düzeltilir)
    const entry = {
      date: expenseDateFor(d.date, values.receiptDate),
      categoryId: d.categoryId!,
      amount: d.amount,
      photoId: d.photoId,
      vat: values.vat,
      cashOutId: row.id,
    };
    const description = [d.store, d.description].filter(Boolean).join(" · ").slice(0, 200) || null;
    if (existing) {
      // Yöneticinin Aylık harcamalar'da yazdığı açıklama, ödeme şekli ve not kalır; açıklama yalnız yer ya da ne
      // alındığı değişince satırdan yeniden yazılır
      const renamed = prev!.store !== d.store || prev!.description !== d.description;
      await tx
        .update(s.expenseEntries)
        .set({ ...entry, ...(renamed ? { description } : {}), updatedAt: new Date() })
        .where(eq(s.expenseEntries.id, existing.id));
      expenseId = existing.id;
    } else {
      // Geri almada silinen kaydın açıklaması, ödeme şekli ve notu olduğu gibi
      const restored = o.restore ? d : null;
      const [e] = await tx
        .insert(s.expenseEntries)
        .values({
          ...entry,
          description: restored?.expenseDescription !== undefined ? restored.expenseDescription : description,
          paymentMethod: restored?.expensePaymentMethod !== undefined ? restored.expensePaymentMethod : "nakit",
          note: restored?.expenseNote !== undefined ? restored.expenseNote : `Kasadan · ${longDateTR(d.date)}`,
          // Kasadan çıkan para o kasanın şubesinin gideri
          branchId: row.branchId,
          createdBy: me.name,
        })
        .returning({ id: s.expenseEntries.id });
      expenseId = e.id;
    }
  } else if (existing) {
    await tx.delete(s.expenseEntries).where(eq(s.expenseEntries.id, existing.id));
  }

  if (d.photoId) await keepPhoto(d.photoId, linkedUntil("fis", d.date, todayTR()), tx);
  if (prev?.photoId && prev.photoId !== d.photoId) await releasePhoto(prev.photoId, RELEASED_DAYS, tx);
  return { id: row.id, expenseId, updated: Boolean(prev) };
}

/**
 * Satırı siler (bağlı harcama kaydıyla, işlemin içinde); fotoğraf 7 gün daha saklanır. Satırın bekleyen istekleri
 * kapanır ("Satır silindi"; silmeyi onaylanan istek `exceptRequestId` hariç). Silinenin kopyası döner ("Geri al" ve
 * işlem geçmişi). Satır kilitli okunmuş olmalı (`row`). LafPOS satırı silinmez (gün yeniden gönderilince geri gelirdi);
 * yalnız LafPOS'un eşitlemesi (`lafpos`) gövdeden kalkan hareketin satırını siler.
 */
export async function removeCashOut(tx: CashOutTx, row: CashOutRow, o: { exceptRequestId?: number; lafpos?: boolean } = {}): Promise<CashOutSnapshot> {
  if (row.lafposId && !o.lafpos) throw new UserError(LAFPOS_CASH_OUT_TEXT.delete);
  const [entry] = await tx.delete(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, row.id)).returning();
  await tx.delete(s.cashOuts).where(eq(s.cashOuts.id, row.id));
  if (row.photoId) await releasePhoto(row.photoId, RELEASED_DAYS, tx);
  await supersede(tx, { kinds: ["kasa-cikan"], subject: `cikan:${row.id}`, exceptId: o.exceptRequestId }, "Satır silindi");
  return {
    date: row.date,
    kind: row.kind,
    amount: row.amount,
    store: row.store,
    description: row.description,
    receiptDate: row.receiptDate,
    receiptNo: row.receiptNo,
    vat: row.vat,
    docType: row.docType,
    photoId: row.photoId,
    // Geri alınca satır kendi şubesine dönsün: "Tümü"den ya da başka şubeden geri alma onu kaydırmasın
    branchId: row.branchId,
    expense: entry ? { categoryId: entry.categoryId, note: entry.note, description: entry.description, paymentMethod: entry.paymentMethod } : null,
  };
}

/**
 * Fotoğrafsız alışveriş satırına fiş fotoğrafı ekler (onaysız; yalnız kanıt): fotoğraf ve gerekirse belge türü "fiş"
 * yazılır, bağlı harcama kaydında fotoğraf yoksa ona da. Tutar, tür ve kategori değişmez. Fotoğraf yazanın kendisinin,
 * fiş türünde, bağlanmamış ve bir istekte tutulmuyor olmalı.
 */
export async function attachReceiptPhoto(tx: CashOutTx, me: CashOutActor, row: CashOutRow, photoId: number): Promise<void> {
  if (row.kind !== "harcama" || row.photoId !== null) throw new UserError("Fiş yalnız fotoğrafsız alışveriş satırına eklenir");
  const p = await getPhoto(photoId, tx);
  const expired = !p || (p.expiresAt !== null && p.expiresAt.getTime() <= Date.now());
  if (expired || p.kind !== "fis" || p.linkedAt !== null || (me.role !== "admin" && p.createdBy !== me.id)) throw new UserError(PHOTO_GONE);
  await assertNotHeld(tx, photoId);
  await tx
    .update(s.cashOuts)
    .set({ photoId, docType: row.docType === "yok" ? "fis" : row.docType, updatedAt: new Date() })
    .where(eq(s.cashOuts.id, row.id));
  const [entry] = await tx.select({ id: s.expenseEntries.id, photoId: s.expenseEntries.photoId }).from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, row.id)).limit(1);
  if (entry && entry.photoId === null) await tx.update(s.expenseEntries).set({ photoId, updatedAt: new Date() }).where(eq(s.expenseEntries.id, entry.id));
  await keepPhoto(photoId, linkedUntil("fis", row.date, todayTR()), tx);
}

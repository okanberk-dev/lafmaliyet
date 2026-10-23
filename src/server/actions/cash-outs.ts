"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { cashOutLabel, cashOutUndoJson, cashOutWritesExpense, readCashOutUndo, staffCategory, staffExpenseLocked, type CashOutSnapshot } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import { expenseDateFor } from "@/lib/photo-read/receipt";
import { linkedUntil, RELEASED_DAYS } from "@/lib/photo-rules";
import { longDateTR, todayTR } from "@/lib/reminders";
import { requireUser, type CurrentUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { staffDayOpen } from "@/server/photo-read/rules";
import { open, seal } from "@/server/secret-box";
import { getPhoto, keepPhoto, releasePhoto } from "@/server/storage/photos";

import { logActivity } from "./log";
import { attempt, UserError, zAmount, zDate, zOptText } from "./util";

// Gün içinde kasadan çıkanlar (docs/KASA-RAPORU.md, docs/FOTOGRAF.md): personel ve yönetici ekler. Alışveriş satırı
// Aylık harcamalar'a da yazılabilir; o kayıt expense_entries.cash_out_id ile satıra ve fişin fotoğrafına bağlıdır.
// Personelin yeni satırı kurala göre yazılır (fiş evet, fatura / e-Arşiv hayır: Paraşüt'ten de gelir), yalnız alım
// kategorilerinde; teslim hiçbir zaman. Personelin düzeltmesi kaydı açmaz ve silmez (yöneticinin Aylık harcamalar'daki
// kararı kalır); geri alma silineni olduğu gibi getirir (cashOutWritesExpense). Akşam raporunun "Gün içinde kasadan
// çıkan" tutarı bunlardan dolar.

const cashOutSchema = z.object({
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

const LOCKED = "Bu günün kasasına artık yalnız yönetici ekleyebilir";
const PHOTO_GONE = "Fotoğraf bulunamadı ya da süresi doldu; yeniden çekin";
/** Personel, yöneticinin kategorisindeki harcama kaydını kaldıramaz ya da taşıyamaz (staffExpenseLocked) */
const EXPENSE_LOCKED = "Bu satır yöneticinin harcama kaydına bağlı; silmek için yöneticiye haber verin";
const EXPENSE_LOCKED_EDIT = "Bu satır yöneticinin harcama kaydına bağlı; türünü ve kategorisini yönetici değiştirir";

/**
 * Geri al: satır silinince fotoğrafı bırakılır (7 gün). Silinen satırın kopyası mühürlüdür (src/lib/cash-outs.ts ›
 * cashOutUndoJson): yalnız silen kişi, 15 dakika içinde ve silinenin aynısını geri getirir. Fotoğraf da o satırınki;
 * personel başkasının yüklediği fotoğrafı yalnız az önce bırakılmışsa yeniden bağlar.
 */
const UNDO_WINDOW_MS = 15 * 60_000;
const justReleased = (expiresAt: Date | null) => expiresAt !== null && expiresAt.getTime() > Date.now() + RELEASED_DAYS * 86_400_000 - UNDO_WINDOW_MS;

/** "21 Ekim Salı · Migros · 412,50 ₺ · fişli · harcamalara yazıldı" */
function logDetail(d: z.output<typeof cashOutSchema>, expense: boolean) {
  return [longDateTR(d.date), cashOutLabel(d), money(d.amount), d.photoId ? "fişli" : null, expense ? "harcamalara yazıldı" : null].filter(Boolean).join(" · ");
}

/**
 * Satırı yazar (yeni ya da düzeltme) ve bağlı harcama kaydını kurar, günceller ya da siler; fiş fotoğrafını bağlar
 * (satırın gününden 400 gün) ya da değiştiyse eskisini bırakır. Hepsi tek işlemde. `restore`: silinen satır geri
 * gelir; harcama kaydı silinmeden önceki gibi kurulur ve satırın kendi fotoğrafı (az önce bırakılmıştı) başkası
 * yüklemiş olsa da yeniden bağlanır.
 */
async function persist(me: CurrentUser, d: z.output<typeof cashOutSchema>, opts: { restore?: boolean } = {}) {
  const admin = me.role === "admin";
  if (d.date > businessDate()) throw new UserError("İleri bir günün kasasına eklenemez");
  if (!admin && !(await staffDayOpen(d.date))) throw new UserError(LOCKED);
  const harcama = d.kind === "harcama";
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const [prev] = d.id ? await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, d.id)).for("update").limit(1) : [];
    if (d.id && !prev) throw new UserError("Satır bulunamadı; silinmiş olabilir");
    if (prev && !admin && !(await staffDayOpen(prev.date, tx))) throw new UserError(LOCKED);
    const [existing] = prev ? await tx.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, prev.id)).limit(1) : [];
    const mode = opts.restore ? "restore" : prev ? "edit" : "new";
    const toExpenses = cashOutWritesExpense({ admin, mode, kind: d.kind, docType: d.docType, requested: d.toExpenses, hasExpense: Boolean(existing) });

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
      if (!cat || (!cat.active && !unchanged && !opts.restore)) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
      if (!admin && !staffCategory(cat) && !unchanged) throw new UserError("Bu kategoriye yalnız yönetici yazabilir");
    }

    if (d.photoId && d.photoId !== prev?.photoId) {
      const p = await getPhoto(d.photoId, tx);
      const expired = !p || (p.expiresAt !== null && p.expiresAt.getTime() <= Date.now());
      const foreign = !admin && p?.createdBy !== me.id && !(opts.restore && justReleased(p?.expiresAt ?? null));
      if (expired || p.kind !== "fis" || p.linkedAt !== null || foreign) throw new UserError(PHOTO_GONE);
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
    };
    const [row] = prev
      ? await tx
          .update(s.cashOuts)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(s.cashOuts.id, prev.id))
          .returning()
      : await tx
          .insert(s.cashOuts)
          .values({ ...values, createdBy: me.id, createdByName: me.name })
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
        const restored = opts.restore ? d : null;
        const [e] = await tx
          .insert(s.expenseEntries)
          .values({
            ...entry,
            description: restored?.expenseDescription !== undefined ? restored.expenseDescription : description,
            paymentMethod: restored?.expensePaymentMethod !== undefined ? restored.expensePaymentMethod : "nakit",
            note: restored?.expenseNote !== undefined ? restored.expenseNote : `Kasadan · ${longDateTR(d.date)}`,
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
  });
  await logActivity(me, saved.updated ? "Kasadan çıkan düzeltildi" : "Kasadan çıkan", logDetail(d, saved.expenseId !== null));
  refresh();
  return { id: saved.id, expenseId: saved.expenseId };
}

/** Kasadan çıkan satırını ekler ya da düzeltir */
export async function saveCashOut(input: CashOutInput) {
  return attempt(async () => {
    const me = await requireUser();
    return persist(me, cashOutSchema.parse(input));
  });
}

/**
 * Siler (bağlı harcama kaydıyla); fotoğraf 7 gün daha saklanır. Geri almak için silinenin mühürlü kopyası döner
 * (`undo`; istemci içini okuyamaz ve değiştiremez). Personel, kaydı yöneticinin kategorisinde olan satırı silemez
 * (kayıt onunla giderdi; geri alma da o kategoriye yazamazdı).
 */
export async function deleteCashOut(id: number) {
  return attempt(async (): Promise<{ undo: string }> => {
    const me = await requireUser();
    const cid = z.number().int().positive().parse(id);
    const snap = await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, cid)).for("update").limit(1);
      if (!row) throw new UserError("Satır bulunamadı; silinmiş olabilir");
      if (me.role !== "admin" && !(await staffDayOpen(row.date, tx))) throw new UserError(LOCKED);
      if (me.role !== "admin") {
        const [cur] = await tx
          .select({ section: s.expenseCategories.section, panelGroup: s.expenseCategories.panelGroup, active: s.expenseCategories.active })
          .from(s.expenseEntries)
          .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
          .where(eq(s.expenseEntries.cashOutId, cid))
          .limit(1);
        if (staffExpenseLocked(cur)) throw new UserError(EXPENSE_LOCKED);
      }
      const [entry] = await tx.delete(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, cid)).returning();
      await tx.delete(s.cashOuts).where(eq(s.cashOuts.id, cid));
      if (row.photoId) await releasePhoto(row.photoId, RELEASED_DAYS, tx);
      const out: CashOutSnapshot = {
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
        expense: entry ? { categoryId: entry.categoryId, note: entry.note, description: entry.description, paymentMethod: entry.paymentMethod } : null,
      };
      return out;
    });
    await logActivity(me, "Kasadan çıkan silindi", [longDateTR(snap.date), cashOutLabel(snap), money(snap.amount)].join(" · "));
    refresh();
    return { undo: seal(cashOutUndoJson(me.id, snap, Date.now()), "cashout-undo") };
  });
}

/**
 * Silineni geri getirir (yeni satır; fotoğraf yeniden bağlanır). Yalnız deleteCashOut'un mühürlü kopyasıyla: aynı kişi,
 * 15 dakika içinde. Harcama kaydı silinmeden önceki gibi: varsa aynı kategori, açıklama, ödeme şekli ve notla geri
 * gelir, yoksa açılmaz (personelde de). İstemcinin yazdığı bir kopya kabul edilmez.
 */
export async function restoreCashOut(undo: string) {
  return attempt(async () => {
    const me = await requireUser();
    const sealed = z.string().max(8000).safeParse(undo);
    const snap: CashOutSnapshot | null = sealed.success ? readCashOutUndo(open(sealed.data, "cashout-undo"), me.id, Date.now()) : null;
    if (!snap) throw new UserError("Geri alma süresi doldu; satırı yeniden ekleyin");
    const d = cashOutSchema.parse({
      id: null,
      date: snap.date,
      kind: snap.kind,
      amount: snap.amount,
      store: snap.store,
      description: snap.description,
      receiptDate: snap.receiptDate,
      receiptNo: snap.receiptNo,
      vat: snap.vat,
      docType: snap.docType,
      categoryId: snap.expense?.categoryId ?? null,
      toExpenses: snap.expense !== null,
      photoId: snap.photoId,
      expenseNote: snap.expense?.note ?? null,
      expenseDescription: snap.expense?.description,
      expensePaymentMethod: snap.expense?.paymentMethod,
    });
    return persist(me, d, { restore: true });
  });
}

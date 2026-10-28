"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { cashOutLabel } from "@/lib/cash-outs";
import { dateTR, money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { cashOutSchema, lockCashOut, writeCashOut } from "@/server/cash-outs/write";
import { loadCashOutInvoiceState, loadPendingCashOutInvoices, updateHandledCashOuts } from "@/server/data/cash-out-invoices";
import { getDb, schema as s } from "@/server/db";

import type { ExpenseEntrySnapshot } from "./expenses";
import { logActivity } from "./log";
import { attempt, UserError } from "./util";

// Kasadan faturalı alımların bekleyen listesi (denetim E-42; src/server/data/cash-out-invoices.ts): yalnız yönetici.
// "Aylık harcamalar'a yaz" Kasa'nın kendi yazım yolundan geçer (writeCashOut, yöneticinin "Aylık harcamalar'a da yaz"ı
// gibi); "Listeden çıkar" satırı kapatır; "Faturalar'a ekle" fatura penceresinden (saveInvoice `cashOutId`). Aylık
// harcamalar'a yazılmış satırın faturası sonradan gelirse (iki kez sayılıyor) "Gider kaydını sil" kaydı siler, "Ayrı
// alım" listeden çıkarır.

const zId = z.number().int().positive();
const NOT_PENDING = "Bu alım artık beklemiyor: faturası geldi, Aylık harcamalar'a yazıldı ya da listeden çıkarıldı. Sayfayı yenileyin.";
const NOT_DUPLICATE = "Bu alım artık iki kez sayılmıyor: gider kaydı ya da faturası değişti. Sayfayı yenileyin.";

/**
 * Bekleyen satırı Aylık harcamalar'a yazar (nakit, kasanın notuyla; tarih fişin günü). Satır kilitlenir ve hâlâ
 * bekliyor mu bakılır: arada faturası geldiyse ya da yazıldıysa iki kez sayılmaz. "Geri al" için kaydın numarası döner.
 */
export async function writeCashOutInvoiceExpense(input: { id: number; categoryId: number }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, categoryId } = z.object({ id: zId, categoryId: zId }).parse(input);
    const saved = await getDb().transaction(async (tx) => {
      const row = await lockCashOut(tx, id);
      if (!row) throw new UserError("Satır bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
      if (!(await loadPendingCashOutInvoices(tx, { ids: [id] })).length) throw new UserError(NOT_PENDING);
      const d = cashOutSchema.parse({
        id: row.id,
        date: row.date,
        kind: row.kind,
        amount: row.amount,
        store: row.store,
        description: row.description,
        receiptDate: row.receiptDate,
        receiptNo: row.receiptNo,
        vat: row.vat,
        docType: row.docType,
        categoryId,
        toExpenses: true,
        photoId: row.photoId,
      });
      const w = await writeCashOut(tx, { id: me.id, name: me.name, role: "admin" }, d, { prev: row });
      const [cat] = await tx.select({ name: s.expenseCategories.name }).from(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId)).limit(1);
      return { expenseId: w.expenseId!, row, category: cat?.name ?? "" };
    });
    await logActivity(me, "Kasadan faturalı alım Aylık harcamalar'a yazıldı", [longDateTR(saved.row.date), cashOutLabel(saved.row), money(saved.row.amount), saved.category].filter(Boolean).join(" · "));
    refresh();
    return { expenseId: saved.expenseId };
  });
}

/** "Geri al": az önce yazılan kaydı siler; satır yeniden bekler. Kayıt bu arada değiştiyse (başka satıra bağlıysa) dokunulmaz */
export async function undoCashOutInvoiceExpense(input: { id: number; expenseId: number }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, expenseId } = z.object({ id: zId, expenseId: zId }).parse(input);
    const removed = await getDb().transaction(async (tx) => {
      const row = await lockCashOut(tx, id);
      if (!row) throw new UserError("Satır bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
      const [gone] = await tx
        .delete(s.expenseEntries)
        .where(and(eq(s.expenseEntries.id, expenseId), eq(s.expenseEntries.cashOutId, id)))
        .returning({ id: s.expenseEntries.id });
      if (!gone) throw new UserError("Kayıt bulunamadı; Aylık harcamalar'dan silinmiş ya da değişmiş olabilir.");
      return row;
    });
    await logActivity(me, "Kasadan faturalı alımın gider kaydı geri alındı", [longDateTR(removed.date), cashOutLabel(removed), money(removed.amount)].join(" · "));
    refresh();
    return null;
  });
}

/**
 * "Listeden çıkar": faturası başka adla ya da tutarla Faturalar'da var, ya da kafenin gideri değil; iki kez sayılan
 * satırda "Ayrı alım" (fatura başka bir alımın, gider kaydı kalsın). `undo` satırları yeniden listeye döndürür
 * (bildirimdeki "Geri al"). Yalnız bekleyen ya da iki kez sayılan satırlar kapatılır.
 */
export async function dismissCashOutInvoices(input: { ids: number[]; undo?: boolean }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { ids, undo } = z.object({ ids: z.array(zId).min(1, "Satır seçin").max(500), undo: z.boolean().optional() }).parse(input);
    const db = getDb();
    const rows = await db.transaction(async (tx) => {
      if (undo) {
        await updateHandledCashOuts(tx, { remove: ids });
        return [];
      }
      const state = await loadCashOutInvoiceState(tx, { ids });
      const listed = [...state.pending, ...state.duplicates];
      if (!listed.length) throw new UserError(NOT_PENDING);
      await updateHandledCashOuts(tx, { add: listed.map((p) => ({ id: p.id, by: me.name })) });
      return listed;
    });
    if (rows.length)
      await logActivity(
        me,
        "Kasadan faturalı alım listeden çıkarıldı",
        rows.length === 1 ? [longDateTR(rows[0].date), cashOutLabel({ ...rows[0], kind: "harcama" }), money(rows[0].amount)].join(" · ") : `${rows.length} alım`,
      );
    refresh();
    return { ids: rows.map((r) => r.id) };
  });
}

/**
 * İki kez sayılan satırın gider kaydını siler (faturası geldi; alım faturayla sayılır). Satır kilitlenir ve hâlâ iki
 * kez sayılıyor mu bakılır: arada fatura silindiyse kayıt kalır (alım yeniden hiçbir hesaba girmezdi). "Geri al" için
 * kaydın kopyası döner (restoreExpenseEntry).
 */
export async function dropCashOutInvoiceExpense(input: { id: number; expenseId: number }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, expenseId } = z.object({ id: zId, expenseId: zId }).parse(input);
    const done = await getDb().transaction(async (tx) => {
      const row = await lockCashOut(tx, id);
      if (!row) throw new UserError("Satır bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
      const dup = (await loadCashOutInvoiceState(tx, { ids: [id] })).duplicates.find((d) => d.expenseId === expenseId);
      if (!dup) throw new UserError(NOT_DUPLICATE);
      const [gone] = await tx
        .delete(s.expenseEntries)
        .where(and(eq(s.expenseEntries.id, expenseId), eq(s.expenseEntries.cashOutId, id), isNull(s.expenseEntries.supplierEntryId)))
        .returning();
      if (!gone) throw new UserError(NOT_DUPLICATE);
      return { row, dup, gone };
    });
    const { row, dup, gone } = done;
    await logActivity(
      me,
      "Kasadan faturalı alımın gider kaydı silindi (faturası geldi)",
      [longDateTR(row.date), cashOutLabel(row), money(row.amount), `fatura ${dateTR(dup.invoice.date)} ${dup.invoice.supplier}`].join(" · "),
    );
    refresh();
    const snapshot: ExpenseEntrySnapshot = {
      date: gone.date,
      categoryId: gone.categoryId,
      description: gone.description,
      amount: gone.amount,
      paymentMethod: gone.paymentMethod,
      note: gone.note,
      photoId: gone.photoId,
      vat: gone.vat,
      cashOutId: gone.cashOutId,
    };
    return { snapshot };
  });
}

"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_ID_MAX } from "@/lib/branches";
import { dateTR } from "@/lib/format";
import { displayUnit, parseThresholdInput, stockQty, STOCK_ESTIMATE_BRANCH } from "@/lib/stock-estimate";
import { logActivity } from "@/server/actions/log";
import { attempt, UserError } from "@/server/actions/util";
import { requireAdmin } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

/**
 * Tahmini stoğun iki yazımı (docs/STOK-TAHMINI.md): kritik eşik ve faturanın geldiği şube. Yalnız yönetici; yalnız
 * kendi iki tablosuna yazar (stock_thresholds, stock_receipts). Stok sayımı, faturalar, FIFO ve mal maliyeti
 * değişmez. Her değişiklik işlem geçmişine düşer.
 */

const thresholdSchema = z.object({
  ingredientId: z.number().int().positive(),
  /** Sayım biriminde yazılan eşik ("2,5"); boş: eşik silinir */
  value: z.string().max(40),
});

/** Malzemenin Marina'daki kritik eşiği (sayım biriminde yazılır, kendi biriminde saklanır) */
export async function saveStockThreshold(input: z.input<typeof thresholdSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { ingredientId, value } = thresholdSchema.parse(input);
    const db = getDb();
    const [ing] = await db
      .select({ name: s.ingredients.name, unit: s.ingredients.unit, countUnit: s.ingredients.countUnit })
      .from(s.ingredients)
      .where(eq(s.ingredients.id, ingredientId))
      .limit(1);
    if (!ing) throw new UserError("Malzeme bulunamadı; sayfayı yenileyin");
    const unit = displayUnit(ing);
    const parsed = parseThresholdInput(value, unit.factor);
    if ("error" in parsed) throw new UserError(parsed.error);
    const where = and(eq(s.stockThresholds.branchId, STOCK_ESTIMATE_BRANCH), eq(s.stockThresholds.ingredientId, ingredientId));
    const [prev] = await db.select({ qty: s.stockThresholds.qty }).from(s.stockThresholds).where(where).limit(1);
    const before = prev?.qty ?? null;
    if (parsed.value === null) {
      if (before !== null) await db.delete(s.stockThresholds).where(where);
    } else {
      await db
        .insert(s.stockThresholds)
        .values({ branchId: STOCK_ESTIMATE_BRANCH, ingredientId, qty: parsed.value, updatedByName: me.name })
        .onConflictDoUpdate({
          target: [s.stockThresholds.branchId, s.stockThresholds.ingredientId],
          set: { qty: parsed.value, updatedByName: me.name, updatedAt: new Date() },
        });
    }
    if (before !== parsed.value) {
      const text = (v: number | null) => (v === null ? "yok" : stockQty(v, unit));
      await logActivity(me, "Kritik stok eşiği", `Marina · ${ing.name}: ${text(before)} → ${text(parsed.value)}`);
    }
    refresh();
    return { value: parsed.value };
  });
}

const receiptSchema = z.object({
  invoiceId: z.number().int().positive(),
  /** Malın geldiği fiziksel şube; null: seçim kalkar (hiçbir şubenin tahminine girmez) */
  branchId: z.string().max(BRANCH_ID_MAX).nullable(),
});

/** Faturanın malının geldiği şube (yalnız tahmini stok okur) */
export async function setStockReceipt(input: z.input<typeof receiptSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { invoiceId, branchId } = receiptSchema.parse(input);
    const db = getDb();
    const [[invoice], branches, [prev]] = await Promise.all([
      db.select({ supplier: s.invoices.supplier, date: s.invoices.date }).from(s.invoices).where(eq(s.invoices.id, invoiceId)).limit(1),
      listBranches(db),
      db.select({ branchId: s.stockReceipts.branchId }).from(s.stockReceipts).where(eq(s.stockReceipts.invoiceId, invoiceId)).limit(1),
    ]);
    if (!invoice) throw new UserError("Fatura bulunamadı; sayfayı yenileyin");
    if (branchId !== null && !branches.some((b) => b.id === branchId && b.active && b.kind === "fiziksel")) throw new UserError("Şube bulunamadı");
    const before = prev?.branchId ?? null;
    if (branchId === null) {
      if (before !== null) await db.delete(s.stockReceipts).where(eq(s.stockReceipts.invoiceId, invoiceId));
    } else {
      await db
        .insert(s.stockReceipts)
        .values({ invoiceId, branchId, markedByName: me.name })
        .onConflictDoUpdate({ target: s.stockReceipts.invoiceId, set: { branchId, markedByName: me.name, updatedAt: new Date() } });
    }
    if (before !== branchId) {
      const name = (id: string | null) => (id === null ? "seçilmedi" : (branches.find((b) => b.id === id)?.name ?? id));
      await logActivity(me, "Faturanın şubesi (tahmini stok)", `${invoice.supplier} · ${dateTR(invoice.date)}: ${name(before)} → ${name(branchId)}`);
    }
    refresh();
    return { branchId };
  });
}

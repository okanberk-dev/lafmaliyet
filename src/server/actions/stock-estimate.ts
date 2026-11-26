"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { displayUnit, parseThresholdInput, stockQty, STOCK_ESTIMATE_BRANCH } from "@/lib/stock-estimate";
import { logActivity } from "@/server/actions/log";
import { attempt, UserError } from "@/server/actions/util";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

/**
 * Tahmini stoğun yazımı (docs/STOK-TAHMINI.md): kritik eşik. Yalnız yönetici; yalnız kendi tablosuna yazar
 * (stock_thresholds). Stok sayımı, faturalar, FIFO ve mal maliyeti değişmez. Her değişiklik işlem geçmişine düşer.
 * Faturanın geldiği şube faturanın şubesidir (setInvoiceBranch).
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

// Faturanın geldiği şube 25 Kasım 2026'dan beri faturanın kendi şubesidir (invoices.branch_id, tek kaynak): Tahmini stok ›
// Marina'ya gelen faturalar seçimi setInvoiceBranch'e yazar (src/server/actions/invoices.ts; docs/SUBE.md › Faturanın şubesi)

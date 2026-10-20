"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { countFactor } from "@/lib/calc/engine";
import { monthLabel } from "@/lib/format";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMonth, zText } from "./util";

/**
 * Sayım sonuçlarını kaydeder. Personel de kullanabilir. qty = null olan satırlar silinir.
 * Her sayımla o anki birim çarpanı (KG/LT = 1000, ADET/DİLİM = 1) saklanır: malzemenin sayım birimi sonradan
 * değişse ya da malzeme pasif yapılsa da geçmiş ayın stok değeri değişmez.
 */
export async function saveStockCounts(month: string, entries: { ingredientId: number; qty: number | null }[]) {
  return attempt(async () => {
    const me = await requireUser();
    const m = zMonth.parse(month);
    const data = z
      .array(z.object({ ingredientId: z.number().int().positive(), qty: z.number().finite().min(0, "Miktar negatif olamaz").nullable() }))
      .max(1000)
      .parse(entries);
    const db = getDb();
    const filled = data.filter((x) => x.qty !== null);
    // Ay satırı yalnızca gerçekten sayım yazılınca açılır: yalnızca silen bir kayıt boş ay bırakmasın
    if (filled.length) await db.insert(s.months).values({ month: m }).onConflictDoNothing();
    const removed = await db.transaction(async (tx) => {
      const clear = data.filter((e) => e.qty === null).map((e) => e.ingredientId);
      const deleted = clear.length
        ? (
            await tx
              .delete(s.stockCounts)
              .where(and(eq(s.stockCounts.month, m), inArray(s.stockCounts.ingredientId, clear)))
              .returning({ id: s.stockCounts.ingredientId })
          ).length
        : 0;
      if (!filled.length) {
        if (deleted) await dropEmptyStockMonth(tx, m);
        return deleted;
      }
      const ids = filled.map((e) => e.ingredientId);
      const ings = new Map(
        (
          await tx
            .select({ id: s.ingredients.id, name: s.ingredients.name, countUnit: s.ingredients.countUnit, active: s.ingredients.active })
            .from(s.ingredients)
            .where(inArray(s.ingredients.id, ids))
        ).map((i) => [i.id, i]),
      );
      const existing = new Map(
        (
          await tx
            .select({ ingredientId: s.stockCounts.ingredientId, qty: s.stockCounts.qty, factor: s.stockCounts.factor })
            .from(s.stockCounts)
            .where(and(eq(s.stockCounts.month, m), inArray(s.stockCounts.ingredientId, ids)))
        ).map((c) => [c.ingredientId, c]),
      );
      for (const e of filled) {
        const ing = ings.get(e.ingredientId);
        if (!ing) throw new UserError("Malzeme bulunamadı (sayfayı yenileyin)");
        const prev = existing.get(e.ingredientId);
        const countable = ing.active && !!ing.countUnit;
        if (!countable && !prev) throw new UserError(`${ing.name} sayım listesinde değil (pasif ya da “Sayılmaz”)`);
        // Pasif / sayılmaz malzemenin eski sayımı ve değişmeyen miktar eski birimiyle kalır; yeni girilen miktar bugünkü birimle
        const factor =
          !countable || (prev && prev.qty === e.qty) ? (prev?.factor ?? countFactor(ing.countUnit)) : countFactor(ing.countUnit);
        await tx
          .insert(s.stockCounts)
          .values({ month: m, ingredientId: e.ingredientId, qty: e.qty!, factor, countedBy: me.name })
          .onConflictDoUpdate({
            target: [s.stockCounts.month, s.stockCounts.ingredientId],
            set: { qty: e.qty!, factor, countedBy: me.name, updatedAt: new Date() },
          });
      }
      return deleted;
    });
    // İşlem geçmişi silinen sayımları da söyler ("2 sayım silindi"); hiçbir şey değişmediyse kayıt yazılmaz
    const parts = [filled.length ? `${filled.length} kalem` : "", removed ? `${removed} sayım silindi` : ""].filter(Boolean);
    if (parts.length) await logActivity(me, "Stok sayımı", `${monthLabel(m)}: ${parts.join(", ")}`);
    refresh();
    return { saved: filled.length, removed };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Sayımı silinen ayda başka hiçbir kayıt kalmadıysa (ay bilgisi, satış, gelir-gider, sayım, ek kalem) içi boş ay
 * satırını kaldırır; deneme için açılmış ay ay seçicide kalmaz. Değer taşıyan hiçbir kayıt silinmez.
 */
async function dropEmptyStockMonth(tx: Tx, month: string) {
  const [row] = await tx.select().from(s.months).where(eq(s.months.month, month));
  if (!row) return;
  if (row.openDays !== null || row.posRevenue !== null || row.discounts || row.offRevenue || row.note) return;
  const [counts, extras, lines, pnl] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(s.stockCounts).where(eq(s.stockCounts.month, month)),
    tx.select({ n: sql<number>`count(*)::int` }).from(s.stockExtras).where(eq(s.stockExtras.month, month)),
    tx.select({ n: sql<number>`count(*)::int` }).from(s.salesLines).where(eq(s.salesLines.month, month)),
    tx.select({ n: sql<number>`count(*)::int` }).from(s.pnlEntries).where(eq(s.pnlEntries.month, month)),
  ]);
  if ([counts, extras, lines, pnl].some((r) => (r[0]?.n ?? 0) > 0)) return;
  await tx.delete(s.months).where(eq(s.months.month, month));
}

export async function saveStockExtras(month: string, extras: { name: string; unit: string; qty: number; unitPrice: number }[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const data = z
      .array(z.object({ name: zText("Ad", 120), unit: zText("Birim", 20), qty: z.number().finite().min(0), unitPrice: z.number().finite().min(0) }))
      .max(100)
      .parse(extras);
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(s.stockExtras).where(eq(s.stockExtras.month, m));
      if (data.length) await tx.insert(s.stockExtras).values(data.map((d) => ({ ...d, month: m })));
      else await dropEmptyStockMonth(tx, m);
    });
    await logActivity(me, "Sayım ek kalemleri", `${monthLabel(m)}: ${data.length} kalem`);
    refresh();
    return null;
  });
}

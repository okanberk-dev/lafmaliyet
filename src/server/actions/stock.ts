"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { monthLabel } from "@/lib/format";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, zMonth, zText } from "./util";

/** Sayım sonuçlarını kaydeder. Personel de kullanabilir. qty = null olan satırlar silinir. */
export async function saveStockCounts(month: string, entries: { ingredientId: number; qty: number | null }[]) {
  return attempt(async () => {
    const me = await requireUser();
    const m = zMonth.parse(month);
    const data = z
      .array(z.object({ ingredientId: z.number().int().positive(), qty: z.number().finite().min(0, "Miktar negatif olamaz").nullable() }))
      .max(1000)
      .parse(entries);
    const db = getDb();
    await db.insert(s.months).values({ month: m }).onConflictDoNothing();
    await db.transaction(async (tx) => {
      const clear = data.filter((e) => e.qty === null).map((e) => e.ingredientId);
      if (clear.length) await tx.delete(s.stockCounts).where(and(eq(s.stockCounts.month, m), inArray(s.stockCounts.ingredientId, clear)));
      for (const e of data.filter((x) => x.qty !== null)) {
        await tx
          .insert(s.stockCounts)
          .values({ month: m, ingredientId: e.ingredientId, qty: e.qty!, countedBy: me.name })
          .onConflictDoUpdate({
            target: [s.stockCounts.month, s.stockCounts.ingredientId],
            set: { qty: e.qty!, countedBy: me.name, updatedAt: new Date() },
          });
      }
    });
    await logActivity(me, "Stok sayımı", `${monthLabel(m)}: ${data.filter((e) => e.qty !== null).length} kalem`);
    refresh();
    return null;
  });
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
    });
    await logActivity(me, "Sayım ek kalemleri", `${monthLabel(m)}: ${data.length} kalem`);
    refresh();
    return null;
  });
}

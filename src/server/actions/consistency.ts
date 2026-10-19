"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { monthLabel, num } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, zMonth, zOptText, zText } from "./util";

/** Ay içinde faturayla alınan miktar (malzemenin kendi biriminde: gr, ml, adet) */
export async function setPurchaseQty(month: string, ingredientId: number, qty: number | null, note?: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const db = getDb();
    if (qty === null) {
      await db.delete(s.purchaseQuantities).where(and(eq(s.purchaseQuantities.month, m), eq(s.purchaseQuantities.ingredientId, ingredientId)));
    } else {
      const v = z.number().finite().min(0).parse(qty);
      const n = zOptText(300).parse(note);
      await db
        .insert(s.purchaseQuantities)
        .values({ month: m, ingredientId, qty: v, note: n })
        .onConflictDoUpdate({
          target: [s.purchaseQuantities.month, s.purchaseQuantities.ingredientId],
          set: note === undefined ? { qty: v } : { qty: v, note: n },
        });
    }
    await logActivity(me, "Alınan miktar", `${monthLabel(m)} · #${ingredientId}: ${qty === null ? "silindi" : num(qty)}`);
    refresh();
    return null;
  });
}

export async function saveFinding(input: { id: number | null; section: string; title: string; detail?: string | null }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = z
      .object({ id: z.number().int().nullable(), section: zText("Bölüm", 80), title: zText("Başlık", 200), detail: zOptText(2000) })
      .parse(input);
    const db = getDb();
    if (data.id) await db.update(s.findings).set({ section: data.section, title: data.title, detail: data.detail }).where(eq(s.findings.id, data.id));
    else await db.insert(s.findings).values({ section: data.section, title: data.title, detail: data.detail });
    await logActivity(me, data.id ? "Bulgu düzenlendi" : "Bulgu eklendi", data.title);
    refresh();
    return null;
  });
}

export async function setFindingResolved(id: number, resolved: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [f] = await getDb()
      .update(s.findings)
      .set({ resolved, resolvedAt: resolved ? new Date() : null })
      .where(eq(s.findings.id, id))
      .returning();
    if (f) await logActivity(me, resolved ? "Bulgu çözüldü" : "Bulgu yeniden açıldı", f.title);
    refresh();
    return null;
  });
}

export async function deleteFinding(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [f] = await getDb().delete(s.findings).where(eq(s.findings.id, id)).returning();
    if (f) await logActivity(me, "Bulgu silindi", f.title);
    refresh();
    return null;
  });
}

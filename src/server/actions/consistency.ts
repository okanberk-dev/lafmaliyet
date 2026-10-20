"use server";

import { and, eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { monthLabel, num } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { MANAGED_QTY_NOTE } from "@/server/parasut/constants";

import { logActivity } from "./log";
import { attempt, UserError, zMonth, zOptText, zText } from "./util";

/**
 * Ay içinde faturayla alınan miktar (malzemenin kendi biriminde: gr, ml, adet). 0 geçerlidir: "bu ay hiç alınmadı"
 * demektir ve iki ayı sayılan malzemede sayım sapmasının hesaplanmasını sağlar (boş = bilinmiyor, sapma çıkmaz).
 */
export async function setPurchaseQty(month: string, ingredientId: number, qty: number | null, note?: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const id = z.number().int().positive("Malzeme seçin").parse(ingredientId);
    const db = getDb();
    const [ing] = await db.select({ name: s.ingredients.name, unit: s.ingredients.unit }).from(s.ingredients).where(eq(s.ingredients.id, id));
    if (!ing) throw new UserError("Malzeme bulunamadı (sayfayı yenileyin)");
    if (qty === null) {
      await db.delete(s.purchaseQuantities).where(and(eq(s.purchaseQuantities.month, m), eq(s.purchaseQuantities.ingredientId, id)));
    } else {
      const v = z.number().finite().min(0).parse(qty);
      const n = zOptText(300).parse(note);
      await db
        .insert(s.purchaseQuantities)
        .values({ month: m, ingredientId: id, qty: v, note: n })
        .onConflictDoUpdate({
          target: [s.purchaseQuantities.month, s.purchaseQuantities.ingredientId],
          // Elle düzeltilen satır Paraşüt eşitlemesine ait olmaktan çıkar (notu değişir), eşitleme üzerine yazmaz
          set:
            note === undefined
              ? { qty: v, note: sql`case when ${s.purchaseQuantities.note} = ${MANAGED_QTY_NOTE} then null else ${s.purchaseQuantities.note} end` }
              : { qty: v, note: n },
        });
    }
    await logActivity(me, "Alınan miktar", `${monthLabel(m)} · ${ing.name}: ${qty === null ? "silindi" : `${num(qty, 2)} ${ing.unit}`}`);
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

"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { monthLabel, num } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { MANAGED_QTY_NOTE, NO_PURCHASE_NOTE } from "@/server/parasut/constants";

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
          // Elle düzeltilen satır Paraşüt eşitlemesine ait olmaktan çıkar (notu değişir), eşitleme üzerine yazmaz; "Alım yok
          // (0)" satırına yazılan miktar da elle girilmiş olur
          set:
            note === undefined
              ? { qty: v, note: sql`case when ${s.purchaseQuantities.note} in (${MANAGED_QTY_NOTE}, ${NO_PURCHASE_NOTE}) then null else ${s.purchaseQuantities.note} end` }
              : { qty: v, note: n },
        });
    }
    await logActivity(me, "Alınan miktar", `${monthLabel(m)} · ${ing.name}: ${qty === null ? "silindi" : `${num(qty, 2)} ${ing.unit}`}`);
    refresh();
    return null;
  });
}

/**
 * Tutarlılık'ın "Alım yok (0)" düğmesi (tek malzeme ya da faturası olmayan bağlı malzemelerin hepsi): bu ay alınan
 * miktarı girilmemiş malzemelere 0 yazar, sayım sapması hesaplanır (denetim 26 Eki, E-27). Alım satırı olana dokunmaz.
 * Satırın notu NO_PURCHASE_NOTE: elle girilmiş sayılmaz, o ayın faturası sonradan gelirse eşitleme yerine faturadaki
 * miktarı yazar. `undo`: aynı malzemelerin hâlâ 0 olan "Alım yok" satırları silinir ("Geri al").
 */
export async function setNoPurchase(month: string, ingredientIds: number[], undo = false) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const ids = [...new Set(z.array(z.number().int().positive()).min(1, "Malzeme seçin").max(500, "Tek seferde en fazla 500 malzeme").parse(ingredientIds))];
    const back = z.boolean().parse(undo);
    const db = getDb();
    const pq = s.purchaseQuantities;
    const changed = back
      ? await db
          .delete(pq)
          .where(and(eq(pq.month, m), inArray(pq.ingredientId, ids), eq(pq.note, NO_PURCHASE_NOTE), eq(pq.qty, 0)))
          .returning({ ingredientId: pq.ingredientId })
      : await (async () => {
          // Silinmiş malzeme (eski sekme) atlanır; alım satırı olan malzemeye dokunulmaz
          const live = await db.select({ id: s.ingredients.id }).from(s.ingredients).where(inArray(s.ingredients.id, ids));
          if (!live.length) return [];
          return db
            .insert(pq)
            .values(live.map((r) => ({ month: m, ingredientId: r.id, qty: 0, note: NO_PURCHASE_NOTE })))
            .onConflictDoNothing({ target: [pq.month, pq.ingredientId] })
            .returning({ ingredientId: pq.ingredientId });
        })();
    if (changed.length) {
      const names = await db.select({ name: s.ingredients.name }).from(s.ingredients).where(inArray(s.ingredients.id, changed.map((r) => r.ingredientId)));
      const list = names.map((r) => r.name).sort((a, b) => a.localeCompare(b, "tr"));
      const head = list.length > 5 ? `${list.slice(0, 5).join(", ")} ve ${list.length - 5} malzeme daha` : list.join(", ");
      await logActivity(me, back ? "Alım yok geri alındı" : "Alım yok (0)", `${monthLabel(m)} · ${head}`);
      refresh();
    }
    return { changed: changed.map((r) => r.ingredientId) };
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

"use server";

import { eq, max } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zOptText, zText } from "./util";

const ingredientSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Malzeme adı", 120),
  category: zText("Kategori", 60),
  supplier: zOptText(120),
  packageDesc: zOptText(160),
  packagePrice: z.number().finite().min(0, "Fiyat negatif olamaz"),
  packageSize: z.number().finite().positive("Paket içeriği 0'dan büyük olmalı"),
  unit: z.enum(["gr", "ml", "adet", "dilim"]),
  vatRate: z.number().min(0).max(1),
  note: zOptText(1000),
  isEstimate: z.boolean(),
  priceSource: z.enum(["manual", "water"]),
  countUnit: z.enum(["KG", "LT", "ADET", "DİLİM"]).nullable(),
  countGroup: zOptText(80),
  active: z.boolean(),
});

export async function saveIngredient(input: z.input<typeof ingredientSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = ingredientSchema.parse(input);
    const db = getDb();
    const id = await db.transaction(async (tx) => {
      if (data.id) {
        const [before] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, data.id));
        if (!before) throw new UserError("Malzeme bulunamadı");
        const { id: _omit, ...rest } = data;
        void _omit;
        await tx.update(s.ingredients).set({ ...rest, updatedAt: new Date() }).where(eq(s.ingredients.id, data.id));
        if (before.packagePrice !== data.packagePrice || before.packageSize !== data.packageSize) {
          await tx.insert(s.ingredientPrices).values({
            ingredientId: data.id,
            packagePrice: data.packagePrice,
            packageSize: data.packageSize,
            changedBy: me.name,
          });
        }
        return data.id;
      }
      const [{ m }] = await tx.select({ m: max(s.ingredients.sortOrder) }).from(s.ingredients);
      const { id: _omit, ...rest } = data;
      void _omit;
      const [created] = await tx
        .insert(s.ingredients)
        .values({ ...rest, sortOrder: (m ?? 0) + 1 })
        .returning({ id: s.ingredients.id });
      await tx.insert(s.ingredientPrices).values({
        ingredientId: created.id,
        packagePrice: data.packagePrice,
        packageSize: data.packageSize,
        changedBy: me.name,
        note: "İlk kayıt",
      });
      return created.id;
    });
    await logActivity(me, data.id ? "Hammadde güncellendi" : "Yeni hammadde", `${data.name}: ${tl(data.packagePrice, 2)} / ${data.packageSize} ${data.unit}`);
    refresh();
    return { id };
  });
}

/** Tablodan hızlı paket fiyatı güncelleme (yeni fatura geldiğinde) */
export async function updateIngredientPrice(id: number, packagePrice: number, clearEstimate = true) {
  return attempt(async () => {
    const me = await requireAdmin();
    const price = z.number().finite().min(0, "Fiyat negatif olamaz").parse(packagePrice);
    const db = getDb();
    const [before] = await db.select().from(s.ingredients).where(eq(s.ingredients.id, id));
    if (!before) throw new UserError("Malzeme bulunamadı");
    if (before.priceSource === "water") throw new UserError("Su ve buz fiyatı su faturasından hesaplanır");
    if (Math.abs(before.packagePrice - price) < 0.0001) return null;
    await db.transaction(async (tx) => {
      await tx
        .update(s.ingredients)
        .set({ packagePrice: price, isEstimate: clearEstimate ? false : before.isEstimate, updatedAt: new Date() })
        .where(eq(s.ingredients.id, id));
      await tx.insert(s.ingredientPrices).values({ ingredientId: id, packagePrice: price, packageSize: before.packageSize, changedBy: me.name });
    });
    await logActivity(me, "Hammadde fiyatı", `${before.name}: ${tl(before.packagePrice, 2)} → ${tl(price, 2)}`);
    refresh();
    return null;
  });
}

export async function deleteIngredient(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const db = getDb();
    const used = await db.select({ id: s.recipeItems.id }).from(s.recipeItems).where(eq(s.recipeItems.ingredientId, id)).limit(1);
    if (used.length) throw new UserError("Bu malzeme reçetelerde kullanılıyor. Önce reçetelerden çıkarın ya da pasif yapın.");
    const [d] = await db.delete(s.ingredients).where(eq(s.ingredients.id, id)).returning();
    if (d) await logActivity(me, "Hammadde silindi", d.name);
    refresh();
    return null;
  });
}

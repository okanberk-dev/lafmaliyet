"use server";

import { and, eq, inArray, max, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { validateExpression } from "@/lib/calc/expr";
import { tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadSettings } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMoney, zOptText, zText } from "./util";

const zSize = z.enum(["M", "L", "Tek"], { message: "Boy seçin" });

export async function updateProductPrice(id: number, price: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const p = zMoney.min(0, "Fiyat negatif olamaz").parse(price);
    const db = getDb();
    const [before] = await db.select().from(s.products).where(eq(s.products.id, id));
    if (!before) throw new UserError("Ürün bulunamadı");
    await db.update(s.products).set({ price: p, updatedAt: new Date() }).where(eq(s.products.id, id));
    await logActivity(me, "Satış fiyatı", `${before.name} ${before.size}: ${tl(before.price)} → ${tl(p)}`);
    refresh();
    return null;
  });
}

const productSchema = z.object({
  name: zText("Ürün adı", 120),
  size: zSize,
  categoryId: z.number().int().positive("Kategori seçin"),
  price: zMoney.min(0),
});

export async function createProduct(input: z.input<typeof productSchema> & { copyFromId?: number | null }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = productSchema.parse(input);
    const db = getDb();
    const id = await db.transaction(async (tx) => {
      const [{ m }] = await tx.select({ m: max(s.products.sortOrder) }).from(s.products);
      const [created] = await tx
        .insert(s.products)
        .values({ ...data, sortOrder: (m ?? 0) + 1 })
        .returning({ id: s.products.id });
      if (input.copyFromId) {
        const items = await tx.select().from(s.recipeItems).where(eq(s.recipeItems.productId, input.copyFromId));
        if (items.length) {
          await tx.insert(s.recipeItems).values(
            items.map((it) => ({
              productId: created.id,
              ingredientId: it.ingredientId,
              qty: it.qty,
              qtyExpr: it.qtyExpr,
              note: it.note,
              sortOrder: it.sortOrder,
            })),
          );
        }
      }
      return created.id;
    });
    await logActivity(me, "Yeni ürün", `${data.name} ${data.size}`);
    refresh();
    return { id };
  });
}

const recipeSchema = z.object({
  productId: z.number().int().positive(),
  name: zText("Ürün adı", 120),
  size: zSize,
  categoryId: z.number().int().positive("Kategori seçin"),
  price: zMoney.min(0, "Fiyat negatif olamaz"),
  fireOverride: z.number().min(0).max(1).nullable(),
  note: zOptText(),
  active: z.boolean(),
  showOnMenu: z.boolean(),
  items: z
    .array(
      z.object({
        ingredientId: z.number().int().positive("Malzeme seçin"),
        qty: z.number().finite().min(0, "Miktar negatif olamaz"),
        qtyExpr: z
          .string()
          .trim()
          .max(80)
          .nullish()
          .transform((v) => (v ? v : null)),
        note: zOptText(300),
      }),
    )
    .max(40, "En fazla 40 malzeme"),
});

export async function saveRecipe(input: z.input<typeof recipeSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = recipeSchema.parse(input);
    const settings = await loadSettings();
    for (const it of data.items) {
      if (it.qtyExpr) {
        const err = validateExpression(it.qtyExpr, settings);
        if (err) throw new UserError(`Formül hatası (${it.qtyExpr}): ${err}`);
      }
    }
    const db = getDb();
    await db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: s.products.id })
        .from(s.products)
        .where(and(eq(s.products.name, data.name), eq(s.products.size, data.size), ne(s.products.id, data.productId)));
      if (dup) throw new UserError("Aynı isim ve boyda başka bir ürün var");
      const ids = [...new Set(data.items.map((i) => i.ingredientId))];
      if (ids.length) {
        const found = await tx.select({ id: s.ingredients.id }).from(s.ingredients).where(inArray(s.ingredients.id, ids));
        if (found.length !== ids.length) throw new UserError("Seçilen malzemelerden biri bulunamadı");
      }
      await tx
        .update(s.products)
        .set({
          name: data.name,
          size: data.size,
          categoryId: data.categoryId,
          price: data.price,
          fireOverride: data.fireOverride,
          note: data.note,
          active: data.active,
          showOnMenu: data.showOnMenu,
          updatedAt: new Date(),
        })
        .where(eq(s.products.id, data.productId));
      await tx.delete(s.recipeItems).where(eq(s.recipeItems.productId, data.productId));
      if (data.items.length) {
        await tx.insert(s.recipeItems).values(
          data.items.map((it, i) => ({
            productId: data.productId,
            ingredientId: it.ingredientId,
            qty: it.qty,
            qtyExpr: it.qtyExpr,
            note: it.note,
            sortOrder: i + 1,
          })),
        );
      }
    });
    await logActivity(me, "Reçete kaydedildi", `${data.name} ${data.size} (${data.items.length} malzeme, ${tl(data.price)})`);
    refresh();
    return null;
  });
}

export async function deleteProduct(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const db = getDb();
    const [p] = await db.select().from(s.products).where(eq(s.products.id, id));
    if (!p) throw new UserError("Ürün bulunamadı");
    // Geçmiş satışlar silinmez; eşleştirmeleri boşa düşer (ortalama maliyet oranıyla hesaplanır)
    await db.delete(s.products).where(eq(s.products.id, id));
    await logActivity(me, "Ürün silindi", `${p.name} ${p.size}`);
    refresh();
    return null;
  });
}

export async function saveCategories(rows: { id: number | null; name: string }[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = z.array(z.object({ id: z.number().int().nullable(), name: zText("Kategori adı", 60) })).parse(rows);
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const [i, r] of data.entries()) {
        if (r.id) await tx.update(s.categories).set({ name: r.name, sortOrder: i + 1 }).where(eq(s.categories.id, r.id));
        else await tx.insert(s.categories).values({ name: r.name, sortOrder: i + 1 });
      }
    });
    await logActivity(me, "Kategoriler güncellendi", data.map((r) => r.name).join(", "));
    refresh();
    return null;
  });
}

export async function deleteCategory(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const db = getDb();
    const used = await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.categoryId, id)).limit(1);
    if (used.length) throw new UserError("Bu kategoride ürün var; önce ürünleri başka kategoriye taşıyın");
    await db.delete(s.categories).where(eq(s.categories.id, id));
    await logActivity(me, "Kategori silindi", String(id));
    refresh();
    return null;
  });
}

"use server";

import { eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { INVOICE_CATEGORIES } from "@/lib/constants";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { forgetParasutToken, ParasutClient } from "@/server/parasut/client";
import { isParasutConfigured } from "@/server/parasut/config";
import { applyProductLinks, PARASUT_STATE_KEYS, syncParasut } from "@/server/parasut/sync";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zText } from "./util";

function ensureConfigured() {
  if (!isParasutConfigured()) throw new UserError("Paraşüt bağlantı bilgileri tanımlı değil (ortam değişkenleri). Kurulum adımlarına bakın.");
}

export async function testParasutConnection() {
  return attempt(async () => {
    await requireAdmin();
    ensureConfigured();
    try {
      const r = await new ParasutClient().ping();
      return r;
    } catch (e) {
      throw new UserError((e as Error).message);
    }
  });
}

export async function runParasutSync(from: string | null) {
  return attempt(async () => {
    await requireAdmin();
    ensureConfigured();
    const r = await syncParasut("manual", from ? { from: zDate.parse(from) } : {});
    if (!r.ok) throw new UserError(r.error);
    refresh();
    return { summary: r.summary, partial: r.partial };
  });
}

export async function disconnectParasut() {
  return attempt(async () => {
    const me = await requireAdmin();
    await forgetParasutToken();
    await getDb().delete(s.integrationState).where(inArray(s.integrationState.key, PARASUT_STATE_KEYS));
    await logActivity(me, "Paraşüt bağlantısı sıfırlandı", "Kayıtlı oturum ve eşitleme imleci silindi");
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- kategori kuralları
const ruleSchema = z.object({
  id: z.number().int().positive().nullable(),
  matchType: z.enum(["supplier", "parasut_category", "keyword"]),
  pattern: zText("Eşleşecek metin", 120),
  category: z.enum(INVOICE_CATEGORIES as [string, ...string[]], { message: "Kategori seçin" }),
  priority: z.number().int().min(0).max(1000),
});

export async function saveCategoryRule(input: z.input<typeof ruleSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = ruleSchema.parse(input);
    const db = getDb();
    if (id) await db.update(s.parasutCategoryRules).set(data).where(eq(s.parasutCategoryRules.id, id));
    else await db.insert(s.parasutCategoryRules).values(data);
    await logActivity(me, "Paraşüt kategori kuralı", `“${data.pattern}” → ${data.category}`);
    refresh();
    return null;
  });
}

export async function deleteCategoryRule(id: number) {
  return attempt(async () => {
    await requireAdmin();
    await getDb().delete(s.parasutCategoryRules).where(eq(s.parasutCategoryRules.id, z.number().int().positive().parse(id)));
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- ürün → hammadde bağlantıları
const linkSchema = z.object({
  productKey: z.string().min(2).max(300),
  productName: zText("Ürün adı", 300),
  ingredientId: z.number().int().positive({ message: "Hammadde seçin" }),
  factor: z.number().positive("Çarpan sıfırdan büyük olmalı").finite(),
  updatePrice: z.boolean(),
});

export async function saveProductLink(input: z.input<typeof linkSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = linkSchema.parse(input);
    const db = getDb();
    await db
      .insert(s.parasutProductLinks)
      .values(data)
      .onConflictDoUpdate({ target: s.parasutProductLinks.productKey, set: { ingredientId: data.ingredientId, factor: data.factor, updatePrice: data.updatePrice, productName: data.productName } });
    const res = await applyProductLinks();
    const [ing] = await db.select({ name: s.ingredients.name }).from(s.ingredients).where(eq(s.ingredients.id, data.ingredientId)).limit(1);
    await logActivity(me, "Paraşüt ürünü bağlandı", `${data.productName} → ${ing?.name ?? data.ingredientId} (×${data.factor})`);
    refresh();
    return res;
  });
}

export async function deleteProductLink(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.parasutProductLinks).where(eq(s.parasutProductLinks.id, z.number().int().positive().parse(id))).returning();
    await applyProductLinks();
    if (d) await logActivity(me, "Paraşüt ürün bağlantısı silindi", d.productName);
    refresh();
    return null;
  });
}

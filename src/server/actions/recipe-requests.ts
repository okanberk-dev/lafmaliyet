"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { evaluateExpression } from "@/lib/calc/expr";
import { diffRecipe, sameRecipe, summarizeDiff, type RecipeSnapshot } from "@/lib/recipe-change";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { loadSettings } from "@/server/data/dataset";
import { currentSnapshot } from "@/server/data/recipe-snapshot";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zOptText } from "./util";

const zId = z.number().int().positive();

const lineSchema = z.object({
  ingredientId: z.number().int().positive("Malzeme seçin"),
  qty: z.number().finite().min(0, "Miktar negatif olamaz"),
  qtyExpr: z
    .string()
    .trim()
    .max(80, "Formül çok uzun")
    .nullish()
    .transform((v) => (v ? v.replace(/^=/, "").trim() || null : null)),
  note: zOptText(300),
});

const proposalSchema = z.object({
  message: zOptText(500),
  changes: z
    .array(z.object({ productId: zId, note: zOptText(1000), items: z.array(lineSchema).max(40, "En fazla 40 malzeme") }))
    .min(1, "Değişiklik yok")
    .max(10, "Bir seferde en çok 10 boy gönderilir"),
});

/** "Latte · M" */
const productLabel = (p: { name: string; size: string }) => `${p.name} · ${p.size}`;

/**
 * Personel (yönetici de olabilir) reçete defterinden değişiklik önerir; reçete değişmez, yöneticinin onayına düşer.
 * Formüllü miktar sunucuda yeniden hesaplanır (tarayıcının gönderdiği sayıya güvenilmez). Aynı kişinin aynı ürün için
 * bekleyen önerisi varsa o güncellenir. Bugünkü reçeteyle aynı olan boy atlanır.
 */
export async function proposeRecipeChanges(input: z.input<typeof proposalSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = proposalSchema.parse(input);
    const ids = [...new Set(data.changes.map((c) => c.productId))];
    if (ids.length !== data.changes.length) throw new UserError("Aynı boy iki kez gönderildi");
    const settings = await loadSettings();
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const products = new Map(
        (await tx.select({ id: s.products.id, name: s.products.name, size: s.products.size, active: s.products.active }).from(s.products).where(inArray(s.products.id, ids))).map(
          (p) => [p.id, p],
        ),
      );
      const ingredientIds = [...new Set(data.changes.flatMap((c) => c.items.map((i) => i.ingredientId)))];
      const ingredients = new Map(
        ingredientIds.length
          ? (
              await tx
                .select({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, active: s.ingredients.active })
                .from(s.ingredients)
                .where(inArray(s.ingredients.id, ingredientIds))
            ).map((i) => [i.id, i])
          : [],
      );
      let submitted = 0;
      let unchanged = 0;
      const summaries: string[] = [];
      for (const change of data.changes) {
        const product = products.get(change.productId);
        if (!product || !product.active) throw new UserError("Ürün bulunamadı; sayfayı yenileyin");
        const before = await currentSnapshot(product.id, tx);
        if (!before) throw new UserError("Ürün bulunamadı; sayfayı yenileyin");
        const inRecipe = new Set(before.items.map((i) => i.ingredientId));
        const after: RecipeSnapshot = {
          note: change.note,
          items: change.items.map((line, idx) => {
            const ing = ingredients.get(line.ingredientId);
            // Pasif malzeme yeni satıra seçilemez; reçetede zaten duruyorsa kalabilir
            if (!ing || (!ing.active && !inRecipe.has(ing.id))) throw new UserError(`${productLabel(product)}: ${idx + 1}. satırdaki malzeme listede yok; sayfayı yenileyin`);
            let qty = line.qty;
            if (line.qtyExpr) {
              try {
                qty = evaluateExpression(line.qtyExpr, settings);
              } catch (e) {
                throw new UserError(`${productLabel(product)} · ${ing.name}: formül hatası (${line.qtyExpr}): ${(e as Error).message}`);
              }
              if (qty < 0) throw new UserError(`${productLabel(product)} · ${ing.name}: miktar negatif olamaz`);
            }
            return { ingredientId: ing.id, name: ing.name, unit: ing.unit, qty, qtyExpr: line.qtyExpr, note: line.note };
          }),
        };
        const diff = diffRecipe(before, after);
        if (diff.empty) {
          unchanged++;
          continue;
        }
        const [pending] = await tx
          .select({ id: s.recipeChangeRequests.id })
          .from(s.recipeChangeRequests)
          .where(and(eq(s.recipeChangeRequests.productId, product.id), eq(s.recipeChangeRequests.requestedBy, me.id), eq(s.recipeChangeRequests.status, "pending")))
          .limit(1);
        if (pending) {
          await tx
            .update(s.recipeChangeRequests)
            .set({ before, after, message: data.message, requestedByName: me.name, updatedAt: new Date() })
            .where(eq(s.recipeChangeRequests.id, pending.id));
        } else {
          await tx.insert(s.recipeChangeRequests).values({ productId: product.id, requestedBy: me.id, requestedByName: me.name, before, after, message: data.message });
        }
        submitted++;
        summaries.push(`${productLabel(product)}: ${summarizeDiff(diff, 160)}`);
      }
      return { submitted, unchanged, summaries };
    });
    if (result.submitted) {
      await logActivity(me, "Reçete değişikliği önerildi", result.summaries.join(" · "));
      refresh();
    }
    return { submitted: result.submitted, unchanged: result.unchanged };
  });
}

/** Personel kendi bekleyen önerisini geri çeker */
export async function withdrawRecipeChange(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const rid = zId.parse(id);
    const [row] = await getDb()
      .update(s.recipeChangeRequests)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(and(eq(s.recipeChangeRequests.id, rid), eq(s.recipeChangeRequests.requestedBy, me.id), eq(s.recipeChangeRequests.status, "pending")))
      .returning({ productId: s.recipeChangeRequests.productId });
    if (!row) throw new UserError("Öneri bulunamadı ya da artık beklemede değil");
    await logActivity(me, "Reçete önerisi geri çekildi", `#${rid}`);
    refresh();
    return null;
  });
}

const reviewSchema = z.object({
  id: zId,
  decision: z.enum(["approve", "reject"]),
  note: zOptText(500),
  /** Reçete öneriden sonra değiştiyse yönetici yine de uygulamayı seçti */
  force: z.boolean().optional(),
});

export type ReviewResult = { conflict: false } | { conflict: true; current: RecipeSnapshot };

/**
 * Yönetici onaylar ya da reddeder. Onayda reçete önerilen hâline getirilir (satırlar ve hazırlama notu); fiyat, ad,
 * fire ve diğer alanlara dokunulmaz. Reçete öneri anından sonra değiştiyse (`before` ≠ bugünkü) önce bugünkü hâl
 * döner (`conflict`), yönetici farkı görüp `force` ile uygular. Formüller bugünkü ayarlarla yeniden hesaplanır.
 */
export async function reviewRecipeChange(input: z.input<typeof reviewSchema>) {
  return attempt(async (): Promise<ReviewResult> => {
    const me = await requireAdmin();
    const data = reviewSchema.parse(input);
    const db = getDb();
    const settings = data.decision === "approve" ? await loadSettings() : null;
    const outcome = await db.transaction(async (tx) => {
      // Aynı öneriyi iki yönetici aynı anda karara bağlamasın
      const [req] = await tx.select().from(s.recipeChangeRequests).where(eq(s.recipeChangeRequests.id, data.id)).for("update");
      if (!req) throw new UserError("Öneri bulunamadı (ürün silinmiş olabilir)");
      if (req.status !== "pending") throw new UserError("Bu öneri zaten karara bağlanmış; sayfayı yenileyin");
      const [product] = await tx.select({ id: s.products.id, name: s.products.name, size: s.products.size }).from(s.products).where(eq(s.products.id, req.productId)).limit(1);
      if (!product) throw new UserError("Ürün bulunamadı");
      const decided = { reviewNote: data.note, reviewedBy: me.id, reviewedByName: me.name, reviewedAt: new Date(), updatedAt: new Date() };
      if (data.decision === "reject") {
        await tx.update(s.recipeChangeRequests).set({ ...decided, status: "rejected" }).where(eq(s.recipeChangeRequests.id, req.id));
        return { kind: "rejected" as const, product, req, summary: summarizeDiff(diffRecipe(req.before, req.after)) };
      }
      const current = await currentSnapshot(product.id, tx);
      if (!current) throw new UserError("Ürün bulunamadı");
      if (!data.force && !sameRecipe(current, req.before)) return { kind: "conflict" as const, current };
      const ids = [...new Set(req.after.items.map((i) => i.ingredientId))];
      const found = ids.length ? await tx.select({ id: s.ingredients.id }).from(s.ingredients).where(inArray(s.ingredients.id, ids)) : [];
      const missing = req.after.items.filter((i) => !found.some((f) => f.id === i.ingredientId));
      if (missing.length) throw new UserError(`${missing.map((m) => m.name).join(", ")} artık hammaddelerde yok; öneriyi reddedin ya da reçeteyi elle düzenleyin`);
      const items = req.after.items.map((line) => {
        let qty = line.qty;
        if (line.qtyExpr && settings) {
          try {
            qty = evaluateExpression(line.qtyExpr, settings);
          } catch (e) {
            throw new UserError(`${line.name}: formül hatası (${line.qtyExpr}): ${(e as Error).message}`);
          }
        }
        return { ...line, qty };
      });
      await tx.delete(s.recipeItems).where(eq(s.recipeItems.productId, product.id));
      if (items.length) {
        await tx.insert(s.recipeItems).values(
          items.map((line, i) => ({ productId: product.id, ingredientId: line.ingredientId, qty: line.qty, qtyExpr: line.qtyExpr, note: line.note, sortOrder: i + 1 })),
        );
      }
      await tx.update(s.products).set({ note: req.after.note, updatedAt: new Date() }).where(eq(s.products.id, product.id));
      await tx.update(s.recipeChangeRequests).set({ ...decided, status: "approved" }).where(eq(s.recipeChangeRequests.id, req.id));
      return { kind: "approved" as const, product, req, summary: summarizeDiff(diffRecipe(current, { note: req.after.note, items })) };
    });
    if (outcome.kind === "conflict") return { conflict: true, current: outcome.current };
    const who = outcome.req.requestedByName;
    await logActivity(
      me,
      outcome.kind === "approved" ? "Reçete değişikliği onaylandı" : "Reçete değişikliği reddedildi",
      `${productLabel(outcome.product)} (${who} önerdi): ${outcome.summary}${data.note ? ` · not: ${data.note}` : ""}`,
    );
    refresh();
    return { conflict: false };
  });
}

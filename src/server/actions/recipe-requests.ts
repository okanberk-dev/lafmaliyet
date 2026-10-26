"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { evaluateExpression } from "@/lib/calc/expr";
import { PACKAGING_CATEGORY } from "@/lib/constants";
import { cleanName, countItemLogDetail, nameKey } from "@/lib/count-item";
import { money } from "@/lib/format";
import {
  diffRecipe,
  EMPTY_SNAPSHOT,
  genitive,
  NEW_PRODUCT_NAME_MAX,
  NEW_PRODUCT_NAME_MIN,
  newProductIssue,
  productSizeLabel,
  PROPOSED_PRICE_MAX,
  sameRecipe,
  summarizeDiff,
  type RecipeSnapshot,
} from "@/lib/recipe-change";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { CountItemExists, countItemSchema, createCountItem } from "@/server/data/count-item";
import { loadSettings } from "@/server/data/dataset";
import { withPassiveRelist } from "@/server/data/ingredient-usage";
import { insertProduct } from "@/server/data/product-create";
import { currentSnapshot } from "@/server/data/recipe-snapshot";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMoney, zOptText } from "./util";

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
        // Güncellenen öneri yeni bir sürüm: yönetici eskisini görüp onaylayamaz (reviewRecipeChange seenVersion ister).
        // Koşullu: öneri bu arada karara bağlandıysa güncellenmez, yenisi açılır
        const [updated] = pending
          ? await tx
              .update(s.recipeChangeRequests)
              .set({ before, after, message: data.message, requestedByName: me.name, version: sql`${s.recipeChangeRequests.version} + 1`, updatedAt: new Date() })
              .where(and(eq(s.recipeChangeRequests.id, pending.id), eq(s.recipeChangeRequests.status, "pending")))
              .returning({ id: s.recipeChangeRequests.id })
          : [];
        if (!updated) {
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
  /** Yöneticinin ekranda gördüğü öneri sürümü: öneri arada güncellendiyse karar verilmez */
  seenVersion: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: zOptText(500),
  /** Reçete öneriden sonra değiştiyse yönetici yine de uygulamayı seçti */
  force: z.boolean().optional(),
});

export type ReviewResult = { conflict: false } | { conflict: true; current: RecipeSnapshot };

/**
 * Yönetici onaylar ya da reddeder; yalnız ekranda gördüğü sürümü (seenVersion: personel öneriyi arada güncellediyse
 * karar verilmez). Onayda reçete önerilen hâline getirilir (satırlar ve hazırlama notu); fiyat, ad, fire ve diğer
 * alanlara dokunulmaz. Reçete öneri anından sonra değiştiyse (`before` ≠ bugünkü) önce bugünkü hâl
 * döner (`conflict`), yönetici farkı görüp `force` ile uygular. Formüller bugünkü ayarlarla yeniden hesaplanır.
 */
export async function reviewRecipeChange(input: z.input<typeof reviewSchema>) {
  return attempt(async (): Promise<ReviewResult> => {
    const me = await requireAdmin();
    const data = reviewSchema.parse(input);
    const db = getDb();
    const settings = data.decision === "approve" ? await loadSettings() : null;
    const outcome = await db.transaction(async (tx) => {
      // Aynı öneriyi iki yönetici aynı anda karara bağlamasın; personel aynı anda güncelleyemesin
      const [req] = await tx.select().from(s.recipeChangeRequests).where(eq(s.recipeChangeRequests.id, data.id)).for("update");
      if (!req) throw new UserError("Öneri bulunamadı (ürün silinmiş olabilir)");
      if (req.status !== "pending") throw new UserError("Bu öneri zaten karara bağlanmış; sayfayı yenileyin");
      if (req.version !== data.seenVersion) throw new UserError("Öneri siz bakarken değişti; yeniden bakın");
      const decided = { reviewNote: data.note, reviewedBy: me.id, reviewedByName: me.name, reviewedAt: new Date(), updatedAt: new Date() };
      if (req.kind === "new") {
        // Yeni ürün önerisi satış fiyatıyla onaylanır (approveNewProduct); burada yalnızca reddedilir, ürün açılmaz
        if (data.decision !== "reject" || !req.proposed) throw new UserError("Yeni ürün önerisini satış fiyatını yazarak onaylayın; sayfayı yenileyin");
        await tx.update(s.recipeChangeRequests).set({ ...decided, status: "rejected" }).where(eq(s.recipeChangeRequests.id, req.id));
        return { kind: "rejected-new" as const, proposed: req.proposed, req };
      }
      if (req.productId === null) throw new UserError("Ürün bulunamadı");
      const [product] = await tx.select({ id: s.products.id, name: s.products.name, size: s.products.size }).from(s.products).where(eq(s.products.id, req.productId)).limit(1);
      if (!product) throw new UserError("Ürün bulunamadı");
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
      // Onaylanan reçeteye pasif malzeme yazıldıysa (ürün aktifse) o malzeme sayım listesine bu aydan girer
      await withPassiveRelist(tx, [product.id], ids, async () => {
        await tx.delete(s.recipeItems).where(eq(s.recipeItems.productId, product.id));
        if (items.length) {
          await tx.insert(s.recipeItems).values(
            items.map((line, i) => ({ productId: product.id, ingredientId: line.ingredientId, qty: line.qty, qtyExpr: line.qtyExpr, note: line.note, sortOrder: i + 1 })),
          );
        }
      });
      await tx.update(s.products).set({ note: req.after.note, updatedAt: new Date() }).where(eq(s.products.id, product.id));
      await tx.update(s.recipeChangeRequests).set({ ...decided, status: "approved" }).where(eq(s.recipeChangeRequests.id, req.id));
      return { kind: "approved" as const, product, req, summary: summarizeDiff(diffRecipe(current, { note: req.after.note, items })) };
    });
    if (outcome.kind === "conflict") return { conflict: true, current: outcome.current };
    const who = outcome.req.requestedByName;
    const note = data.note ? ` · not: ${data.note}` : "";
    if (outcome.kind === "rejected-new") await logActivity(me, "Yeni ürün önerisi reddedildi", `${productLabel(outcome.proposed)} (${who} önerdi)${note}`);
    else
      await logActivity(
        me,
        outcome.kind === "approved" ? "Reçete değişikliği onaylandı" : "Reçete değişikliği reddedildi",
        `${productLabel(outcome.product)} (${who} önerdi): ${outcome.summary}${note}`,
      );
    refresh();
    return { conflict: false };
  });
}

// ---------------------------------------------------------------- Yeni ürün önerisi

const zSize = z.enum(["M", "L", "Tek"], { message: "Boy seçin" });

/** İki kişi aynı ad + boyu aynı anda öneremesin / onaylanırken araya öneri girmesin (boş productId benzersiz dizine girmez) */
const lockNewProducts = (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext('yeni-urun-onerisi'))`);

/**
 * Personelin önerdiği satış fiyatı (KDV dahil, boy başına, isteğe bağlı): kuruşa yuvarlanır, 0'dan büyük ve en çok
 * 10.000 ₺ (öneri penceresindeki readProposedPrice ile aynı sınırlar). Yazılmadıysa null.
 */
const zProposedPrice = zMoney
  .transform((v) => Math.round(v * 100) / 100)
  .pipe(z.number().positive("Satış fiyatı 0'dan büyük olmalı").max(PROPOSED_PRICE_MAX, "Satış fiyatı çok büyük"))
  .nullish()
  .transform((v) => v ?? null);

const newProductSchema = z.object({
  name: z.string({ message: "Ürün adını yazın" }).transform(cleanName),
  categoryId: z.number().int().positive("Kategori seçin"),
  message: zOptText(500),
  sizes: z
    .array(z.object({ size: zSize, items: z.array(lineSchema).max(40, "En fazla 40 malzeme"), price: zProposedPrice }))
    .min(1, "En az bir boy seçin")
    .max(3, "En çok üç boy"),
});

/**
 * Personel (yönetici de olabilir) menüde olmayan bir ürünü reçetesiyle önerir; boy başına bir öneri satırı açılır
 * (kind 'new', ürün yok). Ürün ancak yönetici Onaylar'da satış fiyatını yazıp onaylayınca açılır: fiyatı 0
 * bir ürün kârlılığı, uyarıları ve analizleri bozardı. Personelin yazdığı satış fiyatı (boy başına, isteğe bağlı)
 * öneride saklanır (`proposed.price`): onayda fiyat alanı onunla dolu gelir, yönetici değiştirebilir. Denetim sayfayla
 * aynı (newProductIssue): aynı ad + boyda ürün ya da bekleyen öneri varsa gönderilmez. Formüllü miktar sunucuda
 * yeniden hesaplanır.
 */
export async function proposeNewProduct(input: z.input<typeof newProductSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = newProductSchema.parse(input);
    if (new Set(data.sizes.map((x) => x.size)).size !== data.sizes.length) throw new UserError("Aynı boy iki kez gönderildi");
    const settings = await loadSettings();
    const db = getDb();
    await db.transaction(async (tx) => {
      await lockNewProducts(tx);
      const [category] = await tx.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.id, data.categoryId)).limit(1);
      if (!category) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
      const [existing, pending] = await Promise.all([
        tx.select({ name: s.products.name, size: s.products.size }).from(s.products),
        tx
          .select({ proposed: s.recipeChangeRequests.proposed })
          .from(s.recipeChangeRequests)
          .where(and(eq(s.recipeChangeRequests.status, "pending"), eq(s.recipeChangeRequests.kind, "new"))),
      ]);
      const issue = newProductIssue(
        { name: data.name, categoryId: data.categoryId, sizes: data.sizes.map((x) => ({ size: x.size, lines: x.items.length })) },
        existing,
        pending.flatMap((p) => (p.proposed ? [p.proposed] : [])),
      );
      if (issue) throw new UserError(issue);
      const ingredientIds = [...new Set(data.sizes.flatMap((x) => x.items.map((i) => i.ingredientId)))];
      const ingredients = new Map(
        (
          await tx
            .select({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, active: s.ingredients.active })
            .from(s.ingredients)
            .where(inArray(s.ingredients.id, ingredientIds))
        ).map((i) => [i.id, i]),
      );
      for (const sz of data.sizes) {
        const label = productLabel({ name: data.name, size: sz.size });
        const after: RecipeSnapshot = {
          note: null,
          items: sz.items.map((line, idx) => {
            const ing = ingredients.get(line.ingredientId);
            // Yeni reçeteye pasif malzeme seçilemez
            if (!ing || !ing.active) throw new UserError(`${label}: ${idx + 1}. satırdaki malzeme listede yok; sayfayı yenileyin`);
            let qty = line.qty;
            if (line.qtyExpr) {
              try {
                qty = evaluateExpression(line.qtyExpr, settings);
              } catch (e) {
                throw new UserError(`${label} · ${ing.name}: formül hatası (${line.qtyExpr}): ${(e as Error).message}`);
              }
              if (qty < 0) throw new UserError(`${label} · ${ing.name}: miktar negatif olamaz`);
            }
            return { ingredientId: ing.id, name: ing.name, unit: ing.unit, qty, qtyExpr: line.qtyExpr, note: line.note };
          }),
        };
        await tx.insert(s.recipeChangeRequests).values({
          kind: "new",
          productId: null,
          proposed: { name: data.name, size: sz.size, categoryId: data.categoryId, price: sz.price },
          requestedBy: me.id,
          requestedByName: me.name,
          before: EMPTY_SNAPSHOT,
          after,
          message: data.message,
        });
      }
    });
    // "Çilekli Matcha · M (önerilen 185 ₺), L"
    const sizes = data.sizes.map((x) => (x.price !== null ? `${x.size} (önerilen ${money(x.price)})` : x.size)).join(", ");
    await logActivity(me, "Yeni ürün önerisi", `${data.name} · ${sizes}`);
    refresh();
    return { sizes: data.sizes.length };
  });
}

/**
 * Reçete önerisindeki "Yeni malzeme" (Yeni ürün öner ve Değişiklik öner): aranıp listede bulunamayan malzeme formdan
 * çıkmadan açılır. Stok sayımı › Listeye ekle ile aynı çekirdek (createCountItem): aynı alanlar ve kurallar, kalem
 * sayım listesine de girer, paket fiyatı isteğe bağlı ve Tahmini. Aynı adlı aktif malzeme varsa hata yerine o döner
 * (`existing`): pencere "Onu seç" der. Dönen malzemede fiyat yok (personel yazdığı fiyatı bir daha görmez).
 */
export async function addProposalIngredient(input: z.input<typeof countItemSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = countItemSchema.parse(input);
    const ref = (i: { id: number; name: string; unit: string; category: string }) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      active: true,
      packaging: i.category === PACKAGING_CATEGORY,
    });
    try {
      const created = await createCountItem(me, data, "recete");
      await logActivity(me, "Sayım listesine eklendi", countItemLogDetail({ ...created, countUnit: data.countUnit, source: "recete" }));
      refresh();
      return { ingredient: ref(created), existing: false as const };
    } catch (e) {
      // Aynı ad: aktif malzeme seçilebilir (pencere sorar); pasif olanın metni olduğu gibi gösterilir
      if (e instanceof CountItemExists && e.existing.active && e.existing.id > 0) return { ingredient: ref(e.existing), existing: true as const };
      throw e;
    }
  });
}

const approveNewSchema = z.object({
  id: zId,
  /** Yönetici onaylarken adı ve kategoriyi düzeltebilir; boy önerideki gibi kalır */
  name: z.string({ message: "Ürün adını yazın" }).transform(cleanName),
  categoryId: z.number().int().positive("Kategori seçin"),
  price: zMoney.positive("Satış fiyatını yazın"),
  note: zOptText(500),
});

/**
 * Yönetici yeni ürün önerisini satış fiyatıyla onaylar: tek işlemde öneri kilitlenir, durumu ve aynı ad + boy kuralı
 * yeniden denetlenir, ürün Ürünler › Yeni ürün ile aynı kuralla açılır (insertProduct: kategoriden zayi oranı, sıra en
 * sonda, aktif) ve reçetesi yazılır; öneri ürüne bağlanır. Formüller bugünkü ayarlarla yeniden hesaplanır. Ürün
 * laffogato.net menüsüne bağlanmaz (Ürünler › Site menüsü).
 */
export async function approveNewProduct(input: z.input<typeof approveNewSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = approveNewSchema.parse(input);
    if (data.name.length < NEW_PRODUCT_NAME_MIN) throw new UserError(`Ürün adı en az ${NEW_PRODUCT_NAME_MIN} harf olmalı`);
    if (data.name.length > NEW_PRODUCT_NAME_MAX) throw new UserError("Ürün adı çok uzun");
    const settings = await loadSettings();
    const db = getDb();
    const outcome = await db.transaction(async (tx) => {
      await lockNewProducts(tx);
      const [req] = await tx.select().from(s.recipeChangeRequests).where(eq(s.recipeChangeRequests.id, data.id)).for("update");
      if (!req) throw new UserError("Öneri bulunamadı");
      if (req.kind !== "new" || !req.proposed) throw new UserError("Bu bir yeni ürün önerisi değil; sayfayı yenileyin");
      if (req.status !== "pending") throw new UserError("Bu öneri zaten karara bağlanmış; sayfayı yenileyin");
      const size = req.proposed.size;
      const [category] = await tx.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.id, data.categoryId)).limit(1);
      if (!category) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
      const sameSize = await tx.select({ name: s.products.name }).from(s.products).where(eq(s.products.size, size));
      if (sameSize.some((p) => nameKey(p.name) === nameKey(data.name)))
        throw new UserError(`“${productSizeLabel(data.name, size)}” zaten var; adı değiştirin ya da öneriyi reddedin`);
      const ids = [...new Set(req.after.items.map((i) => i.ingredientId))];
      const found = ids.length ? await tx.select({ id: s.ingredients.id }).from(s.ingredients).where(inArray(s.ingredients.id, ids)) : [];
      const missing = req.after.items.filter((i) => !found.some((f) => f.id === i.ingredientId));
      if (missing.length) throw new UserError(`${missing.map((m) => m.name).join(", ")} artık hammaddelerde yok; öneriyi reddedin`);
      const items = req.after.items.map((line) => {
        let qty = line.qty;
        if (line.qtyExpr) {
          try {
            qty = evaluateExpression(line.qtyExpr, settings);
          } catch (e) {
            throw new UserError(`${line.name}: formül hatası (${line.qtyExpr}): ${(e as Error).message}`);
          }
        }
        return { ingredientId: line.ingredientId, qty, qtyExpr: line.qtyExpr, note: line.note };
      });
      const created = await insertProduct(tx, { name: data.name, size, categoryId: data.categoryId, price: data.price }, { items, note: req.after.note, changedBy: me.name });
      const now = new Date();
      await tx
        .update(s.recipeChangeRequests)
        .set({ productId: created.id, status: "approved", reviewNote: data.note, reviewedBy: me.id, reviewedByName: me.name, reviewedAt: now, updatedAt: now })
        .where(eq(s.recipeChangeRequests.id, req.id));
      return { productId: created.id, size, who: req.requestedByName, proposedPrice: req.proposed.price ?? null };
    });
    // Personelin önerdiği fiyat değiştirildiyse o da yazılır: "Çilekli Matcha M · 190 ₺ (önerilen 185 ₺) · Ayşe'nin önerisi"
    const proposed = outcome.proposedPrice !== null && Math.abs(outcome.proposedPrice - data.price) >= 0.005 ? ` (önerilen ${money(outcome.proposedPrice)})` : "";
    await logActivity(me, "Yeni ürün (öneriden)", `${data.name} ${outcome.size} · ${money(data.price)}${proposed} · ${genitive(outcome.who)} önerisi`);
    refresh();
    return { productId: outcome.productId };
  });
}

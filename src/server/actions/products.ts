"use server";

import { and, eq, inArray, max, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { categoryFireDefault } from "@/app/panel/urunler/logic";
import { validateExpression } from "@/lib/calc/expr";
import { tl } from "@/lib/format";
import type { PriceAck } from "@/lib/calc/price-impact";
import { panelIsActive } from "@/lib/site-menu/slot";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel, loadSettings } from "@/server/data/dataset";
import { PRICE_ACK_KEY } from "@/server/data/price-alerts";
import { getDb, schema as s } from "@/server/db";
import { applyPushed, pushSaleChange } from "@/server/site-menu/push";

import { logActivity } from "./log";
import { attempt, UserError, zMoney, zOptText, zText } from "./util";

const zSize = z.enum(["M", "L", "Tek"], { message: "Boy seçin" });

/**
 * `ackAlert`: zam uyarısındaki "zammın payı" önerisi uygulandı. Öneri o anki fiyattan hesaplandığı için yeni
 * fiyattan yeniden artardı (85 → 90 → …); bu maliyet ve fiyatta uyarı kapanır. Fiyat geri alınır ya da düşürülürse,
 * maliyet daha da artarsa uyarı geri gelir (isAcknowledged).
 *
 * Ürün laffogato.net menüsüne bağlıysa fiyat önce siteye yazılır (docs/SITE-MENU.md); site kabul etmezse fiyat
 * değişmez ve hata döner. Dönen `price` yazılan fiyattır (sitenin kuruşu), `site` fiyatın sitede de değiştiği.
 */
export async function updateProductPrice(id: number, price: number, ackAlert = false) {
  return attempt(async () => {
    const me = await requireAdmin();
    const p = zMoney.min(0, "Fiyat negatif olamaz").parse(price);
    const ack = z.boolean().parse(ackAlert);
    const db = getDb();
    const [before] = await db.select().from(s.products).where(eq(s.products.id, id));
    if (!before) throw new UserError("Ürün bulunamadı");
    const desired = { price: p, active: before.active, showOnMenu: before.showOnMenu };
    const push = await pushSaleChange(me, before, desired, "fiyat değişmedi");
    const now = new Date();
    let written = desired;
    if (push.kind === "pushed") {
      written = await db.transaction(async (tx) => {
        const final = await applyPushed(tx, push, before, desired, now);
        await tx.update(s.products).set({ ...final, updatedAt: now }).where(eq(s.products.id, id));
        return final;
      });
    } else {
      await db.update(s.products).set({ price: p, updatedAt: now }).where(eq(s.products.id, id));
    }
    if (ack) {
      // Maliyet fiyata bağlı değil: güncellemeden sonra okunması fark etmez
      const cost = (await loadModel()).products.find((x) => x.product.id === id)?.cost;
      if (cost !== undefined) {
        await updatePriceAck((a) => {
          a[String(id)] = { cost, at: new Date().toISOString(), price: written.price };
        });
      }
    }
    await logActivity(
      me,
      "Satış fiyatı",
      `${before.name} ${before.size}: ${tl(before.price)} → ${tl(written.price)}${ack ? " (zam önerisi)" : ""}${push.kind === "pushed" ? " (sitede de)" : ""}`,
    );
    refresh();
    return { price: written.price, site: push.kind === "pushed" && push.price };
  });
}

/** Zam uyarısı onaylarını satır kilidiyle günceller (aynı anda iki onay birbirini silmesin) */
async function updatePriceAck(change: (ack: PriceAck) => void) {
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, PRICE_ACK_KEY)).for("update");
    const ack: PriceAck = { ...((row?.value as PriceAck | undefined) ?? {}) };
    change(ack);
    await tx
      .insert(s.integrationState)
      .values({ key: PRICE_ACK_KEY, value: ack })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value: ack, updatedAt: new Date() } });
  });
}

/**
 * Zam uyarısında "şimdilik böyle kalsın": ürünün bugünkü maliyeti saklanır, uyarı kalkar; maliyet bundan da
 * artarsa (yeni zam) yeniden uyarılır. `undo` saklananı siler (uyarı geri gelir).
 */
export async function acknowledgePriceAlert(productId: number, undo = false) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = z.number().int().positive().parse(productId);
    const model = await loadModel();
    const p = model.products.find((x) => x.product.id === id);
    if (!p) throw new UserError("Ürün bulunamadı");
    await updatePriceAck((ack) => {
      if (undo) delete ack[String(id)];
      else ack[String(id)] = { cost: p.cost, at: new Date().toISOString() };
    });
    await logActivity(me, undo ? "Zam uyarısı geri açıldı" : "Zam uyarısı: fiyat korunuyor", `${p.product.name} ${p.product.size} · ${tl(p.price)}`);
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
    const copyFromId = z.number().int().positive().nullish().parse(input.copyFromId) ?? null;
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: s.products.id })
        .from(s.products)
        .where(and(eq(s.products.name, data.name), eq(s.products.size, data.size)));
      if (dup) throw new UserError(`“${data.name} · ${data.size}” zaten var; başka bir boy seçin ya da adı değiştirin`);
      // Kopyalamada kaynağın ürüne özel fire oranı ve notu da gelir (Excel'de kart bloğu kopyalanınca G16 ve
      // notlar da taşınır). QR menü görünürlüğü ve aktiflik varsayılanda kalır. Kopyasız yeni ürün, kategorisindeki
      // ürünlerin en sık kullandığı zayi oranını alır (categoryFireDefault); ürün kartından değiştirilir.
      let initial: { fireOverride: number | null; note: string | null };
      if (copyFromId) {
        const [src] = await tx
          .select({ fireOverride: s.products.fireOverride, note: s.products.note })
          .from(s.products)
          .where(eq(s.products.id, copyFromId));
        if (!src) throw new UserError("Kopyalanacak ürün bulunamadı; sayfayı yenileyip tekrar deneyin");
        initial = src;
      } else {
        const peers = await tx.select({ id: s.products.id, fireOverride: s.products.fireOverride }).from(s.products).where(eq(s.products.categoryId, data.categoryId));
        initial = { fireOverride: categoryFireDefault(peers), note: null };
      }
      const [{ m }] = await tx.select({ m: max(s.products.sortOrder) }).from(s.products);
      const [created] = await tx
        .insert(s.products)
        .values({ ...data, ...initial, sortOrder: (m ?? 0) + 1 })
        .returning({ id: s.products.id });
      let lines = 0;
      if (copyFromId) {
        const items = await tx.select().from(s.recipeItems).where(eq(s.recipeItems.productId, copyFromId));
        lines = items.length;
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
      return { id: created.id, lines, fireOverride: initial.fireOverride, noteCopied: !!initial.note };
    });
    await logActivity(me, "Yeni ürün", `${data.name} ${data.size}${copyFromId ? ` (${result.lines} malzemelik reçete kopyalandı)` : ""}`);
    refresh();
    /** Kopyalamada neyin geldiği, kopyasızda kategoriden gelen zayi oranı: bildirimde söylenir (sessizce taşınmasın) */
    return result;
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

/** Kaydın panel denetimleri (aynı ad + boy, malzemeler var mı); siteye yazmadan önce de çalışır */
async function checkRecipe(db: Pick<ReturnType<typeof getDb>, "select">, data: z.output<typeof recipeSchema>) {
  const [dup] = await db
    .select({ id: s.products.id })
    .from(s.products)
    .where(and(eq(s.products.name, data.name), eq(s.products.size, data.size), ne(s.products.id, data.productId)));
  if (dup) throw new UserError("Aynı isim ve boyda başka bir ürün var");
  const ids = [...new Set(data.items.map((i) => i.ingredientId))];
  if (ids.length) {
    const found = await db.select({ id: s.ingredients.id }).from(s.ingredients).where(inArray(s.ingredients.id, ids));
    if (found.length !== ids.length) throw new UserError("Seçilen malzemelerden biri bulunamadı");
  }
}

/**
 * Reçete kartının kaydı. Ürün laffogato.net menüsüne bağlıysa ve fiyat ya da sitedeki menü durumu (active ve
 * showOnMenu birlikte) değişiyorsa önce siteye yazılır; site kabul etmezse kart hiç kaydedilmez. Panelin kendi
 * denetimleri siteye gitmeden önce yapılır (site kabul ettikten sonra kayıt düşmesin). Dönen değerler yazılan satış
 * alanlarıdır: site "Tükendi" derse QR menüde göster de kapanır (docs/SITE-MENU.md).
 */
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
    const [before] = await db.select().from(s.products).where(eq(s.products.id, data.productId));
    if (!before) throw new UserError("Ürün bulunamadı; sayfayı yenileyin");
    await checkRecipe(db, data);
    const desired = { price: data.price, active: data.active, showOnMenu: data.showOnMenu };
    const push = await pushSaleChange(me, before, desired, "değişiklikler kaydedilmedi");
    const now = new Date();
    const sale = await db.transaction(async (tx) => {
      await checkRecipe(tx, data);
      const written = push.kind === "pushed" ? await applyPushed(tx, push, before, desired, now) : desired;
      await tx
        .update(s.products)
        .set({
          name: data.name,
          size: data.size,
          categoryId: data.categoryId,
          price: written.price,
          fireOverride: data.fireOverride,
          note: data.note,
          active: written.active,
          showOnMenu: written.showOnMenu,
          updatedAt: now,
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
      return written;
    });
    const site = push.kind === "pushed" ? { price: push.price, visibility: push.visibility } : null;
    await logActivity(
      me,
      "Reçete kaydedildi",
      `${data.name} ${data.size} (${data.items.length} malzeme, ${tl(sale.price)})${
        site ? ` · sitede de: ${[site.price ? "fiyat" : null, site.visibility ? (panelIsActive(sale) ? "Satışta" : "Tükendi") : null].filter(Boolean).join(", ")}` : ""
      }`,
    );
    refresh();
    /** Yazılan satış alanları (site "Tükendi" derse QR menüde göster de kapanır) ve sitede neyin değiştiği */
    return { ...sale, site };
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
    // Sitedeki kalem kalır; yalnız panelin bağlantısı ürünle birlikte gider
    await logActivity(me, "Ürün silindi", `${p.name} ${p.size}${p.siteMenuId ? ` (site bağlantısı da kaldırıldı: ${p.siteMenuId} ${p.siteMenuSlot})` : ""}`);
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
    // İşlem geçmişinde numara değil ad görünsün
    const [cat] = await db.select({ name: s.categories.name }).from(s.categories).where(eq(s.categories.id, id)).limit(1);
    await db.delete(s.categories).where(eq(s.categories.id, id));
    await logActivity(me, "Kategori silindi", cat?.name ?? String(id));
    refresh();
    return null;
  });
}

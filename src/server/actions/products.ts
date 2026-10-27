"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { validateExpression } from "@/lib/calc/expr";
import { tl } from "@/lib/format";
import { productDeleteBlocker } from "@/lib/product-delete";
import type { PriceAck } from "@/lib/calc/price-impact";
import { priceMovedText, seenPriceDecision } from "@/lib/prices/seen";
import { isStaleFailure } from "@/lib/site-menu/push";
import { panelIsActive } from "@/lib/site-menu/slot";
import { keepSeen } from "@/lib/site-menu/sold-out";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel, loadSettings } from "@/server/data/dataset";
import { withPassiveRelist } from "@/server/data/ingredient-usage";
import { PRICE_ACK_KEY } from "@/server/data/price-alerts";
import { insertProduct } from "@/server/data/product-create";
import { productHistoryCounts } from "@/server/data/product-history";
import { getDb, schema as s } from "@/server/db";
import { recordPriceChange } from "@/server/prices/record";
import { PriceChangedError, writeSalePrice } from "@/server/prices/write";
import { applyPushed, pushSaleChange } from "@/server/site-menu/push";
import { SITE_ACTOR } from "@/server/site-menu/sync";

import { logActivity } from "./log";
import { attempt, UserError, zMoney, zOptText, zText } from "./util";

const zSize = z.enum(["M", "L", "Tek"], { message: "Boy seçin" });

/**
 * `ackAlert`: zam uyarısındaki "zammın payı" önerisi uygulandı. Öneri o anki fiyattan hesaplandığı için yeni
 * fiyattan yeniden artardı (85 → 90 → …); bu maliyet ve fiyatta uyarı kapanır. Fiyat geri alınır ya da düşürülürse,
 * maliyet daha da artarsa uyarı geri gelir (isAcknowledged).
 *
 * Ürün laffogato.net menüsüne bağlıysa fiyat önce siteye yazılır (docs/SITE-MENU.md); site kabul etmezse fiyat
 * değişmez ve hata döner. Dönen `price` yazılan fiyattır (sitenin kuruşu), `site` fiyatın sitede de değiştiği,
 * `posPending` kasada (ModPOS) değiştirilecek fiyat kaldığı (Fiyatlar › Kasaya işle; docs/FIYATLAR.md).
 *
 * `source`: fiyat geçmişindeki kaynak. Hammadde zamları kartındaki "Fiyatı X yap" iki dayanakta da "suggestion"
 * gönderir: `ackAlert` yalnız "zammın payı"nda verilir, hedef orana çekilen fiyat da öneridir. Fiyat hücresi ve
 * önerinin Geri al'ı elle ("manual").
 *
 * `seenPrice`: hücrenin ya da önerinin gördüğü (yazılmadan önceki) fiyat. Bu arada başka yerde değiştiyse (sitenin
 * çekmesi, toplu Fiyatlar, başka sekme) hiçbir şey yazılmaz, hata güncel fiyatı söyler (denetim E-11). Eski sekmedeki
 * istemci göndermez: bugünkü gibi yazılır. Yazım toplu değişikliğin tek ürün yoluyla aynı (writeSalePrice): bağlı
 * üründe önce site, fiyat, fiyat geçmişi ve kasanın durumu tek işlemde, yerel yazım koşullu.
 */
export async function updateProductPrice(id: number, price: number, ackAlert = false, source: "manual" | "suggestion" = "manual", seenPrice?: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const p = zMoney.min(0, "Fiyat negatif olamaz").parse(price);
    const ack = z.boolean().parse(ackAlert);
    // Zammın payı her zaman öneridir
    const from = ack ? "suggestion" : z.enum(["manual", "suggestion"]).parse(source);
    const seen = zMoney.min(0).nullish().parse(seenPrice) ?? undefined;
    const [before] = await getDb().select().from(s.products).where(eq(s.products.id, z.number().int().positive().parse(id)));
    if (!before) throw new UserError("Ürün bulunamadı");
    const written = await writeSalePrice(me, before, p, { source: from, consequence: "fiyat değişmedi", expectFrom: seen }).catch((e: unknown) => {
      // Fiyat bu arada değişti (panelde ya da sitede): liste güncel fiyatı görsün
      if (e instanceof PriceChangedError || isStaleFailure(e)) refresh();
      throw e;
    });
    const posPending = written.posPending;
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
      `${before.name} ${before.size}: ${tl(before.price)} → ${tl(written.price)}${from === "suggestion" ? " (zam önerisi)" : ""}${written.site ? " (sitede de)" : ""}`,
    );
    refresh();
    return { price: written.price, site: written.site, posPending };
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
    // Aynı ad + boy denetimi, kopyalama, kategoriden zayi oranı, sıra ve fiyat geçmişinin ilk satırı: personelin yeni
    // ürün önerisinin onayıyla ortak yardımcıda (src/server/data/product-create.ts)
    const result = await getDb().transaction((tx) => insertProduct(tx, data, { copyFromId, changedBy: me.name }));
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
  /**
   * Kart açılırken görülen menü anahtarları. Kullanıcı anahtara dokunmadıysa (gönderilen = görülen) veritabanındaki
   * güncel değer yazılır: açık kalmış kart, personelin bu arada Tükendi yaptığı ürünü sessizce yeniden açmaz (dalga 10
   * §2.1; src/lib/site-menu/sold-out.ts › keepSeen). Eski istemci göndermez.
   */
  seenActive: z.boolean().optional(),
  seenShowOnMenu: z.boolean().optional(),
  /**
   * Kart açılırken görülen satış fiyatı (denetim E-11; src/lib/prices/seen.ts): dokunulmadıysa veritabanındaki güncel
   * fiyat kalır, siteye eski fiyat gitmez; dokunulduysa ve fiyat bu arada başka yerde de değiştiyse kayıt yapılmaz.
   * Eski istemci göndermez.
   */
  seenPrice: zMoney.min(0).optional(),
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
 *
 * Açık kalmış kart (denetim E-11): satış alanlarından yalnız kullanıcının dokunduğu yazılır. Dokunulmayan fiyat ve
 * anahtar veritabanındaki güncel değerde kalır (bu arada sitede, eşitlemede ya da toplu Fiyatlar'da yazılanı geri
 * almaz, siteye eski değeri göndermez, fiyat geçmişine sahte kayıt düşürmez). Dokunulan fiyat bu arada başka yerde de
 * değiştiyse kayıt yapılmaz: kart güncel fiyatı görür, kullanıcı hangisinin kalacağını seçer.
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
    const price = seenPriceDecision(data.price, data.seenPrice, before.price);
    if (price.kind === "conflict") {
      // Kart sayfası yeniden çizilir: fiyat alanının altında güncel fiyat ve iki seçenek (recipe-editor.tsx)
      refresh();
      throw new UserError(priceMovedText(price.current, price.seen));
    }
    // Kullanıcının dokunduğu satış alanları (görülen gönderilmediyse eski istemci: hepsi dokunulmuş sayılır)
    const touched = {
      price: price.kind === "write",
      active: data.seenActive === undefined || data.active !== data.seenActive,
      showOnMenu: data.seenShowOnMenu === undefined || data.showOnMenu !== data.seenShowOnMenu,
    };
    const desired = {
      price: price.price,
      active: keepSeen(data.active, data.seenActive, before.active),
      showOnMenu: keepSeen(data.showOnMenu, data.seenShowOnMenu, before.showOnMenu),
    };
    const push = await pushSaleChange(me, before, desired, "değişiklikler kaydedilmedi").catch((e: unknown) => {
      // Site "bu arada değişti" dedi ve panel sitenin güncel menüsünü okudu: kart güncel değerleri görsün
      if (isStaleFailure(e)) refresh();
      throw e;
    });
    const now = new Date();
    const sale = await db.transaction(async (tx) => {
      await checkRecipe(tx, data);
      const pushed = push.kind === "pushed" ? await applyPushed(tx, push, before, desired, now) : null;
      // Site kabul ettiyse sitenin döndürdüğü satış alanları; değilse yalnız dokunulanlar (dokunulmayan, okumadan sonra
      // eşitlemenin ya da başka bir sekmenin yazdığını ezmesin)
      const saleSet = pushed ?? {
        ...(touched.price ? { price: desired.price } : {}),
        ...(touched.active ? { active: desired.active } : {}),
        ...(touched.showOnMenu ? { showOnMenu: desired.showOnMenu } : {}),
      };
      // Ürün yeniden aktif olur ya da reçetesine pasif malzeme yazılırsa o malzeme sayım listesine bu aydan girer
      const ingredientIds = data.items.map((it) => it.ingredientId);
      const written = await withPassiveRelist(tx, [data.productId], ingredientIds, async () => {
        const [row] = await tx
          .update(s.products)
          .set({
            name: data.name,
            size: data.size,
            categoryId: data.categoryId,
            fireOverride: data.fireOverride,
            note: data.note,
            ...saleSet,
            updatedAt: now,
          })
          // Yerel fiyat yazımı koşullu: okumadan sonra fiyat değiştiyse yazılmaz
          .where(and(eq(s.products.id, data.productId), !pushed && touched.price ? sql`abs(${s.products.price} - ${before.price}) < 0.005` : undefined))
          .returning({ price: s.products.price, active: s.products.active, showOnMenu: s.products.showOnMenu });
        if (!row) {
          const [cur] = await tx.select({ price: s.products.price }).from(s.products).where(eq(s.products.id, data.productId));
          if (!cur) throw new UserError("Ürün bulunamadı; sayfayı yenileyin");
          // Okumadan bu yana başka bir yazım fiyatı değiştirdi: çakışma (kart güncel fiyatı ve iki seçeneği gösterir)
          refresh();
          throw new PriceChangedError(priceMovedText(cur.price, data.seenPrice ?? before.price));
        }
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
        return row;
      });
      // Fiyat yazıldıysa ve değiştiyse geçmişe ve kasanın (ModPOS) listesine (kuruşu aynıysa yazılmaz). Dokunulmayan
      // fiyat yerelde yazılmadı: okumadan sonra başka yerde değişmişse o değişiklik kendi kaydını zaten yazdı. Yalnız
      // menü durumu siteye gittiyse ve sitenin yanıtı başka bir fiyat taşıdıysa o fiyat sitenindir ("laffogato.net")
      const pos =
        pushed || touched.price
          ? await recordPriceChange(
              tx,
              {
                productId: data.productId,
                before: before.price,
                after: written.price,
                ...(touched.price || (push.kind === "pushed" && push.price) ? { source: "manual" as const, changedBy: me.name } : { source: "site" as const, changedBy: SITE_ACTOR.name }),
                onSite: push.kind === "pushed" && push.price,
              },
              now,
            )
          : { posPending: false };
      return { ...written, posPending: pos.posPending };
    });
    const site = push.kind === "pushed" ? { price: push.price, visibility: push.visibility } : null;
    /** Dokunulmayan fiyat kart açıldıktan sonra başka yerde değişmişti: o korundu (bildirim söyler) */
    const priceKept = price.kind === "keep" && price.moved ? { seen: data.seenPrice ?? before.price, now: sale.price } : null;
    await logActivity(
      me,
      "Reçete kaydedildi",
      `${data.name} ${data.size} (${data.items.length} malzeme, ${tl(sale.price)})${
        site ? ` · sitede de: ${[site.price ? "fiyat" : null, site.visibility ? (panelIsActive(sale) ? "Satışta" : "Tükendi") : null].filter(Boolean).join(", ")}` : ""
      }`,
    );
    refresh();
    /**
     * Yazılan satış alanları (site "Tükendi" derse QR menüde göster de kapanır), sitede neyin değiştiği ve kasada
     * (ModPOS) değiştirilecek fiyat kaldığı (posPending; bildirim "Kasaya işle" der)
     */
    return { ...sale, site, priceKept };
  });
}

export async function deleteProduct(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const db = getDb();
    const [p] = await db.select().from(s.products).where(eq(s.products.id, z.number().int().positive().parse(id)));
    if (!p) throw new UserError("Ürün bulunamadı");
    // Satışı, zayi kaydı, fiyat geçmişi ya da online satışı olan ürün silinmez: kapanmış ayların maliyeti ve kârı
    // değişirdi (eşleşmesiz satır ortalama maliyet oranıyla hesaplanır), fiyat geçmişi kaybolurdu. Pasif yapılır.
    const blocker = productDeleteBlocker(await productHistoryCounts(p));
    if (blocker) throw new UserError(blocker);
    await db.delete(s.products).where(eq(s.products.id, p.id));
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

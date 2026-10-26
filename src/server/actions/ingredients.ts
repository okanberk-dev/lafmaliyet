"use server";

import { and, count, eq, max, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { countFactor, countUnitsFor, currentMonthTR } from "@/lib/calc/engine";
import { listedFromMonth } from "@/lib/count-item";
import { tl } from "@/lib/format";
import { passiveRefusal, productListText } from "@/lib/ingredient-usage";
import { requireAdmin } from "@/server/auth/dal";
import { recordIngredientPrice } from "@/server/data/ingredient-prices";
import { activeProductsUsing } from "@/server/data/ingredient-usage";
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
  /** Pencerenin gördüğü paket fiyatı ve içeriği: gelen değer bununla aynıysa alan değiştirilmemiştir, kayıttaki kalır */
  base: z.object({ packagePrice: z.number(), packageSize: z.number() }).nullish(),
  unit: z.enum(["gr", "ml", "adet", "dilim"]),
  vatRate: z.number().min(0).max(1),
  note: zOptText(1000),
  isEstimate: z.boolean(),
  priceSource: z.enum(["manual", "water"]),
  countUnit: z.enum(["KG", "LT", "ADET", "DİLİM"]).nullable(),
  countGroup: zOptText(80),
  active: z.boolean(),
});

/** İşlem geçmişinde: sayım kaleminin tahmini düzeltildi (recordIngredientPrice "start") */
const FIXED_START_LOG = " · sayımdaki tahmin düzeltildi, eklendiği ay da bu fiyatla değerlenir";

/**
 * Hammaddeyi kaydeder. Sayım birimi malzeme birimine uymalı (gr → KG, ml → LT, adet → ADET, dilim → DİLİM ya da ADET);
 * yoksa stok değeri 1000 kat yanlış çıkar. Sayım birimi (ya da malzeme birimi) değişirse eski sayımlar kendi
 * birimleriyle kalır; dönüşte `warning` bunu kullanıcıya söylemek içindir. Değişen fiyat geçmişe recordIngredientPrice
 * ile yazılır: sayım listesinden eklenip hâlâ Tahmini olan kalemde tahminin düzeltmesidir (kapanmış ay da düzelir).
 */
export async function saveIngredient(input: z.input<typeof ingredientSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = ingredientSchema.parse(input);
    if (data.countUnit && !countUnitsFor(data.unit).includes(data.countUnit)) {
      const allowed = countUnitsFor(data.unit);
      throw new UserError(`“${data.unit}” birimli malzeme ${allowed.join(" ya da ")} olarak sayılır (seçilen: ${data.countUnit})`);
    }
    const db = getDb();
    const warnings: string[] = [];
    /** Kaydedilen paket fiyatı ve içeriği (günlük için) */
    const saved = { packagePrice: data.packagePrice, packageSize: data.packageSize };
    /** Sayım kaleminin tahmini düzeltildi (başlangıç satırı yerinde) */
    let fixedStart = false;
    const id = await db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: s.ingredients.id })
        .from(s.ingredients)
        .where(data.id ? and(eq(s.ingredients.name, data.name), ne(s.ingredients.id, data.id)) : eq(s.ingredients.name, data.name));
      if (dup) throw new UserError(`“${data.name}” adında bir malzeme zaten var`);
      if (data.id) {
        const [before] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, data.id));
        if (!before) throw new UserError("Malzeme bulunamadı");
        if (before.active && !data.active) {
          const refusal = passiveRefusal(before.name, (await activeProductsUsing(tx, [data.id])).get(data.id) ?? []);
          if (refusal) throw new UserError(refusal);
        }
        const { id: _omit, base, ...rest } = data;
        void _omit;
        // Pencere açıkken fiyat başka yerden değiştiyse (satırdaki fiyat kutusu, Paraşüt eşitlemesi) dokunulmamış alan
        // eski değeri geri yazmaz, sahte fiyat geçmişi kaydı açılmaz
        if (base && rest.packagePrice === base.packagePrice) rest.packagePrice = before.packagePrice;
        if (base && rest.packageSize === base.packageSize) rest.packageSize = before.packageSize;
        Object.assign(saved, { packagePrice: rest.packagePrice, packageSize: rest.packageSize });
        if (before.countUnit !== data.countUnit || before.unit !== data.unit) {
          const [{ n }] = await tx.select({ n: count() }).from(s.stockCounts).where(eq(s.stockCounts.ingredientId, data.id));
          if (n > 0) {
            warnings.push(
              !data.countUnit
                ? `${n} eski sayım kaydı geçmiş aylarda ${before.countUnit ?? "eski birimiyle"} olarak kalır; malzeme bundan sonra sayım listesinde görünmez.`
                : countFactor(before.countUnit) !== countFactor(data.countUnit) || before.unit !== data.unit
                  ? `${n} eski sayım kaydı sayıldığı birimle (${before.countUnit ?? "eski birim"}) değerlenmeye devam eder; yeni sayımları ${data.countUnit} olarak girin.`
                  : `Sayım birimi ${data.countUnit} oldu; ${n} eski sayım kaydının değeri değişmez.`,
            );
          }
        }
        // Sayım listesine şimdi giriyorsa (sayım birimi verildi ya da yeniden aktif) bu aydan: geçmiş aylar "yarım" olmasın
        const listedNow = !(before.active && before.countUnit) && data.active && !!data.countUnit;
        const countFrom = listedNow ? { countFrom: listedFromMonth(before.countFrom, currentMonthTR()) } : {};
        await tx
          .update(s.ingredients)
          .set({ ...rest, ...countFrom, updatedAt: new Date() })
          .where(eq(s.ingredients.id, data.id));
        if (before.packagePrice !== rest.packagePrice || before.packageSize !== rest.packageSize) {
          const written = await recordIngredientPrice(tx, { id: data.id, isEstimate: before.isEstimate }, { packagePrice: rest.packagePrice, packageSize: rest.packageSize, changedBy: me.name });
          fixedStart = written === "start";
        }
        return data.id;
      }
      const [{ m }] = await tx.select({ m: max(s.ingredients.sortOrder) }).from(s.ingredients);
      const { id: _omit, base: _base, ...rest } = data;
      void _omit;
      void _base;
      // Sayım birimiyle açılan hammadde bu aydan sayım listesinde (geçmiş, sayımı bitmiş aylar "yarım" olmasın)
      const [created] = await tx
        .insert(s.ingredients)
        .values({ ...rest, sortOrder: (m ?? 0) + 1, countFrom: rest.countUnit ? currentMonthTR() : null })
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
    await logActivity(
      me,
      data.id ? "Hammadde güncellendi" : "Yeni hammadde",
      `${data.name}: ${tl(saved.packagePrice, 2)} / ${saved.packageSize} ${data.unit}${fixedStart ? FIXED_START_LOG : ""}`,
    );
    refresh();
    // warning: sayım birimi değiştiyse eski sayımların durumu (istemci bilgi olarak gösterir), yoksa null
    return { id, warning: warnings[0] ?? null };
  });
}

/**
 * Tablodan hızlı paket fiyatı güncelleme (yeni fatura geldiğinde). clearEstimate=false: "Tahmini" işareti kalır
 * (varsayım fiyatla değil paket içeriği ya da ürün eşleştirmesiyle ilgili olabilir; kullanıcı ayrıca kaldırır).
 * Geçmişe recordIngredientPrice ile yazılır (Tahmini sayım kaleminde tahminin düzeltmesi). Dönüş: malzemenin kayıttan
 * sonraki Tahmini durumu.
 */
export async function updateIngredientPrice(id: number, packagePrice: number, clearEstimate = true) {
  return attempt(async () => {
    const me = await requireAdmin();
    const price = z.number().finite().min(0, "Fiyat negatif olamaz").parse(packagePrice);
    const db = getDb();
    const [before] = await db.select().from(s.ingredients).where(eq(s.ingredients.id, id));
    if (!before) throw new UserError("Malzeme bulunamadı");
    if (before.priceSource === "water") throw new UserError("Su ve buz fiyatı su faturasından hesaplanır");
    if (Math.abs(before.packagePrice - price) < 0.0001) return { isEstimate: before.isEstimate };
    const written = await db.transaction(async (tx) => {
      await tx
        .update(s.ingredients)
        .set({ packagePrice: price, isEstimate: clearEstimate ? false : before.isEstimate, updatedAt: new Date() })
        .where(eq(s.ingredients.id, id));
      return recordIngredientPrice(tx, { id, isEstimate: before.isEstimate }, { packagePrice: price, packageSize: before.packageSize, changedBy: me.name });
    });
    await logActivity(me, "Hammadde fiyatı", `${before.name}: ${tl(before.packagePrice, 2)} → ${tl(price, 2)}${written === "start" ? FIXED_START_LOG : ""}`);
    refresh();
    return { isEstimate: clearEstimate ? false : before.isEstimate };
  });
}

/** "Tahmini" işaretini koyar ya da kaldırır (fiyat değişmeden; ör. varsayım doğrulandı) */
export async function setIngredientEstimate(id: number, isEstimate: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const iid = z.number().int().positive().parse(id);
    const flag = z.boolean().parse(isEstimate);
    const db = getDb();
    const [before] = await db.select().from(s.ingredients).where(eq(s.ingredients.id, iid));
    if (!before) throw new UserError("Malzeme bulunamadı");
    if (before.isEstimate === flag) return null;
    await db.update(s.ingredients).set({ isEstimate: flag, updatedAt: new Date() }).where(eq(s.ingredients.id, iid));
    await logActivity(me, flag ? "Hammadde tahmini işaretlendi" : "Hammadde tahmini işareti kaldırıldı", before.name);
    refresh();
    return null;
  });
}

/**
 * Aktif/pasif: reçetede kullanılan malzeme silinemez, pasif yapılır (seçim listelerinden ve sayım listesinden düşer,
 * pasif ürünlerin reçeteleri bozulmaz). Aktif bir ürünün reçetesinde geçen malzeme pasif yapılamaz: ürünler onu
 * tüketmeye devam ederdi; önce reçetelerden çıkarılır (denetim E-04).
 */
export async function setIngredientActive(id: number, active: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const iid = z.number().int().positive().parse(id);
    const flag = z.boolean().parse(active);
    const db = getDb();
    const [before] = await db.select().from(s.ingredients).where(eq(s.ingredients.id, iid));
    if (!before) throw new UserError("Malzeme bulunamadı");
    if (before.active === flag) return null;
    if (!flag) {
      const refusal = passiveRefusal(before.name, (await activeProductsUsing(db, [iid])).get(iid) ?? []);
      if (refusal) throw new UserError(refusal);
    }
    // Yeniden aktif olan sayım kalemi bu aydan listede: geçmiş aylar "yarım" görünmesin (o ay sayıldıysa yine çıkar)
    const countFrom = flag && before.countUnit ? { countFrom: listedFromMonth(before.countFrom, currentMonthTR()) } : {};
    await db
      .update(s.ingredients)
      .set({ active: flag, ...countFrom, updatedAt: new Date() })
      .where(eq(s.ingredients.id, iid));
    await logActivity(me, flag ? "Hammadde aktif" : "Hammadde pasif", before.name);
    refresh();
    return null;
  });
}

/**
 * Hammaddeyi siler. Reçetede kullanılan, sayımı, alım miktarı, Paraşüt eşleştirmesi ya da zayi / ikram kaydı olan
 * malzeme silinmez (silmek bu geçmişi de silerdi: geçmiş ayların stok değeri, zayi maliyeti ve Tutarlılık'taki kayıtlı
 * tüketim değişirdi; zayi kaydı malzemesiz kalırdı, denetim E-28): pasif yapılmalı. Aktif bir ürünün reçetesindeyse
 * önce reçetelerden çıkarılır (pasif de yapılamaz).
 */
export async function deleteIngredient(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const iid = z.number().int().positive().parse(id);
    const db = getDb();
    const used = await db.select({ id: s.recipeItems.id }).from(s.recipeItems).where(eq(s.recipeItems.ingredientId, iid)).limit(1);
    if (used.length) {
      const active = (await activeProductsUsing(db, [iid])).get(iid) ?? [];
      throw new UserError(
        active.length
          ? `Bu malzeme ${active.length} aktif ürünün reçetesinde kullanılıyor (${productListText(active)}). Önce reçetelerden çıkarın.`
          : "Bu malzeme yalnız pasif ürünlerin reçetelerinde kullanılıyor. Önce o reçetelerden çıkarın ya da pasif yapın.",
      );
    }
    const [[counts], [purchases], [links], [waste]] = await Promise.all([
      db.select({ n: count() }).from(s.stockCounts).where(eq(s.stockCounts.ingredientId, iid)),
      db.select({ n: count() }).from(s.purchaseQuantities).where(eq(s.purchaseQuantities.ingredientId, iid)),
      db.select({ n: count() }).from(s.parasutProductLinks).where(eq(s.parasutProductLinks.ingredientId, iid)),
      db.select({ n: count() }).from(s.wasteEntries).where(eq(s.wasteEntries.ingredientId, iid)),
    ]);
    const history = [
      counts.n ? `${counts.n} sayım` : "",
      purchases.n ? `${purchases.n} alım miktarı` : "",
      links.n ? `${links.n} Paraşüt eşleştirmesi` : "",
      waste.n ? `${waste.n} zayi / ikram` : "",
    ].filter(Boolean);
    if (history.length) {
      throw new UserError(`Bu malzemenin ${history.join(", ")} kaydı var; silinirse geçmiş ayların stok, zayi ve tutarlılık değerleri değişir. Pasif yapın.`);
    }
    const [d] = await db.delete(s.ingredients).where(eq(s.ingredients.id, iid)).returning();
    if (d) await logActivity(me, "Hammadde silindi", d.name);
    refresh();
    return null;
  });
}

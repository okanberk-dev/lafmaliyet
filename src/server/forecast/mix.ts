import "server-only";

import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { buildMix, dessertGap, effectiveDessertCategories, isDessertCategory, type DessertGap, type MixInput, type ProductMix } from "@/lib/forecast/desserts";
import type { ForecastSettings } from "@/lib/forecast/staffing";
import { addDays } from "@/lib/reminders";
import { loadDailyProductSales } from "@/server/data/daily-sales";
import { getDb, schema as s } from "@/server/db";

/** Tatlı payı en çok bu kadar son satış ayından */
export const MIX_MONTHS = 3;

/**
 * Tatlı hazırlığının dayanağı: son (en çok 3) satış ayındaki tatlı satışı ve o ayların POS cirosu (yoksa satış
 * satırlarının toplamı), tatlı ürünlerin reçeteleri. ModPOS'un günlük ürün satışı (R18) bugün hep null; döküm gelince
 * hafta gününe göre oranlar burada kurulacak, o zamana kadar aylık pay. Pay çıkmazsa mix null, gap nedeni.
 */
export async function loadDessertMix(
  settings: Pick<ForecastSettings, "dessertCategories">,
  today: string,
): Promise<{ mix: ProductMix | null; gap: DessertGap | null }> {
  const db = getDb();
  const [monthRows, daily] = await Promise.all([
    db
      .selectDistinct({ month: s.salesLines.month })
      .from(s.salesLines)
      .where(and(lte(s.salesLines.month, today.slice(0, 7)), isNotNull(s.salesLines.productId)))
      .orderBy(desc(s.salesLines.month))
      .limit(MIX_MONTHS),
    loadDailyProductSales(addDays(today, -56), addDays(today, -1)),
  ]);
  if (daily?.length) console.warn("[tahmin] ModPOS günlük ürün satışı var ama tatlı payı henüz aylık (docs/SATIS-TAHMINI.md)");
  const months = monthRows.map((m) => m.month);
  if (!months.length) return { mix: null, gap: "satis" };
  const [monthInfo, lines, products] = await Promise.all([
    db.select({ month: s.months.month, posRevenue: s.months.posRevenue }).from(s.months).where(inArray(s.months.month, months)),
    db
      .select({ month: s.salesLines.month, productId: s.salesLines.productId, qty: s.salesLines.qty, revenue: s.salesLines.revenue })
      .from(s.salesLines)
      .where(inArray(s.salesLines.month, months)),
    db
      .select({ id: s.products.id, name: s.products.name, categoryName: s.categories.name })
      .from(s.products)
      .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId)),
  ]);
  // Silinen ya da adı değişen kategori yok sayılır; seçilenlerden hiçbiri kalmadıysa adında "tatlı" geçenler
  const chosen = effectiveDessertCategories(settings.dessertCategories, [...new Set(products.map((p) => p.categoryName))]);
  const dessertIds = products.filter((p) => isDessertCategory(p.categoryName, chosen)).map((p) => p.id);
  const recipes = dessertIds.length
    ? await db
        .select({
          productId: s.recipeItems.productId,
          ingredientId: s.recipeItems.ingredientId,
          qty: s.recipeItems.qty,
          name: s.ingredients.name,
          unit: s.ingredients.unit,
          category: s.ingredients.category,
          packageSize: s.ingredients.packageSize,
        })
        .from(s.recipeItems)
        .innerJoin(s.ingredients, eq(s.ingredients.id, s.recipeItems.ingredientId))
        .where(inArray(s.recipeItems.productId, dessertIds))
    : [];
  // Ayın cirosu: POS cirosu, yoksa satış satırlarının toplamı
  const lineRevenue = new Map<string, number>();
  for (const l of lines) lineRevenue.set(l.month, (lineRevenue.get(l.month) ?? 0) + l.revenue);
  const pos = new Map(monthInfo.map((m) => [m.month, m.posRevenue]));
  const input: MixInput = {
    months: months.map((month) => {
      const p = pos.get(month);
      return { month, revenue: p != null && p > 0 ? p : (lineRevenue.get(month) ?? 0) };
    }),
    lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    products,
    recipes: recipes.map((r) => ({ productId: r.productId, ingredientId: r.ingredientId, qty: r.qty })),
    ingredients: [...new Map(recipes.map((r) => [r.ingredientId, { id: r.ingredientId, name: r.name, unit: r.unit, category: r.category, packageSize: r.packageSize }])).values()],
    chosen,
  };
  const mix = buildMix(input);
  return { mix, gap: mix ? null : (dessertGap(input) ?? "satis") };
}

/** Tatlı payı (Bugün kartı, personel satırı, sabah e-postası); yoksa null */
export async function loadProductMix(settings: Pick<ForecastSettings, "dessertCategories">, today: string): Promise<ProductMix | null> {
  return (await loadDessertMix(settings, today)).mix;
}

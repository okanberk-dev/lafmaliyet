import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import { buildMix, dessertGap, effectiveDessertCategories, isDessertCategory, type DessertGap, type MixInput, type ProductMix } from "@/lib/forecast/desserts";
import type { ForecastSettings } from "@/lib/forecast/staffing";
import { shiftMonth } from "@/lib/reminders";
import { parseCoverage, SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import { mergeWithLafpos } from "@/server/data/lafpos-sales";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

/** Tatlı payı en çok bu kadar son satış ayından */
export const MIX_MONTHS = 3;

/** LafPOS'a geçildiyse satış ayları en çok bu kadar ay geriye aranır (birleştirme bütün satırları okumasın) */
const MIX_LOOKBACK_MONTHS = 12;

type MixLine = { month: string; productId: number | null; qty: number; revenue: number };

/** Son (en çok MIX_MONTHS) satış ayı ve o ayların satırları: Satışlar'a yüklenen ModPOS listeleri (geçiş günü yokken) */
async function modposMixLines(db: DB, month: string): Promise<{ months: string[]; lines: MixLine[] }> {
  const monthRows = await db
    .selectDistinct({ month: s.salesLines.month })
    .from(s.salesLines)
    .where(and(lte(s.salesLines.month, month), isNotNull(s.salesLines.productId)))
    .orderBy(desc(s.salesLines.month))
    .limit(MIX_MONTHS);
  const months = monthRows.map((m) => m.month);
  if (!months.length) return { months, lines: [] };
  const lines = await db
    .select({ month: s.salesLines.month, productId: s.salesLines.productId, qty: s.salesLines.qty, revenue: s.salesLines.revenue })
    .from(s.salesLines)
    .where(inArray(s.salesLines.month, months));
  return { months, lines };
}

/**
 * Geçiş günü seçiliyken aynı ayların satırları, aylık modelin kuralıyla (src/lib/lafpos/sales.ts): geçiş gününden
 * itibaren LafPOS'un ay toplamları, sayılmayan ModPOS listesi dışarıda
 */
async function mergedMixLines(db: DB, switchDay: string, today: string): Promise<{ months: string[]; lines: MixLine[] }> {
  const month = today.slice(0, 7);
  const t = s.salesLines;
  const [rows, [coverageRow]] = await Promise.all([
    db
      .select()
      .from(t)
      .where(and(lte(t.month, month), gte(t.month, shiftMonth(month, -MIX_LOOKBACK_MONTHS))))
      .orderBy(asc(t.sortOrder), asc(t.id)),
    db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, SALES_COVERAGE_KEY)).limit(1),
  ]);
  const merged = await mergeWithLafpos(db, {
    switchDay,
    salesLines: rows.map((l) => ({ id: l.id, month: l.month, posName: l.posName, qty: l.qty, revenue: l.revenue, productId: l.productId, isService: l.isService, note: l.note })),
    coverage: parseCoverage(coverageRow?.value),
    today,
    toMonth: month,
  });
  const inRange = merged.salesLines.filter((l) => l.month <= month);
  const months = [...new Set(inRange.filter((l) => l.productId !== null).map((l) => l.month))].sort().reverse().slice(0, MIX_MONTHS);
  const keep = new Set(months);
  return { months, lines: inRange.filter((l) => keep.has(l.month)).map((l) => ({ month: l.month, productId: l.productId, qty: l.qty, revenue: l.revenue })) };
}

/**
 * Tatlı hazırlığının dayanağı: son (en çok 3) satış ayındaki tatlı satışı ve o ayların POS cirosu (yoksa satış
 * satırlarının toplamı), tatlı ürünlerin reçeteleri. Satış ayları aylık modelinkiyle aynı: Satışlar'a yüklenen ModPOS
 * listeleri, LafPOS'a geçiş günü seçiliyse o günden itibaren LafPOS'un ay toplamları (docs/LAFPOS.md › Günlük satış).
 * Pay aylık; hafta gününe göre oran günlük satışla sonra kurulabilir. Pay çıkmazsa mix null, gap nedeni.
 */
export async function loadDessertMix(
  settings: Pick<ForecastSettings, "dessertCategories">,
  today: string,
): Promise<{ mix: ProductMix | null; gap: DessertGap | null }> {
  const db = getDb();
  const switchDay = await loadLafposSwitchDay(db);
  const { months, lines } = switchDay === null ? await modposMixLines(db, today.slice(0, 7)) : await mergedMixLines(db, switchDay, today);
  if (!months.length) return { mix: null, gap: "satis" };
  const [monthInfo, products] = await Promise.all([
    db.select({ month: s.months.month, posRevenue: s.months.posRevenue }).from(s.months).where(inArray(s.months.month, months)),
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

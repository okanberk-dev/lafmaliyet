/**
 * Tatlı hazırlığı önerisi (saf; tests/satis-tahmini.test.ts). Tatlılar bütün pasta olarak alınıp dilimlenir; hazırlık
 * birimi reçetedeki malzemedir ("San Sebastian dilim", paketi 12 dilim). Oran son satış aylarındaki payından gelir, her
 * 10.000 ₺ satışta kaç tatlı (satış ayları aylık modelinki: ModPOS listesi, geçiş gününden itibaren LafPOS'un ay
 * toplamları; src/server/forecast/mix.ts). Hafta gününe göre oran günlük satırlarla sonra kurulabilir
 * (docs/planlar/CRITIQUE2.md R18).
 */

import { PACKAGING_CATEGORY } from "@/lib/constants";

import type { ForecastDay } from "./model";

export interface PrepItem {
  key: string;
  label: string;
  unit: "dilim" | "adet";
  /** Bir bütünden çıkan dilim (paket boyu); dilim olmayan ya da paketi 1 olan kalemde null */
  perWhole: number | null;
}

export interface ProductMix {
  /** Dayanak: son satış ayları ve cirosu (POS, yoksa satış satırlarının toplamı) */
  basis: { months: string[]; revenue: number };
  items: PrepItem[];
  /** Hazırlık kalemi → birim / ₺ */
  perTL: Record<string, number>;
  /** Tatlı ürün adedi / ₺ (günün tatlı sayısı) */
  dessertsPerTL: number;
  /** Hesaba giren kategoriler (adları) */
  categories: string[];
}

/** Türkçe katlama: küçük harf, ı → i, aksan silinir ("TATLILAR" → "tatlilar") */
export function foldTR(v: string): string {
  return v
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Tatlı kategorisi mi: seçili adlar verildiyse onlardan biri (katlanarak), yoksa adında "tatl" geçen */
export function isDessertCategory(name: string, chosen: readonly string[] | null): boolean {
  if (chosen && chosen.length) return chosen.some((c) => foldTR(c) === foldTR(name));
  return foldTR(name).includes("tatl");
}

/**
 * Ayardaki kategorilerden bugün var olanlar (yeniden adlandırılan ya da silinen kategori yok sayılır); hiçbiri kalmadıysa
 * null: adında "tatlı" geçenler
 */
export function effectiveDessertCategories(chosen: readonly string[] | null, existing: readonly string[]): string[] | null {
  if (!chosen?.length) return null;
  const have = new Set(existing.map(foldTR));
  const kept = chosen.filter((c) => have.has(foldTR(c)));
  return kept.length ? kept : null;
}

/** "San Sebastian dilim" → "San Sebastian", "Magnolia (adet)" → "Magnolia" */
export function prepLabel(ingredientName: string): string {
  const out = ingredientName
    .replace(/\s*\((adet|dilim)\)\s*$/i, "")
    .replace(/\s+(adet|dilim)$/i, "")
    .trim();
  return out || ingredientName.trim();
}

export interface MixInput {
  months: { month: string; revenue: number }[];
  lines: { productId: number | null; qty: number }[];
  products: { id: number; name: string; categoryName: string }[];
  recipes: { productId: number; ingredientId: number; qty: number }[];
  ingredients: { id: number; name: string; unit: string; category: string; packageSize: number }[];
  chosen: readonly string[] | null;
}

/**
 * Ürün payından hazırlık oranları. Tatlı ürünler kategorisi isDessertCategory'den geçenler; hazırlık kalemleri
 * reçetelerindeki ambalaj olmayan, birimi dilim ya da adet malzemeler (dondurmanın ml'si gibi gr / ml sayılmaz). Böyle
 * malzemesi olmayan tatlı kendi adıyla "adet" kalemi olur. Tatlı satışı ya da ciro yoksa null (nedeni dessertGap).
 */
export function buildMix(i: MixInput): ProductMix | null {
  const revenue = i.months.reduce((a, m) => a + (m.revenue > 0 ? m.revenue : 0), 0);
  if (!(revenue > 0)) return null;
  const desserts = new Map(i.products.filter((p) => isDessertCategory(p.categoryName, i.chosen)).map((p) => [p.id, p]));
  const qtyOf = new Map<number, number>();
  for (const l of i.lines) if (l.productId !== null && desserts.has(l.productId) && l.qty > 0) qtyOf.set(l.productId, (qtyOf.get(l.productId) ?? 0) + l.qty);
  const totalQty = [...qtyOf.values()].reduce((a, b) => a + b, 0);
  if (!(totalQty > 0)) return null;
  const ingById = new Map(i.ingredients.map((g) => [g.id, g]));
  const items = new Map<string, PrepItem>();
  const units = new Map<string, number>();
  const add = (item: PrepItem, n: number) => {
    if (!items.has(item.key)) items.set(item.key, item);
    units.set(item.key, (units.get(item.key) ?? 0) + n);
  };
  for (const [productId, qty] of qtyOf) {
    const prep = i.recipes
      .filter((r) => r.productId === productId && r.qty > 0)
      .map((r) => ({ r, g: ingById.get(r.ingredientId) }))
      .filter((x): x is { r: (typeof i.recipes)[number]; g: (typeof i.ingredients)[number] } => {
        if (!x.g || x.g.category === PACKAGING_CATEGORY) return false;
        const u = foldTR(x.g.unit);
        return u === "dilim" || u === "adet";
      });
    if (!prep.length) {
      add({ key: `p:${productId}`, label: desserts.get(productId)!.name, unit: "adet", perWhole: null }, qty);
      continue;
    }
    for (const { r, g } of prep) {
      const unit = foldTR(g.unit) === "dilim" ? "dilim" : "adet";
      add({ key: `i:${g.id}`, label: prepLabel(g.name), unit, perWhole: unit === "dilim" && g.packageSize > 1 ? g.packageSize : null }, qty * r.qty);
    }
  }
  const categories = [...new Set([...qtyOf.keys()].map((id) => desserts.get(id)!.categoryName))].sort((a, b) => a.localeCompare(b, "tr"));
  return {
    basis: { months: [...i.months.map((m) => m.month)].sort(), revenue },
    items: [...items.values()],
    perTL: Object.fromEntries([...units].map(([k, n]) => [k, n / revenue])),
    dessertsPerTL: totalQty / revenue,
    categories,
  };
}

/** Tatlı payı neden yok: "satis" satış ayı ya da cirosu yok; "kategori" satış var ama tatlı sayılan kategorilerde hiç yok */
export type DessertGap = "satis" | "kategori";

/**
 * buildMix'in null nedeni. Satış yüklüyken tatlı kategorilerinde hiç satış yoksa sorun kategori seçimidir (tatlıların
 * kategorisi "Pasta" adlı, adında "tatlı" yok; ya da yanlış kategori seçilmiş): ekran Satışlar'a değil Tahmin
 * ayarları'na götürür. Pay çıkıyorsa null.
 */
export function dessertGap(i: Pick<MixInput, "months" | "lines" | "products" | "chosen">): DessertGap | null {
  if (!i.months.length || !i.lines.some((l) => l.productId !== null && l.qty > 0)) return "satis";
  const desserts = new Set(i.products.filter((p) => isDessertCategory(p.categoryName, i.chosen)).map((p) => p.id));
  if (!i.lines.some((l) => l.productId !== null && desserts.has(l.productId) && l.qty > 0)) return "kategori";
  return i.months.some((m) => m.revenue > 0) ? null : "satis";
}

export interface DessertPlan {
  /** Haftalık çokluğa göre sıralı; haftada hiç çıkmayan kalem yok */
  items: { item: PrepItem; perDay: number[]; total: number; wholes: number | null }[];
  /** Günün tatlı adedi (yuvarlanmış); kapalı gün 0 */
  perDay: number[];
  /** Haftanın tatlı adedi (ham toplamın yuvarlanmışı) */
  weekTotal: number;
  /** Her 10.000 ₺ satışta tatlı */
  per10k: number;
}

/** Günlerin tahmininden tatlı hazırlığı: kalem başına gün gün, haftalık toplam ve bütün sayısı (bir ondalık) */
export function dessertPlan(days: readonly Pick<ForecastDay, "amount" | "closed">[], mix: ProductMix): DessertPlan {
  const sales = days.map((d) => (d.closed ? 0 : d.amount));
  const items = mix.items
    .map((item) => {
      const raw = sales.map((a) => a * (mix.perTL[item.key] ?? 0));
      const total = Math.round(raw.reduce((a, b) => a + b, 0));
      return { item, perDay: raw.map((v) => Math.round(v)), total, wholes: item.perWhole ? Math.round((total / item.perWhole) * 10) / 10 : null };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total || a.item.label.localeCompare(b.item.label, "tr"));
  const rawDay = sales.map((a) => a * mix.dessertsPerTL);
  return {
    items,
    perDay: rawDay.map((v) => Math.round(v)),
    weekTotal: Math.round(rawDay.reduce((a, b) => a + b, 0)),
    per10k: Math.round(mix.dessertsPerTL * 10_000 * 10) / 10,
  };
}

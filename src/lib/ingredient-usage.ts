/**
 * Hammaddenin aktif reçetelerde kullanımı: sayım listesi, pasif yapma ve "hiçbir reçetede yok" aynı kuralı kullanır
 * (denetim E-04, E-58). Saf: motor (engine.ts), sunucu eylemleri ve Hammaddeler ekranı paylaşır.
 */

import { num } from "./format";

/**
 * Sayım listesinde mi: sayım birimi olan aktif malzeme, ya da pasif olup aktif bir ürünün reçetesinde geçen malzeme
 * (satışla tüketilmeye devam eder; listeden düşerse kalan stoğu kapanışta 0 sayılır, mal maliyeti şişer).
 */
export function isCountable(ing: { active: boolean; countUnit: string | null }, inActiveRecipe: boolean): boolean {
  return !!ing.countUnit && (ing.active || inActiveRecipe);
}

/** Malzemeyi reçetesinde kullanan aktif ürün sayısı (Hammaddeler'in "Reçetede yok" çipi, süzgeci ve kartı) */
export const activeUses = (i: { usedIn: readonly { active: boolean }[] }) => i.usedIn.filter((u) => u.active).length;

/**
 * Düzenleme penceresinin alt başlığı, çiple aynı kuralla (yalnız aktif ürünler "kullanıyor"): "3 aktif üründe
 * kullanılıyor · 2 pasif ürün", "Aktif reçetede yok · 3 pasif ürün", "Reçetede yok"
 */
export function usageText(i: { usedIn: readonly { active: boolean }[] }): string {
  const active = activeUses(i);
  const passive = i.usedIn.length - active;
  const tail = passive ? ` · ${num(passive)} pasif ürün` : "";
  if (active) return `${num(active)} aktif üründe kullanılıyor${tail}`;
  return passive ? `Aktif reçetede yok${tail}` : "Reçetede yok";
}

/** Bir ürün ("Lemon Tea · M") */
export interface UsageProduct {
  id: number;
  name: string;
  size?: string | null;
}

const label = (p: UsageProduct) => (p.size ? `${p.name} · ${p.size}` : p.name);

/** "Lemon Tea · M, Lemon Tea · L, Ice Tea · M ve 3 ürün daha" */
export function productListText(products: UsageProduct[], max = 3): string {
  const names = products.slice(0, max).map(label);
  const rest = products.length - names.length;
  return rest > 0 ? `${names.join(", ")} ve ${rest} ürün daha` : names.join(", ");
}

/**
 * Aktif ürünün reçetesinde geçen malzeme pasif yapılamaz: ürünler onu tüketmeye devam ederdi (Tutarlılık ve sayım
 * sapması kapanmaz). Önce reçetelerden çıkarılır ya da yerine başka malzeme yazılır. Engel yoksa null.
 */
export function passiveRefusal(name: string, activeProducts: UsageProduct[]): string | null {
  if (!activeProducts.length) return null;
  return `“${name}” ${activeProducts.length} aktif ürünün reçetesinde kullanılıyor (${productListText(activeProducts)}). Pasif yapmadan önce bu reçetelerden çıkarın ya da yerine başka malzeme yazın; yoksa ürünler onu tüketmeye devam eder.`;
}

// "Hammadde değil" denen Paraşüt ürünleri (kargo, hizmet, ekipman, pompa…): bekleyenler listesinden ve zildeki
// "bağlanmayı bekliyor" sayısından çıkar, listenin altındaki "Hammadde değil" bölümünden geri alınır. Liste
// integration_state'te durur (parasut.productIgnore), yeni tablo yok; bu dosya listenin saf kurallarıdır
// (tests/product-ignore.test.ts).

import { parseReason, type NotIngredientReason } from "./invoice-split";

/** Listede en çok bu kadar ürün tutulur (en yeniler) */
export const IGNORED_PRODUCTS_MAX = 500;

export interface IgnoredProduct {
  productKey: string;
  productName: string;
  /** İşaretlendiği an (ISO) */
  at: string;
  /** İşaretleyen kullanıcının adı */
  by?: string;
  /**
   * Neden (25 Kasım 2026; src/lib/invoice-split.ts): kalemin gelir-giderde nereye yazılacağı (Sarf → Temizlik & Sarf,
   * Demirbaş → Kuruluş & Demirbaş, Hizmet → Hizmet, Deneme → mal alışı). Eski kayıtlarda yok: kalem faturanın kategorisinde
   */
  reason?: NotIngredientReason;
}

/** Saklanan değeri okur; bozuk satırlar atılır, tanınmayan neden düşer */
export function parseIgnored(value: unknown): IgnoredProduct[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (e): e is IgnoredProduct =>
        typeof e === "object" && e !== null && typeof e.productKey === "string" && e.productKey !== "" && typeof e.productName === "string" && typeof e.at === "string",
    )
    .map((e) => {
      const reason = parseReason(e.reason);
      const rest: IgnoredProduct = { productKey: e.productKey, productName: e.productName, at: e.at, ...(typeof e.by === "string" ? { by: e.by } : {}) };
      return reason ? { ...rest, reason } : rest;
    });
}

/** Yeni kayıt başa eklenir; aynı ürünün eski kaydı düşer */
export function addIgnored(list: IgnoredProduct[], added: IgnoredProduct): IgnoredProduct[] {
  return [added, ...list.filter((e) => e.productKey !== added.productKey)].slice(0, IGNORED_PRODUCTS_MAX);
}

export function removeIgnored(list: IgnoredProduct[], productKey: string): IgnoredProduct[] {
  return list.filter((e) => e.productKey !== productKey);
}

// ---------------------------------------------------------------- Tedarikçi kuralı: "hep hammadde değil"

/** Kural listesinde en çok bu kadar tedarikçi */
export const IGNORED_SUPPLIERS_MAX = 200;

/**
 * Tedarikçi bazlı "hep hammadde değil" (sahibin isteği, 25 Kasım 2026): kural açık tedarikçinin hammaddeye bağlı
 * olmayan kalemleri bekleyenlere düşmez ve nedeninin yerine yazılır (ör. temizlik firması → Sarf). Zaten bir hammaddeye
 * bağlı kalem (çay, soda) kuraldan etkilenmez, mal alışı kalır. Ürünün kendi "hammadde değil" nedeni kuraldan önce gelir.
 * Liste integration_state'te (`parasut.supplierIgnore`); tedarikçi adın eşleşme anahtarıyla tanınır
 */
export interface IgnoredSupplier {
  /** supplierMatchKey (parantezli not ve büyük/küçük harf sayılmaz) */
  supplierKey: string;
  supplierName: string;
  reason: NotIngredientReason;
  at: string;
  by?: string;
}

export function parseIgnoredSuppliers(value: unknown): IgnoredSupplier[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((e) => {
    if (typeof e !== "object" || e === null) return [];
    const reason = parseReason(e.reason);
    if (typeof e.supplierKey !== "string" || !e.supplierKey || typeof e.supplierName !== "string" || typeof e.at !== "string" || !reason) return [];
    return [{ supplierKey: e.supplierKey, supplierName: e.supplierName, reason, at: e.at, ...(typeof e.by === "string" ? { by: e.by } : {}) }];
  });
}

export function addIgnoredSupplier(list: IgnoredSupplier[], added: IgnoredSupplier): IgnoredSupplier[] {
  return [added, ...list.filter((e) => e.supplierKey !== added.supplierKey)].slice(0, IGNORED_SUPPLIERS_MAX);
}

export function removeIgnoredSupplier(list: IgnoredSupplier[], supplierKey: string): IgnoredSupplier[] {
  return list.filter((e) => e.supplierKey !== supplierKey);
}

/**
 * Bağlanmamış kalemin "hammadde değil" nedeni: ürünün kendi işareti (nedenliyse onun nedeni, nedensizse null ama yine
 * hammadde değil), yoksa tedarikçinin kuralı. `ignored` false: bekleyen kalem
 */
export function notIngredientOf(
  o: { productKey: string; supplierKey: string },
  products: ReadonlyMap<string, IgnoredProduct>,
  suppliers: ReadonlyMap<string, IgnoredSupplier>,
): { ignored: boolean; reason: NotIngredientReason | null; via: "urun" | "tedarikci" | null } {
  const p = products.get(o.productKey);
  if (p) return { ignored: true, reason: p.reason ?? null, via: "urun" };
  const s = suppliers.get(o.supplierKey);
  if (s) return { ignored: true, reason: s.reason, via: "tedarikci" };
  return { ignored: false, reason: null, via: null };
}

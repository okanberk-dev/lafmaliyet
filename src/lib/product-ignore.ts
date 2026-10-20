// "Hammadde değil" denen Paraşüt ürünleri (kargo, hizmet, ekipman, pompa…): bekleyenler listesinden ve zildeki
// "bağlanmayı bekliyor" sayısından çıkar, listenin altındaki "Hammadde değil" bölümünden geri alınır. Liste
// integration_state'te durur (parasut.productIgnore), yeni tablo yok; bu dosya listenin saf kurallarıdır
// (tests/product-ignore.test.ts).

/** Listede en çok bu kadar ürün tutulur (en yeniler) */
export const IGNORED_PRODUCTS_MAX = 500;

export interface IgnoredProduct {
  productKey: string;
  productName: string;
  /** İşaretlendiği an (ISO) */
  at: string;
  /** İşaretleyen kullanıcının adı */
  by?: string;
}

/** Saklanan değeri okur; bozuk satırlar atılır */
export function parseIgnored(value: unknown): IgnoredProduct[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is IgnoredProduct =>
      typeof e === "object" && e !== null && typeof e.productKey === "string" && e.productKey !== "" && typeof e.productName === "string" && typeof e.at === "string",
  );
}

/** Yeni kayıt başa eklenir; aynı ürünün eski kaydı düşer */
export function addIgnored(list: IgnoredProduct[], added: IgnoredProduct): IgnoredProduct[] {
  return [added, ...list.filter((e) => e.productKey !== added.productKey)].slice(0, IGNORED_PRODUCTS_MAX);
}

export function removeIgnored(list: IgnoredProduct[], productKey: string): IgnoredProduct[] {
  return list.filter((e) => e.productKey !== productKey);
}

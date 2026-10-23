/**
 * Ürünlerin varsayılan zayi (fire) oranları: kategori ortalamaları (sahibinin verdiği: kahve %5, tatlı %20, çay %40;
 * diğerleri kafe sektörü ortalamaları). drizzle/0012_zayi_oranlari.sql bunları yalnız o gün veritabanında olan ürünlere
 * yazdı; Excel'den yeniden yüklenen ürünler (boş veritabanı, npm run db:reset) oranları kaybediyor, her ürün genel %5'e
 * düşüyordu: tatlının maliyeti 15, çayınki 35 puan eksik çıkıyordu. Seed (scripts/seed.ts) Excel'de oranı boş ürünlere
 * bunları yazar. Ürün kartından ürün ürün değiştirilebilir. Saf: tests/zayi-oranlari.test.ts (migration'la aynı mı).
 *
 * Kurallar migration'daki sırayla uygulanır: sonraki öncekinin üstüne yazar (Çay ürünü, Atıştırmalıklar'da sandviç
 * olmayanlar).
 */
export interface FireRule {
  /** Ürünün kategorisi bunlardan biriyse */
  categories?: readonly string[];
  /** Ürünün adı tam buysa */
  product?: string;
  /** Adında bu geçmiyorsa (büyük-küçük harf gözetilmez) */
  exceptNameLike?: string;
  rate: number;
}

export const FIRE_DEFAULTS: readonly FireRule[] = [
  { categories: ["Espresso Bazlı", "Buzlu Kahveler", "Frappe", "Ekstralar"], rate: 0.05 },
  { categories: ["Tatlılar"], rate: 0.2 },
  { categories: ["Ice Tea"], rate: 0.4 },
  { categories: ["Smoothie", "Frozen", "Soğuk İçecekler"], rate: 0.1 },
  { categories: ["Sıcak İçecekler", "Strawberry Aşkı"], rate: 0.08 },
  { product: "Çay", rate: 0.4 },
  { categories: ["Şişe İçecekler"], rate: 0.02 },
  { categories: ["Atıştırmalıklar"], rate: 0.15 },
  { categories: ["Atıştırmalıklar"], exceptNameLike: "sandviç", rate: 0.03 },
];

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Ürünün varsayılan oranı; hiçbir kural tutmazsa null (genel ayardaki oran geçerli) */
export function defaultFireRate(product: { name: string }, category: string | null | undefined): number | null {
  let rate: number | null = null;
  for (const r of FIRE_DEFAULTS) {
    if (r.product !== undefined && r.product !== product.name) continue;
    if (r.categories && !(category && r.categories.includes(category))) continue;
    if (r.exceptNameLike && lower(product.name).includes(lower(r.exceptNameLike))) continue;
    rate = r.rate;
  }
  return rate;
}

/** Excel'de oranı boş ürünlere varsayılanı yazar (Excel'de yazılı oran kalır) */
export function withFireDefaults<P extends { name: string; categoryId: number; fireOverride: number | null }>(
  products: readonly P[],
  categories: readonly { id: number; name: string }[],
): P[] {
  const name = new Map(categories.map((c) => [c.id, c.name]));
  return products.map((p) => (p.fireOverride === null ? { ...p, fireOverride: defaultFireRate(p, name.get(p.categoryId)) } : p));
}

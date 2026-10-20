// QR menü satırları (saf; sayfa ve testler kullanır). Kategoride boylu ürün varsa iki fiyat sütunu (Medium, Large),
// yoksa tek fiyat. Tek boylu ürün boylu bir kategoride Medium sütununda görünür; olmayan fiyat null ("–").

import { num } from "@/lib/format";

export type MenuSize = { size: string; price: number };
export type MenuItem = { name: string; sizes: MenuSize[] };

/** Fiyat: "1.250 ₺" (₺ satır başına tek düşmesin diye bölünmez boşlukla) */
export const menuPrice = (v: number) => `${num(v)} ₺`;

/** Kategoride Medium / Large sütunları gerekir mi (tek boydan farklı en az bir ürün) */
export const hasSizeColumns = (items: MenuItem[]) => items.some((i) => i.sizes.some((s) => s.size !== "Tek"));

/** Satırın fiyat hücreleri: iki sütunlu kategoride [Medium, Large], tek sütunlu kategoride [fiyat] */
export function menuPrices(item: MenuItem, sized: boolean): (string | null)[] {
  const m = item.sizes.find((s) => s.size === "M");
  const l = item.sizes.find((s) => s.size === "L");
  const t = item.sizes.find((s) => s.size === "Tek");
  if (sized) return [m ? menuPrice(m.price) : t ? menuPrice(t.price) : null, l ? menuPrice(l.price) : null];
  const one = t ?? m;
  return [one ? menuPrice(one.price) : null];
}

import { INGREDIENT_CATEGORIES } from "@/lib/constants";

/** Hammadde kategorilerinin sabit sırası (bilinmeyenler sona) */
export const catOrder = (c: string) => {
  const i = INGREDIENT_CATEGORIES.indexOf(c);
  return i < 0 ? 99 : i;
};

export const sortCategories = (list: Iterable<string>) => [...new Set(list)].sort((a, b) => catOrder(a) - catOrder(b));

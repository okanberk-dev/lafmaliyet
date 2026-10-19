import "server-only";

import { asc } from "drizzle-orm";

import { SIZE_LABELS } from "@/lib/constants";
import { getDb, schema as s } from "@/server/db";

export interface SearchEntry {
  kind: "product" | "ingredient";
  label: string;
  hint: string;
  href: string;
}

/** Komut paletinin (⌘K) ürün ve hammadde listesi: yalnızca adlar, maliyet bilgisi yok */
export async function loadSearchIndex(): Promise<SearchEntry[]> {
  const db = getDb();
  const [products, ingredients] = await Promise.all([
    db
      .select({ id: s.products.id, name: s.products.name, size: s.products.size, active: s.products.active })
      .from(s.products)
      .orderBy(asc(s.products.sortOrder), asc(s.products.id)),
    db.select({ name: s.ingredients.name, category: s.ingredients.category }).from(s.ingredients).orderBy(asc(s.ingredients.sortOrder)),
  ]);
  return [
    ...products.map((p) => ({
      kind: "product" as const,
      label: p.size === "Tek" ? p.name : `${p.name} · ${SIZE_LABELS[p.size as keyof typeof SIZE_LABELS] ?? p.size}`,
      hint: p.active ? "Ürün" : "Ürün · pasif",
      href: `/panel/urunler/${p.id}`,
    })),
    ...ingredients.map((i) => ({
      kind: "ingredient" as const,
      label: i.name,
      hint: i.category ? `Hammadde · ${i.category}` : "Hammadde",
      href: `/panel/hammaddeler?ara=${encodeURIComponent(i.name)}`,
    })),
  ];
}

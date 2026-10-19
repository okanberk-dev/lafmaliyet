import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

import { loadSettings } from "./dataset";

export interface PublicMenu {
  published: boolean;
  categories: { id: number; name: string; items: { name: string; sizes: { size: string; price: number }[] }[] }[];
}

const SIZE_ORDER = { M: 0, L: 1, Tek: 2 } as Record<string, number>;

/** QR menü için yalnızca ad, boy ve satış fiyatı (maliyet bilgisi asla çıkmaz). */
export async function loadPublicMenu(): Promise<PublicMenu> {
  const db = getDb();
  const [settings, categories, products] = await Promise.all([
    loadSettings(),
    db.select().from(s.categories).orderBy(asc(s.categories.sortOrder)),
    db
      .select({ name: s.products.name, size: s.products.size, price: s.products.price, categoryId: s.products.categoryId, sortOrder: s.products.sortOrder })
      .from(s.products)
      .where(and(eq(s.products.active, true), eq(s.products.showOnMenu, true)))
      .orderBy(asc(s.products.sortOrder), asc(s.products.id)),
  ]);
  return {
    published: settings.publicMenu,
    categories: categories
      .map((c) => {
        const byName = new Map<string, { size: string; price: number }[]>();
        for (const p of products.filter((x) => x.categoryId === c.id)) {
          const list = byName.get(p.name) ?? [];
          list.push({ size: p.size, price: p.price });
          byName.set(p.name, list);
        }
        return {
          id: c.id,
          name: c.name,
          items: [...byName.entries()].map(([name, sizes]) => ({ name, sizes: sizes.sort((a, b) => SIZE_ORDER[a.size] - SIZE_ORDER[b.size]) })),
        };
      })
      .filter((c) => c.items.length),
  };
}

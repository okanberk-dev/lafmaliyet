import "server-only";

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import { countFactor } from "@/lib/calc/engine";
import type { DayWaste } from "@/lib/cash-report";
import { productLabel, summarize, type WasteChoice, type WasteKind, type WasteLine } from "@/lib/waste";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

/**
 * Zayi / ikram için seçilebilen kalemler: aktif menü ürünleri (adet) ve aktif hammaddeler (sayım biriminde, yoksa
 * kendi biriminde). Fiyat ya da maliyet taşımaz (personel de görür).
 */
export async function wasteChoices(): Promise<WasteChoice[]> {
  const db = getDb();
  const [products, categories, ingredients] = await Promise.all([
    db
      .select({ id: s.products.id, name: s.products.name, size: s.products.size, categoryId: s.products.categoryId })
      .from(s.products)
      .where(eq(s.products.active, true))
      .orderBy(asc(s.products.sortOrder), asc(s.products.id)),
    db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories),
    db
      .select({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, countUnit: s.ingredients.countUnit, category: s.ingredients.category })
      .from(s.ingredients)
      .where(eq(s.ingredients.active, true))
      .orderBy(asc(s.ingredients.sortOrder), asc(s.ingredients.id)),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  return [
    ...products.map((p) => ({ type: "product" as const, id: p.id, name: productLabel(p), unit: "adet", factor: 1, group: catName.get(p.categoryId) ?? "Ürün" })),
    ...ingredients.map((i) => ({
      type: "ingredient" as const,
      id: i.id,
      name: i.name,
      unit: i.countUnit ?? i.unit,
      factor: i.countUnit ? countFactor(i.countUnit) : 1,
      group: i.category,
    })),
  ];
}

export interface WasteEntryDTO extends WasteLine {
  id: number;
  date: string;
  type: "product" | "ingredient";
  productId: number | null;
  ingredientId: number | null;
  factor: number;
  reason: string | null;
  note: string | null;
  createdBy: number | null;
  createdByName: string;
  createdAt: string;
}

export async function wasteEntriesBetween(from: string, to: string): Promise<WasteEntryDTO[]> {
  const rows = await getDb()
    .select()
    .from(s.wasteEntries)
    .where(and(gte(s.wasteEntries.date, from), lte(s.wasteEntries.date, to)))
    .orderBy(desc(s.wasteEntries.date), desc(s.wasteEntries.id))
    .limit(2000);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    kind: r.kind as WasteKind,
    type: r.ingredientId !== null && r.productId === null ? "ingredient" : "product",
    productId: r.productId,
    ingredientId: r.ingredientId,
    factor: r.factor,
    name: r.name,
    qty: r.qty,
    unit: r.unit,
    reason: r.reason,
    note: r.note,
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Kasa raporu için günün zayi ve ikram özeti ve ikramın menü fiyatıyla değeri (ModPOS'un ödenmez tutarıyla
 * karşılaştırılır; yalnız yöneticiye giden e-postada).
 */
export async function dayWaste(date: string): Promise<DayWaste & { ikramValue: number; count: number }> {
  const db = getDb();
  const [entries, prices] = await Promise.all([
    wasteEntriesBetween(date, date),
    db.select({ id: s.products.id, price: s.products.price }).from(s.products),
  ]);
  const price = new Map(prices.map((p) => [p.id, p.price]));
  const ikramValue = entries.filter((e) => e.kind === "ikram" && e.productId !== null).reduce((a, e) => a + (price.get(e.productId!) ?? 0) * e.qty, 0);
  return { zayi: summarize(entries, "zayi"), ikram: summarize(entries, "ikram"), ikramValue: Math.round(ikramValue * 100) / 100, count: entries.length };
}

type Db = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Kaydın kalemi: ürün (adet, adı boyuyla "Latte M") ya da hammadde (sayım biriminde, yoksa kendi biriminde). Doğrudan
 * kayıt ve geç kayıt isteği kalemin etkin olmasını ister (`requireActive`); geç kaydın onayı istemez (kalem istek
 * anında etkindi) ama adı istekteki adla aynı olmalı. Ürün adetle girilir.
 */
export async function resolveWasteTarget(
  db: Db,
  data: { productId: number | null; ingredientId: number | null; qty: number },
  o: { requireActive: boolean } = { requireActive: true },
): Promise<{ name: string; unit: string; factor: number }> {
  if (data.productId !== null) {
    const [p] = await db.select({ name: s.products.name, size: s.products.size, active: s.products.active }).from(s.products).where(eq(s.products.id, data.productId)).limit(1);
    if (!p || (o.requireActive && !p.active)) throw new UserError("Ürün bulunamadı (sayfayı yenileyin)");
    if (!Number.isInteger(data.qty)) throw new UserError("Ürün adetle girilir (ör. 2)");
    return { name: productLabel(p), unit: "adet", factor: 1 };
  }
  if (data.ingredientId === null) throw new UserError("Bir ürün ya da bir hammadde seçin");
  const [i] = await db
    .select({ name: s.ingredients.name, unit: s.ingredients.unit, countUnit: s.ingredients.countUnit, active: s.ingredients.active })
    .from(s.ingredients)
    .where(eq(s.ingredients.id, data.ingredientId))
    .limit(1);
  if (!i || (o.requireActive && !i.active)) throw new UserError("Hammadde bulunamadı (sayfayı yenileyin)");
  return i.countUnit ? { name: i.name, unit: i.countUnit, factor: countFactor(i.countUnit) } : { name: i.name, unit: i.unit, factor: 1 };
}

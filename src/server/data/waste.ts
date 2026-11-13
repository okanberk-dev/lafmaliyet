import "server-only";

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import { countFactor } from "@/lib/calc/engine";
import type { DayWaste } from "@/lib/cash-report";
import { lafposDayKey, panelWasteCounts } from "@/lib/lafpos/ikram";
import { productLabel, summarize, type WasteChoice, type WasteKind, type WasteLine } from "@/lib/waste";
import { currentBranchWhere } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

import { loadDayLafposIkram } from "./lafpos-ikram";

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
  /** Kaydın fiziksel şubesi (zayi şube başına; docs/SUBE.md) */
  branchId: string;
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

/**
 * Aralığın zayi ve ikram kayıtları, seçili şubenin ("Tümü"de hepsi; denetim ST-02): Marina seçiliyken Tuzla'nın kaydı
 * gün listesine, ay özetine ve kasa raporuna girmez. Tek şubenin okuması (Zayi'nin günü, kasa raporu) `withBranchScope`
 * içinde çağırır.
 */
export async function wasteEntriesBetween(from: string, to: string): Promise<WasteEntryDTO[]> {
  const rows = await getDb()
    .select()
    .from(s.wasteEntries)
    .where(and(gte(s.wasteEntries.date, from), lte(s.wasteEntries.date, to), await currentBranchWhere(s.wasteEntries.branchId)))
    .orderBy(desc(s.wasteEntries.date), desc(s.wasteEntries.id))
    .limit(2000);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    branchId: r.branchId,
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

/** Günün LafPOS ikramı (kasa raporunun özeti; LafPOS günü değilse null) */
export interface DayWasteLafpos {
  /** O günün gün sonu geldi: ürün ikramı LafPOS'tan, paneldeki ürün ikramı sayılmaz */
  received: boolean;
  /** LafPOS'un Z'sindeki ödenmez tutarı (yalnız yöneticinin e-postası) */
  offRevenue: number | null;
  /** LafPOS'un ikram satırlarının (ödenmez dahil) menü değeri */
  ikramValue: number;
  /** LafPOS'ta zayi yazılan satırların menü değeri */
  zayiValue: number;
  /** LafPOS'un listesinin tamamı (ikram + zayi): Z'deki ödenmez tutarı bunu kapsar (lafposIkramCheck) */
  listValue: number;
  /** Panele bu güne girilmiş, sayılmayan ürün ikramı kaydı */
  notCounted: number;
}

/**
 * Kasa raporu için günün zayi ve ikram özeti ve ikramın menü fiyatıyla değeri (kasanın ödenmez tutarıyla
 * karşılaştırılır; yalnız yöneticiye giden e-postada). LafPOS gününde gün sonu geldiyse ürün ikramı LafPOS'un ikram
 * listesinden, değeri LafPOS'un menü değerinden; listedeki "Zayi: …" satırları zayi özetine girer; paneldeki ürün
 * ikramı sayılmaz (`lafpos.notCounted`). Geçiş günü boşken ya da şubenin kasası LafPOS değilken `lafpos` null, özet
 * bugünkü gibi yalnız panelden. Tek şubenin özeti: çağıran raporun şubesiyle `withBranchScope` içinde okur (denetim
 * ST-02; kasa formu, e-posta, WhatsApp, personelin Bugün'ü).
 */
export async function dayWaste(date: string): Promise<DayWaste & { ikramValue: number; count: number; lafpos: DayWasteLafpos | null }> {
  const db = getDb();
  const [entries, prices, laf] = await Promise.all([
    wasteEntriesBetween(date, date),
    db.select({ id: s.products.id, price: s.products.price }).from(s.products),
    loadDayLafposIkram(date),
  ]);
  const price = new Map(prices.map((p) => [p.id, p.price]));
  const received = Boolean(laf?.received);
  // Gün sonu yalnız kendi şubesinin panel kaydını düşürür (lafposDayKey)
  const counted = entries.filter((e) => panelWasteCounts(e, received ? new Set([lafposDayKey(date, laf!.branchId)]) : new Set<string>()));
  // LafPOS'un satırları kendi türüyle: "Zayi: …" zayi, öteki (ödenmez dahil) ikram
  const lafLines: WasteLine[] = received ? laf!.lines.map((l) => ({ kind: l.kind, name: l.name, qty: l.qty, unit: "adet" })) : [];
  const lines = [...counted, ...lafLines];
  const valueOf = (kind: WasteKind) => Math.round((laf?.lines.filter((l) => l.kind === kind).reduce((a, l) => a + l.menuValue, 0) ?? 0) * 100) / 100;
  const lafIkram = valueOf("ikram");
  const lafZayi = valueOf("zayi");
  const panelValue = counted.filter((e) => e.kind === "ikram" && e.productId !== null).reduce((a, e) => a + (price.get(e.productId!) ?? 0) * e.qty, 0);
  const ikramValue = Math.round((panelValue + (received ? lafIkram : 0)) * 100) / 100;
  return {
    zayi: summarize(lines, "zayi"),
    ikram: summarize(lines, "ikram"),
    ikramValue,
    count: lines.length,
    lafpos: laf
      ? {
          received,
          offRevenue: laf.offRevenue,
          ikramValue: lafIkram,
          zayiValue: lafZayi,
          listValue: Math.round((lafIkram + lafZayi) * 100) / 100,
          notCounted: entries.length - counted.length,
        }
      : null,
  };
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

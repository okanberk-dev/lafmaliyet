import { and, count, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";

import { COMMISSION_CATEGORY } from "@/lib/constants";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * "Kategorisi doğru, kalsın" denmiş stoğa giren faturalar (kimlik listesi, integration_state): kalemleri hammaddeye
 * bağlı ama bilerek mal alışı sayılmıyor (çoğu temizlik malzemesi, bir kalemi süt olan market faturası). Bunlar yeniden
 * kontrole düşmez; kategorisi değişince listeden çıkar (karar o kategori içindi).
 */
export const STOCK_ONLY_ACCEPTED_KEY = "invoices.stockOnlyAccepted";

/**
 * Stoğa girip gelir-gidere girmeyen fatura (denetim 26 Eki, E-07): kalemlerinden biri hammaddeye bağlı (alınan miktar,
 * FIFO partisi ve hammadde fiyatı ondan gelir) ama o kalem mal alışı sayılmıyor. 25 Kasım 2026'dan beri faturalar kalem
 * kalem sayılır (src/lib/invoice-split.ts): hammaddeye bağlı kalem kategorisi ne olursa olsun mal alışıdır (Diğer,
 * Hizmet, Temizlik & Sarf dahil), elle düzeltme gerekmez. Bölünmeyen yalnız komisyon faturası kaldı (kafe dışı faturanın
 * kalemleri stoğa zaten girmez). Yalnız `invoices` üzerinden sorgularda (dış sorguda fatura kalemi birleştirilmemiş olmalı).
 */
export function stockOnlyWhere(): SQL {
  const bl = s.parasutBillLines;
  const ln = s.parasutProductLinks;
  return and(
    eq(s.invoices.category, COMMISSION_CATEGORY),
    sql`exists (select 1 from ${bl} join ${ln} on ${ln.productKey} = ${bl.productKey} where ${bl.invoiceId} = ${s.invoices.id})`,
  )!;
}

/** "Kategorisi doğru, kalsın" denmiş faturalar */
export async function acceptedStockOnly(db: DB | Tx): Promise<Set<number>> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, STOCK_ONLY_ACCEPTED_KEY)).limit(1);
  const list = Array.isArray(row?.value) ? (row.value as unknown[]) : [];
  return new Set(list.filter((x): x is number => Number.isInteger(x)));
}

/** Listeye ekler ya da çıkarır; satır kilitli (iki sekme aynı anda değiştirince biri ötekini ezmesin) */
export async function updateAcceptedStockOnly(db: DB, change: { add?: readonly number[]; remove?: readonly number[] }) {
  if (!change.add?.length && !change.remove?.length) return;
  await db.transaction(async (tx) => {
    await tx.insert(s.integrationState).values({ key: STOCK_ONLY_ACCEPTED_KEY, value: [] }).onConflictDoNothing();
    const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, STOCK_ONLY_ACCEPTED_KEY)).for("update").limit(1);
    const set = new Set((Array.isArray(row?.value) ? (row.value as unknown[]) : []).filter((x): x is number => Number.isInteger(x)));
    for (const id of change.add ?? []) set.add(id);
    for (const id of change.remove ?? []) set.delete(id);
    const value = [...set].sort((a, b) => a - b);
    await tx.update(s.integrationState).set({ value, updatedAt: new Date() }).where(eq(s.integrationState.key, STOCK_ONLY_ACCEPTED_KEY));
  });
}

/** Verilen (ya da bütün) faturalardan stoğa girip gelir-gidere girmeyenler; "kalsın" denenler dahil */
export async function stockOnlyIds(db: DB | Tx, ids?: readonly number[]): Promise<number[]> {
  if (ids && !ids.length) return [];
  const rows = await db
    .select({ id: s.invoices.id })
    .from(s.invoices)
    .where(and(stockOnlyWhere(), ids ? inArray(s.invoices.id, [...ids]) : undefined));
  return rows.map((r) => r.id);
}

/**
 * Stoğa girip gelir-gidere girmeyen her faturanın kontrol beklemesi (needsReview): "kalsın" denmemişse işaretlenir.
 * Eşitleme (alınan miktarla birlikte), ürün bağlama, kategori değişikliği ve onay sonrası çağrılır; yeni işaretlenenler
 * döner (işlem geçmişi, Paraşüt sayfasının bildirimi). `ids` verilirse yalnız onlara bakılır.
 */
export async function flagStockOnlyInvoices(db: DB, ids?: readonly number[]): Promise<{ id: number; supplier: string; invoiceNo: string | null; date: string }[]> {
  if (ids && !ids.length) return [];
  const accepted = [...(await acceptedStockOnly(db))];
  return db
    .update(s.invoices)
    .set({ needsReview: true })
    .where(
      and(
        eq(s.invoices.needsReview, false),
        stockOnlyWhere(),
        ids ? inArray(s.invoices.id, [...ids]) : undefined,
        accepted.length ? notInArray(s.invoices.id, accepted) : undefined,
      ),
    )
    .returning({ id: s.invoices.id, supplier: s.invoices.supplier, invoiceNo: s.invoices.invoiceNo, date: s.invoices.date });
}

/** Kontrol bekleyen ve stoğa girip gelir-gidere girmeyen fatura sayısı (zil, Bugün) */
export async function countStockOnlyReview(db: DB | Tx): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(s.invoices)
    .where(and(eq(s.invoices.needsReview, true), stockOnlyWhere()));
  return row?.n ?? 0;
}

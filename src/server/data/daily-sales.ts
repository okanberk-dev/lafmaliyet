import "server-only";

import { and, asc, gte, lte } from "drizzle-orm";

import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Kasanın günlük ürün satışı (docs/planlar/CRITIQUE2.md R18): gün gün ürün dökümü. ModPOS'un dökümü hiç gelmedi; ağzı
 * LafPOS doldurur: her iş gününün satış listesi gün sonunda `POST /api/pos/gun` ile gelir ve `pos_daily_sales`'e yazılır
 * (docs/LAFPOS.md). Aralıkta satır yoksa null döner ve her okuyan aylık veriye (sales_lines, ay ay) düşer: mal
 * siparişinin tüketimi, satış tahmininin günlük toplamları ve tatlı payı, karaoke doluluğunun kasadan ödenen karaokesi.
 * Okuyanlar günlük veriye ne zaman geçeceğine kendisi karar verir (plan: son 28 günün en az 14'ü); bu ağız yalnız okur.
 */

/** Bir iş gününde (İstanbul, gün 05:00'te döner) bir kasa satırı: sales_lines'ın günlük karşılığı */
export interface DailyProductSale {
  /** İş günü, YYYY-MM-DD */
  date: string;
  /** Kasadaki ürün adı (LafPOS'un POS adı) */
  posName: string;
  /** Eşleşen menü ürünü (sitenin kalemi ya da POS eşleştirmesi); eşleşmeyende null */
  productId: number | null;
  qty: number;
  /** Kasanın yazdığı satış tutarı (TL, KDV dahil) */
  revenue: number;
  /** Hizmet satırı (karaoke kişi başı / toplu): ürün değil, reçetesi yok */
  isService: boolean;
}

/** `from`–`to` satırları (iki uç dahil), güne ve POS adına göre; satır yoksa null. Veritabanını parametre alır (testler) */
export async function dailyProductSalesFrom(db: DB, from: string, to: string): Promise<DailyProductSale[] | null> {
  if (from > to) return null;
  const t = s.posDailySales;
  const rows = await db
    .select({ date: t.date, posName: t.posName, productId: t.productId, qty: t.qty, revenue: t.revenue, isService: t.isService })
    .from(t)
    .where(and(gte(t.date, from), lte(t.date, to)))
    .orderBy(asc(t.date), asc(t.posName));
  return rows.length ? rows : null;
}

/**
 * `from`–`to` (iki uç dahil, YYYY-MM-DD) arasındaki günlerin satırları. `null`: aralıkta günlük veri yok, aylık veriye
 * düşün. Satırı olmayan gün ya gelmemiş ya da kafe kapalıdır (ya da gün hiç satışsız kapandı); kapsamayı okuyan satırların
 * günlerinden çıkarır.
 */
export async function loadDailyProductSales(from: string, to: string): Promise<DailyProductSale[] | null> {
  return dailyProductSalesFrom(getDb(), from, to);
}

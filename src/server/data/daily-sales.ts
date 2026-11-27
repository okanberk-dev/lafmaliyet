import "server-only";

import { and, asc, eq, gte, lte } from "drizzle-orm";

import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Kasanın günlük ürün satışı (docs/planlar/CRITIQUE2.md R18): gün gün ürün dökümü. ModPOS'un dökümü hiç gelmedi; ağzı
 * AsilPOS doldurur: her iş gününün satış listesi gün sonunda `POST /api/pos/gun` ile gelir ve `pos_daily_sales`'e yazılır
 * (docs/ASILPOS.md). Aylık maliyet modeli bu satırları geçiş gününden itibaren ay toplamı olarak okur
 * (src/server/data/asilpos-sales.ts; Satışlar, Tutarlılık, Ürünler, Analiz, Genel bakış, tatlı payı).
 * Satırları gün gün okuyan bugün yok (satış tahmini 4 Kasım 2026'da kalktı). Günlük pencereye geçecek okuyucu (ör. hafta gününe göre tatlı oranı) bu
 * ağızdan okur ve geçiş gününden önceki deneme günlerini kendisi ayırır (isAsilposDay, src/lib/asilpos/switch.ts): ağız
 * bütün günleri döner. Aralıkta satır yoksa null.
 */

/** Bir iş gününde (İstanbul, gün 05:00'te döner) bir kasa satırı: sales_lines'ın günlük karşılığı */
export interface DailyProductSale {
  /** İş günü, YYYY-MM-DD */
  date: string;
  /** Kasadaki ürün adı (AsilPOS'un POS adı) */
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

/** Şubenin günlük satırı ve Faz 2 alanları (asistanın gunluk_satislar aracı) */
export interface BranchDailySale extends DailyProductSale {
  /** Satırın liste değeri, indirimden önce (TL, KDV dahil); eski AsilPOS göndermez: null */
  gross: number | null;
  /** Birleşen satırda ek parça var (EXTRA SHOT, SYRUP, ALTERNATIF SÜT) */
  isAddon: boolean;
}

/**
 * Tek şubenin `from`–`to` satırları (iki uç dahil), güne ve POS adına göre; satır yoksa boş dizi. dailyProductSalesFrom
 * şubeye bakmaz; bu okuyucu şube koşulunu ve Faz 2 alanlarını ekler (panel asistanı; src/server/assistant-reads).
 * Geçiş gününden önceki deneme günlerini ayırmak okuyanın işidir (isAsilposDay). Yalnız okur.
 */
export async function dailyBranchSalesFrom(db: Pick<DB, "select">, from: string, to: string, branchId: string): Promise<BranchDailySale[]> {
  if (from > to) return [];
  const t = s.posDailySales;
  return db
    .select({ date: t.date, posName: t.posName, productId: t.productId, qty: t.qty, revenue: t.revenue, isService: t.isService, gross: t.gross, isAddon: t.isAddon })
    .from(t)
    .where(and(gte(t.date, from), lte(t.date, to), eq(t.branchId, branchId)))
    .orderBy(asc(t.date), asc(t.posName));
}

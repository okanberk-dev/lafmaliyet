import "server-only";

/**
 * ModPOS'un günlük ürün satışı (docs/planlar/CRITIQUE2.md R18): kasanın gün gün ürün dökümü. Henüz yok: ModPOS
 * dökümü hazırlıyor (sahibin cevabı); örnek dosya gelince yazılacak içe aktarma bu ağzı doldurur. O zamana kadar her
 * okuyan aylık veriye (sales_lines, ay ay) düşer: mal siparişinin tüketimi, satış tahmininin günlük toplamları ve tatlı
 * payı, karaoke doluluğunun kasadan ödenen karaokesi. Şimdilik kimse okumuyor.
 */

/** Bir iş gününde (İstanbul, gün 05:00'te döner) bir ModPOS satırı: sales_lines'ın günlük karşılığı */
export interface DailyProductSale {
  /** İş günü, YYYY-MM-DD */
  date: string;
  /** ModPOS'taki ürün adı */
  posName: string;
  /** Eşleşen menü ürünü (POS eşleştirmesi); eşleşmeyende null */
  productId: number | null;
  qty: number;
  /** ModPOS'un yazdığı satış tutarı (TL, KDV dahil) */
  revenue: number;
  /** Hizmet satırı (karaoke kişi başı / toplu): ürün değil, reçetesi yok */
  isService: boolean;
}

/**
 * `from`–`to` (iki uç dahil, YYYY-MM-DD) arasındaki günlerin satırları. `null`: günlük veri yok, aylık veriye düşün
 * (bugün hep). Aktarım geldiğinde satırı olmayan gün ya aktarılmamış ya da kafe kapalıdır; kapsamayı okuyan satırların
 * günlerinden çıkarır.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ağız: aralığı içe aktarma gelince okur
export async function loadDailyProductSales(from: string, to: string): Promise<DailyProductSale[] | null> {
  return null;
}

/**
 * Ürünü silmenin engeli (saf; sunucu eylemi ve reçete kartı paylaşır; tests/urunler.test.ts). Satışı (ModPOS listesi ya
 * da AsilPOS'un günlük satırı), zayi / ikram kaydı, fiyat geçmişi ya da online satışı olan ürün silinmez: silinirse
 * geçmiş ayların satış satırları eşleşmesiz kalır ve ortalama maliyet oranıyla hesaplanır (kapanmış ayların maliyeti ve
 * kârı değişir; AsilPOS satırının ürün bağı veritabanında sessizce kopar, denetim E-34), zayi kaydı değerlenemez, fiyat
 * geçmişi kaybolur. Hammadde ve personel de aynı nedenle silinmez (deleteIngredient, staffDeleteBlockers); menüden
 * kaldırmanın yolu "Menüde aktif" anahtarıdır.
 */

export interface ProductHistoryCounts {
  /** Satışlar'daki (ModPOS) eşlenmiş satış satırı */
  salesLines: number;
  /**
   * AsilPOS'un bu ürüne bağlı günlük satış satırı (pos_daily_sales; geçiş gününden önceki deneme günleri dahil: bağ
   * koparsa o günler sayılmaya başladığında ürünsüz kalırdı)
   */
  posDailySales: number;
  /** Zayi ve ikram kaydı */
  waste: number;
  /** Fiyat geçmişi: ilk kayıt ("create") dışındaki değişiklikler */
  priceChanges: number;
  /** Satırları bu ürüne eşlenen laffogato.net online satış ayı */
  onlineMonths: number;
}

export function productDeleteBlocker(c: ProductHistoryCounts): string | null {
  const parts = [
    c.salesLines ? `${c.salesLines} satış satırı` : "",
    c.posDailySales ? `${c.posDailySales} AsilPOS günlük satış satırı` : "",
    c.onlineMonths ? `${c.onlineMonths} ayda online satış` : "",
    c.waste ? `${c.waste} zayi / ikram` : "",
    c.priceChanges ? `${c.priceChanges} fiyat değişikliği` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return `Bu ürünün ${parts.join(", ")} kaydı var; silinirse geçmiş ayların maliyeti ve kârı değişir, fiyat geçmişi kaybolur. Silmek yerine “Menüde aktif” anahtarını kapatıp kaydedin.`;
}

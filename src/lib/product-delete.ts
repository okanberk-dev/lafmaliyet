/**
 * Ürünü silmenin engeli (saf; sunucu eylemi ve reçete kartı paylaşır; tests/urunler.test.ts). Satışı, zayi / ikram
 * kaydı, fiyat geçmişi ya da online satışı olan ürün silinmez: silinirse geçmiş ayların satış satırları eşleşmesiz
 * kalır ve ortalama maliyet oranıyla hesaplanır (kapanmış ayların maliyeti ve kârı değişir), zayi kaydı değerlenemez,
 * fiyat geçmişi kaybolur. Hammadde ve personel de aynı nedenle silinmez (deleteIngredient, staffDeleteBlockers);
 * menüden kaldırmanın yolu "Menüde aktif" anahtarıdır.
 */

export interface ProductHistoryCounts {
  /** Satışlar'daki (ModPOS) eşlenmiş satış satırı */
  salesLines: number;
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
    c.onlineMonths ? `${c.onlineMonths} ayda online satış` : "",
    c.waste ? `${c.waste} zayi / ikram` : "",
    c.priceChanges ? `${c.priceChanges} fiyat değişikliği` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return `Bu ürünün ${parts.join(", ")} kaydı var; silinirse geçmiş ayların maliyeti ve kârı değişir, fiyat geçmişi kaybolur. Silmek yerine “Menüde aktif” anahtarını kapatıp kaydedin.`;
}

/**
 * Alınan miktar satırlarının ayırt edici notları. Hesap kodu (src/lib/calc/insights.ts: elle yazılan alım şüpheli
 * faturanın işaretini kaldırır) ve istemci tablosu da okur; sunucu dosyasına (src/server/parasut/constants.ts) bağlı
 * kalmasın diye burada, o dosya buradan yeniden dışa aktarır.
 */

/** Paraşüt kaynaklı alınan miktar satırlarının tam notu (yalnızca bu satırlar eşitlemeye aittir) */
export const MANAGED_QTY_NOTE = "Paraşüt faturalarından";
/**
 * Tutarlılık'ta "Alım yok (0)" ile yazılan alınan miktar satırının notu: o ay faturası olmayan malzeme için 0. Elle
 * girilmiş sayılmaz; o ay için faturası sonradan gelirse eşitleme yerine faturadaki miktarı yazar (recomputePurchaseQuantities)
 */
export const NO_PURCHASE_NOTE = "Bu ay alım yok";

-- Sayım listesine fiyatıyla eklenen kalemlerin fiyat geçmişine başlangıç satırı. "Listeye ekle" (ve reçete önerisinin
-- "Yeni malzeme"si) kalemi yazılan paket fiyatıyla açıyor ama fiyat geçmişine satır yazmıyordu; hesap kapanmış ayın
-- devreden malını ilk geçmiş satırının fiyatıyla değerlediği için sonraki ilk zam (fatura, elle) geçmiş ayın kârını
-- değiştiriyordu. Uygulama artık bu satırı kalemi açarken yazar (src/lib/count-item.ts countItemPriceRow); bu migration
-- daha önce eklenmiş, geçmişi hiç olmayan elle fiyatlı ve fiyatı yazılmış sayım kalemlerine aynı satırı bugünkü
-- fiyatla yazar.
-- Uygulanınca hiçbir sayı değişmez: tek satırlı geçmiş her ay için kalemin bugünkü fiyatını verir (satır yokkenki gibi);
-- yalnız bundan sonraki zam geçmiş ayları değiştirmez. Yeniden çalışırsa bir şey eklemez (geçmişi olan kaleme
-- yazmaz). Zam uyarısı bu satırı notundan tanır ve taban saymaz (src/lib/calc/price-impact.ts ingredientChanges);
-- sekiz kalemin migration'ındaki "Sayım listesine eklendi (tahmini fiyat)" satırları taban kalır. Hammaddeler, Excel
-- aktarımı ve sekiz kalem migration'ı kalemi geçmiş satırıyla açar: eşleşen yalnız sayım listesinden eklenenlerdir.
INSERT INTO "ingredient_prices" ("ingredient_id", "package_price", "package_size", "note", "changed_by")
SELECT i."id", i."package_price", i."package_size", 'Sayım listesine eklenirken yazılan fiyat (tahmini)', 'Sistem'
FROM "ingredients" i
WHERE i."price_source" = 'manual'
  AND i."package_price" > 0
  AND i."count_from" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ingredient_prices" p WHERE p."ingredient_id" = i."id");

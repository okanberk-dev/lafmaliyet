-- Paraşüt bağı kalmamış elle / Excel kaydının kaynağı (denetim 13 Kasım 2026, FC-02; docs/PARASUT.md § 3).
-- Elle ya da Excel'le girilmiş fatura gelen bir e-faturaya bağlanınca kaynağı 'parasut' olur. E-fatura Paraşüt'te
-- reddedilir ya da arşivlenirse eşitleme yalnız e-fatura bağını siliyordu: kayıt hiçbir Paraşüt belgesine bağlı değil ama
-- Paraşüt'e bağlı sayılıyor, tarih, no ve tutarlar düzenlenemiyordu. Eşitleme artık kaynağı geri döndürüyor; bu tek
-- seferlik düzeltme bozulmuş kayıtları onarır. Yalnız veri: şema değişmez, eski kod da aynı sütunları okur.
UPDATE "invoices" SET "source" = "origin"
WHERE "source" = 'parasut' AND "origin" <> 'parasut' AND "external_id" IS NULL AND "e_invoice_id" IS NULL;

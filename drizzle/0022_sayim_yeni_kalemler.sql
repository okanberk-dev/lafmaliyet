-- Sayım listesine yedi yeni kalem (sahibinin 22 Ekim 2026 isteği): çilek, cookie, lemon tea ve hazelnut şurubu, vanilya
-- sos, yaban mersini ve böğürtlen püre. Faturada görülmeyen kalemlerin Excel usulüyle: tedarikçi "(faturada yok)",
-- Tahmini, fiyat aynı ailenin DVG fiyatı (şurup 750 ml 760 ₺, sos 2 L 1.352 ₺, püre 1 L 1.080 ₺). İlk fatura fiyatı ya
-- da elle girilen fiyat tahminin yerine geçer.
-- Korumalar: boş veritabanına hiçbir şey eklenmez (db:seed Excel'i yine yükler; geri yüklemede de yedekten sonra çalışır).
-- Aynı ad varsa (büyük/küçük harf, Türkçe İ/I/ı ve boşluk farkı gözetmeden; pasif olsa da) o kalem atlanır. Eklenen
-- her kalemin fiyat geçmişi Excel satırları gibi tahminle başlar; bir şey eklendiyse işlem geçmişine tek satır düşer.
WITH "yeni" ("name", "category", "package_desc", "package_size", "package_price", "note", "ord") AS (
  VALUES
    ('Çilek şurubu', 'Sos & Şurup', 'Şurup 750 ml', 750, 760, 'VARSAYIM: Faturada yok, diğer DVG şuruplarla aynı (760 TL) alındı. Gerçek fiyatı yazın.', 1),
    ('Cookie şurubu', 'Sos & Şurup', 'Şurup 750 ml', 750, 760, 'VARSAYIM: Faturada yok, diğer DVG şuruplarla aynı (760 TL) alındı. Gerçek fiyatı yazın.', 2),
    ('Lemon tea şurubu', 'Sos & Şurup', 'Şurup 750 ml', 750, 760, 'VARSAYIM: Faturada yok, diğer DVG şuruplarla aynı (760 TL) alındı. Gerçek fiyatı yazın.', 3),
    ('Hazelnut şurubu', 'Sos & Şurup', 'Şurup 750 ml', 750, 760, 'VARSAYIM: Faturada yok, diğer DVG şuruplarla aynı (760 TL) alındı. Gerçek fiyatı yazın.', 4),
    ('Vanilya sos', 'Sos & Şurup', 'Sos 2 L', 2000, 1352, 'VARSAYIM: Faturada yok, diğer DVG soslarla aynı (2 L 1.352 TL) alındı. Gerçek fiyatı yazın.', 5),
    ('Yaban mersini püre', 'Püre', 'Püre 1 L', 1000, 1080, 'VARSAYIM: Faturada yok, diğer DVG pürelerle aynı (1.080 TL) alındı. Gerçek fiyatı yazın.', 6),
    ('Böğürtlen püre', 'Püre', 'Püre 1 L', 1000, 1080, 'VARSAYIM: Faturada yok, diğer DVG pürelerle aynı (1.080 TL) alındı. Gerçek fiyatı yazın.', 7)
),
"son" AS (SELECT COALESCE(MAX("sort_order"), 0) AS "m" FROM "ingredients"),
"eklenen" AS (
  INSERT INTO "ingredients" ("name", "category", "supplier", "package_desc", "package_price", "package_size", "unit", "vat_rate", "note", "is_estimate", "price_source", "count_unit", "count_group", "sort_order", "active")
  SELECT y."name", y."category", '(faturada yok)', y."package_desc", y."package_price", y."package_size", 'ml', 0.01, y."note", true, 'manual', 'LT', 'SOS / ŞURUP / PÜRE', "son"."m" + y."ord", true
  FROM "yeni" y CROSS JOIN "son"
  WHERE EXISTS (SELECT 1 FROM "ingredients")
    AND NOT EXISTS (
      SELECT 1 FROM "ingredients" i
      -- lower() C yerel ayarında yalnız ASCII harfleri küçültür: Türkçe büyük harfler (ve ı) önce elle çevrilir
      WHERE lower(translate(regexp_replace(btrim(i."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜı', 'çğiiöşüi')) = lower(translate(y."name", 'ÇĞİIÖŞÜı', 'çğiiöşüi'))
    )
  ORDER BY y."ord"
  RETURNING "id", "name", "package_price", "package_size", "sort_order"
),
"fiyat" AS (
  INSERT INTO "ingredient_prices" ("ingredient_id", "package_price", "package_size", "note", "changed_by")
  SELECT "id", "package_price", "package_size", 'Sayım listesine eklendi (tahmini fiyat)', 'Sistem' FROM "eklenen"
  RETURNING "id"
)
INSERT INTO "activity_log" ("user_name", "action", "detail")
SELECT 'Sistem', 'Sayım listesine eklendi', string_agg("name", ', ' ORDER BY "sort_order") FROM "eklenen" HAVING count(*) > 0;

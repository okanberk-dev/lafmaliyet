-- Sahibinin 2 Kasım 2026 istekleri (Ekim sayımının ardından): çay demlik poşete geçer, meyveli granola bar ve Beypazarı
-- soda eklenir. Üç ifade; her biri kendi koruması ve işlem geçmişi satırıyla. Ürün açmak panelin kuralıyla
-- (src/server/data/product-create.ts insertProduct): aynı ad + boy varsa açılmaz, zayi oranı benzer üründen (kopyalamada
-- olduğu gibi: Hindistan Cevizli Bar, Damla Soda), o yoksa kategorideki ürünlerin en sık oranı (categoryFireDefault), sıra
-- en sonda, aktif ve QR menüde görünür, laffogato.net menüsüne bağlanmaz, fiyat
-- geçmişine "Yeni ürün" satırı (kasaya elle eklenir: kasanın listesine girmez). Hammadde açmak "Listeye ekle"nin
-- kuralıyla (src/lib/count-item.ts newCountItemValues). Adlar "Listeye ekle"nin aynı ad kuralıyla karşılaştırılır
-- (looseKey: büyük / küçük harf, boşluk ve Türkçe harf farkı gözetmeden). Eski çay yalnız gramla tutuluyorsa dönüşür.
-- Boş veritabanına bir şey yapılmaz; yeniden çalışırsa bir şey yapmaz.
--
-- 1) Çay demlik poşete geçer: 200 gr = 40 demlik poşet (poşet 5 gr), 450 ₺/kg (paketi 90 ₺, poşeti 2,25 ₺); demliğe
-- 6–8 poşet atılıyor. Bardak başına çay değişmez (demlikten kaç bardak çıktığı bilinmiyor): orta 3 gr = 0,6 poşet,
-- büyük 5 gr = 1 poşet; bir demlik 6–8 poşetle 10–13 bardak eder. Tutarlılık birkaç ay sonra gerçek kullanımı gösterir.
-- Eski "Çay" (gr, KG ile sayılan) kalemi yerinde dönüştürülmez: fiyat, zayi ve alış geçmişi gramla kalsın diye yeni
-- "Demlik poşet çay" (adet, poşetle sayılır) açılır, eskisinin listedeki yerini alır; reçete satırları (miktar / 5),
-- Paraşüt bağlantısı (çarpan / 5) ve varsa sayımı (gram / 5 = poşet) yeniye taşınır, eskisi pasif olur ve eski kg
-- varsayım notu kalkar. Çay ürünlerinin notundaki gramlı reçete varsayımı poşetle yazılır.
WITH "eski" AS (
  SELECT i.* FROM "ingredients" i
  WHERE lower(translate(regexp_replace(btrim(i."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) = 'cay'
    AND i."unit" = 'gr'
  ORDER BY i."active" DESC, i."id"
  LIMIT 1
),
"yeni" AS (
  INSERT INTO "ingredients" ("name", "category", "supplier", "package_desc", "package_price", "package_size", "unit", "vat_rate", "note", "is_estimate", "price_source", "count_unit", "count_group", "count_from", "sort_order", "active")
  SELECT 'Demlik poşet çay', e."category", e."supplier", 'Demlik poşet çay 200 gr (40 poşet)', 90, 40, 'adet', e."vat_rate",
    'Demlik poşet: 200 gr = 40 poşet (poşet 5 gr), 450 ₺/kg, poşeti 2,25 ₺. Demliğe 6–8 poşet atılıyor; reçetede orta bardak 0,6 poşet (3 gr), büyük 1 poşet (5 gr).',
    false, 'manual', 'ADET', COALESCE(e."count_group", 'KAHVE & ÇAY'), '2026-10', e."sort_order", true
  FROM "eski" e
  WHERE NOT EXISTS (SELECT 1 FROM "ingredients" x WHERE lower(translate(regexp_replace(btrim(x."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) = lower(translate('Demlik poşet çay', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')))
  RETURNING "id"
),
"fiyat" AS (
  INSERT INTO "ingredient_prices" ("ingredient_id", "package_price", "package_size", "note", "changed_by")
  SELECT "id", 90, 40, 'Demlik poşete geçildi: 450 ₺/kg (sahibinin verdiği fiyat)', 'Sistem' FROM "yeni"
  RETURNING "id"
),
"recete" AS (
  UPDATE "recipe_items" r SET "ingredient_id" = y."id", "qty" = r."qty" / 5, "qty_expr" = NULL
  FROM "eski" e, "yeni" y
  WHERE r."ingredient_id" = e."id"
  RETURNING r."id"
),
"baglanti" AS (
  UPDATE "parasut_product_links" l SET "ingredient_id" = y."id", "factor" = l."factor" / 5
  FROM "eski" e, "yeni" y
  WHERE l."ingredient_id" = e."id"
  RETURNING l."id"
),
"sayim_yeni" AS (
  INSERT INTO "stock_counts" ("month", "ingredient_id", "qty", "factor", "counted_by")
  SELECT c."month", y."id", c."qty" * COALESCE(c."factor", 1000) / 5, 1, c."counted_by"
  FROM "stock_counts" c, "eski" e, "yeni" y
  WHERE c."ingredient_id" = e."id"
  ON CONFLICT ("month", "ingredient_id") DO NOTHING
  RETURNING "id"
),
"sayim_eski" AS (
  DELETE FROM "stock_counts" c USING "eski" e, "yeni" y
  WHERE c."ingredient_id" = e."id"
  RETURNING c."id"
),
"pasif" AS (
  UPDATE "ingredients" i SET "active" = false, "note" = 'Demlik poşet çaya geçildi (02.11.2026): yerine "Demlik poşet çay".', "updated_at" = now()
  FROM "eski" e, "yeni" y
  WHERE i."id" = e."id"
  RETURNING i."id", i."name"
),
"urun_notu" AS (
  UPDATE "products" p SET "note" = replace(p."note", 'Reçete varsayımı: M = 3 gr çay + 8oz bardak, L = 5 gr + 14oz bardak.', 'Reçete: M = 0,6 demlik poşet (3 gr) + 8oz bardak, L = 1 poşet (5 gr) + 14oz bardak; demliğe 6–8 poşet.'), "updated_at" = now()
  FROM "eski" e, "yeni" y
  WHERE p."note" LIKE '%' || 'Reçete varsayımı: M = 3 gr çay + 8oz bardak, L = 5 gr + 14oz bardak.' || '%'
    AND EXISTS (SELECT 1 FROM "recipe_items" r WHERE r."product_id" = p."id" AND r."ingredient_id" = e."id")
  RETURNING p."id"
)
INSERT INTO "activity_log" ("user_name", "action", "detail")
SELECT 'Sistem', 'Sayım listesine eklendi', 'Demlik poşet çay · KAHVE & ÇAY · ADET · paket 90 ₺ (200 gr, 40 poşet; 450 ₺/kg)' FROM "yeni"
UNION ALL
SELECT 'Sistem', 'Hammadde pasif', p."name" || ': demlik poşet çaya geçildi; ' || (SELECT count(*) FROM "recete") || ' reçete satırı, '
  || (SELECT count(*) FROM "baglanti") || ' Paraşüt bağlantısı ve ' || (SELECT count(*) FROM "sayim_yeni") || ' sayım "Demlik poşet çay"a taşındı'
FROM "pasif" p;--> statement-breakpoint
-- 2) Meyveli granola bar: alışı yaklaşık 50 ₺/adet (Tahmini; fiyat geçmişinin başlangıç satırı "Listeye ekle"ninki gibi,
-- Hammaddeler'deki düzeltme onun yerine geçer), Ekim 2026 sonunda 3 adet (sahibinin bildirdiği), Atıştırmalıklar'da
-- 110 ₺'ye satılır; reçetesi öteki barlar gibi bar + peçete. Bu adla hammadde varsa yenisi açılmaz (ürün ona bağlanır,
-- sayım yazılmaz); o kalemin Ekim sayımı varsa üzerine yazılmaz.
WITH "yeni" AS (
  INSERT INTO "ingredients" ("name", "category", "supplier", "package_desc", "package_price", "package_size", "unit", "vat_rate", "note", "is_estimate", "price_source", "count_unit", "count_group", "count_from", "sort_order", "active")
  SELECT 'Meyveli granola bar', 'Atıştırmalık', NULL, 'Bar', 50, 1, 'adet', 0.01,
    'Alış yaklaşık 50 ₺/adet (sahibinin verdiği, 02.11.2026).', true, 'manual', 'ADET', 'SANDVİÇ & ATIŞTIRMALIK', '2026-10',
    (SELECT COALESCE(MAX("sort_order"), 0) + 1 FROM "ingredients"), true
  WHERE EXISTS (SELECT 1 FROM "ingredients")
    AND NOT EXISTS (SELECT 1 FROM "ingredients" x WHERE lower(translate(regexp_replace(btrim(x."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) = lower(translate('Meyveli granola bar', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')))
  RETURNING "id"
),
"fiyat" AS (
  INSERT INTO "ingredient_prices" ("ingredient_id", "package_price", "package_size", "note", "changed_by")
  SELECT "id", 50, 1, 'Sayım listesine eklenirken yazılan fiyat (tahmini)', 'Sistem' FROM "yeni"
  RETURNING "id"
),
"sayim" AS (
  INSERT INTO "stock_counts" ("month", "ingredient_id", "qty", "factor", "counted_by")
  SELECT '2026-10', "id", 3, 1, 'Sahibi (2 Kasım)' FROM "yeni"
  ON CONFLICT ("month", "ingredient_id") DO NOTHING
  RETURNING "ingredient_id"
),
"malzeme" AS (
  SELECT "id" FROM "yeni"
  UNION ALL
  (SELECT x."id" FROM "ingredients" x WHERE lower(translate(regexp_replace(btrim(x."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) = lower(translate('Meyveli granola bar', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) ORDER BY x."active" DESC, x."id" LIMIT 1)
),
"kat" AS (SELECT c."id" FROM "categories" c WHERE c."name" = 'Atıştırmalıklar'),
"urun" AS (
  INSERT INTO "products" ("category_id", "name", "size", "price", "fire_override", "note", "active", "show_on_menu", "sort_order")
  SELECT k."id", 'Meyveli Granola Bar', 'Tek', 110, CASE WHEN EXISTS (SELECT 1 FROM "products" b WHERE b."name" = 'Hindistan Cevizli Bar' AND b."size" = 'Tek')
      THEN (SELECT b."fire_override" FROM "products" b WHERE b."name" = 'Hindistan Cevizli Bar' AND b."size" = 'Tek')
      ELSE (SELECT p."fire_override" FROM "products" p WHERE p."category_id" = k."id" GROUP BY p."fire_override" ORDER BY count(*) DESC, max(p."id") DESC LIMIT 1)
    END, NULL, true, true, (SELECT COALESCE(MAX("sort_order"), 0) + 1 FROM "products")
  FROM "kat" k
  WHERE EXISTS (SELECT 1 FROM "malzeme")
    AND NOT EXISTS (SELECT 1 FROM "products" p WHERE lower(translate(regexp_replace(btrim(p."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) = lower(translate('Meyveli Granola Bar', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) AND p."size" = 'Tek')
  ON CONFLICT ("name", "size") DO NOTHING
  RETURNING "id"
),
"recete" AS (
  INSERT INTO "recipe_items" ("product_id", "ingredient_id", "qty", "qty_expr", "note", "sort_order")
  SELECT u."id", m."id", 1, NULL, NULL, 1 FROM "urun" u, (SELECT "id" FROM "malzeme" LIMIT 1) m
  UNION ALL
  SELECT u."id", pc."id", 1, NULL, NULL, 2 FROM "urun" u,
    (SELECT x."id" FROM "ingredients" x WHERE lower(translate(regexp_replace(btrim(x."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) = lower(translate('Peçete', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) ORDER BY x."active" DESC, x."id" LIMIT 1) pc
  RETURNING "id"
),
"satis" AS (
  INSERT INTO "product_prices" ("product_id", "price_before", "price", "source", "on_site", "changed_by")
  SELECT "id", NULL, 110, 'create', false, 'Sistem' FROM "urun"
  RETURNING "id"
)
INSERT INTO "activity_log" ("user_name", "action", "detail")
SELECT 'Sistem', 'Sayım listesine eklendi', 'Meyveli granola bar · SANDVİÇ & ATIŞTIRMALIK · ADET · paket fiyatı 50 ₺ (tahmini)' FROM "yeni"
UNION ALL
SELECT 'Sistem', 'Stok sayımı', 'Ekim 2026: Meyveli granola bar 3 adet (sahibinin bildirdiği)' FROM "sayim"
UNION ALL
SELECT 'Sistem', 'Yeni ürün', 'Meyveli Granola Bar Tek (110 ₺)' FROM "urun";--> statement-breakpoint
-- 3) Beypazarı Soda: Şişe İçecekler'de 60 ₺ (Damla Soda gibi); reçetesi yalnız şişe ("Beypazarı soda" hammaddesi, 0048;
-- panelde eski adıyla "Beypazarı maden suyu" açılmışsa o). Hammaddesi yoksa ya da bu ad + boyda ürün varsa açılmaz.
WITH "malzeme" AS (
  SELECT x."id" FROM "ingredients" x
  WHERE lower(translate(regexp_replace(btrim(x."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) IN (
    lower(translate('Beypazarı soda', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')), lower(translate('Beypazarı maden suyu', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu'))
  )
  ORDER BY x."active" DESC, x."id" LIMIT 1
),
"kat" AS (SELECT c."id" FROM "categories" c WHERE c."name" = 'Şişe İçecekler'),
"urun" AS (
  INSERT INTO "products" ("category_id", "name", "size", "price", "fire_override", "note", "active", "show_on_menu", "sort_order")
  SELECT k."id", 'Beypazarı Soda', 'Tek', 60, CASE WHEN EXISTS (SELECT 1 FROM "products" b WHERE b."name" = 'Damla Soda' AND b."size" = 'Tek')
      THEN (SELECT b."fire_override" FROM "products" b WHERE b."name" = 'Damla Soda' AND b."size" = 'Tek')
      ELSE (SELECT p."fire_override" FROM "products" p WHERE p."category_id" = k."id" GROUP BY p."fire_override" ORDER BY count(*) DESC, max(p."id") DESC LIMIT 1)
    END, NULL, true, true, (SELECT COALESCE(MAX("sort_order"), 0) + 1 FROM "products")
  FROM "kat" k
  WHERE EXISTS (SELECT 1 FROM "malzeme")
    AND NOT EXISTS (SELECT 1 FROM "products" p WHERE lower(translate(regexp_replace(btrim(p."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) = lower(translate('Beypazarı Soda', 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) AND p."size" = 'Tek')
  ON CONFLICT ("name", "size") DO NOTHING
  RETURNING "id"
),
"recete" AS (
  INSERT INTO "recipe_items" ("product_id", "ingredient_id", "qty", "qty_expr", "note", "sort_order")
  SELECT u."id", m."id", 1, NULL, NULL, 1 FROM "urun" u, "malzeme" m
  RETURNING "id"
),
"satis" AS (
  INSERT INTO "product_prices" ("product_id", "price_before", "price", "source", "on_site", "changed_by")
  SELECT "id", NULL, 60, 'create', false, 'Sistem' FROM "urun"
  RETURNING "id"
)
INSERT INTO "activity_log" ("user_name", "action", "detail")
SELECT 'Sistem', 'Yeni ürün', 'Beypazarı Soda Tek (60 ₺)' FROM "urun";

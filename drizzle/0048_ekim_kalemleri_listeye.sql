-- Ekim 2026 sayımındaki "Listede olmayanlar"ın sayım listesine alınması (sahibinin 2 Kasım 2026 isteği: "sistemde ekli
-- olmayan ama sayımda olan ürünleri de sisteme ekle"). 0047 bu 22 kalemi yalnız Ekim'in ek kalemi olarak yazmıştı;
-- burada her biri "Listeye ekle"nin kuralıyla hammadde olur (src/lib/count-item.ts newCountItemValues): sayım grubu,
-- grubun kategorisi ve KDV'si (Excel'deki gruplarınki: groupDefaults), sayım biriminden malzeme birimi (BASE_UNIT), Ekim
-- 2026'dan itibaren listede (count_from), "Tahmini", tedarikçisiz. Paket fiyatı yazılmamışsa 0: zil "Fiyatı girilmemiş N
-- hammadde" der, yönetici Hammaddeler'den girer; ilk fiyat Ekim'i de değerler.
-- Ekim miktarı ek kalemden yeni kalemin Ekim sayımına taşınır (birim çarpanıyla) ve ek kalem silinir: ikisi birden stoka
-- girmez. Yönetici ek kaleme birim fiyat yazdıysa paket fiyatı ondan (birim fiyat × paket içeriği / sayım çarpanı) ve
-- fiyat geçmişine "Listeye ekle"nin başlangıç satırı yazılır (src/lib/count-item.ts COUNT_ITEM_PRICE_NOTE: Hammaddeler'deki
-- düzeltme o satırın yerine geçer, Ekim düzeltilen fiyatla değerlenir; zam uyarısı onu taban saymaz).
-- Adı okunamayan Callei satırı ("Callei sos (adı okunamadı)") listeye alınmaz: adı belli olunca "Listeye ekle".
-- "Beypazarı maden suyu" sahibinin dediği adla "Beypazarı soda" olarak açılır (ek kalemi 0047'deki adıyla bulunur).
-- Korumalar: boş veritabanına eklenmez. Bu adla hammadde varsa yenisi açılmaz; adlar "Listeye ekle"nin aynı ad kuralıyla
-- karşılaştırılır (src/lib/count-item.ts looseKey: büyük / küçük harf, boşluk, düzeltme işareti ve Türkçe harf farkı
-- gözetmeden; "Kraft canta" = "Kraft çanta"): sayım listesindeyse ve sayım birimi aynıysa miktar ona taşınır, değilse
-- ek kalem kalır. O kalemin Ekim sayımı zaten varsa üzerine yazılmaz, ek kalem de silinmez. Ek kalem silinmiş ya da adı /
-- birimi değişmişse kalem yine açılır, miktar taşınmaz. Taşınamayanlar işlem geçmişine yazılır. Yeniden çalışırsa bir şey
-- yapmaz.
WITH "kalem" ("sira", "ad", "ek_ad", "grup", "kategori", "birim", "sayim_birimi", "paket", "icerik", "kdv") AS (
  VALUES
    (1, 'Callei Antep fıstığı sos', 'Callei Antep fıstığı sos', 'SOS / ŞURUP / PÜRE', 'Sos & Şurup', 'gr', 'KG', 'Callei Antep fıstığı sos 1 kg', 1000, 0.01),
    (2, 'Callei beyaz çikolata sos', 'Callei beyaz çikolata sos', 'SOS / ŞURUP / PÜRE', 'Sos & Şurup', 'gr', 'KG', 'Callei beyaz çikolata sos 1 kg', 1000, 0.01),
    (3, 'Callei karamel sos', 'Callei karamel sos', 'SOS / ŞURUP / PÜRE', 'Sos & Şurup', 'gr', 'KG', 'Callei karamel sos 1 kg', 1000, 0.01),
    (4, 'Badem şurubu', 'Badem şurubu', 'SOS / ŞURUP / PÜRE', 'Sos & Şurup', 'ml', 'LT', 'Şurup 750 ml', 750, 0.01),
    (5, 'Liçi şurubu', 'Liçi şurubu', 'SOS / ŞURUP / PÜRE', 'Sos & Şurup', 'ml', 'LT', 'Şurup 750 ml', 750, 0.01),
    (6, 'Beyaz çikolata tozu', 'Beyaz çikolata tozu', 'TOZ ÜRÜNLER', 'Toz', 'gr', 'KG', 'Beyaz çikolata tozu 1 kg', 1000, 0.01),
    (7, 'Lotus cake', 'Lotus cake', 'TATLILAR', 'Tatlı', 'dilim', 'DİLİM', NULL, 1, 0.01),
    (8, 'Mono Latte', 'Mono Latte', 'TATLILAR', 'Tatlı', 'dilim', 'DİLİM', NULL, 1, 0.01),
    (9, 'Baget hindi füme sandviç', 'Baget hindi füme sandviç', 'SANDVİÇ & ATIŞTIRMALIK', 'Atıştırmalık', 'adet', 'ADET', NULL, 1, 0.01),
    (10, 'Beypazarı soda', 'Beypazarı maden suyu', 'İÇECEKLER (şişe)', 'Şişe İçecek', 'adet', 'ADET', NULL, 1, 0.01),
    (11, 'Stick şeker', 'Stick şeker', 'DİĞER GIDA ÜRÜNLERİ', 'Diğer', 'adet', 'ADET', NULL, 1, 0.01),
    (12, 'Bardak 8oz baskısız', 'Bardak 8oz baskısız', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (13, 'Bardak 12oz baskısız', 'Bardak 12oz baskısız', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (14, 'Karton bardak 12oz kahverengi', 'Karton bardak 12oz kahverengi', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (15, 'Şeffaf kapak 12oz', 'Şeffaf kapak 12oz', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (16, 'Sleeve 8oz', 'Sleeve 8oz', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (17, '4''lü bardak taşıyıcı', '4''lü bardak taşıyıcı', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (18, '2''li bardak taşıyıcı', '2''li bardak taşıyıcı', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (19, 'Taşıma çantası', 'Taşıma çantası', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (20, 'Kraft çanta', 'Kraft çanta', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (21, 'Plastik bıçak', 'Plastik bıçak', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2),
    (22, 'Cold brew şişesi', 'Cold brew şişesi', 'AMBALAJ MALZEMELERİ', 'Ambalaj', 'adet', 'ADET', NULL, 1, 0.2)
),
"k" AS (
  SELECT k.*, lower(translate(k."ad", 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) AS "anahtar",
    lower(translate(k."ek_ad", 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) AS "ek_anahtar",
    CASE WHEN k."sayim_birimi" IN ('KG', 'LT') THEN 1000 ELSE 1 END AS "carpan"
  FROM "kalem" k
  WHERE EXISTS (SELECT 1 FROM "ingredients")
),
"ek" AS (
  -- 0047'nin bu kalem için yazdığı Ekim ek kalemi: 0047'deki adıyla ("ek_ad") ya da panelde yeni adına çevrilmişse onunla,
  -- aynı birim
  SELECT DISTINCT ON (k."sira") k."sira", e."id" AS "ek_id", e."qty", e."unit_price"
  FROM "k" k
  JOIN "stock_extras" e ON e."month" = '2026-10' AND e."unit" = k."sayim_birimi"
    AND lower(translate(regexp_replace(btrim(e."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) IN (k."ek_anahtar", k."anahtar")
  ORDER BY k."sira", e."id"
),
"var" AS (
  -- Bu adla (ya da 0047'deki adıyla) zaten hammadde: sayım listesinde mi (src/lib/ingredient-usage.ts isCountable)
  SELECT DISTINCT ON (k."sira") k."sira", i."id", i."count_unit",
    i."count_unit" IS NOT NULL AND (i."active" OR EXISTS (
      SELECT 1 FROM "recipe_items" r JOIN "products" p ON p."id" = r."product_id" WHERE r."ingredient_id" = i."id" AND p."active"
    )) AS "listede"
  FROM "k" k
  JOIN "ingredients" i ON lower(translate(regexp_replace(btrim(i."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîûçğöşü', 'cgiiosuiaiuaiucgosu')) IN (k."anahtar", k."ek_anahtar")
  ORDER BY k."sira", i."active" DESC, i."id"
),
"son" AS (SELECT COALESCE(MAX("sort_order"), 0) AS "m" FROM "ingredients"),
"yeni" AS (
  INSERT INTO "ingredients" ("name", "category", "supplier", "package_desc", "package_price", "package_size", "unit", "vat_rate", "note", "is_estimate", "price_source", "count_unit", "count_group", "count_from", "sort_order", "active")
  SELECT k."ad", k."kategori", NULL, k."paket",
    CASE WHEN e."unit_price" > 0 THEN round((e."unit_price" * k."icerik" / k."carpan")::numeric, 2)::double precision ELSE 0 END,
    k."icerik", k."birim", k."kdv",
    'Ekim 2026 sayım kâğıdından sayım listesine eklendi (02.11.2026)' || CASE
      WHEN e."unit_price" > 0 THEN '; paket fiyatı sayımdaki ek kalemin birim fiyatından.'
      ELSE '. Paket fiyatını ve içeriğini yazın.'
    END,
    true, 'manual', k."sayim_birimi", k."grup", '2026-10', "son"."m" + k."sira", true
  FROM "k" k
  CROSS JOIN "son"
  LEFT JOIN "ek" e ON e."sira" = k."sira"
  WHERE NOT EXISTS (SELECT 1 FROM "var" v WHERE v."sira" = k."sira")
  ORDER BY k."sira"
  RETURNING "id", "name", "package_price", "package_size"
),
"fiyat" AS (
  INSERT INTO "ingredient_prices" ("ingredient_id", "package_price", "package_size", "note", "changed_by")
  SELECT "id", "package_price", "package_size", 'Sayım listesine eklenirken yazılan fiyat (tahmini)', 'Sistem' FROM "yeni" WHERE "package_price" > 0
  RETURNING "id"
),
"hedef" AS (
  -- Miktarın gideceği kalem: yeni açılan ya da sayım listesinde aynı birimle var olan
  SELECT k."sira", y."id" AS "ingredient_id", k."carpan" FROM "k" k JOIN "yeni" y ON y."name" = k."ad"
  UNION ALL
  SELECT k."sira", v."id", k."carpan" FROM "k" k JOIN "var" v ON v."sira" = k."sira"
  WHERE v."listede" AND v."count_unit" = k."sayim_birimi"
),
"tasima" AS (
  -- Ek kalemi olan ve Ekim sayımı henüz olmayan kalem: panelden girilmiş sayımın üzerine yazılmaz
  SELECT h."sira", h."ingredient_id", h."carpan", e."ek_id", e."qty"
  FROM "hedef" h JOIN "ek" e ON e."sira" = h."sira"
  WHERE NOT EXISTS (SELECT 1 FROM "stock_counts" c WHERE c."month" = '2026-10' AND c."ingredient_id" = h."ingredient_id")
),
"tasinan" AS (
  INSERT INTO "stock_counts" ("month", "ingredient_id", "qty", "factor", "counted_by")
  SELECT '2026-10', "ingredient_id", "qty", "carpan", 'Sayım kâğıdı (31 Ekim)' FROM "tasima"
  ON CONFLICT ("month", "ingredient_id") DO NOTHING
  RETURNING "ingredient_id"
),
"silinen" AS (
  DELETE FROM "stock_extras" x USING "tasima" t
  WHERE x."id" = t."ek_id" AND t."ingredient_id" IN (SELECT "ingredient_id" FROM "tasinan")
  RETURNING x."id"
),
"kalan" AS (
  -- Taşınamayanlar ve nedeni (işlem geçmişine)
  SELECT k."sira", k."ad" || ' (listede başka birimle ya da sayılmaz)' AS "neden" FROM "k" k JOIN "var" v ON v."sira" = k."sira"
  WHERE NOT (v."listede" AND v."count_unit" = k."sayim_birimi")
  UNION ALL
  SELECT h."sira", k."ad" || ' (Ekim sayımı zaten var, ek kalem duruyor)' FROM "hedef" h JOIN "k" k ON k."sira" = h."sira"
  WHERE EXISTS (SELECT 1 FROM "ek" e WHERE e."sira" = h."sira")
    AND EXISTS (SELECT 1 FROM "stock_counts" c WHERE c."month" = '2026-10' AND c."ingredient_id" = h."ingredient_id")
  UNION ALL
  SELECT h."sira", k."ad" || ' (Ekim ek kalemi bulunamadı, miktar taşınmadı)' FROM "hedef" h JOIN "k" k ON k."sira" = h."sira"
  WHERE NOT EXISTS (SELECT 1 FROM "ek" e WHERE e."sira" = h."sira")
),
"eklendi" AS (
  INSERT INTO "activity_log" ("user_name", "action", "detail")
  SELECT 'Sistem', 'Sayım listesine eklendi', string_agg("name", ', ' ORDER BY "id") FROM "yeni" HAVING count(*) > 0
  RETURNING "id"
)
INSERT INTO "activity_log" ("user_name", "action", "detail")
SELECT 'Sistem', 'Stok sayımı', concat_ws('; ',
  'Ekim 2026: ' || (SELECT count(*) FROM "silinen") || ' ek kalem sayım listesindeki kalemine taşındı',
  (SELECT 'taşınmadı: ' || string_agg("neden", ', ' ORDER BY "sira") FROM "kalan" HAVING count(*) > 0)
)
WHERE EXISTS (SELECT 1 FROM "yeni") OR EXISTS (SELECT 1 FROM "tasinan");

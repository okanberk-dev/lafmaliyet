-- Ekim 2026 ay sonu sayımı: 31 Ekim 2026 kapanışında kâğıda yazılan "LAF İLK SAYIM" (dört sayfa; sahibinin 2 Kasım 2026
-- isteği: "anlayıp kontrol edip stoklara işle"). Her satır kâğıttaki bir yazıdır: foto = gönderilen fotoğrafın sırası
-- (1 "Koyulaştırılmış süt…" listesi, 2 tartılan şişeler, 3 "Çöp torbası…" sayfası, 4 "LAF İLK SAYIM" ön yüz), yazılan =
-- kâğıtta ne yazdığı, kalem = paneldeki adı, miktar = sayım biriminde (KG, LT, ADET, DİLİM). Aynı kalemin satırları
-- toplanır (depo, bar ve dolap ayrı kâğıtlara sayılmış). Tartılan açık şişeler kâğıttaki net değerle (şişesi düşülmüş),
-- 1 gr = 1 ml. Okuma, eşleme ve sahibine sorulanlar: docs/sayimlar/2026-10.md.
--
-- Yazım kuralı, uygulamanın sayım kaydıyla aynı (src/server/actions/stock.ts saveStockCounts):
--  - Kalem adla eşlenir: Türkçe büyük / küçük harf, düzeltme işareti ve boşluk farkı gözetmeden (anahtar
--    drizzle/0023_sayim_yeni_kalemler.sql ile aynı). Kalem sayım listesindeyse (sayım birimi var; aktif ya da aktif bir
--    ürünün reçetesinde) ve sayım birimi satırınkiyle aynıysa Ekim sayımına yazılır, birim çarpanıyla (KG / LT = 1000,
--    ADET / DİLİM = 1). "koli" satırı (Peçete) koli × paket içeriği adettir; paket koli değilse yazılmaz.
--  - Bu adla hammadde yoksa "Listede olmayanlar"a (stock_extras) fiyatsız yazılır: yönetici birim fiyatı girer (zil
--    "ek kalemin fiyatı yok" der); her ay sayılacaksa "Listeye ekle" ile listeye alınır.
--  - Hammadde var ama sayım listesinde değil (pasif, "Sayılmaz") ya da sayım birimi değişmiş: yazılmaz, işlem
--    geçmişine "elle girilecek" diye düşer.
-- Korumalar: boş veritabanına bir şey yazılmaz (db:seed Excel'i yükler); Ekim'de panelden kaydedilmiş sayımın ve aynı
-- adlı ek kalemin üzerine yazılmaz; yeniden çalışırsa bir şey eklemez. Bir şey yazıldıysa işlem geçmişine tek satır.
WITH "satir" ("no", "foto", "yazilan", "kalem", "miktar", "birim", "tur") AS (
  VALUES
    (1, 4, 'Espresso 1 koli = 12 kg + 1 koli: 12 kg + 2 kg', 'Espresso çekirdeği', 26, 'KG', 'liste'),
    (2, 1, 'Espresso = 12 kg', 'Espresso çekirdeği', 12, 'KG', 'liste'),
    (3, 4, 'Filtre kahve 2 paket (1 paket = 1 kg)', 'Filtre kahve', 2, 'KG', 'liste'),
    (4, 2, 'Filter coffee = 250 (ml yazılmış)', 'Filtre kahve', 0.25, 'KG', 'liste'),
    (5, 1, 'Türk kahvesi 1 adet (500 gram)', 'Türk kahvesi', 0.5, 'KG', 'liste'),
    (6, 2, 'Turkish coffee 1.320 kg', 'Türk kahvesi', 1.32, 'KG', 'liste'),
    (7, 2, 'Türk kahve = 80 gr (açık paket)', 'Türk kahvesi', 0.08, 'KG', 'liste'),
    (8, 1, 'Decaf Colombia 0,5', 'Cold brew kahve (Colombia)', 0.5, 'KG', 'liste'),
    (9, 3, 'Süt 2.5 yağlı 11 adet', 'Süt %2,5', 11, 'LT', 'liste'),
    (10, 2, 'Süt = 12 litre + 16 litre', 'Süt %2,5', 28, 'LT', 'liste'),
    (11, 3, 'Laktozsuz süt 8 adet + 1 adet', 'Laktozsuz süt', 9, 'LT', 'liste'),
    (12, 2, 'Laktozsuz = 18 litre', 'Laktozsuz süt', 18, 'LT', 'liste'),
    (13, 4, 'Davinci çikolata sos 4 litre', 'Çikolata sos', 4, 'LT', 'liste'),
    (14, 2, 'Soslar: Çikolata = 2 L', 'Çikolata sos', 2, 'LT', 'liste'),
    (15, 2, 'Açık şişe: 518 = çikolata sos', 'Çikolata sos', 0.518, 'LT', 'liste'),
    (16, 2, 'Soslar: W. choc = 2 L', 'Beyaz çikolata sos', 2, 'LT', 'liste'),
    (17, 2, 'Açık şişe: 620 = white choc', 'Beyaz çikolata sos', 0.62, 'LT', 'liste'),
    (18, 1, 'Beyaz çikolata sosu 1 adet (Callei yazmıyor: DVG 2 L)', 'Beyaz çikolata sos', 2, 'LT', 'liste'),
    (19, 2, 'Soslar: Caramel = 4 litre', 'Karamel sos', 4, 'LT', 'liste'),
    (20, 2, 'Açık şişe: 1022 = karamel', 'Karamel sos', 1.022, 'LT', 'liste'),
    (21, 2, 'Soslar: Salted = 2 L', 'Tuzlu karamel sos', 2, 'LT', 'liste'),
    (22, 2, 'Açık şişe: 2255 = salted caramel', 'Tuzlu karamel sos', 2.255, 'LT', 'liste'),
    (23, 2, 'Soslar: Vanilla = 2 L', 'Vanilya sos', 2, 'LT', 'liste'),
    (24, 2, 'Açık şişe: 1222 = vanilla', 'Vanilya sos', 1.222, 'LT', 'liste'),
    (25, 4, 'Davinci koyulaştırılmış süt 1 litre', 'Condensed milk', 1, 'LT', 'liste'),
    (26, 1, 'Koyulaştırılmış süt 2 litre', 'Condensed milk', 2, 'LT', 'liste'),
    (27, 2, 'Condensed milk = 381 ml', 'Condensed milk', 0.381, 'LT', 'liste'),
    (28, 1, 'Peach tea 1 litre', 'Şeftali çay şurubu', 1, 'LT', 'liste'),
    (29, 2, 'Peach tea = 440 ml', 'Şeftali çay şurubu', 0.44, 'LT', 'liste'),
    (30, 4, 'Lemon tea 1.5 litre', 'Lemon tea şurubu', 1.5, 'LT', 'liste'),
    (31, 2, 'Lemon tea = 406 → 150 ml', 'Lemon tea şurubu', 0.15, 'LT', 'liste'),
    (32, 3, 'Juicy Lime 0,75 + 0,75', 'Lime şurubu', 1.5, 'LT', 'liste'),
    (33, 2, 'Juicy Lime = 111 ml', 'Lime şurubu', 0.111, 'LT', 'liste'),
    (34, 4, 'Toffeenut 1.5 litre', 'Toffeenut şurubu', 1.5, 'LT', 'liste'),
    (35, 3, 'Toffee nut şurup 2 litre', 'Toffeenut şurubu', 2, 'LT', 'liste'),
    (36, 1, 'Pumpkin spice 2 litre', 'Pumpkin spice şurubu', 2, 'LT', 'liste'),
    (37, 2, 'Pumpkin spice = 449 ml', 'Pumpkin spice şurubu', 0.449, 'LT', 'liste'),
    (38, 4, 'Spice chai 1.5 litre', 'Chai şurubu', 1.5, 'LT', 'liste'),
    (39, 2, 'Spiced chai = 170 ml', 'Chai şurubu', 0.17, 'LT', 'liste'),
    (40, 4, 'Strawberry 1.5 litre (şurup)', 'Çilek şurubu', 1.5, 'LT', 'liste'),
    (41, 2, 'Şuruplar: Strawberry = 740 ml', 'Çilek şurubu', 0.74, 'LT', 'liste'),
    (42, 3, 'Cookies şurup 0,75 + 0,75', 'Cookie şurubu', 1.5, 'LT', 'liste'),
    (43, 2, 'Cookie = 60 ml', 'Cookie şurubu', 0.06, 'LT', 'liste'),
    (44, 4, 'Hazelnut 0,75', 'Hazelnut şurubu', 0.75, 'LT', 'liste'),
    (45, 2, 'Hazelnut = 350 ml', 'Hazelnut şurubu', 0.35, 'LT', 'liste'),
    (46, 4, 'Strawberry püre 1 litre', 'Çilek püre', 1, 'LT', 'liste'),
    (47, 3, 'Strawberry püre 1 litre + 1 litre', 'Çilek püre', 2, 'LT', 'liste'),
    (48, 2, 'Püre: Strawberry = 984 ml', 'Çilek püre', 0.984, 'LT', 'liste'),
    (49, 3, 'Elma püre 1 litre', 'Elma püre', 1, 'LT', 'liste'),
    (50, 2, 'Apple = 700 ml', 'Elma püre', 0.7, 'LT', 'liste'),
    (51, 3, 'Frambuaz püre 1 litre + 1 litre', 'Frambuaz püre', 2, 'LT', 'liste'),
    (52, 2, 'Rasberry = 422', 'Frambuaz püre', 0.422, 'LT', 'liste'),
    (53, 3, 'Mango püre 2 litre + 1 litre', 'Mango püre', 3, 'LT', 'liste'),
    (54, 2, 'Mango = 600', 'Mango püre', 0.6, 'LT', 'liste'),
    (55, 3, 'Ananas püre 2 litre', 'Ananas püre', 2, 'LT', 'liste'),
    (56, 2, 'Pineapple = 388', 'Ananas püre', 0.388, 'LT', 'liste'),
    (57, 3, 'Orman meyveli püre 2 litre + 2 litre', 'Karışık berry püre', 4, 'LT', 'liste'),
    (58, 2, 'Mixed berry = 409', 'Karışık berry püre', 0.409, 'LT', 'liste'),
    (59, 4, 'Davinci çarkıfelek 1 litre', 'Passionfruit püre', 1, 'LT', 'liste'),
    (60, 2, 'Passionfruit = 922', 'Passionfruit püre', 0.922, 'LT', 'liste'),
    (61, 4, 'Davinci blueberry 1 litre', 'Yaban mersini püre', 1, 'LT', 'liste'),
    (62, 3, 'Yaban mersini püre 1 litre', 'Yaban mersini püre', 1, 'LT', 'liste'),
    (63, 2, 'Blueberry = 34', 'Yaban mersini püre', 0.034, 'LT', 'liste'),
    (64, 4, 'Davinci blackberry 2 litre', 'Böğürtlen püre', 2, 'LT', 'liste'),
    (65, 2, 'Blackberry = 924', 'Böğürtlen püre', 0.924, 'LT', 'liste'),
    (66, 3, 'Limonata 2 litre + 2 litre', 'Limon özü', 4, 'LT', 'liste'),
    (67, 1, 'Çikolata sos 7 adet (Callei, 1 kg)', 'Callei waffle sos sütlü', 7, 'KG', 'liste'),
    (68, 2, 'Callei: çikolata = 112 ml', 'Callei waffle sos sütlü', 0.112, 'KG', 'liste'),
    (69, 1, 'Matcha 0,25', 'Matcha', 0.25, 'KG', 'liste'),
    (70, 2, 'Matcha = 160 gr', 'Matcha', 0.16, 'KG', 'liste'),
    (71, 1, 'Cooler base 1 kg', 'Cooler base', 1, 'KG', 'liste'),
    (72, 2, 'Smoothie powder = 380 gr', 'Cooler base', 0.38, 'KG', 'liste'),
    (73, 2, 'Frapp powder 1.5 kg', 'Frappe tozu', 1.5, 'KG', 'liste'),
    (74, 2, 'Sıcak çikolata = 800 gr', 'Sıcak çikolata tozu', 0.8, 'KG', 'liste'),
    (75, 2, 'S. çikolata = 700 gr', 'Sıcak çikolata tozu', 0.7, 'KG', 'liste'),
    (76, 4, 'Sahlep 2 kg', 'Salep tozu', 2, 'KG', 'liste'),
    (77, 2, 'Salep = 180 gr', 'Salep tozu', 0.18, 'KG', 'liste'),
    (78, 3, 'San Sebastian 12 dilim + 12 dilim', 'San Sebastian dilim', 24, 'DİLİM', 'liste'),
    (79, 3, 'Yaban mersinli San Sebastian 12 dilim + 2 dilim', 'Yaban mersinli SS dilim', 14, 'DİLİM', 'liste'),
    (80, 3, 'Cedric Mango 9 dilim', 'Tasarım Mango', 9, 'ADET', 'liste'),
    (81, 3, 'Mono Latte 9 dilim', 'Tasarım Kahve Çekirdeği', 9, 'ADET', 'liste'),
    (82, 3, 'Fıstık tanesi 2 dilim', 'Tasarım Fıstık Tanesi', 2, 'ADET', 'liste'),
    (83, 3, 'Marlenka 3 dilim + 12 dilim', 'Marlenka dilim', 15, 'DİLİM', 'liste'),
    (84, 3, 'Frambuazlı cheesecake 6 dilim', 'Frambuazlı cheesecake', 6, 'ADET', 'liste'),
    (85, 3, 'Limonlu mono cheesecake 5 dilim', 'Limonlu cheesecake', 5, 'ADET', 'liste'),
    (86, 3, 'Brownie 16 dilim + 36 dilim', 'Brownie dilim', 52, 'DİLİM', 'liste'),
    (87, 3, 'Tiramisu cake 6 dilim', 'Tiramisu dilim', 6, 'DİLİM', 'liste'),
    (88, 2, 'Cam su = 67', 'Su (cam şişe)', 67, 'ADET', 'liste'),
    (89, 2, 'Pet su = 81', 'Su (PET)', 81, 'ADET', 'liste'),
    (90, 2, 'Uludağ soda = 24 adet', 'Soda (Uludağ 25 cl)', 24, 'ADET', 'liste'),
    (91, 4, '4 oz karton 1000 + 100 + 1000 adet', 'Karton bardak 4oz', 2100, 'ADET', 'liste'),
    (92, 4, '8 oz baskılı 1000', 'Karton bardak 8oz', 1000, 'ADET', 'liste'),
    (93, 4, '12 oz baskılı karton 850', 'Karton bardak 14oz', 850, 'ADET', 'liste'),
    (94, 4, '16 oz baskılı 1000 + 1000 + 1000 + 700 + 1000', 'Plastik bardak 16oz', 4700, 'ADET', 'liste'),
    (95, 4, '8 oz karton kapak 200 adet', 'Kapak 8-12oz', 200, 'ADET', 'liste'),
    (96, 4, '8 oz siyah kapak 500 adet', 'Kapak 8-12oz', 500, 'ADET', 'liste'),
    (97, 4, '12 oz karton kapak 500 adet', 'Kapak 14-16oz', 500, 'ADET', 'liste'),
    (98, 4, 'Kapak şeffaf 600 + 8000 adet', 'Bombe kapak', 8600, 'ADET', 'liste'),
    (99, 4, 'Siyah pipet 1000 adet', 'Pipet', 1000, 'ADET', 'liste'),
    (100, 4, 'Peçete 17 koli + 1 koli', 'Peçete', 18, 'ADET', 'koli'),
    (101, 1, 'Yenilebilir bardak LAF 18 adet', 'Yenilebilir bardak', 18, 'ADET', 'liste'),
    (102, 2, 'Callei: Antep = 338', 'Callei Antep fıstığı sos', 0.338, 'KG', 'ek'),
    (103, 1, 'Antep fıstığı sos 5 adet (Callei, 1 kg)', 'Callei Antep fıstığı sos', 5, 'KG', 'ek'),
    (104, 2, 'Callei: beyaz = 111 ml', 'Callei beyaz çikolata sos', 0.111, 'KG', 'ek'),
    (105, 2, 'Callei: karamel = 422', 'Callei karamel sos', 0.422, 'KG', 'ek'),
    (106, 2, 'Almond = 200 ml', 'Badem şurubu', 0.2, 'LT', 'ek'),
    (107, 2, 'Lychee = 700 ml', 'Liçi şurubu', 0.7, 'LT', 'ek'),
    (108, 2, 'Beyaz çikolata = 250 gr (tozlar arasında)', 'Beyaz çikolata tozu', 0.25, 'KG', 'ek'),
    (109, 3, 'Lotus cake 9 dilim', 'Lotus cake', 9, 'DİLİM', 'ek'),
    (110, 3, 'Baget hindi füme sandviç 4 adet', 'Baget hindi füme sandviç', 4, 'ADET', 'ek'),
    (111, 2, 'Beypazarı = 8 adet', 'Beypazarı maden suyu', 8, 'ADET', 'ek'),
    (112, 1, 'Stick şeker 400 adet', 'Stick şeker', 400, 'ADET', 'ek'),
    (113, 4, '8 oz baskısız 1200', 'Bardak 8oz baskısız', 1200, 'ADET', 'ek'),
    (114, 4, '12 oz baskısız 1000 adet', 'Bardak 12oz baskısız', 1000, 'ADET', 'ek'),
    (115, 4, '12 oz karton kahverengi 175 adet', 'Karton bardak 12oz kahverengi', 175, 'ADET', 'ek'),
    (116, 4, '12 oz şeffaf kapak 200 adet', 'Şeffaf kapak 12oz', 200, 'ADET', 'ek'),
    (117, 4, '8 oz sleeve 1000 adet', 'Sleeve 8oz', 1000, 'ADET', 'ek'),
    (118, 4, '4''lü bardak taşıyıcı 240 adet', '4''lü bardak taşıyıcı', 240, 'ADET', 'ek'),
    (119, 1, '4''lü bardak taşıyıcı 27 adet', '4''lü bardak taşıyıcı', 27, 'ADET', 'ek'),
    (120, 4, '2''li bardak taşıyıcı 100 adet', '2''li bardak taşıyıcı', 100, 'ADET', 'ek'),
    (121, 1, '2''li bardak taşıyıcı 15 adet', '2''li bardak taşıyıcı', 15, 'ADET', 'ek'),
    (122, 4, 'Taşıma çantası 125 adet (soldaki ''125 adet bardak taşıyıcı'' aynı kalem sayıldı)', 'Taşıma çantası', 125, 'ADET', 'ek'),
    (123, 4, 'Kraft çanta 200 adet', 'Kraft çanta', 200, 'ADET', 'ek'),
    (124, 1, 'Kraft çanta 4 adet', 'Kraft çanta', 4, 'ADET', 'ek'),
    (125, 4, 'Plastik bıçak 150 adet', 'Plastik bıçak', 150, 'ADET', 'ek'),
    (126, 4, 'Coldbrew şişesi 90 adet', 'Cold brew şişesi', 90, 'ADET', 'ek'),
    (127, 1, 'ColdBrew şişesi 4 adet', 'Cold brew şişesi', 4, 'ADET', 'ek')
),
"eslesen" AS (
  SELECT s.*, lower(translate(s."kalem", 'ÇĞİIÖŞÜıÂÎÛâîû', 'çğiiöşüiaiuaiu')) AS "anahtar", i."id" AS "ingredient_id", i."count_unit",
    i."package_size", i."package_desc",
    -- Sayım listesinde mi (src/lib/ingredient-usage.ts isCountable): sayım birimi var; aktif ya da aktif bir reçetede
    i."count_unit" IS NOT NULL AND (i."active" OR EXISTS (
      SELECT 1 FROM "recipe_items" r JOIN "products" p ON p."id" = r."product_id" WHERE r."ingredient_id" = i."id" AND p."active"
    )) AS "listede"
  FROM "satir" s
  LEFT JOIN LATERAL (
    -- lower() C yerel ayarında yalnız ASCII harfleri küçültür: Türkçe büyük harfler (ve ı, düzeltme işaretliler) önce elle çevrilir
    SELECT * FROM "ingredients" x
    WHERE lower(translate(regexp_replace(btrim(x."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîû', 'çğiiöşüiaiuaiu')) = lower(translate(s."kalem", 'ÇĞİIÖŞÜıÂÎÛâîû', 'çğiiöşüiaiuaiu'))
    ORDER BY x."active" DESC, x."id"
    LIMIT 1
  ) i ON true
  WHERE EXISTS (SELECT 1 FROM "ingredients")
),
"uygun" AS (
  SELECT e.*, e."ingredient_id" IS NOT NULL AND e."listede" AND e."count_unit" = e."birim"
    AND (e."tur" <> 'koli' OR e."package_desc" ILIKE '%koli%') AS "yazilir"
  FROM "eslesen" e
),
"sayim" AS (
  SELECT "ingredient_id", min("count_unit") AS "count_unit",
    sum(CASE WHEN "tur" = 'koli' THEN "miktar" * "package_size"::numeric ELSE "miktar" END) AS "qty"
  FROM "uygun" WHERE "yazilir"
  GROUP BY "ingredient_id"
),
"ek" AS (
  SELECT "kalem", CASE WHEN "tur" = 'koli' THEN 'KOLİ' ELSE "birim" END AS "birim", sum("miktar") AS "qty", min("no") AS "no"
  FROM "uygun" u
  WHERE u."ingredient_id" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "stock_extras" x
      WHERE x."month" = '2026-10'
        AND lower(translate(regexp_replace(btrim(x."name"), '\s+', ' ', 'g'), 'ÇĞİIÖŞÜıÂÎÛâîû', 'çğiiöşüiaiuaiu')) = u."anahtar"
    )
  GROUP BY "kalem", 2
),
"atlanan" AS (
  SELECT DISTINCT "kalem" FROM "uygun" WHERE "ingredient_id" IS NOT NULL AND NOT "yazilir"
),
"onceden" AS (
  -- Panelden zaten kaydedilmiş Ekim sayımı: dokunulmaz
  SELECT s."ingredient_id" FROM "sayim" s
  WHERE EXISTS (SELECT 1 FROM "stock_counts" c WHERE c."month" = '2026-10' AND c."ingredient_id" = s."ingredient_id")
),
"ay" AS (
  INSERT INTO "months" ("month")
  SELECT '2026-10' WHERE EXISTS (SELECT 1 FROM "sayim") OR EXISTS (SELECT 1 FROM "ek")
  ON CONFLICT DO NOTHING
  RETURNING "month"
),
"yazilan" AS (
  INSERT INTO "stock_counts" ("month", "ingredient_id", "qty", "factor", "counted_by")
  SELECT '2026-10', "ingredient_id", "qty"::double precision, CASE WHEN "count_unit" IN ('KG', 'LT') THEN 1000 ELSE 1 END, 'Sayım kâğıdı (31 Ekim)'
  FROM "sayim"
  ON CONFLICT ("month", "ingredient_id") DO NOTHING
  RETURNING "ingredient_id"
),
"eklenen" AS (
  INSERT INTO "stock_extras" ("month", "name", "unit", "qty", "unit_price")
  SELECT '2026-10', "kalem", "birim", "qty"::double precision, 0 FROM "ek" ORDER BY "no"
  RETURNING "id"
)
INSERT INTO "activity_log" ("user_name", "action", "detail")
SELECT 'Sistem', 'Stok sayımı', concat_ws('; ',
  'Ekim 2026: 31 Ekim sayım kâğıdından ' || (SELECT count(*) FROM "yazilan") || ' kalem',
  (SELECT count(*) || ' ek kalem (Listede olmayanlar; birim fiyatını yönetici girer)' FROM "eklenen" HAVING count(*) > 0),
  (SELECT count(*) || ' kalem panelde zaten sayılmıştı, dokunulmadı' FROM "onceden" HAVING count(*) > 0),
  (SELECT 'elle girilecek: ' || string_agg("kalem", ', ' ORDER BY "kalem") FROM "atlanan" HAVING count(*) > 0)
)
WHERE EXISTS (SELECT 1 FROM "yazilan") OR EXISTS (SELECT 1 FROM "eklenen") OR EXISTS (SELECT 1 FROM "atlanan");

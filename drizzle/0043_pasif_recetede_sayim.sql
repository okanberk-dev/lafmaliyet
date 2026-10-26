-- Pasif olup aktif bir ürünün reçetesinde geçen sayım kalemleri sayım listesine bu aydan girer (denetim E-04).
-- Uygulama artık bu kalemleri listede tutuyor (src/lib/ingredient-usage.ts isCountable): satışla tüketilmeye devam
-- ediyorlar, listeden düşerlerse kalan stokları kapanışta 0 sayılıp mal maliyetini şişiriyordu. Ama count_from'ları
-- pasif yapıldıkları zamandan kalma (boş ya da eski): öyle kalırsa sayımı bitmiş her geçmiş ay "1 kalem kaldı" der,
-- sayım ekranı ve hatırlatmalar kapanmış aya gider. Hammaddeler'de yeniden aktif yapılan kalem gibi (listedFromMonth)
-- count_from bu ay (Türkiye saatiyle) olur; ileri bir aydan çıkan kaleme dokunulmaz. O ay sayılmış geçmiş aylarda kalem
-- yine görünür (engine.ts stockSheet). Bundan sonra aynı geçişi uygulama yapar (src/server/data/ingredient-usage.ts
-- withPassiveRelist). Yeniden çalışırsa bir şey değiştirmez.
UPDATE "ingredients" i
SET "count_from" = to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM'), "updated_at" = now()
WHERE i."active" = false
  AND i."count_unit" IS NOT NULL
  AND (i."count_from" IS NULL OR i."count_from" < to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM'))
  AND EXISTS (
    SELECT 1 FROM "recipe_items" r JOIN "products" p ON p."id" = r."product_id"
    WHERE r."ingredient_id" = i."id" AND p."active" = true
  );

-- Şube özellikleri (şube kapsamı B6, 25 Kasım 2026; docs/SUBE.md › Şube özellikleri). Sahibin varsayılanı: karaoke
-- varsayılan şubede (Tuzla; bugüne kadar sabitti, src/lib/branches.ts KARAOKE_BRANCH_ID), uygulama siparişi, garson
-- çağır ve yemek kartı her şubede açık (bugünkü davranış; 0084'teki sütun varsayılanı). Online kanalın özelliği yok.
-- Karaoke tek şubede olabilir: başka bir şubede zaten açıksa Tuzla'ya eklenmez. Göç iki kez koşsa da aynı sonuç.
UPDATE "branches"
SET "features" = array_append("features", 'karaoke')
WHERE "id" = 'tuzla'
  AND NOT ('karaoke' = ANY ("features"))
  AND NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."id" <> 'tuzla' AND 'karaoke' = ANY (b."features"));
--> statement-breakpoint
UPDATE "branches" SET "features" = '{}'::text[] WHERE "kind" = 'online' AND "features" <> '{}'::text[];

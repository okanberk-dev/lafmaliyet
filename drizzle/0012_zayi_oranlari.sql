-- Ürün zayi (fire) oranları: kategori ortalamaları (sahibinin verdiği: kahve %5, tatlı %20, çay %40; diğerleri
-- kafe sektörü ortalamaları). Ürün kartından ürün bazında değiştirilebilir.
UPDATE "products" SET "fire_override" = 0.05 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" IN ('Espresso Bazlı', 'Buzlu Kahveler', 'Frappe', 'Ekstralar'));--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.20 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" = 'Tatlılar');--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.40 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" = 'Ice Tea');--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.10 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" IN ('Smoothie', 'Frozen', 'Soğuk İçecekler'));--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.08 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" IN ('Sıcak İçecekler', 'Strawberry Aşkı'));--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.40 WHERE "name" = 'Çay';--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.02 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" = 'Şişe İçecekler');--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.15 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" = 'Atıştırmalıklar');--> statement-breakpoint
UPDATE "products" SET "fire_override" = 0.03 WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "name" = 'Atıştırmalıklar') AND "name" NOT ILIKE '%sandviç%';

-- laffogato.net menüsüyle bağlantı (docs/SITE-MENU.md): panel ürününün sitedeki kalemi (mnu-0011) ve o kalemin
-- hangi fiyatı olduğu (M = priceMinor ya da tek fiyat, L = priceMinorL). İkisi birlikte boş ya da dolu; bir kalemin
-- bir fiyatına en çok bir satır bağlanır. Var olan ürünler bağlı değil başlar (eşleştirme elle, Ürünler › Site menüsü).
--
-- Her adım "yoksa" yazılır: bu migration'ın 0017 numaralı ilk hâlini bir önizleme dağıtımı (önizlemeler canlıyla aynı
-- veritabanını kullanır, scripts/predeploy.ts) 21 Eki 2026'da uyguladı. O veritabanında sütunlar, dizin ve denetimler
-- zaten var; boş bir veritabanında hepsi burada kurulur.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "site_menu_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "site_menu_slot" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_site_menu_uq" ON "products" USING btree ("site_menu_id","site_menu_slot");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_site_menu_slot_ck' AND conrelid = 'products'::regclass) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_site_menu_slot_ck" CHECK ("products"."site_menu_slot" is null or "products"."site_menu_slot" in ('M', 'L'));
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_site_menu_pair_ck' AND conrelid = 'products'::regclass) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_site_menu_pair_ck" CHECK (("products"."site_menu_id" is null) = ("products"."site_menu_slot" is null));
  END IF;
END $$;

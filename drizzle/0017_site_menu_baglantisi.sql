-- laffogato.net menüsüyle bağlantı (docs/SITE-MENU.md): panel ürününün sitedeki kalemi (mnu-0011) ve o kalemin
-- hangi fiyatı olduğu (M = priceMinor ya da tek fiyat, L = priceMinorL). İkisi birlikte boş ya da dolu; bir kalemin
-- bir fiyatına en çok bir satır bağlanır. Var olan ürünler bağlı değil başlar (eşleştirme elle, Ürünler › Site menüsü).
ALTER TABLE "products" ADD COLUMN "site_menu_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "site_menu_slot" text;--> statement-breakpoint
CREATE UNIQUE INDEX "products_site_menu_uq" ON "products" USING btree ("site_menu_id","site_menu_slot");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_site_menu_slot_ck" CHECK ("products"."site_menu_slot" is null or "products"."site_menu_slot" in ('M', 'L'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_site_menu_pair_ck" CHECK (("products"."site_menu_id" is null) = ("products"."site_menu_slot" is null));
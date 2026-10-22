-- laffogato.net bar ekranı (docs/SITE-SIPARIS.md): cihazın yeni uygulama siparişi bildirimi alıp almadığı. Boş: kişinin
-- rolüne göre (personel cihazında açık, yöneticininkinde kapalı); cihazda değiştirilince açık ya da kapalı yazılır. Var
-- olan abonelikler boş başlar. Önizleme dağıtımları da canlının veritabanında çalıştığı için (scripts/predeploy.ts)
-- adım "yoksa" yazılır: ikinci kez uygulansa da bir şey değişmez.
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "orders" boolean;

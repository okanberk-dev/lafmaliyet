-- Doğrudan kayıtlarda istemci anahtarı (denetim 13 Kasım 2026, UI-01 ve UI-03): zayi formu, Fatura ekle ve Bulgu ekle
-- pencereleri her yeni kayda bir UUID gönderir; Enter'a ya da Ctrl+Enter'a ikinci basış, yanıtı yolda kalan isteğin
-- tekrarı ikinci satırı açmaz, var olan satır döner. Boş olabilen sütunlar ve benzersiz dizinler, eklemeli (eski kod
-- sütunlara bakmaz; boş değerler dizinde çakışmaz). Şubeyle ilgisi yok, geri doldurulacak satır yok.
ALTER TABLE "findings" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "client_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_client_key_uq" ON "findings" USING btree ("client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_client_key_uq" ON "invoices" USING btree ("client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "waste_entries_client_key_uq" ON "waste_entries" USING btree ("client_key");
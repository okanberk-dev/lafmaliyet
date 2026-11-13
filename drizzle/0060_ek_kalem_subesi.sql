-- Ek kalemin şubesi (denetim 13 Kasım 2026, ST-01; docs/SUBE.md): sayım şube başına, "Listede olmayanlar" da öyle.
-- Marina'nın sayımı Tuzla'nın ek kalemini görmez, üzerine yazmaz; kilit ve "başkası kaydetti" denetimi (ay, şube) için.
-- Eklemeli: varsayılan 'tuzla', eski kod sütuna bakmaz.
ALTER TABLE "stock_extras" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_extras" ADD CONSTRAINT "stock_extras_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Geri doldurma: bugüne kadarki ek kalemler Tuzla'nın (şubelerden önceki ve bugüne kadarki bütün sayım onun). Sütun
-- DEFAULT 'tuzla' ile eklendiği için satırlar zaten dolu; güncelleme kararı açıkça yazar (0056 gibi)
UPDATE "stock_extras" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;--> statement-breakpoint
-- Ürün ikramı yalnız kasası LafPOS olan şubede LafPOS'tan gelir (ST-X1). LafPOS'a geçiş günü zaten seçildiyse LafPOS'un
-- gün sonunu yazdığı şube (Tuzla, src/server/lafpos/ingest.ts) LafPOS kasalıdır: bundan sonra geçiş günü kaydı bunu
-- kendisi yazar (src/server/lafpos/admin.ts). Seçilmediyse dokunulmaz
UPDATE "branches" SET "pos_source" = 'lafpos', "updated_at" = now() WHERE "id" = 'tuzla' AND "pos_source" = 'modpos' AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'lafposGecisGunu' AND "value" #>> '{}' >= '2026-10-01');

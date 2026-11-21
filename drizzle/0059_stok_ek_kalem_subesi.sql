-- Sayımın "Listede olmayanlar"ı (stock_extras) şube başına (docs/SUBE.md › Stok ve sayım; 21 Kasım denetimi #19/#24).
-- 0056 stock_counts'a şube verdi, ek kalemlere vermedi: Tuzla ile Marina tek listeyi okuyup birbirinin kalemini
-- eziyor ya da siliyordu. Var olan satırlar Tuzla'nın (sahibin kararı, 4 Kasım 2026: bugüne kadarki veri Tuzla'ya).
-- Varsayılan şube kütükte 0057'den beri var; yabancı anahtar eski yedeğin geri yüklenmesinde de tutar.
ALTER TABLE "stock_extras" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;--> statement-breakpoint
-- Geri doldurma: sütun DEFAULT 'tuzla' ile eklendiği için satırlar zaten dolu; 0056'daki gibi açıkça yazılır ki
-- migration'ı okuyan kararı görsün ve varsayılan sonradan kaldırılsa da doğru kalsın
UPDATE "stock_extras" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;--> statement-breakpoint
ALTER TABLE "stock_extras" ADD CONSTRAINT "stock_extras_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;

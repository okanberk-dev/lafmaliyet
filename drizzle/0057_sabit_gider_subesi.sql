-- Sabit giderin şubesi (docs/SUBE.md, dalga 3): null = işletme geneli. Mevcut kalemler işletme geneli başlar
-- (sahibin kararı, 4 Kasım 2026); kira gibi şubeye ait olanı yönetici Sabit giderler'den taşır.
ALTER TABLE "fixed_expenses" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD CONSTRAINT "fixed_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Varsayılan şube (Tuzla) her veritabanında bulunur: şube sütunlarının varsayılanı 'tuzla' ve yabancı anahtarla
-- kütüğe bağlı. Tohum (scripts/seed.ts, `branches_seeded`) migration'dan sonra çalışır; boş veritabanında (test, yeni
-- ortam) tohumdan önce yazılan ilk satır yabancı anahtara takılıyordu. Var olan kayda dokunulmaz (adı değişmişse kalır)
INSERT INTO "branches" ("id", "name", "kind", "pos_source", "sort_order") VALUES ('tuzla', 'Tuzla', 'fiziksel', 'modpos', 1) ON CONFLICT ("id") DO NOTHING;

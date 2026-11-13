-- Kapalı günün şubesi (denetim 13 Kasım 2026, KP-05; docs/SUBE.md): kasa raporu şube başına, kapalı gün işareti de öyle.
-- Kasa'nın "Kafe kapalıydı"sı ve personelin bildiriminin onayı raporun şubesini yazar; o şubenin raporu işareti kaldırır,
-- öteki şubenin raporu dokunmaz. Boş = işletme geneli (Satış tahmini'nin özel günleri; bayram gibi bütün şubelerin
-- kapandığı gün). Eklemeli: eski kod sütuna bakmaz.
ALTER TABLE "special_days" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "special_days" ADD CONSTRAINT "special_days_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Geri doldurma: başlamış kapalı günler Tuzla'nın (şubelerden önceki ve bugüne kadarki bütün kasa raporları onun; Marina
-- henüz rapor girmedi). İleri tarihli kapalı gün Satış tahmini'nde planlanmış işletme kapanışıdır, işletme geneli kalır
UPDATE "special_days" SET "branch_id" = 'tuzla' WHERE "kind" = 'kapali' AND "date_from" <= to_char((now() AT TIME ZONE 'Europe/Istanbul')::date, 'YYYY-MM-DD');

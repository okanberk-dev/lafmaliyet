-- Şube kırılımı (dalga 2, docs/SUBE.md). drizzle-kit birincil anahtar adlarını bulamadığı ve
-- sütunları anahtarlardan SONRA ürettiği için sıra elle düzeltildi: önce sütunlar ve geri doldurma,
-- sonra eski anahtarların kaldırılması, en sonda yeni anahtarlar. Eski satırlar 'tuzla' şubesine yazılır.

-- 1) Eski bağlar
ALTER TABLE "sales_lines" DROP CONSTRAINT "sales_lines_month_months_month_fk";
DROP INDEX "cash_reports_date_uq";
DROP INDEX "pos_daily_sales_date_pos_name_uq";
DROP INDEX "sales_lines_month_idx";
DROP INDEX "stock_counts_month_ingredient_uq";
--> statement-breakpoint
-- 2) Şube sütunları (varsayılan 'tuzla': var olan satırlar o şubeye düşer)
ALTER TABLE "cash_outs" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "cash_reports" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "expense_entries" ADD COLUMN "branch_id" text;
ALTER TABLE "modpos_cash_sheets" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "months" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "pos_daily_sales" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "pos_day_reports" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "sales_lines" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "staff" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "stock_counts" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
ALTER TABLE "waste_entries" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;
--> statement-breakpoint
-- 3) Geri doldurma: ortak gider dışındaki her satır Tuzla'nın (sahibin kararı, 4 Kasım 2026).
-- Sütunlar DEFAULT 'tuzla' ile eklendiği için var olan satırlar zaten dolu; bu güncelleme açıkça
-- yazar ki migration'ı okuyan kararı görsün ve default sonradan kaldırılsa da doğru kalsın.
UPDATE "months" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "sales_lines" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "cash_reports" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "pos_daily_sales" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "pos_day_reports" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "modpos_cash_sheets" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "stock_counts" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "waste_entries" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "cash_outs" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
UPDATE "staff" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL;
-- expense_entries BİLEREK boş kalır: null = "işletme geneli" ortak gider (muhasebeci, yazılım).
-- Var olan giderler hangi şubeye ait bilinmediği için işletme geneli sayılır; yönetici ekrandan ayırır.
--> statement-breakpoint
-- 4) Eski birincil anahtarlar (adlar veritabanından okundu: *_pkey)
ALTER TABLE "modpos_cash_sheets" DROP CONSTRAINT "modpos_cash_sheets_pkey";
ALTER TABLE "months" DROP CONSTRAINT "months_pkey";
ALTER TABLE "pos_day_reports" DROP CONSTRAINT "pos_day_reports_pkey";
--> statement-breakpoint
-- 5) Yeni bileşik anahtarlar
ALTER TABLE "modpos_cash_sheets" ADD CONSTRAINT "modpos_cash_sheets_day_branch_id_pk" PRIMARY KEY("day","branch_id");
ALTER TABLE "months" ADD CONSTRAINT "months_month_branch_id_pk" PRIMARY KEY("month","branch_id");
ALTER TABLE "pos_day_reports" ADD CONSTRAINT "pos_day_reports_date_branch_id_pk" PRIMARY KEY("date","branch_id");
--> statement-breakpoint
-- 6) Şube yabancı anahtarları
ALTER TABLE "cash_outs" ADD CONSTRAINT "cash_outs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "modpos_cash_sheets" ADD CONSTRAINT "modpos_cash_sheets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "months" ADD CONSTRAINT "months_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pos_daily_sales" ADD CONSTRAINT "pos_daily_sales_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pos_day_reports" ADD CONSTRAINT "pos_day_reports_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- 7) Ay satırı artık şubesiyle birlikte aya bağlı
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_month_branch_fk" FOREIGN KEY ("month","branch_id") REFERENCES "public"."months"("month","branch_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- 8) Benzersizlik ve indeksler şubeyle birlikte
CREATE UNIQUE INDEX "cash_reports_date_uq" ON "cash_reports" USING btree ("date","branch_id");
CREATE UNIQUE INDEX "pos_daily_sales_date_pos_name_uq" ON "pos_daily_sales" USING btree ("date","branch_id","pos_name");
CREATE INDEX "sales_lines_month_idx" ON "sales_lines" USING btree ("month","branch_id");
CREATE UNIQUE INDEX "stock_counts_month_ingredient_uq" ON "stock_counts" USING btree ("month","branch_id","ingredient_id");

CREATE TABLE "fixed_expense_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixed_expense_id" integer NOT NULL,
	"from_month" text NOT NULL,
	"period" text DEFAULT 'aylik' NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"from_month" text NOT NULL,
	"net_salary" double precision DEFAULT 0 NOT NULL,
	"extras" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "start_month" text;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "end_month" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "start_month" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "end_month" text;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD COLUMN "factor" double precision;--> statement-breakpoint
ALTER TABLE "fixed_expense_versions" ADD CONSTRAINT "fixed_expense_versions_fixed_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("fixed_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_versions" ADD CONSTRAINT "staff_versions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_expense_versions_item_month_uq" ON "fixed_expense_versions" USING btree ("fixed_expense_id","from_month");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_versions_staff_month_uq" ON "staff_versions" USING btree ("staff_id","from_month");--> statement-breakpoint
-- Pasif kalemler bugüne kadar hiçbir ayda hesaba girmiyordu: ilk veri ayından (2026-07) önce bitmiş sayılır, bugünkü rakamlar değişmez
UPDATE "fixed_expenses" SET "end_month" = '2026-06' WHERE "active" = false AND "end_month" IS NULL;--> statement-breakpoint
UPDATE "staff" SET "end_month" = '2026-06' WHERE "active" = false AND "end_month" IS NULL;--> statement-breakpoint
-- Var olan sayımlar o anki sayım birimiyle saklanır (KG/LT = 1000, ADET/DİLİM = 1)
UPDATE "stock_counts" AS sc SET "factor" = CASE WHEN i."count_unit" IN ('KG', 'LT') THEN 1000 ELSE 1 END FROM "ingredients" AS i WHERE i."id" = sc."ingredient_id" AND sc."factor" IS NULL;

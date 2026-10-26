ALTER TABLE "ai_calls" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_z_no" text;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_receipts" integer;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_total" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_vat_total" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_vat" jsonb;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_cash" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_card" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_meal_card" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_other" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_cum_total" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_cum_vat" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "okc_outside" double precision;
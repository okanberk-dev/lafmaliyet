ALTER TABLE "pos_daily_sales" ADD COLUMN "site_menu_id" text;--> statement-breakpoint
ALTER TABLE "pos_daily_sales" ADD COLUMN "slot" text;--> statement-breakpoint
ALTER TABLE "pos_daily_sales" ADD COLUMN "lafpos_service" boolean DEFAULT false NOT NULL;
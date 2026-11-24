ALTER TABLE "lafpos_day_ends" ADD COLUMN "photo_check" jsonb;--> statement-breakpoint
ALTER TABLE "lafpos_day_ends" ADD COLUMN "pending_photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "okc" jsonb;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "collections" jsonb;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "shift_counts" jsonb;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "discount_lines" jsonb;
ALTER TABLE "lafpos_day_ends" ADD COLUMN "pavo_emailed_hash" text;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "bank_pos" jsonb;
ALTER TABLE "photos" ADD COLUMN "original_key" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "original_size" integer;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "scan" jsonb;
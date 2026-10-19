ALTER TABLE "invoices" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE "invoices" SET "origin" = 'excel' WHERE "source" = 'excel';--> statement-breakpoint
UPDATE "invoices" SET "origin" = CASE WHEN "note" LIKE 'Paraşüt''ten alındı%' THEN 'parasut' ELSE 'excel' END WHERE "source" = 'parasut';

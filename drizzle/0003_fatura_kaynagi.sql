ALTER TABLE "invoices" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE "invoices" SET "origin" = "source" WHERE "source" IN ('excel', 'parasut');

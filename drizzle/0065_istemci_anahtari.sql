ALTER TABLE "findings" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "client_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_client_key_uq" ON "findings" USING btree ("client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_client_key_uq" ON "invoices" USING btree ("client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "waste_entries_client_key_uq" ON "waste_entries" USING btree ("client_key");
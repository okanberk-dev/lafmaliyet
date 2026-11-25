DROP INDEX "invoices_external_id_uq";--> statement-breakpoint
DROP INDEX "invoices_e_invoice_id_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_external_id_uq" ON "invoices" USING btree (coalesce("parasut_account", 'tuzla'),"external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_e_invoice_id_uq" ON "invoices" USING btree (coalesce("parasut_account", 'tuzla'),"e_invoice_id");
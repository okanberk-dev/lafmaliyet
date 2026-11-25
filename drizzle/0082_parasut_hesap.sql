DROP INDEX "invoices_external_id_uq";--> statement-breakpoint
DROP INDEX "invoices_e_invoice_id_uq";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "parasut_account" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "parasut_sync_runs" ADD COLUMN "account" text DEFAULT 'tuzla' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parasut_account_branches_id_fk" FOREIGN KEY ("parasut_account") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_branch_idx" ON "invoices" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "parasut_sync_runs_account_idx" ON "parasut_sync_runs" USING btree ("account","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_external_id_uq" ON "invoices" USING btree ("parasut_account","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_e_invoice_id_uq" ON "invoices" USING btree ("parasut_account","e_invoice_id");
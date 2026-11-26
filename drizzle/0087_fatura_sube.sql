ALTER TABLE "invoices" ADD COLUMN "company_wide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "default_branch_id" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "default_company_wide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_default_branch_id_branches_id_fk" FOREIGN KEY ("default_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_wide_ck" CHECK (not ("invoices"."company_wide" and "invoices"."branch_id" is not null));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_default_branch_ck" CHECK (not ("suppliers"."default_company_wide" and "suppliers"."default_branch_id" is not null));
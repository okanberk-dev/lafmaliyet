CREATE TABLE "supplier_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer,
	"debt_id" integer,
	"origin_debt_id" integer,
	"amount" double precision NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_allocations_amount_ck" CHECK ("supplier_allocations"."amount" > 0),
	CONSTRAINT "supplier_allocations_target_ck" CHECK (num_nonnulls("supplier_allocations"."invoice_id", "supplier_allocations"."debt_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "supplier_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"kind" text NOT NULL,
	"date" text NOT NULL,
	"amount" double precision NOT NULL,
	"description" text,
	"note" text,
	"cost_mode" text,
	"category_id" integer,
	"due_date" text,
	"invoice_id" integer,
	"linked_at" timestamp with time zone,
	"link_prev" jsonb,
	"adopt_prev" jsonb,
	"remind_after" text,
	"dismissed_invoice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed_cash_out_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"method" text,
	"cash_out_id" integer,
	"cash_out_created" boolean DEFAULT false NOT NULL,
	"photo_id" integer,
	"created_by" integer,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_entries_amount_ck" CHECK ("supplier_entries"."amount" > 0),
	CONSTRAINT "supplier_entries_kind_ck" CHECK (("supplier_entries"."kind" = 'borc' and "supplier_entries"."cost_mode" is not null and "supplier_entries"."method" is null and "supplier_entries"."cash_out_id" is null) or ("supplier_entries"."kind" = 'odeme' and "supplier_entries"."method" is not null and "supplier_entries"."cost_mode" is null and "supplier_entries"."invoice_id" is null and "supplier_entries"."due_date" is null and "supplier_entries"."category_id" is null)),
	CONSTRAINT "supplier_entries_kasa_ck" CHECK ("supplier_entries"."kind" <> 'odeme' or (("supplier_entries"."method" = 'kasa') = ("supplier_entries"."cash_out_id" is not null))),
	CONSTRAINT "supplier_entries_gider_ck" CHECK ("supplier_entries"."cost_mode" is distinct from 'gider' or "supplier_entries"."category_id" is not null or "supplier_entries"."invoice_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "expense_entries" ADD COLUMN "supplier_entry_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "allocated" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ledger_base" double precision;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_by_ledger" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_allocations" ADD CONSTRAINT "supplier_allocations_payment_id_supplier_entries_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_allocations" ADD CONSTRAINT "supplier_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_allocations" ADD CONSTRAINT "supplier_allocations_debt_id_supplier_entries_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."supplier_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_allocations" ADD CONSTRAINT "supplier_allocations_origin_debt_id_supplier_entries_id_fk" FOREIGN KEY ("origin_debt_id") REFERENCES "public"."supplier_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_cash_out_id_cash_outs_id_fk" FOREIGN KEY ("cash_out_id") REFERENCES "public"."cash_outs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_allocations_payment_idx" ON "supplier_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "supplier_allocations_invoice_idx" ON "supplier_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "supplier_allocations_debt_idx" ON "supplier_allocations" USING btree ("debt_id");--> statement-breakpoint
CREATE INDEX "supplier_entries_supplier_idx" ON "supplier_entries" USING btree ("supplier_id","date");--> statement-breakpoint
CREATE INDEX "supplier_entries_invoice_idx" ON "supplier_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_entries_cash_out_uq" ON "supplier_entries" USING btree ("cash_out_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_entries_photo_uq" ON "supplier_entries" USING btree ("photo_id");--> statement-breakpoint
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_supplier_entry_id_supplier_entries_id_fk" FOREIGN KEY ("supplier_entry_id") REFERENCES "public"."supplier_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_entries_supplier_entry_uq" ON "expense_entries" USING btree ("supplier_entry_id");
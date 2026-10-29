CREATE TABLE "tax_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"span" text DEFAULT 'ay' NOT NULL,
	"kind" text NOT NULL,
	"amount" double precision NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_adjustments_amount_pos" CHECK ("tax_adjustments"."amount" > 0),
	CONSTRAINT "tax_adjustments_span_kind" CHECK ("tax_adjustments"."span" = 'ay' or "tax_adjustments"."kind" in ('gelir_kafe_disi', 'gider_kafe_disi'))
);
--> statement-breakpoint
CREATE TABLE "tax_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"invoice_id" integer,
	"invoice_label" text,
	"acquired_on" text NOT NULL,
	"cost" double precision NOT NULL,
	"kind" text DEFAULT 'demirbas' NOT NULL,
	"method" text DEFAULT 'amortisman' NOT NULL,
	"life_years" integer,
	"note" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_assets_cost_pos" CHECK ("tax_assets"."cost" > 0),
	CONSTRAINT "tax_assets_life_range" CHECK ("tax_assets"."life_years" is null or "tax_assets"."life_years" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "tax_filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"payable" double precision NOT NULL,
	"stamp" double precision DEFAULT 0 NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"entered_by" integer,
	"entered_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "tax_doc" text;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "tax_doc" text;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "tax_withholding" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_not_asset" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_assets" ADD CONSTRAINT "tax_assets_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_adjustments_month_idx" ON "tax_adjustments" USING btree ("month");--> statement-breakpoint
CREATE INDEX "tax_assets_invoice_idx" ON "tax_assets" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filings_kind_period_uq" ON "tax_filings" USING btree ("kind","period");
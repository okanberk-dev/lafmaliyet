CREATE TABLE "integration_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parasut_bill_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"product_key" text NOT NULL,
	"product_name" text NOT NULL,
	"description" text,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"unit" text,
	"unit_price" double precision DEFAULT 0 NOT NULL,
	"discount" double precision DEFAULT 0 NOT NULL,
	"vat_rate" double precision DEFAULT 0 NOT NULL,
	"net_total" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parasut_category_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_type" text NOT NULL,
	"pattern" text NOT NULL,
	"category" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parasut_product_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_key" text NOT NULL,
	"product_name" text NOT NULL,
	"ingredient_id" integer NOT NULL,
	"factor" double precision DEFAULT 1 NOT NULL,
	"update_price" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parasut_product_links_product_key_unique" UNIQUE("product_key")
);
--> statement-breakpoint
CREATE TABLE "parasut_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"message" text
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "vat" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parasut_bill_lines" ADD CONSTRAINT "parasut_bill_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parasut_product_links" ADD CONSTRAINT "parasut_product_links_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parasut_bill_lines_external_uq" ON "parasut_bill_lines" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "parasut_bill_lines_product_idx" ON "parasut_bill_lines" USING btree ("product_key");--> statement-breakpoint
CREATE INDEX "parasut_sync_runs_started_idx" ON "parasut_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_external_id_uq" ON "invoices" USING btree ("external_id");
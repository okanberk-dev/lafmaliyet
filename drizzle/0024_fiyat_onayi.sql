CREATE TABLE "ingredient_price_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"ingredient_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"product_key" text NOT NULL,
	"product_name" text NOT NULL,
	"factor" double precision NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text,
	"net_total" double precision NOT NULL,
	"invoice_date" text NOT NULL,
	"supplier" text NOT NULL,
	"invoice_no" text,
	"package_price" double precision NOT NULL,
	"package_size" double precision NOT NULL,
	"prev_package_price" double precision NOT NULL,
	"prev_package_size" double precision NOT NULL,
	"prev_is_estimate" boolean DEFAULT false NOT NULL,
	"last_unit_price" double precision,
	"last_date" text,
	"last_supplier" text,
	"repeats" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"stopped_updates" boolean DEFAULT false NOT NULL,
	"decided_by" integer,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient_price_holds" ADD CONSTRAINT "ingredient_price_holds_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_price_holds" ADD CONSTRAINT "ingredient_price_holds_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_price_holds" ADD CONSTRAINT "ingredient_price_holds_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_price_holds_pending_uq" ON "ingredient_price_holds" USING btree ("ingredient_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "ingredient_price_holds_status_idx" ON "ingredient_price_holds" USING btree ("status","created_at");
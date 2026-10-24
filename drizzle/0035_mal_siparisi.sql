CREATE TABLE "quick_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ingredient_id" integer NOT NULL,
	"day" text NOT NULL,
	"qty" double precision NOT NULL,
	"factor" double precision NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counted_by" integer,
	"counted_by_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reorder_items" (
	"ingredient_id" integer PRIMARY KEY NOT NULL,
	"par_base" double precision,
	"lead_days" integer,
	"supplier" text,
	"order_name" text,
	"order_unit" text,
	"order_unit_size" double precision,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"supplier" text NOT NULL,
	"phone" text,
	"channel" text NOT NULL,
	"message" text NOT NULL,
	"note" text,
	"lines" jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" integer,
	"sent_by_name" text NOT NULL,
	"expected_on" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"received_at" timestamp with time zone,
	"received_by" integer,
	"received_by_name" text,
	"invoice_id" integer,
	"manual_match" boolean DEFAULT false NOT NULL,
	"delivery_check" jsonb,
	"checked_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by_name" text,
	"close_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quick_counts" ADD CONSTRAINT "quick_counts_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_counts" ADD CONSTRAINT "quick_counts_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_items" ADD CONSTRAINT "reorder_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quick_counts_ingredient_day_uq" ON "quick_counts" USING btree ("ingredient_id","day");--> statement-breakpoint
CREATE INDEX "quick_counts_counted_idx" ON "quick_counts" USING btree ("counted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_request_uq" ON "supplier_orders" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_invoice_uq" ON "supplier_orders" USING btree ("invoice_id") WHERE invoice_id is not null;--> statement-breakpoint
CREATE INDEX "supplier_orders_status_idx" ON "supplier_orders" USING btree ("status","sent_at");
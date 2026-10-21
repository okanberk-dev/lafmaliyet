CREATE TABLE "waste_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"kind" text NOT NULL,
	"product_id" integer,
	"ingredient_id" integer,
	"name" text NOT NULL,
	"qty" double precision NOT NULL,
	"unit" text NOT NULL,
	"factor" double precision DEFAULT 1 NOT NULL,
	"reason" text,
	"note" text,
	"created_by" integer,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "off_revenue" double precision;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waste_entries_date_idx" ON "waste_entries" USING btree ("date");
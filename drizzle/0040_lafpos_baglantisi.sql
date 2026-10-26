CREATE TABLE "pos_daily_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"pos_name" text NOT NULL,
	"product_id" integer,
	"qty" double precision NOT NULL,
	"revenue" double precision NOT NULL,
	"is_service" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_day_reports" (
	"date" text PRIMARY KEY NOT NULL,
	"z" jsonb NOT NULL,
	"payments" jsonb NOT NULL,
	"ikram" jsonb NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_daily_sales" ADD CONSTRAINT "pos_daily_sales_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_daily_sales_date_pos_name_uq" ON "pos_daily_sales" USING btree ("date","pos_name");
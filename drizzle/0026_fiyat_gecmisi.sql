CREATE TABLE "product_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"price_before" double precision,
	"price" double precision NOT NULL,
	"source" text NOT NULL,
	"on_site" boolean DEFAULT false NOT NULL,
	"batch_id" text,
	"note" text,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pos_stale_price" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pos_stale_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_prices_product_idx" ON "product_prices" USING btree ("product_id","changed_at");--> statement-breakpoint
CREATE INDEX "product_prices_changed_idx" ON "product_prices" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "product_prices_batch_idx" ON "product_prices" USING btree ("batch_id");
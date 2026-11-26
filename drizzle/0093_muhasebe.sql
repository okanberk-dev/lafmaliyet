CREATE TABLE "recipe_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"source" text DEFAULT 'edit' NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"summary" text NOT NULL,
	"changed_by" integer,
	"changed_by_name" text NOT NULL,
	"requested_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_entries" ADD COLUMN "period_date" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "period_date" text;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_versions_product_idx" ON "recipe_versions" USING btree ("product_id","created_at");
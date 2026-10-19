CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_name" text,
	"action" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"section" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fixed_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"section" text NOT NULL,
	"period" text DEFAULT 'aylik' NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"ingredient_id" integer NOT NULL,
	"package_price" double precision NOT NULL,
	"package_size" double precision NOT NULL,
	"note" text,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"supplier" text,
	"package_desc" text,
	"package_price" double precision DEFAULT 0 NOT NULL,
	"package_size" double precision DEFAULT 1 NOT NULL,
	"unit" text NOT NULL,
	"vat_rate" double precision DEFAULT 0.01 NOT NULL,
	"note" text,
	"is_estimate" boolean DEFAULT false NOT NULL,
	"price_source" text DEFAULT 'manual' NOT NULL,
	"count_unit" text,
	"count_group" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"date" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"supplier" text NOT NULL,
	"description" text,
	"invoice_no" text,
	"category" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"discount" double precision DEFAULT 0 NOT NULL,
	"payable" double precision DEFAULT 0 NOT NULL,
	"unpaid" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "months" (
	"month" text PRIMARY KEY NOT NULL,
	"open_days" integer,
	"pos_revenue" double precision,
	"discounts" double precision DEFAULT 0 NOT NULL,
	"off_revenue" double precision DEFAULT 0 NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pnl_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"row_key" text NOT NULL,
	"amount" double precision NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_mappings" (
	"pos_name" text PRIMARY KEY NOT NULL,
	"product_id" integer,
	"is_service" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"size" text NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"fire_override" double precision,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"show_on_menu" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_quantities" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"ingredient_id" integer NOT NULL,
	"qty" double precision NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "recipe_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"ingredient_id" integer NOT NULL,
	"qty" double precision DEFAULT 0 NOT NULL,
	"qty_expr" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"pos_name" text NOT NULL,
	"qty" double precision DEFAULT 0 NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"product_id" integer,
	"is_service" boolean DEFAULT false NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"net_salary" double precision DEFAULT 0 NOT NULL,
	"extras" double precision DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"ingredient_id" integer NOT NULL,
	"qty" double precision NOT NULL,
	"counted_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_extras" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'ADET' NOT NULL,
	"qty" double precision DEFAULT 0 NOT NULL,
	"unit_price" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ingredient_prices" ADD CONSTRAINT "ingredient_prices_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_mappings" ADD CONSTRAINT "pos_mappings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_quantities" ADD CONSTRAINT "purchase_quantities_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_month_months_month_fk" FOREIGN KEY ("month") REFERENCES "public"."months"("month") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ingredient_prices_ingredient_idx" ON "ingredient_prices" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "pnl_entries_month_row_uq" ON "pnl_entries" USING btree ("month","row_key");--> statement-breakpoint
CREATE UNIQUE INDEX "products_name_size_uq" ON "products" USING btree ("name","size");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_quantities_month_ingredient_uq" ON "purchase_quantities" USING btree ("month","ingredient_id");--> statement-breakpoint
CREATE INDEX "recipe_items_product_idx" ON "recipe_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "recipe_items_ingredient_idx" ON "recipe_items" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "sales_lines_month_idx" ON "sales_lines" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_month_ingredient_uq" ON "stock_counts" USING btree ("month","ingredient_id");
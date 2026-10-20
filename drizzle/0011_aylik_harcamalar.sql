CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"section" text DEFAULT 'genel' NOT NULL,
	"panel_group" text DEFAULT 'diger' NOT NULL,
	"invoice_category" text,
	"monthly" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "expense_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"category_id" integer NOT NULL,
	"description" text,
	"amount" double precision NOT NULL,
	"payment_method" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_entries_date_idx" ON "expense_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "expense_entries_category_idx" ON "expense_entries" USING btree ("category_id");--> statement-breakpoint
INSERT INTO "expense_categories" ("name", "section", "panel_group", "sort_order") VALUES ('Nakit malzeme alımı', 'mal', 'diger', 1), ('Bakım & onarım', 'genel', 'diger', 2), ('Diğer fatura dışı', 'genel', 'diger', 3) ON CONFLICT ("name") DO NOTHING;

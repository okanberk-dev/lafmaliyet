CREATE TABLE "stock_receipts" (
	"invoice_id" integer PRIMARY KEY NOT NULL,
	"branch_id" text DEFAULT 'tuzla' NOT NULL,
	"marked_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_thresholds" (
	"branch_id" text DEFAULT 'tuzla' NOT NULL,
	"ingredient_id" integer NOT NULL,
	"qty" double precision NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_thresholds_branch_id_ingredient_id_pk" PRIMARY KEY("branch_id","ingredient_id"),
	CONSTRAINT "stock_thresholds_qty_ck" CHECK ("stock_thresholds"."qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;
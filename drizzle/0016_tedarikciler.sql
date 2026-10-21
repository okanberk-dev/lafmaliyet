CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legal_name" text,
	"tax_number" text,
	"tax_office" text,
	"iban" text,
	"bank_name" text,
	"account_holder" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"payment_term_days" integer,
	"payment_method" text,
	"paid_on_delivery" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_at" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_via" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_requested_at" text;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_key_uq" ON "suppliers" USING btree ("key");
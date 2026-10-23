CREATE TABLE "invoice_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"product_key" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text,
	"model" text,
	"ai_call_id" integer,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_readings" ADD CONSTRAINT "invoice_readings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_readings" ADD CONSTRAINT "invoice_readings_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_readings" ADD CONSTRAINT "invoice_readings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_readings_invoice_product_uq" ON "invoice_readings" USING btree ("invoice_id","product_key");
CREATE TABLE "invoice_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "e_invoice_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "e_invoice_uuid" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_documents_invoice_idx" ON "invoice_documents" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_e_invoice_id_uq" ON "invoices" USING btree ("e_invoice_id");
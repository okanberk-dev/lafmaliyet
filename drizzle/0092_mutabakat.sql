CREATE TABLE "recon_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"scope" text NOT NULL,
	"fingerprint" text NOT NULL,
	"row_no" integer NOT NULL,
	"date" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" double precision NOT NULL,
	"balance" double precision,
	"ref" text,
	"decision" text,
	"match_kind" text,
	"match_id" integer,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "recon_lines_amount_ck" CHECK ("recon_lines"."amount" <> 0),
	CONSTRAINT "recon_lines_match_ck" CHECK (("recon_lines"."decision" is not distinct from 'elle') = ("recon_lines"."match_kind" is not null and "recon_lines"."match_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "recon_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"account" text NOT NULL,
	"supplier_card_id" integer,
	"supplier_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_name" text,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"uploaded_on" text NOT NULL,
	"expires_on" text NOT NULL,
	"created_by" integer,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recon_statements_period_ck" CHECK ("recon_statements"."period_from" <= "recon_statements"."period_to"),
	CONSTRAINT "recon_statements_supplier_ck" CHECK ("recon_statements"."kind" = 'tedarikci' or ("recon_statements"."supplier_card_id" is null and "recon_statements"."supplier_names" = '[]'::jsonb))
);
--> statement-breakpoint
ALTER TABLE "recon_lines" ADD CONSTRAINT "recon_lines_statement_id_recon_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."recon_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_statements" ADD CONSTRAINT "recon_statements_supplier_card_id_suppliers_id_fk" FOREIGN KEY ("supplier_card_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_statements" ADD CONSTRAINT "recon_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recon_lines_statement_idx" ON "recon_lines" USING btree ("statement_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_lines_fingerprint_uq" ON "recon_lines" USING btree ("scope","fingerprint");--> statement-breakpoint
CREATE INDEX "recon_statements_expires_idx" ON "recon_statements" USING btree ("expires_on");
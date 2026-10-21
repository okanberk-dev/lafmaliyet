CREATE TABLE "cash_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"z_no" text,
	"receipts" integer,
	"z_total" double precision DEFAULT 0 NOT NULL,
	"cash" double precision DEFAULT 0 NOT NULL,
	"card" double precision DEFAULT 0 NOT NULL,
	"meal_card" double precision DEFAULT 0 NOT NULL,
	"online" double precision DEFAULT 0 NOT NULL,
	"other" double precision DEFAULT 0 NOT NULL,
	"opening_cash" double precision DEFAULT 0 NOT NULL,
	"cash_out" double precision DEFAULT 0 NOT NULL,
	"cash_out_note" text,
	"counted_cash" double precision DEFAULT 0 NOT NULL,
	"handed_over" double precision DEFAULT 0 NOT NULL,
	"bank_pos" double precision,
	"note" text,
	"cash_diff" double precision DEFAULT 0 NOT NULL,
	"submitted_by" integer,
	"submitted_by_name" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"email_status" text,
	"email_error" text,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_reports_date_uq" ON "cash_reports" USING btree ("date");
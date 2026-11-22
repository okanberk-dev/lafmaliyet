CREATE TABLE "lafpos_day_ends" (
	"date" text NOT NULL,
	"branch_id" text DEFAULT 'tuzla' NOT NULL,
	"report_id" integer,
	"auto_values" jsonb,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"day_hash" text,
	"emailed_hash" text,
	"email_count" integer DEFAULT 0 NOT NULL,
	"email_error" text,
	"emailed_at" timestamp with time zone,
	"sending_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lafpos_day_ends_date_branch_id_pk" PRIMARY KEY("date","branch_id")
);
--> statement-breakpoint
ALTER TABLE "lafpos_day_ends" ADD CONSTRAINT "lafpos_day_ends_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lafpos_day_ends" ADD CONSTRAINT "lafpos_day_ends_report_id_cash_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."cash_reports"("id") ON DELETE set null ON UPDATE no action;
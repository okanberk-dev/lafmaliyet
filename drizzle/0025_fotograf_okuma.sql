CREATE TABLE "ai_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"served_model" text,
	"status" text NOT NULL,
	"error_code" text,
	"user_id" integer,
	"photo_id" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL,
	"ms" integer,
	"stop_reason" text,
	"request_id" text,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "cash_outs" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"kind" text DEFAULT 'harcama' NOT NULL,
	"amount" double precision NOT NULL,
	"store" text,
	"description" text,
	"receipt_date" text,
	"receipt_no" text,
	"vat" double precision,
	"doc_type" text DEFAULT 'yok' NOT NULL,
	"photo_id" integer,
	"created_by" integer,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_report_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"photo_id" integer NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_by" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "expense_entries" ADD COLUMN "photo_id" integer;--> statement-breakpoint
ALTER TABLE "expense_entries" ADD COLUMN "vat" double precision;--> statement-breakpoint
ALTER TABLE "expense_entries" ADD COLUMN "cash_out_id" integer;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_outs" ADD CONSTRAINT "cash_outs_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_outs" ADD CONSTRAINT "cash_outs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_report_photos" ADD CONSTRAINT "cash_report_photos_report_id_cash_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."cash_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_report_photos" ADD CONSTRAINT "cash_report_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_at_idx" ON "ai_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ai_calls_photo_idx" ON "ai_calls" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "cash_outs_date_idx" ON "cash_outs" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_outs_photo_uq" ON "cash_outs" USING btree ("photo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_report_photos_photo_uq" ON "cash_report_photos" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "cash_report_photos_report_idx" ON "cash_report_photos" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_storage_key_uq" ON "photos" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "photos_expires_idx" ON "photos" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "photos_created_by_idx" ON "photos" USING btree ("created_by","created_at");--> statement-breakpoint
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_cash_out_id_cash_outs_id_fk" FOREIGN KEY ("cash_out_id") REFERENCES "public"."cash_outs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_entries_photo_uq" ON "expense_entries" USING btree ("photo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_entries_cash_out_uq" ON "expense_entries" USING btree ("cash_out_id");
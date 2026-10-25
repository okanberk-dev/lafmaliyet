CREATE TABLE "pos_marks" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"price" double precision NOT NULL,
	"stale_price" double precision NOT NULL,
	"stale_since" timestamp with time zone NOT NULL,
	"marked_by" integer,
	"marked_by_name" text NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_name" text
);
--> statement-breakpoint
CREATE TABLE "staff_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"day" text,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"client_key" text,
	"photo_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"requested_by" integer,
	"requested_by_name" text NOT NULL,
	"review_note" text,
	"reviewed_by" integer,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"result_id" integer,
	"result" jsonb,
	"expires_at" timestamp with time zone,
	"bumped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD COLUMN "staff_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "approvals" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_change_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "special_days" ADD COLUMN "by_staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "special_days" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "special_days" ADD COLUMN "updated_by_name" text;--> statement-breakpoint
ALTER TABLE "pos_marks" ADD CONSTRAINT "pos_marks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_marks" ADD CONSTRAINT "pos_marks_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_requests" ADD CONSTRAINT "staff_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_requests" ADD CONSTRAINT "staff_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_marks_marked_idx" ON "pos_marks" USING btree ("marked_at");--> statement-breakpoint
CREATE INDEX "pos_marks_user_idx" ON "pos_marks" USING btree ("marked_by","marked_at");--> statement-breakpoint
CREATE INDEX "pos_marks_product_idx" ON "pos_marks" USING btree ("product_id","marked_at");--> statement-breakpoint
CREATE INDEX "staff_requests_status_idx" ON "staff_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "staff_requests_requester_idx" ON "staff_requests" USING btree ("requested_by","status","updated_at");--> statement-breakpoint
CREATE INDEX "staff_requests_day_idx" ON "staff_requests" USING btree ("kind","day");--> statement-breakpoint
CREATE INDEX "staff_requests_result_idx" ON "staff_requests" USING btree ("kind","result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_requests_pending_uq" ON "staff_requests" USING btree ("kind","subject","requested_by") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "staff_requests_live_draft_uq" ON "staff_requests" USING btree ("subject") WHERE kind = 'mal-taslak' and status in ('pending', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "staff_requests_client_key_uq" ON "staff_requests" USING btree ("client_key");--> statement-breakpoint
ALTER TABLE "special_days" ADD CONSTRAINT "special_days_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
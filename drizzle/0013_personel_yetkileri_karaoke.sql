CREATE TABLE "karaoke_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text,
	"source" text DEFAULT 'site' NOT NULL,
	"date" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"guests" integer,
	"customer_name" text,
	"note" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"payment_status" text DEFAULT 'none' NOT NULL,
	"total_minor" integer,
	"channel" text,
	"ext_updated_at" text,
	"last_event" text,
	"last_event_at" timestamp with time zone,
	"extra_minutes" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text,
	"auth" text,
	"label" text,
	"session_version" integer NOT NULL,
	"karaoke" boolean DEFAULT true NOT NULL,
	"reminders" boolean DEFAULT true NOT NULL,
	"last_success_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"requested_by" integer,
	"requested_by_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"message" text,
	"review_note" text,
	"reviewed_by" integer,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"due_date" text NOT NULL,
	"due_time" text,
	"anchor_date" text NOT NULL,
	"repeat" text DEFAULT 'none' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_change_requests" ADD CONSTRAINT "recipe_change_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_change_requests" ADD CONSTRAINT "recipe_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_change_requests" ADD CONSTRAINT "recipe_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reminders" ADD CONSTRAINT "user_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "karaoke_sessions_external_uq" ON "karaoke_sessions" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "karaoke_sessions_starts_idx" ON "karaoke_sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "karaoke_sessions_date_idx" ON "karaoke_sessions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipe_change_requests_status_idx" ON "recipe_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "recipe_change_requests_product_idx" ON "recipe_change_requests" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_change_requests_pending_uq" ON "recipe_change_requests" USING btree ("product_id","requested_by") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "user_reminders_user_idx" ON "user_reminders" USING btree ("user_id","active","due_date");
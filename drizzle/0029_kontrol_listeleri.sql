CREATE TABLE "checklist_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"value" double precision,
	"text_value" text,
	"note" text,
	"photo_id" integer,
	"photo_at" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answered_by" integer,
	"answered_by_name" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'check' NOT NULL,
	"section" text,
	"hint" text,
	"required" boolean DEFAULT true NOT NULL,
	"unit" text,
	"min" double precision,
	"max" double precision,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"date" text NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"opens_at" text,
	"due_at" text,
	"items" jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" integer,
	"completed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schedule" text DEFAULT 'daily' NOT NULL,
	"opens_at" text,
	"due_at" text,
	"weekdays" jsonb DEFAULT '[1,2,3,4,5,6,7]'::jsonb NOT NULL,
	"staff_allowed" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"inactive_from" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_templates_name_unique" UNIQUE("name"),
	CONSTRAINT "checklist_templates_window_ck" CHECK ("checklist_templates"."schedule" = 'event' or ("checklist_templates"."opens_at" is not null and "checklist_templates"."due_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "checklist_answers" ADD CONSTRAINT "checklist_answers_run_id_checklist_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."checklist_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_answers" ADD CONSTRAINT "checklist_answers_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_answers" ADD CONSTRAINT "checklist_answers_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_answers_run_item_uq" ON "checklist_answers" USING btree ("run_id","item_id");--> statement-breakpoint
CREATE INDEX "checklist_answers_photo_idx" ON "checklist_answers" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "checklist_items_template_idx" ON "checklist_items" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_runs_template_day_uq" ON "checklist_runs" USING btree ("template_id","date","seq");--> statement-breakpoint
CREATE INDEX "checklist_runs_date_idx" ON "checklist_runs" USING btree ("date");
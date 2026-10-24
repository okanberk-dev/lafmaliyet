CREATE TABLE "forecast_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"made_on" text NOT NULL,
	"amount" double precision NOT NULL,
	"low" double precision NOT NULL,
	"high" double precision NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"staff" integer,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "special_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"date_from" text NOT NULL,
	"date_to" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"effect" double precision DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" integer,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_days_range_ck" CHECK ("special_days"."date_from" <= "special_days"."date_to"),
	CONSTRAINT "special_days_effect_ck" CHECK ("special_days"."effect" >= -1 and "special_days"."effect" <= 1)
);
--> statement-breakpoint
CREATE TABLE "weather_days" (
	"date" text PRIMARY KEY NOT NULL,
	"t_max" double precision,
	"t_min" double precision,
	"precip_mm" double precision,
	"symbol" text,
	"hours" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "special_days" ADD CONSTRAINT "special_days_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_snapshots_date_made_uq" ON "forecast_snapshots" USING btree ("date","made_on");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_made_idx" ON "forecast_snapshots" USING btree ("made_on");--> statement-breakpoint
CREATE INDEX "special_days_from_idx" ON "special_days" USING btree ("date_from");
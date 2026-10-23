CREATE TABLE "commission_months" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"month" text NOT NULL,
	"sales" double precision,
	"received_on" text,
	"received" double precision,
	"note" text,
	"updated_by" integer,
	"updated_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_months_received_pair" CHECK (("commission_months"."received_on" is null) = ("commission_months"."received" is null))
);
--> statement-breakpoint
ALTER TABLE "commission_months" ADD CONSTRAINT "commission_months_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_months_channel_month_uq" ON "commission_months" USING btree ("channel","month");
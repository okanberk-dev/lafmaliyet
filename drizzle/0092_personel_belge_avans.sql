CREATE TABLE "staff_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"date" text NOT NULL,
	"kind" text NOT NULL,
	"amount" double precision NOT NULL,
	"note" text,
	"created_by" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_advances_kind_ck" CHECK ("staff_advances"."kind" in ('avans','kesinti')),
	CONSTRAINT "staff_advances_amount_ck" CHECK ("staff_advances"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"issued_on" text,
	"valid_until" text,
	"note" text,
	"storage_key" text,
	"content_type" text,
	"size_bytes" integer,
	"file_name" text,
	"created_by" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_advances_staff_idx" ON "staff_advances" USING btree ("staff_id","date");--> statement-breakpoint
CREATE INDEX "staff_documents_staff_idx" ON "staff_documents" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_documents_valid_idx" ON "staff_documents" USING btree ("valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_documents_storage_key_uq" ON "staff_documents" USING btree ("storage_key");
CREATE TABLE "lafpos_installs" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"downloads" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lafpos_installs_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "lafpos_installs" ADD CONSTRAINT "lafpos_installs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lafpos_installs" ADD CONSTRAINT "lafpos_installs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lafpos_installs_branch_idx" ON "lafpos_installs" USING btree ("branch_id","created_at");
CREATE TABLE "branch_settings" (
	"branch_id" text NOT NULL,
	"grp" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb,
	"same_as" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_settings_branch_id_grp_pk" PRIMARY KEY("branch_id","grp"),
	CONSTRAINT "branch_settings_not_self_ck" CHECK ("branch_settings"."same_as" is null or "branch_settings"."same_as" <> "branch_settings"."branch_id"),
	CONSTRAINT "branch_settings_linked_empty_ck" CHECK ("branch_settings"."same_as" is null or ("branch_settings"."value" = '{}'::jsonb and "branch_settings"."secrets" is null))
);
--> statement-breakpoint
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_same_as_branches_id_fk" FOREIGN KEY ("same_as") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_settings_same_as_idx" ON "branch_settings" USING btree ("same_as");
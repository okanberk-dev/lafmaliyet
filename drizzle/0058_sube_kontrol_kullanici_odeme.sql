ALTER TABLE "checklist_templates" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Karaoke odası maddesi olan listeler (hazır Açılış ve Kapanış) Tuzla'nındır: Marina'da karaoke yok, Marina kendi
-- listelerini tohumla alır (src/lib/checklist-seed.ts MARINA_CHECKLISTS). Diğer listeler, var olan ödeme
-- hatırlatıcıları ve kullanıcılar şubesiz (bütün şubeler / işletme geneli) kalır; yönetici ekrandan taşır.
UPDATE "checklist_templates" SET "branch_id" = 'tuzla' WHERE "branch_id" IS NULL AND "id" IN (SELECT "template_id" FROM "checklist_items" WHERE "section" = 'Karaoke odası');

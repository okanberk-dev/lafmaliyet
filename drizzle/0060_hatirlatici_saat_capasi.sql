ALTER TABLE "user_reminders" ADD COLUMN "anchor_time" text;--> statement-breakpoint
-- Tekrarın saati (denetim 21 Kasım #15): var olan hatırlatıcıların saati bugünkü saatleri. O an "1 saat sonra"
-- ertelenmiş olanın saati ertelenmiş saattir; formdan saati düzeltmek çapayı da yeniden yazar.
UPDATE "user_reminders" SET "anchor_time" = "due_time" WHERE "anchor_time" IS NULL;

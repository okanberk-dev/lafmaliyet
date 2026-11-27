CREATE TABLE "setting_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"branch_id" text DEFAULT '' NOT NULL,
	"from_month" text NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_versions_month_ck" CHECK ("setting_versions"."from_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "setting_versions_key_month_uq" ON "setting_versions" USING btree ("key","branch_id","from_month");--> statement-breakpoint
-- Bugünkü değerler ilk aydan (2000-01) geçerli ilk sürüm olur: hiçbir ayın rakamı değişmez (src/lib/month-settings.ts).
-- Kaydı olmayan anahtar varsayılanı okumaya devam eder (sürümsüz).
INSERT INTO "setting_versions" ("key", "branch_id", "from_month", "value", "note", "created_by")
SELECT "key", '', '2000-01', ("value" #>> '{}')::double precision, 'Başlangıç: P5 öncesi tek değer', 'Göç'
FROM "settings"
WHERE "key" IN ('kdv','kdvHizmet','komisyon','kartOrani','fire','isciSgk','isciIssizlik','isverenSgk','isverenIssizlik','mealCardDaily','mealCardDays','alisKdvAmbalaj','alisKdvGida')
  AND jsonb_typeof("value") = 'number'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "setting_versions" ("key", "branch_id", "from_month", "value", "note", "created_by")
SELECT 'posRate', "id", '2000-01', "pos_rate", 'Başlangıç: P5 öncesi tek değer', 'Göç'
FROM "branches"
WHERE "kind" = 'fiziksel'
ON CONFLICT DO NOTHING;

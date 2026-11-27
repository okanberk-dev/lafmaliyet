-- Şube görünümü (şube ayrımı D, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı): kişinin ekran ekran "yalnız şube" ya da
-- "firma geneli" tercihi (src/lib/branch-view.ts). Yalnız ekleme: sabit varsayılanlı sütun, eski sürüm okumaz ve yazmaz
-- (geri dönüşe uygun); oturum sürümü değişmez.
ALTER TABLE "users" ADD COLUMN "branch_view" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_view_ck" CHECK (jsonb_typeof("users"."branch_view") = 'object');

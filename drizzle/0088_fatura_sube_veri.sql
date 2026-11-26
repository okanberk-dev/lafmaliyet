-- Faturanın şubesi (25 Kasım 2026; docs/SUBE.md › Faturanın şubesi). Bugüne kadar şubesi boş fatura "işletme geneli"
-- sayılıyor, iki şubede de görünüyordu. Artık boş şube "Şubesi seçilmemiş"tir; işletme geneli bilinçli bir seçimdir
-- (company_wide). Tahminle şube yazılmaz: yalnız kayıtlı seçimler taşınır, gerisi "Şubesi seçilmemiş" kutusuna düşer ve
-- ekran kanıta dayalı öneriyi gösterir (src/lib/invoice-branch.ts suggestInvoiceBranch). Göç iki kez koşsa da aynı sonuç.
--
-- 1. Ayrı Paraşüt hesabından gelip "faturalar işletme geneli" seçimiyle şubesiz açılan fatura bilinçli işletme genelidir.
UPDATE "invoices"
SET "company_wide" = true
WHERE "branch_id" IS NULL
  AND "parasut_account" IS NOT NULL
  AND "parasut_account" <> 'tuzla';
--> statement-breakpoint
-- 2. Tahmini stoğun "Marina'ya gelen faturalar" seçimi (stock_receipts) faturanın şubesi olur: tek doğruluk kaynağı
--    invoices.branch_id. Şubesi zaten seçilmiş ya da işletme geneli faturaya dokunulmaz.
UPDATE "invoices" AS i
SET "branch_id" = r."branch_id"
FROM "stock_receipts" AS r
WHERE r."invoice_id" = i."id"
  AND i."branch_id" IS NULL
  AND i."company_wide" = false;

-- Şube başına Paraşüt hesabı (B4, 25 Kasım 2026; docs/PARASUT.md › Şube başına Paraşüt hesabı). Bugüne kadar tek
-- Paraşüt hesabı vardı ve o varsayılan şubenin (Tuzla) hesabıdır: Paraşüt'e bağlı (gider faturası ya da e-fatura
-- kimliği olan) ya da Paraşüt'ten açılmış her fatura bu hesaba yazılır. Faturanın şubesine (branch_id) dokunulmaz:
-- ortak hesabın faturaları işletme genelidir (boş). Elle ve Excel'le girilmiş, Paraşüt'e bağlanmamış faturada hesap boş
-- kalır. Zaten hesabı olan satıra dokunulmaz (göç iki kez koşsa da aynı sonuç).
UPDATE "invoices"
SET "parasut_account" = 'tuzla'
WHERE "parasut_account" IS NULL
  AND ("external_id" IS NOT NULL OR "e_invoice_id" IS NOT NULL OR "source" = 'parasut' OR "origin" = 'parasut');

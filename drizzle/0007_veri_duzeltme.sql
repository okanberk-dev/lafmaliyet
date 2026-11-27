-- Excel aktarımından kalan iki küçük veri hatasının düzeltmesi.
-- Yalnızca hâlâ aktarılan (seed) değeri taşıyan satırlara dokunur; panelde elle değiştirilmiş kayıtlar olduğu gibi kalır.
-- Kişi adları 26 Kasım 2026'da başlangıç verisindeki (tests/fixtures/baslangic) uydurma adlarla değiştirildi; bu
-- migration canlıda çoktan uygulandı, yeniden çalışmaz (drizzle yalnız tarihe bakar).

-- Tek seferlik yatırımlar: seed hepsini "Temmuz 2026" yazmıştı. Excel yalnızca XND için tarih veriyor;
-- reklam faturası 17.09.2026, tabela/baskı Temmuz–Eylül arasındaki üç faturanın toplamı, klişe bedelinin tarihi yok.
UPDATE "investments" SET "date" = '2026-09'
WHERE "name" = 'Reklam (Berna Kalaycı)' AND "date" = '2026-07' AND "note" = '30.000 ₺ + KDV';--> statement-breakpoint
UPDATE "investments" SET "date" = NULL, "note" = '~15.300 ₺ + KDV · Temmuz–Eylül 2026 faturaları (Musa Şenkaya, Tuzla Baskı)'
WHERE "name" = 'Tabela, baskı (Musa Şenkaya, Tuzla Baskı)' AND "date" = '2026-07' AND "note" = '~15.300 ₺ + KDV';--> statement-breakpoint
UPDATE "investments" SET "date" = NULL
WHERE "name" = 'Bardak baskı klişe bedelleri (Serendi)' AND "date" = '2026-07' AND "note" = '2.847 ₺ + KDV';--> statement-breakpoint

-- Faturalar: "ödenmedi / ödendi" açıklamaya gömülüydü; ödeme durumu ayrı alanda tutulduğu için ödenince çelişiyordu.
UPDATE "invoices" SET "description" = 'Gider listesi'
WHERE "supplier" IN ('Kaldi', 'XND Teknoloji') AND "description" IN ('Gider listesi, ödenmedi', 'Gider listesi, ödendi');

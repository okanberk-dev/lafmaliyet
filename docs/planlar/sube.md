# Plan: şubeler, kanallar ve Marina (4 Kasım 2026)

**İstek (sahip):** "şube yönetimi de yap ve laffogato.net cirosunu da ayrı tut; şimdi Laffogato Marina şubesi de
açılıyor, ona göre de bir sekme aç, güzel bir detay yap LafPOS, lafmaliyet için."

Kararlar `docs/SUBE.md`'nin başındaki tabloda. Bu dosya işin dalgalara bölünmüş hâli; kurallar `CRITIQUE.md` §1
(main'e doğrudan push yok, R2 migration protokolü, her dalga bir PR).

## Dalga 1 — kütük ve ekran (BİTTİ)

- `branches` tablosu (`0053_subeler.sql`), tohum (Tuzla, Marina, laffogato.net), `src/lib/branches.ts` (saf
  kurallar), `src/server/branches.ts`, `src/server/actions/branches.ts`, **Ayarlar › Şubeler** ekranı,
  `tests/subeler.test.ts` (11 test), `docs/SUBE.md`.
- Hiçbir ciro tablosuna dokunulmadı: bütün raporlar bugünkü gibi. Risk yok, geri alınabilir.

## Dalga 2 — şube sütunu ciro yoluna, seçici ve süzgeç (BİTTİ)

Sırayla ve **tek migration** (R2): her tabloya `branch_id text not null default 'tuzla' references branches(id)`,
sonra default kaldırılmadan bırakılır (eski satırlar Tuzla'ya yazılmış olur; sahibin kararı).

| Tablo | Anahtar bugün | Anahtar sonra |
|---|---|---|
| `cash_reports` | `date` | `(date, branch_id)` |
| `pos_daily_sales` | `(date, pos_name)` uq | `(date, branch_id, pos_name)` uq |
| `pos_day_reports` | `date` | `(date, branch_id)` |
| `modpos_cash_sheets` | `day` | `(day, branch_id)` |
| `months` / `sales_lines` | `month` | `(month, branch_id)` |
| `cash_outs`, `waste_entries`, `stock_counts` | — | `+ branch_id` **not null**, varsayılan `tuzla` |
| `expense_entries` | — | `+ branch_id` **null olabilir** (null = işletme geneli; sahibin kararı) |
| `staff` | — | `+ branch_id` **not null**, varsayılan `tuzla` (maaş o şubenin gideri) |
| `invoices`, `suppliers`, `ingredients`, `products`, `recipe_items` | — | **değişmez** (ortak) |

Yapıldı (`0056_sube_kirilimi.sql`). Notlar:

- `months` birincil anahtarı yalnız `sales_lines.month` tarafından referanslı çıktı; öteki tabloların çoğu seri
  `id` + benzersiz iş dizini kullanıyor, bu yüzden gerçek anahtar değişikliği üç tablodaydı.
- drizzle-kit, birincil anahtar adlarını çözemediği için DROP satırlarını **yorumlu** bıraktı ve `ADD CONSTRAINT`
  satırını `ADD COLUMN`'dan **önce** yazdı; göç elle sekiz adıma dizildi (önce dizin ve yabancı anahtar düşür,
  sonra sütun ekle, geri doldur, anahtarları kur).
- `branchUsageCount` gerçek sayımı yapıyor; `tests/subeler.test.ts` şube sütunlu her tablonun sayıma girdiğini
  denetler (yeni para tablosu sessizce kaçamaz).
- **Çakışma hedefleri:** bileşik anahtara tek sütunlu `ON CONFLICT` çalışma anında düşer ("no unique or exclusion
  constraint matching"). Dört yer düzeltildi (`pnl.ts` ×2, `sales.ts`, `lafpos/ingest.ts`) ve bekçi test eklendi.
- Seçici dalga 3'ten buraya alındı: şema şubeye bölünüp de süzgeç gelmeseydi, aynı güne iki şube rapor
  girebildiği için `getCashReport(gün)` yanlış şubenin satırını döndürebilirdi. Ayrıntı: `docs/SUBE.md` › Seçici.

## Dalga 3 — kalan okumaların süzülmesi (BİTTİ, 4 Kasım 2026)

Yapıldı: personel, sayım, zayi, harcama (işletme geneliyle), sabit gider (`0057_sabit_gider_subesi.sql`, boş =
işletme geneli), LafPOS gün sonu okumaları seçime göre; şube görünümünde mal maliyeti şubenin satışından reçeteye göre;
vergi, nakit planı, tutarlılık ve Excel seçiciden bağımsız "Tümü"; Maaşlar ve Sabit giderler pencerelerinde **Şube**
alanı; harcama / zayi / sayım / kasadan çıkan seçili şubeye yazılır. Ayrıntı: `docs/SUBE.md` › Şube görünümünde maliyet.
Kalan: laffogato.net kanalının `/panel/gelir-gider` ayrımının bu kanala taşınması (dalga 4'ün sekmeleriyle).

Önceki not:

Dalga 2'de seçici kuruldu ve **anahtarı şubeyi içeren** tabloların okumaları süzüldü (kasa raporu, gün özeti,
ModPOS föyü, ay satırı, satış satırı): oradaki süzgeç doğruluk gereğiydi. Kalanlar seri `id` anahtarlı listeler,
bugün "Tümü" gibi davranıyorlar — gerileme değil, eksik:

- `stock_counts`, `waste_entries`, `cash_outs`, `staff`, `expense_entries` okumaları seçime göre süzülecek.
- Gider süzgeci `branchWhereWithShared` ile: tek şube seçiliyken o şubenin giderleri **ile** işletme geneli
  giderler birlikte görünür, yoksa kira ve abonelik hiçbir şubede görünmez ve kâr olduğundan yüksek çıkar
  (yardımcı yazıldı, çağıran yerler bu dalgada).
- Yazma formlarında hangi şubeye yazıldığı kullanıcıya gösterilecek ("Tümü" seçiliyken Tuzla'ya iner).
- laffogato.net kanalı "Tümü"ye **girer** (işletmenin cirosudur) ama her yerde ayrı satır olarak görünür; bugünkü
  `/panel/gelir-gider` ayrımı bu kanala taşınır.

## Dalga 4 — Marina sekmesi ve karşılaştırma

- Genel bakış, Kasa raporu, Satışlar ve Gelir-gider'e şube sekmeleri (`SectionTab`): Tümü · Tuzla · Marina ·
  laffogato.net.
- Genel bakış'ta şube karşılaştırma kartı: şube başına net satış, brüt kâr, kişi başı sepet, gün sonu farkı.
- Marina'nın ModPOS bilgileri: `modpos` ayarları şube başına (bugün tek takım anahtar var, `docs/MODPOS-API.md`).
  Kasa föyü çekimi şube başına çalışır; günlük 2 istek sınırı şube başına sayılır.

## Dalga 5 — şubeye özel fiyat

- `product_prices`'a `branch_id` (boş = bütün şubeler): Marina'nın fiyatı farklıysa satır açılır, yoksa ortak
  fiyat geçerli. "Satışta / Tükendi" de şube başına (`docs/SITE-MENU.md` ile birlikte).
- Fiyatlar ekranında şube sütunu ve toplu değişiklikte şube seçimi.

## LafPOS tarafı (ayrı depo, `RiosenBeq/lafpos`)

Marina ModPOS kullanacağı için LafPOS'ta acil bir iş yok; yine de gün sonu gönderimi şubesiz kalmamalı:

- Kasanın ayarlarına **şube kimliği** (`sube_id`) eklenir, kurulumda yazılır ve gün sonu özetine konur.
- `POST /api/pos/gun` yükünde `sube` alanı: panel yoksa `tuzla` sayar (geri uyumlu), varsa o şubenin satırını
  yazar. Böylece ileride bir şubeye LafPOS kurulursa panel tarafında iş kalmaz.

## Kararlar (4 Kasım 2026, sahip)

Dalga 2'yi bekleten dört soru cevaplandı:

| Soru | Karar | Şemaya etkisi |
|---|---|---|
| **Giderler** | Şubeye bağlansın; **ortak giderler "işletme geneli" kalsın**, hiçbir şubeye zorlanmasın | `expense_entries.branch_id` **null olabilir** (null = işletme geneli) |
| **Personel** | Herkes **bir şubeye bağlı**; maaşı o şubenin gideri | `staff.branch_id` **not null**, varsayılan `tuzla` |
| **ModPOS** | **Şube başına ayrı anahtar**; günlük 2 çekim hakkı şube başına | Anahtarlar şube kaydında; `modpos_cash_sheets` PK `(day, branch_id)` |
| **Stok ve sayım** | **Şube başına ayrı**; tutarlılık ve FIFO değerleme şube içinde | `stock_counts.branch_id` not null; tüketim hesabı şubeye süzülür |

Bunlardan çıkan iki kural:

- **Null = işletme geneli** yalnız giderde geçerlidir. Ciro, kasa, satış, stok ve personel satırlarında
  `branch_id` boş kalamaz; eski satırlar Tuzla'ya yazılır (sahibin kararı).
- Raporda "Tümü" seçiliyken işletme geneli giderler toplama **girer** ama şube kırılımında ayrı bir
  "İşletme geneli" sütununda durur: bir şubenin kârı ortak giderle şişirilmez.

## Kalan belirsizlik

ModPOS'un tek hesapta iki şubeyi birlikte verip vermediği **ModPOS'tan (Gafdigi) teyit edilmeli**. Şube başına
ayrı anahtar kurulumu her iki durumda da çalışır (anahtar boşsa ortak anahtara düşer), ama Marina'nın kendi
hesabı yoksa föy çekimi açılmadan önce bu netleşmeli.

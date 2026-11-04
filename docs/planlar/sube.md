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

## Dalga 3 — yazmaların şubesi (BİTTİ)

Dalga 3'e "kalan okumaları süz" diye başlandı; **çürütme turu bu planın yanlış olduğunu gösterdi.** 127 sorgu
yeri sınıflandırıldı (34 bütünlük denetimi, 32 kimlikle okuma, 48 yazma, 12 görünüm adayı, 1 belirsiz), sonra
her görünüm adayına ayrı bir şüpheci gönderildi: **12 adaydan 9'u çürütüldü.** Gerekçeler `docs/SUBE.md` ›
Neyi süzer, neyi süzmez.

Bunun yerine yapılan iş yazmalar oldu ve orada gerçek kusurlar çıktı:

- `stock.ts`: sayım silmesi ŞUBESİZDİ — aynı ay ve malzeme için **bütün şubelerin sayımını birden siliyordu**.
- `stock.ts`: `onConflictDoUpdate` hedefi `(ay, malzeme)` idi, benzersiz dizin ise `(ay, şube, malzeme)`:
  çalışma anında "no unique or exclusion constraint matching" ile düşerdi (veritabanında doğrulandı).
  Dalga 2'nin bekçi testi sabit dosya listesi kullandığı için kaçırmıştı; bekçi artık bütün ağacı tarıyor.
- Damgalanmayan eklemeler: personel, kasadan çıkan satırı, kasadan ödeme satırı, zayi / ikram, sayım,
  borcun gider kaydı. Hepsi sessizce varsayılan şubeye (ya da giderde "işletme geneli"ne) iniyordu.
- Geri alma yolları şubeyi kaybediyordu: silinen harcamanın anlık görüntüsünde ve borç–fatura bağının
  `linkPrev`inde şube alanı yoktu. İkisine de eklendi (eski kayıtlarda alan yok, geriye dönük uyumlu).
- Geç zayi isteği artık şubeyi yükünde taşıyor: onay anındaki seçim değil, **personelin girdiği şube** esas.
- **Dalga 2'nin kusuru düzeltildi:** `costs.ts` › `dataMonths` ve `tillRows` şubeye göre süzülüyordu ve bunlar
  personel silme engelini besliyor. Marina seçiliyken Tuzla'da maaş geçmişi olan kişi silinebilir hale
  geliyordu. İkisi de şubesize döndürüldü; `okcRows` (vergi) ve `loadDataset`'in dizileri de öyle.

Yeni yazma yardımcıları: `currentWriteBranch()` (not null sütunlar) ve `currentExpenseBranch()` (giderde
tek şube seçiliyse o şube, "Tümü"de işletme geneli — sahibin kararı).

## Dalga 4 — ekranda şube ayrımı ve sekmeler

Veri katmanı şubeye göre süzülemiyor (dalga 3'ün bulgusu): aynı okumalar silme engellerini ve vergiyi
besliyor. Ayrım **ekranda** yapılmalı, yani motor şube farkındalığı kazanmalı:

- `loadModel()` bütün şubeleri okumayı sürdürür (silme engelleri ve vergi bozulmasın), ama para görünümleri
  için şube kırılımlı erişimciler kazanır: `expenseAmounts`, `tillMonths`, stok sayımı değerlemesi.
  Bugün `expenseByMonth` gibi dizinler şubesiz kuruluyor ve `(ay, malzeme)` anahtarı iki şubenin sayımından
  birini eziyor — **Marina sayıma başlamadan önce bu bitmeli.**
- Gider görünümlerinde `branchWhereWithShared` (yardımcı yazıldı, çağıranı yok): tek şube seçiliyken o şubenin
  giderleri **ile** işletme geneli giderler birlikte; yoksa kira ve abonelik hiçbir şubede görünmez ve kâr
  olduğundan yüksek çıkar.
- Genel bakış, Kasa, Satışlar ve Gelir-gider'e şube sekmeleri; şube karşılaştırma kartı.
- Yazma formlarında hangi şubeye yazıldığı kullanıcıya gösterilir ("Tümü" seçiliyken Tuzla'ya iner).
- laffogato.net kanalı "Tümü"ye **girer** (işletmenin cirosudur) ama her yerde ayrı satır olarak görünür; bugünkü
  `/panel/gelir-gider` ayrımı bu kanala taşınır.
- Şube başına ModPOS anahtarı (`storeFoy` şube parametresini bekliyor).

### Eski dalga 4 notları

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

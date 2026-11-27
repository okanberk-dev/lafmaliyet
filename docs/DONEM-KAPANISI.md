# Dönem kapanışı ve reçete geçmişi

Son güncelleme: 26 Kasım 2026. Yapılacaklar › Dalga 3: "Dönem kapanışı: beyan edilmiş aya sonradan fatura girmesin.
Reçete geçmişi tutulsun."

## 1. Ne işe yarar

Muhasebeci bir ayın beyannamesini verdikten sonra o aya tarihli yeni bir fatura (Paraşüt'e geç girilen, elle eklenen) ya
da harcama gelirse panelin o ayki rakamı beyandan ayrılırdı. Dönem kapanışıyla yönetici beyan edilmiş ayı **kapatır**:

- Kapalı aya kapanıştan **sonra** düşen fatura ve harcama **reddedilmez** (Paraşüt eşitlemesi de kayıt açar) ama
  **hiçbir hesaba girmez**: Genel bakış, Gelir-gider, stok değerlemesi (FIFO partileri), dışa aktarım, muhasebeci paketi. Kayıt
  Ayarlar › Dönem kapanışı'ndaki **"Kapalı döneme düşenler"** kutusunda kararı bekler; zil ("Kapalı döneme düşen kayıt
  var") oraya götürür.
- Kapalı ayda sayılan kaydın **tarihi, tutarları ve kategorisi düzeltilemez, kaydın kendisi silinemez**; başka bir
  kayıt kapalı aya taşınamaz. Ödeme, vade, açıklama ve not serbesttir; faturanın şubesi de seçilebilir (eski faturayı
  ödemek, şubesini seçmek olağan iş). Harcamanın şubesi kilitlidir (şubenin o ayki gideri değişmesin).
- Kapalı ayın rakamı yalnız yöneticinin bilerek verdiği kararla ya da ayı yeniden açmakla değişir.

## 2. Kurallar (kod: `src/lib/closed-period.ts`, testler `tests/donem-kapanisi.test.ts`, `tests/donem-kapanisi-db.test.ts`)

- **Hangi ay kapanır:** yalnız bitmiş ay (iş günü 05:00'te döner; içinde bulunulan ay ve sonrası kapanmaz). Kapalı aylar
  `integration_state`'te (`donem.kapali`): ay → kapanış anı, kapatan, kapanıştaki **sağlama** (ayın fatura sayısı ve
  ödenecek toplamı, harcama sayısı ve toplamı).
- **Bekleyen kayıt:** belgenin tarihi kapalı aydaysa ve kayıt panelde kapanış anından sonra açıldıysa (`created_at`),
  karar verilene kadar bekler. Kapanıştan önce açılmış kayıt ayın rakamındadır. Anı okunamayan kayıt tutucu davranır
  (bekler).
- **Karar** (`invoices.period_date`, `expense_entries.period_date`: kaydın hesaplarda sayıldığı gün):
  - **Bu aya al:** kayıt kararın verildiği iş gününde sayılır (açık ay); belgenin tarihi (`date`) değişmez.
  - **Kapalı aya işle:** kayıt kendi tarihinde, kapalı ayda sayılır; beyan edilmiş rakam bilerek değişir, kapanışın
    sağlaması yenilenir (uyarı vermesin). Muhasebeciye haber verilmeli.
  - Karar bir kez verilir; dönem yeniden açılsa da yerinde kalır.
- **Yeniden açma:** gerekçe ister (işlem geçmişine yazılır). Açılınca bekleyen kayıtlar kendiliğinden kendi aylarına
  girer, kayıtlar yeniden düzeltilebilir.
- **Sağlama:** Ayarlar kapalı ayın bugünkü sayısını ve toplamını kapanıştakiyle karşılaştırır; tutmuyorsa "Kapanıştan
  sonra değişti: …" uyarısı. Kilidin yakalayamadığı yollar bununla görünür: Paraşüt'te sonradan değişen, yeniden
  tarihlenen ya da iptal edilen fatura (eşitleme Paraşüt'ü izler, beyanın kaynağı oradadır), kasadan çıkan fişin
  kasada düzeltilmesi, tedarikçi borcunun gideri.

## 3. Hesaplar nerede okur

`src/server/data/dataset.ts` faturaları ve harcamaları `countedRecords` ile okur (bekleyen çıkar, alınan karar gününe
taşınır), FIFO partilerini `redateLots` ile. Modeli okuyan her ekran (Genel bakış, Gelir-gider, Analiz, Nakit planının
mal tahmini, dışa aktarım, muhasebeci paketi) aynı kuralı görür. **Ödemeler** (vade, nakit planının fatura
satırları, Tedarikçiler'in kalan borcu) faturayı kendi tablosundan okur: bekleyen faturanın borcu ödeme listesinden
kaybolmaz. Faturalar listesi faturayı belgenin tarihiyle gösterir.

## 4. Ekranlar

- **Ayarlar › Dönem kapanışı** (`/panel/ayarlar#donem`, yalnız yönetici): kapalı döneme düşenler (Bu aya al, Kapalı aya
  işle), kapatılacak ay ve "Ayı kapat" (onaylı), kapalı aylar (kim, ne zaman, bugünkü sağlama, değiştiyse uyarı,
  "Yeniden aç").
- **Zil** (yönetici, Fatura grubu): "Kapalı döneme düşen kayıt var: 2 fatura ve 1 harcama kapalı döneme düştü; hesaplara
  girmedi, kararınızı bekliyor."
- Kilitli düzeltmenin hatası: "Ekim 2026 dönemi kapalı; bu ayın kayıtları değiştirilemez. Değiştirmek için Ayarlar ›
  Dönem kapanışı'ndan dönemi açın."

## 5. Reçete geçmişi

Reçeteyi (satırlar ya da hazırlama notu) değiştiren her kayıt `recipe_versions`'a bir sürüm yazar: kim, ne zaman,
nereden (Ürün kartı, Öneri onayı, Yeni ürün), önceki ve sonraki reçete (satır adları ve birimleriyle; malzeme sonra
silinse de okunur) ve tek satırlık özet ("Süt 200 ml → 220 ml; Karamel eklendi (10 ml)"). Reçete değişmediyse (yalnız
fiyat, ad, fire kaydedildi) sürüm yazılmaz. Yazanlar: `saveProduct` (ürün kartı), reçete önerisinin onayı (onaylayan ve
öneren), `insertProduct` (yeni ürün, kopya ve onaylanan yeni ürün önerisi; reçetesiz yeni ürün yazmaz).

Ürün kartında (`/panel/urunler/[id]`, yalnız yönetici) **Reçete geçmişi** kartı son 30 değişikliği gösterir; satıra
dokununca önce / sonra farkı açılır (Onaylar'daki fark tablosu). Geçmiş bu özellikten sonraki değişikliklerle başlar;
eski değişiklikler yalnız işlem geçmişinde (Ayarlar › İşlem geçmişi).

## 6. Kararlar (en tutucu, geri alınabilir)

- Kapalı aya düşen kayıt reddedilmez, beklemeye alınır (veri kaybolmaz; karar yöneticinin).
- Bekleyen kayıt hiçbir hesaba girmez (kapalı ayın rakamı değişmez, açık ayın rakamı da karar verilmeden şişmez).
- Faturanın şube seçimi kilitli değil: şirketin toplamı ve vergi değişmez; eski faturaların şubesini seçme işi sürüyor.
  Harcamanın şubesi kapalı ayda kilitli (seçme işi yok; tutucu olan).
- Paraşüt'te değişen eski fatura kilitlenmez, sağlama uyarısıyla görünür (Paraşüt muhasebecinin kaynağıdır).
- Kapanış geri alınabilir (yeniden aç); kararlar işlem geçmişinde.

# Paraşüt entegrasyonu

Panel, Paraşüt'teki **gider faturalarını** (purchase bills) her sabah 07:30'da kendisi alır ve hesaplara katar:
Faturalar, Gelir-gider (mal alışları, komisyonlar), Genel bakış, Tutarlılık (alınan miktar) ve hammadde fiyatları.
Ekran: **Ayarlar › Paraşüt entegrasyonu** (`/panel/parasut`).

## 1. Kurulum (bir kez)

1. **API erişimi:** Paraşüt'ün geliştirici portalı yok. `destek@parasut.com` adresine yazıp API erişimi isteyin; size
   `client_id` ve `client_secret` verilir. Hangi paketin API içerdiği yayımlanmıyor, destekten sorun.
2. **API kullanıcısı:** Paraşüt'te API için ayrı bir kullanıcı (e-posta + parola) açın. Fatura okuma yetkisi yeterli.
3. **Firma numarası:** Paraşüt'e girdiğinizde adres çubuğundaki sayı: `uygulama.parasut.com/123456/...` → `123456`.
   Panelde **Bağlantıyı dene** bu kullanıcının erişebildiği firmaları da gösterir.
4. **Vercel ortam değişkenleri** (lafmaliyet → Settings → Environment Variables, Production):

| Değişken | Değer |
|----------|-------|
| `PARASUT_CLIENT_ID` | Paraşüt'ün verdiği client_id |
| `PARASUT_CLIENT_SECRET` | Paraşüt'ün verdiği client_secret |
| `PARASUT_USERNAME` | API kullanıcısının e-postası |
| `PARASUT_PASSWORD` | API kullanıcısının parolası |
| `PARASUT_COMPANY_ID` | Firma numarası |
| `PARASUT_SYNC_FROM` | (isteğe bağlı) İlk eşitlemenin başlangıcı, `YYYY-MM-DD`; boşsa bu yılın başı |
| `PARASUT_BASE_URL` | (isteğe bağlı) Varsayılan `https://api.parasut.com`; Paraşüt test sunucusu verirse onun adresi |
| `CRON_SECRET` | Günlük işin anahtarı: `openssl rand -hex 32` |

Komut satırından eklemek için (değeri siz yazarsınız, ekrana basılmaz):

```bash
vercel env add PARASUT_CLIENT_SECRET production
```

Değişkenleri ekledikten sonra yeniden deploy edin. Panelde **Bağlantıyı dene**, sonra **Şimdi eşitle**.

## 2. Nasıl çalışır

- **Kimlik:** OAuth2 parola akışı (`POST https://api.parasut.com/oauth/token`). Erişim belirteci 2 saat geçerli; her
  yenilemede yeni bir `refresh_token` döner ve hemen kaydedilir. Belirteçler veritabanında (`integration_state`)
  AES-256-GCM ile şifreli durur; anahtar `AUTH_SECRET`'tan türetilir.
- **Okuma:** `GET /v4/{firma}/purchase_bills?sort=-issue_date&include=supplier,category,details,details.product`,
  sayfa başına 25 kayıt (Paraşüt'ün üst sınırı). Paraşüt "değişme tarihine göre" süzmeye izin vermediği için her
  eşitleme son faturanın tarihinden **75 gün geriye** bakar; bu pencerede ödenen, düzeltilen ya da iptal edilen
  faturalar güncellenir.
- **Hız sınırı:** Paraşüt 10 saniyede 10 istek kabul ediyor; istemci istekler arasında ~1 sn bekler, 429'da
  `Retry-After`'a uyar, 5xx'te yeniden dener. Bir eşitleme (okuma + yazma) en fazla ~45 sn sürer; süre dolarsa
  kaldığı sayfa kaydedilir ve sonraki çalışma oradan sürer. "Son fatura tarihi" imleci yalnızca tur tamamlanınca
  ilerler, böylece uzun bir ilk eşitlemede eski faturalar atlanmaz.
- **Tutarlar:** `gross_total` iskonto ve vergiler öncesi brüt, `total_discount` + `total_invoice_discount`
  iskontolar, `total_vat` KDV, `net_total` KDV dahil genel toplam. Her faturada
  `net ≈ brüt − iskontolar + KDV + ÖTV + ÖİV` sınanır; tutarsa maliyet (KDV hariç) `net − KDV` olur ve panelde
  tutar = maliyet + iskonto, iskonto = iskontolar yazılır. Tutmazsa net'in KDV hariç geldiği durum ve "kalan = net"
  denenir. Fatura altı iskonto kalemlere oranla dağıtılır. Döviz faturaları `exchange_rate` ile TL'ye çevrilir,
  iade faturaları eksi yazılır, iptal/arşivlenmiş ve tekrarlayan şablonlar alınmaz.
- **Ödeme ve vade:** `remaining` / `payment_status` → faturanın ödenmedi işareti; `due_date` → vade. Ödenmemiş
  faturalar **Ödemeler & hatırlatıcılar**'a ve hatırlatma e-postasına düşer.

## 3. Çift sayım olmaz

Panelde elle ya da Excel'den girilmiş aynı fatura bulunursa yenisi açılmaz, mevcut kayıt Paraşüt'e bağlanır:

1. Paraşüt kimliği (daha önce bağlandıysa),
2. fatura numarası (harf/rakam dışı karakterler yok sayılarak),
3. aynı tarih + aynı tutar (±1 ₺) + aynı tedarikçi.

Bağlanan kaydın **kategorisi ve tedarikçi adı korunur**; tutar, KDV ve tarih Paraşüt'ten gelir. Panelde
**"ödendi"** işaretlenen fatura, Paraşüt'te ödeme kaydı yoksa da ödendi kalır; Paraşüt'te vade yoksa paneldeki vade
korunur. Fatura numarası eşleşmesi yalnızca **aynı tedarikçide** ve ±31 gün içinde geçerlidir (farklı firmalar aynı
e-fatura önekini kullanabilir). Paraşüt'te **iptal edilen** fatura, panelde Paraşüt'ten açılmışsa kaldırılır;
elle/Excel'le girilmiş bir kayda bağlıysa silinmez, bağı çözülür ve notuna "Paraşüt'te iptal — kontrol edin" düşülür.
Arşivlenmiş faturalar (Paraşüt'te yalnızca listeden gizlenmiş) geçerli gider olarak alınır.
Yeni tedarikçi adları paneldeki kısa adlarla eşlenir ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş." → "Sütaş"), böylece gelir-gider
tablosundaki tedarikçi satırları dağılmaz.

## 4. Kategori

Yeni gelen faturanın panel kategorisi sırasıyla:

1. **Kategori kuralları** (ekrandan: tedarikçi adı / Paraşüt kategorisi / açıklamada geçen kelime → kategori),
2. aynı tedarikçinin önceki faturalarında en sık kullanılan kategori,
3. komisyon platformları (Trendyol, Yemek Sepeti, Pluxee, Multinet, Edenred, Set Kart, Metropol …) → Komisyon,
4. Paraşüt kategori adı ve kalem adlarındaki ipuçları (ambalaj, kira, yazılım, reklam …),
5. Diğer.

Seçimin nedeni faturanın notuna yazılır ("Paraşüt'ten alındı · kategori: …"). Faturalar ekranından değiştirilen
kategori sonraki eşitlemelerde korunur.

## 5. Kalemler, alınan miktar ve fiyat

Detaylı faturaların kalemleri (`purchase_bill_details`) saklanır. Ekrandaki **Ürün → hammadde bağlantıları**:

- Paraşüt ürününü (ya da açıklamasını) bir hammaddeye bağlayın ve **çarpanı** yazın: Paraşüt'teki 1 birim kaç
  hammadde birimi? (ör. "Süt 1 L" → süt hammaddesi ml ise `1000`; "Koli 12×1 L" → `12000`).
- O kalemden gelen miktar × çarpan, ayın **alınan miktarı** olur (Tutarlılık ekranı); iade faturaları düşülür. Elle
  girilmiş alınan miktar satırlarına dokunulmaz; yalnızca notu tam olarak "Paraşüt faturalarından" olanlar yönetilir.
  Tutarlılık'ta böyle bir satır elle düzeltilirse notu silinir ve artık eşitlemeye ait olmaz.
- "Fiyatı güncelle" açıksa, en yeni faturadaki birim fiyat (iskonto sonrası, KDV hariç) hammaddenin paket fiyatı
  olur, paket boyu çarpan olur ve fiyat geçmişine "Paraşüt" olarak yazılır (değişim %0,5'ten küçükse yazılmaz).

## 6. Gelen e-faturalar

Paraşüt'e e-Fatura ağından gelen faturalar **kendiliğinden gider faturası olmaz**: Paraşüt'te
*Giderler → Gelen e-Faturalar* ekranından **içeri al** (tek tek ya da toplu, en fazla 100) yapılmaları gerekir.
API'de bunu yapan bir uç nokta yok. Panel, belgelenmemiş `GET /e_invoices` listesinden içeri alınmayı bekleyenleri
yaklaşık sayar ve Paraşüt ekranında uyarı gösterir. e-Arşiv ve kâğıt faturalar Paraşüt'e elle (hızlı/detaylı fiş)
girildikten sonra gelir.

## 7. Elle çalıştırma ve sıfırlama

- **Şimdi eşitle:** otomatik pencereyle hemen çalıştırır.
- **Tarihten eşitle:** seçilen tarihten bugüne yeniden okur (geçmişi doldurmak için).
- **Oturumu sıfırla:** kayıtlı belirteci ve eşitleme imlecini siler; mevcut faturalar çoğalmaz.
- Günlük işler (Vercel Cron, `Authorization: Bearer $CRON_SECRET`): `GET /api/cron/parasut` 07:30'da (04:30 UTC)
  Paraşüt'ü eşitler; `GET /api/cron/gunluk` 08:00'de (05:00 UTC) hatırlatma e-postasını gönderir. Ayrı işler
  olduğu için yavaş bir eşitleme e-postayı geciktirmez.

## 8. Açık noktalar

Paraşüt'ün belgeleri bazı ayrıntıları söylemiyor; ilk gerçek eşitlemede kontrol edin:

- `include=supplier` belgelenen listede yok ama topluluk istemcilerinde çalışıyor; reddedilirse istemci tedarikçisiz
  ister ve adları `/contacts/{id}`'den okur.
- `gross_total` / `net_total` anlamı her faturada hesapla doğrulanır; eşitleme geçmişinde ve faturalarda tutarlara
  bir kez göz atın.
- Test (sandbox) ortamı için Paraşüt'ten ayrı bilgiler gerekirse `PARASUT_BASE_URL` ile adres verilebilir.

Kaynaklar: [apidocs.parasut.com](https://apidocs.parasut.com/) (Swagger: `swagger.json`), Paraşüt destek sayfaları,
açık kaynak istemciler (leventcz/parasut-php, yigitkonur/mcp-parasut, Zoho-Parasut-Sync). Araştırmanın ayrıntılı notu
(İngilizce, kaynak bağlantılarıyla): [parasut-api-spec.md](parasut-api-spec.md).

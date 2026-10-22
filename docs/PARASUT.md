# Paraşüt entegrasyonu

Panel, Paraşüt'e **gelen e-faturaları** (Paraşüt'te "içeri al" yapılmamış olanlar dahil) ve **gider faturalarını**
(purchase bills) her sabah 07:00–08:00 arasında kendisi alır ve hesaplara katar: Faturalar, Gelir-gider (mal
alışları, komisyonlar), Genel bakış, Tutarlılık (alınan miktar) ve hammadde fiyatları. Her faturanın e-fatura PDF'i
panelde açılır ve indirilir.
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
- **Okuma:** `GET /v4/{firma}/purchase_bills?sort=-issue_date&include=supplier,category,details,details.product,active_e_document`,
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
- **Ödeme ve vade:** `due_date` → vade. Ödendi / ödenmedi'yi **siz işaretlersiniz** (Tedarikçiler ya da Faturalar,
  [TEDARIKCILER.md](TEDARIKCILER.md)): Paraşüt'ten gelen her yeni fatura "ödenmedi" gelir, eşitleme var olan
  faturanın ödeme durumuna dokunmaz; `remaining` / `payment_status` yalnız ipucu olarak saklanır (`parasut_unpaid`,
  ekranda "Paraşüt'te ödendi"). Komisyon faturası (hakedişten düşülür) ve kartında "Faturaları ödendi gelsin" işaretli
  (peşin) tedarikçinin faturası ödendi gelir; takip başlamadan önceki tarihli fatura geçmişi yeniden alırken
  Paraşüt'teki durumuyla gelir. Ödenmemiş
  faturalar **Ödemeler & hatırlatıcılar**'a ve hatırlatma e-postasına düşer.

## 3. Çift sayım olmaz

Panelde elle ya da Excel'den girilmiş aynı fatura bulunursa yenisi açılmaz, mevcut kayıt Paraşüt'e bağlanır:

1. Paraşüt kimliği (daha önce bağlandıysa),
2. fatura numarası (harf/rakam dışı karakterler yok sayılarak),
3. aynı tarih + aynı tutar (±1 ₺) + aynı tedarikçi.

Bağlanan kaydın **kategorisi, tedarikçi adı ve ödeme durumu korunur**; tutar, KDV ve tarih Paraşüt'ten gelir.
Paraşüt'te vade yoksa paneldeki vade korunur. Fatura numarası eşleşmesi yalnızca **aynı tedarikçide** ve ±31 gün içinde geçerlidir (farklı firmalar aynı
e-fatura önekini kullanabilir). Paraşüt'te **iptal edilen** fatura, panelde Paraşüt'ten açılmışsa kaldırılır;
elle/Excel'le girilmiş bir kayda bağlıysa silinmez, bağı çözülür ve notuna "Paraşüt'te iptal — kontrol edin" düşülür.
Arşivlenmiş faturalar (Paraşüt'te yalnızca listeden gizlenmiş) geçerli gider olarak alınır.
Yeni tedarikçi adları paneldeki kısa adlarla eşlenir ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş." → "Sütaş"), böylece gelir-gider
tablosundaki tedarikçi satırları dağılmaz.

Paraşüt'e bağlı faturada tarih, fatura no, tutar, iskonto ve ödenecek panelde salt okunurdur (saveInvoice da
yazmaz); kategori, tedarikçi adı, açıklama, not, vade ve ödeme durumu düzenlenir. Kısmen ödenmiş faturada Paraşüt'ün
bildirdiği kalan borç (`outstanding`) gösterilir ve toplamlara o girer. Panelde silinen Paraşüt faturaları bir
sonraki eşitlemede geri gelmez; Faturalar › Silinen Paraşüt faturaları'ndan (ya da silme bildirimindeki "Geri al"
ile) geri alınır.

## 3a. Tedarikçinin vergi nosu

Paraşüt'ten gelen her faturaya tedarikçinin VKN / TCKN'si yazılır (`invoices.supplier_tax_number`, yalnız rakam,
10 ya da 11 hane). Tedarikçiler aynı numaralı faturaları adları farklı olsa da tek tedarikçide toplar
([TEDARIKCILER.md](TEDARIKCILER.md#eşleşme)); faturanın adı değişmez (Faturalar ve Gelir-gider adla kalır).

- **Nereden:** gider faturasında `include=active_e_document` ile gelen e-belgenin `from_vkn`'i (imzalı belge), yoksa
  `include=supplier` ile gelen kişi kartının `tax_number`'ı (ya da `/contacts/{id}` önbelleği); içeri alınmamış gelen
  e-faturada `from_vkn`; e-faturanın UBL belgesi okunurken satıcının kimliği (`AccountingSupplierParty`, yalnız boş
  numarayı doldurur). Yalnız gelen e-belge sayılır: aynı Paraşüt şirketinde sitenin satış faturaları ve e-Arşiv'i de
  kesiliyor, giden belgedeki `from_vkn` işletmenin kendi numarasıdır.
- **Öncelik** (`nextTaxNumber`, `mapping.ts`): boş kayda gelen numara yazılır; e-belgedeki numara her zaman geçer;
  kişi kartındaki numara e-faturaya bağlı kaydın numarasını ezmez, e-faturasız kayıtta yazılır (kişi kartı Paraşüt'te
  düzeltilmiş olabilir). Elle ve Excel'den girilen faturada numara yoktur.
- Kontrol hanesi tutmayan ve örnek numaralar (1234567890 …) saklanır, faturada görünür ama eşleşmede kullanılmaz.
- **Eski faturalar:** her eşitleme son 75 günü yeniden okuduğu için yeni ve yakın tarihli faturalar numarasını
  hemen alır. Daha eskiler bir kerelik tamamlamayla dolar (`src/server/parasut/tax-backfill.ts`): her eşitlemenin
  artan süresinde, numarası boş Paraşüt faturaları için gider faturaları (`purchase_bills`,
  `include=supplier,active_e_document`), sonra gelen e-faturalar (içeri alınmış e-faturanın gider faturası kaydı da)
  en yeniden geriye okunur; boş kayıtların en eskisine gelince biter. Kaldığı sayfa `integration_state` ›
  `parasut.taxBackfill`'de durur; bitince bir daha çalışmaz. Yazma yalnız numara hâlâ boşsa yapılır. İlerlemesi
  eşitleme özetinde görünür: "N faturaya vergi no yazıldı" (yeni faturalar, düzeltilenler ve tamamlama birlikte).
  "Şimdi eşitle" tamamlamayı hızlandırır. **Oturumu sıfırla** ve `npm run db:reset` durumu siler, baştan başlar.
- Silinen faturanın kopyası numarayı da saklar (Silinen Paraşüt faturaları'ndan geri alınınca numarasıyla döner).

## 4. Kategori

Yeni gelen faturanın panel kategorisi sırasıyla:

1. **Kategori kuralları** (ekrandan: tedarikçi adı / Paraşüt kategorisi / açıklamada geçen kelime → kategori),
2. aynı tedarikçinin önceki faturalarında en sık kullanılan kategori (eşitlemenin açıp henüz kontrol edilmemiş
   faturaları sayılmaz; onaylanan ya da kategorisi değiştirilen sayılır),
3. komisyon platformları (Trendyol, Yemek Sepeti, Pluxee, Multinet, Edenred, Set Kart, Metropol …) → Komisyon,
4. Paraşüt kategori adı ve kalem adlarındaki ipuçları (ambalaj, kira, yazılım, reklam …),
5. Diğer.

Seçimin nedeni faturanın notuna yazılır ("Paraşüt'ten alındı · kategori: …"). Faturalar ekranından değiştirilen
kategori sonraki eşitlemelerde korunur. E-faturadan açılan kaydın kalem adları ancak belge okununca bilinir: "eşleşme
yok" kalan ve hâlâ kontrol bekleyen kaydın kategorisi kalemler okununca kurallar ve ipuçlarıyla yeniden denenir
(kayıt kontrol bekleyen kalır).

## 5. Kalemler, alınan miktar ve fiyat

Kalemler iki yerden gelir ve aynı tabloda (`parasut_bill_lines`) durur:

- **Gelen e-faturalar** (içeri alınmamış olanlar ve e-faturaya bağlanan Excel kayıtları): kalemler e-faturanın imzalı
  UBL belgesinden okunur (`GET /v4/{firma}/e_invoices/{id}/signed_ubl` → tek XML'li ZIP; `ubl.ts`, `lines.ts`).
  Ürün adı, satıcı ürün kodu, miktar ve birim (UN/ECE kodu: C62 = Adet, NPL = Koli, KGM = kg…), birim fiyat,
  iskonto, KDV oranı ve KDV hariç net tutar yazılır. Bazı sağlayıcılar kalem tutarını brüt yazıp iskontoyu ayrıca
  verir (Erbak, Sütaş); hangi alanın net olduğu faturanın KDV hariç toplamını tutturan yorumla seçilir, fatura altı
  iskonto kalemlere oranla dağıtılır. Canlı veride 82 gelen e-faturanın 82'sinde kalemlerin toplamı faturayı
  kuruşu kuruşuna tuttu (20 Eki 2026). Her eşitleme kalan süre kadar faturanın kalemlerini okur (en yeni önce);
  beklemeden okumak için Paraşüt sayfasında **Kalemleri şimdi oku**. Okunan fatura `invoices.ubl_read_at` ile
  işaretlenir; e-fatura değişirse yeniden okunur. Belgesi geçici bir hatayla (Paraşüt 5xx, zaman aşımı) alınamayan
  fatura o turda atlanır ve sonraki okumalarda sıranın sonuna alınır (tek bir bozuk belge ötekileri bekletmez); 5
  denemede alınamazsa okunamadı sayılır (`parasut.ublRetries`). Ödeme tarihi için bkz. 6.
- **Tevkifatlı e-fatura:** Paraşüt'ün listesi tedarikçiye ödenecek tutarı (`net_total`, tevkifat düşülmüş) ve tam
  KDV'yi verir; "ödenecek − KDV" maliyeti eksik çıkarır (ör. 34.200 − 6.000 = 28.200, doğrusu 30.000). Belge
  okununca tevkifat geri eklenir (ödenecek + tevkifat − KDV), notta eski tutar görünür. ÖİV/ÖTV (telekom, içecek)
  gider faturası yolundaki gibi maliyette kalır; tevkifatsız faturanın tutarına dokunulmaz. Elle değiştirilmiş tutara
  dokunulmaz.
- **İçeri alınmış gider faturaları:** Paraşüt'teki kalemler (`purchase_bill_details`).

Kalemler Faturalar'da faturayı açınca **Kalemler** bölümünde görünür (`GET /api/faturalar/{id}/kalemler`):
miktar, net birim fiyat, KDV, bağlı hammadde ve bu faturadaki fiyatı (₺/kg, ₺/L, ₺/adet).

Ekrandaki **Ürün → hammadde bağlantıları** (yalnız mal alışı ve "Diğer" kategorisindeki faturaların kalemleri
listelenir; komisyon, kira, demirbaş, yazılım, reklam ve hizmet faturaları gelmez):

- Paraşüt ürününü (ya da açıklamasını) bir hammaddeye bağlayın ve **çarpanı** yazın: Paraşüt'teki 1 birim kaç
  hammadde birimi? (ör. "Süt 1 L" → süt hammaddesi ml ise `1000`; "Koli 12×1 L" → `12000`).
- O kalemden gelen miktar × çarpan, ayın **alınan miktarı** olur (Tutarlılık ekranı); iade faturaları düşülür. Elle
  girilmiş alınan miktar satırlarına dokunulmaz; yalnızca notu tam olarak "Paraşüt faturalarından" olanlar yönetilir.
  Tutarlılık'ta böyle bir satır elle düzeltilirse notu silinir ve artık eşitlemeye ait olmaz.
- "Fiyatı güncelle" açıksa, en yeni faturadaki birim fiyat (iskonto sonrası, KDV hariç) hammaddenin paket fiyatı
  olur, paket boyu çarpan olur ve fiyat geçmişine "Paraşüt" olarak yazılır (değişim %0,5'ten küçükse yazılmaz).
  Bedava gelen kalem (%100 iskonto) miktara girer, fiyata girmez.
- **Öneriler** (`src/lib/product-match.ts`): aynı adlı (boyut hariç) ürün daha önce bağlandıysa o hammadde; çarpanı
  yalnız paket de aynıysa (boy ve adet) alınır, değilse addan yeniden tahmin edilir ("SÜT 1 LT" bağlıyken "SÜT 5 LT").
  Bardak ve kapak boyu (oz, cc) farklıysa ayrı üründür, önceki bağlantı önerilmez (8oz bağlıyken 14oz bardak). Bağlı
  benzeri yoksa hammadde adının sözcüklerinin hepsi ürün adında geçiyorsa o hammadde. Çarpan addaki paket bilgisinden
  tahmin edilir: "SÜT 1 L" (Adet) → 1000 ml, "330ML 1X24" (Kutu) → 24 adet ya da 7920 ml, "KUTU İÇİ 9 ADET" → 9.
  **Hazır olanları bağla** önerisi ve çarpanı belli bütün bekleyenleri listeleyip tek seferde bağlar.
- Hammadde olmayan kalemler (kargo, nakliye, hizmet bedeli, klişe, pompa, ekipman) bağlanmaz: **Hammadde değil**
  denince bekleyenlerden ve zildeki sayıdan çıkar; listenin altındaki "Hammadde değil" bölümünden **Geri al** ile
  bekleyenlere döner. Faturadaki tutarı değişmez. Liste `integration_state`'te (`parasut.productIgnore`) durur.
- Bağlanmayı bekleyen ürün sayısı zilde görünür.

Böylece Tutarlılık'ta **alınan** (faturalardan) ile **satışa göre kullanılan** (satılan adet × reçete) karşılaştırılır;
iki ayın stok sayımı girilince gerçek tüketim (devir + alınan − devreden) ve sapma hesaplanır.

### 5a. Zam uyarısı

Hammadde fiyatı her değiştiğinde fiyat geçmişine yazılır (elle, Excel, Paraşüt faturası). Son 30 günde fiyatı
%5'ten fazla artan hammaddeler ve bu yüzden maliyeti %1'den fazla artan ürünler hesaplanır (`price-impact.ts`):
eski maliyet, zamlanan hammaddenin pencereden önceki fiyatıyla aynı reçeteden bulunur. Zamdan sonra maliyet oranı
hedefin üstündeki ürüne fiyat önerilir; öneri şu ikisinin küçüğüdür (5 ₺'ye yukarı): hedef oranı tutturan fiyat
(⌈maliyet ÷ hedef × (1 + KDV); 5⌉) ve zamdan önceki oranı koruyan fiyat (fiyat × yeni maliyet ÷ eski maliyet).
Zamdan önce hedefte olan ürüne hedef fiyat yeter; zaten hedefin üstünde olana (hazır alınan tatlı gibi) yalnız
zammın payı önerilir. Fiyatı öneriden düşük ürün uyarı olur:

- Genel bakış › Dikkat edilmesi gerekenler ve zil: "Hammadde zammı: N ürünün fiyatı hedefin altında kaldı";
- sabah e-postası: yalnız son zam e-postasından sonraki yeni zamlar (her sabah yinelenmez);
- Ürünler › **Hammadde zamları** (`#zamlar`): eski → yeni maliyet, maliyet oranı, birim kâr; **Fiyatı X ₺ yap**
  ya da **Böyle kalsın** (maliyet daha da artarsa yeniden uyarılır; ikisi de geri alınır);
- ürün kartında not, Hammaddeler'de "↑ %16" rozeti.

## 6. Gelen e-faturalar ("içeri al" gerekmez)

Paraşüt'e e-Fatura ağından gelen faturalar Paraşüt'te *Giderler → Gelen e-Faturalar* ekranında bekler; Paraşüt'te
**içeri al** yapılınca gider faturası olurlar. Panel bunu **beklemez**: belgelenmemiş `GET /v4/{firma}/e_invoices`
listesini her eşitlemede okur ve gelen her e-faturayı doğrudan fatura olarak yazar (`src/server/parasut/einvoice.ts`,
`sync.ts` → `syncEInvoices`). Canlı denemeyle doğrulandı (20 Eki 2026):

- Liste yalnız `sort=-issue_date` ile çalışır (süzgeç ve başka sıralamalar 400 döner, sırasız istek yanıt vermez);
  sayfa başına 25 kayıt. Gelen (`direction=inbound`) faturalar alınır; giden, reddedilen, arşivlenen ve döviz olanlar
  alınmaz.
- `external_id` fatura numarası, `issue_date` tarih, `contact_name` tedarikçi, `net_total` KDV dahil ödenecek,
  `total_vat` KDV. KDV hariç tutar = `net_total − total_vat` (e-fatura listesinde iskonto ayrıca gelmez). İade
  faturası eksi, tevkifatlı fatura "kontrol bekleyen" yazılır (tutarı belge okununca düzelir, bkz. 5).
- Kalemler `signed_ubl` belgesinden okunur (bkz. 5). `ubl`, `xml`, `html` uçları yoktur (404).
- **Ödeme (vade, valör) tarihi** belge okununca yazılır (`ubl.ts` → `readPayment`): sırayla ödeme alanı
  (`PaymentMeans/PaymentDueDate`), ödeme koşulları (`PaymentTerms/PaymentDueDate`), notlar ("Vade Tarihi: 26.10.2026",
  "Son Ödeme Tarihi", "Valör", "Vade Günü: 15", "30 gün vade"). Fatura gününden önceki ya da 400 günden uzak tarih
  yazım hatası sayılır. Ödeme şekli `PaymentMeansCode`'dan (10 nakit, 48 kart, 42 havale…), "Peşin" notu ya da vade =
  fatura günü peşin sayılır. E-faturada ödeme bilgisi yoktur: e-faturadan açılan kayıt **ödenmedi** gelir ve
  belgedeki vadesiyle Ödemeler & hatırlatıcılar'a düşer; ödendiğini siz işaretlersiniz. Takip başlamadan önceki tarihli
  e-fatura (geçmişi yeniden alırken) ödendi açılır, belgedeki vadesi henüz gelmemişse ödenmedi olur (notta "vade
  e-faturadan"). Excel/elle girilmiş kaydın ödeme durumuna dokunulmaz, yalnız boş vadesi doldurulur.
- **Çift sayım olmaz:** e-fatura önce kendi kimliğiyle (`invoices.e_invoice_id`), sonra Excel'den/elle girilmiş aynı
  fatura numarasıyla (±31 gün, aynı tarih ya da tutar ±1 ₺) eşleşir; eşleşen kayda bağlanır. Excel kaydının tutarı
  aynıysa dokunulmaz, farklıysa e-faturadaki yazılır ve kayıt "kontrol bekleyen" olur. Fatura sonradan Paraşüt'te
  içeri alınırsa gider faturası (`active_e_document` bağıyla) **aynı kayda** bağlanır; o zaman Paraşüt'teki ödeme
  kaydı da ipucu olarak gelir.
  Kalemleri e-fatura belgesinden okunmuşsa korunur (ürün anahtarları değişmez, hammadde bağlantıları düşmez),
  okunmamışsa Paraşüt'ün gider faturasından okunur.
- Muhasebeci e-faturayı "içeri al" yerine Paraşüt'e **elle gider faturası** olarak girerse (bağ yok) gider faturası
  önce yazılır; e-fatura aynı tam fatura numarasıyla (±31 gün, aynı tarih ya da tutar ±1 ₺) o kayda bağlanır, ikinci
  kayıt açılmaz. Gider faturasına bağlı kaydın tutarı ve kalemleri gider faturasından gelir; e-faturanın sonradan
  arşivlenmesi ya da reddi bu kayda dokunmaz.
- Panelde silinen e-fatura kaydı `ei:<kimlik>` anahtarıyla yok sayılanlara eklenir, geri gelmez; e-fatura sonradan
  Paraşüt'te içeri alınsa da gider faturası olarak yeniden açılmaz (panelde aynı fatura başka bir kayıtta duruyorsa o
  kayıt bağlanır). Faturalar › Silinen Paraşüt faturaları'ndan geri alınır.
- e-Arşiv ve kâğıt faturalar API'de yoktur: Paraşüt'e elle girilirse gider faturası olarak gelir ya da panelde elle
  eklenip fotoğrafı/PDF'i yüklenir.

## 6a. Belgeler (PDF önizleme ve indirme)

- Paraşüt'ten gelen her faturada **Belge**: `GET /api/faturalar/{id}/belge` (yalnız yönetici). E-faturadan gelen
  kayıtta `GET /v4/{firma}/e_invoices/{id}/pdf` 1 saatlik bir indirme adresi döner (Paraşüt hazırlarken 204);
  gider faturasında `active_e_document` e-faturası, yoksa Paraşüt'teki `photo` görseli kullanılır. PDF ilk açılışta
  indirilir ve `invoice_documents` tablosunda saklanır; sonraki açılışlar anında gelir. `?indir=1` indirir.
- Paraşüt'te belgesi olmayan faturaya (elle girilmiş, Excel'den gelmiş) panelden **PDF ya da fotoğraf** eklenir
  (`POST` aynı adres, form alanı `dosya`, en çok 4 MB; tür içerikten denetlenir; fotoğraflar telefonda küçültülür).

## 6a-1. Kafe dışı faturalar (karaoke box, Alp Koç)

Aynı Paraşüt hesabına karaoke box'ların (MaviBahçe AVM, Opera Gayrimenkul) faturaları da gelir. Bunlar
**Karaoke box** kategorisindedir (`SEPARATE_CATEGORIES`): kafenin fatura toplamına, gelir-giderine, mal maliyetine,
Bu ayın işleri'ndeki fatura sayısına ve ürün bağlamaya girmez; Faturalar'ın aylık özetinde Toplam'ın altında ayrı
satırda görünür. "Opera Gayrimenkul" tedarikçi kuralı yeni faturaları kendiliğinden bu kategoriye koyar.

Kolayı ortak Alp Koç alır: kola ile Damla suyun birlikte geldiği Pruva faturaları **Alp Koç** kategorisindedir (aynı
kurallarla kafe dışı); Uludağ (Erbak) suları kafenindir. Yeni Pruva faturası tedarikçinin önceki faturalarına bakılarak
bu kategoriye düşer; kafe için gelen (kolasız) bir Pruva faturası olursa kategorisi elle değiştirilir. Kafe dışı
faturaların kalemleri, ürün kafeye de gelse, hammaddenin alınan miktarına ve fiyatına girmez (`applyProductLinks`).

## 6b. Kontrol bekleyen faturalar

Eşitlemenin açtığı yeni faturanın kategorisi kurala, tedarikçinin geçmişine ya da komisyon platformu listesine
dayanmıyorsa (ipucu ya da "Diğer") fatura **kontrol bekleyen** olur (`invoices.needs_review`). Faturalar'da
"Kontrol bekleyen" süzgeci, satırda tek dokunuşla **Onayla**, toplu onay; kategori değiştirmek ya da faturayı
kaydetmek de onaylar. Sayısı zilde, sabah e-postasında ve Genel bakış › Bu ayın işleri'nde görünür.

## 7. Elle çalıştırma ve sıfırlama

- **Şimdi eşitle:** otomatik pencereyle hemen çalıştırır.
- **Kalemleri şimdi oku:** sıradaki e-faturaların kalemlerini beklemeden okur (her çağrı ~45 sn; ekran bitene kadar
  sürdürür).
- **Tarihten eşitle:** seçilen tarihten bugüne yeniden okur (geçmişi doldurmak için).
- Tek bir tedarikçinin bütün geçmişi için tedarikçi sayfasındaki **Geçmiş faturaları al** ([TEDARIKCILER.md](TEDARIKCILER.md#geçmiş-faturalar)):
  kişiye göre süzülür, listede görünmeyeni kaldırmaz (Paraşüt'te iptal edileni kaldırır), imleci değiştirmez;
  eşitleme geçmişinde "tedarikçi geçmişi" diye görünür, son eşitleme sayılmaz.
- **Oturumu sıfırla:** kayıtlı belirteci ve eşitleme imlecini siler (eski faturaların vergi no tamamlaması da baştan
  başlar); mevcut faturalar çoğalmaz.
- Aynı anda tek eşitleme çalışır (Postgres danışma kilidi, `SYNC_LOCK`): sabah işi sürerken "Şimdi eşitle" ya da
  e-posta işinin yeniden denemesi başlamaz, "Paraşüt eşitlemesi zaten sürüyor" yanıtı döner. İki dakikadan eski
  "sürüyor" kaydı yarıda kesilmiş sayılır.
- Günlük işler (Vercel Cron, `Authorization: Bearer $CRON_SECRET`; Hobby planında her iş kendi saatinin bir
  saatlik penceresinde çalışır): `GET /api/cron/parasut` 07:00–08:00 (04:30 UTC) Paraşüt'ü eşitler;
  `GET /api/cron/gunluk` 08:00–09:00 (05:00 UTC) sabah e-postasını gönderir. Paraşüt işi o sabah başarıyla
  çalışmadıysa e-posta işi önce bir kez daha eşitler; böylece e-postaya o sabahın faturaları girer.
- Vercel → lafmaliyet → Settings → Cron Jobs ekranında iki iş görünür; **Run** ile elle çalıştırılabilir,
  **View Logs** son çalışmaları gösterir. Panelde **Ayarlar › Günlük işler** iki işin son çalışmasını ve adımlarını
  gösterir; çalışmayan ya da hata veren iş zilde ("Sistem"), Genel bakış'ta ve e-postayla bildirilir. Paraşüt işi
  eşitlemeden önce dünkü sabah işine de bakar (bekçi; [BILDIRIMLER.md](BILDIRIMLER.md) › Sistem uyarıları).

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

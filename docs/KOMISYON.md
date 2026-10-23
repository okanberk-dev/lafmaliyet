# Komisyon ve hakediş (yemek kartları ve sipariş platformları)

Ekran: **Satış & gider › Komisyon & hakediş** (`/panel/komisyonlar`, yalnız yönetici; ⌘K'da "komisyon", "hakediş",
"pluxee" …). Soru: yemek kartı şirketleri (Pluxee, Multinet, Edenred, Setcard, Metropol) ve sipariş platformları
(Yemeksepeti, Trendyol Go, Getir, Migros Yemek) her ay gerçekte ne kadar kesiyor, kestikleri yasaya uygun mu,
hakediş geldi mi? Hesap saf modüllerdedir: `src/lib/commission/channels.ts` (kanallar, kalemin sınıfı) ve
`src/lib/commission/report.ts` (rapor, uyarılar, hakediş, zil ve e-posta); testleri `tests/komisyon.test.ts`.

Banka hesabı panele bağlı değildir (Paraşüt'te de bağlı değil): hakedişin geldiğini yönetici işaretler, hiçbir şey
kendiliğinden işaretlenmez. Komisyon faturalarının ödeme durumuna dokunulmaz (Paraşüt'ten "ödendi" gelirler,
[TEDARIKCILER.md](TEDARIKCILER.md)). Panel Paraşüt'e yeni bir istek atmaz: yalnız eşitlemenin yazdığı alış faturalarını
ve kalemlerini okur.

## 1. Ekran

Telefonda tek sütun, bu sırayla; geniş ekranda kanal kartları iki sütun.

| Bölüm | İçerik |
|---|---|
| **Bekleyen hakedişler** | Bütün aylardan gelmesi gereken para: gecikti (kırmızı), eksik geldi, son günü 7 gün içinde (Bu hafta). En acil önce; **Geldi** penceresi açar, ad kanalın kartına götürür. Yoksa kart yok |
| Karolar | **Kesilen (KDV hariç)**: seçilen ayın bütün kanal faturaları · **Yemek kartı oranı**: yemek kartlarının toplam oranı (%6'nın üstü kırmızı; altında Z'deki yemek kartı, kasa raporu olan ayda 0 da, ya da "Satış bilinmiyor") · **Bekleyen hakediş**: açık hakedişlerin tutarı bilinen toplamı; altında geciken sayısı, gecikme yoksa tutarı bilinmeyenlerin sayısı |
| **Yemek kartları** | Önce **Yemek kartları (toplam)** (o ay Z'de yemek kartı ya da yemek kartı faturası varsa): Z'deki yemek kartı (raporlu gün sayısı ya da eksik gün), kesilen ve kaç şirket, ortalama oran, beklenen hakediş ve gelen. Sonra seçilen ayda ya da önceki beş ayda faturası ya da işareti olan her kartın kartı |
| **Platformlar** | "Z'deki online (platformlar): …" satırı (Z'nin online alanı platform satışıdır; laffogato.net'in online satışı kasadan geçmez, [SITE-SATIS.md](SITE-SATIS.md)); kasa raporu olan ayda tutar 0 da yazılır ("0 ₺ · 31 / 31 gün raporlu"), "Kasa raporu yok" yalnız o ay hiç rapor yoksa. Sonra her platformun kartı |
| **Kanalı bulunamayan komisyon faturaları** | Seçilen ayda kategorisi Komisyon olup hiçbir kanala bağlanmayan faturalar (§2); Faturalar'da açılır |
| **Kanallar** (`#kanallar`) | Her kanalın ödeme süresi (gün): hakedişin son günü = ayın son faturası + bu süre (§7) |
| **Kurallar ve hesap** | Kapalı başlar: yasal dayanak, oranın, ayın ve hakedişin hesabı, uyarıların kesin hüküm olmadığı |

Ay seçici (`?ay=YYYY-MM`) verinin başladığı aydan bu aya kadar; açılışta komisyon faturası olan son ay. Hiç komisyon
faturası ve Z'de yemek kartı / online yoksa yalnız "Henüz komisyon faturası yok".

**Kanal kartı** (`#pluxee`, `#trendyol` …; zil, e-posta ve Bugün buraya getirir):

- rozet, en kötüsü: *Sınırın üstünde* (kesin %6 aşımı), *Hakediş gecikti*, *Kontrol edin* (kırmızı: komisyon dışı
  ücret; turuncu: öteki uyarılar, eksik gelen hakediş); oran yoksa nedeni: *Satış bilinmiyor*, *Fatura bekleniyor*
  (satış yazıldı, fatura gelmedi), *Oran yok* (iade faturası ayı eksiye düşürdü ya da satış 0); sonra *Takip öncesi*,
  *Tamam*; o ay satırı yoksa *Bu ay fatura yok*;
- **Gerçek oran** ve parçaları ("Komisyon %3,0 · erken ödeme %3,2"; satış bilinmiyorsa tutarlar), **Satış** ve kaynağı,
  **Kesilen** (KDV hariç; ⓘ KDV dahil). Platformda seçilen ayın oranı ve önceki iki aydan en az birininki biliniyorsa
  başlık **Gerçek oran (3 ay)**, ayın kendi oranı **Bu ay** satırında; seçilen ayın oranı bilinmiyorsa başlık "–" (önceki
  ayların oranı şeritte kalır, bu ayınki sanılmaz);
- son altı ayın oranı (yemek kartında %6'nın üstü kırmızı);
- uyarılar (§6) ve satış bilinmiyorsa nedeni;
- **Faturalar ve kalemler** (kapalı): tarih, numara, KDV hariç tutar; *Kalemsiz* (kalemleri okunmamış: tamamı komisyon
  sayıldı), *Kontrol bekliyor* (kategori tahmin); önceki aya sayılan faturada "3 Kasım tarihli fatura · Ekim satışları
  için"; her kalemin kendi adı, açıklaması, sınıfı ve tutarı; **Faturada aç →**;
- hakediş satırı (§7) ve düğmeler: **Hakediş geldi** / **Düzenle**, **Satışı yaz** / **Satışı düzelt**.

**Hakediş penceresi** (`{Pluxee} · {Ekim 2026}`): *Geldi* / *Henüz gelmedi*; geldiği gün (ayın başından yarına kadar)
ve gelen tutar (beklenenle dolu gelir; formülü altında); **Bu ayki satış (isteğe bağlı)**: kanalın kendi ekranındaki
(ekstre, hakediş raporu) satış, KDV dahil; boş bırakılırsa Z toplamı (grupta tek kanal varsa) ya da bilinmez; not.
Kaydet'e basınca önce pencere kapanır; bildirimdeki **Geri al** (10 sn) önceki değerleri yazar. Haftalık ödeyen
platformda ayın havalelerinin toplamı ve son havalenin günü yazılır: ayda tek işaret.

## 2. Kanallar ve adların eşleşmesi

| Kanal | Tür | Ad önekleri (Türkçe karakterler sadeleşmiş, boşluksuz) |
|---|---|---|
| Pluxee | yemek kartı | `pluxee`, `sodexo` |
| Multinet | yemek kartı | `multinet` |
| Edenred | yemek kartı | `edenred`, `ticketrestaurant` |
| Setcard | yemek kartı | `setcard`, `setkart` |
| Metropol | yemek kartı | `metropol` (adında AVM, kira, alışveriş, merkezi, plaza, residence ya da otel geçiyorsa değil) |
| Yemeksepeti | platform | `yemeksepeti` |
| Trendyol Go | platform | `trendyol`, `dsmgrup` (Trendyol'un ticari unvanı) |
| Getir | platform | `getir` |
| Migros Yemek | platform | `migrosyemek`, `migros` |

- **Yalnız kategorisi Komisyon olan faturalar.** Gevşek önekler bu yüzden güvenli: Migros'un market faturası Hammadde'dir.
  Paraşüt'ün kategori kuralı (`COMMISSION_SUPPLIERS`, `pickCategory`) değişmedi; test, listedeki her adın bir kanala
  bağlandığını denetler. Başka kategoride duran kanal faturası (ör. Reklam & Tabela'daki Yemeksepeti reklamı) sayılmaz:
  orana girsin isteniyorsa kategorisi Komisyon yapılır.
- **Hangi ad:** önce faturadaki tedarikçi adı, sonra Tedarikçiler'deki kartın adı ve diğer adları: kart Tedarikçiler'in
  kuralıyla bulunur (ad önce, sonra vergi no; `supplierResolver`). Zil, Bugün ve sabah e-postası hafif yoldan okur: önce
  faturadaki adın önekine bakar; adı bir kanala bağlanmayan fatura varsa tedarikçi kartlarını da okur (tek küçük sorgu:
  kartın adı, diğer adları ve kartta yazılı vergi no). Vergi nonun öteki faturalar üzerinden bağlanması (bütün
  faturaları okur, `loadSupplierRefs`) yalnız ekranda.
- **Kanalı bulunamayan** fatura (ör. bankanın POS komisyonu) "Kanalı bulunamayan komisyon faturaları"nda durur. Yemek
  kartı ya da platformsa Tedarikçiler'de o tedarikçinin **Diğer adlar**ına bu ad eklenir, fatura kanala geçer (zilde,
  Bugün'de ve e-postada da); başka bir şeyse dokunulmaz. Yeni bir marka = `CHANNELS`'a bir satır ve bir test.

## 3. Satış: nereden gelir

Z raporunda yemek kartları da online (platformlar) da **tek toplamdır**; kasa raporunda kart kart ya da platform
platform alan yok (personelin her akşam ayrı yazması bu turda kesildi, `docs/planlar/CRITIQUE2.md` §6). Bir kanalın ayının
satışı (KDV dahil, müşterinin o kanaldan ödediği), sırayla:

| Kaynak | Kural | Ekranda |
|---|---|---|
| `elle` | Hakediş penceresinde yazılan aylık satış (kanalın ekstresi) | Kanalın ekstresinden (elle) |
| `tek` | O ay grubunda (yemek kartı ya da platform) etkin tek kanal bu ve faturası var; ayın kasa raporu var, ay ortasında başlamadı, Z'de grubun tutarı > 0 → grubun bütün Z toplamı | Z'deki yemek kartı toplamı (tek kart) / Z'deki online (platformlar) toplamı (tek platform) |
| – | Yoksa | *Satış bilinmiyor* ve nedeni: bu ay kasa raporu yok; kasa raporları 16 Ekim'de başladı; Z'de yemek kartları tek toplam ve bu ay 2 kart var; Z'deki online (platformlar) tek toplam ve 14 Kasım tarihli Yemeksepeti faturası Ekim satışlarını da kapsıyor olabilir; bu ayın kasa raporlarında yemek kartı tutarı yok. Hepsinin sonu: "Kanalın ekstresindeki satışı yazarsanız oran hesaplanır." |

- **Etkin kanal:** o ay faturası, yazılmış satışı (> 0) ya da gelen hakedişi olan. Satışı 0 yazılan kanal etkin
  sayılmaz (o ay kullanılmadı); hakedişi gelen kanal sayılır (satışı da o aydan geçmiştir). Faturası **sonraki ayın
  1–15'inde** kesilen kanal da etkin sayılır (ilk ayı ya da kayan fatura: o fatura bu ayın satışlarını kapsıyor
  olabilir; 15'i `fatura-yok` uyarısının da günü). Yoksa Z'deki toplamın tamamı öteki kanala yazılır, oranı düşük,
  beklenen hakedişi yüksek görünürdü; ayın ilk 5 gününde kesilen yemek kartı faturası zaten önceki aya sayılır (§5).
- **Yarım ilk ay:** ilk kasa raporu ayın ortasındaysa (Kasa raporu ekranının `partialFrom` kuralı) Z toplamı ayın bir
  kısmıdır, kullanılmaz; canlıda Ekim 2026 böyle, ilk tam ay Kasım 2026.
- **Eksik günler** (ayın başından ya da ilk rapordan ayın sonuna ya da düne kadar raporu olmayan gün) Z toplamını
  durdurmaz; *kasa-eksik* bilgisini ekler ve Z toplamıyla bulunan %6 aşımını kırmızıdan turuncuya indirir.
- **Yemek kartlarının toplamı** her zaman hesaplanır: Z'deki yemek kartı (yarım ayda yok) ÷ bütün yemek kartı
  faturaları. Ortalama %6'yı aşıyorsa en az bir kart aşıyordur; kart kart oran için her kartın ekstresindeki satış yazılır.

## 4. Kalemler

Kalemin adı ve açıklaması (Paraşüt kalemleri ve okunan e-fatura kalemleri, `parasut_bill_lines`) sadeleştirilip
sözcüklere bakılır; ilk eşleşen kazanır:

| Sınıf | Ekranda | Yemek kartı | Platform |
|---|---|---|---|
| `erken` | Erken ödeme | erken / hızlı / anında / aynı gün + ödeme / hakediş / tahsilat, vade farkı, valör | aynı |
| `yasak` | Komisyon dışı ücret | her zaman: kira (kiraz değil), kiralama, cihaz, terminal, destek, bakım, depozito, teminat, barındırma, aidat, üyelik, abonelik, lisans, kurulum, sarf, işletim; reklam sözcükleri; metinde "komisyon" yoksa: POS, yazılım, entegrasyon, işlem başı, işlem ücreti, kart bedeli, rulo | – |
| `asli` | Sipariş / ödeme altyapısı ücreti | – | ödeme altyapısı, ödeme işlem, online ödeme, sanal POS, sipariş iletim / alma, işlem ücreti, platform kullanım |
| `reklam` | Reklam / kampanya | (yemek kartında yasak) | reklam, kampanya, öne çıkar, sponsor, banner, vitrin, promosyon, joker, kupon, indirim katılım |
| `komisyon` | Komisyon | komisyon, hizmet bedeli, aracılık | aynı |
| `diger` | Diğer ücret | hiçbiri | aynı |

- Tek kalemli faturanın "diğer" kalemi komisyondur ("Hizmet faturası").
- **Kalemsiz** fatura (Excel'den, elle girilen ya da kalemi henüz okunmamış e-fatura): tutarın tamamı komisyon.
- Kalem tutarları faturanın KDV hariç tutarına (`amount − discount`) ölçeklenir: sınıfların toplamı Gelir-gider'in
  saydığı tutardır (fatura altı iskonto ve kuruş farkı dahil). İade (eksi) faturası düşer; ayın toplamı eksiye düşerse
  oran yazılmaz.
- KDV = ödenecek − KDV hariç (Excel'den gelenlerde KDV sütunu 0); yalnız beklenen hakedişte kullanılır.

Uyarılar sözcüklere bakar, bu yüzden hep "olabilir" der ve kalemin kendi adı kartta yazar.

## 5. Hangi ay

Satışla faturayı aynı ayda karşılaştırmak için: **ayın 1–5'inde kesilen yemek kartı faturası önceki ayın satışları
içindir** (aylık ekstre ay sonunda ya da sonraki ayın ilk günlerinde kesilir); öteki her fatura kendi tarihinin ayına.
Faturanın satırı bunu söyler: "3 Kasım tarihli fatura · Ekim satışları için". Gelir-gider her faturayı kendi tarihinin
ayına yazmaya devam eder. Haftalık platform faturaları ay sınırında kaydığı için platformda başlık 3 aylık orandır.

## 6. Gerçek oran ve uyarılar

**Gerçek oran** = kanalın o ay kestiği her şey (bütün sınıflar, KDV hariç) ÷ o kanaldan yapılan satış (KDV dahil).
Yemek kartında yasal sınırla karşılaştırılan budur: yönetmelik yalnız komisyona izin verir, öteki her ücreti yasaklar.
Sınır %6, yuvarlamayı yutan payla **%6,05**'in üstü.

| Uyarı | Tür | Ne zaman | Düzey | Metin |
|---|---|---|---|---|
| `oran-sinir` | yemek kartı | Oran > %6,05 | Kırmızı (kesin) iki koşulla: satış elle yazıldı ya da Z toplamından (tek kart) ve eksik gün yok (Z toplamı kartın satışından az olamaz); ayın bütün faturaları ekstre gününde kesildi (ayın son 5 günü ya da sonraki ayın ilk 5 günü; ay ortasında kesilen düzeltme ya da iki aylık fatura başka bir ayın ücretini de taşıyabilir; iade faturası sayılmaz). Yoksa turuncu | "Toplam kesinti %6,2: yemek kartında yasal üst sınır %6." (turuncuda nedeni: "Bazı günlerin kasa raporu eksik; kesin değil, kontrol edin." ya da "15 Ekim tarihli fatura ay sonunda kesilmemiş, başka bir ayın ücretini de taşıyor olabilir; kesin değil, kontrol edin.") |
| `yasak-ucret` | yemek kartı | Komisyon dışı ücret > 0 | Kırmızı | "Komisyon dışı ücret olabilir: “POS Cihaz Kira Bedeli” 150 ₺. Yönetmelik komisyon dışında kira, sarf malzemesi, teknik destek, bakım, depozito gibi adlarla ücret alınmasını yasaklıyor." (en çok iki ad, sonra "ve 2 kalem daha") |
| `erken-odeme` | yemek kartı | Erken ödeme > 0 | Turuncu | "Erken ödeme ücreti 300 ₺ (oranı %3,2 artırıyor). Erken ödemeyi siz mi seçtiniz? Seçmediyseniz kapattırın." |
| `asli-ucret` | platform | 1 Nisan 2026 ve sonraki faturada sipariş / ödeme altyapısı ücreti | Turuncu | "“Online Ödeme Hizmet Bedeli” 40 ₺: sipariş ya da ödeme altyapısı ücreti olabilir. 1 Nisan 2026'dan beri bunlar için ayrı ücret alınamıyor." |
| `reklam` | platform | Reklam / kampanya > 0 | Mavi | "Reklam / kampanya ücreti olabilir: 60 ₺. Bunlar isteğe bağlıdır; onay vermediyseniz itiraz edin." |
| `fatura-yok` | ikisi | Elle yazılan satış > 0, o ay faturası yok, sonraki ayın 15'i geldi | Turuncu | "Ekim ayında 2.000 ₺ satış var ama komisyon faturası gelmedi." |
| `kasa-eksik` | ikisi | Satış Z toplamından (tek kanal) ve ayın eksik günü var | Mavi | "3 gün kasa raporu yok; satış eksik kaldıysa oran yüksek görünür." |

Yemek kartlarının toplamında: `oran-sinir` ("Ortalama kesinti %6,3: en az bir yemek kartı %6'yı aşıyor."; eksik günde
ya da ay sonunda kesilmeyen faturada turuncu ve "… %6'yı aşıyor olabilir.", nedeniyle) ve `fatura-yok` ("Ekim'de
15.500 ₺ yemek kartı satışı var ama hiçbir yemek kartı faturası gelmedi.", sonraki ayın 15'inden sonra). Birden çok kart
varken satışı yazılmamış kart varsa kart kart oranın ekstreyle çıkacağı yazar. Zil ve e-posta yalnız kırmızıda uyarır.

Bu turda yok (kesildi): faturada yazan işlem tutarı ve dönem okuması, oran sıçraması, taban farkı, başka kategorideki
kanal faturası ve platformun tek kalemli faturası uyarıları; Tedarikçiler'deki bağlantı; Nakit planı satırları. Kasa
raporunun kartlı satış payı (banka POS komisyonu için) değişmedi: (kart + yemek kartı) ÷ Z.

## 7. Hakediş

- **Ayda tek işaret** (kanal ve satış ayı, `commission_months`): gelen günü ve tutarı. Haftalık ödeyen platformda ayın
  havalelerinin toplamı ve son havalenin günü.
- **Beklenen** = satış − kanalın o ayki faturaları (KDV dahil): kanal komisyonu ve KDV'sini tutar, kalanını öder.
  Satış bilinmiyorsa yazılmaz. Yemek kartında "~", platformda "yaklaşık" (haftalık fatura ay sınırında kayar). Formül
  hep yanında: "Satış 9.300 ₺ − faturalar 694,80 ₺".
- **Son gün** = ayın en yeni faturası + ödeme süresi (**Kanallar**; varsayılan 30 gün; yemek kartında en çok 30,
  yönetmelik; platformda en çok 90, sözleşmedeki süre). Faturası olmayan ayın son günü yoktur.
- **Durum** (pay = en az 50 ₺, beklenenin %2'si):

| Durum | Ne zaman | Satır |
|---|---|---|
| geldi | İşaretli, beklenen bilinmiyor ya da gelen ≥ beklenen − pay | "Hakediş geldi: 28 Kasım · 8.605,20 ₺" (geç geldiyse "· 3 gün geç") |
| eksik | İşaretli ve gelen < beklenen − pay | "Hakediş geldi: 28 Kasım · 8.000 ₺ · beklenenden 605,20 ₺ az" |
| bekliyor | İşaretsiz, bugün ≤ son gün | "Hakediş: beklenen ~8.605,20 ₺ · son gün 30 Kasım" |
| gecikti | İşaretsiz, son gün geçti, son gün takibin başlangıcında ya da sonra | aynısı kırmızı + "· 2 gün gecikti" |
| takip öncesi | İşaretsiz, son gün takibin başlangıcından önce geçti | "Hakediş: son gün 30 Eylül geçti (takip öncesi). İsterseniz işaretleyin." |
| faturasız | Fatura yok, satış yazılmış | "Hakediş: fatura gelince son gün belli olur." |

- **Takibin başlangıcı** (`integration_state` › `komisyon.since`, YYYY-MM-DD): yalnız yazma yollarında bir kez yazılır
  (sabah e-postasının gönderimi, hakediş ve kanal kaydı); ekran, zil ve Bugün yazmaz, kayıt yoksa bugünü kullanır. Böylece
  açılışta çoktan gelmiş hakedişler kırmızı yığılmaz. Sabah e-postası kapalıysa takip ilk işaretle ya da Kanallar
  kaydıyla başlar.
- Erken gelen havale (fatura ve satış yokken) de işaretlenebilir: durumu "geldi".

## 8. Zil, Bugün, sabah e-postası

- **Zil** (yalnız yönetici, **Faturalar** başlığı): geciken hakediş ("Hakediş gecikti: Pluxee (Ekim)" · "Son gün 30 Kasım
  · beklenen ~8.605,20 ₺. Geldiyse işaretleyin."), kesin (kırmızı) %6 aşımı ("Pluxee Ekim: kesinti %6,2"), komisyon dışı
  ücret ("Multinet Ekim: komisyon dışı ücret olabilir" · kalemleri) ve kart kart oran yokken yemek kartlarının toplamının
  aşımı ("Yemek kartları Ekim: ortalama kesinti %6,3"). Oran ve ücret yalnız ayın son faturası 45 günden yeniyse. Önce
  gecikenler, sonra en yeni; en çok beş. Kimlik uyarının anahtarından: yeni oran ya da yeni fatura yeniden okunmamış
  olur. Bağlantı `?ay=…#kanal`.
- **Bugün** (yönetici): geciken hakediş varsa Ödemeler'in ardından **Hakedişler** satırı, "sorun var": "Pluxee (Eylül) ·
  son gün 20 Ekim ve 1 hakediş daha", **Hakedişlere bak** ([BUGUN.md](BUGUN.md)).
- **Sabah e-postası:** "Komisyon ve hakediş" kutusu (fiyat onayından sonra, kontrol listelerinden önce): zilin
  uyarılarından daha önce e-postayla bildirilmemiş olanlar, her biri bir kez (`notification_log` › `komisyon:<uyarı>`,
  ör. `komisyon:gecikti:pluxee:2026-10`, `komisyon:oran:pluxee:2026-10:62`), en çok beş; bağlantı Komisyon & hakediş.
  Konuya giden parça: tek gecikme "Hakediş gecikti: Pluxee (Ekim)", birden çoğu "2 hakediş gecikti", gecikme yoksa
  "komisyon uyarısı". Kutu e-postayı tek başına gönderir; önizleme hiçbir şey yazmaz ([BILDIRIMLER.md](BILDIRIMLER.md)).
- Zil, Bugün ve e-posta **hafif yoldan** okur: son 4 ayın Komisyon faturaları ve kalemleri, hakediş işaretleri, kanal
  ayarları ve ayların Z'deki yemek kartı / online toplamı (dört küçük sorgu, maliyet modeli yok); adı bir kanala
  bağlanmayan fatura varsa tedarikçi kartları da (§2). Biri bozulursa yalnız kendisi düşer.

## 9. Yasal dayanak

Uyarılar kalem adlarına bakar; **kesin hüküm değildir**. Şüphede önce kanalın müşteri hizmetine yazılır; çözülmezse
Ticaret Bakanlığı'nın il müdürlüğüne şikâyet edilebilir.

- **Yemek kartı:** Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik, madde 12/A (Resmî Gazete
  22.05.2018, sayı 30428 ile eklendi). Yayımlanan özetlerdeki ifadeyle: yemek kartı hizmeti veren kuruluşların anlaşmalı
  perakende işletmelere uygulayacağı komisyon oranı **yüzde 6'yı geçemez**; kuruluşlar sözleşmeyle belirlenen komisyon
  dışında **uygulama barındırma, kira, sarf malzemesi, işletim, teknik destek, bakım bedeli ve depozito gibi adlar
  altında** bedel talep edemez; ödemelerin süresi **30 günü aşamaz** ve süre **fatura tarihinden** başlar.
- **Sipariş platformları:** Ticaret Bakanlığı Genelgesi 2026/1 "Hizmet Bedellerinin Şeffaflığının Sağlanması Hakkında"
  (13 Mart 2026; uyum 1 Nisan 2026): platformlar satıcıdan aldıkları komisyon, reklam, kampanya, taşıma ve benzeri
  bedelleri satıcı panelinde **kalem kalem** gösterir; **siparişin alınması, iletilmesi ve ödeme altyapısı** gibi asli
  aracılık hizmetleri için ayrıca ücret istenemez; ek hizmet, kampanya, indirim ya da reklama zorlanamaz; kampanyalı
  satışta komisyon alıcının ödediği nihai bedel üzerinden hesaplanır.

Metinler resmî kaynağa (mevzuat.gov.tr, resmigazete.gov.tr, ticaret.gov.tr) bu oturumdan erişilemediği için basın ve
oda özetlerinden derlendi (ntv.com.tr, etuder.org.tr, tesk.org.tr 23.05.2018 genelgesi; alomaliye.com 13.03.2026,
ticaretgazetesi.com.tr 13.04.2026); sonraki bir değişiklik olup olmadığı kanıtlanmadı. Kullanmadan önce yürürlükteki
metni mevzuat.gov.tr'den denetleyin; "Kurallar ve hesap" kartındaki cümleler ona göre düzeltilir.

## 10. Veri

- `commission_months`: kanal ve satış ayı başına bir satır (`channel`, `month`, `sales`, `received_on`, `received`,
  `note`, kim, ne zaman). Yalnız yönetici bir şey yazınca açılır, her şey boşalınca silinir; gün ve tutar birlikte dolu ya
  da boş (`commission_months_received_pair`). Faturalara değil kanal ve aya bağlıdır.
- `integration_state`: `komisyon.ayar` (`{ channels: { pluxee: { payDays: 30 }, … } }`) ve `komisyon.since`.
- Yedek: tablo ve anahtarlar kendiliğinden girer (gizli bilgi yok; [YEDEK.md](YEDEK.md)).
- `npm run db:reset` hakediş işaretlerini ve kanal ayarlarını silmez (faturalar yeniden yüklense de kanal ve ay aynı);
  bildirim günlüğü silindiği için bir uyarı bir kez daha e-postalanabilir.
- İşlem geçmişi (Komisyon & hakediş): "Hakediş geldi: Pluxee Ekim 2026 · 8.605,20 ₺ (28 Kasım)", "Hakediş işareti
  kaldırıldı: …", "Komisyon kanalı satışı: Pluxee Ekim 2026 → 9.300 ₺", "Kanallar: Trendyol Go ödeme süresi 30 → 14 gün".

## 11. Dosyalar ve testler

| Dosya | Ne |
|---|---|
| `src/lib/commission/channels.ts` | Kanal kaydı, adın kanalı, kalemin sınıfı |
| `src/lib/commission/report.ts` | Rapor (satış, oran, uyarılar, hakediş, gruplar), zil ve e-posta uyarıları, e-posta kutusu ve daha önce gönderilenlerin elenmesi, kanal ayarları, sorgunun satırlarından faturalar, hakediş kaydının farkı (Geri al ve işlem geçmişi) |
| `src/server/data/commission.ts` | Okuma (ekran ve hafif yol), sabah e-postası kaynağı, takibin başlangıcı |
| `src/server/actions/commission.ts` | `saveChannelMonth` (hakediş, satış, not; Geri al için öncekiler), `saveCommissionSettings` |
| `src/app/panel/komisyonlar/` | Ekran: `page.tsx`, kanal kartı, yemek kartları toplamı, bekleyen hakedişler, hakediş penceresi, Kanallar, `texts.ts` (saf metinler) |
| `src/server/notify/digest-extras.ts`, `src/server/actions/notifications.ts`, `src/server/data/today.ts`, `src/app/panel/bugun/logic.ts` | Sabah e-postası kutusu, zil, Bugün satırı |

Testler: `tests/komisyon.test.ts` (kanallar, kalemler, ay, satışın kaynağı ve sonraki ayda kesilen fatura, oran ve
uyarılar, ay sonunda kesilmeyen fatura, toplam, Z'de 0, hakediş, uyarı sırası ve anahtarları, e-posta kutusu, konu ve
daha önce gönderilenler, Excel'deki 10 faturalık veri, ekran metinleri, kaydın farkı ve Geri al, sorgunun satırları,
kaynak denetimi),
`tests/bugun.test.ts` (Hakedişler satırı), `tests/mobile-nav.test.ts`, `tests/yardim.test.ts`.

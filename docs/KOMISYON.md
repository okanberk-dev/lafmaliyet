# Komisyon ve hakediş (yemek kartları ve sipariş platformları)

Ekran: **Satış › Komisyon & hakediş** (`/panel/komisyonlar`, yalnız yönetici; ⌘K'da "komisyon", "hakediş",
"pluxee" …). Soru: yemek kartı şirketleri (Pluxee, Multinet, Edenred, Setcard, Metropol) ve sipariş platformları
(Yemeksepeti, Trendyol Go, Getir, Migros Yemek) her ay gerçekte ne kadar kesiyor, kestikleri yasaya uygun mu,
hakediş geldi mi? Hesap saf modüllerdedir: `src/lib/commission/channels.ts` (kanallar, kalemin sınıfı) ve
`src/lib/commission/report.ts` (rapor, uyarılar, hakediş, zil ve e-posta); testleri `tests/komisyon.test.ts`.

Banka hesabı panele bağlı değildir (Paraşüt'te de bağlı değil): hakedişin geldiğini yönetici işaretler, hiçbir şey
kendiliğinden işaretlenmez. Banka POS'unun (kredi kartı) hakedişi ayrı ekranda, yüklenen banka ekstresiyle karşılaştırılır:
Mutabakat › POS hakediş ([MUTABAKAT.md](MUTABAKAT.md)); yemek kartı ve platform hakedişini o da işaretlemez. Komisyon faturalarının ödeme durumuna dokunulmaz (Paraşüt'ten "ödendi" gelirler,
[TEDARIKCILER.md](TEDARIKCILER.md)). Panel Paraşüt'e yeni bir istek atmaz: yalnız eşitlemenin yazdığı alış faturalarını
ve kalemlerini okur.

## 1. Ekran

**Şube** (23 Kasım 2026; [SUBE.md](SUBE.md)): satış seçili şubenin kasa raporlarından, AsilPOS gün sonlarından ve ModPOS
föyünden okunur (ilk rapor, açılış günü ve kapalı günler de şubenin; ModPOS'ta kalan şube seçiliyken AsilPOS okunmaz). Komisyon
faturaları, oran, beklenen hakediş ve uyarılar işletmenindir: faturalar şubeye bölünmez, oran bütün şubelerin satışıyla
hesaplanır. Şube seçiliyken ekran işletmenin raporunu gösterir; üstte "Marina seçili: satış yalnız bu şubenin, faturalar
ve hakediş işletmenin" notu ve **Marina payı** kartı (kanal kanal şubenin satışı, işletmenin oranı, pay = satış × oran;
`branchCommissionShare`). Zil, Bugün, sabah e-postası ve haftalık özet seçiciden bağımsız, işletme genelidir
(`withBranchScope(ALL_BRANCHES, …)`). Önceden ekran seçimi hiç okumuyordu: her şubede bütün şubelerin satışı vardı.
Şubenin payı "Tümü"yle aynı kuralla sayılır, payların toplamı işletmenin faturasını aşmaz:

- **ModPOS'ta kalan şube** (Tuzla) seçiliyken de geçiş ayından itibaren Z'deki yemek kartı ve online tek kanala yazılmaz
  (`modposScope`, `commissionScopeDays`): föyde markası olan kısım kanalına ("ModPOS föyünden"), kalan **Marka belirsiz**.
  Önceden şube görünümünde `tek` kuralı sürüyordu: Tuzla'nın bütün Z'si tek karta yazılır, "Tuzla payı" işletmenin bütün
  faturasından büyük çıkabilirdi. Geçiş ayından önceki aylar eski kuralla (tek kanal). **Geçiş günü sonra olan kasa**
  (çok şube, inceleme 27 Kasım 2026; ör. Kadıköy 10 Aralık'ta, Marina 22 Kasım'da geçer) seçiliyken de kasaların ilk
  geçiş ayından kendi geçiş ayına dek aynı kural (`commissionScopeDays`: `modpos` ilk geçiş günü, kendi geçiş ayından
  itibaren AsilPOS ayı kazanır; föyün markası ilk geçiş ayının başından okunur): önceden bu aylar `tek` yazılır, şubelerin
  payı faturayı aşardı ve ileri bir geçiş günü kaydetmek geçmiş ayları değiştirirdi.
- **Sonradan açılan şubenin açılış ayı** (Marina, 13 Kasım 2026) "kasa raporları ay ortasında başladı" sayılmaz
  (`openedOn`, Kasa'nın kuralı `tillOpenedOn` / `partialStart`); önceden Marina'nın Kasım'ındaki bütün kanallar "Satış
  bilinmiyor" çıkıyordu.
- **Elle yazılan ekstre satışı işletmenindir** (`commission_months` şubesiz): şubenin payı şubenin kendi kaynağından
  (AsilPOS, föy, Z) gelir, ekstreden değil; yoksa ekstrenin tamamı her şubenin payına girerdi.
- **Yemek kartı kullanılmayan şube** (şube özelliği `yemek_karti`, Şube ayarları › Özellikler; [SUBE.md › Şube
  özellikleri](SUBE.md#şube-özellikleri-25-kasım-2026)) seçiliyken menüde Komisyon & hakediş yoktur, sayfa "bu şubede
  kullanılmıyor" der; zilin ve Bugün'ün komisyon satırları ile o şubeye bağlı alıcının sabah e-postasındaki kutu çıkmaz.
- Kartın altında şubenin markası belirsiz satışı yazar ("Şubenin markası belirsiz satışı: yemek kartı 1.000 ₺. Hiçbir
  kanala yazılmaz, paya girmez …").

Telefonda tek sütun, bu sırayla; geniş ekranda kanal kartları iki sütun.

| Bölüm | İçerik |
|---|---|
| **Bekleyen hakedişler** | Son 13 ayın gelmesi gereken parası: gecikti (kırmızı), eksik geldi, son günü 7 gün içinde (Bu hafta). En acil önce; **Geldi** penceresi açar, ad kanalın kartına götürür. Yoksa kart yok |
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
(ekstre, hakediş raporu) satış, KDV dahil; boş bırakılırsa AsilPOS'tan önceki aylarda Z toplamı (grupta tek kanal
varsa), AsilPOS'un girdiği ayda kanalın AsilPOS ödemeleri ve ModPOS föyündeki markalı ödemeleri, yoksa bilinmez; not.
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
| `asilpos` | AsilPOS'a geçiş günü seçili ve ay o günden itibaren AsilPOS'un gün sonlarını içeriyor (aşağıda, "AsilPOS'tan kart kart"): kanalın AsilPOS ödemeleri + ModPOS föyünde markası bulunan ödemeleri (geçiş gününden önceki günler, ModPOS'ta kalan şube); markası belirsiz tutar tek kanala da yazılmaz | AsilPOS ödemelerinden / AsilPOS ödemeleri ve ModPOS föyünden / ModPOS föyünden |
| `tek` | Yalnız AsilPOS'un girmediği aylarda (geçiş ayından önce ya da geçiş günü yokken): o ay grubunda (yemek kartı ya da platform) etkin tek kanal bu ve faturası var; ayın kasa raporu var, ay ortasında başlamadı, Z'de grubun tutarı > 0 → grubun bütün Z toplamı | Z'deki yemek kartı toplamı (tek kart) / Z'deki online (platformlar) toplamı (tek platform) |
| – | Yoksa | *Satış bilinmiyor* ve nedeni: bu ay kasa raporu yok; kasa raporları 16 Ekim'de başladı; Z'de yemek kartları tek toplam ve bu ay 2 kart var; Z'deki online (platformlar) tek toplam ve 14 Kasım tarihli Yemeksepeti faturası Ekim satışlarını da kapsıyor olabilir; bu ayın kasa raporlarında yemek kartı tutarı yok. Hepsinin sonu: "Kanalın ekstresindeki satışı yazarsanız oran hesaplanır." |

- **Etkin kanal:** o ay faturası, yazılmış satışı (> 0) ya da gelen hakedişi olan. Satışı 0 yazılan kanal etkin
  sayılmaz (o ay kullanılmadı); hakedişi gelen kanal sayılır (satışı da o aydan geçmiştir). Faturası **sonraki ayın
  1–15'inde** kesilen kanal da etkin sayılır (ilk ayı ya da kayan fatura: o fatura bu ayın satışlarını kapsıyor
  olabilir; 15'i `fatura-yok` uyarısının da günü). Yoksa Z'deki toplamın tamamı öteki kanala yazılır, oranı düşük,
  beklenen hakedişi yüksek görünürdü; ayın ilk 5 gününde kesilen yemek kartı faturası zaten önceki aya sayılır (§5).
- **Yarım ilk ay:** ilk kasa raporu ayın ortasındaysa (Kasa raporu ekranının `partialFrom` kuralı) Z toplamı ayın bir
  kısmıdır, kullanılmaz; canlıda Ekim 2026 böyle, ilk tam ay Kasım 2026.
- **Kapalı işaretli günler** (özel günlerin `kapali` satırı, raporu olmayan; dalga 10 §2.9) eksik sayılmaz ama
  sessizce düşmez: alt satır "29 / 31 gün raporlu · 2 gün kapalı" ya da "1 gün rapor yok · 2 gün kapalı"
  (`channelTill`, `closed`).
- **Eksik günler** (ayın başından ya da ilk rapordan ayın sonuna ya da düne kadar raporu olmayan gün) Z toplamını
  durdurmaz; *kasa-eksik* bilgisini ekler ve Z toplamıyla bulunan %6 aşımını kırmızıdan turuncuya indirir.
- **Yemek kartlarının toplamı** her zaman hesaplanır: Z'deki yemek kartı (yarım ayda yok) ÷ bütün yemek kartı
  faturaları. Ortalama %6'yı aşıyorsa en az bir kart aşıyordur; kart kart oran için her kartın ekstresindeki satış yazılır.

### AsilPOS'tan kart kart (denetim E-37)

AsilPOS gün sonunda her ödeme türünü kanalıyla yollar (`pos_day_reports.payments`: ad, Z alanı, kanal, tutar;
[ASILPOS.md](ASILPOS.md) › Komisyon). Ayarlar › AsilPOS › **AsilPOS'a geçiş günü** seçilince o günden itibaren bir kanalın
satışı, yazılmadıysa, kendi ödemelerinden gelir: **elle > asilpos > tek**. Geçiş günü boşken AsilPOS tablosu hiç okunmaz,
ekran ve uyarılar bugünkü gibi; geçiş gününden önceki AsilPOS günleri (deneme) hiçbir aya girmez.

- **Hangi ay:** ayın AsilPOS kısmı geçiş gününden (ya da ayın 1'inden) başlar (`asilposMonth`). Geçiş günü ileride ve o
  aydan henüz gün sonu gelmediyse ay bugünkü gibidir. Ayın önceki ayları hep kasa raporlarından.
- **Kanal:** AsilPOS'taki kanal yazısı anahtar ("pluxee") ya da kanalın adı ("Sodexo", "Ticket Restaurant",
  "Trendyol Go") olarak tanınır (`asilposChannel`); kanalın türü grubu belirler. Kanalı seçilmemiş ya da tanınmayan
  ödeme türü Z alanına göre gruba gider (yemek kartı ya da online; nakit, kart ve diğer komisyona girmez): grup kartında
  bilgi satırı "AsilPOS'ta kanalı seçilmemiş ya da tanınmayan ödeme türü: “Ticket kart” (kanal “Ticket”) 300 ₺. Bu tutar
  hiçbir karta yazılmaz, markası belirsiz satırda; AsilPOS'ta ödeme türünün kanalını seçin." (Platformlar satırının
  altında da). Grupta tek kanal olsa da o tutar ona yazılmaz (23 Kasım 2026; eskiden "Bu ay tek kart olduğu için ona
  yazıldı": kartın oranı düşük, beklenen hakedişi yüksek görünürdü).
- **Geçiş ayı:** geçiş gününden önceki günlerin Z'si (grubun tek toplamı) hiçbir kanala yazılmaz, tek kanal olsa da
  (23 Kasım 2026; eskiden tek kanalda kanalın AsilPOS ödemelerine eklenirdi, birden çok kanalda ay bilinmezdi): grubun
  **Marka belirsiz** satırında durur, kanalın satışı AsilPOS ödemeleridir ve `kasa-eksik` bilgisi "Z'de markası belirsiz
  900 ₺ var; satış eksik kaldıysa oran yüksek görünür." der. O günlerin ModPOS föyünde markası olan ödeme (Pluxee,
  Multinet, Yemeksepeti …; `modposChannels`) kanalına yazılır. Önceki günlerin hiç kasa raporu yoksa "AsilPOS 10
  Kasım'da başladı, öncesinin kasa raporu yok"; kasa raporları geç başladıysa bugünkü "kasa raporları … başladı".
- **ModPOS'ta kalan şube** (Tuzla; geçiş günü yalnız Marina'nın kasasınındır, [ASILPOS.md](ASILPOS.md) › Şubeler):
  kasa raporları AsilPOS'un girdiği ayda da sayılır, geçiş gününden önceki günler gibi (Z'de grubun tek toplamı;
  `asilposMonth` `modpos`): grubun Z toplamına eklenir; hiçbir kanala yazılmaz, tek kanal olsa da (23 Kasım 2026;
  eskiden tek kanalda kanalın AsilPOS ödemelerine eklenirdi): **Marka belirsiz** satırında durur. Tuzla'nın ModPOS
  föyünde markası olan ödeme kanalına yazılır (föyün markalı tutarı o günün Z'sini aşıyorsa o gün bölünmez). Marina'nın
  raporu yalnız gün sonu gelmeyen günün yedeğidir (denetim 21 Kasım #5: önceden Tuzla'nın raporu bu yedeğin yerine
  geçiyor ya da hiç sayılmıyordu).
- **Marka belirsiz** (`GroupMonth.unbranded`; yalnız AsilPOS'un girdiği ayda): geçiş gününden önceki günlerin ve
  ModPOS'ta kalan şubenin Z'sinden föyde markası bulunmayan kısım, AsilPOS'ta kanalı seçilmemiş ödeme ve gün sonu
  gelmemiş günün kasa raporu. Yemek kartları kartının ve Platformlar satırının altında: "Marka belirsiz: 6.300 ₺
  (ModPOS'ta kalan şubenin Z'si 6.000 ₺, AsilPOS'ta kanalı seçilmemiş ödeme 300 ₺). Hiçbir karta yazılmaz; kartın oranı
  yalnız markası bilinen satışla hesaplanır." Grubun Z toplamı ve ortalama oranı onu da içerir.
- **Eksik gün:** gün sonu gelmeyen gün kasa raporu varsa grubun toplamına rapordan girer (kart kart bilinmez), ikisi de
  yoksa eksik sayılır (kapalı işaretli gün değil). Günler takvim günüdür: "Tümü"de iki kasanın aynı eksik günü "N gün"
  metninde bir kez, kayıtlı gün sayısı da takvim günü (çok şube, inceleme 27 Kasım 2026). Kanalın satışı o zaman ödemelerinin toplamıdır; `kasa-eksik` bilgisi
  ne eksik kaldığını söyler ("9 gün AsilPOS gün sonu yok ve kanalı seçilmemiş 300 ₺ ödeme var ve Z'de markası belirsiz
  6.000 ₺ var; satış eksik kaldıysa oran yüksek görünür.") ve %6 aşımını kırmızıdan turuncuya indirir ("… 9 gün AsilPOS gün sonu yok; kesin değil, kontrol
  edin."). Eksiksiz AsilPOS ayında aşım kesindir (AsilPOS kartın ödemesini kendisi yollar).
- **Etkin kanal:** AsilPOS'ta o ay ödemesi olan kanal da etkindir; faturası gelmemişse de kartı çıkar ("Fatura bekleniyor",
  hakediş "fatura gelince son gün belli olur") ve sonraki ayın 15'inden sonra `fatura-yok` uyarır ("Kasım ayında 900 ₺
  satış var ama komisyon faturası gelmedi."). Kanalın sonraki ayın ilk yarısında (en geç 15'i) kesilmiş faturası varsa
  uyarı yerine bilgi çıkar (`fatura-kayan`): "8 Aralık tarihli fatura Kasım satışlarını kapsıyor olabilir; Aralık ayında
  sayılıyor." (yemek kartında 1–5'inde kesilen zaten önceki aya sayılır). Faturası olup AsilPOS'ta ödemesi olmayan kanal:
  "Satış bilinmiyor: AsilPOS'ta bu ay Edenred ödemesi yok." Ayın tamamı AsilPOS'tansa Yemek kartları kartının altındaki
  not Z'nin tek toplam olduğunu söylemez, satışı bilinmeyen kartları adlandırır: "Edenred için AsilPOS'ta ödeme yok:
  ödeme türünün kanalını AsilPOS'ta seçin ya da kartın aylık ekstresindeki satışı kartın altındaki Satışı yaz ile girin."
  (geçiş ayında "AsilPOS 10 Kasım'da başladı; öncesinde Z raporunda yemek kartları tek toplam. …"). Sayfanın açıklaması
  geçiş günü seçiliyken satışın AsilPOS'un ödemelerinden de geldiğini söyler.
- **Grubun toplamı** (Yemek kartları kartı, Platformlar satırı): geçiş gününden önceki kasa raporları + AsilPOS'un
  Z'sindeki yemek kartı / online (gün sonu gelmeyen raporlu günde rapordan). Alt satır "30 / 30 gün kayıtlı ·
  AsilPOS'tan", geçiş ayında "… · 10 Kasım'dan AsilPOS", eksikte "2 gün kayıt yok · AsilPOS'tan".
- Hakediş penceresinde satış boşsa kullanılacak tutar: "Boş bırakırsanız AsilPOS'taki ödemeler kullanılır: 1.550 ₺.";
  ModPOS föyünden markalı ödeme de varsa "Boş bırakırsanız AsilPOS ödemeleri ve ModPOS föyündeki markalı ödemeler
  kullanılır: 29.000 ₺ (föyden 9.000 ₺)." (`autoSales.foy`). Markası belirsiz tutar hiçbir zaman kanala yazılmaz.
  "Kurallar ve hesap"ın Gerçek oran maddesi geçiş günü seçiliyken AsilPOS'u da anar.

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
- **Kalemsiz** fatura (içe aktarılmış, elle girilen ya da kalemi henüz okunmamış e-fatura): tutarın tamamı komisyon.
- Kalem tutarları faturanın KDV hariç tutarına (`amount − discount`) ölçeklenir: sınıfların toplamı Gelir-gider'in
  saydığı tutardır (fatura altı iskonto ve kuruş farkı dahil). İade (eksi) faturası düşer; ayın toplamı eksiye düşerse
  oran yazılmaz.
- KDV = ödenecek − KDV hariç (içe aktarılmış kayıtlarda KDV sütunu 0); yalnız beklenen hakedişte kullanılır.

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
| `fatura-yok` | ikisi | Elle yazılan (ya da AsilPOS'tan gelen) satış > 0, o ay faturası yok, sonraki ayın 15'i geldi | Turuncu | "Ekim ayında 2.000 ₺ satış var ama komisyon faturası gelmedi." |
| `fatura-kayan` | ikisi | `fatura-yok`'un koşulu, satış AsilPOS'tan ve kanalın sonraki ayın 15'ine kadar kesilmiş faturası var | Mavi | "8 Aralık tarihli fatura Kasım satışlarını kapsıyor olabilir; Aralık ayında sayılıyor." |
| `kasa-eksik` | ikisi | Satış Z toplamından (tek kanal) ve ayın eksik günü var | Mavi | "3 gün kasa raporu yok; satış eksik kaldıysa oran yüksek görünür." |

Yemek kartlarının toplamında: `oran-sinir` ("Ortalama kesinti %6,3: en az bir yemek kartı %6'yı aşıyor."; eksik günde
ya da ay sonunda kesilmeyen faturada turuncu ve "… %6'yı aşıyor olabilir.", nedeniyle) ve `fatura-yok` ("Ekim'de
15.500 ₺ yemek kartı satışı var ama hiçbir yemek kartı faturası gelmedi.", sonraki ayın 15'inden sonra). Birden çok kart
varken satışı yazılmamış kart varsa kart kart oranın ekstreyle çıkacağı yazar. Zil ve e-posta yalnız kırmızıda uyarır.

Bu turda yok (kesildi): faturada yazan işlem tutarı ve dönem okuması, oran sıçraması, taban farkı, başka kategorideki
kanal faturası ve platformun tek kalemli faturası uyarıları; Tedarikçiler'deki bağlantı; Nakit planı satırları.

**Gelir-gider'in banka POS komisyonu** (`commission:pos`, denetim E-43) yalnız banka kartı payıyla hesaplanır: kasa
raporu olan ayda Σ kart ÷ Σ Z (`TillMonth.bankShare`, `engine.ts bankShareOf`); yemek kartı hariç, çünkü yemek
kartlarının komisyonu bu ekrandaki faturalarıyla Gelir-gider'in Komisyon bölümünde zaten sayılır. Satışlar'da kartlı
oran elle yazıldıysa ondan kasa raporlarındaki yemek kartı payı düşülür. Kasa raporu olmayan ayda kartlı satış oranı
(elle ya da Ayarlar'daki, yemek kartı dahil; hücre ipucu "yemek kartı payı ayrılamadı" der). Kartlı satış oranı
((kart + yemek kartı) ÷ Z) yalnız satış raporunun ürün başına tahmini komisyonunda kalır. Ayda **kanalı bulunamayan**
bir Komisyon faturası varsa (ör. bankanın POS komisyonu faturası; kanal bu ekrandaki gibi faturadaki adla, sonra
tedarikçi kartının adı ve diğer adlarıyla aranır: "Diğer adlar"a eklenen unvan uyarıyı da kaldırır) ve hücre elle
yazılmamışsa hücrede uyarı çıkar: banka faturasıysa tahmin onu ikinci kez sayar, hücreye 0 yazılır. Gelir-gider'deki
komisyon faturası satırı Faturalar'da o ayın tarihli Komisyon faturalarını açar (bu ekran 1-5'inde kesilen yemek kartı
faturasını önceki aya koyar).
Bankanın POS komisyonunu ayrıca fatura ya da dekont olarak gönderip göndermediği sahibe soru (denetim, soru 9).

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
  gecikenler, **en eski son gün önce** (en acil olanı; denetim E-68: en yeni önce gelince birikmiş gecikmelerin en
  eskisi beşin dışında kalıyordu), sonra öteki uyarılar, en yeni önce; en çok beş. Geciken hakedişler beşe sığmazsa
  son satır özet olur: "6 hakediş daha gecikti" · "Getir (Ağustos), Pluxee (Eylül), Multinet (Eylül) ve 3 hakediş
  daha. Hepsi Komisyon & hakediş'te ve Bugün'de." (bağlantı Komisyon & hakediş). Kimlik uyarının anahtarından: yeni
  oran, yeni fatura ya da özete giren daha yeni bir gecikme yeniden okunmamış olur; özetin kimliği içindeki en yeni
  gecikmeden türer, eskiler "geldi" işaretlenip liste kısalınca değişmez. Özet okununca içindeki satırlar da okunmuş
  sayılır (`covers`): biri sonra tek satıra çıkınca yeniden okunmamış olmaz. Bağlantı `?ay=…#kanal`.
- **Bugün** (yönetici): geciken hakediş varsa Ödemeler'in ardından **Hakedişler** satırı, "sorun var": "Pluxee hakedişi
  (Eylül satışları): son gün 20 Ekim. 1 hakediş daha gecikti. Geldiyse işaretleyin.", **Hakedişlere bak**
  ([BUGUN.md](BUGUN.md)). Ay hakedişin satış ayıdır; bu yıldan değilse yılıyla ("Ekim 2025 satışları").
- **Sabah e-postası:** "Komisyon ve hakediş" kutusu (fiyat onayından sonra, kontrol listelerinden önce): zilin
  uyarılarından daha önce e-postayla bildirilmemiş olanlar, her biri bir kez (`notification_log` › `komisyon:<uyarı>`,
  ör. `komisyon:gecikti:pluxee:2026-10`, `komisyon:oran:pluxee:2026-10:62`), en çok beş; bağlantı Komisyon & hakediş.
  Konuya giden parça: tek gecikme "Hakediş gecikti: Pluxee (Ekim)", birden çoğu "2 hakediş gecikti", gecikme yoksa
  "komisyon uyarısı". Kutu e-postayı tek başına gönderir; önizleme hiçbir şey yazmaz ([BILDIRIMLER.md](BILDIRIMLER.md)).
- Zil, Bugün ve e-posta **hafif yoldan** okur: ekranla aynı 13 ayın (bu ay dahil, `reportWindow`) Komisyon faturaları
  ve kalemleri, hakediş işaretleri, kanal ayarları ve ayların Z'deki yemek kartı / online toplamı (dört küçük sorgu,
  maliyet modeli yok); adı bir kanala bağlanmayan fatura varsa tedarikçi kartları da (§2). Ekrandan tek farkı kanalın
  adla bulunması. Biri bozulursa yalnız kendisi düşer.
- **Geciken hakediş işaretlenene kadar** zilde ve Bugün'de kalır; ay dönünce düşmez (ilk sürümün 4 aylık penceresi
  satış ayı pencereden çıkınca uyarıyı düşürüyordu, ödeme süresi 90 gün olan platformda çoğu ay hiç göstermiyordu).
  E-posta her gecikmeyi yine bir kez gönderir. 13 aydan eski satış ayı ekranda da yoktur.

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
- Kanalların ödeme süresi **şube başına** (25 Kasım 2026; şube ayarı `komisyon`, `branch_settings`, [SUBE.md](SUBE.md) ›
  Şube başına ayarlar): `{ channels: { pluxee: { payDays: 30 }, … } }`. Sahibin varsayılanı "aynı": satırı olmayan
  şube Tuzla'nın sürelerini kullanır; eski genel kayıt (`integration_state` › `komisyon.ayar`) Tuzla'nındır, hiçbir şey
  yapmadan bugünkü gibi. Faturalar, hakediş ve işaretleri işletmenin (hangi şubenin sözleşmesine düştükleri bilinmez):
  hakedişin son günü **yemek kartı açık şubelerin en kısa süresiyle** hesaplanır (`businessPayDays`,
  `src/lib/commission/report.ts`). Ekran seçici ne olursa olsun, zil, Bugün, sabah e-postası ve haftalık özet aynı son
  günü görür; Marina'nın Multinet'i 15, Tuzla'nınki 30 günse işletmenin Multinet hakedişi 15 günle izlenir. Kanallar
  kartı (Komisyon & hakediş ve Şube ayarları aynı bileşen) seçili şubenin kendi sürelerini düzenler; birden çok kasa
  açıkken "Diğer şubeyle aynı"yı taşır ve "son gün şubelerin en kısa süresiyle" der; bağlı şubede süreler salt okunur.
  Takibin başladığı gün `integration_state` › `komisyon.since` ve hakediş işaretleri işletme geneli kalır.
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
| `src/server/data/commission.ts` | Okuma (ekran ve hafif yol; seçili şubenin satışı, işletmenin faturaları; geçiş günü seçiliyse AsilPOS'un ödemeleri ve ModPOS föyünün markalı ödemeleri de), sabah e-postası kaynağı, takibin başlangıcı |
| `src/server/actions/commission.ts` | `saveChannelMonth` (hakediş, satış, not; Geri al için öncekiler), `saveCommissionSettings` |
| `src/app/panel/komisyonlar/` | Ekran: `page.tsx`, kanal kartı, yemek kartları toplamı, bekleyen hakedişler, hakediş penceresi, şubenin payı (`branch-share-card.tsx`), Kanallar, `texts.ts` (saf metinler) |
| `src/server/notify/digest-extras.ts`, `src/server/actions/notifications.ts`, `src/server/data/today.ts`, `src/app/panel/bugun/logic.ts` | Sabah e-postası kutusu, zil, Bugün satırı |

Testler: `tests/komisyon.test.ts` (kanallar, kalemler, ay, satışın kaynağı ve sonraki ayda kesilen fatura, oran ve
uyarılar, ay sonunda kesilmeyen fatura, toplam, Z'de 0, hakediş, geciken hakedişin ay dönünce uyarıdan düşmemesi (13
aylık tek pencere, 90 günlük platform), uyarı sırası ve anahtarları, e-posta kutusu, konu ve
daha önce gönderilenler, tohum verisindeki 10 fatura, ekran metinleri, kaydın farkı ve Geri al, sorgunun satırları,
kaynak denetimi),
`tests/asilpos-komisyon.test.ts` (AsilPOS'un kanalları: geçiş günü boşken aynı rapor, AsilPOS ayı, elle > asilpos, eksik gün,
geçiş ayı, kanalsız ödeme, faturası gelmeyen kanal), `tests/asilpos-komisyon-ikram-db.test.ts` (okuyucu: deneme günü
hariç, kanalın tanınması), `tests/hesap-uyumu-faz1.test.ts` ve `tests/hesap-uyumu-faz1-db.test.ts` (marka belirsiz,
föyden marka, şube görünümü ve şubenin payı, hafif yolların işletme geneli kalması), `tests/bugun.test.ts` (Hakedişler
satırı), `tests/mobile-nav.test.ts`, `tests/yardim.test.ts`.

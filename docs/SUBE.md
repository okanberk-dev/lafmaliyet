# Şubeler ve kanallar

Panel 4 Kasım 2026'ya kadar tek işletmeye göre kuruluydu. Marina şubesi açılınca ciro, kasa ve giderlerin şubeye
göre ayrılması gerekti; aynı listede laffogato.net'in **online kanalı** da duruyor, çünkü sitenin cirosu bir
şubenin cirosu değil ama işletmenin cirosudur.

Sahibin kararları (4 Kasım 2026):

| Soru | Karar |
|---|---|
| Menü, reçete, hammadde, tedarikçi | **Ortak**; şubeye göre değişen yalnız satış fiyatı ve "Satışta / Tükendi". **24 Kasım 2026:** şube fiyatı yapıldı (sitede satır, panelde Fiyatlar › Şube fiyatı ve Toplu değiştir › Şube, AsilPOS siteden alır; [FIYATLAR.md › Şube fiyatı](FIYATLAR.md#şube-fiyatı-24-kasım-2026)) |
| Panel | **Tek panel** (`ladmin.laffogato.net`) + üstte şube / kanal seçici |
| Marina'nın kasası | **AsilPOS** (22 Kasım 2026'dan beri; Tuzla ModPOS'ta kalır). **23 ve 27 Kasım 2026:** Marina'da ModPOS tamamen bitti (ModPOS dönemi 13–21 Kasım 2026); göç 0099 kasa kaynağını AsilPOS yaptı, föyü çekilmez. **27 Kasım 2026, çok şube:** her fiziksel şubenin kendi AsilPOS kasası olabilir (kendi geçiş günü, anahtarı, gün sonu, kasa e-postası, komisyonu ve durumu; [ASILPOS.md › Şubeler](ASILPOS.md#şubeler-çok-şube-27-kasım-2026)) |
| Bugüne kadarki veri | Hepsi **Tuzla**'ya |

## Kütük

`branches` tablosu (migration `0053_subeler.sql`), kuralları `src/lib/branches.ts` (saf, `tests/subeler.test.ts`):

| Alan | Ne |
|---|---|
| `id` | Kısa kimlik (`tuzla`, `marina`, `online`); adreste, çerezde ve kayıtlarda geçer. **Eklendikten sonra değişmez** |
| `name` | Ekranda görünen ad ("Marina", "laffogato.net") |
| `kind` | `fiziksel` (şube) ya da `online` (kanal) |
| `pos_source` | Gün sonu nereden gelir: `modpos`, `asilpos` ya da `yok` (online). AsilPOS kasaları buradan (kasa kaynağı AsilPOS olan fiziksel şubeler, birden çok olabilir; hiç yoksa Marina, [ASILPOS.md › Şubeler](ASILPOS.md#şubeler-çok-şube-27-kasım-2026)). Veritabanında AsilPOS'un eski değeriyle yazılır |
| `active` | Kapalı şube seçicide ve toplamlarda görünmez; kayıtları durur |
| `opened_on` | Açılış günü; boşsa "başından beri" (Tuzla). Şube görünümünde açılış ayı "kasa raporları ay ortasında başladı" sayılmaz: ilk rapor açılış gününde ya da öncesindeyse ay tamdır; sonradan açılan şubede boşsa ilk raporu açılıştır ([KASA-RAPORU.md › Ay bilgisine aktarım](KASA-RAPORU.md#ay-bilgisine-aktarım)) |
| `sort_order` | Seçicideki ve listedeki sıra |

İlk üç kayıt tohumla gelir (Tuzla, Marina, laffogato.net) ve dolu veritabanında da bir kez yazılır
(`branches_seeded`); silinen ya da adı değiştirilen kayıt geri gelmez.

## Kurallar

Hepsi `src/lib/branches.ts`'te ve hem ekran hem eylem aynı işlevi çağırır; veritabanı da CHECK ile aynı şeyi söyler:

- **Kimlik** harfle başlar, küçük harf / rakam / tire, 2–24 karakter. `hepsi` ayrılmıştır (süzgecin "Tümü" değeri).
- **Online kanalın kasası olmaz**, fiziksel şube kasasız kalmaz (`branches_source_kind_ck`).
- **Tuzla ve laffogato.net** silinemez, kapatılamaz, türü değişmez: panelin ciroyu bölmesi bunlara bağlı.
- **Son açık şube** kapatılamaz (online kanal "açık şube" sayılmaz).
- **Her şubenin kendi AsilPOS kasası olabilir** (sahibin kararı, 27 Kasım 2026; tek şube engeli kalktı). Kasası AsilPOS
  olan şube ModPOS'a dönerken şube AsilPOS'u kullanıyorsa (geçiş günü ya da kayıtlı AsilPOS günü) onay istenir;
  onaylanınca şubenin geçiş günü silinir, AsilPOS günleri saklanır ama hiçbir hesaba girmez (`posOffConfirmText`,
  `src/lib/pos/tills.ts`; `updateBranch`).
- Verisi olan şube **silinmez**, yalnız kapatılır.

## Ekran

**Ayarlar › Şubeler** (`/panel/subeler`, yalnız yönetici): liste, "Şube ekle" ve satıra dokununca düzenleme
penceresi. **26 Kasım 2026:** şube eklemek yalnız ana yöneticide (`info@nextgenlab.com.tr`); e-postayla eklenen
şubenin panel hesabı açılır ve AsilPOS kurulum bağlantısı gider ([ASILPOS.md › Şube kurulumu](ASILPOS.md#şube-kurulumu-26-kasım-2026)). Ad yazılırken kimlik kendiliğinden önerilir ("Laffogato Marina" → `laffogato-marina`), tür değişince
kasa kaynağı uyar. Her değişiklik işlem geçmişine yazılır.

## Dalga 2'nin kararları (4 Kasım 2026)

| Konu | Karar |
|---|---|
| Giderler | Şubeye bağlı; **ortak giderler "işletme geneli"** kalır, hiçbir şubeye zorlanmaz |
| Personel | Herkes bir şubeye bağlı; maaşı o şubenin gideri |
| ModPOS | Şube başına ayrı anahtar; günlük 2 çekim hakkı şube başına (kuruldu, 16 Kasım 2026: [MODPOS-API.md › Şubeler](MODPOS-API.md#1a-şubeler-16-kasım-2026)) |
| Stok ve sayım | Şube başına ayrı; tutarlılık ve FIFO değerleme şube içinde (faturalar bölünmez: şube tutarları aynı faturaları paylaşır, toplamları Tümü'yle tutmaz; stok kartında not, denetim 13 Kasım ST-06) |

"Tümü" seçiliyken işletme geneli giderler toplama girer ama şube kırılımında ayrı sütunda durur: bir şubenin
kârı ortak giderle şişirilmez. **Kuruldu (Faz 5, 23 Kasım 2026; sahibin kararı 4):** aşağıda "İşletme geneli payı".

## Seçici

Kenar çubuğunun başlığının altında **Şube** seçicisi durur (masaüstünde sürekli görünür, telefonda çekmecede):
**Tümü · Tuzla · Marina · laffogato.net**. Tek şube açıkken seçici hiç çizilmez.

Seçimin **tek kaynağı `laf_sube` çerezidir** (`chooseBranchScope`, httpOnly, bir yıl). Next'te `layout.tsx`
adresin sorgusunu almaz, yani seçici `?sube=`'yi kendi başına göremez; çerez olmasaydı kenar çubuğu ile sayfanın
içeriği ayrı şube gösterebilirdi. Bu yüzden paylaşılan bağlantıdaki `?sube=` açılışta çereze **benimsetilir** ve
adresten düşürülür (öteki sorgu alanları korunur): bağlantı yine çalışır, panelin tamamı tek seçimde kalır.

Her bağlantı **bir kez** benimsenir (`branchLinkStep`, src/lib/branches.ts; denetim 21 Kasım #22): seçicinin
hatırladığı anahtar bağlantının kendisidir (yol + sorgu), seçilen şube değil; adreste `?sube=` kalmayınca sıfırlanır.
`?sube=` çerezle aynı olsa da adresten düşer. Böylece Bugün'deki Marina satırına ikinci kez basmak da Marina'yı açar
(arada seçiciden Tümü seçilmiş olsa bile) ve adreste kalmış eski bir `?sube=` seçiciden sonradan yapılan seçimi geri
almaz. Şubesi kilitli personelde `?sube=` benimsenmez (seçim zaten kişinin şubesinde).

Kaydedilmemiş **stok sayımı** varken seçici önce sorar (sayım formu şube değişince baştan kurulur): seçici iptal
edilebilir bir olay yayar (`BRANCH_LEAVE`, src/components/ui/leave-guard.ts), form onu ay seçici ve menü bağlantıları
gibi durdurur ve "Kaydedilmemiş sayım var" penceresini açar. "Kaydetmeden geç" `?sube=` bağlantısıyla geçer, seçici onu
çereze benimsetir. Yazılanlar bu cihazda o şubenin taslağında kalır; şubeye dönünce "Geri yükle" önerilir.

Seçim **yalnız görünümü süzer, yetki vermez**: her uç ayrıca `requireAdmin` / `requireUser` ile korunur.
Tanınmayan ya da pasife alınmış kimlik "Tümü"ye düşer (`parseBranchScope`), yani çerezde çöp duramaz.

Sunucuda seçim, oturum gibi istek kapsamlı okunur (`src/server/branch-scope.ts` › `currentBranchScope`, React
`cache` ile istek başına bir kez): okuma işlevlerinin imzasına şube parametresi eklenmez. **İstek dışında** (göç
betiği, arka plan işi, test) `cookies()` fırlar ve "Tümü"ye düşülür — betik bütün şubeleri görür.

### Telefonda üst çubuk

Sahibin isteği (Dalga 2, 25 Kasım 2026): "Telefonda üst çubukta hangi şubenin görüldüğü yazsın." Seçici telefonda
çekmecenin içinde kaldığı için hangi şubenin rakamlarına bakıldığı ekranda görünmüyordu. Artık telefon ve tablette
üst çubukta sayfa başlığının altında seçili kapsamın adı durur (dükkân simgesiyle): "Tümü", "Tuzla", "Marina". Şubeye
dokununca seçicinin durduğu çekmece açılır. Şubesi kilitli personelde yalnız şubenin adı yazar (dokunulmaz). Tek şube
açıkken satır yoktur (seçici de çizilmez). Kural `topBarBranchLabel` (src/lib/branches.ts), çizim
`src/components/panel/sidebar.tsx`; test `tests/ust-cubuk-sube.test.ts`. Masaüstünde seçici zaten kenar çubuğunda görünür.

### Neyi süzer, neyi süzmez

Süzülen (dalga 3 ile hepsi): kasa raporu, gün özeti, ModPOS föyü, AsilPOS gün sonu, ay satırı, satış satırı, personel,
stok sayımı, zayi — yani **görünümler**. Harcama ve sabit gider tek şube seçiliyken **o şubenin ve işletme genelinin**
kalemleriyle gelir (`branchWhereWithShared`): kira, muhasebe, abonelik hiçbir şubede kaybolmaz. laffogato.net'in online
satışı "Tümü"de ve online kanal seçiliyken okunur, fiziksel şubede yoktur.

**İşletme geneli okumalar** seçiciden bağımsız, hep "Tümü"yle okur (`withBranchScope(ALL_BRANCHES, …)` ya da
`loadModel({ scope: ALL_BRANCHES })`): Ayarlar'daki geri yüklenebilir tam yedek, vergi beyanı ve takvimi, banka ve cari
ekstresi, nakit açılış bakiyesi, firmaya giden sabah ve haftalık e-postası, aylık muhasebeci paketi e-postası. Para ve
beyan işletmenindir ([Her zaman firma geneli](#her-zaman-firma-geneli-ayarı-yok)). Şube kapsamı C'de bilerek firma geneli
kalan ekranlar başlığın altında "Marina seçili: bu ekran firma geneli" notunu gösteriyordu (`CompanyWideNotice`); 27
Kasım'dan beri (şube ayrımı) hepsi kişinin şube görünümüyle okur: şube kipinde yalnız şubenin ve işletme genelinin
kayıtları, firma kipinde bugünkü gibi firmanın tamamı; not yerine ekranın çipi. Not bugün hiçbir ekranda çizilmez. **Ödemeler, Nakit planı, Tedarikçiler ve Komisyon** parça 4'te
([Alanlar: Ödemeler, Nakit planı, Tedarikçiler, Komisyon](#alanlar-ödemeler-nakit-planı-tedarikçiler-komisyon-parça-4)),
**Vergi** (özet, vergi kârı, demirbaş; beyan her kipte firmanın), **Tutarlılık**, **Mutabakat** (ekstre ve gelen POS
parası her kipte firmanın) ve **stok değeri** (sayım tutarı, Ayarlar › Stok değerleme önizlemesi) parça 5'te
([Alanlar: Vergi, Tutarlılık, Mutabakat, Stok değeri](#alanlar-vergi-tutarlılık-mutabakat-stok-değeri-parça-5)).
Paraşüt ekranı ve Faturalar firma geneli değildir (25 Kasım 2026): seçili şubenin
Paraşüt hesabını ve faturalarını gösterir ([Faturanın şubesi](#faturanın-şubesi-25-kasım-2026)). Genel bakış'ın ve (parça
6'dan beri) Ayarlar'ın **Dışa aktar** düğmesi şube seçiliyken ekranın şubesini gönderir (`?sube=`; Ayarlar'da yanında
"Bütün şubeler"): satış, kasa, personel ve giderler o şubenin, öbür sekmeler alanlarının kipiyle ([parça
6](#alanlar-şubeleri-yan-yana-i̇şletme-geneli-giderler-dışa-aktarım-parça-6)); dosyanın ilk sayfası (Nasıl Okunur) kapsamı
ve kipleri yazar, dosya adı şubeyle biter.

**Raporlar** (26 Kasım 2026, [RAPORLAR.md](RAPORLAR.md)) "Tümü"de **şube şube** okur: her açık fiziksel şube kendi
görünümüyle (`loadModel({ scope: şube })`; Gelir-gider'de o şube seçiliyken görünen rakamlar). 27 Kasım'dan beri Şube
karşılaştırma, İşçilik / ciro ve Bugün'ün "Şubelerde gün" kartı **Şubeleri yan yana** alanının kipiyle: varsayılan yalnız
seçili şube, "Yan yana" kipinde bütün şubeler ([parça 6](#alanlar-şubeleri-yan-yana-i̇şletme-geneli-giderler-dışa-aktarım-parça-6)). **Kayıp önleme** 27 Kasım'dan beri seçimle
okur, **Kaçak raporu** yalnız Marina ya da "Tümü" seçiliyken (tahmini stoğun şubesi; öbür şubede "Bu şube için tahmini
stok yok"): [Şube ayrımı › Ayarsız sızıntılar](#ayarsız-sızıntılar-parça-2).

**Komisyon & hakediş** (23 Kasım 2026, [KOMISYON.md](KOMISYON.md) › Şube): satış seçili şubenin kasa raporlarından,
AsilPOS'undan ve ModPOS föyünden; komisyon faturaları, oran ve hakediş işletmenin (faturalar şubeye bölünmez). Şube
seçiliyken ekran işletmenin raporunu gösterir ve üstte şubenin payını (şube satışı × işletmenin oranı) notuyla ekler.
Şubenin satışı "Tümü"nün kuralıyla sayılır: ModPOS'ta kalan şubenin Z'si de geçiş ayından itibaren tek kanala yazılmaz
(föyde markası olan kanalına, kalan markası belirsiz), sonradan açılan şubenin açılış ayı yarım sayılmaz, elle yazılan
ekstre satışı (işletmenin) şubeye yazılmaz. Sabah e-postası ve haftalık özet seçiciden bağımsız, işletme genelidir; ekran,
zil ve Bugün'ün Hakedişler satırı 27 Kasım'dan beri Komisyon alanının kipiyle ([şube ayrımı parça 4](#alanlar-ödemeler-nakit-planı-tedarikçiler-komisyon-parça-4)).

**E-postalar** da işletme genelidir ve elle tetiklenen yolları sabah işiyle aynı hesaplar: sabah e-postası (önizleme ve
"Bugünküleri şimdi gönder" dahil, `runReminderDigest`) ile haftalık özet (önizleme ve örnek dahil, `collectWeekly`)
`withBranchScope(ALL_BRANCHES, …)` içinde okur. Sabah e-postasının önizlemesi parça 6'dan beri şube seçiliyken o şubeye
bağlı alıcıların e-postasıdır (gönderimin şube grubu; okuma yine "Tümü"yle). Önceden yöneticinin elle bastığı düğmeler soldaki seçimi okuyordu:
Marina seçiliyken zam etkisi Marina'nın satışıyla gidiyor, haftalık önizlemenin nakit planı Marina'nın cirosuyla
işletmenin bütün ödemelerini karşılaştırıyordu (denetim 21 Kasım #18). Şube başına olan sayım bu e-postalarda ve ay
sonu bildiriminde **şube şube** okunur (`countProgressByBranch`: her açık şube kendi kapsamında; birden çok şube
açıkken metin şubenin adını yazar, denetim 21 Kasım #16).

Süzülmeyen: **bütünlük denetimleri**. "Bu ürünün satışı var mı, silinebilir mi" sorusu bütün işletmeye bakar;
şubeye göre süzülseydi Marina'ya bakarken Tuzla'da satılmış ürün silinebilir olurdu. Aynı şekilde "bu POS adı
ModPOS döneminden mi" sorusu da işletme genelidir. Ortak veriler (menü, reçete, hammadde, tedarikçi) hiç süzülmez.

Bu kural **ekranlar kadar sunucu eylemleri için de** geçerli ve asıl yeri orası: arayüzün listeyi süzmesi engel
sayılmaz, çünkü yetki ve bütünlük sunucuda denetlenir. `costs.ts` › `dataMonths` bu yüzden
`withBranchScope(ALL_BRANCHES, …)` içinde okur: çıktısı personelin ve sabit giderin silme / değiştirme engeline
gider (`staffUsedMonths`). Süzülü kaldığı sürece Marina seçiliyken Tuzla'da maaş hesabına girmiş kişi
silinebiliyordu; `tests/sube-silme-engeli-db.test.ts` bunu gerçek veritabanında, `tests/subeler.test.ts` ise her
koşuda kaynaktan denetliyor.

## Şube görünümünde maliyet (dalga 3, 4 Kasım 2026)

Soldan bir şube seçilince Genel bakış ve Gelir-gider **o şubenin** gelir-giderini gösterir (sahibin kararları:
"Reçeteye göre", "Kaleme şube seçimi ekle"):

| Satır | Tek şube seçiliyken |
|---|---|
| Ciro, kasa, ödenmez | Şubenin kasa raporları / ay satırı |
| Mal maliyeti | **Şubenin satışından reçeteye göre**: tüketim (fire hariç) × (1 + genel fire) + ödenmezlerin malzeme maliyeti (`engine.ts` `stockFlow`, yöntem `sube`). Mal faturaları (şubesi seçilmiş olsa da) ve stok devri şubenin mal maliyetine girmez |
| Ürün ve reçete maliyeti | Şubeye göre değişmez. Su + buz litre fiyatı işletme geneli: SU GİDERİ (işletmenin faturası) ÷ **bütün şubelerin** ve laffogato.net'in o ayki su + buz litresi (`Dataset.waterSales`, `engine.ts` `waterUsage`; denetim 21 Kasım #4). Önceden fatura yalnız seçili şubenin litresine bölünüyordu: Marina seçiliyken Americano M'nin maliyeti şişiyor, iki şubenin mal maliyeti faturayı iki kez sayıyordu |
| Mal alımı (faturalar) | Bilgi olarak görünür: şubenin ve işletme geneli seçilmiş mal faturaları ([Faturanın şubesi](#faturanın-şubesi-25-kasım-2026)); mal maliyetine girmez. Genel bakış'ta faturaya göre maliyet oranı, "Faturaya göre alım" ve "Fark (alınan − harcanan)" çizilmez, yerinde "Tümü'nde" yazar; Gelir-gider'in kârı "faturaya göre" değil **"Gelir-gider'e göre"** adıyla, bitmiş ayın dökümünde mal maliyeti tek satır (reçeteye göre); dışa aktarımda da öyle (`profitBasisOf`, `src/lib/calc/insights.ts`). 25 Kasım 2026'ya kadar işletmenin bütün mal alımı şubenin satışına bölünüyor, büyük bir oran ve fark kaçak gibi görünüyordu (denetim bulgusu 64). Şubesi seçilmiş mal faturası da şubenin mal maliyetine girmez: bunun için sayım ve devir şube başına olmalı (aşağıda, Kalanlar) |
| Personel | Şubeye bağlı kişilerin maaşı (Maaşlar'da kişinin **Şube** alanı) |
| Sabit gider | Şubeye bağlı kalemler (Sabit giderler'de kalemin **Şube** alanı). İşletme geneli kalemler (şube boş; var olan kalemler işletme geneli kaldı) Faz 5'ten beri **şubenin kârına girmez**: "İşletme geneli payı (bilgi)" satırında |
| Harcama | Şubenin kendi harcamaları ve şubesi bu şube olan, harcamaya bağlı faturalar (25 Kasım 2026). Şubesi boş (işletme geneli) harcamalar ve işletme geneli seçilmiş faturalar bilgi satırında (Faz 5) |
| Komisyon faturaları | Şubenin kârına girmez: bilgi satırında (Faz 5). Tek şubede yalnız o şubeye ya da İşletme geneli seçilmiş komisyon faturası görünür ([Faturanın şubesi](#faturanın-şubesi-25-kasım-2026)); banka POS komisyonu şubenin kartıyla |
| Elle yazılan Gelir-gider hücresi | `manual:*` işletme genelidir: şubede satırı yok, bilgi satırında sayılır, Tümü'de yazılır (Faz 5); `fixed:` / `stopaj:` kalemin şubesindeyse; **devir, personel, POS komisyonu** işletmenin toplamıdır, şubede yazılamaz (ekran kilitler, sunucu reddeder) |
| "Sayım yok" uyarısı | Yok: şubenin mal maliyeti sayıma bağlı değil |

"Tümü" eskisi gibi: sayımlı mal maliyeti (sayım, sayım aralığına dağıtım, tahmin). Aynı ayın aynı malzemesi iki şubede
sayıldıysa işletmenin stoğu toplamdır (birimi farklıysa ilk satırın birimine çevrilir).

### İşletme geneli payı (Faz 5, 23 Kasım 2026)

Sahibin kararı 4: şube ekranlarında işletme geneli giderler **açıkça etiketli bir bilgi satırı**dır, şubenin kârını
düşürmez; "Tümü" onları bir kez sayar. Bölüştürme anahtarı seçilmedi: satır işletme genelinin dönemdeki **tamamını**
gösterir, şubeye düşen bir pay değildir (`src/lib/calc/engine.ts` pnlMonth › `shared`, `SHARED_KEY`; testleri
`tests/isletme-geneli.test.ts`, `tests/isletme-geneli-db.test.ts`).

| Ne | Kural |
|---|---|
| İşletme geneli sayılanlar | Şubesi boş sabit gider ve stopajı, silinmiş kalemin elle girişi, Gelir-gider'e elle yazılan hücreler (`manual:*`; pnl_entries şubesiz), şubesi boş harcamalar ve harcama kategorisine bağlı **işletme geneli** faturalar (şubesi seçilmiş fatura şubenin; 25 Kasım 2026), komisyon faturaları (Komisyon kategorisi) |
| Tek şube seçiliyken | Bunlar bölümlere, giderlere ve kâra girmez; satırları çizilmez. Gelir-gider'de "İşletme geneli (bilgi)" bölümünde tek satır **İŞLETME GENELİ PAYI (bilgi)**: ipucu "Şubenin kârına girmez; Tümü'de bir kez sayılır", hücresi en büyük kalemleri yazar. Genel bakış'ın sabit gider dökümü de onları saymaz, altında bilgi olarak toplamı yazar. Harcama satırı şubenin kendi kayıtlarıdır |
| Günü | İşletmenin günü: şube seçiliyken veri kümesi "Tümü"nün ay bilgisini de taşır (`Dataset.companyMonths`), oranlanan kalem Tümü'deki tutarla görünür (Marina'nın açılış ayında da) |
| "Tümü" | Bölümlerinde bir kez sayılır (bilgi satırı yok). Gelir-gider'de birden çok fiziksel şube açıkken **Şube kırılımı** kartı (`src/lib/branch-breakdown.ts`): her şubenin ciro, gider ve kârı kendi görünümündeki gibi; fiziksel şube olmayan kanala (online) yazılan sabit gider, harcama ve personel varsa kendi sütununda (`PnlMonthCalc.byBranch`; tek kanalsa onun adıyla, yoksa **Diğer kanallar**; inceleme bulgusu 5: önceden farka düşüyordu); **İşletme geneli** sütunu (giderler: işletme geneli toplamı; ciro: laffogato.net online satışı) ve Tümü. Kabul: Marina kârı + Tuzla kârı − işletme geneli = Tümü kârı. Mal maliyetinin yöntemi farklı olduğundan (Tümü sayımla, şube satışından reçeteye göre) ya da Tümü'de elle yazılan personel / POS komisyonu şubeye bölünmediğinden kalan fark kartın altında yazılır; hiçbir gider iki kez sayılmaz |
| Başabaş ve standart aylık sabit gider | Şube seçiliyken kârın temeliyle aynı kalemlerden (inceleme bulgusu 3, sahibin kararı 4): standart sabit gider (`fixedStandardTotalFor`), Genel bakış'ın ve dışa aktarımın "standart sabit giderle" net kârı, başabaş (`breakEvenOf`; Genel bakış, Sabit giderler, Analiz) ve her ay girilen harcamaların payı (`monthlyExpensePlan`: şubenin kendi kayıtları) işletme genelini saymaz. Dışarıda kalan toplam (`fixedStandardSharedFor`) Sabit giderler'in özetinde ve başabaş dökümünde bilgi olarak yazılır. "Tümü" değişmez |
| İşletme geneli giderler alanı (27 Kasım 2026, şube ayrımı parça 6) | Bilgi satırı ve tutarlar yalnız **Tutarla göster** kipinde (muhasebecinin varsayılanı). Yöneticinin varsayılanı **Yalnız not**: satır, bileşim, Genel bakış'ın ve Sabit giderler'in işletme geneli tutarı yok, yerinde "İşletme geneli giderler bu şubenin kârına girmez (Tümü'de sayılır)"; işletme geneli sabit gider kalemi, şubesiz harcama ve işletme geneli yatırım listede yok. Şubenin kârı iki kipte aynı ([parça 6](#alanlar-şubeleri-yan-yana-i̇şletme-geneli-giderler-dışa-aktarım-parça-6)) |
| Değişmeyenler | Vergi beyanı her kipte "Tümü"yle. Vergi, Nakit planı ve Tutarlılık 27 Kasım'dan beri kişinin şube görünümüyle ([Şube ayrımı](#şube-ayrımı-27-kasım-2026)); dışa aktarımın sekmeleri de (parça 6) |

**Stok sayımı sayfası** hep bir şubenin sayımını gösterir ([Yazarken hangi şube](#yazarken-hangi-şube)). Gelir-giderde ("Tümü") elle yazılan devir
("SONRAKİ AYA DEVREDEN MAL", "ÖNCEKİ AYDAN DEVİR") işletme genelidir ve şubenin modeli onu görmez; sayfa bu hücreleri
ayrıca okur ki yöneticinin kartı yine söylesin (denetim E-30; 21 Kasım denetimi #20): açılış kâr-zararın kullandığı
tutardır ("elle girildi" ipucunda şubenin geçen ayki sayımı), bu ayın stoğu elle yazıldıysa "kâr-zarar bu sayımı
kullanmaz" uyarısı. Birden çok şube açıkken metin tutarın işletme geneli, sayımın şubenin olduğunu yazar ("Ekim 2026
sayımı (Tuzla)"); sayım toplamı ve elle yazılmamış açılış şubenin kendi sayımıdır. Stok değeri alanı **Yalnız şube**
kipindeyken (şube ayrımı parça 5) işletme geneli devir okunmaz: açılış şubenin geçen ayki sayımı, "kâr-zarar bu sayımı
kullanmaz" uyarısı yok; FIFO havuzu şubenin ve işletme genelinin faturaları ([aşağıda](#alanlar-vergi-tutarlılık-mutabakat-stok-değeri-parça-5)).

### Yazarken hangi şube

| Kayıt | Şube |
|---|---|
| Kasa raporu, kasadan çıkan para | Formun gösterdiği kasa: sayfa açılırken seçili şube (kasadan çıkanın harcaması da o şubenin). "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa form çizilmez, önce **"Hangi şubenin kasası?"** sorulur (şube kapsamı C; önceden sessizce Tuzla'nın formu açılıyordu); tek kasada o kasa. Form kasanın kimliğini gönderir; gönderim anındaki seçim değil o yazılır ([aşağıda](#kasa-raporu-tümüde-20-kasım-2026)). "Kasayı sayan" listesi o kasayı sayabilecekler: yönetici, şubesiz personel, şubenin personeli ve son 60 günde o kasayı saymış olan |
| Tedarikçiye kasadan ödeme (yeni Teslim satırı) | Pencerede seçilen kasa: varsayılanı seçili fiziksel şube (tek kasa açıksa o). "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa varsayılan yok, şube seçilmeden kaydedilmez; sunucu da seçimsiz kaydı reddeder (`chooseTill`, denetim 21 Kasım #31). Var olan satır listesinde her satır kasasının şubesini yazar |
| Ay bilgisi (ciro, açık gün, indirim, ödenmez, ay notu; Satışlar ve Gelir-gider) | **Formun gösterdiği şubenin** ay satırı: form şubenin kimliğini gönderir, gönderim anındaki seçim değil o yazılır (`formBranch(…, "sales")`; 24 Kasım şube kapsamı). Etkin fiziksel şube olmalı: online kanal seçiliyken ay yazılmaz (kanalın kasa satışı yok; önceden ay "online" şubesine iniyordu), Satışlar'da İçe aktar ve ay formu yerine "kasa satışı yok" satırı çıkar, Gelir-gider'in ay hücreleri kilitlidir (`monthWriteLock`). Önceden Gelir-gider'in ciro, açık gün ve ay notu hücreleri şubesiz yazıyor, her şubede Tuzla'nın satırını eziyordu (denetim 21 Kasım #6). Birden çok kasa açıkken "Tümü"de Gelir-gider'in ciro, açık gün **ve ay notu** kilitlidir ("şubeyi seçin"; sunucu da reddeder): hücre şubelerin toplamını gösterir, yazılan Tuzla'nın ayına inip öteki şubenin cirosunu iki kez saydırırdı; ay notu da artık sessizce Tuzla'ya inmez. Tek kasa açıkken "Tümü" o kasadır, yazılır (`monthWriteBranch`). Satışlar'ın ay formu da birden çok kasa açıkken "Tümü"de çizilmez, yerinde "Hangi şubenin ay bilgisi?" sorusu çıkar (25 Kasım 2026; önceden form başlığında Tuzla yazıp Tuzla'nın ayına yazıyordu, Gelir-gider'le aynı kural değildi). Tek kasa açıkken form o kasanındır, liste ↔ POS kutusu çıkmaz (denetim 13 Kasım HM-02). Şubeyi göndermeyen eski sekme tek şube seçiliyken o şubeye yazar, "Tümü"de birden çok kasa açıkken reddedilir |
| Satışlar › İçe aktar, Satır ekle | Formun gösterdiği şubenin listesi (`formBranch(…, "sales")`). "Tümü"de birden çok kasa açıkken kart ve pencere şubeyi sorar, varsayılan yok; ayı AsilPOS'tan gelen şube listede yer almaz (bugün "Tümü"de yalnız Tuzla kalır). "Yenisiyle değiştir"in onayı seçilen şubenin satırlarını sayar. Düzeltilen satır kendi şubesinde kalır |
| Satışlar › Ayı temizle | Gösterilen şubenin listesi ve (seçilirse) ay bilgisi; "Tümü"nde bütün şubelerinki. Kapsam çerezden değil pencerenin gösterdiğinden kurulur: pencere kapsamı ve saydığı satır sayısını gönderir, seçim başka sekmede değiştiyse ya da liste bu arada değiştiyse silme reddedilir (`assertShownScope`, 24 Kasım şube kapsamı); içi boşalan ay satırları kapsamdaki her şubede kalkar. Listenin son günü: ayın ortak kaydı yalnız ayda hiçbir şubenin listesi kalmadıysa silinir (denetim 21 Kasım #7), şubenin kendi kaydı (`sales.coverage.sube`) listesi silinen şubenin ayından silinir. Şube seçiliyken liste dönemi şubenin kendi kaydını, Marina'nın AsilPOS'unun sayıldığı ilk gün her görünümde Marina'nın kaydını, içe aktarma kartının "… tarihine kadar"ı yazılan şubenin kaydını okur ("Tümü"de birden çok şubeye yüklenebiliyorsa kart şubeyi sorar, tek gün yazmaz). Onaydaki satır sayısı sunucunun sileceği ve denetlediği sayıdır (kapsamdaki bütün liste satırları; AsilPOS'un satırları ayrı tabloda, silinmez) ([ASILPOS.md](ASILPOS.md) › Günlük satış) |
| Stok sayımı, zayi | Seçili **fiziksel** şube; "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa sayım formu çizilmez, önce **"Hangi şubeyi sayıyorsunuz?"** sorulur (şube kapsamı C), tek kasada o kasa. **Zayi ve ikram** formun şubesine (`formBranch(…, "waste")`, 24 Kasım şube kapsamı): kayıt ve geç kayıt isteği formun gösterdiği şubeyi gönderir; "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa form şubeyi sorar (varsayılan yok, şubesiz kayıt reddedilir), başlık birden çok kasa açıkken şubeyi yazar ("Tuzla · Zayi & ikram"); sayfanın kilidi de formun şubesinin. Stok sayımı başlığı birden çok açık şube varken hangi şubenin sayıldığını yazar. Sayımın **"Listede olmayanlar"ı** (ek kalemler) da şubenin: okuma, eşleme, silme ve kayıt o şubenin listesiyle, "Tümü" bütün şubelerinkini toplar (`stock_extras.branch_id`, migration 0059; eski satırlar Tuzla'nın). Önceden liste şubesizdi: Marina'nın formu Tuzla'nın ek kalemlerini gösteriyor, aynı adlı kalemi ezip fiyatsız olanı siliyordu (denetim 21 Kasım #19/#24). Yalnız yeni kalemin fiyatını bulan geçmiş işletme genelidir (fiyat şubeye göre değişmez). Kaydedilmemiş sayımın bu cihazdaki taslağı da şube başına (anahtar `laf:sayim-taslak:<şube>:<ay>`, taslak şubesini de yazar): bir şubenin taslağı öbür şubenin formunda önerilmez, oraya kaydedilmez (#8). Şubesiz eski anahtardaki taslak hangi şubenin olduğu bilinmediği için okunmaz. **Sayım formu şubesini taşır** (kasa formları gibi): sayım, ek kalemler ve "Listeye ekle" formun gösterdiği şubeyi gönderir, sunucu onu doğrular (etkin fiziksel şube; şubesine kilitli personelde yalnız kendi şubesi, `formCountBranch` › `formCountError`) ve yazımı o şubenin kapsamında çalıştırır. Önceden kayıt gönderim anındaki çereze iniyordu: başka sekmede seçici Marina'ya geçince açık kalan Tuzla sayımı Marina'ya yazılıyordu. Şubeyi göndermeyen eski sekme seçili fiziksel şubeye yazar |
| Harcama, cari "Faturası yok · gider yaz" | Formda seçilen şube ya da **İşletme geneli** (`formBranch(…, "expense")`, 24 Kasım şube kapsamı): varsayılan seçili şube, "Tümü"de görünür biçimde işletme geneli; tek şube açıkken seçim çizilmez. Düzeltme şubeyi değiştirebilir; kasadan çıkan fişin gideri kasanın şubesinde, cari borcun gideri Tedarikçiler'de seçilen şubede kalır (Aylık harcamalar'dan değişmez). Cari giderinde şube seçilmezse düzeltmede kalır, mod değişip yeni kayıt açılırsa önceki gider kaydının şubesi. Şubeyi göndermeyen eski sekme ve asistan: seçili şube, "Tümü"nde işletme geneli |
| Kasaya işle işareti ("Kasada değiştirdim", Kasadaki fiyatlar) | Listenin gösterdiği kasa (`formBranch(…, "till", { requireExplicit })`; şube kapsamı A3): işaret yalnız o şubenin kasasından düşer, öbür şubenin listesi kalır. "Tümü"de birden çok kasa açıkken her kasa ayrı liste; kasası gelmeyen istek reddedilir. Kasada bekleyen fiyat şube başına (`pos_stale`; [FIYATLAR.md › Şube başına kasa](FIYATLAR.md#şube-başına-kasa-şube-kapsamı-a3-24-kasım-2026)) |
| Personel | Pencerede seçilen şube (yeni kişide seçili fiziksel şube; "Tümü"de birden çok şube açıkken boş başlar, seçilmeden kaydedilmez) |
| Sabit gider | Pencerede seçilen şube ya da "İşletme geneli" (yeni kalemde seçili şube, "Tümü"nde işletme geneli) |
| Ödeme hatırlatıcısı | Formda seçilen şube ya da "İşletme geneli" (yenide seçili fiziksel şube, "Tümü"nde işletme geneli) |
| Kontrol listesi | Listede seçilen şube ya da "Bütün şubeler" (yeni liste seçili şubeyle başlar, "Tümü"de bütün şubeler) |
| Kontrol listesinin günlük kaydı (şube ayrımı, 27 Kasım 2026) | Şubeli listede listenin şubesi. Bütün şubelerin listesinde doldurma ekranının şubesi (`formBranch(…, "checklist")`: seçili fiziksel şube, Bugün'ün şube satırının `?sube=`'si, kilitli personelde kendi şubesi); "Tümü"de birden çok şube açıkken ekran "Hangi şubenin listesi?" diye sorar, şubesiz yanıt reddedilir |
| Tek seferlik yatırım (şube ayrımı, 27 Kasım 2026) | Pencerede seçilen şube ya da "İşletme geneli" (yenide seçili şube, "Tümü"nde işletme geneli; tek şube açıkken sorulmaz) |
| Özel gün (maç, AVM, kampanya, kapalı, diğer) | Formda seçilen şube ya da "Bütün şubeler" (her tür; yeni gün seçili şubeyle başlar). Personelin eklediği gün şubesine kilitliyse o şubenin, değilse bütün şubelerin. Tek şube seçiliyken liste o şubenin ve bütün şubelerin günleri |
| Personel hesabı (Kullanıcılar) | Formda seçilen şube ya da "Bütün şubeler"; şubesi olan personel o şubede kilitli |
| Vardiya planı | Izgaranın şubesi: seçili fiziksel şube. "Tümü" ya da online kanal seçiliyken birden çok şube açıksa ızgara çizilmez, önce **"Hangi şubenin vardiyası?"** sorulur (26 Kasım 2026; önceden sessizce Tuzla'nın planı açılıp Kaydet Tuzla'ya yazıyordu); tek şubede o şube. Kaydet ve Yazarak doldur ızgaranın şubesini gönderir (zorunlu alan; çerez okunmaz). Asistanın vardiya kartı "Tümü"de şubeyi sorar ([VARDIYA.md](VARDIYA.md) › Ekran) |

**Ortak kapı** (`formBranch(raw, tür)`, `src/server/branch-scope.ts`; kural saf `pickFormBranch`, `src/lib/branches.ts`;
24 Kasım 2026 şube kapsamı): kasa, sayım, zayi, satış ve gider yazımları formun gönderdiği şubeyi aynı kapıdan geçirir.
Kimlik türüne uymalı (kasa, sayım, zayi ve satışta etkin fiziksel şube; giderde etkin şube ya da `isletme`), şubesine
kilitli personelde kendi şubesi; değilse yazım reddedilir. Kimliği göndermeyen eski sekme bugünkü kurala düşer;
`requireExplicit` ile (satış, zayi) "Tümü"de birden çok kasa açıkken reddedilir ("Hangi şubeye yazılsın? Şubeyi seçin"),
sessizce Tuzla'ya inmez. Kapsamla silen yazım (Ayı temizle) pencerenin kapsamını gönderir (`assertShownScope`).
Karaokenin şubesi şube özelliğinden okunur (`karaokeBranchOf`, sahibin varsayılanı Tuzla; aşağıda "Şube özellikleri");
kitlesi yönetici, şubesiz personel ve o şubenin personeli (`featureAudience`).

### Karaoke yalnız kendi şubesinde (24 Kasım 2026)

Karaoke odası tek şubededir: karaoke özelliği açık şube (25 Kasım 2026'dan beri Şube ayarları › Özellikler'den seçilir;
aşağıda "Şube özellikleri"). Başka şubeye kilitli personel:

- Karaoke sayfasında rezervasyon ve sayaç görmez, "Karaoke bu şubede kullanılmıyor" yazar (Siparişler satırı kalır);
- sayaç açamaz, uzatamaz, bitiremez, geri açamaz, silemez, silinmesini isteyemez, köşk rezervasyonu ekleyip kaldıramaz,
  "Şimdi eşitle"ye basamaz: eylem kimliği istemci paketinde olduğu için uç da reddeder (`assertKaraokeBranch`,
  `src/server/actions/karaoke.ts`);
- canlı uçtan (`/api/canli`) oturum ve silme isteği almaz (misafir adı, alarm); kilit ETag'tedir;
- karaoke Web Push bildirimini almaz (`announce` › `featureAudienceIds("karaoke")`).

Bugün'ün karaoke satırı, karaoke sayfası ve canlı uç "Tümü"de ve karaokenin şubesi seçiliyken karaokeyi gösterir; başka
şube seçiliyken (kilitli personelde ve müdürde hep kendi şubesi) yoktur. Muhasebeci sahada değil: canlı uç ona hiçbir
seçimde karaoke, sipariş ve çağrı vermez ([ROLLER.md](ROLLER.md)). Karaoke hiçbir şubede açık değilse personel (şubesiz de)
karaoke eylemi çağıramaz, bildirim kimseye gitmez. Kapalı gün kanıtında karaoke birden çok kasa açıkken yalnız karaokenin şubesinin kanıtıdır.
Yönetici serbesttir; şubesiz personel ve şubesi pasife alınmış personel karaoke bir şubede açıkken serbesttir.

Stok sayımı kaydının çakışma hedefi `(ay, şube, malzeme)`: dalga 2'de tek şubesiz hedef kaldığı için sayım kaydı
"no unique or exclusion constraint" hatasıyla düşüyordu; `tests/sube-maliyet.test.ts` artık bütün kaynak dosyalarını
tarar.

## Şube kapsamı C: istekler, uyarılar, e-posta, Claude (24 Kasım 2026)

Tek şube seçiliyken (şubesine kilitli personelde hep kendi şubesi) aşağıdakiler yalnız o şubenindir; "Tümü"de hepsi,
birden çok kasa açıkken şubenin adıyla.

| Ne | Kural |
|---|---|
| Onaylar ve yöneticinin zili | Personel isteğinin şubesi türüne göre konudan, yükten ya da kaydından okunur (`requestBranches`, `src/server/staff-requests/branch.ts`): kasa düzeltmesi ve silmesi konudan, geç rapor, geç zayi ve kasadan çıkan yükten, fotoğraf kaldırma raporundan, zayi silme kaydından, karaoke sayacı karaokenin şubesi. Şubesi bilinmeyen istek (mal taslağı, kaydı silinmiş) her yerde görünür (`requestInScope`). Onaylar'ın üstü "öbür şubelerde N istek daha onay bekliyor" der |
| Sayım uyarıları (zil, Bugün) | Fiyatı girilmemiş ek kalemler şubenin sayımından; personelin geç sayım kaydı işlem kaydının sonundaki şubeden ("Ekim 2026: 3 kalem · Marina", `countLogDetail`). Şubesi yazılmamış eski kayıt her şubede sayılır |
| Aylık harcamalar | Toplam şubenin kendi kayıtları; şubesi boş kayıtlar ve kategoriye bağlı faturalar "İşletme geneli" rozetiyle ayrı (Gelir-gider'in harcama hücresiyle aynı kural, `expenseSplit`) |
| Ödemeler › Sabit giderlerden ekle | Şubenin ve işletme genelinin kalemleri; "Tümü"de kalemin şubesi rozette |
| Tükendi | Sitede şube başına durum yok: birden çok şube açıkken pencere "Bütün şubelerde kapanır" der, şubesine kilitli personelin Tükendi'si önce onay ister |
| Sabah e-postası | Bildirim adresinin şubesi (Ödemeler › E-posta bildirimleri; `notification_recipients.branch_ids`, migration 0080; boş = bütün şubeler). Şubeye bağlı adres ayrı e-posta alır: konu şubenin adıyla başlar ("Marina: …"), ödemeler şubenin ve işletme genelinin; onay bekleyenler, kontrol listeleri, yarım sayım, ModPOS föy farkı ve kasadan çıkan faturalı alımlar şubenin; faturalar, zam, komisyon ve Tükendi firma geneli. Şubesi kapanan adres hiçbir e-postayı almaz. Bütün grupların içeriği gönderimden önce kurulur; birden çok grubun anahtarı yalnız hepsi gidince yazılır, düşen grup Günlük işler'de hata ([BILDIRIMLER.md](BILDIRIMLER.md#alıcılar-ve-hesaplar)) |
| Zayi "Tümü"de | Satır kaydın şubesini yazar; AsilPOS'un ikram listesi AsilPOS günü olan kasanın, adıyla (önceden "Tümü"de Tuzla'nınki okunuyordu) |
| Şubesiz personel "Tümü"de | Akşam zili raporu girilmemiş her kasa için ayrı satır ("Marina: Bugünün kasa raporu bekliyor"); Kullanıcılar ekranı şubesi seçilmemiş personeli sayar |
| Vardiya "Kişi ekle" ve yazarak doldurma | Başka şubeye kilitli hesap önerilmez (`shiftCandidate`) |
| Fiyatlar › Şube fiyatı, Eski fiyattan satılanlar | Panelin seçimi (önceden adresteki `?sube=` okunuyordu; seçici onu adresten düşürünce ilk şubeye dönüyordu). Geçmiş sekmesi sitedeki şube fiyatı kayıtlarını ayrı kartta gösterir |
| Silme engeli (ürün, hammadde) | Bütün şubelerden, eylemin sayacıyla (`productHistoryCounts`, `ingredientHistoryCounts`): Marina seçiliyken Tuzla'nın zayisi ya da sayımı da engeller |
| Hammaddeler › Kullanım | Şube seçiliyken "son ay · Marina satışı" |
| Claude bağlantısı ve panel asistanının araçları | İsteğe bağlı `sube` girdisi (ad, kimlik ya da "hepsi"); verilmezse panelin seçimi (asistanda açık ekranın şubesi: tarayıcı soruyla gönderir, çerez yalnız yedek; 26 Kasım 2026, docs/ASISTAN.md › Sayfa bağlamı). Çıktı `kapsam` yazar; tedarikçi ve arama "Firma geneli". Şubesine kilitli hesap başka şubeyi isteyemez |
| Kasa raporu silindi (işlem geçmişi) | Birden çok kasa açıkken kasanın adı |
| Personel belgeleri ve avansları | Kişinin şubesi Maaşlar'daki **Şube** alanı (Maaşlar'la aynı süzgeç): ekranlar ve zilin belge satırları seçili şubenin kişileri, "Tümü"de hepsi, birden çok fiziksel şube açıkken kartta kişinin şubesi. Sabah e-postasının "Personel belgeleri" kutusu şubeye bağlı alıcıya yalnız o şubenin kişileri ([PERSONEL-BELGE.md](PERSONEL-BELGE.md)) |

Sahibin varsayılanları (24 Kasım 2026, sonra Ayarlar'dan şube başına değiştirilebilir olacak): tek firma (Vergi, Nakit,
cari firma geneli, etiketli); Paraşüt hesabı ortak (25 Kasım'dan beri şube başına seçilebilir: ayrı hesabın faturaları o
şubenin; ortak hesabın faturası tedarikçinin varsayılan şubesini alır, aşağıda "Faturanın şubesi"); karaoke Tuzla'da; komisyon ve yemek kartı şubeler arasında aynı. Karaoke,
uygulama siparişi, garson çağır ve yemek kartı 25 Kasım'dan beri şube başına açılıp kapanır ("Şube özellikleri").

## Şube özellikleri (25 Kasım 2026)

Bir şubede hangi iş yapılıyor: şube başına açık / kapalı (`branches.features`, metin dizisi; migration 0084 sütun, 0085
veri). Kurallar saf dosyada (`src/lib/branch-features.ts`), okuma `src/server/branches.ts` (`karaokeBranchId`,
`featureHere`, `featureAudienceIds`), yazım `src/server/branch-features.ts`.

| Özellik | Kapalıyken o şube seçiliyken (kilitli personelde hep) | Varsayılan |
|---|---|---|
| `karaoke` Karaoke | Menüde Karaoke ve Doluluk yok; sayfa "Karaoke bu şubede kullanılmıyor" ve açık olduğu şube; canlı uç oturum, silme isteği ve çekme hatası göndermez (alarm yok); Bugün'ün karaoke satırı, Onaylar'ın karaoke bölümü ve zilin karaoke isteği yok. Eylemler, personel e-postası, sayaç silme isteğinin şubesi ve kapalı günün kanıtı karaokenin şubesiyle. **Yalnız bir şubede açık olabilir** | Tuzla |
| `siparis` Uygulama siparişleri | Canlı uç siparişleri göndermez (zil yok); Siparişler kartı "Uygulama siparişleri bu şubede kullanılmıyor"; Bugün'ün sipariş satırı yok | her şube |
| `garson` Garson çağır | Canlı uç masa çağrılarını göndermez (kapı zili yok) | her şube |
| `yemek_karti` Yemek kartı ve platformlar | Menüde Komisyon & hakediş yok, sayfa "bu şubede kullanılmıyor"; zilin ve Bugün'ün komisyon satırları, şubeye bağlı alıcının sabah e-postasındaki komisyon kutusu yok. Hiçbir şubede açık değilse haftalık özette de yok | her şube |

- **Siparişler** sipariş ya da garson çağırdan biri açıkken görünür; ikisi de kapalıysa menüde yoktur, sayfa "Siparişler
  bu şubede kullanılmıyor" der (Tükenenler kartı kalır: Tükendi sitenin menüsünde, bütün şubelerde).
- **Site siparişin şubesini söylemez** (laffogato.net'in sözleşmesi değişmedi): sipariş ve çağrı, özelliği açık her
  şubenindir. Web Push kitlesi (`featureAudience`): yönetici, şubesiz personel ve özelliği açık şubenin personeli;
  özellik hiçbir şubede açık değilse kimse. Şubesi pasif ya da kütükte olmayan personel şubesiz sayılır.
- **"Tümü"** özelliği herhangi bir etkin şubede açıksa gösterir. Online kanal seçiliyken karaoke ve yemek kartı
  görünmez; uygulama siparişleri ve garson çağır "Tümü"deki gibi (siteden gelirler; kanal görünümündeki cihazın zili ve
  alarmı susmaz; inceleme bulgusu, 25 Kasım 2026).
- **Eylemler sunucuda da reddedilir** (`staffFeatureError`, `assertStaffFeature`): sipariş kapalı şubeye kilitli
  personel sipariş aşamasını ilerletemez, garson çağır kapalıysa masa çağrısını "Gördüm" diye kapatamaz ("Garson çağır
  bu şubede kullanılmıyor"); özellik hiçbir şubede açık değilse hiçbir personel. Yönetici serbest. Karaoke eylemleri
  aynı kuralla (`assertKaraokeBranch`). Siparişler ekranının cihaz ayarlarında karaoke alarmı satırları yalnız karaoke
  bu kapsamda açıkken.
- **Menü** (`src/components/panel/nav.ts` › `FEATURE_SCREENS`, `screenFeatureOn`): kenar çubuğu, çekmece, komut paleti
  ve alt menü seçili kapsamın özellikleriyle süzülür. Personelin alt menüsü beş hücre kalır: boşalan hücreye sırayla
  Zayi ve Kontrol girer (`withSpares`). Şube seçimi değişince kabuk canlı veriyi hemen yeniden ister.
- **Ekran**: Şube ayarları › Özellikler (yalnız yönetici; her dokunuş hemen kaydedilir, tek işlem, özellik kilidiyle,
  işlem geçmişine "Şube özelliği"). Karaoke başka şubede açıksa anahtar kapalıdır ve nerede açık olduğunu söyler: önce
  oradan kapatılır. Şubeler listesinde karaokeli şubede "Karaoke", kapalı özellik varsa "Kullanılmıyor: …" çipi.
- **Kapanan şube** tek şubelik özelliğini (karaoke) bırakır: başka şubede açılabilir, şube yeniden açılınca iki şubede
  birden açık kalmaz.
- **Geçiş**: sütun eklenince her şube sipariş, garson ve yemek kartıyla başlar; veri adımı Tuzla'ya karaoke ekler (başka
  şubede karaoke yoksa), online kanalı boşaltır. Yeni şube karaokesiz başlar. Özelliği okunmamış satır (eski okuyucu)
  bugünkü davranışı alır (`branchFeatures`). `KARAOKE_BRANCH_ID` sabiti kalktı (`tests/sube-ozellik.test.ts`).
- **Henüz özellik değil**: tahmini stok AsilPOS'un şubesine bağlı kalır (`STOCK_ESTIMATE_BRANCH`; AsilPOS şubesinin
  türetilmesiyle birlikte taşınacak). Komisyon kanallarının ödeme süreleri 25 Kasım 2026'dan beri şube başına (aşağıda,
  Şube başına ayarlar; varsayılan "Tuzla ile aynı").

## Şube başına ayarlar (25 Kasım 2026)

Şubeye göre değişebilen ayarlar şube başına tutulur (tablo `branch_settings`, migration 0081; grup başına şube başına
bir satır). Gruplar kodda: `src/lib/branch-settings/groups.ts`; kurallar `src/lib/branch-settings/rules.ts`; okuma ve
yazma `src/server/branch-settings.ts`.

| Grup | Alanlar | "Diğer şubeyle aynı" | Eski kaydın sahibi |
|---|---|---|---|
| `kasa.rapor` Kasa raporu alıcıları | e-posta adresleri, e-posta açık / kapalı, WhatsApp numarası | evet | Tuzla (varsayılan şube) |
| `kasa.calisan` Çalışanların gün sonu e-postası | çalışan adresleri, tutarlar görünsün mü | hayır: liste şubenin kendisinin | Marina (AsilPOS'un şubesi) |
| `parasut` Paraşüt hesabı | yalnız bağ; hesabın ayarları ve oturumu Paraşüt ekranında, hesap adıyla ([PARASUT.md](PARASUT.md#şube-başına-paraşüt-hesabı)) | evet (= aynı hesap, tek eşitleme); kapatılınca **kopyalanmaz**, boş hesapla başlar | Tuzla (varsayılan şube; `parasut.settings` ve `PARASUT_*`) |
| `komisyon` Komisyon ve yemek kartı kanalları | kanal başına ödeme süresi ([KOMISYON.md](KOMISYON.md)) | evet; sahibin varsayılanı "aynı" | Tuzla (`integration_state` › `komisyon.ayar`) |
| `pos.lafpos` AsilPOS bağlantısı ve geçiş günü | geçiş günü; AsilPOS'un imza anahtarı (**şifreli**, isteğe bağlı; yoksa `ASILPOS_SYNC_SECRET`) | hayır: geçiş günü şubenin kendi kasasının, AsilPOS en çok bir şubenin kasası | Marina (`settings` › `lafposGecisGunu`; değeri yalnız AsilPOS'un şubesininki okunur) |
| `modpos` ModPOS ay yedeği | ay rakamına yedek ([MODPOS-API.md](MODPOS-API.md) › Ay rakamına yedek); anahtar şube başına ortamda kalır | evet | Tuzla (`settings` › `modposAyYedegi`) |
| `isletme.takvim` Çalışma takvimi | ayda açık gün (başabaş, günlük giderler); kasa raporunun beklendiği saat (zil ve Bugün; 12:00–23:00, varsayılan 20:00) | evet | Tuzla (`settings` › `acikGun`; saat bugün sabitti) |
| `kasa.cihaz` Banka POS ve yazarkasa | cihaz (Pavo, TokenX, başka), yazarkasa sicil no, bankası | hayır: cihaz şubenin kendisinin | yok (boşken her şey bugünkü gibi) |
| `kasa.kor` Kör sayım | açık / kapalı ([KASA-RAPORU.md](KASA-RAPORU.md#kör-sayım)): personel önce sayılan nakdi kilitler, fark sonra görünür | hayır: ayar şubenin kendisinin | yok; seçilmemişken varsayılan: kasası ModPOS olan şubede açık, AsilPOS'un şubesinde kapalı |
| `vardiya.hazir` Hazır vardiyalar | sabahçı ve akşamcı: kullanılıyor mu, başlangıç ve bitiş ([VARDIYA.md](VARDIYA.md#şube-ayarı-26-kasım-2026)); Vardiya ekranının S / A düğmeleri, "s" / "a" kısaltması, yazarak doldurma, PDF ve asistanın vardiya kartı | hayır: saatler şubenin açılışına bağlı (Tuzla ile Marina'nınki bugün de ayrı) | yok; seçilmemişken bugünkü sabit saatler (`SHIFT_PRESETS`: Tuzla 09:00–18:00 / 16:00–01:00, Marina 09:30–18:30 / 13:00–22:00, öbür şubede hazır vardiya yok) |

- **"Diğer şubeyle aynı"**: açıkken şube kendi değerini tutmaz (satırda `same_as`), bağlandığı şubenin değerini kullanır;
  değer tek yerden düzenlenir. Kapatılınca o anki değer şubeye kopyalanır, sonra ayrı düzenlenir. Gizli alanlar
  (şifreli, `secrets` sütunu) kopyalanmaz, yeniden girilir; istemciye yalnız "kayıtlı mı" gider. Bugün yalnız AsilPOS'un
  anahtarı gizli alan.
- **Bağ tek adımlıdır**: hedef başka şubeye bağlı olamaz, kendine bağ ve döngü yok (sunucu ve veritabanı denetler).
  Varsayılan şube (Tuzla) öbürlerinin örtük hedefidir, kendisi bağlanamaz. Başka şube bir şubenin ayarını kullanıyorsa o
  şube kapatılamaz ve silinemez ("Marina, kasa raporu alıcıları için Bodrum şubesinin ayarını kullanıyor; önce ayırın").
- **Geçiş: veri göçü yok, hiçbir şey yapmadan çalışır.** Satırı olmayan şube eski genel kayıttan (`integration_state` ›
  `cash.settings`, `komisyon.ayar`; `settings` tablosunun alanları grubun `legacySettings`'iyle: `lafposGecisGunu`,
  `modposAyYedegi`, `acikGun`) okur, ama yalnız kaydın sahibi şube: alıcılar Tuzla'nın, çalışan listesi Marina'nın. "Aynı" sunulan
  grupta öbür şubeler örtük olarak Tuzla'ya bağlı başlar (bugünkü tek liste). Kayıt yoksa ortamın alıcıları
  (`CASH_REPORT_RECIPIENTS`). İlk kayıtta satır yazılır, eski kayıt bırakılır (geri dönüş güvenli).
- **Okuyanlar şubeyi verir** (`loadCashSettings(şube)`; şubesiz çağrı kalmadı, `tests/branch-settings.test.ts`): kasa
  raporu e-postası raporun şubesinin alıcılarına, deneme e-postası kartın şubesininkine, WhatsApp metni raporun şubesinin
  numarasına; AsilPOS gün sonu, Pavo ve fotoğraf e-postaları gün sonunun şubesinin alıcılarına ve o şubeye açık bildirim
  adreslerine (bütün şubeler ya da o şube; `dayEndRecipients(db, şube)`, şube zorunlu), çalışanların kısa e-postası
  gün sonunun şubesinin çalışan listesine. Zil ve "bu adres hangi listede" (Hesabım, Kullanıcılar) bütün açık
  şubelerin listelerine bakar.
- **Ekran**: Ayarlar › Şube ayarları (tek şube seçiliyken doğrudan o şubenin ekranı, "Tümü"de Şubeler listesi; özet
  satırı alıcıların, Paraşüt'ün ve birden çok kasada komisyon ile takvimin kaynağını, karaokenin şubesini ve kullanılmayan
  özellikleri söyler; her fiziksel şubenin satırında
  "Alıcılar: Tuzla ile aynı" çipi ve **Ayarlar**). Şube ayarları ekranının en üstünde Özellikler kartı (yukarıda). Şube ayarları ekranı
  (`/panel/subeler/[id]`, yalnız yönetici) şubeyi adresten alır, panelin seçicisini değiştirmez. Kasa sayfasının Rapor
  alıcıları kartı aynı bileşen (`src/app/panel/kasa/cash-settings.tsx`, verisi `src/server/cash/settings-card.ts`);
  "Tümü"de her şube bölümünde kendi kartı. Birden çok kasa açıkken kartın ilk satırı "Tuzla ile aynı" anahtarı; açıkken
  form çizilmez, Tuzla'nın alıcıları salt okunur görünür ve "Tuzla şubesinde düzenle" bağlantısı çıkar. Tuzla'nın
  kartı "Marina şubesi de bu alıcıları kullanıyor" der. Çalışan listesi alanı AsilPOS'lu şubede (ya da listesi doluysa);
  alanı olmayan kartın kaydı çalışan listesini göndermez, liste değişmez.
- **Yazım**: yalnız yönetici; değer, bağ ve işlem geçmişi tek işlemde, aynı grubun yazımları sıraya girer (grup başına
  işlem kilidi). Başka şubenin alıcılarını kullanan şubeye alıcı yazılmaz (eski sekme bağlı şubenin değerini sessizce
  ayırmasın): önce "aynı" kapatılır.
- **Yedek**: değerler ve bağ dosyaya girer, `secrets` sütunu girmez ([YEDEK.md](YEDEK.md)).
- **Paraşüt hesabı**: Şube ayarları ekranındaki Paraşüt kartı "Tuzla ile aynı" anahtarını ve kullanılan hesabın
  durumunu gösterir; hesabın bilgileri Paraşüt ekranında o şube seçiliyken girilir. Ayrı hesabın faturaları o şubenin
  (`invoices.branch_id`; Bağlantı kartından kapatılabilir), ortak hesabınki tedarikçinin varsayılan şubesini alır
  ([Faturanın şubesi](#faturanın-şubesi-25-kasım-2026)). Tek şube seçiliyken öbür şubenin faturası Faturalar'a,
  Gelir-gider'e ve Maliyet'e girmez (Vergi, Nakit ve Ödemeler firma geneli; [PARASUT.md](PARASUT.md)). Şubeler
  listesinde "Paraşüt: Tuzla ile aynı" çipi. Şubenin hesabından fatura gelmişse şube silinemez. Ayrı firma
  bağlanırken vergi numarası öbür hesabın firmasınınkiyle aynı çıkarsa (ya da okunamazsa) yetki yazılmadan "Aynı vergi
  numarası mı?" diye sorulur: aynı işletmeyse doğru yol "Tuzla ile aynı"dır, faturalar iki kez sayılmasın
  ([PARASUT.md › Aynı vergi numarası mı?](PARASUT.md#şube-başına-paraşüt-hesabı)).
- **İkinci tur (25 Kasım 2026): komisyon, AsilPOS, ModPOS, çalışma takvimi, banka POS.** Hepsi Şube ayarları ekranında
  birer kart (`src/app/panel/subeler/[id]/`; "Diğer şubeyle aynı" anahtarı tek bileşen,
  `src/components/panel/same-as-toggle.tsx`; kart verisi `branchSettingView`, `src/server/branch-settings-view.ts`, gizli
  alan değerden çıkarılır). Okuyanlar şubeyi verir:
  - **Komisyon**: süreler şube başına girilir, ama faturalar, hakediş ve işaretleri işletmenindir (hangi şubenin
    sözleşmesine düştükleri bilinmez). Bu yüzden hakedişin son günü **yemek kartı açık şubelerin en kısa süresiyle**
    hesaplanır (`businessPayDays`): Komisyon & hakediş (seçici ne olursa olsun), zil, Bugün, sabah e-postası ve haftalık
    özet aynı son günü görür, kısa süreli şubenin gecikmesi kaçmaz. Şubeler "aynı"yken (sahibin varsayılanı) bugünkü
    gibi. Kanallar kartı iki ekranda aynı bileşen (`ChannelSettingsCard`), seçili şubenin kendi sürelerini düzenler;
    kartın kaydı kartın şubesine, bağlı şubeye yazılmaz. Kart yemek kartı özelliği açık şubede (ya da başka şube bu
    şubenin sürelerini kullanıyorsa: "X şubesinde düzenle" boş sayfaya çıkmasın; ModPOS kartı da öyle).
  - **AsilPOS**: her kasanın (şubenin) kendi geçiş günü ve anahtarı (çok şube, 27 Kasım 2026; okuyucu
    `src/server/pos/tills.ts` `loadPosTills` / `switchDayOf`, eski kayıt doğrudan okunmaz: `tests/sube-ayarlari-2.test.ts`).
    Ayarlar › AsilPOS geçiş gününü o şubenin bölümünden bu satıra yazar; kasa kaynağı başka şubeye geçerse Marina'nın günü
    ona geçmez. Anahtar şubeyi tanıtır: panel isteğin şubesini imzanın tuttuğu anahtardan bulur (`resolvePosCaller`);
    iki şubenin anahtarı aynı olamaz, ortamdaki anahtar yalnız Marina'nın ve yalnız Marina'nın saklanan anahtarı yokken.
    Anahtarlar önbellekli (kayıtta düşer; önbellek ön süzgeç: imza tutunca anahtarlar veritabanından yeniden okunur,
    döndürülen eski anahtar başka sunucu örneğinde de hemen geçmez, [ASILPOS.md](ASILPOS.md); veritabanı okunamazsa uç
    503), tarayıcıya, işlem geçmişine ve yedeğe gitmez. Kaydetme ve silme yöneticinin parolasıyla (anahtar gün sonu
    yazımlarının güven kökü). Kart kasası AsilPOS olan ya da AsilPOS kurulumu yapılmış şubede; geçiş günü orada
    gösterilir, Ayarlar › AsilPOS'ta değişir. Ayarlar › AsilPOS anahtarın nereden okunduğunu yazar, şube sayfasına bağlanır.
    Kasa kaynağı başka şubeye geçerse eski şubede kalan anahtar o şubenin sayfasından silinir ("Eski AsilPOS anahtarı").
    Kütükte AsilPOS'un şubesi yoksa (tek şubeli eski kurulum) geçiş günü eski genel kayda yazılır, okuyan da oradan okur.
  - **ModPOS**: ay rakamına yedek şube başına; föy yalnız anahtarı açık şubenin föyüyse aya girer, hiçbir şubede açık
    değilse föy tablosu okunmaz. Ayarlar › ModPOS API'de her şube bölümünün kendi anahtarı (bağlıysa salt okunur). Kart
    yalnız ModPOS'tan çekilen şubede; anahtarın yalnız durumu.
  - **Çalışma takvimi**: ayda açık gün veri kümesine seçili şubenin değeriyle girer (Genel bakış ve Analiz'in başabaşı,
    günlük sabit giderler; "Tümü"de Tuzla'nınki); Ayarlar › Reçete ölçüleri'nden kaldırıldı (eski sekmenin gönderdiği
    alan yok sayılır). Kasa raporunun beklendiği saat: zil kasa kasa (şubenin saatinden sonra "Bugünün kasa raporu
    bekliyor"), Bugün seçili şubenin saatiyle, "Tümü"de kasa satırları her kasanın kendi saatiyle (ekran her birinde
    kendini yeniler). Personel Yardım'ı varsayılan saati yazar, şubeye göre değişebildiğini söyler.
  - **Banka POS ve yazarkasa**: kasa raporu e-postasının yazarkasa başlığı ("Pavo · sicil AB123 · Z no 12"), akşam
    hatırlatmasının fişi ("TokenX'in gün sonu fişi"; belirtilmediyse Pavo, bugünkü metin) ve AsilPOS cihazı henüz
    göndermediyse gün sonu fotoğrafının okunması (TokenX ayrı mali Z basar, Pavo basmaz). ModPOS şubesinde cihaz yalnız
    e-postanın başlığına girer; "Başka bir cihaz" başlığa yazılmaz, yalnız sicil no.
  - **Tek kasa açıkken** (ör. kapalı şubenin sayfası) şube başka şubeye bağlıysa "aynı" anahtarı yine çizilir: form
    düzenlenebilir görünüp kayıt reddedilmesin.
- **Hazır vardiyalar (26 Kasım 2026)**: Şube ayarları ekranında **Hazır vardiyalar** kartı
  (`src/app/panel/subeler/[id]/shift-presets-card.tsx`, kayıt `saveShiftPresets`): sabahçı (S) ve akşamcı (A) için
  anahtar ve başlangıç / bitiş saati. Ayarı olmayan şube bugünkü sabit saatleri kullanır (davranış değişmez); iki vardiya
  da kapatılınca şubede hazır vardiya yoktur. Saatler kutunun okuyucusuyla okunur (gece yarısını geçen bitiş ertesi gün,
  en çok 16 saat); 01:00–09:00 arasına uzanan vardiyada kart uyarı seslerinin o saatlerde çalmadığını söyler. Okuyan
  `loadShiftPresets(şube)` (`src/server/vardiya/presets.ts`): Vardiya ızgarası, PDF, yazarak doldurma ve asistanın
  vardiya kartı. Ayrıntı [VARDIYA.md › Şube ayarı](VARDIYA.md#şube-ayarı-26-kasım-2026).
- **Şimdilik ortak** (ekran adıyla söyler): uyarı sesi saatleri (09:00–01:00, alt sınır en erken açılan şubenin,
  Tuzla'nın açılışı; tarayıcıda ve bildirim işçisinde, `public/sw.js`, sabit), kontrol listesi hatırlatma saatleri (tek
  dilim takvimi). Şube başına olmayacaklar: KDV, reçete parametreleri, fire, hedef maliyet, FIFO başlangıcı,
  kategori ve POS eşlemeleri, site bağlantı sırrı, bildirim gönderen ve vade günleri.

## Faturanın şubesi (25 Kasım 2026)

Sahibin isteği: "Tuzla seçiminde Tuzla'ya ait, Marina seçiminde yalnız Marina'ya ait bilgiler çıksın; Tümü'nü seçersem
karışık çıksın." İki şube aynı Paraşüt hesabını kullandığı için faturalar şubesiz (işletme geneli) geliyor, iki şubede de
görünüyordu. Artık her faturanın üç hâlinden biri var (kurallar `src/lib/invoice-branch.ts`, `tests/fatura-sube.test.ts`;
veritabanı `tests/fatura-sube-db.test.ts`):

| Hâl | Sütunlar | Tek şube seçiliyken | Gelir-gider |
|---|---|---|---|
| Şube (Tuzla, Marina, laffogato.net) | `invoices.branch_id` | Yalnız o şubede | Şubenin hücresinde; Tümü'nün şube kırılımında şubenin sütununda |
| **İşletme geneli** (bilinçli: muhasebe, ortak hizmet) | `branch_id` boş, `company_wide` açık | Her şubede, "İşletme geneli" rozetiyle | Şubede "İşletme geneli payı (bilgi)" satırında; Tümü'de bir kez |
| **Şubesi seçilmemiş** | ikisi de boş | Görünmez; uyarı sayar | Tümü'de sayılır (şube kırılımında İşletme geneli sütununda); hiçbir şubede yok |

- **Yeni fatura** (eşitleme, `newInvoiceBranch`): ayrı Paraşüt hesabının faturası hesabın şubesine (Bağlantı kartındaki
  anahtar açıkken); değilse **tedarikçinin varsayılan şubesi** (Tedarikçiler › Düzenle › Faturaların şubesi:
  şube, İşletme geneli ya da seçilmedi; `suppliers.default_branch_id`, `default_company_wide`); o da yoksa şubesi
  seçilmemiş. Elle eklenen fatura pencerenin seçimini, seçilmediyse tedarikçinin varsayılanını alır. Var olan faturanın
  şubesi eşitlemede değişmez.
- **Elle seçim**: Faturalar'da fatura penceresinin **Şube** alanı, toplu seçimde **Şube ata…** (Geri al'lı), "Şubesi
  seçilmemiş" süzgeci; Tahmini stok › Marina'ya gelen faturalar; tedarikçi sayfasında "Hepsini … yap". Hepsi tek eylem
  (`setInvoiceBranch`: yalnız yönetici, tek işlem, işlem geçmişine "Faturanın şubesi"). Tutar, ödeme ve cari değişmez.
- **"Şubesi seçilmemiş" kutusu** (Faturalar, "Tümü"de, birden çok kasa açıkken): faturalar tedarikçi tedarikçi ve
  **kanıta dayalı öneri** (`suggestInvoiceBranch`): tedarikçinin varsayılanı; faturanın günü yalnız bir şubenin açık olduğu
  döneme düşüyorsa o şube (Marina'nın açılış gününden önce Tuzla; açılış günü kütükte boşsa bu kanıt yok); tedarikçinin
  şubesi seçilmiş öteki faturaları ve kasadan ödemeleri (Kasadan çıkanlar'ın mağaza adı) tek bir şubeyi gösteriyorsa o
  şube. Kanıt karışık ya da yoksa öneri yok. **Öneri yazılmaz**: satırdaki düğme ya da "Önerilenleri uygula" (onaylı
  pencere) yazar; "Seçilen şube tedarikçinin varsayılanı da olsun" açıkken kart da güncellenir (tarih kanıtı kartı
  değiştirmez). Tek şube seçiliyken Faturalar ve Paraşüt ekranı "N faturanın şubesi seçilmemiş" uyarısını gösterir.
- **Süzülenler**: Faturalar (liste ve toplamlar), Gelir-gider, Genel bakış ve Maliyet (`loadModel`; `invoiceScopeWhere`,
  `src/server/invoice-scope.ts`), Paraşüt ekranının fatura sayıları ve bekleyen ürünleri, tahmini stok (yalnız Marina'nın
  faturaları). Tedarikçiler'de bakiye ve ödemeler firma kipinde **firma geneli**, şube kipinde şubenin ve işletme genelinin
  faturalarıyla (27 Kasım 2026, [şube ayrımı parça 4](#alanlar-ödemeler-nakit-planı-tedarikçiler-komisyon-parça-4));
  tedarikçi sayfası her faturanın şubesini rozetinde yazar. Vergi ve KDV firma geneli (bütün faturalar); Nakit planı ve
  Ödemeler kişinin şube görünümüyle.
- **Geçiş** (`0087_fatura_sube`, `0088_fatura_sube_veri`, `0089`): tahminle şube yazılmadı. Ayrı Paraşüt hesabından
  "işletme geneli" seçimiyle gelmiş faturalar bilinçli işletme geneli sayıldı; tahmini stoğun "Marina'ya gelen faturalar"
  seçimi (`stock_receipts`) faturanın şubesi oldu ve tablo kalktı (tek doğruluk kaynağı `invoices.branch_id`). Gerisi
  (bugüne kadarki bütün ortak hesap faturaları) **şubesi seçilmemiş**: kutuda öneriyle bekler.
- **Davranış değişikliği** (sahibe söylenecek): geçişten sonra tek şube seçiliyken Faturalar ve Gelir-gider'de eski
  faturalar görünmez, ta ki şubeleri seçilene kadar; "Tümü"nün rakamları değişmez. Şubesi seçilen harcamaya bağlı fatura
  (ör. Temizlik & Sarf) o şubenin kârına girer (önceden her şubede bilgi satırındaydı). Aynı veride eski kuralla
  karşılaştırma (`scripts/fatura-kalem-karsilastir.ts`, [PARASUT.md › 5f](PARASUT.md)): başlangıç verisinde şube
  seçiliyken şubenin mal alışı (bilgi) 0'a, "İşletme geneli payı (bilgi)" şubesi seçilmemiş komisyon faturaları kadar
  iner; şubenin kârı değişmez. Rakamlar `tests/fatura-kalem-karsilastirma.test.ts`'te kilitli.
- Şubenin varsayılanı olarak seçilmiş şube silinemez (verisi var sayılır; `branchUsageCount`).

## "Tümü"nün ay bilgisi (denetim 13 Kasım 2026, P02)

"Tümü" şubelerin toplamıdır. Kasa satırları (rapor, AsilPOS gün sonu, ModPOS föyü) şubesini taşır (`tillRows`,
`src/server/data/cash-reports.ts`); ay bilgisi şöyle kurulur (`src/lib/cash-month.ts`, `src/server/data/dataset.ts`):

| Ne | Kural |
|---|---|
| Açık gün, raporlu gün | **Günde bir kez**: Tuzla ve Marina aynı gün açıksa bir gün. Personel ve oranlanan sabit gider bu günle bölünür, oran en çok 1 (iki şube açıkken maaş ve kira iki kat sayılmaz); günlük ortalama ve ay sonu öngörüsü de bu günle |
| Ciro, indirim, ödenmez | Şubelerin toplamı |
| Kaynak önceliği | Rapor > AsilPOS gün sonu > föy, **aynı şubenin aynı gününde**: bir şubenin raporu ötekinin föyünü düşürmez |
| Elle yazılan ay bilgisi | Her şube kendi elle yazdığı ve kasasıyla çözülür, sonra toplanır (`resolveBranchMonths`): Marina'nın elle yazdığı ciro Tuzla'nın kasa cirosunu silmez. Elle yazılan açık günün hangi günler olduğu bilinmediği için şubelerin en büyüğü alınır; kasadan gelen günler yalnız açık günü kasadan gelen şubelerin satırlarıyla birleşir (elle daha az gün yazan şubenin kasa günleri girmez). Kartlı oran ciro ağırlıklı |
| Açılış ayı | Her şube kendi açılış günüyle (`tillOpenedOn`): raporlar açılış gününden beri girildiyse ay yarım sayılmaz, cirosu "Tümü"nün toplamına da girer |
| Personel ve sabit gider | Şubeye bağlı kişi ve kalem "Tümü"de de kendi şubesinin günüyle oranlanır (açılış ayında açılış gününden; şube görünümüyle aynı); işletme geneli kalem işletmenin günüyle |
| Biten ay | Ayın sonuna kadar oranlanır: ayın 1'inde 00:00-05:00 arası son günün raporu daha beklenirken de kira ve maaş tam ay (`prorationDays`) |

Aynı kuralla: Genel bakış'ın günlük ciro grafiği günün şubelerini tek çubukta toplar; nakit planının ve haftalık özetin
satışı ödenmez / ikram hariç ciroyla (`dayRevenue`); Bugün'ün şube kartı föyden sayılan günü de çizer.

### Aydan aya rozetler ve haftalık kıyas aynı şubelerle (25 Kasım 2026, denetim bulgusu 65)

"Tümü"nün toplamı yeni açılan şubeyi de içerdiği için toplamları kıyaslamak açılışı büyüme gibi gösteriyordu: Marina 13
Kasım'da açıldı, Genel bakış'ın Kasım rozeti Ekim'e göre, Aralık rozeti Marina'nın yarım Kasım'ına göre artış diyordu;
30 Kasım'ın haftalık özeti iki şubeli haftayı tek şubeli dört haftayla kıyaslayıp "önceki 4 haftaya göre %X fazla"
diyecekti.

| Ne | Kural |
|---|---|
| Yeni şube | Açılış günü (Şube ayarları) önceki ayın 1'inden sonra olan şube; açılış günü yazılmamışsa ilk verisi önceki ayda ya da bu ayda başlayan şube (Tuzla hep eski) (`sameBranchBasis`, `src/lib/same-branches.ts`) |
| Genel bakış, "Tümü" | Yeni şube varsa POS cirosu ve günlük ortalama rozeti iki ayda da açık şubelerin ay bilgisiyle (`Month.byBranch`; günlük ortalama şube şube POS ÷ açık gün, toplanır); ipucu "Rozet: Ekim 2026 ayına göre yalnız iki ayda da açık şubelerle (Tuzla); Marina 13 Kasım'da açıldı, kıyas dışı." der. Şubeye bölünemeyen rakamların (net satış, brüt ve net kâr) rozeti çizilmez, ipucu nedenini söyler. Yeni şube yoksa ve şube seçiliyken rozetler eskisi gibi |
| Haftalık özet, kasa cirosu satırı | Kaynak Genel bakış'ın ay rakamıyla aynı kasa satırları (`tillRows`: raporu olmayan AsilPOS günü gün sonundan; önceden yalnız kasa raporları). Geçen haftanın her günü önceki dört haftanın aynı günüyle şube şube eşlenir (Kıyas kartının şube-gün eşlemesi, `comparePairs`; [KIYAS.md](KIYAS.md#şube-eşleme)); iki günü de bilinen şube-gün iki tarafa girer. Önceki bir haftada hiç günü olmayan şube adıyla söylenir: "… önceki 4 haftayla aynı (aynı şubelerle: Marina önceki haftalarda yoktu)" ([HAFTALIK-OZET.md](HAFTALIK-OZET.md)) |

## Kasa raporu "Tümü"de (20 Kasım 2026)

Kasa raporu şube başınadır: günün raporu, devir zinciri, yazarkasa Z sırası, ModPOS föyü, AsilPOS gün sonu, kasadan
çıkanlar ve ay satırı şubenin kendi kasasınındır. "Tümü" bunları birleştirmez:

- **Kasa raporu sayfası**: "Tümü"de yöneticinin günden güne görünümü her açık şubeyi kendi bölümünde gösterir (üstte
  şube kısayolları). Form (personel ve yöneticinin günü) kasanın şubesinindir: seçili fiziksel şube; "Tümü" ya da online
  kanal seçiliyken Tuzla (`currentTillBranch`) ve sayfa bunu not olarak yazar. Önceden "Tümü"de günün raporu koşulsuz
  `limit(1)` ile okunuyor, Marina'nın raporu görünürken kayıt Tuzla'ya iniyordu; geçmişte günün iki raporundan biri
  düşüyordu.
- **Form kasasını taşır** (21 Kasım denetimi #12): kasa raporu, geç rapor, düzeltme ve silme isteği, kasadan çıkan
  satırı ve ekleme isteği sayfanın çizdiği kasanın kimliğini gönderir; sunucu onu doğrular (etkin fiziksel şube;
  şubesine kilitli personelde yalnız kendi şubesi, `formTillBranch` › `formTillError`) ve yazımı o kasanın kapsamında
  çalıştırır (`withBranchScope`: kapı, kilit ve okumalar da o şubenin). Çerez sekmeler arasında ortaktır: önceden başka
  sekmede seçici Marina'ya geçince açık kalan Tuzla formu Marina'ya yazıyordu. Kimliği göndermeyen eski sekme seçili
  kasaya yazar. Form anahtarı kasayı da taşır: seçici değişince yarım form öbür kasada kalmaz.
- **Bugün'ün kasa satırları** ve **zil** aynı kasayı okur: "Tümü"de birden çok kasa açıkken her şube ayrı, değilse tek
  kasa (`currentTillBranch`). Online kanal seçiliyken 27 Kasım'dan beri kasa satırı yok, Bugün "Bu kanalın kasası ve
  stoğu yok" der ([Şube ayrımı › Ayarsız sızıntılar](#ayarsız-sızıntılar-parça-2); önceden Tuzla'nın kasası görünüyordu). Önceden Bugün online kanalda şubesiz okuyup `online`
  kasasında rapor arıyordu: dünün eksik raporu görünmüyor, girilmiş bugünkü rapor "Henüz girilmedi" kalıyordu; Kasa
  sayfası ve zil Tuzla'yı gösteriyordu (denetim 21 Kasım #26).
- **Tek kasa okumaları** (`getCashReport`, `previousCarryOver`, `nextReportAfter`, `previousOkc`, `nextOkc`,
  `loadMonthEntry`, AsilPOS günü, kasadan çıkanlar, zayi) verilen şubeyle ya da kasanın şubesiyle okur; kayıtlı raporun
  e-postası, WhatsApp metni ve bütünlük denetimi raporun kendi şubesiyle.
- **E-posta ve WhatsApp şubeyi yazar** (21 Kasım denetimi #2): iki şubenin aynı günkü raporu aynı numarayı taşır ve
  aynı alıcılara, aynı sohbete düşer. Birden çok kasa açıkken konu, başlık ve metnin ilk satırı numaranın yanına şubenin
  adını yazar ("KR-20261120 · Marina"); e-postanın "Panelde aç"ı `&sube=` ile o şubenin gününü açar (zil gibi). İşlem
  geçmişinin anahtarı şubenin günüdür (`cashLogKey`). Tek kasada metin ve bağlantı bugünkü gibi.
- **Personel istekleri** (düzeltme, silme, geç rapor, kasadan çıkan): onay isteğin kendi raporuna ve şubesine yazar,
  yöneticinin şube seçimine değil (önceden "Tümü"den onaylanan Marina önerisi Tuzla'nın raporuna yazılıyordu). Konu
  şubenin günü (`cashDaySubject`: Tuzla `gun:G`, öteki `gun:G:şube`); bir şubenin raporu girilince ya da silinince
  yalnız o şubenin istekleri kapanır. Onaylar kartı birden çok şube açıkken şubeyi adıyla gösterir ve "Günü aç" /
  "Raporu aç" `&sube=` ile o şubenin gününü açar; kasadan çıkan ve fotoğraf kaldırma kartları da (fotoğrafta raporun
  şubesi; önceden şubesizdi, bağlantı yöneticinin seçili kasasını açıyordu, denetim 21 Kasım #29).
- **Zayi istekleri** (geç kayıt, silme): Onaylar kartının bağlamı isteğin şubesinden, yöneticinin seçiminden değil
  (denetim 21 Kasım #28): geç kayıtta isteği açanın şubesi (yükteki `branchId`; eski isteklerde Tuzla), silmede kaydın
  şubesi. Günün kasa raporu (Z ödenmez, gönderildi mi, kasa e-postası uyarısı), o günün aynı kalemden kayıtları, aynı
  kalemin bekleyen öteki istekleri ve kayıtlı ikram o şubenin; maliyet modeli şubenin kapsamıyla, istekte şube başına
  bir kez (`loadBranchModelOnce`). Kart birden çok şube açıkken şubeyi adıyla yazar, "Günü aç" `&sube=` ile açar.
- **Personelin yetkisi** (günü hâlâ düzenleyebilir mi, fotoğrafı görebilir mi, geç rapor açık mı, zayiyi doğrudan
  girip silebilir mi): başka şubenin raporu bu şubenin gününü açmaz ya da kapatmaz (`staffDayOpen`, `staffLateDayOpen`,
  zayide `wasteLock`: yeni kayıtta ve geç kayıt isteğinde kaydın ineceği şube, silmede kaydın kendi şubesi; denetim
  21 Kasım #13). Önceden zayi kilidi şubesizdi: iki şube dünü ve bugünü girince dün personele hiç kapanmıyor, Tuzla'nın
  raporları Marina'nın unutulan dününü kapatıyordu.
- **Kapalı gün** şubenindir (denetim 13 Kasım KP-05; `special_days.branch_id`, göç 0063). Kasa'nın "Kafe kapalıydı"sı
  ve personelin bildirimi formun kasasını yazar; bildirimin onayı bildirimin şubesine (yöneticinin seçimine değil; konu
  Tuzla'da `gun:G`, ötekinde `gun:G:şube`). Şubesi boş satır işletme genelidir (Özel günler'de "Bütün şubeler", eski
  satırlar) ve her şubede kapalı sayılır; Özel günler'de kapalı günün şubesi seçilir, ikiz denetimi şube içinde, "Geri
  al" aynı şubeye döner. Kanıt (rapor, AsilPOS gün sonu, kasadan çıkan, zayi) o şubenin kayıtlarıdır: Marina'nın raporu
  Tuzla'nın işaretini kaldırmaz, Tuzla'nın bildirimini engellemez. Bir şubenin kanıtı işletme geneli tek günlük işareti
  yalnız o şube için kaldırır: satır o gün raporu olmayan öteki etkin fiziksel şubelere şubeli kalır, onaylı
  bildirimleri oraya geçer (`clearClosedMark`). Bugün, zil ve AsilPOS durumu her kasanın eksiğini kendi şubesinin
  işaretiyle susturur. Zilin ve sabah e-postasının **dünkü kontrol listeleri** de şube şube (22 Kasım 2026;
  `closedMarksOn`, `closedForBranch`): hiç açılmamış liste yalnız kendi şubesi kapalı işaretliyse eksik sayılmaz; bütün
  şubelerin listesi işletme kapalıysa (işletme geneli işaret ya da o gün açık her şubenin kendi işareti). E-postada
  kapalı şubede günün izi varsa (şubenin raporu ya da başlamış listesi) eksikler yine yazılır. Önceden ikisi de herhangi
  bir şubenin işaretine bakıyordu: Marina dün kapalıyken Tuzla'nın eksik listesi zile düşmüyor, Tuzla'nın kapalı
  gününün listesi Marina'nın raporu yüzünden e-postada eksik yazılıyordu. AsilPOS'un gün sonu kanıtı şube verilmeyen
  okumada da yalnız AsilPOS'un şubesinindir (Tuzla'nın eski deneme satırı sayılmaz). Birden çok kasa açıkken kontrol
  listesi ve işlem geçmişi de şube şubedir (24 Kasım 2026 şube kapsamı; `branchChecklistRuns`, `branchStaffWrites`,
  `src/lib/closed-days.ts`): şubenin listesi (şablonun şubesi) ve şubenin personelinin yazımı kırmızı; bütün şubelerin
  listesi ve şubesiz personelin yazımı yalnız uyarıdır ("Şubesi belli olmayan N iz", `sharedTraces`; onayı ve personelin
  bildirimini kapatmaz), öbür şubeninki sayılmaz. Kendi tablosunda şube şube sayılan işlemler (kasa raporu, kasadan
  çıkan, zayi ve ikram) işlem geçmişinden ikinci kez sayılmaz; silme kaydı sayılır (satır tablodan gitti). Karaoke
  yalnız karaokenin şubesinde sayılır. Sitenin sipariş sayıları da bildirilen şubenin (`fetchSiteDayCounts(gün, şube)`,
  `&branch=`); şubesiz eski site Marina için "okunamadı" sayılır (onayı kapatmaz). Tek kasada liste, işlem geçmişi ve
  karaoke bugünkü gibi o kasanın kanıtıdır. Önceden Tuzla'nın listesi, Tuzla'ya kilitli personelin kaydı ya da karaoke
  Marina'nın kapalı gün bildirimini kapatıyordu. Z no ve
  açılış sürekliliği şube başına bakılır (`closedDayEvidence`, `onNextReport`; denetim 21 Kasım #1): Tuzla'nın ertesi
  günkü Z'si Marina'nın önceki Z'siyle karşılaştırılıp onaylı işaret silinmez, onay "kafe açık görünüyor" diye
  engellenmez, Marina'nın açılışı Tuzla'nın devriyle tutmuyor diye zile yazılmaz. Fotoğraftan okunan ModPOS Z'sinin
  "eski bir Z raporu olabilir" denetimi de formun kasasının önceki raporuyla (`previousZNo`); yazarkasa Z'sinin
  büyüklük denetimi (son 28 günün ortancası, docs/YAZARKASA-Z.md) de o şubenin raporlarıyla (`okcTypical`). Önceden
  iki şubenin toplamı karışıyordu: ortanca öbür şubeye kayıyor, büyük şubenin gerçek Z'si "çok büyük" görünebiliyordu.

## Ayarlar'da kasa kartları (25 Kasım 2026)

Ayarlar'daki **AsilPOS (kasa)** ve **ModPOS API** kartları seçili şubeye göre (`src/lib/pos-cards.ts`; şube kapsamı C
P2-2): tek şube seçiliyken yalnız o şubenin kasası çizilir (ModPOS kartında o şubenin bölümü); kasası o sistem olmayan
şube ya da laffogato.net seçiliyken kart tek satıra iner: "Bu şubede kullanılmıyor", açılınca "AsilPOS Marina şubesinin
kasası; ayarları Marina seçiliyken ya da Tümü'nde görünür." ve o şubeyi seçtiren düğme (`?sube=`, bölüm açık gelir).
Satıra inen kart durumu hiç okumaz. "Tümü"de birden çok kasa açıkken iki kart da şube adıyla (özet "Marina: …", bölüm
başlığı şubenin adı). Hangi şubenin kasasının ne olduğu kütükten: AsilPOS'un şubesi (yukarıda), ModPOS'tan çekilenler
kaynağı ModPOS olan şubeler (hiç yoksa Tuzla). Bugünkü veride Marina'nın kaynağı ModPOS'sa ModPOS kartı Marina'da da
bölümüyle görünür (föyün yedek çekimi); kaynak AsilPOS yapılınca satıra iner. Tek şubeli kurulumda kartlar bugünkü gibi.

## AsilPOS'a geçiş günü şubenin kasasınındır (21 Kasım 2026; çok şube 27 Kasım 2026)

Her AsilPOS kasasının kendi geçiş günü vardır (`switchDayFor`, `src/lib/pos/tills.ts`): bir şubenin günü yalnız şubenin
kasası AsilPOS ise ve gün o şubenin geçiş gününden önce değilse sayılır; kasası ModPOS olan şubenin AsilPOS'tan gelen
günü (deneme) hiçbir hesaba girmez. Marina 22 Kasım 2026'dan beri AsilPOS'ta (göç 0099 kasa kaynağını AsilPOS yaptı;
Marina'nın ModPOS dönemi 13–21 Kasım 2026, saklı föyü o günler için sayılmaya devam eder, föyü artık çekilmez). Tuzla'nın
kasası ModPOS'ta kalır: föyü çekilir, Kasa raporu, föy karşılaştırması, ürün listesi, ürün ikramı ve kasadaki fiyatlar
Tuzla'da bugünkü gibidir. Ay ekranları kasası ModPOS olan şube seçiliyken AsilPOS'u okumaz, "Tümü"de her kasayı kendi
geçiş gününden okur ve şubelerin satırlarını şube şube ayırır (iki kasanın aynı günü çift sayılmaz). Her kasanın gün sonu
Kasa raporuna kendiliğinden yazılır ve e-postası gider ([ASILPOS.md › Gün sonu otomasyonu](ASILPOS.md#gün-sonu-otomasyonu-22-kasım-2026)).
Ayrıntı: [ASILPOS.md › Şubeler](ASILPOS.md#şubeler-çok-şube-27-kasım-2026).

## Personel hesabının şubesi (16 Kasım 2026)

**Kullanıcılar & roller**'de personel eklerken ya da düzenlerken **Şube** seçilir (boş: **Bütün şubeler**).
Yönetici şubeye bağlanmaz; bütün şubeleri görür ve seçiciyle süzer.

- Şubesi seçilmiş personelin paneli **o şubede kilitli** açılır (`src/server/branch-scope.ts` › `lockedBranch`):
  çerez ve `?sube=` yok sayılır, kenar çubuğunda seçici yerine şubenin adı durur, `chooseBranchScope` başka şubeyi
  reddeder. Kasa raporu, kasadan çıkan, zayi ve kontrol listeleri o şubeye yazılır ve o şubeden okunur.
- Kilit kimliğiyle açılan kayda da bakar (21 Kasım denetimi #14; `src/server/branch-scope.ts` › `staffBranchRefusal`,
  kural `src/lib/branches.ts` › `otherBranchError`): kimlikler sıralıdır ve eylemin kimliği istemci paketindedir;
  kilit yalnız ekranı süzerse başka şubenin açık günündeki satır elle gönderilen kimlikle açılabiliyordu. Kilitli
  personel başka şubenin kasadan çıkan satırını düzeltemez, silemez, isteğe konu edemez, fiş ekleyemez; başka şubenin
  zayi kaydını silemez ve silinmesini isteyemez; başka şubenin kasa raporu fotoğrafının kaldırılmasını isteyemez, kasa
  raporu e-postasını yeniden gönderemez. Eylem "Bu kayıt Marina şubesinin; hesabınız Tuzla şubesinde" der; başka
  şubenin kasa ve fiş fotoğrafı `/api/foto/{id}`'de 403 döner. Yönetici, şubesiz personel ve şubesi pasif personel
  serbest. Yeni kayıt zaten formun kasasına (`formTillBranch`) ya da seçili şubeye yazılır, kilitli personelde ikisi de
  kendi şubesidir.
- Şube pasife alınırsa kilit kalkar (kişi "Tümü"ye düşer); yönetici yeni şubesini seçer.
- **Müdür** ([ROLLER.md](ROLLER.md)) de şubesine kilitlidir, şube onda ZORUNLUDUR (veritabanı kısıtı
  `users_manager_branch_ck`). Personelin kilidine ek olarak `withBranchScope` ile açılan işletme geneli ya da başka
  şubenin okumaları da şubesine daralır; şubesi pasife alınırsa kilit kalkmaz, oturumu yok sayılır (giriş de
  reddedilir). Muhasebeci şubeye bağlanmaz, bütün şubeleri salt okur.
- Kullanıcı listesinde personelin şubesi rozetle görünür. Şubeye bağlı hesap varken şube silinmez
  (`branchUsageCount`).

## Ödemeler (16 Kasım 2026)

Ödeme hatırlatıcılarının (kira, aidat, fatura, maaş …) **Şube** alanı vardır (`reminders.branch_id`; boş = **işletme
geneli**: vergi, SGK, muhasebe gibi). Sabit giderdeki kuralın aynısı:

| Ne | Kural |
|---|---|
| Ödemeler listesi, Bugün, zil, Genel bakış'ın "Yaklaşan ödemeler" kartı ve gecikme satırı | Tek şube seçiliyken **o şubenin ve işletme genelinin** hatırlatıcıları; "Tümü"nde hepsi, şubeye ait olanın başlığında şubesi ("Kira · Marina") |
| Yeni hatırlatıcı | Formdaki **Şube**; varsayılanı seçili fiziksel şube, "Tümü"nde işletme geneli |
| Sabit giderden ekle | Kalemin şubesi (Marina'nın kirası Marina'nın ödemesi). Tek şube seçiliyken adaylar şubenin ve işletme genelinin kalemleri; "Tümü"de kalemin şubesi rozette |
| Ertele (tekrar eden) | Ertelenen dönemin tek seferlik kopyası serinin şubesinde kalır; önceden kopya işletme geneli iniyor, Marina'nın kirası Tuzla'nın Ödemeler'inde görünüyordu (denetim 21 Kasım #17) |
| Ödenmemiş faturalar ve cari | Ödemeler ve faturalar alanının kipiyle (27 Kasım 2026, [şube ayrımı parça 4](#alanlar-ödemeler-nakit-planı-tedarikçiler-komisyon-parça-4)): şube kipinde şubenin ve işletme genelinin faturaları, şubesi seçilmemiş fatura "N faturanın şubesi seçilmemiş" sayısında, faturasız borç (cari) katlı "İşletme geneli" bölümünde; firma kipinde ve "Tümü"de hepsi |
| Kasadan tedarikçiye işlenmemiş ödemeler (Teslim, fişsiz alışveriş) | Cari işletme genelidir, **kasa satırı şubenindir** (24 Kasım 2026): zilin sayısı, Tedarikçiler'in uyarısı ve tedarikçinin şeritleri tek şube seçiliyken yalnız o şubenin kasasınınkini gösterir, öbürlerini "Öbür şubenin kasasında N satır daha" diye söyler; birden çok kasa açıkken satır kasasının adını yazar. Liste süzülmez: Tuzla'nın kasasından ödenmiş fatura Marina'da da "kasadan ödenmiş olabilir" diye sessizdir (`cariHints`) |
| Kasadan faturalı alımlar (e-Arşiv, fatura) | Kasanın şubesinde: zil, Bugün, Genel bakış'ın ayın işleri ve Faturalar › Kontrol bekleyen seçili şubenin kasasından çıkanları gösterir (`scopeCashOutInvoiceState`); birden çok kasa açıkken satır "Kasa 24 Kas · Marina" yazar. Eşleştirme işletme geneli (fatura şubesizdir); Vergi ve bütün şubelerin sabah e-postası bütün şubeler, şubeye bağlı adresin sabah e-postası yalnız şubenin |
| Sabah e-postası, Vergi, haftalık özet | Bütün ödemeler: para işletmenindir (`loadUpcoming` şubesiz çağrılır). Sabah e-postasında şubeye bağlı bildirim adresi yalnız şubenin ve işletme genelinin ödemelerini, 27 Kasım'dan beri şubesine seçilmiş faturaları da yalnız o şubenin alıcısı alır (işletme geneli ve şubesi seçilmemiş fatura her gruba; alıcı grupları yukarıda, Şube kapsamı C'de). Nakit planı kişinin şube görünümüyle ([şube ayrımı parça 4](#alanlar-ödemeler-nakit-planı-tedarikçiler-komisyon-parça-4)) |

Var olan hatırlatıcılar işletme geneli kaldı; şubeye ait olanı yönetici formdan taşır.

**Özel günler** şube başınadır, her tür (`special_days.branch_id`; boş = bütün şubeler; şube kapsamı C): tek şube
seçiliyken liste (yöneticinin ve personelin) o şubenin ve bütün şubelerin günlerini gösterir (kilitli personelde kendi
şubesi, değilse seçici): Tuzla'nın kapalı günü ya da kampanyası Marina'nın listesine girmez, Marina'nın personelinin
maçını "Bu günlerde zaten bir özel gün var" diye reddetmez. "Tümü"de birden çok kasa açıkken satır şubesini yazar
(`loadSpecialDays`, `staffSpecialList`, `saveStaffSpecialCore`; 24 Kasım 2026). Personelin eklediği gün şubesine
kilitliyse o şubenin olur. Kapalı gün kuralları (eksik rapor, kanıt) yalnız `kapali` satırını okur.

## Uyarı sesleri şubeye göre (22 Kasım 2026)

Tuzla Köyiçi'nde bilgisayarın varsayılan ses çıkışı kafenin genel hoparlörü: panelin zil, alarm ve hatırlatma sesleri
bütün kafeye çalıyordu. Bilgisayarda **açıkça Tuzla** seçiliyse (personelin kilitli şubesi Tuzla ya da yönetici soldan
Tuzla'yı seçmiş) **Uyarı sesleri › Yalnız bu bilgisayardan çalsın** varsayılan açıktır. **"Tümü"de ve Marina'da**
bilgisayarın kendi seçimi geçerlidir (Siparişler › Bu cihazda uyarılar › Uyarı sesleri); seçilmediyse anahtar kapalıdır
ve ses varsayılan çıkıştan çalar. Önceden "Tümü" Tuzla sayılıyordu: Marina'daki bilgisayarda "Tümü" seçiliyken Tuzla'nın
varsayılanı açılıyor, hoparlör seçilmeden sipariş zili ve alarm susuyordu (22 Kasım 2026). Tuzla'da "Tümü"yle çalışan
bilgisayarda anahtar bir kez elle açılır; seçim o bilgisayarda saklanır. Kural tek yerde: `src/lib/audio-output.ts` ›
`ONLY_COMPUTER_BRANCHES`, `deviceBranch`, `onlyComputerFor`. Ayrıntı: docs/BILDIRIMLER.md.

## Şube ayrımı (27 Kasım 2026)

Sahibin isteği (27 Kasım 2026): "ladmin'de bir şube seçince sadece o şubeye ait bilgiler çıksın, diğerleri çıkmasın; tüm
her yerde bu ayrımı yap." Bugün bilerek firma geneli olan ekranlar için (Vergi, Nakit planı, Tutarlılık, Mutabakat,
tedarikçi bakiyeleri, stok değeri, Ödemeler; [yukarıda](#neyi-süzer-neyi-süzmez)): "bunu kullanıcının ayarlarından duruma
göre değiştirilebilir yap, isteyen istediği gibi ayarlasın." Şube kapsamı A–C'nin devamı (**D**); altı parçada kuruldu
(hepsi 27 Kasım 2026; [Sıra](#sıra)).

### Şube görünümü (kişinin ayarı)

**Hesabım › Şube görünümü** (`/panel/hesap#sube-gorunumu`): "Soldan bir şube seçtiğinizde bu ekranlar yalnız o şubeyi
mi, firmanın tamamını mı göstersin? Tercih yalnız sizin hesabınızda saklanır." Ekran ekran **Yalnız şube | Firma geneli**,
altında tek satır yardım; düğmeler **Hepsi yalnız şube**, **Hepsi firma geneli**, **Varsayılanlara dön**; en altta salt
okunur **Her zaman firma geneli** listesi (gerekçeleriyle). Seçim hemen kaydedilir, hata olursa geri döner.

| Alan (kimlik) | Yalnız şube kipinde | Firma geneli kalan | Muhasebecinin varsayılanı |
|---|---|---|---|
| Ödemeler ve faturalar (`odemeler`) | Şubenin ve işletme genelinin hatırlatıcıları, şubeye seçilmiş faturalar; Bugün, zil, Genel bakış, e-posta | Faturasız cari borç, dağıtılmamış ödeme ("İşletme geneli" bölümü) | Yalnız şube |
| Nakit planı (`nakit`) | "Şubenin nakit akışı": şubenin satış tahmini, kasa devri, ödemeleri, faturaları, maaşları, sabit giderleri; vergi, SGK, işletme geneli tek satır ("Net akış") | Açılış bakiyesi | Firma geneli |
| Vergi (`vergi`) | "Şubenin payı (bilgi)" kartı: satış KDV'si, şubenin faturalarının KDV'si, şube personelinin SGK ve stopajı, şubenin amortismanı | Beyan tutarları ve takvim ("Firma geneli · beyan") | Firma geneli |
| Tutarlılık (`tutarlilik`) | Şubenin satışı, Z'si, reçete kullanımı, sayımı, zayisi; alım yalnız şubeye seçilmiş faturalardan | Bulgular (şube sütunu yok) | Firma geneli |
| Mutabakat (`mutabakat`) | Şubenin POS hakedişi; ekstrede şubenin kayıtlarıyla eşleşen satırlar üstte | Ekstrenin kendisi, gelen POS parası | Firma geneli |
| Tedarikçi bakiyeleri (`tedarikciler`) | Şubenin faturaları, onlara ödemeler, şubenin kasasından ödemeler; "İşletme geneli" satırı | — | Firma geneli |
| Stok değeri, FIFO (`stok_degeri`) | Şubenin ve işletme genelinin faturalarındaki partiler | — | Firma geneli |
| Komisyon ve hakediş (`komisyon`) | Şubenin payı ana görünüm, firmanın raporu katlı ekte | — | (ekran kapalı) |
| Şubeleri yan yana (`karsilastirma`) | Kipler **Yalnız seçili şube \| Yan yana** | — | (ekran kapalı) |
| İşletme geneli giderler (`ortak_gider`) | Kipler **Yalnız not \| Tutarla göster**; "Yalnız not": "İşletme geneli giderler bu şubenin kârına girmez (Tümü'de sayılır)", tutar yok | — | Tutarla göster |

- **Yönetici**: her alanda varsayılan "Yalnız şube" (kart ve çip). **Muhasebeci**: kart ve çip, varsayılanı yukarıdaki
  sütun; kartında yalnız açabildiği ekranların alanları (Vergi, İşletme geneli giderler). **Müdür ve şubesine kilitli
  personel**: kart yerine tek satır ("Hesabınız Marina şubesine bağlı: her ekran yalnız Marina'yı gösterir."), çip yok, her
  alan "Yalnız şube"; eylem reddeder ("Hesabınız şubenize bağlı"). **Şubesiz personel**: kart yok (para ekranı yok),
  varsayılan geçer. Tek şube açıkken kart yok (seçici de çizilmez).
- **Ekranın çipi** (`src/components/panel/branch-view-chip.tsx`): alanın ekranında, tek şube seçiliyken, bütün şubeleri
  gören ve kilitsiz hesapta. Şube kipinde "Marina görünümü" + **Firma geneline geç** ve alanın firma geneli kalan satırı
  ("Beyan tutarları … her görünümde firmanın"); firma kipinde "Firma geneli · Marina seçili" + **Yalnız Marina'yı göster**.
  Altında "Bütün ekranlar için: Hesabım › Şube görünümü". Düğme aynı tercihi o alan için yazar. Alan ekranında "Marina
  seçili: bu ekran firma geneli" notunun (`CompanyWideNotice`) yerini alır; not yalnız hep firma geneli ekranlarda kalır.
- **Saklama**: `users.branch_view` (jsonb nesne, migration `0100_sube_gorunumu`; CHECK `jsonb_typeof = 'object'`),
  ör. `{"vergi":"firma"}`; eksik anahtar rolün varsayılanı, bilinmeyen anahtar ve değer okurken düşer (`parseBranchView`).
  Yazım yalnız kişinin satırına, anahtar anahtar (`branch_view || jsonb_build_object(alan, kip)`); oturum sürümü değişmez,
  oturum (`readSessionUser`, `CurrentUser`) tercihi taşımaz. Saklanan değer her alanda `sube` / `firma` (iki alanın
  seçenek adı başka, değeri aynı).
- **Kod**: kurallar `src/lib/branch-view.ts` (`VIEW_AREAS`, `effectiveView`, `parseBranchView`, `viewAreasFor`,
  `viewChipText`); okuma `src/server/branch-scope.ts` › `userBranchView` (istek başına tek küçük okuma), `currentBranchView(alan)`,
  `areaScope(alan)` (firma kipinde "Tümü", şube kipinde seçim; alanın yükleyicisi `withBranchScope(ALL_BRANCHES, …)` yerine
  `withBranchScope(await areaScope("vergi"), …)` ile okur), `withBranchView(tercih, fn)` (testler, bağlantı anahtarının
  sahibi); yazma `src/server/actions/branch-view.ts` › `saveBranchView` (`requireUser` + `sube.tumu`; muhasebeci de yazar:
  kendi hesabı). **Müdürün kilidi okumada kalır**: `areaScope` "Tümü" dönse de `currentBranchScope` onu şubesine daraltır.
- **Bağlantı ve panel asistanı** (parça 4): `odemeler` ve `tedarikci_ozeti` isteğe bağlı `gorunum: "sube" | "firma"` alır
  (`withAreaView`); verilmezse bağlantıda anahtar sahibinin tercihi (`userBranchViewOf` + `withBranchView`,
  src/server/mcp/server.ts), panel asistanında oturumun. Çıktının `kapsam` satırı alanın kipini yazar ("Marina ·
  ödemeler ve faturalar: Yalnız şube · nakit planı: Firma geneli"; `areaKapsam`). `tedarikci_ozeti` artık `sube` de alır.

**Sahibin kararı bekleyen**: İşletme geneli giderler için üçüncü kip, **"Ciroya göre pay et"**, eklenmedi: 23 Kasım'daki
"bölüştürme yok" kararını ve "Σ şube − işletme geneli = Tümü" denetimini bozardı.

### Her zaman firma geneli (ayarı yok)

Tam yedek (geri yüklenebilir yedek bütün veritabanını ister); vergi beyan tutarları ve takvim (tek vergi numarası); banka
ve cari ekstresi, nakit açılış bakiyesi (firmanın hesabı ve parası); Paraşüt eşitlemesi (hesap başına, ortak hesap "hesap
geneli"); hammadde fiyatı, menü, reçete, tedarikçi kütüğü (ortak veri); su + buz litre fiyatı (tek fatura, döküm şube
şube); silme engelleri (bütünlük, veri olarak görünmez); Tükendi, uygulama siparişleri, masa çağrıları (site şubeyi
göndermiyor: "Bütün şubeler"); firmaya giden sabah ve haftalık e-postası, aylık muhasebeci paketi e-postası (alıcı firma);
Tutarlılık bulguları (şube sütunu yok). Kaçak raporu şimdilik yalnız Marina'nın (tahmini stok; öbür şubede "Bu şube için
tahmini stok yok"). Hesabım'daki liste `ALWAYS_COMPANY_WIDE`. Ekranda nasıl söylendiği (parça 6): Siparişler'in kartları
(Uygulama siparişleri, Masa çağrıları, Tükenenler) tek şube seçili ve birden çok şube açıkken **Bütün şubeler** rozetiyle
(`siteWideBadge`); dışa aktarımın şube dosyasında Bulgular ve Alım Miktarları "Firma geneli", Vergi sekmesi "Firma geneli ·
beyan" yazar; Bildirim ayarları'nın haftalık özet önizlemesi "firmaya giden e-posta" notunu, Muhasebeci paketi kartı
"aylık e-posta bütün şubeler" açıklamasını taşır.

### Kayıt ve denetim

Seçimi bilerek aşan her okuma kayıtlıdır: `COMPANY_WIDE_READS` (`src/lib/branch-view.ts`; kimlik, `dosya#işlev`, tür,
gerekçe) ve okumanın üstünde `// şube-ayrımı: <kimlik>` işareti. Türler: `yalniz-firma`, `alan` (yalnız `areaScope`
çağrısında, alanıyla), `butunluk`, `ortak-veri`, `sozlesme`, `hesap`, `gecici`, `yazim` (okuma değil, kaydın işletme geneli
hedefi). Parça 1–5'in `bekliyor` türü (sonraki parçanın kapatacağı okuma) parça 6'da bitti; tür kalktı. Son hâl:

| Tür | Kayıtlar |
|---|---|
| `yalniz-firma` | `eposta.firma` (sabah ve haftalık e-postası, önizlemenin okuması, komisyon kutusu), `muhasebe.paket-eposta` (aylık paket e-postası), `nakit.bakiye` (açılış bakiyesi), `vergi.beyan` (beyan ve takvim; Vergi ekranları, nakit planı, dışa aktarımın Vergi sekmesi) |
| `alan` | `alan.odemeler`, `alan.nakit`, `alan.vergi`, `alan.tutarlilik`, `alan.mutabakat`, `alan.tedarikciler`, `alan.stok_degeri`, `alan.komisyon`, `alan.karsilastirma`: her `areaScope` çağrısı. İşletme geneli giderler okumayı değiştirmez (veri kümesinin bayrağı `sharedCostsHidden`), kaydı yok |
| `butunluk` | `costs.dataMonths` (silme engeli) |
| `ortak-veri` | `dataset.companyMonths` (işletmenin günü), `dataset.companyWaterSales` (su + buz litresi), `komisyon.oran` (komisyon oranı ve hakediş) |
| `yazim` | `asistan.isletme-geneli` (asistanın işletme geneli yazımı) |

Tam yedek (`api/yedek`), ekstre, Paraşüt eşitlemesi, Tükendi ve sipariş okumaları seçimi hiç okumaz (`withBranchScope`
ya da `areaScope` yok), bu yüzden kayıtta değil; Hesabım'daki **Her zaman firma geneli** listesindedir.
`tests/sube-ayrimi.test.ts`:

- (a) `src/` altında (saf `src/lib` hariç) her `withBranchScope(ALL_BRANCHES`, `scope: ALL_BRANCHES`, kapsamsız
  `loadUpcoming()` / `unlinkedProducts(n)` / `countUnlinkedProducts()` ve `areaScope(…)` çağrısının üstünde kayıtlı bir işaret;
  her kimlik en az bir yerde kullanılır ve `where` dosyasında işareti durur (eskimiş kayıt kalmaz).
- (b) Şubesi olan tabloların (`cashReports`, `invoices`, `reminders` …) `src/server/{data,bell,notify,ai,mcp,assistant-reads}`
  ve panel sayfalarındaki her `.from(s.X)` ifadesi kapsamla okur (`branchWhere`, `invoiceScopeWhere`, `requestInScope` …)
  ya da işaretlidir. Bugün kalanlar `BEKLEYEN_B`'de (dosya başına sayı; parça 1'de 104 ifade, parça 2'den sonra 97,
  parça 3'ten sonra 93, parça 4'ten sonra 91, parça 6'dan sonra 89, doğrulama düzeltmelerinden sonra 88): sayı yalnız
  azalır. Kalanların çoğu kaydın
  kimliğiyle açılan ya da şubesi zaten satırda olan okumalardır (kasa raporu, istek, karaoke); ekranın listesi değil.
  Parça 3'ten beri dört tablonun da şube sütunu var (`BEKLEYEN_KOLON` boş).
- (c) Alanın ekranı çipini çizer (`<BranchViewChip area="…">`); "bu ekran firma geneli" notu yalnız hep firma geneli
  ekranlarda. Parça 6'dan beri bekleyen alan yok (`BEKLEYEN_ALANLAR` boş) ve not hiçbir ekranda çizilmez.
- (d) Saf kurallar: yöneticinin varsayılanı her alanda şube, kilitli hesap her alanda şube, tanınmayan tercih düşer.

Veritabanında: `tests/sube-gorunumu-db.test.ts` (yazım yalnız kendi satırına, birleşerek; muhasebecinin alanları; müdür ve
personel reddedilir; müdürde firma yazılı olsa da her alan şubesi ve okuma şubesine daralır). Saf kurallar ve ekran:
`tests/sube-gorunumu.test.ts`.

### Ayarsız sızıntılar (parça 2)

Ayarı olmayan, bilerek de firma geneli olmayan okumalar: şube seçiliyken başka şubenin kaydını gösteriyorlardı. Hepsi artık
seçimle okur ("Tümü"de değişen bir şey yok). Kural: şubesi bilinen kayıt yalnız kendi şubesinde, şubesi bilinmeyen kayıt
(şubesiz hesabın önerisi, şubesi çözülemeyen istek) her şubede görünür, işletme geneli fatura her şubede.

| Yer | Şube seçiliyken (önce → şimdi) |
|---|---|
| **Bugün** ve **zil**: kontrol bekleyen fatura, mal alışı sayılmayan fatura, Paraşüt'ten son 24 saatte gelen fatura, bağlanacak ürün | Bütün faturalar → şubenin ve işletme genelinin faturaları (`invoiceScopeWhere`; `countStockOnlyReview(db, kapsam)`, `countUnlinkedProducts(kapsam)`). Şubesi seçilmemiş fatura yalnız "Tümü"de sayılır (Faturalar'ın kuralı) |
| **Zil**: "Paraşüt eşitlemesi başarısız" | Bütün hesapların son çalışması → şubenin Paraşüt hesabının (`latestParasutRun(db, [hesap])`); hesap başka şubeyle ortaksa başlık "(hesap geneli)" der |
| **Zil**: ModPOS anahtarının uyarısı | Bütün şubelerin anahtarı → şubeninki (`modposKeyBell(kapsam)`) |
| **Bugün** › Onaylar, **zil**, **Onaylar**, **Reçete defteri**: reçete önerileri | İşletme geneli → önerenin hesabının şubesi (`proposerScopeWhere`): o şubenin personelinin ve şubesiz hesapların önerileri. Onaylar'ın "öbür şubelerde N istek daha" sayısı öbür şubelerin önerilerini de sayar |
| **Bugün** › Onaylar: personel istekleri | Bütün şubelerinki sayılıyordu (Onaylar'ın kartları zaten şubenindi) → şubenin (`pendingByKindInScope`) |
| **Onaylar** › Son kararlar | Bütün şubeler → şubenin istekleri (`requestsInScope`) |
| **Onaylar** › geç rapor kartının "Kasayı sayan"ı | Bütün kullanıcılar → kartın kasasını sayabilecekler (`cashCounters(şube)`, kasa formu gibi) |
| **Hatırlatıcılarım** › Kime | Bütün kullanıcılar → şubenin ve şubesiz hesaplar (`assignablePeople(ben, kapsam)`) |
| **Teslim defteri**'nin ay seçicisi | Bütün şubelerin ilk teslimi → şubenin (`handoverFirstDate`) |
| **Kontrol listeleri** › Listeleri düzenle | Bütün listeler → şubenin ve bütün şubelerin listeleri (`scoped: true`) |
| **Genel bakış** ve **Gelir-gider**'in ay bilgisi: "onay bekliyor" günleri | Bütün şubelerin bekleyen geç raporu → şubenin; "Tümü"de her şube kendi bekleyen günleriyle (`pendingLateDays`) |
| **Paraşüt**: e-faturadan okunan kalemlerin sayısı, elle girilmiş eksi faturalar | Hesabın bütün faturaları → şubenin ve işletme genelinin. Panel asistanının "Paraşüt bekleyenleri" ve "AI ile öner" de Paraşüt ekranının listesini okur (kapsamla) |
| **Panel asistanı**: AsilPOS durumu | Tuzla seçiliyken Marina'nın AsilPOS'u anlatılıyordu → "Bu şubede AsilPOS yok: Tuzla kasası ModPOS"; yanıt okunan şubenin adını taşır |
| **Panel asistanı**: tahmini stok | Tuzla seçiliyken uyarıyla Marina'nın stoğu → "Bu şube için tahmini stok yok" |
| **Panel asistanı**: gün sonu, günlük satış, vardiya (şube adı verilmezse) | Online kanal seçiliyken bütün şubeler → "Panelde laffogato.net (online kanal) seçili: … şubenin adını verin" |
| **Kayıp önleme** | Soldaki seçimden bağımsız, firmanın modeliyle → seçili şubenin kasa raporu, kör sayım, zayi, AsilPOS günü, vardiya ve personeli, görünümün modeli; online kanalda "Bu kanalın kasası ve stoğu yok". "Bu ekran firma geneli" notu kalktı |
| **Kaçak raporu** | Hep Marina'nın → Marina ya da "Tümü" seçiliyken; öbür şubede "Bu şube için tahmini stok yok" |
| **Gelir-gider**: "Faturası beklenen alımlar" bilgi satırı | Firmanın cari kayıtları → şube seçiliyken satır yok (cari kaydının şubesi yok; `supplier_entries.branch_id` gelene kadar) |
| **Sabit giderler** › Tek seferlik yatırımlar | Not yoktu → "Firma geneli" rozeti ve açıklaması; parça 3'ten beri yatırımın şubesi var ([aşağıda](#şube-sütunu-gelen-tablolar-parça-3)) |

**Online kanal** (laffogato.net) seçiliyken kanalın kasası, stoğu ve vardiyası yok (`selectedChannel`, metin
`CHANNEL_NO_TILL`): Bugün kasa, sayım ve zayi satırları yerine tek satır "Bu kanalın kasası ve stoğu yok" (iki rolde,
"Tümü'nü göster"); zilde kasa satırı ve vardiya hatırlatması yok; Kasaya işle ve Kasadaki fiyatlar boş liste ve aynı
metin (`loadTillScopes` boş). Önceden kanal seçiliyken Tuzla'nın kasası (ya da bütün şubelerin vardiyası) görünüyordu.
Kasa sayfasının formu kanalda yine Tuzla'yı açar (yazma kuralı, [Yazarken hangi şube](#yazarken-hangi-şube)).

Kayıttan üç `bekliyor` satırı düştü (eşlenmemiş Paraşüt ürünleri, kanalda kasa zili, kayıp önleme): okumaları artık
seçimle. Testler: `tests/sube-ayrimi-sizinti.test.ts` (saf kurallar ve kaynağın biçimi),
`tests/sube-ayrimi-sizinti-db.test.ts` (gerçek Postgres: Tuzla'nın "IZ-TUZLA" işaretli kayıtları Marina seçiliyken
Bugün, zil, Onaylar, Paraşüt listesi, kişi seçicisi, teslim defteri ve raporlarda görünmez; "Tümü"de görünür).

### Şube sütunu gelen tablolar (parça 3)

Dört tablonun şubesi yoktu; şube seçiliyken öbür şubenin kaydını gösteriyor ya da kaydı hiçbir şubeye bağlayamıyordu.
Migration `0101_sube_ayrimi_kolonlar` sütunları ekler (production'da `npm run build` sırasında, eski sürüm hizmet verirken
çalışır; eski sürümün yazdığı satır da doğru kalır).

| Tablo | Şube | Eski kayıtlar | Okuyanlar (şube seçiliyken) |
|---|---|---|---|
| `checklist_runs` (kontrol listesinin günlük kaydı) | Şubeli listede listenin şubesi; **bütün şubelerin listesinde dolduranın şubesi**: her şube listeyi kendi kaydına doldurur (tekil anahtar şablon, gün, şube, sıra). Zorunlu | Listenin şubesi; yoksa listeyi tamamlayanın, o da yoksa ilk yanıtlayanın (fiziksel) şubesi; o da yoksa Tuzla | Bugün, zil, Kontrol listeleri, Geçmiş, aylık PDF, personel e-postası, sabah e-postasının kutusu, kapalı gün kanıtı: yalnız o şubenin kaydı |
| `activity_log` (işlem geçmişi) | Yazımın şubesi: formun ya da kaydın şubesi (kasa raporu, zayi, özel gün, şube ayarı, AsilPOS, kör sayım, karaoke), yoksa seçili şube; "Tümü"de, sistemde ve işletme geneli kayıtta boş | Boş (hangi şubede yapıldığı bilinmiyor) | Ayarlar › İşlem geçmişi, zilin kapalı gün ve özel gün satırları, sayımın geç kayıt uyarısı: şubenin ve şubesiz kayıtlar |
| `notification_log` (gönderim günlüğü) | Gün sonu e-postası, AsilPOS gün sonu (çalışan, Pavo, fotoğraf), vardiya hatırlatması ve tek şubeye bağlı alıcının düşen sabah e-postası şubesiyle; işletme geneli e-postalar boş | Boş | Ödemeler › Son gönderimler: şubenin ve şubesiz kayıtlar |
| `investments` (tek seferlik yatırım) | Formda seçilen şube ya da **İşletme geneli** (boş; yeni yatırım seçili şubeyle, "Tümü"de işletme geneliyle başlar) | Boş = işletme geneli | Sabit giderler › Tek seferlik yatırımlar ve dışa aktarımın Sabit Giderler sekmesi: şubenin ve işletme genelinin; **toplam yalnız şubenin**, işletme geneli bilgi olarak ayrıca (sahibin kararı 4) |

**Kontrol listesi şube başına** (docs/KONTROL-LISTELERI.md › Şubeler): bütün şubelerin listesi (şablonun şubesi boş)
tek şube seçiliyken o şubenin satırıdır ve yalnız o şubenin kaydını okur; "Tümü"de her açık fiziksel şubenin ayrı satırı
olur, birden çok şube açıkken ad şubeyle başlar ("Marina · Kapanış"); online kanal seçiliyken yoktur. Satırın anahtarı
ve bağlantısı şubeyi taşır (`checklistKey` → `liste-9-marina`, `checklistHref` → `/panel/kontrol/9?sube=marina`; seçici
`?sube=`'yi çereze benimsetir). Doldurma ekranı kaydın şubesini her yanıtla ve fotoğrafla gönderir; sunucu onu
`formBranch(…, "checklist")` kuralıyla doğrular (etkin fiziksel şube, kilitli personelde kendi şubesi). "Tümü"de birden
çok şube açıkken şube gelmezse ekran **"Hangi şubenin listesi?"** diye sorar, yazım reddedilir: sessizce Tuzla'ya inmez.
Şubeli listenin kaydı hep listenin şubesindedir (veritabanında da: `checklist_runs_branch_fill` tetikleyicisi şubeyi
yazmayan eski sürümün kaydını listenin şubesine, şubesiz listede Tuzla'ya indirir). Fotoğrafı kim görür, kapalı gün
kanıtı ve personel e-postasının alıcısı kaydın şubesinden: Marina'da doldurulan ortak liste Marina'nın kanıtıdır
(önceden "şubesi belli olmayan iz" uyarısıydı), e-postası Marina'nın vardiyasına gider (anahtar `kontrol-eposta:9@marina:…`).
Bilinen sınır: liste sonradan başka şubeye bağlanırsa eski kayıtları doldurulduğu şubede kalır; Geçmiş ve aylık PDF
listeyi yalnız yeni şubesinin kayıtlarıyla gösterir (eski kayıt silinmez, kapalı gün kanıtında kendi şubesinde sayılır).

**Şube silme**: kontrol listesi kaydı ve yatırım şubeyi silmeye engeldir (`branchUsageCount`); işlem geçmişi ve gönderim
günlüğü değildir: şube silinince şubeleri boşalır.

Kayıttan `BEKLEYEN_KOLON` boşaldı; kapsamsız okuma 97 → 93 (Ayarlar, Sabit giderler, sayım uyarısı, Son gönderimler).
Testler: `tests/sube-ayrimi-kolonlar.test.ts` (saf kurallar, kaynağın biçimi, migration),
`tests/sube-ayrimi-kolonlar-db.test.ts` (gerçek Postgres: iki şubenin ayrı kaydı, Tümü'de yan yana satırlar, şubesiz yazımın
reddi, tetikleyici, geri doldurma, işlem geçmişi ve gönderim günlüğünün şubesi, yatırımlar; Tuzla'nın "IZ-TUZLA"
işaretli kayıtları Marina seçiliyken görünmez).

### Alanlar: Ödemeler, Nakit planı, Tedarikçiler, Komisyon (parça 4)

Dört alan kişinin şube görünümüyle okur (`areaScope`); ekranlarında görünüm çipi var, "bu ekran firma geneli" notu kalktı.
"Tümü"de ve **Firma geneli** kipinde her şey bugünkü gibi; aşağıdakiler tek şube seçili ve **Yalnız şube** kipindeyken.
Müdür ve şubesine kilitli personel hep şube kipindedir (tercih okunmaz).

| Alan | Yalnız şube kipinde | İşletme geneli (firmanın, ayrı satırda) |
|---|---|---|
| **Ödemeler ve faturalar** (`odemeler`): Ödemeler, Bugün, zil, Genel bakış'ın "Yaklaşan ödemeler" kartı ve gecikme satırı, bağlantının `odemeler` aracı | Şubenin ve işletme genelinin hatırlatıcıları ve faturaları (`invoiceInScope`). Şubesi seçilmemiş faturalar listede değil: "N faturanın şubesi seçilmemiş · tutar" uyarısı Faturalar'a götürür. Son ödenenler şubenin ve işletme genelinin faturaları ve hatırlatıcıları (`loadRecentPaid(kapsam)`), Son gönderimler ve bildirim adresleri şubenin ve bütün şubelerin (`loadRecipientsInScope`). Zilin kapalı aya düşen kayıtları şubenin (`heldCounts(db, kapsam)`) | Faturasız borç (cari): katlı **İşletme geneli** bölümü ("İşletme geneli · 2 faturasız borç · tutar"); şubenin listesine ve toplamlarına girmez. Genel bakış'ın cari uyarıları (faturası gelmeyen alım) yalnız firma kipinde ve "Tümü"de |
| **Nakit planı** (`nakit`): ekran, Genel bakış'ın kartı, `odemeler` aracının nakit planı | **Şubenin nakit akışı** (`loadAreaCashPlan`): şubenin satış tahmini ve kasa devri; şubenin hatırlatıcıları, şubeye seçilmiş faturaları, personelinin maaşı, şubenin kendi sabit giderleri ve mal tahmini. Açılış bakiyesi yok: hafta satırı "Net akış" yazar, karo "Net akış" | Her haftanın **İşletme geneli** satırı (firmanın planından: KDV, vergi, damga, SGK, işletme geneli hatırlatıcı ve fatura, faturasız borç; en büyük üç kalemiyle), şubenin akışına girmez. "Elinizdeki para · Firma geneli" karosu firmanın bakiyesini bilgi olarak yazar (`nakit.bakiye`). Şubesi seçilmemiş fatura hiçbir şubenin akışında yok |
| **Tedarikçi bakiyeleri** (`tedarikciler`): Tedarikçiler, tedarikçinin sayfası, `tedarikci_ozeti`, ödeme talebi | Kalan borç, vade, 7 gün ve Bu ay ödenen şubenin ve işletme genelinin faturalarıyla (faturanın kalanı ona sayılan ödemeler düşülmüş); ödemeler: şubenin kasasından yapılanın tamamı, öbür ödemenin şubenin faturalarına sayılan kısmı (`branchAccountOf`, src/lib/cari/branch-account.ts). Kapsamda hiçbir şeyi olmayan tedarikçi listede yok (sayfası adresiyle açılır). Ödeme talebi "Ödeme talebi · L'Affogato · Marina" başlar, faturasız alım ve hesaptaki para talebe girmez | Faturasız borç ve hesaptaki (hiçbir kaleme sayılmamış) para: listenin ve sayfanın üstündeki **İşletme geneli** satırı. Şube bakiyeleri + işletme geneli = tedarikçinin carisi ("Tümü"de; şubesi seçilmemiş faturalar yalnız orada). Cari hareketleri, ekstre ve bağlama pencereleri firmanın tek hesabıyla çalışır |
| **Komisyon ve hakediş** (`komisyon`): ekran, zil, Bugün'ün Hakedişler satırı | Ana görünüm şubenin payı (şube satışı × işletmenin oranı) ve **şubenin o ay satışı olan kanalların** bekleyen hakedişi (`scopeCommissionReport`: kanalın kendi satışı ya da grubun Z'si). Zil ve Bugün aynı süzgeçle: öbür şubenin kullandığı kanalın gecikmesi bu şubede görünmez | İşletmenin raporu (komisyon faturaları, oranlar, bütün kanalların kartları, kanalı bulunamayan faturalar) katlı **İşletmenin raporu** bölümünde. Oran ve hakediş tutarı hep işletmenin (`komisyon.oran`). Sabah e-postasının kutusu firmanın (`eposta.firma`) |

**Sabah e-postası**: şubeye bağlı alıcı grubu artık yalnız kendi şubesine seçilmiş faturaları alır (işletme geneli ve
şubesi seçilmemiş fatura her gruba; `digestItemBranch`); firmaya giden e-posta değişmedi.

**Bağlantı ve panel asistanı**: `odemeler` ve `tedarikci_ozeti` isteğe bağlı `gorunum` alır; şube kipinde cevapta
`isletmeGeneli` (faturasız borç, şubesi seçilmemiş faturalar, nakit planının işletme geneli toplamı; tedarikçide faturasız
borç ve hesaptaki ödeme). Panel asistanında isteğe bağlı alanlar yapılandırılmış girdinin sınırını (24) aştığı için
`tedarikci_ozeti` strict'siz gider (girdisi yine doğrulanır).

Kayıt: `alan.odemeler`, `alan.nakit`, `alan.tedarikciler`, `alan.komisyon` (her `areaScope` çağrısı), `nakit.bakiye`
(yalnız firma), `komisyon.oran` (ortak veri); bekleyen `nakit.*` ve `komisyon.*` kayıtları kapandı. Kapsamsız okuma
93 → 91 (Ödemeler sayfası). Testler: `tests/sube-ayrimi-alanlar.test.ts` (saf kurallar ve kaynağın biçimi),
`tests/sube-ayrimi-alanlar-db.test.ts` (gerçek Postgres: Tuzla'nın "IZ-TUZLA" işaretli faturası, hatırlatıcısı, kasa
raporu ve ödemesi Marina'nın şube kipinde Ödemeler'de, nakit planında, tedarikçi bakiyelerinde, bağlantının iki aracında
ve komisyonun hakedişinde görünmez; firma kipinde görünür; müdürde firma tercihi yazılı olsa da görünmez).

### Alanlar: Vergi, Tutarlılık, Mutabakat, Stok değeri (parça 5)

Dört alan daha kişinin şube görünümüyle okur (`areaScope`); ekranlarında görünüm çipi var, "bu ekran firma geneli" notu
kalktı (Vergi'nin üç sekmesi, Tutarlılık, Mutabakat'ın iki sekmesi, Stok sayımı). "Tümü"de ve **Firma geneli** kipinde
her şey bugünkü gibi; aşağıdakiler tek şube seçili ve **Yalnız şube** kipindeyken. Müdür ve şubesine kilitli hesap hep
şube kipindedir. Tek şube açıkken alanın kipi anlamsızdır (kart ve çip yok): `areaScope` "Tümü" döner; yazdığı şubeyle
açılan ekran (stok sayımı) şubesi seçilmemiş faturayı da görmeye devam eder.

| Alan | Yalnız şube kipinde | Her kipte firmanın |
|---|---|---|
| **Vergi** (`vergi`): Özet, Vergi kârı, Demirbaş | Özet'te **Şubenin payı (bilgi)** kartı (`branchTaxShare`, src/lib/tax/branch-share.ts): yılın bugüne kadarki satış KDV'si (şubenin kasası), şubeye seçilmiş faturaların KDV'si, KDV farkı, şube personelinin SGK'sı ve gelir ve damga vergisi stopajı, şubenin faturalarına bağlı demirbaşların amortismanı. Vergi kârı'nda çeyreğin **matraha katkı (bilgi)** kartı (`branchContribution`): şubenin geliri (şubenin Z'si ya da kasası), şubenin faturaları, sabit giderleri ve harcamaları, amortismanı; işletme geneli gider, Gelir-gider'e elle yazılan hücreler, muhasebecinin kayıtları ve düzeltmeler dahil değil. Eksik belgeler ve Demirbaş şubenin ve işletme genelinin faturalarıyla (`scopeClassify`, `scopeAssets`); öbür şubenin ve şubesi seçilmemişin kalemi sayı olarak | Beyan tutarları (KDV, muhtasar, geçici ve kurumlar vergisi, devreden KDV) ve takvim: firmanın tek vergi numarasıyla, her kipte bütün şubeler (`vergi.beyan`). Sayfanın başındaki "gider vergi hesabına girmedi" uyarısı firmanın ("· firma geneli") |
| **Tutarlılık** (`tutarlilik`) | Şubenin satışı ve Z'si, reçete kullanımı, sayımı, zayisi; bekleyen zayi istekleri şubenin (`pendingWasteSummary({ month, scope })`). **Alınan** yalnız şubeye seçilmiş faturalardan (`queryBranchPurchases`; eşitlemenin kuralıyla, çarpanı şüpheli kalem ayrı); "N şubesiz fatura, M elle alım dahil değil" notu. Alım tablosu bu kipte salt okunur (elle alım firmanın) | Bulgular (şube sütunu yok): "Firma geneli" rozetiyle |
| **Mutabakat** (`mutabakat`) | Eşleşme firmanın bütün kayıtlarıyla yapılır, sonuç değişmez; gösterim ayrılır (src/lib/mutabakat/branch.ts): şubenin kaydıyla eşleşen hareketler üstte, eşleşmeyen, işletme genelinin ve öbür şubenin kaydıyla eşleşenler **İşletme geneli** grubunda (öbür şubenin kaydı adsız: "Öbür şubenin kaydı"). "Panelde var, ekstrede yok" yalnız şubenin kayıtları. POS hakedişinde şubenin kart satışı ve beklenen neti (kart × şubenin oranı), günün durumu firmanın; öbür şubenin satışı ve oranı görünmez | Ekstrenin kendisi, bankaya gelen POS parası (terminal → şube eşlemesi yok), elle eşleştirme penceresinin kayıtları (eylem firmanın havuzuyla) |
| **Stok değeri** (`stok_degeri`): Stok sayımı tutarı, Ayarlar › Stok değerleme önizlemesi | FIFO havuzu şubenin ve işletme genelinin faturaları (`loadPurchaseLots(kapsam)`, veri kümesi alanın kipiyle); havuzun karşılamadığı ay sonu fiyatıyla, pay düşükse (%50'nin altı) sayım kartı uyarır. Sayımın devri şubenin kendi geçen ayki sayımı. Personelin yeni ek kaleminin fiyatı önce şubenin geçmişinden. Ayarlar'ın önizlemesi şubenin sayımları ve havuzuyla | Yöntem ve başlangıç ayı (ayar firmanın) |

**Seçimle okunanlar** (ayarı yok; "Tümü"de değişmedi):

| Yer | Şube seçiliyken |
|---|---|
| Tahmini stok › Marina'ya gelen faturalar | Marina'nın ve şubesi seçilmemiş faturalar; öbür şubenin ve işletme genelinin faturası "N fatura başka şubede, M fatura işletme geneli" (`receiptsInScope`) |
| Hammaddeler › Onay bekleyen fiyatlar, zil, Bugün, Genel bakış | Önerinin şubesi faturasının şubesi (`holdInScope`): şubenin ve şubesi boş faturanın önerisi; öbür şubenin önerisi "Öbür şubelerde N öneri daha". Onay ve red hammaddenin ortak fiyatını değiştirir. Firmaya giden sabah e-postası bütün öneriler; şubeye bağlı alıcıların e-postası aynı kuralla ([Doğrulama düzeltmeleri](#doğrulama-düzeltmeleri-27-kasım-2026)) |
| Hammadde penceresi › Tedarikçilere göre fiyat | Şubenin ve işletme genelinin faturaları; öbürü sayı olarak. Reçetedeki fiyat ortak |
| Hammaddeler › Su + buz birim maliyeti | Litre fiyatı firmanın (tek fatura ÷ bütün şubelerin litresi); döküm şubenin litresi malzeme malzeme ve "Öbür şubeler ve online" tek satır |
| Ürünler, ürün kartı | Siteye bağlı ürünün şubede geçerli kendi fiyatı varsa birim kâr, maliyet oranı ve durum o fiyatla; kutudaki fiyat **Taban fiyat** (bütün şubelerin menüsü, düzenlenen) (src/lib/prices/branch-view.ts) |

Kayıt: `alan.vergi`, `alan.tutarlilik`, `alan.mutabakat`, `alan.stok_degeri` (her `areaScope` çağrısı), `vergi.beyan`
(yalnız firma); bekleyen `vergi.sayfa`, `tutarlilik.sayfa`, `stok-degeri.ayarlar` kapandı; çipi bekleyen alanlardan dördü
daha düştü (kalan: Şubeleri yan yana, İşletme geneli giderler). Testler: `tests/sube-ayrimi-alanlar-5.test.ts` (saf kurallar
ve kaynağın biçimi), `tests/sube-ayrimi-alanlar-5-db.test.ts` (gerçek Postgres: Tuzla'nın "IZ-TUZLA" işaretli faturası,
personeli, demirbaşı, kasa raporu, harcaması ve fiyat önerisi Marina'nın şube kipinde şubenin payında, alınan miktarda,
FIFO havuzunda, mutabakatın ayrımında, POS'un şube kipinde, önerilerde, tedarikçi fiyatlarında ve tahmini stoğun
faturalarında görünmez; firma kipinde ve "Tümü"de görünür; müdürde firma tercihi yazılı olsa da görünmez).

### Alanlar: Şubeleri yan yana, İşletme geneli giderler, dışa aktarım (parça 6)

Son iki alan ekranlarına bağlandı; dışa aktarım, muhasebeci paketi ve e-posta önizlemeleri de kişinin şube görünümüyle.
"Tümü"de her şey bugünkü gibi; aşağıdakiler tek şube seçiliyken. Müdür ve şubesine kilitli hesap hep şube kipindedir
(tercih okunmaz; okumanın kilidi ayrıca `currentBranchScope`'ta).

| Alan | Yalnız seçili şube / Yalnız not (yöneticinin varsayılanı) | Yan yana / Tutarla göster |
|---|---|---|
| **Şubeleri yan yana** (`karsilastirma`): Şube karşılaştırma, İşçilik / ciro, Bugün'ün "Şubelerde gün" kartı | Yalnız seçili şubenin sütunu ve satırı; kasa raporları, AsilPOS gün sonları ve ModPOS föyü alanın kapsamıyla (`areaScope("karsilastirma")`, `compareBranchesIn`). "Tek şube açık" notu çıkmaz, İşçilik'te şubelerin toplamı satırı yok. Online kanal seçiliyse rapor boş: "laffogato.net seçili: kanalın kasası yok" (`compareEmptyText`) | Bütün açık fiziksel şubeler yan yana (bugünkü gibi) |
| **İşletme geneli giderler** (`ortak_gider`): Gelir-gider, Genel bakış (sabit gider dökümü, başabaş ipucu), Aylık harcamalar, Sabit giderler | Tutar yok, yalnız not: "İşletme geneli giderler bu şubenin kârına girmez (Tümü'de sayılır)" (`SHARED_COSTS_NOTE`). Veri kümesi bayrağı taşır (`Dataset.sharedCostsHidden`): Gelir-gider'de "İşletme geneli payı (bilgi)" satırı yok, `PnlMonthCalc.shared` boş ve `hidden`; Sabit giderler'de işletme geneli kalem listede, toplamda ve özetin tutarında yok (veri kümesine gelmez), işletme geneli yatırım listede yok; Aylık harcamalar'da şubesiz kayıt ve işletme geneli fatura listede ve tutarda yok ("+ işletme geneli (Tümü'de)" ve not; "girilmedi" uyarısı çıkmaz) | Bugünkü "İşletme geneli payı (bilgi)" satırı ve tutarları (Faz 5) |

**Şubenin kârı iki kipte aynıdır**: işletme geneli zaten şubenin kârına girmiyordu (sahibin kararı 4); kip yalnız bilgi
tutarını gösterir ya da gizler. Bu yüzden İşletme geneli giderler okumayı değiştirmez, kaydında `areaScope` yoktur:
`readDataset` `currentBranchView("ortak_gider")` okur ve "Yalnız not"ta işletme geneli sabit gider kalemini görünüme
almaz; elle yazılan hücreler (su faturası litre fiyatına girer) ve işletme geneli faturalar (mal alımı bilgisi, vergi)
okunmaya devam eder, motor yalnız tutarlarını yazmaz (`sharedHidden`). Muhasebecinin varsayılanı "Tutarla göster".

**Dışa aktarım** (Genel bakış'ın ve Ayarlar'ın **Dışa aktar** düğmesi; şube seçiliyken `?sube=`, Ayarlar'da yanında
**Bütün şubeler**): satış, kasa, personel ve şubenin giderleri dosyanın şubesinin; öbür sekmeler alanlarının kipiyle
(src/app/api/export/route.ts):

| Sekme | Şube kipinde | Firma kipinde |
|---|---|---|
| Tutarlılık (Tutarlılık) | Şubenin satışı ve sayımı; alınan yalnız şubeye seçilmiş faturalardan, notuyla ("Tutarlılık kontrolü – Eylül 2026 · Marina") | Bütün şubelerin modeli ("· Firma geneli") |
| Cari hareketleri (Tedarikçi bakiyeleri) | Faturasız borç "· İşletme geneli" yazısıyla; ödemelerden şubenin kasasından yapılanın tamamı, öbürünün şubenin faturalarına sayılan kısmı; öbür şubenin faturası adıyla yazılmaz (`loadCariExport(kapsam)`, `branchPayments`) | Firmanın bütün hareketleri |
| Vergi (Vergi) | Beyan firmanın ("Firma geneli · beyan"), altında "6. Marina · Şubenin payı (bilgi)" (`loadBranchTaxView`) | Yalnız beyan |
| Sabit Giderler | İşletme geneli giderler "Yalnız not"ta işletme geneli kalem ve yatırım yok | "İşletme geneli" bilgi satırlarıyla |
| Stok değeri (sayım tutarı) | Stok değeri alanının kipiyle (veri kümesi, parça 5) | |
| Bulgular, Alım Miktarları | Her dosyada firmanın: "Firma geneli (bulgunun şubesi yok)", sütun notu | |

Kapağın Kapsam satırı kipleri yazar (`exportScopeText`). Dosya adı şubeyle biter.

**Muhasebeci paketi**: elle indirme şube seçiliyken o şubenin paketi (`?sube=`; şubenin kasa raporları ve yazarkasa KDV
dökümü, şubeye seçilmiş faturalar, şubenin harcamaları ve sabit giderleri; işletme geneli olanlar İşletme geneli giderler
kipiyle), yanında **Bütün şubeler**. Aylık e-posta ve "Şimdi gönder" her zaman bütün şubeler (`muhasebe.paket-eposta`;
[MUHASEBE-PAKETI.md](MUHASEBE-PAKETI.md)).

**E-posta önizlemeleri**: sabah e-postasının önizlemesi birden çok kasa açıkken şube seçiliyse o şubeye bağlı alıcıların
e-postası (gönderimin şube grubu: şubenin ve işletme genelinin ödemeleri, şubenin kutuları ve kasadan faturalı alımları;
`digestPreviewGroup`, `groupDigestInvoices`); pencere hangi grup olduğunu yazar. Haftalık özetin şube grubu yok: önizleme
"firmaya giden e-posta" notunu yazar ([BILDIRIMLER.md](BILDIRIMLER.md), [HAFTALIK-OZET.md](HAFTALIK-OZET.md)).

**Siparişler**: site siparişin, masa çağrısının ve Tükendi'nin şubesini göndermiyor; tek şube seçili ve birden çok şube
açıkken üç kart **Bütün şubeler** rozetini taşır (sözleşme değişene kadar).

Kayıt: `alan.karsilastirma` (üç yükleyici), `alan.vergi`, `alan.tutarlilik`, `alan.tedarikciler` ve `vergi.beyan`
dışa aktarımla; `muhasebe.paket-eposta` yalnız e-postanın üstünde; bekleyen beş kayıt (`karsilastirma.*`,
`vergi.disa-aktar`, `tedarikciler.disa-aktar`) kapandı. Kapsamsız okuma 91 → 89 (Bugün'ün kartı). "Raporlar" ekranının
firma geneli notu kalktı (`CompanyWideScreen`'den düştü). Testler: `tests/sube-ayrimi-alanlar-6.test.ts` (saf kurallar,
motorun "Yalnız not" kipi, dışa aktarımın sekmeleri, kaynağın biçimi), `tests/sube-ayrimi-alanlar-6-db.test.ts` (gerçek
Postgres: Tuzla'nın "IZ-TUZLA" işaretli kasa raporu, personeli, faturası ve ödemesi ile "IZ-ORTAK" işletme geneli kalem
Marina'nın varsayılan kiplerinde karşılaştırmada, işçilikte, Bugün'ün kartında, dışa aktarımda, muhasebeci paketinde ve
sabah e-postasının önizlemesinde görünmez; firma kipinde ve "Tümü"de görünür; müdürde firma tercihi yazılı olsa da
görünmez), `tests/isletme-geneli-db.test.ts` (iki kipte kâr aynı).

**Sahibin kararı bekleyen** (değişmedi): İşletme geneli giderler için "Ciroya göre pay et" kipi.

### Doğrulama düzeltmeleri (27 Kasım 2026)

Altı parçadan sonra bağımsız bir doğrulama (`tests/sube-ayrimi-db.test.ts`) şube sütunu olan her tabloya Marina'nın ve
Tuzla'nın ayrı kaydını yazdı ("TZMARK" işaretli, tutarları 91.9xx) ve Marina seçiliyken yaklaşık 80 ekran yükleyicisini,
zili, panel asistanını, bağlantıyı (MCP), dışa aktarımı, muhasebeci paketini ve sabah e-postasının önizlemesini okudu;
sonra Tuzla'nın satırlarını silip Marina'nın görünümünü yeniden okudu (fark varsa Tuzla'nın verisi Marina'nın ekranını
etkiliyor). Bulduğu sekiz sızıntı kapandı ("Tümü"de değişen bir şey yok):

| Yer | Şube seçiliyken (önce → şimdi) |
|---|---|
| **Faturalar** › pencerenin ve silme onayının cari bilgisi | Sayfanın istemciye giden verisinde bütün faturaların cari bağları (öbür şubenin faturasına sayılan ödeme: tedarikçi, gün, tutar) → yalnız listedeki faturaların (`loadInvoiceCariLinks`, `invoiceScopeWhere`) |
| **Sabah e-postası** (şubeye bağlı alıcılar) ve önizlemesi | Paraşüt bölümü bütün şubelerin yeni faturaları, kontrol bekleyen sayısı ve fiyat onaylarıyla → grubun şubelerinin ve işletme genelinin (şubesi seçilmemiş fatura her gruba, ödemelerin kuralı); fiyat onayı önerinin faturasının şubesiyle; grubun fatura haberi kendi bölümünden (`groupInvoiceSection`, src/server/notify/digest-template.ts). Firmaya giden e-posta değişmedi. Parça 5'teki "sabah e-postası firmanın" bu grubu kapsamıyordu |
| **Mutabakat** › POS hakediş, şube kipi | "Fark" ve "Geciken … gelmedi" karoları firmanın toplamıydı (Tuzla'nın kart satışı Marina'nın farkına giriyordu) → karolar şubenin: beklenen net, bankaya gelen (firmanın, bilgi), geciken (şubenin "Gecikti" günleri ve o günlerdeki beklenen neti), ekstre bekleniyor. Fark yalnız firma kipinde; yükleyici şube kipinde firmanın toplamlarını hiç döndürmez |
| **Mutabakat** › ekstre yükleme penceresi | Bütün tedarikçiler bütün şubelerin fatura sayısıyla → alanın kapsamıyla: şube kipinde şubenin ya da işletme genelinin faturası olan tedarikçiler ve o faturaların sayısı; pencere öbürlerinin firma geneli kipinde olduğunu yazar |
| **Maaşlar** › Vardiya / hesap seçicisi | Bütün hesaplar ve bütün şubelerin vardiyasındaki adlar → şubenin ve şubesiz hesaplar, şubenin vardiyasındaki adlar (`loadStaffLinkOptions`) |
| **Kullanıcılar & roller** | Bütün hesaplar → şubenin hesapları ve şubesiz hesaplar (yönetici, muhasebeci, şubesi seçilmemiş personel); "Öbür şubelerin N hesabı burada yok; Tümü'de hepsi." notu ve **Bütün hesaplar** bağlantısı (`loadUserRows`, src/server/data/users.ts). Hesabın yazımı seçimden bağımsız |
| **Site menüsü** › bekleyen yeni ürün önerileri | Bütün şubelerin önerisi önerenin adıyla → önerenin şubesine göre (`pendingNewProposalRows(db, kapsam)`, `proposerScopeWhere`'in kuralı) |
| **Reçete defteri** (personel ve müdür) › bekleyen yeni ürün adları | Bütün şubelerin önerisi: **müdürün kilidini de aşıyordu** (Marina'nın müdürü Tuzla personelinin önerisinin adını görüyordu) → önerenin şubesine göre, kilitli hesapta kendi şubesi |

Aynı ad + boy denetimi (Ürünler › Yeni ürün, Site menüsü › "Panelde aç ve bağla", personelin önerisi) menü ortak olduğu
için bütün şubelerin önerisine bakmaya devam eder (bütünlük); öbür şubenin önerisinde önereni yazılmaz: "“Fıstıklı Latte ·
Medium” için öbür şubede bekleyen yeni ürün önerisi var (Tümü'de görünür): …" (`pendingNewProposalRows(tx, kapsam,
"adsiz")`).

**Bilinen ve bilerek bırakılanlar** (doğrulama raporu; tasarımın firmanın bıraktığı, sahibin kararına açık):

- **Nakit planı** şube kipinde: haftanın **İşletme geneli** satırı firmanın KDV'si, vergisi ve SGK'sı (parça 4); şubenin
  altı haftalık toplamı bu satırla firmanın vergisini taşır (doğrulamada Marina'nın toplamı 216.821 ₺, Tuzla'sız 34.277 ₺).
- **Vergi** beyanı (`vergi.beyan`): muhtasarın dökümü bütün şubelerin personelini adıyla ve ücretiyle, "stopajı
  bilinmiyor" notu öbür şubenin kalemini adıyla yazar; dışa aktarımın Vergi sekmesi de öyle (tek vergi numarası).
- Sayı ipuçları ve ortak listeler: "öbür şubelerde N" sayıları, tahmini stoğun "N fatura başka şubede" sayısı, ekstrede
  "Öbür şubenin kaydı" (adsız), arama paletinin tedarikçi listesi (ortak kütük).
- Ekrana çıkmayan sunucu okumaları: `dataset.companyMonths`, `ds.pendingPriceHolds`, `loadFixedForReminders().all`.

Testler: `tests/sube-ayrimi-db.test.ts` (doğrulamanın kendisi; bugün `todo` yok), `tests/sube-ayrimi-dogrulama.test.ts`
(saf kurallar ve kaynağın biçimi). Kapsamsız okuma 89 → 88 (Maaşlar'ın vardiya adları).

### Sıra

| Parça | Ne | Durum |
|---|---|---|
| 1 | Altyapı: ayar, migration 0100, `areaScope`, eylem, çip, Hesabım kartı, kayıt ve tarama | Kuruldu (27 Kasım 2026) |
| 2 | Ayarsız sızıntılar: Bugün ve zil sayıları, onaylar, kişi seçicileri, Paraşüt, asistan, kayıp önleme | Kuruldu (27 Kasım 2026) |
| 3 | Şube sütunu olmayan tablolar: `checklist_runs`, `activity_log`, `notification_log`, `investments` (migration 0101) | Kuruldu (27 Kasım 2026) |
| 4 | Alanlar: Ödemeler, Nakit planı, Tedarikçiler, Komisyon | Kuruldu (27 Kasım 2026) |
| 5 | Alanlar: Vergi, Tutarlılık, Mutabakat, Stok değeri; seçimle: tahmini stoğun faturaları, öneriler, tedarikçi fiyatları, su dökümü, ürünün şube fiyatı | Kuruldu (27 Kasım 2026) |
| 6 | Şubeleri yan yana, İşletme geneli giderler, dışa aktarım, muhasebeci paketi, e-posta önizlemeleri, Siparişler'in rozeti, kapanış | Kuruldu (27 Kasım 2026) |
| Doğrulama | Bağımsız doğrulamanın sekiz sızıntısı: Faturalar'ın cari bağları, sabah e-postasının Paraşüt bölümü, Mutabakat POS'un şube karoları ve yükleme penceresi, Maaşlar'ın seçicisi, Kullanıcılar & roller, Site menüsü ve Reçete defterinin önerileri | Kapandı (27 Kasım 2026) |

Kalan bilinen sınırlar (şube ayrımının dışında, sebebiyle): cari kayıtların şubesi yok (`supplier_entries.branch_id`:
Gelir-gider'in "Faturası beklenen alımlar" satırı şube kipinde çizilmez, faturasız borç İşletme geneli); Tutarlılık
bulgularının şubesi yok; site siparişi, masa çağrısı ve Tükendi şubesiz (sözleşme); bankaya gelen POS parası terminal →
şube eşlemesi olmadan firmanın; tahmini stok ve Kaçak raporu yalnız Marina'nın (`STOCK_ESTIMATE_BRANCH`).

## Sırada ne var

Dalga 1 kütüğü ve ekranı, dalga 2 şube sütununu, seçiciyi ve para yolunun süzülmesini, dalga 3 kalan okumaların
süzülmesini ve şube görünümünde maliyeti kurdu. Şube başına ModPOS anahtarı ve föyün şube şube ayrılması kuruldu
([MODPOS-API.md › Şubeler](MODPOS-API.md#1a-şubeler-16-kasım-2026)). Şube sekmeleri, karşılaştırma kartı ve şubeye
özel fiyat `docs/planlar/sube.md`'de.

**Şube kapsamı ve şube başına ayarlar (24–25 Kasım 2026): bilerek sonraya kalanlar** (gerekçeleriyle):

- **Şube başına ayar grupları**: `kasa.rapor`, `kasa.calisan`, `parasut`, `komisyon`, `pos.lafpos`, `modpos`,
  `isletme.takvim`, `kasa.cihaz`, `kasa.kor` ve `vardiya.hazir` (hazır vardiya saatleri, 26 Kasım 2026) kuruldu
  (yukarıda). Kalanlar: **uyarı sesi saatleri** (tarayıcıda ve `public/sw.js`'te
  sabit, 09:00–01:00: alt sınır 25 Kasım'da en erken açılışa çekildi, denetim bulguları 45 ve 99,
  [HATIRLATICILAR.md](HATIRLATICILAR.md#uyarı-seslerinin-sınırı-23-kasım-2026); şube başına olması Çalışma takvimine
  açılış ve kapanış saatini eklemeyi ve bildirim işçisine şubenin saatini taşımayı ister), **kontrol listesi hatırlatma saatleri**
  (e-posta işi tek dilim takvimiyle çalışır), **"yalnız bu bilgisayar" varsayılanı** (`ONLY_COMPUTER_BRANCHES`; "aynı" Marina'nın varsayılanını
  değiştirirdi, ayrı alan ister), komisyon takibinin başladığı gün (`komisyon.since`; hakediş işletmenin, bilerek ortak).
  Ekran "Şimdilik bütün şubelerde ortak" kartında adıyla yazar. Komisyonun şube başına süresi işletmenin hakedişine
  "en kısası" kuralıyla girer; hakedişi şube payına bölmek faturanın şubesi bilinince.
- **Çok şubeli AsilPOS kuruldu** (27 Kasım 2026, [ASILPOS.md › Şubeler](ASILPOS.md#şubeler-çok-şube-27-kasım-2026)): her
  şubenin kendi kasası, geçiş günü, anahtarı, gün sonu otomasyonu ve durumu; Ayarlar'daki AsilPOS kartı seçili şubenin
  bölümünü, "Tümü"de her kasanın bölümünü gösterir. Kalanlar: `stok_tahmini` yalnız Marina'nın (`STOCK_ESTIMATE_BRANCH`;
  başka şube seçiliyken "<şube> için tahmin yok"), **kasa kaynağı değişince** eski şubenin kayıtlı AsilPOS günleri
  yerinde kalır (taşınmaz, sayılmaz), kasayı başka şubeye taşımak yeni kurulum kodu ister (anahtar şubeyi tanıtır).
  "Tümü"de iki kasanın son günleri farklıysa süren ayın satış dönemi en geç gelen günle biter (ModPOS listelerinin
  ortak dönemi gibi en kısasıyla kesilmez). **Şube kapsamı D** ("şube seçiliyken her ekranda yalnız o şubenin bilgisi")
  altı parçada kuruldu (27 Kasım 2026): [Şube ayrımı](#şube-ayrımı-27-kasım-2026); kalan sınırları [Sıra](#sıra)'da.
- **`checklist_runs.branch_id`** (ortak kontrol listesinin şube başına koşusu) kuruldu (27 Kasım 2026, şube ayrımı parça
  3): bütün şubelerin listesini her şube kendi kaydına doldurur; kapalı gün kanıtında kaydın şubesi sayılır
  ([Şube sütunu gelen tablolar](#şube-sütunu-gelen-tablolar-parça-3)).
- **Faturanın şubesi** kuruldu (25 Kasım 2026, aşağıda): şubenin faturası Gelir-gider'de şubenin harcama hücresinde.
  Mal maliyeti tek şubede yine reçeteden (mal faturası bilgi satırında); faturayı şubenin mal maliyetine katmak sayım ve
  devrin şube başına olmasını ister.
- **Kasa, sayım, kasadan çıkan ve kapalı gün** şube göndermeyen yazımda (eski sekme) "Tümü"de hâlâ Tuzla'ya iner; her
  biri sunucu günlüğüne uyarı yazar (`[şube] … şube göndermedi`). Eski sekmeler bitince `requireExplicit` açılabilir.
- **Tükendi** sitenin sözleşmesinde şubesiz: şubeye kilitli personelin Tükendi'si bütün şubelerde kapanır. Bu, "kilitli
  hesap başka şubeye yazamaz" kuralının bilinen istisnasıdır; pencere önce onay ister, işlem geçmişi yeri
  ("laffogato.net, uygulama ve QR menü") yazar. Site şube başına durum tutunca kapanır.

**Sahibe söylenecek davranış değişiklikleri**: ikiden fazla kasa açıkken şubesiz personelin izi kapalı günde kırmızı
değil uyarı sayılır; kasa, sayım, Satışlar'ın ay bilgisi ve Vardiya "Tümü"de formu açmadan şubeyi sorar; bir şube ayrı Paraşüt
hesabına geçince kalan hesabın (Tuzla) yeni faturaları da `branch_id='tuzla'` alır (hesabı yalnız o kullanıyor);
gün sonu e-postası yalnız Rapor alıcılarına gider, liste boş ya da kapalıysa o şubeye açık bildirim adreslerine.

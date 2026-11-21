# Şubeler ve kanallar

Panel 4 Kasım 2026'ya kadar tek işletmeye göre kuruluydu. Marina şubesi açılınca ciro, kasa ve giderlerin şubeye
göre ayrılması gerekti; aynı listede laffogato.net'in **online kanalı** da duruyor, çünkü sitenin cirosu bir
şubenin cirosu değil ama işletmenin cirosudur.

Sahibin kararları (4 Kasım 2026):

| Soru | Karar |
|---|---|
| Menü, reçete, hammadde, tedarikçi | **Ortak**; şubeye göre değişen yalnız satış fiyatı ve "Satışta / Tükendi" |
| Panel | **Tek panel** (`ladmin.laffogato.net`) + üstte şube / kanal seçici |
| Marina'nın kasası | **ModPOS** (Tuzla gibi); **21 Kasım 2026'da değişti:** önce Marina LafPOS'a geçer, Tuzla ModPOS'ta kalır. LafPOS'un şubesi `LAFPOS_BRANCH_ID = "marina"`; Marina'nın ModPOS'u yedek olarak çekilmeye devam eder (kasa kaynağı ModPOS kalır), geçiş gününden sonra sayılan LafPOS'un günüdür |
| Bugüne kadarki veri | Hepsi **Tuzla**'ya |

## Kütük

`branches` tablosu (migration `0053_subeler.sql`), kuralları `src/lib/branches.ts` (saf, `tests/subeler.test.ts`):

| Alan | Ne |
|---|---|
| `id` | Kısa kimlik (`tuzla`, `marina`, `online`); adreste, çerezde ve kayıtlarda geçer. **Eklendikten sonra değişmez** |
| `name` | Ekranda görünen ad ("Marina", "laffogato.net") |
| `kind` | `fiziksel` (şube) ya da `online` (kanal) |
| `pos_source` | Gün sonu nereden gelir: `modpos`, `lafpos` ya da `yok` (online) |
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
- Verisi olan şube **silinmez**, yalnız kapatılır.

## Ekran

**Ayarlar › Şubeler** (`/panel/subeler`, yalnız yönetici): liste, "Şube ekle" ve satıra dokununca düzenleme
penceresi. Ad yazılırken kimlik kendiliğinden önerilir ("Laffogato Marina" → `laffogato-marina`), tür değişince
kasa kaynağı uyar. Her değişiklik işlem geçmişine yazılır.

## Dalga 2'nin kararları (4 Kasım 2026)

| Konu | Karar |
|---|---|
| Giderler | Şubeye bağlı; **ortak giderler "işletme geneli"** kalır, hiçbir şubeye zorlanmaz |
| Personel | Herkes bir şubeye bağlı; maaşı o şubenin gideri |
| ModPOS | Şube başına ayrı anahtar; günlük 2 çekim hakkı şube başına (kuruldu, 16 Kasım 2026: [MODPOS-API.md › Şubeler](MODPOS-API.md#1a-şubeler-16-kasım-2026)) |
| Stok ve sayım | Şube başına ayrı; tutarlılık ve FIFO değerleme şube içinde |

"Tümü" seçiliyken işletme geneli giderler toplama girer ama şube kırılımında ayrı sütunda durur: bir şubenin
kârı ortak giderle şişirilmez.

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

### Neyi süzer, neyi süzmez

Süzülen (dalga 3 ile hepsi): kasa raporu, gün özeti, ModPOS föyü, LafPOS gün sonu, ay satırı, satış satırı, personel,
stok sayımı, zayi — yani **görünümler**. Harcama ve sabit gider tek şube seçiliyken **o şubenin ve işletme genelinin**
kalemleriyle gelir (`branchWhereWithShared`): kira, muhasebe, abonelik hiçbir şubede kaybolmaz. laffogato.net'in online
satışı "Tümü"de ve online kanal seçiliyken okunur, fiziksel şubede yoktur.

**İşletme geneli ekranlar** seçiciden bağımsız, hep "Tümü"yle okur (`withBranchScope(ALL_BRANCHES, …)` ya da
`loadModel({ scope: ALL_BRANCHES })`): Vergi (özet, gelir-gider, demirbaş), Ödemeler › Nakit planı ve Genel bakış'ın
nakit planı kartı, Tutarlılık (alınan mal şubeye bölünmez; tek şubenin tüketimiyle karşılaştırılmaz), Excel'e aktar
(panelin yedeği) ve Ayarlar › Stok değerleme önizlemesi (ayar "Tümü"nün kâr-zararını değiştirir; denetim 21 Kasım
#32). Para ve beyan işletmenindir.

**E-postalar** da işletme genelidir ve elle tetiklenen yolları sabah işiyle aynı hesaplar: sabah e-postası (önizleme ve
"Bugünküleri şimdi gönder" dahil, `runReminderDigest`) ile haftalık özet (önizleme ve örnek dahil, `collectWeekly`)
`withBranchScope(ALL_BRANCHES, …)` içinde okur. Önceden yöneticinin elle bastığı düğmeler soldaki seçimi okuyordu:
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
| Mal maliyeti | **Şubenin satışından reçeteye göre**: tüketim (fire hariç) × (1 + genel fire) + ödenmezlerin malzeme maliyeti (`engine.ts` `stockFlow`, yöntem `sube`). Faturalar ve stok devri işletme genelinde, şubeye bölünmez |
| Ürün ve reçete maliyeti | Şubeye göre değişmez. Su + buz litre fiyatı işletme geneli: SU GİDERİ (işletmenin faturası) ÷ **bütün şubelerin** ve laffogato.net'in o ayki su + buz litresi (`Dataset.waterSales`, `engine.ts` `waterUsage`; denetim 21 Kasım #4). Önceden fatura yalnız seçili şubenin litresine bölünüyordu: Marina seçiliyken Americano M'nin maliyeti şişiyor, iki şubenin mal maliyeti faturayı iki kez sayıyordu |
| Mal alımı (faturalar) | Bilgi olarak görünür, "işletme geneli"; mal maliyetine girmez |
| Personel | Şubeye bağlı kişilerin maaşı (Maaşlar'da kişinin **Şube** alanı) |
| Sabit gider | Şubeye bağlı kalemler + işletme geneli kalemler (Sabit giderler'de kalemin **Şube** alanı; boş = işletme geneli). Var olan kalemler işletme geneli kaldı |
| Harcama | Şubenin + şubesi boş (işletme geneli) harcamalar |
| Elle yazılan Gelir-gider hücresi | `manual:*` her şubede; `fixed:` / `stopaj:` kalemin şubesindeyse; **devir, personel, POS komisyonu** işletmenin toplamıdır, şubede yazılamaz (ekran kilitler, sunucu reddeder) |
| "Sayım yok" uyarısı | Yok: şubenin mal maliyeti sayıma bağlı değil |

"Tümü" eskisi gibi: sayımlı mal maliyeti (sayım, sayım aralığına dağıtım, tahmin). Aynı ayın aynı malzemesi iki şubede
sayıldıysa işletmenin stoğu toplamdır (birimi farklıysa ilk satırın birimine çevrilir).

**Stok sayımı sayfası** hep bir şubenin sayımını gösterir ([Yazarken hangi şube](#yazarken-hangi-şube)). Gelir-giderde ("Tümü") elle yazılan devir
("SONRAKİ AYA DEVREDEN MAL", "ÖNCEKİ AYDAN DEVİR") işletme genelidir ve şubenin modeli onu görmez; sayfa bu hücreleri
ayrıca okur ki yöneticinin kartı yine söylesin (denetim E-30; 21 Kasım denetimi #20): açılış kâr-zararın kullandığı
tutardır ("elle girildi" ipucunda şubenin geçen ayki sayımı), bu ayın stoğu elle yazıldıysa "kâr-zarar bu sayımı
kullanmaz" uyarısı. Birden çok şube açıkken metin tutarın işletme geneli, sayımın şubenin olduğunu yazar ("Ekim 2026
sayımı (Tuzla)"); sayım toplamı ve elle yazılmamış açılış şubenin kendi sayımıdır.

### Yazarken hangi şube

| Kayıt | Şube |
|---|---|
| Kasa raporu, kasadan çıkan para | Formun gösterdiği kasa: sayfa açılırken seçili şube, "Tümü"nde Tuzla (kasadan çıkanın harcaması da o şubenin). Form kasanın kimliğini gönderir; gönderim anındaki seçim değil o yazılır ([aşağıda](#kasa-raporu-tümüde-20-kasım-2026)) |
| Tedarikçiye kasadan ödeme (yeni Teslim satırı) | Pencerede seçilen kasa: varsayılanı seçili fiziksel şube (tek kasa açıksa o). "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa varsayılan yok, şube seçilmeden kaydedilmez; sunucu da seçimsiz kaydı reddeder (`chooseTill`, denetim 21 Kasım #31). Var olan satır listesinde her satır kasasının şubesini yazar |
| Ay bilgisi (ciro, açık gün, indirim, ödenmez, ay notu; Satışlar ve Gelir-gider) | Seçili şubenin ay satırı; "Tümü"nde Tuzla'nınki. Önceden Gelir-gider'in ciro, açık gün ve ay notu hücreleri şubesiz yazıyor, her şubede Tuzla'nın satırını eziyordu (denetim 21 Kasım #6). Birden çok kasa açıkken "Tümü"de Gelir-gider'in ciro ve açık gün hücresi **kilitlidir** ("şubeyi seçin"; sunucu da reddeder, `monthTotalsLocked`): hücre şubelerin toplamını gösterir, yazılan Tuzla'nın ayına inip öteki şubenin cirosunu iki kez saydırırdı; sayfanın notu bunu ve ay notunun Tuzla'ya indiğini yazar. Satışlar'ın ay formu "Tümü"de başlığında **Tuzla** yazar, Tuzla'nın elle yazdığını ve kasasını gösterir; liste ↔ POS kutusu çıkmaz (liste bütün şubelerin) (denetim 13 Kasım HM-02) |
| Satışlar › Ayı temizle | Gösterilen şubenin listesi ve (seçilirse) ay bilgisi; "Tümü"nde bütün şubelerinki. Listenin son günü (kapsam kaydı) ayın tek kaydıdır: yalnız ayda hiçbir şubenin listesi kalmadıysa silinir (denetim 21 Kasım #7) |
| Stok sayımı, zayi | Seçili **fiziksel** şube; "Tümü" ya da online kanal seçiliyken Tuzla. Stok sayımı başlığı birden çok açık şube varken hangi şubenin sayıldığını yazar. Sayımın **"Listede olmayanlar"ı** (ek kalemler) da şubenin: okuma, eşleme, silme ve kayıt o şubenin listesiyle, "Tümü" bütün şubelerinkini toplar (`stock_extras.branch_id`, migration 0059; eski satırlar Tuzla'nın). Önceden liste şubesizdi: Marina'nın formu Tuzla'nın ek kalemlerini gösteriyor, aynı adlı kalemi ezip fiyatsız olanı siliyordu (denetim 21 Kasım #19/#24). Yalnız yeni kalemin fiyatını bulan geçmiş işletme genelidir (fiyat şubeye göre değişmez). Kaydedilmemiş sayımın bu cihazdaki taslağı da şube başına (anahtar `laf:sayim-taslak:<şube>:<ay>`, taslak şubesini de yazar): bir şubenin taslağı öbür şubenin formunda önerilmez, oraya kaydedilmez (#8). Şubesiz eski anahtardaki taslak hangi şubenin olduğu bilinmediği için okunmaz. **Sayım formu şubesini taşır** (kasa formları gibi): sayım, ek kalemler ve "Listeye ekle" formun gösterdiği şubeyi gönderir, sunucu onu doğrular (etkin fiziksel şube; şubesine kilitli personelde yalnız kendi şubesi, `formCountBranch` › `formCountError`) ve yazımı o şubenin kapsamında çalıştırır. Önceden kayıt gönderim anındaki çereze iniyordu: başka sekmede seçici Marina'ya geçince açık kalan Tuzla sayımı Marina'ya yazılıyordu. Şubeyi göndermeyen eski sekme seçili fiziksel şubeye yazar |
| Harcama | Seçili şube; "Tümü"nde işletme geneli (boş) |
| Personel | Pencerede seçilen şube (yeni kişide seçili fiziksel şube) |
| Sabit gider | Pencerede seçilen şube ya da "İşletme geneli" (yeni kalemde seçili şube, "Tümü"nde işletme geneli) |
| Ödeme hatırlatıcısı | Formda seçilen şube ya da "İşletme geneli" (yenide seçili fiziksel şube, "Tümü"nde işletme geneli) |
| Kontrol listesi | Listede seçilen şube ya da "Bütün şubeler" |
| Personel hesabı (Kullanıcılar) | Formda seçilen şube ya da "Bütün şubeler"; şubesi olan personel o şubede kilitli |

Stok sayımı kaydının çakışma hedefi `(ay, şube, malzeme)`: dalga 2'de tek şubesiz hedef kaldığı için sayım kaydı
"no unique or exclusion constraint" hatasıyla düşüyordu; `tests/sube-maliyet.test.ts` artık bütün kaynak dosyalarını
tarar.

## "Tümü"nün ay bilgisi (denetim 13 Kasım 2026, P02)

"Tümü" şubelerin toplamıdır. Kasa satırları (rapor, LafPOS gün sonu, ModPOS föyü) şubesini taşır (`tillRows`,
`src/server/data/cash-reports.ts`); ay bilgisi şöyle kurulur (`src/lib/cash-month.ts`, `src/server/data/dataset.ts`):

| Ne | Kural |
|---|---|
| Açık gün, raporlu gün | **Günde bir kez**: Tuzla ve Marina aynı gün açıksa bir gün. Personel ve oranlanan sabit gider bu günle bölünür, oran en çok 1 (iki şube açıkken maaş ve kira iki kat sayılmaz); günlük ortalama ve ay sonu öngörüsü de bu günle |
| Ciro, indirim, ödenmez | Şubelerin toplamı |
| Kaynak önceliği | Rapor > LafPOS gün sonu > föy, **aynı şubenin aynı gününde**: bir şubenin raporu ötekinin föyünü düşürmez |
| Elle yazılan ay bilgisi | Her şube kendi elle yazdığı ve kasasıyla çözülür, sonra toplanır (`resolveBranchMonths`): Marina'nın elle yazdığı ciro Tuzla'nın kasa cirosunu silmez. Elle yazılan açık günün hangi günler olduğu bilinmediği için şubelerin en büyüğü alınır; kasadan gelen günler yalnız açık günü kasadan gelen şubelerin satırlarıyla birleşir (elle daha az gün yazan şubenin kasa günleri girmez). Kartlı oran ciro ağırlıklı |
| Açılış ayı | Her şube kendi açılış günüyle (`tillOpenedOn`): raporlar açılış gününden beri girildiyse ay yarım sayılmaz, cirosu "Tümü"nün toplamına da girer |
| Personel ve sabit gider | Şubeye bağlı kişi ve kalem "Tümü"de de kendi şubesinin günüyle oranlanır (açılış ayında açılış gününden; şube görünümüyle aynı); işletme geneli kalem işletmenin günüyle |
| Biten ay | Ayın sonuna kadar oranlanır: ayın 1'inde 00:00-05:00 arası son günün raporu daha beklenirken de kira ve maaş tam ay (`prorationDays`) |

Aynı kuralla: Genel bakış'ın günlük ciro grafiği günün şubelerini tek çubukta toplar; nakit planının ve haftalık özetin
satışı ödenmez / ikram hariç ciroyla (`dayRevenue`); Bugün'ün şube kartı föyden sayılan günü de çizer.

## Kasa raporu "Tümü"de (20 Kasım 2026)

Kasa raporu şube başınadır: günün raporu, devir zinciri, yazarkasa Z sırası, ModPOS föyü, LafPOS gün sonu, kasadan
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
  kasa (`currentTillBranch`; online kanal seçiliyken Tuzla). Önceden Bugün online kanalda şubesiz okuyup `online`
  kasasında rapor arıyordu: dünün eksik raporu görünmüyor, girilmiş bugünkü rapor "Henüz girilmedi" kalıyordu; Kasa
  sayfası ve zil Tuzla'yı gösteriyordu (denetim 21 Kasım #26).
- **Tek kasa okumaları** (`getCashReport`, `previousCarryOver`, `nextReportAfter`, `previousOkc`, `nextOkc`,
  `loadMonthEntry`, LafPOS günü, kasadan çıkanlar, zayi) verilen şubeyle ya da kasanın şubesiyle okur; kayıtlı raporun
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
- **Kapalı gün** işletmenindir (`special_days`'te şube yok; günün herhangi bir şubedeki izi kanıttır), ama Z no ve
  açılış sürekliliği şube başına bakılır (`closedDayEvidence`, `onNextReport`; denetim 21 Kasım #1): Tuzla'nın ertesi
  günkü Z'si Marina'nın önceki Z'siyle karşılaştırılıp onaylı işaret silinmez, onay "kafe açık görünüyor" diye
  engellenmez, Marina'nın açılışı Tuzla'nın devriyle tutmuyor diye zile yazılmaz. Fotoğraftan okunan ModPOS Z'sinin
  "eski bir Z raporu olabilir" denetimi de formun kasasının önceki raporuyla (`previousZNo`); yazarkasa Z'sinin
  büyüklük denetimi (son 28 günün ortancası, docs/YAZARKASA-Z.md) de o şubenin raporlarıyla (`okcTypical`). Önceden
  iki şubenin toplamı karışıyordu: ortanca öbür şubeye kayıyor, büyük şubenin gerçek Z'si "çok büyük" görünebiliyordu.

## LafPOS'a geçiş günü şubenin kasasınındır (21 Kasım 2026)

LafPOS yalnız Tuzla'da kurulu (gün sonunu Tuzla'ya yazar); Ayarlar › LafPOS'taki geçiş günü yalnız **Tuzla'nın
kasasınındır** (`branchSwitchDay`, `src/lib/lafpos/switch.ts`). Marina'nın kasası ModPOS'ta kalır: föyü çekilir, Kasa
raporu, föy karşılaştırması, ürün listesi, ürün ikramı ve kasadaki fiyatlar Marina'da bugünkü gibidir. Ay ekranları
Marina seçiliyken geçiş gününü yok sayar, "Tümü"de iki şubenin satırlarını şube şube ayırır. Ayrıntı:
[LAFPOS.md › Şubeler](LAFPOS.md#şubeler-denetim-21-kasım-5).

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
- Kullanıcı listesinde personelin şubesi rozetle görünür. Şubeye bağlı hesap varken şube silinmez
  (`branchUsageCount`).

## Ödemeler (16 Kasım 2026)

Ödeme hatırlatıcılarının (kira, aidat, fatura, maaş …) **Şube** alanı vardır (`reminders.branch_id`; boş = **işletme
geneli**: vergi, SGK, muhasebe gibi). Sabit giderdeki kuralın aynısı:

| Ne | Kural |
|---|---|
| Ödemeler listesi, Bugün, zil, Genel bakış'ın "Yaklaşan ödemeler" kartı ve gecikme satırı | Tek şube seçiliyken **o şubenin ve işletme genelinin** hatırlatıcıları; "Tümü"nde hepsi, şubeye ait olanın başlığında şubesi ("Kira · Marina") |
| Yeni hatırlatıcı | Formdaki **Şube**; varsayılanı seçili fiziksel şube, "Tümü"nde işletme geneli |
| Sabit giderden ekle | Kalemin şubesi (Marina'nın kirası Marina'nın ödemesi) |
| Ertele (tekrar eden) | Ertelenen dönemin tek seferlik kopyası serinin şubesinde kalır; önceden kopya işletme geneli iniyor, Marina'nın kirası Tuzla'nın Ödemeler'inde görünüyordu (denetim 21 Kasım #17) |
| Ödenmemiş faturalar ve cari | İşletme geneli (mal alımı şubeye bölünmez), her görünümde |
| Sabah e-postası, Nakit planı, Vergi, haftalık özet | Bütün ödemeler: para işletmenindir (`loadUpcoming` şubesiz çağrılır) |

Var olan hatırlatıcılar işletme geneli kaldı; şubeye ait olanı yönetici formdan taşır.

## Sırada ne var

Dalga 1 kütüğü ve ekranı, dalga 2 şube sütununu, seçiciyi ve para yolunun süzülmesini, dalga 3 kalan okumaların
süzülmesini ve şube görünümünde maliyeti kurdu. Şube başına ModPOS anahtarı ve föyün şube şube ayrılması kuruldu
([MODPOS-API.md › Şubeler](MODPOS-API.md#1a-şubeler-16-kasım-2026)). Şube sekmeleri, karşılaştırma kartı ve şubeye
özel fiyat `docs/planlar/sube.md`'de.

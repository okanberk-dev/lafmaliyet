# Şubeler ve kanallar

Panel 4 Kasım 2026'ya kadar tek işletmeye göre kuruluydu. Marina şubesi açılınca ciro, kasa ve giderlerin şubeye
göre ayrılması gerekti; aynı listede laffogato.net'in **online kanalı** da duruyor, çünkü sitenin cirosu bir
şubenin cirosu değil ama işletmenin cirosudur.

Sahibin kararları (4 Kasım 2026):

| Soru | Karar |
|---|---|
| Menü, reçete, hammadde, tedarikçi | **Ortak**; şubeye göre değişen yalnız satış fiyatı ve "Satışta / Tükendi". **24 Kasım 2026:** şube fiyatı yapıldı (sitede satır, panelde Fiyatlar › Şube fiyatı ve Toplu değiştir › Şube, LafPOS siteden alır; [FIYATLAR.md › Şube fiyatı](FIYATLAR.md#şube-fiyatı-24-kasım-2026)) |
| Panel | **Tek panel** (`ladmin.laffogato.net`) + üstte şube / kanal seçici |
| Marina'nın kasası | **ModPOS** (Tuzla gibi); **21 Kasım 2026'da değişti:** önce Marina LafPOS'a geçer, Tuzla ModPOS'ta kalır. LafPOS'un şubesi `LAFPOS_BRANCH_ID = "marina"`; geçiş gününden sonra sayılan LafPOS'un günüdür. **23 Kasım 2026:** Marina'da ModPOS bir daha kullanılmaz (ModPOS dönemi 13–21 Kasım 2026); föyün yedek çekimi sürerse (kasa kaynağı ModPOS) saklanır ama sayılmaz |
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

### Neyi süzer, neyi süzmez

Süzülen (dalga 3 ile hepsi): kasa raporu, gün özeti, ModPOS föyü, LafPOS gün sonu, ay satırı, satış satırı, personel,
stok sayımı, zayi — yani **görünümler**. Harcama ve sabit gider tek şube seçiliyken **o şubenin ve işletme genelinin**
kalemleriyle gelir (`branchWhereWithShared`): kira, muhasebe, abonelik hiçbir şubede kaybolmaz. laffogato.net'in online
satışı "Tümü"de ve online kanal seçiliyken okunur, fiziksel şubede yoktur.

**İşletme geneli ekranlar** seçiciden bağımsız, hep "Tümü"yle okur (`withBranchScope(ALL_BRANCHES, …)` ya da
`loadModel({ scope: ALL_BRANCHES })`): Vergi (özet, gelir-gider, demirbaş), Ödemeler › Nakit planı ve Genel bakış'ın
nakit planı kartı, Tutarlılık (alınan mal şubeye bölünmez; tek şubenin tüketimiyle karşılaştırılmaz), Ayarlar'daki
tam yedek (Excel'e aktar, seçicisiz) ve Ayarlar › Stok değerleme önizlemesi (ayar "Tümü"nün kâr-zararını değiştirir;
denetim 21 Kasım #32). Para ve beyan işletmenindir. Şube seçiliyken bu ekranlar ve Faturalar, Tedarikçiler
başlığın altında **"Marina seçili: bu ekran firma geneli"** notunu gösterir (`companyWideNote`, `CompanyWideNotice`;
şube kapsamı C, sahibin varsayılanı: tek firma). Paraşüt ekranı firma geneli değildir: seçili şubenin Paraşüt hesabını
gösterir ([PARASUT.md](PARASUT.md#şube-başına-paraşüt-hesabı)). Genel bakış'ın **Excel'e aktar** düğmesi ise
ekranın şubesini gönderir (`?sube=`): satış, kasa, personel ve giderler o şubenin, Vergi ve Cari hareketleri firma
geneli; dosyanın ilk sayfası (Nasıl Okunur) kapsamı yazar, dosya adı şubeyle biter.

**Komisyon & hakediş** (23 Kasım 2026, [KOMISYON.md](KOMISYON.md) › Şube): satış seçili şubenin kasa raporlarından,
LafPOS'undan ve ModPOS föyünden; komisyon faturaları, oran ve hakediş işletmenin (faturalar şubeye bölünmez). Şube
seçiliyken ekran işletmenin raporunu gösterir ve üstte şubenin payını (şube satışı × işletmenin oranı) notuyla ekler.
Şubenin satışı "Tümü"nün kuralıyla sayılır: ModPOS'ta kalan şubenin Z'si de geçiş ayından itibaren tek kanala yazılmaz
(föyde markası olan kanalına, kalan markası belirsiz), sonradan açılan şubenin açılış ayı yarım sayılmaz, elle yazılan
ekstre satışı (işletmenin) şubeye yazılmaz. Zil, Bugün'ün Hakedişler satırı, sabah e-postası ve haftalık özet seçiciden
bağımsız, işletme genelidir.

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
| Sabit gider | Şubeye bağlı kalemler (Sabit giderler'de kalemin **Şube** alanı). İşletme geneli kalemler (şube boş; var olan kalemler işletme geneli kaldı) Faz 5'ten beri **şubenin kârına girmez**: "İşletme geneli payı (bilgi)" satırında |
| Harcama | Şubenin kendi harcamaları. Şubesi boş (işletme geneli) harcamalar ve kategoriye bağlı faturalar bilgi satırında (Faz 5) |
| Komisyon faturaları | İşletme geneli (faturalar şubeye bölünmez): bilgi satırında (Faz 5); banka POS komisyonu şubenin kartıyla |
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
| İşletme geneli sayılanlar | Şubesi boş sabit gider ve stopajı, silinmiş kalemin elle girişi, Gelir-gider'e elle yazılan hücreler (`manual:*`; pnl_entries şubesiz), şubesi boş harcamalar ve harcama kategorisine bağlı faturalar, komisyon faturaları (Komisyon kategorisi) |
| Tek şube seçiliyken | Bunlar bölümlere, giderlere ve kâra girmez; satırları çizilmez. Gelir-gider'de "İşletme geneli (bilgi)" bölümünde tek satır **İŞLETME GENELİ PAYI (bilgi)**: ipucu "Şubenin kârına girmez; Tümü'de bir kez sayılır", hücresi en büyük kalemleri yazar. Genel bakış'ın sabit gider dökümü de onları saymaz, altında bilgi olarak toplamı yazar. Harcama satırı şubenin kendi kayıtlarıdır |
| Günü | İşletmenin günü: şube seçiliyken veri kümesi "Tümü"nün ay bilgisini de taşır (`Dataset.companyMonths`), oranlanan kalem Tümü'deki tutarla görünür (Marina'nın açılış ayında da) |
| "Tümü" | Bölümlerinde bir kez sayılır (bilgi satırı yok). Gelir-gider'de birden çok fiziksel şube açıkken **Şube kırılımı** kartı (`src/lib/branch-breakdown.ts`): her şubenin ciro, gider ve kârı kendi görünümündeki gibi; fiziksel şube olmayan kanala (online) yazılan sabit gider, harcama ve personel varsa kendi sütununda (`PnlMonthCalc.byBranch`; tek kanalsa onun adıyla, yoksa **Diğer kanallar**; inceleme bulgusu 5: önceden farka düşüyordu); **İşletme geneli** sütunu (giderler: işletme geneli toplamı; ciro: laffogato.net online satışı) ve Tümü. Kabul: Marina kârı + Tuzla kârı − işletme geneli = Tümü kârı. Mal maliyetinin yöntemi farklı olduğundan (Tümü sayımla, şube satışından reçeteye göre) ya da Tümü'de elle yazılan personel / POS komisyonu şubeye bölünmediğinden kalan fark kartın altında yazılır; hiçbir gider iki kez sayılmaz |
| Başabaş ve "Excel temeli" | Şube seçiliyken kârın temeliyle aynı kalemlerden (inceleme bulgusu 3, sahibin kararı 4): standart sabit gider (`fixedStandardTotalFor`), Genel bakış'ın "Excel temeli" net kârı, başabaş (`breakEvenOf`; Genel bakış, Sabit giderler, Analiz) ve her ay girilen harcamaların payı (`monthlyExpensePlan`: şubenin kendi kayıtları) işletme genelini saymaz. Dışarıda kalan toplam (`fixedStandardSharedFor`) Sabit giderler'in özetinde ve başabaş dökümünde bilgi olarak yazılır. "Tümü" değişmez |
| Değişmeyenler | İşletme geneli ekranlar (Vergi, Nakit planı, Tutarlılık, Excel'e aktar) hep "Tümü"yle okur |

**Stok sayımı sayfası** hep bir şubenin sayımını gösterir ([Yazarken hangi şube](#yazarken-hangi-şube)). Gelir-giderde ("Tümü") elle yazılan devir
("SONRAKİ AYA DEVREDEN MAL", "ÖNCEKİ AYDAN DEVİR") işletme genelidir ve şubenin modeli onu görmez; sayfa bu hücreleri
ayrıca okur ki yöneticinin kartı yine söylesin (denetim E-30; 21 Kasım denetimi #20): açılış kâr-zararın kullandığı
tutardır ("elle girildi" ipucunda şubenin geçen ayki sayımı), bu ayın stoğu elle yazıldıysa "kâr-zarar bu sayımı
kullanmaz" uyarısı. Birden çok şube açıkken metin tutarın işletme geneli, sayımın şubenin olduğunu yazar ("Ekim 2026
sayımı (Tuzla)"); sayım toplamı ve elle yazılmamış açılış şubenin kendi sayımıdır.

### Yazarken hangi şube

| Kayıt | Şube |
|---|---|
| Kasa raporu, kasadan çıkan para | Formun gösterdiği kasa: sayfa açılırken seçili şube (kasadan çıkanın harcaması da o şubenin). "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa form çizilmez, önce **"Hangi şubenin kasası?"** sorulur (şube kapsamı C; önceden sessizce Tuzla'nın formu açılıyordu); tek kasada o kasa. Form kasanın kimliğini gönderir; gönderim anındaki seçim değil o yazılır ([aşağıda](#kasa-raporu-tümüde-20-kasım-2026)). "Kasayı sayan" listesi o kasayı sayabilecekler: yönetici, şubesiz personel, şubenin personeli ve son 60 günde o kasayı saymış olan |
| Tedarikçiye kasadan ödeme (yeni Teslim satırı) | Pencerede seçilen kasa: varsayılanı seçili fiziksel şube (tek kasa açıksa o). "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa varsayılan yok, şube seçilmeden kaydedilmez; sunucu da seçimsiz kaydı reddeder (`chooseTill`, denetim 21 Kasım #31). Var olan satır listesinde her satır kasasının şubesini yazar |
| Ay bilgisi (ciro, açık gün, indirim, ödenmez, ay notu; Satışlar ve Gelir-gider) | **Formun gösterdiği şubenin** ay satırı: form şubenin kimliğini gönderir, gönderim anındaki seçim değil o yazılır (`formBranch(…, "sales")`; 24 Kasım şube kapsamı). Etkin fiziksel şube olmalı: online kanal seçiliyken ay yazılmaz (kanalın kasa satışı yok; önceden ay "online" şubesine iniyordu), Satışlar'da İçe aktar ve ay formu yerine "kasa satışı yok" satırı çıkar, Gelir-gider'in ay hücreleri kilitlidir (`monthWriteLock`). Önceden Gelir-gider'in ciro, açık gün ve ay notu hücreleri şubesiz yazıyor, her şubede Tuzla'nın satırını eziyordu (denetim 21 Kasım #6). Birden çok kasa açıkken "Tümü"de Gelir-gider'in ciro, açık gün **ve ay notu** kilitlidir ("şubeyi seçin"; sunucu da reddeder): hücre şubelerin toplamını gösterir, yazılan Tuzla'nın ayına inip öteki şubenin cirosunu iki kez saydırırdı; ay notu da artık sessizce Tuzla'ya inmez. Tek kasa açıkken "Tümü" o kasadır, yazılır (`monthWriteBranch`). Satışlar'ın ay formu da birden çok kasa açıkken "Tümü"de çizilmez, yerinde "Hangi şubenin ay bilgisi?" sorusu çıkar (25 Kasım 2026; önceden form başlığında Tuzla yazıp Tuzla'nın ayına yazıyordu, Gelir-gider'le aynı kural değildi). Tek kasa açıkken form o kasanındır, liste ↔ POS kutusu çıkmaz (denetim 13 Kasım HM-02). Şubeyi göndermeyen eski sekme tek şube seçiliyken o şubeye yazar, "Tümü"de birden çok kasa açıkken reddedilir |
| Satışlar › İçe aktar, Satır ekle | Formun gösterdiği şubenin listesi (`formBranch(…, "sales")`). "Tümü"de birden çok kasa açıkken kart ve pencere şubeyi sorar, varsayılan yok; ayı LafPOS'tan gelen şube listede yer almaz (bugün "Tümü"de yalnız Tuzla kalır). "Yenisiyle değiştir"in onayı seçilen şubenin satırlarını sayar. Düzeltilen satır kendi şubesinde kalır |
| Satışlar › Ayı temizle | Gösterilen şubenin listesi ve (seçilirse) ay bilgisi; "Tümü"nde bütün şubelerinki. Kapsam çerezden değil pencerenin gösterdiğinden kurulur: pencere kapsamı ve saydığı satır sayısını gönderir, seçim başka sekmede değiştiyse ya da liste bu arada değiştiyse silme reddedilir (`assertShownScope`, 24 Kasım şube kapsamı); içi boşalan ay satırları kapsamdaki her şubede kalkar. Listenin son günü: ayın ortak kaydı yalnız ayda hiçbir şubenin listesi kalmadıysa silinir (denetim 21 Kasım #7), şubenin kendi kaydı (`sales.coverage.sube`) listesi silinen şubenin ayından silinir. Şube seçiliyken liste dönemi şubenin kendi kaydını, Marina'nın LafPOS'unun sayıldığı ilk gün her görünümde Marina'nın kaydını, içe aktarma kartının "… tarihine kadar"ı yazılan şubenin kaydını okur ("Tümü"de birden çok şubeye yüklenebiliyorsa kart şubeyi sorar, tek gün yazmaz). Onaydaki satır sayısı sunucunun sileceği ve denetlediği sayıdır (kapsamdaki bütün liste satırları; LafPOS'un satırları ayrı tabloda, silinmez) ([LAFPOS.md](LAFPOS.md) › Günlük satış) |
| Stok sayımı, zayi | Seçili **fiziksel** şube; "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa sayım formu çizilmez, önce **"Hangi şubeyi sayıyorsunuz?"** sorulur (şube kapsamı C), tek kasada o kasa. **Zayi ve ikram** formun şubesine (`formBranch(…, "waste")`, 24 Kasım şube kapsamı): kayıt ve geç kayıt isteği formun gösterdiği şubeyi gönderir; "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa form şubeyi sorar (varsayılan yok, şubesiz kayıt reddedilir), başlık birden çok kasa açıkken şubeyi yazar ("Tuzla · Zayi & ikram"); sayfanın kilidi de formun şubesinin. Stok sayımı başlığı birden çok açık şube varken hangi şubenin sayıldığını yazar. Sayımın **"Listede olmayanlar"ı** (ek kalemler) da şubenin: okuma, eşleme, silme ve kayıt o şubenin listesiyle, "Tümü" bütün şubelerinkini toplar (`stock_extras.branch_id`, migration 0059; eski satırlar Tuzla'nın). Önceden liste şubesizdi: Marina'nın formu Tuzla'nın ek kalemlerini gösteriyor, aynı adlı kalemi ezip fiyatsız olanı siliyordu (denetim 21 Kasım #19/#24). Yalnız yeni kalemin fiyatını bulan geçmiş işletme genelidir (fiyat şubeye göre değişmez). Kaydedilmemiş sayımın bu cihazdaki taslağı da şube başına (anahtar `laf:sayim-taslak:<şube>:<ay>`, taslak şubesini de yazar): bir şubenin taslağı öbür şubenin formunda önerilmez, oraya kaydedilmez (#8). Şubesiz eski anahtardaki taslak hangi şubenin olduğu bilinmediği için okunmaz. **Sayım formu şubesini taşır** (kasa formları gibi): sayım, ek kalemler ve "Listeye ekle" formun gösterdiği şubeyi gönderir, sunucu onu doğrular (etkin fiziksel şube; şubesine kilitli personelde yalnız kendi şubesi, `formCountBranch` › `formCountError`) ve yazımı o şubenin kapsamında çalıştırır. Önceden kayıt gönderim anındaki çereze iniyordu: başka sekmede seçici Marina'ya geçince açık kalan Tuzla sayımı Marina'ya yazılıyordu. Şubeyi göndermeyen eski sekme seçili fiziksel şubeye yazar |
| Harcama, cari "Faturası yok · gider yaz" | Formda seçilen şube ya da **İşletme geneli** (`formBranch(…, "expense")`, 24 Kasım şube kapsamı): varsayılan seçili şube, "Tümü"de görünür biçimde işletme geneli; tek şube açıkken seçim çizilmez. Düzeltme şubeyi değiştirebilir; kasadan çıkan fişin gideri kasanın şubesinde, cari borcun gideri Tedarikçiler'de seçilen şubede kalır (Aylık harcamalar'dan değişmez). Cari giderinde şube seçilmezse düzeltmede kalır, mod değişip yeni kayıt açılırsa önceki gider kaydının şubesi. Şubeyi göndermeyen eski sekme ve asistan: seçili şube, "Tümü"nde işletme geneli |
| Kasaya işle işareti ("Kasada değiştirdim", Kasadaki fiyatlar) | Listenin gösterdiği kasa (`formBranch(…, "till", { requireExplicit })`; şube kapsamı A3): işaret yalnız o şubenin kasasından düşer, öbür şubenin listesi kalır. "Tümü"de birden çok kasa açıkken her kasa ayrı liste; kasası gelmeyen istek reddedilir. Kasada bekleyen fiyat şube başına (`pos_stale`; [FIYATLAR.md › Şube başına kasa](FIYATLAR.md#şube-başına-kasa-şube-kapsamı-a3-24-kasım-2026)) |
| Personel | Pencerede seçilen şube (yeni kişide seçili fiziksel şube; "Tümü"de birden çok şube açıkken boş başlar, seçilmeden kaydedilmez) |
| Sabit gider | Pencerede seçilen şube ya da "İşletme geneli" (yeni kalemde seçili şube, "Tümü"nde işletme geneli) |
| Ödeme hatırlatıcısı | Formda seçilen şube ya da "İşletme geneli" (yenide seçili fiziksel şube, "Tümü"nde işletme geneli) |
| Kontrol listesi | Listede seçilen şube ya da "Bütün şubeler" (yeni liste seçili şubeyle başlar, "Tümü"de bütün şubeler) |
| Özel gün (maç, AVM, kampanya, kapalı, diğer) | Formda seçilen şube ya da "Bütün şubeler" (her tür; yeni gün seçili şubeyle başlar). Personelin eklediği gün şubesine kilitliyse o şubenin, değilse bütün şubelerin. Tek şube seçiliyken liste o şubenin ve bütün şubelerin günleri |
| Personel hesabı (Kullanıcılar) | Formda seçilen şube ya da "Bütün şubeler"; şubesi olan personel o şubede kilitli |

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
şube seçiliyken (kilitli personelde hep kendi şubesi) yoktur. Karaoke hiçbir şubede açık değilse personel (şubesiz de)
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
| Zayi "Tümü"de | Satır kaydın şubesini yazar; LafPOS'un ikram listesi LafPOS günü olan kasanın, adıyla (önceden "Tümü"de Tuzla'nınki okunuyordu) |
| Şubesiz personel "Tümü"de | Akşam zili raporu girilmemiş her kasa için ayrı satır ("Marina: Bugünün kasa raporu bekliyor"); Kullanıcılar ekranı şubesi seçilmemiş personeli sayar |
| Vardiya "Kişi ekle" ve yazarak doldurma | Başka şubeye kilitli hesap önerilmez (`shiftCandidate`) |
| Fiyatlar › Şube fiyatı, Eski fiyattan satılanlar | Panelin seçimi (önceden adresteki `?sube=` okunuyordu; seçici onu adresten düşürünce ilk şubeye dönüyordu). Geçmiş sekmesi sitedeki şube fiyatı kayıtlarını ayrı kartta gösterir |
| Silme engeli (ürün, hammadde) | Bütün şubelerden, eylemin sayacıyla (`productHistoryCounts`, `ingredientHistoryCounts`): Marina seçiliyken Tuzla'nın zayisi ya da sayımı da engeller |
| Hammaddeler › Kullanım | Şube seçiliyken "son ay · Marina satışı" |
| Claude bağlantısı ve panel asistanının araçları | İsteğe bağlı `sube` girdisi (ad, kimlik ya da "hepsi"); verilmezse panelin seçimi. Çıktı `kapsam` yazar; tedarikçi ve arama "Firma geneli". Şubesine kilitli hesap başka şubeyi isteyemez |
| Kasa raporu silindi (işlem geçmişi) | Birden çok kasa açıkken kasanın adı |

Sahibin varsayılanları (24 Kasım 2026, sonra Ayarlar'dan şube başına değiştirilebilir olacak): tek firma (Vergi, Nakit,
cari firma geneli, etiketli); Paraşüt hesabı ortak (faturalar işletme geneli; 25 Kasım'dan beri şube başına seçilebilir:
ayrı hesabın faturaları o şubenin, aşağıda); karaoke Tuzla'da; komisyon ve yemek kartı şubeler arasında aynı. Karaoke,
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
- **Henüz özellik değil**: tahmini stok LafPOS'un şubesine bağlı kalır (`STOCK_ESTIMATE_BRANCH`; LafPOS şubesinin
  türetilmesiyle birlikte taşınacak). Komisyon kanallarının ayarı (ödeme süreleri) işletme genelidir ("Şimdilik ortak").

## Şube başına ayarlar (25 Kasım 2026)

Şubeye göre değişebilen ayarlar şube başına tutulur (tablo `branch_settings`, migration 0081; grup başına şube başına
bir satır). Gruplar kodda: `src/lib/branch-settings/groups.ts`; kurallar `src/lib/branch-settings/rules.ts`; okuma ve
yazma `src/server/branch-settings.ts`.

| Grup | Alanlar | "Diğer şubeyle aynı" | Eski kaydın sahibi |
|---|---|---|---|
| `kasa.rapor` Kasa raporu alıcıları | e-posta adresleri, e-posta açık / kapalı, WhatsApp numarası | evet | Tuzla (varsayılan şube) |
| `kasa.calisan` Çalışanların gün sonu e-postası | çalışan adresleri, tutarlar görünsün mü | hayır: liste şubenin kendisinin | Marina (LafPOS'un şubesi) |
| `parasut` Paraşüt hesabı | yalnız bağ; hesabın ayarları ve oturumu Paraşüt ekranında, hesap adıyla ([PARASUT.md](PARASUT.md#şube-başına-paraşüt-hesabı)) | evet (= aynı hesap, tek eşitleme); kapatılınca **kopyalanmaz**, boş hesapla başlar | Tuzla (varsayılan şube; `parasut.settings` ve `PARASUT_*`) |

- **"Diğer şubeyle aynı"**: açıkken şube kendi değerini tutmaz (satırda `same_as`), bağlandığı şubenin değerini kullanır;
  değer tek yerden düzenlenir. Kapatılınca o anki değer şubeye kopyalanır, sonra ayrı düzenlenir. Gizli alanlar
  (şifreli, `secrets` sütunu) kopyalanmaz, yeniden girilir; istemciye yalnız "kayıtlı mı" gider. Bugünkü iki grupta
  gizli alan yok.
- **Bağ tek adımlıdır**: hedef başka şubeye bağlı olamaz, kendine bağ ve döngü yok (sunucu ve veritabanı denetler).
  Varsayılan şube (Tuzla) öbürlerinin örtük hedefidir, kendisi bağlanamaz. Başka şube bir şubenin ayarını kullanıyorsa o
  şube kapatılamaz ve silinemez ("Marina, kasa raporu alıcıları için Bodrum şubesinin ayarını kullanıyor; önce ayırın").
- **Geçiş: veri göçü yok, hiçbir şey yapmadan çalışır.** Satırı olmayan şube eski genel kayıttan (`integration_state` ›
  `cash.settings`) okur, ama yalnız kaydın sahibi şube: alıcılar Tuzla'nın, çalışan listesi Marina'nın. "Aynı" sunulan
  grupta öbür şubeler örtük olarak Tuzla'ya bağlı başlar (bugünkü tek liste). Kayıt yoksa ortamın alıcıları
  (`CASH_REPORT_RECIPIENTS`). İlk kayıtta satır yazılır, eski kayıt bırakılır (geri dönüş güvenli).
- **Okuyanlar şubeyi verir** (`loadCashSettings(şube)`; şubesiz çağrı kalmadı, `tests/branch-settings.test.ts`): kasa
  raporu e-postası raporun şubesinin alıcılarına, deneme e-postası kartın şubesininkine, WhatsApp metni raporun şubesinin
  numarasına; LafPOS gün sonu, Pavo ve fotoğraf e-postaları gün sonunun şubesinin alıcılarına ve o şubeye açık bildirim
  adreslerine (bütün şubeler ya da o şube; `dayEndRecipients(db, şube)`, şube zorunlu), çalışanların kısa e-postası
  gün sonunun şubesinin çalışan listesine. Zil ve "bu adres hangi listede" (Hesabım, Kullanıcılar) bütün açık
  şubelerin listelerine bakar.
- **Ekran**: Ayarlar › Şube ayarları (tek şube seçiliyken doğrudan o şubenin ekranı, "Tümü"de Şubeler listesi; özet
  satırı alıcıların kaynağını, karaokenin şubesini ve kullanılmayan özellikleri söyler; her fiziksel şubenin satırında
  "Alıcılar: Tuzla ile aynı" çipi ve **Ayarlar**). Şube ayarları ekranının en üstünde Özellikler kartı (yukarıda). Şube ayarları ekranı
  (`/panel/subeler/[id]`, yalnız yönetici) şubeyi adresten alır, panelin seçicisini değiştirmez. Kasa sayfasının Rapor
  alıcıları kartı aynı bileşen (`src/app/panel/kasa/cash-settings.tsx`, verisi `src/server/cash/settings-card.ts`);
  "Tümü"de her şube bölümünde kendi kartı. Birden çok kasa açıkken kartın ilk satırı "Tuzla ile aynı" anahtarı; açıkken
  form çizilmez, Tuzla'nın alıcıları salt okunur görünür ve "Tuzla şubesinde düzenle" bağlantısı çıkar. Tuzla'nın
  kartı "Marina şubesi de bu alıcıları kullanıyor" der. Çalışan listesi alanı LafPOS'lu şubede (ya da listesi doluysa);
  alanı olmayan kartın kaydı çalışan listesini göndermez, liste değişmez.
- **Yazım**: yalnız yönetici; değer, bağ ve işlem geçmişi tek işlemde, aynı grubun yazımları sıraya girer (grup başına
  işlem kilidi). Başka şubenin alıcılarını kullanan şubeye alıcı yazılmaz (eski sekme bağlı şubenin değerini sessizce
  ayırmasın): önce "aynı" kapatılır.
- **Yedek**: değerler ve bağ dosyaya girer, `secrets` sütunu girmez ([YEDEK.md](YEDEK.md)).
- **Paraşüt hesabı**: Şube ayarları ekranındaki Paraşüt kartı "Tuzla ile aynı" anahtarını ve kullanılan hesabın
  durumunu gösterir; hesabın bilgileri Paraşüt ekranında o şube seçiliyken girilir. Ayrı hesabın faturaları o şubenin
  (`invoices.branch_id`; Bağlantı kartından "işletme geneli" seçilebilir), ortak hesabınki işletme geneli. Tek şube
  seçiliyken öbür şubenin faturası Faturalar'a, Gelir-gider'e ve Maliyet'e girmez (Vergi, Nakit ve Ödemeler firma
  geneli; [PARASUT.md](PARASUT.md)). Şubeler
  listesinde "Paraşüt: Tuzla ile aynı" çipi. Şubenin hesabından fatura gelmişse şube silinemez.
- **Şimdilik ortak** (sıradaki dilimler; ekran adıyla söyler): LafPOS bağlantısı ve geçiş günü,
  çalışma ve uyarı saatleri, komisyon ve yemek kartı kanalları, ModPOS ay yedeği. Şube başına olmayacaklar: KDV, reçete
  parametreleri, fire, hedef maliyet, FIFO başlangıcı, kategori ve POS eşlemeleri, site bağlantı sırrı, bildirim
  gönderen ve vade günleri.

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
- **Kapalı gün** şubenindir (denetim 13 Kasım KP-05; `special_days.branch_id`, göç 0063). Kasa'nın "Kafe kapalıydı"sı
  ve personelin bildirimi formun kasasını yazar; bildirimin onayı bildirimin şubesine (yöneticinin seçimine değil; konu
  Tuzla'da `gun:G`, ötekinde `gun:G:şube`). Şubesi boş satır işletme genelidir (Özel günler'de "Bütün şubeler", eski
  satırlar) ve her şubede kapalı sayılır; Özel günler'de kapalı günün şubesi seçilir, ikiz denetimi şube içinde, "Geri
  al" aynı şubeye döner. Kanıt (rapor, LafPOS gün sonu, kasadan çıkan, zayi) o şubenin kayıtlarıdır: Marina'nın raporu
  Tuzla'nın işaretini kaldırmaz, Tuzla'nın bildirimini engellemez. Bir şubenin kanıtı işletme geneli tek günlük işareti
  yalnız o şube için kaldırır: satır o gün raporu olmayan öteki etkin fiziksel şubelere şubeli kalır, onaylı
  bildirimleri oraya geçer (`clearClosedMark`). Bugün, zil ve LafPOS durumu her kasanın eksiğini kendi şubesinin
  işaretiyle susturur. Zilin ve sabah e-postasının **dünkü kontrol listeleri** de şube şube (22 Kasım 2026;
  `closedMarksOn`, `closedForBranch`): hiç açılmamış liste yalnız kendi şubesi kapalı işaretliyse eksik sayılmaz; bütün
  şubelerin listesi işletme kapalıysa (işletme geneli işaret ya da o gün açık her şubenin kendi işareti). E-postada
  kapalı şubede günün izi varsa (şubenin raporu ya da başlamış listesi) eksikler yine yazılır. Önceden ikisi de herhangi
  bir şubenin işaretine bakıyordu: Marina dün kapalıyken Tuzla'nın eksik listesi zile düşmüyor, Tuzla'nın kapalı
  gününün listesi Marina'nın raporu yüzünden e-postada eksik yazılıyordu. LafPOS'un gün sonu kanıtı şube verilmeyen
  okumada da yalnız LafPOS'un şubesinindir (Tuzla'nın eski deneme satırı sayılmaz). Birden çok kasa açıkken kontrol
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

## LafPOS'a geçiş günü şubenin kasasınındır (21 Kasım 2026)

LafPOS 21 Kasım 2026'dan beri Marina'da kurulu (gün sonunu Marina'ya yazar); Ayarlar › LafPOS'taki geçiş günü yalnız
**Marina'nın kasasınındır** (`branchSwitchDay`, `src/lib/lafpos/switch.ts`; canlıda 22 Kasım 2026). Tuzla'nın kasası
ModPOS'ta kalır: föyü çekilir, Kasa raporu, föy karşılaştırması, ürün listesi, ürün ikramı ve kasadaki fiyatlar Tuzla'da
bugünkü gibidir. Marina'da ModPOS bir daha kullanılmaz (sahip, 23 Kasım 2026; ModPOS dönemi 13–21 Kasım): föyün yedek
çekimi sürerse geçiş gününden sonraki günü saklanır ama sayılmaz. Ay ekranları Tuzla seçiliyken
geçiş gününü yok sayar, "Tümü"de iki şubenin satırlarını şube şube ayırır. Marina'nın gün sonu Kasa raporuna
kendiliğinden yazılır ve e-postası gider ([LAFPOS.md › Gün sonu otomasyonu](LAFPOS.md#gün-sonu-otomasyonu-22-kasım-2026)). Ayrıntı:
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
| Sabit giderden ekle | Kalemin şubesi (Marina'nın kirası Marina'nın ödemesi). Tek şube seçiliyken adaylar şubenin ve işletme genelinin kalemleri; "Tümü"de kalemin şubesi rozette |
| Ertele (tekrar eden) | Ertelenen dönemin tek seferlik kopyası serinin şubesinde kalır; önceden kopya işletme geneli iniyor, Marina'nın kirası Tuzla'nın Ödemeler'inde görünüyordu (denetim 21 Kasım #17) |
| Ödenmemiş faturalar ve cari | İşletme geneli (mal alımı şubeye bölünmez), her görünümde |
| Kasadan tedarikçiye işlenmemiş ödemeler (Teslim, fişsiz alışveriş) | Cari işletme genelidir, **kasa satırı şubenindir** (24 Kasım 2026): zilin sayısı, Tedarikçiler'in uyarısı ve tedarikçinin şeritleri tek şube seçiliyken yalnız o şubenin kasasınınkini gösterir, öbürlerini "Öbür şubenin kasasında N satır daha" diye söyler; birden çok kasa açıkken satır kasasının adını yazar. Liste süzülmez: Tuzla'nın kasasından ödenmiş fatura Marina'da da "kasadan ödenmiş olabilir" diye sessizdir (`cariHints`) |
| Kasadan faturalı alımlar (e-Arşiv, fatura) | Kasanın şubesinde: zil, Bugün, Genel bakış'ın ayın işleri ve Faturalar › Kontrol bekleyen seçili şubenin kasasından çıkanları gösterir (`scopeCashOutInvoiceState`); birden çok kasa açıkken satır "Kasa 24 Kas · Marina" yazar. Eşleştirme işletme geneli (fatura şubesizdir); Vergi ve bütün şubelerin sabah e-postası bütün şubeler, şubeye bağlı adresin sabah e-postası yalnız şubenin |
| Sabah e-postası, Nakit planı, Vergi, haftalık özet | Bütün ödemeler: para işletmenindir (`loadUpcoming` şubesiz çağrılır). Sabah e-postasında şubeye bağlı bildirim adresi yalnız şubenin ve işletme genelinin ödemelerini alır ([yukarıda](#şube-kapsamı-c-istekler-uyarılar-e-posta-claude-24-kasım-2026)) |

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

## Sırada ne var

Dalga 1 kütüğü ve ekranı, dalga 2 şube sütununu, seçiciyi ve para yolunun süzülmesini, dalga 3 kalan okumaların
süzülmesini ve şube görünümünde maliyeti kurdu. Şube başına ModPOS anahtarı ve föyün şube şube ayrılması kuruldu
([MODPOS-API.md › Şubeler](MODPOS-API.md#1a-şubeler-16-kasım-2026)). Şube sekmeleri, karşılaştırma kartı ve şubeye
özel fiyat `docs/planlar/sube.md`'de.

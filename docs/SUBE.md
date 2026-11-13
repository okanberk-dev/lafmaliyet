# Şubeler ve kanallar

Panel 4 Kasım 2026'ya kadar tek işletmeye göre kuruluydu. Marina şubesi açılınca ciro, kasa ve giderlerin şubeye
göre ayrılması gerekti; aynı listede laffogato.net'in **online kanalı** da duruyor, çünkü sitenin cirosu bir
şubenin cirosu değil ama işletmenin cirosudur.

Sahibin kararları (4 Kasım 2026):

| Soru | Karar |
|---|---|
| Menü, reçete, hammadde, tedarikçi | **Ortak**; şubeye göre değişen yalnız satış fiyatı ve "Satışta / Tükendi" |
| Panel | **Tek panel** (`ladmin.laffogato.net`) + üstte şube / kanal seçici |
| Marina'nın kasası | **ModPOS** (Tuzla gibi) |
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
| `opened_on` | Açılış günü. Boşsa Tuzla "başından beri" sayılır (şubelerden önceki bütün veri onda); öteki şube ilk kasa satırının gününde açılmış sayılır |
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
| ModPOS | Şube başına ayrı anahtar; günlük 2 çekim hakkı şube başına |
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
nakit planı kartı, Tutarlılık (alınan mal şubeye bölünmez; tek şubenin tüketimiyle karşılaştırılmaz) ve Excel'e aktar
(panelin yedeği). Para ve beyan işletmenindir.

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
| Mal alımı (faturalar) | Bilgi olarak görünür, "işletme geneli"; mal maliyetine girmez |
| Personel | Şubeye bağlı kişilerin maaşı (Maaşlar'da kişinin **Şube** alanı) |
| Sabit gider | Şubeye bağlı kalemler + işletme geneli kalemler (Sabit giderler'de kalemin **Şube** alanı; boş = işletme geneli). Var olan kalemler işletme geneli kaldı |
| Harcama | Şubenin + şubesi boş (işletme geneli) harcamalar |
| Elle yazılan Gelir-gider hücresi | `manual:*` her şubede; `fixed:` / `stopaj:` kalemin şubesindeyse; **devir, personel, POS komisyonu** işletmenin toplamıdır, şubede yazılamaz (ekran kilitler, sunucu reddeder) |
| "Sayım yok" uyarısı | Yok: şubenin mal maliyeti sayıma bağlı değil |

"Tümü" eskisi gibi: sayımlı mal maliyeti (sayım, sayım aralığına dağıtım, tahmin). Aynı ayın aynı malzemesi iki şubede
sayıldıysa işletmenin stoğu toplamdır (birimi farklıysa ilk satırın birimine çevrilir).

### Yazarken hangi şube

| Kayıt | Şube |
|---|---|
| Kasa raporu, kasadan çıkan para | Seçili şube; "Tümü"nde Tuzla (kasadan çıkanın harcaması da o şubenin). Form da o şubeyi okur ve hangi şubenin raporu olduğunu yazar (P03) |
| Stok sayımı, ek kalem, zayi | Seçili **fiziksel** şube; "Tümü" ya da online kanal seçiliyken Tuzla. Stok sayımı ve Zayi & ikram başlığı birden çok açık şube varken hangi şubenin olduğunu yazar (P04) |
| Ay bilgisi (Satışlar'ın ay formu, Gelir-gider'in ciro, açık gün ve ay notu hücresi) | Seçili şube; "Tümü"nde Tuzla. Birden çok şube açıkken "Tümü"de Gelir-gider'in ciro ve açık gün hücresi kilitlidir ("şubeyi seçin"; sunucu da reddeder): hücre şubelerin toplamını gösterir, yazılan Tuzla'nın ayına inip öteki şubenin cirosunu iki kez saydırırdı. Satışlar'ın formu "Tümü"de başlığında **Tuzla** yazar, Tuzla'nın elle yazdığını ve kasasını gösterir; liste ↔ POS kutusu çıkmaz (liste bütün şubelerin) |
| Satış listesi, "Ayı temizle" | Seçili şube; "Tümü"nde Tuzla. Temizlik yalnız o şubenin satırlarını ve (istenirse) ay bilgisini siler |
| Harcama | Seçili şube; "Tümü"nde işletme geneli (boş) |
| Personel | Pencerede seçilen şube (yeni kişide seçili fiziksel şube) |
| Sabit gider | Pencerede seçilen şube ya da "İşletme geneli" (yeni kalemde seçili şube, "Tümü"nde işletme geneli) |

Stok sayımı kaydının çakışma hedefi `(ay, şube, malzeme)`: dalga 2'de tek şubesiz hedef kaldığı için sayım kaydı
"no unique or exclusion constraint" hatasıyla düşüyordu; `tests/sube-maliyet.test.ts` artık bütün kaynak dosyalarını
tarar.

### "Tümü"nün ay bilgisi (denetim 13 Kasım 2026, P02)

"Tümü" şubelerin toplamıdır. Kasa satırları (rapor, LafPOS gün sonu, ModPOS föyü) şubesini taşır
(`tillRows`, `src/server/data/cash-reports.ts`); ay bilgisi şöyle kurulur (`src/lib/cash-month.ts`):

| Ne | Kural |
|---|---|
| Açık gün, raporlu gün | **Günde bir kez**: Tuzla ve Marina aynı gün açıksa bir gün. Personel ve oranlanan sabit gider bu günle bölünür, oran en çok 1 (iki şube açıkken maaş ve kira iki kat sayılmaz); günlük ortalama ve ay sonu öngörüsü de bu günle |
| Ciro, indirim, ödenmez | Şubelerin toplamı |
| Kaynak önceliği | Rapor > LafPOS gün sonu > föy, **aynı şubenin aynı gününde**: bir şubenin raporu ötekinin föyünü düşürmez |
| Elle yazılan ay bilgisi | Her şube kendi elle yazdığı ve kasasıyla çözülür, sonra toplanır (`resolveBranchMonths`): Marina'nın elle yazdığı ciro Tuzla'nın kasa cirosunu silmez. Elle yazılan açık günün hangi günler olduğu bilinmediği için şubelerin en büyüğü alınır; kasadan gelen günler yalnız açık günü kasadan gelen şubelerin satırlarıyla birleşir (elle daha az gün yazan şubenin kasa günleri girmez). Kartlı oran ciro ağırlıklı |
| Açılış ayı | Raporlar şubenin açılış gününden beri girildiyse ay yarım sayılmaz: ciro ve açık gün kasadan (şube görünümünde, Kasa'nın ay satırında ve "Tümü"de). Açılış günü boşsa Tuzla dışındaki şube ilk kasa satırının gününde açılmış sayılır; yazılı açılış gününden sonra başlayan raporlarda ay yarım kalır, ciro elle girilir |
| Personel ve sabit gider | Şubeye bağlı kişi ve kalem "Tümü"de de kendi şubesinin günüyle oranlanır (açılış ayında açılış gününden; şube görünümüyle aynı); işletme geneli kalem işletmenin günüyle |

Aynı kuralla: Genel bakış'ın günlük ciro grafiği günün şubelerini tek çubukta toplar, nakit planının günlük satışı
bütün şubelerin cirosu ÷ raporlu gündür (Genel bakış'ın plan kartı da Ödemeler › Nakit planı gibi "Tümü"yle okur).

### Kasa ekranı, devir zinciri ve istekler (denetim 13 Kasım 2026, P03)

Kasa raporu şubenin raporudur: formu okuyan ve yazan hep aynı şube. Ayrıntı [KASA-RAPORU.md](KASA-RAPORU.md) › Şubeler.

| Ne | Kural |
|---|---|
| Kasa formu | Seçili şubenin raporu; "Tümü"de **Tuzla**'nın (yazdığı şube). Günün raporu, önceki devir, sonraki rapor, yazarkasa Z'si, kasadan çıkanlar, bekleyen istekler ve kapalı gün çubuğu o şubeden okunur. Birden çok şube açıkken form "Tuzla kasa raporu" diye hangi şubenin olduğunu yazar. Form açıldığı şubeyi gönderir; bu arada başka sekmede şube değiştiyse kayıt yapılmaz ("Şube seçimi bu arada değişti; sayfayı yenileyin") |
| Tek satırlık okumalar | Günün raporu, önceki devir, sonraki rapor ve yazarkasa Z'si "Tümü"de de tek şubenin (Tuzla) zinciridir (`cash-reports.ts` › `zincirKosulu`); günün kasadan çıkanları da (`cashOutsOn`) |
| Günden güne | "Tümü"de günün her şube raporu ayrı satır (şubenin adıyla), raporsuz gün tek satır. Z toplamı, nakit, kart ve kasa farkı bütün raporlardan; "rapor girilen gün" günde bir kez. Ay satırı Gelir-gider gibi şube şube çözülüp toplanır (`kasaMonthInfo`) |
| Açılış ↔ devir zinciri | Şube şube (`branchCarryChecks`, `carryOversBefore`): Kasa'nın listesi, zil, Bugün, haftalık özet ve Claude'un `kasa_raporlari`'nda Marina'nın açılışı Tuzla'nın devriyle karşılaştırılmaz |
| Kasadan çıkanlar | Şubenin satırları; raporun "Gün içinde çıkan"ı, e-posta ve WhatsApp öteki şubenin fişini saymaz. Personelin kapısı satırın şubesine bakar. Kasa'nın kartı açıldığı şubeyi gönderir: yeni satır ve ekleme isteği o şubeye yazılır, seçim başka sekmede değiştiyse yazılmaz; düzeltilen satır kendi şubesinde kalır |
| Personel istekleri | Düzeltme, silme, geç rapor ve kapalı gün bildirimi şubesini taşır (yükte `branchId`). Konu gün ve şube: Tuzla'nınki eskisi gibi `gun:<gün>`, öteki şubeninki `gun:<gün>:<şube>`. Onay yöneticinin seçili şubesine değil isteğin şubesine yazar; bir şubenin onayı, silmesi ya da raporu yalnız kendi şubesinin isteklerini kapatır. Şubeden önce açılmış istek: düzeltmede raporun (`reportId`) şubesi, ötekilerde Tuzla |
| Gün kilidi, geç rapor | Şube içinde: Marina'nın raporu Tuzla personelinin dününü kapatmaz, Tuzla'nın geç raporunu engellemez, zincirde halka sayılmaz |
| Kapalı gün | Şube başına (`special_days.branch_id`, migration `0059_kapali_gun_subesi`): Kasa'nın "Kafe kapalıydı"sı ve bildirimin onayı formun şubesini yazar; Özel günler'de şube seçilir, "Bütün şubeler" (şubesi boş) işletme genelidir. Marina'nın raporu Tuzla'nın işaretini kaldırmaz; işletme geneli tek günlük işaret Marina'nın raporuyla yalnız Marina için kalkar, Tuzla'da şubeli satır olarak kalır. Kanıt ve Z boşluğu şubenin raporlarından |
| Bugün ve eksik rapor zili | Personelin satırı ve akşam zili yazdığı şubenin raporuna bakar ("Tümü"de Tuzla): Marina'nın raporu Tuzla'nın satırını "gönderildi" yapmaz. Yönetici "Tümü"de her şubenin dünkü ve bugünkü raporunu ayrı satırda görür; "Dünkü kasa raporu girilmedi" zili şube şube |
| E-posta, WhatsApp, zil | İki şubenin aynı günkü raporu aynı numarayı alır: birden çok fiziksel şube açıkken konu, başlık ve WhatsApp'ın ilk satırı şubeyi yazar ("Kasa raporu KR-20261112 · Marina · …"). İşlem kaydının ve zil satırlarının anahtarına Tuzla dışındaki şube eklenir (Tuzla'nınki değişmez; okunmuş zil satırı okunmuş kalır). Onaylar'daki kasa kartları şubenin adını rozetle yazar |

### Stok ve zayi (denetim 13 Kasım 2026, P04)

Sayım ve zayi şubenin işidir: ekran yazdığı fiziksel şubeyi ("Tümü" ya da online kanal seçiliyken Tuzla) okur.

| Ne | Kural |
|---|---|
| "Listede olmayanlar" (ek kalem) | Sayım gibi şube başına (`stock_extras.branch_id`, migration `0060_ek_kalem_subesi`; eski satırlar Tuzla'nın). Marina'nın sayımı Tuzla'nın ek kalemini görmez; aynı adla yazınca kendi satırı açılır, kendi listesini kaydedince Tuzla'nınki silinmez. Kilit ve "başkası kaydetti" denetimi (ay, şube). "Tümü"nün stoğu şubelerin ek kalemleriyle toplanır. Personelin yeni kaleminin fiyatı bütün şubelerin geçmişinden gelir (kalemin fiyatı işletmenin) |
| Fiyatsız ek kalem uyarısı | Zil ve Bugün: tek şube seçiliyken o şubenin, "Tümü"de her şubenin ayrı satırı; birden çok şube açıkken "Marina · Ekim 2026: 2 ek kalemin fiyatı yok", bağlantı o şubeyi seçer (`&sube=`) |
| Zayi listesi | Zayi & ikram'ın günü (liste, form, kilit, LafPOS günü) yazdığı şubenin; birden çok şube açıkken başlık şubeyi yazar. Ay özetinin rakamı da kalem listesi de seçimle ("Tümü"de bütün şubeler). Kasa raporunun zayi özeti (form, e-posta, WhatsApp) raporun şubesinden, personelin Bugün'ündeki zayi satırı yazdığı şubeden |
| Zayinin kasa kilidi | Şube içinde (kasanın kuralı gibi): Tuzla'nın dünkü ve bugünkü raporu Marina personelinin dünkü zayisini ve silmesini kilitlemez |
| Sayım hatırlatması | Ay sonu bildirimi, sabah e-postası ve "Tümü"deki zil açık her fiziksel şubenin sayımına bakar: Tuzla bitirdi diye Marina'nın eksiği susmaz. Açılış günü sonraki bir aydaysa o aya hatırlatılmaz (boşsa şube açık sayılır; henüz açılmamış şube için Şubeler'de açılış günü yazılır). Birden çok şube açıkken metin şubeyle başlar ("Marina · Ekim 2026 sayımı girilmedi"), bağlantı o şubeyi seçer; tek şubede metin eskisi gibi. Tek şube seçiliyken zil yalnız o şubeninki |
| LafPOS'un ürün ikramı | Yalnız kasası LafPOS olan şubede (Şubeler › Kasa): ürün ikramı orada LafPOS'ta işaretlenir, panele girilmez. ModPOS'lu Marina'nın ürün ikramı geçiş gününden sonra da panelden girilir ve sayılır; Tuzla'nın gün sonu yalnız Tuzla'nın panel kaydını düşürür. Geçiş günü kaydı Tuzla'nın (LafPOS'un gün sonunu yazdığı şube) kasasını LafPOS yapar, gün silinince ModPOS'a döner |
| Stok tutarı | Faturalar işletme genelinde, sayım şube başına: FIFO'da her şube aynı faturalardan değerlenir, şube tutarlarının toplamı "Tümü"nün stoğunu tutmaz. Birden çok şube açıkken stok kartı bunu yazar (sahibe soru, varsayılan) |

## Sırada ne var

Dalga 1 kütüğü ve ekranı, dalga 2 şube sütununu, seçiciyi ve para yolunun süzülmesini, dalga 3 kalan okumaların
süzülmesini ve şube görünümünde maliyeti kurdu. Şube sekmeleri, karşılaştırma kartı, şube başına ModPOS anahtarı ve
şubeye özel fiyat `docs/planlar/sube.md`'de.

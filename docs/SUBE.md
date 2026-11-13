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
| Kasa raporu, kasadan çıkan para | Seçili şube; "Tümü"nde Tuzla (kasadan çıkanın harcaması da o şubenin) |
| Stok sayımı, zayi | Seçili **fiziksel** şube; "Tümü" ya da online kanal seçiliyken Tuzla. Stok sayımı başlığı birden çok açık şube varken hangi şubenin sayıldığını yazar |
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

## Sırada ne var

Dalga 1 kütüğü ve ekranı, dalga 2 şube sütununu, seçiciyi ve para yolunun süzülmesini, dalga 3 kalan okumaların
süzülmesini ve şube görünümünde maliyeti kurdu. Şube sekmeleri, karşılaştırma kartı, şube başına ModPOS anahtarı ve
şubeye özel fiyat `docs/planlar/sube.md`'de.

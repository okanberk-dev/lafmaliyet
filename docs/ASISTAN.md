# Panel asistanı

Ekran: **yalnız yöneticide**. Masaüstünde her panel sayfasının sağ altında küçük yuvarlak düğme (parıltı simgesi,
"Panel asistanı"); tıklayınca sağ altta 400 × 560'lık bir pencere açılır. **Telefon ve tablette** (lg altı) yüzen düğme
yoktur: asistan **alt menünün ortasındaki "Asistan" sekmesinden** açılır, alt menünün üstünde biten sade bir tam ekran
sayfadır (aşağıda Telefonda). Panelin verisine (LafPOS'un gün sonları ve günlük satışları dahil) bakarak soruları
yanıtlar ve panelin nasıl kullanılacağını gösterir. **Kendisi hiçbir şeyi değiştirmez:** birkaç risksiz işi (Tükendi, fiyat, ödendi işareti, hatırlatıcı, kasadan çıkan, vardiya…) bir **onay kartıyla** hazırlar;
siz karttaki **Onayla**'ya basmadan hiçbir şey değişmez (aşağıda İşlemler). Silme, toplu işlem, şifre isteyen ve riskli
işleri yapmaz; ilgili ekranın bağlantısını ve kısa, numaralı adımları verir (aşağıda Yapmadığı işler).

Örnek sorular (pencere boşken açık ekrana özel 3–4 tanesi çip olarak durur; aşağıda Sayfa bağlamı):

- "Dünkü gün sonu nasıldı?", "Dün kasa tuttu mu?" → LafPOS'un gün sonu: Z, ödeme türleri, kasa farkı, ikram, Pavo,
  dün ve geçen haftayla kıyas
- "Dün en çok ne sattı?", "Bu hafta kaç San Sebastian sattık?" → LafPOS'un gün gün ürün satışı
- "Bugün kim çalışıyor?" → vardiya
- "Ne bitmek üzere?" → Marina'nın tahmini stoğu, kritik malzemeler
- "LafPOS bağlantısı çalışıyor mu?", "Ne tükendi?", "Bekleyen ne var?", "Bugün ne yapmam lazım?"
- "Bu ay nasıl gidiyor?" → ayın cirosu, gideri, kârı, ay sonu tahmini
- "En çok kime borcumuz var?" → tedarikçilerin kalan borcu, büyükten küçüğe
- "Hangi ürünler hammaddeye bağlanmayı bekliyor?" → Paraşüt'ten gelip bağlanmamış ürünler ve **Ürün → hammadde
  bağlantıları** ekranına bağlantı (`/panel/parasut#urun-baglantilari`)
- "Süt zammı kârı nasıl etkiledi?" → zam etkisi, etkilenen ürünler, önerilen fiyatlar
- "Kasa farkı nasıl hesaplanır?", "Yedek nasıl alınır?" → panelin belgelerinden kısa açıklama ve ekran bağlantısı

## Nasıl kullanılır

- Soruyu yazıp **Enter** (yeni satır için **Shift+Enter**). Yanıt yazılırken akar; araç çalışırken altta durum satırı
  görünür ("Tedarikçi özeti hazırlanıyor…"). **Durdur** yanıtı keser.
- **Yeni sohbet** ekranı temizler ve yeni bir sohbet açar; önceki sohbet **Geçmiş**'te kalır (aşağıda Sohbet geçmişi).
  Etkin sohbet sekmede durur; başka cihaza geçmez.
- Yanıttaki panel bağlantıları aynı sekmede açılır (telefonda pencere kapanır, sayfa görünsün); dış bağlantı yalnız
  izin listesindeki sitelere (laffogato.net, Paraşüt, Claude), https ve yeni sekmede. Başka her adres (javascript:,
  http:, panelin dışına çıkan yol, listede olmayan site) bağlantısız yazı kalır (yalnız etiketi); yanıtta HTML
  çizilmez. Neden liste: araç sonuçlarında dışarıdan gelen metin var (Paraşüt kalem adları, LafPOS adları); onlarla
  yapılan istem enjeksiyonu panel verisini taşıyan bir bağlantı ürettirse bile tıklanamaz.
- **Esc** pencereyi kapatır (masaüstünde odak sayfadayken de). Masaüstünde pencere modal değildir: sayfa kullanılabilir.
  Telefonda sayfa modal değildir (alt menü kullanılabilir, aşağıda Telefonda). Ekran okuyucu yanıt bitince ilk
  cümlesini okur. Baskıda görünmez.
- **Telefonda** (390 ve 360 px genişlikte denendi) sayfa görünür alana oturur: ekran klavyesi açıkken yazı kutusu
  klavyenin hemen üstünde kalır, son mesaj görünür kalır. Üstte ve yanlarda güvenli alan (çentik) boş bırakılır; alttaki
  pay alt menünün içindedir. Karaoke "süre doldu" şeridi varken sayfa şeridin altından başlar (başlık ve Kapat
  örtülmez). Dar ekranda "Yeni sohbet" yalnız simgedir. Onay kartında satırların etiketi üstte, değeri altta durur ve
  yazılar bir boy büyüktür.
- Düğmenin yeri (yalnız masaüstü): köşede; yapılmamış hatırlatma kartı ya da kaydetme çubuğu açıkken onların üstünde.

## Sayfa bağlamı

- Asistan **açık olan ekranı bilir**: her soruda tarayıcı ekranın yolunu (`/panel/kasa`) ve adreste seçiliyse ayı
  (`?ay=2026-11`) ya da günü (`?gun=2026-11-24`) gönderir; sorgunun geri kalanı, çapa ve sayfanın içeriği gitmez.
  Sunucu bundan tek kısa satır yazar ("Yöneticinin açık ekranı: Kasa raporu (/panel/kasa); ekranda seçili ay: Kasım
  2026") ve onu sistem isteminin **değişken** bloğuna (tarih ve şubenin yanına, önbellek işaretinden sonra) ekler: sabit
  istem ve araç tanımları bayt bayt aynı kalır, önbellekten okunur. Ekranın adı menüden gelir; yol yalnız panelin
  biçimindeyse (küçük harf, rakam, tire) kabul edilir, bozuksa satır yazılmaz (soru yine gider). Şube zaten panelin
  seçicisinden okunur. "Bu ne demek?", "buradaki farkı açıkla" gibi sorular bu ekranı kastedebilir; soruda başka dönem
  ya da şube geçiyorsa o geçerlidir.
- **Ekrana özel öneriler:** asistan boşken açık ekrana göre 3–4 çip (en uzun eşleşen yol; alt sayfa ana ekranınkini
  alır, eşleşmeyen ekranda genel liste). Örnekler: Paraşüt'te "Bağlanmayı bekleyen ürünleri özetle", Kasa'da "Bugünkü
  kasa farkını açıkla", Vardiya'da "Bu hafta kimin vardiyası eksik?", Ödemeler'de "Geciken ödemeler neler?". Liste
  `src/lib/assistant/page-context.ts` › `PAGE_SUGGESTIONS` (her kayıt menüdeki gerçek bir ekran; testli). Çipler yalnız
  okuma sorusudur; işlem (onay kartı) öneren çip yoktur.

## Takip önerileri

- Bilgi veren her yanıtın altında, modelin önerdiği **2–3 kısa takip sorusu** çip olarak durur ("Geçen haftayla
  kıyaslar mısın?"); dokununca soru olarak gider. **Ek API çağrısı yoktur:** model aynı yanıtın sonuna etiketli bir
  blok yazar (`<takip>` … `</takip>`, sistem isteminde tarif edilir); tarayıcı bloğu yanıttan ayırır. Akarken blok ve
  yarım gelen etiket görünmez; bitince metin bloksuz saklanır ve sonraki sorunun geçmişine de bloksuz gider.
- Güvenlik: bloğun içi veridir. Her satır düz yazıya indirilir (etiket, markdown işareti, görünmeyen ve yön değiştiren
  karakterler atılır), bağlantı ya da adres taşıyan satır düşer, en çok 3 soru, her biri en çok 80 karakter; ekranda
  React yazısı olarak çizilir (HTML yok). Bir öneri yalnız soru olarak gönderilir: işlem gerekirse yine onay kartı çıkar.
- Onay kartı açılan, bilgi sorulan (eksik bilgi), hata ya da retle biten yanıtta ve selamlaşmada öneri yazılmaz.
  Öneriler yalnız son yanıtın altında görünür. Dosya: `src/lib/assistant/followups.ts`, çipler `followup-chips.tsx`.

## Telefonda

- **Alt menü:** yöneticinin alt menüsü asistan açıkken **Bugün · Kasa · Asistan · Ödemeler · Tümü** olur (asistan
  kapalıysa, `ASISTAN_KAPALI=1`, ve personelde değişmez). Beş öğe kalır: altıncı öğe 360 px'te hücreyi 60 px'e indirir,
  "Genel bakış" yazısı kesilir. Çubuktan çıkan **Genel bakış**: öğelerin içinde her ekranda tek dokunuşluk ikinci yolu
  olan yalnız odur (üst çubuktaki L'Af karosu ana sayfaya, Genel bakış'a gider; çekmecede de durur; giriş de orada
  açılır). Bugün, Kasa ve Ödemeler'in (gecikmiş rozeti) başka tek dokunuşluk yolu yok. Asistan ortada, sade: aynı
  hücre, parıltı simgesi marka renginde; yükseltilmiş daire, gölge yok (AkmanOS alt menüsünün diliyle).
- **Açıkken:** alt menü görünür kalır, "Asistan" sekmesi etkin görünür (hap); sayfa üst çubuğu örter ve alt menünün
  hemen üstünde biter. Sekmeye yeniden dokununca kapanır; başka bir öğeye dokununca asistan kapanır ve o ekran açılır
  ("Tümü" çekmeceyi açar). Yanıttaki bir panel bağlantısı da sayfayı kapatıp ekranı açar. Arkadaki sayfa ve üst çubuk
  bu sırada etkisizdir (odak ve ekran okuyucu yalnız asistanla alt menü arasında gezer). Konuşma sekme kapanmadıkça
  kalır: yeniden açınca kaldığı yerden sürer.
- **Klavye:** yazı kutusuna dokununca ekran klavyesi açılır, alt menü gizlenir, sayfa klavyenin hemen üstünde biter;
  klavye kapanınca alt menü geri gelir. Açılışta yazı kutusuna değil başlığa odaklanılır (klavye kendiliğinden açılmaz).
- **Göz yormasın:** sayfa zemininde, kenarlık ve gölge yok; başlık tek satır ("Panel asistanı", Yeni sohbet, Kapat).
  Mesaj balonu yok: soru hafif zeminli düz bir blok, yanıt altında düz metin. Yazılar 16 px, satır aralığı geniş
  (1,75), turlar arası boşluk bol; başlık, madde ve tablo yanıtın içinde ayrışır, tablo yatay kayar. Koyu temada yanıt
  saf beyaz değil, bir ton kısık (`ink-soft`): siyah zeminde parlama yapmaz; kalın yazı ve rakam beyaz kalır. Alttaki
  ipucu satırı telefonda yalnız uyarı varken (son 10 soru, soru çok uzun) görünür. Onay kartı tek sütun, çizgisi bir
  ton açık, dış etki rozetleri gri; renk yalnız uyarıda ve sonuçta.
- Dokunulan her şey (sekme, Gönder, Durdur, Kapat, Yeni sohbet, çipler, kartın Onayla / Vazgeç'i) en az 44 px; yazı
  kutusu 16 px (iPhone odakta yakınlaştırmaz).

Yanıtlar panelin verisinden gelir ama yanlış olabilir: önemli bir rakamı (ödeme, vergi) ekranda kontrol edin. Vergi
rakamları paneldeki gibi tahmindir.

## İşlemler (onay kartı)

Ayrıntılı katalog ve kurallar: [ASISTAN-ISLEMLER.md](ASISTAN-ISLEMLER.md).

Asistanın onay kartıyla hazırlayabildiği işler:

| İş | Örnek |
|---|---|
| Ürünü Tükendi yapmak ya da yeniden satışa açmak (siteye bağlı ürün; LafPOS'a yansır) | "Ice Latte bitti, tükendi yap" |
| Paraşüt'teki bir ürünü hammaddeye bağlamak (tek ürün, çarpanıyla) | "LAKTOZSUZ SÜT 1 LT'yi Süt Laktozsuz'a 1000 çarpanla bağla" |
| Ödeme hatırlatıcısı eklemek; bir hatırlatıcının bu dönemini ödendi işaretlemek | "Her ayın 5'inde kira hatırlatıcısı ekle", "Kira ödendi" |
| Faturayı ödendi (ya da ödemesi talep edildi) işaretlemek | "Sütaş'ın 12 Kasım faturası havaleyle ödendi" |
| Tedarikçiye ödeme kaydı girmek (havale, elden, kart, çek; kasadan değil) | "Ambalajcı'ya bugün 3.000 ₺ havale yaptık" |
| Hammaddenin paket fiyatını değiştirmek | "Süt paketi artık 48 ₺" |
| Bir ürünün (tek boy) satış fiyatını değiştirmek; kart siteye ve LafPOS'a etkisini gösterir | "Latte M 90 ₺ olsun" |
| Bugünün kasasına kasadan çıkan eklemek; Aylık harcamalar'a gider eklemek | "Tuzla kasasından Migros'a 85 ₺ süt aldık" |
| Zayi ya da ikram kaydı | "Marina'da 2 cheesecake döküldü" |
| Tek kişinin vardiyasını ayarlamak (aynı haftanın günleri) | "Ayşe Cuma 10-18, Pazar izinli" |

- **Kart:** ne yapılacağı, eski → yeni değerler, şube, gün, kişi / ürün, dış etki rozetleri (Site / QR menü, LafPOS,
  ModPOS kasası, Kasa raporu, Gelir-gider…), geri alma yolu ve 10 dakikalık süre. Kartı sunucu yazar; asistanın
  açıklaması ayrıca "Asistanın notu" olarak durur. **Onayla** işlemi yapar, **Vazgeç** kartı kapatır; süre dolunca kart
  hiçbir şey yapmaz.
- **Bir kez:** kart tek kullanımlıktır; ikinci dokunuş, yenilenen sayfa ya da başka bir yöneticinin dokunuşu ikinci
  kayıt açmaz. Onaydan önce değer değiştiyse (ör. fiyat bu arada başka yerde değişti) işlem yapılmaz, kart "Değer
  değişti, yeniden bakın" der.
- **Geri al:** fiyat, Tükendi, ödendi işareti, hatırlatıcı, Paraşüt bağlantısı değişikliği ve vardiyada sonuç kartında
  **Geri al** düğmesi 1 saat durur (bir kez). Yeni kasa satırı, gider, zayi ve ödeme kaydı silinerek geri alınır: asistan
  silmez, kart ekranı gösterir.
- **İşlem geçmişi:** onaylanan iş sizin adınıza yazılır ve Ayarlar › İşlem geçmişi'nde "… (asistan aracılığıyla)" diye
  görünür.
- **Şube:** kasa, zayi ve vardiya tek şubeye yazılır; panelde "Tümü" seçiliyken asistan şubeyi size sorar. Gider ve
  hatırlatıcıda "işletme geneli" de seçilebilir.
- **Bir yanıtta tek kart:** toplu işlem yapılmaz; birden çok kayıt istenirse birer birer, her biri ayrı onayla.
- **Yapmadıkları:** silme, toplu işlem (toplu fiyat, toplu bağlama, çok dönemi birden ödendi), faturayı ödenmedi yapma,
  fatura ekleme / düzenleme, reçete, kasa raporu, ayarlar, kullanıcılar, yedek, parola ve iki adımlı doğrulama. Bunlarda
  ekranın bağlantısını ve adımları verir; şifre isteyen işlerde parolayı sohbette istemez (aşağıda Yapmadığı işler).

## Yapmadığı işler (rehber)

Riskli ya da yapamadığı bir iş istenince asistan işi kendisi yapmaya çalışmaz: **İşlem rehberi**'ne bakar, ekranın
bağlantısını (**Ekranı aç**) ve kısa, numaralı adımları verir; varsa kendisinin yapabildiği güvenli yolu da söyler
(ör. "bütün ürünlere %10 zam" → Fiyatlar ekranı ve toplu değişikliğin adımları; tek ürünün fiyatını ise kartla
hazırlayabilir). Rehberin her girdisinde konu, asistanın neden yapmadığı, ekranın yolu ve adımlar yazılıdır.

| Tür | Örnekler |
|---|---|
| Rehber (riskli; yol gösterir) | Her türlü silme ve bildirimdeki Geri al, toplu fiyat, faturayı ödenmedi yapma, çok dönemi birden ödendi, kasadan tedarikçi ödemesi ve elle dağıtım, tedarikçi kartı ve IBAN, fatura ekleme / düzenleme, geçmiş günün kasası, kasa raporu ve onaylar, kapalı gün, reçete, siteye bağlama, satış eşleştirme, personelin isteklerine karar, Paraşüt eşitleme, hammadde birimi, vergi, karaoke rezervasyonu, ayarlar, LafPOS gününü silme (409 onarımı), şube, kullanıcılar, Hesabım |
| Hariç (hiç önermez; sorulursa yalnız ekran) | Giriş, çıkış ve parola sıfırlama, iki adımlı doğrulama kurulumu ve sıfırlama, davet bağlantısı, yedek, uygulama bağlama onayı, Paraşüt bağlantı ayarları, kasa e-posta alıcıları, bildirim alıcıları ve testleri, sistem geneli oranlar, cihaz bildirimleri, vardiya taslağı, personelin kendi istekleri |

Şifre isteyen işlerde (LafPOS gününü silme, kullanıcılar, Hesabım, yedek, davet) parola yalnız ekrandaki alana girilir;
asistan sohbette parola, kod ya da anahtar istemez.

## Hangi verilere bakar

Okuma araçlarının ilk yedisi Claude bağlantısınınkilerle aynıdır
([CLAUDE-BAGLANTISI.md](CLAUDE-BAGLANTISI.md): aynı hesap, aynı rakam); sonrakiler asistana özgüdür:

| Araç | Ne okur |
|---|---|
| Ay özeti | Ayın ya da yılın cirosu, giderleri, kârı, brüt kâr, ay sonu tahmini, başabaş |
| Ürün kârlılığı | Ürünlerin maliyeti, kârı, marjı, satış adedi, menü sınıfı |
| Zam etkisi | Fiyatı artan hammaddeler, ayda götürdükleri kâr, önerilen fiyatlar |
| Tedarikçi özeti | Tedarikçinin faturaları, ödemeleri, kalan borcu, gecikenler |
| Ödemeler | Geciken ve yaklaşan ödemeler, isteğe bağlı 6 haftalık nakit planı |
| Kasa raporları | Gün sonu raporları, Z toplamı, kasa farkı, girilmemiş günler (en çok 92 gün) |
| Arama | Ürün, hammadde, tedarikçi adları |
| Panel rehberi | Panelin belgelerinde arama (aşağıda Bilgi tabanı) |
| Paraşüt'te bekleyen ürünler | Hammaddeye bağlanmayı bekleyen Paraşüt ürünleri (Paraşüt sayfasındaki liste) |
| Gün sonu | LafPOS'un gün sonu (en çok 14 gün, varsayılan dün): Z no, fiş, Z toplamı, nakit / kart / yemek kartı / online, indirim, ödeme türleri, kasa sayımı ve kasa farkı, ikram / ödenmez / zayi ve iptaller, Pavo kart karşılaştırması, otomatik raporun eksikleri, dün ve geçen haftayla kıyas |
| Günlük satışlar | LafPOS'un gün gün ürün satışı (en çok 31 gün, bugün hariç): en çok satanlar, tek ürünün günlük adedi, hafta günleri, ürüne bağlanamayan adlar |
| LafPOS durumu | Bağlantı: geçiş günü, son gün sonu, reddedilen gönderimler ve onarımı, gelmeyen günler, eşleşmeyen adlar |
| Menü durumu | Tükendi ürünler (kim, ne zaman), sitede kapalı olanlar, kasada eski fiyatı duran ürün sayısı |
| Vardiya | Bir gün kim çalışıyor; bir haftanın planı kişi kişi |
| Bugün | Bugün ekranının özeti: sıradaki iş, Şimdi, Sonra, Tamamlananlar, Bugün kafede |
| Bekleyen işler | Zildeki bekleyen işler başlık başlık ve bugünkü hatırlatıcılarınız |
| Stok tahmini | Marina'nın tahmini stoğu, kritik malzemeler, tek malzemenin ayrıntısı (yaklaşık) |
| İşlem rehberi | Asistanın yapmadığı işlerde (silme, toplu, şifreli, riskli, ayar, güvenlik) ekran ve adımlar |

- **Şube:** araçlar panelde seçili şubeyle okur (üstteki seçici). "Tümü" işletme genelidir. Asistan yanıtında hangi
  şubeye baktığını söyler. Soruda şube adı geçerse ("Marina'da bugün kim var?") o şubeye bakar.
- **LafPOS:** kafedeki kasa programıdır (Marina). Ürün ve fiyatı siteden alır, her gün kapanınca gün sonunu (Z, ödeme
  türleri, kasa sayımı, ikram, satış listesi) panele iter; maliyet, reçete ve kâr panelde hesaplanır. Gün sonu ve günlük
  satışlar yalnız LafPOS'a geçilen günden sonrası içindir; öncesi denemedir. ModPOS'ta kalan şubenin (Tuzla) günleri
  Kasa raporları aracındadır.
- **Salt okur:** okuma araçları hiçbir şey yazmaz, eşitlemez, e-posta göndermez; onay kartı istemez.
- Kasa notu, ikram ve iptal gerekçesi, vardiya notu, hatırlatıcı notu, misafir adı, parola, anahtar, iki adımlı kod
  gibi bilgiler araçların çıktısında yoktur; adlar kısaltılır. Asistan gizli bilgi vermez.
- Araçların çıktısındaki adlar (ürün, tedarikçi, not) veri sayılır, talimat sayılmaz: faturadaki bir ürün adına "şunu
  yap" yazılsa da asistan uygulamaz.

## Ne saklar, ne saklamaz

- **Tarayıcıda:** etkin konuşma bu sekmenin oturum belleğinde (sessionStorage, kullanıcıya özel anahtar), en çok son
  40 mesaj; son 10 sohbetin görünen metni cihazın kalıcı deposunda (localStorage, kullanıcıya özel; yukarıda Sohbet
  geçmişi). Çıkışta ikisi de silinir.
- **Sunucuda:** hiçbir mesaj saklanmaz; yalnız onay kartlarının planı (`assistant_ops`: araç, girdi, kartın içeriği,
  durum, sonuç; denetim kaydıdır ve yedeğe girer, bekleyen kartlar girmez). Her soru `ai_calls` tablosuna tek satır yazar (tür `asistan`): kim sordu, ne
  zaman, model, süre, token sayıları, tutar (dolar), bitiş nedeni, kaç çağrı ve kaç araç çalıştığı. **Sorunun, yanıtın ve
  araç sonuçlarının metni yazılmaz.** Sunucu günlüğüne yalnız hata kodu ve Anthropic'in istek kimliği düşer; araç ve
  işlem hatalarında hatanın yalnız adı ve kodu (`src/lib/assistant/error-tag.ts`): sorgu hatasının iletisi modelin
  girdisini ("params: …") taşıdığı için yazılmaz.
- **Anthropic'e giden:** soru, aynı sohbetteki önceki soru ve yanıtların görünen metni (en çok son 20 mesaj), açık
  ekranın yolu ve seçili ay / gün (Sayfa bağlamı) ve araçların sonuçları (panelin verisi). Anthropic (ABD) bu isteği işler; fotoğraftan okumada olduğu gibi.

## Model ve maliyet

- Model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), efor **medium** (birkaç araçla çalışan sorular için önerilen ayar;
  yanıtlar kısa tutulur). Fiyat: milyon token başına girdi 2 $, çıktı 10 $, önbellekten okuma 0,10 $.
- Sabit kısım (yönergeler, ekran listesi, kavramlar, araç tanımları) her istekte aynıdır ve önbellekten okunur; bir
  sorunun araç turları da önceki turu önbellekten okur.
- Sabit önek (31 araç tanımı ve sistem istemi) yaklaşık 13–16 bin tokendir (tahmin: ~45 bin karakter Türkçe ve JSON;
  anahtarsız ortamda `count_tokens` çağrılamadı). Önbelleğin ömrü 5 dakikadır: aradan 5 dakikadan uzun süre geçince
  sıradaki soru öneki yeniden önbelleğe yazar (1,25×). Bu yüzden iki rakam: **ilk soru ≈ 0,05 $** (önbellek soğuk;
  önekin yazımı tek başına ≈ 0,035–0,04 $), **5 dakika içindeki sonraki sorular ≈ 0,01–0,03 $** (bir iki araç turu,
  önek önbellekten okunur). Ayın toplamı Ayarlar › Fotoğraftan okuma kartındaki "Bu ay" tutarına girer (okumalar ve
  vardiya taslaklarıyla birlikte).
- Efor neden **medium**: Sonnet 5.5'te `medium` çok adımlı araç kullanımı için, `low` sohbet için başlangıç noktasıdır.
  `medium`'da model en basit yanıttan önce de kısa bir düşünme yapar (ilk yazının gecikmesi ve çıktı tokeni artar);
  `low`'da basit sorularda düşünmez. Asistanın soruları çoğunlukla tek araçlı olduğundan `low` denenmeye değer: kalite
  ve gecikme gerçek sorularla (anahtarlı ortamda) ölçülüp karşılaştırılmadan değiştirilmez. Efor değişince önbellek
  bir kez yeniden yazılır.
- **Günlük sınır:** yönetici başına günde 60 soru (hata ve ret dahil her soru sayılır; derin analiz 2 soru sayılır). Sayım ve soru satırının eklenmesi
  tek işlemde, yönetici başına danışma kilidiyle yapılır: aynı anda gönderilen sorular sınırı aşamaz. Günün son
  sorusundan sonra pencere "Bugünkü soru sınırı doldu" der; pencere her açılışta kapıyı yeniden sorar (gece yarısı
  sayfa yenilenmeden açılır). Asistanın soruları fotoğraftan
  okumanın günlük sınırını tüketmez. Kalan hak 10'un altına inince pencerenin altında yazar.
- Bir soruda en çok **8 araç turu** ve yaklaşık **35 saniye**; dolunca asistan eldeki bilgiyle toparlar. 50 saniyede
  yanıt kesilir ("Süre doldu"). Soru en çok 4000 karakter.
- Soru reddedilirse (güvenlik sınıflandırıcısı) Anthropic'in sunucu tarafındaki yedek modeli denenir; o da reddederse
  pencere "Bu soruyu yanıtlayamıyorum" der.

## Sohbet geçmişi

- Başlıktaki **Geçmiş** düğmesi (saat simgesi) bu cihazdaki **son 10 sohbeti** listeler: başlık (ilk soru, en çok 60
  karakter), tarih ve soru sayısı. Satıra dokununca sohbet açılır ve kaldığı yerden sürer; çöp kutusu siler; "Yeni
  sohbet" yenisini açar. Açık olan sohbet silinirse ekrandan da gider.
- **Nerede:** tarayıcının kalıcı deposunda (localStorage), **kullanıcıya özel anahtarla**
  (`lafm.asistan.gecmis.v1.<kullanıcı>`): aynı cihazda başka bir yönetici yalnız kendi listesini görür. Sunucuya
  gitmez, başka cihaza geçmez. **Çıkış yapınca** bu kullanıcının geçmişi ve etkin sohbeti cihazdan silinir.
- **Ne saklanır:** yalnız görünen metin (soru, yanıt, yanıtın altındaki kısa not). Onay kartlarının yalnız **özeti**
  ("[Onay kartı: Latte M fiyatı — yapıldı]"): kartın kimliği, satırları, eski / yeni değerleri, uyarıları, notu ve
  sonucu saklanmaz; geçmişten açılan sohbette kart düğmesi yoktur, onaylanamaz. Takip önerileri saklanmaz. Sohbet başına
  en çok 40 mesaj.
- **Sunucuya giden değişmez:** her soruda yalnız etkin sohbetin son turları (en çok 20 mesaj; aşağıda Ne saklar).
  Geçmişe yanıt bitince yazılır (akarken değil). Dosya: `src/lib/assistant/history.ts`, liste `history-list.tsx`.

## Derin analiz

- Yazı kutusunun üstünde küçük bir **Derin analiz** anahtarı (beyin simgesi). **Varsayılan kapalı**; açılınca yalnız o
  soru için geçerlidir (gönderince kendiliğinden kapanır), soru ekranda "Derin analiz" işaretiyle durur.
- Ne değişir: efor **high** (olağan soru medium), bir soruda en çok **12 araç turu** (olağan 8), çıktı sınırı 16.000
  token (düşünme dahil; olağan 8.000). Süre sınırları aynı (yaklaşık 35 sn'de toparlar, 50 sn'de kesilir). Çok adımlı
  sorular için: "Bu ayın kârını geçen ayla kalem kalem karşılaştır", "Kasa farklarında bir örüntü var mı?".
- **Maliyet:** high eforda model daha uzun düşünür ve daha çok araç çağırır; çıktı tokeni (milyonu 10 $) birkaç
  katına çıkabilir. Üst düzey efor değişimi önbelleğin mesaj kısmını (bu modelde araç + sistem önekini de) geçersiz
  kılar: derin soru öneki bir kez yeniden yazar (≈0,035–0,04 $); ardından gelen olağan soru, 5 dakika içinde yazılmış
  medium önbelleğini okur. Tahmin: **derin soru ≈ 0,06–0,15 $** (olağan ≈ 0,01–0,05 $).
- **Günlük sınır:** derin analiz **2 soru sayılır** (satır `ai_calls`'a eforu `high` ile yazılır; sayım satırın
  eforundan ağırlıklı yapılır, sayım ve ekleme yine tek işlemde). Bugün 2'den az hak kaldıysa anahtar kapalıdır;
  sunucu da "Derin analiz 2 soru sayılır; bugün 1 soru hakkı kaldı" der (429, `deep_cap`), olağan soru sorulabilir.
- Neden mesaj içi efor değil: Sonnet 5.5'te efor bir sistem mesajıyla (beta `mid-conversation-output-config-2026-07-01`)
  mesaj içinde de değiştirilebilir ve önbelleği korur; anahtarsız ortamda canlı denenemediği için kullanılmadı (Açık
  kalanlar). Kod: `src/server/ai/assistant/loop.ts` › `ASSISTANT_DEEP`, sayım `src/server/ai/claude.ts`.

## Nasıl kapatılır

- **Ayarlar › Fotoğraftan okuma'yı kapatmak** Claude'a giden her isteği durdurur: asistan da kapanır (düğme görünür,
  pencere "kapalı" der). Okuma da kapanır.
- **Yalnız asistanı kapatmak:** Vercel'de ortam değişkeni `ASISTAN_KAPALI=1` (yeniden yayın gerekir). Düğme kimseye
  çizilmez, uç 404 döner; fotoğraftan okuma açık kalır.
- `ANTHROPIC_API_KEY` yoksa (yerel, önizleme) pencere "Asistan bu ortamda kurulu değil" der.

## Bilgi tabanı

"Nasıl yapılır" soruları panelin belgelerinden (`docs/*.md`) yanıtlanır. Belgeler bölümlere ayrılır, sadeleştirilir
(kod, dosya yolu, işlev adı atılır) ve sunucunun koduna gömülür. Kurulum, tasarım dili ve API ayrıntısı belgeleri
girmez; panelden kaldırılmış ekranlar da girmez (26 Ekim 2026'da kalkan sayım ve sipariş ekranları): onları anan
satırlar düşer, asistan bu ekranlara bağlantı vermez. Belge değişince `npm run asistan:bilgi` ile yeniden yazılır; unutulursa test düşer.

## Dosyalar (teknik)

- Uç: `src/app/api/asistan/route.ts` (GET durum, POST soru; satır satır JSON akışı; 60 sn). Kurallar ve sıra
  `src/server/ai/assistant/handler.ts`: açık mı → aynı köken → oturum → yalnız yönetici (403) → gövde şeması (soru ≤ 4000,
  geçmiş ≤ 20 mesaj, soru ve yanıt sırayla) → kapı (anahtar, ayar, günlük sınır) → `ai_calls` "running" (sayım ve
  ekleme atomik; sınır bu arada dolduysa 429) → akış → kayıt.
- Döngü: `src/server/ai/assistant/loop.ts` (Messages API, akışlı, `claude-sonnet-5-5`, `output_config.effort:
  "medium"`, `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`; `thinking`, `temperature` ve zorunlu
  `tool_choice` gönderilmez). Önbellek: araçlar → sabit sistem istemi (`cache_control`) → değişken bağlam (tarih, şube)
  → mesajlar (üst düzey otomatik önbellek). Tek istekteki araç döngüsünde asistanın içeriği (düşünme blokları dahil)
  değiştirilmeden geri gönderilir; bütün araç sonuçları tek mesajda, hata `is_error: true` ile. Önceki turlar yalnız
  görünen metin olarak gider: düşünme bloğu taşımadıkları için Sonnet 5.5'in geçmiş denetimi sorun çıkarmaz.
- Araçlar: `src/server/ai/assistant/tool-defs.ts` (MCP'nin yedi aracı aynen + `panel_rehberi`, `parasut_bekleyenler`),
  `read-tools.ts` (saf: `gun_sonu`, `gunluk_satislar`, `lafpos_durumu`, `menu_durumu`, `vardiya`, `bugun_ozeti`,
  `bekleyen_isler`, `stok_tahmini`; okuyucular dışarıdan verilir), `op-tools.ts` (işlem araçları ve `islem_rehberi`;
  rehberin girdileri `src/lib/assistant/guides.ts`), `tool-adapter.ts` (zod → `strict: true` araç tanımı; karmaşıklık
  sınırına önce işlem araçları, sonra okuma araçları sığdıkça strict, az karmaşık olan önce; girdi doğrulama, süre
  sınırı ve aracın iptal sinyali, hata sonucu), `tools.ts` (gerçek okuyucular). Araç sonuçları yalnız veri taşır
  (durum, satırlar); ne söyleneceği sistem isteminde ve aracın açıklamasındadır.
- LafPOS ve operasyon okuyucuları: `src/server/assistant-reads/index.ts`. Yalnız panelin mevcut okuma işlevleri
  (`loadLafposDayEnd`, `loadLafposZTotals`, `loadDayLafposIkram`, `dailyBranchSalesFrom`, `loadLafposCard`,
  `loadSoldOut`, `posPendingSummary`, `shiftsOn`, `loadShiftWeek`, `loadToday` ve Bugün'ün kuralları,
  `loadPanelNotifications`, `loadDueReminders`, `loadStockEstimate`); LafPOS'un yazıcıları (`gun-sonu.ts`, `ingest.ts`,
  `handlePosDay`) içe aktarılmaz. Serbest metinler burada atılır. Strict araç tanımları yapılandırılmış girdinin
  karmaşıklık sınırına sığan önektir; isteğe bağlı alanı çok olan okuma araçları (vardiya, günlük satışlar, stok) sınırın
  dışında kalır, girdileri yine zod'dan geçer.
- Sistem istemi: `src/server/ai/assistant/prompt.ts` (ekranlar `src/components/panel/nav.ts`'ten).
- Kapı ve kayıt: `src/server/ai/claude.ts` (`assistantStatus`, `startAssistantCall`, `finishAssistantCall`).
- Ekran: `src/components/panel/assistant/` (düğme ve pencere, güvenli markdown; panel düzenine bir kez eklenir,
  `src/app/panel/layout.tsx`). Açık / kapalı durumu `assistant-open.ts` (alt menünün sekmesi ile asistan ayrı ağaçlarda;
  ikisi bu küçük depoyu paylaşır). Alt menü: `src/components/panel/nav.ts` › `bottomNavFor`, `ASSISTANT_TAB`;
  `bottom-nav.tsx`; sekme yalnız yöneticide ve `assistantEnabled()` iken (düzen `Sidebar`'a `assistant` verir).
  Masaüstü düğmesinin yeri `src/app/globals.css` › `--assistant-bottom`, telefondaki sayfanın alt payı `--assistant-nav`.
- Bilgi tabanı: `src/lib/assistant/knowledge-build.ts` (derleme), `knowledge-data.ts` (üretilir), `knowledge.ts` (arama).
  TS modülüne gömüldü, çünkü `docs/` klasörü Next'in sunucu işlevinin izine kendiliğinden girmez; gömülü modül pakete
  girer, çalışma anında dosya okunmaz, testler doğrudan kullanır.
- Geliştirme: `AI_REPLAY=1 npm run dev` iken anahtarsız kayıtlı yanıt (`src/server/ai/replay.ts`): soruya göre bir araç
  gerçekten çalışır, yanıt aracın sonucunun kısa özetidir; Claude'a istek gitmez.
- İşlemler: [ASISTAN-ISLEMLER.md](ASISTAN-ISLEMLER.md) › Dosyalar (`src/server/assistant-ops/`, onay eylemi
  `src/server/actions/assistant-ops.ts`, kart `src/components/panel/assistant/op-card.tsx`).
- Testler: `tests/asistan-okuma.test.ts` (okuma araçları sahte okuyucularla, işlem rehberinin yolları src/app/panel
  altında gerçek sayfa ve bölüm mü, kataloğun Rehber ve Hariç eylemleri, okuyucu modülünün izin listesi, istem ve
  telefon arayüzü) ve `tests/asistan-okuma-db.test.ts` (`ASISTAN_TEST_DATABASE_URL`: gerçek okuyucular, hiçbir tablo
  değişmez); `tests/panel-asistani.test.ts` (sahte istemciyle istek, döngü, uç, markdown, bilgi tabanı) ve
  `tests/panel-asistani-db.test.ts` (`ASISTAN_TEST_DATABASE_URL`: günlük sınır, kayıt, bekleyen ürünler); işlemler
  `tests/asistan-islemleri.test.ts` (şemalar, kaynak taraması, kart olayı) ve `tests/asistan-islemleri-db.test.ts`
  (`ASISTAN_TEST_DATABASE_URL`: plan → onay → tek kullanım, süre, başka kullanıcı, bayatlık, geri al, her uyarlayıcı).

# Panel asistanı (sağ alttaki yardımcı)

Ekran: her panel sayfasında sağ altta küçük yuvarlak düğme (parıltı simgesi, "Panel asistanı"); **yalnız yöneticide**.
Tıklayınca masaüstünde sağ altta 400 × 560'lık bir pencere, telefon ve tablette tam ekran bir sayfa açılır. Panelin
verisine bakarak soruları yanıtlar ve panelin nasıl kullanılacağını gösterir. **Kendisi hiçbir şeyi değiştirmez:**
birkaç risksiz işi (Tükendi, fiyat, ödendi işareti, hatırlatıcı, kasadan çıkan, vardiya…) bir **onay kartıyla** hazırlar;
siz karttaki **Onayla**'ya basmadan hiçbir şey değişmez (aşağıda İşlemler). Silme, toplu işlem ve şifre isteyen işleri
yapmaz; ilgili ekranın bağlantısını ve adımları verir.

Örnek sorular (pencere boşken çip olarak da durur):

- "Bu ay nasıl gidiyor?" → ayın cirosu, gideri, kârı, ay sonu tahmini
- "En çok kime borcumuz var?" → tedarikçilerin kalan borcu, büyükten küçüğe
- "Hangi ürünler hammaddeye bağlanmayı bekliyor?" → Paraşüt'ten gelip bağlanmamış ürünler ve **Ürün → hammadde
  bağlantıları** ekranına bağlantı (`/panel/parasut#urun-baglantilari`)
- "Süt zammı kârı nasıl etkiledi?" → zam etkisi, etkilenen ürünler, önerilen fiyatlar
- "Kasa farkı nasıl hesaplanır?", "Yedek nasıl alınır?" → panelin belgelerinden kısa açıklama ve ekran bağlantısı

## Nasıl kullanılır

- Soruyu yazıp **Enter** (yeni satır için **Shift+Enter**). Yanıt yazılırken akar; araç çalışırken altta durum satırı
  görünür ("Tedarikçi özeti hazırlanıyor…"). **Durdur** yanıtı keser.
- **Yeni sohbet** konuşmayı siler. Konuşma yalnız bu sekmede durur: sekme kapanınca gider, başka cihaza geçmez.
- Yanıttaki panel bağlantıları aynı sekmede açılır (telefonda pencere kapanır, sayfa görünsün); başka sitelere bağlantı
  yalnız https ve yeni sekmede. Başka her adres (javascript:, http:, panelin dışına çıkan yol) bağlantısız yazı kalır;
  yanıtta HTML çizilmez.
- **Esc** pencereyi kapatır; pencere açıkken Tab pencerenin içinde döner. Baskıda görünmez.
- Düğmenin yeri: telefonda alt menünün üstünde; sayfada yüzen ekleme düğmesi (ör. Hatırlatıcılarım'daki "Yeni") varsa
  onun, kaydetme çubuğu açıksa çubuğun üstünde; masaüstünde köşede, yapılmamış hatırlatma kartı açıkken kartın üstünde.
  Telefonda aşağı kaydırırken kaybolur, yukarı kaydırınca gelir; ekran klavyesi açıkken gizlidir.

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
  ekranın bağlantısını ve adımları verir; şifre isteyen işlerde parolayı sohbette istemez.

## Hangi verilere bakar

Okuma araçları Claude bağlantısınınkilerle aynıdır
([CLAUDE-BAGLANTISI.md](CLAUDE-BAGLANTISI.md): aynı hesap, aynı rakam):

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
| İşlem rehberi | Asistanın yapmadığı işlerde (silme, toplu, şifreli, riskli) ekran ve adımlar |

- **Şube:** araçlar panelde seçili şubeyle okur (üstteki seçici). "Tümü" işletme genelidir. Asistan yanıtında hangi
  şubeye baktığını söyler.
- Personel adı, kasa notu, parola, anahtar, iki adımlı kod gibi bilgiler araçların çıktısında yoktur; asistan gizli
  bilgi vermez.
- Araçların çıktısındaki adlar (ürün, tedarikçi, not) veri sayılır, talimat sayılmaz: faturadaki bir ürün adına "şunu
  yap" yazılsa da asistan uygulamaz.

## Ne saklar, ne saklamaz

- **Tarayıcıda:** konuşma bu sekmenin oturum belleğinde (sessionStorage, kullanıcıya özel anahtar), en çok son 40 mesaj.
  Sekme kapanınca ya da **Yeni sohbet** ile silinir.
- **Sunucuda:** hiçbir mesaj saklanmaz; yalnız onay kartlarının planı (`assistant_ops`: araç, girdi, kartın içeriği,
  durum, sonuç; denetim kaydıdır ve yedeğe girer, bekleyen kartlar girmez). Her soru `ai_calls` tablosuna tek satır yazar (tür `asistan`): kim sordu, ne
  zaman, model, süre, token sayıları, tutar (dolar), bitiş nedeni, kaç çağrı ve kaç araç çalıştığı. **Sorunun, yanıtın ve
  araç sonuçlarının metni yazılmaz.** Sunucu günlüğüne yalnız hata kodu ve Anthropic'in istek kimliği düşer.
- **Anthropic'e giden:** soru, aynı sohbetteki önceki soru ve yanıtların görünen metni (en çok son 20 mesaj) ve
  araçların sonuçları (panelin verisi). Anthropic (ABD) bu isteği işler; fotoğraftan okumada olduğu gibi.

## Model ve maliyet

- Model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), efor **medium** (birkaç araçla çalışan sorular için önerilen ayar;
  yanıtlar kısa tutulur). Fiyat: milyon token başına girdi 2 $, çıktı 10 $, önbellekten okuma 0,10 $.
- Sabit kısım (yönergeler, ekran listesi, kavramlar, araç tanımları) her istekte aynıdır ve önbellekten okunur; bir
  sorunun araç turları da önceki turu önbellekten okur.
- Bir soru tipik olarak **0,01–0,03 $** tutar (bir iki araç turu); ayın toplamı Ayarlar › Fotoğraftan okuma kartındaki
  "Bu ay" tutarına girer (okumalar ve vardiya taslaklarıyla birlikte).
- **Günlük sınır:** yönetici başına günde 60 soru (hata ve ret dahil her soru sayılır). Asistanın soruları fotoğraftan
  okumanın günlük sınırını tüketmez. Kalan hak 10'un altına inince pencerenin altında yazar.
- Bir soruda en çok **8 araç turu** ve yaklaşık **35 saniye**; dolunca asistan eldeki bilgiyle toparlar. 50 saniyede
  yanıt kesilir ("Süre doldu"). Soru en çok 4000 karakter.
- Soru reddedilirse (güvenlik sınıflandırıcısı) Anthropic'in sunucu tarafındaki yedek modeli denenir; o da reddederse
  pencere "Bu soruyu yanıtlayamıyorum" der.

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
  geçmiş ≤ 20 mesaj, soru ve yanıt sırayla) → kapı (anahtar, ayar, günlük sınır) → `ai_calls` "running" → akış → kayıt.
- Döngü: `src/server/ai/assistant/loop.ts` (Messages API, akışlı, `claude-sonnet-5-5`, `output_config.effort:
  "medium"`, `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`; `thinking`, `temperature` ve zorunlu
  `tool_choice` gönderilmez). Önbellek: araçlar → sabit sistem istemi (`cache_control`) → değişken bağlam (tarih, şube)
  → mesajlar (üst düzey otomatik önbellek). Tek istekteki araç döngüsünde asistanın içeriği (düşünme blokları dahil)
  değiştirilmeden geri gönderilir; bütün araç sonuçları tek mesajda, hata `is_error: true` ile. Önceki turlar yalnız
  görünen metin olarak gider: düşünme bloğu taşımadıkları için Sonnet 5.5'in geçmiş denetimi sorun çıkarmaz.
- Araçlar: `src/server/ai/assistant/tool-defs.ts` (MCP'nin yedi aracı aynen + `panel_rehberi`, `parasut_bekleyenler`),
  `tool-adapter.ts` (zod → `strict: true` araç tanımı, girdi doğrulama, süre sınırı, hata sonucu), `tools.ts`
  (gerçek okuyucular).
- Sistem istemi: `src/server/ai/assistant/prompt.ts` (ekranlar `src/components/panel/nav.ts`'ten).
- Kapı ve kayıt: `src/server/ai/claude.ts` (`assistantStatus`, `startAssistantCall`, `finishAssistantCall`).
- Ekran: `src/components/panel/assistant/` (düğme ve pencere, güvenli markdown; panel düzenine bir kez eklenir,
  `src/app/panel/layout.tsx`). Düğmenin yeri `src/app/globals.css` › `--assistant-bottom`.
- Bilgi tabanı: `src/lib/assistant/knowledge-build.ts` (derleme), `knowledge-data.ts` (üretilir), `knowledge.ts` (arama).
  TS modülüne gömüldü, çünkü `docs/` klasörü Next'in sunucu işlevinin izine kendiliğinden girmez; gömülü modül pakete
  girer, çalışma anında dosya okunmaz, testler doğrudan kullanır.
- Geliştirme: `AI_REPLAY=1 npm run dev` iken anahtarsız kayıtlı yanıt (`src/server/ai/replay.ts`): soruya göre bir araç
  gerçekten çalışır, yanıt aracın sonucunun kısa özetidir; Claude'a istek gitmez.
- İşlemler: [ASISTAN-ISLEMLER.md](ASISTAN-ISLEMLER.md) › Dosyalar (`src/server/assistant-ops/`, onay eylemi
  `src/server/actions/assistant-ops.ts`, kart `src/components/panel/assistant/op-card.tsx`).
- Testler: `tests/panel-asistani.test.ts` (sahte istemciyle istek, döngü, uç, markdown, bilgi tabanı) ve
  `tests/panel-asistani-db.test.ts` (`ASISTAN_TEST_DATABASE_URL`: günlük sınır, kayıt, bekleyen ürünler); işlemler
  `tests/asistan-islemleri.test.ts` (şemalar, kaynak taraması, kart olayı) ve `tests/asistan-islemleri-db.test.ts`
  (`ASISTAN_TEST_DATABASE_URL`: plan → onay → tek kullanım, süre, başka kullanıcı, bayatlık, geri al, her uyarlayıcı).

# Yapılacaklar (ladmin)

Son güncelleme: 28 Kasım 2026. Kaynak: 25 Kasım yönetim paneli denetimi ve sahibin istekleri.

Etiketler:
- **[Ladmin]**: yalnız panelde değişiklik.
- **[İkisi]**: panelle birlikte AsilPOS'ta da değişiklik gerekir.
- **[Sahip]**: kodla değil, ayarla ya da hesapla çözülür.

AsilPOS deposunda değişiklik gerektiren her madde sahibin onayını bekler.

## Bitenler (25–28 Kasım 2026)

- **Mutabakat bölümü kaldırıldı** (bu PR, 28 Kasım; sahibin isteği: "ladmin'deki Mutabakat kısmını kaldır"): Kâr &
  ödemeler › Mutabakat (banka ve tedarikçi ekstresi eşleştirmesi, POS hakediş karşılaştırması), ekranı, eylemleri, okuma
  yolu ve saf modülü gitti; menüden, ⌘K'dan, yetki tablosundan, Yardım'dan, Hesabım › Şube görünümü'nden (Mutabakat
  alanı) ve asistanın bilgi tabanından çıktı. Eski adresler (`/panel/mutabakat`, `?sekme=pos` gibi sorgulular dahil)
  Gelir-gider'e "Mutabakat bölümü kaldırıldı" notuyla yönlenir. **Nakit planı, Ödemeler ve Gelir-gider aynı**: Mutabakat
  onlara rakam vermiyordu, testleri değişmedi. Tablolar (`recon_statements`, `recon_lines`) ve bloke günü ayarı
  silinmedi, yedek taşır; göç yok. Yüklenmiş ekstreler KVKK saklama süresiyle (yüklendiği gün + 90) günlük işte eskisi
  gibi silinir. Belge arşivde: [docs/arsiv/MUTABAKAT.md](docs/arsiv/MUTABAKAT.md).

- **Yönetici hesaplarını yalnız asıl yönetici yönetir; konsolda Yöneticiler sekmesi** (bu PR, 28 Kasım; K-B,
  docs/planlar/yonetim-konsolu.md, docs/ROLLER.md › Yönetici hesapları): bir yönetici hesabına dokunan iş (önceki ya da
  sonraki rol yönetici: yönetici açmak, yöneticilik vermek ve almak, yöneticinin e-postası, parolası, erişimi, silme,
  iki adımlıyı sıfırlama, kilit açma, oturum kapatma, giriş bağlantısı) yalnız asıl yöneticinin; ret parola sorusundan
  önce. Öteki yöneticiler müdür, muhasebeci ve personel hesaplarını bugünkü gibi yönetir, başka bir yöneticinin yalnız
  adını değiştirir, kendi hesabını Hesabım'dan. Asıl yöneticinin adresi hesap yokken de alınamaz. Konsol ›
  Yöneticiler (`/yonetim/yoneticiler`): liste, Yönetici ekle, Yöneticilik ver, İşlemler; üstte asıl yöneticinin iki
  adımlı durumu ve kalan kurtarma kodu. ladmin › Kullanıcılar'da yönetici satırları herkese salt okunur, Yönetici rolü
  kapalı. Kurtarma betiği `scripts/asil-yonetici-kurtar.ts` ve docs/DEPLOY.md › Asıl yönetici kilitlenirse. Göç yok.
  Kalan: K-C (ladmin'deki şube düğmelerinin kaldırılması, `/panel/sube-ekleme` yönlendirmesi, asıl yönetici
  eylemlerinin yalnız konsol oturumunu kabul etmesi).

- **Yönetim konsolu: şube işlemleri** (#189, 28 Kasım; K-A'nın ikinci yarısı, docs/planlar/yonetim-konsolu.md,
  docs/SUBE.md › Şube işlemleri): Şubeler ve kasalar'da her şube satırından "Şube işlemleri" sayfası (`/yonetim/sube/[id]`):
  kapatma ve yeniden açma, tür ve kasa programı (AsilPOS'tan ModPOS'a dönüşün onayı aynen), AsilPOS'a geçiş günü (kapalı
  dönem kuralı aynen), kasa anahtarını döndürme ve silme, eski anahtarı silme (parolayla, konsol oturumuyla), şubeyi
  silme (yalnız kaydı olmayan). Canlı şubede (son 7 günde gün sonu; bugün Marina) belirgin uyarı. Kasa anahtarı kartı ve
  geçiş günü formu `src/components/sube-islemleri/`'ye taşındı (ladmin ve konsol aynı bileşen). `updateBranch`'te
  kimlikten başka her alan isteğe bağlı; ladmin'in penceresi açık / kapalı, tür ve kasa programını yalnız değiştiyse
  gönderir. Kasaya giden metinler "Yönetim konsolu" der (adres yok). ladmin'in görünümü değişmedi; göç yok.
  Kalan: K-C (ladmin'deki düğmelerin kaldırılması, `/panel/sube-ekleme` yönlendirmesi, asıl yönetici eylemlerinin
  yalnız konsol oturumunu kabul etmesi); K-B yukarıda.

- **Yönetim konsolu: ayrı oturum ve giriş, kabuk, Şubeler ve kasalar** (#187, 28 Kasım; K-A'nın ilk yarısı,
  docs/planlar/yonetim-konsolu.md): `yonetim.laffogato.net` (yalnız asıl yönetici), ayrı belirteç ve çerez,
  `requireYonetim`, kendi girişi (başka her e-posta kayıtsız adres gibi yanıtlanır), alan adı kuralı (konsolda yalnız
  `/yonetim/*`; `/api/*` 404 `yanlis_adres`; panel adresinde proxy aynı), iki sekme: Şubeler ve kasalar (Şube ekleme'nin
  ortak bileşeni) ve Lisans ve güncelleme (Merkez bağlantısı, kasa durumu özeti). ladmin'in ekranları değişmedi.
  Kalan: alan adının Vercel'e eklenmesi (kod canlıya çıktıktan sonra; docs/DEPLOY.md › Yönetim konsolu alan adı).

- **Kasa açılışı uçları, ilk personel, Kasayı serbest bırak** (bu PR, 28 Kasım; P-B2,
  docs/planlar/kasa-acilis-ve-asil-yonetici.md): `POST /api/asilpos/acilis/giris` (asıl yöneticinin ladmin girişi;
  panelin giriş korumaları aynen, ortak modül `src/server/auth/giris-korumalari.ts`; çerezsiz, 15 dakikalık belirteç ve
  seçilebilir şubeler), `.../bagla` (boş şubeye bağlar, yanıt kurulum koduyla aynı biçimde; kurulu şube her zaman 409
  `zaten_kurulu`, anahtar dönmez; devralma yok), `.../teslim` (kasa ilk personeli aldığını şube anahtarıyla imzalı
  onaylar). Kasa kaydı `asilpos.kasa:<şube>` (kasa açılışı, kurulum kodu ve serbest bırakma yazar; kasa durumu önce ona
  bakar, kayıtsız Marina kurulu, eski deneme günlü Tuzla boş); "Bilgisayara kur" şubeyi hazırlar (ModPOS şubesi de kasada
  seçilebilir). Şube ekleme'de ilk personel (Patron, Müdür, Barista: ad ve PIN; mühürlü, yedek dışı, kasanın açık
  anahtarıyla şifreli teslim, onayla ya da 24 saat / 30 gün sonra silinir) ve **Kasayı serbest bırak** (asıl yönetici,
  ad ve parola; anahtar yenilenir, bekleyen kodlar iptal, kayıt boş). Kurulum koduna isteğe bağlı `kimlik`,
  `acikAnahtar` ve yanıtta `personel` (eski kasanın yanıtı aynı). Göç yok; var olan uçların yolu, gövdesi, imzası
  değişmedi. docs/ASILPOS.md › Kasa açılışı (`tests/kasa-acilis.test.ts`, `tests/kasa-acilis-db.test.ts`).
- **Asıl yönetici ve Şube ekleme sayfası** (bu PR, 28 Kasım; P-B1, docs/planlar/kasa-acilis-ve-asil-yonetici.md):
  şube açmak, kapatmak, silmek, kasa programını değiştirmek, kasa kurmak, kasa anahtarını döndürmek ve geçiş gününü
  değiştirmek yalnız asıl yöneticide (`requireAnaAdmin`; öteki yönetici "Bu işlemi yalnız asıl yönetici yapar: …" alır,
  ekranda alanlar kapalı ve nedeni yazılı). Asıl yöneticinin hesabı korunur: başka yönetici e-postasını, parolasını,
  rolünü, erişimini değiştiremez, silemez, iki adımlısını sıfırlayamaz, kilidini açamaz, oturumlarını kapatamaz, ona
  bağlantı üretemez; hiçbir hesap adresini asıl yöneticinin adresine çeviremez; o hesap açıldıktan sonra o adresle
  hesap açılamaz. Kullanıcılar & roller'de "Asıl yönetici" etiketi; Hesabım'da asıl yöneticinin e-postası sabit. Şube
  kapatılınca bekleyen kurulum kodları iptal olur, kapalı şubenin kodu 410 alır (yanıt biçimi aynı). Yeni **Ayarlar ›
  Şube ekleme** (`/panel/sube-ekleme`, yalnız asıl yöneticinin menüsünde): yeni şube, şubelerin kasa durumu ("Kasa
  kurulu değil" / "Kurulum bekliyor" / "Kasa kurulu · son gün"), "Bilgisayara kur" (kurulu kasa varsa önce onay; sonuç
  penceresinde şube, e-posta, giriş hesabı, bağlantı, son geçerlilik, dört adım). Şubeler'deki "AsilPOS kasası kur"
  kartı ve "Şube ekle" düğmesi kalktı; düzenleme penceresinin e-postası şubenin kendisinden dolar ve her yöneticide
  kaydedilir. Göç yok, kasanın çağırdığı uçların yolu ve gövdesi değişmedi. docs/ROLLER.md › Asıl yönetici,
  docs/SUBE.md › Şube ekleme, docs/ASILPOS.md › Şube kurulumu (`tests/asil-yonetici.test.ts`,
  `tests/asil-yonetici-db.test.ts`).
- **Personele kör sayımlı WhatsApp metni** (bu PR, 28 Kasım; sahibin bildirimi: "WhatsApp kopyala gitmiş ladmin'de, o
  olsun"): Marina'da (AsilPOS günü, kör kasa) personelin Kasa raporu kartında **WhatsApp ile gönder** ve **Metni
  kopyala** yine var. Metin sayımsız: açılış, sayılan nakit, teslim, olması gereken, kasa farkı, ertesi güne devir,
  açılış ↔ devir uyarıları ve "Değişen" satırı yok; kasa bölümünde nakit satış, giren, çıkan (kasadan çıkan satırlarıyla)
  ve "Kör sayım: açılış, sayılan nakit ve kasa farkı yalnız yöneticide."; not personelin kartındaki gibi süzülür.
  Sunucunun eylemi (`cashReportWhatsapp`) artık reddetmez, aynı metni verir. Düzenle ve silme isteği personelde yine yok.
  Yöneticinin metni ve Tuzla (ModPOS) günü bayt bayt aynı (altın metinle sınandı; `tests/whatsapp-kor.test.ts`,
  `tests/roller-db.test.ts`). docs/ASILPOS.md › Kör kasa.

- **Denetimin küçük hataları (bu PR, 28 Kasım)**: denetimin beş bulgusu, her biri kendi testiyle.
  - Satış yapıştırma: özet satırı deseni doğrusal zamanda (ReDoS). "toplam 111…1x" gibi bir ad süreyi her rakamda ikiye
    katlıyordu (40 rakam saatler); desen sunucuda da çalışır (İçe aktar, dosya yükleme, Genel bakış). Ad temizliği de
    uzun hücrede karesel süre almaz (`tests/satis-ozet-redos.test.ts`).
  - Muhasebeci ekranlarında yazma düğmesi ve açamayacağı ekrana bağlantı görmez: Faturalar, Gelir-gider, Aylık
    harcamalar ve Kasa raporu salt okunur çizilir (`src/lib/roles.ts` › `isReadOnly`, `openableHref`; docs/ROLLER.md ›
    Muhasebeci; `tests/muhasebeci-salt-okunur.test.ts`, `tests/muhasebeci-ekran-db.test.ts`).
  - Yükleme iskeleti rol okunmadan yönetici sekmelerini çizmez: İşçilik / ciro'da müdür Raporlar'ın, Aylık
    harcamalar'da muhasebeci Giderler'in sekmelerini bir an görüyordu (`tests/yukleme-iskeleti-rol.test.ts` bütün
    sayfaları tarar).
  - Şubesi kapalı müdür bildirim almaz: panele giremeyen müdüre Web Push ve e-posta gitmeye devam ediyordu
    (`src/server/notify/reachable.ts`; docs/BILDIRIMLER.md › Alıcılar ve hesaplar;
    `tests/kapali-sube-mudur-bildirim-db.test.ts`).
  - "Tümü"de kart (banka POS) komisyonu şube görünümlerinin toplamı: kasa kartı olmayan aylarda toplam ciroya tek oran
    uygulanıyordu (docs/KOMISYON.md; `tests/kart-komisyonu-tumu.test.ts`).
- **Site Next.js 16.4.6** (laffogato #303, 28 Kasım): sitenin açıklı sürümü (16.3.8) güncellendi.
- **Vergi bölümü kaldırıldı** (bu PR, 27 Kasım; sahibin kararı: vergiyi muhasebeci yürütüyor, "veriler silinmesin"):
  kenar çubuğundaki **Vergi, KDV, SGK** grubu ve dört ekranı (Özet, Vergi kârı, Demirbaş, Muhasebeci / Kurallar), vergi
  modülü (`src/lib/tax`), eylemleri, matrah, vergi kârı, geçici ve kurumlar vergisi, beyanlar (KDV, muhtasar), vergi
  takvimi, devreden KDV, KDV ödemesi tahmini, muhasebeciye sorulacaklar, dışa aktarımın Vergi sekmesi ve asistanın vergi
  rehberleri gitti. **Nakit planında vergi tahmini yok**: KDV kartı, KDV / KDV-2 / muhtasar / geçici vergi / damga
  satırları ve "Tahmine katılanlar"daki iki anahtarı kalktı; vergi ödemeleri Ödemeler'e tutarıyla yazılınca düz
  hatırlatıcı olarak girer. Kalanlar: ürün ve fatura KDV'si, yazarkasa Z'sinin KDV dökümü, muhasebeci paketi, maaşların
  SGK'lı işveren maliyeti (Giderler, Maaşlar, Gelir-gider), Gelir-gider'in "Kira stopajı" maliyeti, dönem kapanışı
  (zaten Ayarlar'da). Nakit planının maaş ve SGK'sı yasal bordroyla (`src/lib/bordro`; rakam değişmedi, Eylül SGK
  25.956,18 ₺); stopajlı sabit gider eskisi gibi net ödenir (stopajı muhasebeci öder, planda satırı yok). Eski adresler
  (`/panel/vergi` ve alt sayfaları) Genel bakış'a "Vergi bölümü kaldırıldı" notuyla yönlenir (muhasebeci Muhasebe'ye).
  Muhasebecinin ekranlarından Vergi çıktı, alt menüsünde yerine Harcamalar. Tablolar (`tax_assets`, `tax_filings`,
  `tax_adjustments`), sütunlar ve saklı ayarlar (`tax.settings`, `payments.vat-paid`, nakit planının eski devreden KDV'si)
  silinmedi; göç yok. Belge arşivde: [docs/arsiv/VERGI.md](docs/arsiv/VERGI.md).

- **Şube ayrımı** (bu PR, 27 Kasım; #167'nin üstünde; docs/SUBE.md › Şube ayrımı): soldan bir şube seçilince panelin
  her ekranında yalnız o şubenin bilgisi görünür: kasa, satış, faturalar, ödemeler, onaylar, zil, Bugün, raporlar,
  kişi seçicileri, Maaşlar, Kullanıcılar & roller, sabah e-postasının önizlemesi, panel asistanı, bağlantı (MCP), dışa
  aktarım ve muhasebeci paketi. "Tümü"de her şey bugünkü gibi; işletme geneli fatura ve gider her şubede görünür ama
  şubenin kârına girmez. Bugüne dek bilerek firma geneli olan ekranlar (Ödemeler, Nakit planı, Tutarlılık, Mutabakat,
  Tedarikçi bakiyeleri, Stok değeri, Komisyon, Şubeleri yan yana, İşletme geneli giderler) kişinin kendi
  ayarıyla: **Hesabım › Şube görünümü**'nde ekran ekran **Yalnız şube | Firma geneli** (düğmeler: Hepsi yalnız şube,
  Hepsi firma geneli, Varsayılanlara dön; seçim hemen kaydedilir, yalnız o hesabındır). Ekranın üstündeki çip
  (**Firma geneline geç** / **Yalnız Marina'yı göster**) aynı ayarı o ekran için yazar. Yöneticinin varsayılanı her
  yerde "Yalnız şube", muhasebecininki ekranına göre (İşletme geneli giderler "Tutarla göster"); müdür ve şubesine
  kilitli personel hep kendi şubesinde (ayar yok). **Vergi şubeye bölünmez** (sahibin kararı, 27 Kasım: "Vergi ile ilgili
  olan kısımları tamamen çıkar"; açıklaması: "gelir vergisi matrah vs o kısımdan bahsettim, sidebar değil; ürün KDV'si
  falan hesaplansın, nasıl doğruysa öyle olsun"): matrah, vergi kârı, geçici vergi, beyanlar (KDV, muhtasar), vergi
  takvimi, devreden KDV ve KDV ödemesi tahmini firma geneli. Vergi'nin üç sekmesi her kipte firmanındı (ayarı yok,
  şubenin payı ve matraha katkı kartları kalktı); aynı gün sahip bölümün tümden kaldırılmasına karar verdi (yukarıdaki
  madde: "menüde yerinde" notu geçersiz). Nakit planının şube kipinde vergi ve SGK hiç yok ("Vergi ve SGK ödemeleri
  firma geneli: Tümü'de görünür"; İşletme geneli satırında da yok). **Ürün ve fatura KDV'si şubede doğru kalır**:
  ürünün KDV dahil ve hariç fiyatı, satışların, şubenin faturalarının ve yazarkasa Z'sinin KDV'si Tümü'deki gibi; dışa
  aktarımın şube dosyasında Faturalar'ın KDV toplamları, şubenin muhasebeci paketinde KDV sütunları, Özet'in KDV
  satırları ve Z KDV dökümü durur, altlarında "KDV beyanı firma geneli: beyan için Tümü dosyası / bütün şubelerin
  paketi" notu. Hep firma geneli kalanlar (tam yedek, vergi ve SGK, banka
  ekstresi ve açılış bakiyesi, Paraşüt eşitlemesi, menü, reçete, hammadde fiyatı, tedarikçi kütüğü, site siparişleri)
  Hesabım'da gerekçesiyle listeli. Göç 0101 (şube görünümü; kontrol listesi kaydı, işlem geçmişi, gönderim
  günlüğü ve yatırıma şube). Bağımsız doğrulama (iki şubenin işaretli kayıtlarıyla 259 sınama, Tuzla silinince
  Marina'nın görünümü aynı mı) sekiz sızıntı buldu, hepsi kapandı: Faturalar'ın cari bağları, sabah e-postasının şube
  grubunun Paraşüt bölümü, Mutabakat POS'un şube karoları ve ekstre yükleme penceresi, Maaşlar'ın hesap seçicisi,
  Kullanıcılar & roller, Site menüsü ve Reçete defterinin bekleyen yeni ürün önerileri (müdürün kilidini aşıyordu).
  Sahibin kararına kalan: İşletme geneli giderler için "Ciroya göre pay et" kipi. (Nakit planının İşletme geneli
  satırındaki vergi ve Vergi'nin muhtasar dökümü soruları sahibin kararıyla kapandı: vergi hiçbir yerde şubeye bölünmez;
  Vergi bölümü de kaldırıldı.)

- **Anahtar değişimi uyumu** (bu PR, 27 Kasım; docs/ASILPOS.md › Şube kurulumu › Anahtar değişimi): 26 Kasım'da iki
  anahtar yalnız panelde değişti, kasa gece uyguladı, Uzaktan ve site eskisini tuttuğu için Uzaktan bir gün dondu. Panel
  artık kasanın bağlantı sorgusunu (uyguladığı ve güncel sürüm) şubeye göre saklar ve kendi dağıttığı anahtarın Uzaktan'da
  ve sitede kabul edildiğini kasanın imzasıyla sınar (sabah işi, Ayarlar › AsilPOS (kasa) › Anahtarları sına, kasanın
  raporu değişince; saatte en çok bir). Reddeden uç kartta ve yöneticinin zilinde uyarı olur, değişkenlerin adlarıyla adım
  adım (kasa uyguladıysa kırmızı, bekliyorsa turuncu); anahtar hiçbir yere yazılmaz. Belgede iki anahtarlı yeni sıra (önce
  Uzaktan ve site, `_ONCEKI` ile; sonra panel; kasalar uygulayınca `_ONCEKI` silinir). Fotoğraf okumasının istemleri banka
  kısmının kıyas başlığını iki adla da bilir (`PAVO - ASILPOS KARŞILAŞTIRMA`, AsilPOS #189'dan sonra; eskisi de). Kasa
  tarafı kasa deposunun uyum dalı (Uzaktan `_ONCEKI`'yi tanır), site tarafı sitenin uyum dalı: iki uçta `_ONCEKI` yayında
  değilken yeni sıranın 2.–3. adımı kullanılmaz (belge söyler). İnceleme düzeltmeleri (aynı gün): turuncu uyarı uç
  `_ONCEKI`'yi tanıdığını söylemedikçe uçtaki değeri değiştirtmez, paneli eskiye döndürtür (panel önce yayına çıksa da
  perşembe tekrarlanmaz); kasa sorunca saatte bir sınanır (yalnız uç değişse de uyarı ertesi sabahı beklemez); uçların
  `x-laf-anahtar` başlığı okunur (yalnız önceki değer olarak kabul: "Panelin Uzaktan anahtarı eski"), Uzaktan'ın
  `/api/health` › `onceki` bayrağıyla unutulan `_ONCEKI` hatırlatılır; yayın sırası DEPLOY.md § 7.

- **Çok şubeli AsilPOS kasası ve Marina yalnız AsilPOS** (#167, 27 Kasım; docs/ASILPOS.md › Şubeler): her fiziksel
  şubenin kendi AsilPOS kasası olabilir ("yalnız bir şube" sınırı kalktı); her kasanın kendi anahtarı, geçiş günü, gün
  sonu, kasa e-postası, komisyonu ve durumu var, panel şubeyi anahtardan tanır (başka şube bildiren kasa 409). Bir günün
  sayılma kuralı tek: şubenin kasası AsilPOS ve gün o şubenin geçiş gününden önce değil; "Tümü"de her kasa kendi
  gününden, (şube, gün) anahtarlı, çift sayım yok. Marina'da ModPOS bitti (föyü çekilmez, zil ve istemler geçiş gününden
  susar; 22 Kasım'dan önceki föy sayılmaya devam eder), Tuzla ModPOS'ta. Göç 0099 yalnız veri, iki kez çalışsa da aynı.
  Bugünkü veride (yalnız Marina kasası) rakam değişmez. İnceleme düzeltmeleri: süren ayın kasa raporu beklemesi kasa
  başına ("Tümü" şube görünümlerinin toplamı); geçiş günü sonra olan kasa kendi geçiş ayına dek komisyonda föyün
  markasıyla (`tek` değil); komisyonun eksik günleri takvim günü; Marina dışındaki şubede anahtar metinleri ortamdaki
  değişkeni önermez; bir anahtar başka şubenin kasa hareketi satırını yazmaz; kurulum kodunun anahtarı kilit altında.
  Kasa tarafı kasa deposunun #188'i (ikinci kasa açılmadan önce birleşmeli).

- **AsilPOS: kasanın yeni adı panelde her yerde** (#166, 27 Kasım; docs/ASILPOS.md › Ad değişikliği (teknik)):
  ekran, e-posta, belge, kod, tablo ve ortam değişkeni; kurulu kasa, Vercel'deki eski adlı değişkenler ve eski derleme çalışmaya
  devam eder (göç 0098 yalnız genişletir). Kasa tarafı kasa deposunun #187'si. Sahibe söylenecek: Vercel'de
  `ASILPOS_SYNC_SECRET` (varsa CLOUD / SITE / KURUCU de) aynı değerle eklensin, sonra eski adlı değişkenler silinebilir; eski adları
  kaldıran daraltma göçü (A3) en erken 7 gün sonra.

- **Roller: Müdür ve salt okunur Muhasebeci; vardiyanın şube ayarları** (#163, 27 Kasım; docs/ROLLER.md): müdür şubesine
  kilitli, maaş, kişisel ücret, maliyet, karaoke tutarı ve öteki şubeleri görmez; muhasebeci yalnız okur (Muhasebe,
  Faturalar, Gelir-gider, Aylık harcamalar, Kasa raporu; Vergi 27 Kasım'da bölümle birlikte çıktı). İlk incelemenin 12 bulgusu ve ikinci bağımsız yetki
  incelemesinin doğruladığı 6 bulgu testleriyle düzeltildi. Göç 0097_roller (yalnız CHECK kısıtları; yeni roller kimseye
  kendiliğinden verilmez). Sahibe söylenecek: (1) iki adımlı doğrulama `ADMIN_2FA_REQUIRED=1` ile yönetici, müdür ve
  muhasebecide zorunlu, yoksa isteğe bağlı; (2) Hesabım'daki AsilPOS kurulum bağlantısı şubeye kilitli personele de
  görünüyordu: bekleyen bir kurulum kodu varken personel Hesabım'ı açmış olabilirse yayından sonra AsilPOS anahtarını
  döndürün; (3) bir şubenin e-postası müdür ya da muhasebeci hesabındaysa kurulum bağlantısı o adrese gitmez, başka adres
  yazılır.

- **Hata kaydı** (P3; bu PR, 27 Kasım): sunucu hataları (Next'in `onRequestError` kancası), işlemlerin beklenmeyen
  hataları (`attempt()`), tarayıcı hataları ve CSP ihlal raporları panelin veritabanında 30 gün; aynı hata tek satır
  (sayısı, ilk ve son görülüşü, hata kodu). Ekran **Ayarlar › Hata kaydı** (yalnız yönetici; Çözüldü / Hepsi çözüldü).
  Kişisel veri ve anahtar yazılmaz; kayıt isteği bekletmez ve bozamaz; günlük satır sınırı ve 2.000 satır tavanı. Göç
  `0100_hata_kaydi`. docs/HATA-KAYDI.md. Sahibe söylenecek:
  - Sunucuda hata olunca sabah e-postasının alıcılarına günde en çok bir "Panelde hata: …" e-postası gelir (yalnız
    canlıda, e-posta açıkken); ayrıntı Ayarlar › Hata kaydı'nda. Kullanıcı "Bir şeyler ters gitti" ekranındaki hata
    kodunu söylerse satır o kodla bulunur (satır son beş görülüşün kodunu tutar; kod her yayında değişir).
  - **CSP_ENFORCE kararı artık kartta:** "uygulanabilir" (son 7 günde panelin kendi kodundan ihlal yok, kayıt en az 7
    gündür tutuluyor) deyince Vercel'de `CSP_ENFORCE=1` eklenip yeniden yayınlanır; "henüz uygulanmasın" diyorsa önce
    satırlar düzeltilir. Çözüldü işaretlemek 7 günlük bekleyişi kısaltmaz: son ihlalden 7 gün sonra karar yeşile döner.
    Vercel günlüğüne bakmak gerekmez.
  - Acil durumda kayıt `ERROR_LOG_DISABLED=1` ile kapatılır. Sentry eklenmedi (isteğe bağlı; hesap açılırsa ayrı iş,
    docs/HATA-KAYDI.md § 7).
- **Excel'den tam bağımsızlık** (P2; #164 ve bu PR, 26 Kasım): başlangıç verisi uygulamanın dışında
  (`tests/fixtures/baslangic/`; tohum betiği ve testler okur), canlıda boş veritabanına kendiliğinden yüklenmiyor,
  Excel çıkarma betiği kalktı; `npm audit` geliştirme araçları dahil 0 açık; başlangıç verisindeki kişi adları uydurma
  adlarla değiştirildi (rakamlar ve altın testler aynı). docs/DEPLOY.md § 1, § 5.
- **Belge tarayıcı** (#160, 26 Kasım): tarama ekranı (kenar yeşil, köşeler sürüklenir, Belge / Gri / Renkli / Orijinal),
  canlı kamera vizörü ve otomatik çekim, kalite uyarısı ve Yeniden çek, sayfa yönü, uzun fişte Devamını çek; algılama
  ölçümle 52/96 → 89/96. Sahibe söylenecek: gerçek iPhone ve Android'de bir kez denensin.
- **Dalga 1** (#146): kör kasa, fişsiz çıkış, kasa formu taslağı, vardiya çakışması, part-time silme koruması, 09:00 zili, "Tümü" kâr dönemi, şube oranı, zil ve rozetler, büyüme gösterimi, eski Excel kalıntılarının kaldırılması, dışa aktarımın profesyonelleşmesi.
- **Uyarı satırları yalnız personelde** (#145).
- **GitHub `CRON_SECRET` eklendi** (26 Kasım 2026): kontrol listesi hatırlatmalarının yedek tetikleyicisi (Kontrol listesi
  hatırlatmaları iş akışı) yeniden çalışıyor; elle çalıştırma yeşil. Pavo'yu bekleyen gün sonu e-postasının gece
  tamamlanması da bu işten yararlanır.
- **Faturanın şubesi ve fatura sınıflandırma** (`ai/fatura-sube`'nin devamı; güncel main ile birleştirildi, doğrulandı; `claude/festive-goodall-sclggq` dalında, main'e PR'la gidecek):
  - Her faturanın şubesi: şube, İşletme geneli ya da Şubesi seçilmemiş. Tedarikçinin varsayılan şubesi, Faturalar › Tümü'de öneri kutusu, toplu seçim. Faturalar, Gelir-gider, Maliyet ve Paraşüt şubeye göre süzülür.
  - Karışık fatura kalem kalem: hammaddeye bağlı kalem mal alışı, "hammadde değil" kalem nedeninin yerine (Sarf, Demirbaş, Hizmet, Deneme). Tedarikçi kuralı, Temizlik & Sarf kategorisi, aranabilir hammadde seçici, AI isteminde faturanın bağlamı.
  - Eski kuralla rakam karşılaştırması: `scripts/fatura-kalem-karsilastir.ts`; değişen rakamlar `tests/fatura-kalem-karsilastirma.test.ts`'te kilitli (docs/PARASUT.md › 5f).
  - Sahibe söylenecek: geçişten sonra tek şube seçiliyken eski faturalar görünmez, ta ki şubeleri seçilene kadar (Tümü değişmez). Hammaddeye bağlı kalemi olan mal dışı faturaların o kalemleri geçmiş aylarda da mal alışına geçer.
- **Z raporu e-postası ve fotoğraf okuma** (26 Kasım; dal `claude/festive-goodall-sclggq`; docs/ASILPOS.md › Z raporu e-postası, docs/FOTOGRAF.md § 5):
  - Marina'da eklenen her gün sonu fotoğrafı için yöneticiye ayrı "Z raporu" e-postası: Z tutsa da ("Z raporu tutuyor"), okunan rakamlar ve fotoğrafın kendisi ekli. Tuzla'nın kasa e-postasında fotoğraf yazılanlarla tutuyorsa yeşil satır.
  - Yüklenirken okunamayan (ya da yalnız kodla okunan) fotoğraf sonradan yeniden okunur. Fatura okumaları fotoğrafların günlük yapay zekâ hakkını yemez (kendi havuzu).
  - ModPOS Z'si, yazarkasa Z'si ve fiş önce ucuz modelle (Haiku), okunuş eksik ya da tutarsızsa bir kez güçlü modelle okunur.
  - Sahibe söylenecek: "Z raporları okunmuyor"un canlıdaki nedeni günlüklerden doğrulanamadı (Vercel günlüklerine erişim yok); koddan bulunan iki neden kapatıldı. Yayından sonra bir gün izleyin; Ayarlar › Fotoğraftan okuma'da okuma açık ve `ANTHROPIC_API_KEY` tanımlı olmalı.
- **Dalga 2/3 paketleri (ilk grup)** (26 Kasım; `claude/festive-goodall-sclggq`): Tuzla'da kör sayım ve Kime + Teslim defteri,
  KDV tahmini yazarkasa Z'sinden; onay istekleri ve vardiya değişikliği bildirimi, gelecek hafta hatırlatması, yönetici
  iki adımlı doğrulama zorunlu ve yeni cihaz uyarısı, telefonda üst çubukta şube; otomatik haftalık yedek ve veritabanı
  kota uyarısı; banka / tedarikçi ekstresi ve POS hakediş mutabakatı. Sahibe söylenecek: yayından sonra iki adımlısı
  olmayan yönetici ilk açılışta kurulum ekranına düşer (telefonda doğrulama uygulaması hazır olsun); Tuzla'da kör sayım
  hemen açılır (istenmezse Şubeler › Tuzla › Kör sayım).
- **Marina gün sonu e-postası gece kaybolmaz** (dal `claude/peaceful-maxwell-ov7ms7`): 25 Kasım akşamı e-posta gitmedi.
  Pavo beklemesi (#141) sonraki bir tetiğe kalıyordu ve gece tetik yoktu. Bekleme artık aynı istekte biter
  (`settlePavoWait`): sonuç gelmezse e-posta ~38 sn'de Pavo'suz gider. AsilPOS'un `bankPosPending` alanına uyulur;
  bekleme ilk gelişten sayılır. Ayrıntı: docs/ASILPOS.md "Pavo'yu bekler". AsilPOS tarafı AsilPOS deposunda (`lafpos`) aynı adlı dalda.
- **E-postalar ortak tasarımda** (aynı dal): `src/lib/email-kit.ts`. Ferah kart, telefonda tek sütun; bütün e-postalar
  aynı kabuk ve parçaları kullanır. İçerik, bağlantı ve düz metin aynı kaldı.
- **Gün sonu zinciri sağlamlaştı** (dal `wt/lm-takip`, 26 Kasım): sabah işi işi bekleyen günleri önce ve yeniden eskiye
  işler (dünkü gün ilk; süre yetmezse adım hata); AsilPOS'un reddedilen günü yöneticinin zilinde ("Marina gün sonu
  alınamadı: …", gün ve neden başına bir kez). Ayrıntı: docs/ASILPOS.md "Sabah işinin sırası", "Zil".

- **Dalga 2/3 paketleri (ikinci grup)** (26 Kasım; `wip/entegre`, sonraki PR): Raporlar (şube karşılaştırma, işçilik /
  ciro, Marina kaçak raporu, kayıp önlemenin panel tarafı); stok tahmininde Marina'nın online siparişi, kaç gün yeter ve
  eşik önerisi; asistanın şube fiyatı, açık ekranın şubesi ve iş günü; muhasebeci paketi, kontrol listelerinin aylık
  PDF'i, dönem kapanışı ve reçete geçmişi; personel belgeleri, avans ve asistana fiş fotoğrafı. Göçler 0093 (muhasebe),
  0094 (personel). Sahibe söylenecek: Ayarlar › Muhasebeci paketi'ne muhasebecinin adresi yazılmadıkça paket gitmez;
  Marina'nın online ay kaydı yayından sonra işletmeninkiyle bir kez karşılaştırılmalı (site şubeyi süzmüyorsa tahmin
  online tüketimi fazla düşer). Paraşüt güvenliği (aynı vergi no sorusu, POST + tek kullanımlık bağlantı, AsilPOS anahtarı hemen
  geçersiz) ve CSP: tam politika önce yalnız raporlar (Report-Only); raporlar 27 Kasım'dan beri hata kaydında, karar
  Ayarlar › Hata kaydı'nda (yukarıda).

## Devam eden (26 Kasım akşamı)

Sıra, kurallar ve ayrıntı: [docs/planlar/DEVAM.md](docs/planlar/DEVAM.md). Kod paketleri:
- P1 Roller (Müdür, salt okunur Muhasebeci) + vardiyanın şube ayarları (`wip/entegre3`): incelemenin doğruladığı 12
  bulgu düzeltilecek, ikinci inceleme, sonra PR.
- P4 CI ve kod sağlığı (şema–göç denetimi, asistan bilgisinin derlemede üretilmesi, rol × ekran duman testi).
  CI süre sınırı 25 dakikaya çıktı (28 Kasım, dal ci-sure-siniri).
- P5 Ayarlar ay bazlı + 2027 bordro ve stopaj değerleri (`src/lib/bordro/rules-2026.ts`'in 2027'si: asgari ücret, gelir
  vergisi tarifesi, SGK oranları ve PEK sınırları, kira stopajı; Ocak'tan önce, yoksa 2027 2026 değerleriyle hesaplanır;
  vergi kuralları Vergi bölümüyle kalktı); P6 Excel'den kalan sabit listeler (fatura / hammadde
  kategorileri, sayım grupları) ekrandan; P7 dönem kapanışı sayım / ciro / kasaya da; P8 fotoğraf okuma doğruluğu;
  P9 temizlik.

- AsilPOS: kasa programının adı her yerde AsilPOS (26 Kasım 2026'ya kadar adı LafPOS; panel ve kasa deposu; eski adlar geçişte çalışır), Marina yalnız AsilPOS
  (ModPOS bitti), her şubenin kendi AsilPOS kasası (sahibin 27 Kasım kararları; DEVAM.md).
- P8'e ek: banka POS Z'sinin ÖZET'indeki "Toplam KDV" okunmuyor (fiş yanlışlıkla "farklı" çıkıyor).
- 27 Kasım gece sırası: [docs/planlar/DEVAM.md](docs/planlar/DEVAM.md) › "27 Kasım gece: durum ve sıra". Yeni: özel günler
  bölümünün kaldırılması; kullanan ve satılacak işletmeler için ekranların sadeleştirilmesi; sitenin altyapı güncellemesi ve
  e-Arşiv girişi (10 Aralık'tan önce).
- **Sitenin e-Arşiv'i Paraşüt OAuth'a geçmeli; SON TARİH 10 Aralık** (eski şifreli giriş o gün duruyor). Sahibin kararı
  (28 Kasım): şimdilik sıradan çıktı. Şart: bağlantı şube başına olacak, her şube kendi Paraşüt hesabını kendisi
  ekleyebilecek, biri ötekini düşürmeyecek. DevHub uygulaması açıldı.
- **Kasada gerçek açılış (K5, kasa deposu)** (sahibin isteği, 28 Kasım): "Denemeyi bitir"de ladmin girişi, şube seçimi
  (kurulu şube seçilemez), bağlantıların ve ilk personelin inmesi, teslim onayı. Panel uçları hazır: sözleşme
  docs/ASILPOS.md › Kasa açılışı. P-B2 canlıya girdikten sonra.
- **Kasa: "Kurulumu yap" fiş yazıcısını da bulup denetebilsin** (sahibin isteği).
- **Kasa deposunun PR'ları:** #192 Token sürücüsünün sessiz kurulumu, #193 müşteri ekranında çeviri balonu, yenileme
  simgesi PR'ı.
## Sahibin tarafında (kod değil)

- [ ] **ACİL: Depo herkese açık (public).** Başlangıç verisi maaş, kira ve fatura rakamları taşıyor; kişi adları
  güncel dosyada uydurma, git geçmişinde gerçekleri duruyor. GitHub › Settings ›
  Danger Zone › Change visibility › Private; açığa düşmüş anahtarlar yenilensin.
- [ ] GitHub › Settings › Branches: main için "Tip · Lint · Test · Derleme" zorunlu olsun (kırmızı CI'yla birleştirme olmasın).
- [ ] GitHub sırrı `ANTHROPIC_API_KEY`: sahip 27 Kasım'da anahtarı ekledi ama inceleme yine düşüyor; depo düzeyindeki sır 23 Ekim tarihli, yeni anahtarla güncellenmeli (kuruluş düzeyindeki sırrı gölgeler).
- [ ] Vercel planı (Hobby ticari kullanıma izin vermiyor, günlük 1 saat): Pro kararı. Vercel'de `ADMIN_2FA_REQUIRED=1`;
  Ayarlar › Hata kaydı "Güvenlik politikası uygulanabilir" deyince `CSP_ENFORCE=1`.
- [ ] Yayından sonra el kontrolü ve belge tarayıcının gerçek iPhone / Android'de denenmesi; muhasebecinin adresi (Ayarlar ›
  Muhasebeci paketi); SGK işveren oranı kararı (%15,75 / %19,75: Gelir-gider ve Maaşlar Ayarlar'ın oranını, nakit
  planının bordrosu yasal %19,75'i kullanır; Vergi'deki "oranı eşitle" uyarısı bölümle kalktı, oran Maaşlar › SGK
  oranları'ndan değişir); yedekten geri yükleme provası; dış sağlık izleyicisi.
- [ ] laffogato.net veritabanının (Neon) kotası 24 Kasım'da doldu. Online sipariş, karaoke ve menü eşitlemesi duruyor. Ücretli plana geçin ya da Coolify'a taşıyın.
- [ ] Marina gün sonu e-postasının alıcılarına bakın: 25 Kasım'dan (#141) beri yalnız Kasa › Rapor alıcıları alır (sabah
  e-postasının adresleri artık almaz). Gün sonu e-postasını almak isteyen adres Rapor alıcıları'nda olmalı.
- [ ] Panelin veritabanı da ücretsiz planda. Ücretli plana geçin. (%70 ve %90 kota uyarısı eklendi, 26 Kasım: Ayarlar › Veritabanı; kota `DB_QUOTA_MB`, varsayılan 512)
- [ ] Vercel'de artık kullanılmayan `PARASUT_USERNAME` ve `PARASUT_PASSWORD` silinsin.
- [ ] Fotoğraf okuma istemleri canlı modelle denensin (`FOTO_EVAL=1`). 24 Kasım'ın gerçek Z fotoğrafı değerlendirmeye eklensin.

## Dalga 2 (1 ay içinde)

- [x] [Ladmin] Otomatik haftalık yedek; son 8 hafta saklanır. (26 Kasım; Ayarlar › Yedek, docs/YEDEK.md § 13)
- [x] [Ladmin] Tuzla'da kör sayım. Önce sayılan nakit girilip kilitlenir, fark sonra görünür. (26 Kasım; şube ayarı Şubeler › Kör sayım, ModPOS şubesinde varsayılan açık)
- [x] [İkisi] Teslim defteri: teslim edilen nakdi kimin aldığı kaydedilir. (26 Kasım; Tuzla'da Kime, iki şube Kasa › Teslim defteri'nde; Marina'nınki AsilPOS #144'ün alıcısından)
- [x] [Ladmin] Şube karşılaştırma ekranı: şubeler ay ay yan yana. (26 Kasım; Raporlar › Şubeler, docs/RAPORLAR.md)
- [x] [Ladmin] Stok tahmini Marina'nın online siparişlerini düşsün; "kaç gün yeter" ve eşik önerisi eklensin. (26 Kasım; docs/STOK-TAHMINI.md)
- [x] [Ladmin] Asistanın fiyat kartı şube fiyatını bilsin. Asistan şubeyi açık ekrandan okusun; "bugün" iş günü (05:00) olsun. (26 Kasım)
- [x] [Ladmin] Ayrı Paraşüt firması bağlanırken "Aynı vergi numarası mı?" diye sorulsun. (26 Kasım; docs/PARASUT.md)
- [x] [Ladmin] KDV tahmini yazarkasa Z'sine ve AsilPOS'un KDV dökümüne dayansın. (26 Kasım; kaynak satırı: "12 gün yazarkasa Z'sinden, 3 gün tahmin")
- [x] [Ladmin] Vardiyası değişen personele bildirim gitsin. Gelecek haftanın planı yazılmadıysa hatırlatılsın. (26 Kasım)
- [x] [Ladmin] Onay istekleri yöneticinin telefonuna bildirim olarak gitsin. (26 Kasım)
- [x] [Ladmin] Yönetici hesaplarında iki adımlı doğrulama zorunlu olsun; yeni cihazdan girişte uyarı. (26 Kasım; aynı gün sahibin isteğiyle zorunluluk kaldırıldı: iki adımlı isteğe bağlı, Vercel'de `ADMIN_2FA_REQUIRED=1` yeniden zorunlu yapar)
- [x] [Ladmin] Telefonda üst çubukta hangi şubenin görüldüğü yazsın. (26 Kasım)

## Dalga 3 (sonra)

- [x] [Ladmin] "Müdür" ve salt okunur "Muhasebeci" rolleri. (27 Kasım, #163; docs/ROLLER.md)
- [x] [Ladmin] Marina ay sonu kaçak raporu: tahmini stokla sayım arasındaki fark TL olarak, en çok kaçan kalemlerle. (26 Kasım; Raporlar › Kaçak; ilk gerçek rapor Aralık sonu sayımıyla)
- [ ] [İkisi] Kişi bazında kayıp önleme özeti: kasa farkı, iptal, ikram ve indirimin kişiye göre sapması. AsilPOS iptali yapanı ve ikram edeni göndermiyorsa AsilPOS'a da ekleme gerekir. (26 Kasım: panel tarafı bitti, Raporlar › Kayıp önleme; kasa farkı sayana, zayi / ikram girene göre. AsilPOS'un iptal ve ikramı kişiyle göndermesi sahibin onayını bekliyor)
- [x] [Ladmin] Banka ve tedarikçi ekstresiyle mutabakat. (26 Kasım; Kâr & ödemeler › Mutabakat. 28 Kasım: sahibin isteğiyle bölüm kaldırıldı, docs/arsiv/MUTABAKAT.md)
- [x] [Ladmin] Banka POS hakediş mutabakatı: kart satışı ile bankaya gelen para karşılaştırılır. (26 Kasım; Mutabakat › POS hakediş. 28 Kasım: bölümle kaldırıldı)
- [x] [Ladmin] Muhasebeciye aylık tek paket ve ay kapanış e-postası. (26 Kasım; Ayarlar › Muhasebeci paketi, docs/MUHASEBE-PAKETI.md)
- [x] [Ladmin] Kontrol listelerinin denetime hazır aylık PDF'i. (26 Kasım; Kontrol › Geçmiş › Aylık PDF)
- [x] [Ladmin] Asistana fiş fotoğrafı: telefonda çekince kart hazırlanır. (26 Kasım; docs/ASISTAN-ISLEMLER.md › Fiş fotoğrafı)
- [ ] [Sahip] Çok şubeli kasa canlıya çıkınca: Ayarlar › AsilPOS › Marina bölümünde geçiş günü 22 Kasım 2026 mı bakın; Marina dışındaki şubede Marina'nın anahtarını almış kasa varsa yeni kurulum kodu gönderin; Vercel'de `MODPOS_API_KEY_MARINA`'yı silin (artık okunmuyor). Gün sonu penceresinde (22:00–03:00) birleştirmeyin. İkinci AsilPOS kasası açılmadan önce kasa deposunun #188'i birleşmeli.
- [x] [Ladmin] Dönem kapanışı: beyan edilmiş aya sonradan fatura girmesin. Reçete geçmişi tutulsun. (26 Kasım; Ayarlar › Dönem kapanışı, docs/DONEM-KAPANISI.md)
- [x] [Ladmin] İşçilik maliyeti / ciro oranı: günlük, haftalık ve şube şube. (26 Kasım; Raporlar › İşçilik)
- [x] [Ladmin] Personel belgeleri (hijyen eğitimi, sağlık raporu, SGK) ve avans takibi. (26 Kasım; Giderler & maaşlar › Belgeler, Avanslar; docs/PERSONEL-BELGE.md)

## Düşük öncelikli güvenlik notları

- [x] Paraşüt bağlantısı adres çubuğundan başlatılabiliyor. Bir düğmeyle (POST) başlatılmalı ve hesabı tek kullanımlık bir değerle seçmeli. (26 Kasım)
- [x] Döndürülen AsilPOS anahtarı önbellek yüzünden en çok 60 saniye daha geçerli kalıyor. (26 Kasım; imzası tutan istek anahtarı veritabanından taze okur)
- [x] Content-Security-Policy başlığı yok. (26 Kasım; çekirdek uygulanır, tam politika önce yalnız raporlar; docs/DEPLOY.md › Güvenlik başlıkları)

## Bekleyen başka iş

- [ ] [Ladmin] Nakit planının bordrosu eski Vergi ayarlarından üç değeri okur (hesap döneminin başı, asgari ücret desteği,
  SGK işveren payının elle değeri; `integration_state` › `tax.settings`); Vergi bölümü kalkınca ekranları da gitti, değerler
  son girildiği gibi. Değiştirmek gerekirse Ayarlar › Personel'e taşınsın (`src/lib/bordro/settings.ts`).
- [x] Vardiyayla ilgili şube maddeleri (26 Kasım; `wip/vardiya-sube`): hazır vardiya saatleri şube ayarı (Şubeler ›
  şube › Hazır vardiyalar; ayarı olmayan şubede bugünkü saatler); "Tümü"de Vardiya önce şubeyi sorar (önceden sessizce
  Tuzla'ya yazıyordu). Sahibe söylenecek: "Tümü"deyken Vardiya'yı açan önce şube seçer.

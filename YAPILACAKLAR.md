# Yapılacaklar (ladmin)

Son güncelleme: 26 Kasım 2026. Kaynak: 25 Kasım yönetim paneli denetimi ve sahibin istekleri.

Etiketler:
- **[Ladmin]**: yalnız panelde değişiklik.
- **[İkisi]**: panelle birlikte LafPOS'ta da değişiklik gerekir.
- **[Sahip]**: kodla değil, ayarla ya da hesapla çözülür.

LafPOS deposunda değişiklik gerektiren her madde sahibin onayını bekler.

## Bitenler (25–26 Kasım 2026)

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
- **Z raporu e-postası ve fotoğraf okuma** (26 Kasım; dal `claude/festive-goodall-sclggq`; docs/LAFPOS.md › Z raporu e-postası, docs/FOTOGRAF.md § 5):
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
  (`settlePavoWait`): sonuç gelmezse e-posta ~38 sn'de Pavo'suz gider. LafPOS'un `bankPosPending` alanına uyulur;
  bekleme ilk gelişten sayılır. Ayrıntı: docs/LAFPOS.md "Pavo'yu bekler". LafPOS tarafı lafpos aynı adlı dalda.
- **E-postalar ortak tasarımda** (aynı dal): `src/lib/email-kit.ts`. Ferah kart, telefonda tek sütun; bütün e-postalar
  aynı kabuk ve parçaları kullanır. İçerik, bağlantı ve düz metin aynı kaldı.
- **Gün sonu zinciri sağlamlaştı** (dal `wt/lm-takip`, 26 Kasım): sabah işi işi bekleyen günleri önce ve yeniden eskiye
  işler (dünkü gün ilk; süre yetmezse adım hata); LafPOS'un reddedilen günü yöneticinin zilinde ("Marina gün sonu
  alınamadı: …", gün ve neden başına bir kez). Ayrıntı: docs/LAFPOS.md "Sabah işinin sırası", "Zil".

- **Dalga 2/3 paketleri (ikinci grup)** (26 Kasım; `wip/entegre`, sonraki PR): Raporlar (şube karşılaştırma, işçilik /
  ciro, Marina kaçak raporu, kayıp önlemenin panel tarafı); stok tahmininde Marina'nın online siparişi, kaç gün yeter ve
  eşik önerisi; asistanın şube fiyatı, açık ekranın şubesi ve iş günü; muhasebeci paketi, kontrol listelerinin aylık
  PDF'i, dönem kapanışı ve reçete geçmişi; personel belgeleri, avans ve asistana fiş fotoğrafı. Göçler 0093 (muhasebe),
  0094 (personel). Sahibe söylenecek: Ayarlar › Muhasebeci paketi'ne muhasebecinin adresi yazılmadıkça paket gitmez;
  Marina'nın online ay kaydı yayından sonra işletmeninkiyle bir kez karşılaştırılmalı (site şubeyi süzmüyorsa tahmin
  online tüketimi fazla düşer). Paraşüt güvenliği (aynı vergi no sorusu, POST + tek kullanımlık bağlantı, LafPOS anahtarı hemen
  geçersiz) ve CSP: tam politika önce yalnız raporlar (Report-Only); bir hafta Vercel günlüğünde `[csp]` satırı
  çıkmazsa `CSP_ENFORCE=1` verilip yeniden yayınlanır.

## Devam eden (26 Kasım akşamı)

Ayrıntı, sıra ve devam istemi: [docs/planlar/DEVAM.md](docs/planlar/DEVAM.md).
- `wip/entegre3`: "Müdür" ve salt okunur "Muhasebeci" rolleri + vardiyanın şube ayarları; incelemenin doğruladığı 12 bulgu
  düzeltilecek, sonra PR.
- `wip/excel-bagimsiz`: Excel'den tam bağımsızlık (canlıda kendiliğinden tohum yok, başlangıç verisi uygulama ağacının
  dışında, Excel çıkarma betiği kalkar, exceljs güvenlik açığı).
- Kalan işler ve "profesyonel kod" denetimi yeniden yapılacak; çıkanlar buraya yazılır.

## Sahibin tarafında (kod değil)

- [ ] laffogato.net veritabanının (Neon) kotası 24 Kasım'da doldu. Online sipariş, karaoke ve menü eşitlemesi duruyor. Ücretli plana geçin ya da Coolify'a taşıyın.
- [ ] Marina gün sonu e-postasının alıcılarına bakın: 25 Kasım'dan (#141) beri yalnız Kasa › Rapor alıcıları alır (sabah
  e-postasının adresleri artık almaz). Gün sonu e-postasını almak isteyen adres Rapor alıcıları'nda olmalı.
- [ ] Panelin veritabanı da ücretsiz planda. Ücretli plana geçin. (%70 ve %90 kota uyarısı eklendi, 26 Kasım: Ayarlar › Veritabanı; kota `DB_QUOTA_MB`, varsayılan 512)
- [ ] Vercel'de artık kullanılmayan `PARASUT_USERNAME` ve `PARASUT_PASSWORD` silinsin.
- [ ] Fotoğraf okuma istemleri canlı modelle denensin (`FOTO_EVAL=1`). 24 Kasım'ın gerçek Z fotoğrafı değerlendirmeye eklensin.

## Dalga 2 (1 ay içinde)

- [x] [Ladmin] Otomatik haftalık yedek; son 8 hafta saklanır. (26 Kasım; Ayarlar › Yedek, docs/YEDEK.md § 13)
- [x] [Ladmin] Tuzla'da kör sayım. Önce sayılan nakit girilip kilitlenir, fark sonra görünür. (26 Kasım; şube ayarı Şubeler › Kör sayım, ModPOS şubesinde varsayılan açık)
- [x] [İkisi] Teslim defteri: teslim edilen nakdi kimin aldığı kaydedilir. (26 Kasım; Tuzla'da Kime, iki şube Kasa › Teslim defteri'nde; Marina'nınki LafPOS #144'ün alıcısından)
- [x] [Ladmin] Şube karşılaştırma ekranı: şubeler ay ay yan yana. (26 Kasım; Raporlar › Şubeler, docs/RAPORLAR.md)
- [x] [Ladmin] Stok tahmini Marina'nın online siparişlerini düşsün; "kaç gün yeter" ve eşik önerisi eklensin. (26 Kasım; docs/STOK-TAHMINI.md)
- [x] [Ladmin] Asistanın fiyat kartı şube fiyatını bilsin. Asistan şubeyi açık ekrandan okusun; "bugün" iş günü (05:00) olsun. (26 Kasım)
- [x] [Ladmin] Ayrı Paraşüt firması bağlanırken "Aynı vergi numarası mı?" diye sorulsun. (26 Kasım; docs/PARASUT.md)
- [x] [Ladmin] KDV tahmini yazarkasa Z'sine ve LafPOS'un KDV dökümüne dayansın. (26 Kasım; kaynak satırı: "12 gün yazarkasa Z'sinden, 3 gün tahmin")
- [x] [Ladmin] Vardiyası değişen personele bildirim gitsin. Gelecek haftanın planı yazılmadıysa hatırlatılsın. (26 Kasım)
- [x] [Ladmin] Onay istekleri yöneticinin telefonuna bildirim olarak gitsin. (26 Kasım)
- [x] [Ladmin] Yönetici hesaplarında iki adımlı doğrulama zorunlu olsun; yeni cihazdan girişte uyarı. (26 Kasım; aynı gün sahibin isteğiyle zorunluluk kaldırıldı: iki adımlı isteğe bağlı, Vercel'de `ADMIN_2FA_REQUIRED=1` yeniden zorunlu yapar)
- [x] [Ladmin] Telefonda üst çubukta hangi şubenin görüldüğü yazsın. (26 Kasım)

## Dalga 3 (sonra)

- [ ] [Ladmin] "Müdür" ve salt okunur "Muhasebeci" rolleri.
- [x] [Ladmin] Marina ay sonu kaçak raporu: tahmini stokla sayım arasındaki fark TL olarak, en çok kaçan kalemlerle. (26 Kasım; Raporlar › Kaçak; ilk gerçek rapor Aralık sonu sayımıyla)
- [ ] [İkisi] Kişi bazında kayıp önleme özeti: kasa farkı, iptal, ikram ve indirimin kişiye göre sapması. LafPOS iptali yapanı ve ikram edeni göndermiyorsa LafPOS'a da ekleme gerekir. (26 Kasım: panel tarafı bitti, Raporlar › Kayıp önleme; kasa farkı sayana, zayi / ikram girene göre. LafPOS'un iptal ve ikramı kişiyle göndermesi sahibin onayını bekliyor)
- [x] [Ladmin] Banka ve tedarikçi ekstresiyle mutabakat. (26 Kasım; Kâr & ödemeler › Mutabakat, docs/MUTABAKAT.md)
- [x] [Ladmin] Banka POS hakediş mutabakatı: kart satışı ile bankaya gelen para karşılaştırılır. (26 Kasım; Mutabakat › POS hakediş)
- [x] [Ladmin] Muhasebeciye aylık tek paket ve ay kapanış e-postası. (26 Kasım; Ayarlar › Muhasebeci paketi, docs/MUHASEBE-PAKETI.md)
- [x] [Ladmin] Kontrol listelerinin denetime hazır aylık PDF'i. (26 Kasım; Kontrol › Geçmiş › Aylık PDF)
- [x] [Ladmin] Asistana fiş fotoğrafı: telefonda çekince kart hazırlanır. (26 Kasım; docs/ASISTAN-ISLEMLER.md › Fiş fotoğrafı)
- [ ] [İkisi] Tuzla LafPOS'a geçecekse iki şubeli LafPOS.
- [x] [Ladmin] Dönem kapanışı: beyan edilmiş aya sonradan fatura girmesin. Reçete geçmişi tutulsun. (26 Kasım; Ayarlar › Dönem kapanışı, docs/DONEM-KAPANISI.md)
- [x] [Ladmin] İşçilik maliyeti / ciro oranı: günlük, haftalık ve şube şube. (26 Kasım; Raporlar › İşçilik)
- [x] [Ladmin] Personel belgeleri (hijyen eğitimi, sağlık raporu, SGK) ve avans takibi. (26 Kasım; Giderler & maaşlar › Belgeler, Avanslar; docs/PERSONEL-BELGE.md)

## Düşük öncelikli güvenlik notları

- [x] Paraşüt bağlantısı adres çubuğundan başlatılabiliyor. Bir düğmeyle (POST) başlatılmalı ve hesabı tek kullanımlık bir değerle seçmeli. (26 Kasım)
- [x] Döndürülen LafPOS anahtarı önbellek yüzünden en çok 60 saniye daha geçerli kalıyor. (26 Kasım; imzası tutan istek anahtarı veritabanından taze okur)
- [x] Content-Security-Policy başlığı yok. (26 Kasım; çekirdek uygulanır, tam politika önce yalnız raporlar; docs/DEPLOY.md › Güvenlik başlıkları)

## Bekleyen başka iş

- [ ] Vardiyayla ilgili şube maddeleri (hazır vardiya saatleri şube ayarına, "Tümü"de şube seçimi). PR #120 bu dala
  birleştirildi (26 Kasım); artık yapılabilir.

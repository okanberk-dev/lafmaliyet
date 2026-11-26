# Yapılacaklar (ladmin)

Son güncelleme: 26 Kasım 2026. Kaynak: 25 Kasım yönetim paneli denetimi ve sahibin istekleri.

Etiketler:
- **[Ladmin]**: yalnız panelde değişiklik.
- **[İkisi]**: panelle birlikte LafPOS'ta da değişiklik gerekir.
- **[Sahip]**: kodla değil, ayarla ya da hesapla çözülür.

LafPOS deposunda değişiklik gerektiren her madde sahibin onayını bekler.

## Bitenler (25–26 Kasım 2026)

- **Dalga 1** (#146): kör kasa, fişsiz çıkış, kasa formu taslağı, vardiya çakışması, part-time silme koruması, 09:00 zili, "Tümü" kâr dönemi, şube oranı, zil ve rozetler, büyüme gösterimi, eski Excel kalıntılarının kaldırılması, dışa aktarımın profesyonelleşmesi.
- **Uyarı satırları yalnız personelde** (#145).
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

## Devam eden (26 Kasım; yerel `wip/*` dallarında, ajanlar sürdürüyor)

Kullanım limitiyle kesilen ajanların işi kendi dallarında "ARA KAYIT" commit'leriyle durur; yeni ajan dalından sürdürür.
Bitince `claude/festive-goodall-sclggq`'ye birleştirilir (göç numarası çakışırsa yeniden üretilir).
- Belge tarayıcı: `wip/tarama-cekirdek` (saf çekirdek) → `wip/tarama-arayuz`; `wip/tarama-olcum` (ölçüm düzeneği),
  `wip/tarama-kalite` (kalite, yön, uzun fiş birleştirme); sonra bağlama + ayar, canlı vizör, inceleme.
- E-posta tasarımı: main'deki `src/lib/email-kit.ts` (#149) geçerli; paralel yapılan `wip/eposta-*` dalları onun yerine
  geçmez, birleştirilmeyecek (yalnız gerekirse oradan görsel düzeltme alınır).
- Dalga paketleri: `wip/raporlar` (şube karşılaştırma, işçilik/ciro, kaçak raporu, kayıp önleme), `wip/stok-asistan`,
  `wip/parasut-guvenlik` (aynı vergi no, POST + tek kullanımlık bağlantı, LafPOS anahtar önbelleği, CSP), `wip/muhasebe`
  (aylık paket, kontrol PDF'i, dönem kapanışı, reçete geçmişi), `wip/personel` (belgeler, avans, asistana fiş fotoğrafı).
- En son: `roller` (Müdür, Muhasebeci), çünkü bütün yeni ekranlara dokunur.

## Sahibin tarafında (kod değil)

- [ ] laffogato.net veritabanının (Neon) kotası 24 Kasım'da doldu. Online sipariş, karaoke ve menü eşitlemesi duruyor. Ücretli plana geçin ya da Coolify'a taşıyın.
- [ ] GitHub'a `CRON_SECRET` ekleyin ve GitHub ödeme sorununu çözün. Kontrol listesi hatırlatmalarının yedek tetikleyicisi bunlar yüzünden çalışmıyor.
- [ ] Marina gün sonu e-postasının alıcılarına bakın: 25 Kasım'dan (#141) beri yalnız Kasa › Rapor alıcıları alır (sabah
  e-postasının adresleri artık almaz). Gün sonu e-postasını almak isteyen adres Rapor alıcıları'nda olmalı.
- [ ] Panelin veritabanı da ücretsiz planda. Ücretli plana geçin. (%70 ve %90 kota uyarısı eklendi, 26 Kasım: Ayarlar › Veritabanı; kota `DB_QUOTA_MB`, varsayılan 512)
- [ ] Vercel'de artık kullanılmayan `PARASUT_USERNAME` ve `PARASUT_PASSWORD` silinsin.
- [ ] Fotoğraf okuma istemleri canlı modelle denensin (`FOTO_EVAL=1`). 24 Kasım'ın gerçek Z fotoğrafı değerlendirmeye eklensin.

## Dalga 2 (1 ay içinde)

- [x] [Ladmin] Otomatik haftalık yedek; son 8 hafta saklanır. (26 Kasım; Ayarlar › Yedek, docs/YEDEK.md § 13)
- [x] [Ladmin] Tuzla'da kör sayım. Önce sayılan nakit girilip kilitlenir, fark sonra görünür. (26 Kasım; şube ayarı Şubeler › Kör sayım, ModPOS şubesinde varsayılan açık)
- [x] [İkisi] Teslim defteri: teslim edilen nakdi kimin aldığı kaydedilir. (26 Kasım; Tuzla'da Kime, iki şube Kasa › Teslim defteri'nde; Marina'nınki LafPOS #144'ün alıcısından)
- [ ] [Ladmin] Şube karşılaştırma ekranı: şubeler ay ay yan yana.
- [ ] [Ladmin] Stok tahmini Marina'nın online siparişlerini düşsün; "kaç gün yeter" ve eşik önerisi eklensin.
- [ ] [Ladmin] Asistanın fiyat kartı şube fiyatını bilsin. Asistan şubeyi açık ekrandan okusun; "bugün" iş günü (05:00) olsun.
- [ ] [Ladmin] Ayrı Paraşüt firması bağlanırken "Aynı vergi numarası mı?" diye sorulsun.
- [x] [Ladmin] KDV tahmini yazarkasa Z'sine ve LafPOS'un KDV dökümüne dayansın. (26 Kasım; kaynak satırı: "12 gün yazarkasa Z'sinden, 3 gün tahmin")
- [x] [Ladmin] Vardiyası değişen personele bildirim gitsin. Gelecek haftanın planı yazılmadıysa hatırlatılsın. (26 Kasım)
- [x] [Ladmin] Onay istekleri yöneticinin telefonuna bildirim olarak gitsin. (26 Kasım)
- [x] [Ladmin] Yönetici hesaplarında iki adımlı doğrulama zorunlu olsun; yeni cihazdan girişte uyarı. (26 Kasım; acil durum: Vercel'de `ADMIN_2FA_OPTIONAL=1`)
- [x] [Ladmin] Telefonda üst çubukta hangi şubenin görüldüğü yazsın. (26 Kasım)

## Dalga 3 (sonra)

- [ ] [Ladmin] "Müdür" ve salt okunur "Muhasebeci" rolleri.
- [ ] [Ladmin] Marina ay sonu kaçak raporu: tahmini stokla sayım arasındaki fark TL olarak, en çok kaçan kalemlerle.
- [ ] [İkisi] Kişi bazında kayıp önleme özeti: kasa farkı, iptal, ikram ve indirimin kişiye göre sapması. LafPOS iptali yapanı ve ikram edeni göndermiyorsa LafPOS'a da ekleme gerekir.
- [x] [Ladmin] Banka ve tedarikçi ekstresiyle mutabakat. (26 Kasım; Kâr & ödemeler › Mutabakat, docs/MUTABAKAT.md)
- [x] [Ladmin] Banka POS hakediş mutabakatı: kart satışı ile bankaya gelen para karşılaştırılır. (26 Kasım; Mutabakat › POS hakediş)
- [ ] [Ladmin] Muhasebeciye aylık tek paket ve ay kapanış e-postası.
- [ ] [Ladmin] Kontrol listelerinin denetime hazır aylık PDF'i.
- [ ] [Ladmin] Asistana fiş fotoğrafı: telefonda çekince kart hazırlanır.
- [ ] [İkisi] Tuzla LafPOS'a geçecekse iki şubeli LafPOS.
- [ ] [Ladmin] Dönem kapanışı: beyan edilmiş aya sonradan fatura girmesin. Reçete geçmişi tutulsun.
- [ ] [Ladmin] İşçilik maliyeti / ciro oranı: günlük, haftalık ve şube şube.
- [ ] [Ladmin] Personel belgeleri (hijyen eğitimi, sağlık raporu, SGK) ve avans takibi.

## Düşük öncelikli güvenlik notları

- [ ] Paraşüt bağlantısı adres çubuğundan başlatılabiliyor. Bir düğmeyle (POST) başlatılmalı ve hesabı tek kullanımlık bir değerle seçmeli.
- [ ] Döndürülen LafPOS anahtarı önbellek yüzünden en çok 60 saniye daha geçerli kalıyor.
- [ ] Content-Security-Policy başlığı yok.

## Bekleyen başka iş

- [ ] Vardiyayla ilgili şube maddeleri (hazır vardiya saatleri şube ayarına, "Tümü"de şube seçimi). Başka bir oturumun açık PR'ı #120 birleşince yapılacak.

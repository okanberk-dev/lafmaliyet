# Yapılacaklar (ladmin)

Son güncelleme: 25 Kasım 2026. Kaynak: 25 Kasım yönetim paneli denetimi ve sahibin istekleri.

Etiketler:
- **[Ladmin]**: yalnız panelde değişiklik.
- **[İkisi]**: panelle birlikte LafPOS'ta da değişiklik gerekir.
- **[Sahip]**: kodla değil, ayarla ya da hesapla çözülür.

LafPOS deposunda değişiklik gerektiren her madde sahibin onayını bekler.

## Şu an yapılıyor

- **Dalga 1** (dal `ai/dalga-1`). Denetimin 11 hatası ve küçük düzeltmeleri:
  - kör kasa
  - fişsiz çıkış
  - kasa formu taslağı
  - vardiya çakışması
  - part-time silme koruması
  - 09:00 zili
  - "Tümü" kâr dönemi
  - şube oranı
  - zil
  - rozetler
  - büyüme gösterimi

  Aynı dalda şunlar da var: eski Excel tablosu kalıntılarının kaldırılması, dışa aktarımın profesyonelleşmesi, gerileme denetimi.
- **Uyarı satırları yalnız personelde** (#145). "Uyarı sesleri susturuldu" gibi satırlar yöneticide çıkmaz.
- **Şube kapsamı: faturalar ve Paraşüt şubeye göre.** İstenen davranış:
  - Tuzla seçiliyken yalnız Tuzla'nın, Marina seçiliyken yalnız Marina'nın bilgileri görünür.
  - "Tümü"de ikisi birlikte görünür.

  Bugün iki şube aynı Paraşüt hesabını kullandığı için faturalar "işletme geneli" sayılıyor ve iki şubede de görünüyor. Yapılacaklar:
  - Her faturaya şube atanacak: tedarikçinin varsayılan şubesi, faturada elle değiştirme ve toplu seçim.
  - Paraşüt sayfası, Faturalar, Gelir-gider ve Maliyet bu şubeye göre süzülecek.
  - Şubesi belirsiz faturalar "Şubesi seçilmemiş" kutusunda bekleyecek.
- **Faturaları sınıflandırma:**
  1. **Karışık fatura kalem kalem bölünecek.** Hammaddeye bağlı kalemler mal alışı, kalanı sarf gideri sayılacak. Avansas'taki sorunu kökten çözer.
  2. **Ayrı "Temizlik & Sarf" kategorisi.** Kuralsız faturalar "Diğer"e düşmez; "Diğer" yalnız sınıflanmamış faturaların bekleme kutusu olur. Kategori kuralı temizlik firmasını (Hizmet) temizlik malzemesinden (Sarf) ayıracak.
  3. **"Hammadde değil" denince kategori sorulacak.** Örneğin "Sarf" seçilirse kalem doğrudan doğru gidere yazılır.
  4. **Paraşüt sayfası hafifleyecek.** Bugün bekleyen her kartta 108 seçenekli tam liste var ve sayfa yaklaşık 90 bin karakter. Yerine aranabilir tek bir seçici gelecek.
  5. **AI önerisine fatura açıklaması da verilecek.** Kısaltmalarda yanılıyor: "KRP END KONTY"yi toner sandı, aslında çöp torbası. Faturanın açıklaması, tedarikçi ve kalemin bağlamı istemde yer alacak.

## Sahibin tarafında (kod değil)

- [ ] laffogato.net veritabanının (Neon) kotası 24 Kasım'da doldu. Online sipariş, karaoke ve menü eşitlemesi duruyor. Ücretli plana geçin ya da Coolify'a taşıyın.
- [ ] GitHub'a `CRON_SECRET` ekleyin ve GitHub ödeme sorununu çözün. Kontrol listesi hatırlatmalarının yedek tetikleyicisi bunlar yüzünden çalışmıyor.
- [ ] Panelin veritabanı da ücretsiz planda. Ücretli plana geçin. Geçilmeyecekse %70 ve %90 kota uyarısı eklensin.
- [ ] Vercel'de artık kullanılmayan `PARASUT_USERNAME` ve `PARASUT_PASSWORD` silinsin.
- [ ] Fotoğraf okuma istemleri canlı modelle denensin (`FOTO_EVAL=1`). 24 Kasım'ın gerçek Z fotoğrafı değerlendirmeye eklensin.

## Dalga 2 (1 ay içinde)

- [ ] [Ladmin] Otomatik haftalık yedek; son 8 hafta saklanır.
- [ ] [Ladmin] Tuzla'da kör sayım. Önce sayılan nakit girilip kilitlenir, fark sonra görünür.
- [ ] [İkisi] Teslim defteri: teslim edilen nakdi kimin aldığı kaydedilir. Tuzla'nınki panelde yapılır; Marina'da LafPOS'a da ekleme gerekir.
- [ ] [Ladmin] Şube karşılaştırma ekranı: şubeler ay ay yan yana.
- [ ] [Ladmin] Stok tahmini Marina'nın online siparişlerini düşsün; "kaç gün yeter" ve eşik önerisi eklensin.
- [ ] [Ladmin] Asistanın fiyat kartı şube fiyatını bilsin. Asistan şubeyi açık ekrandan okusun; "bugün" iş günü (05:00) olsun.
- [ ] [Ladmin] Ayrı Paraşüt firması bağlanırken "Aynı vergi numarası mı?" diye sorulsun.
- [ ] [Ladmin] KDV tahmini yazarkasa Z'sine ve LafPOS'un KDV dökümüne dayansın.
- [ ] [Ladmin] Vardiyası değişen personele bildirim gitsin. Gelecek haftanın planı yazılmadıysa hatırlatılsın.
- [ ] [Ladmin] Onay istekleri yöneticinin telefonuna bildirim olarak gitsin.
- [ ] [Ladmin] Yönetici hesaplarında iki adımlı doğrulama zorunlu olsun; yeni cihazdan girişte uyarı.
- [ ] [Ladmin] Telefonda üst çubukta hangi şubenin görüldüğü yazsın.

## Dalga 3 (sonra)

- [ ] [Ladmin] "Müdür" ve salt okunur "Muhasebeci" rolleri.
- [ ] [Ladmin] Marina ay sonu kaçak raporu: tahmini stokla sayım arasındaki fark TL olarak, en çok kaçan kalemlerle.
- [ ] [İkisi] Kişi bazında kayıp önleme özeti: kasa farkı, iptal, ikram ve indirimin kişiye göre sapması. LafPOS iptali yapanı ve ikram edeni göndermiyorsa LafPOS'a da ekleme gerekir.
- [ ] [Ladmin] Banka ve tedarikçi ekstresiyle mutabakat.
- [ ] [Ladmin] Banka POS hakediş mutabakatı: kart satışı ile bankaya gelen para karşılaştırılır.
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

# Yapılacaklar (ladmin)

Son güncelleme: 25 Kasım 2026. Kaynak: 25 Kasım yönetim paneli denetimi ve sahibin istekleri.

Etiketler:
- **[Ladmin]**: yalnız panelde değişiklik.
- **[İkisi]**: panelle birlikte LafPOS'ta da değişiklik gerekir.
- **[Sahip]**: kodla değil, ayarla ya da hesapla çözülür.

LafPOS deposunda değişiklik gerektiren her madde sahibin onayını bekler.

## Bitenler (25 Kasım 2026)

- **Dalga 1** (#146): kör kasa, fişsiz çıkış, kasa formu taslağı, vardiya çakışması, part-time silme koruması, 09:00 zili, "Tümü" kâr dönemi, şube oranı, zil ve rozetler, büyüme gösterimi, eski Excel kalıntılarının kaldırılması, dışa aktarımın profesyonelleşmesi.
- **Uyarı satırları yalnız personelde** (#145).

## Yarım kalan: dal `ai/fatura-sube` (main'e GİTMEDİ)

Haftalık kullanım limiti dolduğu için yarım kaldı. Son hali `ai/fatura-sube` dalında "ARA KAYIT (yarım)" commit'leriyle duruyor.

- Henüz doğrulanmadı: testler, `npm run ci:yerel` ve derleme koşulmadı.
- Göçler (0087–0089) var.
- Sürdürmeden önce dalı origin/main ile birleştir (#145 ve #146 sonrası). Göç numaraları çakışırsa göçleri yeniden üret.

Yapılan kısım (doğrulanmadı):
- Faturaya şube alanı ve göçler.
- Tedarikçinin varsayılan şubesi.
- "Şubesi seçilmemiş" kutusu.
- Paraşüt, Faturalar ve tahmini stok için şube süzgeci.

Sınıflandırma maddelerinin (aşağıda 1–6) henüz hiçbiri yapılmadı.

- **Şube kapsamı: faturalar ve Paraşüt şubeye göre.** İstenen davranış:
  - Tuzla seçiliyken yalnız Tuzla'nın, Marina seçiliyken yalnız Marina'nın bilgileri görünür.
  - "Tümü"de ikisi birlikte görünür.

  Bugün iki şube aynı Paraşüt hesabını kullandığı için faturalar "işletme geneli" sayılıyor ve iki şubede de görünüyor. Yapılacaklar:
  - Her faturaya şube atanacak: tedarikçinin varsayılan şubesi, faturada elle değiştirme ve toplu seçim.
  - Paraşüt sayfası, Faturalar, Gelir-gider ve Maliyet bu şubeye göre süzülecek.
  - Şubesi belirsiz faturalar "Şubesi seçilmemiş" kutusunda bekleyecek.
- **Faturaları sınıflandırma** (dal `ai/fatura-sube`):
  1. **Karışık fatura kalem kalem sayılacak (en önemlisi).**
     - Bugün bir fatura ya tamamen mal alışı ya tamamen gider sayılıyor.
     - Hammaddeye bağlı kalemler mal alışına, kalanı sarf giderine yazılacak.
     - Faturadaki toplam iskonto kalemlere tutarlarıyla orantılı dağıtılacak.
     - "Stoğa giriyor, gelir-gidere girmiyor" kontrolü, vergi hesabı, dışa aktarım ve çifte gider kontrolü aynı mantığa geçecek.
     - En riskli kısım bu; en çok test burada.
  2. **Tedarikçi bazlı "hep hammadde değil" kuralı.**
     - Kural açık tedarikçinin yeni kalemleri bekleyenlere düşmeyecek. Örnek: Avansas'ın ofis ve temizlik kalemleri.
     - Zaten bir hammaddeye bağlı kalemler (çay, soda) bu kuraldan etkilenmeyecek.
  3. **"Temizlik & Sarf" kategorisi.**
     - Gelir-giderde sarf gideri olarak sayılacak.
     - Kategori kuralı temizlik firmasını (Hizmet) temizlik malzemesinden (Sarf) ayıracak.
     - "Diğer" yalnız sınıflanmamış faturaların bekleme kutusu olacak.
  4. **AI eşleştirme istemi.** İsteme şunlar da verilecek:
     - tedarikçi
     - faturadaki diğer kalemler ve faturanın açıklaması
     - bilinen kısaltmalar
     - tedarikçide geçmişte "hammadde değil" denen kalemler

     Örnek hata: "KRP END KONTY" çöp torbasıydı, AI toner sandı.
  5. **Paraşüt sayfası hafifleyecek.** Bekleyen her kartta 108 seçenekli tam liste var ve sayfa yaklaşık 90 bin karakter. Yerine aranabilir tek bir seçici gelecek.
  6. **"Hammadde değil" için neden etiketi.**
     - Seçenekler: Sarf, Demirbaş, Hizmet, Deneme. Kalem seçilen yere yazılacak.
     - Demirbaş seçilince Vergi › Demirbaş'a eklenmesi önerilecek. Örnek: 10.000 ₺'lik tüplü ısıtıcı.

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

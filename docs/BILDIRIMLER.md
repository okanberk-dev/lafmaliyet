# Ödemeler, hatırlatıcılar ve e-posta bildirimleri

Ekran: **Satış & gider › Ödemeler & hatırlatıcılar** (`/panel/hatirlaticilar`).

## Ne listelenir

- **Hatırlatıcılar:** kira, vergi/SGK, maaş, abonelik gibi ödemeler. Bir kez ya da her hafta / ay / üç ayda bir /
  yıl tekrar eder. "Ödendi" işaretlenince tekrar edenler bir sonraki döneme geçer (ayın günü korunur: 31'i olmayan
  ayda son gün).
- **Ödenmemiş faturalar:** Faturalar'da "ödenmedi" olanlar (Paraşüt'ten gelenler dahil; ödendi'yi Tedarikçiler ya
  da Faturalar ekranında siz işaretlersiniz, [TEDARIKCILER.md](TEDARIKCILER.md)). Vade tarihi yoksa fatura
  tarihinden 30 gün sonra vadeli sayılır (ayarlanabilir; tedarikçinin bilgilerinde (Tedarikçiler) vade günü yazılıysa o geçer);
  vade ekrandan girilebilir.
- **Vergi takvimi şablonları:** KDV (takip eden ayın 28'i), muhtasar ve prim hizmet (26'sı), SGK primi (ay sonu),
  geçici vergi (çeyrekten sonraki ikinci ayın 17'si), maaş. Genel takvimdir; işletmenize göre muhasebecinizle
  kontrol edin, tarihi düzenleyebilirsiniz.
- **Sabit giderlerden:** Giderler & personel'deki aylık/haftalık/yıllık giderlerden, ilk ödeme tarihi seçilerek;
  gider döneminde tekrar eder.

Gecikmiş ve yaklaşan ödemeler kenar çubuğundaki **zilde** de görünür. Zilin **Onaylar** başlığında yöneticiye onay
bekleyen reçete önerileri, onay bekleyen hammadde fiyatları (`docs/PARASUT.md` 5b) ve personelin onay bekleyen
istekleri durur (istek başına bir satır, `/panel/onaylar#istek-<id>`'e götürür; satır istek güncellenince en çok 10
dakikada bir yeniden okunmamış olur; [ONAYLAR.md](ONAYLAR.md)). Personelde aynı başlığın adı **İsteklerim**: reçete
önerilerinin ve isteklerinin sonucu ("22 Ekim kasa düzeltmeniz onaylandı", "Yönetici: <not>"). **Uyarılar** başlığının
başında, kasada (ModPOS) elle değiştirilecek fiyat varken **"Kasada değişecek N fiyat"** durur (**Ürünler › Fiyatlar ›
Kasaya işle**'ye götürür, listeye yeni fiyat girince yeniden okunmamış olur, işaret onu yeniden okunmamış yapmaz;
e-postaya girmez, `docs/FIYATLAR.md`); personelde aynı satır **Kasa** başlığında, "ModPOS'ta değiştirip Kasadaki
fiyatlar'da işaretleyin" diye **Kasadaki fiyatlar**'a götürür (dalga 10 §2.2). Yöneticinin **Uyarılar** başlığında
personelin tükendi yaptığı ürünler de durur ("Tükendi: Tiramisu, Cheesecake", bar ekranının Tükenenler kartına; bir
kayıt 24 saatten eskiyse ya da son bir saatte 3 ürün kapandıysa uyarı rengi; push yok; dalga 10 §2.1). Zilin
satırlarını alanların modülleri üretir ve iki rol dalında da çağrılır: kasa `src/server/bell/kasa.ts`, operasyon
(kasadaki fiyatlar, Tükendi, mal siparişi taslağı, zayi istekleri) `src/server/bell/ops.ts`; toplayıcı
`src/server/actions/notifications.ts`. **Kontrol listeleri** başlığında (kasanın ardından, iki rolde) yöneticiye bugün son saati geçen
liste, dün tamamlanmayan liste ve bugünün ve dünün açık sorunları (aralık dışı ölçüm kırmızı, "Sorun var" turuncu; en
yeni 5), personele aralığı açık ("bekliyor", bilgi) ve son saati geçen ("gecikti") liste durur
([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md) § 6). **Faturalar** başlığında yöneticiye komisyon ve hakediş uyarıları da
durur: geciken hakediş, yemek kartında kesin %6 aşımı, komisyon dışı ücret olabilecek kalem (en çok 5; Komisyon &
hakediş'te kanalın kartına götürür, [KOMISYON.md](KOMISYON.md) § 8).
Başlığın sonunda mal siparişlerinin teslim kontrolü durur: faturayla tutmayan sipariş ("Teslim kontrolü: Sütaş", fark
değişince yeniden okunmamış olur) ve beklenen günden 2 gün sonra hâlâ gelmeyen ("Mal siparişi gelmedi mi: Kaldi"); en
çok 5, Gönderilenler'deki siparişe götürür ([MAL-SIPARISI.md](MAL-SIPARISI.md) § 8).

## Son ödenenler (geri alma)

"Ödendi" bildirimindeki **Geri al** 8 saniye durur. Kaçırılırsa ya da yanlışlık sonradan fark edilirse, listenin
altındaki **Son ödenenler** bölümünden (kapalı açılır kutu; `#son-odenenler`) geri alınır:

- Son **30 günde** "Ödendi" işaretlenen fatura ve hatırlatıcılar, en yeni önce, en çok 30 kayıt. Liste, Ödemeler
  ekranından, Faturalar'da tek tek / toplu "Ödendi"den, fatura penceresinde ödenmedi → ödendi kaydedilince ve
  Tedarikçiler'deki ödeme penceresi, ✓ ve toplu işlemle dolar.
- **Fatura** için Geri al, faturayı yeniden "ödenmedi" yapar (ödemesi talep edilmişse "talep edildi"); ödeme
  listesine ve sabah e-postasına döner.
- **Hatırlatıcı** için Geri al, ödenmeden önceki hâline döndürür (tarih, tekrar günü, açık/kapalı, son ödeme):
  tekrar eden kira 01.11'den 01.10'a geri gelir, kapanan tek seferlik yeniden açılır.
- Hatırlatıcı ödendikten sonra değiştiyse (yeniden ödendi, ertelendi, kapatıldı, tarihi düzenlendi) eski hâl yazılmaz;
  satır listede görünmez. Silinen hatırlatıcı ve sonradan "ödenmedi" yapılan fatura da görünmez. Ödemeden sonraki bir
  ertelemenin bildirimden geri alınması kaydı yeniden geçerli kılar.
- Kayıt ayrı tablo değil, `integration_state` tablosunda `payments.recent` anahtarıdır; yazılamazsa asıl işlem
  (ödendi) yine yapılır, yalnız geri alma listesi eksik kalır.

## E-posta

Her sabah 08:00–09:00 arasında (Vercel Cron, `/api/cron/gunluk`; Hobby planında saat esnek) tek bir **sabah
e-postası**, bildirim adreslerine gider. İçinde:

- zamanı gelen ödemeler (aşağıdaki aşamalarla);
- **Paraşüt'ten gelen yeni faturalar** (son sabah e-postasından bu yana eşitlemenin açtıkları: tedarikçi, tarih,
  kategori, tutar; en çok 10 tanesi listelenir);
- **kontrol bekleyen** fatura sayısı (kategorisi tahminle yazılmış), bağlantısıyla;
- **onay bekleyen hammadde fiyatları** (Paraşüt bölümünde, kontrol kutusunun altında): faturada şimdikinden %40'tan
  fazla farklı gelen, onay bekleyen fiyatlar (`docs/PARASUT.md` 5b), Hammaddeler › Onay bekleyen fiyatlar bağlantısıyla.
  Bekledikçe bölümde görünür; e-postayı yalnız son Paraşüt bölümlü e-postadan beri onaya düşen fiyat gönderir;
- son Paraşüt eşitlemesi başarısızsa uyarı (aynı hata bir kez bildirilir);
- **komisyon ve hakediş** (fiyat onayından sonra): geciken hakediş, yemek kartında %6 aşımı ve komisyon dışı ücret
  olabilecek kalem; her uyarı bir kez (`komisyon:<uyarı>`), en çok 5, Komisyon & hakediş bağlantısıyla. Konuya "Hakediş
  gecikti: Pluxee (Ekim)", "2 hakediş gecikti" ya da "komisyon uyarısı" eklenir ([KOMISYON.md](KOMISYON.md) § 8);
- **dünkü kontrol listeleri** (eksik ya da sorun varsa): tamamlanmayan listeler ("3 / 13 madde; yapılmayan: …" ya da
  "hiç açılmadı"), aralık dışı değerler ve "Sorun var" notları (en çok 5), o gün kasa raporu da yoksa "kafe kapalıysa
  önemsemeyin"; her gün için bir kez (`kontrol:{gün}`), Kontrol listeleri › Geçmiş bağlantısıyla
  ([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md) § 6);
- **hammadde zamları**: son zam bölümlü e-postadan bu yana fiyatı %5'ten fazla artan hammaddeler (eski → yeni
  ₺/kg, ₺/L, ₺/adet) ve fiyatı hedef maliyet oranının altında kalan ürünler, önerilen fiyatlarıyla (en çok 6);
  bağlantı Ürünler › Hammadde zamları'na gider (`docs/PARASUT.md` 5a). Her zammın fiyatlarının altında ayda kaç
  lira kâr götürdüğü ("ayda ≈ 690 ₺", kendi satırında: telefonda e-posta taşmasın), bölümün başında bu yeni zamların
  toplamı ("Bu zamlar ayda ≈ 1.240 ₺ kâr götürüyor (Eylül 2026 satışlarıyla).") yazar. Dayanak son satış ayının ürün
  adetleridir; adetler Ayarlar'daki ayda açık gün sayısına çevrilir (o ayın açık günü girilmemişse olduğu gibi),
  maliyet artışına fire payı dahildir, Zayi & ikram kayıtları sayılmaz (`src/lib/calc/price-loss.ts`). Satış ayı
  yoksa ya da tutar 1 ₺'den azsa yazılmaz. Genel bakış'taki ve zildeki "Hammadde zammı" uyarısının sonuna da aynı
  toplam eklenir ("Bu zamlar ayda ≈ 1.240 ₺ kâr götürüyor."; orada son 30 günün bütün zamları);
- **satış tahmini** (en altta, düğmeden önce; Satış tahmini › Tahmin ayarları'nda "Sabah e-postasına tahmin satırı"
  açıkken): bugünün tahmini, aralığı, yoğunluğu, kaç kişi ve nedenleri ("Bugün ≈ 18.500 ₺ (16.000–21.000) · yoğunluk
  yüksek · 2 kişi · Cumhuriyet Bayramı arifesi, yağmur"), dünün tahmini ve gerçekleşeni, haftanın en yoğun günü ve
  7 günün tatlısı, MET Norway kaynağı; Satış tahmini bağlantısıyla. **Yalnız zaten giden e-postaya eklenir**: tahmin
  için ayrıca e-posta gitmez, konu, başlık ve düğme değişmez ([SATIS-TAHMINI.md](SATIS-TAHMINI.md));
- **onay bekleyenler** (kontrol listelerinden sonra): personelin onay bekleyen istekleri, "2 istek onay bekliyor" ve en
  eskisinin ne zamandan beri beklediği, istek başına yalnız başlık ve isteyenin adı ("22 Ekim kasa düzeltmesi
  (Mehmet)", "Kaldi · 5 kalem (Ayşe)"; en çok 8), Onaylar bağlantısıyla; tutar yok. Karar verilene kadar her sabah
  listelenir. Aynı kutunun sonunda operasyonun bilgi satırları durur (personelin tükendi yaptığı ürünler: "Tiramisu
  (Selin, 2 gündür)"; yalnız ad ve süre). Konuya "2 istek onay bekliyor" eklenir ([ONAYLAR.md](ONAYLAR.md));
- en üstte **Sistem uyarıları**: dünkü sabah işi çalışmadıysa ya da hata verdiyse, bu sabahki Paraşüt işi
  çalışmadıysa (aşağıda "Sistem uyarıları"; yalnız canlıda).

Ödeme, yeni fatura, eşitleme hatası, yeni fiyat onayı, yeni zam, sistem uyarısı, yeni komisyon uyarısı, dünkü kontrol listelerinin kutusu ya da onay bekleyen personel isteği yoksa e-posta gitmez. Konu öncelik
sırasıyla: ödeme varsa "Ödeme hatırlatması: …" (sonuna " · sistem uyarısı", yeni fatura, yeni fiyat onayı, zam eklenir);
yoksa sistem uyarısı varsa "Sistem uyarısı: <ilk sorun>"; yoksa yeni faturasız eşitleme hatası "Paraşüt eşitlemesi
başarısız"; yoksa yeni fatura, kontrol bekleyen ya da yeni fiyat onayı "Sabah özeti: …" (ör. "Sabah özeti: 2 fiyat onay
bekliyor"); yoksa zam. Paraşüt eşitlemesi bir saat önce ayrı bir işte
çalışır; o sabah başarısız olduysa e-posta işi önce bir kez daha eşitler. Her ödeme için en fazla üç kez haber
verilir:

| Aşama | Ne zaman |
|-------|----------|
| Yaklaşıyor | Son günden "kaç gün önce" kadar önce (hatırlatıcı başına; faturalar için ayardan) |
| Bugün | Son gün |
| Gecikti | Son gün geçtikten sonra (14 gün içinde bir kez) |

Tekrar eden bir hatırlatıcının bir dönemi "ödendi" işaretlenmeden geçerse, sonraki dönem de listede ve e-postada
görünür (ör. Ekim KDV gecikti, Kasım KDV 4 gün kaldı); sonraki dönemde "Ödendi", o güne kadarki dönemleri kapatır.
Kapatılıp yeniden açılan tekrarlı hatırlatıcı bugünden sonraki ilk döneme geçer.

Aynı hatırlatmanın ikinci kez gitmemesi `notification_log` tablosundaki tekil anahtarla sağlanır
(`kaynak:kimlik:vade:aşama`, ör. `reminder:4:2026-10-28:before`, `invoice:23:2026-10-31:due`). Geciken dönemin
yanında görünen sonraki dönem de aynı anahtarı kullanır: Ekim kirası gecikmişken Kasım için "yaklaşıyor" gittiyse,
Ekim ödenip Kasım gerçek döneme dönünce aynı e-posta ikinci kez gitmez. Gönderim başarısız olursa anahtar yazılmaz,
ertesi sabah yeniden denenir; hata ekrandaki "Son gönderimler"de görünür.

Resend'e her e-posta içerikten türeyen bir tekil anahtarla (`Idempotency-Key`) gider: aynı iletinin yeniden denemesi
ve sabah işiyle elle gönderimin çakışması tek e-posta olur. Paraşüt bölümünün anahtarı son Paraşüt bölümlü gönderimin
anını da içerir; aynı gün ikinci kez "şimdi gönder" denince (aynı sayıda yeni fatura gelse de) anahtar değişir.

Gönderim üç kez denenir (her deneme en çok 15 sn). Sabah işinde gönderim en geç işin 48. saniyesinde kesilir: Resend
takılırsa iş 60 saniyelik sınırı aşmasın, sonraki adımlar (hatırlatıcı bildirimi, eşitlemeler) çalışsın. Kesilen
gönderim (ağ hatası ve Resend'in "aynı ileti hâlâ işleniyor" yanıtı da) "Son gönderimler"de ve Ayarlar › Günlük
işler'de "Resend yanıt vermedi; e-posta yine de gitmiş olabilir." diye görünür: ileti ulaşmış olabilir, ham hata
yalnız Vercel günlüğündedir. Aynı gün **Bugünküleri şimdi gönder** aynı tekil anahtarla gider: ilk ileti ulaştıysa
Resend ikinci kez göndermez.

**Ek kutular (geliştirici notu).** Başka ekranların sabah e-postasına eklediği kutular (komisyon ve hakediş, dünkü
kontrol listeleri, onay bekleyenler, satış tahmini) `src/server/notify/digest-extras.ts` › `DIGEST_EXTRA_SOURCES` listesinde birer
satırdır: `{ key, news, load(today, { preview }) }`; kutunun kendisi (`DigestBox`: başlık, satırlar, panel yolu,
bağlantı metni, konu parçası, başlık) grubun kendi saf modülünde kurulur ve sınanır. Kaynaklar ötekilerle aynı anda,
her biri en çok 4 saniye yüklenir; hata veren ya da geciken kutu düşer, e-postayı bozmaz. `news: true` kutu e-postayı
tek başına gönderir; satış tahmini hiçbir zaman haber değildir (yalnız zaten giden e-postaya eklenir; konuya, başlığa ve
düğmeye girmez). Kutunun anahtarları (`komisyon:<uyarı>`, `kontrol:<gün>`) tekil anahtara girer ve yalnız başarılı
gönderimden sonra `notification_log`'a yazılır; daha önce bildirileni kaynak kendisi eler (onay bekleyenlerin anahtarı
yok: karar verilene kadar her sabah). Gövdedeki sıra: sistem uyarıları, ödemeler, faturalar, kontrol bekleyen, fiyat
onayı, komisyon, kontrol, onay bekleyenler, zam, tahmin, düğme. Konuda kutunun
parçası zamdan sonra eklenir ("Ödeme hatırlatması: 1 bugün · 1 hammaddeye zam · dünkü kapanış listesi eksik"); ödeme,
sistem uyarısı, fatura ve fiyat onayı yoksa konu "Sabah özeti: <kutunun parçası>" olur, başlık ve düğme kutunun.
Konu parçası ya da başlığı olmayan kutu e-postanın tek içeriğiyse konu ve başlık kutunun parçasını, o da yoksa adını
yazar ("bugün yeni bir şey yok" yazılmaz).
Kutunun bağlantısı yalnız panelin bir yolu olabilir (fotoğraf ya da depo adresi yazılmaz). Önizleme kutuları yazmadan
gösterir; liste boşken e-posta öncekinin aynısıdır. Ayrıntı: `docs/planlar/CRITIQUE2.md` R11.

Ekrandan (sağdaki **E-posta bildirimleri** kutusu; kapalıyken tek satır özet):

- özet satırında açık/kapalı, adres sayısı ve gönderim durumu ("her sabah 08:00", "elle gönderim", "gönderim
  bekliyor"). Resend bağlıyken ayrıca bir şey yazılmaz; `RESEND_API_KEY` yoksa kırmızı **Resend bağlı değil**
  rozeti ve açınca anahtarın nereye girileceği görünür (`CRON_SECRET` yoksa da);
- e-postaları açma / kapatma anahtarı: yalnız açık/kapalıyı kaydeder, "Gönderim ayarları"nda yazılıp
  kaydedilmemiş değerlere dokunmaz;
- bildirim adresi ekleme, kapatma, silme;
- **E-postayı önizle** (gönderilmez): bugün gidecek sabah e-postasının kendisi, sistem, Paraşüt ve zam bölümleriyle;
  ödeme, yeni fatura, zam ya da sistem uyarısı yoksa örnek bir ödeme satırıyla;
- **Deneme gönder** (kayıtlı gönderenle, etkin adreslere);
- **Bugünküleri şimdi gönder** (sabahı beklemeden; daha önce gidenler tekrar gitmez). Bildirimde ne gittiği
  yazar: "2 hatırlatma · 4 yeni fatura · 1 zam";
- gönderen adresi ve gün ayarları (Gönderim ayarları › Kaydet).

## Haftalık özet (pazartesi)

Her pazartesi 08:00–09:00 (gönderilemezse salı, sonra çarşamba) **yöneticilere** (etkin yönetici hesaplarının giriş
e-postaları; bildirim adresleri almaz) kısa bir e-posta gider: kasanıza etkisine göre sıralı en çok 5 madde (nakit
planında para yetmeyecek gün, zam etkisi, kasa eksikleri, komisyon ve hakediş, ModPOS'ta eski fiyat, zayi ve ikram, stok
farkı; karaoke doluluğu ve kontrol listeleri sonda), her biri ilgili ekranı açar; üstte geçen haftanın kasa cirosu ve
satış tahmini kendi verisiyle çalışıyorsa önümüzdeki 7 günün beklenen satışı ([SATIS-TAHMINI.md](SATIS-TAHMINI.md)).
Sabah e-postasıyla aynı kabuk, ayrı anahtar: E-posta bildirimleri › **Haftalık özet** (aç / kapa, önizle, örneği bana
gönder). Haftada en çok bir kez (`haftalik:<hafta>`). Ayrıntı: [HAFTALIK-OZET.md](HAFTALIK-OZET.md).

## Sistem uyarıları (günlük işler)

Her sabah iki zamanlanmış iş çalışır (`vercel.json`, Vercel Cron, yalnız canlıda): 07:00–08:00 **Paraşüt eşitlemesi**
(`/api/cron/parasut`), 08:00–09:00 **sabah işi** (`/api/cron/gunluk`: sabah e-postası, hatırlatıcı bildirimi,
karaoke / menü / online satış eşitlemeleri). Her çalışma başlarken ve biterken `job_runs` tablosuna yazılır (adımların
sonucu ve hatasıyla; 90 gün tutulur). Ekran: **Ayarlar › Günlük işler** (`/panel/ayarlar#isler`): iki işin son
çalışması, rozeti (Çalıştı, Atlandı, Sürüyor, Bekleniyor, Çalışmadı, Hata, Yarıda kesildi, Kısmen), adımları ve hatası.

Pencere sonundan 30 dakika sonra (Hobby planında saat esnek) o günün çalışması aranır (`src/lib/job-health.ts`):

| Durum | Zil (Sistem) | Genel bakış | E-posta |
|-------|--------------|-------------|---------|
| Sabah işi çalışmadı / hata verdi / yarıda kesildi | kırmızı | kırmızı şerit | ertesi sabah bekçi e-postası (gidemezse sabah e-postasında) |
| Sabah işinde bir adım hata verdi (ör. menü eşitlemesi) | turuncu | — | ertesi sabahın sabah e-postasında (bekçi ayrı e-posta atmaz) |
| Paraşüt işi çalışmadı | turuncu | — | aynı sabahın e-postası (eşitlemeyi sabah işi yaptıysa söyler) |
| Paraşüt işi hata verdi / yarıda kesildi | kırmızı (eşitlemenin kendi hatası zaten "Paraşüt eşitlemesi başarısız" olarak görünüyorsa yinelenmez) | kırmızı şerit | — (hata sabah e-postasında) |
| `CRON_SECRET` tanımlı değil | kırmızı, tek iş uyarısı | kırmızı şerit | — (hiçbir iş çalışmaz) |
| Son yedek 30 günden eski ya da hiç yedek yok (işlerden bağımsız) | mavi, Ayarlar › Yedek'e götürür ([YEDEK.md](YEDEK.md)) | — | — |

- **Bugün ekranı** ([BUGUN.md](BUGUN.md)): kırmızı uyarılar yöneticiye listenin ilk satırında ("Günlük işler", sorun
  var) görünür ve Ayarlar › Günlük işler'e götürür. Bugün'de ayrı bir "Paraşüt eşitlemesi başarısız" satırı olmadığı
  için Paraşüt işinin hatası, eşitlemenin kendi hatası olsa da orada yazılır; sonradan başarılı bir eşitleme olunca
  (sabah işinin yeniden denemesi ya da Paraşüt › Şimdi eşitle) kalkar, zildeki eşitleme satırı gibi.
- **Bekçi:** sabah e-postasını gönderen iş bozulursa bunu kendisi söyleyemez. Paraşüt işi her sabah önce dünkü sabah
  işine bakar; çalışmadıysa ya da hata verdiyse sabah e-postasının alıcılarına kısa bir **sistem uyarısı e-postası**
  gider (konu "L'Affogato · Dünkü sabah işi çalışmadı (21 Ekim)"; ne yapılacağıyla). Bekçi en çok 8 saniye bekletir,
  kalan süre eşitlemeye verilir. Gitmezse aynı uyarı sabah e-postasının "Sistem uyarıları" bölümüne girer.
- Her sorun e-postayla bir kez gider (`notification_log` anahtarı `job:<iş>:<gün>:<durum>`). Yarıda kesilen çalışmayı
  sonraki çalışma "hata" olarak kapatsa da durumu "yarıda kesildi" kalır: bekçinin gönderdiği uyarı sabah e-postasında
  yinelenmez.
- Yanlış alarm olmasın diye: önizlemede ve yerelde uyarı yok (`VERCEL_ENV=production` değilse); izlemenin başladığı an
  (`integration_state` › `jobs.watchSince`) o günün penceresinden sonraysa iş "Bekleniyor" sayılır; aynı gün sonradan
  başarılı olan çalışma önceki hatanın yerine geçer; bugün zaten çalışmış iş için dünkü hata sürmez. İzleme başlangıcı
  her işin başında yalnız yoksa yazılır; canlı derlemede işler son 26 saatte hiç kayıt yazmadıysa (ilk yayın, bozulan
  bir derleme ya da eski sürüme dönüş sonrası kayıt yazmayan kod çalıştı) o yayının anıyla değiştirilir. Bedeli: iki
  iş birden bir günden uzun süredir çalışmıyorsa yeni bir yayın "çalışmadı" uyarısını bir sonraki pencereye erteler.
- Elle çalıştırma: Vercel › lafmaliyet › Settings › Cron Jobs › **Run** (kayda geçer, uyarıyı kaldırır). Paraşüt için
  Paraşüt entegrasyonu › Şimdi eşitle, sabah e-postası için Ödemeler › Bugünküleri şimdi gönder de olur; bunlar iş
  kaydı yazmaz, uyarıyı kaldırmaz (panel uyarısını ertesi günün çalışması kaldırır, ama bekçi o sabah dünkü hatayı yine
  e-postayla söyler). Ayarlar › Günlük işler kartı da bunu söyler.
- Adım sözcükleri gerçekte olanı söyler: hatırlatıcısı olup bildirimi açık cihazı olmayan kişi "Hatırlatıcı var,
  bildirim açık cihaz yok"; bildirim hiçbir cihaza gidemediyse adım hata. Sabah e-postası "E-posta kapalı", "Resend
  kurulmadı" ya da "gitmedi: bildirim adresi yok" (gönderilecek bir şey vardı ama etkin adres yok; iş "Kısmen" sayılır,
  zilde turuncu).
- Haftalık özetin adımı (`weekly`) yalnız çalıştığı gün yazılır: "Haftalık özet gönderildi"; pazartesi "Haftalık özet
  kapalı" ya da "Haftalık özet: Resend kurulmadı"; "Haftalık özet: süre yetmedi, yarın denenecek"; "Haftalık özet
  gönderilemedi" (Resend reddetti, gönderim belirsiz, etkin yönetici yok ya da hiçbir bilgi okunamadı; iş "Kısmen"
  sayılır). Perşembe–pazar ve haftanın özeti gittikten sonra adım yok.
- Personel isteklerinin adımı (`requests`, [ONAYLAR.md](ONAYLAR.md)) yalnız süresi dolan bir istek kapandığında ("Süresi
  dolan personel istekleri kapandı") ya da adım hata verdiğinde yazılır ("Personel istekleri hata"; iş "Kısmen").

**İki iş birden durursa** (Vercel Cron hiç tetiklemiyor) e-posta da gidemez; panel zil ve Genel bakış'ta yine söyler
ama panel açılmazsa kimse görmez. Bunun için isteğe bağlı dış izleme: ücretsiz bir uptime servisine (ör. UptimeRobot,
"HTTP(s)" monitörü, e-posta uyarısı) `https://ladmin.laffogato.net/api/health?isler=1` adresini **6 saatte bir**
yoklayacak şekilde ekleyin (günde 4 kez yeter: işlerin durumu günde iki kez, sabah değişir). Daha sık yoklamayın:
panelin veritabanı Neon'un ücretsiz planında, her yoklama onu uyandırır ve beş dakika açık tutar (ayda 100 CU-saat;
saatte bir yoklama tek başına ayda ~15 CU-saat, kota dolunca veritabanı ay sonuna kadar kapanır). Adres giriş istemez,
yalnız durum adlarını döner (`{ ok, db, ms, isler: { cronSecret, gunluk, parasut } }`); ciddi bir sorun varsa (iş
çalışmadı, hata verdi, CRON_SECRET yok) **503** döner ve servis e-posta atar (yedek hatırlatması sayılmaz). Aynı
sunucuya gelen yoklamalar 10 dakika aynı yanıtı alır (`cached: true`), veritabanı yeniden sorulmaz.
`?isler=1` olmadan `/api/health` yalnız veritabanına bakar (yanıt veren veritabanı 5 dakika yeniden sorulmaz).

**Neon kotası.** Açık panel sekmeleri de veritabanını uyandırır (src/lib/live-poll.ts). Öndeki sekme bildirim açıksa
30 dakikada bir, kapalıysa dakikada bir sorar (ekran 10 dakikadır kullanılmıyorsa ve yakında oturum ya da saatli
hatırlatıcı yoksa 10 dakikada bir). Arka plandaki sekme sormaz; yalnız bildirimin ulaşmadığı zil cihazı (bar ekranı:
ses açılmış, sipariş zili ya da karaoke alarmları açık) 10 dakikada bir sorar, yeni sipariş ve rezervasyon zili en geç
o kadar gecikir. Bu, arka planda geçen her saat için en çok ~0,125 CU-saattir (günde 14 saat arka planda ayda ~52).
"Bildirim açık": izin verilmiş, abonelik kaydedilmiş ve çalan zillerin konuları (Sipariş / Karaoke bildirimleri) bu
cihazın aboneliğinde açık. Yöneticinin cihazında çalan karaoke zili bu hesaba girmez: bildirim yokken arka plandaki
yönetici sekmesi sormaz, yeni rezervasyonu öne gelince duyar. Karaoke bağlantısı hata verirken (bar ekranında sarı
satır) öndeki her sekme, satır kalkana kadar dakikada bir sorar. Barın ekranında **bildirimlere izin verin** ve
Sipariş / Karaoke bildirimlerini açık tutun: bildirim yokken öndeki ekran siparişler için 20 saniyede bir sorar ve
veritabanı gün boyu uyumaz (ayda ~105 CU-saat), arka plandaki sekmede zil 10 dakikaya kadar gecikir. Aylık kullanımı
Vercel › Storage › lafmaliyet-db › Usage'da (ya da Neon'da) izleyin; 100 CU-saate yaklaşıyorsa ücretli plana geçin.

## Kişisel hatırlatıcılar ve cihaz bildirimleri

Ekran: **Hatırlatıcılarım** (`/panel/hatirlaticilarim`), personel ve yönetici. Herkes yalnız kendi hatırlatıcılarını
görür ve değiştirir (yönetici de başkasınınkini görmez); ödemeler ve sabah e-postası bunlardan ayrıdır.

- Hızlı ekleme (başlık, bugün / yarın, isteğe bağlı saat) ya da pencereden: not, tarih, saat, tekrar (her gün / hafta /
  ay; ay sonu kırpılır, ertelense de çapa günü korunur). Gruplar: Gecikti, Bugün, Yarın, Bu hafta, Daha sonra.
- **Tamamlandı** ve **ertele** (bir saat, ertesi gün) bildirimdeki **Geri al** ile geri alınır; tamamlanan tek
  seferlikler iki hafta altta durur, oradan yeniden açılır. En çok 200 açık hatırlatıcı.
- **Saatli** hatırlatma, panel hangi ekranda açık olursa olsun saatinde ses ve kartla çalar; bildirim izni verilmiş
  cihazda sekme arka plandayken sistem bildirimi olarak gelir. Zil, bugünkü ve gecikmiş hatırlatıcıları gösterir.
- **Sabah özeti:** günlük iş (`/api/cron/gunluk`, 08:00–09:00), bugün ya da önceden kalmış açık hatırlatıcısı olan
  her kişinin bildirim açık cihazlarına tek bir Web Push gönderir ("Bugün 3 hatırlatıcınız var"). Hızlı sayım günü
  aynı iş, takipte kalem varsa ve hepsi sayılmadıysa sabah özeti açık bütün cihazlara bir de "Bugün hızlı sayım günü"
  gönderir (Hızlı sayım'ı açar; ayın son günü gitmez; [MAL-SIPARISI.md](MAL-SIPARISI.md) § 3).

Her cihaz kendi tercihini tutar (**Bu cihazda uyarılar** kartı, Hatırlatıcılarım ve Karaoke ekranlarında): bildirim
izni ve aboneliği, karaoke bildirimleri, sipariş bildirimleri ve sipariş zili (laffogato.net'ten yeni uygulama
siparişi; [SITE-SIPARIS.md](SITE-SIPARIS.md)), **onay bildirimleri** (varsayılan açık; yöneticiye personelin onay
bekleyen mal siparişi taslağı, personele isteğinin sonucu; etiket `istek-<id>`, metinde tutar yok;
[ONAYLAR.md](ONAYLAR.md)), sabah özeti, sesli uyarı, saatli hatırlatmalar. Web Push'un ayrıntısı ve
güvenliği [KARAOKE.md](KARAOKE.md)'de.

## Resend kurulumu

laffogato.net sitesiyle **aynı Resend hesabı** ve doğrulanmış `laffogato.net` alan adı kullanılır (laffogato
deposu, `docs/EMAIL-RESEND.md`). Vercel → lafmaliyet → Settings → Environment Variables:

| Değişken | Değer |
|----------|-------|
| `RESEND_API_KEY` | Resend API anahtarı (sitedekiyle aynı olabilir; yalnız sunucuda) |
| `EMAIL_FROM` | (isteğe bağlı) `L'Affogato Panel <bildirim@laffogato.net>` |
| `CRON_SECRET` | `openssl rand -hex 32` (yoksa hiçbir günlük iş çalışmaz; zil ve Genel bakış "Günlük işler kapalı" der) |
| `APP_URL` | (isteğe bağlı) `https://ladmin.laffogato.net` |

Gönderen sırası: ekrandaki ayar → `EMAIL_FROM` → `L'Affogato Panel <bildirim@laffogato.net>`. Alan adı Resend'de
doğrulanmış olduğu için `@laffogato.net` ile biten her adres gönderebilir.

> Resend'in Vercel entegrasyonu takımda kuruluysa `RESEND_API_KEY`'i lafmaliyet projesine de bağlayabilirsiniz;
> ya da team düzeyinde "Shared Environment Variable" olarak iki projeye birden verin.

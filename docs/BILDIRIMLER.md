# Ödemeler, hatırlatıcılar ve e-posta bildirimleri

Ekran: **Finans › Ödemeler & hatırlatıcılar** (`/panel/hatirlaticilar`).

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
- **Faturasız borçlar** (kaynak sekmesi **Faturasız borç**, `?kaynak=cari`): Tedarikçiler › Borç ekle ile girilen,
  faturaya bağlanmamış borçlar ([TEDARIKCILER.md](TEDARIKCILER.md) *Hesap hareketleri*): "Faturasız alım · süt",
  "Fatura bekleniyor · süt", "Eski borç". **Ödendi** önce tedarikçinin hesabındaki parayı sayar, kalanı için kartın
  ödeme şekliyle bugün ödeme açar (bildirimde **Geri al** ve **Düzelt**); **Ertele** borcun vadesini öteler.

**Hesaptaki ödeme (mahsup):** tedarikçinin hesabında hiçbir kaleme sayılmamış ödeme varsa listedeki tutarlar ondan
sonraki kalandır (en eski vadeden; "hesaptaki 99,50 ₺ düşüldü"). Tamamen karşılanan kalemler listenin altındaki kapalı
**Hesaptaki ödemeyle karşılananlar** kutusundadır (tedarikçi başına **Borçlara say**). Zil, sabah e-postası, Bugün,
Genel bakış ve nakit planı aynı hesabı kullanır. Fatura kaleminin **Ödendi**'si de hesaptaki parayı önce sayar.

**İpuçları** (kalemin altında): faturasız alımın faturası olabilecek fatura "Faturasız alımın faturası olabilir (20.10
· süt) · Bağla" der ve sessizdir (sabah e-postası ve nakit planı onu hatırlatmaz, aynı mal iki kez ödenmesin); kalemin
gününden sonra kasadan o tedarikçiye işlenmemiş bir çıkış varsa "Kasadan ödenmiş olabilir: 24.10 Teslim · Sütaş
2.200,00 ₺ · İşle". Bir çıkış en çok bir kalemi sessize alır (e-posta o kalemi hatırlatmaz): kalanı çıkışın tutarını
en çok max(1 ₺, %2) farkla tutan, gününe en yakın kalem. Tutarı hiçbir kalemi tutmayan çıkış (ör. 300 ₺ fişsiz Metro
alışverişi) yalnız ipucudur; e-posta kalemleri yine hatırlatır.

Gecikmiş ve yaklaşan ödemeler kenar çubuğundaki **zilde** de görünür. Zilin **Onaylar** başlığında yöneticiye onay
bekleyen reçete önerileri, onay bekleyen hammadde fiyatları (`docs/PARASUT.md` 5b) ve personelin onay bekleyen
istekleri durur (istek başına bir satır, `/panel/onaylar#istek-<id>`'e götürür; satır istek güncellenince en çok 10
dakikada bir yeniden okunmamış olur; [ONAYLAR.md](ONAYLAR.md)). Personelde aynı başlığın adı **İsteklerim**: reçete
önerilerinin ve isteklerinin sonucu ("22 Ekim kasa düzeltmeniz onaylandı", "Yönetici: <not>"). Kasadan çıkan ve
fotoğraf kaldırma istekleri yöneticide tek satırdır ("3 kasa isteği onay bekliyor"); kapalı gün bildirimi istek başına
"Kapalı gün onayı bekliyor", personelde sonucu "23 Eki Per: kapalı gün onaylandı / reddedildi / geri alındı". Geç zayi /
ikram ve zayi silme istekleri yöneticide tek satırdır ("3 zayi / ikram isteği onay bekliyor"); personelde sonucu "Geç
kayıt onaylandı: 2× Latte M (15 Eki)", "Silme reddedildi: …", kaydı başkasının isteğiyle silinen kişiye "Kaydınız
silindi: Süt 1,5 LT (15 Eki) · Ayşe istedi" ([ZAYI-IKRAM.md](ZAYI-IKRAM.md)). Karaoke sayacı silme istekleri
yöneticide tek satırdır ("1 karaoke sayacı silme isteği onay bekliyor", ilk karta); personelde sonucu "Silme onaylandı:
karaoke sayacı 24 Eki 21:00–23:00", Karaoke ekranına ([KARAOKE.md](KARAOKE.md) › Sayacı silmek). Personel
kapalıydık dediyse yöneticinin "Dünkü kasa raporu girilmedi" satırının gövdesine "· Personel: kapalıydık dedi (onay
bekliyor)" eklenir; dün onaylı kapalıysa satır çıkmaz. LafPOS gün sonu gelip çekmece sayılmadıysa satır "Dünkü kasa
sayılmadı" der ve nedenini yazar; personelin zilinde "Kasa sayılmadı" (LafPOS'ta nereden sayılacağı) ve otomatik raporun
fotoğrafı eklenene kadar "Gün sonu fotoğrafı bekliyor" durur ([LAFPOS.md](LAFPOS.md)). LafPOS'a geçildiyse (geçiş gününden sonraki günler) yöneticinin
kasa başlığında son 7 günün LafPOS'un gün sonundan farklı yazılan raporları da durur: "Kasa raporu LafPOS'tan farklı ·
11 Kasım · Sayılan nakit 9.350 ₺ (LafPOS'ta 9.000 ₺)"; LafPOS günü rapordan sonra farklı rakamla yeniden gönderdiyse
"LafPOS rapordan sonra farklı rakamla geldi" (yeniden gönderim ya da düzeltme satırı yeniden okunmamış yapar;
[LAFPOS.md](LAFPOS.md) › Kasa raporu). ModPOS günlerinde (geçiş günü boşken ya da ondan önce) aynı başlıkta son 7
günün saklanan ModPOS kasa föyünden farklı yazılan raporları durur, "Kasa raporu ModPOS föyünden farklı · 2 Kasım
Pazartesi · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)" (kasası açıkken çekilen föy karşılaştırılmaz; rapor ya da föy
değişince yeniden okunmamış olur), ModPOS anahtarı tanımlı ama çalışmıyorsa da **Sistem** başlığında "ModPOS kasa föyü
çekilemiyor" ve hatanın metni, Ayarlar › ModPOS (kasa föyü)'ne götürür ([MODPOS-API.md](MODPOS-API.md) › Nerede
görünür). Yöneticinin **Uyarılar** başlığında bilgi olarak kapalı işaretin
kanıtla kalkması, kapalı aralığa giren rapor ve personelin özel gün eklemesi ("Ayşe özel gün ekledi") son 3 gün durur
([KASA-RAPORU.md](KASA-RAPORU.md) › Kafe kapalıydı). **Uyarılar** başlığının
başında, kasada (ModPOS) elle değiştirilecek fiyat varken **"Kasada değişecek N fiyat"** durur (**Ürünler › Fiyatlar ›
Kasaya işle**'ye götürür, listeye yeni fiyat girince yeniden okunmamış olur, işaret onu yeniden okunmamış yapmaz;
e-postaya girmez, `docs/FIYATLAR.md`); personelde aynı satır **Kasa** başlığında, "ModPOS'ta değiştirip Kasadaki
fiyatlar'da işaretleyin" diye **Kasadaki fiyatlar**'a götürür (dalga 10 §2.2). LafPOS'a geçiş gününden itibaren
satır yalnız yöneticide ve yalnız siteye bağlı olmayan, fiyatı LafPOS günü panelde değişen ürünleri sayar ("Siteye
bağlı olmayan ürün: LafPOS'ta yerelse orada elle değiştirip …; LafPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde
bağlayın"); siteye bağlı ürünün fiyatını LafPOS siteden alır, zil çıkmaz. Personelde satır yok: LafPOS'ta ürün fiyatını
kasiyer değiştiremez (denetim B11). Personelin akşam kasa zili o günden itibaren (yalnız Marina) "Kapanışta LafPOS'ta
Günü kapat'a basın; rapor LafPOS'tan gelir, sonra Pavo'nun gün sonu fişinin fotoğrafını ekleyin" der. Yöneticinin **Uyarılar** başlığında
personelin Siparişler ekranında tükendi yaptığı ve hâlâ satışta olmayan ürünler: "Tükendi: Tiramisu, Cheesecake" (en çok 3
ad), gövdesi "Personel kapattı: Selin 21:40 · Ali 22:05. Sitede, uygulamada ve QR menüde satışta değil.", Siparişler
ekranının Tükenenler kartına (`/panel/siparisler#tukenenler`) götürür; bir kayıt 24 saatten eskiyse ya da son bir saatte personel 3 ya da daha çok ürün
kapattıysa uyarı, yoksa bilgi. Yeni bir kapatma satırı yeniden okunmamış yapar, ürün satışa açılınca satır kalkar;
push yok, personele zil yok (dalga 10 §2.1, [SITE-MENU.md](SITE-MENU.md) › Personel: Tükendi / Satışa aç). Yine
**Uyarılar**'da, ayın ilk 10 gününde (gün kasanın iş günü: 05:00'te döner) geçen ayın stok sayımı tamamlanmadıysa "Ekim 2026 sayımı yarım: 30 / 72" (ya da
"… sayımı girilmedi"), gövdesi "Kalanların stoğu 0 sayılır…", o ayın sayımına götürür; aynı satır sabah e-postasının
onay kutusunda da (tamam = listedeki her kalem sayıldı, `sayim/logic.ts pastCountReminder`). Zil tek şube
seçiliyken Stok sayımı ekranının şubesine bakar; "Tümü"de ve sabah e-postasında her açık fiziksel şubenin sayımına
ayrı bakılır (denetim 13 Kasım ST-04: önceden zil "Tümü"de yalnız Tuzla'yı okuyordu) ve birden çok şube açıkken satırı şubenin adıyla yazar: "Marina: Ekim 2026 sayımı yarım: 10 / 72" (tek
yarım şubede bağlantı `&sube=` ile o şubenin sayımı; `pastCountReminders`, denetim 21 Kasım #16). Yine **Uyarılar**'da
yöneticiye iki sayım satırı (Bugün'de de; `src/server/data/count-alerts.ts`, metin `sayim/logic.ts`): bu ayın ya da geçen
ayın sayımında birim fiyatı girilmemiş ek kalem varsa "Ekim 2026: 2 ek kalemin fiyatı yok" (adlar; kapanış stoğuna 0 ₺
girer), o ayın ek kalemlerine götürür, fiyat girilince kalkar (kimlik sayı ve en yeni kalemden). Ek kalemler şube
başına olduğundan satır ay ve şube başınadır: birden çok şube açıkken "Kasım 2026 (Marina): 1 ek kalemin fiyatı yok" ve
adres o şubenin sayımını açar (`&sube=`; [SUBE.md](SUBE.md#yazarken-hangi-şube)); personel geçen ayın
sayımını ay bittikten sonra (ilk 10 günde) değiştirdiyse "Ayşe, Ekim 2026 sayımını değiştirdi" (kayıt ve kalem sayısı;
kimlik en son kayıttan, yeni kayıt yeniden okunmamış yapar). İkisi personele hiç gösterilmez. Zilin
satırlarını alanların modülleri üretir ve iki rol dalında da çağrılır: kasa `src/server/bell/kasa.ts`, operasyon
(kasadaki fiyatlar, zayi istekleri, Tükendi, geçen ayın sayımı, fiyatsız ek kalem, personelin geç sayım kaydı)
`src/server/bell/ops.ts`, ModPOS kasa föyünün anahtarı ve e-posta satırları (yalnız yönetici) `src/server/bell/modpos.ts`; toplayıcı
`src/server/actions/notifications.ts`. **Kontrol listeleri** başlığında (kasanın ardından, iki rolde) yöneticiye bugün son saati geçen
liste, dün tamamlanmayan liste ve bugünün ve dünün açık sorunları (aralık dışı ölçüm kırmızı, "Sorun var" turuncu; en
yeni 5), personele aralığı açık ("bekliyor", bilgi) ve son saati geçen ("gecikti") liste durur
([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md) § 6). **Faturalar** başlığında yöneticiye kasadan faturalı alımlar
(faturası Faturalar'da yok, Aylık harcamalar'a yazılmadı; "2 kasadan faturalı alım bekliyor", Faturalar › Kontrol
bekleyen'deki karta götürür; denetim E-42, [KASA-RAPORU.md](KASA-RAPORU.md) "Faturalı alımlar"), Aylık harcamalar'a
yazılmışken faturası sonradan gelen kasa alımları (kırmızı, "Kasa alımı iki kez sayılıyor": gider kaydını silin; aynı
karta götürür) ve komisyon ve hakediş uyarıları da
durur: geciken hakediş, yemek kartında kesin %6 aşımı, komisyon dışı ücret olabilecek kalem (en çok 5; Komisyon &
hakediş'te kanalın kartına götürür, [KOMISYON.md](KOMISYON.md) § 8). Gecikenler en eski son gün önce gelir; beşe
sığmazsa son satır özettir ("6 hakediş daha gecikti: Getir (Ağustos), …") ve ay seçmeden Komisyon & hakediş'e götürür.
Özetin kimliği içindeki en yeni gecikmeden türer: daha yeni bir gecikme onu yeniden okunmamış yapar, eskiler "geldi"
işaretlenip liste kısalınca değişmez. Özet okununca içindeki satırlar da okunmuş sayılır; biri sonra tek satıra çıkınca
yeniden okunmamış olmaz. Mal siparişinin teslim kontrolü satırları ve
taslak onayı 26 Ekim 2026'da mal siparişiyle birlikte kalktı ([MAL-SIPARISI.md](MAL-SIPARISI.md)).
Yöneticinin zilinde (ödemeler başlığında) kasadan tedarikçiye çıkan ama hesaba işlenmemiş satırlar da durur:
"Kasadan tedarikçiye 2 ödeme hesaba işlenmedi (3.800,00 ₺)" (son 60 gün; Tedarikçiler'de işlenmemiş kasa ödemeleri
penceresine götürür, `?kasa=1`). Personelin zili ve Bugün'ü ödeme göstermez, değişmedi.

## Son ödenenler (geri alma)

"Ödendi" bildirimindeki **Geri al** 8 saniye durur. Kaçırılırsa ya da yanlışlık sonradan fark edilirse, listenin
altındaki **Son ödenenler** bölümünden (kapalı açılır kutu; `#son-odenenler`) geri alınır. Liste boşken yerinde "Son
ödenenler: son 30 günde “Ödendi” denen kayıt şu an yok." satırı durur, Yardım'ın bağlantısı ona iner (denetim UI-08):

- Son **30 günde** "Ödendi" işaretlenen fatura ve hatırlatıcılar, en yeni önce, en çok 30 kayıt. Liste, Ödemeler
  ekranından, Faturalar'da tek tek / toplu "Ödendi"den, fatura penceresinde ödenmedi → ödendi kaydedilince ve
  Tedarikçiler'deki ödeme penceresi, ✓ ve toplu işlemle dolar.
- **Fatura** için Geri al, faturayı yeniden "ödenmedi" yapar (ödemesi talep edilmişse "talep edildi"); ödeme
  listesine ve sabah e-postasına döner. ✓ tedarikçinin hesabındaki parayı kullandıysa önce o dağıtımlar silinir.
- **Hesaba ödeme** (Tedarikçiler'de elle girilen ödeme, tür `cari`): "Hesaba ödeme · Sütaş · 10.000,00 ₺ · Havale / EFT
  · 2 kalem". Geri al ödemeyi siler (dağıtımları kalkar, ödemenin kapattığı faturalar yeniden açılır, kasaya açtığı
  satır silinir). Ödeme sonradan düzenlendiyse reddedilir: "Ödeme sonradan düzenlendi; Tedarikçiler'den silin".
  Ödemeye çevir'le açılan ödemede satır alışverişe, gider kaydı yerine döner; kayıt geçmiş bir aya dönüyorsa pencere
  o ayı adıyla sorar ("Eylül 2026'nın kapanmış rakamlarının değişeceğini biliyorum"), onaysız yazılmaz.
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
- **kontrol bekleyen** fatura sayısı, bağlantısıyla; iki neden ayrı söylenir: kategorisi tahminle yazılanlar ve mal
  alışı sayılmayanlar (kalemi hammaddeye bağlı, kategorisi mal alışı değil; `docs/PARASUT.md` 6b);
- **kasadan faturalı alımlar** (kontrol kutusunun altında): faturası Faturalar'da yok, Aylık harcamalar'a yazılmadı;
  sayı ve ilk mağaza, Faturalar'daki karta bağlantıyla; Aylık harcamalar'a yazılmışken faturası gelenler "iki kez
  sayılıyor" diye ayrı cümleyle. E-postayı tek başına göndermez (denetim E-42);
- **onay bekleyen hammadde fiyatları** (Paraşüt bölümünde, kontrol kutusunun altında): faturada şimdikinden %40'tan
  fazla farklı gelen ya da fiyatı olmayan hammaddenin çarpanı kesin olmayan ilk fiyatı ("ilk fiyat"), onay bekleyen
  fiyatlar (`docs/PARASUT.md` 5b), Hammaddeler › Onay bekleyen fiyatlar bağlantısıyla.
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
  (Mehmet)", "Latte M ×2 · 15 Eki (Ayşe)"; en çok 8), Onaylar bağlantısıyla; tutar yok. Karar verilene kadar her sabah
  listelenir. Kutunun sonunda operasyonun bilgi satırı: "Personelin tükendi yaptığı ürünler: Tiramisu (Selin, 2 gündür)"
  (yalnız ad, kişi ve süre); ilk 10 günde geçen ayın stok sayımı yarımsa ya da yoksa onun satırı. Bekleyen istek yokken
  bu satırlar kutuyu tek başına açar: yalnız tükendi satırı "Personelden", yalnız sayım satırı "Stok sayımı" (o ayın
  sayımına götürür), ikisi birden "Operasyon" başlığıyla. ModPOS kasa föyünün satırları da bu kutudadır: anahtar
  çalışmıyorsa "ModPOS kasa föyü çekilemiyor. …", dünün raporu föyden farklıysa "Kasa raporu ModPOS föyünden farklı. 2
  Kasım · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)"; yalnız bunlar varsa başlık "ModPOS kasa föyü" (o güne ya da Ayarlar'a
  götürür). Konuya "2 istek onay bekliyor" eklenir ([ONAYLAR.md](ONAYLAR.md));
- en üstte **Sistem uyarıları**: dünkü sabah işi çalışmadıysa ya da hata verdiyse, bu sabahki Paraşüt işi
  çalışmadıysa (aşağıda "Sistem uyarıları"; yalnız canlıda).

Ödeme, yeni fatura, eşitleme hatası, yeni fiyat onayı, yeni zam, sistem uyarısı, yeni komisyon uyarısı, dünkü kontrol listelerinin kutusu onay bekleyen personel isteği, personelin tükendi yaptığı ürün, ModPOS kasa föyü satırı ya da (ilk 10 günde) geçen ayın yarım sayımı yoksa e-posta gitmez. Konu öncelik
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
(`kaynak:kimlik:vade:aşama`, ör. `reminder:4:2026-10-28:before`, `invoice:23:2026-10-31:due`, faturasız borçta
`cari:7:2026-11-19:before`). Sessiz kalemler (faturası olabilecek fatura, kasadan ödenmiş olabilecek kalem) e-postaya
girmez; metin değişmez, yalnız faturasız borcun ayrıntı etiketi yenidir. Geciken dönemin
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
- bildirim adresi ekleme, kapatma, silme (personel ya da pasif hesabın adresi eklenmez ve yeniden açılmaz; listede
  duran böyle bir adresin satırında kırmızı "Personel hesabının adresi · e-posta gitmez" yazar, adres sayısına
  girmez; aşağıda "Alıcılar ve hesaplar");
- **E-postayı önizle** (gönderilmez): bugün gidecek sabah e-postasının kendisi, sistem, Paraşüt ve zam bölümleriyle;
  ödeme, yeni fatura, zam ya da sistem uyarısı yoksa örnek bir ödeme satırıyla. Önizleme ve **Bugünküleri şimdi
  gönder** sabah işi gibi işletmenin tamamıyla okur, soldaki şube seçimiyle değil (`withBranchScope(ALL_BRANCHES, …)`;
  denetim 21 Kasım #18): önceden Marina seçiliyken zammın "ayda ≈ X ₺"ı Marina'nın satışından hesaplanıp gidiyor ve
  sabah işi o zamları işletme geneli rakamla bir daha bildirmiyordu;
- **Deneme gönder** (kayıtlı gönderenle, etkin adreslere; düşen adres bildirimin alt satırında "Gönderilmedi: …");
- **Bugünküleri şimdi gönder** (sabahı beklemeden; daha önce gidenler tekrar gitmez). Bildirimde ne gittiği
  yazar: "2 hatırlatma · 4 yeni fatura · 1 zam";
- gönderen adresi ve gün ayarları (Gönderim ayarları › Kaydet).

### Alıcılar ve hesaplar

Kasa raporu e-postası (Kasa › Rapor alıcıları), sabah e-postası, bekçi uyarısı ve iki deneme e-postası ödemeler,
fatura tutarları, maliyet, zam ve kâr rakamları, kasa farkı ve karaoke ön ödemesi taşır. Bu yüzden (denetim E-52,
E-53; `src/lib/notify-recipients.ts`, `src/server/notify/recipients.ts`):

- **Gönderim anında süzülür.** Listedeki bir adres paneldeki bir hesaba aitse e-postayı yalnız **etkin bir
  yöneticinin** hesabıysa alır: personel hesabının ve pasif hesabın adresi düşer. Hesabı olmayan adres (muhasebeci,
  sahibin kişisel adresi) alır. Büyük-küçük harf fark etmez. Kayıttan sonra personele indirilen, pasif yapılan ya da
  personel hesabı açılan adres de düşer: kural kaydı beklemez. Sıra korunur. Kural adresin hesabına bakar: adres
  hiçbir hesaba ait değilse (giriş e-postası değişti, hesap silindi) yeniden alır; bu yüzden aşağıdaki iki kapı var.
- **Kaydederken reddedilir.** Kasa alıcılarına ve bildirim adreslerine personel ya da pasif hesabın adresi yazılmaz
  ("ayse@… bir personel hesabının adresi; …", "eski@… pasif bir hesabın adresi; pasif hesaba e-posta gitmez. Hesabı
  Kullanıcılar'dan silerseniz adres alıcı olabilir."). Duraklatılmış bir adres böyle bir hesaba aitse yeniden açılmaz.
- **Personel Hesabım'da** giriş e-postasını bir listedeki adrese (kasa alıcıları, kapalıyken de; bildirim adresleri,
  duraklatılmış da) çeviremez: "Bu adres giriş e-postanız olamaz; başka bir adres yazın ya da yöneticiye sorun."
  Başka bir hesabın adresinde de aynı metin: personel adres deneyerek kimin listede olduğunu öğrenemez. Parola önce
  sorulur. Kendi adresi bir listedeyken giriş e-postasını hiç değiştiremez: "Giriş e-postanız bildirim listesinde;
  değiştirmek için yöneticiye yazın." (personele indirilen vardiya sorumlusu adresini değiştirince eski kutusu hesapsız
  kalır, kasa ve sabah e-postası ona yeniden giderdi, zil susardı). Yönetici kendi adresini çevirebilir (alıcı olmaya
  devam eder).
- **Kullanıcılar'da eski adres.** Yönetici personel ya da pasif hesabın (ya da personele indirdiği hesabın) giriş
  e-postasını değiştirince ya da böyle bir hesabı silince eski adres listede kaldıysa uyarı verir ("Mehmet hesabının
  eski adresi … kasa raporu alıcıları arasında; adres artık hiçbir hesaba ait değil, bu adrese e-posta gider.
  Gerekmiyorsa listeden kaldırın."). Engellemez: pasif hesabı silmek muhasebecinin adresini alıcı yapmanın yolu.
- **Yönetici görür.** Zilde, Sistem başlığında: "Kasa raporu e-postası bir adrese gitmiyor" / "Sabah e-postası 2 adrese
  gitmiyor" (adresler ve nedenleri; Rapor alıcıları kartına ya da bu kutuya götürür). Durumdan türer: adres listeden
  çıkınca ya da hesap yeniden yönetici olunca kalkar. Rapor alıcıları kartında ve bildirim adresinin satırında aynı
  not. Kullanıcılar'da bir hesabı personele indirmek, pasif yapmak ya da listedeki bir adresle personel hesabı açmak
  uyarı verir ("Mehmet (…) kasa raporu alıcıları arasında; personel hesabına bu e-posta gitmez. Gerekmiyorsa listeden
  kaldırın."). İşlem geçmişindeki "Sabah e-postası" ve "Sistem uyarısı e-postası" satırı atlananları sayar ("→ 2 adres
  · 1 adres atlandı (personel ya da pasif hesap)").
- **Hepsi düşerse:** sabah e-postası "gitmedi: gönderilecek adres yok" (iş "Kısmen"; Günlük işler ve sistem uyarısı
  nedeni adresleriyle yazar: "etkin bildirim adreslerinin hepsi personel ya da pasif hesaba ait: ayse@… (personel
  hesabı)"); E-posta bildirimleri başlığı "Adres yok" değil "Gidecek adres yok" der. Kasa e-postası "gitmedi" (kapalı
  değil): yönetici formda nedenini ("Alıcıların hepsi personel ya da pasif hesaba ait: …"), personel sabit metni görür
  ([KASA-RAPORU.md](KASA-RAPORU.md)).

Haftalık özet zaten yalnız etkin yöneticilerin giriş e-postalarına gider.

## Marina gün sonu e-postası (22 Kasım 2026)

LafPOS'un şubesinin (Marina) gün sonu geçiş gününden itibaren geldiğinde kasa raporu alıcılarına (Tuzla'nın kasa
e-postasıyla aynı liste; personel ve pasif hesap düşer) "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · 120 ₺ eksik"
gider: satış, ödemeler, ikram / ödenmez, kasa farkı, Z no, dün ve geçen haftayla kıyas, Pavo karşılaştırması, panele
bağlantı; maliyet ve kâr yok. Pavo'nun sonucu birkaç dakika içinde bekleniyorsa onu bekler (tek e-posta). İçerik başına
bir kez; LafPOS düzeltip yeniden gönderirse "· düzeltildi", sayımsız giden gün sayılınca "· kasa sayıldı" ile bir kez
daha. Pavo ya da fotoğraf sonradan farklı gelirse kısa e-posta aynı konu başıyla gider. Çalışanlara (Kasa › Rapor
alıcıları › Çalışanlar) "gün sonu alındı" günde bir kez; sayım yoksa teşekkür değil "kasa sayılmadı" uyarısı. Gidemezse
sabahki günlük iş yeniden dener (adım "LafPOS gün sonu"). Ayrıntı:
[LAFPOS.md › Gün sonu otomasyonu](LAFPOS.md#gün-sonu-otomasyonu-22-kasım-2026).

## Karaoke e-postaları (22 Kasım 2026)

Üç e-posta, hepsi [KARAOKE.md › Karaoke e-postaları](KARAOKE.md#karaoke-e-postaları-22-kasım-2026)'nda:

- **Misafire "bir gün kaldı"**: Karaoke › Elle ekle'de e-posta yazılan rezervasyondan 24 saat önce, bir kez; kendi
  tasarımıyla, gönderen adı "L'Affogato". Bu ekrandaki e-posta anahtarına bağlı değildir. Adres yalnız e-posta gidene
  kadar şifreli durur; "Son gönderimler"de alıcı "misafir (adres saklanmaz)" diye görünür.
- **Personele "Bugünün karaokeleri"** (rezervasyon günü sabah) ve **"3 saat kala"**: o gün Vardiya planında çalışanlara,
  plan yoksa Tuzla'nın personeline. Ödemesi alınmamış rezervasyon kırmızıyla öne çıkar ("Ücreti misafir odaya girmeden
  ÖNCE, kasada alın."); tutar yazmaz. **E-posta hatırlatmaları** kapalıysa gitmez.

Tetikleyiciler kontrol listesi hatırlatmalarınınki (açık sekmenin canlı yoklaması, saatlik iş) ve sabah işi.

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
  kurulmadı" ya da "gitmedi: gönderilecek adres yok" (gönderilecek bir şey vardı ama etkin adres yok ya da hepsi personel
  veya pasif hesabın; iş "Kısmen" sayılır, zilde turuncu).
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

### Zil okunamayınca

Zil kabuk açılınca (çoğu zaman Neon uyanırken) okunur. **Maliyet modeli** (son satış ayının uyarıları ve hammadde
zammı) zilin en ağır okumasıdır; düşerse zil boş gelmez (denetim E-49): ödemeler, onaylar, kasa, kontrol listeleri,
faturalar ve sistem satırları yine gelir, modelin satırları yerine Uyarılar'da tek bir **"Maliyet uyarıları
yüklenemedi"** satırı durur (okunmamış sayılmaz, rozeti şişirmez; kimliği günden). **Zamanı gelen ödemeler** de kendi
paralel sorgularıyla okunur; düşerse Ödemeler grubu sessizce boşalmaz, yerinde tek bir **"Ödemeler yüklenemedi"**
satırı durur (okunmamış sayılmaz; gecikmiş ödeme rozeti bu okumada sayılamaz). Zilin bütün okuması düşerse (ağ,
sunucu) menü "Dikkat isteyen bir şey yok" demez: üstte "Bildirimler okunamadı" ve **Yeniden dene** durur; önceki
okumada liste varsa altında kalır ve üstteki satır "Bildirimler yenilenemedi; son okunan liste gösteriliyor" der.
Panel yeniden yayınlandıysa "Panel güncellendi" ve **Yenile** (`src/components/panel/notifications.tsx`).

## Kişisel hatırlatıcılar ve cihaz bildirimleri

Ekran: **Hatırlatıcılarım** (`/panel/hatirlaticilarim`), personel ve yönetici. Herkes yalnız kendi hatırlatıcılarını
görür ve değiştirir (yönetici de başkasınınkini görmez); ödemeler ve sabah e-postası bunlardan ayrıdır.

- Hızlı ekleme (başlık, bugün / yarın, isteğe bağlı saat) ya da pencereden: not, tarih, saat, tekrar (her gün / hafta /
  ay; ay sonu kırpılır, ertelense de çapa günü ve saati korunur: erteleme yalnız o dönemindir). Gruplar: Gecikti, Bugün, Yarın, Bu hafta, Daha sonra.
- **Tamamlandı** ve **ertele** (bir saat, ertesi gün) bildirimdeki **Geri al** ile geri alınır; tamamlanan tek
  seferlikler iki hafta altta durur, oradan yeniden açılır. En çok 200 açık hatırlatıcı.
- **Saatli** hatırlatma, panel hangi ekranda açık olursa olsun saatinde ses ve kartla çalar; bildirim izni verilmiş
  cihazda sekme arka plandayken sistem bildirimi olarak gelir. Zil, bugünkü ve gecikmiş hatırlatıcıları gösterir.
- **Sabah özeti:** günlük iş (`/api/cron/gunluk`, 08:00–09:00), bugün ya da önceden kalmış açık hatırlatıcısı olan
  her kişinin bildirim açık cihazlarına tek bir Web Push gönderir ("Bugün 3 hatırlatıcınız var"). Ayın son günü aynı
  iş, sayım listesi doluysa ve ayın sayımı tamamlanmadıysa sabah özeti açık bütün cihazlara bir de "Bugün ay sonu stok
  sayımı" gönderir (o ayın Stok sayımı'nı açar; `src/server/notify/count-push.ts`, Günlük işler'de adımı "Sayım
  bildirimi"). Sayım şube başınadır: her açık şubenin sayımına ayrı bakılır. Birden çok şube açıkken sayımı bitmeyen
  her şubeye ayrı bildirim ("Bugün ay sonu stok sayımı · Marina", adres `&sube=`); o şubenin personeline, yöneticilere
  ve şubesiz personele gider, başka şubenin personeline gitmez (`monthEndCountPushes`, `countPushReaches`). Önceden
  yalnız Tuzla'nın sayımına bakılıyor, Marina'nın personeline Tuzla'nın sayısı gidiyordu (denetim 21 Kasım #16).
  Haftalık "Bugün hızlı sayım günü" bildirimi 26 Ekim 2026'da hızlı sayımla birlikte kalktı.

Her cihaz kendi tercihini tutar (**Bu cihazda uyarılar** kartı, Hatırlatıcılarım ve Karaoke ekranlarında): bildirim
izni ve aboneliği, karaoke bildirimleri, sipariş bildirimleri ve sipariş zili (laffogato.net'ten yeni uygulama
siparişi; [SITE-SIPARIS.md](SITE-SIPARIS.md)), sabah özeti, sesli uyarı, saatli hatırlatmalar. Web Push'un ayrıntısı ve
güvenliği [KARAOKE.md](KARAOKE.md)'de. **Onay bildirimleri** (`approvals`, varsayılan açık): konu ve cihaz tercihi
duruyor ama şu an gönderen yok (tek gönderen mal siparişi taslağıydı, 26 Ekim 2026'da kalktı; [MAL-SIPARISI.md](MAL-SIPARISI.md)),
bu yüzden anahtar cihaz kartında görünmez; yeniden bir gönderen olunca döner ([ONAYLAR.md](ONAYLAR.md)).

## Uyarı sesleri yalnız bu bilgisayardan (22 Kasım 2026)

Sahibin isteği: Tuzla Köyiçi'nde panel ötünce kafenin genel hoparlörü (müzik sistemi) ötmesin, yalnız bilgisayar
ötsün; hatırlatmalarda da.

**Kök neden.** Sesler seçilen hoparlöre çalıyordu (`AudioContext.setSinkId`), ama üç yoldan genel hoparlöre kaçıyordu:

1. Hoparlör hiç seçilmemişse ses Windows'un varsayılan çıkışından geliyordu; Tuzla'da o çıkış genel hoparlör.
2. Seçilen hoparlör bulunamayınca (çıkarıldı, mikrofon izni düştü) ses bilerek varsayılan çıkışa dönüyordu.
3. Sekmenin sesi açılmamışken (sayfa yenilendi, kimse dokunmadı) ya da panel kapalıyken gelen sistem bildirimi
   Windows'un bildirim sesini çalıyordu; o ses her zaman varsayılan çıkıştan çıkar, tarayıcıdan yönlendirilemez.

**Şimdi.** Bu cihazda uyarılar › **Uyarı sesleri** kartında:

- **Yalnız bu bilgisayardan çalsın** (yalnız bilgisayarda Chrome / Edge'de görünür; telefon ve tablette yok). Tuzla
  Köyiçi'nde (açıkça Tuzla seçiliyken) varsayılan açık; "Tümü"de ve Marina'da bilgisayarın kendi seçimi, seçilmediyse
  kapalı (docs/SUBE.md › Uyarı sesleri şubeye göre). Açıkken sesler yalnız
  seçilen hoparlörden çıkar. Hoparlör seçilmemişse, çıkarıldıysa ya da izni düştüyse ses **susar**, genel hoparlöre
  geçmez; kartta ve sayfanın başında "Uyarı sesleri susturuldu" uyarısı çıkar. Ekrandaki pencereler ve kartlar
  aynen çıkar. Sistem bildirimleri her zaman sessiz gelir (panel kapalıyken bile: işaret tarayıcının Cache
  deposunda, servis çalışanı okur).
- **Hoparlör seçimi**: "Bu bilgisayarın hoparlörü · Hoparlör (Realtek(R) Audio)" gibi işaretli olanı seçin. Adlar için
  Chrome bir kez mikrofon izni ister (mikrofon kullanılmaz, hemen kapatılır). Adlar görünüyorsa ve hiçbir hoparlör
  seçilmemişse bilgisayarın kendi hoparlörü (Realtek, dahili, built-in…) kendiliğinden seçilir.
- Bilgisayarın varsayılan çıkışı kendi hoparlörü değilse kart adını yazar ("Bu kafenin genel hoparlörüyse…").
- **Deneme sesi** seçilen hoparlörden çalar; ses susturulmuşsa nedenini söyler.
- Safari, iPhone ve iPad hoparlör seçtirmez: orada ses cihazın kendi çıkışından gelir ve anahtar görünmez.

Seçim bu bilgisayarda saklanır (`localStorage`, `laf:cihaz-uyarilari:<rol>`); hoparlör kimlikleri bilgisayara
özeldir. Paneldeki bütün sesler tek yerden çalar (`src/components/panel/live/sounds.ts`); başka bir dosyada ses
çalınmadığını `tests/ses-cikisi.test.ts` denetler. Susma kuralı saf işlev: `src/lib/audio-output.ts` › `alertAudible`.

**Tuzla'daki bilgisayarda bir kez:** Siparişler ekranında Bu cihazda uyarılar › Uyarı sesleri › "Hoparlörleri göster"
(gerekirse) › "Bu bilgisayarın hoparlörü"nü seçin › **Deneme sesi**. Bu bilgisayarda soldan "Tümü" seçiliyse **Yalnız
bu bilgisayardan çalsın**'ı da bir kez açın (varsayılan yalnız Tuzla seçiliyken açık).

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

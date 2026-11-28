# İstek ve geliştirilmiş prompt: 28 Kasım 2026

Kasa bilgisayarında kusursuz kurulum ve güncelleme, AsilPOS masaüstü deneyimi, ladmin'de "Şube ekleme", gerçek açılışta
ladmin girişi ve şube seçimi, iki depodaki kalanlar.

> Sahibin isteği (28 Kasım 2026, 02:20), olduğu gibi:
> "şimdi lafmaliyet ve `lafpos` repolarında kalanları tek tek kontrol et ve yap onları ek olarak önce aşağıdakileri sağla.
> Windowsa kurarken veya güncelle diyince de (tek bir defa yap bunu veya güncelleme olursa güncellemeyi de al) kusursuz
> işlesin her şey ve her modpos kısımlarını kaldırabilirsin yani direkt başlasın mı vs. gibisinden. genel bizim asilpos
> için bir şeyler yap ana masaüstü ekranına ve güzelleştir sistemi pc'yi direkt asil pos versiyonuna geçir estetikleştir
> hızlandır ve yapabildiğin en iyi şekilde windowsu asilpos uygulamasını geliştir exe olarak en üst seviyeye taşı.
> Kalanların da hepsini yap ve aşağıdakiler de çok önemli: ladmin'de ana admin info@nextgenlab.com.tr adresi ve buna
> section aç şube ekleme kısmı ya da tek bir yere taşı ayrı sekme şube ekleme diye orda kolaylıkla şube ekleme olsun mail
> vs. patron müdür pin barista pin gibi sistemi tanı ve ona göre ayarla ve sonrasında bilgisayarlara kur diyince de
> şubenin ilgili maili vs. çıksın (aktifte olan marin aşube için zaten bir şey yapma ama sonaradan mesela
> info@nextgenlab.com.tr için tuzla şube açarsam ve tuzal şube pc'sine kurduğumda deneme modundan çıkınca mail şifre sor
> gireyim ve sonra şube seçimi yaptır birden fazla şube varsa ama kurulu şubelere geçiş yapılmasın zaten adminden
> değiştirme talebi olursa ladmin aracılığı ile değiştirme olsun.) bu gibi yapı taşlarını sistemi düzene sok ve lütfen
> ilerle. Limit %97 olursa sonraki sıfırlamaya tetikleyici kur ve devam et. Ayrıca limit biterken yaptıklarını kaybetme
> diye ara sıra pr aç veya önerirsen maine gönder ve güncellemeleri de gönder ilgli tüm şubelere bu chatlik."

Aşağıdaki metin bu isteğin, bir mühendise ya da ajana tek başına verilebilecek, belirsizliği giderilmiş hâlidir.

---

## Bağlam

- `lafpos`: kasa, "AsilPOS". Hono, SQLite, React; Windows masaüstü programı. Canlıda Marina şubesinde çalışıyor.
- lafmaliyet: panel, "ladmin" (ladmin.laffogato.net). Next.js 16, Drizzle, Postgres (Neon), Vercel.
- Tuzla şubesi bugün ModPOS'ta; ileride AsilPOS'a geçecek ilk yeni şube.
- Sahibin kuralları `KALANLAR.md` §2'de; bu istek onları değiştirmez. Uyumluluk her şeyden önce: canlıdaki kasa,
  AsilPOS Uzaktan ve site kopmaz; eski adlar, yollar ve değişkenler tanınmaya devam eder.

## Öncelik sırası

Önce A, B ve C (sahibin "önce bunları sağla" dedikleri), sonra D (kalanlar). Her iş ayrı dal ve ayrı PR.

## A. Windows: kurulum, güncelleme ve "AsilPOS bilgisayarı"

1. **Tek seferde, soru sormadan biten kurulum ve güncelleme.** AsilPOS-Kurulum.exe, siteden kurulum dosyası ve
   programın içindeki "Şimdi güncelle" hiçbir soru sormaz, yarıda kalmaz. Kurulum, kanalda daha yeni bir sürüm varsa
   onu da aynı seferde alır; kurulumdan sonra ayrıca "güncelle" demek gerekmez.
   - Bilinen kusur düzelir: kasa çalışırken siteden kurulum "dosya başka bir işlem tarafından kullanılıyor" diye yarıda
     kalıyor (`scripts/kasa/windows/kurulum/web-kurucu.ps1`). Görev bulunamasa da çalışan sunucu durdurulur ve sonra
     yeniden açılır; yarıda kalan kurulum her şeyi eski hâline döndürür; ileti ne olduğunu ve ne yapılacağını söyler.
   - Dayanıklılık: kilitli dosya, yarım ya da bozuk indirme, dolu disk, yetkisiz kullanıcı, antivirüs gecikmesi, eski
     adlı kurulumun üstüne kurma, kurulum sırasında elektrik kesilmesi, aynı anda iki kurulum. Her biri ya kendiliğinden
     toparlanır ya da tek cümleyle ne yapılacağını söyler; hiçbirinde kasa açılamaz hâlde kalmaz.
   - Her senaryo Windows CI'da gerçek kurulumla denenir (`ci-kurulum.mjs`).
2. **Eski kasa programıyla ilgili sorular kalkar.** Kurulumda ve açılışta "ModPOS açılışta başlıyor", "doğrudan
   başlasın mı" türü uyarı ve sorular gösterilmez: AsilPOS kurulunca bilgisayarın kasa programı odur ve açılışta
   kendiliğinden başlar. ModPOS'un veri çekimi, geçmiş günleri ve raporları olduğu gibi kalır (silinmez, kapatılmaz).
3. **AsilPOS bilgisayarı.** Kurulan bilgisayar bir kasa bilgisayarı gibi görünür ve davranır:
   - Açılınca doğrudan AsilPOS açılır; sunucu hazırlanırken markalı bir açılış ekranı görünür; açılış süresi ölçülür
     ve kısaltılır.
   - Masaüstü: AsilPOS duvar kâğıdı, masaüstünde ve görev çubuğunda AsilPOS simgesi, Başlat menüsünde klasörü.
     Kullanıcının dosyalarına ve öteki programlarına dokunulmaz.
   - Kasa ayarları: uyku ve ekran kapanması kapalı, güç planı, USB askıya alma, güncelleme için etkin saatler,
     bildirimler. Hepsi geri alınabilir; program kaldırılınca eski ayarlar döner. Yönetim › Ayarlar ve yedek'te tek bir
     "Kasa bilgisayarı modu" anahtarıyla açılıp kapanır.
   - Program kalitesi: simge ve sürüm bilgisi, Denetim Masası kaydı, kaldırıcı, tek kopya, çökünce toparlanma, günlük.
   - Hız: sunucunun soğuk açılışı, pencerenin ilk boyaması, bellek.
   - Sınır: kod imzası sertifikası yok (sahibin kararını bekliyor); "Yine de çalıştır" uyarısı sertifika alınana dek kalır.

## B. ladmin: asıl yönetici ve "Şube ekleme"

4. **Asıl yönetici `info@nextgenlab.com.tr`** (`LADMIN_ANA_ADMIN`). Şubeyi açmak, kapatmak, silmek ve kasasını kurmak
   yalnız onundur; hesabı öteki yöneticilere karşı korunur. Hazır tasarım: `kasa-acilis-ve-asil-yonetici.md` (P-B1).
5. **Ayarlar'da ayrı sekme: "Şube ekleme"** (yalnız asıl yönetici görür). Şubeyle ilgili kurulum işleri tek yerdedir:
   - Yeni şube: ad, şubenin e-postası (gün sonu ve rapor alıcısı), kasa programı ve ilk personel: patron, müdür ve
     barista için ad ve PIN. PIN panelde düz yazıyla saklanmaz; kasa ilk bağlandığında teslim edilir ve panelden silinir.
   - Şube listesi: her şubenin kasası kurulu mu, son günü, sürümü.
   - "Bilgisayara kur": şubenin adı, girişte kullanılacak hesap e-postası, indirme adresi ve adımlar görünür; aynı
     bilgi e-postayla da gönderilir.
   - "Kasayı serbest bırak": bilgisayar değişecekse şubenin kasa bağını asıl yönetici buradan çözer.
6. **Marina'ya dokunulmaz.** Canlıdaki şubenin anahtarı, bağlantısı ve kasası olduğu gibi kalır; yeni kurallar onu
   yeniden girişe ya da kuruluma zorlamaz. Marina listede "kasası kurulu" görünür.

## C. Kasa: gerçek açılışta ladmin girişi ve şube seçimi

7. Yeni kurulan kasa deneme modunda açılır. "Denemeyi bitir, gerçek kullanıma başla" denince:
   - Önce ladmin e-postası ve parolası (hesapta açıksa iki adımlı kod) sorulur. Yalnız asıl yönetici açar.
   - Hesabın açılabilir şubeleri listelenir. Tek şube varsa seçim sorulmaz, o şube onaylatılır.
   - **Kasası kurulu şube seçilemez.** Listede "Kurulu: değiştirmek için ladmin" notuyla görünür. Kasadan devralma
     yoktur; bilgisayar değişikliği yalnız ladmin › Şube ekleme › "Kasayı serbest bırak" ile olur.
   - Bağlanınca şubenin bağlantı bilgileri ve ilk personeli kasaya iner; sonra bugünkü PIN ve açılış adımı gelir.
   - İnternet yoksa açılış engellenmez; doğrulama bekler ve ekranda hatırlatılır (bugünkü internetsiz açılış kaybolmaz).
   - Zaten gerçek kullanımda olan kasada (Marina) bu adımların hiçbiri çıkmaz.
8. Parola ve belirteç yalnız bellekte durur; günlüğe, denetim kaydına ve veritabanına yazılmaz.

## D. Kalanlar

`KALANLAR.md` §4 ve kasanın `docs/KALANLAR.md` §4 sırasıyla, her madde güncel main'de yeniden doğrulanarak:
panel #174 ve #175; kasada "Kurulumu yap" fiş yazıcısı adımı; panelde Özel günler bölümünün kaldırılması; basitleştirme;
kasada Giderler "Günü kapat" içinde ve hata kaydı; P5 ay ayarları; ModPOS API anahtarı ekranlarının kaldırılması; ürün
görselleri; P8, P7, P6, P4, P9; son rapor. Tarihi gelmeyen (A3 daraltma göçü, en erken 4 Aralık) ve sahibin kararını
bekleyen işler yapılmaz, raporda hatırlatılır.

## E. Çalışma şekli ve yayın

- Kurallar `KALANLAR.md` §2: ayrı dal ve PR; panelde merge commit, kasada squash; yalnız CI yeşilken; panelde kod içeren
  PR 22:00 ile 03:00 arasında birleşmez; commit kimliği ve "iz yok" kuralı; her PR'da belgeler güncellenir.
- Para, yetki ve kurulum PR'ları, kodu yazmayan bağımsız bir incelemeden geçmeden birleşmez.
- İş kaybolmasın: her iş kendi dalına sık sık gönderilir; biten iş PR olur, CI yeşilse main'e girer.
- Kasa main'e girince güncelleme kanalı yayımlar. Kasa güncellemeyi açık gün yokken ya da "Şimdi güncelle" ile kurar.
  Merkez'de "Ben gönderince" kipindeki dükkânlara güncelleme Merkez'den gönderilir. Bu oturum için sahibin izni var.
- Canlı kasaya giden her sürümden sonra kanalın sunduğu derleme doğrulanır; geri dönüş yolu hazır tutulur.

## F. Kullanım limiti

Limit %97'ye yaklaşınca yarım iş "ARA KAYIT (yarım)" diye commit'lenip gönderilir, `KALANLAR.md` güncellenir, bir
sonraki sıfırlama saatine tetikleyici kurulur ve iş oradan sürer.

## Kabul ölçütleri

- Gün açık bir kasada siteden kurulum ve "Şimdi güncelle" Windows CI'da yeşil; kurulum hiçbir soru sormuyor.
- Kurulan bilgisayar açılınca AsilPOS'la açılıyor; "Kasa bilgisayarı modu" açılıp kapanabiliyor, kaldırınca iz kalmıyor.
- ladmin'de asıl yönetici "Şube ekleme"den Tuzla'yı açabiliyor; başka yönetici bu sekmeyi göremiyor.
- Yeni kasada "Denemeyi bitir" ladmin girişi ve şube seçimi istiyor; kurulu şube seçilemiyor; Marina'da hiçbir şey değişmiyor.
- İki depoda CI yeşil; belgeler ve `KALANLAR.md` güncel.

## Varsayımlar (sahip düzeltebilir)

1. "ModPOS kısımları" ile kastedilen kurulum ve açılıştaki soru ve uyarılardır; ModPOS'tan veri çekimi ve geçmiş kalır.
2. "Tek bir defa yap, güncelleme varsa onu da al": kurulum tek seferde biter ve en yeni sürümü kendisi alır.
3. Kasadaki giriş, ladmin hesabıdır (asıl yönetici); şubeler bu hesaba bağlıdır.
4. Kurulu şubenin bilgisayarı kasadan değiştirilemez; önce ladmin'den serbest bırakılır.
5. "Patron, müdür PIN, barista PIN": kasanın ilk personel hesaplarıdır; şube eklenirken girilir, kasaya kurulumda iner.

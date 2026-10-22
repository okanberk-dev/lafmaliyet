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
bekleyen reçete önerileri ve onay bekleyen hammadde fiyatları (`docs/PARASUT.md` 5b) durur.

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
- **hammadde zamları**: son zam bölümlü e-postadan bu yana fiyatı %5'ten fazla artan hammaddeler (eski → yeni
  ₺/kg, ₺/L, ₺/adet) ve fiyatı hedef maliyet oranının altında kalan ürünler, önerilen fiyatlarıyla (en çok 6);
  bağlantı Ürünler › Hammadde zamları'na gider (`docs/PARASUT.md` 5a). Her zammın yanında ayda kaç lira kâr
  götürdüğü (" · ayda ≈ 690 ₺"), bölümün başında bu yeni zamların toplamı ("Bu zamlar ayda ≈ 1.240 ₺ kâr götürüyor
  (Eylül 2026 satışlarıyla).") yazar. Dayanak son satış ayının ürün adetleridir; adetler Ayarlar'daki ayda açık gün
  sayısına çevrilir (o ayın açık günü girilmemişse olduğu gibi), maliyet artışına zayi dahildir
  (`src/lib/calc/price-loss.ts`). Satış ayı yoksa ya da tutar 1 ₺'den azsa yazılmaz. Genel bakış'taki ve zildeki
  "Hammadde zammı" uyarısının sonuna da aynı toplam eklenir ("Bu zamlar ayda ≈ 1.240 ₺ kâr götürüyor."; orada son 30
  günün bütün zamları);
- en üstte **Sistem uyarıları**: dünkü sabah işi çalışmadıysa ya da hata verdiyse, bu sabahki Paraşüt işi
  çalışmadıysa (aşağıda "Sistem uyarıları"; yalnız canlıda).

Ödeme, yeni fatura, eşitleme hatası, yeni fiyat onayı, yeni zam ya da sistem uyarısı yoksa e-posta gitmez. Konu öncelik
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

**İki iş birden durursa** (Vercel Cron hiç tetiklemiyor) e-posta da gidemez; panel zil ve Genel bakış'ta yine söyler
ama panel açılmazsa kimse görmez. Bunun için isteğe bağlı dış izleme: ücretsiz bir uptime servisine (ör. UptimeRobot,
"HTTP(s)" monitörü, 1 saatte bir, e-posta uyarısı) `https://ladmin.laffogato.net/api/health?isler=1` adresini
ekleyin. Adres giriş istemez, yalnız durum adlarını döner (`{ ok, db, ms, isler: { cronSecret, gunluk, parasut } }`);
ciddi bir sorun varsa (iş çalışmadı, hata verdi, CRON_SECRET yok) **503** döner ve servis e-posta atar (yedek
hatırlatması sayılmaz).
`?isler=1` olmadan `/api/health` yalnız veritabanına bakar (eskisi gibi).

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
  her kişinin bildirim açık cihazlarına tek bir Web Push gönderir ("Bugün 3 hatırlatıcınız var").

Her cihaz kendi tercihini tutar (**Bu cihazda uyarılar** kartı, Hatırlatıcılarım ve Karaoke ekranlarında): bildirim
izni ve aboneliği, karaoke bildirimleri, sipariş bildirimleri ve sipariş zili (laffogato.net'ten yeni uygulama
siparişi; [SITE-SIPARIS.md](SITE-SIPARIS.md)), sabah özeti, sesli uyarı, saatli hatırlatmalar. Web Push'un ayrıntısı ve
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

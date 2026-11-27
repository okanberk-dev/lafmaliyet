# ModPOS kasa föyü (API)

Panel, kafenin bugünkü kasası ModPOS'un (Gafdigi) **kasa föyünü** API'den kendisi çeker: her kasa gününün cirosu,
ödeme yöntemleri (banka kırılımıyla), açılış ve sayım, giderler, cari tahsilatlar, ara kasalar, kasa farkı ve ModPOS'un
uyarıları. Yönetici her günün kasa raporunu föyle yan yana görür; personelin yazdığı ModPOS Z rakamı föyden farklıysa
zil ve Bugün söyler. API'nin belgesi: [modpos-kasa-foyu-api.md](modpos-kasa-foyu-api.md). Eski plan (ürün satırlı API
varsayımı): [planlar/modpos-api.md](planlar/modpos-api.md).

> **Durum (3 Kasım 2026).** Kod canlıda, `MODPOS_API_KEY` Vercel'e (Production) eklendi: ilk otomatik föy 4 Kasım
> 08:00'de gelir (dün + geçmişin ilk günü). Bu oturumun ağı `api.gafdigi.com`'a izin vermediği için kafenin gerçek bir föyü henüz okunmadı;
> ayrıştırıcı kitapçığın örnek yanıtıyla ve uç durumlarla sınandı (`tests/modpos-foy.test.ts`).

## 1. Kurulum

1. Gafdigi'nin verdiği anahtarı Vercel › lafmaliyet › Settings › Environment Variables'a **yalnız Production** olarak
   `MODPOS_API_KEY` adıyla (Tuzla; öteki şube `MODPOS_API_KEY_MARINA`, §1a) ekleyin ve yeniden yayınlayın (önizlemeler canlının veritabanını paylaşır, çekmez).
   Anahtar depoya, belgeye ya da sohbete yazılmaz.
2. Anahtara **IP kısıtı koydurmayın**: Vercel işlevlerinin sabit çıkış IP'si yok (`403 IP_IZINSIZ`).
3. Ayarlar › **ModPOS (kasa föyü)** kartı "Henüz çekilmedi" der. İsterseniz **Bu günü çek** ile dünü hemen alın
   (günün 2 hakkından birini kullanır); yoksa ertesi sabah kendiliğinden gelir.
4. İsteğe bağlı ortam değişkenleri: `MODPOS_SYNC_FROM` (geçmişin ilk günü, `YYYY-MM-DD`: geçmiş bu güne kadar geriye
   çekilir, öncesi hiç çekilmez; yoksa `2026-07-01`. Canlıda **2026-11-01**: sahibin kararı, 4 Kasım 2026, "Kasım'a
   temiz başlayalım"), `MODPOS_API_URL` (ucun adresi; yoksa belgedeki adres), `MODPOS_SUBELER` (ModPOS şube adı →
   panel şubesi eşlemesi, §1a).

## 1a. Şubeler (16 Kasım 2026)

Sahibin kararı (4 Kasım 2026: "Şube başına ayrı anahtar; günlük 2 çekim hakkı şube başına"; 16 Kasım 2026: "şube şube
ayır, karıştırma"). Kurallar `src/lib/modpos/sube.ts`'te (saf; `tests/modpos-sube.test.ts`,
`tests/modpos-sube-db.test.ts`).

**Anahtar şubenindir.** ModPOS'tan çekilen şube: açık, fiziksel ve kasa kaynağı ModPOS olan şube (Ayarlar › Şubeler).
Her birinin anahtarı ayrı ortam değişkenidir:

| Şube | Değişken |
|---|---|
| Tuzla | `MODPOS_API_KEY` (eski ad, değişmedi) |
| Marina | `MODPOS_API_KEY_MARINA` |
| Yeni şube (`laffogato-kadikoy`) | `MODPOS_API_KEY_LAFFOGATO_KADIKOY` (kimlik büyük harfle, tire alt çizgi) |

- Şubenin anahtarı yoksa o şube için **hiç istek gitmez**; Tuzla'nın anahtarına düşülmez (düşülseydi Tuzla'nın föyü
  Marina'nın günü diye yazılırdı). Ayarlar kartında şube "Kurulmadı" der.
- Başka bir şubenin anahtarıyla **aynı anahtar** kullanılmaz ("Ortak anahtar", kırmızı; zil "ModPOS API'den veri
  çekilemiyor (Marina)"): aynı föy iki şubeye yazılır, hak iki kez harcanırdı. Önce Tuzla, sonra şube sırası kazanır.
- Kota, son çekimler, alınamayan günler ve çalışma kirası şube başınadır: `integration_state › modpos` (Tuzla),
  `modpos:marina`; kira `modpos.kira`, `modpos.kira:marina`. Planlayıcının "hangi gün çekildi" listesi yalnız o şubenin
  föyleridir (başka şubenin günü bu şubenin çekilmiş günü sayılmaz).
- Sabah işi ModPOS'lu şubeleri sırayla, aynı süre sınırı içinde çeker (`syncModposAll`); bir şubenin hatası ötekini
  durdurmaz, adım "kısmen" olur ve hata şubenin adıyla yazılır ("Marina: …"). **Bu günü çek** kartın şubesinin
  anahtarı ve hakkıyla çeker.

**Föyün içi de ayrılır.** Gafdigi'nin anahtarı markaya bağlıysa tek föy birden çok şubenin kasasını taşır (her `<kasa>`
ve `<foysuzGun>` kendi `<sube>`'siyle). Çekim her kasayı panelin şubesine bağlar ve **her şubenin kasası yalnız kendi
şubesinin gününe** yazılır:

1. `MODPOS_SUBELER` eşlemesi (`ModPOS'taki şube adı=şube kimliği`, `;` ya da satır sonuyla; ör.
   `Sahil Şube=marina; Merkez=tuzla`), yoksa
2. ModPOS'taki adın içinde panelin şube adı ya da kimliği geçiyor mu ("LAF FOGATO MARİNA" → Marina; büyük / küçük harf,
   Türkçe harf ve noktalama farkı yok; iki şube birden geçiyorsa belirsiz).

- Föyde **tek şube adı** varsa föy olduğu gibi çekenin şubesine yazılır (bugünkü durum; parmak izi değişmez, eski günler
  "değişti" sayılmaz).
- Föyde birden çok şube adı varken **bağlanamayan ad hiçbir şubeye yazılmaz** (yanlış şubeye yazmaktansa beklemek):
  çalışmanın metni ve Ayarlar kartı `"Sahil Şube" şubesi panelde bir şubeyle eşleşmedi…` der; `MODPOS_SUBELER`'e
  yazılınca o günü yeniden çekmek yeter.
- **Kendi anahtarı olan şubenin kasası** başka anahtarın föyünden alınmaz: o şubenin kendi föyü esastır (iki anahtar
  aynı günü birbirine ezmesin).
- Çekenin şubesi hep yazılır (kasası yoksa boş föy: gün "çekildi" sayılır). Ayrılan föyde `ozet` boştur (ModPOS'un
  özeti bütün kasaların toplamıdır; panel tutarları kasalardan okur); tanınmayan alanlar kasasıyla gider; ham XML
  yalnız çekenin gününde saklanır.

**Okurken karışmaz.** Föy satırı şubesini taşır, anahtarı (gün, şube):

- Tek günün föyü hep tek şubenindir: Kasa'nın gün görünümü ekrandaki raporun şubesini, rapor yoksa seçili şubeyi
  ("Tümü"de Tuzla) okur. Günden güne liste föyleri (şube, gün) ile tutar.
- Rapor ↔ föy karşılaştırması (zil, sabah e-postası, Bugün, Kasa) **(şube, gün)** iledir: "Tümü" seçiliyken Marina'nın
  raporu Tuzla'nın föyüyle karşılaştırılmaz. Tuzla'dan başka şubenin zil satırı kimliğinde ve adresinde şubeyi taşır
  (`/panel/kasa?gun=…&sube=marina`).
- Ay rakamına yedekte (§6) "rapor > AsilPOS > ModPOS" önceliği ve kesintisiz kısım şube içindedir: Tuzla'nın raporu
  Marina'nın aynı günkü föyünü düşürmez.

## 2. Kota ve çekme sırası

API her anahtara **günde 2 başarılı istek** verir (Türkiye saatiyle gece yarısı yenilenir; 400 / 401 / 403 hakkı
düşürmez, 500'de hak geri verilir). Bir istek tek bir kasa günüdür. Bu yüzden:

- **Sabah işi** (08:00–09:00, `/api/cron/gunluk`, yeni cron yok) sırayla (src/lib/modpos/plan.ts; sahibin kuralı,
  4 Kasım 2026: her sabah önce dün, öteki hak çekilmemiş günlere, en yeni günden eskiye doğru):
  1. **dünün föyü** (kasa günü 07:00'den sonra kesinleşir; sabah işi bu saatten sonradır);
  2. **henüz çekilmemiş en yeni gün** (ya da kesinleşmeden alınıp yeniden alınamamış), dünden önceki günden
     `MODPOS_SYNC_FROM`'a doğru, **yeniden eskiye**. Sabah işinin çalışmadığı bir sabahın günü ya da dün olarak
     alınamamış gün böylece eski günlerin önündedir (beklemesi dolunca). Kesinleşme anından sonra alınıp yine kesin
     olmayan gün (kasa ModPOS'ta açık kalmış) burada her sabah yeniden çekilmez. Ayarlar kartının "sıradaki"si bir
     sonraki sabah işinin planındandır (bugünün işi çalışmadıysa 09:00'ye kadar bugünkü; kesin föyün yeniden kontrolü
     sıradaki sayılmaz);
  3. eksik gün kalmadıysa son 14 günün kesin olmayan föyleri (gün açıkken ya da 07:00'den önce elle alınanlar);
  4. hiçbiri yoksa son 7 günün en eski kontrol edilen föyü (kapanıştan sonra düzeltme olduysa görünsün).
  Hak bitince durur. Yani her sabah dün + bir geçmiş gün gelir, geriye doğru (3 Kasım saklıyken: 5 Kasım sabahı 4 ve 2 Kasım,
  6 Kasım sabahı 5 ve 1 Kasım, …).
  **Daha hızlı geçmiş için** Gafdigi'den birkaç günlüğüne daha yüksek kota istenebilir; kod hakkı yanıt başlığından
  okur (`X-Kota-Hak`, `X-Kota-Kalan`), değişiklik gerekmez.
- **Bu günü çek** (Ayarlar, yalnız yönetici): seçilen günü hemen çeker; kalan hakkı onay penceresinde söyler. Bugün
  seçilirse açık kasa o anki tutarlarla gelir ("Kesin değil"); ertesi sabah kendiliğinden yeniden çekilir.
- Sayfa açılışı, zil ya da Kasa ekranı **hiçbir zaman** istek göndermez: yalnız saklanan föyü okur.
- İstemci aynı günü yeniden denemez (hak harcanmasın). Hakkı geri veren hata (400'ler hak düşürmez, 500'de hak geri
  verilir) olursa sabah işi o hakla planın sıradaki gününü çeker (en çok 2 kez; elle çekimde yalnız verilen gün). Hak dolduysa (`429 KOTA_DOLDU`) hiçbir istek gitmez; kalan hak son
  yanıttan bilinir (integration_state › `modpos`).
- **Alınamayan gün** (bozuk yanıt, 500…) her sabah yeniden denenmez: 2, 4, 8… gün (en çok 32) bekler, geçmiş onda
  takılmaz, sıradaki eksik güne geçer; iki kez alınamayan gün kartta yazar. Yanıt 2xx ama okunamıyorsa (bozuk, çok
  büyük, yarıda kesik) çalışma durur: sorun büyük olasılıkla her günde aynıdır, ikinci hak harcanmaz.
- **AsilPOS'a geçiş gününden** itibaren Marina'nın föyü çekilmez (o günleri hiçbir yer okumaz); geçmiş yalnız ondan önceye
  tamamlanır. Geçiş günü yalnız AsilPOS'un kurulu olduğu şubenin (Marina) kasasınındır: Tuzla'nın kasası ModPOS'ta kalır,
  föyü her sabah çekilmeye devam eder (`branchSwitchDay`; denetim 21 Kasım #5, [ASILPOS.md](ASILPOS.md) › Şubeler).
- **Aynı anda tek çekim** (integration_state › `modpos.kira`, 90 sn): sabah işi iki kez tetiklenirse ya da **Bu günü
  çek** sabah işiyle çakışırsa ikincisi istek göndermez ("Başka bir ModPOS çekimi sürüyor"). Bu günü çek'in yanıtı yolda
  kaybolursa pencere kapanır ve sayfayı yenileyip kalan hakka bakmak önerilir (çekim yapılmış olabilir).
- Gece yarısından sonra **Bu günü çek**'in ilk günü kesinleşmiş son gündür (07:00'den önce dün değil önceki gün); dün
  seçilirse pencere föyün kesin olmayacağını ve sabah işinin yeniden çekeceğini söyler.

## 3. Ne çekilir, ne çekilmez

Saklanan (föyün **her şeyi**): kasa günü, föyün hazırlandığı an, her kasa için şube ve kasa adı, gün no, Z no, durum
(açık / kapalı / 06:00'da kendiliğinden kapandı), açılış ve kapanış zamanı, **yapan personel** ve nakdi, ciro, ciro
dışı (ikram, ödenmez…), adisyon ve kişi sayısı, bahşiş, her ödeme yöntemi (satış, cari tahsilat, sistem, defter, fark,
banka / kurum kırılımı; ikram, ödenmez, zayi, hediye kartı, sadakat ikramı, değişim mahsubu da birer ödeme satırıdır,
kırılımıyla), kasa defteri girildi mi, giderler (kategori, açıklama, tutar), cari tahsilatlar (**müşteri**, tutar,
yöntem, zaman), nakit mutabakatı (dayanak, açılış, nakit satış, nakit cari tahsilat, gider, beklenen, sayılan, fark),
ara kasalar (**yapan personel** dahil), kapanış ve fark notları, uyarılar, kasası açılmamış satış (föysüz gün) ve özet.

**Kişi adları** (sahibin kararı, 3 Kasım 2026: "kişi isimleriyle, tüm olası ihtimallerle çek"): açılışı, kapanışı ve
ara kasayı yapan personel ile cari tahsilatın müşterisi saklanır ve **yalnız yöneticinin** ekranlarında görünür (Kasa
gün görünümünün ModPOS bölümü ve komut satırı). Personelin ekranına, WhatsApp metnine, e-postaya ve zile hiçbir yolla
gitmez (kaynak bekçileri: tests/modpos-kasa.test.ts, tests/personel-sizinti-kasa.test.ts). Bu karardan önce saklanan
föylerde ad yoktur; o gün yeniden çekilince gelir.

**Kitapçıkta olmayan alan kaybolmaz:** yanıtta kitapçığın öğe ağacında olmayan her öğe (yeni bir alan, bilinen
alanın altında iç içe öğe) yoluyla ve metniyle föyün `ekAlanlar`'ına yazılır (en çok 60) ve ModPOS bölümünde "ModPOS'un
kitapçıkta olmayan N alanı" diye görünür. Ayrıca ModPOS'un gönderdiği **ham XML** de saklanır (`raw`; öznitelikler
dahil her şey): Kasa'da "Ham föy" kutusunda açılır, ileride yeni bir alan panele eklenirse eski günler ondan okunabilir.

**API'nin vermediği** (panelde bugünkü gibi elle kalır): ürün ürün satış (Satışlar'a aylık liste), KDV dökümü,
indirim tutarı, saatlik dağılım, adisyon ayrıntısı, yazarkasanın (banka POS) mali Z'si, banka gün sonu, personelin
teslimi.

## 4. Eşleme: föy → kasa raporunun alanları

| Kasa raporu | Föyden |
|---|---|
| Z no | `zNo` (tek kasada; birden çok kasada boş) |
| Fiş sayısı | Σ `adisyonSayisi` |
| Toplam satış | Σ `satis.ciro` (ayın **cirosuna** bundan, Z toplamının içindeyse ödenmez düşülerek girer: [KASA-RAPORU.md › Ciro ve ödenmez](KASA-RAPORU.md#ciro-ve-ödenmez)) |
| Nakit | `NAKIT` ödemesinin `satis`'i |
| Kredi / banka kartı | `KREDI_KARTI` (cari tahsilat hariç: `satis`, `sistem` değil) |
| Yemek kartı | `YEMEK_KARTI`, `MULTINET`, `PLUXEE`, `SODEXO`, `SETCARD`, `EDENRED`, `TOKENFLEX`, `PAYE`, `METROPOL` |
| Online | `ONLINE_WEB`, `TRENDYOL_ONLINE`, `YEMEK_SEPETI_ONLINE`, `MIGROS_YEMEK_ONLINE`, `GETIR_ONLINE` |
| Diğer | `MOBIL_ODEME`, `HAVALE`, `CARI_HESAP`, `FIYUU`, `SADAKAT_PUANI`, `DIGER` ve tanınmayan kod (ciroya dahilse) |
| Ödenmez / ikram | `satis.ciroDisi` |
| Açılış | `nakitKasa.acilis` |
| Gün içinde çıkan | `nakitKasa.gider` (bilgi: panelin kaynağı Kasadan çıkanlar) |
| Gün içinde giren | `nakitKasa.nakitCariTahsilat` (bilgi) |
| Sayılan nakit | `nakitKasa.sayilan`, yalnız dayanak `Z_RAPORU` iken (gün açıkken ya da kendiliğinden kapandıysa sayım yok) |

Tutarlar noktalı ondalıkla okunur; kayan nokta artığı ve üs (`17620.500000000004`, `-1.1e-13`) iki ondalığa
yuvarlanır, virgüllü tutar (`1.234,50`) ve ofsetsiz zaman reddedilir (alanın yoluyla). Sayısal karakter başvuruları
(`&#305;`) çözülür. Ciroya dahil olmayan yöntemler (`IKRAM`, `ODENMEZ`, `HEDIYE_KARTI`, `SADAKAT_IKRAMI`,
`DEGISIM_MAHSUBU`, `ZAYI`) ödeme alanına girmez. Ödemelerin ciroya dahil toplamı ciroyu da ciro − ciro dışı'nı da
tutmuyorsa föy kendi içinde tutmuyor demektir: gün görünümünde uyarı satırı çıkar. Ciro ödenmezi içeriyorsa (ödemeler =
ciro − ciro dışı) gün tutarlıdır, uyarı yoktur: formun ve kayıtlı raporun kuralı (`dayRevenue`, denetim KP-08). Kasası açılmamış ama satışı olan gün ("föysüz") tutarlarını föysüz satıştan alır, kasa
alanları boştur. Kod: `src/lib/modpos/z.ts` (`foyZ`, `modposBucket`).

## 5. Nerede görünür

- **Ayarlar › ModPOS (kasa föyü)** (yalnız yönetici): durum (gri Kurulmadı / Önizleme, turuncu Henüz çekilmedi /
  Uyarı, yeşil Bağlı, mavi Hak doldu, kırmızı Hata / Anahtar bozuk; hak dolması olağandır, hata değil),
  bugünkü kalan hak ve yenilenme saati, kapsam ("1 Temmuz – 2 Kasım arası 14 günün föyü var · 111 gün henüz yok"),
  son çekim ve son hata, **Bu günü çek**, son çekilen günler ve **Ay rakamına yedek** anahtarı (§6).
- **Kasa** (yalnız yönetici; personelin ekranı değişmez):
  - Gün görünümünde (`?gun=`), kasa raporu formunun altında üç bölüm (sahibin isteği, 3 Kasım 2026;
    src/app/panel/kasa/modpos-sheet.tsx `ModposSections`):
    1. **ModPOS** (kasa föyü): künye (Z no, durum, kesin mi, ModPOS'ta hazırlandığı ve panele alındığı an, sürüm);
       karolar: ciro, adisyon sayısı ve ortalama adisyon, kişi sayısı ve kişi başı, ciro dışı (ödenmez / ikram),
       bahşiş, kasa farkı; ödeme dağılımı (kanal kanal tutar ve ciroya göre pay, ödemelerin toplamı ciroyla tutuyor
       mu); nakit kasa (açılış + nakit satış + nakit cari tahsilat − gider = beklenen, sayılan ve dayanağı, fark,
       kartla cari tahsilat); **ödenmez / ikram dökümü** (ciroya girmeyen her ödeme satırı kod kod: ikram, ödenmez,
       zayi, hediye kartı, sadakat ikramı, değişim mahsubu; kırılımıyla kime / hangi kuruma; föyün ciro dışı toplamıyla
       tutuyor mu). Kasasız satışın ödemeleri Z özetinin kuralıyla seçilir (ciroya dahil bilgisi gelmeyen DIGER ve
       tanınmayan kod Diğer'dir, dökümde yok) ve şube şube ayrı yazılır; kasa açılmışken gelen başka şubenin kasasız
       satışı "föyün toplamlarına girmez" der ve denetime katılmaz; **kişiler** (kasayı açan, kapatan, ara kasayı yapan, cari tahsilatın
       müşterisi); her kasanın açılış / kapanış saati (yapanla) ve açık kalma süresi, ödeme yöntemleri (ModPOS'taki
       adıyla) ve banka kırılımı, giderler, cari tahsilatlar (müşteriyle), ara kasalar, notlar; ModPOS'un uyarıları,
       föysüz satış, kitapçıkta olmayan alanlar, föy değiştiyse önceki sürüm ve **ham föy** (XML, kapalı kutuda).
       Föy yoksa ne zaman geleceği.
    2. **ladmin** (panelde yazılan kasa raporu; src/app/panel/kasa/ladmin-report.tsx, src/lib/cash-ladmin.ts, föyü
       bilmez): künye (gönderen ve anı, kasayı sayan, sürüm ve son değişiklik, fotoğraf sayısı, e-posta); karolar: Z
       toplamı ve Z no, fiş sayısı ve ortalama fiş, ödenmez / ikram, indirim, kasa farkı, ertesi güne devreden; ödemeler
       (pay ve Z toplamıyla tutuyor mu); nakit kasa (açılış önceki raporun devriyle tutuyor mu, + nakit satış + giren −
       çıkan = olması gereken, sayılan, fark, teslim, devreden ertesi raporun açılışıyla tutuyor mu); kart (Z kartı,
       banka POS gün sonu, yazarkasa kartı, kart farkı); yazarkasa Z'si; kasadan çıkanlar (satır satır, toplam);
       panelde girilen zayi / ikram (ModPOS'un ödenmez / ikram dökümünün karşılığı); not.
    3. **Karşılaştırma** (ModPOS föyü ↔ ladmin raporu): rozet (raporla aynı / N alan farklı / rapor yok / gün açıkken
       alındı), özet satırı ("16 satır aynı · farklı yazılan alan yok"), farklı yazılanların uyarısı ve alan alan
       tablo (Alan | ladmin | ModPOS | Fark; fark ModPOS − ladmin). Çekirdeğin satırlarına iki bilgi satırı eklenir:
       ödemelerin toplamı ve raporda banka POS yazıldıysa banka POS ↔ ModPOS kartı (kartla cari tahsilat dahil).
       Kişi satırı: ModPOS'ta kasayı kapatan ↔ ladmin'de kasayı sayan. ModPOS'ta kasa açılmamış ama raporda satış
       yazılıysa para uyarısı.
    Anahtar kurulmamışken ve föy de yokken üç bölüm de çıkmaz (ladmin'in bilgisi formda zaten var). Gün içinde, kasa
    açılmadan alınan (kesin olmayan) boş föy "kasa açılmadan alındı" der ve ertesi sabahın sabah işi bitene kadar
    (09:00) akşamki raporla uyarı vermez: kesin föy beklenir. Sonrasında (o sabah alınamadı) para uyarısı yine çıkar. Ödemelerin toplamında ladmin formun kuralını kullanır (1 ₺'tan küçük fark tutuyor sayılır).
  - Günden güne listede rozet **ModPOS'tan farklı**; raporu girilmemiş günde föyün cirosu.
- **Zil** (yönetici): son 7 günde "Kasa raporu ModPOS API'den farklı" (gün · farklı alanlar); anahtar çalışmıyorsa
  "ModPOS API'den veri çekilemiyor". **Bugün**: dünün kasa satırı "ModPOS API'den farklı" işaretiyle "Sorun var" olur.
  Sabah e-postası ve kasa raporunun e-postası aynı metni kullanır (`MODPOS_MISMATCH_TITLE`, `modposDiffsLine`).
- **Sabah işi** (Ayarlar › Günlük işler): adım "ModPOS kasa föyü" (alındı / çekilecek gün yok / hak doldu / hata).
  Yalnız anahtar varken yazılır; hata "Sabah işinde bir adım hata verdi" uyarısına gider.

Karşılaştırma kuralları (`src/lib/modpos/compare.ts`): Z alanları, açılış ve sayılan nakit 1 kuruş hassasiyetle
"farklı yazılan"dır (personel bunları ModPOS'un Z'sinden yazar; fark yanlış yazım ya da kapanıştan sonraki düzeltmedir).
Raporda boş bırakılan isteğe bağlı alan (Z no, fiş sayısı, ödenmez) farklı sayılmaz. Açılış ModPOS'la karşılaştırılmaz
(sahibin kararı, 4 Kasım 2026): kafede başlangıç nakdi ModPOS'a girilmez, açılış önceki günün devridir (raporun kendi
"Açılış ≠ devir" denetimi). Tabloda açılış satırı "ModPOS'ta yok (önceki günün devri)" der; ModPOS'un açılışsız beklenen
nakdine ve kasa farkına raporun açılışı eklenir; ModPOS bölümündeki nakit kasa ModPOS'un kendi (açılışsız) hesabıdır.
Sayım girilmeden Z'si alınan günde ModPOS sayılanı 0 gönderir: tabloda "ModPOS'ta girilmedi" diye bilgidir, uyarı ve
zil çıkmaz; sayılan 0 yalnız ModPOS'un beklenen nakdi de 0'sa gerçek sayımdır ve karşılaştırılır. Panelde API'den gelen
her bilgi "ModPOS API" diye anılır (personelin ModPOS'tan yazdığı Z ile karışmasın). Gider ↔ gün içinde çıkan,
nakit cari tahsilat ↔ gün içinde giren, olması gereken ve kasa farkı yalnız bilgidir. AsilPOS'a geçiş gününden
itibaren Marina'nın kasası AsilPOS'tur: föy karşılaştırılmaz (Tuzla'nın raporu kendi föyüyle karşılaştırılmaya devam
eder). Kasası hâlâ açıkken alınmış föy (gün içinde **Bu günü çek**)
karşılaştırılmaz: o anki tutarlardır, ModPOS bölümünde "Föy gün açıkken alındı" yazar, rozet ve zil çıkmaz; ertesi
sabah kapanmış föy kendiliğinden gelir. Kasası açılmamış (föysüz) gün de kesinleşmeden karşılaştırılmaz.

## 6. Ay rakamına yedek (isteğe bağlı, varsayılan kapalı)

Ayarlar › ModPOS kartındaki anahtar, **şube başına** (25 Kasım 2026; şube ayarı `modpos`, [SUBE.md](SUBE.md) › Şube
başına ayarlar): kartın her şube bölümünde kendi anahtarı, Şube ayarları › ModPOS'ta da. Eski genel kayıt
(`settings › modposAyYedegi`) Tuzla'nındır; öbür şubeler "Tuzla ile aynı" başlar (bugünkü tek anahtar hiçbir şey
yapmadan bütün föylere uygulanır). "Aynı" kapatılınca o anki değer şubeye kopyalanır; bağlı şubenin anahtarı Ayarlar'da
salt okunur ve Şube ayarları'na götürür. Föy yalnız anahtarı açık şubenin föyüyse aya girer; hiçbir şubede açık değilse
föy tablosu hiç okunmaz (`modposFallbackBranches`, `src/server/modpos/fallback.ts`). Açıkken kasa raporu (ve AsilPOS gün sonu) olmayan
günün **kapanmış** föyü ayın açık gün, ciro, ödenmez ve kart payına girer (AsilPOS'un yedek satırıyla aynı kural, G6):
gün yine "rapor yok" sayılır, rapor girilince rapor kazanır. Marina'nın (AsilPOS'un şubesi) föyü AsilPOS'a geçiş
gününden önceki günler için, Tuzla'nınki (ModPOS'ta kalan şube) her gün (`modposTillRows`, `branchSwitchDay`). İndirim
föyde olmadığı için o günlerin indirimi bilinmez. Elle yazılan ay bilgisi her zaman kazanır (yalnız föyden gelen ayda
elle yazılan 0 da silinmez). Kapalıyken föy hiçbir hesaba girmez.

Bu anahtar yalnız panelin ay rakamını yönetir. AsilPOS'un ModPOS dönemi ucu (`GET /api/panel/pos/modpos-gunler`,
[ASILPOS.md](ASILPOS.md) › ModPOS dönemi) Marina'nın raporsuz gününün kapanmış föyünü anahtar kapalıyken de gönderir
(`kaynak: "foy"`, indirim `null`). Aşağıdaki kesintisiz kısım kuralı da o uçta aranmaz (karar 23 Kasım 2026).

Raporlar başlamadan önceki föyler yalnız **ilk rapora kesintisiz uzanan kısımla** sayılır: arada föyü olmayan gün varsa
(alınamadı, henüz çekilmedi) ondan öncesi sayılmaz, boşluk dolunca kendiliğinden sayılır; kesintisiz kısmın başladığı
ay yarımdır (toplamı uygulanmaz, "ModPOS föyleri 6 Ekim'den itibaren var"). Tek tek elle çekilmiş eski bir gün ayı
yanlış "tam" yapmaz. Geçmiş yeniden eskiye çekildiği için (§2) ilk rapordan önceki föyler, geçmiş ilk rapordan geriye
indikçe her sabah bir gün daha sayılır. Kasası açılmamış, satışsız kesin gün (kafe kapalı) sıfır satırdır: kesintiyi bozmaz, ciroya bir şey
katmaz. Eksik gün uyarıları yalnız ilk kasa raporundan itibaren aranır: raporlardan önceki föy günleri "eksik rapor"
sayılmaz.

Föy de şubenindir: öncelik ve kesintisiz kısım **şube şube** (Tuzla'nın raporu Marina'nın aynı günkü föyünü düşürmez).
Föyden sayılan gün Bugün'ün "Şubelerde dün / bugün" kartında da görünür ("ModPOS API'den"; `modposFallbackSheets`):
Genel bakış'ın günlük grafiği o günü sayarken kartın çizgisi eksik göstermez (denetim 13 Kasım HM-09).

## 7. Saklama

- `modpos_cash_sheets`: (kasa günü, şube) başına bir satır; föyün okunmuş hâli (`sheet`, kişi adları ve tanınmayan alanlarla),
  ModPOS'un gönderdiği ham XML (`raw`, son çekimin; yalnız günün görünümü okur, ay listeleri okumaz), durum, kesin mi,
  parmak izi, sürüm, önceki sürümün özeti, hazırlanma / çekilme / değişme anları. Aynı gün yeniden çekilince içerik
  aynıysa yalnız çekilme anı ve ham XML değişir; değiştiyse sürüm artar ve "önceki" özet kalır. Ad okunmaya
  başlamadan önce saklanan bir gün yeniden çekilirse adlar eklendiği için bir kez "değişti" sayılır (tutarlar aynı).
- `integration_state › modpos` (öteki şube `modpos:<kimlik>`, §1a): son kota, son başarılı / başarısız çekim, son 10 çalışma, alınamayan günler ve sabah
  işinin son çalıştığı an (`lastCronAt`). Anahtar burada değil (eski kayıtlardaki `liveFrom` artık okunmaz).
- İkisi de yedeğe girer (föy kişi adlarıyla; yedek de yalnız yöneticinin). Migration'lar:
  `drizzle/0050_modpos_kasa_foyu.sql` (yeni tablo), `drizzle/0051_modpos_ham_foy.sql` (`raw` sütunu; boş başlar).

## 8. Sorun giderme

| Kartta / zilde | Ne yapılır |
|---|---|
| Kurulmadı | `MODPOS_API_KEY`'i Vercel'e (Production) ekleyip yeniden yayınlayın |
| Anahtar geçersiz / kapalı / süresi dolmuş | Gafdigi'den anahtarı kontrol ettirin, yenisini Vercel'e yazın |
| IP kısıtı | Gafdigi'den anahtarın IP kısıtını kaldırtın |
| Rapor yetkisi yok / kapsam geçersiz | Gafdigi'den anahtara kasa föyü yetkisi ve işletme bağı verdirin |
| Hak doldu | Olağan; gece yarısı yenilenir. Sabah işi ertesi gün devam eder |
| Föy hazırlanamadı / servis kullanılamıyor | Sonraki sabah kendiliğinden yeniden denenir |
| Yanıt okunamadı (alan adı) | ModPOS yanıtının biçimi değişmiş olabilir: `npm run modpos:foy -- --dosya yanit.xml` ile bakın |

Komut satırı (yerelde, anahtar ortamda): `npm run modpos:foy -- 2026-11-02` bir günü çekip özetini yazar (veritabanına
yazmaz, bir hak kullanır); `--dosya yanit.xml` yalnız dosyayı okur (istek yok); `--kaydet` veritabanına da yazar
(komut satırında verilen `DATABASE_URL` `.env.local`'dakinden önce gelir, `db:restore` gibi; hedefi yazar);
`--sube marina` o şubenin anahtarıyla ve o şubeye (kaydederken föy şube adlarına göre ayrılır, §1a).

| Kartta / zilde (şubeler) | Ne yapılır |
|---|---|
| Marina "Kurulmadı" | Gafdigi'den Marina'nın anahtarını alıp `MODPOS_API_KEY_MARINA` olarak yazın |
| Ortak anahtar | Şubeye başka şubenin anahtarı yazılmış: şubenin kendi anahtarını yazın |
| "… şubesi panelde bir şubeyle eşleşmedi" | `MODPOS_SUBELER`'e `ModPOS adı=şube kimliği` yazıp o günü yeniden çekin |

## 9. Sonraya

- **Komisyon & hakediş**: yemek kartı firmaları ve platformlar föyde ayrı (`MULTINET`, `PLUXEE`, `TRENDYOL_ONLINE`…);
  kanal kanal satış föyden alınabilir (`modposChannels`, `src/lib/modpos/z.ts`). Kaynak sırası elle > asilpos > modpos
  > tek olur.
- **Kasa formunda "ModPOS'tan doldur"**: föyü saklanan günde (geç rapor, ertesi gün girilen rapor) form föyden
  dolabilir (`CashPrefill.source: "modpos"` hazır). Akşam kapanışta doldurmak günün ikinci hakkını harcar; kota
  artırılırsa açılır.
- Satış tahmini, nakit planı ve haftalık özetin günlük cirosu (bugün yalnız kasa raporundan).

## 10. Dosyalar

- Saf: `src/lib/modpos/foy.ts` (XML → föy, güvenli ayrıştırma), `z.ts` (eşleme, Z özeti), `request.ts` (şubenin
  anahtarı, kota, hata metinleri), `sube.ts` (şubenin anahtar değişkeni, ad eşlemesi, föyün ayrılması, sabah işinin
  birleşik sonucu), `plan.ts` (hangi gün), `status.ts` (durum, kart özeti, yedek ayarı), `compare.ts` (rapor ↔
  föy).
  `ayarlar.ts` (kartın ve "Bu günü çek"in metinleri).
- Sunucu: `src/server/modpos/client.ts` (istek), `store.ts` (saklama, okuma, durum), `sync.ts` (çekme), `status.ts`
  (kartın verisi), `admin.ts` (yedek ayarının yazımı); eylemler `src/server/actions/modpos.ts`; kart
  `src/app/panel/ayarlar/modpos-card.tsx` ve `modpos-client.tsx`; sabah adımı `src/app/api/cron/gunluk/route.ts`
  (`modposP`) ve `src/lib/job-health.ts` (`modposStep`); komut satırı `scripts/modpos-foy.ts`.
- Kasa gün görünümü: `src/app/panel/kasa/modpos-sheet.tsx` (`ModposSections`: ModPOS, ladmin, Karşılaştırma),
  `ladmin-report.tsx` (ladmin bölümü), `day-parts.tsx` (ortak karo ve satır parçaları), `modpos-diffs.tsx`; saf
  yardımcılar `src/lib/cash-modpos.ts` (ModPOS ve karşılaştırma) ve `src/lib/cash-ladmin.ts` (ladmin; föyü bilmez);
  okuyucu `src/server/data/modpos-day.ts`. Testi `tests/modpos-kasa.test.ts`.
- Testler: `tests/modpos-sube.test.ts` ve `tests/modpos-sube-db.test.ts` (şubeler, §1a), `tests/modpos-foy.test.ts` (saf), `tests/modpos-sabah.test.ts` (sabah adımı), `tests/modpos-ayarlar.test.ts`;
  veritabanıyla (`MODPOS_TEST_DATABASE_URL`): `tests/modpos-db.test.ts`, `tests/modpos-ayarlar-db.test.ts` ve sabah
  adımının DB bölümü.
- Fikstürler: `tests/fixtures/modpos/` (kitapçığın örneği ve uç durumlar; kafenin verisi değil).

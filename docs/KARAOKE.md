# Karaoke sayacı ve laffogato.net bağlantısı

Ekran: **Karaoke** (`/panel/karaoke`, "Barın ekranı"; yöneticinin menüsünde **Kafe** altında), personel ve yönetici.
Kasadaki tablette ya da bilgisayarda
Chrome'da açık bırakılır: laffogato.net'te karaoke rezervasyonu açılınca zil çalar (Yemeksepeti / Getir paneli gibi),
oturum başlayınca kısa ses, bitime az kala uyarı, süre dolunca personel **Haber verdim**'e basana kadar alarm çalar.
Sitenin ödenmiş, açık kafe siparişleri ve masa çağrıları 6 Kasım 2026'dan beri kendi ekranında (**Siparişler**,
`/panel/siparisler`; yeni siparişte ve çağrıda zil, [SITE-SIPARIS.md](SITE-SIPARIS.md)); bu ekranın en üstünde yalnız
açık olanların tek satırı kalır ("3 açık uygulama siparişi" · **Siparişler'e git**).

## Geliştirilmiş istek (prompt)

> Personel paneline karaoke odası sayacı ekle. laffogato.net'te bir karaoke rezervasyonu açılınca, ödenince,
> onaylanınca, iptal edilince ya da saati değişince panel bunu **anında** öğrensin. Hep açık duran Chrome sekmesinde
> zil çalsın; sekme arka plandayken ya da kapalıyken sistem bildirimi gelsin. Oturum başlayınca kısa ses, bitime 10
> dakika kala uyarı, süre dolunca personel "Haber verdim"e basana kadar alarm ve ekranın üstünde kırmızı şerit olsun;
> +15 / +30 dk uzatma ve erken bitirme olsun. Rezervasyonsuz gelen grup için hızlı sayaç (30 dk – 2 sa ya da özel
> süre). Yönetici aynı ekranda bugünü, yaklaşanları, son 30 günü, ayın özetini (rezervasyon, saat, ciro, iptal) ve
> bağlantının durumunu görsün; personel tutar görmesin.
>
> - **Sürekli istek yok:** site her değişiklikte panele içeriksiz, imzalı bir ping atar; panel değişenleri imzalı
>   tek bir okumayla çeker ve cihazlara Web Push gönderir. Açık sekme veriyi yalnız açılışta, bildirim gelince,
>   sekmeye dönünce ve seyrek bir yedek kontrolde ister; ETag ile, değişiklik yoksa 304.
> - **Güvenlik:** iki yön HMAC-SHA256 ile imzalı (zaman, yöntem, yol, sıralı sorgu, gövde özeti; ±5 dk; sabit süreli
>   karşılaştırma), ortak anahtar yalnız sunucuda; siteden panele yalnız ad, saat, kişi sayısı, durum ve not gelir
>   (e-posta, telefon, soyad asla); push yalnız bilinen push servislerine gider; ne push ne sekmenin kendi sistem
>   bildirimi (başladı, az kaldı, süre doldu) misafirin adını taşır (kilit ekranı; ad yalnız açık panel ekranında).
> - **Hız:** ping sitedeki yazımı yavaşlatmaz, panel pinge hemen yanıt verir, eşitleme arka planda; alarm sesi ses
>   saatinden zamanlanır (arka plandaki sekmede de zamanında çalar).
> - **Basit kurulum:** tek değişken (`KARAOKE_SYNC_SECRET`, iki projede aynı); bildirim anahtarları kendiliğinden
>   üretilir. Her cihaz kendi tercihini tutar (ses, alarm, uyarı süresi, ekran açık kalsın).

## Nasıl çalışır

```
laffogato.net                                   ladmin.laffogato.net (bu panel)
─────────────                                   ──────────────────────────────
rezervasyon yazıldı
  └─ after(): POST /api/karaoke/ping  ───────▶  imza doğru → 202 (hemen)
     (içeriksiz, imzalı)                          └─ after(): eşitle
                                                     GET laffogato.net/api/panel/karaoke?from&to (imzalı)
GET /api/panel/karaoke  ◀───────────────────────     ├─ karaoke_sessions'a yaz (yeni / değişen / silinen)
  beyaz listeyle: ad, saat, kişi, durum, not, iade   ├─ karaoke sürümünü artır (canlı ucun ETag'i)
                                                     └─ olay varsa Web Push → cihazlar
                                                           └─ service worker → açık sekme /api/canli'yi yeniler,
                                                              zil çalar, kart gösterir
```

- **Ping kaçarsa:** Ping ucu 202'den sonra işi kaybetmez: pingin kaydı yazılamasa da çekilir, çekme düşerse 4 saniye
  sonra bir kez daha denenir (`src/lib/ping-work.ts`). İkisi de olmazsa kopyayı açık bir panel sekmesi tazeler: canlı uç
  her soruluşunda (yanıttan sonra) bakar, çekmesi kaybolan bir ping varsa 30 saniye sonra, son çekme hatalıysa iki
  dakikada bir, kopya 30 dakikadan eskiyse site yeniden sorulur (`src/lib/karaoke/freshness.ts`; kimse bakmıyorsa ne
  panelin ne sitenin veritabanı uyanır). Son çekme hatalıyken ekran canlı ucu bildirim izni olsa da dakikada bir sorar:
  site geri gelince yeni rezervasyon ve sarı satırın kalkması iki üç dakika sürer. Hatayı ekran bir sonraki soruluşunda
  öğrenir; bildirim izni olan cihazda bu en çok 30 dakika (yedek kontrol). Hızlı sayaç ve uzatma, sitedeki
  rezervasyonla çakışmayı sormadan önce kopya üç dakikadan eskiyse siteyi sorar. Son çekme başarısızsa bar ekranında
  sarı satır: "Son kontrol başarısız: … Rezervasyonları sitenin panelinde de kontrol edin." (yönetici; personel ayrıntı
  yerine kısa söz görür: "Rezervasyonlar şu an siteden alınamıyor (son başarılı kontrol 14:05). Yeni rezervasyon burada
  görünmeyebilir; sorun sürerse yöneticiye haber verin.") Karaoke sayfası açılınca da
  en çok beş dakikada bir site sorulur; günlük iş (`/api/cron/gunluk`) bir kez eşitler. Yönetici **Şimdi eşitle** ile
  elle eşitler.
- **İlk eşitleme** geçmiş kayıtları sessizce alır (eski rezervasyonlar için zil çalmaz). Bitmiş rezervasyonun
  değişikliği bildirilmez. Ödemesi beklenen tutma (sitede ödeme sayfası açık) sessizdir; ödeme tamamlanınca "yeni
  rezervasyon" olarak çalar.
- **Açık sekmenin istek bütçesi** (`/api/canli`, ETag'li; değişiklik yoksa 304 ve veri okunmaz; `src/lib/live-poll.ts`):
  açılışta, bildirim gelince, sekmeye dönünce, ağ geri gelince; yedek kontrol sekme öndeyken, bildirim açıkken
  30 dakikada, kapalıyken dakikada bir (ekran 10 dakikadır kullanılmıyorsa ve bir saat içinde oturum ya da saatli
  hatırlatıcı yoksa 10 dakikada bir); son karaoke çekmesi hatalıyken (sarı satır) bildirim açık olsa da dakikada bir.
  Arka plandaki sekme yalnız bildirimin ulaşmadığı zil cihazındaysa (bar ekranı: ses açılmış, sipariş zili ya da
  karaoke alarmları açık) 10 dakikada bir sorar: yeni sipariş ve rezervasyon zili en geç o kadar gecikir. Alarm
  çalarken arka planda da 15 saniyede bir (başka cihazda susturulursa burada da sussun). "Bildirim açık": izin
  verilmiş, abonelik kaydedilmiş ve çalan zillerin konuları (Sipariş / Karaoke bildirimleri) bu cihazın aboneliğinde
  açık. Panelin veritabanı Neon'un ücretsiz planında: her kontrol onu uyandırır ([BILDIRIMLER.md](BILDIRIMLER.md) ›
  Neon kotası).
- **Uzatma** tek yazımda ve SQL'de toplanır: bar ekranı ve bir telefon aynı anda +15'e basarsa ikisi de sayılır.
- **Sayaç sunucu saatiyle sayar:** tabletin saati yanlış olsa da alarm zamanında çalar. Sekme arka plandayken
  tarayıcı zamanlayıcıları yavaşlatsa da bitiş sesi önceden ses saatine kurulur.
- **Süre doldu şeridi** her sayfanın en üstünde sabit durur (oturum başına bir satır: **+15 dk**, **Haber verdim**).
  Sayfa şeridin yüksekliği kadar aşağı iner: telefondaki üst çubuk (başlık, zil, menü) ve menü çekmecesi şeridin altında
  kalır, sayfanın başlığı ve düğmeleri örtülmez (denetim SB-03; `--alarm-h`, `src/app/globals.css`). Zilin açılır
  listesi telefonda üst çubuğun hemen altında açılır, masaüstünde şeridin üstüne çıkar; arama paleti ve "İçeriğe geç"
  bağlantısı şeridin altından başlar. Baskıda şerit de boşluğu da çıkmaz. Alarm sesi aynı anda çalan "Sürekli" kişisel
  hatırlatıcıyla aynı döngüde çalar ama ayrı susar: hatırlatıcının **Sesi kes**'i karaoke alarmını, **Haber verdim** de
  hatırlatıcının sesini kesmez ([HATIRLATICILAR.md](HATIRLATICILAR.md)).
- **Elle rezervasyon ve saati kapatma** (22 Kasım 2026) siteye yazılır: Karaoke › **Elle ekle**, sitenin imzalı
  `POST /api/panel/karaoke`'ı (aşağıda › Elle rezervasyon ve saati kapatma).
- **Rezervasyonsuz oturum** (hızlı sayaç) yalnız panelde tutulur; siteye gitmez. Etiketsiz sayaç ekranda, zilde ve
  bildirimlerde bu adla geçer ("Rezervasyonsuz oturum bitirildi"; `sessionName`).
- Eşitleme rezervasyonun yapıldığı ve iptal edildiği anı da yazar (`booked_at`, `cancelled_at`; doluluk haritası için,
  aşağıda).
- **İptalin iadesi** (`refund_minor`, sitenin `refundMinor`'ı; site 29 Ekim 2026'dan beri gönderir): iptal edilmiş
  rezervasyonda geri giden ya da gidecek tutar. Sitede %0 kuralında misafir pencereden sonra ama rezervasyon saatinden
  önce gelemeyeceğini bildirirse rezervasyon iade yapılmadan iptal edilir ve saati satışa açılır; ödeme durumu yine
  `refunded` gelir ama tutar 0'dır. Bar ekranının rozeti bu yüzden ödeme durumuna değil iadenin türüne
  (`refundKindOf`) bakar: "İptal · iade yok" (0), "İptal · kısmi iade edildi" / "İptal · kısmi iade sürüyor" (toplamdan
  küçük: geç iptal payı ya da yeniden satılan saatin payı), "İptal · iade edildi" / "İptal · iade sürüyor" (tamamı ya
  da tutar bilinmiyor; alanı göndermeyen eski site). Tutar yalnız yöneticiye gider; personel yalnız türünü görür.
  Yeniden satılan saatin iadesi sitede yalnız bu tutarı değiştirebildiği için eşitleme onu da karşılaştırır.

### Çakışma uyarısı

Oda tektir. Hızlı sayaç başlatılırken ya da süren bir oturum uzatılırken (+15 / +30 dk; zildeki "uzat" dahil) o saatte
sitede **geçerli** bir rezervasyon varsa personele sorulur; kesin engel değildir (bar, gelenin rezervasyonu yapan
grup olduğunu bilebilir):

- Süre seçilirken formun altında sarı satır: "Dikkat: Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var.
  Sayacın bitişi 21:30."
- **Başlat**'a basınca sunucu yeniden bakar (ekranın listesi eski olabilir); çakışma varsa kaydetmeden döner, ekran
  sorar: "Sitede rezervasyon var · Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var. Yine de başlatılsın mı?"
  **Vazgeç** ya da **Yine de başlat** (uzatmada **Yine de uzat**). Onaylanınca kaydedilir ve işlem geçmişine "sitedeki
  rezervasyonla çakışmasına rağmen" diye düşer.
- **Geçerli rezervasyon:** sitenin, iptal edilmemiş, ödeme sayfası açık bekleyen tutma değil, süresi dolup düşmemiş ya
  da iade edilmemiş, panelde "bitti" denmemiş (onay bekleyen kasada ödemeli talep ve ödenmiş rezervasyon geçerlidir).
  Uç uca gelen saatler (20:00'de biten, 20:00'de başlayan) çakışmaz. Uzatmada yalnız eklenen süre (şimdiki bitişten
  yeni bitişe) bakılır, uzatılan oturumun kendisi sayılmaz.
- Panelde ileri bir saate oturum planlanmaz (sayaç hep şimdi başlar); geri açma (yanlışlıkla bitirilen oturum) süreyi
  değiştirmediği için sormaz.

Kural tek yerde: `src/lib/karaoke/overlap.ts` (ekran ve sunucu eylemi aynı fonksiyonu çağırır;
`tests/karaoke-cakisma.test.ts`).

### Sayacı silmek, bitirmek, geri açmak

Denetim E-15 ve E-65 (28 Ekim 2026). Oturumun bittiği an doluluğu kısaltır, silinen sayaç karaoke geçmişinden,
doluluktan ve aylık özetten çıkar: ikisi de iz bırakır.

- **Bitirmek:** **Erken bitir**, **Haber verdim** (süre dolunca) ve zildeki susturma oturumu bitti işaretler (kim ve
  ne zaman) ve İşlem geçmişine "Karaoke oturumu bitirildi" yazar: "Selin · 24 Eki 21:00–23:00 · bitirildi 21:30 (1 saat
  30 dk erken)" ya da "… · süre dolunca haber verildi 23:07". İkinci cihazın basışı bir şey yapmaz.
- **Geri açmak** (bugünün listesindeki **Geri aç**, yanlışlıkla bitirilen oturum): kimin bitirdiği silinmeden önce
  okunur ve İşlem geçmişine "Karaoke oturumu yeniden açıldı · … · Ayşe bitirmişti (21:30)" diye yazılır. İptal edilmiş
  (iade edilen, ödemesi düşen) ve süresi dolmuş oturum açılmaz ("İptal edilmiş oturum yeniden açılamaz", "Süresi dolmuş
  oturum yeniden açılamaz"; açılsa süre doldu alarmı çalardı). Bitmiş oturumu **uzatmak** da onu açar: uzatmanın izine
  "Ayşe bitirmişti (21:30), yeniden açıldı" eklenir.
- **Sayacı silmek** (yalnız panelden açılan sayaç; sitenin rezervasyonu sitede yönetilir): yönetici her zaman siler.
  Personel açılışından sonraki **ilk 10 dakikada** çöp kutusuyla siler (yanlış açılan sayaç); sonrasında satırda
  **Silinmesini iste** durur: neden zorunlu (3-300 karakter), sayaç onaya kadar listede kalır ve sayar. İstek
  `staff_requests`'e `karaoke-sil` türüyle gider ([ONAYLAR.md](ONAYLAR.md)); satırda "Ayşe silinmesini istedi" (isteyene
  "Silinmesi onay bekliyor" ve **İsteği geri çek**; "Geri aç"tan ayrı okunsun diye iki kelime), yöneticide rozet
  Onaylar'daki karta götürür. Ekran onay penceresi açıkken 10 dakika dolarsa sunucu silmez, nedeni soran pencere açılır.
- **Onaylar › Karaoke:** sayacın adı, saati (uzatmalar dahil), kişi sayısı, kimin açtığı, bugünkü durumu ("Sürüyor · 40 dk
  kaldı", "Bitti 22:40 (Mehmet)"), istekten sonra ne değiştiği ("İstekten sonra 30 dk uzatıldı"), isteyen ve neden.
  **Onayla ve sil** sayacı siler, **Reddet** dokunmaz (not personele görünür); sayaç arada silindiyse tek düğme **Kapat**
  ("Sayaç zaten silinmişti"). Yöneticinin doğrudan silmesi ve onay aynı sayacın öteki bekleyen isteklerini "Sayaç
  silindi" diye kapatır.
- **Zil:** yöneticide "1 karaoke sayacı silme isteği onay bekliyor" (ilk karta), personelde sonuç ("Silme onaylandı:
  karaoke sayacı 24 Eki 21:00–23:00", Karaoke ekranına). Bugün'ün Onaylar satırı ve sabah e-postasının Onay bekleyenler
  kutusu da sayar. İstek başlığı ("Karaoke sayacı silme · 24 Eki 21:00–23:00") ve yükü adsızdır: etiket (misafirin adı
  olabilir) oturumdan okunur, 3 × 366 günlük temizlik onu boşaltır, istek tutmaz. Tutar hiçbir yerde yok.
- **İşlem geçmişi:** "Karaoke sayacı silindi", "Karaoke sayacının silinmesi istendi" (neden), "… onaylandı", "…
  reddedildi", "Karaoke sayacı silme isteği kapandı", "Karaoke sayacı silme isteği geri çekildi". Her biri yazımla
  aynı işlemde (iz ve yazım birlikte kalır ya da ikisi birden düşer).
- **Kilit sırası** onay kuyruğununki: önce oturum satırı (FOR UPDATE), sonra istek; personelin isteği, yöneticinin
  doğrudan silmesi ve onay aynı sırayla kilitler. Bar ekranı istekleri canlı uçtan alır (`deleteAsks`); istek açılınca,
  geri çekilince ve karara bağlanınca karaoke sayacı artar (ETag).
- Kurallar `src/lib/karaoke/timer-requests.ts` (saf; ekran ve sunucu aynı fonksiyonu çağırır), çekirdek
  `src/server/karaoke/timer.ts`, okuyucular `src/server/data/karaoke-requests.ts`. Migration yok: `staff_requests.kind`
  metin sütunu, tür listesi yalnız TypeScript'te.

## Elle rezervasyon ve saati kapatma (22 Kasım 2026)

Operatör: "Ladminden de girilebilsin aynı şekilde". Telefonla ya da kasada gelen grup ve köşkün kapattığı saatler
(etkinlik, bakım) bar ekranından laffogato.net'in odasının takvimine yazılır; saatler **sitede, uygulamada ve kasada
(AsilPOS) hemen dolu** görünür. Sitenin kendi panelindeki **Karaoke › Elle ekle** ile aynı iş, aynı kural (sitede
`src/lib/mobile/karaoke-desk.ts`; sözleşme laffogato `docs/PANEL-KARAOKE.md` › Elle rezervasyon ve kapalı saat).

- **Kim:** yönetici ve personel (telefonla gelen rezervasyon bara gelir). Karaoke ekranında **Bugün** kartının
  başlığındaki **Elle ekle** (site bağlantısı kuruluysa).
- **Pencere:** tür (**Rezervasyon** / **Saati kapat**), gün (bugünden 60 gün sonrasına), başlangıç (odanın saatleri:
  Doluluk › Oda saatleri, kaydedilmediyse 12:00–23:00; bugün bitmiş saat çıkmaz, başlamış ama süren saat seçilir), süre
  (kapanışı geçmez, gece yarısını geçmez: site takvim gününe yazar). Rezervasyonda ad (zorunlu), kişi, telefon ve
  e-posta (isteğe bağlı; e-posta yazılırsa misafire sitenin onay e-postası gider ve rezervasyon o üyenin hesabında
  görünür; rezervasyona bir günden fazla varsa bir gün kala panelin hatırlatma e-postası da gider, alanın ipucu hangisi
  olacağını söyler: aşağıda › Karaoke e-postaları), not. Kapatmada neden (isteğe bağlı; yalnız panellerde görünür, sitede yalnız saatler dolu görünür). Panelin
  bildiği dolu saat (sitedeki rezervasyon ya da kapatma) pencerede sarı satırla söylenir.
- **Siteye nasıl gider:** sunucu eylemi (`addDeskKaraoke`) sitenin imzalı `POST /api/panel/karaoke` ucuna gönderir
  (GET'le aynı imza, gövdenin tam metni üzerinden; `src/server/karaoke/desk.ts`). Site saatleri yazar, panele her
  zamanki pingi atar; panel de başarıdan hemen sonra eşitler: satır listeye girer, karaoke sürümü (canlı ucun ETag'i)
  artar, öteki cihazlar bildirimle ya da bir sonraki kontrolde görür. Sitenin olay kaydına kişinin adı düşer ("Yönetim
  paneli · Ayşe"). Sitenin reddi (400 `invalid` alanı ve Türkçe mesajı, 409 `slot_taken`, `too_many`) adı geçen alanın
  yanında, alanı olmayan hata (bağlantı, imza, 503) pencerenin başında; kurulum ayrıntısı (anahtar adı, sitenin sürümü)
  yalnız yöneticiye, personel "Site bağlantısında sorun var; satır eklenmedi. Yöneticiye haber verin." görür. Zaman
  aşımında site yazmış olabilir: panel yine eşitler, pencere "yazılmış olabilir, listeye bakın" der.
- **Telefon panelde saklanmaz, e-posta yalnız hatırlatma gidene kadar:** telefon yalnız sitenin gövdesindedir. E-posta
  da öyle; tek ayrıcalık misafirin "bir gün kaldı" hatırlatması: rezervasyona bir günden fazla varsa adres panelde
  **şifreli** (`karaoke_reminders`, AES-256-GCM) tutulur ve e-posta gidince, rezervasyon kaldırılınca ya da iptal
  edilince silinir (aşağıda › Karaoke e-postaları). İkisi de işlem geçmişine, günlüğe ve yedeğe yazılmaz; ekrana da
  gelmez (sitenin GET'i de göndermez).
- **Listede:** elle rezervasyon "Onaylı · kasada ödenecek" ve küçük **Elle** rozetiyle (ödemesi köşkte, kartla ön
  ödeme yok); kapatma "Kapalı · 14:00–17:00 · neden". Oda kapatılan saatin içindeyse boş kart "Oda kapalı" der.
  Ödemesi alınmamış rezervasyonun rozeti **sarıdır** (yeşil yalnız sitede ödenmiş olan: "Ödendi"); oturum sürerken
  sayaç kartında "Ödemesi kasada: ücret alınmadıysa şimdi alın" durur (panel kasadaki tahsilatı bilmez, söz bu yüzden
  koşullu). Hatırlatması kurulan satırda zarf rozeti: "Hatırlatma e-postası · Yarın 20:00", gidince "Hatırlatma
  e-postası gönderildi".
- **Kaldır:** elle satırda (onay penceresiyle). Yönetici her zaman; personel satır sitede yazıldıktan sonraki **ilk 10
  dakikada** (yanlış girilen satır; sayaç silmenin kuralı), sonrasında düğme çıkmaz, sunucu "Elle eklenen satırı ilk
  10 dakikada kaldırabilirsiniz; şimdi kaldırmak için yöneticiye haber verin." der. Saatler sitede yeniden açılır;
  e-postası yazılmış rezervasyonda site misafire iptal e-postası gönderir; bekleyen hatırlatma ve misafirin paneldeki
  adresi hemen silinir. Sitede alınan (online ödenmiş) rezervasyon
  buradan kaldırılmaz (site 409 `not_desk`; iptal ve iade sitenin panelinde). Kural `deskRemoveRefusal`.
- **İşlem geçmişi:** "Karaoke elle rezervasyon eklendi" (ilk ad, kişi, gün ve saat; e-posta yazıldıysa "misafire onay
  e-postası", hatırlatma da kurulduysa "misafire onay e-postası ve bir gün kala hatırlatma"; adres yok), "Karaoke saatleri kapatıldı" (gün, saat, neden), "Karaoke elle rezervasyonu kaldırıldı",
  "Kapatılan karaoke saatleri açıldı".
- **Panelde nasıl tutulur:** migration yok. Sitenin GET satırı `desk: true` (elle) ve `block: true` (kapatma)
  taşır (ekleme; ikisi de isteğe bağlı okunur, bozuksa yok sayılır). `block` göndermeyen eski sitede kural türetilir:
  elle, ücretsiz ve notu "Kapalı" ile başlayan satır. Eşitleme ve geçmişi alma bunu `karaoke_sessions.channel`'a
  "desk" / "desk-block" olarak yazar (`sessionChannel`); ekrana `desk: "booking" | "block" | null` gider.

### Kapatılan saat ne sayılır, ne sayılmaz

Kapatma bir rezervasyon değildir, ama oda o saatlerde doludur:

| | Kapatılan saat | Elle rezervasyon |
|---|---|---|
| Ayın özeti (rezervasyon, saat, ciro, iptal), Son 30 gün | Sayılmaz (kaldırılan kapatma iptal değil) | Sayılır; ciro "kasada ödenecek" |
| Doluluk haritası, ay ay, haftalık özetin karaoke maddesi | Girmez (yükleyici ve `occSessionsOf` ayıklar) | Girer |
| Bugün (rezervasyon sayısı, "Oda dolu", sıradaki) | Girmez | Girer |
| Kapalı günün kanıtı (Kasa › kapalı gün) | Değil | Evet (her oturum gibi) |
| "Yeni karaoke rezervasyonu" zili, Web Push | Hiç (ne eklenmesi ne kaldırılması) | Çalar (ekleyen cihaz hariç: o "Rezervasyon eklendi"yi gördü; kaldırmanın "iptal edildi" zili de kaldıran cihazda çalmaz) |
| Sayaç, "Karaoke başladı", az kaldı, süre doldu, "Haber verdim" | Hiç (evresi hep `closed`; uzatılmaz, bitirilmez) | Saatinde kendiliğinden (aşağıda) |
| Hızlı sayaç ve uzatmanın çakışma sorusu | Evet, kendi sözüyle: "Bu saatler kapatıldı: 14:00–17:00 (özel etkinlik). Yine de başlatılsın mı?" (başlık "Bu saatler kapalı") | Evet ("Bu saatte sitede Ayşe adına …") |

### Sayaç saatinde kendiliğinden başlar, bitişte öter

Operatör, 22 Kasım 2026: "karaoke saatinde ladminde otomatik süre başlasın ve bitince de ötsün" ve "Kendiliğinden
karaoke rez saatinde başlamıyordu". Sitedeki her geçerli rezervasyon (elle eklenen dahil) hiçbir düğmeye basmadan
açık her panel sekmesinde aynı yoldan geçer (`alert-center.tsx`, `alarmPlan`, `phase`, `isPlayable`): saatinde kısa
ses, "Karaoke başladı" ve sayaç; bitime az kala uyarı; bitişte alarm döngüsü ve kırmızı şerit, **Haber verdim**'e
kadar. Başlamamasının nedenleri bulunup giderildi:

1. **Karaoke uyarıları yöneticide varsayılan kapalıydı** (cihaz tercihi `karaokeAlarms`): yönetici hesabıyla açık bar
   tableti ya da telefonu saatinde hiç başlatmıyor, ötmüyordu. Artık **iki rolde varsayılan açık**; cihaz kendi
   **Bu cihazda uyarılar › Karaoke alarmları bu cihazda** anahtarından kapatabilir. Saklanan kayıt sürümlüdür (`v: 2`):
   eski (sürümsüz) bir yönetici kaydındaki "kapalı" eski varsayılandan ayırt edilemediği için (kayıt her tercihte bütün
   tercihleri yazar; hoparlör seçen bar bilgisayarı da yazmıştı) açık sayılır; bundan sonra seçilen her değer korunur.
   Yan etkisi: bildirim izni olmayan yönetici cihazı da artık bir "zil cihazı"dır, sekme arka plandayken 10 dakikada
   bir sorar (Neon kotası; bildirimleri açan cihaz sormaz).
2. **Cihaz çalmayacaksa ekran söylemiyordu:** uyarılar kapalı cihazda Karaoke ekranında (başka ekranda oturum
   sürerken ya da bir saat içinde başlayacakken) sayfanın başında "Bu cihazda karaoke uyarıları kapalı · Saat gelince
   ses ve alarm çalmaz." ve **Aç**. Açılınca satır o sayfada "açık" olarak kalır (içerik kaymaz); "Sesli uyarılar
   kapalı" satırı ayrıca kalır.
3. **Geç öğrenilen başlangıç duyurulmuyordu:** plan bir dakikadan eski başlangıcı atıyordu; saatinden sonra cihaza
   ulaşan rezervasyon (geç eşitleme, arka plandaki sekme, uykudan uyanan cihaz, o saate elle eklenen rezervasyon) hiç
   "Karaoke başladı" demiyordu. Artık son **15 dakikada** başlamış ve süren oturum cihaz başına bir kez hemen duyurulur
   (anahtar zamanındakiyle aynı); bitmiş, süresi dolmuş ya da daha eski başlangıç duyurulmaz. Saatinden sonra yazılan
   rezervasyonda 15 dakika **yazıldığı andan** sayılır (`bookedAt`): 16:40'ta 16:00'ya elle eklenen rezervasyon da
   "Karaoke başladı" der (e2e, 22 Kasım 2026: yalnız saatin ilk 15 dakikasında eklenen duyuruluyordu).
4. **12 saatten ilerideki oturumun uyarıları kurulmuyordu:** plan 12 saat ilerisine bakar ve yalnız veri değişince
   yeniden kurulurdu; sabah açılan bar ekranı akşamki rezervasyonu (13 saat sonra) veri değişmedikçe (304) hiç
   planlamazdı. Plan artık **dakikada bir** yeniden kurulur (aynı uyarı anahtarıyla iki kez çalmaz); uykudan uyanan
   cihazın kaçan zamanlayıcısı da böyle yenilenir.

Canlı veri yolu (`/api/canli`, `liveWindow`, ETag) gözden geçirildi: pencere 12 saat öncesinden yarının sonuna (Türkiye)
kadar, ETag sürümü ve takvim gününü taşır (gece yarısı kendiliğinden ilerler), 23:00–24:00 rezervasyonu gece yarısından
sonra da pencerede ve listede kalır; eşitleme satırı sitenin kimliğiyle yerinde günceller (oturum kimliği değişmez).
Testler `tests/karaoke-elle.test.ts`.

## Karaoke e-postaları (22 Kasım 2026)

Operatör: "elle karaoke eklediğimizde kişinin mailine 1 gün kalan mail hatırlatması girsin, bu maili de güzel tasarla",
"çalışanlara da mail gitsin aynı gün 3 saat öncesinde ve aynı gün sabahı" ve "bizim elemanlara para ödenmediği de göze
çarpsın ki alsınlar, önden almaları gerektiğini de söyle".

| E-posta | Kime | Ne zaman | İçinde |
|---|---|---|---|
| **Bir gün kaldı** | Misafire (Elle ekle'de yazılan adres) | Rezervasyondan 24 saat önce, bir kez | "Yarın görüşüyoruz, Ayşe!", gün ve saat, süre, kişi, "Ödeme kafede", **Takvime ekle** |
| **Bugünün karaokeleri** | O gün vardiyadaki personele | Rezervasyon günü sabah (08:00–12:00 arası ilk tetikleyici), günde bir kez | O günün rezervasyonları saat sırasıyla; ödemesi alınmamışlar kırmızı kutuda |
| **3 saat kala** | O gün vardiyadaki personele | Her rezervasyondan 3 saat önce | O rezervasyon; ödemesi alınmadıysa konu ve en üstteki kırmızı kutu söyler |

### Misafire: bir gün kala hatırlatma

- **Ne zaman kurulur:** Elle ekle'de e-posta yazıldıysa ve rezervasyona **bir günden fazla** varsa. Daha yakın
  rezervasyonda sitenin onay e-postası zaten son 24 saatte gitmiştir; ikinci e-posta gönderilmez (alanın ipucu ve
  eklemenin bildirimi hangisinin olduğunu söyler). Sitede (uygulamadan, webden) alınan rezervasyonun adresi panele hiç
  gelmediği için bu hatırlatma yalnız panelden elle eklenenlere gider; sitenin kendi panelinden elle eklenene de gitmez.
- **Ne zaman gider:** başlangıçtan 24 saat önce (20:00 rezervasyonuna bir gün önce 20:00'de). Saat her çalışmada panelin
  kopyasından okunur: sitede saati değişen rezervasyonun hatırlatması yeni saate göre gider. Tetikleyiciler saatlerce
  çalışmadıysa geç de gider, söz gönderildiği güne göre değişir ("Bugün görüşüyoruz"); rezervasyona 2 saatten az
  kaldıysa artık gönderilmez.
- **Gitmez:** rezervasyon panelden kaldırıldıysa (satır hemen silinir), sitede iptal edildiyse (gönderimden önce kopya
  10 dakikadan eskiyse site yeniden sorulur), kapatılan saatse, kopyada bir gün boyunca hiç görünmediyse.
- **Bir kez:** gönderim satırı sahiplenerek yapılır (iki tetikleyici aynı anda çalışsa da tek ileti); Resend'e
  rezervasyonun kimliği ve saatinden türeyen aynı anahtarla gider (yanıtı gelmeyen deneme 10 dakika sonra yinelenirse
  ikinci ileti çıkmaz). Kesin reddedilen e-posta en çok 5 kez denenir.
- **Görünüm:** misafire giden tek e-posta olduğu için kendi tasarımı var (`karaoke-reminder-template.ts`): üstte
  yeşil bantta L'Af logosu, "bilet" kartında saat, gün ve adres, altında üç kısa bilgi (süre saatinde başlar, ödeme kafede /
  ödemeniz alındı, planınız değiştiyse haber verin), **Takvime ekle** (Google Takvim), yol tarifi, telefon ve laffogato.net. Logo, renkler (derin yeşil, altın), adres ve
  telefon sitenin e-postalarındakiyle aynı (laffogato `public/email/laf-mark-white.png`, `src/lib/seo/site.ts`; adres ya
  da telefon değişirse `VENUE` de güncellenir). Tek resim logodur (engellenirse yerinde "L'Affogato" yazar), tutar yok, tanıtım yok (yalnız rezervasyonun bilgisi: ticari ileti değil, İYS izni
  gerekmez). Gönderen: panelin gönderen adresi, görünen ad "L'Affogato" (`guestFrom`).
- **Adres:** `karaoke_reminders.email_sealed`'da AES-256-GCM ile şifreli (anahtar `AUTH_SECRET`'tan, amaç
  "karaoke-reminder"). Gönderilince, vazgeçilince ya da gönderilemeyince **silinir**; satır yalnız sonucuyla 3 gün
  kalır (ekrandaki "gönderildi" rozeti için), sonra o da silinir. Bildirim günlüğüne alıcı olarak "misafir (adres
  saklanmaz)" yazılır. Tablo yedeğe girmez. Ayarlar'daki "e-posta hatırlatmaları" anahtarı bu e-postayı kapatmaz
  (misafire verilen söz; kapatmak için e-posta alanı boş bırakılır).

### Personele: sabah ve 3 saat kala

- **Hangi rezervasyonlar:** sitede geçerli her rezervasyon (elle eklenen dahil): iptal, ödeme sayfasındaki tutma, iade,
  panelde "bitti" denen ve kapatılan saat değil (`expectsGuests`; çakışma uyarısının kuralı).
- **Ödeme alınmadıysa göze çarpar:** sitede ödenmemiş rezervasyon (elle eklenen, "kasada ödenecek", onay bekleyen)
  konuda "ÖDEME ALINACAK" der; gövdenin en üstünde kırmızı kutu: "ÖDEME ALINMADI" ve "Ücreti misafir odaya girmeden
  ÖNCE, kasada alın."; satırı kırmızı zeminli ve aynı cümleyi yineler. Sitede ödenen "Ödendi (sitede)" (yeşil). Tutar
  hiçbir yerde yazmaz (personel tutar görmez; ücret kasada).
- **Ad:** konu ve ön izleme misafirin adını taşımaz (telefonun kilit ekranında görünür); ad ve not yalnız gövdede.
- **Kime:** o gün [Vardiya planında](VARDIYA.md) karaokenin şubesinde (karaoke özelliği açık şube, sahibin varsayılanı
  Tuzla; [SUBE.md › Şube özellikleri](SUBE.md#şube-özellikleri-25-kasım-2026)) çalışan olarak yazılmış, hesabı etkin herkes
  (vardiyaya yazılan yönetici dahil). O gün için plan yoksa (ya da plandakilerin hesabı yoksa) o şubenin bütün etkin
  personeli ve şubesi boş personel. Karaoke hiçbir şubede açık değilse e-posta gitmez. Her kişiye kendi adresine ayrı
  e-posta.
- **Sabah listesi** 08:00–12:00 arasında gider; o saatlerde ilk rezervasyon eklenirse o an gider. Öğleden sonra eklenen
  ilk rezervasyon liste doğurmaz, yalnız "3 saat kala"sı gider.
- **3 saat kala:** başlangıca 3 saatten az, 30 dakikadan çok kaldıysa (tetikleyici geç çalışırsa konu gerçek süreyi
  yazar: "Karaoke 20:00 (1 saat 20 dk sonra)"). Sabah listesi aynı çalışmada gidiyorsa listedeki rezervasyonun 3 saat
  kalası ayrıca gitmez. Saati değişen rezervasyon yeni saatin 3 saat öncesinde yeniden bildirilir.
- **Bir kez:** her e-postanın anahtarı gönderimden önce `notification_log`'a yazılır (`karaoke-personel-sabah:<gün>`,
  `karaoke-personel-3saat:<oturum>:<saat>`); kimseye kesin olarak gidemeyen e-postanın anahtarı bırakılır, sonraki
  tetikleyici yeniden dener. Ayarlar'daki **e-posta hatırlatmaları** kapalıysa ya da Resend kurulu değilse gitmez.

### Tetikleyiciler

Üçü de aynı işi çağırır (`runKaraokeMails`), e-posta bir kez gider:

1. **Açık panel sekmesinin canlı yoklaması** (`/api/canli`, yanıttan sonra, sunucu örneği başına en çok 5 dakikada
   bir): bar ekranı açıkken e-postalar dakikasında gider.
2. **Yedek iş** (`/api/cron/kontrol`, GitHub Actions; günde dört saatte: 10:07, 14:07, 18:07, 22:07 ve yarım saat sonra
   ikinci deneme): kimse panele bakmıyorsa.
3. **Sabah işi** (`/api/cron/gunluk`, 08:00–09:00): karaoke eşitlemesinden hemen sonra; sabah listesinin güvencesi.
   Gönderilemeyen e-posta adımın sonucunu bozmaz, sonraki tetikleyici yeniden dener.

Karaoke odası gün içinde çalıştığı için (12:00–24:00) "bir gün kala" ve "3 saat kala" anları tetikleyicilerin çalıştığı
saatlere düşer.

## Kurulum

1. Ortak anahtarı bir kez üretin: `openssl rand -base64 48` (en az 32 karakter).
2. Vercel'de **iki projeye de** (laffogato.net ve bu panel) aynı değerle `KARAOKE_SYNC_SECRET` ekleyin
   (Settings → Environment Variables, Production; "Sensitive" işaretleyin) ve iki projeyi de yeniden yayımlayın
   (Deployments → son yayın → ⋯ → Redeploy). Sıra önemli değil: iki tarafta da tanımlanana kadar bağlantı kapalı
   kalır, bir şey bozulmaz.
   Aynı anahtar menü bağlantısını (bağlı ürünün fiyatı ve Satışta / Tükendi durumu, [SITE-MENU.md](SITE-MENU.md)),
   bar ekranındaki uygulama siparişlerini ([SITE-SIPARIS.md](SITE-SIPARIS.md)) ve online satışları
   ([SITE-SATIS.md](SITE-SATIS.md)) da açar. Dördünün durumu tek yerde: **Ayarlar › laffogato.net**.
3. İsteğe bağlı: `LAFFOGATO_URL` (boşsa `https://laffogato.net`); sitede `PANEL_URL` (boşsa
   `https://ladmin.laffogato.net`). Bildirim anahtarları (VAPID) ilk kullanımda üretilip veritabanında şifreli
   saklanır; isterseniz `VAPID_PUBLIC_KEY` ve `VAPID_PRIVATE_KEY` ile sabitlenir.
4. Yönetici olarak **Karaoke** ekranını açın: "laffogato.net bağlantısı" kartı **Bağlı** göstermeli (kartta
   **laffogato.net paneli ↗**: sitenin yönetim paneli, yeni sekmede).
5. Kasadaki cihazda personel hesabıyla **Karaoke**'yi açın ve **Bu cihazda uyarılar** kartından:
   - **Bildirimleri aç** (Chrome izin sorar): sekme arka plandayken ya da kapalıyken de bildirim gelir. Bildirim
     yokken arka plandaki sekmede zil 10 dakikaya kadar gecikebilir, öndeki ekran da 20 saniyede bir sorar (veritabanı
     uyumaz); **Sipariş bildirimleri** ve **Karaoke bildirimleri** açık kalsın;
   - ekrana bir kez dokunun (tarayıcı ilk dokunuştan önce ses çaldırmaz; gerekirse sağ altta "Sesli uyarılar için
     dokunun" düğmesi çıkar);
   - **Ekran açık kalsın**'ı açın (personelde varsayılan açık);
   - **Uyarı sesleri**'nden bilgisayarın kendi hoparlörünü seçin (aşağıda).
   iPhone / iPad'de bildirim için paneli Paylaş › **Ana Ekrana Ekle** ile uygulama gibi açın.

### Müzik Bluetooth hoparlördeyken uyarılar bilgisayardan

Karaoke müziği Bluetooth hoparlörden çalarken zil ve alarm müziğe karışmasın, bilgisayarın kendi hoparlöründen yüksek
sesle gelsin diye:

1. **Bu cihazda uyarılar › Uyarı sesleri › Hoparlörleri göster.** Chrome hoparlörlerin adını ancak
   mikrofon izniyle gösterir: izin penceresinde **Her ziyarette izin ver**'i seçin. Mikrofon kullanılmaz, açılan akış
   hemen kapatılır (izin yalnız panel sayfalarında ve yalnız bu site için açık).
2. Listeden bilgisayarın hoparlörünü seçin (ör. "Hoparlör (Realtek(R) Audio)", "MacBook Pro Hoparlörleri";
   "Bu bilgisayarın hoparlörü" diye işaretlenir, Bluetooth olanlar "Bluetooth" diye). Seçince deneme sesi o hoparlörden
   çalar. Seçim bu cihazda saklanır; hoparlör takılıp çıkınca yeniden uygulanır. Bulunamazsa "Yalnız bu bilgisayardan
   çalsın" açıksa ses susar (genel hoparlöre geçmez), kapalıysa varsayılan çıkıştan gelir; iki durumda da kartta uyarı
   çıkar (docs/BILDIRIMLER.md › Uyarı sesleri yalnız bu bilgisayardan).
3. Bilgisayar hoparlörünün ses düzeyini yüksek tutun. Windows'ta her hoparlörün düzeyi ayrıdır (Ayarlar › Sistem ›
   Ses › bilgisayar hoparlörü › ses düzeyi); Bluetooth'taki müziğin düzeyi bundan etkilenmez. Uyarı sesleri zaten
   tavana yakın ve parlak (1–3 kHz) üretilir; bir sınırlayıcı cızırdamayı önler.

Sekme açıkken sesi sekme kendisi çalar ve sistem bildirimi **sessiz** gelir (işletim sisteminin bildirim sesi
varsayılan çıkıştan, yani Bluetooth hoparlörden çalardı). Panel hiç açık değilken gelen bildirim sistemin sesini
kullanır; bunu da kapatmak için Windows'ta Ayarlar › Sistem › Bildirimler › Google Chrome › "Bildirim geldiğinde ses
çal"ı kapatın.

Hoparlör seçimi Chrome ve Edge'de çalışır (Safari ve iPhone'da seçilemez). Bilgisayarda mikrofon yoksa Chrome
hoparlör adlarını gösteremez; o durumda Windows'ta Ayarlar › Sistem › Ses › **Ses karıştırıcı**'dan (Windows 10'da
"Uygulama ses düzeyi ve cihaz tercihleri") Chrome'un çıkışını bilgisayar hoparlörü yapın (müzik başka bir uygulamadan
çalıyorsa).

Karaoke alarmları 22 Kasım 2026'dan beri iki rolde varsayılan **açıktır** (yönetici hesabıyla açık bar ekranı da
saatinde başlatır ve öter); istemeyen kendi cihazında kapatır, ekran kapalı olduğunu söyler (yukarıda › Sayaç saatinde
kendiliğinden başlar).

## Güvenlik

- Ping ve çekme HMAC-SHA256 ile imzalıdır: `x-laf-timestamp` (unix saniye) ve `x-laf-signature: v1=<hex>`.
  İmzalanan metin satır satır zaman, yöntem, yol, sıralanmış sorgu ve gövdenin SHA-256'sı; alan adı girmez. Saat
  farkı en çok 5 dakika, karşılaştırma sabit süreli. Kurallar `src/lib/karaoke/signature.ts`'te; sitenin kopyası
  (`src/lib/panel/karaoke-sync-core.ts`) ile iki depodaki testler aynı iki imza vektörünü sabitler.
- İmzasız ya da yanlış istek yalnız `401` alır; anahtar tanımlı değilse uç `503` döner.
- Siteden yalnız ad (soyad değil), gün, saat, kişi sayısı, durum, ödeme durumu, not, tutar, kanal, rezervasyonun
  yapıldığı an ve iptalde iade tutarı gelir; geçmişten alınanlar ad ve not olmadan saklanır. Panelde sitenin yanıtı ayrıca doğrulanır: bozuk
  satır atlanır, metinler kısaltılır. Atlanan satır "sitede silinmiş" sayılmaz: paneldeki kopyası olduğu gibi kalır
  (kimliği de okunamayan bir satır varsa o çekmede hiçbir satır silinmez; `goneSiteRows`, denetim 21 Kasım #33). Elle
  eşitlemenin bildirimi okunamayan satır sayısını da yazar.
- **Personel tutar görmez:** canlı veri ve sayfa, personele tutarı ve iade tutarını hiç göndermez (`toSessionDTO`);
  iadenin yalnız türü ("iade yok", "kısmi", "tamamı") gider.
- Web Push içeriği uçtan uca şifrelidir (RFC 8291, aes128gcm), VAPID imzalıdır (RFC 8292). Abonelik yalnız bilinen
  push servislerine (Google, Mozilla, Apple, Microsoft) kaydedilir; çıkışta cihazın aboneliği silinir, parola ya da
  rol değişince (oturum sürümü) eski cihazlara bildirim gitmez.
- **Bildirimde misafirin adı yok:** bildirim kilit ekranında ve bildirim merkezinde herkese görünür; gövdesi gün,
  saat, kişi sayısı ve "onay bekliyor"dur ("Yeni karaoke rezervasyonu" · "Bugün 20:00–22:00 · 4 kişi · onay
  bekliyor"; üçten fazla olayın özetinde de ad yok). Sekme arkadayken sayacın kendi sistem bildirimleri de adsızdır:
  "Karaoke başladı" (kişi sayısı ve saat), "Karaokede 10 dakika kaldı" (bitiş saati), "Karaokede süre doldu"
  (`src/components/panel/live/alert-center.tsx` › `fire`). Ad yalnız açık panel ekranında görünür: zil satırı ("… ·
  4 kişi · Ayşe · onay bekliyor"), sayacın ekran içi uyarısı ("Karaoke başladı: Ayşe", "10 dakika kaldı: Ayşe") ve
  liste, hepsi canlı veriden (`pushMessages` ve `eventMessage`, `src/lib/karaoke/session.ts`; `tests/karaoke.test.ts`
  her sistem bildirimini tarar, `tests/karaoke-bildirim-db.test.ts`). Uygulama siparişinin bildiriminde de ad yok
  ([SITE-SIPARIS.md](SITE-SIPARIS.md)).
- Service worker yalnız bildirim işi yapar: sayfa önbelleklemez, istek yakalamaz.

### KVKK

- Karaoke oturum kayıtlarındaki misafir adı ve not, sitenin kuralıyla (laffogato #196) **3 × 366 gün** sonra silinir:
  sabah işinin karaoke adımı, günü (Türkiye) bundan eski oturumların `customer_name` ve `note`'unu boşaltır (iki
  kaynak da: rezervasyonsuz sayacın etiketi de bir ad olabilir). Satır istatistik için kalır
  (`src/server/karaoke/history.ts` `clearOldKaraokePersonalData`).
- İşlem geçmişi (`activity_log`) bu temizliğe girmez: "Karaoke sayacı başlatıldı", "Karaoke sayacı silindi",
  "Karaoke süresi uzatıldı", "Karaoke oturumu bitirildi" ve "Karaoke oturumu yeniden açıldı" satırları misafirin adını ya
  da sayacın etiketini taşır ve 3 × 366 günden sonra da kalır (işlem geçmişinin saklama süresi yok). Sayaç silme
  isteğinin başlığı ve yükü adı taşımaz.
- Geçmişten alınan rezervasyonlar (Doluluk › Geçmişi siteden al) ad ve not olmadan saklanır.
- **Misafirin e-posta adresi** panelde yalnız "bir gün kaldı" hatırlatması için, şifreli ve en çok rezervasyon gününe
  kadar durur (`karaoke_reminders`; yukarıda › Karaoke e-postaları): e-posta gidince, rezervasyon kaldırılınca ya da iptal
  edilince silinir; yedeğe, günlüğe, işlem geçmişine ve bildirim günlüğüne yazılmaz. Amaç yalnız misafirin kendi
  rezervasyonunu hatırlatmak (tanıtım yok). Personel e-postalarında misafirin yalnız ilk adı ve notu gövdede geçer
  (panel ekranındaki bilgi); konuda ve ön izlemede geçmez.

## Doluluk haritası (yönetici)

Ekran: **Karaoke doluluğu** (`/panel/karaoke/doluluk`): Karaoke ekranındaki "Bu ay" kartının **Doluluk haritası**
düğmesi ya da ⌘K. Yalnız yönetici: personel bu adresi açamaz (`ADMIN_ONLY_PATHS`, `src/lib/roles.ts`), tutar
personele hiç gitmez. Oda hangi gün ve saatte dolu, hangisinde boş:

| Gösterge | Hesap |
|----------|-------|
| Doluluk | Odanın dolu olduğu süre ÷ oda saatlerindeki açık süre. Dolu: başlangıçtan bitişe, uzatma dahil; erken bitirilen oturum bittiği anda boşalır, süre dolduktan sonraki "Haber verdim" uzatmaz. İptal, ödenmemiş tutma, süresi dolan ödeme ve iade (sürerken de) odayı tutmaz; kasada ödenecek onay bekleyen talep ve rezervasyonsuz sayaç tutar. Rozet: hemen önceki aynı uzunluktaki döneme göre puan farkı; yalnız iki dönem de verinin başladığı günden sonraysa ve rezervasyonsuz sayacın başladığı güne göre aynı taraftaysa (verisiz günlerle ya da yalnız site rezervasyonlarının sayıldığı günlerle kıyas yanıltırdı) |
| Saat başına gelir | Sitede ödenmiş ya da kasada ödenecek rezervasyon ücretleri (KDV dahil) ÷ o rezervasyonların kullanılan saatleri: uzatma eklenmez (parası kasada alınır), erken bitirilen rezervasyon kullandığı saate bölünür, dönem sınırındaki oturum ücretinin payıyla girer. Alt satır: açık saat başına (ücretler ÷ oda saatleri; fiyatla doluluğu birlikte gösterir). Kasadaki karaoke (uzatma, rezervasyonsuz oturum) ve odadaki siparişler oturuma bağlanamadığı için girmez |
| Uzatma | +15 / +30 dk ile uzatılan oturumlar ÷ oturumlar (rezervasyonlu ve rezervasyonsuz); uzatılanların ortalama ek süresi |
| Son dakika iptal | Başlangıçtan önceki 24 saat içinde ya da sonra iptal edilen rezervasyonlar ÷ rezervasyonlar (iptaller dahil; ödeme sayfasında süresi dolan tutma rezervasyon değil). Anı bilinmeyen iptal ayrı sayılır, "son dakika" sayılmaz |
| Kaç gün önceden | Sitede rezervasyonun yapıldığı gün ile oturumun iş günü arasındaki fark: ortalama, ortanca ("yarısı en çok 2 gün önceden"), aynı gün payı. Rezervasyonsuz oturumlar girmez |

- **Dönem:** son 4 hafta (varsayılan), son 12 hafta ya da takvim ayı. Bugün hiç sayılmaz (yarım kalan akşam her
  karşılaştırmayı kötü gösterirdi); içinde bulunulan ay dünkü güne kadar. Sayılar dönemde başlayan oturumlardan,
  dakikalar döneme kırpılarak.
- **Izgara:** satırlar haftanın günü, sütunlar saat (telefonda tersi: satırlar saat, sütunlar gün; yatay kaydırma
  yok). İş günü kasa gibi 05:00'te döner: gece 00:30'daki oturum önceki günün satırında. Hücre: o gün ve saatte dolu
  süre ÷ açık süre (dönemde o günden kaç tane varsa × 60 dk). Oda tektir: aynı anda iki oturum (çoğunlukla
  rezervasyonlu grup için ayrıca açılan sayaç) bir kez sayılır, fazlası dipnotta. Oda saatleri dışındaki dolu dakikalar
  orana girmez; taralı hücrede noktayla ve dipnotta görünür. Renk tek (mürekkep), açıktan koyuya beş basamak; rakam
  hücrede (boş hücre yazısız), seçilen hücrenin ayrıntısı altta (telefonda alt menünün üstünde asılı).
- **Öne çıkanlar:** en az 14 gün ve 8 oturumla: en boş blok (1–4 gün × 2–4 saat) ve en dolu blok (1–3 gün × 2–3 saat;
  %50'den azsa yok) ya da son dakika iptal yüksekse (%15 ve en az 3) onun satırı.
- **Ay ay:** son 6 ay, ilk veri ayından eskiye gitmez. ¹: ay ilk rezervasyonsuz sayaçtan önce başlıyor, o aylarda yalnız
  site rezervasyonları var. Doluluk farkı bir eski aya göre, rozetteki kuralla (aynı verinin sayıldığı aylar arasında).
- **Oda saatleri:** varsayılan her gün 12:00–24:00 (laffogato.net'teki karaoke saatleri: ilk rezervasyon 12:00, son
  başlangıç 23:00); ekranın altındaki Veri ve ayarlar › Değiştir.
  Kapanış gece yarısını geçebilir (en geç 05:00). Değişiklik geçmiş aylara da uygulanır, işlem geçmişine düşer
  (`integration_state` › `karaoke.hours`).
- **Geçmişi siteden al:** panelin karaoke bağlantısı 21 Ekim 2026'da kuruldu; öncesi için düğme sitenin aynı imzalı
  ucunu (`GET /api/panel/karaoke?from&to`; site geçmiş tarihleri de verir, istek başına en çok 400 gün) Ocak 2026'dan
  bugünden iki gün öncesine kadar takvim ayı ay ay, en yeniden okur. En çok 45 sn sürer; yetmezse **Devam et**
  kaldığı aydan sürer, **Yeniden al** hepsini baştan okur (geç gelen iade ve iptaller de gelir). Almanın son günü ilk
  okunan ayla birlikte kaydedilir: hiç ay alınamadan düşen deneme günler sonra yeniden basılınca bugüne göre başlar,
  ilk ayında düşen Yeniden al alınmış geçmişi yarım göstermez. Yeni satır ad ve not olmadan yazılır; var olan
  satırın yalnız rezervasyon alanları değişir (ad, not, sayaç ve zil alanları değişmez); satır silinmez, zil çalmaz,
  düzenli eşitlemenin durumuna dokunulmaz; düzenli eşitlemeyle aynı kilitle yazılır.
  429'da sitenin `Retry-After`'ına uyulur (en çok 10 sn, bir kez). Durum: `integration_state` › `karaoke_history`.
- **İptal anı:** site iptal anını saklamıyor. Eşitleme iptale geçişi görünce sitenin son değişikliğini (`updatedAt`;
  ping saniyeler içinde gelir) `cancelled_at`'e yazar; yeniden açılan rezervasyonda boşalır. Sütundan önceki iptallerde
  iptal zilinin anı kullanılır. Geçmişten alınan iptallerin çoğunun anı bilinmez ("zamanı bilinmiyor"; ödemesiz
  iptalde sitenin son değişikliği kullanılır), eski ayların son dakika oranı bu yüzden alt sınırdır. Site
  `cancelledAt` gönderirse (isteğe bağlı) o kullanılır.
- **Henüz yapılamayanlar:** gelmeyenler ("Gelmedi" düğmesi yok; personel **Erken bitir**'e basarsa oda o andan boş
  sayılır, basılmazsa rezervasyonun süresi dolu sayılır), odadaki siparişler (uygulama siparişi bar ekranına "Masa"
  olarak gelir, odaya ait olduğu ayrılmıyor ve panel sipariş geçmişi tutmuyor), kasadaki karaoke parası (oturuma
  bağlı değil; AsilPOS'a geçildikten sonra kasanın karaoke satırları günlük gelir, `pos_daily_sales`, ama doluluk
  onları okumaz: oturumla eşleştirmek ayrı bir iş, docs/ASILPOS.md). Oda tek kabul edilir (site oda bilgisi göndermez);
  hesap oda sayısını parametre alır.

## Sorun giderme

"laffogato.net bağlantısı" kartındaki **Hata** açıklamaları. Bu açıklamaları yalnız yönetici görür (bağlantı kartı, bar
ekranının sarı satırı, Eşitle); personel yöneticiye haber vermesini söyleyen kısa sözü görür. Canlı uç (`/api/canli`)
de hatanın metnini yalnız yöneticiye gönderir; personelin yanıtında "Site bağlantısında sorun var; yöneticiye haber
verin." yazar (denetim E-64, `src/lib/staff-errors.ts`).

| Mesaj | Ne yapılır |
|-------|------------|
| Site isteği reddetti (imza) | İki projedeki `KARAOKE_SYNC_SECRET` aynı mı? İkisi de yeniden yayımlandı mı? |
| Sitede KARAOKE_SYNC_SECRET tanımlı değil | Siteye değişkeni ekleyip yeniden yayımlayın (site 503 `not_configured` dedi) |
| Sitenin veritabanı şu an okunamıyor | Geçici (site 503 `unavailable`); açık bir panel ekranı oldukça panel iki dakikada bir kendisi yeniden dener |
| Sitede bağlantı kapalı ya da sitenin veritabanı okunamadı | 503 ama neden yazılmamış: önce biraz bekleyin, sürerse sitedeki anahtara bakın |
| Sitede panel ucu yok | laffogato.net güncel değil (karaoke bağlantısı yayımlanmamış) |
| Site 8 saniyede yanıt vermedi / Siteye ulaşılamadı | Geçici; **Şimdi eşitle** ile yeniden deneyin |
| Sitenin yanıtı okunamadı (site ile panel uyumsuz olabilir) | Site ya da panel güncel değil; iki tarafın sözleşmesini (`docs/PANEL-KARAOKE.md`) karşılaştırın |

"Sitenin son pingi" boş kalıyorsa site panele ulaşamıyor: sitedeki `PANEL_URL` ve anahtarı kontrol edin.

Ses hâlâ Bluetooth hoparlörden geliyorsa: **Uyarı sesleri** kartında uyarı var mı bakın ("izin yenilenmeli":
Hoparlörleri göster'e basıp Her ziyarette izin ver; "bağlı değil": hoparlörü yeniden seçin). **Deneme sesi** seçilen
hoparlörden çalmalı.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/app/api/karaoke/ping/route.ts` | Sitenin pingi: imza, 202, arka planda eşitleme (`src/lib/ping-work.ts`: kayıt yazılamasa da çeker, düşen çekmeyi bir kez yineler) |
| `src/server/karaoke/sync.ts` | Çekme, yazma, olay tespiti, bildirim; kopyanın tazelenmesi (`ensureKaraokeFresh`) |
| `src/lib/karaoke/desk.ts`, `src/server/karaoke/desk.ts` | Elle rezervasyon ve saati kapatma: formun ve sunucunun kuralları, sitenin POST yanıtının eşlenmesi, personelin 10 dakikalık kaldırma kuralı, metinler (saf, testli); sitenin imzalı POST'u ve ardından eşitleme |
| `src/app/panel/karaoke/desk-dialog.tsx` | Elle ekle penceresi (tür, gün, saat, süre, ad, kişi, telefon, e-posta, not / neden) |
| `src/lib/karaoke/reminder.ts`, `src/server/karaoke/reminders.ts`, `src/server/notify/karaoke-reminder-template.ts` | Misafirin "bir gün kaldı" hatırlatması: kurallar ve ekran metinleri (saf, testli); kurma, silme, gönderim (sahiplenme, adresin silinmesi); e-postanın görünümü |
| `src/lib/karaoke/staff-mail.ts`, `src/server/karaoke/staff-mail.ts`, `src/server/notify/karaoke-staff-template.ts` | Personelin sabah ve "3 saat kala" e-postaları: hangi rezervasyon, ne zaman, kime (vardiya planı), ödeme vurgusu; gönderim ve karaoke e-postalarının tek girişi (`runKaraokeMails`); görünüm |
| `src/lib/karaoke/month.ts` | Bu ayın özeti (kapatılan saat sayılmaz; saf, testli) |
| `src/lib/karaoke/freshness.ts`, `src/lib/karaoke/sync-text.ts` | Kopya ne zaman yeniden çekilir, bar ekranının uyarı satırı; çekme hatalarının metinleri (saf, testli) |
| `src/server/karaoke/extend.ts` | Uzatmanın tek yazımı (SQL'de toplar, 12 saat sınırı) |
| `src/server/site-link.ts` | Menü bağlantısıyla ortak: anahtar, sitenin adresi, imzalı istek (8 sn; [SITE-MENU.md](SITE-MENU.md)) |
| `src/server/karaoke/board.ts` | Oturumlar, sürüm sayacı (ETag), ekran verisi |
| `src/server/actions/karaoke.ts` | Hızlı sayaç, uzatma (ikisi de sitedeki rezervasyonla çakışmayı sorar), bitirme, geri açma, sayacı silme ve silme isteği, isteğin kararı (yönetici), elle eşitleme |
| `src/server/karaoke/timer.ts`, `src/lib/karaoke/timer-requests.ts`, `src/server/data/karaoke-requests.ts` | Bitirme, geri açma, sayaç silme ve `karaoke-sil` isteğinin çekirdeği (işlem geçmişi aynı işlemde, önce oturum kilidi), saf kuralları (10 dakika, geri açma reddi, metinler) ve okuyucuları (bar ekranı, zil, Onaylar kartı) |
| `src/app/panel/onaylar/karaoke-section.tsx`, `karaoke-cards.tsx` | Onaylar › Karaoke: sayaç silme istekleri |
| `src/lib/karaoke/overlap.ts` | Çakışma kuralı: odayı tutan rezervasyon, aralık kesişimi, uyarı metni (saf, testli) |
| `src/app/panel/karaoke/orders-summary.tsx` | Ekranın üstündeki açık uygulama siparişi ve masa çağrısı satırı; pano Siparişler ekranında ([SITE-SIPARIS.md](SITE-SIPARIS.md)) |
| `src/app/api/canli/route.ts` | Açık sekmenin canlı verisi (karaoke, uygulama siparişleri, kişisel hatırlatmalar; ETag / 304) |
| `src/components/panel/live/` | Uyarı motoru: canlı veri, sesler ve hoparlör seçimi, cihaz tercihleri, bildirim aboneliği |
| `src/lib/audio-output.ts` | Hoparlör listesi, kayıtlı seçimin yeniden bulunması, Bluetooth / bilgisayar hoparlörü tahmini |
| `src/server/push/` | VAPID, şifreleme, gönderim |
| `public/sw.js` | Service worker (bildirim gösterme, tıklayınca panele dönme) |
| `src/lib/karaoke/` | İmza, oturum evreleri, uyarı planı, sitenin yanıtının doğrulanması (saf, testli) |
| `src/lib/karaoke/occupancy.ts`, `occupancy-text.ts`, `history.ts` | Doluluk hesabı (dönem, ızgara, göstergeler, öne çıkanlar, ay ay), ekran metinleri, geçmişi alma ve KVKK kuralları (saf, testli) |
| `src/server/karaoke/occupancy.ts`, `history.ts` | Doluluğun verisi (ad ve not okunmaz), oda saatleri; geçmişi siteden alma, KVKK temizliği ve sabah işinin karaoke adımı |
| `src/server/actions/karaoke-doluluk.ts`, `src/app/panel/karaoke/doluluk/` | Oda saatleri ve geçmişi alma eylemleri (yalnız yönetici); Doluluk ekranı, ısı haritası, ay ay |
| `tests/karaoke.test.ts`, `tests/web-push.test.ts`, `tests/ses-cikisi.test.ts`, `tests/karaoke-cakisma.test.ts`, `tests/karaoke-doluluk.test.ts` | İmza vektörleri, olaylar, evreler, alarm planı, adsız bildirim metni (push ve sekmenin sistem bildirimleri), şifreleme, hoparlör seçimi ve sessiz bildirim, çakışma uyarısı, doluluk |
| `tests/karaoke-istek.test.ts`, `tests/karaoke-istek-db.test.ts` | Sayaç silme kipi ve isteği, bitir ve geri aç izi, okuyucuların sızıntısı, kilit sırası yarışı (`ONAY_TEST_DATABASE_URL`) |
| `tests/karaoke-elle.test.ts` | Elle rezervasyon ve saati kapatma: yanıtın eşlenmesi, `desk` / `block` (eski sitede türetme), ay özeti ve doluluktan çıkma, kapatılan saatle çakışma, personelin kaldırma kuralı, sayacın ve alarmın yolu (elle rezervasyon çalar, kapatılan saat hiç), geç başlangıç, cihazın varsayılanı |
| `tests/karaoke-hatirlatma.test.ts`, `tests/karaoke-hatirlatma-db.test.ts` | Karaoke e-postaları: kurallar, sözler, şablonlar (ödeme vurgusu, konuda ad ve tutar yok), adresin şifreli durup silinmesi, tetikleyiciler; gerçek Postgres ve Resend'in sahte ucuyla gönderim, yineleme, vardiyaya göre alıcılar (`HATIRLATMA_TEST_DATABASE_URL`) |
| `tests/karaoke-bildirim-db.test.ts` | Gerçek Postgres ve sitenin sahte ucuyla: pingle gelen yeni, iptal edilen ve saati değişen rezervasyonun bildiriminde ad ve not yok, kopyada ve canlı veride ad var (`BAGLANTI_TEST_DATABASE_URL`) |

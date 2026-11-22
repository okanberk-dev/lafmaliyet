# Kontrol listeleri (açılış ve kapanış)

Ekran: **Kontrol listeleri** (`/panel/kontrol`; yöneticinin menüsünde **Kafe** altında, personelin menüsünde üst
düzeyde ve telefonunda üst çubuktaki menüde).
Personel kafeyi açarken ve kapatırken maddeleri telefondan tek tek işaretler: buzdolabı sıcaklığını yazar, istenen
yerde fotoğraf çeker. Her madde dokunulduğu an kaydedilir. Amaç denetimde gösterilecek düzenli bir kayıttır: hangi gün,
kim, saat kaçta, hangi sıcaklık, hangi fotoğraf. Yönetici yapılmayan listeyi ve aralık dışı değeri Bugün'de, zilde ve
ertesi sabahki e-postada görür.

## 1. Listeler ve maddeler

İlk kurulumda iki liste gelir (`src/lib/checklist-seed.ts`; `db:seed` bir kez ekler, silinen liste geri gelmez):

| Liste | Saat | Maddeler |
|-------|------|----------|
| **Açılış** | 08:00 – 11:00 | 17 madde: espresso makinesi, bar buzdolabı (0–4 °C), derin dondurucu (−30 – −18 °C, isteğe bağlı), süt tarihleri, buz makinesi, dezenfeksiyon, tezgâh fotoğrafı; salon ve lavabo, salon fotoğrafı; karaoke odası (havalandırma, ses sistemi, mikrofon şarjı); gıda güvenliği (aşağıda); eksik / arıza notu (isteğe bağlı) |
| **Kapanış** | 22:00 – 02:00 | 16 madde: karaoke odası (mikrofonlar alkollü mendille, koltuk ve tablet, unutulan eşya, cihazlar kapalı, oda fotoğrafı); bar (espresso yıkaması, buhar çubuğu, açık ürünlere tarih, bar buzdolabı, bar fotoğrafı); salon ve genel (yer, lavabo, çöp, salon fotoğrafı, ışık ve kapılar); not (isteğe bağlı) |

Bu iki liste **Tuzla'nındır** (karaoke odası Tuzla'da). **Marina**'nın kendi iki listesi vardır
(`MARINA_CHECKLISTS`, sahibin listesi, 16 Kasım 2026; `db:seed` bir kez ekler, anahtar `kontrol.marina.seeded`).
Marina'da karaoke yok; karaoke maddeleri yerine teras, çikolata şelalesi ve portakal suyu makinesi var:

| Liste | Saat | Maddeler |
|-------|------|----------|
| **Marina Açılış** | 08:00 – 11:00 | 35 madde, 3 fotoğraflı: bar ve vitrin (espresso ve değirmen, ışıklar ve menü ekranları, POS ve kasa sayımı, fırın, çikolata şelalesi, portakal suyu makinesi, test kahvesi, pastalar ve tarihleri, buzdolabı 0–4 °C, dondurucu −30 – −18 °C, içecek dolapları, bar tezgâhı); salon (camlar, uzun masa, kapı camları, süpür, paspas, çöp); teras (süpür, paspas, masalar, sandalye ve minderler, ipler, kül tablaları, camlar; ısıtıcılar isteğe bağlı: hava soğuksa); kafe önü ve yangın dolabının önü; gıda güvenliği (aşağıda) |
| **Marina Kapanış** | 22:00 – 02:00 | 21 madde, 3 fotoğraflı: bar (çikolata şelalesi, portakal suyu makinesi, backflush, steam wand, değirmenin altı, lavabo ve tezgâh, kalan pastalar (kısa not: yarına kalan ya da fire), açık sütler); teras (masalar, minderler, kül tablaları); salon (paspas, çöp); kapanış (gün sonu raporu ve kasa, ısıtıcılar, klima ve ışıklar, teras ve kapı kilidi, alarm) |

**Marina'nın fotoğrafları** (sahibin isteği, 20 Kasım 2026: "Tuzla gibi"; `MARINA_OPEN_PHOTOS`, `MARINA_CLOSE_PHOTOS`):
her bölümün sonunda o bölümün fotoğrafı. Açılışta **Bar ve vitrin hazır**, **Salon hazır**, **Teras hazır**; kapanışta
**Bar ve tezgâh temiz**, **Teras kapanış hâli**, **Salon kapanış hâli**. Var olan veritabanında `db:seed` bunları
"Marina Açılış" ve "Marina Kapanış" adlı listelere, kendi bölümlerinin sonuna bir kez ekler (anahtar
`kontrol.marina.foto.seeded`; aynı adda madde varsa atlar).

**Gıda güvenliği** (sahibin isteği, 17 Kasım 2026; FIFO 18 Kasım; `FOOD_SAFETY_ITEMS`): iki şubenin açılış listesinin
sonunda (Tuzla'da "Not"tan önce) dört tamam işareti: **SKT'ler kontrol edildi; tarihi geçen ürün ayrıldı**, **İkinci raf
ömrü etiketleri vuruldu** (açılan ya da hazırlanan ürüne açılış ve son kullanma tarihi etiketi), **Yere temas eden ürün
yok** (koli, kasa ve ürün raf ya da palet üzerinde), **FIFO uygulandı: ilk giren ilk çıkar** (yeni gelen ürün eskisinin
arkasına; önce gelen ve tarihi en yakın ürün önce kullanılır). Var olan veritabanında `db:seed` eksik olanları
"Açılış" ve "Marina Açılış" adlı listelere ekler; her anahtar bir kez çalışır (`FOOD_SAFETY_SEED_KEYS`:
`kontrol.gida.seeded`, `kontrol.gida.fifo.seeded`), aynı adda madde varsa atlanır. O gün açılmış kayda girmez,
ertesi günden görünür.

**Tuvalet çizelgesi** (yalnız Tuzla, 17 Kasım 2026; `TUZLA_HOURLY_CHECKLISTS`, anahtar `kontrol.tuzla.tuvalet.seeded`):
10:00 – 01:30, 16 saatlik bölüm (10:00, 11:00 … 00:00, 01:00), her saatte 4 madde:

| Madde | Tür | |
|-------|-----|---|
| Tuvalet kontrol edildi ve temizlendi | Tamam işareti (**İmzala**) | Zorunlu; eksik ya da arıza "Sorun var" |
| Tuvalet fotoğrafı | Fotoğraf | Zorunlu; içeride kimse yokken |
| Bahçe ve odalardaki boşlar toplandı | Tamam işareti (**İmzala**) | Zorunlu |
| Bahçe ve odalar fotoğrafı | Fotoğraf | İsteğe bağlı: **yalnız misafir yokken çekilir, misafir varken çekilmez** |

İmza, maddeyi işaretleyen kişinin adı ve saatidir ("İmzalandı · Ayşe", üstte "Ayşe · 10:04"). Son saat 01:30: 01:00'in
imzasına yarım saat kalır. Liste eklendiği günün aralığı açılmışsa ertesi günden beklenir (§ 2).

**Saatlik bölüm:** bölüm adı bir saatle başlıyorsa ("10:00", "13:00 öğle") bölümün maddeleri o saatten **10 dakika
önce** açılır (`sectionSlot`, `SLOT_EARLY_MIN`); daha önce işaretlenemez, sunucu da reddeder ("Bu bölüm saat 11:00
olunca açılır"). Doldurma ekranında saati gelmemiş bölümler tek kutuda ("Sıradaki: 17:00 · açılış 16:50", "Sonra: …"),
saatlik bölümün tamam işareti "İmzala" der. Zorunlu maddeleri bitmiş saat, bütün maddeleri yanıtlanınca ya da sıradaki
saat gelince kapanır (dokununca açılır); saati geçmiş ve eksik olan saatin yanında kırmızı **Eksik** rozeti. Herhangi
bir listede bölüm adı saat yazılarak aynı kural kullanılabilir.

Maddeler bir başlangıçtır: gıda güvenliği danışmanıyla gözden geçirilip **Listeler** sekmesinden değiştirilir.

### Şubeler (16 Kasım 2026)

Her listenin bir **Şube** alanı vardır (Listeler › liste › Şube): bir şube ya da **Bütün şubeler** (boş). Listeler
sekmesinde şubeye ait listenin yanında şube rozeti görünür.

- Soldaki şube seçicisinde **tek şube** seçiliyken Kontrol listeleri, Bugün, zil ve Geçmiş o şubenin ve bütün
  şubelerin listelerini gösterir; **Tümü**'nde hepsi görünür.
- **Şubesi belirlenmiş personel** (Kullanıcılar › kişi › Şube, docs/SUBE.md › Personel hesabının şubesi) panelde hep
  kendi şubesindedir: yalnız o şubenin ve bütün şubelerin listelerini görür ve doldurur. Kural sunucuda da uygulanır
  (`branchLockAllows`, 21 Kasım denetimi #10): başka şubenin listesi adresle (`/panel/kontrol/<id>`, eski yer imi ya
  da paylaşılan bağlantı) açılmaz, Kontrol listelerine döner; yanıt ve fotoğraf yüklemesi "Bu liste başka şubenin"
  der, fotoğrafı da görünmez (§ 4). Şubesiz liste herkese açık kalır; yöneticiye ve şubesiz personele kilit yok.
- Sabah e-postası işletmenin tamamı içindir: bütün şubelerin eksik listeleri birlikte gelir.
- Migration 0058 karaoke odası maddesi olan listeleri Tuzla'ya bağladı; diğer listeler bütün şubelerin kaldı.

Madde türleri:

| Tür | Doldururken | Kural |
|-----|-------------|-------|
| **Tamam işareti** | **Tamam** ya da **Sorun var** | "Sorun var" kısa bir not ister ("Buz makinesi su kaçırıyor") |
| **Fotoğraf** | **Fotoğraf çek**; isteğe bağlı not | Telefonun kamerası açılır. Fotoğraf çekilmeden madde yapılmış sayılmaz |
| **Sayı / sıcaklık** | Değer (ör. 3,5); birim ve aralık yanında | Aralık dışı değer kırmızı görünür ve ne yapıldığını yazan not ister (hazır notlar: "Kapı kapatıldı", "Termostat ayarlandı", …). Eksi aralıkta (dondurucu) alanın yanındaki işaret düğmesi "−" gelir; iPhone'un sayı klavyesinde eksi yok |
| **Kısa not** | En çok 300 karakter | Boş bırakılırsa yanıt silinir |

Her madde **zorunlu** ya da **isteğe bağlı**dır; liste bütün zorunlu maddeler yanıtlanınca kendiliğinden tamamlanır.
Maddeler bölümlere ayrılır (Bar, Salon, Karaoke odası…); maddenin açıklaması adının altında görünür. Bir listede en çok
80 madde, 40 fotoğraflı madde olur (saatlik çizelge sığsın diye).

## 2. Gün ve saat (Türkiye)

- **Gün 05:00'te döner** (kasa raporu gibi): gece 01:30'da doldurulan kapanış önceki günün kaydıdır.
- **Saat aralığı yalnız durumu belirler.** Açılıştan önce liste "Sonra"dadır, aralıkta "Yapılacak", son saatten sonra
  "Gecikti". Liste günün her saatinde doldurulabilir; ilk yanıt açılıştan bir saatten çok önceyse geçmişte "Erken
  dolduruldu", son saatten sonra tamamlandıysa "Geç tamamlandı" işareti çıkar.
- **Günler:** her liste haftanın seçili günlerinde beklenir (ör. yalnız hafta sonu).
- Gün içinde eklenen ya da yeniden etkinleştirilen liste, o günün aralığı çoktan açıldıysa **yarından** beklenir
  (öğleden sonra eklenen Açılış "gecikti" demez; akşamki Kapanış beklenir). Pasife alınan liste o andan beklenmez;
  Bugün'de, zilde ve e-postada görünmez, kayıtları Geçmiş'te kalır.
- Kapatılıp hiçbir aralığı açılmadan geri açılan liste (anahtara yanlışlıkla dokunuldu) **hiç kapanmamış sayılır**:
  bugünkü listesi ve Geçmiş'teki "yapılmadı"ları yerinde kalır (`activityChange`). Arada bir aralık açıldıysa liste
  açıldığı andan başlar; listede tek bir başlangıç anı tutulduğu için önceki günler Geçmiş'te "yapılmadı" göstermez.

## 3. Kim doldurur, nasıl kaydedilir

- Personel ve yönetici doldurur. Listede **Personel doldurabilir** kapalıysa listeyi yalnız yönetici görür ve doldurur.
  Açılınca o an `checklist_templates.staff_since`'e yazılır (dalga 10 §2.5): personel Geçmiş'te bu listenin yalnız
  o günden sonraki kayıtlarını görür; yöneticinin eski notları ve fotoğrafları personele açılmaz. Boş değer "baştan
  beri" demektir (dalgadan önce personele açık olan listeler).
- Aynı listeyi birden çok kişi aynı anda doldurabilir. Her dokunuş hemen yazılır; aynı maddede son yazan geçer, önceki
  hâli maddenin altında "Önce: 6 °C · 09:12 Ayşe" olarak kalır (en çok 10). Fotoğrafta yeniden çekme "Önce: Başka bir
  fotoğraf", not değişikliği "Önce: Aynı fotoğraf" ve o zamanki not olarak görünür.
- Bağlantı yoksa işaret geri döner ve "Kaydedilemedi: bağlantı kurulamadı" bildirimi çıkar; yazılan not yerinde kalır,
  yeniden denenir. Panel bu arada güncellendiyse bildirim "Yenile" önerir.
- **Sonradan doldurma yok.** Yalnız bugünün listesi doldurulur (yönetici de geçmiş günü dolduramaz). Başlamış (yanıtı
  olan) bir liste yeni gün açıldıktan sonra 30 dakika daha, **05:30'a kadar** bitirilebilir: 05:01'de biten kapanış
  kaybolmaz. Sonra gelen yanıt "Bu günün listesi kapandı" der ve ekran yeni günün listesini açar.
- **Sorun kaydı silinmez.** Aralık dışı ya da "Sorun var" işaretli madde geri alınamaz; düzelince yeni hâli işaretlenir
  (ör. 6 °C → 3,5 °C). İlk ölçüm geçmişte ve e-postada görünür.
- **Anlık görüntü.** Liste günün ilk yanıtıyla açılır ve o anki maddeleri, adı ve saatleri kopyalanır. Liste sonradan
  değişse de o günün kaydı aynı kalır; değişiklik bir sonraki güne (bugün henüz açılmadıysa bugüne) girer.

## 4. Fotoğraflar

- **Fotoğraf çek** telefonun arka kamerasını açar. Fotoğraf telefonda küçültülür (JPEG, `src/lib/photo-compress.ts`),
  sunucuda boyut, tür ve ölçü yeniden denetlenir (en çok 2 MB; JPG, PNG, WebP). Yükleme `POST /api/kontrol/foto` ile
  yapılır ve yanıt aynı istekte yazılır; yarıda kalan yükleme "Tekrar dene" ile yeniden gönderilir.
- **60 gün saklanır** (kaydın gününden). Süresi dolan fotoğrafı sabah işi siler (fotoğrafların ortak temizliği,
  [FOTOGRAF.md](FOTOGRAF.md) § 4); madde "Fotoğraf çekildi · 60 günden eski olduğu için silindi" der, kaydın kendisi
  kalır. Yeniden çekilen fotoğrafın eskisi hemen silinir.
- **Kim görür:** yönetici hepsini; personel yalnız personelin doldurduğu listelerin son 7 gündeki (iş günü, bugün
  dahil) fotoğraflarını, liste personele açıldıktan sonraki günlerden (`photoAccess`; Geçmiş'le aynı pencere,
  `STAFF_HISTORY_DAYS`). Gün 05:00'te döner: 23 Ekim 04:59'da 16 Ekim görünür, 05:00'te görünmez. Şubesine kilitli
  personel başka şubenin listesinin fotoğrafını görmez (§ 1 › Şubeler).
  Fotoğraf panelin kendi adresinden, oturumla açılır (`/api/foto/[id]`); e-postaya ve zile fotoğraf adresi yazılmaz.
- Fotoğraflar mekânın içindir: maddenin açıklaması "Fotoğrafta müşteri ya da çalışan görünmesin." der (KVKK).
- Fotoğraf deposu (Vercel Blob) bağlı değilse fotoğraflı maddeler yeni kayıtlara girmez; Listeler ekranı ve doldurma
  ekranı bunu söyler.

## 5. Ekranlar

| Ekran | Kimde | İçerik |
|-------|-------|--------|
| **Bugün** (`/panel/kontrol`) | İkisi | Bugünün listeleri açılış saatine göre: durum (Sonra, Yapılacak, Gecikti, Tamam), ilerleme ("3 / 13 madde · 1 fotoğraf kaldı"), dolduranlar; sıradaki liste vurgulu. Sekmeler: yöneticide Bugün · Geçmiş · Listeler, personelde Bugün · Geçmiş. Yöneticide "Bugün olmayan listeler" satırı (pasif, günü değil, yarından) |
| **Doldurma** (`/panel/kontrol/[id]`) | İkisi | Maddeler bölüm bölüm; üstte yapışkan ilerleme çubuğu; bitince "Liste tamam · 09:12 · Ayşe ve Mehmet". 05:00–05:30 arasında başlanmış ama bitmemiş dünkü liste açılır |
| **Geçmiş** (`/panel/kontrol/gecmis`) | İkisi | Yönetici: son 14 gün (her gün listelerin durumu, eksik, sorun), "Daha eski günler". Gün açılınca her liste: kim ne zaman (kişi başına ilk ve son yanıt), erken / geç işareti, maddeler, önceki hâller, aralık dışı değerler, fotoğraflar (dokununca büyür). Personel (dalga 10 §2.5): yalnız doldurabildiği listelerin **son 7 günü**, salt okunur; "Daha eski günler" yok, 7 günden eski `?gun=` ve her `?bitis=` yok sayılır (7 günlük liste gösterilir); "Erken dolduruldu" rozeti gösterilmez (eşik öğrenilmesin). İki rolde bugünün ayrıntısında başlamış ya da aralığı açılmış listenin yanında "Listeyi aç" |
| **Listeler** (`/panel/kontrol/duzenle`) | Yönetici | Yeni liste; ad, açıklama, saat aralığı (son saat 02:00 olabilir), günler, Personel doldurabilir, Etkin. Maddeler: ekle, düzenle, bölüm içinde yukarı / aşağı, kaldır (kaldırılan geçmişte kalır, "Kaldırılan maddeler"den geri eklenir). Kaydı olan liste silinmez, pasife alınır |

Ekran liste saatlerinde ve sekmeye geri dönülünce kendiliğinden yenilenir.

## 6. Bugün, zil ve sabah e-postası

**Bugün** ([BUGUN.md](BUGUN.md)): her liste bir satırdır (`liste-{id}`, açılış saatine göre): aralıktan önce
"Sonra", aralıkta "Yapılacak" (başladıysa "3 / 13 madde · Ayşe · son saat 11:00"), son saatten sonra "Gecikti",
bitince "Tamam" (kim, saat, fotoğraf sayısı; yöneticide açık sorun varsa "1 sorun"). Yöneticiye ayrıca dünün
tamamlanmayan ya da sorunlu listeleri tek satır (`liste-dun`, Geçmiş'in o gününe götürür); o gün kasa raporu da
yoksa "kafe kapalıysa önemsemeyin" der. Personelde de aynı satır (dalga 10 §2.5) ama sorun değil yapılacaktır: yalnız
açık sorunlar ve başlamış listelerin eksik maddeleri yazılır; hiç açılmamış liste yalnız dünün kasa raporu varken
(kafe açıktı) yazılır. Rozet "1 eksik" / "2 sorun", eylem "Geçmişe bak", `kasa-dun`'dan hemen sonra gelir ve başka
yapılacak satır varken sıradaki iş olmaz. Dün onaylı kapalıysa (§2.9) ve liste açılmadıysa satır yok.

**Zil** (Kontrol listeleri başlığı, kasanın ardından):

| Kimde | Ne zaman | Satır |
|-------|----------|-------|
| Personel | Aralık açıkken | "Açılış listesi bekliyor · Son saat 11:00 · 3 / 13 madde" (bilgi, okunmuş sayılır) |
| Personel | Son saatten sonra | "Açılış listesi gecikti" (okunmamış) |
| Yönetici | Son saatten sonra | "Açılış listesi gecikti · Son saat 11:00 · başlanmadı" |
| Yönetici | Dün tamamlanmadıysa | "Dünkü kapanış listesi eksik" |
| Yönetici | Bugün ya da dün açık sorun | Aralık dışı ölçüm kırmızı ("Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)"), "Sorun var" turuncu; en yeni 5. Ölçüm değişince bildirim yeniden açılır |

**Sabah e-postası** ([BILDIRIMLER.md](BILDIRIMLER.md) › Ek kutular): dünkü listelerde eksik ya da sorun varsa
"Kontrol listeleri · 22 Ekim Perşembe" kutusu: tamamlanmayan her liste ("3 / 13 madde; yapılmayan: …" ya da "hiç
açılmadı"), sorunlar (açık ve düzeltilmiş, en çok 5), kasa raporu da yoksa "kafe kapalıysa önemsemeyin". Kutu
e-postayı tek başına gönderir; konu parçası "dünkü kapanış listesi eksik", "dünkü 2 kontrol listesi eksik",
"kontrol listesinde aralık dışı değer" ya da "kontrol listesinde sorun". Her gün için bir kez: anahtar `kontrol:{gün}`
başarılı gönderimden sonra `notification_log`'a yazılır. Önizleme yazmaz.

**Kapalı gün şubenindir** (22 Kasım 2026; [SUBE.md](SUBE.md) › Kapalı gün): zilin "Dünkü … eksik" satırları ve sabah
e-postasının kutusu hiç açılmamış listeyi yalnız kendi şubesi o gün kapalı işaretliyse eksik saymaz; bütün şubelerin
listesini işletme kapalıysa (işletme geneli işaret ya da o gün açık her şubenin kendi işareti). Marina'nın kapalı günü
Tuzla'nın eksik listesini susturmaz. E-postada kapalı işaretli şubede günün izi varsa (o şubenin kasa raporu ya da
başlamış listesi) eksikler yine yazılır.

**Personele e-posta hatırlatması** (17 Kasım 2026; `src/lib/checklist-alerts.ts`,
`src/server/notify/checklist-alerts.ts`): iş bugünün listelerine bakar ve personele e-posta gönderir.

**Günde 4 bildirim (23 Kasım 2026).** Önceden hatırlatma saat başı gidiyordu (Türkiye 08:07 – 02:07, Tuvalet
çizelgesinin her saati için ayrı "zamanı geldi" ve "gecikti"). Şimdi yalnız **10:00, 14:00, 18:00 ve 22:00**'de, her
bildirim saatinin ilk saatinde gider (`ALERT_SEND_MINUTES`, `alertSendInstant`): sabahın ilk bildirimi 10:00'dan önce,
günün sonuncusu 01:00'dan sonra olmaz (22:00'den sonra gece hiç e-posta yok). İş bildirim saati dışında çalışırsa
("bildirim saati değil" der) hiçbir şey göndermez; canlı yoklama da o zaman işi hiç başlatmaz. Uyarılar işin çalıştığı
ana değil **bildirim saatinin anına** göre bulunur: 10:55'te çalışan iş 11:00 saatinin penceresini görüp ek e-posta
atmaz, o saat sonraki bildirimde (14:00) gecikmiş ya da zamanı gelmiş olarak girer. Her bildirimde personele tek
e-posta gider: o anda zamanı gelmiş ve (iki saatten eski olmayan) geciken bütün listeler bir arada. Saat atlanırsa
(GitHub ya da yoklama bir saatten fazla geciktiyse) o bildirim hiç gitmez, bir sonraki saati beklenir. Saatleri
değiştirmek için `ALERT_SEND_MINUTES`'i ve `.github/workflows/kontrol-hatirlatma.yml`'deki cron'u birlikte düzenleyin
(`tests/kontrol-hatirlatma.test.ts` ilk bildirimin 10:00'dan önce, sonuncunun 01:00'dan sonra olmamasını sınar).

İki tetikleyici (20 Kasım 2026):

- **Açık panel sekmesi** (asıl): canlı yoklama (`/api/canli`) yanıttan sonra, bildirim saatinin ilk saatinde, sunucu
  örneği başına en çok **5 dakikada bir** işi çalıştırır (`ALERT_POLL_GAP_MS`). Kafede bir tablet ya da telefon panelde
  açık olduğu sürece 10:00 bildirimi 10:00–10:05 arasında gider.
- **GitHub Actions** (yedek): Türkiye 10:07, 14:07, 18:07 ve 22:07'de (her biri için :37'de ikinci deneme)
  `/api/cron/kontrol`. GitHub zamanlanmış işleri yoğunlukta saatlerce geciktirip düşürebiliyor (17–20 Kasım 2026: 3
  günde 57 yerine 11 çalışma); bu yüzden yalnız yedektir.

Aynı uyarı iki tetikleyiciden de bir kez gider (aşağıda: sahiplenme).

| Liste | Zamanı geldi | Gecikti |
|-------|--------------|---------|
| Saatlik bölümlü (Tuvalet çizelgesi) | Saatin bölümü açıldı (10:00'ınki 09:50'de), zorunlu maddesi eksik | Sıradaki saat geldi (son saatte listenin son saati, 01:30), hâlâ eksik |
| Öteki listeler (Açılış, Kapanış…) | Aralık açıldı, eksik var | Son saat geçti, eksik var |

- Tamamlanmış saat ya da liste için e-posta gitmez; isteğe bağlı maddeler (bahçe fotoğrafı) beklenmez.
- Gecikme, bitişten en çok **2 saat** sonra gider (`LATE_ALERT_MIN`); iş uzun süre çalışmayıp dönünce eski uyarılar
  yığılmaz. Geç çalışan iş aralığı biten saat için "zamanı geldi" değil yalnız "gecikti" gönderir.
- **Kime:** listeyi doldurabilen ("Personel doldurabilir") etkin **personel**: şubeli listede o şubenin personeli ve
  şubesi boş personel, şubesiz listede bütün personel. Tuvalet çizelgesi yalnız Tuzla'nın ve şubesiz personelin.
  Her kişiye kendi adresine tek e-posta (adresler birbirine görünmez); o çalışmadaki bütün uyarıları bir arada,
  gecikmeler önce. E-postada ödeme ya da maliyet yok.
- Her uyarı bir kez: anahtar `kontrol-eposta:{liste}:{gün}:{saat|liste}:{due|late}` gönderimden önce
  `notification_log`'a yazılır. Kimseye kesin olarak gidemezse anahtar silinir, sonraki saat yeniden dener.
- Ayarlar'daki e-posta anahtarı kapalıysa ya da `RESEND_API_KEY` yoksa hiçbir şey gönderilmez.
- **Kapalı işaretli gün** (Özel günler › Kafe kapalı; kapalı gün işletmenindir, bütün şubeler): o gün hiç açılmamış
  listeler için e-posta gitmez; o gün açılmış (kaydı olan) liste yine hatırlatılır (`remindableLists`; zilin dünkü
  listeler kuralı, 21 Kasım denetimi #25).
- **Yedek tetikleyici:** Vercel Hobby'de cron günde bir kez çalıştığı için bildirim saatlerindeki çağrı GitHub Actions'tan gelir
  (`.github/workflows/kontrol-hatirlatma.yml`, `7,37 7,11,15,19 * * *` UTC). Depoda **`CRON_SECRET` sırrı** (Vercel'deki
  `CRON_SECRET`'ın aynısı) gerekir; yoksa iş uyarı yazıp hiçbir şey göndermez. Elle denemek için Actions › Kontrol
  listesi hatırlatmaları › Run workflow.

**İşlem geçmişi:** liste tamamlandı, aralık dışı değer, sorun bildirildi, ölçüm değişti; listelerin ve maddelerin
eklenmesi, düzenlenmesi, kaldırılması. Düz "Tamam" işaretleri ve fotoğraflar yazılmaz (yanıtın kendisi kimin ne zaman
yaptığını tutar).

## 7. Veri

- `checklist_templates` (liste), `checklist_items` (maddeleri), `checklist_runs` (günün kaydı ve maddelerin anlık
  görüntüsü), `checklist_answers` (yanıt, önceki hâlleri, fotoğrafı). `integration_state` › `kontrol.seeded`: hazır
  listeler eklendi.
- Kayıtlar silinmez (yılda yaklaşık 11 bin yanıt). `db:reset` dokunmaz; tam yedeğe girer, fotoğrafların kendisi
  girmez ([YEDEK.md](YEDEK.md)).
- Bu sürümde yok: günde birden çok kayıt (oda sıfırlama, mal kabul gibi olay listeleri; `schedule` ve `seq` sütunları
  bunun için duruyor), geçmişte 30 günlük özet.

## 8. Dosyalar

- `src/lib/checklists.ts`: gün ve saat, durum, özet, metinler, kim doldurur ve kim görür, zil ve e-posta kutusu (saf)
- `src/lib/checklist-seed.ts`: hazır iki liste
- `src/server/checklists/store.ts`: veritabanı (günün listeleri, doldurma, geçmiş, yanıt yazımı)
- `src/server/data/checklists.ts`: bağlantı, fotoğraf deposu, işlem geçmişi, fotoğraf erişimi, e-posta kutusu
- `src/server/actions/checklists.ts`: işaretleme ve listelerin düzenlenmesi
- `src/app/api/kontrol/foto/route.ts`: fotoğraflı yanıt
- `src/app/panel/kontrol/`: ekranlar
- Testler: `tests/kontrol-listeleri.test.ts`; veritabanıyla `KONTROL_TEST_DATABASE_URL=postgres://…/laffogato_…`
  verilince `tests/kontrol-listeleri-db.test.ts`

# Kontrol listeleri (açılış ve kapanış)

Ekran: **Kontrol listeleri** (`/panel/kontrol`; menüde üst düzeyde, personelin telefonunda üst çubuktaki menüde).
Personel kafeyi açarken ve kapatırken maddeleri telefondan tek tek işaretler: buzdolabı sıcaklığını yazar, istenen
yerde fotoğraf çeker. Her madde dokunulduğu an kaydedilir. Amaç denetimde gösterilecek düzenli bir kayıttır: hangi gün,
kim, saat kaçta, hangi sıcaklık, hangi fotoğraf. Yönetici yapılmayan listeyi ve aralık dışı değeri Bugün'de, zilde ve
ertesi sabahki e-postada görür.

## 1. Listeler ve maddeler

İlk kurulumda iki liste gelir (`src/lib/checklist-seed.ts`; `db:seed` bir kez ekler, silinen liste geri gelmez):

| Liste | Saat | Maddeler |
|-------|------|----------|
| **Açılış** | 08:00 – 11:00 | 13 madde: espresso makinesi, bar buzdolabı (0–4 °C), derin dondurucu (−30 – −18 °C, isteğe bağlı), süt tarihleri, buz makinesi, dezenfeksiyon, tezgâh fotoğrafı; salon ve lavabo, salon fotoğrafı; karaoke odası (havalandırma, ses sistemi, mikrofon şarjı); eksik / arıza notu (isteğe bağlı) |
| **Kapanış** | 22:00 – 02:00 | 16 madde: karaoke odası (mikrofonlar alkollü mendille, koltuk ve tablet, unutulan eşya, cihazlar kapalı, oda fotoğrafı); bar (espresso yıkaması, buhar çubuğu, açık ürünlere tarih, bar buzdolabı, bar fotoğrafı); salon ve genel (yer, lavabo, çöp, salon fotoğrafı, ışık ve kapılar); not (isteğe bağlı) |

Maddeler bir başlangıçtır: gıda güvenliği danışmanıyla gözden geçirilip **Listeler** sekmesinden değiştirilir.

Madde türleri:

| Tür | Doldururken | Kural |
|-----|-------------|-------|
| **Tamam işareti** | **Tamam** ya da **Sorun var** | "Sorun var" kısa bir not ister ("Buz makinesi su kaçırıyor") |
| **Fotoğraf** | **Fotoğraf çek**; isteğe bağlı not | Telefonun kamerası açılır. Fotoğraf çekilmeden madde yapılmış sayılmaz |
| **Sayı / sıcaklık** | Değer (ör. 3,5); birim ve aralık yanında | Aralık dışı değer kırmızı görünür ve ne yapıldığını yazan not ister (hazır notlar: "Kapı kapatıldı", "Termostat ayarlandı", …). Eksi aralıkta (dondurucu) alanın yanındaki işaret düğmesi "−" gelir; iPhone'un sayı klavyesinde eksi yok |
| **Kısa not** | En çok 300 karakter | Boş bırakılırsa yanıt silinir |

Her madde **zorunlu** ya da **isteğe bağlı**dır; liste bütün zorunlu maddeler yanıtlanınca kendiliğinden tamamlanır.
Maddeler bölümlere ayrılır (Bar, Salon, Karaoke odası…); maddenin açıklaması adının altında görünür. Bir listede en çok
60 madde, 10 fotoğraflı madde olur.

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
- **Kim görür:** yönetici hepsini; personel yalnız personelin doldurduğu listelerin bugünkü ve dünkü fotoğraflarını.
  Fotoğraf panelin kendi adresinden, oturumla açılır (`/api/foto/[id]`); e-postaya ve zile fotoğraf adresi yazılmaz.
- Fotoğraflar mekânın içindir: maddenin açıklaması "Fotoğrafta müşteri ya da çalışan görünmesin." der (KVKK).
- Fotoğraf deposu (Vercel Blob) bağlı değilse fotoğraflı maddeler yeni kayıtlara girmez; Listeler ekranı ve doldurma
  ekranı bunu söyler.

## 5. Ekranlar

| Ekran | Kimde | İçerik |
|-------|-------|--------|
| **Bugün** (`/panel/kontrol`) | İkisi | Bugünün listeleri açılış saatine göre: durum (Sonra, Yapılacak, Gecikti, Tamam), ilerleme ("3 / 13 madde · 1 fotoğraf kaldı"), dolduranlar; sıradaki liste vurgulu. Yöneticide sekmeler ve "Bugün olmayan listeler" satırı (pasif, günü değil, yarından) |
| **Doldurma** (`/panel/kontrol/[id]`) | İkisi | Maddeler bölüm bölüm; üstte yapışkan ilerleme çubuğu; bitince "Liste tamam · 09:12 · Ayşe ve Mehmet". 05:00–05:30 arasında başlanmış ama bitmemiş dünkü liste açılır |
| **Geçmiş** (`/panel/kontrol/gecmis`) | Yönetici | Son 14 gün (her gün listelerin durumu, eksik, sorun), "Daha eski günler". Gün açılınca her liste: kim ne zaman (kişi başına ilk ve son yanıt), erken / geç işareti, maddeler, önceki hâller, aralık dışı değerler, fotoğraflar (dokununca büyür) |
| **Listeler** (`/panel/kontrol/duzenle`) | Yönetici | Yeni liste; ad, açıklama, saat aralığı (son saat 02:00 olabilir), günler, Personel doldurabilir, Etkin. Maddeler: ekle, düzenle, bölüm içinde yukarı / aşağı, kaldır (kaldırılan geçmişte kalır, "Kaldırılan maddeler"den geri eklenir). Kaydı olan liste silinmez, pasife alınır |

Ekran liste saatlerinde ve sekmeye geri dönülünce kendiliğinden yenilenir.

## 6. Bugün, zil ve sabah e-postası

**Bugün** ([BUGUN.md](BUGUN.md)): her liste bir satırdır (`liste-{id}`, açılış saatine göre): aralıktan önce
"Sonra", aralıkta "Yapılacak" (başladıysa "3 / 13 madde · Ayşe · son saat 11:00"), son saatten sonra "Gecikti",
bitince "Tamam" (kim, saat, fotoğraf sayısı; yöneticide açık sorun varsa "1 sorun"). Yöneticiye ayrıca dünün
tamamlanmayan ya da sorunlu listeleri tek satır (`liste-dun`, Geçmiş'in o gününe götürür); o gün kasa raporu da
yoksa "kafe kapalıysa önemsemeyin" der.

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

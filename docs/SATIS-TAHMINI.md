# Satış tahmini

Ekran: **Satış & gider › Satış tahmini** (`/panel/tahmin`, yalnız yönetici). Her sabah önümüzdeki 7 iş gününde kafenin
ne kadar satacağını (kasanın **Z toplamı**), kaç kişinin çalışması ve kaç tatlı hazırlanması gerektiğini hesaplar.
Bugün ekranında yöneticiye kart, personele yalnız yoğunluk ve tatlı sayısı; sabah e-postasında bir kutu.

- **Hedef:** Z toplamı (KDV dahil, indirimden sonra, ikram hariç; `months.pos_revenue` ile aynı anlam).
  laffogato.net'in online satışı kasadan geçmediği için yok.
- **Gün:** iş günü, 05:00'te döner (`businessDate`, `src/lib/cash-report.ts`). Bugünün kendi Z'si bugünün tahminine
  hiç girmez.
- **Konum:** İstanbul Tuzla, Opera AVM (hava durumu için Tuzla merkezi; MaviBahçe İzmir'deki ayrı karaoke işidir).

## 1. Model (`src/lib/forecast/model.ts`, saf)

Bilerek basit: hafta günü tabanı × adı konmuş çarpanlar. Her sayı ekranda "Nasıl hesaplandı"da tek cümleyle yazar.

1. **Geçmiş:** son 60 günün kasa raporları. Açık (Z > 0), takvim olayı (bayram, resmî tatil, arife) ve özel günü
   olmayan gün **normaldir**. Normal günün Z'si o günün Ramazan, okul tatili ve hava çarpanına bölünür (taban mevsimden
   etkilenmesin). Z'si 0 olan gün kapalı sayılır, rapor girilmemiş gün yok sayılır.
2. **Hafta günü tabanı:** son 42 günde o hafta gününden en az 3 normal gün varsa dayanıklı ortalaması (5 ve üstünde en
   yüksek ve en düşük atılır, 3–4 günde ortanca).
3. **Yedek:** kendi verisi olmayan hafta günü için ortalama gün × varsayılan pay:
   - son 28 günde en az 7 normal gün varsa onların ortalaması (`ortalama`);
   - yoksa son ayın POS cirosu ÷ açık gün (Satışlar'daki ay bilgisi; `ay`);
   - o da yoksa son 42 günün normal günleri (en az 3); hiçbiri yoksa tahmin yok (`yok`).
4. **Eğilim:** kendi verisiyle (tam / karma) son 14 günde en az 5 normal gün varsa, tabandan ortalama sapması %10'u
   geçerse "Son 2 hafta eğilimi" çarpanı (×0,8–1,25). Kafe yeni ve büyüyor: pencere kısa tutuldu.
5. **Günün çarpanları** (yalnız 1'den farklıysa listelenir; çarpım ×0,4–2,5 aralığında):

   | Gün | Etkisi | Not |
   |-----|--------|-----|
   | Hafta içi resmî tatil | +%20 | hafta sonuna düşerse etkisiz |
   | Arife (yarım gün) | +%10 | yalnız hafta içi |
   | Ramazan Bayramı | +%15 | her gün |
   | Kurban Bayramı | %0 | şehir dışına gidenler / kalanlar bilinmiyor |
   | Ramazan ayı | −%8 | her gün |
   | Okul tatili | +%10 | yalnız hafta içi |
   | Yağmurlu gün (09–23 arası 5 mm ve üstü) | +%5 | hava durumu açıkken |
   | Çok sıcak gün (en yüksek 35 °C ve üstü) | +%5 | yağmur yoksa |
   | Özel gün | seçilen etki | üst üste gelenler çarpılır |

   Hafta günü payları (kendi veri yokken): Pzt %85 · Sal %85 · Çar %90 · Per %95 · Cum %105 · Cmt %125 · Paz %115.
   Etkiler şimdilik varsayılandır; geçmiş günlerden öğrenme bu turda yapılmadı (birkaç haftalık veriyle bayram ya da
   yağmur etkisi öğrenilemez; `docs/planlar/CRITIQUE2.md` §6). Ekranda etiketlerde yüzdesiyle, "Takvim ve etkiler"de
   tablo olarak durur.
6. **Kapalı gün:** "Kafe kapalı" özel günü tahmini, aralığı, kişiyi ve tatlıyı 0 yapar.
7. **Tutar ve aralık:** tutar 100 ₺'ye yuvarlanır. Aralık: en az 14 günün "gerçekleşen ÷ o sabahki tahmin" oranı varsa
   onların %20'si ile %80'i (en az −%5 / +%5); yoksa kendi veriyle ±%15, kaba tabanla ±%25, takvim olayında 5 puan daha.
   Alt uç 500 ₺'ye aşağı, üst uç yukarı yuvarlanır.
8. **Yoğunluk:** tutar ÷ ortalama normal gün ≥ 1,12 **Yüksek**, ≤ 0,88 **Düşük**, arası **Normal**.

**Örnek** (kasa raporu yokken, 22 Ekim 2026; Ekim'in ilk 16 günü 293.909 ₺ → günde 18.369 ₺):

| Gün | Hesap | Tahmin | Aralık | Yoğunluk |
|-----|-------|--------|--------|----------|
| Per 22 Eki | 18.369 × %95 | 17.500 | 13.000–22.000 | Normal |
| Cmt 24 Eki | 18.369 × %125 | 23.000 | 17.000–29.000 | Yüksek |
| Çar 28 Eki (arife) | 18.369 × %90 × 1,10 | 18.200 | 12.500–24.000 | Normal |
| Per 29 Eki (Cumhuriyet Bayramı) | 18.369 × %95 × 1,20 | 20.900 | 14.500–27.500 | Yüksek |

## 2. Veri katmanları ve uyarı

| Katman | Ne zaman | Ekrandaki uyarı |
|--------|----------|-----------------|
| `ay` | Kasa raporu az, son ayın POS cirosu ve açık günü var | "Henüz N günlük kasa raporu var. Tahmin şimdilik Ekim 2026 ortalamasına …; aralık bu yüzden geniş." |
| `ortalama` | Son 28 günde en az 7 normal gün | "Son 28 günde N günlük kasa raporu var. Hafta günü farkları şimdilik varsayılan; …" |
| `karma` | Bazı hafta günlerinde 3 rapor var | "Pazartesi, Salı için henüz 3 rapor yok; o günler ortalama güne göre hesaplandı." |
| `tam` | Her hafta gününde 3 rapor | yok |
| `yok` | Ne rapor ne ay bilgisi | Boş ekran: "Tahmin için veri yok" ve Kasa raporu bağlantısı |

Takvim tablosu bitmeye yaklaşınca uyarıya eklenir: 1 Ağustos 2027'den "Okul takvimi 2027–2028 için henüz eklenmedi",
1 Kasım 2028'den "Takvim tablosu 2028 sonunda bitiyor; 2029 eklenmeli."

## 3. Takvim (`src/lib/forecast/calendar.ts`)

Elle tutulan tablo; kaynakları dosyada ve `CALENDAR_SOURCES`'ta.

- **Resmî tatiller** (her yıl, 2026–2028): 1 Ocak, 23 Nisan, 1 Mayıs, 19 Mayıs, 15 Temmuz, 30 Ağustos, 29 Ekim;
  28 Ekim öğleden sonra arife.
- **Dinî günler** (Diyanet): Ramazan ayı ilk oruçtan arifeye kadar, arife yarım gün, Ramazan Bayramı 3, Kurban Bayramı
  4 gün.

  | Yıl | Ramazan | Ramazan Bayramı | Kurban arifesi | Kurban Bayramı |
  |-----|---------|-----------------|----------------|----------------|
  | 2026 | 19 Şub – 19 Mar | 20–22 Mar | 26 May | 27–30 May |
  | 2027 | 8 Şub – 8 Mar | 9–11 Mar | 15 May | 16–19 May |
  | 2028 | 28 Oca – 25 Şub | 26–28 Şub | 4 May | 5–8 May |

  2028, Diyanet'in sayfası bu ortamdan açılamadığı için 24 Ekim 2026'da ikincil kaynaklarla denetlendi
  (izintakvimi.com, onlinesaat.web.tr); Diyanet sayfası açılınca bir kez daha bakılmalı.
- **Okul tatilleri** (MEB): yaz 27 Haz – 13 Eyl 2026; 1. dönem ara tatili 16–20 Kas 2026; yarıyıl 25 Oca – 5 Şub 2027;
  2. dönem ara tatili 8–12 Mar 2027; yaz 26 Haz 2027'den (bitişi 12 Eyl 2027, MEB açıklayana kadar tahmini).
- **Çakışma:** bayram resmî tatili, resmî tatil arifeyi geçer (2027-05-19 "Kurban Bayramı 4. gün · 19 Mayıs").
  Mevsimler (Ramazan, okul tatili) olayla birlikte geçerlidir (2027-03-08: arife, Ramazan ve ara tatil).

**Güncelleme:** 2029'un resmî tatilleri `YEARS`'a, dinî günleri Diyanet'in takviminden `RELIGIOUS`'a eklenir; MEB
2027–2028 takvimini açıklayınca `SCHOOL`'a yazılır ve 2027 yaz tatilinin `estimated` işareti kaldırılır;
`coverageNote`'un tarihleri ve `CALENDAR_COVERAGE` ileri alınır. `tests/satis-tahmini.test.ts` hafta günlerini ve
öncelikleri sabitler.

## 4. Özel günler

Derbi / maç, AVM etkinliği, kampanya, kafe kapalı ya da diğer; bir günden 14 güne kadar, 60 gün geriye (tahmin son 60
günün kasa raporunu okur; daha eski bir gün hiçbir şeyi değiştirmez) ve 1 yıl ileriye. Kart bütün yaklaşanları ve son
60 günde bitenleri listeler; tahmin önümüzdeki 60 günü okur. Etki: çok artırır (+%30), artırır (+%15), bilmiyorum
(yalnız not), azaltır (−%15), çok azaltır (−%30); kafe kapalıda tahmin 0. Aynı adla üst üste binen ikinci kayıt
reddedilir (etki iki kez çarpılmasın). Geçmiş bir gün de işaretlenebilir: o gün normal günlerin ortalamasına katılmaz
(derbi gününün üç katı satış tabanı şişirmez). Yönetici her türü girer; personel ileri tarihli maç, AVM etkinliği,
kampanya ve diğerini girer (aşağıda). Silince bildirimdeki **Geri al** aynı değerlerle yeniden ekler. İşlem geçmişine
"Özel gün", "Özel gün güncellendi", "Özel gün silindi" yazılır. Yöneticinin penceresinde adın ipucu: "Ad personele
görünür; müşteri adı ya da tutar yazmayın." Kart `#ozel-gunler` çapasındadır (personelin ekranı yöneticiyi oraya
yönlendirir).

### Personelin özel günleri (dalga 10 §2.9)

- **`/panel/ozel-gunler`** (Günlük altında, yalnız personel; Bugün'ün yoğunluk satırı buraya götürür): "Yaklaşan"
  listesi (bugün ile 60 gün), satır "25 Eki Cmt · Derbi / maç · +%15 · Ahmet ekledi"; başkasının notu gönderilmez,
  tahmin tutarı ve gerçekleşen etki yüklenmez (`src/server/forecast/staff-special.ts` › `staffSpecialList`, yalnız
  `special_days`, sabit sütunlar).
- **Onaysız, sınırlı** (`src/lib/closed-days.ts` › `staffSpecialCheck`): türler Derbi / maç, AVM etkinliği,
  Kampanya, Diğer; etki +%15, Bilmiyorum (yalnız not), −%15. Başlangıç yarından, en geç +60 gün; en çok 3 gün; kişinin
  gelecekte kapsadığı günler toplamı en çok 14; günde en çok 20 yazım; başka bir özel günle çakışamaz. Kişi yalnız kendi
  girdiği, başlamamış ve yöneticinin dokunmadığı satırı değiştirir ya da siler ("Başlamış ya da yöneticinin düzenlediği
  özel gün değiştirilemez"). Yöneticinin düzenlemesi `updated_by` yazar.
- Pencere Satış tahmini'ninkidir (`SpecialDayDialog`, `mode="staff"`, eylemler sayfadan enjekte edilir:
  `src/server/actions/special-days-staff.ts`). Yazımlar yöneticininkilerle aynı danışma kilidini alır
  (`pg_advisory_xact_lock(hashtext('ozel-gun'))`).
- **Model:** personelin "Bilmiyorum" satırı (etki 0) yalnız nottur, günü tabandan çıkarmaz; yöneticinin "Bilmiyorum"u
  çıkarmaya devam eder (`by_staff`).
- **Yönetici:** personel satırları listede "Ahmet ekledi", 7 günün nedenlerinde "(Ahmet ekledi)"; personel özel gün
  ekleyince, düzeltince ya da silince bilgi zili ("Ayşe özel gün ekledi", gövdede özet).
- **Kapalı gün** satırını personel yazamaz: dün için "Kafe kapalıydı" bildirir, yönetici onaylarsa satır onaylayan
  yöneticinin adıyla yazılır ([KASA-RAPORU.md](KASA-RAPORU.md) › Kafe kapalıydı). Kapalı satırı Satış tahmini'nden
  silinirse bildirim "geri alındı" olur ve eksik rapor uyarıları geri gelir.
- Testler: `tests/kapali-gun.test.ts`, `tests/kapali-gun-db.test.ts` (`KAPALI_TEST_DATABASE_URL`).

## 5. Hava durumu: MET Norway

- **İstek:** `GET https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8160&lon=29.3010` (Tuzla merkezi;
  Opera AVM'nin kendi noktası 5 km'den uzaksa değiştirilir, MET'in ızgarasında fark etmez). Ayar değil, sabit.
- **Kurallar** ([Terms of Service](https://api.met.no/doc/TermsOfService)): ücretsiz, anahtarsız; uygulamanın adı ve
  iletişimi `User-Agent`'ta: `LAffogatoPanel/1.0 (+<APP_URL>[; WEATHER_CONTACT])` (kimliksiz istek 403 / 429 alır);
  `Expires`'tan önce yeniden istenmez; `If-Modified-Since` son `Last-Modified`'la gider (304: değişmedi); koordinat en
  çok 4 ondalık; 203 eskimiş ürün demektir (veri kullanılır, günlükte uyarı). Alınamayan istek 15 dakika
  tekrarlanmaz. Günde bir istek.
- **İsteğe bağlı ortam değişkeni:** `WEATHER_CONTACT` (e-posta ya da adres; koda yazılmaz).
- **Lisans:** NLOD 2.0 ve CC BY 4.0. Kaynak ekranın 7 gün kartının altında ("MET Norway (Norveç Meteoroloji
  Enstitüsü) verisi, CC BY 4.0", api.met.no bağlantısı) ve e-postanın kutusunda yazar.
- **Ayrıştırma** (`parseMetCompact`): adımlar Türkiye takvim gününe bölünür (21:00Z ertesi gün). Gün içi 09:00–22:00
  arasında başlayan adımlar: en yüksek sıcaklık bunlardan, en düşük bütün günden; yağış en az 10 saatlik adım varsa
  onların toplamı, yoksa 09:00 ve 15:00'te başlayan 6 saatlik toplamlar; simge 15:00'in.
- **Saklama:** `weather_days` (gün başına bir satır; `hours` gün içi, 09:00–22:00 arası başlayan adım sayısı). Bugün ve
  sonrası her alışta güncellenir (bugünün satırı yalnız en az onun kadar gün içi adımıyla: sabah 08:00'deki istek
  dünkünün yerine geçer, öğleden sonraki yarım gün sabahın tam gününü ezmez); geçmiş günler donar. HTTP durumu
  `integration_state` › `forecast.weather`.
- **Bozulunca:** istek 6 saniyede kesilir; hava alınamazsa çarpan 1, ekran nedenini yazar ("Hava durumu alınamadı
  (Bağlantı kurulamadı); tahmin havasız hesaplandı."). Ayardan kapatılabilir.

## 6. Kişi ve tatlı önerisi

- **Kişi:** tahmin ÷ "bir kişinin günde karşıladığı satış" (varsayılan 10.000 ₺), yukarı yuvarlanır, en az 2 en çok 6
  (ayarlardan). Aralığın üstü daha çok kişi gerektiriyorsa "yoğunsa 4". Kadrodaki kişiden (Giderler & personel, bu ay)
  fazlaysa açıklama söyler.
- **Tatlı** (`src/lib/forecast/desserts.ts`): son (en çok 3) satış ayının ürün satışından; tatlı kategorisi (varsayılan
  adında "tatlı" geçen, ayarlardan; kategori adıyla saklanır) ürünlerinin reçetesindeki ambalaj olmayan, birimi dilim ya
  da adet malzemeler hazırlık kalemidir ("San Sebastian dilim" → San Sebastian, paket 12 dilim → bütün sayısı).
  ml / gr malzeme (dondurma) sayılmaz; böyle malzemesi olmayan tatlı kendi adıyla adet. Oran: birim ÷ ayın cirosu (POS,
  yoksa satış satırlarının toplamı); günün tatlısı = tahmin × oran. Satışı olmayan yeni tatlı hesapta yok. Satış
  yüklü ama tatlı kategorilerinde hiç satış yoksa kart Satışlar'a değil Tahmin ayarları'na götürür (`loadDessertMix`).
- **Günlük döküm** (`docs/planlar/CRITIQUE2.md` R18): tahmin `loadDailyProductSales` ağzını okur. ModPOS'un dökümü
  hiç gelmedi; ağzı LafPOS'un gün sonu doldurur ([LAFPOS.md](LAFPOS.md)), ama tahmin onu henüz kullanmaz: günlük
  toplamlar kasa raporlarından, tatlı payı aylık satıştan gelir. Ayrı bir görev raporu olmayan günleri ve hafta gününe
  göre tatlı oranlarını buraya bağlar (ağız dolu dönerse günlüğe uyarı yazılır).

## 7. Kayıtlı tahmin ve tutturma

- Sabah işi (`/api/cron/gunluk`, 08:00–09:00) bugünden 7 günün tahminini `forecast_snapshots`'a yazar (hedef gün ×
  yapıldığı gün; ilk yazan kalır). "Güncelle" düğmesi de aynısını yapar (zaten kayıtlıysa dokunmaz). **Önizlemeler
  hiçbir şey yazmaz** (canlının veritabanını paylaşırlar).
- **Tutturma:** yalnız aynı sabahın, 12:00'den (Türkiye) önce yazılmış tahmini sayılır: günün hikâyesini öğrendikten
  sonra basılan "Güncelle" ölçüye girmez. Son 28 günde en az 7 eşleşen günde ağırlıklı sapma
  Σ|gerçek − tahmin| ÷ Σ gerçek, aralıkta kalan gün ve yön ("tahmin genelde %4 düşük kalıyor"). Liste son 14 gün:
  "Rapor yok", "Kapalı", "Tahmin kaydı yok". Sabah eklenen özel gün canlı tahmini değiştirir, kaydı değiştirmez; gün
  açıklaması "Bu sabah kaydedilen tahmin: …" der.

## 8. Nerede görünür

- **Satış tahmini:** 7 gün (etiketler, hava, kişi, tatlı, tutar ve aralık, yoğunluk; dokununca "Nasıl hesaplandı" ve
  "Bu güne özel gün ekle"), Tatlı hazırlığı, Tutturma, Özel günler, Takvim ve etkiler (varsayılan etkiler ve önümüzdeki
  60 gün), Tahmin ayarları. Başlıkta "Özel gün ekle" ve "Güncelle" (hava durumunu alır, tahmini kaydeder; en çok 6 sn).
- **Bugün (yönetici):** "Satış tahmini" kartı, Yaklaşan ödemeler'in altında: bugünün tutarı, aralık, yoğunluk, kişi,
  tatlı, en çok üç etiket, 7 günün çubukları (o güne götürür) ve "Dün: tahmin …, gerçekleşen …".
- **Bugün (personel):** "Bugün kafede" kartının başında "Bugün yoğunluk: Yüksek · Cumhuriyet Bayramı" ve "Tatlı: bugün
  ≈ 8 satılır (en çok San Sebastian, Marlenka)". Tutar, aralık, kişi önerisi ve ayar personele hiç gitmez: sunucu
  yalnız `{ level, reasons, desserts, closed }` döner (`loadStaffForecast`; ayar kapalıysa hiç). Personel
  `/panel/tahmin`'i açamaz.
- **Sabah e-postası:** "Satış tahmini" kutusu (zamdan sonra): bugün, dünün tahmini ve gerçekleşeni, haftanın en yoğun
  günü, MET Norway kaynağı. Yalnız zaten giden e-postaya eklenir; konuya, başlığa, düğmeye girmez, e-postayı tek başına
  göndermez ([BILDIRIMLER.md](BILDIRIMLER.md)).
- **Haftalık özet (pazartesi):** maddelerin üstünde bir satır, kasa cirosunun altında: "Önümüzdeki 7 gün beklenen
  satış ≈ 72.000 ₺ · en yoğun gün Cumartesi". Yalnız kalite tam, karma ya da ortalamayken; kapalı günler toplanmaz,
  okunamazsa satır düşer ([HAFTALIK-OZET.md](HAFTALIK-OZET.md)).
- **Günlük işler:** sabah işinin `forecast` adımı: "Tahmin kaydedildi", "Tahmin kaydedildi, hava alınamadı", "Tahmin:
  veri yok", "Tahmin hata". Paraşüt'ün yeniden denemesiyle aynı anda başlar, e-postadan önce beklenir (en çok 7 sn);
  yalnız hata işi "kısmen" yapar.

## 9. Tablolar, anahtarlar, dosyalar

- `special_days`, `weather_days`, `forecast_snapshots` (migration `satis_tahmini`, eklemeli); `integration_state` ›
  `forecast.settings` (kişi başı, en az / en çok, tatlı kategorilerinin adları, hava, personel, e-posta) ve
  `forecast.weather`. Yedeğe kendiliğinden girer; `db:reset` hiçbirine dokunmaz.
- Kayıt büyümesi: günde 7 tahmin ve 1 hava satırı; temizlik işi yok.
- Saf: `src/lib/forecast/{calendar,model,weather,staffing,desserts,accuracy,text}.ts`; sunucu:
  `src/server/forecast/{load,mix,weather,job}.ts`; eylemler `src/server/actions/forecast.ts`; ekran
  `src/app/panel/tahmin/*`, Bugün kartı `src/app/panel/bugun/today-forecast.tsx`. Testler
  `tests/satis-tahmini.test.ts` (MET örnek yanıtı `tests/fixtures/tahmin/met-compact.json`).

# Bugün

Ekran: **Bugün** (`/panel/bugun`; menüde Genel bakış'ın hemen altında, telefonda alt menüde **Bugün**). "Bugün ne
yapmam gerekiyor, ne bitti?" sorusunun cevabı tek ekranda. Personel girişte burada açılır; yöneticinin ana sayfası
Genel bakış olarak kalır.

Ekranda yeni bir yazma eylemi yok: her satır ilgili ekranın doğru yerine götürür, hatırlatıcıyı tamamlamak ve ödemeyi
"Ödedim" demek var olan eylemlerle yapılır.

## Düzen

Başlıkta takvim günü ve durum: "23 Ekim Cuma · 3 iş bekliyor (1 sorun) · 2 hatırlatıcı", "Şimdilik iş yok · 2 iş
sonra" ya da "Bugünün işleri tamam".

| Kart | Kimde | İçerik |
|------|-------|--------|
| **Yapılacaklar** | İkisi | Üç bölüm: **Şimdi** (sorunlu ve yapılacak işler), **Sonra** (zamanı gelmemiş), kapalı **Tamamlananlar**. İlk sorunlu iş (yoksa ilk yapılacak) **sıradaki**dir: siyah çerçeve ve "Sıradaki: Raporu gir →" hapı. Dünkü kontrol listeleri (`liste-dun`) başka yapılacak ya da sorunlu satır varken hiçbir rolde sıradaki olmaz (geçmişe bakmaktır). Yöneticide altta "Bu ayın işleri Genel bakış'ta →" |
| **Hatırlatıcılarım** | İkisi | Geciken ve bugünkü hatırlatıcılar (en çok 6; fazlası "Tümü (14)"). ✓ ile tamamlanır, bildirimde "Geri al" |
| **Yaklaşan ödemeler** | Yönetici | Genel bakış'taki kartın aynısı: geciken ve 7 gün içindekiler, tek dokunuşla "Ödedim" |
| **Satış tahmini** | Yönetici | Bugünün tahmini (Z toplamı, ≈ 18.500 ₺) ve aralığı, yoğunluk (Yüksek / Normal / Düşük), kaç kişi ("3 kişi · yoğunsa 4"), kaç tatlı, en çok üç etiket ("Cumhuriyet Bayramı +%20"), 7 günün çubukları (rakamsız; dokununca Satış tahmini'nde o gün) ve altta "Dün: tahmin …, gerçekleşen …" (bugünün raporu girildiyse bugünün sonucu). Kaba tahminde "Kaba tahmin: kasa raporu biriktikçe netleşir."; kapalı işaretli günde "Bugün kafe kapalı olarak işaretli (Tadilat)." Okunamazsa kart çizilmez ([SATIS-TAHMINI.md](SATIS-TAHMINI.md)) |
| **Şubelerde dün / bugün** | Yönetici | Sağ sütunun başında (Design Lab'in "Şube günlük ciro özeti"; B ve C varyantlarının birleşimi). Bütün açık fiziksel şubeler bugünün gün sonunu gönderdiyse bugün, yoksa dün (yarım günün toplamı gösterilmez). Üstte şubelerin toplam cirosu (ödenmez / ikram hariç, `src/lib/cash-revenue.ts`), geçen haftanın aynı gününe göre değişim (yalnız iki günde de verisi olan şubelerle), fiş sayısı, son sekiz günün toplam cirosunun çizgisi (Arc UI sparkline: gün sonu gelmeyen gün çizilmez, eksik şubeli günün adında "n şube eksik"; üzerinde gezinince o günün cirosu; `dailyTrend`); altında ödeme dağılımı (kart, nakit, yemek kartı, online, diğer; renk yanında ad, tutar ve pay). Şube satırı: ciro, değişim, fiş ve ortalama fiş, LafPOS'tan geldiyse "LafPOS gün sonu", ModPOS föyünden geldiyse "ModPOS API'den", kasa farkı 1 ₺'yi geçerse "Kasa eksik / fazla …" rozeti; gün sonu yoksa "Gün sonu yok". Satır o şubenin o günkü Kasa'sına götürür (`?gun=…&sube=…`). Kaynak önceliği ay rakamınınkiyle aynı (`tillRows`): kasa raporu > LafPOS gün sonu (geçiş gününden itibaren) > kapanmış ModPOS föyü (yalnız Ayarlar › ModPOS › Ay rakamına yedek açıkken ve ModPOS günlerinde; föyün kasa farkı yazılmaz; denetim 13 Kasım HM-09). laffogato.net online kanalı bu kartta yok. Seçili şubeden bağımsız (`src/lib/branch-day.ts`, `src/server/data/branch-day.ts`, `tests/branch-day.test.ts`). Okunamazsa ya da kasa hiç kullanılmadıysa kart çizilmez |
| **Kıyas** | Yönetici | Şubelerde dün / bugün'ün altında, Genel bakış'taki kartın aynısı tek sütunda ([KIYAS.md](KIYAS.md)): son kapanmış iş gününün cirosu (bütün şubeler bugünü kapattıysa bugün, yoksa dün; 05:00 kuralı), önceki gün, geçen hafta aynı gün ve geçen ay aynı tarih ile tutar, ₺ fark ve yüzde hapı ("↑ +%12,4"); hafta başından, ay başından ve son 7 günün ciro toplamı ve kıyası; fiş ve ortalama fiş veri varsa. Seçili şubeye uyar. "Veri yok" ve "satış yok" sıfır gibi yazılmaz; Marina'nın geçiş günü öncesi LafPOS deneme günleri sayılmaz. Okunamazsa ya da kasa hiç kullanılmadıysa kart çizilmez |
| **Bugün kafede** | İkisi | Personelde önce satış tahmininin satırları (Satış tahmini › Tahmin ayarları'nda "Personel bugünün yoğunluğunu görsün" açıkken): "Bugün yoğunluk: Yüksek · Cumhuriyet Bayramı, yağmur" ve "Tatlı: bugün ≈ 8 satılır (en çok San Sebastian, Marlenka)"; tutar, aralık ve kişi önerisi personele hiç gitmez. Sonra karaoke odası (süren oturum ya da "Süre doldu", iş gününün rezervasyonları ve rezervasyonsuz oturumları, sıradaki; ödenmemiş tutma ve iptal sayılmaz) ve uygulama siparişleri ("2 açık uygulama siparişi · 1 teslime hazır"; yalnız sayı, liste son 30 dakikada siteden doğrulanmadıysa yazılmaz: bağlantı kopmuş olabilir; Siparişler ekranına götürür). Satırın kendi adresi varsa ona götürür (yoğunluk satırı personelin Özel günler'ine), yoksa bar ekranına; tatlı satırı bağlantısız. Sonda bar ekranının Tükenenler kartıyla kapatılıp hâlâ satışta olmayan ürünler: "Tükendi: Tiramisu, Cheesecake" (en eskisi önce, en çok 3 ad), `/panel/karaoke#tukenenler`'e götürür; personelin kaydı 16 saatten eskiyse uyarı rengi ve "Tiramisu 2 gündür tükendi: geldiyse satışa açın" (dalga 10 §2.1, [SITE-MENU.md](SITE-MENU.md) › Personel: Tükendi / Satışa aç). "Bar ekranı" düğmesi. Tutar ve sipariş sahibinin adı yazmaz. laffogato.net bağlı değilse ve bugün oturum yoksa görünmez |

Geniş ekranda (xl) solda Yapılacaklar, sağda öteki kartlar (yöneticide Şubelerde dün / bugün, Kıyas, Hatırlatıcılarım, Yaklaşan ödemeler, Satış tahmini, Bugün
kafede); telefonda tek sütun, bu sırayla.

**Telefon deseni** (29 Eki 2026, [planlar/ux-sade.md](planlar/ux-sade.md) §4.8; [TASARIM.md](TASARIM.md) §6 "Uyarı
bütçesi"): Yapılacaklar'da yalnız **sıradaki** iş tam kart (açıklamasıyla); öteki işler "Diğer {n} iş" düğmesinin
arkasında, açıklamasız tek satır. Kartın en altında yan yana tek satır: **Sonra (n)**, **Tamamlananlar (n)** ve
yöneticide "Ayın işleri Genel bakış'ta" bağlantısı; düğmeler (`aria-expanded`) listeyi satırın altında tam genişlikte
açar. Telefonda "Şimdi" başlığı yalnız ekran okuyucuya. Sıradaki iş yoksa bütün işler tek satır, düğme yok. Geniş
ekran aynı (Sonra açık bölüm, Tamamlananlar kapalı `<details>`). Ödeme düğmesi "Ödedim" (boş daire, ikincil); yeşil
"Ödendi" yalnız durum rozeti. Personelde sesli uyarıların kilidi sayfanın içindeki "Sesli uyarılar kapalı" satırıdır
(yüzen düğme yok).

## Satırlar

Durumlar Genel bakış'taki "Bu ayın işleri"yle aynı: **Tamam**, **Yapılacak**, **Sorun var**, **Sonra**. Satırlar
bu sırayla yazılır; bölümler sırayı korur.

| Satır | Kimde | Kural |
|-------|-------|-------|
| Günlük işler (`isler`) | Yönetici | Yalnız canlıda: sabah işi çalışmadı / hata verdi / yarıda kesildi, Paraşüt işi hata verdi / yarıda kesildi, CRON_SECRET yok (Genel bakış şeridinin "ciddi" uyarıları, `src/server/jobs/alerts.ts`) → sorun var, en üstte, Ayarlar › Günlük işler. Paraşüt eşitlemesinin hatası burada söylenir (Faturalar satırında değil; zildeki gibi ayrı bir "Paraşüt eşitlemesi başarısız" satırı yok): Paraşüt işinin hatası, sonradan başarılı bir eşitleme olana kadar görünür. Sabah işi eşitlemeyi yeniden dener; o ya da Paraşüt › Şimdi eşitle başarılı olunca satır kalkar |
| Dünkü kasa raporu (`kasa-dun`) | İkisi | Yönetici: farkı (eksik sorun, fazla yapılacak, tutuyorsa tamam), "Mehmet · Z … · nakit … · kart …", güncellendiyse ve not. **Açılış devirle tutmuyor**, **Ertesi gün düzeltildi** ya da (ModPOS gününde, rapor saklanan kasa föyünden farklıysa; zil ile aynı kural, [MODPOS-API.md](MODPOS-API.md)) **ModPOS föyünden farklı** satırı "sorun var" yapar. Girilmediyse yapılacak (personel bugün de girebilir); personel "kafe kapalıydı" dediyse "Onay bekliyor", eylem "Onaya bak" (dalga 10 §2.9). Personel yalnız girilmediyse görür: "{dün} raporu girilmedi. Kafe açıktıysa bugün girin; kapalıysa raporun sayfasında “Kafe kapalıydı” deyin. Yarından itibaren yöneticinin onayıyla girilir." (§2.6). Kapalı bildirimi beklerken rozet "Onayda" ve "Ahmet kapalıydı dedi (onay bekliyor). …"; onaylandıysa satır yok; reddedildiyse ve gün hâlâ açıksa "Yönetici bildirimi reddetti{: not}. Raporu bugün girin." (§2.9). Kasa hiç kullanılmadıysa ya da ilk rapor dünden sonraysa satır yok |
| Dünkü kontrol listeleri (`liste-dun`) | İkisi | Yönetici: dünün tamamlanmayan ya da sorunlu (aralık dışı ölçüm, "Sorun var"; sonradan düzeltilen dahil) listesi varsa sorun var: "Kapanış: 3 madde yapılmadı · Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)", rozet "1 eksik" ya da "2 sorun". Dünün kasa raporu da yoksa (kasa kullanılmaya başladıysa) "Kasa raporu da yok; kafe kapalıysa önemsemeyin." Kontrol geçmişinin o gününe götürür ([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md)). Personel (dalga 10 §2.5): yapılacak (sorun değil), yalnız açık sorunlar ve başlamış listelerin eksik maddeleri; hiç açılmamış liste yalnız dünün kasa raporu varken (kafe açıktı) yazılır; eylem "Geçmişe bak" (son 7 gün). Dün onaylı kapalıysa ve liste açılmadıysa satır yok; kapalı bildirimi beklerken açıklamanın sonunda "Personel kapalıydık dedi (onay bekliyor)" |
| Ödemeler (`odeme`) | Yönetici | Geciken sorun var ("Ödendiyse işaretleyin"), bugünkü yapılacak, ikisi de yoksa tamam (yaklaşanlar bilgi) |
| Hakedişler (`komisyon`) | Yönetici | Yemek kartı ya da platform hakedişinin son günü geçtiyse ve "Hakediş geldi" işaretlenmediyse sorun var: "Pluxee hakedişi (Eylül satışları): son gün 20 Ekim. 1 hakediş daha gecikti. Geldiyse işaretleyin.", rozet "2 gecikti", Komisyon & hakediş'e götürür. Ay hakedişin satış ayıdır (ayın 1–5'inde kesilen yemek kartı faturası önceki ayındır; platformda son gün 90 güne kadar sonra), bu yıldan değilse yılıyla yazılır ("Ekim 2025 satışları"). Geciken yoksa satır yok ([KOMISYON.md](KOMISYON.md)) |
| Faturalar (`fatura`) | Yönetici | Kontrol bekleyen fatura ya da kasadan faturalı alım (faturası yok, Aylık harcamalar'a yazılmadı; denetim E-42) varsa yapılacak, yoksa tamam. Aylık harcamalar'a yazılmışken faturası gelen kasa alımı (iki kez sayılıyor: gider kaydını silin) da sayılır. Yalnız kasa alımları varsa rozet "2 kasa alımı" ve Faturalar'daki karta götürür |
| Ürün bağlantıları (`urun`) | Yönetici | Hammaddeye bağlanmayı bekleyen fatura ürünü varsa |
| Fiyatı girilmemiş hammaddeler (`fiyat-yok`) | Yönetici | Paket fiyatı 0 olan etkin hammadde varsa (çoğu sayımda "Listeye ekle" ile eklenen); faturadan gelen ilk fiyatı onay bekleyen sayılmaz, o "Fiyat onayı"nda (E-06) |
| Onaylar (`onay`) | Yönetici | Onay bekleyen reçete önerisi ya da personel isteği varsa ([ONAYLAR.md](ONAYLAR.md)): rozet "4 bekliyor". Yalnız reçete önerisi varken "Personelin önerdiği 2 reçete değişikliği ve 1 yeni ürün önerisi onay bekliyor: Latte, Mocha…"; personel isteği de varsa türler tek satırda ve en eskisinin beklediği: "1 kasa düzeltmesi · 2 reçete değişikliği · 1 geç zayi / ikram · en eskisi 2 gündür" (karaoke sayacı silme isteği zayinin ardından). Tutar yok. Onaylar'a götürür |
| Fiyat onayı (`fiyat-onay`) | Yönetici | Onay bekleyen hammadde fiyatı varsa (Hammaddeler › Onay bekleyen fiyatlar): Paraşüt faturasında şimdikinden %40'tan fazla farklı gelen ya da fiyatı olmayan hammaddenin çarpanı faturanın kg / lt biriminden gelmeyen ilk fiyatı ("Faturadan gelen ilk fiyat, çarpanı kesin değil"; onaylanana kadar maliyette 0 ₺) |
| Hammadde zammı (`zam`) | Yönetici | Fiyatı önerilenin altında kalan ürün varsa; metin Genel bakış ve zil ile aynı (zammın ayda kaç lira kâr götürdüğü) |
| Kasadaki fiyatlar (`modpos`) | İkisi | Yönetici: "Kasada değişecek 3 fiyat": ModPOS'ta elle değiştirilip Fiyatlar › Kasaya işle'de işaretlenecekler; son 48 saatte personel işaretlediyse sonuna "Ayşe dün 3 fiyatı kasada işaretledi." Bekleyen yok ama personel işareti varsa satır tamam olur ve "Son işaretlenenler"e götürür (dalga 10 §2.2). Personel (§2.2): "ModPOS'ta değişecek 3 fiyat; değiştirdikçe işaretleyin. En eskisi 2 gündür bekliyor.", eylem "Listeyi aç", `/panel/kasa/fiyatlar`; kontrol listelerinden sonra, zayiden önce gelir. LafPOS'a geçiş gününden itibaren satır yalnız yöneticide: yalnız siteye bağlı olmayan, fiyatı LafPOS günü panelde değişen ürünler sayılır, metin "LafPOS'ta yerel ürünse orada elle değiştirip …; LafPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın" der (siteye bağlı ürünün fiyatını LafPOS siteden alır). Personelde satır yok: LafPOS'ta ürün fiyatını kasiyer değiştiremez (denetim B11) |
| Geçen ayın stok sayımı (`sayim-gecen`) | İkisi | Ayın ilk 10 gününde geçen ayın sayımı yoksa ("Girilmedi") ya da yarım kaldıysa ("12 / 40", "Sayıma devam"). Geçen aya götürür. Stok sayımı ekranı da adreste ay yokken aynı kuralla (iş günü, 05:00; tamam = listedeki her kalem sayıldı) yarım kalan geçen ayı açar ve ayı adrese yazar. Personel geçen ayın sayımını yalnız bu 10 günde değiştirir; sonrası yöneticide |
| Personelin geç sayım kaydı (`sayim-personel`) | Yönetici | Personel geçen ayın sayımını ay bittikten sonra (sonraki ayın 1'i 05:00'ten sonra; personel yalnız ilk 10 günde yazabilir) değiştirdiyse: "Ayşe, Ekim 2026 sayımını değiştirdi" · "Ay bittikten sonra 2 kayıt, 5 kalem. Geçen ayın kapanışı mal maliyetini, kârı ve bu ayın açılışını değiştirir: kontrol edin.", rozet "Kontrol et", o ayın sayımına götürür. Son kayıt son üç iş günündeyse; sonrası yalnız zilde. Kaynak işlem geçmişi (hesabı personel olan "Stok sayımı" ve "Sayım ek kalemleri" kayıtları; `src/server/data/count-alerts.ts`) |
| Fiyatsız ek kalemler (`sayim-ek-fiyat`) | Yönetici | Bu ayın ya da geçen ayın sayımında "Listede olmayanlar"a miktarıyla girilmiş, birim fiyatı olmayan kalem varsa: "Ekim 2026: 2 ek kalemin fiyatı yok: Bulaşık deterjanı, Kağıt havlu · Birim fiyatı girilmezse kapanış stoğuna 0 ₺ girer…", rozet "2 kalem", o ayın sayımının ek kalemler bölümüne götürür. Fiyat girilince kalkar (denetim E-22). Ek kalemler şube başına: birden çok şube açıkken her ayın her şubesi ayrı ("Kasım 2026 (Marina): …"), bağlantı o şubenin sayımını açar (`&sube=`) |
| Kontrol listesi (`liste-{şablon}`) | İkisi | Bugün beklenen her liste ayrı satır, açılış saatine göre (personelde yalnız "Personel doldurabilir" listeler; pasif liste yok). Aralıktan önce sonra ("08:00–11:00"), aralıkta yapılacak (başladıysa "3 / 13 madde · Ayşe · son saat 11:00" ve kalan fotoğraf), son saatten sonra sorun var ("Gecikti"; personele "Gün 05:00'te kapanır."), bitince tamam (kim, saat, geç bittiyse "geç", fotoğraf sayısı). Yöneticide açık sorunu olan bitmiş liste "1 sorun" (sorun var). Okunamazsa tek gri "Kontrol listeleri · Okunamadı" satırı |
| Zayi & ikram (`zayi`) | Personel | Gün içinde "Gün içinde" (bilgi), akşam rapor gönderilmeden "Rapordan önce" (yapılacak), rapor gönderilince tamam. Günün kayıt sayısı ve özeti |
| Kasa raporu (`kasa`) | İkisi | Gündüz "Akşam" (sonra), 20:00'den sonra yapılacak, gönderilince personelde "Gönderildi" (tamam), yöneticide farkı ve bütünlüğü (dünkü gibi). Personelin akşam metni günün kasasıyla: "Kapanışta ModPOS'tan Z raporunu alın …", LafPOS'a geçiş gününden itibaren "Kapanışta LafPOS'ta Günü kapat'a basın (gün sonu panele gönderilir) …" (`eveningCashText`; denetim B11) |
| Ay sonu stok sayımı (`sayim-son`) | İkisi | Ayın son günü: başlamadıysa "Sayıma başla", yarıdaysa "12 / 40", bittiyse tamam (sayım formundaki "kalem sayıldı" ile aynı kural) |

Personelin satır sırası: `kasa-dun`, `liste-dun`, `sayim-gecen`, `liste-*`, `modpos`, `zayi`, `kasa`, `sayim-son`.
Hızlı sayım (`hizli-sayim`), mal siparişi (`mal-siparisi`) ve onaylanan sipariş taslağı (`mal-taslak`) satırları 26
Ekim 2026'da özellikleriyle birlikte kalktı ([MAL-SIPARISI.md](MAL-SIPARISI.md)); Onaylar satırı eski taslakları
saymaz. Yöneticiye zayi satırı gösterilmez (zayi ve ikram kasa raporu e-postasında gelir).
Personel maliyet, alış fiyatı, ödeme, fatura ve karaoke tutarı görmez; kasa farkı personelin Kasa ekranında zaten
gördüğü bilgidir, menünün satış fiyatı herkese açıktır. Yöneticinin olguları personel için hiç yüklenmez (`adminFacts` /
`staffFacts`; `tests/bugun.test.ts` kaynaktan denetler), satır mantığı da rolü ayrıca denetler.

Dalga 10 (personel yetkileri, [planlar/personel-yetki.md](planlar/personel-yetki.md)) satırları iki dosyaya böler:
kasa ve ortak satırlar `logic.ts`'te, operasyonun satırları (kasadaki fiyatlar, dünkü kontrol listeleri, "Bugün kafede"nin Tükendi
satırı) `rows-ops.ts`'te; olguları `src/server/data/today-ops.ts` iki rolde toplar (personelin dalı yalnız
sabit sütunlu personel yükleyicilerini okur). Dünün kapalı gün durumu `closed` olgusundan
(`src/server/closed-days.ts`). Bugünün ve dünün kontrol listeleri iki rolde tek okumada gelir.

## Saatler (Türkiye)

- **İş günü 05:00'te döner:** kasa ve zayi satırları Kasa ve Zayi ekranlarıyla aynı güne bakar. Gece 05:00'ten önce
  açıklama hangi güne baktığını tarihle söyler ("22 Ekim Perşembe · …"); başlıktaki tarih takvim günüdür.
- **Akşam 20:00:** bugünün kasa raporu bundan sonra beklenir. Zil de aynı kurala bakar (`isCashEvening`,
  `src/lib/cash-report.ts`).
- **Takvim günü:** ödemeler, hatırlatıcılar ve sayım. 1 Kasım 00:30'da ay sonu satırı çıkmaz; Ekim sayılmadıysa ya da
  sayımı yarım kaldıysa "Geçen ayın stok sayımı" çıkar ve Ekim'e götürür (gece kapanıştan sonra başlayan sayım ertesi
  sabah da sürebilir).
- Ekran 00:00, 05:00 ve 20:00'de, kontrol listelerinin açılış ve son saatlerinde (satır 08:00'de "Yapılacak", 11:00'de
  "Gecikti" olsun) ve karaoke oturumu başlayınca ya da bitince kendiliğinden yenilenir; sekme bir
  dakikadan uzun gizli kalıp görünür olunca da. Başka ekrana gidilip geri tuşuyla dönülünce korunan eski hâli
  yenilenir (Kasa'da gönderilen rapor, Ödemeler'de ödenen kayıt görünsün); menüden ya da alt menüden açılınca zaten
  yeniden çizilir. Bildirim gelince (yeni rezervasyon, uygulama siparişi), saatli hatırlatma uyarısından "Tamamlandı"
  denince ve süresi dolan oturum uyarıdan bitirilip uzatılınca da yenilenir.

## Bir kaynak okunamazsa

Sayfa yine açılır. Kasa, ödemeler ve kontrol listeleri "Okunamadı" diye gri satır çıkarır; ötekiler sessizce düşer, hata sunucu
günlüğüne yazılır (`[bugun]`).

## Yeni satır eklemek

1. **Olgu:** `DayFacts`'e isteğe bağlı bir alan (`src/app/panel/bugun/logic.ts`). Yöneticiye aitse yalnız
   `adminFacts`'te, personele aitse yalnız `staffFacts`'te, ikisine aitse `loadToday`'de yüklenir
   (`src/server/data/today.ts`). Operasyonun olguları `ops` alanında (`OpsDayFacts`, `rows-ops.ts`), yükleyicisi
   `src/server/data/today-ops.ts`. Her yükleyici `safe(…)` ile sarılır (`src/server/data/today-safe.ts`).
2. **Fonksiyon:** satırı üreten küçük bir fonksiyon (olgu yoksa ya da sayı 0 ise `null`); `ADMIN_ROWS` /
   `STAFF_ROWS`'ta yerine (ör. komisyon: `komisyon`).
3. **Test:** `tests/bugun.test.ts`'e bir senaryo; yönetici yükleyicisiyse kaynak denetimindeki listeye adı.

Satırın saati varsa (ör. açılış listesi 08:00'de açılır) `nextRefreshAt(now, [an])` ekranı o an yeniler.

Dosyalar: `src/app/panel/bugun/` (sayfa, `logic.ts`, `rows-ops.ts`, kartlar), `src/server/data/today.ts` ve
`today-ops.ts`, durum görünümü
`src/app/panel/task-style.tsx` (Genel bakış'ın "Bu ayın işleri" ile ortak). Test: `tests/bugun.test.ts`.

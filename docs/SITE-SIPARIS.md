# laffogato.net siparişleri: Siparişler ekranı

Ekran: **Siparişler** (`/panel/siparisler`; 6 Kasım 2026'ya kadar Karaoke ekranının en üstündeki **Uygulama
siparişleri** bölümüydü). Personel ve yönetici: personelin menüsünde Bugün'ün hemen altında (telefonun alt menüsünde
de), yöneticide **Kafe › Siparişler**; menü satırında açık sipariş ve masa çağrısı sayısı. Karaoke ekranında yalnız tek
satır kalır ("3 açık uygulama siparişi · 1 masa çağrısı" · **Siparişler'e git**). Bağlantının durumu ayrıca **Ayarlar ›
laffogato.net**'te. Sözleşmenin sitedeki kopyası: laffogato deposunda `docs/PANEL-ORDERS.md` (uçlar, gövde, hata kodları;
sitenin kuralı `src/lib/panel/orders-feed-core.ts`). Kartın aşama düğmeleri sitenin imzalı aşama ucuna gider
(`POST /api/panel/orders/stage`, aşağıda **Aşama düğmeleri**), masa çağrısının **Gördüm**'ü çağrı ucuna
(`POST /api/panel/calls/ack`, aşağıda **Masa çağrıları**).

## Geliştirilmiş istek (prompt)

> Operatör (22 Eki 2026): _"laffogato admin ile lafmaliyette paralel çalışabilecek neler varsa ... beraber
> çalışsın"_.
>
> Uygulamadan ve web'den gelen, ödenmiş kafe siparişleri barın hep açık duran ekranına (Karaoke) düşsün; barista
> siparişi orada görsün, ekran çalsın, sipariş sitede ilerletilince ekrandan kalksın.
>
> - **Kart:** nereye ("Masa 4", "Gel-al", "Kurye"), aşama (Yeni / Hazırlanıyor / Teslime hazır), planlı saat
>   ("14:30 için"), müşterinin **yalnız adı**, satırlar ("2× Latte · M · yulaf · +1 shot"), ödemeden bu yana geçen
>   dakika ve siparişi sitenin panelinde açan **Sitede aç**. İçeceğin reçetesi menü bağlantısıyla açılabilsin.
> - **Zil:** cihazın görmediği her yeni siparişte bir kez; masa siparişi önce ve daha belirgin. Sekme arka plandayken
>   ya da kapalıyken Web Push.
> - **İade ve iptal sitenin panelinde yapılır.** (İlk istekte "Hazırlanıyor" ve "Teslime hazır" da oradaydı ve panel
>   siparişi hiç ilerletmiyordu; aynı gün aşama bar ekranına geldi, aşağıdaki ikinci istek.)
> - **Sürekli sorgu yok:** site her sipariş yazımında içeriksiz, imzalı bir ping atar; panel imzalı tek bir okumayla
>   çeker. Ping kaçarsa ekran açılınca, öne gelince ve seyrek bir yedek kontrolde yeniden sorar; Neon uyuyabilsin.
> - **KVKK:** siparişlerin geçmişi tutulmaz (son liste her çekmede üzerine yazılır), ad günlüğe ve işlem geçmişine
>   yazılmaz, bildirimde ad yok; siteden sözleşmedekinden fazlası istenmez.
> - Bağlantı kapalıyken ya da site düşükken ekranın geri kalanı (karaoke sayacı) aynen çalışır; durum tek, sessiz bir
>   satırla söylenir.

> Operatör (22 Eki 2026, ikinci istek): barista aşamayı bar ekranından **tek dokunuşla** değiştirsin, en önemlisi
> **Hazır**; onay sorulmasın.
>
> - **Düğmeler:** yeni siparişte "Hazırlanıyor" ve teslim biçimine göre hazır düğmesi (gel-al **Hazır**, masa
>   **Masaya götürüldü**, kurye **Kuryeye verildi**); hazırlanırken yalnız hazır düğmesi; tezgâhta bekleyen gel-al'da
>   **Teslim edildi**. Büyük, başparmağa göre; istek sürerken kartın düğmeleri kapalı, çift dokunuş gitmez.
> - **Durum makinesi sitede kalır:** panel sitenin imzalı aşama ucunu çağırır; ödeme, stok, sadakat, e-posta ve
>   bildirim sitede işler. Kimin yaptığı sitenin olay kaydına düşer (`panel:<ad>`).
> - **Eşzamanlılık:** panel son gördüğü aşamayı gönderir; sipariş arada değiştiyse site reddeder, ekran yenilenir.
> - İade ve iptal yine yalnız sitenin panelinde (**Sitede aç**).

> Operatör (6 Kas 2026): _"mobil uygulamadan gelen siparişler lafmaliyette kendi Siparişler bölümünde olsun,
> laffogato.net'e bağlı olsun, orada da görünsün ve zil çalsın."_
>
> - **Kendi ekranı:** sipariş panosu Karaoke'den **Siparişler**'e taşınır (aynı kartlar, aşama düğmeleri, notlar,
>   reçete bağlantıları, durum satırları, zil satırı). Başlıkta **laffogato.net'te aç** (sitenin sipariş paneli, yeni
>   sekme) ve **Yenile**. Menüde "Siparişler" satırı ve açık sayısı; telefonun ana ekranında kısayol.
> - **Zil:** "Gör" ve telefon bildirimi artık Siparişler'e götürür.
> - **Masa çağrıları (yeni):** masadaki QR menüden "Garson çağır" (garson, su, peçete) sitenin sipariş listesine
>   eklenir; Siparişler'in üstünde kart, siparişten ayrı zil, tek dokunuşla **Gördüm** (sitede de kapanır). Müşteriye
>   dair bir şey yok.

## Nasıl çalışır

```
laffogato.net                                    ladmin.laffogato.net (bu panel)
─────────────                                    ──────────────────────────────
sipariş yazıldı (live:orders)
  └─ after(): POST /api/orders/ping  ─────────▶  imza doğru → 202 (hemen)
     {"event":"orders.changed","at"} (imzalı)       └─ after(): çek (hata olursa 4 sn sonra bir kez daha)
                                                       GET laffogato.net/api/panel/orders (imzalı)
GET /api/panel/orders  ◀────────────────────────        ├─ doğrula (sürüm 1; bozuk sipariş / çağrı atlanır)
  {version:1, now, complete, orders:[…],                ├─ son listenin kopyası (site_orders; üzerine yazılır)
   awaitingPayment, calls:[…]}                          ├─ ödeme bekleyen sayısı > 0: ekran 30 dk yoğun
  yalnız açık kafe siparişleri ve 15 dakikadan          ├─ değiştiyse sürümü artır (canlı ucun ETag'i)
  yeni açık masa çağrıları, beyaz liste                 └─ ilk kez görülen yeni sipariş / çağrı: Web Push "orders"
                                                              └─ service worker → açık sekme /api/canli'yi
                                                                 yeniler, zil çalar, kart gösterir

                                                 barista karttaki düğmeye dokundu (sunucu eylemi, oturumlu)
POST /api/panel/orders/stage  ◀─────────────────  {"id","action","from","actor"} (imzalı)
  sitenin durum makinesi: ödeme, stok, sadakat,
  e-posta, bildirim; olay kaydına panel:<ad>
  200 {order} · 409 {error:"stale",order} ───────▶  çek (yukarıdaki gibi; son listenin kopyasını yalnız çekme yazar)
                                                    └─ bildirim "#10234 hazır" ya da "bu arada değişti"; ekran yenilenir

                                                 barista çağrıda "Gördüm"e dokundu (sunucu eylemi, oturumlu)
POST /api/panel/calls/ack  ◀─────────────────────  {"id","actor"} (imzalı)
  çağrı kapanır (tekrar aynı yanıt), ping atar
  200 {ok,call:{id,status:"acked"}} · 404 ───────▶  çek; bildirim "Masa 4 · görüldü" (404: "zaten kapanmış")
```

Ekran veriyi canlı uçtan (`/api/canli`) alır; sipariş listesinin (çağrılar dahil) sürümü ETag'tedir (`W/"<karaoke>.o<sipariş>.…"`),
değişiklik yoksa 304 ve veri okunmaz. Siteyi ekranın kendisi değil sunucu sorar: ekran `POST /api/siparisler`
(`{maxAgeMs}`, oturum gerekir) ile "son çekme bundan eskiyse sor" der. Sunucu eylemi değil uç: site 8 saniye bekletse
de ekrandaki öteki işler (sayaç, uzatma) sıraya girmez.

### Ekranda ne görünür

- **Sayfa başlığı:** "Siparişler"; **laffogato.net'te aç** (`{LAFFOGATO_URL}/admin/siparisler`, yeni sekmede; iade,
  iptal ve geçmiş orada) ve **Yenile** (bağlantı kuruluysa).
- **Sıra:** durum satırı (gerekince), "Zili aç" satırı (bu cihazda zil kapalıysa), **Masa çağrıları** (yalnız açık çağrı
  varken; aşağıda), **Uygulama siparişleri** kartı, en altta **Bu cihazda uyarılar** (Karaoke'dekiyle aynı kart).
- **Kartın başlığı:** "Uygulama siparişleri", rozetler "3 açık · 1 yeni", "1 masada".
- **Kart:** nereye (sitenin dili: "Masa 4", "Gel-al", "Kurye"), müşterinin adı, sipariş numarası, planlı saat
  ("14:30 için", başka gündeyse "Yarın 09:00 için"), aşama rozeti (**Yeni**, **Hazırlanıyor**, **Teslime hazır**),
  satırlar (adet kalın; ad ve seçenekler sitenin yazdığı gibi), "Ödendi · 7 dk önce" (10 dakikadan uzun bekleyen yeni
  sipariş turuncu; planlı sipariş ödemeden değil vaktinden sayılır: "45 dk kaldı", "Vakti geldi", geçince "7 dk
  gecikti", hâlâ yeniyse turuncu; `waitInfo`), **Sitede aç** (`laffogato.net/admin/siparisler/<id>`, yeni
  sekmede; yalnız sitenin kendi adresine giden `/admin/…` yolları bağlanır; iade ve iptal orada) ve kartın altında
  büyük **aşama düğmeleri** (aşağıda).
- **Müşterinin notu:** siparişe yazılan not ("Fındık alerjim var, şurupsuz lütfen") kartın üstünde turuncu kutuda,
  içeceğe yazılan not ("çok sıcak olmasın") satırın altında "Not: …" olarak (v1'e eklenen, isteğe bağlı `note`
  alanları; sipariş notu en çok 300, satır notu 200 karakter). Sipariş notu yalnız **masa** ve **gel-al** siparişinde
  gelir: kurye siparişinde o alan adres notuyla birleşiktir ("[adres notu] · [not]", kapı kodu, tarif); site
  göndermez, gönderse de panel atar (üyenin kurye siparişine yazdığı not da bu yüzden gelmez). Satır notu her
  siparişte gelir, kurye dahil (içeceğe yazılan nottur, adres değil).
  Not zile, telefon bildirimine ve günlüğe girmez; not değişince kart yenilenir.
- **Reçete:** satırın kalemi menü bağlantısıyla bir panel ürününe bağlıysa ([SITE-MENU.md](SITE-MENU.md); `L` → L
  yuvası, `M` ve tek boy → M yuvası) satırın yanında kitap simgesi: Reçete defterini o ürünün adıyla açar (sayfa
  yeniden yüklenmez; ses kilidi açık kalır).
- **Sıra:** önce hazırlanacaklar (Yeni ve Hazırlanıyor): masa siparişi en önde, sonra vakti en yakın olan (planlı
  saat, yoksa ödeme anı), sonra sipariş numarası; en sonda tezgâhta bekleyen gel-al'lar (Teslime hazır).
- **Boş:** "Açık uygulama siparişi yok. Sitede bir sipariş ödenince burada görünür ve zil çalar."
- **Durum satırı** (yalnız gerekince, sarı): son çekme başarısız ("Son kontrol başarısız: Siteye ulaşılamadı (son
  başarılı çekme 14:02). Siparişleri sitenin panelinde de kontrol edin."; son doğru liste ekranda kalır), sitenin
  listesi eksik (`complete: false`: "en yakın 200'ü gösteriliyor"), okunamayan sipariş ("2 sipariş okunamadı (panel
  güncel olmayabilir)"). Hatanın ayrıntısını yalnız yönetici görür; personelin satırı: "Siparişler şu an siteden
  alınamıyor (son başarılı çekme 14:02). Yeni sipariş burada görünmeyebilir; sorun sürerse yöneticiye haber verin."
  **Yenile** düştüğünde personelin bildirimi de ayrıntı taşımaz ("laffogato.net'e ulaşılamadı" · "Sorun sürerse
  yöneticiye haber verin.").
- **Bağlantı kurulmadıysa** sayfanın başında tek gri kutu: yöneticiye "Site bağlantısı kurulmadı: uygulama siparişleri
  ve masa çağrıları gelmiyor" (Ayarlar bağlantısı, kurulum ayrıntısı "Ayrıntı"da), personele "Site bağlı değil: sipariş
  ve masa çağrısı buraya gelmez" · "Yöneticiye haber verin."; Yenile düğmesi çıkmaz, kartın gövdesi çizilmez.
- Bu cihazda sipariş zili kapalıysa: "Bu cihazda sipariş zili kapalı; sipariş ve çağrıda ses çalmaz." · **Zili aç**.
- **Tükenenler** Karaoke ekranında kaldı (barın aracı): biten ürün personelce onaysız "Tükendi" yapılır (sitede,
  uygulamada ve QR menüde; M ve L birlikte), gelince "Satışa aç" (dalga 10 §2.1; [SITE-MENU.md](SITE-MENU.md) ›
  Personel: Tükendi / Satışa aç).
- **Karaoke ekranının satırı:** "3 açık uygulama siparişi · 1 masa çağrısı" (son çekme başarısızsa "siparişler şu an
  siteden alınamıyor") ve **Siparişler'e git**; açık sipariş ya da çağrı yoksa ve bağlantı sağlamsa satır yok. Bar o
  ekranda dursa da siteyi Siparişler ekranıyla aynı kuralla çektirir (`useOrdersFeed`), zil kabukta çalar.
- **Menü:** "Siparişler" satırında (telefonun alt menüsünde de) açık sipariş + çağrı sayısı, kabuğun canlı verisinden
  (ek istek yok; `src/components/panel/orders-badge.tsx`). Yöneticide Kafe grubu kapalıyken sayı grubun başlığında.
  Ekranın adresi telefona eklenen uygulamanın kısayollarında da ("Siparişler").

Aşama sitede değişince (bu ekranın düğmesiyle, sitenin panelinden ya da uygulamadan; ping → çekme) kart güncellenir,
sipariş sitenin listesinden çıkınca (masaya / kuryeye gitti, teslim edildi, iade, 24 saatlik unutulmuş sipariş kuralı)
ekrandan kalkar.

### Aşama düğmeleri

Tek dokunuş, onay sorulmaz (operatörün isteği). Panel aşamayı kendisi yazmaz: sitenin imzalı aşama ucunu çağırır,
siparişin durum makinesi (ödeme, stok, sadakat, e-posta, uygulamaya bildirim) sitede işler.

| Kartın aşaması | Düğmeler | Sitede ne olur |
|----------------|----------|----------------|
| **Yeni** | **Hazırlanıyor** (beyaz) · hazır düğmesi (siyah) | Hazırlanıyor; ya da tek dokunuşla doğrudan hazır |
| **Hazırlanıyor** | hazır düğmesi (siyah) | Hazır |
| **Teslime hazır** (yalnız gel-al) | **Teslim edildi** (siyah) | Teslim edildi; kart ekrandan kalkar |

Hazır düğmesinin adı teslim biçimine göre: gel-al **Hazır** (tezgâhta bekler, kart "Teslime hazır" olarak kalır),
masa **Masaya götürüldü**, kurye **Kuryeye verildi** (ikisi de kartı ekrandan kaldırır). Düğmeler büyüktür
(en az 48 px); dar kartta alt alta, genişte yan yana.

- **İstek:** `POST {LAFFOGATO_URL}/api/panel/orders/stage`, gövde yalnız `{"id","action","from","actor"}`
  (en çok 1 KB; site bilinmeyen alanı reddeder). `action`: `preparing` (yalnız `new`'den), `ready` (`new` ya da
  `preparing`'den), `delivered` (yalnız `ready`'den ve yalnız gel-al). `from` kartta görünen aşamadır. `actor` panelde oturum açmış
  kişinin görünen adı (boşluklar sadeleşir, en çok 80 karakter); site bunu olay kaydına `panel:<ad>` olarak yazar.
  İmza ötekilerle aynı (`x-laf-timestamp`, `x-laf-signature: v1=<hex>`, ortak `callSite` yardımcısı).
- **Sunucu eylemi** (`advanceSiteOrder`, `src/server/actions/site-orders.ts`): oturum ister (personel ve yönetici:
  baristalar bu ekranı kullanır); kimliği, işlemi ve aşamayı doğrular, olmayan çifti (ör. yeniden teslim edildi, masa
  siparişinde teslim edildi) siteye göndermeden reddeder. Numara ve teslim biçimi son listenin kopyasından okunur.
- **Sonra:** site kabul edince (200) ya da sipariş arada değiştiyse (409) panel sitenin listesini hemen yeniden çeker
  (`syncSiteOrders("manual")`); son listenin kopyasını yalnız çekme yazar, sürüm artar, ekran canlı uçtan yeni hâli
  alır. Bildirim: "#10234 hazırlanıyor", "#10234 hazır", "#10234 masaya götürüldü", "#10234 kuryeye verildi",
  "#10234 teslim edildi". Liste yeniden çekilemediyse açıklama "Ekran sitenin bildirimiyle birazdan güncellenir."
- **409 (eskimiş):** sipariş bu arada başka yerden ilerlemiş ya da işlem şimdiki aşamasından yapılamıyor. Hiçbir şey
  değişmez; liste yeniden çekilir, bildirim "Sipariş bu arada değişti (şimdi: Teslime hazır); ekran yenilendi." Aynı
  dokunuş bu yüzden iki kez uygulanmaz: ağ hatasından ya da zaman aşımından sonra yeniden dokunmak güvenlidir.
- İstek sürerken kartın bütün düğmeleri kapalıdır ve dokunulan düğmede dönen simge görünür; geçiş başlamadan gelen
  ikinci dokunuş gönderilmez. Sunucu eylemleri bir sekmede sırayla gider: site yavaşsa aynı sekmedeki karaoke
  düğmeleri de bu süre kadar bekleyebilir (sayfanın süre sınırı 30 saniye).
- **İade ve iptal** yalnız sitenin panelinde (**Sitede aç**). Panel siparişin tutarını, ödemesini ya da satırlarını
  değiştiremez.
- **İşlem geçmişi:** aşama değişiklikleri panelin işlem geçmişine yazılmaz; kaydı sitenin olay kaydı tutar
  (`panel:<ad>`). Barın her dokunuşu panelin işlem geçmişini doldurmasın (karaoke "Bitir" gibi).

### Zil ve bildirim

- Her cihaz, **daha önce görmediği** her `new` siparişte bir kez çalar; görülen kimlikler cihazda saklanır
  (`localStorage` `laf:gorulen-siparisler`). Zil kapalı cihazda da görülmüş sayılır (sonradan açılınca eskiler için
  çalmasın).
- **Masa siparişi** önce ve daha belirgin: ayrı, uzun desen (beş zil ve bir oktav, `table`), ekranın köşesinde
  turuncu bildirim 30 saniye. Gel-al ve kurye normal zil, yeşil bildirim 15 saniye. **Gör** Siparişler ekranına götürür
  (zil panelin her ekranında çalar; uyarı motoru kabuktadır).
- **Masa çağrısı** ayrı desenle (`call`: inen iki notalı kapı zili, üç kez), turuncu bildirim 30 saniye, "Masa 4 · Su
  istiyor"; görülen kimlikler ayrı anahtarda (`localStorage` `laf:gorulen-cagrilar`). Aşağıda **Masa çağrıları**.
- Sayfa ilk açıldığında iki dakikadan eski yeniler çalmaz, görülmüş sayılır (kartları zaten vurguludur); cihazın
  daha önce gördüğü sipariş sayfa yeniden yüklenince de çalmaz. Panel kapalıyken gelen bildirime dokunup iki dakika
  içinde açılan sayfa o siparişi bir kez daha çalar (barista sesi duysun).
- Panelin **ilk çekmesi** (hiç liste yokken) hiçbir siparişi yeni saymaz: bağlantı kurulunca o an açık olan
  siparişler için bildirim gitmez.
- **Planlı sipariş** ("Yarın 09:00 için" gel-al) hâlâ **Yeni**yken vaktine 15 dakika kala bir kez daha çalar:
  "Planlı sipariş · Gel-al", "09:00 için · 2× Latte" (ad yok), turuncu bildirim 30 saniye. Cihaz başına bir kez
  (`localStorage` `laf:planli-siparis-zili`); sunucu bu zil için bildirim göndermez, panel o cihazda açık olmalı (sekme
  arkadaysa ve bildirim izni varsa sistem bildirimiyle). Ekran sonradan açılırsa vakti yaklaşmış ya da en çok 15
  dakika geçmiş sipariş için çalar; iki dakikadan yeni ödenmiş sipariş için çalmaz (geliş zili az önce çaldı). Sipariş
  zili kapalı cihazda çalmaz (`src/lib/site-orders/feed.ts` › `dueSoonToRing`, `alert-center.tsx`).
- **Web Push** konusu `orders`: ilk kez görülen yeni siparişte sunucu bildirim gönderir ("Yeni sipariş · Masa 4",
  "2× Latte, 1× Matcha Latte"; birden çoksa "2 yeni sipariş", "Masa 4 · Gel-al"); yeni masa çağrısında "Masa 4 · Su
  istiyor" (birden çoksa "2 masa çağrısı"). Bildirime dokununca Siparişler açılır. **Müşterinin adı bildirimde yok**
  (kilit ekranı). Tercih aboneliğin `orders` sütununda (`drizzle/0019_siparis_bildirimi.sql`); boşsa personelin
  cihazında açık, yöneticininkinde kapalı.
- Cihaz tercihleri (**Bu cihazda uyarılar** kartı): **Sipariş bildirimleri** (push; sekme kapalıyken de) ve **Sipariş
  zili bu cihazda** (açık sekmede ses ve kart; personelde varsayılan açık, yöneticide kapalı). Sekme açıkken ses
  sekmeden çalar ve sistem bildirimi sessiz gelir ([KARAOKE.md](KARAOKE.md) › hoparlör seçimi aynen geçerli).

### Panel ne zaman çeker

| Tetikleyici | Ne olur |
|-------------|---------|
| Sitenin pingi (`/api/orders/ping`) | Hemen (202'den sonra, `after()`); hata olursa 4 saniye sonra bir kez daha |
| Ekran açılınca ya da öne gelince | Son çekme bir dakikadan eskiyse |
| Arka planda, yalnız ekran görünürken (Siparişler ya da Karaoke) | Ekranda sipariş ya da açık masa çağrısı varken, son iki saatte liste değiştiyse ya da sitede ödemesi beklenen sipariş varken (en çok 30 dakika, aşağıda **Ödeme takibi**) üç dakikada bir; sakinken saatte bir; son çekme başarısızsa dakikada bir. Sitenin pingi tek başına ekranı yoğun yapmaz. Sakin saatin saatlik kontrolü pingle yapılan çekmeyi saymaz |
| **Yenile** | Hemen; art arda basılırsa siteyi en çok on saniyede bir sorar (son çekme hatalıysa her basışta) |
| Günlük iş | Yok: Vercel'in cron kotası dolu, ping ve ekran yeter |

Son çekme hatalıysa ekranın her isteği (beş saniyeden eskiyse) siteyi yeniden dener: site geri gelince liste
beklemeden gelir. Açık sekmenin canlı veri kontrolü: ekran görünürken, ekranda açık sipariş varken (aşama değişikliği
çabuk görünsün) ya da bu cihazın sipariş zili yeni siparişi bildirimle almıyorken (izin yok, abonelik kaydedilemedi ya
da zil açık ama Sipariş bildirimleri kapalı) 20 saniyede bir; bildirim açık ve ekran boşken yeni sipariş bildirimle
gelir (kabuğun yedek kontrolü). Sipariş zili kapalı cihazda (yöneticinin dizüstü, zili kapatılmış ikinci ekran) boş
ekrana yeni sipariş kabuğun yedek kontrolüyle gelir: bildirim izni varsa 30 dakikaya, yoksa 1–10 dakikaya kadar; son iki
saatte sitede sipariş olduysa ekranın üç dakikalık çekmesiyle. Siparişleri izleyen her ekranda sipariş zilini ve
Sipariş bildirimlerini açık tutun. Sekme arka plandayken kabuğun yedek kontrolü, bildirimin ulaşmadığı zil cihazında 10
dakikada bir sorar (`src/lib/live-poll.ts`): yeni siparişin zili en geç o kadar gecikir. Her kontrol değişiklik yoksa
tek bir anahtar okumasıyla 304 alır.

Çekme tek işlemde ve `pg_advisory_xact_lock(hashtext('site-orders'))` ile yazar; uygulanan son listenin site
saatinden (`now`) eski bir yanıt uygulanmaz (aynı anda gelen ping ve ekran isteği listeyi geri almasın). Sonuç
`integration_state`'te:

| Anahtar | İçerik |
|---------|--------|
| `site_orders` | Son listenin kopyası: `now` (sitenin saati), `at` (çekme anı), `complete`, `skipped`, `orders` (ekranın alanları; tutar saklanmaz), `calls` ve `callsSkipped` (masa çağrıları, 6 Kas 2026; migration yok, aynı JSON). Liste ya da çağrılar değişince üzerine yazılır; **sipariş ve çağrı geçmişi tutulmaz** |
| `site_orders_sync` | `lastPullAt` (son deneme), `lastOkAt` (son başarılı), `lastError`, `lastPingAt`, `lastSiteNow`, `lastChangeAt`, `lastNewAt`, `lastTrigger` (`ping` / `screen` / `manual`), `lastCheckAt` (pingle olmayan son deneme), `awaitingPayment` ve `awaitingSince` (ödeme takibi), `missedPingAt` (son kaçan ping) |
| `site_orders_version` | Sayaç: liste, hata durumu ya da ödeme takibinin bitişi değişince artar (pingin kendisi artırmaz); canlı ucun ETag'ine girer |

Siteye ulaşılamazsa son doğru liste kalır, yalnız hata yazılır; ekran bunu durum satırıyla söyler.

### Ödeme takibi ve kaçan ping (senkron planı P2, 28 Ekim 2026)

Kartlı siparişte site iki kez ping atar: sipariş açılınca (ödeme bekleniyor) ve ödeme gelince. İkincisi kaybolursa
(panel o an yayında, ağ, zaman aşımı) ödenmiş sipariş ekrana ancak ekranın kendi çekmesiyle gelir; sakin saatte bu bir
saat sürebilirdi. Site bu yüzden listenin yanında **ödemesini bekleyen** bar ekranı siparişlerinin **sayısını** verir
(`awaitingPayment`, laffogato #270; yalnız sayı, sipariş, müşteri ya da tutar yok; son ödeme sayfası son 30 dakikada
açılmış olanlar). Kurallar `src/lib/site-orders/follow.ts`'te (saf, ekranın paketine de girer):

- **Takip:** sayı sıfırdan büyükken panel "ödeme bekleniyor" der ve ekran **en çok 30 dakika** yoğun sayılır
  (`awaitingUntil` = başlangıç + 30 dk; görünürken üç dakikada bir çeker). Takip 0 → > 0 geçişinde, sayı artınca (yeni
  bir ödeme sayfası) ve sayı sıfırdan büyükken gelen **her pingte** (yeniden açılan ödeme sayfası ping atar ama sipariş
  zaten sayılıyorsa sayıyı artırmaz) yeniden başlar; ekranın kendi çekmesi takibi uzatmaz. Sayı 0 olunca takip biter.
  Takibin başlaması, yeniden başlaması ve bitmesi sürümü artırır: açık sekme yeni bitişi canlı uçtan alır. Pingin
  kendisi sürümü artırmaz.
- **Ping yoğunluk sayılmaz:** P2'den önce son iki saatte ping gelen ekran yoğundu. Takibin sürüm artışı son pingi
  ekrana taşıdığından bu kural vazgeçilen her kartlı ödemede ekranı iki saat üç dakikalık çekmede tutardı; kalktı.
  Yoğunluğu açık sipariş, son iki saatteki liste değişikliği (`changeAt`) ve ödeme takibi belirler (`boardBusy`).
  Listeyi değiştiren her ping `changeAt`'i yazar, değiştirmeyen ping (ödeme sayfası açıldı) yalnız takibi başlatır.
- **Gecikme:** ödeme pingi kaçsa da **bildirimi kapalı** ya da **ekranında açık sipariş olan** görünür bar ekranı
  siparişi birkaç dakikada (en geç ≈ 6 dakika) gösterir: ekran takibi ilk canlı veride öğrenir (20 saniyede bir).
  **Bildirimi açık, ekranı boş cihaz** (Yardım'ın önerdiği bar tableti) yeniliği sormadan bildirimle bekler ve takibin
  başlaması bildirim göndermez: takibi kabuğun bir sonraki kontrolünde (30 dakikada bir) öğrenir. Takip o ana kadar
  sürüyorsa üç dakikada bir çeker; bittiyse sipariş saatlik kontrolle gelir (en geç ≈ 1 saat, P2 öncesi gibi). Arka
  plandaki sekme siteyi kendisi çekmez (kabuğun 10 dakikalık kontrolü yalnız panelin listesine bakar). Bu cihazı
  takip başlayınca uyandırmak sahibin kararını ister (görünmeyen sekmede tarayıcı bildirim göstermek zorunda; kısa
  aralıklı canlı sorgu ise panelin Neon bütçesini bozar): `planlar/KALAN-ISLER.md`.
- **Bütçe:** sürekli sorgu yok, yeni zamanlanmış iş yok; sık çekme yalnız ödeme beklenirken ve sipariş başına en çok
  30 dakika (sitenin sayısı da her siparişi son ödeme sayfasından 30 dakika sonra düşer; takip sayı 0 olunca biter).
  Alanı göndermeyen eski site için davranış eskisi gibidir.
- **Sakin saatin kontrolü:** saatlik kontrol (`maxAgeMs` ≥ 10 dk) yalnız ekranın ve elle yapılan çekmeleri sayar
  (`lastCheckAt`): araya giren başka bir siparişin pingi kontrolü atlatıp kaçan ödemeyi bir saat daha gizlemez. Daha
  sık kontroller (açılış 1 dk, yoğun 3 dk) pingin çekmesini sayar, o çekme listeyi zaten getirdi.
- **Kaçan ping:** pingle olmayan bir çekme (ekran, Yenile, aşama sonrası, Bağlantıları sına) ilk kez gördüğü yeni bir
  siparişi getirir, sipariş en az bir dakika önce ödenmiş (sitenin saatiyle) ve ödemeden sonra siteden hiç ping
  gelmemişse `missedPingAt` yazılır (yalnız son an; sayaç yok). **Ayarlar › laffogato.net** siparişler satırında yedi
  gün gösterir (`missedPingShown`): "Ping kaçtı …: ödenmiş bir sipariş sitenin pingiyle değil ekranın kontrolüyle
  geldi." Ping gelip çekmesi düştüyse bu kaçan ping değil, çekme hatasıdır (satır onu hata olarak gösterir). İlk çekme
  ve önceki listesi eksik (200'den çok sipariş) çekme sayılmaz. Anahtar sebep olamaz: ping ve çekme aynı anahtarla
  imzalanır, kaçan ping ancak başarılı bir çekmeden sonra yazılır.

## Masa çağrıları ("Garson çağır", 6 Kasım 2026)

Masadaki QR menüden müşteri garson, su ya da peçete ister; site çağrıyı sipariş listesinin yanında verir (v1'e
ekleme, `version` 1 kalır):

```json
"calls": [{"id":"tcl-…","tableCode":"K7Q2M9X4TB","label":"Masa 4","reason":"water","createdAt":"2026-11-06T12:00:00.000Z"}]
```

- **Okuma** (`parseSiteCalls`, `src/lib/site-orders/schema.ts`): alan yoksa ya da dizi değilse boş (eski site; yanıt
  reddedilmez). Kimliği ya da anı bozuk, iki kez geçen çağrı atlanır ve sayılır (`callsSkipped`; durum satırında "N
  masa çağrısı okunamadı"); en çok 100. `reason` `waiter` / `water` / `napkin`; bilinmeyen sebep atılmaz, `other` olur
  (kart "Çağırıyor" der). Bilinmeyen alanlar atılır; müşteriye dair bir şey gelmez, saklanmaz.
- **Saklama:** son listenin kopyasında (`site_orders.calls`), siparişlerle aynı işlemde ve aynı sürümle; migration yok.
  Çağrılar değişince (yeni, görüldü, süresi doldu) sürüm artar, açık sekme yeni hâli canlı uçtan alır.
- **Süre:** site yalnız açık ve 15 dakikadan yeni çağrıları gönderir. Süresi dolan çağrı sitede ping atmadan düşer;
  panelin kopyası bir sonraki çekmeye kadar kalabileceği için ekran, menü sayısı ve zil 15 dakikadan eski çağrıyı
  göstermez (`openCalls`). Açık çağrı ekranı yoğun yapar (üç dakikalık çekme), kopya da en geç o kadar sonra düzelir.
- **Kart** (Siparişler'in üstünde, yalnız açık çağrı varken; en uzun bekleyen önde): masa (kalın), sebep ("Garson
  çağırıyor", "Su istiyor", "Peçete istiyor", bilinmeyende "Çağırıyor"), "3 dk önce" ve büyük **Gördüm**.
- **Gördüm:** tek dokunuş, onay yok; istek sürerken düğme kapalı, çift dokunuş gitmez. Sunucu eylemi `ackTableCall`
  (`src/server/actions/table-calls.ts`; oturum, personel ve yönetici) sitenin `POST /api/panel/calls/ack` ucuna gider:
  gövde yalnız `{"id","actor"}` (`actor` aşama ucundaki kuralla: boşluklar sadeleşir, en çok 80 karakter, boşsa
  "Panel"), imza ötekilerle aynı (`callSite`; `x-laf-timestamp`, `x-laf-signature: v1=<hex>`). 200
  `{"ok":true,"call":{"id","status":"acked"}}` (tekrarı aynı yanıt) → liste yeniden çekilir, bildirim "Masa 4 ·
  görüldü". 404 `{"error":"not_found"}`: çağrı zaten kapanmış (başka cihaz gördü ya da süresi doldu) → liste yeniden
  çekilir, "Masa 4 · çağrı zaten kapanmış". 401 / 503 ve uç yoksa (JSON'suz 404) aşama düğmesindeki gibi: yönetici
  ayrıntıyı, personel "Site bağlantısında sorun var; çağrı işaretlenmedi. Yöneticiye haber verin." görür. Masanın adı
  son listenin kopyasından okunur. Panelin işlem geçmişine yazılmaz (kayıt sitede, `actor`).
- **Zil:** bu cihazın görmediği her açık çağrı bir kez, kapı zili deseniyle (`call`); ilk yüklemede iki dakikadan
  eski çağrılar sessizce görülmüş sayılır; panelin ilk çekmesinde (ve çağrılardan önce yazılmış kopyada) hiçbir çağrı
  yeni sayılmaz, bildirim gitmez. Sipariş zili kapalı cihazda çalmaz (görülmüş sayılır). Görülen kimlikler
  `localStorage` `laf:gorulen-cagrilar` (siparişlerinkinden ayrı). Yeni çağrı ve Gördüm sitenin aynı `orders.changed`
  pingini atar.
- **Bildirim:** Web Push `orders` konusu, "Masa 4 · Su istiyor" / "Masa çağrısı"; dokununca Siparişler.

## Sitede yapıldı (v1'e ekleme, 23 Ekim 2026)

Müşterinin notu sitede yayında (laffogato #248) ve panel onu isteğe bağlı okur: siparişin `note`'u yalnız masa ve gel-al
siparişinde, kırpılmış ve en çok 300 karakter (kuryede hiç: o alan adres notunu da taşır, "[adres notu] · [not]"; kapı
kodu siteden çıkmaz, üyenin kurye siparişindeki notu da gelmez); satırın `note`'u `items[].options.note`'tan, en çok 200
karakter, her siparişte (kurye dahil). Kural ve KVKK bölümü sitenin `docs/PANEL-ORDERS.md`'sinde.

Ödeme bekleyen sayısı (`awaitingPayment`, 28 Ekim 2026, laffogato #270): yanıtın üst düzeyinde isteğe bağlı tam sayı,
`version` 1 kalır; panel yoksa ya da bozuksa 0 sayar ve listeyi yine okur (`parseSiteOrders`). Site sayıyı listeden önce
okur: iki okuma arasında ödenen sipariş listede çıkar, hiçbirinde kalmaz. Kullanımı yukarıda **Ödeme takibi**.

## Kurulum

1. Karaoke bağlantısı kuruluysa ek bir şey gerekmez: aynı `KARAOKE_SYNC_SECRET` (iki projede aynı, en az 32
   karakter) ve `LAFFOGATO_URL` (boşsa `https://laffogato.net`). Kurulu değilse [KARAOKE.md](KARAOKE.md) › Kurulum.
   Sitede `PANEL_URL` (boşsa `https://ladmin.laffogato.net`) pingin gideceği adrestir.
2. Sitenin sipariş uçları yayında olmalı (laffogato `src/app/api/panel/orders/route.ts`, sipariş yazımındaki ping;
   aşama düğmeleri için `src/app/api/panel/orders/stage/route.ts`). Aşama ucu yoksa düğme "Sitede sipariş ilerletme
   ucu yok" der; liste ve zil çalışmaya devam eder.
3. Panel yayınlanınca migration (`0019_siparis_bildirimi`: bildirim aboneliğine boş olabilen `orders` sütunu,
   `IF NOT EXISTS`) build öncesinde kendiliğinden uygulanır.
4. Barın cihazında personel hesabıyla **Siparişler**'i açın; **Bu cihazda uyarılar**'da **Sipariş bildirimleri** ve
   **Sipariş zili bu cihazda** açık olsun (personelde varsayılan). **Ayarlar › laffogato.net**'te "Uygulama
   siparişleri ve masa çağrıları" **Bağlı** göstermeli.
5. Masa çağrıları için sitede çağrı listesi ve `POST /api/panel/calls/ack` yayında olmalı; yoksa liste ve zil
   siparişlerle çalışır, çağrı kartı hiç çıkmaz (alan gelmez) ya da Gördüm "Sitede masa çağrısı ucu yok" der.

## Güvenlik ve kişisel veri

- Ping ve okuma karaoke bağlantısının imzasıyla: `x-laf-timestamp`, `x-laf-signature: v1=<hex>`, HMAC-SHA256 (zaman,
  yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı), ±5 dakika, sabit süreli karşılaştırma (`src/lib/karaoke/signature.ts`).
  Okumanın, pingin ve aşama dokunuşunun vektörleri `tests/site-siparis.test.ts`'te, ayın satışınınki
  `tests/site-satis.test.ts`'te sabit; site aynılarını `tests/panel-karaoke-sync-core.test.ts`'te tutar (laffogato #270).
  Kural bir tarafta değişirse istekler 401 olur.
- Ping ucu: anahtar yoksa `503`, gövde 4 KB'tan büyükse `413`, imza yok / yanlış / eskiyse `401` (ayrıntı yok);
  doğruysa hemen `202` (`src/lib/site-ping.ts`, menü pingiyle ortak). Gövde sipariş taşımaz.
- Sitenin yanıtı doğrulanır (`src/lib/site-orders/schema.ts`): tanınmayan sürüm bütün listeyi reddeder ("panel güncel
  değil"); kullanılan alanlar sıkı (kimlik, aşama, nereye, ödeme anı, satırlar), bozuk ya da iki kez geçen sipariş
  atlanır ve sayılır; metinler kısaltılır, bilinmeyen alanlar atılır (site yeni alan eklese de panel bozulmaz).
  `path` yalnız `/admin/…` olabilir.
- Panele gelen kişisel veri yalnız müşterinin **adıdır** (gel-al'da seslenmek için), masa / gel-al siparişinde
  müşterinin kendi yazdığı sipariş **notu** (alerji, istek; sitenin personel e-postasındaki "MÜŞTERİNİN NOTU" kuralı) ve
  her siparişte içeceğe yazılan satır notu. Ad ve
  not ekranda ve son listenin kopyasında durur; günlüğe, işlem geçmişine ve bildirime yazılmaz. Kurye notu (adres
  tarifi, kapı kodu) hiç gelmez; gelirse panel atar (`parseSiteOrder`). Liste her çekmede üzerine yazılır, çıkan
  sipariş panelden de çıkar. Tutar (`totalMinor`) saklanmaz.
- Ekranın isteği (`/api/siparisler`) ve aşama eylemi oturum ister (personel ve yönetici); siteye panelin anahtarıyla
  sunucu gider, tarayıcı anahtarı görmez.
- Aşama isteği müşteriye dair hiçbir şey taşımaz (yalnız kimlik, işlem, aşama ve panel kullanıcısının adı). Hata
  olursa günlüğe yalnız sipariş kimliği, işlem ve sitenin hata kodu yazılır; ad ve satırlar asla.
- Masa çağrısı müşteriye dair hiçbir şey taşımaz (masa, QR kodu, sebep, an); Gördüm yalnız çağrının kimliğini ve panel
  kullanıcısının adını gönderir. Gördüm'ün imza vektörü `tests/masa-cagrisi.test.ts`'te sabit.

## Sorun giderme

Bu açıklamaları yalnız yönetici görür (bağlantı kartı, bar ekranının sarı satırı, Yenile); personel yöneticiye haber
vermesini söyleyen kısa sözü görür.

| Mesaj | Ne yapılır |
|-------|------------|
| Son kontrol başarısız: Siteye ulaşılamadı / Site 8 saniyede yanıt vermedi | Geçici; ekran dakikada bir yeniden dener, **Yenile** hemen dener. Bu arada siparişleri sitenin panelinden izleyin |
| Site isteği reddetti (imza) | İki projedeki `KARAOKE_SYNC_SECRET` aynı mı, ikisi de yeniden yayımlandı mı, sunucu saatleri doğru mu? |
| Sitede panel sipariş ucu yok | laffogato.net güncel değil (sipariş bağlantısı yayımlanmamış) |
| Sitede KARAOKE_SYNC_SECRET tanımlı değil ya da sitenin veritabanı okunamadı | Siteye değişkeni ekleyip yeniden yayımlayın; sürüyorsa sitenin günlüğüne bakın |
| Sitenin sipariş listesi tanınmayan sürümde (2); panel güncel değil | Site sözleşmeyi değiştirmiş: paneli güncelleyin |
| N sipariş okunamadı | Sitenin bir siparişi beklenen biçimde değil; sitenin panelinde kontrol edin |
| Zil çalmıyor | **Sipariş zili bu cihazda** açık mı, ekrana bir kez dokunuldu mu (tarayıcı ilk dokunuştan önce ses çaldırmaz)? |
| Ping kaçtı (Ayarlar › laffogato.net) | Bir siparişin ödeme pingi panele ulaşmadı, sipariş ekranın kontrolüyle geldi. Tek tük olur (panel yayındayken); satır yedi gün görünür. Tarih sık sık yenileniyorsa sitedeki `PANEL_URL`'yi kontrol edin ve sitenin günlüğündeki "[panel-orders] ping not delivered" satırlarını panelin yayın saatleriyle karşılaştırın. Ping ve çekme aynı imzayı kullanır: çekme başarılıyken sebep o değildir |
| Sitede sipariş ilerletme ucu yok (laffogato.net güncel değil) | Sitenin aşama ucu yayımlanmamış; o zamana kadar aşamayı **Sitede aç** ile sitenin panelinden değiştirin |
| Sipariş bu arada değişti; ekran yenilendi | Sipariş başka yerden (sitenin paneli, başka cihaz) ilerlemiş; kartın yeni hâline bakın, gerekiyorsa yeniden dokunun |
| Sipariş sitede bulunamadı ya da artık bar ekranında değil | Sitede iade / iptal edilmiş ya da tamamlanmış; ekran yenilenir, kart kalkar |
| İmza reddedildi: iki projedeki KARAOKE_SYNC_SECRET aynı mı? | Okumadaki imza hatasıyla aynı: anahtar ve sunucu saatleri |
| Site bağlantısında sorun var; sipariş ilerletilmedi. Yöneticiye haber verin. | Personelin gördüğü metin (denetim E-64): bağlantının kurulumuyla ilgili her hata (kapalı bağlantı, imza, uç yok, site güncel değil). Yönetici aynı dokunuşta ayrıntıyı görür; bar ekranının uyarı satırı ve `/api/canli`, `/api/siparisler` da personele yalnız "Site bağlantısında sorun var; yöneticiye haber verin." döner |
| Site 8 saniyede yanıt vermedi / Siteye ulaşılamadı; tekrar deneyin | Yeniden dokunun; sipariş iki kez ilerlemez (site 409 verir) |
| Sitede masa çağrısı ucu yok (laffogato.net güncel değil) | Sitenin `POST /api/panel/calls/ack` ucu yayımlanmamış; çağrıyı sitenin panelinden kapatın ya da 15 dakikada kendiliğinden düşer |
| Masa 4 · çağrı zaten kapanmış | Çağrıyı başka bir cihaz görmüş ya da süresi dolmuş; ekran yenilenir |
| N masa çağrısı okunamadı | Sitenin bir çağrısı beklenen biçimde değil (kimlik ya da an); panel güncel olmayabilir |

**Ayarlar › laffogato.net** kartındaki "Hata", o bağlantının **son denemesinin** hatasıdır ve bir sonraki başarılı
çekmeye kadar kalır; satır hatanın zamanını da yazar. Uzun süre çekilmemiş bir bağlantının eski hatası (sitenin ucu
henüz yayında değilken alınmış bir 404, soğuk açılışta bir zaman aşımı) bu yüzden kırmızı görünebilir:

- Kart açıldığında son denemesi **yarım saatten eski** kırmızı satırlar sayfa çizildikten sonra kendiliğinden yeniden
  denenir; bir sonraki açılışta yeni durum görünür.
- **Bağlantıları sına** (yalnız yönetici) dördünü hemen çeker (karaoke, menü, siparişler, bu ayın online satışı) ve
  sonucu bildirir. Hata gerçekse kart onu yeni zamanıyla gösterir; işlem geçmişine yalnız "N/4 bağlı" yazılır.

"Sitenin son pingi" (**Ayarlar › laffogato.net**) boş kalıyorsa site panele ulaşamıyor: sitedeki `PANEL_URL` ve
anahtarı kontrol edin. Ping gelmese de ekran açılınca ve arka planda çeker; yalnız gecikir.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/site-orders/schema.ts` | Sitenin listesinin doğrulanması: sürüm, sıkı alanlar, atlanan siparişler, güvenli yol (saf) |
| `src/lib/site-orders/feed.ts` | Yeni sipariş tespiti, parmak izi, kart metinleri, sıralama, "Sitede aç" adresi, zil kuralı, bildirim metni (saf) |
| `src/lib/site-orders/stage.ts` | Aşama düğmeleri: izin verilen işlem / aşama çiftleri, düğme adları, bildirim ve hata metinleri (saf, zod'suz: ekranın paketine girer) |
| `src/lib/site-orders/follow.ts` | Ödeme takibi (başlama, yeniden başlama, bitiş), ekranın yoğunluğu, "son çekme bundan eskiyse sor" kuralı, kaçan ping ve Ayarlar'daki satırının süresi (saf, zod'suz) |
| `src/lib/site-orders/stage-request.ts` | Aşama ucunun gövdesi ve yanıtın anlamı (200 / 409 / okunamayan / hata; sipariş listedeki şemayla doğrulanır) (saf) |
| `src/lib/site-orders/calls.ts` | Masa çağrıları: sebep metni, açık çağrılar (15 dk), zil kuralı, bildirim metni, Gördüm'ün sonucu ve hata metinleri (saf, zod'suz) |
| `src/lib/site-orders/call-request.ts` | Gördüm ucunun gövdesi (`{"id","actor"}`) ve yanıtın anlamı (görüldü / zaten kapanmış / okunamayan / hata) (saf) |
| `src/server/actions/site-orders.ts` | `advanceSiteOrder`: oturum, doğrulama, imzalı istek (`callSite`), ardından listeyi yeniden çekme |
| `src/server/actions/table-calls.ts` | `ackTableCall`: oturum, doğrulama, imzalı Gördüm isteği, ardından listeyi yeniden çekme |
| `src/lib/site-ping.ts` | Pingin denetimi (menü pingiyle ortak; `src/lib/site-menu/ping.ts` bunu yeniden dışa verir) |
| `src/server/site-orders/sync.ts` | Çekme, son listenin kopyası, durum, sürüm, bildirim; ekranın "son çekme bundan eskiyse sor"u |
| `src/app/api/orders/ping/route.ts` | Sitenin pingi |
| `src/app/api/siparisler/route.ts` | Ekranın yeniden çekme isteği (oturumlu) |
| `src/app/api/canli/route.ts`, `src/lib/live.ts` | Canlı veri: sipariş listesi ve durumu, ETag'te sürüm |
| `src/app/panel/siparisler/page.tsx` | Siparişler ekranı: başlık (laffogato.net'te aç, Yenile), bağlantı kutusu, pano, Bu cihazda uyarılar |
| `src/app/panel/siparisler/orders-board.tsx` | Pano ve `useOrdersFeed` (canlı veri, siteyi yeniden çektirme): durum satırları, Zili aç, sipariş kartları |
| `src/app/panel/siparisler/table-calls.tsx` | "Masa çağrıları" kartı ve Gördüm |
| `src/app/panel/karaoke/orders-summary.tsx` | Karaoke ekranındaki tek satır ("N açık uygulama siparişi" · Siparişler'e git) |
| `src/components/panel/orders-badge.tsx` | Menüdeki Siparişler satırının sayısı (canlı veriden) |
| `src/server/actions/site-links.ts`, `src/app/panel/ayarlar/site-links-test.tsx` | Ayarlar › laffogato.net: **Bağlantıları sına** |
| `src/components/panel/live/alert-center.tsx`, `sounds.ts`, `prefs.ts`, `device-alerts.tsx` | Zil (masa deseni, çağrının kapı zili), cihaz tercihleri |
| `src/server/push/send.ts`, `src/server/actions/push.ts` | `orders` bildirim konusu ve tercihi |
| `tests/site-siparis.test.ts` | Şema, yeni sipariş, sıralama, kart metinleri, zil kuralı, ping, tetikleyiciler, bildirim, aşama düğmeleri (çiftler, adlar, gövde, yanıt ve hata metinleri, eylemin oturumu), ödeme takibi, kaçan ping, imza vektörleri |
| `tests/masa-cagrisi.test.ts` | Masa çağrıları: `calls` olan ve olmayan yanıt, atlanan çağrılar, açık çağrı, zil kuralı ve metni, Gördüm'ün gövdesi, imza vektörü, yanıtı, hata metinleri, eylemin ve ekranın kuralları |
| `tests/siparis-takip-db.test.ts` | Ödeme takibi, sakin saatin kontrolü ve kaçan ping gerçek Postgres'te, sitenin sahte ucuyla (`BAGLANTI_TEST_DATABASE_URL`) |

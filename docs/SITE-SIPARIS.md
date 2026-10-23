# laffogato.net siparişleri: bar ekranı

Ekran: **Karaoke** (`/panel/karaoke`, "Barın ekranı"), en üstteki **Uygulama siparişleri** bölümü. Personel ve
yönetici. Bağlantının durumu ayrıca **Ayarlar › laffogato.net**'te. Sözleşmenin sitedeki kopyası: laffogato deposunda
`docs/PANEL-ORDERS.md` (uçlar, gövde, hata kodları; sitenin kuralı `src/lib/panel/orders-feed-core.ts`). Kartın aşama
düğmeleri sitenin imzalı aşama ucuna gider (`POST /api/panel/orders/stage`, aşağıda **Aşama düğmeleri**).

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

## Nasıl çalışır

```
laffogato.net                                    ladmin.laffogato.net (bu panel)
─────────────                                    ──────────────────────────────
sipariş yazıldı (live:orders)
  └─ after(): POST /api/orders/ping  ─────────▶  imza doğru → 202 (hemen)
     {"event":"orders.changed","at"} (imzalı)       └─ after(): çek (hata olursa 4 sn sonra bir kez daha)
                                                       GET laffogato.net/api/panel/orders (imzalı)
GET /api/panel/orders  ◀────────────────────────        ├─ doğrula (sürüm 1; bozuk sipariş atlanır)
  {version:1, now, complete, orders:[…]}                ├─ son listenin kopyası (site_orders; üzerine yazılır)
  yalnız açık kafe siparişleri, beyaz liste             ├─ değiştiyse sürümü artır (canlı ucun ETag'i)
                                                        └─ ilk kez görülen yeni sipariş: Web Push "orders"
                                                              └─ service worker → açık sekme /api/canli'yi
                                                                 yeniler, zil çalar, kart gösterir

                                                 barista karttaki düğmeye dokundu (sunucu eylemi, oturumlu)
POST /api/panel/orders/stage  ◀─────────────────  {"id","action","from","actor"} (imzalı)
  sitenin durum makinesi: ödeme, stok, sadakat,
  e-posta, bildirim; olay kaydına panel:<ad>
  200 {order} · 409 {error:"stale",order} ───────▶  çek (yukarıdaki gibi; son listenin kopyasını yalnız çekme yazar)
                                                    └─ bildirim "#10234 hazır" ya da "bu arada değişti"; ekran yenilenir
```

Ekran veriyi canlı uçtan (`/api/canli`) alır; sipariş listesinin sürümü ETag'tedir (`W/"<karaoke>.o<sipariş>.…"`),
değişiklik yoksa 304 ve veri okunmaz. Siteyi ekranın kendisi değil sunucu sorar: ekran `POST /api/siparisler`
(`{maxAgeMs}`, oturum gerekir) ile "son çekme bundan eskiyse sor" der. Sunucu eylemi değil uç: site 8 saniye bekletse
de ekrandaki öteki işler (sayaç, uzatma) sıraya girmez.

### Ekranda ne görünür

- **Başlık:** "Uygulama siparişleri", rozetler "3 açık · 1 yeni", "1 masada"; **Yenile**.
- **Kart:** nereye (sitenin dili: "Masa 4", "Gel-al", "Kurye"), müşterinin adı, sipariş numarası, planlı saat
  ("14:30 için", başka gündeyse "Yarın 09:00 için"), aşama rozeti (**Yeni**, **Hazırlanıyor**, **Teslime hazır**),
  satırlar (adet kalın; ad ve seçenekler sitenin yazdığı gibi), "Ödendi · 7 dk önce" (10 dakikadan uzun bekleyen yeni
  sipariş turuncu), **Sitede aç** (`laffogato.net/admin/siparisler/<id>`, yeni sekmede; yalnız sitenin kendi
  adresine giden `/admin/…` yolları bağlanır; iade ve iptal orada) ve kartın altında büyük **aşama düğmeleri**
  (aşağıda).
- **Müşterinin notu:** siparişe yazılan not ("Fındık alerjim var, şurupsuz lütfen") kartın üstünde turuncu kutuda,
  içeceğe yazılan not ("çok sıcak olmasın") satırın altında "Not: …" olarak. Yalnız **masa** ve **gel-al**
  siparişinde gelir (v1'e eklenen, isteğe bağlı `note` alanları; sipariş notu en çok 300, satır notu 200 karakter).
  Kurye siparişinin notu adres notuyla aynı alanda durur (kapı kodu, tarif): site göndermez, gönderse de panel atar.
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
  güncel olmayabilir)").
- **Bağlantı kurulmadıysa** tek gri satır: "laffogato.net bağlantısı kurulmadı (KARAOKE_SYNC_SECRET): uygulama
  siparişleri burada görünmez. Karaoke sayacı çalışır."
- Bu cihazda sipariş zili kapalıysa: "Bu cihazda sipariş zili kapalı; yeni sipariş gelince ses çalmaz." · **Zili aç**.

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
  turuncu bildirim 30 saniye. Gel-al ve kurye normal zil, yeşil bildirim 15 saniye. **Gör** Karaoke ekranına götürür
  (zil panelin her ekranında çalar; uyarı motoru kabuktadır).
- Sayfa ilk açıldığında iki dakikadan eski yeniler çalmaz, görülmüş sayılır (kartları zaten vurguludur); cihazın
  daha önce gördüğü sipariş sayfa yeniden yüklenince de çalmaz. Panel kapalıyken gelen bildirime dokunup iki dakika
  içinde açılan sayfa o siparişi bir kez daha çalar (barista sesi duysun).
- Panelin **ilk çekmesi** (hiç liste yokken) hiçbir siparişi yeni saymaz: bağlantı kurulunca o an açık olan
  siparişler için bildirim gitmez.
- **Web Push** konusu `orders`: ilk kez görülen yeni siparişte sunucu bildirim gönderir ("Yeni sipariş · Masa 4",
  "2× Latte, 1× Matcha Latte"; birden çoksa "2 yeni sipariş", "Masa 4 · Gel-al"). **Müşterinin adı bildirimde yok**
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
| Arka planda, yalnız ekran görünürken | Ekranda sipariş varken ya da son iki saatte ping / değişiklik olduysa üç dakikada bir; sakinken saatte bir; son çekme başarısızsa dakikada bir |
| **Yenile** | Hemen; art arda basılırsa siteyi en çok on saniyede bir sorar (son çekme hatalıysa her basışta) |
| Günlük iş | Yok: Vercel'in cron kotası dolu, ping ve ekran yeter |

Son çekme hatalıysa ekranın her isteği (beş saniyeden eskiyse) siteyi yeniden dener: site geri gelince liste
beklemeden gelir. Açık sekmenin canlı veri kontrolü: ekranda açık sipariş varken (aşama değişikliği çabuk görünsün) ya
da cihazda bildirim kapalıyken 20 saniyede bir; bildirim açık ve ekran boşken yeni sipariş bildirimle gelir (kabuğun
yedek kontrolü). Her kontrol değişiklik yoksa tek bir anahtar okumasıyla 304 alır.

Çekme tek işlemde ve `pg_advisory_xact_lock(hashtext('site-orders'))` ile yazar; uygulanan son listenin site
saatinden (`now`) eski bir yanıt uygulanmaz (aynı anda gelen ping ve ekran isteği listeyi geri almasın). Sonuç
`integration_state`'te:

| Anahtar | İçerik |
|---------|--------|
| `site_orders` | Son listenin kopyası: `now` (sitenin saati), `at` (çekme anı), `complete`, `skipped`, `orders` (ekranın alanları; tutar saklanmaz). Liste değişince üzerine yazılır; **sipariş geçmişi tutulmaz** |
| `site_orders_sync` | `lastPullAt` (son deneme), `lastOkAt` (son başarılı), `lastError`, `lastPingAt`, `lastSiteNow`, `lastChangeAt`, `lastNewAt`, `lastTrigger` (`ping` / `screen` / `manual`) |
| `site_orders_version` | Sayaç: liste ya da hata durumu değişince artar; canlı ucun ETag'ine girer |

Siteye ulaşılamazsa son doğru liste kalır, yalnız hata yazılır; ekran bunu durum satırıyla söyler.

## Sitede yapılacak (v1'e ekleme)

Panel müşterinin notunu **isteğe bağlı** okur; site göndermezken kart eskisi gibidir. Sitenin `docs/PANEL-ORDERS.md`'si
(KVKK bölümü dahil) ve `tests/panel-orders-feed.test.ts` aynı PR'da güncellenmeli:

1. `listPanelOpenOrderRows` `"deliveryNote"`'u da okusun; `toPanelOrder` `note`'u yalnız `orderFulfillment(row)` masa ya
   da gel-al ise, kırpılmış ve en çok 300 karakter göndersin (kuryede hiç: kapı kodu siteden çıkmaz).
2. Satırlara `items[].options.note`'tan `note` (en çok 200 karakter).

## Kurulum

1. Karaoke bağlantısı kuruluysa ek bir şey gerekmez: aynı `KARAOKE_SYNC_SECRET` (iki projede aynı, en az 32
   karakter) ve `LAFFOGATO_URL` (boşsa `https://laffogato.net`). Kurulu değilse [KARAOKE.md](KARAOKE.md) › Kurulum.
   Sitede `PANEL_URL` (boşsa `https://ladmin.laffogato.net`) pingin gideceği adrestir.
2. Sitenin sipariş uçları yayında olmalı (laffogato `src/app/api/panel/orders/route.ts`, sipariş yazımındaki ping;
   aşama düğmeleri için `src/app/api/panel/orders/stage/route.ts`). Aşama ucu yoksa düğme "Sitede sipariş ilerletme
   ucu yok" der; liste ve zil çalışmaya devam eder.
3. Panel yayınlanınca migration (`0019_siparis_bildirimi`: bildirim aboneliğine boş olabilen `orders` sütunu,
   `IF NOT EXISTS`) build öncesinde kendiliğinden uygulanır.
4. Barın cihazında personel hesabıyla **Karaoke**'yi açın; **Bu cihazda uyarılar**'da **Sipariş bildirimleri** ve
   **Sipariş zili bu cihazda** açık olsun (personelde varsayılan). **Ayarlar › laffogato.net**'te "Uygulama
   siparişleri (bar ekranı)" **Bağlı** göstermeli.

## Güvenlik ve kişisel veri

- Ping ve okuma karaoke bağlantısının imzasıyla: `x-laf-timestamp`, `x-laf-signature: v1=<hex>`, HMAC-SHA256 (zaman,
  yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı), ±5 dakika, sabit süreli karşılaştırma (`src/lib/karaoke/signature.ts`).
- Ping ucu: anahtar yoksa `503`, gövde 4 KB'tan büyükse `413`, imza yok / yanlış / eskiyse `401` (ayrıntı yok);
  doğruysa hemen `202` (`src/lib/site-ping.ts`, menü pingiyle ortak). Gövde sipariş taşımaz.
- Sitenin yanıtı doğrulanır (`src/lib/site-orders/schema.ts`): tanınmayan sürüm bütün listeyi reddeder ("panel güncel
  değil"); kullanılan alanlar sıkı (kimlik, aşama, nereye, ödeme anı, satırlar), bozuk ya da iki kez geçen sipariş
  atlanır ve sayılır; metinler kısaltılır, bilinmeyen alanlar atılır (site yeni alan eklese de panel bozulmaz).
  `path` yalnız `/admin/…` olabilir.
- Panele gelen kişisel veri yalnız müşterinin **adıdır** (gel-al'da seslenmek için) ve masa / gel-al siparişinde
  müşterinin kendi yazdığı **not** (alerji, istek; sitenin personel e-postasındaki "MÜŞTERİNİN NOTU" kuralı). Ad ve
  not ekranda ve son listenin kopyasında durur; günlüğe, işlem geçmişine ve bildirime yazılmaz. Kurye notu (adres
  tarifi, kapı kodu) hiç gelmez; gelirse panel atar (`parseSiteOrder`). Liste her çekmede üzerine yazılır, çıkan
  sipariş panelden de çıkar. Tutar (`totalMinor`) saklanmaz.
- Ekranın isteği (`/api/siparisler`) ve aşama eylemi oturum ister (personel ve yönetici); siteye panelin anahtarıyla
  sunucu gider, tarayıcı anahtarı görmez.
- Aşama isteği müşteriye dair hiçbir şey taşımaz (yalnız kimlik, işlem, aşama ve panel kullanıcısının adı). Hata
  olursa günlüğe yalnız sipariş kimliği, işlem ve sitenin hata kodu yazılır; ad ve satırlar asla.

## Sorun giderme

| Mesaj | Ne yapılır |
|-------|------------|
| Son kontrol başarısız: Siteye ulaşılamadı / Site 8 saniyede yanıt vermedi | Geçici; ekran dakikada bir yeniden dener, **Yenile** hemen dener. Bu arada siparişleri sitenin panelinden izleyin |
| Site isteği reddetti (imza) | İki projedeki `KARAOKE_SYNC_SECRET` aynı mı, ikisi de yeniden yayımlandı mı, sunucu saatleri doğru mu? |
| Sitede panel sipariş ucu yok | laffogato.net güncel değil (sipariş bağlantısı yayımlanmamış) |
| Sitede KARAOKE_SYNC_SECRET tanımlı değil ya da sitenin veritabanı okunamadı | Siteye değişkeni ekleyip yeniden yayımlayın; sürüyorsa sitenin günlüğüne bakın |
| Sitenin sipariş listesi tanınmayan sürümde (2); panel güncel değil | Site sözleşmeyi değiştirmiş: paneli güncelleyin |
| N sipariş okunamadı | Sitenin bir siparişi beklenen biçimde değil; sitenin panelinde kontrol edin |
| Zil çalmıyor | **Sipariş zili bu cihazda** açık mı, ekrana bir kez dokunuldu mu (tarayıcı ilk dokunuştan önce ses çaldırmaz)? |
| Sitede sipariş ilerletme ucu yok (laffogato.net güncel değil) | Sitenin aşama ucu yayımlanmamış; o zamana kadar aşamayı **Sitede aç** ile sitenin panelinden değiştirin |
| Sipariş bu arada değişti; ekran yenilendi | Sipariş başka yerden (sitenin paneli, başka cihaz) ilerlemiş; kartın yeni hâline bakın, gerekiyorsa yeniden dokunun |
| Sipariş sitede bulunamadı ya da artık bar ekranında değil | Sitede iade / iptal edilmiş ya da tamamlanmış; ekran yenilenir, kart kalkar |
| İmza reddedildi: iki projedeki KARAOKE_SYNC_SECRET aynı mı? | Okumadaki imza hatasıyla aynı: anahtar ve sunucu saatleri |
| Site 8 saniyede yanıt vermedi / Siteye ulaşılamadı; tekrar deneyin | Yeniden dokunun; sipariş iki kez ilerlemez (site 409 verir) |

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
| `src/lib/site-orders/stage-request.ts` | Aşama ucunun gövdesi ve yanıtın anlamı (200 / 409 / okunamayan / hata; sipariş listedeki şemayla doğrulanır) (saf) |
| `src/server/actions/site-orders.ts` | `advanceSiteOrder`: oturum, doğrulama, imzalı istek (`callSite`), ardından listeyi yeniden çekme |
| `src/lib/site-ping.ts` | Pingin denetimi (menü pingiyle ortak; `src/lib/site-menu/ping.ts` bunu yeniden dışa verir) |
| `src/server/site-orders/sync.ts` | Çekme, son listenin kopyası, durum, sürüm, bildirim; ekranın "son çekme bundan eskiyse sor"u |
| `src/app/api/orders/ping/route.ts` | Sitenin pingi |
| `src/app/api/siparisler/route.ts` | Ekranın yeniden çekme isteği (oturumlu) |
| `src/app/api/canli/route.ts`, `src/lib/live.ts` | Canlı veri: sipariş listesi ve durumu, ETag'te sürüm |
| `src/app/panel/karaoke/orders-board.tsx` | "Uygulama siparişleri" bölümü |
| `src/server/actions/site-links.ts`, `src/app/panel/ayarlar/site-links-test.tsx` | Ayarlar › laffogato.net: **Bağlantıları sına** |
| `src/components/panel/live/alert-center.tsx`, `sounds.ts`, `prefs.ts`, `device-alerts.tsx` | Zil (masa deseni), cihaz tercihleri |
| `src/server/push/send.ts`, `src/server/actions/push.ts` | `orders` bildirim konusu ve tercihi |
| `tests/site-siparis.test.ts` | Şema, yeni sipariş, sıralama, kart metinleri, zil kuralı, ping, tetikleyiciler, bildirim, aşama düğmeleri (çiftler, adlar, gövde, yanıt ve hata metinleri, eylemin oturumu) |

# laffogato.net siparişleri: bar ekranı

Ekran: **Karaoke** (`/panel/karaoke`, "Barın ekranı"), en üstteki **Uygulama siparişleri** bölümü. Personel ve
yönetici. Bağlantının durumu ayrıca **Ayarlar › laffogato.net**'te. Sözleşmenin sitedeki kopyası: laffogato deposunda
`docs/PANEL-ORDERS.md` (uçlar, gövde, hata kodları; sitenin kuralı `src/lib/panel/orders-feed-core.ts`).

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
> - **Panel siparişi ilerletmez:** "Hazırlanıyor", "Teslime hazır", iade sitenin panelinde yapılır.
> - **Sürekli sorgu yok:** site her sipariş yazımında içeriksiz, imzalı bir ping atar; panel imzalı tek bir okumayla
>   çeker. Ping kaçarsa ekran açılınca, öne gelince ve seyrek bir yedek kontrolde yeniden sorar; Neon uyuyabilsin.
> - **KVKK:** siparişlerin geçmişi tutulmaz (son liste her çekmede üzerine yazılır), ad günlüğe ve işlem geçmişine
>   yazılmaz, bildirimde ad yok; siteden sözleşmedekinden fazlası istenmez.
> - Bağlantı kapalıyken ya da site düşükken ekranın geri kalanı (karaoke sayacı) aynen çalışır; durum tek, sessiz bir
>   satırla söylenir.

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
  sipariş turuncu) ve **Sitede aç** (`laffogato.net/admin/siparisler/<id>`, yeni sekmede; yalnız sitenin kendi
  adresine giden `/admin/…` yolları bağlanır).
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

Ekran siparişi değiştirmez; aşama sitede değişince (ping → çekme) kart güncellenir, sipariş sitenin listesinden
çıkınca (masaya / kuryeye gitti, tamamlandı, iade, 24 saatlik unutulmuş sipariş kuralı) ekrandan kalkar.

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

## Kurulum

1. Karaoke bağlantısı kuruluysa ek bir şey gerekmez: aynı `KARAOKE_SYNC_SECRET` (iki projede aynı, en az 32
   karakter) ve `LAFFOGATO_URL` (boşsa `https://laffogato.net`). Kurulu değilse [KARAOKE.md](KARAOKE.md) › Kurulum.
   Sitede `PANEL_URL` (boşsa `https://ladmin.laffogato.net`) pingin gideceği adrestir.
2. Sitenin sipariş uçları yayında olmalı (laffogato `src/app/api/panel/orders/route.ts`, sipariş yazımındaki ping).
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
- Panele gelen kişisel veri yalnız müşterinin **adıdır** (gel-al'da seslenmek için). Ad ekranda ve son listenin
  kopyasında durur; günlüğe, işlem geçmişine ve bildirime yazılmaz. Liste her çekmede üzerine yazılır, çıkan sipariş
  panelden de çıkar. Tutar (`totalMinor`) saklanmaz.
- Ekranın isteği (`/api/siparisler`) oturum ister (personel ve yönetici); siteye panelin anahtarıyla sunucu gider,
  tarayıcı anahtarı görmez.

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

"Sitenin son pingi" (**Ayarlar › laffogato.net**) boş kalıyorsa site panele ulaşamıyor: sitedeki `PANEL_URL` ve
anahtarı kontrol edin. Ping gelmese de ekran açılınca ve arka planda çeker; yalnız gecikir.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/site-orders/schema.ts` | Sitenin listesinin doğrulanması: sürüm, sıkı alanlar, atlanan siparişler, güvenli yol (saf) |
| `src/lib/site-orders/feed.ts` | Yeni sipariş tespiti, parmak izi, kart metinleri, sıralama, "Sitede aç" adresi, zil kuralı, bildirim metni (saf) |
| `src/lib/site-ping.ts` | Pingin denetimi (menü pingiyle ortak; `src/lib/site-menu/ping.ts` bunu yeniden dışa verir) |
| `src/server/site-orders/sync.ts` | Çekme, son listenin kopyası, durum, sürüm, bildirim; ekranın "son çekme bundan eskiyse sor"u |
| `src/app/api/orders/ping/route.ts` | Sitenin pingi |
| `src/app/api/siparisler/route.ts` | Ekranın yeniden çekme isteği (oturumlu) |
| `src/app/api/canli/route.ts`, `src/lib/live.ts` | Canlı veri: sipariş listesi ve durumu, ETag'te sürüm |
| `src/app/panel/karaoke/orders-board.tsx` | "Uygulama siparişleri" bölümü |
| `src/components/panel/live/alert-center.tsx`, `sounds.ts`, `prefs.ts`, `device-alerts.tsx` | Zil (masa deseni), cihaz tercihleri |
| `src/server/push/send.ts`, `src/server/actions/push.ts` | `orders` bildirim konusu ve tercihi |
| `tests/site-siparis.test.ts` | Şema, yeni sipariş, sıralama, kart metinleri, zil kuralı, ping, tetikleyiciler, bildirim |

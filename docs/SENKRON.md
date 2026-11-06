# Senkron: panel ↔ laffogato.net (kısa harita)

Panelin laffogato.net'le bütün bağlantıları tek sayfada: hangi bilgi nerede yaşar, panele nasıl gelir, panel siteye
nasıl yazar ve iki yer aynı anda değişince ne olur. Kararların ve fazların tamamı
[planlar/senkron.md](planlar/senkron.md) (§3 kararlar, §4 görevler); sitedeki karşılığı laffogato deposunda
`docs/PANEL-SENKRON.md` (S1 ile yazıldı, laffogato #269). Kod esastır: bu sayfa kodla çelişirse kod haklıdır.

## Ne nerede yaşar

Müşteriye dönük bilgi sitede yaşar, panel okur; panelin kendi bilgisi (reçete, maliyet, hammadde, kasa, doluluk,
tahmin) panelde yaşar ve siteye gitmez. Bütün istekler aynı anahtarla imzalıdır (`KARAOKE_SYNC_SECRET`; anahtar yoksa
bağlantılar kapalı, panelin geri kalanı çalışır).

| Bilgi | Kaynak | Panele nasıl gelir | Panel nasıl yazar | Ayrıntı |
|---|---|---|---|---|
| Menü fiyatı (M / L), Satışta / Tükendi | site | Sitenin pingi (`/api/menu/ping`) → imzalı `GET /api/panel/menu`; Ürünler sayfaları açılınca (5 dakikada bir), günlük iş, "Siteyle eşitle" | Önce site: imzalı `POST /api/panel/menu`, site 2xx verince panel sitenin döndürdüğünü yazar | [SITE-MENU.md](SITE-MENU.md) |
| Karaoke rezervasyonları | site | Ping (`/api/karaoke/ping`) → `GET /api/panel/karaoke` | Yazmaz | [KARAOKE.md](KARAOKE.md) |
| Uygulama siparişleri ve masa çağrıları (Siparişler ekranı) | site | Ping (`/api/orders/ping`) → `GET /api/panel/orders`; yanında ödeme bekleyen sayısı (`awaitingPayment`): sıfırdan büyükken ekran en çok 30 dakika üç dakikada bir çeker (kaçan ödeme pingi); açık masa çağrıları (`calls`, 15 dakikadan yeni) | Aşama: `POST /api/panel/orders/stage` (karta koşullu; eski dokunuş 409); çağrıda Gördüm: `POST /api/panel/calls/ack` (tekrarı aynı yanıt, 404 zaten kapanmış) | [SITE-SIPARIS.md](SITE-SIPARIS.md) |
| Online satış (kâr-zarar, tüketim, kasa raporu) | site | `GET /api/panel/sales` (günlük iş, Gelir-gider › Siteden yenile) | Yazmaz | [SITE-SATIS.md](SITE-SATIS.md) |
| Ad, kategori, görsel, alerjen, yeni kalem | site | Yalnız ad ve kategori listede görünür | Yazmaz (eşleştirme ve kalem açma elle) | [SITE-MENU.md](SITE-MENU.md) |

Kafenin kasası LafPOS ayrı bir bağlantıdır (kendi anahtarı, kendi uçları): [LAFPOS.md](LAFPOS.md).

## Çakışma: iki yer aynı anda değişince

Panel → site yazımı yalnız menü fiyatı ve Satışta / Tükendi içindir; dört yol tek noktadan geçer
(`pushSaleChange`, `src/server/site-menu/push.ts`): ürün kartının kaydı (`saveRecipe`), listedeki fiyat hücresi ve
zam önerisi (`updateProductPrice` → `writeSalePrice`), toplu Fiyatlar ve geri alması (`writeSalePrice`), bar ekranının
Tükendi / Satışa aç / Kapalı tut'u (`sold-out-core.ts`).

1. **Açık kalmış ekran görüleni gönderir** (denetim E-11, 26 Ekim 2026). Ürün kartı açılırken gördüğü fiyatı ve iki
   anahtarı (`seenPrice`, `seenActive`, `seenShowOnMenu`), fiyat hücresi ve zam önerisi gördüğü fiyatı, toplu
   Fiyatlar önizlemedeki fiyatı (`expectFrom`) gönderir. Kural (`src/lib/prices/seen.ts`, `keepSeen`):

   | Kullanıcı | Veritabanı görülenden beri | Sonuç |
   |---|---|---|
   | Dokunmadı | Aynı | Değer olduğu gibi kalır |
   | Dokunmadı | Değişti (site, eşitleme, toplu, başka sekme) | Güncel değer kalır; siteye eski değer gitmez, fiyat geçmişine ve Kasaya işle'ye sahte kayıt düşmez; bildirim söyler |
   | Değiştirdi | Aynı | Yeni değer yazılır (bağlıysa önce site) |
   | Değiştirdi | Aynı yeni değere değişti | Yazılacak bir şey yok |
   | Değiştirdi | Başka bir değere değişti | Hiçbir şey yazılmaz, siteye gidilmez; kart "… kalsın" / "… yazılsın" diye sorar, hücre güncel fiyatı söyler |

   Görüleni göndermeyen eski sekme bugünkü gibi yazar. Panelde yazım da koşulludur: okumadan sonra fiyat değiştiyse ya
   da ürün siteye bağlandıysa yazılmaz.
2. **Sitenin kendi denetimi: `expect`.** Panelin site kopyası eski olabilir (ping kaçtı). Site GET yanıtında
   `writes: {expect: true}` duyurursa panel yazdığı her alanın kopyadaki değerini `expect` olarak gönderir; site
   tutmazsa yazmaz ve `409 {error:"stale", item}` döner. Panel o an sitenin menüsünü yeniden okur ve "Bu ürün sitede bu
   arada değişti …" der. Bayrağı duyurmayan site `expect` almaz (yeni alan eski sitede 400 olurdu); duyurup geri alınan
   site `400 field:"body"` (bugünkü sitenin katı şeması bilinmeyen alanı böyle bildirir) ya da `field:"expect"` verirse
   panel bir kez `expect`'siz dener ve bayrağı sonraki çekmeye kadar kapatır. Bayrak `menu_sync.writesExpect`'te, her
   çekmede yenilenir.
3. **Belirsiz sonuç.** Zaman aşımında site yazmış olabilir: panel yazmaz, bunu söyler ve yanıttan sonra siteyi okur
   (istek dışında, betikte ya da testte, yazım bir işlemin içindeyse, ör. Tükendi, ikinci bağlantı açılmaz; sonraki
   çekme düzeltir).
   Sitenin JSON `not_found`'u (kalem yok) ile gövdesi JSON olmayan 404 (uç yok, site güncel değil) ayrı söylenir.
4. **Eski liste yeni yazımı geri almaz.** Çekme, uygulanan son listenin ya da panel yazımının site saatinden eski bir
   listeyi uygulamaz; panelin son bir saatte yazdığı kalemlerin damgası saklanır (`pushed`, [SITE-MENU.md](SITE-MENU.md)
   › Panel ne zaman çeker).

## Durum (28 Ekim 2026)

- **Panel (P1, denetim B12, #52 ve #53):** görülen değerler, `expect` ve bayrak, 409 `stale`, 400 `body` / `expect`
  yeniden denemesi, zaman aşımı ve 404 ayrımı yapıldı; testleri `tests/fiyat-cakisma.test.ts`,
  `tests/site-menusu.test.ts`, `tests/tukendi-db.test.ts`.
- **Site (S1, laffogato #269):** `POST /api/panel/menu`'ye isteğe bağlı `expect` ve 409 `stale`, GET'e
  `writes: {expect: true}`, sitenin kendi menü formunun yalnız dokunulan satış sütununu koşullu yazması, uygulamanın menü
  önbelleği 300 sn. Site bayrağı duyurunca (S1 yayında) panel her menü yazımında `expect` gönderir. Uygulamanın sözleşme
  kopyası lafmobil #35 (M1).
- **Site (S2, laffogato #270) ve panel (P2):** sipariş okumasının yanında ödeme bekleyen sayısı; panel sayı sıfırdan
  büyükken bar ekranını en çok 30 dakika yoğun tutar (pingin kendisi artık yoğunluk sayılmaz), sakin saatin kontrolü
  pingle yapılan çekmeyi saymaz, kaçan ping Ayarlar › laffogato.net'te yedi gün görünür
  ([SITE-SIPARIS.md](SITE-SIPARIS.md) › Ödeme takibi). Bildirimi açık, boş bar ekranı takibi kabuğun 30 dakikalık
  kontrolünde öğrenir; onu uyandırmak sahibin kararını bekliyor (`planlar/KALAN-ISLER.md`). Sipariş okuması, sipariş
  pingi, aşama dokunuşu ve ayın satışı için imza vektörleri iki tarafta aynı (`tests/site-siparis.test.ts`,
  `tests/site-satis.test.ts`).
- **Sonraki** (uygulamanın menü ve mağaza tazeliği M2; Faz 2: ayarlar ve kapanışlar): planın §4'ü.

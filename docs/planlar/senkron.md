# Senkron: laffogato ↔ lafmaliyet ↔ lafmobil (karar belgesi ve plan)

Durum: karar, 25 Ekim 2026. 24 Ekim taslağı üç eleştiri turundan geçti (sözleşme, bütçe, kapsam); hangi itirazın
neden alındığı §6'da. Sahibin isteği (24 Ekim 2026): *"laffogato ve lafmobil repolarıyla bağlantılı, senkronize
gitmesi gereken bilgiler var; birinde bir şey değişince diğer yerlerde de varsa değişsin. Örneğin menü, aktif / pasif
ürün."* Kısa harita lafmaliyet'te `docs/SENKRON.md` (P1 ile, denetim B12 #52'de yazıldı); laffogato'daki karşılığı
`docs/PANEL-SENKRON.md` S1 ile yazıldı (laffogato #269, 28 Ekim 2026).
Kafenin kasası LafPOS bu belgenin ilk sürümünden sonra geldi; envanteri §2.7'de, sözleşmesi lafmaliyet `docs/LAFPOS.md`
ve LafPOS `docs/03-ENTEGRASYON.md`'de.

- **Taban:** laffogato `main` 61f3e19 · lafmaliyet `origin/main` 950dbdb (#27 dahil) · lafmobil `main` d0695b7 ·
  dalga 10 `claude/dalga-10-personel` fc3e1c2 (yarım) · dalga 11 `claude/dalga-11-cari` e5b2673 (yarım). Envanter
  6f4cc5b'de çıkarıldı; #27'nin kaydırdığı panel satırları (orders-board, levels, live-poll, engine, parasut/sync)
  950dbdb'ye göre düzeltildi.
- **Kanıt biçimi:** `site:` laffogato, `panel:` lafmaliyet `origin/main`, `app:` lafmobil, `d10:` dalga 10 dalı;
  ardından `yol:satır`.
- **"bilinmiyor":** kodla ya da belgeyle kurulamadı. Canlı veritabanları ve ortam değişkenleri okunmadı; canlı
  değerler (fiyatlar, bağ sayısı, `publicMenu`, saatler, anahtarların eşitliği) bilinmiyor.
- **Yapılan denemeler (çizik alanda, repolara yazılmadı):** beş imza vektörü (karaoke 2, menü 3) bağımsız betikle
  yeniden hesaplandı ve tuttu; sitenin `PANEL-SALES.md` ve `PANEL-ORDERS.md` örnekleri panelin
  `parseSiteSales` / `parseSiteOrders`'ından geçti; hukuk tohumu `app:src/data/legal.seed.json` ile bayt bayt aynı;
  `docs/API-MOBILE.md` iki kopyası aynı (SHA-256 b98ff7c9…, `app:src/data/contract-sync.test.ts:89`); panel
  testleri site-satis 14/14, site-siparis 26/26, parasut-iade 6/6, parasut 21/21.
- **Yapılamayan:** iki uygulamayı aynı anahtarla yerelde çalıştırıp uçtan uca yayılma denemesi. Bu yüzden §4'teki her
  görevin uçtan uca adımı zorunludur.

---

## 1. Özet

### Bugün eşit giden

- **Karaoke rezervasyonu (site → panel):** ping, imzalı çekme, sayfa / sekme / günlük iş yedekleri, "Bağlantıları sına".
- **Menü fiyatı ve Satışta / Tükendi (site ↔ panel):** panel önce siteye yazar, site her yazımda ping atar.
- **Siparişler:** bar ekranı (site → panel) ve aşama (panel → site, karta koşullu; eski dokunuş 409).
- **Online satış:** ay kayıtları ve kasa günü satırı (site → panel, çekme).
- **Uygulama:** her şeyi siteden okur. Pasif kalem, biten stok, kapalı mağaza ve kapalı kafe sunucuda reddedilir; para
  ayrışmaz, ayrışan yalnız ekrandır.
- **Sözleşme ve kopyalar:** API-MOBILE.md iki kopyası ve imza kuralı aynı; KVKK beyaz listeleri iki tarafta kodda;
  hukuk tohumu, palet, logo ve katalog tohumunun fiyatları bugün aynı.

### Eşit gitmeyen ya da ayrışması görünmeyen (önem sırasıyla)

1. **Menüde kayıp yazım.** Site formu ve panel kartı fiyatı ve durumu açılıştaki değerle yazıyor; arada değişen değer
   sessizce geri alınır, Tükendi kalem yeniden satışa çıkabilir. Dalga 10 personele serviste Tükendi verince bu
   nadir yarış günlük riske döner. *S1 (laffogato #269) ve P1 (#52, #53) ile kapandı.*
2. **Kaçan ödeme pingi** ödenmiş kafe siparişini bar ekranında sakin saatte 60 dakikaya kadar gizleyebilir. *S2
   (laffogato #270) ve P2 ile: ödeme beklenirken bildirimi kapalı ya da açık siparişi olan görünür bar ekranında
   birkaç dakika; bildirimi açık, boş ekranda hâlâ bir saate kadar (P2 › Durum 5, açık iş KALAN-ISLER'de).*
3. **Uygulamada pasif kalem ve eski fiyat ≈ 2 saate kadar kalıyor** (CDN SWR 3600 sn + uygulama staleTime 1 sa); admin
   formu "en geç 5 dakika" diyor. *S1 (laffogato #269) ile CDN'de en çok 10 dakika ve form metni düzeldi; uygulamanın
   staleTime'ı M2'de.*
4. **Kapanış günleri:** sitede tarihli kapanış yok; elle "Kapalı" genel sayfalara yansımıyor; saatler panele hiç
   gitmiyor (tahmin, Bugün, doluluk, açık gün yanlış).
5. **Ping teslimini kimse görmüyor.** "Bağlantıları sına" yalnız panelden siteye okumaları sınıyor.
6. **Ayarlar paylaşılmıyor:** karaoke oda saatleri ve ücreti, KDV oranları, sipariş anahtarları, açık gün.
7. **Kod sabiti ile menü kalemi ayrışıyor:** seçenek ek ücreti, ödül kuponu değeri, kilometre taşı hediyesi (ada göre).
8. **KVKK:** karaoke Web Push gövdesinde ad; hesap silmede panel kopyasındaki ad; hukuk metni panel kopyasından söz
   etmiyor. *Push'taki ve sekmenin kendi sistem bildirimlerindeki ad P0 ile kalktı (lafmaliyet, dal
   `claude/senkron-p0-push-ad`); panel kopyasının silinmesi P5 ve S11'de, hukuk metni S12'de.*
9. **Panelde mağaza malının maliyeti ve online POS kesintisi yok.**
10. **Türetilmiş kopyalar bayatlıyor:** llms*.txt, saat metinleri, telefon kopyaları, CATALOG.md, panelin "Opera AVM"si.

### Plan bir bakışta

- **Faz 1 (sahibin örneği: menü, aktif / pasif; kayıp yazım ve kayıp sinyal):** S1 → S2 → M1 → P1 → P2 → M2.
  Fazdan bağımsız: P0 (Web Push'tan ad). **Durum (28 Ekim 2026):** S1 (laffogato #269), S2 (laffogato #270), M1
  (lafmobil #35), P1 (B12, #52 ve #53), P2 (lafmaliyet #60) ve P0 (lafmaliyet, dal `claude/senkron-p0-push-ad`)
  yapıldı; Faz 1'de yalnız M2 kaldı: uygulamanın bir sonraki mağaza sürümüne biner, App Store gönderimini yürüten
  oturumun işi.
- **Faz 2 (yararlı senkron):** ayar ucu ve tüketicileri, 304, ping sınaması, override ve tarihli kapanış, seçenek
  fiyatı, menü yan uyarıları, karaoke.
- **Faz 3:** satış ekleri, mağaza maliyeti ve POS kesintisi, llms.txt, temizlikler, KVKK metni.
- **Dalga 10 ile:** Tükendi kararı orada (Soru 3). S1 dalga 10'un Tükendi'sinden önce, en geç aynı gün yayına çıkar.
  P1, P3, P4 dalga 10 birleştikten sonra açılır. Dalga 10'a not: `tests/tukendi-db.test.ts`'in sahte `callSite`'ı
  409 `stale`'i de kapsasın; `seenPrice` P1'de, dalga 10'un `seenActive` / `seenShowOnMenu` alanlarının yanına gelir.
- **Dalga 11 ile:** P7 (nakit planı, Paraşüt) dalga 11 birleşmeden açılmaz.
- **Bütçe:** sitenin Neon'u 23 Ekim'de 81/100 CU-saatteydi ve 28 Ekim'de doluyordu (site:docs/DATABASE.md:264-273).
  Faz 1 sürekli periyodik çekme eklemez (P2'nin takibi kartlı sipariş başına ≤ 30 dk); Faz 2'nin yeni çekmeleri 304'ten ve günlük işten geçer (§3.1 "Bütçe").

---

## 2. Envanter

Sütunlar görevdeki gibi. Yinelenen satırlar birleştirildi (ör. `baglanti-menu-yazma` → `menu-fiyat`). Gecikmeler
doğrulama turunda düzeltilen değerlerdir.

### 2.1 Menü

| ID | Bilgi | Nerede tutuluyor | Nerede gösteriliyor | Tek kaynak (bugün → olmalı) | Bugünkü eşitleme | Gecikme | Ayrışma kanıtı |
|---|---|---|---|---|---|---|---|
| menu-fiyat | Kalemin satış fiyatı M (tek) ve L, KDV dahil | site `menu_items."priceMinor"`, `"priceMinorL"` (kuruş, L 0 = tek boy; site:db/schema.sql:92, :649) · panel `products.price` (TL, boy başına satır) + `site_menu_id`/`site_menu_slot` (panel:src/server/db/schema.ts:160, :171-173), kopya `integration_state.menu_site_items` · app `priceMinor`/`priceLargeMinor` (app:src/data/http.ts:249-250; site:src/lib/mobile/menu-mapper.ts:279-281) | site /menu, /masa, /admin/menu; app menü, ürün, sepet tahmini; panel Ürünler, kart, Fiyatlar, maliyet oranı | site → site (panel yalnız site üzerinden yazar) | Ping (site:src/lib/db/index.ts:291-296 → panel:src/app/api/menu/ping/route.ts) + imzalı GET. Panel → site: POST önce, 2xx sonra yerel yazım (panel:src/server/site-menu/push.ts:54-80). Yedek: Ürünler sayfaları `after()` ile ≥5 dk (panel:src/server/site-menu/sync.ts:41, :316-318), cron 08:00 TR, Ayarlar hata tekrarı, Bağlantıları sına | Saniyeler (ping 4 sn + 1 tekrar, site:src/lib/panel/ping.ts:42-44, :92-118; çekme 8 sn, panel:src/server/site-link.ts:13). Ping kaçarsa Ürünler açılışından sonraki çizim ya da 08:00 | **Kayıp yazım, iki yönde.** (1) Site formu fiyatı, L'yi ve `isActive`'i formdan okur (site:src/app/admin/menu/actions.ts:89-90, :147-148); `updateMenuItem` satırın tamamını yazar (site:src/lib/admin/store.ts:7123-7140). Panel bunu "laffogato.net" kaynaklı değişiklik diye geçmişe ve Kasaya işle'ye yazar (panel:src/server/site-menu/sync.ts:212-223). (2) Panel kartı fiyatı ve durumu ilk açılıştaki state'ten gönderir (panel:src/app/panel/urunler/[id]/recipe-editor.tsx:276-281; `key={product.id}` [id]/page.tsx:143). `saveRecipe` bunu taze DB satırıyla karşılaştırır (panel:src/server/actions/products.ts:202-206). Kart açıkken gelen herhangi bir çekmeden sonra "Kaydet", sitenin fiyatını ve Tükendi'sini geri alır. Panelde 12 sn'lik toast var, site tarafı tam sessiz. site:docs/PANEL-MENU.md:16-20 "çakışma doğmaz" diyor. Zaman aşımında "fiyat değişmedi" mesajı yanlış olabilir (panel:src/lib/site-menu/push.ts:118). Canlıda gözlenmedi |
| menu-satis-durumu | Satışta / Tükendi | site `menu_items."isActive"` (site:db/schema.sql:95) · panel `products.active` + `show_on_menu` (panel:src/server/db/schema.ts:163-164); kurallar `panelIsActive` ve `visibilityFromSite` (panel:src/lib/site-menu/slot.ts:47, :53-55) · app: alan yok, pasif kalem yanıttan çıkar (site:src/lib/mobile/menu.ts:42) | site /menu ve /masa pasifi gizler; /admin/menu'de tek dokunuş ve toplu; app'te görünmez; panelde liste, kart, QR menü | site → site | menu-fiyat ile aynı. Sipariş anında sunucu pasif kalemi reddeder: 400 `invalid_line` "X şu an menüde değil." (site:src/lib/mobile/order-pricing.ts:68-74, store.ts:4239-4250, orders.ts:142-143) | Site → panel saniyeler. App listesinde ~65 dk (sürekli trafik) ile ~2 sa (sessiz dönem + staleTime) arası. Red anında | Aynı kayıp yazım. Tek dokunuş ve toplu yol koşullu yazar (store.ts:7219-7243), orada sorun yok. Bugün personel hiçbir yerden Tükendi yapamaz (site:src/lib/admin/roles.ts:74; panel `requireAdmin`, products.ts:192-194); dalga 10 §2.1 personele bar ekranından onaysız Tükendi / Satışa aç veriyor (`setSoldOut` → `pushSaleChange`, d10:docs/planlar/personel-yetki.md:166-190). Bilerek bırakılan asimetri: Tükendi `active`'e dokunmaz (panel:docs/SITE-MENU.md:77-82) |
| menu-uygulama-tazelik | Uygulamanın menü yanıtının tazeliği (fiyat, durum, foto URL'si, alerjen) | site `GET /api/mobile/v1/menu` her istekte DB'den okur (site:src/lib/mobile/menu.ts:41). Başlık `public, s-maxage=300, stale-while-revalidate=3600`, ETag/304 (site:src/app/api/mobile/v1/menu/route.ts:26, :36-47) · app `['menu']` staleTime 1 sa, gcTime 1 gün (app:src/data/queries.ts:253-258); customization da aynı (:339-345). Diskten gelen kopya hemen yeniden sorulur (:197) | app Menü, Ana Sayfa rayı, ürün ekranı, sepet | site DB (değişmez) | Yalnız çekme. Uygulama If-None-Match göndermez (app:src/data/api.ts:234-242). `refetchInterval` ve çekip yenileme yok. Satır reddi menüyü geçersiz kılmaz (app:src/components/checkout/use-checkout-order.ts:116, :1150-1159) | CDN 300 sn, sessiz dönemden sonra 3900 sn'ye kadar (site:docs/API-MOBILE.md:191). Üstüne app'in 3600 sn'si: en kötü ≈ 125 dk. Soğuk açılışta da ≈ 65 dk olabilir | site:docs/PANEL-MENU.md:160-162 ve admin formu (site:src/components/admin/menu-item-form.tsx:173, :415) "en geç 5 dakika" diyor; route.ts:15 yorumu da eskimiş. Para riski yok (önizleme `staleTime: 0`, app:src/data/queries.ts:1103-1108). 304 bugün `apiFetch`'te hata sayılır (app:src/data/api.ts:284-306), bu yüzden If-None-Match tek başına eklenemez |
| menu-alerjen | Kalemin alerjen grupları ve `nuts` etiketi | site `menu_items.allergens` jsonb, NULL = girilmedi (site:db/schema.sql:6516) → mobil `allergens` (menu-mapper.ts:246, :291) · panelde alerjen verisi yok; reçete `recipe_items` (panel:src/server/db/schema.ts:192-208) | site menü; app ürün ekranı (app:src/app/menu/[id]/index.tsx:439); sepette yalnız `nuts` hapı (app:src/components/checkout/cart-line-card.tsx:228) | site, elle → site + reçete değişince hatırlatma | Site → app çekme. Panele bilerek gitmez (site:src/lib/panel/menu-link-core.ts:67-82, store.ts:6978-6987; site:tests/panel-menu-link.test.ts:120) | App'e ≈ 125 dk'ya kadar | Reçeteyi yeniden yazan üç yol var: panel:src/server/actions/products.ts:225-238, recipe-requests.ts:222-227, src/server/data/product-create.ts:72. Hiçbiri sitedeki alerjeni değiştirmez, uyarı da yok. Canlıda gözlenmedi |
| menu-kasa-fiyati | Kasadaki (ModPOS) satış fiyatı. **LafPOS'a geçiş gününden itibaren** (denetim B11, E-39): siteye bağlı kalemin fiyatını LafPOS siteden alır (§2.7 `lafpos-menu`), Kasaya işle yalnız siteye bağlı olmayan ürün içindir | ModPOS, repolarda yok (site:docs/PANEL-MENU.md:185-188) · panel izlemesi `pos_stale_price`/`pos_stale_since` (panel:src/server/db/schema.ts:174-180), `recordPriceChange` (panel:src/server/prices/record.ts:25-40) | panel Fiyatlar › Kasaya işle (panel:docs/FIYATLAR.md:109-139), Ürünler "Kasa N", zil (yönetici), Bugün | kasada elle → site fiyatı; kasa elle ama tek işaretli adımla | Elle. Liste, panelde, toplu ve sitede değişen **bağlı** satırlar için kendiliğinden dolar | Elle | Bağsız site kaleminin fiyatı (ya da yalnız M'si bağlı kalemin L'si) değişince listeye bir şey girmez. Plan yalnız bağlı satırları gezer (panel:src/lib/site-menu/plan.ts:91-111; sync.ts:203-206, :248). Belgede kural "sitede değişen fiyat da listeye girer" (panel:docs/FIYATLAR.md:127). Bağsızlar "Yalnız sitede olan kalemler" sekmesinde görünür (panel:src/app/panel/urunler/site/page.tsx:105), fiyat değişimi uyarısı yok. Kasada satılıp satılmadıkları bilinmiyor |
| menu-tukenen-hammadde | Hammadde bitti ya da az kaldı → kalemin satış durumu | panel `quick_counts` (schema.ts:1211-1231), `stock_counts` (:575-590), "Az kaldı" (panel:src/lib/reorder/levels.ts:340), `recipe_items` · site yalnız `isActive` | panel Hızlı sayım, Mal siparişi ("Az kaldı" rozeti, order-plan.tsx:324); Bugün yalnız sayım görevini gösterir | bağ yok → panel uyarır, insan karar verir; Tükendi'nin kaynağı site | Yok: `pushSaleChange` yalnız products.ts:50, :206 ve prices/write.ts:34'ten çağrılır; sayım menüye dokunmaz (panel:src/server/actions/reorder.ts:41-124) | Elle, belirsiz | Hızlı sayımda 0 yazılan takipteki hammadde (yalnız `reorder_items`, reorder.ts:68-73) sitede satılan kalemi etkilemez. Uygulama siparişi alınır; iptal ve iade yalnız sitede (site:src/lib/panel/orders-stage-core.ts:35). "Az kaldı" bitti demek değil (panel:docs/MAL-SIPARISI.md:44) |
| menu-boy-yapisi | Tek boy mu, iki boy mu | site `"priceMinorL"` (0 = tek) · panel `products.size` + `site_menu_slot` · app `priceLargeMinor` null | app M/L seçici; panel "Bağlantı kopuk" | site (L'yi yalnız site açar/kapatır: 409 `single_size`, site:src/app/api/panel/menu/route.ts:138-141; panel:src/lib/site-menu/push.ts:69-78) | Ping → L yuvası kopuk sayılır (panel:src/lib/site-menu/slot.ts:30-33, sync.ts:294-299) | Saniyeler | Görünür. Sepetteki L satırı `repairSize` ile düzelir (app:src/lib/cart/sync.ts:130-133); sunucu 400 `no_large_size` (site:src/lib/mobile/order-pricing.ts:90-96) |
| menu-bag | Panel ürünü ↔ site kalemi bağı | yalnız panel `products.site_menu_id`/`site_menu_slot` (panel:src/server/db/schema.ts:171-173, :186-188) | panel Ürünler küre, kart, /panel/urunler/site | panel, yönetici elle (panel:docs/SITE-MENU.md:58-66) | Sitede silinen kalemin bağı kaldırılır (sync.ts:224-226) | Elle | Site yöneticisi bağı görmez. Canlıdaki bağ sayısı bilinmiyor |
| menu-yeni-kalem | Yeni kalem / yeni ürün | site `createMenuItem` mnu-NNNN (store.ts:7107-7121) · panel `createProduct`, bağsız başlar | site ve app hemen; panelde yalnız "Yalnız sitede" sekmesi (panel:src/app/panel/urunler/site/site-menu-matching.tsx:157) | iki yan elle (site:docs/PANEL-MENU.md:41-43) → aynı, ama sitede açılan kalem panelde fark edilmeli | Kopya ping'le gelir; bağ ve uyarı yok | Kopya saniyeler; bağ belirsiz | Bağlanmayan kalemin maliyeti yok ve fiyatı Kasaya işle'ye girmez |
| menu-kalem-silme | Kalemin ya da ürünün silinmesi | site `deleteMenuItem` (store.ts:7187-7194, toplu :7211-7217) · panel `deleteProduct` (products.ts:263-279) | site ve app'ten kalkar; panelde "Site bağlantısı kaldırıldı" (sync.ts:287-293) | her yan kendi kaydının kaynağı | Site silerse ping gider ve panel bağı kaldırır; fiyat ve durum kalır (sync.ts:224-226). Boş liste uygulanmaz (sync.ts:329-338) | Saniyeler | Satışta iken silinen kalemin panel satırında `showOnMenu=true` kalır. Panel QR menüsü açıksa (varsayılan kapalı, panel:src/lib/constants.ts:25) sitede olmayan ürünü gösterir |
| menu-ad, menu-aciklama, menu-kategori-sira | Ad, açıklama, kategori, sıra | site `menu_items.name`, `"desc"`, `"categoryKey"`, `"sortOrder"`; panele yalnız ad ve kategori etiketi gider (menu-link-core.ts:67-82) · panel `products.name`, `categories` (schema.ts:145-149, :185) · app `name`, `description`, kategori sırası | site, app, fiş; panel listesi ve QR menüsü kendi adlarıyla | iki ayrı, bilerek (site:docs/PANEL-MENU.md:24-26; panel:docs/SITE-MENU.md:20) | Yok | - | Yok: bağ kimlikle durur, ad değişikliği bağı bozmaz. Sipariş satırı adı anlık görüntü olarak saklar (store.ts:4250) |
| menu-fotograf | Kalemin fotoğrafı | site `menu_items.image` → app'e içerik damgalı `/gorsel/menu/<id>?v=<sha12>`, immutable (menu-mapper.ts:268-272, :288; site:src/lib/admin/image-bytes.ts:101) · app expo-image memory-disk · panelde yok | site menü, /masa, app | site | /menu yanıtıyla gelir; URL değişince önbellek ıskalar | URL /menu tazeliği kadar gelir (≈ 125 dk'ya kadar), sonra anında | Yok |
| menu-fiyat-listesi-tarihi | Fiyat listesinin yürürlük günü ve son fiyat değişikliği anı | site `settings."menuPricesEffectiveDate"` (store.ts:599; ayarlar/actions.ts:271-281), `"menuPricesChangedAt"` (store.ts:607, `markMenuPricesChanged` :7179-7185) · panelde yalnız sabit hatırlatma metni (panel:src/lib/site-menu/push.ts:151-152) · app'te yok | site /menu ve /masa altı; "tarih eski" uyarısı yalnız /admin/menu'de | site; gün operatörün (site:docs/PANEL-MENU.md:173-181) | `changedAt`'i site formu ve panel POST'u yazar (route.ts:152). "Satışa aç" ve toplu açma yazmaz (actions.ts:371-391, store.ts:7219-7230) | İşaret anında; gün elle | Panelden fiyat değiştiren yönetici, sitedeki tarihin eskidiğini yalnız sabit bildirimden öğrenir. Satışa yeniden açılan kalem işaret bırakmaz |
| menu-panel-qr | Panelin herkese açık QR menüsü | panel `loadPublicMenu` (panel:src/server/data/menu.ts:17-45), `/menu`, `/api/menu` (s-maxage=300); `settings.publicMenu` varsayılan false (constants.ts:25). Kapalıysa laffogato.net/menu'ye yönlenir (panel:src/app/menu/page.tsx:76-77) | ladmin.laffogato.net/menu (yayındaysa) | panel (bağlı üründe site kopyası) → müşteri menüsü tek: site | Bağlı üründe menü bağlantısıyla | Saniyeler + 300 sn | Açıksa bağsız ürün, sitede olmayan ad ve fiyatla görünür. Canlıda açık mı: bilinmiyor |
| baglanti-mobil-ozellestirme-fiyati | Seçenek ek ücreti (shot, şurup, süt) ↔ Ekstralar kalemleri | site kod sabiti: yulaf ve badem 2500, şurup 5000, `extraShotMinor` 5000, laktozsuz 0 (site:src/lib/mobile/customization.ts:59-76; fiyatlama :193-219). Kalemler: mnu-0081 Ekstra Shot 50₺, mnu-0080 Şurup 50₺, mnu-0082 Alternatif Süt 25₺ (site:src/components/laffogato/data.ts:788-802) · panel `OPTION_PRODUCTS` yalnız tüketim adedi için (panel:src/lib/site-sales/calc.ts:114-118) · app `customization` (çevrimdışı app:src/data/seed.ts:159-177) | app özelleştirme ve Ekstralar; site menü; ModPOS | iki kopya: sabit = alınan, kalem = gösterilen → tek (sahip kararı, Soru 5) | Yok | - | Ekstra Shot menüde 60₺ yapılırsa uygulama siparişinde shot 50₺ eklenmeye devam eder. Bu yalnız uygulama yolunda geçerli (store.ts:4320, :4353); web ödemesi seçenek almaz. mnu-0082'nin açıklaması laktozsuzu da sayıyor ve 25₺, sabitte laktozsuz 0. Canlı fiyatlar bilinmiyor |

### 2.2 Saatler, kapanış, karaoke

| ID | Bilgi | Nerede tutuluyor | Nerede gösteriliyor | Tek kaynak (bugün → olmalı) | Bugünkü eşitleme | Gecikme | Ayrışma kanıtı |
|---|---|---|---|---|---|---|---|
| saat-haftalik | Haftalık saatler ve haftalık kapalı gün | site `settings."weeklyHours"` (store.ts:582; days.ts:26-33; varsayılan her gün 09:00-02:00, store.ts:924-940). Yazan `saveHoursAction` (site:src/app/admin/ayarlar/actions.ts:192, yalnız sahip). Uygulamaya /bootstrap `venue.hours`, `opensAt`/`closesAt`, `hoursLabel` (menu-mapper.ts:665-701) ve /live-status `hours` (venue.ts:313-316) ile gider · app http.ts:517-552, :622-637 · panelde yok | site footer, /ziyaret, hero, JSON-LD, e-posta altbilgisi, sipariş kabulü; app Ziyaret, köşk kartı, planlı saatler | site → site; panel salt okur | Site içinde etiket `pub:site`. App çeker: bootstrap `s-maxage=300, swr=3600`, live-status `s-maxage=30`. Panele hiçbir şey gitmez (ping yalnız karaoke, menü ve sipariş için, site:src/lib/db/index.ts:294-296) | App bootstrap ≈ 65 dk + staleTime 5 dk; live-status ≈ 90 sn; panel hiç | Panel haftalık kapalı günü bilmez: tahmin o güne tutar yazar (panel:src/lib/forecast/model.ts:330-335, :381-411), Bugün "Dünkü kasa raporu · Girilmedi" açar (panel:src/app/panel/bugun/logic.ts:235-262), doluluk günü açık sayar. Karaoke kafenin saatine bakmaz (site:src/lib/mobile/karaoke.ts:151-186) |
| saat-anlik-durum | Elle "şu an açık / kapalı" (`manualOverride`) | site `venue_status.manualOverride` auto / open / closed (venue.ts:29, :41-53). Yazanlar canli-durum/actions.ts:97-161 ve :173-213 (köşk çipi). Karar `isCafeOpenNow` / `isCafeOpenForOrder` (venue.ts:191-199, :208-216) · app live-status `isOpen` (http.ts:621-637) | app canlı durum kartı, Ziyaret; kafe siparişi reddi (store.ts:4418-4423; "closed" iken planlı sipariş de reddedilir). Site genel sayfaları göstermez (site:src/components/laffogato/open-status.ts, use-open-status.ts; home-hero-slider.tsx:352, :365; visit-page.tsx:548; home-page.tsx:764). Panelde yok | site → site; genel sayfalar ve panel de okumalı | App ≈ 90 sn (s-maxage 30 + 60 sn odak yoklaması, app:src/data/queries.ts:505, :523). Ping yok, yalnız `live:venue` etiketi (tags.ts:99) | App ≈ 90 sn; site genel sayfaları ve panel hiç | "Kapalı" seçilince uygulama "Şu an kapalı" der ve siparişi reddeder; laffogato.net hero'su "Şu an açık · Kapanış 02:00" demeye devam eder. Süre ya da hatırlatıcı yok (venue.ts:354-369, cron'lar dokunmaz); tek iz admin üst çubuğundaki çip (venue-quick-core.ts:182, :194). "Açık" unutulursa 04:00'te sipariş kabul edilir |
| saat-tarihli-kapanis | Belirli günde kapalı ya da özel saat | site: alan yok; yalnız metin "yalnız 1 Ocak günü kapalıyız" (site:src/lib/seo/faq.ts:25, public/llms-full.txt:53) · panel `special_days` kind `kapali` (panel:src/server/db/schema.ts:1659-1679; forecast.ts:37, :75), takvimde 01-01 Yılbaşı (calendar.ts:34) · app'te alan yok | panel tahmin ve Bugün; site SSS + FAQPage JSON-LD | yok (iki bağlantısız kayıt; `manualOverride` tarihsiz) → site (Soru 1) | Yok | Sınırsız | 1 Ocak 2027 Cuma, `manualOverride=auto` iken: SSS "kapalıyız" der, ama `isOpenByHours` (venue.ts:161-188) "açık" der. Planlı kafe siparişi ve karaoke (karaoke.ts:151-186, kendi oda saatleri) kabul edilir; panel tahmini "Yılbaşı +%20" yazar. Panelde girilen "Kafe kapalı" gününü site ve uygulama bilmez. Uygulama sunucunun boş `opensAt`'ini haftalık satırla ezer (app:src/data/seed.ts:339-348, :363-374): yeni alan okunmadan "Bugün kapalı" yazılamaz |
| saat-gecmis-kapali-gun | Dün kapalıydık (rapor yok / Z=0) | panelde işaret yok; `closedYesterday` yalnız planda (panel:docs/planlar/tahmin.md:1095), "Kapalıydık" yalnız planda (kasa.md:594) · site ve app'te yok | panel Bugün `kasa-dun` (logic.ts:235-262), tutturma, haftalık özet | türetilmiş → panel kasa; planlı kapanış kaydından türesin | Yok | - | `special_days kapali` girilmiş günde tutturma zaten "Kapalı" der (panel:src/server/forecast/job.ts:34; accuracy.ts:83). Bugün ise özel güne bakmaz ve ertesi sabah yöneticiye ve personele "Girilmedi" açar. "Rapor yok" yalnız kapanış panele girilmediyse çıkar |
| saat-statik-kopyalar | Koda ve dosyalara gömülü saat metinleri | site `LEGAL_ENTITY.cafeHours` "Her gün 09:00 - 02:00" (site:src/lib/legal/entity.ts:96-109) → hukuk `{{CAFE_HOURS}}`, `SITE.openingHours` (site.ts:98-106); faq.ts:25; pages.ts:95 (/ziyaret meta); chrome.tsx:507-508; data.ts:1178, :1190; home-page.tsx:695; public/llms.txt:30-33, llms-full.txt:44-53 · app brand.seed.json:9-14, seed.ts:428; app:src/lib/hours.ts:4 yorumu "01:00" diyor | SSS + FAQPage, meta, menü çekmecesi, hukuk, llms, çevrimdışı app | her biri elle → dinamikler weeklyHours'tan, statikler entity'den (testle kilitli) | Yok | Sınırsız | Bugün hepsi aynı. Sahip kapanışı değiştirirse footer ve app değişir; SSS/JSON-LD, meta, çekmece, hero metni, hukuk ve llms eski kalır |
| critic-acik-gun | Ayda açık gün | panel `settings.acikGun` 30 (panel:src/lib/constants.ts:18; fields.ts:48); kullanan engine.ts:381, analiz/breakdowns.ts:87-88, NAKIT-PLANI.md:16 · site weeklyHours `closed` | panel başabaş, Gelir-gider, Nakit planı | iki ayrı, elle → panel yazar, siteden önerilir | Yok | Elle | Pazartesi kapatılırsa ay ≈ 26 gün olur, panel 30 ile hesaplamaya devam eder. Bugün ikisi de "her gün açık" |
| saat-kontrol-listesi-pencereleri | Açılış / kapanış listelerinin saatleri | panel:src/lib/checklist-seed.ts:38-39, :59-60 | panel Kontrol, Bugün | panel | Yok | - | Bilerek farklı (hazırlık önce başlar) |
| saat-karaoke-rezervasyon | Rezervasyon (gün, saat, kişi, durum, ilk ad, not, tutar) | site `karaoke_reservations` (schema.sql:1405); beyaz liste `toPanelReservation` (site:src/lib/panel/karaoke-sync-core.ts:327-373); uç route.ts:39-106 (yanıtta `version` yok) · panel `karaoke_sessions` source "site" (panel:src/server/karaoke/sync.ts:100-200) · app Karaokelerim | site /admin/mobil/karaoke; panel bar ekranı, zil, Web Push, Doluluk | site | Ping + GET (from = dün, to = +90 gün; sync.ts:114-118). Yedek: sayfa açılışı 5 dk (sync.ts:80), açık sekme `/api/canli` 30 dk (panel:src/lib/live-poll.ts:26; freshness.ts:14), cron, Şimdi eşitle, Bağlantıları sına | Saniyeler. Ping kaçarsa açık sekmede ≈ 60 dk'ya kadar; sekme yoksa sayfa açılışı ya da 08:00 | Ayrışma yok. İmza vektörleri iki yanda aynı (site:tests/panel-karaoke-sync-core.test.ts:48-60 ↔ panel:tests/karaoke.test.ts:30-36). Dünden eski değişiklik yalnız "Geçmişi siteden al" ile gelir. 90 günden ileri rezervasyon pencereye girene kadar panelde yok (sitenin ufku 365 güne çıkabilir, app-config.ts:192) |
| saat-karaoke-oda-saatleri | Rezervasyon penceresi ↔ doluluk paydası | site `mobileApp.karaoke.firstHour`/`closeHour` 12/24 (app-config.ts:62-68, :258-264, sınırlar :498-514). Yazan `saveKaraokeRulesAction` (site:src/app/admin/mobil/ayarlar/actions.ts:278); slotlar karaoke-core.ts:461-470 · panel `integration_state "karaoke.hours"` (panel:src/server/karaoke/occupancy.ts:13, :45-57); varsayılan `DEFAULT_ROOM_HOURS` 12/24 elle kopya (panel:src/lib/karaoke/occupancy.ts:40); panel ölçeği open 5-23, close ≤ 29 (:43-48) · app availability (http.ts:1658-1669), yedek 12/24 (:1625-1630) | site /karaoke, app karaoke ekranı ve kartı, panel Doluluk | iki ayrı → site; panel doluluk için ayrı tutabilir ama farkı gösterir | Panel: yok. App: availability önbelleksiz, staleTime 1 dk (queries.ts:855-862) | App ≤ 1 dk; panel hiç | İlk saat 14 yapılırsa panel 12-14'ü açık sayar ve doluluk ≈ %17 düşük görünür; uyarı yok (occupancy.ts:412-421). Aynı türden bir hata daha önce yaşandı: AVM'nin 10-22'si varsayılmıştı (occupancy.ts:35-39) |
| saat-karaoke-oda-gercek-doluluk | Rezervasyonsuz oturum, uzatma, erken bitirme | panel `karaoke_sessions` source "panel", `extra_minutes`, `ended_at` (schema.ts:937-980; extend.ts:18-26) · sitede yok | panel bar ekranı, Doluluk | panel; site en az "oda X'e kadar dolu"yu görmeli | Yok (panel:docs/KARAOKE.md:69). Panel yalnız kendi başlat/uzat anında kopyasına bakar (actions/karaoke.ts:43-87, :134-138) | - | 21:00'de rezervasyonsuz sayaç başlar; 21:10'da üye 22:00'ye rezervasyon yapar. Site kabul eder (karaoke.ts:420-426; DB kısıtı yalnız `karaoke_reservations`, schema.sql:1491-1498). Panel ters yönde uyarmaz (sync.ts'de overlap yok; overlap.ts:20-37 yalnız ileri). Zil metninde doluluk yok (session.ts:118-132); oturum sürerken "Sıradaki" çizilmez (karaoke-board.tsx:155-170) |
| saat-karaoke-kvkk | Misafir adı ve notu: saklama ve hesap silme | site 3×366 gün (migration 20261021090000:13-27); hesap silmede yalnız üye satırında `customerName ""`, `note` boşalmaz (site:src/lib/mobile/me.ts:269-285) · panel `customer_name`, `note`, temizlik 3×366 (panel:src/lib/karaoke/history.ts:233-234; server/karaoke/history.ts:221-233); `activity_log` uzatma satırına ad yazar (panel:src/server/actions/karaoke.ts:146), bu kayıt hiç temizlenmez | panel bar ekranı, oturum kayıtları | site; panel kopyası silmeyi izlemeli | Pencere içi ping + çekme; pencere dışında yok. Geçmişten alma adı değiştirmez (history.ts:96-139) | Pencere içi saniyeler; dünden eskide 3×366 güne kadar | Üye hesabını kapatır: ≈ 20 Eki 2026'dan beri pencereden geçmiş satırlardaki ad panelde kalır |
| saat-karaoke-iptal | İptal ve iptal anı | site status / paymentStatus; iptal anı sütunu yok, panele gitmez · panel `cancelled_at`, `cancelledAtFor` updatedAt'ten tahmin eder (panel:src/lib/karaoke/site.ts:68-90); opsiyonel `cancelledAt` alanını zaten okur (site.ts:27-28) | panel iptal zili, Doluluk "Son dakika iptal" | site → site saklasın ve göndersin | Ping + çekme | Durum saniyeler; an yalnız tahmin | Geçmişten alınan iptallerde an yok. Ödenmiş iptalde iade adımları updatedAt'i oynatır (site.ts:73-75); "son dakika" oranı alt sınırdır |
| saat-karaoke-iptal-politikasi | Ücretsiz iptal süresi, geç iade oranı | site `karaokeFreeCancelHours` 2, `karaokeLateRefundPercent` 0 (store.ts:681-683) · app availability (http.ts:1676-1683) · panel `LATE_CANCEL_HOURS` 24 (occupancy.ts:16) | site ve app ödeme kutusu; panel Doluluk | site politika; panel eşiği bilerek ayrı | App çeker; panel yok | App ≤ 1 dk | Aynı söz iki anlamda kullanılıyor (2 sa politika, 24 sa analiz) |
| saat-karaoke-ucret | Saat ücreti ve kasadaki karaoke fiyatı | site `karaokeHourlyMinor` 100000 (store.ts:659), rezervasyona donar · panelde fiyat yok; ModPOS "Karaoke Toplu / Kişi başı" (Eylül 1.050 / 1.000 ₺, panel seed excel-data.json:7719-7735) · llms.txt:33 "1.000₺" | site /karaoke, app, panel Doluluk "saat başına gelir" | online site; ModPOS elle → aynı, panel farkı gösterir | App çeker; ModPOS ve llms elle | App ≤ 1 dk | Site ücreti değişirse ModPOS ve llms eski kalır. ModPOS'un güncel fiyatı bilinmiyor |
| saat-karaoke-kapasite | Oda kapasitesi | site `karaokeCapacity` 8 (store.ts:660) · app availability, live-status · panelde yok | app, site | site | App çeker | ≤ 1 dk | Yok (panel kullanmıyor) |

### 2.3 Siparişler, satış, KDV, Paraşüt

| ID | Bilgi | Nerede tutuluyor | Nerede gösteriliyor | Tek kaynak (bugün → olmalı) | Bugünkü eşitleme | Gecikme | Ayrışma kanıtı |
|---|---|---|---|---|---|---|---|
| siparis-bar-liste | Açık kafe siparişleri (bar ekranı) | site `orders` → `toPanelOrder` beyaz listesi (site:src/lib/panel/orders-feed-core.ts:236-280) · panel `integration_state` `site_orders` / `_sync` / `_version` (panel:src/server/site-orders/sync.ts:27), doğrulama schema.ts:112-127 | panel bar ekranı, zil, personelin Web Push'u; site /admin/siparisler | site | Ping (site:src/lib/db/index.ts:296 → orders-ping.ts:18-22) + imzalı çekme; çekme hata verirse 4 sn sonra tek tekrar (panel:src/lib/ping-work.ts:43-53). Ekran yoklaması: açılış 1 dk, yoğun 3 dk, sakin 60 dk, hata 1 dk (orders-board.tsx:45-58). Cron yok, bilerek (SITE-SIPARIS.md:178) | Saniyeler. Ödeme pingi kaçarsa sakin saatte ≈ 118 dk'ya kadar, yoğun saatte ≈ 6 dk | Kartlı siparişte önce `pending_payment` pingi gider (store.ts:3512) ve panel çeker. Liste değişmediği için sürüm artmaz (sync.ts:211), ETag değişmez (canli/route.ts:43), ekran yoğun moda geçmez: `busy` `pingAt`'i zaten sayar (orders-board.tsx:100) ama ETag pingle değişmediği için istemci yeni `pingAt`'i görmez. Saatlik kontrol son çekmeyi taze sayıp atlar (sync.ts:241-243). 4xx'te tek deneme yapılır (ping.ts:114). Panelin hata satırı kaçan pingi göremez. Personel e-postası ve /admin zili bundan etkilenmez |
| siparis-asama | Aşama: Hazırlanıyor, Hazır / Masaya / Kuryeye, Teslim | site `orders.status` + aşama anları; `transitionOrder` expectStatus (store.ts:5222-5249, :5502-5520) · panel isteği `POST /api/panel/orders/stage {id, action, from, actor}` (site:src/lib/panel/orders-stage-core.ts:45-52, :89-109); kurallar STAGE_FROM (panel:src/lib/site-orders/stage.ts:26-36) | bar kartı; site zaman çizelgesi; app takip ve push | site (panel yalnız ister) | Koşullu istek, 200/409'dan sonra çekme; app 15 sn yoklama | Anında; app ≤ 15 sn | Yok: 409 `stale`, izinli çiftler aynı, panel testi 26/26. Bağlantıları sına bu ucu sınamaz |
| siparis-iptal-iade | İptal, iade, satır iptali | site `status` cancelled/refunded, `refunds` JSONB; yalnız /admin/siparisler · panel `site_sales:YYYY-MM` refundedMinor / netMinor | panel Gelir-gider; app durum ve iptal push'u | site | Bar ekranı ping; satış günlük işte bu ay + 2 ay (panel:src/lib/site-sales/calc.ts:52-68); app yoklama + push | Bar saniyeler; kâr-zarar ≤ 1 gün; 3 aydan eskisi elle ↻ yapılana kadar hiç | (a) İade siparişin ayına yazılır (site:docs/PANEL-SALES.md:20-24); 3 aydan eskiyse panel kendiliğinden görmez. Karaoke ufku 365 güne çıkarsa bu daha sık olur. (b) İptalsiz tam iade push göndermez (order-push-core.ts:136), bilerek. (c) e-Arşiv Paraşüt'te iptal edilirse siteye dönmez (EARSIV.md:497-501) |
| siparis-bar-kisisel | Bar ekranındaki kişisel veri | site yalnız `firstName`; not yalnız masa ve gel-al siparişinde; satır notu (orders-feed-core.ts:225, :262-279) · panel schema.ts:109, :126, :150-158 | yalnız bar kartı | site, beyaz listeyle | Bar listesiyle | Aynı | Yok. Kurye notu iki yanda da düşer; zile, push'a ve günlüğe girmez |
| siparis-satir-eslesme | Satır → panel ürünü (reçete), seçenek ürünleri | site `items[].menuItemId`, `size` · panel bağ indeksi (calc.ts:70-105); seçenek kimlikleri mnu-0081 / mnu-0080 / "alternatif sut" sabit (calc.ts:114-118) | Tutarlılık, Genel bakış | site kimlik, panel bağ | Satış çekmesiyle | ≤ 1 gün | Görünür: bağsız satır listelenir, zil uyarır. Seçenek kimlikleri sitede silinip yeniden açılırsa panel ad eşlemesine düşer (kırılgan) |
| siparis-satis-toplam | Online satış toplamları (kafe, mağaza, karaoke, manual, counter) | site `buildPanelSales` (sales-export-core.ts:438), `version 1` (:64) · panel `site_sales:YYYY-MM` (panel:src/server/site-sales/sync.ts:91-95, :142); `version` katı denetlenir (schema.ts:167-172) | panel Gelir-gider (engine.ts:1677-1679), Genel bakış, KDV tahmini; site Raporlar | site | Çekme: günlük iş 3 ay, elle. Ping yok, bilerek (SITE-SATIS.md:49). Bağlantıları sına yalnız bu ayı çeker (site-links.ts:43) | ≤ 1 gün | Yok. Kod yorumu eskimiş (panel:src/app/api/cron/gunluk/route.ts:26-27) |
| siparis-satis-counter | Kasada kapatılan uygulama / web siparişi | site `manual:nakit` / `manual:kart` → `counter` (sales-export-core.ts:177-195) · panel bilgi satırı (gelir-gider/page.tsx:159-160) | panel Gelir-gider kartı | site | Satış çekmesiyle | ≤ 1 gün | Kasada alınıp "Diğer" seçilirse para hem ModPOS'ta hem online'da sayılır (PANEL-SALES.md:43-47) |
| siparis-satis-secenek | extraShots, milks, syrups adetleri | site (sales-export-core.ts:296-315; kimlikler customization.ts:19-21) · panel `lineSchema` katı: kimlik ≤ 40 karakter, ≤ 20 seçenek (schema.ts:117-133) | panel tüketim, maliyet | site | Satış çekmesiyle | ≤ 1 gün | Sınır aşılırsa ayın bütün yanıtı reddedilir. Bugün 3 süt, 3 şurup |
| siparis-kasa-satiri | Kasa raporundaki günün online satırı | panel `tillOnlineRow` (calc.ts:169-208), `?from=GÜN&to=GÜN`, saklanmaz | /panel/kasa, kasa e-postası | site (anlık çekme) | Rapor açılınca | Anlık; site 8 sn'de yanıt vermezse satır çıkmaz | Yok (gün sınırı farkı bilerek, SITE-SATIS.md:179-181) |
| siparis-kdv-online | Online KDV'nin düştüğü ay ↔ Paraşüt fatura tarihi | site `kdvMinor` sipariş gününe, karaoke ödeme gününe (PANEL-SALES.md:20-28) ↔ fatura kesim günü (EARSIV.md:128-135) · panel `siteVat` → KDV tahmini (panel:src/lib/kdv.ts:136) | panel Nakit planı › KDV tahmini | site dökümü; beyan Paraşüt | Günlük | ≤ 1 gün + dönem kayması | Ekim'de ödenip Aralık'ta kullanılan karaoke panelde Ekim'e, beyannamede Aralık'a düşer. Tahmin olduğu yazıyor (kdv.ts:33) |
| siparis-kdv-menu-orani | Kafe kaleminin KDV oranı | site `taxRates.menu` 10 + `menu_items."taxRatePct"` (kdv.ts:77-86, :169-175), satışta saklı · panel `settings.kdv` tek oran (constants.ts:4) | site fiş, fatura, app KDV dökümü; panel net fiyat, önerilen fiyat, kasa KDV'si | iki ayrı, elle → kalemin oranı sitede; panel bağlı üründe izler | Yok; /api/panel/menu oran taşımaz (menu-link-core.ts:40-42) | Elle | Bugün ikisi de %10. Sitede bir kaleme farklı oran verilirse panel o ürünü %10'la hesaplamaya devam eder; uyarı yok |
| siparis-kdv-hizmet-kargo (+ saat-karaoke-kdv) | Karaoke ve kargo / kurye KDV'si | site `taxRates.karaoke` 20, `taxRates.shipping` 20; rezervasyonda ve siparişte saklı (kdv.ts:177-186) · panel `kdvHizmet` 0,2 (constants.ts:5): kasa hizmet satırları, oransız eski kayıt (calc.ts:35-39), kargo payı (engine.ts:1138) | panel Gelir-gider, KDV tahmini | iki ayrı → site; panel izler | Online KDV tutarı siteden gelir (sales-export-core.ts:375-403); oranın kendisi eşitlenmez | Elle | Bugün hepsi %20. Oran değişirse kasa KDV tahmini, oransız eski kayıtlar ve kargo payı sessizce ayrışır |
| siparis-push | Uygulamaya sipariş durumu bildirimi | site `customer_devices`, `order_push_notices`, `orderPushFor` (order-push-core.ts:79-146) · app kayıt ve kanal (app:src/lib/push-core.ts) | telefon → takip ekranı | site | Expo push + yoklama | Saniyeler | Pratikte yok. Jeton kalıbı farkı: site `[A-Za-z0-9_-]{8,200}` (order-push-core.ts:152), app daha geniş (app:src/lib/push-core.ts:56) |
| siparis-yeni-uyari | Personele yeni sipariş uyarısı | site `staff-new` e-postası, /admin zili · panel bar zili, Web Push | e-posta, /admin, bar, telefon | site olayı; kanallar bağımsız | E-posta `after()`; panel ping → çekme | siparis-bar-liste ile aynı | Tekilleştirme yok, bilerek |
| siparis-masa | Masa kodu ve adı | site `cafe_tables` (ad ≤ 40, cafe-tables-core.ts:22), siparişe anlık `tableCode`/`tableName` · app fetchTable (http.ts:1114-1130) · panel `label` text(40) (panel:src/lib/site-orders/schema.ts:117) | basılı QR, /masa, app, bar kartı | site | App her okutmada çeker; panel siparişin etiketini alır | ≤ 1 dk | "Masa " eki 40 karakterlik adı 45'e çıkarır (order-alerts-core.ts:175-178), panel 40'ta keser. AASA `/masa/*` ve Android intent filtresi ikisinde de yok, yani tutarlı (site AASA route.ts:59-63; app app.json:70-80) |
| siparis-manuel-kasa | Kasada çalınan ↔ online ödenen | site source `manual` bar ekranına gitmez (orders-feed-core.ts:241) · panelde ModPOS cirosu elle | bar kartı, Gelir-gider | site + ModPOS, elle | Satış çekmesiyle | - | Barista online ödenmiş siparişi ModPOS'a da çalarsa ciro iki kez sayılır. Bar kartında "kasaya çalınmaz" ibaresi yok |
| critic-siparis-alimi-anahtari | Uygulamadan sipariş alımı açık mı | site `mobileApp.ordering` {cafeEnabled, deliveryEnabled, pickupEnabled, tableEnabled, …} (app-config.ts:40-53), 409 `ordering_closed` (order-pricing.ts:164, :189). Yazan `saveOrderingAction` (mobil/ayarlar/actions.ts:196, sahip/yönetici) · app bootstrap · panelde yok | app sepet ve ödeme; site ayarları | site | App çeker; panele yok | App ≈ 5-10 dk | Bar ekranı "uygulamadan sipariş kapalı"yı göstermez. Boş liste ile sakin gün ayırt edilemez |
| critic-online-pos-kesintisi | PayNkolay kesintisi ve hakediş | site: PayNkolay `COMMISION`/`COMMISION_RATE` döndürür (site:docs/PAYNKOLAY.md:81-82), kod okumaz; /api/panel/sales ödeme yolunu ayırmaz (sales-export-core.ts:469) · panel `komisyon` 0,025 yalnız ModPOS kartlı satışa (constants.ts:6; engine.ts:1482); nakit planı kesintiyi düşmez (NAKIT-PLANI.md:17) | panel Gelir-gider, Komisyon & hakediş, Nakit planı | yok → oran PayNkolay'dan, taban sitenin kartla tahsilatı, hesap panelde | Yok | - | Online kart satışı büyüdükçe panelin kârı ve nakit planı iyimser kalır. Kesinti biçimi (fatura mı, net aktarım mı) ve oran bilinmiyor |
| critic-kasa-damgasi | Kasada verilen damga | site `loyalty_stamps` source `counter` 1-5 (loyalty.ts:844-856; counter.ts:84-85) · panelde yok | app Ödüller | site | Yok | - | Kasada tutar kuralı yok (API-MOBILE.md:1736-1740); damga ModPOS satışıyla karşılaştırılmaz. Kötüye kullanım gözlenmedi |
| critic-masa-sayisi | Toplam / boş masa | site `venue_status.totalTables`/`freeTables` (venue.ts:41-53) ↔ `cafe_tables`, aralarında bağ yok · app live-status (http.ts:630) | app canlı durum | site, iki alan elle | Elle | - | Masa eklenir ya da pasifleşirse uygulama eski toplamı gösterir |
| critic-tahmin-online, critic-online-ambalaj | Online pay ↔ tahmin; servis biçimi ↔ ambalaj | panel tahmini yalnız Z (SATIS-TAHMINI.md:3-8); site `fulfillment` panele gitmez (sales-export-core.ts:484-503); panel reçetelerinde bardak ve kapak var | panel tahmin, Tutarlılık | - | Yok | - | Online pay büyüdükçe kişi ve tatlı önerisi düşük kalır. Masada servis kabı bilinmiyor |
| siparis-parasut-satis-faturasi (+ marka-parasut-firma-kimligi) | Sitenin Paraşüt satış faturaları | site `sales_invoices`, e-Arşiv (EARSIV.md:410-475) · panel yalnız `purchase_bills` ve gelen e-belgeleri okur (einvoice.ts:116-117) | site Faturalar; panelde yok, bilerek | site yazar, Paraşüt tutar | Yok, gerek de yok | - | Kodda ayrışma yok. İki projenin aynı firmaya bağlı olduğu ve firma profilinin entity.ts ile aynı olduğu bilinmiyor |
| siparis-parasut-cari | Sitenin müşteri carileri | site `account_type customer` (EARSIV.md:434-449) · panel tedarikçi filtresi (sync.ts:927) | panel Tedarikçiler | ayrı | Yok | - | Yok |
| siparis-parasut-urun-kodu | `LAF-<grup>-<oran>` ürün kodları | site ProductGroup → kod (invoice-core.ts:847-867) · panel regex KAFE / MAGAZA / TESLIMAT / HIZMET / KARAOKE (mapping.ts:76), elle kopya | panel iade ayrımı | site → panel aynı listeyi tutmalı | Elle; ortak vektör yok | - | Bugün tutuyor. Site yeni grup eklerse panel o kodla açılan iadeyi gider sayabilir |
| siparis-parasut-iade | Satış iadesi belgesi | site `invoice_refund` işareti, `refundDocNo` · panel `isSalesReturn` (mapping.ts:88-93) | panel Paraşüt; site Faturalar | tutar site, belge Paraşüt | Panel Paraşüt eşitlemesi | ≤ 1 gün | (a) Tüketici iadesi müşteri kartıyla normal gider olarak girilirse panelde "kontrol bekleyen" kalır. (b) `refundDocNo` karşılaştırılmaz. (c) e-Arşiv iptali siteye dönmez |

### 2.4 Mağaza, kampanya, sadakat

| ID | Bilgi | Nerede tutuluyor | Nerede gösteriliyor | Tek kaynak (bugün → olmalı) | Bugünkü eşitleme | Gecikme | Ayrışma kanıtı |
|---|---|---|---|---|---|---|---|
| urun-magaza-maliyet | Mağaza ürününün maliyeti | site `products."costMinor"` (store.ts:263; seed 0, :1014), yalnız admin ürün sayfası ve sihirbaz özeti · panelde ürün maliyeti yok: `shopGoods × avgCostRatio` (engine.ts:1136-1144, :1070-1073) | panel Genel bakış brüt kâr, başabaş | iki habersiz tahmin → adet siteden; maliyet panelden (bağlıysa) ya da sitenin `costMinor`'undan | Yok: mağaza yalnız toplam olarak gider (sales-export-core.ts:448, :469, :480; panel schema.ts:141) | - | Hediye, ekipman ve giyim kafenin ortalama oranıyla sayılır. Sipariş satırında maliyet anlık görüntüsü ve varyant maliyeti yok (store.ts:188-196, :320-357). Alış faturasının kategorisi `pickCategory`'ye bağlı (mapping.ts:398-426), sonucu bilinmiyor |
| urun-magaza-ortak-mal | Kafe stoğundan çıkan mağaza ürünleri | site seed: Sirena 250 g, Yenilebilir Kup 6'lı, Affogato Seti, Uji Matcha (data.ts:895-930; üretimde seed yazılmaz, store.ts:832-840) · panel Cupffee, Kaldi Espresso, Matcha (excel-data.json:43, :281, :1284) | panel Tutarlılık, Mal siparişi | bağ yok → sahip kararı (Soru 7) | Yok: tüketim yalnız `cafe.lines`'tan (engine.ts:870-917) | - | Kutular kafe stoğundan hazırlanıyorsa Tutarlılık'ta açıklanamayan eksik çıkar. Aynı mal olduğu kanıtlı değil (adlar ve tedarikçiler farklı): bilinmiyor |
| urun-odul-icecek-degeri | Ücretsiz içecek kuponunun değeri | site `mobileApp.loyalty.rewardValueMinor` 28000 (app-config.ts:59, :255; üst sınır :188); kupon o anki değerle `fixed` olarak verilir (free-drink.ts:49-58; loyalty-core.ts:660-674) · app "ücretsiz içecek" metni ve "280 ₺ indirim" satırı (me-mapper.ts:267-290; app oduller.tsx:425) | app Ödüller, sepet | iki habersiz değer → fiyat menüde, ödül uyarıyla menüye bakar | Yok; form yalnız üst sınırı denetler (mobil/ayarlar/actions.ts:227-234) | - | Seed'de en pahalı taban 280₺. Eklerle bugün de aşılıyor: yulaf sütlü L'Affogato 305₺ (order-pricing.ts:114; customization.ts:63-76). Toplu zam tabanı aşırabilir; uyarı yok. Canlı değerler bilinmiyor |
| urun-magaza-satista, -stok, -fiyat | Mağaza ürününün aktifliği, stoğu, fiyatı | site `products` (store.ts:251-303) → /api/mobile/v1/shop `s-maxage=60, swr=300` (shop/route.ts:18-20) · app staleTime 30 dk (queries.ts:367-373) · panelde yok | site /magaza; app Mağaza | site | Web anında; app çeker | App ≈ 30-36 dk | Raf eski kalır. Ödemede 400 `line_not_found` / 409 `out_of_stock` (orders.ts:106-134); tutar sunucudan gelir. Ucun yorumu "bir dakika" istiyor, app 30 dk tutuyor |
| urun-magaza-acik | Mağaza açık / kapalı | site `isShopOpen` → bootstrap `shopEnabled` | app sepet | site | App çeker; 409 `shop_closed` | 5-10 dk | Yalnız görüntü |
| urun-magaza-kdv-panel | Oranı saklanmamış eski mağaza siparişi | panel `settings.kdv` ile ayırır (calc.ts:35-39) | panel KDV tahmini | site | Günlük | Günlük | 15-16 Eki'deki %20'lik mallar %10'la ayrılır; tutar bilinmiyor |
| urun-kilometre-tasi | 10., 20., … damga hediyesi | site `MILESTONE_GIFTS` ada göre (milestones-core.ts:23-28, :88-102); değer o anki M fiyatı (milestones.ts:111-127) | app /me yol haritası, kupon | ad kodda → kalem kimliği | Hediye anında okunur | - | Kalemin adı değişirse hediye sessizce rastgele bir içeceğe düşer; yol haritası eski adı yazar |
| urun-damga-davet-kurali | Damga eşikleri (140₺ + her 320₺), davet eşiği (150₺) | site loyalty-core.ts:60, :69; bootstrap `stampMinOrderMinor`/`stampStepMinor` gönderir (app-config.ts:613-614); davet eşiği `INVITE_MIN_ORDER_MINOR` yayımlanmaz (invite.ts:258) · app kendi sabitleri (stamp-rules.ts:16, :19); bootstrap'tan yalnız stampTarget ve rewardTitle okunur (app:src/data/app-config.ts:373-374) · llms.txt:42, :49 | app ödüller, davet, sepet tahmini | sunucu; app elle kopya → app bootstraptan okur | Elle | App sürümü | Bugün aynı. Eşik değişirse sahadaki sürümler eski kuralı gösterir (önizleme düzeltir) |
| urun-promosyon-kupon | Promosyon kodları, hoş geldin / doğum günü | site `promos`, `customer_coupons` | web ve app ödeme | site | Sipariş anında doğrulama | Anlık | Yok: kalem hedeflemiyorlar |
| urun-mutlu-saat | Mutlu saat | site `mobileApp.happyHour`, `HAPPY_HOUR_CATEGORIES` sabiti (menu-mapper.ts:137-147) | app; indirim kasada elle | site | App çeker | 5-10 dk | Hiçbir fiyat yolu uygulamaz, metin bunu söylüyor. Panel tahmini kampanyayı bilmez |
| urun-kampanya-epostasi | Kampanya e-postasındaki ürün ve fiyat | site serbest alanlar `URUN_n_AD`/`URUN_n_FIYAT` (campaign-mail-schema.ts:316-328) | üye e-postası | elle metin | Yok | Kuyrukta kaldığı sürece | Kalem pasif olsa ya da fiyatı değişse de e-posta eskisini duyurur |
| critic-cuzdan-hediye | Cüzdan ve hediye kartı | site `wallet_transactions`, `WALLET_ENABLED` kapalı (wallet.ts:1-41) | bugün hiçbir yerde | site | Yok | - | Kapalı. Açılırsa yükleme ve harcama ayrı günlere düşer, satış dökümü ayırmaz |
| critic-uygulama-tanitim-metinleri | Kaydırma ve gönderilerdeki ürün metni | site serbest metin (store.ts:8835-8930, :9155-9178) · app çevrimdışı 5 kaydırma (app-content.seed.json), sitenin varsayılanı 4 | app ana sayfa | site | App çeker | - | Tükenen sezon kalemi öne çıkmaya devam eder |

### 2.5 Marka, kimlik, türetilmiş kopyalar

| ID | Bilgi | Nerede tutuluyor | Nerede gösteriliyor | Tek kaynak (bugün → olmalı) | Bugünkü eşitleme | Gecikme | Ayrışma kanıtı |
|---|---|---|---|---|---|---|---|
| marka-telefon-eposta | Telefon, iletişim e-postası | site `LEGAL_ENTITY.phone/email` (entity.ts:111, :113). Elle kopyalar: site.ts:71-73, store.ts:946-947 (`defaultSettings`), data.ts:1197-1198, shop-page.tsx:190-191, product-detail.tsx:167, bulten/cikis/page.tsx:93, :100, siparislerim/[orderNo]/page.tsx:366-373, llms*.txt. DB `settings.phone/email` (schema.sql:162-163) · app brand.seed.json:17-18, :70-71, legal.seed.json · panelde yok | footer, ziyaret, işlem e-postası (yalnız telefon; e-posta yalnız Reply-To yedeği, send.ts:109); app Ziyaret (bootstrap, menu-mapper.ts:695-696); JSON-LD (structured-data.ts:257-258, ayarı okumaz); hukuk; ödeme satıcı bloğu (odeme/(checkout)/page.tsx:174-175) | kod + DB → ayar görünen iletişim için, entity yasal değer ve yedek için | Footer anında; app ≈ 70 dk; JSON-LD, hukuk, llms ve tohum için yok | Kod değişene kadar | Bugün aynı (migration'lar hizaladı, schema.sql:1136-1139, :1177-1180). Ayarlar'da telefon değişirse JSON-LD, hukuk, llms ve ödeme bloğu eski kalır; ipucu bunu söylemiyor (settings-form.tsx:306). Canlı değer bilinmiyor |
| marka-adres | Adres | site entity.ts:31-38 ↔ site.ts:74-83 (elle kopya) ↔ `settings.address` · app brand.seed.json:5, :73 | hukuk, JSON-LD, footer, app | entity (vergi levhası) | Elle | - | Bugün aynı |
| critic-panel-konum | Kafenin konumu (panel) | panel `TUZLA` "Opera AVM" (panel:src/lib/forecast/weather.ts:13-14; SATIS-TAHMINI.md:11; KALAN-ISLER.md §5.1 varsayılanı) ↔ site köşk adresi ve koordinatı 40.8165716 / 29.3032493 (site.ts:84-86) | panel hava durumu | site | Yok | - | Koordinat farkı ≈ 200 m (hava durumu için önemsiz); metin yanlış |
| marka-yasal-kimlik | Unvan, VKN, MERSİS | site entity.ts tek kaynak · app brand.seed.json:59 `SITE.legalName` "L'Affogato Italia" (okuyan kod yok) | hukuk, e-Arşiv, JSON-LD, app Yasal | entity.ts | Hukuk tohumu `legal:export` ile elle | App sürümü | Tohumdaki `legalName` yanlış ama ölü alan. /admin/hukuk override'ı token doldurmaz (documents.ts:64-117); canlıda override var mı bilinmiyor |
| marka-sosyal | Sosyal hesaplar | site entity.ts:159-164 ↔ site.ts:117-123 (+ X) · app brand.seed.json:108 (app yalnız tohumdan okur, social.ts:21-33) | footer, JSON-LD, app | entity | Elle | App sürümü | X hesabı yalnız JSON-LD'de |
| marka-mekan-hikaye-tohumu | Mekân ve hikâye metinleri | site data.ts LOCATION / STORY / PRESS ↔ app brand.seed.json | site, app | site | Hikâye çekilir; karaoke kartı yalnız tohumdan | App sürümü | Tek fark karaoke kart metni; yüzeye özgü |
| marka-palet | Palet | app tokens.ts:346-396 → site globals.css:32-105; tablo SITE-PALETTE-SYNC.md:19-27 | app, site, e-postalar | app → site | Elle; çapraz test yok | Elle | Bugün yok |
| marka-eposta-gorunumu | E-posta görünümü | site şablonları porselen paletinde; Supabase şablonları panoda; panel AkmanOS | gelen kutuları | site / panel ayrı | Elle | - | app CLAUDE.md:136-137 ve SITE-PALETTE-SYNC.md:14 "#143d2b" diyor, site şablonlarında #143d2b yok. Panodaki kopya bilinmiyor |
| marka-logo | Logo dosyaları | üç repoda aynı (sha256 karşılaştırıldı) | her yer | site public/brand + app scripts/icons | Elle | - | Yok |
| marka-llms-txt (+ urun-magaza-turetilmis) | llms*.txt menü ve mağaza bölümleri | site public/llms.txt:56-92, llms-full.txt:57-235 (elle); vercel.json:24-43 1 gün CDN | yapay zekâ tarayıcıları | elle → canlı DB | Yok; test yalnız kimlik ve saati sınar (llms-consistency.test.ts:9-18) | Sınırsız | Fiyatlar seed'le aynı. Adlarda bayatlık: "White/Caramel Sıcak Çikolata" (llms.txt:64; llms-full.txt:123-124); 11 mağaza adının 8'i farklı ("Edible Cups" llms.txt:84, "Porselen Espresso Set" :88, altısı uzun tire); llms-full kategori başlıkları İngilizce (:69, :91, …). Canlıya karşı fark bilinmiyor |
| marka-yapisal-veri-sitemap | Menü JSON-LD, sitemap | site structured-data.ts:437-472, `listSiteMenu` önbelleği | Google | canlı menü | `pub:menu` etiketi | İlk istek | Yok |
| marka-katalog-tohumu | App çevrimdışı katalog | app catalog.seed.json ↔ site data.ts | app çevrimdışı vitrin (`orderable: false`) | site | Elle | App sürümü | Fiyat farkı 0. İki üründe `taxRatePct` eksik; 75 kalem fotosuz |
| marka-catalog-md | App katalog belgesi | app docs/CATALOG.md (:3 eski kaynak) | belge | site | Yok | - | 37 ad İngilizce kalmış. Alternatif Süt'te `nuts` yok (:231; sitede data.ts:808 var); özet "nuts 4" (:34) |
| marka-hukuk-tohumu | App çevrimdışı hukuk | app legal.seed.json ↔ site `legal:export` | app onay ekranları | site | Elle | App sürümü | Yok (bayt aynı) |
| critic-kvkk-panel-kopyasi | Panel kopyasının hukuk metninde anlatılması; push'taki ad | site metni "ad yalnızca rezervasyon kaydında tutulur" (content.ts:8017, :14522); alıcı listesinde Vercel, DB ve Resend var, push yalnız uygulama için (content.ts:568, :1128); panelden söz yok · panel adı 3 yıl tutar; karaoke Web Push gövdesinde ad (panel:src/lib/karaoke/session.ts:117-132 → sync.ts:257-272); sipariş push'unda ad yok (SITE-SIPARIS.md:26) | personelin kilit ekranı; site KVKK metinleri | site metni bütün kopyaları anlatmalı | Elle | - | Metin ile panel kopyası ve push ayrışıyor. Panel DB bölgesi bilinmiyor |
| marka-kullanicilar | Site yöneticileri, baristalar, üyeler, panel kullanıcıları | site `admin_users`, `staff_members`, `customers` · panel `users`; aralarındaki tek bağ `actor` adı (menu-link-core.ts:214-216) | girişler, olay kayıtları | ayrı | Yok (bilerek) | - | Ayrılan çalışan üç yerde ayrı kapatılmalı; hatırlatıcı yok |
| critic-eposta-altyapisi | Ortak Resend hesabı ve alan adı | panel:src/server/notify/resend.ts:8-12; site send.ts:88-123 | e-postalar | aynı hesap | Elle | - | Kota ortak; site belgesi bunu söylemiyor |
| critic-uygulama-kimligi | bundleId, en düşük sürüm | site `mobileApp.store.bundleId`, `minSupportedAppVersion` (app-config.ts:34, :118-131) ↔ app app.json (1.1.0) | AASA, assetlinks, zorunlu güncelleme | app.json | Yollar yan klon testiyle kilitli (site tests/mobile-store-links.test.ts:208-226) | Elle | Yayımlanmamış sürüme yükseltilirse bütün kurulumlar güncelleme ekranında kalır |
| critic-supabase-ve-api-adresi | Gömülü API ve Supabase adresi | app EXPO_PUBLIC_*; site SUPABASE_URL; panel LAFFOGATO_URL | her istek | site | Elle | App sürümü | Bugün aynı (apex). Supabase projesi değişirse sahadaki sürümler 401 alır |

### 2.6 Bağlantı altyapısı

| ID | Bilgi | Nerede tutuluyor | Nerede gösteriliyor | Tek kaynak (bugün → olmalı) | Bugünkü eşitleme | Gecikme | Ayrışma kanıtı |
|---|---|---|---|---|---|---|---|
| baglanti-anahtar | `KARAOKE_SYNC_SECRET` (dört bağlantının tek anahtarı) | site karaoke-sync-core.ts:62-82 (≥ 32) · panel site-link.ts:16-19 | site Sistem durumu (yalnız var/yok), panel Ayarlar | iki env, elle | Elle | İkinci yayına kadar 401 | Anahtarlar farklıysa panel çekmeleri kırmızı olur, sitenin Sistem durumu yine "açık" der (panel-link-status.tsx:30-45; link-status.ts:87-89) |
| baglanti-imza | İmza kuralı ve vektörler | site karaoke-sync-core.ts:92-129 ↔ panel signature.ts:14-38 | - | iki kopya, aynı vektörler | Elle | - | Karaoke vektörleri iki yanda var. Menü vektörleri yalnız panelde (site-menusu.test.ts:308-316). Sipariş, aşama ve satış vektörü hiçbir yanda yok. 5 vektör yeniden hesaplandı, tuttu |
| baglanti-ping-teslimi (+ menu-baglanti-sagligi) | Pingin panele ulaşıp ulaşmadığı | site saklamaz; 5 dk'da bir `console.warn` (ping.ts:45, :77-82, :119) · panel `lastPingAt` (karaoke sync.ts:69-71, menü sync.ts:131, sipariş sync.ts:121) | panel Ayarlar'da metin (ayarlar/page.tsx:312) | yok → site sonucu sınanabilir yapsın, panel sınasın | Yok | - | Yanlış ama geçerli bir https host verilirse site "açık" der, panel "4/4 bağlı" der; tek iz eskiyen "son ping". Uyarı yok. Şemasız ya da http `PANEL_URL` verilirse bağlantı tümüyle kapanır ve bu görünür (karaoke-sync-core.ts:67-81) |
| baglanti-sina-ve-gunluk-kapsami | "Bağlantıları sına" ve günlük işin kapsamı | panel site-links.ts:38-47 (4 GET; satış yalnız bu ay); gunluk/route.ts:119-127 (karaoke, menü, satış paralel; sipariş yok) | panel Ayarlar | - | - | - | Sınanmayanlar: POST menü, POST aşama, üç ping. Menü POST'u 404'leri ayırt etmez (panel:src/lib/site-menu/push.ts:120-121) |
| baglanti-ping-olmayan-yazimlar | settings ve venue_status yazımları | site tags.ts:89, :99; panel okuma ucu yok (/api/panel altında yalnız karaoke, menu, orders, sales) | - | - | Yok | - | `pub:site` 13 tabloda düşer ve her fiyat değişikliğinde settings yazılır (tags.ts:89-98; store.ts:7174-7181): ping etikete bağlanamaz |
| baglanti-sozlesme-belgeleri (+ menu-belge-farki, marka-panel-sozlesme-belgeleri, marka-api-mobile-sozlesme) | Sözleşme belgeleri | site docs/PANEL-*.md, API-MOBILE.md · panel docs/KARAOKE.md, SITE-*.md · app API-MOBILE.md | belge | kod esas | API-MOBILE hash kilitli; PANEL/SITE elle | - | Kaymalar: PANEL-MENU.md:16-20 ("çakışma doğmaz"); :62-64 ("öbür satır sonraki çekmede", oysa panel aynı yazımda yapar, push.ts:100-106); :139 ve SITE-MENU.md:105 ("Panel · Selin", kod "Yönetim paneli · Selin", karaoke-panel.ts:1018-1022); :149 (503 `unavailable` yok); :160-162 ("5 dk"). SITE-MENU.md:126-131 (`now` sırası; site artık önce alır, route.ts:90-93). gunluk/route.ts:26-27 yorumu |
| baglanti-sitede-ac-yollari | Panelin bağlantı verdiği site yolları | panel karaoke/page.tsx:93-104, ayarlar, gelir-gider | panel | site | Yok | - | /admin/mobil/karaoke ve /admin/siparisler/[id], site CLAUDE.md'deki "yeniden adlandırılmaz" listesinde yok |

### 2.7 LafPOS (kafenin kasası)

LafPOS 26 Ekim 2026'da birleşti; kafede henüz ModPOS kullanılıyor. Bütün bağlantılar varsayılan kapalı: anahtar yoksa
uçlar kapalıdır, panelde "LafPOS'a geçiş günü" (`settings.lafposGecisGunu`) boşken LafPOS'un gönderdiği hiçbir şey
hesaba, ekrana, göreve ya da e-postaya girmez (sahibin 26 Ekim kararı; açılış sırası lafmaliyet `docs/LAFPOS.md` ›
Açılış sırası). Anahtar sitede ve panelde `LAFPOS_SYNC_SECRET` (karaokeninkinden ayrı), LafPOS'ta `LAFFOGATO_SYNC_SECRET`
ve `LAFMALIYET_SYNC_SECRET`.

| ID | Bilgi | Kaynak → kopya | Bağlantı | Sıklık | Panelde | Not |
|---|---|---|---|---|---|---|
| lafpos-menu | Menü: ad, fiyat (M, L), KDV, Satışta / Tükendi, seçenekler | site → LafPOS | Herkese açık `GET /api/mobile/v1/menu`, `If-None-Match` (ETag; 304 değişmedi). Anahtar verilirse imzalı `GET /api/panel/menu` (Tükendi kalemler de) | Gün açıkken 15 dakikada bir (gece hiç; gün açılınca bir kez; lafpos server/jobs.ts `MENU_SYNC_INTERVAL_MS`), LafPOS'un kendi Tükendi / Satışa aç yazımından hemen sonra bir kez + "Siteyle eşitle". Herkese açık menünün önbelleğiyle yeni fiyat 15-30 dakikada | Geçiş gününden itibaren siteye bağlı ürünün kasadaki fiyatı elle değişmez: Kasaya işle'de görünmez (kasanın ModPOS durumu yine yazılır; B11) | Menüde olmayan bağlı ürün LafPOS'ta Tükendi olur (silinmez) |
| lafpos-tukendi | Tükendi / Satışa aç | LafPOS → site (önce site, 2xx gelince yerel) | İmzalı `POST /api/panel/menu {id, isActive, actor}` | Kullanıcı işlemi | Panel sitenin pingiyle alır (menü pingi) | Panelin bar ekranındaki Tükendi de siteye yazar; kasa sonraki menü çekmesinde görür |
| lafpos-siparis | Online sipariş (masa, gel-al, kurye) ve aşaması | site → LafPOS; aşama LafPOS → site | Sürüm sinyali imzalı `GET /api/pos/orders/version` (20 sn; sitenin önbelleğinden, veritabanına dokunmaz), değişince `GET /api/panel/orders`; aşama `POST /api/panel/orders/stage` | 20 sn sinyal; okuma 5 dk + ekran açılınca + elle | Panelin bar ekranı aynı uçları okur (sipariş pingi) | LafPOS online ödenmiş siparişi tahsil etmez ve satış listesine koymaz |
| lafpos-gun-sonu | Gün sonu: Z özeti, ürün satış satırları, ödeme türleri, ikram ve zayi | LafPOS → panel | İmzalı `POST /api/pos/gun` (panelin `pos_day_reports`, `pos_daily_sales`) | Günü kapatınca, gelmeyen gün LafPOS'tan yeniden gönderilir | Geçiş gününden itibaren: Satışlar, Kasa raporu (ön doldurma, karşılaştırma), komisyon, ikram, kapalı gün kanıtı, ay rakamları; öncesi deneme (yalnız Ayarlar › LafPOS) | B07-B10; durum ve onarım Ayarlar › LafPOS |
| lafpos-maliyet | Ürün maliyetleri (reçeteye göre, kuruş, KDV hariç) | panel → LafPOS | İmzalı `GET /api/panel/pos/urunler` | LafPOS istedikçe (patron panelinin ürün kârlılığı) | Panel verir, okumaz | LafPOS yalnız `rapor.maliyet` yetkisine gösterir |
| lafpos-gecis-gunu | Kasanın ModPOS'tan LafPOS'a geçtiği ilk iş günü | panel (Ayarlar › LafPOS, yalnız yönetici) | Gün sonu yanıtında `counted` ve `switchDay` | Ayar değişince | Kaynak (B07): her okuyucu `src/lib/lafpos/switch.ts` üzerinden; metinler (ModPOS / LafPOS) `src/lib/lafpos/kasa.ts` (B11) | LafPOS kendi tarihini tutmaz; eğitim kipi LafPOS'ta |

---

## 3. Kararlar

### 3.1 Her kararda geçerli ortak kurallar

- **Yön.** Müşteriye dönük bilgi sitede yaşar, panel okur (menü, fiyat, saat, kapanış, karaoke kuralları, KDV oranı,
  sipariş). Panelin kendi bilgisi panelde yaşar (reçete, maliyet, hammadde, kasa, doluluk, tahmin). Uygulama yalnız
  siteden okur.
- **Mekanizma.** Önce var olan desen: içeriksiz imzalı ping (`{event, at}`), ardından imzalı çekme,
  `KARAOKE_SYNC_SECRET`. Yeni bilgi var olan yanıta isteğe bağlı alan olarak eklenir; uymuyorsa yeni `/api/panel/*`
  ucu. `version` alanları değişmez (panel bilinmeyen sürümü reddeder, panel:src/lib/site-sales/schema.ts:167-172).
  `/api/mobile/v1` yalnız ekleme ile değişir.
- **Yetenek bayrağı (panel → site yazımları).** Sitenin yazma şemaları `.strict()` (site:src/lib/panel/menu-link-core.ts:112-121);
  `pushSaleChange` 2xx dışındaki her yanıtta `UserError` atar (panel:src/server/site-menu/push.ts:78). Site geri
  alınırsa ya da önizleme bir dağıtıma bakarsa yeni alanlı her yazım 400 alır. Kural: panelin yazma ucuna eklenen her
  yeni istek alanı, sitenin GET yanıtının üst düzeyinde isteğe bağlı bir bayrakla duyurulur (`writes: {expect: true}`;
  eski panel atar, panel:src/lib/site-menu/schema.ts:67-71). Panel alanı yalnız son çekmede bayrağı gördüyse gönderir;
  400 `field` = o alan gelirse alansız bir kez yeniden dener.
- **Çakışma.**
  - `expect` yalnız yazılacak alanlar için denetlenir. Sıra: parse → kalem → `single_size` → `changedSaleFields`.
    Değişen alan yoksa bugünkü gibi 200 ve kalem (eski `updatedAt`) döner, `expect`'e bakılmaz
    (site:src/app/api/panel/menu/route.ts:142-145); dalga 10'un "zaten tükendi" dalı buna dayanır
    (d10:docs/planlar/personel-yetki.md:179). Değişen alanın `expect`'i tutmazsa 409 `{error:"stale", item}`.
    `expect`'li yazım koşullu UPDATE'tir (`.eq(col, expected)`); `expect`'siz eski istek bugünkü gibi yazılır.
  - Sitenin formu: dokunulmayan satış sütunu UPDATE'e hiç girmez; dokunulan sütun yüklendiği değere koşullu yazılır
    (toplu yolun deseni, site:src/lib/admin/store.ts:7219-7243). Etkilenen satır yoksa "Bu kalem bu arada değişti".
  - Panelin kendi tuttuğu değer (oda saati, oranlar, açık gün) sitedekinden farklıysa panel uyarır, ezmez.
- **Hata.** Ping her zaman kaybolabilir. Her bağlantının yedekleri: ilgili ekranın çekmesi, günlük iş (05:00 UTC,
  paralel adımlar, panel:src/app/api/cron/gunluk/route.ts:119), "Bağlantıları sına". Ping teslimi de sınanır (S5);
  sınama pingi gerçek çekme yaptırmaz (`probe: true`).
- **Bütçe.** Sınırı Vercel değil Neon koyuyor: sitenin projesi 23 Ekim'de 81/100 CU-saat, günde ~3,6
  (site:docs/DATABASE.md:264-273); panelin projesi ayrı bir Free proje, kullanımı bilinmiyor. Birim fiyatlar (0,25 CU,
  5 dk uyku): tek uyanma ≈ 0,02 CU-saat; günde bir ek uyanma ayda ≈ 0,6; saatlik yoklama ayda ≈ 15; 5 dk'dan sık
  yoklama veritabanını sürekli uyanık tutar. Kurallar:
  1. 5 dakikadan sık periyodik iş yok.
  2. Sitenin veritabanına giden her yeni periyodik çekme ya 304 işaretinden (S4) ya günlük işten geçer. Sayfa açılışı
     çekmesi yalnız `after()` içinde ve yalnız kopya 24 saatten eskiyse ya da son çekme hatalıysa.
  3. Yeni cron yok; yeni adımlar günlük işin paralel kuyruğuna girer ve `tailStepDeadline` ile sınırlıdır (iş 60 sn,
     panel:src/app/api/cron/gunluk/route.ts:35).
  4. Pinge bağlı yoklama süreli ve gerekçeli olur (ödeme bekleyen sipariş gibi); "her pingte 2 saat yoğun mod" yok.
  5. İstemci yoklaması yeni bir veritabanı okuması doğurmaz (genel sayfaların açık / kapalı durumu sayfa verisiyle gelir).
- **KVKK.** Panele müşteri e-postası, telefonu, soyadı, adresi ve ödeme referansı gitmez. Yeni beyaz listeler alan alan
  kurulur (yayma yok); test anahtar kümesinin tamamını eşitlikle sınar. `settings` personel e-postası taşır
  (`notificationEmail`, `orderNotifyEmails`, `emailReplyTo`; site:src/lib/admin/store.ts:623-646); sipariş satırının
  `productName`'i elle siparişte serbest metindir. Müşteri adı yalnız ekranda görünür; bildirim gövdesine, günlüğe ve
  işlem geçmişine yazılmaz. Personel maliyet ve tutar görmez.
- **Sözleşme kopyası.** API-MOBILE.md'ye dokunan her site PR'ı için bir lafmobil PR'ı açılır, birleşme sırasıyla;
  kopya site PR'ı birleştikten sonra sitenin `main`'inden alınır. Sitede yerel parite testi
  `LAFMOBIL_DIR=<o lafmobil dalının worktree'si>` ile koşulur (site:tests/api-contract-parity.test.ts:19-26); yoksa
  `../lafmobil` (`main`) ile karşılaştırıp kırmızı olur ya da worktree'de atlar (:31-36). lafmobil'de `RECONCILED`,
  "Re-synced" satırı ve yeni başlıklar `SECTIONS`'a (app:src/data/contract-sync.test.ts:22-31, :89-113).
- **Gecikme hedefi (varsayılan).** Site → panel ≤ 10 sn. Kaçan ping: ilgili ekranın yoklaması ya da ertesi sabah. Ödeme
  pingi kaçarsa bar ekranında ≤ 6 dk (yalnız ödeme beklenirken; bildirimi kapalı ya da ekranında açık sipariş olan
  görünür ekranda. Bildirimi açık, boş ekran takibi kabuğun 30 dakikalık kontrolünde öğrenir: P2 › Durum 5). Site →
  uygulama: menü ≤ 15 dk, mağaza ≤ 20 dk (yeni
  uygulama sürümünden sonra). Genel sayfalar: etiket düştükten sonraki ilk sayfa yüklemesi. llms.txt ≤ 1 gün. Sipariş
  anındaki karar her zaman güncel.

### 3.2 Değişen kararlar

| ID | Tek kaynak ve yön | Mekanizma | Çakışma / hata | Gecikme | Görev |
|---|---|---|---|---|---|
| menu-fiyat, menu-satis-durumu | Site; panel yalnız site üzerinden yazar | Var olan ping + çekme. POST'a isteğe bağlı `expect {priceMinor?, priceMinorL?, isActive?}`, GET'e `writes:{expect:true}`. Site formu yalnız dokunulan satış sütununu koşullu yazar. Panel kartı `seenPrice` taşır (`seenActive`/`seenShowOnMenu` dalga 10'da) | §3.1. Panel 409 `stale` → çekme + "bu arada değişti"; `single_size` ayrı; zaman aşımı "sitede yapılmış olabilir" + hemen çekme | ≤ 10 sn | S1, P1 |
| menu-uygulama-tazelik | Site → app | /menu SWR 3600 → 300 (veritabanı okuma sayısı değişmez, site:src/app/api/mobile/v1/menu/route.ts:7, :26). App menü ve customization staleTime 1 sa → 5 dk, mağaza 30 → 10 dk. Satır reddi menüyü / mağazayı geçersiz kılar. If-None-Match yok (304 bugün hata, app:src/data/api.ts:284-306) | Sunucu reddi değişmez | Menü ≤ 15 dk | S1, M2 |
| menu-alerjen | Site, elle | Panelde bağlı ürünün malzeme kümesi değişince hatırlatma; alerjen panele gitmez | - | Kayıt anında | P4 |
| menu-kasa-fiyati, menu-yeni-kalem | Kasa elle, tek adım Kasaya işle; LafPOS'a geçiş gününden itibaren siteye bağlı kalem için kasa sitedir (B11) | LafPOS gününde siteye bağlı ürünün değişikliği Kasaya işle'ye girmez, bekleyen eski işareti gizlenir (silinmez; panel:src/server/prices/record.ts, src/server/data/till-scope.ts). Bağsız kalem Kasaya işle'ye girmez (personelin listesi ürün satırıdır, d10 plan §2.2). Yalnız yönetici: /panel/urunler/site "Yalnız sitede" sekmesinde ve zilde "Sitede fiyatı değişti, panele bağlı değil: X · Bağla". Bağlanınca var olan `pos_stale` yolu çalışır. İlk çekmede karşılaştırma yok | - | Çekme anı | P4 |
| menu-tukenen-hammadde | **Düştü (26 Ekim 2026, B21: hızlı sayım kaldırıldı).** Eskiden: panel uyarır, insan karar verir | Hızlı sayım sonucunda eldeki 0 olan takipteki hammaddeyi kullanan bağlı ve Satışta kalemler listelenir; düğme dalga 10'un `setSoldOut({siteMenuId, soldOut:true})` eylemini çağırır (iki rol, yükte fiyat yok). Otomatik düşürme yok | `expect` (P1) | Kayıt anında | P4 |
| menu-kalem-silme | Site | Bağ silme yüzünden kalkınca aynı yazımda `showOnMenu=false` | - | Çekme anı | P4 |
| menu-fiyat-listesi-tarihi | Site; gün operatörün | İşaret yalnız fiyat değişince (bugünkü kural: site:src/app/api/panel/menu/route.ts:152, site:src/app/admin/menu/actions.ts:308-311). Satış durumu tarihi değiştirmez. Faz 3: GET menüye isteğe bağlı `pricesEffectiveDate`/`pricesChangedAt`, panel Kasaya işle'de (yönetici) uyarı | - | Menü pingi | S9, P8 |
| baglanti-mobil-ozellestirme-fiyati | Menü kalemi (Soru 5 kararı) | Ek ücret mnu-0081 / 0080 / 0082'nin `priceMinor`'ından, `isActive`'e bakmadan; sabite yalnız kalem yoksa, iki boyluysa ya da fiyat geçersizse dönülür. Laktozsuz 0 | Sabit yedek | /menu tazeliği | S8 |
| saat-haftalik, baglanti-ping-olmayan-yazimlar | Site → panel | İmzalı `GET /api/panel/settings` (v1, alan alan); ping `settings.changed` action'lardan açıkça (etiketten değil: `pub:site` her fiyat yazımında düşer, site:src/lib/cache/tags.ts:89). 304 (S4) | Panel ezmez, farkı gösterir. Yedek: ping + günlük iş + Ayarlar (yönetici) açılışı yalnız kopya 24 sa'ten eskiyse ya da hatalıysa, `after()` içinde. Bugün / Doluluk açılışında çekme yok | ≤ 10 sn; yedek ertesi sabah | S3, S4, P3 |
| saat-anlik-durum | Site | Panel: Bugün'de "Sitede kafe şu an elle kapalı / açık" (ayar ucundan). Genel sayfalar: `loadAppProps`'a girdi (`manualOverride`; kapanışlar S7 ile), hesaplanmış sonuç değil; ayrı etiket, yalnız canlı durum action'larında `manualOverride` değişince düşer (`venue_status` eşlemesine eklenmez, site:docs/AUDIT.md:452). Açık / kapalı istemcide hesaplanır (site:src/components/laffogato/use-open-status.ts:17-28); istemci yoklaması yok | Alan yoksa bugünkü davranış | İlk sayfa yüklemesi | S6, F1, S3, P3 |
| saat-tarihli-kapanis | Site (Soru 1 kararı) | Migration `settings."hoursExceptions"`. venue.ts kuralları, karaoke (red 409 `slot_taken` + sunucu mesajı; availability'ye isteğe bağlı `closed`, `closedLabel`), /bootstrap `venue.closures[]`, ayar ucunda `closures`. Kaydetmeden önce o güne düşen ödenmiş karaoke ve planlı ödenmiş kafe siparişleri sayı ve bağlantıyla listelenir, onay istenir; kendiliğinden iptal yok (aynısı haftalık kapalı gün eklenince). Panel kapanışları dalga 10'un `closedDaysBetween`'ine ikinci, salt okunur kaynak olarak birleştirir: Bugün, tahmin ve eksik kasa listesi; `closedDayRefusal`'a girmez, `special_days`'e asla yazılmaz | `manualOverride` önce; kapalı istisna D'nin kendi penceresini kapatır, D-1'in gece kuyruğunu kesmez. 409 `cafe_closed` eski app'leri korur (app:src/components/checkout/use-checkout-order.ts:1175-1191) | Panel ≤ 10 sn; app live-status ≤ 90 sn, bootstrap ≤ 70 dk | S7, F2, P3, M3 |
| saat-gecmis-kapali-gun | Panel kasa (dalga 10 §2.9) | Dalga 10'un `closedYesterday` / `closedDaysBetween`'i (d10:src/server/closed-days.ts:20-35, :45-57); P3 site kapanışını ve haftalık kapalı günü ikinci kaynak olarak ekler | - | - | dalga 10, P3 |
| saat-statik-kopyalar | Dinamikler weeklyHours'tan, statikler entity'den | faq.ts ve pages.ts:95 ayardan (arka yüz, S7); chrome.tsx, home-page.tsx, data.ts saat metni `hoursLabel`'dan (ön yüz, F2). Test: `LEGAL_ENTITY.cafeHours` = varsayılan weeklyHours; fark varsa Saatler'de "Hukuk metni ve llms.txt elle güncellenmeli". app:src/lib/hours.ts:4 yorumu (M4) | - | Kayıt anında | S7, F2, M4 |
| critic-acik-gun | Panel yazar, siteden önerilir | Ayarlar'da "Sitenin saatlerine göre bu ay N açık gün" ve fark uyarısı | - | - | P3 |
| saat-karaoke-oda-saatleri | Site; panel doluluk için ayrı tutabilir | Ayar ucunda `karaoke.firstHour/closeHour`. Panel kaydı yoksa open = max(5, firstHour), close = closeHour; varsa Doluluk'ta fark satırı | Panel ezmez | ≤ 10 sn | S3, P3 |
| saat-karaoke-oda-gercek-doluluk | Panel | Eşitlemede yeni site rezervasyonu süren / uzatılmış panel oturumuyla kesişirse bar ekranında sarı satır; zil "Oda şu an 22:30'a kadar dolu" (ad yok). Siteye tutma yazmak sonraya | - | Ping anı | P5 |
| saat-karaoke-kvkk | Site; panel siler, asla doldurmaz | Haftalık (pazartesi) geniş pencere boşaltması: 20 Eki 2026'dan düne ≤ 400 günlük parçalar, yalnız silme yönü, `tailStepDeadline`. `activity_log`'a ad yerine oturum kimliği. Site: hesap silmede `note` da boşalır (Soru 11 kararı) | - | ≤ 1 hafta | P5, S11 |
| saat-karaoke-iptal | Site | Migration `karaoke_reservations."cancelledAt"`; `toPanelReservation`'a isteğe bağlı (panel zaten okur, panel:src/lib/karaoke/site.ts:27-28) | - | Ping anı | S9 |
| saat-karaoke-ucret, siparis-kdv-menu-orani, siparis-kdv-hizmet-kargo | Oran ve ücret sitede; panelin oranı kasa ve oransız eski kayıt için | Ayar ucunda `taxRates`, `karaoke.hourlyMinor`; GET menü kaleminde isteğe bağlı `taxRatePct`. Panel farkı Oranlar ve Ürünler'de uyarır; kargo payı sitenin `shipping` oranıyla; Doluluk'ta "Sitede saat ücreti" (yönetici) | Panel ezmez | ≤ 10 sn | S3, P3 |
| siparis-bar-liste | Site | Site: GET /api/panel/orders'a isteğe bağlı `awaitingPayment` (son 30 dk'da açılmış, `pending_payment` durumdaki kafe siparişlerinin SAYISI). Panel: sayı > 0 iken en çok 30 dk, 3 dk'da bir çeker; 0 ↔ > 0 geçişinde sürüm artar (ETag). Pingte 2 sa yoğun mod yok. Saatlik kontrol pingle yapılan çekmeyi saymaz. Ping dışı çekme, `paidAt`'i bir önceki başarılı çekmeden eski yeni sipariş bulursa "ping kaçtı" anı yazılır. Site kapalıyken sessiz saatlik çekme durur, açılıştan 30 dk önce başlar (P3; ödeme bekleyen ve hata tekrarı muaf) | - | ≤ 10 sn; ödeme pingi kaçarsa ≤ 6 dk | S2, P2, P3 |
| siparis-iptal-iade | Site | Bugünkü 3 ay kalır (panel:src/lib/site-sales/calc.ts:53). 13 aylık geri çekme yok (günlük işin süresi); Faz 3'te site isteğe bağlı `refundTouchedMonths` verir, panel eski ayı yalnız işaret edilince çeker | - | ≤ 1 gün | S9, P8 |
| siparis-masa, siparis-manuel-kasa | Site | Panel `label` sınırı 40 → 48 (bugün kısaltıyor, veri kaybı yok, panel:src/lib/site-orders/schema.ts:83-87). Bar kartında "Ödendi (online) · kasaya çalınmaz" | - | - | P8 |
| siparis-satis-counter, -secenek, -satir-eslesme | Site | "Diğer" uyarısı; seçenek kimliği ≤ 40 / ≤ 20 testi; "menü kimlikleri yeniden kullanılmaz" kuralı PANEL-MENU.md (S1) ve SITE-MENU.md'ye (P1) | - | - | S1, P1, S11 |
| critic-siparis-alimi-anahtari | Site | Ayar ucunda `ordering`; bar ekranında "Uygulamadan sipariş kapalı" şeridi | - | ≤ 10 sn | S3, P3 |
| critic-online-pos-kesintisi | Tahsilat site, hesap panel (Soru 10) | `/api/panel/sales`'e isteğe bağlı `cardMinor` (yalnız `paynkolay`, iadeler düşülmüş). Panel: oran girilene kadar satır da uyarı da yok | - | ≤ 1 gün | S9, P7 |
| urun-magaza-maliyet | Adet siteden, maliyet panelden (bağlıysa) ya da `costMinor`'dan | `shop.lines` yalnız `productId`'li katalog satırlarından, ad ve sku `products` tablosundan; `manual` ve `counter` hariç; alan alan. Panel: bağ → `costMinor` (> 0) → ortalama oran; bağlanan satırın neti `shopGoods`'tan düşülür. Yalnız yönetici | - | ≤ 1 gün | S9, P7 |
| urun-magaza-ortak-mal | Soru 7 | Sahip listelerse panelde reçeteli mağaza ürünü ve `site_shop_id` | - | ≤ 1 gün | P7 (koşullu) |
| urun-odul-icecek-degeri | Site | Ödül değeri en pahalı aktif içeceğin tabanının altına düşünce uyarı (Sadakat formu, menü formu, panel POST yanıtında isteğe bağlı `warnings[]`) | - | Kayıt anında | S11, P8 |
| urun-kilometre-tasi | Site | `MILESTONE_GIFTS` `menuItemId` tutar, ad yedek | - | - | S8 |
| urun-damga-davet-kurali | Site | App bootstrap'tan `stampMinOrderMinor`/`stampStepMinor` okur; davet eşiği bootstrap'a isteğe bağlı alan | - | App sürümü | S8, M3 |
| critic-masa-sayisi | Site | Canlı durum formunda "QR'lı aktif masa: N" ipucu | - | - | S11 |
| marka-telefon-eposta, marka-adres, marka-sosyal | Entity yasal değer ve yedek; ayar görünen iletişim | site.ts:71-83, :117-123 ve store.ts:946-947 entity'den; JSON-LD `LdSettings`'e phone/email; ipucu. Ön yüz yedekleri (shop-page.tsx:190-191, product-detail.tsx:167) `SITE`'tan | - | Kayıt anında | S11, F2 |
| critic-panel-konum | Site adresi | weather.ts:13-14 yorumu ve koordinatı, SATIS-TAHMINI.md:11, KALAN-ISLER.md §5.1 | - | - | P8 |
| marka-llms-txt | Canlı DB | `src/app/llms.txt/route.ts` ve `llms-full.txt/route.ts`, `dynamic = "force-dynamic"` (site:src/app/sitemap.ts:13 gibi), yalnız site-data.ts'in önbellekli okuyucuları; public dosyalar aynı PR'da silinir (yol çakışması). `Content-Type: text/plain; charset=utf-8` ve `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400` yalnız route'ta; vercel.json:24-43 kuralı kalkar | Önbellekli okuyucu düşerse fiyatsız | ≤ 1 gün | S10 |
| critic-kvkk-panel-kopyasi | Site metni bütün kopyaları anlatır | Panel: Web Push gövdesinden ad çıkar (P0). Site: aydınlatma metni ve imha politikasına iç panel cümlesi; panel DB bölgesi token; `LEGAL_UPDATED`; avukat okuması | - | - | P0, S12 |
| baglanti-ping-teslimi, baglanti-sina-ve-gunluk-kapsami | Site teslimi sınanabilir yapar, panel sınar | `POST /api/panel/ping-test`: pingler paralel, tek deneme, her biri ≤ 2,5 sn (toplam < 6 sn; panel 8 sn'de keser, panel:src/server/site-link.ts:12), küçük `maxDuration`, `redirect:"manual"`; başarı yalnız 202 + `{ok:true}` (panel:src/app/api/menu/ping/route.ts:36); durum `ok`/`http`/`timeout`/`redirect`/`network`. Gövde `{event, at, probe:true}`, imzalı; panel ping uçları `probe`'da yalnız test damgası yazar. Yazma uçları için sabit zararsız gövdeler (§4 P6) | - | Elle sınama | S5, P6 |
| baglanti-imza | İki kopya, aynı vektör kümesi (aynı SECRET ve T) | Site testine panelin 3 menü vektörü (S1); GET /api/panel/orders, POST /api/orders/ping, POST /api/panel/orders/stage, GET /api/panel/sales (S2); GET /api/panel/settings, POST /api/settings/ping (S3); POST /api/panel/ping-test (probe gövdesiyle, S5). Panel aynı değerleri ilgili P görevinde sabitler | - | - | S1-S5, P1-P6 |
| baglanti-sozlesme-belgeleri | Kod esas | İki harita: site `docs/PANEL-SENKRON.md` (S1), panel `docs/SENKRON.md` (P1). Panelde sitenin PANEL-SETTINGS.md'sinin karşılığı `docs/SITE-AYARLAR.md` (P3). §2.6'daki kaymalar S1 ve P1'de | - | - | S1, P1, P3 |
| baglanti-sitede-ac-yollari | Site | "Yeniden adlandırılmaz" listesine `/admin/siparisler/[id]`, `/admin/mobil/karaoke/[id]` | - | - | S11 |
| siparis-parasut-urun-kodu | Site listesi | İki depoda aynı kod listesi test vektörü | - | - | S11, P8 |
| marka-yasal-kimlik, marka-eposta-gorunumu, marka-catalog-md, marka-katalog-tohumu | Site | `brand.seed.json:59` `legalName`; CLAUDE.md:136-137 ve SITE-PALETTE-SYNC.md:14 "porselen"; CATALOG.md'ye "tarihçe" notu ve Alternatif Süt `nuts`; catalog.seed.json'a 2 `taxRatePct` | - | Sonraki derleme | M4 |
| marka-palet | App → site | Site testi: yan klon varsa SITE-PALETTE-SYNC tablosunun 7 eşlemesi globals.css'e karşı | - | - | S11 |

### 3.3 Değişmesin

| ID | Neden (tek cümle) |
|---|---|
| menu-boy-yapisi | L'yi yalnız site açar ve kapatır, kopukluk görünür; boy boy satış durumu uygulama sözleşmesini değiştirir (site:docs/PANEL-MENU.md:189-191). |
| menu-bag | Bağ panelin modelidir (site kalemi iki boylu, panelde boy başına satır); sitenin bilmesi gerekmez. |
| menu-ad, menu-aciklama, menu-kategori-sira | Site müşteriye kendi adı ve sırasıyla yazar, panel kasa adları ve maliyet gruplarıyla çalışır; bağ kimlikle durur. |
| menu-fotograf | URL içerikle damgalı, değişince anında ıskalar; tazelik menu-uygulama-tazelik ile kısalır. |
| menu-panel-qr | Müşteri menüsü tektir (site /menu ve /masa/<kod>); panel QR'ı kapalı kalır (Soru 12 kararı). |
| saat-kontrol-listesi-pencereleri | Personelin iş penceresi müşteri saatinden bilerek farklıdır. |
| saat-karaoke-rezervasyon | Ping, imzalı çekme ve beyaz liste doğru desen; tek ek `cancelledAt` (S9). |
| saat-karaoke-iptal-politikasi | Panelin 24 saati analiz eşiği, politika değil. |
| saat-karaoke-kapasite | Panel doluluğu kişiyle değil saatle ölçer. |
| siparis-asama | Durum makinesi tek yerde, istek koşullu; eski dokunuş 409 alır. |
| siparis-bar-kisisel | KVKK beyaz listesi iki tarafta kodda. |
| siparis-satis-toplam, siparis-kasa-satiri | Kâr-zarar için günlük çekme yeter; kasa satırı her seferinde tazedir. |
| siparis-push, siparis-yeni-uyari | İşlemsel bildirim listesi bilinçli dar, kanallar bilinçli bağımsız; jeton kalıbı farkı zararsız. |
| siparis-parasut-satis-faturasi, siparis-parasut-cari | Panel yalnız alış faturalarını ve tedarikçiyi okur. |
| urun-magaza-satista, -stok, -fiyat, -acik | Tek kaynak site, sunucu sipariş anında reddeder; yalnız app staleTime kısalır (M2). |
| urun-magaza-kdv-panel | Eski siparişe oran uydurulmaz. |
| urun-promosyon-kupon | Kalem hedeflemiyorlar. |
| urun-mutlu-saat | İndirimin kasada uygulanması bilinçli karar. |
| marka-mekan-hikaye-tohumu | Metin yüzeye özgü. |
| marka-logo | Nadiren değişir; değişince üç repoya birden işlenir. |
| marka-yapisal-veri-sitemap | Canlı ve önbellek etiketli; pasif kalem düşer. |
| marka-hukuk-tohumu, marka-api-mobile-sozlesme | Bayt bayt aynı ve hash kilitli; `LEGAL_UPDATED` değişince `legal:export` elle. |
| marka-kullanicilar | Güven alanları farklı; yalnız "personel ayrılınca üç hesabı kapat" kontrol satırı. |
| baglanti-anahtar | Tek anahtar bilinçli sadelik; döndürme için ikinci anahtar sonraya. |
| critic-supabase-ve-api-adresi, critic-eposta-altyapisi | Kod değişmez; iki not belgeye (M4). |
| critic-cuzdan-hediye | Özellik kapalı; açan PR'ın ön koşulu satış dökümüne `wallet` bloğu. |

### 3.4 Sonraya ya da plan dışına

- **siparis-kdv-online:** `/api/panel/sales`'e `invoiced {count, netMinor, kdvMinor}`.
- **siparis-parasut-iade (c):** sitenin günlük işi son 7 günün faturalarında Paraşüt iptalini işaretler.
- **critic-tahmin-online:** tahmin kartında "Online (son 4 hafta)" satırı.
- **critic-online-ambalaj, critic-kasa-damgasi:** senkron değil; eski Soru 8 ve 9 bu belgeden çıktı.
- **urun-kampanya-epostasi, critic-uygulama-tanitim-metinleri:** formda menüden seçme ve pasifken uyarı.
- **critic-uygulama-kimligi:** yan klon testinde bundleId; `minSupportedAppVersion` ipucu.
- **/api/panel/menu'ye 304:** bugün işareti yok; S4 ölçümünden sonra.
- **/menu'yu `pub:menu` Data Cache'inden okutmak:** veritabanı maliyetini sıfırlar ama "ticari yollar önbellekten
  okumaz" kuralına aykırı (site:tests/site-data-cache.test.ts:680-697); yapılmaz, istenirse sahip kararı.
- Karaoke yanıtına `version`; panelden siteye karaoke tutma; sipariş alımını panelden durdurma; ikinci anahtar.

---

## 4. Görevler

### 4.0 Ortak doğrulama düzeni

- **Yerel kurulum:** site `:3000`, panel `:3001`, her biri kendi yerel Postgres 16'sıyla; aynı deneme anahtarı
  (`KARAOKE_SYNC_SECRET`, 32+ karakter, gerçek değil); sitede `PANEL_URL=http://localhost:3001` (localhost'ta http
  kabul edilir, site:src/lib/panel/karaoke-sync-core.ts:62-82), panelde `LAFFOGATO_URL=http://localhost:3000`.
  Uygulamanın yanıtı `curl -i localhost:3000/api/mobile/v1/<uç>` ile görülür.
- **Kaçan ping:** paneli durdur, sitede değiştir, paneli başlat; ilgili ekranı aç ya da yerel `/api/cron/gunluk`'u
  çağır, düzeldiğini göster.
- **Geri uyum:** her site PR'ı, panelin `origin/main`'i (950dbdb) ve `claude/dalga-10-personel` ile denenir; her panel
  PR'ı S1 öncesi bir siteye karşı da denenir (bayrak yok → yeni alan gönderilmez).
- **laffogato:** `npm run typecheck`; `npm run lint -- --max-warnings=0`; `TEST_DATABASE_URL` ile tam `vitest run`,
  `LAFMOBIL_DIR` ilgili lafmobil worktree'sinde; `NODE_ENV=production npm run build`; ön yüz PR'ında
  `git diff --stat origin/main -- src/lib src/app/api db scripts src/proxy.ts 'src/app/**/actions.ts' 'src/app/**/route.ts'` boş.
- **lafmaliyet:** `npx next typegen && npx tsc --noEmit`, eslint, `npm test`; boş veritabanında `db:migrate` + `db:seed`;
  migration birleştirmede yeniden üretilir (R2); dokunulan ekranlar 1440 ve 390 px'te gözle; `site-*` dosyaları diğer
  oturumun alanı (`docs/planlar/DIGER-OTURUM.md`): değişiklik küçük, eklemeli, PR açıklamasında listeli;
  `src/lib/karaoke/signature.ts`'e dokunulmaz.
- **lafmobil:** `npm run typecheck`, `npm test`; uzun / orta tire yok; mağaza sürümü gerektiren PR başlıkta işaretli.
- **Canlıda (her birleştirmeden sonra):** "Bağlantıları sına" ve çalışma hataları; bir kalem sitede ve panelde pasif
  yapılır, sitede, panelde ve `/api/mobile/v1/menu`'de görülür, geri alınır.
- **Bütçe ölçümü:** P2, P3 ve P6 birleşmeden önce ve sonra 48'er saat iki projede CU-saat/gün ve 02:00-08:00 uyanması
  (site: Sistem durumu Neon satırı, site:docs/DATABASE.md "Yeniden ölçmek"; panel: Vercel › Storage › lafmaliyet-db ›
  Usage). Artış ayda 5 CU-saati geçerse sonraki P birleşmez, önce neden bulunur.

### 4.1 Faz 1: menü yazım güvenliği, kayıp sinyal, tazelik

Sıra: **S1 → S2 → M1 → P1 → P2 → M2**; P0 fazdan bağımsız. Faz 1 PR'ları başka fazdan madde taşımaz.

**S1 · Menü yazım güvenliği ve uygulama tazeliği**
- **Durum (28 Ekim 2026):** yapıldı, laffogato #269 (3dbd014): `expect` ve 409 `stale` (değişen alan yoksa 200 ve eski
  kalem), GET'te `writes: {expect: true}`, menü formunun yalnız dokunulan satış sütununu yüklendiği değere koşullu yazması
  ("Bu kalem bu arada değişti"), /menu `stale-while-revalidate=300`, panelin üç menü vektörü sitede,
  `docs/PANEL-SENKRON.md`. Sözleşme kopyası M1'de.
- **Repo / dal:** laffogato · `claude/senkron-s1-menu-yazim` (arka yüz PR'ı).
- **Ne:**
  1. `POST /api/panel/menu`: isteğe bağlı `expect {priceMinor?, priceMinorL?, isActive?}`; §3.1'deki sıra; değişen alan
     yoksa bugünkü 200; tutmayan `expect` 409 `{error:"stale", item}`; `expect`'li yazım koşullu UPDATE, satır
     etkilenmezse 409 `stale` (güncel kalemle).
  2. `GET /api/panel/menu` üst düzeyine isteğe bağlı `writes: {expect: true}`.
  3. Admin düzenleme formu: gizli `loadedPriceMinor`, `loadedPriceMinorL`, `loadedIsActive`. `updateMenuItem` satış
     sütunlarını yalnız dokunulduysa ve yüklenen değere koşullu yazar; etkilenen satır yoksa "Bu kalem bu arada
     değişti (panel ya da başka sekme). Sayfayı yenileyin." "Menüde göster" kutusu kalır. `markMenuPricesChanged`
     yalnız fiyat değişince (bugünkü kural).
  4. /menu `stale-while-revalidate=300`, route yorumu.
  5. Form metni: "Sitede hemen; uygulamada en geç yaklaşık 15 dakika (eski uygulama sürümlerinde 1 saat)."
- **Dosyalar:** src/lib/panel/menu-link-core.ts; src/app/api/panel/menu/route.ts; src/lib/admin/store.ts
  (`setMenuItemSaleFields`, `updateMenuItem` :7123-7140); src/app/admin/menu/actions.ts (:85-150 `readMenuForm`,
  :296-311); src/components/admin/menu-item-form.tsx (:173, :332-339, :415); src/app/api/mobile/v1/menu/route.ts
  (:12-26). Belgeler: docs/PANEL-MENU.md (:16-20 → `expect`/`stale`/`writes` bölümü; :62-64; :139; :149; :160-162;
  "menü kimlikleri yeniden kullanılmaz"), docs/API-MOBILE.md (:141, :191, :280-284), docs/PANEL-SENKRON.md (yeni,
  bu belgenin §3'ünün kısası).
- **Testler:** tests/panel-menu-link.test.ts: `expect` yokken bugünkü davranış; tutunca 200; tutmayınca 409 `stale` +
  `item`; **tutmuyor ama istenen değer sitedekiyle aynı → 200, eski `updatedAt`**; strict şema `expect`'i kabul eder;
  GET `writes` bayrağı. db-integration: form dokunulmamış alanı korur; eşzamanlı yazımda ret. Panelin 3 menü vektörü
  (panel:tests/site-menusu.test.ts:308-316) tests/panel-karaoke-sync-core.test.ts'e.
- **Migration:** yok.
- **Uçtan uca:** (1) Admin'de kalemi iki sekmede aç; B'de Tükendi, A'da yalnız açıklamayı kaydet → Tükendi kalır; A'da
  fiyatı değiştir → "bu arada değişti". (2) İmzalı `curl` ile tutmayan `expect` → 409; aynı değer → 200. (3)
  `curl -i /api/mobile/v1/menu` → `stale-while-revalidate=300`. (4) Panel 950dbdb ve dalga 10 dalı yeni siteye fiyat
  ve Tükendi yazar → 200; dalga 10'un "zaten tükendi" yolu 200 ve eski damga alır.
- **Bağımlı:** yok. Dalga 10'un Tükendi'sinden önce, en geç aynı gün yayında.

**S2 · Bar ekranı için ödeme bekleyen sayısı ve sipariş vektörleri**
- **Durum (28 Ekim 2026):** yapıldı, laffogato #270 (5e50c28). Plandan fazlası: sayı siparişin açılışından başka yeniden
  açılan ödeme sayfasından (`recordPendingCheckout`; "Şimdi öde", kaybolan isteğin tekrarı) da 30 dakika sayar ve bu
  yeniden açılış panele ping atar; sayı listeden önce okunur (iki okuma arasında ödenen sipariş listede çıkar), okunamazsa
  503 `unavailable`. P2 için sitenin notu: takip sayı sıfırdan büyükken her pingte yeniden başlasın (P2 öyle yaptı).
  API-MOBILE.md'ye dokunmadı, kopya gerekmedi.
- **Repo / dal:** laffogato · `claude/senkron-s2-odeme-bekleyen` (arka yüz).
- **Ne:** `GET /api/panel/orders` yanıtına isteğe bağlı `awaitingPayment`: son 30 dk'da oluşturulmuş, `pending_payment`
  durumdaki, bar ekranına düşecek türden kafe siparişlerinin sayısı (manual ve mağaza hariç). Kişisel veri yok,
  `version` değişmez. İmza vektörleri (aynı SECRET ve T): GET /api/panel/orders, POST /api/orders/ping,
  POST /api/panel/orders/stage, GET /api/panel/sales?month=.
- **Dosyalar:** src/lib/panel/orders-feed-core.ts; src/app/api/panel/orders/route.ts; src/lib/admin/store.ts (sayım
  okuyucusu, `src/lib/db` üzerinden); docs/PANEL-ORDERS.md; tests/panel-orders-feed.test.ts;
  tests/panel-karaoke-sync-core.test.ts.
- **Testler:** alan sayıdır, başka anahtar yok; manual, mağaza ve 30 dk'dan eski sayılmaz; dört vektör.
- **Migration:** yok.
- **Uçtan uca:** mock kartlı kafe siparişi başlat → GET'te `awaitingPayment: 1`; öde → 0 ve sipariş listede. Panel
  950dbdb yanıtı hatasız okur (panel:src/lib/site-orders/schema.ts:129 katı değil).
- **Bağımlı:** yok.

**M1 · API-MOBILE kopyası (S1)**
- **Durum (28 Ekim 2026):** yapıldı, lafmobil #35 (263794d): kopya sitenin 3dbd014'üyle bayt bayt aynı, `RECONCILED` ve
  "Re-synced" satırı; yalnız metin (alan, hata kodu, durum kodu değişmedi), mağaza sürümü gerekmedi.
- **Repo / dal:** lafmobil · `claude/senkron-m1-sozlesme-s1`.
- **Ne:** S1 birleştikten sonra sitenin `main`'indeki docs/API-MOBILE.md kopyalanır; src/data/contract-sync.test.ts
  `RECONCILED` + "Re-synced" satırı.
- **Testler:** `npm test` (contract-sync); sitede `LAFMOBIL_DIR` bu dalla api-contract-parity yeşil.
- **Migration:** yok. **Mağaza sürümü:** gerekmez.
- **Uçtan uca:** iki kopyanın SHA-256'sı eşit.
- **Bağımlı:** S1 birleşmiş.

**P1 · Panel menü yazımı: `expect`, 409, `seenPrice`, harita**
- **Durum (27 Ekim 2026):** 26 Ekim denetiminin B12 partisiyle yapıldı (dal `claude/denetim-b12-senkron-fiyat`, E-11;
  #52, #53).
  S1'i beklemedi: `expect` yalnız site `writes.expect` duyurunca gider, o zamana kadar yazım bugünkü gibi. Uçtan uca
  (1)-(3) sitenin sahte ucuyla `tests/tukendi-db.test.ts`'te; gerçek siteyle S1 yayına çıkınca yinelenir. Harita
  `docs/SENKRON.md`. `seenPrice` fiyat hücresine ve zam önerisine de (writeSalePrice'ın `expectFrom`'u), yerel yazım
  koşullu; reçete kartı yalnız dokunulan satış alanını yazar ve çakışmada fiyat alanının altında seçim sunar.
- **Repo / dal:** lafmaliyet · `claude/senkron-p1-menu-expect` (dalga 10 birleştikten sonra `main`'den).
- **Ne:**
  1. `pushSaleChange` (panel:src/server/site-menu/push.ts:54): `expect`'i planın yazacağı alanlar için panelin site
     kopyasındaki kalemden (`siteItem`) kurar; yalnız son çekmede `writes.expect` görüldüyse gönderir
     (src/lib/site-menu/schema.ts'e isteğe bağlı `writes`, durum kopyasına yazılır); 400 `field:"expect"` (bugünkü
     sitenin katı şemasında `field:"body"`) → `expect`'siz bir kez yeniden dener. Dört çağıran (products.ts:50, :206; prices/write.ts:34; dalga 10 `setSoldOut`) buradan
     geçer, ayrı yama yok.
  2. src/lib/site-menu/push.ts: 409'da `error`'a göre dal (`stale` → hemen `syncSiteMenu("manual")` + "Bu kalem bu
     arada sitede değişti; güncel değer yüklendi."; `single_size` bugünkü metin); JSON `not_found` 404 ≠ uç yok.
  3. Zaman aşımı (push.ts:118): "Siteye ulaşılamadı; değişiklik sitede yapılmış olabilir. Site menüsünde kontrol edin."
     + `after()` ile hemen çekme.
  4. `seenPrice`: recipe-editor.tsx gönderir; products.ts `saveRecipe` (:202-206) ve `updateProductPrice` (:50):
     dokunulmamış fiyat veritabanındaki değerde kalır, dokunulan fiyat veritabanında da değiştiyse UserError "Fiyat bu
     arada sitede değişti. Sayfayı yenileyin." Dalga 10'un `seenActive` / `seenShowOnMenu`'sunun yanına, aynı şemada.
  5. Belgeler: docs/SITE-MENU.md (:105, :126-131, `expect`/`stale`, "menü kimlikleri yeniden kullanılmaz"),
     docs/SENKRON.md (yeni, PANEL-SENKRON.md ile aynı içerik).
- **Testler:** tests/site-menusu.test.ts (`expect` kurma; bayraksız sitede gönderilmez; 400 `expect` → yeniden deneme;
  409 `stale` dalı; `seenPrice`); tests/tukendi-db.test.ts sahte `callSite`'a 409 `stale`.
- **Migration:** yok.
- **Uçtan uca:** (1) Kart açıkken sitede fiyat 150 ve Tükendi; kartta yalnız reçete kaydı → site 150 ve Tükendi kalır.
  (2) Ping kapalıyken (kopya bayat) fiyat yaz → 409 `stale`, mesaj, kopya güncellenir. (3) S1 öncesi siteye karşı
  yazım 200 (bayrak yok). (4) Personel Tükendi zaten kapalı kalemde → 200, "zaten tükendi".
- **Bağımlı:** S1 canlıda; dalga 10 birleşmiş (push.ts ve products.ts aynı satırlar).

**P2 · Bar ekranı: ödeme takibi ve "ping kaçtı"**
- **Durum (28 Ekim 2026):** yapıldı, lafmaliyet #60; kurallar saf `src/lib/site-orders/follow.ts`'te,
  ayrıntı `docs/SITE-SIPARIS.md` › Ödeme takibi. Plandan farklar:
  1. Takip yalnız 0 → > 0'da değil, sayı artınca ve sayı sıfırdan büyükken gelen her pingte de yeniden başlar (S2'nin
     notu: yeniden açılan ödeme sayfası ping atar ama sayıyı artırmaz); ekranın kendi çekmesi uzatmaz. Takibin
     başlaması, yeniden başlaması ve bitmesi sürümü artırır (yoksa açık sekme yeni bitişi görmez); pingin kendisi
     artırmaz.
  2. "Ping kaçtı" kuralı yazıldığı gibi ("`paidAt`'i bir önceki başarılı çekmeden eski") kaçan ödeme pingini neredeyse
     hiç yakalamaz: önceki başarılı çekme çoğunlukla ödemeden önceki "ödeme bekleniyor" pinginin çekmesidir. Uygulanan: pingle
     olmayan çekmenin ilk kez gördüğü yeni sipariş en az bir dakika önce ödenmiş ve ödemeden sonra hiç ping gelmemiş.
     Ping gelip çekmesi düştüyse kaçan ping değil, çekme hatasıdır.
  3. "Saatlik karar": `maxAgeMs` ≥ 10 dk olan kontrol yalnız ekranın ve elle yapılan çekmeleri sayar (`lastCheckAt`);
     sık kontroller (1 ve 3 dk) pingin çekmesini sayar.
  4. Sitenin #270'te sabitlediği dört vektör (sipariş okuması, sipariş pingi, aşama, ayın satışı) panelde de:
     `tests/site-siparis.test.ts`, `tests/site-satis.test.ts`. Uçtan uca akış sitenin sahte ucuyla
     `tests/siparis-takip-db.test.ts`'te; gerçek siteyle canlıda yinelenir.
  5. `busy` (Ne 4): bugünkü kuralın "son iki saatte ping" yarısı kalktı, "son iki saatte liste değişti" kaldı. Takibin
     sürüm artışı son pingi ekrana taşıdığından o yarı vazgeçilen her kartlı ödemede görünür ekranı iki saat üç
     dakikalık çekmede tutardı (§3.1 bütçe kuralı 4: pingte iki saatlik yoğun mod yok). Listeyi değiştiren ping
     `changeAt`'i yazar; değiştirmeyen ping takibi başlatır ve o en çok 30 dakika sürer.
  6. Sınır (§3.1 gecikme hedefi buna göre daraltıldı): bildirimi açık, ekranı boş cihaz (Yardım'ın önerdiği bar
     tableti) takibi kabuğun bir sonraki kontrolünde (30 dakikada bir) öğrenir, takibin başlaması bildirim göndermez.
     Takip o ana kadar bitmişse sipariş saatlik kontrolle gelir (en geç ≈ 1 saat, P2 öncesi gibi); arka plandaki sekme
     siteyi çekmez. Kapatmak için aday: takip başlayınca `orders` konusunda içeriksiz bir "yenile" bildirimi, service
     worker yalnız görünür panel sekmesi varsa canlı veriyi yeniletir. Görünmeyen sekmede tarayıcı bildirim göstermek
     zorunda olduğu için sahibin kararını ister; kısa aralıklı canlı sorgu panelin Neon bütçesini bozar, yapılmadı.
     Açık iş KALAN-ISLER'de.
- **Repo / dal:** lafmaliyet · `claude/senkron-p2-bar-odeme`.
- **Ne:**
  1. src/lib/site-orders/schema.ts: isteğe bağlı `awaitingPayment` (yoksa 0).
  2. src/server/site-orders/sync.ts: `awaitingPayment` ve `awaitingSince` durumda; 0 ↔ > 0 geçişinde
     `bumpOrdersVersion` (ETag değişir, panel:src/app/api/canli/route.ts:43). Pingte sürüm artmaz.
  3. src/lib/live.ts, src/app/api/canli/route.ts: `awaitingUntil` (`awaitingSince` + 30 dk).
  4. src/app/panel/karaoke/orders-board.tsx: `busy` bugünkü kural ya da `awaitingUntil > now` (:100).
  5. `ensureOrdersFresh` (sync.ts:238-245): saatlik kararda pingle yapılan çekme sayılmaz.
  6. "Ping kaçtı": ping dışı çekme, `paidAt`'i bir önceki başarılı çekmeden eski yeni sipariş bulursa
     `site_orders_sync.missedPingAt`; Ayarlar › laffogato.net'te görünür.
  7. docs/SITE-SIPARIS.md.
- **Testler:** tests/site-siparis.test.ts (alan yokken 0; geçişte sürüm artar; 30 dk sonra `busy` düşer; ping çekmesi
  saatlik kararı sıfırlamaz; `missedPingAt`); tests/canli-yoklama.test.ts.
- **Migration:** yok (`integration_state`).
- **Uçtan uca:** ödeme anında paneli 2 sn durdur (ödeme pingi düşer) → bildirimi kapalı (ya da ekranında açık sipariş
  olan) görünür bar ekranı ≤ 6 dk içinde siparişi gösterir, Ayarlar "ping kaçtı" der. Bildirimi açık, boş ekranda en geç
  ≈ 1 saat (Durum 6). Ödeme beklenmeyen sakin saatte yoklama 60 dk kalır; vazgeçilen kartlı ödemeden sonra ekran en çok
  30 dk yoğun kalır.
- **Bütçe:** kartlı sipariş başına ≤ 30 dk, çoğunlukla site veritabanı zaten uyanıkken.
- **Bağımlı:** S2 canlıda (alan yoksa davranış bugünkü).

**M2 · Uygulama menü ve mağaza tazeliği**
- **Repo / dal:** lafmobil · `claude/senkron-m2-tazelik`. **Mağaza sürümü gerekir** (başlıkta işaretli); Apple ve Google
  hesapları açılmadığı için (app:docs/STORE-RELEASE.md:34-35) ilk gönderime biner. Eski sürümler bozulmaz.
- **Ne:** src/data/queries.ts:253-258 (menü) ve :339-345 (customization) staleTime `HOUR` → 5 dk; :367-373 mağaza
  30 → 10 dk. Satır reddinde (`LINE_REFUSAL_CODES`: menü kodları → `queryKeys.menu`, `line_not_found` /
  `out_of_stock` → `queryKeys.shop`) geçersiz kılma: src/components/checkout/use-checkout-order.ts:1150-1159,
  src/app/sepet.tsx.
- **Testler:** `npm run typecheck`; sorgu ayarı testi; ret → geçersiz kılma testi.
- **Migration:** yok.
- **Uçtan uca:** yerel siteye bağlı geliştirme derlemesi: kalemi pasif yap → uygulamaya dönünce ≤ 15 dk içinde
  kalkar; sepette ret → hemen kalkar.
- **Bütçe:** sessiz saatlerde günde 1-3 ek kaynak çağrısı, ayda ≤ ~2 CU-saat.
- **Bağımlı:** yok.

**P0 · Karaoke Web Push gövdesinden ad (fazdan bağımsız, KVKK)**
- **Durum (28 Ekim 2026):** yapıldı (lafmaliyet, dal `claude/senkron-p0-push-ad`). Bildirimin metni artık saf
  `pushMessages`'ta (src/lib/karaoke/session.ts, `eventMessage`'ın yanında): `name: null` ile kurar, üçten fazla olayın
  özeti de orada; `announce` (src/server/karaoke/sync.ts) yalnız gönderir. Aynı kilit ekranına düşen ikinci yol da
  kapandı (incelemeden, plandan fazla): sekme arkadayken sayacın kendi sistem bildirimleri (alert-center.tsx › `fire`:
  "Karaoke başladı", "Karaokede 10 dakika kaldı", "Karaokede süre doldu") artık adsız. Ekrandaki zil satırı, sayacın
  ekran içi uyarısı ve liste adı göstermeye devam eder. Belge docs/KARAOKE.md (istek metninin Güvenlik maddesi ve
  Güvenlik › "Bildirimde misafirin adı yok"). Testler: tests/karaoke.test.ts (push metninde ad ve not yok, özet dahil;
  zil metninde ad var; `announce` yalnız `pushMessages`'tan geçer; alert-center.tsx'teki her `notify(` çağrısı adsız,
  toast'ta ad var) ve plandan fazla tests/karaoke-bildirim-db.test.ts
  (gerçek Postgres, sitenin sahte ucu: pingle gelen yeni, iptal edilen, saati değişen ve dört birden rezervasyonun
  yakalanan bildiriminde ad yok; kopyada ve canlı veride var; eski kodla üç test de kırmızı). Uçtan uca yerelde: sahte
  siteye bağlı `next dev`, imzalı pingle yeni rezervasyon → bar ekranında (personel 390 px, yönetici 1440 ve 390 px)
  liste ve zil satırı adı gösterir. Bildirimin cihaza düştüğü hâl yerelde görülemez (gerçek push servisi gerekir):
  canlıda bir rezervasyonla kilit ekranında bakılır.
- **Repo / dal:** lafmaliyet · `claude/senkron-p0-push-ad`.
- **Ne:** src/server/karaoke/sync.ts:261 push gövdesine `name: null` geçer; ekrandaki zil satırı adı göstermeye devam
  eder (panel:src/components/panel/live/alert-center.tsx:246). docs/KARAOKE.md (Güvenlik maddesi, :22-24).
- **Testler:** tests/karaoke.test.ts: push gövdesinde ad yok, zil metninde var.
- **Migration:** yok. **Uçtan uca:** yerel rezervasyon → bildirimde ad yok, bar ekranında var.
- **Bağımlı:** yok.

### 4.2 Faz 2: yararlı senkron

Sıra: S3 → S4 → S5 → S6 → F1 → S7 → F2 → S8 → M3; panelde (dalga 10'dan sonra) P3 → P4 → P5 → P6.

**S3 · Panel ayar ucu, pingi ve menü kaleminde oran**
- **Repo / dal:** laffogato · `claude/senkron-s3-ayar-ucu`.
- **Ne:** imzalı `GET /api/panel/settings` (version 1), alan alan `toPanelSettings`: `weeklyHours`,
  `manualOverride {value, updatedAt}`, `karaoke {firstHour, closeHour, maxHours, bookingWindowDays, capacity,
  hourlyMinor, freeCancelHours, lateRefundPercent, taxRatePct}`, `taxRates`, `ordering {cafe, table, pickup,
  delivery}`, `updatedAt`. Ping `settings.changed` → `POST {PANEL_URL}/api/settings/ping`, action'lardan açıkça:
  ayarlar/actions.ts :192 `saveHoursAction`, :245 `saveTaxAction`; ayarlar/karaoke-actions.ts :134;
  mobil/ayarlar/actions.ts :196, :278; mobil/canli-durum/actions.ts :97, :173 (yalnız `manualOverride` değişince).
  GET /api/panel/menu kaleminde isteğe bağlı çözülmüş `taxRatePct` (`MENU_PANEL_FIELDS`, store.ts:6978).
- **Dosyalar:** src/lib/panel/settings-feed-core.ts (yeni), src/app/api/panel/settings/route.ts (yeni; 503
  `not_configured`/`unavailable`), src/lib/panel/settings-ping.ts (yeni, `createPanelPing`), yukarıdaki action'lar,
  src/lib/panel/menu-link-core.ts; docs/PANEL-SETTINGS.md (yeni), PANEL-MENU.md, PANEL-SENKRON.md.
- **Testler:** anahtar kümesi eşitliği (e-posta alanı yok); vektörler GET settings ve POST /api/settings/ping; fiyat
  değişikliğinin `settings` yazımı ping atmaz.
- **Migration:** yok.
- **Uçtan uca:** imzalı GET doğru alanları verir; P3 sonrası saat değişikliği panel kopyasına ≤ 10 sn'de gelir. P3
  yayına çıkana kadar ping 404 alır ve site 5 dk'da bir uyarı yazar (bilinen; panel:src/proxy.ts:43 /api'yi kapsamaz).
- **Bağımlı:** yok.

**S4 · Panel okuma uçlarına 304**
- **Repo / dal:** laffogato · `claude/senkron-s4-panel-304`.
- **Ne:** GET /api/panel/orders, /karaoke, /settings isteğe bağlı `If-None-Match` kabul eder. ETag = işaret
  (`readChangeMarker` orders / karaoke / venue; venue `pub:site`'ı da kapsar; site:src/lib/admin/change-marker.ts:61-93)
  + sorgu penceresi + saat dilimi (orders'ın 24 saat kuralı için saatte bir tam yanıt). Değişiklik yoksa veritabanına
  gitmeden 304; işaret `null` ise normal okuma.
- **Dosyalar:** üç route; PANEL-ORDERS.md, PANEL-KARAOKE.md, PANEL-SETTINGS.md.
- **Testler:** 304 yolu veritabanı okumaz; işaret `null` → 200; tests/site-data-cache.test.ts kuralı bozulmaz
  (`change-marker.ts` izinli liste, :674-675).
- **Migration:** yok.
- **Uçtan uca:** aynı ETag'le iki imzalı GET → ikincisi 304; sitede sipariş aşaması değiş → 200.
- **Bağımlı:** S3.

**S5 · Ping teslim sınaması**
- **Repo / dal:** laffogato · `claude/senkron-s5-ping-test`.
- **Ne:** imzalı `POST /api/panel/ping-test` → `{version:1, results:[{link, status, host, ms}]}`. Pingler paralel, tek
  deneme, her biri ≤ 2,5 sn, `redirect:"manual"`; başarı yalnız 202 + `{ok:true}`; durum `ok` / `http` / `timeout` /
  `redirect` / `network`. Gövde `{event, at, probe:true}`, imzalı. Küçük `maxDuration`. src/lib/panel/ping.ts'e
  ayrıntılı sonuç döndüren gönderim; bugünkü `send(): boolean` korunur.
- **Testler:** imza ve probe gövdesi vektörü; yanıtta kişisel veri ve sır yok; panel kapalı → `network`; 200 HTML →
  `http`; yönlendirme → `redirect`; toplam < 6 sn.
- **Migration:** yok.
- **Uçtan uca:** geçerli ama yanlış host → panelin sınaması "site → panel: ping ulaşmadı" (P6).
- **Bağımlı:** yok.

**S6 · Genel sayfalar için canlı durum girdisi (arka yüz)**
- **Repo / dal:** laffogato · `claude/senkron-s6-durum-girdisi`.
- **Ne:** src/lib/seo/site-data.ts'e önbellekli `getSiteVenueOverride()` (`manualOverride` + `updatedAt`), ayrı etiket;
  canli-durum/actions.ts (:97, :173) yalnız `manualOverride` değişince etiketi düşürür; tags.ts `venue_status`
  eşlemesine eklenmez. `loadAppProps`'a isteğe bağlı `venueOverride` (girdi, sonuç değil).
- **Testler:** tests/public-pages-cached-reads.test.ts; boş masa dokunuşu etiketi düşürmez; alan yokken
  `loadAppProps` geçerli.
- **Migration:** yok.
- **Uçtan uca:** canlı durumda "Kapalı" → sonraki sayfa yüklemesinin verisinde `venueOverride: "closed"`.
- **Bağımlı:** yok.

**F1 · Ön yüz: açık / kapalı durumu override'ı izler**
- **Repo / dal:** laffogato · `claude/senkron-f1-durum` (ön yüz PR'ı).
- **Ne:** use-open-status.ts / open-status.ts `manualOverride` girdisini alır; home-hero-slider.tsx:352, :365,
  visit-page.tsx:548, home-page.tsx:764; "open" iken "Kapanış 02:00" bastırılır (use-open-status.ts:32-37). İstemci
  yoklaması yok.
- **Testler:** tests/open-status.test.ts (closed / open / auto; alan yok → bugünkü). Arka yüz `git diff --stat` boş.
- **Migration:** yok. **Uçtan uca:** "Kapalı" → sonraki yüklemede hero "Şu an kapalı"; 1440 ve 390 px gözle.
- **Bağımlı:** S6.

**S7 · Tarihli kapanış**
- **Repo / dal:** laffogato · `claude/senkron-s7-kapanis` (arka yüz).
- **Ne:** `settings."hoursExceptions"` jsonb `[{date, closed, open?, close?, label, karaokeOpen?}]`; Ayarlar → Saatler
  listesi. Kaydetmeden önce o güne düşen ödenmiş karaoke (`bookingWindowDays` içinde) ve planlı ödenmiş kafe
  siparişleri (en çok 7 gün, site:src/lib/mobile/order-pricing.ts:320) sayı ve bağlantıyla (/admin/mobil/karaoke,
  /admin/siparisler) listelenir, onay istenir; kendiliğinden iptal yok; iade var olan akışlardan. Aynı uyarı haftalık
  kapalı gün eklenince. venue.ts `isOpenByHours` / `isCafeOpenNow` / `isCafeOpenForOrder` istisnayı uygular.
  Karaoke: availability o gün `available:false` + isteğe bağlı `closed`, `closedLabel`; `createReservation` 409
  `slot_taken` + "O gün köşk kapalı (Yılbaşı). Başka bir gün seç." (uygulama bu kodda müsaitliği yeniden çekip saat
  adımına döner, app:src/app/karaoke.tsx:579-584); `karaokeOpen` işaretli günde oda açık. /bootstrap isteğe bağlı
  `venue.closures[]` (60 gün); ayar ucunda `closures`; `loadAppProps`'a kapanışlar (S6'nın etiketi). faq.ts ve
  pages.ts:95 ayardan. `LEGAL_ENTITY.cafeHours` testi ve Saatler'de fark uyarısı.
- **Belgeler:** API-MOBILE.md §3 (`cafe_closed` kapanış gününü de kapsar; planlı en çok 7 gün), §6 (`isOpen`), §7
  (`slot_taken`, `closed`), §10 (`closures`); PANEL-SETTINGS.md.
- **Testler:** venue birim (istisna, D-1 kuyruğu, override önceliği); karaoke kapalı gün 409 `slot_taken` mesajıyla;
  availability `closed`; bootstrap `closures` yokken de geçerli; uyarı listesi o güne düşen rezervasyon ve siparişi
  sayar; public-pages-cached-reads; db-integration'da migration.
- **Migration:** evet (`npm run db:bundle`).
- **Uçtan uca:** yarına ödenmiş karaoke varken yarına kapanış ekle → uyarı listesi. Yarının saatinde live-status
  `isOpen:false`; planlı sipariş 409 `cafe_closed`; karaoke 409 `slot_taken` ve mesaj; bootstrap ve ayar ucunda
  `closures`.
- **Bağımlı:** S3, S6.

**F2 · Ön yüz: saat metinleri, kapanış, iletişim yedekleri**
- **Repo / dal:** laffogato · `claude/senkron-f2-saat-metni` (ön yüz).
- **Ne:** chrome.tsx:507-508, home-page.tsx:695, data.ts:1178, :1190 saat metni `hoursLabel`'dan; "bugün kapalı"
  S7'nin girdisinden; shop-page.tsx:190-191 ve product-detail.tsx:167 yedekleri `SITE`'tan.
- **Testler:** open-status (kapanış girdisi); arka yüz `git diff --stat` boş. **Migration:** yok.
- **Uçtan uca:** bugüne kapanış → hero ve /ziyaret "Bugün kapalı"; 1440 ve 390 px gözle.
- **Bağımlı:** S7.

**S8 · Seçenek fiyatı, kilometre taşı, davet eşiği**
- **Repo / dal:** laffogato · `claude/senkron-s8-secenek-fiyati`.
- **Ne:** `resolveOptionPricing` (customization.ts:193) ek ücreti mnu-0081 / 0080 / 0082'nin `priceMinor`'ından alır,
  `isActive`'e bakmadan; sabite yalnız kalem yoksa, iki boyluysa ya da fiyat geçersizse; laktozsuz 0. `MILESTONE_GIFTS`
  `menuItemId` tutar (milestones-core.ts:23-28), ad yedek; yol haritası başlığı kalemin güncel adından. Bootstrap'a
  isteğe bağlı davet eşiği. **PR'dan önce** canlı mnu-0081 / 0080 / 0082 fiyatları sabitlerle karşılaştırılır; fark
  varsa PR açıklamasında sahibe yazılır (uygulamadaki tahsilat değişir).
- **Belgeler:** API-MOBILE.md (customization :102, :541; §10 davet eşiği), PANEL-MENU.md.
- **Testler:** tests/mobile-customization.test.ts (kalem var / yok / Tükendi → aynı ücret; iki boylu → sabit);
  tests/mobile-milestones.test.ts (ad değişince de bulunur); bootstrap davet eşiği yokken de geçerli.
- **Migration:** yok.
- **Uçtan uca:** Ekstra Shot 60₺ → /menu `extraShotMinor` 6000, önizleme 60₺; kalem Tükendi → yine 6000.
- **Bağımlı:** yok.

**M3 · Uygulama: kapanış, eşikler ve sözleşme kopyaları**
- **Repo / dal:** lafmobil · `claude/senkron-m3-kapanis` (**mağaza sürümü gerekir**) + her site PR'ı için kopya PR'ı
  (`claude/senkron-m3-sozlesme-s7`, `-s8`; sürüm gerekmez), birleşme sırasıyla.
- **Ne:** src/data/http.ts bootstrap'tan `venue.closures` (isteğe bağlı); seed.ts `venueFromBootstrap` "Kapalı";
  ziyaret.tsx "Bugün kapalı"; odeme.tsx ve use-checkout-order.ts:651-706 o günün saatlerini gizler; karaoke
  availability `closed` → "O gün kapalı". app-config.ts `stampMinOrderMinor` / `stampStepMinor` ve davet eşiği;
  stamp-rules.ts sabitleri yedek.
- **Testler:** typecheck; http ayrıştırma (alan var / yok); contract-sync.
- **Migration:** yok.
- **Uçtan uca:** yarına kapanış → Ziyaret yarını "Kapalı"; planlı sipariş saatlerinde o gün yok.
- **Bağımlı:** S7, S8.

**P3 · Panel ayar kopyası ve tüketicileri**
- **Repo / dal:** lafmaliyet · `claude/senkron-p3-ayar-kopyasi` (dalga 10 birleştikten sonra).
- **Ne:**
  - src/lib/site-settings/schema.ts (düz `z.object`), src/server/site-settings/sync.ts, src/app/api/settings/ping/route.ts
    (`checkSitePing`; `probe`'da yalnız test damgası), günlük iş adımı (paralel, `tailStepDeadline`), Ayarlar ›
    laffogato.net'te beşinci satır. Çekme: ping + günlük iş + Ayarlar (yönetici) açılışı yalnız kopya 24 sa'ten
    eskiyse ya da hatalıysa, `after()` içinde. Site çekmelerinde (orders, karaoke, settings) `If-None-Match`; 304'te
    yalnız `lastOkAt`.
  - Kullanımlar: `closedDaysBetween`'e site kapanışları ve haftalık kapalı gün ikinci, salt okunur kaynak (Bugün
    `kasa-dun`, tahmin, eksik kasa listesi; `closedDayRefusal`'a girmez; `special_days`'e yazılmaz); ileri tarihli
    "Kafe kapalı" satırında (yönetici) "Sitede de kapat" bağlantısı; Bugün "Sitede kafe elle kapalı / açık"; Doluluk
    paydası (occupancy.ts `readKaraokeHours`); Oranlar ve Ürünler'de oran uyarısı; kargo payı `shipping` oranıyla;
    açık gün ipucu; bar ekranında "Uygulamadan sipariş kapalı"; Doluluk'ta saat ücreti ve ücretsiz iptal (yönetici);
    site kapalıyken bar ekranının sessiz saatlik çekmesi durur, açılıştan 30 dk önce başlar.
  - docs/SITE-AYARLAR.md (yeni), SENKRON.md.
- **Testler:** şema (alan yokken); payda (open = max(5, firstHour)); `closedDaysBetween` iki kaynak,
  `closedDayRefusal` etkilenmez; Bugün satırı; ping vektörü; 304; sessiz çekme kuralı; günlük işte 55 sn.
- **Migration:** yok.
- **Uçtan uca:** (1) sitede yarına kapanış → tahmin "Kafe kapalı (site)", ertesi sabah `kasa-dun` yok. (2) karaoke
  ilk saati 14 → Doluluk fark satırı. (3) panel kapalıyken saat değiştir; açılışta günlük iş ya da Ayarlar düzeltir.
  (4) değişiklik yokken çekme 304 alır, sitenin veritabanı okunmaz.
- **Bağımlı:** dalga 10; S3, S4 canlıda (S7 alanları isteğe bağlı).

**P4 · Menü yan uyarıları**
- **Repo / dal:** lafmaliyet · `claude/senkron-p4-menu-uyari` (dalga 10 sonrası).
- **Ne:** (a) ~~Hızlı sayım: eldeki 0 olan takipteki hammaddeyi kullanan bağlı ve Satışta kalemler sonuç ekranında ve
  Bugün'de~~ **düştü:** hızlı sayım 26 Ekim 2026'da kaldırıldı (B21, `docs/MAL-SIPARISI.md`); bu parça yapılmaz,
  aylık Stok sayımı'na da taşınmaz (sahibin kararı: başka parti bu özelliği genişletmez). (b) Bağsız kalem:
  `applySiteList` önceki kopyayla karşılaştırır; yalnız yöneticiye /panel/urunler/site satırı ve zil "Sitede fiyatı
  değişti, panele bağlı değil: X · Bağla". (c) Silinen kalem: aynı yazımda `showOnMenu=false`. (d) Alerjen
  hatırlatması: `saveRecipe`, öneri onayı, ürün açma. LafPOS'a geçiş gününden itibaren (b)'nin "kasada da değiştir"
  kısmı yalnız LafPOS'ta yerel ürün içindir: siteye bağlanan kalemin fiyatını LafPOS siteden alır, Kasaya işle'de
  görünmez; siteden gelen ama panelde bağsız ürünün fiyatını LafPOS değiştirtmez, metinler bağlamayı söyler (denetim
  B11, E-39).
- **Dosyalar:** src/lib/site-menu/plan.ts,
  src/server/site-menu/sync.ts, src/app/panel/urunler/site/*, dalga 10'un bell/ops.ts ve rows-ops.ts,
  src/server/actions/products.ts, recipe-requests.ts, src/server/data/product-create.ts.
- **Testler:** tests/site-menusu.test.ts (bağsız fark, ilk çekmede yok, silinen kalem); alerjen hatırlatması.
- **Migration:** yok.
- **Uçtan uca:** bağsız kalemin fiyatı sitede değişir → yönetici zili.
- **Bağımlı:** dalga 10, P1.

**P5 · Karaoke: KVKK boşaltma ve ters çakışma**
- **Repo / dal:** lafmaliyet · `claude/senkron-p5-karaoke`.
- **Ne:** (a) haftalık (pazartesi) geniş pencere boşaltması (§3.2). (b) `activity_log`'a ad yerine oturum kimliği
  (src/server/actions/karaoke.ts:146, :201). (c) ters çakışma: sarı satır ve zil "Oda şu an HH:MM'e kadar dolu" (ad
  yok) (src/server/karaoke/sync.ts).
- **Testler:** tests/karaoke.test.ts (boşaltma yalnız siler, yalnız pazartesi, süre sınırı; ters çakışma; günlükte ad
  yok).
- **Migration:** yok.
- **Uçtan uca:** sitede geçmiş rezervasyonun adı boşalır → pazartesi adımı (elle tetik) panelde boşaltır;
  rezervasyonsuz sayaç + kesişen site rezervasyonu → sarı satır.
- **Bağımlı:** yok.

**P6 · Bağlantıları sına: yazma uçları ve ping teslimi**
- **Repo / dal:** lafmaliyet · `claude/senkron-p6-baglanti-sina`.
- **Ne:** src/server/actions/site-links.ts, src/app/panel/ayarlar/site-links-test.tsx. Sabit gövdeler: menü
  `{id:"senkron-sinama", isActive:false, actor:"Bağlantı sınaması"}`; aşama `{id:"senkron-sinama", action:"preparing",
  from:"new", actor:"Bağlantı sınaması"}`. Sınıflama: JSON 404 ya da 400 → uç var, imza geçti (imza parse'tan önce:
  site:src/app/api/panel/menu/route.ts:122 → :131, site:src/app/api/panel/orders/stage/route.ts:78 → :85); 401 →
  anahtar; JSON'suz 404 → uç yok. Satış satırı bu ay + geçen ay. ping-test satırı (S5) ve karaoke / menü / sipariş ping
  uçlarında `probe` kuralı.
- **Testler:** sınıflama tablosu; probe çekme yaptırmaz; ping-test vektörü.
- **Migration:** yok.
- **Uçtan uca:** yanlış ama geçerli host → "site → panel: ping ulaşmadı"; farklı anahtar → 401 satırı.
- **Bağımlı:** S5 canlıda (ping-test satırı); yazma denemeleri bugünkü sitede de çalışır.

### 4.3 Faz 3: satış ekleri, maliyet, temizlik

**S9 · Satış ve menü okuma ekleri** · laffogato · `claude/senkron-s9-satis-ekleri` · **migration: evet**
(`karaoke_reservations."cancelledAt"` text, varsayılan '').
- Ne: `cancelledAt` bütün iptal yollarında ve `toPanelReservation`'da; `/api/panel/sales`'e blok başına `cardMinor`,
  `shop.lines` (§3.2) ve `refundTouchedMonths`; GET /api/panel/menu üst düzey `pricesEffectiveDate`,
  `pricesChangedAt`. `version` değişmez. Belgeler: PANEL-SALES.md, PANEL-KARAOKE.md, PANEL-MENU.md.
- Testler: alanlar isteğe bağlı; `shop.lines` anahtar kümesi eşitliği; `cardMinor` yalnız `paynkolay`, iadeler
  düşülmüş; `cancelledAt` her iptal yolunda.
- Uçtan uca: panel 950dbdb yeni yanıtları hatasız okur (Bağlantıları sına 4/4). Bağımlı: yok.

**P7 · Mağaza maliyeti ve POS kesintisi** · lafmaliyet · `claude/senkron-p7-magaza-maliyet` · migration: yalnız
Soru 7 bir mal listelerse (`site_shop_id`, R2).
- Ne: src/lib/site-sales/schema.ts isteğe bağlı `shop.lines`, `cardMinor`; src/lib/calc/engine.ts mağaza maliyet
  sırası ve `shopGoods`'tan düşme; POS kesintisi yalnız Soru 10 cevaplanınca. Yalnız yönetici görür.
- Testler: tests/site-satis.test.ts (alanlar yokken eski hesap; varken yeni; çift sayım yok).
- Uçtan uca: yerelde mağaza siparişi ve kartlı kafe siparişi; ay yeniden çekilince maliyet satırı.
- Bağımlı: S9; dalga 11 birleşmiş (cash-plan.ts, src/server/data/cash-plan.ts, parasut/sync.ts aynı dosyalar).

**S10 · llms.txt canlı veriden** · laffogato · `claude/senkron-s10-llms` · migration: yok.
- Ne: §3.2 marka-llms-txt. PR gövdesinde: yol çakışması yüzünden public dosyalar aynı PR'da silinir; arka yüz PR'ıdır.
- Testler: tests/llms-consistency.test.ts ve tests/domain.test.ts:48-56, :73-80 yeni çıktıya göre;
  tests/proxy-fast-path.test.ts:62 aynı; iki yol tests/public-pages-cached-reads.test.ts listesinde.
- Uçtan uca: kalemi pasif yap; etiket düşünce ve CDN süresi dolunca `/llms.txt` kalemi göstermez. Bağımlı: yok.

**S11 · Site temizliği** · laffogato · `claude/senkron-s11-temizlik` · migration: yok.
- Ne: site.ts:71-83, :117-123 ve store.ts:946-947 entity'den; JSON-LD `LdSettings`'e phone/email; Ayarlar ipuçları;
  "QR'lı aktif masa: N"; "Diğer" uyarısı; hesap silmede karaoke `note` (me.ts:269-285; API-MOBILE §4/§7 metni
  değişirse lafmobil kopya PR'ı); ödül uyarısı ve panel POST yanıtında `warnings[]`; seçenek kimliği testi; Paraşüt
  ürün kodu vektörü; palet yan klon testi; CLAUDE.md ve FRONTEND-SINIR.md yolları.
- Uçtan uca: telefonu değiştir → footer ve JSON-LD yeni değeri; ipucu hukuk ve llms için elle adımı söyler.

**S12 · KVKK metni** · laffogato · `claude/senkron-s12-kvkk` · avukat okumasıyla, sıraya girmez.
- Ne: content.ts aydınlatma metni ve imha politikasına iç panel cümlesi; entity.ts'e panel DB bölgesi token'ı (boşsa
  satır düşer); `LEGAL_UPDATED`; LEGAL-REDLINES maddesi. Test: tests/legal-docs.test.ts. Sonra hukuk tohumu (M4).

**P8 · Panel temizliği** · lafmaliyet · `claude/senkron-p8-temizlik` · migration: yok.
- Ne: `label` 48 (schema.ts:117); bar kartında "Ödendi (online) · kasaya çalınmaz"; Opera AVM (weather.ts:13-14,
  SATIS-TAHMINI.md:11, KALAN-ISLER.md §5.1); gunluk/route.ts:26-27 yorumu; `refundTouchedMonths` ile eski ay; Kasaya
  işle'de fiyat listesi tarihi uyarısı (S9); `warnings[]` gösterimi (S11); Paraşüt ürün kodu vektörü; KALAN-ISLER'e
  §5'teki elle adımlar.
- Bağımlı: S9, S11 (ilgili maddeler için).

**M4 · lafmobil temizliği** · lafmobil · `claude/senkron-m4-temizlik` · migration: yok · sürüm gerekmez (tohumlar
sonraki derlemeye biner).
- Ne: brand.seed.json:59 `legalName`; CLAUDE.md:136-137 ve docs/SITE-PALETTE-SYNC.md:14; CATALOG.md notu ve
  Alternatif Süt `nuts`; catalog.seed.json'a 2 `taxRatePct`; src/lib/hours.ts:4 yorumu; STORE-RELEASE.md'ye "en düşük
  sürüm yeni sürüm yayımlandıktan sonra yükseltilir" ve "Supabase projesi değişirse…" adımları; S12'den sonra hukuk
  tohumu (`legal:export` + `legal-split`); S11'in API-MOBILE kopyası.

### 4.4 Eski görev → yeni görev

| Taslak | Bu plan |
|---|---|
| S1 | S1 ("Satışa aç → işaret" çıktı) |
| S2 | S3; 304 yeni görev S4 |
| S3 | S6 + F1 (override), S7 + F2 (kapanış) |
| S4 | S3 (`taxRatePct`), S9 (gerisi) |
| S5 | S5 (süre, probe, redirect düzeltildi) |
| S6a | S8 (seçenek, kilometre taşı, davet eşiği), S11 (ödül uyarısı) |
| S6b, S6c, S7 | S11, S12, S10 |
| F1 | F1 (override), F2 (saat metinleri) |
| P1.1-2 | P1 (`seenPrice` + `expect`) |
| P1.3-6 | P4 (Kasaya işle yerine yönetici zili; Tükendi dalga 10'un `setSoldOut`'u) |
| P1.7 | P2 (2 sa yoğun mod yerine ödeme takibi), P8 (etiket, kasaya çalınmaz) |
| P1.8 | P0 (push adı), P5 |
| P1.9 | silindi (dalga 10 §2.9) |
| P1.10 | P6 |
| P1.11-12 | P8, P1 (belgeler) |
| P2 | P1 (`expect`), P3 (ayar kopyası) |
| P3 | P7 (dalga 11 sonrası) |
| M1 | M2 (tazelik), M3 (kapanış, eşikler) |
| M2 | M1, M3 (kopyalar), M4 |

---

## 5. Sahip

### 5.1 Sahibe sorular (cevap gelene kadar varsayılan geçerli)

| # | Soru | Varsayılan | Neyi bekletir |
|---|---|---|---|
| A | Neon: sitenin projesi 23 Ekim'de 81/100 CU-saatteydi ve 28 Ekim'de doluyordu (site:docs/DATABASE.md:264-273). 250 CU-saatlik ek paket (ayda 10 $) mı, Launch (≈ 12 $/ay) mı? Panelin Free projesi de ölçülsün mü? | Plan kararı gelene kadar Faz 1 birleşebilir (periyodik çekme eklemez). P3 S4'ün 304'ü yayında olmadan birleşmez; P2, P3, P6 öncesi ve sonrası 48 saat ölçülür (§4.0). Seçimden sonra `NEON_CU_HOURS_LIMIT` güncellenir | Hiçbir fazı durdurmaz; P3 ve P6'nın sırasını belirler |
| 7 | Hangi mağaza ürünleri kafe stoğundan hazırlanıyor (kup kutusu, Affogato Seti, çekirdek, matcha)? | **Hiçbiri:** bağ yok; maliyet `costMinor` ya da ortalama oranla | P7'nin bağ kısmı (Faz 3) |
| 10 | PayNkolay kesintiyi ayrı faturayla mı kesiyor, net aktarımla mı? Oran ne? | **Oran boş:** panelde satır yok, uyarı da yok | P7'nin POS kısmı (Faz 3) |

### 5.2 Karara bağlananlar

| # | Soru | Karar | Dayanak |
|---|---|---|---|
| 1 | Tarihli kapanışın kaynağı | **İleri tarihli planlı kapanış sitede** (Ayarlar → Saatler). Geçmiş "kapalıydık" panelde (dalga 10 §2.9, `special_days kapali`). Panelin ileri tarihli `kapali` satırında (yönetici) yalnız "Sitede de kapat" bağlantısı; panel siteye yazmaz | Müşteriye dönük bilgi sitede yaşar (§3.1); dalga 10'un kapalı gün kararı (d10:docs/planlar/personel-yetki.md:1194-1196) |
| 2 | Kafe kapalıyken karaoke | **Kapalı**; kapanış satırında "Karaoke açık" kutusu. Kaydetmeden önce o güne düşen ödenmiş rezervasyonlar listelenir (S7) | Kapalı köşke müşteri gelmesin; istisna tek tık |
| 3 | Personel Tükendi / Satışa aç | **Dalga 10 kapattı:** evet, onaysız, var olan `pushSaleChange` yolu; site sözleşmesi değişmez | d10:docs/planlar/personel-yetki.md:87-89 |
| 4 | Biten hammadde kalemi kendiliğinden düşürsün mü | **Hayır:** liste + dalga 10'un `setSoldOut`'u (P4) | Sayımdaki 0 bir yazım hatası ya da yolda olan mal olabilir; Tükendi bir insan kararıdır ve tek yolu dalga 10'un eylemi |
| 5 | Seçenek ek ücretinin kaynağı | **Menü kalemi** (mnu-0081, 0080, 0082), Tükendi'den bağımsız; laktozsuz 0 (uygulamanın bugünkü tahsilatı); mnu-0082 açıklaması "yulaf ya da badem". Fark varsa S8 PR'ında sahibe yazılır | Sahibin isteği: bir yerde değişen fiyat her yerde değişsin |
| 6 | Ücretsiz içecek kuponu ekleri karşılasın mı | **Hayır**, bugünkü gibi; değer tabanın altına düşünce uyarı (S11) | Senkron değil, değer kuralı |
| 11 | Hesabını silen üyenin karaoke notu | **Silinsin** (S11) | Fazladan silmek hukuk metnini genişletmez |
| 12 | Panelin QR menüsü | **Kapalı kalır** (panel:src/lib/constants.ts:25) | Müşteri menüsü tek |
| 8, 9 | Servis kabı; kasada damga kuralı | **Bu belgeden çıktı** (senkron değil; §3.4) | - |

### 5.3 Sahibe elle adımlar (KALAN-ISLER'e, P8)

- **Neon:** Soru A; panel projesinin kullanımını Vercel › Storage › lafmaliyet-db › Usage'tan oku.
- **Menü:** canlıda mnu-0082'nin açıklamasını "yulaf ya da badem" yap (S8 ile).
- **Vercel:** iki projenin `PARASUT_COMPANY_ID`'sini değerleri yazmadan yan yana karşılaştır; Paraşüt firma profilindeki
  unvan / VKN / adresi entity.ts ile karşılaştır.
- **Neon (panel):** veritabanı bölgesini öğren (S12 token'ı).
- **ModPOS:** karaoke fiyatını sitedeki saat ücretiyle karşılaştır.
- **Supabase:** panodaki dört giriş e-postasını site:docs/email/ ile karşılaştır.
- **Personel ayrılınca:** panel `users`, site `admin_users` ve `staff_members` hesaplarını kapat.
- **Masa ekranlı uygulama sürümü:** AASA `/masa/*` ile Android intent filtresi aynı gün açılsın.

---

## 6. Eleştiri kaydı

| ID | Sonuç | Neden |
|---|---|---|
| sozlesme-1 | Kabul | route.ts:142-145 değişmeyen yazıma 200 + eski kalem dönüyor; dalga 10 buna dayanıyor (d10 plan :179). §3.1 sırası ve "aynı değer → 200" testi S1'de |
| sozlesme-2 | Kabul | Şema `.strict()` (menu-link-core.ts:112-121), push 2xx dışında UserError (push.ts:78). `writes` bayrağı §3.1 kuralı, P1'de yeniden deneme |
| sozlesme-3 | Kabul | `send` 4 + 1,5 + 4 sn (ping.ts:43-44, :92-118), panel 8 sn (site-link.ts:12), `fetch` yönlendirmeyi izliyor. S5 paralel, 2,5 sn, `redirect:"manual"`, yalnız 202 + `{ok:true}` |
| sozlesme-4 | Kabul | Panel ping gövdesine bakmıyor (site-menu/ping.ts:4); `probe:true` S5 ve P6'da. P2 artık pingte sürüm artırmadığı için yan etki yalnız uyanma |
| sozlesme-5 | Kabul | Uygulama yalnız bilinen kodlarda dallanıyor (karaoke.tsx:579-616); `slot_taken` + sunucu mesajı; API-MOBILE §3, §6, §7, §10 S7'de |
| sozlesme-6 | Kabul | Planlı sipariş 7 gün (order-pricing.ts:320); kaydetmeden önce liste ve onay S7'de, kendiliğinden iptal yok |
| sozlesme-7 | Kısmen | `LAFMOBIL_DIR` zaten var (api-contract-parity.test.ts:19-26) ve bulunamayınca `console.info` ile atlıyor (:31-36); yeni değişken değil, kullanım kuralı (§3.1 "Sözleşme kopyası"). Kopya PR'ı başına bir lafmobil PR'ı ve S11 kabul |
| sozlesme-8 | Kabul | `updateMenuItem` tüm satırı okuyup yazıyor (store.ts:7123-7140); dokunulmayan sütun UPDATE'e girmez, dokunulan koşullu (S1) |
| sozlesme-9 | Kabul | Personel Tükendi'si ek ücreti oynatmasın; ücret `isActive`'ten bağımsız (S8) |
| sozlesme-10 | Kabul | İşaret yalnız fiyat değişince (route.ts:152, actions.ts:308-311); S1'den çıktı |
| sozlesme-11 | Kabul | Bugün iki yanda yalnız karaoke vektörleri, menü yalnız panelde; eksik vektörler S1-S5'e dağıtıldı. Panel ayar belgesi `docs/SITE-AYARLAR.md` (P3) |
| sozlesme-12 | Kabul | `settings` personel e-postası taşıyor (store.ts:623-646); alan alan beyaz liste ve anahtar kümesi eşitliği (§3.1, S3, S9) |
| sozlesme-13 | Kabul | Menü POST'u alan yoksa 400 `fields` (menu-link-core.ts:144-150); aşama enum'ları (orders-stage-core.ts:35-52); imza parse'tan önce. Gövdeler P6'da sabit |
| sozlesme-14 | Kabul | Önbellekte boolean saat ilerledikçe yanlışlaşır; `loadAppProps`'a girdi (S6, S7), hesap istemcide (F1) |
| sozlesme-15 | Kabul | `force-dynamic` (sitemap.ts:13 gibi), başlık yalnız route'ta, vercel.json kuralı kalkar, public dosyalar aynı PR'da (S10); başlık butce-llms-route'un 86400'üyle |
| butce-bar-ping-yogun-mod | Kısmen | Her `orders` yazımı ping atıyor (db/index.ts:291-296) ve `busy` 2 saat (orders-board.tsx:58, :100): kabul. `awaitingPayment` Faz 1'e (S2 + P2). "Saatlik kontrol pingle yapılan çekmeyi saymaz" kalır |
| butce-panel-uclari-304 | Kabul | /api/panel/* `no-store`; işaretler var (change-marker.ts:61-93) ve önbellek testi izin veriyor (site-data-cache.test.ts:674-675). Faz 2'de S4 |
| butce-ayar-cekme-sayfa-acilisi | Kabul | Bugün / Doluluk açılışında çekme yok; Ayarlar yalnız 24 sa / hata, `after()` (§3.1, P3) |
| butce-olcum-ve-plan | Kabul | DATABASE.md:264-273 doğrulandı; §3.1 "Bütçe", §4.0 ölçüm, §5 Soru A |
| butce-gece-sessiz-cekme | Kabul | Saatlik sessiz çekme (orders-board.tsx:49, :112-118) kapalı saatte durur; S3'ün saatleriyle P3'te |
| butce-gunluk-is-suresi | Kabul | Günlük iş 60 sn (gunluk/route.ts:35), tek `Promise.all` (:119). KVKK boşaltma haftalık (P5); 13 aylık satış çekmesi yerine `refundTouchedMonths` (S9, P8) |
| butce-satisa-ac-isareti | Kabul (madde çıktı) | `markMenuPricesChanged` `settings` yazar (store.ts:7179-7185), `pub:site` düşer. Önerilen "/admin/menu menu_items'tan hesaplasın" alternatifi gereksiz: işaret zaten yalnız fiyatta |
| butce-llms-route | Kabul | 1 gün CDN kalır; yalnız önbellekli okuyucu; gecikme hedefi ≤ 1 gün (S10) |
| butce-acik-durum-yoklamasi | Kabul | Bugün durum istemcide, ağ isteği yok (use-open-status.ts:17-28); istemci yoklaması yok, ayrı etiket yalnız action'larda (S6, F1) |
| butce-uygulama-staletime | Kabul | Menü 5 dk; mağaza 2 değil 10 dk: sunucu bayat satırı zaten reddediyor (M2) |
| kapsam-faz-sirasi | Kabul | §4 üç faz; Faz 1 PR'ları başka fazdan madde taşımaz |
| kapsam-s1-dalga10-oncelik | Kısmen | Sıra kısıtı kabul (S1 dalga 10'dan önce ya da aynı gün). "Düzenlemede `isActive` kutusunu kaldır" seçeneği alınmadı: koşullu yazım sahibin akışını değiştirmeden aynı korumayı veriyor |
| kapsam-p1-seen-tekrar | Kabul | Dalga 10 `seenActive`/`seenShowOnMenu`'yu yazıyor (d10 plan §2.1); products.ts dalda henüz değişmemiş. P1 yalnız `seenPrice`, dalga 10'dan sonra |
| kapsam-expect-tek-noktada | Kabul | `expect` `pushSaleChange` içinde, dört çağıran tek noktadan; Faz 1 (P1); tukendi-db'ye 409 `stale` |
| kapsam-kapali-gun-dalga10 | Kabul | `closedDaysBetween` dalga 10'da (d10:src/server/closed-days.ts:20-35). Eski P1.9 silindi; site kapanışı ikinci kaynak, `closedDayRefusal`'a girmez, `special_days`'e yazılmaz (P3) |
| kapsam-kasaya-isle-dalga10 | Kabul | Personel yükleyicisi yalnız aktif ürün satırı okuyor (d10 plan §2.2); bağsız kalem yalnız yönetici zili ve "Yalnız sitede" sekmesi (P4) |
| kapsam-hammadde-setSoldOut | Kabul | Tek Tükendi yolu dalga 10'un `setSoldOut`'u (P4) |
| kapsam-bar-ping-faz1 | Kısmen | Faz 1'de ve ayrı küçük PR (P2) kabul; "her pingte 2 saat yoğun mod" bütçe yüzünden alınmadı, yerine ödeme bekleyen takibi. Etiket 48 ve "kasaya çalınmaz" Faz 3 (P8) |
| kapsam-m1-bol | Kabul | M2 (Faz 1, sunucu beklemez), M3 (Faz 2). Mağaza hesapları açılmamış (STORE-RELEASE.md:34-35): M2 ilk gönderime biner |
| kapsam-fiyat-listesi-gurultu | Kabul | sozlesme-10 ile aynı |
| kapsam-s4-s6a-bol | Kabul | `taxRatePct` S3'e (Faz 2), gerisi S9 (Faz 3); seçenek ve kilometre taşı S8 (Faz 2), ödül uyarısı S11 (Faz 3) |
| kapsam-p3-dalga11 | Kabul | Dalga 11 cash-plan.ts, src/server/data/cash-plan.ts ve parasut/sync.ts'i değiştiriyor; P7 dalga 11'den sonra, POS kısmı Soru 10'a bağlı, uyarı yok |
| kapsam-teget-isler | Kabul | Faz 3'te repo başına bir temizlik PR'ı (S11, P8, M4); S12 avukat yolunda; Web Push adı P0 olarak hemen |
| kapsam-override-genel-sayfa | Kabul | Override'ın genel sayfaya yansıması migration istemiyor: S6 + F1 Faz 2'nin başında, kapanış S7 + F2 sonra |
| kapsam-sahip-sorulari | Kabul | 1, 2, 4, 5, 6, 11, 12 karara bağlandı; 3 dalga 10'da; 8, 9 çıktı; sahibe 7, 10 ve yeni Soru A (Neon) kaldı |

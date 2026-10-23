# Paralel çalışan diğer oturumla eşgüdüm (22 Ekim 2026)

Bu depoda bizim dışımızda bir oturum daha çalışıyor: **"Admin panel tasarım ve UX"**. Aynı anda laffogato (site,
laffogato.net), lafmaliyet (bu panel), lafmobil ve shipping depolarında iş yapıyor; dalı `claude/brave-cannon-ctlv3a`.
Panele girdiği işler hep "site ile panel birlikte çalışsın" isteğinden geliyor ve sürecek.

## Panele şimdiye kadar getirdikleri (hepsi main'de)

| PR | Ne |
|---|---|
| #4 | Ürünler ↔ laffogato.net menüsü (fiyat ve menü durumu iki yönlü). Migration `0018_site_menu_baglantisi`. `src/lib/site-menu/*`, `src/server/site-menu/*`, `src/server/site-link.ts`, `/api/menu/ping`, `/panel/urunler/site` |
| #5 | Bar ekranında uygulama siparişleri (`orders-board.tsx`, `/api/orders/ping`, `/api/siparisler`, push konusu `orders`), migration `0019_siparis_bildirimi`; site online satışları kâr-zararda, tutarlılıkta ve kasa raporunda (`src/lib/site-sales/*`); karaoke çakışma uyarısı (`src/lib/karaoke/overlap.ts`) |
| #6 | Önizlemeler migration çalıştırmaz (`scripts/predeploy-guard.ts`), karaoke %20 KDV (`kdvHizmet`), `CASH_REPORT_RECIPIENTS`, QR menü siteye |
| #9 | Bar ekranından tek dokunuşla sipariş aşaması (`src/lib/site-orders/stage*.ts`, `src/server/actions/site-orders.ts` → sitenin `POST /api/panel/orders/stage`); Ayarlar › laffogato.net "Bağlantıları sına" (`site-links.ts`, `site-links-test.tsx`); `karaoke/page.tsx` `maxDuration = 30` |

Sitede yaptıkları (panele dokunmuyor ama bilinmeli): İYS (ticari e-posta izni) ve Paraşüt üzerinden e-Arşiv fatura.
e-Arşiv, **aynı Paraşüt şirketinde ikinci bir API kullanıcısıyla** müşteri, ürün ve satış faturası oluşturacak; panelin
Paraşüt istemcisini (`src/server/parasut/client.ts`) kopyalamışlar.

## Site ↔ panel sözleşmeleri (imzalı, `KARAOKE_SYNC_SECRET`, `x-laf-timestamp` + `x-laf-signature: v1=`)

- Karaoke: `GET /api/panel/karaoke?from&to`; site `/api/karaoke/ping`'e bildirir.
- Menü: `GET/POST /api/panel/menu`; site `/api/menu/ping`'e bildirir.
- Siparişler: `GET /api/panel/orders`, `POST /api/panel/orders/stage`; site `/api/orders/ping`'e bildirir.
- Satışlar: `GET /api/panel/sales?month=` ya da `?from&to`.
- Sözleşmelerin kopyası sitede `docs/PANEL-MENU.md`, `PANEL-ORDERS.md`, `PANEL-SALES.md`; panelde `docs/SITE-*.md`.

## Sahiplik ve kurallar

- **Onların alanı:** laffogato deposu; panelde `src/lib/site-*`, `src/server/site-*`, `site-link.ts`, `site-ping.ts`,
  ping ve `siparisler` uçları, `orders-board.tsx`, `urunler/site/*`, `site-sales-card.tsx`,
  `src/server/actions/site-*.ts`, Ayarlar'daki `SiteLinksCard`, `docs/SITE-*.md`.
- **Bizim alanımız:** `docs/planlar/` içindeki gruplar.
- Onların dosyalarına dokunmak gerekirse küçük ve eklemeli değişiklik yapın, PR açıklamasında listeleyin.
- `src/lib/karaoke/signature.ts`'e dokunmayın (iki deponun testleri imza test vektörlerini sabitler).
- Bir sözleşmenin `version` alanını asla değiştirmeyin (panel bilinmeyen sürümde bütün listeyi reddeder); yeni alan
  eklemek güvenli.
- `claude/brave-cannon-ctlv3a` dalına ve laffogato deposuna push etmeyin. Site tarafında gereken değişiklikleri
  (ör. doluluk için geçmiş tarihli karaoke penceresi ve `cancelledAt`; odaya sipariş hedefi) sahibine/diğer oturuma
  isteyin; iki taraftaki `PANEL-*.md` / `SITE-*.md` birlikte güncellenir.
- **Güncel kalın:** her dalgadan ve her PR'dan önce `git fetch` + `origin/main`'i birleştirin (11 saatte 4 PR
  birleştirdiler). Migration'lar R2'ye göre birleştirmede yeniden üretilir; onların yeni migration'ı gelirse
  numaralar kayar, sorun değil.

## Planlarımızla çakışma noktaları

- **menu:** `src/server/site-menu/sync.ts` (`applyPlan`), `src/server/site-menu/push.ts` (`SitePushError`),
  `src/lib/site-menu/push.ts` (hatırlatma metni), `tests/site-menusu.test.ts`, `docs/SITE-MENU.md`. Toplu fiyat
  değişikliği sitenin kalem kalem yazma yolunu kullanmalı (toplu uç yok).
- **doluluk:** `src/server/karaoke/sync.ts`, `src/lib/karaoke/site.ts`, karaoke sayfasının sekmeleri
  (`orders-board.tsx` ile aynı sayfa). Sitenin geçmiş pencereleri ve `cancelledAt` verip vermediği **kodlamadan önce**
  doğrulanmalı; vermiyorsa site değişikliği istenir. "Gelmedi" bilgisi sitede de yok.
- **kdv / insight:** `src/lib/site-sales/calc.ts`'e `siteVat` ekler, site satış kayıtlarını okur.
- **today:** karaoke ve `site_orders` durumunu okur. #9'dan beri "Teslime hazır" gel-al siparişi listede kalıyor;
  "N açık uygulama siparişi" sayımını buna göre yazın.
- **Ortak dosyalar:** `src/app/panel/ayarlar/page.tsx` ve `sections.ts` (ops-backup `BackupCard`, fotograf `foto`
  bölümü; #9 aynı sayfayı değiştirdi), `src/app/api/cron/gunluk/route.ts` (`maxDuration = 60`; Paraşüt 35 sn'ye kadar
  sürebilir, karaoke/menü/satış adımları 8'er sn; tahmin, haftalik, siparis, komisyon adımları bu bütçeye sığmalı,
  yeni Vercel cron eklenemez), `nav.ts` ve nav testleri, README, `BILDIRIMLER.md`, Yardım, `src/server/push/send.ts`.
- **Paraşüt:** vkn ve pricing yalnız `purchase_bills` okumalı ve `filter[account_type]=supplier` kullanmalı (aynı
  şirkette sitenin satış faturaları da olacak). Oran sınırı şirket başınaysa iki kullanıcı paylaşır. `client.ts`'de
  hata düzeltirseniz diğer oturuma/sahibine bildirin.
- **KVKK ve yedek:** ops-backup `TABLE_RULES`, `integration_state.site_orders` anahtarını (müşteri adları; bilerek
  geçmişsiz tutuluyor) dışarıda bırakmalı; `karaoke_sessions.customer_name` için de karar verin.
- **Adlandırma:** "Sipariş" uygulama siparişi demek, `/api/siparisler` dolu → bizim özellik "Mal siparişi" / `reorder`.
  "Online" iki anlamlı: Z raporundaki online (Yemeksepeti, Getir) ile laffogato.net online satışı; komisyon, kdv ve
  insight'ta etiketleri ayrı tutun.
- **Kişisel veri:** fotograf, mcp ya da Blob kişisel veriyi yeni bir işleyiciye taşırsa sitenin KVKK metinlerine satır
  gerekir; düzenlemeden önce eşgüdüm.

## Site deposunun durumu (22 Ekim 2026, laffogato 119c378; salt okunur incelendi)

- **Sözleşmeler güncel.** Sitenin panele dönük kodu (`src/lib/panel/*`, `src/app/api/panel/*`) #213'ten beri
  değişmedi; paneldeki karşılığı #9. Karaoke, menü, siparişler (aşama dahil) ve online satış sözleşmeleri iki tarafta
  aynı; satış sözleşmesinin KDV alanları (`kdvMinor`, `unknownKdvNetMinor`) panelde sözleşmedeki formülle okunuyor.
- **Karaoke geçmişi:** `GET /api/panel/karaoke` geçmiş tarihleri zaten veriyor (`from` için alt sınır yok, pencere en
  çok 400 gün, iptal / iade / süresi dolan dahil bütün durumlar). Doluluk'un geçmiş içe aktarması site değişikliği
  beklemez. Sitede iptal anı saklanmıyor (`cancelledAt` yok); istenmesi isteğe bağlı (CRITIQUE2 §9).
- **e-Arşiv (#215, varsayılan kapalı):** site aynı Paraşüt firmasında **kendi API kullanıcısıyla** müşteri kartı
  (`account_type: customer`), satış faturası, e-Arşiv ve ürün açar. Panel yalnız alış faturalarını
  (`purchase_bills`), gelen e-faturaları, tedarikçi kartlarını ve alış faturasının tedarikçisini okur; sitenin
  kayıtları panele karışmaz. İstek sınırı (10 saniyede 10 istek) firma başına paylaşılır: panelin istemcisi istekleri
  aralıklar ve 429'da `Retry-After`'a uyar; sitenin günlük işi 06:00 UTC, panelinkiler 04:30 ve 05:00 UTC'de.
  **Sahibe:** sitenin Vercel'deki `PARASUT_USERNAME`'i panelin Paraşüt kullanıcısından farklı olmalı (aynı kullanıcı
  her oturum yenilemesinde diğerinin oturumunu düşürür).
- **KVKK saklama (#196):** site, misafir karaoke verisini (ad, iletişim, not) 3 × 366 günde temizler, rezervasyonu
  11 × 366 günde siler. Panelin karaoke kopyası (`customer_name`, `note`) aynı 3 yıl kuralına uyacak (CRITIQUE2,
  doluluk 5).
- **İYS (#214) ve üye bildirim tercihleri (#216):** yalnız site; panelde bağlantı gerekmez.

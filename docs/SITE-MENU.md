# laffogato.net menüsüyle bağlantı (fiyat ve menü durumu)

Ekranlar: **Ürünler** (`/panel/urunler`; adın yanındaki küre), ürün kartındaki **Site menüsü** kartı
(`/panel/urunler/[id]`) ve eşleştirme ekranı **Ürünler › Site menüsü** (`/panel/urunler/site`). Yalnız yönetici.
Sözleşmenin sitedeki kopyası: laffogato deposunda `docs/PANEL-MENU.md` (uçlar, gövdeler, hata kodları).

## Geliştirilmiş istek (prompt)

> Operatör (21 Eki 2026): _"bir yerden pasif yapınca veya fiyat değişince diğer yerlerden de değişsin"_.
>
> Panelin ürünlerini laffogato.net menüsündeki kalemlere bağla. Bağlı bir ürünün **satış fiyatı** ve **menüde olup
> olmadığı** iki yerde hep aynı olsun; doğru kaynak sitedir.
>
> - **Site → panel:** sitede bir kalemin fiyatı değişince, "Tükendi" ya da "Satışta" olunca, kalem silinince panel
>   birkaç saniyede bilsin (imzalı ping, panel imzalı tek okumayla çeker; sürekli sorgu yok).
> - **Panel → site:** bağlı ürünün fiyatı, "Menüde aktif"i ya da "QR menüde göster"i panelde değişince önce siteye
>   yazılsın; site kabul etmezse ya da ulaşılamazsa panel de yazmasın ve bunu açıkça söylesin.
> - **Eşleştirme panelde:** ada göre öneri (Türkçe duyarlı; sitenin eski İngilizce adları dahil), hiçbiri kendiliğinden
>   uygulanmasın; sitede olup panelde olmayanı ve tersini göstersin. Bağlanınca sitenin değeri geçerli.
> - **Kapsam dışı:** ad, kategori, reçete, maliyet, görsel; kalem açmak / silmek; kasanın (ModPOS) fiyatı.
> - Karaoke bağlantısının anahtarı, imzası ve düzeni (`docs/KARAOKE.md`) kullanılsın; anahtar yoksa her şey eskisi
>   gibi çalışsın.

## Nasıl çalışır

```
laffogato.net                                    ladmin.laffogato.net (bu panel)
─────────────                                    ──────────────────────────────
menü kalemi yazıldı (pub:menu)
  └─ after(): POST /api/menu/ping  ──────────▶  imza doğru → 202 (hemen)
     {"event":"menu.changed","at"} (imzalı)        └─ after(): çek
                                                      GET laffogato.net/api/panel/menu (imzalı)
GET /api/panel/menu  ◀─────────────────────────       ├─ bağlı ürünlere uygula (tek işlem, danışma kilidi)
  {version:1, now, items:[…]} (bütün kalemler)        ├─ son listenin kopyası (menu_site_items)
                                                      └─ durum (menu_sync) + işlem geçmişi

POST /api/panel/menu  ◀────────────────────────  bağlı ürünün fiyatı / durumu panelde değişti
  {"id","priceMinor"|"priceMinorL","isActive",     ├─ önce siteye (imzalı, en çok 8 sn)
   "actor"} → {"item"}                             ├─ 2xx: sitenin döndürdüğü değerler yazılır
  (site kendi pingini de atar; panel çekince       └─ hata: hiçbir şey yazılmaz, Türkçe hata
   değerler zaten aynıdır, döngü olmaz)
```

### Eşleştirme

Sitede bir kalem iki boy fiyatı taşır (`priceMinor` = M ya da tek fiyat, `priceMinorL` = L, `0` tek boy); panelde
her boy ayrı satırdır. Bağlantı panelin `products` satırında durur:

| Sütun | Anlamı |
|-------|--------|
| `site_menu_id` | Sitedeki kalemin kimliği (`mnu-0011`); bağlı değilse boş |
| `site_menu_slot` | Bu satır sitedeki hangi fiyat: `M` = `priceMinor` (tek boyda tek fiyat), `L` = `priceMinorL` |

İkisi birlikte boş ya da dolu; `(site_menu_id, site_menu_slot)` benzersiz (bir fiyata bir satır). Migration
`drizzle/0018_site_menu_baglantisi.sql`; var olan ürünler bağlı değil başlar. Yuva panelin boyundan bağımsızdır:
panelde yalnız L boyu olan "Esp. Macchiato" sitedeki tek fiyata (`M` yuvası) bağlanır.

**Öneriler** (`src/lib/site-menu/names.ts`): önce aynı ad (büyük/küçük harf, ı/İ, aksan ve noktalama sayılmaz: "Çay" =
"ÇAY", "Caffè" = "Caffe"), sonra sitenin eski İngilizce adı (laffogato `db/migrations/20260922120000_turkish_catalogue_names.sql`
ve `20260922130000_turkish_menu_names_pass2.sql` kimliği eski adın yanında yazar; panelin Excel adları bunlar:
"Ice Latte" → `mnu-0023` Buzlu Caffè Latte), sonra benzer ad (ek almış sözcük "Çilekli Magnolia" ~ "Çilek Magnolia",
tek harf yazım farkı "Tiramusu" ~ "Tiramisu"). Güven sözcüğü: **Aynı ad**, **Eski adı**, **Benzer ad**. Her ürün en
çok bir öneri, her (kalem, yuva) en çok bir ürün alır; çakışmada güven, sonra fiyatın yakınlığı kazanır (sitede tek
boy "Protein Shake" 270 ₺, panelde 270 ₺'lik L satırına önerilir). Önce aktif ürünler. Eşleştirme ekranında aynı ad
ve eski ad önerileri seçili gelir, benzer adlar elle seçilir; **hiçbiri "Önerileri bağla"ya basılmadan bağlanmaz.**
Sitenin tohum menüsüyle Excel'in 129 ürününden 115'i öneri alır (`tests/site-menusu.test.ts`).

**Bağlama** sitenin listesini imzalı yeniden çeker, bağlantıyı yazar ve listeyi bütün bağlı satırlara uygular: yeni
bağlanan ürün sitenin fiyatını ve menü durumunu alır (pencere bunu önceden gösterir: "Bağlanınca: fiyat 300 ₺ → 280 ₺").
Aynı işlemde bu kalem ve yuvayla gelmiş ürünsüz LafPOS satırları (`pos_daily_sales`) ürüne bağlanır, LafPOS günleri
yeniden göndermeden ([LAFPOS.md](LAFPOS.md) › Gün sonu, "Sonradan bağlama"); bağlı satırların ürünü değişmez.
Kartta kaydedilmemiş değişiklik varken bağlantı değiştirilmez. **Bağlantıyı kaldırmak** fiyatı ve durumu olduğu gibi
bırakır; ürün bundan sonra yalnız panelde değişir. Bağlantı ürün açmaz, adı ya da kategoriyi değiştirmez.

### Değerlerin karşılığı

- **Fiyat:** site kuruş tamsayı, panel TL (ikisi de KDV dahil). Panel → site `Math.round(TL * 100)`, site → panel
  `kuruş / 100`. Kuruşu aynı fiyata dokunulmaz.
- **Menüde mi:** sitede `isActive` ("Satışta" / "Tükendi"); panelde `active` (ürün yaşıyor) ve `showOnMenu` (QR menü).
  - Site → panel: **Tükendi** `showOnMenu = false` yapar, `active`'e **dokunmaz** (tükenen kalem geçicidir, maliyet
    analizinden düşmez); **Satışta** `showOnMenu = true` ve `active = true` yapar.
  - Panel → site: `active && showOnMenu` sitede `isActive` olur. Ürünü pasif yapmak da QR menüden kaldırmak da sitede
    "Tükendi"dir. Kural aynı yazımda uygulanır: "Menüde aktif" kapatılıp kaydedilince "QR menüde göster" de kapanır
    (sonraki çekme zaten öyle yapardı; bildirim söyler). Satışa geri açmak için ikisi de açılır.
  - Bir kaleme bağlı M ve L satırı aynı durumu paylaşır: birini menüden kaldırmak kalemi sitede gizler, öbür satır da
    aynı yazımda `showOnMenu = false` olur. Boy boy satış durumu sitede yok.
- **L fiyatı silinirse** (`priceMinorL = 0`) L yuvasına bağlı satır **bağlantı kopuk** olur: fiyatına ve durumuna
  dokunulmaz (o boy sitede yok), panelde fiyatı ya da durumu da değiştirilemez (gönderilseydi sitede L boyu yeniden
  açılırdı). Kartta, listede (kırmızı küre ve "Bağlantı kopuk") ve eşleştirme ekranının başında görünür; bağlantı
  kaldırılır ya da ürün kalemin tek fiyatına bağlanır.
- **Kalem sitede silinirse** panel o satırların bağlantısını kaldırır (fiyat ve durum kalır), eşleştirme ekranının
  durum kartında ve işlem geçmişinde söyler. Sitenin listesi **boş** gelirse hiçbir şey uygulanmaz (bütün bağlantılar
  kaldırılmasın; hata olarak görünür).

### Panel → site yazımı

`updateProductPrice` (listede fiyat hücresi, zam uyarısının "önerilen fiyatı uygula"sı ve geri alması) ve
`saveRecipe` (ürün kartı) ürünün tabloya fiyat / `active` / `showOnMenu` yazan iki eylemidir. Bağlı üründe:

1. Değişiklik siteyi ilgilendiriyor mu: fiyatın kuruşu ya da `active && showOnMenu` değişiyor mu. Değişmiyorsa
   (yalnız reçete, ad, not) her zamanki gibi yazılır.
2. Panelin kendi denetimleri önce (aynı ad + boy, malzemeler): site kabul ettikten sonra kayıt düşmesin.
3. Gönderilmeden reddedilenler: fiyat 0 (sitede 0 ₺ bedava demek; L'de kalemi tek boy yapar), sitenin tavanının
   (1.000.000 ₺) üstü, kopuk L bağlantısı, bağlantı kapalı (anahtar yok; bağlı ürün değiştirilemez, iki yer
   ayrışmasın: anahtarı ekleyin ya da bağlantıyı kaldırın).
4. `POST /api/panel/menu` imzalı, en çok 8 saniye; gövde yalnız değişen alanlar ve `actor` (oturumdaki kullanıcının
   adı, en çok 80 karakter; sitenin olay kaydında "Panel · Selin").
5. 2xx: sitenin döndürdüğü kalem yazılır (fiyat yuvadan; durum kurala göre), aynı kaleme bağlı öteki satırlar da
   güncellenir, son listenin kopyası ve site saati ilerler. Yanıt okunamazsa gönderilen değerler yazılır (sitenin
   pingi sonraki çekmeyi getirir).
6. Başarılı fiyat yazımından sonra bildirim hatırlatır: _"Fiyat sitede de değişti. Fiyat listesinin tarihini sitede
   (Ayarlar → Vergi) güncellemeyi unutma; kasadaki (ModPOS) fiyat Fiyatlar › Kasaya işle listesinde."_ Fiyat listesi
   tarihini bağlantı değiştirmez (sitenin kararı); kasanın fiyatı üçüncü bir kopyadır, iki depo da ona ulaşamaz: panel
   değişen fiyatı **Ürünler › Fiyatlar › Kasaya işle** listesine ekler, kasada elle değiştirilince işaretlenir
   ([FIYATLAR.md](FIYATLAR.md)).

**Toplu fiyat değişikliği** ve geri alması (Ürünler › Fiyatlar, [FIYATLAR.md](FIYATLAR.md)) aynı kalem kalem yazımı
kullanır (sitede toplu uç yok): bağlı ürünler site kalemine göre gruplanır, bir kalemin M ve L satırı sırayla gider
(öteki boyu güncelleyen yanıt eski fiyatı geri yazmasın), gruplar dörder dörder; site kapalı görünürse (ağ, zaman
aşımı, kurulmamış bağlantı, imza reddi, 5xx) sıradakiler gönderilmez, 40 saniyeden sonra yeni ürün gönderilmez
(sayfanın `maxDuration`'ı 60). Bağlı olmayanlar tek işlemde, önce danışma kilidi alınarak yazılır.

### Personel: Tükendi / Satışa aç

Dalga 10 §2.1 (`docs/planlar/personel-yetki.md`). Biten ürünü hemen "Tükendi" yapmak gerekir: onay beklenirse
uygulamadan ödenmiş sipariş gelmeye devam eder ve iade gerekir. Bu yüzden onaysızdır; para, fiyat, stok ve kasa
taşımaz, geri alınır, sınırlıdır ve yöneticiye görünür.

- **Nerede:** bar ekranında (`/panel/karaoke`) "Uygulama siparişleri"nin altındaki **Tükenenler** kartı
  (`#tukenenler`). Site bağlantısı (`KARAOKE_SYNC_SECRET`) yoksa kart çizilmez. Boşken tek satır: "Biten ürün yok." ve
  "Tükendi işaretle". Doluyken yalnız bu kartla kapatılıp kaydı hâlâ geçerli ürünler: ad, altında "M · L · Selin,
  21:40" (dünden kalanda "dün 21:40"), sağda "Satışa aç". Başarılı dokunuştan sonra satırın düğmesi 1,5 sn kapalı.
- **"Tükendi işaretle" penceresi yalnız kapatır.** Açıklaması "Sitede boy boy durum yok: M ve L birlikte kapanır.";
  arama panel ve sitedeki adda, panelin ortak Türkçe harf ve aksan duyarsız eşleşmesiyle ("ice" → Ice Latte, "sut" →
  Sütlü …; ad farklıysa "sitede: …"); satırlar sitenin kategorisine göre. Rozetler: "Satışta"
  (Tükendi düğmesi), "Tükendi · Selin 21:40", "Kapalı · yönetici açar", "Selin tükendi yaptı; sonra sitede değişti ·
  yönetici açar". Kopuk, sitede olmayan, bağlanmamış ve bütün boyları pasif ürün listede yok.
- **Yazım:** her zaman yukarıdaki panel → site yolundan (`pushSaleChange` → imzalı `POST /api/panel/menu`, `actor`
  kişinin adı: sitenin olay kaydında "Panel · Selin"; site kabul edince `applyPushed`). Panelde yalnız `showOnMenu`
  yazılır; fiyat ve "Menüde aktif" hiç yazılmaz. Tükendi ve Satışa aç sitenin **canlı** listesini okur
  (`fetchSiteMenu`). Aynı kalemdeki Tükendi, Satışa aç ve Kapalı tut sırayla koşar (kalem başına danışma kilidi, siteye
  istek de kilit altında; 10 sn'den uzun bekleyen "Az önce değişti" görür): yöneticinin "Kapalı tut"u personelin aynı
  anda verdiği "Satışa aç"tan önce biterse personel açamaz, sonra gelirse ürünü yeniden kapatır.
- **Kayıt** (`integration_state` › `menu_sold_out`): kalem başına kim (`byId`, `by`, `byRole`), ne zaman ve sitenin
  kapattıktan sonraki `updatedAt` damgası (`siteUpdatedAt`); `toggles` kalemin son işlem anı. Kayıt yalnız site bu
  yazımla kapattıysa yazılır: istekten hemen önce canlı listede satışta, yanıtın damgası o andakinden farklı ve isteğin
  başından yeni. Sitenin "değişmedi" yanıtı eski damgayla döner (sahip sitede ya da yönetici ürün kartından birkaç
  saniye önce kapattıysa onunki), o zaman "… zaten tükendi (sitede kapatılmış; yönetici açar)" denir. Kalan pencere
  canlı okuma ile yazım arasındaki gidiş-dönüş kadar; sitenin yanıtı "değişti mi" alanını taşıyınca kapanır (site
  tarafında ayrı iş, `docs/planlar/KALAN-ISLER.md`). Kayıt, kalem sitede kapalıyken ve damgası
  aynıyken geçerlidir: sahibin sitenin panelinden yaptığı her değişiklik kalemi yöneticiye bırakır. Panelin kendi
  fiyat yazımları (fiyat hücresi, ürün kartı, toplu Fiyatlar) kaydı yeni damgaya taşır (`carrySoldOutMarker`).
- **Kim açar:** kayıt geçerliyse her personel (kapatan olmak gerekmez). Yöneticinin ürün kartından, sitenin
  panelinden ya da "Kapalı tut" ile kapattığı ürün personele kilitli: "Bu ürünü yönetici kapattı; satışa yönetici
  açar." Bir boyu pasif ürünü kimse buradan açamaz (açmak o boyu da açardı).
- **Sınırlar (personel):** geçerli kayıtların toplamı en çok 10 (bütün personel birlikte, yöneticininki sayılmaz);
  kişi başına 10 dakikada en çok 20 işlem (İşlem geçmişinden); aynı kalemde iki işlem arasında en az 3 sn.
- **Yönetici:** aynı kartı sınırsız kullanır; "Kapalı tut" ürünü kapalı bırakıp kaydı düşürür (satışa artık yalnız
  yönetici açar); pencerede kayıtsız kapalı ürüne "Satışa aç". Ürün kartında "QR menüde göster"in altında "Personel
  tükendi yaptı · Selin 21:40". Zil (Uyarılar; push yok): "Tükendi: Tiramisu, Cheesecake", "Personel kapattı: Selin
  21:40 · Ali 22:05. …"; bir kayıt 24 saatten eskiyse ya da son bir saatte personel 3 ürün kapattıysa uyarı. Sabah
  e-postası: "Personelin tükendi yaptığı ürünler: Tiramisu (Selin, 2 gündür)". Bugün › "Bugün kafede" (iki rolde):
  "Tükendi: Tiramisu, Cheesecake"; personelin kaydı 16 saatten eskiyse uyarı rengi.
- **Açık kalmış ürün kartı:** reçete kartı açılırken gördüğü "Menüde aktif" ve "QR menüde göster" değerlerini de
  gönderir (`seenActive`, `seenShowOnMenu`); dokunulmayan anahtar veritabanındaki güncel değeri yazar
  (`keepSeen`), bu arada tükendi yapılan ürün sessizce yeniden açılmaz.
- **Hatalar** sunucuda kurulur: bağlantıyla ilgili nedenlerde (kapalı bağlantı, 400 / 401 / 404 / 409) metnin sonunda
  "Yöneticiye haber verin."; site yazdı ama panel yazamadıysa "Sitede tükendi oldu ama panele yazılamadı; yöneticiye
  haber verin." Aynı anda iki barista: tek kayıt kalır, ikincisi "… zaten tükendi" görür.
- **Kişisel veri ve tutar:** okuyucu (`src/server/data/menu-status.ts`) ürünlerden yalnız kimlik, ad, boy, bağlantı
  ve "Menüde aktif" okur, sitenin kalemini fiyatsız kopyaya indirir; eylem yalnız ad ve metin döner; zil yalnız
  yöneticiye; e-postada ad ve süre.
- **İşlem geçmişi:** "Tükendi" (Tiramisu (M, L) · laffogato.net, uygulama ve QR menü), "Satışa açıldı", "Tükendi:
  kapalı tutuldu".

### Panel ne zaman çeker

Sitenin pingi (`/api/menu/ping`), Ürünler sayfaları açılınca (liste, kart ve eşleştirme ekranı; son denemeden beş
dakika geçtiyse, sayfa beklemez), günlük iş (`/api/cron/gunluk`, karaoke eşitlemesinin yanında) ve **Siteyle eşitle**.
Çekme tek işlemde ve `pg_advisory_xact_lock(hashtext('menu-sync'))` ile yazar (bağlama ve panelin yazımı da aynı
kilidi alır); uygulanan son listenin ya da panel yazımının site saatinden eski bir liste uygulanmaz (bir panel yazımı
sürerken başlamış çekme onu geri almasın). Site listenin saatini (`now`) kalemleri okuduktan sonra aldığı için bu tek
başına yetmez: panel yazdığı her kalemin sitedeki `updatedAt`'ini bir saat saklar (`pushed`); listede bundan eski kalan
kalemin bağlı satırları o çekmede uygulanmaz, kopyada yazımın hâli kalır, bağlantı kaldırılmaz; sonraki çekme yeni
hâli getirir (`src/lib/site-menu/plan.ts` › `staleItemIds`). Sitenin `now`'ı kalemlerden önce alması sitenin işi
(o yapılınca da bu koruma zarar vermez). Sonuç `integration_state`'te:

| Anahtar | İçerik |
|---------|--------|
| `menu_sync` | `lastPullAt` (son deneme), `lastOkAt` (son başarılı), `lastError`, `lastPingAt`, `lastSiteNow`, `changedRows`, `lastChangedAt` + `lastChanges` (son değişiklikler), `broken` (kopuk bağlantılar), `unlinked` (sitede silindiği için kaldırılanlar, son 20), `itemCount`, `pushed` (panelin son bir saatte yazdığı kalemler: kalem kimliği → sitedeki `updatedAt` ve yazım anı) |
| `menu_site_items` | Son listenin kopyası (`now`, `at`, `items`): ekranlar siteye gitmeden kalemin adını, fiyatını ve durumunu gösterir |
| `menu_sold_out` | Tükenenler kartının kaydı: `items` (kalem → kim, ne zaman, sitenin damgası) ve `toggles` (kalemin son işlem anı); yukarıda "Personel: Tükendi / Satışa aç" |

Site kaynaklı değişiklikler işlem geçmişine "laffogato.net" adıyla düşer ("Site menüsünden güncellendi", "Site
bağlantısı kaldırıldı", "Site bağlantısı koptu"); bağlama ve kaldırma yöneticinin adıyla. Sitenin değiştirdiği fiyat
(çekme, bağlanan ürünün aldığı fiyat, aynı kalemin öteki boyu) satış fiyatı geçmişine "laffogato.net" kaynağıyla girer
ve kasaya işlenecekler listesine eklenir; yalnız menü durumu değişen satır geçmişe girmez ([FIYATLAR.md](FIYATLAR.md)).

## Kurulum

1. Karaoke bağlantısı kuruluysa ek bir şey gerekmez: menü bağlantısı aynı `KARAOKE_SYNC_SECRET`'ı (iki projede aynı,
   en az 32 karakter) ve `LAFFOGATO_URL`'i (boşsa `https://laffogato.net`) kullanır. Kurulu değilse `docs/KARAOKE.md`
   › Kurulum. Sitede `PANEL_URL` (boşsa `https://ladmin.laffogato.net`) pingin gideceği adrestir.
2. Sitenin menü uçları yayında olmalı (laffogato `src/app/api/panel/menu/route.ts`, `src/lib/panel/menu-ping.ts`).
3. Panel yayınlanınca migration (`0018_site_menu_baglantisi`) build öncesinde kendiliğinden uygulanır.
4. **Ürünler › Site menüsü** → **Siteyle eşitle**: sitenin listesi gelir, öneriler görünür. Önerileri gözden geçirip
   **Önerileri bağla**; kalanları satırdaki **Bağla** ile ya da ürün kartından bağlayın. "Yalnız sitede" sekmesi
   panelde bağlısı olmayan kalemleri gösterir (panelde yoksa Yeni ürün ile açıp bağlayın).
5. Anahtar yokken ekranlar "kurulmamış" der; bağlı olmayan ürünler ve panelin geri kalanı eskisi gibi çalışır. Bağlı
   kalmış bir ürünün fiyatı ve menü durumu anahtar gelene kadar değiştirilemez (iki yer ayrışmasın; anahtar gelince
   sitenin değeri yeniden geçerli olurdu); bağlantısı kaldırılabilir.

## Güvenlik

- Ping, okuma ve yazma karaoke bağlantısının imzasıyla: `x-laf-timestamp` (unix saniye), `x-laf-signature: v1=<hex>`,
  HMAC-SHA256(zaman, yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı), ±5 dakika, sabit süreli karşılaştırma
  (`src/lib/karaoke/signature.ts`). Menü uçlarının vektörleri `tests/site-menusu.test.ts`'te sabit.
- Ping ucu: anahtar yoksa `503`, gövde 4 KB'tan büyükse `413`, imza yok / yanlış / eskiyse `401` (ayrıntı yok);
  doğruysa hemen `202`, çekme yanıttan sonra (`src/lib/site-menu/ping.ts`). Gövde kalem taşımaz.
- Sitenin yanıtı ayrıca doğrulanır (`src/lib/site-menu/schema.ts`): tanınmayan sürüm, bozuk fiyat / durum ya da iki
  kez geçen kimlik bütün listeyi reddeder (bozuk satırı atlamak onu "silinmiş" gösterip bağlantısını kaldırırdı); ad
  ve kategori kısaltılır, bilinmeyen alanlar atılır.
- Bağlama, kaldırma ve eşitleme eylemleri yöneticinin (`src/server/actions/site-menu.ts`).

## Sorun giderme

| Mesaj | Ne yapılır |
|-------|------------|
| Siteye ulaşılamadı; fiyat değişmedi. Tekrar dene. | Site 8 saniyede yanıt vermedi ya da 5xx verdi; panelde hiçbir şey yazılmadı. Biraz sonra tekrar deneyin |
| Bu ürünün bağlı olduğu kalem sitede yok; bağlantıyı kaldır ya da yeniden bağla. | Kalem sitede silinmiş (sonraki eşitleme bağlantıyı kendiliğinden kaldırır) ya da kimlik yanlış |
| Site isteği reddetti (imza …) | İki projedeki `KARAOKE_SYNC_SECRET` aynı mı, ikisi de yeniden yayımlandı mı, sunucu saatleri doğru mu? |
| Sitede KARAOKE_SYNC_SECRET tanımlı değil ya da sitenin veritabanı okunamadı | Siteye değişkeni ekleyip yeniden yayımlayın; sürüyorsa sitenin günlüğüne bakın |
| Sitede panel menü ucu yok | laffogato.net güncel değil (menü bağlantısı yayımlanmamış) |
| Bu ürünün site bağlantısı kopuk … | Sitede kalemin L fiyatı silinmiş: bağlantıyı kaldırın ya da ürünü kalemin tek fiyatına (M) bağlayın. Panelin kopyası eskiyse site isteği `409 single_size` ile reddeder, mesaj aynıdır (tekrar denemek işe yaramaz) |
| Site bağlantısı kurulmamış … değiştirilemez | Anahtar yok ama ürün bağlı: anahtarı ekleyin ya da bağlantıyı kaldırın |
| Sitenin menüsü boş geldi; bağlantılar korunuyor | Sitenin menüsü boş döndü (veritabanı?); hiçbir şey uygulanmadı |

"Sitenin son pingi" boş kalıyorsa site panele ulaşamıyor: sitedeki `PANEL_URL` ve anahtarı kontrol edin (ping gelmese
de sayfa açılışı ve günlük iş eşitler).

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/site-menu/schema.ts` | Sitenin listesinin ve yazma yanıtının doğrulanması (saf) |
| `src/lib/site-menu/slot.ts` | Yuva ↔ fiyat, TL ↔ kuruş, menü durumu kuralları (saf) |
| `src/lib/site-menu/plan.ts` | `planMenuSync`: çekmenin satır satır planı, kopuk ve kaldırılacak bağlantılar (saf) |
| `src/lib/site-menu/push.ts` | Panel → site gövdesi, gönderilmeden ret, hata metinleri, fiyat hatırlatması (saf) |
| `src/lib/site-menu/names.ts` | Türkçe duyarlı ad anahtarı, eski İngilizce adlar, öneriler, yalnız sitede olanlar (saf) |
| `src/lib/site-menu/ping.ts`, `view.ts` | Pingin imza denetimi; listedeki site işareti (saf) |
| `src/server/site-link.ts` | Karaoke ile ortak: anahtar, sitenin adresi, imzalı istek (8 sn) |
| `src/server/site-menu/sync.ts` | Çekme, uygulama, durum, son listenin kopyası |
| `src/server/site-menu/push.ts` | Panel → site yazımı ve sitenin yanıtının uygulanması |
| `src/server/site-menu/link.ts`, `view.ts` | Bağlama / kaldırma; ekranlar için bağlantılar |
| `src/server/actions/site-menu.ts` | Siteyle eşitle, bağlama penceresinin listesi, bağla, önerileri bağla, kaldır |
| `src/server/actions/products.ts` | `updateProductPrice`, `saveRecipe`: bağlı üründe önce site |
| `src/lib/site-menu/sold-out.ts` | Tükenenler: tahta, kaydın geçerliliği, açma kuralı, tavan, hız sınırı, Bugün / zil / e-posta metinleri (saf) |
| `src/server/site-menu/sold-out-store.ts`, `sold-out-core.ts` | Tükenenler kaydı (satır kilidi, fiyat yazımında taşıma); Tükendi / Satışa aç / Kapalı tut |
| `src/server/data/menu-status.ts` | Tükenenler kartının fiyatsız okuyucusu, Bugün / zil olgusu, ürün kartının notu |
| `src/server/actions/menu-status.ts` | `setSoldOut` (personel ve yönetici), `holdSoldOut` (yönetici) |
| `src/app/panel/karaoke/sold-out-card.tsx` | Bar ekranının Tükenenler kartı ve "Tükendi işaretle" penceresi |
| `src/server/prices/*` | Satış fiyatı geçmişi ve kasanın (ModPOS) durumu (`recordPriceChange`; `applyPlan` da çağırır), toplu değişikliğin kalem kalem site yazımı ([FIYATLAR.md](FIYATLAR.md)) |
| `src/app/api/menu/ping/route.ts` | Sitenin pingi |
| `src/app/panel/urunler/site/` | Eşleştirme ekranı |
| `src/app/panel/urunler/site-link-dialog.tsx`, `[id]/site-menu-card.tsx` | Bağlama penceresi, ürün kartındaki Site menüsü |
| `tests/site-menusu.test.ts` | Şemalar, yuvalar, plan, öneriler (sitenin tohumu × Excel), yazma gövdesi, imza vektörleri, ping |

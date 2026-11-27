AsilPOS (26 Kasım 2026'ya kadar adı LafPOS)

# AsilPOS bağlantısı (kafenin kasası)

Uçlar: `POST /api/pos/gun` (gün sonu), `GET /api/panel/pos/urunler` (ürün maliyetleri),
`GET /api/panel/pos/modpos-gunler` (geçiş gününden önceki ModPOS günleri) ve kasa zincirinin iki okuması
(Faz 3): `GET /api/panel/pos/devir` (bir günün devri, ertesi günün beklenen açılışı) ve
`GET /api/panel/pos/gider-kategorileri` (personelin harcama kategorileri), personel bağlantısının listesi
`GET /api/panel/pos/personel` (LM-4b; aşağıda "Personel bağlantısı"). Ekranlar: **Ayarlar ›
AsilPOS (kasa)** (bağlantının durumu, son ret ve onarımı, **AsilPOS'a geçiş günü**, ürüne bağlanamayan adlar) ve geçiş
gününden itibaren **Kasa raporu** (`/panel/kasa`) › **AsilPOS'tan doldur**, **Satışlar** (`/panel/satislar`:
AsilPOS'un ürün satışları, ay toplamı), **Komisyon & hakediş** (kanal kanal satış) ve **Zayi & ikram** (AsilPOS'un
ikramı). Sözleşmenin asıl hâli AsilPOS deposunda (`RiosenBeq/lafpos`)
`docs/03-ENTEGRASYON.md` §3, §4 ve §4.1; bu belge panelin tarafıdır. Formüller, yuvarlama ve hangi toplamın hangi
gövde alanından geldiği iki depoda bayt bayt aynı olan [hesap sözleşmesinde](hesap-sozlesmesi.md) (liste değeri,
indirim, ciro dışı, KDV, banka POS komisyonu, tutarlılık; `tests/hesap-sozlesmesi.test.ts` belgenin özetini sabitler).

**Varsayılan kapalı (sahibin 26 Ekim kararı).** Kafede bugün ModPOS var. "AsilPOS'a geçiş günü" boşken AsilPOS'un
gönderdiği günler saklanır ama hiçbir hesaba, ekrana, göreve, hatırlatmaya, e-postaya ya da ön doldurmaya girmez;
yalnız Ayarlar'daki AsilPOS kartında "deneme" olarak görünür. Anahtar (`ASILPOS_SYNC_SECRET`) yokken altı uç da 503 döner
ve hiçbir şey yazılmaz. Açma sırası aşağıda, "Açılış sırası".

## Ad değişikliği (teknik)

26 Kasım 2026, sahibin kararı: kasanın adı **AsilPOS** oldu (26 Kasım 2026'ya kadar adı LafPOS); panelde ekran, belge, e-posta,
kod, dosya ve tablo adları yeni adla. Kurulu kasa, canlıdaki eski sürüm (yeni sürümün migration'ı derleme sırasında, eski sürüm hizmet verirken
çalışır) ve geri dönüş bozulmasın diye eski adlar okunmaya devam eder, yazılan değer eski addır; yazımın yeni ada
geçmesi sonraki temizlik PR'ının işidir. Eski adlar tek yerde: `src/lib/asilpos/eski-adlar.ts`
(`tests/asilpos-adi.test.ts` başka yerde eski ad bırakmaz).

- **Uçlar:** `POST /api/lafpos/kurulum` ve `GET /lafpos/indir/<kod>` kalıcı olarak kalır, yeni yollar
  `/api/asilpos/kurulum` ve `/asilpos/indir/<kod>` aynı işleyiciyi (ve aynı IP sınırını) kullanır; yeni bağlantılar
  yeni yolla gider. `/api/pos/*` ve `/api/panel/pos/*` hiç değişmedi.
- **Ortam:** `ASILPOS_SYNC_SECRET` (ve isteğe bağlı `ASILPOS_CLOUD_*`, `ASILPOS_SITE_*`, `ASILPOS_KURUCU_URL`) önce okunur,
  yoksa eski adı: `ASILPOS_*` yerine `LAFPOS_*` (`src/lib/asilpos/env.ts`); kartlar hangi adın tanımlı olduğunu söyler. Sahip
  Vercel'de yeni adları aynı değerlerle ekleyip yeniden yayınlar, kart yeni adı söyleyince eskileri siler.
- **Tel:** gövdenin `source`'u `"lafpos"` ya da `"asilpos"`, Pavo kıyasının kasa kartı `lafposCard` ya da `asilposCard`
  kabul edilir; devrin `nextOpening.source`'u ve kasaya giden Uzaktan anahtarları (`LAFPOS_CLOUD_URL`,
  `LAFPOS_CLOUD_SECRET`) eski adla gider (kurulu kasa yenisini tanımaz; `surum` özeti değişmez).
- **Veritabanı (migration 0098, yalnız genişletme):** `lafpos_installs` ve `lafpos_day_ends` yeni adına taşındı
  (`asilpos_installs`, `asilpos_day_ends`), eski adla görünüm (view) kaldı; `cash_outs.asilpos_id` ve
  `pos_daily_sales.asilpos_service` eklendi, tetikleyici eski sütunlarla eşit tutar; kasa kaynağının CHECK'i iki değeri
  de kabul eder. Saklanan değerler eski adla yazılır, okunurken yenisi de tanınır: `branches.pos_source` `'lafpos'`
  (ekranda AsilPOS), `pos_day_reports.source`, `integration_state` `'lafpos'`, `settings` `lafposGecisGunu`, şube ayarı
  `pos.lafpos`, `notification_log` önekleri (`lafpos-gun:` …), yazar adları `"LafPOS"` ve `LafPOS (otomatik)` (ekranda
  AsilPOS). Danışma kilitleri, kurulum kodunun şifreleme amacı (`lafpos-kurulum`) ve Resend'in yinelenme önekleri
  kalıcı olarak eski adla.
- **Kâğıt:** fotoğraf okuması iki adı da tanır (eski kasanın kâğıdı, banka kısmının `PAVO - LAFPOS KARŞILAŞTIRMA`
  başlığı yeni kasada da eski adla).
- Asistanın eski kartları (`lafpos` etkisi), eski araç adı (`lafpos_durumu`) ve Ayarlar'ın eski çapası (`#lafpos`)
  çalışır.

## İş bölümü (26 Ekim 2026)

AsilPOS, site (laffogato) ve bu panel tek işletme sisteminin üç parçasıdır (karar: asilpos
`docs/06-TEK-SISTEM.md`): ürünlerin tek kaynağı sitenin yönetim paneli, satışın ve kasanın kaynağı AsilPOS,
**maliyet, reçete, stok ve muhasebenin kaynağı bu panel**. AsilPOS maliyeti buradan okur
(`GET /api/panel/pos/urunler`), gün sonunu buraya iter (`POST /api/pos/gun`). Kasiyer AsilPOS'ta kör kasa
sayar (`kasa.rakam` yetkisi kapalı): beklenen tutarı ve farkı görmez; fark ve Z bu panelin Kasa raporuna gelir, orada
da yalnız yöneticiye görünür (personele kör; aşağıda "Gün sonu otomasyonu" › Kör kasa).

## Neden

AsilPOS, ModPOS'un yerine geçen kafe kasasıdır. Kafenin içindeki bir makinede çalışır ve internetten erişilemez; bu
yüzden panelin öteki bağlantılarındaki "imzalı ping, sonra imzalı çekme" burada yoktur. AsilPOS her iş gününü
kapanışta bir kez **iter**; gün sonradan düzeltilirse aynı günü yeniden gönderir (aynı gün, aynı Z no ile öncekinin
yerine geçer).
İnternet yoksa gönderim AsilPOS'un giden kutusunda bekler, sonra gider.

- Günün ürün satışı geçiş gününden itibaren aylık maliyet modeline girer ve ModPOS'un elle yüklenen aylık listesinin
  yerini alır: Satışlar, Tutarlılık, Ürünler, Analiz, Genel bakış, KDV tahmini, satış tahmini (aşağıda, "Günlük satış").
- Geçiş gününden itibaren günün Z özeti Kasa raporunda form açılırken kendiliğinden yazılır; personel yine bakıp
  gönderir, ModPOS'un Z'sini elle yazmaz. Gönderilmiş rapor AsilPOS'tan farklıysa kayıtlı rapor, e-posta, WhatsApp ve zil
  söyler; satışlı AsilPOS günü "Kafe kapalıydı"nın kanıtıdır.
- Geçiş gününden itibaren ödeme türleri kanal kanal Komisyon & hakediş'in satışı olur (yemek kartı ve platform başına
  gerçek oran ve beklenen hakediş; aşağıda, "Komisyon"); ikram AsilPOS'ta işaretlenir, kayıtlı tüketime ve kasa
  e-postasına oradan girer (aşağıda, "İkram").
- Panel AsilPOS'a ürünlerin reçete maliyetini verir (patronun kârlılık ekranı için; personel görmez).

## Nasıl çalışır

```
AsilPOS (kafede)                                  ladmin.laffogato.net (bu panel)
───────────────                                  ──────────────────────────────
gün sonu (ve düzeltme)
  └─ giden kutusu: POST /api/pos/gun  ────────▶  anahtar → boyut → imza → gövde
     {version, source, date, z, lines,             └─ tek işlem, günün danışma kilidi:
      ikram, payments} (imzalı)                        ├─ kayıtlı Z no başkaysa: 409, hiçbir şey yazılmaz
                                                       ├─ pos_day_reports: günün özeti (yenisi eskisinin yerine)
                                                       ├─ pos_daily_sales: günün satırları silinir, yenisi yazılır
                                                       └─ cash_outs: kasa hareketleri satır satır (Faz 3, sayılan gün)
     ◀── 200 {ok, date, lines, matched, unmatched, counted, switchDay, nextOpening, staff?} · 400 {error, field} · 409 {error, date, zNo} · 409 {error: "wrong_branch", sube, expected} · 401 · 413 · 503
                                                    └─ sonuç integration_state › asilpos'a (Ayarlar › AsilPOS kartı)

GET /api/panel/pos/urunler (imzalı)  ─────────▶  maliyet modelinden siteye bağlı ürünler
     ◀── {version: 1, now, items: [{siteMenuId, slot, name, size, costMinor, active}]}

GET /api/panel/pos/modpos-gunler?sube=marina  ─▶  geçiş gününden önceki ModPOS günleri (kasa raporu, föy) ve
    (imzalı; günde en çok bir kez)                 dönemin ModPOS ürün listesi; hiçbir şey yazılmaz
     ◀── {version: 1, now, sube, switchDay, days, urunler} · 400 {error, field} · 409 {error: "wrong_branch", sube, expected} · 401 · 503
GET /api/panel/pos/devir?date= (imzalı) ──────▶  günün Kasa raporu ya da AsilPOS'un sayımı (Faz 3)
     ◀── {version: 1, date, nextOpening: {amount, source} | null}
GET /api/panel/pos/gider-kategorileri (imzalı) ▶  personelin seçebildiği gider kategorileri (Faz 3)
     ◀── {version: 1, now, items: [{id, name, section}]}
GET /api/panel/pos/personel?sube=marina ──────▶  şubenin bu ay / geçen ay maaş satırları (LM-4b; bağlantı ekranı isteyince)
     ◀── {version: 1, now, sube, items: [{ref, name, active, account}]} · 400 {error, field} · 409 {error: "wrong_branch", sube, expected} · 401 · 503
```

### Gün sonu: `POST /api/pos/gun`

Gövde katı JSON, en çok 256 KB. Tutarlar TL (iki ondalık; fazlası yuvarlanır), ciro ve menü değeri KDV dahil:

| Alan | İçerik |
|------|--------|
| `version` | `1`; başka sürüm reddedilir |
| `source` | `"asilpos"` |
| `sube` | İsteğe bağlı: kasanın şube kimliği (2-24 karakter, küçük harfle başlar: harf, rakam, tire); AsilPOS'un şubesi (kütükten; bugün `marina`) değilse gün yazılmaz, 409 `wrong_branch` (aşağıda "Şubeler"). Eski kasa göndermez |
| `date` | İş günü `YYYY-MM-DD` (gün 05:00'te döner, Kasa raporuyla aynı kural); bugünün iş gününden sonrası reddedilir |
| `z` | `zNo`, `receipts`, `zTotal`, `cash`, `card`, `mealCard`, `online`, `other`, `offRevenue`, `discounts`, `openingCash`, `cashOut` (harcama), `countedCash` (sayılmadıysa `null`), `handedOver` (gün içindeki teslim), `cashDiff` (`null` olabilir); isteğe bağlı (yazılmayabilir ya da `null`): `cashIn` (≥ 0; nakit satış dışında çekmeceye giren: giriş, nakit müşteri tahsilatı ve nakit bahşiş; yoksa 0 sayılır; Kasa raporunda "Gün içinde kasaya giren"), `expectedCash` (AsilPOS'un olması gereken nakdi), `cardTips` ve `cardCollections` (kartla bahşiş ve kartla cari tahsilatı; aşağıda "Kart") |
| `lines[]` | `posName`, `siteMenuId` (`null` olabilir), `slot` (`"M"`, `"L"` ya da `null`), `qty`, `revenue`, `isService`; bir POS adı günde bir kez |
| `ikram[]` | `posName`, `siteMenuId`, `slot`, `qty`, `menuValue`, `reason` (en çok 200 karakteri saklanır) |
| `payments[]` | `name`, `zField` (`cash`, `card`, `meal_card`, `online`, `other`), `channel` (komisyon anahtarı: `pluxee`, `multinet`, `edenred`, `setcard`, `metropol`, `yemeksepeti`…; `null` olabilir), `count`, `amount` |
| `bankPos` | İsteğe bağlı: Pavo'nun banka gün sonu ve AsilPOS kıyası (`status`, `batchNo`, `at`, `pavoCard`, `lafposCard`, `diff`, `acquirers[]`, `message`; Faz 2: `errorCode`, cihazın hata kodu, ör. `"5085"`, alındıysa `null`; aşağıda "Pavo – AsilPOS kart karşılaştırması"). Okunamazsa gün yine yazılır |
| `bankPosPending` | İsteğe bağlı (AsilPOS, 25 Kasım 2026): Pavo'nun banka gün sonu bu gün için sürüyor ya da birazdan başlayacak mı. `false` gün sonu e-postası Pavo'yu beklemez, `true` en çok 2 dakika bekler ("Pavo'yu bekler"); yoksa önceki günün sonucuna bakılır. Okunamazsa yok sayılır |
| `revision` | Faz 2: bu tarihin kaçıncı gönderimi (1'den; AsilPOS'tan 200 almış gönderimler + 1). `pos_day_reports.revision` ve sürüm geçmişi |
| `correction` | Faz 2: `{ kind: "reopen" \| "recount", reason }`, yalnız düzeltmeden sonraki ilk kabul edilen gövdede (gün yeniden açıldı ya da kapandıktan sonra sayım değişti); sonraki gönderim (Pavo sonucu) taşımaz, kayıtlı düzeltme silinmez |
| `offDevice` | Faz 2: `{ card, cash }`, mali fişi yazarkasada kesilmeyen satış ödemeleri (bahşiş hariç) |
| `refunds[]` | Faz 2: `amount`, `zField`, `name` (ödeme türünün adı, kişi değil), `channel`, `reason` (200 karakter); günün iptal edilen ödemeleri, en çok 2000 |
| `iptal[]` | Faz 2: `posName`, `siteMenuId`, `slot`, `qty`, `listValue`, `prepared`, `reason` (200 karakter), `refund`; günün iptal edilen kalemleri (ana ürün ve ek ayrı parça, satırla aynı ad), en çok 2000. Hazırlanmış (`prepared`) iptal zayi tüketimidir (aşağıda "Faz 2 alanları") |
| `z` (Faz 2) | `listValue` (liste değeri: satılan + ikram + ödenmez, servis dahil, zayi hariç), `ikramTotal`, `odenmezTotal`, `zayiTotal` (türe göre liste değeri), `vat[]` (`{ rate, base, vat }`, günün KDV dökümü), `openedAt`, `closedAt` (ISO), `okcZNo` (yazarkasanın mali Z no'su, metin; yoksa `null`) |
| `lines[]` (Faz 2) | `gross` (indirimden önceki liste değeri; Σ(`gross` − `revenue`) = `z.discounts`), `isAddon` (birleşen satırda ek parçası var), `listPrices` (şube fiyatı, 24 Kasım 2026: satılan parçaların dondurulan liste birim fiyatları ve adetleri, en çok 20) |
| `ikram[]` (Faz 2) | `kind` (`ikram`, `odenmez`, `zayi`), `personKind` (yalnız ödenmezde: `personel`, `musteri`, `patron`; yoksa `null`) |
| `z` (Faz 3) | `expectedOpening` (açılışta beklenen nakit, önceki gerçek günün devri; bilinmiyorsa `null`), `openingDiff` (açılış − beklenen, **işaretli**; beklenen yoksa `null`), `openingReason` (farkın nedeni, en çok 200 karakter; yoksa `null`). Aşağıda "Faz 3: kasa zinciri" |
| `cashMoves[]` | Faz 3: `id` (hareketin ULID'i, 26 karakter Crockford base32; aynı gün yeniden gönderilince aynı), `kind` (`harcama`, `teslim`, `giris`), `amount` (> 0), `description` (en çok 200, boş olabilir), `at` (ISO; takvimde olan an, "…T25:99" listeyi düşürür), `categoryId` (harcamanın panel gider kategorisi ya da `null`), `recipient` (25 Kasım 2026; yalnız teslimde ve yazılmışsa: paranın verildiği kişi ya da yer, yalnız ad; satırın "Kime"si olur, en çok 60; bozuk gelen yalnız bu alanı düşürür); günün kasa hareketleri yazıldığı sırayla, hareketsiz günde `[]`, en çok 2000; aynı kimlik iki kez geçemez. Hareketi yazan kişi gelmez. Harcama ve teslim "Kasadan çıkanlar"a satır olur, giriş olmaz (aşağıda "Kasadan çıkanlar AsilPOS'tan") |

- **Beyaz liste.** Yalnız tablodaki alanlar okunur ve saklanır; bilinmeyen alan atılır (müşteri ya da personel adı
  gelse de yazılmaz). Her alan yazılmalıdır (sonradan gelen `sube`, `bankPos`, `z.cashIn`, `z.expectedCash`,
  `z.cardTips`, `z.cardCollections`, Faz 2 ve Faz 3 alanları dışında: eski AsilPOS göndermez, gövdesi yine geçer); boş
  olabilenler `null` gelir. **Faz 2 ve Faz 3 alanları hiçbir zaman 400 almaz** (`src/lib/asilpos/day.ts` › `soft`: `.optional()`
  ve `.catch(undefined)`): bozuk gelen alan yazılmaz, gün yazılır, günlüğe `[asilpos] okunamayan alanlar yazılmadı`
  düşer (400 AsilPOS'ta kalıcıdır; saklanan jsonb aynı şemayla yeniden okunduğu için zorunlu alan eski günleri sessizce
  düşürürdü). Ortak örnekler: altın gövde `tests/fixtures/asilpos-gun.golden.json` ve kabul günü
  `tests/fixtures/kabul-gunu-2026-11-22.json` (ikisi de AsilPOS'taki aynı adlı / karşılığı dosyanın bayt bayt kopyası).
- **Denetim sırası:** anahtar yoksa `503 {"error":"not_configured"}`; gövde 256 KB'tan büyükse
  `413 {"error":"too_large"}`; imza yok, yanlış ya da 5 dakikadan eski / ileriyse `401 {"error":"unauthorized"}`
  (ayrıntı verilmez); gövde sözleşmeye uymazsa `400 {"error":"invalid","field":"lines.3.qty"}` (ilk sorunlu alanın
  yolu; gövde okunamazsa `body`); o güne panelde başka bir Z no ile yazılmış gün sonu varsa
  `409 {"error":"z_conflict","date":"2026-10-26","zNo":127}` (`zNo` paneldeki Z'nin numarası). Yazılınca
  `200 {"ok":true,"date":"2026-10-26","lines":42,"matched":40,"unmatched":["PUMPKIN CHAI LATTE"],"counted":false,"switchDay":null,"nextOpening":null}`:
  `matched` ürüne ya da hizmete bağlanan satır sayısı, `unmatched` ürüne bağlanamayan POS adları (çok satılan önce, en
  çok 50; AsilPOS bağlantı ekranında gösterebilir), `counted` günün hesaplara girip girmediği (gün geçiş gününden önce
  değilse `true`), `switchDay` paneldeki geçiş günü (`null`: seçilmedi, kasa ModPOS). AsilPOS (#159'dan beri) 200'ü
  yalnız gövdede `ok: true` ve gönderdiği `date` varsa gönderildi sayar; yoksa (araya giren bir giriş ya da bakım
  sayfası) günü gönderilmiş işaretlemez, yeniden dener. Bu iki alan kaldırılmaz; ötekileri durum ekranı için okur,
  eski AsilPOS onları görmez. Faz 2 alanları (aşağıda) 200'ün gövdesini değiştirmez; 200 yalnız kabul edilen gövdenin
  yazıldığını ve sürüm geçmişine girdiğini söyler. Faz 3'ten (23 Kasım 2026) 200 `nextOpening`'i de taşır: ertesi
  günün beklenen açılışı (`{ "amount": 1279.5, "source": "kasa_raporu" | "asilpos" }`, TL) ya da `null` (aşağıda "Faz 3:
  kasa zinciri"); okunamazsa alan yazılmaz, yanıt yine 200. Veritabanı yazamazsa
  `500 {"error":"server_error"}` (AsilPOS yeniden dener). Reddedilen istek gün sonundan hiçbir şey yazmaz; sonucu
  yalnız durum satırına düşer (aşağıda, "Durum ve onarım").
- **Aynı gün aynı Z no ile yeniden gelince** (düzeltme ya da yeniden deneme) tek işlemde günün özeti yenisiyle
  değişir, satırları silinip yenisi yazılır; öteki günlere dokunulmaz. Aynı anda iki gönderim günün danışma kilidinde
  (`pg_advisory_xact_lock(hashtext('lafpos-gun:<şube>:<gün>'))`, şube `marina`) sırayla yazılır, biri bütünüyle kalır.
  Kabul edilen her gövde sürüm geçmişine bir satır yazar (aşağıda "Sürüm geçmişi").
- **Aynı gün başka bir Z no ile gelirse** öncekinin yerine geçmez (önceki Z'yi ve günün satırlarını sessizce silerdi):
  kilidin altında kayıtlı Z no'ya bakılır, farklıysa `409 z_conflict`, hiçbir şey yazılmaz. AsilPOS da aynı tarihle iki
  gün açmaz; bu ikinci kilittir.
- **Ürün** satır satır bulunur (`src/lib/asilpos/day.ts` › `resolvePosLine`): AsilPOS'un hizmet satırı (karaoke) ürüne
  bağlanmaz; sonra sitenin kalemi ve boyu (`products.site_menu_id` + `site_menu_slot`, [SITE-MENU.md](SITE-MENU.md));
  bulunmazsa POS adı eşleştirmesi (`pos_mappings`, `posMatchKey`: büyük / küçük harf ve I / İ farkı yok; ModPOS'tan
  öğrenilmiş eşleştirmeler ve HİZMET işareti çalışmaya devam eder). Hiçbiri yoksa satır ürünsüz kalır; sitenin kalemi
  ve boyu satırla saklanır. **Sonradan bağlama** (denetim E-33, `src/server/asilpos/rematch.ts`): ürün Ürünler › Site
  menüsü'nde o kaleme bağlanınca ya da POS adı bir ürüne eşleştirilince (Satışlar'ın ModPOS ya da AsilPOS satırı,
  Ayarlar › AsilPOS › **Bağla**) o kalemle ya da adla (posMatchKey) gelmiş ürünsüz satırlar, AsilPOS günü yeniden
  göndermeden bağlanır. Bağlı satırın ürünü bu yolla değişmez (Satışlar'da bir ayın adla bağlanmış AsilPOS satırının
  ürünü elle değiştirilir, aşağıda). AsilPOS'un hizmet işaretiyle ya da sitenin bağlı kalemiyle gelen satır her gün
  sonunda (düzeltme gönderimi dahil) yine öyle yazılır; bu yüzden Satışlar'da başka ürüne bağlanmaz, eylem düzeltmenin
  yerini söyler (Ürünler › Site menüsü ya da AsilPOS'taki hizmet işareti).
- **Saklanan:** `pos_daily_sales` (gün, şube, POS adı, ürün, sitenin kalemi ve boyu, adet, ciro, Faz 2'den brüt ve ek
  işareti, hizmet; `(date, branch_id, pos_name)` benzersiz) ve `pos_day_reports` (gün ve şube başına bir satır: `z`,
  `payments`, `ikram`, `bank_pos`, Faz 2'den `off_device`, `refunds`, `iptal`, `correction`, `revision`, Faz 3'ten
  `cash_moves`; `source`, `received_at`). Faz 2'nin migration'ı `drizzle/0070_lafpos_gun_alanlari.sql` (yalnız ekleme:
  `pos_day_revisions` tablosu, boş olabilen ya da varsayılanlı sütunlar; eski satırlarda boş, gün yeniden gönderilince
  dolar). Faz 3'ün migration'ı `drizzle/0071_kasa_zinciri.sql` (yalnız ekleme: `cash_outs.asilpos_id text` ve benzersiz
  `cash_outs_asilpos_uq`, `pos_day_reports.cash_moves jsonb`; ikisi de boş olabilir, var olan satırlarda boş).
  Migration'lar `drizzle/0040_lafpos_baglantisi.sql` (iki yeni tablo), `drizzle/0041_kasaya_giren.sql` (Kasa raporunun
  "Gün içinde kasaya giren"i: `cash_reports.cash_in double precision NOT NULL DEFAULT 0`; var olan raporlar 0) ve
  `drizzle/0044_lafpos_satir_site_kalemi.sql` (satırın sitedeki kalemi ve boyu: `pos_daily_sales.site_menu_id`, `slot`,
  boş olabilen iki sütun, ve AsilPOS'un hizmet işareti `asilpos_service boolean NOT NULL DEFAULT false`; yalnız ekleme;
  eski satırlarda boş / false, sonradan bağlama onlarda yalnız POS adıyla çalışır, gün yeniden gönderilince dolar). 0040 26 Eki 2026'da
  canlıya uygulandı; yeniden üretilmez (`tests/migrations.test.ts` günlükteki zamanını kilitler). Yalnız ekleme: Instant Rollback'te
  eski kod sütunu okumaz, yazdığı raporda 0 kalır; yalnız girenli bir raporun olması gerekenini eski kod girensiz
  hesaplar (giren kadar fazla görünür), düzeltme ileri yayınlanır.

### Faz 2 alanları (23 Kasım 2026)

AsilPOS LP-A'nın gönderdiği alanlar (AsilPOS `docs/03-ENTEGRASYON.md` §4 "Faz 2 alanları"; formüller
[hesap sözleşmesi](hesap-sozlesmesi.md)). Hepsi isteğe bağlıdır; eski AsilPOS'un gününde alan yoktur, okuyan yer
bugünkü gibi davranır.

| Alan | Nerede kullanılır |
|------|-------------------|
| `lines[].listPrices` | `pos_daily_sales.list_prices` (`[{price, qty}]`; hizmet satırında ve eski AsilPOS'ta null). Bozuk alan yok sayılır, gün reddedilmez. Fiyatlar › Eski fiyattan satılanlar ve şube fiyatı değişikliğinin durumu (Bekliyor / Uygulandı · gün / Uygulanmadı / Bilinmiyor) yalnız buradan okunur; `revenue / qty` liste fiyatı değildir ([FIYATLAR.md](FIYATLAR.md) › Şube fiyatı) |
| `lines[].gross`, `isAddon` | `pos_daily_sales.gross`, `is_addon`. Satışlar'da **Brüt** (indirimden önce) ve **İndirimli** (indirimden sonra) ayrı sütun (`src/app/panel/satislar/sales-logic.ts` › `discountColumns`; "net" orada KDV hariç demek, bu değil): ModPOS listesinin satırı indirimden öncedir (İndirimli "–"), AsilPOS satırı ikisini de taşır. Ek parçası olan AsilPOS satırı "· ek" der |
| `z.vat[]` | AsilPOS gününün KDV'si buradan, yeniden hesaplanmaz: Gelir-gider'in AYLIK CİRO (KDV hariç)'i ve KDV tahmini (`engine.ts` › `posNet`). AsilPOS'un şubesinin ayında KDV gün gün: dökümü günün cirosunu tutan AsilPOS günü dökümüyle, öteki günler (ModPOS günleri, dökümsüz eski AsilPOS günü, raporu elle değişmiş gün) günün oranıyla (satış KDV'si, %10) ayrı ayrı yuvarlanır, ay günlerin toplamıdır (Marina Kasım: 30.576,15; ay toplamından 30.576,14 olurdu). Öteki şubelerin günleri ve elle yazılan ciro bugünkü gibi ay toplamından (`src/lib/cash-month.ts` › `dayVatOf`, `TillMonth.dayVat`). Açıklamalar da gün gün hesabı yazar: Genel bakış dökümü, Gelir-gider satırının ipucu ve MCP'nin ay cevabı (`src/lib/mcp/answers/month.ts`) |
| `z.listValue`, `ikramTotal`, `odenmezTotal`, `zayiTotal` | Kasa e-postasının ikram denetimi (`asilposIkramCheck`, girdisi `asilposZKinds`): tür tür (AsilPOS'un Z'sindeki toplam ikram listesindekiyle; ikram, ödenmez, zayi ayrı), AsilPOS'un kendi toplamları ödenmez tutarıyla, `listValue` geldiyse Z'nin kendi eşitliği (toplam satış = liste − indirim − ikram − ödenmez; tutmuyorsa "AsilPOS'un Z'si kendi içinde tutmuyor: liste 7.425 ₺ − … = 6.270 ₺, toplam satış 6.285 ₺ (15 ₺ fazla)."). Türe göre toplamları yollamayan AsilPOS'ta tek karşılaştırma |
| `z.okcZNo` | Kasa raporunun **Yazarkasa Z no**'suna otomatik yazılır (`AUTO_FIELDS`; AsilPOS'un Z no'sundan ayrı alan, `okc_z_no`). Elle ya da fotoğrafla girilen Z no ezilmez; gelmezse (`null`: Pavo satış sonucunda Z yok) kayıtlı değer kalır. Değişince yazarkasa kümülatifi yeniden hesaplanır |
| `z.openedAt`, `closedAt` | Saklanır (`z` jsonb); bugün okuyan yok |
| `ikram[].kind`, `personKind` | Tür nedenin ön ekinden önce gelir (`asilposLineKind`, `asilposCompKind`); ödenmezin kişi türü Zayi & ikram'da yöneticiye parantezde ("Ödenmez: Deneme (patron)"). "Deneme" ödenmezi sahibin kararıyla ürün denemesidir: tüketimdir, raporda kalır |
| `iptal[]` | **Hazırlanmış iptal zayi tüketimidir**: AsilPOS'un ikram / zayi okuma yolundan (`loadAsilposIkram` → `iptalWasteLines`, neden "İptal (hazırlanmıştı)", iptal nedeni ayrıca), Tutarlılık'ın kayıtlı tüketimine, Tahmini stoğa ve Zayi'nin gününe girer; `waste_entries`'e yazılmaz (gün her gönderimde yeniden okunur, yeniden gönderim çift saymaz). Ödenmez tutarına girmez: kasa e-postasının ikram denetimine ve Onaylar'daki geç ikram kartının Z kıyasına katılmaz (`recordedOffRevenue`). Hazırlanmamış iptal yalnız bilgi (kasa e-postası, gün görünümü). Kalem iadesi (`refund`) hazırlanmışsa o da zayidir |
| `offDevice`, `refunds[]` | Yöneticinin Kasa gün görünümü (**AsilPOS gün sonu ayrıntısı** kartı, `src/app/panel/kasa/asilpos-day-card.tsx`) ve gün sonu e-postası: yazarkasadan geçmeyen kart ve nakit, iptal edilen ödemeler (sayı, toplam, tek tek tür ve neden). `offDevice` (`pos_day_reports.off_device`) kasa raporunun yazarkasa ve banka karşılaştırmalarına da girer: aşağıda "Kart: yazarkasadan geçmeyen ödeme" |
| `bankPos.errorCode` | Pavo kartında ve e-postasında "Hata kodu" satırı ve başlığın parantezi (`pavoView`) |
| `revision`, `correction` | `pos_day_reports.revision`, `correction` ve sürüm geçmişi; gün görünümü kaç kez gönderildiğini ve düzeltmenin nedenini, gün sonu e-postası "Düzeltildi: gün yeniden açıldı (…)" yazar |

**Satışlar'ın tutarlılık denetimi** (`src/lib/asilpos/sales.ts` › `asilposMonthNotes` `checks`): AsilPOS gününün ürün
satırları toplamı Z'yi tutmalı (Σ ciro = `zTotal`; tutmayan gün uyarı, satır eksik gelmiş olabilir); geçiş ayında ModPOS
listesi − listenin günlerinin indirimi = Z (Marina: 29.415,00 − 2.066,25 = 27.348,75; tutmayan fark bilgi satırı, %5'i
aşan fark eskisi gibi uyarı). Tutan denetimler bandın altında tek satır.

**Sürüm geçmişi** (`pos_day_revisions`): kabul edilen (200) her gövde okunmuş hâliyle, geliş sırasıyla (gün, şube,
AsilPOS'un sırası, Z no, düzeltme, gövde, an), gün sonunun yazımıyla aynı işlemde. `pos_day_reports` günün son hâlidir;
öncekiler burada kalır. Reddedilen gövde yazılmaz. **Günün kaydını silmek (409'un çözümü, `removeAsilposDay`) geçmişi
silmez**: silinen Z'nin gövdeleri denetim için kalır, sonra gelen yeni Z'nin gövdeleri aynı güne eklenir. Şube silinmeden
önce sayılır (`branchUsageCount`). Gövde kişisel veri taşımaz (beyaz liste). Büyüklük: günde birkaç gövde, gövde
çoğunlukla 30 KB'ın altında; temizlik işi yok (gerekirse ayrı iş).

### Faz 3: kasa zinciri (23 Kasım 2026)

AsilPOS LP-B'nin alanları ve iki okuması (AsilPOS `docs/03-ENTEGRASYON.md` §4 "Faz 3 alanları", §4.6, §4.7). Sahibin
kararı (Faz 3, karar 3): gün açılırken çekmecedeki nakit önceki günün devriyle karşılaştırılır, fark varsa kasiyer nedenini
yazar; kasadan çıkan para panelin "Kasadan çıkanlar"ına satır satır gelir (aşağıda; "Soru 5" yanıtlandı).

**Devir (`nextOpening`).** Panel devri saklamaz: bir günün devri o günün Kasa raporunun sayılan − teslim edilenidir
(`computeCash.carryOver`; ertesi günün formu açılışı ondan doldurur). Kural `src/lib/asilpos/devir.ts` › `nextOpeningOf`,
okuması `src/server/asilpos/devir.ts` › `asilposNextOpening`:

- Gün AsilPOS'un şubesinin sayılan günü değilse (geçiş gününden önce, deneme) `null`.
- Günün (tarih, Marina) Kasa raporu varsa `{ amount: sayılan − teslim, source: "kasa_raporu" }`. Rapor AsilPOS'un **elle
  değişmemiş otomatik raporuysa** (`asilpos_day_ends` raporu gösteriyor ve otomatik değerleri duruyor) sayılan ve teslim
  gelen gövdeden, otomatik raporun birleştirme kuralıyla (`mergeAuto`: alan son otomatik değerindeyse yenisi, kişinin
  düzelttiği alan kalır, yeni sayım boşsa kayıtlı kalır; teslim otomatik raporda hep 0). Sebebi: otomatik rapor
  yanıttan **sonra** yazılır (`after()`); kayıtlı rapor önceki gönderimin sayımını taşır ve yeniden sayımın (ya da
  yeniden açılıp kapanan günün) yanıtı eski sayımı `kasa_raporu` diye yankılardı. Kişinin yazdığı ya da düzelttiği
  rapor hep geçer. Teslim sayılandan büyükse (rapor tutarsız; ör. kişinin yazdığı teslim ile birleştirmenin gövdeden
  aldığı yeni sayım) `null`: eksi devir gönderilmez (AsilPOS'ta tutar ≥ 0, eksi değer yanıtı okunamaz yapardı), AsilPOS
  kendi sayımına döner; rapor düzeltilince doğru devir gelir.
- Rapor yoksa gövdenin sayımı `{ amount: z.countedCash, source: "asilpos" }`; sayılmadan kapanan günde `null`.

`POST /api/pos/gun`'un 200'ü (`handlePosDay`, gün yazıldıktan sonra; `receivePosDay`'in gövdesi değişmez) ve imzalı
`GET /api/panel/pos/devir?date=YYYY-MM-DD` aynı nesneyi döner:

```json
{ "version": 1, "date": "2026-11-22", "nextOpening": { "amount": 1279.5, "source": "kasa_raporu" } }
```

Anahtar ve imza maliyet ucuyla aynı (sorgu imzaya girer), `Cache-Control: no-store`; gün takvimde yoksa
`400 {"error":"invalid","field":"date"}`, gelmemiş gün `null`. AsilPOS gün kapalıyken, devrin günü varken ve en sık 5
dakikada bir sorar (gece ve gün açıkken hiç). Kabul günü: 22 Kasım'ın devri, yani 23 Kasım'ın beklenen açılışı
**1.279,50** (`tests/kabul-gunu-db.test.ts`).

**Açılışın farkı ve nedeni** (`z.expectedOpening`, `z.openingDiff`, `z.openingReason`): `z` jsonb'de saklanır.
Otomatik raporun notuna yazılır (`asilposOpeningNote`): panelin kendi devir denetimi (önceki raporun devri) tutmadıysa
onun cümlesine "Neden (AsilPOS): …" eklenir; panelde önceki rapor yoksa AsilPOS'un farkı ve nedeni ("Açılış AsilPOS'ta
beklenenden 20,50 ₺ fazla (beklenen 1.279,50 ₺); neden: …"); farksız, nedensiz açılışta not değişmez. Yöneticinin gün
görünümü (**AsilPOS gün sonu ayrıntısı**) ve gün sonu e-postası **Kasa açılışı (AsilPOS)** bölümünü yazar (beklenen,
işaretli fark, neden; beklenen bilinmiyorsa "bilinmiyor"). Üç anahtar gün sonu e-postasının özetine (`dayHash`) girmez:
gün açılırken bir kez yazılır, yükseltmeden sonra yeniden gelen gün "Düzeltildi" demez.

**Gider kategorileri:** imzalı `GET /api/panel/pos/gider-kategorileri` (`src/server/asilpos/categories.ts`):

```json
{ "version": 1, "now": "2026-11-23T09:00:00.000Z", "items": [{ "id": 3, "name": "Diğer fatura dışı", "section": "genel" }] }
```

Yalnız personelin seçebildiği kategoriler (Kasa'nın personel listesiyle aynı kural, `staffCategory`: etkin, alım ya da
genel gider, "diğer" grubu), panelin sırasıyla; tutar, grup ve ayar gitmez. AsilPOS harcama penceresinde çip olarak
gösterir, en sık 5 dakikada bir sorar, çekemezse son listeyi kullanır; harcamaya bu listenin kimliğini (`categoryId`)
yazar.

#### Kasadan çıkanlar AsilPOS'tan (Soru 5 yanıtlandı)

Gövdenin `cashMoves[]`'ı AsilPOS'un şubesinin **sayılan** gününde (geçiş gününden önce değil) ve gövde listeyi taşıyorsa
"Kasadan çıkanlar"a (`cash_outs`) yazılır, gün sonunun işleminde ve kilidinde (`src/server/asilpos/cash-moves.ts`, planı
saf: `src/lib/asilpos/cash-moves.ts` › `planAsilposCashOuts`):

- **Harcama ve teslim satır olur, giriş olmaz** (tablo kasadan çıkanı tutar; giren Kasa raporunda `cashIn`, gün
  görünümünde **Kasa hareketleri (AsilPOS)**: harcama, teslim, giriş sayı ve toplamla). Satır: şube Marina, gönderen
  "AsilPOS" (kişi adı yazılmaz), saat hareketin anı, belge "yok", açıklama AsilPOS'un, `asilpos_id` hareketin kimliği
  (benzersiz).
- **Teslimin "Kime"si AsilPOS'tan** (25 Kasım 2026, sahibin isteği "teslim edilirken kime olduğu yazılsın"): AsilPOS'ta
  teslimde alıcı zorunlu (patron ya da müdür hesabı, Banka ya da elle yazılan ad); gövdede `recipient` olarak gelir,
  satırın "Kime"sine (`store`; listede "Teslim · Patron") yazılır (`asilposRecipient`, en çok 60 karakter). Kime'si boş
  sahiplenilen elle satır ve alıcıyı okumayan sürümün yazdığı AsilPOS teslimi de yeniden gönderimde dolar
  (`planAsilposRecipientFill`); panelde yazılmış Kime'ye dokunulmaz. Alıcısız eski AsilPOS teslimi Kime'siz kalır.
- **Aylık harcamalar:** harcamanın `categoryId`'si personelin seçebildiği bir kategoriyse kayıt da açılır (personelin
  fişsiz alışverişinin kuralı; nakit, "Kasadan · gün", şube Marina). Kategorisiz ya da yöneticinin kategorisindeki
  harcama yalnız satır olur; kategoriyi panelde personel (satırı düzeltince kategori sorulur, kayıt açılır) ya da
  yönetici seçer. Personelin bu kuralı yalnız **kategorisini bekleyen AsilPOS harcamasında** geçer
  (`asilposAwaitingCategory`, satırla pencereye gelir): AsilPOS'un açtığı, kaydı olmayan ve saklı gövdede personelin
  kategorisiyle gelmeyen harcama. Personelin kategorisiyle gelen harcamanın kaydı eşitlemede açılmıştı: yönetici
  kaldırdıysa (ör. tedarikçinin faturasından sayılıyor) personelin düzeltmesi onu geri getirmez; sahiplenilen elle
  satır elle satırın kuralındadır (faturalı satırın faturası beklenmiyorsa fişe düzeltilince kayıt açılmaz).
- **Yeniden gönderim eklemez:** aynı kimlikli satır yerinde kalır; AsilPOS'un alanı (tutar, tür) değiştiyse yeniden
  yazılır, panelde yazılanlar (yer, belge, fotoğraf, kategori, açıklama) kalır.
- **Elle girilmiş eş sahiplenilir (iki kez sayılmaz):** aynı gün ve şubede, aynı tür ve aynı tutarda (kuruşta),
  AsilPOS'a bağlanmamış satır bire bir sahiplenilir, en eskisi önce; yalnız kimlik yazılır, fotoğrafı, yeri, belgesi,
  kategorisi ve tedarikçi bağı kalır. Satırı bir tedarikçi ödemesi açtıysa artık AsilPOS'undur (ödeme silinince satır
  kalır). Tutmayan elle satır olduğu gibi kalır; formun bilgi satırı onu "Panelde X fazla" diye söyler.
- **Gövdede olmayan AsilPOS satırı kalkar** (bağlı harcama kaydıyla); bir tedarikçi ödemesine bağlıysa silinmez, AsilPOS
  bağı çözülür (satır elle girilmiş gibi kalır). Elle girilen satıra dokunulmaz.
- **Eski AsilPOS** (alan yok) ve **okunamayan liste** (bozuk tek hareket, takvimde olmayan an dahil, bütün listeyi
  düşürür, günlüğe yazılır) satırlara dokunmaz; **deneme günü** yazmaz.
- **Gün sayılmaz olunca satırlar AsilPOS'tan ayrılır** (`detachAsilposCashOuts`, planı `planAsilposDetach`; kilitli satır
  kalıp silinemez olmasın, sayılmayan gün Kasadan çıkanlar'ı beslemesin): geçiş günü sonraya alınıp gün deneme olunca
  o günün her gönderimi ve deneme gününün **AsilPOS kaydını sil**'i AsilPOS'un açtığı satırı (harcama kaydıyla)
  kaldırır; sahiplenilen elle satır ve tedarikçi ödemesine bağlı satır kalır, bağı çözülür (elle girilmiş gibi:
  yönetici düzeltir ya da siler). Sayılan günün kaydı silinince (409'un çözümü) satırların hepsi kalır, bağları
  çözülür; yeni Z gelince elle girilmiş eş olarak yeniden sahiplenilir (panelde yazılanlar kalır, kayıt bir kez).
  İşlem geçmişine "Kasadan çıkanlar (AsilPOS)" düşer.
- **Kilit:** AsilPOS satırının tutarı, türü ve günü AsilPOS'undur (`asilposCashOutChange`): personel de yönetici de
  değiştiremez ("Bu satır AsilPOS'un kasa hareketinden geldi: …"), satır silinmez (gün yeniden gönderilince geri
  gelirdi; deneme günüyse günün AsilPOS kaydı silinince kalkar), personel istek de açamaz; tedarikçi ödemesi bağlı satırın tutarını ya da gününü değiştiremez, AsilPOS
  alışverişi "Ödemeye çevir"le Teslim'e çevrilmez. Fiş fotoğrafı (onaysız "Fiş fotoğrafı ekle"), yer, belge, açıklama
  ve kategori panelden eklenir. Kasa kartında satır "AsilPOS" rozetini, pencerede "AsilPOS'tan geldi" notunu taşır, tutar
  salt okunur, Sil düğmesi yoktur.
- **Personel AsilPOS gününe satır eklemez** (sahibin kararı, 24 Kasım 2026: "sadece gün sonu ladmin'e personel foto
  atsın"; saf kural `staffAsilposEntryClosed`): AsilPOS'un şubesinde geçiş gününden itibaren Kasa sayfasında personelin
  "Fiş ekle / Fişsiz ekle" ve "Zayi / ikram ekle" düğmelerinin yerinde "AsilPOS günü: harcama ve ikram/zayi AsilPOS'tan
  girilir" yazar (geç rapor görünümünde de). Sunucu: personelin ekleme yolu (doğrudan, ekleme isteği, satırı başka güne
  taşıma) `staffCashOutGate`'te reddedilir, "Eski bir güne ekle" AsilPOS günlerini göstermez; silinenin "Geri al"ı yeni
  satır sayılmaz. Gelen satıra fiş fotoğrafı ve kategori eklenir; yönetici her zaman ekler; Tuzla ve geçiş gününden
  önceki gün eskisi gibi. Ürün ikramı zaten AsilPOS gününde panele girilmez (`productIkramRefusal`); Zayi & ikram
  sayfasının zayi ve hammadde yolu değişmez.

Otomatik rapor "Gün içinde çıkan"ı satırlardan yazar (harcama + teslim; teslim edilen 0): AsilPOS'un toplamıyla aynı,
`asilposOutsCheck` ve `asilposHandedGap` sessiz kalır. Kabul günü: 22 Kasım'ın tek harcaması (800,00, "Diğer fatura
dışı", fişsiz) Kasadan çıkanlar'da ve Aylık harcamalar'da bir kez, yeniden gönderimde de.

### Günlük satış (aylık model)

Geçiş günü (aşağıda) seçilince AsilPOS'un günlük satırları aylık maliyet modeline girer (denetim E-08;
`src/lib/asilpos/sales.ts`, okuyucu `src/server/data/asilpos-sales.ts`): `pos_daily_sales` sayılan günlerden (ay, POS adı,
ürün, hizmet) başına ay toplamına çevrilir, Satışlar'a yüklenen ModPOS listesinin yanına konur. Motor (`engine.ts`)
değişmez: Satışlar, Tutarlılık (reçeteye göre beklenen tüketim), Ürünler, Analiz, Genel bakış, Claude aracı ve KDV
tahmininin karaoke payı (hizmet satırları %20) aynı satırları okur. **Geçiş günü boşken AsilPOS hiç okunmaz**: veri
kümesi, satış tahmini ve tatlı payı bayt bayt bugünkü gibidir (`tests/asilpos-satis-db.test.ts`).

**Her gün tek kaynak.** ModPOS'un listesi aylık toplamdır, gün gün bölünemez; bu yüzden kapsamı (Marina'nın listesinin
son günü, aşağıda "Şubenin kendi kaydı") belirleyicidir:

| Ay | ModPOS listesi | AsilPOS günleri |
|----|----------------|----------------|
| Geçiş gününden önce | sayılır (bugünkü gibi) | sayılmaz (deneme; yalnız Ayarlar kartında) |
| Geçiş ayı (geçiş günü ayın ortasında) | kendi son gününe kadar bütünüyle sayılır | listenin son gününden sonraki günden, geçiş gününden önce değil |
| Ayın tamamı geçiş gününden sonra | **sayılmaz** (silinmez; Satışlar "sayılmıyor" der) | ayın her günü |

- **Geçiş ayının listesi** en çok geçiş gününden önceki güne kadardır: Satışlar'da yüklerken "Liste hangi güne kadar?"
  en çok o gün, ay bittikten sonra yüklenen liste de ayın tamamı sayılmaz, o güne kırpılır (`modposImportRule`). Yoksa ay
  sonrası yüklenen liste kapsam kaydını silip AsilPOS günlerini saymaz yapardı. Listesi olmayan geçiş ayına "Satır ekle"
  ile yazılan ilk satır da listeyi aynı kuralla başlatır (`saveLine`, kapsam en çok geçiş gününden önceki gün): tek elle
  satır ayın tamamı sayılıp AsilPOS'un o ayki günlerini düşürmez.
- **Şubenin kendi kaydı (panelin ay kuralı):** listenin son günü Satışlar'ın "Liste hangi güne kadar?" kaydıdır.
  `integration_state` › `sales.coverage` ayın tek, şubesiz kaydıdır: son yükleyenin günü. Tuzla aynı aya kendi listesini
  "27 Kasım'a kadar" diye yükleyince 27 Kasım, Aralık'ta Kasım'ın tamamını yükleyince Kasım silinir. Bu yüzden Satışlar
  listenin son gününü şube şube de yazar (`sales.coverage.sube`, `{ "<şube>": { "YYYY-MM": "YYYY-MM-DD" | null } }`, null:
  ayın tamamı; şubenin listesi temizlenince şubenin ayı silinir) ve panelin ay kuralı şubenin kendi kaydını okur
  (`readCoverage`, `src/lib/sales-coverage.ts`): AsilPOS'un sayıldığı ilk gün, geçiş ayının çakışması ve liste ↔ Z her
  görünümde ("Tümü" dahil) ve tahmini stokta Marina'nın kaydından; şube seçiliyken listeye dayanan hesapların dönemi
  (`listPeriod`, "… tarihine kadar") şubenin kaydından. Satışlar'ın içe aktarma kartındaki "… tarihine kadar" yazılan
  şubenin listesinin günüdür (`writeCoverage`): "Tümü"de içe aktarma şubeyi sorar (ayı AsilPOS'tan gelen şube listede yok,
  bugün yalnız Tuzla kalır; docs/SUBE.md › Yazarken hangi şube) ve "Değiştir" yalnız onun listesini değiştirir, kart
  Tuzla'nın gününü gösterir (Tuzla'nın o ayda listesi yoksa geçiş ayından itibaren Marina'nın listesinin
  gününü). Ortak kayıt yalnız "Tümü"nün liste dönemi içindir. Marina 21 Kasım'a kadar yükledi, Tuzla aynı aya 27 Kasım'a
  kadar ya da Aralık'ta ayın tamamını yükledi: Marina'nın AsilPOS'u yine 22 Kasım'dan sayılır. Şube kaydı olmayan ayda
  (bu kayıttan önce yüklenmiş liste) ortak kayıt okunur; Satışlar ortak kaydı ezmeden önce o ayda listesi olup kendi
  kaydı olmayan şubelere ortak kaydın o anki gününü yazar (`legacyCoveragePins`), eski listenin son günü de öteki şubenin
  yüklemesiyle kaybolmaz.
- **Liste geçiş gününü aşıyorsa** (geçiş günü sonradan, liste zaten yüklüyken seçildi) AsilPOS'un o günleri sayılmaz,
  Satışlar söyler: "Kasım listesi 20 Kasım gününe kadar: AsilPOS'un 10–20 Kasım günleri … sayılmıyor. AsilPOS'u saymak için
  yalnız 1–9 Kasım listesini yükleyin."
- **Liste kısaysa ya da yoksa** (1–4 Kasım listesi, geçiş günü 10 Kasım) aradaki günler hiçbir kaynakta yoktur (çift
  değil eksik sayım); geçiş günü geldikten sonra Satışlar "5–9 Kasım satışı hiçbir kaynakta yok … 1–9 Kasım listesini
  yükleyin" der.
- **Gün sonu gelmeyen gün:** AsilPOS'un sayıldığı günlerden kasa raporu olup gün sonu gelmeyen (dünden önceki) gün
  Satışlar'da uyarılır: "2 günün AsilPOS gün sonu gelmedi, kasa raporu var: 1, 2 Ekim. Bu günlerin satışı hesapta yok;
  AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın." (`missing`).
- **Genel bakış:** Satışlar bandının ilk uyarısı (eksik ya da sayılmayan gün, gün sonu gelmeyen gün, liste ↔ Z) "Bu ayın
  işleri"nde "Satış raporu" satırına da çıkar (`monthTaskFacts`); ay o uyarıyla "Tamam" görünmez. Ayın tamamı AsilPOS'tansa
  satır "AsilPOS'tan N gün geldi" der, Patron listesi istemez.
- **Liste ↔ Z:** geçiş ayında listenin toplamı listenin günlerinin kasa raporu Z toplamını %5'ten fazla aşıyorsa uyarı
  (yüklerken bildirim, sonra Satışlar'da): liste geçiş gününden sonraki satışı da içeriyor olabilir, o günler
  AsilPOS'tan da sayılır. Liste ürün cirosudur (indirimden önce), küçük fark olağandır.
- **Kapsam:** AsilPOS satırı olan ayın satırları son sayılan AsilPOS gününe kadardır (`salesCoverage`): süren ayda ya da
  günleri eksik ayda günlük ortalama ve "ayda …" adetleri yarım ayı tam ay saymaz (engine `listPeriod`). **Süren ayda**
  AsilPOS günü kasa raporlarının son gününden sonraysa o gün kasa raporu girilince sayılır (`mergeWithAsilpos`
  `lastTillDay`; Satışlar'ın bandı "10 Aralık kasa raporu girilince sayılır" der): AsilPOS gün sonunu kapanışta yollar,
  rapor sonra (çoğu kez ertesi sabah) girilir; o arada satırlar kasa döneminden bir gün ileride olur, liste ↔ POS cirosu
  karşılaştırması yanlış uyarı verir, günlük ortalama bir günün satışı kadar şişerdi. Süren ayda hiç kasa raporu yoksa
  beklenmez (ayın kasa dönemi yok). Ay rakamlarının raporsuz günde AsilPOS Z'sinden gelmesi (B09) bu bekleyişi kendiliğinden
  kaldırır: kasa dönemi AsilPOS günlerini de kapsar.
- **"Tümü"nün dönemi şube şube (25 Kasım 2026, denetim bulgusu 62).** "Tümü"de ayın satırları iki kaynaktan gelir:
  ModPOS'ta kalan şubenin (Tuzla) elle yüklenen listesi ve Marina'nın AsilPOS günleri. Önceden ayın dönemi Marina'nın son
  AsilPOS günüydü, Tuzla'nın kaydı geçiş ayından sonra hiç okunmuyordu: Tuzla'nın 15 Aralık'a kadarki listesi iki şubenin
  24 günlük sabit gideri ve kasasıyla düşülüyor, net kâr, günlük ortalama ve başabaş ilerlemesi olduğundan düşük
  çıkıyordu. Artık geçiş ayından itibaren her ayın "Tümü" dönemi **şubelerin en kısa listesiyle** biter
  (`otherBranchLists`, `commonListCuts`, `mergeSalesSources` › `short`; `src/lib/asilpos/sales.ts`):
  - Tuzla'nın o ayki listesinin son günü şubenin kendi kaydından (`sales.coverage.sube`; kayıt yoksa ayın tamamı).
    Marina'nın AsilPOS günleri gün gün okunduğu için o güne kesilir (`loadAsilposMonthSales` `cuts`): "Tümü"de 16–24
    Aralık sayılmaz, Tuzla'nın listesi gelince sayılır. Dönem (`listPeriod`) o güne kadarki iki şubenin kasasıyla;
    sabit gider, indirim ve online satış o günlere düşen payla.
  - Marina'nın AsilPOS'u Tuzla'nın listesinden önce bitiyorsa (gün sonu gelmedi) dönem onunla biter (eskisi gibi).
  - Tuzla'nın o ay kasa raporu var ama listesi yoksa (ay sonunda yüklenecek) "Tümü"de o ayın satırları sayılmaz: ortak
    dönem yoktur. AsilPOS'tan önceki gibi "Tümü"nün süren ayı liste yüklenene kadar POS cirosuyla görünür; Marina'nın
    satışı Marina seçiliyken gün gün görünür.
  - Bu ayda Genel bakış'ın "Satış raporu" işi ve başlığın kaynak satırı "AsilPOS … itibaren sayılıyor" demez (bant
    "satışı da sayılmaz" derken çelişiyordu; inceleme 25 Kasım 2026): süren ayda "Tümü'de bu ayın satışları Tuzla'nın
    listesi gelince sayılır; şubeyi seçince gün gün görünür.", bitmiş ayda "yüklenmedi" (`commonListWaitText`); kaynak
    satırı "Satışlar: Tümü'de Tuzla'nın listesi gelince (şube seçiliyken gün gün)" (`commonListSourceLine`). Liste ay
    sonunda yüklendiği için süren ayın çoğunda "Tümü" satışsız (en kârlı ürünler, reçeteye göre oran ve brüt kâr yok,
    başabaş önceki aya göre) görünür. **Sahibin onayı bekleniyor**: istenmezse süren ayda liste yokken eski davranışa
    (Marina'nın AsilPOS satırları kendi dönemiyle) uyarıyla dönülebilir.
  - Genel bakış ve Satışlar kısaltan şubeyi adıyla yazar ("Tuzla'nın satış listesinin son günü 15 Aralık: öteki şubelerin
    satışı da o güne kadar sayılır.", listesi yoksa "Tuzla'nın Aralık 2026 satış listesi yok: …"; `commonListText`).
  - Şube seçiliyken değişmez (şubenin kendi kaydı). Geçiş ayında Marina'nın ModPOS listesi de aylık toplamdır, kesilemez:
    Tuzla'nın listesi Marina'nın listesinden de kısaysa Marina'nın listesi dönemden uzun kalır (geçiş ayına özgü, bilinen
    sınır). Kasa raporunu bekleyen gün (`held`) kasa raporlarının son gününe göre söylenir; ortak dönemin kestiği gün
    bekleyen sayılmaz.

**Satışlar** (`/panel/satislar`, yalnız yönetici): geçiş ayında bilgi bandı ("Kasım geçiş ayı: ModPOS listesi 1–9
Kasım, AsilPOS 10 Kasım'dan itibaren (12 gün geldi, son gün 21 Kasım).") ve yukarıdaki uyarılar. AsilPOS satırları aynı
tabloda "AsilPOS · N gün" diye, **salt okunur**: düzenlenmez, silinmez (gün AsilPOS'ta düzeltilip yeniden gönderilir).
Eşleşmeyen AsilPOS adı ModPOS satırı gibi eşleştirilir (değnekli öneri ve toplu öneriler dahil; `matchAsilposName`,
`applyAsilposMatches`): tıklanan ay toplamının günleri (bağlıysa da) ve o ayın aynı adlı ürünsüz günleri seçilen ürüne
geçer, aynı adın ayın başka günlerinde başka ürüne bağlı satırı değişmez; ad Satışlar'ın POS adı hafızasına yazılır,
başka aylardaki ürünsüz satırlar da bağlanır. AsilPOS'un hizmet işaretli ya da sitenin bağlı kalemiyle gelen satırı
başka ürüne (ya da ürünsüze) geçmez: sonraki gün sonu geri alırdı; eylem reddeder ve düzeltmenin yerini söyler. Tabloda AsilPOS satırı ad, ürün ve hizmet başına bir ay toplamıdır. Ayın tamamı AsilPOS'tansa İçe aktar kartı yerine "AsilPOS'tan geliyor"
kartı (gelen gün sayısı, Ayarlar kartına bağlantı) çıkar, "Satır ekle" yoktur (eylem de reddeder), o aya eskiden
yüklenmiş liste "Ayı temizle" ile silinir; ModPOS listesi yüklenmez ("Aralık 2026 AsilPOS'tan geliyor; ModPOS listesi
yüklenmez."). Geçiş gününden önceki aylarda ve geçiş günü boşken sayfa bugünkü gibidir.

**Satış tahmini** (`src/server/forecast/load.ts`, `mix.ts`): geçiş gününden itibaren kasa raporu girilmemiş günün
toplamı AsilPOS'un Z'sidir (rapor kazanır); tatlı payı aylık modelin satırlarını okur. **Ürün silme** (`productHistoryCounts`,
denetim E-34): ürüne bağlı AsilPOS günlük satırı varsa (deneme günleri dahil) ürün silinmez, "Menüde aktif" kapatılır;
yoksa satırların bağı sessizce koparırdı (FK `set null`).

`loadDailyProductSales(from, to)` (`src/server/data/daily-sales.ts`) satırları gün gün döner (yoksa `null`); bugün onu
okuyan yok. Günlük pencereye geçecek okuyucu (ör. hafta gününe göre tatlı oranı) bu ağızdan okur ve geçiş gününden
önceki deneme günlerini kendisi ayırır (`isAsilposDay`): ağız bütün günleri döner.

### Kasa raporu: AsilPOS'tan doldur

Yalnız AsilPOS günlerinde: geçiş günü seçili ve raporun günü ondan önce değilse (`loadKasaAsilpos`,
`src/server/data/asilpos-day.ts`; kural `isAsilposDay`, `src/lib/asilpos/switch.ts`). Geçiş günü boşken ya da önceki bir
günde bant hiçbir role görünmez, form, e-posta, WhatsApp, kapalı gün, geç rapor ve ay rakamı bugünkü gibi ModPOS'a
göredir. AsilPOS gününde (denetim B09):

- Z bölümünün adı **AsilPOS gün sonu (Z)** (form, kayıtlı rapor, e-posta, WhatsApp); ModPOS Z fotoğrafı çekilmez, Banka POS
  Z (yazarkasa) bölümü kalır. O günün gönderimi gelmediyse açıklama "AsilPOS'un bu günün sonu gelmedi; AsilPOS'ta Kasa ›
  Geçmiş günler'deki Z raporundan yazın."
- Gönderim geldiyse **yeni form** (o günün ilk raporu, yeni geç rapor) açılırken aşağıdaki kuralla kendiliğinden dolar;
  hiçbir şey kaydedilmez. Yazılmış değerlerle açılan form (kayıtlı raporda Düzenle, düzeltme önerisi, reddedilen geç
  raporun önceki değerleri, onay kartının Düzeltip onayla'sı) **yalnız karşılaştırır**: hiçbir alan kendiliğinden
  değişmez, farklı olanlar turuncu ve altında "AsilPOS'ta …" / "AsilPOS'takini yaz"; metinler de "doldu" değil
  "karşılaştırıldı" der (Z bölümü: "Yazılan rakamlar AsilPOS'un gün sonuyla karşılaştırıldı: …"; Düzeltip onayla'da
  bant "Personelin yazdıkları AsilPOS'takiyle aynı." ya da "AsilPOS'ta 2 alan personelin yazdığından farklı; …"). Bant:
  "AsilPOS gün sonu · Z 128 · 26 Ekim 03:12" ve **AsilPOS'tan doldur** (boş alanları doldurur).

Doldurma:

- ModPOS Z bölümünün alanları (Z no, fiş sayısı, toplam satış, nakit, kart, yemek kartı, online, diğer, ödenmez /
  ikram, indirim) ve kasa alanları (açılış, gün içinde çıkan, gün içinde kasaya giren, sayılan nakit, teslim edilen;
  eşlemesi aşağıda)
  fotoğraf okumasıyla aynı kuralla dolar (`CashPrefill { source: "asilpos" }`, `src/lib/asilpos/prefill.ts`): yalnız
  **boş** alanlar, yanında mavi **AsilPOS'tan**.
- Yazılmış alan değişmez (açılış önceki devirden, gün içinde çıkan fişlerden kendiliğinden dolar). AsilPOS'taki
  farklıysa altında "AsilPOS'ta 1.500 ₺" ve **AsilPOS'takini yaz** çıkar.
- Gün sayılmadan kapandıysa sayılan nakit boş kalır ve turuncudur: "AsilPOS'ta gün sonu sayımı yok: çekmeceyi AsilPOS'ta
  Kasa › Geçmiş günler › Kasa föyü'nden sayın; AsilPOS günü yeniden gönderir." Sayım panelde yapılmaz: form o anda Z'nin
  rakamlarını gösterir, sayım kör olmazdı. Kasa föyü girilince AsilPOS günü sayımla yeniden gönderir.
- Bant sonucu söyler: "AsilPOS'tan 14 alan dolduruldu. Kontrol edip gönderin." ya da "… 1 alan yazdığınızdan farklı,
  turuncu olanlara bakın." Kasa eşlemesinin bilgi satırları (aşağıda) bandın altında mavi çıkar.
- **Hiçbir şey kendiliğinden kaydedilmez:** personel bakıp **Raporu gönder**'e basar. Kasa farkını form kendisi
  hesaplar (AsilPOS'un `cashDiff`'i kullanılmaz); Banka POS AsilPOS'tan gelmez.
- Kasa bandına personele yalnız Z ve geliş anı gider (`src/server/data/asilpos-day.ts`, sabit sütunlar); ödeme
  kanalları okunmaz. Günün zayi & ikram kartı AsilPOS'un ikramını yalnız adı ve adediyle yazar (aşağıda, "İkram"). Özet
  okunamazsa bant görünmez, form her zamanki gibi elle doldurulur.

#### Gönderilmiş rapor ile AsilPOS (denetim E-09)

Kayıtlı rapor AsilPOS'un gün sonuyla karşılaştırılır (`asilposDiffs`, `src/lib/asilpos/diffs.ts`): Z alanları, açılış ve
gün içinde giren alan alan (boş bırakılan isteğe bağlı alan farklı sayılmaz), kasa aşağıdaki eşlemeyle. Teslim sayımdan
sonra yazıldıysa (Teslim edilen > 0) çıkan + teslim AsilPOS'un harcama + teslimiyle, devir (sayılan − teslim) AsilPOS'un
sayımıyla karşılaştırılır; AsilPOS'ta sayım yoksa sayılan karşılaştırılmaz. Fark varsa:

- kayıtlı rapor ve günden güne görünüm (rozet "AsilPOS'tan farklı"): "AsilPOS'tan farklı yazılan · Sayılan nakit 9.350 ₺
  (AsilPOS'ta 9.000 ₺)";
- e-posta (turuncu kutu) ve WhatsApp metni (`⚠️ AsilPOS'tan farklı yazılan: …`): `cashReportExtras` sunucuda hesaplar;
- yöneticinin zili: "Kasa raporu AsilPOS'tan farklı" (son 7 gün); AsilPOS günü rapordan sonra farklı rakamla yeniden
  gönderdiyse "AsilPOS rapordan sonra farklı rakamla geldi";
- geç rapor kartı: AsilPOS'un Z'si ("AsilPOS gün sonu · Z 13 · 63 fiş · 20.000 ₺ · nakit 12.000 ₺ · sayılan 9.000 ₺") ve
  personelin farklı yazdıkları.

#### Gün içinde çıkan: panelin Kasadan çıkanlar'ı kaynak (denetim E-35)

Fişli harcama ve teslim panelin **Kasadan çıkanlar**'ındadır (Aylık harcamalar, tedarikçi ödemeleri oradan okunur).
**Sahibe soru 5 yanıtlandı (23 Kasım 2026, Faz 3):** kasadan çıkan para AsilPOS'ta girilir ve satır satır buraya gelir
(yukarıda "Kasadan çıkanlar AsilPOS'tan"); fiş fotoğrafı, yer ve kategori panelde eklenir. Eski AsilPOS (yalnız toplam
yollayan: harcama, teslim) günü ve AsilPOS'ta olmayan elle satır için aşağıdakiler geçerlidir. Formda Gün içinde çıkan
fişlerden kendiliğinden dolar; AsilPOS'un
birleşik tutarı farklıysa alanın altında "AsilPOS'ta 5.450 ₺" görünür ama fişler varken **AsilPOS'takini yaz** yoktur
(fişsiz çıkış olurdu) ve bilgi satırı ne yapılacağını söyler (`asilposOutsCheck`): "AsilPOS'ta harcama 450 ₺ + teslim
5.000 ₺; Kasadan çıkanlar'da 450 ₺. Teslimi Kasadan çıkanlar'a "Teslim" olarak ekleyin; Gün içinde çıkan kendiliğinden
5.450 ₺ olur." Geç rapor ve düzeltme kartı fişlerden fazlası AsilPOS'taki teslim kadarsa "fişsiz" demez
(`asilposHandedGap`).

#### Pavo – AsilPOS kart karşılaştırması (`bankPos`)

İsteğe bağlı `bankPos` (AsilPOS #154): yazarkasa POS'unun (Pavo) banka gün sonu ve AsilPOS'un kart tutarı
(`lafposCard`: Z'nin kartı + kartla bahşiş + kartla cari tahsilatı). AsilPOS onu yalnız gün sonu bittiğinde yollar
(`status` `ok`, `failed`, `unknown`); bilinmeyen bir durum (eski AsilPOS'un `running`'i) `unknown` okunur, karşılaştırma
düşmez. Okunamayan `bankPos` günü reddetmez: gün yazılır, önceki karşılaştırma yerinde kalır, günlüğe
"bankPos okunamadı" yazılır (`parsePosDay`). Gün sonu tamda (`batches`, `dayCard`) yöneticinin Pavo kartı günü
karşılaştırır: Pavo'nun günü (bütün batch'lerin toplamı, gün ortasında elle alınan da) ↔ AsilPOS'un bütün gün kartı;
her batch ayrı satırda, son batch'in Pavo / AsilPOS kartı ayrıntı olarak kalır (eski kart yalnız son batch'e bakıp
"Uyumlu 755 = 755" diyordu, günün 995'ini görmüyordu). Farkta metin kartla cari tahsilatının başka bir POS'tan çekilmiş
olabileceğini de söyler (AsilPOS'un tabanı onu Pavo'da sayar). Gün sonu alınamadıysa (`failed`, batch yok, `lafposCard`
boş) "AsilPOS kart toplamı" satırı bütün gün kartını (`dayCard`) gösterir, "yok" demez (son denetim, 24 Kasım 2026).

#### Kart: kartla bahşiş ve cari tahsilatı (G11)

AsilPOS isteğe bağlı `z.cardTips` (kartla bahşiş) ve `z.cardCollections` (kartla cari tahsilatı) yollar: banka POS'u
görür, Z'nin kartı görmez. AsilPOS gününde kart karşılaştırması (form, kayıtlı rapor, günden güne rozeti, e-posta,
WhatsApp) bunların toplamını düşer (`asilposCardExtra`, `withCardExtra`), personelde de: aynı gün her okurda aynı
sonucu verir (personelin ekranı "fark var", gönderdiği WhatsApp "aynı" demez). Tutar personelin ekranına da gider,
çünkü personelin yazdığı Banka POS ile kartın farkından zaten çıkar; metinde tutarı yalnız yöneticininki yazar
("AsilPOS'taki kartla bahşiş ve cari tahsilatı (520 ₺) düşüldü."; personelde "… düşüldü."). Yalnız Banka POS yazılan
raporun Kart bölümünde ve e-postasında ayrı satır: "− AsilPOS kartla bahşiş + cari tahsilatı 150 ₺" (personelde
"düşüldü"), böylece 10.150 ile 10.000 arasında "Fark yok" okunur; WhatsApp'ın kart satırı "(bahşiş / cari tahsilatı
düşüldü)" ekler. Kaydedilmez; eski gövdede yoksa 0.

#### Kart: yazarkasadan geçmeyen ödeme (Faz 2)

Gövdenin `offDevice`'ı (`{ card, cash }`; mali fişi yazarkasada kesilmeyen satış ödemeleri: başka POS, "Başka yoldan
aldım") Z'nin kartında ve nakdinde vardır, yazarkasanın Z'sinde ve Pavo'nun banka gün sonunda yoktur (AsilPOS'un kendi
Pavo kıyası da düşer, `cardBasis`). Kasa raporu AsilPOS gününde aynı kuralla karşılaştırır (`AsilposDay.offDevice`,
`withCardExtra(rapor, cardExtra, offDevice)`; form, kayıtlı görünüm, yöneticinin penceresi, Onaylar, günden güne rozeti,
e-posta, WhatsApp): yazarkasa kartı ya da banka gün sonu **Z'nin kartı − yazarkasadan geçmeyen kart** (+ kartla bahşiş
ve cari tahsilatı) ile, yazarkasa nakdi Z'nin nakdi − yazarkasadan geçmeyen nakit ile karşılaştırılır; yazarkasanın
toplamından fark yazarkasadan geçmeyen satışlar kadarsa bilgi satırı onu söyler. 22.11 (kabul günü): kart 5.030, Pavo ve
yazarkasa kartı 4.160, yazarkasadan geçmeyen kart 870: "Kart: yazarkasa ile AsilPOS aynı. AsilPOS'ta yazarkasadan geçmeyen
kart (870 ₺) düşüldü." (personelde tutarsız). Yalnız Banka POS yazılan raporun Kart bölümünde ve e-postasında ayrı satır
"− Yazarkasadan geçmeyen kart 870 ₺" (personelde "düşüldü"); WhatsApp'ın kart satırı "(yazarkasadan geçmeyen kart
düşüldü)" ekler. Kaydedilmez; eski gövdede yoksa hiçbir şey düşülmez. İki sınır: yazarkasadan geçmeyen ödemenin kartla
bahşişi `cardTips`'in içindedir ve ayrı gelmez (AsilPOS'un Pavo kıyası onu da düşer, panel düşemez: öyle bir günde kart
o bahşiş kadar "az" görünür), gün kapandıktan sonra yazarkasada fişi iptal edilen ödemenin kartı (`fis_iptal`) gövdede
yoktur. Gün sonu tamda ikisi de kapandı: `offDevice.cardTips` kartla bahşişten düşer (`asilposCardExtra`), cihazda iptal
(`okc.voided`) yazarkasadan geçmeyene eklenir (`asilposDayOf`). AsilPOS gününde kart farkı önce Pavo'nun banka gün
sonuyla ölçülür (`withCardExtra(…, "AsilPOS")`, `computeCash` `cardBank`); yazarkasa alanları AsilPOS'un kendi
belgelerinden geldiği için yazarkasa ↔ AsilPOS satırı (`okcReconcile`) Z − yazarkasadan geçmeyen − cihazda iptal ile,
banka gün sonu yazarkasa kartı + bahşiş + tahsilatla karşılaştırılır. Bu yalnız yazarkasa kartı AsilPOS'un cihaz
belgesinin kartıyla aynıysa geçerlidir (`okcFromDevice`; gün özeti `offDevice.okcCard` taşır): elle yazılan yazarkasa
kartı (ör. personel AsilPOS'tan önce banka fişindeki tutarı yazdı) eskisi gibi bahşiş / tahsilat düşülerek karşılaştırılır.
Uçtan uca gün (24.11): kart 1.088, yazarkasadan
geçmeyen 288 (+20 bahşiş), kartla cari tahsilatı 195, Pavo 240 + 755 = 995: "Kart: banka gün sonu ile AsilPOS aynı".

#### Geç rapor, fotoğraf kaldırma, kapalı gün, ay rakamı (G8, E-36, G6)

- **Geç rapor:** kanıt günün kasasına göre (`kasaEvidence`): AsilPOS'un gün sonu geldiyse fotoğraf gerekmez ve form ondan
  dolar; gelmediyse yazarkasa (Banka POS) Z fotoğrafı zorunlu. Fotoğraf kaldırma isteği aynı kurala bakar (AsilPOS
  gününde ModPOS Z fotoğrafı kanıt değildir; gün sonu gelmediyse tek yazarkasa Z fotoğrafı kaldırılmaz).
- **Kafe kapalıydı:** AsilPOS'un satışlı gün sonu kanıttır (kırmızı "AsilPOS'ta Z 14 · 63 fiş", tutar yok; satışsızsa
  uyarı): personelin isteği açılmaz, yönetici onaylayamaz. Satışlı gün sonu geldiğinde o günün bekleyen bildirimi kapanır
  ve tek günlük kapalı işaret kalkar (`onAsilposDaySaved`, gün sonunun yazımıyla aynı işlemde). Geçiş günü boşken alım hiçbir
  kaydı değiştirmez. Aynı günün satışlı gün sonu daha önce geldiyse (AsilPOS düzeltip yeniden gönderdi) o andan sonra
  konan işaret yöneticinin kanıtı görerek verdiği karardır: yeniden gönderim onu kaldırmaz; yalnız ondan önce konan
  işaret kalkar. İlk gönderim satışsızsa (fiş ve Z toplamı 0) sonraki satışlı gönderim ilk satışlı gönderim sayılır.
- **Ay rakamı:** kasa raporu girilmemiş AsilPOS gününün Z'si ayın açık gün, ciro, indirim, ödenmez ve kart payına girer
  (`tillRows`, `source: "asilpos"`); gün yine "rapor yok" sayılır, rapor girilince rapor kazanır.

#### Kasa alanlarının eşlemesi (26 Ekim 2026)

AsilPOS'ta **teslim** gün açıkken, sayımdan önce çekmeceden çıkar; panelde **Teslim edilen** sayımdan sonra verilen
paradır (olması gerekenden değil, ertesi güne devirden düşer). Bu yüzden AsilPOS'un teslimi panelde **gün içinde
çıkan**dır, Teslim edilen 0 yazılır. Nakit satış dışında çekmeceye giren (`cashIn`: giriş, nakit müşteri tahsilatı ve
nakit bahşiş) panelin **Gün içinde kasaya giren**idir:

| Panelin alanı | AsilPOS'tan |
|---|---|
| Açılış | `openingCash` |
| Gün içinde kasadan çıkan | `cashOut` (harcama) + `handedOver` (teslim) |
| Gün içinde kasaya giren | `cashIn` (gelmediyse ya da `null`sa 0) |
| Sayılan nakit | `countedCash` (sayılmadıysa boş ve turuncu) |
| Teslim edilen | 0 |

Böylece panelin olması gerekeni (açılış + nakit + giren − çıkan, `computeCash`) AsilPOS'unkine eşittir
(`expectedCash` = açılış + nakit + `cashIn` − harcama − teslim), devir sayılan nakittir. Giren çıkandan fazla olsa da
(bahşiş, tahsilat günü) bir şey kırpılmaz. Örnek (TL): açılış 1.500, nakit satış 12.000, nakit bahşiş 300, nakit
tahsilat 1.000 (`cashIn` 1.300), harcama 450.

- Gün ortasında 5.000 teslim: gün içinde çıkan 5.450, giren 1.300; AsilPOS da panel de 9.350 bekler, 9.350 sayıldıysa
  kasa tutuyor, devir 9.350.
- Teslim yok: gün içinde çıkan 450, giren 1.300; ikisi de 14.350 bekler, 14.350 sayıldıysa kasa tutuyor, devir 14.350.
  (Önceki eşleme gireni çıkandan düşüp 0'da kırpıyordu: panel 13.500 bekleyip "850 ₺ fazla" kaydederdi.)

AsilPOS kendi olması gerekenini (`expectedCash`) gönderdiyse ve panelin aynı rakamlarla hesabından 0,01 TL'den fazla
ayrılıyorsa bandın altındaki bilgi satırı AsilPOS'un rakamını gösterir ("AsilPOS'ta olması gereken nakit 14.000 ₺; panel
aynı rakamlarla 14.700 ₺ hesaplıyor (700 ₺ fazla)."); aradaki fark gizli kalmaz. Eski AsilPOS `cashIn` göndermez: giren
0 yazılır, gün içinde çıkan yine harcama + teslimdir.

### Komisyon: ödeme kanalları (denetim E-37)

`payments[]` (ad, Z alanı, kanal, tutar) geçiş gününden itibaren Komisyon & hakediş'in kanal kanal satışıdır
(`loadCommissionInput`, `src/server/data/commission.ts`; kural `src/lib/commission/report.ts` › `asilposMonth`,
`asilposSales`; ayrıntı [KOMISYON.md](KOMISYON.md) §3 "AsilPOS'tan kart kart"). Öncelik **elle > asilpos > tek**: yöneticinin
yazdığı ekstre her zaman kazanır. Geçiş ayında geçiş gününden önceki günler kasa raporu kuralıyla. Kanal yazısı anahtar
(`pluxee`, `multinet`, `edenred`, `setcard`, `metropol`, `yemeksepeti`, `trendyol`, `getir`, `migros`) ya da kanalın
adı olarak tanınır (`asilposChannel`, `src/lib/commission/channels.ts`); kanalı seçilmemiş ya da tanınmayan ödeme türü
grup kartında bilgi satırıdır ve kart kart dağıtılmaz. Gün sonu gelmeyen gün eksik sayılır (raporu varsa grubun
toplamına rapordan girer). Geçiş günü boşken ödeme kanalları hiçbir yerde okunmaz; geçiş gününden önceki günler
(deneme) hiçbir aya girmez.

### İkram (denetim E-38)

`ikram[]` (ad, sitenin kalemi ve boyu, adet, menü değeri, neden) geçiş gününden itibaren ürün ikramının kaynağıdır
(`src/lib/asilpos/ikram.ts`, okuyucu `src/server/data/asilpos-ikram.ts`; ayrıntı [ZAYI-IKRAM.md](ZAYI-IKRAM.md) › AsilPOS'a
geçildikten sonra). AsilPOS satış satırları (`lines[]`) ikramı içermez (AsilPOS ikram kalemlerini satış satırından
çıkarır, `server/sync/lafmaliyet.ts`): çift sayım yok.

- Satır panel ürününe gün sonu satırlarıyla aynı sırayla bağlanır (sitenin kalemi ve boyu, sonra POS adı
  eşleştirmesi), okuma anında: ürün sonradan bağlanınca geçmiş ikram da bulunur. Bağlanamayan satır tüketime girmez;
  adı Ayarlar › AsilPOS'ta "İkramda ürüne bağlanamayan POS adları" altında listelenir (Faz 2'den hazırlanmış iptalin
  bağlanamayan adı da: o da tüketime ürünüyle girer) ve oradan bağlanır (yalnız ikram
  edilen kalem satış satırlarına hiç düşmez).
- **Tür:** Faz 2'den AsilPOS `kind`'ı yollar ve o önce gelir; yollamayan eski AsilPOS'ta nedenin ön ekinden (AsilPOS
  `shared/comp.ts` `compReasonText`): "Zayi: Döküldü" zayidir (ön ek atılır), "Ödenmez: Personel yemeği" ve öteki her
  satır ikramdır (`asilposLineKind`). Hazırlanmış iptaller de bu yoldan zayi satırı olarak gelir (yukarıda "Faz 2
  alanları").
- **Her gün tek kaynak:** AsilPOS'un gün sonu gelen günde satırlar kendi türüyle veri kümesine (`Dataset.asilposIkram`),
  oradan Tutarlılık'ın kayıtlı tüketimine, Zayi'nin ay özetine ve haftalık özete girer (`Model.countedWaste`); panele o
  güne girilmiş ürün ikramı sayılmaz. Hammadde ikramı ve zayi panelde kalır; panelin ürün zayisi AsilPOS'ta da aynı gün
  zayi yazıldıysa ikisi de sayılır ve gün listesinde işaretlenir (sahibin sorusu).
- Panelde yeni ürün ikramı, gün sonu gelen günde ve bugün reddedilir (doğrudan, geç kayıt isteği, isteğin onayı); gün
  sonu gelmeyen geçmiş günde girilir. Zayi'nin gün listesi AsilPOS'un ikram ve zayi satırlarını salt okunur gösterir
  (personelde ad ve adet; yöneticide nedeni ve menü değeri).
- Kasa raporunun özeti (form, e-posta, WhatsApp, Bugün) o günün ikram ve zayisini AsilPOS'tan yazar; e-posta AsilPOS'un
  Z'sindeki ödenmez tutarı (zayi yazılanı da kapsar) ile listenin tamamının menü değerini karşılaştırır (fark bilgi
  satırı, işarete göre açıklama; eski AsilPOS iptal edilen adisyonun ikramını da yolluyordu, AsilPOS L1 ikisini aynı
  adisyonlardan hesaplar).
- Geçiş günü boşken ikram hiçbir yerde okunmaz.

### Ürün maliyetleri: `GET /api/panel/pos/urunler`

Aynı anahtar ve imza (gövdesiz GET); yanıt `Cache-Control: no-store`:

```json
{ "version": 1, "now": "2026-10-26T09:00:00.000Z", "items": [
  { "siteMenuId": "mnu-0003", "slot": "M", "name": "Latte", "size": "M", "costMinor": 4210, "active": true }
] }
```

- Yalnız laffogato.net menüsüne bağlı ürünler (`site_menu_id`), sitenin kimliğine ve boyuna göre sıralı.
- `costMinor`: reçetenin birim maliyeti (malzeme + fire, KDV hariç; ürün kartındaki "Maliyet",
  `src/lib/calc/engine.ts`), kuruş. Reçetesi olmayan ürün 0.
- `active`: ürün panelde "Menüde aktif" mi.
- Başka alan gitmez: fiyat, kâr, marj, reçete ve hammadde yok (`src/lib/asilpos/costs.ts`). Makine ucudur: oturumla
  açılmaz, panel ekranlarında yoktur; AsilPOS bu rakamı yalnız `rapor.maliyet` yetkisi olanlara gösterir.

### ModPOS dönemi: `GET /api/panel/pos/modpos-gunler`

**Neden (sahibin 23 Kasım 2026 bildirimi):** AsilPOS Uzaktan › Raporlar › "Geçen hafta" (16–22 Kasım) yalnız 22
Kasım'ı gösteriyordu; Marina'nın 16–21 Kasım ModPOS günleri hiç yoktu. O günler panelde (kasa raporları, föy, Satışlar'a
yüklenen ModPOS listesi) duruyor. Kasa bu uçtan şubesinin ModPOS dönemini çeker, kendi Raporlar'ında "ModPOS" etiketiyle
gösterir ve Uzaktan'a kendi dükkân kimliğiyle iter (AsilPOS deposu `docs/03-ENTEGRASYON.md` §4); indirim, ödenmez, KDV
ve ürünler elle yüklenmez, buradan gelir. Uç yalnız okur.

İstek: aynı anahtar ve imza, gövdesiz GET, şube sorguda (sorgu imzanın içinde):
`GET /api/panel/pos/modpos-gunler?sube=marina`. Yanıt `Cache-Control: no-store`:

```json
{ "version": 1, "now": "2026-11-23T07:00:00.000Z", "sube": "marina", "switchDay": "2026-11-22",
  "days": [
    { "date": "2026-11-13", "ciro": 390, "kart": 195, "nakit": 195, "yemek": 0, "online": 0, "diger": 0,
      "indirim": null, "odenmez": 0, "ikram": 0, "fis": 2, "zNo": "Z-2026-002",
      "kdv": [{ "rate": 10, "base": 354.55, "vat": 35.45 }], "kaynak": "foy" },
    { "date": "2026-11-14", "ciro": 3311, "kart": 2687.25, "nakit": 623.75, "yemek": 0, "online": 0, "diger": 0,
      "indirim": 249, "odenmez": 0, "ikram": 0, "fis": 14, "zNo": "Z-2026-003",
      "kdv": [{ "rate": 10, "base": 3010, "vat": 301 }], "kaynak": "kasa_raporu" }
  ],
  "urunler": { "from": "2026-11-13", "to": "2026-11-21",
               "rows": [{ "ad": "Latte", "boy": "M", "adet": 8, "tutar": 950 }] } }
```

| Yanıt | Ne zaman |
|-------|----------|
| `200` | Yukarıdaki gövde; geçiş günü boşken `switchDay: null`, `days: []`, `urunler: null` |
| `400 {error: "invalid", field: "sube"}` | `sube` yok, birden çok ya da biçimi bozuk (gün sonunun `sube` kuralı) |
| `401` / `503` | İmza tutmuyor / anahtar yok (öteki uçlar gibi); imzasız istek şubenin doğru olup olmadığını öğrenmez |
| `409 {error: "wrong_branch", sube, expected}` | `sube` AsilPOS'un şubesi (Marina) değil: başka şubeye ayarlı kasa başka şubenin rakamını almaz |

**Günler** (`days`, güne göre sıralı):
- Geçiş gününden **önceki** günler, en çok 400 gün geriye. Geçiş günü ve sonrası AsilPOS'undur, hiç gelmez. Sahip (23
  Kasım 2026): Marina bundan sonra ModPOS'u hiç kullanmaz, ModPOS dönemi 13–21 Kasım 2026'dır. Geçiş gününden sonra
  Marina için föy ya da rapor gelse de bu uçtan gitmez.
- Kaynak (`kaynak`) şubenin kendi satırlarından:
  - `"kasa_raporu"`: günün **kasa raporu**. Raporu olan günde föye bakılmaz (rapor boş olsa da).
  - `"foy"`: raporsuz günde **kapanmış ModPOS föyü**. Kapanmış föy: bütün kasaları kapalı ya da kasası açılmadan
    satış yapılmış ve kesinleşmiş gün (`modposFoyInput`). Kasası açık föy ve gün içinde alınmış föysüz föy gitmez,
    satışsız gün de gitmez.
  - Föy günü Ayarlar › ModPOS › **Ay rakamına yedek**'ten bağımsız gider. Raporların başına kesintisiz uzanma kuralı
    da burada aranmaz. Karar 23 Kasım 2026, CONTRACT §9: AsilPOS Uzaktan boş gün göstermesin.
- `ciro` = ödemelerin toplamı (`kart + nakit + yemek + online + diger`): indirimden sonra, ödenmez / ikram hariç (Z
  toplamı ödenmezi içerse de; Kasa raporu › Ciro ve ödenmez). Panel ödenmezle ikramı tek tutar tutar: hepsi `odenmez`'de,
  `ikram` 0. `fis` Z'nin fiş (adisyon) sayısı, `zNo` ModPOS'un Z no'su (metin, yoksa null).
- `indirim` bilinmiyorsa **`null`**, 0 değil. Föyde indirim alanı yoktur, bu yüzden föy gününde hep `null`. Kasa
  raporunda İndirim alanı isteğe bağlıdır; yazılmadıysa o gün de `null`. AsilPOS `null`'ı "indirim bilinmiyor" diye
  gösterir: brüt = ciro, indirim satırı yok.
- `kdv`, sırayla:
  1. Kasa raporunun yazarkasa dökümü (`okc_vat`) günün cirosunu kuruşu kuruşuna tutuyorsa oran oran o (matrah =
     toplam − KDV). Karaoke %20 böyle ayrı gelir.
  2. ModPOS föyünün ya da Z'sinin KDV dökümü: ModPOS föyü KDV dökümü vermez (docs/MODPOS-API.md), panel de saklamaz.
     Bu adım bugün hiçbir gün için bir şey vermez.
  3. Tek satır %10, matrah = round(ciro × 100 / 110).

  %20 hiç varsayılmaz: Marina'da %20 yalnız karaokede, o da ancak döküm söylerse gelir. Satırların KDV dahil toplamı
  ciroya eşittir.
- Satışı, indirimi, ödenmezi ve fişi olmayan gün (kapalı gün, satışsız föy) gelmez. Tutarlar TL, iki ondalık, sıfırdan
  küçük değil.

**Panelin ay kuralı değişmedi.** Panelin ay rakamı föy gününü yine yalnız Ay rakamına yedek açıkken sayar
(`tillRows`, docs/MODPOS-API.md › Ay rakamına yedek). Açıkken de yalnız raporların başına kesintisiz uzanan föyleri
sayar. Bu yüzden AsilPOS'un Raporlar'ında ve Uzaktan'da, panelin Kasa ve Gelir-gider ekranlarının saymadığı bir ModPOS
günü görünebilir. Bu bilerek böyle: o günün rakamı panelde yalnız föyde durur. Ay rakamına girmesi istenirse rapor
girilir ya da yedek açılır (tests/asilpos-modpos-db.test.ts ikisini birlikte denetler).

**Ürün listesi** (`urunler`): şubenin Satışlar'a yüklenen ModPOS listesi, **indirim öncesi** (liste = ciro + indirim),
dönem için tek blok (aylık liste gün gün bölünemez):
- Aylar: pencerenin içinde başlayan, listesi olan en son aya kesintisiz uzanan aylar (arada listesi olmayan ay varsa
  öncesi girmez).
- `to`: son ayın listesinin son günü (Satışlar'ın "Liste hangi güne kadar?" kaydı, yoksa ayın sonu), geçiş gününden
  önceki günü geçmez; `from`: ilk ayın 1'i, o aydan itibaren ModPOS günü varsa ilki (Marina 13 Kasım'da açıldı).
- Son gün **şubenin kendi kaydından** okunur (`integration_state` › `sales.coverage.sube`, Satışlar her yüklemede yazar,
  şubenin listesi temizlenince siler). Panelin ortak kaydı (`sales.coverage`) ayın tek kaydıdır: Tuzla aynı aya kendi
  listesini sonradan, örneğin "10 Kasım'a kadar" diye yüklerse ortak kayıt 10 Kasım olur, Marina'nın 13–21 Kasım bloğu
  yine 13–21 Kasım kalır. Bu kayıttan önce yüklenmiş listede ortak kayıt okunur. Panelin ay kuralı da aynı kaydı okur
  (yukarıda Günlük satış › Şubenin kendi kaydı).
- Satır: `ad` ve `boy` bağlı panel ürününün adı ve boyu (`M` / `L`; tek boy `null`), bağlanmamış satırda ModPOS'taki ad;
  aynı (ad, boy) toplanır, tutara göre sıralı; en çok 500 satır, fazlası "Diğer ürünler" satırında (toplam değişmez).
- Hiçbir satırın `adet`'i ya da `tutar`'ı eksi değildir (AsilPOS eksi satırı düşürür, blok listeden büyük görünürdü).
  ModPOS listesindeki eksi satır (iade, düzeltme) Satışlar'da ürüne bağlıysa ürünün satırında düşülür. Bağlanmamışsa
  toplanan satıra girer, eksiyi kapatacak kadar en küçük satırla birlikte: "Diğer ürünler ve iadeler". Tutar ve adet
  toplamı yine listeninkidir (liste = ciro + indirim denetimi bozulmaz). İade satırının adı görünsün istenirse Satışlar'da
  ürününe bağlanır.
- Listesi yoksa ya da toplamı eksiyse `null`. Marina 13–21 Kasım 2026: 31 satır, 240 adet, 29.415,00.

**Bütçe:** AsilPOS kendiliğinden **iş günü başına en çok bir kez** çeker (gün açıldıktan sonraki ilk turda ya da
05:00'ten sonra); Yönetim › Entegrasyon'daki "ModPOS dönemini çek" elle, **5 dakikada bir**den sık değil. AsilPOS'ta
`LAFMALIYET_URL` yoksa hiç istek gitmez; hata olursa kasa son iyi veriyi tutar. Panel hiçbir şey itmez ve saklamaz:
her istek o anki kasa raporlarını, föyleri ve listeyi okur (düzeltilen rapor ertesi çekimde gider).

**KVKK:** kişi adı (raporu gönderen, sayan, föydeki personel, cari müşteri), kasa ve sayım rakamı, açılış, gider
gitmez; yalnız yukarıdaki alanlar.

## Gün sonu otomasyonu (22 Kasım 2026)

Yalnız AsilPOS'un şubesinde (Marina) ve geçiş gününden itibaren (`src/server/asilpos/gun-sonu.ts`, saf kuralları
`src/lib/asilpos/gun-sonu.ts`). Tuzla (ModPOS) bu yoldan hiç geçmez: raporu, e-postası ve föyü bugünkü gibi.

**Tetik:** `POST /api/pos/gun` 200 ve `counted: true` döndükten sonra (`after()`; kasa yanıtı e-postayı beklemez) ve
günlük iş (`/api/cron/gunluk`, adım "AsilPOS gün sonu"): son 7 günün (geçiş gününden önce değil) gün sonları yeniden
işlenir. İşlenmiş gün hiçbir şey yapmaz; gece gönderilemeyen e-posta sabah gider, geçiş günü sonradan girildiyse eksik
günler (en çok 7 gün geriye) yakalanır.

**Sabah işinin sırası (26 Kasım 2026):** adımın bütçesi kısadır (sabah işinin kuyruğunda yaklaşık 8 sn), önceden günler
eskiden yeniye işlendiği için en yeni gün yetişmeyebilirdi. Artık işi bekleyen günler önce ve **yeniden eskiye** (dünkü gün
ilk) işlenir: hiç işlenmemiş, rapor adımı bugünkü içerikle işlenmemiş (yazım düştü, düzeltme gelip işlenmedi) ya da gün
sonu e-postası bugünkü içerikle gitmemiş gün (`dayEndPending`, `catchUpOrder`). İşlenmiş günler (Pavo, fotoğraf ve
çalışan e-postasının yeniden denemesi) sona kalır. Son ana 2 sn'den az kalınca yeni güne başlanmaz: başlanamayan bekleyen
gün adımda hata olur ("2026-11-22 süre yetmedi"; Ayarlar › Günlük işler), sonraki tetik dener; işlenmiş gün sessizce
kalır. Davranış idempotenttir: ikinci çalışma rapor yazmaz, e-posta göndermez. Kasa zinciri bozulmaz: yeni gün eski
günden önce yazıldığından devir denetimi (açılış ↔ önceki raporun devri, raporun notunda) eski günü görmemiş olabilir;
aynı çalışmada bir gün yazıldıysa (ya da düzeltildiyse) ondan sonraki ve ondan önce işlenen günlerin (yalnız e-postası
düşmüş dünkü gün de) raporu eskiden yeniye bir kez daha hesaplanır (devir değişmediyse hiçbir şey yazılmaz). Yöneticinin
sildiği otomatik raporun günü sonradan düzeltme gelince de işlenmiş sayılır (rapor yeniden yazılmaz, gün her sabah öne
geçmez).

**Kasa raporu kendiliğinden yazılır** (`writeAutoReport`, tek işlem, geç raporun ve raporun kilidi altında):

- Rapor yoksa ve AsilPOS'ta sayım varsa: "AsilPOS'tan doldur"un eşlemesiyle (Z, ödemeler, ödenmez, indirim, açılış, gün
  içinde giren, gün içinde çıkan: panelin Kasadan çıkanlar'ı girildiyse o, yoksa AsilPOS'un harcama + teslimi; teslim
  edilen 0, sayılan nakit AsilPOS'un sayımı; Faz 2'de gövdede varsa yazarkasa Z no'su; gün sonu tamda Banka POS ve
  yazarkasa alanları, aşağıda). Gönderen "LafPOS (otomatik)". Not: "AsilPOS gün sonundan otomatik yazıldı." ve yalnız
  cihazların boşlukları, tam metniyle ("Eksik: Banka POS: Pavo gün sonu alınamadı (hata 5085: …); AsilPOS'ta Yönetim ›
  Yazarkasa POS › Cihazda gün sonu al."); "panelden ekleyin" yok. AsilPOS'un kapanış notu (`z.closeNote`) da nota
  eklenir. Açılış önceki raporun devrinden farklıysa nota yazılır, AsilPOS'taki
  açılış kalır; Faz 3'te AsilPOS'ta yazılan açılış farkının nedeni de (yukarıda "Faz 3: kasa zinciri"). Gün içinde çıkan,
  AsilPOS'un kasa hareketleri satır satır geldiyse o satırların toplamıdır. Rapor kapalı gün işaretini kaldırır ve günün bekleyen geç rapor isteğini kapatır (elle girilen rapor gibi).
- **Cihaz rakamları cihazdan, uydurma değer yok (gün sonu tam, 24 Kasım 2026; yalnız AsilPOS günleri, Tuzla / ModPOS
  değişmedi):** Banka POS, Pavo'nun kendi gün sonlarından yazılır (`bankPosAuto`): bu AsilPOS gününün başarılı bütün
  gün sonlarının toplamı (`bankPos.batches[].total`; gün ortasında elle alınan da), batch listesi olmayan eski gövdede son
  sonucun `pavoCard`'ı. Yazarkasa alanları AsilPOS'un cihaz belgelerinden (`okc`; `okcAuto`): fiş sayısı ← `docs`,
  günlük toplam, nakit, kart, yemek kartı, diğer, KDV dökümü (`{rate, total, vat}`) ve KDV toplamı (döküm hesaplanamadıysa
  boş). Yazarkasa Z no'su AsilPOS'un `z.okcZNo`'su (`okc.zReport` false iken boş Z no eksik sayılmaz). AsilPOS Z no
  göndermediyse personelin gün sonu fotoğrafında (Pavo'nun detaylı Z'si) okunan Z no boş alana yazılır (aşağıda); AsilPOS
  sonradan gönderirse onunki geçer. Kümülatif, KDV kümülatifi ve yazarkasa dışı tahsilat yalnız fotoğraftan (yönetici). **Cihazın rakamı yoksa
  alan boş kalır** ve not tam olarak nedenini söyler: Pavo alınamadı ("Banka POS: Pavo gün sonu alınamadı (hata {kod}:
  {mesaj}); AsilPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al"), sonuç belirsiz ("Banka POS: Pavo gün sonunun sonucu belirsiz;
  AsilPOS'ta Yönetim › Yazarkasa POS › Doğrula"), Pavo sonucu gelmedi ("Banka POS: AsilPOS'tan Pavo gün sonu gelmedi"),
  batch'in tutarı okunamadı ("Banka POS: Pavo gün sonunda tutar okunamadı"), cihaz belgesi yok ("Yazarkasa: AsilPOS'ta
  cihaz belgesi yok"). Son sonuç başarılı değilse önceki batch'lerin toplamı da yazılmaz (kapanıştan sonraki kart henüz
  hiçbir batch'te değil); başarılı sonuç yalnız gün içinde alınmışsa da (hiçbir batch `dayClosed` değil) boş kalır: "Banka POS:
  Pavo'nun kapanış gün sonu gelmedi (yalnız gün içinde alınan var); AsilPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu
  al" (uçtan uca günde kapanıştaki son başarılı sonuç gün ortasındaki 000278 = 240'tı). Föyde personelin yazdığı kart sayımı (`z.methodCounts`) Banka POS'u doldurmaz (yalnız bilgi;
  sahibin sorusu (b)). Rapor kapanışta, Pavo sonucundan önce yazılır; Pavo sonucu aynı günün ikinci gönderimiyle gelince
  boş Banka POS dolar (birleştirme). Boş gelen değer kayıtlı değeri hiç silmez: sonradan alınamayan bir gün sonu, elle
  ya da önceki sonuçla yazılmış Banka POS'u boşaltmaz. AsilPOS'ta sayım yoksa rapor hiç yazılmaz ("sayım yok"); AsilPOS
  sayımla yeniden gönderince yazılır.
- **Düzeltme:** AsilPOS aynı günü yeniden gönderirse yalnız elle değişmemiş alanlar güncellenir (kayıtlı değer son
  otomatik değere eşitse); personelin ya da yöneticinin düzelttiği alan ve Banka POS korunur. Önceki sürüm geçmişe
  yazılır, işlem geçmişine "Kasa raporu güncellendi (AsilPOS otomatik)" düşer.
- Rapor elle girildiyse (yönetici gün sonundan önce, sayımsız günde ya da AsilPOS göndermezken yedek yolla girdi; eski
  kayıtta personel) Z'sine, kasasına ve notuna dokunulmaz (AsilPOS'tan farklı yazılanları mevcut uzlaşma gösterir); **yalnız
  boş cihaz alanları dolar** (denetim 25 Kasım 2026, bulgu 6; `humanDeviceFill`): Banka POS boşsa Pavo'nun gün sonundan,
  yazarkasa alanlarının hiçbiri yazılı değilse AsilPOS'un cihaz belgelerinden ve yazarkasa Z no'sundan, grup olarak (bir
  yazarkasa alanı elle yazılmışsa hiçbiri yazılmaz: iki kaynağın rakamı karışmaz). Elle yazılan alan ezilmez, cihazın
  rakamı yoksa alan boş kalır; dolan alan bir daha yazılmaz (Pavo'nun sonucu ikinci gönderimle gelince boş Banka POS o
  zaman dolar). Önceki sürüm geçmişe, işlem geçmişine "Kasa raporu güncellendi (AsilPOS otomatik)"; gönderen ve sayan
  değişmez (Z, kasa ve not elle girenin; rapor listesi, kart başlığı ve e-posta onu gösterir); rapor yeniden e-postalanmaz. Önceden yöneticinin akşam girdiği AsilPOS gününde Pavo
  karşılaştırması ve yazarkasa KDV dökümü sessizce kayboluyordu. Yönetici otomatik raporu silerse yeniden yazılmaz.
  Geçiş gününden 7 günden eski güne rapor yazılmaz (geç rapor yöneticinin işi).

**Personelin tek işi: gün sonu fotoğrafı** (sahibin isteği, 24 Kasım 2026: "sadece gün sonu ladmine personel foto
atsın"; `src/server/asilpos/foto.ts`, kurallar `src/lib/asilpos/foto.ts`):

- **Pavo detaylı Z basar** (sahibin yanıtı, 24 Kasım 2026: "Pavo cihazdan fiş isteyince veriyor, Z olarak detaylı"):
  Marina'nın Pavo'su istenince tek fişte banka gün sonunu (batch'ler) ve Z'nin rakamlarını (Z no, satış toplamı, nakit,
  kart, yemek kartı / diğer, KDV satırları) basar; yalnız "Z basmayan e-Arşiv cihazı" değildir. AsilPOS `okc.zReport`'u
  Pavo için hâlâ false gönderir: panel buna bakmaz. Personelden **tek fotoğraf** istenir: "Pavo'dan gün sonu fişini
  (detaylı Z) alın ve fotoğrafını ekleyin" (birden çok fotoğraf da alınır, iki ayrı fotoğraf istenmez). Yalnız ayrı mali Z
  basan cihazda (TokenX, `zReport`) yazarkasa Z'si ayrıca istenir.
- Otomatik raporlu AsilPOS gününde personelin Kasa sayfası raporu salt okunur gösterir (Düzenle, Silinmesini iste,
  Düzeltme öner, WhatsApp ile gönder ve Metni kopyala yok; altında "Rakamlar AsilPOS'tan geldi; kasayı yönetici kontrol
  eder.", farkı ima eden "AsilPOS'ta düzeltin" değil; sayım personele kör, aşağıda "Kör kasa") ve tek bir
  "Gün sonu fotoğrafı" kartı. Sayfanın alt başlığı "Rakamlar AsilPOS'tan geldi; Pavo'dan gün sonu fişini (detaylı Z) alıp
  fotoğrafını ekleyin." ("Kapanışta Z raporunu alın, kasadaki nakdi sayın…" değil). Kart eklenince "Fotoğraf alındı",
  okunamadı ya da yanlış belgeyse "Fotoğraf okunamadı / yanlış belge, yeniden çekin" der; Pavo'nun sonucu AsilPOS'a henüz
  gelmediyse de iş aynıdır ("alındı" denmez, gün tamam sayılmaz; fiş çekilince tamam). Rapora bağlı fotoğrafın adı
  "Pavo gün sonu fişi" ("Banka POS Z" değil; "Yazarkasa Z" yalnız ayrı mali Z basan cihazda). Personel fotoğraf ↔ rapor
  farkını hiç görmez: eski "Fotoğraftan farklı yazılan: …" kutusu ve WhatsApp metnindeki satırı AsilPOS'un otomatik
  gününde personelden süzülür (`staffPhotoDiffs`); notun yönetici yönergesi ("Eksik: Banka POS … AsilPOS'ta Yönetim ›
  Yazarkasa POS › Cihazda gün sonu al") personele kısa nötr satırdır: "Banka POS henüz gelmedi; yönetici ilgileniyor"
  (`staffAutoNote`; yönetici yazdıysa yok). Kasadan çıkan satırlarındaki "Fiş fotoğrafı ekle" eskisi gibi (isteğe bağlı).
  Tuzla / ModPOS ve elle girilen günler değişmedi. Yönetici Düzenle'yi görür; elle düzelttiği alanı sonraki otomatik
  güncelleme ezmez.
- **Gün sonundan önce** (son denetim, 24 Kasım 2026): AsilPOS gününde (Marina, geçiş gününden itibaren) AsilPOS'un gün sonu
  gelmeden ve rapor yokken personel kasa formunu görmez; yerinde "Kasa raporu AsilPOS'tan gelecek: Kapanışta AsilPOS'ta
  Günü kapat'a basın; rapor AsilPOS'tan gelir, sonra Pavo'nun gün sonu fişinin (detaylı Z) fotoğrafını eklersiniz." yazar
  (alt başlık, Bugün'ün akşam satırı ve zil de aynı işi söyler; "kasadaki nakdi sayıp girin" denmez). Personel girseydi
  otomasyon raporu "elle girildi" sayar, Z'yi ve kasayı AsilPOS'tan yazmazdı (yalnız boş cihaz alanları dolardı). Sunucu da reddeder
  (`saveCashReport`): personel AsilPOS gününde yeni rapor yazmaz, otomatik raporu değiştirmez ("rakamlarını yalnız yönetici
  düzeltir"), yöneticinin yedek yolla elle girdiği raporu da değiştirmez (kör kasa, 25 Kasım 2026; aşağıda). AsilPOS hiç
  göndermezse raporu yönetici girer; dünden eski gün personelin geç rapor yolundan girilir.
- **Kör kasa** (denetim 25 Kasım 2026, bulgu 0; `src/lib/asilpos/kor-kasa.ts`; panelde girilen ModPOS günlerinin karşılığı [KASA-RAPORU.md](KASA-RAPORU.md#kör-sayım) › Kör sayım): kasiyer AsilPOS'ta çekmeceyi kör sayar
  (`kasa.rakam` yok); panel de AsilPOS'un şubesinde geçiş gününden itibaren personele **açılışı, sayılan nakdi, teslimi,
  olması gerekeni, kasa farkını ve ertesi güne devri göstermez**. Önceden kasiyer kapanıştan saniyeler sonra panelde ve
  Bugün'de "750 ₺ eksik" görüyor, ekran ona AsilPOS'ta düzeltip yeniden göndermesini söylüyordu. Kurallar:
  - Personelin yükü (`blindForStaff`, `blindReport`): raporun açılışı, sayılanı, teslimi ve farkı sıfır, `blind`
    işaretli; notun açılış cümleleri ("Açılış önceki raporun devrinden …", "Açılış AsilPOS'ta beklenenden … (beklenen …)",
    "Neden (AsilPOS): …") çıkar. AsilPOS'un gün sonundan forma giden açılış, sayılan ve teslim alanları ve AsilPOS'un olması
    gerekeni satırı (`blindAsilposDay`), önceki raporun devri, ertesi günün açılışı, sürümler ve bekleyen istekler hiç
    gitmez. Otomatik rapor da yöneticinin elle girdiği rapor da böyle. Kasa sayfası AsilPOS'u okuyamazsa (geçici hata)
    gizleme açılmaz: AsilPOS'un şubesinin kasasında personele kör sayılır (`staffBlindView`).
  - Teslim (patrona verilen) kasiyerin AsilPOS'a kendi girdiği kasa hareketidir: "gün içinde çıkan"ın ve "AsilPOS'ta
    harcama … + teslim …" bilgi satırının parçası olarak personelde kalır (inceleme, 25 Kasım 2026). Açılış ve sayılan
    olmadan olması gereken ve fark çıkmaz; raporun ayrı teslim alanı sıfırdır.
  - Kayıtlı rapor kartı farkın yerine "Gün sonu alındı" der (altında otomatik raporda "Rakamlar AsilPOS'tan geldi;
    kasayı yönetici kontrol eder.", elle girilmiş raporda "Rapor elle girildi; kasayı yönetici kontrol eder."; sayfanın
    alt başlığı elle girilmiş raporda "Gün sonu AsilPOS'ta alınır; bu günün kasa raporu girildi, kasayı yönetici kontrol
    eder."), döküm özetinde "sayılan" yok; dökümün kasa bölümünde yalnız
    nakit satış, gün içinde giren ve çıkan, altında "Kör sayım: açılış, sayılan nakit ve kasa farkı yalnız yöneticide."
    Rapor salt okunur (Düzenle, Silinmesini iste, Düzeltme öner, WhatsApp ve Metni kopyala yok). Eski AsilPOS günü kartı
    (dünden eski 14 gün) da aynı dökümü gösterir.
  - Bugün: "AsilPOS gün sonu · Fotoğraf alındı" ve elle girilmiş raporda "Ali gönderdi" (fark yok). Kasa sayfasının
    **Son 7 gün** listesinde AsilPOS gününün farkının yerinde gri "Sayım AsilPOS'ta" rozeti. Personelin zili zaten farkı
    söylemez; çalışanların gün sonu e-postası da (`sendStaffDayEnd`).
  - Sunucu: personel AsilPOS gününün raporunu formdan yazamaz (yöneticinin elle girdiği de: "AsilPOS gününün kasa raporunu
    yalnız yönetici düzeltir; yanlışlık varsa yöneticinize yazın."), düzeltme öneremez (`proposeCashCorrection`) ve
    WhatsApp metnini istemez (`cashReportWhatsapp`): ikisinin yanıtı farkı taşırdı.
  - Yönetici (rakam yetkisi) her şeyi eskisi gibi görür: kart, Kontrol listesi, e-posta, zil. Tuzla (ModPOS) ve geçiş
    gününden önceki gün değişmedi.
  - Kapsam dışı (bilinçli): AsilPOS'un hiç göndermediği güne personelin geç raporu (yazarkasa Z fotoğrafıyla, yöneticinin
    onayına) eski yoldur: sayımı panelde kendisi yazar, form sonucu gösterir (o gün AsilPOS'ta kör sayım yoktur). Önceki
    halka AsilPOS'un kör günüyse onun devri (sayılan − teslim) personele gitmez: açılış önerilmez, "… raporunun devri"
    satırı yok, sunucu açılış ↔ devir farkını sormaz (hata metni farkı söylerdi; `staffBlindOn`). Yönetici onayda
    devirle karşılaştırır.
    AsilPOS sayımı rapordan sonra değiştirirse yöneticiye ayrı bir uyarı ve "Personel kasa farkını görsün" şube ayarı
    henüz yok.
- Otomatik raporlu AsilPOS gününde personelin "Kaldırılmasını iste" düğmesi ve isteği fotoğrafın okuma farkına bakmaz
  (fark fotoğraf ↔ AsilPOS karşılaştırmasıdır, yalnız yöneticinin; düğmenin kaybolması farkı ele verirdi). Yöneticinin
  onayı farka yine bakar (`readingBlocksRemoval`).
- Fotoğraf `attachAsilposDayPhoto` ile rapora bağlanır (yazarkasa bölümü, `kasa-okc`, en çok 3): kaydetme yolu
  (`saveCashReport`) yok, sürüm yok, gönderen ve sayan değişmez, onay yok (rakam değişmiyor). Personel günden 14 gün
  (`LATE_REPORT_DAYS`) içinde, ertesi günün raporu girilmiş olsa da ekler; yalnız kendi yüklediğini; işlem geçmişine
  "Gün sonu fotoğrafı (AsilPOS günü)" düşer. Fotoğraf kaldırma kuralı aynı. Rapor yokken (AsilPOS'ta sayım yok) fotoğraf
  günün kaydında bekler (`asilpos_day_ends.pending_photos`), rapor yazılınca bağlanır; rapor elle girilirse
  (`writeCashReport`, ya da AsilPOS'un sonraki gönderiminde elle girilmiş rapor) o rapora bağlanır
  (`adoptPendingDayPhotos`), sahipsiz kalmaz. Dünden eski AsilPOS gününde de
  personel geç rapor değil yalnız bu kartı görür; AsilPOS'un gün sonu gelmiş güne geç rapor isteği açılmaz
  (`CASH_REQUEST_TEXT.lateAsilpos`). AsilPOS'un gönderimi olmayan günde eski yol (yazarkasa Z fotoğrafıyla geç rapor).
- Gün, otomatik rapor ve istenen fotoğraflar eklenince tamamdır (`asilpos_day_ends.missing`: cihaz boşlukları ve fotoğraf
  eklenene kadar `photo`). Bugün'de personelin satırı fotoğraf eklenene kadar "Gün sonu fotoğrafı" (dünkü de "Dünkü gün
  sonu fotoğrafı"); "Raporu gönder" yok. Personelin zilinde de aynı iş: "Gün sonu fotoğrafı bekliyor" (bugün ve dün;
  fotoğraf eklenince kalkar).
- **Sayımsız gün** (gün sonu geldi, çekmece sayılmadı, rapor yazılmadı; `asilposNoCountDays`): personelin Bugün satırı ve
  zili "Kasa sayılmadı": çekmeceyi AsilPOS'ta Kasa › Geçmiş günler › Kasa föyü'nden sayın, AsilPOS günü yeniden gönderir
  ("Dünü gir" ya da "Günü kapat'a basın" değil). Yöneticinin satırı "Sayım yok", zilinde "Dünkü kasa sayılmadı · Marina"
  ve nedeni. Sayım gelince rapor yazılır, satırlar kalkar. Yöneticinin bugünkü satırı AsilPOS gününde "AsilPOS gün sonu
  gelince kendiliğinden yazılır" der ("personel kapanışta girer" değil).
- **Fotoğraf ↔ AsilPOS** (`asilposPhotoCheck`, `asilpos_day_ends.photo_check`): okuma AsilPOS gününde hiçbir alanı yazmaz.
  Bağlanınca (ve AsilPOS yeniden gönderince) sunucu okunuşu karşılaştırır: Pavo fişinde okunan her batch no AsilPOS'un
  batch'lerinde, batch sayısı aynı, okunan netlerin toplamı raporun Banka POS'u (±0,01), fişin günü raporun günü (ertesi
  gün 05:00'ten önce basılan da), son batch'in banka dökümü Pavo'nunkiyle aynı. Günde birden çok Pavo gün sonu varsa
  (gün içinde elle + kapanış) ve fotoğrafta yalnız bir kısmı varsa (bilinmeyen batch yok), yalnız çekilen batch'ler kendi
  tutarıyla karşılaştırılır, çekilmeyenler bilgi satırıdır ("Fotoğrafı olmayan batch"; fark değil). Batch satırı okunmayan
  fiş (ya da karşılaştırılacak satır çıkmayan okuma) "uyumlu" değil "okunamadı"dır (yeniden çekilir). Fişte Z'nin
  rakamları da okunduysa (Pavo'nun detaylı Z'si ya da ayrı mali Z) Z no, günlük toplam, nakit, kart (kart satırı yoksa banka
  satırlarının toplamı), yemek kartı, diğer ve KDV dökümü raporun AsilPOS'tan yazılmış yazarkasa alanlarıyla (`okc.total`,
  `cash`, `card`, `mealCard`, `other`, `vat`) karşılaştırılır; ayrı mali Z basan cihazda Z fotoğrafı yoksa "Yazarkasa Z:
  yok"; Pavo gününde fotoğrafta Z yoksa bilgi satırı "Pavo detaylı Z: fotoğrafta yok · AsilPOS'ta Z rakamları geldi"
  (fark değil). AsilPOS'un kapanışta bastığı kendi kâğıdı ("GÜN SONU · Z n" + NET CİRO + "mali Z değildir", altında
  "BANKA GÜN SONU · PAVO"; kör kasada yalnız banka kısmı) Z sayılmaz: yalnız banka kısmı karşılaştırılır, Z no'su
  `okc_z_no`'ya yazılmaz (FOTOGRAF.md › AsilPOS'un kendi gün sonu kâğıdı). Z'nin günü fişin günüyle aynı kuralla
  karşılaştırılır (detaylı Z'de fişin günü satırı; ayrı Z'de "Z'nin günü").
  Aynı fişin birden çok fotoğrafında aynı batch (no ve banka) bir kez sayılır, metni farklı okunsa da; aynı batch farklı
  tutarla okunduysa fark satırı çıkar ve "Banka POS'a yaz" önerilmez. Ödeme bölümü hiç okunmayan Z'nin nakit / kart
  satırları karşılaştırılmaz (sahte fark yok). AsilPOS yazarkasa Z no'su göndermediyse fotoğrafta okunan Z no raporun boş
  `okc_z_no`'suna yazılır, yalnız fotoğraf AsilPOS'u tutuyorsa (uyumlu) ve Z'nin günü doğrulandıysa (başka günün ya da
  günü okunmayan Z'nin numarası yazılmaz); yönetici Düzenle'yle sildiyse geri yazılmaz (`applyPhotoZNo`; sürüm yok,
  işlem geçmişine "Yazarkasa Z no fotoğraftan yazıldı"), yönetici kartta "fotoğraftan okundu (AsilPOS göndermedi)" görür;
  AsilPOS sonradan gönderirse onunki geçer ve fotoğraftaki farklıysa fark olur. Fark yöneticinin uyarısıdır: Kasa gün görünümünde Pavo kartının
  altındaki "Gün sonu fotoğrafı" kartında satır satır, zilde "Kasa fotoğrafı AsilPOS'tan farklı · Marina <gün>" (son 7
  gün, yalnız yönetici), gün sonu e-postasında ve ay satırında rozet ("Fiş AsilPOS'tan farklı"). Banka POS boşken (Pavo
  alınamadı) okunan toplam "Fotoğrafta 995 ₺" olarak yöneticiye gösterilir, "Banka POS'a yaz" onu rapora yazar
  (`setAsilposBankPos`; önceki sürüm geçmişe, sonraki otomatik değer ezmez). Okuma: önce ucuz model (Claude Haiku 5.5),
  okunuş eksik / tutarsız ya da AsilPOS'tan farklıysa bir kez güçlü model (Claude Opus 5.5); yapay zekâ yoksa (anahtar,
  kapalı, sınır, kredi, hata) kodla (OCR + Pavo fişinin ayrıştırıcısı): [FOTOGRAF.md › AsilPOS gününün
  fotoğrafı](FOTOGRAF.md#asilpos-gününün-fotoğrafı-önce-ucuz-model-gerekirse-güçlü-yapay-zekâ-yoksa-kod-24-kasım-2026).
  Kodla okunan bir satır güvenle seçilmediyse ya da OCR hiç okuyamadıysa durum "okunamadı — yönetici baksın" (`belirsiz`;
  personelin işi bitti, zilde "Kasa fotoğrafı okunamadı, yönetici baksın" ve nedeni: "fotoğraf kodla okundu ama bir satır
  güvenle seçilmedi" ya da "fotoğraf kodla da okunamadı"; ay satırında "Gün sonu fotoğrafına bakın"). Kodla okunan fişte
  güvenle okunmamış NET / İADE batch tutarı ve tanınmayan ödeme satırı uydurulmaz ("okunamadı"). Yöneticinin kartı
  okuyanı yazar ("Yapay zekâ (Claude Haiku 5.5)" / "Kodla okundu").

**Gün sonu e-postası** (`sendDayEndEmail`): gün sonunun şubesinin kasa raporu alıcılarına (Kasa › Rapor alıcıları ya da
Şube ayarları, e-posta açıksa; "Tuzla ile aynı"ysa Tuzla'nınkine, [SUBE.md](SUBE.md) › Şube başına ayarlar); sabah
e-postasının adresleri girmez (25 Kasım 2026'ya kadar girerdi: yalnız sabah e-postasını alan adres Marina'nın kasa
farkını alıp Tuzla'nınkini almıyordu). Rapor alıcıları boş ya da kapalıysa e-posta susmasın diye o şubeye açık etkin
bildirim adreslerine gider (`dayEndRecipients`; "Bütün şubeler" ya da bu şube seçili adresler). Personel ve pasif
hesabın adresi gönderimde düşer (`sendableRecipients`). Konu Tuzla'nın kasa e-postasının biçiminde: "Kasa raporu
KR-20261122 · Marina · 22 Kasım Pazar · 120 ₺ eksik" (sonuç "kasa tutuyor", "120 ₺ eksik", "sayım yok"); Pavo ve
fotoğraf e-postası da aynı başla başlar, gelen kutusunda günün e-postaları yan yana durur. İçerik: toplam satış, Z no ve fiş, indirim, ödeme
türleri ve AsilPOS'un ödeme dökümü, ödenmez / ikram ve ikram edilenlerin adedi ve menü değeri, kasa (açılış, olması
gereken, sayılan, fark), dün ve geçen haftanın aynı günüyle kıyas (satış; AsilPOS günü yoksa o günün kasa raporu),
Marina'nın laffogato.net online satışı (`&branch=marina`), raporun durumu ve eksikler, **Cihazlar ve fotoğraf** (Banka
POS: Σ batch, batch numaralarıyla, ya da boşsa tam neden; yazarkasa: "AsilPOS cihaz belgeleri · N belge · tutar"; gün sonu
fotoğrafı: bekleniyor / alındı / AsilPOS'tan farklı), **Fotoğraf ↔ AsilPOS** (fotoğraf eklendiyse satır satır: okuyan,
her satır "fotoğrafta X · AsilPOS'ta Y · aynı | FARK | okunamadı"; fark varsa konunun sonunda "· Fotoğraf FARKLI"), "Panelde
aç". Maliyet ve kâr yok. Faz 2 alanlarıyla gelen günde ayrıca gün görünümünün bölümleri (`asilposDayDetail`): AsilPOS'un ödeme ayrıntısı
(yazarkasadan geçmeyen kart ve nakit, ödeme iptalleri), **İptal edilen kalemler** (`iptal[]`: hazırlanmış olanlar zayi,
hazırlanmamışlar "tüketim değil", kapanmış adisyondan iade `refund` ayrı satırda "İade (kapanmış adisyondan)"), yazarkasa Z no ve KDV dökümü, gönderim sırası; Faz 3 alanlarıyla gelen günde
**Kasa açılışı (AsilPOS)** (beklenen, fark, neden) ve **Kasa hareketleri (AsilPOS)** (harcama, teslim, giriş); eski
AsilPOS'un gününde bu bölümler yok.

- **Pavo'yu bekler** (25 Kasım 2026; canlıda 24 Kasım'da gün sonu 22:03'te, Pavo'nun sonucu 58 sn sonra ayrı e-postayla
  gitmişti): Pavo'nun sonucu henüz yoksa ve günün yazarkasası Pavo'ysa e-posta en çok 2 dakika bekler (`PAVO_WAIT_MS`,
  sonuç `waiting`; süre günün **ilk** gelişinden sayılır, sonucsuz yeniden gönderim beklemeyi uzatmaz). AsilPOS gövdede
  `bankPosPending` gönderirse ona uyulur: `false` (banka gün sonu başlamayacak, atlandı ya da bitti) beklenmez, `true`
  beklenir; göndermeyen eski AsilPOS'ta önceki AsilPOS gününde sonuç geldiyse (otomatik banka gün sonu açık) beklenir. Sonuç
  gelince AsilPOS günü yeniden gönderir ve tek e-posta karşılaştırmayla gider.
- **Bekleme sonraki bir tetiğe kalmaz** (25 Kasım 2026 akşamı e-posta bu yüzden gitmedi: AsilPOS günü yeniden göndermedi,
  gece ne açık panel sekmesi ne çalışan bir zamanlanmış iş vardı, e-posta sabahki işe kaldı). Beklemeye alan gönderimin
  kendi işi (`POST /api/pos/gun` after()'ı, `settlePavoWait`) süresi içinde birkaç saniyede bir Pavo'nun sonucuna bakar;
  sonuç gelirse e-postayı o gönderim gönderir, gelmezse isteğin başından ~38 sn sonra e-posta Pavo'suz gider (çalışanlarınki
  de), sonuç sonra gelirse kısa Pavo e-postası. İşlevin süresi isteğin başından sayılır (60 sn).
- Yedek: işlev yarıda kalırsa (süre doldu, `sending_at` bayatladı) ya da bekleme başka bir nedenle sürerse canlı yoklama
  (açık panel sekmesi, en çok 5 dakikada bir; `maxDuration` 60) ve kontrol işi (`finishWaitingDayEnds`) dünkü ya da bugünkü
  e-postası gitmemiş her AsilPOS gününü tamamlar (gönderimi düşmüş gün, `email_error`, sabahki işe kalır).
- Gün başına içerik başına bir kez: günün özeti (`dayHash`: Z, ödemeler, ikram) gönderilenle aynıysa gitmez. AsilPOS
  düzeltip farklı rakamla yeniden gönderirse konu "· düzeltildi" ile ve başta "Düzeltildi: …" notuyla bir kez daha gider.
  Sayımsız giden gün sayımla gelince bu düzeltme sayılmaz: konu "· kasa sayıldı", başta "Önceki e-postada sayım yoktu"
  (son giden e-postanın konusundan, `notification_log` › `lafpos-gun:marina:GÜN`; düşen gönderim konuyu değiştirmez)
  (Faz 2'den gövdede düzeltmenin türü ve nedeni varsa not onu yazar: "Düzeltildi: gün yeniden açıldı (…)"). Faz 2
  anahtarları (Z'nin liste ve tür toplamları, KDV dökümü, açılış / kapanış anı, yazarkasa Z no'su; ikramın türü ve kişi
  türü) özete girmez: öteki alanlardan türerler; panel yükseltilmeden önce saklanmış bir gün aynı rakamlarla yeniden
  gelince "Düzeltildi" e-postası gitmez.
- Gönderim başarısızsa hata `asilpos_day_ends.email_error`'a ve işlem kaydına (`notification_log`, anahtar
  `lafpos-gun:marina:GÜN`) yazılır; günlük iş yeniden dener. Aynı anda iki gönderim olmaz (`sending_at`).
- Geçiş gününden önceki gün (deneme) e-posta almaz, rapor yazılmaz.
- **Z raporu e-postası** (fotoğraf e-postası, `sendPhotoEmail`; sahibin istekleri, 24 Kasım 2026: "mail olarak vs.
  bilgilerde de farklı olunca belirsin"; 25 Kasım 2026: "gün sonu alınca admine z raporu yükleyince mail gelmedi" ve "z
  tutsa da tutuyor diye yine rapor şeklinde gönderilsin"): **eklenen her gün sonu fotoğrafı için** aynı alıcılara (kasa
  raporu alıcıları) ayrı bir rapor e-postası gider; Z tutsa da. Eskiden yalnız fark ya da "yönetici baksın"da gidiyordu.
  Gün sonu e-postası fotoğrafı içerse de Z raporu ayrıca gider. Konu durumu söyler: "Kasa raporu KR-20261122 · Marina ·
  22 Kasım Pazar · Z raporu tutuyor", "… Z raporu AsilPOS'tan FARKLI", "… Z raporu okunamadı" (yanlış belge, personel
  yeniden çeker), "… Z raporu okunamadı, yönetici baksın" ya da "… Z raporu alındı · okunmadı". İçerik: ekleyen, okuyan
  (yapay zekâ ve modeli ya da kod), satır satır karşılaştırma, **Fotoğrafta okunan** (belge türü, tarih, Z no, fiş
  sayısı, günün toplamı, ödemeler, KDV dökümü, toplam KDV, batch'ler; yalnız basılı ve okunmuş rakamlar, güveni düşük
  olanın yanında "(belirsiz)", kümülatif yok; `okcReadRows`), "Panelde aç" ve **fotoğrafın kendisi ek olarak** (en çok 3
  fotoğraf, toplam 8 MB; depo okunamazsa ek düşer, e-posta yine gider). Rapor yokken (AsilPOS'ta sayım yok) bekleyen
  fotoğraf otomatik raporun yazacağı değerlerle karşılaştırılır (`pendingPhotoCheck`). Aynı karşılaştırma bir kez gider
  (`notification_log` anahtarı `lafpos-foto:marina:GÜN:<özet>`; özet durum, okuyan ve satırlardan, birden çok fotoğrafta
  fotoğraf sayısından, `photoCheckHash`; fotoğraftan okunup raporun boş Z no'suna yazılan numaranın "raporda" eki özeti
  değiştirmez; yükseltmeden önceki formülle gitmiş kayıt da sayılır, `photoCheckHashLegacy`); yeni fotoğraf ya da
  AsilPOS'un düzeltmesi karşılaştırmayı değiştirirse yeniden gider. Gönderimi kendi kaydıyla üstlenir (kayıt
  "gönderiliyor" iken ikinci deneme bekler, yarıda kalan kayıt 5 dk sonra devralınır): gün sonu ve Pavo e-postasının
  kilidini tutmaz, onlar da Z raporunu sabaha bırakmaz. Gün sonu
  e-postası henüz gitmediyse beklenir (önce gün sonu, sonra Z raporu). Yükseltmeden önce eklenmiş eski fotoğraflar için
  toplu e-posta gitmesin diye tutan / okunamayan fotoğrafta kural son 48 saatte eklenen fotoğrafa bakar
  (`photoMailFresh`); fark ve "yönetici baksın" her zaman. Fotoğraf bağlanınca (`attachAsilposDayPhoto`, yanıttan sonra)
  ve günlük işte (`runAsilposDayEnd` › `photo`) denenir. **Çalışanların kısa gün sonu e-postasına fotoğraf ve fark hiç
  girmez.** Sabah e-postası kasa sorunlarını listelemez. Elle girilmiş raporun fotoğrafı bu yoldan geçmez: raporun kendi
  e-postası fotoğraf okunup yazılanlarla tutuyorsa yeşil "✓ Z fotoğrafı okundu: yazılan rakamlarla tutuyor" satırını
  taşır (Tuzla / ModPOS da).
- **Okunmamış fotoğraf yeniden okunur** (`readUnreadDayPhotos`; 25 Kasım 2026, "rapor ve z raporları okunmuyor"):
  fotoğraf yüklenirken okuma düştüyse (zaman aşımı, yoğunluk, bağlantı) fotoğraf okunmadan ya da yalnız kodla okunup
  bağlanıyor, hiçbir yol onu yeniden okumuyordu. Şimdi fotoğraf bağlanınca (yanıttan sonra, Z raporu e-postasından önce)
  ve gün sonu otomasyonunda (gün sonu ve Pavo e-postalarından sonra, Z raporundan önce) yapay zekâ okunuşu olmayan her
  fotoğraf aynı sırayla (ucuz → güçlü → kod) bir kez daha okunur, karşılaştırma yenilenir. Yalnız kodla okunmuş fotoğraf
  yapay zekâ açıkken yeniden denenir (kapalıyken kod okunuşu kalır, yeni OCR yok). Süreye sığmayan adım atlanır (son an:
  yanıttan sonraki iş 45 sn, günlük işin kalan süresi): ucuz okuma sığmazsa hiç denenmez, güçlü sığmazsa ucuz okunuş
  kalır. Fotoğraf başına sınırlı: `ai_calls`'ta 6 deneme satırı olan fotoğraf bir daha denenmez.
- **Çalışanların kısa e-postası** (`sendStaffDayEnd`; Kasa › Rapor alıcıları › Çalışanlar): yöneticinin e-postasıyla
  aynı tetikte, ondan ayrı gönderilir; yöneticininki düşse ya da alıcısı olmasa da gider (Pavo beklenirken beklenir). Sayım varsa (rapor yazıldı ya da elle girildi) "Marina · gün sonu alındı · 22 Kasım Pazar": Z no, fiş
  sayısı, "tutarlar" açıksa ciro ve ödeme türleri, "Emeğiniz için teşekkürler". **Günde bir kez**: AsilPOS düzeltip
  yeniden gönderse de ikinci "alındı" gitmez. Sayım yoksa teşekkür değil uyarı gider: "Marina · kasa sayılmadı": çekmeceyi
  AsilPOS'ta Kasa › Geçmiş günler › Kasa föyü'nden sayın, AsilPOS günü yeniden gönderir (o da günde bir kez). Sonuç
  `notification_log`'a yazılır (`lafpos-gun-calisan:marina:GÜN:alindi | sayim-yok`); düşerse günlüğe hata yazılır ve
  sabahki günlük iş yalnız o kaydı yeniden dener (yöneticiye yeniden gitmez; adım "AsilPOS gün sonu" hata verir). Giden
  kaydın üstüne yazılmaz: aynı anda iki tetik yarışır, ikincisi Resend'den 409 alırsa ilk "gitti" kalır. Yalnız
  dün ve bugün: günlük iş eski günleri işlerken personele geçmiş günün e-postası gitmez.

Durum tablosu `asilpos_day_ends` (gün, şube): otomatik rapor, son otomatik değerler, eksikler, gönderilen içerik, gönderim
sayısı ve hatası (`drizzle/0061_lafpos_gun_sonu.sql`); gün sonu tamda fotoğrafın karşılaştırması (`photo_check`) ve rapor
yokken bekleyen fotoğraflar (`pending_photos`; `drizzle/0074_gun_sonu_tam.sql`). Testler: `tests/asilpos-gun-sonu.test.ts`,
`tests/asilpos-gun-sonu-db.test.ts`, `tests/asilpos-gun-sonu-tam.test.ts`, `tests/asilpos-gun-sonu-tam-db.test.ts`; fotoğrafın
okunuşu ve fotoğraf e-postası `tests/gun-sonu-foto*.test.ts`.

### Gün sonu tam alanları (24 Kasım 2026)

AsilPOS'un gövdesine eklenen, hepsi isteğe bağlı (`.optional().catch(undefined)`; bozuksa yalnız alan düşer, günlüğe yazılır)
alanlar. Kişi adı yok (KVKK). Günün özetine (`dayHash`) girmezler: yalnız onları ekleyen gönderim "Düzeltildi" e-postası
yollamaz.

| Alan | Ne | Nerede kullanılır |
|------|----|-------------------|
| `bankPos.batches[]` | `{ batchNo, at, total, trigger: "otomatik"\|"elle", dayClosed }`: günün başarılı Pavo gün sonları, eskiden yeniye (en çok 20) | Banka POS = Σ total; Pavo kartı her batch'i listeler |
| `bankPos.dayCard` | AsilPOS'un bütün gün kıyas tabanı (Z kartı + kart bahşişi + kart tahsilatı − yazarkasadan geçmeyen − cihazda iptal) | Pavo kartı: Pavo'nun günü (Σ batch) ↔ bu; son batch satırı ayrıntı |
| `okc` | `{ provider, zReport, docs, cash, card, mealCard, other, total, voided{count, cash, card}, vat[]\|null }` | Raporun yazarkasa alanları; cihazda iptal karşılaştırmalardan düşer |
| `offDevice.cardTips` | Yazarkasadan geçmeyen kart ödemelerinin bahşişi | Kart karşılaştırmasında kartla bahşişten düşer (yanlış bahşiş farkı yok) |
| `z.cashTips` | Nakit bahşiş (`z.cashIn`'in içinde) | Gün görünümü: kasaya giren nakdin parçası |
| `collections[]` | Siparişsiz tahsilat (cari), ödeme türü başına `{ name, zField, channel, kind, count, amount }` | Gün görünümü: nakit / kartla tahsilat |
| `payments[].kind` | Ödeme türünün cinsi (`nakit`, `kart`, `yemek`, `havale`, `cari`, `online`, `diger`) | Saklanır (Diğer'in içinde cari / havale) |
| `z.closeNote` | AsilPOS'ta kapanış / föy notu (en çok 200) | Otomatik raporun notu, gün görünümü |
| `z.methodCounts[]` | Föyde ödeme türü başına sayılan `{ name, zField, channel, counted }` | Yalnız bilgi (gün görünümü); Banka POS'u doldurmaz |
| `shiftCounts[]` | Vardiya devri sayımları `{ at, counted, expected, diff, confirmed }` | Gün görünümü |
| `discountLines[]` | İndirim satırları `{ scope, posName, type, value, amount, reason }` (Σ amount = z.discounts) | Gün görünümü (sayı, toplam, nedenler) |

Saklama: `okc`, `collections`, `shift_counts`, `discount_lines` `pos_day_reports`'ta ayrı sütun (son gövdeninkiler; eski
AsilPOS'ta boş), ötekiler `z`, `payments`, `bank_pos` ve `off_device` jsonb'sinde.

## Geçiş günü

**Ayarlar › AsilPOS (kasa) › AsilPOS'a geçiş günü** (25 Kasım 2026'dan beri AsilPOS'un şubesinin şube ayarı, grup
`pos.lafpos`, [SUBE.md](SUBE.md) › Şube başına ayarlar; eski genel kayıt `settings.asilposGecisGunu` yalnız satırı
olmayan Marina'nındır, kasa kaynağı başka şubeye geçerse o şube kendi gününü alır; okuyan her yer
`asilposSwitchDay`, `src/server/asilpos/branch.ts`; `Settings` tipinde ve `DEFAULT_SETTINGS`'te `null`): Marina'nın kasasında AsilPOS'un kullanılmaya başlandığı ilk iş günü (YYYY-MM-DD, 05:00
kuralı; Tuzla ModPOS'ta kalır, aşağıda "Şubeler"). Canlıda 22 Kasım 2026.

- **Boş (varsayılan):** kasa ModPOS. Her şey bugünkü gibi çalışır; AsilPOS'un gönderdiği günler deneme sayılır.
- **Dolu:** o günden itibaren kaynak AsilPOS. Bugün değişen: 200 yanıtı `counted: true` der (B07); Kasa raporu o günden
  itibaren AsilPOS'un gün sonuyla açılır, kayıtlı rapor, e-posta ve WhatsApp AsilPOS'tan farklı yazılanı söyler, geç rapor
  AsilPOS'un gün sonuyla (gelmediyse yazarkasa Z fotoğrafıyla) girilir, satışlı AsilPOS günü kapalı gün kanıtıdır,
  raporsuz AsilPOS günü ay rakamına girer (B09, yukarıda "Kasa raporu"); ürün satışları aylık modele girer, satış
  tahmini raporsuz günde AsilPOS Z'sini okur (B08, yukarıda "Günlük satış"); Komisyon & hakediş kart kart satışı AsilPOS'un
  ödeme türlerinden alır, ürün ikramı AsilPOS'tan gelir ve panelde girilmez (B10, yukarıda "Komisyon" ve "İkram");
  "Kasadaki fiyatlar" yalnız siteye bağlı olmayan, fiyatı AsilPOS günü panelde değişen ürünler içindir ve yalnız
  yöneticinin işidir, ModPOS metinleri AsilPOS der (B11, aşağıda
  "Metinler ve kasadaki fiyatlar"); Marina'nın tahmini stoğu AsilPOS'un satışlarını, ikram ve zayisini okur
  ([STOK-TAHMINI.md](STOK-TAHMINI.md)). Onay penceresinin listesi (`ASILPOS_SWITCH_EFFECTS`) kodun yaptığından fazlasını
  söylemez.
- **Kural tek yerde:** `src/lib/asilpos/switch.ts` (`isAsilposDay`, `kasaName`, `monthSource`, `switchAffectedMonths`,
  `modposListCounts`, `asilposSalesFrom`, `asilposCountFrom`);
  okuma kuralı `src/lib/constants.ts` › `readAsilposSwitchDay` (takvimde olan gün, 1 Ekim 2026'dan önce değil; bozuk değer
  `null`). Geçiş gününü okuyan her yer bu yardımcılardan geçer.
- **Kim, nasıl:** yalnız yönetici (`saveAsilposSwitchDay`, `src/server/actions/asilpos.ts`; rol çekirdekte de denetlenir,
  `src/server/asilpos/admin.ts`). Kaydetmeden önce onay penceresi: neyin değiştiği ve kaynağı değişen günlerin ayları.
  En erken 1 Ekim 2026, en çok 90 gün ileride. FIFO başlangıcı gibi parola istemez; işlem geçmişine "AsilPOS'a geçiş
  günü: yok (kasa ModPOS) → 10 Kasım 2026" düşer. Boşaltmak günü siler (şube ayarına `null`; eski kayıt yazılmaz).
- **Anahtar panelde de saklanabilir** (25 Kasım 2026): Şube ayarları › AsilPOS bağlantısı'nda (yalnız AsilPOS'un şubesi,
  kütükte kaynağı ModPOS görünse de; yalnız yönetici, **parolasıyla**) `secret-box` ile şifreli; ortamdaki
  `ASILPOS_SYNC_SECRET`'ın önüne geçer, en az 32 karakter, sitenin anahtarı (`KARAOKE_SYNC_SECRET`) reddedilir.
  Tarayıcıya, işlem geçmişine ve yedeğe gitmez; ekran yalnız "Panelde kayıtlı / Sunucuda kayıtlı / Anahtar yok" der,
  Ayarlar › AsilPOS anahtarın nereden okunduğunu yazıp şube sayfasına bağlanır. Silinince ortamdaki kullanılır; kasa
  kaynağı başka şubeye geçtiyse eski şubede kalan anahtar o şubenin sayfasından silinir. İmzalı uçların hepsi
  anahtarı isteğe göre okur (`await asilposRequestSecret(request)`, `src/server/asilpos/branch.ts` › `asilposSecretFor`;
  veritabanı okunamazsa uç 503 döner). **Döndürülen anahtar her sunucu örneğinde hemen geçersiz** (güvenlik notu, 26
  Kasım 2026): panelde saklanan anahtar 60 sn önbellekli ama önbellek yalnız ön süzgeçtir. İmza önbellekteki anahtarla
  tutarsa anahtar kabulden önce veritabanından (AsilPOS'un şubesi dahil, önbelleksiz) yeniden okunur; başka bir örnekte
  döndürüldüyse eski anahtarla imzalı istek 401 alır ve önbellek yenilenir. Bu okuma yalnız imzası tutan (AsilPOS'un
  kendi) isteklerinde olur; imzasız ya da yanlış imzalı istek veritabanını okutmaz, yalnız önbellek
  `ASILPOS_SECRET_RELOAD_MS`'tan (10 sn) eskiyse bir kez yeniden okunur: yeni anahtar başka örneklerde de en geç 10 sn
  sonra geçer (eskiden 60 sn). Anahtarı kaydeden örnekte önbellek kayıtta hemen düşer. Deneme:
  `tests/sube-ayarlari-2-db.test.ts` (iki örnek: eski anahtar geçmez, imzası tutmayan istek okuma yapmaz).
- **Hiçbir veri yazılmaz ya da silinmez:** ayar yalnız okuyanları değiştirir; geri almak günü değiştirmek ya da
  boşaltmaktır. Tercihen ayın 1'i (ModPOS'un o ayki ürün listesi bölünmez).
- **AsilPOS kendi tarihini tutmaz:** bütün gerçek günleri gönderir; neyin sayıldığına panel karar verir ve yanıtta söyler
  (`counted`, `switchDay`).
- **Yalnız AsilPOS'un şubesinin kasası** (aşağıda, "Şubeler"): Tuzla'nın kasası ModPOS'ta kalır.

### Şubeler (denetim 21 Kasım #5)

AsilPOS 21 Kasım 2026'dan beri **Marina**'da kurulu (#98): gün sonunu Marina'ya yazar ve geçiş günü **yalnız Marina'nın
kasasınındır**. Gövdedeki `sube` alanı (AsilPOS › Yönetim › Ayarlar ve yedek › Şube) AsilPOS'un şubesi değilse gün
yazılmaz: 409 `{ error: "wrong_branch", sube, expected }`; Ayarlar ›
AsilPOS kartı kasanın hangi şubeye ayarlı olduğunu ve ne yapılacağını yazar (`rejectionText`). Eski kasa `sube`
göndermez, kabul edilir (bugünkü AsilPOS her zaman gönderir). Ayarlar › AsilPOS kartı yalnız Marina'nın kaydını sayar
(günler, toplam, eşleşmeyen adlar, ikram): öteki şubenin ModPOS günleri karışmaz, panelde seçili şube kartı
değiştirmez (`loadAsilposCard`, `tests/asilpos-db.test.ts`). Tuzla'nın kasası ModPOS'tur ([SUBE.md](SUBE.md)); geçiş
günü seçilince Tuzla'da hiçbir şey değişmez. Marina'da ModPOS bir daha kullanılmaz (sahip, 23 Kasım 2026): Marina'nın
ModPOS dönemi yalnız 13–21 Kasım 2026'dır. Geçiş gününden sonra Marina için gelen ModPOS verisi hiçbir rakama girmez;
föyün yedek çekimi sürüyorsa (kasa kaynağı Ayarlar › Şubeler'de hâlâ ModPOS) saklanır ama sayılmaz, kaynağı AsilPOS
yapmak çekimi durdurur (saklı föyler kalır).

**AsilPOS'un şubesi kütükten (şube kapsamı B6, 25 Kasım 2026).** Şube artık sabit değil: Ayarlar › Şubeler'de kasa
kaynağı **AsilPOS** olan etkin fiziksel şube (`asilposBranchOf`, saf; sunucuda `asilposBranchId`,
`src/server/asilpos/branch.ts`). Kütükte AsilPOS kasalı şube yoksa geri düşüş `ASILPOS_BRANCH_ID = "marina"`: bugünkü
kurulumda Marina'nın kaynağı ModPOS (föyün yedek çekimi) da olsa AsilPOS'un şubesi Marina kalır, davranış değişmez.
Kaynağı başka şubeye geçirmek gün sonunu, geçiş gününü, `sube` denetimini (gün sonu, ModPOS dönemi ve personel uçları),
otomatik raporu ve e-postaları, kasadan çıkanları, fotoğrafı, devri, veri kümesini (satış listeleri, ikram, yemek
kartı, komisyon) o şubeye taşır. AsilPOS bugün **yalnız bir şubenin** kasası olabilir: ikinci şubenin kaynağı AsilPOS
yapılamaz ("AsilPOS şimdilik yalnız bir şubenin kasası olabilir; Tuzla şubesinin kasası zaten AsilPOS"). Geri düşüşle
tutan Marina (kütükte ModPOS) geçiş günü ya da kayıtlı AsilPOS günü taşıyorsa da Tuzla ya da yeni şube AsilPOS yapılamaz
(`asilposInUse`; "AsilPOS günleri Marina şubesine yazılıyor"): AsilPOS'un şubesi sessizce taşınmaz. Okuyucu
önbelleklidir (60 sn, bağlantı başına); şube eylemi önbelleği hemen düşürür, başka sunucu örneği en geç 60 sn sonra
yeniler. Saf yardımcılar (`branchSwitchDay`, `isAsilposBranch`, `scopeSwitchDay`, `panelWasteCounts`, `listDiscountOf`,
`tillMonths`, `modposMismatches`, `mergeSalesSources`, `commissionScopeDays`…) şubeyi son parametre olarak alır,
verilmezse geri düşüşe düşer; sunucu ve sayfalar her çağrıda verir (`tests/asilpos-sube.test.ts` kaynağı denetler,
`tests/asilpos-sube-db.test.ts` gerçek veritabanında). Şube kapsamından önceki eski genel kaydın sahibi (çalışan listesi,
`legacyOwnerId`) tarihseldir, kütükten türetilmez.

Kural tek yerde: `branchSwitchDay(geçiş günü, şube)` AsilPOS'un şubesinde ayarı, öteki şubede ve online kanalda `null`
(her günü ModPOS günü) verir; şubesiz eski kayıt Tuzla'nındır (`isAsilposBranch`). Tek kasanın gününe bakan her yer geçiş
gününü kasanın şubesinden geçirir:

| Yer | Tuzla'da (ModPOS) |
|---|---|
| Sabah işi ve Ayarlar › ModPOS kartı (`sync.ts`, `status.ts`) | Föy geçiş gününden sonra da çekilir, eksik gün sayılır |
| Kasa raporu, geç rapor, fotoğraf kaldırma (`loadKasaAsilpos`, `kasaEvidence`, `loadKasaAsilposDays`) | ModPOS'a göre: AsilPOS bandı yok, kanıt ModPOS Z fotoğrafı |
| Föy ↔ rapor (`loadKasaModpos`, `loadKasaModposDays`, `modposMismatches`: Kasa, zil, Bugün, sabah e-postası) | Karşılaştırılmaya devam eder |
| Ay rakamına föy yedeği (`modposTillRows`) | Föyü geçiş gününden sonra da girer (Marina'nınki girmez) |
| Zayi & ikram (`loadDayAsilposIkram`, zayi eylemleri, Onaylar'daki zayi kartı) | Ürün ikramı panele girilir ve sayılır |
| Kasadaki fiyatlar (`loadTillScope`, kasanın şubesine göre) | ModPOS listesi, personel işaretler |
| Bugün'ün ve zilin akşam satırı, fotoğraf okuma önerisi | ModPOS der |
| Satışlar: içe aktarma ve elle satır (`modposImportRule`, `saveLine`; listenin şubesine göre) | Her ayın listesi yüklenir |

Veri kümesi (ay ekranları) görünümün geçiş gününü okur (`scopeSwitchDay`): Tuzla ya da online kanal seçiliyken geçiş
günü yok sayılır (AsilPOS hiç okunmaz, etiketler ModPOS der); Marina'da ayar. **"Tümü"de** ayar geçerlidir ama satırlar
şube şube ayrılır: ModPOS'taki şubenin (Tuzla) listesi her ay sayılır (`mergeSalesSources`), AsilPOS'un sayılmaya
başladığı gün ve Satışlar'ın uyarıları yalnız AsilPOS'un şubesinin listesine ve kasa raporlarına bakar, AsilPOS gün sonu
yalnız o şubenin panel ikramını düşürür (`panelWasteCounts`, kaydın şubesiyle). Satışlar'ın içe aktarması "Tümü"de
varsayılan şubeye (Tuzla) yazar; Marina'nın listesi Marina seçiliyken yüklenir. Komisyon & hakediş satışı seçili
şubeden okur, faturalar, oran ve hakediş işletmenindir; AsilPOS'un girdiği ayda markası belirsiz tutar hiçbir kanala
yazılmaz (23 Kasım 2026; `asilposMonth`, [KOMISYON.md](KOMISYON.md) › Şube ve §3).

"Kafe kapalıydı" şubenindir ([SUBE.md › Kasa raporu "Tümü"de › Kapalı gün](SUBE.md#kasa-raporu-tümüde-20-kasım-2026)): Marina'nın satışlı
AsilPOS gün sonu Marina'nın kapalı gününün kanıtıdır, Tuzla'nınkinin değil. Şube verilmeyen okuma da AsilPOS kanıtı olarak
yalnız AsilPOS'un şubesinin gün sonunu okur (`asilposEvidence`, 22 Kasım 2026): Tuzla'nın eski deneme satırı kanıt sayılmaz.
Kasadaki fiyatlar
şube başınadır (`pos_stale`, `pos_marks.branch_id`; 24 Kasım 2026, [FIYATLAR.md › Şube başına kasa](FIYATLAR.md#şube-başına-kasa-şube-kapsamı-a3-24-kasım-2026)):
Tuzla'da (ModPOS) işaretlenen ürün Marina'nın AsilPOS listesinde kalır, Marina'da işaretlenen Tuzla'nınkinde.

İleride Tuzla da AsilPOS'a geçerse geçiş günü şube başına tutulur (okuyucular zaten `branchSwitchDay` /
`scopeSwitchDay`'den geçer).

### Metinler ve kasadaki fiyatlar (denetim B11, E-39)

Denetimin önerdiği ayrı "kasa kipi" ayarı (ya da "son günlerde AsilPOS günü geldiyse AsilPOS" sezgisi) yerine geçiş günü
kullanılır: deneme günleri hiçbir metni değiştirmez. Günün kasası `kasaName(gün, geçiş günü)`, ayın kasası
`monthKasa(ay, geçiş günü)` (`src/lib/asilpos/kasa.ts`; geçiş ayında "Kasa (ModPOS 1–9 Kasım · AsilPOS 10–30 Kasım)").
Ürün satışlarının etiketi (Genel bakış'ın net satışı, dışa aktarımın Özet'i, Claude'un ürün kârlılığı) geçiş ayında modelin
saydığı bölünmeyi yazar (`salesMonthKasa`: ModPOS listesinin son günü, AsilPOS'un sayılan günleri; liste yoksa "ModPOS
listesi yok"); Z ve ciro etiketleri geçiş gününde böler. Geçiş günü boşken her metin bugünkünün aynısıdır.

- **Kasadaki fiyatlar** (`docs/FIYATLAR.md` › AsilPOS'a geçiş gününden itibaren): bugün AsilPOS günüyse siteye bağlı
  ürün Kasaya işle'de görünmez (AsilPOS fiyatı siteden alır); kasanın ModPOS durumu yine yazılır, geçiş günü kaldırılır
  ya da ileri alınırsa eksiksiz geri gelir. Bağlı olmayan ürün yalnız fiyatı AsilPOS başladıktan sonra panelde
  değiştiyse görünür; metin "AsilPOS ürünü siteden alıyorsa Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin;
  yerelse AsilPOS'ta elle" der. Bu iş yalnız yöneticinindir (AsilPOS'ta ürün fiyatını kasiyer değiştiremez): personelin
  zilinde ve Bugün'ünde satır yok, Kasadaki fiyatlar boş, işaret eylemi personeli reddeder. Zil, Bugün, haftalık özet,
  ürün kartı, Ürünler ve Fiyatlar aynı süzgeçten okur (`src/server/data/till-scope.ts`).
- **Günün kasası:** Bugün'ün ve zilin akşam satırı ("Kapanışta AsilPOS'ta Günü kapat'a basın; rapor AsilPOS'tan gelir"), Kasa raporunun
  başlığı, yazarkasa karşılaştırmaları (form, kayıtlı görünüm, onay kartı, e-posta, WhatsApp: "Kart AsilPOS ile aynı",
  "AsilPOS kart"), günün online satış satırı, kapalı gün kartı ve Bugün'ün kapalı gün satırı ("o günün AsilPOS / banka
  POS'una bakın"). AsilPOS gününde yazarkasa bölümüne çekilen kasa çıktısına "ModPOS bölümüne okut" önerilmez.
- **Ayın kasası:** Genel bakış (net satış, POS cirosu, döküm), Gelir-gider (online kartı, yıl dökümü, telefon görünümü,
  tablo ipuçları), Tutarlılık, Ürünler, Analiz'in senaryosu, KDV tahmini, dışa aktarım ve Claude'un yanıtları.
- **Ayın satış kaynağı** (`salesSourceOf`, `src/lib/sales-source.ts`; 29 Eki 2026, [planlar/ux-sade.md](planlar/ux-sade.md)
  §10): `salesMonthKasa`'nın üstünde tek kaynak. Dört tür: **ModPOS raporu** (geçiş günü yok ya da ay geçişten önce;
  "Satışlar: ModPOS raporu (ay sonunda elle yüklenir)"), **AsilPOS** ("Satışlar: AsilPOS (her gece kendiliğinden)"),
  **geçiş ayı** ("Satışlar: Kasa (ModPOS 1–9 Kasım · AsilPOS 10–30 Kasım)") ve ileride **ModPOS bağlantısı**
  (`connectedMonths`; bugün hiçbir çağıran vermez). Her biri kısa ad (`label`), başlığın altındaki satır (`line`,
  `SalesSourceLine` ile `PageHeader meta`), veri yokken ne yapılacağı (`missing`) ve elle yüklenip yüklenmediği
  (`manual`) taşır. Satır Genel bakış, Satışlar, Gelir-gider, Ürünler & kârlılık, Tutarlılık ve Analiz & senaryo'da;
  Satışlar'ın açıklaması türüne göre; "satış raporunu yükleyin" diyen metinler (Analiz, Fiyatlar, fiyat etkisi paneli,
  tatlı tahmini, Tutarlılık) `missing`'i, Genel bakış'ın "Satış raporu" işi `manual`'ı okur (AsilPOS ayında "yükle"
  demez). Yalnız yönetici ekranları içe aktarır. Bilerek bağlanmayanlar: hesap katmanı (`insights.ts`), haftalık
  e-posta, ModPOS listesi ile AsilPOS çakışma cümleleri (`sales.ts`; zaten "ModPOS listesi" der).
- Yardım (yönetici ve personel) AsilPOS'a geçildiyse ne değiştiğini yazar: akşam kasası (AsilPOS'ta Günü kapat, form gün
  sonundan dolar, ModPOS Z fotoğrafı yok, yazarkasa AsilPOS'la karşılaştırılır), banka POS Z'si, kasadaki fiyatlar
  (personele düşmez; yönetici bağlar ya da AsilPOS'ta değiştirir), Tükendi'nin kasaya da yansıması (gün açıkken en geç
  15 dakika; acilse AsilPOS'ta da Tükendi).

## Durum ve onarım

`POST /api/pos/gun`'un her sonucu `integration_state`'in `asilpos` satırına yazılır (`handlePosDay`,
`src/server/asilpos/status.ts`; denetim ve yazım yine `receivePosDay`'de):

| Sonuç | Yazılan |
|-------|---------|
| 200 | `lastOk`: an, gün, Z no, satır sayısı, `counted`; o günün `rejections` kaydı silinir (gün yeniden yazıldı) |
| 400, 409, 500 (imza doğrulanmış) | `lastError`: an, durum, hata, alan (400), gün, paneldeki Z (409), gönderilen Z (409). Günü okunan 400 ve 409 ayrıca `rejections[gün]`'e (aynı günün eskisinin yerine, en çok 10 gün; satır kilitlenerek) |
| 401, 413 (imza doğrulanamadı) | yalnız `unverified`: sayaç, son an, son durum. Gövde okunmaz; yazım örnek başına dakikada bir (imzasız istek yağmuru yazım yağmuru olmasın), aradakiler bellekte birikip sonraki yazıma eklenir: sayaç "en az" |
| 503 (anahtar yok) | hiçbir şey |

Retler gövdesiz günlüğe de düşer: `[asilpos] reddedildi 409 z_conflict 2026-10-26 127`. Durum yazımı yanıtı hiçbir
zaman bozmaz. Durum satırı aynı anda gelen iki sonucun alanını ezmez (üst düzey birleştirme).

**AsilPOS 400 ve 409'u kendisi yeniden denemez** (giden kutusunda bir yıl bekletir; AsilPOS
`server/sync/lafmaliyet.ts`): reddedilen ya da panelde silinen gün ancak AsilPOS'ta **Kasa › Geçmiş günler › o günün Z
raporu › Gönder** ile yeniden gelir. Bu yüzden günlü ret güne göre tutulur: sonraki günün başarılı gönderimi ya da başka
bir günün reddi onu örtmez. Kartta durumu o günün paneldeki kaydından okunur (`dayRejectionStatus`): gün retten sonra
yeniden yazıldıysa çözüldü (gösterilmez), yönetici sildiyse ya da 409'un günü panelde yoksa "AsilPOS'tan Gönder
bekleniyor" (turuncu), değilse açık (kırmızı). 500'ü AsilPOS kendisi yeniden dener: güne bağlanamayan ret (500 ve gövdesi
okunamayan 400) son başarılı gönderimden yeniyse kırmızı, değilse gri "Önceki ret".

**Ayarlar › AsilPOS (kasa)** kartı (yalnız yönetici; saf özet `asilposCardSummary`, `src/lib/asilpos/status.ts`):

- Durum, sakin dille: "Henüz kurulmadı · kasada ModPOS kullanılıyor." (gri, hata değil) · "Bağlı · geçiş günü
  seçilmedi: AsilPOS günleri saklanıyor, hesaplara girmiyor." · "Geçiş günü 10 Kasım 2026 (4 gün sonra). O güne kadar
  kasa ModPOS." · "Kasa AsilPOS (10 Kasım'dan beri)." ve son gün sonu. Kırmızı yalnız geçiş günü seçili ama anahtar
  yokken ("AsilPOS günleri gelemez"). Anahtar 32 karakterden kısa ya da sitenin anahtarıyla aynıysa nedeni yazılır.
- Güne göre açık retler (kırmızı, her biri kendi kutusunda, en yeni gün önce) ve metni; 409'da, gün hâlâ reddeden Z ile
  kayıtlıysa **Bu günün AsilPOS kaydını sil**. Silinen gün "AsilPOS'tan Gönder bekleniyor" (turuncu) olur, AsilPOS'tan
  gelince kalkar. Güne bağlanamayan son ret ayrı kutuda. Telefonda kapalı özetin başına yazılır ("7 Kasım gönderimi
  reddedildi", "2 gönderim reddedildi", "7 Kasım için AsilPOS'tan Gönder bekleniyor"). Anahtar yokken retler kırmızı
  değildir.
- İmzası doğrulanamayan istekler (son 14 gün): son an ve sayaç. Yabancı bir istek de olabilir: metin suçlamaz
  ("AsilPOS'tansa anahtarı ve kafedeki saati (±5 dk) denetleyin"); o istekten sonra başarılı gönderim geldiyse turuncu
  değil, soluk bilgi.
- Geçiş günü alanı ve onay penceresi.
- Gelen günler (en yeni 14): Z, fiş, ciro, satır, geliş anı, **Sayılıyor** ya da **Deneme**, satır sonunda sil.
- Geçiş gününden düne gün sonu gelmeyen günler (onaylı kapalı günler hariç, en çok son 60 gün), ipucuyla: AsilPOS'ta
  Yönetim › Entegrasyon'daki giden kutusu; reddedilen gün Kasa › Geçmiş günler › Z raporu › Gönder ile yeniden gider.
- Ürüne bağlanamayan POS adları (hizmet satırları hariç, en çok satılan 10 ad): ad, adet, gün ve **Bağla** (ürün ya da
  HİZMET seçilir; `matchAsilposName`, ay olmadan). Ad Satışlar'ın POS adı hafızasına yazılır, bu adla gelmiş bütün
  ürünsüz satırlar (deneme günleri dahil) hemen bağlanır, sonraki gün sonları da tanır; hiçbir hesap değişmez (geçiş
  günü boşken satırlar sayılmaz). Hafıza ModPOS listeleriyle ortaktır: aynı ad sonraki ModPOS yüklemelerinde de tanınır.
  Yalnız AsilPOS'ta geçen ad (hiçbir ModPOS listesinde yok) Kasadaki fiyatlar'da (personel ve yönetici listesi) "Kasada:
  …" diye gösterilmez (`modposNameFilter`). Ürün sitenin kalemine Ürünler › Site menüsü'nde de bağlanabilir; geçiş
  gününden sonraki aylarda Satışlar'da da eşleştirilir.

**Zil (26 Kasım 2026):** sayılan AsilPOS gününün (geçiş günü ve sonrası) reddi yöneticinin zilinin **Sistem** başlığına
düşer; önceden yalnız bu kartta görünüyordu, gün sonu e-postası da (gün yazılmadığı için) hiç gitmiyordu. Satır "Marina
gün sonu alınamadı: <neden>" (Z numarası çakıştı / gönderim sözleşmeye uymadı / kasa başka şubeye ayarlı), gövdesi
gün, ne olduğu ve ne yapılacağı ("25 Kasım: panelde Z 127 kayıtlı, AsilPOS Z 128 gönderdi. AsilPOS'taki doğruysa Ayarlar ›
AsilPOS'ta bu günün kaydını silin, sonra AsilPOS'tan o günü Gönder'e basın."); bu karta götürür (`?sube=` AsilPOS'un
şubesi). Ayrı kayıt yok: satır `rejections`'tan türer (`rejectionBells`, `src/lib/asilpos/status.ts`;
`src/server/bell/asilpos.ts`). Kimliği gün ve nedenden (`asilpos-ret-<gün>-<hata>`): AsilPOS aynı günü aynı nedenle yeniden
gönderip yine reddedilse satır yinelenmez, başka bir neden yeni satırdır. Yalnız açık ret (gün yeniden yazılınca ya da
yönetici kaydı silince kalkar) ve son 7 günde gelen; deneme günü (geçişten önce) zile düşmez. Personelin zilinde yok.

**Bu günün AsilPOS kaydını sil** (`deleteAsilposDay`; çekirdek `removeAsilposDay`, `src/server/asilpos/admin.ts`): yalnız
yönetici, kendi parolasıyla (`requireStepUp`, yanlışı işlem geçmişine "Hatalı parola onayı (AsilPOS)"). Yalnız AsilPOS'un
şubesinin (Marina) günü silinir; parolayı sormadan önceki "gün kayıtlı mı" denetimi de yalnız onun satırına bakar (22 Kasım
2026): Tuzla'nın aynı günkü eski deneme satırı için parola sorulmaz, ona dokunulmaz. Gün sonunun
yazımıyla aynı danışma kilidi (`lafpos-gun:<şube>:<gün>`) altında, tek işlemde `pos_day_reports` ve `pos_daily_sales`
satırlarını siler (sürüm geçmişi, `pos_day_revisions`, kalır: silinen Z'nin gövdeleri denetim için); yalnız yöneticinin gördüğü Z'ye koşullu (bu arada başka Z ile yeniden yazılan gün silinmez). Durum
satırındaki o günün reddi yalnız bu silmenin çözdüğü çakışmaysa (409, aynı Z) "silindi" olur; aynı günün 400'ü alanı ve
nedeniyle açık kalır. **AsilPOS silinen günü kendisi yeniden göndermez**: sonra AsilPOS'ta Kasa › Geçmiş günler › o günün
Z raporu › **Gönder**'e basılır; o güne kadar kart "AsilPOS'tan Gönder bekleniyor" der, gün gelince kalkar. İşlem
geçmişi: "AsilPOS günü silindi · 26 Ekim 2026 · Z 127 · 42 satır". Deneme günlerini temizlemek için de kullanılır (aynı
kural: yeniden gelmesi için Gönder). Günün Kasadan çıkanlar'daki AsilPOS satırları da aynı işlemde AsilPOS'tan ayrılır
(yukarıda "Kasadan çıkanlar AsilPOS'tan"): deneme gününde AsilPOS'un açtıkları kalkar, sayılan günde hepsi kalır.

## Şube kurulumu (26 Kasım 2026)

Sahibin isteği: yeni şube panelden eklenince kasası da kendiliğinden kurulsun. Akış:

1. **Şubeyi yalnız ana yönetici ekler** (`info@nextgenlab.com.tr`; ortamda `LADMIN_ANA_ADMIN` ile değişir;
   `isAnaAdmin`, `requireAnaAdmin`). Öbür yöneticiler Şubeler'i görür ve düzenler, "Şube ekle" ve kurulum bağlantısı
   onlarda yoktur; eylem de sunucuda reddeder (`createBranch`, `sendBranchInstall`).
2. Ayarlar › Şubeler › **Şube ekle**'de fiziksel şubeye **e-posta** yazılırsa (`branches.email`):
   - şubenin panel hesabı açılır (personel, şubede kilitli, ad "<Şube> şubesi"; davetle, 72 saat; adres zaten şubesiz
     ya da aynı şubedeki bir personel hesabındaysa hesap yeniden açılmaz; başka şubedeki personelde, yöneticide,
     müdürde ya da muhasebecide ise eklenmez, `branchEmailTaken`: kurulum bağlantısı kasanın eşitleme anahtarını verir);
   - şubeye özel **AsilPOS kurulum bağlantısı** üretilir (`asilpos_installs`, 32 bayt kod, 14 gün; yeni bağlantı eskisini
     iptal eder);
   - ikisi tek e-postayla gider (`kurulumMail`; Resend kurulu değilse gitmez, bağlantı ekranda gösterilir, elle iletilir).
   Var olan şubeye (Marina gibi) şubenin düzenleme penceresinden **AsilPOS kurulum bağlantısı gönder**.
   Kısa yol: Şubeler'in üstündeki **AsilPOS kasası kur** kartı (yalnız ana yönetici). "Kasa kur" penceresinde **kasanın
   bağlanacağı şube** listeden seçilir ya da **+ Yeni şube ekle** ile aynı pencerede eklenir (ad, kimlik, kasa kaynağı,
   açılış günü), e-posta yazılır; bağlantı gider. Kartta her açık fiziksel şubenin kurulum durumu ve "Bağlantı gönder" /
   "Yeniden kur" düğmesi durur (`src/app/panel/subeler/asilpos-install.tsx`).
3. Şube hesabı girince **Hesabım › AsilPOS kurulumu** kartında bağlantı ve durum (Kurulum bekliyor / Kasa kuruldu).
   Kartı **yalnız şubenin kendi hesabı** görür: bağlantının gittiği adresteki, o şubeye kilitli personel hesabı
   (`isBranchAccount`, `installForAccount`). Şubenin öbür personeli (ortak tablette sırayla giren baristalar), müdürü,
   muhasebeci ve yöneticiler görmez; ham kod sayfaya da gitmez: bağlantıdaki kod tek kullanımlıktır ve kasanın
   eşitleme anahtarını verir. Bağlantı yeni bir adrese gönderilince kart eski hesaptan kalkar.
4. Bağlantı (`GET /asilpos/indir/<kod>`, oturumsuz; gönderilmiş e-postalardaki eski `/lafpos/indir/<kod>` de aynı
   işleyici) kanaldaki genel kurucuyu (`https://lafpos.laffogato.net/guncelleme/AsilPOS-Kur.cmd`; kanal onu yayımlamıyorsa
   404'te eski adlı `LafPOS-Kur.cmd`; ortamda `ASILPOS_KURUCU_URL` tanımlıysa yalnız o) indirir, içindeki iki boş satıra (`$KurulumAdresi = ''`, `$KurulumKodu = ''`) panelin adresini ve
   kodu yazar, `AsilPOS-Kur-<şube>.cmd` olarak verir (`kurucuWithCode`). Kod indirmede harcanmaz.
5. Kurucu kodu kasanın veri klasörüne yazar; kasa ilk açılışta kodu bir kez verir: **`POST /api/asilpos/kurulum`**
   (kurulu ve eski kasalar `/api/lafpos/kurulum`'u çağırır; aynı işleyici ve aynı IP sınırı)
   `{ "kod": "…" }` → 200 `{ ok: true, sube: { id, ad }, baglanti: { LAFMALIYET_URL, LAFMALIYET_SYNC_SECRET,
   LAFPOS_CLOUD_URL?, LAFPOS_CLOUD_SECRET?, LAFFOGATO_URL?, LAFFOGATO_SYNC_SECRET? } }` (Uzaktan anahtarları kasanın
   ayarlar dosyasının adlarıyla, eski adla gider: kurulu kasanın beyaz listesi onları tanır); 404 kod yok, 410 kullanılmış /
   iptal / süresi dolmuş, 400 biçim, 429 çok deneme (IP başına 15 dk'da 20). Kod koşullu güncellemeyle bir kez geçer.
   Anahtar AsilPOS'un şu anki anahtarı (`asilposSecret`); AsilPOS Uzaktan ve site yalnız panelin ortamında
   `ASILPOS_CLOUD_URL` + `ASILPOS_CLOUD_SECRET`, `ASILPOS_SITE_URL` + `ASILPOS_SITE_SECRET` (en az 32 karakter) tanımlıysa;
   eski adları da okunur (önce `ASILPOS_CLOUD_*`, yoksa `LAFPOS_CLOUD_*`; önce `ASILPOS_SITE_*`, yoksa `LAFPOS_SITE_*`).
   Kasa şube kimliğini ve bağlantıları yazar, yeniden başlar; Merkez'e (uzaktan yönetim) şubenin adıyla kaydolur.
   Kasa tarafı: AsilPOS deposunda `server/sync/kurulum-kodu.ts`, `docs/03-ENTEGRASYON.md` "Şube kurulumu".

Kurallar `src/lib/asilpos/kurulum.ts` ve `kurulum-mail.ts` (saf, `tests/asilpos-kurulum.test.ts`), sunucu
`src/server/asilpos/kurulum.ts` (gerçek Postgres'te `tests/asilpos-kurulum-db.test.ts`), uçlar `src/server/asilpos/kurulum-route.ts` ve `indir-route.ts` (yeni ve eski yolun `route.ts`'i bunları dışa verir), göç
`0095_lafpos_kurulum.sql`.

**Anahtar değişimi:** kurulu kasalar Uzaktan ve site bağlantısını da buradan alır: `GET /api/panel/pos/baglanti`
(AsilPOS imzasıyla; `src/app/api/panel/pos/baglanti/route.ts`, değerler `dagitilanBaglantilar`,
`src/lib/asilpos/baglanti-dagitim.ts`) panelin ortamındaki `ASILPOS_CLOUD_*` ve `ASILPOS_SITE_*`'ı ve kısa özetini
(`surum`) verir. Kasa değişeni bekletir, gün kapanınca yazar ve sonraki sorgularda `uygulanan=<sürüm>` der; uç bunu
günlüğe yazar (`[asilpos baglanti] sube=… uygulanan=… guncel=…`). Anahtar değişiminde sıra: önce panelin ortamına yeni
değer, kasalar gece alır (günlükte `uygulanan` = `guncel`), sonra AsilPOS Uzaktan'daki ve sitedeki anahtar değişir.

**Sınır (bilerek ertelendi):** AsilPOS bugün yalnız bir şubenin kasası (`asilposSourceError`, aşağıda "Şubeler"). Marina
AsilPOS'tayken yeni şube "Kasa kaynağı: AsilPOS" ile eklenemez; ModPOS seçilip eklenir, kasa kurulur ve çalışır (satış,
uzaktan yönetim), ama gün sonu bu panele `wrong_branch` (409) ile girmez, kasada bekler. Birden çok AsilPOS şubesi için
`asilposBranchId()`'yi kullanan her yer (gün sonu alımı, gün sonu otomasyonu, kasa raporu, komisyon, Bugün, anahtar
seçimi) şube başına çalışmalı; ayrı iş.

## Açılış sırası

Sahibin istediği tek liste; AsilPOS deposunda `docs/03-ENTEGRASYON.md` › "Açılış sırası" aynı adımlardır. Partiler
birleşip yayına çıkmak hiçbir şeyi açmaz: anahtar ve geçiş günü yokken üç sistem bugünkü gibi çalışır.

1. **Anahtarlar** (bu parti yayındayken, en erken): bir anahtar üretin, `openssl rand -base64 48` (en az 32 karakter).
   Vercel'de bu projeye (yalnız Production) `ASILPOS_SYNC_SECRET`; AsilPOS'un `.env`'ine aynı değerle
   `LAFMALIYET_SYNC_SECRET` ve `LAFMALIYET_URL=https://ladmin.laffogato.net`. Sitenin `KARAOKE_SYNC_SECRET`'ından
   **ayrı** olsun: kafedeki makinede sitenin anahtarı durmaz, ikisi ayrı döndürülür; aynıysa panel bağlantıyı açmaz
   (kart nedenini yazar). Sitenin (laffogato) kendi anahtarı **başka bir değerdir**: sitede eski adla durur,
   `LAFPOS_SYNC_SECRET` (panelin `ASILPOS_SYNC_SECRET`'ının eski adıyla aynı ad), değerleri ayrı. Paneli yeniden yayınlayın. Migration'lar (`0040_lafpos_baglantisi`, `0041_kasaya_giren`) zaten
   canlıda.
2. **Deneme gönderimi:** AsilPOS kurulum modundan çıkmışken gerçek bir günü kapatın (ModPOS'la paralel olabilir).
   Ayarlar › AsilPOS (kasa)'da gün **Deneme** olarak görünür, yanıt `counted: false`; başka hiçbir ekranda görünmez.
   Retler aynı kartta. Kartın "Ürüne bağlanamayan POS adları" listesinde adlar **Bağla** ile ürüne bağlanır (ya da
   ürün Ürünler › Site menüsü'nde sitenin kalemine bağlanır); kayıtlı günler de hemen güncellenir. Liste öneridir, ön
   koşul değil. Eğitim / kurulum günleri geldiyse kartta silin.
3. **Geçiş günü:** Ayarlar › AsilPOS (kasa) › AsilPOS'a geçiş günü (tercihen ayın 1'i). O günden itibaren Kasa raporunda
   bant çıkar, ürün satışları AsilPOS'tan gelir ve sonraki partilerin okuyucuları AsilPOS'a geçer. Geçiş günü ayın
   ortasındaysa o ayın ModPOS listesi Satışlar'a geçiş gününden önceki günler için yüklenir (1–9 Kasım; yükleme o güne
   kırpar). Geçiş günü yalnız Marina'nın kasasınındır; Tuzla'da hiçbir şey değişmez ("Şubeler").

### Personel bağlantısı: `GET /api/panel/pos/personel` ve `workedStaffRefs` (LM-4b, 24 Kasım 2026)

Sahibin kararı 2 (23 Kasım 2026): "ladmin'de zaten hesapları var; doğru hesabı bağladığından emin ol". AsilPOS kullanıcısı
lafmaliyet'in **maaş satırına** (`staff.id`, kimliği `s:<id>`; yemek kartı, maaş ve şube orada) yalnız AsilPOS'ta, Yönetim ›
Personel'de iki tarafı gösteren onayla, elle bağlanır; hiçbir şey kendiliğinden bağlanmaz (AsilPOS docs/03-ENTEGRASYON.md
§4.8). lafmaliyet gelen her kimliği kendi satırına göre doğrular. Kurallar `src/lib/asilpos/personel.ts`; testleri
`tests/personel-asilpos.test.ts`, `tests/personel-asilpos-db.test.ts`.

- **Liste:** imzalı `GET /api/panel/pos/personel?sube=marina` (`src/server/asilpos/personel.ts` servePosStaff; ModPOS dönemi
  ucuyla aynı denetim: anahtar 503, imza 401, şube yoksa 400, `sube` AsilPOS'un şubesi değilse 409 `wrong_branch`).
  `Cache-Control: no-store`. `{ version: 1, now, sube, items: [{ ref: "s:12", name, active, account }] }`: şubenin **bu ay
  ya da geçen ay** maaş hesabında (aralıkta) olan satırları; `active` bu ay aralıkta mı (geçen ay biten satır `false`,
  AsilPOS ona bağlamaz); `account` satıra bağlı giriş hesabının görünen adı (`staff.user_id` → `users.name`, LM-4'ün
  Maaşlar › Vardiya / hesap bağlantısı) ya da `null`. Biten satır ile "Devam ettir"in yeni satırı aynı hesaba (ya da aynı
  Vardiya adına) bağlıysa **hesap başına tek öğe** verilir: bu ayın satırı, yoksa en yeni satır (docs/VARDIYA.md).
  Maaş, ek, yemek kartı, e-posta ve ay gitmez; uç hiçbir şey yazmaz. AsilPOS listeyi yalnız bağlantı ekranı isteyince çeker
  ve yalnız bellekte en çok 5 dakika tutar.
- **Gövde:** `workedStaffRefs` (isteğe bağlı): o gün çalışanların kimlikleri, tekil, sayı sırasıyla, en çok 500. AsilPOS
  onu yalnız en az bir kullanıcısı bağlıyken gönderir: alan yoksa günün çalışanları **bilinmiyor**, `[]` "bağlı var, kimse
  çalışmadı". `.optional().catch(undefined)` ile okunur: bozuk liste (ad, `u:` kimliği, 500'den uzun) günü reddetmez,
  yazılmaz. `pos_day_reports.worked_staff` (jsonb, migration `0075_lafpos_personel`): alanı taşıyan gövde yazar, taşımayan
  yeniden gönderim (`bankPos` gibi) kayıtlı listeyi silmez. Sürüm geçmişi gövdeyle birlikte saklar.
- **200 yanıtı:** alan geldiyse `staff: { counted, unknown, otherBranch }` (handlePosDay; receivePosDay'in yanıtı
  değişmez). **Sayılan**: satır AsilPOS'un şubesinde ve günün ayında maaş hesabında. **Başka şube**: satır başka şubede
  (o günler o satıra girmez). **Bilinmeyen**: satır yok (silinmiş) ya da günün ayında aralık dışı (biten satır: "Devam
  ettir"den sonra AsilPOS'taki bağlantı yeni satıra taşınmalı). AsilPOS bilinmeyen ve başka şubenin kimliklerini
  Entegrasyon'da kendi adıyla gösterir. Sınıf günün sayılıp sayılmamasından bağımsızdır (yanıtın `counted` alanı ayrıca
  söyler); okunamazsa `staff` yazılmaz, yanıt yine 200.
- **Yemek kartının günü ve Maaşlar:** tam zamanlı, yemek kartı işaretli kişide gün Ayarlar'dakidir (26). Şunların hepsi
  tutunca **AsilPOS'ta çalıştığı gün** kullanılır (`asilposWorkedDays`; engine `asilposMealDaysOf`): **ay bitti** (süren ve
  ileri ayda hep 26: başa baş, sabit gider standardı, Genel bakış'ın Personel tutarı ve Maaşlar'ın "Size maliyeti" ay
  başında bugüne kadar gelen günle küçülmesin); kişi AsilPOS'un şubesinde; ayın tamamı AsilPOS dönemi (ayın 1'i geçiş
  gününden önce değil: geçiş ayının ModPOS günlerinde kimin çalıştığı bilinmez, Kasım 2026'da Marina'nın yemek kartı
  330 × 26 kalır); ayın en az bir sayılan AsilPOS günü var ve **her biri** çalışan listesini taşıyor (bir gün listesizse ay
  varsayılanla); kişinin kimliği ayın **en az bir** gününde geçiyor. Gün = ayın gün sonlarından kişinin kimliğinin geçtiği
  gün. Bu gün gerçek gündür: Gelir-gider'in "PERSONEL YEMEK KARTI" satırında maaş gibi gün oranıyla bir daha oranlanmaz
  (hücre notu oranı yalnız varsayılanlılara yazar, AsilPOS'luları adı ve günüyle ayrı). Dışa aktarımın Personel sekmesi ve vergi
  bordrosu (nakit planı dahil) biten ayda aynı günle; süren ve ileri ayda Ayarlar'daki günle.
- **Görünmeyen kişi:** AsilPOS listeyi bir kullanıcı bağlanınca her güne yazar. Ay biliniyor ama kişinin kimliği hiçbir
  günde yoksa (AsilPOS'ta bağlı değil, ortak kasa; ya da "Devam ettir"den önceki satıra bağlı) bu "0 gün" sayılmaz:
  yemek kartı Ayarlar'daki günle kalır (`asilposWorkedUnseen`, engine `asilposUnseenOf`). Yemek kartı işaretliyse Maaşlar ve
  Genel bakış uyarır ("Yemek kartı işaretli kişi AsilPOS'ta görünmüyor"); Maaşlar kişinin altında "AsilPOS'ta bu ay
  görünmüyor" yazar.
- **Maaşlar:** kişinin altında "AsilPOS'ta çalıştığı gün: N" yazar (veri varsa; süren ayda "(bugüne kadar)" ve yemek kartı
  yine 26; yemek kartı işaretsiz kişide ve part-time'da yalnız bilgi: part-time'ın yemek kartı Vardiya'da çağrıldığı
  günle). Biten ayın satırında yemek kartı sütunu "N gün · AsilPOS".
- **KVKK:** ad gitmez; yalnız personel kimliği ve o gün var olup olmadığı (saat yok). Kimlik takma addır (lafmaliyet
  kişiyi bulur): amaç bordro ve yemek kartı; günler yalnız yöneticinin ekranlarında (Maaşlar, Gelir-gider). Adlar yalnız
  lafmaliyet → AsilPOS yönünde, seçicinin listesinde gider.
- İmza vektörü (`GET /api/panel/pos/personel?sube=marina`, zaman 1760000000, testlerin anahtarı) `tests/asilpos.test.ts`'te;
  AsilPOS `tests/signature.test.ts` aynısını sabitler. İkinci altın gövde `tests/fixtures/asilpos-gun-personel.golden.json`
  AsilPOS'un `tests/fixtures/lafmaliyet-gun-personel.golden.json`'ının bayt bayt kopyasıdır (ilki + yalnız `workedStaffRefs`).

Anahtar yokken altı uç da `503` döner; panelin geri kalanı ve Kasa raporu eskisi gibi çalışır.

## Güvenlik ve KVKK

- İmza laffogato.net bağlantısınınkiyle aynı kural ve aynı kod (`src/lib/karaoke/signature.ts`): `x-laf-timestamp`
  (unix saniye), `x-laf-signature: v1=<hex>`, HMAC-SHA256(zaman, yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı),
  ±5 dakika, sabit süreli karşılaştırma. Yol ve sorgu imzanın içindedir: bir ucun imzası öteki uçta, bir şubenin imzası
  öteki şubede geçmez. Altı ucun vektörleri (`/api/pos/gun`, `/api/panel/pos/urunler`,
  `/api/panel/pos/modpos-gunler?sube=marina`, `/api/panel/pos/devir?date=2026-11-22`,
  `/api/panel/pos/gider-kategorileri`, `/api/panel/pos/personel?sube=marina`) `tests/asilpos.test.ts`'te sabit; AsilPOS'un `tests/signature.test.ts`'i
  aynılarını sabitler.
- Gövdede ad, kullanıcı ya da müşteri kimliği ve telefon yoktur. Tek istisna personel bağlantısı (LM-4b): ad gitmez;
  yalnız personel kimliği (`workedStaffRefs`, `s:<maaş satırı>`; o gün var olup olmadığı, saat yok). Ödenmezde yalnız
  kişinin türü gelir (`personKind`: personel, müşteri, patron); kim olduğu gelmez (KVKK). İadelerde `name` ödeme
  türünün adıdır, kişi değil. İkram, iptal ve iade nedenleri serbest metindir (en çok 200 karakter saklanır) ve yalnız
  yöneticinin verisinde kalır; personele giden Kasa bandı yalnız Z'yi, Zayi'nin günü AsilPOS ikramının yalnız adını ve
  adedini taşır; ödeme kanalları yalnız yöneticinin Komisyon & hakediş'inde. Sürüm geçmişi aynı beyaz listeden geçmiş
  gövdeyi saklar. Kasa hareketlerinde (Faz 3) hareketi yazan kişi gelmez: "Kasadan çıkanlar"ın satırı ve Aylık
  harcamalar kaydı "AsilPOS" adıyla yazılır; açıklama ve açılış farkının nedeni serbest metindir (en çok 200 karakter).
  Tek istisna teslimin alıcısıdır (sahibin kararı, 25 Kasım 2026): paranın verildiği kişinin yalnız adı gelir ve satırın
  "Kime"si olur; AsilPOS'un kullanıcı kimliği gelmez.
- Maliyet, devir ve gider kategorileri uçları yalnız imzayla açılır; personel maliyet ve kâr görmez. Kategori ucu tutar
  taşımaz.
- ModPOS dönemi ucu yalnız imzayla ve yalnız AsilPOS'un şubesi için açılır; kişi adı, kasa ve sayım rakamı taşımaz.
- Personel ucu yalnız imzayla ve yalnız AsilPOS'un şubesi için açılır; maaş satırının adı ve bağlı hesabın görünen adı
  gider, maaş, e-posta ve ay gitmez.
- Yedeğe üç tablo (`pos_daily_sales`, `pos_day_reports`, `pos_day_revisions`) kendiliğinden girer (gizli sütun yok). `db:reset` ürünleri baştan yüklediği için günlük satırlar da
  silinir (ürün kimliklerine bağlı); gün sonu özetleri kalır.

## Sorun giderme

| Yanıt | Ne yapılır |
|-------|------------|
| `503 not_configured` | Panelde `ASILPOS_SYNC_SECRET` yok, 32 karakterden kısa ya da sitenin `KARAOKE_SYNC_SECRET`'ıyla aynı: ayrı bir değer ekleyip yeniden yayınlayın (kart nedenini yazar) |
| `401 unauthorized` | İki taraftaki anahtar aynı mı (AsilPOS'ta `LAFMALIYET_SYNC_SECRET`), kafedeki makinenin saati doğru mu (±5 dakika)? Kart son anı ve sayacı gösterir; yabancı bir istek de olabilir, sonra başarılı gönderim geldiyse bağlantı çalışıyor |
| `413 too_large` | Gövde 256 KB'ı aştı; AsilPOS'un gönderdiğine bakın |
| `400 invalid` + `field` | Gövde sözleşmeye uymuyor; `field` ilk sorunlu alanın yolu (`date`: ileri ya da bozuk gün, `lines.5.posName`: aynı ad iki kez). AsilPOS kendisi yeniden denemez: düzeltilince AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder. Kart o günün reddini alanıyla, gün yeniden gelene kadar gösterir |
| `409 z_conflict` + `date`, `zNo` | O güne panelde başka bir Z no ile (`zNo`) yazılmış gün sonu var; hiçbir şey yazılmadı, yeniden deneme de 409 alır. Bir tarihte bir Z olur: paneldeki doğruysa AsilPOS'taki fazla günü düzeltin; AsilPOS'taki doğruysa yönetici Ayarlar › AsilPOS (kasa)'da **Bu günün AsilPOS kaydını sil**'e basar (parolayla; o günün özeti ve satırları tek işlemde silinir), **sonra AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basılır** (AsilPOS reddedilen günü kendisi yeniden denemez). Kart reddi gününe göre iki Z'siyle, silindikten sonra "AsilPOS'tan Gönder bekleniyor" diye gösterir |
| `500 server_error` | Panel yazamadı (veritabanı); AsilPOS yeniden dener. Sürüyorsa Vercel günlüğünde `[asilpos]` |
| Kasa raporunda bant yok | Geçiş günü seçilmedi ya da gün ondan önce (bilerek: deneme günü Kasa'ya girmez); o günün gönderimi gelmedi (AsilPOS'un giden kutusu; kart gelmeyen günleri listeler) ya da gün başka (05:00 kuralı) |
| Satışlar'da AsilPOS satırı yok | Geçiş günü seçilmedi ya da ay ondan önce (deneme satırları yalnız Ayarlar kartında); geçiş ayında liste ayın sonuna kadarsa AsilPOS o ay sayılmaz (Satışlar'ın uyarısı: yalnız geçiş gününden önceki günlerin listesini yükleyin) |
| Satışlar "ModPOS listesi sayılmıyor" | Ayın tamamı geçiş gününden sonra: o aya eskiden yüklenmiş liste hesaba girmez; "Ayı temizle" ile silinir |
| AsilPOS'ta ModPOS günü eksik (`modpos-gunler`) | Geçiş günü boşsa dönem yok (`days: []`). Gün geçiş gününden önce olmalı. Marina seçiliyken o günün kasa raporu ya da kapanmış föyü olmalı (Ay rakamına yedek'e bakılmaz). Kasası açık kalmış föy gitmez; ertesi sabahın kesin föyü gelince gider. Föy gününde indirim `null`'dır ("indirim bilinmiyor"). Ürün bloğu için ayın ModPOS listesi Satışlar'a yüklenmiş olmalı. Bloğun son günü yanlışsa (liste şubenin kendi kaydından önce yüklendi, öteki şube aynı aya bu kayıttan önce yükledi: ortak kayıt artık onun günü) Marina seçiliyken listeyi "Liste hangi güne kadar?" ile yeniden yükleyin; aynı kayıt AsilPOS'un sayıldığı ilk günü de düzeltir. Kasa iş günü başına bir kez çeker; hemen görmek için AsilPOS'ta Yönetim › Entegrasyon › ModPOS dönemini çek |
| AsilPOS satırı ürünsüz | Ayarlar › AsilPOS kartında Bağla, Satışlar'da eşleştir ya da ürünü Ürünler › Site menüsü'nde sitenin kalemine bağla; kayıtlı günler yeniden gönderim olmadan bağlanır |

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/asilpos/day.ts` | Gövdenin şeması (beyaz liste; Faz 2 alanları bozuksa yok sayılır), okunması ve hata alanı, ürünün bulunma sırası (saf) |
| `src/lib/asilpos/gun-ayrinti.ts`, `src/app/panel/kasa/asilpos-day-card.tsx` | Faz 2 ayrıntısı: yazarkasadan geçmeyen, ödeme iptalleri, iptal edilen kalemler, yazarkasa Z no, KDV, gönderim ve düzeltme (gün görünümü kartı ve gün sonu e-postası; saf) |
| `src/lib/asilpos/request.ts` | Anahtar ve imzalı isteğin denetimi (saf; `node:crypto`, yalnız sunucu) |
| `src/lib/asilpos/secret-rules.ts` | Anahtarın en kısa uzunluğu (Şube ayarları kartı da okur; tarayıcı `request.ts`'i içe aktarmaz, CSP: [DEPLOY.md](DEPLOY.md) › Güvenlik başlıkları) |
| `src/lib/asilpos/prefill.ts` | Z → Kasa formunun alanları (`CashPrefill`), bandın metni, harcama ve teslimin bilgi satırı, kartla bahşiş ve cari tahsilatı, yazarkasadan geçmeyen ödeme (`AsilposDay.offDevice`; saf) |
| `src/lib/asilpos/diffs.ts` | Gönderilmiş raporun AsilPOS'tan farklı yazılanları ve metni (saf) |
| `src/lib/asilpos/costs.ts` | Maliyet listesinin beyaz listesi (saf) |
| `src/lib/asilpos/switch.ts` | Geçiş gününün kuralları (saf): AsilPOS günü mü, ayın kaynağı, ModPOS listesi sayılır mı, AsilPOS'un sayıldığı ilk gün, değişen aylar, onay penceresinin listesi |
| `src/lib/asilpos/kasa.ts` | Metinlerde kasanın adı (saf; B11): ayın kasası (`monthKasa`, `periodKasa`), bugünün kasası ve kasadaki fiyatın elle değişip değişmediği (`tillScope`, `tillPriceManual`) |
| `src/lib/sales-source.ts`, `src/components/panel/sales-source-line.tsx` | Ayın satış kaynağı (saf; ux-sade §10): ModPOS raporu, AsilPOS, geçiş ayı, ileride ModPOS bağlantısı; başlığın altındaki satır |
| `src/server/data/till-scope.ts` | Bugünün kasası (iş günü + geçiş günü) ve Kasaya işle okuyucularının süzgeci (B11) |
| `src/components/panel/kasa-text.tsx` | Sayfa başlığının günün kasasına göre metni (beklerken ve geçiş günü boşken ModPOS'unki; B11) |
| `src/lib/asilpos/sales.ts` | AsilPOS ay toplamlarıyla ModPOS listesinin birleşmesi (her gün tek kaynak), ayın kaynağı ve Satışlar'ın bandı, ModPOS listesi yükleme kuralı (saf) |
| `src/server/data/asilpos-sales.ts` | Sayılan günlerin ay toplamları ve gün sonları; veri kümesi ve tatlı payı için birleştirme |
| `src/server/asilpos/rematch.ts` | Ürünsüz satırların sonradan bağlanması (site kalemi, POS adı) |
| `src/lib/asilpos/ikram.ts`, `src/server/data/asilpos-ikram.ts` | İkramın kuralı (her gün tek kaynak, ürün ikramının reddi, e-postanın karşılaştırması; saf) ve okuyucusu (veri kümesi, Zayi'nin günü, kasa özeti) |
| `src/lib/commission/report.ts` (`asilposMonth`, `asilposSales`), `src/lib/commission/channels.ts` (`asilposChannel`), `src/server/data/commission.ts` | Ödeme kanallarının Komisyon & hakediş'e girmesi |
| `src/lib/asilpos/status.ts` | Durum satırının biçimi, retlerin metni, Ayarlar kartının özeti, retlerin zil satırı (`rejectionBells`), gelmeyen günler (saf) |
| `src/server/bell/asilpos.ts` | Reddedilen gün sonunun zil satırı (yalnız yönetici, Sistem başlığı) |
| `src/server/asilpos/status.ts` | Ucun sonucu durum satırına (`handlePosDay`, imzasız sayaç), geçiş günü okuyucusu, kartın verisi |
| `src/server/asilpos/admin.ts` | Geçiş gününün yazımı ve günün silinmesi (çekirdekler, rol denetimi) |
| `src/server/actions/asilpos.ts` | Ayarlar'ın iki eylemi (yönetici; silme parolayla) |
| `src/app/panel/ayarlar/asilpos-card.tsx`, `asilpos-client.tsx` | Ayarlar › AsilPOS (kasa) |
| `src/server/asilpos/ingest.ts` | Gün sonunun denetimi ve tek işlemde yazımı |
| `src/server/asilpos/products.ts` | Maliyet ucunun çekirdeği (maliyet modeli) |
| `src/lib/asilpos/modpos-gunler.ts`, `src/server/asilpos/modpos-gunler.ts` | ModPOS dönemi ucu: isteğin denetimi, günün ve ürün bloğunun biçimi (saf); kasa raporu, föy ve ModPOS listesinin okunması |
| `src/lib/asilpos/personel.ts`, `src/lib/asilpos/personel-istek.ts`, `src/server/asilpos/personel.ts` | Personel bağlantısı (LM-4b): listenin biçimi ve hesap başına tek öğe, kimliklerin sınıfı, AsilPOS'ta çalıştığı gün ve görünmeyen kişi (saf; motor okur, node modülü yok); uç isteğinin denetimi (imza: motorun ağacı dışında); maaş satırlarının ve hesap adlarının okunması |
| `src/server/data/daily-sales.ts` | `loadDailyProductSales` (gün gün; bugün okuyan yok) |
| `src/app/panel/satislar/page.tsx`, `sales-client.tsx`, `product-picker.tsx` | Satışlar'ın bandı, AsilPOS satırları ve eşleştirmesi, geçiş ayının yüklemesi |
| `src/lib/asilpos/gun-sonu.ts`, `src/server/asilpos/gun-sonu.ts` | Gün sonu otomasyonu: Kasa raporuna otomatik yazım ve birleştirme, gün sonu e-postası, günlük işin yakalaması; gün sonu tamda Banka POS (`bankPosAuto`) ve yazarkasa alanları (`okcAuto`), cihaz boşluklarının tam metni (`autoGaps`) |
| `src/lib/asilpos/foto.ts`, `src/server/asilpos/foto.ts`, `src/app/panel/kasa/asilpos-photo.tsx` | Gün sonu tam: personelin gün sonu fotoğrafı (istenen fotoğraflar, rapora bağlama, rapor yokken bekleme, Bugün'ün ve ay satırının durumu), fotoğraf ↔ AsilPOS karşılaştırması ve yöneticinin "Banka POS'a yaz"ı |
| `tests/asilpos-gun-sonu-tam.test.ts`, `tests/asilpos-gun-sonu-tam-db.test.ts` | Gün sonu tam: alanların okunması, Banka POS ve yazarkasanın otomatik değerleri ve eksiklerin metni, birleştirme, Pavo kartı, kart karşılaştırması, fotoğraf ↔ AsilPOS, Bugün, gün görünümü, e-posta; veritabanında 22.11 kabul günü, personelin fotoğrafı (sürüm ve sayan değişmez), Pavo'nun sonradan gelişi ve elle yazılan alanın korunması, "Banka POS'a yaz", sayımsız günün bekleyen fotoğrafı |
| `src/server/data/asilpos-day.ts` | Kasa raporunun okuyucusu (yalnız Z; `loadKasaAsilpos` ve ay görünümünün `loadKasaAsilposDays` yalnız geçiş gününden sonra), günün kanıtı (`kasaEvidence`) |
| `src/app/api/pos/gun/route.ts`, `src/app/api/panel/pos/urunler/route.ts`, `src/app/api/panel/pos/modpos-gunler/route.ts`, `src/app/api/panel/pos/devir/route.ts`, `src/app/api/panel/pos/gider-kategorileri/route.ts`, `src/app/api/panel/pos/personel/route.ts` | Uçlar |
| `src/lib/asilpos/devir.ts`, `src/server/asilpos/devir.ts` | Kasa zinciri (Faz 3): bir günün devri (`nextOpening`; 200 yanıtı ve devir ucu) |
| `src/server/asilpos/categories.ts` | Gider kategorileri ucunun çekirdeği (personelin kategorileri; Faz 3) |
| `src/lib/asilpos/cash-moves.ts`, `src/server/asilpos/cash-moves.ts` | Kasa hareketleri → Kasadan çıkanlar (plan, kilit metni; eşitleme; Faz 3) |
| `src/app/panel/kasa/cash-form.tsx`, `page.tsx`, `late-report.tsx`, `cash-history.tsx`, `cash-summary.tsx` | AsilPOS gününde form (açılışta doldurma, Z bölümü, bilgi satırı), kayıtlı rapor ve günden güne farkları, geç rapor |
| `src/server/closed-days.ts` | Kapalı gün kanıtında AsilPOS'un gün sonu, satışlı gün sonunun kapalı işareti kaldırması (`onAsilposDaySaved`) |
| `src/server/data/cash-reports.ts` | `tillRows`: raporsuz AsilPOS gününün ay satırı (`asilposTillRows`) |
| `tests/asilpos.test.ts`, `tests/asilpos-db.test.ts` | İmza, gövde, ürün sırası, form ve kasa eşlemesi, geçiş günü, kartın özeti, altın gövde (`tests/fixtures/asilpos-gun.golden.json`: AsilPOS `tests/fixtures/lafmaliyet-gun.golden.json`'ın bayt bayt kopyası, şubeli); veritabanında yazım, idempotent değişim, Z çakışması (409), ağız ve uçlar |
| `tests/asilpos-satis.test.ts`, `tests/asilpos-satis-db.test.ts` | Her gün tek kaynak (özellik testi), birleştirme, model (tüketim, karaoke KDV'si), Satışlar'ın bandı, yükleme kuralı, sayılan ilk gün Marina'nın kendi kapsam kaydından; veritabanında geçiş günü boşken bayt bayt aynılık, geçiş ve AsilPOS ayları, kapsam, Tuzla'nın aynı aya ya da Aralık'ta yüklediği liste Marina'nın AsilPOS günlerini düşürmez (eski liste dahil), içe aktarma kartının günü yazılan şubenin ("Tümü"de Tuzla'nın), yükleme reddi ve kırpma, sonradan bağlama, silme engeli, satış tahmini |
| `tests/asilpos-kasa.test.ts`, `tests/asilpos-kasa-db.test.ts` | Kasa raporunun AsilPOS'la uzlaşması (B09): farklı yazılanlar ve metinler, gün içinde çıkan, kapalı gün kanıtı, e-posta anahtarı, ay satırı, geç rapor ve fotoğraf kanıtı, kart; veritabanında geçiş günü boşken bugünkü gibi, kapalı işaretin kalkması, e-posta, geç rapor ve kartı |
| `tests/asilpos-komisyon.test.ts`, `tests/asilpos-ikram.test.ts`, `tests/asilpos-komisyon-ikram-db.test.ts` | Ödeme kanalları komisyona (B10, E-37) ve ikram tüketime (E-38): geçiş günü boşken bugünkü gibi, AsilPOS ayı, geçiş ayı, kanalsız ödeme, eksik gün; ikramın kayıtlı tüketime bir kez girmesi, panel ürün ikramının sayılmaması ve reddi, kasa özeti ve e-postası |
| `tests/asilpos-modpos.test.ts`, `tests/asilpos-modpos-db.test.ts` | ModPOS dönemi: isteğin denetimi (503 / 401 / 400 / 409), günün biçimi, kaynak ve bilinmeyen indirim, kapanmış föy, KDV sırası, pencere, ürün bloğu (eksi satır eksi gitmez, toplam değişmez; son gün şubenin kendi kapsam kaydından); veritabanında Marina 13–21 Kasım 2026'nın rakamları (kasa raporu ve föy, öncelik, föy günü Ay rakamına yedek'ten bağımsız, panelin ay kuralı değişmez, açık föy, Tuzla ve geçiş günü sonrası dışarıda; Tuzla'nın aynı aya sonradan yüklediği liste Marina'nın bloğunu kaydırmaz) |
| `tests/asilpos-gun-alanlari.test.ts`, `tests/asilpos-gun-alanlari-db.test.ts` | Faz 2: alanların okunması (bozuk alan 400 almaz), hesap sözleşmesinin eşitlikleri, iptal → zayi, ikramın türü, Pavo hata kodu, yazarkasa Z no, gün gün KDV, Satışlar'ın sütunları ve denetimi, gün ayrıntısı ve e-posta; veritabanında saklama ve sürüm geçmişi |
| `tests/kabul-gunu-db.test.ts` | Kabul: Marina Kasım 2026 (ModPOS 13–21 + AsilPOS 22 Kasım, `tests/fixtures/kabul-gunu-2026-11-22.json`) gerçek yükleyiciler ve motorla: ciro, kart, nakit, indirim, ödenmez, fiş, KDV hariç 30.576,15, komisyon 495,49, 22 Kasım'ın kasası ve iptalleri; Faz 3: 23 Kasım'ın beklenen açılışı 1.279,50, 800,00'lık fişsiz harcama Kasadan çıkanlar'da bir kez |
| `tests/kasa-zinciri.test.ts`, `tests/kasa-zinciri-db.test.ts` | Faz 3: alanların okunması (bozuk alan ve takvimde olmayan an 400 almaz), devrin kuralı (eksi devir yok) ve otomatik raporun birleştirmesiyle aynılığı, hareketlerin planı, ayırma planı, kategori bekleyen harcama, kilit, açılış notu, gün görünümü; veritabanında 200'ün ve devir ucunun `nextOpening`'i (yeniden sayım yeni sayımı söyler), gider kategorileri ucu, hareketlerin satırları, sahiplenme, kaldırma, kilit ve tedarikçi ödemesi, sayılmaz olan günün ve silinen AsilPOS kaydının satırları, yöneticinin kaldırdığı kaydın geri gelmemesi |
| `tests/asilpos-durum-db.test.ts` | Kendi geçici veritabanında: durum satırı (200 / 400 / 409 / 401 / 413 / 500 / 503), güne göre açık retler (sonraki 200 ve başka günün 400 / 500'ü örtmez, aynı günün 200'ü kapatır), `counted`, günün silinmesi (yalnız çözdüğü 409'u kapatır), geçiş günü, Kasa okuyucusunun kapısı, eylemlerin parolası ve işlem geçmişi |

# LafPOS bağlantısı (kafenin kasası)

Uçlar: `POST /api/pos/gun` (gün sonu) ve `GET /api/panel/pos/urunler` (ürün maliyetleri). Ekranlar: **Ayarlar ›
LafPOS (kasa)** (bağlantının durumu, son ret ve onarımı, **LafPOS'a geçiş günü**, ürüne bağlanamayan adlar) ve geçiş
gününden itibaren **Kasa raporu** (`/panel/kasa`) › **LafPOS'tan doldur**, **Satışlar** (`/panel/satislar`:
LafPOS'un ürün satışları, ay toplamı), **Komisyon & hakediş** (kanal kanal satış) ve **Zayi & ikram** (LafPOS'un
ikramı). Sözleşmenin asıl hâli LafPOS deposunda (`RiosenBeq/lafpos`)
`docs/03-ENTEGRASYON.md` §3, §4 ve §4.1; bu belge panelin tarafıdır.

**Varsayılan kapalı (sahibin 26 Ekim kararı).** Kafede bugün ModPOS var. "LafPOS'a geçiş günü" boşken LafPOS'un
gönderdiği günler saklanır ama hiçbir hesaba, ekrana, göreve, hatırlatmaya, e-postaya ya da ön doldurmaya girmez;
yalnız Ayarlar'daki LafPOS kartında "deneme" olarak görünür. Anahtar (`LAFPOS_SYNC_SECRET`) yokken iki uç 503 döner ve
hiçbir şey yazılmaz. Açma sırası aşağıda, "Açılış sırası".

## İş bölümü (26 Ekim 2026)

LafPOS, site (laffogato) ve bu panel tek işletme sisteminin üç parçasıdır (karar: lafpos
`docs/06-TEK-SISTEM.md`): ürünlerin tek kaynağı sitenin yönetim paneli, satışın ve kasanın kaynağı LafPOS,
**maliyet, reçete, stok ve muhasebenin kaynağı bu panel**. LafPOS maliyeti buradan okur
(`GET /api/panel/pos/urunler`), gün sonunu buraya iter (`POST /api/pos/gun`). Kasiyer LafPOS'ta kör kasa
sayar (`kasa.rakam` yetkisi kapalı): beklenen tutarı ve farkı görmez; fark ve Z bu panelin Kasa raporuna gelir.

## Neden

LafPOS, ModPOS'un yerine geçen kafe kasasıdır. Kafenin içindeki bir makinede çalışır ve internetten erişilemez; bu
yüzden panelin öteki bağlantılarındaki "imzalı ping, sonra imzalı çekme" burada yoktur. LafPOS her iş gününü
kapanışta bir kez **iter**; gün sonradan düzeltilirse aynı günü yeniden gönderir (aynı gün, aynı Z no ile öncekinin
yerine geçer).
İnternet yoksa gönderim LafPOS'un giden kutusunda bekler, sonra gider.

- Günün ürün satışı geçiş gününden itibaren aylık maliyet modeline girer ve ModPOS'un elle yüklenen aylık listesinin
  yerini alır: Satışlar, Tutarlılık, Ürünler, Analiz, Genel bakış, KDV tahmini, satış tahmini (aşağıda, "Günlük satış").
- Geçiş gününden itibaren günün Z özeti Kasa raporunda form açılırken kendiliğinden yazılır; personel yine bakıp
  gönderir, ModPOS'un Z'sini elle yazmaz. Gönderilmiş rapor LafPOS'tan farklıysa kayıtlı rapor, e-posta, WhatsApp ve zil
  söyler; satışlı LafPOS günü "Kafe kapalıydı"nın kanıtıdır.
- Geçiş gününden itibaren ödeme türleri kanal kanal Komisyon & hakediş'in satışı olur (yemek kartı ve platform başına
  gerçek oran ve beklenen hakediş; aşağıda, "Komisyon"); ikram LafPOS'ta işaretlenir, kayıtlı tüketime ve kasa
  e-postasına oradan girer (aşağıda, "İkram").
- Panel LafPOS'a ürünlerin reçete maliyetini verir (patronun kârlılık ekranı için; personel görmez).

## Nasıl çalışır

```
LafPOS (kafede)                                  ladmin.laffogato.net (bu panel)
───────────────                                  ──────────────────────────────
gün sonu (ve düzeltme)
  └─ giden kutusu: POST /api/pos/gun  ────────▶  anahtar → boyut → imza → gövde
     {version, source, date, z, lines,             └─ tek işlem, günün danışma kilidi:
      ikram, payments} (imzalı)                        ├─ kayıtlı Z no başkaysa: 409, hiçbir şey yazılmaz
                                                       ├─ pos_day_reports: günün özeti (yenisi eskisinin yerine)
                                                       └─ pos_daily_sales: günün satırları silinir, yenisi yazılır
     ◀── 200 {ok, date, lines, matched, unmatched, counted, switchDay} · 400 {error, field} · 409 {error, date, zNo} · 401 · 413 · 503
                                                    └─ sonuç integration_state › lafpos'a (Ayarlar › LafPOS kartı)

GET /api/panel/pos/urunler (imzalı)  ─────────▶  maliyet modelinden siteye bağlı ürünler
     ◀── {version: 1, now, items: [{siteMenuId, slot, name, size, costMinor, active}]}
```

### Gün sonu: `POST /api/pos/gun`

Gövde katı JSON, en çok 256 KB. Tutarlar TL (iki ondalık; fazlası yuvarlanır), ciro ve menü değeri KDV dahil:

| Alan | İçerik |
|------|--------|
| `version` | `1`; başka sürüm reddedilir |
| `source` | `"lafpos"` |
| `date` | İş günü `YYYY-MM-DD` (gün 05:00'te döner, Kasa raporuyla aynı kural); bugünün iş gününden sonrası reddedilir |
| `z` | `zNo`, `receipts`, `zTotal`, `cash`, `card`, `mealCard`, `online`, `other`, `offRevenue`, `discounts`, `openingCash`, `cashOut` (harcama), `countedCash` (sayılmadıysa `null`), `handedOver` (gün içindeki teslim), `cashDiff` (`null` olabilir); isteğe bağlı (yazılmayabilir ya da `null`): `cashIn` (≥ 0; nakit satış dışında çekmeceye giren: giriş, nakit müşteri tahsilatı ve nakit bahşiş; yoksa 0 sayılır; Kasa raporunda "Gün içinde kasaya giren"), `expectedCash` (LafPOS'un olması gereken nakdi) |
| `lines[]` | `posName`, `siteMenuId` (`null` olabilir), `slot` (`"M"`, `"L"` ya da `null`), `qty`, `revenue`, `isService`; bir POS adı günde bir kez |
| `ikram[]` | `posName`, `siteMenuId`, `slot`, `qty`, `menuValue`, `reason` (en çok 200 karakteri saklanır) |
| `payments[]` | `name`, `zField` (`cash`, `card`, `meal_card`, `online`, `other`), `channel` (komisyon anahtarı: `pluxee`, `multinet`, `edenred`, `setcard`, `metropol`, `yemeksepeti`…; `null` olabilir), `count`, `amount` |

- **Beyaz liste.** Yalnız tablodaki alanlar okunur ve saklanır; bilinmeyen alan atılır (müşteri ya da personel adı
  gelse de yazılmaz). Her alan yazılmalıdır (sonradan gelen `z.cashIn` ve `z.expectedCash` dışında: eski LafPOS
  göndermez, gövdesi yine geçer); boş olabilenler `null` gelir.
- **Denetim sırası:** anahtar yoksa `503 {"error":"not_configured"}`; gövde 256 KB'tan büyükse
  `413 {"error":"too_large"}`; imza yok, yanlış ya da 5 dakikadan eski / ileriyse `401 {"error":"unauthorized"}`
  (ayrıntı verilmez); gövde sözleşmeye uymazsa `400 {"error":"invalid","field":"lines.3.qty"}` (ilk sorunlu alanın
  yolu; gövde okunamazsa `body`); o güne panelde başka bir Z no ile yazılmış gün sonu varsa
  `409 {"error":"z_conflict","date":"2026-10-26","zNo":127}` (`zNo` paneldeki Z'nin numarası). Yazılınca
  `200 {"ok":true,"date":"2026-10-26","lines":42,"matched":40,"unmatched":["PUMPKIN CHAI LATTE"],"counted":false,"switchDay":null}`:
  `matched` ürüne ya da hizmete bağlanan satır sayısı, `unmatched` ürüne bağlanamayan POS adları (çok satılan önce, en
  çok 50; LafPOS bağlantı ekranında gösterebilir), `counted` günün hesaplara girip girmediği (gün geçiş gününden önce
  değilse `true`), `switchDay` paneldeki geçiş günü (`null`: seçilmedi, kasa ModPOS). LafPOS 200'ün gövdesini okumak
  zorunda değildir; eski LafPOS ek alanları görmez. Veritabanı yazamazsa
  `500 {"error":"server_error"}` (LafPOS yeniden dener). Reddedilen istek gün sonundan hiçbir şey yazmaz; sonucu
  yalnız durum satırına düşer (aşağıda, "Durum ve onarım").
- **Aynı gün aynı Z no ile yeniden gelince** (düzeltme ya da yeniden deneme) tek işlemde günün özeti yenisiyle
  değişir, satırları silinip yenisi yazılır; öteki günlere dokunulmaz. Aynı anda iki gönderim günün danışma kilidinde
  (`pg_advisory_xact_lock(hashtext('lafpos-gun:<gün>'))`) sırayla yazılır, biri bütünüyle kalır.
- **Aynı gün başka bir Z no ile gelirse** öncekinin yerine geçmez (önceki Z'yi ve günün satırlarını sessizce silerdi):
  kilidin altında kayıtlı Z no'ya bakılır, farklıysa `409 z_conflict`, hiçbir şey yazılmaz. LafPOS da aynı tarihle iki
  gün açmaz; bu ikinci kilittir.
- **Ürün** satır satır bulunur (`src/lib/lafpos/day.ts` › `resolvePosLine`): LafPOS'un hizmet satırı (karaoke) ürüne
  bağlanmaz; sonra sitenin kalemi ve boyu (`products.site_menu_id` + `site_menu_slot`, [SITE-MENU.md](SITE-MENU.md));
  bulunmazsa POS adı eşleştirmesi (`pos_mappings`, `posMatchKey`: büyük / küçük harf ve I / İ farkı yok; ModPOS'tan
  öğrenilmiş eşleştirmeler ve HİZMET işareti çalışmaya devam eder). Hiçbiri yoksa satır ürünsüz kalır; sitenin kalemi
  ve boyu satırla saklanır. **Sonradan bağlama** (denetim E-33, `src/server/lafpos/rematch.ts`): ürün Ürünler › Site
  menüsü'nde o kaleme bağlanınca ya da POS adı bir ürüne eşleştirilince (Satışlar'ın ModPOS ya da LafPOS satırı,
  Ayarlar › LafPOS › **Bağla**) o kalemle ya da adla (posMatchKey) gelmiş ürünsüz satırlar, LafPOS günü yeniden
  göndermeden bağlanır. Bağlı satırın ürünü bu yolla değişmez (Satışlar'da bir ayın adla bağlanmış LafPOS satırının
  ürünü elle değiştirilir, aşağıda). LafPOS'un hizmet işaretiyle ya da sitenin bağlı kalemiyle gelen satır her gün
  sonunda (düzeltme gönderimi dahil) yine öyle yazılır; bu yüzden Satışlar'da başka ürüne bağlanmaz, eylem düzeltmenin
  yerini söyler (Ürünler › Site menüsü ya da LafPOS'taki hizmet işareti).
- **Saklanan:** `pos_daily_sales` (gün, POS adı, ürün, sitenin kalemi ve boyu, adet, ciro, hizmet; `(date, pos_name)`
  benzersiz) ve `pos_day_reports` (gün başına bir satır: `z`, `payments`, `ikram`, `source`, `received_at`).
  Migration'lar `drizzle/0040_lafpos_baglantisi.sql` (iki yeni tablo), `drizzle/0041_kasaya_giren.sql` (Kasa raporunun
  "Gün içinde kasaya giren"i: `cash_reports.cash_in double precision NOT NULL DEFAULT 0`; var olan raporlar 0) ve
  `drizzle/0044_lafpos_satir_site_kalemi.sql` (satırın sitedeki kalemi ve boyu: `pos_daily_sales.site_menu_id`, `slot`,
  boş olabilen iki sütun, ve LafPOS'un hizmet işareti `lafpos_service boolean NOT NULL DEFAULT false`; yalnız ekleme;
  eski satırlarda boş / false, sonradan bağlama onlarda yalnız POS adıyla çalışır, gün yeniden gönderilince dolar). 0040 26 Eki 2026'da
  canlıya uygulandı; yeniden üretilmez (`tests/migrations.test.ts` günlükteki zamanını kilitler). Yalnız ekleme: Instant Rollback'te
  eski kod sütunu okumaz, yazdığı raporda 0 kalır; yalnız girenli bir raporun olması gerekenini eski kod girensiz
  hesaplar (giren kadar fazla görünür), düzeltme ileri yayınlanır.

### Günlük satış (aylık model)

Geçiş günü (aşağıda) seçilince LafPOS'un günlük satırları aylık maliyet modeline girer (denetim E-08;
`src/lib/lafpos/sales.ts`, okuyucu `src/server/data/lafpos-sales.ts`): `pos_daily_sales` sayılan günlerden (ay, POS adı,
ürün, hizmet) başına ay toplamına çevrilir, Satışlar'a yüklenen ModPOS listesinin yanına konur. Motor (`engine.ts`)
değişmez: Satışlar, Tutarlılık (reçeteye göre beklenen tüketim), Ürünler, Analiz, Genel bakış, Claude aracı ve KDV
tahmininin karaoke payı (hizmet satırları %20) aynı satırları okur. **Geçiş günü boşken LafPOS hiç okunmaz**: veri
kümesi, satış tahmini ve tatlı payı bayt bayt bugünkü gibidir (`tests/lafpos-satis-db.test.ts`).

**Her gün tek kaynak.** ModPOS'un listesi aylık toplamdır, gün gün bölünemez; bu yüzden kapsamı (listenin son günü,
`sales.coverage`) belirleyicidir:

| Ay | ModPOS listesi | LafPOS günleri |
|----|----------------|----------------|
| Geçiş gününden önce | sayılır (bugünkü gibi) | sayılmaz (deneme; yalnız Ayarlar kartında) |
| Geçiş ayı (geçiş günü ayın ortasında) | kendi son gününe kadar bütünüyle sayılır | listenin son gününden sonraki günden, geçiş gününden önce değil |
| Ayın tamamı geçiş gününden sonra | **sayılmaz** (silinmez; Satışlar "sayılmıyor" der) | ayın her günü |

- **Geçiş ayının listesi** en çok geçiş gününden önceki güne kadardır: Satışlar'da yüklerken "Liste hangi güne kadar?"
  en çok o gün, ay bittikten sonra yüklenen liste de ayın tamamı sayılmaz, o güne kırpılır (`modposImportRule`). Yoksa ay
  sonrası yüklenen liste kapsam kaydını silip LafPOS günlerini saymaz yapardı. Listesi olmayan geçiş ayına "Satır ekle"
  ile yazılan ilk satır da listeyi aynı kuralla başlatır (`saveLine`, kapsam en çok geçiş gününden önceki gün): tek elle
  satır ayın tamamı sayılıp LafPOS'un o ayki günlerini düşürmez.
- **Liste geçiş gününü aşıyorsa** (geçiş günü sonradan, liste zaten yüklüyken seçildi) LafPOS'un o günleri sayılmaz,
  Satışlar söyler: "Kasım listesi 20 Kasım gününe kadar: LafPOS'un 10–20 Kasım günleri … sayılmıyor. LafPOS'u saymak için
  yalnız 1–9 Kasım listesini yükleyin."
- **Liste kısaysa ya da yoksa** (1–4 Kasım listesi, geçiş günü 10 Kasım) aradaki günler hiçbir kaynakta yoktur (çift
  değil eksik sayım); geçiş günü geldikten sonra Satışlar "5–9 Kasım satışı hiçbir kaynakta yok … 1–9 Kasım listesini
  yükleyin" der.
- **Gün sonu gelmeyen gün:** LafPOS'un sayıldığı günlerden kasa raporu olup gün sonu gelmeyen (dünden önceki) gün
  Satışlar'da uyarılır: "2 günün LafPOS gün sonu gelmedi, kasa raporu var: 1, 2 Ekim. Bu günlerin satışı hesapta yok;
  LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın." (`missing`).
- **Genel bakış:** Satışlar bandının ilk uyarısı (eksik ya da sayılmayan gün, gün sonu gelmeyen gün, liste ↔ Z) "Bu ayın
  işleri"nde "Satış raporu" satırına da çıkar (`monthTaskFacts`); ay o uyarıyla "Tamam" görünmez. Ayın tamamı LafPOS'tansa
  satır "LafPOS'tan N gün geldi" der, Patron listesi istemez.
- **Liste ↔ Z:** geçiş ayında listenin toplamı listenin günlerinin kasa raporu Z toplamını %5'ten fazla aşıyorsa uyarı
  (yüklerken bildirim, sonra Satışlar'da): liste geçiş gününden sonraki satışı da içeriyor olabilir, o günler
  LafPOS'tan da sayılır. Liste ürün cirosudur (indirimden önce), küçük fark olağandır.
- **Kapsam:** LafPOS satırı olan ayın satırları son sayılan LafPOS gününe kadardır (`salesCoverage`): süren ayda ya da
  günleri eksik ayda günlük ortalama ve "ayda …" adetleri yarım ayı tam ay saymaz (engine `listPeriod`). **Süren ayda**
  LafPOS günü kasa raporlarının son gününden sonraysa o gün kasa raporu girilince sayılır (`mergeWithLafpos`
  `lastTillDay`; Satışlar'ın bandı "10 Aralık kasa raporu girilince sayılır" der): LafPOS gün sonunu kapanışta yollar,
  rapor sonra (çoğu kez ertesi sabah) girilir; o arada satırlar kasa döneminden bir gün ileride olur, liste ↔ POS cirosu
  karşılaştırması yanlış uyarı verir, günlük ortalama bir günün satışı kadar şişerdi. Süren ayda hiç kasa raporu yoksa
  beklenmez (ayın kasa dönemi yok). Ay rakamlarının raporsuz günde LafPOS Z'sinden gelmesi (B09) bu bekleyişi kendiliğinden
  kaldırır: kasa dönemi LafPOS günlerini de kapsar.

**Satışlar** (`/panel/satislar`, yalnız yönetici): geçiş ayında bilgi bandı ("Kasım geçiş ayı: ModPOS listesi 1–9
Kasım, LafPOS 10 Kasım'dan itibaren (12 gün geldi, son gün 21 Kasım).") ve yukarıdaki uyarılar. LafPOS satırları aynı
tabloda "LafPOS · N gün" diye, **salt okunur**: düzenlenmez, silinmez (gün LafPOS'ta düzeltilip yeniden gönderilir).
Eşleşmeyen LafPOS adı ModPOS satırı gibi eşleştirilir (değnekli öneri ve toplu öneriler dahil; `matchLafposName`,
`applyLafposMatches`): tıklanan ay toplamının günleri (bağlıysa da) ve o ayın aynı adlı ürünsüz günleri seçilen ürüne
geçer, aynı adın ayın başka günlerinde başka ürüne bağlı satırı değişmez; ad Satışlar'ın POS adı hafızasına yazılır,
başka aylardaki ürünsüz satırlar da bağlanır. LafPOS'un hizmet işaretli ya da sitenin bağlı kalemiyle gelen satırı
başka ürüne (ya da ürünsüze) geçmez: sonraki gün sonu geri alırdı; eylem reddeder ve düzeltmenin yerini söyler. Tabloda LafPOS satırı ad, ürün ve hizmet başına bir ay toplamıdır. Ayın tamamı LafPOS'tansa İçe aktar kartı yerine "LafPOS'tan geliyor"
kartı (gelen gün sayısı, Ayarlar kartına bağlantı) çıkar, "Satır ekle" yoktur (eylem de reddeder), o aya eskiden
yüklenmiş liste "Ayı temizle" ile silinir; ModPOS listesi yüklenmez ("Aralık 2026 LafPOS'tan geliyor; ModPOS listesi
yüklenmez."). Geçiş gününden önceki aylarda ve geçiş günü boşken sayfa bugünkü gibidir.

**Satış tahmini** (`src/server/forecast/load.ts`, `mix.ts`): geçiş gününden itibaren kasa raporu girilmemiş günün
toplamı LafPOS'un Z'sidir (rapor kazanır); tatlı payı aylık modelin satırlarını okur. **Ürün silme** (`productHistoryCounts`,
denetim E-34): ürüne bağlı LafPOS günlük satırı varsa (deneme günleri dahil) ürün silinmez, "Menüde aktif" kapatılır;
yoksa satırların bağı sessizce koparırdı (FK `set null`).

`loadDailyProductSales(from, to)` (`src/server/data/daily-sales.ts`) satırları gün gün döner (yoksa `null`); bugün onu
okuyan yok. Günlük pencereye geçecek okuyucu (ör. hafta gününe göre tatlı oranı) bu ağızdan okur ve geçiş gününden
önceki deneme günlerini kendisi ayırır (`isLafposDay`): ağız bütün günleri döner.

### Kasa raporu: LafPOS'tan doldur

Yalnız LafPOS günlerinde: geçiş günü seçili ve raporun günü ondan önce değilse (`loadKasaLafpos`,
`src/server/data/lafpos-day.ts`; kural `isLafposDay`, `src/lib/lafpos/switch.ts`). Geçiş günü boşken ya da önceki bir
günde bant hiçbir role görünmez, form, e-posta, WhatsApp, kapalı gün, geç rapor ve ay rakamı bugünkü gibi ModPOS'a
göredir. LafPOS gününde (denetim B09):

- Z bölümünün adı **LafPOS gün sonu (Z)** (form, kayıtlı rapor, e-posta, WhatsApp); ModPOS Z fotoğrafı çekilmez, Banka POS
  Z (yazarkasa) bölümü kalır. O günün gönderimi gelmediyse açıklama "LafPOS'un bu günün sonu gelmedi; LafPOS'ta Kasa ›
  Geçmiş günler'deki Z raporundan yazın."
- Gönderim geldiyse **yeni form** (o günün ilk raporu, yeni geç rapor) açılırken aşağıdaki kuralla kendiliğinden dolar;
  hiçbir şey kaydedilmez. Yazılmış değerlerle açılan form (kayıtlı raporda Düzenle, düzeltme önerisi, reddedilen geç
  raporun önceki değerleri, onay kartının Düzeltip onayla'sı) **yalnız karşılaştırır**: hiçbir alan kendiliğinden
  değişmez, farklı olanlar turuncu ve altında "LafPOS'ta …" / "LafPOS'takini yaz"; metinler de "doldu" değil
  "karşılaştırıldı" der (Z bölümü: "Yazılan rakamlar LafPOS'un gün sonuyla karşılaştırıldı: …"; Düzeltip onayla'da
  bant "Personelin yazdıkları LafPOS'takiyle aynı." ya da "LafPOS'ta 2 alan personelin yazdığından farklı; …"). Bant:
  "LafPOS gün sonu · Z 128 · 26 Ekim 03:12" ve **LafPOS'tan doldur** (boş alanları doldurur).

Doldurma:

- ModPOS Z bölümünün alanları (Z no, fiş sayısı, toplam satış, nakit, kart, yemek kartı, online, diğer, ödenmez /
  ikram, indirim) ve kasa alanları (açılış, gün içinde çıkan, gün içinde kasaya giren, sayılan nakit, teslim edilen;
  eşlemesi aşağıda)
  fotoğraf okumasıyla aynı kuralla dolar (`CashPrefill { source: "lafpos" }`, `src/lib/lafpos/prefill.ts`): yalnız
  **boş** alanlar, yanında mavi **LafPOS'tan**.
- Yazılmış alan değişmez (açılış önceki devirden, gün içinde çıkan fişlerden kendiliğinden dolar). LafPOS'taki
  farklıysa altında "LafPOS'ta 1.500 ₺" ve **LafPOS'takini yaz** çıkar.
- Gün sayılmadan kapandıysa sayılan nakit boş kalır ve turuncudur: "LafPOS'ta gün sonu sayımı yok: çekmeceyi LafPOS'ta
  Kasa › Geçmiş günler › Kasa föyü'nden sayın; LafPOS günü yeniden gönderir." Sayım panelde yapılmaz: form o anda Z'nin
  rakamlarını gösterir, sayım kör olmazdı. Kasa föyü girilince LafPOS günü sayımla yeniden gönderir.
- Bant sonucu söyler: "LafPOS'tan 14 alan dolduruldu. Kontrol edip gönderin." ya da "… 1 alan yazdığınızdan farklı,
  turuncu olanlara bakın." Kasa eşlemesinin bilgi satırları (aşağıda) bandın altında mavi çıkar.
- **Hiçbir şey kendiliğinden kaydedilmez:** personel bakıp **Raporu gönder**'e basar. Kasa farkını form kendisi
  hesaplar (LafPOS'un `cashDiff`'i kullanılmaz); Banka POS LafPOS'tan gelmez.
- Kasa bandına personele yalnız Z ve geliş anı gider (`src/server/data/lafpos-day.ts`, sabit sütunlar); ödeme
  kanalları okunmaz. Günün zayi & ikram kartı LafPOS'un ikramını yalnız adı ve adediyle yazar (aşağıda, "İkram"). Özet
  okunamazsa bant görünmez, form her zamanki gibi elle doldurulur.

#### Gönderilmiş rapor ile LafPOS (denetim E-09)

Kayıtlı rapor LafPOS'un gün sonuyla karşılaştırılır (`lafposDiffs`, `src/lib/lafpos/diffs.ts`): Z alanları, açılış ve
gün içinde giren alan alan (boş bırakılan isteğe bağlı alan farklı sayılmaz), kasa aşağıdaki eşlemeyle. Teslim sayımdan
sonra yazıldıysa (Teslim edilen > 0) çıkan + teslim LafPOS'un harcama + teslimiyle, devir (sayılan − teslim) LafPOS'un
sayımıyla karşılaştırılır; LafPOS'ta sayım yoksa sayılan karşılaştırılmaz. Fark varsa:

- kayıtlı rapor ve günden güne görünüm (rozet "LafPOS'tan farklı"): "LafPOS'tan farklı yazılan · Sayılan nakit 9.350 ₺
  (LafPOS'ta 9.000 ₺)";
- e-posta (turuncu kutu) ve WhatsApp metni (`⚠️ LafPOS'tan farklı yazılan: …`): `cashReportExtras` sunucuda hesaplar;
- yöneticinin zili: "Kasa raporu LafPOS'tan farklı" (son 7 gün); LafPOS günü rapordan sonra farklı rakamla yeniden
  gönderdiyse "LafPOS rapordan sonra farklı rakamla geldi";
- geç rapor kartı: LafPOS'un Z'si ("LafPOS gün sonu · Z 13 · 63 fiş · 20.000 ₺ · nakit 12.000 ₺ · sayılan 9.000 ₺") ve
  personelin farklı yazdıkları.

#### Gün içinde çıkan: panelin Kasadan çıkanlar'ı kaynak (denetim E-35)

Fişli harcama ve teslim panelin **Kasadan çıkanlar**'ına girilir (Aylık harcamalar, tedarikçi ödemeleri oradan
okunur); LafPOS yalnız toplam yollar (harcama, teslim). Sahibe soru (denetim, soru 5): bundan sonra nereye
girilecek; cevaplanana kadar panel kaynaktır. Formda Gün içinde çıkan fişlerden kendiliğinden dolar; LafPOS'un
birleşik tutarı farklıysa alanın altında "LafPOS'ta 5.450 ₺" görünür ama fişler varken **LafPOS'takini yaz** yoktur
(fişsiz çıkış olurdu) ve bilgi satırı ne yapılacağını söyler (`lafposOutsCheck`): "LafPOS'ta harcama 450 ₺ + teslim
5.000 ₺; Kasadan çıkanlar'da 450 ₺. Teslimi Kasadan çıkanlar'a "Teslim" olarak ekleyin; Gün içinde çıkan kendiliğinden
5.450 ₺ olur." Geç rapor ve düzeltme kartı fişlerden fazlası LafPOS'taki teslim kadarsa "fişsiz" demez
(`lafposHandedGap`).

#### Kart: kartla bahşiş ve cari tahsilatı (G11)

LafPOS isteğe bağlı `z.cardTips` (kartla bahşiş) ve `z.cardCollections` (kartla cari tahsilatı) yollar: banka POS'u
görür, Z'nin kartı görmez. LafPOS gününde kart karşılaştırması (form, kayıtlı rapor, günden güne rozeti, e-posta,
WhatsApp) bunların toplamını düşer (`lafposCardExtra`, `withCardExtra`), personelde de: aynı gün her okurda aynı
sonucu verir (personelin ekranı "fark var", gönderdiği WhatsApp "aynı" demez). Tutar personelin ekranına da gider,
çünkü personelin yazdığı Banka POS ile kartın farkından zaten çıkar; metinde tutarı yalnız yöneticininki yazar
("LafPOS'taki kartla bahşiş ve cari tahsilatı (520 ₺) düşüldü."; personelde "… düşüldü."). Yalnız Banka POS yazılan
raporun Kart bölümünde ve e-postasında ayrı satır: "− LafPOS kartla bahşiş + cari tahsilatı 150 ₺" (personelde
"düşüldü"), böylece 10.150 ile 10.000 arasında "Fark yok" okunur; WhatsApp'ın kart satırı "(bahşiş / cari tahsilatı
düşüldü)" ekler. Kaydedilmez; eski gövdede yoksa 0.

#### Geç rapor, fotoğraf kaldırma, kapalı gün, ay rakamı (G8, E-36, G6)

- **Geç rapor:** kanıt günün kasasına göre (`kasaEvidence`): LafPOS'un gün sonu geldiyse fotoğraf gerekmez ve form ondan
  dolar; gelmediyse yazarkasa (Banka POS) Z fotoğrafı zorunlu. Fotoğraf kaldırma isteği aynı kurala bakar (LafPOS
  gününde ModPOS Z fotoğrafı kanıt değildir; gün sonu gelmediyse tek yazarkasa Z fotoğrafı kaldırılmaz).
- **Kafe kapalıydı:** LafPOS'un satışlı gün sonu kanıttır (kırmızı "LafPOS'ta Z 14 · 63 fiş", tutar yok; satışsızsa
  uyarı): personelin isteği açılmaz, yönetici onaylayamaz. Satışlı gün sonu geldiğinde o günün bekleyen bildirimi kapanır
  ve tek günlük kapalı işaret kalkar (`onLafposDaySaved`, gün sonunun yazımıyla aynı işlemde). Geçiş günü boşken alım hiçbir
  kaydı değiştirmez. Aynı günün satışlı gün sonu daha önce geldiyse (LafPOS düzeltip yeniden gönderdi) o andan sonra
  konan işaret yöneticinin kanıtı görerek verdiği karardır: yeniden gönderim onu kaldırmaz; yalnız ondan önce konan
  işaret kalkar. İlk gönderim satışsızsa (fiş ve Z toplamı 0) sonraki satışlı gönderim ilk satışlı gönderim sayılır.
- **Ay rakamı:** kasa raporu girilmemiş LafPOS gününün Z'si ayın açık gün, ciro, indirim, ödenmez ve kart payına girer
  (`tillRows`, `source: "lafpos"`); gün yine "rapor yok" sayılır, rapor girilince rapor kazanır.

#### Kasa alanlarının eşlemesi (26 Ekim 2026)

LafPOS'ta **teslim** gün açıkken, sayımdan önce çekmeceden çıkar; panelde **Teslim edilen** sayımdan sonra verilen
paradır (olması gerekenden değil, ertesi güne devirden düşer). Bu yüzden LafPOS'un teslimi panelde **gün içinde
çıkan**dır, Teslim edilen 0 yazılır. Nakit satış dışında çekmeceye giren (`cashIn`: giriş, nakit müşteri tahsilatı ve
nakit bahşiş) panelin **Gün içinde kasaya giren**idir:

| Panelin alanı | LafPOS'tan |
|---|---|
| Açılış | `openingCash` |
| Gün içinde kasadan çıkan | `cashOut` (harcama) + `handedOver` (teslim) |
| Gün içinde kasaya giren | `cashIn` (gelmediyse ya da `null`sa 0) |
| Sayılan nakit | `countedCash` (sayılmadıysa boş ve turuncu) |
| Teslim edilen | 0 |

Böylece panelin olması gerekeni (açılış + nakit + giren − çıkan, `computeCash`) LafPOS'unkine eşittir
(`expectedCash` = açılış + nakit + `cashIn` − harcama − teslim), devir sayılan nakittir. Giren çıkandan fazla olsa da
(bahşiş, tahsilat günü) bir şey kırpılmaz. Örnek (TL): açılış 1.500, nakit satış 12.000, nakit bahşiş 300, nakit
tahsilat 1.000 (`cashIn` 1.300), harcama 450.

- Gün ortasında 5.000 teslim: gün içinde çıkan 5.450, giren 1.300; LafPOS da panel de 9.350 bekler, 9.350 sayıldıysa
  kasa tutuyor, devir 9.350.
- Teslim yok: gün içinde çıkan 450, giren 1.300; ikisi de 14.350 bekler, 14.350 sayıldıysa kasa tutuyor, devir 14.350.
  (Önceki eşleme gireni çıkandan düşüp 0'da kırpıyordu: panel 13.500 bekleyip "850 ₺ fazla" kaydederdi.)

LafPOS kendi olması gerekenini (`expectedCash`) gönderdiyse ve panelin aynı rakamlarla hesabından 0,01 TL'den fazla
ayrılıyorsa bandın altındaki bilgi satırı LafPOS'un rakamını gösterir ("LafPOS'ta olması gereken nakit 14.000 ₺; panel
aynı rakamlarla 14.700 ₺ hesaplıyor (700 ₺ fazla)."); aradaki fark gizli kalmaz. Eski LafPOS `cashIn` göndermez: giren
0 yazılır, gün içinde çıkan yine harcama + teslimdir.

### Komisyon: ödeme kanalları (denetim E-37)

`payments[]` (ad, Z alanı, kanal, tutar) geçiş gününden itibaren Komisyon & hakediş'in kanal kanal satışıdır
(`loadCommissionInput`, `src/server/data/commission.ts`; kural `src/lib/commission/report.ts` › `lafposMonth`,
`lafposSales`; ayrıntı [KOMISYON.md](KOMISYON.md) §3 "LafPOS'tan kart kart"). Öncelik **elle > lafpos > tek**: yöneticinin
yazdığı ekstre her zaman kazanır. Geçiş ayında geçiş gününden önceki günler kasa raporu kuralıyla. Kanal yazısı anahtar
(`pluxee`, `multinet`, `edenred`, `setcard`, `metropol`, `yemeksepeti`, `trendyol`, `getir`, `migros`) ya da kanalın
adı olarak tanınır (`lafposChannel`, `src/lib/commission/channels.ts`); kanalı seçilmemiş ya da tanınmayan ödeme türü
grup kartında bilgi satırıdır ve kart kart dağıtılmaz. Gün sonu gelmeyen gün eksik sayılır (raporu varsa grubun
toplamına rapordan girer). Geçiş günü boşken ödeme kanalları hiçbir yerde okunmaz; geçiş gününden önceki günler
(deneme) hiçbir aya girmez.

### İkram (denetim E-38)

`ikram[]` (ad, sitenin kalemi ve boyu, adet, menü değeri, neden) geçiş gününden itibaren ürün ikramının kaynağıdır
(`src/lib/lafpos/ikram.ts`, okuyucu `src/server/data/lafpos-ikram.ts`; ayrıntı [ZAYI-IKRAM.md](ZAYI-IKRAM.md) › LafPOS'a
geçildikten sonra). LafPOS satış satırları (`lines[]`) ikramı içermez (LafPOS ikram kalemlerini satış satırından
çıkarır, `server/sync/lafmaliyet.ts`): çift sayım yok.

- Satır panel ürününe gün sonu satırlarıyla aynı sırayla bağlanır (sitenin kalemi ve boyu, sonra POS adı
  eşleştirmesi), okuma anında: ürün sonradan bağlanınca geçmiş ikram da bulunur. Bağlanamayan satır tüketime girmez;
  adı Ayarlar › LafPOS'ta "İkramda ürüne bağlanamayan POS adları" altında listelenir ve oradan bağlanır (yalnız ikram
  edilen kalem satış satırlarına hiç düşmez).
- **Tür nedenin ön ekinden** (sözleşmede tür alanı yok; LafPOS `shared/comp.ts` `compReasonText`): "Zayi: Döküldü"
  zayidir (ön ek atılır), "Ödenmez: Personel yemeği" ve öteki her satır ikramdır (`lafposLineKind`).
- **Her gün tek kaynak:** LafPOS'un gün sonu gelen günde satırlar kendi türüyle veri kümesine (`Dataset.lafposIkram`),
  oradan Tutarlılık'ın kayıtlı tüketimine, Zayi'nin ay özetine ve haftalık özete girer (`Model.countedWaste`); panele o
  güne girilmiş ürün ikramı sayılmaz. Hammadde ikramı ve zayi panelde kalır; panelin ürün zayisi LafPOS'ta da aynı gün
  zayi yazıldıysa ikisi de sayılır ve gün listesinde işaretlenir (sahibin sorusu).
- Panelde yeni ürün ikramı, gün sonu gelen günde ve bugün reddedilir (doğrudan, geç kayıt isteği, isteğin onayı); gün
  sonu gelmeyen geçmiş günde girilir. Zayi'nin gün listesi LafPOS'un ikram ve zayi satırlarını salt okunur gösterir
  (personelde ad ve adet; yöneticide nedeni ve menü değeri).
- Kasa raporunun özeti (form, e-posta, WhatsApp, Bugün) o günün ikram ve zayisini LafPOS'tan yazar; e-posta LafPOS'un
  Z'sindeki ödenmez tutarı (zayi yazılanı da kapsar) ile listenin tamamının menü değerini karşılaştırır (fark bilgi
  satırı, işarete göre açıklama; eski LafPOS iptal edilen adisyonun ikramını da yolluyordu, LafPOS L1 ikisini aynı
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
- Başka alan gitmez: fiyat, kâr, marj, reçete ve hammadde yok (`src/lib/lafpos/costs.ts`). Makine ucudur: oturumla
  açılmaz, panel ekranlarında yoktur; LafPOS bu rakamı yalnız `rapor.maliyet` yetkisi olanlara gösterir.

## Geçiş günü

**Ayarlar › LafPOS (kasa) › LafPOS'a geçiş günü** (`settings.lafposGecisGunu`; `Settings` tipinde ve
`DEFAULT_SETTINGS`'te `null`): kasada LafPOS'un kullanılmaya başlandığı ilk iş günü (YYYY-MM-DD, 05:00 kuralı).

- **Boş (varsayılan):** kasa ModPOS. Her şey bugünkü gibi çalışır; LafPOS'un gönderdiği günler deneme sayılır.
- **Dolu:** o günden itibaren kaynak LafPOS. Bugün değişen: 200 yanıtı `counted: true` der (B07); Kasa raporu o günden
  itibaren LafPOS'un gün sonuyla açılır, kayıtlı rapor, e-posta ve WhatsApp LafPOS'tan farklı yazılanı söyler, geç rapor
  LafPOS'un gün sonuyla (gelmediyse yazarkasa Z fotoğrafıyla) girilir, satışlı LafPOS günü kapalı gün kanıtıdır,
  raporsuz LafPOS günü ay rakamına girer (B09, yukarıda "Kasa raporu"); ürün satışları aylık modele girer, satış
  tahmini raporsuz günde LafPOS Z'sini okur (B08, yukarıda "Günlük satış"); Komisyon & hakediş kart kart satışı LafPOS'un
  ödeme türlerinden alır, ürün ikramı LafPOS'tan gelir ve panelde girilmez (B10, yukarıda "Komisyon" ve "İkram");
  "Kasadaki fiyatlar" yalnız siteye bağlı olmayan, fiyatı LafPOS günü panelde değişen ürünler içindir ve yalnız
  yöneticinin işidir, ModPOS metinleri LafPOS der (B11, aşağıda
  "Metinler ve kasadaki fiyatlar"). Onay penceresinin listesi (`LAFPOS_SWITCH_EFFECTS`) kodun yaptığından fazlasını
  söylemez.
- **Kural tek yerde:** `src/lib/lafpos/switch.ts` (`isLafposDay`, `kasaName`, `monthSource`, `switchAffectedMonths`,
  `modposListCounts`, `lafposSalesFrom`, `lafposCountFrom`);
  okuma kuralı `src/lib/constants.ts` › `readLafposSwitchDay` (takvimde olan gün, 1 Ekim 2026'dan önce değil; bozuk değer
  `null`). Geçiş gününü okuyan her yer bu yardımcılardan geçer.
- **Kim, nasıl:** yalnız yönetici (`saveLafposSwitchDay`, `src/server/actions/lafpos.ts`; rol çekirdekte de denetlenir,
  `src/server/lafpos/admin.ts`). Kaydetmeden önce onay penceresi: neyin değiştiği ve kaynağı değişen günlerin ayları.
  En erken 1 Ekim 2026, en çok 90 gün ileride. FIFO başlangıcı gibi parola istemez; işlem geçmişine "LafPOS'a geçiş
  günü: yok (kasa ModPOS) → 10 Kasım 2026" düşer. Boşaltmak satırı siler.
- **Hiçbir veri yazılmaz ya da silinmez:** ayar yalnız okuyanları değiştirir; geri almak günü değiştirmek ya da
  boşaltmaktır. Tercihen ayın 1'i (ModPOS'un o ayki ürün listesi bölünmez).
- **LafPOS kendi tarihini tutmaz:** bütün gerçek günleri gönderir; neyin sayıldığına panel karar verir ve yanıtta söyler
  (`counted`, `switchDay`).

### Metinler ve kasadaki fiyatlar (denetim B11, E-39)

Denetimin önerdiği ayrı "kasa kipi" ayarı (ya da "son günlerde LafPOS günü geldiyse LafPOS" sezgisi) yerine geçiş günü
kullanılır: deneme günleri hiçbir metni değiştirmez. Günün kasası `kasaName(gün, geçiş günü)`, ayın kasası
`monthKasa(ay, geçiş günü)` (`src/lib/lafpos/kasa.ts`; geçiş ayında "Kasa (ModPOS 1–9 Kasım · LafPOS 10–30 Kasım)").
Ürün satışlarının etiketi (Genel bakış'ın net satışı, Excel'in Özet'i, Claude'un ürün kârlılığı) geçiş ayında modelin
saydığı bölünmeyi yazar (`salesMonthKasa`: ModPOS listesinin son günü, LafPOS'un sayılan günleri; liste yoksa "ModPOS
listesi yok"); Z ve ciro etiketleri geçiş gününde böler. Geçiş günü boşken her metin bugünkünün aynısıdır.

- **Kasadaki fiyatlar** (`docs/FIYATLAR.md` › LafPOS'a geçiş gününden itibaren): bugün LafPOS günüyse siteye bağlı
  ürün Kasaya işle'de görünmez (LafPOS fiyatı siteden alır); kasanın ModPOS durumu yine yazılır, geçiş günü kaldırılır
  ya da ileri alınırsa eksiksiz geri gelir. Bağlı olmayan ürün yalnız fiyatı LafPOS başladıktan sonra panelde
  değiştiyse görünür; metin "LafPOS ürünü siteden alıyorsa Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin;
  yerelse LafPOS'ta elle" der. Bu iş yalnız yöneticinindir (LafPOS'ta ürün fiyatını kasiyer değiştiremez): personelin
  zilinde ve Bugün'ünde satır yok, Kasadaki fiyatlar boş, işaret eylemi personeli reddeder. Zil, Bugün, haftalık özet,
  ürün kartı, Ürünler ve Fiyatlar aynı süzgeçten okur (`src/server/data/till-scope.ts`).
- **Günün kasası:** Bugün'ün ve zilin akşam satırı ("Kapanışta LafPOS'ta Günü kapat'a basın"), Kasa raporunun
  başlığı, yazarkasa karşılaştırmaları (form, kayıtlı görünüm, onay kartı, e-posta, WhatsApp: "Kart LafPOS ile aynı",
  "LafPOS kart"), günün online satış satırı, kapalı gün kartı ve Bugün'ün kapalı gün satırı ("o günün LafPOS / banka
  POS'una bakın"). LafPOS gününde yazarkasa bölümüne çekilen kasa çıktısına "ModPOS bölümüne okut" önerilmez.
- **Ayın kasası:** Genel bakış (net satış, POS cirosu, döküm), Gelir-gider (online kartı, yıl dökümü, telefon görünümü,
  tablo ipuçları), Tutarlılık, Ürünler, Analiz'in senaryosu, KDV tahmini, Excel ve Claude'un yanıtları.
- Yardım (yönetici ve personel) LafPOS'a geçildiyse ne değiştiğini yazar: akşam kasası (LafPOS'ta Günü kapat, form gün
  sonundan dolar, ModPOS Z fotoğrafı yok, yazarkasa LafPOS'la karşılaştırılır), banka POS Z'si, kasadaki fiyatlar
  (personele düşmez; yönetici bağlar ya da LafPOS'ta değiştirir), Tükendi'nin kasaya da yansıması (gün açıkken en geç
  15 dakika; acilse LafPOS'ta da Tükendi).

## Durum ve onarım

`POST /api/pos/gun`'un her sonucu `integration_state`'in `lafpos` satırına yazılır (`handlePosDay`,
`src/server/lafpos/status.ts`; denetim ve yazım yine `receivePosDay`'de):

| Sonuç | Yazılan |
|-------|---------|
| 200 | `lastOk`: an, gün, Z no, satır sayısı, `counted`; o günün `rejections` kaydı silinir (gün yeniden yazıldı) |
| 400, 409, 500 (imza doğrulanmış) | `lastError`: an, durum, hata, alan (400), gün, paneldeki Z (409), gönderilen Z (409). Günü okunan 400 ve 409 ayrıca `rejections[gün]`'e (aynı günün eskisinin yerine, en çok 10 gün; satır kilitlenerek) |
| 401, 413 (imza doğrulanamadı) | yalnız `unverified`: sayaç, son an, son durum. Gövde okunmaz; yazım örnek başına dakikada bir (imzasız istek yağmuru yazım yağmuru olmasın), aradakiler bellekte birikip sonraki yazıma eklenir: sayaç "en az" |
| 503 (anahtar yok) | hiçbir şey |

Retler gövdesiz günlüğe de düşer: `[lafpos] reddedildi 409 z_conflict 2026-10-26 127`. Durum yazımı yanıtı hiçbir
zaman bozmaz. Durum satırı aynı anda gelen iki sonucun alanını ezmez (üst düzey birleştirme).

**LafPOS 400 ve 409'u kendisi yeniden denemez** (giden kutusunda bir yıl bekletir; LafPOS
`server/sync/lafmaliyet.ts`): reddedilen ya da panelde silinen gün ancak LafPOS'ta **Kasa › Geçmiş günler › o günün Z
raporu › Gönder** ile yeniden gelir. Bu yüzden günlü ret güne göre tutulur: sonraki günün başarılı gönderimi ya da başka
bir günün reddi onu örtmez. Kartta durumu o günün paneldeki kaydından okunur (`dayRejectionStatus`): gün retten sonra
yeniden yazıldıysa çözüldü (gösterilmez), yönetici sildiyse ya da 409'un günü panelde yoksa "LafPOS'tan Gönder
bekleniyor" (turuncu), değilse açık (kırmızı). 500'ü LafPOS kendisi yeniden dener: güne bağlanamayan ret (500 ve gövdesi
okunamayan 400) son başarılı gönderimden yeniyse kırmızı, değilse gri "Önceki ret".

**Ayarlar › LafPOS (kasa)** kartı (yalnız yönetici; saf özet `lafposCardSummary`, `src/lib/lafpos/status.ts`):

- Durum, sakin dille: "Henüz kurulmadı · kasada ModPOS kullanılıyor." (gri, hata değil) · "Bağlı · geçiş günü
  seçilmedi: LafPOS günleri saklanıyor, hesaplara girmiyor." · "Geçiş günü 10 Kasım 2026 (4 gün sonra). O güne kadar
  kasa ModPOS." · "Kasa LafPOS (10 Kasım'dan beri)." ve son gün sonu. Kırmızı yalnız geçiş günü seçili ama anahtar
  yokken ("LafPOS günleri gelemez"). Anahtar 32 karakterden kısa ya da sitenin anahtarıyla aynıysa nedeni yazılır.
- Güne göre açık retler (kırmızı, her biri kendi kutusunda, en yeni gün önce) ve metni; 409'da, gün hâlâ reddeden Z ile
  kayıtlıysa **Bu günün LafPOS kaydını sil**. Silinen gün "LafPOS'tan Gönder bekleniyor" (turuncu) olur, LafPOS'tan
  gelince kalkar. Güne bağlanamayan son ret ayrı kutuda. Telefonda kapalı özetin başına yazılır ("7 Kasım gönderimi
  reddedildi", "2 gönderim reddedildi", "7 Kasım için LafPOS'tan Gönder bekleniyor"). Anahtar yokken retler kırmızı
  değildir.
- İmzası doğrulanamayan istekler (son 14 gün): son an ve sayaç. Yabancı bir istek de olabilir: metin suçlamaz
  ("LafPOS'tansa anahtarı ve kafedeki saati (±5 dk) denetleyin"); o istekten sonra başarılı gönderim geldiyse turuncu
  değil, soluk bilgi.
- Geçiş günü alanı ve onay penceresi.
- Gelen günler (en yeni 14): Z, fiş, ciro, satır, geliş anı, **Sayılıyor** ya da **Deneme**, satır sonunda sil.
- Geçiş gününden düne gün sonu gelmeyen günler (onaylı kapalı günler hariç, en çok son 60 gün), ipucuyla: LafPOS'ta
  Yönetim › Entegrasyon'daki giden kutusu; reddedilen gün Kasa › Geçmiş günler › Z raporu › Gönder ile yeniden gider.
- Ürüne bağlanamayan POS adları (hizmet satırları hariç, en çok satılan 10 ad): ad, adet, gün ve **Bağla** (ürün ya da
  HİZMET seçilir; `matchLafposName`, ay olmadan). Ad Satışlar'ın POS adı hafızasına yazılır, bu adla gelmiş bütün
  ürünsüz satırlar (deneme günleri dahil) hemen bağlanır, sonraki gün sonları da tanır; hiçbir hesap değişmez (geçiş
  günü boşken satırlar sayılmaz). Hafıza ModPOS listeleriyle ortaktır: aynı ad sonraki ModPOS yüklemelerinde de tanınır.
  Yalnız LafPOS'ta geçen ad (hiçbir ModPOS listesinde yok) Kasadaki fiyatlar'da (personel ve yönetici listesi) "Kasada:
  …" diye gösterilmez (`modposNameFilter`). Ürün sitenin kalemine Ürünler › Site menüsü'nde de bağlanabilir; geçiş
  gününden sonraki aylarda Satışlar'da da eşleştirilir.

**Bu günün LafPOS kaydını sil** (`deleteLafposDay`; çekirdek `removeLafposDay`, `src/server/lafpos/admin.ts`): yalnız
yönetici, kendi parolasıyla (`requireStepUp`, yanlışı işlem geçmişine "Hatalı parola onayı (LafPOS)"). Gün sonunun
yazımıyla aynı danışma kilidi (`lafpos-gun:<gün>`) altında, tek işlemde `pos_day_reports` ve `pos_daily_sales`
satırlarını siler; yalnız yöneticinin gördüğü Z'ye koşullu (bu arada başka Z ile yeniden yazılan gün silinmez). Durum
satırındaki o günün reddi yalnız bu silmenin çözdüğü çakışmaysa (409, aynı Z) "silindi" olur; aynı günün 400'ü alanı ve
nedeniyle açık kalır. **LafPOS silinen günü kendisi yeniden göndermez**: sonra LafPOS'ta Kasa › Geçmiş günler › o günün
Z raporu › **Gönder**'e basılır; o güne kadar kart "LafPOS'tan Gönder bekleniyor" der, gün gelince kalkar. İşlem
geçmişi: "LafPOS günü silindi · 26 Ekim 2026 · Z 127 · 42 satır". Deneme günlerini temizlemek için de kullanılır (aynı
kural: yeniden gelmesi için Gönder).

## Açılış sırası

Sahibin istediği tek liste; LafPOS deposunda `docs/03-ENTEGRASYON.md` › "Açılış sırası" aynı adımlardır. Partiler
birleşip yayına çıkmak hiçbir şeyi açmaz: anahtar ve geçiş günü yokken üç sistem bugünkü gibi çalışır.

1. **Anahtarlar** (bu parti yayındayken, en erken): bir anahtar üretin, `openssl rand -base64 48` (en az 32 karakter).
   Vercel'de bu projeye (yalnız Production) `LAFPOS_SYNC_SECRET`; LafPOS'un `.env`'ine aynı değerle
   `LAFMALIYET_SYNC_SECRET` ve `LAFMALIYET_URL=https://ladmin.laffogato.net`. Sitenin `KARAOKE_SYNC_SECRET`'ından
   **ayrı** olsun: kafedeki makinede sitenin anahtarı durmaz, ikisi ayrı döndürülür; aynıysa panel bağlantıyı açmaz
   (kart nedenini yazar). Sitenin (laffogato) kendi `LAFPOS_SYNC_SECRET`'ı **başka bir değerdir**: adları aynı,
   değerleri ayrı. Paneli yeniden yayınlayın. Migration'lar (`0040_lafpos_baglantisi`, `0041_kasaya_giren`) zaten
   canlıda.
2. **Deneme gönderimi:** LafPOS kurulum modundan çıkmışken gerçek bir günü kapatın (ModPOS'la paralel olabilir).
   Ayarlar › LafPOS (kasa)'da gün **Deneme** olarak görünür, yanıt `counted: false`; başka hiçbir ekranda görünmez.
   Retler aynı kartta. Kartın "Ürüne bağlanamayan POS adları" listesinde adlar **Bağla** ile ürüne bağlanır (ya da
   ürün Ürünler › Site menüsü'nde sitenin kalemine bağlanır); kayıtlı günler de hemen güncellenir. Liste öneridir, ön
   koşul değil. Eğitim / kurulum günleri geldiyse kartta silin.
3. **Geçiş günü:** Ayarlar › LafPOS (kasa) › LafPOS'a geçiş günü (tercihen ayın 1'i). O günden itibaren Kasa raporunda
   bant çıkar, ürün satışları LafPOS'tan gelir ve sonraki partilerin okuyucuları LafPOS'a geçer. Geçiş günü ayın
   ortasındaysa o ayın ModPOS listesi Satışlar'a geçiş gününden önceki günler için yüklenir (1–9 Kasım; yükleme o güne
   kırpar).

Anahtar yokken iki uç `503` döner; panelin geri kalanı ve Kasa raporu eskisi gibi çalışır.

## Güvenlik ve KVKK

- İmza laffogato.net bağlantısınınkiyle aynı kural ve aynı kod (`src/lib/karaoke/signature.ts`): `x-laf-timestamp`
  (unix saniye), `x-laf-signature: v1=<hex>`, HMAC-SHA256(zaman, yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı),
  ±5 dakika, sabit süreli karşılaştırma. Yol imzanın içindedir: bir ucun imzası öteki uçta geçmez. İki ucun vektörleri
  `tests/lafpos.test.ts`'te sabit; LafPOS'un `server/lib/signature.ts`'i aynılarını verir.
- Gövdede kişisel veri yoktur (müşteri, personel adı, telefon). İkram nedeni serbest metindir ve yalnız yöneticinin
  verisinde kalır; personele giden Kasa bandı yalnız Z'yi, Zayi'nin günü LafPOS ikramının yalnız adını ve adedini
  taşır; ödeme kanalları yalnız yöneticinin Komisyon & hakediş'inde.
- Maliyet ucu yalnız imzayla açılır; personel maliyet ve kâr görmez.
- Yedeğe iki tablo kendiliğinden girer (gizli sütun yok). `db:reset` ürünleri baştan yüklediği için günlük satırlar da
  silinir (ürün kimliklerine bağlı); gün sonu özetleri kalır.

## Sorun giderme

| Yanıt | Ne yapılır |
|-------|------------|
| `503 not_configured` | Panelde `LAFPOS_SYNC_SECRET` yok, 32 karakterden kısa ya da sitenin `KARAOKE_SYNC_SECRET`'ıyla aynı: ayrı bir değer ekleyip yeniden yayınlayın (kart nedenini yazar) |
| `401 unauthorized` | İki taraftaki anahtar aynı mı (LafPOS'ta `LAFMALIYET_SYNC_SECRET`), kafedeki makinenin saati doğru mu (±5 dakika)? Kart son anı ve sayacı gösterir; yabancı bir istek de olabilir, sonra başarılı gönderim geldiyse bağlantı çalışıyor |
| `413 too_large` | Gövde 256 KB'ı aştı; LafPOS'un gönderdiğine bakın |
| `400 invalid` + `field` | Gövde sözleşmeye uymuyor; `field` ilk sorunlu alanın yolu (`date`: ileri ya da bozuk gün, `lines.5.posName`: aynı ad iki kez). LafPOS kendisi yeniden denemez: düzeltilince LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder. Kart o günün reddini alanıyla, gün yeniden gelene kadar gösterir |
| `409 z_conflict` + `date`, `zNo` | O güne panelde başka bir Z no ile (`zNo`) yazılmış gün sonu var; hiçbir şey yazılmadı, yeniden deneme de 409 alır. Bir tarihte bir Z olur: paneldeki doğruysa LafPOS'taki fazla günü düzeltin; LafPOS'taki doğruysa yönetici Ayarlar › LafPOS (kasa)'da **Bu günün LafPOS kaydını sil**'e basar (parolayla; o günün özeti ve satırları tek işlemde silinir), **sonra LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basılır** (LafPOS reddedilen günü kendisi yeniden denemez). Kart reddi gününe göre iki Z'siyle, silindikten sonra "LafPOS'tan Gönder bekleniyor" diye gösterir |
| `500 server_error` | Panel yazamadı (veritabanı); LafPOS yeniden dener. Sürüyorsa Vercel günlüğünde `[lafpos]` |
| Kasa raporunda bant yok | Geçiş günü seçilmedi ya da gün ondan önce (bilerek: deneme günü Kasa'ya girmez); o günün gönderimi gelmedi (LafPOS'un giden kutusu; kart gelmeyen günleri listeler) ya da gün başka (05:00 kuralı) |
| Satışlar'da LafPOS satırı yok | Geçiş günü seçilmedi ya da ay ondan önce (deneme satırları yalnız Ayarlar kartında); geçiş ayında liste ayın sonuna kadarsa LafPOS o ay sayılmaz (Satışlar'ın uyarısı: yalnız geçiş gününden önceki günlerin listesini yükleyin) |
| Satışlar "ModPOS listesi sayılmıyor" | Ayın tamamı geçiş gününden sonra: o aya eskiden yüklenmiş liste hesaba girmez; "Ayı temizle" ile silinir |
| LafPOS satırı ürünsüz | Ayarlar › LafPOS kartında Bağla, Satışlar'da eşleştir ya da ürünü Ürünler › Site menüsü'nde sitenin kalemine bağla; kayıtlı günler yeniden gönderim olmadan bağlanır |

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/lafpos/day.ts` | Gövdenin şeması (beyaz liste), okunması ve hata alanı, ürünün bulunma sırası (saf) |
| `src/lib/lafpos/request.ts` | Anahtar ve imzalı isteğin denetimi (saf) |
| `src/lib/lafpos/prefill.ts` | Z → Kasa formunun alanları (`CashPrefill`), bandın metni, harcama ve teslimin bilgi satırı, kartla bahşiş ve cari tahsilatı (saf) |
| `src/lib/lafpos/diffs.ts` | Gönderilmiş raporun LafPOS'tan farklı yazılanları ve metni (saf) |
| `src/lib/lafpos/costs.ts` | Maliyet listesinin beyaz listesi (saf) |
| `src/lib/lafpos/switch.ts` | Geçiş gününün kuralları (saf): LafPOS günü mü, ayın kaynağı, ModPOS listesi sayılır mı, LafPOS'un sayıldığı ilk gün, değişen aylar, onay penceresinin listesi |
| `src/lib/lafpos/kasa.ts` | Metinlerde kasanın adı (saf; B11): ayın kasası (`monthKasa`, `periodKasa`), bugünün kasası ve kasadaki fiyatın elle değişip değişmediği (`tillScope`, `tillPriceManual`) |
| `src/server/data/till-scope.ts` | Bugünün kasası (iş günü + geçiş günü) ve Kasaya işle okuyucularının süzgeci (B11) |
| `src/components/panel/kasa-text.tsx` | Sayfa başlığının günün kasasına göre metni (beklerken ve geçiş günü boşken ModPOS'unki; B11) |
| `src/lib/lafpos/sales.ts` | LafPOS ay toplamlarıyla ModPOS listesinin birleşmesi (her gün tek kaynak), ayın kaynağı ve Satışlar'ın bandı, ModPOS listesi yükleme kuralı (saf) |
| `src/server/data/lafpos-sales.ts` | Sayılan günlerin ay toplamları ve gün sonları; veri kümesi ve tatlı payı için birleştirme |
| `src/server/lafpos/rematch.ts` | Ürünsüz satırların sonradan bağlanması (site kalemi, POS adı) |
| `src/lib/lafpos/ikram.ts`, `src/server/data/lafpos-ikram.ts` | İkramın kuralı (her gün tek kaynak, ürün ikramının reddi, e-postanın karşılaştırması; saf) ve okuyucusu (veri kümesi, Zayi'nin günü, kasa özeti) |
| `src/lib/commission/report.ts` (`lafposMonth`, `lafposSales`), `src/lib/commission/channels.ts` (`lafposChannel`), `src/server/data/commission.ts` | Ödeme kanallarının Komisyon & hakediş'e girmesi |
| `src/lib/lafpos/status.ts` | Durum satırının biçimi, retlerin metni, Ayarlar kartının özeti, gelmeyen günler (saf) |
| `src/server/lafpos/status.ts` | Ucun sonucu durum satırına (`handlePosDay`, imzasız sayaç), geçiş günü okuyucusu, kartın verisi |
| `src/server/lafpos/admin.ts` | Geçiş gününün yazımı ve günün silinmesi (çekirdekler, rol denetimi) |
| `src/server/actions/lafpos.ts` | Ayarlar'ın iki eylemi (yönetici; silme parolayla) |
| `src/app/panel/ayarlar/lafpos-card.tsx`, `lafpos-client.tsx` | Ayarlar › LafPOS (kasa) |
| `src/server/lafpos/ingest.ts` | Gün sonunun denetimi ve tek işlemde yazımı |
| `src/server/lafpos/products.ts` | Maliyet ucunun çekirdeği (maliyet modeli) |
| `src/server/data/daily-sales.ts` | `loadDailyProductSales` (gün gün; bugün okuyan yok) |
| `src/app/panel/satislar/page.tsx`, `sales-client.tsx`, `product-picker.tsx` | Satışlar'ın bandı, LafPOS satırları ve eşleştirmesi, geçiş ayının yüklemesi |
| `src/server/data/lafpos-day.ts` | Kasa raporunun okuyucusu (yalnız Z; `loadKasaLafpos` ve ay görünümünün `loadKasaLafposDays` yalnız geçiş gününden sonra), günün kanıtı (`kasaEvidence`) |
| `src/app/api/pos/gun/route.ts`, `src/app/api/panel/pos/urunler/route.ts` | Uçlar |
| `src/app/panel/kasa/cash-form.tsx`, `page.tsx`, `late-report.tsx`, `cash-history.tsx`, `cash-summary.tsx` | LafPOS gününde form (açılışta doldurma, Z bölümü, bilgi satırı), kayıtlı rapor ve günden güne farkları, geç rapor |
| `src/server/closed-days.ts` | Kapalı gün kanıtında LafPOS'un gün sonu, satışlı gün sonunun kapalı işareti kaldırması (`onLafposDaySaved`) |
| `src/server/data/cash-reports.ts` | `tillRows`: raporsuz LafPOS gününün ay satırı (`lafposTillRows`) |
| `tests/lafpos.test.ts`, `tests/lafpos-db.test.ts` | İmza, gövde, ürün sırası, form ve kasa eşlemesi, geçiş günü, kartın özeti, altın gövde (`tests/fixtures/lafpos-gun.golden.json`); veritabanında yazım, idempotent değişim, Z çakışması (409), ağız ve uçlar |
| `tests/lafpos-satis.test.ts`, `tests/lafpos-satis-db.test.ts` | Her gün tek kaynak (özellik testi), birleştirme, model (tüketim, karaoke KDV'si), Satışlar'ın bandı, yükleme kuralı; veritabanında geçiş günü boşken bayt bayt aynılık, geçiş ve LafPOS ayları, kapsam, yükleme reddi ve kırpma, sonradan bağlama, silme engeli, satış tahmini |
| `tests/lafpos-kasa.test.ts`, `tests/lafpos-kasa-db.test.ts` | Kasa raporunun LafPOS'la uzlaşması (B09): farklı yazılanlar ve metinler, gün içinde çıkan, kapalı gün kanıtı, e-posta anahtarı, ay satırı, geç rapor ve fotoğraf kanıtı, kart; veritabanında geçiş günü boşken bugünkü gibi, kapalı işaretin kalkması, e-posta, geç rapor ve kartı |
| `tests/lafpos-komisyon.test.ts`, `tests/lafpos-ikram.test.ts`, `tests/lafpos-komisyon-ikram-db.test.ts` | Ödeme kanalları komisyona (B10, E-37) ve ikram tüketime (E-38): geçiş günü boşken bugünkü gibi, LafPOS ayı, geçiş ayı, kanalsız ödeme, eksik gün; ikramın kayıtlı tüketime bir kez girmesi, panel ürün ikramının sayılmaması ve reddi, kasa özeti ve e-postası |
| `tests/lafpos-durum-db.test.ts` | Kendi geçici veritabanında: durum satırı (200 / 400 / 409 / 401 / 413 / 500 / 503), güne göre açık retler (sonraki 200 ve başka günün 400 / 500'ü örtmez, aynı günün 200'ü kapatır), `counted`, günün silinmesi (yalnız çözdüğü 409'u kapatır), geçiş günü, Kasa okuyucusunun kapısı, eylemlerin parolası ve işlem geçmişi |

# LafPOS bağlantısı (kafenin kasası)

Uçlar: `POST /api/pos/gun` (gün sonu) ve `GET /api/panel/pos/urunler` (ürün maliyetleri). Ekran: **Kasa raporu**
(`/panel/kasa`) › **LafPOS'tan doldur**. Sözleşmenin asıl hâli LafPOS deposunda (`RiosenBeq/lafpos`)
`docs/03-ENTEGRASYON.md` §3, §4 ve §4.1; bu belge panelin tarafıdır.

## Neden

LafPOS, ModPOS'un yerine geçen kafe kasasıdır. Kafenin içindeki bir makinede çalışır ve internetten erişilemez; bu
yüzden panelin öteki bağlantılarındaki "imzalı ping, sonra imzalı çekme" burada yoktur. LafPOS her iş gününü
kapanışta bir kez **iter**; gün sonradan düzeltilirse aynı günü yeniden gönderir (aynı gün öncekinin yerine geçer).
İnternet yoksa gönderim LafPOS'un giden kutusunda bekler, sonra gider.

- Günün ürün satışı panelin günlük satış ağzını doldurur (`loadDailyProductSales`; ModPOS'un günlük dökümü hiç
  gelmedi, yerini bu aldı).
- Günün Z özeti Kasa raporunda tek dokunuşla forma yazılır; personel yine bakıp gönderir, ModPOS'un Z'sini elle
  yazmaz.
- Panel LafPOS'a ürünlerin reçete maliyetini verir (patronun kârlılık ekranı için; personel görmez).

## Nasıl çalışır

```
LafPOS (kafede)                                  ladmin.laffogato.net (bu panel)
───────────────                                  ──────────────────────────────
gün sonu (ve düzeltme)
  └─ giden kutusu: POST /api/pos/gun  ────────▶  anahtar → boyut → imza → gövde
     {version, source, date, z, lines,             └─ tek işlem, günün danışma kilidi:
      ikram, payments} (imzalı)                        ├─ pos_day_reports: günün özeti (yenisi eskisinin yerine)
                                                       └─ pos_daily_sales: günün satırları silinir, yenisi yazılır
     ◀── 200 {ok, date, lines} · 400 {error, field} · 401 · 413 · 503

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
| `z` | `zNo`, `receipts`, `zTotal`, `cash`, `card`, `mealCard`, `online`, `other`, `offRevenue`, `discounts`, `openingCash`, `cashOut`, `countedCash` (sayılmadıysa `null`), `handedOver`, `cashDiff` (`null` olabilir) |
| `lines[]` | `posName`, `siteMenuId` (`null` olabilir), `slot` (`"M"`, `"L"` ya da `null`), `qty`, `revenue`, `isService`; bir POS adı günde bir kez |
| `ikram[]` | `posName`, `siteMenuId`, `slot`, `qty`, `menuValue`, `reason` (en çok 200 karakteri saklanır) |
| `payments[]` | `name`, `zField` (`cash`, `card`, `meal_card`, `online`, `other`), `channel` (komisyon anahtarı: `pluxee`, `multinet`, `edenred`, `setcard`, `metropol`, `yemeksepeti`…; `null` olabilir), `count`, `amount` |

- **Beyaz liste.** Yalnız tablodaki alanlar okunur ve saklanır; bilinmeyen alan atılır (müşteri ya da personel adı
  gelse de yazılmaz). Her alan yazılmalıdır; boş olabilenler `null` gelir.
- **Denetim sırası:** anahtar yoksa `503 {"error":"not_configured"}`; gövde 256 KB'tan büyükse
  `413 {"error":"too_large"}`; imza yok, yanlış ya da 5 dakikadan eski / ileriyse `401 {"error":"unauthorized"}`
  (ayrıntı verilmez); gövde sözleşmeye uymazsa `400 {"error":"invalid","field":"lines.3.qty"}` (ilk sorunlu alanın
  yolu; gövde okunamazsa `body`). Yazılınca `200 {"ok":true,"date":"2026-10-26","lines":42}`. Veritabanı yazamazsa
  `500 {"error":"server_error"}` (LafPOS yeniden dener). Reddedilen istek hiçbir şey yazmaz.
- **Aynı gün yeniden gelince** (düzeltme ya da yeniden deneme) tek işlemde günün özeti yenisiyle değişir, satırları
  silinip yenisi yazılır; öteki günlere dokunulmaz. Aynı anda iki gönderim günün danışma kilidinde
  (`pg_advisory_xact_lock(hashtext('lafpos-gun:<gün>'))`) sırayla yazılır, biri bütünüyle kalır.
- **Ürün** satır satır bulunur (`src/lib/lafpos/day.ts` › `resolvePosLine`): LafPOS'un hizmet satırı (karaoke) ürüne
  bağlanmaz; sonra sitenin kalemi ve boyu (`products.site_menu_id` + `site_menu_slot`, [SITE-MENU.md](SITE-MENU.md));
  bulunmazsa POS adı eşleştirmesi (`pos_mappings`, `posMatchKey`: büyük / küçük harf ve I / İ farkı yok; ModPOS'tan
  öğrenilmiş eşleştirmeler ve HİZMET işareti çalışmaya devam eder). Hiçbiri yoksa satır ürünsüz kalır. Eşleştirme
  yazım anında uygulanır: Satışlar'da sonradan eklenen eşleştirme, o gün yeniden gönderilince geçerli olur.
- **Saklanan:** `pos_daily_sales` (gün, POS adı, ürün, adet, ciro, hizmet; `(date, pos_name)` benzersiz) ve
  `pos_day_reports` (gün başına bir satır: `z`, `payments`, `ikram`, `source`, `received_at`). Migration
  `drizzle/0040_lafpos_baglantisi.sql`: yalnız iki yeni tablo, var olan tabloya dokunmaz (Instant Rollback'e uygun).

### Günlük satış ağzı

`loadDailyProductSales(from, to)` (`src/server/data/daily-sales.ts`) aralıkta `pos_daily_sales` satırı varsa
`DailyProductSale[]` (güne ve POS adına göre) döner, yoksa `null`. Okuyanlar (mal siparişinin kullanımı, satış
tahmininin günlük toplamları ve tatlı payı) bugün olduğu gibi aylık veriye düşer; günlük veriye geçmek her okuyanın kendi
işidir (plan: son 28 günün en az 14'ünde satır varsa, [planlar/siparis.md](planlar/siparis.md)). Ağız dolu dönünce
okuyanlar günlüğe bir uyarı yazar.

### Kasa raporu: LafPOS'tan doldur

Raporun günü için `pos_day_reports` satırı varsa formun başında mavi bant çıkar: "LafPOS gün sonu · Z 128 · 26 Ekim
03:12" ve **LafPOS'tan doldur**. Dokununca:

- ModPOS Z bölümünün alanları (Z no, fiş sayısı, toplam satış, nakit, kart, yemek kartı, online, diğer, ödenmez /
  ikram, indirim) ve kasa alanları (açılış, gün içinde çıkan, sayılan nakit, teslim edilen) fotoğraf okumasıyla aynı
  kuralla dolar (`CashPrefill { source: "lafpos" }`, `src/lib/lafpos/prefill.ts`): yalnız **boş** alanlar, yanında
  mavi **LafPOS'tan**.
- Yazılmış alan değişmez (açılış önceki devirden, gün içinde çıkan fişlerden kendiliğinden dolar). LafPOS'taki
  farklıysa altında "LafPOS'ta 1.500 ₺" ve **LafPOS'takini yaz** çıkar.
- Gün sayılmadan kapandıysa sayılan nakit boş kalır ve turuncudur: "LafPOS'ta gün sonu sayımı yok; çekmeceyi sayıp
  yazın."
- Bant sonucu söyler: "LafPOS'tan 14 alan dolduruldu. Kontrol edip gönderin." ya da "… 1 alan yazdığınızdan farklı,
  turuncu olanlara bakın."
- **Hiçbir şey kendiliğinden kaydedilmez:** personel bakıp **Raporu gönder**'e basar. Kasa farkını form kendisi
  hesaplar (LafPOS'un `cashDiff`'i kullanılmaz); Banka POS LafPOS'tan gelmez.
- Personele yalnız Z ve geliş anı gider (`src/server/data/lafpos-day.ts`, sabit sütunlar); ödeme kanalları ve
  ikramlar okunmaz. Özet okunamazsa bant görünmez, form her zamanki gibi elle doldurulur.

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

## Kurulum

1. Bir anahtar üretin: `openssl rand -base64 48` (en az 32 karakter). Sitenin `KARAOKE_SYNC_SECRET`'ından **ayrı**
   olsun: kafedeki makinede sitenin anahtarı durmaz, ikisi ayrı döndürülür.
2. Vercel'de bu projeye (yalnız Production) `LAFPOS_SYNC_SECRET`; LafPOS'un `.env`'ine aynı değerle
   `LAFMALIYET_SYNC_SECRET` ve `LAFMALIYET_URL=https://ladmin.laffogato.net`.
3. Panel yayınlanınca migration (`0040_lafpos_baglantisi`) build öncesinde kendiliğinden uygulanır.
4. LafPOS'ta bir günü kapatın: giden kutusu gönderir; Kasa raporunda o günün formunda bant görünür.

Anahtar yokken iki uç `503` döner; panelin geri kalanı ve Kasa raporu eskisi gibi çalışır.

## Güvenlik ve KVKK

- İmza laffogato.net bağlantısınınkiyle aynı kural ve aynı kod (`src/lib/karaoke/signature.ts`): `x-laf-timestamp`
  (unix saniye), `x-laf-signature: v1=<hex>`, HMAC-SHA256(zaman, yöntem, yol, sıralı sorgu, gövdenin SHA-256'sı),
  ±5 dakika, sabit süreli karşılaştırma. Yol imzanın içindedir: bir ucun imzası öteki uçta geçmez. İki ucun vektörleri
  `tests/lafpos.test.ts`'te sabit; LafPOS'un `server/lib/signature.ts`'i aynılarını verir.
- Gövdede kişisel veri yoktur (müşteri, personel adı, telefon). İkram nedeni serbest metindir ve yalnız yöneticinin
  verisinde kalır; personele giden Kasa bandı yalnız Z'yi taşır.
- Maliyet ucu yalnız imzayla açılır; personel maliyet ve kâr görmez.
- Yedeğe iki tablo kendiliğinden girer (gizli sütun yok). `db:reset` ürünleri baştan yüklediği için günlük satırlar da
  silinir (ürün kimliklerine bağlı); gün sonu özetleri kalır.

## Sorun giderme

| Yanıt | Ne yapılır |
|-------|------------|
| `503 not_configured` | Panelde `LAFPOS_SYNC_SECRET` yok ya da 32 karakterden kısa: ekleyip yeniden yayınlayın |
| `401 unauthorized` | İki taraftaki anahtar aynı mı (LafPOS'ta `LAFMALIYET_SYNC_SECRET`), kafedeki makinenin saati doğru mu (±5 dakika)? |
| `413 too_large` | Gövde 256 KB'ı aştı; LafPOS'un gönderdiğine bakın |
| `400 invalid` + `field` | Gövde sözleşmeye uymuyor; `field` ilk sorunlu alanın yolu (`date`: ileri ya da bozuk gün, `lines.5.posName`: aynı ad iki kez). LafPOS düzeltip yeniden gönderir |
| `500 server_error` | Panel yazamadı (veritabanı); LafPOS yeniden dener. Sürüyorsa Vercel günlüğünde `[lafpos]` |
| Kasa raporunda bant yok | O günün gönderimi gelmedi (LafPOS'un giden kutusu) ya da gün başka (05:00 kuralı) |

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/lafpos/day.ts` | Gövdenin şeması (beyaz liste), okunması ve hata alanı, ürünün bulunma sırası (saf) |
| `src/lib/lafpos/request.ts` | Anahtar ve imzalı isteğin denetimi (saf) |
| `src/lib/lafpos/prefill.ts` | Z → Kasa formunun alanları (`CashPrefill`), bandın metni (saf) |
| `src/lib/lafpos/costs.ts` | Maliyet listesinin beyaz listesi (saf) |
| `src/server/lafpos/ingest.ts` | Gün sonunun denetimi ve tek işlemde yazımı |
| `src/server/lafpos/products.ts` | Maliyet ucunun çekirdeği (maliyet modeli) |
| `src/server/data/daily-sales.ts` | `loadDailyProductSales` |
| `src/server/data/lafpos-day.ts` | Kasa raporunun okuyucusu (yalnız Z) |
| `src/app/api/pos/gun/route.ts`, `src/app/api/panel/pos/urunler/route.ts` | Uçlar |
| `src/app/panel/kasa/cash-form.tsx`, `page.tsx` | "LafPOS'tan doldur" bandı |
| `tests/lafpos.test.ts`, `tests/lafpos-db.test.ts` | İmza, gövde, ürün sırası, form; veritabanında yazım, idempotent değişim, ağız ve uçlar |

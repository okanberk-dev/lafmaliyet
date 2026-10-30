# ModPOS API: açılıştan bugüne satış verisi

Grup: **modpos** · Dallar: `claude/modpos-api-faz1` (Faz 1), `claude/modpos-api-faz2` (Faz 2) · Taban: `origin/main` @
1947c7c ("Dalga 12: Vergi bölümü (#68)"). Durum: plan; uygulanmadı. **Revizyon 2 (29 Eki 2026):** eleştiri R1–R20
koda bakılarak işlendi; kararlar Ek A'da. Bir migration (Faz 1, adı `modpos_api`: `npm run db:generate -- --name
modpos_api`; numarası birleştirmede, büyük olasılıkla `0046`, son migration `drizzle/0045_vergi.sql`). **Yeni bağımlılık
yok, yeni cron yok** (sabah işine bir adım, Faz 3, M22).

**Şimdi yapılacak: Faz 1** (§6): dört tablo + gün toplamı yolunun saklaması + saf birleştirme / öncelik çekirdeği +
sahte veri betiği + salt okunur Ayarlar kartı + testler. Hiçbir okuyucu yeni tablolara bakmaz: panelin hiçbir rakamı
değişmez. Boyut ≈ 1.400–1.700 satır. Faz 2 (tüketiciler, başlangıç ayı) şimdi yapılabilir ama ilk gerçek veriye kadar
görünür bir şey vermez; Faz 3 API belgesini bekler.

Kaynak notlar (aynı klasörde): `harita-veri.md` (satış tabloları ve öncelikler), `harita-tuketici.md` (okuyan
ekranlar), `harita-altyapi.md` (LafPOS, Paraşüt, site desenleri, Hobby sınırları), `arastirma-modpos.md` (ModPOS kim,
API var mı, sorular). `dosya:satır` aksi yazılmadıkça `origin/main` @ 1947c7c'dir.

Uygulamadan önce okunacaklar:
- `AGENTS.md` (Next.js 16 farklı);
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` (Faz 3: Ayarlar açılınca arka planda çekme);
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
  (bugün `src/app/panel/ayarlar/page.tsx`'te `maxDuration` yok; Paraşüt sayfasında var: `src/app/panel/parasut/page.tsx:21`);
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`, `01-directives/use-server.md`;
- `docs/LAFPOS.md` › Günlük satış (`:116`), Kart: kartla bahşiş ve cari tahsilatı (`:248-258`), Geçiş günü (`:359`),
  Durum ve onarım (`:415`), Açılış sırası (`:474`);
- `docs/PARASUT.md` (imleç, sürdürme), `docs/SITE-SATIS.md` › Saklama (`:196`), `docs/KASA-RAPORU.md` › Ay bilgisine
  aktarım, `docs/KOMISYON.md`, `docs/YEDEK.md`, `docs/DEPLOY.md` (ortam değişkenleri `:80-92`).

Mevcut kalıplar (kopyalanmaz, genelleştirilir ya da yanına yazılır):
- LafPOS gün yazımı: tek işlem + gün danışma kilidi + satırları sil / yaz (`src/server/lafpos/ingest.ts:45-97`); kilit
  bekleme sınırı `set local lock_timeout` + `55P03` (`src/server/site-menu/sold-out-core.ts:117-125`);
- "Her gün tek kaynak" ve geçiş günü (`src/lib/lafpos/switch.ts:31-86`, `src/lib/lafpos/sales.ts:84-112`,
  `src/server/data/lafpos-sales.ts:88-115`); yedek ay satırı (`src/server/data/cash-reports.ts:265-304`,
  `src/lib/cash-month.ts:17-32`, `:59-61`);
- POS adı eşlemesi ve LafPOS kartının **Bağla**'sı (`src/server/actions/sales.ts:211-253`, `:371` `matchLafposName`;
  `src/lib/calc/pos-paste.ts:241-273` `posMatchKey`, `createPosMappingIndex`);
- Paraşüt istemcisi (Faz 3): tempo, `Retry-After`, son an (`src/server/parasut/client.ts:30-34`, `:101-112`, `:196-238`);
  karaoke geçmişi "Geçmişi al / Devam et" (`src/server/karaoke/history.ts:147-223`);
- Sabah işi ve bütçesi (`src/app/api/cron/gunluk/route.ts:49-171`, `src/server/jobs/capped.ts:8-29`), adım kayıtları
  (`src/lib/job-health.ts:143-250`);
- Ayarlar bölüm kartı (`src/app/panel/ayarlar/sections.ts:8-28`, site bağlantıları kartı
  `src/app/panel/ayarlar/page.tsx:263-342`).

---

## 0. Amaç

Sahibin isteği (29 Ekim 2026): *"sonrasında modpos api gelecek orda cafe açılışından beri satılan ürünler para vs.
yazacak ona göre bir kurgu yapman gerekiyorsa öyle yap site genelinde"*.

ModPOS'un (kafenin bugünkü kasası) API'si gelince panel, kafe açıldığından beri **her iş gününün** ürün satışlarını,
ödemelerini ve gün toplamlarını kendisi çeksin; bugün elle beslenen üç kanalın (Satışlar'a aylık ürün listesi
`src/server/actions/sales.ts:146-203`, ay bilgisi `src/server/db/schema.ts:241-256`, kasa raporundaki ModPOS Z'si;
`harita-veri.md` §0) yerini, sahibin seçtiği aydan itibaren alsın. API henüz yok, biçimi bilinmiyor
(`arastirma-modpos.md` §3): plan **kaynaktan bağımsız** bir gün kaydı ve tek bir birleştirme çekirdeği kurar, ModPOS'a
özgü her şey (uçlar, fiş → gün toplama, hız sınırları) Faz 3'te tek adaptörde kalır.

Ne iyileşir (ayrıntı §5): her ayın ürün karması (bugün yalnız Eylül'ün listesi var, `harita-veri.md` §12), süren
ayda da ürün satışı, Ağustos'un yuvarlak 500.000'i gibi elle tahminlerin gerçek rakamla karşılaştırılması, kasa raporu
girilmemiş günlerin rakamı, satış tahmini ve nakit planı için açılıştan beri tam seri, kanal kanal komisyon.

Yapılmayanlar:
- ModPOS'a **yazılmaz** (fiyat, ürün, stok). "Kasaya işle" elle kalır (`docs/FIYATLAR.md:110-127`).
- **Fiş (adisyon) saklanmaz**; fiş adaptörün içinde güne toplanır (M2). Müşteri, kasiyer, garson adı, telefon, adres,
  kart son hanesi hiç yazılmaz (`docs/LAFPOS.md:73-75` kuralı).
- Yazarkasa (ÖKC) mali Z'si, banka gün sonu, sayılan nakit ve teslim **API'den gelmez**, elle kalır
  (`docs/YAZARKASA-Z.md:24-27`).
- Vergi gelirinin kaynağı değişmez: ModPOS (API'si dahil) **yönetim verisidir** (`src/lib/tax/pnl.ts:223-231`, K11).
- LafPOS'un tabloları ve ucu değişmez (`src/server/db/schema.ts:2031-2073`, `src/app/api/pos/gun/route.ts`).
- Bugünün (kapanmamış günün) canlı satışı gösterilmez; yalnız kapanmış günler (M5).
- Gerçek ModPOS adaptörü, fiş → gün toplama, saat dağılımı ve sabah adımı API belgesi gelmeden **yazılmaz** (Faz 3).

---

## 1. Kararlar (kodu ve haritaları okuyup verildi; uygulayan yeniden karar vermez; "Soru" diye işaretliler §8'de)

| # | Konu | Karar | Neden |
|---|---|---|---|
| M1 | Yön | **Panel çeker** (ModPOS bulutu → panel). Webhook varsa sonradan ping + `after()` (§11) | ModPOS bulut (Integra, `arastirma-modpos.md` §1); LafPOS gibi itmez; Paraşüt çekme deseni en yakını |
| M2 | Kayıt | Kaynaktan bağımsız **gün toplamı**: gün özeti + ürün satırları + ödeme türleri. Fiş veren API'de fişler Faz 3'te adaptörün içinde `foldReceipts` (saf) ile güne toplanır; depo ve birleştirme yalnız günü bilir | Bütün tüketiciler gün ya da ay ister (`harita-tuketici.md` §1); fiş düzeyi yılda ≈ 400 bin satır olurdu |
| M3 | Para | Saklamada **kuruş tam sayı** (`integer`; `net_kurus` işaretli, öbürleri ≥ 0). Adet `double precision` (`schema.ts:266`, `:2045`). Modelin sınırında TL'ye tek fonksiyon `kurusToTl` | Site ve karaoke zaten kuruş (`src/lib/site-sales/schema.ts:22-33`) |
| M4 | KDV (R14) | Satır oranı API ne verdiyse (`vat_rate_pct`), yoksa `null`; **dondurma yok**. Soru 4'ün yanıtı "ürünün bugünkü oranı" ise adaptör `vatPerLine: false` der ve oran hiç okunmaz. Aynı satırın oranı yeniden çekmede değişirse gün sorunu yazılır (API bugünkü oranı veriyor demektir) | İlk geçmiş doldurma zaten ilk çekmedir: dondurma geçmişi korumaz; doğrusu soruyu baştan yanıtlatmak |
| M5 | İş günü (R2) | Fişin günü: ModPOS fişin gün sonu (Z) gününü veriyorsa o; yoksa kapanış anından `businessDate` (05:00, `src/lib/cash-report.ts:145`, `:164-167`). `fetchDay(D)`'nin penceresi **[D 05:00, D+1 07:00) TR**: hem Z günü D olan fişler (06:00–06:00, lafpos `docs/01-ANALIZ.md:9`) hem 05:00 kuralıyla D'ye düşenler bu pencerededir; bu yüzden pencereye giren ama başka güne ait fiş atılabilir (kendi gününün penceresinde zaten vardır). `closedAt` ofsetsiz gelirse reddedilir (`/(Z\|[+-]\d{2}:\d{2})$/`). Gün **D+1 07:00 TR'den sonra** tam sayılır ve çekilir. UTC dilimleme yasak | 05:00 penceresi 05:00–06:00 arasındaki Z günü D fişini iki günden de düşürürdü; UTC Vercel'de ofsetsiz zaman yanlış güne düşer |
| M6 | Saklama (R20) | **Dört yeni tablo** `pos_api_days`, `pos_api_day_lines`, `pos_api_day_payments`, `pos_api_payment_maps` (§2.3), `source` sütunlu (`'modpos'`). `pos_daily_sales` / `pos_day_reports` kullanılmaz. Kod `src/lib/pos-api/*`, `src/server/pos-api/*`. Gün durumu `satisli` \| `satissiz` | Oradaki tekillik `(date, pos_name)` iki kaynağı tutamaz (`schema.ts:2055`), LafPOS'un 409 kuralı ModPOS'a uymaz; `Till*` adları (`src/lib/cash-month.ts:17`, `:54`) ve `kapali` (özel günler) başka şey demek |
| M7 | İdempotency (R13, R16) | Gün anahtarı `(source, day)`; gün **tek işlemde**: `set local lock_timeout = '5s'` + `pg_advisory_xact_lock(hashtext('pos-api-day:<source>:<day>'))`; `55P03` → o gün `busy` (hata değil, sonraki gün). Özet upsert, satır ve ödemeleri sil / yaz. **Parmak izi** (sha256, sıradan bağımsız) aynıysa yalnız `checked_at`. Satır anahtarı `line_ref` = `ürün kimliği ?? "ad:"+posMatchKey(ad)` + varyant + tür + birim fiyat. Değişen günde `revision` + 1, önceki özet `previous` sütununa (yalnız sonuncusu), değişiklik işlem geçmişine | LafPOS'un "günü yenile" kuralı (`ingest.ts:45-97`); `capped` işi beklemeden döner (`src/server/jobs/capped.ts:14-18`), askıya alınan işlev kilidi tutarsa sonraki yazan sonsuza dek beklemesin |
| M8 | Satır türleri (R3) | `satis`, `iade`, `ikram`, `odenmez`, `zayi`. **Aylık ürün satırı = yalnız `satis`** (adet ve ciro). `iade` kendi gününde bir olaydır: yalnız o günün `refund` ve `net`'ine girer, ürün adedinden düşmez (yapılmış içecek tüketimdir) ve satış gününü değiştirmez; böylece eksi adet olamaz (`src/lib/calc/engine.ts:890-918` eksi adedi ters tüketime çevirirdi). Liste ↔ POS farkı = indirim + iade (metin bunu söyler). `ikram` / `odenmez` ciroya girmez; tüketime yalnız Faz 4'te ve `ikramLines` varsa. `zayi` saklanır, hiçbir hesaba girmez (`docs/ZAYI-IKRAM.md:13`) | Durumu sonradan "iade"ye dönen fiş satış gününü (kapanmış ayı) yeniden yazar ve brüt 0 / iade X ile net'i eksiye düşürürdü |
| M9 | Gün denetimi (R8) | Ödeme türünün **sınıfı** (`pay_class`): `satis` \| `bahsis` \| `tahsilat` \| `cari` (açık hesaba satış). Değişmezler: Σ ödeme (`satis` + `cari` sınıfı) = `net` ± tol; Σ `satis` brüt − Σ `iade` brüt − `discount` = `net` ± tol; `net` ≥ 0; tol = max(100 kuruş, net'in %0,5'i). Servis ve kuver ürün satırıdır (HİZMET'e eşlenir). Tutmayan gün **yazılır** ve kartta "sorunlu gün" olur; yönetici **Kabul et (not)** der: kabul gün düzeyinde, günün parmak iziyle saklanır (`accepted`: kim, ne zaman, not, parmak izi; işlem geçmişine); gün değişmeden yeniden yazılırsa kabul kalır, değişirse düşer. Kuruş olmayan sayı, eksi brüt, boş ad **reddedilir** | Kartla bahşiş ve cari tahsilatı POS'tan geçer ama satış değildir (`src/lib/lafpos/day.ts:68-73`, `docs/LAFPOS.md:248-258`); sabit 1 TL toleransla her gün "tutarsız" olur ve başlangıç ayı hiç kaydedilemezdi |
| M10 | Anahtar (varsayılan kapalı) | **(a)** ortam değişkeni yok → "Kurulmadı", hiçbir istek yok; **(b)** değişkenler var → veri çekilir ve saklanır ama **deneme**: yalnız Ayarlar › ModPOS kartında, hiçbir hesaba girmez; **(c)** `settings.modposApiBaslangic` (YYYY-MM) dolu → o aydan itibaren hesaplara girer (Faz 2). Varsayılan `null` (`src/lib/constants.ts:3-30`); bozuk değer `null` (`readModposApiStart`) | LafPOS'un deseni (`src/lib/lafpos/switch.ts:4-11`): ayar veri yazmaz / silmez, yalnız okuyanları değiştirir |
| M11 | Başlangıç ay düzeyinde (R9, R14) | Ayar **ay**. Kaydetme koşulları (`modposStartProblem`, saf): ay ≥ `2026-07`; **A-01'den dünün tam gününe kadar her gün** `pos_api_days`'te (satışsız gün de kapsamdır; "çekmenin başından" istisnası yok); o aralıkta eşlenmemiş ödeme türü ve **kabul edilmemiş** sorunlu gün yok. Önizleme (engel değil, uyarı): ay ay eski → yeni (POS cirosu, ürün adedi, hizmet cirosu, liste ↔ POS farkı), eşleşmeyen adların ciro payı, HİZMET olabilecek eşleşmeyen adlar (`/karaoke\|etkinlik/i`). İşlem geçmişine yazılır. Boşaltmak geri alır | Ayın ilk günleri ne listede ne API'de olursa ay eksik sayılırken kapsam tam görünürdü; eşleşmeyen ad bugün de liste yolunda var, kapı ondan sıkı olmamalı |
| M12 | Gün gün kaynak (R19) | Tablo §3.1. Ürün satırları: **LafPOS günü** (S'den) > **API günü** (A'dan) > **elle liste** (ay). Ay bilgisi: **elle `months`** > **kasa raporu** > LafPOS Z yedeği > **API yedeği**. Raporlu günde rapor satırı kazanır, ama raporun **boş** `discounts` / `offRevenue` alanı API'nin o günkü değeriyle dolar (kaynak gösterilir). Komisyon kanal satışı: elle > lafpos > **modpos** > tek | Bugünkü sıralar (`src/lib/cash-month.ts:136-164`, `docs/KOMISYON.md:87-108`); boş indirim alanı aya hiç girmez (`cash-month.ts:90-91`, `:105-107`), kâr şişerdi (`src/lib/calc/insights.ts:634`) |
| M13 | Elle düzeltmeler korunur (R6) | `months`'a elle yazılan değer (0 dahil) **her zaman kazanır** (`cash-month.ts:140-152`). Karşılaştırma tablosunda ve başlangıç önizlemesinde ay başına **"Bu ayı ModPOS'a bırak"**: `openDays` + `posRevenue` + `discounts` + `offRevenue` + `cardShare` birlikte boşalır (not kalır), tek işlem, işlem geçmişine. Elle 0 yazılmış ama API'de sıfırdan büyük alan vurgulanır; aynı ayda açık gün elle, ciro API'den (ya da tersi) karışık çifti uyarı alır. Alan alan boşaltma yine mümkün ama önerilmez | Tohum Temmuz / Ağustos / Ekim'i indirim ve ödenmez 0 ile elle yazdı (`scripts/seed.ts:275-277`, `src/server/db/seed/excel-data.json` months; Ekim "1-16 Ekim (16 gün)"); tek alanı boşaltmak günlük ortalamayı ikiye katlar (`insights.ts:708`) |
| M14 | Kapanmış aylar | Geçmişin değişmesi tek onaylı noktada: başlangıç ayının kaydı. Sonradan ModPOS geçmiş bir günü düzeltirse gün yeniden yazılır (`revision`, `previous`), işlem geçmişinde "Sistem · ModPOS: 14 Eylül değişti (12.400 → 11.900 ₺)"; **engellenmez**. M8 sayesinde sonraki aydaki iade önceki ayı değiştirmez | Panelde kapanmış ay kilidi yok; gerçek düzeltmeyi gizlemek yanlış |
| M15 | Eksik gün ve ay ortası (R4) | `tillMonths` iki ayrı girdi alır: **`firstReport`** (eksik "rapor yok" günleri buradan aranır; öncesindeki API günleri "ModPOS'tan" yazılır, eksik değildir) ve bugünkü `firstEver` (ay ortası başlangıç `partialFrom`, bütün kaynakların en eski satırı). API satırları A-01'den satışsız günleriyle geldiği (M11) için API ayı hiç "ay ortası" olmaz. Kasa'nın ay satırı da aynı yükleyiciden ve aynı iki girdiyle | Bugün tek `first` ikisini birden belirler (`cash-month.ts:62`, `:76`, `:114`) ve veri kümesi ile Kasa farklı `first` verir (`src/server/data/dataset.ts:232-235`; `src/app/panel/kasa/page.tsx:406`, `:436`) |
| M16 | Kasa raporu | (Faz 4) API'nin günü kapanmışsa form yalnız boş alanları API Z'sinden doldurur (`CashPrefill.source: "modpos"`, `src/lib/photo-read/kasa.ts:153-159`); farklar `src/lib/lafpos/diffs.ts` deseniyle; API günü gelmişse ModPOS Z fotoğrafı istenmez. Personele yalnız Z alanları; beklenen nakit API'den alınmaz | LafPOS günlerinin aynısı (`src/lib/lafpos/prefill.ts:77`) |
| M17 | LafPOS | Geçiş gününden (S) itibaren **LafPOS kazanır**; API'nin o günleri saklanır, sayılmaz. Geçiş ayında API kapsamı `min(son API günü, S − 1)` | Her gün tek kaynak (`src/lib/lafpos/sales.ts:9-20`) |
| M18 | laffogato.net | **Değişmez.** Kasada ödenen site siparişi ModPOS'ta çalınır; site zaten kendi toplamından düşer (`docs/SITE-SATIS.md:84-89`) | Çift sayım yok |
| M19 | Ürün eşleme (R7) | API satırında **ürün saklanmaz**. Ay toplamı okunurken ad (`posMatchKey(ad)`, varyant ayrıysa `ad + " " + varyant`) `pos_mappings`'ten çözülür (`createPosMappingIndex`); ürün kimliği bağı tablosu yok. Satışlar'da ya da kartta bir adın eşlemesi değişince **bütün API günleri, geçmiş dahil, anında** izler. ModPOS'ta adı değişen ürün eşleşmeyenlerde görünür, bir kez **Bağla** (`matchLafposName` deseni, `src/server/actions/sales.ts:371`). `writeMapping` (`sales.ts:240`) `"use server"` dosyasından `src/server/sales/mapping.ts`'e taşınır (ortak yazıcı). Silme engeli API'de bu ürüne çıkan adları sayar (`pos_mappings.product_id` cascade, `schema.ts:281`: silinirse bağ sessizce koparırdı) | Bağlı satırı yeniden bağlamayan bugünkü yol (`src/server/lafpos/rematch.ts:8-13`, `sales.ts:211-233`) ~110 günün yanlış bağını kalıcı yapardı; okurken çözmek düzeltmeyi bedavaya verir, ay başına birkaç yüz ad |
| M20 | Ödeme türleri ve Komisyon (R8) | `pos_api_payment_maps` (`source`, ModPOS ödeme adı → `z_field` cash / card / meal_card / online / other + `channel` + `pay_class` + `confirmed`). Eşleme okurken birleştirilir (gün satırına kopyalanmaz: değişiklik geçmişe anında). Öneri: `channelOf([ad])` (`src/lib/commission/channels.ts`), "NAKİT" → cash, "KREDİ KARTI" / "BANKA" → card, "BAHŞİŞ" → bahsis, "CARİ" / "AÇIK HESAP" → cari; öneri kartta **onaylanır**, onaysız tür `satis`/`other` sayılır ve listede kalır. Komisyon kaynağı yeni değer `modpos` (`src/lib/commission/report.ts:154`) | ModPOS Z'si yemek kartlarını tek toplam verir; kanal kanal ayrım API'nin asıl kazancıdır (`docs/KOMISYON.md:83-85`) |
| M21 | Koşucu | (Faz 3) Tek fonksiyon `runPosApiSync(trigger, { deadlineAt })`. Tek çalışma: `integration_state › modpos.lease` koşullu güncellemeyle alınır, 120 sn'den eskisi bırakılmış sayılır; ikinci çağrı `busy`. Ayrı çalışma tablosu yok: son 10 çalışma `integration_state › modpos.runs`'ta | Askıya alınan işlev oturum kilidini bırakmaz, süreli kira bırakır; tablo yalnız "son 5 çalışma" için gereksiz |
| M22 | Cron (R1, R12) | **Yeni cron yok.** (Faz 3) `/api/cron/gunluk`'ta `modposP` **jobStart'ta**, satış tahmini ve Paraşüt yeniden denemesiyle aynı anda başlar; kendi son anı `jobStart + 45_000`, `capped` ile; `extras()` içinde beklenir (kuyruk 55 sn'de biter, `src/server/jobs/capped.ts:8-12`). Sabah e-postası **beklemez** (e-posta API rakamı okumaz: `src/server/notify/digest.ts` modelin satış ayını ve tahmini okur). Adım `modpos` `OptionalStep` (`src/lib/job-health.ts:203`), sıra listesi (`:244`), `STEP_NAMES` (`:143`), `STEP_LABELS` (`:159`); kurulmamışken yazılmaz. **Deneme modunda (A boş) hata `deneme-hata`** yazılır (`stepFailed` saymaz, `:236`); `error` yalnız A doluyken | 8 sn'lik son an 10 sn'lik gün bütçesinden kısaydı: hiçbir gün çekilmezdi; kuyruk adımları zaten paraleldir (`route.ts:128-140`); deneme hatası zil ve e-postaya "Sabah işinde bir adım hata verdi" düşürürdü (`job-health.ts:127`, `:383`) |
| M23 | Geçmiş doldurma (R9) | Parça = **bir iş günü**. Başlangıç: `MODPOS_SYNC_FROM` (varsa) yoksa `2026-07-01`; adaptörün `firstDay()`'i yok (tahmin değil, veri). Satışsız gün `satissiz` olarak yazılır; ilk satışlı gün kartta "İlk satış günü". Yapılacak günler **tablodan** çıkar. Tetikler (Faz 3): Ayarlar › ModPOS **"Geçmişi al / Devam et"** (tur 45 sn, istemci `remaining` bitene ya da 12 tura kadar), sabah adımının kalan süresi, Ayarlar açılışı | Karaoke geçmişi deseni; ≈ 120 gün, gün başına 1–4 istek |
| M24 | Artımlı (R1) | Her çalışma: **dün + önceki 2 gün**; adaptör `changedDays(since)` veriyorsa onunla değişenler, yoksa son 62 günden `checked_at`'i en eski **3** gün (≈ 20 günde bir tur). Kalan süre geçmişe | 7 + 3 günlük geriye bakış bir otomatik bütçeye sığmazdı |
| M25 | Hız, hata | (Faz 3) İstekler arası en az `MIN_GAP_MS` (varsayılan 1.000); 429'da `Retry-After`, yoksa 2^deneme sn; en çok 4 deneme; istek başına 15 sn; bitişi son anı aşacak istek başlatılmaz. **Gün bütçesi türetilir:** `DAY_BUDGET_MS = capabilities.requestsPerDay × MIN_GAP_MS + 3_000` (yazım payı). Kimlik hatası çalışmayı durdurur; gün hatası yalnız o günü (en çok 10) | Paraşüt istemcisi; sabit 10 sn ne 1 istekli güne ne 4 istekli güne uyar |
| M26 | Sırlar (R15) | Ortam değişkenleri yalnız Production (`docs/DEPLOY.md:80-92`): `MODPOS_BASE_URL`, kimlik (Faz 3'te belgeye göre), `MODPOS_BRANCH_ID`, isteğe bağlı `MODPOS_SYNC_FROM`. Belirteç `seal(…, "modpos-token")`, `integration_state › modpos.token`, yedek dışı (`EXCLUDED_STATE_KEYS`). **Sahte adaptör ve sahte veri betiği** yalnız `process.env.VERCEL` tanımsız **ve** `isLocal(DATABASE_URL)` iken (`src/server/db/index.ts:23`'teki yardımcı dışa açılır) | Canlı veritabanına bağlı yerel `next dev` sahte günleri canlıya yazardı; önizlemeler zaten canlının veritabanını paylaşıyor |
| M27 | Durum tek yerde (R12, R15) | Tek okuyucu `loadModposStatus()` (`src/server/pos-api/status.ts`). Gösterildiği tek yer Ayarlar › **ModPOS (kasa)** kartı (`#modpos`). Satışlar ve Kasa en çok **bir nötr satır**; Kasa'da yalnız yönetici bölümünde (`src/app/panel/kasa/page.tsx:362`'deki personel dönüşünden sonra). Zil ve Genel bakış yalnız **sayılırken** (M10 c) bağlantı koparsa (son başarı 36 saatten eski ya da kimlik hatası) | UX analizi: kurulum ve bağlantı durumu tek yerde |
| M28 | Yetki | Kart, eylemler, tablolar **yalnız yönetici** (`requireAdmin`). Personele hiçbir ürün cirosu, ödeme kanalı, API satırı gitmez; Faz 4'te yalnız kasa formunun Z alanları. `scripts/personel-sizinti.ts` her fazda koşulur (`/panel/kasa` zaten listede, `:31-33`) | `docs/planlar/personel-yetki.md:28-32` |
| M29 | Vergi | K11 değişmez; rozet "Yönetim verisi (ModPOS), mali belge değil" kalır (`src/lib/tax/pnl.ts:224-231`) | `docs/VERGI.md:21-36` |
| M30 | Basitleştirme | API'den sayılan ayda: Satışlar'ın içe aktarma kartı salt okunur bantla yer değiştirir, Genel bakış'ın "Satış raporu" ve "Açık gün ve POS cirosu" işleri (`src/app/panel/dashboard-tasks.tsx:266-400`) o ay için düşer, ModPOS Z fotoğrafı istenmez (Faz 4). Kod silinmez; kaldırma sahibin onayıyla Faz 5'te | API henüz yok, elle yol tek güvence |
| M31 | Günlük satış tek yükleyici (R5) | (Faz 2) `loadDailySales(from, to)`: gün başına rapor > LafPOS Z > API `net` (+ kart, yemek kartı, online), A ve S kurallarıyla. Okuyanlar: satış tahmini (`src/server/forecast/load.ts:51-72` bunun üstüne yazılır), nakit planının satış tabanı (`src/server/data/cash-plan.ts:83` → `src/lib/cash-plan.ts:754-765`), haftalık özetin satış satırı (`src/server/weekly/collect.ts:136-137`, `:318`; `src/lib/weekly/items.ts:178-193`). **Bugün raporla kalır** (`src/server/data/today.ts:238`: "rapor girildi mi" işlemsel bilgidir; test sabitler) | Bunlar `cash_reports`'u doğrudan okuyor: API günleri Gelir-gider'de sayılıp nakit planında ve haftalıkta görünmezdi |
| M32 | Etiketler (R17) | (Faz 2) `monthKasa` / `salesMonthKasa` / `periodKasa` / `managementBadge` (`src/lib/lafpos/kasa.ts:40-71`, `src/lib/tax/pnl.ts:224-231`) tek `switchDay` yerine `KasaSources = Pick<Settings, "lafposGecisGunu" \| "modposApiBaslangic">` alır; bütün çağıranlar `st` / `model.settings` geçer (mekanik). API ayında yalnız `report` ve `long` değişir ("ModPOS API"; listeli ayda "Patron (ModPOS)", `kasa.ts:29`); `short`, `both` ve vergi rozeti "ModPOS" kalır (kasa yine ModPOS) | ≈ 15 çağıran (`src/app/panel/page.tsx:209`, `dashboard-breakdowns.ts:359-363`, `tutarlilik/page.tsx:86`, `urunler/page.tsx:68`, `analiz/page.tsx:115`, `engine.ts:2053`, `lib/mcp/answers/month.ts:82`, `:245`, `products.ts:120`, `api/export/workbook.ts:559`, `:603` …) |

---

## 2. Kayıt

### 2.1 Gün toplamı (`src/lib/pos-api/types.ts`, saf; Faz 1)

```ts
export type PosApiSource = "modpos"; // LafPOS sonradan eklenebilir (§11)
export type ApiLineKind = "satis" | "iade" | "ikram" | "odenmez" | "zayi";
export type ApiZField = "cash" | "card" | "meal_card" | "online" | "other";
/** Ödemenin sınıfı (M9): gün cirosuyla yalnız satis + cari karşılaştırılır */
export type ApiPayClass = "satis" | "bahsis" | "tahsilat" | "cari";

/** Adaptörün yetenekleri: belge gelince doldurulur; tüketiciler yeteneği olmayan alanı okumaz */
export interface ApiCapabilities {
  receipts: boolean;       // fiş fiş veriyor (Faz 3, foldReceipts)
  productIds: boolean;
  vatPerLine: boolean;     // satış anındaki oran (Soru 4); bugünkü oransa false
  ikramLines: boolean;
  changedSince: boolean;
  hours: boolean;
  zNo: boolean;
  requestsPerDay: number;  // gün bütçesi bundan (M25)
}

export interface ApiLineIn {
  externalProductId?: string | null;
  name: string;               // kasadaki ad ("LATTE MEDİUM")
  /** Yalnız boy / bardak. Şurup, süt, ekstra shot gibi seçenekler AYRI satırdır (R10) */
  variant?: string | null;
  /** Seçenek satırının ana satırı (bilgi; ay toplamına girmez) */
  parentRef?: string | null;
  category?: string | null;
  kind: ApiLineKind;
  qty: number;                // > 0, en çok 3 ondalık
  unitPriceKurus?: number | null;
  grossKurus: number;         // KDV dahil, indirim öncesi (ikram / ödenmezde menü değeri)
  vatRatePct?: number | null;
}

/** Bir iş günü (Faz 1'de tek biçim; fiş veren adaptör Faz 3'te buna toplar) */
export interface ApiDayIn {
  day: string;
  zNo?: string | null;
  receiptCount: number;
  totals: { grossKurus: number; discountKurus: number; refundKurus: number; offKurus: number; voidKurus: number; netKurus: number };
  lines: ApiLineIn[];
  payments: { name: string; count: number; amountKurus: number }[];
  vat?: { ratePct: number; baseKurus: number; vatKurus: number }[] | null;
  hours?: { hour: number; receipts: number; netKurus: number }[] | null;
}

export interface PosApiAdapter {
  readonly source: PosApiSource;
  readonly capabilities: ApiCapabilities;
  probe(ctx: AdapterCtx): Promise<{ ok: true; branch: string | null; day: string } | { ok: false; error: string }>;
  /** Kapanmış iş gününün tamamı (M5 penceresi) */
  fetchDay(day: string, ctx: AdapterCtx): Promise<ApiDayIn>;
  changedDays?(sinceIso: string, ctx: AdapterCtx): Promise<string[]>;
}
export interface AdapterCtx { deadlineAt: number; signal: AbortSignal }
```

### 2.2 Gün normalleştirme (`normalizeApiDay`, saf; `src/lib/pos-api/day.ts`; Faz 1)

- **Doğrulama** (`src/lib/pos-api/schema.ts`, Zod): brüt / indirim / iade / ödenmez / iptal kuruşu `int ≥ 0`, `net`
  `int` (işaretli); gün tutarı ≤ 100.000.000 kuruş; `qty` sonlu, `> 0`, ≤ 10.000; ad 1–120 karakter (kırpılır, boşluk
  teke); `vatRatePct` `int 0–100` (0, 1, 10, 20 dışı sorun, red değil); `day` takvimde olan gün (`isCalendarDay`).
- Satırlar `line_ref`'e göre, ödemeler ada göre toplanır.
- **Toplamlar** API'nin verdiğidir; hesaplanan brüt / iade ile farkı M9'a göre sorun. `net` = Patron › Ciro anlamı (KDV
  dahil, indirim düşülmüş, ödenmez hariç; `src/lib/calc/types.ts:140`).
- **Sorunlar** (M9): ödeme sınıfı okurken eşlemeden gelir; normalleştirme eşlemeyi bilmez, ödeme tutarını ham yazar.
  Değişmez denetimi `checkApiDay(day, maps)` ayrı saf fonksiyondur (kart ve başlangıç kapısı eşleme değişince yeniden
  hesaplar; saklanan `problems` yalnız biçim ve iç tutarlılık sorunlarıdır).
- **Parmak izi:** satırlar `line_ref`, ödemeler ada göre sıralı kanonik JSON'un sha256'sı.
- **Durum:** satışı olan gün `satisli`; fişsiz `satissiz`.

### 2.3 Fiş → gün (Faz 3 sözleşmesi; `foldReceipts`, saf, gerçek örneklerle yazılır)

Belge gelmeden yazılmaz, ama kurallar şimdiden sabit (testler gerçek maskeli örneklerle Faz 3'te):
- Pencere ve gün ataması M5; `closedAt` ofsetsiz → red; kimliğe göre tekilleştirme (sayfa örtüşmesi; `version`'u büyük
  olan).
- **İade** (M8): iade kendi zamanına (`refundedAt`) göre kendi gününde `iade` satırı ve `refund`; asıl fiş satış
  gününde `satis` satırlarıyla kalır. API yalnız fişin durumunu değiştiriyorsa (iade zamanı yok): iade satış gününde
  sayılır **yalnız** iade aynı gün olduysa; değilse fişin değişikliğini gördüğümüz günün bir sonraki çekmesine (Soru 8)
  yazılır ve işlem geçmişine "geç iade" düşer.
- **Seçenekler** (R10): fiyatlı ya da tüketimi olan seçenek (şurup, süt, ekstra shot) ayrı `satis` satırı (`parentRef`
  ana satır), adı ModPOS'taki seçeneğin adı; site seçenekleriyle aynı eşleme kuralları (`OPTION_PRODUCTS`,
  `src/lib/site-sales/calc.ts:107-118`). `variant` yalnız boy / bardak. Fikstür: "LATTE + Karamel şurup + Yulaf sütü".
- `void` fiş yalnız `voidKurus`'a. Saat dağılımı yalnız `hours` yeteneğiyle.

### 2.4 Tablolar (migration `modpos_api`; Drizzle `src/server/db/schema.ts` sonuna; Faz 1)

| Tablo | Sütunlar | Anahtar / dizin |
|---|---|---|
| `pos_api_days` | `source` text, `day` text (YYYY-MM-DD), `state` text (`satisli` \| `satissiz`), `z_no` text null, `receipts` int, `gross_kurus`, `discount_kurus`, `refund_kurus`, `off_kurus`, `void_kurus` int (≥ 0), `net_kurus` int, `vat` jsonb null, `hours` jsonb null, `problems` jsonb not null default `[]` (biçim ve iç tutarlılık sorunları; ödeme toplamı sorunu okurken eşlemeyle hesaplanır), `accepted` jsonb null (`{by, at, note, fingerprint}`, M9), `fingerprint` text, `revision` int default 1, `previous` jsonb null (önceki özet: toplamlar, ödemeler, satır sayısı), `fetched_at`, `checked_at`, `changed_at` timestamptz | PK `(source, day)`; check `state`, check tutarlar |
| `pos_api_day_lines` | `source`, `day`, `line_ref` text, `external_product_id` text null, `pos_name` text, `variant` text null, `parent_ref` text null, `category` text null, `kind` text, `qty` double, `unit_price_kurus` int null, `gross_kurus` int, `vat_rate_pct` smallint null. **Ürün sütunu yok** (M19) | PK `(source, day, line_ref)`; FK `(source, day)` → `pos_api_days` on delete cascade; dizin `(day)` |
| `pos_api_day_payments` | `source`, `day`, `external_name` text, `count` int, `amount_kurus` int | PK `(source, day, external_name)`; FK cascade. Alan / kanal / sınıf okurken eşlemeden |
| `pos_api_payment_maps` | `source`, `external_name`, `z_field`, `channel` text null, `pay_class` text default `satis`, `confirmed` bool, `updated_at` | PK `(source, external_name)`; check `z_field`, `pay_class` |

Ayar: `settings.modposApiBaslangic` (Faz 2). Durum: `integration_state › modpos` (`parseModposState`, bozuk alan
atılır; `lease`, `runs` son 10, `dayErrors` en çok 10, son deneme / başarı / hata) ve `modpos.token` (Faz 3, şifreli,
yedek dışı). Sütun adları `tests/yedek.test.ts:144`'teki sır kalıbına (`…|key|token|hash|…`) takılmaz (`line_ref`).

Boyut: ≈ 80–150 satır / gün × 120 gün ≈ 16 bin satır bugün, yılda ≈ 50 bin, birkaç MB. Yedek 2.000'er satırla akar
(`src/server/backup/core.ts:89-90`).

---

## 3. Kaynak önceliği ve çift sayım

### 3.1 Gün gün (S = LafPOS geçiş günü, A = `modposApiBaslangic`, `null` = yok)

| Gün | Ürün satırları (aylık model) | Ay bilgisi alanları | Günlük satış (M31) | Kasa formu (Faz 4) | Komisyon (Faz 4) |
|---|---|---|---|---|---|
| `S` dolu ve gün ≥ S | LafPOS | elle > rapor > LafPOS Z | rapor > LafPOS Z | LafPOS ön doldurma | elle > lafpos > tek |
| A dolu, gün ≥ A-01, (S yok ya da gün < S) | **API, yalnız `satis`** (ayın listesi sayılmaz) | elle > rapor (boş indirim / ödenmez API'den) > **API** | rapor > **API net** | **API** ön doldurma | elle > **modpos** > tek |
| öteki | elle liste (bugünkü gibi) | elle > rapor | rapor | fotoğraf | elle > tek |

- Geçiş ayında (S'nin ayı ≥ A): API günleri ayın 1'i … S − 1, LafPOS S … ay sonu; API ayının kapsamı
  `min(son API günü, S − 1)`, bugünkü `lafposSalesFrom` (`src/lib/lafpos/switch.ts:67-75`) değişmez.
- A dolu ama ay < A: bugünkü kurallar aynen.

### 3.2 Çift sayım yolları ve kapatılması (testlerin hepsi saf, `npm test`'te her zaman koşar; R18)

| Yol | Kapanış | Test |
|---|---|---|
| Aynı ay hem liste hem API | A'dan itibaren liste düşer (`mergeApiSales`) | `tests/modpos-kaynak.test.ts` |
| API + LafPOS aynı gün | Gün ≥ S ise API satırı okunmaz | aynı |
| API toplamı + kasa raporu `zTotal` | Yedek satır yalnız raporsuz günde; `tillMonths` raporu öne alır | aynı + `tests/kasa-ay-bilgisi.test.ts` |
| Raporlu günde boş indirim + API indirimi | Yalnız boş alan dolar; dolu alan raporun (M12) | `tests/kasa-ay-bilgisi.test.ts` |
| `months` elle + API | Elle kazanır; "Bu ayı ModPOS'a bırak" hepsini birlikte boşaltır | `tests/kasa-ay-bilgisi.test.ts`, `tests/modpos-baslangic.test.ts` (Faz 2) |
| İade + aynı fişin satışı | İade yalnız iade gününün `net`'inde; ürün adedi düşmez (M8) | `tests/modpos-kaynak.test.ts`: sonraki aydaki iade önceki ayın satırlarını değiştirmez, ay adedi ≥ 0 |
| Panel ürün ikramı + API ikramı | Faz 4, yalnız `ikramLines` | `tests/modpos-ikram.test.ts` (Faz 4) |
| Site `manual` / `counter` + API | Site düşüyor, API getiriyor: tek sayım (M18) | `tests/site-satis.test.ts` değişmez |
| Kasadaki karaoke (HİZMET) + site karaoke | Ayrı satırlar; HİZMET işareti `pos_mappings.is_service` | `tests/modpos-kaynak.test.ts` |
| Aynı gün iki kez çekilir | Parmak izi aynı → yazım yok; farklı → gün yenilenir | `tests/modpos-db.test.ts` |
| Gelir-gider ↔ nakit planı ↔ haftalık ↔ tahmin | Hepsi `loadDailySales` / `tillRows`'tan (M31) | `tests/modpos-kaynak.test.ts`: API'li günlerde dört yerin gün toplamı aynı |
| Kasa ay satırı ↔ veri kümesi ayı | Aynı yükleyici ve aynı `firstReport` / `firstEver` (M15) | `tests/kasa-ay-bilgisi.test.ts` |
| **A boşken** | Hiçbir okuyucu API satırı görmez | saf: `mergeApiSales(…, A = null)` girdiyi aynen döndürür; `tillMonths` modpos satırsız çıktı aynı |

---

## 4. Eşitleme (Vercel Hobby içinde; Faz 3, sahte veri Faz 1)

### 4.1 Koşucu (`src/server/pos-api/runner.ts`, Faz 3)

```
runPosApiSync(trigger, { deadlineAt }):
  cfg = readModposConfig(); yoksa → { status: "off" }
  lease = takeLease()                     // integration_state › modpos.lease, 120 sn
  yoksa → { status: "busy" }
  dayBudget = caps.requestsPerDay × MIN_GAP_MS + 3_000
  plan = planApiDays({ today: businessDate(), now, start, have: gün özetleri, changed? })
         // 1) dün  2) önceki 2 gün  3) changedDays ya da son 62 günden checked_at'i en eski 3 gün
         // 4) başlangıçtan düne eksik tam günler, en eskiden; en çok 40
  her gün: deadlineAt − now < dayBudget ise dur
     fetchDay → normalizeApiDay → storeApiDay (M7; 55P03 → o gün busy)
     gün hatası → state.dayErrors[day] (en çok 10); kimlik hatası → dur
  state + runs yaz, kira bırak, değişen gün varsa logActivity(null, "ModPOS çekmesi", …)
  return { status: ok | partial | error, remaining, daysRead, daysNew, daysChanged }
```

`planApiDays` ve `isDayComplete(day, now)` saftır (`src/lib/pos-api/plan.ts`): gün ≤ `businessDate(now) − 1` ve `now`
≥ gün + 1, 07:00 TR.

### 4.2 Tetikler (Faz 3)

| Tetik | Nerede | Süre | Ne yapar |
|---|---|---|---|
| Sabah adımı | `route.ts`: `modposP` `forecastP` (`:57-61`) ile aynı anda başlar; `extras()` içinde beklenir | son an `jobStart + 45_000`; `capped(modposP, jobStart + 46_000 − Date.now(), {status:"timeout"})` | Artımlı + kalan süre geçmiş; adım `ok` / `partial` / `busy` / `timeout` / `error` (A dolu) / `deneme-hata` (A boş) |
| **Şimdi çek** | Ayarlar › ModPOS | 45 sn | Artımlı + geçmiş |
| **Geçmişi al / Devam et** | aynı kart; istemci `remaining` bitene ya da 12 tura kadar | tur başına 45 sn | "34 / 120 gün · Temmuz bitti, Ağustos'ta" |
| **Bağlantıyı dene** | aynı kart | 15 sn | `probe`; yazmaz |
| Sayfa açılışı | **yalnız Ayarlar** (`export const maxDuration = 60`), `after()` | 20 sn | Yalnız A dolu, son başarı 26 saatten, son deneme 30 dk'dan eskiyse |
| **Durumu sıfırla** | kart (⋯, `ConfirmDialog`) | – | `integration_state › modpos` ve belirteç silinir; veri kalır |

Her eylem `"use server"`, `requireAdmin()`, `attempt()` (`src/server/actions/parasut.ts:38`, `src/server/actions/util.ts:11`);
eylem dosyasında yardımcı dışa açılmaz. `STEP_LABELS.modpos` = { ok: "ModPOS satışları alındı", partial: "ModPOS: süre
yetmedi, kalan günler sonra", busy: "ModPOS çekmesi sürüyordu", timeout: "ModPOS: süre doldu", error: "ModPOS hata",
"deneme-hata": "ModPOS (deneme): çekilemedi" }.

### 4.3 İstemci (Faz 3)

`src/server/modpos/http.ts`: `fetch` + `AbortSignal.timeout(15_000)`, `cache: "no-store"`, M25'in temposu ve yeniden
denemesi, `ensureTime(deadlineAt)`; belirteç yenileme kendi danışma kilidiyle (`src/server/parasut/client.ts:21-23`,
`:174`). Yanıt gövdesi günlüğe yazılmaz; hata metinleri Türkçe (`src/server/site-sales/sync.ts:68-85`).

### 4.4 Sahte veri (Faz 1)

`src/server/pos-api/fake.ts`: tohumlu, belirleyici (`seed` + gün → aynı `ApiDayIn`). `scripts/modpos-sahte.ts`
(`npm run modpos:sahte -- --from 2026-07-01 --to <dün>`): günleri `storeApiDay` ile yazar; M26'nın iki koşulu yoksa
yazmadan çıkar. Senaryolar (`tests/fixtures/modpos/*.json`): normal gün, satışsız gün, iade günü (önceki ayın
satışının iadesi), kartla bahşiş ve cari tahsilatı, servis / kuver satırı, ödeme toplamı tutmayan gün, tanınmayan ödeme
türü, seçenek satırları (LATTE + Karamel şurup + Yulaf sütü), adı değişen ürün, gün içinde iki fiyat. Faz 3: 429,
401, yavaş yanıt.

### 4.5 Ayarlar › ModPOS (kasa) kartı (`src/app/panel/ayarlar/modpos-card.tsx`)

`SETTINGS_SECTIONS`'a `lafpos`'tan sonra `{ id: "modpos", label: "ModPOS (kasa)", icon: Store }`
(`src/app/panel/ayarlar/sections.ts:22-23`).

- **Faz 1 (salt okunur):** akordeon özeti "Kurulmadı · satışlar elle" | "Deneme · 120 gün geldi, hesaba girmiyor";
  Kurulmadı açıklaması "ModPOS'un API anahtarı tanımlı değil. Satışlar bugünkü gibi elle gelir: Satışlar › İçe aktar ve
  kasa raporu."; veri varsa kapsam ("1 Temmuz – 28 Ekim 2026 · 120 günün 118'i geldi · eksik: 14, 15 Eylül"), ilk
  satışlı gün, eşleşmeyen ürün adı, eşlenmemiş ödeme türü ve sorunlu gün sayıları. Düğme yok.
- **Faz 2:** Eşleşmeyen ve bağlı ürün adları (**Bağla** / **Değiştir**; `pos_mappings`, Satışlar'la aynı yazıcı) ·
  Ödeme türleri (Nakit / Kart / Yemek kartı · marka / Platform · marka / Diğer; sınıf: Satış / Bahşiş / Tahsilat /
  Cari; "Öneri" rozeti, **Onayla**) · Sorunlu günler (**Kabul et**, not) · **Ay ay karşılaştırma** (ay | elle | kasa
  raporu | ModPOS API | fark; elle 0 ve karışık çift vurgulu; **Bu ayı ModPOS'a bırak**) · Başlangıç ayı: "ModPOS
  API'den sayılır: [ay]" + **Kaydet** → önizleme (M11). Red metinleri: "Eylül'ün 3 günü henüz gelmedi." / "2 ödeme türü
  eşlenmedi." / "1 sorunlu gün kabul edilmedi: 14 Eylül."
- **Faz 3:** **Bağlantıyı dene** · **Şimdi çek** · **Geçmişi al** / **Devam et** · **Durumu sıfırla** · son 5 çalışma ·
  geçmişte değişen günler (son 60 gün).

### 4.6 Satışlar ve öteki yerlerdeki tek satır (Faz 2)

- Satışlar başında, A doluysa ve ay ≥ A: nötr bant "Bu ayın ürün satışları ModPOS API'den (28 Ekim'e kadar). Yüklenen
  liste sayılmıyor." + "Ayarlar"; içe aktarma ve satır ekleme yerine salt okunur tablo (LafPOS ayının yolu,
  `src/app/panel/satislar/page.tsx:126-136`, `:256-311`). Red (`importSales`, `saveLine`): "Eylül ModPOS API'den
  geliyor; liste yüklenmez." (`modposImportRule` deseni, `src/lib/lafpos/sales.ts:244-252`). "Her sabah kendiliğinden
  gelir" cümlesi yalnız sabah adımı (Faz 3) kuruluyken.
- Kasa'da ay satırı (`kasaMonthLine`) yalnız yönetici bölümünde değişir; personel görünümü değişmez.
- Deneme (A boş) iken Satışlar'da hiçbir şey değişmez.

---

## 5. Tüketiciler (öncelik sırasıyla; hepsi yalnız A doluyken; A boşken bayt bayt bugünkü gibi)

1. **Aylık model: ürün satırları** (Faz 2; saf çekirdek Faz 1). `mergeApiSales` (`src/lib/pos-api/merge.ts`): API
   ayının liste satırlarını düşürür, API ay toplamlarını (`satis`, `(ay, pos_name, varyant)` başına; ürün okurken
   `pos_mappings`'ten) sentetik `SalesLine`'a çevirir (kimlik `-(100_000 + i)`, `modpos: { days }`;
   `src/lib/calc/types.ts:200-216`), kapsamı son API gününe yazar; sonra bugünkü `mergeSalesSources` (LafPOS) aynen.
   SQL ay toplamı `loadApiMonthSales` (`src/server/pos-api/load.ts`). Tek giriş: `dataset.ts`'in `mergeWithLafpos`
   çağrısı (`src/server/data/dataset.ts:147-172`) ve tatlı payı (`src/server/forecast/mix.ts`) aynı `mergeSales(db, …)`.
   Okuyanlar kendiliğinden: Satışlar, Genel bakış, Ürünler, Tutarlılık tüketimi, menü mühendisliği, Analiz, KDV
   tahmininin hizmet payı, Excel "Satış Kayıtları" (+ "Kaynak" sütunu), Claude araçları.
2. **Ay bilgisi yedeği** (Faz 2; `tillMonths` değişikliği Faz 1). `tillRows()` (`src/server/data/cash-reports.ts:265-283`)
   `apiTillRows()`'u ekler: A-01'den (S'den önce) LafPOS satırı olmayan **bütün** günler (satışsız dahil, `zTotal` 0),
   `TillRow.source: "modpos"`, `zTotal = net`, `card` / `mealCard` / online eşlemeden, `discounts`, `offRevenue`,
   `receipts`; raporlu günde yalnız raporun boş alanını dolduran yarım satır (M12). Kasa ayın satırını da aynı yükleyiciden
   (`tillRowsBetween(from, to)`) okur (`src/app/panel/kasa/page.tsx:416`, `:436` değişir). Okuyanlar: Gelir-gider, Genel
   bakış öngörüsü, yıl toplamı, Vergi'nin yönetim verisi, KDV zinciri, sabit gider sürümü (`src/server/actions/costs.ts:53-75`
   `dataMonths`: API'li ay "veri ayı" olur, maaş / sabit gider değişikliği o ayı geriye dönük değiştirmez; istenen yön,
   test sabitler). **Elle kalır:** `months` düzeltmeleri, `pnl_entries`.
3. **Günlük satış** (Faz 2, M31): satış tahmini (açılıştan beri tam seri: kaba tahmin biter, `load.ts:125-129`), nakit
   planı, haftalık özet. Bugün raporla kalır.
4. **Satışlar ekranı ve eylemleri** (Faz 2): §4.6; silme engeli (`src/server/data/product-history.ts:14-41`) API adlarını
   sayar (M19).
5. **Etiketler** (Faz 2, M32).
6. **Kasa raporu** (Faz 4, M16): ön doldurma, farklar, ModPOS Z fotoğrafının gizlenmesi, "Kafe kapalıydı" kanıtı
   (`satissiz` gün kapalı, `satisli` gün açık; `cash-month.ts:82-87` `soldLafpos` gibi). **Elle kalır:** açılış, sayılan
   nakit, teslim, kasadan çıkan, yazarkasa Z, banka gün sonu.
7. **Komisyon & hakediş** (Faz 4, M20): `lafposMonth` (`src/lib/commission/report.ts:476-553`) `source`'lu gün girdisine;
   `SalesSource` + `modpos`. **Elle kalır:** ekstre, hakediş.
8. **Stok: ikram** (Faz 4, yalnız `ikramLines`).
9. **KDV satır oranıyla** (Faz 4, R14): yalnız ay API'den **tam** kapsanıyorsa ve bütün satırlarda oran varsa,
   `effRate = Σ KDV / Σ net` API'den hesaplanır ve **seçilen ay cirosuna** (elle, rapor ya da API) uygulanır (tutar ve
   oran ayrı kaynaktan gelse de oran tutarlı); değilse bugünkü formül (`src/lib/kdv.ts:63-66`). K11 sırası değişmez.
10. **Kasadaki fiyat** (Faz 4): gerçekleşen birim fiyat panel fiyatından farklıysa "Kasada eski fiyat" kanıtı.
11. **Saatlik dağılım** (Faz 4, `hours`): tahmin saat profili, karaoke doluluğunda kasadaki karaoke geliri.
12. **Claude (MCP)** (Faz 4): yanıtlar kaynağı yazar; salt okunur "gün ve ürün satışı" aracı.

---

## 6. Fazlar

### Faz 1: şimdi (API yokken), tek PR, davranış değişmez

Kapsam: dört tablo + gün toplamının doğrulanması ve saklanması + **saf birleştirme / öncelik çekirdeği** (Faz 2'den
alındı; A ve S ile bütün çift sayım matrisi ve değişmezlik saf testlerde) + `tillMonths`'un iki girdisi + sahte veri
betiği + salt okunur kart + belgeler + testler. Koşucu, istemci, sabah adımı, fiş toplama, saat, düğmeler yok. Hiçbir
okuyucu yeni tablolara bakmaz; `MODPOS_*` tanımsızken kart "Kurulmadı".

Dosyalar:
- `drizzle/00NN_modpos_api.sql` + meta (`npm run db:generate -- --name modpos_api`; elle SQL yok); `src/server/db/schema.ts`
  (dört tablo, §2.4).
- `src/lib/pos-api/types.ts`, `schema.ts` (Zod), `day.ts` (`normalizeApiDay`, `checkApiDay`, parmak izi),
  `payments.ts` (`suggestPaymentMap`, sınıflar), `merge.ts` (`mergeApiSales`, `apiMonthLines`, `mergeDailySales`,
  `apiTillRows`; hepsi saf, DB'siz), `money.ts` (`kurusToTl`, `tlToKurus`), `status.ts` (`parseModposState`, kart metinleri).
- `src/lib/cash-month.ts`: `TillRow.source` += `"modpos"`, `tillMonths(…, { firstReport })`, `TillMonth.modpos`
  (`src/lib/calc/types.ts:130-175`); modpos satırı yokken çıktı aynı.
- `src/server/pos-api/store.ts` (`storeApiDay`, M7), `config.ts` (`readModposConfig`, eksiklerin adları, M26),
  `fake.ts`, `status.ts` (`loadModposStatus`, salt okunur); `src/server/db/index.ts` (`isLocal` dışa).
- `scripts/modpos-sahte.ts` + `package.json` betiği.
- `src/app/panel/ayarlar/modpos-card.tsx`, `sections.ts`, `page.tsx` (kart).
- `docs/MODPOS-API.md` (kurgu, kaynak önceliği, açılış sırası §9, sahte veri); Yardım'da tek madde.
- Testler: `tests/modpos-gun.test.ts` (doğrulama, red, sorunlar, tolerans, bahşiş / cari sınıfı, parmak izi, seçenek
  satırları), `tests/modpos-kaynak.test.ts` (§3.2 matrisi, A = null değişmezliği, geçiş ayı karışımı, iade, ay adedi ≥
  0), `tests/kasa-ay-bilgisi.test.ts` ek (`firstReport`, modpos satırları, boş alan doldurma, satışsız A-01 satırıyla
  `partialFrom` null), `tests/modpos-durum.test.ts` (`suggestPaymentMap`; `VERCEL=1` ya da uzak `DATABASE_URL` iken sahte
  kapalı), `tests/modpos-db.test.ts` (`MODPOS_TEST_DATABASE_URL`: saklama, aynı içerik yazımsız, değişen gün `revision`
  2 ve `previous`, kilit beklerken `busy`, kabul aynı parmak iziyle kalır, farklıyla düşer).

Kabul: env yok → `tests/golden.json` ve bütün mevcut testler aynı; yerelde `npm run modpos:sahte` Temmuz'dan düne günleri
yazar, kart kapsamı ve sayıları gösterir; başka hiçbir ekran değişmez. **Boyut ≈ 1.400–1.700 satır** (kod ≈ 750: lib ≈
450, server + betik ≈ 200, kart ≈ 100; test + fikstür ≈ 600–800; belge ≈ 100).

### Faz 2: şimdi yapılabilir (Faz 1'den sonra ayrı PR), tüketiciler A'nın arkasında

M10 (c), M11, M13 eylemi, M15 bağlantısı, M19 kart eylemleri, M31, M32 ve §5'in 1–5'i. Dosyalar:
`src/lib/constants.ts` (`modposApiBaslangic`, `readModposApiStart`, `MODPOS_API_MIN`), `src/lib/pos-api/start.ts`
(`modposStartProblem`, önizleme), `src/server/pos-api/load.ts` (`loadApiMonthSales`, `loadApiDays`), `src/server/data/sales-merge.ts`
(`mergeSales`), `src/server/data/daily-sales.ts` (`loadDailySales`), `src/server/data/dataset.ts`,
`src/server/forecast/{load,mix}.ts`, `src/server/data/cash-reports.ts` (`apiTillRows`, `tillRowsBetween`),
`src/app/panel/kasa/page.tsx`, `src/server/data/cash-plan.ts`, `src/server/weekly/collect.ts`, `src/lib/lafpos/kasa.ts` +
`src/lib/tax/pnl.ts` ve bütün çağıranlar (M32), `src/server/sales/mapping.ts` (`writeMapping` taşınır),
`src/server/actions/sales.ts` (retler), `src/server/actions/modpos.ts` (Bağla, ödeme eşle, gün kabul, ayı bırak,
başlangıç önizle / kaydet), kart, `src/app/panel/satislar/*`, `src/app/panel/dashboard-tasks.tsx`,
`src/server/data/product-history.ts`, `src/app/api/export/workbook.ts`.
Kabul: A boşken veri kümesi, tahmin, tatlı payı, nakit planı, haftalık bayt bayt aynı (saf testler + bir DB testi); A
dolu sahte veriyle Genel bakış, Gelir-gider, Kasa ay satırı, Satışlar, Tutarlılık, Satış tahmini, nakit planı API ayını
aynı rakamla gösterir; LafPOS geçiş ayı karışımı doğru; `scripts/personel-sizinti.ts` temiz. **Boyut ≈ 1.500–1.900 satır.**

### Faz 3: API belgesi gelince

1. §8'in yanıtları `docs/MODPOS-API.md`'ye; `ApiCapabilities` doldurulur.
2. `src/server/modpos/http.ts` + `adapter.ts` (yalnız bunlar ModPOS'u bilir); fiş veriyorsa `src/lib/pos-api/receipts.ts`
   `foldReceipts` (§2.3). Maskeli gerçek örnekler `tests/fixtures/modpos/real-*.json`, sözleşme testi
   `tests/modpos-adapter.test.ts` (alan eşlemesi, tutar biçimi, saat dilimi, sayfalama, iade / ikram / seçenek gösterimi).
3. Koşucu (§4.1), tetikler ve sabah adımı (§4.2), kart düğmeleri, belirteç (`seal`, `EXCLUDED_STATE_KEYS`),
   `docs/DEPLOY.md` ortam tablosu.
4. Canlıda açılış sırası (§9). **Boyut ≈ 1.200–1.600 satır** (belgenin karmaşıklığına bağlı).

### Faz 4: API çalışınca (yetenek yetenek, her biri ayrı küçük PR)

§5'in 6–12. maddeleri; her biri yalnız ilgili yetenek `true` ise.

### Faz 5: sadeleştirme (sahibin onayıyla)

API en az bir tam ay sorunsuz çalıştıktan sonra: Satışlar'ın ModPOS içe aktarma yolu yalnız API'den önceki aylara, ModPOS
Z fotoğraf okuması API günlerinde kalkar (yazarkasa Z kalır), `sales.coverage` / `listPeriod` makinesi yalnız eski aylara.

---

## 7. Riskler ve testler

| Risk | Önlem | Testin sabitlediği |
|---|---|---|
| **Yanlış geçmiş** (Ağustos 500.000, tohumun 0'ları, Ekim'in 16 günü) | Elle kazanır; "Bu ayı ModPOS'a bırak"; karşılaştırma ve önizleme (M11, M13) | `tests/kasa-ay-bilgisi.test.ts`: elle değer kalır; ayı bırakınca bütün alanların kaynağı `kasa`; karışık çift uyarısı |
| **Çift sayım** | §3.2 | saf matris, her satır ayrı durum |
| **A boşken davranış değişir** | Bütün okuyucular A'yı tek yardımcıdan okur; çekirdek saf | `mergeApiSales(A=null)` ve `tillMonths` girdiyi aynen; `tests/golden.json`; Faz 2'de bir DB testi |
| **Otomatik bütçe günü yetmez** | Türetilmiş gün bütçesi, paralel 45 sn, küçük artımlı plan (M22, M24, M25) | `tests/modpos-plan.test.ts` (Faz 3): sahte adaptör + 8 sn son an → dün yazılır; plan dün + 2 + 3 |
| **05:00–06:00 fişi** | M5 penceresi | Faz 3: Z günü D, 05:30 kapanan fiş `fetchDay(D)` ve `fetchDay(D+1)` sonrası tam bir kez D'de; ofsetsiz zaman red |
| **İade** | M8 | `tests/modpos-kaynak.test.ts`: aynı gün iade net 0; sonraki ay iadesi önceki ayı değiştirmez; adet ≥ 0 |
| **Bahşiş / cari / servis** | M9 sınıfları ve tolerans; Kabul et | `tests/modpos-gun.test.ts`: kartla bahşişli gün sorunsuz; `tests/modpos-db.test.ts`: kabul aynı parmak iziyle kalır |
| **Eşleme düzeltmesi geçmişe gitmez** | Okurken çözüm (M19) | `tests/modpos-kaynak.test.ts`: eşleme değişince bütün API aylarının ürünü değişir |
| **Seçenekler kaybolur** | Ayrı satır (§2.3) | `tests/modpos-gun.test.ts`: LATTE + şurup + süt üç satır |
| **Fiyat değişimi** | `line_ref` birim fiyatı içerir; ay toplamında tek satır | `tests/modpos-gun.test.ts`, `tests/modpos-kaynak.test.ts` |
| **Yarıda kalan / askıda yazım** | Gün kendi işleminde, `lock_timeout` 5 sn; kira 120 sn | `tests/modpos-db.test.ts`: ikinci yazan `busy`, ilk gün yazılı |
| **Eksik gün gürültüsü** | M15 | `tests/kasa-ay-bilgisi.test.ts`: ilk rapordan önceki API günleri eksik değil; Kasa ay satırı = veri kümesi ayı |
| **Nakit planı / haftalık API'yi görmez** | M31 | `tests/modpos-kaynak.test.ts`: API'li günlerde dört okurun gün toplamı aynı; Bugün raporla kalır |
| **Ödeme kanalı yanlış** | Onaylı eşleme, sınıf; başlangıç kapısı | `tests/modpos-durum.test.ts`: "MULTİNET" → meal_card/multinet, "YEMEKSEPETİ" → online, "NAKİT" → cash, "BAHŞİŞ" → bahsis |
| **Sahte veri canlıya** | M26 | `tests/modpos-durum.test.ts`: `VERCEL=1` ya da Neon adresiyle sahte kapalı, betik yazmaz |
| **Deneme hatası alarm verir** | M22 | Faz 3: `dailyOutcome` `deneme-hata` ile `ok` |
| **Yedek sır testi** | `line_ref`, belirteç dışarıda | `tests/yedek.test.ts` değişmeden geçer |
| **Personel sızıntısı** | M28 | `scripts/personel-sizinti.ts` (Faz 2: Kasa) |
| **API hiç gelmez** | Faz 1 küçük ve ölü değil (saf çekirdek testli); Faz 2 beklemeye alınabilir | bütün mevcut testler |

---

## 8. Sorular

### 8.1 ModPOS / Aria'ya (Faz 3'ün ön koşulu; `arastirma-modpos.md` §6.1)

1. Integra (`panel.gafdigi.com`) için dışarıya açık API var mı: bulut mu, yerel servis mi; REST / SOAP / dosya? Belge,
   OpenAPI, deneme hesabı.
2. Kimlik: API anahtarı, OAuth2 ya da kullanıcı / parola; belirteç süresi; salt okunur ve tek şubeye sınırlanabilir mi.
3. IP beyaz listesi zorunlu mu (panel Vercel'de, sabit çıkış IP'si yok)?
4. Uçlar: (a) gün sonu / Z listesi (iş günü, Z no, toplam, indirim, ödenmez, ikram, iade, iptal, fiş sayısı, ödeme
   türü kırılımı, yemek kartı markası, platform, **servis, kuver, bekleyen paket, bahşiş, cari tahsilatı**); (b) ürün
   satışı gün gün ya da adisyon kalemi (ürün kimliği, ad, kategori, **seçenekler ayrı kalem mi**, adet, birim fiyat,
   satır indirimi, KDV dahil / hariç tutar, ikram / ödenmez / iade işareti); **satır KDV oranı satış anındaki oran mı,
   ürünün bugünkü oranı mı?** (bugünkü ise `vatPerLine: false`, M4); (c) adisyon ve ödemeler (no, açılış-kapanış
   zamanı **ofsetiyle**, fişin **gün sonu günü**, tip, kanal); (d) ürün kataloğu; (e) saatlik ham veri.
5. Tarih süzgeci: açılıştan (Temmuz 2026) bugüne çekilebiliyor mu; **açılıştan önceki günler boş mu döner, hata mı**
   (M11); süzgeç iş günü mü takvim günü mü; saat dilimi; en uzun aralık; sayfalama.
6. Hız sınırı ve kota; aşınca yanıt kodu ve `Retry-After`; bir günü okumak kaç istek.
7. Webhook: gün sonu ya da adisyon kapanınca bildirim, imza, yeniden deneme.
8. Sonradan değişiklik: **iade ayrı bir olay mı (iade zamanıyla), yoksa eski fişin durumu mu değişiyor?** Silme /
   düzeltme nasıl görünür; `updatedAt` ya da "şu andan sonra değişenler" ucu.
9. Ürün kimliği kalıcı mı (ad değişince); boy ayrı ürün mü varyant mı.
10. 06:00 otomatik gün sonu ayarlanabiliyor mu; API'deki "gün" bu kapanışı mı izliyor?
11. KVKK: paket siparişlerinde müşteri adı, adres, telefon dönüyor mu; alan seçimi; veri işleme sözleşmesi.
12. Tutar biçimi: kuruş tam sayı mı, ondalık mı; para birimi alanı.
13. Yazarkasa eşlemesi: adisyon ↔ mali fiş no / ÖKC Z no veriliyor mu?
14. Logo "Cari Ekstre" ve Paraşüt entegrasyonları aynı API'yi mi kullanıyor; belgesi paylaşılabilir mi?
15. Ücret ve sürümleme; teknik destek kanalı.
16. Gerçek bir günün maskeli yanıt örneği (Z, kalemler, ödemeler).

### 8.2 Sahibe (`arastirma-modpos.md` §6.2; iş beklemez, varsayılan yazılı)

1. API'yi kim, ne zaman verecek; muhatap ve kanal; ek ücret? (Varsayılan: Faz 1 beklemeden yapılır.)
2. Anahtarı Vercel'e kim koyacak (sohbete yapıştırılmamalı); yalnız Production. (Varsayılan: sahip, `docs/MODPOS-API.md`'deki adımlarla.)
3. Açılış öncesi deneme satışı ModPOS'ta var mı, sayılsın mı? (Varsayılan: varsa ya da API açılış öncesi günleri
   vermiyorsa başlangıç ayı Temmuz seçilemez, Ağustos seçilir; Temmuz elle kalır.)
4. API'nin Z'si personelin kasa raporuyla çelişirse? (Varsayılan: rapor ay rakamında kazanır, fark kasa ekranında.)
5. Geçmiş ayların (Temmuz–Ekim) API verisiyle değişmesine izin var mı? (Varsayılan: elle yazılanlar kalır; sahip
   karşılaştırmadan bakıp "Bu ayı ModPOS'a bırak" der. Tohumdaki 0 indirim / ödenmez ve Ekim'in 16 günü vurgulanır.)
6. API gelince Satışlar'ın elle yüklemesi ve ModPOS Z fotoğrafı kalksın mı? (Varsayılan: API ayında gizlenir, kod Faz
   5'e kadar kalır; yazarkasa Z fotoğrafı kalır.)
7. LafPOS'a geçiş planı: ModPOS ne zamana kadar? (Faz 3–4'ün kapsamını belirler.)
8. ModPOS'ta kaç şube var? (Varsayılan: `MODPOS_BRANCH_ID` zorunlu, tek şube.)
9. Ödeme türü eşlemesini ilk açılışta birlikte onaylayalım mı? (Varsayılan: kart önerir, sahip onaylar.)

---

## 9. Açılış sırası (canlıda; `docs/MODPOS-API.md`'ye aynen)

Partiler yayına çıkmak hiçbir şeyi açmaz: anahtar ve başlangıç ayı yokken panel bugünkü gibi çalışır.

1. **Anahtarlar:** Vercel'de (yalnız Production) `MODPOS_BASE_URL`, kimlik, `MODPOS_BRANCH_ID`; yeniden yayın. Kart "Deneme".
2. **Bağlantıyı dene:** kimlik ve dünün okunması, yazmadan.
3. **Geçmişi al:** Temmuz'dan bugüne günler "deneme" olarak gelir. Kart eşleşmeyen adları (**Bağla**), ödeme türü
   önerilerini (**Onayla**) ve sorunlu günleri (**Kabul et**) gösterir.
4. **Karşılaştır:** ay ay elle / kasa raporu / API; elle değeri tutmayan ayda **Bu ayı ModPOS'a bırak**.
5. **Başlangıç ayı:** seçilir, önizleme onaylanır. Geri almak ayarı boşaltmaktır.

---

## 10. Doğrulama (her PR)

- `npm run typecheck && npm test` (saf testler her zaman; DB testleri `MODPOS_TEST_DATABASE_URL` ile), `npm run lint`,
  `npm run build`.
- Faz 1: yerelde `npm run modpos:sahte`, Ayarlar › ModPOS kartı telefonda (390 px) ve masaüstünde (1440 px); başka
  ekranın değişmediği (A boş).
- Faz 2: A dolu sahte veriyle Genel bakış, Gelir-gider, Kasa, Satışlar (API ayı, LafPOS geçiş ayı), Tutarlılık, Ürünler,
  Satış tahmini, Nakit planı; canlı verinin kopyasıyla A boşken `loadDataset` önce / sonra aynı.
- `scripts/personel-sizinti.ts`; yedek indirme (yeni tablolar içinde, belirteç dışında).

---

## 11. Sonraya

- LafPOS'un `pos_api_*`'e yazması (`source: 'lafpos'`) ve `pos_daily_sales` / `pos_day_reports`'un emekliye ayrılması.
- ModPOS webhook'u (ping → `after()` → o günü çek, `src/lib/ping-work.ts:14-60`).
- Bugün'de canlı satış; fiş düzeyi analiz (ayrı, yaşlandırmalı tablo).
- ModPOS ↔ yazarkasa Z mutabakatı (`okcReconcile`, `src/lib/okc-z.ts:793-830`).

---

## Ek A. Eleştiri ve kararlar (29 Eki 2026, kod `origin/main` @ 1947c7c'de doğrulandı)

| id | Karar | Neden (tek satır) |
|---|---|---|
| R1 | **Kabul, sadeleştirerek** (M22, M24, M25) | `jobStart + 8_000` son an 10 sn bütçeden kısa (`capped.ts:12`); tek görev jobStart'ta paralel, son an +45 sn, `extras()`'ta beklenir; e-posta API okumadığı için ayrı "dün" adımı gereksiz; bütçe türetilir, artımlı dün + 2 + 3. |
| R2 | **Kabul** (M5, §2.3) | ModPOS 06:00'da kapanır, panel 05:00'te döner (`cash-report.ts:145`); [D 05:00, D+1 07:00) penceresi her iki kuralın fişlerini içerdiği için ek tekilleştirme deposu gerekmez; ofset zorunlu. |
| R3 | **Kabul, değiştirerek** (M8, §2.3) | İade kendi gününde olay; ay ürün satırı yalnız `satis`, iade yalnız gün cirosundan düşer: eksi adet ve kapanmış ayın yeniden yazılması baştan olmaz, kırpmaya gerek kalmaz. |
| R4 | **Kabul** (M15, §5.2) | Tek `first` hem eksik gün hem `partialFrom` (`cash-month.ts:62`, `:114`), Kasa farklı yükleyici ve `first` kullanıyor (`kasa/page.tsx:406`, `:416`, `:436`); iki girdi + tek yükleyici, Kasa Faz 2 listesinde. |
| R5 | **Kabul** (M31) | Nakit planı, haftalık, Bugün `cashReportsBetween` okuyor (`cash-plan.ts:83`, `collect.ts:318`, `today.ts:238`); ilk ikisi tek günlük yükleyiciye, Bugün bilerek raporla kalır (işlemsel), `costs.ts` `dataMonths` listede. |
| R6 | **Kabul, kısmen** (M13) | Tohum 0'ları ve Ekim'in 16 günü elle sayılıyor (`seed.ts:275-277`, `cash-month.ts:143-148`); tek eylemli "Bu ayı ModPOS'a bırak" + elle 0 / karışık çift vurgusu alındı; tohum kökenini tanıma reddedildi (güvenilir işaret yok, değerler sonradan düzenlenmiş olabilir). |
| R7 | **Kabul, daha basit biçimde** (M19) | Bağlı satırı yeniden bağlamayan yol doğrulandı (`rematch.ts:8-13`, `sales.ts:211-233`); ürünü satırda saklamamak ve okurken `pos_mappings`'ten çözmek, kimlik bağı tablosunu ve "öğrenme"yi kaldırır, düzeltme her güne anında gider. |
| R8 | **Kabul** (M9, M20) | Bahşiş / cari POS'tan geçer ama satış değil (`lafpos/day.ts:68-73`); ödeme sınıfı, oransal tolerans ve kayıtlı "Kabul et" olmadan başlangıç kapısı hiç açılmazdı. |
| R9 | **Kabul** (M11, M23) | "Çekmenin başından" istisnası ayın ilk günlerini kapsam dışı bırakırdı (`lafpos/switch.ts:67-75` benzeri bölme yok); A-01'den her gün (satışsız dahil) zorunlu, adaptörün `firstDay()`'i kaldırıldı; açılış günü ayarı eklenmedi (gerekirse Faz 3, Soru 5'in yanıtına göre). |
| R10 | **Kabul** (§2.1, §2.3) | ModPOS'ta şurup / süt seçenek grupları var (lafpos `docs/01-ANALIZ.md:30-31`), panel seçenekleri ayrı ürün sayar (`site-sales/calc.ts:107-118`); seçenek ayrı satır, `variant` yalnız boy. |
| R11 | **Kabul** (§6) | Fiş yolu, saat, revizyon tablosu, koşucu ve sabah adımı bilinmeyen semantiğe bağlı; Faz 1 gün toplamı + saklama + saf çekirdek + salt okunur kart. Patron'un gün gün dışa aktarımlarıyla besleme **reddedildi**: ≈ 120 elle yükleme ve `pos-paste.ts` yalnız ürün listesini okur, Ciro toplamını değil. |
| R12 | **Kabul** (M22) | `stepFailed` `error`'u hata sayar (`job-health.ts:236`), zil ve e-posta "Sabah işinde bir adım hata verdi" der (`:127`, `:383`); deneme modunda `deneme-hata`, adım `OptionalStep` (`:203`), sıra (`:244`), `STEP_NAMES` (`:143`) listelerine. |
| R13 | **Kabul** (M7, §2.4) | `SECRET_NAME` `key` içerir (`tests/yedek.test.ts:144`); sütun `line_ref`. |
| R14 | **Kabul, kısmen** (M4, M11, §5.9) | Dondurma ilk doldurmayı korumaz: kaldırıldı, Soru 4 açık soruldu; Faz 4 `effRate` alındı; eşleşmeyen ciro ve HİZMET adayları önizlemede **uyarı**, engel değil (elle liste yolunda da aynı boşluk var, kapı ondan sıkı olmamalı). |
| R15 | **Kabul** (M26, M27) | `isLocal` var ama dışa kapalı (`db/index.ts:23`), önizlemeler canlı veritabanını paylaşıyor (`docs/DEPLOY.md:80-92`); Kasa satırı yalnız yönetici bölümünde (`kasa/page.tsx:362`), `/panel/kasa` sızıntı betiğinde zaten var (`personel-sizinti.ts:31-33`). |
| R16 | **Kabul** (M7, §4.2) | Satışlar'da `maxDuration` yok; sayfa açılışı tetiği yalnız Ayarlar'da; `lock_timeout` 5 sn + `55P03` → `busy` (`sold-out-core.ts:117-125` deseni). |
| R17 | **Kabul, kısmen** (M32) | Bütün çağıranlar `KasaSources` geçer (mekanik); ama kasa API'de de ModPOS olduğundan yalnız `report` / `long` "ModPOS API" der, `short` / `both` / vergi rozeti değişmez (`kasa.ts:29`, `pnl.ts:224-231`). |
| R18 | **Kabul** (§3.2, §6) | Repoda test koşan iş akışı yok (yalnız `.github/workflows/claude-inceleme.yml`), DB testleri ortam değişkeni ister; değişmezlik ve çift sayım matrisi saf çekirdekte, DB testleri yalnız saklama / eşzamanlılık. |
| R19 | **Kabul** (M12) | Boş `discounts` / `offRevenue` aya girmez (`cash-month.ts:90-91`, `:105-107`), kâr şişer (`insights.ts:634`); raporlu günde yalnız boş alan API'den. |
| R20 | **Kabul** (M6) | `TillRow` / `tillMonths` / `tillScope` ve `kapali` (özel günler) başka anlamda; `pos_api_*`, `src/lib/pos-api`, `src/server/pos-api`, durum `satisli` / `satissiz`. |

Sadeleştirmeler (eleştiriden doğan): yedi tablo dörde indi (`till_day_revisions` → `previous` sütunu + işlem geçmişi;
`till_sync_runs` → `integration_state` kira + son 10 çalışma; `till_product_links` → okurken `pos_mappings`); Faz 1
≈ 2.000–2.600 satırdan ≈ 1.400–1.700'e indi ve hiçbir ekranı değiştirmez.

# Vercel'e kurulum

Uygulama tek bir Next.js projesi: frontend ve backend (Server Actions + API uçları) birlikte Vercel Functions
olarak çalışıyor. Veritabanı olarak Vercel Marketplace'teki Neon Postgres önerilir.

## 1. Kodu bir Git deposuna koyun

```bash
git init && git add . && git commit -m "L'Affogato paneli"
```

GitHub'da **gizli (private)** bir depo açıp kodu oraya gönderin. Depo kökü `lafmaliyet` klasörüyse Vercel'de
**Root Directory** olarak `laffogato` seçeceksiniz.

**Depo gizli kalmalı: kişisel veri taşır.** `tests/fixtures/baslangic/veri.json` panelin ilk kurulumundaki başlangıç
verisidir (Ekim 2026'da eski hesap tablosundan bir kez aktarıldı): personelin adı ve maaşı, kira, faturalar,
tedarikçiler, satışlar. Uygulama bu dosyayı kullanmaz (`src/` onu içe aktarmaz; `tests/eski-veri-adlari.test.ts`
tutar), canlıda boş veritabanına da kendiliğinden yüklenmez (§ 5). Yalnız yerel ve test veritabanını dolduran tohum
betiği (`npm run db:seed`, `scripts/seed.ts`) ve hesap motorunun altın testleri okur; değerleri değiştirilmez (testlerin
beklenen rakamları onlardan gelir). Depoyu herkese açık yapmayın. Dosya git geçmişinde de durur (26 Kasım 2026'ya kadar
`src/server/db/seed/excel-data.json` adıyla): depo bir gün açılacaksa ya da dışarıyla paylaşılacaksa önce geçmişten de
silinmeli (ör. `git filter-repo`) ve testler kişisel olmayan bir veriye taşınmalıdır.

> Vercel CLI ile Git'siz de deploy edebilirsiniz: `laffogato` klasöründe `vercel` komutu.

## 2. Vercel projesi

1. vercel.com → **Add New… → Project** → depoyu seçin.
2. Framework: **Next.js** (otomatik). Root Directory: `laffogato` (gerekiyorsa).
3. Build komutu değişmez (`npm run build`). Bu komut önce migration'ları uygular ve hepsinin gerçekten uygulandığını
   doğrular (§ 7), ilk yöneticiyi, şube kütüğünü ve hazır kontrol listelerini bir kez yazar, sonra derler. Canlı
   derleme boş veritabanına başlangıç verisi **yüklemez**, uyarıyla sürer (§ 5). Önizleme derlemesi migration ve seed
   çalıştırmaz (§ 3); bekçiyi içeren commit'lerde `main` dışındaki bir dalın Production derlemesi hiç başlamadan durur
   (§ 7, "Production yalnız main'den"; bekçiden önce açılmış eski dallar durmaz, onların dağıtımları yeniden
   derlenmez).

## 3. Veritabanı (Neon)

1. Proje → **Storage → Create Database → Neon (Postgres)**.
2. Bölge: **Frankfurt (aws-eu-central-1)**. Fonksiyonlar `vercel.json` ile Frankfurt'ta (`fra1`) çalışıyor;
   Türkiye'ye en yakın seçenek bu.
3. Veritabanını projeye bağlayın. `DATABASE_URL` ve `DATABASE_URL_UNPOOLED` değişkenleri otomatik eklenir.

**Uyuyan bağlantı ve Neon'un uyanışı.** Neon boşta kalan veritabanını uyutur; Vercel işlevi de istekler arasında
askıya alınır. Uyanıştaki ilk sorgu ölü sokete yazılabilir (`CONNECTION_CLOSED`, `ECONNRESET`), bağlantı hiç
kurulamayabilir (`CONNECT_TIMEOUT`) ya da Neon kimlik doğrulamada zaman aşımı verir (`08P01` "Authentication timed out";
canlıda 24 Eki 2026). Panel bu hatalarda sorguyu bir kez daha gönderir (`src/server/db/retry.ts`): okumayı her bağlantı
hatasında; yazımı ve işlemi (transaction) yalnız hiçbir şey gönderilmeden düştüyse (bağlantı kurulamadı, Neon'un zaman
aşımı, gövdesi çalışmamış işlemin BEGIN'i). Günlükte `[db] bağlantı yenilendi (AUTH_TIMEOUT), sorgu yeniden gönderildi: …`
satırı olağandır; aynı istekte ikinci deneme de düşerse hata sayfaya ya da işe gider.

**İşlemin ortasında kopan bağlantı (28 Eki 2026).** Havuz bir işlemin bağlantısını gövde çalışırken de kapatabilir
(BEGIN geçti; canlıda 20 ve 28 Ekim 2026, `/panel`'den gönderilen bir eylemde). postgres.js 3.4.9 işlemi
`write CONNECTION_CLOSED …-pooler…:5432` ile hemen reddeder (drizzle'ın "Failed query"si olmadan), ama kendisi ölü
bağlantıya ROLLBACK ya da COMMIT yazmayı sürdürür: hemen ardından günlüğe yakalanmamış
`TypeError: Cannot read properties of null (reading 'write')` düşer ve o havuz yuvası işlev ölene kadar bozulur
(sonraki istekler `connect_timeout`'u, 10 sn, bekleyip `CONNECT_TIMEOUT` alır; RST'de sonraki işlem hiç bitmez).
Yükseltilecek sürüm yok: 3.4.9 son sürüm, ana dalda da düzeltme yok. `src/server/db/retry.ts` bu yüzden işlem
gövdesine korumalı bir istemci verir: bağlantı kapandıktan ya da işlemin bir sorgusu bağlantı hatasıyla düştükten
sonra gövdenin sorguları gönderilmez, aynı hatayla reddedilir; gövde bittiğinde ROLLBACK da COMMIT de yazılmaz.
İşlem yeniden denenmez (gövde çalıştı, dışarıya yazmış olabilir: Paraşüt belirtecinin yenilenmesi işlemin içindedir):
eylem bir kez hata verir. Kayıt yazılmamıştır (COMMIT gönderilmeden kopan bağlantının işlemini Postgres geri alır);
bağlantı tam COMMIT yoldayken koptuysa yazılmış olabilir, yeniden denemeden önce sayfa yenilenip bakılır. Günlükte
yalnız `write CONNECTION_CLOSED` satırı kalır; `reading 'write'` TypeError'ı yeniden görünürse bu koruma aşılmış
demektir (testler: `tests/veritabani-baglanti.test.ts`, sahte Neon'la `tests/veritabani-baglanti-db.test.ts`).
Korumanın kapatamadığı dar bir pencere kalır: soketin kapanışı postgres.js'in henüz göndermediği bir yazımla aynı olay
döngüsü turuna denk gelirse (işlemde ya da işlemsiz bir sorguda; işlemde bağlantı listede olmayan bir soket hatasıyla,
ör. TLS'in `EPROTO`'su, koptuğunda da) postgres.js bekleyen yazımı iptal eder ama işaretini sıfırlamaz; o yuvanın
sonraki açılışları yine `connect_timeout`'u bekler. Günlükte TypeError olmadan art arda `CONNECT_TIMEOUT` görünür.
Bu postgres.js'in içindedir, dışarıdan düzeltilemez; canlıda görülmedi.

**Önizlemeler ve migration.** `DATABASE_URL` hem Production hem Preview ortamında aynı veritabanını gösteriyor:
önizleme (PR) dağıtımları canlının verisini kullanır. Bu yüzden derleme öncesi hazırlık (`scripts/predeploy.ts`)
önizlemede **migration ve seed çalıştırmaz** (`! Önizleme dağıtımı …: migration ve seed atlandı`); migration yalnız
canlı dağıtımda, kod yayına çıkarken uygulanır. 21 Eki 2026'da bir önizleme, birleşmemiş bir dalın migration'ını
canlıya uygulamıştı. Sonucu: yeni sütun isteyen bir PR'ın önizlemesi o sütun canlıya gelene kadar hata verebilir;
canlı veri korunur. Önizlemelere ayrı veritabanı vermek için Vercel › Storage › Neon'da önizleme dalları açılır ve
Preview ortamına `MIGRATE_ON_PREVIEW=1` eklenir; o zaman her önizleme kendi dalına migration uygular.

**`claude/**` dallarında önizleme yok (26 Eki 2026).** Vercel Hobby planı ekip başına 24 saatte en çok 100 dağıtım
açar (`api-deployments-free-per-day`); 26 Ekim akşamı bu sınır doldu ve canlı dağıtımlar da reddedildi. Bu yüzden
`vercel.json` `git.deploymentEnabled` ile `claude/**` dallarına önizleme açılmaz; yalnız `main` (canlı) dağıtılır.
Bu dallardaki değişiklik yerelde `npm run build` ile derlenir. Bir dalda önizleme gerekirse dal `claude/` dışında bir
adla açılır (ör. `onizleme/<konu>`); `vercel.json`'daki satır **çıkarılmaz**: dal birleşince kural main'den de
düşer, her `claude/**` push'u yine önizleme açar ve günlük sınır sessizce dolar (`tests/predeploy.test.ts` kuralı
tutar).

## 4. Ortam değişkenleri

Proje → **Settings → Environment Variables**. Önizlemeler canlının veritabanını kullandığı sürece (§ 3) gizli değerler
**yalnız Production**'a eklenir: `AUTH_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET`, `KARAOKE_SYNC_SECRET`,
`LAFPOS_SYNC_SECRET`, `MODPOS_API_KEY`, `PARASUT_*`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`,
`CASH_REPORT_RECIPIENTS`. Önizlemeye giriş yapılamaz (`AUTH_SECRET` yok); bu bilerek böyle:

- Aynı `AUTH_SECRET` önizlemede olsaydı incelenmemiş dal kodu canlının verisiyle gerçek oturum açardı.
- Farklı bir `AUTH_SECRET`'la önizleme ortak veritabanındaki şifreli değerleri okuyamaz: bildirim anahtarını (VAPID)
  "okunamıyor" diye yenisiyle değiştirir, canlının cihaz bildirimleri durur; iki adımlı doğrulama da açılmaz.

Önizlemelere kendi Neon dalı verilince (§ 3) `AUTH_SECRET` önizlemeye `MIGRATE_ON_PREVIEW=1` ile birlikte eklenir.
`ADMIN_EMAIL` ve `ADMIN_NAME` önizlemede kullanılmaz (yalnız ilk kurulumda, boş veritabanında okunur).

| Değişken | Değer |
|----------|-------|
| `AUTH_SECRET` | En az 32 karakterlik rastgele değer: `openssl rand -base64 48` |
| `ADMIN_EMAIL` | İlk yönetici hesabının e-postası |
| `ADMIN_PASSWORD` | İlk yönetici parolası (en az 8 karakter; ilk girişten sonra **Hesabım** sayfasından değiştirin) |
| `ADMIN_NAME` | Görünecek ad (ör. Okan) |
| `CRON_SECRET` | Günlük işlerin anahtarı (Paraşüt eşitlemesi + sabah e-postası): `openssl rand -hex 32`. Yoksa iki iş de çalışmaz; Paraşüt ekranı "CRON_SECRET eksik", zil ve Genel bakış "Günlük işler kapalı" der. Aynı değer GitHub deposuna da **Actions sırrı** olarak girilir (Settings › Secrets and variables › Actions › `CRON_SECRET`): saatlik kontrol listesi hatırlatmalarını o tetikler ([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md) § 6) |
| `RESEND_API_KEY` | (isteğe bağlı) E-posta gönderimi: sabah e-postası, davet ve parola sıfırlama. Ayrıntı [BILDIRIMLER.md](BILDIRIMLER.md) |
| `EMAIL_FROM` | (isteğe bağlı) Gönderen, ör. `L'Affogato Panel <bildirim@laffogato.net>`; panelden de değiştirilir |
| `APP_URL` | (isteğe bağlı) E-posta ve davet bağlantılarındaki adres; yoksa `https://ladmin.laffogato.net` |
| `KARAOKE_SYNC_SECRET` | (isteğe bağlı) laffogato.net ile karaoke **ve menü** bağlantısı: `openssl rand -base64 48`; **sitedeki değerle aynı** olmalı. Yoksa bağlantı kapalı: hızlı sayaç çalışır, ürünler yalnız panelde. Ayrıntı [KARAOKE.md](KARAOKE.md), [SITE-MENU.md](SITE-MENU.md) (bağlı ürünün fiyatı ve Satışta / Tükendi durumu iki yerde aynı) |
| `LAFFOGATO_URL` | (isteğe bağlı) Sitenin adresi (karaoke ve menü); yoksa `https://laffogato.net` |
| `LAFPOS_SYNC_SECRET` | (isteğe bağlı) LafPOS (kafenin kasası) bağlantısı: gün sonunu iter, ürün maliyetlerini, kasa zincirini (devir, gider kategorileri), ModPOS dönemini (şubenin geçiş gününden önceki ModPOS günleri ve ürün listesi; LafPOS Uzaktan'daki ModPOS günleri buradan gelir) ve personel bağlantısının listesini okur. `openssl rand -base64 48`; **LafPOS'taki `LAFMALIYET_SYNC_SECRET` ile aynı**, sitenin anahtarından (`KARAOKE_SYNC_SECRET`) ve sitenin kendi `LAFPOS_SYNC_SECRET`'ından ayrı; `KARAOKE_SYNC_SECRET`'la aynıysa bağlantı açılmaz. Yoksa altı uç da 503 döner: `POST /api/pos/gun`, `GET /api/panel/pos/urunler`, `GET /api/panel/pos/modpos-gunler`, `GET /api/panel/pos/devir`, `GET /api/panel/pos/gider-kategorileri` ve `GET /api/panel/pos/personel`. Açma sırası ve geçiş günü [LAFPOS.md](LAFPOS.md) › Açılış sırası |
| `MODPOS_API_KEY` | (isteğe bağlı, **yalnız Production**) ModPOS'un (Gafdigi) Kasa Föyü API anahtarı (`sk_…`): panel her sabah dünün kasa föyünü çeker, yönetici Kasa'da raporla yan yana görür. Günde 2 istek hakkı var; anahtara IP kısıtı konmamalı (Vercel'in sabit IP'si yok). Yoksa bağlantı kapalı, hiçbir istek gitmez ([MODPOS-API.md](MODPOS-API.md)) |
| `MODPOS_API_KEY_<ŞUBE>` | (isteğe bağlı, **yalnız Production**) Tuzla'dan başka ModPOS şubesinin anahtarı: `MODPOS_API_KEY_MARINA`. Şubenin anahtarı yoksa o şube çekilmez (Tuzla'nınkine düşülmez); başka şubeninkiyle aynı anahtar kullanılmaz ([MODPOS-API.md › Şubeler](MODPOS-API.md#1a-şubeler-16-kasım-2026)) |
| `MODPOS_SUBELER` | (isteğe bağlı) ModPOS'taki şube adını panelin şubesine bağlar (`Sahil Şube=marina; Merkez=tuzla`): tek anahtar birden çok şubenin kasasını verir ve ad panelin şube adını içermezse |
| `MODPOS_SYNC_FROM` | (isteğe bağlı) Geçmişin ilk günü (`YYYY-MM-DD`): geçmiş föyler dünden bu güne doğru, yeniden eskiye çekilir, öncesi çekilmez; yoksa `2026-07-01`. Canlıda `2026-11-01` |
| `MODPOS_API_URL` | (isteğe bağlı) Kasa föyü ucunun adresi; yoksa belgedeki `https://api.gafdigi.com/api/v2/external/raporlar/kasa-foyu` |
| `CASH_REPORT_RECIPIENTS` | (isteğe bağlı, yalnız Production) Kasa raporunun alıcıları, yönetici panelden hiç kaydetmediyse: virgülle ayrılmış e-postalar. Panelde kaydedilen liste her zaman önce gelir ([KASA-RAPORU.md](KASA-RAPORU.md)) |
| `MIGRATE_ON_PREVIEW` | (yalnız Preview, isteğe bağlı) `1`: önizlemelerin **kendi** veritabanı varsa (Neon önizleme dalları) önizleme derlemesi de migration uygular. Önizleme canlının veritabanını kullanıyorsa tanımlamayın (§ 3) |
| `ALLOW_BRANCH_PRODUCTION` | (yalnız acil durumda, tek derleme için) `1`: `main` dışındaki bir dalın Production derlemesine bilerek izin verir; derleme günlüğüne uyarı yazılır. Proje ayarlarına **eklemeyin**: `vercel deploy --prod --build-env ALLOW_BRANCH_PRODUCTION=1` ile yalnız o derlemeye verilir (§ 7, "Production yalnız main'den") |
| `SEED_ON_EMPTY` | (yalnız bilerek, tek derleme için) `1`: veritabanı boşsa derleme başlangıç verisini (maaşlar, kira, faturalar, satışlar) canlıda da yükler, günlüğe uyarı yazılır; `0`: yerelde de yüklemez. Yoksa canlı, önizleme ve bu bilgisayarda olmayan veritabanı yüklemez, yerel yükler (§ 5, "Boş veritabanı"). Proje ayarlarına **eklemeyin**: `vercel deploy --prod --build-env SEED_ON_EMPTY=1` ile yalnız o derlemeye verilir; ayarda kalırsa yanlış adrese bağlanan bir derleme kişisel veriyi oraya yazar |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | (isteğe bağlı) Web Push anahtarları; yoksa ilk kullanımda üretilip veritabanında şifreli saklanır |
| `ANTHROPIC_API_KEY` | (isteğe bağlı, **yalnız Production**) Fotoğraftan okuma (Claude): kasa raporunda Z raporu, banka POS fişi ve kasadan çıkan fişler. Yoksa fotoğraf yine eklenir, rakamlar elle yazılır; LafPOS gününün gün sonu fotoğrafı (Pavo'nun detaylı Z'si) anahtarsız da kodla (OCR) okunur, öteki fotoğraflar okunmaz. Aynı anahtar Vardiya'daki **Yazarak doldur**u da çalıştırır ([VARDIYA.md](VARDIYA.md) › Yazarak doldurma); yoksa kutular elle doldurulur. Ayrıntı [FOTOGRAF.md](FOTOGRAF.md) |
| `BLOB_READ_WRITE_TOKEN` | (isteğe bağlı, **yalnız Production**) Fotoğraf deposu: Vercel › Storage › Blob, erişim **Private**, bölge Frankfurt (fra1). Depoyu projeye bağlayınca kendiliğinden eklenir (yeni bağlantı anahtar yerine `BLOB_STORE_ID` verirse o da yeter). Yoksa fotoğraf düğmeleri görünmez ([FOTOGRAF.md](FOTOGRAF.md)) |
| `PHOTO_DIR` | (yalnız yerel, isteğe bağlı) Fotoğrafların yerel klasörü; yoksa `.data/photos` |
| `DB_QUOTA_MB` | (isteğe bağlı) Veritabanının kotası, MB: sabah işi boyutu buna göre ölçer, %70 ve %90'da zil ve e-postayla uyarır. Yoksa 512 (Neon ücretsiz planı); plan yükseltilince yeni kotayı yazın (ör. 10 GB için `10240`). [YEDEK.md](YEDEK.md) § 14 |
| `BACKUP_DIR` | (yalnız yerel, isteğe bağlı) Otomatik haftalık yedeklerin yerel klasörü; yoksa `.data/backups`. Canlıda yedekler fotoğraflarla aynı özel Blob deposunda (`yedek/haftalik/`); depo bağlı değilse otomatik yedek kapalı ([YEDEK.md](YEDEK.md) § 13) |
| `MCP_DISABLED` | (isteğe bağlı) `1` ise Claude bağlantısı kapalı (bütün uçlar 404, verilmiş anahtarlar çalışmaz). Önizlemelerde zaten kapalı ([CLAUDE-BAGLANTISI.md](CLAUDE-BAGLANTISI.md)) |
| `MCP_ALLOW_LOCALHOST` | (isteğe bağlı) `1` ise Claude Code / MCP Inspector'ın localhost dönüş adresine canlıda da izin verilir; varsayılan kapalı |
| `CSP_ENFORCE` | (isteğe bağlı) `1`: Content-Security-Policy'nin kaynak politikası **uygulanır**; yoksa Report-Only (yalnız raporlar). Derlemede okunur: değiştirince yeniden deploy. Ne zaman açılacağı § 6 › Güvenlik başlıkları |
| `DATABASE_SSL` | (isteğe bağlı, yalnız acil durumda) `require`: veritabanı sunucusunun sertifikası doğrulanmaz. Varsayılan doğrulamalı bağlantıdır (`verify-full`; Neon'un sertifikası Let's Encrypt'ten, Node tanır): şifreli ama sertifikası denetlenmeyen bağlantıda araya giren biri kendi sertifikasıyla bütün veriyi okuyabilirdi. Canlı derleme önce havuzlu adresi, sonra migration için doğrudan adresi doğrulamalı açar; biri açılmazsa derleme migration'dan önce durur, ne veritabanı ne yayındaki sürüm değişir. Neon sertifikasını değiştirdiği için derleme durursa geçici olarak `require` yazılır |

`DATABASE_URL` / `DATABASE_URL_UNPOOLED` Neon entegrasyonundan gelir. Paraşüt değişkenleri (`PARASUT_*`; istemci
bilgileri ve firma numarası panelden de girilebilir) için [PARASUT.md](PARASUT.md) § 1.

İki günlük iş `vercel.json`'da tanımlı (Vercel Cron, Türkiye saatiyle): `/api/cron/parasut` 07:00–08:00 arasında
Paraşüt'ü eşitler, `/api/cron/gunluk` 08:00–09:00 arasında sabah e-postasını gönderir (anahtar varsa önce dünün ModPOS kasa föyünü çeker;
[MODPOS-API.md](MODPOS-API.md)). Vercel → Settings → Cron Jobs
ekranında görünür, **Run** ile elle çalıştırılır. Her çalışma panelde **Ayarlar › Günlük işler**'de görünür; çalışmayan
ya da hata veren iş zilde, Genel bakış'ta ve e-postayla bildirilir ([BILDIRIMLER.md](BILDIRIMLER.md) › Sistem
uyarıları; iki iş birden durursa diye isteğe bağlı dış izleme: `/api/health?isler=1`).

## 5. Deploy

**Deploy** düğmesine basın. Yeni (boş) bir veritabanında build günlüğünde şunları görmelisiniz:

```
✓ 21 migration uygulandı (2,4 sn)
✓ Veritabanı şeması güncel (21 migration)
! Veritabanı boş; başlangıç verisi yüklenmedi: canlı derleme (VERCEL_ENV=production). Panel boş açılır: …
✓ Yönetici hesabı oluşturuldu: …
✓ Kontrol listeleri eklendi: Açılış, Kapanış
✓ Şubeler eklendi: Marina, laffogato.net
```

Dolu veritabanında (sonraki her yayın) `✓ Veritabanında veri var, seed atlandı` yazar.

**Boş veritabanı ve başlangıç verisi (26 Kasım 2026).** Canlı derleme boş bir veritabanına başlangıç verisini
(`tests/fixtures/baslangic/veri.json`: maaşlar, kira, faturalar, satışlar; § 1) **kendiliğinden yüklemez**. Önceden
"veritabanı boşsa yükle" kuralı vardı: Vercel'e yanlış ya da yeni açılmış boş bir veritabanının adresi verilse ilk
derleme kişisel veriyi oraya yazardı. Şimdi boş veritabanında derleme migration'ları uygular, ilk yöneticiyi
(`ADMIN_*`), şube kütüğünü ve hazır kontrol listelerini yazar ve şu uyarıyla **sürer** (derleme düşmez):
`! Veritabanı boş; başlangıç verisi yüklenmedi: canlı derleme (VERCEL_ENV=production). Panel boş açılır: veri yedekten
(npm run db:restore) gelir ya da panelden girilir. …`. Yeni canlı veritabanının verisi yedekten gelir
([YEDEK.md](YEDEK.md) § 8). Karar `scripts/predeploy-guard.ts` › `emptySeedSkipReason`'da (deneme
`tests/predeploy.test.ts`, betiğin kendisiyle gerçek Postgres'te `tests/predeploy-db.test.ts`):

| Derleme | Boş veritabanına başlangıç verisi |
|---------|-----------------------------------|
| Canlı (`VERCEL_ENV=production` ya da `NODE_ENV=production`) | Yüklenmez, uyarı |
| Vercel önizlemesi (`MIGRATE_ON_PREVIEW=1` ile kendi veritabanı varsa; § 3) | Yüklenmez, uyarı |
| Bu bilgisayarda olmayan veritabanı (Neon, uzak sunucu; `.env.local` canlının adresini gösterebilir) | Yüklenmez, uyarı |
| Yerel geliştirme (bu bilgisayardaki Postgres, canlı değil) | Yüklenir (önceki gibi) |
| `SEED_ON_EMPTY=1` (her yerde, canlıda da) | Yüklenir; canlıda ve uzak veritabanında günlüğe `! SEED_ON_EMPTY=1: …` uyarısı |
| `SEED_ON_EMPTY=0` (her yerde) | Yüklenmez |

Bilerek yüklemek (deneme amaçlı ayrı bir canlı kopya) tek derleme için yapılır:
`vercel deploy --prod --build-env SEED_ON_EMPTY=1`; değişken proje ayarlarına eklenmez (§ 4). `npm run db:seed` ve
`npm run db:reset` açıkça çağrıldıkları için bu kurala bağlı değildir (hedefi `Hedef: …` diye yazar; uzak
veritabanında `db:reset` sunucu adıyla onay ister, § 7); `npm run test:db` de geçici test veritabanını her zaman
doldurur. Dolu veritabanında hiçbir şey değişmez: veri varsa (hammadde tablosu boş değilse) tohum atlanır, yalnız
eksik yönetici, şube ve hazır listeler bir kez eklenir.

**Kodla okuma (OCR):** LafPOS gününün gün sonu fotoğrafı yapay zekâ yokken panelin içinde okunur (tesseract.js). Dil
verisi (`@tesseract.js-data/tur`) ve çekirdek (`tesseract.js-core`, WebAssembly) paketle gelir: ortam değişkeni yok, ağ
isteği yok. `next.config.ts` bunları fotoğrafı okuyan iki yola (`/api/foto`, `/api/foto/[id]/oku`) ekler
(`outputFileTracingIncludes`, `serverExternalPackages`). Denetim: yerelde `npx next build`, sonra
`.next/server/app/api/foto/route.js.nft.json` içinde `tur.traineddata.gz` ve `tesseract-core-*lstm.wasm` geçmeli; canlıda
ilk kodla okumada sunucu günlüğünde "[foto] kodla okuma" hatası yoksa çalışıyor ([FOTOGRAF.md](FOTOGRAF.md) › LafPOS
gününün fotoğrafı).

Önizleme derlemesinde bunların yerine `! Önizleme dağıtımı …: migration ve seed atlandı` yazar. Bekçiyi içeren bir
commit'te `main` dışındaki bir dal Production'a derlenirse derleme `✗ Production derlemesi yalnız main dalından yapılır;
bu derlemenin dalı: …` diye durur (§ 7; bekçiden önce açılmış eski dalların dağıtımları durmaz, onlar yeniden
derlenmez). Sonra
`https://<proje>.vercel.app/giris` adresinden giriş yapın. Sağlık kontrolü: `/api/health` (günlük işlerle birlikte:
`/api/health?isler=1`).

## 6. Alan adı (ladmin.laffogato.net)

Panel `ladmin.laffogato.net` alt alan adında çalışıyor; kafenin sitesi `laffogato.net` / `www.laffogato.net` ayrı
`laffogato` projesinde kalıyor. `laffogato.net`'in ad sunucuları Vercel'de olduğu için ek DNS kaydı gerekmedi:
alan adı `lafmaliyet` projesine eklendi (`vercel domains add ladmin.laffogato.net`), sertifika otomatik çıktı.
`/` adresi panele (giriş yapılmamışsa giriş sayfasına) yönlendirir; QR menü `ladmin.laffogato.net/menu`.

Panel arama motorlarında görünmez: her yanıtta `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`
başlığı ve sayfalarda `noindex` etiketi vardır. `robots.txt` taramayı bilerek açık bırakır: her şeyi engelleseydi
Google sayfaları açamaz, noindex'i göremez ve başka yerden bağlantı alan adresi "açıklama yok" diye listeleyebilirdi.
Adres daha önce dizine girdiyse Search Console › Kaldırmalar'dan hemen gizlenir; noindex kalıcı olarak çıkarır. `lafmaliyet.vercel.app` adresi sayfalar için `ladmin.laffogato.net`'e
yönlenir (`/api` hariç; zamanlanmış işler yönlendirme izlemez).

### Güvenlik başlıkları

`next.config.ts` her yanıta `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`Permissions-Policy` (panelde mikrofon ve kamera yalnız bu site; aşağıda) ve `Strict-Transport-Security` ekler. **Content-Security-Policy**
(26 Kasım 2026, güvenlik notu; kurallar `src/lib/csp.ts`, deneme `tests/csp.test.ts`) yalnız sayfalara gider (API
yanıtları kendi başlığını taşır: fotoğrafın `default-src 'none'; sandbox`'ı ezilmez, PDF açılır):

- **Uygulanan çekirdek** (her zaman): `frame-ancestors 'none'` (panel başka sitede çerçeveye alınamaz),
  `base-uri 'self'` (sayfaya sokulan `<base>` bağlantıları kaçıramaz), `form-action 'self'` + Paraşüt'ün kimlik
  sunucusu (`https://id.parasut.com`, `https://*.parasut.com`, ortamda verilmişse `PARASUT_ISSUER` /
  `PARASUT_AUTHORIZE_URL` kökeni): "Paraşüt hesabını bağla" formu POST'tan sonra Paraşüt'ün onay ekranına 303 ile
  gider ve tarayıcılar form hedefini yönlendirmede de denetler. Bu üçü hiçbir kaynak yüklemesine dokunmaz.
- **Tam politika** (kaynaklar): her şey kendi kökeninden; `script-src 'self' 'unsafe-inline'`, `style-src 'self'
  'unsafe-inline'`, `img-src 'self' blob: data:`, `connect-src 'self'`, `frame-src 'self' blob:` (fatura belgesinin
  PDF önizlemesi), `worker-src 'self' blob:` (servis çalışanı `/sw.js`), `object-src 'none'`. `CSP_ENFORCE=1`
  değilken **Report-Only** gider: tarayıcı hiçbir şeyi engellemez, engelleyeceği her kaynağı `/api/csp-rapor`'a
  bildirir (oturumsuz, hep 204, dakikada en çok 30 satır; adresler köken + yola indirilir). Vercel › Logs'ta `[csp]`
  ile aranır: `[csp] report img-src https://… · /panel/kasa`. Chrome raporu Reporting API ile (`report-to`,
  `Reporting-Endpoints`; yalnız HTTPS'te, birkaç saniye içinde) gönderir, Firefox ve Safari `report-uri` ile; uç iki
  biçimi de okur. Yerelde `http://localhost`'ta Chrome `Reporting-Endpoints`'i yok sayar, `report-to` varken
  `report-uri`'ye de göndermez: yerel denetimde ihlal tarayıcı konsolunda görülür (sunucu günlüğünde değil).
- **Paketlere dair iki kural** (CSP'de `'unsafe-eval'` yok): tarayıcıya giden kod `eval` / `new Function` kullanmaz.
  zod 4 nesne şemalarını hızlandırmak için ilk ayrıştırmada `Function("")` dener; `src/instrumentation-client.ts`
  React canlanmadan önce zod'u `jitless` yapar, deneme hiç yapılmaz. Tarayıcı bileşeni (`"use client"`) `node:crypto`'ya
  ulaşan bir modülü içe aktarmaz: paketleyici sayfaya crypto-browserify (~0,5 MB) koyar, onunla gelen `Function(...)`
  denemesi de ihlal ürettirir (sınır `tests/csp.test.ts`; ör. LafPOS anahtarının uzunluğu
  `src/lib/lafpos/secret-rules.ts`'te, imza denetimi `request.ts`'te).
- **Neden nonce yok:** panel `cacheComponents` ve `partialPrefetching` ile önceden çizilmiş kabuklar sunar; Next'in CSP
  kılavuzuna göre nonce her sayfayı her istekte çizmeye zorlar ve önceden çizilmiş kabukla (PPR) bağdaşmaz. Next'in
  sayfaya gömdüğü satır içi betikler (RSC verisi) ve koyu tema betiği bu yüzden `'unsafe-inline'` ile çalışır; motion,
  Recharts ve Sonner satır içi stil yazar. Kazanç yine de: başka kökenden betik, istek, görsel, çerçeve ve eklenti
  yüklenemez, sızdırılan veri başka bir sunucuya `fetch` ya da görselle gönderilemez.
- **Karar: tam politika Report-Only ile başlar.** Panel her gün kasa raporu, sayım ve faturalar için kullanılıyor;
  yerelde denenemeyen yollar var (personelin telefonundaki Safari, kamerayla çekilen fotoğrafın küçültülmesi, gerçek
  push servisiyle cihaz bildirimi, Safari/Firefox'un PDF önizlemesi, başka dallarda süren işler: belge tarayıcı işçi
  ya da WebAssembly isteyebilir). Uygulanan bir CSP'de bunlardan biri sessizce bozulur ve sahibin fark etmesi günler
  sürebilir; Report-Only'de hiçbir şey bozulmaz, aynı ihlaller günlüğe düşer. Çekirdek ise hiçbir yüklemeye
  dokunmadığı için baştan uygulanır.
- **Yerel denetim** (26 Kasım 2026, `next build` + `next start`, Playwright'la Chromium, yönetici oturumu): giriş,
  davet, Claude bağlantısı, 404, QR menünün yönetici önizlemesi ve panelin 50 ekranı (şube, ürün ve kontrol listesi
  sayfaları dahil); koyu tema (satır içi betik), Recharts grafiği, profil menüsündeki gölgelendirici (WebGL), servis
  çalışanının kaydı ve canlı akış, fotoğraf yükleme ve `/api/foto` görseli (kendi `sandbox` politikası yerinde),
  `blob:` / `data:` görsel ve `blob:` çerçeve, fatura PDF'inin `blob:` çerçevede Chromium PDF görüntüleyicisiyle açılması
  (uygulanan tam politikayla da), "Paraşüt hesabını bağla" formunun Paraşüt'e 303 ile gitmesi (form hedefi). İlk
  turda iki ihlal çıktı, ikisi de düzeltildi (yukarıdaki iki kural): her sayfada zod'un eval denemesi, Şube
  ayarları'nda crypto-browserify. Son turda ihlal yok; kasıtlı ihlal (başka kökenden görsel) HTTPS'te Chrome'dan
  `/api/csp-rapor`'a ulaşıp `[csp] report img-src https://iz.example.com/p.gif · /giris` olarak günlüğe düştü
  (sorgu dizgesi atıldı). `CSP_ENFORCE=1` derlemesiyle de giriş, 12 ekran (grafik, şube ayarları, Paraşüt dahil),
  koyu tema, servis çalışanı, fotoğraf ve Paraşüt formu çalıştı; kasıtlı görsel engellendi.
- **Uygulamaya geçiş:** yayından sonra bir hafta Vercel › Logs'ta `[csp]` aranır. Beklenmeyen satır yoksa (tarayıcı
  eklentilerinin `chrome-extension://` satırları sayılmaz) Vercel'de `CSP_ENFORCE=1` eklenip yeniden deploy edilir.
  Bir şey bozulursa değişkeni silip yeniden deploy etmek geri alır. Yeni bir dış kaynak (CDN, analiz, harita)
  eklenecekse önce `src/lib/csp.ts`'e yazılır.


**Kamera izni** (26 Kasım 2026, güvenlik notu): `Permissions-Policy` her yanıtta `camera=(), microphone=()` ile
kapalıdır; yalnız `/panel` sayfalarında `camera=(self), microphone=(self)` olur (`next.config.ts`
`PANEL_PERMISSIONS`, deneme `tests/ses-cikisi.test.ts`). **Neden:** belge tarayıcının canlı vizörü
([FOTOGRAF.md](FOTOGRAF.md) › Canlı vizör) kâğıdın kenarlarını kamerada canlı gösterip sabit tutulunca kendiliğinden
çeker; bunun için `getUserMedia` gerekir, `camera=()` onu tarayıcıda engeller. **Kapsam:** `self` yalnız panelin
kendi kökeni demek; başka kökenden bir çerçeve (zaten `frame-ancestors 'none'` ve `X-Frame-Options: DENY` ile yok) ya
da panelin dışındaki sayfalar (giriş, davet, QR menü) kamerayı açamaz. Kamera yalnız kullanıcı **Fotoğraf çek**'e
bastığında açılır; tarayıcı izin sorar ve açıkken kendi göstergesini gösterir. Görüntü telefonda işlenir, hiçbir
kare sunucuya gitmez (yalnız kullanıcının **Kullan** dediği fotoğraf eskisi gibi yüklenir); vizör kapanınca ya da
sekme gizlenince akış durur. İzin verilmezse telefonun kendi kamerası (`<input capture>`, sayfaya izin gerektirmez)
kullanılır. CSP ile uyum: video `srcObject` ile oynar (`media-src` devreye girmez), vizörün Worker'ı kendi kökeninden
derlenmiş dosyadır (`worker-src 'self' blob:`); tam politika uygulanınca da değişiklik gerekmez. Geri almak:
`PANEL_PERMISSIONS`'ta `camera=()` (vizör kendiliğinden eski yola döner).

## 6a. Kullanıcılar ve iki adımlı doğrulama

- **Ayarlar › Kullanıcılar & roller** (`/panel/kullanicilar`; Ayarlar sayfasının en üstündeki kart da oraya gider):
  **Kullanıcı ekle** → ad, giriş e-postası, rol (Yönetici / Personel) ve parola adımı:
  - **Parolayı ben belirleyeyim:** hazır gelen okunur güçlü parola (12 karakter, karışan harf yok; "Güçlü parola
    oluştur" ile yenisi), göster/gizle ve kopyala.
  - **Davet bağlantısı gönder:** kişi tek kullanımlık bağlantıdan (`/davet?t=…`, **72 saat**) parolasını kendisi
    belirler. O zamana kadar hesabın parola alanında hiçbir parolayla eşleşmeyen bir işaret durur, listede
    **Davet bekliyor** yazar; "Bağlantıyı yeniden oluştur / gönder" eskisini geçersiz yapıp yenisini verir.
- Ekledikten sonra **Giriş bilgileri** penceresi açılır: panel adresi (`APP_URL` + `/giris`), e-posta, parola ya da
  bağlantı. **Kopyala** hepsini tek Türkçe mesaj yapar, **WhatsApp'ta paylaş** `wa.me` ile açar, **E-postayla gönder**
  Resend ile hoş geldin e-postası yollar (gönderen: Ödemeler & hatırlatıcılar › Gönderim ayarları → `EMAIL_FROM` →
  varsayılan). `RESEND_API_KEY` yoksa e-posta düğmesi kapalıdır, kopyala ve WhatsApp çalışır. Parola ve bağlantı bu
  pencereden sonra bir daha gösterilmez. Parola e-postası 15 dakika içinde gönderilebilir: düğme parolayı değil
  kaydederken verilen mühürlü kopyayı yollar (`src/server/auth/access-handle.ts`; eylem parola tahmini için
  kullanılamasın).
- **Parola kuralı** (her yerde aynı: Hesabım, kullanıcı ekleme / düzenleme, davet ve sıfırlama;
  `src/lib/password-rules.ts`): en az 8 karakter; yaygın parolalar (`12345678`, `parola123`, `qwerty…`), kafenin adı
  (`laffogato`), e-posta adresi ve düz diziler kabul edilmez. Yazarken alanın altında söylenir. Var olan parolalar
  etkilenmez.
- Kullanıcıyı düzenle › **Güvenlik:** parola sıfırlama bağlantısı (24 saat, kişinin mevcut parolası bağlantı
  kullanılana kadar çalışır), kilit açma, iki adımlı doğrulamayı sıfırlama, bütün oturumları kapatma. Ayrıca pasif
  yapma ve (kendiniz ve son aktif yönetici hariç) kalıcı silme. Listedeki aktif / pasif anahtarı yalnız erişimi
  değiştirir; ad, e-posta ve rol olduğu gibi kalır (liste açıkken başka sekmede yapılan değişiklik geri yazılmaz, bu
  arada yönetici yapılan kişi için parola sorulur). Düzenleme penceresi açıldığından beri kişi başka bir yerde
  değiştiyse Kaydet reddedilir ("Bu kullanıcı bu arada değişti"), liste yenilenir; pencereyi kapatıp yeniden açın.
  **Kendi satırınızda** e-posta, parola, iki adımlı sıfırlama ve sıfırlama bağlantısı yoktur: bunlar Hesabım'da mevcut
  parolayla değişir (oradaki parola onayı buradan atlanamasın). Ortak cihazda işiniz bitince çıkış yapın;
  unuttuysanız başka bir cihazdan Hesabım › Oturumlar › Diğer cihazlardaki oturumları kapat.
- **Çıkış** oturumu sunucuda da kapatır: oturum çerezi rastgele bir kimlik taşır, çıkışta bu kimlik
  `revoked_sessions` tablosuna yazılır. Çerezin bir kopyası alınmış olsa da (ortak bilgisayarda eklenti, kaydedilmiş
  HAR) çıkıştan sonra geçmez; kişinin öteki cihazlarındaki oturumlar açık kalır. Aynı tarayıcıda yerine yeni oturum
  açılınca (ad değişikliği, sıradaki kişinin girişi) eskisi de kapanır. Satır çerezin süresi (30 gün) dolunca
  gereksizleşir, sonraki çıkışta silinir.
  Bu sürümden önce açılmış oturumlarda kimlik yoktur: onlarda çıkış eskisi gibi yalnız çerezi siler, kendi süreleriyle
  (en geç 30 günde) düşerler; yayından sonra kimse oturumdan düşmez.
- **Oturum düşünce** (parola değişti, hesap pasif, oturumlar kapatıldı, çıkış yapıldı) sunucu giriş sayfasına
  `?oturum=bitti&s=…` ile gönderir; `s` reddedilen çerezin kısa özetidir (sha256'nın ilk 16 hanesi). Proxy çerezi yalnız
  özet tutarsa siler: yeniden girişten sonra Geri düğmesi ya da önbellekteki eski yönlendirme yeni oturumu, başka bir
  siteden gelen `?oturum=bitti` bağlantısı geçerli oturumu silemez (geçerli oturumla açılan giriş sayfası ana sayfaya
  gider). Açık panel sekmesi oturumun düştüğünü canlı uçtan (`/api/canli` 401) anlar: canlı veriyi (hatırlatıcılar,
  karaoke, siparişler) bellekten siler ve sayfayı sunucudan yeniden ister, sunucu giriş sayfasına gönderir; panelden
  çıkınca çalan alarm (sürekli sesli hatırlatma, karaoke) da susar. Ortak tablette sıradaki kişi önceki kişinin
  hatırlatıcısını ya da karaoke tutarını görmez; yeniden giren kişinin canlı verisi baştan istenir.
- **Parolayla onay (yönetici işlemleri):** yönetici gücü veren ya da bir yönetici hesabına dokunan işlemler, işlemi
  yapan yöneticinin **kendi parolasını** ister: yönetici ekleme (parolalı ya da davetli, aktif ya da pasif),
  personeli yönetici yapma ve yöneticiyi personel yapma; bir yöneticiyi pasif ya da yeniden aktif yapma; bir
  yöneticinin giriş e-postasını ya da parolasını değiştirme (davetliye parola verme dahil); yöneticiye parola
  sıfırlama / davet bağlantısı; yöneticinin iki adımlı doğrulamasını sıfırlama; yönetici silme. Açık kalmış bir
  yönetici oturumuyla yeni yönetici açılamaz, başka bir yöneticinin hesabı ele geçirilemez. Personeli yönetici
  yapınca bekleyen davet / sıfırlama bağlantısı iptal olur (personelken parola sorulmadan oluşturulmuştu; yöneticiye
  yenisi parolayla oluşturulur). Personelin parolası ve e-postası ise parola sorulmadan değişir: birini yönetici
  yapmadan önce kendi parolasıyla girebildiğinden emin olun. Personel işleri, ad değişikliği, kilit açma ve "Tüm
  oturumlarını kapat" sormaz (savunma araçları hızlı kalır). Kural tek yerde
  (`src/lib/step-up.ts`); sunucu her eylemde veritabanındaki önceki hâlle yeniden denetler, parolayı ilk yazımdan
  önce ister. Sınır Hesabım'la ortaktır: kişi başına 15 dakikada 5 hatalı parola (Hesabım ve Kullanıcılar birlikte
  sayılır); hatalar işlem geçmişine "Hatalı parola onayı (Kullanıcılar)" diye, neyin denendiğiyle yazılır. Ortak
  bilgisayarda tarayıcıya parolanızı kaydettirmeyin; kaydedilmiş parola bu onayı da doldurur. Personel hesabı açmak
  bilerek parola istemez (işlem geçmişine yazılır).
- **Giriş kilidi:** 5 hatalı denemede hesap 15 dakika kilitlenir (parola ve iki adımlı kod birlikte sayılır).
  Her deneme doğrulanmadan **önce** sayılır: aynı anda gönderilen yüzlerce istek de 5'i aşamaz. Kilit işlem
  geçmişine "Hesap kilitlendi" diye yazılır. Daha önce bu hesapla giriş yapılmış tarayıcı bu kilide takılmaz
  (başkası adresinizi bilip hesabı kilitleyerek sizi dışarıda bırakamasın); o tarayıcının kendi 10 deneme hakkı
  vardır; o kilit dolunca Kullanıcılar'da kişinin satırında **Bir cihazda kilitli** yazar, **Kilidi aç** hesabın
  kilidiyle birlikte cihazların kilitlerini de açar. Bu "bilinen cihaz" kaydı kişinin oturum sürümüne bağlıdır: parola
  değişince, iki adımlı açılıp kapanınca ya da oturumlar kapatılınca öteki tarayıcılar için geçmez, bir sonraki
  başarılı girişte yeniden tanınır. Önceki sürümün cihaz kaydı (oturum sürümsüz) 25 Kasım 2026'ya kadar tanınır
  (`LEGACY_DEVICE_UNTIL`): o zamana kadar herkes en az bir kez girer (oturum en çok 30 gün) ve kayıt yeni biçimde
  yazılır. Bir IP adresinden 15 dakikada en çok 20 deneme yapılabilir (başarılı giriş sayılmaz).
- **Çerezler:** üretimde `__Host-laf_session` (oturum, 30 gün), `__Host-laf_2fa` (kod adımı, 10 dakika) ve
  `__Host-laf_cihaz` (bilinen cihaz, 1 yıl; yeni cihaz uyarısı da buna bakar): `__Host-` öneki sayesinde laffogato.net ya da başka bir alt alan adı bu
  çerezleri yerine koyamaz. Önceki sürümün öneksiz çerezleri (`laf_session`…) bir süre okunur, yenisi yazılınca
  silinir; kimsenin oturumu düşmez.
- **Fatura belgesi yükleme** (`POST /api/faturalar/<id>/belge`) yalnız panelin kendi sayfasından gelen isteği kabul
  eder (Origin = Host).
- **Giriş sayfası › Parolamı unuttum:** e-posta istenir, yanıt her durumda aynıdır ("kayıtlıysa bağlantı
  gönderildi"). Resend kuruluysa 2 saatlik sıfırlama bağlantısı gider; kurulu değilse kişiye yöneticisine
  başvurması söylenir. Sınırlar: aynı IP'den 15 dakikada 10, aynı e-postaya saatte 3 istek, kişi başına saatte en
  fazla 3 bağlantı.
- **/davet** sayfası herkese açıktır (oturum gerektirmez, oturum açmaz): ad ve e-postayı gösterir, yeni parola +
  tekrarı (parola kuralıyla) ister, kaydedince bağlantıyı kullanılmış sayar, kişinin açık oturumlarını kapatır ve
  "Parolanız kaydedildi" mesajıyla `/giris`'e geçer. Sayfayı açmak bağlantıyı tüketmez (WhatsApp önizlemesi de
  açar); bir bağlantıyla en fazla 10 deneme yapılır. Parola kuralına (e-posta adresini içermesin dahil) ya da tekrar
  alanına takılan deneme sayılmaz: sayfa bunları yazarken alanın altında söyler, düğme kapalı kalır.
- Bağlantılar `user_tokens` tablosunda durur: yalnızca anahtarın sha256 özeti, son geçerlilik, kullanım anı ve deneme
  sayısı. Ham anahtar (32 rastgele bayt, base64url) yalnızca oluşturulduğu anda bir kez gösterilir, günlüğe yazılmaz.
  Bir kişinin aynı anda tek geçerli bağlantısı olur; 30 günden eski satırlar kendiliğinden silinir. Tablo
  `drizzle/0008_kullanici_davet.sql` ile gelir (deploy'da `npm run build` öncesi migration çalışır).
- `APP_URL` bağlantılardaki adrestir (yoksa `https://ladmin.laffogato.net`); önizleme ortamında kendi adresini yazın.
- **Hesabım:** ad ve giriş e-postası (parolayla onay), parola değiştirme, iki adımlı doğrulama (açmak, kapatmak ve
  yeni kurtarma kodu parola ister): QR kodu Google Authenticator / Microsoft Authenticator / 1Password ile okutulur,
  8 tek seferlik kurtarma kodu verilir. Kurulum başladıktan sonra 15 dakika içinde onaylanmalıdır; uygulamanın kodu
  5 kez tutmazsa kurulum durur (işlem geçmişine "İki adımlı kurulum durduruldu" yazılır), bekleyen anahtar silinir ve
  kurulum parolayla yeniden başlar; pencereden Vazgeç'le çıkınca da anahtar silinir. İki adımlıyı açmak ve kapatmak,
  parola değiştirmek ve diğer cihazlardaki oturumları kapatmak öteki cihazların oturumlarını ve yöneticinin Claude
  bağlantısını kapatır; pencereler bunu önceden söyler. Telefon kaybolursa girişte "Telefonum yanımda değil" ile
  kurtarma kodu kullanılır ya da bir yönetici sıfırlar; yanlış ya da daha önce kullanılmış kurtarma kodunda ekran her
  kodun bir kez çalıştığını söyler. **Oturumlar › Diğer cihazlardaki oturumları kapat** (parolayla): kasa
  bilgisayarında ya da kaybolan telefonda açık kalan oturumları parolayı değiştirmeden kapatır. Hesabım'daki parola
  onayları kişi başına 15 dakikada 5 hatayla sınırlıdır (Kullanıcılar'daki yönetici onaylarıyla aynı pay;
  `src/server/auth/step-up.ts`); hatalar işlem geçmişine yazılır.
- **Yönetici hesaplarında zorunlu iki adımlı doğrulama: varsayılan kapalı** (Dalga 2, 26 Kasım 2026; sahibin isteği
  "Yönetici hesaplarında iki adımlı doğrulama zorunlu olsun; yeni cihazdan girişte uyarı"; aynı gün sahip zorunlulukla
  panele giremedi ve "2FA isteğe bağlı olsun" dedi). İki adımlı herkeste isteğe bağlıdır (Hesabım'dan açılır; açık
  hesabın girişinde kod adımı her zaman vardır). Vercel'de `ADMIN_2FA_REQUIRED=1` (yeniden yayın gerekir) zorunluluğu
  açar: iki adımlısı kapalı yönetici girişten sonra panel yerine **İki adımlı doğrulamayı kurun** ekranına
  (`/giris/iki-adim`) gider: parola → QR'ı okut, kodu gir → kurtarma kodlarını sakla (indir / kopyala, "kaydettim"
  işaretlenmeden geçilmez) → **Panele geç** (giriş adresindeki hedefe, Claude bağlantısının onay ekranı dahil). Kurulum Hesabım'dakiyle aynı eylemler ve
  sınırlardır (15 dakika, 5 hatalı kod; `src/lib/two-factor-setup.ts`); ekranda **Çıkış yap** da vardır. Kurana kadar
  panelin hiçbir ekranı ve eylemi açılmaz (`requireUser` kurulum ekranına gönderir), veri uçları (canlı veri, dışa
  aktarma, fotoğraflar, yedek…) ona oturumsuz gibi 401 verir (`getCurrentUser`); yalnız kurulum ekranı ve kurulumun üç
  eylemi `requireSignedIn`'den geçer (`tests/yonetici-guvenlik.test.ts` tutar). Personelde iki adımlı isteğe bağlı
  kalır.
  - **Kilitlenme olmasın:** kurulum hemen, aynı ekranda yapılır (telefona doğrulama uygulaması yeter). Telefonunu
    kaybeden yönetici kurtarma koduyla girer; kodu da yoksa başka bir yönetici Kullanıcılar › Güvenlik › **İki
    adımlı doğrulamayı sıfırla** der (kendi parolasıyla): kişi parolasıyla girer, kurulum ekranı açılır, yeni
    telefonuyla kurar. Hesabım'da kapatmak da serbesttir (telefon değiştirirken), pencere kurulum ekranının açılacağını
    söyler.
  - **Acil durum (zorunluluk açıkken):** başka yönetici de yoksa Vercel'de `ADMIN_2FA_OPTIONAL=1` (yeniden yayın
    gerekir) ya da `ADMIN_2FA_REQUIRED`'ı silmek zorunluluğu kapatır; iki adımlı yeniden isteğe bağlı olur. İki
    adımlısı **açık** hesabın girişte kod adımı bununla kalkmaz: o hesabın iki adımlısını sıfırlamak gerekir. İş bitince
    değişkeni silin. Kural `src/lib/admin-security.ts` (`adminTwoFactorRequired`; ikisinde de yalnız tam `1` sayılır).
  - Zorunluluk açılınca iki adımlısı olmayan yöneticiler ilk sayfa açılışında kurulum ekranına düşer (açık oturumları
    kapanmaz; kurulum öteki cihazlardaki oturumları, iki adımlıyı açmak gibi, kapatır). Önceden kurulmuş bir Claude
    bağlantısı salt okunurdur ve kurulumla (oturum sürümü artınca) kapanır; kurulumdan önce yenisi kurulamaz.
- **Yeni cihazdan giriş uyarısı** (yönetici, müdür ve muhasebeci hesapları: iki adımlısı zorunlu roller; personel
  ortak tablette sırayla girer, her biri ilk girişinde uyarı alırdı): bu tarayıcıdan bu hesapla daha önce hiç giriş
  yapılmadıysa (bilinen cihaz çerezi `__Host-laf_cihaz`; oturum sürümü fark etmez, parola değişince aynı tarayıcı
  yeniden "yeni" sayılmaz) başarılı girişte (iki adımlı kodla ya da kurtarma koduyla girişte de):
  - İşlem geçmişine **Yeni cihazdan giriş** yazılır ("Chrome · Windows · IP 85.105.12.x");
  - kişinin zilinde Sistem başlığında 7 gün "Yeni cihazdan giriş: …" durur, Hesabım › Oturumlar'a götürür;
  - Resend kuruluysa hesabın kendi adresine **"Hesabınıza yeni bir cihazdan giriş yapıldı"** e-postası gider (ne
    zaman, hangi tarayıcı, kısaltılmış IP; "Giriş sizinse bir şey yapmanız gerekmez"; değilse parolanızı değiştirin ve
    diğer cihazlardaki oturumları kapatın; **Oturumlarım** düğmesi). Güvenlik bildirimidir: hatırlatma e-postalarının
    açık / kapalı ayarına bağlı değildir. Yanıttan sonra gider, girişi bekletmez; hiçbir hatası girişi bozmaz.
  - Hesabın ilk girişi (davetten sonra) uyarı değildir. Çerezleri silinen, gizli sekmede açılan tarayıcı yeni sayılır.
  - **KVKK:** saklanan yalnız tarayıcı ve işletim sisteminin adı ile kısaltılmış IP (IPv4'te son hane "x", IPv6'da ilk
    üç blok "/48"); tam IP ve tarayıcı kimliği (user-agent) hiçbir yere yazılmaz. Kod `src/server/auth/new-device.ts`,
    e-posta `src/server/auth/new-device-notice.ts`, kurallar `src/lib/admin-security.ts`; testler
    `tests/yonetici-guvenlik.test.ts`, `tests/hesap-yetki-db.test.ts` ve (müdür, muhasebeci) `tests/roller-db.test.ts`.
- Kurtarma kodları kişiye özel tuzlu, yavaş bir özetle (scrypt) saklanır; veritabanı sızsa bile kodlar denenerek
  bulunamaz. Önceki biçimde saklanmış kodlar yenilenene kadar çalışır.
- Doğrulama anahtarı veritabanında `AUTH_SECRET`'tan türetilen anahtarla şifrelidir; `AUTH_SECRET` değişirse iki
  adımlı doğrulama yeniden kurulmalıdır.
- **Claude bağlantısı:** yalnız yönetici, parolayla onay; Hesabım › Bağlı uygulamalar'dan kaldırılır; parola değişince
  ya da oturumlar kapatılınca kapanır. Kurulum ve güvenlik ayrıntısı [CLAUDE-BAGLANTISI.md](CLAUDE-BAGLANTISI.md).

**QR menü.** Müşterinin tam menüsü `https://laffogato.net/menu`'dedir: alerjenler (Gıda Etiketleme Yönetmeliği) ve
fiyat listesinin tarihi (Fiyat Etiketi Yönetmeliği) oradadır, panelin menüsünde yoktur. Yeni QR basılacaksa
`https://laffogato.net/menu` için oluşturun (masalardaki QR kartları zaten sitenin masa sayfasını açar). Panelin kendi
menüsü (`ladmin.laffogato.net/menu`) **Ayarlar → QR menü → Menüyü yayınla** ile açılır; yayında değilken ya da
gösterilecek ürün yokken müşteriyi `laffogato.net/menu`'ye yönlendirir (yönetici önizlemesi `?onizleme=1` hariç),
yayındayken de alerjen bilgisi için oraya bağlantı verir. Sitenin adresi `LAFFOGATO_URL`'den gelir.

## 7. Güncelleme ve yedek

- Kodda değişiklik yapıp Git'e gönderdiğinizde Vercel yeniden deploy eder. Şema değiştiyse `npm run db:generate`
  ile migration üretip onu da gönderin; canlı derlemede otomatik uygulanır (önizlemede uygulanmaz, § 3).
- **Production yalnız main'den.** Bir dalın önizlemesi **asla** Production'a terfi ettirilmez ("Promote to
  Production") ve Production'a yeniden derlenmez ("Redeploy" → Production): Vercel ikisinde de dalı canlının ortam
  değişkenleriyle (`VERCEL_ENV=production`) yeniden derler; dalın incelenmemiş migration'ı canlı veritabanına uygulanır,
  dalın kodu bütün canlı sırlarıyla (`AUTH_SECRET`, `PARASUT_*`, `RESEND_API_KEY`, `CRON_SECRET`) ladmin'de çalışır.
  21 ve 26 Eki 2026'da iki kez oldu; ikincisinde PR'ın migration'ı sonra yeniden üretildi, sonraki main derlemesi
  `relation "pos_daily_sales" already exists` ile düştü (aşağıda, 0040). Bu yüzden derleme öncesi hazırlık
  (`scripts/predeploy-guard.ts` › `productionBranchRefusal`) Production derlemesinin dalına (`VERCEL_GIT_COMMIT_REF`)
  bakar: `main` değilse derleme veritabanına hiç bağlanmadan `✗ Production derlemesi yalnız main dalından yapılır; bu
  derlemenin dalı: …` diye durur, yayındaki sürüm ve şema değişmez. Değişiklik canlıya PR'la main'e birleşerek gider.
  - Dalı bilinmeyen derleme (yerel `npm run build`, Git'siz CLI dağıtımı) denetlenmez; Instant Rollback yeniden
    derlemediği için etkilenmez.
  - **Bekçi yalnız onu içeren commit'te çalışır.** Derleme komutu (`tsx scripts/predeploy.ts && next build`) derlenen
    commit'in kendi dosyalarını çalıştırır; bekçi main'e 27 Eki 2026'da (Denetim B05) geldi. Ondan önce açılmış ve
    main'le birleştirilmemiş dallar (eski `claude/*` dalları; 26 Ekim'in `claude/lafpos-baglantisi` dağıtımı
    `dpl_4pdszt…`, commit `593c536` dahil) Production'a yeniden derlenir ya da terfi ettirilirse **durmaz**:
    - dalın birleşmemiş migration'ı canlının en yeni migration'ından eskiyse drizzle onu atlar ve `verifyMigrations`
      derlemeyi `Migration uygulanmadı: …` diye durdurur (bu denetim de 22 Eki 2026'dan, #7'den önce açılmış dallarda
      yoktur); daha yeniyse canlı veritabanına uygulanır;
    - migration'ı olmasa da dalın eski kodu bütün canlı sırlarıyla ladmin'de yayına çıkar.

    Bu yüzden eski dal dağıtımları **hiçbir zaman** yeniden derlenmez ("Redeploy") ve terfi ettirilmez. Eski bir dalda
    yeniden çalışmadan önce dal main'le birleştirilir; böylece hem bekçiyi hem `vercel.json` › `git.deploymentEnabled`'ı
    (§ 3) alır. Birleştirmeden önce eski dala gönderilen bir commit yeni bir önizleme açar ve o önizlemede de bekçi
    yoktur. Bekçiyi eski commit'lere de yaymanın yolu Vercel › Project Settings › Build & Development › **Build
    Command**'dır (hiçbir commit'in `vercel.json`'ı `buildCommand` koymaz, ayar her derlemede geçerli olur); bu ayar
    sahibin kararıdır ve yapılana kadar yukarıdaki kural geçerlidir ([KALAN-ISLER.md](planlar/KALAN-ISLER.md),
    soru 10).
  - Bilerek yapılan acil dağıtım (main bozuk, düzeltme dalda) yalnız o derlemeye anahtar verilerek yapılır:
    dal çalışma kopyasında `vercel deploy --prod --build-env ALLOW_BRANCH_PRODUCTION=1`. Derleme günlüğüne
    `! Production derlemesi <dal> dalından (ALLOW_BRANCH_PRODUCTION=1 ile bilerek)` yazılır. Değişkeni proje ayarlarına
    eklemeyin (ekleyen olursa işi bitince silin): ayarda kalırsa bekçi her dal için kapanır. Dalın migration'ı canlıya
    uygulanmış olur; dal sonra main'e birleşirken migration **yeniden üretilmez** (aşağıdaki kural).
- **Migration kuralları.** Drizzle bir migration'ı yalnız günlükteki zamanı (`drizzle/meta/_journal.json` › `when`,
  üretildiği an) veritabanındaki en yeni kayıttan sonraysa uygular; daha yeni tarihli bir migration önce uygulandıysa
  eskisi **hata vermeden atlanır**. Bu yüzden:
  - Migration'ı dalı main'le birleştirdikten hemen sonra üretin (`npm run db:generate -- --name <ad>`). Önce
    üretilmiş bir migration'ı olan dal main'e geç kalırsa: dalı main'le birleştirin, `drizzle/meta/_journal.json`'ı
    main'dekiyle değiştirin, dalın kendi `drizzle/00NN_*.sql` ve `drizzle/meta/00NN_snapshot.json` dosyalarını silin,
    yeniden üretin. Migration'lı dallar birer birer birleştirilir. `tests/migrations.test.ts` günlükteki zamanlar
    sırayla artmıyorsa düşer.
  - Uygulanmış bir migration elle değiştirilmez (tek istisna: 0018'deki gibi `IF NOT EXISTS` onarımı, inceleyen
    isterse) ve **yeniden üretilmez**: canlıya hangi yoldan gittiği önemli değildir (main, önizleme ya da Production'a
    alınmış bir dal yayını). 26 Eki 2026: `0040_lafpos_baglantisi` 12:19'da bir dal yayınıyla canlıya uygulanmıştı; PR
    birleşmeden önce yeni sütunla yeniden üretilince drizzle onu yeni migration saydı, `pos_daily_sales`'ı yeniden
    kurmaya çalıştı ve canlı derleme durdu (yayındaki sürüm değişmedi). Düzeltme: 0040 canlıdaki hâline döndü, sütun
    `0041_kasaya_giren` ile eklendi. Birleşmemiş bir dalın migration'ını yeniden üretmeden önce canlıda kaydı var mı
    bakın (`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 3`).
  - Eski bir yedeğin verisiyle takılan migration (boş veritabanında ve canlıda geçmiş) yine değiştirilmez: geri
    yüklemenin ondan hemen önce çalıştırdığı ek adım `src/lib/backup/format.ts` › `BEFORE_MIGRATION_SQL`'e yazılır
    ([YEDEK.md](YEDEK.md) § 4). Örnek: `0056_sube_kirilimi` eski satırları 'tuzla'ya bağlar, kayıt ancak 0057'de
    yazılır. Aynı nedenle şubelerden (0053) önceki, verisi olan bir veritabanında `npm run db:migrate` 0056'da yabancı
    anahtar hatası verir (drizzle bekleyenlerin hepsini tek işlemde uygular, hiçbir şey değişmez): böyle bir veritabanı
    `npm run db:backup` ile alınıp boş bir veritabanına `npm run db:restore` ile yüklenir.
  - Migration'lar eklemeli ya da geriye uyumlu olsun: Vercel'in Instant Rollback'i yeniden derlemez, eski kod yeni
    şemada çalışır (sütun silmek, adını değiştirmek, NOT NULL varsayılansız sütun eklemek eski kodu bozar). Geriye
    uyumsuz bir migration'dan sonra Instant Rollback yapmayın; düzeltmeyi ileri yayınlayın.
  - **kasa_ay_bilgisi_butunluk** (kasa bütünlüğü ve kasa raporlarından ay bilgisi): ay bilgisinin indirim ve ödenmezi
    artık boş olabilir (boş = kasa raporlarından), eski kod boş beklemez. Bu sürümden geriye Instant Rollback
    yapmayın; düzeltmeyi ileri yayınlayın.
  - **istemci_anahtari** (`waste_entries`, `invoices`, `findings` › `client_key`, denetim UI-01 ve UI-03): boş
    olabilen sütunlar ve benzersiz dizinler, eklemeli; geri doldurulacak satır yok. Bu sürümden geriye Instant Rollback
    yapılırsa eski kod sütuna bakmaz: zayi formu, Fatura ekle ve Bulgu ekle yeniden çift basışta iki kayıt açabilir;
    yazılmış anahtarlar zarar vermez.
  - **fatura_kaynagi_onarimi** (yalnız veri, denetim FC-02; [PARASUT.md](PARASUT.md) § 3): hiçbir Paraşüt belgesine
    bağlı olmayan elle girilmiş / içe aktarılmış faturanın kaynağını (`source`) bir kez eskisine döndürür; şema değişmez, eski kod da
    çalışır. Bu sürümden geriye Instant Rollback yapılırsa eski eşitleme e-faturası reddedilen kaydı yine Paraşüt'e bağlı
    bırakır (tutarı kilitli); migration yeniden çalışmaz, o kayıtlar ileri yayınla gelen eşitlemede de düzelmez.
  - **cikista_oturum_kapanir** (`revoked_sessions`, § 6a Çıkış): yalnız yeni tablo, eklemeli. Bu sürümden geriye
    Instant Rollback yapılırsa eski kod tabloya bakmaz: çıkışta kapatılmış oturumların kopyaları yeniden geçer (yalnız
    çerezi kopyalanmış oturumlar için önemli).
  - **kapali_gun_subesi** (`special_days.branch_id`; docs/SUBE.md › Kapalı gün): boş sütun, eklemeli; var olan kapalı
    günler işletme geneli kalır (geri doldurma yok). Geriye Instant Rollback yapılırsa eski kod sütuna bakmaz: şubeli
    kapalı günler bütün şubelerde kapalı sayılır.
  - **satis_tahmini** (satış tahmini: `special_days`, `weather_days`, `forecast_snapshots`): yalnız yeni tablolar,
    eklemeli; eski kod onlara dokunmaz. Satış tahmini 4 Kasım 2026'da kalktı: `special_days` (Özel günler) kullanılıyor,
    hava durumu isteği ve `WEATHER_CONTACT` artık yok.
- **Aynı anda iki canlı derleme (26 Kas 2026).** Migration bir danışma kilidi altında çalışır
  (`scripts/migrate.ts`): ikinci derleme `… Başka bir migration sürüyor (pid …); bitmesi bekleniyor, en çok 10 dk`
  yazar, öteki bitince uygulanmış migration'ları **kilidi aldıktan sonra** okur ve `✓ Veritabanı şeması güncel` der.
  Önceden ikisi birden uygulamaya kalkıyordu: #151'in derlemesi 0087–0092'yi uygularken (11:27–11:46 UTC) başlayan
  #152'ninki kaydı ilk işlem commit olmadan okudu ve `column "company_wide" of relation "invoices" already exists`
  ile düştü. Kilit oturum kilididir, tek bağlantıda tutulur; bu yüzden migration yalnız havuzsuz adrese
  (`DATABASE_URL_UNPOOLED`) gider, havuzlu (Neon `-pooler`, PgBouncer) adreste derleme şemaya dokunmadan durur. Öteki
  migration 10 dakikada bitmezse derleme `Migration kilidi … içinde alınamadı` diye durur ve kilidi tutan oturumu
  (pid, uygulama adı) yazar; şema ve yayındaki sürüm değişmez.
- **Tablo kilidi beklemesi.** `ALTER TABLE` tabloyu tutan her açık işlemin bitmesini bekler; beklerken canlı
  uygulamanın o tabloya her sorgusu da onun arkasında sıraya girer. #151'in migration'ının 18 dakikası büyük olasılıkla
  buydu (tutan işlem kaydedilmemişti). Artık her tablo kilidi en çok 15 sn beklenir (`lock_timeout`); süre dolunca
  işlem geri alınır, hiçbir şey değişmez, 15 sn sonra yeniden denenir (en çok 4 deneme; `MIGRATION_LIMITS`). Denemeler
  biterse derleme `Migration 4 denemede de tablo kilidini alamadı …` diye durur ve uzun süredir açık işlemleri yazar
  (pid, durum, süre, tuttuğu tablolar, son sorgu). Açık işlem bitince yeniden dağıtılır; `idle in transaction` bir
  oturum takılı kaldıysa Neon'un SQL Editor'ünde `select pg_terminate_backend(<pid>)` ile kapatılır.
- **"Migration uygulanmadı" hatası.** Canlı derleme (ve `npm run db:migrate`) migration'dan sonra günlükteki her
  girdinin `drizzle.__drizzle_migrations`'ta kaydını arar (`scripts/migration-check.ts`). Eksik varsa derleme
  `Migration uygulanmadı: 0021_x … (sıra bozuk)` diye durur ve yayındaki sürüm değişmez. Çözüm: yukarıdaki gibi
  migration'ı main'in ardına yeniden üretip gönderin. Şema değişikliği canlıda zaten varsa (ör. bir önizleme uyguladı),
  eksik satır elle eklenir: `insert into drizzle.__drizzle_migrations (hash, created_at) values ('<sha256>', <when>)`
  (değerler günlükten; yalnız şemanın gerçekten aynı olduğu doğrulandıktan sonra).
- **"Veritabanında depoda olmayan N migration kaydı var" uyarısı** derlemeyi durdurmaz: günlükte olmayan bir kayıt
  (bir önizlemenin ya da birleşmemiş bir dalın uyguladığı). Canlıda bir tane bilinen kayıt var: 21 Eki 2026'da bir
  önizlemenin erken uyguladığı menü migration'ı (created_at 1792621679613); aynı değişiklik 0018 olarak
  `IF NOT EXISTS` ile yeniden uygulandı. Bu kayıt için uyarı artık yazılmaz (`scripts/migration-check.ts` ›
  `KNOWN_ORPHANS`): her derlemede çıkan uyarıya alışılıp yeni bir kayıt gözden kaçmasın. Uyarı görünürse yenidir: hangi
  dalın uyguladığına ve şemanın koddakiyle aynı olduğuna bakın
  (`select created_at, hash from drizzle.__drizzle_migrations order by created_at`).
- Derleme günlüğündeki iki npm uyarısı zararsızdır: `npm warn install-scripts … esbuild, unrs-resolver` (geliştirme
  araçlarının kurulum betikleri; esbuild platform paketinden yine çalışır) ve `npm warn Unknown env config "cache-dir"`
  (Vercel'in derleme ortamından).
- `package.json` › `overrides`: `@vercel/blob`'un zinciri (`@vercel/oidc` 3.x › `@vercel/cli-config` 0.3.1) zod'u
  4.1.11'e sabitliyor; bu sürümde yüksek önemli bir açık var (GHSA-mrhx-c7xc-m3w5, 4.6.6'da kapandı). Zincirdeki zod
  projenin kendi zod'una bağlanır (`"zod": "$zod"`, aynı ana sürüm). `@vercel/blob` `@vercel/oidc` 4.0.6 ya da
  üstünü kullanmaya başlayınca (`npm ls zod` iç içe zod göstermez) bu satır silinebilir.
- **Bağımlılık açıkları (26 Kasım 2026): `npm audit` geliştirme araçları dahil 0 açık.** Önceden bilerek bırakılan
  ikisi ve Dependabot'un öbür ikisi kapandı:
  - `overrides` › `exceljs` › `uuid` `^11.1.1`: exceljs 4.4.0 (son kararlı sürüm, 2023; 4.4.1 yalnız ön sürüm) uuid'i
    `^8.3.0`'a bağlıyor; 11.1.1'den önceki uuid'de orta önemli bir açık var (GHSA-w5hq-g745-h8pq: `buf` verilen
    v3/v5/v6'da sınır denetimi yok). exceljs yalnız `v4()`'ü `buf`'sız çağırır (genişletilmiş koşullu biçimin kimliği),
    açık bu yola dokunmaz; yine de düzeltmenin geldiği 11.1.1'e zorlanır (CommonJS'i olan son ana sürüm; 12 ve sonrası
    yalnız ESM, exceljs `require` eder). `npm audit fix --force`'un önerdiği exceljs 3.4.0'a inmek dışa aktarımı
    geriletirdi. exceljs uuid'i 11.1.1 ya da üstüne bağlayan bir sürüm çıkarınca satır silinir. Deneme: dışa aktarım
    testleri (`tests/export-*.test.ts`, `tests/muhasebe-paketi.test.ts`, `tests/eski-veri-adlari.test.ts`).
  - `overrides` › `@esbuild-kit/core-utils` › `esbuild` `^0.25.0`: drizzle-kit 0.31 kullanmadığı
    `@esbuild-kit/esm-loader`'a hâlâ bağımlı; onun zinciri esbuild 0.18.20'yi getiriyordu (GHSA-67mh-4wv8-2f99, orta;
    esbuild'in geliştirme sunucusunda, yalnız geliştirme aracı). Zincir drizzle-kit'in kendi esbuild'ine (0.25.x) bağlanır;
    drizzle-kit bu paketi hiç yüklemez (`drizzle-kit check` aynı sonucu verir). Bağımlılık drizzle-kit'ten kalkınca satır
    silinir.
  - `fast-xml-parser` `^5.12.1` (GHSA-474x-hrwr-fgx4, düşük: kapanmamış durdurma düğümünde ikinci dereceden işlemci
    tüketimi; 5.12.0'da kapandı; Paraşüt e-faturası ve ModPOS föyü okuması, `tests/ubl.test.ts`, `tests/modpos-*.test.ts`)
    yükseltildi. Geliştirme araçlarında `typescript-eslint` 8.71.2 → 8.74.0 (içindeki `minimatch` 10.2.6 → 11.0.9;
    GHSA-g3hv-75wg-m249, orta) yalnız kilit dosyasında yükseltildi (`eslint-config-next`'in aralığı içinde).

  Yeni bir açık bilerek bırakılırsa gerekçesiyle buraya yazılır.
- Veri yedeği: Neon'un otomatik nokta-zaman geri yüklemesi (point-in-time restore) küçük planlarda yalnız birkaç saat
  ya da gün geriye gider. Uzun süreli yedek: **Ayarlar › Yedek › Yedeği indir** (parolayla) paneldeki bütün veriyi tek
  `.json.gz` dosyasında indirir; ayda bir alınır, 30 günü geçince zil hatırlatır. Sabah işi her pazartesi aynı yedeği
  özel Blob deposuna da yazar, son 8 haftayı saklar (Ayarlar › Yedek'te parolayla iner; [YEDEK.md](YEDEK.md) § 13);
  veritabanının boyutu her sabah ölçülür, `DB_QUOTA_MB`'nin %70 ve %90'ında uyarılır (§ 14). Geri yükleme yalnız bilgisayardan:
  `npm run db:restore -- <dosya>` (dolu veritabanına `--sil`, önce onun yedeğini alır). Biçim, adımlar, prova ve geri
  yüklemeden sonra olanlar: [YEDEK.md](YEDEK.md). Kasa ve fiş fotoğraflarının dosyaları yedekte yoktur (yalnız
  kayıtları); dosyalar özel Vercel Blob deposunda kalır ([FOTOGRAF.md](FOTOGRAF.md)). Aynı karttaki **Dışa aktar (.xlsx)** okunabilir bir çalışma kitabıdır ([YEDEK.md](YEDEK.md) § 12): panel
  sekmeleri ve bütün ayların satış, ay bilgisi, gelir-gider, sayım ve alım miktarı kayıtları. Aylık harcamaların tek
  tek kayıtları (yalnız Gelir-Gider'de ay toplamı), hatırlatıcılar, kullanıcılar ve Paraşüt bağlantıları o dosyada
  yoktur; dışa aktarım panele geri yüklenmez.
- Veriyi ilk kurulumdaki başlangıç verisine (`tests/fixtures/baslangic/veri.json`, § 1) döndürmek için yerel makineden production veritabanı adresiyle şunu çalıştırın:

```bash
DATABASE_URL="<neon bağlantı adresi>" npm run db:reset -- --onay=<sunucu adı>
```

  Komut satırında verilen adres `.env.local`'dakinden önce gelir (`db:migrate`, `db:seed`, `db:backup` ve
  `db:restore`'da da; denetim AL-02); komut hedefi `Hedef: <sunucu>/<veritabanı>` diye yazar. Bu bilgisayarda olmayan
  veritabanında komut sunucu adıyla onay ister (`--onay=` yoksa terminalde sorar; adı yanlışsa hiçbir şey silinmez):
  `.env.local` canlının adresini gösteriyorsa yerel sanılan bir sıfırlama canlıyı silmesin. Silmeden önce bütün verinin
  yedeği ev klasörüne yazılır (`laffogato-yedek-once-<sunucu>-….json.gz`, yüklenen belgeler dahil); yanlışlıkla
  sıfırlandıysa `npm run db:restore -- <o dosya> --sil --onay=<sunucu>` ile geri gelir ([YEDEK.md](YEDEK.md)).

  Dikkat: ürünler, hammaddeler, satışlar, faturalar (belge ve kalemleriyle), sabit giderler, personel, gelir-gider
  düzeltmeleri, sayımlar, ay bilgileri, ayarlar, POS eşleştirmeleri, aylık harcama kayıtları, işlem geçmişi, Paraşüt
  eşitleme geçmişi, imleci ve ürün bağlantıları, ürünlerin laffogato.net menü bağlantıları ve eşitleme durumu,
  Ödemeler › Son ödenenler listesi ile bildirim günlüğü silinip başlangıç verisi yeniden yüklenir. Faturaların ödendi / talep edildi işaretleri de gider; ödeme takibinin başlangıcı
  sıfırlanır. Ürünler zayi oranlarını kategorilerinden alır (kahve %5, tatlı %20, çay %40…; `src/lib/fire-defaults.ts`).
  **Silinmeyenler:** kullanıcılar, aylık harcama kategorileri (kayıtları silinir), hatırlatıcılar,
  bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları, tedarikçi cari kartları, günlük işlerin çalışma kayıtları,
  fotoğraflar, kasadan çıkanlar ve okuma kayıtları, zayi ve ikram kayıtları (başlangıç verisinde aynı kimlik ve adla geri gelen ürüne
  ya da hammaddeye bağlı kalır, gerisi yalnız adıyla). Sonraki eşitleme
  Paraşüt faturalarını baştan alır: son 30 günün faturaları "ödenmedi", daha eskileri Paraşüt'teki durumuyla gelir.

## 8. Plan ve günlükler (Vercel Hobby)

Panel Vercel'in ücretsiz **Hobby** planında çalışıyor (26 Eki 2026 denetimi, E-67). Planın panele dokunan sınırları:

- **Kullanım şartı.** Hobby, Vercel'in adil kullanım kurallarında kişisel ve ticari olmayan kullanım içindir; bu panel
  bir kafenin ticari arka ofisi. Vercel şartı uygularsa proje durdurulabilir: panel ve günlük işler (Paraşüt
  eşitlemesi, sabah e-postası) çalışmaz, veri Neon'da kalır. **Öneri: Pro plan.** Karar sahibindir (açık soru,
  `docs/planlar/KALAN-ISLER.md` › sahibe sorular, 10); karar verilene kadar plan Hobby kalır, risk bu notla bilinir.
- **Çalışma günlüğü bir saat.** Vercel › Logs (sunucunun `console.error` / `console.warn` satırları dahil) Hobby'de
  yalnız son bir saati tutar; daha eskisi istenince Vercel "Hobby retains 1 hour" der. "Dün akşam kasa raporu
  kaydedilmedi" gibi bir sorunun satırı ertesi gün yoktur: sorun bildirilince günlüğe hemen bakın. Uzun ömürlü olanlar:
  - Vercel › Observability'deki hata kümeleri (son 7 gün; aynı hatanın sayısı, ilk ve son görülüşü, yolu);
  - panelin kendi kayıtları: Ayarlar › Günlük işler (her cron çalışması ve adımları), işlem geçmişi, Paraşüt eşitleme
    geçmişi, LafPOS ve site bağlantılarının durumu.
- **Log drain yok.** Günlükleri dışarıya (bir günlük servisine) akıtmak Hobby'de yok; Pro'da açılır.
- **Hata kancası yok.** `src/instrumentation.ts` (Next'in `onRequestError` kancası) yazılmadı; hatalar yalnız günlüğe
  gider. Sonraki iş: kişisel veri taşımayan (yol, hata adı ve kodu; istek gövdesi, çerez ve e-posta yok) bir hata
  satırını panelin veritabanına yazan kanca. Pro'ya geçilmezse günlüklerin tek kalıcı kaydı o olur.
- **Cron günde bir ve saat esnek.** Hobby'de her cron günde en çok bir kez ve planlanan saatin içinde herhangi bir
  dakikada çalışır: `/api/cron/parasut` 07:00–08:00, `/api/cron/gunluk` 08:00–09:00 (Türkiye; § 4). Panel buna göre
  yazıldı: "çalışmadı" uyarısı pencerenin sonundan 30 dakika sonra (`src/lib/job-health.ts` › `GRACE_MIN`), sabah işi
  kendi zaman bütçesiyle (`src/server/jobs/capped.ts`).
- **Günde en çok 100 dağıtım** (§ 3) ve **geri alma yalnız bir önceki canlı sürüme** (Instant Rollback Hobby'de
  hemen önceki Production dağıtımına döner; daha eskisi için düzeltme ileri yayınlanır, § 7).

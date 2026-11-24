# Vercel'e kurulum

Uygulama tek bir Next.js projesi: frontend ve backend (Server Actions + API uçları) birlikte Vercel Functions
olarak çalışıyor. Veritabanı olarak Vercel Marketplace'teki Neon Postgres önerilir.

## 1. Kodu bir Git deposuna koyun

```bash
git init && git add . && git commit -m "L'Affogato paneli"
```

GitHub'da **gizli (private)** bir depo açıp kodu oraya gönderin. Depoda Excel'den aktarılan başlangıç verisi
(`src/server/db/seed/excel-data.json`: maaşlar, kira, faturalar, satışlar) bulunduğu için depoyu herkese açık
yapmayın. Depo kökü `lafmaliyet` klasörüyse Vercel'de **Root Directory**
olarak `laffogato` seçeceksiniz.

> Vercel CLI ile Git'siz de deploy edebilirsiniz: `laffogato` klasöründe `vercel` komutu.

## 2. Vercel projesi

1. vercel.com → **Add New… → Project** → depoyu seçin.
2. Framework: **Next.js** (otomatik). Root Directory: `laffogato` (gerekiyorsa).
3. Build komutu değişmez (`npm run build`). Bu komut önce migration'ları uygular ve hepsinin gerçekten uygulandığını
   doğrular (§ 7), veritabanı boşsa Excel verisini yükler, sonra derler. Önizleme derlemesi migration ve seed
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
| `LAFPOS_SYNC_SECRET` | (isteğe bağlı) LafPOS (kafenin kasası) bağlantısı: gün sonunu iter, ürün maliyetlerini, kasa zincirini (devir, gider kategorileri) ve ModPOS dönemini (şubenin geçiş gününden önceki ModPOS günleri ve ürün listesi; LafPOS Uzaktan'daki ModPOS günleri buradan gelir) okur. `openssl rand -base64 48`; **LafPOS'taki `LAFMALIYET_SYNC_SECRET` ile aynı**, sitenin anahtarından (`KARAOKE_SYNC_SECRET`) ve sitenin kendi `LAFPOS_SYNC_SECRET`'ından ayrı; `KARAOKE_SYNC_SECRET`'la aynıysa bağlantı açılmaz. Yoksa beş uç da 503 döner: `POST /api/pos/gun`, `GET /api/panel/pos/urunler`, `GET /api/panel/pos/modpos-gunler`, `GET /api/panel/pos/devir` ve `GET /api/panel/pos/gider-kategorileri`. Açma sırası ve geçiş günü [LAFPOS.md](LAFPOS.md) › Açılış sırası |
| `MODPOS_API_KEY` | (isteğe bağlı, **yalnız Production**) ModPOS'un (Gafdigi) Kasa Föyü API anahtarı (`sk_…`): panel her sabah dünün kasa föyünü çeker, yönetici Kasa'da raporla yan yana görür. Günde 2 istek hakkı var; anahtara IP kısıtı konmamalı (Vercel'in sabit IP'si yok). Yoksa bağlantı kapalı, hiçbir istek gitmez ([MODPOS-API.md](MODPOS-API.md)) |
| `MODPOS_API_KEY_<ŞUBE>` | (isteğe bağlı, **yalnız Production**) Tuzla'dan başka ModPOS şubesinin anahtarı: `MODPOS_API_KEY_MARINA`. Şubenin anahtarı yoksa o şube çekilmez (Tuzla'nınkine düşülmez); başka şubeninkiyle aynı anahtar kullanılmaz ([MODPOS-API.md › Şubeler](MODPOS-API.md#1a-şubeler-16-kasım-2026)) |
| `MODPOS_SUBELER` | (isteğe bağlı) ModPOS'taki şube adını panelin şubesine bağlar (`Sahil Şube=marina; Merkez=tuzla`): tek anahtar birden çok şubenin kasasını verir ve ad panelin şube adını içermezse |
| `MODPOS_SYNC_FROM` | (isteğe bağlı) Geçmişin ilk günü (`YYYY-MM-DD`): geçmiş föyler dünden bu güne doğru, yeniden eskiye çekilir, öncesi çekilmez; yoksa `2026-07-01`. Canlıda `2026-11-01` |
| `MODPOS_API_URL` | (isteğe bağlı) Kasa föyü ucunun adresi; yoksa belgedeki `https://api.gafdigi.com/api/v2/external/raporlar/kasa-foyu` |
| `CASH_REPORT_RECIPIENTS` | (isteğe bağlı, yalnız Production) Kasa raporunun alıcıları, yönetici panelden hiç kaydetmediyse: virgülle ayrılmış e-postalar. Panelde kaydedilen liste her zaman önce gelir ([KASA-RAPORU.md](KASA-RAPORU.md)) |
| `MIGRATE_ON_PREVIEW` | (yalnız Preview, isteğe bağlı) `1`: önizlemelerin **kendi** veritabanı varsa (Neon önizleme dalları) önizleme derlemesi de migration uygular. Önizleme canlının veritabanını kullanıyorsa tanımlamayın (§ 3) |
| `ALLOW_BRANCH_PRODUCTION` | (yalnız acil durumda, tek derleme için) `1`: `main` dışındaki bir dalın Production derlemesine bilerek izin verir; derleme günlüğüne uyarı yazılır. Proje ayarlarına **eklemeyin**: `vercel deploy --prod --build-env ALLOW_BRANCH_PRODUCTION=1` ile yalnız o derlemeye verilir (§ 7, "Production yalnız main'den") |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | (isteğe bağlı) Web Push anahtarları; yoksa ilk kullanımda üretilip veritabanında şifreli saklanır |
| `ANTHROPIC_API_KEY` | (isteğe bağlı, **yalnız Production**) Fotoğraftan okuma (Claude): kasa raporunda Z raporu, banka POS fişi ve kasadan çıkan fişler. Yoksa fotoğraf yine eklenir, rakamlar elle yazılır. Aynı anahtar Vardiya'daki **Yazarak doldur**u da çalıştırır ([VARDIYA.md](VARDIYA.md) › Yazarak doldurma); yoksa kutular elle doldurulur. Ayrıntı [FOTOGRAF.md](FOTOGRAF.md) |
| `BLOB_READ_WRITE_TOKEN` | (isteğe bağlı, **yalnız Production**) Fotoğraf deposu: Vercel › Storage › Blob, erişim **Private**, bölge Frankfurt (fra1). Depoyu projeye bağlayınca kendiliğinden eklenir (yeni bağlantı anahtar yerine `BLOB_STORE_ID` verirse o da yeter). Yoksa fotoğraf düğmeleri görünmez ([FOTOGRAF.md](FOTOGRAF.md)) |
| `PHOTO_DIR` | (yalnız yerel, isteğe bağlı) Fotoğrafların yerel klasörü; yoksa `.data/photos` |
| `MCP_DISABLED` | (isteğe bağlı) `1` ise Claude bağlantısı kapalı (bütün uçlar 404, verilmiş anahtarlar çalışmaz). Önizlemelerde zaten kapalı ([CLAUDE-BAGLANTISI.md](CLAUDE-BAGLANTISI.md)) |
| `MCP_ALLOW_LOCALHOST` | (isteğe bağlı) `1` ise Claude Code / MCP Inspector'ın localhost dönüş adresine canlıda da izin verilir; varsayılan kapalı |
| `WEATHER_CONTACT` | (isteğe bağlı) Satış tahmininin hava durumu isteğinde (MET Norway, ücretsiz, anahtarsız, günde bir istek) kimliğe eklenen iletişim: e-posta ya da adres. Yoksa yalnız uygulamanın adı ve `APP_URL` gider. Panel `api.met.no`'ya bağlanabilmeli; bağlanamazsa tahmin havasız hesaplanır ([SATIS-TAHMINI.md](SATIS-TAHMINI.md)) |
| `DATABASE_SSL` | (isteğe bağlı, yalnız acil durumda) `require`: veritabanı sunucusunun sertifikası doğrulanmaz. Varsayılan doğrulamalı bağlantıdır (`verify-full`; Neon'un sertifikası Let's Encrypt'ten, Node tanır): şifreli ama sertifikası denetlenmeyen bağlantıda araya giren biri kendi sertifikasıyla bütün veriyi okuyabilirdi. Canlı derleme önce havuzlu adresi, sonra migration için doğrudan adresi doğrulamalı açar; biri açılmazsa derleme migration'dan önce durur, ne veritabanı ne yayındaki sürüm değişir. Neon sertifikasını değiştirdiği için derleme durursa geçici olarak `require` yazılır |

`DATABASE_URL` / `DATABASE_URL_UNPOOLED` Neon entegrasyonundan gelir. Paraşüt değişkenleri (`PARASUT_*`) için
[PARASUT.md](PARASUT.md) § 1.

İki günlük iş `vercel.json`'da tanımlı (Vercel Cron, Türkiye saatiyle): `/api/cron/parasut` 07:00–08:00 arasında
Paraşüt'ü eşitler, `/api/cron/gunluk` 08:00–09:00 arasında sabah e-postasını gönderir (anahtar varsa önce dünün ModPOS kasa föyünü çeker;
[MODPOS-API.md](MODPOS-API.md)). Vercel → Settings → Cron Jobs
ekranında görünür, **Run** ile elle çalıştırılır. Her çalışma panelde **Ayarlar › Günlük işler**'de görünür; çalışmayan
ya da hata veren iş zilde, Genel bakış'ta ve e-postayla bildirilir ([BILDIRIMLER.md](BILDIRIMLER.md) › Sistem
uyarıları; iki iş birden durursa diye isteğe bağlı dış izleme: `/api/health?isler=1`).

## 5. Deploy

**Deploy** düğmesine basın. Build günlüğünde şunları görmelisiniz:

```
✓ Veritabanı şeması güncel (21 migration)
✓ Excel verisi yüklendi: 74 hammadde, 129 ürün, 699 reçete satırı, 125 satış satırı, 81 fatura
✓ Yönetici hesabı oluşturuldu: …
```

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
  `__Host-laf_cihaz` (bilinen cihaz, 1 yıl): `__Host-` öneki sayesinde laffogato.net ya da başka bir alt alan adı bu
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
    bağlı olmayan elle / Excel faturasının kaynağını (`source`) bir kez eskisine döndürür; şema değişmez, eski kod da
    çalışır. Bu sürümden geriye Instant Rollback yapılırsa eski eşitleme e-faturası reddedilen kaydı yine Paraşüt'e bağlı
    bırakır (tutarı kilitli); migration yeniden çalışmaz, o kayıtlar ileri yayınla gelen eşitlemede de düzelmez.
  - **cikista_oturum_kapanir** (`revoked_sessions`, § 6a Çıkış): yalnız yeni tablo, eklemeli. Bu sürümden geriye
    Instant Rollback yapılırsa eski kod tabloya bakmaz: çıkışta kapatılmış oturumların kopyaları yeniden geçer (yalnız
    çerezi kopyalanmış oturumlar için önemli).
  - **kapali_gun_subesi** (`special_days.branch_id`; docs/SUBE.md › Kapalı gün): boş sütun, eklemeli; var olan kapalı
    günler işletme geneli kalır (geri doldurma yok). Geriye Instant Rollback yapılırsa eski kod sütuna bakmaz: şubeli
    kapalı günler bütün şubelerde kapalı sayılır.
  - **satis_tahmini** (satış tahmini: `special_days`, `weather_days`, `forecast_snapshots`): yalnız yeni tablolar,
    eklemeli; eski kod onlara dokunmaz. Sabah işi her gün `api.met.no`'ya bir istek atar (ücretsiz, anahtarsız;
    `WEATHER_CONTACT` isteğe bağlı, § 4); önizlemeler tahmin kaydı ve hava durumu yazmaz.
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
  üstünü kullanmaya başlayınca (`npm ls zod` iç içe zod göstermez) bu satır silinebilir. `npm audit --omit=dev`'de kalan
  iki açık bilerek bırakıldı: `uuid` (`exceljs` 4.4.0 üzerinden, düzeltmesi exceljs'i 3.4.0'a indirmek) ve
  `fast-xml-parser` (düşük önem, düzeltmesi 5.12 ara sürümü).
- Veri yedeği: Neon'un otomatik nokta-zaman geri yüklemesi (point-in-time restore) küçük planlarda yalnız birkaç saat
  ya da gün geriye gider. Uzun süreli yedek: **Ayarlar › Yedek › Yedeği indir** (parolayla) paneldeki bütün veriyi tek
  `.json.gz` dosyasında indirir; ayda bir alınır, 30 günü geçince zil hatırlatır. Geri yükleme yalnız bilgisayardan:
  `npm run db:restore -- <dosya>` (dolu veritabanına `--sil`, önce onun yedeğini alır). Biçim, adımlar, prova ve geri
  yüklemeden sonra olanlar: [YEDEK.md](YEDEK.md). Kasa ve fiş fotoğraflarının dosyaları yedekte yoktur (yalnız
  kayıtları); dosyalar özel Vercel Blob deposunda kalır ([FOTOGRAF.md](FOTOGRAF.md)). Aynı karttaki **Excel kopyası** okunabilir bir .xlsx'tir: panel
  sekmeleri ve bütün ayların satış, ay bilgisi, gelir-gider, sayım ve alım miktarı kayıtları. Aylık harcamaların tek
  tek kayıtları (yalnız Gelir-Gider'de ay toplamı), hatırlatıcılar, kullanıcılar ve Paraşüt bağlantıları o dosyada
  yoktur; Excel kopyası panele geri yüklenmez.
- Veriyi Excel'in ilk hâline döndürmek için yerel makineden production veritabanı adresiyle şunu çalıştırın:

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
  Ödemeler › Son ödenenler listesi ile bildirim günlüğü silinip Excel verisi yeniden yüklenir. Faturaların ödendi / talep edildi işaretleri de gider; ödeme takibinin başlangıcı
  sıfırlanır. Ürünler zayi oranlarını kategorilerinden alır (kahve %5, tatlı %20, çay %40…; `src/lib/fire-defaults.ts`).
  **Silinmeyenler:** kullanıcılar, aylık harcama kategorileri (kayıtları silinir), hatırlatıcılar,
  bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları, tedarikçi cari kartları, günlük işlerin çalışma kayıtları,
  fotoğraflar, kasadan çıkanlar ve okuma kayıtları, zayi ve ikram kayıtları (Excel'de aynı kimlik ve adla geri gelen ürüne
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

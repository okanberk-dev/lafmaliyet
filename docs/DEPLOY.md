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
   çalıştırmaz (§ 3); `main` dışındaki bir dalın Production derlemesi hiç başlamadan durur (§ 7, "Production yalnız
   main'den").

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
Bu dallardaki değişiklik yerelde `npm run build` ile derlenir. Bir dalda önizleme gerekirse o dalın `vercel.json`'ından
bu satır geçici olarak çıkarılır (ya da dal başka adla açılır).

## 4. Ortam değişkenleri

Proje → **Settings → Environment Variables**. Önizlemeler canlının veritabanını kullandığı sürece (§ 3) gizli değerler
**yalnız Production**'a eklenir: `AUTH_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET`, `KARAOKE_SYNC_SECRET`,
`LAFPOS_SYNC_SECRET`, `PARASUT_*`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`,
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
| `CRON_SECRET` | Günlük işlerin anahtarı (Paraşüt eşitlemesi + sabah e-postası): `openssl rand -hex 32`. Yoksa iki iş de çalışmaz; Paraşüt ekranı "CRON_SECRET eksik", zil ve Genel bakış "Günlük işler kapalı" der |
| `RESEND_API_KEY` | (isteğe bağlı) E-posta gönderimi: sabah e-postası, davet ve parola sıfırlama. Ayrıntı [BILDIRIMLER.md](BILDIRIMLER.md) |
| `EMAIL_FROM` | (isteğe bağlı) Gönderen, ör. `L'Affogato Panel <bildirim@laffogato.net>`; panelden de değiştirilir |
| `APP_URL` | (isteğe bağlı) E-posta ve davet bağlantılarındaki adres; yoksa `https://ladmin.laffogato.net` |
| `KARAOKE_SYNC_SECRET` | (isteğe bağlı) laffogato.net ile karaoke **ve menü** bağlantısı: `openssl rand -base64 48`; **sitedeki değerle aynı** olmalı. Yoksa bağlantı kapalı: hızlı sayaç çalışır, ürünler yalnız panelde. Ayrıntı [KARAOKE.md](KARAOKE.md), [SITE-MENU.md](SITE-MENU.md) (bağlı ürünün fiyatı ve Satışta / Tükendi durumu iki yerde aynı) |
| `LAFFOGATO_URL` | (isteğe bağlı) Sitenin adresi (karaoke ve menü); yoksa `https://laffogato.net` |
| `LAFPOS_SYNC_SECRET` | (isteğe bağlı) LafPOS (kafenin kasası) bağlantısı: gün sonunu iter, ürün maliyetlerini okur. `openssl rand -base64 48`; **LafPOS'taki `LAFMALIYET_SYNC_SECRET` ile aynı**, sitenin anahtarından (`KARAOKE_SYNC_SECRET`) ve sitenin kendi `LAFPOS_SYNC_SECRET`'ından ayrı; `KARAOKE_SYNC_SECRET`'la aynıysa bağlantı açılmaz. Yoksa iki uç 503 döner (bugün bilerek yok: kafede ModPOS var). Açma sırası ve geçiş günü [LAFPOS.md](LAFPOS.md) › Açılış sırası |
| `CASH_REPORT_RECIPIENTS` | (isteğe bağlı, yalnız Production) Kasa raporunun alıcıları, yönetici panelden hiç kaydetmediyse: virgülle ayrılmış e-postalar. Panelde kaydedilen liste her zaman önce gelir ([KASA-RAPORU.md](KASA-RAPORU.md)) |
| `MIGRATE_ON_PREVIEW` | (yalnız Preview, isteğe bağlı) `1`: önizlemelerin **kendi** veritabanı varsa (Neon önizleme dalları) önizleme derlemesi de migration uygular. Önizleme canlının veritabanını kullanıyorsa tanımlamayın (§ 3) |
| `ALLOW_BRANCH_PRODUCTION` | (yalnız acil durumda, tek derleme için) `1`: `main` dışındaki bir dalın Production derlemesine bilerek izin verir; derleme günlüğüne uyarı yazılır. Proje ayarlarına **eklemeyin**: `vercel deploy --prod --build-env ALLOW_BRANCH_PRODUCTION=1` ile yalnız o derlemeye verilir (§ 7, "Production yalnız main'den") |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | (isteğe bağlı) Web Push anahtarları; yoksa ilk kullanımda üretilip veritabanında şifreli saklanır |
| `ANTHROPIC_API_KEY` | (isteğe bağlı, **yalnız Production**) Fotoğraftan okuma (Claude): kasa raporunda Z raporu, banka POS fişi ve kasadan çıkan fişler. Yoksa fotoğraf yine eklenir, rakamlar elle yazılır. Ayrıntı [FOTOGRAF.md](FOTOGRAF.md) |
| `BLOB_READ_WRITE_TOKEN` | (isteğe bağlı, **yalnız Production**) Fotoğraf deposu: Vercel › Storage › Blob, erişim **Private**, bölge Frankfurt (fra1). Depoyu projeye bağlayınca kendiliğinden eklenir (yeni bağlantı anahtar yerine `BLOB_STORE_ID` verirse o da yeter). Yoksa fotoğraf düğmeleri görünmez ([FOTOGRAF.md](FOTOGRAF.md)) |
| `PHOTO_DIR` | (yalnız yerel, isteğe bağlı) Fotoğrafların yerel klasörü; yoksa `.data/photos` |
| `MCP_DISABLED` | (isteğe bağlı) `1` ise Claude bağlantısı kapalı (bütün uçlar 404, verilmiş anahtarlar çalışmaz). Önizlemelerde zaten kapalı ([CLAUDE-BAGLANTISI.md](CLAUDE-BAGLANTISI.md)) |
| `MCP_ALLOW_LOCALHOST` | (isteğe bağlı) `1` ise Claude Code / MCP Inspector'ın localhost dönüş adresine canlıda da izin verilir; varsayılan kapalı |
| `WEATHER_CONTACT` | (isteğe bağlı) Satış tahmininin hava durumu isteğinde (MET Norway, ücretsiz, anahtarsız, günde bir istek) kimliğe eklenen iletişim: e-posta ya da adres. Yoksa yalnız uygulamanın adı ve `APP_URL` gider. Panel `api.met.no`'ya bağlanabilmeli; bağlanamazsa tahmin havasız hesaplanır ([SATIS-TAHMINI.md](SATIS-TAHMINI.md)) |
| `DATABASE_SSL` | (isteğe bağlı, yalnız acil durumda) `require`: veritabanı sunucusunun sertifikası doğrulanmaz. Varsayılan doğrulamalı bağlantıdır (`verify-full`; Neon'un sertifikası Let's Encrypt'ten, Node tanır): şifreli ama sertifikası denetlenmeyen bağlantıda araya giren biri kendi sertifikasıyla bütün veriyi okuyabilirdi. Canlı derleme önce havuzlu adresi, sonra migration için doğrudan adresi doğrulamalı açar; biri açılmazsa derleme migration'dan önce durur, ne veritabanı ne yayındaki sürüm değişir. Neon sertifikasını değiştirdiği için derleme durursa geçici olarak `require` yazılır |

`DATABASE_URL` / `DATABASE_URL_UNPOOLED` Neon entegrasyonundan gelir. Paraşüt değişkenleri (`PARASUT_*`) için
[PARASUT.md](PARASUT.md) § 1.

İki günlük iş `vercel.json`'da tanımlı (Vercel Cron, Türkiye saatiyle): `/api/cron/parasut` 07:00–08:00 arasında
Paraşüt'ü eşitler, `/api/cron/gunluk` 08:00–09:00 arasında sabah e-postasını gönderir. Vercel → Settings → Cron Jobs
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

Önizleme derlemesinde bunların yerine `! Önizleme dağıtımı …: migration ve seed atlandı` yazar. `main` dışındaki bir dal
Production'a derlenirse derleme `✗ Production derlemesi yalnız main dalından yapılır; bu derlemenin dalı: …` diye durur
(§ 7). Sonra
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
  yapma ve (kendiniz ve son aktif yönetici hariç) kalıcı silme. **Kendi satırınızda** e-posta, parola, iki adımlı
  sıfırlama ve sıfırlama bağlantısı yoktur: bunlar Hesabım'da mevcut parolayla değişir (oradaki parola onayı
  buradan atlanamasın). Ortak cihazda işiniz bitince çıkış yapın; unuttuysanız başka bir cihazdan
  Hesabım › Oturumlar › Diğer cihazlardaki oturumları kapat.
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
  vardır. Bu "bilinen cihaz" kaydı kişinin oturum sürümüne bağlıdır: parola değişince, iki adımlı açılıp kapanınca
  ya da oturumlar kapatılınca öteki tarayıcılar için geçmez, bir sonraki başarılı girişte yeniden tanınır. Önceki
  sürümün cihaz kaydı (oturum sürümsüz) 25 Kasım 2026'ya kadar tanınır (`LEGACY_DEVICE_UNTIL`): o zamana kadar herkes
  en az bir kez girer (oturum en çok 30 gün) ve kayıt yeni biçimde yazılır. Bir IP adresinden 15 dakikada en çok 20
  deneme yapılabilir (başarılı giriş sayılmaz).
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
  açar); bir bağlantıyla en fazla 10 deneme yapılır.
- Bağlantılar `user_tokens` tablosunda durur: yalnızca anahtarın sha256 özeti, son geçerlilik, kullanım anı ve deneme
  sayısı. Ham anahtar (32 rastgele bayt, base64url) yalnızca oluşturulduğu anda bir kez gösterilir, günlüğe yazılmaz.
  Bir kişinin aynı anda tek geçerli bağlantısı olur; 30 günden eski satırlar kendiliğinden silinir. Tablo
  `drizzle/0008_kullanici_davet.sql` ile gelir (deploy'da `npm run build` öncesi migration çalışır).
- `APP_URL` bağlantılardaki adrestir (yoksa `https://ladmin.laffogato.net`); önizleme ortamında kendi adresini yazın.
- **Hesabım:** ad ve giriş e-postası (parolayla onay), parola değiştirme, iki adımlı doğrulama (açmak, kapatmak ve
  yeni kurtarma kodu parola ister): QR kodu Google Authenticator / Microsoft Authenticator / 1Password ile okutulur,
  8 tek seferlik kurtarma kodu verilir. Telefon kaybolursa girişte "Telefonum yanımda değil" ile kurtarma kodu
  kullanılır ya da bir yönetici sıfırlar. **Oturumlar › Diğer cihazlardaki oturumları kapat** (parolayla): kasa
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
  - Migration'lar eklemeli ya da geriye uyumlu olsun: Vercel'in Instant Rollback'i yeniden derlemez, eski kod yeni
    şemada çalışır (sütun silmek, adını değiştirmek, NOT NULL varsayılansız sütun eklemek eski kodu bozar). Geriye
    uyumsuz bir migration'dan sonra Instant Rollback yapmayın; düzeltmeyi ileri yayınlayın.
  - **kasa_ay_bilgisi_butunluk** (kasa bütünlüğü ve kasa raporlarından ay bilgisi): ay bilgisinin indirim ve ödenmezi
    artık boş olabilir (boş = kasa raporlarından), eski kod boş beklemez. Bu sürümden geriye Instant Rollback
    yapmayın; düzeltmeyi ileri yayınlayın.
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

  Bu bilgisayarda olmayan veritabanında komut sunucu adıyla onay ister (`--onay=` yoksa terminalde sorar; adı yanlışsa
  hiçbir şey silinmez): `.env.local` canlının adresini gösteriyorsa yerel sanılan bir sıfırlama canlıyı silmesin. Silmeden
  önce bütün verinin yedeği ev klasörüne yazılır (`laffogato-yedek-once-<sunucu>-….json.gz`, yüklenen belgeler dahil);
  yanlışlıkla sıfırlandıysa `npm run db:restore -- <o dosya> --sil --onay=<sunucu>` ile geri gelir ([YEDEK.md](YEDEK.md)).

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

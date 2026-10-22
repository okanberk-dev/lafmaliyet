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
   çalıştırmaz (§ 3).

## 3. Veritabanı (Neon)

1. Proje → **Storage → Create Database → Neon (Postgres)**.
2. Bölge: **Frankfurt (aws-eu-central-1)**. Fonksiyonlar `vercel.json` ile Frankfurt'ta (`fra1`) çalışıyor;
   Türkiye'ye en yakın seçenek bu.
3. Veritabanını projeye bağlayın. `DATABASE_URL` ve `DATABASE_URL_UNPOOLED` değişkenleri otomatik eklenir.

**Önizlemeler ve migration.** `DATABASE_URL` hem Production hem Preview ortamında aynı veritabanını gösteriyor:
önizleme (PR) dağıtımları canlının verisini kullanır. Bu yüzden derleme öncesi hazırlık (`scripts/predeploy.ts`)
önizlemede **migration ve seed çalıştırmaz** (`! Önizleme dağıtımı …: migration ve seed atlandı`); migration yalnız
canlı dağıtımda, kod yayına çıkarken uygulanır. 21 Eki 2026'da bir önizleme, birleşmemiş bir dalın migration'ını
canlıya uygulamıştı. Sonucu: yeni sütun isteyen bir PR'ın önizlemesi o sütun canlıya gelene kadar hata verebilir;
canlı veri korunur. Önizlemelere ayrı veritabanı vermek için Vercel › Storage › Neon'da önizleme dalları açılır ve
Preview ortamına `MIGRATE_ON_PREVIEW=1` eklenir; o zaman her önizleme kendi dalına migration uygular.

## 4. Ortam değişkenleri

Proje → **Settings → Environment Variables** (Production ve Preview):

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
| `CASH_REPORT_RECIPIENTS` | (isteğe bağlı, yalnız Production) Kasa raporunun alıcıları, yönetici panelden hiç kaydetmediyse: virgülle ayrılmış e-postalar. Panelde kaydedilen liste her zaman önce gelir ([KASA-RAPORU.md](KASA-RAPORU.md)) |
| `MIGRATE_ON_PREVIEW` | (yalnız Preview, isteğe bağlı) `1`: önizlemelerin **kendi** veritabanı varsa (Neon önizleme dalları) önizleme derlemesi de migration uygular. Önizleme canlının veritabanını kullanıyorsa tanımlamayın (§ 3) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | (isteğe bağlı) Web Push anahtarları; yoksa ilk kullanımda üretilip veritabanında şifreli saklanır |

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

Önizleme derlemesinde bunların yerine `! Önizleme dağıtımı …: migration ve seed atlandı` yazar. Sonra
`https://<proje>.vercel.app/giris` adresinden giriş yapın. Sağlık kontrolü: `/api/health` (günlük işlerle birlikte:
`/api/health?isler=1`).

## 6. Alan adı (ladmin.laffogato.net)

Panel `ladmin.laffogato.net` alt alan adında çalışıyor; kafenin sitesi `laffogato.net` / `www.laffogato.net` ayrı
`laffogato` projesinde kalıyor. `laffogato.net`'in ad sunucuları Vercel'de olduğu için ek DNS kaydı gerekmedi:
alan adı `lafmaliyet` projesine eklendi (`vercel domains add ladmin.laffogato.net`), sertifika otomatik çıktı.
`/` adresi panele (giriş yapılmamışsa giriş sayfasına) yönlendirir; QR menü `ladmin.laffogato.net/menu`.

Panel arama motorlarına kapalıdır: `robots.txt` her şeyi engeller, her yanıtta `X-Robots-Tag: noindex, nofollow`
başlığı ve sayfalarda `noindex` etiketi vardır. `lafmaliyet.vercel.app` adresi sayfalar için `ladmin.laffogato.net`'e
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
  buradan atlanamasın). Yöneticiler bütün kullanıcıları yönetir: açık kalmış bir yönetici oturumu yeni bir yönetici
  açıp onunla her şeyi değiştirebilir. Ortak cihazda işiniz bitince çıkış yapın; unuttuysanız başka bir cihazdan
  Hesabım › Oturumlar › Diğer cihazlardaki oturumları kapat.
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
  onayları kişi başına 15 dakikada 5 hatayla sınırlıdır; hatalar işlem geçmişine yazılır.
- Kurtarma kodları kişiye özel tuzlu, yavaş bir özetle (scrypt) saklanır; veritabanı sızsa bile kodlar denenerek
  bulunamaz. Önceki biçimde saklanmış kodlar yenilenene kadar çalışır.
- Doğrulama anahtarı veritabanında `AUTH_SECRET`'tan türetilen anahtarla şifrelidir; `AUTH_SECRET` değişirse iki
  adımlı doğrulama yeniden kurulmalıdır.

**QR menü.** Müşterinin tam menüsü `https://laffogato.net/menu`'dedir: alerjenler (Gıda Etiketleme Yönetmeliği) ve
fiyat listesinin tarihi (Fiyat Etiketi Yönetmeliği) oradadır, panelin menüsünde yoktur. Yeni QR basılacaksa
`https://laffogato.net/menu` için oluşturun (masalardaki QR kartları zaten sitenin masa sayfasını açar). Panelin kendi
menüsü (`ladmin.laffogato.net/menu`) **Ayarlar → QR menü → Menüyü yayınla** ile açılır; yayında değilken ya da
gösterilecek ürün yokken müşteriyi `laffogato.net/menu`'ye yönlendirir (yönetici önizlemesi `?onizleme=1` hariç),
yayındayken de alerjen bilgisi için oraya bağlantı verir. Sitenin adresi `LAFFOGATO_URL`'den gelir.

## 7. Güncelleme ve yedek

- Kodda değişiklik yapıp Git'e gönderdiğinizde Vercel yeniden deploy eder. Şema değiştiyse `npm run db:generate`
  ile migration üretip onu da gönderin; canlı derlemede otomatik uygulanır (önizlemede uygulanmaz, § 3).
- **Migration kuralları.** Drizzle bir migration'ı yalnız günlükteki zamanı (`drizzle/meta/_journal.json` › `when`,
  üretildiği an) veritabanındaki en yeni kayıttan sonraysa uygular; daha yeni tarihli bir migration önce uygulandıysa
  eskisi **hata vermeden atlanır**. Bu yüzden:
  - Migration'ı dalı main'le birleştirdikten hemen sonra üretin (`npm run db:generate -- --name <ad>`). Önce
    üretilmiş bir migration'ı olan dal main'e geç kalırsa: dalı main'le birleştirin, `drizzle/meta/_journal.json`'ı
    main'dekiyle değiştirin, dalın kendi `drizzle/00NN_*.sql` ve `drizzle/meta/00NN_snapshot.json` dosyalarını silin,
    yeniden üretin. Migration'lı dallar birer birer birleştirilir. `tests/migrations.test.ts` günlükteki zamanlar
    sırayla artmıyorsa düşer.
  - Uygulanmış bir migration elle değiştirilmez (tek istisna: 0018'deki gibi `IF NOT EXISTS` onarımı, inceleyen
    isterse).
  - Migration'lar eklemeli ya da geriye uyumlu olsun: Vercel'in Instant Rollback'i yeniden derlemez, eski kod yeni
    şemada çalışır (sütun silmek, adını değiştirmek, NOT NULL varsayılansız sütun eklemek eski kodu bozar). Geriye
    uyumsuz bir migration'dan sonra Instant Rollback yapmayın; düzeltmeyi ileri yayınlayın.
- **"Migration uygulanmadı" hatası.** Canlı derleme (ve `npm run db:migrate`) migration'dan sonra günlükteki her
  girdinin `drizzle.__drizzle_migrations`'ta kaydını arar (`scripts/migration-check.ts`). Eksik varsa derleme
  `Migration uygulanmadı: 0021_x … (sıra bozuk)` diye durur ve yayındaki sürüm değişmez. Çözüm: yukarıdaki gibi
  migration'ı main'in ardına yeniden üretip gönderin. Şema değişikliği canlıda zaten varsa (ör. bir önizleme uyguladı),
  eksik satır elle eklenir: `insert into drizzle.__drizzle_migrations (hash, created_at) values ('<sha256>', <when>)`
  (değerler günlükten; yalnız şemanın gerçekten aynı olduğu doğrulandıktan sonra).
- **"Veritabanında depoda olmayan N migration kaydı var" uyarısı** derlemeyi durdurmaz: günlükte olmayan bir kayıt
  (bir önizlemenin ya da birleşmemiş bir dalın uyguladığı). Canlıda bir tane bilinen kayıt var: 21 Eki 2026'da bir
  önizlemenin erken uyguladığı menü migration'ı; aynı değişiklik 0018 olarak `IF NOT EXISTS` ile yeniden uygulandı.
  Yeni bir uyarı görünürse hangi dalın uyguladığına ve şemanın koddakiyle aynı olduğuna bakın
  (`select created_at, hash from drizzle.__drizzle_migrations order by created_at`).
- Veri yedeği: asıl yedek Neon'un otomatik nokta-zaman geri yüklemesidir (point-in-time restore). Panelde
  **Ayarlar → Yedek → Tüm veriyi Excel'e aktar** ile istediğiniz an okunabilir bir .xlsx kopyası alınır: panel
  sekmeleri ve bütün ayların satış, ay bilgisi, gelir-gider, sayım ve alım miktarı kayıtları. Aylık harcamaların tek
  tek kayıtları (yalnız Gelir-Gider'de ay toplamı), hatırlatıcılar, kullanıcılar ve Paraşüt bağlantıları dosyada
  yoktur; dosya panele geri yüklenmez.
- Veriyi Excel'in ilk hâline döndürmek için yerel makineden production veritabanı adresiyle şunu çalıştırın:

```bash
DATABASE_URL="<neon bağlantı adresi>" npm run db:reset
```

  Dikkat: ürünler, hammaddeler, satışlar, faturalar (belge ve kalemleriyle), sabit giderler, personel, gelir-gider
  düzeltmeleri, sayımlar, ay bilgileri, ayarlar, POS eşleştirmeleri, aylık harcama kayıtları, işlem geçmişi, Paraşüt
  eşitleme geçmişi, imleci ve ürün bağlantıları, ürünlerin laffogato.net menü bağlantıları ve eşitleme durumu,
  Ödemeler › Son ödenenler listesi ile bildirim günlüğü silinip Excel verisi yeniden yüklenir. Faturaların ödendi / talep edildi işaretleri de gider; ödeme takibinin başlangıcı
  sıfırlanır. **Silinmeyenler:** kullanıcılar, aylık harcama kategorileri (kayıtları silinir), hatırlatıcılar,
  bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları, tedarikçi cari kartları, günlük işlerin çalışma kayıtları. Sonraki eşitleme
  Paraşüt faturalarını baştan alır: son 30 günün faturaları "ödenmedi", daha eskileri Paraşüt'teki durumuyla gelir.

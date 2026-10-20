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
3. Build komutu değişmez (`npm run build`). Bu komut önce migration'ları uygular, veritabanı boşsa Excel verisini
   yükler, sonra derler.

## 3. Veritabanı (Neon)

1. Proje → **Storage → Create Database → Neon (Postgres)**.
2. Bölge: **Frankfurt (aws-eu-central-1)**. Fonksiyonlar `vercel.json` ile Frankfurt'ta (`fra1`) çalışıyor;
   Türkiye'ye en yakın seçenek bu.
3. Veritabanını projeye bağlayın. `DATABASE_URL` ve `DATABASE_URL_UNPOOLED` değişkenleri otomatik eklenir.

## 4. Ortam değişkenleri

Proje → **Settings → Environment Variables** (Production ve Preview):

| Değişken | Değer |
|----------|-------|
| `AUTH_SECRET` | En az 32 karakterlik rastgele değer: `openssl rand -base64 48` |
| `ADMIN_EMAIL` | İlk yönetici hesabının e-postası |
| `ADMIN_PASSWORD` | İlk yönetici parolası (en az 8 karakter; ilk girişten sonra **Hesabım** sayfasından değiştirin) |
| `ADMIN_NAME` | Görünecek ad (ör. Okan) |

`DATABASE_URL` / `DATABASE_URL_UNPOOLED` Neon entegrasyonundan gelir.

## 5. Deploy

**Deploy** düğmesine basın. Build günlüğünde şunları görmelisiniz:

```
✓ Veritabanı şeması güncel
✓ Excel verisi yüklendi: 74 hammadde, 129 ürün, 699 reçete satırı, 125 satış satırı, 81 fatura
✓ Yönetici hesabı oluşturuldu: …
```

Sonra `https://<proje>.vercel.app/giris` adresinden giriş yapın. Sağlık kontrolü: `/api/health`.

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
  pencereden sonra bir daha gösterilmez.
- Kullanıcıyı düzenle › **Güvenlik:** parola sıfırlama bağlantısı (24 saat, kişinin mevcut parolası bağlantı
  kullanılana kadar çalışır), kilit açma, iki adımlı doğrulamayı sıfırlama, bütün oturumları kapatma. Ayrıca pasif
  yapma ve (kendiniz ve son aktif yönetici hariç) kalıcı silme.
- **Giriş sayfası › Parolamı unuttum:** e-posta istenir, yanıt her durumda aynıdır ("kayıtlıysa bağlantı
  gönderildi"). Resend kuruluysa 2 saatlik sıfırlama bağlantısı gider; kurulu değilse kişiye yöneticisine
  başvurması söylenir. Sınırlar: aynı IP'den 15 dakikada 10, aynı e-postaya saatte 3 istek, kişi başına saatte en
  fazla 3 bağlantı.
- **/davet** sayfası herkese açıktır (oturum gerektirmez, oturum açmaz): ad ve e-postayı gösterir, yeni parola +
  tekrarı (en az 8) ister, kaydedince bağlantıyı kullanılmış sayar, kişinin açık oturumlarını kapatır ve
  "Parolanız kaydedildi" mesajıyla `/giris`'e geçer. Sayfayı açmak bağlantıyı tüketmez (WhatsApp önizlemesi de
  açar); bir bağlantıyla en fazla 10 deneme yapılır.
- Bağlantılar `user_tokens` tablosunda durur: yalnızca anahtarın sha256 özeti, son geçerlilik, kullanım anı ve deneme
  sayısı. Ham anahtar (32 rastgele bayt, base64url) yalnızca oluşturulduğu anda bir kez gösterilir, günlüğe yazılmaz.
  Bir kişinin aynı anda tek geçerli bağlantısı olur; 30 günden eski satırlar kendiliğinden silinir. Tablo
  `drizzle/0008_kullanici_davet.sql` ile gelir (deploy'da `npm run build` öncesi migration çalışır).
- `APP_URL` bağlantılardaki adrestir (yoksa `https://ladmin.laffogato.net`); önizleme ortamında kendi adresini yazın.
- **Hesabım:** ad ve giriş e-postası (parolayla onay), parola değiştirme, iki adımlı doğrulama: QR kodu Google
  Authenticator / Microsoft Authenticator / 1Password ile okutulur, 8 tek seferlik kurtarma kodu verilir. Telefon
  kaybolursa girişte "Telefonum yanımda değil" ile kurtarma kodu kullanılır ya da bir yönetici sıfırlar.
- Doğrulama anahtarı veritabanında `AUTH_SECRET`'tan türetilen anahtarla şifrelidir; `AUTH_SECRET` değişirse iki
  adımlı doğrulama yeniden kurulmalıdır.

QR menüyü yayınlamak için panelde **Ayarlar → QR menü → Menüyü yayınla** seçeneğini açın. QR kodu tarayıcınızın
"QR kodu oluştur" özelliğiyle ya da herhangi bir QR üreticisiyle `https://<alan adı>/menu` için oluşturabilirsiniz.

## 7. Güncelleme ve yedek

- Kodda değişiklik yapıp Git'e gönderdiğinizde Vercel yeniden deploy eder. Şema değiştiyse `npm run db:generate`
  ile migration üretip onu da gönderin; build sırasında otomatik uygulanır.
- Veri yedeği: Neon'un otomatik nokta-zaman geri yüklemesi (point-in-time restore) var. Ayrıca panelde
  **Ayarlar → Tüm veriyi Excel'e aktar** ile istediğiniz an .xlsx yedeği alabilirsiniz.
- Veriyi Excel'in ilk hâline döndürmek için (dikkat: kullanıcılar dışındaki her şey silinir), yerel makineden
  production veritabanı adresiyle şunu çalıştırın:

```bash
DATABASE_URL="<neon bağlantı adresi>" npm run db:reset
```

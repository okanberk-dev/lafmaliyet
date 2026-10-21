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
| `CRON_SECRET` | Günlük işlerin anahtarı (Paraşüt eşitlemesi + sabah e-postası): `openssl rand -hex 32`. Yoksa iki iş de çalışmaz, Paraşüt ekranı "CRON_SECRET eksik" der |
| `RESEND_API_KEY` | (isteğe bağlı) E-posta gönderimi: sabah e-postası, davet ve parola sıfırlama. Ayrıntı [BILDIRIMLER.md](BILDIRIMLER.md) |
| `EMAIL_FROM` | (isteğe bağlı) Gönderen, ör. `L'Affogato Panel <bildirim@laffogato.net>`; panelden de değiştirilir |
| `APP_URL` | (isteğe bağlı) E-posta ve davet bağlantılarındaki adres; yoksa `https://ladmin.laffogato.net` |
| `KARAOKE_SYNC_SECRET` | (isteğe bağlı) laffogato.net ile karaoke **ve menü** bağlantısı: `openssl rand -base64 48`; **sitedeki değerle aynı** olmalı. Yoksa bağlantı kapalı: hızlı sayaç çalışır, ürünler yalnız panelde. Ayrıntı [KARAOKE.md](KARAOKE.md), [SITE-MENU.md](SITE-MENU.md) (bağlı ürünün fiyatı ve Satışta / Tükendi durumu iki yerde aynı) |
| `LAFFOGATO_URL` | (isteğe bağlı) Sitenin adresi (karaoke ve menü); yoksa `https://laffogato.net` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | (isteğe bağlı) Web Push anahtarları; yoksa ilk kullanımda üretilip veritabanında şifreli saklanır |

`DATABASE_URL` / `DATABASE_URL_UNPOOLED` Neon entegrasyonundan gelir. Paraşüt değişkenleri (`PARASUT_*`) için
[PARASUT.md](PARASUT.md) § 1.

İki günlük iş `vercel.json`'da tanımlı (Vercel Cron, Türkiye saatiyle): `/api/cron/parasut` 07:00–08:00 arasında
Paraşüt'ü eşitler, `/api/cron/gunluk` 08:00–09:00 arasında sabah e-postasını gönderir. Vercel → Settings → Cron Jobs
ekranında görünür, **Run** ile elle çalıştırılır.

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
- **Giriş kilidi:** 5 hatalı denemede hesap 15 dakika kilitlenir. Daha önce bu hesapla giriş yapılmış tarayıcı bu
  kilide takılmaz (başkası adresinizi bilip hesabı kilitleyerek sizi dışarıda bırakamasın); o tarayıcının kendi 10
  deneme hakkı vardır. Bir IP adresinden 15 dakikada en çok 20 hatalı deneme yapılabilir.
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
  bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları, tedarikçi cari kartları. Sonraki eşitleme
  Paraşüt faturalarını baştan alır: son 30 günün faturaları "ödenmedi", daha eskileri Paraşüt'teki durumuyla gelir.

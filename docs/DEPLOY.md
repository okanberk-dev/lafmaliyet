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

## 6. Alan adı (laffogato.net)

İki seçenek var:

- **Bütün site bu uygulama olsun:** Vercel → Settings → Domains → `laffogato.net` ve `www.laffogato.net` ekleyin.
  Alan adı sağlayıcınızda Vercel'in gösterdiği DNS kayıtlarını girin (genelde apex için `A 76.76.21.21`, `www` için
  `CNAME cname.vercel-dns.com`). Ana sayfa `/`, QR menü `/menu`, yönetim `/panel` olur.
- **Mevcut siteniz kalsın:** `panel.laffogato.net` gibi bir alt alan adı ekleyin (`CNAME cname.vercel-dns.com`).
  QR menü için `panel.laffogato.net/menu` adresini kullanın ya da ana sitenizden bu adrese bağlantı verin.

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

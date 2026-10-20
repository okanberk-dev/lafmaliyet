# L'Affogato — Maliyet & Kârlılık Paneli

`L'Affogato – Maliyet & Kârlılık.xlsx` dosyasının web uygulaması. Excel'deki 13 sayfanın her biri burada bir ekrana
karşılık geliyor. Hesaplama motoru Excel formüllerini birebir uyguluyor ve bunu otomatik testler kanıtlıyor. Excel'de
olmayan araçlar da eklendi: ay bazlı çalışma, POS eşleştirme hafızası, fiyat geçmişi, uyarılar, menü mühendisliği,
senaryo simülatörü, Excel'e aktarım, QR menü, aylık harcamalar, Paraşüt'ten her sabah otomatik fatura eşitlemesi
([docs/PARASUT.md](docs/PARASUT.md)), ödemeler ve hatırlatıcılar ile sabah e-postası
([docs/BILDIRIMLER.md](docs/BILDIRIMLER.md)).

- **Adres:** https://ladmin.laffogato.net (kafenin sitesi laffogato.net ayrı projede kalır)
- **Frontend:** Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4, Recharts, Motion
- **Arayüz:** [AkmanOS](https://akmanos.com) bileşen kütüphanesinin açık teması (`src/components/akmanos/`), L'Af logosu
  laffogato deposundan. Tasarım kuralları [docs/TASARIM.md](docs/TASARIM.md)
- **Backend:** Next.js Server Actions + Route Handlers (Vercel Functions), Postgres (Neon), Drizzle ORM
- **Oturum:** imzalı JWT çerezi (jose) ve scrypt parola özeti. Roller: yönetici ve personel (**Ayarlar › Kullanıcılar &
  roller**). İsteğe bağlı iki adımlı doğrulama (TOTP, Google/Microsoft Authenticator) ve kurtarma kodları
  (**Hesabım**); 5 hatalı denemede 15 dakika kilit; parola, rol ya da erişim değişince eski oturumlar kapanır
- **Gizlilik:** arama motorlarına kapalı (`robots.txt` Disallow, her yanıtta `X-Robots-Tag: noindex`), güvenlik
  başlıkları `next.config.ts`'te; `lafmaliyet.vercel.app` panelin tek adresine (`ladmin.laffogato.net`) yönlenir

Geliştirilmiş prompt, görev planı, Excel analizi ve bulunan tutarsızlıklar [docs/PROMPT-VE-PLAN.md](docs/PROMPT-VE-PLAN.md)
dosyasında. Vercel kurulumu için [docs/DEPLOY.md](docs/DEPLOY.md).

## Ekranlar

| Ekran | Adres | Excel karşılığı |
|-------|-------|-----------------|
| Genel bakış | `/panel` | Panel |
| Ürünler, reçete kartı | `/panel/urunler`, `/panel/urunler/[id]` | Ürün Kârlılık, Reçete Kartları |
| Hammaddeler | `/panel/hammaddeler` | Hammaddeler |
| Reçete defteri (barista) | `/panel/receteler` | — |
| Satışlar | `/panel/satislar` | Satış Raporu |
| Faturalar (Paraşüt'ten her sabah gelir; karaoke box ve Alp Koç kafe dışı, toplama girmez) | `/panel/faturalar` | Faturalar |
| Gelir-gider | `/panel/gelir-gider` | Genel Maliyet |
| Giderler & personel (üç sekme: Sabit giderler, Aylık harcamalar, Personel) | `/panel/giderler`, `/panel/harcamalar`, `/panel/personel` | Sabit Giderler, — (yeni), Personel |
| Ödemeler & hatırlatıcılar (Son ödenenler: 30 gün içinde geri alma) | `/panel/hatirlaticilar` | — (yeni) |
| Stok sayımı, tutarlılık (iki sekme) | `/panel/sayim`, `/panel/tutarlilik` | Sayım, Tutarlılık Kontrolü |
| Analiz & senaryo | `/panel/analiz` | — (yeni) |
| Ayarlar, işlem geçmişi, yedek | `/panel/ayarlar` | Ayarlar |
| Kullanıcılar & roller | `/panel/kullanicilar` | — (yeni) |
| Paraşüt entegrasyonu (eşitleme, ürün → hammadde bağlantıları, kategori kuralları) | `/panel/parasut` | — (yeni) |
| Hesabım (profil menüsü) | `/panel/hesap` | — (yeni) |
| Yardım | `/panel/yardim` | Nasıl Kullanılır |
| Giriş, davetle parola belirleme, QR menü (`/` panele yönlendirir) | `/giris`, `/davet`, `/menu` | — (yeni) |
| Excel'e aktar / sağlık / menü JSON / fatura belgesi ve kalemleri | `/api/export`, `/api/health`, `/api/menu`, `/api/faturalar/[id]/belge`, `/api/faturalar/[id]/kalemler` | — |
| Günlük işler (Vercel Cron): Paraşüt eşitlemesi, sabah e-postası | `/api/cron/parasut`, `/api/cron/gunluk` | — |

Menü kenar çubuğunda yedi öğeye toplandı: Genel bakış · Menü (Ürünler, Hammaddeler, Reçete defteri) · Satış & gider
(Satışlar, Faturalar, Gelir-gider, Giderler & personel, Ödemeler & hatırlatıcılar) · Stok (Stok sayımı, Tutarlılık) ·
Analiz & senaryo · Ayarlar (Genel ayarlar, Kullanıcılar & roller, Paraşüt entegrasyonu) · Yardım. Telefonda altta
Genel bakış · Satışlar · Faturalar · Ödemeler · Menü çubuğu var. ⌘K (Ctrl+K) ile ekran, ürün ve hammadde aranır; zil
ödemeleri (gecikmiş, bugün, yakında), fatura bildirimlerini (Paraşüt eşitlemesi, yeni ve kontrol bekleyen faturalar,
bağlanmayı bekleyen ürünler) ve uyarıları (hammadde zammı, son satış ayının uyarıları) gösterir; profil menüsünde
Hesabım ve çıkış var.

Personel rolü yalnızca **Stok sayımı**, **Reçete defteri** ve **Hesabım** ekranlarını görür. Maliyet, maaş ve kâr
bilgileri personele gösterilmez.

## Yerelde çalıştırma

Gerekenler: Node.js 24.x (Vercel'deki sürüm, `package.json` › `engines`; 20.19+ ve 22 de çalışır ama npm
`EBADENGINE` uyarısı verir) ve PostgreSQL 14+.

```bash
npm install
```

`.env.example` dosyasını `.env.local` adıyla kopyalayıp değerleri doldurun (`DATABASE_URL`, `AUTH_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`). Sonra:

```bash
createdb laffogato
```

```bash
npm run db:migrate && npm run db:seed
```

```bash
npm run dev
```

Uygulama http://localhost:3000 adresinde açılır. Panel girişi `/giris` sayfasında; ilk yönetici hesabı
`.env.local` dosyasındaki `ADMIN_EMAIL` ve `ADMIN_PASSWORD` ile oluşturulur.

## Komutlar

| Komut | Ne yapar |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Migration'ları uygular, veritabanı boşsa Excel verisini yükler, ardından production build alır |
| `npm test` | Bütün testleri çalıştırır (`tests/*.test.ts`): hesaplama motorunu Excel'in değerlerine karşı (129 ürün, 125 satış satırı, panel, gelir-gider, tutarlılık) ve ekran kurallarını |
| `npm run lint` | ESLint |
| `npm run db:generate` | Şema değişince yeni migration üretir (`drizzle/`) |
| `npm run db:migrate` | Migration'ları uygular |
| `npm run db:seed` | Veritabanı boşsa Excel verisini yükler |
| `npm run db:reset` | Excel verisini yeniden yükler. Önce ürünleri, hammaddeleri, satışları, faturaları (belge ve kalemleriyle), sabit giderleri, personeli, gelir-gider düzeltmelerini, sayımları, ay bilgilerini, ayarları, POS eşleştirmelerini, işlem geçmişini, Paraşüt eşitleme geçmişini ve ürün bağlantılarını, bildirim günlüğünü siler. **Silmedikleri:** kullanıcılar, aylık harcamalar (kategoriler ve kayıtlar), hatırlatıcılar, bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları; kalan harcama kayıtları gelir-gideri Excel'den ayırır |
| `npm run excel:extract -- "<excel yolu>"` | Excel'den `excel-data.json` ve `tests/golden.json` dosyalarını yeniden üretir (Python 3 + openpyxl gerekir) |

## Klasör yapısı

```
src/
  app/                 sayfalar (panel/*, giris, menu) ve API uçları (api/*)
  components/          arayüz bileşenleri: ui/* (paylaşılan), panel/* (kabuk), akmanos/* (AkmanOS kaynağı), grafikler
  lib/calc/            hesaplama motoru: Excel formüllerinin saf TypeScript karşılığı
    engine.ts          hammadde → reçete → ürün → satış → gelir-gider → stok
    insights.ts        panel, uyarılar, tutarlılık, menü mühendisliği, senaryo
    expr.ts            reçete miktar formülleri (2*ShotCift …) ve Türkçe sayı çözümleme
  server/
    db/                Drizzle şeması, bağlantı ve Excel seed verisi
    auth/              oturum (JWT), parola (scrypt), yetki kontrolü
    actions/           sunucu eylemleri (her biri yetki kontrolü yapar)
    data/              veritabanından hesaplama modelini yükleyen katman
    parasut/           Paraşüt API istemcisi, eşitleme, e-fatura kalemleri (docs/PARASUT.md)
    notify/            sabah e-postası ve Resend gönderimi (docs/BILDIRIMLER.md); jobs/ günlük işlerin anahtar denetimi
  proxy.ts             panel sayfaları için oturum kontrolü (Next 16'da middleware'in yeni adı)
scripts/               migrate, seed, predeploy ve Excel çıkarma betikleri
tests/                 Excel karşılaştırma testleri ve ekran kuralları
drizzle/               SQL migration'ları
```

## Hesaplamaların doğruluğu

`tests/golden.json`, Excel'in kendi hesapladığı değerlerden üretilir. `npm test` şunları karşılaştırır: 129 ürün
kartının maliyet, kâr, marj, önerilen fiyat ve durumu; 125 satış satırının maliyeti ve brüt kârı; Panel'deki Eylül
kâr/zararı, başabaş ve kategori ortalamaları; Temmuz–Ekim gelir-gider tablosu; personel ve sabit gider toplamları;
tutarlılık kontrolündeki kullanım ve fark tutarları. Hepsi Excel ile aynıdır.

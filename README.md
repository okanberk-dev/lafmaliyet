# L'Affogato — Maliyet & Kârlılık Paneli

`L'Affogato – Maliyet & Kârlılık.xlsx` dosyasının web uygulaması. Excel'deki 13 sayfanın her biri burada bir ekrana
karşılık geliyor. Hesaplama motoru Excel formüllerini birebir uyguluyor ve bunu otomatik testler kanıtlıyor. Excel'de
olmayan birkaç araç da eklendi: ay bazlı çalışma, POS eşleştirme hafızası, fiyat geçmişi, uyarılar, menü
mühendisliği, senaryo simülatörü, Excel'e aktarım ve QR menü.

- **Frontend:** Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4, Recharts
- **Backend:** Next.js Server Actions + Route Handlers (Vercel Functions), Postgres (Neon), Drizzle ORM
- **Oturum:** imzalı JWT çerezi (jose) ve scrypt parola özeti. Roller: yönetici ve personel

Geliştirilmiş prompt, görev planı, Excel analizi ve bulunan tutarsızlıklar [docs/PROMPT-VE-PLAN.md](docs/PROMPT-VE-PLAN.md)
dosyasında. Vercel kurulumu için [docs/DEPLOY.md](docs/DEPLOY.md).

## Ekranlar

| Ekran | Adres | Excel karşılığı |
|-------|-------|-----------------|
| Panel | `/panel` | Panel |
| Ürünler & kârlılık, reçete kartı | `/panel/urunler`, `/panel/urunler/[id]` | Ürün Kârlılık, Reçete Kartları |
| Hammaddeler | `/panel/hammaddeler` | Hammaddeler |
| Reçete defteri (barista) | `/panel/receteler` | — |
| Satışlar | `/panel/satislar` | Satış Raporu |
| Faturalar | `/panel/faturalar` | Faturalar |
| Gelir-gider | `/panel/gelir-gider` | Genel Maliyet |
| Sabit giderler | `/panel/giderler` | Sabit Giderler |
| Personel | `/panel/personel` | Personel |
| Stok sayımı | `/panel/sayim` | Sayım |
| Tutarlılık | `/panel/tutarlilik` | Tutarlılık Kontrolü |
| Analiz & senaryo | `/panel/analiz` | — (yeni) |
| Ayarlar, kullanıcılar, işlem geçmişi | `/panel/ayarlar` | Ayarlar |
| Yardım | `/panel/yardim` | Nasıl Kullanılır |
| Herkese açık ana sayfa ve QR menü | `/`, `/menu` | — (yeni) |
| Excel'e aktar / sağlık / menü JSON | `/api/export`, `/api/health`, `/api/menu` | — |

Personel rolü yalnızca **Stok sayımı**, **Reçete defteri** ve **Hesabım** ekranlarını görür. Maliyet, maaş ve kâr
bilgileri personele gösterilmez.

## Yerelde çalıştırma

Gerekenler: Node.js 20.19+ (22 önerilir) ve PostgreSQL 14+.

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
| `npm test` | Hesaplama motorunu Excel'in değerlerine karşı test eder (129 ürün, 125 satış satırı, panel, gelir-gider, tutarlılık) |
| `npm run lint` | ESLint |
| `npm run db:generate` | Şema değişince yeni migration üretir (`drizzle/`) |
| `npm run db:migrate` | Migration'ları uygular |
| `npm run db:seed` | Veritabanı boşsa Excel verisini yükler |
| `npm run db:reset` | Kullanıcılar hariç bütün veriyi silip Excel verisini yeniden yükler |
| `npm run excel:extract -- "<excel yolu>"` | Excel'den `excel-data.json` ve `tests/golden.json` dosyalarını yeniden üretir (Python 3 + openpyxl gerekir) |

## Klasör yapısı

```
src/
  app/                 sayfalar (panel/*, giris, menu) ve API uçları (api/*)
  components/          arayüz bileşenleri (ui/*, panel/*, grafikler)
  lib/calc/            hesaplama motoru: Excel formüllerinin saf TypeScript karşılığı
    engine.ts          hammadde → reçete → ürün → satış → gelir-gider → stok
    insights.ts        panel, uyarılar, tutarlılık, menü mühendisliği, senaryo
    expr.ts            reçete miktar formülleri (2*ShotCift …) ve Türkçe sayı çözümleme
  server/
    db/                Drizzle şeması, bağlantı ve Excel seed verisi
    auth/              oturum (JWT), parola (scrypt), yetki kontrolü
    actions/           sunucu eylemleri (her biri yetki kontrolü yapar)
    data/              veritabanından hesaplama modelini yükleyen katman
  proxy.ts             panel sayfaları için oturum kontrolü (Next 16'da middleware'in yeni adı)
scripts/               migrate, seed, predeploy ve Excel çıkarma betikleri
tests/                 Excel karşılaştırma testleri
drizzle/               SQL migration'ları
```

## Hesaplamaların doğruluğu

`tests/golden.json`, Excel'in kendi hesapladığı değerlerden üretilir. `npm test` şunları karşılaştırır: 129 ürün
kartının maliyet, kâr, marj, önerilen fiyat ve durumu; 125 satış satırının maliyeti ve brüt kârı; Panel'deki Eylül
kâr/zararı, başabaş ve kategori ortalamaları; Temmuz–Ekim gelir-gider tablosu; personel ve sabit gider toplamları;
tutarlılık kontrolündeki kullanım ve fark tutarları. Hepsi Excel ile aynıdır.

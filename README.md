# L'Affogato — Maliyet & Kârlılık Paneli

`L'Affogato – Maliyet & Kârlılık.xlsx` dosyasının web uygulaması. Excel'deki 13 sayfanın her biri burada bir ekrana
karşılık geliyor. Hesaplama motoru Excel formüllerini birebir uyguluyor ve bunu otomatik testler kanıtlıyor. Excel'de
olmayan araçlar da eklendi: ay bazlı çalışma, POS eşleştirme hafızası, fiyat geçmişi, uyarılar, menü mühendisliği,
senaryo simülatörü, Excel'e aktarım, QR menü, aylık harcamalar, Paraşüt'ten her sabah otomatik fatura eşitlemesi
([docs/PARASUT.md](docs/PARASUT.md)), tedarikçilerin cari kartları, borç ve ödeme takibi, ödeme talebi
([docs/TEDARIKCILER.md](docs/TEDARIKCILER.md)), ödemeler ve hatırlatıcılar ile sabah e-postası
([docs/BILDIRIMLER.md](docs/BILDIRIMLER.md)), laffogato.net'e bağlı karaoke sayacı ve rezervasyon zili
([docs/KARAOKE.md](docs/KARAOKE.md)), personelin reçete değişikliği önerip yöneticinin önce / sonra farkıyla
onayladığı akış, herkesin kendi hatırlatıcıları, e-posta ve WhatsApp'la giden gün sonu kasa raporu
([docs/KASA-RAPORU.md](docs/KASA-RAPORU.md)) ve stok farkını açıklayan zayi / ikram kaydı
([docs/ZAYI-IKRAM.md](docs/ZAYI-IKRAM.md)).

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
| Reçete defteri (barista; personel değişiklik önerir, yönetici onaylayınca uygulanır) | `/panel/receteler` | — |
| Reçete onayları (önce / sonra farkı, maliyet etkisi, onayla ya da gerekçeyle reddet) | `/panel/onaylar` | — (yeni) |
| Karaoke: oda sayacı, yeni rezervasyon zili, süre dolunca alarm; yöneticiye ay özeti ve bağlantı durumu ([docs/KARAOKE.md](docs/KARAOKE.md)) | `/panel/karaoke` | — (yeni) |
| Hatırlatıcılarım (herkesin kendi hatırlatıcıları; saatinde uyarı, tekrar, erteleme) | `/panel/hatirlaticilarim` | — (yeni) |
| Kasa raporu: her akşam Z raporu ve kasa, eksik / fazla, e-posta ve WhatsApp; yöneticiye günden güne ([docs/KASA-RAPORU.md](docs/KASA-RAPORU.md)) | `/panel/kasa` | — (yeni) |
| Zayi & ikram: atılan ve ödenmeden verilen ürün / malzeme; tutarlılık ve kasa raporuna bağlı ([docs/ZAYI-IKRAM.md](docs/ZAYI-IKRAM.md)) | `/panel/zayi` | — (yeni) |
| Satışlar | `/panel/satislar` | Satış Raporu |
| Faturalar (Paraşüt'ten her sabah gelir; karaoke box ve Alp Koç kafe dışı, toplama girmez) | `/panel/faturalar` | Faturalar |
| Tedarikçiler: cari kartı (unvan, vergi no, IBAN, iletişim, vade), kalan borç, ödendi / talep edildi işareti, ödeme talebi ([docs/TEDARIKCILER.md](docs/TEDARIKCILER.md)) | `/panel/tedarikciler`, `/panel/tedarikciler/[cari]` | — (yeni) |
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
| Günlük işler (Vercel Cron): Paraşüt eşitlemesi, sabah e-postası, hatırlatıcı özeti, karaoke eşitlemesi | `/api/cron/parasut`, `/api/cron/gunluk` | — |
| Açık sekmenin canlı verisi (ETag / 304) ve laffogato.net'in karaoke pingi | `/api/canli`, `/api/karaoke/ping` | — |

Menü kenar çubuğunda dokuz öğeye toplandı: Genel bakış · Karaoke · Menü (Ürünler, Hammaddeler, Reçete defteri,
Reçete onayları) · Satış & gider (Kasa raporları, Satışlar, Faturalar, Tedarikçiler, Gelir-gider, Giderler & personel,
Ödemeler & hatırlatıcılar) · Stok (Stok sayımı, Zayi & ikram, Tutarlılık) · Hatırlatıcılarım · Analiz & senaryo · Ayarlar (Genel ayarlar, Kullanıcılar & roller,
Paraşüt entegrasyonu) · Yardım. Telefonda altta Genel bakış · Satışlar · Faturalar · Ödemeler · Menü çubuğu var. ⌘K
(Ctrl+K) ile ekran, ürün, hammadde ve tedarikçi aranır; zil ödemeleri (gecikmiş, bugün, yakında), fatura bildirimlerini (Paraşüt
eşitlemesi, yeni ve kontrol bekleyen faturalar, bağlanmayı bekleyen ürünler), onay bekleyen reçete önerilerini, kişisel
hatırlatıcıları ve uyarıları (hammadde zammı, son satış ayının uyarıları) gösterir; profil menüsünde Hesabım ve çıkış
var.

Personel rolü yalnızca **Karaoke**, **Kasa raporu**, **Zayi & ikram**, **Reçete defteri** (değişiklik önerir;
yönetici onaylayınca uygulanır), **Stok sayımı** (yalnız bu ay ve geçen ay), **Hatırlatıcılarım** ve **Hesabım**
ekranlarını görür; telefonda altta Karaoke · Kasa · Zayi · Sayım · Reçeteler çubuğu var. Personelin zili yalnız kendi hatırlatıcılarını, önerilerinin sonucunu ve akşam bekleyen kasa raporunu gösterir.
Maliyet, maaş, kâr ve karaoke tutarları personele gösterilmez. Hangi rolün hangi ekranı açtığı tek yerde:
`src/lib/roles.ts` (proxy, giriş sonrası yönlendirme ve menü bunu kullanır).

## Yerelde çalıştırma

Gerekenler: Node.js 24.x (Vercel'deki sürüm, `package.json` › `engines`; 20.19+ ve 22 de çalışır ama npm
`EBADENGINE` uyarısı verir) ve PostgreSQL 14+.

```bash
npm install
```

`.env.example` dosyasını `.env.local` adıyla kopyalayıp değerleri doldurun (`DATABASE_URL`, `AUTH_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`; karaoke bağlantısı için isteğe bağlı `KARAOKE_SYNC_SECRET`). Sonra:

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
| `npm run db:reset` | Excel verisini yeniden yükler. Önce ürünleri, hammaddeleri, satışları, faturaları (belge ve kalemleriyle), sabit giderleri, personeli, gelir-gider düzeltmelerini, sayımları, ay bilgilerini, ayarları, POS eşleştirmelerini, işlem geçmişini, Paraşüt eşitleme geçmişini ve ürün bağlantılarını, bildirim günlüğünü siler. **Silmedikleri:** kullanıcılar, aylık harcamalar (kategoriler ve kayıtlar), hatırlatıcılar, bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları, tedarikçi cari kartları; kalan harcama kayıtları gelir-gideri Excel'den ayırır |
| `npm run excel:extract -- "<excel yolu>"` | Excel'den `excel-data.json` ve `tests/golden.json` dosyalarını yeniden üretir (Python 3 + openpyxl gerekir) |

## Klasör yapısı

```
src/
  app/                 sayfalar (panel/*, giris, menu) ve API uçları (api/*)
  components/          arayüz bileşenleri: ui/* (paylaşılan), panel/* (kabuk), akmanos/* (AkmanOS kaynağı), grafikler;
                       panel/live/* uyarı motoru (canlı veri, sesler, cihaz tercihleri, bildirim aboneliği)
  lib/roles.ts         personelin açabildiği ekranlar (tek kaynak)
  lib/karaoke/         karaoke: imza, oturum evreleri, uyarı planı, sitenin yanıtı (saf, testli)
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
    karaoke/           laffogato.net ile eşitleme ve karaoke panosu (docs/KARAOKE.md)
    push/              Web Push: VAPID, içerik şifrelemesi (RFC 8291), aboneliklere gönderim
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

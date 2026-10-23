# L'Affogato — Maliyet & Kârlılık Paneli

`L'Affogato – Maliyet & Kârlılık.xlsx` dosyasının web uygulaması. Excel'deki 13 sayfanın her biri burada bir ekrana
karşılık geliyor. Hesaplama motoru Excel formüllerini birebir uyguluyor ve bunu otomatik testler kanıtlıyor. Excel'de
olmayan araçlar da eklendi: ay bazlı çalışma, POS eşleştirme hafızası, fiyat geçmişi, uyarılar, menü mühendisliği,
senaryo simülatörü, Excel'e aktarım, QR menü, aylık harcamalar, Paraşüt'ten her sabah otomatik fatura eşitlemesi
([docs/PARASUT.md](docs/PARASUT.md)), tedarikçilerin bilgileri (unvan, IBAN, iletişim), borç ve ödeme takibi, Paraşüt'ten geçmiş faturaları, ödeme talebi
([docs/TEDARIKCILER.md](docs/TEDARIKCILER.md)), ödemeler ve hatırlatıcılar ile sabah e-postası
([docs/BILDIRIMLER.md](docs/BILDIRIMLER.md)), 6 haftalık nakit planı ve KDV tahmini ([docs/NAKIT-PLANI.md](docs/NAKIT-PLANI.md)),
hammadde zamlarının ayda kaç lira kâr götürdüğü, laffogato.net'e bağlı karaoke sayacı ve rezervasyon zili
([docs/KARAOKE.md](docs/KARAOKE.md)), laffogato.net menüsüne bağlı ürünlerde iki yönlü fiyat ve Satışta / Tükendi
eşitlemesi ([docs/SITE-MENU.md](docs/SITE-MENU.md)), menü fiyatlarının toplu değişikliği, kasada (ModPOS) elle
değişecek fiyatların listesi ve satış fiyatı geçmişi ([docs/FIYATLAR.md](docs/FIYATLAR.md)), barın ekranına düşen
uygulama siparişleri, sipariş zili ve
tek dokunuşla aşama: Hazır, Masaya götürüldü, Teslim edildi ([docs/SITE-SIPARIS.md](docs/SITE-SIPARIS.md)), sitenin
online satışlarının kâr-zarara, tüketime ve kasa raporuna girmesi ([docs/SITE-SATIS.md](docs/SITE-SATIS.md)),
personelin reçete değişikliği önerip yöneticinin önce / sonra farkıyla onayladığı akış, herkesin kendi
hatırlatıcıları, e-posta ve WhatsApp'la giden gün sonu kasa raporu ([docs/KASA-RAPORU.md](docs/KASA-RAPORU.md)) ve
stok farkını açıklayan zayi / ikram kaydı ([docs/ZAYI-IKRAM.md](docs/ZAYI-IKRAM.md)).

- **Adres:** https://ladmin.laffogato.net (kafenin sitesi laffogato.net ayrı projede kalır)
- **Frontend:** Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4, Recharts, Motion
- **Arayüz:** [AkmanOS](https://akmanos.com) bileşen kütüphanesinin açık teması (`src/components/akmanos/`), L'Af logosu
  laffogato deposundan. Tasarım kuralları [docs/TASARIM.md](docs/TASARIM.md)
- **Backend:** Next.js Server Actions + Route Handlers (Vercel Functions), Postgres (Neon), Drizzle ORM
- **Oturum:** imzalı JWT çerezi (jose) ve scrypt parola özeti. Roller: yönetici ve personel (**Ayarlar › Kullanıcılar &
  roller**). İsteğe bağlı iki adımlı doğrulama (TOTP, Google/Microsoft Authenticator) ve kurtarma kodları
  (**Hesabım**); 5 hatalı denemede 15 dakika kilit; parola, rol ya da erişim değişince eski oturumlar kapanır;
  yönetici hesaplarını etkileyen işlemler (yönetici ekleme ya da yapma, bir yöneticinin parolası, e-postası, iki
  adımlısı, bağlantısı, pasif yapma, silme) işlemi yapanın kendi parolasıyla onaylanır
- **Gizlilik:** arama motorlarına kapalı (`robots.txt` Disallow, her yanıtta `X-Robots-Tag: noindex`), güvenlik
  başlıkları `next.config.ts`'te; `lafmaliyet.vercel.app` panelin tek adresine (`ladmin.laffogato.net`) yönlenir

Geliştirilmiş prompt, görev planı, Excel analizi ve bulunan tutarsızlıklar [docs/PROMPT-VE-PLAN.md](docs/PROMPT-VE-PLAN.md)
dosyasında. Vercel kurulumu için [docs/DEPLOY.md](docs/DEPLOY.md).

## Ekranlar

| Ekran | Adres | Excel karşılığı |
|-------|-------|-----------------|
| Genel bakış | `/panel` | Panel |
| Ürünler, reçete kartı (Hammadde zamları: önerilen fiyat ve zammın ayda kaç lira kâr götürdüğü) | `/panel/urunler`, `/panel/urunler/[id]` | Ürün Kârlılık, Reçete Kartları |
| Site menüsü: ürünleri laffogato.net menüsündeki kalemlere bağlama (öneriler), bağlantının durumu, Siteyle eşitle ([docs/SITE-MENU.md](docs/SITE-MENU.md)) | `/panel/urunler/site` | — (yeni) |
| Fiyatlar: toplu değiştir (yüzde, tutar ya da önerilen fiyat; önizleme ve aylık etki), kasaya (ModPOS) işle, fiyat geçmişi ve toplu değişikliği geri alma ([docs/FIYATLAR.md](docs/FIYATLAR.md)) | `/panel/urunler/fiyatlar` | — (yeni) |
| Hammaddeler: onay bekleyen fiyatlar (Paraşüt faturasında %40'tan büyük değişim onaylanınca uygulanır), tedarikçilere göre fiyat ([docs/PARASUT.md](docs/PARASUT.md) 5b, 5c) | `/panel/hammaddeler` | Hammaddeler |
| Reçete defteri (barista; personel değişiklik ya da reçetesiyle yeni ürün önerir, yönetici onaylayınca uygulanır) | `/panel/receteler` | — |
| Reçete onayları (önce / sonra farkı, maliyet etkisi, onayla ya da gerekçeyle reddet; yeni ürün önerisinde satır maliyeti, satış fiyatı ve canlı kâr marjı, "Onayla ve ürünü ekle") | `/panel/onaylar` | — (yeni) |
| Karaoke (barın ekranı): laffogato.net'ten ödenmiş uygulama siparişleri, sipariş zili ve tek dokunuşla aşama (sitenin aşama ucuna gider; iade ve iptal sitede) ([docs/SITE-SIPARIS.md](docs/SITE-SIPARIS.md)), oda sayacı, yeni rezervasyon zili, süre dolunca alarm, sitedeki rezervasyonla çakışma uyarısı; yöneticiye ay özeti ve bağlantı durumu ([docs/KARAOKE.md](docs/KARAOKE.md)) | `/panel/karaoke` | — (yeni) |
| Hatırlatıcılarım (herkesin kendi hatırlatıcıları; saatinde uyarı, tekrar, erteleme) | `/panel/hatirlaticilarim` | — (yeni) |
| Kasa raporu: her akşam Z raporu ve kasa, eksik / fazla, e-posta ve WhatsApp, günün online satışı (bilgi, kasadan geçmez); Z raporu, POS fişi ve kasadan çıkan fişler fotoğraftan okunur (onaylayınca kaydedilir, [docs/FOTOGRAF.md](docs/FOTOGRAF.md)); açılış ↔ önceki devir denetimi, kasayı sayan, düzeltme geçmişi; yöneticiye günden güne; ayın açık günü, POS cirosu, indirimi, ödenmezi ve kartlı oranı (boş bırakılırsa) kasa raporlarından ([docs/KASA-RAPORU.md](docs/KASA-RAPORU.md)) | `/panel/kasa` | — (yeni) |
| Zayi & ikram: atılan ve ödenmeden verilen ürün / malzeme; tutarlılık ve kasa raporuna bağlı ([docs/ZAYI-IKRAM.md](docs/ZAYI-IKRAM.md)) | `/panel/zayi` | — (yeni) |
| Satışlar | `/panel/satislar` | Satış Raporu |
| Faturalar (Paraşüt'ten her sabah gelir; karaoke box ve Alp Koç kafe dışı, toplama girmez) | `/panel/faturalar` | Faturalar |
| Tedarikçiler: bilgiler (unvan, vergi no, IBAN, iletişim, vade), kalan borç, ödendi / talep edildi işareti, ödeme talebi, düzenle / sil (faturalıysa listeden kaldır), Paraşüt'ten geçmiş faturalar, vergi noyla eşleşme (farklı adla gelen aynı firma tek tedarikçi) ([docs/TEDARIKCILER.md](docs/TEDARIKCILER.md)) | `/panel/tedarikciler`, `/panel/tedarikciler/[cari]` | — (yeni) |
| Gelir-gider (laffogato.net online satışları: ayrı, KDV hariç gelir satırları ve toplam ciro; Siteden yenile, [docs/SITE-SATIS.md](docs/SITE-SATIS.md)) | `/panel/gelir-gider` | Genel Maliyet |
| Giderler & personel (üç sekme: Sabit giderler, Aylık harcamalar, Personel); kasadan çıkan fişler Aylık harcamalar'a fotoğrafıyla yazılır | `/panel/giderler`, `/panel/harcamalar`, `/panel/personel` | Sabit Giderler, — (yeni), Personel |
| Ödemeler & hatırlatıcılar (Son ödenenler: 30 gün içinde geri alma) | `/panel/hatirlaticilar` | — (yeni) |
| Nakit planı: önümüzdeki 6 hafta gelen, ödenecek, kalan; en sıkışık gün · KDV tahmini (önceki ayın satış KDV'si − alış KDV'si, ayın 28'inde) ([docs/NAKIT-PLANI.md](docs/NAKIT-PLANI.md)) | `/panel/hatirlaticilar/nakit` | — (yeni) |
| Stok sayımı, tutarlılık (iki sekme; beklenen kullanım ModPOS + online kafe siparişleri). "Listeye ekle": yönetici ve personel sayım listesine kalem ekler (fiyatı 0 ve Tahmini açılır, yönetici Hammaddeler'den girer; zilde "Fiyatı girilmemiş N hammadde") | `/panel/sayim`, `/panel/tutarlilik` | Sayım, Tutarlılık Kontrolü |
| Analiz & senaryo | `/panel/analiz` | — (yeni) |
| Ayarlar, işlem geçmişi, günlük işlerin son çalışması, laffogato.net bağlantılarının durumu (karaoke, menü, siparişler, online satışlar), fotoğraftan okuma (aç / kapat, günlük sınır, aylık tutar), yedek: paneldeki bütün verinin tek dosyası (parolayla iner; geri yükleme bilgisayardan, [docs/YEDEK.md](docs/YEDEK.md)) ve Excel kopyası | `/panel/ayarlar` | Ayarlar |
| Kullanıcılar & roller | `/panel/kullanicilar` | — (yeni) |
| Paraşüt entegrasyonu (eşitleme, ürün → hammadde bağlantıları, kategori kuralları) | `/panel/parasut` | — (yeni) |
| Hesabım (profil menüsü) | `/panel/hesap` | — (yeni) |
| Yardım | `/panel/yardim` | Nasıl Kullanılır |
| Giriş, davetle parola belirleme, QR menü (`/` panele yönlendirir) | `/giris`, `/davet`, `/menu` | — (yeni) |
| Excel'e aktar / tam yedek / sağlık / menü JSON / fatura belgesi ve kalemleri | `/api/export`, `/api/yedek` (parola onayından sonra verilen iki dakikalık bağlantıyla, yalnız yönetici), `/api/health` (`?isler=1`: günlük işlerin durumu, sorun varsa 503), `/api/menu`, `/api/faturalar/[id]/belge`, `/api/faturalar/[id]/kalemler`, `/api/hammaddeler/[id]/fiyatlar` (tedarikçilere göre fiyat) | — |
| Günlük işler (Vercel Cron): Paraşüt eşitlemesi, sabah e-postası, hatırlatıcı özeti, karaoke ve site menüsü eşitlemesi, online satışlar; her çalışma `job_runs`'a yazılır, çalışmayan ya da hata veren iş zil, Genel bakış ve e-postayla bildirilir (docs/BILDIRIMLER.md › Sistem uyarıları) | `/api/cron/parasut`, `/api/cron/gunluk` | — |
| Açık sekmenin canlı verisi (ETag / 304), laffogato.net'in karaoke, menü ve sipariş pingleri, bar ekranının sipariş isteği | `/api/canli`, `/api/karaoke/ping`, `/api/menu/ping`, `/api/orders/ping`, `/api/siparisler` | — |

Menü kenar çubuğunda dokuz öğeye toplandı: Genel bakış · Karaoke · Menü (Ürünler, Hammaddeler, Reçete defteri,
Reçete onayları) · Satış & gider (Kasa raporları, Satışlar, Faturalar, Tedarikçiler, Gelir-gider, Giderler & personel,
Ödemeler & hatırlatıcılar) · Stok (Stok sayımı, Zayi & ikram, Tutarlılık) · Hatırlatıcılarım · Analiz & senaryo · Ayarlar (Genel ayarlar, Kullanıcılar & roller,
Paraşüt entegrasyonu) · Yardım. Telefonda altta Genel bakış · Satışlar · Faturalar · Ödemeler · Menü çubuğu var. ⌘K
(Ctrl+K) ile ekran, ürün, hammadde ve tedarikçi aranır; zil ödemeleri (gecikmiş, bugün, yakında), fatura bildirimlerini (Paraşüt
eşitlemesi, yeni ve kontrol bekleyen faturalar, bağlanmayı bekleyen ürünler), onay bekleyen reçete önerilerini ve fiyat onaylarını, kişisel
hatırlatıcıları ve uyarıları (kasada değişecek fiyatlar, zammın aylık kâr etkisiyle hammadde zammı, fiyatı girilmemiş hammaddeler, son satış ayının uyarıları) gösterir; profil menüsünde Hesabım ve çıkış
var.

Personel rolü yalnızca **Karaoke**, **Kasa raporu**, **Zayi & ikram**, **Reçete defteri** (değişiklik ya da yeni ürün
önerir; yönetici onaylayınca uygulanır), **Stok sayımı** (yalnız bu ay ve geçen ay; listeye kalem de ekler), **Hatırlatıcılarım** ve **Hesabım**
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
`ADMIN_EMAIL`, `ADMIN_PASSWORD`; laffogato.net bağlantısı (karaoke, menü, siparişler ve online satışlar) için isteğe
bağlı `KARAOKE_SYNC_SECRET`). Sonra:

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
| `npm run build` | Migration'ları uygular, veritabanı boşsa Excel verisini yükler, ardından production build alır (Vercel önizlemesinde bu hazırlık atlanır: önizleme canlının veritabanını kullanır, [DEPLOY.md](docs/DEPLOY.md) § 3) |
| `npm test` | Bütün testleri çalıştırır (`tests/*.test.ts`): hesaplama motorunu Excel'in değerlerine karşı (129 ürün, 125 satış satırı, panel, gelir-gider, tutarlılık) ve ekran kurallarını. `YEDEK_TEST_DATABASE_URL=postgres://…/postgres` verilirse yedeğin gerçek bir veritabanında alınıp geri yüklenmesi de sınanır ([docs/YEDEK.md](docs/YEDEK.md) § 10) |
| `npm run lint` | ESLint |
| `npm run db:generate` | Şema değişince yeni migration üretir (`drizzle/`) |
| `npm run db:migrate` | Migration'ları uygular ve hepsinin uygulandığını doğrular (atlanan varsa hata; docs/DEPLOY.md § 7) |
| `npm run db:seed` | Veritabanı boşsa Excel verisini yükler |
| `npm run db:reset` | Excel verisini yeniden yükler. Önce ürünleri (laffogato.net menü bağlantıları, reçete önerileri, fiyat geçmişi ve kasaya işlenecek fiyatlarla), hammaddeleri (sayımda “Listeye ekle” ile eklenenler ve `sayim_yeni_kalemler` migration'ının eklediği sekiz kalem dahil: yalnız Excel'dekiler geri gelir), satışları, faturaları (belge ve kalemleriyle), sabit giderleri, personeli, gelir-gider düzeltmelerini, sayımları, ay bilgilerini, ayarları, POS eşleştirmelerini, işlem geçmişini, Paraşüt eşitleme geçmişini ve ürün bağlantılarını, fiyat onaylarını, aylık harcama kayıtlarını, bildirim günlüğünü, nakit planının bakiyesini ve tahmin ayarlarını (devreden KDV dahil) siler. **Silmedikleri:** kullanıcılar, aylık harcama kategorileri, hatırlatıcılar, bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları, laffogato.net'ten çekilen online satış ayları ve açık sipariş listesinin kopyası (sitenin verisi), tedarikçi cari kartları (faturaların ödendi / talep edildi işaretleri faturalarla birlikte silinir); fotoğraflar, kasadan çıkanlar ve okuma kayıtları |
| `npm run db:backup` | Tam yedeği bilgisayara alır (`~/laffogato-yedek-….json.gz`; `--belgeler` panelden yüklenen belgelerle, `--cikti <dosya>` başka bir yere). Panelin Ayarlar › Yedek dosyasıyla aynı biçim ([docs/YEDEK.md](docs/YEDEK.md)) |
| `npm run db:restore -- <dosya>` | Yedeği boş bir veritabanına yükler; `--sil` ile dolu bir veritabanının yerine (önce onun yedeğini dosyanın yanına alır; Neon'da `--onay=<sunucu>`). Parolalar dosyada yok: aynı e-postalı kişi hedefteki parolasını korur, ötekiler davet bekler ([docs/YEDEK.md](docs/YEDEK.md)) |
| `npm run excel:extract -- "<excel yolu>"` | Excel'den `excel-data.json` ve `tests/golden.json` dosyalarını yeniden üretir (Python 3 + openpyxl gerekir) |

## Klasör yapısı

```
src/
  app/                 sayfalar (panel/*, giris, menu) ve API uçları (api/*)
  components/          arayüz bileşenleri: ui/* (paylaşılan), panel/* (kabuk), akmanos/* (AkmanOS kaynağı), grafikler;
                       panel/live/* uyarı motoru (canlı veri, sesler, cihaz tercihleri, bildirim aboneliği)
  lib/roles.ts         personelin açabildiği ekranlar (tek kaynak)
  lib/karaoke/         karaoke: imza, oturum evreleri, uyarı planı, sitenin yanıtı (saf, testli)
  lib/site-menu/       laffogato.net menü bağlantısı: yanıt şeması, yuva ↔ fiyat, çekme planı, öneriler (saf, testli)
  lib/site-orders/     laffogato.net siparişleri: yanıt şeması, yeni sipariş, sıralama, kart metinleri, zil kuralı, aşama düğmeleri (saf)
  lib/site-sales/      laffogato.net online satışları: yanıt şeması, KDV hariç gelir, ürün eşlemesi, kasa satırı (saf)
  lib/prices/          menü fiyatları: toplu kural ve yuvarlama, önizleme, kasanın (ModPOS) durumu, fiyat geçmişi ve geri alma planı (saf, testli; docs/FIYATLAR.md)
  lib/backup/          tam yedek: dosya biçimi, yazılmayanlar, şema sürümü, yükleme sırası, giriş bilgileri (saf, testli)
  lib/cash-plan.ts     nakit planı: 6 haftanın gelen, ödenecek ve kalan parası, hatırlatıcı eşleşmesi (saf, testli; docs/NAKIT-PLANI.md)
  lib/cash-month.ts    kasa raporlarından ay bilgisi: açık gün, POS cirosu, indirim, ödenmez, kartlı oran, eksik günler (saf, testli)
  lib/kdv.ts           KDV tahmini: satışların ve alışların KDV'si, devreden zinciri (saf, testli)
  lib/photo-read/      fotoğraftan okunanın kontrolü: şemalar, istemler, Z / POS / fiş okumasının forma gidecek hâli (saf, testli)
  lib/photo-rules.ts   fotoğraf türleri, boyut ve ölçü sınırları, saklama süreleri, kim görür (saf, testli)
  lib/photo-compress.ts  fotoğrafı telefonda JPEG'e küçültme (en çok 2576 px / ~3,7 MP, 1,8 MB)
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
    notify/            sabah e-postası ve Resend gönderimi (docs/BILDIRIMLER.md)
    jobs/              günlük işler: anahtar denetimi, çalışma kayıtları (job_runs), sistem uyarıları ve bekçi e-postası
    backup/            tam yedek: dışa aktarım, geri yükleme, indirme bağlantısı ve son yedek kaydı (docs/YEDEK.md)
    karaoke/           laffogato.net ile eşitleme ve karaoke panosu (docs/KARAOKE.md)
    site-menu/         laffogato.net menüsü: çekme, panel → site yazımı, bağlama (docs/SITE-MENU.md); site-link.ts ortak imzalı istek
    site-orders/       laffogato.net'in açık siparişleri: çekme, son listenin kopyası, bildirim (docs/SITE-SIPARIS.md)
    site-sales/        laffogato.net'in online satışları: ay ay çekme ve saklama, kasa satırı (docs/SITE-SATIS.md)
    prices/            satış fiyatı yazımı: geçmiş ve kasa durumu, tek fiyat (önce site), toplu değişiklik ve geri alması (docs/FIYATLAR.md)
    push/              Web Push: VAPID, içerik şifrelemesi (RFC 8291), aboneliklere gönderim
    storage/           fotoğraf deposu: özel Vercel Blob (yerelde .data/photos), erişim kuralları (docs/FOTOGRAF.md)
    ai/                Claude istemcisi: fotoğraftan okuma, günlük sınır, maliyet günlüğü (ai_calls)
    photo-read/        fotoğrafı okuyup forma hazırlama, kimin hangi güne fotoğraf ekleyebileceği
  proxy.ts             panel sayfaları için oturum kontrolü (Next 16'da middleware'in yeni adı)
scripts/               migrate (ve migration doğrulaması), seed, predeploy, tam yedek ve geri yükleme, Excel çıkarma betikleri
tests/                 Excel karşılaştırma testleri ve ekran kuralları
drizzle/               SQL migration'ları
```

## Hesaplamaların doğruluğu

`tests/golden.json`, Excel'in kendi hesapladığı değerlerden üretilir. `npm test` şunları karşılaştırır: 129 ürün
kartının maliyet, kâr, marj, önerilen fiyat ve durumu; 125 satış satırının maliyeti ve brüt kârı; Panel'deki Eylül
kâr/zararı, başabaş ve kategori ortalamaları; Temmuz–Ekim gelir-gider tablosu; personel ve sabit gider toplamları;
tutarlılık kontrolündeki kullanım ve fark tutarları. Hepsi Excel ile aynıdır.

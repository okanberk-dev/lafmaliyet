# Devam notu (26 Kasım 2026, ~18:10 UTC)

Bu oturum (`claude/festive-goodall-sclggq`, session_01Qdyb35Fked3nYaVSW3owcj) kullanım limitine yaklaştığı için yarım işleri
burada bırakıyor. Bütün dallar GitHub'da. Sıra aşağıdaki gibi; her adımdan sonra YAPILACAKLAR.md güncellenir (biten madde
PR numarasıyla "Bitenler"e, önemsiz/geçersiz olan silinir).

## Kurallar (sahibin)

- "Sen yap her şeyi": PR aç, kontrollerden eminsen main'e birleştir (merge commit). Başka oturumların PR'larıyla çakışma
  olmasın: birleştirmeden önce `origin/main`'i al, göç numarası çakışırsa kendi göçünü `DATABASE_URL=postgres://x:y@localhost/z
  npx drizzle-kit generate --name <ad>` ile main'in ardına yeniden üret (main'in `_journal.json` ve snapshot'ı korunur;
  "No schema changes" görülmeli). PR'ları birer birer birleştir.
- Gereksiz yerel test koşma: tip (`npx next typegen && npx tsc --noEmit`), değişen dosyalarda `npx eslint` ve etkilenen
  testler yeter; tam `npm test` ve `npm run test:db` CI'da ("Tip · Lint · Test · Derleme").
- CI'daki "inceleme" (Claude ile PR incelemesi) her PR'da kırmızı: depo sırrı `ANTHROPIC_API_KEY` / kredi sorunu, kodla
  ilgisi yok. Sahip anahtarı sonra ekleyecek; birleştirmeye engel sayma.
- Belgeler değişince `npm run asistan:bilgi` (tests/panel-asistani.test.ts denetler).
- Commit iletileri Türkçe; sonuna `Co-Authored-By` ve `Claude-Session` satırları.

## 1. PR #160 — belge tarayıcı (dal `wip/tarama`)

Tarama ekranı, canlı kamera vizörü, kalite / yön / uzun fiş, ölçümle ayarlanmış algılama. Göç `0096_foto_tarama`.
CI ilk koşuda `tests/lafpos-sube-db.test.ts` yüzünden kırmızıydı: bu test #157'den beri main'de de düşüyor (oturum taklidinde
`requireAnaAdmin` yoktu). Düzeltme b3d10654 ile dala eklendi. **Yapılacak:** CI "Tip · Lint · Test · Derleme" yeşilse
birleştir (main de yeşile döner). Kırmızıysa iş günlüğünden düşen testi bul, düzelt.

## 2. Roller + vardiya şube ayarları (dal `wip/entegre3`, PR henüz yok)

İçerik: "Müdür" (şubesine kilitli, maaş görmez) ve salt okunur "Muhasebeci" rolleri (docs/ROLLER.md), vardiyanın şube
ayarları (hazır vardiya saatleri şube ayarı; "Tümü"de Vardiya önce şubeyi sorar), main #157–#159 ile birleşmiş, rol testinin
`requireAnaAdmin` düzeltmesi. Göç `0096_roller` (iki CHECK kısıtı) — **#160 birleşince 0097'ye yeniden üretilmeli.**

Bağımsız inceleme (iki doğrulayıcı) şu bulguları DOĞRULADI; PR'dan önce düzeltilmeli (her birine test):
1. (orta) Müdür, Onaylar'da kasadan çıkan isteğini onaylarken maaş / kira kategorisine harcama yazabiliyor
   (müdürün kategori kısıtı onay yolunda yok; doğrudan yazma yolundaki kontrol `src/server/actions` cash-out onayına da).
2. (orta) Müdürün "admin" düzeyi fotoğraf sahipliği denetimini atlıyor: öteki şubenin fotoğrafını kendi kaydına bağlayabiliyor.
3. (orta) Müdür kasadan çıkan satırını düzelterek tedarikçi ödemesini (cari) ve faturaların ödeme durumunu değiştirebiliyor.
4. (orta) Müdür Zayi sayfasında ve Onaylar'daki zayi kartlarında malzeme maliyetini (hammadde fiyatı) görüyor.
5. (orta) Müdür Kasa raporu sayfasında karaoke ön ödemesi tutarını görüyor.
6. (orta) Onaylar'daki kasadan çıkan kartı müdüre yöneticinin kategori adını / bütün kategori listesini gösteriyor.
7. (orta/düşük) Muhasebeci `/api/canli`'dan bütün şubelerin karaoke rezervasyonlarını ve site siparişlerini alıyor
   (ekranı yok); canlı uç muhasebeciye kapatılmalı ya da yalnız ihtiyacı olanı döndürmeli.
8. (düşük) Kasa ay görünümü müdürün tarayıcısına bütün ayın kasadan çıkan satırlarını kategori adlarıyla gönderiyor.
9. (düşük) Kasa e-postasının ham hata metni (düşen alıcı adresleri, kurulum ayrıntısı) müdüre ve muhasebeciye gidiyor.
10. (düşük) Şube kurulumunun e-posta çakışma kapısı muhasebeci hesabını görmüyor (#157 kodu, yeni rollerle).
11. (düşük) Yeni cihazdan giriş uyarısı müdür ve muhasebecinin zilinde hiç görünmüyor; e-posta kurulu değilse uyarı yok.
12. (düşük) İki adımlı doğrulamanın metinleri ve belgeleri davranışla tutarsız: main #154 zorunluluğu `ADMIN_2FA_REQUIRED=1`
    ile isteğe bağlı yaptı, ROLLER.md / metinler "her zaman zorunlu" diyor. Metinler ve belgeler davranışa uydurulmalı.
Henüz doğrulanmamış (bak, gerçekse düzelt): Hesabım'daki LafPOS kurulum bağlantısının şubeye kilitli her personele
görünmesi; vardiya ızgarasının müdüre yalnız yöneticiye açık ekranlara bağlantı göstermesi; ROLLER.md'nin rol göçünü
0095 diye anması (0096/0097 olmalı).

**Yapılacak:** `wip/entegre3`'ten bir dal aç (ör. `wip/roller-duzelt`), bulguları düzelt, `origin/main`'i al (göçü yeniden
üret), hedefli testler (tests/roller*.test.ts, tests/roller-db.test.ts, ilgili kasa/zayi/onay testleri), PR, CI, birleştir.
Canlıya etkisi: yeni roller kimseye kendiliğinden verilmez; CHECK kısıtları mevcut veride yalnız admin/staff olduğu için sorunsuz.

## 3. Excel'den bağımsızlık (dal `wip/excel-bagimsiz`, ajan yarıda kalmış olabilir)

Amaç: canlıda boş veritabanına kendiliğinden Excel tohumu basılmasın (scripts/predeploy.ts); başlangıç verisi uygulama
ağacından çıksın (`tests/fixtures/baslangic/`'e taşındı — son commit f81de5d2); scripts/excel-import/extract.py ve
`excel:extract` kaldırılsın; exceljs / uuid güvenlik açığı (Dependabot: 3 orta, 1 düşük) `overrides` ya da yükseltmeyle
kapansın; Excel'den kalan sabitler (ör. sabit "Eylül") bulunsun. Değerler değişmez (altın testler bağlı).
**Yapılacak:** dalın son commit'lerini oku, eksik maddeleri bitir, `npx tsc`, eslint, etkilenen testler
(`npx tsx --test $(git diff --name-only origin/main -- tests | grep '\.test\.ts$')`), PR, CI, birleştir.

## 4. Kalan işler denetimi (yeniden yapılmalı)

Bu oturumda çok ajanlı bir denetim başlatıldı ama sonucu bu notun yazıldığı anda hazır değildi. Yeniden yap:
1. Excel'e çalışma zamanında kalan bağımlılık ve kodda Excel'den kalan sabitler.
2. docs/PROMPT-VE-PLAN.md § 4–5'teki her Excel özelliğinin veritabanında ve ekranda DÜZENLENEBİLİR karşılığı var mı
   (yalnız tohumla gelip ekrandan değiştirilemeyen veri kalmasın).
3. docs/planlar/KALAN-ISLER.md, CRITIQUE*.md, BRIEF2.md ve plan dosyalarının açık maddeleri (koda bakarak).
4. Denetim belgeleri (DENETIM-21-KASIM.md, denetim-listesi.md, denetim-2026-11-13.md, denetim-2026-10-26.md) ve
   YAPILACAKLAR.md'nin [x] maddelerinin gerçekten bitip bitmediği.
5. docs/*.md'deki "sonraya kalan / bilinen sınır / henüz" maddeleri ve koddaki TODO/FIXME.
6. Profesyonel kod eksikleri: hata izleme (Sentry vb. yok), ortam değişkeni doğrulaması, sağlık uçları, yedekten geri
   yüklemenin denenmesi, ölü betikler, çok büyümüş dosyalar.
Çıkan işleri birbirine çakışmayan PR paketlerine böl, YAPILACAKLAR.md'ye yaz, sırayla yap.

## 5. YAPILACAKLAR.md

Tek canlı liste olsun: biten maddeler PR numarasıyla "Bitenler"e (açık listede üstü çizili bırakma), önemsiz/geçersiz
olanlar silinir, denetimden çıkanlar eklenir. "Sahibin tarafında" ve LafPOS'a bağlı maddeler ayrı başlıkta kalır.
main'deki hâlinde "Dalga 2" ve "Dalga 3" listelerinde roller, raporlar, muhasebe, personel, mutabakat maddelerinin çoğu
#151 / #153 ile bitti; vardiya ve roller bu PR'larla biter.

## Sahibin tarafında (kod değil)

- GitHub depo sırrı `ANTHROPIC_API_KEY` (ve Anthropic Console bakiyesi): PR incelemesi her PR'da kırmızı.
- Yayından sonra belge tarayıcıyı gerçek iPhone ve Android'de dene (vizör, otomatik çekim, tarama ekranı).
- Ayarlar › Muhasebeci paketi'ne muhasebecinin adresi; CSP bir hafta temizse Vercel'de `CSP_ENFORCE=1`;
  iki adımlı doğrulama zorunlu olsun isteniyorsa Vercel'de `ADMIN_2FA_REQUIRED=1`.
- YAPILACAKLAR.md › Sahibin tarafında'daki öbür maddeler (Neon kotası, GitHub `CRON_SECRET`, eski Paraşüt değişkenleri).

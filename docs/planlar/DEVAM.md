# Devam notu (26 Kasım 2026 akşamı)

Bu oturum (session_01Qdyb35Fked3nYaVSW3owcj) kullanım limitine yaklaştığı için kalan işleri, önerileri ve sırayı burada
bırakıyor. Bütün dallar GitHub'da. Bugün main'e girenler: #151 (Z raporu e-postası, ucuz modelle okuma, faturanın şubesi,
Tuzla kasa, bildirim/güvenlik, yedek/kota, mutabakat; #120 dahil), #153 (raporlar, stok/asistan, muhasebe, personel,
Paraşüt güvenliği ve CSP, tarayıcı çekirdeği), #160 (belge tarayıcı: ekran, canlı vizör, kalite / yön / uzun fiş),
#161 (bu not). Başka oturumlardan: #149, #150, #154–#159.

## 0. ACİL — sahibin yapması gereken

**Depo herkese açık (public).** `tests/fixtures/baslangic/` (eski adıyla `src/server/db/seed/excel-data.json`) maaş, kira,
fatura, satış ve kişi adları taşıyor; git geçmişinde de duruyor. GitHub › okanberk-dev/lafmaliyet › Settings › General ›
Danger Zone › Change visibility › **Private**. Sonra: sohbete ya da depoya hiç düşmüş anahtar varsa (denetim D-06:
sohbete yapıştırılmış Anthropic anahtarı) iptal edilip yenisi verilsin. Gizli yapmak geçmişte kopyalanmış olanı geri
almaz; kişi adlarının anonimleştirilmesi (aşağıda P2) yine yapılmalı.

## Çalışma kuralları (sahibin)

- "Sen yap her şeyi": PR aç; kontrollerden eminsen main'e birleştir (merge commit). Kod değişikliğinde CI'daki
  "Tip · Lint · Test · Derleme" yeşil olmalı; yalnız belge değişen PR'ı yerel belge testleriyle (tests/belgeler,
  panel-asistani, eski-veri-adlari) birleştirebilirsin.
- Başka oturumların PR'larıyla çakışma olmasın: birleştirmeden önce `origin/main`'i al. Göç numarası çakışırsa kendi
  göçünü sil, main'in `_journal.json` / snapshot'ını koru ve `DATABASE_URL=postgres://x:y@localhost/z npx drizzle-kit generate
  --name <ad>` ile main'in ardına yeniden üret ("No schema changes" görülmeli). PR'ları birer birer birleştir.
- Gereksiz yerel test koşma: tip (`npx next typegen && npx tsc --noEmit`), değişen dosyalarda `npx eslint`, etkilenen
  testler. Tam `npm test` / `npm run test:db` CI'da.
- CI'daki "inceleme" (Claude ile PR incelemesi) `ANTHROPIC_API_KEY` sırrı yüzünden her PR'da kırmızı; engel sayma.
- Belge değişince `npm run asistan:bilgi`. Arayüz, belge ve commit iletileri Türkçe.
- Her PR'da YAPILACAKLAR.md güncellenir: biten madde PR numarasıyla "Bitenler"e (açık listede üstü çizili bırakılmaz),
  önemsiz / geçersiz olan silinir, yeni iş eklenir. Bu dosya (DEVAM.md) da güncel tutulur; iş bitince silinir.

## Kod paketleri (sırayla; her biri ayrı dal ve PR)

### P1. Roller + vardiya şube ayarları (dal `wip/entegre3`; düzeltmeler `wip/entegre3-fix`'te başlamış olabilir)
"Müdür" (şubesine kilitli, maaş görmez) ve salt okunur "Muhasebeci" (docs/ROLLER.md); hazır vardiya saatleri şube ayarı,
"Tümü"de Vardiya şubeyi sorar. Göç `0096_roller` → main'de 0096 (#160) olduğu için **0097 olarak yeniden üret**.
PR'dan önce bağımsız incelemenin DOĞRULADIĞI 12 bulguyu düzelt (her birine test):
1. Müdür, Onaylar'da kasadan çıkan isteğini onaylarken maaş / kira kategorisine yazabiliyor.
2. Müdürün "admin" düzeyi fotoğraf sahipliği denetimini atlıyor (öteki şubenin fotoğrafını kendi kaydına bağlar).
3. Müdür kasadan çıkan satırını düzelterek cari ödemesini ve faturaların ödeme durumunu değiştirebiliyor.
4. Müdür Zayi sayfasında ve Onaylar'daki zayi kartlarında malzeme maliyetini görüyor.
5. Müdür Kasa raporu sayfasında karaoke ön ödemesini görüyor.
6. Onaylar'daki kasadan çıkan kartı müdüre yöneticinin kategori adını / bütün listeyi gösteriyor.
7. Muhasebeci `/api/canli`'dan bütün şubelerin karaoke rezervasyonlarını ve site siparişlerini alıyor.
8. Kasa ay görünümü müdürün tarayıcısına ayın bütün kasadan çıkan satırlarını kategori adlarıyla gönderiyor.
9. Kasa e-postasının ham hata metni müdüre / muhasebeciye gidiyor.
10. Şube kurulumunun e-posta çakışma kapısı muhasebeci hesabını görmüyor.
11. Yeni cihaz uyarısı müdür / muhasebecinin zilinde yok.
12. İki adımlı doğrulamanın metinleri ve belgeleri davranışla tutarsız (#154: zorunluluk `ADMIN_2FA_REQUIRED=1` ile).
Ayrıca bak: Hesabım'daki LafPOS kurulum bağlantısının şubeye kilitli personele görünmesi; vardiya ızgarasında müdüre
yönetici ekranı bağlantısı; ROLLER.md'deki göç numarası. Düzeltmelerden sonra **ikinci bir bağımsız inceleme** yap
(yetki: eylemler, okuma sızıntısı, API uçları, e-posta/zil). Birleştirmeden önce canlı veritabanının yedeği alınsın
(sahip: Ayarlar › Yedek ya da Neon'da dal/anlık kopya). Yeni roller kimseye kendiliğinden verilmez; CHECK kısıtları
canlıdaki admin/staff verisiyle uyumlu.

### P2. Excel'den tam bağımsızlık (dal `wip/excel-bagimsiz`, büyük kısmı yapıldı)
Yapılanlar: başlangıç verisi `tests/fixtures/baslangic/`'e taşındı (f81de5d2); canlıda boş veritabanına kendiliğinden
yüklenmiyor (98f5ed2f); Excel çıkarma betiği kalktı (27990e7f). Kalanlar: (a) exceljs / uuid, fast-xml-parser,
minimatch, esbuild açıkları (Dependabot 4) `overrides` ya da yükseltmeyle; (b) **kişi adlarını anonimleştir** (rakamlar
kalsın: hesap motorunun altın testleri rakamlara bağlı, adlara değil); (c) docs/DEPLOY.md ve README'yi yeni davranışa
göre güncelle; (d) dalın kalan ARA KAYIT'ı varsa bitir. Hedefli testler, PR, birleştir.

### P3. Hata izleme ve kayıt (yüksek)
Canlıda hata yalnız Vercel günlüğüne (Hobby'de 1 saat) düşüyor. `src/instrumentation.ts`'e `onRequestError` kancası;
sunucu hataları, `attempt()` hataları ve istemci hataları veritabanında kısa ömürlü bir tabloya yazılsın; panelde
(Ayarlar › Sistem) görünsün; kritik hatada yöneticiye e-posta (mevcut sistem uyarısı altyapısıyla, günde bir kez).
CSP ihlal raporları da aynı kayda (bugün yalnız 1 saatlik günlükte; CSP_ENFORCE kararı kanıtla verilsin).
İsteğe bağlı: Sentry (sahip hesap açarsa DSN ortam değişkeniyle).

### P4. CI ve kod sağlığı (yüksek)
- CI'da şema–göç tutarlılığı: `drizzle-kit generate` değişiklik üretirse CI düşsün.
- Asistanın bilgi tabanı (`src/lib/assistant/knowledge-data.ts`, ~900 KB) elle üretilip depoya ekleniyor ve her
  belge değişikliğinde çakışıyor: derlemede (`prebuild`/predeploy) ya da CI'da üretilsin; depodan çıkarılsın ya da
  CI "güncel mi" diye baksın (bugünkü test).
- Rol × ekran duman testi: `scripts/personel-sizinti.ts` CI'da çalışan sunucuya karşı koşsun (personel, müdür,
  muhasebeci için maliyet / maaş sızıntısı).
- Kaynak metnine bakan kırılgan testleri (assert.match(src, /…/)) yeni işlerde davranış testleriyle değiştir.

### P5. Ayarlar ay bazlı + 2027 vergi kuralları (yüksek; 2027 kuralları Ocak'tan önce)
SGK oranları, yemek kartı, şube POS oranı değişince geçmiş aylar yeniden hesaplanıyor (Excel'den kalan "tek ayar"
modeli). Ayarlar geçerlilik başlangıcıyla (ay) saklansın; hesap her ayı kendi ayarıyla yapsın. `src/lib/tax/rules.ts`'e
2027 kuralları (docs/planlar/vergi.md § 19), kodda gömülü "2026"lar yıldan türesin. SGK işveren oranı kodda %15,75
(Excel'den); 2026 yasal oranı %19,75 — sahip/muhasebeci kararı bekliyor, ayar olarak sorulsun.

### P6. Excel'den kalan sabit listeler ekrandan düzenlenebilsin (orta)
Fatura kategorileri (mal / kafe dışı / demirbaş… rolüyle), hammadde kategorileri ve sayım grupları `src/lib/constants.ts`'te
sabit (eski tablonun sütunları). `invoice_categories` gibi tablolar + Ayarlar'da düzenleme; mevcut değerler göçle
tohumlanır. Sabit giderin "Para nereye gitti?" grubu ve stopaj tahmini kalemin adından bulunuyor: kalem kartında
seçilsin. Muhasebeciye sorulacaklar listesindeki sabit tutar/tarihler (`src/lib/tax/checks.ts`) yıldan türesin.

### P7. Dönem kapanışını genişlet (orta)
Kapanış yalnız fatura ve harcamayı kilitliyor; sayım, ciro, gelir-gider hücresi ve kasa raporu kapalı ayı hâlâ
değiştirebiliyor. `src/server/closed-period.ts`'e `assertMonthOpen` ve bu eylemlerde kullanımı.

### P8. Fotoğraf okuma doğruluğu (orta)
Yapay zekâ artık taranmış siyah-beyaz görüntüyü okuyor. Asıl fotoğraf da saklandığı için okuma asıl (ya da gri) hâlden
yapılsın ya da bir süre iki sonuç karşılaştırılsın. Gerçek (adları/tutarları gizlenmiş) 20–30 Z ve fiş fotoğrafından
regresyon seti (sahip fotoğrafları verince). Yazarkasa (banka POS) Z'sinin canlı değerlendirmesi ve doldurma kapısı
(docs/planlar/okc-z.md § 17).

### P9. Temizlik (düşük)
Kaldırılan özelliklerin kalıntıları (Kıyas kartı, Satış tahmini, hızlı sayım, mal siparişi tabloları, eski `kasa-pos`
foto türü), bayat plan belgeleri (docs/planlar/KALAN-ISLER.md vb. başına "tarihî" notu ya da arşiv), birleşmiş `wip/*`
dalları (GitHub'da silinsin), çok büyümüş dosyaların bölünmesi.

### Sonra (değer düşük ya da büyük iş)
Ağır veri yolu ve Faturalar listesinin sayfalanması; ModPOS föyünden kasa formunu doldurma; asistanın eksik okuma
araçları (kasadan_cikanlar, zayi_ikram, komisyon_kanallari) ve ~60 işlem uyarlayıcısı; mutabakatta resmi tatiller
("Geç geldi" yanlış uyarısı); şube başına kalan ayarlar (uyarı sesi / kontrol hatırlatma saatleri); Tükendi'nin şube
başına tutulması; karaoke "Gelmedi"; senkron Faz 2'nin panel tarafı; tedarikçi "Birleştir"; cari v2.
LafPOS deposu gerektirenler (sahip onayı): kayıp önleme için iptal / ikramı yapan kişi; iki şubeli LafPOS;
`bankPosPending` değişikliğinin LafPOS'ta birleşmesi.

## Sahibin tarafında (kod değil)

1. **Depoyu gizli yap** (yukarıda, acil) ve açığa düşmüş anahtarları yenile.
2. GitHub › Settings › Branches: main için "Require status checks" ("Tip · Lint · Test · Derleme") — #157 kırmızı CI'yla
   birleşti, main saatlerce kırmızı kaldı.
3. GitHub sırrı `ANTHROPIC_API_KEY` (ve Anthropic Console bakiyesi): PR incelemesi bir kez bile çalışmadı.
4. Vercel planı: Hobby ticari kullanıma izin vermiyor ve günlükler 1 saat; Pro kararı (docs/DEPLOY.md § 8). Neon:
   laffogato.net veritabanının kotası dolu (online sipariş / karaoke / menü eşitlemesi duruyor), panelinki ücretsiz planda.
5. Vercel: iki adımlı doğrulama zorunlu olsun → `ADMIN_2FA_REQUIRED=1`; CSP bir hafta temizse `CSP_ENFORCE=1`;
   kullanılmayan `PARASUT_USERNAME` / `PARASUT_PASSWORD` silinsin.
6. Yayından sonra el kontrolü (10 dk): kasa raporu, fatura, Z e-postası, raporlar; belge tarayıcı gerçek iPhone ve
   Android'de (vizör, otomatik çekim, tarama ekranı).
7. Ayarlar › Muhasebeci paketi'ne muhasebecinin adresi; Marina gün sonu e-postası alıcıları Kasa › Rapor alıcıları'nda.
8. Muhasebeciyle: SGK işveren oranı (%15,75 mi %19,75 mi).
9. Yedekten geri yükleme provası (docs/YEDEK.md § 9) ve dış sağlık izleyicisi (`/api/health?isler=1`, ör. UptimeRobot).
10. Gerçek Z / fiş fotoğrafları (adları gizlenmiş) — tarayıcı ve okuma regresyon seti için.

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
almaz; güncel ağaçtaki kişi adları P2'de uydurma adlarla değiştirildi (geçmişte gerçekleri duruyor).

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

## 27 Kasım: sahibin yeni kararları ve sıra

- **CI incelemesi:** sahip 27 Kasım'da CI için Anthropic anahtarını ekledi. Yeniden koşturulan inceleme yine düştü
  (`is_error`); depo düzeyindeki `ANTHROPIC_API_KEY` sırrının tarihi 23 Ekim: anahtar kuruluş düzeyinde eklendiyse depo
  sırrı onu gölgeler, depo sırrı yeni anahtarla güncellenmeli. Çalışınca "inceleme" engel sayılmaz ama yorumları okunur.
- **Kasa programının adı AsilPOS** (yazılış "AsilPOS"; 26 Kasım 2026'ya kadar adı LafPOS): panelde ve kasa deposunda
  her yerde (metin, kod, dosya, tablo, ortam değişkeni); kurulu kasa ve Vercel bozulmasın diye eski adlar
  (ASILPOS_* yerine LAFPOS_* değişkenleri, kasanın çağırdığı yollar, kasa bilgisayarındaki klasör ve görev) bir süre
  daha tanınır. GitHub deposunun adı `lafpos` kalır.
- **Marina yalnız AsilPOS:** Marina'da ModPOS tamamen bitti (kütükte kaynak AsilPOS, föy çekilmez).
- **Her şubenin kendi AsilPOS kasası** olabilir (panel + kasa deposu; "AsilPOS yalnız bir şubenin kasası" sınırı kalkar).
- **Şube ayrımı:** şube seçiliyken her ekranda yalnız o şubenin bilgisi. Bugün firma geneli olan ekranlar (Vergi, Nakit
  planı, Tutarlılık, Mutabakat, tedarikçi bakiyeleri, stok değeri, yedek) her kullanıcının kendi ayarıyla seçilsin.
- **P8'e ek:** banka POS Z'sinin ÖZET bölümündeki "Toplam KDV" okunmadı ("fotoğrafta yok"), fiş yanlışlıkla "farklı"
  çıktı: kodla okuma + istem örnekleri + regresyon seti.
- **Sıra:** P1 (bitti) → AsilPOS (panel adı, kasa adı, çoklu şube + Marina) → P2 → şube ayrımı → P3–P9. P2 (#165) hazır ve
  main'in #164'ten beri düşen iki testini düzeltiyor: önce o birleşir.
- **Durum (27 Kasım gece):** P1'in 12 bulgusu ve iki ek maddesi testleriyle düzeltildi (`wip/entegre3-fix`, #163);
  ikinci bağımsız inceleme yarıda (kullanım limiti). Kasa deposunda ad değişikliği `asilpos-adi` dalında, incelemesi kaldı.
- **AsilPOS ilerleme:** panelin ad değişikliği #166 (P1'in üstünde), kasa deposunda ad değişikliği #187 ve çoklu şube
  kasa tarafı #188 hazır. Panel çoklu şube (B1) + Marina yalnız AsilPOS `cok-sube-kasa` dalında hazır (#166'nın üstünde;
  göç 0099): üç bağımsız incelemenin (para, anahtar, geçiş) doğrulanan bulguları testleriyle düzeltildi (süren ayın
  kasa raporu beklemesi kasa başına, geçiş günü sonra olan kasanın komisyonu föyün markasıyla, komisyonun günleri takvim
  günü, Marina dışı anahtar metinleri, anahtarın başka şubenin kasa hareketini yazmaması, kurulum kodunun kilidi). Dal
  gönderilmedi, PR açılmadı: #166'dan sonra birleşir, gün sonu penceresinin (22:00–03:00) dışında. Sonra sahip:
  YAPILACAKLAR.md › Dalga 3'teki [Sahip] maddesi. Şube ayrımı (plan B adım 9) ayrı paket. Daraltma (A3) ≥ 7 gün sonra.

## Kod paketleri (sırayla; her biri ayrı dal ve PR)

### P1. Roller + vardiya şube ayarları — BİTTİ (#163)
İlk incelemenin 12 bulgusu ve ikinci bağımsız yetki incelemesinin (eylemler, okuma sızıntısı, API uçları, e-posta / zil)
doğruladığı 6 bulgu testleriyle düzeltildi; göç 0097_roller. Ayrıntı: YAPILACAKLAR.md › Bitenler.

### P2. Excel'den tam bağımsızlık — BİTTİ (#164 ve bu PR)

### P3. Hata izleme ve kayıt — BİTTİ (bu PR)
`src/instrumentation.ts` › `onRequestError`, `attempt()`, tarayıcı (`/api/hata`) ve CSP raporları `error_log`'a (30 gün,
aynı hata tek satır); ekran Ayarlar › Hata kaydı ("Sistem" yerine adı bu); kritik hatada günde bir sistem uyarısı
e-postası; CSP_ENFORCE kararı kartta (7 gün kanıt). Göç `0100_hata_kaydi`: main ilerlediyse birleştirmede yeniden
üretilir. Sentry eklenmedi (docs/HATA-KAYDI.md § 7). İnceleme düzeltmeleri (aynı PR): sorgu parametresi hiç alınmaz,
kapı kaynak başına (CSP yağmuru sunucu hatasını düşürmez), NUL ve uzun girdi, eklentinin CSP ihlali kayda girmez,
Çözüldü 7 günü atlatmaz, son beş hata kodu, takılan e-postanın anahtarı yeniden alınır. Ayrıntı docs/HATA-KAYDI.md.

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
Kafe dışı faturaların ortağın adını taşıyan kategorisi (koddaki sabit liste, `SEPARATE_CATEGORIES`, belgeler ve testler)
bir kişi adıdır: kategoriler tabloya taşınınca kod ve belgeler adı değil rolü ("ortak hesabı", kafe dışı) kullansın; ad
yalnız veritabanında, sahibin yazdığı kategori adı olarak kalsın (P2 denetimi, 26 Kasım).

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
AsilPOS deposu gerektirenler (sahip onayı): kayıp önleme için iptal / ikramı yapan kişi; çok şubeli kasanın kasa tarafı
(#188, ikinci kasa açılmadan önce); `bankPosPending` değişikliğinin AsilPOS'ta birleşmesi.

## Sahibin tarafında (kod değil)

1. **Depoyu gizli yap** (yukarıda, acil) ve açığa düşmüş anahtarları yenile.
2. GitHub › Settings › Branches: main için "Require status checks" ("Tip · Lint · Test · Derleme") — #157 kırmızı CI'yla
   birleşti, main saatlerce kırmızı kaldı.
3. GitHub sırrı `ANTHROPIC_API_KEY` (ve Anthropic Console bakiyesi): PR incelemesi bir kez bile çalışmadı.
4. Vercel planı: Hobby ticari kullanıma izin vermiyor ve günlükler 1 saat; Pro kararı (docs/DEPLOY.md § 8). Neon:
   laffogato.net veritabanının kotası dolu (online sipariş / karaoke / menü eşitlemesi duruyor), panelinki ücretsiz planda.
5. Vercel: iki adımlı doğrulama zorunlu olsun → `ADMIN_2FA_REQUIRED=1`; Ayarlar › Hata kaydı CSP'yi "uygulanabilir"
   deyince `CSP_ENFORCE=1`;
   kullanılmayan `PARASUT_USERNAME` / `PARASUT_PASSWORD` silinsin.
6. Yayından sonra el kontrolü (10 dk): kasa raporu, fatura, Z e-postası, raporlar; belge tarayıcı gerçek iPhone ve
   Android'de (vizör, otomatik çekim, tarama ekranı).
7. Ayarlar › Muhasebeci paketi'ne muhasebecinin adresi; Marina gün sonu e-postası alıcıları Kasa › Rapor alıcıları'nda.
8. Muhasebeciyle: SGK işveren oranı (%15,75 mi %19,75 mi).
9. Yedekten geri yükleme provası (docs/YEDEK.md § 9) ve dış sağlık izleyicisi (`/api/health?isler=1`, ör. UptimeRobot).
10. Gerçek Z / fiş fotoğrafları (adları gizlenmiş) — tarayıcı ve okuma regresyon seti için.

# Devam notu (26 Kasım 2026 akşamı)

> **Güncel durum, sıra ve devam istemi:** [KALANLAR.md](../../KALANLAR.md) (28 Kasım 2026). Kullanıcı "kalanlardan devam et"
> derse oradan başlanır; bu not tarihçe ve paketlerin ayrıntısı için kalır.

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
- **Şube ayrımı:** şube seçiliyken her ekranda yalnız o şubenin bilgisi. Bugün firma geneli olan ekranlar (Nakit
  planı, Tutarlılık, Mutabakat, tedarikçi bakiyeleri, stok değeri, yedek) her kullanıcının kendi ayarıyla seçilsin.
  **Durum (27 Kasım):** `sube-ayrimi` dalında hazır (#167'nin üstünde; göçler 0100, 0101): altı parça, bağımsız doğrulama
  testi (`tests/sube-ayrimi-db.test.ts`) ve doğrulamanın sekiz sızıntısının düzeltmesi. Dal gönderilmedi, PR açılmadı:
  açıklaması `~/Downloads/lafmaliyet-ekler/sube-ayrimi-pr.md`; #167'den sonra birleşir. Sahibin kararına kalanlar
  (nakit planının işletme geneli satırı, "Ciroya göre pay et"; Vergi'ninkiler bölüm kaldırılınca düştü) YAPILACAKLAR.md ›
  Bitenler'de ve docs/SUBE.md › Doğrulama düzeltmeleri'nde. Tam yedek ayarsız firma geneli kaldı (geri yüklenebilir
  yedek bütün veritabanını ister).
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

- **Anahtar değişimi uyumu (27 Kasım öğleden sonra; dal `uyum-anahtar`, gönderilmedi):** sabahki olaydan sonra (iki
  anahtar yalnız panelde değişti, Uzaktan perşembe dondu) üç depoda uyum: panelde anahtar uyumu denetimi (Uzaktan ve
  site panelin anahtarını kabul ediyor mu; Ayarlar › AsilPOS ve zil), kasa deposunda Uzaktan'ın `_ONCEKI` anahtarı
  (`uyum-1`, #189'un üstünde), sitede `LAFPOS_SYNC_SECRET_ONCEKI`. Sıra: kasa ve site PR'ları yayına çıkmadan yeni
  anahtar sırası (docs/ASILPOS.md › Anahtar değişimi) kullanılmaz; panelin denetimi tek başına da güvenli (yalnız uyarır).
  Sahibe söylenecek: sonraki değişimde önce Uzaktan ve site (`_ONCEKI` ile), sonra panel, sonra Ayarlar › AsilPOS ›
  Anahtarları sına. İnceleme düzeltmeleri aynı dalda ("Uyum: inceleme düzeltmeleri"): panelin uyarısı uç `_ONCEKI`'yi
  tanıdığını yanıt başlığıyla (`x-laf-anahtar`) söylemedikçe uçtaki değeri değiştirtmez; kasa sorunca saatte bir sınanır;
  Uzaktan'ın `/api/health` › `onceki` bayrağı okunur. Başlık ve bayrak kasa ve site dallarından gelir (onlarsız panel
  "önceki anahtarı tanımıyor" der, belge değişimi başlatmaz). Yayın sırası DEPLOY.md § 7.

## 27 Kasım gece: durum ve sıra (bu PR)

Bugün main'e girenler (hepsi canlıda): #163 roller, #165 başlangıç verisi, #166 AsilPOS adı (0098), #167 çok şubeli kasa ve
Marina yalnız AsilPOS (0099), #168 hata kaydı (0100), #169 anahtar değişimi uyumu, #170 şube ayrımı (0101), #171 Vergi bölümü
kaldırıldı (muhasebeci yürütüyor; veriler silinmedi). Kasa deposunda #187–#191 (ad, çok şube, bağımlılıklar, iki anahtar,
masaüstü programı); sitede #302.

Sıra:
1. ACİL site: Next.js 16.4.6'ya (açıklı 16.3.8), zod ≥ 4.6.6. Next.js 16.4.6 bitti (laffogato #303, 28 Kasım).
2. SON TARİH 10 Aralık: sitenin e-Arşiv'i Paraşüt'e eski şifreli girişle bağlanıyor, o gün duruyor; Paraşüt OAuth'a
   geçmeli. Sahibin kararı (28 Kasım): şimdilik sıradan çıktı. Şart: bağlantı şube başına olacak, her şube kendi Paraşüt
   hesabını kendisi ekleyebilecek, biri ötekini düşürmeyecek. DevHub uygulaması açıldı. Sitenin Vercel'indeki
   PARASUT_USERNAME / PASSWORD geçişe dek silinmez.
3. Denetimin küçük hataları (tek PR): satış yapıştırmada ReDoS, muhasebeciye yazma düğmeleri, yüklemede yönetici sekmeleri,
   kapalı şubenin müdürüne bildirim, "Tümü"de kart komisyonu. (bitti, bu PR)
4. Özel günler bölümü panelden kaldırılır (sahibin isteği; veriler silinmez). Dikkat: "kafe kapalı" günleri
   `special_days` tablosunda `kind = 'kapali'` satırıdır ve komisyon, eksik rapor, kontrol listesi, Z sürekliliği bunu okur.
   Kapalı gün akışı (Kasa raporu › Kafe kapalıydı, Onaylar, yöneticinin ileri tarihli kapalı günü) başka ekranda yaşamaya
   devam eder; yalnız maç, AVM etkinliği ve kampanya notları ve menüdeki üç giriş kalkar.
5. Basitleştirme: kullanan için ve satılacak işletmeler için sade ekranlar (az kullanılan alanlar gizlenir ya da ayara taşınır,
   metinler kısalır, ilk kurulum kolaylaşır).
6. P5 (dal p5-ay-ayarlari, yarım): ay bazlı ayarlar + 2027 bordro ve stopaj değerleri; bordro ayarları Ayarlar › Personel'e.
7. ModPOS API anahtarı girme ekranları kalkar (Tuzla'nın otomatik çekimi kalır).
8. Ürün görselleri: siteden alınır, kasada ortalı, ladmin'den yüklenip kasaya anında gider.
9. Kasa: Giderler "Günü kapat" içinde; kasaya hata kaydı.
10. P8 fotoğraf okuma (+ banka POS Z ÖZET'inde Toplam KDV), P7 dönem kapanışı, P6 sabit listeler (ortağın adı koddan çıkar),
    P4 CI, P9 temizlik, A3 eski adlar (en erken 4 Aralık), asil-platform satışa hazırlık.

28 Kasım'da eklenen kalanlar (sıraya girecek):
- Kasada gerçek açılış (sahibin isteği): önce ladmin kullanıcı adı ve şifresi, sonra hangi şubenin açılacağı; şube zaten
  kuruluysa "emin misin / başka şube" sorusu.
- Panelde asıl yöneticinin şube açma, kapatma, silme ve kasa kurma yetkisi: bitti (P-B1, dal
  `asil-yonetici-sube-ekleme`; aşağıda "28 Kasım: asıl yönetici ve Şube ekleme").
- Kasa: "Kurulumu yap" fiş yazıcısını da bulup denetebilsin (sahibin isteği).
- Kasa deposunun PR'ları: #192 Token sürücüsünün sessiz kurulumu, #193 müşteri ekranında çeviri balonu, yenileme simgesi
  PR'ı.

## 28 Kasım: personele kör sayımlı WhatsApp metni (dal whatsapp-kor-metin)

Sahibin bildirimi: "WhatsApp kopyala gitmiş ladmin'de, o olsun". Marina'da (AsilPOS günü, kör kasa) personelin Kasa raporu
kartında WhatsApp ile gönder ve Metni kopyala geri geldi; metin sayımsız (`whatsappText(…, { blind: true })`; açılış,
sayılan, teslim, olması gereken, fark ve devir yok), sunucunun eylemi reddetmek yerine aynı metni verir. Yönetici ve Tuzla
değişmedi. Göç yok. Yukarıdaki sıra değişmedi.

## 28 Kasım: asıl yönetici ve Şube ekleme (dal asil-yonetici-sube-ekleme; P-B1)

Tasarım [kasa-acilis-ve-asil-yonetici.md](kasa-acilis-ve-asil-yonetici.md) › P-B1, istek
[istek-28-kasim.md](istek-28-kasim.md) › B. Şube açma, kapatma, silme, kasa programı, kasa kurma, kasa anahtarı ve geçiş
günü yalnız asıl yöneticide (`requireAnaAdmin`, `src/lib/asil-yonetici.ts`); asıl yöneticinin hesabı öteki yöneticilere
karşı korunur (adres boştayken hesap açılabilir: kilitlenme olmasın); kapanan şubenin bekleyen kurulum kodları iptal,
kapalı şubenin kodu 410. Yeni sayfa Ayarlar › Şube ekleme (`/panel/sube-ekleme`): yeni şube, kasa durumu, "Bilgisayara
kur". Göç yok; yeni uç yok; `resolvePosCaller`, `readKeys`, `ensurePosKey` değişmedi. Sıradaki: P-B2 (açılış uçları,
ilk personel, "Kasayı serbest bırak", kasa kaydı), sonra kasada K5. Canlıya almadan önce: `info@nextgenlab.com.tr`
hesabı canlıda var, etkin ve yönetici mi (değilse hesap koruması onu da kilitler; docs/ROLLER.md › Asıl yönetici).

## 28 Kasım: kasa açılışı uçları, ilk personel, Kasayı serbest bırak (dal kasa-acilis-uclari; P-B2)

Tasarım [kasa-acilis-ve-asil-yonetici.md](kasa-acilis-ve-asil-yonetici.md) › P-B2 (devralma kalktı), istek
[istek-28-kasim.md](istek-28-kasim.md) › B ve C. Üç uç: `POST /api/asilpos/acilis/giris` (asıl yöneticinin girişi;
panelin giriş korumaları ortak modülde, `src/server/auth/giris-korumalari.ts`, davranış aynı), `.../bagla` (boş şubeye
bağlar; kurulu şube her zaman 409, anahtar dönmez), `.../teslim` (ilk personelin teslim onayı, şube anahtarıyla imzalı).
Kasa kaydı ve hazırlık `integration_state`'te; ilk personel mühürlü, yedek dışı. Şube ekleme'de "İlk personeli ayarla" ve
"Kasayı serbest bırak". Göç yok; var olan uçlar, `resolvePosCaller`, `readKeys`, `ensurePosKey` ve
`/api/panel/pos/baglanti` değişmedi. Tam sözleşme docs/ASILPOS.md › Kasa açılışı. Sıradaki: kasada K5 (P-B2 canlıya
girdikten sonra).

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

### P5. Ayarlar ay bazlı + 2027 bordro ve stopaj değerleri (yüksek; 2027 değerleri Ocak'tan önce)
SGK oranları, yemek kartı, şube POS oranı değişince geçmiş aylar yeniden hesaplanıyor (Excel'den kalan "tek ayar"
modeli). Ayarlar geçerlilik başlangıcıyla (ay) saklansın; hesap her ayı kendi ayarıyla yapsın. **Daraltıldı (27 Kasım
2026, Vergi bölümü kaldırıldı):** kaldırılan modülün 2027 vergi kuralları (kurumlar ve geçici vergi, damga tutarları,
vergi takvimi) artık yok. Kalan iş yalnız hâlâ kullanılan sabitlerin 2027'si: `src/lib/bordro/rules-2027.ts` (asgari
ücret, ücretin gelir vergisi tarifesi ve damga oranı, SGK oranları ve PEK sınırları, asgari ücret desteği: nakit planının
maaş ve SGK satırı; kira, serbest meslek ve internet reklamı stopajı: Gelir-gider'in "Kira stopajı" ve stopajlı sabit
giderin net ödemesi), `PAYROLL_RULES`'a eklenir. Eklenmezse 2027 2026 değerleriyle hesaplanır (tahmini). Kodda gömülü
öteki "2026"lar yıldan türesin. SGK işveren oranı Ayarlar'da %15,75 (Excel'den; Gelir-gider ve Maaşlar); nakit planının
bordrosu yasal %19,75 — sahip/muhasebeci kararı bekliyor, ayar olarak sorulsun.

### P6. Excel'den kalan sabit listeler ekrandan düzenlenebilsin (orta)
Fatura kategorileri (mal / kafe dışı / demirbaş… rolüyle), hammadde kategorileri ve sayım grupları `src/lib/constants.ts`'te
sabit (eski tablonun sütunları). `invoice_categories` gibi tablolar + Ayarlar'da düzenleme; mevcut değerler göçle
tohumlanır. Sabit giderin "Para nereye gitti?" grubu ve stopaj tahmini kalemin adından bulunuyor: kalem kartında
seçilsin. (Muhasebeciye sorulacaklar listesi Vergi bölümüyle 27 Kasım 2026'da kalktı.)
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

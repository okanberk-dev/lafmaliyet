# Kalan işler (23 Ekim 2026, 18:30 UTC itibarıyla)

Bu klasör, panel için hazırlanan uygulama planlarını ve kalan işlerin durumunu tutar. Yeni bir oturum işe buradan
başlar. Planlar İngilizce yazıldı; arayüz metinleri Türkçedir ve planlarda birebir verilir.

## 1. Canlıda olanlar

- `main` @ 663b166: dalga 1–6 birleşti (23 Ekim; sahip birleştirmeyi oturuma bıraktı, squash): #8 (ops-backup, vkn),
  #10 (ekle, pricing, pompa-mobil), #12 (insight + KDV, fotograf, menu), #13 (kasa, W2.0'ın kalanı, today, mcp),
  #14 (kontrol, doluluk), #17 (fatura okuma, oneri-fiyat). Ayrıca #11 (PR incelemesi için Claude iş akışı) ve diğer
  oturumdan #15 (KDV-2: tevkifatlı faturanın KDV'si, nakit planında 25'inde ayrı ödeme). Canlı derleme günlüğü:
  `✓ Veritabanı şeması güncel (32 migration)` ve beklenen tek uyarı (21 Eki 22:27 UTC'de bir önizlemenin uyguladığı
  eski menü migration kaydı; zararsız, dalga 7'den sonra `KNOWN_ORPHANS`'ta). **#13'ten geriye Instant Rollback yok**
  (`docs/DEPLOY.md` §7).
- **Dalga 7 (denetim düzeltmeleri, `claude/kalan-isler-7`):** 23 Ekim denetiminin panel bulguları; migration'lar
  `0032_giris_cihaz_islem_kisisi` ve `0033_sabit_gider_kdv`. Ayrıntı ve sahibe notlar aşağıda, "Denetim düzeltmeleri".
- Fotoğraftan okuma canlıda açık: özel Vercel Blob deposu `laffogato-foto-panel` (fra1); `BLOB_READ_WRITE_TOKEN` ve
  `ANTHROPIC_API_KEY` yalnız Production'da. Eski boş `laffogato-foto` deposu kullanılmıyor.
- Daha önce: PR #7 (yönetici işlemlerinde parolayla onay, günlük işlerin takibi, canlı derlemede migration
  doğrulaması `scripts/migration-check.ts`), önizlemeler migration çalıştırmaz (`scripts/predeploy-guard.ts`, PR #6),
  tedarikçiler, giriş güvenliği, site menüsü eşitlemesi, bar ekranında siparişler; PR #9 (diğer oturum): bar
  ekranından tek dokunuşla sipariş aşaması, Ayarlar'da "Bağlantıları sına".
- **Paralel çalışan bir oturum daha var** (site ↔ panel işleri): sahiplik, sözleşmeler ve çakışma noktaları
  `DIGER-OTURUM.md`'de. İşe başlamadan okuyun.
- **PR incelemesi:** #11 birleşti ama iş akışı çalışmıyor: hesabın GitHub Actions dakikaları bitti (iş, çalıştırıcı
  başlamadan düşüyor, `runner_id: 0`); Codex incelemesi de kullanım sınırında. Doğrulama her dalgada yerelde yapılır.
  Kalan dalgaların her biri main'e ayrı bir PR'dır.
- **Sonradan (bu özetin 18:30 UTC anından sonra birleşenler):** #16 (diğer oturum: KDV-2 hatırlatıcıları, 17c3e68),
  #18 (dalga 7, 514376d), #19 (arayüz taraması, 7b86866), #20 (diğer oturum: sitenin 409 `single_size` yanıtı kopuk
  bağlantı olarak). Güncel durum için `git log origin/main`.

## 2. Kalan işler (sırayla)

### Birinci paket (planlar hazır; kurallar ve birleştirme sırası `CRITIQUE.md`)

| # | Grup | Plan | Migration (birleştirmede üretilir) | Durum |
|---|---|---|---|---|
| 3 | ops-backup: tam yedek ve denenmiş geri yükleme | `ops.md` §2 + CRITIQUE "ops" düzeltmeleri | yok | **Bitti:** dalga 1 PR'ı (`docs/YEDEK.md`) |
| 4 | vkn: tedarikçiyi vergi numarasıyla eşleştirme (çekirdek; "Birleştir" ertelendi) | `vkn.md` + CRITIQUE §3/§4 | `0021_fatura_vergi_no` | **Bitti:** dalga 1 PR'ı |
| — | **ekle** (sahibin 22 Ekim isteği): sayıma kalem ekleme (personel de), sekiz yeni kalem (Klips kapak dahil), personelin yeni ürün önerisi | `ekle.md` | `0022_recete_yeni_urun`, `0023_sayim_yeni_kalemler` (veri) | **Bitti:** dalga 2 PR'ı |
| 5 | pricing: büyük Paraşüt fiyat sıçramasına onay, tedarikçiye göre fiyat | `pricing.md` | `0024_fiyat_onayi` | **Bitti:** dalga 2 PR'ı |
| — | **pompa-mobil** (sahibin 22 Ekim isteği): püre pompası 30 ml (şurup 10 ml), reçete defterinde pompa ipucu, telefonda uygulama hissi | `pompa-mobil.md` | yok | **Bitti:** dalga 2 PR'ı |
| 6 | kasa: ay bilgisi kasa raporlarından, kasa bütünlüğü | `kasa.md` | `0027_kasa_ay_bilgisi_butunluk` | **Bitti:** dalga 4 PR'ı (bu sürümden geriye Instant Rollback yok, `docs/DEPLOY.md` §7) |
| 7 | insight: zam etkisi (₺/ay), 6 haftalık nakit planı **+ `kdv.md` eki** (aynı dalda) | `insight.md`, `kdv.md` | yok | **Bitti:** dalga 3 PR'ı (`docs/NAKIT-PLANI.md`) |
| 8 | menu: toplu fiyat değişikliği, ModPOS listesi, fiyat geçmişi | `menu.md` | `0026_fiyat_gecmisi` | **Bitti:** dalga 3 PR'ı (`docs/FIYATLAR.md`) |
| 9 | today: "Bugün" ekranı, telefonda yeni alt menü | `today.md` | yok | **Bitti:** dalga 4 PR'ı (`docs/BUGUN.md`); birinci paket tamam |

Dalga 1 (ops-backup, vkn) yarım yamalardan tamamlandı; `wip/` klasörü kaldırıldı. Birleştirmede migration'lar
yeniden üretilir (R2); her dalga main'e ayrı bir PR'dır.

### İkinci paket (planlar hazır; ortak bilgi `BRIEF2.md`)

| Grup | Plan | Ne |
|---|---|---|
| kontrol | `kontrol.md` | Fotoğraflı açılış/kapanış kontrol listeleri, Bugün ekranında. **Bitti:** dalga 5 PR'ı #14 (`0029_kontrol_listeleri`, `docs/KONTROL-LISTELERI.md`; 2. aşama kesildi) |
| komisyon | `komisyon.md` | Yemek kartı ve platform komisyon/hakediş kontrolü (%6 sınırı, 30 gün; hakediş elle işaretlenir). **Bitti:** dalga 8 PR'ı (`0034_komisyon_hakedis`, `docs/KOMISYON.md`) |
| fotograf | `fotograf.md` | Z raporu, POS gün sonu ve market fişini fotoğraftan Claude ile okuma; ortak foto deposu ve Claude istemcisi bu grubun. **Bitti:** dalga 3 PR'ı (`0025_fotograf_okuma`, `docs/FOTOGRAF.md`; sahibin 22 Ekim isteğiyle öne alındı; W2.0'ın 1, 2, 3 ve 7. maddeleri de bunda) |
| siparis | `siparis.md` | Sipariş önerisi, hızlı sayım, tedarikçiye WhatsApp siparişi, teslim kontrolü. **Bitti:** dalga 8 PR'ı ("Mal siparişi", `0035_mal_siparisi`, `docs/MAL-SIPARISI.md`) |
| mcp | `mcp.md` | Claude uygulamasından panele soru sorma (salt okunur, yalnız yönetici, OAuth). **Bitti:** dalga 4 PR'ı (`0028_claude_baglantisi`, `docs/CLAUDE-BAGLANTISI.md`) |
| tahmin | `tahmin.md` | 7 günlük satış tahmini, personel ve tatlı önerisi, isabet ölçümü. **Bitti:** dalga 9 PR'ı (`0036_satis_tahmini`, `docs/SATIS-TAHMINI.md`; öğrenme ve günlük veri yolları CRITIQUE2 §6 gereği çıkarıldı) |
| doluluk | `doluluk.md` | Karaoke doluluk haritası ve göstergeler. **Bitti:** dalga 5 PR'ı #14 (`0030_karaoke_doluluk`, `docs/KARAOKE.md` › Doluluk; KVKK: 3 × 366 günden eski karaoke adları sabah işinde silinir) |
| haftalik | `haftalik.md` | Haftalık yönetici özeti (pazartesi e-postası, ₺ etkisine göre en çok 5 madde); diğer planların hepsini tüketir; en son. **Bitti:** dalga 9 PR'ı (`docs/HAFTALIK-OZET.md`; migration yok) |

**İkinci paketin çapraz eleştirisi `CRITIQUE2.md`'de** (R8–R19 ortak sözleşmeler, zaman bütçesi, güvenlik, kesintiler,
sıra, sahibe sorular). Önce ortak altyapı PR'ı (W2.0), sonra fotograf ∥ mcp, kontrol ∥ doluluk, siparis ∥ komisyon,
tahmin ∥ haftalik. Kafe **İstanbul Tuzla, Opera AVM**'dedir; `tahmin.md`'nin hava durumu noktası Tuzla'ya alındı (R19).
Site deposu 22 Ekim'de incelendi (`DIGER-OTURUM.md` sonu): karaoke ucu geçmiş tarihleri zaten veriyor; doluluk site
değişikliği beklemez. W2.0'ın kalanı (sendEmail seçenekleri, sabah e-postası kutuları ve `DIGEST_EXTRA_SOURCES`,
ModPOS günlük satış ağzı `loadDailyProductSales`, adım etiketleri) dalga 4'te. Dalgalar: 5 kontrol ∥ doluluk (#14),
6 fatura ∥ oneri-fiyat (#17; sahibin 23 Ekim istekleri, aşağıda), 7 denetim düzeltmeleri (baglanti ∥ para, aşağıda);
8 siparis ∥ komisyon; arayüz taramasının düzeltmeleri #19; 9 tahmin ∥ haftalik; her biri ayrı PR. İkinci paket dalga 9
ile bitti.

### Sahibin 23 Ekim istekleri (dalga 6, ikinci paketten önce)

| Grup | Plan | Ne |
|---|---|---|
| fatura | `fatura-okuma.md` | Faturadaki paket boyu addan ("150 AD.") ve PDF'ten (Claude Haiku 5.5) okunur; fiyat onayında kanıtsız "Çarpanı X yap" önerisi kalkar, tahmini fiyat açıkça söylenir. Canlıdaki iki örnek: Yenilebilir bardak (1 Adet = 150 adet, adet başı 20 ₺, %52 ucuz) ve Klips kapak (1,165 ₺ 0023'ün varsayımıydı; Serendi'nin 24.07 faturası 12,02 ₺). **Bitti:** dalga 6 PR'ı #17 (`0031_fatura_okuma`, `docs/FATURA-OKUMA.md`) |
| oneri-fiyat | `oneri-fiyat.md` | Personel yeni ürün önerirken boy başına satış fiyatı yazabilir (yönetici onayda görür, değiştirebilir); reçetede listede olmayan malzemeyi formdan çıkmadan ekler (Listeye ekle kurallarıyla, isteğe bağlı paket fiyatı); Listeye ekle'ye de paket fiyatı. **Bitti:** dalga 6 PR'ı #17 (personelin paket fiyatı KDV dahil alınır, KDV düşülüp yazılır) |

### Denetim düzeltmeleri (dalga 7)

23 Ekim'de dokuz bölümlü salt okunur denetim (bağlantı, canlı sağlık, güvenlik, para, veri, kalan işler, arayüz)
yapıldı; panel bulguları iki grupta düzeltildi, site bulguları laffogato oturumuna iki prompt olarak verildi.

| Grup | Ne |
|---|---|
| baglanti | Veritabanı: okumada bir kez yeniden deneme, havuz süreleri, TLS `verify-full` (acil durumda `DATABASE_SSL=require`), derlemede havuz bağlantısı migration'dan önce denetlenir. Site pingleri kaydı yazamasa da çeker, düşen çekme bir kez daha; kaçan karaoke çekmesi açık sekmede yakalanır. Neon kotası: yoklama yalnız sekme görünürken ve seyrek, `/api/health` önbellekte. Hata ekranları yeniden dener. Giriş: bilinen cihazın kilidi veritabanında (`login_device_locks`), TOTP ve kurtarma kodu tek kullanımlık, işlem geçmişinde hesap (`activity_log.user_id`). Kasadan çıkanın geri alınması mühürlü ve tek kullanımlık. Karaoke uzatma tek SQL yazımı, planlı bar siparişinde "45 dk kaldı" ve 15 dk önce zil. `db:reset` uzak veritabanında onay ve önce yedek, zayi kayıtları kalır. Personel rolü metinleri, oda saatleri 12:00–24:00, pompa kuralı, belgeler |
| para | Paraşüt: sitenin satış iadeleri gider sayılmaz (yalnız bilgi), e-faturaya bağlı kayıt silinmez, geç girilen faturalar kaçmaz, eşitlemenin veritabanı yolları sahte Paraşüt'le sınanır. Nakit planı sabit giderleri faturadaki KDV'siyle öder (`fixed_expenses.vat_rate`). Sayım ay sonundaki fiyatla değerlenir. Genel bakış online satışı da sayar. Kapalı günler sabit gideri azaltmaz. Ay ortasında yapıştırılan satış listesinin günü. `1,250.00` doğru okunur. Online satış üç ay geriye çekilir (geç iadeler). Sitenin isteğe bağlı `counter`, seçenek sayıları ve sipariş notları kabul edilir. Geçmişi olan ürün silinmez |

**Sahibe notlar (dalga 7):**
- Neon Free planı (ayda 100 CU-saat): Vercel › Storage › kullanım tahmini 100'ü aşıyorsa ücretli plana geçin; bar
  tabletine bildirim izni verin (bildirim yokken öndeki ekran 20 saniyede bir sorar ve veritabanı uyumaz; arka
  plandaki sekmede zil 10 dakikaya kadar gecikir; Sipariş bildirimleri açık kalsın).
- Dış izleyici `/api/health?isler=1`'i saatte bir değil 6 saatte bir çağırsın.
- Vercel Preview ortamından gizli anahtarları (AUTH_SECRET, ADMIN_PASSWORD, CRON_SECRET, KARAOKE_SYNC_SECRET,
  PARASUT_*, RESEND_API_KEY, ANTHROPIC_API_KEY, BLOB) kaldırın (`docs/DEPLOY.md` §4); önizlemeye giriş yapılamaz olur.
- Giderler'de her sabit giderin "Faturadaki KDV"sini kontrol edin (varsayılanlar: kira, faturalar, genel %20; personel
  %0; stopajlı şahıs kirası %0 olmalı).
- `npm run db:reset` uzak veritabanında `-- --onay=<sunucu>` ister ve önce tam yedek alır.
- Site tarafı (laffogato oturumu): çift sayımı önleyen `counter`, seçenek sayıları, sipariş notları, menü listesinde
  `now`'ın okumadan önce alınması, karaoke oda saatleri ve PANEL-KARAOKE belgesi; panel hepsini isteğe bağlı okur.

**Sahibe notlar (dalga 8):**
- Komisyon: uyarıların hukuki dayanağını (Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik m.12/A,
  Ticaret Bakanlığı Genelgesi 2026/1) mevzuat.gov.tr'deki metinle bir kez karşılaştırın; metinler basın ve oda
  özetlerinden yazıldı. Kanallar'da her platformun ödeme süresini girin (varsayılan 30 gün). "Kanalı bulunamayan
  komisyon faturaları"nda görünen adı Tedarikçiler'de "Diğer adlar"a ekleyin. Ekim 2026 yarım ay (kasa raporları ay
  ortasında başladı); Z'den satış ilk tam ay Kasım'da.
- Mal siparişi: başlarken Kalemler › "Hepsini ekle"; "Tedarikçisi seçilmemiş" grubundaki kalemlere tedarikçi seçin.
  WhatsApp'ta doğrudan sohbet için tedarikçi kartında cep telefonu gerekir. Teslim kontrolü Paraşüt'teki ürün ↔
  hammadde bağlantılarına dayanır. Sayım günü varsayılan pazartesi (Kalemler › Ayarlar).

**Sahibe notlar (dalga 9):**
- Satış tahmini: kasa raporları biriktikçe kendi verinizle hesaplanır (her hafta günü için 3 rapor, yaklaşık 3 hafta);
  o zamana kadar aralık geniştir. Maç, AVM etkinliği, kampanya ya da kapalı gün olacaksa Satış tahmini › Özel günler'e
  ekleyin. Tatlı hazırlığı Tahmin ayarları'nda seçilen kategorilerden hesaplanır (varsayılan: Tatlılar). İsterseniz
  Vercel'de `WEATHER_CONTACT` (e-posta) tanımlayın: MET Norway'e giden hava durumu isteğinin kimliğine eklenir.
  2028 dini bayram tarihleri ikincil kaynaklardan; Diyanet takvimiyle bir kez karşılaştırın (`src/lib/forecast/calendar.ts`).
- Haftalık özet: pazartesi sabahı etkin yöneticilere gider (gönderilemezse salı, çarşamba yeniden denenir).
  Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet satırından kapatılır, önizlenir, örneği size
  gönderilir.

### Dalga 8'in inceleme düzeltmeleri (PR #24'ün bulguları)

- **Ay sonu sayımının anı:** geç girilen ya da sonradan düzeltilen ay sonu sayımı ayın son gününün sayımıdır
  (`monthEndCountAt`, en geç ertesi ayın 1'i 05:00); arada gelen mal siparişte kalır, girildiği gün Bugün'de "sayıldı"
  demez, "Gecikti" ve "Sayım eski" ayın son gününden sayılır.
- **Teslim süresi uzun sipariş:** 14 günden eski olsa da beklenen günün ertesine kadar "siparişte" kalır
  (`IN_TRANSIT_GRACE_DAYS`, zilin "gelmedi mi" sorusuyla aynı gün); kalem yeniden önerilmez, Bugün "Sipariş hazır"
  demez. Sonraya: fatura eşleşmesi (gönderimden 10 gün) ve kendiliğinden kapanış (45 gün) hâlâ gönderim gününden
  sayılır; teslim süresi 10 günden uzun siparişin faturası elle bağlanır (Faturayı değiştir, 30 güne kadar), 45 günden
  uzun sipariş gelmeden "45 günde fatura gelmedi" diye kapanır.
- **Erken gelen mal:** Hızlı sayım'ın "Gelen mal var mı?" kartı beklenen günü henüz gelmemiş açık siparişleri de
  gösterir ("27.10.2026 bekleniyor"); erken gelen mal geldiği gün işaretlenir, sayımda ikinci kez sayılmaz.
- **Açık sipariş kapanana kadar görünür:** farkı çözülmemiş ya da yeniden açılan sipariş kendiliğinden kapanmaz; 60.
  günde zilden ve Bugün'den, 90. günde Gönderilenler'den (Kapat'ın tek yeri) düşüyordu. Artık yaşı ne olursa olsun
  okunur (`loadOrders`). Eşleşme ise hâlâ son 60 günün açık siparişlerine bakar; daha eskisi Faturayı değiştir ya da
  Yeniden aç ile yeniden karşılaştırılır.
- **Bugün metinleri:** gecikmiş sayım satırı "Son sayım 30 Eylül Çarşamba (9 gün önce)" der (son sayım ay sonu sayımı
  da olabilir); Hakedişler satırı ayın satış ayı olduğunu söyler ("Pluxee hakedişi (Eylül satışları): son gün 20 Ekim.
  … Geldiyse işaretleyin."), bu yıldan değilse yılıyla. Sonraya: zil ve e-posta başlığında ("Hakediş gecikti: Pluxee
  (Ekim)") yıl yok; 12 aydan uzun geciken hakediş bu ayla aynı adı taşıyınca karışır (Ekim 2027'den önce olamaz).
- **Geciken hakediş işaretlenene kadar uyarır:** zil, Bugün ve sabah e-postası ekranla aynı 13 ayı okur
  (`reportWindow`); 4 aylık pencere satış ayı pencereden çıkınca uyarıyı düşürüyordu, 90 günlük platformda çoğu ay hiç
  göstermiyordu. Haftalık özetin komisyon maddesi de aynı pencereyi okur. Sonraya: (1) 13 aydan eski satış ayı ekranda
  da yok; takip 24–25 Ekim 2026'da başladığı için bu en erken **Ekim 2027**'de olur (o zamana kadar işaretlenmemiş eski
  ayları `komisyon.since`'e kadar okuyan ikinci bir sorgu ya da sınırsız pencere); (2) zil en çok 5 uyarı gösterir ve
  en yeniyi önce alır: geciken hakedişler birikirse en eskisi zilden düşer (Bugün sayısını ve en eskisini yine
  gösterir); gecikenler en eski son gün önce sıralanmalı (teslim farklarının zildeki sırasını da değiştirir).
- **Mal siparişi telefonda:** tedarikçi kartının iki düğmesi alt alta ve tam genişlikte, WhatsApp ile gönder üstte;
  320–414 px'te ikon kayboluyor, 375 px'in altında yazı taşıyordu (tarayıcıda 320, 360, 375, 390, 414 ve 1440 px).

### Bekleyen dış girdi
- **ModPOS günlük ürün satış dökümü:** ModPOS hazırlıyor. Örnek dosya gelince içe aktarma yazılacak. tahmin, siparis
  ve doluluk planlarında bunun için bir giriş noktası (seam) var; o zamana kadar aylık veriyle çalışırlar.

## 3. Kurallar (kısaca; tamamı CRITIQUE.md §1)

- **main'e doğrudan push yok.** Her dalga bir PR olur. Sahip 23 Ekim'de birleştirmeyi oturuma bıraktı: PR squash ile
  birleşir, ardından canlı derleme günlüğündeki migration sayısı ve çalışma zamanı hataları kontrol edilir.
- **R2 migration protokolü:** her grup kendi dalında migration üretir ama birleştirmede yeniden üretilir (journal'ı
  tabandan geri al, dalın SQL/snapshot'ını sil, `npm run db:generate -- --name <ad>`); bir seferde bir migration
  birleşir; journal `when` değerleri artan sırada olmalı. Canlı derleme eksik migration'da durur.
- **R3:** her çalışma kopyasının kendi yerel veritabanı (`laffogato_<grup>`).
- **R4/R5:** ortak sözleşmeler ve bildirim yüzeylerinde yalnız eklemeli değişiklik (CRITIQUE.md'deki adlar).
- Türkçe arayüz, `attempt()`/`UserError`, `requireAdmin`/`requireUser`, zod, `refresh()`, `logActivity`, saf mantık +
  `tests/*.test.ts`; depo prettier ile biçimlenmez, var olan dosyalarda prettier çalıştırmayın.
- Her birleştirmeden önce: `npx next typegen && npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'`,
  `npm test`, boş veritabanında `npm run db:migrate && npm run db:seed`, dokunulan ekranlarda tarayıcıda 1440 ve 390 px.
- Birleştirmeden sonra Vercel canlı derleme günlüğünde `✓ Veritabanı şeması güncel (N migration)` ve çalışma
  zamanı hatalarını kontrol edin.

## 4. Altyapı

- `ANTHROPIC_API_KEY`: Vercel'de yalnız Production, sensitive olarak var. Yerelde deneme için anahtarı sahibinden
  isteyin; **asla commit etmeyin, yazdırmayın.** fotograf `claude-opus-5-5`'i efor `low` ile kullanır
  (`docs/FOTOGRAF.md`). Anthropic Console'da aylık harcama sınırı koyun (~20 $; beklenen ayda ~4–5 $). Yerelde
  anahtarsız denemek için `AI_REPLAY=1 npx next dev` (kayıtlı yanıtlar); canlı değerlendirme betiği
  `scripts/foto-eval` (lansmandan önce bir kez, ≈ 0,30 $).
- **Vercel Blob:** fotoğraflar `laffogato-foto-panel` (private, fra1) deposunda; projeye **yalnız Production** için
  bağlı (`BLOB_READ_WRITE_TOKEN`, §1). Eski boş `laffogato-foto` kullanılmıyor: projeye **bağlamayın** (Production'ın
  `BLOB_READ_WRITE_TOKEN`'ı onunkiyle değişirse kayıtlı fotoğraflar okunamaz); silinebilir. Anahtar yoksa fotoğraf
  düğmeleri görünmez, personel tutarları elle yazar. Hobby kotasını Vercel › Usage'da kontrol edin.
- mcp: `MCP_DISABLED=1` acil kapatma; önizlemelerde kapalı. Canlıda `APP_URL` = `https://ladmin.laffogato.net` olmalı
  (issuer ve kaynak adresi ondan gelir); Vercel Firewall Anthropic'in çıkış aralığını (`160.79.104.0/21`) engellememeli.
  Bağlanma adımları `docs/CLAUDE-BAGLANTISI.md`'de.

## 5. Sahibe açık sorular (cevap yoksa varsayılan uygulanır)

1. Kafe konumu: **Tuzla, Opera AVM** (hava durumu ve AVM saatleri buna göre).
2. Açılış/kapanış listelerinin saatleri: **açılış 08:00–11:00, kapanış 22:00–02:00**.
3. Karaoke: **tek oda, her gün 12:00–24:00** (laffogato.net'teki karaoke saatleri; 23 Ekim denetiminden önce AVM'nin
   10:00–22:00'si varsayılmıştı). Sahip Doluluk › Oda saatleri'nden değiştirir.
4. KDV: panel devreden KDV'yi açılış alımlarından kendisi hesaplar (≈ 98.100 ₺; bu durumda Ekim–Kasım'da ödeme
   çıkmaz); muhasebeciden gelen tutar girilirse o esas alınır.
5. Sahibin verdiği cevaplar: kurye yok; Paraşüt'te banka hesapları bağlı değil (hakediş/ödeme elle işaretlenir);
   ModPOS günlük döküm yolda.
6. CRITIQUE.md §6'daki sorular (varsayılanlar uygulanır).
7. Mal siparişi: Paraşüt faturası siparişle eşleşince Geldi'nin anı **faturanın günü 12:00** yazılır
   (`docs/MAL-SIPARISI.md` §2, §7). Fatura sevkte kesildiyse sipariş erken gelmiş sayılır (fazla öneri), sayımdan
   sonraki bir güne tarihliyse geç (eksik öneri); saklanan hiçbir değer ikisini birden düzeltmiyor. Kalıcı çözüm
   (faturası bağlanan siparişte de Geldi'yi açık tutmak ya da sevki ayrıca kaydetmek) eylemi, Hızlı sayım listesini ve
   sipariş kartını değiştirir. Varsayılan: kural olduğu gibi kalır.

## 6. Bu oturumda kullanılan çalışma düzeni (öneri)

- Her grup ayrı git worktree'de, kendi veritabanı ve dev sunucusu portuyla uygulanır → bağımsız inceleme (salt okunur)
  → bulguların düzeltilmesi → entegrasyon dalına birleştirme (R2) → doğrulama → PR.
- `ekler/implement-wave.workflow.js`: bu düzeni çalıştıran workflow betiği (yolları kendi ortamınıza göre değiştirin).
- Taze worktree'de `tsc` öncesi `npx next typegen` gerekir (PageProps tipleri).
- `ekler/fotograf-eval/`: fotoğraf okuma denemelerinin sentetik görselleri, istemleri ve kaydedilmiş yanıtları
  (birim test girdisi olarak kullanılabilir). `ekler/kdv/`: KDV hesabını doğrulayan prototip betikler (`.ts.txt`: derlemeye girmesinler diye; çalıştırmak için uzantıyı `.ts` yapıp `src/` yollarını düzeltin).

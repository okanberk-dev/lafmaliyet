# Kalan işler (23 Ekim 2026, 08:00 UTC itibarıyla)

Bu klasör, panel için hazırlanan uygulama planlarını ve kalan işlerin durumunu tutar. Yeni bir oturum işe buradan
başlar. Planlar İngilizce yazıldı; arayüz metinleri Türkçedir ve planlarda birebir verilir.

## 1. Canlıda olanlar

- `main` @ 6ef84f2: dalga 1–4 birleşti (23 Ekim; sahip birleştirmeyi oturuma bıraktı, squash): #8 (ops-backup, vkn),
  #10 (ekle, pricing, pompa-mobil), #12 (insight + KDV, fotograf, menu), #13 (kasa, W2.0'ın kalanı, today, mcp).
  Canlı derleme günlüğü: `✓ Veritabanı şeması güncel (29 migration)` ve beklenen tek uyarı (21 Eki 22:27 UTC'de bir
  önizlemenin uyguladığı eski menü migration kaydı; zararsız). **#13'ten geriye Instant Rollback yok**
  (`docs/DEPLOY.md` §7).
- Fotoğraftan okuma canlıda açık: özel Vercel Blob deposu `laffogato-foto-panel` (fra1); `BLOB_READ_WRITE_TOKEN` ve
  `ANTHROPIC_API_KEY` yalnız Production'da. Eski boş `laffogato-foto` deposu kullanılmıyor.
- Daha önce: PR #7 (yönetici işlemlerinde parolayla onay, günlük işlerin takibi, canlı derlemede migration
  doğrulaması `scripts/migration-check.ts`), önizlemeler migration çalıştırmaz (`scripts/predeploy-guard.ts`, PR #6),
  tedarikçiler, giriş güvenliği, site menüsü eşitlemesi, bar ekranında siparişler; PR #9 (diğer oturum): bar
  ekranından tek dokunuşla sipariş aşaması, Ayarlar'da "Bağlantıları sına".
- **Paralel çalışan bir oturum daha var** (site ↔ panel işleri): sahiplik, sözleşmeler ve çakışma noktaları
  `DIGER-OTURUM.md`'de. İşe başlamadan okuyun.
- **Açık PR:** #11 taslak (PR incelemesi için Claude iş akışı; depoya `ANTHROPIC_API_KEY` ya da
  `CLAUDE_CODE_OAUTH_TOKEN` sırrı eklenince açılır). Dalga 5–8'in her biri main'e ayrı bir PR'dır.

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
| komisyon | `komisyon.md` | Yemek kartı ve platform komisyon/hakediş kontrolü (%6 sınırı, 30 gün; hakediş elle işaretlenir) |
| fotograf | `fotograf.md` | Z raporu, POS gün sonu ve market fişini fotoğraftan Claude ile okuma; ortak foto deposu ve Claude istemcisi bu grubun. **Bitti:** dalga 3 PR'ı (`0025_fotograf_okuma`, `docs/FOTOGRAF.md`; sahibin 22 Ekim isteğiyle öne alındı; W2.0'ın 1, 2, 3 ve 7. maddeleri de bunda) |
| siparis | `siparis.md` | Sipariş önerisi, hızlı sayım, tedarikçiye WhatsApp siparişi, teslim kontrolü |
| mcp | `mcp.md` | Claude uygulamasından panele soru sorma (salt okunur, yalnız yönetici, OAuth). **Bitti:** dalga 4 PR'ı (`0028_claude_baglantisi`, `docs/CLAUDE-BAGLANTISI.md`) |
| tahmin | `tahmin.md` | 7 günlük satış tahmini, personel ve tatlı önerisi, isabet ölçümü |
| doluluk | `doluluk.md` | Karaoke doluluk haritası ve göstergeler. **Bitti:** dalga 5 PR'ı #14 (`0030_karaoke_doluluk`, `docs/KARAOKE.md` › Doluluk; KVKK: 3 × 366 günden eski karaoke adları sabah işinde silinir) |
| haftalik | `haftalik.md` | Haftalık yönetici özeti (pazartesi e-postası, ₺ etkisine göre en çok 5 madde); diğer planların hepsini tüketir; en son |

**İkinci paketin çapraz eleştirisi `CRITIQUE2.md`'de** (R8–R19 ortak sözleşmeler, zaman bütçesi, güvenlik, kesintiler,
sıra, sahibe sorular). Önce ortak altyapı PR'ı (W2.0), sonra fotograf ∥ mcp, kontrol ∥ doluluk, siparis ∥ komisyon,
tahmin ∥ haftalik. Kafe **İstanbul Tuzla, Opera AVM**'dedir; `tahmin.md`'nin hava durumu noktası Tuzla'ya alındı (R19).
Site deposu 22 Ekim'de incelendi (`DIGER-OTURUM.md` sonu): karaoke ucu geçmiş tarihleri zaten veriyor; doluluk site
değişikliği beklemez. W2.0'ın kalanı (sendEmail seçenekleri, sabah e-postası kutuları ve `DIGEST_EXTRA_SOURCES`,
ModPOS günlük satış ağzı `loadDailyProductSales`, adım etiketleri) dalga 4'te. Kalan dalgalar: 5 kontrol ∥ doluluk,
6 fatura ∥ oneri-fiyat (sahibin 23 Ekim istekleri, aşağıda), 7 siparis ∥ komisyon, 8 tahmin ∥ haftalik; her biri ayrı PR.

### Sahibin 23 Ekim istekleri (dalga 6, ikinci paketten önce)

| Grup | Plan | Ne |
|---|---|---|
| fatura | `fatura-okuma.md` | Faturadaki paket boyu addan ("150 AD.") ve PDF'ten (Claude Haiku 5.5) okunur; fiyat onayında kanıtsız "Çarpanı X yap" önerisi kalkar, tahmini fiyat açıkça söylenir. Canlıdaki iki örnek: Yenilebilir bardak (1 Adet = 150 adet, adet başı 20 ₺, %52 ucuz) ve Klips kapak (1,165 ₺ 0023'ün varsayımıydı; Serendi'nin 24.07 faturası 12,02 ₺). **Uygulanıyor** |
| oneri-fiyat | `oneri-fiyat.md` | Personel yeni ürün önerirken boy başına satış fiyatı yazabilir (yönetici onayda görür, değiştirebilir); reçetede listede olmayan malzemeyi formdan çıkmadan ekler (Listeye ekle kurallarıyla, isteğe bağlı paket fiyatı); Listeye ekle'ye de paket fiyatı |

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
- **Vercel Blob:** `laffogato-foto` (private, fra1) oluşturuldu; projeye **yalnız Production** için bağlanması
  bekleniyor (Vercel › Storage › laffogato-foto › Connect Project; `BLOB_READ_WRITE_TOKEN`). Bağlanmadan fotoğraf
  düğmeleri görünmez, personel tutarları bugünkü gibi elle yazar. Hobby kotasını Vercel › Usage'da kontrol edin.
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

## 6. Bu oturumda kullanılan çalışma düzeni (öneri)

- Her grup ayrı git worktree'de, kendi veritabanı ve dev sunucusu portuyla uygulanır → bağımsız inceleme (salt okunur)
  → bulguların düzeltilmesi → entegrasyon dalına birleştirme (R2) → doğrulama → PR.
- `ekler/implement-wave.workflow.js`: bu düzeni çalıştıran workflow betiği (yolları kendi ortamınıza göre değiştirin).
- Taze worktree'de `tsc` öncesi `npx next typegen` gerekir (PageProps tipleri).
- `ekler/fotograf-eval/`: fotoğraf okuma denemelerinin sentetik görselleri, istemleri ve kaydedilmiş yanıtları
  (birim test girdisi olarak kullanılabilir). `ekler/kdv/`: KDV hesabını doğrulayan prototip betikler (`.ts.txt`: derlemeye girmesinler diye; çalıştırmak için uzantıyı `.ts` yapıp `src/` yollarını düzeltin).

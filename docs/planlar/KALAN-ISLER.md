# Kalan işler (22 Ekim 2026, 11:00 UTC itibarıyla)

Bu klasör, panel için hazırlanan uygulama planlarını ve kalan işlerin durumunu tutar. Yeni bir oturum işe buradan
başlar. Planlar İngilizce yazıldı; arayüz metinleri Türkçedir ve planlarda birebir verilir.

## 1. Canlıda olanlar

- `main` @ 099dc8a. PR #7 (e10fbb0): **yönetici işlemlerinde parolayla onay** (`adminstepup.md`) ve **günlük işlerin takibi**
  (`ops.md` §3: `job_runs`, sistem uyarıları, bekçi e-postası, `/api/health?isler=1`, migration `0020_gunluk_isler`)
  ile **canlı derlemede migration doğrulaması** (`scripts/migration-check.ts`).
- Daha önce: önizlemeler migration çalıştırmaz (`scripts/predeploy-guard.ts`, PR #6), tedarikçiler, giriş güvenliği,
  site menüsü eşitlemesi, bar ekranında siparişler; PR #9 (diğer oturum): bar ekranından tek dokunuşla sipariş
  aşaması, Ayarlar'da "Bağlantıları sına".
- **Paralel çalışan bir oturum daha var** (site ↔ panel işleri): sahiplik, sözleşmeler ve çakışma noktaları
  `DIGER-OTURUM.md`'de. İşe başlamadan okuyun.
- Canlı derleme günlüğü: `✓ Veritabanı şeması güncel (21 migration)` ve beklenen tek uyarı (21 Eki 22:27 UTC'de bir
  önizlemenin uyguladığı eski menü migration kaydı; zararsız).

## 2. Kalan işler (sırayla)

### Birinci paket (planlar hazır; kurallar ve birleştirme sırası `CRITIQUE.md`)

| # | Grup | Plan | Migration (birleştirmede üretilir) | Durum |
|---|---|---|---|---|
| 3 | ops-backup: tam yedek ve denenmiş geri yükleme | `ops.md` §2 + CRITIQUE "ops" düzeltmeleri | yok | **Bitti, birleştirme bekliyor:** dal `impl/ops-backup` (`docs/YEDEK.md`) |
| 4 | vkn: tedarikçiyi vergi numarasıyla eşleştirme (çekirdek; "Birleştir" ertelendi) | `vkn.md` + CRITIQUE §3/§4 | `fatura_vergi_no` | **Yarım:** `wip/vkn/*.patch` |
| 5 | pricing: büyük Paraşüt fiyat sıçramasına onay, tedarikçiye göre fiyat | `pricing.md` | `fiyat_onayi` | başlanmadı |
| 6 | kasa: ay bilgisi kasa raporlarından, kasa bütünlüğü | `kasa.md` | `kasa_ay_bilgisi_butunluk` | başlanmadı |
| 7 | insight: zam etkisi (₺/ay), 6 haftalık nakit planı **+ `kdv.md` eki** (aynı dalda) | `insight.md`, `kdv.md` | yok | başlanmadı |
| 8 | menu: toplu fiyat değişikliği, ModPOS listesi, fiyat geçmişi | `menu.md` | `fiyat_gecmisi` | başlanmadı |
| 9 | today: "Bugün" ekranı, telefonda yeni alt menü | `today.md` | yok | başlanmadı |

WIP yamaları `fa989a3` üzerine yazıldı; güncel main (099dc8a) üzerinde de `git apply --check` temiz geçiyor; `git am` ile uygulanır. Yamalar
yarımdır: önce gözden geçirin, sonra tamamlayın. vkn yamasındaki `0021` migration'ı birleştirmede yeniden üretilir.

### İkinci paket (planlar hazır; ortak bilgi `BRIEF2.md`)

| Grup | Plan | Ne |
|---|---|---|
| kontrol | `kontrol.md` | Fotoğraflı açılış/kapanış kontrol listeleri, Bugün ekranında |
| komisyon | `komisyon.md` | Yemek kartı ve platform komisyon/hakediş kontrolü (%6 sınırı, 30 gün; hakediş elle işaretlenir) |
| fotograf | `fotograf.md` | Z raporu, POS gün sonu ve market fişini fotoğraftan Claude ile okuma; ortak foto deposu ve Claude istemcisi bu grubun |
| siparis | `siparis.md` | Sipariş önerisi, hızlı sayım, tedarikçiye WhatsApp siparişi, teslim kontrolü |
| mcp | `mcp.md` | Claude uygulamasından panele soru sorma (salt okunur, yalnız yönetici, OAuth) |
| tahmin | `tahmin.md` | 7 günlük satış tahmini, personel ve tatlı önerisi, isabet ölçümü |
| doluluk | `doluluk.md` | Karaoke doluluk haritası ve göstergeler |
| haftalik | **plan yazılmadı** | Haftalık yönetici özeti (pazartesi e-postası, ₺ etkisine göre 3–5 madde); diğer planların hepsini tüketir |

**İkinci paket uygulanmadan önce yapılacaklar:**
1. `haftalik.md` planını yazın (istek: her pazartesi kısa e-posta; lira etkisine göre sıralı 3–5 madde; her biri
   tek dokunuşla ilgili ekrana; ör. "Süt zammı Latte'de ayda 4.800 ₺ kâr kaybı", "Salı 15–18 karaoke %12 dolu";
   Vercel Hobby'de cron günlüktür, haftalık iş günlük işin içinde pazartesi çalışır; her kaynak isteğe bağlı).
2. `CRITIQUE2.md` çapraz eleştirisini yazın (CRITIQUE.md tarzında): plan başına karar ve kesilecekler; ortak
   sözleşmeler R8+ (foto modülü ve `/api/foto/[id]` erişim denetimi — sahibi fotograf; Claude istemcisi
   `src/server/ai/claude.ts` — sahibi fotograf; `renderDigest` uzantıları: kontrol ve tahmin ayrı konumsal argüman
   istiyor → tek bir `extras` nesnesine birleştirin; zil grupları; nav/roller/⌘K/Yardım/README eklemeleri; Bugün
   satır kaynakları; günlük iş adımları; yedek `TABLE_RULES`; `db:reset`); bağımlılık sürümleri
   (`@anthropic-ai/sdk`, `@vercel/blob`, `@modelcontextprotocol/server`); güvenlik incelemesi (mcp, fotograf);
   dalga ve birleştirme sırası; sahibe sorular.
3. **Bilinen düzeltme:** kafe **İstanbul Tuzla, Opera AVM**'dedir (`docs/PROMPT-VE-PLAN.md`). MaviBahçe/İzmir ayrı
   karaoke box işidir. `tahmin.md` hava durumu için MaviBahçe koordinatı kullanıyor → Opera AVM Tuzla koordinatıyla
   değiştirin. `doluluk.md` ve `kontrol.md`'deki saat varsayımlarını da buna göre gözden geçirin.

### Bekleyen dış girdi
- **ModPOS günlük ürün satış dökümü:** ModPOS hazırlıyor. Örnek dosya gelince içe aktarma yazılacak. tahmin, siparis
  ve doluluk planlarında bunun için bir giriş noktası (seam) var; o zamana kadar aylık veriyle çalışırlar.

## 3. Kurallar (kısaca; tamamı CRITIQUE.md §1)

- **main'e doğrudan push yok.** Her dalga bir PR olur; sahibi inceleyip birleştirir.
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
  isteyin; **asla commit etmeyin, yazdırmayın.** Önerilen model `claude-opus-5-5`, efor `low`
  (bkz. `fotograf.md`).
- **Vercel Blob:** fotograf ve kontrol yayına girmeden önce private bir Blob store oluşturup projeye bağlayın
  (`BLOB_READ_WRITE_TOKEN`). Hobby kotasını Vercel › Usage'da kontrol edin.
- mcp: `MCP_DISABLED=1` acil kapatma; önizlemelerde kapalı (plana bakın).

## 5. Sahibe açık sorular (cevap yoksa varsayılan uygulanır)

1. Kafe konumu: **Tuzla, Opera AVM** (hava durumu ve AVM saatleri buna göre).
2. Açılış/kapanış listelerinin saatleri: **açılış 08:00–11:00, kapanış 22:00–02:00**.
3. Karaoke: **tek oda, her gün 10:00–22:00**.
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

# Kalan işler (26 Ekim 2026, `main` @ `ea0df09` itibarıyla)

Bu klasör, panel için hazırlanan uygulama planlarını ve kalan işlerin durumunu tutar. Yeni bir oturum işe buradan
başlar. Planlar İngilizce yazıldı; arayüz metinleri Türkçedir ve planlarda birebir verilir.

**Son denetim (26 Ekim):** [denetim-2026-10-26.md](denetim-2026-10-26.md): 70 madde (E-01..E-70), düzeltme partileri
B01-B20 ve sahibe 11 soru. Partilerin durumu, sahibin yanıtları ve yanıt gelene kadar uygulanan varsayılanlar aşağıda,
"Denetim (26 Ekim): düzeltme partileri". Sıradaki iş oradan başlar (önce stok sayımı, sahibin isteği).

## 1. Canlıda olanlar

- **`main` @ `ea0df09`** (26 Ekim, Dalga 15, #39; 43 migration, sonuncusu `0042_okc_z`). Dalga 6'dan (663b166) sonra
  birleşenler: #16 (diğer oturum: KDV-2 hatırlatıcıları), #18 (Dalga 7, denetim düzeltmeleri), #19 (arayüz taraması),
  #20 (diğer oturum: sitenin 409 `single_size` yanıtı kopuk bağlantı olarak), #21 ve #26 (KDV düzeltmeleri), #22
  (sabit giderlerden ekle), #23 (belgeler), #24 (Dalga 8: mal siparişi, komisyon), #25 (Dalga 9: satış tahmini,
  haftalık özet), #27 (Dalga 7–8 düzeltmeleri), #28 (Dalga 11: cari), #29 (planlar: vergi, yazarkasa Z, senkron,
  denetim listesi), #30 (Dalga 10a), #31 (panel Google'da görünmez), #32 (Dalga 10b), #33 (Dalga 13 PR-a), #34 (LafPOS
  bağlantısı), #36 (LafPOS migration düzeltmesi; aynı iş için açılan #37 birleşmeden kapandı), #35 (Dalga 13 PR-b),
  #38 (Dalga 14: stok değerleme FIFO), #39 (Dalga 15: kenar çubuğu). Her birinin ayrıntısı §2'de kendi başlığında.
- **LafPOS (#34, #36) canlıda, bilerek kapalı:** kafede bugün ModPOS var (sahip, 26 Ekim); `LAFPOS_SYNC_SECRET`
  Vercel Production'da yok, iki uç 503 döner (denetim E-31: hata değil, "henüz kurulmadı"). Açma sırası
  `docs/LAFPOS.md` › "Açılış sırası" (anahtarlar → deneme gönderimi → geçiş günü); durum Ayarlar › LafPOS (kasa) (B07).
- **Stok değerleme Dalga 14'ten (#38) beri FIFO** (başlangıç ayından itibaren, varsayılan Ekim 2026;
  `docs/STOK-DEGERLEME.md`); reçete ve menü maliyeti son alış fiyatında kalır.
- Dalga 1–6 (23 Ekim; sahip birleştirmeyi oturuma bıraktı, squash): #8 (ops-backup, vkn),
  #10 (ekle, pricing, pompa-mobil), #12 (insight + KDV, fotograf, menu), #13 (kasa, W2.0'ın kalanı, today, mcp),
  #14 (kontrol, doluluk), #17 (fatura okuma, oneri-fiyat). Ayrıca #11 (PR incelemesi için Claude iş akışı) ve diğer
  oturumdan #15 (KDV-2: tevkifatlı faturanın KDV'si, nakit planında 25'inde ayrı ödeme). O günkü canlı derleme günlüğü:
  `✓ Veritabanı şeması güncel (32 migration)` ve beklenen tek uyarı (21 Eki 22:27 UTC'de bir önizlemenin uyguladığı
  eski menü migration kaydı; zararsız, dalga 7'den sonra `KNOWN_ORPHANS`'ta). **#13'ten geriye Instant Rollback yok**
  (`docs/DEPLOY.md` §7).
- **Dalga 7 (denetim düzeltmeleri, #18):** 23 Ekim denetiminin panel bulguları; migration'lar
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
- Güncel durum için `git log origin/main`.

## 2. Kalan işler (sırayla)

### Denetim (26 Ekim): düzeltme partileri

Sahibin 26 Ekim isteği: "Stok sayımını da düzgünleştir ve site genelinde genel audit yap; hatalar, bağlantısız olan
yerler, bağlanılması gereken yer var mı onlara da bak". Rapor [denetim-2026-10-26.md](denetim-2026-10-26.md)
(`ea0df09` anının kaydı; her maddenin kanıtı, senaryosu, önerilen düzeltmesi ve testi orada). Her parti `main`'e ayrı
bir PR'dır ve tek başına birleşebilir; önce stok sayımı. Aynı dosyaya dokunan partiler raporun "Çakışma" sütunundaki
sırayla açılır. Parti PR'ı açılınca dalını, birleşince PR numarasını aşağıdaki "Durum" sütununa yazar. Sahibin kararını
bekleyen parti beklemez: varsayılanı uygular ve soruyu PR gövdesine açık soru olarak yazar.

| Parti | Ne | Maddeler | Migration | Sahibe soru | Durum |
|---|---|---|---|---|---|
| B01 | Stok sayımı 1: doğru ay, tek "tamam" kuralı, kayıt kaybı yok (+ NEW-01) | E-01, E-02, E-03, E-17, E-18, E-19, E-20, E-23, E-24, E-25, E-26 | yok | 3 | bekliyor |
| B02 | Stok sayımı 2: değerleme, sayım listesi ve sayım uyarıları (+ NEW-02) | E-04, E-05, E-16, E-22, E-28, E-29, E-58 | yok | 4 | bekliyor |
| B03 | Stok sayımı 3: faturadan stoğa doğru miktar ve fiyat | E-06, E-07, E-14, E-27 | yok |  | PR (dal `claude/denetim-b03-fatura-stok`) |
| B04 | Stok sayımı 4: yazım hızı ve Stok sekmeleri | E-21, E-56 | yok |  | PR (dal `claude/denetim-b04-sayim-hiz`) |
| B05 | Canlı güvence: dal derlemesi, Neon yeniden deneme, plan notu | E-10, E-50, E-67 | yok | 10 | PR (dal `claude/denetim-b05-canli-guvence`) |
| B06 | Belgeler: KALAN-ISLER ve bu denetimin planı | E-54 | yok |  | PR (dal `claude/denetim-b06-belgeler`) |
| B07 | LafPOS 1: bağlantı görünür ve onarılabilir; geçiş günü ayarı | E-31, E-32 | yok | 1 (yanıtlandı) | PR (dal `claude/denetim-b07-lafpos-durum`) |
| B08 | LafPOS 2: günlük satış aylık modele; eşleşmeyenler; silme engeli | E-08, E-33, E-34, E-66 | **evet** (`0044_lafpos_satir_site_kalemi`) | 2 | PR (dal `claude/denetim-b08-lafpos-satis`) |
| B09 | LafPOS 3: kasa raporu ve gün kayıtları LafPOS'la uzlaşsın | E-09, E-35, E-36, E-40 | yok | 5 | PR (dal `claude/denetim-b09-lafpos-kasa`) |
| B10 | LafPOS 4: ödeme kanalları komisyona, ikram tüketime | E-37, E-38, E-68 | yok | 6 (yanıtlandı) | PR (dal `claude/denetim-b10-lafpos-odeme-ikram`) |
| B11 | LafPOS 5: kasa kipi ve ModPOS metinleri | E-39 | yok | 2 (yanıtlandı) | PR (dal `claude/denetim-b11-lafpos-metin`) |
| B12 | Senkron P1: panel fiyatı başkasının değişikliğini ezmesin | E-11 | yok |  | PR (dal `claude/denetim-b12-senkron-fiyat`) |
| B13 | Menü maliyeti: reçetesiz ürün ve su | E-47, E-57 | yok |  | PR (dal `claude/denetim-b13-menu-maliyet`) |
| B14 | Ürün açma ve öneri onayı | E-48, E-55 | yok |  | PR (dal `claude/denetim-b14-urun-onay`) |
| B15 | Aynı rakam her yerde: senaryo, başabaş, ay sonu öngörüsü, nakit planı | E-12, E-13, E-41, E-46, E-59, E-60, E-62 | yok | 7, 8 (varsayılanla) | PR (dal `claude/denetim-b15-ayni-rakam`) |
| B16 | Gelir-gider: komisyon, SGK satırı, kaynak bağlantıları, notlar | E-30, E-43, E-44, E-61, E-63 | yok | 9 | bekliyor |
| B17 | Alış: kasadan e-Arşiv alımları ve fatura kategori koruması | E-42, E-45 | yok |  | bekliyor |
| B18 | Karaoke: silme isteği ve bitirme izi | E-15, E-65 | **evet** |  | bekliyor |
| B19 | Bildirim alıcıları ve personele sabit hata metni | E-52, E-53, E-64 | yok |  | PR (dal `claude/denetim-b19-bildirim`) |
| B20 | Sağlamlık süpürmesi: eylem hataları, zil, gün kesimi, ÖKC uyarısı | E-49, E-51, E-69, E-70 | yok |  | bekliyor |

**B21 (sahibin isteği, 26 Ekim 19:30; raporda yok): Hızlı sayım ve mal siparişi kaldırıldı.** Sahip: "Hızlı sayım
ile mal siparişi kısmını kaldır, gereksiz çünkü normal sayım olsun". Dal `claude/denetim-b21-hizli-siparis-kaldir`.
Ekranlar (`/panel/hizli-sayim`, `/panel/mal-siparisi` ve alt sayfaları), eylemler, Paraşüt eşitlemesindeki teslim
kontrolü, Bugün satırları, zil ve push satırları, Onaylar'daki taslak kartları, menü öğeleri ve iki rolün Yardım'ı
kalktı; eski adresler Stok sayımı'na yönlenir. Veritabanı tabloları silinmedi (migration yok), eski `mal-taslak`
istekleri kuyruklara girmez ve sabah işi canlı kalanlarını kapatır. Aylık Stok sayımı ve ay sonu sayım bildirimi
(`src/server/notify/count-push.ts`) aynen. Ayrıntı `docs/MAL-SIPARISI.md`. Başka hiçbir parti bu iki özelliği
genişletmez ya da onlara bağlanmaz: E-20 ve E-56'nın Hızlı sayım parçaları, E-28'in hızlı sayım sayısı, E-41'in mal
siparişi parçası ve aşağıdaki NEW-03 düştü.

**Raporun ardından eklenen üç bulgu (eleştirmen; raporda yok):**
- **NEW-01** (küçük, B01): ay sonu stok sayımı için hiçbir bildirim yok; ayın son günü hızlı sayım bildirimi de bilerek
  susuyordu (B21'den beri ay sonu bildirimi `src/server/notify/count-push.ts`'te, hızlı sayım bildirimi yok). Ayın son iş gününde sayım bildirimi;
  ayın 1-10'unda geçen ayın sayımı yoksa ya da yarımsa yöneticinin zilinde ve sabah e-postasında satır. Tamamlanma
  kuralı E-01 / E-17'nin ortak yardımcısından.
- **NEW-02** (küçük, B02): yılın kâr/zararı iki kuralla: Gelir-gider'in yıl kartı cirosu girilmemiş ayların giderini
  sayar, Genel bakış'ın yıl grafiği ve Claude'un `ay_ozeti`'si (`yearTrend`) saymaz. Tek saf yıl toplamı yardımcısı;
  cirosuz ayın gideri kartta not satırı.
- **NEW-03** (düştü: mal siparişi B21'de kaldırıldı): "Geldi" denmiş, faturası gelmeyen
  mal siparişi 45 gün sonra sessizce kapanıyordu (eski eşleştirici, B21'de silindi): zil, işlem geçmişi, borç ve gider yok.
  Eşleşme penceresi bitince yöneticiye "Geldi, faturası yok" satırı; kendiliğinden kapanış işlem geçmişine ve eşitleme
  özetine yazılır.

Denetimin hiç okumadığı yerler (eleştirmen): Özel günler, karaoke doluluk mantığı, Hatırlatıcılarım, Nakit planı
sayfasının kendisi (yalnız rakamları, E-13 / E-46) ve site ping alıcıları (`/api/menu/ping`, `/api/orders/ping`,
`/api/karaoke/ping`).

**Sahibe sorular (26 Ekim; 1, 2 ve 6 yanıtlandı, gerisi yanıt yok).** Yanıt gelene kadar partisi aşağıdaki varsayılanı uygular; varsayılanı
yazılmamış soruda parti en dar, geri alınabilir yolu seçer ve PR gövdesine yazar.
1. **LafPOS anahtarı** (E-31, B07): kafede LafPOS kullanılıyor mu; `LAFPOS_SYNC_SECRET` Vercel'e eklenebilir mi?
   **Yanıt (26 Ekim):** henüz değil, kafede ModPOS var; LafPOS bütün sistemlerde açılınca kullanılacak, o güne kadar
   hiçbir şey değişmesin. B07 bunu "henüz kurulmadı" diye sakin gösterir; anahtar sahibin açılış sırasının ilk adımı.
2. **ModPOS'tan LafPOS'a geçiş günü** (E-08, E-39; B08, B11): hangi gün; ModPOS'un aylık ürün satış listesi gelmeye
   devam edecek mi; Ekim listesi hangi güne kadar? (Aynı gün iki kez sayılmasın; ModPOS metinleri ne zaman kalksın.)
   **Yanıt (26 Ekim):** belli değil; panelde bir ayar olsun. B07: Ayarlar › LafPOS (kasa) › "LafPOS'a geçiş günü",
   varsayılan boş (kasa ModPOS, LafPOS'un günleri hiçbir hesaba girmez); B08-B11 okuyucularını bu güne bağlar.
   **Yapıldı (B11):** E-39'un "kasa kipi" ayrı bir ayar değil, bu gündür (son günlerde LafPOS günü var mı sezgisi
   kullanılmadı: deneme günleri kipi değiştirmesin). Geçiş gününden itibaren "Kasadaki fiyatlar" yalnız siteye bağlı
   olmayan ürünler için çalışır ve ModPOS metinleri LafPOS der; boşken her şey bugünkü gibi.
   **Açık (B11 incelemesi):** (a) LafPOS gününde bağsız ürünün fiyat işi yalnız yöneticide (LafPOS'ta ürün fiyatını
   `menu.yonet` olmadan kasiyer değiştiremez); LafPOS'ta kasiyere fiyat yetkisi verilecekse personelin listesi geri
   açılabilir. (b) Geçiş gününden sonra siteye bağlı olmayan ürünler Kasaya işle'de kalsın mı, yoksa hepsi siteye
   bağlansın ve liste kapansın mı? **Varsayılan:** kalsın, metin bağlamayı ya da LafPOS'ta elle değiştirmeyi söyler.
3. **Geçen ayın sayımı ayın 10'undan sonra** (E-19, B01): personelin düzeltmesi reddedilsin mi, Onaylar'a "sayım
   düzeltme" isteği mi düşsün? **Varsayılan:** reddedilir, personel "Geçen ayın sayımı ayın 10'undan sonra yalnız
   yönetici tarafından düzeltilebilir; yöneticiye haber verin." görür; yönetici düzeltebilir.
4. **Yeni sayım kalemlerinin reçeteleri** (E-29, D-14; B02): Lemon Tea'de Lime şurubu yerine Lemon tea şurubu mu,
   Blueberry ürünlerinde Karışık berry püre yerine yaban mersini püre mi; çilek, cookie, hazelnut şurubu, vanilya sosu
   ve böğürtlen püreyi hangi ürünler kullanıyor? **Varsayılan:** sekiz kalem yalnız başlangıç verisine (seed) eklenir,
   hiçbir reçete değişmez.
5. **Kasadan çıkan para nereye girilecek** (E-35, B09): fişli harcamalar ve sahibe teslim edilen nakit panelin "Kasadan
   çıkanlar"ına mı, LafPOS'a mı, ikisine birden mi?
6. **LafPOS ikramları** (E-38, B10): Zayi & ikram'a yeniden girilmesin, LafPOS'tan mı alınsın?
   **Yanıt (26 Ekim):** evet, LafPOS'a geçilince ikram kendiliğinden LafPOS'tan gelir (B10). **Yapıldı (B10):** geçiş
   gününden itibaren ürün ikramı yalnız LafPOS'tan; panelde hammadde ikramı ve zayi kalır.
7. **Aylık girişe çevrilen giderler** (E-13, B15): reklam, influencer gibi değişen giderler başabaşta ve nakit planında
   geçen ayın gerçekleşeniyle mi, son 3 ayın ortalamasıyla mı sayılsın?
   **Varsayılan (B15):** geçen ayın gerçekleşeni: biten ayda o ay girilen; süren ve gelecek ayda o ay girilen, daha
   azsa geçen ayınki (`model.monthlyExpensePlan`). 3 ay ortalaması istenirse yalnız bu fonksiyon değişir.
8. **Fişlerin KDV'si** (E-60, B15): Aylık harcamalar'daki fişler gelir-giderde KDV dahil mi kalsın, KDV düşülüp mü
   sayılsın? (Muhasebeciyle.)
   **Varsayılan (B15):** KDV dahil kalır (bugünkü hesap); kartlar artık "ödenen tutar, KDV dahil" der. Sabit gideri
   aylık girişe çevirirken yazılan tahmini kayıt KDV hariç tutardır ve bunu söyler (nakit planı ödenen tutarı yayar).
9. **Banka POS komisyonu** (E-43, B16): ayrıca fatura ya da dekont olarak geliyor mu, Paraşüt'te Komisyon
   kategorisine mi düşüyor?
10. **Vercel planı** (E-67, B05): panel Hobby planında (ticari kullanım yok, günlükler bir saat); Pro'ya geçilsin mi?
    **Varsayılan:** plan Hobby kalır, risk ve sınırlar `docs/DEPLOY.md` § 8'de yazılı (öneri Pro); karar sahibin.
    **Ayrıca (E-10):** dal bekçisi yalnız onu içeren commit'lerde çalışır; bekçiden önce açılmış eski dalların
    dağıtımları için Vercel › Project Settings › Build Command'a tek satırlık bir dal denetimi yazılsın mı, eski
    `claude/*` dalları ve önizlemeleri silinsin mi? **Varsayılan:** ayar yok; eski dal dağıtımları yeniden derlenmez,
    eski bir dal önce main'le birleştirilir (`docs/DEPLOY.md` § 7).
11. **Önceki listeden açık kalanlar** (yeniden doğrulanmadı): D-05 Claude inceleme iş akışının ödemesi; D-06 sohbete
    yapıştırılan API anahtarının iptali; D-15 sos pompası da 10 ml mi; D-16 sitenin `PARASUT_USERNAME`'i panelinkinden
    farklı mı; D-18 zili kapalı cihaz bar ekranında sorsun mu; D-19 fişli harcamalar Aylık harcamalar'a onaysız mı
    yazılsın.

### Süren işler (26 Ekim 2026)

| İş | Plan | Durum |
|---|---|---|
| Dalga 10: personele açılan yetkiler (onaylı / onaysız), ortak onay kuyruğu | `personel-yetki.md` | **Bitti: 10a (#30) ve 10b (#32) main'de.** 10a (migration `0039_personel_yetki`): ortak onay kuyruğu ve Onaylar, 2.2 kasadaki fiyatlar, 2.3 / 2.6 geç rapor ve sonradan düzeltme, 2.5 kontrol geçmişi, 2.7 kasadan çıkan istekleri, 2.8 geç zayi ve silme isteği, 2.9 özel günler ve kafe kapalıydı. Tedarikçi ödemesine bağlı kasa satırına personel istek de açamaz. 10b (#32, migration yok): 2.1 Tükendi / Satışa aç, 2.4 mal siparişi taslağı, 2.10 personelin Yardım'ı (`/panel/yardim/personel`), sızıntı betiği `scripts/personel-sizinti.ts` (çalışan sunucuya karşı, CI'da koşmaz), 10a incelemesinden kilit sırası (karar çekirdekleri önce konuyu, sonra isteği kilitler; `docs/ONAYLAR.md` › Geliştirici notu), plan §6 doğrulaması. Sahibe notlar aşağıda, "Dalga 10". Canlıda personel hesabıyla `/panel/yardim/personel` bir kez açılıp bakılır (2.4 mal siparişi taslağı B21'de kaldırıldı). Kalan daraltma: karaoke sayacının silinmesi (denetim E-15, B18). |
| Dalga 13: Kasa raporunda yazarkasa-POS mali Z raporu (ModPOS Z'den ayrı) ve doğru okuma | `okc-z.md` | **PR-a (#33) ve PR-b (#35) main'de.** PR-a: yanlış bölüme çekilen yazarkasa Z'si alan doldurmaz, başlıklar. PR-b (migration `0042_okc_z`, `0041_kasaya_giren`'in ardına yeniden üretildi): b1 ve b3–b8 (saf çekirdek, Claude istemcisi, veri ve sunucu sütunları, ekran, e-posta / WhatsApp, belgeler ve Yardım, son doğrulama). **Açık:** yalnız b2 (canlı değerlendirme: gerçek fotoğraf ve `ANTHROPIC_API_KEY` bekliyor); bilinen nit, banka gün sonu fişinde iki tarih uyarısı, denetimde E-69 (B20). O zamana kadar `OKC_PREFILL_ENABLED = false` (`src/lib/okc-z.ts`): yazarkasa Z'sinin okuması yalnız öneri, hiçbir alanı doldurmaz. PR-c yalnız değerlendirme gerek gösterirse. Ayrıntı ve sahibe notlar aşağıda, "Dalga 13". |
| Dalga 12: Vergi bölümü (gelir-gider, kurumlar ve geçici vergi, KDV, muhtasar, damga, SGK; tahmini ve kaynaklı) | `vergi.md` | Plan hazır, başlamadı; muhasebeciye sorulacak 8 madde planın sonunda. Gelir dayanağı mali Z: Dalga 13 PR-b birleşti, doldurma kapısı b2'de. Kenar çubuğunda Finans başlığına girer (Dalga 15). |
| Senkron: panel ↔ laffogato.net ↔ uygulama | `senkron.md` | **Faz 1'in çoğu bitti (28 Ekim):** S1 (laffogato #269: menü `expect`, 409 `stale`, koşullu form, uygulama önbelleği 300 sn), S2 (laffogato #270: ödeme bekleyen sayısı, imza vektörleri), M1 (lafmobil #35: sözleşme kopyası), P1 (B12, #52 ve #53), P2 (lafmaliyet #60: bar ekranında ödeme takibi, sakin saatin kontrolü pingi saymaz, kaçan ping Ayarlar › laffogato.net'te; `docs/SITE-SIPARIS.md` › Ödeme takibi; açık: bildirimi açık, boş bar ekranını takip başlayınca uyandırmak, aşağıda "Senkron P2'nin açığı"), P0 (lafmaliyet, dal `claude/senkron-p0-push-ad`: karaoke Web Push'ta misafirin adı ve notu yok, ekrandaki zil satırında ve listede ad kalır; `docs/KARAOKE.md` › Güvenlik; birleşince canlıda bir rezervasyonla kilit ekranındaki bildirime bakılır). Kalan Faz 1 yalnız M2: uygulamanın menü ve mağaza tazeliği (lafmobil `claude/senkron-m2-tazelik`, staleTime ve satır reddinde geçersiz kılma); uygulamanın bir sonraki mağaza sürümüne biner, App Store gönderimini (1.1.0) yürüten oturumun işi. Sonra Faz 2 (ayar ucu, 304, ping sınaması, kapanışlar). Bütçe (§4.0): P2'den önce ve sonra 48'er saat iki projenin CU-saat/gün ölçümü sahipte. Sahibe soru A (sitenin Neon planı), 7, 10. |
| Genel denetim (25 Ekim): sahibin 22 Ekim'den beri istekleri ile yapılanlar | `denetim-listesi.md` | Yerine 26 Ekim denetimi geçti: D-01..D-19'un 26 Ekim durumu `denetim-2026-10-26.md` › "Önceki denetim"; açık kalanlar E-maddelerine ve partilere taşındı, doğrulanmayanlar sahibe sorulardır. |
| Denetim (26 Ekim): panel geneli ve stok sayımı | `denetim-2026-10-26.md` | 70 madde, 20 parti (B01-B20), sahibe 11 soru; aşağıda "Denetim (26 Ekim): düzeltme partileri". |

**Ayrı PR / sahibe soru (dalga 11 ve denetimden):**
- ~~K21: teslimde ödenen (peşin) takipli kartta "Geçmiş faturaları al" ile gelen takip öncesi faturaya hesaptaki para sayılıyor~~ **Düzeltildi (B03, E-14):** eşitleme takip öncesi faturayı `applyCreditOnArrival`'a göndermez, o da ikinci kapı olarak tarihe bakar (`takesCreditOnArrival`; `tests/parasut-esitleme-db.test.ts`, `tests/cari-db.test.ts`).
- K4 "2A": takip öncesi tarihli faturaya muhasebeci panel ödemesini Paraşüt'te de işlediyse ödeme iki kez sayılır (dar pencere; `docs/TEDARIKCILER.md` › Kalan borç).
- **Ayrı PR, dalga 10'dan sonra:** personel panelden açılan karaoke sayacını onaysız siliyor (gerçek açık; denetim D-03, `personel-yetki.md` §5.1 `karaoke-sayac-silme-daralt`). Önerilen sertleştirme: ilk 10 dakika serbest, sonrası silme isteği (`staff_requests`'e yeni tür: migration, Onaylar kartı, zil satırı, personel Yardım'ında satır; kilit sırası önce sayaç, sonra istek). Bu bir daraltmadır, dalga 10'un konusu değildi. 2.9'un kanıt denetimi silme kaydını İşlem geçmişinden zaten görür. 26 Ekim denetiminde E-15 (bitirme izi E-65), B18 (migration).
- **Site tarafı, ayrı laffogato PR'ı (ek alan):** `POST /api/panel/menu` yanıtına `changed: boolean` (`setMenuItemSaleFields` yazdıysa true, "değişmedi" yolunda false). Panel Tükendi kaydını şimdi istekten hemen önceki canlı listeye ve yanıtın damgasına bakarak yazıyor (10b incelemesi); sahip sitede ya da yönetici ürün kartından tam bu gidiş-dönüş içinde kapatırsa personelin kaydı yine yazılabilir. Alan gelince panel kaydı yalnız `changed === true`'da yazar (`docs/SITE-MENU.md` › Kayıt).
- Sohbete yapıştırılan hediye Anthropic anahtarı Console'da iptal edilip yenilenmeli (denetim D-06; 26 Ekim'de yeniden doğrulanmadı, sahibe soru 11).
- **Senkron P2'nin açığı (sahibe karar, ayrı PR):** bildirimi açık, ekranı boş bar tableti (Yardım'ın önerdiği kurulum)
  ödeme takibinin başladığını kabuğun 30 dakikalık kontrolünde öğrenir; ödeme pingi kaçarsa sipariş o cihazda bir
  saate kadar gecikebilir (bildirimi kapalı ya da açık siparişi olan ekranda ≤ 6 dk). Aday: takip başlayınca `orders`
  konusunda içeriksiz bir "yenile" bildirimi; service worker görünür panel sekmesi varsa yalnız canlı veriyi yeniletir.
  Görünür sekme yoksa tarayıcı bir bildirim göstermek zorunda (sessiz push yok): sahibin "ödeme bekleniyor" bildirimine
  razı olup olmadığı sorulur. Kısa aralıklı canlı sorgu panelin Neon bütçesini bozar, yapılmaz. Ayrıntı `senkron.md`
  › P2 › Durum 6, `docs/SITE-SIPARIS.md` › Ödeme takibi.
- Sahibe soru: personelin fişli harcaması bugün Aylık harcamalar'a doğrudan yazılıyor (sahibin kararı, CRITIQUE2). Yönetici onayına bağlansın mı? Bu bir yetki daraltmasıdır, dalga 10'un konusu değil (denetim D-19; `personel-yetki.md` §5.1; 26 Ekim'de sahibe soru 11).

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
| siparis | `siparis.md` | Sipariş önerisi, hızlı sayım, tedarikçiye WhatsApp siparişi, teslim kontrolü. **Bitti:** dalga 8 PR'ı ("Mal siparişi", `0035_mal_siparisi`, `docs/MAL-SIPARISI.md`). **B21'de (26 Ekim) kaldırıldı**, tablolar geçmiş için durur |
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
| para | Paraşüt: sitenin satış iadeleri gider sayılmaz (yalnız bilgi), e-faturaya bağlı kayıt silinmez, geç girilen faturalar kaçmaz, eşitlemenin veritabanı yolları sahte Paraşüt'le sınanır. Nakit planı sabit giderleri faturadaki KDV'siyle öder (`fixed_expenses.vat_rate`). Sayım ay sonundaki fiyatla değerlenir (Dalga 14'ten beri yalnız FIFO başlangıç ayından önceki aylar; sonrası FIFO, `docs/STOK-DEGERLEME.md`). Genel bakış online satışı da sayar. Kapalı günler sabit gideri azaltmaz. Ay ortasında yapıştırılan satış listesinin günü. `1,250.00` doğru okunur. Online satış üç ay geriye çekilir (geç iadeler). Sitenin isteğe bağlı `counter`, seçenek sayıları ve sipariş notları kabul edilir. Geçmişi olan ürün silinmez |

**Sahibe notlar (dalga 7):**
- Neon Free planı (ayda 100 CU-saat): Vercel › Storage › kullanım tahmini 100'ü aşıyorsa ücretli plana geçin; bar
  tabletine bildirim izni verin (bildirim yokken öndeki ekran 20 saniyede bir sorar ve veritabanı uyumaz; arka
  plandaki sekmede zil 10 dakikaya kadar gecikir; Sipariş bildirimleri açık kalsın).
- Dış izleyici `/api/health?isler=1`'i saatte bir değil 6 saatte bir çağırsın.
- Giderler'de her sabit giderin "Faturadaki KDV"sini kontrol edin (varsayılanlar: kira, faturalar, genel %20; personel
  %0; stopajlı şahıs kirası %0 olmalı).
- `npm run db:reset` uzak veritabanında `-- --onay=<sunucu>` ister ve önce tam yedek alır.
- Bir kez: Ayarlar › Paraşüt entegrasyonu › **Tarihten eşitle** (yılın başından ya da `PARASUT_SYNC_FROM`'dan). #18'den
  önce gider olarak (eksi tutarla) alınmış, 75 günden eski müşteri iadeleri böyle kalkar; günlük eşitleme yalnız son
  75 güne bakar.
- Site tarafı (laffogato oturumu): çift sayımı önleyen `counter`, seçenek sayıları, sipariş notları, menü listesinde
  `now`'ın okumadan önce alınması, karaoke oda saatleri ve PANEL-KARAOKE belgesi; panel hepsini isteğe bağlı okur.

**Sahibe notlar (dalga 8):**
- Komisyon: uyarıların hukuki dayanağını (Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik m.12/A,
  Ticaret Bakanlığı Genelgesi 2026/1) mevzuat.gov.tr'deki metinle bir kez karşılaştırın; metinler basın ve oda
  özetlerinden yazıldı. Kanallar'da her platformun ödeme süresini girin (varsayılan 30 gün). "Kanalı bulunamayan
  komisyon faturaları"nda görünen adı Tedarikçiler'de "Diğer adlar"a ekleyin. Ekim 2026 yarım ay (kasa raporları ay
  ortasında başladı); Z'den satış ilk tam ay Kasım'da.
- Mal siparişi: 26 Ekim'de kaldırıldı (B21); bu not geçersiz.

**Sahibe notlar (dalga 9):**
- Satış tahmini: kasa raporları biriktikçe kendi verinizle hesaplanır (her hafta günü için 3 rapor, yaklaşık 3 hafta);
  o zamana kadar aralık geniştir. Maç, AVM etkinliği, kampanya ya da kapalı gün olacaksa Satış tahmini › Özel günler'e
  ekleyin. Tatlı hazırlığı Tahmin ayarları'nda seçilen kategorilerden hesaplanır (varsayılan: Tatlılar). İsterseniz
  Vercel'de `WEATHER_CONTACT` (e-posta) tanımlayın: MET Norway'e giden hava durumu isteğinin kimliğine eklenir.
  2028 dini bayram tarihleri ikincil kaynaklardan; Diyanet takvimiyle bir kez karşılaştırın (`src/lib/forecast/calendar.ts`).
- Haftalık özet: pazartesi sabahı etkin yöneticilere gider (gönderilemezse salı, çarşamba yeniden denenir).
  Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet satırından kapatılır, önizlenir, örneği size
  gönderilir.

### Dalga 10: personel yetkileri

Plan `personel-yetki.md`. 10a (#30, migration `0039_personel_yetki`) ve 10b (#32, migration yok) main'de.
Belgeler: `docs/ONAYLAR.md`, `KASA-RAPORU`, `ZAYI-IKRAM`, `KONTROL-LISTELERI`, `FIYATLAR`,
`SITE-MENU` (Tükendi), `MAL-SIPARISI` § 11, `BUGUN`, `BILDIRIMLER`; personelin kendi anlatımı `/panel/yardim/personel`.

**Sahibe notlar (dalga 10):**
- **Daralan üç kural** (plan §0.5): sabah vardiyası dünün kasa alanlarını (açılış, nakit satış, gün içinde çıkan,
  sayılan, teslim) ya da Sayan'ı artık onayla değiştirir; açık günde sizin kategorinizdeki (maaş, avans) kasadan çıkan
  satırı personel onayla düzeltir ya da siler; düne zayi / ikram, bugünün kasa raporu girilince onaya düşer.
- **Telefonda bildirim:** onay istekleri zilde, Bugün'de ve sabah e-postasında. ("Onay bildirimleri" anahtarı mal
  siparişi taslağıyla birlikte B21'de kalktı; gönderen yok.)
- **Kasa e-postası:** alıcılarına personel adresi yazılamaz (e-postada karaoke ön ödemesi var).
- **Personelin Yardım'ı:** Yardım başlığındaki "Personelin Yardım'ı" düğmesi; hesabını açtığınız personele gösterin.
- **Açık soru, bu dalgada değil:** personelin fişli harcaması bugün Aylık harcamalar'a doğrudan yazılıyor; yönetici
  onayına bağlansın mı (plan §5.1 `fis-harcama-onayi`; yukarıda "Ayrı PR / sahibe soru").

### Dalga 11: cari (elle borç ve ödeme)

Sahibin isteği: "cari hesaplarda biz de borç ödeme girebilelim; belki elden almışızdır, fatura yok da olabilir".
Plan `cari.md` (ledger, minimal ve cashflow tasarımlarından çıktı). main'de (#28; dal `claude/dalga-11-cari`), migration
`0038_cari_hareket` (birleştirmede yeniden üretildi). Belgeler: `docs/TEDARIKCILER.md` › *Hesap hareketleri*,
`NAKIT-PLANI`, `KASA-RAPORU`, `BILDIRIMLER`, `PARASUT`, `CLAUDE-BAGLANTISI`, `YEDEK`, `MAL-SIPARISI` §7. Kasa'daki
değişiklik küçük ve ayrı tutuldu (iki etiket, ipucu, ad ipucu, bağlı satırın kilidi; `src/server/cari/kasa.ts`):
dalga 10 (personel yetkileri) de Kasa'ya dokunuyordu (`src/app/panel/kasa/*`, `src/server/actions/cash-outs.ts`); 10a
(#30) Dalga 11'in (#28) üstüne birleşti.

**Bu planın dışında kalanlar (v2):**
- Personelin Kasa'da "Tedarikçiye ödeme" türü: ad listesinden seçici ve "Listede yok" serbest metni, yönetici onayına
  kadar "onay bekliyor", `/panel/onaylar`'da "Kasadan ödemeler" sekmesi, personelin "Veresiye aldık" önerisi (dalga
  10'dan sonra; veri modeli `status` sütunuyla kaldırır).
- Tedarikçiden nakit iade ve faturasız iade (alacak dekontu); şimdilik Faturalar'da eksi fatura.
- Panelden önceki alacak ("açılış alacağı").
- Mal siparişinden "Cariye borç yaz".
- Faturasız alımdan miktar ya da hammadde fiyatı okumak.
- Paraşüt'e ödeme yazmak.
- Tedarikçinin kendi ekstresiyle otomatik mutabakat (yerine "Ekstreyi kopyala").
- Kasa'dan Ödeme ekle penceresini tedarikçi seçiciyle açmak (bugün "Hesaba işle" ve "Ödemeye çevir" tedarikçinin
  sayfasında açılır).

**Sahibe notlar (dalga 11):**
- Elle kayıt girilmedikçe bütün rakamlar eskisiyle aynıdır. Bir tedarikçiye ilk elle ödeme girilince o tedarikçinin
  faturaları panelde takip edilir: Paraşüt'ün "kalan"ı yalnız ipucu olur.
- Faturasız alımların gideri var olan **Nakit malzeme alımı** kategorisine yazılır (ad değişmedi; isterseniz
  Ayarlar'dan "Faturasız malzeme alımı" yapın, personel de bu adı görür).
- Personel tedarikçiye kasadan verdiği parayı **Teslim · ödeme** olarak girer; siz Tedarikçiler şeridinden, zilden ya da
  Kasa'daki **Hesaba işle**'den ödemeye bağlarsınız.
- `npm run db:reset` cari kaydı varken durur (`-- --cari-sil` ile silinir).

### Dalga 13: yazarkasa (banka POS) mali Z

Plan `okc-z.md` (§17 adım tablosu, her adımın "Durum (26 Ekim)" notu), araştırma notları `okc-z-notlar.md`. PR-a
(#33) ve PR-b (#35, 0a951dd) main'de; PR-b'nin migration'ı `0042_okc_z` (yalnız `ADD COLUMN`: `cash_reports`'a 12,
`ai_calls`'a `effort`). PR-b LafPOS'la (#34, #36) birleştirildi: LafPOS bandı, kasaya giren ve fotoğraf işaretleri mali
Z kartıyla çalışır. Belgeler: `docs/KASA-RAPORU.md` › Banka POS Z raporu (yazarkasa) ve Gönderince,
`docs/FOTOGRAF.md` (§ 1–§ 10), `docs/YAZARKASA-Z.md` (yeni: kâğıdın düzeni, etiketler, kimlikler, tuzaklar,
doğrulanacak cihaz gerçekleri), README; Yardım'da personele "Banka POS Z raporu (yazarkasa)", yöneticiye "ModPOS Z ve
banka POS Z raporu (yazarkasa)" ve "Banka POS Z'sinin fotoğraftan doldurulması".

**Kalan adımlar:**
- **b2, canlı değerlendirme (sahibin girdisini bekliyor):** `scripts/okc-eval` (run.ts, prepare.py) henüz yazılmadı;
  `OKC_TASK` taslaktır (gün cümlesi, `software_z`, etiketler gerçek fişlerle yeniden denetlenir); `okc*.json` kayıtlı
  yanıtları sentetiktir. Ölçümle kesinleşecekler: efor (`low` / `medium`), "önce üst, sonra alt yarı"nın varsayılan
  çekim olması, telefonda kalite 0,8 (`OKC_COMPRESS`, yazılmadı), okuma süresi metni ("Okunuyor… genelde N saniye"),
  okuma başına tutar (S8), şemadan çıkacak alanlar. Yalnız banka gün sonu fişi okumasında tarih uyarısı iki kez çıkıyor
  (`okc.ts`; denetimde E-69, B20).
- **Kapı:** gerçek fotoğraflarda `--tekrar 3` ile yanlış dolum 0, "doğrulandı ama yanlış" 0, alan doğruluğu ≥ %95, ilk
  okuma p90 ≤ 20 sn → `OKC_PREFILL_ENABLED = true` (ekran değişmez). Sonuç `ekler/okc-z/eval.md`'ye.
- **b8 yapıldı** (#35): veritabanı testleriyle 1978/1978 test, derleme, boş ve canlı benzeri veritabanında 43 migration,
  personel ve yönetici olarak tarayıcı, personel sızıntı betiği temiz.
- **Sonra:** eski `kasa-pos` yüklemesinin ve yeniden okumasının kaldırılması (PR-b'den en az iki hafta sonra, bekleyen
  geç raporlarda `kasa-pos` kalmadığı denetlenerek); 13b (KDV tahmini ve vergi bölümünün kasa geliri yazarkasa
  tabanına; dalga 12'den sonra, `okcMonth.complete` şartıyla); PR-c (yakın görünüm, ikinci okuma) yalnız b2 tek
  okumanın yetmediğini gösterirse.

**Sahibe notlar (dalga 13):**
- **Gereken girdi (b2):** 5–8 günün banka POS Z fotoğrafı; 2–3'ü ardışık günler, biri uzun ve soluk, en az biri ayrıca
  üst ve alt yarı olarak. **Asıl çözünürlükte** (telefonun kendi fotoğrafı; WhatsApp'tan "belge" olarak, Drive ya da
  e-postayla; WhatsApp'ın sıkıştırdığı resim değil) ve aynı günlerin kâğıttan doğru rakamları (Z no, günlük toplam,
  %10 ve %20 toplam ve KDV, toplam KDV, nakit, kart, yemek kartı, fiş sayısı, KÜM. TOPLAM ve KÜM. KDV). Aynı günlerin
  ModPOS Z'si (2 tane), varsa 1 banka gün sonu fişi ve 1 X raporu. Cihazın markası ve modeli; Z alınınca banka gün sonu
  aynı şeride basılıyor mu; Z'yi kim, saat kaçta alıyor (S12); ModPOS raporu hangi yazıcıdan çıkıyor (S13).
- **Canlı değerlendirme** `ANTHROPIC_API_KEY` ile yerelde, kabukta verilen anahtarla çalışır (anahtar depoya ya da
  `.env`'e yazılmaz); birkaç dolar tutar (okuma başına tahmini 0,05–0,10 $; ayda ek ~2–4 $).
- **O zamana kadar** yazarkasa Z'sinin fotoğrafı okunur ama hiçbir rakamı forma yazılmaz: her alanın altında öneri ve
  **Fotoğraftakini yaz** çıkar, personel fişle karşılaştırıp yazar. PR-b kapı kapalıyken (yalnız öneri) birleşti (26
  Ekim, #35); planın İlke 7'si gereği kapı ancak b2'nin gerçek fotoğraflı ölçümüyle açılır.
- **Varsayılanlar uygulandı** (`okc-z.md` §16): bölüm isteğe bağlı (girilmeyen gün "Yazarkasa Z yok" rozeti); ModPOS ile
  yazarkasa arasındaki toplam, nakit, yemek kartı ve banka farkı yalnız sizin ekranınızda ve seçtiğiniz e-posta
  adreslerinde, personelde ve WhatsApp'ta yalnız kart satırı (S2); geç raporda yazarkasa fotoğrafı kabul edilir ama
  zorunlu değil (S3); tek banka POS Z fotoğrafı, yazarkasa rakamı yazılmışken kaldırılamaz (S4); fotoğraf 400 gün (S5);
  faturalı satış / bilgi fişi Z'de görünürse toplam dışı tutulur (S6); kartlı ödemelerin hepsi yazarkasadan, banka gün
  sonu yedek (S7); tek cihaz, günde bir Z (S10).
- **Sizin onayınızı bekleyen tek karar:** WhatsApp'taki "Banka gün sonu" satırı yalnız tutardır (planın §8 örneğindeki
  ✅ yok): banka ↔ yazarkasa kartı karşılaştırması yöneticinin satırıdır, e-postada görünür. İsterseniz WhatsApp'a da
  açılır.
- **Deneme e-postası** gönderilmedi: Kasa › Rapor alıcıları › **Deneme e-postası** (son kayıtlı raporla gider) ile bir
  kez bakın; yeni "Banka POS Z raporu (yazarkasa)" bölümü ve yöneticinin satırları orada.
- **Kümülatif:** fotoğraftan okunur, yalnız önceki Z'yle tutuyorsa saklanır; yanlış saklandıysa gün ayrıntısındaki
  **Kümülatifi temizle**.

### LafPOS bağlantısı (#34, #36)

LafPOS (kafenin kasası, `RiosenBeq/lafpos`) ModPOS'un yerine geçer. Her iş gününü kapanışta imzalı `POST /api/pos/gun`
ile iter (günlük ürün satışı, Z ve kasa alanları, ödemeler, ikram); ürünlerin reçete maliyetini
`GET /api/panel/pos/urunler`'den okur (fiyat, kâr ve reçete gitmez). Kasa raporunda **LafPOS'tan doldur**; Kasa
raporuna "Gün içinde kasaya giren" (`cash_in`) eklendi. Migration'lar `0040_lafpos_baglantisi` ve `0041_kasaya_giren`
(#36: 0040 bir dal yayınıyla canlıya önceden uygulanmıştı, canlıdaki hâline döndü; dal yayınının canlıya çıkması
denetimde E-10, B05). Belge `docs/LAFPOS.md`.

**Durum (26 Ekim denetimi):** canlıda bilerek kapalı (E-31; sahip: kafede bugün ModPOS var, LafPOS bütün sistemlerde
açılınca kullanılacak): `LAFPOS_SYNC_SECRET` Vercel Production'da yok, iki uç 503 `not_configured`, `pos_day_reports`
ve `pos_daily_sales` boş. B07 (E-32): uç her sonucu `integration_state › lafpos`'a yazar, 200 yanıtı `counted` ve
`switchDay` taşır; Ayarlar › LafPOS (kasa) kartı durumu sakin dille, son reddi ve çözümünü ("Bu günün LafPOS kaydını
sil", parolayla), gelen ve gelmeyen günleri gösterir; "LafPOS'a geçiş günü" ayarı (varsayılan boş) geldi ve Kasa
raporunun LafPOS bandı yalnız o günden sonra açılır; sitenin anahtarıyla aynı `LAFPOS_SYNC_SECRET` bağlantıyı açmaz.
B08 (E-08, E-33, E-34, E-66): geçiş gününden itibaren günlük satış satırları aylık modele ay toplamı olarak girer (her
gün tek kaynak: geçiş ayında ModPOS listesi kendi son gününe kadar, sonraki aylarda yalnız LafPOS), Satışlar'da salt
okunur görünür ve eşleştirilir, ürünsüz satırlar ürün siteye bağlanınca ya da ad eşleştirilince yeniden gönderimsiz
bağlanır (Ayarlar kartında "Bağla"), LafPOS satırı olan ürün silinmez; geçiş günü boşken hiçbir okuma değişmez.
B09 (E-09, E-35, E-36, E-40; plan G6-G8, G11): geçiş gününden itibaren Kasa raporu LafPOS'un gün sonuyla açılır (Z
bölümü "LafPOS gün sonu (Z)", ModPOS Z fotoğrafı yok), kayıtlı rapor, günden güne, e-posta, WhatsApp ve zil
"LafPOS'tan farklı yazılan"ı söyler; Gün içinde çıkan'ın kaynağı panelin Kasadan çıkanlar'ı, LafPOS'un teslimi farkı
bilgi satırıdır ve geç / düzeltme kartında fişsiz sayılmaz; satışlı LafPOS günü kapalı gün kanıtıdır ve kapalı işareti
kaldırır; geç rapor LafPOS'un gün sonuyla fotoğrafsız (gelmediyse yazarkasa Z fotoğrafıyla); raporsuz LafPOS günü ay
rakamına girer; kart karşılaştırması kartla bahşiş ve cari tahsilatını düşer. Geçiş günü boşken bunların hiçbiri
çalışmaz. ModPOS'ta da: kasa e-postasının Resend anahtarı rapor satırına özgü (silinip yeniden girilen günün e-postası
gider, E-40).
B10 (E-37, E-38, E-68): geçiş gününden itibaren Komisyon & hakediş kart kart satışı LafPOS'un ödeme türlerinden alır
(elle > lafpos > tek; geçiş ayının önceki günleri kasa raporu kuralıyla; kanalı seçilmemiş ödeme ve gün sonu gelmeyen
gün uyarılır; LafPOS'ta satışı olan kanalın faturası gelmediyse kartı çıkar); ürün ikramı LafPOS'ta işaretlenir:
LafPOS'un ikramı Tutarlılık'ın kayıtlı tüketimine, Zayi'nin ay özetine, haftalık özete ve kasa özetine bir kez girer,
gün sonu gelen günde panele girilmiş ürün ikramı sayılmaz, yenisi (doğrudan, geç kayıt ve onayı) reddedilir; Zayi'nin
günü LafPOS'un ikramını salt okunur gösterir; kasa e-postası LafPOS'un ödenmez tutarını ikram listesiyle karşılaştırır.
İnceleme turunda: LafPOS'ta "Zayi: …" nedenli satır zayi sayılır (ikram değil); ürün ikramı yalnız gün sonu gelen günde
ve bugün reddedilir (gün sonu gelmeyen geçmiş günde girilir); ikramda ürüne bağlanamayan ad Ayarlar › LafPOS'tan
bağlanır; sonraki ayın 15'ine kadar kesilen fatura "fatura gelmedi" yerine bilgi olur. Açık soru (sahibe): LafPOS'ta da
zayi yazılan ürünün panel zayisi gün sonu gelen günde sayılmasın mı (şimdilik ikisi sayılır, gün listesi işaretler).
Geçiş günü boşken bunların hiçbiri çalışmaz. ModPOS'ta da: komisyon zili gecikenleri en eski son gün önce alır, beşe
sığmayanları tek satırda özetler (E-68).
B11 (E-39): geçiş gününden itibaren siteye bağlı ürün "Kasadaki fiyatlar"da (Kasaya işle, zil, Bugün, haftalık özet,
ürün kartı) görünmez, LafPOS fiyatı siteden alır; kasanın ModPOS durumu yine yazılır, gizlenen işaretler silinmez
(geçiş günü kaldırılır ya da ileri alınırsa LafPOS günlerindeki değişikliklerle birlikte geri gelir). Bağlı olmayan ürün
yalnız fiyatı LafPOS günü panelde değiştiyse görünür; metin "siteden geliyorsa Site menüsü'nde bağlayın, yerelse
LafPOS'ta elle" der. LafPOS gününde bu iş yalnız yöneticinindir (kasiyer LafPOS'ta fiyat değiştiremez).
Bugün'ün ve zilin akşam kasa satırı "LafPOS'ta Günü kapat" der; Kasa raporu, e-posta ve WhatsApp karşılaştırmaları,
kapalı gün kartı günün kasasını, aylık rapor etiketleri (Genel bakış, Gelir-gider, Tutarlılık, Ürünler, Analiz, KDV
tahmini, Excel, Claude) ayın kasasını yazar (geçiş ayında "Kasa (ModPOS 1–9 · LafPOS 10–30)"). Geçiş günü boşken
metinlerin hepsi bugünkünün aynısı.
Kalan: sahibe soru 5.

**Açılış sırası (sahibin adımları, `docs/LAFPOS.md` › "Açılış sırası"):** B07-B11 yayına girmeden geçiş günü seçilmez;
anahtarlar en erken B07 yayındayken girilir.
1. Anahtarlar: `openssl rand -base64 48` (en az 32 karakter; sitenin `KARAOKE_SYNC_SECRET`'ından **ayrı**); Vercel ›
   lafmaliyet › Settings › Environment Variables: `LAFPOS_SYNC_SECRET`, **yalnız Production**; LafPOS'un `.env`'ine
   aynı değerle `LAFMALIYET_SYNC_SECRET` ve `LAFMALIYET_URL=https://ladmin.laffogato.net`; paneli yeniden yayınlayın.
   Sitenin kendi `LAFPOS_SYNC_SECRET`'ı başka bir değerdir.
2. Deneme gönderimi: LafPOS'ta gerçek bir gün kapatılır; Ayarlar › LafPOS (kasa)'da "Deneme" görünür, başka hiçbir
   yerde görünmez.
3. Geçiş günü: Ayarlar › LafPOS (kasa) › "LafPOS'a geçiş günü" (tercihen ayın 1'i).

### Dalga 14: stok değerleme FIFO (#38)

Sahibin isteği (26 Ekim): "maliyeti stoktan düşerken önce giren önce çıkar gibi mantıkla yap". Plan `stok-fifo.md`,
belge `docs/STOK-DEGERLEME.md`; migration yok. Ay sonu stoğu ve kâr-zararın mal maliyeti başlangıç ayından (Ayarlar ›
Stok değerleme, varsayılan Ekim 2026; önce / sonra önizlemesiyle) itibaren dönemsel FIFO: partiler Paraşüt fatura
satırlarından (miktar × bağ çarpanı; bekletilen ya da reddedilen fiyat dışarıda, iadeler düşülür), katmanlar aydan aya
taşınır, karşılanmayan miktar ay sonu fiyatıyla. Başlangıçtan önceki aylar eskisi gibi (sayılan × ay sonu fiyatı;
Dalga 7'nin kuralı). Reçete, menü maliyeti, önerilen fiyat, zam uyarısı ve Tutarlılık son alış fiyatında kalır.
Sayımda katman rozeti ve kapsama satırı yalnız yöneticide.

Denetimde FIFO'ya dokunan maddeler: başlangıç ayına bir kerelik yeniden değerleme farkı mal maliyeti diye yazılıyor
(E-05, B02); iki sayılı paket adının yanlış çarpanı FIFO partisine de gidiyordu (E-06, B03'te düzeltildi); "Diğer"
kategorili fatura stoğa girip gelir-gidere girmiyordu (E-07, B03: artık "Mal alışı sayılmıyor" diye kontrol bekler).

### Dalga 15: kenar çubuğu (#39)

Yöneticinin kenar çubuğu: Genel bakış, Bugün, Onaylar ve Kasa raporu tek tıkta; sonra ana başlıklar Kafe, Menü, Stok,
Satış, Alış & gider, Finans (Vergi sonra buraya girer), Ayarlar ve Yardım, alt sekmeleriyle (`src/components/panel/nav.ts`
`NAV_TREE`, `docs/TASARIM.md`). Personelin ağacı ve adresler değişmedi; açık sayfanın grubu kendiliğinden açılır, komut
paleti aynı başlıkları kullanır. Migration yok. Stok sekmelerinin kenar çubuğuyla tutarsızlığı denetimde E-56 (B04).

### Dalga 8'in inceleme düzeltmeleri (PR #24'ün bulguları)

> Mal siparişi ve hızlı sayımla ilgili maddeler tarihçedir: iki özellik 26 Ekim'de kaldırıldı (B21).

- **Ay sonu sayımının anı:** geç girilen ya da sonradan düzeltilen ay sonu sayımı ayın son gününün sayımıdır
  (`monthEndCountAt`, en geç ertesi ayın 1'i 05:00); arada gelen mal siparişte kalır, girildiği gün Bugün'de "sayıldı"
  demez, "Gecikti" ve "Sayım eski" ayın son gününden sayılır. Sayım girilmeden önce denen Geldi de sayımın gününe kadar
  beklenen malı sayımda sayar (`OnHand.recordedAt`; inceleme: Geldi'nin sayımdan önce mi sonra mı dendiği sonucu
  değiştiriyordu, süt iki kez "siparişte" sayılıyordu).
- **Teslim süresi uzun sipariş:** 14 günden eski olsa da beklenen günün ertesine kadar "siparişte" kalır
  (`IN_TRANSIT_GRACE_DAYS`, zilin "gelmedi mi" sorusuyla aynı gün); kalem yeniden önerilmez, Bugün "Sipariş hazır"
  demez. Sayımdan sonra gelen uzun teslimli mal sıradaki sayıma kadar siparişte kalır: gelmiş siparişte 14 gün gelişin
  gününden sayılır (inceleme: beklenen günden iki gün sonra düşüyor, gelmiş mal yeniden öneriliyordu). Sonraya: fatura eşleşmesi (gönderimden 10 gün) ve kendiliğinden kapanış (45 gün) hâlâ gönderim gününden
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
  ayları `komisyon.since`'e kadar okuyan ikinci bir sorgu ya da sınırsız pencere). (2) **Bitti (denetim B10, E-68):**
  zil gecikenleri en eski son gün önce alır; beşe sığmayanlar son satırda "N hakediş daha gecikti" diye özetlenir.
- **Mal siparişi telefonda:** tedarikçi kartının iki düğmesi alt alta ve tam genişlikte, WhatsApp ile gönder üstte;
  320–414 px'te ikon kayboluyor, 375 px'in altında yazı taşıyordu (tarayıcıda 320, 360, 375, 390, 414 ve 1440 px).

### Dalga 7'nin bot bulguları (PR #18)

- **Bar ekranı arka planda (B1):** PR #18 arka plandaki her sekmenin yedek kontrolünü durdurmuştu; bildirimin
  ulaşmadığı bar ekranı sekme arkadayken yeni sipariş ve rezervasyonu hiç duymuyordu. Artık zili açık (ses açılmış,
  sipariş zili ya da karaoke alarmları açık) ve bildirim gelmeyen cihaz arka planda 10 dakikada bir sorar; "bildirim
  açık" yalnız izin değil, kayıtlı abonelik ve zilin konuları da açık demek (`pushCovers`). Bildirimi olan ve zili
  olmayan cihaz (yöneticinin dizüstü) arka planda yine sormaz. Testler: `canli-yoklama` ("bildirim gelmeyen, zili açık
  cihazda arka plandaki sekme 10 dakikada bir sorar", "zil cihazı", "bildirim açık sayılır", "bildirim açık: uyarı
  motoru ve bar ekranı…"). İnceleme düzeltmeleri: bar ekranının 20 sn'lik döngüsü yalnız sipariş zilinin bildirimine
  bakar (karaoke konusu açmaz); "Bu cihazda uyarılar" kartı 10 dakika sözünü yalnız arka planda soracak cihaza verir,
  ötekine "ancak öne gelince duyurur" der (`hiddenTabNote`); "Bildirimleri aç" satırında not ayrı paragraf, metin
  telefonda ve 380 px'lik yan sütunda dar sütuna sıkışmaz.
- **Fiyatıyla eklenen sayım kalemi (B2):** "Listeye ekle" fiyat geçmişine yazmıyordu; sonraki ilk zam kapanmış ayın
  devreden malını ve kârını değiştiriyordu (Eylül 400 → 520 ₺). Kalem açılırken yazılan fiyat geçmişin başlangıcıdır,
  zam uyarısı onu saymaz; eski kalemler `0037_sayim_kalemi_fiyat_baslangici` ile. Tahmin yanlışsa yöneticinin
  Hammaddeler'deki düzeltmesi (kalem hâlâ Tahmini, geçmişinde yalnız başlangıç) yeni satır açmaz, başlangıcın yerine
  geçer: kalemin eklendiği kapanmış ay da düzelir (inceleme bulgusu: düzeltme o aya hiç ulaşmıyordu). Paraşüt faturası
  tahmini düzeltmez, tarihli fiyattır. Test: `sayim-ekle` ("Listeye fiyatıyla eklenen kalem…", "tahmin
  düzeltilince…", "Hammaddeler'in fiyat yazımı…", veritabanında düzeltme, iki migration testi).
- **Tedarikçi geçmişi (B4):** eski faturası Paraşüt'e sorulamayan yeniden içeri alınmış e-fatura kalınan yeri kendi
  sayfasına geri alır, bildirim yeniden basmayı ister: "1 fatura yazılamadı (eski faturası Paraşüt'e sorulamadı);
  düğmeye yeniden basınca denenir." ("Süre doldu" yalnız süre dolunca; `historyNotice`). Testler: `parasut-esitleme-db`
  ("tedarikçi geçmişi: eski faturası sorulamayan fatura…"), `tedarikciler` ("Geçmiş faturaları al bildirimi…").
- **Personel kurulum ayrıntısı görmez (B5):** bar ekranının sarı satırı, siparişlerin Yenile'si ve karaokenin
  Eşitle'si personele `KARAOKE_SYNC_SECRET`, imza ya da "site güncel değil" yerine "sorun sürerse yöneticiye haber
  verin" der. Testler: `karaoke-baglanti` ("personel bar ekranında kurulum ayrıntısı görmez"), `arayuz-duzeltmeleri`.
- **Düzeltilmedi (B3):** önerilen değişiklik bulguyu düzeltmiyordu: yeniden denetim faturayı tedarikçisiz okur (kişi
  kimliği yalnız `include` edilince gelir), önbellek o yolda hiç okunmaz; ayrıca iadeler ödenmiş açılır, yeniden
  denetim yalnız ödenmemişe bakar. Asıl açık kod istemiyor: #18'den önce gider sayılmış, 75 günden eski müşteri
  iadeleri bir kez "Tarihten eşitle" ile kalkar (Sahibe notlar, dalga 7).
- **Düzeltilmedi (B6, reçete düzenleyicide pasife alma):** bulgunun senaryosu oluşmuyor: kaydedilmemiş değişiklik
  varken anahtar yalnız kapanır ve "Kaydet'e basın" der, kaydetmez; doğrulama duraklarının hepsi kaydedilmemiş
  değişiklik sayılır. Kaydetmeye inen iki kenar durum (kayıtlı fiyatı 0 iken silinen fiyat, kayıtlı miktarı 0 satırda
  "=") alana özel uyarı gösterir.
- Açık kalanlar:
  1. Reçete düzenleyicinin `save()` / `remove()`'u sunucu eylemini `try`/`finally`'siz bekler: eylem fırlatırsa (ağ
     yok, eski yayın) "Kaydediliyor…" takılı kalır, uyarı çıkmaz. `toastUnreachable` ve `finally`'de
     `setSaving` / `setDeleting` ile düzeltilmeli. 26 Ekim denetiminde daha geniş hâliyle E-51 (B20; reçete
     düzenleyici B12'de yapılırsa B20 onu atlar).
  2. ~~Aşama düğmelerinin hata bildirimleri personele hâlâ `KARAOKE_SYNC_SECRET` gösterir~~ B19'da kapandı (E-64, D-08):
     aşama, Tükendi, `/api/canli`, `/api/siparisler` ve kasa e-postası personele sabit metin döner
     (`src/lib/staff-errors.ts`); ayrıntı yöneticide.
  3. İsteğe bağlı: Postgres dışında ucuz bir değişiklik işareti (Vercel Runtime Cache ya da Edge Config sürüm sayacı);
     yalnız bar ekranı bildirimsiz çalışmak zorundaysa.
  4. B3 sağlamlaştırması: yeniden denetimin `SHOW_INCLUDE`'una tedarikçi (desteklenmezse geri düşerek); sahte
     Paraşüt `include`'a uysun.
  5. Sahibin kararı: sipariş zili kapalı cihazda (yöneticinin dizüstü, zili kapatılmış ikinci ekran) boş bar ekranına
     yeni sipariş kabuğun yedek kontrolüyle gelir (bildirim izni varsa 30 dakikaya kadar; son iki saatte sipariş
     olduysa 3 dakikada). O cihazlar da görünürken 20 saniyede bir sorsun mu? Sorarsa `/panel/karaoke` önde açık kaldıkça
     veritabanı uyumaz (Neon kotası). Varsayılan: sormaz; siparişleri izleyen ekranda zil ve Sipariş bildirimleri açık. (D-18; 26 Ekim'de sahibe soru 11.)

### Bekleyen dış girdi
- **ModPOS günlük ürün satış dökümü:** ModPOS hazırlıyor. Örnek dosya gelince içe aktarma yazılacak. tahmin, siparis
  ve doluluk planlarında bunun için bir giriş noktası (seam) var; o zamana kadar aylık veriyle çalışırlar.
  **26 Ekim:** ModPOS'un günlük dökümü gelmeyecek; ağzı LafPOS'un gün sonu doldurur (`docs/LAFPOS.md`). B08'den
  beri satırlar geçiş gününden itibaren aylık modele ay toplamı olarak girer (`docs/LAFPOS.md` › Günlük satış); gün gün
  okuyan (hafta gününe göre tatlı oranı gibi) henüz yok.

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

- `LAFPOS_SYNC_SECRET`: canlıda **yok** (26 Ekim, bilerek: kafede ModPOS var); LafPOS'un iki ucu 503 döner. Açma
  sırası §2 › "LafPOS bağlantısı" ve `docs/LAFPOS.md` › "Açılış sırası". `KARAOKE_SYNC_SECRET`'la aynı değer
  bağlantıyı açmaz.
  Vercel Preview'da yalnız `DATABASE_*` ile `ADMIN_EMAIL` / `ADMIN_NAME` var; gizli değerler yalnız Production'da
  (`docs/DEPLOY.md` §4).

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
7. (Düştü: mal siparişi B21'de kaldırıldı.) Mal siparişi: Paraşüt faturası siparişle eşleşince Geldi'nin anı **faturanın günü 12:00** yazılır
   (`docs/MAL-SIPARISI.md` §2, §7). Fatura sevkte kesildiyse sipariş erken gelmiş sayılır (fazla öneri), sayımdan
   sonraki bir güne tarihliyse geç (eksik öneri); saklanan hiçbir değer ikisini birden düzeltmiyor. Kalıcı çözüm
   (faturası bağlanan siparişte de Geldi'yi açık tutmak ya da sevki ayrıca kaydetmek) eylemi, Hızlı sayım listesini ve
   sipariş kartını değiştirir. Varsayılan: kural olduğu gibi kalır.
8. Cari: faturasız alımların kategorisinin adı **değişmez** ("Nakit malzeme alımı").
9. Cari: personelin listeden tedarikçi seçip onaylı ödeme girmesi **yok** (v2); personel Teslim · ödeme girer,
   yönetici Hesaba işle ile bağlar.
10. 26 Ekim denetiminin 11 sorusu ve yanıt gelene kadarki varsayılanlar: §2 › "Denetim (26 Ekim): düzeltme partileri".

## 6. Bu oturumda kullanılan çalışma düzeni (öneri)

- Her grup ayrı git worktree'de, kendi veritabanı ve dev sunucusu portuyla uygulanır → bağımsız inceleme (salt okunur)
  → bulguların düzeltilmesi → entegrasyon dalına birleştirme (R2) → doğrulama → PR.
- `ekler/implement-wave.workflow.js`: bu düzeni çalıştıran workflow betiği (yolları kendi ortamınıza göre değiştirin).
- Taze worktree'de `tsc` öncesi `npx next typegen` gerekir (PageProps tipleri).
- `ekler/fotograf-eval/`: fotoğraf okuma denemelerinin sentetik görselleri, istemleri ve kaydedilmiş yanıtları
  (birim test girdisi olarak kullanılabilir). `ekler/kdv/`: KDV hesabını doğrulayan prototip betikler (`.ts.txt`: derlemeye girmesinler diye; çalıştırmak için uzantıyı `.ts` yapıp `src/` yollarını düzeltin).

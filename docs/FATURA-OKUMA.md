# Faturadaki paket boyu (fiyat onayında ve ürün bağlarken)

Paraşüt'ten gelen faturanın 1 birimi kaç hammadde birimi eder? Bağlantının **çarpanı** budur ("1 Koli = 12.000 ml",
"1 Adet = 150 adet"). Çarpan yanlışsa birim fiyat da, alınan miktar da yanlış çıkar. Panel çarpanın kanıtını iki yerden
bulur: **kalemin adından** (ya da açıklamasından, biriminden) ve gerektiğinde **faturanın kendisinden** (Claude Haiku
5.5 okur). **Hiçbir şey kendiliğinden değişmez:** kart ve form önerilen çarpanı, onunla çıkan birim fiyatı ve farkını
gösterir; sahibi tek dokunuşla uygular. Fiyat onayının kuralları [PARASUT.md](PARASUT.md) 5b'de.

Neden (23 Ekim 2026, canlıda iki örnek):

- **Yenilebilir bardak:** ECOLİVİNG'in faturasında "LİVİ YENİLEBİLİR BARDAK 150 AD." 1 Adet × 3.000 ₺. Form çarpanı
  "1" tahmin etmişti; kart "↑ %7.103" ve "Çarpanı 72 yap" dedi (fiyatı şimdikine eşitleyen kat). Doğrusu 1 Adet = 150
  adet: adet başı 20 ₺, şimdikinden %52 ucuz. Düğmeye basılsaydı gerçek düşüş kaybolurdu.
- **Klips kapak:** şimdiki fiyat (1,165 ₺) faturadan değil, sayım listesine eklenirken yazılan varsayımdı. Serendi'nin
  faturasında 12,02 ₺; kart "↑ %932" ve "Çarpanı 10 yap" dedi. Tahmine göre oran kanıt değildir.

## 1. Addaki paket boyu (kanıt)

`src/lib/product-match.ts` › `packEvidence` faturadaki kalemden çarpanın kanıtını çıkarır; kanıt yoksa "bilinmiyor"
der (1 değil):

| Faturadaki birim | Kanıt | Örnek |
|---|---|---|
| Ölçü birimi (KG, LT, gr, ml; UBL KGM, LTR, GRM, MLT) | birimin kendisi | 1 kg = 1.000 gr |
| Paket (Koli, Kutu, Paket, Düzine…) | addaki sayı, gr / ml'de sayı × boyut | "330ML 1X24" → 24 adet ya da 7.920 ml; Düzine → 12 |
| Tek parça (Adet, C62, AD, Tane; boş birim) | addaki ya da açıklamadaki **tek başına** paket sayısı | "150 AD.", "150 ADET", "150'Lİ", "100 LÜ", "X150", "150 PCS" → 150 adet |
| Tek parça, gr / ml hammadde | addaki tek başına paket sayısı × boyut | "SÜT 1 LT 12 Lİ" → 12.000 ml |
| Dış paket (Koli, Kutu, Kasa) ve adda **iki sayı** | ikisinin çarpımı (gr / ml'de × boyut) | "KARTON BARDAK 8 OZ 50'Lİ X 20", "20X50 AD", "20 PK X 50 AD", "50 Lİ 20 PAKET", "100 AD X 10 PK" → 1.000 adet |

Sayılmayanlar: bardak boyu ("8OZ"), çap ve uzunluk ("90 MM", "23 CM"), yüzde ("%35 YAĞLI"), "2 KAT", ölçü gibi
yazılmış "24X24". Tek parçalı kalemde **sayısız boyut** ("SÜT 1 L") kanıt değildir: tedarikçi 12 × 1 L koliyi de "1
Adet" yazar; form eskisi gibi tek ürünün boyutunu önerir (1.000 ml), ama 12.000 ml'lik doğru bağlantı "Kontrol
edilecek" sayılmaz, kart "1.000 ml olmalı" demez. "1000 GR * 8 AD" gibi **boyut × sayı** da kolinin içeriğidir;
faturadaki birim tek kavanoz da olabilir koli de, kanıt sayılmaz (form tek ürünün boyutunu önerir). Faturada paket sayısı
kadar ya da daha çok alınmışsa ("PİPET 500 AD" 2.000 adet, "PEÇETE 100 LÜ" 120 adet) birim tek parça da olabilir paket
de: sayı kanıt sayılmaz, form da çarpanı **boş** bırakır ("1" değil; sahibi yazar ya da **Faturadan oku**).

**İki sayılı paket adı** (denetim 26 Ekim, E-06): eskiden yalnız ilk sayı okunuyordu ("50'Lİ X 20" → 50); 1 Koli 400 ₺
adet 8 ₺ görünüyordu (doğrusu 0,40 ₺), alınan miktar 20 kat az sayılıyordu. Şimdi bir paketteki tane ile paket sayısı
birlikte okunur. Faturadaki birim dış paketse (Koli, Kutu, Kasa) çarpım kanıttır (1.000). Birim tek parça (Adet) ya da
iç paketin adıysa (Paket, PK, Düzine) 1 birim 50 de olabilir 1.000 de: kanıt yok, form çarpanı boş bırakır ve
olasılıkları gösterir (`Adında “50'Lİ X 20” yazıyor: 1 Adet = 50 adet mi, 1.000 adet mi? Faturadan okuyun ya da doğrusunu
seçin.` · **50 yap** · **1.000 yap**; `packPairChoices`). Birim tek parçaysa (Adet) ve faturada en az bir paket kadar
alınmışsa tedarikçi taneyle de yazmış olabilir, tek tane de seçenektir ("BARDAK KAPAĞI 90 MM 100 AD X 10 PK", 1.000
Adet × 1,10 ₺ → **1 yap** · **100 yap** · **1.000 yap**; tek sayılı addaki kuralın aynısı). Ölçü olan ikinci sayı ("100 AD X 23 CM" pipetin boyu) ve
ürün koduna yapışık sayı iki sayılı paket sayılmaz. Paket anahtarı da çarpımı taşır: "50'Lİ X 10" başka pakettir, "50'Lİ X
20"nin bağlantısının çarpanı ona önerilmez. Sayılarda
nokta gr / ml'de ve paket sayısında binlik ayraçtır ("1.000 GR" = 1.000 gr, "1.000 AD." = 1.000 adet), kg / lt'de
ondalıktır ("1.500 KG" = 1,5 kg; "VANILYA.5.5LT" = 5,5 lt).

## 2. Onay bekleyen fiyat kartı (Hammaddeler)

Kart en çok **bir** "Çarpanı X yap" önerir; ilk tutan kanıt kazanır:

0. **Çelişki:** addaki (ya da açıklamadaki) paket boyu ile emin ya da büyük olasılıkla okunan fatura (3) farklı çarpan
   diyorsa düğme yoktur, iki değer birlikte yazılır: `Adında “50'Lİ” yazıyor: 1 Koli = 50 adet, adet başı 8,00 ₺ (…).
   Faturanın okuması: 1 Koli = 1.000 adet, adet başı 0,40 ₺ (…). İkisi çelişiyor; faturayı açıp bakın, doğru çarpanı
   “Bağlantıyı düzelt”ten yazın.` (Eskiden ad kanıtı önce geldiği için bağlantı 1.000, okuma 1.000 iken "Çarpanı 50
   yap" (+%1.900) çıkıyordu.) Faturadaki ölçü biriminin çevirisi (1 kg = 1.000 gr) okumayla çelişse de kanıttır.
1. **Addaki ya da birimdeki paket boyu**, bağlantının çarpanından farklıysa:
   `Adında “150 AD.” yazıyor: 1 Adet = 150 adet olmalı. Öyle olursa adet başı 20,00 ₺ (şimdikinden %52 ucuz).`
2. **Faturanın okunması** (3), emin ya da büyük olasılıkla okunduysa ve çarpandan farklıysa:
   `Faturada: “…”. 1 Adet = 150 adet → adet başı 20,00 ₺ (şimdikinden %52 ucuz).` Az emin okumada sonuna
   `Emin değil; faturayı açıp bakın.` eklenir, düğme çıkmaz.
3. **Çarpan oranı** (fiyat şimdikinin yaklaşık 12 katı → "Çarpanı 12.000 yap"), **yalnız aynı ürünün geçmişi varsa**:
   aynı ürünün (aynı Paraşüt ürünü) daha önceki ücretli bir faturası bu çarpanla şimdiki fiyatın ±%10'unda gelmiş
   olmalı. O zaman tedarikçi birimi değiştirmiştir (koli ↔ adet) ve oran doğrudur. Yeni tedarikçi, yeni ürün ya da
   tahmini fiyat karşısında oran gösterilmez: gerçek bir fiyat değişimini gizlerdi.
4. Yoksa öneri yok; kart okumayı ya da **Faturayı oku** düğmesini gösterir.

Önerilen çarpanla çıkan birim fiyat ve şimdikine göre farkı ("şimdikinden %52 ucuz" / "%18 pahalı" / "şimdikiyle
aynı") her zaman yazar: gerçek bir fiyat değişimi mi, görülsün. Öneriye basmak bağlantının çarpanını değiştirir
(Paraşüt sayfasındaki düzenlemeyle aynı): eski öneri geçersiz olur, fatura yeni çarpanla yeniden değerlendirilir; fark
hâlâ %40'tan büyükse yeni öneri onay bekler (bardakta "↓ %52"), sonra **Onayla**.

**İlk fiyat** (E-06): hammaddenin fiyatı yoksa (0 ₺; sayımdan fiyatsız eklenen kalem) faturanın fiyatı ancak çarpan
faturanın ölçü biriminden geliyorsa (KG, LT; düzine) doğrudan yazılır. Çarpan addan, açıklamadan ya da elle geldiyse ilk
fiyat da onaya düşer: kart **İlk fiyat** rozetiyle "Fiyatı yoktu → faturada …" ve `Hammaddenin fiyatı yoktu. Çarpan
faturanın biriminden (kg, lt) gelmediği için ilk fiyat onay bekliyor: faturadaki ürün ve çarpan doğruysa onaylayın.`
der; kanıtı ve okuması yoksa fatura kendiliğinden okunur. Reddedilirse hammadde fiyatsız kalır, sonraki faturanın
fiyatı yeniden sorulur. Zil ve e-posta "ilk fiyat" der (`holdReason`). Onay beklerken hammadde zilde ve Bugün'de
"Fiyatı girilmemiş" sayılmaz (`loadUnpricedIngredients`): tek iş "Fiyat onayı"dır, "paket fiyatını girin" ikinci bir
yol göstermesin; reddedilince yeniden sayılır. Genel bakış'ın "N ürünün maliyeti eksik" uyarısı da aynı: yalnız onay
bekleyen hammaddeden eksik kalan ürünler "N ürünün maliyeti fiyat onayında" olarak onaya götürür
(`Dataset.pendingPriceHolds`). Onay beklerken ilk fiyatın maliyeti 0 ₺ sayılır; zil, Bugün ve Genel bakış bunu söyler
(`holdEffectSentence`), "şimdiki fiyatla hesaplanır" demez.

**Tahmini fiyat:** hammaddenin şimdiki fiyatı tahminiyse (Hammaddeler'de "Tahmini"; sayım listesine eklenen kalem,
Excel'deki varsayım) kart `Şimdiki fiyat tahmini (varsayım), faturadan gelmedi. Faturadaki fiyat ilk gerçek fiyat
olabilir.` der, yüzde rozeti `tahmini fiyata göre` ile sarıdır. **Onayla** fiyatı yazar ve "Tahmini"yi aynı işlemde
kaldırır (işlem geçmişinde "tahmini fiyat kalktı"); Geri al ikisini birden geri alır. %40 kuralı değişmez: çarpan yine
yanlış olabilir, bir dokunuş bekler.

## 3. Faturayı oku (Claude Haiku 5.5)

- **Ne okunur:** kartın "Faturayı aç"ının açtığı belge: Paraşüt'ün e-fatura PDF'i (ilk açılışta indirilir, saklanır),
  yoksa faturanın Paraşüt'teki görseli, o da yoksa panelden yüklenen PDF ya da fotoğraf. PDF belge olarak, görsel görsel
  olarak gider. İsteğin metninde kalemin bizim verimiz (ad, açıklama, miktar, birim, KDV hariç net) ve hammaddenin adı
  ve birimi vardır.
- **Ne döner:** kalem bulundu mu, faturada okunan kalem (ad, miktar, birim, birim fiyat, tutar), bir birimin içeriği
  ("150 adet"), **çarpan**, güven (emin / büyük olasılıkla / emin değil), faturadan en çok 120 karakterlik alıntı ve kısa
  not. JSON şemasıyla istenir, zod ile doğrulanır (`src/lib/invoice-reading.ts`).
- **Denetim:** çarpan 0,001–1.000.000 dışındaysa yok sayılır; faturada okunan miktar bizim kalemimizinkinden farklıysa
  (başka satırı okumuş olabilir) ya da paket içeriği çarpanla tutmuyorsa güven "emin değil" olur. **Birim fiyat
  modelden alınmaz:** bizim kalemimizden hesaplanır (net ÷ miktar × çarpan).
- **Ne zaman:** kanıtı (1) ve okuması olmayan kart açılınca **bir kez kendiliğinden** ("Fatura okunuyor…"; kart başına
  bir istek, kartlar sırayla); öteki kartlarda **Faturayı oku**, okunmuşsa **Yeniden oku**. Kendiliğinden okuma sunucu
  eylemi değil, ayrı bir istektir (`POST /api/fiyat-onerileri/{id}/oku`, yalnız yönetici): Next eylemleri tek tek
  gönderir, okuma sürerken Onayla / Reddet / Çarpanı X yap beklemesin. Okuma bitince kart kendini tazeler. Kendiliğinden
  okuma **günlük sınırın yarısına kadar** yapılır (sınır 40 iken 20 okuma; en az 10 okuma her zaman Z raporu, POS fişi
  ve fişlere kalır); sonra kart **Faturayı oku** düğmesini gösterir. Aynı fatura başka sekmede okunuyorsa kart
  "Fatura okunuyor…" der ve okuma bitene kadar 8 sn'de bir kendini tazeler. Paraşüt › ürün bağlama formunda hammadde
  seçilince **Faturadan oku**: ürünün en yeni (ücretli, kafe) faturası okunur, emin okunursa çarpan doldurulur, kanıt
  altında yazar; bağlantı kaydedilmez. **Sabah işinde hiç çalışmaz.**
- **Saklama:** fatura + ürün başına bir okuma (`invoice_readings`): yalnız doğrulanmış JSON sonuç, model ve tutar.
  `ai_calls`'a yalnız maliyet satırı yazılır (zaman, kişi, token, tutar; sonuç değil). **İstem saklanmaz; PDF okuma
  için ayrıca kopyalanmaz:** "Faturayı aç"taki gibi faturanın belgesi olarak durur (okumada ilk kez indirildiyse de, § 5). Kart
  saklanan okumayı gösterir, bağlama formunda **Faturadan oku** saklanan okumayı hemen getirir (yeniden okumaz); Yeniden
  oku üzerine yazar (tutmazsa önceki okuma kalır). Okunamazsa nedeni saklanır, kendiliğinden yeniden denenmez. Okuma
  hammaddenin birimine göre sorulur: bağlantı başka birimli hammaddeye geçerse eski okuma gösterilmez. Fatura silinince
  okuması da silinir; `db:reset` faturalarla birlikte siler.
- **Kapılar** (fotoğraftan okumayla aynı, `src/server/ai/claude.ts`): anahtar (`ANTHROPIC_API_KEY`), **Ayarlar ›
  Fotoğraftan okuma** anahtarı (kapalıyken fatura da okunmaz) ve günlük sınır (varsayılan 40, fotoğraflarla ortak;
  Yeniden oku da sayılır; kendiliğinden okuma yarısında durur, `autoReadAllowed`). Okuma yalnız yöneticinin; personel
  bu ekranları görmez.
- **İstek:** `claude-haiku-5-5`, efor `medium` (modelin varsayılanı, açıkça yazılır), JSON şemalı çıktı
  (`output_config.format`), PDF `document` bloğu (base64). Haiku 5.5'te sunucu tarafı yedek model yoktur: `fallbacks`
  ve beta başlığı gönderilmez (fotoğraf isteği Opus 5.5 ve yedek modelle aynen kalır). `thinking`, sıcaklık ve ön
  doldurma gönderilmez. Deneme başına 20 sn, bir yeniden deneme; belge indirmesiyle birlikte 55 sn'ye sığar (sayfanın
  süresi 60 sn).
- **Tutar:** 0,10 $ / 0,50 $ milyon token (istem 100 bin tokenı aşarsa 0,50 / 2,50 $). Bir iki sayfalık e-fatura
  ~3–8 bin token: okuma başına yaklaşık 0,001 $ (birkaç kuruş). Ayarlar kartındaki "Bu ay" tutarı fotoğraflarla birlikte
  sayar.
- **Hata olursa** kart bugünkü gibi kalır, nedeni yazar (`aiErrorText`'in fatura metinleri: "Bu fatura okunamadı;
  faturayı açıp bakın.", "Bugünkü okuma sınırı doldu (40); faturayı açıp bakın." …); fiyata hiçbir şey yazılmaz.

## 4. Paraşüt sayfası

- **Bağlama formu** (bekleyen ürün ve bağlı ürünün düzenlemesi): yazılan çarpan addaki kanıttan farklıysa altında
  `Adında “150 AD.” yazıyor: 1 Adet = 150 adet olabilir.` ve **150 yap**. Hammadde seçilince çarpan kanıttan gelir
  ("150 AD." tek parçada 1 değil 150); faturada paket sayısı kadar ya da daha çok alınmışsa boş kalır (1). Adında iki
  sayı varsa ve birimden hangisi olduğu belli değilse ("50'Lİ X 20", 1 Adet) kutu boşalır, iki olasılık düğmeyle
  gösterilir (1). **Hazır olanları bağla** penceresi de farkı söyler, çarpanı boş kalanı listelemez. **Faturadan oku**
  (3).
- **Kontrol edilecek bağlantılar** (yalnız yönetici): bağlı ürünün en yeni kalemindeki kanıt bağlantının çarpanından
  farklıysa listelenir, ör. "LİVİ YENİLEBİLİR BARDAK 150 AD. → Yenilebilir bardak: 1 Adet = 1 adet; adında 150 AD.".
  **Düzelt** bağlantıyı listede açar. Kendiliğinden hiçbir şey değişmez; çarpan doğruysa olduğu gibi bırakın (ör.
  koli fiyatıyla "Adet" yazan tedarikçi).

## 5. Gizlilik (KVKK)

| Veri | Nereye gider | Ne kadar kalır |
|------|--------------|----------------|
| Faturanın PDF'i ya da görseli | Anthropic API (ABD), yalnız o okuma için; Anthropic'in ticari API koşulları geçerli | Anthropic'in politikasına göre |
| Okunan sonuç (kalem, paket boyu, çarpan, en çok 120 karakterlik alıntı) | Panelin veritabanı (Neon), `invoice_readings.result` | fatura silinene kadar |
| Okumanın maliyet satırı (zaman, kişi, token, tutar) | Panelin veritabanı (Neon), `ai_calls` | silinmez (maliyet kaydı; faturadan bilgi taşımaz) |
| PDF'in kendisi | Faturayı aç'taki gibi panelin veritabanında önbellekte (ilk açılışta ya da okumada indirilir); okuma ayrıca kopyalamaz | [PARASUT.md](PARASUT.md) 6a |

Faturalar ticari belgedir, ama şahıs firmasının faturasında kişinin adı, TC kimlik numarası ve adresi olur. Okuma bu
belgenin yurt dışına (Anthropic, ABD) gönderilmesi demektir. İstenmezse **Ayarlar › Fotoğraftan okuma** kapatılır:
fotoğraflar ve faturalar okunmaz, kart ve form addaki kanıtla çalışmayı sürdürür. Tam yedek okuma sonuçlarını içerir
([YEDEK.md](YEDEK.md)).

## 6. Yerelde deneme

- Anahtarsız: okuma "bu ortamda kurulu değil"; kart ve form addaki kanıtla çalışır, okuma düğmeleri görünmez.
- **Kayıtlı yanıtlarla:** `AI_REPLAY=1 npx next dev`. Fatura okuması `tests/fixtures/fatura/` yanıtlarından birini
  döner (istemdeki kalem adına göre): "LİVİ YENİLEBİLİR BARDAK 150 AD." → 150 adet, "PLASTİK KAPAK KLIPS" → 1 adet;
  başka kalem "bulunamadı". Bu yanıtlar **sentetiktir** (canlı istek yapılmadı). Faturanın belgesi yoksa okuma "Paraşüt
  bu fatura için belge vermedi…" der: faturaya PDF yükleyin.
- Testler (`npm test`, ağ ve anahtar gerekmez): `tests/product-match.test.ts` (kanıt: canlıdaki adlar ve
  sayılmayanlar), `tests/fiyat-onayi.test.ts` (kartın önerisi: bardak 150, klips oran yok, koli ↔ adet oran kalır),
  `tests/fatura-okuma.test.ts` (yanıt şeması, denetimler, birim fiyat, metinler, istem, kaynak kuralları),
  `tests/ai-istemci.test.ts` (Haiku + PDF isteği, değişmeyen fotoğraf isteği, tutar).

## 7. Dosyalar

| Dosya | İçerik |
|-------|--------|
| `src/lib/product-match.ts` | `packEvidence` (kanıt), `guessLinkFactor` (formun tahmini) |
| `src/lib/price-hold.ts` | `holdSuggestion` (kartın önerisi), `sameProductHistory`, metinler |
| `src/lib/invoice-reading.ts` | yanıt şeması, istemler, denetim (`normalizeInvoiceReading`), okuma satırı |
| `src/server/ai/run.ts`, `claude.ts`, `pricing.ts`, `replay.ts` | Haiku + PDF isteği, kapılar ve günlük (`extractDocument`), tutar, kayıtlı yanıtlar |
| `src/server/invoice-reading/read.ts` | belge, okuma, saklama (`invoice_readings`), aynı anda iki okumaya karşı kilit |
| `src/server/invoice-reading/hold.ts` | onay bekleyen fiyatın okuması (`readHold`) ve işlem geçmişi satırı |
| `src/server/actions/invoice-readings.ts` | `readHoldInvoice` (kartın düğmesi), `readProductInvoice` (bağlama formu) |
| `src/app/api/fiyat-onerileri/[id]/oku/route.ts` | kartın kendiliğinden okuması (eylem değil: sayfadaki düğmeleri bekletmez) |
| `src/app/panel/hammaddeler/price-holds.tsx`, `page.tsx` | kart |
| `src/app/panel/parasut/parasut-client.tsx`, `page.tsx` | bağlama formu, Kontrol edilecek bağlantılar |

## 8. Paneldeki Claude modelleri

Hepsi aynı kapılardan geçer (`src/server/ai/claude.ts`: anahtar, **Ayarlar › Fotoğraftan okuma**, günlük sınır) ve
`ai_calls`'a maliyet satırı yazar; model kimlikleri `src/server/ai/run.ts`'te, fiyatları `pricing.ts`'te.

| İş | Model | Efor | Yedek model | Günlük sınır |
|----|-------|------|-------------|--------------|
| Fotoğraftan okuma (Z, POS, fiş, yazarkasa Z'si; [FOTOGRAF.md](FOTOGRAF.md)) | `claude-opus-5-5` | low | `fallbacks: "default"` | okuma sınırı (varsayılan 40) |
| Faturayı oku (bu belge) | `claude-haiku-5-5` | medium | yok (Haiku 5.5'te sunucu tarafı yedek yok) | okuma sınırı (fotoğraflarla ortak) |
| Vardiyayı yazarak doldurma ([VARDIYA.md](VARDIYA.md)) | `claude-opus-5-5` | low | `fallbacks: "default"` | kendi sınırı (40) |
| Ürün → hammadde AI önerisi ([PARASUT.md](PARASUT.md) 5e) | `claude-sonnet-5-5` | medium | `fallbacks: "default"` (Claude Sonnet 5) | kendi sınırı (40 parti, 10 ürünlük) |

Ürün önerisi faturayı okumaz: yalnız kalemin adını, birimini ve fiyatını hammadde listesiyle karşılaştırır. Çarpan
ondan sonra da emin değilse bağlama formundaki **Faturadan oku** bu belgedeki okumayı yapar.

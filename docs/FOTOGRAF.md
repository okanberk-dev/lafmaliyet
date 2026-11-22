# Fotoğraftan okuma (ModPOS Z, banka POS Z raporu, kasadan çıkan fişler)

Kasa raporunda personel ModPOS Z raporunun, banka POS'un (yazarkasa) mali Z raporunun ve gün içinde kasadan ödenen
fişlerin fotoğrafını çeker; Claude okur, rakamlar forma dolar. **Banka POS Z raporunun rakamları şimdilik forma
yazılmaz, öneri olarak çıkar** (§ 2, canlı değerlendirme geçene kadar). **Hiçbir şey kendiliğinden kaydedilmez:** personel bakar, gerekirse
düzeltir, **Raporu gönder** ya da **Kaydet**'e basar. Fotoğraf kanıt olarak raporla saklanır. Ekranların kullanımı
[KASA-RAPORU.md](KASA-RAPORU.md)'de; burada nasıl çalıştığı, nerede durduğu ve ne tuttuğu.

## 1. Ne okunur, nereye dolar

| Nerede | Fotoğraf | Dolan alanlar |
|--------|----------|---------------|
| Kasa raporu › ModPOS Z raporu | ModPOS gün sonu Z raporu | Toplam satış, nakit, kredi / banka kartı, yemek kartı, online, diğer, ödenmez / ikram, indirim, Z no, fiş sayısı |
| Kasa raporu › Banka POS Z raporu (yazarkasa) | Yazarkasanın (banka POS) mali Z raporu; uzunsa üst ve alt yarı ayrı (bölümde en çok 3) | Günlük toplam, Z no, nakit, kredi kartı; Ayrıntılar'da yemek kartı, diğer, toplam KDV, oran oran KDV dökümü (%1, %10, %20), fiş sayısı; aynı şeritte basılıysa banka gün sonu. **Bugün hepsi öneri** (§ 2) |
| Kasa raporu › Banka POS Z raporu (yazarkasa) | Bankanın ayrı gün sonu fişi (yedek) | Yalnız Banka gün sonu (net toplam; iki fişte "Toplama ekle"); yazarkasa alanları boş kalır |
| Kasa raporu › Gün içinde kasadan çıkanlar › Fiş ekle | Alışveriş fişi, e-Arşiv ya da fatura | Tutar (verilen nakit ya da para üstü değil, fişin toplamı), yer, ne alındığı, fiş tarihi, KDV, kategori |

Kasadan çıkan alışveriş satırı **Aylık harcamalar**'a da yazılır (kurallar KASA-RAPORU.md › Gün içinde kasadan
çıkanlar); orada fotoğraf simgesi ve **Kasadan** rozetiyle görünür, tutarı ve tarihi Kasa raporu'nda düzeltilir.

## 2. Okunan nasıl denetlenir

Model her tutarı fişte yazıldığı gibi (`text`), okuduğu sayı (`value`) ve güveniyle (`high` / `medium` / `low`) döner.
Toplamlar, denetimler ve forma eşleme bizim saf kodumuzda (`src/lib/photo-read/`):

- Yazılı metin yeniden ayrıştırılır; sayıyla tutmazsa alan güvenilmez sayılır ("Okuma tutarsız").
- **Mavi "Fotoğraftan":** net okunup dolan alan. **Turuncu:** `medium` güvenle okunan ya da bir denetime takılan
  alan (altında nedeni). `low` (tahmin) forma hiç yazılmaz: "Fotoğrafta net okunamadı (…); fişten yazın." ve
  **Fotoğraftakini yaz**. Fotoğrafta bulunamayan temel alan da turuncu: "Fotoğrafta okunamadı; fişten yazın."
- Elle yazılmış alan değişmez; farklıysa "Fotoğrafta …" ve **Fotoğraftakini yaz** önerilir.
- ModPOS Z raporu: tarih raporun günü mü (gece 05:00'e kadar basılan bir önceki güne sayılır), Z no önceki rapordakinden
  büyük mü / arada atlama var mı, ödeme türlerinin toplamı Z toplamını ya da Z toplamı − ödenmez'i tutuyor mu (formun
  ve kayıtlı raporun kuralı, [KASA-RAPORU.md](KASA-RAPORU.md) › Ciro ve ödenmez: ikramlı günde Z toplamı ödenmezi
  içerir, uyarı yalnız ikisini de tutmayınca; denetim KP-08), tanınmayan ödeme satırı, ikram ve iade satırları,
  indirim. Eksi basılmış indirim, ödenmez ve iade toplamı ("-250,00") tutarıyla alınır, eksi iade de "iade var" der
  (denetim KP-10).
- Banka gün sonu fişi: net toplam = satış − iade mi, birden çok fiş ya da başka günün fişi.
- **Banka POS Z (yazarkasa)** ([YAZARKASA-Z.md](YAZARKASA-Z.md) § 4): oranların toplamı ve KDV'si günlük toplamı ve
  toplam KDV'yi tutuyor mu, her oranın KDV'si toplamına uyuyor mu, ödemeler günlük toplamı tutuyor mu (toplam dışı
  tahsilat ayrı), KDV oranı aralığı, Z no önceki yazarkasa Z'sinden bir fazla mı (aynıysa okumanın bütünü durur),
  kümülatif zinciri (yalnız sunucuda), büyüklük, GENEL TOPLAM satırı, eski oranlar, fiş sayısı, tarih. Her alanın
  durumu: **tutmadı** (forma hiçbir zaman yazılmaz; tek sade nedeniyle öneri), **doğrulandı** (iki ayrı basılı rakam
  birbirini tutuyor) ya da **denetlenemedi**. Tek oranlı ya da tek ödemeli günde aynı rakamın kopyaları birbirini
  "doğrulamaz". Kümülatif (KÜM.) satırlar günün rakamı olarak hiçbir alana gitmez.
- **Doldurma kapısı (yazarkasa Z'si):** `OKC_PREFILL_ENABLED = false` (`src/lib/okc-z.ts`; sahibin kararı). Okunan her
  rakam alanın altında öneridir ("Fotoğraftan okundu; fişle karşılaştırıp yazın. Fotoğrafta 9.350 ₺." ve
  **Fotoğraftakini yaz**); hiçbir alan kendiliğinden dolmaz. Kapı, gerçek fişlerle yapılan canlı değerlendirmede
  (§ 8) yanlış dolan alan ve "doğrulandı ama yanlış" alan 0 çıkınca açılır; o zaman doğrulanan alan orta güvende de
  mavi dolar, tutmayan ve düşük güvenli alan yine yazılmaz. Ekran değişmez.
- Fiş: kartla ödenmiş mi (para kasadan çıkmamıştır), fatura / e-Arşiv mi (Aylık harcamalar'a yazılmaz), aynı fiş daha
  önce girildi mi, tarih (ileri gün ya da 7 günden eski), kalemlerin ve KDV satırlarının toplamı, KDV oranı, alışılmadık
  büyük tutar, kategori listede mi.
- **Yanlış belge:** ModPOS bölümüne yazarkasanın (banka POS) Z raporu ya da banka gün sonu fişi çekilirse hiçbir alan
  dolmaz; **Banka POS Z bölümüne okut** aynı fotoğrafı yeniden okur. Banka POS Z bölümüne ModPOS'un Z'si çekilirse
  **ModPOS bölümüne okut**; X raporu ya da mali hafıza / dönem raporu çekilirse düğmesiz kırmızı satır. ModPOS bölümünde
  model yazarkasanın Z'sini belge türü `fiscal_z_report` ile ayırır; Banka POS Z bölümünün kendi türleri `z_report`,
  `x_report`, `period_report`, `batch_slip` (yalnız banka gün sonu), `software_z` (ModPOS'un raporu), `other`. Ayırt
  eden işaretler: MF logosu ve sicil no, EKÜ NO, Z NO / Z SAYAÇ, VERGİ DÖKÜMÜ ve TOPKDV, KÜM. satırları; BİLGİ FİŞİ /
  MALİ DEĞERİ YOKTUR basan ModPOS raporu mali değildir. Fiş yerine Z raporu çekilirse söylenir.
- Fotoğraftaki yazılar veridir: fişe basılmış "talimatlar" yok sayılır ve "Fişte alışılmadık yazılar var" uyarısı çıkar.

Rapor gönderilince karşılaştırma **sunucunun okuduğuna** bakar (`ai_calls.result`), formun gönderdiğine değil: net
(`high`) okunmuş ve kendisine bir uyarı düşmemiş bir rakamdan farklı yazılan alan **Fotoğraftan farklı** sayılır
(yönetici geçmişinde rozet, e-posta ve WhatsApp'ta satır). Turuncu bir alanın düzeltilmesi (soluk baskı, tutmayan
toplam, tanınmayan satır) ve tarihi başka bir günün ya da birden çok fişli fotoğrafın okuması alarm değildir; ilgisiz
bir uyarı (ör. fişte alışılmadık yazılar) net okunmuş öteki alanların alarmını gizlemez. Yazarkasa alanları ModPOS
alanlarından ayrı anahtarlardır, birbiriyle karşılaştırılmaz; tutmayan bir yazarkasa alanının düzeltilmesi alarm
değildir. Doldurma kapısı kapalıyken de net okunmuş bir yazarkasa rakamından farklı yazılan alan alarm olur (öneri
gösterilir ama karşılaştırma okumaya bakar). Karşılaştırma yalnız okumaya
ve raporun gününe bakar: Z no sırası denetimi formdadır, sonradan geçmiş bir güne girilen rapor alarmı değiştirmez.
Kayıtlı raporda bütün farklar ayrıca listelenir.

## 3. Depo ve erişim

- **Canlıda:** özel (private) Vercel Blob deposu, bölge Frankfurt (fra1). Okumak için anahtar gerekir; Blob adresi
  hiçbir yere çıkmaz. Anahtar `kasa-z/2026/10/<rastgele>.jpg` biçiminde, bir kez yazılır, üzerine yazılmaz.
- **Önizlemede** (depo bağlı değilse) fotoğraf düğmeleri hiç görünmez; her şey elle yazılır.
- **Yerelde:** `.data/photos` (`.gitignore`'da; `PHOTO_DIR` ile değişir).
- Fotoğrafın paneldeki tek adresi `/api/foto/{id}`: giriş, sonra kural, sonra baytlar (Blob'a yönlendirme yok).
  Yanıt `Cache-Control: private, max-age=3600`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`.
- **Kim görür:** yönetici hepsini; yükleyen kişi henüz kayda bağlanmamış kendi fotoğrafını (formdaki küçük resim);
  personel, hâlâ düzenleyebildiği günlerin (bugün ve dün; ertesi günün raporu girilince o gün kapanır,
  KASA-RAPORU.md) kasa raporu ve kasadan çıkan fotoğraflarını; şubesine kilitli personel yalnız kendi şubesininkileri
  (`staffBranchRefusal`, [SUBE.md](SUBE.md) › Personel hesabının şubesi). O günlere fotoğraf eklemek de aynı kuralla
  (`src/server/photo-read/rules.ts` › `staffDayOpen`). Geç kasa raporu için personel dünden eski, raporu girilmemiş
  son 14 günden birine de ModPOS Z ve banka POS Z fotoğrafı ekler (`staffLateDayOpen`; ilk rapordan sonra, kapalı işaretli olmayan
  gün; [KASA-RAPORU.md](KASA-RAPORU.md) › Geç rapor). Fişi personel bugün ile 7 gün öncesi arasına yükler (açık günde
satıra, kapanmış ya da eski günde kasadan çıkan isteğine; [KASA-RAPORU.md](KASA-RAPORU.md) › Kasadan çıkan: kapanmış
gün, yöneticinin satırı). Kural saf olarak
  `src/lib/photo-rules.ts` › `uploadRule`. Kapanan günde personel fotoğrafları görmez (kasadan çıkan
  satırında küçük resim yerine fiş simgesi); WhatsApp metnindeki "📷 … fotoğrafı panelde" ve "Fotoğraftan farklı
  yazılan" satırları kalır. Kontrol listelerinin fotoğraflarını personel, personelin doldurduğu listelerin bugünkü ve
  dünkü (iş günü) kayıtlarında görür (`src/lib/checklists.ts` › `photoAccess`, [KONTROL-LISTELERI.md](KONTROL-LISTELERI.md)
  § 4). Kalanı 403 "Bu fotoğrafı görme yetkiniz yok."
- **Sınırlar:** en çok 2 MB; JPG, PNG ya da WebP (tür içerikten denetlenir; PDF ve HEIC değil); kenarlar 200–4096 px;
  kişi başına saatte 30 yükleme; bir fotoğraf en çok 3 kez okunur (hatalı ve zaman aşımına düşen okuma da sayılır); bir
  rapora en çok 6 fotoğraf, Banka POS Z bölümüne en çok 3 ("Banka POS Z bölümüne en çok 3 fotoğraf eklenir"); bir kontrol listesinde
  en çok 10 fotoğraflı madde (kontrol fotoğrafı okunmaz, yalnız saklanır; yüklemesi `POST /api/kontrol/foto`).
- Telefonda fotoğraf JPEG'e (kalite 0,7) küçültülür; EXIF (konum dahil) düşer. Ölçü Claude'un ayrıntısını
  kaybetmeden okuduğu en büyük ölçüdür: en uzun kenar en çok 2576 px, alan en çok ~3,7 megapiksel
  (`src/lib/photo-compress.ts` › `PHOTO_COMPRESS`). Telefon fotoğrafı 3:4 olduğundan ~1670×2220 px olur, çoğu
  0,4–1,2 MB; 1,8 MB'ı aşan görsel önce daha düşük kaliteyle, gerekirse daha küçük yeniden kodlanır (sunucu 2 MB'ta
  keser). Uzun bir Z raporu tek fotoğrafta yine dar kalır (rulo ~375 px eninde; 1600 px'te ~270 px kalıyordu); canlı
  değerlendirmenin `z-uzun-tek-fotograf` durumu bunu dener (§ 8). Okunmuyorsa personel raporu iki parça çeker (ikinci
  fotoğraf yalnız boş alanları doldurur). Banka POS Z'si de bugün aynı ayarla küçültülür; plandaki daha yüksek kalite
  (0,8, `OKC_COMPRESS`) ve "önce üst, sonra alt yarı"nın varsayılan çekim olması canlı değerlendirmenin ölçümüne bağlı
  ([planlar/okc-z.md](planlar/okc-z.md) §4.3, D11).

## 4. Saklama ve temizlik

| Fotoğraf | Silinir |
|----------|---------|
| Yüklenip bir kayda bağlanmayan (form bırakıldı, Kaldır) | 2 gün sonra |
| Kasa raporunun ModPOS Z'si (ve eski banka POS fişi) | raporun gününden 180 gün (6 ay) sonra |
| Kasa raporunun banka POS Z'si (yazarkasa) | raporun gününden 400 gün (13 ay) sonra: yıllık vergi mutabakatı bir takvim yılını kapsar. Kâğıt Z'lerin yasal saklama yükümlülüğü ayrıdır |
| Kasadan çıkan fişin | satırın gününden 400 gün (13 ay) sonra |
| Kontrol listesinin (açılış, kapanış) | kaydın gününden 60 gün sonra; yeniden çekilenin eskisi hemen |
| Bağı kalkan (satır silindi, fotoğraf değişti) | 7 gün sonra (Geri al payı) |
| Silinen kasa raporunun | 30 gün sonra |
| Onay bekleyen bir istekte tutulan (geç kasa raporu) | istek beklerken silinmez, hiçbir kayda bağlanamaz; onayda raporla bağlanır (180 gün; banka POS Z 400 gün); ret ya da yöneticinin günü kendisi girmesiyle 30 gün, geri çekme ya da istekten çıkarma ile 7 gün sonra |
| Onay bekleyen kasadan çıkan isteğinin fişi | istek beklerken silinmez; onayda satıra bağlanır (400 gün); ret, geri çekme ya da süre dolması (14 gün) ile 7 gün sonra |
| Yöneticinin onayıyla rapordan kaldırılan Z / POS fotoğrafı | 30 gün sonra (okuması kalır) |

Geçmiş bir güne sonradan girilen rapor ya da satırın fotoğrafında süre eklendiği günden sayılır.

İstekte tutulan fotoğrafın süresi kalkar (`holdPhoto`: `expires_at` boş, bağlanmamış); yükleyen kişi küçük resmini
görmeye devam eder. Başka bir istek ya da kayıt onu bağlayamaz: kasa raporu, kasadan çıkan ve harcama yolları
`assertNotHeld` çağırır ("Bu fotoğraf onay bekleyen bir istekte"; [ONAYLAR.md](ONAYLAR.md)).

Süresi dolanları **sabah işi** (`/api/cron/gunluk`) siler: önce depodan, sonra kaydı; sabah başına en çok 100,
işin zaman bütçesi içinde (en çok 8 sn). **Ayarlar › Günlük işler**'de adımı "Fotoğraf temizliği": "Eski fotoğraflar
silindi", "Silinecek fotoğraf yok", "Fotoğraf deposu yok", "Fotoğraf temizliği hata" (yalnız hata işi "kısmen" yapar;
silinemeyen ertesi sabah yeniden denenir). Yönetici kayıtlı rapordaki bir fotoğrafı hemen silebilir (rapor kalır).

Tam yedek fotoğraf **dosyalarını** içermez, yalnız kayıtlarını ([YEDEK.md](YEDEK.md)).

## 5. Claude

- Faturadan paket boyu okuma (Hammaddeler › fiyat onayı, Paraşüt › ürün bağlama) aynı istemciyi, kapıları ve günlük
  sınırı kullanır ama başka modelle: `claude-haiku-5-5`, PDF belge, yedek model yok ([FATURA-OKUMA.md](FATURA-OKUMA.md)).
- Model `claude-opus-5-5`, efor `low`, JSON şemalı çıktı (`output_config.format`), base64 görsel. Reddedilen okuma
  Anthropic'in önerdiği yedek modelle sunucuda yeniden denenir (`server-side-fallback-2026-07-01`,
  `fallbacks: "default"`). Deneme başına 20 sn, bir yeniden deneme, toplam en çok 45 sn; `max_tokens` 6000.
- **Banka POS Z (yazarkasa) okuması ayrı ayarla** (`src/server/ai/run.ts` › `OKC_EFFORT`, `OKC_MAX_TOKENS`,
  `OKC_TIMEOUTS`): aynı model, efor `low` (açıkça gönderilir ve `ai_calls.effort`'a yazılır; ötekilerde boş), `max_tokens`
  8000, **tek 50 sn'lik deneme**: toplam süre 50 sn'de kesildiği için zaman aşımından sonra yeniden deneme kalmaz; 529
  ya da bağlantı hatası birkaç saniyede döndüğünden ona kalan süre içinde bir yeniden deneme düşer. Yolun süresi 60 sn
  (`maxDuration`). Efor `medium` ancak canlı değerlendirmede yanlış dolumu ve "doğrulandı ama yanlış"ı düşürür ve ilk
  okumanın p90'ı 20 sn'yi aşmazsa seçilir (§ 8; plan §4.4). Zaman aşımına düşen yazarkasa okumasının sunucu günlüğünde
  eforu da yazar. Öteki okumaların isteği birebir aynı kalır (`tests/ai-istemci.test.ts`).
- **Yazarkasa Z'si yapılandırılmış çıktısız gider.** Yapılandırılmış çıktının açık sınırı istek başına en çok 16
  birleşim türlü (`anyOf` ya da `["string","null"]`) ve 24 isteğe bağlı parametredir; aşan şemayla istek 400 alır.
  `KasaOkcRaw`'da 42 birleşim türlü parametre var (her tutarın `text` ve `value`'su null alabilir; Z 14, banka gün sonu
  11, fiş 14, fatura 8). Bu yüzden sınırı aşan şema `output_config.format` olmadan gönderilir, şema görev metninin
  sonuna yazılır (`JSON_REPLY`) ve yanıt yine zod'dan geçer; çitli ya da cümleli JSON da okunur, uymayan "invalid" olur
  (`fitsStructuredOutputs`, `src/lib/photo-read/claude-schema.ts`). 28 Ekim'de canlıdaki ilk "[foto] okuma badrequest
  400" büyük olasılıkla buydu (o gün günlük API'nin hata metnini yazmıyordu).
- İstemler `src/lib/photo-read/prompts.ts`, şemalar `schemas.ts` (açıklamalar modele gider, İngilizce). Yanıt zod ile
  doğrulanır; tutmazsa "Fotoğraftaki rakamlar güvenilir okunamadı. Elle yazın."
- **Kapılar:** anahtar (`ANTHROPIC_API_KEY`), Ayarlar › Fotoğraftan okuma'daki anahtar, günlük sınır (varsayılan 40;
  dolunca fotoğraf yine eklenir), fotoğraf başına 3 okuma. Vardiya'daki yazarak doldurma aynı anahtarı ve aynı aç / kapa
  ayarını kullanır ama günlük sınıra **sayılmaz** (kendi sınırı var: [VARDIYA.md](VARDIYA.md) › Yazarak doldurma).
- **Günlük:** her okuma `ai_calls`'a yazılır: zaman, tür, kişi, fotoğraf, durum ve hata kodu, token sayıları, tutar
  (dolar), süre, çalışan model, Anthropic'in istek kimliği ve doğrulanmış sonuç (sayılar, mağaza adı, tarih, kalemler;
  satıcının vergi numarası saklanmaz). Sonuç fotoğrafla birlikte silinir, maliyet satırı kalır. **Görsel ve istem
  hiçbir yere yazılmaz.** Anahtar hatası, kredi bitmesi ve reddedilen istek sunucu günlüğüne de düşer: okuma türü,
  kod, durum, istek kimliği ve API'nin kendi hata türü ve metni (`aiAlertLog`, en çok 300 karakter; ör. `[foto] okuma
  kasa-okc badrequest 400 req_… · BadRequestError 400: invalid_request_error: …`). SDK'nın hata metni yalnız API'nin
  yanıt gövdesidir, isteğin hiçbir parçasını taşımaz; günlüğe ondan da yalnız `error.type` ve `error.message` girer.
- **Tutar:** denemelerde (1600 px görsellerle) okuma başına 0,017–0,031 $ (çoğu ~0,03 $). Görsel artık ~3,7 MP
  olduğundan bir okuma ~0,01 $ daha pahalı olur (görsel ~4.800 token); ayda ~60 kasa + ~60 fiş okuması ≈ 4–5 $.
  Ayarlar kartı bu ayın okumasını ve tutarını, bugünkü okuma / sınırı gösterir. Anthropic Console'da aylık harcama
  sınırı koymak önerilir.
- **Banka POS Z'sinin tutarı henüz ölçülmedi.** Tahmin: istem ve şema daha büyük (görselle ~9–11 bin girdi token'ı),
  okuma başına ~0,05–0,10 $, ayda ~2–4 $ ek; gerçek rakam canlı değerlendirmede `usage` ile ölçülüp buraya yazılır.
  **Zaman aşımına düşen deneme `ai_calls`'ta 0 $ görünür:** Anthropic yanıtı ve token sayılarını döndürmediği için tutar
  yazılamaz, oysa istek sunucuda tamamlanıp ücretlendirilmiş olabilir. Ayarlar kartının tutarı bu yüzden biraz eksik
  sayar. Günlük okuma sınırına (40) daha erken yaklaşılır: Banka POS Z bölümüne en çok 3 fotoğraf, her biri en çok 3
  kez okunur.
- Hata metinleri (`src/server/ai/run.ts` › `aiErrorText`): zaman aşımı, bağlantı, yoğunluk ve yarım kalan okumada
  **Yeniden dene**; anahtar ve kredi hatası "yöneticiye haber verin".

## 6. Gizlilik (KVKK)

| Veri | Nereye gider | Ne kadar kalır |
|------|--------------|----------------|
| Fotoğrafın kendisi | Vercel Blob (özel depo, Frankfurt) | § 4 |
| Okuma için fotoğraf | Anthropic API (ABD), yalnız o okuma için; Anthropic'in ticari API koşulları geçerli | Anthropic'in politikasına göre |
| Okunan sonuç (rakamlar, mağaza adı, tarih, kalemler; satıcının vergi no'su saklanmaz) | Panelin veritabanı (Neon), `ai_calls.result` | fotoğrafla birlikte silinir (§ 4) |
| Okumanın maliyet satırı (zaman, tür, kişi, token, tutar) | Panelin veritabanı (Neon), `ai_calls` | silinmez (maliyet kaydı; fotoğraftan ya da fişten bilgi taşımaz) |
| E-posta ve WhatsApp | yalnız "📷 … fotoğrafı panelde" satırı ve farklı yazılan rakam | fotoğraf ya da adresi hiç gitmez |
| Banka POS Z'si (yazarkasa) | Fotoğraf ve okuma yukarıdaki gibi (Anthropic'e de gider). Z'de kişisel veri yoktur; başlıkta şirketin unvanı, adresi, VKN'si ve cihazın sicil no'su basılıdır (her fişte basılı şirket bilgisi). Okuma şirket adını ve VKN'yi almaz (şemada alanı yok) | fotoğraf 400 gün (§ 4) |
| Kontrol listesinin fotoğrafı (tezgâh, salon, oda) | Vercel Blob (özel depo, Frankfurt); okunmaz, Anthropic'e gitmez | 60 gün (§ 4). Maddenin açıklaması "Fotoğrafta müşteri ya da çalışan görünmesin." der |
| Faturadan okuma için faturanın PDF'i ya da görseli | Anthropic API (ABD), yalnız o okuma için ([FATURA-OKUMA.md](FATURA-OKUMA.md) § 5) | Anthropic'in politikasına göre. Panelde okunan sonuç (`invoice_readings`) ve PDF'in kendisi: "Faturayı aç"taki gibi faturanın belgesi olarak (`invoice_documents`, okumada ilk kez indirildiyse de; [PARASUT.md](PARASUT.md) 6a) |

Fotoğrafta kasiyerin adı (Z raporu, fiş), satıcının vergi numarası (şahıs şirketinde TC kimlik no olabilir) ya da
müşteri kartı kullanıldıysa maskeli ad / telefon görünebilir. Okuma, fotoğrafın yurt dışına (Anthropic, ABD)
gönderilmesi demektir: personele söyleyin; istenmezse **Ayarlar › Fotoğraftan okuma** kapatılır (fotoğraf yine kanıt
olarak eklenir, yalnız Frankfurt'ta saklanır). Aynı anahtar faturadan okumayı da kapatır: şahıs firmasının faturasında
kişinin adı, TC kimlik numarası ve adresi olur. Tam yedek o günkü okuma sonuçlarını da içerir (fotoğraf dosyalarını
değil); indirilen yedek dosyası sizde, sizin sakladığınız kadar kalır ([YEDEK.md](YEDEK.md)).

## 7. Ortam değişkenleri

| Değişken | Nerede | Ne |
|----------|--------|----|
| `ANTHROPIC_API_KEY` | Vercel, yalnız Production | Okuma. Yoksa durum "nokey": fotoğraf eklenir, okunmaz |
| `BLOB_READ_WRITE_TOKEN` | Vercel, yalnız Production | Özel Blob deposu (Storage › Blob › Private, fra1; projeye bağlayınca eklenir). Yeni bağlantı anahtar yerine `BLOB_STORE_ID` verirse o da yeter (OIDC). Vercel'de ikisi de yoksa fotoğraf düğmeleri görünmez |
| `PHOTO_DIR` | yalnız yerel | Fotoğraf klasörü (varsayılan `.data/photos`) |
| `AI_REPLAY` | yalnız `next dev` | `1`: kayıtlı yanıtlar (§ 8); canlıda hiçbir koşulda çalışmaz |

## 8. Yerel geliştirme ve deneme

- Anahtarsız: fotoğraflar `.data/photos`'a yazılır, okuma "bu ortamda kapalı".
- **Kayıtlı yanıtlarla:** `AI_REPLAY=1 npx next dev`. Okuma, canlıda alınmış beş yanıttan birini döner
  (`tests/fixtures/foto/`): tür ve fotoğrafın ölçüsüne göre seçilir; `docs/planlar/ekler/fotograf-eval/img/`'deki
  deneme görselleri (Z raporu, POS fişi, soluk market fişi, talimatlı fiş) gerçek bir okuma gibi davranır (POS fişini
  Z bölümüne çekmek yanlış belgeyi gösterir). `make-images.py`'nin yazarkasa Z'si (`yazarkasa-z.jpg`) ModPOS
  bölümünde sentetik bir yanıtla `fiscal_z_report` döner (**Banka POS Z bölümüne okut**). Banka POS Z bölümünün
  yanıtları sentetiktir (`tests/fixtures/foto/okc.json`, `okc-batch.json`, `okc-tek-oran.json`,
  `okc-yanlis-toplam.json`; son ikisi testlerde kullanılır; canlı değerlendirmede gerçekleriyle değişir): POS fişi
  görseli yalnız banka gün sonunu, ModPOS Z görseli **ModPOS bölümüne okut**'u, market ve talimatlı fiş görselleri
  yanlış belgeyi, öteki her görsel örnek yazarkasa Z'sini (`okc.json`) döner. Başka bir fotoğrafa türün olağan yanıtı
  döner.
- Gerçek okuma için anahtarı yalnız kabukta verin: `export ANTHROPIC_API_KEY=$(cat <anahtar dosyanız>)`. Depoya ya
  da `.env` dosyasına yazmayın, ekrana basmayın.
- **Testler** (`npm test`, ağ ve anahtar gerekmez): `tests/fotograf-okuma.test.ts` (okumaların forma gidecek hâli ve
  denetimleri, kayıtlı yanıtlarla), `tests/foto-altyapi.test.ts` (ölçü, depo sürücüleri, erişim, saklama, kaynak
  denetimleri), `tests/ai-istemci.test.ts` (isteğin biçimi, yanıt denetimi, hata kodları, tutar; yazarkasa Z'sinin
  efor, süre ve `max_tokens`'ı, ötekilerin değişmediği), `tests/okc-z.test.ts` (yazarkasa kimlikleri, okuma, doldurma
  kapısı).
- **Canlı değerlendirme** (para harcar, isteğe bağlı): istem, şema, küçültme ayarı ya da model değişince.

```bash
python3 -m pip install pillow numpy           # bir kez
python3 scripts/foto-eval/make-images.py      # deneme görselleri → .data/foto-eval/
FOTO_EVAL=1 ANTHROPIC_API_KEY=… npx tsx scripts/foto-eval/run.ts --max 4
npx tsx scripts/foto-eval/run.ts --kayitli    # ağsız, parasız: betiğin kendisini kayıtlı yanıtlarla sınar
```

`scripts/foto-eval/cases.json` on iki durumu ve beklenen değerlerini tutar: canlıda denenen dört görsel, POS fişinin Z
bölümüne okutulması, ödeme satırı yanlış basılmış Z, çok bulanık Z, kartla ödenmiş market fişi, e-Arşiv fatura,
tek fotoğrafta uzun Z raporu (ürün grupları, saatlik satış; rulo ~375 px eninde, § 3) ve yazarkasanın (banka POS) mali
Z'sinin iki kasa bölümüne okutulması (ikisinde de alan dolmaz; ModPOS bölümünde **Banka POS bölümüne okut**, Banka POS
bölümünde düğmesiz K.KARTI yönergesi). Betik her durum için belge türünü, doğru / yanlış alanları, işaretleri,
uyarıları ve okunmayan belgenin metnini, süreyi ve tutarı, sonunda toplamı yazar (veritabanı kullanmaz; tam çalışma
≈ 0,36 $). Lansmandan önce ve istem değişince bir kez tam çalıştırın (`--max` olmadan hepsi); yeni durum: görseli
`make-images.py`'nin sonuna (öncekilerin rastgele sırası değişmesin), beklentiyi `cases.json`'a ekleyin. `--kayitli`
yalnız betiği sınar: kayıtlı beş yanıt sonradan eklenen görselleri tanımaz, o durumlar türün olağan yanıtını alır
(dördü bu yüzden geçmez); yazarkasa Z'si sentetik yanıtla tanınır. Yazarkasa Z'si cümleleri (dalga 13 PR-a) canlıda
henüz denenmedi.

**Banka POS Z'sinin değerlendirmesi (yapılmadı; doldurma kapısı buna bağlı).** Yazarkasa Z'sinin istemi (`OKC_TASK`)
ve kimlikleri plandan ve araştırma notlarından yazıldı, kafenin gerçek fişleriyle hiç denenmedi. Plan
([planlar/okc-z.md](planlar/okc-z.md) §10, §17 b2 ve b8):

1. Sahipten 5–8 günün banka POS Z fotoğrafı (2–3'ü ardışık; biri uzun ve soluk; en az biri üst ve alt yarı olarak da),
   **asıl çözünürlükte** (WhatsApp'ın sıkıştırdığı resim değil: "belge" olarak, Drive ya da e-postayla) ve aynı
   günlerin kâğıttan doğru rakamları; cihazın markası ve modeli, Z'nin kim tarafından saat kaçta alındığı, ModPOS
   raporunun yazıcısı ([YAZARKASA-Z.md](YAZARKASA-Z.md) § 6). Fotoğraflar `tests/fixtures/okc-z/`'ye (kişisel veri
   yok; kasiyer adı ya da yüz varsa kırpılır, kırpılamıyorsa `.data/okc-z/`'de kalır), beklenen değerler kâğıttan
   `cases.json`'a.
2. Betik `scripts/okc-eval/run.ts` (henüz yazılmadı): canlıyla aynı yol (`runExtraction` → `normalizeOkc` →
   `prefillPlan`), `FOTO_EVAL=1 ANTHROPIC_API_KEY=… npx tsx scripts/okc-eval/run.ts --effort low --girdi tek --tekrar 3`;
   `--effort medium`, `--girdi yarilar` (üst + alt yarı), `--say-token` (ücretsiz `count_tokens`), `--kayitli` (ağsız).
   Her alan için doğru dolar / yanlış dolar / **doğrulandı ama yanlış** / öneri / boş; süre p50 / p90, token, tutar.
3. Kapı: gerçek fotoğraflarda `--tekrar 3` ile **yanlış dolum 0**, **"doğrulandı ama yanlış" 0**, alan doğruluğu ≥ %95,
   ilk okuma p90 ≤ 20 sn. Sonuç `docs/planlar/ekler/okc-z/eval.md`'ye; geçerse `OKC_PREFILL_ENABLED = true`, okuma
   süresi metni ölçülen p50'yle, kalite ve çekim kararı (§ 3) ölçümle.

## 9. Yeni bir fotoğraf türü

1. `src/lib/photo-rules.ts`: `PhotoKind`, `PHOTO_KINDS`, `KEEP_DAYS`, `PHOTO_KIND_LABEL`.
2. `src/server/storage/photo-access.ts` › `PHOTO_RULES`: personelin görme kuralı (`canView`) ve saklama (`keepDays`).
3. Yükleme kuralı (`src/server/photo-read/rules.ts` › `canUploadPhoto`) ya da türün kendi yolu.
4. Fotoğrafı kullanan kayıt kendi işleminde `keepPhoto(id, keepUntil(kind, gün), tx)` ile bağlar; kayıt silinince
   `releasePhoto`. Bağlanmayan fotoğraf 2 günde kendiliğinden silinir.

Örnek: `kasa-okc` (banka POS Z'si, dalga 13). `KEEP_DAYS["kasa-okc"] = 400`, `PHOTO_KIND_LABEL` "Banka POS Z";
`PHOTO_RULES["kasa-okc"]` = `okcPhotoRules` (görme kuralı kasa raporununki, saklama kendi `KEEP_DAYS`'i);
`src/app/api/foto/` ve `[id]/oku/` türü kabul eder, okuma `readPhotoFor("kasa-okc")` (`OKC_TASK`, `KasaOkcRaw`,
`normalizeOkc`); kasa raporu, geç rapor ve fotoğraf kaldırma isteği türü tanır; `ai_calls.feature` `kasa-okc`. Okumanın
kendi şeması olduğu için eski türün (`kasa-pos`) şeması değişmedi: eski `ai_calls.result`'lar `KasaPosRaw` ile
ayrıştırılmaya devam eder (aynı türe yeni şema verilseydi eski okumalar sessizce kaybolurdu).

**`kasa-pos` geçişi** (plan D2): yeni sayfa `kasa-pos` göndermez. Yayın günü açık kalan eski sayfaların `tur=kasa-pos`
yüklemesi ve yeniden okuması reddedilmez: fotoğraf `kasa-okc` olur, `OKC_TASK` ile okunur, `ai_calls`'a `kasa-okc`
yazılır ve eski sayfaya **eski biçimde** yanıt döner (`kind: "kasa-pos"`, değerlerde yalnız banka gün sonu fişinden
okunan `bankPos`, doldurma kapısı kapalıyken düşük güvenle öneri; fişte banka gün sonu yoksa PR-a'nın K.KARTI yönergesi;
yazarkasa Z'sinin toplamı ya da kartı asla; `okcToLegacyPos`). Eski `kasa-pos` fotoğrafları ve okumaları gösterilmeye
devam eder. Yüklemenin ve yeniden okumanın kaldırılması ayrı küçük bir PR'dır (en erken iki hafta sonra; bekleyen geç
raporlarda `kasa-pos` kalmadığı denetlenerek).

## 10. Dosyalar

| Dosya | İçerik |
|-------|--------|
| `src/lib/photo-rules.ts` | türler, sınırlar, ölçü (yalnız başlıktan), saklama, kim görür (ilk adımlar), yükleme hata metinleri |
| `src/lib/photo-compress.ts` | telefonda küçültme |
| `src/lib/photo-read/` | şemalar, istemler, API şeması, ModPOS Z / banka POS Z (`okc.ts`) / fiş okumasının kontrolü ve forma planı, "fotoğraftan farklı" |
| `src/lib/okc-z.ts` | banka POS Z'sinin kimlikleri, doldurma kapısı (`OKC_PREFILL_ENABLED`), karşılaştırmalar ([YAZARKASA-Z.md](YAZARKASA-Z.md)) |
| `src/lib/cash-outs.ts` | kasadan çıkanların adları, raporun notu, uyarı, personelin kuralları |
| `src/server/storage/` | depo sürücüleri (Blob, dosya, bellek), kayıtlar, erişim kayıt defteri |
| `src/server/ai/` | Claude: istek ve hata kodları (`run.ts`), kapılar ve günlük (`claude.ts`), tutar (`pricing.ts`), kayıtlı yanıtlar (`replay.ts`) |
| `src/server/photo-read/` | fotoğrafı okuyup forma hazırlama, ekleme kuralları |
| `src/app/api/foto/` | yükleme + okuma (`POST /api/foto`), fotoğraf (`GET /api/foto/{id}`), yeniden okuma (`POST /api/foto/{id}/oku`) |
| `src/components/panel/photo-picker.tsx`, `photo-viewer.tsx` | fotoğraf düğmeleri, durum satırı, küçük resim, büyütme |
| `src/app/panel/kasa/cash-form.tsx`, `okc-card.tsx`, `cash-photos.tsx`, `cash-outs.tsx`, `cash-out-dialog.tsx` | ekranlar |
| `src/app/panel/ayarlar/photo-card.tsx` | Ayarlar › Fotoğraftan okuma |
| `src/app/api/kontrol/foto/`, `src/app/panel/kontrol/[id]/photo-item.tsx`, `src/server/data/checklists.ts` (`kontrolPhotoRules`) | kontrol listesinin fotoğraflı maddesi: yükleme ve yanıt tek istekte, kim görür ([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md)) |
| `scripts/foto-eval/` | canlı değerlendirme (`scripts/okc-eval/` banka POS Z'si için, henüz yazılmadı; § 8) |

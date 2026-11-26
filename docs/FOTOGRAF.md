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
| Kasa raporu › Yazarkasa Z raporu | Yazarkasanın (banka POS) mali Z raporu; uzunsa üst ve alt yarı ayrı (bölümde en çok 3) | Günlük toplam, Z no, nakit, kredi kartı; Ayrıntılar'da yemek kartı, diğer, toplam KDV, oran oran KDV dökümü (%1, %10, %20), fiş sayısı; aynı şeritte basılıysa banka gün sonu. **Bugün hepsi öneri** (§ 2) |
| Kasa raporu › Yazarkasa Z raporu | Bankanın ayrı gün sonu fişi (yedek) | Yalnız Banka gün sonu (net toplam; iki fişte "Toplama ekle"); yazarkasa alanları boş kalır |
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
  `x_report`, `period_report`, `batch_slip` (yalnız banka gün sonu), `software_z` (ModPOS'un ya da LafPOS'un raporu),
  `other`. Ayırt eden işaretler: MF logosu ve sicil no ile birlikte EKÜ NO ya da KÜM. satırları, VERGİ DÖKÜMÜ ve TOPKDV;
  **Z NO tek başına mali işaret değildir** (ModPOS'un Z'si de kendi Z no'sunu basar; 24 Kasım 2026). BİLGİ FİŞİ / MALİ
  DEĞERİ YOKTUR basan ModPOS raporu mali değildir. Fiş yerine Z raporu çekilirse söylenir.
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

- **Önce ucuz model, gerekirse bir kez güçlü model** (25 Kasım 2026; sahibin isteği: "rapor ve z raporlarını ai okusun ama
  ucuz model ile okut"; `src/lib/photo-read/cheap-first.ts`). ModPOS Z'si, elle girilen raporun yazarkasa Z'si ve kasadan
  çıkan fiş önce ucuz modelle (Ayarlar › `photoModels.cheap`, varsayılan Claude Haiku 5.5; aynı istem ve şema, tek 15 sn'lik
  deneme) okunur. Okunuş eksik ya da kendi içinde tutarsızsa güçlü model (varsayılan Claude Opus 5.5, 35 sn) bir kez
  yeniden okur: Z'de belge türü, toplam, Z no, ödeme satırı yok / okunamadı, tanınmayan ödeme, ödemelerin toplamı Z
  toplamını da Z toplamı − ödenmezi de tutmuyor, toplamda ya da ödemede orta / düşük güven (`zReadProblems`); yazarkasa
  Z'sinde LafPOS gününün kuralı (`cheapReadingProblems`); fişte belge türü, toplam yok ya da güveni yüksek değil, kalemler
  ya da KDV satırları toplamı tutmuyor (`receiptReadProblems`). Ucuz model ret / yarım / şema dışı yanıt, zaman aşımı ya
  da yoğunlukla dönerse güçlü model bir kez denenir; kapılar (anahtar, kapalı, sınır, fotoğraf başına 3 okuma) güçlü
  modeli de kapatır. Güçlü okuma düşerse ucuz okunuş kalır; formdaki denetimler ve renkler aynıdır. Çoğu net fiş tek ucuz
  çağrıyla biter: görselin tokenı Haiku'da Opus'un kırkta biri. LafPOS gününün gün sonu fotoğrafının kendi sırası var
  (aşağıda; yapay zekâ yoksa kod da okur). Aşağıdaki "Model `claude-opus-5-5`" maddesi güçlü modelin isteğidir.
- **Faturanın günlük sınırı ayrı** (25 Kasım 2026): faturadan paket boyu okuma (Hammaddeler › fiyat onayı, Paraşüt › ürün
  bağlama) aynı istemciyi ve kapıları kullanır ama kendi günlük havuzu vardır (sayı Ayarlar'daki sınır) ve başka modelle
  okur: `claude-haiku-5-5`, PDF belge, yedek model yok ([FATURA-OKUMA.md](FATURA-OKUMA.md)). Eskiden sınır ortaktı:
  gündüz okunan faturalar sınırı doldurunca akşamki Z fotoğrafı yapay zekâyla okunamıyordu.
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
- **Kapılar:** anahtar (`ANTHROPIC_API_KEY`), Ayarlar › Fotoğraftan okuma'daki anahtar, günlük sınır (varsayılan 40,
  yalnız fotoğraf okumaları sayılır; dolunca fotoğraf yine eklenir), fotoğraf başına 3 okuma (ucuz + güçlü iki sayılır). Vardiya'daki yazarak doldurma aynı anahtarı ve aynı aç / kapa
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

### LafPOS gününün fotoğrafı: önce ucuz model, gerekirse güçlü, yapay zekâ yoksa kod (24 Kasım 2026)

Sahibin isteği: "AI kullanarak okursa çok iyi olur ama fazla token harcamayan ve sonuç verecek şekilde olsun; eğer AI
token biterse de kod ile bir şey yaz". LafPOS gününün gün sonu fotoğrafı (Pavo'nun detaylı Z'si; Marina, geçiş gününden
sonra, LafPOS'un gün sonu gelmiş gün) başka sırayla okunur (`src/server/photo-read/lafpos.ts`, sıra
`src/lib/photo-read/lafpos-read.ts`); Tuzla / ModPOS günleri, ModPOS Z'si ve fişler değişmedi (Opus 5.5, eskisi gibi).

1. **Kayıtlı okunuş yeniden kullanılır:** fotoğrafın `ai_calls`'ta başarılı okunuşu varsa (Yeniden dene, öteki bölüm,
   ikinci istek) yeni çağrı yapılmaz. Güçlü model bir fotoğraf için bir kez denenir.
2. **Ucuz model** (`PHOTO_CHEAP_MODEL` = `claude-haiku-5-5`): kısa istem (`OKC_SHORT_TASK`), aynı şema (`KasaOkcRaw`;
   karmaşıklık sınırını aştığı için şema metinde, `JSON_REPLY`), efor `low`, tek 15 sn'lik deneme.
3. **Güçlü model bir kez** (`PHOTO_STRONG_MODEL` = `claude-opus-5-5`, uzun istem `OKC_TASK`, 25 sn) yalnız ucuz okunuş
   eksik ya da kendi içinde tutarsızsa (`cheapReadingProblems`: belge türü, toplam yok, Z no yok, ödeme satırı yok,
   Σ ödemeler ≠ toplam, Σ KDV grupları ≠ toplam, Pavo'nun sonucu geldiyse batch yok, satış − iade ≠ net, düşük güven) ya da
   LafPOS'un rakamlarından farklıysa (aynı karşılaştırma "fark" diyorsa): yanlış bir "fark" yöneticiye gitmeden ikinci kez
   bakılır. Güçlü okuma düşerse ucuz okunuş kalır. Ucuz model yanıt verip okunuş vermediyse (ret, yarım, şema dışı) de
   önce güçlü model denenir. **Karşılaştırma sonradan değişirse de** (son denetim, 24 Kasım 2026): fotoğraf Pavo'nun
   sonucu gelmeden eklendiyse ucuz okunuş o anki rakamlarla karşılaştırılmıştır; LafPOS günü Pavo'nun sonucuyla yeniden
   gönderince karşılaştırma kayıtlı okunuşla yeniden kurulur. Otomatik raporun karşılaştırması "fark" ya da "okunamadı"
   olduysa, okunuşu ucuz modelden gelen ve güçlü modelin hiç denenmediği fotoğraf gün sonu e-postalarından önce bir kez
   güçlü modelle okunur (`strongRecheckDayPhotos`, gün sonu otomasyonunda `after()` içinde; süre yetmezse günlük iş),
   karşılaştırma yenilenir, zil ve e-posta yenisini görür. **"Uyumlu" da sessiz kalabilir:** ucuz okuma Pavo'nun detaylı
   Z'sini yalnız banka gün sonu fişi okuduysa Z no hiç okunmaz. Banka fişi okunuşunda Z'nin izi varsa (Z no, günün
   toplamı, nakit / kart / yemek kartı / diğer satırı, KDV ya da başlıkta Z / DETAYLI; LafPOS'un kâğıdı değilse;
   `slipWithZTraces`, sorun "Z izi") güçlü model yüklenirken bir kez okur; eski okunuşlarda gün sonu otomasyonu "uyumlu"
   günde de yalnız o fotoğrafa bakar. Yalnız banka gün sonu olan kâğıt (LafPOS'un kör kâğıdı, Pavo'nun fişi) için güçlü
   model çağrılmaz.
4. **Kodla okuma:** yapay zekâ yoksa ya da yanıt vermiyorsa (anahtar yok, Ayarlar'da kapalı, günlük sınır, fotoğraf başına
   3 okuma, kredi bitti, anahtar geçersiz, yoğunluk, zaman aşımı, bağlantı, reddedilen istek, büyük dosya) fotoğraf panelde
   yerel OCR'la okunur (`src/server/photo-read/ocr.ts`, tesseract.js 7, WebAssembly; en çok 15 sn) ve Pavo fişinin kural
   tabanlı ayrıştırıcısı (`src/lib/photo-read/pavo-ocr.ts`) rakamları yapay zekânın şemasıyla çıkarır: TOPLAM / NET SATIŞ,
   NAKİT, KREDİ KARTI / K.KARTI / KART, YEMEK KARTI (Multinet, Sodexo…), KDV satırları (%oran TOPLAM / KDV, TOPKDV), Z NO /
   Z SAYAÇ, BATCH / GRUP NO, banka adı, SATIŞ / İADE / NET TOPLAM; Türkçe tutar biçimi (1.234,56; `*` ve TL atılır);
   KÜM. satırları alınmaz. Fotoğraf Anthropic'e gitmez (Ayarlar'da okuma kapalıyken de kodla okunur). Okunuş `ai_calls`'a
   `model = 'kod-ocr'`, tutar 0 ile yazılır; günlük sınıra, fotoğraf başına 3 okumaya ve Ayarlar kartının okuma sayısına
   sayılmaz. OCR da çalışmazsa okunuş yok (rakam uydurulmaz), karşılaştırma "okunamadı — yönetici baksın".

**Güven kuralı (kod):** OCR'ın sözcük güveni 80'in altındaysa, tutar Türkçe biçimde değilse ya da etiketi seçilmiyorsa
o rakam "low"dur; kendi içinde tutmayan satırlar (Σ ödemeler ≠ toplam, KDV oranı tutmuyor, Σ KDV ≠ toplam / TOPKDV,
satış − iade ≠ net) hep birlikte "low" olur. Karşılaştırma kodla okunan "low" rakamı okunmamış sayar: "uyumlu" / "fark"
yalnız her karşılaştırılan satır yüksek güvenle okunduysa ve en az bir tutar (Banka POS ya da yazarkasa toplamı, batch)
karşılaştırıldıysa; değilse durum **"okunamadı — yönetici baksın"** (`belirsiz`). Personel için iş bitmiştir ("Fotoğraf
alındı"; yeniden çekmesi istenmez), yönetici zilde, e-postada ve ay satırında ("Gün sonu fotoğrafına bakın") görür.
Yöneticinin kartı ve e-posta okuyanı yazar: "Yapay zekâ (Claude Haiku 5.5)" ya da "Kodla okundu". Nedeni de doğru yazılır
(`photoUnsureText`): bir satır okunup güvenle seçilmediyse "Yapay zekâ kullanılamadı; fotoğraf kodla okundu ama bir satır
güvenle seçilmedi", OCR düştüyse (hata, süre) ya da fişte hiçbir şey seçilmediyse "Yapay zekâ kullanılamadı ve fotoğraf
kodla da okunamadı".

Kodla okunan fişte hiçbir rakam tahminle doldurulmaz:
- Batch'in tutarı NET'tir; NET basılmadıysa satış − iade. NET ya da İADE basılmış ama güvenle okunmamışsa satıştan tutar
  hesaplanmaz (iade 0 sayılmaz): batch'in tutarı ve Banka POS toplamı "okunamadı", "Banka POS'a yaz" önerisi yok.
- Ödeme satırı (nakit, kart, yemek kartı, diğer) tanınmadıysa 0 sayılmaz (OCR etiketi kaçırmış olabilir): LafPOS'ta da 0
  ise tutar (cihaz sıfır satırını basmaz), değilse "okunamadı". Yapay zekâ okunuşunda basılmayan satır 0 sayılmaya devam
  eder.

**LafPOS'un kendi gün sonu kâğıdı** (24 Kasım 2026, Marina: fotoğraf "Z raporu" olarak tanınmadı). LafPOS kapanışta fiş
yazıcısından kâğıt basar (LafPOS `src/lib/print.tsx`). Kasanın rakamlarını gören basınca önce LafPOS'un yönetim raporu
("GÜN SONU · Z 31", NET CİRO, ödemeler, KDV, altında "LafPOS yönetim raporudur, mali Z değildir"), ardından Pavo'nun banka
gün sonu ("BANKA GÜN SONU · PAVO": Batch, Bankalar, TOPLAM, "PAVO - LAFPOS KARŞILAŞTIRMA"); kör kasada yalnız banka kısmı.
Mali değildir: Z no'su LafPOS'un kendi sayacıdır. Pavo ayrı mali Z basmaz (LafPOS'ta `zReport: false`), detaylı Z'yi
yalnız cihazdan istenince basar.
- İstemler (`OKC_TASK`, `OKC_SHORT_TASK`) kâğıdı tanıtır: başlık aynen, banka kısmı varsa `batch_slip` yoksa
  `software_z`; Z no, NET CİRO, ödeme ve KDV okunmaz; Bankalar altındaki her satır aynı batch'in bir bankası. Yeni şema
  değeri yok (eski `ai_calls` satırları aynı yoldan geçer).
- Kod modelin kararına güvenmez (`okcPaperView`, `isLafposPaper`): başlık "GÜN SONU · Z n" ya da "BANKA GÜN SONU · PAVO"
  ise (ya da mali işareti olmayan kâğıtta toplamın etiketi NET CİRO ise) model `z_report` dese de banka gün sonu fişi
  sayılır; Z no'su ve rakamları forma, karşılaştırmaya ve `okc_z_no`'ya hiç gitmez (`zNoFromPhoto` olmaz). Banka kısmı
  okunmuş yazılım Z'si de banka gün sonu fişidir. Banka kısmı yoksa yanlış belgedir: Pavo gününde "Bu LafPOS'un kendi gün
  sonu raporu; rakamları panele kendiliğinden gelir. Pavo'nun gün sonu fişinin (detaylı Z) fotoğrafını çekin."
- Yalnız banka gün sonu okunduysa Pavo gününde "Z değil, yazarkasanın Z raporunu da çekin" denmez: "Banka gün sonu okundu;
  yazarkasa rakamları LafPOS'tan gelir." (ayrı mali Z basan cihazda ya da cihaz bilinmiyorsa eski yönerge kalır).
  Yöneticinin karşılaştırmasında Pavo gününde fotoğrafta Z yoksa bilgi satırı çıkar ("Pavo detaylı Z: fotoğrafta yok ·
  LafPOS'ta Z rakamları geldi"); fark değildir, alarm e-postası gitmez.
- Kodla okuma kâğıdı işaretlerinden tanır ("mali Z değildir", "BANKA GÜN SONU · PAVO", "PAVO - LAFPOS KARŞILAŞTIRMA"…):
  Z kısmı okunmaz, banka satırları batch olur (toplamı TOPLAM'ı tutmuyorsa hepsi şüpheli), karşılaştırma satırları atılır.
- Her okuma tek günlük satırı bırakır: `[foto] okuma {photoId, kind, steps, model, documentType, ok}` (rakam ve görsel
  yok).

**Elle girilen raporun formu** (LafPOS gününde Düzenle, yazarkasa bölümü) aynı okuma yolunu kullanır, alanları yalnız yapay
zekâ okunuşu doldurur (`formFailureOf`). Kodla okunduysa ya da hiç okunamadıysa form yapay zekânın hatasını eskisi gibi
gösterir ("Fotoğraftan okuma kapalı; rakamları elle yazın.", gerekirse "Yeniden dene"); OCR'ın rakamları kaynağı görünmeden
forma yazılmaz, kod okunuşu yine yöneticinin karşılaştırmasına gider.

**Modeller ayardan** (`integration_state` › `ai.settings` › `photoModels: { cheap, strong }`; `photoModelsOf`): yalnız
`claude-haiku-5-5` ve `claude-opus-5-5` kabul edilir, eksik ya da bilinmeyen değer sabite döner. Ayarlar kartı hangi
modellerin okuduğunu yazar; değiştirme ekranı yok (kayıt elle). Aç / kapat ve günlük sınır kaydı modelleri silmez.

**Görsel küçültülmez:** telefon fotoğrafı zaten en çok 2576 px JPEG'e küçültür (modellerin en yüksek çözünürlüğü);
termal fişin rakamları bu çözünürlüğe ihtiyaç duyar, sunucu görseli hiç çözmez (sıkıştırma bombasına karşı). Tasarruf
modelden gelir: Haiku 5.5 girdi 0,10 $/M (Opus 5.5 4 $/M); görsel ~4.800 token ≈ 0,0005 $, ucuz okuma toplam ~0,001 $.
Tahmin (ölçülmedi): çoğu gün yalnız ucuz okuma; fark ya da tutarsızlıkta Opus da (~0,04 $).

**Çalışma ortamı ve boyut:** OCR Vercel işlevinde (Node 24) çalışır; dil verisi pakette (`@tesseract.js-data/tur`
› `4.0.0_best_int/tur.traineddata.gz`, 2,1 MB), çekirdekten yalnız LSTM'li üç sürüm (~9 MB, işlemciye göre biri), ağ
yok, diske yazmaz (`cacheMethod: "none"`). `next.config.ts`: `serverExternalPackages: ["tesseract.js",
"tesseract.js-core"]` (işçisini kendi dosyasından açar) ve fotoğrafı okuyan iki yola `outputFileTracingIncludes`. Yerel
`npx next build` bu dosyaların işleve girdiğini gösterir; canlıda ilk kodla okumada sunucu günlüğü "[foto] kodla okuma"
yazmıyorsa çalışıyor demektir. node_modules'a ~55 MB eklenir (işleve giden ~12 MB).

Testler: `tests/gun-sonu-foto.test.ts` (modeller, ucuz okumanın denetimi, sıra ve her hata türünde koda düşme, ayrıştırıcı,
güven kuralı, fotoğraf e-postası), `tests/gun-sonu-foto-ocr.test.ts` (testte çizilen sentetik Pavo fişi gerçek OCR'la,
ağsız), `tests/gun-sonu-foto-eposta.test.ts`, `tests/gun-sonu-foto-db.test.ts` (sahte istemciyle Haiku → Opus, tutarlar,
yeniden okumama, anahtarsız OCR, e-posta, Pavo'nun sonucu sonradan gelince güçlü modelin bir kez bakması).

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
| `ANTHROPIC_API_KEY` | Vercel, yalnız Production | Okuma. Yoksa durum "nokey": fotoğraf eklenir; LafPOS gününün gün sonu fotoğrafı kodla (OCR) okunur, öteki fotoğraflar okunmaz |
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

### Tarayıcının ölçümü

Belge tarayıcının çekirdeği (`src/lib/scan`) telefonla çekilmiş gibi üretilen sentetik fotoğraflarla ölçülür: köşeler
ve kâğıttaki yazı bilindiği için hata kesin hesaplanır. Ağ, anahtar ve veritabanı gerekmez; görsel çözme sharp ile
(next'in isteğe bağlı bağımlılığı; yalnız betikler ve test), kâğıtlar Playwright ile çizilir.

```bash
npm run tarama:veri                         # 96 görsel → .data/tarama-veri/ (depoya girmez; tohumlu, ~8 dk)
npm run tarama:olc                          # köşe, karar, süre, okunabilirlik (OCR) → tablolar + .data/tarama-olcum/son.json
npm run tarama:olc -- --ocr 0               # okunabilirliksiz, hızlı (köşe, karar, süre)
npm run tarama:olc -- --ideal --cizim       # doğru köşelerle taramanın okunabilirliği; köşeleri çizili küçük resimler
npm run tarama:olc -- --ocr 0 --karsilastir .data/tarama-olcum/temel.json   # çekirdek değişince öncekiyle fark
npx tsx --test tests/tarama-regresyon.test.ts   # 10 küçük örnek (tests/fixtures/tarama), bugünkü sonuçla
```

- **Veri** (`scripts/tarama-veri.ts`, `scripts/tarama/kagit.ts`, `sahne.ts`): Pavo detaylı Z, LafPOS/Pavo gün sonu,
  ModPOS Z, banka batch fişi, market fişi (80 mm, 58 mm, uzun rulo) ve A4 e-Arşiv fatura HTML'den çizilir (termal
  kâğıt, soluk baskı; içerik uydurma). Kâğıt 3B bir ızgara olarak zemine bindirilir: ahşap, mermer, koyu tezgâh, beyaz
  tezgâh, gri masa, elde tutulmuş (bulanık oda, başparmak); perspektif, döndürme, yana dönük fiş, kıvrılma / bükülme,
  kıvrık köşe, kâğıdın gölgesi, gölge degradesi, el gölgesi, renkli ışık, parlama, karanlık, hareket ve odak
  bulanıklığı, gürültü, JPEG %55–92. Ayrıca kareyi dolduran yakın çekim, bir ucu kadraj dışında kalan kâğıt ve belge
  olmayan fotoğraflar (POS ekranı, ekranda tablo, telefon, koli, fincan, paketler). Doğru köşe kâğıdın köşesidir:
  kıvrık köşede katlanmamış köşe (kenarların kesiştiği yer), kadraj dışında kâğıdın kenarının karenin kenarını
  kestiği yer, yakın çekimde görüntünün köşeleri. `yanit.json`: köşeler, beklenen sonuç (kırp / kareyi dolduruyor /
  belge değil), kategori, zemin, senaryolar, bilinen metin.
- **Yöntem** (`scripts/tarama-olc.ts`): her görsel `scanDocument`'tan geçer. Köşe hatası en kötü köşenin uzaklığı /
  köşegen (kırpılmayan görselde görüntünün köşeleriyle, kaçan belgenin hatası da sayılır); başarı < %2. Karar:
  kırptı / kareyi dolduruyor / belge yok → doğru, kaçan, yanlış (belge olmayanı kırpmak yanlış pozitif).
  Okunabilirlik: tesseract.js (kodla okumanın ayarı, Türkçe) ile asıl fotoğrafın ve taranmış hâlin bilinen metne
  karakter doğruluğu (1 − düzenleme uzaklığı / uzunluk) ve tutarların (1.234,56) aynen bulunma oranı. Kategori,
  zemin, durum ve senaryo kırılımı, karar matrisi, güven eşiği (düşük güvenli kırpma "emin değil" sayılsa ne
  kazanılır, ne kaybedilir), en kötü 10 görsel; `son.json`'da her görselin bulunan köşeleri de.
- **Temel ölçüm** (26 Kasım 2026; çekirdek `0096e18`, `wip/tarama-cekirdek`; 96 görsel, tohum 2026): kırpılması
  gereken 76 görselde köşe başarısı **41/76 (%54)**, kaçan 10, yanlış dörtgen 25; köşe hatası ort %8,1, p90 %27,6.
  Kareyi dolduran 8 görselin 8'i kırpılmadı (6'sında "kareyi dolduruyor", 2'sinde "belge yok"), ama açık zeminde duran
  5 fişte de yanlışlıkla "kareyi dolduruyor" dendi. Belge olmayan 12 görselin 3'ünde "belge yok", 9'u kırpıldı (yanlış
  pozitif; seçilen dörtgen açık renkli ve yazılı: POS ekranındaki adisyon paneli, ekrandaki tablo, kolideki etiket).
  Kadraj dışı 8 görselin 0'ı doğru (hata ort %9,8: kareye dayanan kenar görüntünün içine alınıyor, yazının içinden
  geçiyor). Süre ort 5,3 sn, p90 8,1 sn, algılama ort 2,8 sn (1500×2000; yük ortalaması ~30 olan 4 çekirdekli makine,
  yükü azken 3,1 sn). Okunabilirlik (84 belge): karakter doğruluğu asıl %40 → taranmış %64 (doğru köşelerle %71),
  tutarların aynen bulunması %23 → %53. Önceki çekirdeğe (`ac82331`) göre: belge değil 1/12 → 3/12 (kâğıda
  benzemeyen dikdörtgen), banka batch 5/9 → 4/9, mermer 7/18 → 8/18; köşe başarısı 42 → 41.

  | Kategori | doğru | köşe hatası ort | OCR asıl → taranmış (doğru köşelerle) | tutar asıl → taranmış |
  |---|---:|---:|---:|---:|
  | Pavo detaylı Z | 6/12 | %9,9 | %42 → %57 (%65) | %19 → %50 |
  | Pavo / LafPOS gün sonu | 5/11 | %8,7 | %46 → %77 (%90) | %28 → %64 |
  | ModPOS Z | 8/11 | %2,2 | %56 → %85 (%84) | %26 → %68 |
  | Banka batch (58 mm) | 4/9 | %5,6 | %56 → %90 (%96) | %25 → %78 |
  | Market fişi (80 mm) | 6/9 | %6,0 | %42 → %68 (%81) | %27 → %68 |
  | Market fişi (58 mm) | 8/8 | %0,5 | %36 → %75 (%74) | %16 → %56 |
  | Uzun market fişi | 4/12 | %16,0 | %32 → %52 (%57) | %25 → %38 |
  | A4 e-Arşiv fatura | 8/12 | %6,2 | %17 → %20 (%21) | %17 → %17 |
  | Belge değil | 3/12 | – | – | – |

  Zemine göre doğru: ahşap 13/18, elde 9/12, gri masa 11/16, koyu tezgâh 8/14, mermer 8/18, **beyaz tezgâh 3/18**.
  En zayıflar: beyaz / açık zeminde fiş (kâğıt bulunamıyor, kâğıt kareyi dolduruyor sanılıyor ya da iki kenar karenin
  kenarına uzatılıyor), uzun fiş, kadraj dışı ve belge olmayan fotoğraflar; senaryolardan hareket bulanıklığı (6/14),
  soluk baskı (9/19) ve gölge degradesi (14/32). Güven yanlışı ayırmıyor: kırpılanlarda güven < 0,5 "emin değil"
  sayılsa 9 yanlış pozitiften 3'ü, 25 yanlış dörtgenden 5'i yakalanır, 41 doğru kırpmadan 5'i kaybedilir (doğru
  kırpmaların 4'ü nedensiz 0,27–0,29 güvenli; rapordaki "Güven eşiği" tablosu). A4'ün okunabilirliği düşük:
  1500×2000 fotoğrafta yazı ~10 px, kodla okuma zorlanıyor (yapay zekâ okur; tarayıcının değil ölçeğin sınırı). Yana
  dönük fişin yazısı çevrilmediği için okunmuyor.
- **Regresyon:** `tests/tarama-regresyon.test.ts` on küçük örnekte (540×720, `npm run tarama:veri -- --fixture` ile
  yeniden üretilir; tohumlu, aynı baytlar) kararı ve köşe hatasını bugünkünün biraz gevşeğiyle sınar (doğru olanlarda
  en kötü köşe ≤ %1,2–1,5; bugün, çekirdek `0096e18`'de de, 10'un 6'sı doğru). Bilinen yanlışlar (beyaz tezgâhta uzun fiş, karanlık ve bulanık
  A4, POS ekranı, koli) yalnız kötüleşmesin diye gevşek; çekirdek iyileşince `BEKLENTI` ve `EN_AZ_DOGRU`
  sıkılaştırılır.
- **Çekirdek değişince:** `npm run tarama:olc -- --ocr 0 --karsilastir .data/tarama-olcum/temel.json` (temel:
  bir önceki `son.json`'ın kopyası) kategori başına doğru ve hatayı, sonucu değişen görselleri yazar; okunabilirlik
  için `--ocr` açık (96 görselde ~15–50 dk, makinenin yüküne göre).

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
| `src/server/photo-read/` | fotoğrafı okuyup forma hazırlama, ekleme kuralları; LafPOS gününün ekonomik okunuşu (`lafpos.ts`) ve kodla okuma (`ocr.ts`) |
| `src/lib/photo-read/models.ts`, `lafpos-read.ts`, `pavo-ocr.ts` | okuma modelleri (ayardan), okuma sırası ve ucuz okunuşun denetimi, Pavo fişinin kural tabanlı ayrıştırıcısı |
| `src/app/api/foto/` | yükleme + okuma (`POST /api/foto`), fotoğraf (`GET /api/foto/{id}`), yeniden okuma (`POST /api/foto/{id}/oku`) |
| `src/components/panel/photo-picker.tsx`, `photo-viewer.tsx` | fotoğraf düğmeleri, durum satırı, küçük resim, büyütme |
| `src/app/panel/kasa/cash-form.tsx`, `okc-card.tsx`, `cash-photos.tsx`, `cash-outs.tsx`, `cash-out-dialog.tsx` | ekranlar |
| `src/app/panel/ayarlar/photo-card.tsx` | Ayarlar › Fotoğraftan okuma |
| `src/app/api/kontrol/foto/`, `src/app/panel/kontrol/[id]/photo-item.tsx`, `src/server/data/checklists.ts` (`kontrolPhotoRules`) | kontrol listesinin fotoğraflı maddesi: yükleme ve yanıt tek istekte, kim görür ([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md)) |
| `scripts/foto-eval/` | canlı değerlendirme (`scripts/okc-eval/` banka POS Z'si için, henüz yazılmadı; § 8) |
| `scripts/tarama-veri.ts`, `scripts/tarama-olc.ts`, `scripts/tarama/`, `tests/tarama-regresyon.test.ts` | belge tarayıcının ölçümü: sentetik veri seti, ölçüm, regresyon örnekleri (§ 8 › Tarayıcının ölçümü) |
| `src/lib/scan/` | belge tarayıcı çekirdeği (§ 11): algılama, köşe oturtma, perspektif, taranmış görünüm |
| `scripts/tarama-dene.ts` | tarayıcıyı gerçek fotoğrafla ya da sentetik sahneyle deneme (§ 11) |

## 11. Belge tarama (çekirdek)

Z raporu (dar, uzun termal rulo), banka gün sonu fişi, alışveriş fişi ve fatura fotoğrafı yüklenmeden önce **telefonda,
tarayıcıda** taranır: kâğıt bulunur, kenarları belli edilir, perspektif düzeltilir ve CamScanner tarzı siyah-beyaz
"taranmış" görünüm üretilir; sonra `photo-compress.ts` ile küçültülüp `POST /api/foto`'ya gider. Sunucu görseli
çözmez (güvenlik kararı), Python / OpenCV yok: `src/lib/scan/` dış bağımlılıksız saf TypeScript, DOM'a dokunmaz
(görüntü `{ width, height, data: Uint8ClampedArray RGBA }`, canvas `ImageData` ile aynı); Node'da test edilir, telefonda
bir Web Worker'da çalıştırılması önerilir (eşzamanlı; `ImageData.data.buffer` aktarılır). Arayüz bağlantısı henüz yok.

- **Algılama** (`detect.ts`, 640 px kopyada, son ince ayar 1000 px): üç yöntem aday dörtgen üretir, hepsi aynı puanla
  karşılaştırılır. *Kâğıt bölütleme* (aydınlık − doygunluk haritası, gölge çıkarılmış yerel hâli, Otsu, morfoloji, dış
  hat, zarftan dörtgen, kenarlara RANSAC); *kenar* (Canny, eşikler görüntüden; yönlü Hough; görüntünün kenarı da doğru
  sayılır); *yazıdan başlama* (yoğun yazı bölgesi dışarı doğru en yakın kâğıt kenarına büyütülür: açık tezgâhta beyaz
  fiş). Puan: her kenarın gradyan desteği ve içi / dışı basamağı (işaret tutarlı), alan, açılar, kâğıtlık karşıtlığı,
  yazıyı kesiyor mu, içerisi kâğıda benziyor mu (koyu ya da çok renkli, yazısız dikdörtgen — telefon, POS cihazı,
  kutu — seçilmez; tek başınaysa güveni en çok 0,3, neden "kagida-benzemiyor"). Puanı düşük kalan en iyi adaylar
  kenarlara oturtulup yeniden puanlanır. Güven 0–1; birbirine
  yakın puanlı iki farklı aday, zayıf kenar güveni düşürür. Kâğıt kareyi dolduruyorsa `fillsFrame` (kırpılmaz).
  Kareden taşan uzun fişte kareye dayanan kenar, uzun kenarların kaçış noktasından bulunan kısa kenar yönüyle
  görüntünün içine alınır; köşesi kareden çıkmış ama iki kenarı görünen kâğıtta köşe kenarların kesişimidir (en çok
  %8 dışarıda, `MAX_OUTSIDE`; açılan sayfada dışarısı kâğıt rengiyle dolar).
- **Köşe oturtma** (`refine.ts`): kaba köşeler (kullanıcının sürüklediği, yapay zekânın 0–1000 oranlı ipucu) her kenar
  boyunca kenara dik şeritte aranan geçişe (önce içerisi aydınlık, tutmazsa tersi), RANSAC + en küçük karelerle
  oturtulur; geniş şerit (köşegenin %7,5'i), sonra dar şerit. Korumalar: destek zayıfsa, içeri kayılan şerit kâğıda
  benziyorsa (yazı satırı, tablo çizgisi), çizginin dışı içiyle aynıysa ya da kenar görüntünün kenarındaysa o kenar
  değişmez; içeri arama karşı kenarın yarısına varmaz (dar fiş).
- **Açma** (`warp.ts`): normalize DLT homografi; çıktının en/boy oranı perspektiften (Zhang–He, odak dörtgenden
  kestirilir), olmazsa kenar uzunluklarından; küçültürken önce alan ortalaması (örtüşme yok). Sayfa birkaç piksel
  içeriden açılır (kenarda koyu çizgi kalmaz). `rotate` (90 / 180 / 270; `rotationForTop` yapay zekânın "top"
  ipucundan) açmayla birlikte uygulanır.
- **Taranmış görünüm** (`enhance.ts`): "belge" — her renk kanalı kâğıdın yerel parlaklığına bölünür (gölge, sarı ışık
  gider), gri ton = parlaklık + en koyu kanal (mavi tükenmez, kırmızı kaşe koyu), mürekkep koyuluğu her görüntüde
  ölçülen iki eşik arasında yumuşak açılır (kâğıt gürültüsünün altı bembeyaz; soluk termal baskıda siyah eşiği bölge
  bölge iner), kenardaki masa şeridi ve tek başına benekler silinir, hafif keskinlik. "gri", "renkli" (beyaz dengesi),
  "orijinal". Kalan ±8° eğiklik yazı satırlarının izdüşümünden ölçülüp düzeltilir; dar uzun fişte dönüş yerine
  yamultma (uzun kenarlar yerinde).
- **Giriş noktası** (`index.ts`): `scanDocument(img, { corners?, refine?, mode?, maxEdge?, deskew?, rotate? })` →
  `{ image, corners, confidence, method, fillsFrame, rotation, rotate, reasons, timings }`; `detectDocument`,
  `refineCorners`, `quadIsValid`, `orderCorners`, `cornersFromHint` / `cornersToHint` (0–1000 oran), `thumbnail`,
  `scaleQuad` / `unscaleQuad` (önizleme kopyası ile asıl fotoğraf arasında köşe taşıma).
- **Doğruluk ve süre** (sentetik fotoğraflar, gerçek köşeler bilinir; `tests/tarama-*.test.ts`): köşe hatası köşegenin
  %1,5'inin altında (eğik A4, koyu / dokulu / tahta zemin, açık ve beyaza yakın tezgâhta termal fiş, gölgeli fiş, kareden
  taşan fiş, köşesi kareden çıkmış kâğıt, yanında POS cihazı olan fiş; çoğunda %0,1'in altında); rastgele 192 sahnede
  192'si (testte tohumlu altısı). Kaba ipucu (köşegenin ±%5'i) %1,5'in altına oturur. Beyaz fiş beyaza yakın
  tezgâhta: kâğıtla zemin arası ~20 gri düzeyinde bulunur, ~12'de çoğu, ~8'de hiçbiri (A4 ~8'de de bulunur);
  bulunamayınca kırpılmaz, yalnız görünüm işlenir.
  1670×2220 fotoğrafta (yüklemedeki ölçü) sunucu çekirdeğinde A4 ~0,7–1 sn, fiş ~0,4 sn işlemci süresi; telefonda
  birkaç kat. Canlı önizleme (kamerada kenarı göstermek) için kare önce küçültülür: `detectDocument(thumbnail(kare,
  320), { maxEdge: 320 })` ~0,13 sn, köşe hatası yine %0,2'nin altında. Küçük, çok ince, düz ya da gürültü görüntüde
  çökmez (yöntem "yok", kırpılmaz).
- **Bilinen sınırlar:** yalnız sentetik fotoğraflarla ölçüldü (gerçek fotoğraf deneme betiğiyle denenmeli); kâğıtla
  zemin arası ~10 gri düzeyinin altında kâğıt bulunmaz, görüntü kâğıda benziyorsa "tam-kare" (kırpılmaz); karede iki
  belge varsa biri seçilir, güven düşer ("iki-aday"); 90° / 180° yön kendiliğinden bulunmaz (`rotate` ya da yapay
  zekânın "top" ipucu gerekir), yalnız ±8° eğiklik düzeltilir.
- **Deneme:** `npx tsx scripts/tarama-dene.ts <fotoğraf|klasör> [--mod hepsi] [--ipucu x1,y1,…,x4,y4] [--ust right]`
  ya da `--sentetik`; çıktı `.data/tarama-dene/` (köşe çizimi ve taranmış hâller). sharp yalnız bu betikte, dinamik
  yüklenir.

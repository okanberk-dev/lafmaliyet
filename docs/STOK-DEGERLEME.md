# Stok değerleme: ilk giren ilk çıkar (FIFO)

Sahibin isteği (26 Ekim 2026): "maliyeti stoktan düşerken önce giren önce çıkar gibi mantıkla yap". Bu belge ay sonu
stoğunun ve kâr-zararın mal maliyetinin nasıl değerlendiğini anlatır. Plan ve karar: [planlar/stok-fifo.md](planlar/stok-fifo.md).

## 1. Ne değişti, ne değişmedi

| Hesap | Yöntem |
| --- | --- |
| Ay sonu stoğu (Stok sayımı toplamı, Gelir-gider "Sonraki aya devreden mal") | **FIFO**, Ayarlar › Stok değerleme'deki başlangıç ayından itibaren (varsayılan Ekim 2026) |
| Kâr-zararın mal maliyeti (SMM) | açılış + alınan − kapanış; kapanış FIFO ile, sonraki ayın açılışı bu kapanış |
| Başlangıçtan önceki aylar | eskisi gibi: sayılan miktar × ay sonunda geçerli fiyat |
| Reçete, menü maliyeti, önerilen fiyat, zam uyarısı, fiyat etkisi, teorik maliyet, zayi, Tutarlılık tutarları | **değişmedi**: son alış fiyatı (yenileme maliyeti; fiyat kararı için) |

Stok satış satış düşülmez: ayda bir sayım yapılır (dönemsel envanter). FIFO bu yüzden **dönemsel** uygulanır: ayın
sonunda rafta kalan miktar sayılır, değeri faturaların sırasından bulunur.

## 2. Yöntem

Önce giren önce çıktığı için rafta kalan mal **en son alınandır**. Her sayılan malzeme için:

1. **Havuz**: bu ayın faturaları en yeniden eskiye (fatura tarihi, aynı günde sonra girilen önce), ardından
   - son 12 ay içinde bu malzemenin en son sayıldığı aydan sonraki (boş bırakılmış) ayların faturaları ve o sayımın
     katmanları (o ay tükenmiş eski parti yeniden sayılmaz; arada bir ayın boş bırakılması bunu bozmaz);
   - 12 ayda hiç sayılmadıysa son 12 ayın faturaları (en yeniden eskiye).
   - O sayım FIFO başlangıcından önceki bir aydaysa katmanları yerine sayılan miktarın tamamı **tek parça, o ayın ay
     sonu fiyatıyla** taşınır (§5 "Başlangıç ayı"). Bu ayda ve aradaki boş aylarda fatura yoksa havuz kurulmaz:
     malzeme faturasız malzeme gibi bu ayın ay sonu fiyatıyla değerlenir.
2. Sayılan miktar (malzemenin kendi biriminde: gr, ml, adet) havuzun başından alınır; her parça kendi faturasının
   birim fiyatıyla (KDV hariç, iskonto düşülmüş) değerlenir.
3. Havuz yetmezse kalan miktar **ay sonunda geçerli fiyatla** (eski yöntemin fiyatı; "fallback").
4. Bu ayın katmanları (fallback hariç) sonraki ayın havuzuna taşınır.

Fatura tarihi esastır, eşitleme zamanı değil: 31 Ekim tarihli fatura Ekim'e girer, Kasım'da eşitlense de; 1 Kasım tarihli
fatura girmez.

**Partiler** (`src/server/data/purchase-lots-query.ts`): Paraşüt faturalarının hammaddeye bağlı kalemleri, fatura +
hammadde başına toplanır (miktar × bağlantı çarpanı, net tutar). Aynı faturadaki bedava satır birim maliyeti düşürür,
iade satırı netleşir. Miktarı eksi kalan ayrı bir iade faturası, tarihinde ya da öncesinde alınmış en yeni partilerden
düşer (her biri kendi birim maliyetiyle). "Fiyatı güncelle" kapalı ("Fiyat elle") bağlantının faturası gerçek alıştır,
partiye girer. Dışarıda kalanlar: kafe dışı fatura (Karaoke box, Alp Koç) ve çarpanı şüpheli kalem (docs/PARASUT.md
5b). Çarpan şüphesi bağlantıyı ve bugünkü çarpanı izler: bağlantının bugünkü çarpanıyla onay bekleyen bir fiyat varsa
o ürünün bütün faturaları dışarıda (eşitleme yalnız en yeni faturayı değerlendirir; yenisi gelince eskinin önerisi
geçersiz kalır ama aynı yanlış çarpanı taşır), bugünkü çarpanla reddedilmiş fiyatın yalnız kendi faturası. Çarpan
düzeltilince eski çarpanla açılmış öneriler bir şey dışlamaz, faturalar yeni çarpanla girer. Su ve buz eski yöntemle
(faturası yoktur).

Faturası olmayan alım (elle / Excel girilen fatura, nakit / market alımı, bağlanmamış Paraşüt ürünü) havuzda
görünmez: havuz yettiği sürece sayılan miktar eski faturalara dağılır, yalnız havuzun karşılamadığı kalan ay sonu
fiyatıyla. Tedarikçiye iade panele yalnız Faturalar'da elle girilmiş, kalemsiz eksi fatura olarak geldiyse (Paraşüt'te
giden iade e-faturası satış faturasıdır, eşitlemeye girmez; `src/server/parasut/returns.ts`) partiden düşülmez: iade
edilen mal havuzda kalır.

## 3. Örnek

Espresso çekirdeği, ay sonu fiyatı 450 ₺/KG; FIFO başlangıcı Eylül (ya da daha önce).

| Fatura | Miktar | Birim fiyat |
| --- | --- | --- |
| 2 Eylül | 10 KG | 250 ₺/KG |
| 20 Eylül | 5 KG | 300 ₺/KG |
| 15 Ekim | 3 KG | 400 ₺/KG |

- **Eylül sayımı 5 KG**: en yeni 20 Eylül faturası karşılar: 5 × 300 = 1.500 ₺. (2 Eylül partisi tükendi.)
- **Ekim sayımı 9 KG**: havuz = 15 Ekim (3 KG) + Eylül'den taşınan 5 KG @300. 3 × 400 + 5 × 300 = 2.700 ₺; kalan 1 KG
  faturası bulunamadı: 1 × 450 = 450 ₺. Toplam **3.150 ₺**. 2 Eylül'ün 250 ₺'lik partisi kullanılmaz.
- Eylül sayılmasaydı: havuz son 12 ayın faturaları; 9 KG = 3 × 400 + 5 × 300 + 1 × 250 = **2.950 ₺**.
- Eski yöntemle Ekim: 9 × 450 = 4.050 ₺.

Ekim'in mal maliyeti = açılış (Eylül kapanışı) + Ekim alışları − 3.150 ₺; Kasım'ın açılışı 3.150 ₺.

Başlangıç **Ekim** olsaydı Eylül eski yöntemle 5 × 450 = 2.250 ₺ kapanır ve Ekim'in havuzuna "5 KG · Eyl sayımından
450,00 ₺/KG" tek parça olarak girer: Ekim 9 KG = 3 × 400 + 5 × 450 + 1 × 450 = 3.900 ₺.

## 4. Ekranlar

- **Stok sayımı** (yönetici): toplam kartında "Değerleme: FIFO" rozeti, kapsam satırı ("Stok değerinin %86'sı
  faturalardan (FIFO), %14'ü ay sonu fiyatıyla."; iki pay 100'e tamamlanır, listede olmayan ek kalem varsa kalan "ay
  sonu fiyatıyla ya da ek kalemde elle girilen fiyatla"), satırın ⓘ işaretinde katmanlar ("2 KG · 18 Eki faturası 412,00 ₺/KG
  + 0,5 KG · 29 Eyl faturası 380,00 ₺/KG · 0,3 KG faturası bulunamadı: ay sonu fiyatıyla."). Birim fiyat tutar ÷ miktar.
  Formda değişen miktar sunucunun kuralıyla havuzdan değerlenir (`src/app/panel/sayim/logic.ts` `lineAmount`): kaydedince
  toplam değişmez. Sayılmamış ya da 0 sayılmış satırın birim fiyatı ay sonu fiyatıdır (ekran ve boş sayım formu aynı).
  Personele fiyat, tutar, katman ve havuz gitmez.
- **Ayarlar › Stok değerleme**: yöntem ve başlangıç ayı; sayımı olan her ay için şimdiki ve seçilen yöntemle kapanış,
  kâr etkisi ve faturadan gelen pay (önce / sonra önizleme). "Değişen ay" bütün sayımlı ayları kapsar (tablo son 12'yi
  gösterir); sayımı olmayan sonraki ayın açılışı da yazılır (o ayın kârı ters yönde), Gelir-giderde açılışı elle girilmiş
  ay etkilenmez. Telefonda "Faturadan" sütunu gizlenir. Kaydet işlem geçmişine "Stok değerleme: eski → yeni" yazar.
  Kapalı seçilirse her ay ay sonu fiyatıyla.
- **Gelir-gider**: "Sonraki aya devreden mal" ipucu yöntemi söyler; elle girilen tutar her yöntemin önüne geçer. Yıl
  kartları (ciro, giderler, kâr / zarar, mal maliyeti oranı) bu aya kadar, POS cirosu girilmiş ayların toplamıdır
  (`yearTotals`, src/lib/calc/insights.ts; Genel bakış'ın yıl toplamı ve Claude'un yıl özeti aynı): bu ay sayılınca
  sonraki ayın açılış stoğu, ay başlamadan onun gideri gibi yıla girmez (denetim E-16). Cirosu girilmemiş ayın gideri
  ve ay sonu sayımı olmayan ay (mal maliyeti tahmini, kapanış 0) kartların altında not olarak yazılır. Tablonun yıl
  sütunu ve Excel'in yıl sütunu aynı ayları toplar (inceleme B02-D4): cirosu girilmemiş ay tabloda kendi sütununda
  görünür ama yıla girmez; öyle bir ay varsa yıl sütununun başlığı "cirosu girilmiş N ay" der, Excel'de başlık notu
  toplanmayan ayları sayar.
- **Sayım listesi**: sayım birimi olan aktif malzemeler ve pasif olup aktif bir ürünün reçetesinde geçenler ("Pasif ·
  reçetede"; satıldıkça tüketilir, listeden düşse kalan stoğu 0 sayılırdı). Aktif ürünün reçetesindeki malzeme pasif
  yapılamaz (Hammaddeler önce reçetelerden çıkarılmasını ister, ürünleri listeler); kural `isCountable`
  (src/lib/ingredient-usage.ts), motor ve sayım kaydı aynı kuralı kullanır (denetim E-04). Sayımı, alımı, Paraşüt
  bağlantısı ya da zayi / ikram kaydı olan malzeme silinmez, pasif yapılır (E-28). Fiyatı girilmemiş ek kalem ("Listede
  olmayanlar") yöneticinin zilinde ve Bugün'de söylenir: kapanış stoğuna 0 ₺ girer (E-22).
- **Excel dışa aktarımı**: Sayım sekmesinin Not sütununda FIFO katmanları, Sayım Kayıtları'nda "Değerleme" sütunu.
- **Satışlar, Ürünler, reçete kartı**: "Reçete maliyeti son alış fiyatıyla (yenileme maliyeti): fiyat kararı için.
  Kâr-zararın mal maliyeti FIFO ile değerlenen sayımdan."

## 5. Dikkat

- **Başlangıç ayı** (denetim E-05): başlangıçtan önceki ayın kapanışı ay sonu fiyatıyla değerlenir ve başlangıç ayının
  açılışı odur. O sayım başlangıç ayının havuzuna eski fatura fiyatlarıyla (katmanlarıyla) girseydi, hiç tüketilmemiş
  malın son fiyat ile eski fatura fiyatı arasındaki farkı başlangıç ayının mal maliyetine bir kez yazılırdı (Ayarlar'da
  başlangıç her değiştiğinde yeniden). Bu yüzden önceki ayın sayımı tek parça, kendi ay sonu fiyatıyla taşınır: alımı
  ve kullanımı olmayan kalemde başlangıç ayının stok değişimi 0'dır. Bu parça "faturalardan" payına girmez (kapsam
  satırında ay sonu fiyatıyla kalan payda), ipucunda "Eyl sayımından … (FIFO başlangıcından önce: ay sonu fiyatı)"
  yazar. Ayarlar önizlemesi her başlangıç seçeneği için bu kuralla hesaplar (`valuationPreview(ay, başlangıç)`).
  Taşınan parça tek başına havuz kurmaz: başlangıç ayında ve aradaki boş aylarda faturası olmayan malzeme ay sonu
  fiyatıyla değerlenir. Karar yalnız pencerenin içindeki veriden verilir; malzemenin sonraki bir aydaki ilk faturası
  ya da 12 aydan eski bir fatura (sonradan kurulan Paraşüt bağlantısıyla gelenler de) kapanmış ayın değerini
  değiştirmez (inceleme B02-D2).
- **Kapanmış aylar**: başlangıç ayını geriye almak o aylardan itibaren stok değerini ve kârı değiştirir (önizleme
  gösterir). Başlangıçtan sonra gelen geç bir fatura, sonradan düzeltilen bağlantı çarpanı ya da onaylanan fiyat da
  FIFO'lu bir ayın değerini değiştirebilir: partiler her açılışta faturalardan yeniden türetilir.
- **Yanlış çarpan**: koli ↔ adet karışıklığı partinin birim fiyatını bozar. Onay bekleyen fiyatlar zaten dışarıda;
  Paraşüt › "Kontrol edilecek bağlantılar"ı gözden geçirin.
- **Kısmi kapsam**: faturası olmayan alımın payı kapsam satırında görünür; yüksekse bağlanmamış ürünleri bağlayın.

## 6. Vergi notu

VUK m.274: emtia maliyet bedeliyle değerlenir; maliyet bedelinin tespitinde **ilk giren ilk çıkar (FIFO)** ve
**ağırlıklı ortalama** kabul edilir, **son giren ilk çıkar (LIFO) kabul edilmez**. Bu panelin hesabı yönetim
amaçlıdır: **resmi defterler muhasebecinin yöntemini izler**. Muhasebeci ağırlıklı ortalama kullanıyorsa iki rakam
ayrışabilir; Vergi bölümünün SMM'si (docs/planlar/vergi.md K15) bu ayarı izler. Yöntem bir kez seçilince tutarlı
uygulanmalıdır; değiştirmeden önce muhasebeciye danışın.

## 7. Kod

- Saf çekirdek: `src/lib/calc/fifo.ts` (`buildLots`, `takeNewestFirst`, `closingLayers`, `layersValue`, `valuationFor`,
  `openingLayer` ve `invoiceLayer`: başlangıçtan önceki sayımdan taşınan parça)
- Yükleyici: `src/server/data/purchase-lots.ts` → `loadDataset` (`Dataset.purchaseLots`, isteğe bağlı: Excel tohumu ve
  golden testler partisiz, eski yöntemle)
- Motor: `src/lib/calc/engine.ts` `fifoLayersFrom` (başlangıç + ay + malzeme başına bellekli; `fifoLayers` Ayarlar'daki
  başlangıçla), `stockSheet` (`StockLine.valuation`,
  `layers`, `uncoveredQty`, `pool`, `fallbackUnit`), `valuationPreview`; `closingStock`, `pnlMonth`, Genel bakış, MCP
  ve dışa aktarım kendiliğinden izler
- Ayar: `Settings.stokFifoBaslangic` (`DEFAULT_SETTINGS` "2026-10"; veritabanında kapalı = "kapali"),
  `saveStockValuationStart` (src/server/actions/settings.ts)
- Testler: `tests/stok-fifo.test.ts`

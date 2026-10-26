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
   - geçen ay bu malzeme sayıldıysa geçen ayın katmanları (geçen ay tükenmiş eski parti yeniden sayılmaz);
   - sayılmadıysa son 12 ayın faturaları (en yeniden eskiye).
2. Sayılan miktar (malzemenin kendi biriminde: gr, ml, adet) havuzun başından alınır; her parça kendi faturasının
   birim fiyatıyla (KDV hariç, iskonto düşülmüş) değerlenir.
3. Havuz yetmezse kalan miktar **ay sonunda geçerli fiyatla** (eski yöntemin fiyatı; "fallback").
4. Bu ayın katmanları (fallback hariç) sonraki ayın havuzuna taşınır.

Fatura tarihi esastır, eşitleme zamanı değil: 31 Ekim tarihli fatura Ekim'e girer, Kasım'da eşitlense de; 1 Kasım tarihli
fatura girmez.

**Partiler** (`src/server/data/purchase-lots.ts`): Paraşüt faturalarının hammaddeye bağlı kalemleri, fatura + hammadde
başına toplanır (miktar × bağlantı çarpanı, net tutar). Aynı faturadaki bedava satır birim maliyeti düşürür, iade
satırı netleşir. Dışarıda kalanlar: "Fiyatı güncelle" kapalı bağlantı, onay bekleyen ya da reddedilen fiyat (yanlış
çarpan olabilir; docs/PARASUT.md 5b), kafe dışı fatura (Karaoke box, Alp Koç). Su ve buz eski yöntemle (faturası
yoktur). Elle / Excel girilen fatura, nakit / market alımı ve bağlanmamış Paraşüt ürününün partisi yoktur: o kısım
ay sonu fiyatıyla değerlenir.

## 3. Örnek

Espresso çekirdeği, ay sonu fiyatı 450 ₺/KG.

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

## 4. Ekranlar

- **Stok sayımı** (yönetici): toplam kartında "Değerleme: FIFO" rozeti, kapsam satırı ("Stok değerinin %86'sı
  faturalardan (FIFO), %14'ü ay sonu fiyatıyla."), satırın ⓘ işaretinde katmanlar ("2 KG · 18 Eki faturası 412,00 ₺/KG
  + 0,5 KG · 29 Eyl faturası 380,00 ₺/KG · 0,3 KG faturası bulunamadı: ay sonu fiyatıyla."). Birim fiyat tutar ÷ miktar.
  Formda değişen miktar sunucunun kuralıyla havuzdan değerlenir (`src/app/panel/sayim/logic.ts` `lineAmount`): kaydedince
  toplam değişmez. Personele fiyat, tutar, katman ve havuz gitmez.
- **Ayarlar › Stok değerleme**: yöntem ve başlangıç ayı; sayımı olan her ay için şimdiki ve seçilen yöntemle kapanış,
  kâr etkisi ve faturadan gelen pay (önce / sonra önizleme). Kaydet işlem geçmişine "Stok değerleme: eski → yeni" yazar.
  Kapalı seçilirse her ay ay sonu fiyatıyla.
- **Gelir-gider**: "Sonraki aya devreden mal" ipucu yöntemi söyler; elle girilen tutar her yöntemin önüne geçer.
- **Excel dışa aktarımı**: Sayım sekmesinin Not sütununda FIFO katmanları, Sayım Kayıtları'nda "Değerleme" sütunu.
- **Satışlar, Ürünler, reçete kartı**: "Reçete maliyeti son alış fiyatıyla (yenileme maliyeti): fiyat kararı için.
  Kâr-zararın mal maliyeti FIFO ile değerlenen sayımdan."

## 5. Dikkat

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

- Saf çekirdek: `src/lib/calc/fifo.ts` (`buildLots`, `takeNewestFirst`, `closingLayers`, `layersValue`, `valuationFor`)
- Yükleyici: `src/server/data/purchase-lots.ts` → `loadDataset` (`Dataset.purchaseLots`, isteğe bağlı: Excel tohumu ve
  golden testler partisiz, eski yöntemle)
- Motor: `src/lib/calc/engine.ts` `fifoLayers` (ay + malzeme başına bellekli), `stockSheet` (`StockLine.valuation`,
  `layers`, `uncoveredQty`, `pool`, `fallbackUnit`), `valuationPreview`; `closingStock`, `pnlMonth`, Genel bakış, MCP
  ve dışa aktarım kendiliğinden izler
- Ayar: `Settings.stokFifoBaslangic` (`DEFAULT_SETTINGS` "2026-10"; veritabanında kapalı = "kapali"),
  `saveStockValuationStart` (src/server/actions/settings.ts)
- Testler: `tests/stok-fifo.test.ts`

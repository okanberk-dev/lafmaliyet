# Tahmini stok ve kritik stok uyarısı (Marina)

**Sahibe kısa özet.** Marina'da her malzemeden rafta şu an ne kadar kaldığını tahmin eder: son ay sonu sayımına
Marina'ya gelen faturalı malı ekler, LafPOS'tan gelen satışların reçeteye göre harcadığını ve girilen zayi ile ikramı
düşer. Rakamlar tahminidir; gerçek stok yine ay sonu sayımıdır ve yeni sayım girilince tahmin oradan yeniden başlar.
Bir malzemeye kritik eşik yazarsanız tahmini stok eşiğe inince Stok sayımı › Tahmini stok listesinde kırmızıyla,
Genel bakış ve Bugün'de küçük bir kartta söylenir; eşik yazılmayan malzemede uyarı çıkmaz. Faturalar şubeye bölünmediği
için Marina'ya gelen faturayı bu ekranda bir kez işaretlersiniz; Tuzla'da hiçbir şey değişmez.

## 1. Nerede, kim görür

- **Ekran:** `/panel/sayim/tahmini` ("Tahmini stok"). Stok sayımı'nda Marina seçiliyken başlıktaki **Tahmini stok**
  düğmesiyle açılır; kritik kalem varsa Genel bakış ve Bugün'deki karttan da. Ekran hep Marina'nındır (soldaki
  seçiciden bağımsız). Menüye ayrı satır eklenmedi: Tuzla'nın menüsü ve Stok sekmeleri aynı kaldı.
- **Yönetici:** liste, kritik eşik alanı ve "Marina'ya gelen faturalar" kartı (faturanın şubesini seçer).
- **Personel:** listeyi ve eşikleri okur, değiştirmez. Tutar, fiyat, fatura ve tedarikçi görmez (ekranda para yok;
  personel maliyet ve kâr görmez kuralı). Başka şubeye kilitli personele ekran veri göstermez.
- **Yalnız Marina ve yalnız LafPOS'a geçildiyse:** Ayarlar › LafPOS'taki geçiş günü boşken ekran "LafPOS'a geçilmedi"
  der, kartlar çizilmez. Tuzla (ModPOS) için tahmin yok: ModPOS'un satış listesi aylık gelir, gün gün bölünemez.

## 2. Hesap

Her malzeme için, malzemenin kendi biriminde (gr, ml, adet, dilim):

```
tahmini stok = son sayım
             + Marina'ya gelen faturalı alış
             − LafPOS satışlarının reçeteye göre tüketimi × (1 + genel fire)
             − zayi ve ikram (reçeteden ya da hammadde olarak, fire eklenmeden)
```

- **Son sayım:** Marina'nın bu malzemeyi saydığı en son **bitmiş** ay (Stok sayımı, şube Marina). Sayım ay sonu
  stoğudur: dönem sayımın ertesi ayının 1'inde başlar. Süren ayın sayımı (ay bitmeden girilen) ay bitince tahmine girer.
  Sayılan miktar sayıldığı birimin çarpanıyla çevrilir (KG ve LT 1000, ADET ve DİLİM 1).
- **Satış:** yalnız LafPOS'un Marina gün sonları (`pos_daily_sales`, şube Marina), dönemin başından bugüne. Ürün
  reçetesindeki miktar × satılan adet; formüllü reçete satırı Ayarlar'daki değerlerle hesaplanır (motorla aynı kural).
  Genel fire (Ayarlar, %5) satışa bir kez eklenir; "fire ambalaja uygulanmaz" açıksa Ambalaj kalemlerine eklenmez
  (Gelir-gider'in reçeteye göre tahmini mal maliyetiyle aynı yaklaşım, [STOK-DEGERLEME.md](STOK-DEGERLEME.md) §5).
  - Ürüne bağlanmamış satır ve reçetesi boş ürün **atlanır ve sayılır**: ekran yöneticiye kaç satır, kaç adet olduğunu
    ve adlarını yazar (Ayarlar › LafPOS'ta bağlanır ya da reçete yazılır). Hizmet satırı (karaoke) sayılmaz.
- **Zayi ve ikram** ([ZAYI-IKRAM.md](ZAYI-IKRAM.md)): Marina'ya panelde girilen kayıtlar ve LafPOS'un gün sonuyla
  gelen ikram ve zayi satırları. Her gün tek kaynak (`panelWasteCounts`): LafPOS'un gün sonu gelen günde panele girilmiş
  ürün ikramı sayılmaz (LafPOS'taki sayılır); zayi ve hammadde ikramı her zaman sayılır. Ürün reçeteden, hammadde
  girildiği birimin çarpanıyla; fire eklenmez.
- **İptal:** LafPOS sözleşmesinde ayrı alan yok. İptal edilen kalem satışa girmez, tüketim yazılmaz; hazırlanıp
  atıldıysa personel zayi olarak girer.
- **Alış:** Paraşüt faturalarının hammaddeye bağlı kalemleri (stok değerlemenin partileriyle aynı süzgeç: kafe dışı
  fatura ve çarpanı şüpheli kalem girmez), yalnız **Marina'ya geldi** işaretli faturalar, fatura tarihi dönemin içinde.
  İade faturası işaretliyse düşer.

## 3. Faturanın şubesi

Faturalar şubeye bölünmez ([SUBE.md](SUBE.md): mal alımı işletme genelidir). Bütün faturaları saymak Tuzla'nın malını
Marina'da gösterir, hiç saymamak mal geldiği gün bile "bitiyor" der. Bu yüzden yönetici ekrandaki **Marina'ya gelen
faturalar** kartında dönemin her faturası için "Marina" ya da "Tuzla" seçer (seçilmeyen fatura tahmine girmez, kart
"şubesi seçilmedi" der). Seçim yalnız bu tahmini değiştirir: fatura, ödeme, cari, FIFO ve mal maliyeti aynıdır.
Kart önce şubesi seçilmeyenleri, sonra seçilmişleri listeler (ikisi de en yeni önce) ve en çok 100 fatura gösterir.
Başlıktaki fatura sayısı ve "şubesi seçilmedi" sayacı liste kesilse de dönemin bütün faturalarından sayılır. Liste
kesilince altında kaç faturanın gizlendiği ve bunların kaçının şubesinin seçilmediği yazar (25 Kasım 2026'ya kadar liste
en yeni 100 faturada sessizce kesiliyordu, sayaç da yalnız onları sayıyordu: dönemin başındaki seçilmemiş fatura ne
görünüyor ne sayılıyordu).
Faturası olmayan alım (elle ya da Excel'den girilen fatura, market alımı, Tuzla'dan getirilen mal) tahmine girmez:
tahmini stok olduğundan az görünür, sayım düzeltir.

## 4. Kritik eşik

- Malzeme başına, şube başına (`stock_thresholds`; bugün yalnız Marina). Yönetici sayım biriminde yazar (2,5 KG);
  malzemenin kendi biriminde saklanır, sayım birimi sonradan değişse de anlamı değişmez. Boş bırakılan eşik silinir.
- **Kritik:** tahmin var ve tahmini stok eşiğe eşit ya da altında. Eşik yoksa uyarı yok.
- Listede kritik kalemler en üstte ve kırmızı rozetle; Genel bakış (yönetici) ve Bugün'de (iki rol) küçük kart en çok
  dört kalemi yazar ve listeye götürür. Kart yalnız Marina ya da "Tümü" seçiliyken çizilir; Tuzla ve online kanal
  seçiliyken, Tuzla'ya kilitli personelde hiç yüklenmez.
- Tahmin eksiye düşerse rakam olduğu gibi yazılır ("−0,4 KG"): çoğu kez işaretlenmemiş bir faturadır.

## 5. Durumlar ve uyarılar

| Durum | Ne zaman | Ekranda |
|---|---|---|
| Tahmin | Son sayım LafPOS'un sayıldığı ilk günden sonra başlıyor | Rakam ve "tahmini" rozeti |
| Sayım yok | Marina'da bitmiş bir ayda hiç sayılmadı | "Sayım yok" |
| LafPOS öncesi sayım | Dönem LafPOS'tan önce başlıyor (o günlerin satışı ModPOS'un aylık listesinde, gün gün bölünemez) | "Sayım LafPOS'tan önce": ilk sayımdan sonra başlar |

- **Gün sonu gelmeyen gün** (yönetici): dönemde LafPOS gün sonu gelmeyen ve kapalı işaretli olmayan gün varsa sayısı
  ve günleri: o günlerin satışı tahmine girmedi, stok olduğundan fazla görünür.
- **Bugün:** bugünün satışı gün sonuyla gelir; başlık son gelen gün sonunu yazar.

## 6. Neyi değiştirmez

- Stok sayımı, FIFO değerleme, mal maliyeti, Tutarlılık, Gelir-gider ve faturalar aynıdır: tahmin yalnız okur, kendi
  iki tablosuna (eşik, faturanın şubesi) yazar. Saf hesap ayrı modülde.
- Tuzla'nın ekranları, menü ve sekmeler aynı. Stok sayımı'nda düğme yalnız Marina seçiliyken çizilir.
- İki şubenin ortak menüsü, reçetesi ve site fiyatları değişmez.

## 7. Bilinen sınırlar

- Şubeler arası transfer ve faturasız alım tahmine girmez; bir fatura iki şubeye bölündüyse tamamı seçilen şubeye
  sayılır.
- Kayda geçmeyen fire (dökülme, tadım) genel fire payıyla yaklaşık düşülür; gerçek fark ay sonu sayımında ve
  Tutarlılık'ta görünür.
- Tuzla LafPOS'a geçerse aynı modül Tuzla için açılabilir (eşik ve faturanın şubesi zaten şube başına).

## 8. Kod

| Dosya | Görev |
|---|---|
| `src/lib/stock-estimate.ts` | Saf hesap: dönem, birim dönüşümü, satış ve zayi tüketimi, atlanan satırlar, kritik eşik, kartın özeti, görünürlük kuralı |
| `src/server/data/stock-estimate.ts` | Okuyucu (yalnız okuma): Marina'nın sayımı, LafPOS gün sonları, zayi ve ikram, işaretli faturaların partileri, eşikler |
| `src/server/actions/stock-estimate.ts` | Eşiği ve faturanın şubesini yazar (yönetici, işlem geçmişine düşer) |
| `src/app/panel/sayim/tahmini/` | Ekran |
| `src/app/panel/stock-alert-card.tsx` | Genel bakış ve Bugün'ün kartı |
| `drizzle/0066_tahmini_stok.sql` | `stock_thresholds`, `stock_receipts` (yalnız ekleme) |
| `tests/stok-tahmini.test.ts` | Sayım yok, LafPOS öncesi, reçetesiz ve bağlanmamış ürün, birim dönüşümü, zayi ve ikram kuralı, alış, eşik, Tuzla'nın etkilenmemesi |
| `tests/stok-tahmini-db.test.ts` | Veritabanında LafPOS'un sayıldığı ilk gün: Marina'nın geçiş ayı listesinin son gününden sonra, Marina'nın kendi kapsam kaydından (Tuzla'nın aynı aya yüklediği liste kaydırmaz; docs/LAFPOS.md › Günlük satış) |

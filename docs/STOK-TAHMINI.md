# Tahmini stok ve kritik stok uyarısı (Marina)

**Sahibe kısa özet.** Marina'da her malzemeden rafta şu an ne kadar kaldığını tahmin eder: son ay sonu sayımına
Marina'ya gelen faturalı malı ekler, LafPOS'tan gelen satışların ve kasadan geçmeyen laffogato.net online
siparişlerinin reçeteye göre harcadığını, girilen zayi ile ikramı düşer. Son 14 günün ortalamasıyla her malzemenin
**kaç gün yeteceğini** yazar ve seçtiğiniz tedarik süresine göre bir **eşik önerir**; öneri kendiliğinden yazılmaz,
siz Kaydet'e basınca eşik olur. Rakamlar tahminidir; gerçek stok yine ay sonu sayımıdır ve yeni sayım girilince tahmin
oradan yeniden başlar. Bir malzemeye kritik eşik yazarsanız tahmini stok eşiğe inince Stok sayımı › Tahmini stok
listesinde kırmızıyla, Genel bakış ve Bugün'de küçük bir kartta söylenir; eşik yazılmayan malzemede uyarı çıkmaz.
Faturalar şubeye bölünmediği için Marina'ya gelen faturayı bu ekranda bir kez işaretlersiniz; Tuzla'da hiçbir şey
değişmez.

## Geliştirilmiş istek (prompt)

> Sahip (Dalga 2, 26 Kasım 2026): _"Stok tahmini Marina'nın online siparişlerini düşsün; 'kaç gün yeter' ve eşik
> önerisi eklensin."_
>
> - **Online:** laffogato.net'in Marina siparişlerinin reçeteye göre tüketimi düşülsün. LafPOS satışıyla **çift
>   sayılmasın**: kasada ödenen ya da panelden elle girilen online sipariş LafPOS'ta çalınır, gün sonuyla zaten gelir;
>   yalnız kasadan geçmeyenler düşülür.
> - **Kaç gün yeter:** son N günün ortalama günlük kullanımıyla tahmini stok kaç gün yeter.
> - **Eşik önerisi:** tedarik süresine göre; uygulanmadan önce yönetici onaylar (kendiliğinden yazılmaz).

## 1. Nerede, kim görür

- **Ekran:** `/panel/sayim/tahmini` ("Tahmini stok"). Stok sayımı'nda Marina seçiliyken başlıktaki **Tahmini stok**
  düğmesiyle açılır; kritik kalem varsa Genel bakış ve Bugün'deki karttan da. Ekran hep Marina'nındır (soldaki
  seçiciden bağımsız). Menüye ayrı satır eklenmedi: Tuzla'nın menüsü ve Stok sekmeleri aynı kaldı.
- **Yönetici:** liste, kritik eşik alanı ve eşik önerisi, tedarik süresi seçimi, online siparişlerin uyarısı ve
  **Siteden al** düğmesi, "Marina'ya gelen faturalar" kartı (faturanın şubesini seçer).
- **Personel:** listeyi, "kaç gün yeter"i ve eşikleri okur, değiştirmez. Tutar, fiyat, fatura ve tedarikçi görmez (ekranda para yok;
  personel maliyet ve kâr görmez kuralı). Başka şubeye kilitli personele ekran veri göstermez.
- **Yalnız Marina ve yalnız LafPOS'a geçildiyse:** Ayarlar › LafPOS'taki geçiş günü boşken ekran "LafPOS'a geçilmedi"
  der, kartlar çizilmez. Tuzla (ModPOS) için tahmin yok: ModPOS'un satış listesi aylık gelir, gün gün bölünemez.

## 2. Hesap

Her malzeme için, malzemenin kendi biriminde (gr, ml, adet, dilim):

```
tahmini stok = son sayım
             + Marina'ya gelen faturalı alış
             − LafPOS satışlarının reçeteye göre tüketimi × (1 + genel fire)
             − kasadan geçmeyen online siparişlerin reçeteye göre tüketimi × (1 + genel fire)
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
- **Online sipariş** (laffogato.net; [SITE-SATIS.md](SITE-SATIS.md)): sitenin **Marina'ya göre ay kaydı**
  (`GET /api/panel/sales?month=YYYY-MM&branch=marina`; yanıt `branch: "marina"` demezse kayıt yazılmaz). Yalnız
  **kasadan geçmeyen** kafe siparişleri düşülür: site kasada ödenen (`counter`: "Ödendi olarak işaretle", nakit ya da
  kasadaki kart) ve panelden elle girilen (`manual`) siparişleri kafe satırlarından (`cafe.lines`) zaten çıkarır; onlar
  LafPOS'ta çalınır ve gün sonuyla satış olarak gelir. **Çift sayılmaz.** Ekran ikisini ayrı söyler ("kasadan geçmeyen
  34 sipariş düşüldü · kasada ödenen 5 sipariş LafPOS satışında sayıldı").
  - Satır menü bağlantısıyla ürüne eşlenir (L → L yuvası, M ve tek boy → M), seçenekler (ekstra shot, şurup,
    alternatif süt) kendi ürünleriyle: Tutarlılık'ın online tüketimiyle aynı kural (`estimateOnlineMonth`). Bağlanamayan
    satır ve ürünü olmayan seçenek atlanır ve sayılır ("Online, panel ürününe bağlı değil": Ürünler › Site menüsü),
    reçetesi boş ürünün satırı reçetesizlere eklenir. Mağaza kolisi ve karaoke tüketim değildir, girmez.
  - Kayıt ay başınadır; dönem hep ayın 1'inde başladığı için ay, dönemin ayından eski değilse düşülür (sayımın ayı ve
    öncesi sayımın içindedir). Süren ayın kaydı çekildiği güne kadardır (günlük iş sabah çeker).
  - **Ne zaman çekilir:** günlük iş ve Gelir-gider › **Siteden yenile** işletmenin üç ayını çekerken Marina'nın aynı
    üç ayını da ayrıca çeker (`syncSiteSales` → `syncBranchSiteSales`; hatası kâr-zarar çekmesini bozmaz, kendi
    durumuna yazılır). Tahminin gerektirdiği bir ayın kaydı yoksa yöneticiye "Online siparişler alınmadı: Kasım 2026"
    uyarısı ve **Siteden al** düğmesi (o ayları çeker, en çok 6; `refreshStockOnline`, işlem geçmişine düşer). Kayıt
    yokken o ayın online siparişi düşülmez: stok olduğundan fazla görünür.
  - Site bağlantısı kurulu değilse (`KARAOKE_SYNC_SECRET` yok) online hiç düşülmez, uyarı da çıkmaz.
  - Şubenin kaydı işletmeninkinden ayrıdır (`site_sales_sube:marina:YYYY-MM`): kâr-zarar, KDV tahmini ve Tutarlılık
    işletmenin şubesiz kaydını okumaya devam eder, Marina'nınki onlara girmez.
- **Alış:** Paraşüt faturalarının hammaddeye bağlı kalemleri (stok değerlemenin partileriyle aynı süzgeç: kafe dışı
  fatura ve çarpanı şüpheli kalem girmez), yalnız şubesi **Marina** olan faturalar, fatura tarihi dönemin içinde.
  İade faturası işaretliyse düşer.

## 3. Faturanın şubesi

Tahmin yalnız **Marina'nın faturalarını** sayar: faturanın şubesi (`invoices.branch_id`; [SUBE.md › Faturanın şubesi](SUBE.md#faturanın-şubesi-25-kasım-2026)).
Bütün faturaları saymak Tuzla'nın malını Marina'da gösterir, hiç saymamak mal geldiği gün bile "bitiyor" der. Ekrandaki
**Marina'ya gelen faturalar** kartı dönemin hammaddeye bağlı kalemi olan her faturasını şubesiyle gösterir ("Seçilmedi",
Tuzla, Marina, İşletme geneli); seçim faturanın şubesini yazar, Faturalar'daki seçimle **aynı alandır** (tek doğruluk
kaynağı). Seçilmeyen ve işletme geneli fatura tahmine girmez, kart "şubesi seçilmedi" der. Tutar, ödeme, cari, FIFO ve
mal maliyeti değişmez; fatura seçilen şubenin Faturalar, Gelir-gider ve Maliyet görünümüne geçer.

Kart önce şubesi seçilmeyenleri, sonra seçilmişleri (şube ya da işletme geneli) listeler, ikisi de en yeni önce, ve en
çok 100 fatura gösterir. Başlıktaki fatura sayısı ve "şubesi seçilmedi" sayacı liste kesilse de dönemin bütün
faturalarından sayılır. Liste kesilince altında kaç faturanın gizlendiği ve bunların kaçının şubesinin seçilmediği yazar
(25 Kasım 2026'ya kadar liste en yeni 100 faturada sessizce kesiliyordu, sayaç da yalnız onları sayıyordu: dönemin
başındaki seçilmemiş fatura ne görünüyor ne sayılıyordu).

25 Kasım 2026'ya kadar bu seçim ayrı bir tabloda (`stock_receipts`) duruyordu; göç `0088_fatura_sube_veri` seçimleri
şubesi boş faturalara taşıdı, `0089` tabloyu kaldırdı.

Faturası olmayan alım (elle girilen ya da içe aktarılmış fatura, market alımı, Tuzla'dan getirilen mal) tahmine girmez:
tahmini stok olduğundan az görünür, sayım düzeltir.

## 3a. Kaç gün yeter ve eşik önerisi (26 Kasım 2026)

- **Günlük kullanım:** dünden geriye **14 gün** (`AVG_DAYS`). LafPOS satışı × (1 + fire), zayi ve ikram (yukarıdaki
  kurallarla) **gün sonu gelen ya da kapalı işaretli günlere** bölünür: gün sonu gelmeyen gün ne paya ne paydaya girer
  (o günün satışı bilinmiyor; ortalamayı düşürmesin). Online sipariş takvim günüyle eklenir: pencerenin değdiği her ayın
  kaydı, kaydın kapsadığı günlere bölünüp penceredeki günleriyle çarpılır, 14'e bölünür. Ortalama dönemden bağımsızdır
  (sayımdan önceki günler de girer). Pencerede **3 günden az** gün varsa (`MIN_AVG_DAYS`) kaç gün ve öneri yazılmaz.
- **Kaç gün yeter** = tahmini stok ÷ günlük kullanım: "≈ 4 gün", "1 günden az", "60+ gün", kullanım yoksa "–". Listede
  **Yeter** sütunu (telefonda tahminin altında "≈ 4 gün yeter"); kritikse ya da 3 günden azsa kırmızı. Genel bakış ve
  Bugün'ün kartı da yazar ("≈ 1,55 KG · eşik 2 KG · ≈ 2 gün yeter").
- **Eşik önerisi** = günlük kullanım × (tedarik süresi + 1 gün emniyet), ekrandaki birimin adımına **yukarı**
  yuvarlanır (KG ve LT 0,1; ADET ve DİLİM 1). Tedarik süresi ekranda seçilir: **1 · 2 · 3 · 5 · 7 gün** (varsayılan 3;
  adreste `?tedarik=5`; saklanmaz). Tedarikçiye göre teslim süresi panelde tutulmuyor (eski mal siparişinin
  `reorder_items.lead_days`'i 26 Ekim'de kaldırıldı): süre bütün malzemeler için tektir.
- **Onay:** öneri eşik alanının yanında küçük **Öneri 2,6** düğmesidir; dokununca değer alana yazılır, hiçbir şey
  kaydedilmez. Yönetici **Kaydet**'e basınca eşik olur (aynı eylem, işlem geçmişine düşer); vazgeçerse sayfayı yeniler.
  Toplu "önerileri uygula" yok. Personel öneriyi görmez.

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
- **Online siparişler alınmadı** (yönetici): tahminin ya da ortalamanın gerektirdiği ay(lar)ın Marina kaydı yok;
  **Siteden al** ve son denemenin hatası (ör. "Site şubeye göre satış vermedi").
- **Bugün:** bugünün satışı gün sonuyla gelir; başlık son gelen gün sonunu yazar.

## 6. Neyi değiştirmez

- Stok sayımı, FIFO değerleme, mal maliyeti, Tutarlılık, Gelir-gider ve faturalar aynıdır: tahmin yalnız okur, kendi
  iki tablosuna (eşik, faturanın şubesi) yazar. Saf hesap ayrı modülde. Marina'nın online ay kaydı
  `integration_state`'te ayrı anahtardadır; işletmenin kaydı (kâr-zarar, KDV, Tutarlılık) değişmez.
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
| `src/lib/stock-estimate.ts` | Saf hesap: dönem, birim dönüşümü, satış, online ve zayi tüketimi, atlanan satırlar, kritik eşik, günlük kullanım, kaç gün yeter, eşik önerisi, sitenin ay kaydının eşlenmesi (`estimateOnlineMonth`), kartın özeti, görünürlük kuralı |
| `src/server/data/stock-estimate.ts` | Okuyucu (yalnız okuma): Marina'nın sayımı, LafPOS gün sonları, zayi ve ikram, işaretli faturaların partileri, eşikler, Marina'nın online ay kayıtları |
| `src/server/site-sales/sync.ts` | Marina'nın online ay kaydı: `syncBranchSiteSales`, `loadBranchSiteSales`, durumu (`site_sales_sube_sync`) |
| `src/server/actions/stock-estimate.ts` | Eşiği yazar (yönetici, işlem geçmişine düşer); online siparişleri siteden alır (`refreshStockOnline`); faturanın şubesini `setInvoiceBranch` (src/server/actions/invoices.ts) |
| `src/app/panel/sayim/tahmini/` | Ekran (eşik alanı ve öneri `threshold-input.tsx`, Siteden al `online-refresh.tsx`) |
| `src/app/panel/stock-alert-card.tsx` | Genel bakış ve Bugün'ün kartı |
| `drizzle/0066_tahmini_stok.sql` | `stock_thresholds`, `stock_receipts` (yalnız ekleme; `stock_receipts` 0089'da kalktı, seçim faturanın şubesinde) |
| `tests/stok-tahmini.test.ts` | Sayım yok, LafPOS öncesi, reçetesiz ve bağlanmamış ürün, birim dönüşümü, zayi ve ikram kuralı, alış, eşik, Tuzla'nın etkilenmemesi; online sipariş (çift sayılmama, dönemden önceki ay, eksik ay, sitenin satırlarının eşlenmesi), kaç gün yeter, eşik önerisi ve onayı |
| `tests/stok-tahmini-db.test.ts` | Veritabanında LafPOS'un sayıldığı ilk gün: Marina'nın geçiş ayı listesinin son gününden sonra, Marina'nın kendi kapsam kaydından (Tuzla'nın aynı aya yüklediği liste kaydırmaz; docs/LAFPOS.md › Günlük satış) |

# Raporlar

**Sahibe kısa özet.** Kenar çubuğunda Kâr & ödemeler'in altında **Raporlar** grubu var: dört ekran, hepsi yalnız
yöneticinin. **Şube karşılaştırma** şubeleri ay ay yan yana koyar (ciro, fiş, ortalama sepet, kasa farkı, ikram, zayi,
mal maliyeti, işçilik, gider, kâr). **İşçilik / ciro** personel maliyetinin ciroya oranını günlük, haftalık ve şube şube
verir. **Kaçak raporu** Marina'nın ay sonu sayımını tahmini stokla karşılaştırır, farkı TL olarak ve en çok kaçan
kalemlerle yazar. **Kayıp önleme** kasa farkını, iptali, ikramı ve indirimi kişiye göre gösterir. Hiçbir rapor yeni rakam
uydurmaz: her rakam başka bir ekranın rakamıdır ve veri yoksa "bilinmiyor" yazar, sıfır değil.

Dalga 2 (Şube karşılaştırma) ve Dalga 3'ün üç maddesi (İşçilik / ciro, Marina kaçak raporu, kişi bazında kayıp önleme);
26 Kasım 2026.

## Ortak kurallar

| Konu | Kural |
|---|---|
| Kim görür | Yalnız yönetici (`requireAdmin`; `src/lib/roles.ts`'te personel yolu değil, `tests/roller.test.ts`). Personelin ağacında grup yok |
| Menü | Kenar çubuğunda **Raporlar** grubu (Kâr & ödemeler'in ardından, Vergi'den önce); komut paletinde aynı sırada. Sekmeler gruptan türer (`SECTION_TABS.raporlar`): Şubeler · İşçilik · Kaçak · Kayıp önleme (sekme yalnız kısaltır) |
| Şube seçimi | Soldaki seçici raporları **süzmez**: her açık fiziksel şube kendi görünümüyle okunur (Gelir-gider'de o şube seçiliyken görünenler). Şube seçiliyken ekran bunu söyler (`companyWideNote("raporlar")`). Kaçak raporu hep Marina'nındır |
| Dönem | `?ay=YYYY-MM` (seçilen son ay; bu aydan sonrası bu aya çekilir), Şube karşılaştırma ve Kayıp önleme'de `?sure=1|3|6|12` (ay; varsayılan 3). `?sube=` kullanılmaz: o, seçicinin bağlantı parametresidir |
| Süren ay | Rakamlar bugüne kadar (iş günü, 05:00 kuralı); giderler ve personel Gelir-gider gibi ayın geçen günleriyle |
| Bilinmeyen | Girilmemiş ciro, fiş, ödenmez, indirim, iptal "—" ya da "veri yok"; toplamda sıfır sayılmaz, orana girmez |

Kod: saf hesaplar `src/lib/sube-karsilastirma.ts`, `src/lib/iscilik.ts`, `src/lib/kacak.ts`, `src/lib/kayip-onleme.ts`;
yükleyiciler `src/server/data/` altında aynı adlarla (`kacak.ts`, `kayip-onleme.ts`, `iscilik.ts`,
`sube-karsilastirma.ts`); ekranlar `src/app/panel/raporlar/`. Testler: `tests/sube-karsilastirma.test.ts`,
`tests/iscilik.test.ts`, `tests/kacak.test.ts`, `tests/kayip-onleme.test.ts`, veritabanında
`tests/raporlar-db.test.ts` (dört yükleyici canlı şemayla; ay rakamları Gelir-gider'in şube görünümüyle aynı).

## Şube karşılaştırma

`/panel/raporlar`. Birden çok ay seçiliyse önce dönemin toplamı, sonra aylar yeniden eskiye; her kartta satırlar,
sütunlarda şubeler. Oranlar toplamların oranıdır (ayların oranlarının ortalaması değil). Yönü olan satırda en iyi şube
"●" ile işaretli (ciro ve kârda en yüksek, gider ve oranda en düşük, kasa farkında sıfıra en yakın); en az iki şubenin
rakamı biliniyor ve eşit değilse.

| Satır | Kaynağı (aynı rakam) |
|---|---|
| Ciro (KDV dahil), Açık gün | Gelir-gider'in ay hücresi (şubenin görünümü; `pnlMonth.revenue`, ayın açık günü) |
| Açık gün başına ciro | Ciro ÷ açık gün |
| Fiş sayısı, Ortalama sepet | Kıyas'ın şube-gün hücresi (`src/lib/kiyas.ts` `cellReader`: kasa raporu > LafPOS gün sonu > ModPOS föyü; satış varken 0 fiş bilinmiyor). Sepet yalnız fişi bilinen günlerin cirosundan |
| Kasa farkı | Kasa raporlarının `cash_diff` toplamı (eksik eksi, fazla artı; LafPOS'un yazdığı raporlar dahil) |
| Ödenmez / ikram (Z), İndirim (Z) | Ayın bilgisi (Gelir-gider / Satışlar); alan girilmemişse (kaynağı "none") bilinmiyor |
| Zayi, İkram (malzeme maliyeti) | Zayi & ikram'ın ay özeti (`wasteSummary`; KDV hariç) |
| Ciro (KDV hariç), Mal maliyeti, İşçilik, Giderler, Kâr ve oranları | Gelir-gider'in ay hesabı (şubenin görünümü): mal maliyeti şubenin satışından reçeteye göre, işçilik personel bölümü, giderler mal maliyeti dahil; işletme geneli giderler şubeye bölünmez ([SUBE.md › İşletme geneli payı](SUBE.md#işletme-geneli-payı-faz-5-23-kasım-2026)). Cirosu girilmemiş ayda kâr ve oran yazılmaz |

İşletmenin toplamı (sayımlı mal maliyeti, işletme geneli giderler, online satış) burada yok: Gelir-gider'de Tümü
seçiliyken ve onun Şube kırılımı kartında.

## İşçilik / ciro

`/panel/raporlar/iscilik`. Üstte ayın satırı şube şube (ve birden çok şubede **Şubelerin toplamı**): Gelir-gider'in
personel giderleri ÷ cirosu (KDV hariç). Altında her şube için **Haftalık** (pazartesiden pazara; ilk ve son hafta ayın
dışına taşan günleriyle) ya da **Günlük** (`?gorunum=gun`) tablo: ciro, işçilik, oran, not.

**Yöntem** (ekranda tek satır, `LABOR_METHOD`): Gelir-gider'in personel kuralı güne bölünür.

- Tam zamanlının aylık işveren maliyeti (net maaştan brüt, SGK ve işsizlik payları, ekler, yemek kartı; Maaşlar'daki
  "Size maliyeti") ayın **takvim günlerine** eşit bölünür: kapalı günde de maaş işler.
- Part-time'ın günlük ücreti (ve yemek kartı) Vardiya'da kendi şubesinde **çalıştığı güne** yazılır; aylık ek ödemesi
  günlere eşit dağılır.
- **Giderlerdeki maaş kalemleri kullanılmaz**: tarihleri ödeme günüdür, çalışılan güne düşmez. Vardiya saatleri (başlangıç
  / bitiş) ücreti saatlik olmadığı için tutarı değiştirmez; yalnız part-time'ın hangi gün çalıştığını söyler.
- **Ücret uydurulmaz.** Net maaşı ya da günlük ücreti yazılmamış kişi (`ucret-yok`) ve Vardiya bağlantısı olmayan
  part-time (`vardiya-yok`, çalıştığı gün bilinmez) adıyla uyarıda yazılır; tutarı hesaba girmez (işçilik olduğundan az
  görünür). Uyarı Maaşlar'a götürür.
- Günün cirosu kasa satırından (Kıyas'ın hücresi: KDV dahil, ödenmez hariç) ayın KDV hariç / KDV dahil oranıyla çevrilir;
  ayın günlerinin toplamı Gelir-gider'in cirosudur. Oranı bilinmeyen ayda satış KDV oranıyla.
- Verisi olmayan gün (kasa raporu, LafPOS gün sonu, föy yok) orana girmez: satırın oranı yalnız cirosu bilinen günlerin
  işçiliği ÷ cirosudur, not "n gün veri yok" yazar. Satışı olmayan gün (kapalı ya da sıfır Z) cirosu 0 olarak girer.
- Şube açılmadan önceki gün sayılmaz. Şubelerin toplamında bir şubenin günü bilinmiyorsa günün cirosu da bilinmiyor.

Biten ayın günlerinin işçilik toplamı Gelir-gider'in personeline eşittir (`tests/raporlar-db.test.ts`). Ayrılırsa (süren
ay: Gelir-gider maaşı son kasa raporunun gününe kadar oranlar, bu tablo bugüne kadar; elle yazılan açık gün) kartın
altında iki rakam ve neden yazılır.

## Kaçak raporu (Marina)

`/panel/raporlar/kacak`. Ayın son günündeki tahmini stok ([STOK-TAHMINI.md](STOK-TAHMINI.md); `loadStockEstimate(db,
now, asOf)` ayın son günüyle: o ayın sayımı başlangıç sayılmaz, önceki ayların en yenisi sayılır) ile **ayın sayımı**
karşılaştırılır.

```
fark = ayın sayımı − tahmini stok
tahmini = önceki sayım + Marina'ya gelen faturalı alış − LafPOS satışının reçeteye göre tüketimi × (1 + genel fire) − zayi ve ikram
TL = fark × malzemenin ay sonu birim maliyeti (Stok sayımı'nın fiyatı, `unitCostAtMonthEnd`, KDV hariç)
```

- Eksi fark **kaçaktır** (rafta olması gerekenden az); genel fire tahminin içinde olduğundan kaçak, olağan firenin
  üstündeki kayıptır. Artı fark **fazla**: çoğu kez Marina'ya işaretlenmemiş fatura ya da Tuzla'dan getirilen mal.
- Ekranda kaçak, fazla ve net TL; **En çok kaçan kalemler** (ilk 10), **Fazla çıkanlar** ve bütün kalemler (açılır).
  Her satırda tahmini, sayılan, fark, birim maliyet, TL, tahmine oranı ve tahminin dökümü (hangi ayın sayımından, alış,
  satış, zayi / ikram).
- Rapora girmeyenler sayılır, uydurulmaz: bu ay sayılmayan malzeme, tahmini olmayan (sayımı yok ya da dönemi LafPOS'tan
  önce başlıyor) ve fiyatı olmayan (fark miktarla yazılır, TL toplamına girmez).
- "Kaçak olduğundan büyük görünebilir" uyarısı: dönemde LafPOS gün sonu gelmeyen gün (ayın son günü dahil; o günlerin
  satışı düşülmedi) ya da ürüne bağlanmamış / reçetesi boş satış ve zayi satırı (tüketimi düşülmedi).
- Durumlar: Marina LafPOS'a geçmediyse rapor yok; ay bitmediyse yok (ay sonu sayımı ay bitince); seçilen ay Marina'da
  sayılmadıysa "sayım yok" ve Stok sayımı'na bağlantı. Seçicide Marina'nın sayıldığı bitmiş aylar.
- **İlk rapor:** tahmin, LafPOS satışlarının sayıldığı ilk günden sonra başlayan dönemde var. Marina 22 Kasım 2026'da
  LafPOS'a geçtiği için Kasım sonu sayımı ilk başlangıçtır; ilk kaçak raporu **Aralık 2026** sonu sayımıyla çıkar.
- Yalnız okur: stok sayımına, tahmine, FIFO'ya ve mal maliyetine yazmaz.

## Kayıp önleme

`/panel/raporlar/kayip`. LafPOS deposu değiştirilmeden, panelde var olan kişi bilgisiyle üç bölüm (`src/lib/kayip-onleme.ts`):

| Bölüm | Kişi | Nasıl |
|---|---|---|
| **Kasa farkı · kasayı sayana göre** (doğrudan) | Kasa raporunun "Kasayı sayan"ı; eski raporda gönderen | Rapor sayısı, toplam ve ortalama fark, eksik çıkan gün (1 ₺'den çok), en büyük eksik; **sapma** = kişinin ortalaması − aynı şubede başkalarının saydığı raporların ortalaması (iki tarafta da en az 3 rapor). "dikkat": sapma eksi yönde ve şubenin raporlarının standart sapmasından büyük |
| **Zayi & ikram · kaydı girene göre** (doğrudan) | Panelde kaydı giren | Kayıt sayısı, zayi ve ikramın malzeme maliyeti, şubedeki payı. Kaydı giren, ikramı yapan olmayabilir |
| **Çalıştığı günlere göre · kişiye yazılmaz** (dolaylı) | O gün çalışanlar: LafPOS'un gün sonundaki çalışan listesi (personel bağlantısı, `worked_staff`), yoksa Vardiya planı | Kasa farkı, iptal (liste değeri), ikram / ödenmez (menü değeri; Tuzla'da Z'nin ödenmezi) ve indirim: kişinin çalıştığı günlerin günlük ortalaması ve aynı şubede çalışmadığı günlerinkinden sapması (iki tarafta da en az 3 gün). ▲: sapma kötü yönde ve şubenin günden güne oynamasından büyük |

**LafPOS'tan gelmeyenler** (ekranda ve bu belgede açıkça): iptali yapan, ikramı ve ödenmezi veren (ödenmezde yalnız
kişinin türü: personel, müşteri, patron), indirimi yapan, LafPOS'ta kasayı sayan (LafPOS'un kendiliğinden yazdığı kasa
raporlarında `submitted_by` ve `counted_by` boş; vardiya devri sayımlarında da kişi yok). ModPOS (föy ve kasa raporu)
iptal göndermez: Tuzla'nın iptal sütunu "gelmiyor". Bu yüzden iptal, ikram ve indirim kişiye **yazılmaz**; üçüncü bölüm
yalnız "bu kişinin çalıştığı günlerde ne oluyor" sorusunu cevaplar, tek başına kanıt değildir (aynı gün çalışanların
hepsi aynı sapmayı alır). LafPOS'un otomatik kasa raporları birinci bölümde "kasayı sayan bilinmiyor" satırında,
üçüncüde günün değeri olarak sayılır.

Kişinin anahtarı: hesabı olan "u:<kullanıcı>", hesabı olmayan Vardiya adı "n:<ad>", bağlantısız personel "s:<kimlik>"
(LafPOS'un `s:<personel>` kimliği personelin hesabına ya da Vardiya adına çevrilir: `staffPersonKey`); hesabı silinmiş
kişi adıyla. Geçiş gününden önceki LafPOS gün sonları (deneme) sayılmaz.

Kişiye bağlı iptal / ikram / indirim için LafPOS'un bunları kişiyle göndermesi gerekir ([İkisi]; LafPOS deposunda
değişiklik, sahibin onayını bekler). Gelirse üçüncü bölüm doğrudan kişiye yazılır.

## Kararlar (26 Kasım 2026, tutucu varsayılan; geri alınabilir)

- Raporlar seçiciden bağımsız: şubeler hep yan yana. Seçiciyle süzmek isteniyorsa sayfa şubeyi okuyabilir.
- İşçilik günlüğe takvim günüyle bölünür (açık güne değil): maaş kapalı günde de işler. Giderlerdeki maaş ödemeleri
  kullanılmaz.
- Kaçak TL'si ay sonu birim maliyetiyle (FIFO katmanı değil): Stok sayımı'nın yeni miktar için kullandığı fiyat.
- Kayıp önlemede dolaylı bölüm gösterilir ama kişiye yazılmaz; eşik 3 gün / rapor, işaret şubenin standart sapması.

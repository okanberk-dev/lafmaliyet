# Öneri 8 + 9: Zam etkisi (TL/ay) ve 6 haftalık nakit planı

Grup: **insight** · Depo: `/home/user/lafmaliyet` (dal `claude/oneriler` = main) · Şema değişikliği: **yok**

Uygulamadan önce okunacaklar: `AGENTS.md` (bu Next.js farklı), `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`
(server action sonrası `refresh()`), mevcut kalıplar: `src/server/data/price-alerts.ts`, `src/lib/calc/price-impact.ts`,
`src/lib/reminders.ts`, `src/server/notify/digest.ts` (`loadUpcoming`), `src/app/panel/urunler/price-impact-panel.tsx`,
`src/app/panel/hatirlaticilar/*`, `src/app/panel/analiz/*`.

---

## 0. Amaç (tek paragraf)

Yönetici iki soruya tek bakışta cevap alsın. **(8)** “Son zamlar bana ayda kaç lira kâr kaybettiriyor, en çok hangi
hammadde ve hangi ürün?” Bugün panel zammı yüzde ve birim maliyet olarak gösteriyor (Ürünler › Hammadde zamları, son
30 gün). Bunu, reçetedeki miktar ve son satış ayının adetleriyle **ayda TL kâr kaybına** çeviriyoruz. Rakam mevcut
zam kartında, ürün kartında, Genel bakış uyarısında, zilde ve sabah e-postasında görünür. Daha uzun dönem için
Analiz & senaryo'ya üçüncü sekme **“Zam etkisi”** gelir. **(9)** “Önümüzdeki 4–6 haftada ne zaman ne ödeyeceğim,
elimde ne kalacak?” Ödemeler'deki vadeli faturalar ve hatırlatıcılar (kesin), kasa raporlarından beklenen satış,
hatırlatıcısı olmayan maaş, SGK, sabit gider ve yeni mal faturaları (tahmini) gün gün toplanır. Yönetici bakiyesini
girerse her haftanın sonunda kalan para ve en sıkışık gün görünür. Girmezse ödemeler için bugün en az ne kadar
gerektiği görünür. Yer: **Ödemeler'in alt ekranı `/panel/hatirlaticilar/nakit` (“Nakit planı”)** ve Genel bakış'ta
özet kart. İki özellik de saf hesap modülüne dayanır (testli), yeni tablo ya da bağımlılık eklemez. Tahminin her
varsayımı ekranda rakamlarıyla yazılır.

---

## 1. Öneri 8: Zam etkisi (ayda TL kâr kaybı)

### 1.1 Hesap

- **Zamlar:** mevcut `ingredientChanges(...)` kullanılır (pencere başındaki fiyat → bugünkü fiyat, %5 altı sayılmaz,
  su/buz ve pasif hammadde yok). Yeni kural yok.
- **Ürünün birim maliyet artışı** (KDV hariç, fire dahil). Ürünün her reçete satırı için:
  `Δsatır = miktar × (yeni birim fiyat − eski birim fiyat) × (1 + fireOranı)`. Burada
  `fireOranı = ürünün fire oranı (fireOverride ?? Ayarlar fire)`. `fireExcludesPackaging` açıksa ambalaj satırında
  çarpan 1'dir. Bu toplam, `productImpacts`'in `costAfter − costBefore` değerinin aynısıdır (test bunu doğrular).
  Kayıp yalnız **artan** hammaddelerden hesaplanır. Ucuzlayanlar ayrı bir “kazanç” olarak toplanır.
- **Ayda satılan adet:** referans satış ayının ürüne eşlenen ModPOS adedi (`model.soldByProduct(ay)`) ile online
  kafe adedi (`model.siteLines(ay).mapped`) toplanır, sonra **standart aya ölçeklenir**:
  `ölçek = Ayarlar.acikGun ÷ ay bilgisi.openDays`. Açık gün girilmemişse ölçek 1'dir. Süren ayda (16 gün geçmiş)
  adetler 30 güne büyür, bitmiş ayda ~1 kalır.
- **Referans ay:** Ürünler, ürün kartı, Genel bakış, zil ve e-postada `latestSalesMonth(model)` kullanılır.
  Analiz'de sayfanın seçili ayı (`?ay=`) kullanılır.
- **Ayda kâr kaybı:** ürün için `Δbirim × aylık adet`. Hammadde için, onu kullanan ürünlerdeki `Δsatır × aylık adet`
  toplamı. Toplam kayıp ürünlerin toplamına eşittir (test).
- **Bağlam:** referans ayın teorik brüt kârı × ölçek (`monthSales(ay).grossProfit × ölçek`), “brüt kârın %X'i” için.
- Dahil olmayanlar: zayi / ikram tüketimi, ürüne eşleşmeyen POS satırları (adedi gösterilir), pasif ürünler.

Örnek (Excel verisi, Eylül): Süt %2,5 51,85 → 60 ₺/L (+%16), aylık süt kullanımı ≈ 80,7 L. Sonuç ayda ≈ 690 ₺.

### 1.2 Kullanıcının göreceği

Tutar biçimi: tahmin olduğu için `≈ ` ön ekiyle `tl()` (tam lira). Kayıp kırmızı (`text-bad`), kazanç yeşil.

**a) Ürünler › Hammadde zamları (`#zamlar`, son 30 gün):**
- Kart başlığının `meta` alanı, referans ay varsa: **“Ayda ≈ 7.850 ₺ kâr kaybı”**. Yoksa bugünkü metin kalır.
- Hammadde çiplerinin altında tek satır (`text-xs text-ink-mute`): “Eylül 2026 satışlarına göre (ayda 30 açık
  gün). Ürüne eşleşmeyen satışlar sayılmadı.” Referans ay yoksa: “Ayda kaç lira tuttuğunu görmek için Satışlar'a
  ürün satış raporunu yükleyin.” ve “Satışlara git” bağlantısı.
- Çipin metni: “Süt %2,5 +%16 **· ayda 690 ₺**”. Ayda 1 ₺'nin altında, ya da referans ay yoksa bu ek görünmez.
  Telefonda çipler zaten sarılıyor.
- Ürün satırı (`ImpactItem`), birim kâr bilgisinin arkasına: “· **ayda ≈ 1.240 ₺ kayıp** (310 adet)”. Adet 0 ise
  “· bu ay satılmadı”.
- Fiyat önerisi bekleyen ürünler (`actionable`) **aylık kayba göre büyükten küçüğe** sıralanır. Eşitlikte bugünkü
  sıra korunur (dizinin sıralı kopyası, saf fonksiyon değişmez). Diğer liste (“rest”) olduğu gibi kalır.
- Kartın altına bağlantı: “Zam etkisinin tamamı →” `/panel/analiz?gorunum=zam`.

**b) Ürün kartı (`/panel/urunler/[id]`)**, mevcut “Hammadde zammı” kutusunda, `maliyet oranı …` cümlesinden sonra:
“Bu zam ayda ≈ 1.240 ₺ kâr götürüyor (Eylül'de 310 adet).” Referans ay yoksa cümle eklenmez.

**c) Genel bakış uyarısı ve zil:** `priceAlert(...)` metninin sonuna “Bu zamlar ayda ≈ 7.850 ₺ kâr götürüyor.”
eklenir. Başlık ve zildeki kimlik (`uyari-zam-…`) değişmez; okunmuş uyarı yeniden okunmamış olmaz.

**d) Sabah e-postası, zam bölümü:**
- Bölüm başlığının altında: “Bu zamlar ayda ≈ 7.850 ₺ kâr götürüyor (Eylül 2026 satışlarıyla).”
- Her hammadde satırının sağına: `… +%16 · ayda ≈ 690 ₺`.
- Düz metin sürümüne aynı iki ek. Satış ayı yoksa ek yazılmaz. Konu satırı değişmez.

**e) Analiz & senaryo › “Zam etkisi” (yeni üçüncü sekme, `?gorunum=zam`):**
- Sekme etiketleri: masaüstünde “Menü mühendisliği · Senaryo simülatörü · **Zam etkisi**”, telefonda “Menü analizi ·
  Senaryo · **Zamlar**”. Üç sekme 390 px'te eşit bölünür (mevcut `max-sm:[&>button]:flex-1` kalıbı).
- Sayfa açıklaması: “Excel'de olmayan üç araç: hangi ürünü öne çıkarmalı, hangisine zam yapmalı (menü mühendisliği),
  fiyat, maliyet ya da satış değişirse ay sonu ne olur (senaryo) ve hammadde zamları ayda kaç lira kâr götürüyor (zam
  etkisi).”
- Dönem seçici, sekmenin üstünde `SegmentedLinks` (sunucu yeniden çizer): **“Son 30 gün · Son 3 ay · Son 12 ay”**.
  Adres `?donem=30|90|365`, varsayılan **90**. Bağlantılar `ay` ve `gorunum=zam`'ı korur.
- Dayanak satırı: “Eylül 2026 satışlarına göre (30 açık günde 2.543 ürün), ayda 30 açık gün. Tutarlar KDV hariç.”
- Üç `Stat` karosu (telefonda 1, `sm`'de 3 sütun):
  1. “Aylık kâr kaybı” **≈ 7.850 ₺** (kötü ton). Alt satırda “brüt kârın %3,1'i”. Kazanç varsa ikinci satır: “Ucuzlayanlar
     ayda ≈ +1.200 ₺”.
  2. “Zamlanan hammadde” **5**. Alt satırda “en büyük etki: Süt %2,5”.
  3. “Etkilenen ürün” **23**. Alt satırda “8'inin maliyet oranı hedefin üstünde” ve `/panel/urunler#zamlar`
     bağlantısı.
- **Hammaddeler kartı:** satırlar aylık kayba göre (artanlar önce, sonra ucuzlayanlar). Telefonda her satır iki
  katlıdır: üstte ad ve “ayda ≈ 690 ₺”, altta “51,85 → 60 ₺/L · +%16 · ayda 80,7 L · 14 üründe · 15.10”. `sm` ve
  üstünde `Table`: Hammadde | Eski → yeni | Artış | Aylık kullanım | Ayda kâr kaybı. Satır
  `/panel/hammaddeler?ara=<ad>` adresine gider. Birimler okunur yazılır: gr → kg, ml → L, adet.
- **Ürünler kartı:** aylık kayba göre sıralı ilk 15 ürün, ardından “Tümünü göster (23)” düğmesi. Satır: “Latte · M”,
  “310 adet/ay · birim maliyet +4,00 ₺ · birim kâr 38,10 → 34,10 ₺”, sağda “ayda ≈ 1.240 ₺”. Rozet “Fiyatına bakın”
  (bugünkü `costRatio > hedef` ve `price < suggestedPrice`). Satır `productHref(id, ay)` adresine gider. Kart altında
  `ButtonLink` “Fiyat önerileri: Ürünler › Hammadde zamları”.
- Eşleşmeyen satış notu: “Ürüne eşleşmeyen 14 satış satırı hesaba girmedi” ve `/panel/satislar?ay=…&durum=eslesmeyen`
  bağlantısı.
- Hesap notu (kart altı, küçük): “Hesap: (yeni − eski birim fiyat) × reçetedeki miktar × (1 + fire) × ayda satılan
  adet. Eski fiyat dönem başındaki fiyattır. Adetler Eylül 2026 ModPOS satış raporundan ve laffogato.net online
  siparişlerinden, ayda 30 açık güne göre. Zayi, ikram ve ürüne eşleşmeyen satışlar dahil değil.”
- **Boş durum** (`EmptyState`, ikon `TrendingUp`): “Bu dönemde zam yok”. Açıklama: “Son 3 ayda fiyatı %5'ten fazla
  artan hammadde yok.” Eylem: “Son 12 aya bak” (`?donem=365`). Yalnız ucuzlayan varsa kayıp karosu 0 ₺ gösterir,
  kazanç satırı görünür.
- Analiz sayfasının bugünkü kuralı aynen kalır: seçili ayın satışı yoksa bütün sayfa “Bu ay için satış verisi yok”
  boş durumunu gösterir.

### 1.3 Veri modeli

Değişiklik yok. `ingredient_prices` (geçmiş), `sales_lines`, `months`, site satış kaydı ve reçeteler yeterli.

### 1.4 Sunucu ve saf mantık

**Yeni `src/lib/calc/price-loss.ts`** (saf, `Model` alır, sunucu bağımlılığı yok):

```ts
export interface SalesBasis {
  month: string;
  openDays: number | null;       // ay bilgisinden; yoksa null
  scale: number;                  // settings.acikGun / openDays, yoksa 1
  posQty: number;                 // ürüne eşlenen ModPOS adedi (ölçeksiz)
  onlineQty: number;              // online kafe adedi (ölçeksiz)
  unmatchedQty: number;           // eşleşmeyen POS satırlarının adedi
}
/** Ay satışsızsa (POS satırı da online eşlenmiş satır da yoksa) null */
export function salesBasis(model: Model, month: string): { basis: SalesBasis; perMonth: Map<number, number> } | null;

export interface IngredientLoss {
  ingredientId: number; name: string; unit: string;
  before: number; after: number; pct: number; changedAt: string;
  monthlyUsage: number;   // kendi biriminde, fire dahil, ölçekli
  monthly: number;        // TL/ay; artışta >0 (kayıp), indirimde <0
  productCount: number;   // satılan ürünlerden kaçında
}
export interface ProductLoss {
  productId: number; name: string; size: string; key: string; category: string | null;
  price: number; monthlyQty: number;
  unitDelta: number;      // yalnız artanlardan, fire dahil (= costAfter − costBefore)
  monthly: number;        // unitDelta × monthlyQty
  profitBefore: number; profitAfter: number;
  overTarget: boolean;    // costRatio > hedef && price < suggestedPrice (bugünkü)
  drivers: { ingredientId: number; name: string; pct: number; monthly: number }[];
}
export interface PriceLoss {
  basis: SalesBasis | null;
  ingredients: IngredientLoss[];   // artanlar aylık kayba göre azalan, sonra ucuzlayanlar
  products: ProductLoss[];         // unitDelta > 0 olanlar, monthly azalan
  totalLoss: number;               // Σ products.monthly
  totalGain: number;               // ucuzlayanların aylık kazancı (pozitif)
  grossProfit: number | null;      // referans ayın brüt kârı × ölçek
}
export function priceLoss(model: Model, changes: IngredientChange[], month: string | null): PriceLoss;
```

Algoritma: `model.activeProducts` üzerinde dön, `p.cost` 0 ise atla. Her satırda değişiklik varsa `fireMult`
hesaplanır, `Δsatır` ve aylık değer biriktirilir. Hammadde toplayıcısı imzalı değeri tutar (artış ve indirim).
Ürünün `unitDelta` değeri yalnız `pct > 0` satırlarından gelir. `month` null ya da satışsızsa `basis = null`, bütün
`monthly = 0` olur ve `unitDelta` yine hesaplanır.

**`src/lib/calc/price-impact.ts`:**
`priceAlert(changes, actionable, monthlyLoss?: number | null)`. `monthlyLoss >= 1` ise detayın sonuna
` Bu zamlar ayda ≈ ${tl(monthlyLoss)} kâr götürüyor.` eklenir. Parametre verilmezse metin bugünküyle birebir aynı
kalır.

**`src/server/data/price-alerts.ts`:**
- İmza `loadPriceAlerts(model, days = PRICE_ALERT_DAYS, month: string | null = latestSalesMonth(model))`.
- `PriceAlerts`'e `loss: PriceLoss` eklenir.
- `impacts` satırlarına `monthly: number | null` ve `monthlyQty: number | null` eklenir. Değer
  `loss.products`'tan `productId` ile alınır, `basis` yoksa null.
- Bütün tüketiciler (Ürünler, ürün kartı, Genel bakış, zil, e-posta, Analiz) aynı yükleyiciden alır. Ayrı bir hesap
  yolu açılmaz.

**`src/server/notify/digest.ts` › `loadDigestPrices`:**
- `loadModel()` sonucu bir değişkende tutulur.
- `fresh` değişiklikleri için `priceLoss(model, fresh, latestSalesMonth(model))` çağrılır.
- `DigestPrices.changes[i]`'ye `monthly?: number | null`, `DigestPrices`'a `monthlyTotal?: number | null` ve
  `basisMonth?: string | null` eklenir (isteğe bağlı alanlar; mevcut testler bozulmaz).

### 1.5 Dosyalar (8)

| Dosya | Değişiklik |
|---|---|
| `src/lib/calc/price-loss.ts` | **yeni**: `salesBasis`, `priceLoss` |
| `src/lib/calc/price-impact.ts` | `priceAlert`'e isteğe bağlı `monthlyLoss` |
| `src/server/data/price-alerts.ts` | `month` parametresi, `loss`, `impacts[].monthly/monthlyQty` |
| `src/app/panel/urunler/page.tsx` | `PriceImpactPanel`'e `loss={prices.loss}` (1 satır) |
| `src/app/panel/urunler/price-impact-panel.tsx` | meta, dayanak satırı, çip eki, satır eki, sıralama, Analiz bağlantısı. `ImpactRow`'a `monthly?`, `monthlyQty?` |
| `src/app/panel/urunler/[id]/page.tsx`, `[id]/recipe-editor.tsx` | `priceImpact`'te `monthly`/`monthlyQty`, kutuya tek cümle |
| `src/app/panel/page.tsx` | `priceAlert(..., priceAlerts.loss.totalLoss)` |
| `src/server/actions/notifications.ts` | `priceAlert(..., prices.loss.totalLoss)` |
| `src/server/notify/digest.ts`, `digest-template.ts` | aylık kayıp ekleri (HTML ve metin) |
| `src/app/panel/analiz/page.tsx` | `?donem` okuma, `loadPriceAlerts(model, days, month)`, `zam` sekmesine veri. Açıklama metni |
| `src/app/panel/analiz/analysis-client.tsx` | `AnalysisView = "menu" \| "senaryo" \| "zam"`, üçüncü seçenek, `<Activity>` |
| `src/app/panel/analiz/price-loss-view.tsx` | **yeni** (`"use client"`): sekme içeriği (dönem bağlantıları, karolar, iki liste, “Tümünü göster”) |

### 1.6 Kenar durumlar

- Excel tohumunda bütün fiyat satırları aynı anda yazıldığı için zam yoktur. Kart görünmez, Analiz sekmesi boş durumu
  gösterir. Mevcut davranış aynen kalır.
- Referans ay süren ayda ve açık gün girilmemişse ölçek 1 olur, tahmin düşük çıkar. Dayanak satırı ayı ve açık günü
  yazar.
- Aynı hammadde bir üründe iki satırda geçiyorsa iki satır da sayılır (reçete gibi).
- Fiyatı 0 olan reçeteli ürün dahil edilir (maliyeti var).
- `fireOverride` ve `fireExcludesPackaging` hesaba girer.
- Hammadde pasifse `ingredientChanges` onu zaten dışarıda bırakır.
- Grup 7 (şüpheli Paraşüt fiyatı onay bekler): onaylanmamış fiyat `ingredient_prices`'a yazılmadıkça zam sayılmaz.
  Onaylanınca normal görünür. Ek iş yok.
- Grup 11 (ürün fiyat geçmişi): ileride “fiyat artışıyla geri alınan” satırı eklenebilir. Şimdi kapsam dışı.

### 1.7 Testler (`tests/zam-etkisi.test.ts`, Excel verisi; kalıp `tests/price-impact.test.ts` gibi)

1. `salesBasis`: Eylül'de (30 açık gün, acikGun 30) ölçek 1. Açık gün 15 yapılınca ölçek 2. Online eşlenmiş satır
   adede eklenir. Eşleşmeyen satırlar `unmatchedQty`'ye girer. Satışsız ayda null.
2. Süt zammında her etkilenen ürün için `ProductLoss.unitDelta ≈ productImpacts(...).costAfter − costBefore`
   (1e-9 tolerans).
3. `totalLoss ≈ Σ products.monthly ≈ Σ ingredients(artan).monthly`.
4. `fireExcludesPackaging: true` iken ambalaj hammaddesinin zammında `fireMult = 1`. `fireOverride`'lı ürün kendi
   oranını kullanır.
5. Yalnız indirim: `products` boş, `totalLoss = 0`, `totalGain > 0`.
6. Ay null: `basis = null`, bütün `monthly = 0`, `unitDelta > 0`.
7. `priceAlert`: `monthlyLoss` verilmezse metin eski testteki gibi aynen kalır. Verilirse “ayda ≈ … ₺ kâr götürüyor”
   içerir. 0,4 ₺ verilince ek yazılmaz.
8. Süt +%16, Eylül: süt satırının aylık kaybı, `ingredientUsage × Δ × 1` ile `ingredientUsage × Δ × 1,2` arasında
   (≈ 690 ₺).

---

## 2. Öneri 9: Nakit planı (6 hafta)

### 2.1 Hesabın girdileri ve kuralları

Plan **bugünden başlayan 42 gündür** (6 dilim × 7 gün; hafta 1 = bugün…bugün+6). Takvim haftası değil, kayan 7 gün:
her dilimde her haftanın günü bir kez bulunur, kısmi hafta olmaz. Gün dizileri `in[i]`, `outKnown[i]`, `outEst[i]`
(i = 0…41) tutulur.

**Bugün kuralı:** girilen bakiye bugünü kapsar. Bu yüzden **gün 0'a yalnız ödenmemiş fatura ve hatırlatıcılar**
yazılır (gecikmişler dahil). Bütün tahminler (satış, online, yayılan sabit gider, mal alımı, varsayılan gündeki maaş
ve SGK) **yarından (i ≥ 1)** başlar.

| Satır (anahtar) | Tür | Kaynak ve kural |
|---|---|---|
| **Satışlar** (`sales`) | gelen, tahmini | **(a) Kasa:** `cash_reports` içinden `[bugün−28, bugün−1]` aralığında `zTotal > 0` olan raporlar. **En az 7 rapor** varsa `günlük = Σ zTotal ÷ rapor sayısı`, `kartPayı = Σ(card + mealCard) ÷ Σ zTotal`. **(b)** Yoksa bu aya kadarki, `openDays > 0` ve `posRevenue > 0` olan en son ay: `günlük = posRevenue ÷ openDays`, `kartPayı = Ayarlar.kartOrani`. **(c)** O da yoksa satış satırı olmaz. Günlük giriş = `günlük × (1 − komisyon × kartPayı) × min(1, acikGun ÷ 30)`, i ≥ 1. |
| **laffogato.net online** (`online`) | gelen, tahmini | Site satış kaydı varsa: bu aya kadarki son ay. Kapanmışsa `gün = ayın gün sayısı`, değilse `gün = bugünün günü − 1` (7'den azsa bir önceki ay). `günlük = (cafe.netMinor + shop.netMinor + karaoke.netMinor) ÷ 100 ÷ gün`. KDV dahil, iade düşülmüş, kesinti düşülmez. i ≥ 1. |
| **Faturalar** | giden, kesin | `loadUpcoming().items` içinden `source === "invoice"` ve `daysLeft ≤ 41` olanlar. Tutar kalan borçtur (`outstanding`, yoksa `payable`). Vadesizse tedarikçi kartının vadesi, yoksa bildirim ayarındaki gün (bugünkü kural). `daysLeft < 0` olan **gün 0'a**, “Gecikmiş” işaretiyle. Ufuk 45 gün ≥ 42 (sabit ve testli). Kafe dışı (Karaoke box, Alp Koç) faturaları da girer (Ödemeler gibi). |
| **Hatırlatıcılar** | giden, kesin | Etkin her hatırlatıcının plan içindeki dönemleri (§2.4 `reminderOccurrences`). Geciken dönem gün 0'a, sonra ≥ bugün olan bütün dönemler ≤ bugün+41. **Tutarı > 0 olan** dönem kesin sayılır. Tutarsız olan aşağıdaki eşleşmeye bakar. |
| **Maaşlar** (`salary`) | giden, tahmini | Personel sayfası. Ödeme günü P için ay = `P.gün ≤ 15 ? P'nin önceki ayı : P'nin ayı`. Tutar = `personnelFor(ay).net + extras`. **Gün:** (1) maaş türünde hatırlatıcı yoksa her ayın **1'i** (i ≥ 1). (2) Maaş türünde hatırlatıcı varsa ve **hiçbirinde tutar yoksa**, kimliği en küçük olanın dönemlerinde (gün 0 dahil) “tahmini” olarak. (3) Tutarlı maaş hatırlatıcısı varsa tahmin yapılmaz. |
| **SGK primi** (`sgk`) | giden, tahmini | Tutar = `personnelFor(önceki ay)`: `deductions + employerSgk + employerUnemployment`. Gün: SGK türünde hatırlatıcı yoksa **ayın son günü**. Varsa maaştaki (2)/(3) kuralı aynen. |
| **Sabit giderler** (`fixed:<id>`) | giden, tahmini | Her gün d (i ≥ 1) için `fixedInMonth(ay(d))` (sürümlü tutar). Kalem **bir hatırlatıcıyla eşleşiyorsa** yayılmaz (§2.4 eşleşme). Aylık: `tutar ÷ ayın gün sayısı`. Haftalık: `tutar ÷ 7`. Günlük: `tutar × min(1, acikGun ÷ 30)`. **Yıllık plana girmez**, “Dahil değil” listesine yazılır. Tutarsız bir hatırlatıcı bu kalemle eşleşiyorsa o hatırlatıcının dönemlerine **kalemin tutarı** “tahmini” yazılır. |
| **Mal alımı** (`goods`) | giden, tahmini | `GOODS_CATEGORIES` faturaları (kafe dışı ve demirbaş girmez), tarih `[bugün−aralık, bugün−1]`. `aralık = min(56, bugün − en eski mal faturası)`. Aralık **< 14 gün** ise tahmin yok. Her fatura `payable ÷ aralık` günlük oranla ve **gecikmeyle** katkı verir: peşin çalışılan tedarikçide 0, değilse kart vadesi, o da yoksa bildirim ayarındaki gün. Gün i'de (i ≥ 1) çıkış = gecikmesi `≤ i − 1` olan oranların toplamı. Böylece bugünden sonra kesilecek faturalar vadelerinde ödenmiş olur; mevcut ödenmemiş faturalarla çakışmaz. |

**Tutarı belli olmayanlar:** yukarıdaki eşleşmelerin hiçbirine girmeyen tutarsız hatırlatıcılar (ör. “KDV beyannamesi
ve ödemesi”). Plana girmezler, “Tutarı girilmemiş ödemeler” listesinde (ad ve ilk tarih) görünürler.

**Dahil değil (metinde yazılır):** tutarı girilmemiş vergiler, Aylık harcamalar'daki fatura dışı ödemeler, yıllık
sabit giderler, yatırım ve kredi taksitleri, kart ve yemek kartı tahsilat gecikmesi.

**Bakiye:**
- Yönetici bakiye girdiyse `bakiye[i] = bakiye[i−1] + in[i] − out[i]`, başlangıç girilen tutar (bugün).
- Her dilim için hafta sonu bakiyesi ve dilimdeki en düşük gün bulunur. `firstNegative` ilk eksi gündür, `lowest`
  en düşük gündür.
- Bakiye yoksa aynı hesap 0'dan “birikimli net” olarak yürür. `requiredCash = max(0, −en düşük birikimli)`:
  ödemeleri yapabilmek için bugün gereken en az para.
- Bakiye 3 günden eskiyse uyarı gösterilir (hesap yine girilen tutarla bugünden başlar).

### 2.2 Kullanıcının göreceği

**a) Yeni ekran: `/panel/hatirlaticilar/nakit` — “Nakit planı”** (yalnız yönetici)

- `PageHeader`: eyebrow “Satış & gider”, başlık “Nakit planı”, açıklama “Önümüzdeki 6 hafta: gelecek para,
  ödenecekler ve elinizde kalacak tahmini para.” Eylemler: `ButtonLink` “Ödemeler” (ikincil, `/panel/hatirlaticilar`)
  ve `Button` “Bakiyeyi gir” (bakiye varsa “Bakiyeyi güncelle”).
- Kenar çubuğu ve telefon alt menüsünde “Ödemeler” etkin kalır (`pathMatches` alt yolu kapsar). Telefonun üst çubuğu
  “Nakit planı” yazar.
- **Karolar** (telefonda 2×2, `md`'de 4 sütun; Ödemeler'deki karolarla aynı görsel dil, `Stat` ya da aynı sınıflar):
  1. “Elinizdeki para”: `tl(bakiye)`. Alt satır “22 Ekim'de girildi”. 3 günden eskiyse turuncu “5 gün önce girildi ·
     güncelleyin”. Bakiye yoksa “Girilmedi” ve “Gir” düğmesi.
  2. “Gelecek para”: Σ gelen. Alt satır “Satış ve online, tahmini”.
  3. “Ödenecek”: Σ giden. Alt satır “Kesin 182.400 ₺ · tahmini 206.600 ₺”.
  4. Bakiye varsa “6 hafta sonra”: `tl(son bakiye)`, eksi ise kırmızı. Alt satır “En sıkışık: 1 Kas · 8.200 ₺”. Bakiye
     yoksa “Gereken en az para”: `tl(requiredCash)`, alt satır “1 Kasım'daki ödemeler için”. `requiredCash = 0` ise
     karo “Net” ve “+42.000 ₺” gösterir, alt satır “Gelen gidenden fazla”.
- **Uyarı şeridi** (karoların altında, tek tane):
  - Eksi gün varsa (kırmızı, `role="status"`): “**1 Kasım Cumartesi para yetmeyebilir:** tahmini −12.400 ₺. O gün:
    Kira 160.000 ₺, Maaşlar (Ekim, tahmini) 60.000 ₺.” (o günün en büyük 2 gideri).
  - Bakiye yok ve `requiredCash > 0` ise (bilgi tonu): “Önümüzdeki 6 haftanın ödemeleri için bugün elinizde en az
    45.000 ₺ olmalı (en sıkışık gün 1 Kasım).” Yanında “Bakiyeyi gir” düğmesi.
  - Bakiye var ve eksi gün yoksa (yeşil): “6 hafta boyunca para yetiyor; en sıkışık gün 1 Kasım: 8.200 ₺.”
- **Haftalar kartı** (`xl:col-span-8`; telefonda ve masaüstünde aynı liste):
  - Her dilim bir `<li>`. Üstte “**Bu hafta** · 22–28 Eki” (sonrakiler “Gelecek hafta”, “3. hafta”…). Ay geçişinde
    “29 Eki – 4 Kas” biçimi.
  - Orta satır: “Gelen **+68.900 ₺**” (yeşil) ve “Giden **−121.300 ₺**” (kırmızı). Altında iki ince çubuk (gelen ve
    giden), en büyük haftalık tutara göre ölçekli, düz CSS.
  - Sağda: “Hafta sonu **32.600 ₺**” (eksiyse kırmızı). Bakiye yoksa “Net −52.400 ₺”.
  - Satırın tamamı bir açma düğmesidir (`aria-expanded`, `aria-controls`). Açılınca üç grup görünür:
    - **Ödenecekler (kesin):** her fatura ve hatırlatıcı satırı. Solda `DateTile` (`hatirlaticilar/payment-ui`'den),
      ad, “Fatura 2026-123”, gecikmişse kırmızı “Gecikmiş” rozeti, sağda tutar. 8'den fazlaysa “ve 5 ödeme daha”.
    - **Tahmini:** “Maaşlar (Ekim)” 1 Kas · 60.000 ₺, “SGK primi (Eylül)” 31 Eki · 23.118 ₺, “Sabit giderler” (ay içine
      yayıldı) · 46.300 ₺ (ⓘ en büyük 4 kalem ve haftalık payları), “Mal alımı (yeni faturalar)” · 18.400 ₺ (ⓘ en büyük
      4 tedarikçi, haftalık ortalama ve vadesi). Hepsinde gri “tahmini” rozeti.
    - **Gelecek:** “Satışlar” · 68.900 ₺, “laffogato.net online” · 2.900 ₺ (tahmini).
  - Açılışta ilk eksi günün dilimi açık gelir; eksi gün yoksa “Bu hafta” açık gelir.
  - Fatura satırı `/panel/hatirlaticilar?kaynak=fatura` adresine, hatırlatıcı satırı `/panel/hatirlaticilar`
    adresine gider.
- **Yan sütun** (`xl:col-span-4`, telefonda haftaların altında):
  - **“Nasıl hesaplandı”** kartı. Her varsayım bir satır, rakamlarıyla (metinler §2.4 `planNotes`):
    - Satışlar: “Son 28 günün 24 kasa raporuna göre günde ortalama 9.850 ₺ (Z toplamı). Kartla ödenen %78 için %2,5
      komisyon düşüldü; ayda 30 açık gün (Ayarlar). Tahmin yarından başlar: bugünkü satış elinizdeki paraya dahil
      sayılır.” POS yedeği: “Son 28 günde yeterli kasa raporu yok; Ekim 2026 POS cirosuna göre günde 18.369 ₺ (16 açık
      gün).” Satış yoksa: “Satış verisi yok: gelen para sayılmadı. Kasa raporu girildikçe tahmin oluşur.”
    - Online: “laffogato.net Eylül 2026 online satışına göre günde 420 ₺ (iadeler düşülmüş). Ödeme kuruluşunun kesintisi
      ve aktarım günü düşülmedi.”
    - Faturalar: “Ödenmemiş faturaların kalan borcu, vade gününde. Vadesi yazılmamışsa tedarikçinin vadesi, yoksa 30
      gün. Gecikmiş 2 fatura bugüne yazıldı.”
    - Hatırlatıcılar: “Ödemeler'deki hatırlatıcılar, her tekrarıyla.”
    - Maaşlar: “2 kişinin net maaşı ve ek ödemeleri (ayda 60.000 ₺), her ayın 1'inde. Ödemeler'e tutarlı bir Maaş
      hatırlatıcısı eklerseniz onun günü ve tutarı geçerli olur.”
    - SGK: “İşçi ve işveren SGK + işsizlik payları (ayda 23.118 ₺), takip eden ayın son günü. Gelir ve damga vergisi
      dahil değil.”
    - Sabit giderler: “Hatırlatıcısı olmayan 13 sabit gider (ayda 271.700 ₺) ay içine eşit yayıldı. Gününü bilmek için
      Ödemeler'e ekleyin.”
    - Mal alımı: “Son 56 günün mal faturalarına göre haftada 18.400 ₺. Yeni faturalar tedarikçinin vadesinde ödenir,
      peşin çalışılanlar hemen.” Yetersizse: “Mal alımı tahmini için en az 2 haftalık fatura gerekir.”
    - Çift sayım: “Aynı ödeme hem hatırlatıcı hem fatura olarak duruyorsa iki kez sayılır (Ödemeler'deki gibi). Faturası
      ayrıca gelen sabit gideri ‘Tahmine katılanlar’dan çıkarın.”
    - Dahil değil: “Tutarı girilmemiş vergiler (KDV vb.), Aylık harcamalar'daki fatura dışı ödemeler, yıllık giderler
      (ModPOS / Patron aboneliği), yatırım ve kredi.”
    - Kart altında `Button` (ikincil): **“Tahmine katılanlar”**.
  - **“Tutarı girilmemiş ödemeler”** kartı (varsa): “KDV beyannamesi ve ödemesi · 28 Eki” satırları ve
    `ButtonLink` “Ödemeler'de tutar girin”.
- **Bakiye penceresi** (`ui/dialog`):
  - Başlık “Elinizdeki para”. Açıklama: “Bankadaki ve kasadaki paranın bugünkü toplamı. Plan bu tutardan başlar;
    birkaç günde bir güncelleyin.”
  - Alan “Tutar (₺)” (`NumberInput`, `parseNumberTR`; eksi kabul edilir, kredili hesap için).
  - Son kasa raporu varsa ipucu: “Son kasa raporu (21 Ekim): ertesi güne 3.450 ₺ devretti.”
  - Düğmeler: “Kaydet”, “Vazgeç”, bakiye varsa “Bakiyeyi kaldır” (hayalet).
  - Toast: “Bakiye kaydedildi: 85.000 ₺” / “Bakiye kaldırıldı”.
  - `?bakiye=1` ile açılır (Genel bakış'tan gelen bağlantı). Açılınca parametre silinir.
- **Tahmine katılanlar sayfası** (`hatirlaticilar/sheet.tsx` `Sheet`, `size="lg"`):
  - Başlık “Tahmine katılanlar”. Açıklama: “Hatırlatıcısı olmayan düzenli giderler ve beklenen satışlar. Faturası
    ayrıca gelen bir gideri kapatın; iki kez sayılmasın.”
  - Satırlar `ToggleRow`: Satışlar, laffogato.net online, Maaşlar, SGK primleri, Mal alımı (yeni faturalar) ve
    hatırlatıcısı olmayan her sabit gider. Örnek: “Elektrik (ana fatura) · ayda 12.000 ₺ · ay içine yayılır”.
  - Hatırlatıcısı olan kalemler kapalı ve devre dışı gösterilir: “Ödemeler'de hatırlatıcısı var”. Yıllıklar da devre
    dışı: “Yıllık: gününü bilmek için Ödemeler'e ekleyin”.
  - Altbilgi: “Kaydet” ve “Vazgeç”.
  - Bağlantı “Gününü girmek için Ödemeler'e ekle →”. Önce sayfayı kapatır, sonra
    `router.push("/panel/hatirlaticilar?ekle=sabit")` (pencere gezinmeden önce kapanır kuralı).
- **Boş durum:** hiç veri yoksa (satış dayanağı yok, fatura ve tutarlı hatırlatıcı yok, personel ve sabit gider yok)
  `EmptyState` gösterilir. Başlık “Plan için veri yok”. Açıklama “Kasa raporu, hatırlatıcı, fatura ya da personel
  girildikçe önümüzdeki 6 hafta burada görünür.” Eylem `ButtonLink` “Ödemelere git”.
- **Telefon (390 px):** karolar 2×2, uyarı şeridi tam genişlik, haftalar kart listesi. Hafta satırı üç katlıdır:
  başlık + açma oku; gelen/giden ve çubuklar; sağa yaslı “Hafta sonu”. 44 px dokunma alanı. Yan kartlar haftaların
  altında. Yatay kaydırma yok.

**b) Ödemeler & hatırlatıcılar (`/panel/hatirlaticilar`):**
- `PageHeader` eylemlerine, mevcut “Hatırlatıcı ekle”den önce, `ButtonLink` “**Nakit planı**” (ikincil, ikon
  `ChartNoAxesColumn`). Telefonda da görünür.
- `?ekle=sabit` gelince `ReminderSheet` “Sabit giderlerden ekle” adımında açılır, parametre silinir. Bunun için
  `ReminderSheet`'e `initialStep?: "pick" | "fixed"` eklenir; `RemindersClient` `useQueryState("ekle", "")` ile okur ve
  çizim sırasında `setEditing` yapar (dosyadaki mevcut “önceki değeri izle” kalıbı).

**c) Genel bakış (`/panel`), yeni “Nakit planı” kartı:**
- Yer: bölüm 2'nin sol sütunu, `DashboardPayments`'ın altında, `DashboardAlerts`'in üstünde. Seçili aydan bağımsızdır
  (bugüne göre), Yaklaşan ödemeler kartı gibi her ayda görünür. Plan verisizse ya da yüklenemezse kart görünmez.
- `CardHeader`: ikon `Wallet`, başlık “Nakit planı”, açıklama “Önümüzdeki 6 hafta · tahmini”. Eylem `ButtonLink`
  “Planı aç” → `/panel/hatirlaticilar/nakit`.
- Gövde, bakiye varsa: büyük rakam “6 hafta sonra ≈ 84.000 ₺”. Altında “En sıkışık: 1 Kas · 8.200 ₺”, eksi günde
  kırmızı “1 Kasım'da para yetmeyebilir (−12.400 ₺)”. Sonra küçük satır “Gelecek 412.000 ₺ · Ödenecek 389.000 ₺”.
  Bakiye 3 günden eskiyse “Bakiye 5 gün önce girildi”.
- Gövde, bakiye yoksa: “Gereken en az para ≈ 45.000 ₺” (ya da “6 haftada net +42.000 ₺”) ve bağlantı “Bakiyenizi
  girin, kalanı görün” → `/panel/hatirlaticilar/nakit?bakiye=1`.
- Sunucu bileşenidir, istemci kodu yok.

### 2.3 Veri modeli

Tablo ya da sütun eklenmez. Plan ayarı `integration_state` tablosunda tek anahtarda durur (`prices.ack`,
`cash.settings` kalıbı):

```ts
// anahtar: "cashflow.plan"
interface CashPlanState {
  balance: number | null;      // girilen bakiye (TL)
  balanceDate: string | null;  // YYYY-MM-DD (Türkiye), girildiği gün
  balanceBy: string | null;    // girenin adı
  excluded: string[];          // tahminden çıkarılan anahtarlar: "sales" | "online" | "salary" | "sgk" | "goods" | `fixed:${id}`
}
```

Neden tablo değil: tek satırlık bir ayar, geçmişi tutulmuyor (değişiklik `activity_log`'a yazılır). Silinmiş sabit
giderin `fixed:<id>` anahtarı sessizce yok sayılır. `npm run db:reset` bu anahtara dokunmaz (README'deki “Silmedikleri”
listesine eklenir).

### 2.4 Sunucu ve saf mantık

**Yeni `src/lib/cash-plan.ts`** (saf; `reminders.ts`, `calc/engine.ts` tipleri ve `format.ts` kullanılır):

```ts
export const PLAN_WEEKS = 6;
export const PLAN_DAYS = PLAN_WEEKS * 7;            // 42; ≤ UPCOMING_HORIZON_DAYS (45), testli
export const SALES_LOOKBACK_DAYS = 28;
export const MIN_SALES_REPORTS = 7;
export const GOODS_LOOKBACK_DAYS = 56;
export const MIN_GOODS_DAYS = 14;
export const STALE_BALANCE_DAYS = 3;

export type PlanKind = "sales" | "online" | "invoice" | "reminder" | "salary" | "sgk" | "fixed" | "goods";

export interface CashPlanInput {
  today: string;
  opening: { amount: number; date: string } | null;
  excluded: readonly string[];
  settings: { komisyon: number; kartOrani: number; acikGun: number };
  invoiceTermDays: number;
  cashReports: readonly { date: string; zTotal: number; card: number; mealCard: number }[];
  posMonth: { month: string; posRevenue: number; openDays: number } | null;
  online: { month: string; perDay: number } | null;
  invoices: readonly UpcomingItem[];                 // source "invoice"
  reminders: readonly ReminderRow[];
  goods: readonly { supplier: string; date: string; payable: number; lagDays: number }[];
  goodsSpanDays: number;                             // 0 = yetersiz geçmiş
  months: Readonly<Record<string, {                  // önceki aydan ufkun son ayına kadar
    payroll: { net: number; sgk: number; people: number };
    fixed: readonly { id: number; name: string; period: FixedPeriod; amount: number }[];
  }>>;
  fixedNames: readonly { id: number; name: string; period: FixedPeriod }[];   // bütün sabit giderler (eşleşme için)
}

export interface PlanLine {
  key: string;            // "invoice:12", "reminder:4@2026-11-01", "salary@2026-11-01", "sgk@2026-10-31", "fixed", "goods", "sales", "online"
  kind: PlanKind;
  direction: "in" | "out";
  title: string;          // "Sütaş", "Kira", "Maaşlar (Ekim)", "SGK primi (Eylül)", "Sabit giderler", "Mal alımı (yeni faturalar)", "Satışlar", "laffogato.net online"
  date: string | null;    // yayılan satırlarda null
  amount: number;
  estimated: boolean;
  overdue: boolean;
  detail?: string;        // "Fatura 2026-123 · vade tahmini (30 gün)" / "Kira 37.300 ₺ · Influencer 11.700 ₺ …"
  href?: string;
}
export interface PlanWeek {
  index: number; from: string; to: string;
  in: number; outKnown: number; outEstimated: number; net: number;
  endBalance: number | null; cumulative: number;
  low: { date: string; value: number };               // dilimin en düşük günü (bakiye ya da birikimli)
  lines: PlanLine[];                                    // kesinler tarih sırasıyla, sonra tahminler, sonra gelenler
}
export interface EstimateRow {
  key: string; title: string; monthly: number;
  status: "on" | "off" | "covered" | "yearly";
  note?: string;
}
export interface CashPlan {
  today: string; end: string;
  opening: { amount: number; date: string; staleDays: number } | null;
  weeks: PlanWeek[];
  totals: { in: number; outKnown: number; outEstimated: number; net: number; endBalance: number | null };
  firstNegative: { date: string; balance: number; top: PlanLine[] } | null;
  lowest: { date: string; value: number; basis: "balance" | "cumulative" } | null;
  requiredCash: number;                                 // bakiye yokken; varken 0
  basis: {
    sales: { kind: "kasa"; reports: number; daily: number; cardShare: number }
         | { kind: "pos"; month: string; daily: number; openDays: number }
         | { kind: "none" };
    online: { month: string; perDay: number } | null;
    goods: { spanDays: number; weekly: number; top: { supplier: string; weekly: number; lagDays: number }[] } | null;
    payroll: { people: number; net: number; sgk: number } | null;
    fixedSpread: { count: number; monthly: number };
    overdueInvoices: number;
  };
  unknownAmounts: { reminderId: number; title: string; date: string }[];
  notIncluded: { title: string; amount: number; period: FixedPeriod }[];   // yıllık sabit giderler
  estimates: EstimateRow[];
  hasData: boolean;
}

export function buildCashPlan(input: CashPlanInput): CashPlan;
export function reminderOccurrences(r: ReminderRow, today: string, end: string): { date: string; due: string; overdue: boolean }[];
export function goodsRows(invoices: readonly { supplier: string; date: string; payable: number; category: string }[], today: string,
  lagOf: (supplier: string) => number): { rows: CashPlanInput["goods"]; spanDays: number };
export function planInputFromModel(model: Model, today: string): Pick<CashPlanInput, "settings" | "posMonth" | "online" | "months" | "fixedNames">;
export function weekTitle(index: number): string;   // "Bu hafta" | "Gelecek hafta" | "3. hafta"
export function rangeText(from: string, to: string): string;   // "22–28 Eki", "29 Eki – 4 Kas"
export function planNotes(plan: CashPlan, opts: { komisyon: number; acikGun: number; invoiceTermDays: number }): { key: string; title: string; text: string }[];
```

`reminderOccurrences` kuralları:
- `dueDate < bugün` ise `{date: bugün, due: dueDate, overdue: true}` yazılır. Ardından `nextOccurrence` ile ≥ bugün
  olan ilk döneme ilerlenir (aradaki kaçan dönemler sayılmaz; `upcomingItems`'teki kuralın aynısı).
- Sonra `≤ end` olan bütün dönemler. `repeat = none` ise tek dönem. Döngü koruması 400.

Hatırlatıcı **sınıflandırması** (yalnız etkin olanlar):
1. `foldName(title) === foldName(fixed.name)` olan bir sabit gider varsa → **sabit gider türü** (`fixed:<id>`). Kalemin
   yayılan tahmini kapanır. `foldName`, `components/ui/filters.tsx` `fold` ile aynı algoritmadır: tr küçük harf, ı→i,
   NFD aksan silme. “Listede var” rozetiyle aynı sonucu vermesi için kopyalanır; lib istemci dosyası içe aktarmaz.
2. Değilse `reminderCategory(kind, title)`: `"maas"` ise **maaş türü**, `"sgk"` ise **SGK türü**, başka bir şeyse
   **diğer**.

Not: `addFixedExpenseReminder` personel bölümündeki kalemi `kind: "maas"` ile açar (ör. “Muhasebeci”). Ad eşleşmesi
önce baktığı için bu hatırlatıcı maaşı kapatmaz (testli).

Dönem tutarı:
- Tutar > 0 ise kesin.
- Tutar yoksa sabit gider türünde kalemin o ayki tutarı (tahmini). Maaş ya da SGK türünde ve “taşıyıcı” ise (o türdeki
  hatırlatıcıların hiçbirinde tutar yok ve bu en küçük kimlikli olan) bordro tutarı. Taşıyıcı değilse ya da diğer
  türdeyse `unknownAmounts` listesine girer.
- `excluded` içindeki anahtarın (`salary`, `sgk`, `fixed:<id>`) tahminleri, hatırlatıcının taşıdıkları dahil, hiç
  yazılmaz.

**Yeni `src/server/data/cash-plan.ts`** (`import "server-only"`):

```ts
export const CASH_PLAN_KEY = "cashflow.plan";
export async function loadCashPlanState(): Promise<CashPlanState>;   // bozuk ya da eksik değer → varsayılan (null, [])
export interface CashPlanView { plan: CashPlan; state: CashPlanState; carry: { date: string; amount: number } | null }
export async function loadCashPlan(model: Model, upcoming?: Awaited<ReturnType<typeof loadUpcoming>>): Promise<CashPlanView>;
```

`loadCashPlan` şunları paralel okur:
- `loadCashPlanState()`
- `cashReportsBetween(addDays(today, −28), addDays(today, −1))`
- `loadTermDays()`, `loadPaidOnDelivery()` (`server/data/suppliers.ts`)
- `previousCarryOver(addDays(today, 1))` (ipucu için)
- `upcoming ?? loadUpcoming()`

Mal faturaları `model.ds.invoices`'tan gelir (ek sorgu yok). Gecikme: `paidOnDelivery(supplier) ? 0 :
(termDays(supplier) ?? settings.invoiceTermDays)`. `today = upcoming.today`. Sonuç `buildCashPlan(...)` ile hesaplanır.

**Yeni `src/server/actions/cash-plan.ts`** (`"use server"`; `attempt`, `requireAdmin`, zod, `logActivity`,
`refresh()`; okuma-değiştirme-yazma `updatePriceAck` gibi `transaction` + `for("update")` ile):

- `saveCashBalance(amount: number | null)`: `zMoney.min(-100_000_000).max(100_000_000).nullable()`. Yazılan değerler:
  `balance`, `balanceDate = todayTR()`, `balanceBy = me.name`. `excluded` korunur. Günlüğe “Nakit planı: bakiye”
  yazılır, açıklama `tl(amount)` ya da “kaldırıldı”.
- `saveCashPlanExcluded(keys: string[])`:
  `z.array(z.string().regex(/^(sales|online|salary|sgk|goods|fixed:\d+)$/)).max(200)`, tekilleştirilir. Günlüğe “Nakit
  planı: tahmin ayarı” ve “N kalem tahmine katılmıyor” yazılır.

### 2.5 Dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/lib/cash-plan.ts` | **yeni**: saf hesap ve metinler |
| `src/server/data/cash-plan.ts` | **yeni**: durum ve yükleyici |
| `src/server/actions/cash-plan.ts` | **yeni**: `saveCashBalance`, `saveCashPlanExcluded` |
| `src/app/panel/hatirlaticilar/nakit/page.tsx` | **yeni**: `Suspense` + `PageHeader` iskeleti; `requireAdmin()`, `loadModel()`, `loadCashPlan(model)` |
| `src/app/panel/hatirlaticilar/nakit/cash-plan-client.tsx` | **yeni** (`"use client"`): karolar, şerit, haftalar (aç/kapa), yan kartlar, `?bakiye=1` |
| `src/app/panel/hatirlaticilar/nakit/balance-dialog.tsx` | **yeni**: bakiye penceresi (`ui/dialog`) |
| `src/app/panel/hatirlaticilar/nakit/estimates-sheet.tsx` | **yeni**: “Tahmine katılanlar” (`../sheet`, `ui/toggle-row`) |
| `src/app/panel/dashboard-cash-plan.tsx` | **yeni**: Genel bakış kartı (sunucu bileşeni) |
| `src/app/panel/page.tsx` | `loadPayments` tam `loadUpcoming()` sonucunu döndürür (`items` ayrıca). `loadCashPlan(model, upcomingAll).catch(() => null)` `loadPriceAlerts` ile paralel çalışır. Kart sol sütunda |
| `src/app/panel/hatirlaticilar/reminders-client.tsx` | “Nakit planı” düğmesi, `?ekle=sabit` |
| `src/app/panel/hatirlaticilar/reminder-sheet.tsx` | `initialStep` prop'u |
| `src/components/panel/nav.ts` | `NAV_GROUPS` › “Para” grubuna ⌘K öğesi `{ href: "/panel/hatirlaticilar/nakit", label: "Nakit planı", icon: ChartNoAxesColumn, roles: ["admin"], keywords: "nakit akış tahmin bakiye kalan para haftalık plan sıkışık" }`. `SHORT_TITLES["/panel/hatirlaticilar/nakit"] = "Nakit planı"`. `NAV_TREE` ve `BOTTOM_NAV` değişmez |
| `src/app/panel/yardim/page.tsx` | iki SSS (§4) |

### 2.6 Kenar durumlar ve komşu özellikler

- **Ödemeler'de “Ödendi”, erteleme, vade değişikliği:** eylemler zaten `refresh()` çağırıyor, plan bir sonraki
  çizimde güncel veriyi okur. Planın kendi “ödendi” düğmesi yok (tek yer Ödemeler).
- **Son ödenenler / geri al:** geri alınan fatura yine ödenmemiş olur ve plana döner.
- **Peşin çalışılan tedarikçi:** faturası ödenmiş gelir, kesin listede yoktur. Mal alımı tahmininde gecikme 0'dır.
- **Kısmen ödenmiş fatura:** kalan borç kullanılır (`outstanding`).
- **Kasa raporu revizyonu:** son değerler okunur (`cash_reports` tek satır). Grup 10 bir revizyon tablosu eklese de bu
  hesap yalnız `date, zTotal, card, mealCard` okur.
- **Grup 6** ay bilgisini Z raporlarından doldurursa POS yedeği daha sık dolu olur. Ek iş yok.
- **Personelsiz ya da sabit gidersiz kurulum:** ilgili tahmin satırları görünmez.
- **Bakiye eksi girildiyse** (kredili hesap) hesap aynen yürür, ilk gün zaten eksi olur.
- **Saat dilimi:** bütün tarihler `todayTR()` (Vercel UTC'de çalışır).
- **Performans:** Genel bakışa 4 küçük sorgu eklenir (durum, 28 günlük kasa, iki tedarikçi okuması, devir).
  `loadUpcoming` ve `loadModel` zaten okunuyor ve paylaşılır. Hesap 42 gün × ~20 kalem.
- **Hata:** plan yüklenemezse Genel bakış kartı gizlenir. Nakit planı sayfası `error.tsx` sınırına düşer (panel
  kalıbı).
- **Roller:** `/panel/hatirlaticilar/nakit` personele kapalıdır (`STAFF_PATHS`'ta yok; `canOpen` false). Sayfa ve
  eylemler `requireAdmin()` çağırır.
- **Çift sayım** (hatırlatıcı ve fatura aynı ödeme, ya da Paraşüt faturası gelen sabit gider): Ödemeler'deki mevcut
  davranışla aynıdır. Metinde yazılır, sabit gider için “Tahmine katılanlar”dan kapatılır.

### 2.7 Testler (`tests/nakit-plani.test.ts`)

1. Dilimler: 6 dilim × 7 gün, ilki bugün. `weekTitle` ve `rangeText` (“22–28 Eki”, “29 Eki – 4 Kas”).
   `PLAN_DAYS ≤ UPCOMING_HORIZON_DAYS`.
2. Satış: 10 kasa raporu → günlük ortalama, kart payıyla komisyon, `acikGun 26` → oran 26/30. Gün 0 boş, gün 1 dolu.
   `zTotal = 0` olan rapor sayılmaz. 6 raporda POS ayına düşer. İkisi de yoksa `kind: "none"`, gelen 0.
3. Faturalar: vadesi geçen gün 0'a `overdue` ile. 41. gün dahil, 42. gün hariç. Tutar `UpcomingItem.amount`.
4. Hatırlatıcılar: aylık 1'inde 5.000 ₺, bugün 22 Ekim → 1 Kas ve 1 Ara. Geciken aylık (1 Ekim) → gün 0 + 1 Kas +
   1 Ara. Haftalık. Tutarsız “KDV” `unknownAmounts`'ta.
5. Maaş/SGK: hatırlatıcı yoksa 1 Kas'ta Ekim bordrosu (net + ek), 31 Eki'de Eylül SGK'sı. Tutarlı “Maaş ödemesi”
   varsa tahmin yok. Tutarsız “Maaş ödemesi” (5'inde) varsa tahmini tutar 5 Kas'a yazılır. “Muhasebeci” (sabit gider
   adı, `kind: maas`) maaşı kapatmaz, Muhasebeci yayılan tahminini kapatır. `excluded: ["salary"]` maaşı tamamen
   çıkarır.
6. Sabit giderler: aylık 31.000 ₺ Ekim'de günde 1.000 ₺. Günlük kalem açık gün oranıyla. Yıllık `notIncluded`'da.
   Sürümlü tutar ay değişince değişir (`months` kaydı). Kapatılan `fixed:<id>` sayılmaz, `estimates` satırı `"off"`.
7. Mal alımı (`goodsRows` + `buildCashPlan`): peşin tedarikçi gün 1'den, 30 gün vadeli olan gün 31'den. Aralık
   < 14 gün → tahmin yok. Kategori süzgeci (kafe dışı, Kuruluş & Demirbaş, Komisyon girmez).
8. Bakiye: hafta sonu bakiyeleri, `firstNegative` (tarih ve en büyük iki gider), `lowest`. Bakiye yoksa
   `requiredCash`. `staleDays` (5 gün önce girilmiş).
9. `planInputFromModel` (Excel verisi, bugün 2026-10-22): `posMonth` Ekim (293.909 ÷ 16), bordro 2 kişi net 60.000 ve
   SGK ≈ 23.118, Ekim sabit giderleri 16 kalem, ModPOS yıllık.
10. `planNotes`: satış, maaş ve mal alımı metinleri rakamları içerir. Yedek ve “satış verisi yok” metinleri.
11. Kaynak testleri: `nakit/page.tsx` `requireAdmin()` çağırır. `canOpen("staff", "/panel/hatirlaticilar/nakit") ===
    false`. `mobileTitleFor("/panel/hatirlaticilar/nakit") === "Nakit planı"`.

Mevcut `tests/roller.test.ts` (menü rolü = erişim kuralı) ve `tests/yardim.test.ts` (SSS bağlantıları gerçek sayfaya
gider) yeni öğeleri de denetler. Ek değişiklik gerekmez.

---

## 3. Paylaşılan dosyalar (başka gruplarla çakışma)

| Dosya | Bu grubun dokunuşu | Muhtemel çakışan grup |
|---|---|---|
| `src/app/panel/page.tsx` (Genel bakış) | `loadPayments` tam sonuç, nakit kartı, `priceAlert` 3. argüman | 4 (cron uyarısı), 13 (Bugün), 6 (ay bilgisi) |
| `src/server/actions/notifications.ts` (zil) | `priceAlert(..., prices.loss.totalLoss)` (1 satır) | 4, 7, 13 |
| `src/server/notify/digest.ts`, `digest-template.ts` | zam bölümüne TL/ay | 4 (e-postada cron uyarısı), 7 |
| `src/components/panel/nav.ts` | `NAV_GROUPS` öğesi + `SHORT_TITLES` | 13 (alt menüde Kasa), 1 |
| `src/lib/calc/price-impact.ts` | `priceAlert` isteğe bağlı parametre | 7 (fiyat onayı) |
| `src/server/data/price-alerts.ts` | `loss`, `month` parametresi | 7 |
| `src/app/panel/urunler/page.tsx`, `price-impact-panel.tsx` | `loss` prop'u ve gösterimi | **11 (toplu fiyat değişikliği; aynı sayfa)** |
| `src/app/panel/hatirlaticilar/reminders-client.tsx`, `reminder-sheet.tsx` | düğme, `?ekle=sabit`, `initialStep` | 13 (Bugün görünümü ödemeleri okuyabilir) |
| `src/app/panel/analiz/*` | üçüncü sekme | — |
| `src/app/panel/yardim/page.tsx`, `README.md` | SSS ve ekran tablosu | hepsi (metin ekleri) |

`schema.ts`'e dokunulmaz, migration yok. `server/data/suppliers.ts`'ten yalnız `loadTermDays` ve
`loadPaidOnDelivery` çağrılır. Grup 5 eşleşmeyi vergi numarasına taşısa da imza aynı kalır.

---

## 4. Belgeler

- **Yeni `docs/NAKIT-PLANI.md`:** amaç; §2.1 tablosu (kaynaklar, kesin/tahmini, gün kuralları); bugün kuralı;
  hatırlatıcı eşleşmesi; bakiye ve “gereken en az para”; tahmine katılanlar; dahil olmayanlar; çift sayım notu;
  `integration_state` anahtarı.
- **`README.md`:**
  - Giriş paragrafına “6 haftalık nakit planı (docs/NAKIT-PLANI.md), hammadde zamlarının ayda kaç lira kâr götürdüğü”.
  - Ekranlar tablosuna satır: “Nakit planı: önümüzdeki 6 hafta gelen, ödenecek, kalan; en sıkışık gün |
    `/panel/hatirlaticilar/nakit` | — (yeni)”.
  - Analiz satırına “zam etkisi”.
  - `db:reset` “Silmedikleri”ne “nakit planının bakiyesi ve tahmin ayarı”.
  - Zil cümlesine “(zammın aylık kâr etkisiyle)”.
- **`docs/BILDIRIMLER.md`:** zam bölümünde “ayda ≈ X ₺” ekleri ve dayanağı (son satış ayı, ayda açık gün).
- **`docs/PARASUT.md` 5a** (Hammadde zamları): tek cümle, “aylık kâr etkisi Ürünler › Hammadde zamları ve Analiz ›
  Zam etkisi'nde”.
- **Yardım (`yardim/page.tsx`)**, “Gider, ödeme ve ekip” grubuna iki SSS:
  - “Önümüzdeki haftalarda param yeter mi?” Cevap: Nakit planı nedir, bakiyeyi girin, tahminler nasıl kesinleşir
    (Ödemeler'e tutarlı hatırlatıcı). Bağlantı `{ href: "/panel/hatirlaticilar/nakit", label: "Nakit planı" }`.
  - “Zamlar bana ayda kaça mal oluyor?” Bağlantı `{ href: "/panel/analiz?gorunum=zam", label: "Zam etkisi" }`.
  - `<Path>` kullanılmaz (yeni ekran kenar çubuğu ağacında yok; `tests/yardim.test.ts`).

---

## 5. Yöneticinin kararı gereken noktalar (varsayılanla ilerlenir)

1. **Plan ufku:** 6 hafta, seçici yok. Varsayılan **6**.
2. **Varsayılan maaş ve SGK günleri:** maaş her ayın **1'i** (1–15 arası günde önceki ayın bordrosu), SGK **ay sonu**
   (Ödemeler şablonlarıyla aynı). Farklıysa Ödemeler'e hatırlatıcı eklenir.
3. **Kafe dışı faturalar (Karaoke box, Alp Koç) plana girsin mi?** Varsayılan **evet** (Ödemeler'de de görünüyor).
4. **Kart ve yemek kartı tahsilatı:** varsayılan aynı hafta, Ayarlar komisyonu düşülür, bloke günü yok.
5. **laffogato.net online tahsilatı:** varsayılan **dahil**, aynı gün, kesintisiz.
6. **Hatırlatıcısı olmayan sabit giderler:** varsayılan **ay içine yayılır ve tahmine katılır**. Tek tek kapatılabilir.
7. **Para yetmeyecekse zil ya da e-posta uyarısı:** varsayılan **hayır (v1)**. Önce tahminin isabeti görülsün, sonra
   `notifications.ts`'e tek öğe eklenir (14 gün içinde ve bakiye 7 günden yeniyse).
8. **KDV tahmini:** varsayılan **yok**. Yalnız tutarı girilmiş KDV hatırlatıcısı sayılır, tutarsızı “Tutarı
   girilmemiş” listesinde.
9. **Zam etkisinin varsayılan dönemi (Analiz):** **son 3 ay**. Ürünler kartı 30 gün kalır.
10. **Aylık adet ölçeği:** Ayarlar “ayda açık gün” ÷ referans ayın açık günü. Varsayılan **evet**.

---

## 6. Uygulama sırası

1. `src/lib/calc/price-loss.ts` + `tests/zam-etkisi.test.ts`, ardından `priceAlert` parametresi.
2. `price-alerts.ts` (`loss`), sonra Ürünler kartı, ürün kartı, Genel bakış ve zil metni, e-posta.
3. Analiz › Zam etkisi sekmesi (`price-loss-view.tsx`, `?donem`).
4. `src/lib/cash-plan.ts` + `tests/nakit-plani.test.ts`.
5. `server/data/cash-plan.ts`, `server/actions/cash-plan.ts`.
6. `/panel/hatirlaticilar/nakit` ekranı (pencere ve sayfa dahil), Ödemeler düğmesi, `?ekle=sabit`.
7. Genel bakış kartı, `nav.ts`, Yardım, belgeler.
8. `npx tsx --test tests/*.test.ts`, `npm run lint`, `tsc`. `npm run dev` ile 390 px ve masaüstü kontrolü: Excel
   verisinde planda POS yedeği, 2 personel, sabit giderler ve 3 ödenmemiş fatura görünmeli. Analiz'de zam yoksa boş
   durum görünmeli.

---

## 7. Riskler

- **Tahmin kesin sanılabilir.** Her tahmini satırda “tahmini” rozeti ve ⓘ var, “Nasıl hesaplandı” kartı rakamlarıyla
  yazılı. Hatırlatıcıyla kesinleşme yolu her metinde gösteriliyor.
- **Çift sayım.** Paraşüt'ten faturası da gelen sabit gider (elektrik gibi) faturanın geldiği ay iki kez sayılabilir.
  Kalem bazında kapatma anahtarı ve metin uyarısı var. Ödemeler'deki hatırlatıcı ve fatura ikiliği zaten aynı
  davranışta.
- **Eksik kasa raporu** satış tahminini düşürür. En az 7 rapor şartı ve POS yedeği var, dayanak metinde yazılı.
- **Büyük sabit giderin gün içinde yayılması** (160.000 ₺ kira) haftalık dağılımı gerçekten farklı gösterebilir. Ay
  toplamı doğrudur, metin hatırlatıcı eklemeyi önerir.
- **Paylaşılan dosyalarda birleştirme çakışması.** En riskli olanlar Genel bakış, `urunler/page.tsx` (grup 11) ve
  `notifications.ts`. Dokunuşlar küçük ve yerel (§3).
- **Zam etkisinde referans ay eski olabilir** (satış raporu aylarca yüklenmediyse). Dayanak satırı ayı açıkça yazar.

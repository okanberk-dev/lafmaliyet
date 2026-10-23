# Nakit planı (önümüzdeki 6 hafta) ve KDV tahmini

Ekran: **Satış & gider › Ödemeler & hatırlatıcılar › Nakit planı** (`/panel/hatirlaticilar/nakit`, yalnız yönetici;
Ödemeler'in başlığındaki **Nakit planı** düğmesi ve ⌘K). Soru: “önümüzdeki haftalarda param yeter mi?” Plan bugünden
başlayan **42 gündür** (6 dilim × 7 gün, kayan hafta: hafta 1 = bugün … bugün+6). Her dilimde gelen, ödenecek (kesin ve
tahmini) ve hafta sonunda elde kalacak para görünür. Hesap saf modüldedir: `src/lib/cash-plan.ts` (testleri
`tests/nakit-plani.test.ts`), KDV `src/lib/kdv.ts` (`tests/kdv-tahmini.test.ts`).

Kenar çubuğunda ayrı öğesi yoktur; Ödemeler etkin kalır, telefonun üst çubuğu “Nakit planı” yazar. Personel ekranı
açamaz (`requireAdmin`), ⌘K'da da görmez.

## Kaynaklar

| Satır (anahtar) | Tür | Kaynak ve kural |
|---|---|---|
| **Satışlar** (`sales`) | gelen, tahmini | Son 28 günün kasa raporları (`zTotal > 0`). **En az 7 rapor** varsa günlük = Z toplamı ÷ rapor sayısı, kart payı = (kart + yemek kartı) ÷ Z. Yoksa bu aya kadarki, açık günü ve POS cirosu girilmiş son ay (Satışlar): günlük = ciro ÷ açık gün, kart payı Ayarlar'dan. Kartla ödenen pay için Ayarlar'daki banka komisyonu düşülür, günlük tutar `ayda açık gün ÷ 30` ile takvim gününe çevrilir. Z'deki **online platform** ödemeleri (Yemeksepeti, Getir…) Z toplamının içindedir, aynı gün ve kesintisiz sayılır (payı notta yazar). Hiçbiri yoksa satış satırı yok. |
| **laffogato.net online** (`online`) | gelen, tahmini | Site satış kaydının bu aya kadarki son ayı: kafe + mağaza + karaoke net tutarı (KDV dahil, iadeler düşülmüş) ÷ gün. Biten ayda gün = ayın gün sayısı; süren ayda kaydın çekildiği günün dünü (7 günden azsa bir önceki ay). **Kasadan geçmez**, Z'deki online platformlardan ayrıdır. Ödeme kuruluşunun kesintisi ve aktarım günü düşülmez. |
| **Faturalar** | ödenecek, kesin | Ödemeler'in listesindeki ödenmemiş faturalar: kalan borç, vade gününde. Vadesizse tedarikçinin vadesi, o da yoksa bildirim ayarındaki gün. Gecikmiş fatura **bugüne** “Gecikmiş” rozetiyle yazılır. Kafe dışı (Karaoke box, Alp Koç) faturalar da girer (Ödemeler gibi). |
| **Hatırlatıcılar** | ödenecek, kesin | Etkin hatırlatıcının plan içindeki her tekrarı; geciken dönem bugüne. **Tutarı > 0** olan kesindir. Tutarsız olan aşağıdaki eşleşmeye bakar. |
| **Maaşlar** (`salary`) | ödenecek, tahmini | Personel: net maaş + ek ödemeler. Ödeme ayın 1–15'indeyse önceki ayın bordrosu, sonrasındaysa o ayınki. Gün: maaş hatırlatıcısı yoksa **her ayın 1'i**. Maaş hatırlatıcıları var ama hiçbirinde tutar yoksa kimliği en küçük olanın günlerinde (“taşıyıcı”). Tutarlı maaş hatırlatıcısı varsa tahmin yapılmaz. |
| **SGK primi** (`sgk`) | ödenecek, tahmini | Önceki ayın işçi ve işveren SGK + işsizlik payları. Gün: SGK hatırlatıcısı yoksa **ayın son günü**; varsa maaştaki kural. Gelir ve damga vergisi dahil değil. |
| **Sabit giderler** (`fixed:<id>`) | ödenecek, tahmini | Hatırlatıcısı olmayan her sabit gider ay içine eşit yayılır (o ayın sürümlü tutarı): aylık ÷ ayın gün sayısı, haftalık ÷ 7, günlük × `ayda açık gün ÷ 30`. Giderler'de KDV hariç girilen tutara **faturadaki KDV** eklenir: kalemin “Faturadaki KDV” alanı (KDV yok, %1, %10, %20), boşsa bölümün varsayılanı (kira, faturalar, genel giderler %20; personel KDV'siz). 160.000 ₺ kira bankadan 192.000 ₺ çıkar. Gelir-gider KDV hariç tutarla kalır. **Yıllık** plana girmez (“Dahil değil”de adıyla yazar). |
| **Mal alımı** (`goods`) | ödenecek, tahmini | Son 8 haftanın mal faturaları (kafe dışı, demirbaş ve komisyon girmez; geçmiş kısaysa en eski mal faturasından bu yana, **14 günden kısaysa tahmin yok**). Her fatura günlük orana bölünür ve tedarikçinin gecikmesiyle ödenir: peşin çalışılan tedarikçide 0, değilse kartındaki vade, o da yoksa bildirim ayarındaki gün. Böylece bugünden sonra kesilecek faturalar vadelerinde ödenmiş olur; bugünkü ödenmemiş faturalarla çakışmaz. Tedarikçi adla bulunur (gelecek faturanın vergi nosu yok). |
| **KDV** (`kdv`) | ödenecek, tahmini | Aşağıda *KDV tahmini*. |

**Bugün kuralı:** girilen bakiye bugünü kapsar. Bu yüzden bugüne (gün 0) yalnız fatura ve hatırlatıcı yazılır (gecikmişler
dahil); bütün tahminler (satış, online, yayılan sabit gider, mal alımı, varsayılan gündeki maaş, SGK ve KDV) **yarından**
başlar.

## Hatırlatıcı eşleşmesi

Her etkin hatırlatıcı bir sınıfa girer, sırayla:

1. **Adı bir sabit giderle aynıysa** (büyük/küçük harf ve Türkçe karakter farkı gözetilmez; Ödemeler'deki “Listede var”
   eşleşmesi) o giderin yerine geçer: gider ay içine yayılmaz. Hatırlatıcı tutarlıysa kendi tutarı, tutarsızsa giderin
   KDV dahil tutarı onun günlerine “tahmini” yazılır.
2. **Maaş** ve **SGK** (Ödemeler'deki türü ya da adı): yukarıdaki maaş ve SGK kuralı. “Sabit giderlerden ekle” ile
   açılan hatırlatıcı (personel bölümündeki kalem maaş türüyle açılır: Muhasebeci, Part-time çalışan) gideri silinse ya
   da adı değişse de bordro sayılmaz: maaşı ve SGK'yı kapatmaz, diğer hatırlatıcıdır.
3. **KDV** (adında “KDV” ya da “katma değer” geçen hatırlatıcı; kira, maaş ve SGK türleri hariç): *KDV tahmini*. KDV
   tevkifatı (“2 No.lu KDV”, “KDV2”, “tevkifat”) ayrı bir ödemedir, diğer hatırlatıcı sayılır: asıl KDV'nin dönemini
   almaz, devredeni sıfırlamaz.
4. **Diğer:** tutarlıysa kesin; tutarsızsa plana girmez, **Tutarı girilmemiş ödemeler** kartında adı ve ilk tarihiyle
   görünür (“Ödemeler'de tutar girin”).

Bir tahmini kesinleştirmenin yolu Ödemeler'e tutarıyla hatırlatıcı eklemektir; plan onun gününü ve tutarını kullanır.

## Bakiye ve “gereken en az para”

- **Bakiyeyi gir** (pencere “Elinizdeki para”): bankadaki ve kasadaki paranın bugünkü toplamı. Eksi yazılabilir (kredili
  hesap). Son kasa raporu varsa ipucu: “Son kasa raporu (21 Ekim): ertesi güne 3.450 ₺ devretti.” Genel bakış'tan
  `?bakiye=1` ile açılır.
- Bakiye varsa her gün: önceki gün + gelen − ödenecek. Karolar: elinizdeki para, gelecek para, ödenecek (kesin ·
  tahmini), 6 hafta sonra (en sıkışık gün). İlk eksi gün kırmızı şeritte o günün en büyük iki gideriyle yazılır;
  eksi gün yoksa yeşil şerit “6 hafta boyunca para yetiyor”. Açılışta ilk eksi günün haftası (yoksa bu hafta) açık gelir.
- Bakiye yoksa aynı hesap 0'dan birikimli net olarak yürür: **gereken en az para** = en düşük birikimli tutarın eksisi,
  yani ödemeleri yapabilmek için bugün elde olması gereken para.
- Bakiye 3 günden eskiyse turuncu “N gün önce girildi · güncelleyin” yazar; hesap yine bugünden başlar.

## Tahmine katılanlar

**Nasıl hesaplandı** kartının altındaki düğme. Satışlar, laffogato.net online, maaşlar, SGK, mal alımı, KDV ve
hatırlatıcısı olmayan her sabit gider tek tek kapatılabilir. Faturası ayrıca gelen bir sabit gider kapatılır, iki kez
sayılmasın. Ödemeler'de hatırlatıcısı olan ve yıllık kalemler değiştirilemez (gri). “Gününü girmek için Ödemeler'e ekle”
Ödemeler'i açar.

**Dahil değil** (ekranda yazar): tutarı girilmemiş vergiler (muhtasar, geçici vergi vb.), Aylık harcamalar'daki fatura dışı
ödemeler, yıllık giderler, yatırım ve kredi. Kart, yemek kartı ve online platform tahsilatı satış günü sayılır (bankaya
geçiş gecikmesi yok).

**Çift sayım:** aynı ödeme hem hatırlatıcı hem fatura olarak duruyorsa iki kez sayılır (Ödemeler'deki gibi). Faturası
ayrıca gelen sabit gideri Tahmine katılanlar'dan çıkarın.

## Genel bakış kartı

Yaklaşan ödemeler kartının altında **Nakit planı** kartı: seçili aydan bağımsız (bugüne göre). Bakiye varsa “6 hafta sonra
≈ …” ve en sıkışık gün (eksi günde kırmızı “1 Kasım'da para yetmeyebilir”); yoksa “Gereken en az para ≈ …” ve “Bakiyenizi
girin, kalanı görün”. Plan verisizse ya da yüklenemezse kart hiç çizilmez (`loadCashPlan(…).catch(() => null)`); sayfa
zaten okuduğu modeli ve Ödemeler listesini paylaşır, ek `loadModel()` yoktur. Zil ve e-posta uyarısı yok (önce tahminin
isabeti görülsün).

## KDV tahmini

Nakit planının yan sütununda **KDV tahmini** kartı (`#kdv`). Hesap tek cümledir:

> **önceki ayın satışlarındaki KDV − alış faturalarındaki KDV − önceki aylardan devreden KDV**, ayın 28'inde ödenir.

Eksi çıkarsa “Ödeme beklenmez” yazar ve fark sonraki aya devreder. Her yerde aynı etiket: “Tahmin; kesin tutar
muhasebecinizin beyannamesindedir.” Her ödeme günü bir satırdır (“28 Kas · Ekim KDV'si ≈ 42.100 ₺”); satıra dokununca
satışların KDV'si, alışların KDV'si, devreden ve sonuç açılır.

| Konu | Kural |
|---|---|
| Dönem ve gün | Ay P'nin KDV'si P+1'in **28'inde**. Hafta sonu kaydırması yok: 28 Kasım 2026 Cumartesi, yasal son gün 30 Kasım; plan 28'ine yazar (para iki gün erken çıkmış görünür, güvenli taraf). Üç aylık KDV desteklenmez. |
| Kasa (ModPOS) | Satışlar'daki ay cirosu (KDV dahil): ciro − KDV hariç ciro, gelir-giderdeki kuralla. Ürünler satış oranıyla (%10), HİZMET satırları yani karaoke hizmet oranıyla (%20). |
| Süren ay | Ciro Genel bakış'taki ay sonu tahminiyle aya tamamlanır (÷ açık gün × ayın gün sayısı; açık gün yoksa ÷ geçen gün). Ekranda “Ekim bitmedi: 16 günün satışıyla tahmin”. |
| Ciro girilmemiş ay | Önceki, cirosu ve açık günü olan son ayın günlük KDV'si × ayın gün sayısı (“Ekim cirosu yok: Eylül'ün günlük ortalamasıyla”). |
| laffogato.net | Sitenin her siparişte sakladığı KDV; oranı saklı olmayanlara panelin oranı (kafe ve mağaza %10, karaoke %20; `siteVat`, `src/lib/site-sales/calc.ts`). Süren ayın açık kaydı çekildiği günün dününe kadardır, aya tamamlanır. Kayıt yoksa 0; site bağlıysa dökümde “laffogato.net: bu ay çekilmedi”. Elle girilen siparişler ModPOS'tadır, sayılmaz. |
| Alış KDV'si | Faturanın **ödenecek − (tutar − iskonto)** değeri; `vat` sütunu kullanılmaz (Excel'den gelenlerde 0). Tevkifatlıda fark tevkifat düşülmüş KDV'dir (nakit etkisi bu), iadede eksi. Kontrol bekleyen faturalar sayılır. **Kafe dışı** (Karaoke box, Alp Koç) sayılmaz. Süren ayda yalnız bugüne kadar gelen faturalar (ay sonuna tamamlanmaz; tahmin yüksek tarafta kalır). |
| Devreden | **Otomatik:** cirosu olan ilk aydan (yoksa ilk site kaydının ayından; en çok 24 ay geriden) ay ay zincir. İlk satış ayından önceki faturalar sayılmaz. Verisiz ay zinciri bozmaz. **Muhasebeciden:** “Devreden KDV'yi gir” penceresi (ay + “sonraki döneme devreden KDV”); zincir o ayın ertesinden başlar. O ayın kendi ödemesi devreden > 0 ise 0'dır (“Beyannamede devreden …”). |
| Ödemeler'deki tutar | KDV hatırlatıcısına yazılan tutar (0 dahil) **o dönemin kesin tutarıdır**, tahminin önüne geçer; > 0 ise sonraki aya devreden sıfırlanır. Tutar yalnız hatırlatıcının kayıtlı (sıradaki ya da geciken) dönemine aittir: **Ödendi** deyince ve tekrarlı seri ertelenince tutar silinir (Geri al geri getirir). |
| Yuvarlama | Kasa, online ve alış KDV'si ile muhasebecinin tutarı ayrı ayrı en yakın **100 ₺**'ye yuvarlanır (yarım yukarı, işaret korunur); ödenecek ve devreden bunlardan çıkar, ekrandaki çıkarma birebir tutar. Ödemeler'deki tutar ve muhasebecinin tutarı olduğu gibi yazılır. |
| Dahil değil | İkram ve ödenmez (Z dışı), Karaoke box'ın (MaviBahçe) satışları, Aylık harcamalar'daki fatura dışı ödemeler ve faturası panele gelmeyen giderlerin KDV'si (bilinmez; tahmin bu yüzden yüksek kalır). |

**Plana yerleşme:**

- Ödemeler'de KDV hatırlatıcısı yoksa her dönem ayın 28'ine, yarından itibaren “KDV (Ekim)” tahmini satırı olarak girer.
  Kart “Ödemeler'de KDV hatırlatıcısı yok; tahmin ayın 28'ine yazıldı” der ve **Hatırlatıcı ekle** önerir (KDV
  tahmine katılmıyorsa “KDV tahmini plana katılmıyor; Tahmine katılanlar'dan açabilirsiniz.”).
- KDV hatırlatıcısı varsa tahmin onun günlerine yazılır. Tutar yazılmış dönem kesindir (normal hatırlatıcı satırı);
  tutarsız dönem tahminini taşır ve “Tutarı girilmemiş ödemeler”de görünmez. Hatırlatıcı 1 hafta ertelenince açılan
  kopya (ayın 1–7'si) hâlâ iki ay önceki dönemin KDV'sidir. Aynı döneme ikinci bir KDV hatırlatıcısı “Tutarı girilmemiş”e
  düşer.
- Tahmin ≤ 0 ise satır yok (kartta “Ödeme beklenmez”). Satış verisi olmayan dönemde tahmin yok. KDV hatırlatıcısının
  sıradaki günü 6 haftanın dışındaysa kartta satır olmaz (“bu dönemde KDV ödemesi yok”).
- Tahmine katılanlar'dan **KDV** kapatılırsa kesin tutarlar yine yazılır, tahminler plana girmez (kart gri, “Plana
  katılmıyor”).
- **Nasıl hesaplandı** kartında tek satır: “Önceki ayın satış KDV'si (kafe %10, karaoke %20, laffogato.net) eksi alış
  faturalarının KDV'si, ayın 28'inde …”.

**Excel verisiyle** (bugün 22 Ekim 2026): kasa KDV'si Temmuz 15.800, Ağustos 45.500, Eylül 39.200, Ekim ≈ 51.800 ₺ (16
günden aya tamamlanmış); alış KDV'si 225.300 (açılış alımları), 3.500, 11.900, 9.700 ₺. Otomatik zincirle Eylül'den
140.200, Ekim'den 98.100 ₺ devreder: 28 Ekim ve 28 Kasım'da **ödeme beklenmez**. Muhasebeci Ağustos için “devreden 0”
derse 28 Ekim ≈ 27.300 ₺, 28 Kasım ≈ 42.100 ₺.

ModPOS günlük ürün satış raporu süren aya girince karaoke payı (`monthSales(ay).serviceRevenue`) kendiliğinden kesinleşir;
ek iş yok.

## Saklama

Tablo yok: `integration_state` tablosunda tek anahtar, **`cashflow.plan`**:

```ts
{
  balance: number | null;      // girilen bakiye (TL)
  balanceDate: string | null;  // YYYY-MM-DD (Türkiye)
  balanceBy: string | null;    // girenin adı
  excluded: string[];          // "sales" | "online" | "salary" | "sgk" | "goods" | "kdv" | `fixed:${id}`
  vatCarry: { month: string; amount: number; date: string; by: string } | null; // muhasebecinin devreden KDV'si
}
```

- Bozuk ya da eksik alan varsayılana düşer; silinmiş sabit giderin `fixed:<id>` anahtarı yok sayılır.
- Eylemler (`src/server/actions/cash-plan.ts`: `saveCashBalance`, `saveCashPlanExcluded`, `saveVatCarry`) yalnız
  yönetici; değişiklik işlem geçmişine yazılır (“Nakit planı: bakiye”, “tahmin ayarı”, “devreden KDV”). Devreden KDV'nin
  ayı son 12 bitmiş aydan biri olmalı.
- `npm run db:reset` bu anahtarı **siler**: `fixed:<id>` anahtarları sabit gider kimliklerine bağlı, kimlikler baştan sayar
  (bakiye zaten kısa ömürlü).
- Tam yedek (docs/YEDEK.md) `integration_state` tablosuyla bu anahtarı da alır.

## Kod

| Dosya | İş |
|---|---|
| `src/lib/cash-plan.ts` | `buildCashPlan`, `planInputFromModel`, `goodsRows`, `reminderOccurrences`, `planNotes` (saf) |
| `src/lib/kdv.ts` | `vatMonthInputs`, `vatEstimates`, `vatDueDate`, `vatPeriodOf`, metinler (saf) |
| `src/server/data/cash-plan.ts` | `loadCashPlan(model, upcoming?)`, `loadCashPlanState` |
| `src/server/actions/cash-plan.ts` | bakiye, tahmin ayarı, devreden KDV |
| `src/app/panel/hatirlaticilar/nakit/` | ekran, bakiye ve devreden KDV pencereleri, Tahmine katılanlar, KDV kartı |
| `src/app/panel/dashboard-cash-plan.tsx` | Genel bakış kartı |

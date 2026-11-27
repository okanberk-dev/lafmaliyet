# Nakit planı (önümüzdeki 6 hafta)

Ekran: **Kâr & ödemeler › Nakit planı** (`/panel/hatirlaticilar/nakit`, yalnız yönetici; kenar çubuğunda kendi
öğesi, Ödemeler ile Nakit planı'nın başlığındaki sekmeler **Ödemeler · Nakit planı** (`SECTION_TABS.odeme`) ve ⌘K). Soru: “önümüzdeki haftalarda param yeter mi?” Plan bugünden
başlayan **42 gündür** (6 dilim × 7 gün, kayan hafta: hafta 1 = bugün … bugün+6). Her dilimde gelen, ödenecek (kesin ve
tahmini) ve hafta sonunda elde kalacak para görünür. Hesap saf modüldedir: `src/lib/cash-plan.ts` (testleri
`tests/nakit-plani.test.ts`).

**Vergi tahmini yok** (27 Kasım 2026, sahibin kararı: Vergi bölümü kaldırıldı, vergiyi muhasebeci yürütüyor;
[arsiv/VERGI.md](arsiv/VERGI.md)). KDV tahmini, KDV-2, muhtasar, geçici vergi ve beyanname damgası satırları, KDV kartı,
devreden KDV ve KDV'nin "Ödendi" kaydı kalktı. Vergi ödemeleri planda yalnız Ödemeler'e **tutarıyla** yazıldıysa, düz
hatırlatıcı olarak girer; tutarsızı "Tutarı girilmemiş ödemeler"dedir. Ürün ve fatura KDV'si (satış fiyatları KDV dahil,
faturanın ödenecek tutarı, sabit giderin faturadaki KDV'si) planda kalır: bankadan çıkan paranın parçasıdır. Maaş ve SGK
yasal bordroyladır (`src/lib/bordro/payroll.ts`; Vergi bölümündeki hesabın aynısı, rakam değişmedi).

29 Eki 2026'dan beri ([planlar/ux-sade.md](planlar/ux-sade.md) §3) kenar çubuğunda kendi öğesi var ve grupta yalnız o
yanar (`activeChildOf`: Ödemeler yanmaz); iki sayfanın başlığındaki eski "Nakit planı" ve "Ödemeler" düğmeleri kalktı,
sekme aynı işi görür. Telefonun üst çubuğu “Nakit planı” yazar. Personel ekranı açamaz (`requireAdmin`), ⌘K'da da
görmez.

## Kaynaklar

| Satır (anahtar) | Tür | Kaynak ve kural |
|---|---|---|
| **Satışlar** (`sales`) | gelen, tahmini | Son 28 günün kasa raporları (`zTotal > 0`). **En az 7 raporlu gün** varsa günlük = her şubenin cirosu ÷ o şubenin raporlu gün sayısı, şubeler toplanır (tek şubede ciro ÷ rapor sayısı; `salesDaily`). Ciro ay bilgisinin kuralıyla: Z toplamı, Z'nin içindeki ödenmez / ikram düşülerek (`dayRevenue`; denetim 13 Kasım HM-08). Yeni açılan ya da birkaç gün raporu eksik şubenin cirosu bütün günlere yayılmaz (denetim 21 Kasım #11); notta "Tuzla 28 gün, Marina 7 gün; şube ortalamalarının toplamı". Kapatılmış (pasif) şubenin raporları sayılmaz. Kart payı = (kart + yemek kartı) ÷ ciro (bütün şubeler). Yoksa bu aya kadarki, açık günü ve POS cirosu girilmiş son ay (Satışlar): günlük = ciro ÷ açık gün, kart payı Ayarlar'dan. Kartla ödenen pay için Ayarlar'daki banka komisyonu düşülür, günlük tutar `ayda açık gün ÷ 30` ile takvim gününe çevrilir. Z'deki **online platform** ödemeleri (Yemeksepeti, Getir…) Z toplamının içindedir, aynı gün ve kesintisiz sayılır (payı notta yazar). Hiçbiri yoksa satış satırı yok. Özel günler'de **kafe kapalı** işaretli günde satış ve online girişi yazılmaz (denetim E-41; “Kapalı günler” notu). |
| **laffogato.net online** (`online`) | gelen, tahmini | Site satış kaydının bu aya kadarki son ayı: kafe + mağaza + karaoke net tutarı (KDV dahil, iadeler düşülmüş) ÷ gün. Biten ayda gün = ayın gün sayısı; süren ayda kaydın çekildiği günün dünü (7 günden azsa bir önceki ay). **Kasadan geçmez**, Z'deki online platformlardan ayrıdır. Ödeme kuruluşunun kesintisi ve aktarım günü düşülmez. |
| **Faturalar** | ödenecek, kesin | Ödemeler'in listesindeki ödenmemiş faturalar: kalan borç, vade gününde. Vadesizse tedarikçinin vadesi, o da yoksa bildirim ayarındaki gün. Gecikmiş fatura **bugüne** “Gecikmiş” rozetiyle yazılır. Kafe dışı (Karaoke box, Alp Koç) faturalar da girer (Ödemeler gibi). |
| **Faturasız borçlar** (`cari:<id>`) | ödenecek, kesin | Tedarikçiler › Borç ekle ile girilen, bir faturaya bağlanmamış borçların kalanı ([TEDARIKCILER.md](TEDARIKCILER.md) *Hesap hareketleri*), faturayla aynı vade kuralıyla: “Sütaş · faturasız alım”, “Sütaş · fatura bekleniyor”, “Sütaş · eski borç”. Gecikmiş olan bugüne. |
| **Hatırlatıcılar** | ödenecek, kesin | Etkin hatırlatıcının plan içindeki her tekrarı; geciken dönem bugüne. **Tutarı > 0** olan kesindir. Tutarsız olan aşağıdaki eşleşmeye bakar. |
| **Maaşlar** (`salary`) | ödenecek, tahmini | Personel: net maaş + ek ödemeler. Yemek kartı işaretli kişinin yemek kartı (Ayarlar: günlük 330 ₺ × 26 gün) ek ödeme gibi, brütleştirilmeden personele giden paraya eklenir; part-time kişinin günlük ücreti × Vardiya'daki çalışma günü (+ yemek kartı × gün + ek) brütleştirilmeden, SGK'sız eklenir (ayın Vardiya planındaki bütün günleri; planı girilmemiş haftalar sayılmaz). İkisi yasal bordrodan gelir (Faz 5, `src/lib/bordro/payroll.ts`). Ödeme ayın 1–15'indeyse önceki ayın bordrosu, sonrasındaysa o ayınki. Gün: maaş hatırlatıcısı yoksa **her ayın 1'i**. Maaş hatırlatıcıları var ama hiçbirinde tutar yoksa kimliği en küçük olanın günlerinde (“taşıyıcı”). Tutarlı maaş hatırlatıcısı varsa tahmin yapılmaz. |
| **SGK primi** (`sgk`) | ödenecek, tahmini | Önceki ayın işçi ve işveren SGK + işsizlik payları, yasal bordrodan (`payrollFromModel`, `src/lib/bordro/payroll.ts`; dalga 12'de Vergi bölümüyle geldi, 27 Kasım 2026'dan beri kendi modülünde): brüt netten gelir ve damga vergisiyle bulunur, 2026 yasal oranlarıyla (işçi %14 + %1, işveren %19,75 + %2), prime esas kazancın alt ve üst sınırıyla. Saklı bordro ayarı (eski Vergi ayarları, `integration_state` › `tax.settings`: hesap döneminin başı, asgari ücret desteği, işveren payının elle değeri) okunur; ekranı yok, son girildiği gibi kalır (`src/lib/bordro/settings.ts`). Tohum verisinde Eylül SGK'sı **25.956,18 ₺** (Gelir-gider Ayarlar'daki %15,75'le 23.117,65 ₺ gösterir; Gelir-gider Ayarlar'daki oranı kullanmaya devam eder). Ücretin gelir ve damga vergisi (muhtasar) planda yok. Gün: SGK hatırlatıcısı yoksa **ayın son günü**; varsa maaştaki kural. Ayar okunamazsa varsayılanlar. |
| **Sabit giderler** (`fixed:<id>`) | ödenecek, tahmini | Hatırlatıcısı olmayan her sabit gider ay içine eşit yayılır (o ayın sürümlü tutarı): aylık ÷ ayın gün sayısı, haftalık ÷ 7, günlük × `ayda açık gün ÷ 30`. Giderler'de KDV hariç girilen tutara **faturadaki KDV** eklenir: kalemin “Faturadaki KDV” alanı (KDV yok, %1, %10, %20), boşsa bölümün varsayılanı (kira, faturalar, genel giderler %20; personel KDV'siz). 160.000 ₺ kira bankadan 192.000 ₺ çıkar. Gelir-gider KDV hariç tutarla kalır. **Kira ev sahibi türü** (Faz 5; kira kaleminde “Ev sahibi”) seçiliyse KDV ondan: **şahıs** KDV yok (kalemde %20 yazılı ya da bölümün varsayılanı olsa da 160.000 ₺ çıkar; resmi kira varsa ev sahibine kesintisiz, resmi kira yoksa stopaj ödemeden kesilir: 128.000 ₺), **şirket** %20 KDV (160.000 → 192.000 ₺, KDV 32.000 ₺), stopaj yok. **Stopajlı sabit gider** (saklı stopaj profili, eski Vergi › sınıflandırma; ekranı kaldırıldı, değer yerinde; `src/lib/bordro/stopaj.ts`): şahsa kira, serbest meslek ve şahsa internet reklamında bankadan net çıkar: şahsa 160.000 ₺ kira, KDV yok → 128.000 ₺; muhasebeci 10.000 ₺ serbest meslek, %20 KDV → 10.000 ₺. Stopajı muhasebeci muhtasarla öder; plan vergi tahmini yapmaz (27 Kasım 2026'dan önce stopaj muhtasar satırındaydı), tutarını Ödemeler'e yazarsanız planda görünür. Satırın notu “Kira 160.000 ₺ brüt · stopaj %20 ödemeden kesildi · ödenen 128.000 ₺”. Yurt dışına ödenen hizmette KDV yok (yabancı firma Türk KDV'si kesmez). Aynı net tutar “Sabit giderlerden ekle”nin hatırlatıcıya yazdığı ve sabit giderle farkın uyarısının beklediği tutardır. **Yıllık** plana girmez (“Dahil değil”de adıyla yazar). |
| **Aylık harcamalar** (`expense:<id>`) | ödenecek, tahmini | Aylık harcamalar'da “her ay girilir” işaretli, mal dışı kategoriler (reklam, influencer; denetim E-13): ayın beklenen ödemesi (`model.monthlyExpensePlan`: o ay girilen, daha azsa geçen ayın gerçekleşeni; sahibe soru 7 cevaplanana kadar). Girilen tutar ödenen tutardır (KDV dahil); kategori bir fatura kategorisine bağlıysa o faturalar ödenecek tutarlarıyla (KDV dahil) eklenir. Bu ay bugüne kadar girilenler ve bu ayın bağlı faturaları (ödenmiş ya da Ödemeler'de kesin kalem) karşılanmış sayılır, kalanı ayın kalan günlerine; gelecek ayda (faturası henüz gelmemiş bağlı kategori dahil) ayın bütün günlerine eşit yayılır. Sabit gideri aylık girişe çevirmenin yazdığı tahmini kayıt (“Sabit giderdeki KDV hariç tutar (tahmini)”) ödeme sayılmaz: tutarı ya da günü düzeltilene kadar plan onu ayın kalan günlerinde öder. Adı aynı hatırlatıcı varsa onun gününde (yayılmaz). Tahmine katılanlar'dan kapatılır. |
| **Mal alımı** (`goods`) | ödenecek, tahmini | Son 8 haftanın mal faturaları (kafe dışı, demirbaş ve komisyon girmez; geçmiş kısaysa en eski mal faturasından bu yana, **14 günden kısaysa tahmin yok**). Her fatura günlük orana bölünür ve tedarikçinin gecikmesiyle ödenir: peşin çalışılan tedarikçide 0, değilse kartındaki vade, o da yoksa bildirim ayarındaki gün. Böylece bugünden sonra kesilecek faturalar vadelerinde ödenmiş olur; bugünkü ödenmemiş faturalarla çakışmaz. Tedarikçi adla bulunur (gelecek faturanın vergi nosu yok). Bir tedarikçinin açık “Faturası gelecek” borçları varsa onun tahmini o tutar kadar düşürülür (haftalık irsaliyenin aylık faturası hem tahminde hem kesin kalemde sayılmasın): notta “Sütaş tahmini, faturası beklenen 1.250 ₺ kadar düşürüldü”. Elle borç ve ödeme mal tahminine girmez (yalnız faturalar okunur). |

**Bugün kuralı:** girilen bakiye bugünü kapsar. Bu yüzden bugüne (gün 0) yalnız fatura ve hatırlatıcı yazılır (gecikmişler
dahil); bütün tahminler (satış, online, yayılan sabit gider, mal alımı, varsayılan gündeki maaş ve SGK) **yarından**
başlar.

## Hatırlatıcı eşleşmesi

Her etkin hatırlatıcı bir sınıfa girer, sırayla:

1. **Adı bir sabit giderle aynıysa** (büyük/küçük harf ve Türkçe karakter farkı gözetilmez; Ödemeler'deki “Listede var”
   eşleşmesi) o giderin yerine geçer: gider ay içine yayılmaz. Hatırlatıcı tutarlıysa kendi tutarı, tutarsızsa giderin
   KDV dahil tutarı onun günlerine “tahmini” yazılır. “Sabit giderlerden ekle” hatırlatıcıya ilk ödeme ayındaki
   sürümün tutarını faturadaki KDV'siyle yazar (160.000 ₺ kira → 192.000 ₺; o aydan geçerli zam dahil; listede seçilen
   günün ayındaki tutar ve dönem, “%20 KDV dahil”). Böyle açılmış ve tutarı sıradaki ödeme ayının sürümüne eşit
   hatırlatıcı **gideri izler** (`fixedReminderFollows`): Giderler'de sonraki bir aydan zam girilmişse (“Ocak 2027
   itibarıyla değişiyor: hatırlatıcı yeni tutarı izler”) plan zamdan sonraki dönemlerde sürümün tutarını öder (satırda
   “Sabit giderdeki Ocak 2027 tutarı (KDV dahil); hatırlatıcı gideri izler”, uyarı çıkmaz), **Ödendi** sıradaki dönem
   zamlı aya gelince tutarı o ayın sürümüne taşır (Geri al eski tutarı yazar). Ödemeler ve sabah e-postası hep sıradaki
   dönemin tutarını gösterir. Yalnız dönemi sonradan değişen giderde (aylıktan yıllığa) tutar yazılmaz (“… itibarıyla
   dönemi değişiyor: tutar yazılmaz”): plan her ayın sürümünü KDV'siyle, hatırlatıcının dönemine çevirerek taşır (aylık
   hatırlatıcıya her ay yıllık tutarın tamamı değil, on ikide biri).
   Hatırlatıcı eklendikten sonra Giderler'de zam (tutar, dönem ya da KDV oranı) girilince “Sabit giderlerden ekle” ile
   açılmış, tutarı elle değiştirilmemiş hatırlatıcı uyar (denetim E-46): sıradaki ödeme ayının yeni tutarı yazılır; zam
   daha sonraki bir aydan başlıyorsa bu ayın tutarı kalır, kaydın mesajı zammın ayını ve tutarını söyler (“Ocak 2027
   itibarıyla 240.000 ₺ sayılır”); dönemi değişirse tutar boşalır. Elle başka bir tutar yazılmışsa dokunulmaz, kaydın
   mesajı uyarır. Gideri izlemeyen (elle açılmış ya da elle tutar yazılmış) tutarlı hatırlatıcının tutarı o ayın sabit
   gider tutarından (KDV dahil, aynı dönem) 1 ₺'den fazla farklıysa plan yine hatırlatıcının tutarını öder ama satırda
   söyler (“Sabit giderde Kasım 2026 tutarı 240.000 ₺ (KDV dahil); plan hatırlatıcıdaki 192.000 ₺ tutarını sayar,
   Ödemeler'de güncelleyin”), Nakit planında “Hatırlatıcı tutarı sabit giderden farklı” kartı ve Ödemeler'in üstünde
   bir yıl ilerisine bakan uyarı çıkar (`fixedReminderDrifts`). 23 Ekim 2026'ya kadar kalemin taban tutarını KDV'siz
   yazıyordu: bu yolla açılmış tutarlı hatırlatıcılar bu uyarıda görünür.
   “Sabit giderlerden ekle” yalnız bitmemiş kalemleri önerir (bitiş ayı yok ya da bu ay ve sonrası; E-62), bitiş ayını
   satırda söyler ve ilk ödemesi bitişten sonraya düşen hatırlatıcıyı açmaz (bu ay biten kalemde varsayılan gün bugün).
   Biten bir giderin tutarlı hatırlatıcısı bitişten sonraki dönemlerde de plana girer ama satırda ve aynı uyarıda
   söylenir (“Sabit gider Kasım 2026 ayında bitti; plan hatırlatıcıdaki 36.000 ₺ tutarını sayar, ödeme bittiyse
   Ödemeler'de kapatın”). Aylık girişe çevrilmiş gider (aynı adlı her ay girilen harcama) bitmiş sayılmaz.
   **Aylık harcamalar** (her ay girilen kategori; reklam, influencer) adı aynı hatırlatıcıyla aynı şekilde eşleşir:
   hatırlatıcı tutarsızsa harcamanın beklenen tutarını onun gününde taşır, harcama ayrıca yayılmaz. Sabit gideri aylık
   girişe çevrilmiş (dönemi bitmiş) kaleme bağlı tutarsız hatırlatıcı da Aylık harcamalar'daki tutarı taşır.
2. **Maaş** ve **SGK** (Ödemeler'deki türü ya da adı): yukarıdaki maaş ve SGK kuralı. “Sabit giderlerden ekle” ile
   açılan hatırlatıcı (personel bölümündeki kalem maaş türüyle açılır: Muhasebeci, Part-time çalışan) gideri silinse ya
   da adı değişse de bordro sayılmaz: maaşı ve SGK'yı kapatmaz, diğer hatırlatıcıdır.
3. **Vergi hatırlatıcıları** (KDV, KDV-2, muhtasar, stopaj, geçici ve kurumlar vergisi, damga, ÇTV, ilan reklam):
   27 Kasım 2026'dan beri diğer hatırlatıcı gibi (4. madde); tahminle doldurulmaz. Tekrarlı KDV, KDV-2, muhtasar ve
   geçici vergi hatırlatıcısının tutarı o döneme aittir (`taxAmountTravels`): **Ödendi** ve **Ertele** tutarı seriden
   siler (ertelemede kopyada kalır, Geri al geri yazar), yoksa Eylül'ün tutarı Kasım'da da kesin görünürdü. Sabit
   tutarlı “Kira stopajı”nın ve yalnız damga vergisinin tutarı kalır. Şube kipinde bu hatırlatıcılar şubenin akışına
   girmez (aşağıda *Şubenin nakit akışı*).
4. **Diğer:**5. **Diğer:** tutarlıysa kesin; tutarsızsa plana girmez, **Tutarı girilmemiş ödemeler** kartında adı ve ilk tarihiyle
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

**Nasıl hesaplandı** kartının altındaki düğme. Satışlar, laffogato.net online, maaşlar, SGK, mal alımı, hatırlatıcısı
olmayan her sabit gider ve her ay girilen her harcama kategorisi tek tek kapatılabilir. Kaldırılan KDV ve vergi
tahminlerinin anahtarları (`kdv`, `vergi`) kayıtta durabilir: okunur, kaydederken korunur, plana bir şey yapmaz. Faturası ayrıca gelen bir sabit gider kapatılır, iki kez
sayılmasın. Ödemeler'de hatırlatıcısı olan ve yıllık kalemler değiştirilemez (gri). “Gününü girmek için Ödemeler'e ekle”
Ödemeler'i açar.

**Dahil değil** (ekranda yazar): vergiler (KDV, muhtasar, geçici ve kurumlar vergisi, damga; muhasebeciniz yürütür,
tutarını Ödemeler'e yazarsanız planda görünür), Aylık harcamalar'da her ay girilmeyen (tek seferlik) ödemeler (cari
borçların gider kayıtları dahil), yıllık giderler, yatırım ve kredi. Kart, yemek kartı ve online
platform tahsilatı satış günü sayılır (bankaya geçiş gecikmesi yok).

**Çift sayım:** aynı ödeme hem hatırlatıcı hem fatura olarak duruyorsa iki kez sayılır (Ödemeler'deki gibi). Faturası
ayrıca gelen sabit gideri Tahmine katılanlar'dan çıkarın. Faturasız borçlar kesin kalemdir; faturası beklenenler kadar
mal tahmini düşürülür. Faturasız alımın faturası olabilecek fatura (tutarı alımınkine en çok max(1 ₺, %2) uzak, alımdan
7 gün önce ile 45 gün sonra arasında) bağlanana ya da “Ayrı alım” denene kadar plana girmez: aynı mal iki kez
ödenmesin. Bir alım yalnız gününe en yakın faturayı sessize alır (haftalık aynı tutarlı faturalar planda kalır).
Faturası beklenen alımın tahmini düşürmesi tedarikçinin vergi noyla karta düşen fatura adlarını da kapsar.

**Hesaptaki ödeme (mahsup):** tedarikçinin hesabında hiçbir kaleme sayılmamış ödeme varsa (Tedarikçiler › Ödeme ekle,
“Hesapta beklesin” ya da fazla ödeme) o para tedarikçinin kesin kalemlerinden en eski vadeden başlayarak düşülür;
tamamen karşılanan kalem plana girmez. Ödemeler'le aynı hesap; veritabanına bir şey yazmaz (kalıcı dağıtım için
Tedarikçiler'de **Borçlara say**). Notta “Hesaptaki ödeme” satırı çıkar.

## Genel bakış kartı

Yaklaşan ödemeler kartının altında **Nakit planı** kartı: seçili aydan bağımsız (bugüne göre). Bakiye varsa “6 hafta sonra
≈ …” ve en sıkışık gün (eksi günde kırmızı “1 Kasım'da para yetmeyebilir”); yoksa “Gereken en az para ≈ …” ve “Bakiyenizi
girin, kalanı görün”. Plan verisizse ya da yüklenemezse kart hiç çizilmez (`loadCashPlan(…).catch(() => null)`); sayfa
zaten okuduğu modeli ve Ödemeler listesini paylaşır, ek `loadModel()` yoktur. Zil ve e-posta uyarısı yok (önce tahminin
isabeti görülsün).

## Saklama

Tablo yok: `integration_state` tablosunda **`cashflow.plan`**:

```ts
{
  balance: number | null;      // girilen bakiye (TL)
  balanceDate: string | null;  // YYYY-MM-DD (Türkiye)
  balanceBy: string | null;    // girenin adı
  excluded: string[];          // "sales" | "online" | "salary" | "sgk" | "goods" | `fixed:${id}` | `expense:${id}` (eski "kdv", "vergi" korunur)
  vatCarry: { month: string; amount: number; date: string; by: string } | null; // eski devreden KDV: okunur, korunur, kullanılmaz
}
```

**`payments.vat-paid`** (KDV, KDV-2 ve geçici vergi hatırlatıcılarının kalıcı Ödendi kaydı) 27 Kasım 2026'dan beri
yazılmaz ve okunmaz; kayıt silinmedi (tam yedeğe girer). **`tax.settings`** (eski Vergi ayarları) yalnız bordronun üç
alanı için okunur (yukarıda SGK primi).

- Bozuk ya da eksik alan varsayılana düşer; silinmiş sabit giderin `fixed:<id>` anahtarı yok sayılır.
- Eylemler (`src/server/actions/cash-plan.ts`: `saveCashBalance`, `saveCashPlanExcluded`) yalnız yönetici; değişiklik
  işlem geçmişine yazılır (“Nakit planı: bakiye”, “tahmin ayarı”). Kayıt satır kilidiyle, durumun tamamı korunarak
  yazılır: eski `vatCarry` ve `kdv` / `vergi` anahtarları silinmez.
- `npm run db:reset` bu anahtarı **siler**: `fixed:<id>` anahtarları sabit gider kimliklerine bağlı, kimlikler baştan sayar
  (bakiye zaten kısa ömürlü).
- Tam yedek (docs/YEDEK.md) `integration_state` tablosuyla bu anahtarı da alır.

## Şubenin nakit akışı (27 Kasım 2026)

Şube seçiliyken plan kişinin şube görünümüyle (Hesabım › Şube görünümü ya da ekranın çipi; [SUBE.md › Alanlar](SUBE.md#alanlar-ödemeler-nakit-planı-tedarikçiler-komisyon-parça-4)).
**Firma geneli** kipinde bugünkü firmanın planı. **Yalnız şube** kipinde **Şubenin nakit akışı** (`loadAreaCashPlan`,
`src/lib/cash-plan-branch.ts`): gelen şubenin satış tahmini ve kasa devri; giden şubenin hatırlatıcıları, şubeye seçilmiş
faturaları, personelinin maaşı, şubenin kendi sabit giderleri ve mal tahmini. Açılış bakiyesi firmanındır: şubenin akışı
bakiyesiz kurulur, hafta satırı ve karo **Net akış** yazar, "Elinizdeki para · Firma geneli" karosu firmanın bakiyesini
bilgi olarak gösterir. İşletme geneli hatırlatıcı ve fatura ve faturasız borçlar firmanın planından hafta hafta tek
**İşletme geneli** satırında toplanır (en büyük üç kalemiyle), şubenin akışına girmez. Şubesi seçilmemiş fatura hiçbir
şubenin akışında yoktur ("Tümü"de vardır). Genel bakış'ın kartı şube kipinde "6 haftada net akış" ve işletme geneli
toplamını yazar ("· vergi ve SGK Tümü'de").

**Vergi ve SGK şubeye bölünmez** (sahibin kararı 27 Kasım 2026; [SUBE.md › Vergi şubeye
bölünmez](SUBE.md#vergi-şubeye-bölünmez-sahibin-kararı-27-kasım-2026)): Ödemeler'deki vergi ve SGK hatırlatıcıları
(türü "Vergi / SGK" ya da başlığı KDV, muhtasar, stopaj, geçici vergi, damga, ÇTV, SGK, Bağkur; `isTaxPlanReminder`)
şubenin de olsa şubesiz de olsa ne şubenin akışında ne İşletme geneli satırında; SGK tahmini de. Panel vergi tahmini
yapmaz (aynı gün Vergi bölümü kaldırıldı; KDV kartı ve şube kipindeki `#kdv` notu da kalktı). "Tahmine katılanlar"da
SGK satırı yok; "Nasıl hesaplandı" SGK notunun yerine tek not yazar: **"Vergi ve SGK ödemeleri firma geneli: Tümü'de
görünür."** (`branchPlanWithoutTax`, `FIRM_TAX_NOTE`). Bordronun neti saklı bordro ayarıyla (hesap dönemi, asgari ücret
desteği), firmanın planındaki gibi; ayar okunamazsa varsayılanlar. Stopajlı sabit gider şubenin akışında da net ödenir.
Bağlantının `odemeler` aracının nakit planı da aynı notu taşır. Tümü ve Firma geneli kipi değişmedi.

Firma geneli olan **KDV beyanı ve ödemesi**dir (muhasebeci yürütür; sahibin açıklaması 27 Kasım 2026: "ürün KDV'si falan hesaplansın, nasıl
doğruysa öyle olsun"); şubenin kendi ödemelerindeki KDV şubenin akışında durur, Tümü'deki gibi: şubeye seçilmiş faturanın
ödenecek tutarı KDV dahil (tevkifatlı faturada tedarikçiye ödenen kısım; tevkifat 2 No.lu KDV'yle firmanın), şubenin
sabit giderine faturadaki KDV eklenir, mal tahmini ve satış tahmini KDV dahil tutarlarla.

## Kod

| Dosya | İş |
|---|---|
| `src/lib/cash-plan.ts` | `buildCashPlan`, `planInputFromModel`, `goodsRows`, `reminderOccurrences`, `planNotes` (saf) |
| `src/lib/cash-plan-branch.ts` | Şubenin nakit akışı: `branchCashFlow`, `isTaxPlanReminder`, `branchPlanWithoutTax` (saf) |
| `src/lib/bordro/` | Yasal bordro (`payrollFromModel`), kural tablosu (`rulesFor`), saklı bordro ayarı, stopaj oranı (saf; `tests/bordro.test.ts`) |
| `src/server/data/cash-plan.ts` | `loadCashPlan(model, upcoming, { branch }?)`, `loadAreaCashPlan`, `loadCashPlanState` |
| `src/server/data/bordro.ts` | `loadPayrollSettings` (`integration_state` › `tax.settings`) |
| `src/server/actions/cash-plan.ts` | bakiye, tahmin ayarı |
| `src/app/panel/hatirlaticilar/nakit/` | ekran, bakiye penceresi, Tahmine katılanlar |
| `src/app/panel/dashboard-cash-plan.tsx` | Genel bakış kartı |

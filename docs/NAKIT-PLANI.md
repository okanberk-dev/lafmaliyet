# Nakit planı (önümüzdeki 6 hafta) ve KDV tahmini

Ekran: **Kâr & ödemeler › Nakit planı** (`/panel/hatirlaticilar/nakit`, yalnız yönetici; kenar çubuğunda kendi
öğesi, Ödemeler ile Nakit planı'nın başlığındaki sekmeler **Ödemeler · Nakit planı** (`SECTION_TABS.odeme`) ve ⌘K). Soru: “önümüzdeki haftalarda param yeter mi?” Plan bugünden
başlayan **42 gündür** (6 dilim × 7 gün, kayan hafta: hafta 1 = bugün … bugün+6). Her dilimde gelen, ödenecek (kesin ve
tahmini) ve hafta sonunda elde kalacak para görünür. Hesap saf modüldedir: `src/lib/cash-plan.ts` (testleri
`tests/nakit-plani.test.ts`), KDV `src/lib/kdv.ts` (`tests/kdv-tahmini.test.ts`).

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
| **Maaşlar** (`salary`) | ödenecek, tahmini | Personel: net maaş + ek ödemeler. Yemek kartı işaretli kişinin yemek kartı (Ayarlar: günlük 330 ₺ × 26 gün) ek ödeme gibi, brütleştirilmeden personele giden paraya eklenir; part-time kişinin günlük ücreti × Vardiya'daki çalışma günü (+ yemek kartı × gün + ek) brütleştirilmeden, SGK'sız eklenir (ayın Vardiya planındaki bütün günleri; planı girilmemiş haftalar sayılmaz). İkisi Vergi'nin bordrosundan gelir (Faz 5, [VERGI.md](VERGI.md) › Bordro). Ödeme ayın 1–15'indeyse önceki ayın bordrosu, sonrasındaysa o ayınki. Gün: maaş hatırlatıcısı yoksa **her ayın 1'i**. Maaş hatırlatıcıları var ama hiçbirinde tutar yoksa kimliği en küçük olanın günlerinde (“taşıyıcı”). Tutarlı maaş hatırlatıcısı varsa tahmin yapılmaz. |
| **SGK primi** (`sgk`) | ödenecek, tahmini | Önceki ayın işçi ve işveren SGK + işsizlik payları, Vergi'nin bordrosundan (`taxPayrollFromModel`, dalga 12; [VERGI.md](VERGI.md)): brüt netten gelir ve damga vergisiyle bulunur, 2026 yasal oranlarıyla (işçi %14 + %1, işveren %19,75 + %2; teşvik Vergi › Kurallar'da elle), prime esas kazancın alt ve üst sınırıyla. Excel verisinde Eylül SGK'sı **25.956,18 ₺** (Gelir-gider Ayarlar'daki %15,75'le 23.117,65 ₺ gösterir; o tablo Excel eşitliği için değişmedi). Gelir ve damga vergisi muhtasar satırındadır. Gün: SGK hatırlatıcısı yoksa **ayın son günü**; varsa maaştaki kural. Alt yazı yasal son günü söyler: “son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)” (VUK 18; plan nominal günde, erken öder). Vergi girdileri okunamazsa bordro varsayılan vergi ayarlarıyla aynı yasal oranlardan hesaplanır; yalnız muhtasar, geçici vergi ve damga satırları çıkmaz (not “gelir ve damga vergisi (muhtasar) bu planda yok”) ve stopajlı sabit gider brüt ödenir (aşağıda). |
| **Sabit giderler** (`fixed:<id>`) | ödenecek, tahmini | Hatırlatıcısı olmayan her sabit gider ay içine eşit yayılır (o ayın sürümlü tutarı): aylık ÷ ayın gün sayısı, haftalık ÷ 7, günlük × `ayda açık gün ÷ 30`. Giderler'de KDV hariç girilen tutara **faturadaki KDV** eklenir: kalemin “Faturadaki KDV” alanı (KDV yok, %1, %10, %20), boşsa bölümün varsayılanı (kira, faturalar, genel giderler %20; personel KDV'siz). 160.000 ₺ kira bankadan 192.000 ₺ çıkar. Gelir-gider KDV hariç tutarla kalır. **Kira ev sahibi türü** (Faz 5; kira kaleminde “Ev sahibi”) seçiliyse KDV ondan: **şahıs** KDV yok (kalemde %20 yazılı ya da bölümün varsayılanı olsa da 160.000 ₺ çıkar; stopaj resmi kiradan muhtasarda, resmi kira yoksa ödemeden kesilir: 128.000 ₺), **şirket** %20 KDV (160.000 → 192.000 ₺, KDV 32.000 ₺), stopaj yok. **Stopajlı sabit gider** (Vergi › Vergiye göre'de seçilen profil): şahsa kira, serbest meslek ve şahsa internet reklamında bankadan net çıkar, stopaj muhtasar satırındadır: şahsa 160.000 ₺ kira, KDV yok → 128.000 ₺ + muhtasarda 32.000 ₺; muhasebeci 10.000 ₺ serbest meslek, %20 KDV → 10.000 ₺ + muhtasarda 2.000 ₺. Satırın notu “Kira 160.000 ₺ brüt · stopaj %20 muhtasarda · ödenen 128.000 ₺”. Yurt dışına ödenen hizmette KDV yok (yabancı firma Türk KDV'si kesmez), KDV-2 ayrı satırdır. Aynı net tutar “Sabit giderlerden ekle”nin hatırlatıcıya yazdığı ve sabit giderle farkın uyarısının beklediği tutardır. Vergi beslemesi alınamazsa (muhtasar ve KDV-2 satırı yok) stopajlı ve yurt dışı kalem bugünkü gibi brüt, faturasının KDV'siyle ödenir (`planInputFromModel(…, { feed: false })`): stopaj ve KDV-2 plandan düşmez. **Yıllık** plana girmez (“Dahil değil”de adıyla yazar). |
| **Aylık harcamalar** (`expense:<id>`) | ödenecek, tahmini | Aylık harcamalar'da “her ay girilir” işaretli, mal dışı kategoriler (reklam, influencer; denetim E-13): ayın beklenen ödemesi (`model.monthlyExpensePlan`: o ay girilen, daha azsa geçen ayın gerçekleşeni; sahibe soru 7 cevaplanana kadar). Girilen tutar ödenen tutardır (KDV dahil); kategori bir fatura kategorisine bağlıysa o faturalar ödenecek tutarlarıyla (KDV dahil) eklenir. Bu ay bugüne kadar girilenler ve bu ayın bağlı faturaları (ödenmiş ya da Ödemeler'de kesin kalem) karşılanmış sayılır, kalanı ayın kalan günlerine; gelecek ayda (faturası henüz gelmemiş bağlı kategori dahil) ayın bütün günlerine eşit yayılır. Sabit gideri aylık girişe çevirmenin yazdığı tahmini kayıt (“Sabit giderdeki KDV hariç tutar (tahmini)”) ödeme sayılmaz: tutarı ya da günü düzeltilene kadar plan onu ayın kalan günlerinde öder. Adı aynı hatırlatıcı varsa onun gününde (yayılmaz). Tahmine katılanlar'dan kapatılır. |
| **Mal alımı** (`goods`) | ödenecek, tahmini | Son 8 haftanın mal faturaları (kafe dışı, demirbaş ve komisyon girmez; geçmiş kısaysa en eski mal faturasından bu yana, **14 günden kısaysa tahmin yok**). Her fatura günlük orana bölünür ve tedarikçinin gecikmesiyle ödenir: peşin çalışılan tedarikçide 0, değilse kartındaki vade, o da yoksa bildirim ayarındaki gün. Böylece bugünden sonra kesilecek faturalar vadelerinde ödenmiş olur; bugünkü ödenmemiş faturalarla çakışmaz. Tedarikçi adla bulunur (gelecek faturanın vergi nosu yok). Bir tedarikçinin açık “Faturası gelecek” borçları varsa onun tahmini o tutar kadar düşürülür (haftalık irsaliyenin aylık faturası hem tahminde hem kesin kalemde sayılmasın): notta “Sütaş tahmini, faturası beklenen 1.250 ₺ kadar düşürüldü”. Elle borç ve ödeme mal tahminine girmez (yalnız faturalar okunur). |
| **KDV** (`kdv`) | ödenecek, tahmini | Aşağıda *KDV tahmini*. |
| **Muhtasar, geçici vergi ve damga** (`vergi`) | ödenecek, tahmini ya da kesin | Vergi sayfasının beslemesi (dalga 12): aşağıda *Muhtasar, geçici vergi ve damga*. |

**Bugün kuralı:** girilen bakiye bugünü kapsar. Bu yüzden bugüne (gün 0) yalnız fatura ve hatırlatıcı yazılır (gecikmişler
dahil); bütün tahminler (satış, online, yayılan sabit gider, mal alımı, varsayılan gündeki maaş, SGK ve KDV) **yarından**
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
3. **KDV** (adında “KDV” ya da “katma değer” geçen hatırlatıcı; kira, maaş ve SGK türleri hariç): *KDV tahmini*. KDV
   tevkifatı ayrı bir ödemedir: asıl KDV'nin dönemini almaz, devredeni sıfırlamaz. KDV-2 hatırlatıcısı adında
   “tevkifat”, “2 No.lu”, “KDV2” ya da “sorumlu sıfatıyla” ile birlikte KDV geçen hatırlatıcıdır; KDV'siz yalnız
   “2 No.lu beyanname”. Yalnız damga vergisi (“KDV2 damga vergisi”, “KDV damga vergisi”) ayrı ödemedir, ne KDV ne
   KDV-2 hatırlatıcısıdır; tahakkukla birlikte yazılan (“KDV2 + damga vergisi”, “Damga vergisi ve Eylül KDV2”, “damga
   dahil”) ya da damgayı dışarıda bırakan (“KDV2 (damga hariç)”) KDV-2'dir. Başlık serbest metindir: en sağlamı
   tahakkuku “KDV2 Eylül”, damgayı ayrı “KDV2 damga vergisi” diye yazmaktır; “Muhtasar (gelir vergisi tevkifatı)” ve
   “Stopaj” muhtasardır (4. madde); “Kira tevkifatı beyannamesi”, “Tevkifat beyannamesi” ve “2 No.lu dükkan” diğer
   hatırlatıcıdır.
   KDV-2 hatırlatıcısı günlerinin dönemlerini karşılar (25 Ekim günü Eylül'ü), 1 No.lu KDV'deki gibi:
   - yazılı tutar yalnız hatırlatıcının kayıtlı (sıradaki ya da geciken) gününe aittir: o gün kesin girer ve dönemi
     alır. Tevkifat her ay o ayın faturalarındandır; tekrarlı seride **Ödendi** ve **Ertele** tutarı seriden siler
     (ertelemede kopyada kalır, Geri al geri yazar), 1 No.lu KDV'deki gibi. Yalnız damga vergisi hatırlatıcısı KDV-2
     değildir, tutarı her ay kalır. 24 Ekim 2026'ya kadar seri tutarı her gününe kesin yazılıyor, Ödendi ve Ertele onu
     silmiyordu: o tarihten önce Ödendi denmiş tutarlı KDV-2 serisinin tutarı geçen dönemindir, silin ya da düzeltin;
   - serinin öteki günlerinde ya da tutarsızsa faturalardan hesaplanan *KDV-2* tahmini hatırlatıcının gününde girer;
   - dönemi başka bir KDV-2 hatırlatıcısı almışsa ya da tahmin yoksa (KDV tahmine katılmıyor, dönemin verisi yok)
     tutarı girilmemiş ödemedir: iki kez sayılmaz, sessizce de düşmez;
   - “Ödendi” denen dönem bitmiştir, vadesinden önce denmişse de: tahmini geri gelmez, satırı olmaz. Ödenen dönemler
     KDV ve KDV-2 hatırlatıcılarının kalıcı Ödendi kaydından (`payments.vat-paid`, 24 ay, `src/lib/vat-paid.ts`; her
     Ödendi ayrı kayıt, dönemleri ödenirken yazılır) ve Ödemeler'in son ödenenlerinden (`payments.recent`) okunur:
     ödenen gün ile sıradaki gün arasındaki her dönem (“tarihe kadar ödendi” birkaçını kapatır). Erteleme ya da
     hatırlatıcıyı kapatma bir dönemi ödemiş saymaz, ödenmişi de geri açmaz; tarihi başka döneme taşımak da (28'i
     Cumartesi diye 27'ye alınan seri) açmaz. Şimdiki dönemi ödenenlerden olan etkin hatırlatıcı (tarihi geri alınan
     seri) o dönemi yine bekler. Kapalı tek seferliği yeniden açmak Ödendi'sini geri alır. “Geri al” hatırlatıcının
     döndüğü günden itibaren ödenenleri siler (aynı seride ikinci Ödendi geri alınınca ilki kalır); hatırlatıcıyı
     silmek ödemeyi silmez. Yanlış Ödendi'den sonra hatırlatıcı silindiyse KDV kartındaki “… kaydını kaldır” kaydı
     siler, dönem yeniden beklenir: o dönem için bir KDV-2 hatırlatıcısı varsa onun gününde, yoksa tahmini ayın
     25'inde plana girer; dönemin faturalarında tevkifat yoksa satır çıkmaz (kart kaldırmayı 25'inin kendisinde de
     sunar; o gün tahmin girmez, tahminler yarından, onay penceresi bunu söyler). 24 Ekim 2026'ya kadar yalnız son ödenenler okunuyordu: 30 gün ya da 30 kayıt
     (faturalarla ortak) sonra düşen kayıt dönemin tahminini geri getiriyordu;
   - ertelenen dönemin notu asıl günü taşır (“Ertelendi · asıl tarih 25.10.2026”, tekrar edenin kopyası da ertelenen
     tek seferlik de): 8 ya da 9 Kasım'a ertelenen Eylül KDV-2'si Eylül'ündür, Ekim'inkini almaz.
   Kartta hatırlatıcının taşıdığı dönem için “Plana Ödemeler'deki KDV-2 hatırlatıcısı girer: bu dönemin tutarı
   yazılıysa o, yoksa bu tahmin” yazar.
4. **Muhtasar** (adında “muhtasar” ya da “stopaj”; yalnız damga vergisi değil) ve **geçici vergi** (adında “geçici
   vergi”): Vergi beslemesi varken KDV'nin kipleriyle (aşağıda *Muhtasar, geçici vergi ve damga*). Besleme yoksa diğer
   hatırlatıcıdır.
5. **Diğer:** tutarlıysa kesin; tutarsızsa plana girmez, **Tutarı girilmemiş ödemeler** kartında adı ve ilk tarihiyle
   görünür (“Ödemeler'de tutar girin”). “KDV damga vergisi” diğerdir: kendi satırını çizer, o ayın damga satırını
   kapatır.

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

**Nasıl hesaplandı** kartının altındaki düğme. Satışlar, laffogato.net online, maaşlar, SGK, mal alımı, KDV, muhtasar,
geçici vergi ve damga (tek anahtar, `vergi`), hatırlatıcısı olmayan her sabit gider ve her ay girilen her harcama kategorisi tek tek kapatılabilir. Faturası ayrıca gelen bir sabit gider kapatılır, iki kez
sayılmasın. Ödemeler'de hatırlatıcısı olan ve yıllık kalemler değiştirilemez (gri). “Gününü girmek için Ödemeler'e ekle”
Ödemeler'i açar.

**Dahil değil** (ekranda yazar): tutarı girilmemiş yerel vergiler (ÇTV, ilan reklam), kurumlar vergisi,
Aylık harcamalar'da her ay girilmeyen (tek seferlik) ödemeler (cari borçların gider kayıtları dahil), yıllık giderler,
yatırım ve kredi. Vergi beslemesi yoksa ilk cümle “tutarı girilmemiş vergiler (muhtasar, geçici vergi vb.)” der. Kart, yemek kartı ve online
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

## KDV tahmini

Nakit planının yan sütununda **KDV tahmini** kartı (`#kdv`). Hesap tek cümledir:

> **önceki ayın satışlarındaki KDV − alış faturalarındaki KDV − önceki aylardan devreden KDV**, ayın 28'inde ödenir.

Eksi çıkarsa “Ödeme beklenmez” yazar ve fark sonraki aya devreder. Günü geçmiş satır kırmızı **Gecikmiş** rozeti
taşır; tutarı 0 olan (ödeme beklenmeyen) gecikmiş satırda geciken yalnız beyanname ücretidir (damga), rozet turuncu
**Damga ödendi mi?** olur (“Ödeme beklenmez” ile çelişmesin; ux-sade §7.10). Vergi, KDV, SGK › Özet'teki KDV satırı
aynı cevabı kapalıyken yazar (“Ödeme yok · ≈ … sonraki aya geçer”) ve tek düğmesi “Döküm ve devreden KDV” bu karta
(`#kdv`) iner ([VERGI.md](VERGI.md) §3.3). Her yerde aynı etiket: “Tahmin; kesin tutar
muhasebecinizin beyannamesindedir.” Her ödeme günü bir satırdır (“28 Kas · Ekim KDV'si ≈ 42.100 ₺”); satıra dokununca
satışların KDV'si, alışların KDV'si, devreden ve sonuç açılır.

| Konu | Kural |
|---|---|
| Dönem ve gün | Ay P'nin KDV'si P+1'in **28'inde**. Hafta sonu kaydırması yok: 28 Kasım 2026 Cumartesi, yasal son gün 30 Kasım; plan 28'ine yazar (para iki gün erken çıkmış görünür, güvenli taraf). Üç aylık KDV desteklenmez. |
| Kasa (ModPOS) | Satışlar'daki ay cirosu (KDV dahil): ciro − KDV hariç ciro, gelir-giderdeki kuralla. Ürünler satış oranıyla (%10), HİZMET satırları yani karaoke hizmet oranıyla (%20). |
| Süren ay | Ciro Genel bakış'taki ay sonu tahminiyle aya tamamlanır (÷ açık gün × ayın gün sayısı; açık gün yoksa ÷ geçen gün). Ekranda “Ekim bitmedi: 16 günün satışıyla tahmin”. |
| Ciro girilmemiş ay | Önceki, cirosu ve açık günü olan son ayın günlük KDV'si × ayın açık günü (ayın gün sayısı − Özel günler'de kafe kapalı işaretli günler; E-41) (“Ekim cirosu yok: Eylül'ün günlük ortalamasıyla”). Süren ayın ilk kasa raporundan önce de bu kural geçer. |
| laffogato.net | Sitenin her siparişte sakladığı KDV; oranı saklı olmayanlara panelin oranı (kafe ve mağaza %10, karaoke %20; `siteVat`, `src/lib/site-sales/calc.ts`). Süren ayın açık kaydı çekildiği günün dününe kadardır, aya tamamlanır. Kayıt yoksa 0; site bağlıysa dökümde “laffogato.net: bu ay çekilmedi”. Elle girilen siparişler ModPOS'tadır, sayılmaz. |
| Alış KDV'si | Faturanın **KDV toplamı** (`vat`, Paraşüt'ün `total_vat`'ı, tevkifat düşülmemiş); `vat` yoksa (Excel'den ya da elle girilenlerde 0; Paraşüt bağı çözülen kayıtta tutar, iskonto ya da ödenecek panelde değişince 0 yazılır) ya da net tutarın %20'sinden fazlaysa (24 Ekim 2026'dan önce tutarı düşürülmüş böyle bir kayıt) **ödenecek − (tutar − iskonto)**. Tevkifatlı faturada KDV'nin tamamı indirilir: beyannamede tedarikçiye ödenen kısmı “yurtiçi alımlara ilişkin KDV”, tevkif edilen kısmı “sorumlu sıfatıyla beyan edilerek ödenen KDV” olarak (23 Ekim 2026'ya kadar yalnız ilki sayılıyordu; Eylül 2026'da 1.800 ₺ eksik indirildi). İadede eksi (fark; tevkifatın iadesi 2 No.lu beyannamede düzeltilir). Kontrol bekleyen faturalar sayılır. **Kafe dışı** (Karaoke box, Alp Koç) sayılmaz. Süren ayda yalnız bugüne kadar gelen faturalar (ay sonuna tamamlanmaz; tahmin yüksek tarafta kalır). |
| Yurt dışı hizmet | Vergi beslemesiyle, yurt dışı hizmet profilli sabit giderin sorumlu sıfatıyla KDV'si (KDV-2 satırı, aşağıda) aynı dönemin alış KDV'sine eklenir: 1 No.lu beyannamede indirilir (`purchases.hizmet`, `kdv2HizmetOf`). Dökümde “İçinde yurt dışı hizmetin KDV'si ≈ 6.000 ₺” (denetim VG-04). Besleme yokken kalem faturasının KDV'siyle brüt ödendiği için eklenmez. |
| KDV-2 (tevkifat) | Dönemin kafe faturalarındaki tevkifat: `vat` − (ödenecek − net), 100 ₺'ye yuvarlı (`purchaseWithheld`). **2 No.lu beyannameyle izleyen ayın 25'inde** ödenir (Eylül 2026 tahakkuk fişi: vade 25.10.2026), 1 No.lu beyannamede aynı dönemde indirilir. 1 No.lu ödenecek sıfır ya da devreden olsa da ödenir. Beyannamenin damga vergisi (Eylül 2026 KDV2'sinde 791 ₺) Vergi beslemesiyle ayrı satırdır (aşağıda *Muhtasar, geçici vergi ve damga*). |
| Devreden | **Otomatik:** cirosu olan ilk aydan (yoksa ilk site kaydının ayından; en çok 24 ay geriden) ay ay zincir. İlk satış ayından önceki faturalar sayılmaz. Verisiz ay zinciri bozmaz. **Muhasebeciden:** “Devreden KDV'yi gir” penceresi (ay + “sonraki döneme devreden KDV”); zincir o ayın ertesinden başlar. O ayın kendi ödemesi devreden > 0 ise 0'dır (“Beyannamede devreden …”). |
| Ödemeler'deki tutar | KDV hatırlatıcısına yazılan tutar (0 dahil) **o dönemin kesin tutarıdır**, tahminin önüne geçer; KDV ödemesiyse sonraki aya devreden sıfırlanır. Vergi beslemesiyle tutar tahakkuk fişinin toplamıdır (damga dahil): yalnız beyanname damgasını (791 ₺) aşan kısmı KDV ödemesidir. Devreden olan ayın fişinde yalnız damga vardır; 791 ₺ (ya da 0) yazılan dönem devredeni silmez, sonraki aya geçirir (denetim VG-01; satırın dökümü “Ödemeler'deki tutar damgayı aşmıyor, KDV ödemesi sayılmadı”, 0 yazılmışsa “Ödemeler'deki tutar 0: KDV ödemesi yok” der). Damga dönemin beyannamesinin verildiği yılın tutarıdır (Aralık'ınki izleyen yılın; Vergi takvimindeki gibi, beslemenin `kdvByYear`'ı): yıl dönümünde bugünün yılının damgası eski dönemlere uygulanmaz. Vergi beslemesi yokken > 0 tutar KDV ödemesidir. Tutar yalnız hatırlatıcının kayıtlı (sıradaki ya da geciken) dönemine aittir: **Ödendi** deyince ve tekrarlı seri ertelenince tutar silinir (Geri al geri getirir). Ödenen tutar (Ödendi anında hatırlatıcıdaki, > 0) kalıcı Ödendi kaydından (`payments.vat-paid`, 24 ay) o dönemin kesin tutarı olarak okunur: ödemeden sonra da devredeni sıfırlar (damgayı aşıyorsa; aynı kural). Tutarsız Ödendi zinciri değiştirmez (beyanname devreden göstermiş olabilir). |
| Yuvarlama | Kasa, online ve alış KDV'si ile muhasebecinin tutarı ayrı ayrı en yakın **100 ₺**'ye yuvarlanır (yarım yukarı, işaret korunur); ödenecek ve devreden bunlardan çıkar, ekrandaki çıkarma birebir tutar. Ödemeler'deki tutar ve muhasebecinin tutarı olduğu gibi yazılır. |
| Dahil değil | İkram ve ödenmez (Z dışı), Karaoke box'ın (MaviBahçe) satışları, Aylık harcamalar'daki fatura dışı ödemeler ve faturası panele gelmeyen giderlerin KDV'si (bilinmez; tahmin bu yüzden yüksek kalır). Süren ayın kasa cirosu ay sonuna ayın açık günüyle tamamlanır: Özel günler'de kafe kapalı işaretli günler (ileri tarihliler dahil) düşülür (denetim E-41). |

**Plana yerleşme:**

- Ödemeler'de KDV hatırlatıcısı yoksa her dönem ayın 28'ine, yarından itibaren “KDV (Ekim)” tahmini satırı olarak girer.
  Kart “Ödemeler'de KDV hatırlatıcısı yok; tahmin ayın 28'ine yazıldı” der ve **Ödemeler'e ekle** önerir (KDV
  tahmine katılmıyorsa “KDV tahmini plana katılmıyor; Tahmine katılanlar'dan açabilirsiniz.”).
- KDV hatırlatıcısı varsa tahmin onun günlerine yazılır. Tutar yazılmış dönem kesindir (normal hatırlatıcı satırı);
  tutarsız dönem tahminini taşır ve “Tutarı girilmemiş ödemeler”de görünmez. Ertelenen dönemin (tekrar edenin kopyası
  ya da tek seferlik) dönemi notundaki asıl gündendir (“Ertelendi · asıl tarih 28.10.2026”): 10 Kasım'a ertelenen Eylül
  KDV'si Eylül'ündür. Notsuz bir günün ayın 1–7'si iki ay önceki dönemdir. Aynı döneme ikinci bir KDV hatırlatıcısı
  “Tutarı girilmemiş”e düşer. “Geri al” ertelemenin yazdığı notu da geri alır.
- **Ödendi** denen dönem (vadesinden önce de) bitmiştir, hatırlatıcı olsun olmasın: 28'inde tahmin olarak geri gelmez,
  satırı olmaz (KDV-2'deki kural ve kalıcı kayıt: ödenen gün ile sıradaki gün arasındaki her dönem; tek seferliğin
  Ödendi'si onu kapatır, ödendikten sonra kapatılan ya da silinen hatırlatıcının ödemesi durur; “Geri al”, tarihi geri
  alınan seri ya da yeniden açılan tek seferlik dönemini yine bekler). Kart ödenen dönemi yazar (“Eylül (27.200 ₺)
  KDV'si ödendi”); ufuktaki tek 28'i ödenmişse “önümüzdeki 6 haftada başka 1 No.lu KDV ödemesi yok” der (KDV-2 satırı
  ayrıca görünür), Tahmine katılanlar “Ekim ödendi; 6 hafta içinde başka 1 No.lu KDV günü yok” (KDV anahtarı açık
  kalır). 23 Ekim 2026'ya kadar yalnız KDV-2'de böyleydi: önceden ödenen tek seferlik “KDV Eylül” 28'inde tahmin
  olarak ikinci kez düşülüyordu. Kartın altında ödenmiş her dönem için “… kaydını kaldır” (onaylı; hatırlatıcılara
  dokunmaz): dönem yeniden ödenecek sayılır. KDV hatırlatıcısı varsa dönem yalnız bir hatırlatıcının gününde plana
  girer, o dönem için hatırlatıcı yoksa girmez (onay penceresi eklemeyi söyler); hiç KDV hatırlatıcısı yoksa tahmini
  ayın 28'inde kendiliğinden girer (pencere hatırlatıcı eklemeyi söylemez: tek seferlik bir “KDV Eylül” planı
  hatırlatıcı kipine geçirir, sonraki dönemin 28'i plandan düşer). Kart kaldırmayı ödeme gününün kendisinde de sunar;
  o gün tahmin girmez (tahminler yarından), pencere bunu söyler. KDV Tahmine katılanlar'dan kapalıysa dönemin
  tahmini hiç girmez, yalnız hatırlatıcıya yazılı tutar kendi gününde; pencere bunu da söyler. Metin `vatForgetText`'ten
  (`src/lib/kdv.ts`, planın kipiyle). 24 Ekim 2026'ya kadar onay penceresi “tahmini ya da hatırlatıcısı plana döner”
  diyordu.
- Tahmin ≤ 0 ise satır yok (kartta “Ödeme beklenmez”). Satış verisi olmayan dönemde tahmin yok. KDV hatırlatıcısının
  sıradaki günü 6 haftanın dışındaysa kartta satır olmaz (“bu dönemde KDV ödemesi yok”).
- Tahmine katılanlar'dan **KDV** kapatılırsa kesin tutarlar yine yazılır, tahminler plana girmez (kart gri, “Plana
  katılmıyor”).
- **Nasıl hesaplandı** kartında tek satır: “Önceki ayın satış KDV'si (kafe %10, karaoke %20, laffogato.net) eksi alış
  faturalarının KDV'si, ayın 28'inde …”.
- **KDV-2:** dönemin faturalarında tevkifat varsa izleyen ayın 25'ine, yarından itibaren “KDV-2 (Eylül)” tahmini satırı
  girer (anahtar `kdv2@2026-10-25`, `#kdv`'ye götürür). Kartta 1 No.lu satırların altında ayrı satırdır; dökümde alışların
  altında “İçinde tevkifat ≈ …” yazar. KDV tahmine katılmıyorsa ya da Ödemeler'deki KDV-2 hatırlatıcısı o dönemi
  karşılıyorsa plana girmez; o dönem için “Ödendi” denmişse kartta da görünmez.

**Excel verisiyle** (bugün 22 Ekim 2026): kasa KDV'si Temmuz 15.800, Ağustos 45.500, Eylül 39.200, Ekim ≈ 51.800 ₺ (16
günden aya tamamlanmış); alış KDV'si 225.300 (açılış alımları), 3.500, 11.900, 9.700 ₺. Otomatik zincirle Eylül'den
140.200, Ekim'den 98.100 ₺ devreder: 28 Ekim ve 28 Kasım'da **ödeme beklenmez**. Muhasebeci Ağustos için “devreden 0”
derse 28 Ekim ≈ 27.300 ₺, 28 Kasım ≈ 42.100 ₺.

### Muhasebecinin beyannameleriyle karşılaştırma (Temmuz–Eylül 2026)

23 Ekim 2026'da muhasebecinin 1 No.lu KDV beyannameleri (Temmuz, Ağustos, Eylül) ve Eylül'ün 2 No.lu tahakkuk fişi
geldi. Panelin Excel verisiyle hesabı (yukarıdaki paragraf) beyannamelerden şöyle ayrılıyor:

| Ay | Panel: satış KDV'si | Beyanname: hesaplanan KDV | Panel: alış KDV'si | Beyanname: indirilecek KDV | Panel: devreden | Beyanname: devreden |
|---|---|---|---|---|---|---|
| Temmuz | 15.800 (ciro 173.587, hepsi %10) | 15.383,92 (%10: 128.700,46, %20: 12.569,37 matrah) | 225.300 | 256.972,25 | 209.500 | 241.588,33 |
| Ağustos | 45.500 (ciro 500.000) | 36.999,46 (%10: 369.994,62 matrah) | 3.500 | 4.650,04 | 167.500 | 209.238,91 |
| Eylül | 39.200 (ciro 429.698) | 101.709,92 (%10: 347.099,03, **%20: 335.000** matrah) | 11.900 | 11.875,70 + 1.800 tevkifat | 140.200 | **121.204,69** |

Farkların nedeni:

1. **Tevkifat** (hesap hatası, düzeltildi): Eylül'ün reklam faturasının (30.000 + 6.000 KDV, 3/10 tevkifat) KDV'sinin
   tamamı indirilir; panel tevkifat düşülmüş 4.200'ü sayıyordu ve 25 Ekim'deki 2 No.lu ödemeyi (1.800 ₺ + 791 ₺ damga
   vergisi) hiç göstermiyordu. Hesap faturanın **KDV toplamına** (`vat`) dayanır. Paraşüt'ten gelen gider faturası onu
   taşır; Excel'den ya da elle girilen kayıtta yoktur. Böyle bir kayıt tevkifatlı bir e-faturaya bağlıysa Paraşüt
   eşitlemesi boş KDV'yi belgedeki tam KDV'yle doldurur (`withholdingVatFill`, ödenecek tutar e-faturayı tutuyorsa);
   e-faturası olmayan Excel kaydında tevkifat görünmez. Eylül'ün reklam faturası Excel'den geldiyse KDV-2 satırı ilk
   eşitlemeden sonra çıkar; 25 Ekim'den önce çıkmadıysa Ödemeler'e tutarıyla bir KDV-2 hatırlatıcısı girilmelidir.
   Paraşüt'te iptal edilen ya da silinen faturaya bağlı Excel / elle kaydın bağı çözülür, eşitlemenin yazdığı KDV
   kalır. Tutarı, iskontosu ya da ödenecek tutarı panelde değişince o KDV silinir, KDV ödenecek − net sayılır
   (pencerede görünen); 24 Ekim 2026'ya kadar kalıyordu ve aradaki fark tevkifat sanılıp 25'inde olmayan bir KDV-2
   satırı çıkabiliyordu. Böyle bir faturada gerçekten tevkifat varsa KDV-2 hatırlatıcısına tutarı elle yazılır.
   Kayıttaki KDV, net tutarın %20'sinden fazlaysa kullanılmaz.
2. **Satışlar:** beyanname ÖKC'nin (Z raporlarının) KDV'li satışıdır; panel ModPOS cirosunu kullanır. Ağustos'un
   500.000'i Excel'deki yuvarlak bir değerdir, beyannamede KDV dahil ≈ 406.994. Eylül'de ModPOS 429.698, beyannamede
   %10'luk satış KDV dahil ≈ 381.809. Satışlar'daki ay cirosunu Z toplamıyla düzeltmek tahmini beyannameye yaklaştırır.
3. **Kafe dışı:** Eylül beyannamesindeki %20'lik 335.000 ₺ matrah (67.000 ₺ KDV) kafenin satışı değil (panelde karaoke
   %20'si 2.050 ₺); beyanname şirketin tamamınındır. Karaoke box (MaviBahçe) ve Alp Koç'un satış ve alışları da aynı
   beyannamedeyse panel onları göremez: tahmin yalnız kafeyi sayar.
4. **Alışlar:** Temmuz'da beyannamede ≈ 31.700 ₺ daha fazla indirilecek KDV var; panele gelmeyen (açılış öncesi ya da
   kafe dışı) faturalar.

Sonuç: panelin kendi zinciri beyannameyi tutturamaz; **muhasebecinin son beyannamesindeki devreden girilmelidir**
(“Devreden KDV'yi gir”: Eylül 2026, 121.204,69 ₺). O zaman 28 Ekim'de 1 No.lu KDV ödemesi yoktur, 25 Ekim'de KDV-2
1.800 ₺ (ve damga vergisi) ödenir; Ekim'in tahmini 121.204,69'dan devam eder. Her ay yeni beyanname gelince devreden
güncellenir.

Karaoke payı (`monthSales(ay).serviceRevenue`) ayın satış satırlarındaki hizmet satırlarıdır: ModPOS listesi yüklenince,
LafPOS'a geçiş günü seçildikten sonra her gün sonunda (LafPOS'un karaoke satırları; [LAFPOS.md](LAFPOS.md) › Günlük
satış) kendiliğinden kesinleşir; ek iş yok.

## Muhtasar, geçici vergi ve damga

Vergi sayfası (dalga 12, [VERGI.md](VERGI.md)) plana bir besleme verir (`taxPlanFeed`, `src/lib/tax/view.ts`;
yükleyici `loadCashPlan(model, upcoming, { taxInputs })`, Vergi'nin Özet'i aynı girdiyi paylaşır). Hepsinin anahtarı
`vergi`; Tahmine katılanlar'da tek satır, **Muhtasar, geçici vergi ve damga** (not: sıradaki muhtasar tahmini ve geçici
vergi). Nasıl hesaplandı'daki satır: “Muhtasar (ücret gelir ve damga vergisi, işaretli stopajlar, beyanname damgası)
ayın 26'sında, Vergi sayfasının tahminiyle; stopajı bilinmeyen kalem varsa 'en az'. Geçici vergi yalnız tutarı
Ödemeler'e ya da Vergi'ye yazıldıysa (ya da çeyreğin hesabı hazırsa) Şubat, Mayıs, Ağustos ve Kasım'ın 17'sinde; yoksa
'Tutarı girilmemiş ödemeler'de. KDV beyannamelerinin damgası (791 ₺) ayrı satır; tutarı yazılmış KDV hatırlatıcısı damga
dahil sayılır.” Kapalıyken: “Muhtasar, geçici vergi ve beyanname damgaları plana katılmıyor (Tahmine katılanlar'dan
açın).”

| Satır | Kural |
|---|---|
| **Muhtasar** (`vergi:muhtasar@…`) | Ay P'nin tahmini (ücret gelir ve damga vergisi, stopaj profili seçilmiş sabit giderlerin stopajı, beyanname damgası) P+1'in 26'sında. Stopajı bilinmeyen kalem (kira bölümündeki, reklam ya da dışarıdan hizmet adlı profilsiz kalemler) varsa “en az”. Muhasebecinin kaydı varsa o, rozeti “Muhasebeci”. |
| **Geçici vergi** (`vergi:gecici@…`) | Yalnız üç durumda tutarla: hatırlatıcıya o dönemin tutarı yazıldıysa, Vergi'de muhasebecinin kaydı varsa (ödenecek + damga), ya da çeyrek **Hazır**sa (sınıflandırma tam, gelir mali belgeden, kafe dışı sorusu işaretli). Değilse “Tutarı girilmemiş ödemeler”de: “Geçici vergi 2026/3 · tutarı muhasebecinizden isteyin” (anahtar `vergi:gecici:2026-Q3`). |
| **KDV-2: yurt dışı hizmet** (`vergi:kdv2_hizmet@…`) | Yurt dışı hizmet profilli sabit giderin sorumlu sıfatıyla KDV'si, ayın 25'inde; dönemi tutarı yazılı bir KDV-2 hatırlatıcısı karşılıyorsa yok. |
| **Damga** (`damga:kdv@…`, `damga:kdv2@…`) | KDV ve KDV-2 tahmini plana giren dönemin beyanname damgası (791 ₺; beyannamenin verildiği yılın tutarı), aynı gün, kesin. O ayın “KDV damga vergisi” hatırlatıcısı varsa yok; tutarı yazılmış KDV hatırlatıcısı damga dahil sayılır (satır yok, not “damga dahil”). KDV tahmini 0 olsa da damga satırı çıkar. |

Yerleşme KDV'nin kipleriyle: sınıfın (muhtasar ya da geçici) etkin hatırlatıcısı varsa onun günlerinde, tutarı yazılı
dönem kesin (sabit tutarlı “Kira stopajı”nın tutarı her döneminde kesin), öteki dönemlerde beslemenin tutarı; yoksa
beslemenin nominal gününde (yarından). Ödendi denen dönem (son ödenenler; geçici vergide kalıcı kayıt
`payments.vat-paid`, tür `gecici`) yeniden girmez. `vergi` kapalıyken kesinler kalır, tahmin yok, tutarsız muhtasar ve
geçici vergi hatırlatıcıları “Tutarı girilmemiş ödemeler”e döner. İki muhtasar hatırlatıcısı aynı döneme düşerse
ikincisi “Tutarı girilmemiş”e gider.

Sabit tutarlı **“Kira stopajı”** (başlıkta “kira” ve “stopaj”, “muhtasar” değil; `isRentWithholdingReminder`)
muhtasarın yalnız kira stopajı kısmıdır (denetim VG-02): dönemi sahiplenmez. Tutarı her döneminde kesin satırdır;
muhtasarın kalanı (ücret vergileri, öteki stopajlar, damga; beslemenin `rest`'i) o dönemde başka bir muhtasar
hatırlatıcısının gününde, yoksa kira stopajı hatırlatıcısının gününde “Muhtasar (Ay)” satırı olarak girer, “Muhtasar –
kira stopajı” satırı çizilmez. Muhasebecinin rakamı varsa kalan = rakam − hatırlatıcının tutarı. Üç aylık muhtasarda
çeyrek sonunun kira stopajı üç ayınkidir (önceki ayların kira stopajı da düşülür). Başlığında “muhtasar” geçen tutarlı
hatırlatıcı muhtasarın tamamıdır, dönemi eskisi gibi sahiplenir; aynı dönemde kira stopajı hatırlatıcısı da varsa o
tamamın içindedir: kira stopajı kendi satırında kalır, “Muhtasar” satırına tamamı − kira stopajı yazılır (“Kira stopajı
(…) Ödemeler'de ayrı satırda; burada düşüldü”), toplam Vergi takvimindeki tutarla aynıdır (takvim tamamı yazar).
Muhasebecinin rakamını kaydedince Ödemeler'deki “Muhtasar” hatırlatıcısına yazılan tutar bu yoldan geçer.

Ödemeler'de “muhtasar” ya da “geçici vergi” geçen tekrarlı hatırlatıcının tutarı yalnız o dönemindir: **Ödendi** ve
**Ertele** onu seriden siler (“Muhtasar tutarı her ay değiştiği için silindi · Geri al”), KDV'deki gibi.

Hatırlatıcıya yazılan tutar Vergi'deki muhasebeci kaydından 1 ₺'den fazla farklıysa (K4) plan Ödemeler'dekini öder ve
satırın ayrıntısı söyler: “Muhasebecinin rakamı 41.991 ₺, Ödemeler'deki tutar 40.000 ₺: nakit planı Ödemeler'dekini
kullanıyor. Hangisi doğruysa öbürünü düzeltin.” Vergi'nin Özet'i aynı farkı sarı satırla gösterir.

KDV kartının verisi (`plan.vat`) Vergi takvimine de gider. Ödeme günü bugün ya da geçmiş, yasal son günü (VUK 18)
gelmemiş KDV ve KDV-2 dönemi plana girmez (bugünün ödemesi eldeki paradan) ama tutarı `plan.vat.onDue`'da durur
(`rows`, `vat2`, Ödendi denenler `paid` / `paid2`): Vergi takvimi son güne kadar tutarıyla yazar.

## Saklama

Tablo yok: `integration_state` tablosunda iki anahtar. **`cashflow.plan`**:

```ts
{
  balance: number | null;      // girilen bakiye (TL)
  balanceDate: string | null;  // YYYY-MM-DD (Türkiye)
  balanceBy: string | null;    // girenin adı
  excluded: string[];          // "sales" | "online" | "salary" | "sgk" | "goods" | "kdv" | "vergi" | `fixed:${id}` | `expense:${id}`
  vatCarry: { month: string; amount: number; date: string; by: string } | null; // muhasebecinin devreden KDV'si
}
```

**`payments.vat-paid`** (KDV, KDV-2 ve geçici vergi hatırlatıcılarının kalıcı Ödendi kaydı, `src/lib/vat-paid.ts`):
`{ id, kind: "kdv" | "kdv2" | "gecici", dueDate, next, periods, amount, at }[]` (geçici vergide dönem çeyrek,
`2026-Q3`), 24 ay. `markReminderDone` yazar; `restoreReminder`,
`undoRecentPaid`, kapalı tek seferliği yeniden açmak ve KDV kartındaki "kaydını kaldır" siler. `db:reset` bırakır
(hatırlatıcı kimlikleri yeniden başlamaz), tam yedeğe girer; bozuk kayıt okunurken atılır.

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
| `src/lib/vat-paid.ts` | KDV / KDV-2 Ödendi kaydının kuralları: `paidPeriodsOf`, `addVatPaid`, `removeVatPaid`, `forgetVatPeriod` (saf) |
| `src/server/data/cash-plan.ts` | `loadCashPlan(model, upcoming?, { taxInputs }?)` (vergi beslemesi), `loadCashPlanState` |
| `src/lib/tax/view.ts`, `src/lib/tax/payroll.ts` | Vergi beslemesi (`taxPlanFeed`), yasal oranlı bordro (`taxPayrollFromModel`); [VERGI.md](VERGI.md) |
| `src/server/data/vat-paid.ts` | `payments.vat-paid`'in okunması ve yazılması |
| `src/server/actions/cash-plan.ts` | bakiye, tahmin ayarı, devreden KDV |
| `src/app/panel/hatirlaticilar/nakit/` | ekran, bakiye ve devreden KDV pencereleri, Tahmine katılanlar, KDV kartı |
| `src/app/panel/dashboard-cash-plan.tsx` | Genel bakış kartı |

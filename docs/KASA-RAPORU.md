# Gün sonu kasa raporu

Ekran: **Kasa raporu** (`/panel/kasa`; iki rolün menüsünde de üst düzeyde, tek tıkla).
Personel her akşam kapanışta ModPOS'tan Z raporunu alır, banka POS'tan
(yazarkasa) mali Z raporunu alır, kasadaki nakdi sayar ve buraya girer. İki Z ayrı bölümdür: **ModPOS Z raporu** ve
**Banka POS Z raporu (yazarkasa)**. Telefonda iki rolün de alt menüsünde **Kasa**; günün kasa işi **Bugün** ekranında da satır olarak
görünür ([BUGUN.md](BUGUN.md)).

## Personel ne girer

| Bölüm | Alanlar |
|-------|---------|
| ModPOS Z raporu | Toplam satış, nakit, kredi / banka kartı; varsa yemek kartı, online, diğer; ödenmez / ikram (ciro dışı); indirim, Z no ve fiş sayısı (isteğe bağlı). Ya da ModPOS Z raporunun fotoğrafını çekin: rakamlar dolar |
| Kasa (nakit) | Açılış (önceki raporun ertesi güne devrinden kendiliğinden dolar), akşam sayılan nakit, gün içinde kasadan çıkan (harcama, teslim; gün içinde girilen satırlardan dolar) ve neye çıktığı, **gün içinde kasaya giren** (nakit satış dışında çekmeceye konan: bozuk para, nakit tahsilat, nakit bahşiş), sayımdan sonra teslim edilen, **kasayı sayan** (gönderen değilse listeden seçilir) |
| Banka POS Z raporu (yazarkasa) | Banka POS'tan (yazarkasa) alınan mali Z: üstünde Z RAPORU ve KDV dökümü yazar; banka gün sonu fişi değil. Fotoğraf ve dört alan: **Günlük toplam** (NET SATIŞ ya da TOPLAM satırı), **Z no** (Z NO / Z SAYAÇ, fiş no değil), **Nakit**, **Kredi kartı** (K.KARTI satırı; altındaki banka satırları değil). **Ayrıntılar** kutusunda: yemek kartı, diğer, toplam KDV, KDV dökümü (%10 ve %20'nin KDV dahil toplamı ve KDV'si; %1 yalnız okunduysa ya da yazılıysa), fiş sayısı ve **Banka gün sonu** (bankanın ayrı gün sonu fişi varsa neti; yedek). Bölüm isteğe bağlı (aşağıda [Banka POS Z raporu](#banka-pos-z-raporu-yazarkasa)) |
| Not | Fark varsa nedeni (bozuk para, iade, yanlış fiş…) |

Yazarken hesaplananlar:

- **Olması gereken nakit** = açılış + nakit satış + gün içinde giren − gün içinde çıkan (`computeCash`; form, döküm,
  e-posta, WhatsApp, düzeltme ve geç rapor istekleri, LafPOS'tan doldur ve Claude bağlantısı aynı hesabı kullanır)
- **Kasa farkı** = sayılan − olması gereken. 1 ₺'nin altı "tutuyor", eksi **eksik** (kırmızı), artı **fazla** (turuncu).
- **Ertesi güne devir** = sayılan − teslim edilen. Ertesi günün açılışı buradan dolar.
- **Kart farkı** = yazarkasanın kredi kartı (yoksa banka gün sonu) − ModPOS kart. Yazarkasa bölümünden önceki
  raporlarda bugünkü gibi banka POS − ModPOS kart.
- **Z kontrolü**: ödeme türlerinin toplamı Z toplamından farklıysa uyarı çıkar (yanlış yazılmış tutar).
- **Yazarkasa Z'si**: kendi içinde tutuyor mu (oranlar ve ödemeler günlük toplamı, oranların KDV'si toplam KDV'yi
  tutuyor mu; Z no önceki yazarkasa Z'sinden büyük mü) ve kartı ModPOS'la aynı mı. Personel yalnız bu ikisini görür;
  ModPOS ile yazarkasanın toplam, nakit, yemek kartı ve banka gün sonu karşılaştırması yalnız yöneticide
  ([Banka POS Z raporu](#banka-pos-z-raporu-yazarkasa)).

**Gün içinde kasaya giren** çoğu gün yoktur: alan tutarı varken (kayıtlı raporda da), LafPOS'tan dolunca ya da
**Kasaya giren ekle**'ye basınca görünür (ipucu: "Satış dışı: bozuk para, tahsilat, nakit bahşiş").
Varsa dökümde, e-postada ve WhatsApp'ta nakit satışın altında "+ Gün içinde giren" satırıdır. Gün içinde çıkan gibi
kasa alanıdır: ertesi gün değişirse onaya gider ([Sonradan düzeltme](#sonradan-düzeltme-ve-silme-isteği)). Alan 26 Ekim
2026'da geldi (`cash_reports.cash_in`, varsayılan 0): önceki raporlar ve önceki sürüm kopyaları 0 sayılır, ilk
düzeltmede "Gün içinde giren" değişmiş görünmez.

Gece 05:00'e kadar kapanan gün bir önceki güne yazılır. Personel bugünün ve dünün raporunu girer ya da düzeltir;
ertesi günün raporu girildikten sonra bir raporu (ve o günün kasadan çıkanlarını, fotoğraflarını) yalnız yönetici
düzeltir, çünkü ertesi günün açılışı onun devrine dayanır: "Ertesi günün raporu girildi; düzeltme için yöneticiye
yazın." Unutulan dünü sonradan girmek serbesttir. Daha eski bir günü yalnız yönetici açar. Rapor yeniden gönderilince
"güncellendi" diye işaretlenir ve önceki hâli saklanır ([Düzeltmeler](#düzeltmeler)). Arada başkası göndermişse
üzerine yazılmaz: sayfa yenilenip onun girdikleri görülür.

## Rapor numarası ve yöneticinin rapor penceresi

Sahibin kararı (4 Kasım 2026): her kasa raporunun numarası iş gününden, **KR-YYYYAAGG** (3 Kasım 2026 → `KR-20261103`;
`src/lib/cash-report.ts` `reportNo`). Şubenin günü başına tek rapor olduğu için numara şube içinde benzersizdir;
silinip yeniden girilen ya da geç girilen rapor aynı numarayı alır, sıra kaymaz. Numara Kasa'nın günden güne
listesinde, rapor penceresinin ve kayıtlı rapor kartının başlığında, gün görünümünün ladmin bölümünde, e-postanın
konusunda ve başlığında, WhatsApp metninin ilk satırında yazar. İki şubenin aynı günkü raporu aynı numarayı taşır:
birden çok kasa açıkken e-postanın konusu ve başlığı, WhatsApp metninin ilk satırı numaranın yanına şubenin adını yazar
("Kasa raporu KR-20261120 · Marina · …"; `branchPart`, `namedTill`). Tek kasada metin bugünkü gibidir.

Yöneticinin rapor penceresi sadedir (`src/app/panel/kasa/report-sheet.tsx`): üç rakam (toplam satış, sayılan nakit,
kasa), tek **Kontrol** listesi (`src/lib/cash-report-checks.ts` `reportChecks`: e-posta hatası, ödeme türleri ↔ Z,
açılış ↔ devir, kart / yazarkasa, ModPOS API, LafPOS ve fotoğraftan farklı yazılanlar; her biri tek satır, yoksa
"Kontroller tamam"), satış ve nakit kasa dökümü (satır içi uyarı yok), not ve kapalı **Ayrıntılar** (kart ve
yazarkasa, fotoğraflar, değişiklikler). Personelin kayıtlı rapor kartı ve Onaylar'daki döküm aynı kalır.

## Açılış ve devir

Açılış, önceki raporun **ertesi güne devrinden** (sayılan − teslim edilen) dolar. Yazılan açılış devirden 1 ₺ ya da
daha çok farklıysa:

- Formda açılışın altında turuncu "Önceki raporun devri 1.200 ₺ (21 Ekim); yazdığınız 120 ₺ az. …" ve **Devri
  yaz** çıkar; Sonuç kartında "Açılış devirden 120 ₺ az". Tutarken açılışın altında devrin günü ve (varsa) "arada
  rapor girilmemiş 1 gün var" yazar. Kayıtlı raporun dökümünde "Önceki rapor (21 Ekim) devri 1.200 ₺ · 120 ₺ az".
- **Not zorunludur** (rapor yeniyse ya da açılış değiştiyse): "Açılış önceki günün devrinden farklı (120 ₺ az):
  nedenini nota yazın". Tutmayan eski bir raporda yalnız Z'deki bir yazım hatasını düzeltmek engellenmez.
- Kayıtlı raporda, günden güne listesinde (**Açılış ≠ devir** rozeti), e-postada ve WhatsApp'ta: "⚠️ Önceki devir
  1.200 ₺ (21 Ekim): açılış 120 ₺ az". Yöneticinin zilinde bugünün ve dünün raporu için "Kasa açılışı devirle
  tutmuyor".
- Denetim okurken yapılır: ertesi günün açılışı kullanıldıktan sonra düzeltilen önceki gün de yakalanır. O günün
  "Ertesi güne devir" satırının altında "22 Ekim açılışı 1.080 ₺ · 120 ₺ farklı", e-postada "⚠️ 22 Ekim açılışı
  (1.080 ₺) bu devirle tutmuyor". Düzeltmeyi kaydeden de uyarılır: "22 Ekim açılışı bu devirle artık tutmuyor".

## Fotoğraftan doldurma

ModPOS Z raporu ve Banka POS Z raporu (yazarkasa) bölümlerinde **Fotoğraf çek** (telefonda arka kamera) ya da
**Galeriden seç**. Fotoğraf telefonda küçültülür, yüklenir ve Claude ile okunur (genelde 5–10 saniye); okunanlar forma
dolar. **Hiçbir şey kendiliğinden kaydedilmez:** personel bakıp **Raporu gönder**'e basar. Yükleme bölüm başınadır:
yazarkasa Z'si okunurken ModPOS Z'sinin fotoğrafı çekilebilir; **Raporu gönder** süren yüklemeyi bekler.

> **Yazarkasa Z'si şimdilik yalnız öneridir.** Banka POS Z raporunun fotoğrafı okunur ama hiçbir rakamı forma
> **yazılmaz**: her alanın altında "Fotoğraftan okundu; fişle karşılaştırıp yazın. Fotoğrafta 9.350 ₺." ve
> **Fotoğraftakini yaz** çıkar, özet satırı "Banka POS Z raporu okundu; turuncu alanları fişten yazın." Bu, gerçek
> fotoğraflarla canlı değerlendirme geçene kadar sahibin kararıdır (`OKC_PREFILL_ENABLED`, `src/lib/okc-z.ts`;
> [planlar/okc-z.md](planlar/okc-z.md) §10, §17 b2). Değerlendirme için gerekenler ve kapı açılınca ne değişir:
> [Banka POS Z raporu](#banka-pos-z-raporu-yazarkasa). ModPOS Z'si ve kasadan çıkan fişler bugünkü gibi dolar.

- Dolan alanın yanında mavi **Fotoğraftan** yazar. Net okunamayan ya da bir denetime takılan alan turuncudur, altında
  nedeni yazar; fişle karşılaştırın.
- Fotoğrafta tahmin edilen (net olmayan) rakam forma yazılmaz: altında "Fotoğrafta net okunamadı (…); fişten yazın."
  ve **Fotoğraftakini yaz** çıkar. Okunamayan alan da turuncu kalır: "Fotoğrafta okunamadı; fişten yazın."
- Önceden elle yazılmış alan değişmez; fotoğraftaki farklıysa altında "Fotoğrafta …" ve **Fotoğraftakini yaz** çıkar.
- Denetimler: fişin tarihi raporun günü değilse, Z no aynı şubenin önceki raporundakinden büyük değilse ya da arada
  atlama varsa, ödeme türleri toplamı Z toplamını tutmuyorsa, tanınmayan bir ödeme satırı, ikram ve iade satırları,
  soluk ya da kesik fotoğraf.
- **Yanlış bölüm** hiçbir alanı doldurmaz; aynı fotoğraf düğmeyle öteki bölüme okutulur:
  - ModPOS bölümüne yazarkasanın Z'si: "Bu yazarkasanın (banka POS) Z raporu gibi görünüyor, ModPOS'unki değil." ve
    **Banka POS Z bölümüne okut**. Banka gün sonu fişi de aynı düğmeyle ("Bu bir banka gün sonu fişi gibi görünüyor,
    Z raporu değil.").
  - Banka POS Z bölümüne ModPOS'un Z'si: "Bu ModPOS'un Z raporu gibi görünüyor." ve **ModPOS bölümüne okut**.
  - Banka POS Z bölümüne X raporu ("Bu bir X raporu (gün içi) gibi görünüyor; yazarkasadan Z raporunu alıp çekin."),
    mali hafıza / dönem raporu ("… günün Z raporunu çekin.") ya da başka bir kâğıt: düğme yok.
- **Banka POS Z bölümü** ([YAZARKASA-Z.md](YAZARKASA-Z.md)): Z no, günlük toplam, oran oran KDV, ödemeler ve fiş sayısı
  okunur; kümülatif (KÜM.) satırlar günün rakamı olarak hiçbir alana gitmez. Rakamlar birbirini tutmuyorsa tutmayan
  alanın altında tek bir sade neden yazar ("Nakit, kart ve öteki ödemeler toplanınca günlük toplam çıkmıyor (120 ₺
  az)."; ödemeler fazla çıkarsa tutar yazılmaz, fazlası yazarkasa dışı tahsilat olabilir ve tutarı yalnız yöneticiye
  gider. Okuma ya da kayıtlı rapor Z'de yazarkasa dışı tahsilat gördüyse fazlası turuncu olmaz) ve o rakam hiçbir
  zaman kendiliğinden yazılmaz. Z no önceki yazarkasa Z'siyle aynıysa okumanın bütünü durur:
  "Bu Z no (0187) 21 Ekim raporunda da var; dünkü Z raporu olabilir." Aynı şeritte banka gün sonu da basılıysa **Banka
  gün sonu** da okunur ("Aynı fişte banka gün sonu da var: …"); yalnız banka gün sonu fişi çekilirse yalnız o alan:
  "Bu banka gün sonu fişi; yalnız Banka gün sonu okundu. Yazarkasanın Z raporunu da çekin." Doldurma kapısı kapalıyken
  alan dolmaz, öneri olur; özet satırı "Banka gün sonu fişi okundu; turuncu alanı fişle karşılaştırıp yazın." (Z raporu
  demez).
- İki banka gün sonu fişi varsa ikincisinde **Toplama ekle** ya da **Yerine yaz** sorulur. İkinci fişin rakamı net
  değilse soruda söylenir; seçilen tutar turuncu kalır, fişle karşılaştırın.
- Uzun bir Z raporu tek fotoğrafta okunmuyorsa üst ve alt yarısını ayrı çekin: ikinci fotoğraf yalnız boş alanları
  doldurur. Banka POS Z bölümünde seçicinin altında "Fişi düz koyun, ekranı fişle doldurun; uzunsa önce üstünü, sonra
  altını çekin."; tek fotoğrafta temel bir rakam tutmazsa ya da net okunmazsa "Fişin üst ve alt yarısını ayrı
  çekerseniz rakamlar daha net okunur." Bölüme en çok 3 fotoğraf (raporun toplamı en çok 6); kesik fişte "Fişin bir
  kısmı fotoğrafta yok; kalan kısmını ayrıca çekin."
- **Kaldır** fotoğrafı formdan çıkarır (ondan dolan ve değiştirilmemiş alanlar boşalır). Gönderilmeyen fotoğraf 2
  günde silinir.
- Okuma kapalıysa ya da bu ortamda kurulu değilse fotoğraf yine kanıt olarak eklenir, rakamlar elle yazılır.

Ayrıntı (depo, kim görür, saklama, maliyet, KVKK): [FOTOGRAF.md](FOTOGRAF.md).

**LafPOS günü** (yalnız LafPOS'a geçiş gününden itibaren, Ayarlar › LafPOS (kasa); boşken kasa ModPOS, form ve metinler
bugünkü gibi; denetim B09): Z bölümünün adı **LafPOS gün sonu (Z)**, ModPOS Z fotoğrafı çekilmez (Banka POS Z bölümü
kalır). LafPOS günün sonunu gönderdiyse yeni form açılırken Z ve kasa rakamları fotoğrafınkiyle aynı kuralla yalnız
boş alanlara kendiliğinden yazılır; Düzenle'de (ve düzeltme önerisinde) form yalnız karşılaştırır, LafPOS'tan farklı
olanlar turuncu ve öneri olarak durur; bant **LafPOS'tan doldur** ile boş alanları doldurur; hiçbir şey kaydedilmez. Kayıtlı rapor, günden güne görünüm, e-posta ve WhatsApp "LafPOS'tan farklı yazılan"ı gösterir
([LAFPOS.md](LAFPOS.md) › Kasa raporu). LafPOS gününde metinler de günün kasasıyla yazılır (denetim B11): sayfanın
açıklaması ve Bugün'ün / zilin akşam satırı "LafPOS'ta Günü kapat", yazarkasa karşılaştırmaları ("Kart: yazarkasa ile
LafPOS aynı.", "LafPOS kart") form, kayıtlı görünüm, onay kartı, e-posta ve WhatsApp'ta; kapalı gün kartının ipucu "o
günün LafPOS / banka POS'una bakın". Yazarkasa bölümüne çekilen kasa çıktısına "ModPOS bölümüne okut" önerilmez
([LAFPOS.md](LAFPOS.md) › Metinler ve kasadaki fiyatlar).

## Banka POS Z raporu (yazarkasa)

Banka POS'tan (yazarkasa) alınan mali Z raporu ModPOS'un Z'sinden ayrı bir sayaçtır ve formda kendi kartındadır
(`okc-card.tsx`). Kâğıdın düzeni, etiketleri, rakamların birbirini nasıl tutması gerektiği ve okuma tuzakları:
[YAZARKASA-Z.md](YAZARKASA-Z.md). Karar ve gerekçeler: [planlar/okc-z.md](planlar/okc-z.md).

- **İsteğe bağlı.** Bölüm bütünüyle boş kalabilir. Bir tutar yazıldıysa üçü gerekli: "Yazarkasa günlük toplamı gerekli
  (bölümü boş da bırakabilirsiniz)", "Nakit gerekli (yoksa 0 yazın)", "Kredi kartı gerekli (yoksa 0 yazın)". Bir oranın
  toplamı ile KDV'si birlikte yazılır ("%10 için toplam ve KDV birlikte yazılır"), KDV toplamdan büyük olamaz. Kural
  formda ve sunucuda aynı metinle. İlk yazarkasa Z'li rapordan sonra girilmeyen gün yöneticide **Yazarkasa Z yok** rozeti
  alır.
- **Fotoğraf yoksa** dört alan yazılır (Günlük toplam, Z no, Nakit, Kredi kartı; varsa yemek kartı ve diğer). KDV dökümü
  isteğe bağlıdır; boş kalanı yönetici sonradan kâğıttan yazabilir (ay satırı o günü "KDV dökümü eksik" sayar).
- **Ayrıntılar** fotoğraftan dolunca açılmaz; içinde turuncu alan ya da hata varsa, ikinci banka gün sonu fişinin
  sorusu (**Toplama ekle** / **Yerine yaz**) bekliyorsa, yönetici düzenliyorsa ya da yalnız banka POS'u yazılı eski
  raporda açık gelir. Kendiliğinden açılan kutu, turuncu yazarken kaybolsa da açık kalır (yalnız düğmeyle kapanır).
  Kapalıyken başlığı "Ayrıntılar · 1 rakamı fişle karşılaştırın" olur. Ayrıntılar'daki alanlar (fiş sayısı, KDV, döküm,
  yemek kartı, diğer) boş bırakılırsa "Fotoğraftan farklı" sayılmaz; yalnız yazılan karşılaştırılır.
- **Canlı denetim** (elle yazılana da; gönderimi engellemez): alan başına tek turuncu neden ve kartın altında tek özet
  satırı ("2 rakam birbirini tutmuyor; turuncu olanları fişle karşılaştırın."). Z no önceki yazarkasa Z'siyle
  karşılaştırılır: personelin formuna önceki Z'nin yalnız günü ve numarası gelir.
- **Karşılaştırmalar** (1 ₺ tolerans; satır yalnız iki tarafın da değeri varsa çıkar):

| Satır | Kim görür | Metin |
|---|---|---|
| Kart | personel ve yönetici | "Kart: yazarkasa ile ModPOS aynı." / "Yazarkasa kartı, ModPOS'taki karttan 120 ₺ fazla. Kartla alınan bir ödeme ModPOS'ta başka ödeme türüyle girilmiş olabilir." Yazarkasa kartı yazılmadıysa banka gün sonuyla: "Banka gün sonu, ModPOS'taki karttan 120 ₺ fazla." |
| Kendi içinde | personel tek satır, yönetici ayrıntılı | Formda "1 rakam fişteki ötekileri tutmuyor; turuncu olanı fişle karşılaştırın.", kayıtlı raporda "Yazarkasa rakamları birbirini tutmuyor; fişle karşılaştırın, yanlışsa raporu düzeltin." / "Yazarkasa Z'si kendi içinde tutmuyor: Ödemelerin toplamı (11.420 ₺) günlük toplamı (11.540 ₺) tutmuyor; fişe bakın." Yöneticide (kayıtlı rapor, e-posta, rozet) sunucunun sakladığı yazarkasa dışı tahsilat da sayılır (okumayla aynı); personelin formunda o tutar yoktur |
| Nakit | yönetici | "Nakit: yazarkasa ile ModPOS aynı." / "Yazarkasa nakdi, ModPOS'taki nakitten 60 ₺ az." |
| Toplam | yönetici | "Toplam: iki Z aynı." / "ModPOS toplamı 1.435,50 ₺ fazla; online ve diğer satışlar kadar (yazarkasadan geçmez)." / "ModPOS toplamı yazarkasadan 2.100 ₺ fazla." |
| Yemek kartı | yönetici | "Yazarkasa yemek kartı, ModPOS'takinden 50 ₺ az." (ikisi de doluysa) |
| Banka | yönetici | "Banka gün sonu yazarkasa kartıyla aynı." / "Banka gün sonu, yazarkasa kartından 40 ₺ fazla (bir gün gün sonu alınmadıysa iki günü kapsar)." |

  ModPOS ile yazarkasa arasındaki toplam ve nakit farkı kendiliğinden hata değildir (online satış, faturalı satış, Z'nin
  alındığı saat) ve işletmenin satış dağılımıdır: personelin ekranına, personelin sayfa verisine ve WhatsApp metnine
  girmez; yöneticinin ekranında ve e-postasında eksiksiz durur (plan İlke 8, S2'nin varsayılanı). Personel yalnız kart
  satırını (düzeltebileceği tek fark) ve yazarkasanın kendi içinde tutmadığını görür. Toplam ve nakit farkı rozet de
  almaz.
- **Kümülatif (yalnız yönetici).** Fotoğraftaki KÜM. satırları sunucuda okunur ve yalnız inandırıcıysa saklanır (önceki
  saklanan kümülatifle zincir tutuyor, ilk kümülatif ya da arada girilmemiş Z'ler; elle düzeltilmiş raporda hiç). Kayıtlı
  raporda "Kümülatif (cihaz açılışından beri): 1.259.350 ₺ · KDV 118.943,94 ₺" ve **Kümülatifi temizle** (onay penceresi:
  yanlış okunmuş kümülatif sonraki günlerin denetimini bozar; rapor değişmez, işlem geçmişine "Yazarkasa kümülatifi
  temizlendi" düşer, yeni bir Banka POS Z fotoğrafı okununca yeniden yazılır). Saklanmadıysa "Kümülatif okundu ama önceki Z'yle tutmadığı için saklanmadı
  (1.259.530 ₺)." ya da "Kümülatif saklı değil (okunan …). Yeni bir Banka POS Z fotoğrafı okununca yeniden yazılır."
  (temizlenmiş ya da yazıldığında önceki bir kümülatifle tutmamış). Z no ve kümülatif son saklanandan küçükse (cihaz
  değişti ya da EKÜ / mali hafıza yenilendi, Z sayacı sıfırlandı) okunan kümülatif yeni zincirin ilki olarak saklanır;
  okumada Z no "tutmadı" sayılmaz, yöneticiye bilgi satırı çıkar. Personelin formu kümülatifi bilmediği için o ilk gün
  Z no'yu turuncu gösterir. Z'de toplam dışı tahsilat varsa "Z'de toplam
  dışında 1.250 ₺ tahsilat var (faturalı satış, bilgi fişi…); toplama eklenmedi." Bunlar personelin okuma yanıtına ve
  sayfa verisine girmez (`toStaffReading`, `tests/personel-sizinti-kasa.test.ts`).
- **Düzeltme ve geç rapor.** Yazarkasa alanları hassas değildir (Z ve kart gibi): ertesi gün düzeltmesi doğrudan,
  kilitli günde onaya ([Sonradan düzeltme](#sonradan-düzeltme-ve-silme-isteği)). Geç raporda yazarkasa kartı görünür,
  fotoğrafı kabul edilir ama zorunlu değildir; yöneticinin onay kartında iki yanlı satır: "Banka POS Z no 0188: önceki
  0187 (21 Ekim) ✓ · sonraki 0189 (23 Ekim) ✓ · kümülatif iki yanda da tutuyor" (tutmayan halka kırmızı). Onaylanan geç
  raporda kümülatif öteki raporlardaki gibi yazılır.
- **Fotoğraf kaldırma.** Yazarkasa rakamı yazılmış raporun tek Banka POS Z fotoğrafı kaldırılamaz ("Raporun tek Banka
  POS Z fotoğrafı kaldırılamaz: yazarkasa rakamlarının kanıtı"). Onaylanan kaldırmada kümülatif kalan fotoğrafların
  okumasından yeniden hesaplanır.
- **Eski raporlar** (bu bölümden önce): kayıtlı raporda bugünkü "Kart" bölümü, etiket "Banka POS" (o günlerde alan banka
  gün sonunu da yazarkasa Z'sinin kart satırını da tutabilir; anlam iddia edilmez). Eski banka POS fotoğrafları
  (`kasa-pos`) Banka POS Z bölümünde görünür; yeniden okunursa yazarkasa Z'si olarak okunur. Yayın sırasında açık kalan
  eski sayfa fotoğraf yükleyebilir: sunucu onu yazarkasa Z'si olarak okur, eski sayfaya yalnız banka gün sonu fişinden
  okunan tutarı (öneri olarak) döner; yazarkasa Z'sinin toplamı ya da kartı hiçbir zaman Banka POS'a yazılmaz. ModPOS
  bölümünün yanlış belge düğmesi bu süre boyunca `kasa-pos` der: eski sayfa onu kendi "Banka POS bölümüne okut"
  düğmesiyle gösterir ve aynı eski yoldan okutur; yeni sayfa onu Banka POS Z bölümüne çevirir (`kasa-pos`un
  kaldırıldığı PR'da `kasa-okc` olur).

**Fotoğraftan doldurma kapısı ve sahipten beklenenler.** Yazarkasa Z'sinin okuması bugün hiçbir alanı doldurmaz
(`OKC_PREFILL_ENABLED = false`, yukarıda [Fotoğraftan doldurma](#fotoğraftan-doldurma)). Kapı, gerçek fişlerle yapılan
canlı değerlendirmede ([planlar/okc-z.md](planlar/okc-z.md) §10, §17 b2 ve b8) **yanlış dolan alan 0** ve **"doğrulandı
ama yanlış" 0** çıkınca açılır. Bunun için:

1. **Sahip:** 5–8 günün banka POS Z fotoğrafı; 2–3'ü ardışık günler (kümülatif satırları ancak böyle sınanır), biri uzun
   ve soluk, en az biri ayrıca üst ve alt yarı olarak. Fotoğraflar **asıl çözünürlükte** (telefonun kendi fotoğrafı;
   WhatsApp'ın sıkıştırdığı resim değil: WhatsApp'tan "belge" olarak, Drive ya da e-postayla) ve aynı günlerin
   kâğıttan doğru rakamları (Z no, günlük toplam, %10 ve %20 toplam ve KDV, toplam KDV, nakit, kart, yemek kartı, fiş
   sayısı, KÜM. TOPLAM ve KÜM. KDV). Ayrıca cihazın markası ve modeli, Z'yi kimin saat kaçta aldığı, ModPOS raporunun
   hangi yazıcıdan çıktığı ([YAZARKASA-Z.md](YAZARKASA-Z.md) §6).
2. **Geliştirici:** fotoğrafları `tests/fixtures/okc-z/`'ye koyar, değerlendirme betiğini (`scripts/okc-eval`, plan
   §10.2; henüz yazılmadı) `ANTHROPIC_API_KEY` ile canlıda üçer kez çalıştırır (para harcar: okuma başına tahmini
   0,05–0,10 $, bütün değerlendirme birkaç dolar), istemi ve eforu sonuca göre düzeltir, tabloyu `docs/planlar/ekler/okc-z/eval.md`'ye yazar.
3. Geçerse `OKC_PREFILL_ENABLED` `true` olur; ekran değişmez: doğrulanan alan mavi dolar, net okunup denetlenemeyen alan
   mavi, orta güvenli alan turuncu dolar; tutmayan ve net okunmayan alan yine yazılmaz, öneri olur.

## Gün içinde kasadan çıkanlar

Formun üstündeki kart: gün içinde kasadan çıkan her para bir satır (market, buz, tamirci, gün ortası teslim).

- **Fiş ekle** fişin fotoğrafını çeker; tutar, yer, ne alındığı, fiş tarihi, KDV ve kategori okunup pencereye dolar
  (**Fişten** yazar), personel bakıp **Kaydet**'e basar. **Fişsiz ekle**: **Alışveriş** ya da **Teslim · ödeme**
  (kime; yer tutucu "ör. patrona, bankaya, tedarikçiye (Sütaş)"). Seçimin altındaki ipucu: "Tedarikçinin şoförüne
  verilen borç ödemesi Teslim · ödeme'dir; gidere yazılmaz."
- Personelin alışveriş satırı (fiş ya da fişsiz) **Aylık harcamalar**'a da yazılır: not "Kasadan · 21 Ekim Çarşamba",
  ödeme şekli nakit, harcama tarihi fişin tarihi (kasa gününden en çok 3 gün önceyse). Fatura ya da e-Arşiv fatura
  yazılmaz (Paraşüt'ten de gelir, iki kez sayılmasın); teslim hiçbir zaman. Yönetici her satırda
  "Aylık harcamalar'a da yaz"ı seçer. Personel yalnız alım ve genel gider kategorilerini seçebilir.
- **Faturalı alımlar** (denetim E-42): e-Arşiv ve kâğıt fatura Paraşüt'e ancak muhasebeci girerse düşer
  ([PARASUT.md](PARASUT.md)), bu yüzden fatura ya da e-Arşiv belgeli alışveriş satırı (personelin ya da "Aylık
  harcamalar'a da yaz"ı kapalı yöneticinin) faturası gelene kadar yöneticinin **bekleyen listesinde** durur
  (`src/server/data/cash-out-invoices.ts`): Aylık harcamalar'da kaydı yok, bir tedarikçi ödemesine bağlı değil,
  listeden çıkarılmamış ve aynı mağazadan (aynı ad, adın baştan kelimeleri ya da aynı tedarikçi kartı: diğer adlar,
  vergi no) fişin gününden ±7 gün, ±1 ₺ içinde faturası olmayan satır. Bir fatura tek satırı kapatır; aynı alımdan iki
  tane varsa fatura günü yakın olanındır, öteki bekler ve eylemleri çalışır. Son bir yılın satırlarına bakılır (daha
  eskisi kapanmış yıldadır); kapatılan satırlar sayılmaz. Zil (Faturalar başlığı), Bugün'ün Faturalar satırı,
  Genel bakış › Bu ayın işleri (fişin günü o aydaysa Faturalar yapılacak kalır), Faturalar'ın uyarısı ve (giderse)
  sabah e-postası sayar; liste **Faturalar › Kontrol bekleyen**'in üstündeki **Kasadan faturalı alımlar** kartında.
  Satır başına: **Faturalar'a ekle** (pencere kasadan dolu: tarih fişin günü, tedarikçi yer, Ödenecek kasadan çıkan,
  net fişteki KDV'yle, Ödendi · nakit; parası kasadan çıktığı için cari takipteki kartın hesaptaki parasını kullanmaz;
  kaydedince fişin fotoğrafı faturanın belgesi olur ve satır kalkar: satır kilitlenir, "hâlâ bekliyor mu", fatura ve
  satırın kapanması tek işlemde, iki sekmeden aynı anda ya da "Aylık harcamalar'a yaz"la yarışta alım bir kez sayılır
  (denetim FC-04); fatura silinirse geri gelir, silme Geri al'la
  geri alınırsa satır yine o faturaya bağlanır), **Aylık harcamalar'a yaz** (kategori seçilir; aynı yerin son kasa
  harcamasının kategorisi önerilir; Kasa'nın yazım yolu, Geri al'lı) ve **Listeden çıkar** (faturası başka adla var
  ya da kafenin gideri değil; Geri al'lı; satırı o da kilitler, "Faturalar'a ekle"yle aynı anda basılırsa biri
  ötekinin sonucunu görür, faturanın satırla bağı silinmez). Eşleşen fatura gelince satır kendiliğinden kalkar.
- **İki kez sayılan alım** (inceleme D2): Aylık harcamalar'a yazılmış faturalı satırın faturası sonradan Faturalar'a
  gelirse (muhasebeci e-Arşiv'i Paraşüt'e girdi) alım hem faturada hem gider kaydında sayılıyordur. Satır eşleştirmede
  kendi faturasını alır (başka bir bekleyeni kapatmaz) ve aynı kartta, zilde (kırmızı), Bugün'de, Genel bakış'ta ve sabah
  e-postasında **iki kez sayılıyor** diye çıkar: **Gider kaydını sil** (alım faturayla sayılır; Geri al'lı) ya da **Ayrı
  alım** (fatura başka bir alımın; gider kaydı kalır, satır listeden çıkar). Kaydı bir cari borcun olan satır burada
  çıkmaz: faturası Tedarikçiler'de borca bağlanır. "Faturalar'a ekle" ile faturasına bağlanmış satıra sonradan gider
  kaydı açıldıysa o da iki kez sayılıyor diye çıkar; faturası o satırdan açıldığı için başka bir alımın olamaz: satırda
  yalnız **Gider kaydını sil** var ("bu satırdan eklendi"), Ayrı alım yoktur ve sunucu da reddeder (kapatmak faturayla
  bağını siler, gider kaydı uyarısız kalırdı).
- Personel listeyi görmez; pencerede "Fatura olduğu için Aylık harcamalar'a yazılmadı; yönetici Faturalar'da görür"
  yazar. Faturalı diye girdiği satırı **Fiş**'e (ya da belgesize) düzeltirse satır hâlâ faturasını bekliyorsa Aylık
  harcamalar'a yazılır (kategori sorulur); faturası geldiyse ya da yönetici listeden çıkardıysa yazılmaz (inceleme D5).
- Akşam raporunun **Gün içinde kasadan çıkan** tutarı ve **Neye çıktı** notu satırlardan dolar ("Fişlerden: 2 kalem ·
  …"). Yazılan tutar satırların toplamından azsa uyarı çıkar (engellemez).
- **LafPOS gününde de kaynak bu satırlardır** (denetim E-35; sahip sorusu 5 cevaplanana kadar varsayılan): Aylık
  harcamalar ve tedarikçi ödemeleri buradan okunur. LafPOS'un harcama + teslimi tutmuyorsa formda bilgi satırı:
  "LafPOS'ta harcama 450 ₺ + teslim 5.000 ₺; Kasadan çıkanlar'da 450 ₺. Teslimi Kasadan çıkanlar'a "Teslim" olarak
  ekleyin; Gün içinde çıkan kendiliğinden 5.450 ₺ olur." Fişler varken alanın altında "LafPOS'ta 5.450 ₺" görünür ama
  **LafPOS'takini yaz** yoktur (fişsiz çıkış olurdu). Geç rapor ve düzeltme kartında fişlerden fazlası LafPOS'taki teslim
  kadarsa "fişsiz" sayılmaz: "Fark LafPOS'taki teslim (5.000 ₺), fişsiz değil".
- Satıra dokununca düzeltilir ya da silinir (Geri al 8 saniye; satır harcama kaydıyla birlikte, olduğu gibi ve eski
  numarasıyla geri gelir). Geri al'ın taşıdığı kopya sunucunun mühürüdür (`src/lib/cash-outs.ts` › `cashOutUndoJson`):
  yalnız silen kişi, 15 dakika içinde ve bir kez kullanır; istemcinin yazdığı bir kopya kabul edilmez. Gün personele
  kapanınca (ertesi günün raporu girildi ya da dünden eskisi) personelin eklemesi ve düzeltmesi yöneticinin onayına
  gider (aşağıda).
- Personelin düzeltmesi Aylık harcamalar kaydını açmaz ve silmez: yöneticinin oradan sildiği kayıt geri gelmez,
  faturaya açtığı kayıt kalır; tutar ve tarih kayda yansır, yöneticinin yazdığı açıklama, ödeme şekli ve not kalır.
  Kaydı yöneticinin kategorisindeki (maaş, kira gibi) satırın her değişikliği ve silinmesi yöneticinin onayıyla
  (aşağıda); kategoriyi yalnız yönetici değiştirir.
- Aylık harcamalar'da bu kayıtlarda fotoğraf simgesi ve **Kasadan** rozeti görünür; tutarı ve tarihi Kasa raporu'nda
  düzeltilir. Aylık harcamalar'dan silinen kayıt kasa satırını silmez.

### Tedarikçiye kasadan ödeme (Teslim · ödeme)

Tedarikçinin şoförüne kasadan verilen borç ödemesi **Teslim · ödeme**'dir (Kime: tedarikçinin adı): gider yazmaz,
akşamki "Gün içinde kasadan çıkan" toplamına girer. Yönetici satırı Tedarikçiler'de o tedarikçinin hesabına ödeme
olarak işler ([TEDARIKCILER.md](TEDARIKCILER.md) *Hesap hareketleri*); gider ve KDV değişmez.

- **Ad ipucu (personel ve yönetici):** fişsiz alışverişte Yer bir tedarikçinin adı ya da diğer adıysa pencere "Sütaş
  tedarikçimiz. Borç ödemesiyse 'Teslim · ödeme' seçin; alışverişse böyle kalsın." der ve **Teslim · ödeme'ye çevir**
  düğmesini gösterir. Ad listesi yalnız adlardır (tutar, borç ya da fatura gitmez) ve borca göre süzülmez.
- **Yöneticinin satır ipuçları** (gün görünümü; son 60 gün):
  - ödemeye bağlı satırda **Sütaş ödemesi** (tedarikçinin sayfasına gider);
  - işlenmemiş, adı bir tedarikçiyle eşleşen Teslim satırında "Tedarikçiye ödeme mi (Sütaş)? · **Hesaba işle**"
    (Ödeme ekle, Kasadan ve bu satırla açılır);
  - fişsiz alışverişte, tedarikçinin o gün açık kalemi varken "Tedarikçi ödemesi miydi (Sütaş)? · **Ödemeye çevir** ·
    **Ayrı alım**". Ödemeye çevir satırın gider kaydını siler (ödeme gider değildir; geçmiş aysa ay onayı), satırı
    Teslim · ödeme yapar ve satıra bağlı ödemeyi açar; Geri al (bildirimden ya da Ödemeler › Son ödenenler'den) satırı
    ve gider kaydını eski hâline getirir (kayıt geçmiş aya dönüyorsa Son ödenenler ayı sorar).
  - Kime / Yer alanı ekle yazılsa da tedarikçiyle eşleşir ("Sütaş'a", "tedarikçiye (Sütaş)").
  - Aynı satırlar Tedarikçiler listesinin "Kasadan işlenmemiş ödemeler" şeridinde ve zilde de durur.
- **Ödemeye bağlı satır:**
  - Personel düzeltemez, silemez ve onaya da gönderemez (kapanmış günde de); satırda kilit simgesi, dokununca "Bu satır
    yöneticinin kaydına bağlı; düzeltmek için yöneticiye haber verin." (tutar ve tedarikçi söylenmez). Sunucu da
    reddeder (`staffCashOutGate` › `rowLocked`). İstek açıldıktan sonra bağlanan satırın isteği onaylanmaz: yönetici
    reddeder, değişikliği Tedarikçiler'den yapar.
  - Yönetici tutarı ve günü düzeltince ödeme de değişir (ödemenin kalemlere sayılan toplamının altına inemez); satır
    alışverişe çevrilemez ("önce Tedarikçiler'de ödemeyi silin"). Kasa'dan silinmez: ödeme Tedarikçiler'den silinir,
    kasaya kendi açtığı satırsa o da silinir, var olan satıra bağlıysa satır durur ve işlenmemişe döner.
- **Personelin verisi:** Kasa sayfası personelin satırlarını beyaz listeyle kurar (`STAFF_CASH_OUT_FIELDS`,
  `src/lib/cash-outs.ts`); ödeme bağı, tedarikçi kimliği ve dağıtımlar personele gitmez, yalnız `locked`.
- Akşam raporunun metni ve WhatsApp satırı değişmez: "Teslim (Sütaş) 2.200 ₺".

## Kasadan çıkan: kapanmış gün, yöneticinin satırı

Kapanmış ya da eski bir güne yazılan kasadan çıkan beklenen nakdi düşürür ve açığı örtebilir; yöneticinin
kategorisindeki satır (maaş, avans) kârı değiştirir. Bunlar yöneticinin onayına gider ([ONAYLAR.md](ONAYLAR.md), tür
`kasa-cikan`); istek onaya kadar hiçbir yere yazmaz.

| Personel ne yapar | Nasıl |
|---|---|
| Açık günde (bugün, dün; ertesi günün raporu girilmemiş) kendi kategorisindeki satırı eklemek, düzeltmek, silmek | Doğrudan (değişmedi) |
| Kilitli düne eklemek, satırını düzeltmek ya da silinmesini istemek | **Onaya gönder** ("Ekleme iste", "Düzeltme iste", "Silinmesini iste"); satırın fotoğrafı gizli kalır |
| Dünden eski 6 güne (D−2 … D−7) eklemek | **Eski bir güne ekle**: önce gün çipi, sonra kamera ya da form; o günün satırları gösterilmez, yalnız ekleme |
| Açık günde yöneticinin kategorisindeki satırın tutarını, metnini ya da türünü değiştirmek, silmek | Onaya gönder; kategori değiştirme isteği açılmaz, fişli satırın türü salt okunur |
| Fotoğrafsız alışveriş satırına fiş eklemek (bugün ve dün, kilitli dün dahil) | **Fiş fotoğrafı ekle**, onaysız: tutar, tür ve kategori değişmez; işlem geçmişinde "Kasadan çıkan: fiş eklendi" |
| Kayıtlı raporun yanlış ModPOS Z ya da banka POS Z fotoğrafını kaldırtmak (açık günde) | Fotoğrafın yanındaki **Kaldırılmasını iste**; okuma farkı olan fotoğrafta, raporun tek ModPOS Z fotoğrafında ve yazarkasa rakamı yazılmış raporun tek banka POS Z fotoğrafında düğme yok |

- İstek penceresi bugün ile 7 gün öncesidir (`src/lib/cash-out-requests.ts` › `requestDayAllowed`); istek 14 gün sonra
  kendiliğinden kapanır ("Süresi doldu", personelin zilinde görünür). Fiş istek beklerken tutulur, başka bir isteğe ya
  da satıra bağlanamaz; onayda satıra bağlanır, retle 7 gün sonra silinir. Personel fişi bu 7 güne yükleyebilir.
- Kapanmış güne kasadan çıkan eklenmesini yöneticinin kategorisi seçilerek istemek olmaz: kategori personelin
  kategorilerinden biridir, yönetici onayda değiştirebilir.
- **Onaylar › Kasa** kartı: satır ve fişi, düzeltmede değişecekler ve bağlı gider; bağlam olarak günün kasa farkı, o
  günün bütün satırları ("satırlar onaydan sonra …"), olası tekrar (aynı tutar, ±1 gün), kırmızı işaretler (tutar
  günün açığına ±1 ₺ eşit; kapanmış güne teslim ya da fişsiz çıkış) ve gider ayı bu ay değilse uyarı. Eklemede ve
  düzeltmede "Aylık harcamalar'a da yaz" ve kategori (bütün etkin kategoriler). İstekten sonra satır, fişi ya da bağlı
  gider kaydı değiştiyse amber "İstekten sonra değişti" ve **Yine de uygula**. Fiş belgeli işaretlenen satırın fotoğrafı
  yoksa onay reddedilir. Onay satırı isteyenin adıyla yazar ve kasa raporunu **asla** değiştirmez: rapordaki fark kartta
  görünür, rapor normal yoldan düzeltilir.
- **Fotoğraf kaldırma kartı:** küçük resim, okuma farkları ve neden. Onayda okuma farkı işlem geçmişine yazılır
  ("Fotoğraf rapordan çıkarıldı · … · okuma: …"), fotoğrafın rapor bağı silinir ve fotoğraf 30 gün saklanır; okumanın
  kendisi kalır. Yönetici fotoğrafı doğrudan silerse bekleyen kaldırma isteği kapanır.
- İşlem geçmişi: "Kasadan çıkan isteği" (personel), "Kasadan çıkan … · Ayşe'nin isteği" (onay), "Kasa isteği
  reddedildi", "Fotoğraf kaldırma istendi", "Fotoğraf rapordan çıkarıldı", "Fotoğraf kaldırma reddedildi".
- Kod: kural `cashOutNeedsApproval` (saf), kapı `src/server/cash-outs/guard.ts` › `staffCashOutGate` (personelin
  doğrudan ekleme, düzeltme, silme, fiş ekleme ve istek yollarının hepsi buradan geçer; yöneticinin bir tedarikçi
  ödemesine bağladığı satır `rowLocked` ile burada personele kapanır), yazım yolu
  `src/server/cash-outs/write.ts`, istekler `src/server/cash-outs/requests.ts`, uçlar
  `src/server/actions/cash-out-requests.ts`.

## Kafe kapalıydı

Tek kavram: Satış tahmini'ndeki özel günlerin `kapali` satırı ([SATIS-TAHMINI.md](SATIS-TAHMINI.md) § 4). Satırı
yalnız yönetici yazar; satırın varlığı onaydır. Kapalı işaretli gün eksik rapor ve kontrol listesi uyarılarına girmez,
ay bilgisinde ve komisyonda eksik sayılmaz ("2 gün kapalı işaretli: 3, 4 Kasım"), geç rapor listesine girmez ve
personel o güne kasadan çıkan yazamaz ("Bu gün kafe kapalı işaretli; kayıt girilemez").

- **Personel, Kasa raporu › Dün (rapor yokken):** formun üstünde "Dün kafe kapalı mıydı?" ve **Kafe kapalıydı**.
  Pencere: "Yönetici onaylayınca … için eksik kasa raporu ve kontrol listesi uyarıları kalkar. Kafe açıktıysa bunun yerine
  raporu girin.", "Neden? (isteğe bağlı)" (60 karakter), **Yöneticiye gönder**. Düğme yalnız dün için, o günün geri
  çekilmemiş bildirimi yokken ve kişinin son 30 günde 3'ten az bildirimi varken görünür. Bildirim geri alındıysa ya da
  kapandıysa (yönetici işareti kaldırdı ya da değiştirdi, LafPOS'un gün sonu geldi) düğme yerine nedeni yazar:
  "Kapalı gün bildirimi geri alındı: Yönetici kapalı işaretini kaldırdı. Raporu girin." (denetim SB-X1; aynı gün
  yeniden bildirilemez). O gün panelde iz
  varsa (kasa raporu, LafPOS'un satışlı gün sonu, kasadan çıkan, zayi / ikram, açılan kontrol listesi, karaoke,
  personelin işlem geçmişi kaydı, Z no boşluğu) istek açılmaz: "O gün panelde kayıt var; kafe açık görünüyor. Raporu girin ya da yöneticiye söyleyin."
  Bekleyen durumda "Kapalıydı dediniz · onay bekliyor" ve **Geri çek** (kişi başına günde bir); form yerinde kalır.
- **Kanıt** (`src/server/closed-days.ts` › `closedDayEvidence`, canlı): iş günü penceresi [D 05:00, D+1 05:00).
  Karaoke `starts_at` ile, personelin işlem geçmişinde hesap, parola, iki adımlı, kurtarma, diğer cihazlar, oturum,
  bildirim ayarı, hatırlatıcı, özel gün ve kapalı gün işlemleri hariç her yazım (silme kayıtları dahil; kanıtı silmek işe
  yaramaz). Z no sürekliliği: önceki ve sonraki raporun Z no'ları arasındaki boşluk arada başka raporsuz gün yokken
  kırmızıdır. Açılış sürekliliği yalnız uyarıdır ("25 Eki açılışı 23 Eki devriyle tutmuyor: 600 ₺ az"). İkisi de şube
  başınadır: kapalı gün işletmenindir ama her şubenin kendi kasası ve Z sayacı var, önceki ve sonraki rapor aynı şubenin
  olur (Tuzla'nın Z'si Marina'nınkiyle, Marina'nın açılışı Tuzla'nın devriyle karşılaştırılmaz); bir şubede kırmızı
  boşluk kanıtı kırmızı yapar (denetim 21 Kasım #1). Sitenin o günkü
  kafe, elle girilen ve kasada ödenen sipariş sayıları yöneticinin kartında ayrı bir Suspense'te sorulur (tutar yok;
  mağaza kolisi yalnız bilgi; site okunamazsa onayı kapatmaz). **LafPOS'un gün sonu** (denetim E-36; yalnız LafPOS
  günlerinde, geçiş günü boşken ya da önceki günde hiç okunmaz): satışlıysa kırmızı "LafPOS'ta Z 14 · 63 fiş" (tutar
  yok), satışsızsa uyarı "LafPOS'ta Z 15 alınmış, satış yok".
- **Onaylar › Kasa › Kapalı gün** kartı: kanıt listesi (kırmızı varsa **Onayla** kapalı), üst üste günler "3 gün üst
  üste kapalı bildirimi", ipucu "Onaylamadan önce o günün ModPOS / banka POS'una bakın; satış varsa reddedin.", not
  "Not (bütün personele görünür; tutar yazmayın)". Onayda kanıt yeniden sayılır; satır onaylayan yöneticinin adıyla
  yazılır.
- **Yönetici, Kasa › raporsuz gün (`?gun=`):** **Kafe kapalıydı**, onaysız; pencerede o günün izleri uyarı olarak.
  Aynı günün bekleyen bildirimi onaylanmış olur. Raporu olan gün işaretlenmez.
- **Özel günler'de silmek ya da düzenlemek:** onaylanmış bildirimin kapalı satırı silinince bildirim "geri alındı" olur
  ("Yönetici kapalı işaretini kaldırdı"). Satır düzenlenip bildirimin gününü artık kapatmıyorsa (türü değişti, günü
  kaydı, başka şubeye geçti) da aynısı: "Yönetici kapalı işaretini değiştirdi" (denetim SB-04). O günü kapsayan başka
  bir kapalı satırı varsa bildirim ona geçer ve onaylı kalır; yalnız adı değişen satırda bildirim olduğu gibi kalır.
- **Rapor gelince:** günün ilk raporu girilince bekleyen bildirim kapanır ("Kasa raporu girildi"), günü kapsayan tek
  günlük kapalı satırı silinir ve onu onaylayan bildirim "geri alındı" olur (yöneticinin zilinde "Kapalı gün işareti
  kaldırıldı (kanıt geldi)"); çok günlük aralıkta yalnız zil. Ertesi günün raporu gelince, aynı şubenin önceki raporuyla
  arasında Z no boşluğu varsa işaret kalkar; açılış farkı varsa yalnız zil (öteki şubenin raporu işareti kaldırmaz,
  zile yazmaz). **LafPOS'un satışlı gün sonu** geldiğinde de aynısı (`onLafposDaySaved`, gün
  sonunun yazımıyla aynı işlemde, günün kapalı gün kilidi altında): bekleyen bildirim "LafPOS gün sonu geldi (Z 14 · 63
  fiş)" notuyla kapanır, tek günlük işaret kalkar. Yalnız LafPOS gününde; geçiş günü boşken (deneme günü) hiçbir kayıt
  değişmez. LafPOS'a geçişte Z numarası 1'den başlar: Z no boşluğu kuralı eksi boşlukta zaten susar.
- **Bugün:** personelin `kasa-dun` satırı bekleyende "Onayda", onaylandıysa yok, reddedildiyse "Yönetici bildirimi
  reddetti{: not}. Raporu bugün girin."; yöneticinin `kasa-dun` ve `liste-dun` satırları "Onaya bak". Zil: yöneticide
  "Kapalı gün onayı bekliyor" ve "Dünkü kasa raporu girilmedi · Personel: kapalıydık dedi (onay bekliyor)"; personelde
  "23 Eki Per: kapalı gün onaylandı / reddedildi / geri alındı"; reddedilen ya da geri alınan bildirimde gün personele
  kapandıysa ve raporu yoksa geç rapor penceresinde "Kafe açıktıysa raporu Z fotoğrafıyla geç rapor olarak girin;
  yönetici onaylar." (o güne götürür), pencere de geçtiyse "Raporu yönetici girecek; Z raporunu yöneticiye iletin."
  (`closedFollowUp`). Sabah e-postasında onaylı kapalı gün kontrol kutusuna
  girmez; bekleyen bildirim "Onay bekleyenler"de karar verilene kadar listelenir.
- **İşlem geçmişi:** "Kapalı gün bildirildi", "Kapalı gün bildirimi geri çekildi", "Kapalı gün onaylandı", "Kapalı gün
  reddedildi", "Kapalı gün işaretlendi" (yönetici), "Kapalı gün işareti kaldırıldı (kanıt geldi)".
- Kod: saf kurallar `src/lib/closed-days.ts`, kanıt ve kancalar `src/server/closed-days.ts`, istek ve karar
  `src/server/closed-day-requests.ts`, uçlar `src/server/actions/closed-days.ts`. Testler `tests/kapali-gun.test.ts`,
  `tests/kapali-gun-db.test.ts`, `tests/kapali-gun-duzenleme-db.test.ts`.

## laffogato.net satırı (bilgi)

Formun altında, site bağlıysa o günün online satışı tek satır olarak görünür:

> **laffogato.net · 21 Ekim Çarşamba:** Online (site + uygulama) 1.331,02 ₺ · Karaoke ön ödeme 410 ₺ — kasadan geçmez.

Uygulama ve web siparişleri (kafe + mağaza) ile ön ödemeli karaoke, KDV dahil, iadeler düşülmüş. Parası sanal POS'tan
alındığı için **kasadan geçmez**: kasa farkına, Z kontrolüne ve devre girmez; ModPOS'un "Online" ödemesi (Yemeksepeti,
Getir…) ayrıdır. Personel karaoke tutarını görmez. Rapor açılınca, gönderilince ve e-postası gönderilince siteden
sorulur (saklanmaz); site düşük ya da yavaşsa (8 saniye) satır görünmez, form ve gönderim hiç beklemez. Sitenin günü
gece yarısında biter (kasanınki 05:00'te). Satır kasanın şubesinindir (site 21 Kasım'dan beri şubeli): Tuzla'nın
kasası `&branch=tuzla`, Marina'nınki `&branch=marina` ile sorar; Marina'nın masa siparişi Tuzla'nın satırına yazılmaz.
Ayrıntı: [SITE-SATIS.md](SITE-SATIS.md).

**Marina (LafPOS) gün sonu:** geçiş gününden itibaren Marina'nın raporu LafPOS'un gün sonu gelince kendiliğinden yazılır
(gönderen "LafPOS (otomatik)"; Banka POS Z eksik kalır, sayım yoksa rapor yazılmaz) ve gün sonu e-postası gider;
personel yalnız eksikleri (Banka POS Z) ekler. Ayrıntı: [LAFPOS.md › Gün sonu otomasyonu](LAFPOS.md#gün-sonu-otomasyonu-22-kasım-2026).

## Düzeltmeler

Rapor yeniden gönderilince önceki hâli aynı işlemde saklanır (`cash_report_revisions`; rapor silinince onunla gider).

- **Değişiklikler** listesi personelin kayıtlı raporunda ve yöneticinin gün ayrıntısında görünür, en yeni önce: kim,
  ne zaman ("22 Ekim 10:05 · Mehmet") ve hangi alan neyden neye ("Sayılan nakit: 2.880 ₺ → 2.980 ₺"). Not ve "neye
  çıktı" metni yazılmaz, yalnız "Not değişti". En altta ilk gönderim.
- İş günü kapandıktan sonra (ertesi gün 05:00'ten sonra) kasadaki nakdi değiştiren bir alan (açılış, nakit satış, gün
  içinde giren, gün içinde çıkan, sayılan nakit, teslim edilen) ya da kasayı sayan değiştiyse düzeltme **Ertesi gün** rozetini alır; günden güne satırında
  **Ertesi gün düzeltildi** rozeti, yöneticinin zilinde "Kasa raporu ertesi gün değişti" (son 7 gün; kim ve ne
  değişti). Yalnız Z, kart, banka POS Z ya da not düzeltmesi uyarı vermez; ardından yapılan bir not düzeltmesi uyarıyı da kapatmaz.
  Yöneticinin kendi düzeltmesi kendi zilinde görünmez.
- Güncellenen raporun e-postasında ve WhatsApp metninde "Değişen: Sayılan nakit 2.880 ₺ → 2.980 ₺; Not değişti".
- Günden güne satırında "· 2 kez düzeltildi". İşlem geçmişine düzeltmede değişenler, silmede raporun değerleri (Z,
  sayılan, fark, sayan, fotoğraf sayısı) yazılır.
- Bu özellikten önce düzeltilmiş raporların geçmişi ilk yeni düzeltmeden başlar. Bu özellikten önce kaydedilen
  raporlarda sayan boştur: kasayı gönderen saymış sayılır (ilk düzeltmede "Sayan" değişmiş görünmez).

## Sonradan düzeltme ve silme isteği

Personel açabildiği raporlarda (bugün ve dün) üç tür değişikliği doğrudan kaydetmez, **onaya gönderir**: ertesi gün
yapılan kasa alanı ya da sayan değişikliği, kilitli güne (ertesi günün raporu girilmiş) yapılan her değişiklik ve
raporun silinmesi. Rapor onaya kadar değişmez; onaylanan düzeltme yöneticinin kendi düzeltmesi gibi yeni bir sürüm
olur (devir, açılış notu, teslim ve sayan denetimleri yeniden). Karar: dalga 10 ([planlar/personel-yetki.md](planlar/personel-yetki.md)
§2.3), kuyruk [ONAYLAR.md](ONAYLAR.md).

**Kapı kuralı** (`staffCashGate`, personelin kayıtlı rapordaki değişikliği):

| Durum | Metin, Z, kart, banka POS Z | Kasa alanı ya da sayan |
|---|---|---|
| Rapor yok (unutulan dünü girmek) | doğrudan | doğrudan |
| Aynı gece (iş günü kapanmadan, 05:00'ten önce) | doğrudan | doğrudan |
| Ertesi gün, kilitsiz | doğrudan | **onaya** |
| Kilitli gün (ertesi günün raporu girildi) | **onaya** | **onaya** |
| Personelin penceresi geçti (dünden eski) | kapalı | kapalı |

Örnek: 22 Ekim'in raporu 23 Ekim'in raporu girilince kilitlenir. Personelin penceresi 23 Ekim iş günü boyunca açıktır,
24 Ekim 05:00'te kapanır. 23 Ekim 10:00'da 22 Ekim'in "Teslim edilen"ini değiştirmek onaya gider, yalnız notu
değiştirmek doğrudan kaydedilir.

**Personel** (`/panel/kasa`):

- **Kilitli gün:** "Ertesi günün raporu girildi; bu raporu yönetici onayıyla düzeltirsiniz." ve **Düzeltme öner**.
  Aynı form "düzeltme önerisi" olarak açılır: bütün alanlar kayıtlı rapordan dolu, Sonuç kartı çalışır, fotoğraf yok,
  en altta zorunlu **Neden düzeltiyorsunuz?** (5–500 karakter), düğme **Onaya gönder**. Açılış devirle tutmuyor ve not
  boşsa neden nota da yazılır.
- **Kilitsiz dün:** normal **Düzenle**; kasa alanı ya da sayan değiştiyse sunucu kaydetmez, form yazılanları korur ve
  şerit çıkar: "Kasa alanlarını ertesi gün değiştirmek yöneticinin onayıyla olur; nedenini yazıp onaya gönderin."
  Aynı yol 05:00 dönüşünde ve bu arada ertesi günün raporu girildiğinde de çalışır.
- **Bekleyen öneri:** düğmelerin altında "Düzeltme öneriniz onay bekliyor · 23 Ekim 10:05", değişen satırlar
  ("Teslim edilen: 2.400 ₺ → 2.040 ₺") ve sonuç ("Kasa farkı: 120 ₺ eksik → Kasa tutuyor"); **Öneriyi düzenle**
  (aynı istek, sürümü artar) ve **Geri çek**. Başkasının isteği yalnız adıyla görünür ("Mehmet'in düzeltme önerisi onay
  bekliyor"); istek kişi başınadır, kimse kimseyi engellemez.
- **Silinmesini iste:** açılabilen her raporda; zorunlu neden. Kendi silme isteği bekleyen rapor düzenlenmez
  ("Silme isteğiniz bekliyor; önce geri çekin").
- **İsteklerim** (`#isteklerim`, sayfanın altında): son 7 günün kasa istekleri, durum ve yöneticinin notu; bekleyende
  **Geri çek**. Zilde (İsteklerim) "22 Ekim kasa düzeltmeniz onaylandı" / "… reddedildi"; gün hâlâ açıksa rapora,
  değilse İsteklerim'e götürür.

**Yönetici:**

- **Onaylar › Kasa**, istek başına kart (`#istek-<id>`), en eski gün önce. Düzeltmede "Değişecek" listesi raporun
  şimdiki hâlinden onaydan sonraki hâline (kasa alanları kalın ve uyarı renginde); rapor istekten sonra değiştiyse üç
  sütun (öneri anı / şimdi / onaydan sonra; önerinin yalnız değiştirdiği alanlar uygulanır, arada yapılan yönetici
  düzeltmesi ezilmez); kasa farkı ve devir satırları; sonraki raporun açılışı bu devirle tutacak mı; "Gün içinde
  çıkan" değişiyorsa fişlerin sayısı ve toplamı, fişlerden 1 ₺'den fazla aşan kısım kırmızı **Fişsiz çıkış**; ayı
  geçmiş raporda uyarı. Kasa alanı değişiyorsa **Onayla** onay penceresi açar. Öneri artık bir şey değiştirmiyorsa
  "Rapor zaten bu hâlde; isteği kapatın" ve **Kapat**. Silmede raporun özeti ve sonraki raporun açılışının bu devre
  dayandığı; **Onayla ve sil** onay penceresi açar.
- Onay yalnız ekranda görülen istek sürümüyle ve raporun görülen sürümüyle olur; kimse kendi isteğini onaylayamaz.
  Bir düzeltme onaylanınca aynı günün öteki bekleyen düzeltmeleri kapanır ("Rapor başka bir istekle düzeltildi");
  rapor silinince (onaylı ya da yöneticinin kendisi) aynı günün bekleyen istekleri kapanır ("Rapor silindi"),
  reddedilmez. Yöneticinin kendi düzeltmesi istekleri kapatmaz (bir kısmını düzeltmiş olabilir; kart farkı gösterir).
- Yöneticinin formunda bant: "Mehmet'in düzeltme önerisi bekliyor · Onaylar'da bakın".
- Onaylanan düzeltmenin e-postasında "Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı."; Değişiklikler'de
  "23 Ekim 10:05 · Ayşe · Mehmet'in önerisi"; ertesi gün zilinde "Mehmet önerdi · Ayşe onayladı".
- **Zil** (Onaylar): "22 Ekim kasa raporu: düzeltme önerisi" (Mehmet · Teslim edilen 2.400 ₺ → 2.040 ₺ · kasa farkı
  120 ₺ eksik → tutuyor) ve "22 Ekim kasa raporunun silinmesi istendi". "Kasa: X eksik" zili istek beklerken de
  susmaz.
- **İşlem geçmişi:** "Kasa düzeltmesi önerildi", "Kasa raporunun silinmesi istendi", "… geri çekildi"; "Kasa
  düzeltmesi onaylandı / reddedildi", "Kasa raporu silindi … · Mehmet istedi".
- **Kasa e-postasının alıcıları** arasına personel hesabının ya da pasif hesabın adresi yazılamaz: e-postada karaoke ön
  ödemesi var. Kural gönderim anında da uygulanır (`cashEmailRecipients`, ortak süzgeç `src/server/notify/recipients.ts`):
  ayarlar kaydedildikten sonra personele indirilen, pasif yapılan ya da personel hesabı açılan adres raporu ve deneme
  e-postasını almaz. Düşen adres yöneticinin zilinde ve Rapor alıcıları kartında yazar; hepsi düşerse e-posta "gitmedi"
  sayılır (kapalı değil) ve yönetici nedenini formda görür ("E-posta gitmedi: Alıcıların hepsi personel ya da pasif
  hesaba ait: …"). Personel giriş e-postasını bir alıcının adresine çeviremez, kendi adresi listedeyken de değiştiremez
  (eski adres hesapsız kalıp e-postayı yeniden alırdı); yönetici böyle bir hesabın adresini değiştirince ya da hesabı
  silince uyarı görür ([BILDIRIMLER.md](BILDIRIMLER.md) › Alıcılar ve hesaplar). Kartın notu nedeni kişiye göre yazar:
  personel adresinde karaoke ön ödemesi, pasif hesapta "pasif hesaba e-posta gitmez".
- **Personel e-postanın neden gitmediğini görmez** (denetim E-64): Resend anahtarı ya da alıcı listesi yöneticinin
  işidir. Gönderimde, "Yeniden dene"de ve kayıtlı raporun satırında personel "E-posta gitmedi; yöneticiye haber verin.
  Raporu WhatsApp ile gönderebilirsiniz." görür (`src/lib/staff-errors.ts`; personelin DTO'sunda da bu metin);
  yönetici ayrıntıyı.

Dosyalar: `src/lib/cash-requests.ts` (yük, birleştirme, metinler), `src/server/cash/report-store.ts` (yazım yolu,
kapı), `src/server/cash/requests.ts` (istek ve karar), `src/server/actions/cash-requests.ts` (uçlar),
`src/server/data/cash-requests.ts` (okuyucular), `src/app/panel/kasa/cash-requests.tsx`,
`src/app/panel/onaylar/kasa-cards.tsx`. Testler: `tests/kasa-duzeltme-istegi.test.ts`, `tests/kasa-istek-db.test.ts`
(`KASA_ISTEK_TEST_DATABASE_URL`).

## Geç rapor (onaylı)

Personel, dünden eski ve son 14 **takvim** gününe düşen, raporu hiç girilmemiş bir günü Z raporunun fotoğrafı ve Z
numarasıyla girer. Rapor ayrı tabloda (`staff_requests`, tür `kasa-gec`) **onay bekler** ve onaya kadar hiçbir hesaba
girmez: ay bilgisi, sabit gider gün sayısı, komisyon, nakit planı, devir zinciri, Bugün, Claude bağlantısı ve e-posta
değişmez. Karar: dalga 10 ([planlar/personel-yetki.md](planlar/personel-yetki.md) §2.6), kuyruk [ONAYLAR.md](ONAYLAR.md).

| Gün | Personel |
|---|---|
| Bugün ve dün | normal form (doğrudan) |
| 2–14 gün önce, raporu yok, ilk rapordan sonra, kapalı işaretli değil | **geç rapor** (onaylı) |
| Daha eski ya da raporu olan gün | yönetici girer ya da düzeltir |

**Personel** (`/panel/kasa`):

- **Girilmemiş günler** kartı: "Kafe açıktıysa Z raporunun fotoğrafıyla girin; yöneticinin onayıyla kayda geçer." Gün
  çipleri ("14 Eki Sal", "· onay bekliyor", "· reddedildi"); telefonda 4'ten fazla gün tek çipte ("5 gün") toplanır.
  Fotoğraf deposu yoksa çip yerine "Fotoğraf eklenemiyor; bu günleri yöneticiye yazın". LafPOS'un gün sonu gelen LafPOS
  gününde (G8) fotoğraf gerekmez: açıklama bunu söyler ("… LafPOS'un gün sonu gelen günlerde fotoğraf gerekmez, ötekilerde
  Z raporunun fotoğrafıyla …") ve o günlerin çipi fotoğraf deposu yokken de görünür ("Fotoğraf eklenemiyor; öteki
  günleri yöneticiye yazın.").
- **`/panel/kasa?gun=D`** geç rapor kipinde açılır: ModPOS Z no'su ve en az bir ModPOS Z fotoğrafı zorunlu (Banka POS Z
  raporu kartı da görünür; fotoğrafı ve rakamları isteğe bağlı). **LafPOS gününde** (geçiş gününden sonra; B09, G8)
  kanıt LafPOS'un gün sonudur: geldiyse form ondan dolar ve fotoğraf gerekmez; gelmediyse yazarkasa (Banka POS) Z
  raporunun fotoğrafı zorunlu ("LafPOS'un bu günün sonu gelmedi: …"). Kural istemcide ve sunucuda aynı
  (`kasaEvidence`, `src/server/data/lafpos-day.ts`); fotoğraf kaldırma isteği de ona bakar (LafPOS gününde ModPOS Z
  fotoğrafı kanıt değildir, gün sonu gelmediyse tek yazarkasa Z fotoğrafı kaldırılamaz). Yöneticinin kartı LafPOS'un
  Z'sini ("LafPOS gün sonu · Z 13 · 63 fiş · …") ve personelin ondan farklı yazdıklarını gösterir, **Düzeltip onayla**
  formu personelin yazdıklarıyla açılır ve LafPOS'la yalnız karşılaştırır (farklı olanlar turuncu, öneri olarak). Gün
  sonu gelmeyen LafPOS gününde not: "… yazarkasa (Banka POS) Z raporunun fotoğrafı zorunlu; LafPOS gün sonu bölümündeki
  Z no'yu LafPOS › Kasa › Geçmiş günler'den yazın." (zorunlu Z no LafPOS'unkidir); zorunlu **Neden geç
  giriliyor?** (3–300), kasayı sayan isteyendir (seçici yok; başka biri saydıysa nedene yazılır), teslim varsa
  **Teslim alan** (etkin kullanıcı ya da Banka). Kasadan çıkanlar kartı çizilmez ve "Gün içinde kasadan çıkan" elle
  yazılır (satırlar personele gitmez); e-posta, WhatsApp ve karaoke yok; zayi / ikram için Zayi sayfasının istek yolu.
  Açılış önerisi zincirin önceki **halkasından** gelir: önceki rapor ya da önceki bekleyen geç rapor
  (`src/server/cash/late-chain.ts`). Düğme **Onaya gönder**; "Onaya gönderildi · 120 ₺ eksik".
- Gönderdikten sonra kart: "Onay bekliyor", özet, "Neden: …", "2 fotoğraf eklendi" (LafPOS gün sonuyla gönderilen
  fotoğrafsız raporda "LafPOS gün sonuyla gönderildi; fotoğraf gerekmez"), **Düzenle** ("Güncelle ve
  gönder"; tutulan fotoğraflar yalnız önceki isteğin fotoğraflarından) ve **Geri çek**. Başkasının isteği beklerken
  "Mehmet bu günü 21 Ekim'de gönderdi; yöneticinin onayını bekliyor."; istek kişi başınadır. Reddedilen istekte
  "Reddedildi · Ali: …" ve önceki değerlerle dolu form (fotoğraflar yine kişinin kendi küçük resimleri). Aynı gün için
  iki ret ya da geri çekmeden sonra form yerine "Bu günü yöneticiye yazın". Kişi başına en çok 5 bekleyen geç rapor.
- **05:00 dönüşü:** dünün formu gönderilirken gün personelin penceresinden çıktıysa sunucu kaydetmez
  (`{ needsApproval, request: "kasa-gec" }`), form yazılanlarla geç rapora geçer.
- Zil (İsteklerim): "14 Ekim kasa raporu onaylandı" / "… reddedildi". Bugün'deki dünün satırı: "… raporu girilmedi.
  Kafe açıktıysa bugün girin; yarından itibaren yöneticinin onayıyla girilir."

**Yönetici:**

- **Onaylar › Kasa**, en eski gün önce, kart `#istek-<id>`: "14 Ekim Salı kasa raporu" ve **Geç rapor**, "Ayşe
  gönderdi · 21 Ekim 10:05 · 7 gün sonra", "Neden geç: …"; fotoğraflar ve okumaları (gün = D ile yeniden kurulur;
  okuma yoksa "Fotoğraf okunmadı: tarihi ve rakamları fotoğraftan kontrol edin"); **Z no sırası** önceki ve sonraki
  halkayla (`zNoOrder`; bekleyen halka "onay bekliyor"); yazarkasa Z'si yazıldıysa banka POS Z no'su ve kümülatif iki
  yanlı (`okcLateChain`; [Banka POS Z raporu](#banka-pos-z-raporu-yazarkasa)); döküm ve teslim alan; devir zinciri iki yönde; ay satırı
  ("Ekim'in açık gün ve POS cirosuna girer" / "… elle yazılmış; bu rapor değiştirmez" / "Kapanmış ay: …"); o güne
  kayıtlı kasadan çıkanlarla fark ("… (fişsiz)"); "Devir zincirinin tutması kanıt değildir: teslim ve çıkan bellekten
  yazılabilir."
- **Onayla ve kaydet** (teslim varsa "Bu teslimi aldım / bankada gördüm" işaretlenene kadar kapalı), **Düzeltip
  onayla** (form personelin değerleriyle açılır; personelin hâli 1. sürüm, sizinki 2. sürüm olur), **Reddet**. Aynı
  aralıkta (önceki rapordan bu yana) daha eski bir bekleyen gün varsa onay kapalı: "Önce 13 Ekim'i karara bağlayın".
  Gün artık raporluysa: "Bu günün raporu artık var; isteği reddedin".
- Onayda rapor personelin adıyla girilir (gönderen ve sayan isteyen; devir ve açılış notu denetimleri işlem içinde
  yeniden), fotoğraflar bağlanır (artık bağlanamayanlar atlanır ve söylenir), aynı günün öteki bekleyen geç raporları
  kapanır. E-posta **yalnız onayda** gider; başlıkta "Geç rapor · Ayşe 21 Ekim'de girdi, Mehmet onayladı" ("düzeltip
  onayladı"), anahtar `cash-{gün}-r{sürüm}-gec{istek}`.
- Kendiniz `?gun=D`'de girerseniz bant: "Ayşe bu günün raporunu 21 Ekim'de onaya gönderdi. Burada girerseniz onun
  isteği kapanır." Girince istek kapanır ("Yönetici günü kendisi girdi"), fotoğrafları 30 gün kalır.
- **Kasa › Günden güne:** bekleyen gün "Onay bekliyor · Ayşe girdi · İncele"; onaylanan geç rapor gri **Geç girildi**
  ve "Ayşe 21 Ekim'de girdi · Mehmet 22 Ekim'de onayladı" (eşleşme `result_id` ile, tarihle değil).
- Satışlar › ay bilgisi ve Genel bakış görevi: gün eksik sayılmaya devam eder, yanına "(onay bekliyor)" yazılır.
- Zil (Onaylar): "Geç kasa raporu onay bekliyor", "14 Ekim Salı · Ayşe · Z 12.400 ₺ · 120 ₺ eksik".
- İşlem geçmişi: "Geç kasa raporu onaya gönderildi", "… geri çekildi", "… onaylandı", "… düzeltilip onaylandı", "…
  reddedildi".

Fotoğraflar istek beklerken tutulur (silinmez, başka bir kayda bağlanamaz); saklama süreleri [FOTOGRAF.md](FOTOGRAF.md)
§ 4. Dosyalar: `src/lib/cash-report.ts` (`staffLateDay`, `zNoOrder`, `lateMissingDays`), `src/lib/cash-requests.ts`
(`LatePayload`, metinler), `src/server/cash/late.ts` (istek ve karar), `src/server/cash/late-chain.ts`,
`src/server/data/cash-late.ts` (okuyucular), `src/app/panel/kasa/late-report.tsx`, `src/app/panel/onaylar/kasa-cards.tsx`.
Testler: `tests/kasa-raporu.test.ts`, `tests/kasa-gec-rapor-db.test.ts` (`KASA_GEC_TEST_DATABASE_URL`),
`tests/foto-altyapi.test.ts` (`uploadRule`).

## Satış tahmini

Kasa raporlarının Z toplamı satış tahminini besler (son 6 haftanın hafta günleri; [SATIS-TAHMINI.md](SATIS-TAHMINI.md)):
0 girilen gün kapalı sayılır, raporu girilmeyen gün yok sayılır; her sabahki tahmin gerçekleşen Z toplamıyla
karşılaştırılır.

## Ay bilgisine aktarım

Satışlar › **Ay bilgileri** (açık gün, POS cirosu, indirim, ödenmez, kartlı satış oranı) boş bırakılırsa kasa
raporlarından gelir. Hiçbir şey kopyalanmaz: değerler her açılışta raporlardan hesaplanır, yeni, düzeltilen ya da
silinen rapor ayın rakamını hemen değiştirir.

| Alan | Kasa raporlarından |
|------|--------------------|
| Açık gün | Z toplamı 0'dan büyük raporu olan gün sayısı ("Tümü"de iki şube aynı gün açıksa bir gün) |
| POS cirosu | Z toplamlarının toplamı **eksi** Z toplamlarının içindeki ödenmez / ikram (aşağıda "Ciro ve ödenmez") |
| İndirim, ödenmez / ikram | Girildiği günlerin toplamı (hiç girilmediyse 0) |
| Kartlı satış oranı | (Kart + yemek kartı) ÷ Z toplamı. Satış raporunun ürün başına tahmini komisyonu bu oranla; boşsa Ayarlar'daki kart oranıyla. Gelir-gider'in **banka POS komisyonu** yalnız banka kartı payıyla: kart ÷ Z (yemek kartı hariç, onun komisyonu kendi faturasıyla; elle yazılan orandan kasanın yemek kartı payı düşülür; denetim E-43) |

- **Elle yazılan her zaman geçerlidir;** alan boşaltılınca kasaya döner. Satışlar'da her alanın yanında "Kasadan" ya
  da "Elle" yazar; kasadan gelen alana dokununca elle yazılır, elle yazılan alanın altında kasadaki değer ve
  **Kasadakini kullan**. Gelir-gider'de aylık ciro ve açık gün hücresi aynı kuralla ("Kasaya dön").
- Kasa raporları bir ayın ortasında başladıysa o ayın toplamları ayın yalnız bir kısmıdır: uygulanmaz, elle girilir
  ("Kasa raporları 20 Ekim'de başladı; …"). Kartlı oran yine kasadan. Kural kasanın, kafe zaten açıkken ay ortasında
  başlaması içindir (Tuzla, Ekim 2026). **Sonradan açılan şubenin açılış ayı** buna girmez: şube seçiliyken ilk rapor
  şubenin açılış gününde ya da öncesindeyse (Ayarlar › Şubeler; boşsa sonradan açılan şubenin ilk raporu açılış sayılır)
  ay tamdır, ciro ve açık gün kasadan gelir; ilk rapor açılış gününden sonraysa ay yine elle girilir
  (`src/lib/cash-month.ts` `tillOpenedOn`, `partialStart`; Gelir-gider, Satışlar, Kasa'nın ay satırı ve geç rapor kartı
  aynı kural). Tuzla bugünkü gibi (denetim 21 Kasım #21).
- **Şubeler ve "Tümü"** ([SUBE.md](SUBE.md) › "Tümü"nün ay bilgisi): her satır şubesini taşır. Aynı günün iki şubesi
  ayrı satırdır; açık gün ve raporlu gün günde bir kez sayılır, ciro, indirim ve ödenmez toplanır. Rapor > LafPOS >
  föy önceliği **aynı şubenin** gününde geçerlidir: Tuzla'nın raporu Marina'nın o günkü föyünü düşürmez. Elle
  yazılanlar şube şube çözülüp toplanır (her şube kendi açılış günüyle): Marina'nın elle yazdığı ciro Tuzla'nın kasa
  cirosunun yerine geçmez (denetim 13 Kasım HM-02). Birden çok kasa açıkken "Tümü"de Gelir-gider'in ciro ve açık gün
  hücresi yazılmaz; Satışlar'ın formu Tuzla'nın satırını adıyla gösterir.
- Raporu girilmemiş günler (süren ayda düne kadar) Satışlar'da sayılır: "3 gün rapor yok: 5, 12, 20 Kasım. O günler
  açıksanız ciro ve açık gün eksik kalır." **Kasa raporuna git**. Kapanmış ayda Genel bakış'ın "Bu ayın işleri"
  kartı uyarır.
- **LafPOS günü raporsuz kaldıysa** (yalnız geçiş gününden sonra; denetim B09, G6): o günün rakamları LafPOS'un gün
  sonundan (Z toplamı, kart, yemek kartı, indirim, ödenmez) aya girer, gün yine "rapor yok" sayılır: "1 gün rapor yok:
  3 Kasım. Ciro ve açık gün bu günlerde LafPOS'un gün sonundan sayıldı." Rapor girilince rapor kazanır. Tek yükleyici
  (`tillRows`, `src/server/data/cash-reports.ts`): Gelir-gider, Satışlar, sabit gider sürümü ve Kasa'nın ay satırı aynı
  rakamı görür. Geçiş günü boşken LafPOS günleri ay bilgisine girmez.
- **ModPOS kasa föyü yedeği** (isteğe bağlı, varsayılan kapalı; Ayarlar › ModPOS (kasa föyü) › Ay rakamına yedek):
  açıkken raporu ve LafPOS gün sonu olmayan günün kapanmış ModPOS föyü aynı kuralla aya girer (ciro, kart, yemek
  kartı, ödenmez; indirim föyde yok). Raporlar başlamadan önceki föy günleri "rapor yok" sayılmaz. Ayrıntı:
  [MODPOS-API.md](MODPOS-API.md) › Ay rakamına yedek.
- laffogato.net'in online satırı (kasadan geçmez) hiçbir rakama girmez.
- **Sabit giderin günü:** açık gün kasadan geldiğinde kira, maaş ve öteki aylık kalemler Gelir-gider'de açık gün
  sayısıyla değil, raporların kapsadığı takvim günüyle bölünür (biten ayda ayın tamamı, süren ayda dünün sonuna kadar):
  bayramda kapalı gün ya da raporu girilmemiş gün kirayı ve maaşı düşürmez (`prorationDays`, engine.ts). Günlük
  kalemler (personel yemeği) açık günle çarpılır. Açık gün elle yazıldıysa Excel'deki gibi açık gün ÷ ayın gün sayısı.
  Oran hiçbir zaman 1'i aşmaz (iki şube aynı gün açıkken de). Biten ay ayın sonuna kadar sayılır: ayın 1'inde 00:00 ile
  05:00 arasında son günün raporu daha beklenirken de kira ve maaş tam ay (denetim 13 Kasım HM-10). Genel bakış'ta "Bu ay düşülen sabit gider" kutusu "Ayın geçen günü (16 / 31 gün)" yazar.
- **Ay ortasında yüklenen satış listesi:** Satışlar'da liste yüklerken süren ayda "Liste hangi güne kadar?" sorulur
  (varsayılan dün; `integration_state › sales.coverage`). Kasa raporları o günden ileri gittiyse listeye dayanan
  hesaplar listenin günleriyle yapılır: liste ↔ POS karşılaştırması (Satışlar'ın ay bilgisi kutusu, Tutarlılık, uyarı)
  o günlerin Z toplamı ve indirimiyle, Genel bakış'ın günlük ortalaması listenin açık günüyle, reçeteye göre kârın
  sabit gideri ve online satışı o günlere düşen payla, "ayda …" adetleri listenin açık günüyle. Ay bitince ayın
  tamamının listesi yüklenir; biten aya yüklenen liste ayın tamamı sayılır (kayıt silinir), Ayı temizle de siler
  (yalnız ayda hiçbir şubenin listesi kalmadıysa: Ayı temizle gösterilen şubenin listesini siler; [SUBE.md](SUBE.md)). Listenin
  son günü şube şube de yazılır (`sales.coverage.sube`): şube seçiliyken bu hesaplar şubenin kendi listesinin son gününü
  okur, öteki şubenin aynı aya yüklemesi onu ezmez; ortak kayıt yalnız "Tümü" içindir ([LAFPOS.md](LAFPOS.md) › Günlük
  satış › Şubenin kendi kaydı).
  **LafPOS'a geçildiyse** (Ayarlar › LafPOS › geçiş günü) bu kural geçiş gününden önceki aylar içindir: geçiş ayında
  liste ay bittikten sonra da en çok geçiş gününden önceki güne kadar sayılır, sonraki aylara liste yüklenmez (satışlar
  her gün sonunda LafPOS'tan gelir). Ayrıntı: [LAFPOS.md › Günlük satış](LAFPOS.md#günlük-satış-aylık-model).
- Kasa sayfasının ay görünümünde tek satır: "Bu ayın açık gün ve cirosu kasa raporlarından → Satışlar". Genel
  bakış'ta POS cirosu "· kasa raporlarından"; Excel kopyasının Ay Bilgileri sayfasında "Kartlı satış oranı" ve "Kasa
  raporundan" sütunları.

## Ciro ve ödenmez

Panelin **cirosu ödenmez / ikramı içermez**: ModPOS'un Patron › Raporlar › Ciro rakamıyla aynı anlamdadır (KDV dahil,
indirimler düşülmüş, ödenmezler hariç). Oysa kasanın **Z toplamı** ödenmezi satış olarak içerir: sahibin ve personelin
tüketimi, ikram, hediye kartı, zayi de birer "ödeme türüdür", yalnız ciroya dahil değildir. Düzeltilmeden ayın cirosu
ModPOS'un rakamından ödenmez kadar fazla çıkıyordu (Ekim 2026: ModPOS 588 bin, panel 600 bin).

**Kural** (`src/lib/cash-revenue.ts` `dayRevenue`, testi `tests/odenmez-ciro.test.ts`): günün cirosu = Z toplamı −
Z toplamının içindeki ödenmez. Ödenmezin Z toplamının içinde olup olmadığını günün **ödeme dökümü** söyler (nakit +
kart + yemek kartı + online + diğer; ödenmez / ikram bunların hiçbirine girmez):

| Ödemelerin toplamı | Anlamı | Günün cirosu |
|---|---|---|
| Z toplamı − ödenmez | Z toplamı ödenmezi içeriyor | Z toplamı − ödenmez |
| Z toplamı | Z toplamı ödenmezi içermiyor (zaten hariç) | Z toplamı |
| İkisini de tutmuyor (1 ₺'tan büyük fark) | Gün kendi içinde tutmuyor | Z toplamı (değişmez) |

Son satırda tahmin yürütülmez: o gün zaten "Ödeme türleri toplamı … cirodan / Z toplamından … az" uyarısı verir ve
düzeltilmesi istenir. Kural üç kaynakta da aynıdır: elle girilen kasa raporu, LafPOS gün sonu ve ModPOS kasa föyü
(`tillRows`, `src/server/data/cash-reports.ts`; üçü de ödeme dökümünü taşır).

**Nerede görünür**

- **Kasa raporu** (gün ayrıntısı, e-posta ve WhatsApp): ödenmez Z toplamının içindeyse "Ciro (ödenmez / ikram hariç)"
  satırı çıkar; ödeme türlerinin payı ve toplamı ciroya göre ("ciroyla aynı"), yoksa bugünkü gibi Z toplamına göre.
- **Satışlar › Ay bilgileri:** cironun altında "Kasa raporlarından (27 gün). Ödenmez / ikram 12.000 ₺ Z toplamından
  düşüldü."
- **Kasa'nın ay satırı:** "Bu ayın açık gün ve cirosu kasa raporlarından (ödenmez / ikram 12.000 ₺ düşüldü)".
- **Genel bakış › POS cirosu** dökümü: "Z toplamları (ödenmez dahil)" ve "Ödenmez / ikram · − 12.000 ₺".

Ödenmez alanı olduğu gibi durur (Zayi & ikram tutarlılığı, ödenmezlerin tahmini malzeme maliyeti ve kasa karşılaştırması
onu okur); değişen yalnız ciroya girmemesidir. **Kartlı satış oranı** da ciroya göre hesaplanır: POS komisyonu tahmini
(ciro × oran × pay) yine kart tutarını verir.

## Gönderince

- **E-posta:** yöneticinin seçtiği adreslere gider. Hiç kaydedilmediyse Vercel'deki `CASH_REPORT_RECIPIENTS` (virgülle ayrılmış adresler; adresler kodda durmaz, yerel kurulum gerçek kişilere rapor göndermez); o da yoksa rapor e-postasız kaydedilir.
  Konu örneği: "Kasa raporu · 21 Ekim Salı · 120 ₺ eksik". İçinde kasa sonucu, ModPOS Z raporu, kasa, Banka POS Z
  raporu (yazarkasa; yazarkasa alanı olmayan eski raporda "Kart"), günün zayi ve ikramı ve (site o an yanıt verdiyse)
  "laffogato.net (kasadan geçmez)" bölümü yer alır. Başlıkta gönderen ve (başkaysa) sayan: "Mehmet · sayan Ayşe";
  güncellenen raporda "Değişen: …"; açılış ya da devir tutmuyorsa kasa bölümünde uyarı ([Açılış ve
  devir](#açılış-ve-devir)). Panelde kayıtlı ikramın menü fiyatıyla değeri ModPOS'un ödenmez tutarıyla karşılaştırılır.
  E-posta gitmezse rapor yine kaydedilir; ekranda "Yeniden dene" çıkar. Resend'e rapor satırına ve sürümüne özgü
  anahtarla gider (`cash-{rapor}-r{sürüm}`, `cashEmailKey`; denetim E-40): aynı sürüm iki kez gitmez, "Yeniden dene" aynı
  anahtarı kullanır. Silinip aynı gün (24 saat içinde) yeniden girilen raporun e-postası da gider: yeni rapor yeni
  satırdır, sürümü 1'den başlasa da anahtarı silinenden farklıdır (güne göre anahtar Resend'in 24 saatlik hafızasına
  takılırdı: e-posta gitmez, "Yeniden dene" düşerdi).
  Birden çok kasa açıkken konu, başlık ve metin raporun şubesini yazar; "Panelde aç" o şubenin gününü açar
  (`/panel/kasa?gun=G&sube=marina`, zilin bağlantısı gibi). Bağlantıda şube olmasaydı tarayıcıdaki seçim hangi şubeyi
  gösteriyorsa onun raporu açılırdı (21 Kasım denetimi #2). İşlem geçmişinin anahtarı şubenin günüdür (`cashLogKey`:
  Tuzla `cash:G:rN`, öteki `cash:G:rN:şube`): iki şubenin aynı günkü gönderimi birbirinin kaydını ezmez.
- **LafPOS günü** (geçiş gününden sonra; denetim E-09): e-postanın ve WhatsApp metninin başında rapor LafPOS'un gün
  sonundan farklıysa "⚠️ LafPOS'tan farklı yazılan: Sayılan nakit 9.350 ₺ (LafPOS'ta 9.000 ₺)"; Z bölümünün adı "LafPOS
  gün sonu (Z)". Teslim sayımdan sonra yazıldıysa (Teslim edilen) aynı para iki biçimde yazılmıştır: çıkan + teslim ve
  devir (sayılan − teslim) LafPOS'unkiyle karşılaştırılır, ayrı ayrı fark sayılmaz. Kayıtlı rapor ve günden güne
  görünüm aynı listeyi gösterir ("LafPOS'tan farklı" rozeti); yöneticinin zilinde "Kasa raporu LafPOS'tan farklı", LafPOS
  günü rapordan sonra farklı rakamla yeniden gönderdiyse "LafPOS rapordan sonra farklı rakamla geldi". Kart
  karşılaştırması LafPOS'un kartla bahşişini ve kartla cari tahsilatını düşer (Z'nin kartında yok, banka POS'unda var;
  personelin formunda ve WhatsApp'ında da, aynı sonuçla; tutar yalnız yöneticinin metninde, Kart bölümünde ve
  e-postada ayrı satır "− LafPOS kartla bahşiş + cari tahsilatı"). Geçiş günü boşken metin bugünkü gibi.
- **Banka POS Z bloğu: kim neyi görür.** Kart satırının kaynağı formdakiyle aynı (yazarkasa kartı, yoksa banka gün
  sonu).

| | WhatsApp (personel de gönderir; grup güvenli kanal değildir) | E-posta (alıcıları yönetici seçer) |
|---|---|---|
| Başlık | `*Banka POS Z raporu*` | "Banka POS Z raporu (yazarkasa) · Z no 0188 · 143 fiş" |
| Rakamlar | Z no, Nakit, Kredi kartı, Banka gün sonu (varsa) | Günlük toplam ve KDV, oran oran KDV dökümü, Nakit, Kredi kartı, Yemek kartı, Diğer, Banka gün sonu |
| Kart satırı | "✅ Kart ModPOS ile aynı" / "⚠️ Yazarkasa kartı ModPOS'tan 120 ₺ fazla" | aynı |
| Öteki satırlar | yok (günlük toplam, KDV, fiş sayısı, kendi içinde ve ModPOS'la toplam, nakit, yemek kartı, banka karşılaştırmaları girmez) | hepsi, renkli kutular (✅ / ℹ️ / ⚠️) |
| "Değişen" ve "Fotoğraftan farklı" | yazarkasanın Z no'su, nakdi, kartı ve banka gün sonu değeriyle; günlük toplam, KDV, döküm, fiş sayısı, yemek kartı ve diğer yalnız adıyla ("Yazarkasa toplam değişti", "Yazarkasa fiş sayısı") | değerleriyle |

  Yönetici "WhatsApp ile gönder"e bassa da metin personelinkidir (`whatsappText` → `cashReportText(…, "staff")`).
  WhatsApp'ta banka gün sonu satırı yalnız tutardır: banka ↔ yazarkasa kartı karşılaştırması yöneticinin satırıdır
  (planın §8 örneğindeki ✅ bilerek yazılmadı; sahip isterse açılır). Yazarkasa alanı olmayan eski raporda iki kanalda da bugünkü
  "*Kart*" bloğu, etiket "Banka POS".
- **Fotoğraflar** raporla saklanır (ModPOS Z 6 ay, banka POS Z 400 gün; [FOTOGRAF.md](FOTOGRAF.md) § 4). E-postada ve
  WhatsApp'ta fotoğraf ya da adresi yoktur: "📷 ModPOS Z ve banka POS Z fotoğrafı panelde" satırı (eski banka POS
  fotoğrafı "banka fişi"; e-postada "Fotoğraflar panelde: ModPOS Z, banka POS Z"), net okunmuş bir rakamdan farklı
  yazılan alan ("⚠️ Fotoğraftan farklı yazılan: Kart (fotoğrafta 8.915 ₺)") ve "Gün içinde çıkan"ın altında kasadan
  çıkan satırlar (en çok 6) yer alır. WhatsApp'ta bloğa girmeyen yazarkasa rakamı farklı yazıldıysa yalnız adı geçer
  ("Günlük toplam (banka POS Z)"); e-postada değeriyle ve Banka POS Z bölümünün altında.
- **WhatsApp:** "WhatsApp ile gönder" ayrıntılı metni hazır açar. Ayarlarda numara girildiyse o sohbet açılır,
  girilmediyse kişi ya da grup seçilir. "Metni kopyala" ile başka yere de yapıştırılır.
- **Deneme e-postası** (yönetici, Rapor alıcıları): son kayıtlı raporla gider; kayıtlı rapor yoksa yazarkasa alanları
  da dolu bir örnek raporla.
- **Zil:**
  - Personele: akşam 20:00'den sonra bugünün raporu girilmediyse hatırlatma.
  - Yöneticiye: dünün raporu girilmediyse, son raporda fark varsa, bugünün ya da dünün açılışı devirle tutmuyorsa
    ve son 7 günün bir raporu ertesi gün kasa alanı değiştirilerek düzeltildiyse bildirim (açılış uyarısı rapor
    yeniden gönderilince, düzeltme uyarısı yeni bir ertesi gün düzeltmesiyle yeniden okunmamış olur).
- **Bugün ekranı** (`/panel/bugun`): kasa satırı gündüz "Akşam" (sonra), 20:00'den sonra "Yapılacak" (zil ile aynı
  kural, `isCashEvening`); personelde gönderilince "Gönderildi", dünün raporu girilmediyse "Dünkü kasa raporu"
  (bugün de girilebilir). Yöneticiye dünkü ve bugünkü raporun farkı (eksik sorun, fazla yapılacak, tutuyorsa tamam);
  açılış devirle tutmuyorsa ya da rapor ertesi gün düzeltildiyse satır "Sorun var" olur ve açıklamaya yazılır.

## Yönetici

- **Günden güne:** ayın her günü bir satır, rapor girilmeyen günler dahil. Satırda Z toplamı, nakit / kart, kasa
  farkı rozeti, kart farkı ve "Z tutmuyor" işaretleri var. Fotoğraflı raporda fotoğraf simgesi; net okunmuş bir
  rakamdan farklı yazılan alan varsa **Fotoğraftan farklı** rozeti (turuncu bir alanın ya da başka güne ait fişin
  düzeltilmesi sayılmaz), yanında **Açılış ≠ devir** ve **Ertesi gün düzeltildi**. Satırda gönderen, başkaysa sayan
  ve "· 2 kez düzeltildi". Yazarkasa rozetleri: **Yazarkasa tutmuyor** (amber; kayıtlı yazarkasa rakamları kendi
  içinde tutmuyor) ve **Yazarkasa Z yok** (gri; Z toplamı olan ama yazarkasa Z'si girilmemiş gün, ilk yazarkasa Z'li
  rapordan sonra). ModPOS ile yazarkasa arasındaki toplam ve nakit farkı rozet almaz. Satıra dokununca ayrıntı açılır:
  fotoğraflar (büyütülür, yönetici siler; rapor kalır), fotoğraftan farklı yazılanlar, açılış ve devir uyarıları,
  "Banka POS Z (yazarkasa)" bölümü (Z no ve fiş sayısı, günlük toplam, KDV ve oran oran döküm, ödemeler, banka gün
  sonu, bütün karşılaştırma satırları, kümülatif ve **Kümülatifi temizle**; [Banka POS Z
  raporu](#banka-pos-z-raporu-yazarkasa)), kasadan çıkan satırlar, değişiklikler, WhatsApp, düzenle, e-postayı yeniden
  gönder, sil. Silinen raporun fotoğrafları 30 gün saklanır.
- **Ay özeti:** Z toplamı, net kasa farkı, eksik ve fazlaların toplamı, rapor girilen gün sayısı; altında ayın açık
  gün ve cirosunun nereden geldiği ve Satışlar'a bağlantı. Yazarkasa Z'si girilen ayda iki bilgi satırı: "Yazarkasa
  (mali) toplamı: 381.809 ₺ · 28 / 30 gün · ModPOS toplamından %11 az" ve "KDV: %10 34.710 ₺ · %20 0 ₺" (KDV dökümü
  eksik günler "Yazarkasa KDV dökümü eksik: 2 gün"). Yalnız bilgidir; ay bilgisine, KDV tahminine ve hiçbir hesaba
  girmez (`okcMonth`; KDV tahmininin yazarkasa tabanına geçişi ayrı bir iş, plan §9 "13b").
- **ModPOS kasa föyü** ([MODPOS-API.md](MODPOS-API.md) › Nerede görünür): ModPOS günlerinde gün görünümünde (`?gun=`),
  kasa raporu formunun altında üç bölüm: **ModPOS** (föyün ayrıntısı: ciro, adisyon ve ortalaması, kişi başı, ödeme
  dağılımı, nakit kasa, ödeme yöntemleri ve banka kırılımı, giderler, cari tahsilatlar, ara kasalar, ModPOS'un
  uyarıları), **ladmin** (panelde yazılan raporun ayrıntısı: Z, ödemeler, nakit kasa ve devir zinciri, kart ve
  yazarkasa, kasadan çıkanlar, künye) ve **Karşılaştırma** (alan alan tablo; Z alanları, açılış ve sayılan farklı
  yazılan, gider, giren, olması gereken, kasa farkı, ödemelerin toplamı ve banka POS bilgi olarak). Personelin yazdığı
  Z rakamı föyden farklıysa günden güne listede **ModPOS'tan farklı** rozeti, zilde "Kasa raporu ModPOS föyünden
  farklı". Föy her sabah 08:00'de gelir; personelin ekranı değişmez.
- **Rapor alıcıları:** e-posta adresleri (en çok 10), e-posta açık / kapalı, WhatsApp numarası ve "Deneme e-postası".
  E-posta için Vercel'de `RESEND_API_KEY` gerekir (`docs/BILDIRIMLER.md`). E-posta kapalıysa, gönderim kurulmamışsa
  ya da adreslerin hepsi personel / pasif hesabınsa formun Sonuç kartı "gönderince yöneticiye e-posta gider" yerine
  "e-posta kapalı; gönderdikten sonra WhatsApp ile paylaşın" der; yöneticinin "Nasıl çalışır?"u da öyle (denetim
  UI-05).

Dosyalar: `src/lib/cash-report.ts` (hesap, açılış ↔ devir, düzeltme geçmişi, WhatsApp metni; `tests/kasa-raporu.test.ts`),
`src/server/actions/cash-report.ts` (uçlar), `src/server/cash/report-store.ts` (yazım yolu ve silme; onay yolları da
buradan), `src/server/cash/report-email.ts` ve `src/server/notify/cash-report-template.ts` (e-posta), `src/app/panel/kasa/`; ay
bilgisine aktarım `src/lib/cash-month.ts` (`tests/kasa-ay-bilgisi.test.ts`); fotoğraftan okuma `src/lib/photo-read/`
(`tests/fotograf-okuma.test.ts`), kasadan çıkanlar `src/lib/cash-outs.ts` ve `src/server/actions/cash-outs.ts`; banka POS
Z raporu `src/lib/okc-z.ts` (kimlikler, karşılaştırmalar, ay), `src/lib/photo-read/okc.ts` (okuma),
`src/app/panel/kasa/okc-card.tsx` ve `okc-form.ts` (form). Testler: `tests/okc-z.test.ts`,
`tests/personel-sizinti-kasa.test.ts` (personelin yükünde kümülatif ve yöneticinin satırları yok),
`tests/kasa-okc-db.test.ts` (`KASA_OKC_TEST_DATABASE_URL`, yoksa `KASA_GEC_TEST_DATABASE_URL`: sunucu sütunları,
kümülatifin temizlenmesi, geç rapor onayı, fotoğraf kaldırma).

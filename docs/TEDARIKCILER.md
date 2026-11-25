# Tedarikçiler (bilgiler ve ödeme takibi)

Ekran: **Alış & gider › Tedarikçiler** (`/panel/tedarikciler`, yalnız yönetici). Her tedarikçinin bilgileri
(unvan, vergi no, IBAN, iletişim, vade), faturaları ve kalan borcu tek yerde durur. Bilgiler veritabanında
tedarikçinin **kartında** (`suppliers`, muhasebedeki "cari kart") saklanır; ekranda "kart" sözü geçmez. Faturalar Paraşüt'ten her sabah
kendiliğinden gelir ([PARASUT.md](PARASUT.md)); **ödendi / ödenmedi'yi siz işaretlersiniz.**

## Liste

- Faturası olan her tedarikçi listede görünür, bilgileri girilmemiş olsa da. Kart yalnız bilgi girilince açılır
  (**Tedarikçi ekle** ya da tedarikçi sayfasında **Düzenle**).
- Faturaları aynı vergi numarasını taşıyan adlar tek satırdır ("Kaldi" ve "KALDI KAHVE TİC. A.Ş."; aşağıda
  *Eşleşme*).
- Listeden kaldırılan tedarikçiler listenin altındaki **Listeden kaldırılanlar (N)**'de durur; oradan sayfası
  açılır ya da **Listeye geri al** ile geri gelir (aşağıda *Silme*).
- Özet kartları: **Kalan borç**, **Vadesi geçen**, **7 gün içinde** (vadesi gelecek), **Bu ay ödenen** (ödeme günü bu
  ayda). Karta dokununca tedarikçi tedarikçi döküm açılır.
  - **Kalan borç** tedarikçinin bakiyesidir: ödenmemiş faturaların kalanı + faturasız borçlar − hesapta duran (hiçbir
    kaleme sayılmamış) ödeme. Üstteki toplamda bir tedarikçinin fazla ödemesi öteki borçlardan düşülmez; alt satır
    "hesapta 99,50 ₺ sayılmamış ödeme (1 tedarikçi)" der.
  - **Bu ay ödenen:** ödeme günü bu ayda olan elle ödemeler (Hesap hareketleri; kısmi ödeme ve hesaba ödeme dahil) ve
    ödendi işaretli faturalar. Ödemelerin kapattığı fatura ikinci kez sayılmaz. Hiç ödeme kaydı yokken eskisi gibi
    yalnız ✓'lenen faturaların tamamı.
- Satırda: son fatura, ödenmemiş fatura sayısı, kalan borç, en yakın vade, IBAN (dokununca kopyalanır). Rozetler:
  *Peşin*, *IBAN yok* (borcu varsa), *N talep edildi*, *N Paraşüt'te ödendi*, *Faturasız borç*, *Hesapta 99,50 ₺*,
  *Kasadan işlenmedi*.
- **Kasadan işlenmemiş ödemeler** şeridi: personelin Kasa'ya Teslim · ödeme olarak girdiği ya da fişsiz alışveriş
  olarak yazdığı tedarikçi ödemeleri (son 60 gün, adı bir tedarikçiyle eşleşen). Pencerede her satırda **İşle**
  (Teslim; Ödeme ekle Kasadan ve o satırla açılır) ya da **Ödemeye çevir** (fişsiz alışveriş) ve **Ayrı tut** / **Ayrı
  alım**. Zil de söyler (`?kasa=1`).
- Arama (ad, diğer adlar, unvan, vergi no — kartta yazılı ve faturalarda geçen —, IBAN, telefon, yetkili, e-posta),
  süzgeç (**Borcu olanlar**, **Vadesi geçen**, **Bilgisi eksik**) ve sıralama (kalan borç, en yakın vade, son fatura,
  ad) adreste durur (`?ara=`, `?durum=`, `?sirala=`). Faturalardan tek bir vergi no biliniyorsa vergi no eksik
  sayılmaz.
- ⌘K araması tedarikçileri de bulur (unvan ve vergi no ile; faturalardaki vergi numaralarıyla da).

## Tedarikçi sayfası (`/panel/tedarikciler/<ad>`)

- Üstte **Ödeme ekle**, **Borç ekle** (aşağıda *Hesap hareketleri*), **Düzenle** (bilgiler, ad, diğer adlar) ve **Sil**
  (aşağıda *Silme*). Telefonda ilk ikisi başlığın altında iki sütundur.
- **Tedarikçi bilgileri:** IBAN (kopyala), **Ara** / **WhatsApp** / **E-posta**, unvan, vergi no ve dairesi, yetkili,
  adres, vade, ödeme şekli, faturalarda geçen diğer adlar, not. Eksik önemli bilgi (IBAN, vergi no, telefon /
  e-posta) altta yazar.
  - Kartta vergi no yoksa faturalardaki tek numara `7810030532 · faturalardan` diye görünür (kopyalanır). Kart
    kendiliğinden yazılmaz; Düzenle numarayı önerir, kaydeden siz olursunuz.
  - **Aynı vergi no:** yalnız vergi numarasıyla bu tedarikçide toplanan adlar (kartın adı ya da diğer adı olmayan).
  - Kartın numarası faturalardaki tek numaradan farklıysa uyarı: "Faturalardaki vergi no farklı: … Karttaki numarayı
    kontrol edin." Faturalarda iki ya da daha çok numara varsa hepsi fatura sayılarıyla yazılır; biri başka firmaysa
    o faturanın tedarikçi adı Faturalar'dan düzeltilir.
  - Kartsız tedarikçide başlık "Faturalardaki adı: Kaldi, KALDI KAHVE TİC. A.Ş. (aynı vergi no)", bilgi kartında
    "Vergi no faturalardan: …".
- **Aynı vergi no şeridi** (özet kartlarının üstünde): aynı numara başka bir tedarikçide de duruyorsa (adı başka bir
  kartın adı ya da diğer adı olan fatura, iki kartta yazılı aynı numara) her biri için bir satır ve **Sayfasına git**
  (en çok 3, fazlası sayıyla). Birleştirme düğmesi yok; satır ne yapılabileceğini söyler: kartsız adı Düzenle'den
  diğer adlara eklemek, faturası olmayan kartı silip adını ötekinin diğer adlarına eklemek. İki kartın ikisinin de
  faturası varsa yalnız bilgi verir (faturası olan kart silinince listeden kalkar ama adını tutar).
- Özet kartları: **Kalan borç** (bakiye; fazla ödemede **Alacak (fazla ödeme)**), **Vadesi geçen** (hesaptaki para
  düşüldükten sonra, faturasız borçlar dahil), **bu yılın alımları** (ay ay; faturasız alımlar dahil, eski borç
  hariç), **Son ödeme** (son 12 ödeme günü; elle ödemeler ve ödendi işaretleri).
- Kartların altındaki şeritler: hesapta sayılmamış ödeme (**Borçlara say**), faturası gelmiş olabilecek alım
  (**Bağla** · Ayrı alım), faturası 45 gündür gelmeyen alım (**Gider olarak yaz** · Beklemeye devam), kasadan
  işlenmemiş ödeme (**İşle** · Ayrı tut; fişsiz alışverişte **Ödemeye çevir** · Ayrı alım), başka tedarikçideki
  faturaya sayılı ödeme (**Ödemeden çıkar**), dağıtım toplamı tutmayan fatura (**Düzelt**).
- İki sekme: **Faturalar** ve **Hesap hareketleri** (`?sekme=hareketler`; aşağıda).
- **Faturalar:** Ödenmemiş / Tümü / Ödendi. Her faturada vade (yoksa tahmini vade), durum, belge (PDF) ve
  Faturalar'da açma. Durum hapına dokununca ödeme penceresi açılır; ✓ tek dokunuşla bugün ödendi yapar (kartın
  ödeme şekliyle).
- Birden çok fatura seçilince altta **Ödeme talebi** ve **Ödeme durumu** düğmeleri çıkar. Toplu işlemde ödendi ve
  talep edildi yalnız ödenmemiş faturalara yazılır; zaten ödenmiş faturanın ödeme günü değişmez.
- Her değişiklikten sonra bildirimdeki **Geri al** 10 saniye durur; ödendi işaretlenen fatura ayrıca 30 gün boyunca
  Ödemeler & hatırlatıcılar › Son ödenenler'den geri alınır ([BILDIRIMLER.md](BILDIRIMLER.md)).
- **Geçmiş faturaları al** (Paraşüt bağlıysa, Faturalar bölümünün başında): tedarikçinin Paraşüt'teki bütün gider
  faturaları tarih sınırı olmadan gelir (aşağıda *Geçmiş faturalar*).

## Geçmiş faturalar

Her sabahki eşitleme bu yılın başından (ya da `PARASUT_SYNC_FROM`'dan) bu yana gelen faturaları alır. **Geçmiş
faturaları al** bir tedarikçinin daha eskilerini de getirir (`syncSupplierHistory`, `src/server/parasut/sync.ts`):

- Tedarikçinin Paraşüt'teki kişisi bulunur: paneldeki Paraşüt faturalarından; yoksa bilgilerindeki vergi nosuyla;
  o da yoksa adıyla (aynı adlı tedarikçi kişileri, yoksa benzer adlı tek kişi; birden çok benzer varsa hiçbiri).
  Bulunamazsa vergi nosunu yazıp yeniden denemeniz söylenir (eşitleme kaydı açılmaz).
- Gider faturaları kişiye göre süzülerek (`filter[supplier_id]`), eskiden yeniye okunur ve eşitlemenin kuralıyla
  yazılır: paneldeki fatura çoğalmaz (içe aktarılmış kayıt da eşleşir), panelde silinen gelmez, Paraşüt'te iptal edilmiş
  olan (sabah eşitlemesindeki gibi) kaldırılır ve bildirimde söylenir, ödeme takibinden (`payments.since`) eski fatura
  Paraşüt'teki ödeme durumuyla gelir. Listede görünmeyen fatura kaldırılmaz; sabah eşitlemesinin imleci değişmez.
  Gelen e-fatura kutusu tedarikçiye göre süzülemediği için okunmaz.
- Çalışma Paraşüt sayfasının eşitleme geçmişinde "tedarikçi geçmişi" diye görünür; son eşitleme, zil, ana sayfa,
  sabah e-postası ve günlük işin yeniden denemesi bunu eşitleme saymaz.
- Paraşüt süzgeci uygulamazsa (liste başka tedarikçinin faturasını getirirse) hiçbir şey yazılmaz.
- Süre dolarsa (yaklaşık 30 sn okuma) okunanlar yazılır, kalınan sayfa saklanır (`parasut.supplierHistory`); düğmeye
  yeniden basınca oradan sürer.
- Paraşüt'te yeniden içeri alınan e-faturanın yeni gider faturası, eski faturası Paraşüt'e sorulamazsa (ağ, zaman
  aşımı) o basışta yazılmaz; paneldeki kayıt yerinde kalır, çift kayıt açılmaz. Kalınan yer o faturanın sayfasına
  geri alınır, bildirim "Okuma sürüyor" der ve yeniden basmanızı ister ("1 fatura yazılamadı (eski faturası
  Paraşüt'e sorulamadı); düğmeye yeniden basınca denenir."). O sayfadan yeniden denenip yine sorulamazsa fatura
  geçilir, okuma biter ("Okuma bitti" · "… sonraki tam okumada denenir."); sonraki tam okumada (ya da günlük
  eşitlemede) yeniden denenir. "Süre doldu" yalnız okuma süresi gerçekten dolunca yazar.
- Eşitlemenin bu faturalara verdiği ad (Paraşüt'teki kişi adı, ör. vergi nosuyla bulunan tam unvan) tedarikçinin
  adlarından değilse diğer adlara eklenir (başka bir tedarikçide kayıtlıysa eklenmez, söylenir). Kartsız tedarikçide
  ad eklenmez; o adla gelen faturalar aynı vergi noyla zaten buraya düştüyse bir şey söylenmez.
- Eski faturalar kendi aylarına gider olarak yazılır (aylık hesaplar o aylar için de dolar). Çalışma, Paraşüt
  sayfasındaki eşitleme geçmişinde ve işlem geçmişinde görünür.

## Silme

**Sil** (tedarikçi sayfasının üstünde ve Düzenle penceresinin altında):

- **Faturası yoksa** kartı silinir. Bildirimdeki **Geri al** geri getirir.
- **Faturası varsa** faturalar silinmez (gider ve aylık hesapların kaynağı): tedarikçi **listeden kaldırılır**,
  bilgileri saklanır (`suppliers.hidden_on`; kartı yoksa yalnız görünen adıyla bir kart açılır, vergi noyla
  birleşen öteki adlar faturalarıyla ona düşer). Listeye geri alınınca
  kartta adından başka bilgi yoksa kart silinir, tedarikçi eskisi gibi faturalarından görünür. Kaldırıldığı günden
  sonraki tarihli faturası gelirse listeye kendiliğinden döner (`isHiddenSupplier`).
- **Ödenmemiş faturası varsa** silinemez: borç listeden gizlenmesin. Pencere nedenini söyler; faturaları ödendi
  yapın ya da yanlış geldiyse Faturalar'dan silin (yalnız ödenmemiş iade kaldıysa "Önce iade kapanmalı").
  Geçmişten ödenmemiş bir fatura gelirse kaldırılmış tedarikçi de listeye döner.
- **Adı başka kartlarda da duran kartsız tedarikçi** listeden kaldırılamaz ("Listeden kaldırılamaz"; borçtan önce
  söylenir). Bu, iki kartı bağlayan numarada olur: aynı adın vergi nolu faturaları numaralarıyla iki ayrı kartta,
  vergi nosuzu kendi adında (*Eşleşme* 3–4). Kaldırmak bu adla bir kart açardı; ad önce geldiği için o kartlardaki
  faturalar da ona geçerdi (`nameMoves`). Pencere hangi kartlarda kaç fatura olduğunu söyler: buradaki faturanın
  tedarikçi adını Faturalar'dan doğru firmanın adıyla değiştirin.
- Listeden kaldırılanın sayfası açılabilir; üstteki şeritten **Listeye geri al**.
- Paraşüt'ün adı okunamayan faturaları ("Paraşüt tedarikçisi") silinmez; sonraki eşitlemede tedarikçilerine geçer.

## Ödeme durumu

| Durum | Ne demek | Nerede görünür |
|-------|----------|----------------|
| **Ödenmedi** | Borç duruyor | Kalan borç, Ödemeler & hatırlatıcılar, zil, sabah e-postası |
| **Talep edildi** | Ödemesi istendi (ödeme talebi gönderildi), henüz ödenmedi | Ödenmedi gibi sayılır; mavi *Talep edildi* rozeti (Faturalar'da da) |
| **Ödendi** | Ödendi; **ödeme günü** ve **şekli** (havale / EFT, nakit, kart, çek / senet, diğer) kaydedilir | Bu ay ödenen, Son ödeme |
| **Hesaptaki ödemeden sayıldı** | Elle girilen ödemeler faturayı tamamen karşıladı; ödendi olur (gün ve şekil son ödemeden). Kısmen karşılanan fatura ödenmedi kalır, kalanı azalır: "Kısmen ödendi · kalan 250,50 ₺" | Hesap hareketleri, ödeme penceresindeki "Bu faturaya sayılan ödemeler" |

- Ödeme günü bugünden ileri olamaz (en çok yarın). Bilinmiyorsa boş bırakılır. Ödendi işaretlenen faturanın ödeme
  talebi kapanır.
- Faturalar ekranındaki fatura penceresinde de **Ödeme günü** var (ödenmedi → ödendi yapılınca bugün gelir; boş
  bırakılırsa bilinmiyor). Elle eklenen yeni faturada boş kalırsa fatura günü yazılır. Faturalar'daki ✓ ve Ödemeler'deki
  **Ödendi** bugünü yazar.
- Paraşüt'te ödemesi kayıtlı olup panelde ödenmedi duran gider faturasında mor *Paraşüt'te ödendi* rozeti çıkar;
  tedarikçi sayfasında **Ödendi yap (N)** ile hepsi tek seferde ödendi olur (ödeme günü boş kalır). Durumu
  kendiliğinden değişmez.

### Paraşüt eşitlemesi ödeme durumuna dokunmaz

- Paraşüt'ten gelen her yeni fatura (gider faturası ve içeri alınmamış e-fatura) **ödenmedi** gelir; ödendiğini siz
  işaretlersiniz. İade (eksi) faturası borç sayılmaz (ödeme talebinde düşülebilir, aşağıda).
- **Komisyon faturası** (kategorisi kesin olarak Komisyon: kural, tedarikçinin geçmişi ya da platform listesi —
  Trendyol, Yemek Sepeti, yemek kartları) ödendi gelir (fatura günü): ödenmez, platformun hakedişinden düşülür; kalan
  borcu şişirmez. Kategori yalnız tahminse ödenmedi gelir. Hakedişin gelip gelmediği ve gerçek oran: Komisyon &
  hakediş ([KOMISYON.md](KOMISYON.md)).
- Eşitleme var olan faturanın ödeme durumunu değiştirmez (tek istisna: adı okunamadan "Paraşüt tedarikçisi" diye
  açılan fatura, adı okununca peşin çalışılan tedarikçinin kartına düşerse ödendi olur). Paraşüt'ün bildirdiği yalnız ipucu olarak saklanır
  (`invoices.parasut_unpaid`, ekranda *Paraşüt'te ödendi*). Paraşüt faturayı kapatınca panelde ödenmedi duran kısmen
  ödenmiş faturanın bilinen kalanı korunur (tamamına dönmez).
- **Peşin çalışılan tedarikçi:** kartında **Faturaları ödendi gelsin** işaretliyse yeni faturası ödendi gelir (fatura
  günü, kartın ödeme şekliyle). Peşin tedarikçide IBAN eksik sayılmaz.
- Bu özellikten önce gelmiş faturaların durumu olduğu gibi kalır.
- **Cari takipteki kart (üç istisna):** kart ilk elle ödeme kaydını alınca (Hesap hareketleri, aşağıda) eşitleme
  yalnız şunları yazar: peşin çalışılan kartın hesabında para varken gelen yeni faturaya önce o para sayılır (bir kez;
  yalnız takip günü ve sonrasının faturasına: "Geçmiş faturaları al" ile gelen takip öncesi fatura kapıda ödenmişti,
  hesaptaki parayı almaz, denetim E-14);
  tutarı değişen faturanın sayılan ödemeleri yeniden dengelenir (tutar düştüyse fazlası hesaba geçer, arttıysa
  ödemelerin kapattığı fatura ödenmemişe döner; takip öncesi kısma inen fatura kapanır); Paraşüt'te iptal edilen
  fatura silinmeden önce bağları çözülür (bağlı faturasız alım eski hâline döner, ödeme borca ya da hesaba geçer; bağlar
  çözülemezse fatura silinmez, sonraki eşitleme yeniden dener). Özet satırında "Cari: …" olarak görünür.
- **Geçmiş faturalar:** ödeme takibi ilk eşitlemeden 30 gün öncesinden başlar (`integration_state` ›
  `payments.since`). Bundan eski bir fatura yeni gelirse (Tarihten eşitle'yle geçmişi doldururken) yüzlerce eski fatura
  "ödenmedi" yığılmasın diye Paraşüt'teki durumuyla açılır: gider faturasında Paraşüt'ün ödeme kaydı, e-faturada
  (ödeme bilgisi yok) ödendi; belgedeki vadesi henüz gelmemiş e-fatura ödenmedi olur. `npm run db:reset` faturaları
  (ödeme işaretleriyle) yeniden yüklediği için başlangıcı da siler; sonraki eşitleme yeniden belirler.

## Hesap hareketleri: elle borç ve ödeme (cari)

Tedarikçinin hesabına faturadan başka kayıt girilir: **borç** (elden, veresiye ya da faturasız alım; panelden önceki
eski borç) ve **ödeme** (hesaba, kısmi, toptan, kasadan). Yalnız yönetici; kartsız tedarikçiye ilk kayıtta görünen
adıyla kart açılır.

**Borç ekle** (alım günü, KDV dahil tutar, ne alındı, vade, not, irsaliye / el fişi fotoğrafı). Gider dört seçenekten
biri:

| Seçenek | Gider |
|---|---|
| **Faturası gelecek** | Şimdi yok; fatura gelince fatura gider olur. Son 90 günde Paraşüt faturası olan tedarikçide varsayılan. Gelir-gider'de "Faturası beklenen alımlar (KDV dahil)" bilgi satırı çıkar (toplama girmez; fatura gelince satır KDV hariç tutarı kadar büyür). |
| **Faturası yok · gider yaz** | Aylık harcamalar'a tek bir kayıt (alım günü, KDV dahil tutarla, KDV ayrılmadan; varsayılan kategori "Nakit malzeme alımı"). Kayıt borcundur: Aylık harcamalar'da tutarı, günü, kategorisi kilitli, silinemez ("Cari · Sütaş"). |
| **Gideri zaten girildi** | Aylık harcamalar'daki var olan kayıt seçilir (±31 gün, Kasa'dan yazılmamış); tutarı ve günü borca eşitlenir, borcun olur. Eski günü ve tutarı saklanır (`adopt_prev`): borç silinince (eklemenin "Geri al"ı dahil) ya da kip veya kayıt değişince kayıt eski hâline döner (geçmiş aysa onayla). |
| **Eski borç (devir)** | Hiçbir zaman gider değil. O tarihten önce ödenmemiş fatura varsa uyarır. |

- Kopya uyarıları (engellemez): Aylık harcamalar'da ±3 gün ve ±1 ₺ içinde benzer kayıt, o ayın Gelir-gider › DİĞER
  hücresi dolu.
- **Kasa denetimi:** yeni borçta kasada alım gününün 3 gün öncesi ile sonrası arasında bu tedarikçinin adıyla (diğer
  adları da) işlenmemiş satır varsa kaydetmeden önce seçim istenir (tutara bakılmaz): alışveriş satırında **Kasadan
  peşin ödendi (borç açma)** (borç açılmaz, satır "Ayrı tut"a geçer), Teslim satırında **Borcu aç ve bu satırla kapat**
  (borç, satıra bağlı Kasadan ödeme ve tam dağıtım birlikte; önce satırın ödemesi sayılır, kalan varsa hesaptaki para;
  satır borçtan büyükse fark hesapta kalır), ya da **Ayrı alım** (borç açılır; alışveriş satırı ayrı tutulur, Teslim
  satırı tedarikçiye gerçek bir ödeme olduğu için işlenmemiş kalır ve Ödeme ekle › Kasadan'dan bağlanabilir; bu borç
  için ayrı sayılır: Ödemeler'de borcu, borç faturasına bağlanınca da faturasını "Kasadan ödenmiş olabilir" diye
  sessize almaz, sabah e-postası hatırlatır).
  Kime alanı ekle yazılsa da eşleşir ("Sütaş'a", "tedarikçiye (Sütaş)").
- **Hesaptaki ödemeyi say** (hesapta para varsa; yeni borçta açık gelir, düzeltmede kapalı) ve **Ödendi** (borç,
  ödemesi ve dağıtımı birlikte). Düzeltmede sayılan para "Geri al"la ödemeden çıkar.

**Ödeme ekle** (ödeme günü, tutar, nasıl ödendi, not, dekont fotoğrafı):

- Şekiller: **Kasadan**, **Elden (kasa dışı)**, **Havale / EFT**, **Kart**, **Çek / senet**, **Diğer**. Varsayılan:
  o gün kasada bu tedarikçinin işlenmemiş Teslim satırı varsa Kasadan (satır seçili), yoksa kartın ödeme şekli
  ("Nakit" → Elden), o da yoksa Havale / EFT.
- **Kasadan ödeme her zaman bir Kasa satırıdır:** o günün işlenmemiş Teslim satırı seçilir (tutar satırınki) ya da
  "Bu ayrı bir ödeme, kasaya yeni satır ekle" ile Teslim satırı açılır (Kime: tedarikçinin adı). Birden çok şube açıkken
  yeni satırın **hangi şubenin kasası** olduğu seçilir: varsayılanı soldan seçili şube; "Tümü"de (Tedarikçiler çoğu
  zaman orada açılır) varsayılan yoktur, seçilmeden kaydedilmez. Önceden satır sessizce Tuzla'nın kasasına iniyor, iki
  şubenin kasa farkı da ödeme kadar şaşıyordu (denetim 21 Kasım #31; [SUBE.md](SUBE.md) › Yazarken hangi şube).
  Listedeki var olan satırlar da kasasının şubesini yazar. Borç ekle › Ödendi › Kasadan da aynıdır. Teslim satırı gider
  yazmaz, akşam kasasının "Gün içinde çıkan"ına girer. Yeni satır personelin Kasa'sında da "Teslim · Sütaş" ve
  tutarıyla (kilitli) görünür: kasayı sayan personel çıkan parayı görür. Listede o günün alışveriş satırları da durur; seçilirse
  **Ödemeye çevir**: satırın gider kaydı silinir (onayla; geçmiş aysa ay onayı da), satır Teslim · ödeme olur.
- **Neye sayılsın:** **En eski borçtan** (vadesi en yakın kalemden; faturası gelmiş olabilecek fatura atlanır),
  **Seçerek** (kalem ve tutar) ya da **Hesapta beklesin** (avans, toptan). Canlı önizleme: "Kapanacak: SUT123
  8.450,50 ₺ · Kısmen: SUT140 1.549,50 / 1.800,00 ₺ · Hesapta kalacak: 0,00 ₺". Sayılmayan kısım hesapta kalır;
  okuyan her ekran (Ödemeler, plan, zil, e-posta) onu en eski vadeden mahsup eder, kalıcı dağıtım için **Borçlara
  say**.
- Fatura satırının menüsündeki **Kısmi ödeme** pencereyi o fatura seçili açar.

**Faturası geldi:** bir ya da birkaç faturasız alım tek faturaya bağlanır: borca sayılan ödemeler faturaya geçer,
borcun gider kaydı silinir, önceki hâli (kaydın kimliği, ödeme şekli ve yazanıyla) saklanır; bağ kaldırılınca geri
gelir. Komisyon ve kafe dışı (Karaoke box, Alp Koç) faturaya bağlanmaz: kafenin mal alışına girmezler, gider sessizce
düşerdi. Aynı kural sonradan da geçerli (denetim E-45): faturasız alımı bağlı faturanın kategorisi Faturalar'da (satır
içi, toplu, Geri al ya da fatura penceresi) kafe dışına ya da komisyona alınamaz, elle faturanın Ödenecek'i 0'a ya da
eksiye inemez; "faturasız alım bağlı ... önce bağı kaldırın" der, hiçbir şey yazılmaz (toplu seçimde hiçbiri). Kural
kilitli satırda okunur: aynı anda yapılan bağlama ile kategori değişikliğinden biri ötekini bekler. Önizleme gider ve KDV tahmininin saydığı KDV'yi (tevkifat ayrıca) söyler; kategorisi Gelir-gider'de hiçbir
kaleme bağlı olmayan faturada giderin düşeceğini uyarır. Alımın tutarına yakın fatura (tek alım ya da penceredeki
alımların toplamı, en çok max(1 ₺, %2) fark) gelince "Faturası gelmiş olabilir" şeridi çıkar; Ödemeler'de o fatura
sessizdir, e-postaya ve nakit planına girmez. Bir alımın tek faturası olur: aynı tutarda birkaç fatura varsa yalnız
gününe en yakını sessize alınır. Zayıf aday (tutar tutmuyor) yalnız ödenmemiş faturada ve güçlü adayı olmayan alımda
çıkar. **Faturası 45 gündür gelmedi** uyarısı ödeme durumuna bakmaz: teslimde ödenmiş alımın faturası gelmezse de
çıkar (tutarı alımın tutarı).

**Hesap hareketleri** (ekstre): faturalar, iadeler, Paraşüt'te ödenen kısım, faturada işaretli ödemeler (gri; menüsü
yok), faturasız alımlar, eski borçlar ve ödemeler (neye sayıldığıyla) gün sırasıyla, satır satır bakiyeyle. Süzgeç Son
3 ay / Bu yıl / Tümü ("Devreden bakiye"). Satır menüsü: borçta Düzenle, Sil, Faturası geldi, Bağı kaldır; ödemede
Düzenle, Sil, **Neye sayıldı** (dağıtımı değiştirir, "Ödemeden çıkar"). **Ekstreyi kopyala** WhatsApp'a uygun hesap
özeti verir (günü bilinmeyen ödeme "gün bilinmiyor" yazar; alımların iç notu tedarikçiye gitmez). Grubun faturasına
başka bir kartın ödemesinden sayılan para da ödeme satırı olarak görünür (metinde "Ödeme (havale) · PNR1"; öteki kartın
adı yalnız ekranda); son satır her zaman Kalan borçtur. Telefonda
liste görünümü.

**Geri al ve geçmiş ay:** her ekleme, düzeltme, dağıtım, bağlama ve çevirme bildirimdeki **Geri al** ile geri alınır;
yeni ödemeler 30 gün Son ödenenler'de durur (Ödemeye çevir'le açılan ödeme oradan geri alınınca Kasa satırı alışverişe,
gider kaydı yerine döner). Geçmiş bir ayın giderini değiştiren işlem (gider yazan borç, kip
değişimi, silme ve silinen kaydın geri alınması, bağlama, Ödemeye çevir ve geri alınması) o ayı adıyla sorar; onaysız
yazılmaz, işlem geçmişine "geçmiş ay değişti" düşer. Bildirimdeki Geri al işlemin kendi onayıyla geri alır (aynı kayıt
aynı aya döner; başka bir geçmiş ay değişecekse geri almaz); Son ödenenler ayı yeniden sorar.

**Kasa bağı** ([KASA-RAPORU.md](KASA-RAPORU.md)): ödemeye bağlı Kasa satırını personel düzeltemez ve silemez
("Bu satır yöneticinin kaydına bağlı…"; tutar söylenmez). Yönetici satırın tutarını ve gününü düzeltince ödeme de
değişir (sayılan toplamın altına inemez); satır alışverişe çevrilemez ve Kasa'dan silinmez, ödeme Tedarikçiler'den
silinir (kasaya açtığı satırsa o da silinir).

Çekirdek kurallar:

- Kayıtlar `supplier_entries`'te, karta bağlı (kart silinemez, yalnız listeden kalkar; açık borcu ya da hesapta parası
  olan kart kalkmaz). Ödemenin hangi faturaya ya da borca sayıldığı `supplier_allocations`'ta. Ödeme hiçbir zaman gider
  ya da KDV değildir.
- **Kalan borç** (`src/lib/cari/balance.ts`): kartın ilk ödemesiyle takip başlar; grubun her faturasına Paraşüt'ün o
  ana kadar ödendi gösterdiği kısım yazılır (`invoices.ledger_base`), sonradan gelen faturaya 0. Sonradan gelen fatura
  takip başlamadan önceki tarihliyse ("Geçmiş faturaları al", geç girilmiş eski fatura; takip kartın en eski ödeme
  kaydının günüyle başlar) ona da Paraşüt'te ödenen kısım yazılır, kalanı Paraşüt'ünkiyle başlar. Takipli faturanın
  kalanı = Ödenecek − bu taban − panelde sayılan (`invoices.allocated`); Paraşüt'ün kalanı yalnız ipucudur. Takipsiz
  fatura bugünkü kuralla (Paraşüt'ün kalanı). Hiç kayıt yokken bütün rakamlar eskisiyle aynıdır
  (`tests/cari-sabit.test.ts`).
- **Ödendi işareti:** sayılan ödemeler faturayı tamamen karşılarsa fatura ödendi olur (gün ve şekil son ödemeden,
  `invoices.paid_by_ledger`); karşılık düşerse yalnız böyle kapanan fatura yeniden açılır, elle konan ✓'ye dokunulmaz.
  Tamamen karşılanmış faturada "Ödenmedi" ve "Talep edildi" reddedilir: önce Hesap hareketleri'nde ödemeden çıkarılır.
- **Önce hesaptaki para:** ✓, toplu "Ödendi yap", Ödemeler'deki **Ödendi** ve fatura penceresi (yeni fatura
  Ödendi eklenirken de; tutar aynı kayıtta değişince yeni tutara göre) faturayı ödendiye geçirirken kartın hesabında
  duran (hiçbir kaleme sayılmamış) para önce o faturaya sayılır; kalanı bugünkü gibi işaretlenir, bildirim ne kadarının
  sayıldığını söyler. "Geri al" önce bu dağıtımları siler. "Ödendi" yazımı yalnız hâlâ ödenmemiş faturaya gider:
  aynı anda iki ✓ ya da değişiklik yapmadan Kaydet defterin kapanışını elle ödendiye çevirmez. Ödemeler'de faturasız
  alımın **Ödendi**si hesaptaki paradan yalnız satırın gösterdiği payı kullanır.
- Fatura silinmeden önce bağları çözülür (elle silme, Paraşüt iptali): bağlı faturasız alım eski hâline döner, gider
  kaydı yeniden yazılır, faturaya sayılan para ödemenin hesabına geçer. Silinen faturayı geri almak (elle girilmişte
  bildirimdeki "Geri al", Paraşüt faturasında Silinen Paraşüt faturaları da) bağlarını da geri getirir: bağlı alımlar
  (hâlâ bağsızsa) yeniden bağlanır, ödemeler hesapta hâlâ duran kadarıyla yeniden sayılır; ✓ ile kalanı ödenmiş fatura
  ödendi kalır, tedarikçi alacaklı görünmez (denetim FC-01). Sayılamayan para (bu arada başka kaleme sayılmış) ve
  defterin kapattığı faturanın açık kalanı bildirimde. Bu düzeltmeden önce silinmiş Paraşüt faturasının kopyasında
  dağıtımlar yok: ödeme sayılmış fatura ödenmemiş döner, **Borçlara say** ile kapatılır. Alım hangi kartın olursa
  olsun yeniden bağlanır (fatura başka tedarikçide görünebilir); bu arada değişen alım bağlanamazsa bildirim söyler.
- Ödemesi sayılmış ya da faturasız alımı bağlı faturayı başka karta taşıyan değişiklik reddedilir: kartın adı, diğer
  adları, vergi nosu (hangi kart düzenlenirse düzenlensin), yeni kart ve Faturalar'da faturanın tedarikçi adı.
- Kalan borç, dağıtım ve ödendi işaretini yalnız `src/server/cari/settle.ts` yazar (kart satırı kilitlenir: aynı
  kartın iki ödemesi sırayla çalışır). Saf kurallar `src/lib/cari/` (`account.ts` hesap ve mahsup, `statement.ts`
  ekstre, `match.ts` fatura adayı ve Kasa eşleşmesi, `months.ts` geçmiş ay onayı). `npm run db:reset` cari kaydı
  varken durur ([YEDEK.md](YEDEK.md)).

## Vade

Vadesi yazılmamış faturanın tahmini vadesi **fatura tarihi + vade günü**. Vade günü tedarikçinin kartındaki
**Vade (gün)**, boşsa Ödemeler & hatırlatıcılar › Gönderim ayarları'ndaki genel gün (varsayılan 30). Aynı kural
Tedarikçiler'de, Ödemeler & hatırlatıcılar'da, zilde, sabah e-postasında ve ertelemede geçer. Faturada vade yazılıysa
(Paraşüt'ten, e-faturadan ya da elle) o geçer.

## Ödeme talebi

Tedarikçi sayfasında **Ödeme talebi** (ya da seçili faturalarla): ödenmemiş faturalar seçilir, hazır metin oluşur:

```
Ödeme talebi · L'Affogato
Alıcı: SÜTAŞ SÜT ÜRÜNLERİ A.Ş.
IBAN: TR07 0006 2000 0629 8765 4321 01
Banka: Garanti BBVA
Vergi no: 7810030530
Tutar: 12.450,50 ₺
Açıklama: SUT2026000098, SUT2026000123 nolu faturalar

Faturalar (2):
• 25.08.2026 · SUT2026000098 · 4.000 ₺
• 19.09.2026 · SUT2026000123 · 8.450,50 ₺ · vade 19.10.2026

Cuma gününe kadar
```

- Metin ödemeyi yapacak kişiye (muhasebe, ortak) gider ya da bankanın havale ekranına kopyalanır: **Metni kopyala**,
  **WhatsApp** (paylaşım ekranı açılır, kişiyi siz seçersiniz) ya da **E-posta** (taslak açılır, alıcıyı siz
  yazarsınız). Alıcı hesap sahibi, yoksa unvan, yoksa faturadaki addır. İsteğe bağlı not metnin sonuna eklenir.
- Bankanın havale ekranı için IBAN, tutar (`12450,50`) ve açıklama ayrı ayrı kopyalanır.
- **Talep edildi işaretle (N)** seçilen faturaları *talep edildi* yapar (daha önce talep edilenlerin günü korunur).
  Ödeyince **Ödendi** işaretlenir; ödeme talebi kapanır.
- **İade faturaları:** tedarikçinin son 90 gündeki iade (eksi) faturaları pencerede ayrıca, uyarıyla listelenir.
  Paraşüt tedarikçiye iadeyi satış faturası olarak tuttuğu için eşitleme onu getirmez (Paraşüt sayfası listeler,
  [PARASUT.md](PARASUT.md) §2a); Faturalar'a elle girilen eksi fatura burada görünür.
  Hangisinin daha önce düşüldüğü bilinmediği için seçili gelmez; seçilen iade tutardan düşülür, metinde "Düşülen
  iadeler" altında yazar, havale açıklamasına girmez.
- IBAN girilmemişse metinde "IBAN: (girilmemiş)" yazar ve pencerede uyarı çıkar.
- "Vergi no:" satırı kartta yazılı numaradır; kartta yoksa (kartsız tedarikçide de) faturalardaki tek numara.

## Bilgiler (Düzenle penceresi)

- **Kimlik:** faturalardaki ad (zorunlu), ticari unvan, VKN / TCKN (10 ya da 11 hane olmalı; kontrol hanesi
  tutmazsa uyarı çıkar, yine kaydedilir), vergi dairesi.
- **Banka:** IBAN (TR + 24 hane, kontrol hanesi denetlenir; banka adı IBAN'dan bulunur ve boşsa yazılır), banka,
  hesap sahibi. Kayıtlı IBAN değiştirilirken teyit uyarısı çıkar (sahte "IBAN'ımız değişti" bildirimi yaygın bir
  dolandırıcılıktır; tedarikçiyi bildiğiniz numaradan arayın); değişiklik eski ve yeni IBAN'la işlem geçmişine yazılır.
- **İletişim:** yetkili, telefon (cep telefonuysa WhatsApp düğmesi çıkar), e-posta, adres.
- **Ödeme:** vade (gün, 0–365), genelde nasıl ödenir (ödendi penceresinde önce bu seçili gelir), *Faturaları ödendi
  gelsin* (peşin).
- **Faturalarda geçen diğer adlar:** aynı tedarikçinin faturalarda farklı yazılan adları ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş.");
  onların faturaları da bu karta toplanır. Benzer adlı kartsız tedarikçiler öneri olarak çıkar. Aynı vergi noyla
  gelen faturalar ad farklı olsa da kendiliğinden gelir.
- **Vergi no önizlemesi** (alanın altında, geçerli numara yazılınca): bu numarayla başka tedarikçide duran
  faturaların hangilerinin bu tedarikçide toplanacağı ("Bu vergi noyla gelen 9 fatura da bu tedarikçide toplanır:
  …"), hangilerinin adı başka bir kartın adı olduğu için orada kalacağı ("ad önce gelir") ve numara başka bir kartta
  da yazılıysa uyarı (o zaman numara eşleşmede kullanılmaz). Kontrol hanesi tutmayan ya da örnek numarada
  (1234567890 gibi) "faturalar bu numarayla eşleşmez" yazar. Kaydedince numara başka bir kartta da yazılıysa
  bildirim söyler; kayıt durmaz (aynı kişinin iki dükkânı olabilir).
- **Ad önizlemesi** (turuncu, numara yazılmasa da): kartın adı ya da bir diğer adı, vergi nosuyla başka bir kartta
  duran faturaların adıysa kaydedince onların buraya geçeceği yazılır ("“Su Ltd” adıyla gelen 2 fatura “Erbak”,
  “Pruva” tedarikçilerinden bu tedarikçiye geçer (ad önce gelir)."). Adınki vergi no önizlemesiyle aynı yerde,
  diğer adınki diğer adların altında çıkar. Kayıt durmaz (`nameMoves`).
- Kartta vergi no yoksa ve faturalardan tek numara biliniyorsa alan o numarayla açılır, "Faturadan dolduruldu"
  işaretlenir (numara başka bir kartta yazılıysa önerilmez: iki kartta aynı numara eşleşmeyi kapatırdı).
- **Faturadan doldur:** tedarikçinin en yeni Paraşüt faturalarından (en çok 3) unvan, vergi no ve dairesi, adres,
  telefon, e-posta ve IBAN okunur: e-faturada imzalı UBL belgesinin satıcı bölümünden (`AccountingSupplierParty`,
  `PayeeFinancialAccount`, notlardaki IBAN), gider faturasında Paraşüt'teki kişi kartından (`contacts`). Yalnız boş
  alanlar doldurulur, dolanlar işaretlenir; kaydetmeden önce kontrol edin.
- Kartın adı değişince eski ad, faturaları varsa diğer adlara eklenir (faturalar karttan düşmez); sayfa yeni adrese
  geçer. Kartsız tedarikçinin sayfasında açılan kart başka adla kaydedilirse faturalardaki ad da diğer adlara girer.
  Silme için yukarıda *Silme*.
- `npm run db:reset` kartları silmez; faturaların ödendi / talep edildi işaretleri faturalarla birlikte silinir.

## Eşleşme

Faturalar karta yabancı anahtarla bağlanmaz; tedarikçi adıyla ve Paraşüt'ten gelen faturada tedarikçinin vergi
numarasıyla (VKN / TCKN, `invoices.supplier_tax_number`; nereden geldiği [PARASUT.md](PARASUT.md#3a-tedarikçinin-vergi-nosu))
eşleşir. Ad karşılaştırmasında büyük / küçük harf, Türkçe ı/i, fazla boşluk ve sondaki parantezli not ("Sütaş
(iade)") sayılmaz (`supplierMatchKey`). Sıra (`supplierResolver`, `logic.ts`):

1. **Ad önce:** faturadaki ad bir kartın adı ya da diğer adıysa fatura o kartta. Önce kartların kendi adları, sonra
   diğer adları bakılır; iki kart aynı adı (ya da diğer adı) taşıyamaz. Elle yazılan ad her zaman kazanır: iki
   firmayı ayırmanın yolu budur.
2. **Kartın vergi nosu:** faturanın numarası tek bir kartta yazılıysa o kart. İki kartta aynı numara yazılıysa
   kartlardaki numara eşleşmede kullanılmaz (iki sayfada da şerit çıkar).
3. **Öteki faturalar üzerinden:** aynı faturada geçen ad ve numara birbirine bağlanır. Bağlı kümede tek kart varsa
   fatura o kartta (ör. numarası yazılmamış "Kaldi" kartının bir faturası X'i taşıyorsa "KALDI KAHVE TİC. A.Ş." + X
   de Kaldi'de); kart yoksa kümedeki adlar tek kartsız tedarikçi. Kümede iki kart varsa (çakışma) adın vergi nolu
   faturaları 2. adımda tek bir karta gittiyse vergi nosuz faturası da onları izler.
4. Yoksa (bugünkü kural) adın kendi kartsız grubu.

- Vergi nosuz içe aktarılmış bir satır, aynı adla vergi nolu faturası olan grubun içindedir (ad köprüsü): içe aktarılmış
  "Kaldi" ile Paraşüt'ten gelen "Kaldi" ayrılmaz.
- Kontrol hanesi tutmayan ve örnek numaralar (1234567890, 1111111111 …) saklanır, faturada görünür ama hiçbir şeyi
  birleştirmez. Paraşüt'ün geçici adı ("Paraşüt tedarikçisi") numarası bilinen tedarikçisine gider, hiçbir şeyi
  köprülemez.
- Aynı adla iki numara gelirse (ör. kısa adla eşlenmiş başka şirket) ad bölünmez; sayfada iki numara da yazılır.
- Vergi nosu olmayan veride gruplar ve adresler eskisiyle birebir aynıdır.
- Aynı kural her yerde geçer: liste ve tedarikçi sayfası, ⌘K, Faturalar penceresindeki "Tedarikçinin sayfası"
  bağlantısı, Ödemeler / zil / sabah e-postası / ertelemedeki tahmini vade (kartın vade günü) ve eşitlemedeki peşin
  kuralı. Faturalar'daki toplamlar, dökümler, "N tedarikçi" sayısı ve Gelir-gider'in mal alışı satırları adla kalır.
- Sayfa adresi grubun anahtarından üretilir (`sutas`, `cagdas-kahve`); çakışırsa sonuna sayı eklenir. Kartsız
  grubun anahtarı adlarının en küçüğüdür (tarihe bakılmaz, her ekran aynı adresi bulur); daha küçük anahtarlı bir ad
  katılınca adres değişir, eski adres yenisine yönlenir.

## Dosyalar

- `src/app/panel/tedarikciler/logic.ts` (eşleşme, vade, özet, süzgeç, IBAN / VKN / TCKN, telefon, ödeme talebi metni)
- `src/app/panel/tedarikciler/breakdowns.ts` (özet kartı dökümleri)
- `src/app/panel/tedarikciler/` (liste, `[cari]/` tedarikçi sayfası, kart, ödeme ve ödeme talebi pencereleri)
- `src/server/actions/suppliers.ts` (kart kaydet / sil / geri al, Faturadan doldur)
- `src/server/actions/invoices.ts` (`setInvoicePayment`, `restoreInvoicePayment`)
- `src/server/data/suppliers.ts` (ekranın verisi, kartın vade günü, peşin çalışılan tedarikçiler)
- `src/server/parasut/mapping.ts` (`newInvoicePayment`, `contactInfo`), `ubl.ts` (`partyInfo`)
- `src/server/parasut/tax-backfill.ts`, `tax-backfill-pass.ts` (eski faturaların vergi nosunun tamamlanması)
- `src/lib/cari/` (cari hesabın saf kuralları), `src/server/cari/settle.ts` (dağıtım ve ödendi işaretini yazan tek yer),
  `src/server/cari/entries.ts` (borç ve ödeme kaydı), `src/server/cari/kasa.ts` (Kasa denetimi, Ödemeye çevir, bağlı
  satır), `src/server/data/cari.ts` (cari okumaları), `src/server/actions/cari.ts` (eylemler; hepsi yönetici)
- Tablo `suppliers`, faturada `paid_at`, `paid_via`, `payment_requested_at` (`drizzle/0016_tedarikciler.sql`),
  `supplier_tax_number` (`drizzle/0021_fatura_vergi_no.sql`); `supplier_entries`, `supplier_allocations`, faturada
  `allocated`, `ledger_base`, `paid_by_ledger`, harcamada `supplier_entry_id` (`drizzle/0038_cari_hareket.sql`)
- Test: `tests/tedarikciler.test.ts`, `tests/parasut-vergi.test.ts`, `tests/cari-*.test.ts`

# Gün sonu kasa raporu

Ekran: **Kasa raporu** (`/panel/kasa`). Personel her akşam kapanışta ModPOS'tan Z raporunu alır, kasadaki nakdi sayar
ve buraya girer. Telefonda iki rolün de alt menüsünde **Kasa**; günün kasa işi **Bugün** ekranında da satır olarak
görünür ([BUGUN.md](BUGUN.md)).

## Personel ne girer

| Bölüm | Alanlar |
|-------|---------|
| Z raporu (ModPOS) | Toplam satış, nakit, kredi / banka kartı; varsa yemek kartı, online, diğer; ödenmez / ikram (ciro dışı); indirim, Z no ve fiş sayısı (isteğe bağlı). Ya da Z raporunun fotoğrafını çekin: rakamlar dolar |
| Kasa (nakit) | Açılış (önceki raporun ertesi güne devrinden kendiliğinden dolar), akşam sayılan nakit, gün içinde kasadan çıkan (harcama, teslim; gün içinde girilen satırlardan dolar) ve neye çıktığı, sayımdan sonra teslim edilen, **kasayı sayan** (gönderen değilse listeden seçilir) |
| Kart | Banka POS cihazının gün sonu toplamı (isteğe bağlı; fişin fotoğrafından da dolar) |
| Not | Fark varsa nedeni (bozuk para, iade, yanlış fiş…) |

Yazarken hesaplananlar:

- **Olması gereken nakit** = açılış + nakit satış − gün içinde çıkan
- **Kasa farkı** = sayılan − olması gereken. 1 ₺'nin altı "tutuyor", eksi **eksik** (kırmızı), artı **fazla** (turuncu).
- **Ertesi güne devir** = sayılan − teslim edilen. Ertesi günün açılışı buradan dolar.
- **Kart farkı** = banka POS − ModPOS kart.
- **Z kontrolü**: ödeme türlerinin toplamı Z toplamından farklıysa uyarı çıkar (yanlış yazılmış tutar).

Gece 05:00'e kadar kapanan gün bir önceki güne yazılır. Personel bugünün ve dünün raporunu girer ya da düzeltir;
ertesi günün raporu girildikten sonra bir raporu (ve o günün kasadan çıkanlarını, fotoğraflarını) yalnız yönetici
düzeltir, çünkü ertesi günün açılışı onun devrine dayanır: "Ertesi günün raporu girildi; düzeltme için yöneticiye
yazın." Unutulan dünü sonradan girmek serbesttir. Daha eski bir günü yalnız yönetici açar. Rapor yeniden gönderilince
"güncellendi" diye işaretlenir ve önceki hâli saklanır ([Düzeltmeler](#düzeltmeler)). Arada başkası göndermişse
üzerine yazılmaz: sayfa yenilenip onun girdikleri görülür.

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

Z raporu ve Kart bölümlerinde **Fotoğraf çek** (telefonda arka kamera) ya da **Galeriden seç**. Fotoğraf telefonda
küçültülür, yüklenir ve Claude ile okunur (genelde 5–10 saniye); okunanlar forma dolar. **Hiçbir şey kendiliğinden
kaydedilmez:** personel bakıp **Raporu gönder**'e basar.

- Dolan alanın yanında mavi **Fotoğraftan** yazar. Net okunamayan ya da bir denetime takılan alan turuncudur, altında
  nedeni yazar; fişle karşılaştırın.
- Fotoğrafta tahmin edilen (net olmayan) rakam forma yazılmaz: altında "Fotoğrafta net okunamadı (…); fişten yazın."
  ve **Fotoğraftakini yaz** çıkar. Okunamayan alan da turuncu kalır: "Fotoğrafta okunamadı; fişten yazın."
- Önceden elle yazılmış alan değişmez; fotoğraftaki farklıysa altında "Fotoğrafta …" ve **Fotoğraftakini yaz** çıkar.
- Denetimler: fişin tarihi raporun günü değilse, Z no önceki rapordakinden büyük değilse ya da arada atlama varsa,
  ödeme türleri toplamı Z toplamını tutmuyorsa, tanınmayan bir ödeme satırı, ikram ve iade satırları, soluk ya da
  kesik fotoğraf.
- Z bölümüne POS fişi çekilirse hiçbir alan dolmaz: "Bu bir banka POS gün sonu fişi gibi görünüyor" ve
  **Kart bölümüne okut**. Tersi için **Z bölümüne okut**.
- İki POS cihazı varsa ikinci fişte **Toplama ekle** ya da **Yerine yaz** sorulur. İkinci fişin rakamı net değilse
  soruda söylenir; seçilen tutar turuncu kalır, fişle karşılaştırın.
- Uzun bir Z raporu tek fotoğrafta okunmuyorsa üst ve alt yarısını ayrı çekin: ikinci fotoğraf yalnız boş alanları
  doldurur.
- **Kaldır** fotoğrafı formdan çıkarır (ondan dolan ve değiştirilmemiş alanlar boşalır). Gönderilmeyen fotoğraf 2
  günde silinir.
- Okuma kapalıysa ya da bu ortamda kurulu değilse fotoğraf yine kanıt olarak eklenir, rakamlar elle yazılır.

Ayrıntı (depo, kim görür, saklama, maliyet, KVKK): [FOTOGRAF.md](FOTOGRAF.md).

## Gün içinde kasadan çıkanlar

Formun üstündeki kart: gün içinde kasadan çıkan her para bir satır (market, buz, tamirci, gün ortası teslim).

- **Fiş ekle** fişin fotoğrafını çeker; tutar, yer, ne alındığı, fiş tarihi, KDV ve kategori okunup pencereye dolar
  (**Fişten** yazar), personel bakıp **Kaydet**'e basar. **Fişsiz ekle**: Alışveriş / ödeme ya da Teslim (kime).
- Personelin alışveriş satırı (fiş ya da fişsiz) **Aylık harcamalar**'a da yazılır: not "Kasadan · 21 Ekim Çarşamba",
  ödeme şekli nakit, harcama tarihi fişin tarihi (kasa gününden en çok 3 gün önceyse). Fatura ya da e-Arşiv fatura
  yazılmaz (Paraşüt'ten de gelir, iki kez sayılmasın; yönetici bakar); teslim hiçbir zaman. Yönetici her satırda
  "Aylık harcamalar'a da yaz"ı seçer. Personel yalnız alım ve genel gider kategorilerini seçebilir.
- Akşam raporunun **Gün içinde kasadan çıkan** tutarı ve **Neye çıktı** notu satırlardan dolar ("Fişlerden: 2 kalem ·
  …"). Yazılan tutar satırların toplamından azsa uyarı çıkar (engellemez).
- Satıra dokununca düzeltilir ya da silinir (Geri al 8 saniye; satır harcama kaydıyla birlikte, olduğu gibi ve eski
  numarasıyla geri gelir). Geri al'ın taşıdığı kopya sunucunun mühürüdür (`src/lib/cash-outs.ts` › `cashOutUndoJson`):
  yalnız silen kişi, 15 dakika içinde ve bir kez kullanır; istemcinin yazdığı bir kopya kabul edilmez. Gün personele
  kapanınca (dünden eskisi) yalnız yönetici ekler ve düzeltir.
- Personelin düzeltmesi Aylık harcamalar kaydını açmaz ve silmez: yöneticinin oradan sildiği kayıt geri gelmez,
  faturaya açtığı kayıt kalır; tutar ve tarih kayda yansır, yöneticinin yazdığı açıklama, ödeme şekli ve not kalır.
  Kaydı yöneticinin kategorisindeki (maaş, kira gibi) satırı personel silemez, türünü ve kategorisini değiştiremez:
  "yöneticiye haber verin".
- Aylık harcamalar'da bu kayıtlarda fotoğraf simgesi ve **Kasadan** rozeti görünür; tutarı ve tarihi Kasa raporu'nda
  düzeltilir. Aylık harcamalar'dan silinen kayıt kasa satırını silmez.

## laffogato.net satırı (bilgi)

Formun altında, site bağlıysa o günün online satışı tek satır olarak görünür:

> **laffogato.net · 21 Ekim Çarşamba:** Online (site + uygulama) 1.331,02 ₺ · Karaoke ön ödeme 410 ₺ — kasadan geçmez.

Uygulama ve web siparişleri (kafe + mağaza) ile ön ödemeli karaoke, KDV dahil, iadeler düşülmüş. Parası sanal POS'tan
alındığı için **kasadan geçmez**: kasa farkına, Z kontrolüne ve devre girmez; ModPOS'un "Online" ödemesi (Yemeksepeti,
Getir…) ayrıdır. Personel karaoke tutarını görmez. Rapor açılınca, gönderilince ve e-postası gönderilince siteden
sorulur (saklanmaz); site düşük ya da yavaşsa (8 saniye) satır görünmez, form ve gönderim hiç beklemez. Sitenin günü
gece yarısında biter (kasanınki 05:00'te). Ayrıntı: [SITE-SATIS.md](SITE-SATIS.md).

## Düzeltmeler

Rapor yeniden gönderilince önceki hâli aynı işlemde saklanır (`cash_report_revisions`; rapor silinince onunla gider).

- **Değişiklikler** listesi personelin kayıtlı raporunda ve yöneticinin gün ayrıntısında görünür, en yeni önce: kim,
  ne zaman ("22 Ekim 10:05 · Mehmet") ve hangi alan neyden neye ("Sayılan nakit: 2.880 ₺ → 2.980 ₺"). Not ve "neye
  çıktı" metni yazılmaz, yalnız "Not değişti". En altta ilk gönderim.
- İş günü kapandıktan sonra (ertesi gün 05:00'ten sonra) kasadaki nakdi değiştiren bir alan (açılış, nakit satış, gün
  içinde çıkan, sayılan nakit, teslim edilen) ya da kasayı sayan değiştiyse düzeltme **Ertesi gün** rozetini alır; günden güne satırında
  **Ertesi gün düzeltildi** rozeti, yöneticinin zilinde "Kasa raporu ertesi gün değişti" (son 7 gün; kim ve ne
  değişti). Yalnız Z, kart ya da not düzeltmesi uyarı vermez; ardından yapılan bir not düzeltmesi uyarıyı da kapatmaz.
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

| Durum | Metin, Z, kart | Kasa alanı ya da sayan |
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
- **Kasa e-postasının alıcıları** arasına personel hesabının adresi yazılamaz: e-postada karaoke ön ödemesi var.

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
  Fotoğraf deposu yoksa çip yerine "Fotoğraf eklenemiyor; bu günleri yöneticiye yazın".
- **`/panel/kasa?gun=D`** geç rapor kipinde açılır: Z no ve en az bir Z fotoğrafı zorunlu, zorunlu **Neden geç
  giriliyor?** (3–300), kasayı sayan isteyendir (seçici yok; başka biri saydıysa nedene yazılır), teslim varsa
  **Teslim alan** (etkin kullanıcı ya da Banka). Kasadan çıkanlar kartı çizilmez ve "Gün içinde kasadan çıkan" elle
  yazılır (satırlar personele gitmez); e-posta, WhatsApp ve karaoke yok; zayi / ikram için Zayi sayfasının istek yolu.
  Açılış önerisi zincirin önceki **halkasından** gelir: önceki rapor ya da önceki bekleyen geç rapor
  (`src/server/cash/late-chain.ts`). Düğme **Onaya gönder**; "Onaya gönderildi · 120 ₺ eksik".
- Gönderdikten sonra kart: "Onay bekliyor", özet, "Neden: …", "2 fotoğraf eklendi", **Düzenle** ("Güncelle ve
  gönder"; tutulan fotoğraflar yalnız önceki isteğin fotoğraflarından) ve **Geri çek**. Başkasının isteği beklerken
  "Mehmet bu günü 21 Ekim'de gönderdi; yöneticinin onayını bekliyor."; istek kişi başınadır. Reddedilen istekte
  "Reddedildi · Ali: …" ve önceki değerlerle dolu form (fotoğraflar yine kişinin kendi küçük resimleri). Aynı gün için
  iki ret ya da geri çekmeden sonra form yerine "Bu günü yöneticiye yazın". Kişi başına en çok 5 bekleyen geç rapor.
- **05:00 dönüşü:** dünün formu gönderilirken gün personelin penceresinden çıktıysa sunucu kaydetmez
  (`{ needsApproval, request: "kasa-gec" }`), form yazılanlarla geç rapora geçer.
- Zil (İsteklerim): "14 Ekim kasa raporu onaylandı" / "… reddedildi". Bugün'deki dünün satırı: "… raporu girilmedi.
  Kafe açıktıysa bugün girin; yarından sonra yöneticinin onayıyla girilir."

**Yönetici:**

- **Onaylar › Kasa**, en eski gün önce, kart `#istek-<id>`: "14 Ekim Salı kasa raporu" ve **Geç rapor**, "Ayşe
  gönderdi · 21 Ekim 10:05 · 7 gün sonra", "Neden geç: …"; fotoğraflar ve okumaları (gün = D ile yeniden kurulur;
  okuma yoksa "Fotoğraf okunmadı: tarihi ve rakamları fotoğraftan kontrol edin"); **Z no sırası** önceki ve sonraki
  halkayla (`zNoOrder`; bekleyen halka "onay bekliyor"); döküm ve teslim alan; devir zinciri iki yönde; ay satırı
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
| Açık gün | Z toplamı 0'dan büyük rapor sayısı |
| POS cirosu | Z toplamlarının toplamı |
| İndirim, ödenmez / ikram | Girildiği günlerin toplamı (hiç girilmediyse 0) |
| Kartlı satış oranı | (Kart + yemek kartı) ÷ Z toplamı. O ayın POS komisyonu (Gelir-gider) bu oranla; boşsa Ayarlar'daki kart oranıyla |

- **Elle yazılan her zaman geçerlidir;** alan boşaltılınca kasaya döner. Satışlar'da her alanın yanında "Kasadan" ya
  da "Elle" yazar; kasadan gelen alana dokununca elle yazılır, elle yazılan alanın altında kasadaki değer ve
  **Kasadakini kullan**. Gelir-gider'de aylık ciro ve açık gün hücresi aynı kuralla ("Kasaya dön").
- Kasa raporları bir ayın ortasında başladıysa o ayın toplamları ayın yalnız bir kısmıdır: uygulanmaz, elle girilir
  ("Kasa raporları 20 Ekim'de başladı; …"). Kartlı oran yine kasadan.
- Raporu girilmemiş günler (süren ayda düne kadar) Satışlar'da sayılır: "3 gün rapor yok: 5, 12, 20 Kasım. O günler
  açıksanız ciro ve açık gün eksik kalır." **Kasa raporuna git**. Kapanmış ayda Genel bakış'ın "Bu ayın işleri"
  kartı uyarır.
- laffogato.net'in online satırı (kasadan geçmez) hiçbir rakama girmez.
- **Sabit giderin günü:** açık gün kasadan geldiğinde kira, maaş ve öteki aylık kalemler Gelir-gider'de açık gün
  sayısıyla değil, raporların kapsadığı takvim günüyle bölünür (biten ayda ayın tamamı, süren ayda dünün sonuna kadar):
  bayramda kapalı gün ya da raporu girilmemiş gün kirayı ve maaşı düşürmez (`prorationDays`, engine.ts). Günlük
  kalemler (personel yemeği) açık günle çarpılır. Açık gün elle yazıldıysa Excel'deki gibi açık gün ÷ ayın gün sayısı.
  Genel bakış'ta "Bu ay düşülen sabit gider" kutusu "Ayın geçen günü (16 / 31 gün)" yazar.
- **Ay ortasında yüklenen satış listesi:** Satışlar'da liste yüklerken süren ayda "Liste hangi güne kadar?" sorulur
  (varsayılan dün; `integration_state › sales.coverage`). Kasa raporları o günden ileri gittiyse listeye dayanan
  hesaplar listenin günleriyle yapılır: liste ↔ POS karşılaştırması (Satışlar'ın ay bilgisi kutusu, Tutarlılık, uyarı)
  o günlerin Z toplamı ve indirimiyle, Genel bakış'ın günlük ortalaması listenin açık günüyle, reçeteye göre kârın
  sabit gideri ve online satışı o günlere düşen payla, "ayda …" adetleri listenin açık günüyle. Ay bitince ayın
  tamamının listesi yüklenir; biten aya yüklenen liste ayın tamamı sayılır (kayıt silinir), Ayı temizle de siler.
- Kasa sayfasının ay görünümünde tek satır: "Bu ayın açık gün ve cirosu kasa raporlarından → Satışlar". Genel
  bakış'ta POS cirosu "· kasa raporlarından"; Excel kopyasının Ay Bilgileri sayfasında "Kartlı satış oranı" ve "Kasa
  raporundan" sütunları.

## Gönderince

- **E-posta:** yöneticinin seçtiği adreslere gider. Hiç kaydedilmediyse Vercel'deki `CASH_REPORT_RECIPIENTS` (virgülle ayrılmış adresler; adresler kodda durmaz, yerel kurulum gerçek kişilere rapor göndermez); o da yoksa rapor e-postasız kaydedilir.
  Konu örneği: "Kasa raporu · 21 Ekim Salı · 120 ₺ eksik". İçinde kasa sonucu, Z raporu, kasa, kart, günün zayi ve
  ikramı ve (site o an yanıt verdiyse) "laffogato.net (kasadan geçmez)" bölümü yer alır. Başlıkta gönderen ve
  (başkaysa) sayan: "Mehmet · sayan Ayşe"; güncellenen raporda "Değişen: …"; açılış ya da devir tutmuyorsa kasa
  bölümünde uyarı ([Açılış ve devir](#açılış-ve-devir)). Panelde kayıtlı ikramın menü fiyatıyla değeri ModPOS'un ödenmez tutarıyla karşılaştırılır.
  E-posta gitmezse rapor yine kaydedilir; ekranda "Yeniden dene" çıkar.
- **Fotoğraflar** raporla saklanır (kasa 6 ay). E-postada ve WhatsApp'ta fotoğraf ya da adresi yoktur: "📷 Z ve POS
  fotoğrafı panelde" satırı, net okunmuş bir rakamdan farklı yazılan alan ("⚠️ Fotoğraftan farklı yazılan: Kart
  (fotoğrafta 8.915 ₺)") ve "Gün içinde çıkan"ın altında kasadan çıkan satırlar (en çok 6) yer alır.
- **WhatsApp:** "WhatsApp ile gönder" ayrıntılı metni hazır açar. Ayarlarda numara girildiyse o sohbet açılır,
  girilmediyse kişi ya da grup seçilir. "Metni kopyala" ile başka yere de yapıştırılır.
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
  ve "· 2 kez düzeltildi". Satıra dokununca ayrıntı açılır: fotoğraflar (büyütülür, yönetici siler; rapor kalır),
  fotoğraftan farklı yazılanlar, açılış ve devir uyarıları, kasadan çıkan satırlar, değişiklikler, WhatsApp, düzenle,
  e-postayı yeniden gönder, sil. Silinen raporun fotoğrafları 30 gün saklanır.
- **Ay özeti:** Z toplamı, net kasa farkı, eksik ve fazlaların toplamı, rapor girilen gün sayısı; altında ayın açık
  gün ve cirosunun nereden geldiği ve Satışlar'a bağlantı.
- **Rapor alıcıları:** e-posta adresleri (en çok 10), e-posta açık / kapalı, WhatsApp numarası ve "Deneme e-postası".
  E-posta için Vercel'de `RESEND_API_KEY` gerekir (`docs/BILDIRIMLER.md`).

Dosyalar: `src/lib/cash-report.ts` (hesap, açılış ↔ devir, düzeltme geçmişi, WhatsApp metni; `tests/kasa-raporu.test.ts`),
`src/server/actions/cash-report.ts` (uçlar), `src/server/cash/report-store.ts` (yazım yolu ve silme; onay yolları da
buradan), `src/server/cash/report-email.ts` ve `src/server/notify/cash-report-template.ts` (e-posta), `src/app/panel/kasa/`; ay
bilgisine aktarım `src/lib/cash-month.ts` (`tests/kasa-ay-bilgisi.test.ts`); fotoğraftan okuma `src/lib/photo-read/`
(`tests/fotograf-okuma.test.ts`), kasadan çıkanlar `src/lib/cash-outs.ts` ve `src/server/actions/cash-outs.ts`.

# Gün sonu kasa raporu

Ekran: **Kasa raporu** (`/panel/kasa`). Personel her akşam kapanışta ModPOS'tan Z raporunu alır, kasadaki nakdi sayar
ve buraya girer. Telefonda alt menüde **Kasa**.

## Personel ne girer

| Bölüm | Alanlar |
|-------|---------|
| Z raporu (ModPOS) | Toplam satış, nakit, kredi / banka kartı; varsa yemek kartı, online, diğer; ödenmez / ikram (ciro dışı); Z no ve fiş sayısı (isteğe bağlı). Ya da Z raporunun fotoğrafını çekin: rakamlar dolar |
| Kasa (nakit) | Açılış (önceki raporun ertesi güne devrinden kendiliğinden dolar), akşam sayılan nakit, gün içinde kasadan çıkan (harcama, teslim; gün içinde girilen satırlardan dolar) ve neye çıktığı, sayımdan sonra teslim edilen |
| Kart | Banka POS cihazının gün sonu toplamı (isteğe bağlı; fişin fotoğrafından da dolar) |
| Not | Fark varsa nedeni (bozuk para, iade, yanlış fiş…) |

Yazarken hesaplananlar:

- **Olması gereken nakit** = açılış + nakit satış − gün içinde çıkan
- **Kasa farkı** = sayılan − olması gereken. 1 ₺'nin altı "tutuyor", eksi **eksik** (kırmızı), artı **fazla** (turuncu).
- **Ertesi güne devir** = sayılan − teslim edilen. Ertesi günün açılışı buradan dolar.
- **Kart farkı** = banka POS − ModPOS kart.
- **Z kontrolü**: ödeme türlerinin toplamı Z toplamından farklıysa uyarı çıkar (yanlış yazılmış tutar).

Gece 05:00'e kadar kapanan gün bir önceki güne yazılır. Personel bugünün ve dünün raporunu girer ya da düzeltir.
Daha eski bir günü yalnız yönetici açar. Rapor yeniden gönderilince "güncellendi" diye işaretlenir. Arada başkası
göndermişse üzerine yazılmaz: sayfa yenilenip onun girdikleri görülür.

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
- İki POS cihazı varsa ikinci fişte **Toplama ekle** ya da **Yerine yaz** sorulur.
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
- Satıra dokununca düzeltilir ya da silinir (Geri al 8 saniye). Gün personele kapanınca (dünden eskisi) yalnız
  yönetici ekler ve düzeltir.
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

## Gönderince

- **E-posta:** yöneticinin seçtiği adreslere gider. Hiç kaydedilmediyse Vercel'deki `CASH_REPORT_RECIPIENTS` (virgülle ayrılmış adresler; adresler kodda durmaz, yerel kurulum gerçek kişilere rapor göndermez); o da yoksa rapor e-postasız kaydedilir.
  Konu örneği: "Kasa raporu · 21 Ekim Salı · 120 ₺ eksik". İçinde kasa sonucu, Z raporu, kasa, kart, günün zayi ve
  ikramı ve (site o an yanıt verdiyse) "laffogato.net (kasadan geçmez)" bölümü yer alır. Panelde kayıtlı ikramın menü fiyatıyla değeri ModPOS'un ödenmez tutarıyla karşılaştırılır.
  E-posta gitmezse rapor yine kaydedilir; ekranda "Yeniden dene" çıkar.
- **Fotoğraflar** raporla saklanır (kasa 6 ay). E-postada ve WhatsApp'ta fotoğraf ya da adresi yoktur: "📷 Z ve POS
  fotoğrafı panelde" satırı, net okunmuş bir rakamdan farklı yazılan alan ("⚠️ Fotoğraftan farklı yazılan: Kart
  (fotoğrafta 8.915 ₺)") ve "Gün içinde çıkan"ın altında kasadan çıkan satırlar (en çok 6) yer alır.
- **WhatsApp:** "WhatsApp ile gönder" ayrıntılı metni hazır açar. Ayarlarda numara girildiyse o sohbet açılır,
  girilmediyse kişi ya da grup seçilir. "Metni kopyala" ile başka yere de yapıştırılır.
- **Zil:**
  - Personele: akşam 20:00'den sonra bugünün raporu girilmediyse hatırlatma.
  - Yöneticiye: dünün raporu girilmediyse ve son raporda fark varsa bildirim.

## Yönetici

- **Günden güne:** ayın her günü bir satır, rapor girilmeyen günler dahil. Satırda Z toplamı, nakit / kart, kasa
  farkı rozeti, kart farkı ve "Z tutmuyor" işaretleri var. Fotoğraflı raporda fotoğraf simgesi; net okunmuş bir
  rakamdan farklı yazılan alan varsa **Fotoğraftan farklı** rozeti (soluk okumanın düzeltilmesi sayılmaz). Satıra
  dokununca ayrıntı açılır: fotoğraflar (büyütülür, yönetici siler; rapor kalır), fotoğraftan farklı yazılanlar,
  kasadan çıkan satırlar, WhatsApp, düzenle, e-postayı yeniden gönder, sil. Silinen raporun fotoğrafları 30 gün
  saklanır.
- **Ay özeti:** Z toplamı, net kasa farkı, eksik ve fazlaların toplamı, rapor girilen gün sayısı.
- **Rapor alıcıları:** e-posta adresleri (en çok 10), e-posta açık / kapalı, WhatsApp numarası ve "Deneme e-postası".
  E-posta için Vercel'de `RESEND_API_KEY` gerekir (`docs/BILDIRIMLER.md`).

Dosyalar: `src/lib/cash-report.ts` (hesap, WhatsApp metni; `tests/kasa-raporu.test.ts`), `src/server/actions/cash-report.ts`,
`src/server/notify/cash-report-template.ts` (e-posta), `src/app/panel/kasa/`; fotoğraftan okuma `src/lib/photo-read/`
(`tests/fotograf-okuma.test.ts`), kasadan çıkanlar `src/lib/cash-outs.ts` ve `src/server/actions/cash-outs.ts`.

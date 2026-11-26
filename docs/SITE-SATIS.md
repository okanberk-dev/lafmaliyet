# laffogato.net online satışları: kâr-zarar, tüketim ve kasa raporu

Ekranlar: **Gelir-gider** (`/panel/gelir-gider`; "laffogato.net online satışları" kartı ve tablonun Maliyet
bölümündeki satırlar), **Genel bakış** (`/panel`; reçeteye göre kâr, başabaş, tahmin), **Tutarlılık**
(`/panel/tutarlilik`; online tüketim), **Kasa raporu** (`/panel/kasa`; günün bilgi satırı) ve **Ayarlar ›
laffogato.net** (bağlantının durumu).

**Kullananlar** (sözleşmeye dokunan bir değişiklik bunların hepsine bakar): kâr-zarar, Genel bakış ve tüketim (hesap
motoru, `src/lib/calc/engine.ts`), kasa raporunun günlük bilgi satırı (`src/server/site-sales/sync.ts`),
**Nakit planı › KDV tahmini** (satış KDV'sine sitenin KDV'si de girer: `siteVat` `src/lib/site-sales/calc.ts`, okuyan
`src/lib/kdv.ts`; [NAKIT-PLANI.md](NAKIT-PLANI.md)), **Marina'nın tahmini stoğu** (şubenin ayrı ay kaydı; aşağıda
Saklama, [STOK-TAHMINI.md](STOK-TAHMINI.md) § 2). Sözleşmenin sitedeki kopyası: laffogato deposunda
`docs/PANEL-SALES.md` (uç, alanlar, KDV kuralı, hata kodları; sitenin kuralı `src/lib/panel/sales-export-core.ts`).

## Geliştirilmiş istek (prompt)

> Operatör (22 Eki 2026): _"laffogato admin ile lafmaliyette paralel çalışabilecek neler varsa ... beraber
> çalışsın"_.
>
> Panelin cirosu kasanınkidir (ModPOS). Sitenin aldığı para (uygulama ve web kafe siparişleri, mağaza kolileri, ön
> ödemeli karaoke) kasadan geçmediği için panelin hiçbir rakamında yok; uygulama siparişinin harcadığı süt ve kahve de
> tüketim kontrolünde eksik. Bunu düzelt:
>
> - **Kâr-zarar:** ay ay imzalı `GET /api/panel/sales?month=YYYY-MM`; ay başına bir kayıt (yeniden çekmek üzerine
>   yazar). Ayrı, KDV hariç gelir satırları; kâr bunlarla hesaplansın. ModPOS cirosuna ve POS komisyonu formülüne
>   dokunulmasın. Rakamın nereden geldiği görünsün; hiç çekilmemiş ay **boş** kalsın (0 değil).
> - **Ne zaman:** günlük işte bir adım (içinde bulunulan ay; ayın ilk günlerinde geçen ay da: geç gelen iadeler) ve
>   elle **Siteden yenile**. Yeni Vercel cron'u yok.
> - **Tüketim:** kafe satırları menü bağlantısıyla panelin ürünlerine eşlensin (L → L yuvası, M ve tek boy → M) ve
>   ayrı bir kaynak olarak tüketime girsin (ModPOS satışlarına karışmasın); eşlenmeyen satırlar listelensin.
> - **Kasa raporu:** o günün online toplamı bilgi satırı olarak görünsün ("kasadan geçmez"); kasa rakamlarını asla
>   değiştirmesin, site düşük ya da yavaşsa (8 sn) satır hiç görünmesin, rapor hiç beklemesin.
> - **KVKK:** siteden yalnız toplamlar ve ürün satırları; müşteri adı, sipariş numarası yok.

## Nasıl çalışır

```
laffogato.net                                    ladmin.laffogato.net (bu panel)
─────────────                                    ──────────────────────────────
GET /api/panel/sales?month=2026-10  ◀──────────  günlük iş (bu ay ve önceki iki ay)
  {now, version:1, from, to, closed,               ya da Gelir-gider › Siteden yenile (aynı üç ay)
   cafe:{…, lines:[…]}, shop:{…},                  ├─ doğrula (sürüm 1, dönem aynı, tamsayı kuruş)
   karaoke:{…}, manual:{…}, counter:{…}}           └─ integration_state site_sales:2026-10 (üzerine yazar)
                                                         └─ hesap motoru: kâr-zarar satırları, online tüketim

GET /api/panel/sales?from=2026-10-21&to=2026-10-21  ◀──  Kasa raporu açılınca / gönderilince / e-postada
  (o günün toplamı; saklanmaz)                            8 sn'de gelmezse satır yok, rapor beklemez
```

Ping yok: online satış ayın sonunda bir kez kesinleşmez (geç iade kapanmış ayı da düşürür), panel günde bir çeker.

### Kâr-zarar (Gelir-gider)

Tablonun Maliyet bölümünde, **AYLIK CİRO (KDV hariç)** satırının altında, yalnız gösterilen aylardan en az biri
siteden çekildiyse:

| Satır | Ne |
|-------|----|
| KAFE ONLİNE (SİTE + UYGULAMA) | Uygulama ve web kafe siparişleri (masa, gel-al, kurye), iadeler düşülmüş. Panelden elle girilen siparişler ModPOS'ta olduğu için girmez (`manual`) |
| MAĞAZA (ONLİNE) | Sitenin mağaza kolileri (kargo ücreti dahil), iadeler düşülmüş |
| KARAOKE (ÖN ÖDEMELİ) | Sitede ödenen karaoke rezervasyonlarının köşkte kalan tutarı, parasının alındığı ayda |
| TOPLAM CİRO (KDV hariç) | ModPOS cirosu (KDV hariç) + üç online satır |

- **KDV hariç** (sözleşmenin formülü): `netMinor − kdvMinor − unknownKdvNetMinor × r / (100 + r)`. `r` panelin
  varsayılan oranı (Ayarlar › Oranlar): kafe ve mağaza için satış KDV'si (%10), karaoke için hizmet satışı KDV'si
  (%20). Site her siparişin satıldığı oranı saklar; 17 Ekim 2026 öncesi siparişlerde oran yoktur, panel onları bu
  oranla ayırır. Ödül kuponuyla bedava verilen içeceğin faturası tam fiyattan KDV doğurur: o ay KDV hariç gelir eksi
  çıkabilir, doğrudur. Site kuruş gönderir, panel TL gösterir.
- **Hiç çekilmemiş ay boş kalır** (0 değil): o ayın kârı yalnız ModPOS'la hesaplanır. Çekilmiş ama satışsız ay 0'dır.
- **KÂR / ZARAR** = toplam ciro − giderler; **oranlar** (maliyet oranı, kira oranı, …) toplam ciroya göre. Genel
  bakışın "Faturaya göre" kârı, yıllık eğilim, ay ay döküm ve dışa aktarım aynı toplamı kullanır; Genel bakışın
  reçeteye göre kârı da online satışı içerir (aşağıda "Genel bakış").
- **Dokunulmayanlar:** AYLIK CİRO (KDV dahil – POS) elle girilen ModPOS cirosu olarak kalır, AYLIK CİRO (KDV hariç)
  yalnız ondan hesaplanır (kasada çalınan karaoke, yani Satışlar'da HİZMET işaretli satırlar, hizmet KDV'siyle: bkz.
  aşağıda "Kasadaki karaoke"); POS komisyonu formülü aynen ModPOS cirosundan. Online satırlar düzenlenemez,
  gelir-gider düzeltmesi almaz (kaynak sitedir).
- **KDV dahil döküm** (kartta her ayın ikinci satırı): sitenin gönderdiği ham rakamlar — "KDV dahil ciro X (brüt −
  iade) · KDV Y · sitenin indirimi Z · kargo W". Yalnız ciroya giren üç blok (kafe, mağaza, karaoke) toplanır; kasada
  ödenen (`counter`) ve panelden elle girilen (`manual`) siparişler dışındadır. KDV, KDV hariç satırlarının
  formülünün tersidir (`siteGross`, `src/lib/site-sales/calc.ts`).
- **Kaynak görünür:** satırların açıklaması nereden geldiğini söyler; tablonun üstündeki **laffogato.net online
  satışları** kartı ayı ayı gösterir: kafe / mağaza / karaoke (KDV hariç) ve sipariş sayıları, "Ay kapandı" / "Ay
  sürüyor" (sitenin `closed`'ı), ne zaman çekildiği, panelden elle girilip eklenmeyen siparişler (KDV dahil), kasada
  ödenen uygulama siparişleri (`counter`, KDV dahil; aşağıda), karaokede iadesi bekleyen tutar
  (`karaoke.refundPendingMinor`: iptal edilmiş, parası henüz geri ödenmemiş; karaoke tutarının içindedir, geri
  ödenince sonraki çekmede düşer), panel ürününe bağlı olmayan satır sayısı, son hata. **Siteden yenile** bu ayı ve
  önceki iki ayı, satırdaki ↻ o ayı, **Başka bir ay** bu yılın herhangi bir ayını (Ocak 2026'dan bu aya) çeker.
  Kartın altında **laffogato.net paneli ↗**.
- **Kasada ödenen uygulama siparişi** (`counter`, v1'e eklenen isteğe bağlı blok): uygulama ya da web siparişi kartla
  ödenemeyip kasada nakit ya da kasadaki kart cihazıyla ödenirse (sitede "Ödendi olarak işaretle", `manual:nakit` /
  `manual:kart`) fişi ModPOS'ta çalınır: ciro kasadadır. Site bu siparişleri kafe ve mağaza toplamlarından ve
  satırlarından ayırıp `counter` olarak gönderir (sitede `cafe` / `shop` ile aynı sekiz alan; panel `orders`,
  `grossMinor`, `netMinor`'ı okur); panel ciroya, KDV tahminine ve
  tüketime eklemez (elle girilen `manual` gibi), kartta bilgi olarak yazar. Eski site bloğu göndermez: sıfır sayılır.
- Telefonda ay özeti "+ online X (laffogato.net)" der.
- **Karaoke box ile karaoke odası ayrı işlerdir:** Faturalar'daki "Karaoke box" kategorisi MaviBahçe AVM'deki karaoke
  box'ların faturalarıdır (Opera Gayrimenkul; `SEPARATE_CATEGORIES`, [PARASUT.md](PARASUT.md) §6a-1), kafenin
  gelir-giderine girmez. Sitenin karaoke odası ise köşkün kendi odasıdır: ön ödemeli rezervasyonu KARAOKE (ÖN
  ÖDEMELİ) satırında, kasada çalınanı ModPOS cirosunda kafenin kâr-zararına girer.

### Kasadaki karaoke (hizmet satışı KDV'si)

Köşkte kasadan (ModPOS) çalınan karaoke ("Karaoke Kişi başı", "Karaoke Toplu") Satışlar'da **HİZMET** olarak
işaretlenir: malzeme maliyeti yoktur ve KDV'si %20'dir (kafenin yiyecek-içeceği %10). Panel bu satırları kendi oranıyla
ayırır (Ayarlar › Oranlar › **Hizmet satışı KDV oranı**, varsayılan %20; `settings.kdvHizmet`):

- **Satış raporu:** HİZMET satırının neti `ciro ÷ (1 + hizmet KDV)`, ürünlerinki `ciro ÷ (1 + satış KDV)`.
- **Gelir-gider:** AYLIK CİRO (KDV hariç) = (POS cirosu − hizmet payı) ÷ (1 + satış KDV) + hizmet payı ÷ (1 + hizmet
  KDV). Hizmet payı, ayın satış listesindeki HİZMET satırlarının cirosudur (ay cirosundan büyük olamaz); satış listesi
  yüklenmemiş ayda bütün ciro satış KDV'siyle ayrılır.
- Tek oranla (bütün ciro %10) hesaplanan eski tutara göre Eylül 2026'nın 2.050 ₺'lik karaokesi yüzünden net ciro ve
  kâr 155,30 ₺ düşer (`tests/calc.test.ts`; tohum verisinin değerleriyle karşılaştırma tek oranlı varsayımla yapılır).
  Hizmet oranı satış oranına eşitlenirse hesap tek oranlıya döner.

### Tüketim (Tutarlılık)

Sitenin kafe satırları (`cafe.lines`: iptal edilmeyen, tamamen iade edilmemiş siparişlerin satırları) menü
bağlantısıyla ürünlere eşlenir ([SITE-MENU.md](SITE-MENU.md)): satırın kalemi `products.site_menu_id`, boyu yuvası
(`L` → L yuvası; `M` ve tek boy → M yuvası). Eşlenen satırın adedi ürünün reçetesiyle malzemeye çevrilir ve
**ayrı bir kaynak** olarak tüketime eklenir (`sales_lines`'a yazılmaz; ModPOS yapıştırması online satışı ezmez,
online satış ModPOS satışını şişirmez):

- Beklenen kullanım = ModPOS satışları + online kafe siparişleri; kartta ve tabloda "ModPOS x · online y".
- **Online satışlar** kartı: ayın online tüketimi, eşlenen satırlar ve **panel ürününe bağlı olmayanlar** (ad, boy,
  adet; malzemesi tüketime girmez). **Ürünleri bağla** eşleştirme ekranına götürür. Satır başka boya düşülmez
  (yanlış boyun reçetesi tüketimi yanlış gösterirdi).
- Bağlı olmayan satır varsa zilde uyarı: "N online satış satırı panel ürününe bağlı değil".
- Ay çekilmediyse kart bunu söyler ve Gelir-gider'e (Siteden yenile) götürür; o ayın beklenen kullanımı yalnız
  ModPOS'tandır.
- **Su + buz litre maliyeti** de online siparişleri sayar (denetim E-57): SU GİDERİ ÷ (satış listesine göre + aynı
  ayın online siparişlerine göre harcanan su ve buz). Ay yine satış listesiyle seçilir (listesi yüklenmemiş ayın
  faturası yalnız online litreye bölünmez); Hammaddeler'deki su kartının dökümü iki kaynağı ayrı yazar. Tek şube
  seçiliyken de litre işletme genelidir: bütün şubelerin satış listesi ve online siparişler (docs/SUBE.md › Şube
  görünümünde maliyet; denetim 21 Kasım #4).
- **Seçenekler** (v1'e eklenen, isteğe bağlı satır alanları; eski site göndermez): `extraShots` (satırdaki toplam
  ekstra shot, adet dahil), `syrups` ve `milks` (seçeneğin kimliğine göre adet; `normal` süt sayılmaz). Kasada bunlar
  ayrı satır olarak çalınır ("Extra Shot", "Syrup", "Alternatif Süt"): panel online seçenekleri de aynı ürünlere
  verir. Ürün önce sitenin menü kalemine bağlı olandır (ekstra shot `mnu-0081`, şurup `mnu-0080`; Ürünler › Site
  menüsü), yoksa adı tutan ürün (`OPTION_PRODUCTS`, `src/lib/site-sales/calc.ts`). O ürünün reçetesi beklenen
  tüketime, maliyeti reçeteye göre kâra, adedi "ayda …" adetlerine girer. Ürünü olmayan seçenek Online kafe
  siparişleri kartında "panelde ürünü yok" diye listelenir. Normal süt içeceğin kendi reçetesindedir; alternatif sütün
  inek sütünü azaltması kasadaki gibi hesaba girmez.

### Genel bakış

Genel bakışın reçeteye göre rakamları da (net satış, brüt kâr, "Para nereye gitti?", başlıktaki **net kâr / zarar**)
Gelir-gider gibi ModPOS + online'dır (`dashboard().theoretical`, `model.onlineMonth`):

- **Net satış** = ModPOS satış listesi (KDV hariç) + üç online satır (KDV hariç, Gelir-gider'deki tutarlar). Kartın
  dökümünde ayrı "laffogato.net online" bölümü; "Para nereye gitti?" çubuğunun tabanı ikisinin toplamı.
- **Malzeme + ambalaj** (online kısmı): ürüne eşlenen kafe satırları ve ürünü olan seçenekler adet × ürünün reçete
  maliyeti; menüye bağlı olmayan kafe satırları (liste fiyatı), reçetesi boş ürüne eşlenen satırlar (liste fiyatı;
  seçenekte ürünün menü fiyatı) ve mağaza kolileri (kargo ücreti hizmet KDV'siyle düşülerek) KDV hariç tutar × ayın
  ortalama maliyet oranı (ModPOS'ta eşleşmeyen ve reçetesi boş satırın kuralı; ayın satış listesi yoksa son satış
  ayınınki). Reçetesi boş ürün sıfır maliyet sayılmaz, ortalama orana da girmez (denetim E-47). Karaokenin malzemesi yoktur. Online ödemenin komisyonu bu görünümde yok: faturası gelince
  Gelir-gider'de komisyon olarak.
- **Brüt kâr** = ModPOS brüt kârı + online (gelir − malzeme); **net kâr** = brüt kâr − indirimler − sabit giderler.
  Kategoriler kutusunda online ayrı satır.
- **Başabaş günlük ciro** = (standart aylık sabit gider + her ay girilen harcamalar − online brüt kârı) ÷ brüt kâr
  oranı ÷ ayda açık gün; tek kural `breakEvenOf` (Genel bakış, Sabit giderler, Analiz, Ayarlar ve Claude; denetim
  E-59, E-13). Online
  brüt kârı referans satış ayının, ay kapanmadıysa ondan önceki son kapanmış online ayın (süren ayın yarım online
  satışı bir ayı karşılamaz); yoksa düşülmez.
- **Ay sonu tahmini** online satışın bugüne kadarki brüt kârını aynı tempoyla ekler (÷ geçen gün × ayın açık günü:
  Özel günler'de kafe kapalı işaretli günler düşülür, denetim E-41).
- **Adetler:** kategoriler, menü mühendisliği, en kârlı / en çok satan ürünler ve zam etkisinin "ayda …" adetleri
  online satılanı da sayar (`soldWithOnline`, `salesBasis`); zam etkisinin "brüt kârın %X'i" paydası online brüt kârı
  içerir. Online adet ayın açık günüyle standart aya çevrilir. Ürünler sayfası (adet, brüt kâr), ürün kartı (ayın adedi
  ve Satışlar geçmişi; yalnız online satılan ay da görünür, `productSalesHistory`) ve dışa aktarımın Ürün Kârlılık / Reçete
  Kartları sekmeleri de aynı adedi gösterir: Claude aracının açtığı kart aynı sayıyı söyler.
- Süren ayda satış listesi kasa raporlarından kısa bir dönemi kapsıyorsa (Satışlar › "Liste hangi güne kadar?")
  online satış o günlere düşen payla girer (`listShareOf`), sabit gider gibi.
- **POS cirosu kartının dökümünde** ayrı bir **laffogato.net online (KDV dahil)** bölümü: kafe / mağaza / karaoke
  (sipariş ve rezervasyon sayılarıyla), altında KDV, varsa iade, kasada ödenen uygulama siparişi ve panelden elle
  girilen sipariş (ikisi POS cirosunda olduğu için eklenmez). Bölüm kasadan geçmediği için kartın toplamına girmez
  (`apart`), kendi ara toplamıyla durur: POS cirosu rakamı ve karşılaştırmaları değişmez (`onlineGroups`,
  `src/app/panel/dashboard-breakdowns.ts`).
- Çekilmemiş ayda eskisi gibi yalnız ModPOS.
- **Analiz › Senaryo** "Şu an"ı Genel bakış'taki reçeteye göre net kârla aynıdır (denetim E-12): sabit gider o ayın
  tutarları (liste kasa raporlarından kısaysa o döneme düşen payı), indirim listenin döneminden, online brüt kârı ayrı
  satır. Kaydırıcılar yalnız kasanın satış karmasını değiştirir; online brüt kârı sabit kalır (zam / adet kaydırıcılarına
  katmak başabaşın tanımını değiştirirdi: Genel bakış'ta başabaş kasanın cirosudur). Başabaş ve hedef kâr kartları
  Genel bakış'ın başabaşıyla aynı tabandan (`breakEvenOf`). "Aylık sabit gider değişimi" aylık bir tutardır: net kâra
  tabanın sabit gideri gibi dönemin payıyla (`fixedShare` = Gelir-gider'in açık gün oranı × liste dönemi; 1–15 Kasım
  listesinde %50), başabaşa tamamıyla girer. Net kâr tam ayın değilse kart başlıkları dönemi söyler ("Net kâr / zarar
  (1–15 Kasım)", "Karşılaştırma (1–15 Kasım)").

### Kasa raporu satırı

Kasa raporu açılınca, gönderilince ve e-postası (yeniden) gönderilince o günün toplamı ayrıca sorulur:
`GET /api/panel/sales?from=GÜN&to=GÜN&branch=ŞUBE`. Site 21 Kasım 2026'dan beri şubelidir (sitenin docs/PANEL-SALES.md
› Şube kırılımı): satır kasanın şubesinindir, Tuzla `branch=tuzla`, Marina `branch=marina` (şube verilmezse Tuzla;
`siteBranchOf`). Yanıt `branch`'i söyler; Marina için başka şubenin ya da şubesiz (eski site) yanıtı satıra yazılmaz,
Tuzla için şubesiz eski yanıt eskisi gibi kabul edilir (`siteBranchMatches`). Online kanal seçiliyken satır yok. Aylık
kayıt (kâr-zarar) şubesiz istenir: site şube verilmezse **her şubenin** toplamını verir, kâr-zararın online satırı
işletme genelidir (Marina'nın masa siparişi de dahil); fiziksel şube seçiliyken zaten okunmaz. Satır:

> **laffogato.net · 21 Ekim Çarşamba:** Online (site + uygulama) 1.331,02 ₺ · Karaoke ön ödeme 410 ₺ — kasadan geçmez.
> Bilgi için: kasa farkına ve Z raporuna girmez; ModPOS'un "Online" ödemesi (Yemeksepeti, Getir…) ayrı. Sitenin günü
> gece yarısında biter.

- Tutarlar KDV dahil, iadeler düşülmüş (`netMinor`): online = kafe + mağaza. Personel karaoke tutarını görmez
  (karaoke tutarları personele gösterilmez); yöneticiye giden e-postada ikisi de var ("laffogato.net (kasadan
  geçmez)" bölümü; düz metinde son satır). WhatsApp metnine girmez.
- **Hiçbir kasa rakamını değiştirmez**: kasa farkı, Z kontrolü, devir aynen.
- **Raporu asla bekletmez:** sayfada satır akışla sonradan gelir (form hemen açılır); gönderimde istek kayıtla aynı
  anda başlar, yalnız e-posta onu bekler. Site düşük, yavaş (8 saniye; gövdeyle en çok 8,5) ya da yanıtı bozuksa satır
  hiç görünmez, rapor satırsız kaydedilir ve gider. Saklanmaz.
- Gün sınırı: kasanın günü gece 05:00'e kadar sürer (geç kapanış bir önceki güne yazılır), sitenin günü gece yarısında
  biter. Satır raporun tarihindeki **sitenin günüdür**; gece yarısından sonra verilen online sipariş ertesi günün
  satırındadır (satır bunu söyler).

## Saklama

| Anahtar (`integration_state`) | İçerik |
|-------------------------------|--------|
| `site_sales:YYYY-MM` | Ayın kaydı: sitenin yanıtı (toplamlar, kafe satırları, `closed`, `now`) + `month`, `pulledAt`. Yeniden çekmek üzerine yazar; sitenin saatine (`now`) göre daha eski bir yanıt yenisinin üstüne yazılmaz. Çekme başarısızsa önceki kayıt kalır |
| `site_sales_sync` | `lastPullAt` (son deneme), `lastOkAt` (son başarılı), `lastError` (ay ay), `lastMonth` |
| `site_sales_sube:marina:YYYY-MM` | **Marina'nın** ay kaydı (`&branch=marina`; 26 Kasım 2026): aynı biçim + `branch`. Yalnız tahmini stok okur (kasadan geçmeyen online siparişin tüketimi); kâr-zarar, KDV ve Tutarlılık işletmenin şubesiz kaydını okur. Önek `site_sales:` ile başlamaz: `loadSiteSales` onu görmez. Yanıt `branch: "marina"` demezse (eski site) yazılmaz |
| `site_sales_sube_sync` | Şube başına `lastPullAt`, `lastOkAt`, `lastError` (Tahmini stok'un uyarısı yazar) |

Günlük kasa satırı saklanmaz. `npm run db:reset` bu kayıtları silmez (sitenin verisi; tohum verisinden gelmez). Elle çekme
işlem geçmişine yazılır ("laffogato.net online satışları çekildi · Ekim 2026").

## Ne zaman çekilir

| Tetikleyici | Aylar |
|-------------|-------|
| Günlük iş (`/api/cron/gunluk`, sabah; ayrı ve yalıtılmış bir adım, hata öteki adımları durdurmaz) | Bu ay ve önceki iki ay, her gün (`salesMonthsToPull`) |
| Gelir-gider › **Siteden yenile** | Aynı üç ay |
| Ay satırındaki ↻ ya da **Başka bir ay › Siteden çek** | O ay (bu yılın Ocak 2026'dan bu aya kadarki ayları; istek başına en çok 3) |
| Tahmini stok › **Siteden al** (yalnız Marina'nın kaydı) | Tahminin gerektirdiği ama kaydı olmayan aylar (en çok 6; `refreshStockOnline`) |

Günlük iş ve **Siteden yenile** aynı üç ayı Marina için de ayrıca, aynı anda sorar (`syncBranchSiteSales`, `&branch=marina`;
üç küçük istek daha). Onun hatası işletmenin çekmesinin sonucunu ve durumunu değiştirmez, kendi durumuna yazılır.

Aylar aynı anda sorulur (üç küçük imzalı istek): site yavaşsa günlük iş en çok 8 saniye bekler. Elle çekme yalnız
yöneticinin (`src/server/actions/site-sales.ts`).

**Neden üç ay:** site iadeyi siparişin verildiği aya, karaokeyi parasının alındığı aya yazar. 28 Ekim'de verilen,
3 Kasım'da teslim edilen ve 15 Kasım'da cayma hakkıyla (14 gün) iade edilen koli Ekim'i düşürür; 5 Ekim'de 30 Kasım
için ödenip 25 Kasım'da iptal edilen karaoke de (rezervasyon 60 gün ileriye alınabilir). Eskiden yalnız ayın ilk 7
gününde geçen ay çekiliyordu: "Ay kapandı" diyen Ekim kâr-zararı ve KDV tahmini 500 ₺'yi tutmaya devam ederdi. Üç
aydan eski iade için ayın satırındaki ↻ ya da **Başka bir ay**.

## Sitede yapıldı (v1'e ekleme, 23 Ekim 2026)

İki alan sitede yayında ve panel ikisini de okur (isteğe bağlı: alan gelmezse davranış eskisi gibi):

1. **`counter`** (laffogato #246; sitede `cafe` / `shop` ile aynı sekiz alan, panel `orders`, `grossMinor`,
   `netMinor`'ı okur): başarılı ödemesi `manual:nakit` ya da `manual:kart`
   olan uygulama / web siparişleri (kasada ödendi, ModPOS'ta çalındı); `cafe` / `shop` toplamlarından ve `cafe.lines`'tan
   çıkmış gelir. `manual:havale` ve `manual:diger` online kalır. Kural sitenin `docs/PANEL-SALES.md`'sinde.
2. **`cafe.lines[].extraShots`**, **`syrups`** ve **`milks`** (laffogato #247): satırın seçenekleri, adetle çarpılmış.
   Panel bunları "Seçenekler"de yazılan ürünlere işler (alternatif süt inek sütünü azaltmaz).

## Kurulum

1. Karaoke bağlantısı kuruluysa ek bir şey gerekmez: aynı `KARAOKE_SYNC_SECRET` ve `LAFFOGATO_URL`
   ([KARAOKE.md](KARAOKE.md) › Kurulum). Migration gerekmez (kayıtlar `integration_state`'te).
2. Sitenin satış ucu yayında olmalı (laffogato `src/app/api/panel/sales/route.ts`).
3. Gelir-gider › **Siteden yenile**: bu ay ve önceki iki ay gelir; daha eskiler için **Başka bir ay**. Tutarlılıkta
   online tüketim için ürünlerin menüye bağlı olması gerekir (Ürünler › Site menüsü).

## Güvenlik ve kişisel veri

- İstek karaoke bağlantısının imzasıyla (`src/lib/karaoke/signature.ts`); sorgu dizesi imzanın içindedir, imzalanandan
  başka bir dönem istenemez.
- Yanıt sıkı doğrulanır (`src/lib/site-sales/schema.ts`): tanınmayan sürüm, istenen dönemden farklı `from` / `to`,
  eksi ya da kesirli tutar, bilinmeyen boy reddedilir (bütün ay; kâr-zararı sessizce yanlış bir ay, hiç çekilmemiş
  bir aydan kötüdür). Satır adları kısaltılır, bilinmeyen alanlar atılır.
- Siteden yalnız toplamlar ve ürün satırları gelir: müşteri adı, e-posta, telefon, adres, sipariş numarası yok.

## Sorun giderme

| Mesaj | Ne yapılır |
|-------|------------|
| Site 8 saniyede yanıt vermedi / Siteye ulaşılamadı | Geçici; **Siteden yenile** ile yeniden deneyin (önceki kayıt duruyor) |
| Site isteği reddetti (imza) | İki projedeki `KARAOKE_SYNC_SECRET` aynı mı, ikisi de yeniden yayımlandı mı, sunucu saatleri doğru mu? |
| Sitede panel satış ucu yok | laffogato.net güncel değil (satış bağlantısı yayımlanmamış) |
| Site dönemi kabul etmedi | Dönem bozuk (panel hatası); işlem geçmişiyle birlikte bildirin |
| Dönemde çok sipariş var | Sitenin sınırı (dönemde 20 000'den çok sipariş). Panel ayı gün gün bölmez; bu hacimde gün gün çekme eklenmeli |
| Sitede KARAOKE_SYNC_SECRET tanımlı değil ya da sitenin veritabanı okunamadı | Siteye değişkeni ekleyin; sürüyorsa sitenin günlüğüne bakın |
| Sitenin satış yanıtı … (sürüm / dönem / tutar) | Site sözleşmeyi değiştirmiş: paneli güncelleyin |

Kasa raporunda satır yoksa: bağlantı kurulu mu (Ayarlar › laffogato.net), site o an yanıt verdi mi? Satır
bilgidir; yokluğu raporu etkilemez.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/site-sales/schema.ts` | Sitenin yanıtının doğrulanması, ayın dönemi, saklanan kaydın okunması (saf) |
| `src/lib/site-sales/calc.ts` | KDV hariç gelir, çekilecek aylar, satır → ürün eşlemesi, kasa satırı ve zaman sınırı (saf) |
| `src/server/site-sales/sync.ts` | Ayları çekme ve saklama, durum, kasa satırının isteği; Marina'nın ayrı ay kaydı (tahmini stok) |
| `src/server/actions/site-sales.ts` | Siteden yenile (yönetici) |
| `src/app/api/cron/gunluk/route.ts` | Günlük işin online satış adımı |
| `src/lib/calc/engine.ts`, `insights.ts` | Kâr-zarar satırları ve toplam ciro; online tüketim; uyarı |
| `src/server/data/dataset.ts` | Kayıtların hesap motoruna verilmesi |
| `src/app/panel/gelir-gider/site-sales-card.tsx` | laffogato.net online satışları kartı |
| `src/app/panel/tutarlilik/` | Online tüketim kartı, "ModPOS · online" ayrımı |
| `src/app/panel/kasa/page.tsx`, `src/server/actions/cash-report.ts`, `src/server/notify/cash-report-template.ts` | Kasa raporu satırı, gönderim, e-posta |
| `tests/site-satis.test.ts` | Şema, KDV hariç formül, aylar, eşleme, kasa satırının zaman sınırı, motor satırları, kasada ödenen siparişler, seçenekler, okumanın imza vektörü (site aynısını tutar, laffogato #270) |
| `tests/genel-bakis-online.test.ts` | Genel bakış: online satışın reçeteye göre kârı, başabaş, ay sonu tahmini, kategoriler, zam etkisi |

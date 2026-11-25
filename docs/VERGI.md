# Vergi (tahmin, beyanname değil)

Sahibin isteği (24 Ekim 2026): "Köşeye bir de vergi gibi bir kısım açar mısın; oradan gelir-gider, kurumlar vergisi,
damga, hepsini Türkiye'ye göre hesaplasın ama dikkatli yap." Ekran **Vergi, KDV, SGK** (`/panel/vergi`, kenar
çubuğunda kendi grubu; yalnız yönetici). Plan ve kararların gerekçesi: [planlar/vergi.md](planlar/vergi.md) (K1–K34, §14 muhasebeciye sorulacaklar).

## 1. Amaç ve sınırlar

- **Her rakam tahmindir.** Sayfanın başındaki bant bunu söyler (`TAX_DISCLAIMER`): kesin tutar muhasebecinin
  beyannamesinde ve tahakkuk fişindedir; girildiğinde tahminin yerine geçer. Bant her sekmede tek satırdır ("Tahmin,
  beyanname değil" + ⓘ); tam metin ⓘ'de ve Muhasebeci'nin sonunda bir kez (§3.2).
- **Kafe payıdır.** Kurumlar ve geçici vergi şirketin bütün işleri için tek beyannamedir; panel yalnız kafeyi görür.
  Özet'teki **Şirketin kâr vergisi** kartı bunu ikinci cümlesinde söyler ("Rakamlar yalnız kafenin payı; şirketin
  vergisi muhasebecinin beyannamesindedir."); döküm satırı "Kafenin payı"dır, şirketin ödeyeceği tutar değil. Şirketin
  diğer gelir ve giderleri Vergi kârı › **Düzeltme ekle** ile girilir (kapsam çipi değişir).
- Her rakam dayanağını gösterir: formül, girdiler, oran, kanun maddesi, kaynak bağlantısı ve kural tablosunun
  derlendiği gün ("Nasıl hesaplandı").
- Beyanname hazırlanmaz, e-beyanname gönderilmez; danışmanlık yapılmaz. Belgesi olmayan ödemelerin kalem kalem
  listesi dışa aktarılmaz, işlem geçmişine yazılmaz.
- Eksik veriyle hesaplanan geçici ve kurumlar vergisi **Taslak**'tır; taslak tutar nakit planına ve takvimin tutar
  sütununa yazılmaz. (Ekranda rozeti "Eksik bilgi"; veri, Excel ve bu kural aynı, §3.3.)

## 2. Gelirin kaynağı (K11)

Vergi matrahı mali belgeye dayanır. Ay ay sıra:

1. **KDV beyannamesi:** muhasebecinin o ay için girdiği satış matrahları (%1, %10, %20, istisna; varsa "kafe dışı
   kısmı" düşülür). Şirketin tamamıdır; laffogato.net ve kafe dışı gelir o ay ayrıca eklenmez. Rozet "mali belge ·
   beyanname".
2. **Yazarkasa mali Z** (Dalga 13): ayın her açık günü için yazarkasa Z'si (KDV dökümüyle) varsa oran oran KDV hariç
   matrah toplamı (`okcMonth(…).complete`, `byRate[].base`; tahmini döküm kullanılmaz) + laffogato.net. Rozet "mali
   belge · Z".
3. **Yönetim verisi:** ikisi de yoksa kasa cirosu (Gelir-gider'deki ModPOS ya da LafPOS cirosu, KDV hariç) +
   laffogato.net, rozeti "Yönetim verisi (ModPOS), mali belge değil" (geçiş ayında "ModPOS ve LafPOS"). O çeyrek
   Taslak'tır ve Excel'e yazılmaz.

laffogato.net: sitenin KDV hariç toplamından iadesi bekleyen karaoke KDV hariç düşülür (`refundPendingMinor` KDV dahil,
karaokenin oranıyla bölünür), rozeti "yaklaşık; e-Arşiv tarihinden farklı olabilir". Kasa cirosu ile mali belge
arasındaki fark Vergi sayfasında, Excel'in Vergi sayfasında ve köprü kartında **hiç yazılmaz**; kasa cirosuna hiçbir
yerde "vergi esasında gelir" denmez.

## 3. Ekranlar

Kenar çubuğunda kendi grubu **Vergi, KDV, SGK** (29 Eki 2026, [planlar/ux-sade.md](planlar/ux-sade.md) §3, §7): dört
alt öğe ve aynı dört sekme (`SECTION_TABS.vergi`, ağaçtan türer). Özet'in H1'i grubun adıdır; telefonun üst çubuğu
"Vergi, KDV, SGK", "Vergi kârı", "Demirbaş", "Muhasebeci" yazar. ⌘K'da ayrıca "KDV" (`#kdv`), "SGK primi" (`#sgk`),
"Maaş vergileri (muhtasar)" (`#muhtasar`), "Kâr vergisi (geçici, kurumlar)" (`#kar-vergisi`), "Eksik belgeler"
(`#siniflandir`) ve "Muhasebeciye sorulacaklar" (`#sorular`) bulunur; eski adlar ("Vergiye göre", "Vergi kuralları",
"Demirbaş & amortisman") aramada `keywords` olarak kalır.

| Sekme | Ne var | Okuduğu |
|---|---|---|
| **Özet** (`/panel/vergi`) | Sıra §3.1'de: bant, Ödemeler'de günü geçmiş vergi satırı, iki rakam, Başlarken satırı, uyarılar, vergi ve SGK takvimi (önümüzdeki 100 gün; her satırda tek tutar ve kaynağı; açılınca döküm, "Ödemeler'e ekle", "Muhasebecinin rakamını gir"), şirketin kâr vergisi kartı, bordro dökümü | model, vergi girdileri, nakit planı (KDV satırları), Ödemeler |
| **Vergi kârı** (`/panel/vergi/gelir-gider`) | Sayfa başında eksik belgeler uyarısı (tutar ve kalem sayısı), seçilen çeyreğin ayları, çeyrek toplamı ve "Yılbaşından beri" (masaüstünde tablo, telefonda tek sütun seçicisi), **Gelir-gider'den neden farklı?** köprü kartı, KDV beyannamesi satışları kartı, **Eksik belgeler** listesi (`#siniflandir`; toplu kayıt, kaydedilmeden çıkışta uyarı, sabit giderde "Vergi kesintisi (stopaj)" profili), kafe dışı faturalar anahtarı, düzeltmeler | model, vergi girdileri (nakit planı yok) |
| **Demirbaş** (`/panel/vergi/demirbas`) | Demirbaş listesi ve amortisman, faturası Paraşüt'te silinen demirbaş ("Bağla"), listeye eklenmemiş Kuruluş & Demirbaş faturaları ("Listeye ekle"), "demirbaş olabilir" faturalar ("Bu yıl gider yaz", "Gider (demirbaş değil)", "Geri al") | model, vergi girdileri |
| **Muhasebeci** (`/panel/vergi/kurallar`) | Sıra: **Muhasebeciye sorulacaklar** (`#sorular`; "Muhasebecimle konuştum" işareti ve not), **Şirketin vergi ayarları** (şirket nasıl kuruldu, muhtasar dönemi, asgari ücret desteği), **Kural tablosu** (`#kurallar`; kapalı açılır "Kural tablosunu göster (n kural)", adres `#kurallar` ise açık gelir; güven, dayanak, kaynak, "Elle değer"), "Bu kafede hesaplanmayanlar" (`#bilgi`, açık), tam feragat (`#feragat`) | vergi ayarları ve Ayarlar (işveren SGK oranı) |

Ekranda "varlık" sözcüğü yok: Demirbaş sekmesi "demirbaş" der ("Demirbaş ekle", "Demirbaş listesi", "listede değil");
kayıt ve Excel'in yöntem adı (`ASSET_METHOD_LABELS`, "Doğrudan gider") aynı, ekranda "Bu yıl gider yazıldı".
İşaretler sahibindir; hiçbir yerde muhasebecinin tabloyu onayladığı yazmaz.

### 3.1 Özet'in düzeni

Sahip Özet'i açınca üç soruya ilk ekranda cevap alır: ne zaman, ne kadar (iki rakam ve takvim); KDV ödeyecek miyim
(KDV satırının kendisi); rakam neden yüksek ya da eksik (tek turuncu satır). Yukarıdan aşağı:

1. Başlık "Vergi, KDV, SGK", tek cümle açıklama ("Devlete ödenecekler: KDV, SGK, maaş vergileri ve kâr vergisi;
   tahmini tutar ve son gün."), sekmeler.
2. Bant (§3.2).
3. **Ödemeler'de günü geçmiş vergi ödemesi** (§3.4), yalnız varsa.
4. **İki rakam** yan yana (telefonda da): Sıradaki ödeme · Önümüzdeki 30 gün. Hazırlık karosu kalktı;
   `view.stats.readiness` hesaplanmaya devam eder, sayı Başlarken satırında.
5. **Başlarken** tek satır (`<details>`): "Başlarken: 2 / 4 · sıradaki: {adım}" (telefonda yalnız sayı); açılınca
   açıklama ve dört adım. Hepsi bitince "Hazırlık tamam · yeniden aç".
6. Özet uyarıları (muhasebecinin rakamı ile Ödemeler'deki tutar farkı, faturası silinen demirbaş): tek turuncu `Notice`,
   ilk uyarı başlık, kalanı Ayrıntı; faturası silinen demirbaş varsa "Demirbaş'ı aç".
7. **Vergi ve SGK ödemeleri** takvimi (§3.3) ve yanında (telefonda altında) **Şirketin kâr vergisi** kartı (§3.5).

Veri yoksa başlık, bant ve "Hesap için veri yok" kartı. Sondaki tam feragat Özet'ten kalktı.

### 3.2 Bant: her sekmede tek satır

`TaxBanner` kutusuz tek satırdır (`role="note"`, "Vergi tahmini hakkında"): **"Tahmin, beyanname değil"**
(`TAX_DISCLAIMER_SHORT`) + ⓘ (tam metin: `TAX_DISCLAIMER`, kuralların derlendiği gün, bayatlık cümleleri) · kapsam
çipi ("Kapsam: yalnız kafe" + ⓘ) · masaüstünde "Muhasebeciye sorulacaklar: n / 8" çipi (telefonda sekme aynı yere
gider). Kural tablosu 90 günden eskiyse ya da yılın tablosu yoksa bandın altında ayrı turuncu satır: "Vergi kuralları
güncel olmayabilir" (Ayrıntı: bayatlık cümleleri; eylem "Kural tablosu" → `#kurallar`). Tam feragat (`DisclaimerBody`)
yalnız Muhasebeci'nin sonunda (`#feragat`), her genişlikte.

### 3.3 Takvim satırı

Kart **"Vergi ve SGK ödemeleri"**, açıklaması "Önümüzdeki 100 gün, yasal son günle. Satıra dokunun: döküm ve dayanak.".
Satırın adı sözlükten (`calendarTitle`, §3.6): "KDV (Ekim satışları)", "SGK primi (Eylül maaşları)", "Maaş vergileri
ve stopaj (muhtasar, Ekim)", "Kâr vergisi peşinatı: 3. çeyrek 2026 (geçici vergi)", "Yıllık kâr vergisi 2026
(kurumlar vergisi)", "Çevre temizlik vergisi (ÇTV) 2026, 2. taksit", "Tabela vergisi (ilan ve reklam vergisi)"; KDV-2
aynı. Veri (`titleOfKind`) ve Excel resmî adla kalır.

- **Rozetler (K16):** tahminde rozet yok (`≈` yeter); "Muhasebeciden" (yeşil), "Eksik bilgi" (turuncu; veride
  "Taslak"), "yalnız damga" (gri; veride "sabit tutar", beyanname damgası). "Ödemeler'de" ve "2026 kuralları" (tablosu
  olmayan yıl) rozet değil, satırın alt satırında söz ("Ödemeler'deki tutar", "geçen yılın damga tutarıyla"). Kâr
  vergisi kartında "Ödemeler'de" rozet kalır (büyük rakamın kaynağıdır).
- **KDV satırı kendi cevabını yazar (K13):** ödenecek KDV yoksa kapalı satırın alt satırı **"Ödeme yok"** ve
  devreden varsa **"≈ X ₺ sonraki aya geçer"** (`row.carryOut`); tutar sütunu damga + "yalnız damga". Açık gövdede
  "Ödeme beklenmez (devreden); yalnız damga." notu (`NOTE_VAT_NONE`, veride aynı) çizilmez. Tek düğme **"Döküm ve
  devreden KDV"** → Nakit planı `#kdv`.
- **Gün farkı:** Ödemeler'deki hatırlatıcının günü yasal günden farklıysa alt satır "Ödemeler'de 26 Ekim" der
  (`row.reminderDue`; KDV, KDV-2, muhtasar, SGK). SGK hatırlatıcısı ayın 26'sında, yasal son gün izleyen ayın sonu.
- **Muhtasar:** tutar "en az" ise kapalı satır "{n} giderde vergi kesintisi (stopaj) seçilmedi" der
  (`row.unknownWithholding`); açık gövdede "Kesintiyi seç" → Vergi kârı `#siniflandir`.
- Döküm etiketleri sade (`plainLabel`): "Bu ayın KDV'si (tahmin)", "Beyanname ücreti (damga vergisi)".
- "Sonra" kutusu takvimin altında tek satır, tarih sırasıyla: "Sonra: {ad} · {gün}"; kurumlar vergisinde "tahmin
  kartta" → `#kar-vergisi` (yalnız kartın yılıysa; §3.5).
- Çapalar: her türün ilk satırı `#kdv`, `#sgk`, `#muhtasar`.

### 3.4 Ödemeler'de günü geçmiş vergi satırı (K12)

`overdueTaxReminders` (`src/lib/tax/overdue.ts`; yeni sorgu yok, `loadTaxView`'un okuduğu hatırlatıcılar): etkin,
günü bugünden önce ve sınıfı vergi ya da SGK olan hatırlatıcılar, güne göre (Ödemeler'in "Gecikti" grubuyla aynı
kayıtlar). Varsa bandın altında turuncu, katlanmayan (`risk="para"`) tek satır: "Ödemeler'de günü geçmiş vergi
ödemesi: SGK prim ödemesi" (birden çoksa "Ödemeler'de günü geçmiş 2 vergi ödemesi"), ikinci satırda adları ve
günleri (en çok 3, fazlası "+k"), Ayrıntı'da yasal son günü bugünden sonra olanlar için "SGK prim ödemesi: Ödemeler'deki
gün 26 Ekim, yasal son gün 2 Kasım."; eylem "Ödemeler'de aç". Kırmızı değil: Ödemeler'deki gün çoğu zaman yasal
günden erken. Kırmızı ve "Ödedim" düğmesi Ödemeler'de; ödenince satır kalkar.

### 3.5 Şirketin kâr vergisi kartı (K14)

Geçici vergi ve kurumlar vergisi tek kartta (`ProfitTaxCard`, `#kar-vergisi`): başlık "Şirketin kâr vergisi (2026)",
iki cümle açıklama (3 ayda bir peşin, Nisan'da yıl kapanır; rakamlar yalnız kafenin payı). Peşinatın çeyreği kartın
yılında değilse (Ocak–Nisan'da kart geçen yılı kapatırken peşinat bu yılın çeyreği; `?yil=` başka bir yıl) başlık
yılsız "Şirketin kâr vergisi", iki bölüm kendi yılını taşır (`profitTaxTitle`). Geçici vergide belgesi seçilmemiş gider
ya da demirbaş adayı fatura varsa (`geciciCard.missingDocs`) ve muhasebecinin rakamı yoksa kartın başında turuncu "Eksik
belgeler var: rakam yüksek çıkabilir" (ikinci satır: henüz hesaba girmeyen gider ve demirbaş adayı, yalnız sıfır
olmayanlar; eylem "Belgesini seç" → `#siniflandir`). Eksik bilginin öteki sebepleri (gelir belgesi, kafe dışı işler)
uyarı değil, bölümün "Eksik bilgi" rozeti. İki bölüm: **Peşinat** (geçici vergi, `#gecici`): rozet, büyük rakam, döküm
(sade etiketler; devreden zarar ya da indirim varsa kazançla "× %25" arasında "Önceki yılların zararı", "İndirim" ve
"Vergi hesabındaki kâr (matrah)" satırları, oran matrahın vergisidir; denetim VG-07), notlar, "Muhasebecinin rakamı",
"Vergi kârını aç", "Nasıl hesaplandı"; **Yıl sonu** (kurumlar
vergisi): rozet, alt başlık, döküm ("Ödenecek" satırı), notlar, "Muhasebecinin rakamı", "Nasıl hesaplandı". Veri
(`view.geciciCard`, `view.kvCard`) aynı; `missingDocs` yalnız eklendi. Takvimin "Sonra" satırındaki kurumlar vergisi
"tahmin kartta" bağlantısını yalnız kartın yılıysa taşır (`laterOnCard`); değilse "Tutarı bilinmiyor".

### 3.6 Sözlük (`src/lib/tax/glossary.ts`, K17)

Ekranda ilk geçtiği yerde "sade söz (resmî terim)", sonra yalnız sade söz. Ekrandaki sözleri `calendarTitle` (takvim
satırının adı), `PLAIN_LABELS` / `plainLabel` (döküm etiketleri), `badgeLabel` / `badgeNote` (rozet ve alt satır) ve
`plainBadge` (Vergi kârı'nın kaynak rozeti) verir. `TERMS` (resmî terim → { ekranda, tanım }) başvuru tablosudur; ⓘ
tanımları henüz çizilmiyor (`docs/planlar/ux-sade.md` Ek C). Tablo:
Hesaplanan KDV → "Satışlarda topladığınız KDV" · İndirilecek KDV → "Alışlarda ödediğiniz KDV" · Devreden KDV →
"Önceki aylardan kalan KDV (devreden)" · Muhtasar → "Maaş vergileri ve stopaj (muhtasar)" · Stopaj → "Vergi kesintisi
(stopaj)" · Tahakkuk fişi → "Ödeme belgesi (tahakkuk fişi)" · Beyanname damgası → "Beyanname ücreti (damga vergisi)" ·
Geçici vergi → "Kâr vergisi peşinatı (geçici vergi)" · Kurumlar vergisi → "Yıllık kâr vergisi (kurumlar vergisi)" ·
Mahsup → "Düşülür (mahsup)" · Matrah → "Vergi hesabındaki kâr (matrah)" · Kurum kazancı (kümülatif) → "Yılbaşından
beri kâr (kurum kazancı)" · Amortisman → "Demirbaş payı (amortisman)" · Faydalı ömür → "Kaç yıl kullanılacak (faydalı
ömür)" · Özel maliyet → "Kiralık yere yapılan tadilat (özel maliyet)" · Tevkifat → "Faturadaki KDV'nin sizin
ödediğiniz kısmı (tevkifat)" · Sınıflandırılmamış gider → "Belgesi seçilmemiş gider" · Yönetim verisi (ModPOS) →
"Kasa programının rakamı (ModPOS)" (gri kaynak rozeti, uyarı değil) · Taslak → "Eksik bilgi". Yardımcılar
`calendarTitle`, `plainLabel`, `badgeLabel`, `badgeNote`, `plainBadge`. Yalnız çizimdir: veri, Excel dışa aktarımı ve
kayıtlar resmî adla kalır (muhasebeciye o gider). "Eksik bilgi: …" sebepleri (`stateReasons`, ör. "Sınıflandırılmamış
gider var", "Faydalı ömrü girilmemiş varlık var") resmî sözle kalır (`docs/planlar/ux-sade.md` §7.6, §7.7 aynen ister);
takvimin "Tahakkuk fişindeki tutarı girin"i (`ASK_TAHAKKUK`) de henüz sözlükten geçmiyor. Yalnız yöneticinin vergi ekranları içe aktarır (takvim, kâr vergisi kartı, Vergi kârı tablosu); Nakit planı KDV
kartı aktarmaz, personel dosyaları da aktarmaz (`tests/satis-kaynagi.test.ts`). Kanun kısaltmaları (VUK, KVK, GVK …) yalnız
"Kullanılan kurallar ve kaynaklar" açılırında.

### 3.7 Diğer kurallar

Muhasebecinin rakamı kaldırılınca Ödemeler'deki tek karşılığın tutarı kaydın ödenecek + damgasına eşitse (pencerenin
"Ödemeler'deki hatırlatıcıya da yaz" kopyası) o tutar da silinir: "Kaldırıldı; tahmin kullanılıyor · Ödemeler'deki tutar
da silindi". Başka bir tutar yazılmışsa kalır ve takvim onu kullanır: "Kaldırıldı; Ödemeler'deki tutar kullanılıyor".
Onay penceresi bunu önceden söyler ("Ödemeler'deki tutar (41.991 ₺) bu kaydın yazdığı kopya; o da silinir." ya da
"… kalır; nakit planı ve takvim onu kullanır."). Pencere yalnız seçeneklerindeki dönemleri açar: takvimin gelecek
muhtasar satırında "Muhasebecinin rakamını gir" yoktur.

Takvim ve kartlarda kaynakların önceliği her yerde muhasebeci › Ödemeler › tahmin (K4): geçici ve kurumlar vergisi
kartı, kayıt yokken Ödemeler'deki tutarı büyük satır yazar ("Ödemeler'deki tutar 50.000 ₺", rozet "Ödemeler'de";
kafenin katkısı alt satırda). İkisi 1 ₺'den fazla farklıysa Özet'in uyarı satırı (§3.1, madde 6) ("Geçici vergi 2026/3:
Ödemeler'deki tutar (40.000 ₺) muhasebecinin rakamından (41.991 ₺) farklı; …"), takvim satırında sarı not ve nakit
planının satırında not ("Muhasebecinin rakamı 41.991 ₺, Ödemeler'deki tutar 40.000 ₺: nakit planı Ödemeler'dekini
kullanıyor."). Faturası Paraşüt'te iptal edilen demirbaş da aynı satırda uyarır ("Demirbaş'ı aç"); çift sayım yalnız
aday fatura gerçekten gider sayılıyorsa yazılır ("demirbaş olabilir" ve hesap döneminden önceki fatura sayılmaz).

Takvimin satırları nakit planıyla aynı kuralla düşer ve kalır:
- **Ödendi** denen dönem (son ödenenler; geçici vergide kalıcı kayıt da) satır olmaz: muhtasar, SGK, geçici vergi,
  KDV ve KDV-2. "Sıradaki ödeme" ve "Önümüzdeki 30 gün" onu saymaz.
- Sabit tutarlı hatırlatıcının ("SGK prim ödemesi", "Kira stopajı") tutarı her döneminde Ödemeler'dedir; muhtasar, KDV
  ve geçici vergi hatırlatıcısının tutarı yalnız sıradaki dönemindir.
- Ödeme günü gelmiş, yasal son günü gelmemiş KDV ve KDV-2 (28'i Cumartesi olan KDV, 25'i Pazar olan KDV-2) son güne
  kadar tutarıyla kalır; nakit planı onu planlamaz (bugünün ödemesi eldeki paradan, `plan.vat.onDue`), satırın notu
  "Ödeme günü (25 Ekim) geldiği için nakit planında yok; eldeki paradan ödenir.".
- Kayan muhtasar ve geçici vergi günü ayrıntıda "Nakit planında 26 Aralık'ta." der.
- Kesin tutarlar (muhasebeci, Ödemeler'deki, sabit tutar) üç rakamda da `≈` almaz ("791 ₺ · KDV · 28 Ekim").
- Geçici vergi kartı 1 Ocak–17 Şubat arasında geçen yılın 4. çeyreğidir (beyannamesi sıradaki).
- Sınıflandırma başlığındaki ve kartın alt satırındaki kalem sayısı çeyreğindir ("Bu çeyrekte 808.610 ₺ gider
  sayılmadı (15 kalem)"); Başlarken yılın bütün kalemlerini sayar ("26 kalem kaldı").

Diğer ekranlara dokunuşlar:
- **Gelir-gider:** başlığın altında "Vergi hesabındaki karşılığı: Vergi, KDV, SGK › Vergi kârı". Ayarlar'daki işveren SGK oranı
  vergi ve nakit planının oranından farklıysa uyarı (K19): "Ayarlar'da işveren SGK %15,75. 2026'da imalat dışı
  işyerinde 2 puan indirimle standart oran %19,75; …". Muhasebeciye sorulacaklar › SGK oranı işaretlenince
  **Ayarlar'daki oranı %19,75 yap** düğmesi çıkar; onaydan sonra yalnız işveren SGK oranı yazılır (geçmiş ayların
  gelir-gideri de değişir). Kendiliğinden değişmez.
- **Ödemeler:** `?yeni=<şablon>` ekleme sayfasını şablonla dolu açar (takvimdeki "Ödemeler'e ekle"); yeni şablonlar
  Kurumlar vergisi, ÇTV 1. ve 2. taksit, İlan-reklam. "Muhtasar" ya da "geçici vergi" geçen tekrarlı hatırlatıcının
  tutarı tek döneme aittir: **Ödendi** ve **Ertele** onu seriden siler ("Muhtasar tutarı her ay değiştiği için silindi ·
  Geri al"); sabit tutarlı "Kira stopajı"nın tutarı kalır. Geçici vergi hatırlatıcısının Ödendi'si kalıcı kayda yazılır
  (`payments.vat-paid`, tür `gecici`, dönem `2026-Q3`): yıllık kurumlar vergisinde yalnız ödendi işaretli geçici
  vergi mahsup edilir.
- **Excel:** "Vergi" sekmesi (§8).
- **Yardım:** "Vergi sayfasındaki rakamlar beyanname mi?" (Gider, ödeme ve ekip).

## 4. Hesaplar (kısaca; formüller planın §3'ünde)

- **Gider, belge esası (K12):** kafe faturaları fatura tarihine göre; mal faturaları satılan mal maliyetine (devir +
  alış − çeyrek sonu sayımı; çeyrek sonunda sayım yoksa en son sayım, kırmızı uyarıyla), diğerleri döneme. Fatura
  dışı her kalem (sabit gider, Aylık harcamalar kategorisi, Gelir-gider'in elle satırı) **vergi belgesine** göre
  sayılır: "Paraşüt'te faturası var" (sayılmaz, faturası sayılıyor), "Belgesi muhasebecide" (sayılır; fişliler KDV
  hariç tahminle), "Belgesi yok" (sayılmaz). Personel bölümünde "Bordroda" (Maaşlar'a ekleyin) ve "Dışarıdan hizmet".
  **Seçilmemiş kalem sayılmaz** ve hesap Taslak kalır. Kasadan çıkan fatura / e-Arşiv satırı, faturası Faturalar'a
  gelmişse "Paraşüt'te faturası var" sayılır (denetim B17'nin iki kez sayılan listesi).
- **Demirbaş olabilir:** mal, komisyon, kira ve kafe dışı dışındaki kategoride KDV hariç 12.000 ₺'yi aşan, aynı
  tedarikçiden aynı kategoride önceki 90 günde faturası olmayan fatura; karar verilene kadar sayılmaz.
- **Demirbaş denen kalemler** (25 Kasım 2026): Paraşüt'te "Hammadde değil · Demirbaş" denmiş kalemi olan fatura (ör.
  hammadde faturasındaki 10.000 ₺'lik tüplü ısıtıcı; `lineAssetCandidates`) Vergi › Demirbaş'ta öneri olarak çıkar,
  sınırın altında da: sahip **Listeye ekle** der ya da "Gider (demirbaş değil)". Listeye eklenene kadar kalemin payı gider
  sayılır (kalem kalem sınıflandırma, [PARASUT.md › 5f](PARASUT.md)).
- **POS komisyonu (K12a):** Gelir-gider'deki `commission:pos` hücresi (elle girildiyse banka dekontu, değilse banka
  kartı payıyla tahmin; denetim B16'nın kuralı). Yemek kartı komisyonu Faturalar › Komisyon'da.
- **Amortisman (K14):** yalnız normal yöntem, yıllık = maliyet ÷ ömür, edinilen yıl tam yıl; geçici vergi dönemine
  dağıtım ayarla ("kalan çeyreklere eşit", varsayılan, ya da "kümülatif ay ÷ 12"). Ömür girilmezse amortisman 0 ve
  uyarı; varsayılan ömür uydurulmaz. 12.000 ₺'yi aşmayan varlık doğrudan gider seçilebilir (VUK 313).
- **Bordro (K16):** netten brüt (kümülatif gelir vergisi matrahı, asgari ücret istisnası, ücret damgası, PEK alt ve üst
  sınırı), 2026 yasal SGK oranlarıyla (işçi %14 + %1, işveren %19,75 + %2; teşvik varsa Muhasebeci'den elle). Gelir-gider
  Ayarlar'daki oranla kalır (Excel eşitliği). "Asgari ücret desteği SGK'dan düşülsün" açıksa destek ödenen SGK'dan
  düştüğü kadar Vergi kârı'nın "Personel (bordro)" giderinden de düşer (satırın notu; denetim VG-08).
  **Faz 5 (23 Kasım 2026):** yemek kartı işaretli kişinin yemek kartı (Ayarlar › Personel yemek kartı: günlük 330 ₺ × 26
  gün) bordroda **ek ödeme gibi** girer: vergisiz, brütleştirilmeden maliyete; yasal brüt, SGK, GV ve DV değişmez
  (`src/lib/tax/payroll.ts` taxPayrollFromModel; kartın vergi ve SGK istisna sınırı aşılıyorsa muhasebeciye sorulur).
  **Part-time** kişinin (Maaşlar › Çalışma: Part-time) günlük ücreti işletmenin gün başına maliyetidir, yasal bordroda
  **brütleştirilmez**: brüt 0, ücret × Vardiya'daki çalışma günü + yemek kartı × gün + ek ödeme bütün maliyet olarak ek
  ödeme gibi girer (asgari ücret desteği ona yazılmaz); bordro ayın Vardiya planındaki bütün çalışma günleriyle (süren
  ayda ileri günlerin planı dahil) hesaplanır. Günlük ücretin brüt mü net mi olduğu sahibin teyidini bekler (PR notu).
- **Muhtasar (K20):** ay P'nin ücret gelir ve damga vergisi + sabit giderin stopaj profiline göre stopaj (kira %20,
  serbest meslek %20, internet reklamı %15) + beyanname damgası (personel varsa 939,70, yalnız stopajda 791,00);
  P+1'in 26'sında. Adı kira, reklam ya da dışarıdan hizmete uyan profilsiz kalem varsa tutar "en az"dır. Ödemeler'de
  sabit tutarlı "Kira stopajı" hatırlatıcısı varsa takvim satırı = hatırlatıcının tutarı + tahminin kira stopajı dışı
  kalanı (döküm "Kira stopajı (Ödemeler'deki hatırlatıcı)"; "en az" kalır; denetim VG-02). Üç aylık muhtasarda çeyrek
  sonunun kira stopajı üç ayınkidir ("Çeyreğin önceki ayları" satırında kira stopajı düşülmüş kalan). Muhtasarın tamamı
  da Ödemeler'deyse satır onu yazar, not kira stopajı hatırlatıcısının onun içinde sayıldığını söyler.
- **Resmi kira (sahibin kararı, 4 Kasım 2026):** Sabit giderler'de kira kalemine resmi (sözleşmedeki) aylık kira ve
  brüt / net yazılır (net: brüt = net ÷ 0,8). Gelir-gider'de "Kira stopajı" satırı = resmi brüt × kira stopajı oranı
  (`stopaj:<kalem>`; kiranın gün payıyla). Vergi kârında kira gideri yalnız resmi brüttür; ödenen kira + stopaj −
  resmi brüt "belgesiz, vergide sayılmaz" (Belgesi yok listesinde), stopaj ayrıca gider yazılmaz. Muhtasarın kira
  stopajı resmi brütten (profil seçilmemiş olsa da); nakit planında genel muhtasar satırından ayrı "Muhtasar – kira
  stopajı (Ay)" satırı, P+1'in 26'sında (muhasebecinin rakamında ve üç aylıkta bölünmez). Ev sahibine ödenen tutardan
  stopaj düşülmez. Resmi kiranın tutar geçmişi yok: değişince bütün aylar için geçer. Kira kalemi varsayılan olarak
  açık güne göre oranlanmaz (tam ay; süren ayda bugüne kadarki pay); migration `drizzle/0052_kira_resmi_stopaj.sql` elle
  eklenmiş "Kira stopajı" kalemini kira kalemine taşır.
- **Kira ev sahibi türü (Faz 5, 23 Kasım 2026):** kira kaleminde "Ev sahibi" seçilir (`fixed_expenses.landlord_type`;
  `src/lib/constants.ts` fixedVatRate, `engine.ts` officialRentGross, `tax/muhtasar.ts`, `cash-plan.ts`):
  - **Şahıs:** KDV hiçbir yerde yok (kalemde %20 yazılı ya da bölümün varsayılanı olsa da nakit planı KDV eklemez);
    stopaj %20 **resmi kiradan** (resmi tutar + brüt / net), tek kaynak: Gelir-gider'in stopaj satırı ve muhtasarın
    matrahı aynı tutar. Resmi kira yazılmamışsa tutar brüt sayılır, stopaj ödemeden kesilir (bankadan %80) ve muhtasara
    girer (ayrı stopaj satırı yok). Sabit tutarlı "Kira stopajı" hatırlatıcısı muhtasarın yalnız kira stopajının yerine
    geçer (VG-02), iki kez sayılmaz; "Kira stopajı" adlı ayrı bir **sabit gider** de sayılıyorsa stopaj hücresi ve Genel
    bakış uyarır ("Kira stopajı iki kez sayılabilir"; tutar kendiliğinden değişmez).
  - **Şirket:** %20 KDV (nakit planı KDV dahil öder: 160.000 → 192.000; indirilecek KDV kira faturasıyla Paraşüt'ten),
    stopaj yok (resmi kira yazılı olsa da), belgesi fatura sayılır: muhtasar "en az"a düşmez.
  - **Seçilmedi:** bugünkü kural (KDV kalemden ya da bölümden, stopaj Vergi'deki profilden ve resmi kiradan).
  Kalemin şubesi (Tuzla'nın kirası Tuzla'ya) Sabit giderler'de seçilir; kayıt sahibinindir.
- **SGK:** bordronun dört payı, P+1'in son günü (tatilde ilk iş günü).
- **Geçici vergi (K21):** kümülatif, %25; asgari kurumlar vergisi (%10) muafiyet yoksa karşılaştırılır; önceki
  dönemler düşülür. Muhasebecinin matrahlı kaydı **çapa**dır: sonraki dönem o matraha çapadan sonraki ayları ekler.
  Kayıttaki matrah beyannamedeki matrahtır ("Geçici vergi matrahı (zarar ve indirim düşülmüş; zararda eksi)"; sahibe
  soru 3'ün varsayılanı, denetim VG-03): çapanın kurum kazancı geri kurulur (`anchorIncome`: matrah artıysa yılın
  devreden zararı ve çapaya kadarki indirim eklenir, eksiyse eklenmez, sıfırsa panelin o çeyrekteki kazancı), zarar ve
  indirim bir kez düşülür. "Nasıl hesaplandı" bu ekleneni ayrı satırda yazar. Son çeyreğin matrahlı kaydı yıllık
  kazancın çapasıdır, aynı kuralla; kurumlar vergisi kaydının "Kurum kazancı" zarar düşülmemiştir.
  Süren dönem ay sonuna tamamlanmaz. Taslak çeyrekte kartın başlığı "Giderler sınıflandırılınca netleşir · şimdilik en
  çok ≈ X ₺" der.
- **Kurumlar vergisi:** yıllık kazanç (kayıt varsa onun kurum kazancı), devreden zarar, %25 ya da asgari; yalnız **ödendi**
  işaretli geçici vergi mahsup edilir. Damga: beyanname + bilanço + gelir tablosu (2026: 2.516,30).
- **Asgari kurumlar vergisi muafiyeti (K10):** yalnız Muhasebeci › Vergi ayarları'nda şirket "ilk defa faaliyete
  başladı" seçilince; varsayılan uygulanmaz (vergi yüksek görünür).
- **KDV (K5):** yeni KDV hesabı yok; takvim nakit planının KDV ve KDV-2 tahminini okur. Yurt dışı hizmet profilli
  sabit giderin KDV-2'si ayrı satırdır; aynı ay nakit planının KDV tahmininde indirilecek KDV'ye eklenir (VG-04).
- **Yerel vergiler (K23):** ÇTV ve ilan-reklam hesaplanmaz; hatırlatıcı yoksa takvimde tutarsız satır ("tutar
  belediyeden").
- **Takvim (K24):** son gün VUK 18'le kaydırılır (hafta sonu, resmî tatil, bayram; arife kaydırmaz; tatil listesi
  `TR_CALENDAR`, 2028 sonuna kadar). Nakit planı nominal günde öder, alt yazısı yasal günü söyler.
- **Yuvarlama (K27):** tahmin `≈` ile, 1.000 ₺ ve üstü 100 ₺'ye; döküm kuruşlu.

## 5. Kural tablosu ve güncelleme

Oranlar, eşikler, maktu tutarlar ve günler tek dosyada: `src/lib/tax/rules-2026.ts` (yapı `src/lib/tax/rules.ts`).
Her kuralda dayanak, kaynak bağlantıları (resmî olan önce), güven (kesin / muhtemel / belirsiz), geçerlilik başı ve
gerekiyorsa muhasebeciye sorulacak madde var. `RULES_COMPILED_AT = "2026-10-24"`, `RULES_VERIFIED_AT = null`: değerler
resmî kaynakların ve bültenlerin özetlerinden derlendi; 28 Ekim'de resmî kaynaklarla yeniden karşılaştırıldı,
düzeltilecek değer çıkmadı ama resmî PDF'lerin kendisi açılamadığı için "karşılaştırıldı" denmedi. Tablo 90 günden
eskiyse ya da bakılan yılın tablosu yoksa bant söyler; tablosu olmayan yıl son bilinen yılın değerleriyle "2026
kuralları" rozetini taşır.

Elle değiştirilebilenler (Muhasebeci › "Elle değer", not zorunlu): `sgk.isverenOran` (teşvik, en çok %21,75),
`damga.gecici`, tahmini yılda beyanname ve mali tablo damgaları.

**Yeni yıl:** `src/lib/tax/rules-2027.ts` yazılır (2026 dosyasını kopyalayıp değerleri ve kaynakları güncelleyin),
`TAX_RULES`'a eklenir, `RULES_COMPILED_AT` o gün olur, testler (`tests/vergi-*.test.ts`) yeni yılın değerleriyle
güncellenir. Resmî metinlerle tek tek karşılaştırılınca `RULES_VERIFIED_AT` doldurulur, bant "karşılaştırıldı" der.

## 6. Muhasebeciye sorulacaklar

Muhasebeci › Muhasebeciye sorulacaklar (`ACCOUNTANT_CHECKS`, `src/lib/tax/checks.ts`). Sekiz **temel** madde
işaretlenmedikçe çip "Muhasebeciye sorulacaklar: n / 8" der; hepsi işaretlenince "Muhasebecinizle gözden geçirildi
(sahibin işareti)". Temel maddeler: şirketin kuruluşu (asgari kurumlar vergisi muafiyeti, MERSİS ile vergi
numarasının uyuşmaması), SGK oranı, bordro, kira (kime ödeniyor, gerçek kira, sözleşme damgası), stopaj (Instagram,
influencer, muhasebeci), demirbaş (XND faturaları, ömürler, özel maliyet), geçici vergi 2026/2 ve 2026/3, kafe dışı
işler. Ek maddeler: muhtasar dönemi, KDV beyannamelerinin satışları, fişli alımlar, ikram ve zayi, asgari vergide zarar,
asgari ücret desteği, damga tutarları, ortaklar, alkol ve turizm, yerel vergiler ve adres. Metinler planın §14'ünden;
"Panelin varsaydığı" panelin kuralını söyler, verinin o günkü rakamını değil (denetim VG-05). Ayara bağlı cümleler
şimdiki ayarlardan kurulur (`accountantChecksFor`): şirketin kuruluşu ve hesap döneminin başı, işveren SGK oranı (elle
değerle; Ayarlar'daki oran farklıysa söyler), amortismanın dağıtımı, kafe dışı faturalar, muhtasarın dönemi, asgari
ücret desteği ve yılın beyanname damgaları. Asgari vergide zarar sorusu muaf yıllarda "etkisi ancak 2029 ve sonrasında" der.

## 7. Saklama

| Yer | Ne |
|---|---|
| `tax_filings` | Muhasebecinin rakamları: geçici vergi (`2026-Q3`), kurumlar vergisi (`2026`), muhtasar ve prim hizmet (`2026-09`), KDV beyannamesi satışları (`2026-09`); ödenecek, damga, isteğe bağlı döküm (matrah, hesaplanan …), not, giren. Tür + dönem tekil |
| `tax_adjustments` | Düzeltmeler: kafe dışı gelir ve gider (ay ya da çeyrek), belgeli gider, indirilemeyen gider, diğer gelir, indirim |
| `tax_assets` | Demirbaş listesi: ad, bağlı fatura (silinirse künyesi kalır), edinme günü, maliyet, tür, yöntem, ömür |
| `fixed_expenses.tax_doc`, `.tax_withholding`; `expense_categories.tax_doc`; `invoices.tax_not_asset` | Sınıflandırma, stopaj profili, "Gider (demirbaş değil)" |
| `integration_state` › `tax.settings` | Vergi ayarları, elle değerler, Gelir-gider elle satırlarının belgesi, muhasebeciye sorulanların işaretleri |
| `integration_state` › `payments.vat-paid` (tür `gecici`) | Ödendi işaretli geçici vergi dönemleri |

Migration `drizzle/0045_vergi.sql` (yalnız ekleme). Yedek yeni tabloları kendiliğinden alır. **`npm run db:reset`:**
demirbaş listesi faturalara bağlı olduğu için faturalarla silinir (komut silmeden önce kaç varlık olduğunu yazar;
yedekte durur); sabit giderler Excel'den sınıflandırmasız gelir, `invoices.tax_not_asset` faturalarla gider.
Muhasebecinin rakamları, düzeltmeler, aylık harcama kategorilerinin belgesi ve vergi ayarları kalır.

## 8. Nakit planıyla ilişki ve nakit planını okuyan yüzeyler (K25, K29)

Vergi nakit planına bir besleme verir (`taxPlanFeed`; ayrıntı [NAKIT-PLANI.md](NAKIT-PLANI.md) › Muhtasar, geçici
vergi ve damga): muhtasar tahmini (ayın 26'sı, bilinmeyen stopaj varsa "en az"), geçici vergi (yalnız tutarı
Ödemeler'e ya da Vergi'ye yazıldıysa ya da çeyrek **Hazır**sa; değilse "Tutarı girilmemiş ödemeler"de), yurt dışı
hizmetin KDV-2'si, KDV beyannamelerinin damgası. SGK yasal oranlı bordrodan; stopajlı sabit gider net ödenir. Hepsi
Tahmine katılanlar'daki tek **Muhtasar, geçici vergi ve damga** anahtarıyla kapatılır.

Nakit planını okuyan her yüzey bu satırları görür: Genel bakış'ın nakit kartı, haftalık özetin "ilk eksi gün"
maddesi ([HAFTALIK-OZET.md](HAFTALIK-OZET.md)), Claude'un nakit planı aracı. Zil, sabah e-postası ve Bugün
değişmedi. Besleme hesaplanamazsa plan vergisiz, bugünkü gibi çalışır (`console.error`): stopajlı ve yurt dışı sabit
gider de bugünkü gibi brüt, faturasının KDV'siyle ödenir (muhtasar ve KDV-2 satırı olmadığı için stopaj kaybolmaz).

**Excel "Vergi" sekmesi** (`src/app/api/export/workbook.ts` › `addTax`): ilk satır "Tahmin; beyanname değildir.
Kafenin payı; şirketin beyannamesi muhasebecidedir." Bloklar: ay ay vergiye göre gelir-gider ve çeyrek toplamı
(yalnız geliri mali belgeden gelen aylar; diğerlerinin yerine "Gelir mali belgeden girilmedi; hesap ekranda
(taslak)"), geçici ve kurumlar vergisi satır satır formülüyle (hesap döneminin başından ya da çapadan beri her ay mali
belgeliyse), takvim, kullanılan kurallar ("Derlendi 24.10.2026; resmî metinlerle karşılaştırılmadı"), sahibin notları.
Biten ve hiç hareketi olmayan ay (gelir de gider de 0; açılıştan önceki 25–30 Haziran gibi) belge beklemez: gelir
kaynağı "gelir yok", yönetim verisi satırı yazılmaz, sonraki çeyreğin kümülatif hesabını da kapatmaz (`emptyMonth`,
`revenueDocumented`; aynı kural çeyreğin "Gelir mali belgeden girilmedi" taslak gerekçesinde ve Başlarken'in
"KDV beyannamesi satışları" adımında). Cirosu girilmemiş ama gideri olan ay boş değildir (veri eksik: sorulur, taslak
kalır); süren ay boş sayılmaz.
Belgesi yok kalemleri yazılmaz, sınıflandırılmamışların yalnız toplamı. Vergi sayfasının yılını yazar (30 Nisan'a
kadar geçen yıl); hazırlanamazsa sekme yok, dosya iner.

## 9. Kod haritası

| Dosya | Ne |
|---|---|
| `src/lib/tax/rules.ts`, `rules-2026.ts` | Kural tablosu, `rulesFor` (elle değerler, tahmini yıl), metinler (`TAX_DISCLAIMER`, belge ve stopaj seçenekleri) |
| `src/lib/tax/settings.ts`, `checks.ts` | `tax.settings` okuma, muhasebeciye sorulacaklar |
| `src/lib/tax/calendar.ts` | Dönemler, yasal son gün (VUK 18), çeyrekler, varsayılan yıl ve çeyrek |
| `src/lib/tax/payroll.ts` | Netten brüt bordro, SGK, `taxPayrollFromModel` (nakit planının SGK'sı) |
| `src/lib/tax/assets.ts` | Amortisman, demirbaş adayları, faturası silinen varlık |
| `src/lib/tax/pnl.ts` | Vergi kârı: vergi hesabındaki gelir-gider (ay, çeyrek, köprü, sınıflandırma hedefleri, kapsam) |
| `src/lib/tax/glossary.ts`, `overdue.ts` | Ekran sözlüğü (sade ad, döküm etiketi, rozet); Ödemeler'de günü geçmiş vergi / SGK hatırlatıcıları |
| `src/lib/tax/corporate.ts`, `muhtasar.ts`, `stamp.ts` | Geçici ve kurumlar vergisi, muhtasar, damga |
| `src/lib/tax/view.ts`, `inputs.ts`, `edit.ts` | Ekran görünümü ve takvim, nakit planı beslemesi, girdiler, eylemlerin saf kuralları (`employerRateNotice`) |
| `src/server/data/tax.ts` | `loadTaxInputs` (tek tur), `loadTaxView`, `loadTaxSettings` |
| `src/server/actions/tax.ts` | Eylemler (her biri `requireAdmin`, işlem geçmişi, `refresh()`); `setEmployerSgkRate` |
| `src/app/panel/vergi/**` | Dört sayfa ve pencereler (`loading.tsx` yok) |
| `src/lib/cash-plan.ts` | Vergi beslemesi, muhtasar ve geçici vergi sınıfları, damga satırları, stopajlı sabit gider |

Saf vergi kodu sunucuya ve veritabanına uzanmaz. Testler `tests/vergi-*.test.ts` (kurallar, bordro, takvim, damga,
gelir-gider, demirbaş, muhtasar, kurumlar, eylemler ve veritabanı, migration, ekran kaynağı ve Excel sekmesi);
nakit planı `tests/nakit-plani.test.ts`, hatırlatıcılar `tests/reminders.test.ts`, haftalık özet
`tests/haftalik-ozet.test.ts`. Personel sızıntı betiği (`scripts/personel-sizinti.ts`) dört adresi de dener: personel
çereziyle HTML ve RSC isteği Bugün'e döner.

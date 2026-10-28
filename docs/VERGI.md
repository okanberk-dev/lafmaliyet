# Vergi (tahmin, beyanname değil)

Sahibin isteği (24 Ekim 2026): "Köşeye bir de vergi gibi bir kısım açar mısın; oradan gelir-gider, kurumlar vergisi,
damga, hepsini Türkiye'ye göre hesaplasın ama dikkatli yap." Ekran **Finans › Vergi** (`/panel/vergi`, yalnız
yönetici). Plan ve kararların gerekçesi: [planlar/vergi.md](planlar/vergi.md) (K1–K34, §14 muhasebeciye sorulacaklar).

## 1. Amaç ve sınırlar

- **Her rakam tahmindir.** Sayfanın başındaki bant bunu söyler (`TAX_DISCLAIMER`): kesin tutar muhasebecinin
  beyannamesinde ve tahakkuk fişindedir; girildiğinde tahminin yerine geçer.
- **Kafe payıdır.** Kurumlar ve geçici vergi şirketin bütün işleri için tek beyannamedir; panel yalnız kafeyi görür.
  Kartın başlığı "Kafenin geçici vergi matrahına katkısı (yalnız kafe)"dır, şirketin ödeyeceği tutar değil. Şirketin
  diğer gelir ve giderleri Vergiye göre › **Düzeltme ekle** ile girilir (kapsam çipi değişir).
- Her rakam dayanağını gösterir: formül, girdiler, oran, kanun maddesi, kaynak bağlantısı ve kural tablosunun
  derlendiği gün ("Nasıl hesaplandı").
- Beyanname hazırlanmaz, e-beyanname gönderilmez; danışmanlık yapılmaz. Belgesi olmayan ödemelerin kalem kalem
  listesi dışa aktarılmaz, işlem geçmişine yazılmaz.
- Eksik veriyle hesaplanan geçici ve kurumlar vergisi **Taslak**'tır; taslak tutar nakit planına ve takvimin tutar
  sütununa yazılmaz.

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

Dört sekme (`SECTION_TABS.vergi`), kenar çubuğunda tek öğe. Telefonda üst çubuk "Vergi", "Vergiye göre", "Demirbaş",
"Vergi kuralları" yazar; ⌘K'da "Vergiye göre gelir-gider", "Demirbaş & amortisman", "Vergi kuralları" ve "Muhasebeciye
sorulacaklar" ayrıca bulunur.

| Sekme | Ne var | Okuduğu |
|---|---|---|
| **Özet** (`/panel/vergi`) | Üç rakam (sıradaki ödeme, önümüzdeki 30 gün, hazırlık), **Başlarken** kartı (şirket nasıl kuruldu, giderleri sınıflandırın, demirbaşlar, muhasebecinin rakamları), önümüzdeki 100 günün vergi takvimi (her satırda tek tutar ve kaynağı; açılınca döküm, "Ödemeler'e ekle", "Muhasebecinin rakamını gir"), sonra gelenler, geçici vergi ve kurumlar vergisi kartları, bordro dökümü | model, vergi girdileri, nakit planı (KDV satırları), Ödemeler |
| **Vergiye göre** (`/panel/vergi/gelir-gider`) | Seçilen çeyreğin ayları, çeyrek toplamı ve kümülatif (masaüstünde tablo, telefonda tek sütun seçicisi), Gelir-gider'den vergiye köprü kartı, KDV beyannamesi satışları kartı, **sınıflandırma listesi** (`#siniflandir`; toplu kayıt, kaydedilmeden çıkışta uyarı, sabit giderde stopaj profili), kafe dışı faturalar anahtarı, düzeltmeler | model, vergi girdileri (nakit planı yok) |
| **Demirbaş** (`/panel/vergi/demirbas`) | Varlık listesi ve amortisman, faturası Paraşüt'te silinen varlık ("Bağla"), varlık listesine eklenmemiş Kuruluş & Demirbaş faturaları, "demirbaş olabilir" faturalar ("Doğrudan gider", "Gider (demirbaş değil)", "Geri al") | model, vergi girdileri |
| **Kurallar** (`/panel/vergi/kurallar`) | Vergi ayarları, **Muhasebeciye sorulacaklar** (`#sorular`; "Muhasebecimle konuştum" işareti ve not), yıla göre kural tablosu (güven, dayanak, kaynak; elle değiştirilebilenlerde "Elle değer"), "Bu kafede hesaplanmayanlar" (`#bilgi`) | yalnız vergi ayarları |

Rozetler: tahminde yok (`≈` yeter), "Muhasebeci", "Ödemeler'de", "sabit tutar" (beyanname damgası), "Taslak", "2026
kuralları" (tablosu olmayan yıl). İşaretler sahibindir; hiçbir yerde muhasebecinin tabloyu onayladığı yazmaz.

Diğer ekranlara dokunuşlar:
- **Gelir-gider:** başlığın altında "Vergiye göre karşılığı: Vergi › Vergiye göre". Ayarlar'daki işveren SGK oranı
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
  hariç tahminle), "Belgesi yok" (sayılmaz). Personel bölümünde "Bordroda" (Personel'e ekleyin) ve "Dışarıdan hizmet".
  **Seçilmemiş kalem sayılmaz** ve hesap Taslak kalır. Kasadan çıkan fatura / e-Arşiv satırı, faturası Faturalar'a
  gelmişse "Paraşüt'te faturası var" sayılır (denetim B17'nin iki kez sayılan listesi).
- **Demirbaş olabilir:** mal, komisyon, kira ve kafe dışı dışındaki kategoride KDV hariç 12.000 ₺'yi aşan, aynı
  tedarikçiden aynı kategoride önceki 90 günde faturası olmayan fatura; karar verilene kadar sayılmaz.
- **POS komisyonu (K12a):** Gelir-gider'deki `commission:pos` hücresi (elle girildiyse banka dekontu, değilse banka
  kartı payıyla tahmin; denetim B16'nın kuralı). Yemek kartı komisyonu Faturalar › Komisyon'da.
- **Amortisman (K14):** yalnız normal yöntem, yıllık = maliyet ÷ ömür, edinilen yıl tam yıl; geçici vergi dönemine
  dağıtım ayarla ("kalan çeyreklere eşit", varsayılan, ya da "kümülatif ay ÷ 12"). Ömür girilmezse amortisman 0 ve
  uyarı; varsayılan ömür uydurulmaz. 12.000 ₺'yi aşmayan varlık doğrudan gider seçilebilir (VUK 313).
- **Bordro (K16):** netten brüt (kümülatif gelir vergisi matrahı, asgari ücret istisnası, ücret damgası, PEK alt ve üst
  sınırı), 2026 yasal SGK oranlarıyla (işçi %14 + %1, işveren %19,75 + %2; teşvik varsa Kurallar'dan elle). Gelir-gider
  Ayarlar'daki oranla kalır (Excel eşitliği).
- **Muhtasar (K20):** ay P'nin ücret gelir ve damga vergisi + sabit giderin stopaj profiline göre stopaj (kira %20,
  serbest meslek %20, internet reklamı %15) + beyanname damgası (personel varsa 939,70, yalnız stopajda 791,00);
  P+1'in 26'sında. Adı kira, reklam ya da dışarıdan hizmete uyan profilsiz kalem varsa tutar "en az"dır.
- **SGK:** bordronun dört payı, P+1'in son günü (tatilde ilk iş günü).
- **Geçici vergi (K21):** kümülatif, %25; asgari kurumlar vergisi (%10) muafiyet yoksa karşılaştırılır; önceki
  dönemler düşülür. Muhasebecinin matrahlı kaydı **çapa**dır: sonraki dönem o matraha çapadan sonraki ayları ekler.
  Süren dönem ay sonuna tamamlanmaz. Taslak çeyrekte kartın başlığı "Giderler sınıflandırılınca netleşir · şimdilik en
  çok ≈ X ₺" der.
- **Kurumlar vergisi:** yıllık kazanç (kayıt varsa onun matrahı), devreden zarar, %25 ya da asgari; yalnız **ödendi**
  işaretli geçici vergi mahsup edilir. Damga: beyanname + bilanço + gelir tablosu (2026: 2.516,30).
- **Asgari kurumlar vergisi muafiyeti (K10):** yalnız Kurallar › Vergi ayarları'nda şirket "ilk defa faaliyete
  başladı" seçilince; varsayılan uygulanmaz (vergi yüksek görünür).
- **KDV (K5):** yeni KDV hesabı yok; takvim nakit planının KDV ve KDV-2 tahminini okur. Yurt dışı hizmet profilli
  sabit giderin KDV-2'si ayrı satırdır.
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

Elle değiştirilebilenler (Kurallar › "Elle değer", not zorunlu): `sgk.isverenOran` (teşvik, en çok %21,75),
`damga.gecici`, tahmini yılda beyanname ve mali tablo damgaları.

**Yeni yıl:** `src/lib/tax/rules-2027.ts` yazılır (2026 dosyasını kopyalayıp değerleri ve kaynakları güncelleyin),
`TAX_RULES`'a eklenir, `RULES_COMPILED_AT` o gün olur, testler (`tests/vergi-*.test.ts`) yeni yılın değerleriyle
güncellenir. Resmî metinlerle tek tek karşılaştırılınca `RULES_VERIFIED_AT` doldurulur, bant "karşılaştırıldı" der.

## 6. Muhasebeciye sorulacaklar

Kurallar › Muhasebeciye sorulacaklar (`ACCOUNTANT_CHECKS`, `src/lib/tax/checks.ts`). Sekiz **temel** madde
işaretlenmedikçe çip "Muhasebeciye sorulacaklar: n / 8" der; hepsi işaretlenince "Muhasebecinizle gözden geçirildi
(sahibin işareti)". Temel maddeler: şirketin kuruluşu (asgari kurumlar vergisi muafiyeti, MERSİS ile vergi
numarasının uyuşmaması), SGK oranı, bordro, kira (kime ödeniyor, gerçek kira, sözleşme damgası), stopaj (Instagram,
influencer, muhasebeci), demirbaş (XND faturaları, ömürler, özel maliyet), geçici vergi 2026/2 ve 2026/3, kafe dışı
işler. Ek maddeler: muhtasar dönemi, KDV beyannamelerinin satışları, fişli alımlar, ikram ve zayi, asgari vergide zarar,
asgari ücret desteği, damga tutarları, ortaklar, alkol ve turizm, yerel vergiler ve adres. Metinler planın §14'ünde.

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
değişmedi. Besleme hesaplanamazsa plan vergisiz, bugünkü gibi çalışır (`console.error`).

**Excel "Vergi" sekmesi** (`src/app/api/export/workbook.ts` › `addTax`): ilk satır "Tahmin; beyanname değildir.
Kafenin payı; şirketin beyannamesi muhasebecidedir." Bloklar: ay ay vergiye göre gelir-gider ve çeyrek toplamı
(yalnız geliri mali belgeden gelen aylar; diğerlerinin yerine "Gelir mali belgeden girilmedi; hesap ekranda
(taslak)"), geçici ve kurumlar vergisi satır satır formülüyle (hesap döneminin başından ya da çapadan beri her ay mali
belgeliyse), takvim, kullanılan kurallar ("Derlendi 24.10.2026; resmî metinlerle karşılaştırılmadı"), sahibin notları.
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
| `src/lib/tax/pnl.ts` | Vergiye göre gelir-gider (ay, çeyrek, köprü, sınıflandırma hedefleri, kapsam) |
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

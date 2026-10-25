# Dalga 12: Vergi bölümü (`/panel/vergi`)

Grup: **vergi** · Dal: `claude/dalga-12-vergi` · Taban: `origin/main` @ 950dbdb. Durum: plan, iki eleştiri turu
işlendi (sonda "Eleştiri kaydı"), henüz uygulanmadı.

**Birleştirme sırası 10 → 11 → 12** (dalga 13 ile sıra R2'ye göre). Dalga 10 (personel yetkileri) `nav.ts`,
`roles.ts`, Yardım (`yardim/faq-build.tsx`) ve personel sızıntı betiğine; dalga 11 (cari hesap) `types.ts`,
`dataset.ts` (`supplierEntryId`), `reminders.ts`, `actions/reminders.ts`, `cash-plan.ts`, `server/data/cash-plan.ts` ve
`tests/nakit-plani.test.ts`'in beklenen değerlerine dokunuyor. Vergi dalı onların üstüne kurulur: `supplierEntryId`'yi
yeniden eklemez, nakit planı testlerinin beklenen değerleri dalga 11'den sonra yeniden hesaplanır (§18).
**Bir migration** (adı `vergi`; numarası birleştirmede R2 protokolüyle verilir, büyük olasılıkla 0039–0040).
**Yeni bağımlılık yok, yeni cron yok.**

Uygulamadan önce okunacaklar:
- `AGENTS.md`;
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` (eylemden sonra `refresh()`);
- `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`;
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` bir Promise'tir;
  `?yil=`, `?ceyrek=`);
- `docs/NAKIT-PLANI.md` (özellikle "Muhasebecinin beyannameleriyle karşılaştırma"), `docs/HAFTALIK-OZET.md`,
  `docs/TASARIM.md` §5–§6.

Mevcut kalıplar:
- `src/lib/kdv.ts`: tahmin, muhasebeci kaydı, `VAT_DISCLAIMER`, `round100`;
- `src/lib/cash-plan.ts`: `buildCashPlan`, hatırlatıcı sınıfları (`classify`), KDV yerleşimi, `planNotes`,
  `planInputFromModel`, `withVat`;
- `src/lib/calc/engine.ts`: `pnlMonth` (gelir-gider, `revenueNet`, `cogs`, hücreler), `personnelFor`, `staffAtMonth`,
  `closingStock`, `cardShareOf`;
- `src/lib/reminders.ts`: `REMINDER_PRESETS`, `reminderCategory`, `isVatReminder`, `vatAmountTravels`, `stampOnly`;
- `src/lib/vat-paid.ts`: Ödendi'nin kalıcı kaydı (`payments.vat-paid`);
- `src/lib/forecast/calendar.ts`: `TR_CALENDAR` (resmî tatil ve bayramlar, 2028 sonuna kadar);
- `src/server/actions/costs.ts`: `saveStaffRates` (dört oranı birden yazar; vergi bunu çağırmaz, §7.2);
- `src/app/panel/komisyonlar/`: yalnız yönetici, üstte `Stat` şeridi, kartlı ekran, telefon düzeni;
- `src/app/panel/gelir-gider/` (`pnl-grid.tsx`, `month-view.tsx`): masaüstünde yapışkan ilk sütunlu ızgara, telefonda
  tek ay ve yapışkan seçici;
- `src/components/ui/`: `Select`, `dialog`, `floating-bar`, `stat-breakdown`, `info-tip`, `misc` (`Stat`,
  `PageSkeleton`). `Segmented` bu bölümde **kullanılmaz** (seçilmedi durumu yok, dar ekranda yatay kayar; §4.2);
- `src/app/panel/hatirlaticilar/reminder-sheet.tsx`: `PRESET_CARDS` (şablon kartları `REMINDER_PRESETS`'ten ayrı
  listedir);
- `src/server/db/schema.ts`: `commissionMonths` (`check` kalıbı).

---

## 0. Amaç

Sahibin isteği (24 Ekim 2026): *"Köşeye bir de vergi gibi bir kısım açar mısın; oradan gelir-gider, kurumlar vergisi,
damga, hepsini Türkiye'ye göre hesaplasın ama dikkatli yap."*

Kenar çubuğunda **Satış & gider › Vergi** açılır. Yalnız yöneticiye görünür, dört sekmesi vardır:

1. **Özet.** En üstte üç rakam (sıradaki ödeme, önümüzdeki 30 gün, hazırlık). İlk açılışta "Başlarken" kartı. Sonra
   önümüzdeki 100 günün vergi takvimi; her satırda tek tutar ve tutarın kaynağı. Yanında yalnız iki kart: geçici vergi
   ve kurumlar vergisi (kafenin katkısı).
2. **Vergiye göre.** Seçilen çeyreğin ayları, çeyrek toplamı ve yılbaşından kümülatif: vergi esasında gelir ve gider,
   KDV hariç, belgeye dayanan satırlar. Gelir-gider ekranıyla köprü. Sınıflandırma listesi ve düzeltmeler.
3. **Demirbaş.** Varlık listesi, amortisman, varlık listesine eklenmemiş demirbaş faturaları ve "demirbaş olabilir"
   faturalar.
4. **Kurallar.** Vergi ayarları, muhasebeciye sorulacaklar, yıla göre kaynaklı kural tablosu, hesaplanmayanlar.

"Dikkatli" şu demektir:
- **Her rakam tahmindir** ve öyle etiketlenir.
- Her rakam dayanağını gösterir: formül, girdiler, oran, kanun maddesi, kaynak bağlantısı ve kural tablosunun
  derlendiği gün.
- Hiçbir rakam beyanname gibi sunulmaz. **Panel yönetim verisini (ModPOS cirosu) "vergi esasında gelir" diye
  adlandırmaz**; vergi gelirinin kaynağı mali belgedir (muhasebecinin KDV beyannamesi, yazarkasanın mali Z'si),
  yoksa ekran bunu açıkça yazar (K11).
- Muhasebecinin gerçek rakamı girilince tahminin yerine o geçer.
- Panelin bilmediği bir şey varsa (kafe dışı işler, belgesi bilinmeyen giderler, demirbaş ömrü, stopaj) tahmin bunu
  açıkça söyler. Eksik veriyle hesaplanan rakam **"Taslak"** rozetini taşır ve bankadan çıkacak para gibi nakit
  planına yazılmaz (K21, K25).
- Hiçbir şey sessizce varsayılmaz.

Yapılmayanlar:
- Beyanname hazırlanmaz, e-beyanname gönderilmez.
- Hukuk ya da muhasebe danışmanlığı yapılmaz.
- Kurumlar ve geçici vergi şirketin bütün işleri için tek beyannamedir. Panel yalnız kafeyi görür ve bunu her yerde
  yazar: kartın başlığı "Kafenin geçici vergi matrahına katkısı"dır, şirketin ödeyeceği tutar değil.
- Belgesi olmayan ödemelerin kalem kalem listesi dışa aktarılmaz, işlem geçmişine yazılmaz (K12, K31).

---

## 1. Kararlar (kodu ve araştırmayı okuyup verildi; uygulayan yeniden karar vermez)

| # | Konu | Karar | Neden |
|---|---|---|---|
| K1 | Yer | `NAV_TREE` › "Satış & gider" (`para`) altında "Gelir-gider"den sonra **Vergi** (`/panel/vergi`). `NAV_GROUPS` › "Para"da da var, alt ekranlar ⌘K'da. Sekmeler `SECTION_TABS.vergi` | Sahip "köşeye" dedi (kenar çubuğu). Para işleri o grupta |
| K2 | Rol | Yalnız yönetici: her sayfa ve eylem `requireAdmin`. `STAFF_PATHS`'e eklenmez. `ROLE_PERMISSIONS`'a bir satır (yönetici evet, personel hayır). Dalga 10'un personel sızıntı betiğine `/panel/vergi` ve üç alt sayfası eklenir | Personel hiçbir yerde para görmez |
| K3 | Kapsam | Hesap **kafe payıdır**. Kafe dışı gelir ve gider düzeltme olarak elle girilir (ay ya da çeyrek). Başlıktaki çip giriş yoksa "Kapsam: yalnız kafe", varsa "Kafe + elle girilen kafe dışı", gelir bir ayda KDV beyannamesinden geliyorsa "Gelir: şirketin tamamı (beyanname) · gider: kafe" der. Kafe dışı faturalar (`SEPARATE_CATEGORIES`) varsayılan olarak sayılmaz; ayarla açılır. **"Alp Koç" kategorisi** ayar kapalıyken de "şirket defterinde gider yazılamayabilir" notuyla listelenir (M16) | Panel karaoke box'ın, yazılım işinin ve ortağın satışını görmüyor. Yalnız alışlarını düşmek vergiyi sistemli olarak düşük gösterirdi. Ortağın hesabına şirket adına alınan fatura şirketin gideri değildir (ortaklar carisi) |
| K4 | Kesin rakamın önceliği | Üç kaynak: (1) muhasebecinin Vergi'ye girdiği rakam ("Muhasebeci"), (2) Ödemeler'deki hatırlatıcıya o dönem için yazılan tutar ("Ödemeler'de"), (3) tahmin ("≈"). **Vergi sayfasının kartlarında** öncelik 1 › 2 › 3; **nakit planında** 2 › 1 › 3 (bankadan çıkacak para). 1 ile 2 birlikte varsa ve 1 ₺'den fazla farklıysa iki yerde de uyarı çıkar. Muhasebeci rakamı penceresi "Ödemeler'deki hatırlatıcıya da yaz" kutusuyla (varsayılan açık) ikisini tek girişte eşitler (§4.5-a) | Yükümlülüğün yasal tutarı tahakkuk fişidir; nakit planı ise Ödemeler'deki tutarı ödeyecek para sayıyor. Sahip tutarı tek yerden girer |
| K5 | KDV | **Yeni KDV hesabı yok.** Nakit planının KDV ve KDV-2 tahmini (`plan.vat`) okunur. Devreden KDV ve kesin tutar bugünkü yerlerinde kalır. İki ek: (a) muhasebecinin aylık KDV beyannamesindeki **satış matrahları** (oran oran) Vergi'ye girilebilir; yalnız gelirin kaynağıdır, KDV ödemesi hesaplamaz (K11); (b) yurt dışı hizmet profilli sabit giderin KDV-2'si ayrı tahmin satırıdır (K20) | Aynı hesabın ikinci kopyası yazılmaz |
| K6 | Kural tablosu | Oranlar, eşikler, maktu tutarlar ve günler **tek dosyada**, yıl anahtarlı ve kaynaklıdır: `src/lib/tax/rules-2026.ts`. Her değerin dayanağı, kaynak bağlantıları (resmî olan önce), güven derecesi (kesin / muhtemel / belirsiz), geçerlilik başı ve gerekiyorsa "muhasebeci onayı gerekir" işareti (`confirm`) vardır. `RULES_COMPILED_AT = "2026-10-24"` (derlendiği gün) ve `RULES_VERIFIED_AT: string \| null = null` (resmî metinlerle karşılaştırıldığı gün; karşılaştırılınca doldurulur) | Yıl değişince tek dosya eklenir. Ekran her rakamın yanında dayanağını gösterebilir. "Denetlendi" demek, resmî metin okunmadığı için doğru değildi |
| K7 | Bilinmeyen yıl | 2027 ve sonrası için tablo yoksa en son bilinen yıl kullanılır, sonuç **"tahmini (2026 kuralları)"** diye etiketlenir. Oran uydurulmaz. 2026 dönemi kurumlar vergisi 2026 kurallarıyla hesaplanır. Beyanname damgası 2027 tutarıyla ödenir; o tutar bilinmediği için 2026 tutarı "2027 tutarı açıklanmadı" notuyla gösterilir | 2027 değerleri Kasım–Aralık 2026'da açıklanacak |
| K8 | Elle değerler | Yalnız `overridable` işaretli kurallar ekrandan değiştirilir; kayıt `integration_state` › `tax.settings.overrides`'tadır. Değiştirilen değerin yanında "Elle: X (tablo: Y) · not · kim, ne zaman" yazar | Belirsiz kalemler için yönetici değeri. Kesin kurallar kodla değişir |
| K9 | Hesap dönemi | Başlangıç `tax.settings.periodStart`, varsayılan **2026-06-25** (vergi levhasındaki işe başlama günü). İlk hesap dönemi 25.06–31.12.2026'dır (kıst dönem); 2025 beyannamesi ve devreden zarar yok | laffogato `src/lib/legal/entity.ts` (`startedAt`). M1 |
| K10 | Asgari kurumlar vergisi muafiyeti | KVK 32/C/5 yeni kuruluşu, başladığı dönem dahil 3 hesap dönemi muaf tutar. Muafiyet yalnız `tax.settings.firstActivity === "ilk"` iken uygulanır. Varsayılan `null`'dır: muafiyet uygulanmaz, asgari vergi de hesaplanıp karşılaştırılır. Ekranda neden yazar | laffogato.net'teki yasal bilgilerdeki MERSİS numarası (0734069467300012) 7340694673 vergi numarasını gösteriyor; levhadaki 6312110904. Devir ya da tür değişikliğiyle kurulduysa muafiyet yok. Varsayılan güvenli taraf (yüksek vergi). M1 |
| K11 | Gelir: mali belgeye dayanır | KDV hariç. Ay ay kaynak sırası: **(1)** muhasebecinin o ay için girdiği KDV beyannamesi satış matrahı (`tax_filings` › `kdv_matrah`; oran oran toplam, varsa "kafe dışı kısmı" düşülür). Şirketin tamamıdır; laffogato.net ve kafe dışı gelir düzeltmesi o ay ayrıca eklenmez (içindedir). **(2)** Dalga 13 birleştiyse yazarkasanın mali Z kayıtları (ayın her açık günü için varsa, oran oran KDV hariç matrah toplamı) + laffogato.net. **(3)** Bunlar yoksa ModPOS cirosu (`pnlMonth(ay).revenueNet`) + laffogato.net, **"Yönetim verisi (ModPOS), mali belge değil"** rozetiyle; o çeyreğin hesabı Taslak'tır (K33). laffogato.net `site.total − karaoke.refundPendingMinor` (iadesi bekleyen karaoke düşülür), rozeti "yaklaşık; e-Arşiv tarihinden farklı olabilir". ModPOS ile mali Z ya da beyanname arasındaki fark Vergi sayfasında, Excel'in "Vergi" sayfasında ve köprü kartında **hiç yazılmaz**; mutabakat (§19, B3) ayrı ekranda, gerekçe alanlarıyla yapılır. "Vergi esasında gelir" etiketi ModPOS'a hiçbir yerde verilmez | Vergi matrahı mali belgeye dayanır; muhasebecinin beyannameleri de onu kullanıyor. Q3 2026'da ModPOS cirosu KDV hariç 1.002.831 ₺, beyannamelerin %10 matrahı 845.794 ₺ (`docs/NAKIT-PLANI.md`): fark tahmini %25'ten ≈ 39.300 ₺ şişirirdi. Mali belgeden yüksek bir ciroyu "vergi geliri" diye saklayıp muhasebeciye vermek, incelemede fişsiz satış delili gibi okunabilir (VUK 256, 353) |
| K12 | Gider: belge esası | Kafe kategorilerindeki faturalar **fatura tarihine göre** gider sayılır (tahakkuk). Mal faturaları satılan mal maliyetine (SMM) girer, diğerleri döneme. "Kuruluş & Demirbaş" faturaları ve bir varlığa bağlanan fatura tutarları gider sayılmaz, Demirbaş'a gider (K14). **Demirbaş olabilir:** mal, Komisyon, Kira & AVM, kafe dışı ve Kuruluş & Demirbaş dışındaki kategorilerde KDV hariç 12.000 ₺'yi aşan ve aynı tedarikçiden aynı kategoride önceki 90 günde faturası olmayan fatura, sahip "Gider (demirbaş değil)" ya da "Varlık olarak ekle" diyene kadar sınıflandırılmamış sayılır (K13). Fatura dışı her kalem (sabit gider, Aylık harcamalar kategorisi, Gelir-gider'in elle satırı) **vergi belgesine** göre sayılır. Seçenekler (`TaxDoc`): `fatura` "Paraşüt'te faturası var (burada sayılmaz)", `belgeli` "Belgesi muhasebecide (fiş, makbuz, serbest meslek makbuzu)" (sayılır), `yok` "Belgesi yok: muhasebecinize sorun (vergiden düşülmez)" (sayılmaz). **Personel bölümündeki sabit giderlerde** `yok` seçeneği yoktur; seçenekler `bordro` "Bordroda (Personel'e ekleyin; burada sayılmaz)", `fatura` ve `belgeli` "Dışarıdan hizmet: belgesi muhasebecide (fatura, SMM)". Seçilmemiş kalem **sayılmaz**, listede durur. POS komisyonu tahmini sayılır ama "tahmini" rozetiyle (K12a) | Bugünkü gelir-gider faturaların çoğunu saymıyor, kira ve reklam gibi kalemler elle girilmiş tahmin. Hem faturayı hem sabit gideri saymak çift sayımdır. Belgesiz ödeme deftere giremez; "KKEG" değildir (şirket kasasından çıktıysa muhasebeci ortak hesabına ya da kasa farkına yazar). Personel kalemine "belgesiz" demek kayıt dışı istihdamın yazılı izi olurdu (5510 m.102). VUK 313: 12.000 ₺'yi aşan, bir yıldan uzun kullanılan kıymet amortismana tabidir (tabela, POS donanımı, yazılım lisansı) |
| K12a | POS komisyonu | Vergi hesabında `commission:pos` hücresi Gelir-gider'de **elle girildiyse** (banka dekontundaki tutar) o kullanılır. Değilse yeniden hesaplanır: KDV dahil ciro × `komisyon` × **banka kartı payı** (kasa raporlarından Σ kart ÷ Σ Z; yemek kartı hariç, çünkü yemek kartı komisyonu Pluxee, Multinet, Edenred faturalarıyla Faturalar › Komisyon'da zaten sayılıyor). Kasa raporu olmayan ayda Ayarlar'daki `kartOrani`, notla: "yemek kartı payı ayrılamadı". Rozet "tahmini (banka dekontundaki tutarı Gelir-gider'e yazabilirsiniz)" | `cardShareOf` kart + yemek kartını sayıyor (`cash-month.ts`); vergi hesabında yemek kartı komisyonu iki kez gider olurdu. Komisyonun kendisi her ay vardır ve belgesi bankanın aylık dekontudur; aralığa almak geçici vergiyi gereksiz yükseltirdi |
| K13 | Sınıflandırılmamış giderler ve aralık | Asıl rakam (üst uç) sınıflandırılmamış kalemleri saymaz, demirbaş adaylarını gider saymaz, ömrü girilmemiş varlığa amortisman ayırmaz. **Alt sınır** (yalnız "Nasıl hesaplandı"da, tanımıyla): sınıflandırılmamış kalemler `belgeli`, demirbaş adayları gider, varlık listesine eklenmemiş Kuruluş & Demirbaş faturaları ve ömrü girilmemiş varlıkların maliyeti tamamen gider sayılsaydı. Kart ve takvim alt sınırı göstermez; yerine "808.610 ₺ gider henüz hesaba girmedi (24 kalem)" ve "Giderleri sınıflandır" yazar (K33) | Tek rakam yanıltırdı; "≈ 0 ₺" gibi bir alt uç ise gerçek bir alt sınır değildi ve sahibi ya paniğe ya güvensizliğe itiyordu. Tanımlı alt sınır uydurma ömür kullanmaz (amortisman maliyeti aşamaz) |
| K14 | Demirbaş ve amortisman | Yeni `tax_assets` tablosu. Varlığın faturası bağlanabilir; bağlanan maliyet o faturanın giderinden düşer. Yöntem yalnız **normal (eşit)**: yıllık tutar = maliyet ÷ ömür. Edinilen yıl **tam yıl** sayılır (binek dışı kıst amortisman yok); son yıl kalanı alır. Geçici vergi dönemlerine dağıtım **ayarla seçilir** (`tax.settings.quarterDepreciation`): `"kalan"` (varsayılan; edinilen çeyrek dahil yılın kalan çeyreklerine eşit) ya da `"ay12"` (kümülatif ay ÷ 12). Kartın dökümünde kullanılan yöntem yazar. **Ömür girilmezse amortisman 0'dır** ve uyarı çıkar; varsayılan ömür uydurulmaz. Maliyeti KDV hariç 12.000 ₺'yi aşmayan varlık "doğrudan gider" seçilebilir (VUK 313) | Araştırma amortisman ömürlerini ve özel maliyet kuralını doğrulamadı. Geçici vergide yöntem uygulamada iki türlü; yıl sonunda aynı yere varılır, 2026/3 tahmini yönteme bağlı. Varsayılan Q3'te daha az amortisman ayırandır (güvenli taraf). M7 |
| K15 | SMM | `pnlMonth`'un devir ve sayımı (`opening`, `closing`, elle düzeltmeler dahil) kullanılır. Alışlar vergi kuralıyla yeniden toplanır: mal faturalarının neti, belgeli mal harcamaları (**KDV hariç tahmin**: tutar ÷ 1,10; M10) ve "DİĞER (market / nakit alımlar)" satırı (yalnız `belgeli` seçildiyse, aynı ÷ 1,10). **Çeyrek sonu ayında (Mart, Haziran, Eylül, Aralık) sayım yoksa** en son ay sonu sayımı devreden stok sayılır ve ekranda kırmızı uyarı çıkar: "30 Eylül sayımı yok: 31 Ağustos sayımı kullanıldı; vergi için çeyrek sonu sayımı gerekir". Önceki sayım da yoksa stok 0 sayılır ("alışın tamamı gider; vergi düşük çıkabilir"). Çeyrek içi ayların sayımı çeyreğin toplamını değiştirmez (yalnız aylık görünüm) | Stok 0 kârı ve vergiyi düşük gösterir, varsayılan güvenli taraf ilkesine aykırıydı. Geçici vergide muhasebeci çeyrek sonunda kaydî envanterle stok düşer. KDV dahil fiş tutarını KDV hariç fatura ve sayım değerleriyle toplamak gideri şişirirdi |
| K16 | Bordro | Yeni saf `src/lib/tax/payroll.ts`. Netten brüt yinelemeyle çözülür; GV yıl içindeki kümülatif matrahla, asgari ücret GV ve DV istisnası, ücret damgası, PEK alt ve üst sınırı uygulanır. **SGK oranları kural tablosundan** (yasal 2026: işçi %14 + %1, işveren %19,75 + %2); `sgk.isverenOran` elle değiştirilebilir (teşvik, M2). Ayarlar'daki oranlar yalnız Gelir-gider'de kalır. Aylar tam sayılır (personelin giriş günü panelde yok). Ek ödemeler (`extras`) vergisiz ve brütleştirilmeden maliyete eklenir (not yazılır) | Bugünkü `staffCost` brüt = net ÷ 0,85, GV ve DV'yi yok sayıyor. Ayarlar'daki %15,75 2025 Ocak ayının (5 puan) oranı; 2026'da imalat dışı işyerinde Hazine indirimi 2 puandır (%21,75 − 2). Vergi sayfası en büyük düzenli prim ödemesini bilerek düşük göstermemeli |
| K17 | Gelir-gider ve Excel eşitliği | `engine.ts` `staffCost` **değişmez**; Gelir-gider Ayarlar'ın oranlarıyla kalır (`tests/golden.json`). Vergi sayfası doğru bordroyu kullanır. Ayarlar'daki işveren oranı kural tablosundan farklıysa **yalnız Gelir-gider'de** tek satır uyarı çıkar (K19) | Excel eşitliği bozulmaz |
| K18 | Nakit planındaki SGK | `planInputFromModel`'in bordrosu `taxPayrollFromModel`'den gelir (yasal oranlar, doğru brüt, PEK sınırı). Kesin tutar SGK hatırlatıcısındaki tutardır (bugünkü gibi); geçmiş ve süren dönemde takvim önce "tahakkuk fişindeki tutarı girin" der | Vergi sayfasıyla nakit planı aynı SGK'yı göstermeli. Excel verisinde Eylül SGK'sı 23.117,65 ₺'den **25.956,18 ₺**'ye çıkar (ayda ≈ 2.840 ₺) |
| K19 | SGK oran uyuşmazlığı | Gelir-gider'de uyarı: "Ayarlar'da işveren SGK %15,75. 2026'da imalat dışı işyerinde 2 puan indirimle standart oran %19,75; ek teşvikiniz varsa farklı olabilir. Muhasebecinize sorun (Muhasebeciye sorulacaklar › SGK oranı); doğruysa Personel › Oranlar'dan değiştirin." M2 işaretlenince satırda "Ayarlar'daki oranı %19,75 yap" düğmesi çıkar; yeni küçük eylem `setEmployerSgkRate(rate)` yalnız `isverenSgk` anahtarını yazar (`ConfirmDialog`, geçmiş ayların değişeceğini söyler). **Kendiliğinden değişmez** | Ayarlar bütün aylar için tek değerdir; değişiklik Temmuz–Ekim gelir-giderini de değiştirir. `saveStaffRates` dört oranı birden ister; istemcinin eski değerlerle göndermesi başka sekmedeki değişikliği ezerdi |
| K20 | Muhtasar (vergi kısmı) | Ay P için, P+1'in 26'sında ödenir. İçeriği: ücret GV ve ücret DV (bordrodan), sabit giderin stopaj profiline göre stopaj (§3.5), artı beyanname damgası. Profiller (`taxWithholding`): `yok`, `kira` (%20), `serbest_meslek` (SMM %20), `internet_reklam` (şahsa ya da yurt dışına internet reklamı %15), `internet_reklam_yurtdisi` (doğrudan yurt dışına: %15 + KDV-2 %20), `yurt_disi_hizmet` (KDV-2 %20). Tutar **brüt** kabul edilir. Adı kira, reklam ya da dışarıdan hizmet anahtar kelimelerine uyan (`PANEL_GROUP_KEYWORDS`) ya da kira bölümündeki sabit gider profilsizse muhtasar tek rakam değildir: "en az 974 ₺; 4 kalemin stopajı bilinmiyor". Personel varsa MPHB damgası 939,70 ₺, yalnız stopaj varsa muhtasar damgası 791,00 ₺. `tax.settings.muhtasarQuarterly` açıksa vergi kısmı Mart, Haziran, Eylül ve Aralık dönemlerinde toplanır; MPHB damgası her ay ödenir | Faturalardaki stopaj Paraşüt'ten okunmuyor. Instagram reklamı (30.000 ₺/ay), influencer (50.000 ₺/ay) ve muhasebeci (10.000 ₺/ay) kime nasıl ödendiğine göre %0–%20 stopaj ve KDV-2 doğurur; bilinmeden tek rakam gerçeğin çok altında kalabilirdi |
| K21 | Geçici ve kurumlar vergisi | Kümülatif hesaplanır, oran %25. Asgari kurumlar vergisi (%10) muafiyet yoksa karşılaştırılır. Önceki dönemlerin geçici vergisi düşülür. Muhasebecinin bir döneme girdiği kayıt, matrahı girildiyse **çapa** olur: sonraki dönemin tahmini o kaydın kümülatif matrahına çapadan sonraki ayları ekler. Süren dönem ay sonuna **tamamlanmaz**. Kart başlığı "Kafenin geçici vergi matrahına katkısı (yalnız kafe)"; şirketin geçici vergisi muhasebecinin rakamıdır. **Tahmin nakit planına ve takvimin tutar sütununa yazılmaz** (K25). Yıllık KV'de yalnız **ödendi** işaretli geçici vergi mahsup edilir | Geçici vergi bütün şirketin beyannamesidir; kafe payı tahmini kira, demirbaş, stok ve kafe dışı işler bilinmeden 0 da olabilir, çok daha fazla da. Ödenmeyen geçici vergi yıllık beyannamede mahsup edilemez |
| K22 | Damga vergisi | Beyanname damgaları kural tablosundan gelir. Kurumlar vergisi beyannamesiyle **bilanço ve gelir tablosu** damgası da tahakkuk eder (2026: 616,30 + 294,20). Ücret damgası bordrodan gelir. Sözleşme damgası için hesaplayıcı **yok** (§19); oranlar Kurallar'da bilgi olarak durur | Tek seferlik iş için mekanizma gereksizdi |
| K23 | Yerel vergiler | ÇTV ve ilan-reklam vergisi **hesaplanmaz**. Tutarları belediyenin tahakkukundan Ödemeler'e yıllık hatırlatıcı olarak girilir (yeni şablonlar ve kartlar). Hatırlatıcı yoksa takvime tutarsız satır kendiliğinden girer: "ÇTV 2026 2. taksit · son gün 30.11.2026 · tutar belediyeden". Emlak vergisi kirada mal sahibinindir; turizm payı yalnız belgeli tesiste | Tarife bina grubuna, dereceye ve tabelanın ölçüsüne bağlı. İşyeri ÇTV'si emlak vergisinin taksit sürelerinde (Mayıs ve Kasım sonu) ödenir |
| K24 | Vergi takvimi | Yasal son gün VUK 18'le kaydırılır: hafta sonu, resmî tatil ve bayram günü izleyen ilk iş gününe geçer; arife kaydırmaz. Tatil listesi `TR_CALENDAR`'dan (2028 sonuna kadar); sonrası için yalnız hafta sonu ve not. Nakit planı nominal günü kullanır (erken taraf) ama satırın alt yazısı yasal günü söyler: "son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)"; takvim satırının ayrıntısı "nakit planında 31 Ekim'de" der | Erken taraf güvenlidir; iki ekran aynı ödemeye farklı gün dediğinde neden yazmalı |
| K25 | Nakit planı | Muhtasar tahmini plana **KDV deseniyle** girer (bilinmeyen stopaj varsa "en az" diye). Geçici vergi plana yalnız üç durumda tutarla girer: hatırlatıcıya o dönemin tutarı yazıldıysa, muhasebeci kaydı varsa ya da çeyrek **Hazır**sa (K33: sınıflandırma tam, gelir mali belgeden, kafe dışı sorusu işaretli). Öteki durumda satır "Tutarı girilmemiş ödemeler"de durur: "Geçici vergi 2026/3: şirketin beyannamesi; tutarı muhasebecinizden isteyin (son gün 17.11)". KDV-1 ve KDV-2 beyanname damgaları (791 ₺) tahmin satırının yanında ayrı küçük satırdır; tutarı yazılmış KDV hatırlatıcısı **damga dahil** sayılır. Stopajlı sabit gider net ödenir (§8.2). Hepsi tek anahtarla, `vergi`, "Tahmine katılanlar"dan kapatılır | Tahmin bankadan çıkacak para gibi durmamalı; muhtasarın bilinen kısmı ise gerçek bir alt sınırdır |
| K26 | Ödemeler | Tekrarlı hatırlatıcının tutarı yalnız başlığında **"muhtasar"** ya da **"geçici vergi"** geçiyorsa tek döneme aittir: "Ödendi" ve "Ertele" tutarı seriden siler, "Geri al" geri yazar (`vatAmountTravels` → `taxAmountTravels`). "Stopaj" kelimesi yalnız nakit planı sınıflaması içindir: sabit tutarlı "Kira stopajı" hatırlatıcısının tutarı kalır. Geçici vergi hatırlatıcısının "Ödendi"si KDV'deki gibi kalıcı kayda yazılır (`payments.vat-paid`, tür `gecici`, dönem `2026-Q3`) | Muhtasar ve geçici vergi tutarı her dönem değişir. Sabit kira stopajı değişmez; silinirse sahip her ay yeniden yazardı. KV mahsubu ödenmiş geçici vergiyi bilmeli |
| K27 | Yuvarlama | İç hesap kuruşla yapılır. Ekranda tahminin başlığı `≈` ile yazılır: 1.000 ₺ ve üstü en yakın 100 ₺'ye, altı 1 ₺'ye yuvarlanır. Döküm kuruşludur. Kesin rakamlar ve sabit tutarlar (791,00) `money()` ile, olduğu gibi yazılır. "tahmini" rozeti yoktur (`≈` yeter) | KDV kartıyla aynı görünüm |
| K28 | Enflasyon düzeltmesi | 2025, 2026 ve 2027'de yapılmaz (VUK geçici 37). Hesaplanmaz, Kurallar'da tek satır bilgi. 2028 ve sonrası için "bilinmiyor; muhasebecinize sorun" | Kural kesin |
| K29 | Bildirim ve nakit planını okuyan yüzeyler | Zil, sabah e-postası ve Bugün değişmez. **Ama** nakit planına giren vergi satırları (muhtasar, damga, yasal oranlı SGK, stopajlı sabit giderin net ödemesi, hazır çeyreğin geçici vergisi) `loadCashPlan`'ı okuyan her yüzeye yansır: Genel bakış'ın nakit kartı, haftalık özetin "ilk eksi gün" maddesi, Claude'un (MCP) nakit planı aracı. Bu `docs/HAFTALIK-OZET.md`'ye ve `docs/NAKIT-PLANI.md`'ye yazılır; testi §11-I | Önceki sürüm "haftalık özet değişmez" diyordu; nakit planını değiştiren her şey onu da değiştirir |
| K30 | Zamanlanmış iş ve yükleme | Cron yok; hesap sayfa açılınca yapılır. Vergi girdilerini **tek yükleyici** okur: `loadTaxInputs()` (`integration_state` › `tax.settings` ve üç vergi tablosu, `Promise.all`). `loadCashPlan(model, upcoming, { taxInputs })` önceden okunmuş girdiyi kabul eder. Sekme başına: Kurallar ayarları ve kural tablosunu okur (model yok); Demirbaş model ve varlıkları; Vergiye göre model ve vergi girdilerini (nakit planı yok); yalnız Özet hepsini bir kez | Bir Özet görüntülemesi vergi tablolarını iki kez okuyordu; Genel bakış ve 4 sn'lik haftalık toplayıcı için gereksiz yük |
| K31 | Excel ve Claude | Excel dışa aktarımına "Vergi" sayfası eklenir. Gelir kaynağı mali belge olmayan çeyreğin hesabı Excel'e **yazılmaz** ("Gelir mali belgeden girilmedi; hesap ekranda, taslak"). "Belgesi yok" kalemleri kalem ve tutar olarak yazılmaz; sahibin işaretleri "sahibin notu" olarak yazılır. Claude (MCP) aracı sonraya kalır (§19) | Muhasebeciye giden tablo mali belgeden yüksek bir ciroyu ya da belgesiz ödemelerin listesini taşımamalı |
| K32 | `db:reset` | `tax_assets` faturalara yabancı anahtarla bağlı olduğu için `TRUNCATE invoices … CASCADE` ile boşalır. Sabit gider ve harcama kategorisi sınıflandırması da onlarla birlikte yeniden yüklenir. `tax_filings`, `tax_adjustments` ve `tax.settings` kalır. `resetCheck`'in uyarısı "vergi demirbaş listesi (N varlık)" ekler; README'nin db:reset satırına yazılır | Silinmezse varlıklar başka faturalara bağlı kalırdı; sahip elle girdiği listenin silineceğini bilmeli |
| K33 | Başlarken ve taslak durumu | Özet'in başında, hazırlık bitene kadar **"Başlarken"** kartı: (1) Şirket nasıl kuruldu? (2) Giderleri sınıflandırın (N kalem kaldı; demirbaş adayları ve sonradan eklenen kalemler dahil) (3) Demirbaşlar: Kuruluş & Demirbaş faturalarını varlık listesine ekleyin, ömürlerini girin (4) Muhasebecinin rakamları: aylık KDV beyannamesi satışları ve 2026/2 geçici vergi. Adımlar mevcut veriden hesaplanır (yeni tablo yok). `buildTaxView` her çeyrek için `state: "taslak" \| "hazir"` döndürür: hazır = o çeyrekte sınıflandırılmamış kalem ve demirbaş adayı yok, ömrü girilmemiş varlık yok, her ayın geliri mali belgeden (K11 1 ya da 2) ve M11 işaretli. Taslak çeyrekte geçici ve kurumlar vergisi kartında ve takvim satırında "Taslak" rozeti | Sonucun asıl belirleyicisi kurulumun yapılıp yapılmadığı; ekran bunu bir rakamın arkasına saklamamalı |
| K34 | Adlandırma | Ekranda her yerde **"muhasebeci"** (müşavir değil). Onay listesinin adı "Muhasebeciye sorulacaklar" (`#sorular`); işaret "Muhasebecinizle gözden geçirildi (sahibin işareti)". Hiçbir rozet muhasebecinin tabloyu onayladığını ima etmez. Sekme "Vergiye göre", başlığı "Vergiye göre gelir-gider" | "Müşavir onayladı" muhasebecinin doğruladığı izlenimini veriyordu; "onay" kelimesi dalga 10'un Onaylar ekranıyla ⌘K'da karışırdı; menüde iki "Gelir-gider" vardı |

---

## 2. Kural tablosu

### 2.1 Yapı (`src/lib/tax/rules.ts`, `src/lib/tax/rules-2026.ts`)

```ts
export type Confidence = "kesin" | "muhtemel" | "belirsiz";
export interface Rule<T> {
  key: string;                 // "kv.oran"
  title: string;               // "Kurumlar vergisi oranı"
  value: T;
  basis: string;               // "5520 sayılı KVK m.32/1; 7456 sayılı Kanun m.21"
  sources: readonly { label: string; url: string }[];  // en az bir; resmî olan önce; label kısa ad ("GİB · Gelir vergisi tarifesi 2026")
  confidence: Confidence;
  appliesFrom: string;         // YYYY-MM-DD
  note?: string;
  overridable?: boolean;       // K8
  confirm?: AccountantCheckKey; // "muhasebeci onayı gerekir": §14'teki madde
  fixedAmount?: boolean;       // ekranda "sabit tutar" rozeti (beyanname damgaları)
}
export const RULES_COMPILED_AT = "2026-10-24";
export const RULES_VERIFIED_AT: string | null = null;   // resmî metinlerle karşılaştırılınca doldurulur
export const RULES_CHECK_NOTE =
  "Değerler resmî kaynakların ve vergi bültenlerinin özetlerinden derlendi; resmî metinlerin kendisi henüz karşılaştırılmadı.";
export const TAX_RULES: Readonly<Record<number, TaxYearRules>> = { 2026: RULES_2026 };
/** Yılın kuralları; yoksa en son bilinen yıl (estimated) ve elle değerler uygulanmış hâli */
export function rulesFor(year: number, overrides?: TaxOverrides): { rules: TaxYearRules; year: number; fromYear: number; estimated: boolean };
export function allRules(r: TaxYearRules): Rule<unknown>[];   // ekran ve testler için düz liste
```

`TaxYearRules` alan grupları: `kv`, `gecici`, `ucret`, `sgk`, `stopaj`, `kdv` (yalnız sorumlu sıfatıyla KDV-2 oranı;
KDV hesabı yok, K5), `damga`, `vuk`, `takvim`, `enflasyon` ve `bilgi` (hesaplanmayanlar, §2.3). `2027` için dosya
yoktur. `rulesFor(2027)` 2026'yı `estimated: true` ile döndürür.

Kaynak bağlantıları için not: mevzuat.gov.tr'nin kanun PDF'leri `https://www.mevzuat.gov.tr/MevzuatMetin/1.<tertip>.<no>.pdf`
desenindedir (5520 ve 488 için arama sonucuyla doğrulandı). Resmî Gazete'nin 31.12.2025 tarihli 5. mükerrer sayısı
(33124) 332 Seri No GVGT'yi, 71 Seri No DVK GT'yi, 588 Sıra No VUK GT'yi, 59 Seri No BGK GT'yi ve 56 Seri No KDV GUT
değişikliğini birlikte taşır: `https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M5.htm`.

### 2.2 2026 değerleri (hesapta kullanılanlar)

"Onay" sütunu doluysa o değer **muhasebeci onayı gerekir** işaretini taşır (`confirm`); ekranda kuralın yanında
"Muhasebecinize sorun: <madde>" yazar.

| Anahtar | 2026 değeri | Dayanak | Kaynak | Güven | Elle | Onay |
|---|---|---|---|---|---|---|
| `kv.oran` | 0,25 | KVK m.32/1; 7456 s. K. m.21 (RG 15.07.2023). 7582 s. K.'nın %12,5'i 2027+ ve yalnız sanayi sicilli üretim | [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) · [GİB · Kurumlar vergisi oranları](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fkurumlar-vergisi-oranlari.pdf) | kesin | – | – |
| `kv.asgariOran` | 0,10 (asgari matrah: indirim ve istisnalardan önceki kurum kazancı) | KVK m.32/C (7524 s. K., RG 02.08.2024) | [RG · 7524 s. Kanun](https://www.resmigazete.gov.tr/eskiler/2024/08/20240802-2.htm) · [GİB · KV Beyan Rehberi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fonceki-dokumanlar%2F2026_Kurumlar_Vergisi_Beyan_Rehberi.pdf) | kesin | – | – |
| `kv.asgariMuafDonem` | 3 hesap dönemi, başlanan dahil; birleşme, devir, bölünme ve tür değişikliğiyle kurulanlarda yok | KVK m.32/C/5; 1 Seri No KVGT (23 Seri No ile) | [GİB · KV Beyan Rehberi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fonceki-dokumanlar%2F2026_Kurumlar_Vergisi_Beyan_Rehberi.pdf) · [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) | kesin (kural); şirketin durumu bilinmiyor | – | M1 |
| `kv.asgariZararDusulur` | `false`: geçmiş yıl zararı asgari matrahtan düşülmez (23 Seri No KVGT). **Kodda sabit**, Kurallar'da yalnız bilgi | Danıştay 3. D. 25.11.2025, E.2024/5700 K.2025/4831 hükmü iptal etti; kesinleşmesi bilinmiyor. 2029'dan önce etkisi yok (asgari muafiyeti ya da zarar yok) | [Ekonomim · Danıştay kararı](https://www.ekonomim.com/kose-yazisi/danistay-gecmis-yil-zarari-tartismasina-son-noktayi-koydu/871512) | belirsiz | – | M13 |
| `kv.devredenZarar` | Önceki yılların mali zararı, 5 yıl içinde düşülür. Panel **tek alan** tutar: "Önceki yıllardan devreden zarar" (muhasebecinin KV kaydından) | KVK m.9/1-a | [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) | kesin | – | – |
| `kv.beyan` | İzleyen yılın Nisan'ının son günü (beyan ve ödeme) | KVK m.14/3 (beyan), m.21 (ödeme) | [GİB · Beyanname verme ve ödeme süreleri](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2FBeyannameVermeveOdemeSureleri.pdf) | kesin | – | – |
| `gecici.oran` | 0,25 | GVK mük. m.120; KVK m.32/6 | [GVK](https://www.mevzuat.gov.tr/mevzuatmetin/1.4.193.pdf) · [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) | kesin | – | – |
| `gecici.gun` | 17; dönem sonunu izleyen 2. ay (Şubat, Mayıs, Ağustos, Kasım). **4. dönem yeniden verilir** (2025'ten beri) | GVK mük. m.120 (7566 s. K. m.2, RG 19.12.2025); 587 Sıra No VUK GT | [RG · 7566 s. Kanun](https://www.resmigazete.gov.tr/eskiler/2025/12/20251219-1.htm) · [GİB · Beyanname verme ve ödeme süreleri](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2FBeyannameVermeveOdemeSureleri.pdf) | kesin | – | – |
| `gecici.mahsup` | Yıllık kurumlar vergisinden yalnız **ödenmiş** geçici vergi mahsup edilir; ödenmeyen terkin edilir, KV ayrıca ödenir | GVK mük. m.120/3; KVK m.32/6 | [GİB · KV Beyan Rehberi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fonceki-dokumanlar%2F2026_Kurumlar_Vergisi_Beyan_Rehberi.pdf) | muhtemel | – | M8 |
| `ucret.asgariBrut` | 33.030,00 ₺/ay (günlük 1.101,00). Türetilen: asgari net 28.075,50; asgari GV matrahı 28.075,50 | Asgari Ücret Tespit Komisyonu kararı, RG 26.12.2025 (33119) | [RG · Asgari Ücret Tespit Komisyonu kararı](https://www.resmigazete.gov.tr/eskiler/2025/12/20251226-6.pdf) · [ÇSGB · 2026 asgari ücret](https://www.csgb.gov.tr/haberler/2026-yilinda-gecerli-olacak-yeni-asgari-ucret-28-bin-75-lira-olarak-belirlendi/) | kesin | – | – |
| `ucret.tarife` | 190.000 %15 · 400.000 %20 · 1.500.000 %27 · 5.300.000 %35 · üstü %40. Kümülatif vergi 28.500 / 70.500 / 367.500 / 1.697.500 | GVK m.103; 332 Seri No GVGT (RG 31.12.2025, 33124 5. mük.) | [GİB · Gelir vergisi tarifesi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fgelir-vergisi-tarifeleri%2Fgelir-vergisi-tarifesi-2026.pdf) · [Resmî Gazete 31.12.2025 (5. mük.)](https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M5.htm) | kesin | – | – |
| `ucret.tarifeDiger` (bilgi) | 190.000 / 400.000 / **1.000.000** / 5.300.000. Kümülatif 28.500 / 70.500 / **232.500** / **1.737.500** | aynı | [GİB · Gelir vergisi tarifesi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fgelir-vergisi-tarifeleri%2Fgelir-vergisi-tarifesi-2026.pdf) | kesin | – | – |
| `ucret.damgaOrani` | binde 7,59 (asgari ücrete isabet eden kısım istisna: 250,70 ₺/ay) | DVK (1) sayılı tablo IV-1-b; (2) sayılı tablo (7349 s. K.) | [DVK](https://www.mevzuat.gov.tr/mevzuatmetin/1.5.488.pdf) · [GİB · Ücret geliri rehberi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Ffileadmin%2Fbeyannamerehberi%2F2026%2F2026_Ucret_Geliri.pdf) | kesin | – | – |
| `ucret.asgariIstisna` | Türetilir: ay `m` için `tarife(28.075,50 × m) − tarife(28.075,50 × (m−1))`. Ocak–Haziran 4.211,33; Temmuz 4.537,75; Ağustos–Aralık 5.615,10 (yıllık 57.881,23) | GVK m.23/18 | [GVK](https://www.mevzuat.gov.tr/mevzuatmetin/1.4.193.pdf) · [GİB · Ücret geliri rehberi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Ffileadmin%2Fbeyannamerehberi%2F2026%2F2026_Ucret_Geliri.pdf) | kesin | – | – |
| `sgk.pek` | alt 33.030,00 / üst 297.270,00 ₺/ay (alt sınırın 9 katı) | 5510 m.82 (7566) | [SGK · Prime esas kazanç miktarları](https://www.sgk.gov.tr/Content/Post/2e0c9e1a-2cfe-4456-af10-49d3de0c58ba/Prime-Esas-Kazanc-Miktarlari-2026-01-14-10-35-39) | kesin | – | – |
| `sgk.oranlar` | işçi 0,14 + işsizlik 0,01; işveren 0,2175 − Hazine indirimi 0,02 (imalat dışı) = **0,1975** + işsizlik 0,02. Vergi ve nakit planı bu oranları kullanır (K16) | 5510 m.81 (7566 m.23: MYÖ %20 → %21, işveren %12); 5510 m.81/1-(ı); SGK Genelgesi 2026/1. İndirim primler süresinde ödenir ve vadesi geçmiş borç yoksa uygulanır | [5510](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5510.pdf) · [SGK · Güncel teşvik, destek ve indirimler](https://www.sgk.gov.tr/Content/Post/c52f99f0-da6c-4029-9b9a-a0d6f96a6a42/Guncel-Sigorta-Primi-Tesvik-Destek-ve-Indirimleri-2026-01-12-03-04-11) · [SGK · Sigorta primi teşvikleri 2026](https://sgk.gov.tr/Download/DownloadFile?f=c94c643d-2190-4d85-9b14-a8c7c5d241e8.pdf&d=de85036d-ef64-49f1-834c-916a79f1a923) | kesin (kural); işyerinin teşviki bilinmiyor | ✓ `sgk.isverenOran` | M2 |
| `sgk.asgariUcretDestegi` | 42,33 ₺/gün/kişi (30 günde 1.269,90). Yalnız `tax.settings.minWageSupport` açıksa SGK'dan düşülür; emekli çalışanda yok | 5510 geç. m.112 (7573 s. K. m.8, RG 29.01.2026, 33152); SGK Genelgesi 2026/8 (05.03.2026) | [SGK Genelgesi 2026/8 (kopya)](https://www.alomaliye.com/wp-content/uploads/2026/03/sgk-genelgesi-2026-8.pdf) · [KPMG · Asgari ücret desteği](https://kpmgvergi.com/yayinlar/mali-bultenler/sosyal-guvenlik/asgari-ucret-destegi-ve-en-dusuk-emekli-ayligi-hk/3463) | muhtemel | – (yalnız anahtar) | M14 |
| `stopaj.kira` | 0,20 (gerçek kişiye işyeri kirası, brüt üzerinden) | GVK m.94/5-a; BKK 2009/14592 | [GVK](https://www.mevzuat.gov.tr/mevzuatmetin/1.4.193.pdf) | kesin | – | M5 |
| `stopaj.serbestMeslek` | 0,20 (serbest meslek makbuzu) | GVK m.94/2-b | [GVK](https://www.mevzuat.gov.tr/mevzuatmetin/1.4.193.pdf) · [GİB · Serbest meslek kazancı rehberi 2026](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Ffileadmin%2Fbeyannamerehberi%2F2026%2F2026_Serbest_Meslek_Kazanci.pdf) | kesin | – | M6 |
| `stopaj.internetReklam` | 0,15 (internet reklam hizmeti veren ya da aracılık eden gerçek kişiye ve dar mükellef kuruma, ör. Meta; tam mükellef Türk şirketine 0) | GVK m.94; KVK m.15, m.30; CBK 476 (RG 19.12.2018, 30630) | [Muhasebetr · 476 s. CBK](https://www.muhasebetr.com/yazarlarimiz/alidurmaz/005) · [TÜRMOB · İnternet reklam kesintisi](https://turmob.org.tr/ekutuphane/Read/acf2483b-2ccc-49c1-abe0-7bac62d0cf69) | muhtemel (resmî metin okunmadı) | – | M6 |
| `kdv.sorumluYurtDisi` | 0,20: Türkiye'de yararlanılan yurt dışı hizmetin KDV'si alıcı tarafından sorumlu sıfatıyla 2 No.lu beyannameyle ödenir; aynı ay 1 No.lu beyannamede indirilir | KDV K. m.9/1, m.28 | [KDV K.](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.3065.pdf) · [Alomaliye · Yurt dışından reklam hizmeti](https://www.alomaliye.com/2020/08/12/yurt-disinda-mukim-firmadan-alinan-reklam-ve-pazarlama-hizmetinin-vergilendirilmesi-ve-tevkifat-uygulamasi/) | muhtemel | – | M6 |
| `damga.beyanname` | KV 1.605,80 · KDV (1 ve 2 No.lu) 791,00 · muhtasar 791,00 · MPHB 939,70 · yıllık GV 1.189,50 (bilgi) | DVK (1) sayılı tablo IV (beyannameler); 71 Seri No DVK GT (RG 31.12.2025, 33124 5. mük.) | [RG · 71 Seri No DVK GT](https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M5-25.pdf) · [KPMG · 2026 damga vergisi tutarları](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/2026-yilinda-uygulanacak-damga-vergisi-tutarlari/3349) | kesin | ✓ (yalnız tahmini yılda) | – |
| `damga.gecici` | 791,00 ("diğer beyannameler" satırı) | aynı | aynı | muhtemel | ✓ | M15 |
| `damga.mali` | bilanço 616,30 · gelir tablosu 294,20 (KV beyannamesiyle birlikte; KV kartında damga toplamı 2.516,30) | DVK (1) sayılı tablo III (bilanço, gelir tablosu); 71 Seri No | [KPMG · 2026 damga vergisi tutarları](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/2026-yilinda-uygulanacak-damga-vergisi-tutarlari/3349) · [Muhasebetr · 2026 damga oranları](https://www.muhasebetr.com/damga-vergisi-oranlari/) | muhtemel | ✓ (yalnız tahmini yılda) | M15 |
| `vuk.dogrudanGider` | 12.000 ₺ (KDV hariç). Aynı tutar "demirbaş olabilir" eşiğidir (K12) | VUK m.313; 588 Sıra No VUK GT | [VUK](https://www.mevzuat.gov.tr/mevzuatmetin/1.4.213.pdf) · [PwC · Doğrudan gider sınırı](https://www.pwc.com.tr/tr/hizmetlerimiz/vergi/vergi-portali/pratik-bilgiler/hadler-ve-tutarlar/dogrudan-gider-yazilabilecek-demirbaslara-ait-sinir.html) | kesin | – | M7 |
| `takvim` | KDV-1 izleyen ayın 28'i · KDV-2 25'i · MPHB 26'sı · SGK primi izleyen ayın son günü · VUK 18 kaydırması | KDV K. m.41, m.46; GVK m.98; 5510 m.88; VUK m.18 | [GİB · Beyanname verme ve ödeme süreleri](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2FBeyannameVermeveOdemeSureleri.pdf) · [GİB · Vergi takvimi](https://gib.gov.tr/vergi-takvimi) | kesin | – | – |
| `enflasyon` | 2025, 2026, 2027'de yok | VUK geç. m.37 (7571 s. K. m.34, RG 25.12.2025, 33118) | [KPMG · 7571 s. Kanun](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/enflasyon-duzeltmesinin-sartlari-olussa-dahi-2025-2026-ve-2027-yillarinda-uygulanmayacagina-iliskin-yasal-duzenleme-resmi-gazete-de-yayimlandi/3343) · [PwC · Vergi Bülteni 2025/40](https://www.pwc.com.tr/tr/hizmetlerimiz/vergi/bultenler/2025/enflasyon-duzeltmesi-uygulamasini-erteleyen-7571-sayili-kanun.html) | kesin | – | – |

Bu turda: asgari ücret kararının "2025/1" numarası kaldırıldı (aramada doğrulanmadı); KV ödemesinin dayanağı olarak
m.30 (dar mükellef kesintisi) yerine m.21 yazıldı; bilanço ve gelir tablosu damgası (`damga.mali`), internet reklamı
stopajı ve sorumlu sıfatıyla KDV eklendi.

### 2.3 Hesaplanmayanlar (`bilgi` listesi; Kurallar sekmesinde "Bu kafede hesaplanmayanlar", `#bilgi`)

Her biri `{ key, title, status: "uygulanmaz" | "sorulacak" | "bilgi", text, basis, sources, confidence, confirm? }`.

| Kalem | Durum | Metin (kısaltılmış) | Dayanak · kaynak | Güven |
|---|---|---|---|---|
| KKEG: ceza, gecikme zammı ve faizi | bilgi | Düzeltmeler'e "İndirilemeyen gider" olarak girin; gider olarak yazılmışsa matraha geri eklenir | KVK m.11/1-d · [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) | kesin |
| Bağış ve yardım | bilgi | Kurum kazancının %5'ine kadar; Kızılay ve Yeşilay'a nakdî bağışın ve Cumhurbaşkanınca başlatılan kampanyaların tamamı; zarar yılında indirilmez, devretmez. Muhasebecinin söylediği tutar "İndirim" olarak girilir | KVK m.10/1-c · [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) | kesin |
| Binek otomobil sınırları 2026: kira 46.000 ₺/ay; amortisman 1.380.000 / 2.600.000 ₺; ÖTV+KDV 1.200.000 ₺; giderin %70'i | sorulacak | Şirketin binek aracı varsa muhasebecinize sorun; panel hesaplamaz | GVK m.40/5; KVK m.8; 332 Seri No GVGT · [Yöntem YMM · 2026 binek sınırları](https://www.yontemymm.com.tr/mali-aciklamalar/2026-005-binek-otomobil-gider-kisitlamasinda-2026-yilinda-uygulanacak-tutarlar) | muhtemel |
| Finansman gider kısıtlaması %10, örtülü sermaye ve kazanç, ortaklar cari hesabı (adat) | sorulacak | Kredi ya da ortağa borç varsa muhasebecinize sorun (M16) | KVK m.11/1-i, m.12, m.13 · [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) | kesin (kural) |
| Ortağın hesabına şirket adına alınan faturalar ("Alp Koç": Pruva, kola, su) | sorulacak | Şirketin gideri değildir, KDV'si indirilemez; ortaklar carisine borç yazılır. Beyannamede indirildiyse muhasebecinize sorun. Ayar kapalıyken de listelenir (K3) | KVK m.8, m.13; KDV K. m.29 · [KVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5520.pdf) · [KDV K.](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.3065.pdf) | muhtemel |
| Limited şirket ortaklarının Bağ-Kur (4/b) primi | bilgi | 2026 alt sınırı 11.808,23 ₺/ay (%35,75); süresinde ödenir ve borç yoksa 5 puan indirimle 10.156,73 ₺. Ortağın şahsi borcudur; şirketten ödenirse gider değil, ortaklar carisidir | 5510 m.4/1-b, m.81, m.82 · [5510](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5510.pdf) · [Alomaliye · 4/b 5 puan indirimi 2026](https://www.alomaliye.com/2026/08/18/4-b-bag-kur-5-puan-prim-indirimi-2026/) | muhtemel |
| Zayi malın KDV'si, ikramın KDV'si ve gelir karşılığı | sorulacak | Panel hesaplamaz; Zayi & ikram kayıtları muhasebeciye bilgi verir (M12) | KDV K. m.30/c · [KDV K.](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.3065.pdf) | kesin (kural) |
| İndirimli oran KDV iadesi, alt sınır 164.000 ₺ | bilgi | Panel iade tahmin etmez, devreden KDV'yi gösterir | KDV GUT III/B-3; 56 Seri No · [KPMG · 2026 KDV iade alt sınırı](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/2026-yilinda-uygulanacak-kdv-iade-alt-siniri-164000-tl-olarak-belirlendi/3354) | kesin |
| Fatura düzenleme sınırı 12.000 ₺ (KDV dahil) | bilgi | Bu tutarı aşan alımda fatura istenmelidir; altında ÖKC fişi belgedir (M10) | VUK m.232; 588 Sıra No VUK GT · [Yöntem YMM · 2026 had ve tutarlar](https://www.yontemymm.com.tr/mali-aciklamalar/2026-016-2026-yilinda-vergi-mevzuatinda-gecerli-olacak-bazi-had-ve-tutarlar) | muhtemel |
| Emlak vergisi (işyeri binde 2, büyükşehirde binde 4) | uygulanmaz | Kirada mal sahibinin yükümlülüğü | 1319 s. EVK · [EVK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.1319.pdf) | kesin |
| Çevre temizlik vergisi (işyeri) | bilgi | Tutar bina grubu ve derecesine göre belediyenin tahakkukundadır; emlak vergisi taksit sürelerinde (Mayıs ve Kasım sonu) iki taksitte ödenir. Hatırlatıcı yoksa takvimde tutarsız satır (K23) | BGK mük. m.44; 59 Seri No BGK GT · [KPMG · 2026 ÇTV](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/2026-yilinda-uygulanacak-cevre-temizlik-vergisi-tutarlari/3356) · [TÜRMOB · ÇTV taksitleri](https://www.turmob.org.tr/ekutuphane/Read/e7aa8cf2-ec16-49b5-8d80-d3797971c0f7) | muhtemel |
| İlan ve reklam vergisi (tabela) | bilgi | Tabela asılmadan belediyeye beyan edilir ve vergi bu sürede ödenir; ışıksız 1/2 m²'ye kadar muaf; tarife belediye meclisinin (M18) | BGK m.12–17 · [BGK](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.2464.pdf) | muhtemel |
| Turizm payı binde 7,5 | sorulacak | Kültür ve Turizm Bakanlığı belgesi varsa sorun | 7183 s. K. · [7183](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.7183.pdf) | muhtemel |
| Kâr payı stopajı %15 | bilgi | Kâr dağıtılırsa dağıtım anında; sermayeye ekleme dağıtım değildir | GVK m.94/6-b-i; CBK 9286 (RG 22.12.2024) · [GİB · 9286 s. CBK notu](https://gib.gov.tr/sites/default/files/fileadmin/mevzuatek/ck9286not.pdf) · [KPMG · 9286](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/9286-sayili-cumhurbaskani-karari-ile-kar-payi-stopaj-orani-15-e-cikarildi/2893) | kesin |
| Gecikme zammı aylık %3,7; tecil faizi yıllık %39 | bilgi | Hepsi indirilemeyen giderdir. Haziran 2026'daki %29'luk tecil faizi 31.08.2026'ya kadarki başvurular içindi | 6183 m.48, m.51; CBK 10556 (RG 13.11.2025) · [RG · 10556 s. CBK](https://www.resmigazete.gov.tr/eskiler/2025/11/20251113-2.pdf) · [KPMG · gecikme zammı](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/10556-sayili-cumhurbaskani-karariyla-gecikme-zammi-orani-3-7-olarak-yeniden-belirlendi/3295) · [İTO · tecil sunumu](https://ito.org.tr/documents/cem-taskaldiran-sunum.pdf) | kesin (zam) / muhtemel (tecil) |
| 7582 sayılı Kanun ve tecil | bilgi | Kafe hesabına etkisi yok. Vergi borcu tecili 72 ay; teminatsız tecil sınırı CBK 11414 ile 10.000.000 ₺ | [RG · 7582 s. Kanun](https://www.resmigazete.gov.tr/eskiler/2026/06/20260604-1.htm) · [Alomaliye · tecil sınırı](https://www.alomaliye.com/2026/06/13/amme-alacaklarinin-tecil-sinirinda-yeni-duzenleme/) | muhtemel |
| Ba-Bs formları | uygulanmaz | Eylül 2024'ten beri yok (565 Sıra No VUK GT, RG 25.09.2024); hatırlatıcı açmayın | [VUK](https://www.mevzuat.gov.tr/mevzuatmetin/1.4.213.pdf) | muhtemel |
| e-Fatura / e-Defter | sorulacak | Vergi hesabını değiştirmez; e-Defter durumunu sorun | 509 Sıra No VUK GT · [GİB · e-Belge](https://ebelge.gib.gov.tr) | muhtemel |
| Yemek ve yol bedeli | bilgi | İşyerinde verilen yemek GV ve SGK'dan tam istisna; dışarıda yemek bedeli GV'de günlük 300 ₺, SGK'da 17.04.2026'dan beri günlük 300 ₺; toplu taşıma 158 ₺/gün. Bordroya bırakılır | GVK m.23/8; 5510 m.80 (7577 s. K.); SGK Genelgesi 2026/12 · [GİB · Yemek bedeli tutarları](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fyemek-bedeli-istisna-tutarlari.pdf) · [RG · 7577 s. Kanun](https://www.resmigazete.gov.tr/eskiler/2026/04/20260417-21.htm) | muhtemel |
| Sosyal içerik üreticisi (influencer) istisnası | sorulacak | GVK 20/B istisnası kullanılıyorsa kesintiyi banka yapar, bizim muhtasarımıza girmez; serbest meslek makbuzu kesiyorsa %20 stopaj (M6) | GVK m.20/B, m.94 · [GVK](https://www.mevzuat.gov.tr/mevzuatmetin/1.4.193.pdf) | muhtemel |
| Sözleşme damgası | bilgi | Kira sözleşmesi binde 1,89 (süre boyunca toplam kira), diğer sözleşmeler binde 9,48, kâğıt başına üst sınır 29.115.961,10 ₺. İmza ayında bir kez, muhtasarla ödenir; taraflar müteselsil sorumludur. Panel hesaplamaz (§19) | DVK (1) sayılı tablo I/A-1, A-2; 71 Seri No · [DVK](https://www.mevzuat.gov.tr/mevzuatmetin/1.5.488.pdf) · [KPMG · 2026 damga vergisi tutarları](https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/2026-yilinda-uygulanacak-damga-vergisi-tutarlari/3349) | kesin |
| Kafede alkollü içecek | sorulacak | KDV tahmini bütün ürünlere Ayarlar'daki oranı uygular; alkol varsa o kısım %20'dir (M17) | KDV K. m.28 · [KDV K.](https://www.mevzuat.gov.tr/MevzuatMetin/1.5.3065.pdf) | kesin (kural) |

### 2.4 Elle değerler (override)

`overridable: true` olan kurallar: `sgk.isverenOran` (teşvik varsa; not zorunlu, ör. "6111 teşviki, muhasebeci
24.11.2026"), `damga.gecici` ve yalnız tahmini yılda `damga.beyanname.*`, `damga.mali.*`.
`kv.asgariZararDusulur` kodda sabittir; asgari ücret desteği yalnız `minWageSupport` anahtarıyla yönetilir.

Kayıt biçimi:

```ts
overrides: Record<string, { value: number | boolean; note: string; by: string; date: string }>
```

- Not zorunludur ve kaynak yazılır (ör. "71 Seri No'nun 2027 karşılığı, RG …").
- Kural tablosunda olmayan bir anahtar okunurken atılır.
- Sayısal değer sonlu ve ≥ 0 olmalıdır; `sgk.isverenOran` 0–0,2175 arasında.

### 2.5 Bayatlama

- Bugün `RULES_COMPILED_AT`'ten 90 günden eskiyse üst banda şu eklenir: "Kural tablosu 90 günden eski; yeni tutarlar
  açıklanmış olabilir."
- Bakılan yılın kuralı yoksa şu eklenir: "2027 kuralları tabloda yok; 2026 değerleri kullanılıyor (tahmini)."
- Test (§11) iki koşulu da sınar. Kodda tarih kendiliğinden ilerlemez; yeni yıl yeni dosyayla gelir.

---

## 3. Hesaplar

### 3.1 Dönemler ve günler (`src/lib/tax/calendar.ts`)

- `legalDueDate(date)`: gün Cumartesi ya da Pazar'sa, ya da `TR_CALENDAR`'da `resmi`, `ramazan-bayrami` ya da
  `kurban-bayrami` türündeyse ertesi güne geçilir; iş gününe gelene kadar sürer. `arife` kaydırmaz. Dönüş
  `{ date, shifted, reason }`, reason örneği "25 Ekim Pazar".
  - `CALENDAR_COVERAGE.holidaysTo`'dan sonraki günlerde yalnız hafta sonu kaydırılır ve
    `reason: "tatil listesi 2028'de bitiyor"` döner.
- Nominal günler:
  - `kdv1(P)` = P+1'in 28'i;
  - `kdv2(P)` = P+1'in 25'i;
  - `mphb(P)` = P+1'in 26'sı;
  - `sgk(P)` = P+1'in son günü;
  - `gecici(Y, q)` = q=1: Y-05-17, q=2: Y-08-17, q=3: Y-11-17, q=4: (Y+1)-02-17;
  - `kv(Y)` = (Y+1)-04-30;
  - `ctv(Y, taksit)` = Y-05-31 ve Y-11-30 (belediyenin tahakkukundaki gün öncelikli; not yazar).
- Hesap dönemi: `periodOf(year, settings)` = `{ from: max(Y-01-01, periodStart), to: Y-12-31 }`. Çeyrek `q`'nun
  aralığı dönemle kesişir. 2026'da Q1 dönem dışıdır, Q2 25.06–30.06'dır.
- `quarterOfDue(date)`: hatırlatıcı gününden çeyrek. 17 Şubat Y → (Y−1, Q4), Mayıs → Q1, Ağustos → Q2, Kasım → Q3.
  Ertelenmiş kopyada asıl gün `postponedFrom(note)`'tan alınır, `vatPeriodOf`'taki gibi.
- `mphbPeriodOf(date)`: önceki ay. Ayın 1–7'si iki ay önceye sayılır (KDV'deki erteleme kuralı).
- `defaultYear(today, kvFilings, settings)`: bugün 30 Nisan Y'den önce ya da o gündeyse, Y−1 hesap dönemi içindeyse ve
  Y−1 için KV kaydı yoksa Y−1; değilse Y. Örnek: 2027-03-01 → 2026, 2027-05-01 → 2027. Yıl seçici yalnız iki ya da
  daha fazla yıl varken görünür.
- `defaultQuarter(today, year)`: geçici vergi günü bugünden sonra gelen ilk çeyrek (24.10.2026 → 2026-Q3); yıl
  seçildiyse o yılın son verili çeyreği.

### 3.2 Vergiye göre gelir-gider (`src/lib/tax/pnl.ts`)

Her ay M için (hesap döneminin ilk ayından bugünün ayına kadar). İlk ayda `from` = `periodStart`; faturalar o günden
sayılır. Süren ay `inProgress`'tir ve tamamlanmaz.

**Gelir** (KDV hariç; kaynak K11'deki sıradadır ve ayın satırında rozet olarak yazar):

| Kaynak | Satırlar | Rozet |
|---|---|---|
| (1) KDV beyannamesi (`kdv_matrah` kaydı) | "KDV beyannamesindeki satışlar (şirketin tamamı)": `%1 + %10 + %20 matrah + istisna ve diğer`; "Kafe dışı kısmı (muhasebecinin söylediği)": `− kafeDisi` (girildiyse). laffogato.net ve kafe dışı gelir düzeltmesi bu ay eklenmez | "mali belge · beyanname" |
| (2) Yazarkasa mali Z (dalga 13) | "Yazarkasa Z raporları": ayın Z'lerinin oran oran KDV hariç matrah toplamı; ayın her açık günü için Z varsa. + laffogato.net | "mali belge · Z" |
| (3) Yönetim verisi | "Kasa satışları (ModPOS)": `pnlMonth(M).revenueNet` (yoksa 0, "ciro girilmedi"). + laffogato.net | "Yönetim verisi (ModPOS), mali belge değil" |
| laffogato.net (2 ve 3'te) | `site.total − karaoke.refundPendingMinor / 100` (kafe, mağaza, karaoke; iadesi bekleyen karaoke düşülür) | "yaklaşık; e-Arşiv tarihinden farklı olabilir" |
| Kafe dışı gelir (2 ve 3'te) | düzeltme `gelir_kafe_disi` toplamı | "elle" |
| Diğer gelir (faiz, kur farkı…) | düzeltme `gelir_diger` toplamı (her kaynakta; KDV matrahına girmez) | "elle" |

- Ekim 2026'nın kasa cirosu 1–16 günlükse satır "16 gün" der.
- Muhasebeci kaydı girilmiş (çapa) bir çeyreğe sonradan düşen iade ya da düzeltme o çeyreğin hesabını değiştirmez
  (K21: çapadan önceki aylar toplanmaz); yalnız ay görünümünde görünür.

**Gider** (KDV hariç, aksi yazılmadıkça):

| Satır | Değer | Esas |
|---|---|---|
| Satılan malın maliyeti | `opening + taxPurchases − closing`. `opening` ve `closing` `pnlMonth`'tan (elle düzeltme dahil). **Çeyrek hesabında** çeyreğin son ayının `closing`'i sayım yoksa en son ay sonu sayımıdır (K15). `taxPurchases` = mal faturalarının `amount − discount` toplamı (varlığa bağlı kısım hariç) + belgeli mal harcamaları ÷ 1,10 + `manual:diger_mal` ÷ 1,10 (yalnız `belgeli`) | tahakkuk; sayım uyarısı |
| Faturalar | kafe kategorilerinden mal, Kuruluş & Demirbaş, kafe dışı ve **demirbaş adayı** olmayan her faturanın `amount − discount − varlığa bağlı maliyet`'i (en az 0). Kategori kategori döküm. Komisyon faturaları dahil | fatura tarihi |
| Demirbaş olabilir (sınıflandırıldıysa) | "Gider (demirbaş değil)" denen adayların neti | fatura tarihi |
| Personel (bordro) | `taxPayroll(M)`: Σ (brüt + işveren SGK + işveren işsizlik + ek ödemeler), yasal oranlarla. Gelir-gider'de `personnel:net` ya da `personnel:employer` elle girildiyse o ay **elle girilen toplam** kullanılır ve "Gelir-gider'de elle girilen bordro" yazar | hizmet ayı |
| Belgesi muhasebecide olan giderler | `belgeli` işaretli sabit giderler (Gelir-gider'deki `fixed:<id>` hücresi, elle düzeltme dahil), elle satırlar (`manual:*`) ve Aylık harcamalar (aşağıda). Fişli tutarlar KDV hariç tahmin: mal bölümünde ÷ 1,10, diğerlerinde ÷ 1,20 | tahmini tutar ("Giderler'de girilen") |
| POS komisyonu | K12a | tahmini |
| Kafe dışı gider | düzeltme `gider_kafe_disi` + `includeSeparate` açıksa kafe dışı faturalar | elle / fatura |
| Belgeli gider (panelde yok) | düzeltme `gider_belgeli` | elle |

**Aylık harcamalar** (`expense_entries`) kayıt kayıt değerlendirilir:
1. Kasadan çıkan bir satıra bağlıysa (`cashOutId`) → çıkanın belgesi: `fis`, `e_arsiv` ya da `fatura` ise sayılır
   (KDV hariç tahmin), `yok` ise "Belgesi yok".
2. Değilse ve dalga 11'in bir borcuna aitse (`supplierEntryId` dolu) → "Belgesi yok" (cari borcun "Faturası yok"
   kipi). Dalga 11'in "Gideri zaten girildi" (`mevcut`) adayı kasadan çıkan kayıt olamaz (cari planı §3.1.3), bu
   yüzden 1. kural önce gelse de sonuç değişmez; sıra savunma içindir.
3. Değilse → kategorinin `taxDoc`'u (boşsa sayılmaz, listede durur).
- Kategori bir fatura kategorisine bağlı olsa bile o faturalar burada sayılmaz; "Faturalar" satırında zaten var.

**Sayılmayanlar** (`excluded`, ekranda "Vergi hesabına girmeyen giderler"). Her biri kaynağı, tutarı ve nedeniyle:
- sınıflandırılmamış (`null`);
- `bordro` ("Personel'e ekleyin");
- `fatura` ("Paraşüt'te faturası var");
- `yok` ("Belgesi yok": ekranda yalnız **toplam ve sayı**; kalemler satırda görünür ama Excel'e, işlem geçmişine ve
  Claude'a kalem kalem gitmez);
- demirbaş adayları (sınıflandırılmamış);
- varlık listesine eklenmemiş Kuruluş & Demirbaş faturaları;
- kafe dışı faturalar (ayar kapalıyken); "Alp Koç" ayrıca notla.

**Sonuç:** `result = incomeTotal − expenseTotal`. Amortisman, indirilemeyen gider ve indirim ay satırına girmez;
çeyrek ve yılda eklenir (§3.7).

**Alt sınır (K13):** `floor` = aynı hesap; sınıflandırılmamış kalemler `belgeli`, demirbaş adayları gider, varlık
listesine eklenmemiş Kuruluş & Demirbaş faturaları ve ömrü girilmemiş varlıkların maliyeti tamamen gider sayılarak.
Yalnız "Nasıl hesaplandı"da, tanımıyla yazar.

**Köprü** (`bridge(month)`, saf): Gelir-gider ekranındaki **giderden** vergiye göre gidere: "Gelir-gider'deki gider X →
sayılmayan giderler −A · demirbaş (gider yerine amortisman) −B · bordro farkı ±C · POS komisyonu farkı ±D · düzeltmeler
±E → vergiye göre gider Y". Gelir tarafında yalnız kaynak yazar ("Gelir: KDV beyannamesi" / "Gelir: Gelir-gider'deki
kasa cirosu, yönetim verisi"); iki gelir arasındaki fark yazılmaz (K11). Personel satırı: "Gelir-gider'deki personel
116.018 ₺: maaşlar ≈ 83.200 ₺ ve personel bölümündeki sabit giderler ≈ 32.900 ₺; vergide maaşlar bordroyla, diğerleri
belgesine göre sayılır."

### 3.3 Demirbaş ve amortisman (`src/lib/tax/assets.ts`)

- Yıllık tutar: `annual = cost / lifeYears`.
- Yıl yıl dağılım: edinilen yıl `Y0`'dan başlar, `lifeYears` yıl sürer. Her yıl `min(annual, kalan)`'dır; son yıl kalanı
  alır. Hepsi kuruşa yuvarlanır ve son yıl farkı kapatır.
- Çeyrek payı (`tax.settings.quarterDepreciation`):
  - `"kalan"` (varsayılan): edinilen yılda, edinilen çeyrek `q0` dahil kalan `n = 5 − q0` çeyreğe eşit bölünür;
    sonraki yıllarda `n = 4`. Her çeyrek `r2(yıllık / n)`; yılın son çeyreği kalanı alır.
  - `"ay12"`: çeyrek sonu kümülatif payı `r2(yıllık × kümülatif ay ÷ 12)`; çeyreğin payı kümülatifin farkı. Edinilen
    yılda kümülatif ay yılbaşından sayılır (Q3: 9/12); yıl sonu toplamı iki yöntemde aynı.
  - Hesap dönemi dışındaki çeyreklerin payı yoktur. 2026'da Q1 dönem dışıdır.
  - Excel'deki XND faturaları (338.169,58 + 540.586,50 + 69.924,33) ayrı ayrı 5 yıllık varlık olursa 2026 amortismanı
    67.633,92 + 108.117,30 + 13.984,87 = 189.736,09'dur. `"kalan"`: Q3 94.868,05, Q4 94.868,04. `"ay12"`: Q3
    142.302,07, Q4 47.434,02.
- `method = "dogrudan_gider"` → maliyetin tamamı edinilen ayın gideridir ("Faturalar"ın yanında "Doğrudan gider
  yazılan demirbaş" satırı). Yalnız `cost ≤ vuk.dogrudanGider` iken seçilebilir; eylem büyüğünü reddeder.
- `lifeYears = null` → amortisman 0, uyarı: "N varlığın faydalı ömrü girilmedi; amortisman hesaplanmadı (vergi yüksek
  çıkar)."
- Bir faturaya bağlı varlıkların maliyetleri toplamı faturanın netini aşamaz (eylem reddeder). Kalan kısım
  "eşlenmemiş tutar" olarak gösterilir. Kuruluş & Demirbaş faturasında eşlenmemiş tutar sayılmaz; diğer kategoride o
  kategorinin gideri olarak kalır.
- **Demirbaş adayları** (`assetCandidates(invoices, assets, decisions)`): K12'deki kural. Karar "Gider (demirbaş
  değil)" ise `invoices.tax_not_asset = true` yazılır; "Varlık olarak ekle" bir `tax_assets` satırı açar.
- **Faturası silinen varlık** (`invoice_id` null, `invoice_label` dolu): Demirbaş'ta ve Özet'te uyarı: "Faturası Paraşüt'te iptal edildi: yeni faturaya
  bağlayın". Uyarıda "Bağla" düğmesi ve aday faturalar (aynı tedarikçi, ±%5 tutar, ±60 gün). Bağlanana kadar yeni
  faturanın tamamı gider sayılıyorsa uyarı çift sayılan tutarı yazar.

### 3.4 Bordro (`src/lib/tax/payroll.ts`)

Bir kişi ve ay `m` (1–12) için girdiler: `net` (`staffAtMonth`'ın `netSalary`'si), `cumPrev` (aynı yılda bu
işverendeki önceki ayların GV matrahı toplamı), kural tablosunun SGK oranları (elle `sgk.isverenOran` uygulanmış) ve GV,
DV parametreleri.

```
pekBase   = clamp(brüt, sgk.pek.alt, sgk.pek.ust)
işçiSgk   = r2(pekBase × 0,14);  işçiİşsizlik = r2(pekBase × 0,01)
gvMatrah  = r2(brüt − işçiSgk − işçiİşsizlik)
cum       = r2(cumPrev + gvMatrah)
gvHesap   = r2(tarife(cum) − tarife(cumPrev))
gvİstisna = asgariIstisna(m)                       // §2.2, kuruşa yuvarlı
gv        = max(0, r2(gvHesap − gvİstisna))
dv        = max(0, r2(brüt × 0,00759 − r2(asgariBrut × 0,00759)))     // 250,70
net'       = r2(brüt − işçiSgk − işçiİşsizlik − gv − dv)
işverenSgk = r2(pekBase × 0,1975); işverenİşsizlik = r2(pekBase × 0,02)
maliyet   = r2(brüt + işverenSgk + işverenİşsizlik) (+ ek ödemeler)
```

- **Netten brüt:** `net' ≥ net` olan en küçük kuruşluk brüt aranır. İkiye bölme `[net, 2 × net]` aralığında yapılır,
  sonra kuruş kuruş ilerlenir.
- **Yuvarlama:** `r2(x) = Math.round(x × 100 + 1e−6 × sign(x)) / 100`. Yarım yukarı yuvarlanır. Kayan nokta yüzünden
  4.211,325 4.211,32'ye düşmesin.
- **Kümülatif matrah** yılbaşında sıfırlanır. Personelin ilk ayından başlar:
  - ilk ay `startMonth`'tur; boşsa **ilk satış ayıdır** (`posRevenue > 0` olan ilk ay; Excel'de Temmuz 2026);
  - `periodStart`'ın ayından önce olamaz.
- **Kişi başına `days` yoktur:** aylar tam sayılır (K16). Kısmi süreli çalışan bu sürümde desteklenmez; not yazılır.
  Personel bölümündeki "Part-time çalışan" gibi kalemler için sınıflandırma listesi "Bordroya ekleyin; kısmi süreli
  SGK gün sayısıyla bildirilir" der (K12).
- Asgari ücretli tutar birebir çıkar: brüt 33.030,00 → net 28.075,50, GV 0, DV 0. İşveren maliyeti %19,75 ile
  40.214,03 (ÇSGB tablosu).
- Ek ödemeler (`extras`) GV ve SGK matrahına girmez; yalnız maliyete eklenir. Not: "Ek ödemeler vergisiz sayıldı
  (yemek ve yol istisnası içindeyse doğru); prim ise brüte eklenmeli".
- `minWageSupport` açıksa aylık SGK toplamından `kişi × 30 × 42,33` düşülür. Satırı ayrıdır: "Asgari ücret desteği
  (şartlı)".

`taxPayroll(staff, year, rules, opts)` her ay için `{ people: Payslip[]; totals }` döndürür. `totals` alanları:
`gross`, `net`, `extras`, `isciSgk`, `isciIssizlik`, `isverenSgk`, `isverenIssizlik`, `gv`, `dv`, `cost`, `sgkTotal`
(dört pay, destek düşülmüş), `people`.

### 3.5 Muhtasar (`src/lib/tax/muhtasar.ts`)

Ay P için:

```
ücretGv   = Σ gv (bordro P)          ücretDv = Σ dv
stopaj    = Σ_sabit gider f (f'nin P tutarı × oran(f.taxWithholding))
            // kira 0,20 · serbest_meslek 0,20 · internet_reklam 0,15 · internet_reklam_yurtdisi 0,15 · yok / yurt_disi_hizmet 0
bilinmeyen = profilsiz sabit giderler: kira bölümündekiler (notKira hariç) ve adı PANEL_GROUP_KEYWORDS.reklam ya da
             .notPersonel'e uyanlar
vergi     = ücretGv + ücretDv + stopaj
damga     = personel > 0 ? 939,70 : (vergi > 0 ? 791,00 : 0)
ödenecek  = vergi + damga            // gün: legalDueDate(mphb(P)); bilinmeyen > 0 ise "en az"
kdv2Hizmet = Σ (internet_reklam_yurtdisi ve yurt_disi_hizmet tutarları) × 0,20   // gün: legalDueDate(kdv2(P))
```

- **"En az":** `bilinmeyen` doluysa tutar "en az 974 ₺; 4 kalemin stopajı bilinmiyor" diye yazar ve kalemlerin adı
  açılır ayrıntıdadır (Excel verisinde Kira, Instagram reklamı, Influencer, Muhasebeci). Profil "Stopaj yok" seçilen
  kalem bilinmeyen sayılmaz.
- **Üç aylık seçenek:** `vergi` yalnız Mart, Haziran, Eylül ve Aralık dönemlerinde, üç ayın toplamı olarak ödenir;
  diğer aylarda yalnız `damga`.
- **Muhasebeci kaydı** (`mphb`, P) varsa `ödenecek = payable + stamp`, "en az" yazmaz. Döküm alanları doluysa yanında
  gösterilir.
- **Geçmiş ve süren dönem:** takvim, hatırlatıcıda ya da muhasebeci kaydında tutar yoksa önce "Tahakkuk fişindeki
  tutarı girin" der; tahmin altında küçük yazılır.
- Tutar sabit giderin **brüt** tutarıdır. Formdaki ipucu: "Tutar brüt olmalı; elinize geçen tutarı yazdıysanız
  brüt = net ÷ 0,80." Yurt dışına ödenen internet reklamında stopaj ödenen tutar üzerinden yaklaşık hesaplanır;
  brütleştirme muhasebeciye sorulur (M6).
- `kdv2Hizmet` nakit planında ayrı satırdır (§8.2); o dönemi kapsayan, tutarı yazılmış KDV-2 hatırlatıcısı varsa
  girmez (hatırlatıcının tutarı tahakkuk toplamıdır). Aynı ay 1 No.lu beyannamede indirilir; panelin KDV-1 tahmini bunu
  görmez (not).

### 3.6 SGK

- Ay P'nin primi, P+1'in son günü ödenir (5510 m.88; tatilde ilk iş günü).
- Tutar `taxPayroll(P).totals.sgkTotal`'dır (yasal oranlar). Nakit planı da aynı değeri kullanır (K18).
- Kesin tutar SGK hatırlatıcısındaki tutardır (bugünkü gibi); geçmiş ve süren dönemde takvim "Tahakkuk fişindeki
  tutarı girin" der.
- Takvim satırının ayrıntısında:
  - döküm: işçi SGK, işçi işsizlik, işveren SGK, işveren işsizlik; kullanılan oranlar;
  - "Hazine indirimi (2 puan) primler süresinde ödenirse ve vadesi geçmiş borç yoksa uygulanır; geç ödenen ayda
    işveren payı %21,75'tir.";
  - Ayarlar'daki oran farklıysa: "Gelir-gider Ayarlar'daki %15,75'i kullanıyor; vergi ve nakit planı yasal oranı".

### 3.7 Geçici vergi (`src/lib/tax/corporate.ts`)

Çeyrek q için (yalnız hesap dönemiyle kesişenler):

```
dönemSonucu(q) = Σ aylar result − amortisman(q) − doğrudanGider(q) + kkeg(q)
              // kkeg: düzeltme "kkeg" (gider içinde kalmış, indirilemeyen tutarlar)
çapa = en son muhasebeci kaydı f (gecici, dönem p < q, values.matrah dolu) — yoksa yok
kümülatifKazanç(q) = f ? f.values.matrah + Σ_{p<r≤q} dönemSonucu(r) : Σ_{r≤q} dönemSonucu(r)
indirim(q)  = Σ dönem başından q'ya "indirim" düzeltmeleri (çapa varsa yalnız çapadan sonrakiler)
zarar       = min(max(0, kümülatifKazanç), devredenZarar)     // §3.8; 2026'da 0
matrah(q)   = max(0, kümülatifKazanç − zarar − indirim)          // indirim zarar yaratmaz
hesaplanan  = r2(matrah × 0,25)
asgari      = asgariUygulanır ? r2(max(0, kümülatifKazanç) × 0,10) : null      // zarar düşülmez (kv.asgariZararDusulur)
kümülatifVergi = max(hesaplanan, asgari ?? 0)
önceki(q)   = f ? f.values.hesaplanan + Σ_{p<r<q} ödenecek(r) : Σ_{r<q} ödenecek(r)
ödenecek(q) = max(0, r2(kümülatifVergi − önceki))
damga(q)    = 791,00 (her dönem, sıfır beyanda da)
floor(q)    = aynı hesap §3.2 alt sınırıyla ve ömrü girilmemiş varlıkların maliyeti gider sayılarak
```

- **Muhasebeci kaydı** (`gecici`, q) varsa: `ödenecek = filing.payable`, `damga = filing.stamp`, kaynak "Muhasebeci",
  başlık "Şirketin beyannamesi". Matrahı girildiyse sonraki çeyreğin çapası olur; girilmediyse kart "Sonraki tahmin
  panelin verisiyle (matrah girilmedi)" der.
- **`asgariUygulanır`** = `firstActivity !== "ilk"` ya da `yıl > başlangıçYılı + 2`. Muaf yılda "Asgari kurumlar
  vergisi: uygulanmaz (ilk 3 hesap dönemi, 2026–2028)" yazar. `firstActivity` boşsa "uygulandı; muafiyet için ilk
  defa faaliyete başlama işaretlenmedi (Kurallar › Vergi ayarları)" yazar.
- **Durum** (`state`, K33): `taslak` ya da `hazir`. Taslakta kart başlığı tek rakam değildir: "Giderler
  sınıflandırılınca netleşir · şimdilik en çok ≈ 68.900 ₺" ve altında "808.610 ₺ gider henüz hesaba girmedi (24 kalem)
  · Giderleri sınıflandır".
- **Tamamlık:** `complete` = çeyreğin son günü < bugün. Değilse "Dönem sürüyor: bugüne kadarki veriyle".
- **Kapsam:** kart başlığı "Kafenin geçici vergi matrahına katkısı (yalnız kafe)" ya da "… (kafe + elle girilen kafe
  dışı)"; gelir beyannameden geliyorsa "Gelir şirketin tamamı (beyanname), gider yalnız kafe: kafe dışı giderleri
  girmezseniz rakam yüksek çıkar".
- **Dökümde** amortisman yöntemi yazar ("Amortisman: kalan çeyreklere eşit").

### 3.8 Kurumlar vergisi (yıllık)

```
yıllıkKazanç = (kv kaydı varsa onun matrahı) ; yoksa Q4'ün kümülatifKazanç'ı (Q4 kaydı çapa olabilir)
zarar        = min(max(0, yıllıkKazanç), devredenZarar)   // tek alan: önceki yılın KV kaydındaki "Sonraki yıllara devreden zarar"
matrah       = max(0, yıllıkKazanç − zarar − indirim)
hesaplanan   = r2(matrah × 0,25); asgari = §3.7 gibi; KV = max(hesaplanan, asgari ?? 0)
ödenmiş      = Σ yılın geçici vergileri, yalnız "Ödendi" işaretli dönemler (payments.vat-paid, tür gecici)
               tutar: muhasebeci kaydının payable'ı, yoksa Ödendi anındaki hatırlatıcı tutarı, o da yoksa tahmin
ödenecek     = max(0, KV − ödenmiş); iadeAlacağı = max(0, ödenmiş − KV)
damga        = damga.beyanname.kv + damga.mali.bilanco + damga.mali.gelirTablosu   // 2026: 2.516,30
               (izleyen yılın tutarı; bilinmiyorsa 2026'nınki, "2027 tutarı açıklanmadı")
yıllıkKazanç < 0 → oluşan mali zarar = −yıllıkKazanç ("sonraki 5 yılın kazancından düşülür")
```

- Ödendi işaretlenmemiş dönem için satır: "2026/3 ödendi olarak işaretlenmedi: ödenmezse yıllık beyannamede mahsup
  edilemez." (`gecici.mahsup`, M8).
- 2026 bu şirketin ilk yılıdır; devreden zarar 0'dır. FIFO ve süre dolumu yok (§19, `rules-2027`).
- Süren yılda başlık: "Bugüne kadarki kârla (yıl sonu tahmini değil)".

### 3.9 Damga vergisi

- **Beyanname damgaları:** her KDV-1 (aylık), KDV-2 (yalnız tevkifat ya da yurt dışı hizmet olan ay), MPHB ya da
  muhtasar, geçici vergi ve kurumlar vergisi beyannamesi için §2.2 tutarı; KV ile birlikte bilanço ve gelir tablosu.
  Gün beyannamenin günüdür.
  - Aylık sabit toplam (KDV + KDV-2 + MPHB) 2.521,70 ₺; tevkifatsız ayda 1.730,70 ₺.
- **Ücret damgası:** bordrodan (§3.4). Muhtasarın içindedir.
- **Sözleşme damgası:** hesaplanmaz; oranlar §2.3'te bilgi.
- Ayrı bir damga kartı yoktur: damgalar ilgili takvim satırının tutarına eklenir, ayrıntıda ayrı satırdır (K27, §4.1).

### 3.10 KDV (okuma)

- Takvimin KDV-1 / KDV-2 satırları `loadCashPlan`'ın `plan.vat` satırlarından gelir: tutar, kaynak, devreden ve döküm.
  Ayrı KDV kartı yoktur; satırın ayrıntısında "Nakit planında aç" (`/panel/hatirlaticilar/nakit#kdv`) ve "Devreden
  KDV'yi gir" bağlantıları.
- Plan ufku 42 gündür. Daha sonraki KDV günleri takvimde **tutarsız** yazılır: "tutar yaklaşınca nakit planında".
- Yurt dışı hizmet KDV-2'si (`kdv2Hizmet`, §3.5) KDV-2 satırına ayrı döküm satırıyla eklenir.

### 3.11 Yerel vergiler

- `isLocalTaxReminder(r)` hatırlatıcıyı başlığından tanır: `"ctv"` ("çevre temizlik" ya da "ÇTV"), `"ilan"` ("ilan" ve
  "reklam vergisi").
- Takvimde bu hatırlatıcılar tutarı ve günüyle durur. **ÇTV hatırlatıcısı yoksa** pencereye düşen taksit günü için
  tutarsız satır kendiliğinden eklenir: "ÇTV 2026 2. taksit · son gün 30 Kasım · tutar belediyeden" (ayrıntıda
  "Ödemeler'e ekle" → `/panel/hatirlaticilar?yeni=ctv2`). İlan-reklam için kendiliğinden satır yoktur (tabela asılmadan
  beyan edilir; M18); Kurallar'da bilgi.
- Ayrı bir yerel vergiler kartı yoktur.

### 3.12 Vergi takvimi (`taxCalendar`)

- Pencere: bugün … bugün + 100 gün.
- Satır türleri: `kdv1`, `kdv2`, `mphb`, `sgk`, `gecici`, `kv`, `ctv`, `yerel`. Satır alanları:
  - `{ kind, period, title, nominal, due: legalDueDate(nominal), amount | null, stamp, atLeast, source, state }`;
  - `amount` vergi ve damganın toplamıdır (tek rakam); döküm ayrıntıda;
  - `source`: `"Muhasebeci" | "Ödemeler'de" | "tahmin" | "nakit planı" | "sabit tutar" | null`;
  - `state`: geçici ve KV satırında `"taslak" | "hazir"`;
  - `ask`: `"tahakkuk"` (geçmiş ya da süren dönemin muhtasarı ve SGK'sı: "Tahakkuk fişindeki tutarı girin");
  - `badges`, `detail`, `href`, `cashPlanDate` (nakit planındaki nominal gün; "nakit planında 31 Ekim'de").
- **Geçici vergi ve KV satırı tutar sütununa tahmin yazmaz** (K21): tutar yalnız muhasebeci kaydından ya da
  hatırlatıcıdan; yoksa "Tutarı bilinmiyor · şirketin beyannamesi; muhasebecinizden isteyin". Kafenin katkısı ayrıntıda
  ve kartta.
- `kdv2` satırı yalnız nakit planında o dönem için bir KDV-2 satırı, KDV-2 hatırlatıcısı ya da `kdv2Hizmet` varsa
  yazılır.
- Pencerenin dışında kalan sıradaki geçici vergi ve kurumlar vergisi günleri altta "Sonra" satırında gösterilir.

**24.10.2026 için (Excel verisi, devreden KDV kaydı Eylül 121.204,69, hiçbir sınıflandırma ve hatırlatıcı yok):**

| Yasal gün | Satır | Tutar (tek rakam) | Ayrıntıda |
|---|---|---|---|
| 26.10 Pzt (25.10 Pazar) | KDV-2 (Eylül) | ≈ 2.600 ₺ | 1.800 + damga 791,00; nakit planında 25 Ekim'de |
| 26.10 Pzt | Muhtasar ve prim hizmet (Eylül) | en az 974 ₺ · "Tahakkuk fişindeki tutarı girin" | GV 0, DV 34,68, damga 939,70; 4 kalemin stopajı bilinmiyor |
| 28.10 Çar | KDV (Eylül) | 791,00 ₺ | ödeme beklenmez (devreden); yalnız damga |
| 02.11 Pzt (31.10 Cumartesi) | SGK (Eylül) | ≈ 26.000 ₺ · "Tahakkuk fişindeki tutarı girin" | 25.956,18; yasal oranlarla; Gelir-gider %15,75 kullanıyor |
| 17.11 Sal | Geçici vergi 2026/3 · **Taslak** | Tutarı bilinmiyor | şirketin beyannamesi; kafenin katkısı en çok ≈ 68.900 ₺ + damga 791,00 |
| 26.11 Per | Muhtasar (Ekim) | en az 974 ₺ | |
| 30.11 Pzt (28.11 Cumartesi) | KDV (Ekim) | nakit planından + damga | |
| 30.11 Pzt | SGK (Ekim) | ≈ 26.000 ₺ | |
| 30.11 Pzt | ÇTV 2026 2. taksit | tutar belediyeden | hatırlatıcı yok; "Ödemeler'e ekle" |
| 28.12 Pzt (26.12 Cumartesi) | Muhtasar (Kasım) | en az 974 ₺ | |
| 28.12 Pzt | KDV (Kasım) | tutar yaklaşınca | |
| 31.12 Per | SGK (Kasım) | ≈ 26.000 ₺ | |
| 26.01.2027 Sal | Muhtasar (Aralık) | en az 974 ₺ | 2027 MPHB damgası bilinmiyor → 2026 tutarı |
| 28.01.2027 Per | KDV (Aralık) | tutar yaklaşınca | |
| 01.02.2027 Pzt (31.01 Pazar) | SGK (Aralık) | ≈ 26.000 ₺ | Aralık bordrosu 2026 kurallarıyla |
| Sonra | Geçici vergi 2026/4 · 17.02.2027 Çar; Kurumlar vergisi 2026 · 30.04.2027 Cum | – | |

---

## 4. Ekranlar (Türkçe metinler kesin)

### 4.0 Ortak

- **Yol ve sekmeler:** `/panel/vergi` (Özet), `/panel/vergi/gelir-gider`, `/panel/vergi/demirbas`,
  `/panel/vergi/kurallar`. Sekmeler (`SECTION_TABS.vergi`): "Özet", "Vergiye göre", "Demirbaş", "Kurallar". Yol
  `gelir-gider` kalır (dışarıdan bağlantı yok; adı yalnız ekranda değişir).
- **Yıl seçimi:** `?yil=2026`. Varsayılan `defaultYear` (§3.1). Seçici yalnız iki ya da daha fazla yıl varken görünür.
  Takvim yıldan bağımsızdır (bugünden 100 gün).
- **Başlık:** `PageHeader`, başlık "Vergi", açıklama "Tahmini vergi takvimi, vergiye göre gelir-gider ve
  muhasebecinizin rakamları".
- **Üst bant** (`TaxBanner`, gri bilgi kutusu, `role="note"`; `TAX_DISCLAIMER`):
  - Masaüstünde metin: "Bu sayfadaki rakamlar tahmindir, beyanname değildir. Kesin tutar muhasebecinizin
    beyannamesinde ve tahakkuk fişindedir; girdiğinizde tahminin yerine geçer." İkinci satır: "Kurallar 24.10.2026'da
    derlendi; resmî metinlerle henüz karşılaştırılmadı · Türkiye 2026" (`RULES_VERIFIED_AT` dolunca "… resmî
    metinlerle karşılaştırıldı: <gün>") + §2.5 bayatlama cümleleri.
  - Telefonda tek satır: "Tahmin, beyanname değil" ve yanında `InfoTip` (tam metin); çipler aynı satırda kayar. Tam
    metin Özet ve Kurallar'ın gövdesinde de durur.
- **Çipler:**
  - Kapsam çipi (K3): "Kapsam: yalnız kafe" / "Kapsam: kafe + elle girilen kafe dışı" / "Gelir: şirketin tamamı
    (beyanname) · gider: kafe". Bilgi ipucu: "Kurumlar ve geçici vergi şirketin bütün işleri için tek beyannamedir;
    panel yalnız kafeyi görür. Şirketin diğer gelir ve giderlerini Vergiye göre › Düzeltme ekle'den girin."
  - "Muhasebeciye sorulacaklar: 0 / 8" → `/panel/vergi/kurallar#sorular`. Temel maddelerin hepsi işaretliyse
    "Muhasebecinizle gözden geçirildi (sahibin işareti)". Hiçbir yerde "onayladı" yazmaz (K34).
- **Telefon (390 px):**
  - Kartlar tek sütundur. Pencereler tam genişliktedir. Yatay kaydırma yoktur (320 ve 390 px'te
    `scrollWidth ≤ clientWidth`, takvim satırları açıkken ve kapalıyken).
  - Takvim satırı üç sütundur: tarih karosu, başlık ve alt satır, **tek** tutar (`shrink-0`, sağa yaslı). Rozet en çok
    bir tane ("Muhasebeci", "Ödemeler'de" ya da "Taslak").
  - Düğmeler `flex flex-wrap gap-2` ile dizilir. Dokunma alanları en az 44 px'tir.
- **Rozetler:**

| Durum | Rozet |
|---|---|
| tahmin | yok (`≈` yeter) |
| muhasebeci kaydı | "Muhasebeci" |
| hatırlatıcı tutarı | "Ödemeler'de" |
| beyanname damgası gibi kural tutarı | "sabit tutar" |
| eksik veriyle hesaplanan geçici ve KV | "Taslak" |
| tahmini yılın kuralı | "2026 kuralları" |
| gelir kaynağı | "mali belge · beyanname" / "mali belge · Z" / "Yönetim verisi (ModPOS), mali belge değil" |
| laffogato.net | "yaklaşık; e-Arşiv tarihinden farklı olabilir" |

- **"Nasıl hesaplandı"**: her tutarın satırı açılır. Açılır başlık (`summary` ya da düğme) içinde başka etkileşimli öğe
  bulunmaz; bağlantılar ve düğmeler açılan gövdededir. Gövdede:
  - formül, etiket–değer satırları olarak `dl` ile (`StatBreakdown` deseni; uzun formül tek satıra yazılmaz);
  - kullanılan kuralların başlığı, değeri ve dayanağı;
  - kaynak bağlantıları kısa adla ("GİB · Asgari KV rehberi", "Resmî Gazete 31.12.2025"), `break-words`,
    `target="_blank" rel="noreferrer"`;
  - güven derecesi ve varsa "Muhasebecinize sorun: <madde>";
  - takvim satırında "Ödemeler'e ekle" (karşılığı yoksa) → `/panel/hatirlaticilar?yeni=<şablon>`.
- **Yükleme:** `loading.tsx` yok. Her sayfa `PageHeader` ve `PageSkeleton`'lı `Suspense` fallback'i kullanır (panelin
  kalıbı).

### 4.1 Özet (`/panel/vergi`)

Masaüstü (`lg`): üstte üç `Stat` tam genişlik; altında solda takvim (2/3), sağda geçici vergi ve kurumlar vergisi
kartları (1/3) alt alta. `md` altında tek sütun, aynı sıra.

1. **Üç rakam** (`Stat`, komisyon sayfasının deseni):
   - "Sıradaki ödeme": "KDV-2 ve muhtasar · 26 Ekim · en az ≈ 3.600 ₺" (en yakın günün satırları; tutarı bilinmeyen varsa
     "+ 1 ödemenin tutarı bilinmiyor").
   - "Önümüzdeki 30 gün": "en az ≈ 30.300 ₺ · tutarı bilinmeyen 1 ödeme (geçici vergi)".
   - "Hazırlık": "0 / 4" → Başlarken kartı.
2. **"Başlarken"** kartı (K33), dört adım bitene kadar; her adım satırında durum ve bağlantı:
   - "Şirket nasıl kuruldu?" → Kurallar › Vergi ayarları. Bitti: seçildi ("Bilmiyorum" bitmiş sayılmaz).
   - "Giderleri sınıflandırın · 26 kalem kaldı" → Vergiye göre `#siniflandir`. Sonradan eklenen sınıflandırılmamış
     sabit gider ve demirbaş adayı sayıyı artırır.
   - "Demirbaşlar · 4 fatura varlık listesinde değil" → Demirbaş.
   - "Muhasebecinin rakamları · Temmuz–Eylül KDV beyannamesi satışları, 2026/2 geçici vergi" → ilgili pencereler.
   Hepsi bitince kart katlanır ("Hazırlık tamam · yeniden aç").
3. **"Sıradaki vergi ödemeleri"** (§3.12). Her satır açılır, döküm içindedir.
   - Kaydırılmış günde alt satır: "Son gün 25 Ekim Pazar → 26 Ekim".
   - Tutarsız satır: "Tutar yaklaşınca nakit planında", "Tutarı bilinmiyor · şirketin beyannamesi; muhasebecinizden
     isteyin" ya da "Tahakkuk fişindeki tutarı girin".
   - Muhtasar satırının ayrıntısı ücret gelir vergisi, ücret damga vergisi, stopajlar (profil profil), bilinmeyen
     kalemler, beyanname damgası; düğmeler "Bordro dökümü" (§4.5-e) ve "Muhasebecinin rakamını gir".
   - SGK satırının ayrıntısı §3.6; damga satırları ilgili beyannamenin satırındadır.
   - En altta tek satır: "Enflasyon düzeltmesi 2026'da yapılmaz (VUK geçici 37) · Bu kafede hesaplanmayanlar →
     `/panel/vergi/kurallar#bilgi`."
4. **"Kafenin geçici vergi matrahına katkısı (yalnız kafe)"** kartı. Sıradaki dönem, örnek "2026/3 · 25 Haziran–30
   Eylül · son gün 17 Kasım Salı".
   - Taslakta: "Taslak" rozeti; büyük satır "Giderler sınıflandırılınca netleşir · şimdilik en çok ≈ 68.900 ₺";
     altında "808.610 ₺ gider henüz hesaba girmedi (24 kalem) · 69.780 ₺ demirbaş olabilir (2 fatura)" ve düğme
     "Giderleri sınıflandır" → `/panel/vergi/gelir-gider#siniflandir`. Alt sınır karta yazılmaz.
   - Hazırda: "≈ X ₺".
   - Satırlar: "Kümülatif kurum kazancı", "× %25", "Asgari kurumlar vergisi (%10)" ya da "uygulanmaz", "Önceki
     dönemler", "Kafenin katkısı", "Beyanname damgası 791,00 ₺". En altta: "Şirketin geçici vergisi muhasebecinizin
     beyannamesindedir; 2026/3 rakamını Kasım'ın ilk haftası isteyin."
   - Düğmeler: "Muhasebecinin rakamını gir" (§4.5-a), "Vergiye göre'yi aç".
   - Geçmiş dönem (2026/2) kaydı yoksa küçük satır: "2026/2 (son gün 17.08.2026) için muhasebecinin rakamı girilmedi."
5. **"Kurumlar vergisi (2026) · kafenin katkısı"** kartı. Başlık altı "Bugüne kadarki kârla" (süren yıl).
   - Satırlar: matrah, hesaplanan, asgari, mahsup edilecek geçici vergi (yalnız ödendi işaretli), ödenecek ya da
     "iade / mahsup alacağı", oluşan zarar, ödendi işaretlenmemiş dönemler.
   - Alt satır: "Beyanname 1–30 Nisan 2027 · ödeme 30 Nisan 2027 Cuma · damga 2.516,30 ₺ (beyanname 1.605,80, bilanço
     616,30, gelir tablosu 294,20; 2027 tutarları açıklanmadı)".
   - Düğme "Muhasebecinin rakamını gir" (yıl).

Veri yoksa (hiç ciro ve fatura yok) gövde tek paragraftır: "Hesap için veri yok. Satışlar'a ayın cirosunu, Faturalar'a
alışları girin." Yanında `ButtonLink` "Satışlara git" bulunur.

### 4.2 Vergiye göre (`/panel/vergi/gelir-gider`)

Başlık "Vergiye göre gelir-gider". **Çeyrek seçici** `?ceyrek=2026-Q3` (`MonthPicker` deseni; varsayılan
`defaultQuarter`).

- **Masaüstü:** satırlar yukarıda; sütunlar seçili çeyreğin üç ayı, "Çeyrek toplamı" ve "Kümülatif (yılbaşından)"
  (en çok 5 sayı sütunu ve etiket). Gelir-gider'in `pnl-grid` kalıbı: yapışkan ilk sütun (`TableWrap`). Bütün aylar ve
  dönem toplamı Excel'in "Vergi" sayfasındadır. 1440 px'te 2027 Aralık (12 ay geçmiş) da aynı genişliktedir.
- **Telefon:** `month-view` gibi yapışkan seçici (ay ya da çeyrek) ve tek kart; satırlar alt alta.
- **Satır grupları** §3.2'deki gibidir: "Gelir", "Gider", "Sonuç (amortisman öncesi)". Çeyrek ve kümülatif sütunlarında
  ek satırlar: "Amortisman" (yöntemiyle), "Doğrudan gider yazılan demirbaş", "İndirilemeyen gider (eklenen)", "İndirim",
  "Kurum kazancı (kümülatif)".
- **Her satırın esas rozeti** vardır: "fatura tarihi", "satış günü", "mali belge · beyanname", "Yönetim verisi
  (ModPOS), mali belge değil", "yaklaşık", "tahmini", "elle".
- **Köprü kartı** (ayın ve çeyreğin altında, §3.2 `bridge`): "Gelir-gider'deki gider 562.242 ₺ → …→ vergiye göre gider
  …". Gelir için yalnız kaynak.
- **Uyarı satırları:**
  - "30 Eylül sayımı yok: stok 0 sayıldı, alışın tamamı gider; vergi için çeyrek sonu sayımı gerekir" (kırmızı; önceki
    sayım varsa "… 31 Ağustos sayımı kullanıldı");
  - "Ekim bitmedi: bugüne kadar"; "Ekim cirosu 16 günlük";
  - "Personel: işe giriş günü bilinmediği için ay tam sayıldı";
  - köprüdeki personel cümlesi (§3.2).
- **"Vergi hesabına girmeyen giderler"** kartı (`id="siniflandir"`). Başında tek cümle: "Aynı gider iki kez sayılmasın
  diye soruyoruz: bu giderin belgesi nerede?" Kaynağa göre gruplar: "Sabit giderler" (bölüm bölüm), "Aylık harcama
  kategorileri", "Elle girilen satırlar", "Demirbaş olabilir", "Demirbaş faturaları", "Kafe dışı faturalar".
  - Her satır: ad, bu yılın sayılmayan toplamı ve **kısa bir `Select`** (telefonda alttan açılan seçim sayfası).
    Seçenekler alt alta: "Seçilmedi", "Paraşüt'te faturası var (burada sayılmaz)", "Belgesi muhasebecide (fiş, makbuz,
    serbest meslek makbuzu)", "Belgesi yok: muhasebecinize sorun (vergiden düşülmez)". Personel bölümünde: "Seçilmedi", "Bordroda
    (Personel'e ekleyin)", "Paraşüt'te faturası var", "Dışarıdan hizmet: belgesi muhasebecide (fatura, SMM)".
    "Part-time" adlı kalemin altında: "Bordroya ekleyin; kısmi süreli SGK gün sayısıyla bildirilir."
  - Kira, genel ve personel bölümündeki "Dışarıdan hizmet" sabit giderinde ikinci alan **"Stopaj"**: "Seçilmedi",
    "Stopaj yok (Türkiye'deki bir şirkete)", "Şahsa işyeri kirası (%20)", "Serbest meslek makbuzu (%20)", "İnternet
    reklamı: şahsa (%15)", "İnternet reklamı: doğrudan yurt dışına (%15 + KDV-2 %20)", "Yurt dışı hizmet (KDV-2 %20)".
    "Şahsa işyeri kirası" seçilince kalemin "Faturadaki KDV"si %0 değilse altında onay kutusu: "Faturadaki KDV'yi
    'KDV yok' yap (şahıs kirasında KDV olmaz)" (varsayılan işaretli).
  - Demirbaş olabilir satırında: "Gider (demirbaş değil)" ve "Varlık olarak ekle".
  - Demirbaş faturasında düğmeler: "Varlık olarak ekle", "Doğrudan gider" (yalnız ≤ 12.000 ₺).
  - Kafe dışı faturalarda anahtar: "Kafe dışı faturaları vergi hesabına kat". Ardından not: "Kafe dışı geliri de girin;
    yalnız gider girmek vergiyi düşük gösterir." "Alp Koç" satırının notu: "Ortağın hesabına alınan fatura şirketin
    gideri olmayabilir; muhasebecinize sorun."
  - "Belgesi yok" grubunun başlığında yalnız toplam ve sayı: "Belgesi yok: 2 kalem, 12.400 ₺. Belgesiz ödeme deftere
    giremez; şirket kasasından çıktıysa muhasebeciniz ortak hesabına yazar."
  - **Seçimler istemcide toplanır**; `FloatingBar` "3 değişikliği kaydet" ve "Vazgeç". Kayıt tek eylemle
    (`saveTaxClassifications`), tek `refresh()`. Kaydedilmemiş değişiklik varken sayfadan çıkmak uyarır.
  - Kart başlığında toplam: "Bu çeyrekte 808.610 ₺ gider sayılmadı (24 kalem) · 69.780 ₺ demirbaş olabilir (2 fatura)".
- **"Düzeltmeler"** kartı. Ay ay liste ve düğme "Düzeltme ekle" (§4.5-b). Tür etiketleri:

| Tür | Etiket |
|---|---|
| `gelir_kafe_disi` | "Kafe dışı gelir" |
| `gelir_diger` | "Diğer gelir (faiz, kur farkı…)" |
| `gider_kafe_disi` | "Kafe dışı gider" |
| `gider_belgeli` | "Belgeli gider (panelde yok)" |
| `kkeg` | "İndirilemeyen gider (ceza, gecikme zammı…)" |
| `indirim` | "İndirim ve istisna (bağış…; muhasebecinin söylediği tutar)" |

  - Kafe dışı türlerde dönem "Ay" ya da "Çeyrek" seçilebilir; çeyrek tutarı çeyreğin son ayına yazılır, listede
    "2026/3" diye görünür.
  - Muhasebeci kaydı olan bir çeyreğe düzeltme girilirse uyarı çıkar: "Bu dönemin beyannamesi girildi; düzeltme
    yalnız sonraki tahmini etkiler." Beyanname matrahı olan aya kafe dışı gelir girilirse: "Bu ayın geliri
    beyannameden geliyor; kafe dışı satış zaten içinde."
- **"KDV beyannamesi satışları"**: her ayın kartında "Beyanname matrahını gir" (§4.5-a, tür `kdv_matrah`).

### 4.3 Demirbaş (`/panel/vergi/demirbas`)

- **Liste** (telefonda kart, masaüstünde tablo). Satırda: ad ve bağlı fatura, maliyet (KDV hariç), ömür ya da yöntem,
  bu yılın amortismanı, net değer. Edinme günü, tür, çeyrek payları ve birikmiş açılan ayrıntıdadır.
- **"Varlık ekle"** (§4.5-c).
- **"Varlık listesine eklenmemiş demirbaş faturaları"**: Kuruluş & Demirbaş faturaları. Her satırda kalan (eşlenmemiş)
  tutar ve düğmeler "Varlık olarak ekle" / "Doğrudan gider".
- **"Demirbaş olabilir"**: K12'nin adayları; düğmeler "Varlık olarak ekle" / "Gider (demirbaş değil)".
- **Uyarılar:**
  - "3 varlığın faydalı ömrü girilmedi: amortisman hesaplanmadı";
  - "Faturası Paraşüt'te iptal edildi: yeni faturaya bağlayın" (§3.3; aday faturalar ve "Bağla");
  - "Kiralanan yere yapılan dekorasyon özel maliyettir; ömrü kira süresine bağlıdır. Muhasebecinize sorun."
- **Not:** "Yatırımlar listesi (Giderler & personel) bilgi amaçlıdır ve vergiye girmez; vergide bu liste esastır."

### 4.4 Kurallar (`/panel/vergi/kurallar`)

1. **"Vergi ayarları"** formu:
   - "Hesap dönemi başlangıcı" (tarih, varsayılan 25.06.2026, ipucu "Vergi levhasındaki işe başlama tarihi").
   - "Şirket nasıl kuruldu?": "İlk defa faaliyete başladı" / "Birleşme, devir, bölünme ya da tür değişikliğiyle" /
     "Bilmiyorum". Varsayılan "Bilmiyorum"; asgari KV muafiyeti yalnız ilkinde uygulanır.
   - "Geçici vergide amortisman": "Kalan çeyreklere eşit" (varsayılan) / "Kümülatif ay ÷ 12". İpucu "Muhasebecinizin
     yöntemi (Muhasebeciye sorulacaklar › Demirbaş)".
   - "Muhtasarın vergi kısmı 3 aylık" (anahtar).
   - "Asgari ücret desteği SGK'dan düşülsün" (anahtar, ipucu: şartlar).
   - "Kafe dışı faturaları vergi hesabına kat" (anahtar).
2. **"Muhasebeciye sorulacaklar"** (`id="sorular"`). §14'teki maddeler, sahibin dilinde; her biri başlık, panelin
   varsaydığı değer ve "Muhasebecimle konuştum" onay kutusu.
   - Onay kutusu bir not alanı açar ("Muhasebecinin söylediği / farklıysa ne").
   - İşaretlenen madde "Konuşuldu · Ad · 24.10.2026 · <not>" olur. Kaldırılabilir.
   - Temel maddeler üstte, "Temel" başlığıyla.
3. **"Kural tablosu (2026)"**. Gruplar §2.2'deki gibi. Her satır: başlık, değer, dayanak, güven rozeti, kaynaklar
   (kısa adla), "Muhasebecinize sorun: <madde>" (varsa).
   - Elle değiştirilebilir satırda "Değiştir" düğmesi (§4.5-d).
   - Tablo başında: "Derlendi: 24.10.2026. " + `RULES_CHECK_NOTE`.
   - `kv.asgariZararDusulur` bilgi satırıdır (düğmesiz).
4. **"Bu kafede hesaplanmayanlar"** (`id="bilgi"`, §2.3), kaynak bağlantılarıyla.

### 4.5 Pencereler (`ui/dialog`, `NumberInput`, `parseNumberTR`)

**a) "Muhasebecinin rakamı"** (tür: geçici vergi, kurumlar vergisi, muhtasar, KDV beyannamesi satışları).
- Dönem `Select`: geçici için hesap dönemindeki çeyrekler ("2026/2", "2026/3", …), KV için yıllar, muhtasar ve KDV
  için son 12 ay.
- Alanlar:

| Tür | Zorunlu | İsteğe bağlı (katlanmış: "Matrah ve hesaplanan vergi · beyannamede yazar; biliyorsanız") |
|---|---|---|
| geçici | "Ödenecek", "Damga vergisi" (791,00 dolu gelir) | "Kümülatif matrah (kurum kazancı; zararda eksi)", "Hesaplanan geçici vergi (kümülatif)" |
| kurumlar | "Ödenecek", "Damga vergisi" (2.516,30 dolu gelir) | "Kurum kazancı (zararda eksi)", "Hesaplanan kurumlar vergisi", "Mahsup edilen geçici vergi", "İade / mahsup alacağı", "Sonraki yıllara devreden zarar" |
| muhtasar | "Ödenecek (tahakkuk fişindeki vergi toplamı)", "Damga vergisi" (939,70) | "Ücret gelir vergisi", "Ücret damga vergisi", "Kira stopajı", "Serbest meslek stopajı", "Diğer stopaj" |
| KDV beyannamesi satışları | "%10 matrah", "%20 matrah" (0 olabilir) | "%1 matrah", "İstisna ve diğer", "Bunun kafe dışı kısmı (muhasebecinize sorun)" |

- Geçici, KV ve muhtasarda pencerenin altında Ödemeler'deki karşılık görünür ("Ödemeler'de: Geçici vergi beyanı ve
  ödemesi · 17 Kasım · tutar yok") ve onay kutusu **"Ödemeler'deki hatırlatıcıya da yaz"** (varsayılan işaretli;
  karşılık yoksa "Ödemeler'de karşılığı yok · Ödemeler'e ekle").
- Matrah girilmezse kayıt kesin tutardır ama çapa olmaz; kartta "Sonraki tahmin panelin verisiyle (matrah girilmedi)".
- Hatalar: boş zorunlu alan "Tutar girin (0 olabilir)"; eksi tutar "Tutar eksi olamaz" (matrah hariç).
- Düğmeler: "Kaydet", "Vazgeç", kayıt varsa "Kaldır".
- Toast metinleri: "Muhasebecinin rakamı kaydedildi: Geçici vergi 2026/3" (hatırlatıcıya yazıldıysa "· Ödemeler'e de
  yazıldı") ve "Kaldırıldı; tahmin kullanılıyor".

**b) "Düzeltme ekle"**
- Alanlar: "Dönem" (Ay / Çeyrek; çeyrek yalnız kafe dışı türlerde), "Tür" (§4.2 etiketleri), "Tutar (₺, KDV hariç)"
  (> 0), "Açıklama" (zorunlu, ≤ 120), "Not".
- Düzenleme ve silme aynı pencereden yapılır.

**c) "Varlık"**
- Alanlar:
  - "Ad";
  - "Fatura" (isteğe bağlı `Select`: son 18 ayın kafe faturaları, "Tedarikçi · tarih · net · kalan");
  - "Edinme günü" (faturadan dolar);
  - "Maliyet (₺, KDV hariç)" (faturanın kalanıyla dolar);
  - "Tür": Demirbaş / Özel maliyet / Diğer;
  - "Yöntem": Amortisman / Doğrudan gider (12.000 ₺ üstünde pasif, ipucu "VUK 313: 2026'da 12.000 ₺'yi aşmayan");
  - "Faydalı ömür (yıl)": boş bırakılabilir, ipucu "Muhasebecinizden öğrenin (VUK amortisman listesi)";
  - "Not".
- Hatalar:
  - "Maliyet faturanın kalan tutarını aşıyor (en çok 12.345,67 ₺)";
  - "Ömür 1–50 yıl olmalı";
  - "Doğrudan gider yalnız 12.000 ₺'ye kadar".

**d) "Elle değer"**
- Alanlar: "Değer" (sayı) ve "Kaynak / not" (zorunlu).
- Düğmeler: "Kaydet", "Tablodaki değere dön".

**e) "Bordro dökümü"**
- Ay `Select`. **Devrik tablo:** satırlar alanlar (net, brüt, işçi SGK, işsizlik, GV matrahı, kümülatif matrah,
  hesaplanan GV, asgari ücret istisnası, GV, DV, işveren SGK, işveren işsizlik, maliyet), sütunlar kişiler ve "Toplam";
  ilk sütun yapışkan. 2–4 kişide 390 px'te sığar; tek bileşen iki ekranda.
- Not: "Hesap 2026 yasal SGK oranları ve gelir vergisi tarifesiyle yapıldı; kesin tutar bordronuzdadır."

### 4.6 Diğer ekranlara dokunuşlar

- `src/app/panel/gelir-gider/page.tsx`: başlık altına tek satır, "Vergiye göre karşılığı: Vergi › Vergiye göre"
  (`Link`). Ayarlar'daki işveren oranı kural tablosundan farklıysa K19'un uyarı satırı (M2 işaretliyse düğmesiyle).
- `src/app/panel/hatirlaticilar/page.tsx`: `?yeni=<preset>` okunur; ekleme sayfası o şablonla dolu açılır.
  `reminder-sheet.tsx`'in `PRESET_CARDS`'ına dört kart: "Kurumlar vergisi" (`kv`), "ÇTV 1. taksit" (`ctv1`),
  "ÇTV 2. taksit" (`ctv2`), "İlan-reklam" (`ilan`), tür `vergi`.
- Nakit planı "Nasıl hesaplandı" kartına yeni satır (anahtar `vergi`, başlık "Muhtasar, geçici vergi ve damga"):

| Kip | Metin |
|---|---|
| default | "Muhtasar (ücret gelir ve damga vergisi, işaretli stopajlar, beyanname damgası) ayın 26'sında, Vergi sayfasının tahminiyle; stopajı bilinmeyen kalem varsa 'en az'. Geçici vergi yalnız tutarı Ödemeler'e ya da Vergi'ye yazıldıysa (ya da çeyreğin hesabı hazırsa) Şubat, Mayıs, Ağustos ve Kasım'ın 17'sinde; yoksa 'Tutarı girilmemiş ödemeler'de. KDV beyannamelerinin damgası (791 ₺) ayrı satır; tutarı yazılmış KDV hatırlatıcısı damga dahil sayılır." |
| excluded | "Muhtasar, geçici vergi ve beyanname damgaları plana katılmıyor (Tahmine katılanlar'dan açın)." |

- "Dahil değil" metni şöyle değişir: "Tutarı girilmemiş yerel vergiler (ÇTV, ilan reklam), kurumlar vergisi, Aylık
  harcamalar'daki fatura dışı ödemeler, yıllık giderler (…), yatırım ve kredi."
- SGK notunun "Gelir ve damga vergisi dahil değil." cümlesi şöyle olur: "Brüt, gelir ve damga vergisiyle; 2026 yasal
  oranlarıyla (işveren %19,75 + %2) hesaplanır; vergiler muhtasar satırındadır."
- Sabit gider satırının notu, stopaj profili varsa: "Kira 160.000 ₺ brüt · stopaj %20 muhtasarda · ödenen 128.000 ₺".
- Yardım: dalga 10 birleştiyse `yardim/faq-build.tsx`'in `FaqGroup` yapısıyla, "Gider, ödeme ve ekip" grubunda soru
  `id: "vergi"`:
  - Soru: "Vergi sayfasındaki rakamlar beyanname mi?"
  - Cevap: "Hayır, tahmindir. Vergi sayfası satışlardan, faturalardan ve bordrodan muhtasarı, SGK'yı, damga vergisini
    ve kafenin geçici ve kurumlar vergisine katkısını Türkiye'nin 2026 kurallarıyla tahmin eder; her rakamın yanında
    nasıl hesaplandığı ve dayanağı yazar. Geçici ve kurumlar vergisi şirketin tamamının beyannamesidir: tutarı
    muhasebecinizden isteyin ve Vergi'ye girin. Kurallar sekmesindeki 'Muhasebeciye sorulacaklar' listesini
    muhasebecinizle bir kez gözden geçirin."
  - `<Path href="/panel/vergi" />` öncesi satır `{" "}` ile biter (`tests/yardim.test.ts`).
  - `links: [{ href: "/panel/vergi", label: "Vergi" }, { href: "/panel/vergi/kurallar#sorular", label: "Muhasebeciye sorulacaklar" }]`,
    ikon `Landmark`.

---

## 5. Veri modeli ve migration (`npm run db:generate -- --name vergi`)

`src/server/db/schema.ts` ekleri (yalnız eklemeli):

```ts
// ---------------------------------------------------------------- Vergi (docs/VERGI.md)
/** Demirbaş ve özel maliyet: vergi amortismanı; faturaya bağlanan maliyet o faturanın giderinden düşer */
export const taxAssets = pgTable("tax_assets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  /** Bağlandığı anki fatura künyesi ("XND Teknoloji · 13.07.2026 · 338.169,58"); fatura silinince uyarı ve aday arama için */
  invoiceLabel: text("invoice_label"),
  acquiredOn: text("acquired_on").notNull(),                       // YYYY-MM-DD
  cost: doublePrecision("cost").notNull(),                         // KDV hariç
  kind: text("kind", { enum: ["demirbas", "ozel_maliyet", "diger"] }).notNull().default("demirbas"),
  method: text("method", { enum: ["amortisman", "dogrudan_gider"] }).notNull().default("amortisman"),
  lifeYears: integer("life_years"),                                // boş = girilmedi (amortisman 0)
  note: text("note"),
  createdByName: text("created_by_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("tax_assets_invoice_idx").on(t.invoiceId),
  check("tax_assets_cost_pos", sql`${t.cost} > 0`),
  check("tax_assets_life_range", sql`${t.lifeYears} is null or ${t.lifeYears} between 1 and 50`),
]);

/** Muhasebecinin beyanname / tahakkuk rakamları: dönem başına bir kayıt; tahminin yerine geçer, matrahı varsa sonraki tahminin çapasıdır */
export const taxFilings = pgTable("tax_filings", {
  id: serial("id").primaryKey(),
  kind: text("kind", { enum: ["gecici", "kv", "mphb", "kdv_matrah"] }).notNull(),
  period: text("period").notNull(),                                // "2026-Q3" | "2026" | "2026-09"
  payable: doublePrecision("payable").notNull(),                   // ödenecek vergi; kdv_matrah'ta 0 (KDV ödemesi nakit planında)
  stamp: doublePrecision("stamp").notNull().default(0),            // beyanname damgası
  values: jsonb("values").notNull().default({}),                   // türüne göre (§6.6)
  note: text("note"),
  enteredBy: integer("entered_by").references(() => users.id, { onDelete: "set null" }),
  enteredByName: text("entered_by_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("tax_filings_kind_period_uq").on(t.kind, t.period)]);

/** Panelin bilemediği gelir ve gider: kafe dışı, indirilemeyen gider, indirim (ay başına çok kayıt) */
export const taxAdjustments = pgTable("tax_adjustments", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),                                  // YYYY-MM (çeyrekse çeyreğin son ayı)
  span: text("span", { enum: ["ay", "ceyrek"] }).notNull().default("ay"),
  kind: text("kind", { enum: ["gelir_kafe_disi", "gelir_diger", "gider_kafe_disi", "gider_belgeli", "kkeg", "indirim"] }).notNull(),
  amount: doublePrecision("amount").notNull(),
  label: text("label").notNull(),
  note: text("note"),
  createdByName: text("created_by_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("tax_adjustments_month_idx").on(t.month),
  check("tax_adjustments_amount_pos", sql`${t.amount} > 0`),
  check("tax_adjustments_span_kind", sql`${t.span} = 'ay' or ${t.kind} in ('gelir_kafe_disi', 'gider_kafe_disi')`),
]);
```

Var olan tablolara boş başlayan sütunlar:
- `fixed_expenses.tax_doc` text enum `["fatura", "belgeli", "yok", "bordro"]` (`bordro` yalnız personel bölümünde,
  `yok` personel bölümünde değil: eylem denetler);
- `fixed_expenses.tax_withholding` text enum `["yok", "kira", "serbest_meslek", "internet_reklam",
  "internet_reklam_yurtdisi", "yurt_disi_hizmet"]` (boş = seçilmedi);
- `expense_categories.tax_doc` text enum `["fatura", "belgeli", "yok"]`;
- `invoices.tax_not_asset` boolean not null default false ("Demirbaş olabilir" listesindeki "Gider (demirbaş değil)"
  kararı; Paraşüt eşitlemesi bu sütuna dokunmaz).

`integration_state` › **`tax.settings`** (migration gerekmez):

```ts
interface TaxSettings {
  periodStart: string;                         // "2026-06-25"
  firstActivity: "ilk" | "devir" | null;       // null = sorulmadı (asgari KV muafiyeti uygulanmaz)
  quarterDepreciation: "kalan" | "ay12";       // "kalan"
  muhtasarQuarterly: boolean;                  // false
  minWageSupport: boolean;                     // false
  includeSeparate: boolean;                    // false
  carriedLoss: { amount: number; note: string; by: string; date: string } | null;  // önceki yıllardan devreden zarar (elle; KV kaydı varsa o)
  manualRows: Record<string, TaxDoc>;          // "manual:su" …; "commission:pos" anahtarı yok (K12a)
  overrides: Record<string, { value: number | boolean; note: string; by: string; date: string }>;
  checks: Record<AccountantCheckKey, { by: string; date: string; note: string | null }>;  // "Muhasebecimle konuştum"
}
```

- `parseTaxSettings(v)` bozuk ya da eksik alanı varsayılana düşürür.
- Bilinmeyen anahtarı ve geçersiz değeri atar: `manualRows` anahtarı `MANUAL_PNL_ROWS` olmalı; override anahtarı
  `overridable` olmalı; işaret anahtarı `ACCOUNTANT_CHECKS`'te olmalı.

`src/lib/vat-paid.ts`: `VatPaidEntry.kind` `"kdv" | "kdv2" | "gecici"` olur; `gecici` dönemleri `quarterOfDue` ile
(`"2026-Q3"`). `parseVatPaid` üç türü de kabul eder. Yalnız eklemeli; KDV davranışı değişmez.

Diğer kurallar:
- **Tipler:** `src/lib/calc/types.ts` alanları isteğe bağlı ekler:
  - `FixedExpense.taxDoc?: TaxDoc | null`, `taxWithholding?: Withholding | null`;
  - `ExpenseCategory.taxDoc?: TaxDoc | null`;
  - `ExpenseEntry.cashOutId?: number | null`, `docType?: "fis" | "e_arsiv" | "fatura" | "yok" | null`;
  - `Invoice.taxNotAsset?: boolean`.
  - `ExpenseEntry.supplierEntryId` dalga 11'den gelir; vergi dalı yeniden eklemez.
- **Yükleme:** `src/server/data/dataset.ts` bunları doldurur. Harcamalar `cash_outs`'la sol birleşimle okunur. Engine bu
  alanlara bakmaz; golden testleri değişmez.
- **Yedek** yeni tabloları kendiliğinden alır (`row_to_json`, tablolar alfabe ve yabancı anahtar sırasıyla).
  `TABLE_RULES`'a ekleme yok.
- **`db:reset`:** K32. `SERIAL_TABLES`'a ekleme yok. CASCADE `tax_assets`'i zaten boşaltır; `resetCheck`'in uyarısına
  "vergi demirbaş listesi (N varlık)" eklenir (N, sıfırlamadan önce sayılır); seed.ts'teki yoruma bir satır.
- **Migration testi** (`tests/vergi-migration.test.ts`):
  - dosya düzeyinde, üretilen `drizzle/00xx_vergi.sql` metni okunur: yeni tablolar ve sütunlar, `tax_filings (kind,
    period)` tekil indeksi, `tax_assets_cost_pos` ve `tax_assets_life_range` CHECK'leri, `invoices.tax_not_asset`
    varsayılanı;
  - `VERGI_TEST_DATABASE_URL` verilirse (yoksa atlanır, `sayim-ekle.test.ts` deseni) işlem içinde: `cost = 0`
    reddedilir, aynı `(kind, period)` ikinci kez reddedilir, işlem geri alınır.

---

## 6. Saf mantık (`src/lib/tax/*`; sunucu bağımlılığı yok, `Model` yalnız tip)

### 6.1 `rules.ts`, `rules-2026.ts`
§2.1. Ek olarak:
- `TaxDoc` tipi ve `TAX_DOC_LABELS`: `fatura` "Paraşüt'te faturası var (burada sayılmaz)", `belgeli` "Belgesi
  muhasebecide (fiş, makbuz, serbest meslek makbuzu)", `yok` "Belgesi yok: muhasebecinize sorun (vergiden düşülmez)", `bordro` "Bordroda
  (Personel'e ekleyin)"; personel bölümündeki `belgeli` etiketi "Dışarıdan hizmet: belgesi muhasebecide (fatura, SMM)";
- `Withholding` tipi, `WITHHOLDING_LABELS` (§4.2) ve `withholdingRate(w, rules)`, `withholdingKdv2(w, rules)`;
- `TAX_DISCLAIMER`, `TAX_DISCLAIMER_SHORT` ("Tahmin, beyanname değil");
- `formatEstimate(x)` (K27: `≈` + 100 ₺ / 1 ₺).

### 6.2 `calendar.ts`
`legalDueDate`, `nominalDue(kind, period)`, `periodOf(year, settings)`, `quarterRange`, `quarterOfDue`,
`mphbPeriodOf`, `defaultYear`, `defaultQuarter`, `taxCalendar(input)` (§3.12).

### 6.3 `payroll.ts`
```ts
export function incomeTax(base: number, brackets: readonly Bracket[]): number;
export function minWageExemption(month: number, rules: TaxYearRules): { gv: number; dv: number };
export function payslipFromGross(gross: number, ctx: SlipCtx): Payslip;
export function payslipFromNet(net: number, ctx: SlipCtx): Payslip;
export function payrollRates(rules: TaxYearRules): PayrollRates;   // kural tablosundan, elle sgk.isverenOran uygulanmış
export function taxPayroll(staff: readonly StaffMonths[], year: number, rules: TaxYearRules, opts: { minWageSupport: boolean; from: string }): Map<string, PayrollMonth>;
export function taxPayrollFromModel(model: Model, year: number, settings: TaxSettings, overrides?: TaxOverrides): Map<string, PayrollMonth>;
```

### 6.4 `assets.ts`
`depreciation(asset, rules, method)` döner: `{ years: { year, amount }[], quarters: Map<"YYYY-Qn", number>, direct: { month, amount } | null, warning }`.
Yardımcılar: `allocatedByInvoice(assets)`, `assetTotals(assets, year, period, method)`,
`assetCandidates(invoices, assets, today)` (K12), `relinkCandidates(asset, invoices)` (§3.3).

### 6.5 `pnl.ts`
```ts
export type RevenueSource = "beyanname" | "z" | "yonetim";
export interface TaxPnlInput { months; invoices; expenseEntries; fixed; manualRows; adjustments; assets; salesBases /* kdv_matrah kayıtları */; zMonths? /* dalga 13 */; siteRefundPending; settings: TaxSettings; payroll: Map<string, PayrollMonth>; rules }
export function taxPnlInputFromModel(model: Model, extras: { settings; adjustments; assets; filings; zMonths?; siteRefundPending; payroll; today }): TaxPnlInput;
export function taxMonths(input: TaxPnlInput, year: number, today: string): TaxMonth[];     // §3.2; her ay revenueSource taşır
export function unclassified(months: TaxMonth[]): ExcludedItem[];                           // ekran listesi (kaynağa göre)
export function bridge(month: TaxMonth, pnl: PnlMonth): BridgeRow[];                         // §3.2 köprü (gider tarafı)
```

### 6.6 `corporate.ts`
```ts
export interface GeciciValues { matrah?: number; hesaplanan?: number }                     // kaydın values'u; ikisi birlikte çapa
export interface KvValues { matrah?: number; hesaplanan?: number; mahsup?: number; iade?: number; devredenZarar?: number }
export interface MphbValues { ucretGv?: number; ucretDv?: number; kiraStopaj?: number; smStopaj?: number; digerStopaj?: number }
export interface KdvMatrahValues { m1?: number; m10: number; m20: number; istisna?: number; kafeDisi?: number }
export function quarterTaxes(input: CorpInput): QuarterCalc[];   // §3.7; her çeyrek { …, state, floor }
export function corporateTax(input: CorpInput): YearCalc;        // §3.8; paidQuarters girdisiyle
```

### 6.7 `muhtasar.ts`
`muhtasarMonth(...)` (§3.5) döner `{ ucretGv, ucretDv, stopaj: { name, withholding, amount }[], unknown: string[], kdv2Hizmet, damga, payable, atLeast }`;
`muhtasarMonths(year, …)`.

### 6.8 `stamp.ts`
`returnStamps(month, flags, rules)` ve `kvStamps(year, rules)` (beyanname + bilanço + gelir tablosu). Sözleşme damgası
hesaplayıcısı yok (§19).

### 6.9 `checks.ts`
`ACCOUNTANT_CHECKS` (§14), `checkStatus(settings)` → `{ p0Done, p0Total, allDone }`. Metinler sahibin dilindedir:
kod adı, dosya adı, İngilizce kelime yoktur (test §11-A).

### 6.10 `view.ts`
`buildTaxView(input)` → `TaxView`. Ekranın bütün sayıları buradan gelir; nakit planı ve Excel aynı hesabı okur. Alanlar:
- `stats` (sıradaki ödeme, 30 gün, hazırlık), `gettingStarted` (dört adım ve durumları, K33);
- `calendar`, `months`, `quarters` (her biri `state`), `year`, `muhtasar`, `sgk`, `stamps`;
- `vat`: nakit planından aynen;
- `local`, `warnings`, `scope`, `checks`, `rulesInfo`;
- `planFeed` (§8.1).

### 6.11 `src/lib/reminders.ts` ekleri
```ts
export function isMuhtasarReminder(r): boolean;     // nakit planı sınıfı: "muhtasar" ya da "stopaj"; SGK, KDV ve yalnız damga değil
export function isProvisionalTaxReminder(r): boolean; // "geçici vergi" (katlanmış "gecici vergi")
export function isLocalTaxReminder(r): "ctv" | "ilan" | null;
export function taxAmountTravels(r): boolean;       // vatAmountTravels ∪ başlığında "muhtasar" ya da "geçici vergi" geçen (tekrarlı ve tutarlı); "stopaj" yalnız başlıkta değil
```

`REMINDER_PRESETS` değişiklikleri:
- `gecici`'nin notu: "Çeyrek bitiminden sonraki ikinci ayın 17'si; 4. dönem (Ekim–Aralık) Şubat'ta, 2025'ten beri
  yeniden veriliyor."
- Yeni `kv`: "Kurumlar vergisi beyannamesi ve ödemesi", tür `vergi`, tekrar `yearly`, `dueDay: "son"`, `months: [4]`,
  14 gün önce, not "Önceki yılın kurumlar vergisi; Nisan'ın son günü."
- Yeni `ctv1` ve `ctv2`: "Çevre temizlik vergisi (1. taksit)" ve "(2. taksit)", tür `vergi`, `yearly`, `"son"`, aylar
  [5] ve [11]. Not: "Tutarı ve günü belediyenin tahakkukundan yazın; gün tahakkuka göre değişebilir."
- Yeni `ilan`: "İlan ve reklam vergisi", `vergi`, `yearly`, `"son"`, [1]. Not: "Tabelanın vergisi; yeni tabela asılmadan
  önce beyan edilir. Gün ve tutar belediyenin tahakkukundan."
- `PRESET_CARDS`'a karşılık gelen dört kart (§4.6). Test: `REMINDER_PRESETS`'teki her anahtarın bir kartı var.

`presetFirstDate` `months`'u zaten destekliyor. Bunun yıllık şablonda da çalıştığı testle doğrulanır.

---

## 7. Sunucu

### 7.1 `src/server/data/tax.ts`
- `loadTaxInputs()`: `integration_state` › `tax.settings` (`parseTaxSettings`), `tax_filings` (yıl ve bir önceki yıl),
  `tax_adjustments` (yıl), `tax_assets` (hepsi, bağlı fatura künyesiyle) — `Promise.all`, tek tur. Dalga 13 birleştiyse
  ayların yazarkasa Z toplamları da (oran oran matrah, gün sayısı). Sitenin `refundPendingMinor`'u site satış kaydından.
- `loadTaxView(model, opts: { year, quarter, today, taxInputs?, cashPlan? })`. Girdiyi almadıysa `loadTaxInputs()`;
  nakit planını almadıysa `loadCashPlan(model, undefined, { taxInputs })` (vergi tablolarını ikinci kez okumaz).
  `buildTaxView`'ı çağırır.
- `loadTaxPlanFeed(model, today, taxInputs)`: nakit planı için (§8.1). `loadCashPlan`'ı çağırmaz, döngü olmasın.
- Sekme sayfaları (K30): Özet `loadTaxInputs` + `loadCashPlan(…, { taxInputs })` + `loadTaxView`; Vergiye göre model
  + `loadTaxInputs` (nakit planı yok); Demirbaş model + `loadTaxInputs`; Kurallar yalnız `loadTaxSettings()`
  ve kural tablosu (model ve nakit planı yok).

### 7.2 `src/server/actions/tax.ts` (`"use server"`)

Her eylemin kalıbı: `requireAdmin`, zod, `attempt()` / `UserError`, `logActivity(me, "Vergi: …", açıklama)`,
`refresh()`. `tax.settings` yazımı `transaction` ve `for("update")` ile oku-değiştir-yaz yapılır (`saveVatCarry`
kalıbı). Dosyada yalnız eylemler dışa açılır (yardımcı yok).

| Eylem | Girdi | Kurallar | İşlem geçmişi |
|---|---|---|---|
| `saveTaxSettings` | `{ periodStart?, firstActivity?, quarterDepreciation?, muhtasarQuarterly?, minWageSupport?, includeSeparate?, carriedLoss? }` | `periodStart` ≥ 2000-01-01 ve ≤ bugün; `carriedLoss.amount` ≥ 0, not 3–300 | "Vergi: ayarlar" · değişen alanlar |
| `saveTaxOverride` | `{ key, value \| null, note }` | anahtar `overridable`; sayı sonlu ≥ 0 (`sgk.isverenOran` ≤ 0,2175); not 3–300 | "Vergi: elle değer" · "damga.gecici 791 → 820 (not)" |
| `saveTaxCheck` | `{ key, checked, note }` | anahtar `ACCOUNTANT_CHECKS`'te | "Vergi: muhasebeciyle konuşuldu" · madde |
| `saveTaxClassifications` | `{ items: ({ source: "fixed", id, doc: TaxDoc \| null, withholding?: Withholding \| null, vatToZero?: boolean } \| { source: "category", id, doc } \| { source: "manual", key, doc } \| { source: "invoice", id, notAsset: boolean })[] }` (1–200) | tek transaction; kalem var; `bordro` yalnız personel bölümünde, `yok` personel bölümünde değil; `withholding` yalnız kira, genel ve personelde `belgeli`; `vatToZero` yalnız `kira` stopajında (`fixed_expenses.vat_rate = 0`); `invoice` yalnız demirbaş adayı | "Vergi: sınıflandırma · 5 kalem" (ad ve belge yazılmaz) |
| `saveTaxFiling` | `{ kind, period, payable, stamp, values, note, alsoReminder }` | dönem biçimi türe uygun (`^\d{4}-Q[1-4]$`, `^\d{4}$`, `^\d{4}-(0[1-9]\|1[0-2])$`); geçici ve KV hesap dönemi içinde; muhtasar ve `kdv_matrah` son 24 ay; tutarlar `zMoney`, matrah eksi olabilir; `kdv_matrah`'ta `payable = 0`, `stamp = 0`. `alsoReminder`: o dönemin sıradaki günü olan tek eşleşen hatırlatıcının (`isProvisionalTaxReminder` / `isMuhtasarReminder` + başlıkta "muhtasar") tutarına `payable + stamp` yazılır; birden çok ya da hiç yoksa yazılmaz, sonuç mesajı söyler | "Vergi: muhasebeci kaydı" · "Geçici vergi 2026/3 · ödenecek 41.200 ₺ · Ödemeler'e de yazıldı" |
| `deleteTaxFiling` | `{ id }` | – | "kaldırıldı" |
| `saveTaxAdjustment` | `{ id?, month, span, kind, amount, label, note }` | ay hesap dönemi içinde ve ≤ bu ay; `span = "ceyrek"` yalnız kafe dışı türlerde, ay çeyreğin son ayı; tutar > 0 | "Vergi: düzeltme" |
| `deleteTaxAdjustment` | `{ id }` | – | – |
| `saveTaxAsset` | `{ id?, name, invoiceId?, acquiredOn, cost, kind, method, lifeYears?, note }` | §3.3 kuralları; fatura kafe kategorisinde; bağlı maliyetler toplamı ≤ faturanın neti (+0,01); `invoiceLabel` sunucuda yazılır | "Vergi: demirbaş" |
| `deleteTaxAsset` | `{ id }` | – | – |
| `setEmployerSgkRate` | `{ rate }` | 0–0,2175; yalnız `settings.isverenSgk` anahtarını yazar | "SGK oranları" · "isverenSgk %15,75 → %19,75 (Vergi)" |

Parolayla onay (step-up) gerekmez: para hareketi ve hesap işlemi yoktur.

### 7.3 `src/server/actions/reminders.ts`
`markReminderDone` ve `postponeReminder` `vatAmountTravels` yerine `taxAmountTravels`'ı çağırır. İşlem geçmişi eki
" · tutar silindi (vergi)" olur. `markReminderDone` geçici vergi hatırlatıcısında `rememberVatPaid`'i tür `gecici` ile
çağırır (`restoreReminder` ve `undoRecentPaid` siler; KDV'deki gibi). `payment-ui.tsx`'teki bildirim: "Muhtasar tutarı
her ay değiştiği için silindi · Geri al" (geçici vergide "Geçici vergi tutarı her dönem değiştiği için silindi").

---

## 8. Nakit planı ve Ödemeler entegrasyonu (`src/lib/cash-plan.ts`, saf)

### 8.1 Girdi

```ts
interface TaxPlanFeed {
  /** Tutarlı vergi satırları: nominal gün, yasal gün, tutar (vergi + beyanname damgası), kaynak */
  items: { kind: "muhtasar" | "gecici" | "kdv2_hizmet"; period: string; nominal: string; legalDue: string; amount: number; atLeast: boolean; source: "estimate" | "filing"; detail: string }[];
  /** Tutarı bilinmeyen yükümlülükler (taslak çeyreğin geçici vergisi): "Tutarı girilmemiş ödemeler"e gider */
  pending: { kind: "gecici"; period: string; nominal: string; legalDue: string; note: string }[];
  /** KDV beyannamelerinin damgası */
  stamps: { kdv: number; kdv2: number };
}
CashPlanInput.tax?: TaxPlanFeed | null;   // yoksa bugünkü davranış
```

- `items` içinde `gecici` yalnız muhasebeci kaydı varsa (`source: "filing"`) ya da çeyrek `hazir`sa (`estimate`)
  bulunur; öteki durumda `pending`'dedir (K25).
- `planInputFromModel` bordroyu `taxPayrollFromModel`'den alır (K18, yasal oranlar). Fonksiyon `minWageSupport` ve elle
  `sgk.isverenOran` için `TaxSettings`'i isteğe bağlı parametre olarak alır. Sabit giderlere `withholding` ve
  `withholdingRate` geçer (§8.2).
- `loadCashPlan(model, upcoming?, opts?: { taxInputs? })` `tax`'ı `loadTaxPlanFeed(model, today, taxInputs ?? await
  loadTaxInputs())`'den geçirir. Feed alınamazsa `tax: null` ile bugünkü gibi çalışır (try/catch, `console.error`).

### 8.2 Sınıflar ve yerleşim

`classify` sırası: sabit gider adı → maaş → SGK → KDV-2 → KDV → **muhtasar** (başlıkta "muhtasar" ya da "stopaj") →
**geçici** → diğer.

Muhtasar ve geçici sınıfı için (her biri ayrı, KDV'nin `reminder` / `default` / `excluded` kipleriyle aynı yapı):

```
dönem(o) = muhtasar: mphbPeriodOf(originalDue(r, o.due)); geçici: quarterOfDue(originalDue(r, o.due))
reminder kipi (bu sınıftan etkin hatırlatıcı var):
  first && r.amount !== null → KESİN (normal hatırlatıcı satırı; 0 ise satır yok); dönem sahiplenilir
  kalan her o: feed'de dönemin item'ı varsa ve dönem sahiplenilmemişse TAHMİN o.date gününe
               (key `vergi:<kind>@<date>`, kind "vergi", estimated: source === "estimate", overdue: o.overdue)
               yoksa unknownAmounts (pending'deyse notuyla)
  paidReminders'ta (son 30 gün) ya da vat-paid'de (gecici) o dönem "Ödendi" ise satır yok
default kipi: feed item'ının nominal günü [yarın, end] içindeyse TAHMİN o güne; pending'in nominal günü bu aralıktaysa
              unknownAmounts'a sentetik satır ("Geçici vergi 2026/3 · tutarı muhasebecinizden isteyin")
excluded ("vergi" excluded'da): kesinler aynen; tahmin yok; tutarsız hatırlatıcılar unknownAmounts'a
```

Satırların görünümü:
- Başlıklar: "Muhtasar (Eylül)", "Geçici vergi (2026/3)", "KDV-2: yurt dışı hizmet (Eylül)".
- `detail`: feed'in `detail`'i ve yasal gün (K24), örnek "Ücret GV 0 + DV 34,68 + damga 939,70; en az (4 kalemin
  stopajı bilinmiyor). Tahmin; kesin tutar tahakkuk fişindedir. Son gün 26 Ekim Pazartesi."
- `href`: `/panel/vergi`.
- `source === "filing"` iken `estimated: false` ve rozet "Muhasebeci".
- **SGK ve KDV satırları** da `detail`'e yasal günü ekler: "son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)".

**Stopajlı sabit gider** (K25, mm-05): `withholding` doluysa satırın tutarı
`amount × (1 + vatRate) − amount × withholdingRate` olur; stopaj yalnız muhtasar satırındadır. Örnek: şahsa kira
160.000 brüt, KDV yok → satır 128.000 + muhtasarda 32.000 = 160.000. Serbest meslek 10.000, KDV %20 → satır 10.000 +
muhtasarda 2.000. `internet_reklam_yurtdisi` ve `yurt_disi_hizmet`te satır tutarı olduğu gibi (yabancı firmaya ödenen),
KDV-2 ayrı satırdadır. Satır notu: "Kira 160.000 ₺ brüt · stopaj %20 muhtasarda".

### 8.3 Beyanname damga satırları

KDV satırı nakit planında bir dönem için **tahmin** olarak görünüyorsa (tutarı 0 olsa da), aynı nominal güne
`damga:kdv@<date>` satırı eklenir: "Damga vergisi (Eylül KDV beyannamesi)", `stamps.kdv`, `estimated: false`, `kind
"vergi"`. KDV-2 tahmin satırı tutarı > 0 olduğunda aynı kuralla `damga:kdv2@<date>`.

Damga satırı eklenmeyen durumlar:
- `excluded` `vergi`'yi içeriyor;
- o dönem KDV'si ödendi (`plan.vat`'ta satır yok);
- aynı ay için "yalnız damga" hatırlatıcısı var (`stampOnly` başlıklar: "KDV damga vergisi", "KDV2 damga vergisi");
  bu hatırlatıcı kendi satırını çizer;
- o dönemin KDV ya da KDV-2 satırı **tutarı yazılmış bir hatırlatıcıdan** geliyor: tutar tahakkuk fişinin toplamı,
  yani **damga dahil** sayılır (başlık sezgisi kullanılmaz). Satırın notu: "Tutar tahakkuk fişinin toplamı sayıldı
  (damga dahil)."

Muhtasar ve geçici vergi tahminleri damgayı zaten içerir. Bu yükümlülüklerin kesin hatırlatıcı tutarına damga
eklenmez.

### 8.4 Tahmine katılanlar ve notlar

- `EstimateRow` `{ key: "vergi", title: "Muhtasar, geçici vergi ve damga", monthly: son muhtasar tahmini, status, note }`.
- `status`: kapalıysa `"off"`, bütün satırlar hatırlatıcıyla kesinse `"covered"`, diğer durumda `"on"`.
- `note`: "Ayın 26'sında muhtasar (en az 974 ₺) · 17 Kasım geçici vergi: tutarı muhasebecinizden".
- `EXCLUDABLE_KEY`: `/^(sales|online|salary|sgk|goods|kdv|vergi|fixed:\d+)$/`. Aynı düzenli ifade
  `saveCashPlanExcluded`'da da kullanılır.
- `planNotes`: §4.6.

---

## 9. Menü, roller, Excel

- `src/components/panel/nav.ts`:
  - `NAV_TREE` › `para.children`'a "gelir-gider"den sonra
    `{ id: "vergi", label: "Vergi", href: "/panel/vergi", roles: ["admin"] }`.
  - `NAV_GROUPS` › "Para"ya şu öğe:

    ```ts
    { href: "/panel/vergi", label: "Vergi", icon: Landmark, roles: ["admin"],
      keywords: "vergi kurumlar vergisi geçici vergi muhtasar stopaj damga vergisi sgk prim bordro gelir vergisi kdv beyanname tahakkuk muhasebeci amortisman demirbaş çevre temizlik ilan reklam vergi takvimi" }
    ```

    ⌘K için alt ekranlar: "Vergiye göre gelir-gider" (`/panel/vergi/gelir-gider`), "Demirbaş & amortisman"
    (`/panel/vergi/demirbas`), "Vergi kuralları" (`/panel/vergi/kurallar`), "Muhasebeciye sorulacaklar"
    (`/panel/vergi/kurallar#sorular`). "Onay" kelimesi geçmez (dalga 10'un Onaylar ekranıyla karışmasın).
  - `SECTION_TABS.vergi` dört sekmeyi taşır.
  - `SHORT_TITLES`: "/panel/vergi" → "Vergi", "/panel/vergi/gelir-gider" → "Vergiye göre", "/panel/vergi/demirbas" →
    "Demirbaş", "/panel/vergi/kurallar" → "Vergi kuralları".
  - `Landmark` lucide'da var; `BOTTOM_NAV` değişmez (telefonda "Menü" çekmecesinde).
- `src/lib/roles.ts` › `ROLE_PERMISSIONS`'a şu satır, "Satış, fatura, gelir-gider…"den sonra:
  `{ label: "Vergi: tahmini vergi takvimi, vergiye göre gelir-gider, muhtasar, SGK, damga, geçici ve kurumlar vergisine katkı", admin: true, staff: false }`.
  `STAFF_PATHS` ve `ADMIN_ONLY_PATHS` değişmez; proxy personeli Bugün'e geri gönderir.
- Dalga 10'un personel sızıntı denetimi (`personel-yetki.md` §6.2): yönetici adresleri listesine `/panel/vergi`,
  `/panel/vergi/gelir-gider`, `/panel/vergi/demirbas`, `/panel/vergi/kurallar` eklenir (personel çereziyle
  `/panel/bugun`'a dönmeli; RSC yükünde vergi verisi yok).
- `src/app/api/export/workbook.ts`: yeni "Vergi" sayfası (yalnız yöneticinin dışa aktarımı, mevcut yetki).
  - Sayfanın ilk satırı: "Tahmin; beyanname değildir. Kafenin payı; şirketin beyannamesi muhasebecidedir."
  - **1. blok:** ay ay vergiye göre gelir-gider (§3.2 satırları) ve çeyrek toplamları; her ayın gelir kaynağı
    ("beyanname", "Z"). Geliri yönetim verisinden gelen aylar ve çeyrekler yazılmaz; yerlerinde tek satır: "Gelir mali
    belgeden girilmedi; hesap ekranda (taslak)" (K31).
  - **2. blok:** geçici vergi ve kurumlar vergisi hesabı (yalnız geliri mali belgeden gelen çeyrekler), satır satır
    formülüyle.
  - **3. blok:** takvim.
  - **4. blok:** kullanılan kurallar (anahtar, değer, dayanak, güven, kaynak) ve "Derlendi 24.10.2026; resmî metinlerle
    karşılaştırılmadı".
  - **5. blok:** "Sahibin notları": Muhasebeciye sorulacaklar'da işaretlenenler ("Sahibin notu: muhasebecimle konuştum
    · tarih · not"); "onay" kelimesi yazılmaz.
  - "Belgesi yok" kalemleri kalem ve tutar olarak yazılmaz; sınıflandırılmamış giderlerin yalnız toplamı yazılır.

---

## 10. Dosyalar

| Dosya | Değişiklik | Adım |
|---|---|---|
| `src/lib/tax/rules.ts`, `rules-2026.ts` | **yeni**: §2, §6.1 | 1 |
| `src/lib/tax/calendar.ts` | **yeni**: §3.1, §3.12 | 1 |
| `src/lib/tax/payroll.ts` | **yeni**: §3.4 | 1 |
| `src/lib/tax/assets.ts` | **yeni**: §3.3 | 1 |
| `src/lib/tax/pnl.ts` | **yeni**: §3.2 | 1 |
| `src/lib/tax/corporate.ts` | **yeni**: §3.7, §3.8 | 1 |
| `src/lib/tax/muhtasar.ts`, `stamp.ts`, `checks.ts`, `view.ts`, `settings.ts` (`parseTaxSettings`) | **yeni** | 1 |
| `src/lib/calc/types.ts` | isteğe bağlı alanlar (§5) | 1 |
| `src/lib/vat-paid.ts` | tür `gecici` (§5) | 1 |
| `src/server/db/schema.ts`, `drizzle/00xx_vergi.sql` + snapshot + journal | §5 | 1 |
| `src/server/data/dataset.ts` | yeni sütunlar ve `cash_outs` birleşimi | 1 |
| `src/lib/reminders.ts` | §6.11 | 1 |
| `src/lib/cash-plan.ts` | §8 (saf): feed, sınıflar, damga satırları, stopajlı sabit gider, yasal gün, `taxPayrollFromModel`'li bordro, notlar | 1 |
| `tests/vergi-*.test.ts`, `tests/nakit-plani.test.ts`, `tests/reminders.test.ts`, `tests/vergi-migration.test.ts` | §11 | 1 |
| `src/server/data/tax.ts` | **yeni**: §7.1 | 2 |
| `src/server/data/cash-plan.ts` | `opts.taxInputs`, feed, bordro | 2 |
| `src/server/actions/tax.ts` | **yeni**: §7.2 | 2 |
| `src/server/actions/cash-plan.ts` | `EXCLUDABLE_KEY` paylaşımı (zaten import ediyorsa değişmez) | 2 |
| `src/server/actions/reminders.ts`, `src/app/panel/hatirlaticilar/payment-ui.tsx` | §7.3 | 2 |
| `src/app/panel/hatirlaticilar/page.tsx`, `reminder-sheet.tsx` | `?yeni=`, `PRESET_CARDS` (§4.6) | 2 |
| `src/app/panel/vergi/` (`page.tsx`, `gelir-gider/page.tsx`, `demirbas/page.tsx`, `kurallar/page.tsx`; istemci bileşenleri: `tax-banner.tsx`, `getting-started.tsx`, `tax-calendar.tsx`, `tax-cards.tsx`, `quarter-picker.tsx`, `bridge-card.tsx`, `filing-dialog.tsx`, `adjustment-dialog.tsx`, `asset-dialog.tsx`, `override-dialog.tsx`, `classify-list.tsx`, `payroll-sheet.tsx`, `explain.tsx`). **`loading.tsx` yok** | **yeni**: §4 | 2 |
| `src/components/panel/nav.ts`, `src/lib/roles.ts` | §9 | 2 |
| `src/app/panel/gelir-gider/page.tsx` | bağlantı satırı ve K19 uyarısı | 2 |
| `src/app/panel/yardim/faq-build.tsx` (dalga 10 birleştiyse; yoksa `page.tsx`) | SSS | 2 |
| `src/app/api/export/workbook.ts` | "Vergi" sayfası | 2 |
| `scripts/seed.ts` | `resetCheck` uyarısı (varlık sayısı), yorum | 2 |
| `tests/roller.test.ts`, `tests/personel-yetkileri.test.ts`, `tests/mobile-nav.test.ts`, `tests/yardim.test.ts`, `tests/haftalik-ozet.test.ts`, `tests/vergi-kaynak.test.ts`; dalga 10'un sızıntı betiği | §11-I | 2 |
| `docs/VERGI.md` (**yeni**), `docs/NAKIT-PLANI.md`, `docs/HAFTALIK-OZET.md`, `README.md`, `docs/planlar/KALAN-ISLER.md` | §12 | 2 |

Dokunulmayanlar:
- `engine.ts` (yalnız okunur);
- `kdv.ts` (yalnız okunur);
- zil, sabah e-postası, Bugün, haftalık özetin kodu (nakit maddesi nakit planını okuduğu için sonucu değişebilir, K29);
- `DEFAULT_SETTINGS` (golden). `staff-editor.tsx`'in "5 puan teşvikli: 15,75" ipucu ayrı bir düzeltmedir (§19);
  uygulayıcı isterse aynı PR'da "2026 kafe: 19,75 (2 puan indirimli)" yapabilir.

---

## 11. Testler (çözülmüş örnekler testlere sabitlenir)

Çalıştırma: `npx tsx --test tests/*.test.ts`, `npx next typegen && npx tsc --noEmit`,
`npx eslint . --ignore-pattern '.claude/**'`.

Tutarlar kuruşa kadar `assert.equal` ile karşılaştırılır. Excel modeline dayananlar ±0,01 toleranslıdır.

**A. `tests/vergi-kurallar.test.ts`**
1. **Tablonun bütünlüğü.** Her kuralda başlık, dayanak, en az bir kaynak (`https://`, kısa adlı), güven ve
   `appliesFrom` var. `RULES_COMPILED_AT === "2026-10-24"`, `RULES_VERIFIED_AT === null`. `overridable` olanlar tam
   olarak §2.4'teki anahtarlar. `confirm` olan her kuralın maddesi `ACCOUNTANT_CHECKS`'te var.
2. **Türetilen kontroller.**
   - `incomeTax(190000) = 28.500`, `400000 → 70.500`, `1.500.000 → 367.500`, `5.300.000 → 1.697.500`.
   - Ücret dışı tarifeyle `1.000.000 → 232.500`, `5.300.000 → 1.737.500`.
   - `pek.ust = 9 × pek.alt = 297.270`.
   - `r2(33.030 × 0,00759) = 250,70`.
   - `kvStamps(2026) = 1.605,80 + 616,30 + 294,20 = 2.516,30`.
3. **Bilinmeyen yıl.** `rulesFor(2027)`: `estimated: true`, `fromYear: 2026`, değerler 2026'nınki.
4. **Elle değer.** `rulesFor(2026, { "damga.gecici": 820 })` → 820; `{ "sgk.isverenOran": 0.1475 }` → bordroda %14,75.
   Kesin bir anahtara verilen elle değer yok sayılır; `kv.asgariZararDusulur` elle değiştirilemez.
5. **Bayatlama.** Bugün 2027-01-23'te uyarı yok, 2027-01-24'te var (90 gün). Yıl 2027 iken "2027 kuralları tabloda
   yok" cümlesi çıkar.
6. **Metinler sahibin dilinde.** `ACCOUNTANT_CHECKS`, `TAX_DOC_LABELS`, `WITHHOLDING_LABELS` ve ekran sabitlerinde
   `.ts`, `src/`, camelCase tanımlayıcı ve "müşavir", "onayladı" geçmez.

**B. `tests/vergi-bordro.test.ts`** (kural tablosunun oranları: işçi 0,14 / 0,01; işveren 0,1975 / 0,02)
1. **Asgari ücret istisnası.** `minWageExemption(m).gv`: 1–6. aylar 4.211,33; 7. ay 4.537,75; 8–12. aylar 5.615,10.
   Toplam 57.881,23. `dv` her ay 250,70.
2. **Asgari ücret.** `payslipFromGross(33.030, m=1)`: SGK 4.624,20, işsizlik 330,30, GV 0, DV 0, net 28.075,50, işveren
   SGK 6.523,43, işveren işsizlik 660,60, maliyet 40.214,03. `payslipFromNet(28.075,50)` aynı brütü bulur.
3. **Net 40.000 ₺, Ocak–Aralık 2026 (tek kişi, Ocak'ta başlar):**

| Ay | Brüt | Kümülatif matrah | GV | DV | Maliyet |
|---|---|---|---|---|---|
| 1 | 49.709,72 | 42.253,26 | 2.126,66 | 126,60 | 60.521,58 |
| 2 | 49.709,72 | 84.506,52 | 2.126,66 | 126,60 | 60.521,58 |
| 3 | 49.709,72 | 126.759,78 | 2.126,66 | 126,60 | 60.521,58 |
| 4 | 49.709,72 | 169.013,04 | 2.126,66 | 126,60 | 60.521,58 |
| 5 | 51.291,06 | 212.610,44 | 3.458,80 | 138,60 | 62.446,86 |
| 6 | 52.851,64 | 257.534,33 | 4.773,45 | 150,44 | 64.346,87 |
| 7 | 52.366,19 | 302.045,59 | 4.364,50 | 146,76 | 63.755,83 |
| 8 | 50.763,96 | 345.194,96 | 3.014,77 | 134,60 | 61.805,12 |
| 9 | 50.763,96 | 388.344,33 | 3.014,77 | 134,60 | 61.805,12 |
| 10 | 54.360,84 | 434.551,04 | 6.044,81 | 161,90 | 66.184,33 |
| 11 | 55.692,02 | 481.889,26 | 7.166,22 | 172,00 | 67.805,03 |
| 12 | 55.692,02 | 529.227,48 | 7.166,22 | 172,00 | 67.805,03 |
| **Toplam** | **622.620,57** | | **47.510,18** | **1.717,30** | **758.040,51** |

   Her ay `net = 40.000,00`. Elle kontrol (1. ay): 49.709,72 − 6.959,36 − 497,10 = 42.253,26. %15 → 6.337,99 −
   4.211,33 = 2.126,66. DV 377,30 − 250,70 = 126,60. Net 40.000,00.
4. **Net 30.000 ₺, Temmuz–Aralık 2026** (Excel'in iki personeli; Temmuz'da başlar):
   - her ay brüt 35.314,52, GV 0 (hesaplanan 4.502,60 < istisna 4.537,75 / 5.615,10), DV 17,34, maliyet 42.995,43;
   - SGK toplamı kişi başına 12.978,09 (4.944,03 + 353,15 + 6.974,62 + 706,29); iki kişide **25.956,18**;
   - altı ay toplamı brüt 211.887,12, DV 104,04, maliyet 257.972,58;
   - panelin basit brütü 35.294,12 (K17 farkı).
5. **PEK üst sınırı.** Brüt 400.000 → SGK matrahı 297.270 (işçi SGK 41.617,80).
6. **Ek ödemeler** yalnız maliyete eklenir; GV matrahına girmez.
7. **`minWageSupport`.** 2 kişide SGK toplamından 2.539,80 düşülür.
8. **Yıl değişimi.** Kümülatif matrah Ocak'ta sıfırlanır.
9. **Ayarlar'dan bağımsız.** Model Ayarlar'ı `isverenSgk: 0.1575` iken `taxPayrollFromModel` işveren payını %19,75 ile
   hesaplar; Gelir-gider'in `staffCost`'u değişmez.

**C. `tests/vergi-kurumlar.test.ts`**

**Örnek A: tam yıl 2026, varsayımsal.** Şirket 2026-01-01'de başlar. Tutarlar KDV hariç; gelir mali belgeden. Personel:
2 asgari ücretli, çeyrekte 241.284,18. Amortisman yöntemi `"kalan"`.

Varlıklar:
- A1: 600.000, 2026-02-10, 5 yıl → yıllık 120.000; Q1'de edinildi, 4 çeyreğe 30.000;
- A2: 240.000, 2026-08-15, 4 yıl → 60.000; Q3'te edinildi, 2 çeyreğe 30.000;
- A3: 10.000, 2026-05-05, doğrudan gider.

Düzeltmeler: Q2'de indirilemeyen gider 5.000 (gecikme zammı), Q4'te 2.000 (trafik cezası), Aralık'ta indirim 3.000
(bağış).

Formül: dönem kazancı = gelir − gider − doğrudan gider − personel (241.284,18) − amortisman + indirilemeyen gider.

| Çeyrek | Gelir | Gider (belgeli) | Doğrudan gider | Amortisman | KKEG | Dönem kazancı | Kümülatif | Matrah | %25 | Asgari %10 | Önceki | Ödenecek |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | 900.000 | 1.000.000 | 0 | 30.000 | 0 | −371.284,18 | −371.284,18 | 0 | 0 | 0 | 0 | 0 |
| Q2 | 1.200.000 | 800.000 | 10.000 | 30.000 | 5.000 | 123.715,82 | −247.568,36 | 0 | 0 | 0 | 0 | 0 |
| Q3 | 1.500.000 | 900.000 | 0 | 60.000 | 0 | 298.715,82 | 51.147,46 | 51.147,46 | 12.786,87 | 5.114,75 | 0 | **12.786,87** |
| Q4 | 1.400.000 | 950.000 | 0 | 60.000 | 2.000 | 150.715,82 | 201.863,28 | 198.863,28 (−3.000 indirim) | 49.715,82 | 20.186,33 | 12.786,87 | **36.928,95** |

Yıllık kurumlar vergisi:
- matrah 198.863,28; hesaplanan 49.715,82; asgari 20.186,33 (bağlamıyor); KV 49.715,82;
- dört çeyrek de "Ödendi" işaretli: mahsup 49.715,82; ödenecek 0; iade 0;
- Q4 "Ödendi" işaretli değilse: mahsup 12.786,87; ödenecek 36.928,95; satır "2026/4 ödendi olarak işaretlenmedi…".

Damgalar:
- geçici vergi 4 × 791,00 = 3.164,00 (sıfır beyanlar dahil);
- KV 2.516,30, `estimated` (2027).

Asgari vergi iki kez sınanır:
- `firstActivity: "ilk"` → asgari sütunu "uygulanmaz" (2026–2028); ödenecekler aynı;
- `firstActivity: null` → yukarıdaki asgari değerler hesaplanır, bağlamaz.

Amortisman yılları: A1 2026–2030 her yıl 120.000; A2 2026–2029 her yıl 60.000. `"ay12"` yöntemiyle A2'nin 2026 payı
Q3'te 45.000 (9/12), Q4'te 15.000; yıl toplamı aynı.

**Örnek B: asgari vergi bağlar (2029; 2026 kuralları, tahmini).** `firstActivity: "ilk"`, başlangıç 2026 → 2029'da
muafiyet yok. Yıllık kazanç 1.000.000, devreden zarar 900.000 (tek alan).
- Matrah 100.000 → %25 = 25.000. Asgari: 10% × 1.000.000 = 100.000 (zarar düşülmez). **KV 100.000**, satırda "Asgari
  kurumlar vergisi uygulandı".
- Devreden zarar kazancı aşarsa (1.200.000) kullanılan 1.000.000'dır; matrah 0, asgari 100.000.

**Çapa.** Örnek A'da Q3 için muhasebeci kaydı `{ matrah: 400.000, hesaplanan: 100.000, payable: 100.000, stamp: 791 }`
girilir. Sonuç:
- Q3 ödenecek 100.000 (kaynak "Muhasebeci");
- Q4 kümülatif = 400.000 + 150.715,82 = 550.715,82; indirimle matrah 547.715,82 → 136.928,96;
- önceki 100.000 → Q4 ödenecek 36.928,96.
- Matrahsız kayıt `{ payable: 100.000, stamp: 791 }`: Q3 ödenecek 100.000 (kesin), Q4 çapasız hesaplanır (Örnek A'nın
  kümülatif vergisi 49.715,82; önceki = 100.000 → Q4 ödenecek 0) ve kart "Sonraki tahmin panelin verisiyle (matrah
  girilmedi)" der.

**İndirim zarar yaratmaz.** Kümülatif 2.000, indirim 3.000 → matrah 0.

**Durum.** Sınıflandırılmamış kalem varken `state === "taslak"`; kart ve takvim görünümünde alt sınır metni yok.
Hepsi sınıflandırılınca, gelir mali belgeden ve M11 işaretliyken `"hazir"`.

**D. `tests/vergi-gelir-gider.test.ts`**

**Örnek C:** Excel verisi, `createModel({ ...ds, currentMonth: "2026-10" })`. Varsayılan ayarlar: sınıflandırma yok,
varlık yok, beyanname matrahı yok (gelir "yönetim verisi"). Bordro kural tablosunun oranlarıyla, aylar tam.

| | Temmuz | Ağustos | Eylül | Q3 (25.06–30.09) |
|---|---|---|---|---|
| Gelir (ModPOS, KDV hariç; yönetim verisi) | 157.806,36 | 454.545,45 | 390.479,24 | 1.002.831,06 |
| SMM (sayım yok, önceki sayım yok: stok 0) | 154.284,53 | 60.709,03 | 173.982,74 | 388.976,30 |
| Faturalar (mal, demirbaş ve demirbaş adayı dışı) | 28.286,17 | 9.036,22 | 19.401,51 | 56.723,90 |
| POS komisyonu (tahmini; kasa raporu yok, Ayarlar'ın kart oranı) | 3.714,76 | 10.700,00 | 9.195,54 | 23.610,30 |
| Personel (bordro, yasal oranlar) | 85.990,86 | 85.990,86 | 85.990,86 | 257.972,58 |
| Sonuç | −114.469,96 | 288.109,34 | 101.908,60 | **275.547,98** |
| Sayılmayan: sınıflandırılmamış sabit giderler | 218.889,64 | 295.025,17 | 294.695,17 | 808.609,97 |
| Sayılmayan: demirbaş olabilir (Aria Yazılım 39.780; Beyza Karaman 30.000) | 39.780,00 | 0 | 30.000,00 | 69.780,00 |
| Sayılmayan: Kuruluş & Demirbaş (varlık yok) | 948.680,41 | 2.750,00 | 0 | 951.430,41 |

Kafenin geçici vergi katkısı 2026/3:
- `firstActivity: null`; `state: "taslak"`;
- hesaplanan **68.887,00**; asgari 27.554,80 (bağlamıyor);
- alt sınır (`floor`): sonuç − 808.609,97 − 69.780 − 951.430,41 < 0 → 0;
- Eylül çeyrek sonu, sayım yok → kırmızı uyarı.

**Örnek C, beyanname matrahıyla:** Temmuz `{ m10: 128.700,46, m20: 12.569,37 }`, Ağustos `{ m10: 369.994,62, m20: 0 }`,
Eylül `{ m10: 347.099,03, m20: 335.000 }`:
- gelir Q3 **1.193.363,48** (rozet "mali belge · beyanname"), kapsam çipi "Gelir: şirketin tamamı (beyanname) · gider:
  kafe" ve kartta uyarı; sonuç 466.080,40 → hesaplanan 116.520,10;
- Eylül'e `kafeDisi: 335.000` girilince gelir 858.363,48, sonuç 131.080,40 → 32.770,10; kapsam "yalnız kafe".
- Hiçbir görünümde ve Excel'de ModPOS ile beyanname arasındaki fark yazmaz.

Sınıflandırmanın etkileri:
- "Kira" (`fixed`) `belgeli` → her ay kira hücresi gidere girer, "gider henüz hesaba girmedi" toplamı azalır;
- `fatura`, `yok` ve `bordro` sayılmaz; `yok` yalnız toplamda ve sayıda görünür;
- personel bölümündeki "Part-time çalışan"a `yok` verilemez (eylem reddeder);
- Aria Yazılım faturası "Gider (demirbaş değil)" → Temmuz faturalarına 39.780 eklenir.

Diğer vakalar:
- **Harcama kaydı.** Kasadan çıkanı `fis` olan sayılır (mal bölümünde ÷ 1,10). `yok` olan sayılmaz. Bağsız kayıt
  kategorinin `taxDoc`'una uyar. `supplierEntryId` dolu ve kasadan çıkansız kayıt "Belgesi yok"; hem `cashOutId` hem
  `supplierEntryId` doluysa kasanın belgesi.
- **Varlık bağlama.** Temmuz'daki XND faturalarından birine 300.000 ₺'lik varlık bağlanınca "Eşlenmemiş tutar" o
  kadar azalır. Varlık Aria Yazılım faturasına (39.780) bağlanırsa fatura aday listesinden çıkar, gider olmaz.
- **POS komisyonu.** Kasa raporlu ayda pay Σ kart ÷ Σ Z (yemek kartı hariç); `commission:pos` elle girilmişse o.
- **Çeyrek sonu sayımı.** 31 Ağustos sayımı varken 30 Eylül sayımı yoksa Q3'ün `closing`'i Ağustos sayımıdır, uyarı
  "31 Ağustos sayımı kullanıldı".
- **Site geliri.** `refundPendingMinor` 50.000 (500 ₺) ise site satırı 500 ₺ düşük.
- **`includeSeparate: true`.** Kafe dışı faturalar "Kafe dışı gider"e girer, kapsam çipi değişir. "Alp Koç" ayar
  kapalıyken de notla listelenir.
- **`personnel:net` elle girilmiş ay.** Elle girilen toplam kullanılır.
- **Hesap dönemi başı.** 2026-06-24 tarihli fatura sayılmaz, 2026-06-25 tarihli sayılır.
- **Köprü.** Örnek C'nin Eylül'ünde köprünün iki ucu tutar: Gelir-gider gideri − sayılmayanlar ± farklar = vergiye
  göre gider.
- **Çeyrek düzeltmesi.** `span: "ceyrek"`, `month: "2026-09"`, `gelir_kafe_disi` 90.000 → Q3 gelirine bir kez girer,
  listede "2026/3".

**E. `tests/vergi-demirbas.test.ts`**
- Yıllık ve çeyrek payları (Örnek A). Son yıl kalanı kuruş farkını kapatır (1.000 ₺, 3 yıl → 333,33 / 333,33 / 333,34).
- `lifeYears = null` → 0 ve uyarı.
- 12.000 ₺ sınırı (12.000 kabul, 12.000,01 ret).
- 2026'da Temmuz'da edinilen varlık: `"kalan"` Q3 ve Q4'e yarı yarıya; `"ay12"` Q3'e 9/12, Q4'e 3/12; Q2 ve Q1 payı yok.
- XND üç varlık, 5 yıl: 2026 189.736,09; `"kalan"` Q3 94.868,05 / Q4 94.868,04; `"ay12"` Q3 142.302,07 / Q4 47.434,02.
- Demirbaş adayı: 12.000,01 ve önceki 90 günde aynı tedarikçi ve kategoride faturası olmayan → aday; 90 gün içinde
  faturası olan → değil; Kira & AVM ve Komisyon → değil.
- Faturası silinen varlık: `invoiceId` null, `invoiceLabel` dolu → uyarı; aday faturalar aynı tedarikçi ve ±%5.

**F. `tests/vergi-muhtasar.test.ts`**
- **Örnek D (Eylül 2026, Excel'in 2 personeli, profil yok).** GV 0, DV 2 × 17,34 = 34,68, MPHB damgası 939,70, ödenecek
  **974,38**, `atLeast: true`, bilinmeyen ["Kira", "Instagram reklamı", "Influencer", "Muhasebeci"]. Yasal gün 26.10.2026.
- **Stopaj.** "Kira" (160.000) `kira` → +32.000. "Muhasebeci" (10.000) `serbest_meslek` → +2.000. "Instagram reklamı"
  (30.000) `internet_reklam_yurtdisi` → +4.500 ve `kdv2Hizmet` 6.000. "Influencer" (50.000) `yok`. Toplam 39.474,38,
  `atLeast: false`.
- **Personelsiz, yalnız stopaj.** Damga 791,00. Hiçbiri yoksa satır yok.
- **Üç aylık.** Temmuz ve Ağustos'ta yalnız damga; Eylül'de üç ayın vergisi + damga.
- **Muhasebeci kaydı** `{ payable: 120, stamp: 939,70 }` → ödenecek 1.059,70, kaynak "Muhasebeci", `atLeast: false`.

**G. `tests/vergi-takvim.test.ts`**
- `legalDueDate`:

| Girdi | Sonuç |
|---|---|
| 2026-10-25 (Pazar) | 2026-10-26 |
| 2026-11-28 (Cumartesi) | 2026-11-30 |
| 2026-10-31 | 2026-11-02 |
| 2026-10-29 (Cumhuriyet Bayramı, Perşembe) | 2026-10-30 |
| 2026-10-28 (arife) | 2026-10-28 |
| 2026-05-17 (Pazar) | 2026-05-18 |
| 2027-03-10 (Ramazan Bayramı) | 2027-03-12 |
| 2026-12-26 (Cumartesi) | 2026-12-28 |
| 2027-01-31 (Pazar) | 2027-02-01 |
| 2029-01-06 (tablo dışı Cumartesi) | 2029-01-08, reason "tatil listesi 2028'de bitiyor" |

- `nominalDue("gecici", "2026-Q4") = "2027-02-17"`, `nominalDue("kv", "2026") = "2027-04-30"`.
- `quarterOfDue("2027-02-17") = 2026-Q4`, `quarterOfDue("2026-11-17") = 2026-Q3`.
- `periodOf(2026)` = 25.06–31.12. Q1 dönem dışı, Q2 25.06–30.06.
- `defaultYear`: 2027-03-01 → 2026 (2026 KV kaydı yok), 2027-03-01 ve 2026 KV kaydı var → 2027, 2027-05-01 → 2027;
  2026 boyunca seçici yok.
- `taxCalendar` (Excel, bugün 2026-10-24): §3.12 tablosundaki satırlar sırasıyla. Muhtasar 974,38 `atLeast`; SGK
  25.956,18; geçici vergi satırının `amount === null`, `state: "taslak"`; ÇTV 2. taksit satırı 30.11 tutarsız. KDV-2
  Ekim satırı yok (Ekim faturalarında tevkifat ve yurt dışı hizmet yoksa). "Sonra" satırı 17.02.2027 ve 30.04.2027.
- Takvim satırı ile nakit planı satırı aynı yasal günü söyler (SGK Eylül: ikisinde de "2 Kasım").

**H. `tests/vergi-damga.test.ts`**
- Aylık beyanname damgası: tevkifatlı ayda 2.521,70, tevkifatsız ayda 1.730,70.
- `kvStamps(2026)` 2.516,30; 2027'de `estimated` ve aynı tutar.

**I. Entegrasyon ve kaynak testleri**
- `tests/nakit-plani.test.ts` (bugün 2026-10-22; beklenen değerler dalga 11'den sonra yeniden hesaplanır):
  1. Feed'de muhtasar Eylül 974,38 (`atLeast`) → hatırlatıcı yoksa `vergi:muhtasar@2026-10-26` tahmin satırı, detail
     "en az". Hatırlatıcı (aylık, 26'sı, tutarsız) varsa satır o günde ve `unknownAmounts`'ta değil. Tutar 1.200
     yazılıysa kesin 1.200, tahmin yok.
  2. Geçici vergi 2026/3 `pending`'de (taslak) → tahmin satırı yok, `unknownAmounts`'ta "Geçici vergi 2026/3 · tutarı
     muhasebecinizden isteyin". Muhasebeci kaydı `{ payable: 41.200, stamp: 791 }` → `vergi:gecici@2026-11-17` kesin
     41.991, rozet "Muhasebeci". Hazır çeyrekte tahmin satırı.
  3. `excluded: ["vergi"]` → vergi satırı yok. Tutarsız muhtasar hatırlatıcısı `unknownAmounts`'a döner.
     `EstimateRow` "vergi" `"off"`.
  4. KDV tahmin satırı tutarı 0 iken `damga:kdv@2026-10-28` 791 satırı var. "Eylül KDV damga vergisi" başlıklı ve
     tutarlı hatırlatıcı varsa yok. Tutarı yazılmış "KDV Eylül" hatırlatıcısında (başlıkta "damga" yok) damga satırı
     **yok** ve not "damga dahil".
  5. SGK (Excel) Eylül **25.956,18** (eski 23.117,65; K18). `planNotes` SGK metni yeni cümleyle; detail'de yasal gün
     "son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)".
  6. **Stopajlı sabit gider.** "Kira" 160.000, `kira`, KDV %0 → plan satırı 128.000; muhtasara 32.000; toplam brütü
     aşmaz. "Muhasebeci" 10.000, `serbest_meslek`, KDV %20 → satır 10.000; muhtasara 2.000.
  7. **KDV-2 yurt dışı hizmet.** `internet_reklam_yurtdisi` 30.000 → `vergi:kdv2_hizmet@2026-10-25` 6.000; Eylül'ü
     kapsayan tutarlı KDV-2 hatırlatıcısı varsa satır yok.
  8. Sınıf sırası:
     - "Muhtasar ve prim hizmet beyannamesi" → muhtasar;
     - "SGK prim ödemesi" → SGK;
     - "Geçici vergi beyanı ve ödemesi" → geçici;
     - "Kira stopajı" → muhtasar;
     - "KDV damga vergisi" → diğer.
- `tests/reminders.test.ts`:
  - `isMuhtasarReminder`, `isProvisionalTaxReminder`, `isLocalTaxReminder`;
  - `taxAmountTravels`: tek seferlikte false; "Kira stopajı" (aylık, 8.000) **false** (Ödendi'den sonra tutar kalır);
    "Muhtasar ve prim hizmet" (aylık, tutarlı) true; "Geçici vergi beyanı" (3 aylık, tutarlı) true;
  - yeni şablonların ilk günü: bugün 2026-10-24 → `kv` 2027-04-30, `ctv2` 2026-11-30, `ilan` 2027-01-31;
  - `REMINDER_PRESETS`'teki her anahtarın `PRESET_CARDS`'ta kartı var;
  - kaynak testi: `markReminderDone` ve `postponeReminder` `taxAmountTravels`'ı çağırır; geçici vergide
    `rememberVatPaid` tür `gecici`.
- `tests/haftalik-ozet.test.ts`: nakit planında vergi satırı (muhtasar ve yasal oranlı SGK) olan bir planda "ilk eksi
  gün" maddesi o satırları sayar; geçici vergi `pending`'deyken madde onu saymaz.
- `tests/roller.test.ts`, `tests/personel-yetkileri.test.ts`, `tests/mobile-nav.test.ts`:
  - `navTreeFor("staff")` "vergi" içermez;
  - `canOpen("staff", "/panel/vergi") === false` (ve üç alt sayfa);
  - `mobileTitleFor("/panel/vergi/kurallar") === "Vergi kuralları"`, `"/panel/vergi/gelir-gider"` → "Vergiye göre";
  - `ROLE_PERMISSIONS` satırı var.
- `tests/vergi-kaynak.test.ts`:
  - `src/app/panel/vergi/**/page.tsx`'in her biri `requireAdmin`'i çağırır; `src/app/panel/vergi/` altında
    `loading.tsx` yok;
  - `kurallar/page.tsx` `loadModel` ya da `loadCashPlan` import etmez; `gelir-gider/page.tsx` `loadCashPlan` import
    etmez; `loadTaxView` `loadCashPlan`'ı `taxInputs` ile çağırır;
  - `src/server/actions/tax.ts`'teki her dışa açık fonksiyon `requireAdmin` ve `logActivity` içerir;
    `setEmployerSgkRate` yalnız `isverenSgk` anahtarını yazar; `saveTaxClassifications`'ın `logActivity` metninde
    kalem adı yok;
  - `src/lib/tax/**` `@/server` ya da `drizzle` import etmez;
  - `rules-2026.ts`'te `http://` yok, her kaynak `https://`;
  - `TAX_DISCLAIMER` dört sayfanın her birinde (`TaxBanner`) kullanılır;
  - `workbook.ts`'in "Vergi" sayfası `yok` belgeli kalemleri ve yönetim verisi gelirini yazmaz (kaynak ve birim testi);
  - `src/app/panel/vergi/` `Segmented` import etmez.
- `tests/yardim.test.ts` kuralları, migration testi (§5).

---

## 12. Belgeler

- **`docs/VERGI.md` (yeni).** İçindekiler:
  - amaç ve sınırlar ("tahmin, beyanname değil", kafe payı, geçici ve kurumlar vergisi şirketin beyannamesi);
  - gelirin kaynağı (mali belge sırası, K11) ve neden;
  - ekranlar;
  - hesapların formülleri (§3'ün kısaltması);
  - kural tablosu özeti ve güncelleme yordamı ("yeni yıl: `rules-2027.ts`, `TAX_RULES`'a ekle, testleri güncelle,
    `RULES_COMPILED_AT`; resmî metinle karşılaştırınca `RULES_VERIFIED_AT`");
  - muhasebeciye sorulacaklar (§14);
  - saklama (`tax_*` tabloları, `invoices.tax_not_asset`, `tax.settings`, `payments.vat-paid` türü `gecici`, `db:reset`
    davranışı);
  - nakit planı ile ilişki ve nakit planını okuyan yüzeyler (K29);
  - kod haritası.
- **`docs/NAKIT-PLANI.md`.** "Muhtasar, geçici vergi ve damga" bölümü (§8); stopajlı sabit gider; KDV hatırlatıcısının
  tutarı damga dahil; SGK'nın bordro kaynağı ve yasal oran (Eylül 25.956,18); yasal gün alt yazısı; "Dahil değil"
  metni.
- **`docs/HAFTALIK-OZET.md`.** Nakit maddesinin vergi satırlarını (muhtasar, SGK, hazır çeyreğin geçici vergisi)
  saydığı; taslak geçici verginin sayılmadığı.
- **`README.md`:** ekran listesine "Vergi: tahmini vergi takvimi, vergiye göre gelir-gider, muhtasar, SGK, damga ve
  kafenin geçici ve kurumlar vergisine katkısı ([docs/VERGI.md](docs/VERGI.md))". db:reset satırına demirbaş
  listesinin silindiği.
- **`docs/planlar/KALAN-ISLER.md`:** dalga 12 satırı ve "Sahibe notlar (dalga 12)": §14'ün temel maddeleri, SGK oranı,
  KDV beyannamesi satışlarının girilmesi, adres çelişkisi.

---

## 13. Kenar durumlar

- **Hesap dönemi başında veri yok** (25–30 Haziran 2026): Q2 yalnız o günlerin faturalarıyla hesaplanır. Ciro yoksa
  gelir 0'dır, "2026/2 için muhasebecinin rakamını girin" yazar.
- **Ekim cirosu yarım** (1–16 Ekim, elle): Q4 "bugüne kadar" yazar, tamamlanmaz. Kasım'dan itibaren Z raporlarıyla
  tam ay gelir.
- **Bir ayın geliri beyannameden, bir ayınki ModPOS'tan:** ay ay rozet; çeyrek taslaktır; Excel o çeyreği yazmaz.
- **Beyanname matrahı olan aya kafe dışı gelir düzeltmesi:** sayılmaz (beyannamede içinde), uyarı (§4.2).
- **Fatura iadesi** (eksi tutar): gideri azaltır. Doğrudur.
- **Varlığı bağlı fatura silinir** (Paraşüt iptali, `sync.ts`'in `origin = parasut` silmesi): `invoiceId` boşalır,
  `invoiceLabel` kalır; Demirbaş ve Özet uyarır, aday faturalar ve "Bağla" (§3.3). Yeni fatura "demirbaş olabilir"
  listesine düşerse uyarı çift sayımı yazar.
- **Sabit gider silinir:** sınıflandırması da gider. Gelir-gider'deki elle hücre yine sayılır ve "silinmiş kalem"
  olarak listelenir (engine'in `outOfRange` hücresi), varsayılanı `null`'dır.
- **Muhasebeci kaydı tahminden çok farklı:** kartta "Kafenin katkısı ≈ 68.900 ₺ · şirketin beyannamesi 12.000 ₺" yazar.
  Fark kendiliğinden düzeltilmez; matrahı girildiyse sonraki dönem çapadan devam eder.
- **İki muhtasar hatırlatıcısı aynı aya düşerse** ikincisi `unknownAmounts`'a gider (KDV'deki kural).
- **Çeyrek sonu sayımı yok:** Mart, Haziran, Eylül ve Aralık'ta kırmızı uyarı; en son sayım kullanılır (K15).
- **Personelin çıkışı ve girişi** ay düzeyindedir (`startMonth`, `endMonth`). Gün bilinmez; uyarı satırı yazılır.
- **Ödemeler'de tutar ile muhasebeci kaydı farklı:** sarı satır "Ödemeler'deki tutar (X) muhasebecinin rakamından (Y)
  farklı; nakit planı Ödemeler'dekini, Vergi sayfası muhasebecininkini kullanıyor."
- **Muhasebeci kaydı girildi, hatırlatıcıya yazılamadı** (birden çok eşleşen hatırlatıcı): toast söyler, pencere
  "Ödemeler'e ekle" bağlantısını gösterir.
- **Sınıflandırma kaydedilmeden sayfadan çıkılır:** tarayıcı uyarısı; kayıt yapılmaz.
- **Kural tablosu bayat ya da yıl tabloda yok:** §2.5.
- **Rol:** personel `/panel/vergi`'ye girerse proxy Bugün'e gönderir. Eylemler `requireAdmin` ile reddeder.
- **Hata:** saf hesaplar atmaz. `loadTaxView` hata verirse sayfanın `error.tsx`'i çalışır. Nakit planı feed
  alamazsa `tax: null` ile bugünkü gibi çalışır ve plan bozulmaz (try/catch, `console.error`).

---

## 14. Muhasebeciye sorulacaklar (bölüme güvenmeden önce)

Bu liste `ACCOUNTANT_CHECKS` olarak kodda da durur ve Kurallar › Muhasebeciye sorulacaklar'da "Muhasebecimle
konuştum" diye işaretlenir. İşaret sahibindir; muhasebecinin onayı anlamına gelmez (K34). **Temel** maddeler
işaretlenmedikçe çip "Muhasebeciye sorulacaklar: n / 8" kalır. Metinler ekranda olduğu gibi, sahibin dilindedir.

| Anahtar | Öncelik | Panelin varsaydığı | Muhasebeciye sorun |
|---|---|---|---|
| M1 `sirket` | Temel | Hesap dönemi 25.06.2026'da başlıyor; şirketin ilk kez mi kurulduğu bilinmiyor, bu yüzden asgari kurumlar vergisi muafiyeti uygulanmıyor | Şirket ilk kez mi kuruldu, yoksa birleşme, devir ya da tür değişikliğiyle mi? (2026–2028 asgari kurumlar vergisi muafiyeti buna bağlı.) laffogato.net'teki yasal bilgilerde yazan MERSİS numarası levhadaki vergi numarasıyla uyuşmuyor; hangisi doğru? |
| M2 `sgk_oran` | Temel | Vergi ve nakit planı 2026 standart oranını (işveren %19,75 + %2) kullanıyor; Ayarlar'da %15,75 yazıyor | Bordroda işveren SGK oranı kaç? Emekli çalışan var mı (oranlar farklı)? 6111, 7103 gibi bir teşvikten yararlanıyor musunuz? |
| M3 `bordro` | Temel | 2 kişi, net 30.000 ₺, net üzerinden anlaşılmış; brüt 35.314,52, gelir vergisi 0, damga 17,34; aylar tam | Eylül 2026 bordrosunun brüt, gelir vergisi, damga vergisi ve SGK toplamları; işe giriş günleri; Temmuz tam ay mı? Part-time çalışan bordroda mı? |
| M5 `kira` | Temel | Kiraya veren şirket (stopaj yok, %20 KDV). Giderler'deki 160.000 ₺ ile faturalardaki 35.000 ₺ + KDV farklı | Kirayı kime ödüyoruz (şirket mi, şahıs mı), aylık gerçek kira ne, ciro kirası var mı? Kira sözleşmesinin damga vergisi (Faturalar'da 793,80 ₺) ödendi mi? |
| M6 `stopaj` | Temel | Reklam, influencer ve muhasebecilik ödemelerinin stopajı bilinmiyor; muhtasar "en az" yazıyor | Instagram reklamı (30.000 ₺/ay) Türkiye'deki bir ajansa mı, doğrudan Meta'ya mı ödeniyor? Eylül'deki 30.000 ₺'lik reklam faturası (Beyza Karaman) şahıs mı; internet reklamıysa %15 stopaj gerekir mi? Influencer ödemeleri (50.000 ₺/ay) serbest meslek makbuzuyla mı, influencer istisnasıyla (banka kesintisi) mı? Muhasebecilik ücreti şahıs makbuzuyla mı, şirket faturasıyla mı? Eylül muhtasarının tahakkuk fişindeki tutar? |
| M7 `demirbas` | Temel | XND faturaları (948.680 ₺) ve öteki demirbaşlar listede yok, amortisman 0; ModPOS lisansı (39.780 ₺) "demirbaş olabilir"; amortisman kalan çeyreklere eşit dağıtılıyor | Hangi kısım demirbaş, hangisi kiralanan yere yapılan dekorasyon (özel maliyet, kira süresine göre)? Faydalı ömürler? Geçici vergide amortismanı nasıl dağıtıyorsunuz? ModPOS lisansı ve ışıklı tabela demirbaş mı? 12.000 ₺ altı doğrudan gider |
| M8 `gecici_2026` | Temel | 2026/2 kaydı yok; 2026/3 için şirketin rakamı bilinmiyor (kafenin katkısı en çok ≈ 68.900 ₺, taslak) | 2026/2 geçici vergi beyannamesi (17 Ağustos) verildi mi, matrahı ve vergisi? 2026/3 rakamını Kasım'ın ilk haftası isteyin (son gün 17 Kasım). Ödenen geçici vergileri Ödemeler'de "Ödendi" işaretleyin: ödenmeyen yıllık beyannamede mahsup edilemez |
| M11 `kafe_disi` | Temel | Kafe dışı gelir ve gider yok sayıldı | Şirketin kafe dışı işleri (yazılım, karaoke box MaviBahçe, ortağın işleri) var mı, gelir ve giderleri nasıl? Eylül KDV beyannamesindeki %20'lik 335.000 ₺ satış nedir? Aylık KDV beyannamelerindeki satışların kafe dışı kısmı ne kadar? |
| M4 `muhtasar` | Ek | Muhtasarın vergi kısmı aylık | Muhtasarı 3 ayda bir mi veriyorsunuz (10 ve daha az çalışan)? |
| M9 `kdv` | Ek | Devreden KDV Eylül 2026: 121.204,69 (nakit planına girildiyse); satış matrahları girilmedi | Her ayın KDV beyannamesindeki devreden KDV ve satış matrahları (oran oran). Temmuz'da panelde olmayan ≈ 31.700 ₺ indirilecek KDV hangi faturalar? |
| M10 `fis` | Ek | Fişle yapılan alımlar KDV hariç tahminle gider sayılıyor | Fişle (market, yazarkasa) yapılan alımların KDV'si indiriliyor mu? Satılan ürünün hammaddesi market fişiyle mi alınıyor; 12.000 ₺'yi aşan alımlarda fatura alınıyor mu? |
| M12 `ikram` | Ek | İkram, zayi ve personel tüketiminin vergi karşılığı hesaplanmıyor | Bunlar vergide nasıl işleniyor? |
| M13 `asgari_zarar` | Ek | Asgari kurumlar vergisinde geçmiş yıl zararı düşülmüyor; Danıştay kararı kesinleşmedi | Durum (2029'dan önce etkisi yok) |
| M14 `destek` | Ek | Asgari ücret desteği (1.269,90 ₺/kişi/ay) SGK'dan düşülmüyor | SGK tahakkukunda düşülüyor mu? |
| M15 `damga` | Ek | Geçici vergi beyannamesinin damgası 791 ₺; kurumlar vergisiyle bilanço ve gelir tablosu damgası 616,30 + 294,20 ₺ | Tutarlar doğru mu, ödeniyor mu? |
| M16 `ortak` | Ek | Binek araç, ortaklar cari hesabı, kredi yok; Alp Koç faturaları şirketin gideri sayılmıyor | Alp Koç adına gelen Pruva faturaları şirkette nasıl kaydedildi (gider, KDV indirimi)? Ortaklar cari hesabı, kredi, binek araç var mı? Ortakların Bağ-Kur primi şirketten mi ödeniyor? |
| M17 `alkol_turizm` | Ek | Alkollü içecek yok; turizm belgesi yok | İkisi de doğru mu? |
| M18 `yerel` | Ek | Çevre temizlik ve ilan-reklam vergisi girilmedi; ÇTV 2. taksit 30 Kasım varsayıldı | Kafenin adresi: vergi levhasında Atatürk Cad. No: 28, panelde Opera AVM yazıyor; hangisi? ÇTV için belediyeye bildirim yapıldı mı, 2026 tutarı ve taksitleri (ilk yıl)? 2026 tabelası için ilan-reklam beyannamesi tabela asılmadan önce verildi mi, ödendi mi? |

Ayrıca bir kez yapılacak iş: §2.2'deki değerleri resmî metinlerle karşılaştırmak (71 Seri No DVK GT, 332 Seri No GVGT,
588 Sıra No VUK GT, SGK Genelgeleri 2026/1 ve 2026/8, 476 s. CBK, GİB KV Beyan Rehberi 2026). Karşılaştırılınca
`RULES_VERIFIED_AT` doldurulur ve bant "karşılaştırıldı" der.

---

## 15. Sahibin kararı (varsayılanla uygulanır, iş beklemez)

1. **Kapsam:** varsayılan **yalnız kafe**; şirketin diğer işleri elle girilir.
2. **SGK oranı:** Vergi ve nakit planı 2026 yasal oranını (işveren %19,75) kullanır; Gelir-gider Ayarlar'daki %15,75'le
   kalır. Ayarlar'ı değiştirmek sizin kararınız (muhasebeciye sorduktan sonra düğme çıkar; Temmuz–Ekim gelir-gideri de
   değişir). Varsayılan: **Ayarlar değişmez**.
3. **Asgari kurumlar vergisi muafiyeti:** "Şirket nasıl kuruldu?" yanıtlanana kadar **uygulanmaz** (vergi yüksek
   görünür).
4. **Sınıflandırılmamış giderler ve demirbaş adayları:** varsayılan **sayılmaz**; hesap "Taslak".
5. **Gelir kaynağı:** KDV beyannamesi satışları girilmeyen ayda ModPOS cirosu "yönetim verisi" rozetiyle kullanılır;
   o çeyrek taslaktır ve Excel'e yazılmaz. Varsayılan **evet**.
6. **Muhtasar ve geçici vergi tutarı** "Ödendi" deyince silinsin mi (KDV gibi; yalnız başlığında "muhtasar" ya da
   "geçici vergi" geçen hatırlatıcıda)? Varsayılan **evet**.
7. **Nakit planı** muhtasarı ve beyanname damgalarını tahmini olarak göstersin mi? Varsayılan **evet** ("Tahmine
   katılanlar"dan kapatılır). Geçici vergi yalnız tutarı girilince ya da çeyrek hazırken.
8. **Personel ayı** tam sayılsın mı (işe giriş günü bilinmiyor)? Varsayılan **evet**.
9. **Geçici vergide amortisman:** varsayılan **kalan çeyreklere eşit**.
10. **Demirbaş olabilir** eşiği: KDV hariç 12.000 ₺ ve aynı tedarikçiden 90 günde ilk fatura. Varsayılan **evet**.

---

## 16. Uygulama sırası: iki adım

Taban: dalga 10 ve 11 birleşmiş `main` (birleşmemişlerse §0'daki çakışma noktaları elle çözülür, R2).

**Adım 1: Çekirdek (saf mantık, şema, testler).** Sonunda ekran yoktur, ama nakit planı yeni tahminleri hesaplayabilir
durumdadır (yükleyici bağlanmadan).
1. `src/lib/tax/rules.ts`, `rules-2026.ts`, `settings.ts`, `checks.ts`; testler A.
2. `payroll.ts`; testler B.
3. `calendar.ts`, `stamp.ts`; testler G ve H.
4. `assets.ts`, `pnl.ts` (`types.ts` ekleriyle); testler D ve E.
5. `corporate.ts`, `muhtasar.ts`, `view.ts`; testler C ve F.
6. Şema, migration `vergi` (R2: tabandan journal), `dataset.ts`, `vat-paid.ts`; migration testi.
7. `reminders.ts` ekleri; `cash-plan.ts` (§8: feed, `pending`, sınıflar, damga satırları, stopajlı sabit gider, yasal
   gün, `taxPayrollFromModel`'li bordro, notlar); testler I'nin nakit planı, hatırlatıcı ve haftalık özet kısmı.
   Nakit planı beklenen değerleri dalga 11'in değerlerinden yeniden hesaplanır.
8. `npx tsc --noEmit`, eslint, `npm test`, boş veritabanında `npm run db:migrate && npm run db:seed`.

**Adım 2: Ekranlar ve entegrasyon.**
1. `src/server/data/tax.ts` (`loadTaxInputs`), `src/server/actions/tax.ts`.
2. `loadCashPlan`'a `opts.taxInputs` ve feed; `reminders.ts` eylemleri, `payment-ui.tsx`, `?yeni=` ve `PRESET_CARDS`.
3. `src/app/panel/vergi/*`: dört sayfa, Başlarken, çeyrek seçici, sınıflandırma listesi ve toplu kayıt, pencereler,
   telefon düzeni.
4. `nav.ts`, `roles.ts`, Gelir-gider bağlantısı ve K19 uyarısı, Yardım; testler I'nin kalanı; dalga 10'un sızıntı
   betiğine dört adres.
5. Excel "Vergi" sayfası.
6. `docs/VERGI.md`, `NAKIT-PLANI.md`, `HAFTALIK-OZET.md`, README, KALAN-ISLER, `seed.ts` uyarısı ve yorumu.
7. §17 doğrulaması.

---

## 17. Doğrulama

- `npx next typegen && npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'`, `npm test`. Boş veritabanında
  `npm run db:migrate && npm run db:seed`; migration sayısı bir artar. `VERGI_TEST_DATABASE_URL` ile migration testi.
- `npm run dev`, Excel verisi, bugün 2026-10-24:
  1. **Yönetici.** Kenar çubuğunda Satış & gider › Vergi var. **Personel** girişinde menüde yok; `/panel/vergi`'ye ve
     üç alt sayfaya gidince Bugün açılır; dalga 10'un sızıntı betiği RSC yükünde vergi verisi bulmaz.
  2. **Özet.**
     - Üç rakam: "KDV-2 ve muhtasar · 26 Ekim · en az ≈ 3.600 ₺", "en az ≈ 30.300 ₺ · tutarı bilinmeyen 1 ödeme",
       "Hazırlık 0 / 4". Başlarken kartı görünür.
     - Takvim §3.12 tablosuyla aynı: 26.10 KDV-2 ≈ 2.600 ₺ ve muhtasar "en az 974 ₺ · Tahakkuk fişindeki tutarı girin";
       02.11 SGK ≈ 26.000 ₺; 17.11 geçici vergi "Tutarı bilinmiyor" ve "Taslak"; 30.11 ÇTV 2. taksit.
     - Geçici vergi kartı "Giderler sınıflandırılınca netleşir · şimdilik en çok ≈ 68.900 ₺"; "≈ 0 ₺" yazmaz.
  3. **Vergiye göre.**
     - Q3 seçili; Temmuz–Eylül Örnek C'yle tutar; gelir satırında "Yönetim verisi (ModPOS), mali belge değil".
     - Temmuz–Eylül KDV beyannamesi satışları girilince rozet "mali belge · beyanname", kapsam çipi değişir, ModPOS ile
       fark hiçbir yerde yazmaz.
     - "Kira"yı "Belgesi muhasebecide" yapıp "3 değişikliği kaydet" deyince geçici vergi düşer; "Seçilmedi"ye geri alıp
       kaydedince eski hâline döner. Kayıt sırasında sayfa bir kez yenilenir.
     - "Kira"ya "Şahsa işyeri kirası" seçilince "Faturadaki KDV'yi 'KDV yok' yap" kutusu çıkar; nakit planında kira
       satırı 128.000 ₺, muhtasarda 32.000 ₺.
     - Köprü kartının iki ucu Gelir-gider'deki giderle ve vergiye göre giderle tutar.
  4. **Demirbaş.**
     - XND'nin üç faturası ayrı ayrı varlık olarak eklenir, ömür boş bırakılır: uyarı çıkar.
     - Ömür 5 yapılınca 2026 amortismanı 189.736,09 olur; Q3'e 94.868,05, Q4'e 94.868,04 düşer; ayar "Kümülatif ay ÷ 12"
       yapılınca Q3 142.302,07; geçici vergi değişir.
     - İmge "Sütlük" (2.750 ₺) "Doğrudan gider" olur. Aria Yazılım faturası "Gider (demirbaş değil)" olur.
  5. **Muhasebeci kaydı.** Geçici vergi 2026/3'e yalnız "Ödenecek" ve damga girilir, "Ödemeler'e de yaz" işaretli:
     kartta "Muhasebeci" rozeti, "matrah girilmedi" notu; nakit planındaki satır kesinleşir ve Ödemeler'deki geçici
     vergi hatırlatıcısında tutar görünür. Kayıt kaldırılınca takvim yine "Tutarı bilinmiyor" der.
  6. **Ödemeler.**
     - "Muhtasar ve prim hizmet" şablonu eklenince nakit planındaki muhtasar satırı hatırlatıcının gününe geçer ve
       "Tutarı girilmemiş ödemeler"den düşer.
     - Tutar yazıp "Ödendi" denince tutar silinir ("Muhtasar tutarı her ay değiştiği için silindi · Geri al"), "Geri al"
       geri yazar. Sabit tutarlı "Kira stopajı" hatırlatıcısında tutar kalır.
     - Takvimdeki "Ödemeler'e ekle" (ÇTV) ekleme sayfasını şablonla dolu açar.
  7. **Kurallar.**
     - Kaynak bağlantıları yeni sekmede açılır, kısa adla görünür.
     - `damga.gecici`'yi 820 yapınca 17.11 satırının ayrıntısına 820 yansır; "Tablodaki değere dön" 791'e döndürür.
  8. **Muhasebeciye sorulacaklar.** 8 temel madde işaretlenince çip "Muhasebecinizle gözden geçirildi (sahibin
     işareti)" olur; M2 işaretlenince Gelir-gider'deki SGK uyarısında düğme çıkar ve yalnız `isverenSgk`'yi yazar.
  9. **Excel.** Dışa aktarımda "Vergi" sayfası, ilk satırda "Tahmin; beyanname değildir…"; yönetim verisi geliri olan
     çeyrek yerine "Gelir mali belgeden girilmedi" satırı; "Belgesi yok" kalemleri yok.
  10. **Tarayıcı, 320, 390 ve 1440 px.** Dört sekmede yatay kaydırma yok (takvim satırları açık ve kapalı), pencereler
      sığar, sınıflandırma listesinde seçimler alttan açılır, bordro dökümü 390 px'te sığar. 1440 px'te Vergiye göre
      tablosu 2027 Aralık (12 ay geçmiş) ile de sığar. Ekran görüntüleri PR'a eklenir.
  11. **Süre.** Genel bakış ve haftalık özetin "nakit" toplayıcısı vergi beslemesiyle ölçülür; toplayıcı 4 sn
      bütçesinin içinde kalır (ölçüm PR gövdesinde).
- Birleştirmeden sonra canlı derleme günlüğünde `✓ Veritabanı şeması güncel (N migration)` aranır; çalışma zamanı
  hataları kontrol edilir.

---

## 18. Riskler

- **Tahmin beyanname sanılabilir.** Üst bant, "≈", "Taslak", "Nasıl hesaplandı" ve kapsamlı kart başlıkları; geçici ve
  kurumlar vergisinin tutar sütununa tahmin yazılmaz; muhasebeci kaydı ayrı rozetle. Kural tablosunun derlendiği gün ve
  "resmî metinlerle karşılaştırılmadı" görünür.
- **Yönetim verisi vergi geliri sanılabilir.** Gelir kaynağı rozetle yazılır; ModPOS'la mali belge arasındaki fark
  hiçbir yerde yazılmaz; yönetim verisiyle hesaplanan çeyrek Excel'e gitmez (K11, K31).
- **Kafe payı şirket vergisi sanılabilir.** Kart başlığı "kafenin katkısı"; kapsam çipi her yerde; M11 temeldir.
- **Sınıflandırma yükü.** Sahip 26 kalemi bir kez işaretler; seçimler toplu kaydedilir. Başlarken kartı kalan sayıyı
  gösterir. Varsayılan güvenli taraftadır (yüksek vergi, taslak).
- **Nakit planı değişir** (K18, K25, K29): SGK Excel verisinde ayda ≈ 2.840 ₺ artar (yasal oran); muhtasar ve damga
  satırları girer; stopajlı sabit gider net ödenir. Genel bakış, haftalık özetin "ilk eksi gün" maddesi ve Claude'un
  nakit planı aracı da değişir. Testler güncellenir; NAKIT-PLANI.md ve HAFTALIK-OZET.md'ye yazılır.
- **Kural yanlışı.** Değerler arama özetlerinden geldi (resmî metin okunmadı). Bu riski kaynak bağlantıları,
  "muhasebeci onayı gerekir" işaretleri, Muhasebeciye sorulacaklar, belirsizler için elle değer ve testteki türetilmiş
  kontroller (tarifenin kümülatifleri, istisnaların ÇSGB tablosuyla tutması) azaltır.
- **Paylaşılan dosyalar ve sıra (10 → 11 → 12):**
  - `cash-plan.ts`, `server/data/cash-plan.ts`, `tests/nakit-plani.test.ts` (dalga 11 de değiştiriyor; vergi
    eklemeli, beklenen değerler dalga 11'den sonra);
  - `reminders.ts`, `actions/reminders.ts` (dalga 11'in `openBalance` değişikliği);
  - `nav.ts`, `roles.ts`, Yardım (dalga 10);
  - `types.ts` ve `dataset.ts` (dalga 11'in `supplierEntryId`'si; vergi yeniden eklemez);
  - `vat-paid.ts` (yalnız tür eklenir).
- **`db:reset` demirbaş listesini siler** (K32). Onay uyarısında, belgede ve README'de yazılı.

---

## 19. Sonraya

- **Claude (MCP)** salt okunur `vergi_ozeti` aracı: takvim, kafenin geçici ve kurumlar vergisine katkısı, dayanaklarıyla
  ("belgesi yok" kalemleri olmadan).
- **Ciro mutabakatı ekranı** (envanter B3): Z ↔ ModPOS ↔ e-Arşiv ↔ beyanname, fark gerekçeleriyle (ikram, iptal, test,
  personel). Vergi sayfasında değil, ayrı ekranda.
- **Z raporunda oran başına matrah** dalga 13'le gelirse K11'in (2). kaynağı bağlanır.
- **Sitenin e-Arşiv tarihine göre site geliri** (B2): panel bugün e-Arşiv kesim gününü almıyor (koli kargoda, kafe
  teslimde, karaoke saat bitince); site satış ucu bu günü verirse `pnl.ts`'in site satırı ondan okunur.
- **Faturadaki gelir vergisi stopajının Paraşüt'ten okunması** (e-SMM) ve tevkifatlı reklam faturasının stopajı.
- **Sözleşme damgası hesaplayıcısı** ve kira faturasından sözleşme tutarı çıkarımı.
- **Zarar mahsubunda FIFO ve 5 yıllık süre dolumu**, `asgariZararDusulur`'un elle değiştirilmesi: `rules-2027` işiyle.
- **Binek araç sınırları, finansman gider kısıtlaması, ortaklar cari hesabı (adat)** (envanter I1).
- **Kısmi süreli personel** (gün sayısı) ve personelin giriş günü.
- **Satılan, hurdaya çıkan demirbaş; azalan bakiyeler yöntemi.**
- **`staffCost`'un düzeltilmesi** (Gelir-gider'in doğru brüt ve yasal oranı kullanması Excel eşitliğini bozar; sahip
  isterse ayrı karar) ve Gelir-gider'deki POS komisyonunun yemek kartını iki kez sayması (`cardShareOf`, K12a'nın
  Gelir-gider karşılığı). Personel ekranındaki "5 puan teşvikli: 15,75" ipucu.
- **Giderler ekranındaki sabit gider formuna "Vergi belgesi" ve "Stopaj" alanları** (bugün yalnız Vergi'den).
- **KDV hatırlatıcısında "tutar damga dahil mi" işareti** (bugün tutarı yazılmış hatırlatıcı hep damga dahil sayılır;
  işaret hatırlatıcılar tablosunda migration ister).
- **Bugün ve sabah e-postasına vergi satırları**, isabet görüldükten sonra.
- **`rules-2027.ts`:** Kasım–Aralık 2026'da açıklanacak değerlerle, Ocak 2027'den önce.

---

## Eleştiri kaydı

Birinci tur (iki bağımsız doğrulama) kural tablosunu düzeltti; bu tur iki eleştiriyi (muhasebe ve mevzuat `mm-*`,
arayüz ve mimari `ux-*`) koda ve kaynaklara karşı denetledi. Denetlenenler: `docs/NAKIT-PLANI.md` (Temmuz–Eylül
beyanname tablosu), `src/server/db/seed/excel-data.json` (sabit giderler, faturalar), `src/lib/cash-month.ts`
(`card + mealCard`), `engine.ts` (`closingStock`, `cardShareOf`), `components/ui/segmented.tsx`,
`reminder-sheet.tsx` (`PRESET_CARDS`), `actions/costs.ts` (`rateSchema`), `server/parasut/sync.ts` (285, 1270),
`scripts/seed.ts` (`resetCheck`), `server/weekly/collect.ts` (4 sn), dalga 10 ve 11 planları, laffogato
`src/lib/legal/entity.ts`; mevzuat için web araması (damga, 4/b, tecil, ÇTV, CBK 476 ve diğerleri). Örnek C
prototiple yeniden hesaplandı.

| id | Karar | Neden |
|---|---|---|
| mm-01 | kabul | Doğrulandı: Q3 ModPOS KDV hariç 1.002.831 ₺, beyannamelerin %10 matrahı 845.794 ₺ (NAKIT-PLANI). K11 gelir kaynağı sırası (beyanname matrahı → mali Z → ModPOS rozetli), yeni `kdv_matrah` kaydı, fark hiçbir yerde yazılmaz, Excel'e yönetim verisiyle hesap gitmez (K31). Beyanname şirketin tamamı olduğu için "kafe dışı kısmı" alanı eklendi |
| mm-02 | kabul | Geçici ve KV tahmini takvimin tutar sütununa ve nakit planına yazılmaz; `pending` → "Tutarı girilmemiş ödemeler" notuyla; kart "kafenin katkısı"; M8'e "Kasım'ın ilk haftası". ux-02 ile birleşti: tahmin yalnız hazır çeyrekte plana girer |
| mm-03 | kabul | Seed'de "Part-time çalışan" ve "Personel yemeği" personel bölümünde. Personelde `yok` yok, `bordro` ve "Dışarıdan hizmet" var; "Belgesi yok: muhasebecinize sorun"; KKEG ifadesi kalktı; kalemler Excel'e ve işlem geçmişine gitmez |
| mm-04 | kabul | 0,1575 2025 Ocak oranı; 2026 standart %19,75. Vergi ve nakit planı kural tablosunun oranını kullanır (K16, K18: Eylül 25.956,18), Ayarlar yalnız Gelir-gider'de; elle `sgk.isverenOran`; M2'ye SGDP ve 6111/7103. "Her ay tahakkuk tutarını girin" SGK hatırlatıcısı ve takvimdeki istekle |
| mm-05 | kabul | Çift sayım doğru: `withVat` brütü öderken muhtasar stopajı ayrıca ekliyordu. Stopajlı sabit gider net ödenir (§8.2), "KDV yok" önerisi, test I-6 |
| mm-06 | kabul | Seed'de Instagram 30.000, Influencer 50.000, Muhasebeci 10.000; Eylül'de 30.000 ₺'lik reklam faturası şahıstan. Stopaj profilleri (internet reklamı %15, yurt dışı KDV-2), "en az 974 ₺; 4 kalemin stopajı bilinmiyor" (Kira da profilsiz), geçmiş dönemde "tahakkuk fişindeki tutarı girin", KDV-2 yurt dışı hizmet satırı. Influencer'ın 20/B oranı yazılmadı (kaynak doğrulanmadı), bilgi satırı |
| mm-07 | kısmen | Çeyrek sonu sayımı yoksa en son sayım ve kırmızı uyarı, fişli alım KDV hariç tahmin (mal ÷ 1,10, diğer ÷ 1,20), M10 sorusu: kabul. Fişli alımda %10/%20 iki uç: ret (aralık zaten taslak durumunu taşıyor; tek tahmin ve M10 yeterli) |
| mm-08 | kısmen | "Demirbaş olabilir" listesi (12.000 ₺, 90 gün kuralı; Excel'de Aria Yazılım ve bir reklam faturası) ve iki ucun tanımı: kabul. Alt sınırda "en kısa makul ömür": ret, ömür uydurulur; yerine ömrü girilmemiş varlığın maliyeti tamamen gider sayılır (gerçek alt sınır) ve alt sınır yalnız ayrıntıda (ux-01) |
| mm-09 | kısmen | Doğrulandı: `cash-month.ts` kart + yemek kartını sayıyor, yemek kartı komisyonu Faturalar › Komisyon'da. Vergi hesabında yemek kartı hariç pay ve Gelir-gider'e yazılmış banka dekontu tutarı: kabul. Varsayılanı aralığa almak: ret (komisyon her ay gerçekten var, tahmini rozet yeter); Gelir-gider'deki aynı sorun §19 |
| mm-10 | kabul | ÇTV işyerinde emlak vergisi taksitlerinde (Mayıs, Kasım sonu; TÜRMOB). Hatırlatıcı yoksa takvime 30.11 tutarsız satır; M18'e tabela beyanı, ÇTV bildirimi ve adres çelişkisi (levha Atatürk Cad. No: 28, KALAN-ISLER Opera AVM) |
| mm-11 | kabul | PARASUT.md: "Kolayı ortak Alp Koç alır". §2.3'e Alp Koç (sorulacak) ve 4/b Bağ-Kur (bilgi; 2026 alt sınır 11.808,23, indirimli 10.156,73, ikincil kaynak); M16'ya sorular; ayar kapalıyken de listelenir |
| mm-12 | kabul | KPMG ve muhasebetr 2026 tutarlarını doğruluyor: bilanço 616,30, gelir tablosu 294,20. `damga.mali`, KV damgası 2.516,30, M15 |
| mm-13 | kısmen | `refundPendingMinor`'un düşülmesi, rozet ve muhasebeci kaydı girilmiş çeyreğin sonradan değişmemesi (çapa zaten böyle): kabul. e-Arşiv kesim gününe göre site geliri: ret, panel bu günü almıyor; §19 |
| mm-14 | kabul | Kartlarda Muhasebeci › Ödemeler › tahmin, nakit planında Ödemeler önde (K4). KV mahsubu yalnız "Ödendi" işaretli geçici vergi; bunun için `payments.vat-paid`'e tür `gecici` |
| mm-15 | kısmen | Başlık sezgisi kalktı, tutarı yazılmış KDV hatırlatıcısı damga dahil sayılır (varsayılan "dahil"). Hatırlatıcı başına işaret: ret (hatırlatıcılar tablosuna migration; hatanın üst sınırı 791 ₺), §19 |
| mm-16 | kabul | Ayar `quarterDepreciation` ("kalan" varsayılan, "ay12"), dökümde yöntem, M7. Varsayılan Q3'te daha az amortisman ayıran |
| mm-17 | kabul | "Muhasebecinizle gözden geçirildi (sahibin işareti)", Excel'de "sahibin notu"; ux-09 ile "muhasebeci" adı (K34) |
| ux-01 | kabul | Başlarken kartı, `state: "taslak" \| "hazir"`, "≈ 0 ₺" kalktı; "808.610 ₺ gider henüz hesaba girmedi". Alt sınır yalnız ayrıntıda, tanımıyla (mm-08) |
| ux-02 | kabul | Doğrulandı: `loadCashPlan` Genel bakış (page.tsx:180), haftalık "nakit" (4 sn) ve MCP'de. Geçici vergi yalnız kayıt, hatırlatıcı tutarı ya da hazır çeyrekle; K29 düzeltildi; HAFTALIK-OZET ve test; 4 sn ölçümü |
| ux-03 | kabul | Doğrulandı: `Segmented` `value: T` (seçilmedi yok), `overflow-x-auto`. Satır başına `Select` / alttan seçim, "Seçilmedi", toplu kayıt `saveTaxClassifications`, tek `refresh()`; stopaj ikinci alan |
| ux-04 | kabul | Yalnız "Ödenecek" ve damga zorunlu; matrah katlanmış; matrahsız kayıt çapa değil; "Ödemeler'deki hatırlatıcıya da yaz" |
| ux-05 | kısmen | Sekme "Vergiye göre", köprü kartı, personel cümlesi: kabul. Köprünün gelir tarafındaki fark: ret, mm-01 gereği ModPOS ile mali belge farkı yazılmaz; köprü gider tarafını açar, gelir için kaynağı söyler |
| ux-06 | kabul | Çeyrek seçici `?ceyrek=`, üç ay + çeyrek + kümülatif, telefonda tek kart; bütün aylar Excel'de; 1440 px doğrulaması |
| ux-07 | kabul | Üç `Stat`, takvim, yalnız geçici ve KV kartı; muhtasar, SGK, damga, KDV ve yerel takvim satırının ayrıntısında; masaüstü düzeni yazıldı |
| ux-08 | kabul | Tek tutar, "tahmini" rozeti yok, düğmeler açılan gövdede, kısa kaynak adları, `dl` formül, 320/390 testi |
| ux-09 | kabul | "derlendi; resmî metinlerle henüz karşılaştırılmadı" + `RULES_VERIFIED_AT`; açıklama; SGK cümlesi; "muhasebeci"; "sabit tutar"; §14 sahibin dilinde ve metin testi |
| ux-10 | kabul | Doğrulandı: `rateSchema` dört oranı ister. Düğme M2'den sonra, `setEmployerSgkRate` yalnız `isverenSgk`; uyarı Gelir-gider'de (mm-04) |
| ux-11 | kabul | `taxAmountTravels` yalnız "muhtasar" ya da "geçici vergi" başlığında; "Kira stopajı" tutarı kalır; toast metni; iki test |
| ux-12 | kabul | Doğrulandı: `PRESET_CARDS` ayrı liste, sayfa `searchParams` okumuyor. Dört kart, `?yeni=`, kart-şablon testi |
| ux-13 | kabul | `loadTaxInputs`, `loadCashPlan(…, { taxInputs })`, sekme başına yükleme, kaynak testi |
| ux-14 | kısmen | Sıra (kasadan çıkan önce), birleştirme sırası 10 → 11 → 12, nakit planı değerlerinin dalga 11'den sonra hesaplanması, faq-build ve sızıntı betiği: kabul. Önerme kısmen yanlış: dalga 11'in `mevcut` adayı kasadan çıkan kayıt olamaz (cari planı §3.1.3), sonuç değişmez; sıra savunma için |
| ux-15 | kabul | Sözleşme damgası hesaplayıcısı §19'a; tek "devreden zarar" alanı; `asgariZararDusulur` kodda sabit; asgari ücret desteği yalnız anahtar; demirbaş satırı sadeleşti |
| ux-16 | kabul | Devrik bordro tablosu, yapışkan ilk sütun |
| ux-17 | kabul | `defaultYear` (30 Nisan'a kadar KV'si girilmemiş önceki yıl), seçici iki yılla; testler |
| ux-18 | kabul | Nakit planı satırı yasal günü, takvim satırı nakit planı gününü yazar; test |
| ux-19 | kabul | Doğrulandı: `sync.ts` `origin = parasut` faturayı siliyor; `resetCheck` uyarısı listesi; migration testi dosya düzeyinde. `invoiceLabel`, uyarı ve aday faturalar; reset uyarısına varlık sayısı; SQL metni testi + `VERGI_TEST_DATABASE_URL` |
| ux-20 | kabul | Doğrulandı: panelde `loading.tsx` yok. Telefonda tek satır bant, `Suspense` + `PageSkeleton`, kafe dışı düzeltmede çeyrek (`span`) |

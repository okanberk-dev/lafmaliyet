# Vergi araştırma ham notları (24 Eki 2026)

Araç notu: WebFetch bu oturumda her alan adında DNS hatası verdi (getaddrinfo ENOTFOUND, gib.gov.tr dahil),
curl egress proxy'de 403. Bütün rakamlar WebSearch sonuç özetlerinden; her biri en az iki bağımsız
kaynakla (mümkünse resmi) çapraz denetlendi. Resmi metnin kendisi okunamadı -> güven derecesi buna göre.

## Şirket gerçekleri (repo)
- laffogato deposu `src/lib/legal/entity.ts`: NEXTGEN YAZILIM EĞİTİM İNŞAAT SAN. VE TİC. LTD. ŞTİ.,
  Tuzla VD, VKN 6312110904, vergi türü Kurumlar Vergisi, ana NACE 621000 (Bilgisayar programlama),
  **işe başlama tarihi 25.06.2026 (vergi levhası)**.
  -> ilk hesap dönemi 25.06.2026-31.12.2026 (kıst); 2025 beyannamesi yok; asgari KV muafiyeti (ilk defa
     faaliyete başlama ise) 2026-2027-2028.
  -> ana faaliyet yazılım: kurumlar vergisi bütün şirketin; panel yalnız kafeyi görür.
- Panel (lafmaliyet) sabitleri src/lib/constants.ts: isciSgk 0.14, isciIssizlik 0.01, isverenSgk 0.1575,
  isverenIssizlik 0.02 -> 0.1575 = 2025 (20.75-5). 2026 kafe (imalat dışı) için 0.1975 olmalı (aşağıda).
  Bruto hesap net/(1-0.15): GV ve DV yok sayılıyor (asgari ücrette doğru, üstünde eksik).
- docs/NAKIT-PLANI.md: KDV 1 No.lu ayın 28'i, KDV-2 25'i, Eylül 2026 KDV2 damga vergisi 791 TL (TÜRMOB tablosuyla tutuyor).

## SGK 2026
- 7566 sayılı Kanun (RG 19.12.2025, 33112): MYÖ işveren hissesi %11 -> %12 (Ocak 2026'dan). Uzun vade toplam %20 -> %21.
- Hazine indirimi 5510 m.81/1-(ı): 2026'da imalat dışı 2 puan (2025 Şubat-Aralık 4 puan, SGK Genelgesi 2025/6),
  imalat (NACE C) 5 puan 31.12.2026'ya kadar (CB 2027'ye uzatabilir). SGK Genelgesi 2026/1 (06.01.2026, "İki Puanlık İndirim").
- Oranlar 2026: işçi MYÖ %9 + GSS %5 = %14, işsizlik işçi %1; işveren MYÖ %12 + KVSK %2,25 + GSS %7,5 = %21,75;
  işsizlik işveren %2; toplam %38,75. Kafede indirimle işveren SGK %19,75 (+%2 işsizlik = %21,75).
- ÇSGB 2026 asgari ücret tablosu: brüt 33.030; işçi SGK 4.624,20; işsizlik 330,30; net 28.075,50;
  işveren maliyeti: imalat 39.223,13, diğer 40.214,03, indirimsiz 40.874,63 (GV/DV hesaplanmamış).
  (csgb.gov.tr/Media/gm2fekds/asgari-ücret-2026.pdf; csgb.gov.tr/poco-pages/asgari-ucret/ -- sayfada eski "%20,75" cümlesi kalmış.)
- PEK 2026: günlük alt 1.101, aylık alt 33.030, günlük üst 9.909, aylık üst 297.270 (9 kat). sgk.gov.tr Prime Esas Kazanç Miktarları.
- Asgari ücret desteği 2026: 1.270 TL/ay/kişi (KPMG, alomaliye) -- dayanak ve şartlar doğrulanacak.

## Asgari ücret 2026
- Asgari Ücret Tespit Komisyonu kararı 2025/1 (23.12.2025), RG 26.12.2025 33119: günlük brüt 1.101,00; aylık brüt 33.030,00; net 28.075,50. Yıl içinde ara zam yok.

## Gelir vergisi tarifesi 2026 (GVK 103; 332 Seri No GVGT, RG 31.12.2025 5. mük.)
- 190.000'e kadar %15; 400.000'e kadar %20; ücrette 1.500.000'e kadar %27 (ücret dışı 1.000.000); 5.300.000'e kadar %35; üstü %40.
- 2025 (329 Seri No): 158.000 / 330.000 / 1.200.000 (ücret; ücret dışı 800.000) / 4.300.000 -- doğrulanacak.

## Yeniden değerleme / damga
- 2026 yeniden değerleme oranı %25,49 (585 Sıra No VUK GT, RG 27.11.2025 33090).
- Damga vergisi maktu tutarları ve üst sınır %18,95 artış (CB Kararı 10783, RG 31.12.2025); 71 Seri No DVK GT (RG 31.12.2025 33124 5. mük.).
  Üst sınır 2026: 29.115.961,10 TL.
  Beyanname damga 2026 (TÜRMOB 01.01.2026 notu): kurumlar 1.605,80; KDV 791,00; muhtasar 791,00; MPHB 939,70; yıllık GV 1.189,50.
- Yemek istisnası 2026 günlük 300 TL (2025: 240); yol 158 TL (2025: 126).

## Kurumlar vergisi
- Oran %25 (KVK 32/1) 2025 ve 2026. (bankalar vb. %30)
- Yurt içi asgari KV (KVK 32/C, 7524 s. Kanun RG 02.08.2024): hesaplanan KV, indirim ve istisna düşülmeden önceki kurum kazancının %10'undan az olamaz; 2025 ve sonrası; geçici vergide de.
  İlk defa faaliyete başlayan: faaliyete başlanan dönem dahil 3 hesap dönemi uygulanmaz (2025 kurulan: 2025-26-27).
  Birleşme/devir/bölünme/tür değişikliği ile kurulan "ilk defa" sayılmaz. GİB Yurt İçi Asgari KV Rehberi 02.04.2026.
- Beyan: izleyen yılın Nisan 1-30, ödeme aynı ay sonu (2025 dönemi: 30.04.2026).

## Geçici vergi
- 7566 s. Kanun GVK mük.120 "ilk dokuz ay" ibaresini kaldırdı -> 4. dönem geri geldi, 01.01.2025'ten başlayan dönemler.
  2025 4. dönem: 17.02.2026. 2026 dönemleri: 17 Mayıs, 17 Ağustos, 17 Kasım 2026, 17 Şubat 2027.
- Oran %25 (kurum), kümülatif; ödenen geçici vergi yıllık KV'den mahsup, artanı iade/mahsup.

## Enflasyon düzeltmesi
- 7571 s. Kanun m.34 -> VUK geçici 37 (RG 25.12.2025 33118): 2025 (geçici dönemler dahil), 2026, 2027 hesap dönemlerinde yapılmaz. CB 3 döneme kadar uzatabilir. (587 Sıra No VUK GT, RG 24.12.2025: 2025 1-3. geçici dönemlerde yapılmaz.)

## (ek) Arama turu 2 bulguları

### Gelir vergisi 2025 (karşılaştırma) - 329 Seri No GVGT, RG 30.12.2024 32768 (2. mük.)
158.000 %15 / 330.000 %20 / ücrette 1.200.000 (ücret dışı 800.000) %27 / 4.300.000 %35 / üstü %40.
2026 kümülatif vergi (332 Seri No): 190k -> 28.500; 400k -> 70.500; ücret 1,5M -> 367.500; 5,3M -> 1.697.500; ücret dışı 1M -> 232.000; 5,3M -> 1.737.000.

### Asgari ücret istisnası (GVK 23/18, DVK 2 sayılı tablo; 7349 s. Kanun)
2026 aylık GV istisnası: Oca-Haz 4.211,33; Tem 4.537,75; Ağu-Ara 5.615,10 (yıllık 57.881,23).
Damga istisnası her ay 250,70 (=33.030 x 0,00759). Doğrulama: 28.075,50 x %15 = 4.211,33; Temmuz kümülatif
196.528,50 > 190.000 -> 21.547 x %15 + 6.528,50 x %20 = 4.537,75. Asgari ücretli işçide GV ve DV sıfır.
Asgari üstü ücret: aylık GV = [tarife(kümülatif matrah) - tarife(önceki kümülatif)] - o ayın asgari ücret istisnası (>=0);
matrah = brüt - işçi SGK - işçi işsizlik; DV = brüt x 0,00759 - 250,70 (>=0). SGK ve işsizlik matrahı 297.270'te kesilir.
Panelin net/(1-0,15) brüt hesabı yalnız asgari ücrette doğru; üstünde brüt eksik çıkar (yinelemeli çözüm gerekir).

### Beyan/ödeme günleri (GİB "Beyanname Verme ve Ödeme Süreleri" tablosu, VUK 18 tatil kaydırması)
- KDV 1 No.lu: izleyen ayın 28'i (beyan + ödeme). KDV 2 No.lu: izleyen ayın 25'i. MPHB (muhtasar + SGK bildirimi) ve
  damga vergisi beyannamesi: izleyen ayın 26'sı; muhtasar vergisi aynı gün ödenir. SGK 4/a primleri: izleyen ayın son günü (5510 m.88).
- Son gün tatile düşerse izleyen ilk iş günü (Eylül 2026 KDV2: 26.10.2026 çünkü 25.10 Pazar; 28.11.2026 Cumartesi -> 30.11).
- Geçici vergi: dönemi izleyen 2. ayın 17'si (beyan + ödeme). 2026: 17 May, 17 Ağu, 17 Kas 2026, 17 Şub 2027.
- KV: hesap dönemini izleyen 4. ayın 1-son günü, ödeme aynı ay sonu (2026 dönemi: 1-30 Nisan 2027).
- 10 ve daha az işçide vergi kesintileri 3 aylık beyan edilebilir; SGK bildirimi yine aylık.

### Damga vergisi oranları (DVK 1 sayılı tablo; nispi oranlar 2026'da değişmedi)
- Kira mukavelenameleri binde 1,89 (sözleşme süresince toplam kira); mukavelename/taahhütname binde 9,48; ücret binde 7,59.
- Beyanname maktu 2026 (71 Seri No): KV 1.605,80; KDV 791,00 (KDV-2 dahil); muhtasar 791,00; MPHB 939,70;
  yıllık GV 1.189,50; geçici vergi "diğer beyannameler" 791,00 (tek kaynak, muhtemel).
- Faturalar damga vergisine tabi değil (DVK 2 sayılı tablo).

### Stopajlar
- İşyeri kirası (gerçek kişiye, KDV'siz) %20 (GVK 94/5-a; BKK 2009/14592); konut değil. Kiraya veren şirketse stopaj yok, KDV %20.
- Serbest meslek %20 (GVK 94/2-b).
- Kâr payı %15 (GVK 94/6-b-i; CB Kararı 9286, RG 22.12.2024; 22.12.2024'ten itibaren dağıtılanlar). Muhtasarla izleyen ayın 26'sı.

### Diğer 2026 had/tutarlar (588 Sıra No VUK GT; 332 Seri No GVGT; KDV GUT Seri 56)
- Fatura düzenleme sınırı 12.000 TL (KDV dahil; 2025: 9.900); KDV tevkifat alt sınırı da 12.000 (KDV dahil).
- Doğrudan gider yazılabilecek demirbaş 12.000 TL (KDV hariç). Özel usulsüzlük cezası alt sınır 17.000 (tek kaynak).
- Binek otomobil (GVK 40/5, KVK 8; 332 Seri No): aylık kira gideri sınırı 46.000 (KDV hariç); amortisman sınırı
  1.380.000 (ÖTV+KDV hariç) / 2.600.000 (vergiler maliyete eklenmiş ya da ikinci el); ÖTV+KDV doğrudan gider 1.200.000;
  giderlerin %70'i indirilebilir, %30 KKEG; binek alış KDV'si indirilemez (KDV 30/b); binek MTV'si gider yazılamaz (MTV K. 14).
- İndirimli oran KDV iadesi alt sınırı 2026: 164.000 TL (KDV GUT Seri 56, RG 31.12.2025; 2025: 130.700).
- Gecikme zammı/faizi aylık %3,7 (CB Kararı 10556, 13.11.2025); tecil faizi yıllık %39. 2026'da değişiklik bulunamadı.

### KKEG / indirimler (KVK 9, 10, 11)
- Zarar: 5 yıl, mali zarar, en eskiden (KVK 9). Bağış: kazancın %5'i (KVK 10/1-c), zarar yılında yok, devretmez.
- KVK 11/1-d: hesaplanan KV, her türlü para ve vergi cezaları, 6183 gecikme zammı, VUK gecikme faizi (SGK cezaları ve gecikme zamları dahil).
- Finansman gider kısıtlaması (KVK 11/1-i): yabancı kaynak öz kaynağı aşarsa aşan kısma isabet eden finansman giderinin %10'u KKEG.
- Örtülü sermaye (KVK 12), örtülü kazanç/transfer fiyatlandırması (KVK 13; ortaklar cari hesabı adat).
- Zayi mal KDV'si (KDV K. 30/c): afet dışı zayi olan malın KDV'si indirilemez (düzeltme); olağan fire maliyettir.

### Asgari KV ayrıntı
- Matrah: ticari kâr + KKEG; düşülebilenler yalnız KVK 32/C'de sayılanlar. 23 Seri No KVGT "geçmiş yıl zararı düşülmez" hükmü
  Danıştay 3. D. 25.11.2025 E.2024/5700 K.2025/4831 ile iptal edildi (ikincil kaynak) -> belirsiz/kesinleşme takip.
- 7582 s. Kanun (RG 04.06.2026 33270): transit ticaret / nitelikli hizmet indirimleri asgari matrahtan düşülebilir;
  üretim kazancı %12,5 (2027+, sanayi sicilli), kafe için etkisiz. Vergi tecil 72 ay / teminatsız 1.000.000.
- KV oranı 2026 genel %25 (KVK 32/1, 7456 s. Kanun m.21, RG 15.07.2023).

### SGK ek
- Asgari ücret desteği 2026: 7573 s. Kanun m.8 -> 5510 geçici 112 (RG 29.01.2026 33152); günlük 42,33, 30 gün 1.269,90;
  SGK Genelgesi 2026/8 (05.03.2026). 2026'da tescilli işyerinde tüm uzun vadeli sigortalı günleri x 42,33; 3.303 TL'ye kadar
  eksik kazanç bildirimi varsa verilmez; vadesi geçmiş borç varsa verilmez; prim borcundan mahsup.
- 2025: imalat dışı 2025/Şubat'tan itibaren 4 puan (SGK 2025/6), Ocak 2025 5 puan; 2025 brüt asgari 26.005,50.
- PEK üst sınırı 2026'da 9 kat (7566 ile 7,5 kattan) -> 297.270.

### Yerel vergiler
- ÇTV işyeri 2026: Belediye Gelirleri K. GT Seri 59 (RG 31.12.2025 33124 5.mük.); tarife 7 grup x 5 derece, büyükşehir +%25;
  en yüksek (1.grup 1.derece) büyükşehir 43.750, en düşük ~375. Kafenin grubu/derecesi Tuzla Belediyesi'nin
  kararına bağlı -> tutar belirsiz. Yıllık Ocak'ta tahakkuk, emlak vergisi taksitlerinde (Mayıs/Kasım) ödenir (2011 TÜRMOB, muhtemel).
- İlan reklam: 2464 m.12-17; işyeri tabelasının 1/2 m²'ye kadar ışıksız kısmı muaf (m.14/5), aşan m² vergiye tabi,
  tarife belediye meclisince (İBB) belirlenir -> tutar belirsiz; yıllık ilanlar iki taksit (Ocak/Temmuz sonu, muhtemel).
- Emlak vergisi (yalnız mülk şirketinse): işyeri binde 2, büyükşehirde binde 4; 2026 vergi değeri 2025'in 2 katını
  aşamaz (7566, EVK geçici 23). Taksitler Mart-Mayıs ve Kasım.
- Turizm payı (7183): yalnız Bakanlık belgeli yeme-içme tesislerinde binde 7,5 -> belgesiz kafe için uygulanmaz (muhtemel).

### Geçmiş/kalkan uygulamalar
- Ba-Bs: 565 Sıra No VUK GT (RG 25.09.2024 32673) ile Eylül 2024 döneminden itibaren kaldırıldı.
- Enflasyon düzeltmesi 2025-2027 yok (7571 s. Kanun m.34, VUK geçici 37, RG 25.12.2025 33118).
- e-Fatura zorunluluğu genel eşik 3 milyon TL brüt satış (VUK 509); zorunlu geçenler izleyen yıl e-Defter.
  Yeni kurulan kurum için ayrı kural netleşmedi -> belirsiz (şirket zaten e-Fatura kullanıyor: Paraşüt).

### Henüz bilinmeyenler (24.10.2026)
- 2027 yeniden değerleme oranı (Kasım 2026'da), 2027 GV tarifesi ve damga maktu (Aralık 2026 sonu),
  2027 asgari ücret (Aralık 2026), 2027 PEK sınırları. Panel kuralları yıl bazlı sürümlemeli.

---

## Fact-check #2 notes (24.10.2026)
- WebFetch: DNS fail for all hosts; curl: proxy 403 for gib/resmigazete/mevzuat/sgk/csgb/pwc/kpmg. Only WebSearch summaries (allowed_domains gib/resmigazete/mevzuat/sgk/csgb where possible). Search quota (200/turn) exhausted at the end.
- MERSIS 0734069467300012 in laffogato entity.ts -> VKN 7340694673 (both 7340694673 and 6312110904 pass VKN check digit). Mismatch with levha VKN 6312110904.
- gv-tarife-2026: ucret disi cumulative = 232.500 @1.000.000 and 1.737.500 @5.300.000 (item had 232.000 / 1.737.000). GIB tariff PDF summary: 232.500.
- kv-bagis: KVK 10/1-c has only %5; KOY %10 is GVK 89/4.
- yemek SGK: 7577 s. Kanun, 17.04.2026, 300 TL/gun; SSIY degisikligi RG 18.04.2026 (33228); SGK Genelgesi 2026/12.
- tecil: CBK 11414 (13.06.2026) teminatsiz tecil 10M TL; Tahsilat GT Seri B Sira 20 (RG 16.06.2026, 33282) tecil faizi %29 (basvuru 31.08.2026), genel %39.
- 2026/1 gecici vergi: 17.05.2026 Pazar -> 18.05.2026.
- KDV iade alt siniri: KDV GUT III/B-3 (not B-2).
- Panel KALAN-ISLER: kafe Temmuz 2026 ortasinda acildi; devreden KDV ~98.100 TL (< 164.000).

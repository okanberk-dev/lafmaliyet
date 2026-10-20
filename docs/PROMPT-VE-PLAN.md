# L'Affogato Yönetim Paneli — Geliştirilmiş Prompt, Görev Planı ve Excel Analizi

## 1. Orijinal istek

> klasörün içindeki exceli detaylıca analiz et ve bunun için nextjs frontend ve vercel'de çalışacak backend oluşturarak bana bir gelişmiş ama basit bir websitesi hazırla (laffogato.net için yapıyoruz cafe için yani), buna göre gelişmiş bir sistem yap ama exceldekiler olsun mutlaka basitleştirebilirsin ama özellikler olsun veya geliştirebilirsin önerilerinde

## 2. Geliştirilmiş prompt

> **Rol:** Kafe işletmeciliğini ve maliyet muhasebesini bilen kıdemli bir full-stack geliştirici gibi davran.
>
> **Bağlam:** L'Affogato, Tuzla'da (Opera AVM) bir kafe; web adresi laffogato.net. Klasördeki
> `L'Affogato – Maliyet & Kârlılık.xlsx` dosyası işletmenin bütün maliyet ve kârlılık sistemi. 13 sayfadan oluşuyor:
> Panel, Genel Maliyet, Sayım, Tutarlılık Kontrolü, Ürün Kârlılık, Reçete Kartları, Satış Raporu, Hammaddeler,
> Faturalar, Personel, Sabit Giderler, Ayarlar ve Nasıl Kullanılır.
>
> **Görev:**
> 1. Excel'i formül düzeyinde analiz et. Veri modelini, formül zincirini (Hammadde → Reçete → Ürün → Satış →
>    Panel / Genel Maliyet), adlandırılmış hücreleri, açıklama notlarını, varsayımları ve tutarsızlıkları çıkar.
> 2. Bu sistemi Excel'e ihtiyaç duymadan çalışan bir web uygulamasına dönüştür:
>    - **Frontend:** Next.js (App Router, TypeScript, Tailwind CSS). Türkçe arayüz, mobil uyumlu, basit kullanım.
>    - **Backend:** Vercel'de çalışan Next.js sunucu katmanı (Server Actions + Route Handlers). Veritabanı Postgres
>      (Vercel Marketplace üzerinden Neon), ORM olarak Drizzle.
>    - **Güvenlik:** Giriş/oturum ve rol bazlı yetki (yönetici / personel). Maaş, kira ve kâr gibi hassas veriler
>      sadece yöneticiye görünür.
> 3. Excel'deki her özelliğin bir karşılığı olsun. Basitleştirilebilir ama hiçbir özellik eksilmez: ayarlar,
>    hammaddeler, reçete kartları, ürün kârlılığı, satış raporu ve POS eşleştirmesi, faturalar, personel, sabit
>    giderler, aylık gelir-gider (Genel Maliyet), stok sayımı, tutarlılık kontrolü, panel ve kullanım kılavuzu.
> 4. Hesaplama motoru Excel formülleriyle birebir aynı sonucu versin. Bunu, Excel'in hesapladığı değerlere karşı
>    çalışan otomatik testlerle kanıtla.
> 5. Excel'deki mevcut verinin tamamını (74 hammadde, 129 ürün kartı, 81 fatura, Eylül satışları vb.) başlangıç
>    verisi olarak aktar.
> 6. Excel'in zayıf noktalarını iyileştir:
>    - Ay bazlı çalışma (Excel Eylül'e sabitlenmiş)
>    - POS ürün adı eşleştirmelerini hatırlama
>    - Hammadde fiyat geçmişi
>    - Otomatik uyarılar
>    - Menü mühendisliği analizi
>    - Senaryo (ne olur?) simülatörü
>    - Excel'e dışa aktarım
>    - İsteğe bağlı, herkese açık QR menü
> 7. Vercel'e kurulum adımlarını belgele: veritabanı, ortam değişkenleri ve bölge seçimi.
>
> **Kısıtlar:** Kafe sahibi teknik biri değil, o yüzden kullanım basit olmalı. Para ve sayılar Türkçe biçimde
> gösterilir (1.234,56 ₺). KDV mantığı Excel'deki gibi kalır: menü fiyatları %10 KDV dahil, maliyetler KDV hariç.
>
> **Çıktı:** Çalışan proje, kurulum ve deploy rehberi, Excel ↔ web karşılık tablosu, bulunan sorunlar ve
> geliştirme önerileri.

## 3. Görev planı

| # | Görev | Çıktı |
|---|-------|-------|
| 1 | Excel'i sayfa sayfa, formül formül analiz et | Bu belgedeki 4. ve 5. bölümler |
| 2 | Veri aktarım betiği yaz (Excel → JSON) | `scripts/excel-import/extract.py`, `src/server/db/seed/excel-data.json` |
| 3 | Excel'in hesapladığı değerleri test verisi olarak çıkar | `tests/golden.json` |
| 4 | Next.js 16 projesini kur (TypeScript, Tailwind) | `laffogato/` |
| 5 | Veritabanı şemasını kur (Drizzle + Postgres) | `src/server/db/schema.ts`, `drizzle/` |
| 6 | Hesaplama motorunu yaz (Excel formüllerinin birebir karşılığı) | `src/lib/calc/*` |
| 7 | Motoru Excel değerlerine karşı test et | `tests/calc.test.ts` |
| 8 | Kimlik doğrulama ve rolleri ekle | `src/server/auth/*`, `src/proxy.ts` |
| 9 | Panel ekranlarını yaz (13 modül) | `src/app/panel/*` |
| 10 | İyileştirmeleri ekle (analiz, simülatör, uyarılar, dışa aktarım, QR menü) | ilgili sayfalar |
| 11 | Tarayıcıda uçtan uca test et | — |
| 12 | Vercel kurulum rehberini yaz | `docs/DEPLOY.md` |

## 4. Excel analizi

### 4.1 Sayfalar ve görevleri

| Sayfa | İçerik | Ana formüller |
|-------|--------|---------------|
| **Ayarlar** | KDV %10, POS komisyonu %2,5, kartlı satış oranı %85,6, hedef maliyet %30, fire %5, tek/çift shot 11/18 gr, 1 pompa 10 ml, filtre pot 105 gr / 1.800 ml, 1 top dondurma 70 ml, Türk kahvesi 7 gr, ayda 30 açık gün | Adlandırılmış hücreler (`KDV`, `Komisyon`, `KartOrani` …). Su + buz birim maliyeti = Eylül su faturası ÷ reçetelere göre harcanan su + buz (litre) |
| **Hammaddeler** | 74 malzeme: kategori, tedarikçi, paket, paket fiyatı (KDV hariç, iskontolu), paket içeriği, birim, alış KDV'si. 21'i tahmini (sarı) | `Birim maliyet = Paket fiyatı ÷ Paket içeriği` |
| **Reçete Kartları** | 129 kart (ürün × boy). Her kart: malzemeler, miktarlar (bir kısmı Ayarlar'a bağlı: `=ShotTek`, `=2*ShotCift`, `=200*PotGr/PotMl`), ürüne özel fire oranı, satış fiyatı | `Toplam = Σ miktar × birim maliyet`; `Fire = Toplam × (ürün fire oranı ya da genel oran)`; `Maliyet = Toplam + Fire`; `Net = Fiyat ÷ 1,10`; `Komisyon = Fiyat × %2,5 × %85,6`; `Birim kâr = Net − Maliyet − Komisyon` |
| **Ürün Kârlılık** | 13 kategoride 129 satır | `Marj = Birim kâr ÷ Net`; `Maliyet oranı = Maliyet ÷ Net`; `Önerilen fiyat = TAVAN(Maliyet ÷ %30 × 1,10; 5)`; `Durum`: İyi (≤ %30) / Dikkat (≤ %40) / Düşük kâr |
| **Satış Raporu** | Patron (ModPOS) Eylül 2026: 125 POS ürünü, 2.543 adet, 441.955 ₺. Her satır bir ürün anahtarıyla eşleşiyor (`Ürün\|Boy`), HİZMET (karaoke) ya da eşleşmemiş | Eşleşen satırda `maliyet = adet × birim maliyet`. Eşleşmeyende `net ciro × eşleşenlerin ortalama maliyet oranı` (%25,5). HİZMET satırında 0. Komisyon ve brüt kâr |
| **Faturalar** | Paraşüt'ten 81 fatura, 9 kategori. Kategori × ay özeti | `Net = Tutar − İskonto`; `KDV = Ödenecek − Net`; mal maliyeti = ilk 3 kategori |
| **Personel** | 2 personel, net 30.000 ₺. SGK oranları | `Brüt = Net ÷ (1 − %14 − %1)`; `İşveren maliyeti = Brüt + %15,75 SGK + %2 işsizlik + ekler` (kişi başı 41.559 ₺) |
| **Sabit Giderler** | Kira 160.000 ₺, personel, yemek (330 ₺ × gün), part-time, reklam, elektrik, muhasebe … Toplam 377.813 ₺/ay. Tek seferlik yatırımlar (~1,04 M ₺) ayrıca listelenmiş | `Toplam = Σ` |
| **Genel Maliyet** | Ocak–Aralık gelir-gider tablosu: mal alışları (faturalardan tedarikçi bazında), stok devri, personel, faturalar, kira, genel giderler, komisyonlar, kâr/zarar, oranlar | Sabit giderler `açık gün ÷ ayın gün sayısı` oranıyla bölünüyor. `SMM = devir + alınan − devreden (sayım)` |
| **Sayım** | 10 grupta stok sayım listesi (KG/LT/ADET/DİLİM), Temmuz–Aralık | `Tutar = miktar × birim fiyat` (KG/LT için × 1000). Ay toplamı Genel Maliyet'teki devreden mala bağlı |
| **Tutarlılık Kontrolü** | Patron satışları ↔ Paraşüt faturaları ↔ reçeteler | `Reçeteye göre kullanım = Σ (ürün adedi × reçete miktarı)`; alınan ÷ kullanılan oranı (yeşil < 1,15 < sarı < 1,5 < kırmızı); fark tutarı |
| **Panel** | Eylül gerçek kâr/zarar, başabaş cirosu, Ekim tahmini, en kârlı ürün, kategori ortalamaları, grafik | `Net kâr = Brüt kâr − indirim ÷ 1,10 − sabit giderler`; `Başabaş günlük ciro = Sabit giderler ÷ (Brüt kâr ÷ Ciro) ÷ Açık gün` |

### 4.2 Formül zinciri

```
Ayarlar ──► Reçete miktarları (shot, pompa, top …)
Hammaddeler (paket fiyatı ÷ içerik) ──► Reçete Kartları ──► Ürün Kârlılık ──► Panel (kategori tablosu)
                                                │
Satış Raporu (POS adet + ciro + eşleştirme) ────┴──► Brüt kâr ──► Panel (Eylül kâr/zarar, başabaş)
Faturalar ──► Genel Maliyet (mal alışları, komisyonlar) ◄── Sabit Giderler ◄── Personel
Sayım ──► Genel Maliyet (devreden mal)
Reçete × Satış ──► Tutarlılık Kontrolü ◄── Eylül alımları
```

### 4.3 Excel'in temel rakamları (Eylül 2026)

| Gösterge | Değer |
|----------|-------|
| Net satış (KDV hariç) | 401.777 ₺ |
| Reçeteye göre malzeme + ambalaj | 101.907 ₺ (%25,4) |
| Faturaya göre mal alımı | 173.983 ₺ (%43,3) |
| Brüt kâr (kira ve personel öncesi) | 290.412 ₺ |
| Aylık sabit gider | 377.813 ₺ |
| **Eylül net kâr / zarar (reçeteye göre)** | **−98.307 ₺** |
| **Eylül kâr / zarar (faturaya göre, Genel Maliyet)** | **−171.607 ₺** |
| Zarar etmemek için günlük ciro (KDV dahil) | 19.165 ₺ |
| Eylül günlük ortalama ciro | 14.732 ₺ |
| Ekim (1-16) günlük ortalama | 18.310 ₺ |
| Fiyatı gözden geçirilmesi gereken ürün | 24 |

## 5. Excel'de bulunan sorunlar ve tutarsızlıklar

1. **Fire payı ambalaja da uygulanıyor.** Ayarlar'daki not "ambalaja eklenmez" diyor. Reçete kartındaki formül ise
   fireyi bardak, kapak ve peçete dahil toplamın üzerinden alıyor. Uygulama Excel'deki sonuçları korumak için
   varsayılanda formülü uyguluyor. Ayarlar'daki bir anahtarla "ambalajı fireden hariç tut" seçilebilir.
2. **Panel ile Genel Maliyet farklı zarar gösteriyor** (−98 bin ve −172 bin ₺). Panel reçeteye göre teorik
   maliyeti, Genel Maliyet ise o ay faturayla alınan malın tamamını kullanıyor. Stok sayımı girilmediği için
   Temmuz'daki 102 bin ₺'lik ambalaj alımı gibi stoklar o ayın maliyeti sayılıyor. Uygulama iki görünümü yan yana
   ve açıklamalı gösteriyor.
3. **Ekim cirosu iki yerde farklı:** Satış Raporu'nda 292.957 ₺, Genel Maliyet'te 293.909 ₺.
4. **L'Affogato (L) reçetesinde iki malzemenin miktarı boş** (çikolata sos, Antep fıstığı tozu), yani 0 kabul
   ediliyor.
5. **Espresso Frappe L** M ile aynı tek shot kullanıyor. Kasıtlı olup olmadığı kontrol edilmeli.
6. **Su faturası girilmemiş,** bu yüzden su ve buzun maliyeti 0 ₺.
7. **Stok sayımı hiç girilmemiş.** Devir hesapları hep 0 çıkıyor.
8. **Ağustos cirosu 500.000 ₺ yuvarlak bir sayı.** Tahmin gibi duruyor, Patron'dan gerçek değer girilmeli.
9. **Kira 160.000 ₺ girilmiş,** ama Opera AVM'nin Ekim faturası 35.000 ₺ + KDV. Excel'in kendi notu da bunu
   belirtiyor.
10. **13 POS ürününün reçetesi yok:** Çıtır Latte, Çıtırtı Latte, Crunchy Granola Bar, Caramel Biscoff Latte,
    Dubai Magnolya, L'Affogato Pistachio, Medine Tatlısı, L'Af Banana, LA Pistacchio, Surprise, Iced Chai Tea
    Latte, Çikolatalı Süt, Simit. Bunlara ortalama maliyet oranı uygulanıyor.
11. **Callei waffle sos** ayda 4.158 ₺ alınıyor ama hiçbir reçetede yok.
12. **Token aboneliği** 4.999 ÷ 12 = 416,58 ₺ olmalı, 417 ₺ yazılmış. Fark önemsiz.
13. **Personel yemeği** kişi başı 330 ₺ ise gider iki katına çıkar. Excel'in notu da bunu belirtiyor.
14. **Panel'in kategori marjı ağırlıksız ortalama** (AVERAGEIF). Az satan ürünler de çok satanlar kadar
    ağırlık taşıyor. Uygulama buna ek olarak satış ağırlıklı marjı da gösteriyor.

### 5.1 Panelin bilerek Excel'den ayrıldığı yerler (genel bakış, satışlar, tutarlılık, sayım, faturalar)

Excel'in Eylül sonuçları değişmez (11 parite testi geçiyor). Aşağıdakiler yalnızca Excel'in kapsamadığı ya da
yanlış sonuç verdiği durumlarda devreye girer. Hesaplar `src/lib/calc/insights.ts`, `expr.ts` ve `pos-paste.ts`'te.

1. **Net kâr / zarar (reçeteye göre) o ayın sabit giderleriyle hesaplanır.** Excel Panel!B13 her ay standart
   `SabitGiderToplam`'ı düşer. Panel Gelir-gider tablosundaki o ayın tutarlarını kullanır: açık gün oranı (ör.
   Temmuz 23/31 gün), o ay elle düzeltilen hücreler ve yalnızca o aya girilen satırlar (doğalgaz, ciro kirası,
   harici…). Böylece eksik açık aylar ve gerçek faturalar doğru yansır, "faturaya göre" kârla aynı temel kullanılır.
   Eylül'de (30/30 gün, düzeltme yok) iki yol aynı sonucu verir (−98.307 ₺). Fark ekranda ayrı satırlar olarak
   verilir: standart sabit gider, açık gün etkisi, bu aya özel giderler (düzeltmeler + elle satırlar). Excel
   temelindeki değer de ayrıca hesaplanır (`netProfitStandard`). Açık gün sayısı girilmemiş ayda standart tutar
   kullanılır. Başabaş günlük ciro ve ay sonu tahmini Excel'deki gibi standart tutarla kalır (o ayda geçerli
   kalemler ve tutarlarla).
2. **SU GİDERİ iki kez sayılmaz.** Excel su faturasını reçetelerdeki su + buz litre maliyetine dağıtır; Sabit
   Giderler'de su satırı yoktur. Panelde su faturası Gelir-gider'in Faturalar bölümündedir. Reçetelerde su maliyeti
   varken (su faturasından ya da Ayarlar'daki elle birim maliyetten) reçeteye göre net kârda sabit gider olarak
   tekrar düşülmez. Faturaya göre kârda (Gelir-gider) bir kez, gider olarak sayılır.
3. **"Para nereye gitti?" Excel Panel'in satırlarıyla:** Kira, Personel (maaş + SGK, part-time, yemek), Reklam
   (Instagram, influencer), Diğer sabit giderler (Panel B9–B12). Grup, gider adından ve Gelir-gider bölümünden
   bulunur: muhasebeci ve Opera ortak gideri Diğer'dedir. Gelir-gider tablosu kendi dört bölümünü korur. O aya özel
   elle satırlar ayrı bir "Bu aya özel giderler" satırında görünür.
4. **Ay sonu tahmini yalnızca devam eden ay için** (Türkiye saatine göre bu ay). Excel'de yalnızca Ekim için B19
   vardı; panel ise açık gün sayısı ayın gün sayısından az olan her ayı (ör. 23 gün açık Temmuz) süren ay sayıyordu.
   Bitmiş ayda tahmin yerine faturaya göre kâr/zarar gösterilir. Devam eden ayda açık gün sayısı "geçen gün"
   olarak da kullanılır (Excel: ÷ 16 × 31).
5. **Günlük ortalama rozeti aynı temelde karşılaştırır.** Gösterilen günlük ortalama Excel B17 gibidir (satış
   listesi varsa liste toplamı ÷ açık gün). Önceki aya göre % rozeti iki ayda da POS cirosu ÷ açık gün ile
   hesaplanır; temeller karışırsa rozet gösterilmez. Kategori tablosunun satış adetleri başka bir aydan geliyorsa
   o ay belirtilir.
6. **Yüzde alanlarında yazılan sayı yüzde puanıdır:** "10", "%10" ve "10%" hepsi %10'dur. "0,1" %0,1 demektir.
   Excel'in otomatik yüzde girişi (0,1 → %10) uygulanmaz, çünkü %0,5 fire ya da %0,79 komisyon gibi gerçek küçük
   oranlar var ve alanlar değeri puan olarak gösteriyor (`parsePercentInput`).
7. **Satış listesi yapıştırılırken ya da yüklenirken TOPLAM, GENEL TOPLAM, ARA TOPLAM ve başlık satırları ürün
   sayılmaz;** kaç satırın neden atlandığı söylenir. Cirosu diğer satırların toplamına eşit olan, adı farklı bir
   satır silinmez, şüpheli diye işaretlenir. Daha önce yüklenmiş bir TOPLAM satırı varsa genel bakışta kırmızı
   uyarı çıkar.
8. **Hatırlanan POS eşleştirmesi büyük/küçük harf ve I / İ / ı / i farkını yok sayar** ("Caramel Latte Medium" =
   "CARAMEL LATTE MEDİUM"). Diğer Türkçe harfler korunur. Anahtar iki tarafa da uygulandığı için eski kayıtlar
   taşınmadan eşleşir (`posMatchKey`).
9. **Tutarlılık Kontrolü'nde stok sapması yalnızca alım miktarı girilmiş satırlarda hesaplanır.** Girilmemiş alım
   0 sayılınca sapma yanlış, hatta eksi çıkıyordu. Bu satırlar "alım girilmeli" diye işaretlenir (bu ay alınmadıysa
   0 girilir). İki ayı da sayılmış ama hiçbir reçetede olmayan hammaddeler (ör. Callei waffle sos) "reçetesiz
   tüketim" olarak listelenir. Toplam sapma tablonun varsayılan görünümüyle aynı satırları toplar. Excel'de stok
   karşılaştırması yoktur.
10. **Sayımın KDV dahil toplamı her malzemenin kendi Alış KDV'siyle hesaplanır.** Excel Sayım grup başına tek oran
    kullanır (ambalaj %20, diğerleri %1). Tek fark Yenilebilir bardak: Hammaddeler'de %10, Excel'in ambalaj
    grubunda %20; faturasından kontrol edilmeli. Grup bazında KDV dahil tutar ve Excel oranından ayrılan malzemeler
    ayrıca verilir (`stockVatSummary`). Kâr/zarar KDV hariç tutarla hesaplandığı için etkilenmez.
11. **Ödenmemiş fatura toplamı kalan borçtur:** Paraşüt'ten kısmen ödenmiş gelen faturada kalan tutar, yoksa
    Ödenecek'in tamamı (Hatırlatıcılar ile aynı kural, `openBalance`). Kalan tutar çekirdek veride
    `Invoice.outstanding` olarak gelir; Genel bakış, Faturalar, Hatırlatıcılar ve Excel'e aktar aynı rakamı gösterir.
12. **Su + buz birim maliyeti:** Excel sabit Eylül faturasını kullanır; panel SU GİDERİ girilmiş ve ürün satış
    listesi olan en son ayı kullanır (litre satışlardan bulunur). Elle fiyatlanan buz litreye katılmaz. Fatura
    girilmiş ama o ayın satış listesi yoksa "SU GİDERİ girilmedi" denmez; ekranlar ve genel bakış uyarısı litrenin
    neden hesaplanamadığını söyler (`water.reason`, `waterSource`).
13. **Kâr marjı renk ölçeği:** Excel J10:J134 tüm satırları kapsar (HİZMET/karaoke en yeşil); panel ölçeği yalnızca
    reçeteli ürüne bağlı ve net cirosu > 0 satırlardan kurar, HİZMET ve tahmini maliyetli (eşleşmeyen) satırlar
    renksiz. Renk ve "en düşük / en yüksek" etiketi ekrandaki duyarlıkla (%78,5) karşılaştırılır: aynı görünen iki
    marj zıt renk almaz; ayın bütün satırları aynı oranı gösteriyorsa ölçek kurulmaz.
14. **Tutar değişikliği "şu aydan itibaren" geçerlidir** (Sabit giderler, Personel). Excel'de her ay sütunu kendi
    tutarını taşır; panelde kayıt sürümlüdür: "Hangi aydan itibaren?" (varsayılan bu ay) önceki ayları değiştirmez,
    Gelişmiş › Tüm aylar yanlış girilmiş tutarı düzeltir. "Pasif" yerine Durdur ile son ay verilir. Kapanmış bir
    ayın hesabına girmiş kalem silinmez. SGK oranları Excel'deki gibi sürümsüzdür: oran değişince geçmiş ayların
    SGK'sı da yeniden hesaplanır (ekranda yazar).
15. **Ekim tahmini Excel B19'dan biraz farklıdır** (−3.624 ₺ ve −4.836 ₺): formül aynı (POS ÷ 16 × 31 × Eylül brüt
    kâr oranı − SabitGiderToplam), fark veriden gelir. Excel B18 Satış Raporu C6 = 292.957 ₺ kullanır; panel Ekim
    POS cirosunu Genel Maliyet M68 = 293.909 ₺ ile tohumlar (bkz. §5 madde 3).
16. **Varsayılan ay:** adreste ?ay= yoksa ekranlar bu aya kadarki son satış ayını açar; ileri tarihli tek bir kayıt
    (deneme, yanlış yazılmış ay) varsayılanı geleceğe taşımaz (`defaultMonthOf`). Kâr oranı için yakın satış ayı
    aranırken de önce önceki, sonra sonraki aylara bakılır.
17. **Satış dosyasında sütun düzeni başlıktan okunur:** "Ürün | Kategori | Adet | Birim fiyat | Tutar" gibi bir
    başlık varsa ciro Tutar sütunundan alınır (birim fiyat ciro sanılmaz). Başlık yoksa ya da satır başlığa
    uymuyorsa eski kural: ad sonrası ilk iki sayı adet ve ciro. "Toplam Kahve Paketi" gibi "Toplam" ile başlayan
    gerçek ürün adı özet satırı sayılmaz.
18. **Sayım:** personel listede olmayan kalemleri yazabilir, fiyatını yönetici girer. "Geçen aydan doldur" ek
    kalemleri de taşır. 0 alım miktarı "bu ay alınmadı" demektir ve sayım sapmasını açar. Ayın ilk 10 gününde
    Sayım ekranı, sayımı girilmemişse geçen ayı açar. Yalnızca sayım silen bir kayıt boş ay satırı bırakmaz;
    işlem geçmişi silinen sayımları da yazar.
19. **Ayarlar ve Hammaddeler:** ayar değişikliği kaydetmeden önce etkisiyle (ürün maliyet oranları, başabaş)
    önizlenir, kayıttan sonra 15 saniye "Geri al" sunulur; işlem geçmişi yalnızca değişen anahtarları yazar
    ("Etiket: eski → yeni"). Satır içinde fiyatı değişen hammaddenin "Tahmini" işareti kendiliğinden kalkmaz;
    bildirimdeki düğmeyle ya da düzenleme penceresinden kaldırılır.
20. **Excel'e aktar** Excel çalışma kitabının sekme sırasını izler ve her ayın ham kayıtlarını gri yedek
    sekmelerinde taşır. Gelir-Gider sekmesindeki "<yıl> YILI" sütunu ekrandakiyle aynı kuralla hesaplanır (stok
    devirleri toplanmaz; oranlar = yıllık toplam ÷ yıllık KDV hariç ciro). Satış listesi olmayan ayda Satış
    sekmesinin TOPLAM satırı ve hiç verisi olmayan ayda "faturaya göre kâr" boş kalır (0 yazılmaz).

## 6. Excel → Web karşılık tablosu

| Excel sayfası | Web karşılığı | İyileştirme |
|---------------|---------------|-------------|
| Panel | `/panel` | Her ay için çalışır. Reçeteye göre (teorik) ve faturaya göre (gerçekleşen) kâr yan yana. Excel'deki Kira / Personel / Reklam / Diğer satırları; ay sonu tahmini yalnızca süren ay için. "Bu ayın işleri" kartı (satış raporu, ay bilgileri, faturalar, su faturası, sayım, ödemeler) eksik veriyi ve sıradaki işi gösterir (`src/app/panel/dashboard-tasks.tsx`). Otomatik uyarılar |
| Ürün Kârlılık | `/panel/urunler` | Arama, filtre, sıralama, satır içinde fiyat düzenleme |
| Reçete Kartları | `/panel/urunler/[id]` | Canlı maliyet hesabı, fiyat simülatörü, ayara bağlı miktar formülleri |
| Satış Raporu | `/panel/satislar` | Patron'dan yapıştır/yükle; toplam ve başlık satırları atlanır. POS adı eşleştirmeleri hatırlanır (büyük/küçük harf ve I/İ farkı yok sayılır) |
| Hammaddeler | `/panel/hammaddeler` | Fiyat geçmişi, hangi reçetelerde kullanıldığı, tahmini fiyat işareti |
| Faturalar | `/panel/faturalar` | Filtre, ödenmedi takibi, kategori × ay özeti |
| Genel Maliyet | `/panel/gelir-gider` | Ayların tamamı otomatik hesaplanır. Her hücre elle düzeltilebilir (mavi) |
| Sayım | `/panel/sayim` | Telefondan sayım. Personel rolü sadece burayı ve reçeteleri görür |
| Tutarlılık Kontrolü | `/panel/tutarlilik` | Stok sayımı ve alım miktarı varsa gerçek tüketim hesaplanır; reçetesiz tüketim listelenir. Bulgular listesi kapatılabilir |
| Personel | `/panel/personel` | Maaş değişikliği "hangi aydan itibaren" (önceki aylar korunur), Durdur ile ayrılış ayı, maaş geçmişi |
| Sabit Giderler | `/panel/giderler` | Aylık, günlük, haftalık ve yıllık tutarlar otomatik aylığa çevrilir. Tutar geçmişi, "hangi aydan itibaren", Durdur ile bitiş ayı |
| Ayarlar | `/panel/ayarlar` | Kullanıcı yönetimi, QR menü yayını, Excel'e aktarım |
| Nasıl Kullanılır | `/panel/yardim` | — |
| — (yeni) | `/panel/receteler` | Baristalar için maliyetsiz reçete defteri (personel rolü görebilir, yazdırılabilir) |
| — (yeni) | `/panel/analiz` | Menü mühendisliği matrisi ve senaryo simülatörü |
| — (yeni) | `/menu` | Herkese açık QR menü (Ayarlar'dan açılır) |

## 7. Doğrulama

- `npm test` (`tests/*.test.ts`): `tests/calc.test.ts`'teki 11 Excel parite testi geçiyor: 129 ürün kartı, 125 satış
  satırı, Panel, Temmuz–Ekim gelir-gider, personel, sabit giderler, tutarlılık ve fatura özetleri Excel ile birebir
  aynı. Ekran kuralları da aynı klasörde sınanır: geçmiş aylar (`history`, `giderler-history`), SGK oranları
  (`personel-rates`), Gelir-gider girişleri (`gelir-gider-cells`), satışlar, sayım-tutarlılık, faturalar, ürünler,
  ayarların etkisi, genel bakış işleri ve Excel'e aktar.
- `tests/insights.test.ts` ve `tests/parse.test.ts` (§5.1'deki sapmalar): Excel Panel'in Kira / Personel / Reklam /
  Diğer satırları (golden.panel), açık gün ≠ ayın günü, Gelir-gider düzeltmesi ve o aya özel satır, SU GİDERİ'nin
  bir kez sayılması, ay sonu tahmininin yalnızca süren ayda yapılması, günlük ortalama rozetinin temeli, tutarlılık
  sapması ve reçetesiz tüketim, sayım KDV'si, fatura kalan borcu, yüzde alanı, satış listesi yapıştırma / dosya
  okuma ve POS eşleştirme anahtarı.
- Tarayıcıda uçtan uca denendi: giriş ve çıkış, reçete düzenleme ve kaydetme, satır içinde fiyat değiştirme, satış
  eşleştirme, stok sayımının gelir-gider tablosuna yansıması, personel rolünün kısıtlanması, Excel'e aktarım, QR menü.
  Masaüstü, tablet ve telefon (375 px) genişliklerinde hiçbir sayfa yatay taşmıyor.
- `npm run build`: production derlemesi temiz. Panel sayfaları statik iskelet + akışlı içerik (Partial Prerender).

## 8. Geliştirme önerileri (ileride)

- Patron (ModPOS) API'si varsa satışların günlük otomatik çekilmesi.
- Paraşüt API'si ile faturaların otomatik gelmesi (şu an elle giriliyor).
- Stok seviyesi düşünce sipariş hatırlatması (sayım + reçete tüketimi ile tahmin).
- Gün sonu kasa raporu (nakit / kart / yemek kartı) ve kart oranının her ay gerçek değerle güncellenmesi.
- Birden fazla şube (Tuzla dışında) için şube alanı.

---

## Ek istek: arayüzü yenileme ve ladmin.laffogato.net (19 Eki 2026)

**İstek:** laffogato deposundan logo ve gerekenleri al; paneli sadeleştirip geliştir, daha güzel görünsün;
akmanos.com'daki UI bileşenlerinden en iyilerini kullan; panel `ladmin.laffogato.net`'te olsun. Sonradan eklenen:
"daha farklı, basit, açık tonlarda; sitedeki library bileşenlerini gelişmiş görünecek şekilde kullan".

**Görevler ve sonuç**

1. Marka varlıkları: `RiosenBeq/laffogato` deposundan L'Af vektörleri (`laf-letters.svg`, `laf-bean.svg` →
   `src/components/laf-paths.ts`), uygulama ikonu (`src/app/icon.png`, `apple-icon.png`, `favicon.ico`), kelime logosu.
2. AkmanOS taraması: sitenin 65 bileşen/bloğu `https://akmanos.com/api/markdown/<id>` dışa aktarımından incelendi;
   panelde işe yarayanlar `src/components/akmanos/` altına olduğu gibi alındı (App Shell, Sidebar, Command Palette,
   Notification/Profile Dropdown, Liquid Metal Avatar, Statistic Cards, Gauge, Recent Activity, Empty State, List
   Table, System Status, Range Slider, Bouncy Accordion, Bounce Sidebar, Login Card …).
3. Tasarım dili: AkmanOS açık teması (beyaz + `#f4f4f5`, `#171717`, Geist) — `docs/TASARIM.md`.
4. Kabuk: AkmanOS App Shell; menü 15 ekrandan 7 üst öğeye indi, ⌘K arama, uyarı zili, profil menüsü.
5. Sayfalar iki geçişte yenilendi (sayfa grubu başına bir ajan + bağımsız inceleme/düzeltme ajanı); her ekranın
   özellikleri git'teki ilk sürümle karşılaştırıldı.
6. Alan adı: `ladmin.laffogato.net` → `lafmaliyet` projesi (laffogato.net'e dokunulmadı).

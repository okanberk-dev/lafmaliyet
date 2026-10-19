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

## 6. Excel → Web karşılık tablosu

| Excel sayfası | Web karşılığı | İyileştirme |
|---------------|---------------|-------------|
| Panel | `/panel` | Her ay için çalışır. Reçeteye göre (teorik) ve faturaya göre (gerçekleşen) kâr yan yana. Otomatik uyarılar |
| Ürün Kârlılık | `/panel/urunler` | Arama, filtre, sıralama, satır içinde fiyat düzenleme |
| Reçete Kartları | `/panel/urunler/[id]` | Canlı maliyet hesabı, fiyat simülatörü, ayara bağlı miktar formülleri |
| Satış Raporu | `/panel/satislar` | Patron'dan yapıştır/yükle. POS adı eşleştirmeleri hatırlanır |
| Hammaddeler | `/panel/hammaddeler` | Fiyat geçmişi, hangi reçetelerde kullanıldığı, tahmini fiyat işareti |
| Faturalar | `/panel/faturalar` | Filtre, ödenmedi takibi, kategori × ay özeti |
| Genel Maliyet | `/panel/gelir-gider` | Ayların tamamı otomatik hesaplanır. Her hücre elle düzeltilebilir (mavi) |
| Sayım | `/panel/sayim` | Telefondan sayım. Personel rolü sadece burayı ve reçeteleri görür |
| Tutarlılık Kontrolü | `/panel/tutarlilik` | Stok sayımı varsa gerçek tüketim hesaplanır. Bulgular listesi kapatılabilir |
| Personel | `/panel/personel` | — |
| Sabit Giderler | `/panel/giderler` | Aylık, günlük, haftalık ve yıllık tutarlar otomatik aylığa çevrilir |
| Ayarlar | `/panel/ayarlar` | Kullanıcı yönetimi, QR menü yayını, Excel'e aktarım |
| Nasıl Kullanılır | `/panel/yardim` | — |
| — (yeni) | `/panel/receteler` | Baristalar için maliyetsiz reçete defteri (personel rolü görebilir, yazdırılabilir) |
| — (yeni) | `/panel/analiz` | Menü mühendisliği matrisi ve senaryo simülatörü |
| — (yeni) | `/menu` | Herkese açık QR menü (Ayarlar'dan açılır) |

## 7. Doğrulama

- `npm test`: 11 test, hepsi geçiyor. 129 ürün kartı, 125 satış satırı, Panel, Temmuz–Ekim gelir-gider, personel,
  sabit giderler, tutarlılık ve fatura özetleri Excel ile birebir aynı.
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

# Yazarkasa (banka POS) Z raporu: biçim, kimlikler, tuzaklar

Kasa raporunun **Banka POS Z raporu (yazarkasa)** bölümü bu kâğıdı okur ([KASA-RAPORU.md](KASA-RAPORU.md) › Banka POS Z
raporu). Burada kâğıdın ne olduğu, üstünde ne yazdığı, rakamlarının birbirini nasıl tutması gerektiği ve okurken nerede
yanılındığı anlatılır; panelin denetimleri de bunlara dayanır. Ayırt edici cümle her yerde aynı: **üstünde Z RAPORU ve
KDV dökümü yazar; banka gün sonu fişi değil.**

Kaynak: dalga 13'ün araştırma notları ([planlar/okc-z-notlar.md](planlar/okc-z-notlar.md), 24 Ekim 2026) ve plan
([planlar/okc-z.md](planlar/okc-z.md) §5). Araştırmada GİB kılavuzları ve cihaz kılavuzları çoğunlukla yalnız arama
özetlerinden görülebildi; tam okunan tek somut kaynak açık kaynaklı bir Z raporu okuyucusudur (§8).

> **Durum (26 Ekim 2026): kafenin kendi cihazıyla henüz doğrulanmadı.** Aşağıdaki düzen ve etiketler genel bilgidir;
> KÜM. satırlarının basılıp basılmadığı, Z'nin kim tarafından ve saat kaçta alındığı ve ModPOS raporunun hangi
> yazıcıdan çıktığı gerçek fişlerle doğrulanınca §6 doldurulur. O zamana kadar fotoğraftan okunan yazarkasa rakamları
> forma **yazılmaz**, her alanın altında öneri olarak çıkar (`OKC_PREFILL_ENABLED = false`, §7).

## 1. Ne olduğu

- **Yazarkasa Z'si** (yeni nesil ÖKC, kafede "banka POS"): günlük kapanış fişi. O günün mali satışları, oran oran KDV'si,
  ödeme türleri ve sıra numarası (Z NO) basılır. Z alınınca günün toplamları mali hafızaya yazılır ve günlük sayaçlar
  sıfırlanır. Müşterinin kişisel verisi yoktur; başlıkta şirketin unvanı, adresi, VKN'si, altta cihazın sicil no'su
  (MF logosu) basılıdır. Z'nin verisi GİB'e elektronik olarak da bildirilir; kâğıt Z'lerin saklanması ayrı bir
  yükümlülüktür (muhasebeciye sorulur).
- **ModPOS Z raporu başka bir sayaçtır:** adisyon programının gün sonu raporu (masa, ürün, ikram / ödenmez, garson).
  MF logosu, EKÜ NO, KÜM. satırı yoktur; yazarkasadan basılıyorsa başlıkta VKN ve MF görünebilir ama "BİLGİ FİŞİ" ya da
  "MALİ DEĞERİ YOKTUR" yazar. İki Z'nin toplamı meşru olarak farklıdır: online ve diğer satışlar yazarkasadan geçmez, Z
  kapanıştan önce alınırsa geç satışlar ertesi Z'ye düşer.
- **Z olmayanlar:** X raporu (gün içi, sıfırlamaz, çoğu zaman "SON Z-SAYISI" basar), mali hafıza / dönem raporu (İKİ Z
  ARASI, İKİ TARİH ARASI: birden çok gün), EKÜ raporu (eski bir günün yeniden basımı), kasiyer ve denetim raporları.
- **Banka gün sonu fişi** (GÜN SONU, GRUP / BATCH KAPAMA, MUTABAKAT): yalnız o banka uygulamasının kart işlemleri, son
  gün sonundan beri (bir gün atlanırsa iki gün tek fişte). KDV, Z NO, EKÜ NO, MF logosu, kümülatif ve nakit yoktur.
  Bütünleşik cihazlarda "Z raporu al" önce mali Z'yi, hemen ardından aynı şeride her banka uygulamasının gün sonunu
  basar.
- **Kart** Z'nin K.KARTI (KREDİ KARTI) satırıdır. Altındaki banka adlı satırlar kartın dökümüdür, ayrıca eklenmez. Bazı
  cihazlar kart satırı basmaz, kartı yalnız banka adlarıyla döker: o zaman kart onların toplamıdır.
- **KDV oranları** (10 Temmuz 2023'ten beri) %1, %10, %20 ve %0. Kafenin yiyeceği ve alkolsüz içeceği %10. Yeniden
  programlanmamış cihaz eski %8 / %18 gruplarını 0,00 ile basabilir.
- **Toplam dışı tahsilat:** faturalı satış (e-Fatura, e-Arşiv), yemek kartıyla tamamı ödenen satışın bilgi fişi, avans,
  fatura / cari tahsilatı, otopark. Z'de ayrı satırdır ve günlük toplama girmez. VUK 593 (8 Mayıs 2026) yazarkasanın
  e-belge kesmesine izin verdi; yeni yazılımlar e-belge adet ve tutarını mali fişten ayrı basabilir. Yemek kartı cihaza
  nasıl girildiğine göre toplamın içinde (ödeme türü) ya da dışında (bilgi fişi) görünebilir.

## 2. Tipik düzen

57–58 mm termal kâğıt, satırda ~32–42 karakter. Tutarların başında `*` olur ("*8.110,00"). Birçok cihazda **etiketin
sağındaki sayı adettir, tutar bir alt satırdadır** ("K.KARTI 31", altında "*6.900,00"). Aşağıdaki örnek kurgusal bir
işletmenindir (açık kaynaklı okuyucunun sentetik örneği, §8):

```
<İŞLETME UNVANI>                               başlık: ad, adres, vergi dairesi + VKN
TARİH 01.09.2026                SAAT 23:50     Z'nin tarihi ve saati
FİŞ NO                                0612     Z'nin kendi belge no'su (Z no değil, adet değil)
              Z RAPORU                         başlık
Yiyecek  %10                            40     departman: ad, oran, adet
                                 *8.110,00     ... ve tutar (KDV dahil)
İçecek   %20                            35
                                 *1.240,00
NET SATIŞ                        *9.350,00     GÜNLÜK toplam (KDV dahil)
NAKİT                                    9     ödeme türü + adet
                                 *2.450,00
KASA NAKİT                       *2.450,00     çekmecedeki nakit (para giriş / çıkış varsa nakit satıştan farklı)
K.KARTI                                 31     kart + adet
                                 *6.900,00
ÖRNEKBANK                        *6.900,00     K.KARTI'nın banka dökümü (yeniden eklenmez)
FİŞ İPTAL                                0     iptal (adet, sonra tutar; toplamdan zaten düşülmüş)
MÜŞTERİ FİŞ ADEDİ                       40     satış fişi
SLIP FİŞ ADEDİ                          31     banka slipi (mali değil)
TOPLAM FİŞ ADEDİ                        71     = 40 + 0 + 31 (satış fişi sayısı DEĞİL)
VERGİ DÖKÜMÜ
%10 TOPLAM                       *8.110,00     oranın toplamı, KDV DAHİL
%10 TOPKDV                         *737,27     oranın KDV'si (= 8.110 × 10/110)
%20 TOPLAM                       *1.240,00
%20 TOPKDV                         *206,67
MALİ VERİ TOPLAM                 *9.350,00     GÜNLÜK (= NET SATIŞ)
MALİ VERİ TOPKDV                   *943,94     GÜNLÜK KDV (= 737,27 + 206,67)
KÜM. TOPLAM                  *1.259.350,00     KÜMÜLATİF: cihaz açılışından beri, bugünün değil
KÜM. TOPKDV                    *118.943,94     KÜMÜLATİF KDV, bugünün değil
Z SAYAÇ                               0101     Z no (altta "Z NO" diye de basılır)
EKÜ NO 0001                                    elektronik kayıt ünitesi no'su (küçük, nadiren değişir)
MF  AV0000000001                               mali logo + marka kodu + cihaz sicil no
```

Bir Beko 300TR kılavuz örneğinde oran blokları TOP ve KDV, ardından KÜMSAT ve KÜMKDV basılır; aynı kılavuzun başka bir
kopyasında KÜM. satırı yoktur (yazılıma ve ayara bağlı). Hugin'in X raporu "MALİ BELLEKTE MEVCUT SON Z-SAYISI" basar.

## 3. Etiketler (anlamına göre)

| Anlam | Görülen etiketler | Günlük mü |
|---|---|---|
| Başlık | Z RAPORU, Z GÜNLÜK RAPORU, Z-GÜN SONU RAPORU; GÜN SONU RAPORU da olabilir (banka fişi ve ModPOS da kullanır) | — |
| Z değil | X RAPORU, MALİ HAFIZA / MALİ BELLEK RAPORU, İKİ Z ARASI, İKİ TARİH ARASI, GÜNLÜK / AYLIK SATIŞ RAPORU, EKÜ RAPORU, KASİYER RAPORU, BİLGİ FİŞİ | — |
| Z no | Z NO, Z SAYAÇ, Z SAYACI, Z-NO | her Z'de 1 artar |
| Z no **olmayan** numaralar | FİŞ NO (Z'nin belge no'su; çoğu cihazda her gün sıfırlanır), EKÜ NO, SİCİL NO / MF satırı, BATCH NO (banka), X raporundaki SON Z-SAYISI | — |
| Günlük toplam (KDV dahil) | NET SATIŞ, MALİ VERİ TOPLAM, TOPSAT, TOPLAM / TOP; GÜNLÜK TOPLAM, TOPLAM SATIŞ | günlük |
| Günlük KDV | TOPKDV, MALİ VERİ TOPKDV, TOPLAM KDV | günlük |
| Oran bloğu | VERGİ DÖKÜMÜ, KDV DÖKÜMÜ; "%10 TOPLAM / %10 TOPKDV", "KDV %10 … TOP … KDV"; bazı cihazlarda "%10 MATRAH" (KDV hariç) | günlük |
| Kümülatif | KÜM. TOPLAM, KÜM. TOPKDV, KÜMSAT, KÜMKDV, KÜMÜLATİF; bazı cihazlarda GENEL TOPLAM da olabilir (belirsiz) | **cihaz açılışından beri** |
| Ödemeler | NAKİT, K.KARTI, KREDİ KARTI, KREDİ, BANKA KARTI, YEMEK KARTI / YEMEK ÇEKİ, KUPON, HAVALE / EFT, AÇIK HESAP, DİĞER | günlük |
| Kartın banka dökümü | banka ya da uygulama adı ve tutar | günlük, kartın parçası |
| Çekmece | KASA NAKİT, PARA GİRİŞ / ÇIKIŞ, KASA AVANS | günlük (ödeme değil) |
| İptal ve indirim | FİŞ İPTAL, İPTAL, DÜZELTME, İNDİRİM / ARTIRIM | günlük, toplamdan zaten düşülmüş |
| Adetler | MÜŞTERİ FİŞ ADEDİ, MALİ FİŞ ADEDİ, SLIP FİŞ ADEDİ, TOPLAM FİŞ ADEDİ, FİŞ SAYISI | günlük |
| Toplam dışı | FATURALI SATIŞ, e-FATURA, e-ARŞİV, YEMEK KARTI / ÇEKİ (bilgi fişi), AVANS, FATURA / CARİ TAHSİLAT, OTOPARK | günlük, toplamın **dışında** |

## 4. Kimlikler (panelin denetimleri)

Gerçek bir Z'de rakamlar birbirini tutar; tutmayan rakam yanlış okunmuştur ya da başka bir satırdan alınmıştır. Panelde
**model yalnız aktarır** (her rakamı fişte yazıldığı gibi, okuduğu sayıyla ve güveniyle döner); toplamlar ve denetimler
bizim saf kodumuzda (`src/lib/okc-z.ts` › `okcChecks`; okumada `src/lib/photo-read/okc.ts` › `normalizeOkc`, formda
elle yazılana da `okcFormChecks`). Modelden hiçbir zaman toplamları tutturması istenmez: soluk bir rakamı aritmetikle
"çözerse" kimlik tanım gereği tutar ve hiçbir şey yakalanmaz.

Toleranslar: toplamlar kuruşa kadar (0,05 ₺); KDV fiş fiş yuvarlandığı için oran formülünde 0,005 ₺ × fiş sayısı (en
az 0,05 ₺; fiş sayısı yoksa 1 ₺).

**Doğrulama kuralı.** Bir kimlik bir alanı ancak iki tarafı **farklı basılı rakamlardan** geliyorsa doğrular. Kafenin
satışı neredeyse tümüyle %10: aynı rakam NET SATIŞ, MALİ VERİ TOPLAM ve %10 TOPLAM olarak üç kez basılır ve model onu
aynı yanlışla üç yerde okuyabilir. Tek oranlı günde K1 / K2, tek ödemeli günde K4 aynı rakamın kopyalarını karşılaştırır:
tutmazsa yine "tutmadı" yapar, tutarsa yalnız "çelişki yok" verir. K3'ün payı fiş sayısıyla büyüdüğü için (143 fişte
~0,72 ₺, %10'da toplamdaki ~8 ₺'lik hatayı göremez) K3 hiçbir alanı doğrulamaz, yalnız çürütür.

| # | Kimlik | Doğrular mı | Tutmazsa |
|---|---|---|---|
| K1 | Σ oran toplamları = günlük toplam | yalnız sıfır olmayan en az 2 oranla | oran toplamları; başka kimlik doğrulamadıysa günlük toplam |
| K2 | Σ oran KDV'leri = toplam KDV | yalnız KDV'si olan en az 2 oranla | oran KDV'leri; doğrulanmadıysa toplam KDV |
| K3 | Her oran: KDV ≈ toplam × r / (100 + r) (%10 → /11, %20 → /6, %1 → /101); MATRAH basılıysa MATRAH + KDV = toplam | hayır | doğrulanmamış olan (ikisi de değilse ikisi) |
| K4 | Σ ödemeler (nakit + kart + yemek kartı + diğer) = günlük toplam; ya da = günlük toplam + toplam dışı tahsilat | yalnız sıfır olmayan en az 2 ödeme türüyle | ödeme alanları; başka kimlik doğrulamadıysa günlük toplam |
| K5 | Toplam KDV ÷ günlük toplam, okunan oranların r / (100 + r) aralığında (oran yoksa 1/101 – 1/6), ±0,002 | hayır | toplam KDV; doğrulanmadıysa günlük toplam |
| K6 | Zincir: Z no = önceki saklanan kümülatifin Z no'su + 1 ise kümülatif − önceki kümülatif = günlük toplam (KDV için de); aradaki girilmemiş Z'lerde en az o kadar | evet (+1'de) | günlük toplam (başka kimlik doğrulamadıysa) |
| K7 | Banka satırlarının toplamı ≈ kart satırı | hayır | yalnız yöneticiye bilgi |
| K8 | Eski oran (%8, %18) satırında tutar olmaz; oran {0, 1, 8, 10, 18, 20} dışında olmaz | hayır | o oran |
| K9 | Fiş sayısı tam sayı, 0–5.000 | hayır | fiş sayısı |
| Z no | Önceki yazarkasa Z'si + 1 | evet | aynıysa okumanın bütünü durur ("dünkü Z raporu olabilir"); küçükse Z no tutmadı; aradaki boşluk bilgi (önceki gün ise uyarı) |
| Büyüklük | Günlük toplam son 28 günün (yoksa ModPOS'un) ortancasının 5 katından **ve** 50.000 ₺'den büyük değil | hayır | günlük toplam ("cihaz toplamı okunmuş olabilir") |
| Kümülatif eşitliği | Günlük toplam kümülatife eşit değil (önceki kümülatif biliniyorsa) | hayır | günlük toplam |
| GENEL TOPLAM | Günlük toplam GENEL TOPLAM satırından okunduysa ancak iki ayrı rakamla doğrulanırsa kabul | hayır | günlük toplam |

- Bir alan önce **tutmadı** (herhangi bir kimlikte), sonra **doğrulandı**, yoksa **denetlenemedi**. Kimliğin bir ucu
  okunmamışsa kimlik çalışmaz.
- KASA NAKİT toplamaya girmez; FİŞ İPTAL ve İNDİRİM toplamdan zaten düşülmüştür, yeniden düşülmez.
- **Kümülatif yalnız sunucuda ve yalnız inandırıcıysa saklanır** (`okcCumulativeToStore`): okunan Z no ve günlük toplam
  kaydedilenle aynıysa ve (a) zincir tutuyorsa, (b) önceki saklanan kümülatif yoksa ve kümülatif en az günlük
  toplam kadarsa ya da (c) arada girilmemiş Z'ler varsa ve kümülatif en az günlük toplam kadar büyümüşse. Zincir hep son
  **saklanan** kümülatife bağlanır: yanlış okunmuş bir kümülatif saklanmaz, ertesi günün doğru toplamını "tutmadı"
  yapamaz. Yönetici yanlış saklananı **Kümülatifi temizle** ile siler.
- Personele giden metinlerde "kümülatif", "zincir", "KÜM.", "MATRAH" sözcükleri yoktur; alan başına tek, sade bir neden
  ve kartın altında tek özet satırı. Ayrıntılı metinler yalnız yöneticide (plan D16, D17).

## 5. Okuma tuzakları

| Tuzak | Ne olur | Yakalayan |
|---|---|---|
| Günlük yerine kümülatif | KÜM. TOPLAM (milyonlar) günün toplamı, KÜM. TOPKDV günün KDV'si diye okunur | büyüklük, K1, K5, K6, kümülatif eşitliği |
| GENEL TOPLAM | ModPOS'ta günün toplamı; bazı mali cihazlarda kümülatif olabilir | NET SATIŞ / MALİ VERİ TOPLAM / TOPSAT tercih edilir; GENEL TOPLAM kuralı, K6 |
| KDV dahil / hariç | MATRAH grup toplamı diye ya da grup toplamı MATRAH diye okunur | K3 (MATRAH + KDV = toplam), K1 |
| Oranın KDV'si ile toplamı | küçük TOPKDV satırı grup toplamı diye (ya da tersi) | K3 |
| Kart toplam diye | K.KARTI (ya da banka satırı) günlük toplam diye; banka satırı karta ikinci kez | K4, K7 |
| Adet tutar diye | etiket satırındaki adet ("K.KARTI 31") tutar diye; tutar alttaki satırda olduğu için bir sonraki etikete kayar | K4; istemdeki etiket–tutar eşleme kuralı |
| Başka numara Z no diye | FİŞ NO, EKÜ NO, sicil, BATCH NO | Z no = önceki + 1 |
| TOPLAM FİŞ ADEDİ | slip ve bilgi fişini de sayar | istem (MÜŞTERİ / MALİ FİŞ ADEDİ), K9 |
| İptal ya da indirim iki kez | zaten düşülmüş tutar yeniden düşülür | hiçbir zaman düşülmez, ayrı kaydedilir |
| Toplam dışı tahsilat | faturalı satış, bilgi fişi, e-Arşiv toplama eklenir ya da ödemeler ≠ toplam hata sayılır | ayrı alan; K4'ün istisnası |
| Soluk rakam | 0/8, 6/0, 5/9, 1/7, 3/8, 5/6; virgül kaybı (100 kat) | K1–K3, K6; güven "orta / düşük"; model düzeltmez |
| Uzun şerit tek fotoğrafta | 57 mm şerit telefon fotoğrafında ~375 px eninde, harf 8–11 px | üst ve alt yarı ayrı fotoğraf (bölümde en çok 3) |
| Bir fotoğrafta iki belge | Z ve ardından banka gün sonu aynı şeritte; dünün ve bugünün Z'si; ikinci cihaz | belge başına bir okuma, başlık + Z no + tarih; "birden çok belge" uyarısı |
| X raporu, dönem raporu, EKÜ raporu | gün içi ya da birden çok gün | başlık; belge türü (hiçbir alan dolmaz) |
| ModPOS Z'si yazarkasa Z'si diye (ya da tersi) | ModPOS'ta masa, ürün, ikram, garson; MF, EKÜ NO, KÜM. yok | belge türü; **ModPOS bölümüne okut** / **Banka POS Z bölümüne okut** |
| Eski KDV grupları | 0,00'lı %8 / %18 satırı canlı grup sanılır | sıfır gruplar alınmaz; K8 |
| Yanlış tarih | gece yarısından sonra alınan Z ertesi günü basar | 05:00 kuralı |

## 6. Kafenin cihazı (doğrulanacak)

Planın adım 0'ı ([planlar/okc-z.md](planlar/okc-z.md) §1, §16): istem ve kimlikler kesinleşmeden önce kâğıtla
doğrulanacak üç gerçek. Cevap gelene kadar panel varsayılanla çalışır.

| Soru | Neyi değiştirir | Varsayılan (bugün kodda) |
|---|---|---|
| KÜM. satırları basılıyor mu ve bu Z'yi içeriyor mu? Ardışık iki günde KÜM. TOPLAM(bugün) − KÜM. TOPLAM(dün) = bugünün toplamı mı? | K6 ve kümülatif sütunları; basılmıyorsa PR-b'den çıkar, bir önceki Z'ye kadar ise formül bir gün kayar | Okunursa saklanır (yalnız inandırıcıysa), K6 yalnız önceki saklanan kümülatif varsa çalışır |
| Z'yi kim, saat kaçta alıyor? Elle kapanışta mı, cihaz kendiliğinden (ör. 23:59) mı? Bazen ertesi sabah mı? (S12) | 05:00 kuralı ve "Z ertesi sabah" istisnası | Elle, kapanışta; ertesi sabah istisnası kapalı (`nextMorningZ`) |
| ModPOS raporu hangi yazıcıdan çıkıyor? Yazarkasadan "bilgi fişi" olarak mı? (S13) | Belge türü ayrımının dayandığı işaretler | Ayrı yazıcı; aynı cihazdansa "BİLGİ FİŞİ / MALİ DEĞERİ YOKTUR" yazısı |
| Cihazın markası ve modeli; Z alınınca banka gün sonu aynı şeride basılıyor mu? | Etiketler, banka gün sonunun okunması | Aynı şeritte olabilir: Z'nin alanları ve Banka gün sonu birlikte okunur |

## 7. Kod

| Dosya | İçerik |
|---|---|
| `src/lib/okc-z.ts` | kimlikler (`okcChecks`), formun canlı denetimi (`okcFormChecks`), zorunluluk (`okcFormError`), kümülatifin saklanması (`okcCumulativeToStore`), geç raporun iki yanlı zinciri (`okcLateChain`), ModPOS ↔ yazarkasa ↔ banka satırları (`okcReconcile`), ayın kapsamı (`okcMonth`), doldurma kapısı `OKC_PREFILL_ENABLED` |
| `src/lib/photo-read/okc.ts` | okumanın forma hâli (`normalizeOkc`), personelin okuması (`toStaffReading`), eski sayfaya yanıt (`okcToLegacyPos`) |
| `src/lib/photo-read/schemas.ts`, `prompts.ts` | `KasaOkcRaw`, `OKC_TASK` (taslak: gerçek fişlerle yeniden denetlenecek) |
| `src/app/panel/kasa/okc-card.tsx`, `okc-form.ts` | formdaki kart ve saf form mantığı |
| `tests/okc-z.test.ts` | kimlikler, kopya kimlikler, kümülatifin saklanması, mutabakat satırları, ay |

## 8. Kaynaklar

- Açık kaynaklı Z raporu okuyucusu (MIT): https://github.com/witchivip34/z-rapor-okuyucu (`zrapor/okuma.py` istem,
  `zrapor/kontrol.py` yedi denetim ve zincir, `ornekler/uret_fis.py` + `ornekler/z_ornek.png` kurgusal örnek Z). Salt
  okundu, hiçbir şeyi çalıştırılmadı.
- GİB: YN ÖKC fiş ve e-belge formatları kılavuzu taslağı (16.12.2025, §5.3 Z-Gün Sonu Raporu),
  https://ynokc.gib.gov.tr/UploadedFiles/Files/yn-okc-fis-ve-e-belge-formatlari-kilavuz_taslak_16122025.pdf ; YN ÖKC
  Teknik Kılavuzu v7.0, https://ynokc.gib.gov.tr/UploadedFiles/Files/YN_OKC_TEKNIK_KILAVUZU_08092023.pdf ; Mali Rapor
  Bildirim TK v1.0, https://ynokc.gib.gov.tr/UploadedFiles/Files/YN_OKC_Mali_Rapor_Bildirim_Teknik_Kilavuz_v1_20062024.pdf ;
  Bilgi Fişi kılavuzu 2020, https://ynokc.gib.gov.tr/UploadedFiles/Files/Bilgi_Fisi_Teknik_Kilavuzu_24072020.pdf ;
  YN ÖKC SSS, https://ynokc.gib.gov.tr/UploadedFiles/Files/yn_okc_sss_pdf.pdf
- Örnek Z basan kılavuzlar: Beko 300TR https://ynokc.gib.gov.tr/UploadedFiles/Files/300tr.pdf ; Beko 220TR
  https://ynokc.gib.gov.tr/UploadedFiles/Files/220tr.pdf ; Hugin https://ynokc.gib.gov.tr/UploadedFiles/Files/hugin300.pdf ;
  PAX A910SF https://ikasa.com.tr/wp-content/uploads/2025/04/PAX-A910SF_Kullanim-Klavuzu-1.pdf ; Token yardım
  https://www.tokeninc.com/yardim-merkezi/beko-300tr-urun-kullanimi/z-raporu/
- Z ile banka gün sonunun tek basışta çıkması: https://blog.dorapos.com.tr/hugin-s1-z-raporu-ve-gun-sonu-nasil-yapilir/
- TOPSAT / TOPKDV, faturalı satışın TOPSAT dışında olması: https://www.fisle.co/blog/z-raporu-muhasebe-kaydi
- X, Z ve mali hafıza ayrımı: https://www.lexpera.com.tr/mevzuat/ozelgeler/b-07-4-def-0-78-10-00-okc-4-sayili-ozelge-1
- VUK 593: https://www.alomaliye.com/2026/05/08/vergi-usul-kanunu-genel-tebligi-sira-no-593-vuk-593/
- Banka gün sonu: https://www.akbankpos.com/doc/AkbankPOS_Kullanim_Kilavuzu.pdf , https://arifunal.com/yazi/batch-numarasi-nedir/
- Tam liste: [planlar/okc-z-notlar.md](planlar/okc-z-notlar.md) §8.

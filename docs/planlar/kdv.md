# Ek (insight'a): Nakit planında KDV tahmini

Grup: **kdv** · `insight.md`'nin **eki**dir; aynı dalda, insight grubu uygular (insight'ın §2 nakit planı bittikten
sonra). Depo: `/home/user/lafmaliyet` (dal `claude/oneriler`). **Şema değişikliği yok, migration yok, yeni bağımlılık yok.**

Uygulamadan önce okunacaklar: `AGENTS.md`; `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`
(eylemden sonra `refresh()`), `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`. Mevcut
kalıplar: `src/lib/calc/engine.ts` (`pnlMonth`'taki `revenueNet`: karaoke %20 ayrımı, 71ac11f), `src/lib/site-sales/calc.ts`
(`exVatMinor`, `siteRevenue`), `src/server/parasut/mapping.ts` (fatura `amount / discount / payable / vat`),
`src/lib/reminders.ts` (`REMINDER_PRESETS` › "KDV beyannamesi ve ödemesi", `reminderCategory`),
`src/server/actions/reminders.ts` (`markReminderDone`, `postponeReminder`, `restoreReminder`, `undoRecentPaid`),
`src/lib/calc/insights.ts` (`forecastMonthOf`: "ciro ÷ açık gün × ayın gün sayısı").

---

## 0. Amaç

Sahibe söylenen: "28 Kasım'da ödenecek KDV yaklaşık şu kadar". Sahibin isteği: "bunu yap ama aşırı detaylı değil, basitçe
anlaşılır olsun". Bugün nakit planı KDV'yi hiç saymıyor. insight §2.1'e göre tutarsız bir KDV hatırlatıcısı “Tutarı
girilmemiş ödemeler”de kalıyor. Bu ek dört şey getirir:

1. **Tek küçük kart:** Nakit planı ekranında “KDV tahmini”. Her ödeme günü bir satırdır, örneğin “28 Kas · Ekim KDV'si
   ≈ 42.100 ₺”. Satıra dokununca dört satırlık döküm açılır.
2. **Planda çıkış:** ödeme gününde tahmini bir çıkış satırı (“KDV (Ekim)”). Ödemeler'deki KDV hatırlatıcısına sahibin
   yazdığı tutar tahminin önüne geçer.
3. **Açıklama:** “Nasıl hesaplandı” kartına tek satır.
4. **Yardım:** Yardım'a kısa bir soru-cevap.

Hesap tek cümledir: **önceki ayın satışlarındaki KDV − alış faturalarındaki KDV − önceki aylardan devreden KDV**. Sonuç
eksi çıkarsa “ödeme beklenmez” yazılır ve fark sonraki aya devreder. Her yerde aynı etiket bulunur: “Tahmin; kesin tutar
muhasebecinizin beyannamesindedir.”

---

## 1. Kararlar (kodu okuyup verildi; uygulayan yeniden karar vermez)

| Konu | Karar | Neden |
|---|---|---|
| Hangi ay, hangi gün | Ay P'nin KDV'si, P+1'in **28'inde** ödenir. Hafta sonu kaydırması yok | Ödemeler'deki hazır şablon da 28'i kullanır (`REMINDER_PRESETS.kdv`). 28 Kasım 2026 Cumartesi'dir ve yasal son gün 30 Kasım Pazartesi'dir; plan parayı iki gün erken çıkarır, bu güvenli taraftır |
| Kasa (ModPOS) satış KDV'si | `revenue − revenueNet`, gelir-giderle aynı formül: ürünler `kdv` (%10), HİZMET satırları (karaoke) `kdvHizmet` (%20) | 71ac11f'deki `pnlMonth` kuralı birebir kullanılır. Rakam Gelir-gider'deki “AYLIK CİRO (KDV dahil) − (KDV hariç)” farkıyla aynı çıkar (test) |
| Ciro kaynağı | Etkin ay bilgisi `model.monthInfo.get(ay).posRevenue`. kasa planı geldiyse Z toplamından türetilen değerdir, yazılan değer hep kazanır | Ciro zaten KDV dahil, indirimler düşülmüş, ödenmezler hariçtir |
| Süren ay | Ciro `÷ açık gün × ayın gün sayısı` ile ay sonuna tamamlanır | Genel bakış'taki “Ay sonu tahmini”yle (`forecastMonthOf`) aynı kural. Sahip aynı sayıyı iki yerde farklı görmez |
| laffogato.net | Site kaydındaki KDV: kafe ve mağaza `netMinor − exVatMinor(·, kdv)`, karaoke `netMinor − exVatMinor(·, kdvHizmet)` | Site her siparişin KDV'sini (`kdvMinor`) saklar. Oranı saklı olmayanlara panelin kuralı uygulanır (SITE-SATIS.md) |
| Alış KDV'si | Faturanın `payable − (amount − discount)` değeri. `vat` sütunu **kullanılmaz** | Excel'den gelen 80 faturada `vat = 0`, KDV ise ödenecek ile net farkındadır (yerel DB'de 250.364 ₺). Paraşüt faturalarında bu fark `vat`'a eşittir (31/31). Tevkifatlıda fark `vat − tevkifat`'tır: alıcı tevkifatı 2 No.lu beyannameyle aynı gün öder, nakit etkisi tam bu farktır. İadede değer eksidir |
| Kafe dışı faturalar | `SEPARATE_CATEGORIES` (Karaoke box, Alp Koç) sayılmaz | Karaoke box'ın satışları panelde yok. Yalnız alışını düşmek tahmini sistemli biçimde düşürürdü. Sahip sorusu §12-2 |
| Süren ayın alışları | **Yalnız bugüne kadar gelen faturalar.** Ay sonuna tamamlanmaz | Olmayan bir indirim uydurulmaz, tahmin güvenli tarafta (yüksek) kalır. Ay ilerledikçe fatura geldikçe biraz iner. Süren ay ancak ayın son 14 gününde plana girer (§2.1) |
| Devreden KDV | **Otomatik:** ModPOS cirosu olan ilk aydan (Excel verisinde Temmuz 2026) beri ay ay zincir. **Muhasebeciden:** sahip “sonraki döneme devreden KDV”yi girerse zincir oradan başlar | Kafe Temmuz'da açıldı ve demirbaş faturalarının KDV'si ≈ 190.000 ₺. Devreden sayılmazsa plan Ekim ve Kasım'da toplam ≈ 69.400 ₺ olmayan bir ödeme gösterirdi. Panelin hesabı yanlışsa giriş düzeltir |
| Hatırlatıcı tutarı | Sahibin KDV hatırlatıcısına yazdığı tutar (0 dahil) **o dönemin kesin tutarıdır**, tahminin önüne geçer. Tutar > 0 ise o aydan sonraya devreden sıfırlanır | Muhasebeci “ödenecek 27.200” dediyse o ay devreden yoktur. Zincir kendiliğinden düzelir |
| Tutar yalnız sıradaki döneme | KDV hatırlatıcısının tutarı yalnız kayıtlı (sıradaki ya da geciken) dönemine uygulanır. “Ödendi” deyince ve tekrarlı seri ertelenince serinin tutarı silinir (geri al ile geri gelir) | `markReminderDone` tutara dokunmuyor. Silinmezse Eylül'ün tutarı Kasım'da da “kesin” görünürdü |
| Yuvarlama | Her bileşen ayrı ayrı en yakın **100 ₺**'ye yuvarlanır (yarım yukarı, işaret korunur). Ödenecek ve devreden bu yuvarlı bileşenlerden hesaplanır | Ekrandaki çıkarma birebir tutar (51.800 − 9.700 = 42.100). Sapma en çok ±150 ₺ |
| Bildirim | Yok (zil ve e-posta değişmez) | insight §5-7 ile aynı: önce isabet görülsün |
| ModPOS günlük ürün raporu (gelecek) | Ek iş yok. Karaoke payı `model.monthSales(ay).serviceRevenue`'dan okunur; günlük satırlar süren aya girince ayrım kendiliğinden kesinleşir | Seam: `vatMonthInputs` (§5.1) |

---

## 2. Hesap

### 2.1 Dönemler ve plana giren günler

- `vatDueDate("2026-10") = "2026-11-28"`.
- Hatırlatıcı gününden dönem: `vatPeriodOf(due)`.
  - Önceki aydır: “2026-11-28” → “2026-10”, “2026-11-26” → “2026-10”.
  - **İstisna:** ayın 1–7'si **iki ay önceye** sayılır (“2026-11-04” → “2026-09”). `postponeReminder` 28 Ekim'i 1 hafta
    erteleyince 4 Kasım'da tek seferlik bir kopya açar; o kopya hâlâ Eylül'ün KDV'sidir. 1 ay erteleme zaten engelli
    (sıradaki döneme biner).
- Plan 42 gündür (bugün … bugün+41). Ufukta en fazla iki dönem olur:
  - geçen ay (bu ayın 28'inde ödenir);
  - süren ay (gelecek ayın 28'inde ödenir). Yalnız `gün ≥ ayın gün sayısı − 13` iken ufka girer (31 çeken ayda 18'i ve
    sonrası). Bu yüzden süren ayın en az 17 günlük verisi olur.
- Gecikmiş bir KDV hatırlatıcısı insight kuralıyla gün 0'a düşer ve iki ay önceki dönemi taşıyabilir.

### 2.2 Satışların KDV'si (dönem P)

1. **Kasa (ModPOS).** `R = monthInfo(P).posRevenue` (> 0 ise), `S = min(max(R,0), monthSales(P).serviceRevenue)`.
   `posVat = (R − S) × kdv/(1+kdv) + S × kdvHizmet/(1+kdvHizmet)`. Bu `R − pnlMonth(P).revenueNet`'e eşittir.
   - **Süren ay** (P = bugünün ayı):
     - Açık gün > 0 ve < ayın gün sayısı ise `çarpan = gün sayısı ÷ açık gün`.
     - Açık gün yoksa `çarpan = gün sayısı ÷ max(1, bugünün günü − 1)`.
     - `posVat` ve gösterilen ciro bu çarpanla büyür. Bu durum ekranda “aya tamamlandı” diye yazılır.
   - **Biten ay:** çarpan yok. Temmuz 2026'nın 23 açık günü gerçektir, kafe ay ortasında açıldı.
   - **Ciro girilmemiş ay** (P ≥ ilk satış ayı): P'den önceki, cirosu ve açık günü olan en son ayın günlük KDV'si
     `vat ÷ açık gün × P'nin gün sayısı` olarak kullanılır. Ekranda “Ekim cirosu yok: Eylül'ün günlük ortalamasıyla”
     yazar. İlk satış ayından önceki aylarda satış 0'dır.
2. **laffogato.net.** Site kaydı varsa `siteVat(kayıt, kdv, kdvHizmet)` (TL) hesaplanır.
   - Süren ay ve `closed = false` ise kayıt `pulledAt` gününe (Türkiye) kadarki dünü kapsar:
     `çarpan = gün sayısı ÷ max(1, çekildiği gün − 1)`. Kayıt sonraki bir ayda çekildiyse çarpan 1'dir.
   - Kayıt yoksa 0 sayılır. Site bağlıysa (en az bir ay kaydı varsa) dökümde “laffogato.net: bu ay çekilmedi” yazar.
   - Siteden panele elle girilen siparişler (`manual`) zaten ModPOS'tadır ve sayılmaz (`siteRevenue` gibi).
3. **Dahil olmayanlar** (belgede yazılır): ikram / ödenmez (Z dışı), MaviBahçe karaoke box'ın satışları.

### 2.3 Alışların KDV'si (dönem P)

`model.invoicesByMonth.get(P)` içinden kategorisi `SEPARATE_CATEGORIES`'te olmayan her fatura için `purchaseVat(f) =
f.payable − (f.amount − f.discount)` toplanır.

- Demirbaş, kira, yazılım, reklam, komisyon ve mal faturaları dahildir.
- “Kontrol bekleyen” faturalar da sayılır.
- Süren ayda yalnız gelen faturalar sayılır.
- Sayılmayanlar: Aylık harcamalar'daki fatura dışı ödemeler, faturası panele gelmeyen sabit giderler. Bunların KDV'si
  bilinmez, tahmin bu yüzden yüksek kalır.

### 2.4 Devreden KDV ve kesin tutarlar (zincir)

- **Başlangıç.** Muhasebeci kaydı varsa `{ay A, tutar C}`: zincir A+1'den başlar, ilk devreden `round100(C)`'dir. Kayıt
  yoksa zincir **ilk satış ayından** başlar ve ilk devreden 0'dır.
  - İlk satış ayı = `posRevenue > 0` olan ilk ay. Hiç yoksa ilk site kaydının ayı alınır.
  - Başlangıç en fazla 24 ay geriye gider (`VAT_CHAIN_MAX_MONTHS`).
  - İlk satış ayından önceki faturalar sayılmaz. Paraşüt'ten gelmiş eski faturalar (yerelde 2025 Sütaş örnekleri)
    zinciri bozmaz.
- **Her ay için:** `net = satış − alış − devredenGiriş` (hepsi yuvarlı).
  - **Kesin tutar K yoksa:** `ödenecek = max(0, net)`, `devredenÇıkış = max(0, −net)`.
  - **K varsa** (Ödemeler'deki KDV hatırlatıcısının o döneme ait sıradaki tutarı): `ödenecek = K`.
    `devredenÇıkış = K > 0 ? 0 : max(0, −net)`.
  - **Verisiz ay** (ne ciro ne yedek ne site): ödenecek hesaplanamaz. Devreden olduğu gibi geçer.
- **Muhasebeci kaydının kendi ayı A** ufuktaysa (ör. A = Eylül, ödemesi 28 Ekim) iki durum var:
  - C > 0 ise o ayın ödemesi **0**'dır (devreden varsa ödeme yoktur), satırda “Beyannamede devreden …” yazar.
  - C = 0 ise A devredensiz hesaplanır (giriş 0).
  - Kesin K her durumda kazanır.

### 2.5 Yuvarlama (kesin kural)

- `round100(x) = sign(x) × floor(|x| ÷ 100 + 0,5) × 100`; −0 → 0.
- Yuvarlanan bileşenler: kasa KDV'si, online KDV'si, alış KDV'si ve muhasebeci tutarı C.
  - `satış = kasa + online` (yuvarlı toplamı).
  - `net`, `ödenecek` ve `devreden` bunlardan çıkar, dolayısıyla hep 100'ün katıdır.
- Gösterim:
  - Tahminler `≈ ` ön ekiyle `tl()` kullanır (tam lira).
  - Hatırlatıcıdaki kesin tutar ve muhasebecinin C'si `money()` ile, olduğu gibi yazılır.
  - Gösterilen ciro: biten ayda `tl(R)`, tamamlanan ayda `≈ tl(round100(R × çarpan))`.
- Ara hesaplar (çarpanlar, oranlar) yuvarlanmaz.

### 2.6 Excel verisiyle (testlerdeki ve yerel DB'deki veri; bugün 2026-10-22)

| Ay | Kasa KDV'si (ham → yuvarlı) | Alış KDV'si (ham → yuvarlı, fatura) | Devreden giriş | Net | Ödenecek | Devreden çıkış |
|---|---|---|---|---|---|---|
| 2026-07 | 15.780,64 → 15.800 | 225.273,18 → 225.300 (16) | 0 | −209.500 | 0 | 209.500 |
| 2026-08 | 45.454,55 → 45.500 | 3.536,09 → 3.500 (19) | 209.500 | −167.500 | 0 | 167.500 |
| 2026-09 | 39.218,76 → 39.200 (karaoke 2.050 ₺ %20) | 11.875,67 → 11.900 (30) | 167.500 | −140.200 | 0 | 140.200 |
| 2026-10 (süren, 16 gün → 31) | 26.719 × 31/16 = 51.768,06 → 51.800 (ciro ≈ 569.400) | 9.741,74 → 9.700 (16) | 140.200 | −98.100 | 0 | 98.100 |

Sonuçlar:
- **Muhasebeci kaydı yokken** iki satır da “Ödeme beklenmez” der: 28 Eki (Eylül) ve 28 Kas (Ekim).
- **Devredensiz** (muhasebeci kaydı `{2026-08, 0}` ya da Eylül hatırlatıcısına 27.300 yazılmış): 28 Eki **≈ 27.300 ₺**,
  28 Kas **≈ 42.100 ₺**.
- Bu iki sonucun arasındaki fark, sahibe sorulacak 1. sorudur (§12).

---

## 3. Plana yerleşme (insight `buildCashPlan` ekleri)

insight §2.4'teki hatırlatıcı **sınıflandırmasına** bir sınıf eklenir. Sıra:

1. Sabit gider adı eşleşmesi.
2. `maas` → maaş, `sgk` → SGK.
3. **`isVatReminder(r)` → KDV.**
4. Diğer.

KDV sınıfındaki hatırlatıcılar insight'ın genel “tutar > 0 ise bütün dönemler kesin” kuralından **çıkarılır** ve
aşağıdaki gibi işlenir:

```
vatRems = etkin KDV hatırlatıcıları, kimliğe göre artan
occs    = her r için reminderOccurrences(r, today, end); first = (o.due === r.dueDate); period = vatPeriodOf(o.due)
baseMode = vatRems.length ? "reminder" : "default"
mode     = excluded.includes("kdv") ? "excluded" : baseMode

reminder kipi:
  1. first && r.amount !== null olan her o: KESİN. amount > 0 ise insight'ın normal hatırlatıcı satırı
     (key "reminder:<id>@<date>", kind "reminder", estimated false; 0 ise satır yok). known[period] = amount; period sahiplenildi.
  2. Kalan her o (tarih, sonra kimlik sırasıyla):
     - period sahiplenilmemişse TAHMİN o.date gününe (overdue = o.overdue); period sahiplenilir.
     - sahiplenilmişse unknownAmounts'a (insight listesi; aynı aya ikinci KDV hatırlatıcısı).
default kipi (KDV hatırlatıcısı yok):
  vatDueDate(P) ∈ [bugün+1, end] olan her P için TAHMİN vatDueDate(P) gününe (insight “tahminler yarından” kuralı).
excluded kipi:
  Kesinler aynen yazılır. Tahminlerin yerleşimi baseMode'a göre hesaplanır, plana YAZILMAZ, karta “katılmıyor” diye
  gider. Tutarsız KDV dönemleri unknownAmounts'a girer.

periods   = TAHMİN yerleşimlerinin dönemleri (artan, tekil)
estimates = vatEstimates({ today, months, firstSalesMonth, anchor, known, periods })
TAHMİN satırı (excluded değilse, e.status === "ok" ve e.payable > 0 ise):
  { key: `kdv@${date}`, kind: "kdv", direction: "out", title: `KDV (${MONTH_NAMES[ay]})`, date, amount: e.payable,
    estimated: true, overdue, detail: vatLineDetail(e), href: "#kdv" }
e.status === "noData" ise satır yok; reminder kipinde o oluşum unknownAmounts'a girer (bugünkü davranış).
```

- KDV hatırlatıcısı tutarsızsa ve tahmini yapılmışsa “Tutarı girilmemiş ödemeler”de **görünmez**, tahmini 0 olsa bile.
- Sahibin ödendi demediği gecikmiş KDV hatırlatıcısı gün 0'a “Gecikmiş” olarak düşer (insight kuralı).
- Tahmin satırı haftanın “Tahmini” grubundadır (gri “tahmini” rozeti; insight'ın satır çizimi değişmez). `firstNegative`,
  `requiredCash`, karolar ve Genel bakış kartı onu kendiliğinden sayar.
- Bilinen sınır: KDV hatırlatıcısı yokken sahip KDV'yi erken ödediyse tahmin 28'inde yine görünür (insight'ın maaş
  varsayılanıyla aynı). Tek seferlik KDV hatırlatıcısı ödenince kapanır, o ayın tahmini varsayılan güne döner. Kartın
  önerisi aylık şablondur.

---

## 4. Kullanıcının göreceği (Türkçe metinler kesin)

### 4.1 Nakit planı › “KDV tahmini” kartı (`/panel/hatirlaticilar/nakit`, yalnız yönetici)

**Yer ve görünürlük**
- Yan sütunun ilk kartıdır, insight'ın “Nasıl hesaplandı” kartının üstünde. Telefonda haftaların hemen altındadır.
- `id="kdv"` ve `scroll-mt-20` alır.
- Kart yalnız `plan.vat === null` ise görünmez: hiç satış verisi yoksa **ve** KDV hatırlatıcısı da yoksa.

**Başlık**
- `CardHeader`: ikon `Receipt`, başlık “KDV tahmini”, açıklama “Satışların KDV'si eksi alışların KDV'si”.
- `meta`: excluded kipinde gri rozet “Plana katılmıyor”.

**Satırlar.** Her dönem bir `<li>` olur, tarih sırasıyla. Satırın tamamı bir aç/kapa düğmesidir (`aria-expanded`,
`aria-controls`, en az 44 px):
- Solda `DateTile` (`hatirlaticilar/payment-ui`, `size="sm"`). Gecikmişte asıl vade ve kırmızı “Gecikmiş” rozeti.
- Ortada başlık: “Eylül KDV'si” / “Ekim KDV'si” (`vatPeriodTitle`).
- Sağda tutar:

| Durum | Sağdaki metin |
|---|---|
| tahmin, ödenecek > 0 | “≈ 42.100 ₺” (`font-semibold tabular-nums`) |
| tahmin, ödenecek 0 | “Ödeme beklenmez” (`text-good`) |
| Ödemeler'deki tutar > 0 | “27.200 ₺” ve altında küçük rozet “Ödemeler'de” |
| Ödemeler'deki tutar 0 | “Ödeme yok” |
| hesaplanamadı | “Hesaplanamadı” (`text-ink-mute`) |
| excluded kipi | aynı metinler `text-ink-mute` |

- Başlığın altında tek alt satır (`text-xs text-ink-mute`, `vatSubText`):

| Durum | Metin |
|---|---|
| ödenecek > 0, devreden yok | “Satışlar ≈ 51.800 ₺ − alışlar ≈ 9.700 ₺” |
| ödenecek > 0, devreden var | “Satışlar ≈ 39.200 ₺ − alışlar ≈ 11.900 ₺ − devreden ≈ 5.000 ₺” |
| 0, devreden karşıladı | “Devreden KDV karşılıyor · ≈ 98.100 ₺ sonraki aya geçer” |
| 0, alış fazla | “Alışların KDV'si fazla · ≈ 3.200 ₺ sonraki aya geçer” (devreden 0 ise “Satış ve alış KDV'si denk”) |
| muhasebeci kaydı (C > 0) | “Beyannamede devreden 140.000 ₺” |
| Ödemeler'deki tutar | “Ödemeler'deki tutar · tahmin ≈ 25.900 ₺” (tahmin yoksa yalnız “Ödemeler'deki tutar”) |
| hesaplanamadı | “Bu ayın satış verisi yok” |

- Süren ayın tahmininde ikinci alt satır: “Ekim bitmedi: 16 günün satışıyla tahmin”. Açık gün yoksa “Ekim bitmedi: ay
  sonuna tamamlandı”.

**Döküm** (satır açılınca, `dl`; her satır sol etiket ve sağ tutar; tahmin değilse yalnız tutar satırları):
1. “Satışların KDV'si” **≈ 51.800 ₺**. Altında:
   - “Kasa (ModPOS) cirosu ≈ 569.400 ₺ (16 günden ay sonuna) · %10”. Biten ayda: “Kasa (ModPOS) cirosu 429.698 ₺ · %10,
     karaoke 2.050 ₺ %20”. Yedekle: “Ekim cirosu yok: Eylül'ün günlük ortalamasıyla”.
   - Site bağlıysa “laffogato.net online ≈ 1.200 ₺” ya da “laffogato.net: bu ay çekilmedi”.
2. “Alış faturalarının KDV'si” **− ≈ 9.700 ₺**. Altında “16 fatura”. Süren ayda “, bugüne kadar gelenler” eklenir. Kafe
   dışı fatura varsa “ · Karaoke box ve Alp Koç faturaları sayılmadı”.
3. Yalnız devreden girişi > 0 ise: “Önceki aylardan devreden” **− ≈ 140.200 ₺**.
4. Son satır (koyu): “Ödenecek” **≈ 42.100 ₺**, ya da “Sonraki aya devreden” **≈ 98.100 ₺**.

**Kart altı** (`border-t`, `text-xs text-ink-mute`, `space-y-2`):
- Her zaman: “Tahmin; kesin tutar muhasebecinizin beyannamesindedir.”
- KDV hatırlatıcısına göre:
  - Hatırlatıcı var: “Muhasebeciniz tutarı söyleyince Ödemeler'deki KDV hatırlatıcısına yazın; plan onu kullanır.”
  - Hatırlatıcı yok: “Ödemeler'de KDV hatırlatıcısı yok; tahmin ayın 28'ine yazıldı.” Yanında `ButtonLink` (ikincil, sm)
    “Hatırlatıcı ekle” → `/panel/hatirlaticilar` (şablonlar orada; insight'ın kesilen `?ekle=` parametresi yok).
- Devreden satırı, yalnız bir satırın devreden girişi > 0 ise ya da muhasebeci kaydı varsa:
  - Kayıt var: “Devreden KDV: Eylül 2026 beyannamesinden 140.000 ₺.”
  - Kayıt yok: “Devreden KDV panelin verisiyle hesaplandı (başlangıç: Temmuz 2026).”
- Hayalet küçük düğme: “Devreden KDV'yi gir”. Kayıt varsa “Devreden KDV'yi düzelt”. §4.2 penceresini açar.

**Veri yok** (`rows` var ama hepsi `noData`, ya da KDV hatırlatıcısı var ama satış verisi hiç yok): gövde tek paragraf
olur, “Satış verisi yok; KDV tahmin edilemedi. Satışlar'a ayın cirosunu ya da kasa raporu girin.” Yanında `ButtonLink`
“Satışlara git” → `/panel/satislar`.

**Telefon (390 px):** satır üç sütunludur (tarih karosu · başlık + alt satır · tutar). Tutar `shrink-0` ve sağa
yaslıdır. Alt satır sarılır. Döküm tam genişliktedir. Kart altı düğmeleri `flex flex-wrap gap-2` ile dizilir. Yatay
kaydırma yoktur.

### 4.2 “Devreden KDV” penceresi (`ui/dialog`)

- Başlık “Devreden KDV”. Açıklama: “Muhasebecinizin son KDV beyannamesinde “sonraki döneme devreden KDV” yazan tutar.
  Tahmin bu tutardan devam eder.”
- Alan “Hangi ayın beyannamesi?” (`Select`):
  - Seçenekler: son üç bitmiş ay (“Eylül 2026”, “Ağustos 2026”, “Temmuz 2026”). Kayıtlı ay bunların dışındaysa o da
    eklenir.
  - Varsayılan kayıtlı ay. Kayıt yoksa bugünün günü ≥ 20 ise geçen ay, değilse ondan önceki ay.
- Alan “Devreden tutar (₺)” (`NumberInput`, `parseNumberTR`). İpucu “Devreden yoksa 0 yazın”. Hatalar: boşsa “Tutar
  girin (0 olabilir)”, eksiyse “Tutar eksi olamaz”.
- Düğmeler: “Kaydet”, “Vazgeç”, kayıt varsa “Kaldır” (hayalet; `null` kaydeder).
- Toast:
  - kaydedince “Devreden KDV kaydedildi: 140.000 ₺ (Eylül 2026)”;
  - kaldırınca “Devreden KDV kaldırıldı; panelin hesabı kullanılıyor”.

### 4.3 Haftalar listesindeki satır

- Başlık “KDV (Ekim)”, gri “tahmini” rozeti, tutar, ⓘ metni `vatLineDetail`: “Satışlar ≈ 51.800 ₺ − alışlar ≈ 9.700 ₺.
  Ekim bitmedi, ay sonuna tamamlandı. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.” Ay bitmişse ikinci cümle
  yoktur.
- `href: "#kdv"` aynı sayfadaki karta götürür.
- Kesin KDV hatırlatıcısı insight'ın normal hatırlatıcı satırıdır (değişmez).

### 4.4 “Nasıl hesaplandı” kartı: tek satır (`planNotes`, anahtar `kdv`, başlık “KDV”)

| Kip | Metin |
|---|---|
| default | “Önceki ayın satış KDV'si (kafe %10, karaoke %20, laffogato.net) eksi alış faturalarının KDV'si, ayın 28'inde; eksi çıkarsa ödeme beklenmez, fark sonraki aya devreder. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.” |
| reminder | “Önceki ayın satış KDV'si (…) eksi alış faturalarının KDV'si, KDV hatırlatıcısının gününde; hatırlatıcıya tutar yazarsanız o geçerli. Tahmin; kesin tutar muhasebecinizin beyannamesindedir.” |
| excluded | “KDV tahmini plana katılmıyor (Tahmine katılanlar'dan açın).” |
| veri yok | “Satış verisi olmadığı için KDV tahmin edilemedi.” |

- Parantezdeki oranlar Ayarlar'dan gelir (`%${num(kdv*100,1)}`).
- “karaoke %20” yalnız `kdvHizmet ≠ kdv` ise yazılır, “laffogato.net” yalnız site kaydı varsa.
- insight'ın “Dahil değil” notu değişir: “Tutarı girilmemiş vergiler (muhtasar, geçici vergi vb.), Aylık harcamalar'daki
  fatura dışı ödemeler, yıllık giderler (ModPOS / Patron aboneliği), yatırım ve kredi.” “KDV” buradan çıkar.

### 4.5 “Tahmine katılanlar” (insight `estimates-sheet.tsx`, `EstimateRow` üzerinden; bileşen değişmez)

Yeni satır `{ key: "kdv", title: "KDV tahmini", monthly, status, note }`:
- `monthly` son tahmin satırının ödenecek tutarıdır.
- `status`:
  - kapalıysa `"off"`;
  - bütün satırlar Ödemeler'deki tutarsa `"covered"`;
  - diğer durumda `"on"`.
- Not:
  - default kipte “Ayın 28'inde · Ekim için ≈ 42.100 ₺”;
  - ödenecek 0 ise “Ayın 28'inde · Ekim için ödeme beklenmez”;
  - reminder kipinde “KDV hatırlatıcısının gününde · …”.

### 4.6 Ödemeler: KDV tutarı tek döneme aittir

- Tekrarlı bir KDV hatırlatıcısında (`vatAmountTravels`) **Ödendi**:
  - Sıradaki döneme geçerken tutar silinir.
  - Bildirim açıklaması: “Sıradaki tarih 28.11.2026; KDV tutarı her ay değiştiği için silindi. Sonra da Ödemeler › Son
    ödenenler'den geri alınabilir.”
  - İşlem geçmişine “ · tutar silindi (KDV)” eklenir.
  - Geri al (8 sn) ve Son ödenenler › Geri al tutarı geri yazar. Son ödenenler'den geri alırken tutar yalnız şu an
    boşsa yazılır, yeni yazılmış tutar ezilmez.
- Tekrarlı KDV hatırlatıcısı **Ertele** (1 hafta):
  - Tutar tek seferlik kopyada kalır (ertelenen dönemin tutarıdır), seriden silinir.
  - Geri al geri yazar.
  - Bildirim metni değişmez.
- Bugün ekranı `markReminderDone`'ı çağırıyorsa kural orada da geçerlidir. Dönüşteki `amountCleared` alanı ektir;
  onu okumayan çağıran bozulmaz.
- 24 Ekim 2026'dan beri KDV-2 (2 No.lu) serisi de aynı kurala tabidir (`vatAmountTravels` ⊇
  `isVatWithholdingReminder`): Ödendi ve Ertele tutarı seriden siler, plan yazılı tutarı yalnız kayıtlı gününde kullanır.

### 4.7 Yardım (`src/app/panel/yardim/page.tsx`, “Gider, ödeme ve ekip” grubu, insight'ın nakit planı sorusundan sonra)

```tsx
{
  id: "kdv-tahmini",
  q: "Bu ay ne kadar KDV ödeyeceğim?",
  a: (
    <>
      Nakit planındaki KDV tahmini kartı, önceki ayın satışlarındaki KDV'den (kafe %10, karaoke %20, laffogato.net) alış
      faturalarındaki KDV'yi düşer; sonuç ayın 28'inde plana girer. Eksi çıkarsa ödeme beklenmez, fark sonraki aya
      devreder. Bu bir tahmindir; kesin tutar muhasebecinizin beyannamesindedir. Muhasebeciniz tutarı söyleyince{" "}
      <Path href="/panel/hatirlaticilar" /> ekranındaki KDV hatırlatıcısına yazın, plan onu kullanır; ödendi deyince
      tutar silinir, çünkü her ay farklıdır.
    </>
  ),
  icon: Percent,
  links: [{ href: "/panel/hatirlaticilar/nakit#kdv", label: "KDV tahmini" }],
},
```

`tests/yardim.test.ts`'in kuralları sağlanır. `<Path>`'ten önceki satır `{" "}` ile biter. Bağlantının sayfası var
(`#` kesilir). Nakit planı `NAV_TREE`'de olmadığı için `<Path>` kullanılmaz.

---

## 5. Veri modeli

Tablo ya da sütun eklenmez. insight'ın `integration_state` anahtarı `cashflow.plan` (`CashPlanState`) tek alan kazanır:

```ts
interface CashPlanState {
  …insight alanları (balance, balanceDate, balanceBy, excluded)
  /** Muhasebecinin son beyannamesindeki “sonraki döneme devreden KDV” (yoksa null) */
  vatCarry: { month: string; amount: number; date: string; by: string } | null;
}
```

- `loadCashPlanState()` bozuk ya da eksik `vatCarry`'yi `null` okur:
  - `month` `/^\d{4}-(0[1-9]|1[0-2])$/` değilse ya da `amount` sonlu ve ≥ 0 değilse `null` olur.
- `excluded` anahtarlarına `"kdv"` eklenir.
- `db:reset` `cashflow.plan`'ı siliyor (CRITIQUE R7), muhasebeci kaydı da gider. Sahip yeniden girer; README'ye satır
  eklenmez.
- Yedek (ops) `integration_state`'i zaten kapsar (R6).

---

## 6. Saf mantık

### 6.1 Yeni `src/lib/kdv.ts` (sunucu bağımlılığı yok; `Model` yalnız tip olarak)

```ts
import type { Model } from "@/lib/calc/engine";
import type { Invoice } from "@/lib/calc/types";

export const VAT_DUE_DAY = 28;
export const VAT_CHAIN_MAX_MONTHS = 24;
export const VAT_DISCLAIMER = "Tahmin; kesin tutar muhasebecinizin beyannamesindedir.";

export function round100(x: number): number;                       // §2.5
export function vatDueDate(period: string): string;                 // "2026-10" → "2026-11-28"
export function vatPeriodOf(due: string): string;                   // §2.1 (1–7'si iki ay önce)
export function vatPeriodTitle(period: string): string;             // "Ekim KDV'si" (MONTH_NAMES)
export function posVat(revenue: number, serviceRevenue: number, kdv: number, kdvHizmet: number): number;
export function purchaseVat(inv: Pick<Invoice, "amount" | "discount" | "payable">): number;

export interface VatMonthInput {
  month: string;                                    // YYYY-MM
  pos: { revenue: number; vat: number; openDays: number | null; serviceRevenue: number } | null;   // ciro yoksa null
  online: { vat: number; closed: boolean; pulledOn: string } | null;                              // site kaydı yoksa null
  purchases: { vat: number; count: number; separateCount: number };
}
/** Excel / DB modelinden: [max(ilk satış ayı, bu ay − 24) … bu ay] (cirosu, site kaydı ya da faturası olan aylar) */
export function vatMonthInputs(model: Model, today: string): { months: VatMonthInput[]; firstSalesMonth: string | null; hasSite: boolean };

export interface VatEstimate {
  period: string;
  status: "ok" | "noData";
  pos: number; online: number; sales: number; purchases: number;          // 100'e yuvarlı
  carryIn: number; net: number; payable: number; carryOut: number;        // 100'ün katı (known hariç)
  known: number | null;                                                   // Ödemeler'deki kesin tutar
  anchored: boolean;                                                      // muhasebeci kaydı ödemeyi 0 yaptı
  projected: boolean;                                                     // ciro aya tamamlandı (süren ay ya da yedek)
  basis: {
    posRevenue: number | null;   // hesaba giren KDV dahil kasa cirosu (çarpanlı)
    openDays: number | null; serviceRevenue: number;
    posFrom: string | null;      // yedek ay
    online: "ok" | "missing" | "none";
    invoices: number; separate: number;
    inProgress: boolean;
  };
}
export interface VatInput {
  today: string;
  months: readonly VatMonthInput[];
  firstSalesMonth: string | null;
  anchor: { month: string; amount: number } | null;
  known: ReadonlyMap<string, number>;
  periods: readonly string[];          // artan
}
export function vatEstimates(input: VatInput): Map<string, VatEstimate>;

export function vatSubText(e: VatEstimate, anchorAmount: number | null): string;   // §4.1 alt satır
export function vatLineDetail(e: VatEstimate): string;                             // §4.3
export function vatNote(mode: "default" | "reminder" | "excluded", ok: boolean, rates: { kdv: number; kdvHizmet: number }, hasSite: boolean): string;   // §4.4
```

`vatMonthInputs`:
- `st = model.settings`.
- `firstSalesMonth`: `posRevenue > 0` olan ilk `ds.months` ayı, yoksa `model.siteMonths[0]`, o da yoksa `null`.
- Ay döngüsü `pos` için:
  - `info = model.monthInfo.get(m)`;
  - `R = info?.posRevenue`;
  - `R > 0` ise `S = Math.min(Math.max(R, 0), model.monthSales(m).serviceRevenue)` ve
    `pos = { revenue: R, vat: posVat(R, S, st.kdv, st.kdvHizmet), openDays: info.openDays, serviceRevenue: S }`.
- `online`:
  - `rec = model.siteSales(m)`;
  - `{ vat: siteVat(rec, st.kdv, st.kdvHizmet), closed: rec.closed, pulledOn: todayTR(new Date(rec.pulledAt)) }`.
- `purchases`: `model.invoicesByMonth.get(m) ?? []`; `SEPARATE_CATEGORIES`'teki faturalar sayılır ama toplama
  girmez (`separateCount`).
- `hasSite = model.siteMonths.length > 0`.

`vatEstimates` (sözde kod):

```
start = anchor ? shiftMonth(anchor.month, 1) : firstSalesMonth
if (!periods.length) return empty
if (!start) → her p için noData
for p of periods where p < start: out[p] = month(p, carryIn 0)          // yalnız muhasebeci kaydıyla olur
carry = anchor ? round100(anchor.amount) : 0
for m = start … max(periods): e = month(m, carry); carry = e.status === "ok" ? e.carryOut : carry; periods ∋ m ise out[m] = e

month(m, carryIn):
  inp = byMonth[m]; dim = daysInMonth(m); cur = today.slice(0,7)
  POS: inp?.pos → f = m === cur ? (openDays > 0 && openDays < dim ? dim/openDays : !openDays ? dim/max(1, day(today)−1) : 1) : 1
                  posRaw = pos.vat × f
       değilse m ≥ firstSalesMonth ve m'den önceki son {pos, openDays>0} ay fb varsa → posRaw = fb.vat / fb.openDays × dim, posFrom = fb.month
  ONLINE: inp?.online → f = (m === cur && !closed && pulledOn.slice(0,7) === m) ? dim / max(1, day(pulledOn) − 1) : 1
  posRaw yok ve online yok:
    m < firstSalesMonth → satış 0, status "ok" (açılış öncesi alışlar devredene girer)
    değilse status "noData" (payable/carryOut hesaplanmaz, carry geçer)
  pos = round100(posRaw ?? 0); online = round100(onlineRaw); sales = pos + online; purchases = round100(inp?.purchases.vat ?? 0)
  net = sales − purchases − carryIn
  K = known.get(m)
  anchored = anchor?.month === m && anchor.amount > 0 && K === undefined
  payable = K ?? (anchored ? 0 : max(0, net))
  carryOut = K !== undefined && K > 0 ? 0 : max(0, −net)
```

### 6.2 `src/lib/site-sales/calc.ts` (ek)

```ts
/** Ayın online satışındaki KDV (TL): net − KDV hariç; kafe ve mağaza satış oranıyla, karaoke hizmet oranıyla */
export function siteVat(s: Pick<SiteSales, "cafe" | "shop" | "karaoke">, kdvRate: number, serviceRate = kdvRate): number {
  return (s.cafe.netMinor + s.shop.netMinor + s.karaoke.netMinor) / 100 - siteRevenue(s, kdvRate, serviceRate).total;
}
```

### 6.3 `src/lib/reminders.ts` (ek)

```ts
/** KDV ödemesi hatırlatıcısı: başlıkta “KDV” ya da “katma değer”; kira / maaş türü ve SGK başlıkları hariç */
export function isVatReminder(r: Pick<ReminderRow, "kind" | "title">): boolean;
//   r.kind !== "kira" && r.kind !== "maas" && reminderCategory(r.kind, r.title) !== "sgk"
//     && /(^|[^a-z])kdv([^a-z]|$)|katma deger/.test(foldTR(r.title))      // foldTR aynı dosyada (dışa açılmaz)
/** Tekrarlı KDV hatırlatıcısının tutarı o döneme aittir: ödendi / ertelemede seriden silinir */
export function vatAmountTravels(r: Pick<ReminderRow, "kind" | "title" | "amount" | "repeat">): boolean;
//   r.repeat !== "none" && r.amount !== null && isVatReminder(r)
```

### 6.4 insight `src/lib/cash-plan.ts` ekleri (adlar insight §2.4'tekilerle aynı)

- `PlanKind`'e `"kdv"`.
- `CashPlanInput`:
  - `settings` alanına `kdv`, `kdvHizmet`;
  - yeni `vat: { months: VatMonthInput[]; firstSalesMonth: string | null; hasSite: boolean }`;
  - yeni `vatAnchor: { month: string; amount: number } | null`.
- `planInputFromModel(model, today)`:
  - dönüş tipine `"vat"` eklenir (`vatMonthInputs(model, today)`);
  - `settings`'e `kdv`, `kdvHizmet` girer.
- `CashPlan.vat: CashPlanVat | null`:

```ts
export interface VatRow {
  key: string;                    // "kdv@2026-11-28" | "reminder:4@2026-10-28"
  period: string; date: string; overdue: boolean;
  source: "estimate" | "reminder";
  amount: number | null;          // plana giren (excluded'da gösterilen); null = hesaplanamadı
  estimate: VatEstimate | null;
  reminderId: number | null;
}
export interface CashPlanVat {
  mode: "default" | "reminder" | "excluded";
  rows: VatRow[];                 // tarih sırasıyla
  anchor: { month: string; amount: number } | null;
  chainFrom: string | null;       // anchor yokken firstSalesMonth
  rates: { kdv: number; kdvHizmet: number };
  hasSite: boolean;
}
```

`vat` `null` olur: `vat.months` boş **ve** etkin KDV hatırlatıcısı yoksa. Ayrıca:
- `estimates` dizisine §4.5 satırı eklenir;
- `planNotes`'a §4.4 satırı (`vatNote`) eklenir;
- “Dahil değil” metni değişir.

---

## 7. Sunucu

**insight `src/server/data/cash-plan.ts`:**
- `loadCashPlanState()` `vatCarry`'yi okur (§5).
- `loadCashPlan(model, upcoming?)` `buildCashPlan`'a `vatAnchor: state.vatCarry ? { month, amount } : null` geçer. `vat`
  `planInputFromModel`'den gelir.
- Ek sorgu yok: aylar, faturalar ve site kayıtları zaten `model`'de.

**insight `src/server/actions/cash-plan.ts`:**
- `saveCashPlanExcluded`'ın regex'i `/^(sales|online|salary|sgk|goods|kdv|fixed:\d+)$/` olur.
- Yeni `saveVatCarry(input: { month: string; amount: number } | null)` (`requireAdmin`, zod, `attempt`; insight'ın
  `transaction` + `for("update")` oku-değiştir-yaz kalıbı):
  - `month`: `z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)` ve `[shiftMonth(bu ay, −12), shiftMonth(bu ay, −1)]`
    aralığında; değilse `UserError("Beyanname ayı son 12 aydan biri olmalı")`.
  - `amount`: `zMoney.min(0, "Tutar eksi olamaz").max(100_000_000)`, `Math.round(x × 100) / 100`.
  - Yazılır: `vatCarry = { month, amount, date: todayTR(), by: me.name }` ya da `null`. Diğer alanlar korunur.
  - İşlem geçmişi: başlık “Nakit planı: devreden KDV”, açıklama “Eylül 2026 beyannamesi · 140.000 ₺” ya da “kaldırıldı”.
  - `refresh()`, dönüş `null`.

**`src/server/actions/reminders.ts`:**
- `snapshot(r)` → `{ …, amount: r.amount }`. `snapshotSchema` → `amount: z.number().finite().min(0).nullable().optional()`.
- `markReminderDone`:
  - `const clear = next !== null && vatAmountTravels(r)`;
  - güncellemeye `...(clear ? { amount: null } : {})`;
  - işlem geçmişine `clear ? " · tutar silindi (KDV)" : ""`;
  - dönüş `{ next, prev, amountCleared: clear }`.
- `postponeReminder`, tekrarlı dal: seri güncellemesine `...(vatAmountTravels(r) ? { amount: null } : {})`. Kopyanın
  `amount: r.amount`'u aynen kalır.
- `restoreReminder`: `snap.amount !== undefined` ise `amount: snap.amount` yazılır.
- `undoRecentPaid`: `prev.amount` `null` ya da sonlu ve ≥ 0 bir sayıysa **ve** `cur.amount === null` ise `amount:
  prev.amount` yazılır. Ödendikten sonra yeni yazılmış tutar ezilmez.

**`src/lib/recent-paid.ts`:** `ReminderSnapshot`'a `amount?: number | null` (eski kayıtlarda yok). `parseRecentPaid`
değişmez.

**`src/app/panel/hatirlaticilar/payment-ui.tsx`:** Ödendi bildiriminin açıklamasına `amountCleared` ise “KDV tutarı her ay
değiştiği için silindi. ” eklenir (§4.6).

---

## 8. Dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/lib/kdv.ts` | **yeni**: §6.1 |
| `src/lib/site-sales/calc.ts` | `siteVat` |
| `src/lib/reminders.ts` | `isVatReminder`, `vatAmountTravels` |
| `src/lib/recent-paid.ts` | `ReminderSnapshot.amount?` |
| `src/lib/cash-plan.ts` (insight) | §3 ve §6.4: KDV sınıfı, yerleşim, `CashPlan.vat`, `EstimateRow`, `planNotes`, “Dahil değil” metni, `planInputFromModel` |
| `src/server/data/cash-plan.ts` (insight) | `vatCarry` okuma, `vatAnchor` geçişi |
| `src/server/actions/cash-plan.ts` (insight) | `saveVatCarry`, `excluded` regex'i |
| `src/server/actions/reminders.ts` | snapshot tutarı, Ödendi / Ertele'de silme, geri alma |
| `src/app/panel/hatirlaticilar/payment-ui.tsx` | Ödendi bildiriminde tek cümle |
| `src/app/panel/hatirlaticilar/nakit/vat-card.tsx` | **yeni** (`"use client"`): kart, satırlar, döküm, kart altı (§4.1) |
| `src/app/panel/hatirlaticilar/nakit/vat-carry-dialog.tsx` | **yeni** (`"use client"`): §4.2 |
| `src/app/panel/hatirlaticilar/nakit/cash-plan-client.tsx` (insight) | yan sütunun başına `<VatCard vat={plan.vat} carry={state.vatCarry} today={plan.today} />` |
| `src/app/panel/yardim/page.tsx` | §4.7 SSS |
| `tests/kdv-tahmini.test.ts` | **yeni**: §9 |
| `tests/nakit-plani.test.ts` (insight) | §9-B vakaları |
| `tests/reminders.test.ts` | `isVatReminder`, `vatAmountTravels` |
| `docs/NAKIT-PLANI.md` (insight) | §10 bölümü |
| `README.md` | Nakit planı satırına “KDV tahmini dahil” |

Dokunulmayanlar:
- `schema.ts`, `nav.ts`, zil, e-posta, Genel bakış (insight'ın kartı plan toplamlarını okur);
- `estimates-sheet.tsx` (`EstimateRow`'u genel çizer);
- `engine.ts` (yalnız okunur).

---

## 9. Testler

**A. `tests/kdv-tahmini.test.ts`.** Excel verisi `excelToDataset(excel-data.json)` ile, `createModel({ ...ds, currentMonth:
"2026-10" })`, bugün `2026-10-22`. Kalıp `tests/price-impact.test.ts`.

1. `round100`:
   - 149,99 → 100; 150 → 200; −150 → −200; −149 → −100; 0 ve −0 → 0;
   - 15.780,64 → 15.800; 11.875,67 → 11.900.
2. `vatDueDate` ve `vatPeriodOf`:
   - `vatDueDate`: “2026-10” → “2026-11-28”; “2026-12” → “2027-01-28”.
   - `vatPeriodOf`: “2026-11-28” → “2026-10”; “2026-11-26” → “2026-10”; “2026-11-04” → “2026-09”;
     “2027-01-05” → “2026-11”; “2026-11-08” → “2026-10”.
3. `posVat` eylülde (`R` 429.698, `S` 2.050) 39.218,76 verir ve `R − model.pnlMonth("2026-09").revenueNet`'e eşittir
   (1e-6). `S = 0` iken `R × 0,1/1,1`.
4. `purchaseVat`:
   - normal fatura → `payable − (amount − discount)`;
   - iade (`amount` eksi, `payable` eksi) → eksi;
   - tevkifatlı Paraşüt taslağı (`mapping.ts`'in 2. dalı) → `vat − withholding`;
   - Excel faturasında `vat` 0 olsa da KDV hesaplanır.
5. `siteVat`:
   - oranı bilinen ve bilinmeyen satışlı kayıt: `Σ netMinor/100 − siteRevenue(...).total`;
   - karaoke hizmet oranıyla;
   - `manual` sayılmaz.
6. `vatMonthInputs` (Excel):
   - `firstSalesMonth` = “2026-07”; aylar 07–10;
   - Ekim `pos.vat` ≈ 26.719, `openDays` 16;
   - Eylül `serviceRevenue` 2.050; Eylül alışları 30 fatura, ≈ 11.875,67;
   - `hasSite` false.
7. `vatEstimates` (Excel, `periods` ["2026-09","2026-10"]):
   - otomatik zincir §2.6 tablosuyla birebir: Eylül carryIn 167.500, net −140.200, payable 0; Ekim pos 51.800,
     projected true, posRevenue ≈ 569.448,69, purchases 9.700, carryIn 140.200, payable 0, carryOut 98.100;
   - `anchor {2026-08, 0}` → Eylül payable 27.300, Ekim payable 42.100;
   - `anchor {2026-09, 140.000}` → Eylül payable 0, anchored true; Ekim carryIn 140.000, carryOut 97.900;
   - `known {2026-09 → 27.200}` (anchor yok) → Eylül payable 27.200, carryOut 0; Ekim payable 42.100;
   - `known {2026-09 → 0}` → Eylül payable 0, Ekim carryIn 140.200.
8. Yuvarlama: her `e` için `sales − purchases − carryIn === net` ve bütün tutarlar 100'ün katı.
9. Süren ay:
   - açık gün yoksa çarpan `ayın gün sayısı ÷ (bugünün günü − 1)`;
   - site kaydı `closed:false`, `pulledOn` 2026-10-22 → online çarpanı 31/21;
   - `closed:true` → çarpan 1.
10. Yedek: Kasım'ın cirosu yok, bugün 2026-11-20 → Ekim'in `vat ÷ 16 × 30`'u, `posFrom` “2026-10”. İlk satış
    ayından önceki ayda satış 0 olur, faturası devredene girer.
11. Hiç ciro ve site yoksa: her dönem `noData`. `noData` ay zinciri bozmaz (devreden geçer).
12. Kafe dışı: Karaoke box faturası toplama girmez, `separateCount` 1.
13. Metinler: `vatSubText` §4.1 tablosundaki her durum; `vatLineDetail` biten ve süren ay; `vatNote` dört kip (oranlar
    Ayarlar'dan; `kdvHizmet = kdv` iken “karaoke” yok; `hasSite` false iken “laffogato.net” yok).

**B. `tests/nakit-plani.test.ts` (insight dosyası; yeni vakalar).** Bugün 2026-10-22, plan sonu 2026-12-02.

1. KDV hatırlatıcısı yok, `vatAnchor {2026-08, 0}`:
   - satır `kdv@2026-10-28` 27.300 (hafta 0, “Tahmini”) ve `kdv@2026-11-28` 42.100 (hafta 5);
   - `vat.mode` “default”, iki satır.
2. Bugün 2026-10-28 → 28 Eki yazılmaz (yarından kuralı), 28 Kas yazılır.
3. Otomatik zincir (Excel): `kind:"kdv"` satır yok; `vat.rows` iki satır, ikisi de `amount 0`.
4. Aylık tutarsız “KDV beyannamesi ve ödemesi” (vergi, 28 Eki):
   - tahminler hatırlatıcının günlerinde;
   - `unknownAmounts`'ta yok;
   - `vat.mode` “reminder”.
5. Aynı hatırlatıcıda tutar 27.200:
   - 28 Eki kesin hatırlatıcı satırı 27.200;
   - 28 Kas **tahmin** (27.200 değil): Eylül devredeni sıfırlandığı için 42.100;
   - tutar 0 → 28 Eki satır yok, kart satırı “Ödeme yok”.
6. Gecikmiş KDV hatırlatıcısı (due 2026-09-28) → gün 0'da Ağustos tahmini, `overdue`; ardından 28 Eki (Eylül).
7. 1 hafta ertelenmiş tek seferlik kopya (2026-11-04) Eylül'ü, seri (2026-11-28) Ekim'i sahiplenir. İkinci tutarsız KDV
   hatırlatıcısı aynı aya düşerse `unknownAmounts`'a gider.
8. `excluded: ["kdv"]` → `kind:"kdv"` satır yok; tutarsız KDV dönemleri `unknownAmounts`'ta; `vat.mode` “excluded”;
   `EstimateRow` “kdv” `"off"`.
9. Sınıf sırası:
   - “SGK prim ödemesi” SGK'dır, “Muhtasar ve prim hizmet beyannamesi” diğerdir;
   - sabit gider adıyla eşleşen “KDV …” sabit giderdir.
10. `planNotes` `kdv` satırı kipe göre (§4.4). “Dahil değil” metninde “KDV” geçmez.
11. `planInputFromModel` (Excel) `vat.firstSalesMonth` “2026-07” ve `settings.kdv` 0,1, `kdvHizmet` 0,2 döndürür.

**C. `tests/reminders.test.ts` (ek).**
- `isVatReminder`:
  - true: “KDV beyannamesi ve ödemesi” (vergi), “Kdv ödemesi” (odeme), “Eylül KDV'si”, “Katma değer vergisi”;
  - false: “Muhtasar ve prim hizmet beyannamesi”, “SGK prim ödemesi”, “Kira KDV'si” (kira türü), “Kadıköy kira”.
- `vatAmountTravels`: tek seferlikte false, tutarsızda false.
- Kaynak testi: `src/server/actions/reminders.ts` içinde `markReminderDone` ve `postponeReminder` `vatAmountTravels`'ı
  çağırır, `snapshot(` `amount`'ı içerir.

Çalıştırma: `npx tsx --test tests/*.test.ts`, `npm run lint`, `npx tsc --noEmit`.

---

## 10. Belgeler

**`docs/NAKIT-PLANI.md` (insight'ın yeni belgesi), “KDV tahmini” bölümü:**
- formül;
- §1 karar tablosunun kısaltması;
- satış kaynakları (kasa / karaoke / laffogato.net), süren ay ve yedek;
- alış KDV'si (`payable − net`, tevkifat, iade, kafe dışı);
- devreden zinciri, muhasebeci kaydı ve hatırlatıcı tutarı;
- yerleşim (§3);
- yuvarlama;
- dahil olmayanlar;
- hafta sonu notu (“28 Kasım 2026 Cumartesi; yasal son gün 30 Kasım, plan 28'ine yazar”);
- `cashflow.plan.vatCarry`;
- ModPOS günlük satış raporunun gelince karaoke payını kendiliğinden kesinleştireceği.

**`README.md`:** insight'ın “Nakit planı” ekran satırına “· KDV tahmini (önceki ayın satış KDV'si − alış KDV'si, ayın
28'inde)”.

**Yardım:** §4.7.

---

## 11. Kenar durumlar

- **Sahip Satışlar'da Ekim'i güncellemedi** (1–16 Ekim değeri ay bitince de duruyor): biten ay olarak olduğu gibi alınır
  ve tahmin düşük çıkar. Dökümde “Kasa (ModPOS) cirosu 293.909 ₺” yazar. Genel bakış'taki “Açık gün ve POS cirosu” görevi
  zaten uyarıyor. kasa planı Kasım'dan itibaren ciroyu Z raporlarından türetir.
- **Kasa raporundan türetilen süren ay** (kasa planı): açık gün = `zTotal > 0` olan gün. Kapalı günler ay sonu tahminini
  biraz şişirir (Genel bakış'la aynı), güvenli taraftır.
- **Geç gelen fatura** (Eylül tarihli, 3 Ekim'de geldi): Eylül'ün alışına girer, tahmin biraz iner. Muhasebeci başka aya
  kaydetmiş olabilir; fark tahmin kapsamındadır.
- **Eksi KDV'li ay** (iade ağırlıklı): alış KDV'si eksi olur, ödenecek artar. Doğrudur.
- **Site bağlı değil:** online 0, metinlerde “laffogato.net” yok.
- **Üç aylık KDV** desteklenmez: tahmin yalnız önceki ayı sayar (belgede tek cümle).
- **Rol:** ekran ve eylemler yalnız yönetici (`requireAdmin`; Nakit planı personele kapalı).
- **Hata:** `vatEstimates` saftır ve atmaz. Plan yüklenemezse insight'ın kuralları geçerlidir (Genel bakış kartı gizlenir,
  sayfa `error.tsx`).

---

## 12. Sahibin kararı (varsayılanla uygulanır, iş beklemez)

1. **Devreden KDV.** Panelin verisine göre Temmuz'daki açılış alımlarının KDV'si (≈ 225.000 ₺) hâlâ devrediyor: Ekim
   sonunda ≈ 98.100 ₺ kalıyor ve Ekim–Kasım'da KDV ödemesi beklenmiyor. Ayda ≈ 40.000 ₺ KDV'yle ilk ödeme 2027 başında.
   Muhasebecinizin söylediği farklıysa “Devreden KDV'yi gir” ile düzeltin. Varsayılan **otomatik**.
2. **Karaoke box (MaviBahçe) ve Alp Koç** aynı vergi numarasında, aynı KDV beyannamesinde mi? Varsayılan **hayır**: tahmin
   yalnız kafeyi sayar, onların faturaları düşülmez.
3. **laffogato.net satışları** kafenin beyannamesinde mi? Varsayılan **evet**.
4. **Ödeme günü** her ayın 28'i, hafta sonu kaydırmasız (para bir iki gün erken çıkmış görünür). Varsayılan **evet**.
5. **KDV hatırlatıcısında tutar** “Ödendi” deyince silinsin mi (her ay yeniden yazılır)? Varsayılan **evet**.

---

## 13. Uygulama sırası (insight §6'nın 5. ve 6. adımlarından sonra)

1. `src/lib/kdv.ts`, `siteVat`, `isVatReminder` / `vatAmountTravels` ve §9-A ile §9-C testleri.
2. `src/lib/cash-plan.ts` ekleri (§3, §6.4) ve §9-B testleri.
3. `cashflow.plan.vatCarry`, `saveVatCarry`, `excluded` regex'i, `loadCashPlan` geçişi.
4. `reminders.ts` eylemleri (silme ve geri alma) ve `payment-ui.tsx` cümlesi.
5. `vat-card.tsx`, `vat-carry-dialog.tsx`, `cash-plan-client.tsx`'e yerleştirme.
6. Yardım, `docs/NAKIT-PLANI.md`, README.
7. `npm run dev` ile kontrol:
   - Excel verisinde kart iki satır “Ödeme beklenmez” gösterir;
   - “Devreden KDV'yi gir” ile Ağustos 0 girilince 28 Eki ≈ 27.300 ₺ ve 28 Kas ≈ 42.100 ₺ plana girer, kart ve haftalar
     tutar;
   - Ödemeler'e KDV şablonu eklenince satırlar onun günlerine geçer;
   - tutar yazılıp “Ödendi” denince tutar silinir, Geri al geri getirir;
   - 390 px ve masaüstünde yatay kaydırma yok.

---

## 14. Riskler

- **Devreden yanlış olabilir.** Panelin faturaları muhasebecininkiyle aynı değilse (eksik fatura, indirilmeyen KDV) zincir
  sapar. Bunu üç şey hafifletir:
  - Rakam kartta açıkça yazılır.
  - Muhasebeci kaydı zinciri düzeltir.
  - Ödemeler'e yazılan ilk ödeme (K > 0) zinciri sıfırlar.
- **Tahmin kesin sanılabilir.** Her yüzeyde “≈”, “tahmini” rozeti ve aynı uyarı cümlesi bulunur.
- **Faturası panele gelmeyen giderler** (nakit alım, faturası Paraşüt'e düşmeyen sabit gider) alış KDV'sini düşük
  gösterir, ödenecek yüksek çıkar. Güvenli taraftır ve belgede yazılı.
- **Hatırlatıcı tutarının silinmesi** sahibi şaşırtabilir. Bildirim bunu söyler, geri al geri getirir.
- **Paylaşılan dosyalar:** `reminders.ts` eylemleri (bugün planı yalnız çağırıyor), `payment-ui.tsx` (insight dokunmuyor)
  ve insight'ın kendi dosyaları. Dokunuşlar yerel ve ekleyicidir.

## Ek: kasa KDV'si yazarkasa Z'sinden (26 Kasım 2026, Dalga 2)

Kasa satış KDV'si artık gün gün kaynağından: kasa raporunda yazarkasa Z'sinin KDV'si girilmiş gün Z'den, LafPOS'un
dökümü olan gün LafPOS'tan, kalanı bu plandaki oranlı hesapla (`posVatByDays`). Kaynak ekranda yazar ("12 gün yazarkasa
Z'sinden, 3 gün tahmin"). Bu yüzden §"Kasa (ModPOS) satış KDV'si" satırındaki "Gelir-gider'deki farkla aynı çıkar" yalnız
Z'si girilmemiş aylarda geçerlidir. Ayrıntı: [../NAKIT-PLANI.md](../NAKIT-PLANI.md) › Kasa KDV'sinin kaynağı.

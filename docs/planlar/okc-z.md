# Dalga 13: Kasa raporunda yazarkasa Z raporu (mali Z) ve doğru okuma

Grup: `okc-z`. Dallar: `claude/dalga-13a-okc-kapi`, `claude/dalga-13-okc-z`, (gerekirse) `claude/dalga-13c-okc-yakin`.
Tarih: 24 Ekim 2026. Durum: plan, eleştiri işlendi (sonda "Eleştiri kaydı"), henüz uygulanmadı.

**Teslim üç PR'dır (§1b):** PR-a hemen ve migration'sız (yanlış bölüm kapıları, başlıklar: A ve B yollarını kapatır);
PR-b yazarkasa Z'sinin kendi bölümü (şema, sütunlar, kimlikler, temkinli doldurma; tek okuma); PR-c farklı girdiyle
ikinci okuma (yakın görünüm), yalnız değerlendirme gerek gösterirse.

Sahibin isteği (olduğu gibi): *"Kasa raporu kısmında ModPOS'u ayrı ve banka POS Z raporunu ayrı ekliyoruz, ona göre bir
güncelleme yap o kısma; ve Z raporu okuyunca fotoğraftan yanlış okuyor, onu doğru okusun."*

Netleştirme (sahip, 24 Ekim): "banka POS Z raporu", yeni nesil ÖKC'nin (yazarkasa-POS) **mali Z raporudur**: Z NO, FİŞ
SAYISI, oran oran KDV dökümü, NAKİT / KREDİ satırları ve kümülatif toplamlar basar. Yanlış okumalar çoğunlukla bu
yazarkasa Z'sinde oluyor.

**Taban:** PR-a bugünkü `main` üstünde (dalga 10'a çakışması birkaç satır, §13). PR-b ve PR-c dalga 10
(`claude/dalga-10-personel`, `0038_personel_yetki`) birleştikten sonraki `main`. Dalga 10 aynı Kasa dosyalarını
değiştiriyor (geç rapor, düzeltme isteği, fotoğraf kaldırma isteği; yazım yolu `src/server/cash/`'e taşındı). PR-b'nin
saf çekirdeği ve değerlendirme düzeneği (§17 adım b1–b2) dalga 10'a dokunmadığı için `main` üstünde önceden
başlayabilir; eşgüdüm §13'te.

**Önce okunacaklar:**
- `AGENTS.md` (bu Next.js 16.4 eğitim verisindekinden farklıdır).
- `node_modules/next/dist/docs/01-app/`:
  - `03-api-reference/04-functions/refresh.md` (eylemden sonra `refresh()`);
  - `03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md` (fotoğraf yolları 60 sn);
  - `02-guides/server-actions.md`.
- `docs/KASA-RAPORU.md`, `docs/FOTOGRAF.md`, `docs/planlar/fotograf.md` (§10 canlı denemeler), `docs/planlar/kasa.md`,
  dalga 10'un `docs/planlar/personel-yetki.md`'si (§2.3, §2.6, §2.7).
- Araştırma notları: yazarkasa Z biçimi, kimlikler ve yanlış okuma tuzakları
  `docs/planlar/okc-z-notlar.md` (§2 düzen, §3 etiketler, §4 kimlikler, §5 tuzaklar, §6 banka gün sonu fişi).
  Uygulayıcı bunun özetini `docs/YAZARKASA-Z.md` olarak depoya koyar (§14).

**Kurallar:** `CRITIQUE.md` R1–R7 ve `KALAN-ISLER.md` §3 geçerlidir. Bu dalga:
- **tek migration** getirir, PR-b'de: `okc_z` (numarası birleştirmede R2 ile verildi: `0042_okc_z`, 26 Ekim).
  PR-a ve PR-c migration'sızdır. Elle SQL yok.
- **yeni bağımlılık, yeni cron, yeni Claude bağlantısı aracı getirmez.**
- Claude çağrısının biçimini yalnız yazarkasa Z'si için değiştirir (efor, süre, `max_tokens`); öteki okumalar aynen
  kalır (`tests/ai-istemci.test.ts` bunu sabitler).

---

## 0. İlkeler

1. **Model yalnız yazar; hesap ve denetim bizim kodumuzda.** Model her rakamı fişte yazıldığı gibi (`text`), okuduğu
   sayıyı (`value`) ve güvenini döner. Toplamlar, kimlikler (Σ oranlar = toplam, KDV formülü, kümülatif zinciri…), Z no
   sırası ve tarih saf kodda denetlenir. Modelden hiçbir zaman "toplamları tutturması" istenmez. Kimliklerin işe
   yaraması için okumanın **saf aktarım** olması gerekir: model soluk bir rakamı toplam tutsun diye aritmetikle
   "çözerse" kimlik tanım gereği tutar ve hiçbir şey yakalamaz. Bu yüzden efor, değerlendirmede "doğrulandı ama
   yanlış" sayısına bakılarak seçilir (§4.4) ve bir kimlik ancak **farklı basılı rakamları** karşılaştırıyorsa
   doğrular (§5.2).
2. **Denetimden geçemeyen rakam forma kendiliğinden yazılmaz.** Öneri olarak, nedeniyle birlikte gösterilir
   ("Fotoğraftakini yaz"). Personel fişe bakıp karar verir.
3. **Günlük ≠ kümülatif.** Kümülatif satırlar (KÜM., KÜMSAT, KÜMÜLATİF) okunur ama günün rakamı olarak hiçbir alana
   gitmez; yalnız denetim (zincir) ve sonraki ayların kapsamı için saklanır.
4. **ModPOS ile yazarkasa iki ayrı sayaçtır.** Ayrı alanlara yazılır, aynı adla karşılaştırılmaz, birinin değeri
   ötekinin alanına "Fotoğrafta …" diye önerilmez. Aralarındaki fark kendiliğinden hata değildir (online, faturalı
   satış, Z'nin alındığı saat; Eylül 2026'da ModPOS 429.698 ₺, beyannamedeki %10'luk satış ≈ 381.809 ₺,
   `docs/NAKIT-PLANI.md`).
5. **Eski raporlar olduğu gibi okunur.** `bank_pos` sütununun anlamı değişmez (banka gün sonu fişinin neti); eski
   `kasa-pos` fotoğrafları ve okumaları gösterilmeye devam eder.
6. **Personel maliyet görmez** kuralı değişmez. Yazarkasa Z'sinin rakamları satış ve vergi rakamıdır, maliyet değildir;
   personel yazdığını görür.
7. **Gerçek fotoğrafla ölçülmeden birleştirilmez.** Değerlendirme düzeneğinde (§10) gerçek yazarkasa Z fotoğraflarında
   **yanlış dolan alan sayısı 0** ve **"doğrulandı ama yanlış" sayısı 0** olmadan PR-b birleşmez (PR-a'nın kapısı
   §17'de).
8. **Satış dağılımı yönetim bilgisidir.** ModPOS ile yazarkasa arasındaki toplam ve nakit farkı, kümülatif sayaçlar ve
   yazarkasa dışı tahsilat yalnız yöneticinin ekranında ve yöneticinin seçtiği e-posta adreslerinde görünür; personel
   ekranına, personelin RSC yüküne ve WhatsApp metnine girmez. Kayıt eksiksiz tutulur (sahip ve muhasebe görür);
   personele yalnız kendi düzeltebileceği kart farkı gösterilir (§8).

---

## 1. Neden yanlış okuyor (teşhis)

Bugünkü kodda yazarkasa Z'sinin yeri yok; üç yol da "yanlış okuma" gibi görünür:

| Yol | Ne oluyor | Nerede |
|---|---|---|
| A. Yazarkasa Z'si **Kart** bölümüne çekilir | Model `z_report` derse okuma reddedilir, "Z bölümüne okut" çıkar → yol B. `bank_pos_end_of_day` derse `POS_TASK` "NET TOPLAM, GENEL TOPLAM or TOPLAM" der: günün bütün ödemelerinin toplamı (ya da bazı cihazlarda kümülatif GENEL TOPLAM) Banka POS'a yazılır, KREDİ satırı değil. Kart farkı binlerce lira çıkar, e-postaya ve WhatsApp'a gider | `prompts.ts:25-28`, `kasa.ts:255-283`, `cash-form.tsx:763-767` |
| B. Yazarkasa Z'si **Z raporu (ModPOS)** bölümüne çekilir | Belge türü `z_report` kapıdan geçer, mali rakamlar ModPOS alanlarına dolar: yazarkasa Z no'su ModPOS Z no'suyla karşılaştırılır ("eski bir Z raporu"), "Fotoğraftakini yaz" ModPOS değerlerini mali değerlerle ezer, kayıttan sonra meşru ModPOS–mali fark "Fotoğraftan farklı" alarmı olur. Rakamlar doğru okunmuş olsa bile personel "yanlış okudu" der | `read.ts:27-30,62-66`, `kasa.ts:144-252` |
| C. Gerçekten yanlış okuma | Uzun 57 mm rulo tek fotoğrafta ~375 px eninde (harf 8–11 px), JPEG 0,7; istem Z NO ile FİŞ NO / EKÜ NO'yu, günlük ile kümülatifi ayırmıyor; `Z_TASK` "GENEL TOPLAM"ı kabul edip "KDV dökümünü yok say" diyor; yazarkasa Z'sinin kendi kendini denetleyen kimlikleri hiç kullanılmıyor. Kökü çözünürlüktür: aynı piksellere daha uzun bakmak (efor) kaybolan ayrıntıyı geri getirmez; yakın çekim ya da kırpma getirir (§4.3) | `photo-compress.ts:13`, `prompts.ts:19-23` |

**Adım 0 (kod yok):** canlı `ai_calls`'tan hangi yolun yaşandığı çıkarılır; sonuç adlar maskelenerek
`docs/planlar/ekler/okc-z/teshis.md`'ye yazılır:

```sql
select a.id, a.at, a.feature, a.status, a.error_code,
       a.result->>'documentType' doc, a.result->'total'->>'text' z_total,
       a.result->'netTotal'->>'text' pos_net, a.result->'salesTotal'->>'text' pos_sales,
       a.result->>'zNo' z_no, a.result->'issues' issues,
       r.date, r.z_total, r.card, r.bank_pos
from ai_calls a
left join cash_report_photos p on p.photo_id = a.photo_id
left join cash_reports r on r.id = p.report_id
where a.feature in ('kasa-z','kasa-pos') order by a.at desc limit 60;
```

Aynı adımda sahipten gerçek fotoğraflar ve cihaz bilgileri istenir (§16 bilgi istekleri). **İstem (§4.2) ve kimlikler
(§5.2) yazılmadan önce** şu üçü kâğıtla doğrulanır ve `teshis.md`'ye yazılır; doğrulanmayan varsayım koda girmez:
1. **KÜM. satırları basılıyor mu, bu Z'yi içeriyor mu?** Ardışık iki günün Z'sinde KÜM. TOPLAM(bugün) −
   KÜM. TOPLAM(dün) = bugünün günlük toplamı mı? (Beko 300TR'nin bir kılavuz kopyasında KÜM. satırı yok.) Basılmıyorsa
   K6 ve kümülatif sütunları PR-b'den çıkar; içermiyorsa (bir önceki Z'ye kadar ise) K6'nın formülü bir gün kayar.
2. **Z ne zaman, kim tarafından alınıyor?** Elle, kapanışta mı; cihaz kendiliğinden (bazı YN ÖKC modelleri 23:59'da
   alır; yaygın kural "en geç 24:00") mı? Kendiliğinden ise istemdeki 05:00 kuralı ve "Z ertesi sabah" istisnası (§5.4)
   çıkarılır, kapanıştan sonraki satış ertesi Z'ye düşer ve §8'in toplam satırı bunu açıklar.
3. **ModPOS raporu hangi yazıcıdan çıkıyor?** Aynı ÖKC'den "bilgi fişi" olarak basılıyorsa başlıkta VKN ve MF işareti
   görünebilir; belge türü ayrımı o zaman "BİLGİ FİŞİ / MALİ DEĞERİ YOKTUR" yazısına ve Z SAYAÇ / KÜM. satırlarının
   yokluğuna dayanır (§4.2).

---

## 1b. Teslim: üç PR

| PR | İçerik | Migration | Taban | Kapı |
|---|---|---|---|---|
| **PR-a** (hemen) | `Z_TASK`'a `fiscal_z_report` kapısı (ModPOS bölümü yazarkasa Z'sini doldurmaz, yol B kapanır); `POS_TASK`'a `fiscal_z_report` (Kart bölümüne çekilen yazarkasa Z'si toplamı Banka POS'a yazmaz, yol A kapanır); doğru yönlendirme metinleri; başlıklar ve ipuçları (§3.1, §3.2a); `DOC_NAMES`; testler | yok | bugünkü `main` | sentetik + kayıtlı yanıtlar; eldeki gerçek fotoğraflarla yanlış bölüm denemesi |
| **PR-b** | Yazarkasa Z'sinin kendi bölümü: `kasa-okc`, `KasaOkcRaw`, `OKC_TASK`, `cash_reports.okc_*`, kimlikler ve temkinli doldurma (§3–§9); **tek okuma**; parçalar (üst / alt) | `okc_z` | dalga 10 sonrası `main` | §10: yanlış dolum 0, "doğrulandı ama yanlış" 0, alan doğruluğu ≥ %95, ilk okuma p90 ≤ 20 sn |
| **PR-c** (koşullu) | Farklı girdiyle ikinci okuma: telefonda şeridin yakın görünümü (§4.3), `mergeReads`, kayıtlı raporda birleşik okuma, "Yakından bir daha oku" (§3.5, §5.6) | yok | PR-b | yalnız §10 değerlendirmesi PR-b'nin tek okumasının yetmediğini gösterirse; yakın görünüm, aynı görselin yeniden okunmasından ölçülerek üstün çıkmalı; ikinci okuma p90 ≤ 40 sn |

PR-a sahibin bugünkü şikâyetinin büyük kısmını (A ve B yolları: doğru okunmuş rakamın yanlış alana yazılması) PR-b'nin
gerçek fotoğraf ve dalga 10 beklemesini beklemeden kapatır. `mergeReads`, ikinci okuma ve kayıtlı raporun birleşik
okuması PR-c'dedir; PR-b'de her fotoğrafın tek okuması vardır ve kayıtlı rapor bugünkü gibi son başarılı okumayı
kullanır.

### PR-a ayrıntısı (migration yok, `cash_reports` değişmez)

- `KasaZRaw.documentType` ve `KasaPosRaw.documentType` enum'larına `fiscal_z_report` (değer eklemek eski
  `ai_calls.result`'ların ayrıştırılmasını bozmaz; `tests/fixtures/foto/*.json` aynen ayrışır).
- `Z_TASK`'a (ModPOS bölümü) §4.2'nin sonundaki cümle. ModPOS bölümünde `fiscal_z_report` ya da
  `bank_pos_end_of_day`: hiçbir alan dolmaz, metin `Bu yazarkasanın (banka POS) Z raporu gibi görünüyor, ModPOS'unki
  değil.` + **Banka POS bölümüne okut** (bugünkü `kasa-pos` bölümü).
- `POS_TASK`'a (Kart bölümü): `If the paper is the cash register's fiscal Z (MF logo with a registry number, EKÜ NO,
  Z NO / Z SAYAÇ, a VERGİ DÖKÜMÜ with TOPKDV, KÜM. lines), set documentType fiscal_z_report and leave the slip fields
  null.` Kart bölümünde `fiscal_z_report`: `bankPos` dolmaz, düğme yok, turuncu metin `Bu yazarkasanın Z raporu.
  Banka POS'a Z'deki K.KARTI (kredi kartı) satırını yazın; toplamı ya da altındaki banka satırlarını değil.`
  Kart bölümünde `z_report` (ModPOS Z'si) bugünkü gibi "ModPOS bölümüne okut".
- Başlıklar: "Z raporu (ModPOS)" → **"ModPOS Z raporu"**; "Kart" kartı → **"Banka POS Z raporu (yazarkasa)"**, alanın
  ipucu `Z'deki K.KARTI satırı ya da banka gün sonu fişinin neti; Z'nin toplamı değil`.
- Testler: `tests/fotograf-okuma.test.ts` (iki bölümde `fiscal_z_report`, eski yanıtlar), `tests/ai-istemci.test.ts`
  (istekler aynı biçimde; yalnız istem metni değişti), sentetik görsel (`scripts/foto-eval/make-images.py`'nin
  **sonuna** bir yazarkasa Z'si) ve `scripts/foto-eval/cases.json`'da iki yanlış bölüm vakası.
- Dalga 10 ile çakışma: `cash-form.tsx`'te iki başlık ve bir ipucu satırı; hangisi önce birleşirse öteki elle uyarlar.
- `bank_pos`'un anlamı (İlke 5): PR-a ile PR-b arasındaki günlerde alan yazarkasa Z'sinin kart satırını tutabilir
  (bugün de personel bu alana Z'nin bir rakamını yazıyor). Kart farkı hesabında ikisi aynı karşılaştırmayı yapar;
  PR-b o günleri eski rapor olarak gösterir (etiket "Banka POS", §3.7), geriye dönük düzeltme yapılmaz.

---

## 2. Kararlar

| # | Karar | Neden |
|---|---|---|
| D1 | Kasa raporunda iki Z bölümü: **"ModPOS Z raporu"** (bugünkü, adı netleşir) ve **"Banka POS Z raporu (yazarkasa)"** (bugünkü "Kart" kartının yerine; sahip ve personel bu kâğıda "banka POS Z raporu" diyor). Banka gün sonu fişi bu bölümün altında **yedek** alan olarak kalır | Sahibin isteği ve kullandığı ad; banka gün sonu fişi bazı günlerde tek kart kanıtı olabilir |
| D2 | Yeni fotoğraf türü **`kasa-okc`**. Yeni istemci `kasa-pos` göndermez. **Geçiş süresince** (PR-b'den sonraki ayrı bir PR'a kadar) sunucu eski sayfalardan gelen `kasa-pos` yüklemesini ve yeniden okumasını kabul eder: fotoğrafı `kasa-okc` yapar (`setPhotoKind`), `OKC_TASK` ile okur ve eski istemciye eski biçimde (yalnız banka gün sonu fişinden `bankPos`) yanıt verir (§7). Eski `kasa-pos` okumaları `KasaPosRaw` ile okunmaya devam eder | Yayın sırasında açık kalan telefonlar ve dalga 10'un bekleyen geç raporlarındaki `kasa-pos` fotoğrafları; eski `ai_calls.result`'lar `KasaPosRaw` ile ayrıştırılmalı, aynı türe yeni şema verilirse eski okumalar sessizce kaybolur |
| D3 | Yazarkasa bölümünün kendi okuma görevi: yeni şema **`KasaOkcRaw`** + istem **`OKC_TASK`**. Belge türleri: `z_report`, `x_report`, `period_report`, `batch_slip`, `software_z`, `other` | X raporu, mali hafıza raporu ve ModPOS Z'si yazarkasa Z'sine benzer; ayırt edilmezlerse yanlış rakam dolar |
| D4 | ModPOS bölümünün şemasına belge türü **`fiscal_z_report`** eklenir; ModPOS bölümüne çekilen yazarkasa Z'si (ve banka gün sonu fişi) hiçbir alanı doldurmaz, **"Banka POS Z bölümüne okut"** çıkar (PR-a). Tersi: yazarkasa bölümüne çekilen ModPOS Z'si → **"ModPOS bölümüne okut"** | Yol B'yi kapatır. Enum'a değer eklemek eski okumaların ayrıştırılmasını bozmaz |
| D5 | Yeni `cash_reports` sütunları `okc_*` (§6). `bank_pos` anlamı değişmez. Kart farkı: **yazarkasa kartı varsa o, yoksa banka gün sonu** − ModPOS kart | Eski satırlarda kart farkı aynen kalır; yeni satırlarda doğru karşılaştırma |
| D6 | Kimlikler (Σ oranlar = toplam, Σ KDV = TOPKDV, oran başına KDV formülü, Σ ödemeler = toplam, KDV oranı aralığı, kümülatif zinciri, büyüklük, Z no sırası, tarih) **bizim saf kodumuzda** (`src/lib/okc-z.ts`) | İlke 1; aynı fonksiyonlar formdaki elle yazılan değerleri de denetler |
| D7 | Alan başına durum: **doğrulandı / denetlenemedi / tutmadı**. "Tutmadı" alan doldurulmaz, öneri olur; "doğrulandı" alan orta güvende bile mavi dolar. **Doğrulayan kimlik, iki tarafı farklı basılı rakamlardan gelen kimliktir** (§5.2): sıfır olmayan en az iki oran grubuyla K1 / K2, sıfır olmayan en az iki ödeme türüyle K4, K6 (kümülatif zinciri), Z no = önceki + 1. Tek oranlı günde K1 / K2, tek ödemeli günde K4 aynı rakamın iki kopyasını karşılaştırır: yalnız "çelişki yok" verir. K3 (KDV formülü) çözünürlüğü kaba olduğu için (§5.2) yalnız çürütür | İlke 2; aritmetik teyit görsel güvenden güçlüdür, ama yalnız iki ayrı rakam birbirini tutuyorsa. L'Affogato'nun satışı neredeyse tümüyle %10: aynı rakam Z'de NET SATIŞ, MALİ VERİ TOPLAM ve %10 TOPLAM olarak basılır ve model onu aynı yanlışla üç yerde okuyabilir |
| D8 | Yazarkasa Z okuması: Opus 5.5 (`claude-opus-5-5`), **efor `low` varsayılan** (öteki okumalarla aynı). `medium` ancak değerlendirmede (§4.4) yanlış dolum ve "doğrulandı ama yanlış" sayısını düşürür ve gecikme sınırını (ilk okuma p90 ≤ 20 sn) tutarsa seçilir. PR-b'de ikinci okuma yok | `low`'da canlı denemelerde düşünme 0 token: model saf aktarıcıdır ve kimlikler gerçekten bağımsızdır. Daha yüksek eforda model soluk rakamı toplam tutsun diye aritmetikle "çözebilir" (istemdeki "never adjust" kuralı bunu durdurmaz); o zaman kimlikler tanım gereği tutar. "Düşünme payı yazarkasa Z'sinde işe yarar" **ölçülene kadar varsayımdır** |
| D9 | İkinci okuma (PR-c) **farklı girdiyle** yapılır (yakın görünüm, §4.3) ve personelin düğmesiyle başlar (**Yakından bir daha oku**); kendiliğinden başlamaz, gönderimi ve öteki bölümün fotoğrafını kilitlemez. İki okumanın aynı çıkması güveni **hiçbir zaman** yükseltmez | Aynı görsel, aynı model ve aynı istemle iki okumanın hataları büyük ölçüde ilişkilidir (temperature da verilemiyor); ilişkili bir yanlış "iki okuma aynı" diye mavi dolardı. Kapanışta 15–50 sn kilit kabul edilemez |
| D10 | Kümülatif toplam / KDV ve yazarkasa dışı tahsilat **sunucuda, fotoğrafın okumasından** yazılır; formdan gelmez, personel yazmaz. Kümülatif **yalnız inandırıcıysa** saklanır (§6.1); zincir son saklanan kümülatife bağlanır; yönetici yanlış kümülatifi temizleyebilir. Hesap `writeCashReport`'ta yapılır, böylece dalga 10'un onayla yazılan geç raporu da aynı sütunları alır | Zincir denetiminin dayanağı istemciye bırakılmaz; yanlış okunmuş bir kümülatif saklanırsa ertesi günün doğru toplamını "tutmadı" yapar ve kimse düzeltemez |
| D11 | Uzun rulo: aynı Z'nin **üst ve alt kısmı** ayrı fotoğraf olabilir (bölümde en çok 3); her fotoğraf yalnız boş alanları doldurur, parçalar arası kimlikler formda canlı denetlenir. Değerlendirme (§10) "üst ve alt yarı" çekimini tek fotoğrafa karşı ölçer; belirgin üstünse yazarkasa Z'si için **varsayılan çekim** olur (ipucu ve durum metni bunu ister) | Bugünkü "ikinci fotoğraf yalnız boş alanları doldurur" kuralı korunur; API'de çoklu görsel gerekmez; yarım şerit fotoğrafta iki kat geniş görünür, çözünürlük sorununu (yol C) kodsuz çözer |
| D12 | Yazarkasa Z fotoğrafı **400 gün** saklanır (ModPOS Z 180 kalır) | Yıllık vergi mutabakatı (dalga 12) bir takvim yılını kapsar; kişisel veri taşımaz (§16 S5) |
| D13 | ModPOS ↔ yazarkasa satırları (toplam, nakit, kart, yemek kartı, banka) **1 ₺ toleransla**; kart farkı uyarı, ötekiler nötr bilgi. **Personel yalnız kart satırını** (ve yazarkasanın kendi içinde tutmadığını) görür; toplam, nakit, yemek kartı ve banka satırları yalnız yöneticinin ekranında ve e-postada; WhatsApp metninde yalnız kart satırı (İlke 8, §16 S2) | Kart her zaman cihazdan geçer, tutmalıdır ve personel düzeltebilir; toplam ve nakit meşru olarak ayrışabilir, personelin yapabileceği bir şey yoktur, işletmenin satış dağılımıdır ve WhatsApp grubu güvenli bir kanal değildir |
| D14 | Aşağı akış (KDV tahmini, vergi bölümünün kasa geliri) **bu dalgada değişmez**; yalnız saf okuyucu `okcMonth()` eklenir. Geçiş ayrı küçük PR'da, dalga 12'den sonra | İki dalganın aynı satırı aynı anda değiştirmemesi; kapsam ölçülmeden kaynak değişmesin |
| D15 | Yazarkasa bölümü **isteğe bağlı**; girilmeyen gün yöneticide "Yazarkasa Z yok" rozeti alır (özelliğin ilk kullanıldığı günden sonra) | Kapanışta personeli bekletmemek; sahip sonra zorunlu yapabilir (§16 S1) |
| D16 | Telefonda yazarkasa kartı **fotoğraf + dört alan** (Günlük toplam, Z no, Nakit, Kredi kartı) gösterir; gerisi tek bir **Ayrıntılar** kutusunda, yalnız içinde turuncu alan varsa açık. Personele giden metinlerde jargon yok (kümülatif, zincir, KÜM., MATRAH); alan başına tek turuncu neden ve tek özet satırı. Zincir, iptal, yazarkasa dışı tahsilat ve "Z ertesi sabah" bilgi satırları yalnız yöneticide | Kapanışta personelin işi ve okuma yükü artmamalı |
| D17 | Kümülatifler yalnız sunucuda ve yöneticinin DTO'sunda: zincir denetimi okumada sunucuda yapılır, sonucu metin olarak döner; personelin formuna önceki yazarkasa Z'sinden yalnız `{ date, zNo }` gider; okuma yanıtı personele kümülatif ve yazarkasa dışı tahsilat alanlarını taşımaz | §3.7'nin "kümülatif yöneticiye" kuralı RSC yükünde ve okuma yanıtında da geçerli olsun; önceki Z, personelin artık göremediği eski bir günden gelebilir |
| D18 | Yazarkasa kartı ve (PR-c'de) ikinci okuma akışı ayrı istemci bileşeninde: `src/app/panel/kasa/okc-card.tsx`. `cash-form.tsx`'te yalnız değer ve işaret köprüsü kalır | `cash-form.tsx` bugün 820, dalga 10'da 1.129 satır; dalga 11 de aynı dosyaya dokunuyor: çakışma yüzeyi ve gözden geçirme yükü küçülsün |

---

## 3. Personel ekranı: Kasa raporu formu (`/panel/kasa`, önce telefon)

### 3.1 ModPOS kartı (PR-a)

- Başlık **"Z raporu (ModPOS)" → "ModPOS Z raporu"**. Açıklama aynen.
- Fotoğraf bölümü, okuma ve alanlar değişmez. Yalnız yanlış belge metinleri (§3.3) ve belge türü kapısı değişir.

### 3.2a Kart kartı, PR-a'da (geçici)

Bugünkü "Kart" kartı yerinde kalır; başlık **"Banka POS Z raporu (yazarkasa)"**, alan etiketi "Banka POS" aynen, ipucu
`Z'deki K.KARTI satırı ya da banka gün sonu fişinin neti; Z'nin toplamı değil`. Yazarkasa Z'sinin fotoğrafı bu bölümde
alan doldurmaz, kart satırını elle yazdırır (§1b PR-a ayrıntısı). PR-b bu kartı aşağıdakiyle değiştirir.

### 3.2 Yazarkasa kartı (PR-b; bugünkü "Kart" kartının yerine, `okc-card.tsx`)

`CardHeader`: simge `ScrollText`, başlık **"Banka POS Z raporu (yazarkasa)"**. Açıklama:
- depo ve okuma açıkken: `Banka POS'tan (yazarkasa) aldığınız Z raporu: üstünde Z RAPORU ve KDV dökümü yazar; banka gün
  sonu fişi değil. Fotoğrafını çekin, rakamlar dolar. Fotoğraf yoksa aşağıdakileri yazın.`
- değilse: `Banka POS'tan (yazarkasa) aldığınız Z raporundaki rakamları yazın (üstünde Z RAPORU ve KDV dökümü yazar).`

Gövde, sırasıyla (telefonda tek sütun, `sm:` iki sütun):

1. Fotoğraf bölümü (`photoBlock("kasa-okc")`, kimliği `k-okc-photos`). Seçicinin altında soluk ipucu:
   `Fişi düz koyun, ekranı fişle doldurun; uzunsa önce üstünü, sonra altını çekin.` (Değerlendirme üst / alt yarıyı
   varsayılan yaparsa, D11: `Önce fişin üst yarısını, sonra alt yarısını çekin.`)
2. **Günlük toplam** (`k-okcTotal`) · ipucu `NET SATIŞ ya da TOPLAM satırı; en büyük rakam değil`
3. **Z no** (`k-okcZNo`, sayısal) · ipucu `Z NO / Z SAYAÇ (fiş no değil)`
4. **Nakit** (`k-okcCash`)
5. **Kredi kartı** (`k-okcCard`) · ipucu `K.KARTI satırı; altındaki banka satırları değil`
6. Açılır kutu `<details>` **Ayrıntılar** (D16). Özet satırı kapalıyken `Ayrıntılar · KDV, fiş sayısı, yemek kartı,
   banka gün sonu (isteğe bağlı)`. Fotoğraftan dolunca **açılmaz**; yalnız içinde turuncu alan varsa (ya da yönetici
   düzenliyorsa) açık gelir, özet satırı o zaman `Ayrıntılar · 1 rakamı fişle karşılaştırın`. İçinde:
   - **Yemek kartı** (`k-okcMealCard`) · ipucu `varsa`; **Diğer** (`k-okcOther`) · ipucu `varsa (havale, kupon…)`
   - **Toplam KDV** (`k-okcVatTotal`) · ipucu `TOPKDV satırı`
   - **KDV dökümü**: üstte `Z'deki VERGİ DÖKÜMÜ: oranın KDV dahil toplamı ve KDV'si.` ve iki sütunlu satırlar:
     `%10 toplam` / `%10 KDV`, `%20 toplam` / `%20 KDV`; `%1` satırı yalnız okunduysa ya da kayıtlıysa görünür.
   - **Fiş sayısı** (`k-okcReceipts`) · ipucu `MÜŞTERİ FİŞ ADEDİ`
   - Alt başlık **"Banka gün sonu fişi (varsa)"** ve soluk satır `Bankanın ayrı gün sonu fişi varsa net toplamı.`
     Alan **Banka gün sonu** (`k-bankPos`, yer tutucu `isteğe bağlı`). İki fişte bugünkü "Toplama ekle / Yerine yaz"
     sorusu aynen.
7. Tek özet satırı (§3.6) ve kart satırı (§8).

**Fotoğraf yoksa personel ne yazar:** yalnız dört alan: Günlük toplam, Z no, Nakit, Kredi kartı (Yemek kartı ve Diğer
varsa). Ayrıntılar isteğe bağlıdır; boş kalan KDV dökümünü yönetici sonradan kâğıttan yazabilir (ay okuyucusu onu eksik
sayar, §9).

**Zorunluluk (formda ve sunucuda aynı):**
- Bölüm bütünüyle boş kalabilir.
- Bölümde herhangi bir tutar yazıldıysa `Günlük toplam`, `Nakit` ve `Kredi kartı` gerekli:
  `Yazarkasa günlük toplamı gerekli (bölümü boş da bırakabilirsiniz)`, `Nakit gerekli (yoksa 0 yazın)`,
  `Kredi kartı gerekli (yoksa 0 yazın)`.
- Bir oranın toplamı ile KDV'si birlikte yazılır: `%10 için toplam ve KDV birlikte yazılır`.
- KDV toplamdan büyük olamaz: `%10 KDV'si toplamından büyük olamaz`.

### 3.3 Okuma ve doldurma

Yükleme ve okuma bugünkü gibi tek istekte (`POST /api/foto`, `kind: "kasa-okc"`). Durum satırı:
`Okunuyor… genelde N saniye`; N, değerlendirmede (§10) ölçülen p50'den yazılır (yalnız bu türde; öteki türlerde
"5–10 saniye" kalır). Okuma sürerken yalnız **bu bölümün** seçicisi kilitlidir (`busy` bölüm başına); ModPOS Z'si aynı
anda çekilebilir. **Raporu gönder** bugünkü gibi yüklemesi süren bir fotoğraf varken bekler (fotoğrafın kimliği
yüklemenin yanıtıyla gelir).

Doldurma kuralı (`prefillPlan`'a eklenen tek kural, D7):

| Alanın durumu | Forma | Altında |
|---|---|---|
| doğrulandı (iki ayrı basılı rakamı karşılaştıran bir kimlik tutuyor, §5.2) | yazılır, mavi **Fotoğraftan** | — |
| denetlenemedi ya da yalnız "çelişki yok" (tek kopya kimlik, K3), güven `high` | yazılır, mavi **Fotoğraftan** | — |
| denetlenemedi ya da "çelişki yok", güven `medium` | yazılır, turuncu | `Fotoğrafta net değil; fişle karşılaştırın.` |
| güven `low` | **yazılmaz** | `Fotoğrafta net okunamadı (12.975,50 ₺); fişten yazın.` + **Fotoğraftakini yaz** |
| **tutmadı** | **yazılmaz** | tek neden (§3.6'nın personel metni) + `Fotoğrafta 12.915,50 ₺.` + **Fotoğraftakini yaz** |
| elle yazılmış, fotoğraftaki farklı | değişmez | `Fotoğrafta …` + **Fotoğraftakini yaz** (bugünkü gibi) |
| okunamadı | boş, turuncu | `Fotoğrafta okunamadı; fişten yazın.` |

İki okumanın farklı çıktığı satırlar PR-c'dedir (§3.5).

Okumanın bütününü durduranlar (hiçbir alan yazılmaz, hepsi öneri olur; kırmızı değil turuncu kutu):
- Z no önceki yazarkasa Z'siyle **aynı**: `Bu Z no (0187) 21 Ekim raporunda da var; dünkü Z raporu olabilir.`
- Belge türü `x_report`, `period_report`, `software_z`, `other`: kırmızı satır, hiçbir alan dolmaz (aşağıda).

Yeşil özet satırı (`prefillSummary`, `kasa-okc`):
- `Banka POS Z raporundan dolduruldu: 4 alan. Turuncu olanları fişle karşılaştırıp gönderin.` / `… Kontrol edip
  gönderin.` (sayı yalnız görünen alanlar ve Ayrıntılar'da dolanlar)
- Yalnız banka fişi: `Banka gün sonu fişinden dolduruldu: Banka gün sonu.`
- Doldurulacak alan yoksa bugünkü metinler (`Banka POS Z raporu okundu; …`).

Yanlış belge metinleri:

| Bölüm | Okunan | Metin | Düğme |
|---|---|---|---|
| ModPOS | `fiscal_z_report` | `Bu yazarkasanın (banka POS) Z raporu gibi görünüyor, ModPOS'unki değil.` | **Banka POS Z bölümüne okut** |
| ModPOS | `bank_pos_end_of_day` | `Bu bir banka gün sonu fişi gibi görünüyor, Z raporu değil.` | **Banka POS Z bölümüne okut** |
| Yazarkasa | `software_z` | `Bu ModPOS'un Z raporu gibi görünüyor.` | **ModPOS bölümüne okut** |
| Yazarkasa | `x_report` | `Bu bir X raporu (gün içi) gibi görünüyor; yazarkasadan Z raporunu alıp çekin.` | — |
| Yazarkasa | `period_report` | `Bu bir mali hafıza / dönem raporu gibi görünüyor; günün Z raporunu çekin.` | — |
| Yazarkasa | `other` vb. | `Bu {belge adı} gibi görünüyor. Yazarkasanın Z raporunun fotoğrafını çekin.` | — |

`cash-photos.tsx` `SWITCH_LABEL`: `"kasa-okc": "Banka POS Z bölümüne okut"`, `"kasa-z": "ModPOS bölümüne okut"`
(`"kasa-pos"` yalnız eski fotoğrafların "Banka POS Z bölümüne okut"una dönüşür: eski `kasa-pos` fotoğrafı yeniden
okunursa türü `kasa-okc` olur).

Bilgi satırları (`ReadChecks`, mavi). **Personele** yalnız işlemsel olanlar, en çok iki satır:
- `Önceki Z 0186; bu 0188. Arada bir Z raporu girilmemiş olabilir.`
- `Aynı fişte banka gün sonu da var: Banka gün sonu 8.915 ₺ dolduruldu.`

**Yöneticiye** (kayıtlı raporda ve "Düzeltip onayla"da; okuma yanıtında personele gitmez, D17), en çok dört satır,
önce uyarılar:
- `Önceki Z'yle (0187, 21 Ekim) kümülatif zinciri tutuyor.` (Z no +1 ve kümülatif farkı = günlük toplam)
- `Z'de toplam dışında 1.250 ₺ tahsilat var (faturalı satış, bilgi fişi…); toplama eklenmedi.`
- `Z'de 85 ₺ fiş iptali var (toplamdan zaten düşülmüş).`
- Ertesi sabah alınmış Z ve zincir tutuyorsa (yalnız §1 adım 0 madde 2 elle alındığını doğrularsa):
  `Z ertesi sabah alınmış (25 Ekim 09:12); bu güne yazıldı.`

### 3.4 Uzun fiş: parçalar (D11)

- Bölüme en çok 3 fotoğraf (raporun toplamı bugünkü gibi en çok 6).
- `cut_off` sorununun bu türdeki metni: `Fişin bir kısmı fotoğrafta yok; kalan kısmını ayrıca çekin.`
- İkinci parça yalnız boş alanları doldurur; birinci parçanın doldurduğu ve değişmemiş alanla çelişirse bugünkü
  "Fotoğrafta …" önerisi çıkar.
- Parçalar arası kimlikler (ör. KDV dökümü üst parçada, ödemeler alt parçada) formun değerleri üstünde canlı denetlenir
  (§3.6); kümülatif rakam, onu okuyan son fotoğraftan sunucuda alınır (D17). Parçalar arası tutmazlıkta ilgili alanlar
  turuncu olur ve nedeni yazar.
- Tek fotoğrafta bir alan "tutmadı" ya da `low` kaldıysa durum satırının altında: `Fişin üst ve alt yarısını ayrı
  çekerseniz rakamlar daha net okunur.` (PR-b'de farklı girdinin kodsuz yolu.)

### 3.5 İkinci okuma (PR-c; D9)

- Kendiliğinden başlamaz. Okuma bir temel alanı (`okcTotal`, `okcCash`, `okcCard`, `okcZNo`) "tutmadı" ya da `low`
  bıraktıysa, yakın görünüm üretilebildiyse (§4.3) ve fotoğrafın en az **iki** okuma hakkı kaldıysa (biri bölüm
  değiştirmeye kalsın, §5.6) o alanların yanında **Yakından bir daha oku** düğmesi çıkar.
- İstek `POST /api/foto/{id}/oku` `{ tur: "kasa-okc", gun, yakin: true }`. Bu sürede **ne gönderim ne öteki bölümün
  fotoğrafı kilitlenir**; durum satırı `Fişe yakından bir daha bakılıyor…`. Rapor ikinci okuma bitmeden gönderilirse
  sunucu sütunları ve "Fotoğraftan farklı" karşılaştırması o ana kadarki okumalardan kurulur; ikinci okuma sonradan
  biterse kayıtlı raporun okuması (`readingOf`) onu da birleştirir.
- Gelen birleşik okuma uygulanırken **bu fotoğrafın doldurduğu ve personelin değiştirmediği** alanlar boş sayılır
  (yeni değerle güncellenir); personelin yazdığına dokunulmaz.
- İki okuma farklı, biri doğrulandı: doğrulanan yazılır, turuncu, `İki okuma farklıydı; toplamla tutan yazıldı (öteki
  12.915,50 ₺).`
- İki okuma farklı, hiçbiri doğrulanmadı: **yazılmaz**, varsayılan yok, iki ayrı düğme: **12.975,50 yaz** /
  **12.915,50 yaz**; altında tek satır, hangi denetimin tutmadığı (`Ödemelerin toplamı iki rakamla da tutmuyor; fişe
  bakın.`).
- Özet: `Yakın okuma bitti: 2 alan düzeldi.` / `Yakın okuma bitti: 1 alanı fişten yazın.`
- Hata verirse (zaman aşımı, sınır): ilk okuma olduğu gibi kalır, durum satırı
  `Yakın okuma yapılamadı; turuncu alanları fişten yazın.` (kırmızı değil).

### 3.6 Canlı denetim (formun değerleri üstünde; elle yazılana da)

`okcFormChecks(values, { prevZNo })` (§5.2'deki kimlikler, toleranslarıyla; kümülatif formda yoktur, D17). Personele
**alan başına tek turuncu neden** (alanın altında) ve kartın altında **tek özet satırı**:
`2 rakam birbirini tutmuyor; turuncu olanları fişle karşılaştırın.` Alan nedenleri sade dille:
- Nakit / Kredi kartı: `Nakit, kart ve öteki ödemeler toplanınca günlük toplam çıkmıyor (120 ₺ az).`
  Fazla çıkarsa tutarsız: `Nakit, kart ve öteki ödemeler toplanınca günlük toplamdan fazla çıkıyor; fişle
  karşılaştırın.` (fazlası yazarkasa dışı tahsilat olabilir, tutarı D17 gereği yalnız yöneticide). Okuma
  (`extraTakings`) ya da personelin DTO'su (`okcExtraTakings`) Z'de toplam dışı tahsilat olduğunu tutarsız
  söylerse fazlası hiç turuncu olmaz (b8).
- %10 KDV: `Bu oranın KDV'si toplamına göre 773,27 ₺ değil, 737,27 ₺ civarında olmalı.`
- %10 toplam: `Oranların toplamı günlük toplamı tutmuyor (60 ₺ fark).`
- Toplam KDV: `Toplam KDV günlük toplama göre çok büyük; başka bir satır yazılmış olabilir.`
- Z no: `Z no (0186) önceki Z'den (0187) büyük olmalı.`
- Günlük toplam (büyüklük, §5.1): `Günlük toplam bir gün için çok büyük; fişin altındaki cihaz toplamı okunmuş olabilir.`

Yönetici aynı denetimleri ayrıntılı metinleriyle görür (§5.2 tablosunun "Metin" sütunu). Gönderimi engellemez
(kapanışta personeli bekletmemek); kayıtlı raporda ve yöneticinin e-postasında "Yazarkasa Z'si kendi içinde tutmuyor"
olarak görünür (§8).

### 3.7 Kayıtlı rapor (okuma kipi) ve günden güne

- `CashBreakdown`'da "Kart" bölümü **"Banka POS Z (yazarkasa)"** olur: `Z no 0188 · 143 fiş`, `Günlük toplam`,
  `Toplam KDV`, `%10 · 8.110 ₺ · KDV 737,27 ₺` satırları, `Nakit`, `Kredi kartı`, `Yemek kartı` / `Diğer` (sıfır
  değilse), `Banka gün sonu` (varsa); altında §8'in karşılaştırma satırları (personele yalnız kart satırı).
- Yöneticiye ek satır (personele değil; cihaz sayacı ve satış dağılımı, İlke 8): `Kümülatif (cihaz açılışından beri):
  1.259.350 ₺ · KDV 118.943,94 ₺`, yanında **Kümülatifi temizle** (yalnız yönetici; §6.1, olay kaydına düşer). Kümülatif
  inandırıcı bulunmayıp saklanmadıysa: `Kümülatif okundu ama önceki Z'yle tutmadığı için saklanmadı (1.259.530 ₺).`
- Eski rapor (`okcTotal` boş, `bankPos` dolu; PR-b'den önceki her gün): bugünkü "Kart" bölümü aynen, etiket
  `Banka POS` (o günlerde alan banka gün sonunu da yazarkasa Z'sinin kart satırını da tutabilir; anlam iddia edilmez).
- Günden güne (yönetici): `Kart ±120` rozeti kart farkının yeni tanımıyla (D5) aynen; yeni rozetler:
  `Yazarkasa tutmuyor` (amber, §3.6'daki denetimlerden biri kayıtlı değerlerde tutmuyorsa) ve `Yazarkasa Z yok`
  (gri; Z toplamı > 0, `okcTotal` boş ve gün, ilk yazarkasa Z'li rapordan sonra).

### 3.8 Dalga 10 kipleri

- **Geç rapor** (`mode="late"`): yazarkasa kartı görünür, fotoğrafı kabul edilir ama zorunlu değildir (§16 S3).
  `kasa-z` fotoğrafı ve ModPOS Z no zorunluluğu aynen. Geç güne eklenen raporun **iki komşusu da** elde olabilir:
  yöneticinin onay kartı §5.3 ve K6'yı hem önceki hem sonraki yazarkasa Z'siyle denetler:
  `Banka POS Z no 0188: önceki 0187 (21 Ekim) ✓ · sonraki 0189 (23 Ekim) ✓ · kümülatif iki yanda da tutuyor` ya da
  tutmayan halka (`sonraki günün kümülatif artışı 9.120 ₺, o günün toplamı 9.180 ₺`). Onayda sunucu sütunları
  `writeCashReport`'ta öteki raporlardaki gibi yazılır (D10, §6.1).
- **Düzeltme önerisi**: fotoğraf bloğu bugünkü gibi gizli; yazarkasa alanları önerilebilir. Bu alanlar **hassas
  değildir** (Z ve kart gibi; `SENSITIVE` değişmez): ertesi gün düzeltmesi onaysız (dalga 10 karar 3c).
- **"Düzeltip onayla"** (`mode="review"`): yazarkasa alanları yöneticinin değerleriyle.

---

## 4. Okuma: şema, istem, model

### 4.1 Şema (`src/lib/photo-read/schemas.ts`)

```ts
export const Count = z
  .object({
    text: z.string().nullable().describe('Exactly as printed, e.g. "0188"; null if not on the paper'),
    value: z.number().int().nullable(),
    confidence: Confidence,
  })
  .describe("A counter as printed");

const BatchSlip = z.object({
  bank: z.string().nullable().describe('Bank or app as printed, e.g. "GARANTİ BBVA"'),
  batchNo: z.string().nullable(),
  date: z.string().nullable().describe("YYYY-MM-DD"),
  salesTotal: Amount,
  refundTotal: Amount.describe("İADE; text null if not printed. İPTAL lines are not refunds"),
  netTotal: Amount.describe("NET / TOPLAM: sales minus refunds"),
  transactionCount: z.number().int().nullable(),
});

export const KasaOkcRaw = z.object({
  documentType: z.enum(["z_report", "x_report", "period_report", "batch_slip", "software_z", "other"]),
  fiscalMarks: z
    .object({ mfLogo: z.boolean(), ekuNo: z.boolean(), cumulativeLines: z.boolean(), vatBlock: z.boolean() })
    .describe("Which fiscal marks are printed: MF logo with registry number, EKÜ NO, KÜM./cumulative lines, VERGİ DÖKÜMÜ"),
  readable: z.boolean(),
  title: z.string().nullable().describe('Printed title, e.g. "Z RAPORU"'),
  date: z.string().nullable().describe("YYYY-MM-DD"),
  time: z.string().nullable().describe("HH:MM"),
  dateConfidence: Confidence,
  zNo: Count.describe("Z NO / Z SAYAÇ. Not FİŞ NO, not EKÜ NO, not the registry number, not BATCH NO"),
  receiptCount: Count.describe("Sales receipts: MÜŞTERİ FİŞ ADEDİ / MALİ FİŞ ADEDİ / FİŞ SAYISI; not TOPLAM FİŞ ADEDİ when slip counts are listed"),
  dailyTotal: Amount.describe("This Z's total incl. KDV: NET SATIŞ / MALİ VERİ TOPLAM / TOPSAT / TOPLAM. Never cumulative, never TOPKDV"),
  dailyTotalLabel: z.string().nullable().describe("The label printed next to dailyTotal"),
  kdvGroups: z
    .array(z.object({ rate: z.number().describe("percent, e.g. 10"), total: Amount.describe("incl. KDV"), vat: Amount, base: Amount.nullable().describe("MATRAH; null if not printed") }))
    .describe("VERGİ DÖKÜMÜ, one entry per rate whose total is not 0,00, in printed order"),
  totalVat: Amount.describe("Daily TOPKDV / MALİ VERİ TOPKDV; not cumulative"),
  payments: z
    .array(
      z.object({
        label: z.string(),
        count: z.number().int().nullable().describe("count printed with the label, if any; never an amount"),
        amount: Amount,
        kind: z.enum(["cash", "card", "meal_card", "other", "bank_subline", "drawer", "unknown"]),
      }),
    )
    .describe("Every payment line in printed order"),
  outside: z.array(z.object({ label: z.string(), amount: Amount })).describe("Collections outside the fiscal total: FATURALI SATIŞ, e-FATURA, e-ARŞİV, BİLGİ FİŞİ, AVANS, TAHSİLAT"),
  voids: Amount.describe("FİŞ İPTAL amount; text null if not printed"),
  discounts: Amount.describe("İNDİRİM total; text null if not printed"),
  cumulativeTotal: Amount.describe("KÜM. TOPLAM / KÜMSAT (since the device started)"),
  cumulativeVat: Amount.describe("KÜM. TOPKDV / KÜMKDV"),
  batches: z.array(BatchSlip).describe("Bank end-of-day slips in the photo (alone or printed after the Z); empty if none"),
  issues: z.array(Issue),
});
export type KasaOkc = z.infer<typeof KasaOkcRaw>;
```

- **Şema küçük tutulur** (çıktı token'ı süreyi belirler, §4.4): sıfır KDV grupları istenmez ve yazdırılmaz (K8 yine
  çalışır: tutarı olan eski oran grubu döner), `base` yalnız MATRAH basılıysa nesnedir. `title`, `dailyTotalLabel` ve
  `fiscalMarks`'ın gerçekten kullanılıp kullanılmadığı (belge türü ayrımına, GENEL TOPLAM kuralına katkısı) §10'da
  ölçülür; katkısı olmayan alan şemadan çıkarılır. Hedef: örnek Z'de JSON ≤ ~700 token.
- `KasaZRaw.documentType` ve `KasaPosRaw.documentType` enum'larına `fiscal_z_report` PR-a'da eklenir (eski sonuçlar
  ayrıştırılmaya devam eder).
- `KasaPosRaw` başka değişmez (eski `kasa-pos` okumaları için).
- Ödemeler bir dizidir (şart kitabındaki `{cash, card, mealCard, other}` nesnesi kodda bu satırlardan toplanır): etiket ile
  tutarın eşleşmesi, banka alt satırları ve tanınmayan etiket yalnız satır satır denetlenebilir.
- İlk canlı denemede `claudeSchema(KasaOkcRaw)` API'ce kabul edildiği doğrulanır (şema öncekilerden büyük).
  **28 Ekim 2026:** kabul edilmez. Yapılandırılmış çıktının açık sınırı 16 birleşim türlü parametre, şemada 42 var;
  canlıdaki ilk okuma "badrequest 400" aldı (büyük olasılıkla bu yüzden). Sınırı aşan şema artık `format` olmadan,
  görev metninde gider (`docs/FOTOGRAF.md` § 5, `fitsStructuredOutputs`); b2 değerlendirmesi bu biçimle ölçer.
- `stored` kancası yok: Z'de kişisel veri yok (şirketin unvanı ve VKN'si alınmıyor, şemada alanı yok).

### 4.2 İstem (`src/lib/photo-read/prompts.ts`)

`SYSTEM` aynen. Yeni görev (İngilizce; fişin Türkçe sözcükleri olduğu gibi). **Taslaktır:** §1 adım 0'ın üç cihaz
gerçeği (KÜM. satırları, Z'nin saati, ModPOS'un yazıcısı) ve gerçek fotoğraflardaki etiketlerle kesinleşir; gün
cümlesi ve `software_z` tanımı onlara göre değişebilir.

```ts
export const OKC_TASK = (day: string) => `This should be the fiscal Z report (Z RAPORU) of the café's cash register POS (yeni nesil ÖKC, yazarkasa POS). Expected business day: ${day} (a Z printed after midnight but before 05:00 belongs to the day before). The same paper strip may also carry the bank end-of-day slip printed right after the Z.

documentType:
- z_report: title Z RAPORU / Z GÜNLÜK RAPORU / Z-GÜN SONU RAPORU with fiscal marks: the MF logo with a registry number, EKÜ NO, a VERGİ DÖKÜMÜ with TOPKDV, usually KÜM. lines.
- x_report: X RAPORU or another intraday report (no new Z number; may print SON Z-SAYISI).
- period_report: MALİ HAFIZA / MALİ BELLEK RAPORU, İKİ Z ARASI, İKİ TARİH ARASI, EKÜ RAPORU, GÜNLÜK / AYLIK SATIŞ RAPORU.
- batch_slip: only a bank end-of-day slip (GÜN SONU, BATCH / GRUP KAPAMA, MUTABAKAT; no KDV, no Z NO, no MF logo).
- software_z: the restaurant software's (ModPOS) end-of-day report: tables, products, garson, İKRAM / ÖDENMEZ; no Z NO / Z SAYAÇ, no EKÜ NO, no KÜM. lines. It may still print a KDV summary, and when it is printed on the cash register it may carry the company header, VKN and even the MF logo, but then it says BİLGİ FİŞİ or MALİ DEĞERİ YOKTUR: that is software_z, not z_report.
- other: anything else.
Fill fiscalMarks with what is printed.

Reading the Z:
- The amount of a label is often on the line below the label, and a count can sit on the label line ("K.KARTI 31", then "*6.900,00"). A count is never an amount; pair each amount with its own label.
- dailyTotal: this Z's own total, KDV dahil: NET SATIŞ, MALİ VERİ TOPLAM, TOPSAT or TOPLAM. Never a line with KÜM., KÜMSAT or KÜMÜLATİF, never a GENEL TOPLAM printed among the cumulative lines, never TOPKDV, never a card line. Put the printed label in dailyTotalLabel.
- kdvGroups: the VERGİ DÖKÜMÜ / KDV block, one entry per rate: total (TOPLAM / TOP, KDV dahil), vat (TOPKDV / KDV), base (MATRAH, KDV hariç) only if printed, else null. Skip a group whose total is 0,00 (old rates %8 and %18 often print that way); a group with an amount is always copied.
- totalVat: the day's TOPKDV / MALİ VERİ TOPKDV.
- cumulativeTotal, cumulativeVat: KÜM. TOPLAM / KÜMSAT and KÜM. TOPKDV / KÜMKDV, totals since the device started. Copy them; they are not today's figures.
- payments: every payment line in printed order: NAKİT → cash; K.KARTI, KREDİ KARTI, KREDİ, BANKA KARTI → card; YEMEK KARTI, YEMEK ÇEKİ, MULTINET, SODEXO, PLUXEE, EDENRED, SETCARD, TICKET, METROPOL → meal_card; HAVALE, EFT, AÇIK HESAP, KUPON, DİĞER → other; a bank or app name printed under the card line → bank_subline; KASA NAKİT, PARA GİRİŞ, PARA ÇIKIŞ → drawer; anything else → unknown. Some devices print no card line at all and list card payments only by bank or app name: then those lines are the card payments; still mark them bank_subline and copy each one.
- outside: FATURALI SATIŞ, e-FATURA, e-ARŞİV, BİLGİ FİŞİ, AVANS, FATURA / CARİ TAHSİLAT, OTOPARK lines.
- voids: FİŞ İPTAL amount. discounts: İNDİRİM total. They are already netted out of the total: copy, never subtract.
- zNo: Z NO / Z SAYAÇ / Z SAYACI. Not FİŞ NO (the Z's own document number), not EKÜ NO, not the registry number, not BATCH NO.
- receiptCount: MÜŞTERİ FİŞ ADEDİ, MALİ FİŞ ADEDİ or FİŞ SAYISI. Not TOPLAM FİŞ ADEDİ when slip or bilgi fişi counts are listed.
- batches: one entry per bank end-of-day slip in the photo (alone, or printed after the Z). A slip printed after the Z is not a reason for "multiple_documents".
- Two Z reports, or Z reports of two devices, in one photo: add "multiple_documents" and read the one dated ${day}.`;

/** PR-c: yakın görünümün okuması (ilk okumanın değerleri verilmez) */
export const OKC_CLOSEUP = `The image is a close-up of one long paper strip, cut into overlapping parts placed side by side: read the left part first, then the next part to its right; the parts overlap by a few lines, so a line seen at the bottom of one part and the top of the next is one line. Read every line digit by digit. Where a digit could be another (0/8, 6/0, 5/9, 1/7, 3/8, 5/6) or the decimal comma is unclear, lower the confidence instead of choosing.`;
```

`Z_TASK`'a eklenecek (ModPOS bölümü; PR-a):
`- If the paper is the cash register's fiscal Z (MF logo with a registry number, EKÜ NO, KÜM. / KÜMÜLATİF lines, Z NO / Z SAYAÇ), set documentType fiscal_z_report. A ModPOS report may also print a KDV summary, and when printed on the cash register it may carry the VKN header and MF logo with BİLGİ FİŞİ or MALİ DEĞERİ YOKTUR; neither makes it fiscal.`

### 4.3 Görsel

- `kasa-okc` için telefonda kalite **0,8** (`OKC_COMPRESS = { ...PHOTO_COMPRESS, quality: 0.8 }`); ölçü sınırı aynı
  (en uzun kenar 2576 px, ~3,7 MP: Opus 5.5'in ayrıntı kaybetmeden okuduğu en büyük ölçü, görsel başına en çok ~4.800
  token). 1,8 MB'ı aşan bugünkü küçültme adımlarına girer; sunucu sınırı 2 MB aynı. `usePhotoUpload` türe göre seçer.
- **PR-b'de farklı girdinin kodsuz yolu:** fişin üst ve alt yarısı ayrı fotoğraf (D11). Yarım şerit fotoğrafta iki kat
  geniş görünür (~750 px). Değerlendirme bunu tek fotoğrafa karşı ölçer.
- **Yakın görünüm (PR-c, ölçüme bağlı):** telefon, yükleme anında elindeki asıl fotoğraftan (~12 MP; şerit ~600–680 px
  eninde) fişin sütununu bulur (küçük gri tonlu kopyada sütun sütun parlaklık; kâğıt en geniş parlak bant, kenara %8
  pay; bant görüntünün %12'sinden dar ya da %70'inden genişse yakın görünüm üretilmez) ve sütunu üst üste biraz
  örtüşen iki (gerekirse üç) parçaya bölüp **yan yana tek bir görsele** dizer (asıl çözünürlükte, ≤ 3,7 MP, JPEG 0,8).
  Böylece `run.ts` tek görselle kalır, şerit ~375 px yerine asıl genişliğinde okunur. Yakın görünüm aynı istekte
  (`POST /api/foto`, isteğe bağlı ikinci dosya `yakin`, en çok 2 MB) yüklenir ve fotoğrafın anahtarından türetilen
  anahtarla (`…/{uuid}-yakin.jpg`) saklanır: migration gerekmez; fotoğrafla birlikte silinir (`cleanupPhotos` ve silme
  yolları türetilmiş anahtarı da siler), yönetici fotoğrafın yanında "yakın görünüm" olarak açabilir (kanıt: personel
  başka bir kâğıdın yakın görünümünü yükleyemesin diye yöneticinin gözü önünde). İkinci okuma yalnız bu görselle,
  `OKC_TASK + OKC_CLOSEUP` ile yapılır. Değerlendirme şu üçünü karşılaştırır: (i) aynı görselin yeniden okunması,
  (ii) yakın görünüm, (iii) üst / alt yarı iki fotoğraf. (i) (ii)'den ölçülerek üstün çıkmadıkça eklenmez.

### 4.4 Model, efor, süre, maliyet

| Okuma | Model | Efor | `max_tokens` | Süre (deneme / yeniden / toplam) |
|---|---|---|---|---|
| ModPOS Z, eski banka fişi, alışveriş fişi | `claude-opus-5-5` | `low` (değişmez) | 6000 | 20 sn / 1 / 45 sn (değişmez) |
| Yazarkasa Z (PR-b) | `claude-opus-5-5` | **`low`** (varsayılan; `medium` yalnız aşağıdaki kuralla) | 8000 | **tek 50 sn'lik deneme**; yeniden deneme yalnız hızlı dönen hatada (529, bağlantı) ve kalan süre içinde |
| Yakın görünüm (PR-c) | `claude-opus-5-5` | ilk okumanınki | 8000 | aynı |

- Opus 5.5'te düşünme kapatılamaz (efor tek ayar, varsayılanı `medium`); `thinking` gönderilmez. Yedek model
  (`server-side-fallback-2026-07-01`, `fallbacks: "default"`) aynen.
- Süre: `{ timeout: 50_000, maxRetries: 1, totalMs: 50_000 }`. SDK zaman aşımını da yeniden dener, ama toplam süre
  sinyali 50 sn'de kestiği için zaman aşımından sonra yeniden deneme kalmaz; 529 ya da bağlantı hatası birkaç saniyede
  döndüğünden ona kalan süre içinde bir yeniden deneme düşer. 30 sn'de kesip yeniden denemek (eski plan) ikinci denemeye
  ~20 sn bırakıyordu: o deneme de neredeyse kesin düşer ve bir okuma hakkı harcanırdı. Yol `maxDuration = 60` aynen.
- Hız: depodaki ölçümler (`low`, 184–577 çıktı token, 4–9 sn) saniyede ~70–100 çıktı token'ı gösteriyor. Örnek Z'nin
  `KasaOkcRaw` JSON'u ~3.000 karakter, ~1.000 token: yalnız JSON ~10–15 sn. `medium`'un 1–3 bin, `high`'ın 2–6 bin
  düşünme token'ı eklenince ~15–40 sn ve ~25–75 sn eder: `high` kapanış saatine sığmaz ve hiçbir okumada kullanılmaz.
  Bu yüzden şema küçültülür (§4.1).
- İkinci okumada başka model yok: Sonnet'in daha zayıf görmesi anlaşmazlık gürültüsü üretir; Fable 5.1 2,5 kat pahalı ve
  60 sn'lik yola sığmayabilir. `xhigh` / `max` kullanılmaz.
- **Efor, değerlendirmeyle kesinleşir** (§10): gerçek fotoğraflar `low` ve `medium` ile üçer kez okunur. Karar kuralı
  yalnız alan doğruluğuna değil, üç sayıya bakar: **yanlış dolum**, **"doğrulandı ama yanlış"** ve **gecikme**. `medium`
  ancak ilk ikisini `low`'a göre düşürüyor ve ilk okuma p90 ≤ 20 sn tutuyorsa seçilir; yoksa `low` kalır. `low`'da
  "doğrulandı ama yanlış" 0 ise (beklenen: saf aktarım), `medium`'da > 0 çıkması tek başına `medium`'u eler (model
  rakamı toplamdan "çözüyor" demektir). Sonuç ve tablo `docs/planlar/ekler/okc-z/eval.md`'ye.
- **Maliyet tahmini** (Opus 5.5: girdi 4 $, çıktı 20 $ / milyon token): bugünkü Z isteğinde görsel dışı metin ~3,6 bin
  token; yeni şema ve `OKC_TASK` (~1 bin) ile görsel dışı ~5–6 bin, görselle ~9–11 bin token ≈ 0,04 $; çıktı `low`
  ~0,7–1,5 bin token ≈ 0,01–0,03 $. Yazarkasa Z başına ~0,05–0,07 $ (`medium` seçilirse ~0,06–0,10 $), yakın görünümle
  (PR-c) ~0,10–0,20 $; ayda ~2–4 $ ek. **Gerçek girdi adım b2'de `count_tokens` ya da ilk canlı çağrının `usage`'ıyla
  ölçülür**; S8 ve `docs/FOTOGRAF.md` ölçülen rakamla yazılır. Zaman aşımına düşen denemenin `usage`'ı dönmediği için
  `ai_calls`'ta 0 $ görünür (istek sunucuda tamamlanıp ücretlendirilmiş olabilir): maliyet satırları bu yüzden eksik
  sayar, `docs/FOTOGRAF.md` §5'te yazılır. Günlük okuma sınırı (40) değişmez; yakın okuma ona sayılır.
- `ExtractRequest`'e `effort?: "low" | "medium"`, `timeouts?` eklenir; `MODEL_REQUEST` varsayılan kalır.
  `ai_calls`'a `effort` sütunu (§6.2): canlıda hangi okumanın hangi eforla yapıldığı ve tutarı görülsün.

---

## 5. Denetimler (saf kod)

İki yeni saf modül:
- `src/lib/okc-z.ts`: yazarkasa alanlarının kimlikleri (okuma ve form ortak), ModPOS karşılaştırması (§8), metinler,
  `okcMonth()` (§9). `server-only` yok, istemciye girer.
- `src/lib/photo-read/okc.ts`: `normalizeOkc`, alan durumları (PR-b); `mergeReads`, `canReadCloser` (PR-c).
  `okc-z.ts`'i kullanır.

### 5.1 Günlük ve kümülatif

- Günlük alanlara yalnız günlük satırlar gider; kümülatif yalnız `cumulative*` alanlarına (istem + şema).
- Kodda ayrıca: günlük toplam kümülatife eşitse (±0,01) ve önceki kümülatif biliniyorsa → `okcTotal` **tutmadı**
  (`Günlük toplam kümülatif satırla aynı; KÜM. satırı okunmuş olabilir.`).
- Kümülatif < günlük toplam → kümülatif yok sayılır (kaydedilmez), bilgi satırı yok. Kümülatifin ne zaman saklandığı
  §6.1'de (inandırıcılık kuralı).
- Günlük toplam son 28 günün yazarkasa toplamlarının (yoksa ModPOS toplamlarının) ortancasının 5 katından **ve**
  50.000 ₺'den büyükse → `okcTotal` tutmadı: `Günlük toplam için çok büyük (1.259.350 ₺); KÜM. (kümülatif) satırı
  okunmuş olabilir.`
- "GENEL TOPLAM" etiketi (`dailyTotalLabel`) kümülatif satırların yanındaysa ya da zincir tutmuyorsa tutmadı sayılır;
  NET SATIŞ / MALİ VERİ TOPLAM / TOPSAT tercih edilir (istem).

### 5.2 Kimlikler

Tutarlar kuruşa kadar toplanan değerlerdir; KDV fiş fiş yuvarlandığı için formülde pay bırakılır.
`SUM_TOL = 0,05 ₺`; `VAT_TOL = max(0,05 ₺; 0,005 × fiş sayısı)`, fiş sayısı yoksa 1 ₺.

**Doğrulama kuralı (D7).** Bir kimlik bir alanı ancak iki tarafı **farklı basılı rakamlardan** geliyorsa doğrular.
Aynı rakamın iki kopyasını karşılaştıran kimlik (tek oranlı günde K1: %10 TOPLAM = NET SATIŞ; K2: %10 KDV = TOPKDV; tek
ödemeli günde K4: K.KARTI = TOPLAM) yalnız **"çelişki yok"** verir: tutmazsa yine "tutmadı" yapar, tutarsa alan
"denetlenemedi" gibi güvenine göre dolar. Benzer satırlarda modelin hataları ilişkilidir; aynı rakamı aynı yanlışla
iki yerde okursa kopya kimliği tutar.

**K3'ün çözünürlüğü.** KDV fiş fiş yuvarlandığı için K3'ün payı fiş sayısıyla büyür: 143 fişte VAT_TOL ≈ 0,72 ₺, bu da
%10'da toplamdaki ~8 ₺'den küçük bir hatayı (birler basamağında 3/8, kuruşlar) göremez demektir. K3 bu yüzden hiçbir
alanı doğrulamaz, yalnız çürütür (büyük hataları, MATRAH / KÜM. karışmasını yakalar).

| # | Kimlik | Tolerans | Doğrular mı | Tutarsa doğrular | Tutmazsa "tutmadı" | Metin (yönetici; personel metni §3.6) |
|---|---|---|---|---|---|---|
| K1 | Σ oran toplamları = günlük toplam | SUM_TOL | yalnız sıfır olmayan **≥ 2** oran grubuyla | `okcTotal`, `okcT*` | `okcT*`; başka bir kimlik doğrulamadıysa `okcTotal` da | `Oranların toplamı (11.480 ₺) günlük toplamı (11.540 ₺) tutmuyor; fişe bakın.` |
| K2 | Σ oran KDV'leri = toplam KDV | SUM_TOL | yalnız sıfır olmayan **≥ 2** oran grubuyla | `okcVatTotal`, `okcV*` | `okcV*`; K6-KDV doğrulamadıysa `okcVatTotal` da | `Oranların KDV'si (943,94 ₺) toplam KDV'yi (979,94 ₺) tutmuyor; fişe bakın.` |
| K3 | Her oran: KDV ≈ toplam × r / (100 + r); MATRAH basılıysa MATRAH + KDV = toplam | VAT_TOL; SUM_TOL | **hayır** (yalnız çürütür) | — | doğrulanmamış olanı (ikisi de değilse ikisi) | `%10 KDV'si 773,27 ₺; bu toplamdan beklenen 737,27 ₺. Rakamlardan biri yanlış okunmuş olabilir.` |
| K4 | Σ ödemeler (nakit + kart + yemek + diğer + tanınmayan) = günlük toplam; ya da = günlük toplam + Σ yazarkasa dışı | SUM_TOL | yalnız sıfır olmayan **≥ 2** ödeme türüyle | `okcTotal`, ödeme alanları | ödeme alanları; başka bir kimlik doğrulamadıysa `okcTotal` da | `Ödemelerin toplamı (11.420 ₺) günlük toplamı (11.540 ₺) tutmuyor; fişe bakın.` |
| K5 | Toplam KDV ÷ günlük toplam, okunan oranların r/(100+r) aralığında (oran yoksa 1/101–1/6), ±0,002 | — | hayır | — | `okcVatTotal`; doğrulanmadıysa `okcTotal` | `Toplam KDV günlük toplamın %21'i; %9–%17 olmalı. KÜM. ya da MATRAH satırı okunmuş olabilir.` |
| K6 | Zincir: Z no = önceki + 1 ise kümülatif − önceki saklanan kümülatif = günlük toplam (KDV için de). Yalnız §1 adım 0 madde 1 KÜM. satırlarını doğrularsa | SUM_TOL | evet | `okcTotal` (`okcVatTotal`), `okcZNo` | `okcTotal` başka bir kimlik doğrulamadıysa; doğruladıysa kümülatif saklanmaz (§6.1) | `Önceki Z'den (0187) bu yana kümülatif artış 11.450 ₺; günlük toplam 11.540 ₺. Biri yanlış okunmuş olabilir.` |
| K7 | Banka alt satırları kart satırına eklenmez; Σ alt satır ≈ kart (uyarı) | SUM_TOL | hayır | — | — (yalnız bilgi) | `Banka satırlarının toplamı kart satırını tutmuyor; kartı fişle karşılaştırın.` |
| K8 | Eski oran (%8, %18) satırında tutar yok; oran {1, 10, 20, 8, 18, 0} dışında değil | — | hayır | — | o grup | `Eski KDV oranı (%18) satırında tutar var; fişe bakın.` |
| K9 | Fiş sayısı tam sayı, 0–5.000 | — | hayır | — | `okcReceipts` | `Fiş sayısı alışılmadık (71.000); fişe bakın.` |

Kurallar: bir alan önce "tutmadı" (herhangi bir kimlikte) → sonra "doğrulandı" (yalnız "Doğrular mı: evet" olan ve
koşulu sağlanan kimlikle) → yoksa "denetlenemedi". Kimliğin bir ucu okunmamışsa kimlik çalışmaz (denetlenemedi). Ödeme
türü `drawer` (KASA NAKİT) toplamaya girmez. Z no'yu doğrulayan ayrıca §5.3'tür (önceki + 1; önceki kayıttan gelir).

**Kart satırı olmayan cihaz.** `card` türünde satır yoksa ve `bank_subline` satırları varsa: kart = Σ `bank_subline`
(yöneticiye bilgi satırı `Z'de kart satırı yok; banka satırları toplanıp kart yazıldı.`), K7 çalışmaz. Varsa
`bank_subline` hiçbir zaman karta eklenmez.

### 5.3 Z no sürekliliği

Önceki: `previousOkc(day)` = `{ z: { date, zNo } | null, cum: { date, zNo, cumTotal, cumVat } | null }`: bu günden
önceki `okc_z_no` dolu son rapor ve `okc_cum_total` dolu (yani inandırıcı bulunup saklanmış, §6.1) son rapor. K6, Z no
farkını `cum.zNo`'ya göre alır: arada saklanmamış günler varsa kümülatif farkı o günlerin toplamını da içerir, zincir o
zaman doğrulamaz, yalnız "kümülatif büyüdü mü" diye çürütür. Geç rapor için ayrıca `nextOkc(day)` (sonraki halka,
§3.8). Personelin formuna yalnız `z` gider (D17).

| Durum | Sonuç | Metin |
|---|---|---|
| bu = önceki + 1 | `okcZNo` doğrulandı (K6'yı açar) | — (zincir tutarsa §3.3 bilgi satırı) |
| bu > önceki + 1 | bilgi; önceki rapor bir gün önceyse uyarı (`okcZNo` turuncu) | `Önceki yazarkasa Z'si 0186 (20 Ekim); bu 0188. Arada 1 Z raporu girilmemiş.` / önceki gün ise `… Bir günde iki Z alınmış ya da Z no yanlış okunmuş olabilir.` |
| bu = önceki | okumanın bütünü durur (§3.3) | `Bu Z no (0187) 21 Ekim raporunda da var; dünkü Z raporu olabilir.` |
| bu < önceki | `okcZNo` tutmadı | `Z no (0012) önceki yazarkasa Z'sinden (0187) küçük; eski bir Z raporu ya da FİŞ NO / EKÜ NO okunmuş olabilir.` |
| önceki yok | denetlenemedi | — |

ModPOS Z no'su ve dalga 10'un `zNoOrder` / geç rapor zinciri değişmez; yazarkasa Z no ayrı sayaçtır.

### 5.4 Tarih

- `businessDayOf(date, time)` (05:00 kuralı) raporun günü değilse: bugünkü uyarı `Fişteki tarih …; bu rapor … için.
  Doğru günün Z raporu mu?` (`whole: true`, kayıttaki farklar alarm sayılmaz).
- İstisna (yalnız §1 adım 0 madde 2 Z'nin elle ve bazen ertesi sabah alındığını doğrularsa): basılı gün = rapor günü
  + 1, saat ≥ 05:00 ve Z no = önceki + 1 → yöneticiye bilgi: `Z ertesi sabah alınmış (25 Ekim 09:12); bu güne
  yazıldı.` Cihaz Z'yi kendiliğinden (ör. 23:59'da) alıyorsa istisna yoktur ve 05:00 kuralı yalnız gece yarısından
  sonraki elle alınan Z için kalır.
- `dateConfidence` `low` ise tarih denetlenmez.

### 5.5 Banka gün sonu fişi (yedek)

- `batch_slip`: yalnız `bankPos` dolar (Σ `netTotal`; net yoksa satış − iade, bugünkü `normalizePos` kuralları:
  net ≠ satış − iade uyarısı, başka günün fişi). Bilgi: `Bu banka gün sonu fişi; yalnız Banka gün sonu doldu. Yazarkasanın
  Z raporunu da çekin.`
- `z_report` + `batches` (aynı şeritte): Z alanları ve `bankPos` birlikte; iki banka fişi varsa toplanır ve
  `2 banka gün sonu toplandı: 8.915 ₺.` yazar.
- İkinci bir banka fişi fotoğrafı: bugünkü "Toplama ekle / Yerine yaz" sorusu (`posPromptMarks`), yalnız `bankPos` için.

### 5.6 Yakın okuma ve birleştirme (PR-c)

`canReadCloser(reading, readsLeft, hasCloseup)` doğruysa yanıtta `closerRead: true` (düğme, §3.5; kendiliğinden
istek yok):
- belge `z_report` ve okunabilir; **ve**
- şu alanlardan biri "tutmadı" ya da `low`: `okcTotal`, `okcCash`, `okcCard`, `okcZNo`; **ve**
- fotoğrafın yakın görünümü saklı; **ve**
- yakın okumadan sonra **en az bir** okuma hakkı kalacak (`readsLeft ≥ 2`; `MAX_READS_PER_PHOTO` 3 hata dahil her
  `ai_calls` satırını sayar: ilk okuma, bir zaman aşımı ve yakın okuma hakkı bitirirse yanlış bölüme çekilen fotoğraf
  artık "öbür bölüme okut"ulamaz).

Sunucu (`readPhotoFor("kasa-okc", { closeup: true })`): yakın görünümü `OKC_TASK + OKC_CLOSEUP` ile, ilk okumanın
eforuyla okur; sonra bu fotoğrafın bütün başarılı `kasa-okc` okumalarını (`ai_calls`, eskiden yeniye) `mergeReads`
ile birleştirir:
- iki okumada aynı (±0,005) → değer; güven **değişmez** (ikisinin düşüğü). İki okumanın aynı çıkması hiçbir zaman
  güveni yükseltmez ve alanı doğrulamaz (D9).
- farklı → her okumanın kendi değeriyle kimlikler çalıştırılır; yalnız birinde doğrulanan alınır (turuncu, §3.5),
  ikisinde de doğrulanmazsa iki değer ayrı öneri olur (varsayılan yok).
- belge türü, tarih ya da Z no okumalar arasında farklıysa birleştirme yapılmaz: ilk okuma kalır ve yöneticiye
  `Yakın görünüm başka bir kâğıt gibi okundu (Z no 0188 / 0012).` (personel başka bir kâğıdın yakın görünümünü
  yükleyemesin).
- Sonra `normalizeOkc(merged, ctx)` aynı denetimlerle.

Kayıtlı raporun okuması (`readingOf`, "Fotoğraftan farklı") PR-c'de aynı birleştirmeyle kurulur (`ai_calls`'ta ek işaret
gerekmez); PR-b'de bugünkü gibi son başarılı okumadır.

---

## 6. Veri

### 6.1 `cash_reports` (yeni, hepsi boş bırakılabilir)

| TS | Sütun | Tür | Kaynak | Anlam |
|---|---|---|---|---|
| `okcZNo` | `okc_z_no` | text | form | Z NO / Z SAYAÇ (metin; baştaki sıfırlar korunur) |
| `okcReceipts` | `okc_receipts` | integer | form | satış fişi adedi |
| `okcTotal` | `okc_total` | double precision | form | günlük toplam, KDV dahil |
| `okcVatTotal` | `okc_vat_total` | double precision | form | günlük TOPKDV |
| `okcVat` | `okc_vat` | jsonb `{rate,total,vat}[]` | form | oran oran; sıfır gruplar yazılmaz, orana göre sıralı |
| `okcCash` | `okc_cash` | double precision | form | NAKİT |
| `okcCard` | `okc_card` | double precision | form | K.KARTI / KREDİ (alt satırlar hariç) |
| `okcMealCard` | `okc_meal_card` | double precision | form | yemek kartı |
| `okcOther` | `okc_other` | double precision | form | diğer + tanınmayan |
| `okcCumTotal` | `okc_cum_total` | double precision | **sunucu** (okuma) | KÜM. TOPLAM |
| `okcCumVat` | `okc_cum_vat` | double precision | **sunucu** (okuma) | KÜM. TOPKDV |
| `okcOutside` | `okc_outside` | double precision | **sunucu** (okuma) | yazarkasa toplamı dışındaki tahsilatlar |

- `bank_pos`: yorumu "Banka gün sonu fişinin net toplamı (yazarkasa Z'sinin kart satırı değil; eski raporlarda tek
  kart kanıtı)" olur; anlamı ve değerleri değişmez.
- Sunucu sütunları (D10) **`writeCashReport`'ta** hesaplanır (dalga 10'dan sonra `src/server/cash/report-store.ts`):
  rapora bağlı ve bu yazımda bağlanan (`photos`) `kasa-okc` fotoğraflarının okumasından (PR-c'de birleşik okuma).
  Böylece normal gönderim, düzenleme, "Düzeltip onayla" ve dalga 10'un geç rapor onayı (`reviewLate` →
  `writeCashReport(…, { photos: link })`) aynı kuralla yazar; her yazımda yeniden hesaplanır.
  1. Okunan Z no kaydedilen `okcZNo`'ya **ve** okunan günlük toplam kaydedilen `okcTotal`'a (±0,01) eşit değilse üçü de
     boş.
  2. `okcOutside` 1'i geçerse yazılır.
  3. `okcCumTotal` / `okcCumVat` yalnız **inandırıcıysa** yazılır: (a) `previousOkc().cum` var, Z no = onun + 1 ve
     kümülatif − önceki kümülatif = günlük toplam (SUM_TOL; K6 tutuyor); ya da (b) önceki saklanan kümülatif yok ve
     kümülatif ≥ günlük toplam; ya da (c) Z no aralığı > 1 ve kümülatif − önceki kümülatif ≥ günlük toplam (arada
     girilmemiş Z'ler). Değilse boş; yöneticinin kayıtlı raporunda §3.7'deki "saklanmadı" satırı. Zincir hep son
     **saklanan** kümülatife bağlanır, böylece yanlış okunmuş bir kümülatif ertesi günün doğru toplamını
     "tutmadı" yapamaz.
  - Elle girilen raporda boş. Personel ve form bunları göndermez; `CashReportFields`'ta değil (DTO'da, yalnız
    yöneticiye).
  - **Kümülatifi temizle** (yalnız yönetici, `src/server/actions/cash-report.ts`'e küçük bir eylem; dalga 10'dan sonra
    `src/server/cash/`): iki kümülatif sütunu boşaltır, olay kaydına düşer, raporun sürümünü değiştirmez (personelin
    yazdığı alan değil).

### 6.2 `ai_calls`

- Yeni `effort` text (boş bırakılabilir; `low` | `medium`). `extract()` yazar.
- `feature` yorumu `"kasa-z" | "kasa-pos" | "kasa-okc" | "fis" | "fatura"`.

### 6.3 Türler (yalnız TypeScript; text sütunu, CHECK yok, migration gerekmez)

`photos.kind` ve `cash_report_photos.kind` enum'larına `kasa-okc`.

### 6.4 Migration

PR-b'de. `npm run db:generate -- --name okc_z`, R2 ile birleştirme anında, dalga 10 (0038) ve öncekiler birleştikten sonra.
Yalnız `ADD COLUMN` (`cash_reports`'a 12, `ai_calls`'a 1 sütun); dolu tabloda kilit kısa, varsayılan yok, geri dönüş gerekmez. `drizzle/meta` elle
birleştirilmez.

### 6.5 Hesap (`src/lib/cash-report.ts`)

- `CashReportFields` + `okcZNo`, `okcReceipts`, `okcTotal`, `okcVatTotal`, `okcVat`, `okcCash`, `okcCard`,
  `okcMealCard`, `okcOther` (hepsi `?: … | null`; eski kopyalarda, dalga 10'un bekleyen isteklerinde ve elle kurulan
  raporlarda olmayabilir: boş sayılır).
- `computeCash`: `cardDiff = (okcCard ?? bankPos) − card` (ikisi de yoksa null) ve yeni `cardSource: "okc" | "bank" |
  null`. Eski satırda `okcCard` boş → bugünkü sonuç birebir.
- `CHANGE_LABELS`: `okcZNo` "Yazarkasa Z no", `okcReceipts` "Yazarkasa fiş sayısı", `okcTotal` "Yazarkasa toplam",
  `okcVatTotal` "Yazarkasa KDV", `okcVat` "KDV dökümü" (`KDV dökümü değişti`), `okcCash` "Yazarkasa nakit",
  `okcCard` "Yazarkasa kart", `okcMealCard` "Yazarkasa yemek kartı", `okcOther` "Yazarkasa diğer"; `bankPos`
  "Banka POS" → **"Banka gün sonu"**. `SENSITIVE` değişmez.
- **`okcVat` metin gibi karşılaştırılmaz.** `TEXT_FIELDS` yolu `String(dizi)` yapar ("[object Object]"): aynı uzunlukta
  iki farklı döküm eşit sayılır ve "KDV dökümü değişti" hiç çıkmaz. Dalga 10'un `cash-requests.ts` › `same()`'inde dizi
  sayı yoluna düşer, `Number(dizi)` NaN verir ve öneri hep "değişti" görünür. İkisi de tek bir saf karşılaştırıcıyı
  kullanır: `sameVat(a, b)` (`src/lib/okc-z.ts`): boş ve `[]` eşit; sıfır gruplar atılır, orana göre sıralanır, tutarlar
  kuruşa yuvarlanır, `JSON.stringify` ile kıyaslanır. `revisionChanges`'te `okcVat` için özel dal, `same()`'de
  `k === "okcVat"` dalı.
- `revisionDataOf`, `PLAIN_FIELDS` (`okcZNo`, `okcReceipts`) güncellenir.

### 6.6 Okuma alanları (`src/lib/photo-read/kasa.ts`)

- `CashPhotoKind = "kasa-z" | "kasa-pos" | "kasa-okc"`.
- `ReadField` + `okcZNo`, `okcReceipts`, `okcTotal`, `okcVatTotal`, `okcCash`, `okcCard`, `okcMealCard`, `okcOther`,
  `okcT1`, `okcV1`, `okcT10`, `okcV10`, `okcT20`, `okcV20` (ModPOS anahtarlarından ayrı: çapraz karşılaştırma olmaz).
- `FIELD_LABELS` bunlar için ("%10 toplam", "%10 KDV"…) ve `bankPos` → "Banka gün sonu"; `MONEY_FIELDS`, `fieldText`,
  `sameValue` (`okcZNo` Z no gibi, `okcReceipts` tam sayı).
- `ReadValue` + `status?: "confirmed" | "failed"`, `reason?: string`. `prefillPlan`: `failed` → `unsure` listesine,
  `reason` ile. `PrefillPlan.unsure[]` + `reason`.
- `savedFields`: `okc*` ve `okcVat`'tan `okcT*` / `okcV*`.
- `photoDiffs` / `suspiciousDiffs`: değişmez; `failed` ya da iki okuma farklı alan `excused` sayılır.

---

## 7. Sunucu

- `src/server/ai/run.ts`: `AiFeature` + `"kasa-okc"`; `ExtractRequest` + `effort`, `timeouts`; `buildRequest` bunları
  uygular (fotoğraf isteğinin öteki alanları aynı).
- `src/server/ai/claude.ts`: `extractImage` `effort`, `maxTokens`, `timeouts` geçirir; `ai_calls.effort` yazar.
- `src/server/ai/replay.ts` + `tests/fixtures/foto/okc.json`, `okc-batch.json`, `okc-yanlis-toplam.json`,
  `okc-tek-oran.json` (PR-c'de `okc-yakin.json`: yakın okuma yolunu `AI_REPLAY=1`'de denemek için).
- `src/server/photo-read/read.ts`:
  - `readPhotoFor(kind: "kasa-z" | "kasa-okc" | "fis", input & { closeup?: boolean })` (`closeup` PR-c).
  - `previousOkc(day)` (§5.3) ve `okcTypical(day)` (son 28 gün ortancası) paralel okunur. **Zincir denetimi burada,
    sunucuda** yapılır (D17).
  - `kasa-okc`: `OKC_TASK`, `KasaOkcRaw`, efor §4.4'ün kararı. `ReadOutcome` + (PR-c) `closerRead: boolean`.
  - **Personele giden okuma** (`toStaffReading`): `cumulativeTotal`, `cumulativeVat`, `outside` ve yöneticiye ait
    bilgi satırları (§3.3) çıkarılır; K6'nın sonucu yalnız alan durumu (doğrulandı / tutmadı) olarak kalır. Yönetici
    tam okumayı alır. Ham sonuç `ai_calls.result`'ta tam durur (yönetici ve `readingOf` için).
- `src/lib/photo-read/reading.ts`: `PhotoUploadResponse` + (PR-c) `closerRead`.
- `src/app/api/foto/route.ts` ve `src/app/api/foto/[id]/oku/route.ts`: tür enum'u + `kasa-okc`; (PR-c) `oku` gövdesi +
  `yakin?: boolean` (yalnız `kasa-okc`, fotoğrafın yakın görünümü ve en az bir başarılı `kasa-okc` okuması varsa;
  yoksa 400) ve yükleme yolunda isteğe bağlı `yakin` dosyası. Kasa türleri arasında geçiş: `kasa-z` ↔ `kasa-okc`;
  `kasa-pos` → `kasa-okc`. `maxDuration = 60` aynen.
  - **Geçiş (D2):** `tur=kasa-pos` ile gelen yükleme ve `{ tur: "kasa-pos" }` ile gelen yeniden okuma reddedilmez:
    fotoğraf `kasa-okc` yapılır (`setPhotoKind`), `OKC_TASK` ile okunur, sonuç `ai_calls`'a `kasa-okc` olarak yazılır.
    Yanıt **eski biçimde** döner (`kind: "kasa-pos"`, değerlerde yalnız `bankPos`, o da yalnız okunan banka gün sonu
    fişinden; yazarkasa Z'sinin toplamı ya da kartı asla), böylece eski sayfa ne yanlış rakam yazar ne tanımadığı
    alanla karşılaşır. Sonraki açılışta yeni sayfa aynı fotoğrafı `kasa-okc` olarak görür. Kaldırma ayrı bir sonraki
    PR'da (en erken iki hafta sonra; dalga 10'un bekleyen geç raporlarında `kasa-pos` kalmadığı denetlenerek).
- `src/lib/photo-rules.ts`: `PhotoKind`, `PHOTO_KINDS`, `KEEP_DAYS["kasa-okc"] = 400`, `PHOTO_KIND_LABEL["kasa-okc"] =
  "Banka POS Z"`; dalga 10'un `uploadRule`'u değişmez (fiş dışı her tür "open-or-late").
- `src/server/storage/photo-access.ts` › `PHOTO_RULES`: `kasa-okc` personel görme kuralı `cashPhotoRules`'unki,
  saklama kendi `KEEP_DAYS`'i (bugünkü `cashPhotoRules.keepDays` `kasa-z`'ye bağlı: türe göre ayrılır).
- Yazım yolu (dalga 10'dan sonra `src/server/cash/report-store.ts`): `reportSchema` + yazarkasa alanları (§3.2
  zorunluluk, oranlar {0,1,8,10,18,20}, 0 ≤ KDV ≤ toplam); fotoğraf türü denetimine `kasa-okc` (geçişte `kasa-pos`
  de); sunucu sütunları `writeCashReport`'ta (§6.1); yöneticinin **Kümülatifi temizle** eylemi.
- `src/lib/cash-requests.ts` (dalga 10): `CashFieldsSchema` + yazarkasa alanları **`.optional()`** (veritabanında
  bekleyen eski istekler bu anahtarları taşımaz); `okcVat` `{ rate, total, vat }[]` olarak `.optional()` doğrulanır
  (`rate` ∈ {0, 1, 8, 10, 18, 20}, `total` ve `vat` ≥ 0, `vat ≤ total`, oran tekrarsız); `FIELD_KEYS` + yazarkasa
  alanları; `same()`'e `okcVat` dalı (`sameVat`, §6.5); `LatePayload.photos`
  kind enum'u + `kasa-okc`.
- `src/server/cash/late.ts`: kabul edilen türler + `kasa-okc`; `kasa-z` zorunluluğu aynen. Onayda sunucu sütunları
  `writeCashReport` üzerinden yazılır (ayrı kod yok; test bunu sabitler). Onay kartının yükleyicisi `previousOkc` ve
  `nextOkc` ile iki yanı denetler (§3.8).
- `src/server/data/cash-photos.ts`: `readingOf("kasa-okc")` birleştirerek; `extrasFrom` → `photos: { z, okc, pos }`;
  dalga 10'un `heldPhotoInfo` / `photoReadingOf`'u yeni türü tanır.
- `src/server/cash-outs/requests.ts` › `removalCheck` (dalga 10): tür birliği + `kasa-okc`; tek yazarkasa Z
  fotoğrafı, ModPOS Z'ninkiyle aynı kuralla korunur (§16 S4).
- `src/server/data/cash-reports.ts`: DTO + yazarkasa alanları (sunucu sütunları yalnız yöneticinin DTO'sunda),
  `previousOkc`, `nextOkc`, `okcRows(from, to)` (§9).
- `src/app/panel/kasa/page.tsx`: forma `prevOkcZ: { date, zNo } | null` (§3.6 Z no denetimi; kümülatif değil, D17),
  yönetici ay kartına §8 satırı.

---

## 8. Mutabakat satırları (ModPOS ↔ yazarkasa ↔ banka)

`okcReconcile(f: CashReportFields, audience: "staff" | "admin"): { key; tone: "good" | "info" | "warn"; text; diff }[]`
(`src/lib/okc-z.ts`). Tolerans her satırda `CASH_TOLERANCE` (1 ₺). Satır yalnız iki tarafın da değeri varsa çıkar.
**Personel** (`"staff"`) yalnız Kart satırını ve "Kendi içinde" satırını alır; öteki satırlar yalnız yöneticide (İlke 8,
D13, §16 S2). Personelin ekranına giden veride de öteki satırlar yoktur (sunucu `"staff"` ile çağırır; test, §11).

| Satır | Kim görür | Fark | Tutuyorsa (yeşil) | Tutmuyorsa | Ton |
|---|---|---|---|---|---|
| Kart | personel + yönetici | yazarkasa kartı − ModPOS kart | `Kart: yazarkasa ile ModPOS aynı.` | `Yazarkasa kartı, ModPOS'taki karttan 120 ₺ fazla. Kartla alınan bir ödeme ModPOS'ta başka ödeme türüyle girilmiş olabilir.` | uyarı |
| Kart (yazarkasa kartı yok, banka var) | personel + yönetici | banka gün sonu − ModPOS kart | `Kart: banka gün sonu ile ModPOS aynı.` | `Banka gün sonu, ModPOS'taki karttan 120 ₺ fazla.` | uyarı (bugünkü) |
| Kendi içinde | personel (tek satır, §3.6) + yönetici (ayrıntılı) | §3.6 denetimleri, kayıtlı değerlerde | — | yönetici: `Yazarkasa Z'si kendi içinde tutmuyor: ödemelerin toplamı 11.420 ₺, günlük toplam 11.540 ₺.` | uyarı |
| Nakit | yönetici | yazarkasa nakdi − ModPOS nakit | `Nakit: yazarkasa ile ModPOS aynı.` | `Yazarkasa nakdi, ModPOS'taki nakitten 60 ₺ az.` | bilgi |
| Toplam | yönetici | ModPOS toplam − yazarkasa toplam | `Toplam: iki Z aynı.` | fark ≈ online + diğer (1 ₺): `ModPOS toplamı 1.435,50 ₺ fazla; online ve diğer satışlar kadar (yazarkasadan geçmez).` · değilse `ModPOS toplamı yazarkasadan 2.100 ₺ fazla.` | bilgi |
| Yemek kartı | yönetici | yazarkasa − ModPOS (ikisi de > 0) | — | `Yazarkasa yemek kartı, ModPOS'takinden 50 ₺ az.` | bilgi |
| Banka | yönetici | banka gün sonu − yazarkasa kartı | `Banka gün sonu yazarkasa kartıyla aynı.` | `Banka gün sonu, yazarkasa kartından 40 ₺ fazla (bir gün gün sonu alınmadıysa iki günü kapsar).` | bilgi |

Nerede:
- **Form (personel):** yazarkasa kartının altında yalnız Kart satırı ve gerekirse tek özet satırı. Bugünkü "Banka POS,
  ModPOS'taki karttan …" satırı Kart satırına dönüşür. Yönetici formu düzenlerken bütün satırları görür.
- **Kayıtlı rapor:** `CashBreakdown` "Banka POS Z" bölümünün altında; personel yalnız kendi gördüğü satırları.
- **Günden güne (yönetici):** `Kart ±` (uyarı satırı), `Yazarkasa tutmuyor`, `Yazarkasa Z yok` rozetleri (§3.7).
  Toplam ve nakit farkı rozet almaz (meşru olabilir).
- **WhatsApp** (`whatsappText`; personel de gönderir, grup güvenli kanal değildir): "Kart" bloğunun yerine yalnız:

```
*Banka POS Z raporu*
Z no: 0188
• Nakit: 2.625 ₺
• Kredi kartı: 8.915 ₺
✅ Kart ModPOS ile aynı            (ya da ⚠️ Yazarkasa kartı ModPOS'tan 120 ₺ fazla)
Banka gün sonu: 8.915 ₺ ✅
```

- **E-posta** (`cash-report-template.ts`; alıcıları yönetici seçer): WhatsApp bloğu + `Günlük toplam: 11.540 ₺ (KDV
  1.049,09 ₺) · 143 fiş` + yöneticinin satırları (toplam, nakit, yemek kartı, banka, kendi içinde).
- Yazarkasa alanları boş, `bankPos` dolu (eski ya da yedek): bugünkü "*Kart*" bloğu, etiket "Banka POS" (§3.7).
  Fotoğraf satırı: `📷 ModPOS Z ve banka POS Z fotoğrafı panelde` (`photosLine({ z, okc, pos })`; eski `pos` "banka
  fişi"). E-postada `Fotoğraflar panelde: ModPOS Z, banka POS Z`.
- **Yönetici ay kartı** (Kasa sayfası, "Ay bilgisine gider"in altında, yalnız yönetici):
  `Yazarkasa (mali) toplamı: 381.809 ₺ · 28 / 30 gün · ModPOS toplamından %11 az` ve `KDV: %10 34.710 ₺ · %20 0 ₺`.
  Yalnız bilgi; hiçbir hesaba girmez (§9).

---

## 9. Aşağı akış

**Bu dalgada:** yalnız saf okuyucu, hiçbir ekranın hesabı değişmez.

```ts
// src/lib/okc-z.ts
export interface OkcMonth {
  month: string;                 // YYYY-MM
  reportDays: number;            // Z toplamı > 0 rapor günü
  days: number;                  // yazarkasa toplamı girilmiş gün
  missing: string[];             // Z toplamı > 0 ama yazarkasa yok
  vatDays: number;               // KDV dökümü (okcVat) de girilmiş gün
  vatMissing: string[];          // yazarkasa toplamı var, KDV dökümü yok
  total: number;                 // Σ okcTotal (KDV dahil)
  vatTotal: number;              // Σ okcVatTotal
  byRate: { rate: number; total: number; vat: number; base: number }[]; // Σ okcVat (yalnız girilen döküm); base = total − vat
  byRateEstimated: { rate: number; total: number; vat: number; base: number }[] | null;
                                 // vatMissing doluysa: eksik günlerin toplamı, girilen günlerin oran paylarıyla dağıtılmış
                                 // tahmin (tek oranlı ayda tek satır); byRate'e hiçbir zaman karışmaz
  chain: { total: number; vat: number | null; fromZ: string; toZ: string } | null; // kümülatif(ayın son Z'si) − kümülatif(önceki ayın son Z'si)
  complete: boolean;             // (missing ve vatMissing boş, days > 0 ve |Σ byRate.total − total| ≤ 1 ₺)
                                 // ya da (zincir var, Σ ile 1 ₺ içinde, vatMissing boş ve Σ byRate.total ≈ total)
}
export function okcMonth(rows: OkcRow[], month: string): OkcMonth;
```

`complete`, dalga 12'nin ve 13b'nin oran oran geliri ve KDV'yi bu tabandan alabilmesinin şartıdır; KDV dökümü olmayan
bir günü olan ay `complete: false` döner (toplamı tam olsa bile), ekran o ay bugünkü hesabı kullanır ve
`Yazarkasa KDV dökümü eksik: 2 gün` yazar. `byRateEstimated` yalnız "tahmini" işaretiyle gösterilebilir.

**Sonraki adım (ayrı küçük PR "13b", dalga 12 ve 13 birleştikten sonra; vergi bölümünün satırı dalga 12'de yapıldı):**

| Ekran | Bugün | Sonra | Koşul |
|---|---|---|---|
| Nakit planı › KDV tahmini (`src/lib/kdv.ts`) — **yapıldı, gün gün** (26 Kasım 2026, Dalga 2: Z'si girilmiş gün Z'den, kalanı tahmin; ay `complete` olmasa da; [../NAKIT-PLANI.md](../NAKIT-PLANI.md) › Kasa KDV'sinin kaynağı) | ModPOS cirosu × satış oranları + laffogato.net | satış KDV'si = Σ yazarkasa KDV'si (oran oran) + ModPOS'un yazarkasa dışı satışları (online + diğer) için bugünkü oranlı tahmin + laffogato.net. Satırda kaynak: `Yazarkasa Z'lerinden (30 / 30 gün)` | `okcMonth.complete`; değilse bugünkü hesap ve `Yazarkasa Z'si eksik: 2 gün` notu |
| Vergi bölümü (dalga 12) kasa geliri | **Dalga 12'de yapıldı** (28 Ekim 2026): `okcMonth.complete` olan ayda gelir yazarkasanın KDV hariç matrah toplamı (Σ `byRate[].base`, rozet "mali belge · Z") + laffogato.net; muhasebecinin KDV beyannamesi satışları girilmişse o önce gelir; ikisi de yoksa kasa cirosu "Yönetim verisi" rozetiyle ([../VERGI.md](../VERGI.md) § 2) | — | `okcMonth.complete`; `byRateEstimated` kullanılmaz |
| Satışlar › Ay bilgisi (POS cirosu, açık gün, kartlı oran) | ModPOS | **değişmez** (işletme cirosu ModPOS'tur) | — |
| Komisyon, satış tahmini, nakit planının nakit satırları, Bugün, MCP | ModPOS | değişmez | — |

**Çift sayılmaması için kurallar** (13b ve dalga 12 testleri bunları sabitler):
1. ModPOS toplamı ile yazarkasa toplamı **hiçbir zaman toplanmaz**; bir satırın kaynağı ya biri ya öteki.
2. `okcOutside` (yazarkasa toplamı dışındaki faturalı satış, bilgi fişi, e-belge tahsilatı) yazarkasa gelirine
   eklenmez. Cihazdan e-Arşiv / e-Fatura kesiliyorsa (VUK 593) o gelir e-belge kaynağından gelir (S6).
3. laffogato.net online satışı (Paraşüt / site) ÖKC'den geçmez: ayrı kalır, bugünkü gibi eklenir.
4. ModPOS "online" ve "diğer"i, yazarkasa tabanında yalnız Paraşüt satış faturalarıyla kapsanmıyorsa tahminle eklenir;
   kapsanıyorsa eklenmez (dalga 12 "Paraşüt `sales_invoices`" maddesiyle birlikte karar).
5. Banka gün sonu hiçbir zaman gelir değildir.
6. Kapsam eksik ayda zincir (`chain.total`) eksik günlerin toplamını verir ama oran dağılımını vermez: o ay oran payları
   girilen günlerden oranlanır (`byRateEstimated`), satırda "tahmini" yazar ve ay `complete` sayılmaz.

---

## 10. Değerlendirme düzeneği

### 10.1 Gerçek fotoğraflar (`tests/fixtures/okc-z/`)

- `README.md`: nasıl eklenir; adlandırma `YYYY-MM-DD-<cihaz>-<n>.jpg` (parçalar `…-ust.jpg` / `…-alt.jpg`); fotoğraflar
  sahipten **asıl çözünürlükte** istenir (telefonun kendi fotoğrafı; WhatsApp'ın sıkıştırdığı kopya değil: "belge"
  olarak ya da Drive / e-postayla), çünkü yakın görünüm (§4.3) asıl fotoğraftan üretilir. Asıl dosya `.data/okc-z/asil/`'de
  (gitignore'da) kalır; depoya `scripts/okc-eval/prepare.py` ile canlıdaki gibi küçültülmüş kopya girer (en uzun kenar
  2576, ~3,7 MP, JPEG 0,8; `PHOTO_COMPRESS`'in Python karşılığı) ki değerlendirme canlıyla aynı girdiyi görsün.
  `prepare.py --yakin` aynı asıldan PR-c'nin yakın görünümünü (istemcideki algoritmanın Python karşılığı) üretir.
- **Gizlilik kararı:** yazarkasa Z'sinde kişisel veri yoktur; şirketin unvanı, adresi, VKN'si ve cihaz sicil no'su her
  fişte basılı, kamuya açık bilgidir → **depoya konur**. Fotoğrafta kasiyer adı, müşteri bilgisi ya da yüz varsa o kısım
  kırpılır; kırpılamıyorsa `.data/okc-z/`'ye (gitignore'da) konur ve `cases.json`'da `"private": true` olur. ModPOS Z
  fotoğrafları (kasiyer adı basılıyor) **hep `.data/okc-z/`**'de. Toplam en çok ~12 fotoğraf, ~15 MB.
- `cases.json` (depoda; beklenen değerler sahibin kâğıdından elle yazılır, okumadan değil):

```json
{
  "name": "2026-10-24-beko-1",
  "image": "2026-10-24-beko-1.jpg",
  "private": false,
  "section": "kasa-okc",
  "day": "2026-10-24",
  "prevFrom": "2026-10-23-beko-1",
  "prev": null,
  "expect": {
    "documentType": "z_report",
    "values": { "okcZNo": "0101", "okcTotal": 9350, "okcVatTotal": 943.94, "okcCash": 2450, "okcCard": 6900,
                "okcT10": 8110, "okcV10": 737.27, "okcT20": 1240, "okcV20": 206.67, "okcReceipts": 40 },
    "cumulative": { "total": 1259350, "vat": 118943.94 },
    "bankPos": null,
    "checksInclude": ["zincir tutuyor"]
  }
}
```

- **Zincir:** `prevFrom` bir önceki vakanın adıdır; betik `prev`'i (`zNo`, `cumTotal`, `cumVat`) o vakanın
  **beklenen** değerlerinden kurar (ya da `--zincir okuma` ile o vakanın okumasından, canlıdaki gibi: yanlış okunmuş bir
  kümülatifin ertesi güne etkisi böyle ölçülür). Zincirin başındaki vakada `prev` elle verilir ya da `null`dur.
- Hedef küme: **2–3 ardışık günün** yazarkasa Z'si (K6 ve §1 adım 0'ın cihaz gerçekleri ancak böyle sınanır) ve aynı
  günlerin ModPOS Z'si; toplam 5–8 yazarkasa Z (biri uzun ve soluk, biri gece yarısından sonra alınmış, biri banka gün
  sonuyla aynı şeritte, en az biri üst / alt yarı olarak da çekilmiş), 2 ModPOS Z (yanlış bölüm denemesi), 1 banka
  gün sonu fişi, 1 X raporu (varsa). Tek oranlı ve tek ödemeli birer gün varsa işaretlenir (§5.2 kopya kimlikleri).

### 10.2 Betik (`scripts/okc-eval/run.ts`)

```bash
python3 scripts/okc-eval/prepare.py ham-fotograf.jpg tests/fixtures/okc-z/2026-10-24-beko-1.jpg
FOTO_EVAL=1 ANTHROPIC_API_KEY=… npx tsx scripts/okc-eval/run.ts --effort low --girdi tek [--tekrar 3] [--only ad] [--max n]
#   --girdi tek | yarilar (üst + alt fotoğraf, D11) | yakin (PR-c) | ayni-yeniden (aynı görselin ikinci okuması, PR-c karşılaştırması)
#   --zincir beklenen | okuma
npx tsx scripts/okc-eval/run.ts --kayitli     # ağsız, parasız: kayıtlı yanıtlarla betiğin kendisini sınar
FOTO_EVAL=1 … npx tsx scripts/okc-eval/run.ts --kaydet   # yanıtları tests/fixtures/okc-z/yanitlar/'a yazar
npx tsx scripts/okc-eval/run.ts --say-token   # count_tokens ile girdi (görsel + istem + şema), ücretsiz
```

- Canlıyla aynı yol: `runExtraction` (aynı istek biçimi, efor, şema, süreler) → `normalizeOkc` (aynı `prev`, gün) →
  (`yarilar`) ikinci fotoğraf yalnız boş alanları doldurur, canlı denetim formdaki gibi · (`yakin`, `ayni-yeniden`)
  ikinci okuma + `mergeReads` → `prefillPlan` (boş forma). Veritabanı kullanmaz.
- Her alan için sonuç: **doğru dolar** · **yanlış dolar** · **doğrulandı ama yanlış** (bir kimlik "doğruladı", değer
  yanlış: kimlik düzeninin kendisinin bozuk olduğunu gösterir) · **öneri, doğru** · **öneri, yanlış** · **boş**. Belge
  türü doğru mu, beklenen bilgi satırları çıktı mı.
- Özet: alan doğruluğu (doğru dolar ÷ beklenen), yanlış dolum sayısı, **"doğrulandı ama yanlış" sayısı (ayrı satır)**,
  öneri oranı, **süre p50 / p90**, girdi ve çıktı token'ı (düşünme ayrı), tutar; zaman aşımı sayısı. `--tekrar` aynı
  fotoğrafı N kez okur (tutarlılık). Şema alanlarının (`title`, `dailyTotalLabel`, `fiscalMarks`) karara katkısı
  ayrıca listelenir (§4.1).
- Sonuç `.data/okc-eval/<tarih>.json`; özet tablo elle `docs/planlar/ekler/okc-z/eval.md`'ye.
- **Çıkış kodu 1**: yanlış dolum > 0 ya da "doğrulandı ama yanlış" > 0. PR-b'nin birleştirme kapısı: gerçek
  fotoğraflarda `--tekrar 3` ile yanlış dolum 0, "doğrulandı ama yanlış" 0, alan doğruluğu ≥ %95 (kalan alanlar öneri
  ya da boş), ilk okuma p90 ≤ 20 sn. PR-c'nin kapısı: aynısı, ikinci okuma p90 ≤ 40 sn ve `yakin`'in `ayni-yeniden`'den
  ölçülerek üstün olması.
- Efor karşılaştırması: `--effort low|medium` (§4.4'ün karar kuralı). Girdi karşılaştırması: `--girdi tek|yarilar`
  (D11'in varsayılan çekim kararı).
- Gerçek fotoğraflar gelene kadar `scripts/foto-eval/make-images.py`'nin **sonuna** (öncekilerin rastgele sırası
  değişmesin) sentetik yazarkasa Z'leri eklenir: düzgün; uzun ve soluk; Z + banka gün sonu aynı şeritte; X raporu;
  kart satırı olmayan (kart ödemeleri yalnız banka adlarıyla); tek oranlı ve tek ödemeli; ardışık iki gün (zincir).
  PR-a için birinci sentetik Z yeter.
  `scripts/foto-eval/cases.json`'daki ModPOS Z görselinin KDV dökümü kalır (gerçek ModPOS da basabilir) ama MF logosu,
  EKÜ NO ve KÜM. satırı olmadığı doğrulanır.

### 10.3 Birim testleri (sentetik okumalar, ağ yok)

§11'de.

---

## 11. Testler (`npx tsx --test`)

**PR-a:** `tests/fotograf-okuma.test.ts`: ModPOS bölümünde `fiscal_z_report` ve banka fişi hiçbir alanı doldurmaz
(`switchTo: "kasa-pos"`); Kart bölümünde `fiscal_z_report` `bankPos`'u doldurmaz, düğme yok, K.KARTI metni; eski kayıtlı
yanıtlar (`tests/fixtures/foto/*.json`) aynen ayrışır. `tests/ai-istemci.test.ts`: istek biçimi aynı.

**PR-b** `tests/okc-z.test.ts` (yeni):
- **Kimlikler:** K1–K9 her biri tutan / tutmayan; toleranslar (0,04 ₺ tutar, 0,06 ₺ tutmaz; KDV formülünde 300 fişte
  1,50 ₺ pay); KASA NAKİT toplamaya girmez; banka alt satırı karta eklenmez; yazarkasa dışı tahsilat K4'ü açıklar.
- **Kopya kimlikler (D7):** tek oranlı gün (%10 TOPLAM = NET SATIŞ, aynı yanlışla iki yerde okunmuş): K1 / K2 tutar
  ama alan **doğrulanmaz**, `medium` alan turuncu dolar; tek ödemeli gün (hepsi kart) K4 doğrulamaz; iki oranlı ve
  nakit + kartlı gün doğrular. K3 hiçbir alanı doğrulamaz; 143 fişte toplamda 5 ₺'lik hatayı göremediği sınanır
  (yalnız çürütür).
- **Kart satırı olmayan cihaz:** `card` yok, iki `bank_subline` → kart = Σ, bilgi satırı; `card` varsa alt satırlar
  eklenmez.
- **Tuzaklar** (her biri bir sentetik okuma): kümülatif günlük diye okunmuş (K1, K5, büyüklük, K6); GENEL TOPLAM
  kümülatif satırların yanında; MATRAH grup toplamı diye; TOPKDV grup toplamı diye; kart satırı toplam diye; banka alt
  satırı iki kez; adet tutar diye; virgül kaybı (×100); FİŞ NO / EKÜ NO Z no diye (Z no < önceki); TOPLAM FİŞ ADEDİ;
  iptal ikinci kez düşülmüş; dolu %18 (tutmadı); soluk rakam 3/8.
- **Alan durumu:** tutmadı > doğrulandı > denetlenemedi; doğrulanan `medium` alan mavi dolar; tutmayan dolmaz.
- **Z no:** +1 (doğrulandı), +2 (bilgi; önceki gün ise uyarı), aynı (bütün okuma durur), küçük (tutmadı), önceki yok.
- **Kümülatifin saklanması (§6.1):** zincir tutuyor → saklanır; önceki yok ve ≥ günlük → saklanır; tutmuyor → boş ve
  ertesi gün son **saklanan** kümülatife bağlanır (doğru okunmuş ertesi gün "tutmadı" olmaz); aralık > 1 ve monoton →
  saklanır, doğrulamaz.
- **Tarih:** gece 00:30 Z'si önceki güne; ertesi sabah 09:12 + zincir tutuyor → bilgi (yalnız istisna açıkken);
  başka gün → `whole`.
- **Belge türü:** `x_report`, `period_report`, `software_z` (→ `switchTo: "kasa-z"`; BİLGİ FİŞİ başlıklı ModPOS
  dahil), `batch_slip` (yalnız `bankPos`), `z_report` + iki banka fişi (toplanır).
- **`okcFormChecks`:** elle yazılan değerlerde aynı denetimler, personel metinleri jargonsuz (metinlerde "kümülatif",
  "zincir", "KÜM.", "MATRAH" yok); parçalı okuma (üst parça KDV, alt parça ödemeler).
- **`okcReconcile`:** her satırın tolerans sınırı (0,99 / 1,00 ₺), online + diğer açıklaması, banka satırı, eski rapor
  (yalnız `bankPos`) bugünkü metin; `"staff"` yalnız Kart ve Kendi içinde satırlarını döner.
- **`sameVat`:** aynı döküm farklı sırada → eşit; bir oranın KDV'si farklı → farklı; `null` ve `[]` eşit.
- **`okcMonth`:** kapsam, eksik günler, oran toplamları, zincir; zincirle tam sayılan ay; **KDV dökümü olmayan bir
  günü olan ay `complete: false`**, `vatMissing` o gün, `byRateEstimated` dolu ve `byRate`'e karışmamış.

**PR-c** `tests/okc-z.test.ts` (genişler):
- **`mergeReads`:** aynı değerler güveni **yükseltmez**; farklı + yalnız birinde doğrulanmış → o, turuncu; farklı +
  hiçbiri → iki öneri, varsayılan yok; Z no / tarih / belge türü farkı → birleştirme yok, ilk okuma kalır.
- **`canReadCloser`:** her tetik; `readsLeft` 1 iken `false` (hak sınırı); yakın görünüm yokken `false`.

`tests/fotograf-okuma.test.ts` (PR-b'de genişler): ModPOS bölümü `fiscal_z_report` ve banka fişini reddeder
(`switchTo: "kasa-okc"`); eski `kasa-pos` kayıtlı yanıtı (`tests/fixtures/foto/pos.json`) hâlâ ayrışır ve gösterilir;
`prefillPlan`'da `failed` → `unsure` + `reason`; `savedFields` / `photoDiffs` yazarkasa alanlarıyla; ModPOS ve
yazarkasa anahtarları çapraz karşılaştırılmaz. **Geçiş (D2):** eski istemcinin `kasa-pos` yüklemesi ve yeniden
okuması reddedilmez, fotoğraf `kasa-okc` olur, `OKC_TASK` ile okunur, yanıt eski biçimde ve `bankPos` yalnız banka gün
sonu fişinden (yazarkasa Z'sinin toplamı ya da kartı asla).

`tests/kasa-raporu.test.ts` (genişler): `computeCash` kart kaynağı (yazarkasa > banka > yok; eski satır birebir);
`revisionChanges` yazarkasa alanları ve `KDV dökümü değişti` (aynı uzunlukta farklı iki döküm "değişti", aynı döküm
farklı sırada "değişmedi"); `whatsappText` yazarkasa bloğunda toplam ve nakit farkı satırı **yok**, kart satırı var;
`renderCashReport` yöneticinin satırlarıyla; eski "Kart" bloğu; `photosLine({ z, okc, pos })`.

**Personel sızıntısı:** `tests/personel-sizinti-kasa.test.ts` (dalga 10'un deseni; `tests/helpers/leak-scan.ts`'in
`COST_KEYS`'i bunları kapsamaz, test kendi listesini verir): personelin Kasa RSC yükünde, `okc-card.tsx`'te ve
personelin okuma yanıtında `okcCum*`, `cumTotal`, `cumVat`, `cumulativeTotal`, `cumulativeVat`, `okcOutside`,
`outside` anahtarları ve yöneticinin mutabakat satırları (`okcReconcile`'ın `key` değerleri `okc-total`, `okc-cash`,
`okc-meal`, `okc-bank`; personelinkiler `okc-card`, `okc-self`) yok.

`tests/ai-istemci.test.ts`: `kasa-okc` isteği `effort` §4.4'ün kararı, `max_tokens` 8000, süre `{ 50_000, 1, 50_000 }`;
**öteki türlerin isteği birebir aynı** (efor `low`, 6000, 20/45 sn).

`tests/foto-altyapi.test.ts`: tür listeleri, `KEEP_DAYS["kasa-okc"] = 400`, erişim kuralı; (PR-c) `oku` gövdesi
(`yakin` yalnız `kasa-okc` ve yakın görünüm varsa), türetilmiş anahtarın silinmesi.

Dalga 10 testleri: `CashFieldsSchema`'nın yazarkasa anahtarı olmayan eski isteği kabul etmesi ve bozuk `okcVat`'ı
(oran 7, `vat > total`) reddetmesi; `mergeProposal`'ın yazarkasa alanlarını taşıması ve `okcVat`'ı `sameVat` ile
karşılaştırması (aynı döküm "değişmedi"); geç raporun `kasa-okc` fotoğrafını kabul edip `kasa-z`'yi hâlâ istemesi;
**onaylanan geç raporda sunucu sütunlarının yazılması** (`reviewLate` → `writeCashReport`).

`CashReportFields` kullanan demirbaşlar (`bugun.test.ts`, `site-satis.test.ts`, `zayi-ikram.test.ts`): alanlar
isteğe bağlı olduğu için değişmez.

---

## 12. Dosyalar

### PR-a
- Değiştir: `src/lib/photo-read/schemas.ts` (iki enum'a `fiscal_z_report`), `prompts.ts` (`Z_TASK`, `POS_TASK`
  cümleleri), `kasa.ts` (iki bölümün kapısı ve metinleri), `common.ts` (`DOC_NAMES` + `fiscal_z_report` "yazarkasa
  (banka POS) Z raporu"); `src/app/panel/kasa/cash-form.tsx` (iki başlık, bir ipucu), `cash-photos.tsx`
  (`SWITCH_LABEL`); `scripts/foto-eval/make-images.py` (sona bir sentetik yazarkasa Z'si), `scripts/foto-eval/cases.json`;
  `tests/fotograf-okuma.test.ts`; `docs/FOTOGRAF.md` ve `docs/KASA-RAPORU.md`'de iki başlık ve yanlış bölüm satırları.

### PR-b: Ekle
- `src/lib/okc-z.ts`: kimlikler, `okcFormChecks`, `okcReconcile`, `sameVat`, `okcMonth`, metinler.
- `src/lib/photo-read/okc.ts`: `normalizeOkc`, alan durumları, `toStaffReading`.
- `src/app/panel/kasa/okc-card.tsx` (D18): yazarkasa kartı, Ayrıntılar kutusu, canlı denetim, kart satırı.
- `tests/okc-z.test.ts`, `tests/personel-sizinti-kasa.test.ts`; `tests/fixtures/foto/okc.json`, `okc-batch.json`,
  `okc-yanlis-toplam.json`, `okc-tek-oran.json`.
- `tests/fixtures/okc-z/README.md`, `cases.json`, fotoğraflar, `yanitlar/`.
- `scripts/okc-eval/run.ts`, `scripts/okc-eval/prepare.py`.
- `docs/YAZARKASA-Z.md` (biçim, etiketler, kimlikler, tuzaklar; araştırma notlarının özeti, kaynaklarıyla; §1 adım 0'ın
  cihaz gerçekleri).
- `docs/planlar/ekler/okc-z/teshis.md`, `eval.md`.
- `drizzle/00NN_okc_z.sql` + `drizzle/meta/*` (birleştirmede üretilir).

### PR-b: Değiştir
- `src/lib/photo-read/schemas.ts` (§4.1), `prompts.ts` (§4.2), `kasa.ts` (§6.6), `common.ts` (`x_report`,
  `period_report`, `batch_slip`, `software_z`; `cut_off`'un `kasa-okc` metni), `reading.ts`.
- `src/lib/photo-compress.ts` (`OKC_COMPRESS`), `src/components/panel/photo-picker.tsx` (türe göre küçültme ve durum
  metni).
- `src/lib/photo-rules.ts`, `src/server/storage/photo-access.ts`, `src/server/photo-read/rules.ts`
  (`cashPhotoRules.keepDays` türe göre).
- `src/server/ai/run.ts`, `claude.ts`, `replay.ts`; `src/server/photo-read/read.ts`.
- `src/app/api/foto/route.ts`, `src/app/api/foto/[id]/oku/route.ts`.
- `src/server/db/schema.ts` (§6).
- `src/lib/cash-report.ts` (§6.5, `photosLine`, `whatsappText`).
- `src/server/notify/cash-report-template.ts` (dalga 10'dan sonra `src/server/cash/report-email.ts` de).
- `src/server/cash/report-store.ts`, `src/lib/cash-requests.ts`, `src/server/cash/late.ts`,
  `src/server/cash-outs/requests.ts` (dalga 10 dosyaları; §7).
- `src/server/data/cash-reports.ts`, `src/server/data/cash-photos.ts`.
- `src/app/panel/kasa/cash-form.tsx` (yalnız `okc-card.tsx`'e değer ve işaret köprüsü; `busy` bölüm başına),
  `cash-photos.tsx` (`SWITCH_LABEL`, kayıtlı fotoğraflarda `kasa-okc` + `kasa-pos`), `cash-summary.tsx` (§3.7,
  **Kümülatifi temizle**), `cash-history.tsx` (rozetler), `page.tsx` (`prevOkcZ`, ay kartı satırı), dalga 10'un
  `late-report.tsx` / onay kartı (iki yanlı zincir satırı).
- `scripts/foto-eval/make-images.py` (sona sentetik yazarkasa Z'leri), `scripts/foto-eval/run.ts` (`kasa-okc` türü).
- Belgeler (§14).

### PR-c
- Ekle: `src/lib/photo-closeup.ts` (istemci: şerit sütununu bulma, parçaları yan yana dizme; saf hesap kısmı test
  edilir), `tests/fixtures/foto/okc-yakin.json`.
- Değiştir: `src/lib/photo-read/okc.ts` (`mergeReads`, `canReadCloser`), `prompts.ts` (`OKC_CLOSEUP`),
  `src/components/panel/photo-picker.tsx` (yakın görünümü üretip yükleme), `src/app/api/foto/route.ts` ve
  `[id]/oku/route.ts` (`yakin`), `src/server/photo-read/read.ts`, `src/server/storage/photos.ts` (türetilmiş anahtarın
  yazımı, okunması, silinmesi), `src/server/data/cash-photos.ts` (`readingOf` birleştirerek), `okc-card.tsx`
  (**Yakından bir daha oku**, iki öneri düğmesi), `scripts/okc-eval/prepare.py` (`--yakin`).

---

## 13. Dalga 10 ile eşgüdüm ve sıra

**Sıra:** PR-a hemen `main`'e → dalga 10 birleşir → PR-b'nin tümleştirme adımları (§17 adım b3–b8) onun üstüne
kurulur → (gerekirse) PR-c. Dalga 11 ve 12 ile dosya çakışması küçüktür; hangisi önce birleşirse ötekisi R2 ile
migration'ını yeniden üretir.

| Ne zaman | Ne | Dalga 10'a dokunur mu |
|---|---|---|
| Hemen (`main` üstünde) | **PR-a** (§1b) ve adım 0 teşhis | Az: `cash-form.tsx`'te iki başlık ve bir ipucu satırı; dalga 10 önce birleşirse PR-a bunları dalga 10'un hâline uyarlar, sonra birleşirse dalga 10 üç satırı alır |
| Hemen (`main` üstünde, ayrı dal) | PR-b'nin adım b1 saf çekirdeği (`schemas.ts`, `prompts.ts`, `kasa.ts`, `common.ts`, yeni `okc-z.ts`, `photo-read/okc.ts`, testler); adım b2 değerlendirme düzeneği ve canlı ölçüm | Hayır (dalga 10 bu dosyalardan yalnız `receipt.ts`'e dokundu) |
| Dalga 10 birleştikten sonra | PR-b adım b3–b8 | Evet: aşağıdaki dosyalar |
| PR-b'den sonra, değerlendirme gerek gösterirse | PR-c | Hayır |

Dalga 10'un değiştirdiği ve bu dalganın ekleme yapacağı yerler:
- `src/app/panel/kasa/cash-form.tsx` (+355): `mode` report / late / review, düzeltme önerisi, "Teslim alan";
  `photoBlock` öneri ve inceleme kipinde gizli; Z bloğunun `id="k-z-photos"`'u. "Kart" kartını bu dalga değiştirir:
  kart `okc-card.tsx`'e taşınır (D18), `cash-form.tsx`'te dalga 10'un son hâli üstüne yalnız köprü yazılır; `busy`
  (bugün `zUp.busy || posUp.busy`, bütün seçicileri kilitliyor) bölüm başına olur.
- `src/server/cash/report-store.ts` (`reportSchema` :49-75, `bankPos` :64, tür denetimi :222) ve
  `src/server/cash/report-email.ts`: yeni alanlar oraya (eski eylem dosyasına değil).
- `src/lib/cash-requests.ts`: `CashFieldsSchema` (:29-48; "bilinmeyen anahtarlar düşer": eklenmezse onaylanan
  düzeltme ve geç rapor yazarkasa alanlarını **sessizce düşürür**), `FIELD_KEYS` (:140-158), `LatePayload.photos`
  (:86-96).
- `src/lib/cash-report.ts`: `SENSITIVE`'e yazarkasa alanı eklenmez (hassas değil); `staffCashGate` bu yüzden onları
  onaya göndermez.
- `src/server/cash/late.ts` (:102-106 tür denetimi; `reviewLate` sunucu sütunlarını `writeCashReport`'tan alır),
  `src/server/data/cash-photos.ts` (`heldPhotoInfo`, `photoReadingOf`, `readingOf`), `src/server/cash-outs/requests.ts`
  (`removalCheck` :188-218), `src/server/photo-read/read.ts`.
- Yan dosyalar: e-posta şablonu (dalga 10'un `approval` satırının yanına), `cash-history.tsx`, `page.tsx`,
  `docs/KASA-RAPORU.md`, `docs/FOTOGRAF.md`, `tests/kasa-raporu.test.ts`, `tests/fotograf-okuma.test.ts`.

Dalga 11: `cash-form.tsx` (`CashOutDTO` → `CashOutView`) ve `page.tsx`'te küçük dokunuşlar; migration numarası.
Dalga 12: `schema.ts` ve journal sırası; aşağı akış 13b'de (§9). Dalga 12'nin planındaki "Dalga 13 oran başına matrahı
saklarsa…" maddesi bu planın `okc_vat` ve `okcMonth()`'udur.

---

## 14. Belgeler

Her yerde aynı ad: **"ModPOS Z raporu"** ve **"Banka POS Z raporu (yazarkasa)"**; ayırt edici cümle "üstünde Z RAPORU
ve KDV dökümü yazar; banka gün sonu fişi değil".

- `docs/KASA-RAPORU.md`: "Personel ne girer" tablosunda "Z raporu (ModPOS)" → "ModPOS Z raporu", "Kart" satırının
  yerine "Banka POS Z raporu (yazarkasa)" (dört alan + Ayrıntılar, fotoğraf yoksa yazılanlar, banka gün sonu yedeği);
  "Yazarken hesaplananlar"a yazarkasa denetimleri ve karşılaştırmalar (kim neyi görür, İlke 8); "Fotoğraftan
  doldurma"ya yazarkasa okuması (doldurma kuralı, kopya kimlikler, üst / alt yarı, yanlış belge düğmeleri; PR-c'de yakın
  okuma); "Gönderince"ye e-posta / WhatsApp bloğu; "Yönetici"ye rozetler, kümülatif ve **Kümülatifi temizle**, ay kartı
  satırı. PR-a yalnız başlıkları ve yanlış bölüm satırlarını değiştirir.
- `docs/FOTOGRAF.md`: §1 tablo (banka POS Z, banka gün sonu yedek), §2 denetimler, §3 kalite 0,8, §4 saklama (400 gün),
  §5 efor ve süre türe göre (tek 50 sn'lik deneme), ölçülen maliyet ve **zaman aşımına düşen denemenin `ai_calls`'ta 0 $
  görünmesi (tutar eksik sayılır)**, §6 KVKK satırı (Z'de kişisel veri yok; şirket VKN'si), §8 değerlendirme
  (`scripts/okc-eval`), §9 yeni tür adımları (`kasa-okc` örnek), `kasa-pos` geçişi.
- `docs/YAZARKASA-Z.md` (yeni): §12.
- `README.md`: Kasa satırı "ModPOS ve banka POS (yazarkasa, mali) Z raporu ayrı; banka POS Z'si oran oran KDV ile".
- Yardım: dalga 10'un `/panel/yardim/personel`'ine iki cümle: `Banka POS Z raporu (yazarkasa): banka POS'tan aldığınız
  Z; üstünde Z RAPORU ve KDV dökümü yazar, banka gün sonu fişi değil. Fotoğrafını çekin; tutmayan rakam turuncu kalır ve
  fişten yazılır.` Yönetici yardımına karşılaştırma satırları ve kümülatif.

---

## 15. Riskler

- **Cihazın gerçek düzeni bilinmiyor:** araştırma kaynakları yalnız arama özetleriyle görülebildi; cihaza özgü etiketler
  (GENEL TOPLAM'ın anlamı, alt alta tutar), KÜM. satırlarının varlığı ve anlamı, Z'nin saati ve ModPOS'un yazıcısı
  gerçek fotoğrafla doğrulanmadan istem ve kimlikler kesinleşmez. Önlem: §1 adım 0 ve §10 kapısı.
- **Model hâlâ soluk rakamı yanlış okur:** kimlikler çoğunu yakalar; kopya kimlikler (tek oran, tek ödeme) bilerek
  doğrulamaz, bu yüzden L'Affogato'nun tek oranlı günlerinde temel alanlar çoğu zaman güvene göre (yüksekse mavi, değilse
  turuncu) dolar ve yanlış dolum riskini nakit + kart (K4) ve kümülatif (K6) taşır. Yakalanmayan tek tutar için en kötü
  durum turuncu öneri ya da kayıttan sonra "Fotoğraftan farklı" değil, personelin fişe bakmasıdır. Kimliğe girmeyen
  alan (fiş sayısı, yemek kartı tek başına) "denetlenemedi" kalır.
- **Kapanışta süre:** ilk okuma hedefi p90 ≤ 20 sn (ölçülür; tutmayan efor seçilmez), tek 50 sn'lik deneme; okuma
  sürerken ModPOS bölümü ve form kullanılabilir. PR-c'nin yakın okuması gönderimi kilitlemez.
- **Maliyet:** ayda ~2–4 $ ek (ölçülen rakam S8'e); zaman aşımına düşen denemeler `ai_calls`'ta 0 $ görünür, gerçek
  tutar biraz daha yüksek olabilir. Günlük 40 okuma sınırına daha erken yaklaşılır (yazarkasa Z'si günde en çok 3
  okuma).
- **Okuma hakkı:** `MAX_READS_PER_PHOTO` 3 hata dahil sayar; tek 50 sn'lik deneme zaman aşımına düşerse bir hak gider.
  PR-c'nin düğmesi yalnız ondan sonra bir hak kalacaksa çıkar.
- **Eski sayfalar (yayın günü):** açık kalan telefonlar `kasa-pos` gönderir; geçiş kuralı (D2) bunları kabul eder ve
  yanlış rakam yazdırmaz.
- **İki Z kartı karıştırılır:** başlıklar, ipuçları ve iki yönlü "… bölümüne okut" düğmesi; yanlış bölüm hiçbir alanı
  doldurmaz.
- **Dalga 10 yeniden kurulumu:** `cash-form.tsx` çakışması büyük; bu yüzden tümleştirme dalga 10 birleştikten sonra.
- **Dalga 10'un bekleyen istekleri:** yazarkasa anahtarları `.optional()` olmazsa eski istekler ayrıştırılamaz.
- **Meşru ModPOS–yazarkasa farkı:** yalnız yönetici görür (İlke 8); metinler nötr ve açıklayıcı, rozet yok. Fark
  işletmenin satış dağılımıdır; personel ekranına ve WhatsApp grubuna günlük yazılı olarak girmez, kayıtta ve yöneticinin
  e-postasında eksiksiz durur.
- **Z'nin alındığı saat:** Z kapanıştan önce alınırsa geç satışlar ertesi Z'ye düşer; toplam satırı bilgi düzeyinde.
- **KVKK:** yazarkasa Z'si de Anthropic'e (ABD) gider (bugünkü gibi); kişisel veri taşımaz. Ayarlar › Fotoğraftan okuma
  kapatılırsa fotoğraf yine kanıt olur.
- **Sunucu sütunlarının tutarlılığı:** kümülatif yalnız aynı Z no, aynı günlük toplam ve inandırıcılık kuralıyla
  (§6.1) yazılır; elle düzeltilen raporda boş kalır, zincir son saklanan kümülatife bağlanır (denetim o gün yalnız
  çürütür, hata değil). Yanlış saklanan bir kümülatifi yönetici temizler.

---

## 16. Sahibe sorular (varsayılanlarıyla)

| # | Soru | Varsayılan (plan bunu uygular) |
|---|---|---|
| S1 | Yazarkasa Z bölümü zorunlu olsun mu? | **Hayır.** Girilmeyen gün yöneticide "Yazarkasa Z yok" rozeti alır (ilk kullanımdan sonra). İsterseniz sonra zorunlu yapılır |
| S2 | ModPOS ile yazarkasa arasındaki **toplam ve nakit farkı** personelin ekranında ve personelin gruba yolladığı WhatsApp metninde de görünsün mü? Bu fark her gün dolu olacak (Eylül'de ~%11) ve kasadan geçmeyen satışın (online, faturalı satış, Z saati) günlük ölçüsüdür: işletmenin satış dağılımı ve vergi açısından hassas bir rakamdır; personelde ve WhatsApp grubunda her gün yazılı iz bırakır, personelin de bu farkla yapabileceği bir şey yoktur | **Hayır.** Toplam, nakit, yemek kartı ve banka satırları yalnız yönetici ekranında ve yöneticinin seçtiği e-posta adreslerinde; personelde ve WhatsApp'ta yalnız kart satırı (personelin düzeltebileceği işlemsel uyarı). Evet derseniz satırlar personele nötr bilgi olarak açılır |
| S3 | Geç raporda (dalga 10) yazarkasa Z fotoğrafı zorunlu mu? | **Kabul edilir, zorunlu değil**; varsa onay kartında Z no zinciri gösterilir |
| S4 | Tek yazarkasa Z fotoğrafının kaldırılması istenebilsin mi? | **ModPOS Z fotoğrafıyla aynı kural** (değer doldurduysa ve okuma farkı varsa istenemez) |
| S5 | Yazarkasa Z fotoğrafları ne kadar saklansın? | **400 gün** (yıllık vergi mutabakatı). 180 gün de seçilebilir. Kâğıt Z'lerin yasal saklama yükümlülüğü ayrıdır |
| S6 | Yazarkasadan fatura (e-Arşiv / e-Fatura) ya da yemek kartı için bilgi fişi kesiliyor mu? | **Hayır varsayılır.** Z'de görünürse "toplam dışı tahsilat" olarak ayrı tutulur, ciroya eklenmez |
| S7 | Bütün kartlı ödemeler yazarkasa POS'tan mı alınıyor, ayrı bir banka POS'u var mı? | **Hepsi yazarkasadan.** Banka gün sonu fişi isteğe bağlı yedek |
| S8 | Yazarkasa Z okuması başına ~0,05–0,10 $ (yakın okumayla ~0,10–0,20 $; ayda ~2–4 $) kabul mü? (Tahmin; gerçek rakam adım b2'de ölçülüp buraya yazılır) | **Evet.** Ölçüm daha pahalı çıkarsa şema küçültülür ya da yakın okuma kapatılır |
| S9 | KDV tahmini, kapsamı tam aylarda yazarkasa Z'lerine geçsin mi (13b)? | **Evet**, kaynağı ekranda yazılarak; eksik ayda bugünkü hesap |
| S10 | Bir günde iki Z ya da ikinci bir yazarkasa var mı? | **Tek cihaz, günde bir Z.** İkinci Z "arada Z var" uyarısı verir; rakamlar elle toplanır |
| S11 | Uzun fişler için telefonda otomatik yakın görünüm (PR-c) yapılsın mı? Ya da personel her gün fişin üst ve alt yarısını ayrı mı çeksin? | **Yalnız ölçüm gerektirirse**; önce üst / alt yarı ile tek fotoğraf karşılaştırılır (D11) |
| S12 | Banka POS Z'sini kim, saat kaçta alıyor? Elle kapanışta mı, cihaz kendiliğinden (ör. 23:59'da) mı? Bazen ertesi sabah alındığı oluyor mu? | **Elle, kapanışta varsayılır**; cevap §5.4'ün gece yarısı ve "ertesi sabah" kurallarını belirler |
| S13 | ModPOS'un gün sonu raporu hangi yazıcıdan çıkıyor: mutfak / adisyon yazıcısından mı, banka POS'un (yazarkasanın) kendisinden "bilgi fişi" olarak mı? | **Ayrı yazıcı varsayılır**; aynı cihazdansa belge türü ayrımı "BİLGİ FİŞİ / MALİ DEĞERİ YOKTUR" yazısına dayanır |

**Bilgi istekleri (adım 0):**
- **2–3 ardışık günün** banka POS Z'sinin fotoğrafı (zincir ve KÜM. satırları ancak ardışık günlerle sınanır) ve
  **aynı günlerin kâğıtlarının kendisi** (ya da kâğıtlardan elle yazılmış doğru rakamlar: Z no, günlük toplam, %10 ve
  %20 toplam ve KDV, toplam KDV, nakit, kart, yemek kartı, fiş sayısı, KÜM. TOPLAM ve KÜM. KDV); toplamda 5–8 gün,
  uzun ve soluk olan dahil. Fotoğraflar **asıl çözünürlükte** (telefonun kendi fotoğrafı; WhatsApp'tan "belge" olarak,
  Drive ya da e-postayla; WhatsApp'ın sıkıştırdığı resim değil). En az bir günün Z'si ayrıca **üst yarı ve alt yarı**
  olarak iki fotoğraf.
- Aynı günlerin ModPOS Z'si (2 tane yeter), 1 banka gün sonu fişi (varsa), 1 X raporu (varsa).
- Cihazın markası ve modeli; Z alınınca banka gün sonu aynı şeride basılıyor mu; S12 ve S13'ün cevabı.
- Bir ayın KDV beyannamesindeki satış ile o ayın Z toplamları (dalga 12 ile birlikte doğrulama için).

---

## 17. Uygulama sırası ve kabul ölçütleri

| Adım | İş | Kabul |
|---|---|---|
| 0 | Teşhis sorgusu, fotoğraflar, cihaz gerçekleri (§1 adım 0'ın üç maddesi), `teshis.md` | Hangi yolun (A / B / C) ne sıklıkla yaşandığı yazılı; KÜM. satırları, Z saati ve ModPOS'un yazıcısı kâğıtla doğrulanmış; en az 5 gerçek yazarkasa Z'si (2–3'ü ardışık) `tests/fixtures/okc-z/`'de |
| **a** | **PR-a** (§1b): iki enum, `Z_TASK` / `POS_TASK` cümleleri, iki bölümün kapısı ve metinleri, başlıklar, testler, iki belge | `npm test`, typecheck, lint, build yeşil; sentetik yazarkasa Z'si iki bölümde de hiçbir alanı yanlış doldurmuyor (`scripts/foto-eval`); eldeki gerçek fotoğraflarla (adım 0'dan) aynı deneme; tarayıcıda 390 px iki başlık → PR (taslak), birleştir, canlı |
| b1 | Saf çekirdek: şema, istem (adım 0'a göre), `okc-z.ts`, `photo-read/okc.ts`, `kasa.ts` türleri, `tests/okc-z.test.ts` | `npm test` yeşil; §11'in PR-b saf maddeleri (kopya kimlikler, kart satırı olmayan cihaz, kümülatifin saklanması, `sameVat`, `okcMonth` KDV kapsamı dahil). **Durum (26 Ekim):** yapıldı (`claude/dalga-13b-okc-z`). Adım 0'ın gerçek fotoğrafları gelmeden yazıldı: `OKC_TASK` plandan ve araştırma notlarından taslaktır, **b2'de gerçek fotoğraflarla yeniden denetlenir** (gün cümlesi, `software_z`, etiketler; `prompts.ts`'teki yorum). K6 (zincir) yalnız çağıran önceki saklanan kümülatifi verirse, "ertesi sabah" istisnası yalnız `nextMorningZ` açıkken çalışır: ikisi de adım 0'ın cevabına bağlı. `CashPhotoKind`'a `kasa-okc` ve ModPOS bölümünün `switchTo: "kasa-okc"`'si fotoğraf türüyle (b3–b4) gelir; o zamana kadar okuma türü `CashReadKind` |
| b2 | Değerlendirme: `scripts/okc-eval`, sentetik görseller, `--say-token`, canlı ölçüm `low` / `medium` × 3, `--girdi tek` / `yarilar` | `eval.md`'de tablo (yanlış dolum, "doğrulandı ama yanlış", süre p50 / p90, token, tutar); efor ve varsayılan çekim kararı (§4.4, D11); şema API'de kabul ve kullanılmayan alanlar çıkarılmış; S8 ve durum metni ölçülen rakamla |
| b3 | Claude istemcisi (efor, tek 50 sn'lik deneme, `max_tokens`, `ai_calls.effort`), `read.ts` (zincir sunucuda, `toStaffReading`), yollar (`kasa-pos` geçişi dahil), replay | `ai-istemci` testleri; `AI_REPLAY=1` ile `kasa-okc` ve eski `kasa-pos` istemcisi yolu. **Durum (26 Ekim):** yapıldı (`claude/dalga-13b-okc-z`), açıklarıyla: `ai_calls.effort` sütunu migration ister, b4'e kaldı (efor şimdilik kodda ve zaman aşımı günlüğünde; `claude.ts`'te TODO). `previousOkc` b4'ün `okc_*` sütunlarına kadar `{ z: null, cum: null }` döner: Z no sırası ve zincir sunucuda bağlı ama "denetlenemedi" kalır; büyüklük denetimi ModPOS toplamlarıyla. **Doldurma kapısı:** `OKC_PREFILL_ENABLED = false` (`src/lib/okc-z.ts`; sahibin kararı, canlı değerlendirme geçene kadar): yazarkasa okuması hiçbir alanı doldurmaz, her rakam öneri (`prefillPlan` → `unsure`); eski sayfaya giden `bankPos` da düşük güvenle öneri. `okc*.json` kayıtlı yanıtları sentetiktir (b2'de gerçekleriyle değişir). Geçişin yazım yolu için kayıt, geç rapor ve kayıtlı okumalar `kasa-okc` fotoğrafını kabul eder; formda bu fotoğraf b5'e kadar banka POS bölümünde görünür. ModPOS bölümünün `switchTo: "kasa-okc"`'si ekranla (b5) gelir. Uçtan uca `next dev` + `AI_REPLAY=1` denemesi yapılmadı (yerel veritabanına erişim yoktu); yol birim testleriyle (`replayClient`, `normalizeOkc`, `toStaffReading`, `okcToLegacyPos`) sınandı |
| b4 | Veri: `schema.ts`, migration (birleştirmede), DTO, `report-store` (sunucu sütunları `writeCashReport`'ta, **Kümülatifi temizle**), `cash-requests` (`okcVat` doğrulaması, `sameVat`), `late` (iki yanlı zincir), `cash-photos`, `removalCheck`, fotoğraf kuralları | Boş veritabanında `db:migrate && db:seed`; dalga 10 testleri yeşil; geç rapor onayında sunucu sütunları yazılıyor. **Durum (26 Ekim):** yapıldı (`claude/dalga-13b-okc-z`). Migration `0042_okc_z` (main'le birleştirmede yeniden üretildi; yalnız `ADD COLUMN`: `cash_reports`'a 12, `ai_calls`'a `effort`); boş veritabanında 41 migration + seed geçti, ikinci `db:generate` değişiklik bulmadı. b3'ün açıkları kapandı: `ai_calls.effort` yazılıyor; `previousOkc` / `nextOkc` / `okcRows` gerçek `okc_*` sütunlarından (Z no sırası ve zincir okumada gerçekten denetleniyor); büyüklük denetimi yazarkasa toplamlarıyla (yoksa ModPOS). Yazım: eksik yazarkasa anahtarı (eski sayfa, eski istek) kayıtlıyı korur; §3.2 kuralı sunucuda `okcFieldsIn` / `okcFormError` ile formla aynı metin; bölüme en çok 3 fotoğraf. Sunucu sütunları yeni raporda, yazarkasa fotoğrafı bağlanınca, Z no / toplam değişince ve onaylanan fotoğraf kaldırmada yeniden hesaplanır; başka düzeltme dokunmaz (temizlenen kümülatif yeni okuma gelene kadar boş kalır). Kart farkı `cardSource` ile (D5); WhatsApp ve e-postanın banka bloğu eski anlamıyla kaldı (yazarkasa bloğu b6). DTO ve fotoğraf okumaları kime göre (`"staff"` varsayılan: sunucu sütunu ve yöneticinin satırı yok). Tek Banka POS Z fotoğrafı yalnız yazarkasa rakamı yazılmışken korunur (S4'ün yorumu). Geç rapor kartında `okcChain` (iki yanlı zincir; ekranı b5). Testler: `tests/kasa-okc-db.test.ts` (yeni; `KASA_OKC_TEST_DATABASE_URL`, yoksa `KASA_GEC_…`), `okc-z`, `kasa-raporu`, `kasa-duzeltme-istegi`, `foto-altyapi`; tam test 1934 / 0. `next dev` + `AI_REPLAY=1` ile yükleme denendi: yöneticinin okuması kümülatifi taşıyor, personelinki taşımıyor, `effort` "low". Açık (b5–b7): ekran (yazarkasa kartı, `prevOkcZ`, kümülatif satırı ve **Kümülatifi temizle** düğmesi: eylem `clearOkcCumulative` hazır, onay kartında `okcChain`, rozetler, ay kartı), personel sızıntı testine yeni anahtarlar, WhatsApp / e-posta / `photosLine`, belgeler |
| b5 | Ekran: `okc-card.tsx` (dört alan + Ayrıntılar, tek özet satırı, kart satırı, parçalar), `cash-form` köprüsü (`busy` bölüm başına), `cash-photos`, `cash-summary`, `cash-history`, `page.tsx` (`prevOkcZ`), geç rapor onay kartı | Tarayıcıda 390 ve 1440 px, personel ve yönetici olarak: yeni rapor, fotoğraflı / fotoğrafsız, üst / alt yarı, yanlış bölüm, okuma sürerken ModPOS fotoğrafı çekilebiliyor, eski rapor görünümü ve düzenlenmesi; personelde toplam / nakit farkı ve kümülatif yok; `personel-sizinti-kasa` testi. **Durum (26 Ekim):** yapıldı (`claude/dalga-13b-okc-z`). `okc-card.tsx` (fotoğraf + dört alan, Ayrıntılar yalnız içinde turuncu alan, hata ya da yönetici düzenlemesi varken ve yalnız banka POS'u yazılı eski raporda açık gelir; tek özet satırı, kart satırı; yöneticide öteki karşılaştırmalar ve ayrıntılı metinler), saf form mantığı `okc-form.ts` (zorunluluk metni sunucuyla aynı, `okcFormError`; testleri `tests/okc-z.test.ts`'te). `cash-form` köprüsü: değerler ve fotoğraf işaretleri formda; yükleme bölüm başına (yazarkasa Z'si okunurken ModPOS seçicisi açık, gönderim yükleme bitene kadar bekler); bölüme en çok 3 fotoğraf; tutmayan / öneri alanın altında tek neden + `Fotoğrafta …` + **Fotoğraftakini yaz**. `OKC_PREFILL_ENABLED = false` iken her okunan rakam öneri; kapı açılınca ekran değişmeden `prefillPlan` doldurur. ModPOS bölümünün yanlış belge düğmesi `switchTo: "kasa-okc"` (**Banka POS Z bölümüne okut**). Kayıtlı rapor "Banka POS Z (yazarkasa)" bölümü (personele kart ve kendi içinde satırları; yöneticiye kümülatif, **Kümülatifi temizle**, "saklanmadı / temizlenmiş" satırı ve yazarkasa dışı tahsilat), eski rapor "Kart · Banka POS" aynen. Günden güne `Yazarkasa tutmuyor` / `Yazarkasa Z yok` rozetleri ve ay kartında yazarkasa toplamı ve KDV satırı (`firstOkcReportDate`, `okcRows`, `okcMonth`). `page.tsx` personele `prevOkcZ` (yalnız gün ve numara; geç rapor da), yönetici satırı `okcAdmin` personelin yükünde anahtarıyla bile yok. Onay kartında `okcChain` satırı, "Düzeltip onayla" yazarkasa alanlarıyla. Tarayıcı (`next dev` + `AI_REPLAY=1`, 390 ve 1440 px, personel ve yönetici): yeni rapor fotoğraflı / fotoğrafsız, üç parça, iki yönde yanlış bölüm, okuma sürerken ModPOS fotoğrafı, gönderim, eski rapor görünümü ve düzenlenmesi, kümülatifi temizleme, geç rapor ve onayı (sunucu sütunları yazıldı), günden güne. `personel-sizinti-kasa` (yazarkasa anahtarları `OKC_ADMIN_KEYS`) ve `scripts/personel-sizinti.ts` (kasa sayfalarında aynı anahtarlar) temiz. Açık: okuma süresi metni (`Okunuyor… genelde N saniye`) ve `OKC_COMPRESS` b2'nin ölçümüne bağlı; eski açık sayfada ModPOS bölümünün yeni `kasa-okc` düğmesi etiketsiz görünür (yenileyince düzelir); yalnız banka fişi okumasında tarih uyarısı iki kez çıkıyor (`okc.ts`, b2'de istemle birlikte). WhatsApp / e-posta / `photosLine` b6 |
| b6 | E-posta, WhatsApp, `photosLine` | `kasa-raporu` testleri (WhatsApp'ta toplam / nakit farkı yok); deneme e-postası. **Durum (26 Ekim):** yapıldı (`claude/dalga-13b-okc-z`). `okcTextBlock` (`src/lib/cash-report.ts`): WhatsApp'ta (her zaman personelin metni, `whatsappText` → `cashReportText(…, "staff")`) "*Banka POS Z raporu*" bloğu: Z no, nakit, kredi kartı, kart satırı (`computeCash`'in kaynağıyla: `✅ Kart ModPOS ile aynı` / `⚠️ Yazarkasa kartı ModPOS'tan 120 ₺ fazla`; yazarkasa kartı yoksa banka gün sonu) ve banka gün sonu tutarı. §8 örneğindeki banka satırının ✅'i yazılmadı: banka ↔ yazarkasa kartı satırı D13 ve S2'ye göre yöneticinin, WhatsApp'ta yalnız tutar. Yazarkasanın günlük toplamı, KDV'si, fiş sayısı, yemek kartı / diğer ve kendi içinde satırı WhatsApp'a girmez; "Fotoğraftan farklı yazılan"da bloğa girmeyen yazarkasa rakamı yalnız adıyla (`Günlük toplam (banka POS Z)`). E-posta (alıcıları yönetici seçer): "Banka POS Z raporu (yazarkasa) · Z no · fiş" bölümü (günlük toplam ve KDV, oran oran döküm, ödemeler, banka gün sonu) ve altında `okcReconcile(…, "admin")`'in bütün satırları tonlarıyla; yazarkasa alanlarının fotoğraf farkı bu bölümün altında; metin sürümü `cashReportText(…, "admin")` (`Günlük toplam: … (KDV …) · 143 fiş`, `KDV dökümü`, ℹ️ / ✅ / ⚠️ satırları). Eski rapor (yazarkasa alanı yok): "Kart" bloğu, etiket `Banka POS` (WhatsApp ve e-posta). ModPOS bölümü her yerde "ModPOS Z raporu". `photosLine({ z, okc, pos })`: `📷 ModPOS Z ve banka POS Z fotoğrafı panelde`, eski `kasa-pos` "banka fişi"; e-postada `Fotoğraflar panelde: ModPOS Z, banka POS Z` (b3'ün TODO'su kapandı). Kasa sayfasındaki "Rapor alıcıları" › **Deneme e-postası**nın örnek raporu (kayıtlı rapor yoksa) yazarkasa alanlarıyla. Testler: `kasa-raporu` (blok, eski blok, fark satırı, e-posta bölümü ve metni, fotoğraf satırı), `personel-sizinti-kasa` (WhatsApp'ta yöneticinin satırı ve yazarkasa toplamı yok; `cashReportText` "admin" yalnız şablonda). Deneme e-postası **gönderilmedi**: örnek raporların ve `next dev` + `AI_REPLAY=1` ile personelin gönderdiği raporun e-postası dosyaya çizilip 390 / 1440 px'te bakıldı; gerçek bir deneme gönderimi ("Rapor alıcıları" › **Deneme e-postası**; son kayıtlı raporla gider) sahibin işi. Açık: belgeler (`docs/KASA-RAPORU.md` "Gönderince", e-posta ve WhatsApp bloğu) b7 |
| b7 | Belgeler ve Yardım | §14. **Durum (26 Ekim):** yapıldı (`claude/dalga-13b-okc-z`). `docs/YAZARKASA-Z.md` (yeni: ne olduğu, tipik düzen, etiketler, kodda olduğu hâliyle K1–K9 ve öteki denetimler, tuzaklar, adım 0'ın doğrulanacak cihaz gerçekleri varsayılanlarıyla, kaynaklar). `docs/KASA-RAPORU.md`: giriş ve "Personel ne girer" (dört alan + Ayrıntılar), "Yazarken hesaplananlar" (kart farkının kaynağı, yazarkasa denetimleri ve kim görür), "Fotoğraftan doldurma" (doldurma kapısı kutusu, bölüm başına yükleme, iki yönlü yanlış bölüm, X / dönem raporu, banka gün sonu, üst / alt yarı, en çok 3 fotoğraf), yeni "Banka POS Z raporu (yazarkasa)" bölümü (zorunluluk, Ayrıntılar, canlı denetim, karşılaştırma tablosu ve kim görür, kümülatif ve **Kümülatifi temizle**, düzeltme ve geç rapor, fotoğraf kaldırma, eski raporlar ve `kasa-pos` geçişi, kapı ve sahipten beklenenler), düzeltme kapısı tablosu, geç rapor, fotoğraf kaldırma satırı, "Gönderince" (WhatsApp / e-posta tablosu, ✅'siz banka satırı kararı, fotoğraf satırı adları, deneme e-postası), "Yönetici" (rozetler, kayıtlı rapor bölümü, ay satırı), dosyalar ve testler. `docs/FOTOGRAF.md` §1–§10 (§3 kalite: bugün 0,7, `OKC_COMPRESS` ölçüme bağlı; §5 efor, tek 50 sn'lik deneme, 8000, `ai_calls.effort`, tahmini tutar ve zaman aşımının 0 $ görünmesi; §6 KVKK satırı; §8 değerlendirme adımları, kayıtlı `okc*.json`; §9 `kasa-okc` örneği ve `kasa-pos` geçişi). README (Kasa satırı, `KASA_OKC_TEST_DATABASE_URL`). Yardım: personele `kasa-yazarkasa` sorusu (ayırt edici cümle, çekim, dört alan, Ayrıntılar, zorunluluk, kart satırı, iki yönlü düğme; toplam / nakit farkı ve kümülatif yok), `kasa-aksam`, `kasa-foto` ve akşam adımı güncellendi; yöneticiye `fotograf` güncellendi, `yazarkasa-z` (karşılaştırmalar, kim görür, rozetler, ay satırı, kümülatif) ve `yazarkasa-oneri` (doldurma kapısı ve sahipten beklenenler) eklendi. Kapıya bağlı metinler `OKC_PREFILL_ENABLED`'dan okunur (sabit `true` olunca yardım ve kartın açıklaması kendiliğinden değişir); kartın açıklamasındaki "rakamlar dolar" kapı kapalıyken "öneri olarak çıkar" oldu (`cash-form.tsx`). `KALAN-ISLER.md` "Dalga 13" bölümü ve sahibe notlar. Testler: `yardim-personel` (yazarkasa sorusu, kapı, jargon ve yöneticinin rakamları yok), `yardim` (yöneticinin iki sorusu). Tarayıcı (`next dev` + `AI_REPLAY=1`, 390 ve 1440 px): personel ve yönetici Yardım'ında sorular açıldı, taşma yok, sayfa hatası yok; personelin kasa kartının açıklaması; `scripts/personel-sizinti.ts` temiz. Açık: belgelerdeki ölçüme bağlı rakamlar (tutar, süre, efor, kalite) ve `docs/YAZARKASA-Z.md` §6'nın cevapları b2'de; `scripts/okc-eval` ve `ekler/okc-z/teshis.md`, `eval.md` b2'de |
| b8 | Son doğrulama | `npx next typegen && npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'`, `npm test`, `npm run build`; gerçek fotoğraflarda `run.ts --tekrar 3`: **yanlış dolum 0, "doğrulandı ama yanlış" 0**, alan doğruluğu ≥ %95, ilk okuma p90 ≤ 20 sn → PR (taslak), canlı derleme günlüğünde migration ve çalışma zamanı hataları. **Durum (26 Ekim):** yerel doğrulama yapıldı (`claude/dalga-13b-okc-z`), canlı okuma ölçümü yapılmadı. İncelemenin bulguları düzeltildi: boş bırakılan isteğe bağlı Ayrıntılar "fotoğraftan farklı" sayılmıyor (fotoğraf kaldırma da açık); WhatsApp'ın "Değişen" satırında yazarkasa toplamı, KDV, fiş sayısı, yemek kartı ve diğer yalnız adıyla, "Fotoğraftan farklı"da fiş sayısı değersiz; Ayrıntılar yazarken kapanmıyor, ikinci banka fişinin sorusu kutuyu açık tutuyor; banka fişi okuması "doldu" ya da "Z raporu" demiyor; `bankPos` farkı "Banka gün sonu" (eski raporda "Banka POS"); ModPOS bölümünün yanlış belge düğmesi `switchTo: "kasa-pos"` (dağıtımdan önce açılmış sayfa D2'nin eski yolundan okutur, yeni form `kasa-okc`ye çevirir; b5'in "etiketsiz düğme" açığı kapandı), bölüme geçişte 3 fotoğraf sınırı; yeni cihaz / sıfırlanan Z sayacı (Z no ve kümülatif öncekinden küçük) yeni zincir başlatır; yöneticinin kayıtlı rapor denetimi yazarkasa dışı tahsilatı sayar; personel o tahsilatın tutarını hiçbir yerde görmez (K4'ün personel metninde fazlanın tutarı yok; okuma `extraTakings`, personelin DTO'su `okcExtraTakings` yalnız var olduğunu söyler ve fazlası turuncu olmaz); kayıtlı raporun personel satırı kendi metniyle; saklanmayan kümülatif notu tarafsız ("temizlenmiş" demiyor); ay satırının zinciri önceki ayın son kümülatifinden. Doğrulama: `tsc` 0, `eslint --max-warnings=0` 0, tam test (bütün veritabanı takımlarıyla) 1948 / 0, `npm run build` (yerel `DATABASE_URL`) 0; boş veritabanında `db:migrate && db:seed` 41 migration, `cash_reports`'ta 12 `okc_*` sütunu ve `ai_calls.effort`. Tarayıcı (`next dev` + `AI_REPLAY=1`): personel 390 px yeni rapor (ModPOS Z + yazarkasa Z + banka fişi, öneriler, gönderim, kayıtlı görünüm, WhatsApp'ta yazarkasa toplamı / KDV yok), Banka gün sonu "8915" ve %10 KDV "737,27" kutu açık kalarak eksiksiz yazıldı, yatay taşma yok; yönetici 1440 px günden güne (rozetler, ay satırı) ve kayıtlı rapor penceresi; `scripts/personel-sizinti.ts` personel çereziyle 28 yanıt, sızıntı yok; deneme verisi silindi. Açık (sahip / b2): gerçek fotoğraflarla `run.ts --tekrar 3` kapıları (yanlış dolum 0, "doğrulandı ama yanlış" 0, alan doğruluğu, p90) canlı anahtar ister; `OKC_PREFILL_ENABLED` o ölçüme kadar `false`; deneme e-postası gönderilmedi; PR ve canlı derleme günlüğü birleştirmede. Yalnız banka fişi okumasında tarih uyarısının iki kez çıkması (b5) b2'ye kaldı |
| c | **PR-c** (yalnız b2 / b8 tek okumanın yetmediğini gösterirse): yakın görünüm (`photo-closeup.ts`, yükleme, türetilmiş anahtar), `OKC_CLOSEUP`, `mergeReads`, `canReadCloser`, **Yakından bir daha oku**, `readingOf` birleştirerek | `--girdi yakin` `ayni-yeniden`'den ölçülerek üstün; aynı kapılar + ikinci okuma p90 ≤ 40 sn; gönderim ve öteki bölüm yakın okuma sürerken kilitlenmiyor; hak sınırı testi |
| 13b | (ayrı PR, dalga 12'den sonra) KDV tahmini ve vergi bölümünün kasa geliri yazarkasa tabanına | §9 tablosu ve çift sayma testleri; `okcMonth.complete` KDV kapsamını da istiyor |
| — | (ayrı küçük PR, PR-b'den en az iki hafta sonra) `kasa-pos` yüklemesinin ve yeniden okumasının kaldırılması | Bekleyen geç raporlarda `kasa-pos` yok; eski okumalar hâlâ gösteriliyor |

---

## Eleştiri kaydı (24 Ekim 2026)

Eleştirideki 20 madde koda karşı denetlendi (`cash-form.tsx` 820 / dalga 10'da 1.129 satır ve `busy = zUp.busy ||
posUp.busy` bütün seçicileri kilitliyor; `MAX_READS_PER_PHOTO` hata dahil her `ai_calls` satırını sayıyor; zaman aşımında
`usage` dönmediği için tutar 0; `TEXT_FIELDS` `String(dizi)`, `cash-requests.ts` › `same()` `Number(dizi)`; dalga 10'un
`reviewLate`'i `writeCashReport`'a `photos: link` veriyor; `leak-scan.ts`'in `COST_KEYS`'inde kümülatif anahtarı yok;
canlı ölçüm: `low`, 0 düşünme token'ı, 4–9 sn, 184–577 çıktı token'ı). Hepsi kabul edildi; dördü değiştirilerek.

| id | Karar | Neden / nasıl işlendi |
|---|---|---|
| c-dejenere-kimlik | kabul (sıkılaştırılarak) | Tek oranlı günde K1 / K2, tek ödemeli günde K4 aynı rakamın kopyalarını karşılaştırır; doğrulama kuralı "iki ayrı basılı rakam" oldu (D7, §5.2). Eleştiri K3'ü doğrulayıcı saymıştı; K3'ün payı fiş sayısıyla büyüdüğü için (143 fişte ~0,72 ₺ → toplamda ~8 ₺'nin altındaki hatayı görmez) K3 yalnız çürütür. Testler ve "doğrulandı ama yanlış" ölçütü ile kapısı eklendi (§10, §11, §17) |
| c-efor-bagimsizlik | kabul | İlk okuma `low` varsayılan; `medium` yalnız yanlış dolumu ve "doğrulandı ama yanlış"ı düşürür ve süreyi tutarsa (D8, §4.4); "düşünme payı işe yarar" varsayım olarak işaretlendi. Eleştirinin andığı Anthropic notu doğrulanamadı; karar ona değil ölçüme dayanıyor |
| c-ikinci-okuma-girdi | kabul | İki okumanın aynı çıkması güveni hiç yükseltmez (D9, §5.6). İkinci okuma farklı girdiyle: telefonda asıl fotoğraftan şeridin yakın görünümü, parçalar yan yana tek görselde (`run.ts` tek görselle kalır), türetilmiş anahtarla saklanır (migration yok) (§4.3). PR-b'de kodsuz yolu üst / alt yarı çekimi; değerlendirme üçünü karşılaştırır, aynı görselin yeniden okunması üstün çıkmadıkça eklenmez |
| c-sure-butcesi | kabul | Tek 50 sn'lik deneme, yeniden deneme yalnız hızlı hatada (§4.4); ilk okuma p90 ≤ 20 sn, ikinci ≤ 40 sn kabul ölçütü (§10, §17); `high` hiç kullanılmaz; şema küçültüldü (sıfır gruplar yok, `base` nullable, üç alan ölçülüp gerekirse çıkar, §4.1); durum metni ölçülen p50'den; 0 $ görünen zaman aşımı belgelenir |
| c-kumulatif-zincir | kabul | Kümülatif yalnız inandırıcıysa saklanır, zincir son saklanana bağlanır, yönetici temizleyebilir (D10, §6.1, §3.7). Hesap `writeCashReport`'ta, böylece dalga 10'un geç rapor onayı da yazar; geç gün önceki ve sonraki halkayla denetlenir ve onay kartında görünür (§3.8, §5.3) |
| c-okcmonth-kdv-kapsami | kabul | `vatDays`, `vatMissing`, ayrı `byRateEstimated`; `complete` Σ oranlar ≈ toplam şartını da arar; KDV'siz günü olan ay `complete: false` testi (§9, §11) |
| c-hassas-fark-personel | kabul | S2'nin varsayılanı "Hayır"; toplam, nakit, yemek kartı ve banka satırları yalnız yöneticide ve yöneticinin e-postasında; personelde ve WhatsApp'ta yalnız kart satırı (İlke 8, D13, §8, §16 S2). Gerekçe veri en aza indirme: rakam kayıtta eksiksiz durur, sahip ve muhasebe görür |
| c-personel-sizinti-prevokc | kabul | Zincir denetimi yalnız sunucuda; personelin formuna `{ date, zNo }`; okuma yanıtı personele kümülatif ve yazarkasa dışı tahsilatı taşımaz (`toStaffReading`); kendi anahtar listesiyle sızıntı testi (D17, §7, §11) |
| c-gonderim-kilidi | kabul | `busy` bölüm başına (PR-b'de de); ikinci okuma kendiliğinden başlamaz, düğmeyle başlar, gönderimi ve öteki bölümü kilitlemez; erken gönderilen raporun karşılaştırması o ana kadarki okumalardan kurulur, `readingOf` sonra birleştirir (D9, §3.3, §3.5) |
| c-surum-kaymasi-kasa-pos | kabul (ayrıntılandırılarak) | Geçiş süresince `kasa-pos` yükleme ve yeniden okuma kabul edilir, fotoğraf `kasa-okc` olur ve `OKC_TASK` ile okunur. Eklenen: eski istemciye yanıt eski biçimde ve `bankPos` yalnız banka gün sonu fişinden döner (eski `prefillPlan` bilmediği anahtarı atlıyor ama `kind` ve özet metinleri eski türü bekliyor). Kaldırma ayrı PR (D2, §7, §11, §17) |
| c-cihaz-gercekleri | kabul | Adım 0'da 2–3 ardışık gün ve aynı kâğıtlar; istemden önce KÜM. satırları, Z saati ve ModPOS'un yazıcısı doğrulanır (§1); S12, S13; `software_z` ve `Z_TASK` için "BİLGİ FİŞİ / MALİ DEĞERİ YOKTUR" (§4.2); `cases.json` `prevFrom` ile zincirlenir (§10.1); 05:00 ve "ertesi sabah" kuralları cevaba bağlandı (§5.4) |
| c-kapsam-asamalama | kabul | Üç PR (§1b): PR-a hemen ve migration'sız (iki kapı, metinler, başlıklar); PR-b yazarkasa bölümü, tek okuma; PR-c koşullu (yakın okuma, `mergeReads`, birleşik `readingOf`). PR-a'da yazarkasa bölümü olmadığı için Kart bölümüne çekilen yazarkasa Z'si alan doldurmaz ve K.KARTI satırını elle yazdırır |
| c-form-yuku-dil | kabul | Telefonda fotoğraf + dört alan, gerisi kendiliğinden açılmayan Ayrıntılar'da; personele alan başına tek neden ve tek özet satırı, jargonsuz metinler; zincir, iptal, yazarkasa dışı tahsilat ve "ertesi sabah" yalnız yöneticide (D16, §3.2, §3.3, §3.6); jargon testi |
| c-okcvat-karsilastirma | kabul | Ortak `sameVat` (sıralı, kuruşa yuvarlı, JSON); `revisionChanges` ve `same()`'de özel dal; `CashFieldsSchema`'da `okcVat` doğrulaması; aynı / farklı döküm testleri (§6.5, §7, §11) |
| c-maliyet-tahmini | kabul | Girdi ~9–11 bin token'a düzeltildi; adım b2'de `count_tokens` / `usage` ile ölçülüp S8 ve belgeler ona göre yazılır; zaman aşımında 0 $ görünmesi `docs/FOTOGRAF.md` §5'e (§4.4, §14, §16) |
| c-banka-satiri-kart | kabul | Kart satırı yoksa kart = Σ banka satırları (bilgi satırıyla), istem cümlesi, sentetik vaka ve test (§4.2, §5.2, §10.2, §11) |
| c-baslik-adi | kabul | "Banka POS Z raporu (yazarkasa)" ve "ModPOS Z raporu"; ayırt edici cümle; yardım ve belgelerde aynı ad (D1, §3.2, §14) |
| c-iki-aday-oneri | kabul | İki ayrı düğme, varsayılan yok, altında hangi denetimin tutmadığı (§3.5); PR-c'de |
| c-okuma-hakki | kabul | Yakın okuma düğmesi yalnız ondan sonra bir hak kalacaksa (`readsLeft ≥ 2`); hata sayımı değişmedi (zaman aşımına düşen istek sunucuda ücretlendirilmiş olabilir, saymamak sınırı delerdi) (§5.6, §11) |
| c-cash-form-bolme | kabul | `okc-card.tsx` (D18); `cash-form.tsx`'te yalnız köprü; PR-c'nin akışı da orada (§12, §13) |

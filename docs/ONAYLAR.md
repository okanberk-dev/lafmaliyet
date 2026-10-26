# Onaylar ve personel istekleri

Ekran: **Onaylar** (`/panel/onaylar`; yalnız yönetici, menüde **Bugün**'ün hemen altında). Personelin yöneticinin
onayına giden istekleri ve reçete önerileri tek yerde. Karar: dalga 10, sahibin isteği "önemli olan onaydan geçsin"
([planlar/personel-yetki.md](planlar/personel-yetki.md) §0, §3).

## Ne zaman onay istenir

İşlemin sonucu geçmiş bir kasa, stok farkı ya da gider kaydını değiştiriyorsa, bir kanıtı siliyorsa, para harcama
sözü veriyorsa ya da bir uyarıyı susturuyorsa personel doğrudan kaydetmez, **istek** gönderir. Anında yapılması
gereken, para taşımayan, geri alınabilen ve kimin yaptığı görünen işler onaysızdır (kasaya işle, ileri tarihli özel
gün, geçmiş kontrol listelerine bakmak, bar ekranında Tükendi / Satışa aç); onların korumaları görünürlük (işlem geçmişi, yöneticiye satır), sınır
ve geri almadır.

## Ekran

Bölümler sırasıyla, her biri kendi yükleme alanında (biri düşerse ötekiler açılır) ve kendi yönetici denetimiyle:

1. **Kasa:** kasa düzeltmesi ve silmesi, geç kasa raporu, kasadan çıkan, fotoğraf kaldırma, kapalı gün.
2. **Zayi ve ikram:** geç zayi / ikram, zayi silme. (Mal siparişi taslağı kartları 26 Ekim 2026'da mal siparişiyle
   birlikte kalktı; [MAL-SIPARISI.md](MAL-SIPARISI.md).)
3. **Reçete önerileri:** değişiklik ve yeni ürün (eskisi gibi; önce / sonra farkı, maliyet etkisi, "Reçete: son
   kararlar").
4. **Son kararlar:** personel isteklerinin son 30 günü: tür, başlık, isteyen, karar veren, not, durum.

Kartların çapası `#istek-<id>` (reçete kartlarınınki `#oneri-<id>`); zil ve sabah e-postası doğrudan karta götürür.
Reddederken yazılan not personele görünür: **tutar yazmayın**. Onayla / Reddet parola sormaz (parola onayı yalnız hesap
işlemlerinde). Maliyet modeli istek başına bir kez kurulur (`loadModelOnce`).

## Türler

| Tür (`kind`) | Ne | Konu (`subject`) | Süre | Plan |
|---|---|---|---|---|
| `kasa-duzeltme` | Kasa raporunu ertesi gün (kasa alanı ya da Sayan) ya da kilitlendikten sonra düzeltmek | `gun:<D>` | yok | §2.3 |
| `kasa-silme` | Kasa raporunu sildirmek | `gun:<D>` | yok | §2.3 |
| `kasa-gec` | Unutulan eski günün kasa raporu (14 gün; Z fotoğrafı ve Z no ile) | `gun:<D>` | yok | §2.6 |
| `kasa-cikan` | Kapanmış ya da eski güne kasadan çıkan; yöneticinin kategorisindeki satırı değiştirmek | `cikan:<id>`, `cikan-yeni:<anahtar>` | 14 gün | §2.7 |
| `foto-kaldir` | Yanlış Z / POS fotoğrafını rapordan kaldırtmak (okuma farkı olan ve raporun tek Z fotoğrafı hariç) | `foto:<id>` | yok | §2.7 |
| `kapali-gun` | Dün kafe kapalıydı | `gun:<D>` | yok | §2.9 |
| `zayi-gec` | 14 güne kadar geç zayi / ikram | `zayi-yeni:<anahtar>` | yok | §2.8 |
| `zayi-sil` | Başkasının ya da kilitli günün zayi kaydını sildirmek | `zayi:<id>` | yok | §2.8 |
| `mal-taslak` | **Kaldırıldı (26 Ekim 2026).** Eskiden hızlı sayımdan sonra fiyatsız mal siparişi taslağı. Tür eski satırlar için enumda kalır (`RETIRED_REQUEST_KINDS`): yeni istek açılmaz, Onaylar, Bugün, zil, sabah e-postası ve Son kararlar okumaz, sabah işi bekleyen ya da onaylanmış eski taslağı "Süresi doldu" yapar ([MAL-SIPARISI.md](MAL-SIPARISI.md)) | `tedarikci:<anahtar>` | (sabah işi kapatır) | §2.4 |

Türe özel alanlar `payload` (istek) ve `result` (karar) içinde, her okumada zod ile çözülür. `title` tutarsız ve kişisel
veri taşımayan tek satırdır ("22 Ekim kasa düzeltmesi", "Latte M ×2 · 15 Eki"); zil, işlem geçmişi,
sabah e-postası ve Son kararlar bunu yazar.

## Durumlar

| Durum | Anlamı |
|---|---|
| `pending` · Onay bekliyor | Karar bekliyor; kayıt değişmedi |
| `approved` · Onaylandı | Yönetici onayladı, kayıt yöneticinin kendi yazım yolundan aynı denetimlerle değişti |
| `rejected` · Reddedildi | Kayıt değişmedi; not personele görünür |
| `withdrawn` · Geri çekildi | Personel geri çekti (ya da `db:reset`) |
| `superseded` · Kapandı | Başka bir yol aynı işi yaptı (rapor başka bir istekle düzeltildi, yönetici günü kendisi girdi, kayıt silindi); not nedenini söyler |
| `expired` · Süresi doldu | Süresi olan istek karara bağlanmadan doldu (sabah işi kapatır) |
| `done` · Tamamlandı | Onaylanan mal siparişi taslağı gönderildi (yalnız kaldırılan türün eski satırlarında) |
| `cancelled` · Geri alındı | Gönderilen taslak 10 dakika içinde geri alındı (yalnız kaldırılan türün eski satırlarında) |
| `revoked` · Kaldırıldı | Onaylı kapalı gün işareti kanıt gelince kalktı |

## Kurallar

- **Kayıt onaya kadar değişmez.** İstek ayrı tabloda (`staff_requests`) bekler. Onay, yöneticinin kendi yazım yolundan
  aynı denetimlerle geçer.
- **Kişi başına konu başına tek bekleyen istek:** aynı kişi aynı konuya yeniden gönderince bekleyen isteği güncellenir,
  sürümü (`version`) artar. İki personelin istekleri birbirini engellemez.
- **Çift dokunuş:** istemcinin ürettiği anahtar (`client_key`) ikinci istek açmaz, bekleyen isteği döner. İstek bu
  arada karara bağlandıysa ya da kapandıysa aynı anahtarla tekrar reddedilir ("Bu istek zaten karara bağlandı ya da
  kapandı; sayfayı yenileyin"): eski sayfa "Onaya gönderildi" demez, fotoğraf yeniden tutulmaz.
- **Yönetici yalnız gördüğü sürümü onaylar:** kart sürümü taşır; istek arada güncellendiyse "İstek siz bakarken
  değişti; yeniden bakın". Aynısı reçete önerileri için de geçerlidir (`recipe_change_requests.version`).
- **Kimse kendi isteğini onaylayamaz** (sonradan yönetici yapılan hesap da). Yönetici istek açmaz; doğrudan yapar.
- **Geri çekme koşulludur:** yalnız bekleyen ve kendi isteği; aynı anda verilen onayla yarışta tek sonuç kalır.
- **Fotoğraf tutma:** istek beklerken eklenen fotoğraflar (`photo_ids`) bağlanmaz ve silinmez; başka bir istek ya da
  kayıt aynı fotoğrafı alamaz ("Bu fotoğraf onay bekleyen bir istekte"). Geri çekme, ret, kapanma ve süre dolmasında
  fotoğraf bırakılır (7 gün sonra silinir; geç kasa raporunun reddinde 30 gün).
- **Sınırlar (kişi başına):** açık istek tür grubu başına 10 (kasa), 5 (geç kasa raporu), 20 (zayi);
  iş günü başına 30 istek; konu başına iş günü başına 3 istek (geri çekilen ve reddedilen dahil). İş günü 05:00'te
  döner.
- **Zil kimliği** (`bumped_at`) istek güncellenince en çok 10 dakikada bir yenilenir.
- **Süre:** kasadan çıkan isteği 14 güne kadar canlıdır; sabah işinin "Personel istekleri" adımı süresi geçen bekleyen
  istekleri ve kaldırılan türün (mal siparişi taslağı) bekleyen ya da onaylanmış eski satırlarını kapatır. Onaylanmış
  öteki istekler kayda geçmiştir; süreleri dolsa da onaylı kalır.
- **KVKK:** personel hiçbir yerde (ekran, sayfa verisi, eylem yanıtı, zil, push, e-posta) maliyet, alış fiyatı, fatura
  tutarı, maaş, kâr, marj, komisyon ya da karaoke parası görmez; personelin okuyucuları sabit sütunla yazılır ve
  kaynak testiyle sabitlenir (`tests/helpers/leak-scan.ts`).

## Bildirimler

- **Zil:** yöneticide **Onaylar** başlığında istek başına bir satır (`/panel/onaylar#istek-<id>`); personelde aynı
  başlığın adı **İsteklerim**: kendi isteklerinin ve reçete önerilerinin sonucu. Satırları alanların modülleri üretir
  (`src/server/bell/kasa.ts`, `src/server/bell/ops.ts`; [BILDIRIMLER.md](BILDIRIMLER.md)).
- **Bugün:** yöneticinin **Onaylar** satırı reçete önerilerini ve istekleri birlikte sayar: "1 kasa düzeltmesi · 2
  reçete değişikliği · 1 geç zayi / ikram · en eskisi 2 gündür" ([BUGUN.md](BUGUN.md)).
- **Sabah e-postası:** "Onay bekleyenler" kutusu: "2 istek onay bekliyor", en eskisinin beklediği ve istek başına
  başlık ile isteyenin adı; karar verilene kadar her sabah.
- **Push:** konu `approvals` (aboneliğin `approvals` sütunu, varsayılan açık). Tek gönderen mal siparişi taslağıydı
  (Dalga 10b); 26 Ekim 2026'da kalktı, bugün hiçbir istek push göndermez (zil, Bugün ve sabah e-postası). Tesisat
  duruyor: cihazdaki "Onay bildirimleri" anahtarı ancak yeniden bir gönderen olunca **Bu cihazda uyarılar** kartına
  döner (`tests/onay-kuyrugu.test.ts` tutar). Gelen onay bildiriminde sekme bildirimi kendisi gösterir, zili tazeler ve
  Onaylar'ı yeniler (`alert-center.tsx`, `src/lib/live-poll.ts` › `refreshesScreen`).
- **İşlem geçmişi:** eylem adları her türün kendi maddesinde; ayrıntıda nedenin yalnız ilk 200 karakteri. Genel geri
  çekme "Kasa düzeltmesi geri çekildi", "Geç zayi / ikram isteği geri çekildi" gibi türün adıyla yazılır.

## db:reset

`npm run db:reset` bekleyen istekleri geri çeker (not "Veritabanı sıfırlandı"), onaylanmış ama gönderilmemiş mal
siparişi taslağını süresi dolmuş sayar; tuttukları fotoğraflar 7 gün sonra silinir. İstekler kaydıyla kalır.

## Geliştirici notu

- Saf kurallar: `src/lib/staff-requests.ts` (türler, durumlar, etiketler, sınırlar, `reviewRefusal`, `nextBump`,
  `isExpired`, e-posta satırları).
- Çekirdek: `src/server/staff-requests/core.ts` (`server-only` ve `"use server"` değil; veritabanını ya da işlemi
  parametre alır): `createOrUpdateRequest` (kişinin danışma kilidi altında), `peekForReview` → `lockForReview` →
  `decide`, `withdrawOwn`, `supersede`, `assertNotHeld`, `releaseHeld`, `expireStaffRequests`; okuyucular
  `countPendingByKind`, `pendingRequests`, `recentDecisions`, `ownRequests` (ham yük yok). Kullanıcıya gösterilen
  hatalar `UserError` (`src/server/user-error.ts`).
- **Kilit sırası: önce konu, sonra istek.** İsteği açan ve güncelleyen yol konu nesnesini kilitleyip
  `createOrUpdateRequest`'e geçer: kasadan çıkan satırı, kasa raporu, günün danışma kilidi (`kasa-gec:<gün>`,
  `kapali-gun:<gün>`), zayi kaydı. Doğrudan yazımlar da (satırı ya da
  kaydı silmek, günü doğrudan girmek ya da kapalı işaretlemek) konu nesnesini kilitleyip bekleyen istekleri öyle kapatır.
  Karar aynı sırayla: `peekForReview` kilitsiz okur, konu nesnesi kilitlenir, sonra `lockForReview(…, { peeked })`
  bütün denetimleri kilit altında yeniden yapar. Ters sıra, personelin güncellemesiyle aynı anda verilen onayı
  kilitlenmeye (40P01, "İşlem tamamlanamadı") düşürür. Yeni bir karar çekirdeği de bu sırayla yazılır; kaynak testi
  (`tests/onay-kuyrugu.test.ts`) her `lockForReview` çağrısında `peeked` ister, veritabanı testleri yarışı
  `tests/helpers/lock-race.ts` ile kurar (üçüncü bir bağlantı istek satırını tutar, iki yol sırayla beklemeye girer).
- Genel eylem: `src/server/actions/staff-requests.ts` → `withdrawStaffRequest` (tek export). İstek ve karar eylemleri
  her alanın kendi `"use server"` dosyasında; her biri kendi oturum ve rol denetimini yapar (`requireUser` /
  `requireAdmin`).
- Yeni tür: şemadaki enum ve `STAFF_REQUEST_KINDS` (migration), `KIND_LABEL`, `KIND_COUNT_LABEL`, `KIND_GROUP`,
  `WITHDRAW_LOG`, `STAFF_APPROVAL_KINDS` (personel Yardım'ı); Onaylar'da kartı, zilde satırı.
- Testler: `tests/onay-kuyrugu.test.ts` (saf kurallar ve kaynak denetimleri), `tests/onay-kuyrugu-db.test.ts`
  (`ONAY_TEST_DATABASE_URL`; tek bekleyen, istemci anahtarı, sürüm, kendini onaylama, geri çekme ile onay yarışı,
  sınırlar, supersede, fotoğraf tutma, süre dolması). Kilit sırası yarışları her alanın kendi veritabanı testinde
  ("kilit sırası: …"): kasadan çıkan ve fotoğraf kaldırma, kasa düzeltme ve silme, geç rapor (yöneticinin doğrudan
  girişi dahil), zayi silme, kapalı gün. Kaldırılan tür: `tests/onay-kuyrugu-db.test.ts` › "kaldırılan tür" ve
  `tests/hizli-siparis-kaldirildi.test.ts`.

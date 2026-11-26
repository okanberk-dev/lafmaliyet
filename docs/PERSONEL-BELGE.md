# Personel belgeleri ve avanslar

Yönetici her çalışanın belgelerini (hijyen eğitimi, sağlık raporu, SGK işe giriş bildirgesi, öteki belgeler) geçerlilik
bitişleriyle tutar; bitişe 30 gün kala ve süresi dolunca zilde ve sabah e-postasında hatırlatılır. Avans ekranı kişiye
verilen avansları ve maaştan düşülenleri, kişi başı kalanı tutar. İkisi de **yalnız yöneticinin**: personel menüde
görmez, adresi açamaz (proxy ve `requireAdmin`), dosya yolu personele 403 döner.

Ekranlar Giderler & maaşlar'ın sekmeleri: **Sabit giderler · Aylık harcamalar · Maaşlar · Belgeler · Avanslar**
(`src/components/panel/nav.ts` › `SECTION_TABS.giderler`; ⌘K'da "Personel belgeleri" ve "Personel avansları").

## Dosyalar

| Ne | Nerede |
|---|---|
| Belgenin kuralları (saf): türler, durum, yenilenme, hatırlatma, zil satırları, e-posta kutusu, form ve dosya denetimi | `src/lib/staff-docs.ts` |
| Avansın kuralları (saf): bakiye, kesinti sınırı, silme, bu ay ele geçecek | `src/lib/staff-advances.ts` |
| Belge çekirdeği: liste, ekle (önce depo, sonra satır), düzelt, sil, dosyayı oku, hatırlatmalar, e-posta kutusu | `src/server/staff-docs.ts` |
| Avans çekirdeği: liste, ekle, sil (kişinin satırı kilitli) | `src/server/staff-advances.ts` |
| Sunucu eylemleri (yalnız yönetici, işlem geçmişi) | `src/server/actions/staff-docs.ts` |
| Dosyanın kendisi (yalnız yönetici, `no-store`) | `GET /api/personel/belge/{id}` (`?indir=1` indirir) |
| Ekranlar | `/panel/personel/belgeler`, `/panel/personel/avans` |
| Tablolar | `staff_documents`, `staff_advances` (migration `0092_personel_belge_avans`) |
| Testler | `tests/personel-belge.test.ts`, `tests/personel-avans.test.ts` (saf), `tests/personel-belge-db.test.ts` (Postgres) |

## Belgeler

- **Türler:** Hijyen eğitimi, Sağlık raporu (portör), SGK işe giriş, Diğer (adı yazılır: sözleşme, ikametgâh…). Yeni tür
  migration istemez (`DOC_KINDS`). Kişi başına birden çok belge; en çok 40.
- **Alanlar:** düzenlenme günü (isteğe bağlı), geçerlilik bitişi (süresizse boş), ek ad, not, dosya (isteğe bağlı).
- **Geçerlilik:** bitiş günü belgenin geçerli olduğu **son gündür**. Bitişe 30 gün ve daha azı kala "N gün kaldı",
  o gün "Bugün bitiyor", ertesi gün "Süresi doldu". Bitişi boş belge "Süresiz"dir, hatırlatılmaz.
- **Yenileme:** aynı kişinin aynı türden (Diğer'de aynı addan) daha geç biten ya da süresiz bir belgesi eklenince eskisi
  **"Yenilendi"** olur ve hatırlatılmaz; silmek gerekmez, geçmiş olarak kalır (`supersededIds`). Bitişler eşitse sonra
  eklenen geçer.
- **Ayrılan kişi:** son ayı bu aydan önce olan ya da pasif kişinin belgesi hatırlatılmaz; ekranda "Ayrılanların
  belgeleri" altında kapalı durur.
- **Eksik:** hijyen, sağlık raporu ve SGK'dan hiç girilmemiş olan kişinin kartında "Eksik: …" yazar (bilgi; hatırlatma
  değil).
- **Dosya:** PDF, JPG, PNG ya da WebP, en çok 4 MB (tür içerikten okunur; tarayıcının söylediğine güvenilmez).
  Fotoğraf telefonda küçültülüp gider, PDF olduğu gibi. Dosya fotoğraflarla **aynı özel depoda**
  (`src/server/storage`; canlıda özel Vercel Blob, yerelde `.data/photos`), anahtar
  `personel-belge/<yıl>/<ay>/<uuid>.<uzantı>`; deponun adresi hiçbir yere çıkmaz. Dosya yalnız
  `/api/personel/belge/{id}`'den verilir: yönetici değilse 403, tarayıcı saklamaz (`private, no-store`), fotoğraf
  `CSP sandbox` ile. İndirilen dosyanın adı kişiden, belgeden ve bitişten: `Ayse-Yilmaz_Saglik-raporu_2027-03-12.pdf`.
- **Depo yoksa** (Vercel önizlemesi): dosya seçilemez, belge dosyasız (yalnız tarihleriyle) kaydedilir; hatırlatmalar
  yine çalışır.
- **Düzeltme** türü, adı, tarihleri ve notu değiştirir; dosya değişmez (yeni dosya için yeni belge eklenir, eskisi
  "Yenilendi" olur). **Silme** önce dosyayı, sonra satırı siler; geri alınmaz (ekran onay sorar).
- **Kişi silinince** (Maaşlar; yalnız hiçbir maaş ayına girmemiş kişi silinebilir) belgeleri de silinir: satırlar
  cascade ile, dosyalar işlemden sonra depodan (silinemezse günlüğe yazılır).

## Hatırlatma

- **Zil (yalnız yönetici, Uyarılar; vardiya hatırlatmasının hemen ardından):** süresi dolan belgeler tek satır
  ("2 personel belgesinin süresi doldu"), 30 gün içinde bitecekler tek satır; gövdede en çok üç "kişi · belge (durum)", fazlası "ve N belge daha". Bağlantı
  Personel belgeleri. Kimlik belgelerden ve bitişlerden türer: yeni bir belge bitince ya da yaklaşınca satır yeniden
  okunmamış olur, gün geçti diye olmaz. Seçili şubenin kişileri ("Tümü"de hepsi). Okunamazsa "Uyarılar yüklenemedi"
  satırı (`src/lib/bell-failed.ts` › `belge`).
- **Sabah e-postası:** "Personel belgeleri" kutusu (`src/server/notify/digest-extras.ts` › `staffDocs`), her belge her
  aşamada **bir kez**: bitişe 30 gün ve daha az kala (`belge:<id>:<bitiş>:30`) ve bitince (`belge:<id>:<bitiş>:bitti`);
  anahtar başarılı gönderimden sonra `notification_log`'a yazılır. Bitiş günü değişirse (yenilendi, düzeltildi) aşamalar
  yeniden işler. Kutu haberdir (konuya girer, tek başına e-postayı gönderir). Şubeye bağlı alıcıya yalnız o şubenin
  kişileri. Biten satırlar kırmızı, yaklaşanlar turuncu; en çok 8 satır.

## Avans

- İki hareket, tutar hep artı: **Avans verildi** (kişiye verilen para) ve **Maaştan düşüldü** (maaş öderken avanstan
  düşülen). Kişinin **kalan** avansı = verilenler − düşülenler.
- **Kurallar** (`advanceProblem`; sunucu aynı kuralla reddeder): tutar > 0 (en çok 10.000.000 ₺), ileri tarih yazılmaz,
  kesinti kalanı aşamaz (kişi alacaklı duruma düşmez; fazla kesinti yazım hatasıdır). Yazım kişinin satırı kilitlenerek
  yapılır: aynı anda gelen iki kesinti kalanı birlikte aşamaz.
- **Silme:** kesinti her zaman silinir; avans ancak silindikten sonra bakiye hiçbir anda eksiye düşmüyorsa ("Bu avansın
  kesintisi yazılmış; önce kesintiyi silin").
- **Maaş hesaplarıyla tutarlılık:** avans **gider değildir**. Maaş Giderler & maaşlar'da işveren maliyetiyle zaten
  kâr-zarara girer; avans o maaşın erken ödenen parçasıdır, ayrıca gider yazılırsa aynı para iki kez sayılır. Bu yüzden
  avans hiçbir maliyet, kâr-zarar, vergi ya da nakit planı hesabına girmez (`tests/personel-avans.test.ts` kaynağı tarar).
  Ekran yalnız şunu gösterir: **Bu ay ele geçecek = bu ayın net maaşı + ek ödeme − bu ay maaştan düşülen** (eksiye
  inmez; net maaş Maaşlar'daki aydan itibaren geçerli tutar). Part-time çalışanın aylık net maaşı olmadığı için
  ("Günlük ücretli") hesaplanmaz.
- Kalan avans bir aylık net maaşı aşıyorsa kartta uyarı: tek maaştan düşülemez.
- Avansı **kasadan** verdiyseniz kasa sayımı tutsun diye Kasa raporu'na "Teslim" (kasadan birine verilen para) olarak da
  girin; Avanslar ekranı yalnız kişinin bakiyesini tutar, kasaya yazmaz.
- **Kişi silme:** avans hareketi olan kişi Maaşlar'dan silinemez ("Silinemez: avans hareketi var. Ayrıldıysa durdurun");
  ayrıldıysa bitiş ayı girilir, hareketleri kalır.

## Yedek

Tablolar (`staff_documents`, `staff_advances`) tam yedeğe olduğu gibi girer. Belge **dosyaları** fotoğraflar gibi depoda
durur, yedek dosyasına girmez ([YEDEK.md](YEDEK.md)); geri yüklenen bir yedekte satır dosyasız görünürse ("Belge
bulunamadı") dosya yeniden eklenir.

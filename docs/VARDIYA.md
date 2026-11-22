# Vardiya planı

Ekran: **Vardiya ayarlama** (`/panel/vardiya`; yöneticinin kenar çubuğunda Kasa raporu'nun altında, personelde adı
**Vardiya**). Yönetici haftanın vardiyalarını yazar, kaydeder; **PDF'i kendiliğinden hazırlanır** ve plan sonradan aynı
ekranda düzenlenir. Personel planı kendi ekranında görür, PDF'ini alır; değiştiremez.

## Geliştirilmiş istek (prompt)

Sahibin isteği (22 Kasım 2026): "ladmine de vardiya ayarlama diye ayrı sekme yap ve yazınca otomatik pdf olarak
çıkarsın ayarlayıp sonra düzenlenebilir olsun (bunu bağlantılı yapasın gereken yerler ile)".

> Panele haftalık vardiya planı ekle. Yönetici haftayı (Pazartesi–Pazar) kişi × gün ızgarasına **yazarak** doldursun:
> kutuya "10-18" yazınca vardiya, "izin" yazınca izin olsun; kaydedilen plan her zaman yeniden açılıp düzenlensin.
> Plan kaydedilince **PDF'i hazır olsun** (A4 yatay, asılacak ya da gönderilecek hâlde) ve her değişiklikten sonra
> kendiliğinden güncel kalsın. Personel planı görsün, kendi haftasını bir bakışta okusun. Plan panelin öteki
> yerlerine bağlansın: menü ve arama, Bugün ekranı, yetki tablosu, Yardım, şube seçici ve karaoke rezervasyonlarının
> personel e-postaları (o gün vardiyada olanlara gitsin).

## Ekran

- **Hafta:** `?hafta=YYYY-AA-GG` (haftanın herhangi bir günü; Pazartesi'ye yuvarlanır, yoksa bu hafta). Başlıkta
  **Önceki**, **Bu hafta**, **Sonraki**.
- **Şube:** plan şube şubedir. Panelin şube seçicisindeki fiziksel şube gösterilir ("Tümü" ya da laffogato.net
  seçiliyken Tuzla); birden çok şube açıkken sayfanın başında şube düğmeleri durur (seçim panelin seçicisine yazılır,
  [SUBE.md](SUBE.md) › Seçici). Şubesine kilitli personel yalnız kendi şubesinin planını görür.
- **Satırlar (yönetici):** şubenin etkin personel hesapları (şubesi bu şube olan ya da şubesi boş olan), planı boş
  olsa da; o hafta planı olan herkes (hesabı olmayan, pasife alınan, başka şubeden gelen kişi de). **Kişi ekle:**
  yazılan ad bir hesabın adıysa (yönetici, başka şubenin personeli) o hesabın satırı açılır; değilse çalışan yalnız
  adıyla yazılır ("hesabı yok"; part-time gibi). Bir haftada en çok 60 kişi.
- **Kutular yazılır:**

  | Yazılan | Anlamı |
  |---|---|
  | `10-18`, `10:30-18`, `10.30-18.45`, `1000-1800` | 10:00–18:00 gibi saatler |
  | `18-02`, `16-24`, `16-00` | Gece yarısını geçen ya da gece yarısında biten vardiya (en geç ertesi gün 06:00) |
  | `10-18 kasa` | Saatlerin ardına görev notu (en çok 40 karakter) |
  | `izin`, `izinli`, `off`, `x`, `tatil` (+ not: `izin rapor`) | İzin |
  | boş | O gün planlanmadı |

  Kutudan çıkınca (ya da Enter'la bir alt kutuya geçince) metin biçimlenir: "10-18 kasa" → "10:00–18:00 · kasa".
  Okunamayan kutu kırmızı olur, üstte nedeni yazar ("Ayşe, Salı: Saat 00–23 arasında olmalı…"), **Kaydet** kapanır.
  Bir vardiya en çok 16 saat sürer ("18-17" gibi yazım hatası 23 saatlik vardiya olmasın). Kişi ve gün başına tek
  vardiya (bölünmüş vardiya notla yazılır).
- **Kaydet** bütün haftayı tek eylemle yazar: değişen kutu yazılır, boşaltılan silinir, değişmeyene dokunulmaz.
  Değişiklik varken altta kaydetme çubuğu durur ("3 değişiklik · Kaydedilmedi"); başka haftaya, şubeye ya da sayfaya
  geçerken "Kaydedilmemiş vardiya var" diye sorulur. Kayıttan sonra "Plan kayıtlı; PDF güncel" satırı ve bildirimde
  **PDF'i aç**.
- **Geçen haftayı kopyala:** geçen haftanın planı yalnız **boş** kutulara kopyalanır (yazılmış kutunun üstüne yazmaz);
  kaydedilene kadar taslaktır.
- **Toplamlar:** satırın sonunda kişinin haftalık saati ("37,5 sa"), altta gün gün çalışan sayısı ve haftanın toplamı.
- **Telefonda (yönetici):** yedi sütun sığmadığı için ızgara gün gün yazılır: üstte gün seçilir (Pzt 23 … Paz 29),
  altında o günün kutuları kişi kişi. Yatay kaydırma yok.
- **Personel:** üstte **Benim haftam** (gün gün saatleri ve haftalık toplamı), altında bütün ekibin planı (salt okunur,
  kendi satırında "Siz"). Plan yazılmadıysa "Bu hafta için vardiya yazılmadı".
- Ekranda tutar, maaş ya da maliyet yoktur.

## Hazır vardiyalar: sabahçı ve akşamcı (22 Kasım 2026)

Operatör: "vardiya kısmına sabahçı akşamcı ekle, tıklamayla olsun". Izgaranın üstündeki **Hazır vardiya** satırından biri
seçilir ve kutulara tıklanır; aynı kutuya ikinci tıklama boşaltır. **Elle yaz** seçiliyken kutular eskisi gibi klavyeyle
yazılır. Telefonda da aynı (seçiliyken klavye açılmaz).

| Şube | Sabahçı | Akşamcı | Dayanak |
|---|---|---|---|
| Tuzla | 09:00–18:00 | 16:00–01:00 | 09:00 açılış, vardiya 9 saat, akşamcı 16:00'da gelir |
| Marina | 09:30–18:30 | 13:00–22:00 | 09:30 açılış, vardiya 9 saat, akşamcı 13:00'te gelir, kapanış 22:00 |

- Ayrıca **İzin** ve **Sil**. Hazır vardiyası tanımlı olmayan şubede yalnız bu ikisi çıkar.
- Ad saatlerden türer (veritabanında ayrı alan yok): saatleri şubenin hazır vardiyasıyla aynı olan hücre, elle yazılsa
  da, ızgarada kutunun altında, personelin görünümünde ve PDF'te "Sabahçı" / "Akşamcı" diye görünür. Görev notu eklenebilir
  ("9-18 kasa" yine sabahçıdır).
- Saatler `src/lib/vardiya.ts` › `SHIFT_PRESETS`'te; değişirse orası güncellenir, eski haftalar yazıldıkları saatlerle
  kalır (yeni saatle eşleşmeyen eski hücre "başka saat" olarak görünür).

## PDF

`GET /api/vardiya/pdf?hafta=YYYY-AA-GG&sube=tuzla` (ekrandaki **PDF** düğmesi; yeni sekmede açılır, dosya adı
`vardiya-tuzla-2026-11-23.pdf`).

- **Kendiliğinden güncel:** dosya saklanmaz; her istekte **kaydedilen** plandan yeniden çizilir. Plan değişip
  kaydedilince aynı adres yeni planı verir. Kaydedilmemiş değişiklik varken düğme "Önce kaydedin" der.
- **Görünüm** (22 Kasım 2026: "pdf tasarımını daha estetik yap, logomuzu kullan"): A4 yatay. Üstte markanın derin
  yeşil bandı: solda L'Af logosu (sitenin e-postalarındaki beyaz işaret, `src/server/vardiya/logo.ts`'te gömülü), "L'AFFOGATO ·
  TUZLA" altın etiket ve "Vardiya planı", sağda haftanın tarihleri. Altında kişi × gün tablosu: **Sabahçı** altın,
  **Akşamcı** yeşil kutuda adıyla (adın yanında görev notu, altında saatler), başka saat gri kutuda, "İzin" kesik
  çizgili, planlanmayan gün nokta. Sağda kişinin haftalık toplamı, altta gün gün çalışan sayısı ve renklerin açıklaması
  (şubenin sabahçı ve akşamcı saatleriyle); alt bilgide oluşturulma anı ve son değişikliği yapan. 9 kişiye kadar ferah,
  13 kişiye kadar tek sayfa, sonrası yeni sayfaya geçer (başlık her sayfada). Planı boş kişiler PDF'e girmez.
- **Kim alır:** giriş yapmış herkes; şubesine kilitli personel yalnız kendi şubesininkini (başka şube 403), oturumsuz
  istek 401.
- **Yazı tipi:** Inter'in (SIL OFL 1.1) Latin ve Türkçe harflere indirilmiş TrueType kopyaları
  (`src/server/vardiya/fonts/`, dosya başına ≈ 40 KB; lisansı ve nasıl üretildiği yanında). PDF'in standart yazı
  tiplerinde ğ, ş, ı, İ yoktur. Dosyalar çalışma anında diskten okunur ve Vercel işlevine `next.config.ts` ›
  `outputFileTracingIncludes` ile konur. Kapsam dışındaki karakter (emoji) "?" olur.
- Kitaplık: `pdf-lib` + `@pdf-lib/fontkit` (saf JavaScript; tarayıcı ya da harici araç gerekmez).

## Nerelere bağlı

| Yer | Ne |
|---|---|
| Kenar çubuğu, ⌘K, telefon başlığı | İki rolde üst düzeyde, Kasa raporu'nun altında. Yöneticide "Vardiya ayarlama", personelde "Vardiya" (aynı düğüm, role göre ad: `nav.ts` › `labelFor`); arama "vardiya ayarlama", "çizelge", "izin", "pdf" sözcükleriyle bulur |
| Yetki (`src/lib/roles.ts`) | `/panel/vardiya` personele açık (`STAFF_PATHS`); planı yalnız yönetici yazar (eylem `requireAdmin`). Kullanıcılar & roller'deki tabloda iki satır |
| Bugün › Bugün kafede | "Vardiyada: Ayşe 10:00–18:00 · Çağrı 16:00–00:00 · ve 2 kişi" (iş gününün çalışanları, başlangıç saatine göre, ilk adlar; seçili şube, "Tümü"de bütün şubeler). Vardiya ekranına götürür; plan yoksa satır yok |
| Karaoke personel e-postaları | Rezervasyon günü sabah ve 3 saat kala giden e-postalar o gün Tuzla'da çalışan olarak yazılmış, hesabı etkin kişilere gider (vardiyaya yazılan yönetici dahil; izinli sayılmaz); o güne plan yazılmadıysa Tuzla'nın bütün etkin personeline ([KARAOKE.md](KARAOKE.md)). Okuyan `src/server/karaoke/staff-mail.ts`, `shifts` tablosundan |
| Şube seçici | Plan seçili fiziksel şubenin; şubesine kilitli personel kendi şubesini görür ([SUBE.md](SUBE.md)) |
| Yardım | Yöneticide "Vardiya planını yazmak ve PDF'ini almak", personelde "Bu hafta hangi gün, kaçta vardiyam var?" |
| İşlem geçmişi | "Vardiya planı kaydedildi · Tuzla · 23–29 Kasım 2026 · 5 kişi · 28 vardiya · 3 izin" |
| Yedek | `shifts` tablosu yedeğe girer (gizli alan yok) |

## Veri

`shifts` tablosu (migration `0067_karaoke_hatirlatma_vardiya.sql`): şube, gün ve kişi başına **tek satır**
(`shifts_branch_date_person_uq`).

| Alan | Ne |
|---|---|
| `branch_id` | Şube |
| `date` | Vardiyanın başladığı gün (Türkiye), `YYYY-MM-DD` |
| `person_ref` | Kişinin anahtarı: hesap `u:<kullanıcı kimliği>`, hesabı olmayan çalışan `n:<küçük harfli ad>` |
| `user_id` | Hesap (silinirse boşalır, satır adıyla kalır) |
| `person_name` | Kaydedildiği andaki ad; hesabı duran kişi ekranda ve PDF'te güncel adıyla görünür |
| `kind` | `work` (saatli vardiya) ya da `off` (izin) |
| `start_min`, `end_min` | Günün başından dakika; gece yarısını geçen vardiyada `end_min` 1440'tan büyük (en çok 1800 = ertesi gün 06:00). İzinde boş (CHECK `shifts_time_ck`) |
| `note` | Görev ya da izin notu |
| `updated_by_name`, `updated_at` | Hücreye en son kim, ne zaman dokundu |

Satır yoksa kişi o gün planlanmamıştır. Aynı haftayı iki sekme birden kaydederse sırayla yazar (hafta başına danışma
kilidi), aynı kutuda son yazan kalır; bir sekmenin bilmediği kişinin satırına dokunulmaz.

## Dosyalar

| Dosya | Görev |
|---|---|
| `src/lib/vardiya.ts` | Saf kurallar: kutunun okunuşu ve yazılışı, hafta hesabı, kişi anahtarı, toplamlar, kaydın farkı, giriş şeması, Bugün satırının metni |
| `src/server/vardiya/store.ts` | Haftanın okunması (personel + planı olanlar), kaydı (tek işlem, yalnız değişen), günün çalışanları (`shiftsOn`, `todayShifts`) |
| `src/server/vardiya/pdf.ts`, `src/server/vardiya/fonts/` | PDF'in çizimi (pdf-lib); gömülen yazı tipi, lisansı ve nasıl üretildiği |
| `src/server/actions/vardiya.ts` | `saveShiftWeekAction` (yalnız yönetici; işlem geçmişi) |
| `src/app/api/vardiya/pdf/route.ts` | PDF ucu (oturum, şube kuralı) |
| `src/app/panel/vardiya/page.tsx`, `shift-grid.tsx` | Ekran: hafta ve şube, yöneticinin ızgarası (telefonda gün gün), personelin salt okunur görünümü |
| `tests/vardiya.test.ts` | Kutunun okunuşu (gece yarısı, izin, hatalar), biçim, hafta, toplamlar, kayıt farkı, rol ve menü, PDF (yazı tipinde Türkçe harfler, `%PDF`, A4 yatay, sayfalama) |

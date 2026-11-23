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
- **Boş bırakılan listede yazmaz** (sahibin isteği, 23 Kasım 2026: "boş bıraktıklarım da hiç listede yazmasın";
  `listedRows`): ızgarada yalnız haftasına bir şey yazılmış kişiler durur; haftası boş personel listenin altındaki
  **Bu hafta yazılmayanlar** düğmelerindedir, dokununca listeye girer ve ilk kutusuna gidilir. Telefonda liste günlüktür:
  yalnız o günü yazılmış kişiler, altında "**Perşembe yazılmayanlar**" düğmeleri. Dokunulan kişi kaydedilene kadar
  listede kalır (kutusunu boşaltsa da); kayıttan sonra boş kalan düşer. Boş kutunun altında "–" yok, gün gün çalışan
  satırında boş gün yazısız. "Kişi ekle"ye listede olmayan birinin adı yazılınca o kişi listeye girer. Yazarak
  doldurma ve "Geçen haftayı kopyala" listede olmayan personeli de görür (doldurulan kişi listeye girer).
- **Telefonda (yönetici):** yedi sütun sığmadığı için ızgara gün gün yazılır: üstte haftanın yedi günü tek satırda
  seçilir (kısa gün adı ve ayın günü; bugünün rakamı mavi; kaydırma yok), altında o günün kutuları kişi kişi. Kişinin
  adı kendi satırındadır (dar telefonda kesilmez), altında S / A / İ düğmeleri ve yanında saat, ya da "Elle yaz"da tam
  genişlikte kutu. Yatay kaydırma yok (360 ve 390 px'te ölçüldü).
- **Personel:** üstte **Benim haftam** (yalnız yazılmış günler: saatler ve haftalık toplam), altında bütün ekibin planı
  (salt okunur, kendi satırında "Siz"; haftası boş kişi yok, boş kutu yazısız). Telefonda ekibin planı da gün gün
  listedir (aynı gün seçici; yalnız o günü yazılmış kişiler, kimse yoksa "Bu gün için vardiya yazılmadı"). Plan
  yazılmadıysa "Bu hafta için vardiya yazılmadı". PDF de yalnız haftasına bir şey yazılmış kişileri taşır.
- Ekranda tutar, maaş ya da maliyet yoktur.

## Hazır vardiyalar: sabahçı ve akşamcı (22 Kasım 2026)

Operatör: "vardiya kısmına sabahçı akşamcı ekle, tıklamayla olsun", ardından "saat yazmaktansa seçimli yap, S ve A
ekle". Hazır vardiyası olan şubede ızgara **Seçerek** açılır: her kutuda üç düğme durur, **S** (sabahçı), **A** (akşamcı),
**İ** (izin). Tıklanan yazılır, seçili harfe ikinci tıklama kutuyu boşaltır; düğmelerin altında saatler görünür. Başka
saat ya da görev notu için üstteki **Elle yaz** seçilir: kutular klavyeyle yazılır ve "s" / "a" kısaltması şubenin
saatlerine açılır ("s kasa" → "09:00–18:00 · kasa"). Elle yazılmış başka saat Seçerek'te düğmelerin altında durur; bir
harf seçilince onun yerine geçer. Telefonda da aynı (düğmeler parmak boyunda).

| Şube | Sabahçı | Akşamcı | Dayanak |
|---|---|---|---|
| Tuzla | 09:00–18:00 | 16:00–01:00 | 09:00 açılış, vardiya 9 saat, akşamcı 16:00'da gelir |
| Marina | 09:30–18:30 | 13:00–22:00 | 09:30 açılış, vardiya 9 saat, akşamcı 13:00'te gelir, kapanış 22:00 |

- Hazır vardiyası tanımlı olmayan şubede ızgara elle yazmayla açılır (seçim satırı çıkmaz).
- Ad saatlerden türer (veritabanında ayrı alan yok): saatleri şubenin hazır vardiyasıyla aynı olan hücre, elle yazılsa
  da, ızgarada kutunun altında, personelin görünümünde ve PDF'te "Sabahçı" / "Akşamcı" diye görünür. Görev notu eklenebilir
  ("9-18 kasa" yine sabahçıdır).
- Saatler `src/lib/vardiya.ts` › `SHIFT_PRESETS`'te; değişirse orası güncellenir, eski haftalar yazıldıkları saatlerle
  kalır (yeni saatle eşleşmeyen eski hücre "başka saat" olarak görünür).

## Yazarak doldurma (22 Kasım 2026)

Sahibin isteği: "vardiya kısmına prompt yazarak ekleme yap ... sabahçı akşamcıyı kolayca yapmak için ve mobilde tamamen
uyumlu yap". Kartın başındaki **Yazarak doldur** kutusuna hafta düz cümleyle yazılır:

> Ayşe hafta içi sabahçı, Mehmet akşamcı. Zeynep Salı izinli. Hafta sonu herkes akşamcı. Can Cuma 12-20 kasa.

**Plana işle** (ya da Ctrl / ⌘ + Enter) metni Claude'a gönderir; dönen atamalar ızgaraya **taslak** olarak yazılır.

- **Hiçbir şey kendiliğinden kaydedilmez.** Değişen kutular mavi görünür, altta kaydetme çubuğu çıkar; plan ancak
  **Kaydet**'e basınca yazılır (aynı okuyucu, aynı eylem). **Taslağı geri al** taslaktan önceki hâle döner. İstek
  sürerken ızgara kilitlidir (taslak, gönderildiği andaki satırların üstüne yazılır).
- **Ne yazılır:** sabahçı / akşamcı (şubenin hazır saatleri), izin, başka saat ("12-20", "18-02"), görev notu, boşaltma
  ("Ayşe'nin Salı'sını sil"); "herkes", "hafta içi", "hafta sonu", gün adı ya da tarih. Sonraki cümle öncekinin üstüne
  yazar ("Ayşe sabahçı ama Salı izinli"). Listede olmayan ad yeni kişi olarak eklenir (adı bir hesabınkiyse o hesabın
  satırı; "Kişi ekle" ile aynı kural). Söylenmeyen kutuya dokunulmaz.
- **İşlenemeyenler** kutunun altındaki uyarıda yazar: iki kişiye uyan ad (tahmin edilmez), hafta dışı gün, okunamayan
  saat, 16 saati aşan vardiya, hazır vardiyası olmayan şubede "sabahçı". Her atama ekranın ve kaydın okuyucusundan
  (`parseShiftCell`) geçer; geçmeyen yazılmaz.
- **Model ve istek:** Claude Opus 5.5 (`claude-opus-5-5`), efor "low", yapılandırılmış çıktı (JSON şeması), yalnız
  metin; fotoğraf okumanın isteğiyle aynı çalıştırıcı (`src/server/ai/run.ts`). Yanıt zod ile doğrulanır.
- **Servise gidenler:** şubenin adı, haftanın tarihleri, ızgaradaki kişilerin **adı**, o anki plan ve yazılan metin.
  E-posta, telefon, rol ve hesap kimliği gitmez (kişiler "p1", "p2" anahtarlarıyla gider). Yazılan metin, adlar ve
  yanıt hiçbir yere kaydedilmez; `ai_calls`'a yalnız maliyet satırı düşer (tür `vardiya`).
- **Kapılar:** anahtar (`ANTHROPIC_API_KEY`; fotoğraftan okumayla aynı) ve Ayarlar › Fotoğraftan okuma anahtarı
  (kapalıyken hiçbir istek gitmez). Günlük sınır **ayrıdır**: günde 40 taslak (`SHIFT_DRAFT_DAILY_CAP`); okumanın günlük
  sınırı vardiya taslaklarını saymaz (yöneticinin denemeleri kasadaki okumayı kesmesin). Kullanılamıyorken kutunun
  yerinde nedeni yazar ("kurulu değil", "kapalı", "bugünkü sınır doldu"); kutular her zaman elle doldurulur.
- **Yalnız yönetici** (eylem `requireAdmin`); personelin ekranında kutu yoktur.
- **Geliştirmede** (`AI_REPLAY=1`) canlı istek yapılmaz: sentetik bir yanıt döner (ilk kişi hafta içi sabahçı, ikinci
  akşamcı, herkes Pazar izinli) ve uyarı metnin okunmadığını söyler.

## PDF

`GET /api/vardiya/pdf?hafta=YYYY-AA-GG&sube=tuzla` (ekrandaki **PDF** düğmesi; yeni sekmede açılır, dosya adı
`vardiya-tuzla-2026-11-23.pdf`).

- **Kendiliğinden güncel:** dosya saklanmaz; her istekte **kaydedilen** plandan yeniden çizilir. Plan değişip
  kaydedilince aynı adres yeni planı verir. Kaydedilmemiş değişiklik varken düğme "Önce kaydedin" der.
- **Görünüm** (22 Kasım 2026: "pdf tasarımını daha estetik yap, logomuzu kullan", ardından "daha tasarımsal ve
  minimalist"): A4 yatay, beyaz sayfa, ince çizgiler; dolu kutu ve bant yok. Renk yalnız iki yerde: logo ve vardiyanın
  harfi. Üstte solda L'Af logosu (vektör; harfler markanın yeşili, çekirdek altın: `src/server/vardiya/logo.ts`),
  yanında "VARDİYA PLANI" ve haftanın tarihleri, sağda şube; altında tek ince yeşil çizgi. Tabloda günün adı küçük ve
  aralıklı, altında günün sayısı. Hücrede **S** altın, **A** yeşil daire ve yanında saatler (altında görev notu); başka
  saat boş daireyle, izin "İ" ile, planlanmayan gün boş. Sağda kişinin haftalık toplamı, altta gün gün çalışan sayısı;
  alt bilgide harflerin açıklaması (şubenin saatleriyle), oluşturulma anı ve son değişikliği yapan. 9 kişiye kadar
  ferah, 13 kişiye kadar tek sayfa, sonrası yeni sayfa (başlık her sayfada). Planı boş kişiler PDF'e girmez.
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
| Kontrol listesi hatırlatmaları | Açılış, kapanış ve temizlik (tuvalet çizelgesi) listelerinin e-posta hatırlatmaları listenin şubesinde **o an vardiyada olan** kişilere gider; o an kimse yoksa o gün çalışacaklara, plan yoksa bütün personele ([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md) § 6 › Kime; `alertRecipients`) |
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
| `src/lib/vardiya-taslak.ts` | Yazarak doldurmanın saf yarısı: istem, yanıtın şeması, atamaların kutu metnine çevrilmesi, taslağın ızgaraya uygulanması |
| `src/server/vardiya/draft.ts` | Yazarak doldurmanın çağrısı (`draftShiftWeek`; hiçbir tabloya yazmaz) ve ekranın durum okuması (`shiftDraftState`) |
| `src/server/actions/vardiya.ts` | `saveShiftWeekAction` (yalnız yönetici; işlem geçmişi), `draftShiftWeekAction` (yalnız yönetici; kayıt yok) |
| `src/app/api/vardiya/pdf/route.ts` | PDF ucu (oturum, şube kuralı) |
| `src/app/panel/vardiya/page.tsx`, `shift-grid.tsx` | Ekran: hafta ve şube, yöneticinin ızgarası (telefonda gün gün), personelin salt okunur görünümü |
| `tests/vardiya-taslak.test.ts` | Yazarak doldurma: atamaların çevrilmesi (hazır vardiya, izin, saat, herkes, yeni kişi, sıra, işlenemeyenler), taslağın uygulanması, isteğin biçimi ve şeması, sahte istemciyle okuma, hata metinleri, bağlantılar |
| `tests/vardiya.test.ts` | Kutunun okunuşu (gece yarısı, izin, hatalar), biçim, hafta, toplamlar, kayıt farkı, rol ve menü, PDF (yazı tipinde Türkçe harfler, `%PDF`, A4 yatay, sayfalama) |

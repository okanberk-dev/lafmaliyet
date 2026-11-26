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
- **Şube:** plan şube şubedir. Panelin şube seçicisindeki fiziksel şube gösterilir; birden çok şube açıkken sayfanın
  başında şube düğmeleri durur (seçim panelin seçicisine yazılır, [SUBE.md](SUBE.md) › Seçici). Şubesine kilitli
  personel yalnız kendi şubesinin planını görür.
- **"Tümü"de şube sorulur (26 Kasım 2026):** "Tümü" ya da laffogato.net seçiliyken birden çok şube açıksa ızgara
  çizilmez, önce **Hangi şubenin vardiyası?** sorulur (şube düğmeleri; adresteki hafta korunur). Seçilen şube panelin
  seçicisine yazılır ve plan o şubeyle açılır. Kasa raporu ve stok sayımıyla aynı kural ([SUBE.md](SUBE.md) › Yazarken
  hangi şube); asistanın vardiya kartı da "Tümü"de şubeyi sorar. Önceden "Tümü"de sessizce Tuzla'nın planı açılıyor,
  Kaydet Tuzla'ya yazıyordu (kenar çubuğunda "Tümü" yazarken). Tek şube açıksa o şube (soru yok). Personel de (şubesiz
  hesap) aynı soruyu görür: okuduğu planın şubesi belli olsun. **Kaydet** ve **Yazarak doldur** ızgaranın şubesini
  gönderir, çerezi değil: başka sekmede seçici değişse de plan ekranda görünen şubeye yazılır.
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
- **Kaydet** bütün haftayı tek eylemle yazar: yalnız bu ekranda değiştirilen kutu yazılır, boşaltılan silinir,
  dokunulmayana dokunulmaz (ekran açıldıktan sonra başkasının yazdığı yerinde kalır; aşağıda "Veri").
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

Saatler şube başınadır (aşağıda "Şube ayarı"). Ayarı seçilmemiş şubenin saatleri (varsayılan; 26 Kasım 2026'ya kadar
koddaki sabit saatlerdi, ayarı olmayan şubede davranış değişmedi):

| Şube | Sabahçı | Akşamcı | Dayanak |
|---|---|---|---|
| Tuzla | 09:00–18:00 | 16:00–01:00 | 09:00 açılış, vardiya 9 saat, akşamcı 16:00'da gelir |
| Marina | 09:30–18:30 | 13:00–22:00 | 09:30 açılış, vardiya 9 saat, akşamcı 13:00'te gelir, kapanış 22:00 |
| Öbür şubeler | yok | yok | Ayardan girilene kadar ızgara elle yazmayla açılır |

- Hazır vardiyası olmayan şubede ızgara elle yazmayla açılır (seçim satırı çıkmaz). Yalnız biri tanımlıysa (ör. yalnız
  sabahçı) düğmeler S ve İ'dir.
- Ad saatlerden türer (veritabanında ayrı alan yok): saatleri şubenin hazır vardiyasıyla aynı olan hücre, elle yazılsa
  da, ızgarada kutunun altında, personelin görünümünde ve PDF'te "Sabahçı" / "Akşamcı" diye görünür. Görev notu eklenebilir
  ("9-18 kasa" yine sabahçıdır).
- Saatler değişince kayıtlı haftalar değişmez: hücreler yazıldıkları saatlerle kalır, yeni saatle eşleşmeyen eski hücre
  "başka saat" olarak görünür (PDF'te harfsiz daire).

### Şube ayarı (26 Kasım 2026)

Sabahçı ve akşamcının saatleri **Ayarlar › Şubeler › şubenin Ayarlar'ı › Hazır vardiyalar** kartında girilir
(`/panel/subeler/[id]#vardiya`, yalnız yönetici). Vardiya ekranındaki seçim satırının sonunda da yöneticiye **Saatleri
değiştir** (hazır vardiyası yoksa **Sabahçı ve akşamcı ekle**) bağlantısı durur.

- **Kart:** Sabahçı (S) ve Akşamcı (A) için birer anahtar (kullanılıyor mu) ve başlangıç / bitiş saati. Ayar seçilmemişse
  kart varsayılan saatleri söyler ("Varsayılan saatler: … Değiştirip kaydedince bu şubenin ayarı olur"); hazır vardiyası
  olmayan şubede "Bu şubede hazır vardiya yok". **Kaydet** yalnız değişiklik varken açılır.
- **Kurallar:** saatler kutunun okuyucusuyla okunur (`presetHours` → `parseShiftCell`): bitiş başlangıçtan önceyse ertesi
  gün (akşamcı 16:00–01:00; 00:00 gece yarısı), en geç ertesi gün 06:00, en çok 16 saat; sabahçı ve akşamcı aynı
  saatlerde olamaz (ad saatlerden türer). Hata kutunun altında yazar, sunucu aynı kuralla ayrıca reddeder
  ("Akşamcı: Bitiş başlangıçla aynı olamaz.").
- **İkisi kapatılınca** şubede hazır vardiya yoktur (varsayılana dönmez): ızgara elle yazmayla açılır, "s" / "a"
  kısaltması açılmaz, yazarak doldurmada "sabahçı" işlenemeyenlere düşer.
- **"Diğer şubeyle aynı" yok:** saatler şubenin açılışına bağlıdır (Tuzla ile Marina'nınki bugün de ayrı; örtük "aynı"
  Marina'nın saatlerini Tuzla'nınkine çevirirdi). Her şube kendi saatini tutar.
- **Kim kullanır:** ızgaranın S / A düğmeleri ve altındaki ad, elle yazarken "s" / "a" kısaltması, yazarak doldurmanın
  isteği ("Preset shifts"; ad ve saatler servise gider) ve işlenmesi, PDF'in harfleri ve alt bilgisi, asistanın vardiya
  kartı ("s kasa"). Hepsi listeyi aynı okuyucudan alır (`loadShiftPresets`, `src/server/vardiya/presets.ts`).
- **Uyarı sesleri:** ses saatleri şimdilik bütün şubelerde ortaktır (09:00–01:00, [SUBE.md](SUBE.md) › Şube başına
  ayarlar). Vardiya 01:00–09:00 arasına uzanıyorsa kart "Uyarı sesleri 01:00–09:00 arası çalmaz" notunu gösterir
  (`alertQuietDuring`); kayıt engellenmez.
- **Veri:** `branch_settings` satırı (grup `vardiya.hazir`; şema değişmedi, migration yok): `{ presets: [{ key:
  "morning", startMin, endMin }, …] }`; satır yoksa varsayılan (`SHIFT_PRESETS`). Okuma satır yazmaz. Kayıt tek
  işlemde, grup kilidiyle; işlem geçmişine "Şube ayarı · Marina · Hazır vardiyalar: Sabahçı 09:30–18:30 · Akşamcı
  13:00–22:00 → Sabahçı 08:30–17:30". Yedeğe şube ayarlarıyla girer.

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
| Şube seçici | Plan seçili fiziksel şubenin; "Tümü"de (birden çok şube açıkken) önce şube sorulur; şubesine kilitli personel kendi şubesini görür ([SUBE.md](SUBE.md)) |
| Şube ayarları | Hazır vardiyaların (sabahçı / akşamcı) saatleri şube başına: Şubeler › şubenin Ayarlar'ı › Hazır vardiyalar (yukarıda) |
| Yardım | Yöneticide "Vardiya planını yazmak ve PDF'ini almak", personelde "Bu hafta hangi gün, kaçta vardiyam var?" |
| İşlem geçmişi | "Vardiya planı kaydedildi · Tuzla · 23–29 Kasım 2026 · 5 kişi · 28 vardiya · 3 izin" |
| Yedek | `shifts` tablosu yedeğe girer (gizli alan yok) |
| Maaşlar (part-time, Faz 5) | Part-time kişinin çağrıldığı gün bu plandan sayılır: aşağıda "Maaş satırının bağlantısı ve part-time" |

## Maaş satırının bağlantısı ve part-time (Faz 5, 23 Kasım 2026)

Sahibin kararları 2 ve 12: maaş satırı Vardiya'daki kişisine **açıkça** bağlanır, Aralık 2026'dan itibaren part-time
kişi günlük modelle sayılır. Kurallar `src/lib/staff-link.ts` ve `src/lib/calc/engine.ts` (staffShiftRef, calledDaysOf,
staffCost); testleri `tests/personel-part-time.test.ts`, `tests/personel-baglanti-db.test.ts`.

- **Bağlantı** (Maaşlar › kişi › "Vardiya / hesap bağlantısı"; yalnız yönetici): panel hesabı (`staff.user_id`; Vardiya
  anahtarı `u:<id>`) ya da hesabı olmayan, Vardiya'ya adıyla yazılmış kişi (`staff.person_ref` = `n:<küçük harfli ad>`).
  İkisi birden olmaz (CHECK `staff_link_ck`). Seçici iki yanı birlikte gösterir ("Maaş satırı: Ayşe (Marina) ↔ Vardiya:
  Ayşe Kaya · ayse@… "), hiçbir zaman önseçmez; ad benzerliğiyle kendiliğinden bağlanmaz. Sunucu doğrular: hesap var mı,
  hesap bir şubeye kilitliyse satırın şubesi mi, aynı hesap ya da aynı ad **aynı şubede ve aynı ayda** başka bir maaş
  satırına bağlı mı (bir şubede aralıkları çakışan iki satır aynı kişiyi gösteremez; "Devam ettir"in açtığı yeni kayıttan
  önceki satır kendi aylarıyla bağlı kalabilir, yeni kayıt kendiliğinden bağlanmaz). Şubeye kilitli olmayan hesap iki
  şubenin satırına bağlanabilir: part-time iki şubede çalışıyorsa her şubede kendi satırı olur ve o şubedeki günleri
  sayar (inceleme bulgusu LM-4 2. tur, 1). Bitiş ayını kaldırmak çakışma yaratıyorsa reddedilir.
  `staff.user_id`'de veritabanı tekilliği yok (kural aralığa bağlı); denetim ve yazım bir işlem kilidi altında yapılır
  (`pg_advisory_xact_lock`, `saveStaff` ve `endStaff`; `lockStaffLinks`): iki yönetici aynı anda kaydederse ikincisi
  öncekini bekler ve onun bağladığını görür (inceleme bulgusu 6).
- **Bağlı hesap silinmez** (denetim bulgusu 47, 25 Kasım 2026): `staff.user_id` hesap silinince boşalır (ON DELETE SET
  NULL); part-time'ın günü Vardiya'dan sayılamaz, ücreti bütün aylarda 0'a düşer, tam zamanlının LafPOS yemek kartı günü
  de bağlantıyı kaybederdi. Kullanıcılar › Sil, Maaşlar'da bir satıra (biten satır da) bağlı hesabı reddeder: "Bu hesap
  Maaşlar'da “Ayşe” satırına bağlı; … Silmek yerine hesabı pasif yapın." Pasif hesapla giriş yapılamaz, bağlantı ve
  geçmiş aylar kalır. Denetim ve silme aynı kilit altında, tek işlemde (`deleteUser`; o an bağlanan hesap da silinmez).
  Bu kuraldan önce silinmiş hesapların satırları dokunulmadan kalır: geriye dönük onarım yok (silinen hesabın vardiyaları
  `u:<id>` anahtarıyla durur, bağlanacak hesap kalmadı); bağlantısız part-time'ı Maaşlar uyarır.
- **LM-4b notu (personel listesi):** biten satır ile "Devam ettir"in açtığı yeni satır aynı hesaba bağlı olabilir (aralıkları
  ayrık). `GET /api/panel/pos/personel?sube=…` "bu ay ve geçen ay aralıktaki satırlar"ı okurken o şubede bir hesaba iki satır
  düşebilir; liste **şubede hesap başına tek öğe** vermelidir (o ayın satırı, yoksa en yeni satır). Aksi hâlde LafPOS'un seçicisi aynı
  hesabı iki kez gösterir.
- **Part-time** (Maaşlar › Çalışma: Part-time; tür yalnız yeni kişide seçilir, maaş hesabına girmiş satırın türü
  değişmez): günlük ücret (işletmenin çağrılan gün başına maliyeti; **SGK brütleştirmesi yok**), yemek kartı (Ayarlar'daki
  günlük tutar × çağrıldığı gün) ve ek ödeme (brütleştirilmez). Günlük ücret ve yemek kartı maaşla birlikte "şu aydan
  itibaren" sürümlenir. Yemek kartı bir aydan itibaren açılıp kapanınca önceden girilmiş sonraki sürümlere (ör. planlı
  zam) de işlenir; sahibin ayrıca değiştirdiği ilk sürümde durur (`mealCardCarry`, inceleme bulgusu 8). Kayıt mesajı
  hangi aylara işlendiğini yazar. O değişiklik Maaşlar'da "Geri al" ile silinince taşıma da aynı kuralla geri alınır
  (`deleteStaffVersion`; mesaj hangi aylardan geri alındığını yazar; inceleme bulgusu LM-4 2. tur, 3); sürüm etiketi "… net + yemek kartı" olur. **Çağrıldığı gün** = kişinin Vardiya anahtarıyla, kendi şubesinde, o aydaki çalışma (`work`)
  vardiyaları; izin sayılmaz, başka şubedeki vardiya o şubenin satırına aittir. Kişiye o şubede bağlı satır yoksa o
  günler hiçbir yere girmez: Genel bakış ve Maaşlar "Part-time'ın başka şubedeki günleri sayılmıyor" diye uyarır ("Tümü"de;
  `strayPartTimeShifts`). Gelir-gider'de süren ayda bugüne kadarki vardiyalar (ileri günlerin planı değil), maaş satırının
  gün oranıyla aynı kaynaktan: kasa raporlarının son günü; rapor yoksa elle girilen açık gün kadar (ayın başından); ay
  bilgisi yoksa 0 (`calledDaysCutoff`). "Tümü"de kişinin şubesinin raporları. Vergi bordrosu ve nakit planı ayın bütün planı.
  Gelir-gider'de "PART-TIME (GÜNLÜK ÜCRET)" satırı (ücret + ek; gün oranı yok), yemek kartı "PERSONEL YEMEK KARTI"
  satırında. **Bağlantısız part-time** tahmin edilmez: ücreti 0, hücre, Maaşlar ve Genel bakış uyarır.
- **Haftalık "Part-time çalışan" sabit gideri** Kasım 2026 için kalır (sahibin veri işi: son ayı 2026-11). Aynı ayda
  hem bu kalem (işletme geneli ya da kişinin şubesinin) hem de çağrıldığı günü olan günlük part-time satırı sayılıyorsa
  Genel bakış ve Maaşlar uyarır ("Part-time iki kez sayılabilir"); tutarlar kendiliğinden değişmez.
- **Yemek kartı ve LafPOS (LM-4b):** tam zamanlı kişide yemek kartının günü Ayarlar'daki gündür (26); ayın tamamı LafPOS
  dönemiyse, ay bittiyse, ayın her sayılan LafPOS günü çalışan kimliklerini taşıyorsa ve kişi en az bir günde geçiyorsa
  LafPOS'ta çalıştığı gündür (`staffCost`'un `lafposDays` seçeneği; kural ve ayrıntı docs/LAFPOS.md › Personel bağlantısı).
  Hiç geçmeyen kişi 0 gün sayılmaz: 26 kalır, Maaşlar ve Genel bakış uyarır. Maaşlar kişinin altında "LafPOS'ta çalıştığı
  gün" yazar. LafPOS'un `GET /api/panel/pos/personel` listesi yukarıdaki notla hesap başına tek öğe verir.

## Bildirimler (Dalga 2, 25 Kasım 2026)

Sahibin isteği: "Vardiyası değişen personele bildirim gitsin. Gelecek haftanın planı yazılmadıysa hatırlatılsın."

### Vardiyası değişen kişiye

Plan kaydedilince yalnız vardiyası değişen kişilere tek bir bildirim gider:
"Vardiyanız değişti" / "1 Aralık Salı: 10:00–18:00 → 12:00–20:00". Birden çok gün değiştiyse en çok üçü yazılır, kalanı
"ve 2 gün daha". Birden çok şube açıkken başlıkta şube de yazar ("Vardiyanız değişti · Marina"). Dokununca o haftanın
planı o şubede açılır (`/panel/vardiya?hafta=…&sube=…`).

- **Ne değişiklik sayılır:** kaydedilmiş bir kutunun saati, notu ya da izni değişince; kutu silinince ("… kaldırıldı");
  kişinin o haftada zaten kayıtlı vardiyası varken yeni bir gün eklenince ("… (yeni)").
- **Ne sayılmaz:** haftanın ilk yazımı (kişinin o haftada hiç kaydı yokken yazılan günler; plan parça parça
  yazılırken herkese ileti gitmesin), yalnız adın değişmesi, bugünden önceki günler, hesabı olmayan çalışan (adıyla
  yazılan kişiye gidecek adres yok), kaydı yapan yöneticinin kendi satırı.
- **Nasıl:** önce kişinin bildirimi açık cihazlarına push (Bu cihazda uyarılar; cihaz başına ayrı bir anahtar yok).
  Hiçbir cihaza gidemezse (bildirim açık cihazı yoksa) hesabın e-posta adresine "Vardiyanız değişti" e-postası: gün gün
  eski → yeni ve **Vardiyayı aç** düğmesi. E-posta, Ödemeler › E-posta bildirimleri'ndeki **Hatırlatma e-postaları**
  açıksa ve Resend kuruluysa gider (öteki personel e-postaları gibi). Tutar yok.
- Bildirim kayıttan ve yanıttan sonra gider: Kaydet beklemez, bildirim servisi düşse de plan yazılmıştır. Aynı hafta
  ve şubenin bildirimi telefonda öncekinin yerine geçer (etiket `vardiya-<şube>-<Pazartesi>`). Asistanın vardiya kartı
  da aynı eylemden geçtiği için onun değişikliği de bildirilir.
- Kayıt mantığı değişmedi (`saveShiftWeek` yalnız kayıttan önceki hâlle farkı da döndürür: `changes`).

### Gelecek haftanın planı yazılmadıysa

Perşembe 18:00'den Pazar sonuna kadar gelecek haftanın planında bir şubenin hiç kutusu yoksa:

- **Zil (yönetici, Uyarılar):** "Gelecek haftanın vardiyası yazılmadı" (birden çok şube açıkken "Marina: gelecek
  haftanın vardiyası yazılmadı"), gövdesi haftayı söyler, o haftanın o şubesine götürür. Tek şube seçiliyken yalnız o
  şubeninki; "Tümü"de hepsi. Plan yazılınca kalkar. Okunamazsa Uyarılar'da "Vardiya planı" yüklenemedi satırı.
- **Günlük iş (Cuma, Cumartesi, Pazar sabahı):** aynı metin etkin yöneticilerin bildirimi açık cihazlarına push, şube,
  hafta ve gün başına bir kez (`notification_log` anahtarı `vardiya-plan:<şube>:<Pazartesi>:<gün>`). Ayarlar › Günlük
  işler'de adım yalnız bildirim denenince yazılır: "… yöneticilere bildirim gitti", bildirim açık yönetici cihazı
  yoksa bilgi olarak "(bildirim açık yönetici cihazı yok)", hiçbir cihaza gidemediyse "Vardiya hatırlatması hata".

### Kod

| Dosya | Görev |
|---|---|
| `src/lib/vardiya-bildirim.ts` | Saf kurallar: değişikliklerin seçimi (`shiftChanges`), satırlar ve bildirim metni, hatırlatma zamanı (`planReminderWeek`), eksik plan |
| `src/server/vardiya/notify.ts` | Gönderim: `notifyShiftChanges` (eylem, yanıttan sonra), `sendShiftChangeNotices` (push, yoksa e-posta), `missingNextWeekPlans`, `pushPlanReminders` (günlük iş) |
| `src/server/notify/vardiya-template.ts` | "Vardiyanız değişti" e-postası |
| `src/server/bell/vardiya.ts` | Yöneticinin zil satırı |
| `tests/vardiya-bildirim.test.ts` | Değişiklik kuralları, metinler, e-posta, hatırlatma zamanı, günlük işin adımı, kaynak bağlantıları |
| `tests/bildirim-gonderim-db.test.ts` | Gerçek Postgres'te (`BILDIRIM_TEST_DATABASE_URL`, `npm run test:db`): kaydın değişiklikleri kayıttan önceki hâlle, gönderim (cihaz ve e-posta yoksa atlanır, pasif hesaba gitmez), eksik plan ve zil (seçili şubeye göre), günlük işin şube ve gün başına tek hatırlatması |

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
kilidi); bir sekmenin bilmediği kişinin satırına dokunulmaz.

**Eski ekrandan kaydetme (denetim bulgusu 46, 25 Kasım 2026):** Kaydet her kutunun ekran açıldığındaki (son
yenilemedeki) metnini de gönderir (`seen`). Sunucu yalnız bundan farklı kutuları yazar ya da siler (`weekSaveDiff`);
dokunulmayan kutu veritabanında ne varsa öyle kalır. Önceden bütün hafta gönderiliyordu: A haftayı açıp beklerken B
Ayşe'nin Salı'sını değiştirirse, A başka bir kutuyu kaydedince Salı eski hâline dönüyor, B'nin eklediği kutular
siliniyordu. Değiştirilen kutuyu arada başkası da değiştirdiyse (veritabanındaki ne görülen ne yazılan) kayıt
bütünüyle reddedilir: "Plan siz bakarken değişti (Ayşe, Salı), sayfayı yenileyin." Hiçbir kutu yazılmaz; ikisi aynı
şeyi yazdıysa çakışma sayılmaz. `seen` göndermeyen eski sekmenin kaydı da aynı metinle reddedilir. Asistanın vardiya
kartı da önizlemede gördüğü haftayı `seen` olarak gönderir (docs/ASISTAN-ISLEMLER.md). Kayıttan sonraki özet ("5 kişi ·
28 vardiya") veritabanındaki plandan sayılır.

## Dosyalar

| Dosya | Görev |
|---|---|
| `src/lib/vardiya.ts` | Saf kurallar: kutunun okunuşu ve yazılışı, hazır vardiyalar (varsayılan saatler `SHIFT_PRESETS`, ayarın çözümü `shiftPresetsOf`, girilen saatin okunuşu `presetHours`), hafta hesabı, kişi anahtarı, toplamlar, kaydın farkı, giriş şeması, Bugün satırının metni |
| `src/lib/branch-settings/groups.ts` › `SHIFT_PRESET_GROUP`, `src/server/vardiya/presets.ts` | Hazır vardiyaların şube ayarı (`vardiya.hazir`) ve okuyucusu (`loadShiftPresets`) |
| `src/app/panel/subeler/[id]/shift-presets-card.tsx`, `src/server/actions/branch-settings.ts` › `saveShiftPresets` | Şube ayarları › Hazır vardiyalar kartı ve kaydı (yalnız yönetici) |
| `src/server/vardiya/store.ts` | Haftanın okunması (personel + planı olanlar), kaydı (tek işlem, yalnız değişen), günün çalışanları (`shiftsOn`, `todayShifts`) |
| `src/server/vardiya/pdf.ts`, `src/server/vardiya/fonts/` | PDF'in çizimi (pdf-lib); gömülen yazı tipi, lisansı ve nasıl üretildiği |
| `src/lib/vardiya-taslak.ts` | Yazarak doldurmanın saf yarısı: istem, yanıtın şeması, atamaların kutu metnine çevrilmesi, taslağın ızgaraya uygulanması |
| `src/server/vardiya/draft.ts` | Yazarak doldurmanın çağrısı (`draftShiftWeek`; hiçbir tabloya yazmaz) ve ekranın durum okuması (`shiftDraftState`) |
| `src/server/actions/vardiya.ts` | `saveShiftWeekAction` (yalnız yönetici; işlem geçmişi), `draftShiftWeekAction` (yalnız yönetici; kayıt yok) |
| `src/app/api/vardiya/pdf/route.ts` | PDF ucu (oturum, şube kuralı) |
| `src/app/panel/vardiya/page.tsx`, `shift-grid.tsx` | Ekran: hafta ve şube, yöneticinin ızgarası (telefonda gün gün), personelin salt okunur görünümü |
| `tests/vardiya-taslak.test.ts` | Yazarak doldurma: atamaların çevrilmesi (hazır vardiya, izin, saat, herkes, yeni kişi, sıra, işlenemeyenler), taslağın uygulanması, isteğin biçimi ve şeması, sahte istemciyle okuma, hata metinleri, bağlantılar |
| `tests/vardiya.test.ts` | Kutunun okunuşu (gece yarısı, izin, hatalar), biçim, hafta, toplamlar, kayıt farkı, rol ve menü, PDF (yazı tipinde Türkçe harfler, `%PDF`, A4 yatay, sayfalama) |
| `tests/vardiya-kayit.test.ts`, `tests/vardiya-kayit-db.test.ts` | Eski ekrandan kaydetme: yalnız değiştirilen kutu yazılır, arada başkasının değiştirdiği kutuda red (saf fark ve gerçek Postgres) |
| `tests/vardiya-sube.test.ts`, `tests/vardiya-sube-db.test.ts` | Hazır vardiyaların şube ayarı (okunuş, varsayılan, girilen saatler, kayıt, işlem geçmişi, ret kuralları; gerçek Postgres) ve "Tümü"de şube sorusu |

# Roller: Yönetici, Müdür, Personel, Muhasebeci

Panelde dört rol var (`users.role`; `src/lib/constants.ts` › `ROLES`). Kim hangi ekranı açar ve ne yapar **tek
kaynaktan** okunur: `src/lib/roles.ts`. Dalga 3 maddesi (YAPILACAKLAR.md): "Müdür" ve salt okunur "Muhasebeci" rolleri;
büyük plan [planlar/personel-yetki.md](planlar/personel-yetki.md).

| Rol | Kısaca |
| --- | --- |
| **Yönetici** (`admin`) | Her şey. |
| **Müdür** (`manager`) | Şubesinin günlük işletmesi; şubesine kilitli (şube zorunlu). |
| **Personel** (`staff`) | Günün işleri (değişmedi; [planlar/personel-yetki.md](planlar/personel-yetki.md)). |
| **Muhasebeci** (`accountant`) | Salt okunur: faturalar, gelir-gider, vergi, harcamalar, kasa raporları, muhasebeci paketi. |

## Tek kaynak: `src/lib/roles.ts`

- **Ekranlar** (`canOpen(rol, yol)`): `STAFF_PATHS`, `MANAGER_EXTRA_PATHS`, `ACCOUNTANT_PATHS` ve her rolün altında kapalı
  olanlar (`ADMIN_ONLY_PATHS`, `MANAGER_CLOSED_PATHS`, `ACCOUNTANT_CLOSED_PATHS`). `src/proxy.ts` izinsiz adresi rolün
  ana ekranına (`homeFor`: yönetici `/panel`, müdür ve personel `/panel/bugun`, muhasebeci `/panel/muhasebe`)
  döndürür; menü, alt menü, sekme ve arama aynı kurala bakar (`src/components/panel/nav.ts`).
- **Yetenekler** (`CAPABILITIES`, `can(rol, yetenek)`): eylem düzeyi. Tabloda olmayan rol için her yetenek KAPALI.

| Yetenek | Ne | Roller |
| --- | --- | --- |
| `kayit.yaz` | Her yazan eylemin tabanı (kasa raporu, zayi, sayım, kontrol listesi, sipariş …) | yönetici, müdür, personel |
| `isletme.yonet` | Kasa raporunu onaysız düzeltmek ve silmek, kilitli / eski güne yazmak, kasadan çıkanı ve zayiyi doğrudan, kafe kapalı günü işaretlemek | yönetici, müdür |
| `kasa.rakam` | Kasa raporlarının rakamları ve geçmişi (fark, devir, beklenen nakit, yazarkasa; kör kasa yok) | yönetici, müdür, muhasebeci |
| `karaoke.tutar` | Karaoke ön ödemesi ve tutarları (Kasa raporunun site satırı; kasa e-postasının kitlesi) | yönetici, muhasebeci |
| `kategori.tum` | Kasadan çıkanın bütün gider kategorileri (maaş, kira, reklam): seçmek ve adını görmek | yönetici, muhasebeci |
| `onay` | Personelin isteklerine karar (Onaylar) | yönetici, müdür |
| `vardiya.yaz` | Vardiya planını yazmak | yönetici, müdür |
| `rapor.sube` | Bugün'ün şube günü, İşçilik / ciro | yönetici, müdür |
| `muhasebe.oku` | Faturalar, gelir-gider, vergi, aylık harcamalar, muhasebeci paketi | yönetici, muhasebeci |
| `maas` | Maaşlar, kişisel ücretler, avanslar, bordro dökümü (kişi kişi), personel belgeleri | yönetici |
| `yonetim` | Ayarlar, kullanıcılar, Paraşüt, yedek, anahtarlar, şube ayarları, Claude bağlantısı, tam dışa aktarım | yönetici |
| `sube.tumu` | Bütün şubeleri görmek ve seçmek | yönetici, muhasebeci |

- **Kapılar** (`src/server/auth/dal.ts`): `requireAdmin()` (yalnız yönetici), `requireCan(yetenek)`,
  `requireRole(...roller)`, `requireUser()` (yalnız kendi hesabı ve salt okuma), `requireSignedIn()` (iki adımlı
  kurulum). Yetkisiz kişi kendi ana ekranına yönlenir; muhasebeci bir **sunucu eyleminde** (istekte `Next-Action`)
  yönlenmez, eylem "Hesabınız salt okunur: bu işlemi yapamazsınız." hatasıyla döner (ekranda kalan bir düğmeye bastıysa
  sayfadan atılmaz).
- **Çekirdeklerin iki düzeyi.** Kasa, zayi, kasadan çıkan, kapalı gün ve istek çekirdekleri `"admin" | "staff"` bekler.
  Müdür işletme çekirdeklerine "admin" düzeyinde girer (`opsLevel`, `opsActor`), personelin ekranlarının çekirdeklerine
  (karaoke, kontrol listesi, sayım, reçete önerisi, sipariş, özel gün, kasadaki fiyatlar) "staff" düzeyinde
  (`adminLevel`, `adminActor`). Kasa okumalarının düzeyi `cashAudience` (rakam gören "admin" DTO'sunu alır).
  Çekirdeğe giden kişi gerçek rolünü de taşır (`asActor` › `realRole`, `realRoleOf`): düzey yazım yolunu seçer, yalnız
  yöneticinin olanlara (bütün kategoriler, başkasının fotoğrafı, tedarikçi ödemesine bağlı satır) çekirdek gerçek role
  bakar.
- **Varsayılan kapalı.** Emin olunmayan her eylem ve ekran yalnız yöneticinin. `requireAdmin` çağrıları tek tek gözden
  geçirildi; yalnız müdüre ya da muhasebeciye açılan okuma ve işletme yolları `requireCan`'a geçti, gerisi aynen kaldı.

## Müdür

Şubesinin günlük işletmesini yönetir. Hesabında **şube zorunlu** (Kullanıcılar & roller ve veritabanı kısıtı
`users_manager_branch_ck`); panel o şubede **kilitli**:

- Personelin kilidinin hepsi (`src/server/branch-scope.ts` › `lockedBranch`, `staffBranchRefusal`; [SUBE.md](SUBE.md) ›
  Personel hesabının şubesi) ve ayrıca: `withBranchScope("hepsi" ya da başka şube, …)` ile açılan okumalar da
  (işletme geneli kartlar, şubeleri yan yana koyan yükleyiciler) şubesine daralır (`currentBranchScope`). Müdür öteki
  şubeyi hiçbir yoldan okuyamaz.
- Fotoğrafta şube yok: müdür "admin" düzeyinde yazsa da kasa raporuna, kasadan çıkana ve LafPOS gün sonuna yalnız kendi
  yüklediği fotoğrafı bağlar (öteki şubenin bağsız Z'sini kendi kaydına bağlayıp göremesin); onayladığı isteğin tuttuğu
  fotoğraf bağlanır (`src/lib/roles.ts` › `linksAnyPhoto`).
- Tedarikçiler (cari) yöneticinin: tedarikçi ödemesine bağlı kasadan çıkan satırı müdüre de personel gibi kilitli
  (düzeltemez, silemez; yanıt tedarikçinin adını söylemez; Kasa'da kilit simgesiyle görünür).
- Şubesi pasife alınırsa oturumu yok sayılır, giriş de reddedilir (`managerWithoutBranch`). Personelde kilit kalkar
  ("Tümü"); müdürde kalkarsa öteki şubeleri görürdü.
- Onaylar'da yalnız şubesinin kasa ve zayi / ikram isteklerini görür ve karara bağlar; şubesi bilinmeyen istek ona
  kapalı (`reviewBranchRefusal`, `loadCashRequestQueue(…, strict)`).
- Zayi ve ikramın malzeme maliyeti yöneticinin: müdür zayiyi "admin" düzeyinde yazsa da Zayi & ikram'ın ay özeti
  (malzeme maliyeti, en çok giden kalemler, Tutarlılık bağlantısı) ona çizilmez, sekmelerde Tutarlılık yok; Onaylar'ın
  geç kayıt kartında malzeme maliyeti yok, ikramda menü değeri kalır (müdürün kartında `cost` anahtarı gitmez;
  `src/server/data/waste-requests.ts` › `wasteCardsFor`).
- Canlı uçta (`/api/canli`) karaoke, uygulama siparişi ve masa çağrısı yalnız şubesinde açıksa gelir (seçici çerezi yok
  sayılır); karaoke tutarı gitmez.

**Görür ve yapar:** personelin her ekranı; kasa raporlarının rakamları ve geçmişi, onaysız düzeltme ve silme, kilitli
ya da eski güne yazma, kafe kapalı günü işaretleme; kasadan çıkanı ve zayi / ikramı doğrudan; Onaylar (şubesinin
istekleri); vardiya planını yazma; Teslim defteri; Bugün'de şubesinin günü (ciro, kasa farkı, geçen hafta); İşçilik /
ciro (haftalık ve aylık, yalnız şubesi).

**Görmez / yapamaz:** maaşlar ve kişisel ücretler (Maaşlar, avanslar, bordro, personel belgeleri, İşçilik'in günlük
görünümü, kasadan çıkanın maaş / kira kategorileri), vergi, Paraşüt, ayarlar, kullanıcı yönetimi, yedek, anahtarlar,
şube ayarları, Genel bakış, Şube karşılaştırma, Kaçak ve Kayıp önleme raporları, maliyet / kâr / hammadde fiyatı
ekranları, reçeteyi doğrudan düzenleme ve reçete önerisine karar, karaoke doluluğu (tutar) ve Kasa raporunun site
satırındaki karaoke ön ödemesi (online toplamı görür; `karaoke.tutar`), kontrol listelerini düzenleme, panel asistanı
(yalnız yönetici), öteki şubeler.

## Muhasebeci

**Salt okunur.** Ekranları: **Muhasebe** (ana ekranı: ekranların listesi ve muhasebeci paketi), **Faturalar** (belge
ve kalemleriyle), **Gelir-gider**, **Vergi** (alt sayfaları, kişi kişi bordro dökümü olmadan), **Aylık harcamalar**,
**Kasa raporu** (rakamlarıyla, bütün şubeler) ve **Hesabım**. Her ekranın başında "Salt okunur hesap" şeridi; yazma
düğmeleri gizli.

- Hiçbir kayıt değiştiremez: her sunucu eylemi reddeder. Geçenler yalnız kendi hesabının eylemleri (parola, iki
  adımlı, oturumlar, bu cihazın bildirim aboneliği) ve salt okumalar (şube seçimi çerezi, kasa raporunun WhatsApp
  metni). Veri uçları da: fotoğraf yükleyemez, sipariş eşitleyemez, vardiya PDF'ini alamaz.
- Ayar görmez; zil ona boş döner; canlı uç (`/api/canli`) ona karaoke oturumu, silme isteği, uygulama siparişi ve masa
  çağrısı vermez (saha ekranları kapalı, `canOpen`; hiçbir şube seçiminde); panel asistanı yok.
- Kişi verisi: kişi başı maaş (Maaşlar, bordro dökümü), avanslar ve personel belgeleri yok; gelir-gider ve vergide
  personel giderleri toplam olarak durur. Kasa raporunda kasadan çıkan satırları kategorileriyle görür (muhasebe kaydı).
- Tam dışa aktarım (`/api/export`) ve yedek yöneticinin; muhasebecinin dışa aktarımı aylık **muhasebeci paketi**
  (`/api/muhasebe/paket`, [MUHASEBE-PAKETI.md](MUHASEBE-PAKETI.md)).

## Kullanıcı yönetimi ve davet

**Kullanıcılar & roller**'de rol seçicisi dört rol (açıklamaları `ROLE_HINTS`); yetki tablosu dört sütun
(`ROLE_PERMISSIONS`, testle ekran ve yetenek kuralıyla aynı). Müdür seçilince **Şube** zorunlu ("Müdürün şubesini
seçin: müdür yalnız kendi şubesini yönetir"); yönetici ve muhasebeci şubeye bağlanmaz. Davet (Kullanıcı ekle › davet
bağlantısı) aynı formdan, aynı kurallarla (`src/server/actions/settings.ts` › `createUser`). Rol değişince kişinin açık
oturumları kapanır (oturum sürümü).

## Kararlar

- **Maaş ve kişisel ücret müdürde yok** (en tutucusu). İşçilik / ciro'da yalnız haftalık ve aylık şube toplamı; günlük
  görünüm tek kişinin gününü (kişisel ücret) gösterdiği için kapalı. Kasadan çıkanda müdür personelin kategorilerini
  seçer, öbür satırların tutarını görür ama kategori adını görmez (Kasa'nın ay görünümünde rapor penceresine satırın
  yalnız adı, tutarı ve fişi gider; `src/lib/cash-outs.ts` › `sheetCashOutsByDate`); sunucu da müdürün maaş, kira gibi
  kategoriye yazmasını reddeder: kural yazım yolunda (`src/server/cash-outs/write.ts` › `writeCashOut`, gerçek rol),
  doğrudan kayıt da Onaylar'da isteğin onayı da ondan geçer (Onaylar'ın kategori seçicisi ve fiş fotoğrafının okuması
  müdüre yalnız personelin kategorilerini verir, `src/server/photo-read/read.ts` › `readPhotoFor`; düzeltmede satırın
  şimdiki kategorisi kalabilir, geri almada silinen kaydınki geri gelir). Onaylar'ın kasadan çıkan kartında da
  yöneticinin kategorisinin adı müdüre gitmez ("Bağlı gider: yöneticinin kategorisi"); olası tekrar listesi ona yalnız
  isteğin şubesinin satırlarını ve personelin kategorisindeki harcama kayıtlarını gösterir (öteki şubenin satırı, maaş
  ve kira kaydı gitmez; `src/server/data/cash-out-requests.ts` › `cashOutCards`).
- **Genel bakış, Şube karşılaştırma, Kaçak ve Kayıp önleme müdüre açılmadı:** işletme geneli kâr, kira ve maaşı ve
  öteki şubeleri bir arada gösteriyorlar. Müdürün şube raporları: Bugün'deki şube günü ve İşçilik / ciro.
- **Muhasebeci kişi başı maaş görmez**; bordro toplamları, SGK ve muhtasar toplamları vergide görünür. Personel
  belgeleri ona kapalı.
- **İki adımlı doğrulama** rakam gören her rolde zorunlu: yönetici, müdür, muhasebeci (`TWO_FACTOR_ROLES`;
  `src/lib/admin-security.ts`). Personel ortak tablette sırayla girer; onda isteğe bağlı. Yeni cihaz uyarısı da bu üç
  rolde.
- **E-posta alıcıları** ([BILDIRIMLER.md](BILDIRIMLER.md) › Alıcılar ve hesaplar): kasa raporu ve sabah e-postası
  personel ve **müdür** hesabının adresine gitmez (listeler şubeler arasında ortak olabilir; kasa e-postası karaoke ön
  ödemesini, sabah e-postası işletmenin ödemelerini ve maliyetini taşır); **muhasebeci** hesabı alır (hesabı olmayan
  muhasebeci adresi gibi).
- **Saha kitleleri:** vardiya planının kişileri, kontrol listesi ve karaoke uyarılarının personel alıcıları müdür ve
  personel (`SHIFT_ROLES`); muhasebeci sahada değil.
- **Panel asistanı** yalnız yöneticinin (müdür ve muhasebeci "staff" düzeyinde reddedilir).

## Veritabanı

`users.role` text; göç `drizzle/0097_roller.sql`:

- `users_role_ck`: `role in ('admin','manager','staff','accountant')`;
- `users_manager_branch_ck`: müdürde `branch_id` boş olamaz.

## Testler

- `tests/roller.test.ts`: her rolün ekranları ve yetenekleri; menüdeki her öğe ↔ rol kuralı; proxy yönlendirmesi (her
  rol için birkaç yol); yetki tablosu; iki adımlı ve e-posta kuralları; **kaynak taraması**: her `"use server"`
  dosyasının dışa verdiği her eylem bir kapı çağırır (`tests/helpers/action-gates.ts`) ve hiçbiri muhasebeciye yazma
  izni vermez.
- `tests/roller-db.test.ts` (gerçek Postgres, `ROLLER_TEST_DATABASE_URL`): kısıtlar; müdür öteki şubeyi okuyamaz,
  öteki şubenin isteğine karar veremez, öteki şubeye yazamaz, şubesi pasifken oturumu yok; muhasebecide **bütün** sunucu
  eylemleri "salt okunur" döner ve veritabanının hiçbir tablosu değişmez.

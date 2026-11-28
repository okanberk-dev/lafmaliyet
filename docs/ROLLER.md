# Roller: Yönetici, Müdür, Personel, Muhasebeci

Panelde dört rol var (`users.role`; `src/lib/constants.ts` › `ROLES`). Kim hangi ekranı açar ve ne yapar **tek
kaynaktan** okunur: `src/lib/roles.ts`. Dalga 3 maddesi (YAPILACAKLAR.md): "Müdür" ve salt okunur "Muhasebeci" rolleri;
büyük plan [planlar/personel-yetki.md](planlar/personel-yetki.md).

| Rol | Kısaca |
| --- | --- |
| **Yönetici** (`admin`) | Her şey. |
| **Müdür** (`manager`) | Şubesinin günlük işletmesi; şubesine kilitli (şube zorunlu). |
| **Personel** (`staff`) | Günün işleri (değişmedi; [planlar/personel-yetki.md](planlar/personel-yetki.md)). |
| **Muhasebeci** (`accountant`) | Salt okunur: faturalar, gelir-gider, harcamalar, kasa raporları, muhasebeci paketi. |

Yöneticilerden biri **asıl yönetici**dir: şube açma, kapatma ve kasa kurma yalnız onda; yönetici hesaplarını da yalnız
o yönetir ([Yönetici hesapları](#yönetici-hesapları)); hesabı öteki yöneticilere karşı korunur (aşağıda
[Asıl yönetici](#asıl-yönetici)). Bu bir rol değil, adresiyle tanımlı tek bir yönetici hesabıdır.

## Tek kaynak: `src/lib/roles.ts`

- **Ekranlar** (`canOpen(rol, yol)`): `STAFF_PATHS`, `MANAGER_EXTRA_PATHS`, `ACCOUNTANT_PATHS` ve her rolün altında kapalı
  olanlar (`ADMIN_ONLY_PATHS`, `MANAGER_CLOSED_PATHS`, `ACCOUNTANT_CLOSED_PATHS`). `src/proxy.ts` izinsiz adresi rolün
  ana ekranına (`homeFor`: yönetici `/panel`, müdür ve personel `/panel/bugun`, muhasebeci `/panel/muhasebe`)
  döndürür; menü, alt menü, sekme ve arama aynı kurala bakar (`src/components/panel/nav.ts`). Ekranın içindeki
  bağlantı da: rolün açamadığı ekrana bağlantı çizilmez (`openableHref(rol, adres)`, açamıyorsa null; tıklayan ana
  ekranına dönerdi).
- **Yükleme iskeleti en dar rolle** (28 Kasım 2026): sayfa yüklenirken rol henüz okunmamıştır; iskelet (Suspense
  `fallback`'i) ekranı açabilen rollerin en darıyla çizilir, yöneticinin sekmeleri ve açıklaması içerik gelince eklenir.
  Başlık bileşenlerinde rol zorunludur (varsayılan "yönetici" değil): İşçilik / ciro yüklenirken müdür Raporlar'ın,
  Aylık harcamalar yüklenirken muhasebeci Giderler'in yönetici sekmelerini görüyordu.
- **Yetenekler** (`CAPABILITIES`, `can(rol, yetenek)`): eylem düzeyi. Tabloda olmayan rol için her yetenek KAPALI.
  Salt okunur hesap tek soruyla sorulur: `isReadOnly(rol)` (`kayit.yaz` yok). Ekranlar yazma düğmesini, formunu ve satır
  içi düzenlemeyi buna bakarak çizmez; rol adıyla karşılaştırılmaz.

| Yetenek | Ne | Roller |
| --- | --- | --- |
| `kayit.yaz` | Her yazan eylemin tabanı (kasa raporu, zayi, sayım, kontrol listesi, sipariş …) | yönetici, müdür, personel |
| `isletme.yonet` | Kasa raporunu onaysız düzeltmek ve silmek, kilitli / eski güne yazmak, kasadan çıkanı ve zayiyi doğrudan, kafe kapalı günü işaretlemek | yönetici, müdür |
| `kasa.rakam` | Kasa raporlarının rakamları ve geçmişi (fark, devir, beklenen nakit, yazarkasa; kör kasa yok) | yönetici, müdür, muhasebeci |
| `karaoke.tutar` | Karaoke ön ödemesi ve tutarları (Kasa raporunun site satırı; kasa e-postasının kitlesi) | yönetici, muhasebeci |
| `kategori.tum` | Kasadan çıkanın bütün gider kategorileri (maaş, kira, reklam): seçmek, adını ve o kategorideki satırın metnini (yer, açıklama, fiş) görmek | yönetici, muhasebeci |
| `onay` | Personelin isteklerine karar (Onaylar) | yönetici, müdür |
| `vardiya.yaz` | Vardiya planını yazmak | yönetici, müdür |
| `rapor.sube` | Bugün'ün şube günü, İşçilik / ciro | yönetici, müdür |
| `muhasebe.oku` | Faturalar, gelir-gider, aylık harcamalar, muhasebeci paketi | yönetici, muhasebeci |
| `maas` | Maaşlar, kişisel ücretler, avanslar, personel belgeleri | yönetici |
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
- Fotoğrafta şube yok: müdür "admin" düzeyinde yazsa da kasa raporuna, kasadan çıkana ve AsilPOS gün sonuna yalnız kendi
  yüklediği fotoğrafı bağlar (öteki şubenin bağsız Z'sini kendi kaydına bağlayıp göremesin); onayladığı isteğin tuttuğu
  fotoğraf bağlanır (`src/lib/roles.ts` › `linksAnyPhoto`).
- Tedarikçiler (cari) yöneticinin: tedarikçi ödemesine bağlı kasadan çıkan satırı müdüre de personel gibi kilitli
  (düzeltemez, silemez; yanıt tedarikçinin adını söylemez; Kasa'da kilit simgesiyle görünür).
- Şubesi pasife alınırsa oturumu yok sayılır, giriş de reddedilir (`managerWithoutBranch`, `src/lib/roles.ts`).
  Personelde kilit kalkar ("Tümü"); müdürde kalkarsa öteki şubeleri görürdü. **Bildirim de almaz** (28 Kasım 2026):
  hesabı "etkin" kaldığı için Web Push ve kişiye giden e-postalar (vardiya, kontrol listesi, karaoke) gitmeye devam
  ediyordu; alıcı kuralı tek yerde (`src/server/notify/reachable.ts`), şube yeniden açılınca kendiliğinden yeniden alır.
- Onaylar'da yalnız şubesinin kasa ve zayi / ikram isteklerini görür ve karara bağlar; şubesi bilinmeyen istek ona
  kapalı (`reviewBranchRefusal`, `loadCashRequestQueue(…, strict)`). Kartın gösterdiği, isteğin tuttuğu fotoğrafı
  (geç kasa raporunun Z'si, kasadan çıkan isteğinin fişi; onaya kadar bağlanmaz, yükleyeni personel) /api/foto ona
  verir: karar veren görür, yalnız şubesinin isteğininki ve önerilen kategori yöneticinin değilse
  (`src/server/photo-read/rules.ts` › `heldForReview`). Muhasebeci ve personel isteğe karar vermez, tutulan fotoğrafı
  görmez (personel yalnız kendi yüklediğini). Karardan sonra türün kuralı: onayda fotoğraf kayda bağlıdır, retde bırakılır.
- Zayi ve ikramın malzeme maliyeti yöneticinin: müdür zayiyi "admin" düzeyinde yazsa da Zayi & ikram'ın ay özeti
  (malzeme maliyeti, en çok giden kalemler, Tutarlılık bağlantısı) ona çizilmez, sekmelerde Tutarlılık yok; Onaylar'ın
  geç kayıt kartında malzeme maliyeti yok, ikramda menü değeri kalır (müdürün kartında `cost` anahtarı gitmez;
  `src/server/data/waste-requests.ts` › `wasteCardsFor`).
- Canlı uçta (`/api/canli`) karaoke, uygulama siparişi ve masa çağrısı yalnız şubesinde açıksa gelir (seçici çerezi yok
  sayılır); karaoke tutarı gitmez.
- Vardiya planına yalnız ekranın önerebileceği hesabı yazar ("Kişi ekle" ve taslakla aynı kural: yönetici, şubesiz
  personel, şubesinin personeli; ya da şubesinin planında zaten olan kişi): sunucu istemcinin gönderdiği öteki şubeye
  kilitli personelin, müdürün, muhasebecinin ya da planda olmayan pasif hesabın satırını reddeder, hesabın adını okumaz
  (Kaydet ve Yazarak doldur; `src/server/vardiya/store.ts` › `shiftAccounts`, [VARDIYA.md](VARDIYA.md) › Ekran). Yoksa
  kimlik kimlik satır gönderip bütün hesapların adını planında okur, öteki şubenin kişisine "Vardiyanız değişti"
  gönderirdi. Vardiya bildirimi muhasebeciye hiç gitmez.
- Yönetici ekranlarına bağlantı ona çizilmez (`openableHref`): Vardiya'da planı yazar ama hazır vardiyaların saatleri
  (Şube ayarları) ve yazarak doldurmanın anahtarı (Ayarlar) yöneticinin; bağlantıların yerinde "Saatleri yönetici
  değiştirir.", "Yönetici Ayarlar'dan açınca kullanılır." yazar, anahtarın teknik notu yok (`src/lib/vardiya.ts` ›
  `shiftGridLinks`). Zayi & ikram'da AsilPOS'un ürüne bağlanmamış satırının notu kalır, "Ayarlar › AsilPOS'ta bağlayın"
  bağlantısı gitmez.
- Kasa e-postasının neden gitmediği (Resend anahtarı, alıcı listesi) yalnız yöneticinin: müdür "admin" DTO'sunu alsa
  da günün formunda, ayın penceresinde ve Onaylar'da onayladığı düzeltmenin yanıtında sabit metni görür ("E-posta
  gitmedi; yöneticiye haber verin…"; `src/lib/staff-errors.ts` › `emailErrorFor`, okuyanın gerçek rolüyle).

**Görür ve yapar:** personelin her ekranı; kasa raporlarının rakamları ve geçmişi, onaysız düzeltme ve silme, kilitli
ya da eski güne yazma, kafe kapalı günü işaretleme; kasadan çıkanı (yöneticinin kategorisindeki satır hariç) ve zayi /
ikramı doğrudan; Onaylar (şubesinin istekleri); vardiya planını yazma; Teslim defteri; Bugün'de şubesinin günü (ciro,
kasa farkı, geçen hafta); İşçilik / ciro (haftalık ve aylık oran, yalnız şubesi, yalnız aylık ücretlerle).

**Görmez / yapamaz:** maaşlar ve kişisel ücretler (Maaşlar, avanslar, bordro, personel belgeleri, İşçilik'in günlük
görünümü, işçilik tutarı ve part-time'ın günlük ücreti, kasadan çıkanın maaş / kira kategorileri: seçmek, adını ve o
kategorideki satırın yerini, açıklamasını, fişini görmek, o satırı düzeltmek, silmek ve isteğine karar vermek),
Paraşüt, ayarlar, kullanıcı yönetimi, yedek, anahtarlar, şube ayarları, Genel bakış, Şube karşılaştırma, Kaçak ve Kayıp
önleme raporları, maliyet / kâr / hammadde fiyatı ekranları, reçeteyi doğrudan düzenleme ve reçete önerisine karar,
karaoke doluluğu (tutar) ve Kasa raporunun site satırındaki karaoke ön ödemesi (online toplamı görür; `karaoke.tutar`),
kontrol listelerini düzenleme, panel asistanı (yalnız yönetici), öteki şubeler.

## Muhasebeci

**Salt okunur.** Ekranları: **Muhasebe** (ana ekranı: ekranların listesi ve muhasebeci paketi), **Faturalar** (belge
ve kalemleriyle), **Gelir-gider**, **Aylık harcamalar**, **Kasa raporu** (rakamlarıyla, bütün şubeler) ve **Hesabım**.
Her ekranın başında "Salt okunur hesap" şeridi; yazma düğmeleri gizli (aşağıda "Ekranlarda ne çizilmez"). Alt menüsü:
Muhasebe, Faturalar, Gelir-gider, Harcamalar, Kasa. **Vergi** 27 Kasım 2026'da ekranlarından çıktı (sahibin kararı: Vergi bölümü kaldırıldı, vergiyi
muhasebeci yürütüyor); eski adresler Muhasebe'ye kısa notla döner (`?kaldirildi=vergi`).

- **Ekranlarda ne çizilmez** (28 Kasım 2026; `isReadOnly`, `openableHref`; sayfa rolü istemci bileşenine verir).
  Faturalar: ekleme, düzenleme, silme, ödendi işareti, kategori ve şube seçimi, onay, toplu seçim, şube atama kutusu,
  silinen faturaları geri alma; satır faturayı salt okunur pencerede açar (belge açılır ve indirilir, eklenmez,
  silinmez), kalemlerde Hammaddeler ve Paraşüt bağlantısı yok. Gelir-gider: hücreler düğme değil (rakam, uyarı, açıklama
  ve not okunur), ay notu ve "Siteden yenile" yok; tutarların kaynak bağlantısı yalnız Faturalar ve Aylık harcamalar'a
  (Satışlar, Stok sayımı, Maaşlar, Sabit giderler ve Tedarikçiler ona kapalı), "Sayım gir" yok. Aylık harcamalar: ekleme
  formu, kategori düğmeleri, sabit gideri aylığa çevirme yok; kayıt salt okunur pencerede açılır. Kasa raporu: zayi
  "Ekle", raporu olmayan günün formu, gün sonu fotoğrafı seçicisi, "Banka POS'a yaz", "Kümülatifi temizle", e-postayı
  yeniden gönderme, ay listesinde "Gir" ve "İncele" yok. Rakamlar, belgeler ve fotoğraflar okunur.
- Hiçbir kayıt değiştiremez: her sunucu eylemi reddeder. Geçenler yalnız kendi hesabının eylemleri (parola, iki
  adımlı, oturumlar, bu cihazın bildirim aboneliği, şube görünümü tercihi) ve salt okumalar (şube seçimi çerezi, kasa raporunun WhatsApp
  metni). Veri uçları da: fotoğraf yükleyemez, sipariş eşitleyemez, vardiya PDF'ini alamaz, belge taramada yapay
  zekâya köşe ipucu soramaz (`/api/foto/kenar` ve çekirdeği `scanHintFor`: ücretli istek, `ai_calls` satırı ve
  işletmenin ortak günlük sınırı; [FOTOGRAF.md](FOTOGRAF.md) › Belge tarama).
- Ayar görmez; zilinde yalnız kendi hesabının güvenlik uyarısı (yeni cihazdan giriş) durur; canlı uç (`/api/canli`)
  ona karaoke oturumu, silme isteği, uygulama siparişi ve masa çağrısı vermez (saha ekranları kapalı, `canOpen`; hiçbir
  şube seçiminde); panel asistanı yok.
- Kişi verisi: kişi başı maaş (Maaşlar), avanslar ve personel belgeleri yok; gelir-gider'de personel giderleri toplam
  olarak durur. Gelir-gider'in personel hücrelerinin ipucu ve uyarısı da (tablonun hücresi ve ay
  görünümü; istemciye giden veri) kişisiz: part-time satırında "1 part-time kişi: günlük ücret × Vardiya'daki çalışma günü
  + ek ödeme" (yöneticide "Ayşe: 10 gün × 1.500 ₺ + ek 2.000 ₺"), bağlantısız part-time uyarısı adsız kişi sayısıyla, yemek
  kartını AsilPOS gününe göre alanlar adsız ve günsüz ("2 kişi = 12.540 ₺"); tutarlar aynı. Metin motorda kurulur:
  `src/lib/calc/engine.ts` › `ModelOptions.personal` (varsayılan kapalı; `loadModel`, `createModel`), Gelir-gider
  `personal: can(rol, "maas")` ile açar. Kasa raporunda kasadan çıkan satırları kategorileriyle görür (muhasebe kaydı);
  e-postanın neden gitmediğini görmez, sabit metni görür (ham hata yalnız yöneticinin; `emailErrorFor`).
- **Şube görünümü** (Hesabım; [SUBE.md › Şube ayrımı](SUBE.md#şube-ayrımı-27-kasım-2026)): yönetici ve muhasebeci şube
  seçiliyken ekran ekran "yalnız şube" ya da "firma geneli" seçer;
  müdür ve şubesine kilitli personelde ayar yok, her ekran yalnız kendi şubesi (`saveBranchView` reddeder).
- Tam dışa aktarım (`/api/export`) ve yedek yöneticinin; muhasebecinin dışa aktarımı aylık **muhasebeci paketi**
  (`/api/muhasebe/paket`, [MUHASEBE-PAKETI.md](MUHASEBE-PAKETI.md)). Şube seçiliyken paketin elle indirmesi o şubenin
  (`?sube=`, işletme geneli kalemler muhasebecinin İşletme geneli giderler kipiyle: varsayılanı "Tutarla göster"); aylık
  e-posta bütün şubeler (şube ayrımı parça 6).

## Asıl yönetici

Sahibin kararı (26 ve 28 Kasım 2026). Asıl yönetici, **yönetici rolündeki ve e-postası ortamdaki `LADMIN_ANA_ADMIN`
olan** hesaptır (tanımlı değilse `info@nextgenlab.com.tr`; büyük-küçük harf fark etmez). Rol değil, adres: göç yok.
Tek tanım `src/lib/asil-yonetici.ts` (`isAnaAdmin`, `ASIL_YONETICI_ISLERI`, ret metinleri); sunucu eylemleri
`requireAnaAdmin(iş)` (`src/server/auth/dal.ts`) ile, ekranlar aynı `isAnaAdmin` ile karar verir. Tarayıcı ortam
değişkenini göremez: bayrak sunucuda hesaplanıp bileşene verilir (`src/app/panel/layout.tsx` → kenar çubuğu, çekmece ve
palet). Kodda eski ad ("ana yönetici": `isAnaAdmin`, `LADMIN_ANA_ADMIN`) kalır; arayüzde tek ad "Asıl yönetici".

**Yalnız asıl yöneticinin işleri.** Öteki yönetici okunur bir cümle alır: "Bu işlemi yalnız asıl yönetici yapar: …".

| İş | Eylem |
| --- | --- |
| Şube açmak | `createBranch` |
| Şube silmek | `deleteBranch` |
| Şubeyi kapatmak ya da yeniden açmak | `updateBranch` (yalnız `active` değişince) |
| Kasa programını değiştirmek (tür değişikliği de) | `updateBranch` (yalnız `posSource` ya da `kind` değişince) |
| Kasa kurmak (kurulum bağlantısı) | `sendBranchInstall` |
| Şubenin kasasını serbest bırakmak (parola ve şubenin adıyla) | `releaseBranchTill` |
| Şubenin ilk personelini (patron, müdür, barista PIN'leri) ayarlamak | `saveBranchStaff`, `createBranch` |
| Kasa anahtarını değiştirmek ya da silmek | `saveAsilposSecret` |
| AsilPOS'a geçiş gününü değiştirmek | `saveAsilposSwitchDay` |
| Kasayı gerçek açılışta şubeye bağlamak (kasada ladmin girişi) | `POST /api/asilpos/acilis/giris`, `.../bagla` |

**Kasa açılışı** ([ASILPOS.md › Kasa açılışı](ASILPOS.md#kasa-açılışı-28-kasım-2026)): yeni kasa gerçek kullanıma
geçerken asıl yöneticinin e-postası ve parolasıyla (hesapta açıksa iki adımlı kodla) girer. Panelin giriş korumaları
aynen (IP sınırı, 5 hatada 15 dakika kilit, kayıtsız e-postada aynı söz; panelin girişiyle aynı sayaçlar); başka hesap
"Kasayı yalnız asıl yönetici açar" alır. Oturum açılmaz, çerez yazılmaz: 15 dakikalık belirteç kişinin oturum sürümüne
bağlıdır, parola değişince ya da oturumlar kapatılınca geçmez.

Şubenin öteki alanları (ad, açılış günü, sıra, POS oranı, özellikler, e-posta) her yöneticide kalır. Ekranlarda asıl
yönetici olmayan yöneticiye bu alanlar ve düğmeler kapalıdır, nedeni yanında yazılıdır (Şubeler'in düzenleme penceresi,
Şube ayarları › AsilPOS bağlantısı, Ayarlar › AsilPOS (kasa) › geçiş günü). `updateBranch`'te kimlikten başka her alan
isteğe bağlıdır, verilmeyen alanın eskisi kalır (28 Kasım 2026): Şubeler'in düzenleme penceresi açık / kapalı durumu,
türü ve kasa programını yalnız pencerede değiştiyse gönderir. Böylece Yönetim konsolunda kapatılan şubeyi ladmin'deki
ad düzenlemesi yeniden açmaz, asıl yönetici olmayan yönetici ad değiştirirken ret almaz. **Şube ekleme** sayfası
(`/panel/sube-ekleme`, [SUBE.md › Şube ekleme](SUBE.md#şube-ekleme)) menüde yalnız ona görünür; başka yönetici adresle
açarsa içerik yerine tek cümle görür.

**Hesabı korunur.** Başka yönetici asıl yöneticinin hesabında şunları yapamaz (adını değiştirebilir):

- e-postasını, parolasını, rolünü ve erişimini değiştirmek (`saveUser`, `setUserActive`);
- hesabı silmek (`deleteUser`), iki adımlısını sıfırlamak (`resetUserTwoFactor`), kilidini açmak (`unlockUser`), her
  yerden çıkış yaptırmak (`signOutUserEverywhere`);
- ona giriş ya da parola sıfırlama bağlantısı üretmek (`createAccessLink`).

Kullanıcılar & roller'de satırı **"Asıl yönetici"** etiketini taşır; yönetici satırları herkese salt okunurdur
([Yönetici hesapları](#yönetici-hesapları)). Hiçbir hesap e-postasını asıl yöneticinin adresine çeviremez (`saveUser`, Hesabım › `updateProfile`).
Asıl yönetici kendi e-postasını Hesabım'dan değiştiremez: yetki bu adrese bağlıdır, ekran nedenini söyler.

**Adres hiçbir koşulda başka bir yöneticinin eliyle alınamaz** (28 Kasım 2026): o adresle yeni hesap açılamaz, hesap
yokken de (`asilAdresRet`; önceki "adres boşken bir yönetici açabilir" istisnası kapandı: hesap canlıda var). Adres
benzersiz, hesap silinemez, adresi değiştirilemez. Hesap bir gün yok olursa, pasif ya da yönetici olmayan bir hesapsa
yalnız veritabanından ya da `LADMIN_ANA_ADMIN` değiştirilerek düzelir. Asıl yönetici kilitlenirse:
[DEPLOY.md › Asıl yönetici kilitlenirse](DEPLOY.md#asıl-yönetici-kilitlenirse) (sırayla 15 dakika, Parolamı unuttum,
kurtarma kodları, en son `scripts/asil-yonetici-kurtar.ts`).

**Yönetim konsolu** (`https://yonetim.laffogato.net`, 28 Kasım 2026; tasarım
[planlar/yonetim-konsolu.md](planlar/yonetim-konsolu.md)): yalnız asıl yöneticinin girdiği ayrı adres ve ayrı oturum.
Girişi kendi eylemiyle (`src/server/actions/yonetim-giris.ts`): asıl yöneticinin adresi dışındaki her e-posta, başka
bir yöneticinin doğru parolasıyla bile, kayıtsız e-posta gibi yanıtlanır (aynı süre ve söz; o hesabın kilit sayacına ve
son girişine dokunulmaz). Asıl yöneticide panelin korumaları aynen (kilit, iki adımlı, yeni cihaz e-postası). Her konsol
sayfası `requireYonetim` ister: konsol çerezi geçerli, hesap etkin, oturum sürümü aynı, rol yönetici ve asıl yönetici;
değilse çerez silinip konsol girişine gidilir (`LADMIN_ANA_ADMIN` değişince de). Bu aşamada `requireAnaAdmin` iki
oturumu da kabul eder (konsol oturumu varsa onunla, yoksa panelin bugünkü yolu); `updateBranch` ve kullanıcı eylemleri
de önce konsol oturumuna bakar. ladmin'deki şube ekranları değişmedi: asıl yönetici şube işlerini iki yerden de
yapabilir. Yönetici hesapları yalnız konsolda (aşağıda).

**Konsolda şube işlemleri** (28 Kasım 2026; [SUBE.md › Şube işlemleri](SUBE.md#şube-işlemleri-yönetim-konsolu)):
Şubeler ve kasalar'da her şube satırından "Şube işlemleri" sayfası açılır (`/yonetim/sube/[id]`): şubeyi kapatma ve
yeniden açma, tür ve kasa programı, AsilPOS'a geçiş günü, kasa anahtarını döndürme ve silme, eski anahtarı silme,
şubeyi silme. Eylemler aynı (`updateBranch`, `saveAsilposSwitchDay`, `saveAsilposSecret`, `deleteBranch`), kurallar ve
onaylar aynı; kasa anahtarının parola onayı (`requireStepUp`) konsol oturumuyla çalışır, yanlış parola asıl yöneticinin
hesabına yazılır. Son 7 günde kasadan gün sonu gelen şubede (bugün Marina) sayfanın başında ve her yıkıcı işlemin
penceresinde kırmızı uyarı.

### Yönetici hesapları

Sahibin kararı (28 Kasım 2026; [planlar/yonetim-konsolu.md](planlar/yonetim-konsolu.md) › K-B). **Bir yönetici hesabına
dokunan iş yalnız asıl yöneticinindir.** "Dokunan": işlemden önceki ya da sonraki rol yönetici (`yoneticiHesabi`,
`yoneticiDuzenlemeIsi`; `src/lib/asil-yonetici.ts`). Eylem hedefi okuduktan hemen sonra, parola sorusundan ve ilk
yazımdan önce `requireAnaAdmin(yonetici…)` ister (konsol oturumunu da kabul eder); öteki yönetici okunur cümle alır
("Bu işlemi yalnız asıl yönetici yapar: yönetici hesabı açmak"), parolası hiç sorulmaz ve denenmez.

| İş | Eylem | Asıl yönetici | Öteki yönetici |
| --- | --- | --- | --- |
| Yönetici hesabı açmak (parolalı ya da davetli) | `createUser` (rol yönetici) | ✓ (parolayla) | ✗ |
| Var olan hesaba yöneticilik vermek | `saveUser` (rol yöneticiye çıkar) | ✓ (parolayla) | ✗ |
| Yöneticiliği almak (müdür, muhasebeci ya da personel olur; şube kuralı aynı) | `saveUser` (rol yöneticiden iner) | ✓ (parolayla) | ✗ |
| Yöneticinin e-postası, parolası, erişimi | `saveUser` | ✓ (parolayla) | ✗ |
| Yöneticinin **yalnız adı** | `saveUser` | ✓ | ✓ |
| Yöneticiyi pasif ya da yeniden aktif yapmak | `setUserActive` | ✓ (parolayla) | ✗ |
| Yöneticiyi silmek | `deleteUser` | ✓ (parolayla) | ✗ |
| Yöneticinin iki adımlısını sıfırlamak | `resetUserTwoFactor` | ✓ (parolayla) | ✗ |
| Yöneticinin kilidini açmak, oturumlarını kapatmak | `unlockUser`, `signOutUserEverywhere` | ✓ | ✗ |
| Yöneticiye giriş ya da parola sıfırlama bağlantısı (daveti yenilemek de) | `createAccessLink` | ✓ (parolayla) | ✗ |
| Müdür, muhasebeci, personel hesaplarının bütün işleri | aynı eylemler | ✓ | ✓ (bugünkü gibi, parolasız) |
| Kendi hesabı: ad, e-posta, parola, iki adımlı, oturumlar | Hesabım (`src/server/actions/auth.ts`) | ✓ (e-postası sabit) | ✓ |

Değişmeyenler: kendi hesabını pasif yapmak, yöneticiliğini almak, silmek, kendi parolasını ve e-postasını Kullanıcılar'dan
değiştirmek yine yasak (Hesabım'da); son yönetici kuralı ("En az bir aktif yönetici kalmalı") aynen; asıl yöneticinin
hesap koruması aynen (o hesapta önce o ret gelir). Parola onayının durumları (`src/lib/step-up.ts`) değişmedi.

**Nerede:** Yönetim konsolu › **Yöneticiler** (`/yonetim/yoneticiler`; `src/app/yonetim/(konsol)/yoneticiler/`):
yönetici listesi (ad, e-posta, etkin / pasif, iki adımlı, son giriş, "Asıl yönetici" rozeti), Yönetici ekle (ladmin'in
Kullanıcı ekle akışı, rol yönetici; Giriş bilgileri penceresi aynı), Yöneticilik ver (hesap e-postasıyla bulunur),
her yöneticinin İşlemler penceresi (yöneticiliği al, pasif / aktif, sil, iki adımlıyı sıfırla, kilidi aç, oturumları
kapat, giriş bağlantısı). Eylemler var olan sunucu eylemleri; ladmin'in ortak parçaları (Giriş bilgileri, parola alanı,
onay metinleri, pencere koruması) kullanılır. Asıl yöneticinin kendi satırında işlem yok (Hesabım'a bağlantı).
Sekmenin üstünde kendi hesabının durumu: iki adımlı kapalıysa açması önerilir (ladmin › Hesabım), açıksa kalan
kurtarma kodu sayısı. **ladmin › Kullanıcılar:** yönetici satırları herkese (asıl yönetici dahil) salt okunur; satırda
ve pencerede "Yönetici hesapları Yönetim konsolunda yönetilir" (asıl yöneticiye konsol bağlantısıyla:
`YONETIM_URL` tanımlıysa konsolun adresi, değilse aynı adresteki `/yonetim/yoneticiler`); Kullanıcı ekle ve düzenlemede
"Yönetici" rolü kapalı, nedeni yazılı. Müdür, muhasebeci ve personel satırları bugünkü gibi.

Testler: `tests/asil-yonetici.test.ts` (saf kurallar ve kaynak taraması), `tests/asil-yonetici-db.test.ts` (gerçek
Postgres, `ASIL_YONETICI_TEST_DATABASE_URL`): her korunan eylemde asıl yönetici geçer, öteki yönetici okunur hata alır,
müdür, muhasebeci ve personel reddedilir; hesap korumasının her eylemi; kapanan şubenin bekleyen kodları iptal olur ve
kodu reddedilir; Marina'nın anahtarı bütün senaryolardan sonra baştakiyle aynı. Kasa açılışı: `tests/kasa-acilis.test.ts`
ve `tests/kasa-acilis-db.test.ts` (`KASA_ACILIS_TEST_DATABASE_URL`). Konsolda şube işlemleri:
`tests/konsol-sube-db.test.ts` (`KONSOL_SUBE_TEST_DATABASE_URL`). Yönetici hesapları:
`tests/yonetici-hesaplari-db.test.ts` (`YONETICI_HESAPLARI_TEST_DATABASE_URL`): öteki yönetici her yönetici hedefli işte
okunur ret alır ve ret parola sorusundan önce gelir; asıl yönetici panel ve konsol oturumuyla geçer; öteki yönetici
müdür, muhasebeci ve personel işlerini ve Hesabım'ı bugünkü gibi yapar; konsol sayfasının verisinde sır yok. Kurtarma
betiği: `tests/asil-yonetici-kurtar-db.test.ts` (`ASIL_KURTAR_TEST_DATABASE_URL`).

## Kullanıcı yönetimi ve davet

**Kullanıcılar & roller**'de rol seçicisi dört rol (açıklamaları `ROLE_HINTS`; "Yönetici" seçeneği kapalı, yönetici
hesapları Yönetim konsolunda: [Yönetici hesapları](#yönetici-hesapları)); yetki tablosu dört sütun
(`ROLE_PERMISSIONS`, testle ekran ve yetenek kuralıyla aynı). Müdür seçilince **Şube** zorunlu ("Müdürün şubesini
seçin: müdür yalnız kendi şubesini yönetir"); yönetici ve muhasebeci şubeye bağlanmaz. Davet (Kullanıcı ekle › davet
bağlantısı) aynı formdan, aynı kurallarla (`src/server/actions/settings.ts` › `createUser`). Rol değişince kişinin açık
oturumları kapanır (oturum sürümü).

## Kararlar

- **Maaş ve kişisel ücret müdürde yok** (en tutucusu). İşçilik / ciro'da yalnız haftalık ve aylık şube oranı, aylık
  ücretlerle (bir sonraki madde). Kasadan çıkanda müdür personelin kategorilerini
  seçer; **yöneticinin kategorisindeki satırın yalnız türünü ve tutarını görür**: kategorinin adı, satırın yeri (kime),
  açıklaması, fişin bilgileri (no, tarih, KDV) ve fotoğrafı ona gitmez, satırın adı "Harcama" (serbest metin kişinin
  adını ve ücretini taşır: "Selin · Kasım avansı"). Kural tek yerde: `src/lib/roles.ts` › `ownerRowAmountOnly`
  (rakamları görüp bütün kategorileri görmeyen rol), `src/lib/cash-outs.ts` › `amountOnlyRow`. Kasa'nın gün görünümü
  (satırlar, formun özeti, gün sonu bölümü) ve ay görünümü (rapor penceresi `sheetCashOutsByDate`, günlerin WhatsApp
  metni) ve WhatsApp metni veren eylemler (`submitCashReport`, `cashReportWhatsapp`) satırları
  `src/server/data/cash-outs.ts` › `cashOutsShownTo`'dan geçirir; o satırın fişini /api/foto ona vermez
  (`src/server/photo-read/rules.ts` › `receiptPhotoRules`). Kasa e-postası (alıcıları yönetici ve muhasebe) bütün
  satırla gider. Personel değişmedi: satırı Kasa'da metniyle görür, metnini düzeltme isteği açar
  ([KASA-RAPORU.md](KASA-RAPORU.md)). Sunucu da müdürün maaş, kira gibi kategoriye yazmasını reddeder: kural yazım
  yolunda (`src/server/cash-outs/write.ts` › `writeCashOut`, gerçek rol), doğrudan kayıt da Onaylar'da isteğin onayı da
  ondan geçer (Onaylar'ın kategori seçicisi ve fiş fotoğrafının okuması müdüre yalnız personelin kategorilerini verir,
  `src/server/photo-read/read.ts` › `readPhotoFor`; geri almada silinen kaydınki geri gelir). **Yöneticinin
  kategorisindeki satıra** (bağlı harcama kaydı maaş, kira gibi personelin seçemediği ya da kapatılmış bir kategoride)
  müdür hiç dokunmaz: tutarını, metnini ve türünü düzeltemez, personelin kategorisine taşıyamaz, teslime çevirip kaydı
  kaldıramaz, silemez; personelin o satır için düzeltme ve silme isteğine de karar vermez (onay da ret de yöneticinin;
  kartında düğme yok, "isteğe yönetici karar verir"). Kasa'da satır ona kilitli görünür (kilit simgesi, dokununca
  "yöneticiye haber verin"). Sunucu gerçek role bakar: düzeltme `writeCashOut`, silme ve Onaylar'daki karar
  `assertOwnerRowOpen` (`src/server/cash-outs/write.ts`); hatanın sonu "düzeltmesini ve silinmesini yönetici yapar" /
  "isteğe yönetici karar verir" (`CASH_OUT_REQUEST_TEXT.ownerRow`, `ownerReview`). Onaylar'ın kasadan çıkan kartında da
  yöneticinin kategorisinin adı müdüre gitmez ("Bağlı gider: yöneticinin kategorisi"); o satırın isteğinin kartında
  satır, personelin önerisi ve değişiklikler yalnız türü ve tutarıyla, fişi ve personelin notu ("Yöneticiye not") yok;
  günün satırları arasında o satır "Harcama", fişsiz. Olası tekrar listesi ona yalnız isteğin şubesinin, personelin
  kategorisindeki kasadan çıkan satırlarını ve harcama kayıtlarını gösterir (öteki şubenin satırı, yöneticinin
  kategorisindeki satır, maaş ve kira kaydı gitmez; `src/server/data/cash-out-requests.ts` › `cashOutCards`). Fiş
  fotoğrafının okumasındaki kopya denetimi de aynı kuralla: müdürün uyarısı ayrıntılıdır (eşleşen satırın adı, tutarı,
  günü), bu yüzden yalnız şubesinin kasadan çıkanlarına ve harcama kayıtlarına, yalnız personelin kategorisindekilere
  bakar; öteki şubenin satırı, işletme geneli (şubesiz) harcama kaydı ve yöneticinin kategorisindeki satır ve kayıt
  okunmaz (`src/server/photo-read/read.ts` › `recentReceipts`).
- **İşçilik / ciro müdüre kişisel ücretsiz.** Günlük görünüm kapalı: tek kişinin çalıştığı günün işçiliği o kişinin
  günlük ücretidir. Part-time'ın Vardiya'daki günlük ücreti (ve yemek kartı) müdürün rakamlarına hiç girmez, işçiliğin
  tutarı (₺: haftalar, ay, günlerin toplamı, Gelir-gider'le farkın notu) ona gitmez; yalnız ciro ve oran. Sebep: müdür
  Vardiya'ya yazar. Hafta part-time'ın günleriyle sayılsaydı dün için tek hücre yazıp sayfayı yenileyen müdür farkta o
  kişinin günlük ücretini okurdu (geçmiş gün kimseye bildirilmez); yazmadan da tek part-time'ın gün sayısı farklı iki
  hafta aynısını verirdi. Oran × ciro tutarı verdiği için oran da aynı kuralla: müdürün oranı tam zamanlının aylık işveren
  maliyeti ve part-time'ın aylık ek ödemesi (ikisi de Vardiya'dan bağımsız) ayın günlerine eşit bölünerek, cirosu bilinen
  günlerden; ayın satırı da ayın günlerinden (Gelir-gider'in personeli Vardiya'nın günleriyle sayılır, yöneticinin).
  Rakamlar Vardiya'dan bağımsız olduğundan müdürün geçmiş güne yazması da bir şey açmaz. Kural `can(rol, "maas")`:
  `src/server/data/iscilik.ts` › `loadLaborReport` (`wages`), `src/lib/iscilik.ts` › `withoutDayWages`.
- **Genel bakış, Şube karşılaştırma, Kaçak ve Kayıp önleme müdüre açılmadı:** işletme geneli kâr, kira ve maaşı ve
  öteki şubeleri bir arada gösteriyorlar. Müdürün şube raporları: Bugün'deki şube günü ve İşçilik / ciro.
- **Muhasebeci kişi başı maaş görmez**; personel giderleri Gelir-gider'de toplam olarak durur. Personel belgeleri ona
  kapalı.
- **İki adımlı doğrulama** isteğe bağlıdır (Hesabım'dan açılır; sahibin kararı, PR #154). `ADMIN_2FA_REQUIRED=1`
  iken rakam gören her rolde (yönetici, müdür, muhasebeci; `TWO_FACTOR_ROLES`) zorunlu: kurmamış kişi girişten sonra
  kurulum ekranına gider, kurana kadar paneli kullanamaz; `ADMIN_2FA_OPTIONAL=1` acil durumda zorunluluğu kapatır
  (`src/lib/admin-security.ts` › `twoFactorRequiredFor`, metni `TWO_FACTOR_RULE_TEXT`). Personel ortak tablette
  sırayla girer; onda her zaman isteğe bağlı. Yeni cihaz uyarısı bu üç rolde, zorunluluktan bağımsız: işlem geçmişi,
  kişinin kendi adresine e-posta ve zilinin Sistem başlığı, her birinde yalnız kendi hesabının girişleri
  (`src/server/actions/notifications.ts` › `loadPanelNotifications`).
- **E-posta alıcıları** ([BILDIRIMLER.md](BILDIRIMLER.md) › Alıcılar ve hesaplar): kasa raporu, sabah e-postası ve
  muhasebeci paketi personel ve **müdür** hesabının adresine gitmez (listeler şubeler arasında ortak olabilir; kasa
  e-postası karaoke ön ödemesini, sabah e-postası işletmenin ödemelerini ve maliyetini, paket bütün şubelerin
  faturalarını, alış fiyatlarını, maaş ve kira harcamalarını taşır); **muhasebeci** hesabı alır (hesabı olmayan
  muhasebeci adresi gibi). Üç listenin üçü de aynı kapılardan geçer (`src/lib/notify-recipients.ts` ›
  `RECIPIENT_LISTS`): kaydederken müdürün adresi reddedilir, gönderimde düşer, yönetici zilde ve kartta görür; adresi
  bir listede kalan müdür (kayıttan sonra müdüre indirilen yönetici) Hesabım'da giriş e-postasını değiştiremez. Yoksa
  eski kutusu hiçbir hesabın olmaz, gönderim onu hesabı olmayan muhasebeci adresi sayıp yeniden gönderirdi
  (`src/server/notify/recipients.ts` › `listsWithEmail`; `src/server/actions/auth.ts` › `updateProfile`).
- **Şube kurulumu e-postası** müdür ya da muhasebeci hesabının adresi olamaz (yöneticininki ve öteki şubenin
  personelininki de; `src/lib/branches.ts` › `branchEmailTaken`, `createBranch` ve `sendBranchInstall`): kurulum
  bağlantısı o adrese gider ve kasanın eşitleme anahtarını verir. Yalnız şubesiz ya da aynı şubedeki personel hesabı
  şubenin panel hesabı sayılır ([ASILPOS.md](ASILPOS.md) › Şube kurulumu). **Hesabım › AsilPOS kurulumu** kartını ve
  içindeki indirme bağlantısını da yalnız o hesap görür (bağlantının gittiği adres, şubeye kilitli personel;
  `src/lib/asilpos/kurulum.ts` › `isBranchAccount`, `src/server/asilpos/kurulum.ts` › `installForAccount`): şubenin öbür
  personeli, müdürü, muhasebeci ve yönetici görmez.
- **Saha kitleleri:** vardiya planının kişileri, kontrol listesi ve karaoke uyarılarının personel alıcıları müdür ve
  personel (`SHIFT_ROLES`); muhasebeci sahada değil.
- **Panel asistanı** yalnız yöneticinin (müdür ve muhasebeci "staff" düzeyinde reddedilir).

## Veritabanı

`users.role` text; göç `drizzle/0097_roller.sql`:

- `users_role_ck`: `role in ('admin','manager','staff','accountant')`;
- `users_manager_branch_ck`: müdürde `branch_id` boş olamaz.

## Testler

- `tests/muhasebeci-salt-okunur.test.ts`: muhasebecinin ekranlarının istemci bileşenleri iki rolle çizilir (HTML);
  muhasebecide yazma düğmesi ve açamayacağı ekrana bağlantı yok, yöneticide aynı düğmeler duruyor.
  `tests/muhasebeci-ekran-db.test.ts` (gerçek Postgres, `MUHASEBECI_EKRAN_TEST_DATABASE_URL`): Faturalar, Gelir-gider,
  Aylık harcamalar ve Kasa raporu muhasebecinin oturumuyla çağrılır; ağaçta kapalı ekrana bağlantı, şube atama kutusu
  ve raporu olmayan günün formu yok.
- `tests/yukleme-iskeleti-rol.test.ts`: yönetici dışında bir rolün açabildiği her sayfanın yükleme iskeletindeki her
  bağlantıyı o roller açabilir (bütün sayfalar taranır).
- `tests/kapali-sube-mudur-bildirim-db.test.ts` (gerçek Postgres, `KAPALI_SUBE_TEST_DATABASE_URL`): şubesi kapanan
  müdüre Web Push (bütün konular), hatırlatıcı özeti ve vardiya bildirimi gitmez; personeli ve öbür müdür alır.
- `tests/roller.test.ts`: her rolün ekranları ve yetenekleri; menüdeki her öğe ↔ rol kuralı; proxy yönlendirmesi (her
  rol için birkaç yol); yetki tablosu; iki adımlı ve e-posta kuralları; **kaynak taraması**: her `"use server"`
  dosyasının dışa verdiği her eylem bir kapı çağırır (`tests/helpers/action-gates.ts`) ve hiçbiri muhasebeciye yazma
  izni vermez.
- `tests/gelir-gider-kisi-db.test.ts` (gerçek Postgres, `GELIR_GIDER_KISI_TEST_DATABASE_URL`; sayfanın kendisi oturumla):
  muhasebecinin Gelir-gider sayfasının hiçbir prop'unda part-time'ın adı, günlük ücreti ve eki ve bağlantısız kişinin
  adı yok, personel satırlarının tutarları yöneticininkiyle aynı; yöneticide aynı hücre kişi kişi. Motorun iki metni
  `tests/personel-part-time.test.ts` ve `tests/personel-asilpos.test.ts`'te.
- `tests/foto-tarama-db.test.ts` (gerçek Postgres, `FOTO_TARAMA_TEST_DATABASE_URL`): muhasebecinin köşe ipucu isteği
  uçta ve çekirdekte "salt okunur" döner; yapay zekâya istek gitmez, `ai_calls`'a satır düşmez.
- `tests/roller-db.test.ts` (gerçek Postgres, `ROLLER_TEST_DATABASE_URL`): kısıtlar; müdür öteki şubeyi okuyamaz, öteki
  şubenin isteğine karar veremez, öteki şubeye yazamaz, yöneticinin kategorisindeki kasadan çıkanı düzeltemez,
  taşıyamaz, silemez (`tests/kasa-cikan-istek-db.test.ts`: o satırın isteğine de karar veremez), o satırın yeri,
  açıklaması ve fişi ona gitmez (Kasa'nın gün ve ay görünümü, WhatsApp metni, fiş fotoğrafı; Onaylar'ın kartı
  `tests/kasa-cikan-istek-db.test.ts`), fiş okumasının kopya denetimi ona öteki şubenin, işletme genelinin ve
  yöneticinin kategorisinin kayıtlarını okumaz, Vardiya planına öteki şubenin personelini, muhasebeciyi ya da olmayan
  hesabı yazamaz (Kaydet ve Yazarak doldur; hata hesabın adını taşımaz, Vardiya ekranında o adlar yok; şubesinin
  planındaki kişiyi yazar), Onaylar kartının gösterdiği, isteğin tuttuğu fotoğrafı (geç raporun Z'si, kasadan çıkan
  isteğinin fişi) açar, öteki şubeninkini, kapatılmış kategorideki önerinin fişini açamaz (personel ve muhasebeci de
  açamaz; karardan sonra türün kuralı), şubesi pasifken oturumu yok; muhasebecide **bütün** sunucu eylemleri
  "salt okunur" döner ve veritabanının hiçbir tablosu değişmez; şube kurulumu e-postası müdür, muhasebeci, yönetici ya
  da öteki şubenin personeli olamaz (şube kaydı, şubenin e-postası ve kurulum bağlantısı yazılmaz).
- `tests/bildirim-alicilari-db.test.ts` (gerçek Postgres, `BILDIRIM_TEST_DATABASE_URL`): muhasebeci paketinin
  alıcılarına müdür, personel ya da pasif hesabın adresi kaydedilmez; alıcıyken müdüre indirilen hesap için Kullanıcılar
  uyarır, zil söyler, müdür giriş e-postasını değiştiremez, personel giriş e-postasını paketteki adrese çeviremez,
  "Şimdi gönder" yalnız muhasebeciye gider.
- `tests/iscilik-mudur-db.test.ts` (gerçek Postgres, `ISCILIK_TEST_DATABASE_URL`): müdürün İşçilik raporunda tutar ve
  günlük satır yok; dün için Vardiya'ya yazdığı ve sildiği part-time hücresinden önce ve sonra raporu birebir aynı
  (yöneticininkinde aynı hücre tam günlük ücret).

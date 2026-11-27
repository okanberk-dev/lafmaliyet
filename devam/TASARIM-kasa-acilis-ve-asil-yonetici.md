# Tasarım: gerçek açılışta ladmin girişi ve şube seçimi; asıl yöneticinin şube açma / kasa kurma yetkisi

Sahibin isteği (28 Kasım 2026): "AsilPOS'ta gerçek açılışta önce ladmin kullanıcı adı ve şifre sorulsun; tıklayınca hangi
şubenin açılacağı söylensin; şube zaten kuruluysa 'zaten kurulu, emin misin' densin ya da başka şube açılsın. Aşamaları
sen geliştir, önerdiğin gibi yap. ladmin'de de asıl yöneticinin şube açma / kurma yetkisini baştan aşağı kurgula,
hatalıysa düzelt."

Üç PR, bu sırayla: **P-B1** (panel: yetki), **P-B2** (panel: açılış API'si), **K5** (kasa: açılış akışı).
Hiçbirinde veritabanı göçü YOK (yeni veri `integration_state` JSON'ında ve imzalı kısa ömürlü belirteçte durur).

## Bugünkü durum (inceleme, dosya:satır)

Kasa (lafpos):
- Deneme modu `server/lib/settings.ts:224` `trainingMode`; `liveSince` yazılınca gerçek kullanım başlar. Gerçek açılış:
  `POST /api/admin/deneme/bitir` (`server/routes/admin.ts:1567-1593`; patron + PIN, yedek, `finishDeneme` /
  `finalizeLive` `server/services/deneme.ts`). Arayüz: `src/components/admin/DenemeCard.tsx` (`FinishDialog`),
  `AppShell.tsx:541-569` şeritleri ("Denemeyi bitir", "Geçişi tamamla"). Bugün internetsiz çalışır, panele hiçbir şey gitmez.
- Şubeye bağlanma yalnız kurulum koduyla: `server/sync/kurulum-kodu.ts` (`redeemInstallCode` → `POST {adres}/api/asilpos/kurulum`
  imzasız `{kod, surum}`; yanıt `readRedeemAnswer`: `{ok, sube:{id,ad}, baglanti}`; `apply` ayar dosyasına yazar, bekçi
  sunucuyu yeniden başlatır, `branchId` yazılır; şube kilidi `branchLocked()`).
- Kasa kimliği: `settings.branchId`; Merkez kurulum kimliği `sync_state merkez.kimlik` (ladmin görmez).
- Panele bütün çağrılar şube anahtarıyla imzalı (`server/lib/signature.ts`, `x-laf-timestamp` + `x-laf-signature`).
  Kullanıcı adı/şifreyle panele giden hiçbir çağrı yok.

Panel (lafmaliyet):
- Kasa uçları: `src/server/asilpos/kurulum-route.ts` (imzasız kod), `src/server/asilpos/branch.ts` (`resolvePosCaller`:
  şube, imzası tutan anahtardan), `kurulum.ts` (`issueInstallCode`, `redeemInstallCode`, `ensurePosKey`).
- "Asıl yönetici": `src/lib/asilpos/kurulum.ts:11-23` `isAnaAdmin` = rol admin + e-posta `LADMIN_ANA_ADMIN` (varsayılan
  koddaki adres); `requireAnaAdmin()` `src/server/auth/dal.ts:194`. Yalnız `createBranch` ve `sendBranchInstall` bakıyor.
- Giriş: `src/server/actions/auth.ts` (`loginAction`, çerezli Server Action; kilit yardımcıları dosyaya özel),
  `src/server/auth/password.ts` (scrypt), `rate-limit.ts`, `login-locks.ts`, `totp.ts`, `step-up.ts`, `new-device.ts`.
- Kayıt: `logActivity` (`src/server/actions/log.ts`); e-posta `src/server/notify/resend.ts`.

Bulunan boşluklar:
1. Asıl yönetici bir e-posta dizgisi ve HERHANGİ bir yönetici onu değiştirebiliyor: `saveUser`
   (`src/server/actions/settings.ts:261`), `setUserActive` (:346), `deleteUser` (:448), `resetUserTwoFactor` (:487) asıl
   yöneticinin hesabında da çalışıyor; `updateProfile` (`auth.ts:371-402`) bir yöneticinin kendi e-postasını boşta kalan
   asıl yönetici adresine çevirmesine izin veriyor.
2. Tutarsızlık: şube açmak ve kurulum göndermek asıl yöneticide; ama AsilPOS'u açmak (posSource), şubeyi kapatmak
   (`updateBranch`), silmek (`deleteBranch`), kasa anahtarını döndürmek/silmek (`saveAsilposSecret`), geçiş gününü
   değiştirmek (`saveAsilposSwitchDay`) her yöneticide.
3. Kapatılan şubenin bekleyen kurulum kodu geçerli kalıyor; `redeemInstallCode` şubenin açık olduğuna bakmıyor.
4. Kasası olan şubeye ikinci kurulum aynı anahtarı veriyor, hiçbir yerde "zaten kurulu" uyarısı yok; panel makineleri
   ayırt edemiyor (kurulumda makine kimliği tutulmuyor).
5. (Dokunulmayacak, rapora yazılacak) Kapalı şubenin kasa anahtarı imza doğrulamasında hâlâ geçerli
   (`branch.ts:60`, `{ closed: true }`): bilerek öyle görünüyor (kapanan şubenin son günleri gelsin).

## P-B1 (panel): asıl yönetici, şube açma ve kasa kurma

Kural: **şubeyi açmak, kapatmak, silmek ve kasasını kurmak asıl yöneticinindir.** Öteki yöneticiler şubenin ayrıntısını
(ad, sıra, POS oranı, özellikler, e-posta) düzenler.

- Tek yerde tanım: `src/lib/roles.ts`'e (ya da `src/lib/asilpos/kurulum.ts` yanına) "şube kurulumu" işlemlerinin listesi
  ve tek denetim (`requireAnaAdmin`). Asıl yönetici isteyen işlemler:
  `createBranch`, `sendBranchInstall` (zaten), `deleteBranch`, `updateBranch` içinde yalnız şu değişiklikler:
  `active` (kapatma / yeniden açma) ve `posSource` (kasa programı); `saveAsilposSecret` (anahtar döndürme / silme),
  `saveAsilposSwitchDay`. Bunlar dışındaki alanlar her yöneticide kalır. Reddedilen işlem açık bir cümleyle döner
  ("Bu işlemi yalnız asıl yönetici yapar: …").
- Arayüz: asıl yönetici olmayan yöneticiye bu düğmeler görünmez / devre dışı ve nedenini söyler (Ayarlar › Şubeler,
  şube düzenleme penceresi, Ayarlar › AsilPOS (kasa) kartı). Arayüz ile eylem aynı denetimi kullanır.
- Asıl yöneticinin hesabı korunur: başka yönetici onun e-postasını, parolasını, rolünü, etkinliğini değiştiremez,
  silemez, iki adımlısını sıfırlayamaz (`saveUser`, `setUserActive`, `deleteUser`, `resetUserTwoFactor`). Hiç kimse
  (asıl yönetici dışında) e-postasını asıl yönetici adresine çeviremez (`saveUser`, `updateProfile`, kullanıcı
  ekleme / davet). Asıl yönetici kendi e-postasını Hesabım'dan değiştiremez: adres `LADMIN_ANA_ADMIN` ile tanımlıdır,
  ekran bunu söyler (değişirse yetkisini kaybederdi).
- Şube kapatılınca o şubenin bekleyen kurulum kodları iptal edilir; `redeemInstallCode` kapalı şubenin kodunu reddeder.
- "Kurulum bağlantısı gönder": şubede kullanılan bir kasa varsa (aşağıdaki `kasaDurumu`) önce onay ister: "Bu şubede
  kurulu bir kasa var (son gün …). Yeni kurulum eski kasanın yerine geçer."
- Kullanıcılar & roller ekranında asıl yönetici satırı etiketli ("Asıl yönetici").
- Belgeler: docs/ROLLER.md (yeni bölüm "Asıl yönetici"), docs/SUBE.md, docs/ASILPOS.md; YAPILACAKLAR.md, DEVAM.md;
  `npm run asistan:bilgi`. Testler: her işlem için "asıl yönetici geçer, öteki yönetici reddedilir, müdür/muhasebeci/
  personel reddedilir"; hesap koruması; kod iptali.

## P-B2 (panel): kasa açılışı API'si

Ortak yardımcı `kasaDurumu(branchId)`: `{ durum: 'bos' | 'kurulu', sonGun, sonGorulme, kimlik }`. Kaynaklar: yeni kayıt
`integration_state` anahtarı `asilpos.kasa:<şube>` (`{kimlik, surum, at, by, yol: 'acilis' | 'kod'}`), yoksa
`asilposInUse(branchId)`, son kabul edilen gün, kullanılmış kurulum kodu. Göç yok.

1. `POST /api/asilpos/acilis/giris` — gövde `{eposta, parola, kod?, kasa: {kimlik, surum, sube?}}`.
   - Panelin giriş korumaları AYNEN: IP sınırı, hesap kilidi (5 hata / 15 dk), bilinmeyen e-postada sahte bekleme,
     iki adımlı (TOTP ya da kurtarma kodu; hesabında açıksa ya da `ADMIN_2FA_REQUIRED=1` ise zorunlu → yanıt
     `{ok:false, ikiAdim:true}`), tekrar koruması. Bunun için `actions/auth.ts`'teki dosyaya özel yardımcılar ortak bir
     modüle çıkarılır (davranış değişmez, mevcut giriş testleri aynı kalır).
   - Yalnız **asıl yönetici** geçer. Başka hesapta: 403 "Kasayı yalnız asıl yönetici açar".
   - Çerez YOK, oturum açılmaz. Yanıt: `{ok, kisi:{ad}, belirtec, subeler:[{id, ad, kasa:{durum, sonGun, sonGorulme},
     buKasa}]}`. `belirtec`: `jose` ile imzalı, amaç `kasa-acilis`, 15 dakika, kullanıcının `sessionVersion`'ı içinde.
     `subeler`: açık, fiziksel ve `posSource = asilpos` olan şubeler (ModPOS şubesi listede "kasası AsilPOS değil"
     notuyla, seçilemez). `buKasa`: istek o şubenin anahtarıyla da imzalıysa (kasa zaten o şubeye bağlı) ya da kayıtlı
     `kimlik` aynıysa true.
   - İşlem geçmişi: "Kasa açılışı için giriş" (başarılı / reddedildi); yeni cihaz e-postası kuralı girişle aynı.
2. `POST /api/asilpos/acilis/bagla` — gövde `{belirtec, sube, devral?, kasa:{kimlik, surum}}`.
   - Belirteç ve kullanıcı yeniden doğrulanır (etkin, hâlâ asıl yönetici, `sessionVersion` aynı).
   - Şube açık + fiziksel + asilpos değilse 409 (açık cümle).
   - Şubede başka bir kasa kuruluysa (`kasaDurumu.durum === 'kurulu'` ve `buKasa` değil) ve `devral` yoksa:
     409 `{error:'zaten_kurulu', sube, kasa:{sonGun, sonGorulme}}`. `devral: true` ise şubenin anahtarı DÖNDÜRÜLÜR
     (eski kasa panelle bağlantısını kaybeder), bekleyen kurulum kodları iptal edilir.
   - Yanıt, kurulum kodunun yanıtıyla AYNI biçimde: `{ok, sube:{id,ad}, baglanti:{…}}` (`kurulumBaglantilari`; eski
     `LAFPOS_CLOUD_*` adları dahil), kasa var olan `readRedeemAnswer` + `apply` ile işler.
   - `asilpos.kasa:<şube>` kaydı yazılır; işlem geçmişi ("Kasa şubeye bağlandı: Marina · devralındı"); asıl yöneticiye
     e-posta ("Marina kasası yeni bir bilgisayara bağlandı").
   - Kurulum kodu yolu (`redeemInstallCode`) da artık `asilpos.kasa:<şube>` kaydını yazar (`yol: 'kod'`, kasa `kimlik`
     gönderiyorsa onunla); eski kasalar `kimlik` göndermez, kayıt yine yazılır.
   - Var olan uçların yolu, gövdesi ve imzası DEĞİŞMEZ.
3. Testler (veritabanlı): yanlış parola ve kilit, iki adımlı, asıl yönetici olmayan yönetici, süresi geçmiş / başka
   amaçlı belirteç, kapalı ve ModPOS şubesi, `zaten_kurulu` → `devral` (anahtar döner, eski anahtar 401), `buKasa`
   (anahtar dönmez), yanıtın biçimi kurulum koduyla aynı, parola hiçbir kayda yazılmaz.

## K5 (kasa): açılış akışı

- Sunucu `server/sync/ladmin-acilis.ts`: `giris(adres, eposta, parola, kod?)` ve `bagla(sube, devral)`. Parola ve
  belirteç yalnız bellekte (kasa oturumuna bağlı, 15 dk), günlüğe / denetim kaydına / sync_state'e YAZILMAZ. Adres:
  `LAFMALIYET_URL`, yoksa `kurulum-kodu.json`'daki `adres`, yoksa ekrandan girilir (https; yerelde http).
  Kasanın kimliği: `merkez.kimlik.id`, yoksa bir kez üretilen `kasa.kimlik` (sync_state). Kasa bir şubeye bağlıysa istek
  o anahtarla da imzalanır (panel "bu kasa" diyebilsin).
- Uçlar (patron, PIN kilidi kurallarıyla): `GET /api/admin/acilis` (durum: bağlı şube, doğrulama zamanı, adres),
  `POST /api/admin/acilis/giris`, `POST /api/admin/acilis/bagla`. Başarılı bağlanınca `acilis.dogrulama` yazılır
  (`{sube:{id,ad}, at, kisi}`), bağlantı `apply` ile işlenir (ayar dosyası değişirse bekçi sunucuyu yeniden başlatır).
- Gerçek açılış (`POST /admin/deneme/bitir`) artık doğrulanmış şube ister: `acilis.dogrulama` yoksa 409
  `ladmin_gerekli`. İstisna: panele ağ yüzünden ulaşılamıyorsa (kimlik hatası değil) patron "İnternet yok: ladmin
  girişini sonraya bırak" diyebilir; açılış sürer, `acilis.dogrulama = {bekliyor:true}` yazılır ve kabukta
  "ladmin doğrulaması bekliyor" şeridi kalır (bugünkü internetsiz açılış kaybolmasın: uyumluluk).
- Arayüz (`FinishDialog` üç adım; `DESIGN.md`, 44 px, Türkçe):
  1. **ladmin girişi**: e-posta, parola, gerekirse iki adımlı kod. "Yalnız asıl yönetici açar."
  2. **Hangi şube**: liste (ad, "Kasa kurulu değil" / "Kasa kurulu · son gün 27 Kas" / "Bu kasa"). Seçilen şubede başka
     kasa varsa onay: "Marina'da zaten kurulu bir kasa var. Bu bilgisayar onun yerine geçsin mi? Eski kasa ladmin
     bağlantısını kaybeder." [Evet, bu kasa geçsin] [Başka şube seç]. Bağlanınca "Marina açılacak" özeti.
  3. **PIN ve açılış** (bugünkü adım): şubenin adı başlıkta.
  Sunucu yeniden başlarsa pencere kaldığı adımdan sürer (doğrulama sync_state'te).
- Yönetim › Bağlantı bilgileri › Kurulum kartına "ladmin hesabıyla bağla" (aynı 1–2. adım; kod gerekmeden yeniden
  bağlama).
- Testler: sahte panelle uçtan uca (giriş, iki adımlı, zaten kurulu → devral, ağ hatasında sonraya bırakma, parolanın
  hiçbir kayda düşmediği), `e2e/run.mjs` `ROUTES`, belgeler (docs/03-ENTEGRASYON.md, docs/05-KASA-BILGISAYARI.md,
  KALANLAR.md).

## Kararlar (sahibe raporda söylenecek; isterse sıkılaştırılır)
- Kasayı açılışta yalnız asıl yönetici bağlar.
- Devralmada eski kasanın anahtarı döner (iki kasa aynı şubeye yazmasın); onay cümlesi bunu açıkça söyler.
- İnternet yokken açılış engellenmez; doğrulama bekler ve ekranda hatırlatılır.
- Yeni şube kasadan açılmaz: ladmin › Ayarlar › Şubeler'den açılır, kasada listede görünür.
- Asıl yönetici e-postayla tanımlı kalır (göç yok); hesabı öteki yöneticilere karşı kilitlenir.

# Tasarım: Yönetim konsolu (yonetim.laffogato.net)

Sahibin isteği (28 Kasım 2026): "Yeni şube ekleme gibi kısımlar için bir alt alan adı aç, yonetim.laffogato.net; oradan
yönetilsin, ladmin'i hiç karıştırmayalım. Lisans tarzı işler de oradan dönsün. info@nextgenlab.com.tr yönetici de
oluşturabilsin. Öbür sistemde olmaması, burada olması gerekenleri ayarla. Kurguyu dikkatli yap, tekrar incele, görevlere
ayır."

Bu belge ikinci sürümdür: ilk sürüm iki bağımsız incelemeyle koda karşı sınandı (28 Kasım; raporlar Mac'te
`~/Downloads/lafmaliyet-ekler/konsol-inceleme/`). Değişenler "İncelemenin değiştirdikleri"nde.

## Karar

Üçüncü bir sistem kurulmaz. Yönetim konsolu, panelin (bu depo) aynı veritabanı üstünde ayrı bir kapısıdır: ayrı alan
adı, ayrı oturum, ayrı sade kabuk, yalnız asıl yönetici. Şubeler ve kasa anahtarları yerinde kalır (kasa gün sonunu o
anahtarla gönderir); canlıdaki Marina'da hiçbir şey değişmez. Lisans, dükkân listesi ve güncelleme gönderme AsilPOS
Merkez'de kalır (kasa deposu, `/merkez`; ayrı üyelik); konsol oraya bağlantı verir. Arayüzdeki ad: **Yönetim konsolu**
(panelin kendi adında ve kasada da "Yönetim" geçtiği için tek başına "Yönetim" denmez).

## Kim girer, oturum nasıl ayrılır

- Yalnız asıl yönetici (`docs/ROLLER.md` › Asıl yönetici). Canlı veri kopyasında (26 Kasım) hesap var, yönetici ve
  etkin; toplam iki yönetici var; sahip 28 Kasım'da giriş yapabildiğini doğruladı.
- **Konsolun kendi oturumu vardır:** ayrı çerez ve ayrı belirteç türü. Panel oturumu konsolu, konsol oturumu paneli
  açmaz (çerez zaten alan adına bağlıdır; belirteç türü de ayrılır ki biri öbürünün yerine sunulamasın).
- **Konsolun kendi giriş eylemi vardır.** Asıl yöneticinin adresi dışındaki her e-posta, parolaya bakılmadan, kayıtlı
  olmayan e-posta gibi yanıtlanır: aynı süre, aynı söz ("E-posta ya da parola hatalı"), o hesabın kilit sayacına
  dokunulmaz, oturum açılmaz, e-posta gitmez. "Bu adres yalnız asıl yöneticinin" sayfada sabit metindir.
- Her konsol sayfası ve konsoldan çağrılan her eylem `requireYonetim` ister (hesap etkin, oturum sürümü aynı, yönetici,
  asıl yönetici). Reddedilen oturumun çerezi silinir (yönlendirme döngüsü olmasın: ör. `LADMIN_ANA_ADMIN` değişince).
- Giriş korumaları panelinkiyle aynı (hesap kilidi, IP sınırı, iki adımlı doğrulama, yeni cihaz e-postası). Bilinen
  cihaz çerezi alan adına bağlı olduğu için konsola ilk girişte "yeni cihaz" e-postası gider; giriş sayfası bunu söyler.
- Parola sıfırlama, davet ve kurulum bağlantıları her zaman panelin adresini (`APP_URL`) taşır; konsol bağlantıyı isteğin
  geldiği adresten kurmaz (kasa kurulum bağlantısı konsolu göstermesin).

## Ne nerede

| İş | Konsoldan sonra |
|---|---|
| Şube açma, kapatma, yeniden açma, silme; şubenin türü ve kasa programı | Konsol › Şubeler ve kasalar |
| AsilPOS'a geçiş günü; kasa anahtarını döndürme ve silme, eski anahtarı silme | Konsol › Şubeler ve kasalar |
| "Bilgisayara kur", ilk personel (patron, müdür, barista PIN'i), "Kasayı serbest bırak", kasa durumu | Konsol › Şubeler ve kasalar |
| Yönetici hesapları: açma, yöneticilik verme ve alma, kapatma, silme, iki adımlıyı sıfırlama, kilit açma, oturum kapatma, giriş bağlantısı | Konsol › Yöneticiler |
| Lisans, dükkânlar, güncelleme gönderme | Konsol › Lisans ve güncelleme (Merkez'e bağlantı ve açıklama) |
| Şubenin adı, sırası, POS oranı, özellikleri, e-postası | ladmin › Şubeler (değişmez) |
| Müdür, muhasebeci ve personel hesapları | ladmin › Kullanıcılar (değişmez) |
| Yedek indirme, işlem geçmişi, ModPOS ve Paraşüt ayarları, e-posta, hata kaydı, AsilPOS gün sonunu silme | ladmin (değişmez) |
| Herkesin kendi hesabı (parola, e-posta, iki adımlı, oturumlar) | ladmin › Hesabım (değişmez) |

ladmin'de taşınan düğmelerin yerinde salt okunur durum ve tek cümle kalır: "Bu iş Yönetim konsolunda yapılır". Menüden
ve komut paletinden "Şube ekleme" kalkar; `/panel/sube-ekleme` konsola yönlenir. Kullanıcılar'da yönetici satırları
herkese salt okunurdur.

## Yeni kural: yönetici hesapları

Bir yönetici hesabına dokunan iş (önceki ya da sonraki rol yöneticiyse: hesap açma, rol, erişim, e-posta ve parola
değişikliği, silme, iki adımlıyı sıfırlama, kilit açma, oturum kapatma, giriş bağlantısı) yalnız asıl yöneticinindir ve
konsolda yapılır. Öteki yöneticiler müdür, muhasebeci ve personel hesaplarını bugünkü gibi yönetir, başka yöneticinin
yalnız adını değiştirebilir, kendi hesaplarını Hesabım'dan yönetir. Son yönetici kuralı aynen kalır. Ret, parola
sorusundan önce gelir. "Asıl yönetici hesabı yoksa bir yönetici açabilir" istisnası kapanır (hesap var).

**Kurtarma (asıl yönetici kilitlenirse):** hesap kilidi 15 dakikada kendiliğinden kalkar; parola "Parolamı unuttum" ile
e-postadan sıfırlanır; iki adımlı açıksa sekiz kurtarma kodu vardır. Hepsi kaybolursa yalnız yazılımcının çalıştırdığı
`scripts/asil-yonetici-kurtar.ts` iki adımlıyı sıfırlar, oturumları kapatır ve işlem geçmişine yazar (adımlar
`docs/DEPLOY.md`'de). Konsol kalan kurtarma kodu sayısını gösterir.

## Teknik çerçeve

- Aynı Next.js uygulaması ve Vercel projesi. Ortam: `YONETIM_URL` (varsayılan `https://yonetim.laffogato.net`). Adres
  türü ve izin listesi tek saf dosyada (`src/lib/yonetim-host.ts`), testli.
- **Panel adresinde hiçbir şey değişmez:** proxy'nin bugünkü kapsamı aynen kalır (kasanın çağırdığı `/api/pos/gun`,
  `/api/asilpos/*`, `/api/panel/pos/*` ve zamanlanmış işler proxy'ye girmez; bunu sabitleyen testler yeşil kalır).
  Konsol kuralları yalnız konsol alan adına bağlı eşleşmelerle (`has: host`) eklenir.
- **Konsol adresinde yalnız izin listesi açılır:** `/yonetim/*`, konsol girişi ve iki adımlı adımı, çıkış, `/_next/*`,
  simgeler, `robots.txt`, CSP raporu ve hata bildirimi. Kök adres `/yonetim`'e gider. `/panel/*` konsola yönlenir.
  `/api/*`, kasa kurucusunun indirme yolları (yeni ve eski adlı), `/davet`, `/baglan`, `/menu`, OAuth ve manifest 404 döner; `/api/*` gövdesi
  `{error:"yanlis_adres"}` (kasa yanlışlıkla konsol adresine ayarlanırsa anlaşılır hata alsın).
- Yerelde ve önizlemede (konsol adresi yokken) `/yonetim` doğrudan açılır; yerel deneme adresi `yonetim.localhost`.
- Konsol kabuğu panelin kabuğunu miras almaz (kenar çubuğu, zil, arama, asistan yok): başlık, üç sekme, çıkış,
  "ladmin'e git" ve "Hesabım (ladmin)" bağlantıları. Ayrı Hesabım yok.
- `updateBranch`'te açık / kapalı durumu, kasa programı ve tür isteğe bağlı olur (verilmezse eskisi kalır); ladmin'in
  düzenleme penceresi bunları göndermez (konsolda kapatılan şubeyi ladmin'deki ad düzenlemesi yeniden açmasın).
- Kasaya giden metinler adres yazmaz: "değiştirmek için Yönetim konsolu". Kasa, panel adresi olarak konsol adresini
  kabul etmez (ayrı kasa PR'ı).
- Göç yok.

## Görevler (her biri ayrı PR; her PR tek başına canlıya çıkabilir ve ladmin'i bozmaz)

Önkoşul: P-B2 (dal `kasa-acilis-uclari`) main'de. O PR giriş korumalarını ortak modüle çıkarıyor ve Şube ekleme
sayfasına ilk personeli ve "Kasayı serbest bırak"ı ekliyor.

1. **K-A: konsol oturumu, alan adı kuralı, kabuk ve Şubeler ve kasalar.** `yonetim-host.ts`, konsol belirteci ve çerezi,
   `requireYonetim`, konsol giriş eylemi ve sayfası (iki adımlı dahil), alan adı kuralları, kabuk; Şubeler ve kasalar
   sekmesi (Şube ekleme'nin P-B2'li hâli burada da çalışır; kapatma / açma / silme, tür ve kasa programı, geçiş günü,
   kasa anahtarı); Lisans ve güncelleme sekmesi (Merkez bağlantısı, açıklama, kasa durumu özeti). **ladmin değişmez**:
   bu aşamada asıl yönetici işleri iki yerden de yapılabilir. Testler: adres ve izin matrisi; konsolda `/api/pos/gun`
   404, panelde proxy'ye girmediği; iki oturum türünün birbirini reddi; asıl yönetici dışındaki e-postada aynı yanıt ve
   kilit sayacının değişmediği; `LADMIN_ANA_ADMIN` değişince döngü olmadığı; Marina'nın anahtarının değişmediği.
2. **Canlı adım:** K-A canlıya çıkar, sonra alan adı Vercel projesine eklenir (önce kod, sonra alan adı: tersi olursa
   konsol adresi tam paneli sunardı). Konsolda giriş, yanlış hesap, iki adımlı, çıkış, üç sekme ve `/api/pos/gun` 404
   denenir; Marina'nın bağlantı sorgusu 200 kalır.
3. **K-B: yönetici hesapları kuralı ve Yöneticiler sekmesi.** Kullanıcı eylemlerine yönetici rolü denetimi (ret parola
   sorusundan önce); konsolda küçük bir yönetici listesi (aç, yöneticilik ver / al, kapat, sil, iki adımlıyı sıfırla,
   kilit aç, oturumları kapat, giriş bağlantısı); ladmin'de yönetici satırları salt okunur ve "Yönetici" rolü seçeneği
   kapalı; kurtarma betiği ve `docs/DEPLOY.md`; kalan kurtarma kodu sayısı. Kırılacağı bilinen testler düzeltilir
   (`hesap-yetki-db`, `bildirim-alicilari-db`).
4. **K-C: ladmin'den ayırma.** Asıl yönetici eylemleri yalnız konsol oturumunu kabul eder (`requireYonetim`); ladmin'de
   düğmeler yerine salt okunur durum ve not; menü, komut paleti, yardım, asistan kılavuzu, belgeler; `/panel/sube-ekleme`
   yönlendirmesi; `updateBranch` alanları isteğe bağlı; kasaya giden metinler. Konsol canlıda denenmeden bu PR birleşmez.
5. **Kasa (ayrı depo):** panel adresi olarak konsol adresinin reddi; açılış akışının metinleri (kasa K5 PR'ıyla).
6. **Sonra, ayrı iş:** Merkez'in lisans ve güncelleme ekranlarını konsolda tek ekrana almak; yeni cihaz e-postasında
   adresin adı; konsolda "Oturumlar" bölümü.

## İncelemenin değiştirdikleri (ilk sürüme göre)

- Konsol artık ayrı oturum türü ve ayrı giriş eylemi taşır; ilk sürümde yalnız alan adına güveniliyordu ve panel
  oturumu konsol eylemlerini çağırabilirdi.
- Yanlış hesapla girişte "yalnız asıl yönetici" yanıtı parolanın doğru olduğunu ele verirdi; artık her yabancı e-posta
  aynı yanıtı alır.
- Proxy'nin kapsamını genişletmek kasanın uçlarını 401'e düşürürdü; kurallar yalnız konsol alan adına bağlanır.
- Kasa anahtarının yeri düzeltildi (Şubeler › şube › AsilPOS bağlantısı kartı); eski anahtarı silme, tür alanı ve komut
  paleti tabloya girdi.
- Kurtarma yolu ve "adres boşsa" istisnasının kapanması eklendi.
- Tek büyük PR yerine sıra: önce konsol (ladmin değişmeden), canlı deneme, sonra kural, en son ladmin'den ayırma.

## Sahibe sorulacaklar (iş bunları beklemez; varsayılanla ilerler)

1. Asıl yönetici için iki adımlı doğrulama zorunlu olsun mu? Bugün hesapta kapalı. Varsayılan: zorunlu değil, konsol önerir.
2. Tam yedeği indirmek her yöneticide mi kalsın, yalnız asıl yöneticiye mi geçsin? Varsayılan: kalsın.
3. Şubenin e-postası ladmin'de her yöneticide mi kalsın, konsola mı alınsın? Varsayılan: kalsın.
4. info@nextgenlab.com.tr ileride değişebilir mi? Değişecekse konsola onaylı adres değiştirme eklenir. Varsayılan: değişmez.

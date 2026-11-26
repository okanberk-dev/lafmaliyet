# Paraşüt entegrasyonu

Panel, Paraşüt'e **gelen e-faturaları** (Paraşüt'te "içeri al" yapılmamış olanlar dahil) ve **gider faturalarını**
(purchase bills) her sabah 07:00–08:00 arasında kendisi alır ve hesaplara katar: Faturalar, Gelir-gider (mal
alışları, komisyonlar), Genel bakış, Tutarlılık (alınan miktar) ve hammadde fiyatları. Her faturanın e-fatura PDF'i
panelde açılır ve indirilir.
Ekran: **Ayarlar › Paraşüt entegrasyonu** (`/panel/parasut`).

## 1. Kurulum (bir kez)

Panel Paraşüt'e kullanıcı adı ve parolayla girmez: istemci Paraşüt **DevHub**'dan alınır ve hesap bir kez panelden
**“Paraşüt hesabını bağla”** ile bağlanır (OAuth 2.0 Authorization Code + PKCE).

### Sahibin yapacakları (yazılımcı gerekmez, yaklaşık 15 dakika)

Adımlar bilgisayardan, tek oturuşta yapılır; 5. ve 6. adımın arasını uzatmayın.

1. **DevHub'da uygulama açın.** Paraşüt'ün geliştirici sitesi **DevHub**'a kendi Paraşüt hesabınızla girin.
   *“Paraşüt Kullanıcısıyım”* seçeneğiyle başvurun (kendi firmamız için; *“İş Ortağı Olmak İstiyorum”* değil).
   Uygulama hemen oluşur, onay beklenmez. **Uygulama adı** Paraşüt'te görünür; “L'Affogato Panel” gibi anlaşılır bir
   ad verin.
2. **Başvuru formunu doldurun.** *Talep Oluşturulan Müşteri No (Company ID)* listesinden L'Affogato'nun şirketini
   seçin. *Redirect URL* kutusunun başında `https://` sabit yazar; kutuya **tam olarak** şunu yapıştırın (başında ya da
   sonunda boşluk, sonunda eğik çizgi olmasın; ikinci adres eklemeyin, sonradan değiştirilemez):

   ```
   ladmin.laffogato.net/panel/parasut/baglan/geri
   ```

   Böylece kayıtlı adres `https://ladmin.laffogato.net/panel/parasut/baglan/geri` olur. *Paraşüt bağlantısı nereden
   yapılacak?* sorusunda **“Bir sunucudan” (confidential client)** seçili kalsın; panel client_secret'ı sunucuda tutar.

   Panelde **Ayarlar › Paraşüt entegrasyonu → Bağlantı** kartı da aynı adresi yazar; **Kopyala** onu `https://` olmadan
   kopyalar.
3. **İki değeri not edin.** DevHub size bir **client_id** ve bir **client_secret** verir. client_secret bir şifre
   gibidir: e-postaya, mesaja ya da sohbete yazmayın, kimseyle paylaşmayın. Yalnız 5. adımda panele yapıştıracaksınız.
4. **Paraşüt'te izin verin.** Paraşüt'e girin: **Ayarlar › Kullanıcılar › (bağlantıyı kuracak kişi, genelde siz) ›
   Düzenle › Uygulama Entegrasyonları** kutusunu açıp kaydedin. Bu izin şirket sahibi dahil herkeste **kapalı** gelir;
   açılmazsa Paraşüt panele “yetkiniz yok” (403) der.
5. **Panelde ayarları girin.** **Ayarlar › Paraşüt entegrasyonu → Bağlantı** kartında **Client ID**, **Client Secret**
   ve **Firma numarası**nı (Paraşüt'e girince adres çubuğundaki sayı, `uygulama.parasut.com/123456/…`) yazıp
   **Kaydet**'e basın. İsteğe bağlı **İlk eşitleme başlangıcı** boşsa bu yılın başından alınır. Deploy gerekmez.
6. **Panelde bağlayın.** Panelde **Ayarlar › Paraşüt entegrasyonu** ekranında **“Paraşüt hesabını bağla”**ya basın.
   Paraşüt'ün kendi giriş ekranı açılır: Paraşüt e-posta ve parolanızla girip izin verin. Panel parolanızı hiçbir zaman
   görmez. Panele dönünce “Paraşüt hesabı bağlandı” yazar ve sarı uyarı kalkar.
7. **Deneyin.** Aynı ekranda **Bağlantıyı dene** (“Bağlantı tamam” görmelisiniz), ardından **Şimdi eşitle**.

**Takılırsanız**

- *“Paraşüt hesabını bağla”ya basınca Paraşüt hata sayfası açılıyor:* Bağlantı kartındaki Client ID yanlış olabilir ya
  da DevHub'daki dönüş adresi yukarıdakiyle harfi harfine aynı değildir.
- *“Paraşüt keşif belgesi okunamadı (HTTP 403, …/.well-known/openid-configuration)”:* Paraşüt'ün önündeki Cloudflare
  bu belgeyi sunuculardan gelen isteğe kapatıyor (yetki ve belirteç adresleri açık). Panel bu durumda Keycloak'ın
  standart adreslerine kendiliğinden döner; Vercel'de ayrıca `PARASUT_AUTHORIZE_URL` ve `PARASUT_TOKEN_URL` tanımlı
  (aşağıdaki tablo), keşif hiç denenmez.
- *Bağlandı ama eşitleme “yetkiniz yok” (403) diyor:* 4. adımdaki **Uygulama Entegrasyonları** izni kapalı.
- *5. adımı yaptım, 6. adımı yapamadım:* sabah eşitlemesi “yeniden bağlayın” der; 6. adımı yapınca düzelir.
- *Paraşüt'te izni durdurdum ya da uzun süre eşitleme yapılmadı:* ekranda “yeniden bağlayın” yazar; 6. adımı tekrarlayın.
- Paraşüt'ün geçiş desteği: `devhubdestek@parasut.com`.

### Ayarların nerede durduğu (teknik)

Client ID, Client Secret, firma numarası ve ilk eşitleme başlangıcı panelden girilir (`integration_state` ›
`parasut.settings`, öbür şubelerin hesabında `parasut.settings:<şube>`; client_secret `AUTH_SECRET`'tan türetilen anahtarla AES-256-GCM şifreli, ekrana hiç gelmez, yedeğe
girmez). Her alanda **paneldeki değer önce gelir**; panelde yoksa aşağıdaki ortam değişkeni okunur. Kart her alanın
yanında kaynağını yazar: *panelde kayıtlı*, *Vercel'den* ya da *eksik* (`src/lib/parasut/settings.ts`).

- Client ID ya da Client Secret değişince kayıtlı Paraşüt oturumu (eski istemcinin) ve yarım bağlanma isteği silinir;
  hesap yeniden bağlanır. Client ID yeni secret'sız değiştirilemez. Eşitleme sürerken kaydedilmez.
- Firma numarası: Paraşüt'ten fatura gelmişse panelden değiştirilemez (başka firmaya geçilirse eşitleme eski firmanın
  faturalarını silinmiş sayıp kaldırırdı); gerçekten değişecekse yazılımcı `PARASUT_COMPANY_ID` ile yapar. Faturası
  olmayan kurulumda değişir ve eşitleme imleci sıfırlanır.
- Değişiklik işlem geçmişine “Paraşüt bağlantı ayarları” olarak düşer; secret'ın değeri yazılmaz.

Ortam değişkenleri (Vercel → lafmaliyet → Settings → Environment Variables, Production); adres ve izin ayarları yalnız
burada:

| Değişken | Değer |
|----------|-------|
| `PARASUT_CLIENT_ID` | DevHub'daki uygulamanın client_id'si |
| `PARASUT_CLIENT_SECRET` | DevHub'daki uygulamanın client_secret'ı |
| `PARASUT_COMPANY_ID` | Firma numarası: Paraşüt'e girince adres çubuğundaki sayı, `uygulama.parasut.com/123456/...` → `123456`. **Bağlantıyı dene** kullanıcının erişebildiği firmaları da gösterir |
| `PARASUT_SYNC_FROM` | (isteğe bağlı) İlk eşitlemenin başlangıcı, `YYYY-MM-DD`; boşsa bu yılın başı |
| `PARASUT_REDIRECT_URI` | (isteğe bağlı) DevHub'a kaydedilen dönüş adresi; boşsa `APP_URL` + `/panel/parasut/baglan/geri` |
| `PARASUT_ISSUER` | (isteğe bağlı) Kimlik sunucusu; varsayılan `https://id.parasut.com/realms/parasut` |
| `PARASUT_SCOPE` | (isteğe bağlı) İstenen izinler; varsayılan `openid offline_access` |
| `PARASUT_AUTHORIZE_URL`, `PARASUT_TOKEN_URL` | (isteğe bağlı) Uçları elle vermek için; ikisi de tanımlıysa keşif belgesi okunmaz. **Canlıda tanımlı** (24.11.2026): `https://id.parasut.com/realms/parasut/protocol/openid-connect/auth` ve `…/token`, çünkü Cloudflare keşif belgesini sunuculara 403 ile kapatıyor. Silinirse panel aynı standart uçlara kendiliğinden döner |
| `PARASUT_BASE_URL` | (isteğe bağlı) Veri API'si; varsayılan `https://api.parasut.com` |
| `CRON_SECRET` | Günlük işin anahtarı: `openssl rand -hex 32` |

İlk üçü panelde girilmediyse zorunludur (ve `CRON_SECRET`). İsteğe bağlı adreslerden biri https değilse uygulama durmaz: değer
yok sayılır, eşitleme sürer, yalnız “Paraşüt hesabını bağla” hangi değişkenin yanlış olduğunu söyleyerek başlamaz.

Komut satırından eklemek için (değeri siz yazarsınız, ekrana basılmaz):

```bash
vercel env add PARASUT_CLIENT_SECRET production
```

Yetkiyi Paraşüt'ten dilediğiniz zaman durdurabilirsiniz (Paraşüt → Profilim › Uygulama Entegrasyonları → **DURDUR**).
Durdurulduğunda panel bir sonraki eşitlemede `invalid_grant` alır, kayıtlı oturumu siler ve ekranda “yeniden bağlayın”
der.

### Şube başına Paraşüt hesabı

Her şube kendi Paraşüt hesabına (firmasına) bağlanabilir; şubeler aynı firmadaysa **"Diğer şubeyle aynı"** seçilir
(Ayarlar › Şube ayarları › Paraşüt hesabı). Kurallar `src/lib/parasut/accounts.ts`, okuma ve doğrulama
`src/server/parasut/accounts.ts`, şube ayarı grubu `parasut` (`branch_settings`; [SUBE.md](SUBE.md#şube-başına-ayarlar-25-kasım-2026)).

- **Hesap = kendi Paraşüt ayarı olan şube**; hesabın kimliği o şubenin kimliğidir (`tuzla`, `marina`). "Aynı" açık şube
  bağlandığı şubenin hesabını kullanır: **tek bağlantı, tek eşitleme**, aynı firma iki kez çekilmez. Satırı olmayan şube
  Tuzla'ya (varsayılan şube) örtük bağlıdır.
- **Geçiş: hiçbir şey yapmadan çalışır.** Bugünkü kurulum (panelden girilmiş ya da `PARASUT_*` ortam değişkenleri)
  varsayılan şubenin hesabıdır ve **eski adları korur**: `parasut.settings`, `parasut.token`, `parasut.cursor`, ürün
  anahtarı `p:<kimlik>`, kalem kimliği. Öbür hesaplar hesap adıyla: `parasut.token:marina`, `parasut.cursor:marina`,
  `p:marina:<kimlik>`, kalem `marina:<kimlik>` (iki firmanın Paraşüt kimlikleri çakışsa da karışmasın). Ortam
  değişkenleri **yalnız varsayılan hesabın** yedeğidir: ikinci şubenin hesabı Vercel'deki istemciyi devralmaz.
- **Ayrılmak** ("aynı" kapatılır) **hiçbir şey kopyalamaz** (şube ayarlarının kopyalama kuralına bilinçli istisna):
  aynı firma iki hesaptan iki kez eşitlenirse faturalar çiftlenir. Şube boş bir hesapla başlar; Paraşüt ekranında o
  şube seçiliyken DevHub bilgileri girilir ve **Paraşüt hesabını bağla**'ya basılır. İki hesap aynı firma numarasını
  alamaz (kayıt reddedilir). DevHub'daki dönüş adresi bütün hesaplarda aynıdır; aynı DevHub uygulaması da kullanılabilir.
- **Yeniden "aynı" yapmak**: şubenin kendi hesabından fatura geldiyse reddedilir (faturalar sahipsiz kalır, eşitlemesi
  durur). Gelmediyse hesabın ayarları, oturumu, yarım bağlanma isteği ve eşitleme durumu aynı işlemde silinir.
- **Bağlanma (OAuth)**: Bağlantı kartının düğmesi `/panel/parasut/baglan`'a POST'la `hesap=<şube>` gönderir (adreste
  `?hesap=` yok; § 2 › Kimlik). Hesap sunucuda doğrulanır ve bekleyen istekle (state, PKCE doğrulayıcısı, başlatan
  yönetici) state'e bağlı tek kullanımlık kayıtta mühürlü saklanır. Dönüşte belirteç isteğin başlatıldığı hesaba, o
  hesabın ayarlarıyla yazılır; şube bu arada başka şubenin hesabına bağlandıysa reddedilir. Hesap başına tek bekleyen
  istek (yenisi öncekinin yerine geçer); iki hesap aynı anda bağlanabilir, bir hesabın "Oturumu sıfırla"sı öbür
  hesabın süren bağlanmasına dokunmaz.
- **Aynı vergi numarası mı?** (Dalga 2, 26 Kasım 2026): ikinci bir Paraşüt firması bağlanırken panel, bağlanan
  firmanın vergi numarasını (VKN 10, TCKN 11 hane) öbür hesapların firmalarınınkiyle karşılaştırır. Aynı işletmenin
  iki Paraşüt firması aynı vergi numarasını taşır; gelen e-faturalar vergi numarasına geldiği için aynı faturalar iki
  hesaptan da gelebilir ve gider iki kez sayılır (firma numarası aynıysa kayıt zaten reddedilir; bu denetim firma
  numarası farklı, vergi numarası aynı durumu yakalar).
  - Okuma: yeni belirteçle `GET /v4/me?include=companies` (`included` › `companies` › `tax_number`). Öbür hesabın
    firması bu listede görünüyorsa (aynı Paraşüt kullanıcısı iki firmaya da erişiyor) numarası oradan; görünmüyorsa ve
    o hesap bağlıysa kendi kayıtlı oturumuyla okunur (en çok 20 sn). Bağlı olmayan ve görünmeyen hesap
    karşılaştırılmaz: o hesap bağlanırken bununla karşılaştırılır. Tek hesaplı kurulumda Paraşüt'e fazladan istek
    gitmez. Saf kurallar `src/lib/parasut/company.ts`, okuma `src/server/parasut/company.ts`.
  - Karar: vergi numaraları farklıysa sorulmadan bağlanır. **Aynıysa** ya da bir taraf **okunamadıysa** Paraşüt'ün
    verdiği yetki **yazılmaz**: şifreli, tek kullanımlık, 10 dakikalık bir onay kaydına konur
    (`parasut.connect.onay`, öbür hesaplarda `parasut.connect.onay:<şube>`; yedeğe girmez) ve Paraşüt ekranı
    yalnız bağlanmayı başlatan yöneticiye sorar: aynı numarada “Aynı vergi numarası … Aynı işletmeyse bağlamayın,
    Şube ayarları'ndan ‘Tuzla ile aynı’yı açın” (**Yine de bağla** / Vazgeç), okunamayanda “Aynı vergi numarası mı?”
    (**Farklı, bağla** / Vazgeç). Onayda yetki o an yazılır (hesabın istemcisi, kimlik sunucusu ya da firması bu arada
    değiştiyse yazılmaz); Vazgeç'te (ya da pencere kapatılınca) silinir. Yeniden bağlamada eski oturum karar verilene
    kadar yerinde kalır. Oturumu sıfırlamak, istemciyi değiştirmek ya da yeni bağlanma isteği onay bekleyeni de siler.
  - İşlem geçmişi: “Paraşüt hesabı bağlandı · … aynı vergi numarası uyarısı onaylandı (1111111111; Tuzla)” ya da
    “Paraşüt hesabı bağlanmadı · Yönetici vazgeçti: aynı vergi numarası (…)”.
  - Deneme: `tests/parasut-firma.test.ts` (kurallar, metin, kaynak), `tests/parasut-hesap-db.test.ts` (aynı numara
    sorulur, vazgeç / onayla, ortak kullanıcı, okunamayan numara).
- **Eşitleme**: sabah işi ve e-posta işinin yeniden denemesi ayarı tamam her farklı hesabı **bir kez, sırayla**
  eşitler (`syncParasutAccounts`; süre hesaplara bölünür, aynı anda tek eşitleme). Bir hesabın eşitlemesi yalnız kendi
  faturalarını ve Paraşüt'e bağlanmamış elle girilmiş / içe aktarılmış kayıtları görür (`invoiceAccountWhere`): öbür hesabın faturasını
  eşleştirmez, güncellemez, **kaldırmaz**. `parasut_sync_runs.account` hangi hesabın çalıştığını yazar; e-posta işi
  bugün eşitlenmemiş hesapları yeniden dener. Zil, Bugün ve sabah e-postası bir hesabın hatasını öbürünün başarısıyla
  örtmez. Ödeme takibinin başlangıcı (`payments.since`) da hesap başına: sonradan bağlanan hesabın son 30 günden eski
  faturaları Paraşüt'teki ödeme durumuyla gelir, "ödenmedi" yığılmaz.
- **Faturanın hesabı ve şubesi** (`invoices.parasut_account`, `invoices.branch_id`; göç 0082–0083 var olan Paraşüt
  faturalarına varsayılan hesabı yazdı). Paraşüt kimlikleri hesap içinde benzersizdir
  (`(parasut_account, external_id)`, `(parasut_account, e_invoice_id)`; göç 0086: hesabı boş satır varsayılan hesabın
  sayılır, eski yedekten gelen hesapsız kopya Tuzla'nın aynı kimlikli faturasının yanına yazılamaz). Yeni faturanın
  şubesi (sahibin kararları, 25 Kasım 2026; [SUBE.md › Faturanın şubesi](SUBE.md#faturanın-şubesi-25-kasım-2026)):
  hesabı yalnız bir şube kullanıyorsa (ayrı hesap) **o şube**; değilse (ortak hesap ya da Bağlantı kartındaki "Faturalar
  Marina şubesinin" anahtarı kapalı) **tedarikçinin varsayılan şubesi** (Tedarikçiler › Düzenle; şube ya da İşletme
  geneli), o da yoksa **şubesi seçilmemiş** (Faturalar › Tümü'deki kutuda öneriyle bekler; tahminle şube yazılmaz).
  Şube yalnız yeni açılan faturaya yazılır; var olanınki eşitlemede değişmez, Faturalar'dan değişir. Faturalar'da
  birden çok kasa açıkken her faturada şube rozeti çıkar; "Paraşüt'te aç" bağlantısı faturanın hesabının firma
  numarasıyla kurulur. **Okumada**: tek şube seçiliyken o şubenin ve işletme geneli seçilmiş faturalar modele girer
  (`loadDataset`, `invoiceScopeWhere`); şubesi seçilmemiş ve öbür şubenin faturası girmez; "Tümü"de hepsi. Vergi, Nakit
  planı ve Ödemeler firma genelidir (bütün faturalar). Şubenin mal maliyeti tek şubede yine reçeteden hesaplanır;
  şubenin harcamaya bağlı faturası şubenin hücresinde, işletme geneli olanı bilgi satırında ([SUBE.md](SUBE.md)).
- **Paraşüt ekranı** seçili şubenin hesabını gösterir ("Tümü": Tuzla'nınki ve "Marina ayrı Paraşüt hesabı kullanıyor"
  notu): bağlantı, ayarlar, eşitleme geçmişi, imleçler, iadeler ve kalem okuma o hesabın. Gelen fatura sayıları ve
  bağlanmayı bekleyen ürünler ayrıca **faturanın şubesine** göre süzülür (tek şubede o şubenin ve işletme genelinin
  faturaları; 25 Kasım 2026); şubesi seçilmemiş fatura varsa ekran "N faturanın şubesi seçilmemiş" der ve Faturalar'daki
  kutuya götürür. Zildeki "bağlanmayı bekleyen" sayısı işletme geneli kalır.
  Hesabı başka şubeden kullanan şube seçiliyken ("Tuzla ile aynı") Bağlantı kartı salt okunurdur: durum ve "Tuzla'da
  düzenle" (ayar formu ve oturum düğmeleri yalnız hesabın sahibi şube seçiliyken).
  Kategori kuralları, ürün bağlantıları, "hammadde değil" listesi, yok sayılan ve silinen faturalar (anahtar hesapla
  önekli: `marina/123`) bütün hesaplarda ortaktır. Genel bakış'ın Paraşüt kartı da seçili şubenin hesabının eşitlemesi.
- **Tedarikçi sayfası**: "Geçmiş faturaları al" seçili şubenin hesabından; "Faturadan doldur" her faturayı kendi
  hesabından okur. Fatura belgesi (PDF) faturanın hesabından indirilir.
- **Yedek**: öbür hesapların oturumu ve ayarları önekiyle dışarıda (`parasut.token:*`, `parasut.settings:*`,
  `parasut.connect*`; [YEDEK.md](YEDEK.md)).
- **Deneme**: `tests/parasut-hesap.test.ts` (kurallar, kaynak), `tests/parasut-hesap-db.test.ts` (iki firmalı sahte
  Paraşüt: tek eşitleme, aynı kimlik iki satır, öbür hesabın faturası ve cari bağı korunur, bağlanma doğru hesaba).

## 2. Nasıl çalışır

- **Kimlik:** OAuth 2.0 **Authorization Code + PKCE** (S256), kimlik sunucusu `https://id.parasut.com/realms/parasut`. Yetki adresi
  ve belirteç adresi koda yazılmaz: `{issuer}/.well-known/openid-configuration` keşif belgesinden okunur ve 6 saat
  bellekte tutulur (`src/server/parasut/oidc.ts`; saf kurallar ve güvenlik denetimleri `src/lib/parasut/oidc.ts`).
  Keşif belgesi yalnız **https** ve yayıncıyla **aynı alan adındaki** uçları kabul eder. Belge okunamazsa (id.parasut.com
  önündeki Cloudflare `.well-known` isteğini sunuculardan 403 ile engelliyor; 24 Kasım 2026'da Vercel'den görüldü) ve
  yayıncı bir Keycloak alanıysa (`/realms/<ad>`) standart uçlar kullanılır: `{issuer}/protocol/openid-connect/auth` ve
  `…/token` (`keycloakEndpoints`). Canlıda bu iki adres ayrıca `PARASUT_AUTHORIZE_URL` / `PARASUT_TOKEN_URL` ile verili.
  Yetkilendirme bir kez tarayıcıdan yapılır (`/panel/parasut/baglan` → Paraşüt onayı → `/panel/parasut/baglan/geri`,
  `src/server/parasut/connect.ts`). **Yalnız düğmeyle başlar** (26 Kasım 2026, güvenlik notu): Bağlantı kartındaki
  “Paraşüt hesabını bağla” bir form düğmesidir ve `/panel/parasut/baglan`'a **aynı kökenden POST** gönderir
  (`sameOrigin`; köken tutmazsa 403). Adres çubuğundan, bir bağlantıdan ya da başka bir siteden gelen GET hiçbir şey
  başlatmaz, Paraşüt ekranına döner. Hesap adreste taşınmaz: formdaki hesap sunucuda doğrulanır ve `state`,
  `code_verifier`, başlatan yönetici ile birlikte **state'in SHA-256 özetiyle anılan** şifreli kayıtta durur
  (`parasut.connect:<özet>`; state'in kendisi yazılmaz). Kayıt 10 dakika geçerli ve tek kullanımlıktır: dönüş yolu
  onu yalnız dönen state'le bulur ve bulduğu anda siler (uydurma ya da eski bir state başkasının bekleyen isteğini
  harcayamaz); istek başka bir yöneticinin oturumundan tamamlanamaz. Hesap başına tek bekleyen istek; süresi geçenler
  yeni istekte silinir.
  Dönen `refresh_token` **30 gün** geçerlidir ve her eşitlemede yenilenir (her yenilemede yenisi döner, hemen
  kaydedilir); erişim belirteci ~2 saat geçerli. Belirteçler veritabanında (`integration_state`) AES-256-GCM ile
  şifreli durur; anahtar `AUTH_SECRET`'tan türetilir. Panel Paraşüt parolasını hiçbir zaman görmez.
  Yenileme kalıcı olarak reddedilirse (`invalid_grant`: izin durduruldu, 30 gün doldu ya da `client_secret`
  yenilendi) kayıtlı oturum silinir ve ekran yeniden bağlanmayı ister. Geçici ağ/5xx hatasında belirteç korunur.
  Oturum yedeğe girmez ([YEDEK.md](YEDEK.md)): geri yüklemeden sonra hesap yeniden bağlanır.
- **Bağlı değilken:** kayıtlı oturum yoksa (hiç bağlanmadı, “Oturumu sıfırla” ya da Paraşüt izni kaldırdı) eşitleme
  Paraşüt'e istek atmaz: “Paraşüt hesabı bağlı değil … Paraşüt hesabını bağla”. Kullanıcı adı ve parolayla giriş yolu
  yok (Paraşüt `grant_type=password`'ü kapattı; eski yedek 24 Kasım 2026'da koddan kaldırıldı).
- **Okuma:** `GET /v4/{firma}/purchase_bills?sort=-issue_date&include=supplier,category,details,details.product,active_e_document`,
  sayfa başına 25 kayıt (Paraşüt'ün üst sınırı). Paraşüt "değişme tarihine göre" süzmeye izin vermediği için her
  eşitleme son faturanın tarihinden **75 gün geriye** bakar; bu pencerede ödenen, düzeltilen ya da iptal edilen
  faturalar güncellenir.
- **Hız sınırı:** Paraşüt 10 saniyede 10 istek kabul ediyor; istemci istekler arasında ~1 sn bekler, 429'da
  `Retry-After`'a uyar, 5xx'te yeniden dener. Bir eşitleme (okuma + yazma) en fazla ~45 sn sürer; süre dolarsa
  kaldığı sayfa kaydedilir ve sonraki çalışma oradan sürer. "Son fatura tarihi" imleci yalnızca tur tamamlanınca
  ilerler, böylece uzun bir ilk eşitlemede eski faturalar atlanmaz.
- **Tutarlar:** `gross_total` iskonto ve vergiler öncesi brüt, `total_discount` + `total_invoice_discount`
  iskontolar, `total_vat` KDV, `net_total` KDV dahil genel toplam. Her faturada
  `net ≈ brüt − iskontolar + KDV + ÖTV + ÖİV` sınanır; tutarsa maliyet (KDV hariç) `net − KDV` olur ve panelde
  tutar = maliyet + iskonto, iskonto = iskontolar yazılır. Tutmazsa net'in KDV hariç geldiği durum ve "kalan = net"
  denenir. Fatura altı iskonto kalemlere oranla dağıtılır. Döviz faturaları `exchange_rate` ile TL'ye çevrilir; kur
  gelmezse (yok ya da 0) tutar kur 1 sayılır ama kayıt kontrol bekler, notuna "USD faturası: döviz kuru okunamadı,
  tutarı kontrol edin" düşer (elle kayda bağlanan da bir kez kontrole alınır; denetim FC-05). Tedarikçinin iade
  faturaları eksi yazılır, iptal ve tekrarlayan şablonlar alınmaz (arşivlenmiş fatura alınır). Satış
  iadeleri gider sayılmaz, tedarikçiye iadeler panele girmez: bkz. 2a.
- **Geç girilen faturalar:** tarihi 75 günlük pencereden eski ama Paraşüt'e sonradan girilmiş fatura (kâğıt fatura;
  KDV'si sonraki yılın sonuna kadar indirilebilir) tarihe göre okunan listede görünmez. Tam turdan sonra liste
  kimliğe göre azalan sırayla (`sort=-id`) önceki taramanın en büyük kimliğine kadar okunur (`parasut.lastBillId`,
  `late-bills.ts`); panelde olmayan yazılır, özette "N geç girilmiş eski fatura alındı" (yalnız yeni açılan kayıt
  sayılır). Çalışma başına en çok 4 sayfa: iki eşitleme arasında 100'den fazla fatura girildiyse (ay sonu toplu giriş,
  duran eşitleme) tarama kaldığı yeri saklar (`scan`: başındaki en büyük kimlik, sayfa, işlenen en küçük kimlik) ve
  sonraki çalışmada oradan sürer; sınır ancak tarama bitince ilerler. Sürdürme en son işlenen sayfayı yeniden okur;
  arada fatura silinip sayfalar kaydıysa önceki sayfaya döner (işlenmemiş fatura atlanmaz). Yazılamayıp ertelenen
  fatura (aşağıda: eski gider faturası Paraşüt'e sorulamadı) taramayı o faturada tutar; art arda 3 çalışmada yine
  yazılamazsa geçilir (e-faturası paneldeki başka kayıtta durduğu için gider kaybolmaz). İlk çalışma yalnız en büyük
  kimliği kaydeder (daha önce kaçanlar için "Tarihten eşitle"). Gelen e-faturalar yalnız tarihe göre listelenebildiği
  için bu tarama gider faturalarına uygulanır.
- **Ödeme ve vade:** `due_date` → vade. Ödendi / ödenmedi'yi **siz işaretlersiniz** (Tedarikçiler ya da Faturalar,
  [TEDARIKCILER.md](TEDARIKCILER.md)): Paraşüt'ten gelen her yeni fatura "ödenmedi" gelir, eşitleme var olan
  faturanın ödeme durumuna dokunmaz; `remaining` / `payment_status` yalnız ipucu olarak saklanır (`parasut_unpaid`,
  ekranda "Paraşüt'te ödendi"). Komisyon faturası (hakedişten düşülür) ve kartında "Faturaları ödendi gelsin" işaretli
  (peşin) tedarikçinin faturası ödendi gelir; takip başlamadan önceki tarihli fatura geçmişi yeniden alırken
  Paraşüt'teki durumuyla gelir. Ödenmemiş
  faturalar **Ödemeler & hatırlatıcılar**'a ve hatırlatma e-postasına düşer.
- **Cari takipteki tedarikçi** (Tedarikçiler'de elle ödeme girilmiş kart, [TEDARIKCILER.md](TEDARIKCILER.md) *Hesap
  hareketleri*): takip başlayınca grubun faturalarına Paraşüt'ün o ana kadar ödendi gösterdiği kısım yazılır
  (`invoices.ledger_base`); bu karta sonradan gelen fatura 0 ile açılır. Takipli faturanın kalanı panelde sayılır
  (Ödenecek − taban − panelde sayılan); Paraşüt'ün kalanı yalnız ipucudur ("Paraşüt'te kalan 2.000,00 ₺; panelde
  2.500,00 ₺"). Eşitleme `ledger_base`, `allocated` ve `paid_by_ledger`'a dokunmaz (`common` nesnesinde yoklar).
  Çalışmanın sonunda, `matchSupplierOrders`'ın yanında üç son adım koşar (her kart için ayrı kısa işlem, "Sistem"
  adıyla işlem geçmişine düşer):
  - tutarı değişen ve ödeme sayılmış faturalar yeniden dengelenir: tutar düştüyse fazla sayılan para hesaba geçer,
    arttıysa ödemelerin kapattığı fatura ödenmemişe döner;
  - peşin çalışılan ve takipli kartın hesabında para varken gelen yeni faturaya önce o para sayılır (bir kez; yalnız
    takip günü ve sonrasının faturasına, `takesCreditOnArrival`: takip öncesi fatura kapıda ödenmişti, E-14);
  - Paraşüt'te iptal edilen (ve e-fatura yolunda silinen) fatura silinmeden önce aynı işlemde bağları çözülür: bağlı
    faturasız alım eski hâline döner (gider kaydı yeniden yazılır), ödemeler borca ya da hesaba geçer.
  Özet satırında "Cari: 1 faturada ödeme hesaba geçti, 1 peşin faturaya hesaptaki ödeme sayıldı". `findExisting` elle
  borçları hiç görmez: faturasız alımla fatura arasında kendiliğinden bağ kurulmaz, bağ her zaman Tedarikçiler'de
  bilinçli bir tıklamadır.

## 2a. İadeler

Paraşüt bir iadeyi karşı belgenin tersi tarafa yazar: **satış faturasına karşı** kesilen iade *Giderler*'e (gider
faturası, `item_type: refund`), **gider faturasına karşı** kesilen iade *Satışlar*'a (satış faturası) düşer. Aynı
Paraşüt şirketinde laffogato.net'in e-Arşiv / e-Fatura satış faturaları da kesildiği için (docs/planlar/DIGER-OTURUM.md)
iki yol da panelin okuduğu listelere değer:

- **Satış iadesi gider sayılmaz** (`isSalesReturn`, `mapping.ts`; `shouldImport` nedeni "satış iadesi"). İşaretler:
  kalemlerin hepsi sitenin Paraşüt ürünü (kod tam olarak `LAF-<grup>-<KDV oranı>`: KAFE, MAGAZA, TESLIMAT, HIZMET ya da
  eski KARAOKE; muhasebecinin kendi `LAF-…` kodlu ürünleri sayılmaz), faturanın bağlı gelen e-belgesi iade türünde (`IADE`,
  `TEVKIFATIADE`) ya da iade faturasının kişisi **müşteri kartı** (`account_type: customer`). Gelen iade e-faturası da
  (içeri alınmamış) gider olarak açılmaz: GİB kuralıyla iadeyi malı geri veren alıcı keser, gelen iade kafenin sattığı
  bir malın iadesidir (sitenin e-Fatura kestiği şirket müşterisi). Daha önce gider olarak alınmış böyle bir kayıt
  eşitlemede kalkar (elle girilmiş ya da içe aktarılmış kayda bağlıysa bağı çözülür, notuna "Paraşüt'te satış iadesi — kontrol
  edin" düşer). Online satış sitenin dökümünde zaten iadesi düşülmüş gelir; iade bir de gider sayılsaydı iki kez
  düşerdi, müşterinin tam adı tedarikçi olur, KDV tahmini kayardı.
- Müşteri kartıyla girilmiş **normal** (iade türünde olmayan) gider faturası sessizce atılmaz: gerçek bir alış da
  olabilir. Kayıt kontrol bekleyen açılır, notunda "Paraşüt'te müşteri kartıyla girilmiş: satış iadesiyse silin" yazar.
- Tedarikçi kartlı iade faturası (işaretlerden hiçbiri yok) eskisi gibi **eksi gider** yazılır, kalemleri alınan
  miktardan düşer.
- **Tedarikçiye iade panele girmez:** Paraşüt bunu satış faturası olarak tutar, panel satış faturalarını okumaz.
  Tedarikçi e-Fatura kullanıcısıysa iade giden bir iade e-faturasıdır (`direction: outbound`, `IADE`); eşitleme bunları
  listeler (tedarikçi adı `contact_name`, vergi nosu `to_vkn`). Paraşüt sayfası "Tedarikçiye N iade panele girmedi"
  der: Faturalar'da aynı tedarikçiye eksi tutarlı fatura girilince (ad ya da vergi no, ±31 gün, tutar ±1 ₺) listeden
  kalkar. e-Fatura kullanmayan tedarikçiye iade (e-Arşiv, kâğıt) API'den hiç görünmez: elle eksi fatura girin.
- Liste `integration_state` › `parasut.returns`'te durur (son 120 gün, türüne göre en çok 60). Satış iadesinde
  müşterinin adı saklanmaz (yalnız tarih, tutar, belge no; site panele yalnız ilk adı verir). Eşitleme özeti yalnız ilk
  kez görülenleri söyler: "N satış iadesi gider sayılmadı", "N tedarikçiye iade panele girmedi (Paraşüt sayfasında)".
  Paraşüt sayfasında satış iadeleri bilgi olarak sayıyla görünür.

## 3. Çift sayım olmaz

Panelde elle girilmiş ya da içe aktarılmış (ilk kurulumdaki aktarım; ekranda "İçe aktarılmış (eski)") aynı fatura bulunursa yenisi açılmaz, mevcut kayıt Paraşüt'e bağlanır:

1. Paraşüt kimliği (daha önce bağlandıysa),
2. tam e-fatura / e-Arşiv numarası (3 harf ya da rakam + 13 rakam): tedarikçi adı farklı yazılmış olsa da (Yemek Sepeti
   ~ YEMEKSEPETİ ELEKTRONİK), ±31 gün içinde, aynı tarih ya da aynı tutarla (±1 ₺). GİB e-Arşiv portalının numaraları
   (`GIB` + yıl + sıra) portalı kullanan bütün küçük tedarikçilerde aynı biçimdedir, iki ustanın 12. faturası aynı
   numarayı taşır: bu numarada tedarikçi de aynı olmalı (denetim FC-03). **Aynı tedarikçi**: adlar aynı firmayı
   gösteriyor (biri ötekinin baştaki tam kelimeleri: Ahmet Usta ~ AHMET USTA TESİSAT), kayıtta Paraşüt'ten gelmiş vergi
   no belgedekiyle aynı, ya da ikisi Tedarikçiler'de aynı karta düşüyor (kartın adı, diğer adları, vergi nosu: elle
   girilmiş "Ahmet Usta" ile Paraşüt'teki "AHMET YILMAZ", kart "Ahmet Usta"nın diğer adı ya da vergi nosu tutuyorsa).
   Tedarikçi tutmazsa yeni kayıt açılır ama kontrol bekler, notu öteki kaydı söyler: "aynı numaralı elle girilmiş
   fatura var (Ahmet Usta, 08.11.2026); aynı faturaysa birini silin". Aynı ustaysa kartına diğer adı ya da vergi
   nosunu ekleyin, sonraki faturaları kendiliğinden bağlanır,
3. öteki fatura numaraları (harf/rakam dışı karakterler yok sayılarak) yalnızca **aynı tedarikçide** ve ±31 gün
   içinde (farklı firmalar aynı e-fatura önekini kullanabilir),
4. aynı tarih + aynı tutar (±1 ₺) + aynı tedarikçi.

Bağlanan kaydın **kategorisi, tedarikçi adı ve ödeme durumu korunur**; tutar, KDV ve tarih Paraşüt'ten gelir.
Paraşüt'te vade yoksa paneldeki vade korunur. Paraşüt'te **iptal edilen ya da silinen** fatura, panelde Paraşüt'ten açılmışsa
kaldırılır; elle girilmiş ya da içe aktarılmış bir kayda bağlıysa silinmez, bağı çözülür ve notuna "Paraşüt'te iptal — kontrol
edin" düşülür. Bağı çözülen kaydın tutarları yeniden düzenlenebilir; tutar, iskonto ya da ödenecek değişince
eşitlemeden kalan KDV toplamı silinir, KDV tahmini ödenecek − net'i sayar ([NAKIT-PLANI.md](NAKIT-PLANI.md)).
Kayıt **gelen bir e-faturaya da bağlıysa** silinmez (e-fatura duruyor, borç da): yalnız gider
faturasının bağı ve kalemleri kalkar; ödeme durumu, kategori, vade ve not kalır, kalemler e-fatura belgesinden yeniden
okunur. E-fatura Paraşüt'te **yeniden içeri alınırsa** (eski gider faturası silinip yenisi açılır) aynı kayıt yeni gider
faturasına geçer; eski fatura Paraşüt'e sorulur, hâlâ duruyorsa yeni fatura ayrı açılır ama "aynı e-fatura başka bir
gider faturasında da var" notuyla kontrol bekler (çift sayım görünür kalsın). Eski fatura **okunamazsa** (ağ, zaman
aşımı, Paraşüt hatası) yeni fatura o çalışmada yazılmaz, sonraki eşitleme yeniden sorar: "duruyor" sayılsaydı aynı
e-fatura "ödenmedi" ikinci bir kayıt olarak açılır, eski fatura sonra silinmiş görülse de iki kayıt birleşmezdi.
Arşivlenmiş faturalar (Paraşüt'te yalnızca listeden gizlenmiş) geçerli gider olarak alınır.
Yeni tedarikçi adları paneldeki kısa adlarla eşlenir ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş." → "Sütaş"), böylece gelir-gider
tablosundaki tedarikçi satırları dağılmaz.

**Elle eklenen fatura** (Faturalar › Fatura ekle) aynı tedarikçinin aynı numaralı faturasıyla karşılaşırsa eklenmez,
pencere sorar (denetim UI-02): "Bu numarayla Kaldi faturası zaten var" altında öteki kaydın numarası, tarihi, tutarı
ve nereden geldiği (Paraşüt'ten gelmiş, elle girilmiş, içe aktarılmış (eski)). Eşitlemeden sonra kâğıt faturanın elle girilmesi ya da iki kişinin aynı
faturayı girmesi mal alımını, borcu ve KDV indirimini iki kez sayardı (eşitleme yalnız kendinden önce girilen kaydı
bağlar). Numara harf ve rakam dışı karakterler yok sayılıp büyük harfle karşılaştırılır; tedarikçi yukarıdaki gibi adla
ya da Tedarikçiler kartıyla aynı sayılır; tarih ve tutara bakılmaz. Gerçekten ayrı faturaysa **Yine de ekle** ekler.
Pencere her yeni faturaya bir anahtar gönderir: Kaydet'in (ya da not alanındaki Ctrl+Enter'ın) ikinci basışı,
yanıtı yolda kalan isteğin tekrarı ikinci fatura açmaz, ilki döner ("Fatura zaten eklenmişti"; UI-03).

Paraşüt'e bağlı faturada tarih, fatura no, tutar, iskonto ve ödenecek panelde salt okunurdur (saveInvoice da
yazmaz); kategori, tedarikçi adı, açıklama, not, vade ve ödeme durumu düzenlenir. Kısmen ödenmiş faturada Paraşüt'ün
bildirdiği kalan borç (`outstanding`) gösterilir ve toplamlara o girer. Panelde silinen Paraşüt faturaları bir
sonraki eşitlemede geri gelmez; Faturalar › Silinen Paraşüt faturaları'ndan (ya da silme bildirimindeki "Geri al"
ile) geri alınır. Kayıt hem gider faturasına hem e-faturaya bağlıysa (e-fatura Paraşüt'e elle gider faturası olarak
girilmiş, §6) silmede **ikisi birden** yok sayılır (`<gider faturası kimliği>` ve `ei:<e-fatura kimliği>`; kopyada
`alsoIgnored`): önceden yalnız gider faturası yok sayılıyor, e-fatura eşitlemesi silinen faturayı ertesi sabah
"ödenmedi" yeni kayıt olarak geri getiriyordu (denetim 21 Kasım #3). Listede tek satırdır; geri alınınca iki anahtar
birlikte çıkar, aynı fatura ya da aynı e-fatura bu arada panelde yeniden açılmışsa kopya yazılmaz ("zaten listede").
Silinirken faturaya sayılmış cari ödemeleri geri alınınca, ödemenin hesabında hâlâ duran kadarıyla yeniden sayılır (elle girilmiş faturanın "Geri al"ı gibi; denetim FC-01); sayılamayan tutarı bildirim söyler.

## 3a. Tedarikçinin vergi nosu

Paraşüt'ten gelen her faturaya tedarikçinin VKN / TCKN'si yazılır (`invoices.supplier_tax_number`, yalnız rakam,
10 ya da 11 hane). Tedarikçiler aynı numaralı faturaları adları farklı olsa da tek tedarikçide toplar
([TEDARIKCILER.md](TEDARIKCILER.md#eşleşme)); faturanın adı değişmez (Faturalar ve Gelir-gider adla kalır).

- **Nereden:** gider faturasında `include=active_e_document` ile gelen e-belgenin `from_vkn`'i (imzalı belge), yoksa
  `include=supplier` ile gelen kişi kartının `tax_number`'ı (ya da `/contacts/{id}` önbelleği); içeri alınmamış gelen
  e-faturada `from_vkn`; e-faturanın UBL belgesi okunurken satıcının kimliği (`AccountingSupplierParty`, yalnız boş
  numarayı doldurur). Yalnız gelen e-belge sayılır: aynı Paraşüt şirketinde sitenin satış faturaları ve e-Arşiv'i de
  kesiliyor, giden belgedeki `from_vkn` işletmenin kendi numarasıdır.
- **Öncelik** (`nextTaxNumber`, `mapping.ts`): boş kayda gelen numara yazılır; e-belgedeki numara her zaman geçer;
  kişi kartındaki numara e-faturaya bağlı kaydın numarasını ezmez, e-faturasız kayıtta yazılır (kişi kartı Paraşüt'te
  düzeltilmiş olabilir). Elle girilen ve içe aktarılmış faturada numara yoktur.
- Kontrol hanesi tutmayan ve örnek numaralar (1234567890 …) saklanır, faturada görünür ama eşleşmede kullanılmaz.
- **Eski faturalar:** her eşitleme son 75 günü yeniden okuduğu için yeni ve yakın tarihli faturalar numarasını
  hemen alır. Daha eskiler bir kerelik tamamlamayla dolar (`src/server/parasut/tax-backfill.ts`): her eşitlemenin
  artan süresinde, numarası boş Paraşüt faturaları için gider faturaları (`purchase_bills`,
  `include=supplier,active_e_document`), sonra gelen e-faturalar (içeri alınmış e-faturanın gider faturası kaydı da)
  en yeniden geriye okunur; boş kayıtların en eskisine gelince biter. Kaldığı sayfa `integration_state` ›
  `parasut.taxBackfill`'de durur; bitince bir daha çalışmaz. Yazma yalnız numara hâlâ boşsa yapılır. İlerlemesi
  eşitleme özetinde görünür: "N faturaya vergi no yazıldı" (yeni faturalar, düzeltilenler ve tamamlama birlikte).
  "Şimdi eşitle" tamamlamayı hızlandırır. **Oturumu sıfırla** ve `npm run db:reset` durumu siler, baştan başlar.
- Silinen faturanın kopyası numarayı da saklar (Silinen Paraşüt faturaları'ndan geri alınınca numarasıyla döner).

## 4. Kategori

Yeni gelen faturanın panel kategorisi sırasıyla:

1. **Kategori kuralları** (ekrandan: tedarikçi adı / Paraşüt kategorisi / açıklamada geçen kelime → kategori),
2. aynı tedarikçinin önceki faturalarında en sık kullanılan kategori (eşitlemenin açıp henüz kontrol edilmemiş
   faturaları sayılmaz; onaylanan ya da kategorisi değiştirilen sayılır),
3. komisyon platformları (Trendyol, Yemek Sepeti, Pluxee, Multinet, Edenred, Set Kart, Metropol …) → Komisyon,
4. Paraşüt kategori adı ve kalem adlarındaki ipuçları (ambalaj, kira, yazılım, reklam …). **Temizlik** (25 Kasım
   2026): temizlik **firması** hizmettir, temizlik **malzemesi** sarftır. Sıra: "temizlik hizmeti / firması / hizmet
   bedeli" → Hizmet; malzeme sözcükleri (temizlik malzemesi, deterjan, çöp torbası / poşeti, eldiven, kağıt havlu,
   peçete dışı hijyen ürünleri, sünger, dezenfektan, kırtasiye…) → **Temizlik & Sarf**; kalan tek başına "temizlik" →
   Hizmet (`CATEGORY_HINTS`, `mapping.ts`; `tests/fatura-kalem.test.ts`),
5. Diğer: yalnız **sınıflanmamış** faturaların bekleme kutusu (kontrol bekler). Sarf ve temizlik malzemesi kendi
   kategorisinde: **Temizlik & Sarf**. Göç `0090_temizlik_sarf` bu kategoriye bağlı Aylık harcamalar satırını
   ("Temizlik & sarf malzemesi", İşletme genel giderleri) yoksa açar: Gelir-gider'de sarf gideri olarak sayılır. Var olan
   faturaların kategorisi değişmedi.

Seçimin nedeni faturanın notuna yazılır ("Paraşüt'ten alındı · kategori: …"). Faturalar ekranından değiştirilen
kategori sonraki eşitlemelerde korunur. E-faturadan açılan kaydın kalem adları ancak belge okununca bilinir: "eşleşme
yok" kalan ve hâlâ kontrol bekleyen kaydın kategorisi kalemler okununca kurallar ve ipuçlarıyla yeniden denenir
(kayıt kontrol bekleyen kalır).

## 5. Kalemler, alınan miktar ve fiyat

Kalemler iki yerden gelir ve aynı tabloda (`parasut_bill_lines`) durur:

- **Gelen e-faturalar** (içeri alınmamış olanlar ve e-faturaya bağlanan içe aktarılmış kayıtlar): kalemler e-faturanın imzalı
  UBL belgesinden okunur (`GET /v4/{firma}/e_invoices/{id}/signed_ubl` → tek XML'li ZIP; `ubl.ts`, `lines.ts`).
  Ürün adı, satıcı ürün kodu, miktar ve birim (UN/ECE kodu: C62 = Adet, NPL = Koli, KGM = kg…), birim fiyat,
  iskonto, KDV oranı ve KDV hariç net tutar yazılır. Bazı sağlayıcılar kalem tutarını brüt yazıp iskontoyu ayrıca
  verir (Erbak, Sütaş); hangi alanın net olduğu faturanın KDV hariç toplamını tutturan yorumla seçilir, fatura altı
  iskonto kalemlere oranla dağıtılır. Canlı veride 82 gelen e-faturanın 82'sinde kalemlerin toplamı faturayı
  kuruşu kuruşuna tuttu (20 Eki 2026). Her eşitleme kalan süre kadar faturanın kalemlerini okur (en yeni önce);
  beklemeden okumak için Paraşüt sayfasında **Kalemleri şimdi oku**. Okunan fatura `invoices.ubl_read_at` ile
  işaretlenir; e-fatura değişirse yeniden okunur. Belgesi geçici bir hatayla (Paraşüt 5xx, zaman aşımı) alınamayan
  fatura o turda atlanır ve sonraki okumalarda sıranın sonuna alınır (tek bir bozuk belge ötekileri bekletmez); 5
  denemede alınamazsa okunamadı sayılır (`parasut.ublRetries`). Ödeme tarihi için bkz. 6.
- **Tevkifatlı e-fatura:** Paraşüt'ün listesi tedarikçiye ödenecek tutarı (`net_total`, tevkifat düşülmüş) ve tam
  KDV'yi verir; "ödenecek − KDV" maliyeti eksik çıkarır (ör. 34.200 − 6.000 = 28.200, doğrusu 30.000). Belge
  okununca tevkifat geri eklenir (ödenecek + tevkifat − KDV), notta eski tutar görünür. ÖİV/ÖTV (telekom, içecek)
  gider faturası yolundaki gibi maliyette kalır; tevkifatsız faturanın tutarına dokunulmaz. Elle değiştirilmiş tutara
  dokunulmaz.
- **İçeri alınmış gider faturaları:** Paraşüt'teki kalemler (`purchase_bill_details`).

Kalemler Faturalar'da faturayı açınca **Kalemler** bölümünde görünür (`GET /api/faturalar/{id}/kalemler`):
miktar, net birim fiyat, KDV, bağlı hammadde ve bu faturadaki fiyatı (₺/kg, ₺/L, ₺/adet).

Ekrandaki **Ürün → hammadde bağlantıları** (yalnız mal alışı, Temizlik & Sarf ve "Diğer" kategorisindeki faturaların
kalemleri listelenir; komisyon, kira, demirbaş, yazılım, reklam ve hizmet faturaları gelmez):

- Paraşüt ürününü (ya da açıklamasını) bir hammaddeye bağlayın ve **çarpanı** yazın: Paraşüt'teki 1 birim kaç
  hammadde birimi? (ör. "Süt 1 L" → süt hammaddesi ml ise `1000`; "Koli 12×1 L" → `12000`). Çarpan hammaddenin
  birimiyle yazılır ve birim sonradan değişince kendi kendine çevrilmez: Hammaddeler'de birim değişirken pencere bağlı
  ürün sayısını, şubelerin kritik eşiklerini ve son 90 günün zayi / ikram kayıtlarını söyler, kayıttan sonra aynı
  uyarı çıkar; ölçü ailesi değişiyorsa (gr / ml ↔ adet / dilim; çarpan 1000 kat yanlış kalırdı) "Birimi … yapmayı
  onaylıyorum" işaretlenmeden kaydedilmez, sunucu da reddeder (bulgu 41, `src/lib/ingredient-unit.ts`). Çarpanı
  burada yeni birimle yeniden girin.
- O kalemden gelen miktar × çarpan, ayın **alınan miktarı** olur (Tutarlılık ekranı); iade faturaları düşülür (ayın
  toplamı 0 ise 0 yazılır). Çarpanı onay bekleyen kalem sayılmaz (5b). Elle girilmiş alınan miktar satırlarına
  dokunulmaz; yalnızca notu tam olarak "Paraşüt faturalarından" olanlar yönetilir. Tutarlılık'ta böyle bir satır elle
  düzeltilirse notu silinir ve artık eşitlemeye ait olmaz. Tutarlılık'ın **Alım yok (0)** düğmesinin satırı ("Bu ay alım
  yok") elle girilmiş sayılmaz: o ayın faturası sonradan gelirse yerini faturadaki miktar alır.
- "Fiyatı güncelle" açıksa, en yeni faturadaki birim fiyat (iskonto sonrası, KDV hariç) hammaddenin paket fiyatı
  olur, paket boyu çarpan olur ve fiyat geçmişine "Paraşüt" olarak yazılır (değişim %0,5'ten küçükse yazılmaz).
  Şimdiki birim fiyattan %40'tan fazla farklı fiyat uygulanmaz, onaya düşer (5b). Bedava gelen kalem (%100 iskonto)
  miktara girer, fiyata girmez.
- **Öneriler** (`src/lib/product-match.ts`): aynı adlı (boyut hariç) ürün daha önce bağlandıysa o hammadde; çarpanı
  yalnız paket de aynıysa (boy ve adet) alınır, değilse addan yeniden tahmin edilir ("SÜT 1 LT" bağlıyken "SÜT 5 LT").
  Bardak ve kapak boyu (oz, cc) farklıysa ayrı üründür, önceki bağlantı önerilmez (8oz bağlıyken 14oz bardak). Bağlı
  benzeri yoksa hammadde adının sözcüklerinin hepsi ürün adında geçiyorsa o hammadde. Çarpan addaki paket bilgisinden
  tahmin edilir: "SÜT 1 L" (Adet) → 1000 ml, "330ML 1X24" (Kutu) → 24 adet ya da 7920 ml, "KUTU İÇİ 9 ADET" → 9,
  tek parçada tek başına yazan paket sayısı "150 AD." (Adet) → 150 (`packEvidence`, [FATURA-OKUMA.md](FATURA-OKUMA.md));
  faturada o kadar ya da daha çok alınmışsa ("PEÇETE 100 LÜ" 120 adet) çarpan boş kalır, sahibi yazar. İki sayılı adda
  ("50'Lİ X 20", "20 PK X 50 AD") Koli / Kutu / Kasa'da ikisinin çarpımı (1.000); Adet ya da Paket'te hangisi olduğu
  belli değil, çarpan boş kalır ve form olasılıkları gösterir: bir paket ya da hepsi; Adet'te faturada en az bir paket
  kadar alındıysa tek tane de ("100 AD X 10 PK", 1.000 Adet × 1,10 ₺ → 1, 100 ya da 1.000; E-06).
  Yazılan çarpan addaki kanıttan farklıysa form uyarır ("150 yap"); **Faturadan oku** çarpanı faturanın kendisinden
  okur (Claude Haiku). Bağlı ürünlerden çarpanı kanıtla tutmayanlar sayfanın **Kontrol edilecek bağlantılar** kutusunda.
  Sezgisel öneri bulamazsa ya da yalnız ad benzerliğiyle bulursa **AI ile öner** (5e) sorar. Her bekleyen satırda öneri
  ayrı kutuda görünür: kaynağı, hammadde, çarpan, güveni, gerekçesi ve uyarıları; **Uygula** formu doldurur.
  **Hazır olanları bağla** önerisi ve çarpanı belli bütün bekleyenleri listeleyip tek seferde bağlar; yalnız sizin
  seçtikleriniz ve yüksek güvenli öneriler işaretli gelir.
- Hammadde olmayan kalemler (kargo, nakliye, hizmet bedeli, klişe, pompa, ekipman) bağlanmaz: **Hammadde değil**
  denince önce **nereye yazılacağı** sorulur (25 Kasım 2026): **Sarf** (Temizlik & Sarf gideri), **Demirbaş** (Kuruluş &
  Demirbaş; Vergi › Demirbaş'ta "Demirbaş denen kalemler" önerisi, sahip listeye ekler), **Hizmet** (Hizmet gideri) ya da
  **Deneme** (numune, denemelik gıda: mal alışı). Kalem bekleyenlerden ve zildeki sayıdan çıkar; listenin altındaki
  "Hammadde değil" bölümünden **Geri al** ile bekleyenlere döner. Liste `integration_state`'te (`parasut.productIgnore`,
  nedeniyle) durur. Nedeni olmayan eski işaretler faturanın kategorisinde kalır (rakam değişmez). Pencerede **"Bu
  tedarikçi: hep hammadde değil"** işaretlenirse tedarikçi kuralı da açılır (aşağıda).
- **Tedarikçi kuralı "hep hammadde değil"** (25 Kasım 2026; `parasut.supplierIgnore`, `src/lib/product-ignore.ts`
  `IgnoredSupplier`): kural açık tedarikçinin hammaddeye bağlı **olmayan** kalemleri bekleyenlere ve zile düşmez, kuralın
  nedeninin yerine yazılır (ör. temizlik firması → Hizmet, Avansas → Sarf). Zaten bir hammaddeye bağlı kalem (çay, soda)
  etkilenmez, mal alışı kalır; ürünün kendi "hammadde değil" nedeni kuraldan önce gelir. Tedarikçi adın eşleşme
  anahtarıyla tanınır (parantezli not, büyük/küçük harf sayılmaz). Açılıp kapandığı yerler: Paraşüt sayfasının "Hep
  hammadde değil" bölümü (kaldır) ve "Hammadde değil" penceresi; tedarikçi sayfasının "Paraşüt kalemleri: hep hammadde
  değil" seçicisi (Kapalı / Sarf / Demirbaş / Hizmet / Deneme; tedarikçinin bütün adlarına yazılır).
- Bağlanmayı bekleyen ürün sayısı zilde görünür.
- **Hammadde seçici** (25 Kasım 2026): her bekleyen kartta ve bağlantı düzenlemede **aranabilir tek seçici**
  (`ingredient-combobox.tsx`): kapalıyken alan gibi görünen düğme, dokununca arama kutulu pencerede kategori kategori
  liste (arama ve Enter kuralı reçete önerisindeki seçiciyle aynı, `src/lib/ingredient-search.ts`; Türkçe harf ve
  büyük/küçük harf farkı gözetmez; satırlar en az 44 px). Önceden her kart 108 seçenekli tam listeyi çiziyordu (sayfa
  ~90 bin karakter); artık hammaddeler sayfada bir kez gönderilir ve bütün satırlar paylaşır.
- **Mal alışı sayılmayan fatura** (denetim 26 Eki, E-07; 25 Kasım 2026'dan beri kalem kalem sayıldığı için yalnız
  komisyon faturasında kalabilir, aşağıda 5f): kalemi hammaddeye bağlı ama kategorisi mal alışı (Hammadde &
  İçecek, Tatlı & Hazır Ürün, Ambalaj) ya da kafe dışı olmayan fatura ("Diğer", "Hizmet"…) stoğa girer (alınan miktar,
  FIFO partisi, hammadde fiyatı) ama gelir-gider onu mal alışı saymaz: satılan malın maliyeti eksik, kâr fazla görünür.
  Böyle fatura kontrol bekleyene düşer ve onaylanamaz (6b). Kalemler stoktan çıkarılmaz: sayılan stok o malı zaten
  içerir, çıkarmak kâr-zararı düzeltmez, yalnız stok değerini bozar.

Böylece Tutarlılık'ta **alınan** (faturalardan) ile **satışa göre kullanılan** (satılan adet × reçete) karşılaştırılır;
iki ayın stok sayımı girilince gerçek tüketim (devir + alınan − devreden) ve sapma hesaplanır.

### 5a. Zam uyarısı

Hammadde fiyatı her değiştiğinde fiyat geçmişine yazılır (elle, ilk aktarım, Paraşüt faturası). Stok sayımının "Listeye
ekle"si ve reçete önerisinin "Yeni malzeme"si de yazılan (tahmini) paket fiyatını geçmişin başlangıcı olarak yazar:
kapanmış ay o fiyatla değerlenir, sonraki zam onu değiştirmez; zam uyarısı bu başlangıç satırını saymaz. Tahmin
yanlışsa (fiyat ya da paket içeriği) yönetici Hammaddeler'den düzeltir: kalem hâlâ **Tahmini** ve geçmişinde yalnız
başlangıç satırı varken düzeltme yeni satır açmaz, başlangıcın yerine geçer (anı kalır); kalemin eklendiği kapanmış ay
da düzeltilen fiyatla değerlenir, düzeltilen fiyat zam uyarısının tabanı olur. Tahmini işareti kalkınca sonraki her
değişiklik zamdır. Paraşüt faturası tahmini düzeltmez: faturanın fiyatı geldiği günden geçerlidir (yeni satır,
kapanmış aya dokunmaz). Fatura gelmeden yanlış tahmini Hammaddeler'den düzeltin. Fiyatsız eklenen kalemin ilk gerçek
fiyatı önceki ayları da değerler. Son 30 günde fiyatı
%5'ten fazla artan hammaddeler ve bu yüzden maliyeti %1'den fazla artan ürünler hesaplanır (`price-impact.ts`):
eski maliyet, zamlanan hammaddenin pencereden önceki fiyatıyla aynı reçeteden bulunur. Zamdan sonra maliyet oranı
hedefin üstündeki ürüne fiyat önerilir; öneri şu ikisinin küçüğüdür (5 ₺'ye yukarı): hedef oranı tutturan fiyat
(⌈maliyet ÷ hedef × (1 + KDV); 5⌉) ve zamdan önceki oranı koruyan fiyat (fiyat × yeni maliyet ÷ eski maliyet).
Zamdan önce hedefte olan ürüne hedef fiyat yeter; zaten hedefin üstünde olana (hazır alınan tatlı gibi) yalnız
zammın payı önerilir. Fiyatı öneriden düşük ürün uyarı olur:

- Genel bakış › Dikkat edilmesi gerekenler ve zil: "Hammadde zammı: N ürünün fiyatı hedefin altında kaldı";
- sabah e-postası: yalnız son zam e-postasından sonraki yeni zamlar (her sabah yinelenmez);
- Ürünler › **Hammadde zamları** (`#zamlar`): eski → yeni maliyet, maliyet oranı, birim kâr; **Fiyatı X ₺ yap**
  ya da **Böyle kalsın** (maliyet daha da artarsa yeniden uyarılır; ikisi de geri alınır). Zam yokken kartın yerinde
  "Hammadde zamları: son 30 günde maliyeti artan ürün şu an yok." satırı durur; Yardım'ın ve e-postanın `#zamlar`
  bağlantısı ona iner (denetim UI-08);
- ürün kartında not, Hammaddeler'de "↑ %16" rozeti.

Aylık kâr etkisi Ürünler › Hammadde zamları'nda (ve ürün kartında, uyarıda, zilde, e-postada): her ürünün maliyet
artışı son satış ayındaki adediyle çarpılır, ayda açık gün sayısına çevrilir (`price-loss.ts`; "Ayda ≈ 1.240 ₺ kâr
kaybı").

Onay bekleyen fiyat (5b) fiyat geçmişine yazılmaz: onaylanana kadar zam uyarısı ve fiyat önerisi çıkmaz; onaylanınca
zam onay anıyla sayılır.

**Stok değerlemesi (FIFO, 26 Ekim 2026).** Fiyat geçmişi reçete maliyetini (son alış fiyatı) ve FIFO öncesi ayların
sayımını değerler. Ayarlar › Stok değerleme'deki başlangıç ayından itibaren ay sonu stoğu doğrudan fatura kalemlerinden
değerlenir: hammaddeye bağlı her kalem (miktar × çarpan, net tutar) fatura tarihiyle bir partidir, sayılan miktar en
yeni partiden geriye dağıtılır (`src/server/data/purchase-lots-query.ts`). "Fiyatı güncelle" kapalı bağlantının
faturası da gerçek alıştır, partiye girer. Çarpanı şüpheli kalem (5b) girmez: bağlantının bugünkü çarpanıyla onay
bekleyen fiyat varsa o ürünün bütün faturaları, bugünkü çarpanla reddedilmiş fiyatın yalnız kendi faturası. Kalemler
her eşitlemede yeniden yazıldığı için partiler her okumada türetilir. Bağlantının çarpanı sonradan düzeltilirse eski
çarpanla açılmış öneriler bir şey dışlamaz ve FIFO'lu ayların stok değeri de düzelir. Ayrıntı:
[STOK-DEGERLEME.md](STOK-DEGERLEME.md).

### 5b. Fiyat onayı (büyük fiyat sıçraması)

Bağlı ürünün en yeni faturasındaki birim fiyat hammaddenin **şimdiki** birim fiyatından **%40'tan fazla** farklıysa
(artış ya da düşüş) kendiliğinden uygulanmaz, **onaya düşer** (`src/lib/price-hold.ts`, `applyProductLinks`). Yanlış
çarpan (koli ↔ adet, kg ↔ gr) ya da tek seferlik bir fatura bütün reçete maliyetlerini sessizce değiştirmesin, sahte
"Hammadde zammı" uyarısı ve fiyat önerisi çıkmasın. %40 ve altı eskisi gibi sessizce uygulanır (tam %40 uygulanır).

- Şimdiki fiyatı olmayan (0 ₺; personelin sayımdan fiyatsız eklediği kalem) hammaddenin **ilk fiyatı** yalnız çarpan
  faturanın ölçü biriminden geliyorsa (KG, LT, düzine: `firstPriceCertain`) doğrudan yazılır. Çarpan addan, açıklamadan
  ya da elle geldiyse ilk fiyat da onaya düşer (denetim 26 Eki, E-06: "KARTON BARDAK 8 OZ 50'Lİ X 20" 1 Koli = 50 adet
  bağlanmıştı, adet 8 ₺ onaysız yazılıyordu). Kart "İlk fiyat" der. İlk aktarımdan gelen tahmini ("Tahmini") fiyat da
  şimdiki fiyattır: ilk Paraşüt fiyatı ondan %40'tan fazla farklıysa onaya düşer.
- Su ve buz (fiyatı su faturasından) hiç onaya düşmez.

**Nerede görünür** (yalnız yönetici): Hammaddeler › **Onay bekleyen fiyatlar** (`#fiyat-onayi`), listede "Fiyat
onayda" rozeti ve hammadde penceresinde not (**Onaya git**), zilde Onaylar başlığı, Genel bakış › Dikkat edilmesi
gerekenler ("Fiyat onayı: N hammadde"), sabah e-postasının Paraşüt bölümü (yalnız son e-postadan beri gelen öneri
e-postayı gönderir ve konuya girer), Paraşüt sayfasındaki bağlama bildirimleri (**Bak**) ve eşitleme özeti ("N fiyat
onaya düştü"). Bekleyen öneri ve son 3 günde karar yoksa kartın yerinde "Onay bekleyen fiyat şu an yok" satırı durur;
Yardım'ın `#fiyat-onayi` bağlantısı sayfanın başına değil ona iner (denetim UI-08).

**Kart:** şimdiki ve faturadaki birim fiyat (₺/kg, ₺/L, ₺/adet), canlı fark, tedarikçi, tarih, fatura no (Faturayı
aç), faturadaki ürün ve çarpan, bir önceki fatura (başka tedarikçi olabilir), etkilenen ürünler (en çok değişenin
maliyeti) ve arka arkaya benzer fiyat ("Son 2 faturada da bu fiyat"). En çok bir **Çarpanı X yap**, kanıta göre (ilk
tutan; ayrıntı [FATURA-OKUMA.md](FATURA-OKUMA.md) § 2). Addaki paket boyu ile faturanın emin okuması çelişirse düğme
yoktur, iki değer birlikte yazılır (E-06):

1. kalemin adındaki ya da birimindeki paket boyu çarpandan farklıysa: `Adında “150 AD.” yazıyor: 1 Adet = 150 adet
   olmalı. Öyle olursa adet başı 20,00 ₺ (şimdikinden %52 ucuz).`;
2. faturanın okunması (Claude Haiku 5.5), emin ya da büyük olasılıkla ve çarpandan farklıysa: `Faturada: “…”. 1 Adet =
   150 adet → adet başı 20,00 ₺ (…).`; az emin okumada düğme yok, "Emin değil; faturayı açıp bakın.";
3. fiyat şimdikinin yaklaşık tam katı ya da bölümüyse (2–20 ve paket boyları, 1000'e kadar; ±%5) çarpan uyarısı, ama
   **yalnız aynı ürünün geçmişi varsa**: aynı Paraşüt ürününün önceki ücretli faturası bu çarpanla şimdiki fiyatın ±%10'unda
   (tedarikçi koli ↔ adet değiştirdi). Yeni tedarikçi ya da ürün, tahmini fiyat karşısında oran gösterilmez (canlıda
   "Yenilebilir bardak 150 AD." için "Çarpanı 72 yap", "Klips kapak" için "Çarpanı 10 yap" demişti).

Önerilen çarpanla birim fiyat ve şimdikine göre fark her zaman yazar. Kanıtı ve okuması olmayan kart açılınca fatura
bir kez kendiliğinden okunur ("Fatura okunuyor…"; günlük okuma sınırının yarısına kadar, kalanı fotoğraflara);
öteki kartlarda **Faturayı oku** / **Yeniden oku**. Okuma sabah
işinde hiç çalışmaz, fiyat yazmaz. Hammaddenin şimdiki fiyatı tahminiyse kart "Şimdiki fiyat tahmini (varsayım),
faturadan gelmedi. Faturadaki fiyat ilk gerçek fiyat olabilir." der, rozet "tahmini fiyata göre".

- **Onayla:** fiyat yazılır, "Tahmini" kalkar (aynı işlemde; işlem geçmişinde "tahmini fiyat kalktı"), fiyat geçmişine
  "Paraşüt" olarak onaylayanın adıyla girer. Bağlantı öneri anından beri değiştiyse (silindi, çarpanı ya da hammaddesi
  değişti, fiyat güncellemesi kapandı), faturanın kalemi fiyat kapsamından çıktıysa ya da hammaddenin daha yeni bir
  faturası geldiyse (eşitleme henüz değerlendirmeden) öneri geçersiz sayılır, fiyat yazılmaz.
- **Reddet:** şimdiki fiyat kalır; isteğe bağlı not ve "Bu üründen fiyat güncellemesini kapat" (sonraki faturaların
  miktarı yine sayılır). Reddedilen fatura yeniden sorulmaz; sonraki fatura yine %40'tan fazla farklıysa sorulur.
  Reddedilen faturanın miktarı alınana ve stok değerine girmez (çarpanı şüpheli kaldı); pencere bunu söyler,
  Tutarlılık o ayın alımını elle yazdırır.
- **Çarpanı X yap:** bağlantının çarpanı değişir (Paraşüt sayfasındaki düzenlemeyle aynı): öneri geçersiz olur, en yeni
  fatura yeni çarpanla yeniden değerlendirilir, alınan miktarlar da düzelir.
- **Geri al** (bildirimde ve kartın **Son kararlar** bölümünde; 30 gün): onay geri alınınca eski paket fiyatı, boyu ve
  "Tahmini" işareti döner (fiyat o arada değiştiyse geri alınmaz); red geri alınınca kapatılan fiyat güncellemesi
  yeniden açılır. Öneri yeniden onay bekler. Karardan sonra hammaddenin daha yeni faturası geldiyse ikisi de geri
  alınmaz: fiyatı artık o fatura belirler, eski faturanın fiyatı yenisinin üstüne yazılmasın. Son kararlar son 3 günü
  gösterir (geçersiz kalanlar nedeniyle).
- Toplu onay yok: her öneriye bakılsın. Bekleyen öneri kendiliğinden düşmez.

**Sonraki faturalar:** her en yeni fatura bir kez, her zaman hammaddenin şimdiki fiyatına göre değerlendirilir
(`parasut.prices`): %0,5'ten az fark bekleyen öneriyi geçersiz sayar ("Daha yeni faturada fiyat aynı"); %40 ve altı
fiyatı uygular ve bekleyen öneriyi geçersiz sayar; %40'tan fazla fark bekleyen önerinin yerini alır. "Son N faturada da
bu fiyat": hammaddenin son faturalarından arka arkaya kaçında birim fiyat ±%10 aynı (arada başka fiyatlı fatura sayımı
keser; ilk kez bağlanan ürünün eski faturaları da sayılır). Onaylanan fiyat sonrakilerin tabanıdır. Bağlantı silinince,
çarpanı ya da hammaddesi değişince, "Fiyatı güncelle" kapanınca, fatura kafe dışına taşınınca ya da Paraşüt'te iptal
edilen elle girilmiş kaydın kalemleri silinince bekleyen öneri geçersiz olur; değişiklik geri dönünce ("Fiyatı güncelle"
yeniden açılır, aynı çarpanla yeniden bağlanır, fatura kafeye döner) aynı fatura yeniden değerlendirilir, daha eskileri
değerlendirilmez. Fatura silinince öneri de silinir; fiyat yeniden önerilmez (uygulanan fiyatta da böyledir). Hammaddenin fiyatı elle değişirse öneri bekler, kart canlı farkı gösterir.
Alınan miktar (Tutarlılık) da bekler (denetim 26 Eki, E-27): çarpanı onay bekleyen bağlantının faturaları stok
partilerine girmediği gibi alınan miktara da girmez (ortak yüklem `suspectFactorLine`); reddedilen fiyatın yalnız kendi
faturası dışarıda kalır. Tutarlılık bekleyen öneri için malzemeyi "Fiyat onayı bekliyor" diye işaretler (onaya
götürür), sapmasını onaydan sonra hesaplar; yalnız reddedilen fatura dışarıda kaldıysa "Reddedilen fatura alınana
girmedi · miktarı Alınan'a yazın" der (onaya götürmez: bekleyen kart yok). Ayın alımı elle yazılınca (notu eşitlemenin
ya da "Alım yok (0)"un değil) iki işaret de kalkar, sapma o miktarla hesaplanır. Onay, red, geri alma ve kararın
geçersiz kalması (bağlantı değişti, daha yeni fatura) alınan miktarı bütün aylar için hemen yeniden hesaplar
(`recomputePurchaseQuantities`); eşitleme de her çalışmada bütün ayları yeniden yazar: öneri pencere dışındaki eski
ayların faturalarını da dışladığı için yalnız pencereyi yazmak o ayları alımsız bırakırdı.

**Veri:** `ingredient_price_holds`: hammadde başına en çok bir bekleyen öneri (kısmi tekil dizin), fatura anındaki
kalemin kopyası (kalemler her eşitlemede yeniden yazılır), karar, red notu ve geri alma için değiştirilen fiyat.

### 5c. Tedarikçilere göre fiyat

Hammadde penceresinde (Hammaddeler › hammaddeye dokunun) **Tedarikçilere göre fiyat**: hammaddeye bağlı bütün Paraşüt
ürünlerinin ("Fiyatı güncelle" kapalı olanlar da) faturalarından tedarikçi tedarikçi birim fiyat (₺/kg, ₺/L, ₺/adet;
KDV hariç, iskonto düşülmüş; `src/lib/supplier-prices.ts`, `GET /api/hammaddeler/[id]/fiyatlar`). Kafe dışı faturalar
girmez; onay bekleyen fiyatın faturası da gerçek bir alım olarak listededir.

- Tedarikçiler, Tedarikçiler ekranındaki gibi gruplanır (kart adı, diğer adlar, vergi no; `loadSupplierLedger`);
  "Paraşüt tedarikçisi" kendi grubundadır. Adına dokununca tedarikçi sayfası açılır.
- Her tedarikçi: son fiyat ve tarih, bir önceki faturasına göre değişim, en ucuzdan farkı, son 12 ayın en düşük – en
  yüksek ve miktarla ağırlıklı ortalama fiyatı, faturaları (aynı faturanın kalemleri tek satır).
- **En ucuz** yalnız son 90 günde en az iki tedarikçiden alınmışsa; son alımı 90 günden eski olan **Eski fiyat**. Sıra:
  son 90 günde alınanlar ucuzdan pahalıya, sonra eskiler en yeni alım önce.
- Bedava kalem ve iade fiyata girmez, altta sayısı yazar. Yanlış çarpan ₺/kg'ı burada da bozar; çarpanı düzeltmek ikisini
  birden düzeltir.

### 5d. Teslim kontrolü (mal siparişi; kaldırıldı)

Eşitleme eskiden panelden gönderilen mal siparişlerini gelen faturalarla karşılaştırıyordu. Mal siparişi 26 Ekim
2026'da panelden kaldırıldı ([MAL-SIPARISI.md](MAL-SIPARISI.md)); eşitleme, ürün bağlantısı ve **Kalemleri şimdi
oku** artık sipariş karşılaştırmaz, özette sipariş satırı yazmaz. Eski siparişlerin tablosu (`supplier_orders`)
geçmiş için durur, eşitleme ona dokunmaz.

### 5e. AI ile öneri (Claude Sonnet 5.5)

Sahibin isteği (24 Kasım 2026): "Ürün → hammadde bağlantıları kısmını Anthropic API key'den de yardım alarak
önerilenleri çıkartmayı daha netleştir; çok API yemeden Sonnet". Sezgisel öneri (5) yalnız aynı ürün bağlıysa kesindir;
ad benzerliği tahmindir, adında hammaddenin adı geçmeyen ürüne ("PINAR TAM YAĞLI 1L", "LİVİ 150 AD.") hiç öneri yoktu.

- **Ne zaman:** yalnız bölümün üstündeki **AI ile öner** düğmesiyle (bekleyen ürün varken). Sayfa açılınca istek
  gitmez. Düğme anahtar yoksa (yerel, önizleme), **Ayarlar › Fotoğraftan okuma** kapalıysa ya da bugünkü sınır dolduysa
  kapalıdır, nedeni yanında yazar; bölüm o zaman bugünkü gibi çalışır.
- **Kime sorulur:** sayfadaki bekleyenlerden (en sık 40) sezgiselin "aynı ürün bağlı" diyemediği ve geçerli saklı önerisi
  olmayanlar. Aynı ürün bağlıysa o öneri AI'den önce gelir, AI'ye sorulmaz (API tasarrufu).
- **İstek:** `claude-sonnet-5-5`, efor `medium` (yanlış çarpan birim fiyatı ve reçete maliyetini bozar; düşünme payı
  tasarruftan değerli; efor açıkça gönderilir ve `ai_calls.effort`'a yazılır), JSON şemalı çıktı
  (`output_config.format`), reddedilirse sunucu tarafında yedek model (`fallbacks: "default"`). `thinking`, sıcaklık ve
  ön doldurma gönderilmez. Partide en çok **10 ürün**, tek istek; ekran kalan bitene kadar partileri sırayla ister.
  (İsteğin ilk hâli "40'lık partiler" diyordu; 10 bilinçli sapma: süreyi belirleyen çıktı, "medium" eforda Sonnet 5.5
  hemen her yanıttan önce düşünür. Ürün başına JSON ~50–60 token, parti başına tahmin 1,5–4 bin token çıktı; canlıda
  **ölçülmedi**. 20'lik parti bu tahminin üst ucunda 45 sn'ye dayanabilirdi; kesilen parti öneri döndürmez, yeniden
  basış aynı partiyi gönderir. İlk canlı partilerde `ai_calls`'taki `ms`, `output_tokens`, `cache_read_tokens` ve
  `cache_write_tokens`'a bakılır: 10'luk parti 20 sn'nin çok altındaysa `MATCH_BATCH_SIZE` büyütülür, 45 sn'ye yakınsa
  efor `low`a iner.) Servis çağrısı en çok 45 sn sürer ve eylemin başından en geç 48 sn'de kesilir (önündeki okumalar
  uzarsa çağrının süresi kısalır); kalan süre doğrulama, saklama ve günlüğe. Kesilen çağrı sunucu günlüğüne eforla
  yazılır (`[eslestirme] öneri … efor medium timeout`); kullanım bilgisi gelmediği için `ai_calls`'ta 0 $ görünür ama
  günlük sınırdan bir parti yer. Eylem sayfayı kendisi yenilemez; ekran partiler bitince ayrı istekte yeniler. Sistem
  istemi (talimat, etkin hammaddeler, örnekler) önbelleğe yazılır: aynı basıştaki sonraki partiler onu önbellekten okur
  (milyon token 0,10 $). Kazancı küçük: önek ~3–7 bin token, okuması parti başına birkaç kuruş; maliyetin çoğu çıktı.
  Örnekler ve fiyatlar hemen her bağlantıda değiştiği için önbellek bir basıştan ötekine nadiren tutar.
- **Ne gönderilir:** etkin hammaddelerin kimliği, adı, birimi, kategorisi, paket açıklaması ve birim maliyeti; sistemin
  kendi bağlantılarından en çok **60 örnek** (ürün adı, faturadaki birim, hammadde, çarpan; önce her hammaddeden biri):
  model bu işletmenin geçmiş kararlarından öğrenir. Partideki ürünlerin adı, açıklaması, faturadaki birimi, son birim
  fiyatı (KDV hariç), son miktarı ve tedarikçinin adı. **Bağlam** (25 Kasım 2026; AI "KRP END KONTY"yi toner sandı,
  aslında çöp torbası): ürünün en yeni faturasının açıklaması ve kategorisi, aynı faturadaki öteki kalemlerin adları (en
  çok 8) ve tedarikçinin "hammadde değil" denmiş kalemlerinin adları (en çok 6; `matchContext`, `contextParts`).
  Yönerge bağlamı okumayı ve sık kısaltmaları (END endüstriyel, KONTY konteyner, TRB torba, PŞT poşet, DTRJ deterjan…)
  söyler; bağlam kısaltmayı çözmüyorsa "emin değil". İstemin sürümü 2: eski saklı öneriler bir kez yeniden sorulur. Fatura
  no, vergi no, kişi adı, **faturanın notu** (elle yazılır, kişisel bilgi taşıyabilir) ve belge gitmez.
- **Ne döner:** her ürün için karar (bağla / hammadde değil / emin değil), hammadde kimliği, çarpan, güven (yüksek /
  orta / düşük) ve en çok 120 karakterlik Türkçe gerekçe.
- **Doğrulama** (`src/lib/product-match-ai.ts`): listede olmayan hammadde kimliği (uydurma) reddedilir, öneri "emin
  değil" olur; 0,001–1.000.000 dışındaki çarpan düşer; addaki paket boyuyla çelişen çarpan (kanıt "150 AD." ya da
  "SÜT 1 LT"nin katı olmayan çarpan) ve şimdiki birim fiyatın 3 katından fazla / 3'te birinden az fiyat uyarı olur, her
  biri güveni bir basamak düşürür. Yanıtta olmayan ürün "emin değil" saklanır (yeniden sorulmaz).
- **Ekran:** her bekleyen satırda öneri kutusu: kaynak rozeti (**Aynı ürün bağlı** / **Ad benzerliği** / **AI**),
  hammadde ve çarpan ("1 Adet = 1.000 ml"), güven rozeti (yüksek yeşil, orta sarı, düşük gri), tek satır gerekçe,
  uyarılar, **Uygula** (formu doldurur, kaydetmez) ve **Yoksay** (bu sayfada gizler). Uyarısız ad benzerliği ve uyarısız
  yüksek güvenli "aynı ürün bağlı" önerisi tek satırdır (rozetler, özet, **Uygula**; gerekçe ipucunda): AI'den önce liste
  aynı kalıp kutularla uzamasın. Öneri varken ürünün adı geniş ekranda da kesilmez (çarpan addaki paketle
  karşılaştırılır). AI "hammadde değil" derse **Hammadde değil olarak işaretle** (bugünkü işaretleme, geri alınır).
  **Hazır olanları bağla** penceresine AI önerileri de girer; yalnız yüksek güvenliler ve sizin seçtikleriniz işaretli
  gelir. Düğme işaretli gelecek sayıyı da yazar ("Hazır olanları bağla (6 / 18)"); pencerede **Tümünü işaretle** /
  **İşaretleri kaldır** var (anahtarsız ortamda ad benzerliği önerileri işaretsiz gelir). **Bağlantı yalnız "Bağla" ya da penceredeki onayla
  kurulur**; AI'nin söylediği hiçbir şey kendiliğinden yazılmaz.
- **Saklama:** doğrulanmış öneriler `integration_state` › `parasut.aiSuggestions`'ta: hammadde listesinin özeti (kimlik,
  ad, birim; fiyat değil) ve ürün anahtarı → öneri (önerilen hammaddenin o anki birimiyle). Ürün hâlâ bekliyorsa sayfa
  yenilenince yeniden sorulmadan gösterilir. Liste değişince (hammadde eklenince, adı, birimi ya da etkinliği değişince)
  öneriler tek tek denetlenir: "hammadde değil" ve hammaddesi hâlâ etkin, birimi aynı "bağla" önerisi kalır; "emin değil"
  (çoğu "listede yok" dediği ürün; eksik hammadde yeni eklenmiştir) ve hammaddesi kalkan ya da birimi değişen öneri
  yeniden sorulur. Bir hammadde eklemek bütün önerileri yeniden sordurmaz. İstemin sürümü (`MATCH_PROMPT_VERSION`)
  değişince hepsi geçersiz. Bağlanan ya da "hammadde değil" denen ürünün önerisi sonraki yazımda düşer. İstem ve modelin ham yanıtı saklanmaz; `ai_calls`'a yalnız maliyet
  satırı yazılır (zaman, kişi, token, tutar). **Tam yedeğe girer** (`src/lib/backup/format.ts`'in dışarıda bıraktıkları
  yalnız şifreli ya da kişisel değerler; bu kayıt ürün adı, hammadde kimliği, çarpan ve gerekçe taşır, gizli değildir;
  geri yüklemede hammadde kimlikleri de aynı döner, öneriler geçerli kalır).
- **Maliyet ve sınır:** girdi 2 $, çıktı 10 $ / milyon token; önbellek okuma 0,10 $, 5 dakikalık yazma 2,50 $. 10 ürünlük
  parti ~3–7 bin token sistem (önbellek) + ~0,5 bin token ürün + 1,5–4 bin token yanıt (düşünme dahil; tahmin, canlıda
  ölçülecek): parti başına yaklaşık 0,02–0,06 $. Günde en çok **40 parti** (`MATCH_DAILY_CAP`, 400 ürün, işletme için;
  en kötü gün ~1–2,5 $); fotoğraf ve fatura okumasının sınırına sayılmaz. Aynı
  anda tek istek (başka sekmede sürüyorsa "başka bir sekmede sürüyor" der). Sınır ve tek istek denetimi `ai_calls`'ın
  "running" satırıyla aynı işlemde, danışma kilidiyle yapılır (`src/server/ai/claude.ts`): iki sekme ya da çift basış
  aynı anda gelse de yalnız biri gider, sınır aşılmaz. 70 sn'den eski "running" satırı (çöken istek) engellemez. Özetteki
  "uydurma hammadde reddedildi" sayısı doğrulanmış önerilerden sayılır. Düğmenin yanında bu ayın ürün önerisi istekleri
  ve tutarı yazar; Ayarlar › Fotoğraftan okuma'daki "Bu ay" tutarı bunları da sayar.
- **Yerelde:** `AI_REPLAY=1 npx next dev` sentetik yanıt verir (istemdeki hammaddelerden: adı geçen hammadde, kargo /
  hizmet "hammadde değil", gerisi "emin değil"). Testler: `tests/urun-eslestirme-ai.test.ts` (doğrulama, öncelik, parti,
  önbellek anahtarı, istek gövdesi, kaynak kuralları), `tests/urun-eslestirme-ai-db.test.ts`
  (`ESLESTIRME_TEST_DATABASE_URL`; saklama, yeniden sormama, sınırlar).

### 5f. Kalem kalem sınıflandırma (karışık fatura, 25 Kasım 2026)

Sahibin isteği: Avansas gibi hem gıda hem sarf satan tedarikçinin faturası bütünüyle ya mal alışı ya gider sayılıyordu.
Artık fatura **kalem kalem** sayılır (`src/lib/invoice-split.ts`, yükleyici `src/server/data/invoice-split.ts`;
testler `tests/fatura-kalem.test.ts`, `tests/fatura-sube-db.test.ts`):

| Kalem | Nereye |
|---|---|
| Hammaddeye bağlı (fatura hangi kategoride olursa olsun) | **Mal alışı** (mal maliyeti; Gelir-gider'de tedarikçinin satırı) |
| "Hammadde değil" · Sarf / Demirbaş / Hizmet / Deneme (ürünün işareti ya da tedarikçinin kuralı) | Temizlik & Sarf / Kuruluş & Demirbaş / Hizmet / mal alışı |
| Ötekiler (bekleyen, nedensiz "hammadde değil", kalemi okunmamış) | **Faturanın kategorisi** (önceki kural) |

- **Tutar**: faturanın KDV hariç, iskonto düşülmüş tutarı (tutar − iskonto) kalemlere **net tutarlarıyla orantılı**
  bölünür; fatura altı iskonto (ör. 500 ₺) da böylece kalemlere oranla düşer. Kuruş yuvarlaması en büyük kalan
  yöntemiyle: payların toplamı faturanın tutarını kuruşu kuruşuna tutar. Kalem tutarı da fatura tutarı da KDV hariç;
  ödenecek (KDV dahil) tutar harcama satırının nakit planı için aynı oranla bölünür. İade (eksi) faturada paylar eksi.
- **Bölünmeyenler**: kafe dışı (karaoke box, Alp Koç) ve komisyon faturaları; kalemi olmayan (elle girilmiş, içe aktarılmış) faturalar;
  hiçbir kalemi faturanın kendi payından ayrılmayan faturalar (mal faturasının bağlı kalemi zaten mal alışı). Bunların
  rakamı **değişmez**.
- **Kalemin nedeni ve tedarikçi kuralı** nereden gelir: "Hammadde değil" penceresi (Sarf, Demirbaş, Hizmet, Deneme) ve
  "hep hammadde değil" tedarikçi kuralı (yukarıda, 5). Ürünün kendi nedeni kuraldan önce gelir; hammaddeye bağlı kalem
  ikisinden de etkilenmez. Neden ya da kural değişince eşitleme beklenmez: paylar her okumada yeniden hesaplanır
  (`loadSplitLines`; alınan miktar, FIFO ve hammadde fiyatı değişmez).
- **Okuyanlar** aynı payları kullanır: Gelir-gider (mal alışı, tedarikçi satırları, harcamaya bağlı fatura kategorileri,
  "aynı gider iki kez" denetimi), Genel bakış ve mal maliyeti (`goodsPurchases`), Faturalar'ın "Mal maliyeti" satırı ve
  ayın **mal alımı kartının dökümü** (mal kategorileri faturanın mal payıyla, öbür kategorideki faturaların hammadde
  kalemleri "Öbür faturaların hammadde kalemleri" grubunda; döküm kartın rakamını tutar), Ayarlar önizlemesinin başabaşı
  (harcamaya bağlı kategoriye payı düşen faturalar kalemleriyle gider), Vergi (SMM'nin mal faturaları ve fatura
  giderleri; demirbaş nedenli kalem varlık listesine eklenene kadar gider; köprünün "hesap döneminden önceki faturalar"
  satırı da faturanın mal payıyla), dışa aktarımın "Aylık Alımlar" sayfası (kategori satırları faturanın kategorisiyle
  kalır, fark "Kalem kalem: mal alışına geçen" satırında; mal maliyeti panelinkiyle aynı).
- **Okumayanlar** (bilerek): nakit planı ve ödemeler (fatura bütün ödenir), KDV (indirilecek KDV kalemden bağımsız),
  Faturalar'ın kategori tablosu ve süzgeci (faturanın kategorisi), alınan miktar ve FIFO (zaten kalemden).
- **"Mal alışı sayılmıyor" kontrolü** (E-07, `stock-only-invoices.ts`): kalemi hammaddeye bağlı Diğer / Hizmet /
  Temizlik & Sarf faturası artık mal alışını sayar; elle düzeltme ("Kalsın", kategoriyi mal alışı yapmak) gerekmez.
  Kontrol yalnız komisyon faturasında kalır. Önceden bu yüzden kontrole düşmüş faturalar kontrol bekleyen kalır ama
  rozeti düşer; **Onayla** artık onaylar (ekranın uyarısı da `stockOnlyCategory` ile yalnız komisyonda). "Kalsın" kararları (`invoices.stockOnlyAccepted`) yalnız komisyon faturasında
  anlam taşır.
- **Davranış değişikliği** (sahibe söylenecek): kategorisi mal alışı olmayan ve kalemi hammaddeye bağlı faturaların o
  kalemleri geçmiş aylarda da mal alışına geçer (önceden "Kalsın" denmiş temizlik faturasındaki süt dahil): o ayların mal
  alışı artar, ilgili harcama satırı (bağlıysa) aynı tutar azalır; harcamaya bağlı değilse (ör. "Diğer" bağlı değilken)
  gider toplamı o kadar artar. Nedeni seçilmiş "hammadde değil" kalem yalnız neden seçildikten sonra yer değiştirir:
  mal faturasındaki "Demirbaş" denmiş kalem mal alışından çıkar (Kuruluş & Demirbaş harcamaya bağlı değilse Gelir-gider'e
  hiç girmez, bütün demirbaş faturası gibi), "Sarf" denmiş kalem sarf giderine geçer.

**Eski kuralla karşılaştırma** (25 Kasım 2026; `scripts/fatura-kalem-karsilastir.ts`, kural
`src/lib/invoice-split-compare.ts`, kilit `tests/fatura-kalem-karsilastirma.test.ts`). Aynı veride eski kural (fatura
bütün, kategorisine göre; şube seçiliyken şubesi boş fatura işletme geneli) ile yeni kural ay ay karşılaştırılır; eski
kuralın sonucu main'in kendi motoruyla birebir denendi (424 rakam, fark yok). Yerel bir veritabanında:
`DATABASE_URL=postgres://localhost/<yerel> npx tsx scripts/fatura-kalem-karsilastir.ts [--ornek]` (canlıya bağlanmaz;
gerçek veri için yedek yerel veritabanına geri yüklenir). Sonuç:

- **Başlangıç verisi** (`npm run db:seed`; kalemi olmayan faturalar): Tümü'de, Vergi'de hiçbir rakam değişmez. Şube seçiliyken faturaların
  hepsi "şubesi seçilmemiş" olduğu için şubenin mal alışı (bilgi) 0'a, "İşletme geneli payı" komisyon faturaları kadar
  iner; şubenin kârı değişmez ([SUBE.md › Faturanın şubesi](SUBE.md#faturanın-şubesi-25-kasım-2026)).
- **Örnek faturalar** (`--ornek`; Tümü): hizmet faturasındaki bağlı süt (Ağustos +200 mal alışı, kâr −200); Diğer
  faturasında bağlı çay 360 mal, "Sarf" çöp torbası 315 sarf (100 ₺ iskonto oranla düştü), mal faturasında "Demirbaş"
  ısıtıcı 10.000 ve "Sarf" deterjan 500 mal alışından çıkar (Eylül mal alışı −10.140, sarf +815, kâr +9.325); kuralı açık
  tedarikçinin bağlı sodası 500 sarftan mal alışına (Ekim; gider toplamı aynı). Sarf payları faturanın şubesine yazılır
  (Tümü'nün şube kırılımı). Vergi'de yalnız SMM alışı ile fatura giderleri arasında yer değiştirir; gider toplamı ve
  sonuç aynı. Her rakam testte kilitli.
- Karşılaştırmanın yakaladığı ve düzeltilenler: Faturalar'ın mal alımı dökümü kartı tutmuyordu (kategoriyle topluyordu),
  Ayarlar önizlemesinin başabaşı kalemleri görmüyordu, Vergi köprüsü dönem öncesindeki karışık faturada tutmuyordu.

**Bilinen sınırlar**: pay kalemin KDV hariç net tutarıyla orantılıdır; kalemde ÖTV gibi başka bir vergi ya da eksi
(iskonto) kalemi varsa oran yaklaşıktır (kalemler mutlak değerle tartılır). Kalemi okunmamış e-fatura bölünmez.

## 6. Gelen e-faturalar ("içeri al" gerekmez)

Paraşüt'e e-Fatura ağından gelen faturalar Paraşüt'te *Giderler → Gelen e-Faturalar* ekranında bekler; Paraşüt'te
**içeri al** yapılınca gider faturası olurlar. Panel bunu **beklemez**: belgelenmemiş `GET /v4/{firma}/e_invoices`
listesini her eşitlemede okur ve gelen her e-faturayı doğrudan fatura olarak yazar (`src/server/parasut/einvoice.ts`,
`sync.ts` → `syncEInvoices`). Canlı denemeyle doğrulandı (20 Eki 2026):

- Liste yalnız `sort=-issue_date` ile çalışır (süzgeç ve başka sıralamalar 400 döner, sırasız istek yanıt vermez);
  sayfa başına 25 kayıt. Gelen (`direction=inbound`) faturalar alınır; giden, reddedilen, arşivlenen ve döviz olanlar
  alınmaz.
- `external_id` fatura numarası, `issue_date` tarih, `contact_name` tedarikçi, `net_total` KDV dahil ödenecek,
  `total_vat` KDV. KDV hariç tutar = `net_total − total_vat` (e-fatura listesinde iskonto ayrıca gelmez). Tevkifatlı
  fatura "kontrol bekleyen" yazılır (tutarı belge okununca düzelir, bkz. 5). Gelen iade e-faturası (`IADE`,
  `TEVKIFATIADE`) satış iadesidir, gider olarak açılmaz; giden iade e-faturası tedarikçiye iadedir, listelenir (bkz. 2a).
- Kalemler `signed_ubl` belgesinden okunur (bkz. 5). `ubl`, `xml`, `html` uçları yoktur (404).
- **Ödeme (vade, valör) tarihi** belge okununca yazılır (`ubl.ts` → `readPayment`): sırayla ödeme alanı
  (`PaymentMeans/PaymentDueDate`), ödeme koşulları (`PaymentTerms/PaymentDueDate`), notlar ("Vade Tarihi: 26.10.2026",
  "Son Ödeme Tarihi", "Valör", "Vade Günü: 15", "30 gün vade"). Fatura gününden önceki ya da 400 günden uzak tarih
  yazım hatası sayılır. Ödeme şekli `PaymentMeansCode`'dan (10 nakit, 48 kart, 42 havale…), "Peşin" notu ya da vade =
  fatura günü peşin sayılır. E-faturada ödeme bilgisi yoktur: e-faturadan açılan kayıt **ödenmedi** gelir ve
  belgedeki vadesiyle Ödemeler & hatırlatıcılar'a düşer; ödendiğini siz işaretlersiniz. Takip başlamadan önceki tarihli
  e-fatura (geçmişi yeniden alırken) ödendi açılır, belgedeki vadesi henüz gelmemişse ödenmedi olur (notta "vade
  e-faturadan"). İçe aktarılmış / elle girilmiş kaydın ödeme durumuna dokunulmaz, yalnız boş vadesi doldurulur.
- **Çift sayım olmaz:** e-fatura önce kendi kimliğiyle (`invoices.e_invoice_id`), sonra içe aktarılmış / elle girilmiş aynı
  faturayla § 3'ün kurallarıyla (tam numara ±31 gün, aynı tarih ya da tutar ±1 ₺; GİB portalı numarasında aynı
  tedarikçi) eşleşir; eşleşen kayda bağlanır. İçe aktarılmış kaydın tutarı ve tarihi aynıysa dokunulmaz, farklıysa
  e-faturadaki yazılır ve kayıt "kontrol bekleyen" olur; not değişen alanı söyler: "tutar e-faturaya göre güncellendi
  (önce 1.100 ₺)", "tarih … (önce 07.11.2026)" ya da ikisi birden (denetim FC-X1). E-fatura Paraşüt'te reddedilir ya
  da arşivlenirse içe aktarılmış / elle kaydın e-fatura bağı çözülür, kaynağı eskisine döner ("Paraşüt'te e-fatura reddedildi —
  kontrol edin"): tarih, no ve tutarlar yeniden düzenlenir (denetim FC-02; bozulmuş eski kayıtları
  `0064_fatura_kaynagi_onarimi` bir kez onardı). Fatura sonradan Paraşüt'te
  içeri alınırsa gider faturası (`active_e_document` bağıyla) **aynı kayda** bağlanır; o zaman Paraşüt'teki ödeme
  kaydı da ipucu olarak gelir.
  Kalemleri e-fatura belgesinden okunmuşsa korunur (ürün anahtarları değişmez, hammadde bağlantıları düşmez),
  okunmamışsa Paraşüt'ün gider faturasından okunur.
- Muhasebeci e-faturayı "içeri al" yerine Paraşüt'e **elle gider faturası** olarak girerse (bağ yok) gider faturası
  önce yazılır; e-fatura aynı tam fatura numarasıyla (±31 gün, aynı tarih ya da tutar ±1 ₺; GİB portalı numarasında
  aynı tedarikçi) o kayda bağlanır, ikinci kayıt açılmaz. Gider faturasına bağlı kaydın tutarı ve kalemleri gider faturasından gelir; e-faturanın sonradan
  arşivlenmesi ya da reddi bu kayda dokunmaz.
- Panelde silinen e-fatura kaydı `ei:<kimlik>` anahtarıyla yok sayılanlara eklenir, geri gelmez; e-fatura sonradan
  Paraşüt'te içeri alınsa da gider faturası olarak yeniden açılmaz (panelde aynı fatura başka bir kayıtta duruyorsa o
  kayıt bağlanır). Elle girilmiş gider faturasına bağlı kayıt silinince gider faturasıyla birlikte `ei:<kimlik>` de
  yok sayılır (§3; denetim 21 Kasım #3). Faturalar › Silinen Paraşüt faturaları'ndan geri alınır.
- e-Arşiv ve kâğıt faturalar API'de yoktur: Paraşüt'e elle girilirse gider faturası olarak gelir ya da panelde elle
  eklenip fotoğrafı/PDF'i yüklenir. Kasadan ödenmiş olanlar faturası gelene kadar Faturalar › Kontrol bekleyen'in
  **Kasadan faturalı alımlar** kartında durur; **Faturalar'a ekle** pencereyi kasadan doldurur ve fişin fotoğrafını
  belge yapar ([KASA-RAPORU.md](KASA-RAPORU.md) "Faturalı alımlar", denetim E-42). Aylık harcamalar'a yazılmış kasa
  alımının e-Arşiv'i sonradan Paraşüt'e girilirse aynı kartta "iki kez sayılıyor" diye çıkar: gider kaydını silin.

## 6a. Belgeler (PDF önizleme ve indirme)

- Paraşüt'ten gelen her faturada **Belge**: `GET /api/faturalar/{id}/belge` (yalnız yönetici). E-faturadan gelen
  kayıtta `GET /v4/{firma}/e_invoices/{id}/pdf` 1 saatlik bir indirme adresi döner (Paraşüt hazırlarken 204);
  gider faturasında `active_e_document` e-faturası, yoksa Paraşüt'teki `photo` görseli kullanılır. PDF ilk açılışta
  indirilir ve `invoice_documents` tablosunda saklanır; sonraki açılışlar anında gelir. `?indir=1` indirir.
- Paraşüt'te belgesi olmayan faturaya (elle girilmiş, içe aktarılmış) panelden **PDF ya da fotoğraf** eklenir
  (`POST` aynı adres, form alanı `dosya`, en çok 4 MB; tür içerikten denetlenir; fotoğraflar telefonda küçültülür).

## 6a-1. Kafe dışı faturalar (karaoke box, Alp Koç)

Aynı Paraşüt hesabına karaoke box'ların (MaviBahçe AVM, Opera Gayrimenkul) faturaları da gelir. Bunlar
**Karaoke box** kategorisindedir (`SEPARATE_CATEGORIES`): kafenin fatura toplamına, gelir-giderine, mal maliyetine,
Bu ayın işleri'ndeki fatura sayısına ve ürün bağlamaya girmez; Faturalar'ın aylık özetinde Toplam'ın altında ayrı
satırda görünür. "Opera Gayrimenkul" tedarikçi kuralı yeni faturaları kendiliğinden bu kategoriye koyar.

Kolayı ortak Alp Koç alır: kola ile Damla suyun birlikte geldiği Pruva faturaları **Alp Koç** kategorisindedir (aynı
kurallarla kafe dışı); Uludağ (Erbak) suları kafenindir. Yeni Pruva faturası tedarikçinin önceki faturalarına bakılarak
bu kategoriye düşer; kafe için gelen (kolasız) bir Pruva faturası olursa kategorisi elle değiştirilir. Kafe dışı
faturaların kalemleri, ürün kafeye de gelse, hammaddenin alınan miktarına ve fiyatına girmez (`applyProductLinks`).

## 6b. Kontrol bekleyen faturalar

Eşitlemenin açtığı yeni faturanın kategorisi kurala, tedarikçinin geçmişine ya da komisyon platformu listesine
dayanmıyorsa (ipucu ya da "Diğer") fatura **kontrol bekleyen** olur (`invoices.needs_review`). Faturalar'da
"Kontrol bekleyen" süzgeci, satırda tek dokunuşla **Onayla**, toplu onay; kategori değiştirmek ya da faturayı
kaydetmek de onaylar. Sayısı zilde, sabah e-postasında ve Genel bakış › Bu ayın işleri'nde görünür.

Kalemi hammaddeye bağlı ama o kalemi mal alışı sayılmayan fatura (5, E-07; 25 Kasım 2026'dan beri kalem kalem sayıldığı
için yalnız **komisyon** faturası, 5f) da kontrol bekleyene düşer: ürün bağlanınca,
kalemler okununca ya da eşitlemede (`flagStockOnlyInvoices`, `src/server/data/stock-only-invoices.ts`; işlem geçmişine
"Sistem · Fatura mal alışı sayılmıyor"). Satırda **Mal alışı sayılmıyor** rozeti, listenin üstünde ayrı bir satır,
zilde ayrı bir bildirim ve Bugün'de kendi cümlesi. **Onayla** da faturayı kaydetmek de böyle faturayı onaylamaz
(`confirmInvoices` → `kept`); kategoriyi mal alışı (ya da kalem kalem sayılan "Diğer", "Hizmet"…) yapmak onaylar.
Kategori bilerek öyle kalacaksa (komisyon faturasında bağlanmış bir kalem) **Kalsın** faturayı onaylar ve kararı
`integration_state`'e (`invoices.stockOnlyAccepted`) yazar: fatura yeniden kontrole düşmez, rozeti gri **Stoğa giriyor**
olur; kategorisi değişince karar düşer, **Geri al** kararı da geri alır. Kalsın dört yerde: "kontrolde kaldı" uyarısında
(birden çok faturada **Hepsi kalsın**), fatura penceresinin altında, satırın kategori sayfasında ("Komisyon kalsın") ve
"Kontrol bekleyen" süzgecinin alt çubuğunda (yalnız mal alışı sayılmayanlar kaldıysa **Hepsi kalsın**, onaylı
pencereyle). Alt çubuğun **Hepsini onayla**'sı yalnız kategorisi tahminle yazılanları sayar ve onaylar. Uyarı ve
"Kalsın" ekranda da aynı kuralla yalnız komisyon faturasında çıkar (`stockOnlyCategory`, `src/lib/invoice-linking.ts`).
Sabah e-postası iki nedeni ayrı yazar. 25 Kasım 2026'ya kadar "Diğer" ve "Hizmet" faturaları da bu kontrole düşüyordu;
o kararların ("Kalsın") yerini kalem kalem sayma aldı (`tests/fatura-stok-db.test.ts`).

## 7. Elle çalıştırma ve sıfırlama

- **Şimdi eşitle:** otomatik pencereyle hemen çalıştırır.
- **Kalemleri şimdi oku:** sıradaki e-faturaların kalemlerini beklemeden okur (her çağrı ~45 sn; ekran bitene kadar
  sürdürür).
- **Tarihten eşitle:** seçilen tarihten bugüne yeniden okur (geçmişi doldurmak için).
- Tek bir tedarikçinin bütün geçmişi için tedarikçi sayfasındaki **Geçmiş faturaları al** ([TEDARIKCILER.md](TEDARIKCILER.md#geçmiş-faturalar)):
  kişiye göre süzülür, listede görünmeyeni kaldırmaz (Paraşüt'te iptal edileni kaldırır), imleci değiştirmez;
  eşitleme geçmişinde "tedarikçi geçmişi" diye görünür, son eşitleme sayılmaz.
- **Oturumu sıfırla:** ekranın gösterdiği hesabın (seçili şubenin) kayıtlı oturumunu ve eşitleme imlecini siler (eski faturaların vergi no tamamlaması ve geç
  girilen faturaların kimliği de baştan başlar); mevcut faturalar çoğalmaz. Sonra hesabı **“Paraşüt hesabını bağla”**
  ile yeniden bağlamak gerekir.
- **Deneme:** `tests/parasut-esitleme-db.test.ts` eşitlemeyi sahte bir Paraşüt'e karşı gerçek Postgres'te çalıştırır
  (silinen / iptal edilen / yeniden içeri alınan e-faturalı fatura, eski faturası okunamayan yeniden içeri alma, satış
  ve tedarikçi iadeleri, geç girilen fatura, 100'den fazla yeni faturada süren tarama, 429 ve reddedilen yenileme,
  bağlı değilken istek atılmaması ve hesabı bağlama).
  Taramanın kuralları ayrıca Paraşüt'süz `tests/parasut-gec-fatura.test.ts`'te. Kendi geçici veritabanını açıp siler:
  `PARASUT_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/parasut-esitleme-db.test.ts`.
- Aynı anda tek eşitleme çalışır (Postgres danışma kilidi, `SYNC_LOCK`; birden çok Paraşüt hesabı da sırayla): sabah işi sürerken "Şimdi eşitle" ya da
  e-posta işinin yeniden denemesi başlamaz, "Paraşüt eşitlemesi zaten sürüyor" yanıtı döner. İki dakikadan eski
  "sürüyor" kaydı yarıda kesilmiş sayılır.
- Günlük işler (Vercel Cron, `Authorization: Bearer $CRON_SECRET`; Hobby planında her iş kendi saatinin bir
  saatlik penceresinde çalışır): `GET /api/cron/parasut` 07:00–08:00 (04:30 UTC) Paraşüt'ü eşitler;
  `GET /api/cron/gunluk` 08:00–09:00 (05:00 UTC) sabah e-postasını gönderir. Paraşüt işi o sabah başarıyla
  çalışmadıysa e-posta işi önce bir kez daha eşitler; böylece e-postaya o sabahın faturaları girer.
- Vercel → lafmaliyet → Settings → Cron Jobs ekranında iki iş görünür; **Run** ile elle çalıştırılabilir,
  **View Logs** son çalışmaları gösterir. Panelde **Ayarlar › Günlük işler** iki işin son çalışmasını ve adımlarını
  gösterir; çalışmayan ya da hata veren iş zilde ("Sistem"), Genel bakış'ta ve e-postayla bildirilir. Paraşüt işi
  eşitlemeden önce dünkü sabah işine de bakar (bekçi; [BILDIRIMLER.md](BILDIRIMLER.md) › Sistem uyarıları).

## 8. Açık noktalar

Paraşüt'ün belgeleri bazı ayrıntıları söylemiyor; ilk gerçek eşitlemede kontrol edin:

- `include=supplier` belgelenen listede yok ama topluluk istemcilerinde çalışıyor; reddedilirse istemci tedarikçisiz
  ister ve adları `/contacts/{id}`'den okur.
- `gross_total` / `net_total` anlamı her faturada hesapla doğrulanır; eşitleme geçmişinde ve faturalarda tutarlara
  bir kez göz atın.
- Test (sandbox) ortamı için Paraşüt'ten ayrı bilgiler gerekirse `PARASUT_BASE_URL` ile adres verilebilir.

Kaynaklar: [apidocs.parasut.com](https://apidocs.parasut.com/) (Swagger: `swagger.json`), Paraşüt destek sayfaları,
açık kaynak istemciler (leventcz/parasut-php, yigitkonur/mcp-parasut, Zoho-Parasut-Sync). Araştırmanın ayrıntılı notu
(İngilizce, kaynak bağlantılarıyla): [parasut-api-spec.md](parasut-api-spec.md).

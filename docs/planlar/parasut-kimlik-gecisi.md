# Paraşüt kimlik doğrulama geçişi (OAuth 2.0 + PKCE)

**Kaynak:** Paraşüt'ten gelen duyuru e-postası (5 Kasım 2026'da alındı).
**Panelde etkilenen yer:** `lafmaliyet` → Paraşüt entegrasyonu (gider faturaları ve gelen e-faturalar, her sabah
07:00–08:00 arası eşitleme).
**Durum (21 Kasım 2026):** kod hazır (PR #92). Birleştirilmesi artık güvenli: hesap bağlanana kadar eşitleme eski
yöntemle sürer (aşağıda *Geçici yedek*). Sahibin yapacakları aşağıda, sade dille.

## Neden

Panel bugüne kadar **`grant_type=password`** ile belirteç alıyordu: `PARASUT_USERNAME` + `PARASUT_PASSWORD` ile
`POST https://api.parasut.com/oauth/token`. Paraşüt bu yöntemi **10 Aralık 2026**'da kapatıyor. Hesap o güne kadar yeni
yöntemle bağlanmazsa o sabah eşitleme durur: Paraşüt'teki faturalar panele düşmez, hammadde fiyatları ve Ödemeler &
hatırlatıcılar güncellenmez.

## Önemli tarihler

| Tarih | Ne oluyor |
|---|---|
| 6 Kasım 2026 (geçti) | Eski geliştirme ve test ortamına erişim kapandı. Panelin canlı kurulumu bu ortamı kullanmıyordu (`PARASUT_BASE_URL` tanımlı değil, varsayılan `https://api.parasut.com`). |
| **1 Aralık 2026** | Geçişin planlanan günü: panel bu günden itibaren Genel bakış şeridinde de hatırlatır. |
| **10 Aralık 2026** | Eski kimlik doğrulama ve eski API istemcileri devre dışı. Panel bu andan (00:00, İstanbul) itibaren eski yöntemi hiç denemez. |

## Paraşüt'te neler değişti

- Tüm API erişimi yeni kimlik sunucusuna taşındı: **`https://id.parasut.com`**, **OAuth 2.0 Authorization Code +
  PKCE** (OpenID Connect).
- `grant_type=password` 10 Aralık 2026'da **kaldırılıyor**; e-posta + parolayla belirteç alınamayacak.
- Yeni istemciler yalnız **Paraşüt DevHub**'dan alınıyor. E-postayla (`destek@parasut.com`) istemci ya da dönüş
  adresi talebi alınmıyor.
- **Mevcut `api.parasut.com/oauth/*` istemcileri yeni altyapıya aktarılmadı:** yeni `client_id` / `client_secret`
  almak gerekiyor.
- Yeni istemciler varsayılan olarak *confidential* (client_secret'lı) ve **PKCE zorunlu**. `scope=openid` ve `state`
  bekleniyor.
- `refresh_token` **30 gün** geçerli ve her yenilemede yenisi dönüyor.
- Bağlantıyı kuran son kullanıcıda **“Uygulama Entegrasyonları”** yetkisi olmalı. Bu yetki şirket sahibi dahil
  herkeste **varsayılan kapalı**; yoksa istekler **403** dönüyor.
- Kullanıcı verdiği izni Paraşüt'ten durdurabiliyor (Profilim › Uygulama Entegrasyonları › **DURDUR**); durdurulunca
  `refresh_token` `invalid_grant` döner.

## Kodda yapılanlar

Dal: `claude/nifty-galileo-guzjfr` (PR #92).

- `src/lib/parasut/oidc.ts` **(yeni, saf)** — PKCE doğrulayıcısı ve S256 sınaması (RFC 7636), keşif belgesinin
  okunması ve güvenlik denetimleri, yetki adresinin kurulması.
- `src/server/parasut/oidc.ts` **(yeni)** — keşif belgesini (`{issuer}/.well-known/openid-configuration`) indirir ve
  6 saat bellekte tutar. **Uç noktalar koda yazılmadı**: belgeden okunuyor (gerekirse env ile elle verilebilir).
- `src/server/parasut/connect.ts` **(yeni)** — "Paraşüt hesabını bağla" akışı: PKCE + `state` üretimi, 10 dakika
  geçerli ve tek kullanımlık bekleyen istek (şifreli), yetki kodunun belirteçle değişimi. Bağlanınca eski yöntemin
  belirteci silinir.
- `src/app/panel/parasut/baglan/route.ts` ve `.../baglan/geri/route.ts` **(yeni)** — yalnız yöneticiye açık; Paraşüt'ün
  onay ekranına gidiş ve dönüş.
- `src/server/parasut/client.ts` — yeni yolda belirteç yalnız `refresh_token` ile yenilenir; `invalid_grant` gelirse
  kayıtlı oturum silinir ve ekran "yeniden bağlayın" der. Kayıtlı belirteç istemci + kimlik sunucusuna bağlı (eski
  belirteç kendiliğinden düşer). Parola yolu yalnız **geçici yedek** olarak kaldı (aşağıda).
- `src/server/parasut/config.ts` — zorunlu değişkenler **3**: `PARASUT_CLIENT_ID`, `PARASUT_CLIENT_SECRET`,
  `PARASUT_COMPANY_ID`. `PARASUT_USERNAME` / `PARASUT_PASSWORD` artık zorunlu değil, yalnız geçici yedek için okunur.
  İsteğe bağlı adres değişkenleri yanlış yazılmışsa uygulama durmaz (değer yok sayılır, bağlanma açık hatayla başlamaz).
- Panel ekranı (`/panel/parasut`) — "Paraşüt hesabını bağla" düğmesi, bağlantı durumu ("Bağlı / Bağlı değil /
  Yenilenmeli / Eski yöntem / Eski yöntem kapandı"), DevHub'a kaydedilecek dönüş adresi, uyarılar; kurulum adımları
  DevHub'a göre yazıldı.
- Yedek: Paraşüt oturumu yedeğe girmez; geri yüklemeden sonra hesap panelden yeniden bağlanır (`docs/YEDEK.md`).
- Belgeler: `docs/PARASUT.md` § 1–2 (sahibin adımları sade dille), `docs/parasut-api-spec.md` § 1'e eskidi uyarısı,
  `.env.example`.
- Testler: `tests/parasut-kimlik.test.ts` (PKCE, keşif, yetki adresi, geçici yedeğin kuralları, kaynak taraması),
  `tests/parasut-dokum.test.ts` (kart ve dökümü), `tests/parasut-esitleme-db.test.ts` (iki yol ve geçiş, sahte Paraşüt +
  gerçek Postgres), `tests/gunluk-isler.test.ts` (zil hatırlatması).

## Geçici yedek (eski parola yöntemi, 10 Aralık 2026'ya kadar)

**Sorun:** PR'ın ilk hâli parola akışını tamamen kaldırıyordu. Birleştirildiği gün, sahip DevHub'da istemci açıp
panelden "Paraşüt hesabını bağla"ya basana kadar sabah eşitlemesi dururdu; oysa Paraşüt eski yöntemi ancak 10 Aralık'ta
kapatıyor.

**Çözüm:** yol her eşitlemenin başında bir kez seçilir (`chooseParasutAuth`, `src/lib/parasut/legacy.ts`):

| Durum | Ne olur |
|---|---|
| Kayıtlı yeni oturum (`refresh_token`) var | Yalnız yeni yöntem. Eski kullanıcı adı/parola dursa da parolaya hiç dönülmez. |
| Yeni oturum yok, `PARASUT_USERNAME` + `PARASUT_PASSWORD` tanımlı, 10 Aralık 2026 00:00'dan önce | Eski yöntem: önce kayıtlı `refresh_token`, olmazsa `grant_type=password` (eski kodla aynı). Panelde sarı uyarı: *“Eski bağlantı 10 Aralık'ta kapanacak, Paraşüt hesabını bağlayın”*. |
| Yeni oturum yok, eski ayarlar duruyor, 10 Aralık 2026 00:00 ya da sonrası | Eski uca **istek atılmaz**. Hata: “Paraşüt eski kullanıcı adı ve parola yöntemini 10 Aralık 2026'da kapattı … yeniden bağlayın”. Panelde kırmızı uyarı. |
| Hiçbiri yok | “Paraşüt hesabı bağlı değil … Paraşüt hesabını bağla”. |

- Eski uç son tarihten önce kapanırsa ya da istemciyi reddederse (`unsupported_grant_type`, `invalid_client`,
  `unauthorized_client`, 401) eşitleme açık Türkçe hatayla durur: “… artık kabul etmiyor … “Paraşüt hesabını bağla”
  ile yeniden bağlayın”. Sahip 5. adımda Vercel'e yeni client_id'yi girdiğinde de bu olur: o yüzden 6. adım hemen
  ardından yapılmalı.
- Eski yöntemin belirteci ayrı anahtarda durur (`integration_state` › `parasut.legacyToken`), yeni oturumu hiçbir zaman
  ezmez; hesap bağlanınca ve "Oturumu sıfırla"da silinir; yedeğe girmez.
- Zil (`parasutMigrationAlert`, `src/lib/job-health.ts`): eski değişkenler dururken ve hesap bağlı değilken geçiş
  hatırlatması (aşağıdaki tablo); hesap bağlıysa yerine yalnız "eski kullanıcı adı ve parola artık gerekmiyor" notu
  (`info`).
- Dosyalar: `src/lib/parasut/legacy.ts` (saf kurallar, son tarih, eski uca giden gövde, retlerin metni),
  `src/server/parasut/legacy.ts` (ortam değişkenleri). Parola akışı yalnız bu ikisinde; `tests/parasut-kimlik.test.ts`
  kaynak taramasıyla denetler.

**10 Aralık 2026'dan sonra silinecekler** (ayrı, küçük bir PR): bu iki dosya; `client.ts`'teki `legacyAccessToken`,
`legacyRequest`, `loadLegacy`, `forgetLegacyParasutToken` ve yol seçimi (yalnız yeni yol kalır); `parasutConnection`'ın
`legacy` / `legacyEnv` alanları ve paneldeki "Eski yöntem" durumları; `parasutMigrationAlert`;
`EXCLUDED_STATE_KEYS` › `parasut.legacyToken`; ilgili testler. Vercel'de `PARASUT_USERNAME` / `PARASUT_PASSWORD`
kalmışsa silinir.

### Doğrulanamayan nokta

Kodu yazan oturumun ağ politikası `id.parasut.com`, `devhub.parasut.com` ve `apidocs.parasut.com` adreslerini
engelledi; yetki ve belirteç adreslerinin tam yolları **canlıda doğrulanmadı**. Bu yüzden adresler koda yazılmadı:
çalışma anında keşif belgesinden okunuyor. Paraşüt'ün duyurduğu gibi altyapı standart OpenID Connect ise bu
kendiliğinden çalışır. Keşif belgesi bir nedenle okunamazsa `PARASUT_AUTHORIZE_URL` ve `PARASUT_TOKEN_URL` ile elle
verilebilir (DevHub → "Yardımcı Kaynaklar"daki adresler). Geçici yedek sayesinde bu doğrulama 10 Aralık'a kadar
eşitlemeyi riske atmıyor: bağlanma başarısız olursa eski değerler geri yazılıp eski yönteme dönülebilir.

## Sahibin yapacakları (yazılımcı gerekmez)

Tek oturuşta, bilgisayardan, yaklaşık 15 dakika. **10 Aralık 2026'dan önce** (planlanan gün 1 Aralık). Daha ayrıntılı
hâli ve sık takılınan yerler `docs/PARASUT.md` § 1'de.

1. **DevHub'da uygulama açın.** Paraşüt DevHub'a kendi Paraşüt hesabınızla girin, *“Paraşüt Kullanıcısıyım”* ile
   başvurun (kendi firmamız için; "İş Ortağı" değil). Uygulama hemen oluşur. Adı Paraşüt'te görünür: "L'Affogato
   Panel" gibi anlaşılır bir ad verin.
2. **Dönüş adresini yazın.** Başvurudaki *dönüş adresi* (redirect URI) kutusuna tam olarak şunu yapıştırın (sonunda
   eğik çizgi yok): `https://ladmin.laffogato.net/panel/parasut/baglan/geri`
3. **İki değeri alın:** `client_id` ve `client_secret`. client_secret şifre gibidir; kimseyle paylaşmayın, mesaja
   yazmayın.
4. **Paraşüt'te izin verin:** Paraşüt › Ayarlar › Kullanıcılar › (siz) › Düzenle › **Uygulama Entegrasyonları**'nı
   açıp kaydedin (varsayılan kapalı; açılmazsa 403).
5. **Vercel'de iki değeri değiştirin:** vercel.com › lafmaliyet › Settings › Environment Variables:
   `PARASUT_CLIENT_ID` ve `PARASUT_CLIENT_SECRET`'a yenilerini yazın. `PARASUT_USERNAME` / `PARASUT_PASSWORD`'e
   şimdilik dokunmayın. Sonra Deployments › en üstteki yayın › ⋯ › **Redeploy**.
6. **Hemen ardından panelde bağlayın:** Ayarlar › Paraşüt entegrasyonu › **“Paraşüt hesabını bağla”**. Paraşüt'ün giriş
   ekranında girip izin verin. Panele dönünce “Paraşüt hesabı bağlandı” yazar, sarı uyarı kalkar.
7. **Deneyin:** **Bağlantıyı dene** → **Şimdi eşitle**.
8. **Temizlik:** çalışıyorsa Vercel'den `PARASUT_USERNAME` ve `PARASUT_PASSWORD`'ü silin.

Takılırsanız: onay ekranı hata veriyorsa client_id hâlâ eski olabilir, Redeploy yapılmamış olabilir ya da dönüş adresi
birebir aynı değildir. 403: 4. adım. Geri dönmek gerekirse (10 Aralık'a kadar): Vercel'e eski client_id / client_secret'ı
geri yazıp Redeploy edin; eşitleme eski yöntemle sürer. Paraşüt'ün geçiş desteği: `devhubdestek@parasut.com`. Teknik
belgeler DevHub sitesindeki "Yardımcı Kaynaklar" sayfasında.

## Düşen iş

`docs/planlar/KALAN-ISLER.md` § 11'deki **D-16** ("sitenin `PARASUT_USERNAME`'i panelinkinden farklı mı") geçersiz:
yeni yöntemde Paraşüt API'sinde kullanıcı adı/parola diye bir ayar yok (10 Aralık'a kadarki geçici yedek hariç).

## Panel içi hatırlatma (PR #93, main'de)

Geçiş 1 Aralık'ta elle yapılacağı için o günü kaçırmamak adına panelin kendisi hatırlatıyor
(`parasutMigrationAlert`, `src/lib/job-health.ts`):

| Dönem | Seviye | Nerede | Metin |
|---|---|---|---|
| … – 30 Kasım | `warning` | zil, Ayarlar › Günlük işler | "Paraşüt kimlik geçişi bekliyor (1 Aralık) · N gün kaldı" |
| 1 – 9 Aralık | `warning` + `banner` | **+ Genel bakış şeridi** | "Paraşüt kimlik geçişini bugün yapın" |
| 10 Aralık – | `danger` + `banner` | Genel bakış şeridi | "Paraşüt bağlantısı kapandı: kimlik geçişi yapılmadı" |
| Hesap bağlı, eski değişkenler duruyor | `info` | zil | "Paraşüt'ün eski kullanıcı adı ve parolası artık gerekmiyor" |

Uyarı yalnız ortamda `PARASUT_USERNAME` / `PARASUT_PASSWORD` dururken çıkar. Hesap yeni yöntemle bağlanınca geçiş
uyarısı kalkar, yerine yalnız `info` notu kalır; değişkenler silinince o da kalkar. Son tarihe kadar `warning` kalması
bilinçli: `danger` olsa `/api/health` 503 dönerdi ve eski yöntemle süren bir eşitleme sistem çökmüş gibi görünürdü.
Metin artık "PR #92'yi birleştirin" demiyor; DevHub değerlerini girip hesabı bağlamayı söylüyor.

**PR'ların sırası:** #93 birleşti. #92 geçici yedek sayesinde 1 Aralık'ı beklemeden birleştirilebilir: birleştiği gün
hiçbir şey değişmez (eşitleme eski yöntemle sürer, panelde sarı uyarı çıkar); geçiş sahibin yukarıdaki adımlarıyla olur.

## Ek A — Paraşüt'e gönderilecek soru maili

Gmail'de taslak olarak hazır (`devhubdestek@parasut.com`). Köşeli parantezli alanlar doldurulmalı. Sorduğu şeyler:
başvuru yolunun teyidi, dönüş adresinin DevHub'dan kaydedilip kaydedilemediği, **yetki ve belirteç adreslerinin tam
adresleri ve keşif belgesinin yayında olup olmadığı** (bu oturumda doğrulanamayan kısım), gerekli scope'lar,
sunucu-sunucu kullanımda `refresh_token` için ek parametre gerekip gerekmediği, 10 Aralık'a kadar eski ve yeni
istemcinin paralel çalışıp çalışacağı, paketin API'yi içerip içermediği ve istek limitleri.

## Ek B — Claude for Chrome prompt'u (DevHub başvurusunu tarayıcıdan yapmak için)

```
Paraşüt'ün yeni API altyapısı için DevHub başvurusunu yapmana ve ayarları toplamana ihtiyacım var. Giriş ve onay ekranlarını ben geçeceğim; sen adımları yönet, bulduklarını bana yaz.

BAĞLAM
Kendi firmamız için geliştirilmiş bir iç panel Paraşüt API v4'ü kullanıyor (gider faturaları ve gelen e-faturaların okunması). Panel bugüne kadar grant_type=password ile çalışıyordu; Paraşüt bunu 10 Aralık 2026'da kaldırıyor. Yeni akış: OAuth 2.0 Authorization Code + PKCE, id.parasut.com üzerinden. Panelin kodu hazır, eksik olan DevHub'dan alınacak istemci bilgileri.

ADIMLAR

1) Paraşüt DevHub'ı bul ve aç. Doğrudan adresini bilmiyorum; parasut.com üzerinden "Geliştiriciler" / DevHub bağlantısını bul. Giriş ekranı gelirse dur ve bana söyle, girişi ben yapayım.

2) "Paraşüt Kullanıcısıyım" seçeneğiyle yeni bir uygulama başvurusu başlat. "İş Ortağı Olmak İstiyorum" DEĞİL — entegrasyonu yalnız kendi firmamızın verisi için kullanıyoruz.

3) Formu doldur ama GÖNDERMEDEN ÖNCE doldurduğun hali bana göster ve onayımı bekle:
   - Uygulama adı: bu ad Paraşüt'te son kullanıcıya görünüyor. "L'Affogato Panel" öneriyorum; daha uygun bir ad düşünüyorsan söyle.
   - Dönüş adresi (redirect URI) — tam olarak bu, sonunda eğik çizgi YOK:
     https://ladmin.laffogato.net/panel/parasut/baglan/geri
   - Başka zorunlu alan varsa bana sor. Firma, vergi ya da iletişim bilgisi UYDURMA.

4) Başvuru tamamlanınca client_id ve client_secret'ı ekranda bana göster.
   ÖNEMLİ: client_secret bir sırdır. Hiçbir yere kaydetme, kopyalama, başka bir forma ya da sohbete yapıştırma, ekran görüntüsü alıp paylaşma. Sadece ekranda göster; ben kendim kopyalayıp Vercel'e gireceğim.

5) DevHub'daki "Yardımcı Kaynaklar" (teknik doküman) sayfasını aç ve şunları bana aynen yaz:
   - Yetkilendirme (authorize) adresinin tam adresi
   - Belirteç (token) adresinin tam adresi
   - Gerekli / desteklenen scope'lar: scope=openid dışında bir şey gerekiyor mu? purchase_bills ve e_invoices okumak için ek izin var mı?
   - refresh_token kaç gün geçerli, her yenilemede yenisi dönüyor mu
   - Sunucu-sunucu (headless) kullanımda refresh_token alabilmek için istekte ek bir parametre gerekiyor mu (ör. çevrimdışı erişim, prompt=consent)

6) Şu adresi aç ve içeriğini (JSON) bana yaz:
   https://id.parasut.com/.well-known/openid-configuration
   Özellikle: issuer, authorization_endpoint, token_endpoint, scopes_supported, code_challenge_methods_supported, grant_types_supported. Sayfa açılmazsa ya da 404 verirse bunu da söyle — panel adresleri normalde buradan okuyor, yoksa elle gireceğiz.

7) uygulama.parasut.com'a geç ve şu yetkiyi aç: Ayarlar > Kullanıcılar > (bağlantıyı kuracak kullanıcı) > Düzenle > Uygulama Entegrasyonları. Bu yetki şirket sahibi dahil herkeste varsayılan olarak KAPALI ve açılmazsa API istekleri 403 veriyor. Hangi kullanıcıda açacağımı bana sor.

KURALLAR
- Hiçbir şeyi silme, mevcut bir ayarı ya da entegrasyonu değiştirme. Yalnız yeni başvuruyu oluştur ve istediğim yetkiyi aç.
- Para, fatura, abonelik ya da paket ile ilgili hiçbir işlem yapma.
- Emin olmadığın bir alan ya da buton görürsen bana sor; tahminle ilerleme.
- Sonunda kısa bir özet yaz: client_id, kaydedilen dönüş adresinin tam hali, uç nokta adresleri, scope'lar ve açtığın yetki. client_secret'ı özete YAZMA.
```

Chrome'dan dönen uç nokta adreslerini ve keşif belgesini bu nota ekleyin: `PARASUT_AUTHORIZE_URL` /
`PARASUT_TOKEN_URL` gerekirse oradan doldurulur.

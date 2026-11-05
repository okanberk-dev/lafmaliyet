# Paraşüt kimlik doğrulama geçişi (OAuth 2.0 + PKCE)

**Kaynak:** Paraşüt'ten gelen duyuru e-postası (5 Kasım 2026'da alındı).
**Panelde etkilenen yer:** `lafmaliyet` → Paraşüt entegrasyonu (gider faturaları ve gelen e-faturalar, her sabah
07:00–08:00 arası eşitleme).

## Neden acil

Panel bugüne kadar **`grant_type=password`** ile belirteç alıyordu: `PARASUT_USERNAME` + `PARASUT_PASSWORD` ile
`POST https://api.parasut.com/oauth/token`. Paraşüt bu yöntemi **10 Aralık 2026**'da kapattı. Hiçbir şey yapılmazsa o
tarihte sabah eşitlemesi durur: Paraşüt'teki faturalar panele düşmez, hammadde fiyatları ve Ödemeler & hatırlatıcılar
güncellenmez.

## Önemli tarihler

| Tarih | Ne oluyor |
|---|---|
| **6 Kasım 2026** (**yarın**) | Eski geliştirme ve test ortamına erişim kapanıyor. Orada saklanan veri varsa bugün taşınmalı. Panelin canlı kurulumu bu ortamı kullanmıyor (`PARASUT_BASE_URL` tanımlı değil, varsayılan `https://api.parasut.com`), ama Paraşüt'te ayrı bir test hesabı açılmışsa bugün kontrol edilmeli. |
| **10 Aralık 2026** | Eski kimlik doğrulama ve eski API bağlantıları devre dışı. DevHub başvurusu ve geçiş bu tarihe kadar tamamlanmalı. |

## Neler değişti

- Tüm API erişimi yeni kimlik sunucusuna taşındı: **`https://id.parasut.com`**, **OAuth 2.0 Authorization Code +
  PKCE** (OpenID Connect).
- `grant_type=password` **kaldırıldı**; e-posta + parolayla belirteç alınamıyor.
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

## Kodda yapılanlar (tamamlandı)

Dal: `claude/nifty-galileo-guzjfr`.

- `src/lib/parasut/oidc.ts` **(yeni, saf)** — PKCE doğrulayıcısı ve S256 sınaması (RFC 7636), keşif belgesinin
  okunması ve güvenlik denetimleri, yetki adresinin kurulması.
- `src/server/parasut/oidc.ts` **(yeni)** — keşif belgesini (`{issuer}/.well-known/openid-configuration`) indirir ve
  6 saat bellekte tutar. **Uç noktalar koda yazılmadı**: belgeden okunuyor (gerekirse env ile elle verilebilir).
- `src/server/parasut/connect.ts` **(yeni)** — "Paraşüt hesabını bağla" akışı: PKCE + `state` üretimi, 10 dakika
  geçerli ve tek kullanımlık bekleyen istek (şifreli), yetki kodunun belirteçle değişimi.
- `src/app/panel/parasut/baglan/route.ts` ve `.../baglan/geri/route.ts` **(yeni)** — yalnız yöneticiye açık; Paraşüt'ün
  onay ekranına gidiş ve dönüş.
- `src/server/parasut/client.ts` — parola akışı **kaldırıldı**. Belirteç yalnız `refresh_token` ile yenilenir;
  `invalid_grant` gelirse kayıtlı oturum silinir ve ekran "yeniden bağlayın" der. Kayıtlı belirteç artık istemci +
  kimlik sunucusuna bağlı (eski belirteç kendiliğinden düşer).
- `src/server/parasut/config.ts` — zorunlu değişkenler **3**'e indi: `PARASUT_CLIENT_ID`, `PARASUT_CLIENT_SECRET`,
  `PARASUT_COMPANY_ID`. `PARASUT_USERNAME` / `PARASUT_PASSWORD` **kalktı**.
- Panel ekranı (`/panel/parasut`) — "Paraşüt hesabını bağla" düğmesi, bağlantı durumu ("Bağlı / Bağlı değil /
  Yenilenmeli"), DevHub'a kaydedilecek dönüş adresi, bağlı değilken uyarı; kurulum adımları DevHub'a göre yazıldı.
- Belgeler: `docs/PARASUT.md` § 1–2 yeniden yazıldı, `docs/parasut-api-spec.md` § 1'e eskidi uyarısı eklendi,
  `.env.example` güncellendi.
- Testler: `tests/parasut-kimlik.test.ts` (yeni, 8 test — RFC 7636 örneği dahil), `tests/parasut-dokum.test.ts` ve
  `tests/parasut-esitleme-db.test.ts` yeni akışa göre güncellendi. Takımın tamamı geçiyor (2400 başarılı).

### Doğrulanamayan nokta

Bu oturumun ağ politikası `id.parasut.com`, `devhub.parasut.com` ve `apidocs.parasut.com` adreslerini engelledi; yetki
ve belirteç adreslerinin tam yolları **canlıda doğrulanmadı**. Bu yüzden adresler koda yazılmadı: çalışma anında
keşif belgesinden okunuyor. Paraşüt'ün duyurduğu gibi altyapı standart OpenID Connect ise bu kendiliğinden çalışır.
Keşif belgesi bir nedenle okunamazsa `PARASUT_AUTHORIZE_URL` ve `PARASUT_TOKEN_URL` ile elle verilebilir (DevHub →
"Yardımcı Kaynaklar"daki adresler).

## Yapılması gerekenler (sahip / muhasebe)

Kod hazır; bundan sonrası Paraşüt tarafında yapılacak işler.

1. **DevHub başvurusu.** Paraşüt DevHub'a Paraşüt hesabıyla girip *“Paraşüt Kullanıcısıyım”* ile başvurun (kendi
   firmamız için entegrasyon; "İş Ortağı Olmak İstiyorum" değil). İstemci hemen oluşur, inceleme beklenmez.
   Uygulama adı son kullanıcıya görünür; anlaşılır bir ad verin.
2. **Dönüş adresi (redirect URI).** Başvuruya tam olarak şunu kaydedin:
   `https://ladmin.laffogato.net/panel/parasut/baglan/geri`
3. **`client_id` ve `client_secret`'ı alın.** Bunlar eski değerlerden farklı olacak.
4. **Uygulama Entegrasyonları yetkisi.** Paraşüt → Ayarlar › Kullanıcılar › Düzenle › Uygulama Entegrasyonları:
   bağlantıyı kuracak kullanıcı için açın (varsayılan kapalı; yoksa 403).
5. **Vercel ortam değişkenleri** (lafmaliyet → Settings → Environment Variables, Production):
   - `PARASUT_CLIENT_ID` → yeni değer
   - `PARASUT_CLIENT_SECRET` → yeni değer
   - `PARASUT_COMPANY_ID` → değişmiyor
   - `PARASUT_USERNAME` ve `PARASUT_PASSWORD` → **silin** (artık kullanılmıyor)
   Sonra yeniden deploy edin.
6. **Hesabı bağlayın.** Panel → Ayarlar › Paraşüt entegrasyonu → **“Paraşüt hesabını bağla”**. Paraşüt'ün giriş ve
   onay ekranından geçin. Ardından **Bağlantıyı dene** ve **Şimdi eşitle**.
7. **Eski test ortamı (bugün).** Paraşüt'te ayrı bir geliştirme/test hesabı açılmışsa oradaki veriye erişim
   6 Kasım 2026'da kapanıyor; taşınacak bir şey varsa bugün taşınmalı. Canlı kurulum etkilenmiyor.

Takıldığınız yerde Paraşüt'ün geçiş desteği: `devhubdestek@parasut.com`. Teknik belgeler DevHub sitesindeki
"Yardımcı Kaynaklar" sayfasında.

## Düşen iş

`docs/planlar/KALAN-ISLER.md` § 11'deki **D-16** ("sitenin `PARASUT_USERNAME`'i panelinkinden farklı mı") geçersiz:
Paraşüt API'sinde kullanıcı adı/parola diye bir ayar kalmadı.

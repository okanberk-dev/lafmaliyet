# İş 3 özeti: sitenin e-Arşiv'i için Paraşüt OAuth (ajan brifi taslağı)

Repo: /workspace/laffogato (okanberk-dev/laffogato). Dal: `earsiv-oauth` (claude/ ile başlamaz), güncel origin/main'den.

## Neden
Site Paraşüt'e `grant_type=password` ile giriyor (src/lib/invoice/parasut-client.ts, `${baseUrl}/oauth/token`,
PARASUT_USERNAME/PASSWORD). Paraşüt bu yöntemi 10 Aralık 2026'da kapatıyor. Panel (lafmaliyet) 24 Kasım'da OAuth 2.0
Authorization Code + PKCE'ye geçti: /workspace/lafmaliyet/src/server/parasut/{oidc,connect,client,config,keys}.ts,
src/lib/parasut/{oidc,settings}.ts, docs/PARASUT.md § 1–2.

## Tasarım kararları (orkestratör)
- Site KENDİ DevHub uygulamasıyla bağlanır (panelin uygulaması paylaşılmaz): DevHub'da dönüş adresi tek ve değişmez;
  aynı istemci + aynı kullanıcıda yenileme belirteçleri birbirini düşürür (docs/EARSIV.md § 1 adım 1).
- Client ID / Client Secret site yönetim panelinden girilir (Faturalar › Bağlantı kartı), veritabanında şifreli durur
  (AES-256-GCM; anahtar ADMIN_SESSION_SECRET'tan HKDF ile türetilir, ayrı bağlam etiketi). Vercel'e yeni değişken
  GEREKMEZ. İsteğe bağlı ortam değişkenleri: PARASUT_ISSUER, PARASUT_AUTHORIZE_URL, PARASUT_TOKEN_URL, PARASUT_SCOPE,
  PARASUT_REDIRECT_URI (panelle aynı adlar ve varsayılanlar).
- Dönüş adresi: https://laffogato.net/admin/faturalar/parasut/geri (NEXT_PUBLIC_SITE_URL'den). Başlatma yalnız aynı
  kökenden POST (yönetici oturumu + köken denetimi), state'in SHA-256 özetiyle anılan tek kullanımlık, 10 dk'lık kayıt;
  code_verifier ve başlatan yönetici o kayıtta.
- Belirteçler veritabanında şifreli; yenileme tek uçuş + satır kilidi (SELECT … FOR UPDATE) ile (iki istek aynı anda
  yenilemesin: eski belirteç tek kullanımlık). invalid_grant → oturum silinir, ekran "yeniden bağlayın" der; geçici
  hata belirteci silmez.
- Geçiş: OAuth oturumu VARSA o kullanılır; YOKSA eski şifreli giriş aynen çalışır (10 Aralık'a dek). PARASUT_USERNAME /
  PASSWORD silinmez, kod onları okumaya devam eder. Ekran hangi yöntemin kullanıldığını ve son tarihi söyler.
- Canlı tutma: yenileme belirteci 30 gün; fatura kesilmese de günde bir yenilensin (var olan cron yoluna eklenir).
- Göç: db/migrations/ altına SQL + `npm run db:bundle`. Yalnız ekler (yeni tablo); var olan tablolara dokunmaz.
- Uyumluluk: EARSIV_MODE=off iken hiçbir istek atılmaz (bugünkü gibi). Sitenin öteki uçları değişmez.

## Sahibe düşen (kod bitince sorulacak; değer İSTENMEZ)
1. DevHub'da "L'Affogato Site" uygulaması: Redirect URL `laffogato.net/admin/faturalar/parasut/geri`, "Bir sunucudan".
2. Site yönetimi › Faturalar › Paraşüt bağlantısı: Client ID ve Client Secret'ı yapıştır, Kaydet.
3. Paraşüt › Ayarlar › Kullanıcılar › (sitenin kullanıcısı) › Uygulama Entegrasyonları açık.
4. "Paraşüt hesabını bağla" → sitenin Paraşüt kullanıcısıyla giriş → izin ver.

## Sahibin notu (28 Kasım 00:10) — iş ERTELENDİ
"DevHub'ı açtık zaten; maksat her şube kendi ekleyebilsin ve sorun olmasın. Paraşüt'ü kalanlara yaz, sen diğerlerini yap."
- İş sıradan çıktı, kalanlar listesine yazılır. Son tarih değişmedi: 10 Aralık.
- Tasarıma eklenen şart: bağlantı ŞUBE BAŞINA olmalı (panelin `parasut.settings:<şube>` modeli gibi): her şube kendi
  Client ID / Secret / firma numarasını girip kendi hesabını bağlayabilmeli; bir şubenin bağlantısı ötekini düşürmemeli.
- DevHub uygulaması zaten açılmış (hangi dönüş adresiyle açıldığı sorulacak: site için ayrı uygulama mı, panelinki mi).

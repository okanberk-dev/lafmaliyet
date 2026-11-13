# Claude'dan panele soru (salt okunur bağlantı)

Panel, Claude uygulamalarına (claude.ai web, Claude masaüstü, Claude telefon uygulaması) **özel bağlayıcı** olarak
eklenir. Sonra Claude'a Türkçe sorarsınız: "Ekimde en çok kâr kaybettiren 5 ürün?", "Bu yıl Kaldi'ye ne ödedik?",
"Geçen hafta kasa tuttu mu?". Claude panelin kendi hesaplarını okur (ekranlardaki rakamların aynısı), cevapta hangi ayın
verisine dayandığını ve hesabı gösterir, ilgili ekranın bağlantısını verir.

- **Salt okunur:** Claude panelde hiçbir şeyi değiştiremez, silemez, "ödendi" işaretleyemez.
- **Yalnız yönetici** bağlar; her yeni bağlantı panelde **parolanızla** onaylanır ve size e-posta gelir.
- Bağlantı **90 gün** geçerlidir; **Hesabım › Bağlı uygulamalar**'dan istediğiniz an kaldırırsınız.
- Adres: **`https://ladmin.laffogato.net/api/mcp`** (başka adres kullanmayın).

## 1. Bağlamak (bir kez)

Claude'un menü adları aşağıda Anthropic'in belgelerindeki İngilizce adlarıyla yazıldı (panelin Hesabım ve Yardım
metinleri de aynı adları kullanır). Bağlayıcılar Claude'da **Customize › Connectors** altındadır; doğrudan bağlantı:
https://claude.ai/customize/connectors.

1. **claude.ai'de (web) ya da Claude masaüstü uygulamasında** (telefon uygulaması bağlayıcı ekleyemez, eklenmiş olanı
   kullanır): **Customize › Connectors** (https://claude.ai/customize/connectors) › **Add custom connector**.
   Team / Enterprise planında: bir Owner **Organization settings › Connectors › Add › Custom** ile ekler, sonra her üye
   kendisi bağlanır.
2. Ad: `L'Affogato Panel`. **MCP server URL:** `https://ladmin.laffogato.net/api/mcp` (birebir; `vercel.app`
   adresi değil).
3. Pencere sorarsa: Authentication **Sign in now**; OAuth client **Use Claude's published identity** (ya da **Register
   automatically**). Client ID ve secret alanlarını **boş** bırakın, istek başlığı (header) eklemeyin. **Add**'e basın.
4. **Connect**'e basın. Tarayıcıda panel açılır: giriş yapın (iki adımlı doğrulama açıksa kodu da girin). "Claude
   panelinize bağlanmak istiyor" ekranında isteğin **claude.ai**'den geldiğini görün, parolanızı yazın, **İzin ver**'e
   dokunun. Claude bağlayıcıyı **Connected** gösterir; hesabınızın adresine "Panelinize Claude bağlandı" e-postası gelir.
5. İsteğe bağlı: bağlayıcının **Tool permissions** bölümünde panelin araçlarını **Always allow** yapın (hepsi yalnız
   okur). Yapmazsanız Claude her aracı ilk kullanışında izin sorar.
6. Bir sohbette **+ › Connectors** › **L'Affogato Panel**'i açın ve sorun.
7. Telefon: aynı hesapla Claude uygulamasını açın; sohbette **+ › Connectors** › açın.

Onay ekranında "Bu isteği siz başlatmadıysanız Reddet'e dokunun" uyarısı her zaman vardır: Claude'da az önce
**Connect**'e siz basmadıysanız (biri size bağlantı göndermişse) **Reddet**'e dokunun. Bağlantı yalnız
`claude.ai` / `claude.com` adreslerine dönebilir; başka bir siteye kod gitmez.

## 2. Claude ne görür, ne görmez

**Görür** (ekranlardaki gibi): ayın cirosu, giderleri ve kârı, reçeteye göre brüt ve net kâr, ay sonu tahmini,
başabaş; ürünlerin maliyeti, kârı, satış adedi, menü sınıfı; hammadde zamlarının aylık etkisi ve önerilen fiyatlar;
tedarikçilerin fatura toplamları, ödendi / kalan borç, vadeler, fatura numaraları; ödenmemiş ve yaklaşan ödemeler,
hatırlatıcıların başlıkları ve tutarları, 6 haftalık nakit planının haftalık toplamları; gün sonu kasa raporlarının
tutarları ve kasa farkları; ürün, hammadde ve tedarikçi adları.

**Görmez:** parolalar ve anahtarlar; kimsenin e-postası; tedarikçilerin IBAN'ı, vergi numarası, telefonu, adresi,
yetkili kişisi; notlar ve açıklamalar (fatura açıklaması, kasa raporu notu, "neye çıktı", hatırlatıcı notu); kasa
raporunu giren ya da kasayı sayan personelin adı; müşteri adları; kişi başına maaş (yalnız toplam personel gideri).
Dışarıdan gelen adlar (ürün, tedarikçi, hammadde, fatura no) satır sonu ve görünmez karakterlerden temizlenir, en çok
80 karaktere kısalır. Bu kurallar `tests/claude-araclar.test.ts`'in sızıntı taramasıyla sabittir.

Bu sürümde karaoke, zayi / ikram ve hammadde fiyat geçmişi araçları **yok** (sonraya bırakıldı).

## 3. Araçlar

| Araç (Tool permissions'taki adı) | Ne verir | Örnek soru | Panelde |
|---|---|---|---|
| `ay_ozeti` (Ay özeti: ciro, gider, kâr) | Bir ayın gelir-gideri ve kârı, reçeteye göre kâr, süren ayın ay sonu tahmini, başabaş; `yil` ile yılın ayları | "Ekim nasıl gidiyor?", "Bu yıl hangi ay zarar ettik?" | Genel bakış, Gelir-gider |
| `urun_karliligi` (Ürün kârlılığı ve menü sınıfı) | Birim maliyet, kâr, marj, adet, toplam kâr, Yıldız / Beygir / Bilmece / Zayıf; sıralama `zarar` en az kâr bırakanlar | "En az kazandıran 5 ürün?", "Latte M'nin maliyeti ne?" | Ürünler, Analiz |
| `zam_etkisi` (Hammadde zamlarının etkisi) | Bir tarihten bu yana artan hammaddeler, ayda kaç lira kâr götürdükleri, etkilenen ürünler ve önerilen fiyat | "Ekimde en çok kâr kaybettiren 5 ürün?", "Süt zammı ayda ne kadara patlıyor?" | Ürünler › Hammadde zamları |
| `tedarikci_ozeti` (Tedarikçi: faturalar ve ödemeler) | Dönemin faturaları, ödendi işaretli tutar, kalan borç, geciken, vadesi yaklaşan; ya da bütün tedarikçiler (fatura ya da borç sırasıyla) | "Bu yıl Kaldi'ye ne ödedik?", "En çok kime borcumuz var?" | Tedarikçiler |
| `odemeler` (Ödenmemiş ve yaklaşan ödemeler) | Geciken, bu hafta, bu ay, 45 gün; istenirse 6 haftalık nakit planı | "Bu hafta ne ödeyeceğiz?", "Geciken ödeme var mı?" | Ödemeler & hatırlatıcılar, Nakit planı |
| `kasa_raporlari` (Gün sonu kasa raporları) | En çok 92 günün Z toplamı, nakit, kart, yemek kartı, Z'deki online (platformlar), kasa farkı, raporu girilmemiş günler; günlük satır raporun şubesini (`sube`) yazar, açılış ↔ devir zinciri şube şube | "Geçen hafta kasa tuttu mu?", "Ekimde toplam kart ne?" | Kasa raporu |
| `ara` (Ürün, hammadde, tedarikçi ara) | Adla arama, tür ve ekran bağlantısı (tutar yok) | "Süt adlı hammaddeler hangileri?" | ⌘K arama |

Her cevap `hesap` (gerçek rakamlarla hesap satırları), `kaynak` (verinin dayanağı), gerekirse `uyarilar` (sayım
girilmedi, POS cirosu girilmedi, satış listesi yok, kasa raporu eksik, fiyatı girilmemiş hammadde) ve `panelAdresi`
taşır. Fiyatı girilmemiş hammadde yalnız cevaptaki ürünler için söylenir ve o ürünlerin satırında `maliyetEksik: true`
yazar (maliyeti eksik, kârı olduğundan yüksek). POS cirosu girilmemiş ayın kârı, panelde olduğu gibi, hesaplanmaz; o
ay laffogato.net online satışı olsa da. Claude'a giden yönerge bunları cevapta göstermesini, rakam uydurmamasını ve
"kâr kaybettiren" gibi belirsiz sorularda iki anlamı (zam etkisi / en az kâr bırakan ürünler) ayırmasını söyler.

Satış adetleri ModPOS'un aylık ürün satış listesinden gelir: ayın listesi yoksa önceki son ayın adetleri kullanılır ve
cevap bunu söyler. "Ödendi" bilgisi paneldeki ya da Paraşüt'teki işarettir, banka hareketi değildir: ödemeler
panelde elle girilir, banka bağlı değil.

**Cari hesap** (Tedarikçiler'de elle girilen borç ve ödeme, [TEDARIKCILER.md](TEDARIKCILER.md) *Hesap hareketleri*):
`tedarikci_ozeti` tek tedarikçide `faturasizBorc` (açık faturasız borçların adedi ve tutarı), `hesaptakiOdeme` (hiçbir
kaleme sayılmamış ödeme), `netBakiye` (bütün açık borç − hesaptaki ödeme; eksiyse alacak) ve `sonOdemeler` (en çok
10: gün, tutar, şekil, sayıldığı kalem sayısı) alanlarını da verir; `toplamAcikBorc` faturasız borçları içerir, "borç"
sıralaması onu kullanır. `sonOdeme` en yeni ödeme günüdür: faturada işaretli ödeme ya da dönemdeki elle ödeme kaydı
(Tedarikçiler'deki "Son ödeme" kartının kuralı). Bütün tedarikçiler listesinde satır başına `toplamAcikBorc`, `hesaptakiOdeme`, `netBakiye`.
`odemeler`'in `kaynak` girdisi `"cari"` da alır (yalnız faturasız borçlar); çıktıda bu kalemler `tur: "cari borç"`,
tahmini vadeleri faturalarla aynı kuralla işaretlenir. Hiç elle kayıt yokken cevaplar eskisiyle aynıdır (alanlar 0).

## 4. Kaldırmak ve yeniden bağlanmak

- **Kaldırmak:** Hesabım › **Bağlı uygulamalar** › **Kaldır** (birden çok bağlantı varsa **Hepsini kaldır**). Claude'un
  anahtarları o an geçersiz olur; işlem geçmişine "Claude bağlantısı kaldırıldı" yazılır. Claude'da da Customize ›
  Connectors › bağlayıcı › **Remove** yapın: yalnız Claude'dan kaldırmak paneldeki bağlantıyı kapatmaz.
- **Son sorular:** aynı kartta Claude'un son 20 araç çağrısı (ne sorduğu; cevap saklanmaz), hata verenler kırmızı.
- **Claude "Reconnect" der:** 90 gün dolunca; parolanızı değiştirince; Hesabım › Oturumlar › "Diğer cihazlardaki
  oturumları kapat" deyince; iki adımlı doğrulamayı açıp kapatınca; bir yönetici sizin oturumlarınızı kapatınca ya da
  sizi personel / pasif yapınca; bağlantı 30 gün hiç kullanılmayınca. 1. bölümün 4. adımını yineleyin.
- En çok **10** etkin bağlantı olur; dolarsa onay ekranı "Çok fazla bağlı uygulama" der.

## 5. Gizlilik (KVKK)

Claude'un cevapları Claude'daki sohbet geçmişinizde, planınızın Anthropic koşullarıyla durur. Panelden giden: işletmenin
rakamları ve firma, ürün, hammadde adları (bazı tedarikçiler şahıs firmasıdır). Müşteri ve personel adı, IBAN, vergi
no, telefon, e-posta ve notlar gitmez. **Öneri:** Claude'un gizlilik ayarlarında sohbetlerin model eğitiminde
kullanılmasını kapatın (finansal veri için). Aynı sohbette e-posta gönderebilen ya da web'e yazabilen başka bağlayıcılar
açıksa araç onaylarına dikkat edin: panelden okunan adlar veridir, Claude'a talimat değildir (Claude'a giden yönerge ve
her aracın açıklaması bunu söyler).

## 6. Sorun giderme

| Ne görüyorsunuz | Ne yapın |
|---|---|
| Claude: "Couldn't reach the MCP server" | Adres birebir `https://ladmin.laffogato.net/api/mcp` mi? Vercel'de Attack Challenge Mode ya da güvenlik duvarı Anthropic'in çıkış adreslerini (`160.79.104.0/21`) engellemesin. Vercel loglarında `[mcp] Origin reddedildi`, 404 (bağlantı kapalı: `MCP_DISABLED`) ya da 429 (çok istek) arayın. |
| Claude: "Authorization … failed" | Panelde yeniden giriş yapın, onay ekranında parolanızı doğru yazın; Claude'da bağlayıcıyı kaldırıp yeniden ekleyin. |
| Onay ekranı: "Bağlantı isteği geçersiz" | İstek 10 dakikada geçersiz olur ya da bağlantı bozuk: Claude'a dönüp **Connect**'e yeniden basın. |
| Tarayıcıda: "Uygulama tanınmadı" | İstek Claude'un yayımlanmış kimliğinden ya da otomatik kayıttan gelmiyor, ya da panel Claude'un kimlik belgesini okuyamadı (Vercel loglarında `[mcp] CIMD belgesi`). Claude'da bağlayıcıyı kaldırıp yeniden ekleyin; yine olursa eklerken OAuth client olarak **Register automatically**'yi seçin. |
| Onay ekranı: "Bu bağlantıyı yalnız yönetici kurabilir" | Personel hesabıyla girilmiş: yönetici hesabıyla girin. |
| Onay ekranı: "Çok fazla bağlı uygulama" | Hesabım › Bağlı uygulamalar'dan kullanmadıklarınızı kaldırın. |
| Onay: "Parola hatalı" / "Çok fazla hatalı parola" | 15 dakikada 5 hatalı parola sonrası beklenir (Hesabım ve Kullanıcılar'la aynı pay); hatalar işlem geçmişine "Hatalı parola onayı (Claude bağlantısı)" olarak yazılır. |
| İşlem geçmişi: "Claude bağlantısı güvenlik için kapatıldı" | Eski bir yenileme anahtarı ya da kod ikinci kez kullanıldı (çalınmış olabilir): bağlantı kapandı. Siz yapmadıysanız parolanızı değiştirin, sonra yeniden bağlanın. |

Claude bağlantı ayarlarını yaklaşık 5 dakika önbellekte tutar: panelde bir şey değiştiyse 5 dakika bekleyip yeniden
deneyin.

## 7. Teknik ayrıntılar

Panel kendi OAuth yetkilendirme sunucusudur (issuer `https://ladmin.laffogato.net`); MCP ucu durumsuz Streamable HTTP
(`@modelcontextprotocol/server` 2.3.1, `createMcpHandler(…, { legacy: "stateless" })`).

| Yol | Yöntem | Ne | Kimlik | CORS |
|---|---|---|---|---|
| `/api/mcp` | POST (GET/DELETE 405) | MCP ucu | Bearer erişim anahtarı (çerez okunmaz) | yok |
| `/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/oauth-protected-resource` | GET, OPTIONS | RFC 9728 korunan kaynak belgesi | herkese açık | `*` |
| `/.well-known/oauth-authorization-server` | GET, OPTIONS | RFC 8414 sunucu belgesi | herkese açık | `*` |
| `/oauth/authorize` | GET | isteği denetler, mühürler, onay ekranına (oturum yoksa önce girişe) | tarayıcı | — |
| `/baglan` | sayfa | onay ekranı | panel oturumu, yönetici, parola | — |
| `/oauth/token` | POST, OPTIONS | `authorization_code` ve `refresh_token` | açık istemci + PKCE | `*` |
| `/oauth/register` | POST, OPTIONS | RFC 7591 otomatik kayıt | herkese açık, sınırlı | `*` |
| `/oauth/revoke` | POST, OPTIONS | RFC 7009 anahtar iadesi | açık istemci | `*` |

**Güvenlik özeti** (`src/lib/mcp/oauth.ts`, `src/server/mcp/store.ts`):

- İstemci: Claude'un yayımlanmış kimliği (CIMD; belge yalnız `https://claude.ai|claude.com/oauth/…`'dan, yönlendirme
  izlenmeden, 5 sn, en çok 10 KB, 24 saat önbellekte) ya da otomatik kayıt (DCR; IP başına saatte 10, bağlanmamış
  istemci günde en çok 50). İkisinde de dönüş adresi yalnız `https://claude.ai/api/mcp/auth_callback` ve
  `https://claude.com/api/mcp/auth_callback` (localhost yalnız geliştirmede ya da `MCP_ALLOW_LOCALHOST=1` ile); birebir
  eşleşme. CIMD belgesinde listede olmayan başka bir dönüş adresi varsa belge reddedilmez, yalnız o adres saklanmaz
  (Vercel loglarında `[mcp] CIMD belgesindeki izinsiz dönüş adresleri saklanmadı`); hiç izinli adres yoksa istemci
  tanınmaz. Otomatik kayıtta izinsiz adres kaydı reddeder. Belge okunamazsa önbellekteki eski kayıt kullanılır; okunup
  geçersiz çıkarsa kullanılmaz. Gizli anahtar yok, PKCE S256 zorunlu; dönüşte `iss`.
- Yetki kodu 2 dakika, tek kullanım; ikinci kullanım o koddan açılan bağlantıyı kapatır. Erişim anahtarı 1 saat;
  yenileme anahtarı 30 gün, her kullanımda yenisiyle değişir; eski anahtar 60 sn içinde (yenisi kullanılmadıysa) bir
  kez daha geçer (ağ hatası payı), sonra kullanılırsa bağlantı kapanır. Bağlantı en çok 90 gün ve kullanıcının oturum
  sürümüne bağlı.
- Anahtar ve kodlar veritabanında yalnız sha256 özetiyle durur; ham değer yalnız Claude'a bir kez gider, loga yazılmaz.
- Her istekte: anahtar ve bağlantı açık, süresi dolmamış, kullanıcı etkin **yönetici** ve oturum sürümü aynı.
  `Origin` varsa panelin kendisi, `claude.ai`, `claude.com` ya da `*.anthropic.com` olmalı (değilse 403). Bellekte
  sınırlayıcılar (hatalı anahtarla 10 dakikada 30, bağlantı başına dakikada 60 istek) yalnız ilk savunma; asıl
  sınırlar veritabanında (tek kullanımlık kod, 10 bağlantı, günde 50 bekleyen kayıt). IP sınırı anahtar doğrulandıktan
  sonra ve yalnız hatalı anahtara uygulanır: Claude'un bütün istekleri Anthropic'in ortak çıkış adreslerinden gelir,
  geçerli anahtar başkasının hatalı istekleri yüzünden 429 almaz.
- Araçlar yalnız okur: `src/server/mcp/tools.ts` yalnız izinli okuyucuları içe aktarır, hiçbiri yazmaz
  (`tests/claude-guvenlik.test.ts`); hepsi `readOnlyHint: true`. Her çağrı `mcp_calls`'a yazılır (araç, girdi, sonuç,
  süre; yanıt saklanmaz, 180 gün).
- Önizlemede (`VERCEL_ENV=preview`; önizleme canlının veritabanını kullanır) ve `MCP_DISABLED=1` iken bütün uçlar 404.
  `X-Frame-Options: DENY` onay ekranını da kapsar.

**Tablolar:** `mcp_clients`, `mcp_codes`, `mcp_grants`, `mcp_tokens`, `mcp_calls` (migration `claude_baglantisi`).
Yedeğe girmezler ([YEDEK.md](YEDEK.md); geri yüklemeden sonra Claude'da yeniden bağlanılır); `npm run db:reset`
dokunmaz. Sabah işi (`/api/cron/gunluk`) en çok 3 sn temizlik yapar (süresi dolan kod ve anahtarlar, süresi dolan
bağlantıların kapatılması, 90 günden eski kapalı bağlantılar, bağlanmamış kayıtlar, 180 günden eski çağrılar); sonucu
yalnız yanıtta (`mcp`), Günlük işler adımı değildir.

**Ortam değişkenleri** ([DEPLOY.md](DEPLOY.md) § 4): `MCP_DISABLED` (`1`: kapalı), `MCP_ALLOW_LOCALHOST` (`1`: canlıda
Claude Code / MCP Inspector'ın localhost dönüşüne izin; varsayılan kapalı). Adresler `APP_URL`'den (yoksa
`https://ladmin.laffogato.net`).

**Kod:** `src/lib/mcp/oauth.ts` (saf kurallar ve metinler), `src/lib/mcp/schemas.ts` (araç girdileri),
`src/lib/mcp/answers/*` (araç cevapları, saf), `src/server/mcp/*` (veritabanı, CIMD, MCP sunucusu, araçlar, e-posta),
`src/server/actions/mcp.ts` (onay, ret, kaldırma), `src/app/baglan/*` (onay ekranı), `src/app/panel/hesap/connections.tsx`
(Bağlı uygulamalar), uçlar yukarıdaki tabloda.

## 8. Yerelde denemek (geliştirici)

Geliştirmede localhost dönüşü açıktır; adresler isteğin kendi kökünden gelir (`APP_URL`'e dokunmadan başka portta da
çalışır).

```bash
npx next dev -p 3000
curl -s localhost:3000/.well-known/oauth-protected-resource/api/mcp     # resource = http://localhost:3000/api/mcp
curl -s localhost:3000/.well-known/oauth-authorization-server            # S256, CIMD, "none"
curl -si localhost:3000/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
# → 401, WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="panel:oku"

# Yerel veritabanında bir yöneticiye 1 saatlik anahtar (bağlantı Hesabım'da "Yerel program (localhost)" görünür)
TOKEN=$(npx tsx scripts/mcp-dev-token.ts admin@laffogato.net http://localhost:3000)
H=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
curl -s localhost:3000/api/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s localhost:3000/api/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tedarikci_ozeti","arguments":{"tedarikci":"Kaldi","baslangic":"2026-01-01"}}}'
curl -si localhost:3000/api/mcp -H 'origin: https://evil.example' "${H[@]}" -d '{"jsonrpc":"2.0","id":4,"method":"tools/list"}'   # → 403
```

`scripts/mcp-dev-token.ts` yalnız `localhost` / `127.0.0.1` veritabanında ve `NODE_ENV` production değilken çalışır.
Tam OAuth akışı için MCP Inspector (yalnız geliştirmede, pakete eklenmez): `npx @modelcontextprotocol/inspector@2.9.0`
› Transport "Streamable HTTP", URL `http://localhost:3000/api/mcp` › Connect (otomatik kayıt, localhost dönüşü) →
`/baglan` → parola → araçlar.

Testler: `tests/claude-baglanti.test.ts` (OAuth kuralları), `tests/claude-araclar.test.ts` (araç cevapları, sızıntı
taraması), `tests/claude-guvenlik.test.ts` (kaynak bekçileri), `tests/claude-baglanti-db.test.ts` (veritabanında
akış; `MCP_TEST_DATABASE_URL=postgres://…/laffogato_… npm test` ile çalışır, yoksa atlanır).

**Canlıda ilk deneme:** `curl -s https://ladmin.laffogato.net/.well-known/oauth-authorization-server` 200 JSON;
`curl -si https://ladmin.laffogato.net/api/mcp -X POST -d '{}' -H 'content-type: application/json'` 401 ve
`resource_metadata` (yönlendirme yok). Sonra 1. bölüm; Hesabım'da "Claude · claude.ai", e-posta ve işlem geçmişinde
"Claude bağlantısına izin verildi" görünmeli.

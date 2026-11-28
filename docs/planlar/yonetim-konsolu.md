# Tasarım: Yönetim konsolu (yonetim.laffogato.net)

Sahibin isteği (28 Kasım 2026): "Yeni şube ekleme gibi kısımlar için bir alt alan adı aç, yonetim.laffogato.net; oradan
yönetilsin, ladmin'i hiç karıştırmayalım. Lisans tarzı işler de oradan dönsün. info@nextgenlab.com.tr yönetici de
oluşturabilsin. Öbür sistemde olmaması, burada olması gerekenleri ayarla."

## Karar

Üçüncü bir sistem kurulmaz. Yönetim konsolu, panelin (bu depo) aynı veritabanı üstünde ayrı bir kapısıdır: ayrı alan
adı, ayrı sade kabuk, yalnız asıl yönetici. Şubeler ve kasa anahtarları yerinde kalır (kasa gün sonunu o anahtarla
gönderir); canlıdaki Marina'da hiçbir şey değişmez. Lisans, dükkân listesi ve güncelleme gönderme AsilPOS Merkez'de
kalır (kasa deposu, `/merkez`); konsol oraya bağlantı verir. İkisini tek ekranda birleştirmek ayrı ve sonraki iştir.

## Kim girer

- Yalnız asıl yönetici (`docs/ROLLER.md` › Asıl yönetici). Başka hesap konsol adresinde giriş yapamaz: "Bu adres
  yalnız asıl yöneticinin." Giriş korumaları panelinkiyle aynıdır (kilit, iki adımlı doğrulama, yeni cihaz e-postası).
- Oturum çerezi alan adına bağlıdır: konsolda ayrıca giriş yapılır; ladmin oturumu konsolu, konsol oturumu ladmin'i açmaz.

## Ne nerede

| İş | Bugün | Konsoldan sonra |
|---|---|---|
| Şube açma, kapatma, yeniden açma, silme | ladmin › Şube ekleme, Şubeler | Konsol › Şubeler ve kasalar |
| Kasa programı (ModPOS / AsilPOS), AsilPOS'a geçiş günü | ladmin › Şubeler, Ayarlar › AsilPOS | Konsol › Şubeler ve kasalar |
| "Bilgisayara kur", ilk personel (patron, müdür, barista PIN'i), "Kasayı serbest bırak", kasa anahtarı | ladmin › Şube ekleme, Ayarlar › AsilPOS | Konsol › Şubeler ve kasalar |
| Her şubenin kasa durumu (kurulu mu, son gün) | ladmin › Şube ekleme | Konsol › Şubeler ve kasalar |
| Yönetici hesabı açma, yöneticilik verme ve alma, yöneticiyi kapatma, silme, iki adımlısını sıfırlama | ladmin › Kullanıcılar (her yönetici) | Konsol › Yöneticiler (yalnız asıl yönetici) |
| Lisans, dükkânlar, güncelleme gönderme | AsilPOS Merkez | Konsol › Lisans ve güncelleme (Merkez'e bağlantı) |
| Şubenin adı, sırası, POS oranı, özellikleri, e-postası | ladmin › Şubeler | ladmin › Şubeler (değişmez) |
| Müdür, muhasebeci ve personel hesapları | ladmin › Kullanıcılar | ladmin › Kullanıcılar (değişmez) |
| Günlük işler (kasa raporu, fatura, stok, raporlar, ayarlar) | ladmin | ladmin (değişmez) |

ladmin'de kalkanlar: menüdeki "Şube ekleme", Şubeler'deki açma / kapatma / silme / kasa programı düğmeleri, Ayarlar ›
AsilPOS kartındaki anahtar ve geçiş günü düğmeleri, Kullanıcılar'da yönetici hesabı açma ve yöneticilik verme. Yerlerinde
salt okunur durum ve tek cümle kalır: "Bu iş Yönetim'de yapılır" (asıl yöneticiye bağlantıyla).

## Yeni kural: yönetici hesapları

Yönetici (admin) rolünde hesap açmak, bir hesaba yöneticilik vermek ya da almak, bir yöneticiyi kapatmak, silmek, iki
adımlısını sıfırlamak, kilidini açmak, oturumlarını kapatmak ve ona giriş bağlantısı üretmek yalnız asıl yöneticinindir.
Öteki yöneticiler müdür, muhasebeci ve personel hesaplarını bugünkü gibi yönetir; kendi hesaplarını Hesabım'dan yönetir.
Son yönetici kuralı ve asıl yönetici hesabının korunması aynen kalır.

## Teknik çerçeve

- Aynı Next.js uygulaması ve aynı Vercel projesi; alan adı projeye eklenir (`yonetim.laffogato.net`, DNS Vercel'de).
  Ortam: `YONETIM_URL` (varsayılan `https://yonetim.laffogato.net`).
- Rota grubu `/yonetim/*` (Şubeler ve kasalar, Yöneticiler, Lisans ve güncelleme) ve kendi kabuğu (ladmin kenar çubuğu yok).
- `src/proxy.ts` alan adına bakar: konsol adresinde yalnız `/yonetim/*`, giriş, çıkış ve gereken statik dosyalar açılır;
  kök adres `/yonetim`'e gider; `/panel/*` konsol adresinde açılmaz. ladmin adresinde `/yonetim/*` konsol adresine
  yönlenir. Yerelde ve önizlemede (konsol adresi yokken) `/yonetim` doğrudan açılır.
- Sunucu eylemleri değişmez (`requireAnaAdmin`); konsol sayfaları aynı eylemleri çağırır. Yeni kural için kullanıcı
  eylemlerine yönetici rolü denetimi eklenir.
- Kasanın çağırdığı uçlar (`/api/asilpos/*`, `/api/panel/pos/*`, `/api/pos/gun`) ladmin adresinde kalır; konsol adresi
  kasaya hiçbir şey sunmaz. Kasadaki metinler "değiştirmek için Yönetim (yonetim.laffogato.net)" der.
- `/panel/sube-ekleme` adresi konsola yönlenir (eski bağlantılar ve e-postalar kırılmasın).
- Göç yok.

## Sıra

1. P-B2 (kasa açılışı uçları, ilk personel, kasayı serbest bırak) ladmin'deki Şube ekleme sayfasında biter.
2. Konsol PR'ı: kabuk, alan adı kuralı, Şubeler ve kasalar (Şube ekleme'nin taşınması ve ladmin'deki asıl yönetici
   düğmeleri), Yöneticiler ve yeni kural, Lisans ve güncelleme bağlantısı, ladmin'deki yönlendirmeler ve notlar.
3. Alan adı Vercel projesine eklenir, canlıda giriş ve üç sekme denenir.
4. Sonra (ayrı iş): Merkez'in lisans ve güncelleme ekranlarını konsolda tek ekrana almak.

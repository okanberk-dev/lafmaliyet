# Karaoke sayacı ve laffogato.net bağlantısı

Ekran: **Karaoke** (`/panel/karaoke`, "Barın ekranı"), personel ve yönetici. Kasadaki tablette ya da bilgisayarda
Chrome'da açık bırakılır: laffogato.net'te karaoke rezervasyonu açılınca zil çalar (Yemeksepeti / Getir paneli gibi),
oturum başlayınca kısa ses, bitime az kala uyarı, süre dolunca personel **Haber verdim**'e basana kadar alarm çalar.
Ekranın en üstünde sitenin ödenmiş, açık kafe siparişleri durur (**Uygulama siparişleri**, yeni siparişte zil;
[SITE-SIPARIS.md](SITE-SIPARIS.md)).

## Geliştirilmiş istek (prompt)

> Personel paneline karaoke odası sayacı ekle. laffogato.net'te bir karaoke rezervasyonu açılınca, ödenince,
> onaylanınca, iptal edilince ya da saati değişince panel bunu **anında** öğrensin. Hep açık duran Chrome sekmesinde
> zil çalsın; sekme arka plandayken ya da kapalıyken sistem bildirimi gelsin. Oturum başlayınca kısa ses, bitime 10
> dakika kala uyarı, süre dolunca personel "Haber verdim"e basana kadar alarm ve ekranın üstünde kırmızı şerit olsun;
> +15 / +30 dk uzatma ve erken bitirme olsun. Rezervasyonsuz gelen grup için hızlı sayaç (30 dk – 2 sa ya da özel
> süre). Yönetici aynı ekranda bugünü, yaklaşanları, son 30 günü, ayın özetini (rezervasyon, saat, ciro, iptal) ve
> bağlantının durumunu görsün; personel tutar görmesin.
>
> - **Sürekli istek yok:** site her değişiklikte panele içeriksiz, imzalı bir ping atar; panel değişenleri imzalı
>   tek bir okumayla çeker ve cihazlara Web Push gönderir. Açık sekme veriyi yalnız açılışta, bildirim gelince,
>   sekmeye dönünce ve seyrek bir yedek kontrolde ister; ETag ile, değişiklik yoksa 304.
> - **Güvenlik:** iki yön HMAC-SHA256 ile imzalı (zaman, yöntem, yol, sıralı sorgu, gövde özeti; ±5 dk; sabit süreli
>   karşılaştırma), ortak anahtar yalnız sunucuda; siteden panele yalnız ad, saat, kişi sayısı, durum ve not gelir
>   (e-posta, telefon, soyad asla); push yalnız bilinen push servislerine gider.
> - **Hız:** ping sitedeki yazımı yavaşlatmaz, panel pinge hemen yanıt verir, eşitleme arka planda; alarm sesi ses
>   saatinden zamanlanır (arka plandaki sekmede de zamanında çalar).
> - **Basit kurulum:** tek değişken (`KARAOKE_SYNC_SECRET`, iki projede aynı); bildirim anahtarları kendiliğinden
>   üretilir. Her cihaz kendi tercihini tutar (ses, alarm, uyarı süresi, ekran açık kalsın).

## Nasıl çalışır

```
laffogato.net                                   ladmin.laffogato.net (bu panel)
─────────────                                   ──────────────────────────────
rezervasyon yazıldı
  └─ after(): POST /api/karaoke/ping  ───────▶  imza doğru → 202 (hemen)
     (içeriksiz, imzalı)                          └─ after(): eşitle
                                                     GET laffogato.net/api/panel/karaoke?from&to (imzalı)
GET /api/panel/karaoke  ◀───────────────────────     ├─ karaoke_sessions'a yaz (yeni / değişen / silinen)
  beyaz listeyle: ad, saat, kişi, durum, not         ├─ karaoke sürümünü artır (canlı ucun ETag'i)
                                                     └─ olay varsa Web Push → cihazlar
                                                           └─ service worker → açık sekme /api/canli'yi yeniler,
                                                              zil çalar, kart gösterir
```

- **Ping kaçarsa:** Karaoke ekranı açılınca en çok beş dakikada bir site yeniden sorulur; günlük iş
  (`/api/cron/gunluk`) de bir kez eşitler. Yönetici **Şimdi eşitle** ile elle eşitler.
- **İlk eşitleme** geçmiş kayıtları sessizce alır (eski rezervasyonlar için zil çalmaz). Bitmiş rezervasyonun
  değişikliği bildirilmez. Ödemesi beklenen tutma (sitede ödeme sayfası açık) sessizdir; ödeme tamamlanınca "yeni
  rezervasyon" olarak çalar.
- **Açık sekmenin istek bütçesi** (`/api/canli`, ETag'li; değişiklik yoksa 304 ve veri okunmaz):
  açılışta, bildirim gelince, sekmeye dönünce, ağ geri gelince; yedek kontrol bildirim açıkken 10 dakikada,
  kapalıyken dakikada bir; alarm çalarken 15 saniyede bir (başka cihazda susturulursa burada da sussun).
- **Sayaç sunucu saatiyle sayar:** tabletin saati yanlış olsa da alarm zamanında çalar. Sekme arka plandayken
  tarayıcı zamanlayıcıları yavaşlatsa da bitiş sesi önceden ses saatine kurulur.
- **Rezervasyonsuz oturum** (hızlı sayaç) yalnız panelde tutulur; siteye gitmez.

### Çakışma uyarısı

Oda tektir. Hızlı sayaç başlatılırken ya da süren bir oturum uzatılırken (+15 / +30 dk; zildeki "uzat" dahil) o saatte
sitede **geçerli** bir rezervasyon varsa personele sorulur; kesin engel değildir (bar, gelenin rezervasyonu yapan
grup olduğunu bilebilir):

- Süre seçilirken formun altında sarı satır: "Dikkat: Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var.
  Sayacın bitişi 21:30."
- **Başlat**'a basınca sunucu yeniden bakar (ekranın listesi eski olabilir); çakışma varsa kaydetmeden döner, ekran
  sorar: "Sitede rezervasyon var · Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var. Yine de başlatılsın mı?"
  **Vazgeç** ya da **Yine de başlat** (uzatmada **Yine de uzat**). Onaylanınca kaydedilir ve işlem geçmişine "sitedeki
  rezervasyonla çakışmasına rağmen" diye düşer.
- **Geçerli rezervasyon:** sitenin, iptal edilmemiş, ödeme sayfası açık bekleyen tutma değil, süresi dolup düşmemiş ya
  da iade edilmemiş, panelde "bitti" denmemiş (onay bekleyen kasada ödemeli talep ve ödenmiş rezervasyon geçerlidir).
  Uç uca gelen saatler (20:00'de biten, 20:00'de başlayan) çakışmaz. Uzatmada yalnız eklenen süre (şimdiki bitişten
  yeni bitişe) bakılır, uzatılan oturumun kendisi sayılmaz.
- Panelde ileri bir saate oturum planlanmaz (sayaç hep şimdi başlar); geri açma (yanlışlıkla bitirilen oturum) süreyi
  değiştirmediği için sormaz.

Kural tek yerde: `src/lib/karaoke/overlap.ts` (ekran ve sunucu eylemi aynı fonksiyonu çağırır;
`tests/karaoke-cakisma.test.ts`).

## Kurulum

1. Ortak anahtarı bir kez üretin: `openssl rand -base64 48` (en az 32 karakter).
2. Vercel'de **iki projeye de** (laffogato.net ve bu panel) aynı değerle `KARAOKE_SYNC_SECRET` ekleyin
   (Settings → Environment Variables, Production; "Sensitive" işaretleyin) ve iki projeyi de yeniden yayımlayın
   (Deployments → son yayın → ⋯ → Redeploy). Sıra önemli değil: iki tarafta da tanımlanana kadar bağlantı kapalı
   kalır, bir şey bozulmaz.
   Aynı anahtar menü bağlantısını (bağlı ürünün fiyatı ve Satışta / Tükendi durumu, [SITE-MENU.md](SITE-MENU.md)),
   bar ekranındaki uygulama siparişlerini ([SITE-SIPARIS.md](SITE-SIPARIS.md)) ve online satışları
   ([SITE-SATIS.md](SITE-SATIS.md)) da açar. Dördünün durumu tek yerde: **Ayarlar › laffogato.net**.
3. İsteğe bağlı: `LAFFOGATO_URL` (boşsa `https://laffogato.net`); sitede `PANEL_URL` (boşsa
   `https://ladmin.laffogato.net`). Bildirim anahtarları (VAPID) ilk kullanımda üretilip veritabanında şifreli
   saklanır; isterseniz `VAPID_PUBLIC_KEY` ve `VAPID_PRIVATE_KEY` ile sabitlenir.
4. Yönetici olarak **Karaoke** ekranını açın: "laffogato.net bağlantısı" kartı **Bağlı** göstermeli (kartta
   **laffogato.net paneli ↗**: sitenin yönetim paneli, yeni sekmede).
5. Kasadaki cihazda personel hesabıyla **Karaoke**'yi açın ve **Bu cihazda uyarılar** kartından:
   - **Bildirimleri aç** (Chrome izin sorar): sekme arka plandayken ya da kapalıyken de bildirim gelir;
   - ekrana bir kez dokunun (tarayıcı ilk dokunuştan önce ses çaldırmaz; gerekirse sağ altta "Sesli uyarılar için
     dokunun" düğmesi çıkar);
   - **Ekran açık kalsın**'ı açın (personelde varsayılan açık);
   - **Uyarıların çalacağı hoparlör**'den bilgisayarın kendi hoparlörünü seçin (aşağıda).
   iPhone / iPad'de bildirim için paneli Paylaş › **Ana Ekrana Ekle** ile uygulama gibi açın.

### Müzik Bluetooth hoparlördeyken uyarılar bilgisayardan

Karaoke müziği Bluetooth hoparlörden çalarken zil ve alarm müziğe karışmasın, bilgisayarın kendi hoparlöründen yüksek
sesle gelsin diye:

1. **Bu cihazda uyarılar › Uyarıların çalacağı hoparlör › Hoparlörleri göster.** Chrome hoparlörlerin adını ancak
   mikrofon izniyle gösterir: izin penceresinde **Her ziyarette izin ver**'i seçin. Mikrofon kullanılmaz, açılan akış
   hemen kapatılır (izin yalnız panel sayfalarında ve yalnız bu site için açık).
2. Listeden bilgisayarın hoparlörünü seçin (ör. "Hoparlör (Realtek(R) Audio)", "MacBook Pro Hoparlörleri";
   "bilgisayarın hoparlörü" diye işaretlenir, Bluetooth olanlar "Bluetooth" diye). Seçince deneme sesi o hoparlörden
   çalar. Seçim bu cihazda saklanır; hoparlör takılıp çıkınca yeniden uygulanır, bulunamazsa ses varsayılan çıkıştan
   gelir ve kartta uyarı çıkar.
3. Bilgisayar hoparlörünün ses düzeyini yüksek tutun. Windows'ta her hoparlörün düzeyi ayrıdır (Ayarlar › Sistem ›
   Ses › bilgisayar hoparlörü › ses düzeyi); Bluetooth'taki müziğin düzeyi bundan etkilenmez. Uyarı sesleri zaten
   tavana yakın ve parlak (1–3 kHz) üretilir; bir sınırlayıcı cızırdamayı önler.

Sekme açıkken sesi sekme kendisi çalar ve sistem bildirimi **sessiz** gelir (işletim sisteminin bildirim sesi
varsayılan çıkıştan, yani Bluetooth hoparlörden çalardı). Panel hiç açık değilken gelen bildirim sistemin sesini
kullanır; bunu da kapatmak için Windows'ta Ayarlar › Sistem › Bildirimler › Google Chrome › "Bildirim geldiğinde ses
çal"ı kapatın.

Hoparlör seçimi Chrome ve Edge'de çalışır (Safari ve iPhone'da seçilemez). Bilgisayarda mikrofon yoksa Chrome
hoparlör adlarını gösteremez; o durumda Windows'ta Ayarlar › Sistem › Ses › **Ses karıştırıcı**'dan (Windows 10'da
"Uygulama ses düzeyi ve cihaz tercihleri") Chrome'un çıkışını bilgisayar hoparlörü yapın (müzik başka bir uygulamadan
çalıyorsa).

Yöneticinin cihazında karaoke alarmları varsayılan **kapalıdır** (yeni rezervasyon bildirimi yine gelir); isteyen
kendi cihazında açar.

## Güvenlik

- Ping ve çekme HMAC-SHA256 ile imzalıdır: `x-laf-timestamp` (unix saniye) ve `x-laf-signature: v1=<hex>`.
  İmzalanan metin satır satır zaman, yöntem, yol, sıralanmış sorgu ve gövdenin SHA-256'sı; alan adı girmez. Saat
  farkı en çok 5 dakika, karşılaştırma sabit süreli. Kurallar `src/lib/karaoke/signature.ts`'te; sitenin kopyası
  (`src/lib/panel/karaoke-sync-core.ts`) ile iki depodaki testler aynı iki imza vektörünü sabitler.
- İmzasız ya da yanlış istek yalnız `401` alır; anahtar tanımlı değilse uç `503` döner.
- Siteden yalnız ad (soyad değil), gün, saat, kişi sayısı, durum, ödeme durumu, not, tutar ve kanal gelir. Panelde
  sitenin yanıtı ayrıca doğrulanır: bozuk satır atlanır, metinler kısaltılır.
- **Personel tutar görmez:** canlı veri ve sayfa, personele tutarı hiç göndermez (`toSessionDTO`).
- Web Push içeriği uçtan uca şifrelidir (RFC 8291, aes128gcm), VAPID imzalıdır (RFC 8292). Abonelik yalnız bilinen
  push servislerine (Google, Mozilla, Apple, Microsoft) kaydedilir; çıkışta cihazın aboneliği silinir, parola ya da
  rol değişince (oturum sürümü) eski cihazlara bildirim gitmez.
- Service worker yalnız bildirim işi yapar: sayfa önbelleklemez, istek yakalamaz.

## Sorun giderme

"laffogato.net bağlantısı" kartındaki **Hata** açıklamaları:

| Mesaj | Ne yapılır |
|-------|------------|
| Site isteği reddetti (imza) | İki projedeki `KARAOKE_SYNC_SECRET` aynı mı? İkisi de yeniden yayımlandı mı? |
| Sitede KARAOKE_SYNC_SECRET tanımlı değil | Siteye değişkeni ekleyip yeniden yayımlayın |
| Sitede panel ucu yok | laffogato.net güncel değil (karaoke bağlantısı yayımlanmamış) |
| Site 8 saniyede yanıt vermedi | Geçici; **Şimdi eşitle** ile yeniden deneyin |

"Sitenin son pingi" boş kalıyorsa site panele ulaşamıyor: sitedeki `PANEL_URL` ve anahtarı kontrol edin.

Ses hâlâ Bluetooth hoparlörden geliyorsa: **Uyarıların çalacağı hoparlör** kartında uyarı var mı bakın ("izin
yenilenmeli": Hoparlörleri göster'e basıp Her ziyarette izin ver; "bağlı değil": hoparlörü yeniden seçin). **Sesi
dene** seçilen hoparlörden çalmalı.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/app/api/karaoke/ping/route.ts` | Sitenin pingi: imza, 202, arka planda eşitleme |
| `src/server/karaoke/sync.ts` | Çekme, yazma, olay tespiti, bildirim |
| `src/server/site-link.ts` | Menü bağlantısıyla ortak: anahtar, sitenin adresi, imzalı istek (8 sn; [SITE-MENU.md](SITE-MENU.md)) |
| `src/server/karaoke/board.ts` | Oturumlar, sürüm sayacı (ETag), ekran verisi |
| `src/server/actions/karaoke.ts` | Hızlı sayaç, uzatma (ikisi de sitedeki rezervasyonla çakışmayı sorar), bitirme, geri açma, elle eşitleme |
| `src/lib/karaoke/overlap.ts` | Çakışma kuralı: odayı tutan rezervasyon, aralık kesişimi, uyarı metni (saf, testli) |
| `src/app/panel/karaoke/orders-board.tsx` | Ekranın üstündeki uygulama siparişleri ([SITE-SIPARIS.md](SITE-SIPARIS.md)) |
| `src/app/api/canli/route.ts` | Açık sekmenin canlı verisi (karaoke, uygulama siparişleri, kişisel hatırlatmalar; ETag / 304) |
| `src/components/panel/live/` | Uyarı motoru: canlı veri, sesler ve hoparlör seçimi, cihaz tercihleri, bildirim aboneliği |
| `src/lib/audio-output.ts` | Hoparlör listesi, kayıtlı seçimin yeniden bulunması, Bluetooth / bilgisayar hoparlörü tahmini |
| `src/server/push/` | VAPID, şifreleme, gönderim |
| `public/sw.js` | Service worker (bildirim gösterme, tıklayınca panele dönme) |
| `src/lib/karaoke/` | İmza, oturum evreleri, uyarı planı, sitenin yanıtının doğrulanması (saf, testli) |
| `tests/karaoke.test.ts`, `tests/web-push.test.ts`, `tests/ses-cikisi.test.ts`, `tests/karaoke-cakisma.test.ts` | İmza vektörleri, olaylar, evreler, alarm planı, şifreleme, hoparlör seçimi ve sessiz bildirim, çakışma uyarısı |

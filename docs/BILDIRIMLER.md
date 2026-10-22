# Ödemeler, hatırlatıcılar ve e-posta bildirimleri

Ekran: **Satış & gider › Ödemeler & hatırlatıcılar** (`/panel/hatirlaticilar`).

## Ne listelenir

- **Hatırlatıcılar:** kira, vergi/SGK, maaş, abonelik gibi ödemeler. Bir kez ya da her hafta / ay / üç ayda bir /
  yıl tekrar eder. "Ödendi" işaretlenince tekrar edenler bir sonraki döneme geçer (ayın günü korunur: 31'i olmayan
  ayda son gün).
- **Ödenmemiş faturalar:** Faturalar'da "ödenmedi" olanlar (Paraşüt'ten gelenler dahil; ödendi'yi Tedarikçiler ya
  da Faturalar ekranında siz işaretlersiniz, [TEDARIKCILER.md](TEDARIKCILER.md)). Vade tarihi yoksa fatura
  tarihinden 30 gün sonra vadeli sayılır (ayarlanabilir; tedarikçinin bilgilerinde (Tedarikçiler) vade günü yazılıysa o geçer);
  vade ekrandan girilebilir.
- **Vergi takvimi şablonları:** KDV (takip eden ayın 28'i), muhtasar ve prim hizmet (26'sı), SGK primi (ay sonu),
  geçici vergi (çeyrekten sonraki ikinci ayın 17'si), maaş. Genel takvimdir; işletmenize göre muhasebecinizle
  kontrol edin, tarihi düzenleyebilirsiniz.
- **Sabit giderlerden:** Giderler & personel'deki aylık/haftalık/yıllık giderlerden, ilk ödeme tarihi seçilerek;
  gider döneminde tekrar eder.

Gecikmiş ve yaklaşan ödemeler kenar çubuğundaki **zilde** de görünür.

## Son ödenenler (geri alma)

"Ödendi" bildirimindeki **Geri al** 8 saniye durur. Kaçırılırsa ya da yanlışlık sonradan fark edilirse, listenin
altındaki **Son ödenenler** bölümünden (kapalı açılır kutu; `#son-odenenler`) geri alınır:

- Son **30 günde** "Ödendi" işaretlenen fatura ve hatırlatıcılar, en yeni önce, en çok 30 kayıt. Liste, Ödemeler
  ekranından, Faturalar'da tek tek / toplu "Ödendi"den, fatura penceresinde ödenmedi → ödendi kaydedilince ve
  Tedarikçiler'deki ödeme penceresi, ✓ ve toplu işlemle dolar.
- **Fatura** için Geri al, faturayı yeniden "ödenmedi" yapar (ödemesi talep edilmişse "talep edildi"); ödeme
  listesine ve sabah e-postasına döner.
- **Hatırlatıcı** için Geri al, ödenmeden önceki hâline döndürür (tarih, tekrar günü, açık/kapalı, son ödeme):
  tekrar eden kira 01.11'den 01.10'a geri gelir, kapanan tek seferlik yeniden açılır.
- Hatırlatıcı ödendikten sonra değiştiyse (yeniden ödendi, ertelendi, kapatıldı, tarihi düzenlendi) eski hâl yazılmaz;
  satır listede görünmez. Silinen hatırlatıcı ve sonradan "ödenmedi" yapılan fatura da görünmez. Ödemeden sonraki bir
  ertelemenin bildirimden geri alınması kaydı yeniden geçerli kılar.
- Kayıt ayrı tablo değil, `integration_state` tablosunda `payments.recent` anahtarıdır; yazılamazsa asıl işlem
  (ödendi) yine yapılır, yalnız geri alma listesi eksik kalır.

## E-posta

Her sabah 08:00–09:00 arasında (Vercel Cron, `/api/cron/gunluk`; Hobby planında saat esnek) tek bir **sabah
e-postası**, bildirim adreslerine gider. İçinde:

- zamanı gelen ödemeler (aşağıdaki aşamalarla);
- **Paraşüt'ten gelen yeni faturalar** (son sabah e-postasından bu yana eşitlemenin açtıkları: tedarikçi, tarih,
  kategori, tutar; en çok 10 tanesi listelenir);
- **kontrol bekleyen** fatura sayısı (kategorisi tahminle yazılmış), bağlantısıyla;
- son Paraşüt eşitlemesi başarısızsa uyarı (aynı hata bir kez bildirilir);
- **hammadde zamları**: son zam bölümlü e-postadan bu yana fiyatı %5'ten fazla artan hammaddeler (eski → yeni
  ₺/kg, ₺/L, ₺/adet) ve fiyatı hedef maliyet oranının altında kalan ürünler, önerilen fiyatlarıyla (en çok 6);
  bağlantı Ürünler › Hammadde zamları'na gider (`docs/PARASUT.md` 5a).

Ödeme, yeni fatura, eşitleme hatası ya da yeni zam yoksa e-posta gitmez. Paraşüt eşitlemesi bir saat önce ayrı bir işte
çalışır; o sabah başarısız olduysa e-posta işi önce bir kez daha eşitler. Her ödeme için en fazla üç kez haber
verilir:

| Aşama | Ne zaman |
|-------|----------|
| Yaklaşıyor | Son günden "kaç gün önce" kadar önce (hatırlatıcı başına; faturalar için ayardan) |
| Bugün | Son gün |
| Gecikti | Son gün geçtikten sonra (14 gün içinde bir kez) |

Tekrar eden bir hatırlatıcının bir dönemi "ödendi" işaretlenmeden geçerse, sonraki dönem de listede ve e-postada
görünür (ör. Ekim KDV gecikti, Kasım KDV 4 gün kaldı); sonraki dönemde "Ödendi", o güne kadarki dönemleri kapatır.
Kapatılıp yeniden açılan tekrarlı hatırlatıcı bugünden sonraki ilk döneme geçer.

Aynı hatırlatmanın ikinci kez gitmemesi `notification_log` tablosundaki tekil anahtarla sağlanır
(`kaynak:kimlik:vade:aşama`, ör. `reminder:4:2026-10-28:before`, `invoice:23:2026-10-31:due`). Geciken dönemin
yanında görünen sonraki dönem de aynı anahtarı kullanır: Ekim kirası gecikmişken Kasım için "yaklaşıyor" gittiyse,
Ekim ödenip Kasım gerçek döneme dönünce aynı e-posta ikinci kez gitmez. Gönderim başarısız olursa anahtar yazılmaz,
ertesi sabah yeniden denenir; hata ekrandaki "Son gönderimler"de görünür.

Resend'e her e-posta içerikten türeyen bir tekil anahtarla (`Idempotency-Key`) gider: aynı iletinin yeniden denemesi
ve sabah işiyle elle gönderimin çakışması tek e-posta olur. Paraşüt bölümünün anahtarı son Paraşüt bölümlü gönderimin
anını da içerir; aynı gün ikinci kez "şimdi gönder" denince (aynı sayıda yeni fatura gelse de) anahtar değişir.

Ekrandan (sağdaki **E-posta bildirimleri** kutusu; kapalıyken tek satır özet):

- özet satırında açık/kapalı, adres sayısı ve gönderim durumu ("her sabah 08:00", "elle gönderim", "gönderim
  bekliyor"). Resend bağlıyken ayrıca bir şey yazılmaz; `RESEND_API_KEY` yoksa kırmızı **Resend bağlı değil**
  rozeti ve açınca anahtarın nereye girileceği görünür (`CRON_SECRET` yoksa da);
- e-postaları açma / kapatma anahtarı: yalnız açık/kapalıyı kaydeder, "Gönderim ayarları"nda yazılıp
  kaydedilmemiş değerlere dokunmaz;
- bildirim adresi ekleme, kapatma, silme;
- **E-postayı önizle** (gönderilmez): bugün gidecek sabah e-postasının kendisi, Paraşüt ve zam bölümleriyle;
  ödeme, yeni fatura ya da zam yoksa örnek bir ödeme satırıyla;
- **Deneme gönder** (kayıtlı gönderenle, etkin adreslere);
- **Bugünküleri şimdi gönder** (sabahı beklemeden; daha önce gidenler tekrar gitmez). Bildirimde ne gittiği
  yazar: "2 hatırlatma · 4 yeni fatura · 1 zam";
- gönderen adresi ve gün ayarları (Gönderim ayarları › Kaydet).

## Kişisel hatırlatıcılar ve cihaz bildirimleri

Ekran: **Hatırlatıcılarım** (`/panel/hatirlaticilarim`), personel ve yönetici. Herkes yalnız kendi hatırlatıcılarını
görür ve değiştirir (yönetici de başkasınınkini görmez); ödemeler ve sabah e-postası bunlardan ayrıdır.

- Hızlı ekleme (başlık, bugün / yarın, isteğe bağlı saat) ya da pencereden: not, tarih, saat, tekrar (her gün / hafta /
  ay; ay sonu kırpılır, ertelense de çapa günü korunur). Gruplar: Gecikti, Bugün, Yarın, Bu hafta, Daha sonra.
- **Tamamlandı** ve **ertele** (bir saat, ertesi gün) bildirimdeki **Geri al** ile geri alınır; tamamlanan tek
  seferlikler iki hafta altta durur, oradan yeniden açılır. En çok 200 açık hatırlatıcı.
- **Saatli** hatırlatma, panel hangi ekranda açık olursa olsun saatinde ses ve kartla çalar; bildirim izni verilmiş
  cihazda sekme arka plandayken sistem bildirimi olarak gelir. Zil, bugünkü ve gecikmiş hatırlatıcıları gösterir.
- **Sabah özeti:** günlük iş (`/api/cron/gunluk`, 08:00–09:00), bugün ya da önceden kalmış açık hatırlatıcısı olan
  her kişinin bildirim açık cihazlarına tek bir Web Push gönderir ("Bugün 3 hatırlatıcınız var").

Her cihaz kendi tercihini tutar (**Bu cihazda uyarılar** kartı, Hatırlatıcılarım ve Karaoke ekranlarında): bildirim
izni ve aboneliği, karaoke bildirimleri, sipariş bildirimleri ve sipariş zili (laffogato.net'ten yeni uygulama
siparişi; [SITE-SIPARIS.md](SITE-SIPARIS.md)), sabah özeti, sesli uyarı, saatli hatırlatmalar. Web Push'un ayrıntısı ve
güvenliği [KARAOKE.md](KARAOKE.md)'de.

## Resend kurulumu

laffogato.net sitesiyle **aynı Resend hesabı** ve doğrulanmış `laffogato.net` alan adı kullanılır (laffogato
deposu, `docs/EMAIL-RESEND.md`). Vercel → lafmaliyet → Settings → Environment Variables:

| Değişken | Değer |
|----------|-------|
| `RESEND_API_KEY` | Resend API anahtarı (sitedekiyle aynı olabilir; yalnız sunucuda) |
| `EMAIL_FROM` | (isteğe bağlı) `L'Affogato Panel <bildirim@laffogato.net>` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `APP_URL` | (isteğe bağlı) `https://ladmin.laffogato.net` |

Gönderen sırası: ekrandaki ayar → `EMAIL_FROM` → `L'Affogato Panel <bildirim@laffogato.net>`. Alan adı Resend'de
doğrulanmış olduğu için `@laffogato.net` ile biten her adres gönderebilir.

> Resend'in Vercel entegrasyonu takımda kuruluysa `RESEND_API_KEY`'i lafmaliyet projesine de bağlayabilirsiniz;
> ya da team düzeyinde "Shared Environment Variable" olarak iki projeye birden verin.

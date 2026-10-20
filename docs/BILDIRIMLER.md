# Ödemeler, hatırlatıcılar ve e-posta bildirimleri

Ekran: **Satış & gider › Ödemeler & hatırlatıcılar** (`/panel/hatirlaticilar`).

## Ne listelenir

- **Hatırlatıcılar:** kira, vergi/SGK, maaş, abonelik gibi ödemeler. Bir kez ya da her hafta / ay / üç ayda bir /
  yıl tekrar eder. "Ödendi" işaretlenince tekrar edenler bir sonraki döneme geçer (ayın günü korunur: 31'i olmayan
  ayda son gün).
- **Ödenmemiş faturalar:** Faturalar'da "ödenmedi" olanlar (Paraşüt'ten gelenler dahil). Vade tarihi yoksa fatura
  tarihinden 30 gün sonra vadeli sayılır (ayarlanabilir); vade ekrandan girilebilir.
- **Vergi takvimi şablonları:** KDV (takip eden ayın 28'i), muhtasar ve prim hizmet (26'sı), SGK primi (ay sonu),
  geçici vergi (çeyrekten sonraki ikinci ayın 17'si), maaş. Genel takvimdir; işletmenize göre muhasebecinizle
  kontrol edin, tarihi düzenleyebilirsiniz.
- **Sabit giderlerden:** Giderler & personel'deki aylık/haftalık/yıllık giderlerden, ilk ödeme tarihi seçilerek;
  gider döneminde tekrar eder.

Gecikmiş ve yaklaşan ödemeler kenar çubuğundaki **zilde** de görünür.

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
(`reminder:4:2026-10-28:before`). Gönderim başarısız olursa anahtar yazılmaz, ertesi sabah yeniden denenir; hata
ekrandaki "Son gönderimler"de görünür.

Ekrandan:

- bildirim adresi ekleme, kapatma, silme;
- **Deneme gönder** (kayıtlı gönderenle, etkin adreslere);
- **Bugünküleri şimdi gönder** (sabahı beklemeden; daha önce gidenler tekrar gitmez);
- gönderen adresi ve gün ayarları.

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

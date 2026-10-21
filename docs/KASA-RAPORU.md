# Gün sonu kasa raporu

Ekran: **Kasa raporu** (`/panel/kasa`). Personel her akşam kapanışta ModPOS'tan Z raporunu alır, kasadaki nakdi sayar
ve buraya girer. Telefonda alt menüde **Kasa**.

## Personel ne girer

| Bölüm | Alanlar |
|-------|---------|
| Z raporu (ModPOS) | Toplam satış, nakit, kredi / banka kartı; varsa yemek kartı, online, diğer; ödenmez / ikram (ciro dışı); Z no ve fiş sayısı (isteğe bağlı) |
| Kasa (nakit) | Açılış (önceki raporun ertesi güne devrinden kendiliğinden dolar), akşam sayılan nakit, gün içinde kasadan çıkan (harcama, teslim) ve neye çıktığı, sayımdan sonra teslim edilen |
| Kart | Banka POS cihazının gün sonu toplamı (isteğe bağlı) |
| Not | Fark varsa nedeni (bozuk para, iade, yanlış fiş…) |

Yazarken hesaplananlar:

- **Olması gereken nakit** = açılış + nakit satış − gün içinde çıkan
- **Kasa farkı** = sayılan − olması gereken. 1 ₺'nin altı "tutuyor", eksi **eksik** (kırmızı), artı **fazla** (turuncu).
- **Ertesi güne devir** = sayılan − teslim edilen. Ertesi günün açılışı buradan dolar.
- **Kart farkı** = banka POS − ModPOS kart.
- **Z kontrolü**: ödeme türlerinin toplamı Z toplamından farklıysa uyarı çıkar (yanlış yazılmış tutar).

Gece 05:00'e kadar kapanan gün bir önceki güne yazılır. Personel bugünün ve dünün raporunu girer ya da düzeltir.
Daha eski bir günü yalnız yönetici açar. Rapor yeniden gönderilince "güncellendi" diye işaretlenir. Arada başkası
göndermişse üzerine yazılmaz: sayfa yenilenip onun girdikleri görülür.

## Gönderince

- **E-posta:** yöneticinin seçtiği adreslere gider (varsayılan `bizimfutbol9@gmail.com` ve `iletisim@alpkoc.com.tr`).
  Konu örneği: "Kasa raporu · 21 Ekim Salı · 120 ₺ eksik". İçinde kasa sonucu, Z raporu, kasa, kart, günün zayi ve
  ikramı yer alır. Panelde kayıtlı ikramın menü fiyatıyla değeri ModPOS'un ödenmez tutarıyla karşılaştırılır.
  E-posta gitmezse rapor yine kaydedilir; ekranda "Yeniden dene" çıkar.
- **WhatsApp:** "WhatsApp ile gönder" ayrıntılı metni hazır açar. Ayarlarda numara girildiyse o sohbet açılır,
  girilmediyse kişi ya da grup seçilir. "Metni kopyala" ile başka yere de yapıştırılır.
- **Zil:**
  - Personele: akşam 20:00'den sonra bugünün raporu girilmediyse hatırlatma.
  - Yöneticiye: dünün raporu girilmediyse ve son raporda fark varsa bildirim.

## Yönetici

- **Günden güne:** ayın her günü bir satır, rapor girilmeyen günler dahil. Satırda Z toplamı, nakit / kart, kasa
  farkı rozeti, kart farkı ve "Z tutmuyor" işaretleri var. Satıra dokununca ayrıntı açılır: WhatsApp, düzenle,
  e-postayı yeniden gönder, sil.
- **Ay özeti:** Z toplamı, net kasa farkı, eksik ve fazlaların toplamı, rapor girilen gün sayısı.
- **Rapor alıcıları:** e-posta adresleri (en çok 10), e-posta açık / kapalı, WhatsApp numarası ve "Deneme e-postası".
  E-posta için Vercel'de `RESEND_API_KEY` gerekir (`docs/BILDIRIMLER.md`).

Dosyalar: `src/lib/cash-report.ts` (hesap, WhatsApp metni; `tests/kasa-raporu.test.ts`), `src/server/actions/cash-report.ts`,
`src/server/notify/cash-report-template.ts` (e-posta), `src/app/panel/kasa/`.

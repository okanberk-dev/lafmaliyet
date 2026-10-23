# Zayi ve ikram

Ekran: **Zayi & ikram** (`/panel/zayi`, Stok altında; telefonda alt menüde **Zayi**). Personel gün içinde şunları girer:

- **Zayi:** atılan, bozulan, dökülen, yanlış hazırlanan.
- **İkram:** ödenmeden verilen; müşteriye, personele ya da tadım için.

Uygulamadaki ödülle (damga kartı, kilometre taşı, davet kuponu) verilen içecek **ikram değildir**. Ödül kuponu yalnız
uygulama ve web siparişinde kullanılır (kasada bozdurulmaz): sipariş bar ekranına düşer, Gelir-gider'de ve Tutarlılık'ta
online satış olarak sayılır ([SITE-SATIS.md](SITE-SATIS.md), [SITE-SIPARIS.md](SITE-SIPARIS.md)). Buraya da girilirse
malzemesi tutarlılıkta iki kez düşülür. Form ikram seçilince bunu hatırlatır.

ModPOS'ta bunlar ödenmez ya da hiç girilmez, bu yüzden satış raporunda görünmezler. Panele girilmeleri gerekir.

## Kayıt

- **Menü ürünü** adetle girilir (ör. 2× Latte M). Malzemesi reçeteden hesaplanır, fire payı eklenmez.
- **Hammadde** sayım biriminde girilir (ör. Süt 1,5 LT). Sayım birimi yoksa kendi biriminde girilir (gr, ml, adet).
- **Neden** tek dokunuşla seçilir:
  - Zayi: bozuldu / tarihi geçti, döküldü / kırıldı, yanlış hazırlandı, müşteri geri gönderdi.
  - İkram: müşteri, personel, tadım.
- Not isteğe bağlıdır. Son girilen kalemler tek dokunuşla yeniden seçilir.
- Personel bugüne ve düne girer; kendi kaydını o gün siler. Yönetici her günü açar, her kaydı siler.

## Bağlantılar

| Yer | Ne olur |
|-----|---------|
| Tutarlılık (`/panel/tutarlilik`) | Her malzemenin sayım sapmasından kayıtlı zayi ve ikram düşülür. Satırda "zayi + ikram … · kalan …", özette "kayıtlı zayi + ikram … · açıklanamayan …" görünür. Sapma, kullanım ve fatura farkının kendisi değişmez |
| Kasa raporu (`/panel/kasa`) | Günün zayi ve ikramı ekrana, e-postaya ve WhatsApp metnine eklenir. E-postada kayıtlı ikramın menü değeri, Z raporundaki ödenmez tutarıyla karşılaştırılır |
| Bugün (`/panel/bugun`, personel) | Günün kayıt sayısı ve özeti. Akşam (20:00'den sonra) kasa raporu gönderilmeden "Rapordan önce" der: özet rapora geçtiği için eksik kayıt rapordan önce girilir; rapor gönderilince tamam ([BUGUN.md](BUGUN.md)) |
| Satışlar (`/panel/satislar`) | Ayın "Ödenmez / ikram" alanının altında panelde kayıtlı ikram ve menü değeri görünür; "Bunu yaz" ile alana yazılır. ModPOS'un rakamı esastır, kendiliğinden değişmez |
| Yönetici ay özeti (`/panel/zayi`) | Zayi ve ikramın malzeme maliyeti (KDV hariç), ikramın menü değeri, ModPOS'un ödenmez tutarı ve en çok giden kalemler |

**Çift sayım yok.** Gelir-giderdeki mal maliyeti stok farkından gelir (geçen ay sayımı + alınan − bu ay sayımı). Zayi
ve ikramın malzemesi bu tutarın zaten içindedir. Bu yüzden ayrıca gider yazılmaz; kayıtlar yalnız farkın nereye
gittiğini açıklar.

Dosyalar:

- `src/lib/waste.ts`
- `src/lib/calc/engine.ts` (`recordedUsage`, `wasteSummary`)
- `src/lib/calc/insights.ts` (`consistency`)
- `src/server/actions/waste.ts`
- `src/app/panel/zayi/`
- Test: `tests/zayi-ikram.test.ts`

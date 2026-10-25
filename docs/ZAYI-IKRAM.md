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
- Personel doğrudan bugüne ve düne girer; dün, o günün kasa raporu kilitlenene kadar (dünün raporu da bugünün raporu
  da girildiyse dün kapanır; kasanın kuralı `staffDayEditable`, unutulan dünün raporu yoksa dün açık kalır). Kendi
  kaydını aynı pencerede siler. Yönetici her günü açar, her kaydı siler.
- Kapalı işaretli güne (Satış tahmini › Özel günler, `kapali`; [KASA-RAPORU.md](KASA-RAPORU.md) › Kafe kapalıydı)
  personel kayıt giremez, istek de açamaz; yönetici girer.

## Geç kayıt ve silme isteği (dalga 10 §2.8)

Geçmiş güne yazılan kayıt stok açığını "açıklanmış" gösterir, silinen kayıt iz siler: ikisi de yöneticinin onayına
gider (ortak kuyruk, [ONAYLAR.md](ONAYLAR.md); türler `zayi-gec` ve `zayi-sil`). Kayıt onaya kadar hiç değişmez.
Personel hiçbir yerde tutar görmez.

**Personel** (`/panel/zayi`):

- Gün şeridi: "Bugün · 24 Eki", "Dün · 23 Eki" ve "Önceki gün" seçicisi. Seçici tarih alanı değil, izin verilen 13 günü
  ("22 Eki Per" … "10 Eki Cmt") listeleyen bir seçim kutusudur; seçince o güne gider.
- Günün kipi sunucuda hesaplanır (`staffWasteMode`):
  - **doğrudan:** bugün; dün kilitlenene kadar;
  - **istek:** kilitli dün ve dünden önceki 14 güne kadar (`LATE_WINDOW_DAYS`): kart "Geç kayıt isteği", zorunlu
    "Yöneticiye açıklama" (3–300), "Onaya gönder", bildirim "Onaya gönderildi: Latte M 2 adet". Kişinin aynı gün,
    tür, kalem ve miktarda bekleyen isteği varsa yenisi açılmaz ("Aynı istek bekliyor; miktarı birleştirmek için
    geri çekip yeniden gönderin");
  - **kapalı:** 14 günden eski ya da ileri gün: form yok, "Bu gün 14 günden eski; yalnız yönetici girer" ve "Bugüne
    dön" (sessizce bugüne düşmez).
- Satırın silme düğmesi sunucuda hesaplanır (`staffDeleteMode`) ve satıra prop olarak gelir: kendi kaydı doğrudan
  yolda çöp kutusu; başkasının kaydı ya da kilitli günün kaydı "Silinmesini iste" (zorunlu "Neden?"); 14 günden eski
  kayıtta düğme yok.
- Silinmesi istenen satırda herkese "Ayşe silinmesini istedi" rozeti (yalnız ad); isteyene "Geri çek".
- Bekleyen kendi geç kayıt isteği listenin başında soluk satır: "Onay bekliyor" ve "Geri çek". Onayla giren kaydın
  rozeti "Geç kayıt · Mehmet onayladı 24 Eki".
- Zil ("İsteklerim"): "Geç kayıt onaylandı: 2× Latte M (15 Eki)", "Silme reddedildi: …" (yöneticinin notuyla),
  "İstek kapandı: … · Kayıt silindi". Kaydın sahibine ayrıca: "Kaydınız silindi: Süt 1,5 LT (15 Eki) · Ayşe istedi".

**Yönetici:**

- **Onaylar › Zayi ve ikram**, istek başına kart (`#istek-<id>`), en eski gün önce:
  - Geç kayıt: "2× Latte M · 15 Ekim Perşembe", neden, not ve açıklama, isteyen ve ne zamandır beklediği; "Malzeme
    maliyeti 38 ₺ (KDV hariç, bugünkü fiyatlarla)", ikramda "· menü değeri 170 ₺" (maliyet ay özetiyle aynı
    fonksiyondan, `model.wasteCost`). Bağlam: o gün aynı kalemden kayıt, aynı gün ve kalem için başka bekleyen istek,
    ikramda "Z ödenmez … · kayıtlı ikram menü değeri … → bu kayıtla …", günün kasa raporu (yok ya da gönderilmiş,
    özetinde bu kayıt yok), ayın sayımı girildiyse "onaylanırsa tutarlılık değişir". "Onayla ve ekle" / "Reddet".
  - Silme: önce ve belirgin "Mehmet girdi · 15 Eki 21:40", sonra isteyen ve neden; kayıt o günün kasa raporu
    e-postasına girdiyse uyarı. Kayıt yoksa ya da istekten sonra değiştiyse "Kayıt zaten silinmiş" ve tek düğme
    "Kapat". "Onayla ve sil" / "Reddet".
- Zil: "3 zayi / ikram isteği onay bekliyor" (tek satır, en yeni istek yeniden okunmamış yapar).
- Zayi sayfası: "Bu gün için 1 istek onay bekliyor · Onaylar". Tutarlılık: "Bu ay için onay bekleyen N zayi / ikram
  isteği · Onaylar".

**Kurallar** (`src/server/waste/core.ts`):

- Geç kaydın onayı yöneticinin yazım yolundan geçer, kaydı isteyenin adıyla yazar (`created_by` isteyen); kalem hâlâ
  var ve adı istekteki adla aynı olmalı (etkin olması aranmaz: istek anında etkindi). Süre dolmaz: 10 gün bekleyen
  istek yine onaylanır.
- Silme onayı satırı kilitleyip istekteki hâliyle karşılaştırır (gün, tür, ad, miktar, birim, giren, an). Tutmazsa ya
  da satır yoksa istek "Kayıt zaten silinmişti" diye kapanır, hiçbir şey silinmez.
- Her silmeden sonra (doğrudan ya da onaylı) aynı kaydın öteki bekleyen silme istekleri kapanır ("Kayıt silindi").
- Kimse kendi isteğini onaylayamaz; yönetici yalnız ekranda gördüğü sürümü onaylar; eşzamanlı iki onaydan biri kalır.
- İşlem geçmişi: "Geç zayi / ikram kaydı istendi", "Zayi kaydının silinmesi istendi", "Geç zayi / ikram isteği geri
  çekildi", "Zayi silme isteği geri çekildi"; "Geç kayıt onaylandı / reddedildi", "Silme onaylandı / reddedildi",
  "Silme isteği kapandı" (başlık, "Ayşe istedi" ve not; nedenin ilk 200 karakteri).

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

- `src/lib/waste.ts`, `src/lib/waste-requests.ts` (kipler, metinler, isteklerin yükü)
- `src/lib/calc/engine.ts` (`recordedUsage`, `wasteCost`, `wasteSummary`)
- `src/lib/calc/insights.ts` (`consistency`)
- `src/server/waste/core.ts` (doğrudan kayıt ve silme, istek, karar)
- `src/server/actions/waste.ts`, `src/server/actions/waste-requests.ts`
- `src/server/data/waste.ts`, `src/server/data/waste-requests.ts` (personelin okuyucuları beyaz listeyle, yöneticinin kartları)
- `src/app/panel/zayi/`, `src/app/panel/onaylar/ops-section.tsx` ve `ops-cards.tsx`
- Testler: `tests/zayi-ikram.test.ts`, `tests/zayi-istek.test.ts`, `tests/zayi-istek-db.test.ts`
  (`ZAYI_ISTEK_TEST_DATABASE_URL`)

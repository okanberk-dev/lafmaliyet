# Muhasebeci paketi ve ay kapanış e-postası

Son güncelleme: 26 Kasım 2026. Yapılacaklar › Dalga 3: "Muhasebeciye aylık tek paket ve ay kapanış e-postası."

## 1. Paket

Ayın muhasebeye giden kayıtları **tek Excel dosyasında** (`laffogato-muhasebe-YYYY-MM.xlsx`), **bütün şubeler** (muhasebe
şirketindir; seçili şubeden bağımsız). Sekmeler:

| Sekme | İçerik |
|-------|--------|
| Özet | Ay, oluşturulma, dönemin panelde kapalı olup olmadığı; fatura adedi ve ödenecek toplamı, faturaların KDV'si, harcama adedi ve toplamı, kasa raporu olan gün, ModPOS ve yazarkasa Z toplamı, oran oran yazarkasa KDV'si, sabit giderlerin aylık karşılığı |
| Faturalar | Belge tarihi, tedarikçi, vergi no, fatura no, kategori, KDV hariç, iskonto, KDV, ödenecek, ödendi mi, şube, kaynak (Paraşüt / elle), dönem notu |
| Harcamalar | Aylık harcamalar (fatura dışı gider): tarih, kategori, açıklama, tutar, KDV, ödeme şekli, belge (fiş, e-Arşiv, fatura, belgesiz), şube, dönem notu |
| Kasa raporları | Gün ve şube başına: ModPOS Z no ve toplamı, nakit, kart, yemek kartı, online, diğer, kasadan çıkan, kasa farkı, yazarkasa Z no, toplamı ve KDV'si |
| Z KDV dökümü | Yazarkasa (banka POS) Z'lerinin oran oran satışı ve KDV'si (kasa raporuna girilen ya da fotoğraftan okunan), sonunda oran oran toplam |
| Sabit giderler | Ayın sabit gider kalemleri: tutar, dönem, ayın karşılığı, şube |

Her tablonun başlığı donuk ve süzgeçli, tarihler Excel tarihi, tutarlar ₺ biçimli sayı, sonunda TOPLAM. Boş tablo
"Bu ay … yok" der.

**Dönem kapanışıyla ([DONEM-KAPANISI.md](DONEM-KAPANISI.md))**: faturalar ve harcamalar hesap gününe göre. Belgesi bu
aydaki ama başka aya alınmış kayıt, kapalı döneme düşüp karar bekleyen kayıt ve başka aydan bu aya alınmış kayıt
listede **dönem notuyla** durur; toplamlara yalnız bu ayda sayılanlar girer. Panelin hesaplarıyla aynı rakam.

Kod: `src/lib/muhasebe/paket.ts` (saf: ayarlar, gönderim günü, özet, çalışma kitabı; `tests/muhasebe-paketi.test.ts`),
`src/server/muhasebe/paket.ts` (veri, dosya, gönderim; `tests/donem-kapanisi-db.test.ts`), e-posta
`src/server/notify/muhasebe-template.ts`.

## 2. Nereden

- **Ayarlar › Muhasebeci paketi** (`/panel/ayarlar#muhasebe`, yalnız yönetici): muhasebeci e-posta adresleri (en çok 5;
  boşsa e-posta gitmez), "Ay kapanınca gönder" (varsayılan açık), ay seçimi, **Paketi indir (.xlsx)**, **Şimdi gönder**
  (onaylı; kaydedilmiş adreslere), son gönderim (ay, an, kim, kime).
- İndirme ucu: `/api/muhasebe/paket?ay=YYYY-MM` (yalnız yönetici; ay verilmezse geçen ay).

## 3. Ay kapanış e-postası

- **Ne zaman:** günlük işte (`/api/cron/gunluk`), ayın **1'inde** geçen ayın paketi. Sabah işi o gün çalışmadıysa ya da
  e-posta gidemediyse **2'si ve 3'ünde** yeniden denenir; bir ay kendiliğinden bir kez gider (`autoMonth`; aynı ayın
  Resend anahtarı `muhasebe-paket-YYYY-MM` ikinci gönderimi de yutar).
- **Kime:** Ayarlar'daki muhasebeci adresleri. Adres yoksa ya da ayar kapalıysa **gönderilmez** (adım yazılmaz). Personel
  ya da pasif bir panel hesabının adresi düşer (sabah e-postasıyla aynı kural); hepsi düşerse hata.
- **Ne:** konu "Muhasebe paketi · Ekim 2026"; ayın özeti satır satır (fatura, bekleyen, harcama, kasa, oran oran
  yazarkasa KDV'si, sabit gider, dönemin kapalı olup olmadığı) ve paket **ekte**. Panel bağlantısı yok (muhasebecinin
  panel hesabı yok; her şey ekte).
- **Elle:** "Şimdi gönder" seçili ayı her basışta yeniden gönderir (kendiliğinden gönderimin ayını değiştirmez).
- Günlük işler (Ayarlar › Günlük işler): adım `muhasebe` yalnız gönderilince ("Muhasebe paketi gönderildi") ya da hata
  verince yazılır; hata işi "kısmen" yapar. Her gönderim ve hata işlem geçmişinde.

## 4. Kararlar

- Biçim: çok sayfalı Excel (zip değil): tek dosya, muhasebecinin açtığı program; fatura belgelerinin PDF'leri pakete
  girmez (Paraşüt'te zaten muhasebecide).
- Paket dönem kapanışından bağımsız gider: ay kapatılmasa da 1'inde gönderilir, e-posta "Dönem panelde henüz kapatılmadı"
  der. Kapatmak yöneticinin kararıdır (beyandan sonra).
- Gönderim günü takvim günü değil iş günü (05:00'te döner); sabah işi 08:00'de çalıştığı için aynı gün.

# Tedarikçiler (cari kartları ve ödeme takibi)

Ekran: **Satış & gider › Tedarikçiler** (`/panel/tedarikciler`, yalnız yönetici). Her tedarikçinin cari bilgileri
(unvan, vergi no, IBAN, iletişim, vade), faturaları ve kalan borcu tek yerde durur. Faturalar Paraşüt'ten her sabah
kendiliğinden gelir ([PARASUT.md](PARASUT.md)); **ödendi / ödenmedi'yi siz işaretlersiniz.**

## Liste

- Faturası olan her tedarikçi listede görünür, cari kartı açılmamış olsa da. Kart yalnız bilgi girilince açılır
  (**Tedarikçi ekle** ya da tedarikçi sayfasında **Cari kartı ekle**).
- Özet kartları: **Kalan borç**, **Vadesi geçen**, **7 gün içinde** (vadesi gelecek), **Bu ay ödenen** (ödeme günü bu
  ayda). Karta dokununca tedarikçi tedarikçi döküm açılır.
- Satırda: son fatura, ödenmemiş fatura sayısı, kalan borç, en yakın vade, IBAN (dokununca kopyalanır). Rozetler:
  *Peşin*, *IBAN yok* (borcu varsa), *N talep edildi*, *N Paraşüt'te ödendi*.
- Arama (ad, diğer adlar, unvan, vergi no, IBAN, telefon, yetkili, e-posta), süzgeç (**Borcu olanlar**, **Vadesi
  geçen**, **Bilgisi eksik**) ve sıralama (kalan borç, en yakın vade, son fatura, ad) adreste durur (`?ara=`,
  `?durum=`, `?sirala=`).
- ⌘K araması tedarikçileri de bulur (unvan ve vergi no ile).

## Tedarikçi sayfası (`/panel/tedarikciler/<ad>`)

- **Cari kartı:** IBAN (kopyala), **Ara** / **WhatsApp** / **E-posta**, unvan, vergi no ve dairesi, yetkili, adres,
  vade, ödeme şekli, faturalarda geçen diğer adlar, not. Eksik önemli bilgi (IBAN, vergi no, telefon / e-posta)
  kartın altında yazar.
- Özet kartları: **Kalan borç**, **Vadesi geçen**, **bu yılın alımları** (ay ay), **Son ödeme** (son 12 ödeme günü).
- **Faturalar:** Ödenmemiş / Tümü / Ödendi. Her faturada vade (yoksa tahmini vade), durum, belge (PDF) ve
  Faturalar'da açma. Durum hapına dokununca ödeme penceresi açılır; ✓ tek dokunuşla bugün ödendi yapar (kartın
  ödeme şekliyle).
- Birden çok fatura seçilince altta **Ödeme talebi** ve **Ödeme durumu** düğmeleri çıkar. Toplu işlemde ödendi ve
  talep edildi yalnız ödenmemiş faturalara yazılır; zaten ödenmiş faturanın ödeme günü değişmez.
- Her değişiklikten sonra bildirimdeki **Geri al** 10 saniye durur; ödendi işaretlenen fatura ayrıca 30 gün boyunca
  Ödemeler & hatırlatıcılar › Son ödenenler'den geri alınır ([BILDIRIMLER.md](BILDIRIMLER.md)).

## Ödeme durumu

| Durum | Ne demek | Nerede görünür |
|-------|----------|----------------|
| **Ödenmedi** | Borç duruyor | Kalan borç, Ödemeler & hatırlatıcılar, zil, sabah e-postası |
| **Talep edildi** | Ödemesi istendi (ödeme talebi gönderildi), henüz ödenmedi | Ödenmedi gibi sayılır; mavi *Talep edildi* rozeti (Faturalar'da da) |
| **Ödendi** | Ödendi; **ödeme günü** ve **şekli** (havale / EFT, nakit, kart, çek / senet, diğer) kaydedilir | Bu ay ödenen, Son ödeme |

- Ödeme günü bugünden ileri olamaz (en çok yarın). Bilinmiyorsa boş bırakılır. Ödendi işaretlenen faturanın ödeme
  talebi kapanır.
- Faturalar ekranındaki fatura penceresinde de **Ödeme günü** var (ödenmedi → ödendi yapılınca bugün gelir; boş
  bırakılırsa bilinmiyor). Elle eklenen yeni faturada boş kalırsa fatura günü yazılır. Faturalar'daki ✓ ve Ödemeler'deki
  **Ödendi** bugünü yazar.
- Paraşüt'te ödemesi kayıtlı olup panelde ödenmedi duran gider faturasında mor *Paraşüt'te ödendi* rozeti çıkar;
  tedarikçi sayfasında **Ödendi yap (N)** ile hepsi tek seferde ödendi olur (ödeme günü boş kalır). Durumu
  kendiliğinden değişmez.

### Paraşüt eşitlemesi ödeme durumuna dokunmaz

- Paraşüt'ten gelen her yeni fatura (gider faturası ve içeri alınmamış e-fatura) **ödenmedi** gelir; ödendiğini siz
  işaretlersiniz. İade (eksi) faturası borç sayılmaz (ödeme talebinde düşülebilir, aşağıda).
- **Komisyon faturası** (kategorisi Komisyon: Trendyol, Yemek Sepeti, yemek kartları) ödendi gelir (fatura günü):
  ödenmez, platformun hakedişinden düşülür; kalan borcu şişirmez.
- Eşitleme var olan faturanın ödeme durumunu hiç değiştirmez. Paraşüt'ün bildirdiği yalnız ipucu olarak saklanır
  (`invoices.parasut_unpaid`, ekranda *Paraşüt'te ödendi*). Paraşüt faturayı kapatınca panelde ödenmedi duran kısmen
  ödenmiş faturanın bilinen kalanı korunur (tamamına dönmez).
- **Peşin çalışılan tedarikçi:** kartında **Faturaları ödendi gelsin** işaretliyse yeni faturası ödendi gelir (fatura
  günü, kartın ödeme şekliyle). Peşin tedarikçide IBAN eksik sayılmaz.
- Bu özellikten önce gelmiş faturaların durumu olduğu gibi kalır.
- **Geçmiş faturalar:** ödeme takibi ilk eşitlemeden 30 gün öncesinden başlar (`integration_state` ›
  `payments.since`). Bundan eski bir fatura yeni gelirse (Tarihten eşitle'yle geçmişi doldururken) yüzlerce eski fatura
  "ödenmedi" yığılmasın diye Paraşüt'teki durumuyla açılır: gider faturasında Paraşüt'ün ödeme kaydı, e-faturada
  (ödeme bilgisi yok) ödendi; belgedeki vadesi henüz gelmemiş e-fatura ödenmedi olur. `npm run db:reset` faturaları
  (ödeme işaretleriyle) yeniden yüklediği için başlangıcı da siler; sonraki eşitleme yeniden belirler.

## Vade

Vadesi yazılmamış faturanın tahmini vadesi **fatura tarihi + vade günü**. Vade günü tedarikçinin kartındaki
**Vade (gün)**, boşsa Ödemeler & hatırlatıcılar › Gönderim ayarları'ndaki genel gün (varsayılan 30). Aynı kural
Tedarikçiler'de, Ödemeler & hatırlatıcılar'da, zilde, sabah e-postasında ve ertelemede geçer. Faturada vade yazılıysa
(Paraşüt'ten, e-faturadan ya da elle) o geçer.

## Ödeme talebi

Tedarikçi sayfasında **Ödeme talebi** (ya da seçili faturalarla): ödenmemiş faturalar seçilir, hazır metin oluşur:

```
Ödeme talebi · L'Affogato
Alıcı: SÜTAŞ SÜT ÜRÜNLERİ A.Ş.
IBAN: TR07 0006 2000 0629 8765 4321 01
Banka: Garanti BBVA
Vergi no: 7810030530
Tutar: 12.450,50 ₺
Açıklama: SUT2026000098, SUT2026000123 nolu faturalar

Faturalar (2):
• 25.08.2026 · SUT2026000098 · 4.000 ₺
• 19.09.2026 · SUT2026000123 · 8.450,50 ₺ · vade 19.10.2026

Cuma gününe kadar
```

- Metin ödemeyi yapacak kişiye (muhasebe, ortak) gider ya da bankanın havale ekranına kopyalanır: **Metni kopyala**,
  **WhatsApp** (paylaşım ekranı açılır, kişiyi siz seçersiniz) ya da **E-posta** (taslak açılır, alıcıyı siz
  yazarsınız). Alıcı hesap sahibi, yoksa unvan, yoksa faturadaki addır. İsteğe bağlı not metnin sonuna eklenir.
- Bankanın havale ekranı için IBAN, tutar (`12450,50`) ve açıklama ayrı ayrı kopyalanır.
- **Talep edildi işaretle (N)** seçilen faturaları *talep edildi* yapar (daha önce talep edilenlerin günü korunur).
  Ödeyince **Ödendi** işaretlenir; ödeme talebi kapanır.
- **İade faturaları:** tedarikçinin son 90 gündeki iade (eksi) faturaları pencerede ayrıca, uyarıyla listelenir.
  Hangisinin daha önce düşüldüğü bilinmediği için seçili gelmez; seçilen iade tutardan düşülür, metinde "Düşülen
  iadeler" altında yazar, havale açıklamasına girmez.
- Kartta IBAN yoksa metinde "kartta yok" yazar ve pencerede uyarı çıkar.

## Cari kartı

- **Kimlik:** faturalardaki ad (zorunlu), ticari unvan, VKN / TCKN (10 ya da 11 hane olmalı; kontrol hanesi
  tutmazsa uyarı çıkar, yine kaydedilir), vergi dairesi.
- **Banka:** IBAN (TR + 24 hane, kontrol hanesi denetlenir; banka adı IBAN'dan bulunur ve boşsa yazılır), banka,
  hesap sahibi. Kayıtlı IBAN değiştirilirken teyit uyarısı çıkar (sahte "IBAN'ımız değişti" bildirimi yaygın bir
  dolandırıcılıktır; tedarikçiyi bildiğiniz numaradan arayın); değişiklik eski ve yeni IBAN'la işlem geçmişine yazılır.
- **İletişim:** yetkili, telefon (cep telefonuysa WhatsApp düğmesi çıkar), e-posta, adres.
- **Ödeme:** vade (gün, 0–365), genelde nasıl ödenir (ödendi penceresinde önce bu seçili gelir), *Faturaları ödendi
  gelsin* (peşin).
- **Faturalarda geçen diğer adlar:** aynı tedarikçinin faturalarda farklı yazılan adları ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş.");
  onların faturaları da bu karta toplanır. Benzer adlı kartsız tedarikçiler öneri olarak çıkar.
- **Faturadan doldur:** tedarikçinin en yeni Paraşüt faturalarından (en çok 3) unvan, vergi no ve dairesi, adres,
  telefon, e-posta ve IBAN okunur: e-faturada imzalı UBL belgesinin satıcı bölümünden (`AccountingSupplierParty`,
  `PayeeFinancialAccount`, notlardaki IBAN), gider faturasında Paraşüt'teki kişi kartından (`contacts`). Yalnız boş
  alanlar doldurulur, dolanlar işaretlenir; kaydetmeden önce kontrol edin.
- Kartın adı değişince eski ad, faturaları varsa diğer adlara eklenir (faturalar karttan düşmez); sayfa yeni adrese
  geçer. Kartsız tedarikçinin sayfasında açılan kart başka adla kaydedilirse faturalardaki ad da diğer adlara girer. Kart silinince faturalar silinmez, tedarikçi kartsız görünür; silme bildirimindeki **Geri al** kartı geri
  getirir.
- `npm run db:reset` kartları silmez; faturaların ödendi / talep edildi işaretleri faturalarla birlikte silinir.

## Eşleşme

Faturalar karta yabancı anahtarla bağlanmaz, tedarikçi adıyla eşleşir: büyük / küçük harf, Türkçe ı/i, fazla boşluk
ve sondaki parantezli not ("Sütaş (iade)") sayılmaz (`supplierMatchKey`). Önce kartların kendi adları, sonra diğer
adları bakılır; iki kart aynı adı (ya da diğer adı) taşıyamaz. Sayfa adresi addan üretilir (`sutas`,
`cagdas-kahve`); çakışırsa sonuna sayı eklenir.

## Dosyalar

- `src/app/panel/tedarikciler/logic.ts` (eşleşme, vade, özet, süzgeç, IBAN / VKN / TCKN, telefon, ödeme talebi metni)
- `src/app/panel/tedarikciler/breakdowns.ts` (özet kartı dökümleri)
- `src/app/panel/tedarikciler/` (liste, `[cari]/` tedarikçi sayfası, kart, ödeme ve ödeme talebi pencereleri)
- `src/server/actions/suppliers.ts` (kart kaydet / sil / geri al, Faturadan doldur)
- `src/server/actions/invoices.ts` (`setInvoicePayment`, `restoreInvoicePayment`)
- `src/server/data/suppliers.ts` (ekranın verisi, kartın vade günü, peşin çalışılan tedarikçiler)
- `src/server/parasut/mapping.ts` (`newInvoicePayment`, `contactInfo`), `ubl.ts` (`partyInfo`)
- Tablo `suppliers`, faturada `paid_at`, `paid_via`, `payment_requested_at` (`drizzle/0016_tedarikciler.sql`)
- Test: `tests/tedarikciler.test.ts`

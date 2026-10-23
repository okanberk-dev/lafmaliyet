# Mal siparişi (hızlı sayım, sipariş listesi, teslim kontrolü)

Ekranlar: **Hızlı sayım** (`/panel/hizli-sayim`; yönetici ve personel), **Mal siparişi** (`/panel/mal-siparisi`;
yalnız yönetici) ve onun sekmeleri **Gönderilenler** (`…/gonderilen`) ile **Kalemler** (`…/kalemler`). Menüde Stok
altında, Stok sayımı'ndan sonra.

Haftada bir 10–15 kritik kalem (süt, espresso çekirdeği, krema, bardak…) telefondan sayılır; panel her tedarikçi için
ne kadar sipariş edileceğini hazırlar, yönetici tek dokunuşla WhatsApp'tan gönderir. Paraşüt faturası gelince sipariş
kalem kalem karşılaştırılır: tutuyorsa kendiliğinden kapanır, tutmuyorsa fark Gönderilenler'de, zilde ve Bugün'de
görünür.

**Adlar.** Yalın "sipariş" laffogato.net'in uygulama siparişidir (bar ekranı, [SITE-SIPARIS.md](SITE-SIPARIS.md)). Bu
özellik arayüzde **Mal siparişi**, kodda `reorder`.

## 1. Haftalık akış

1. **Kalemler** (bir kez): 10–15 kritik kalem takibe alınır (Eklenebilecek kalemler ayda en çok tutan, sayım birimi
   olan kalemleri önerir; ya da hammadde aranır). Her kalemin tedarikçisi, sipariş birimi, mesajdaki adı ve teslim
   süresi varsayılanla gelir (§4); hedef stok satışlardan önerilir, istenirse elle yazılır.
2. **Sayım günü** (varsayılan Pazartesi): Bugün'de iki rolde "Haftalık hızlı sayım" satırı çıkar, "Sabah özeti"
   bildirimi açık telefonlara bildirim gider. Personel ya da yönetici **Hızlı sayım**'da miktarları sayım biriminde
   (KG, LT, ADET, DİLİM; yarım = 0,5) yazar. Ekranın başındaki **Gelen mal var mı?** yoldaki siparişleri gösterir:
   sayımdan önce gelene **Geldi** denir, yoksa o mal sipariş listesinde ikinci kez sayılır.
3. **Mal siparişi** (yönetici): tedarikçi tedarikçi öneri listesi. Miktar − / + ile ya da dokunup yazılarak değişir;
   **WhatsApp ile gönder** penceresi mesajı gösterir, isteğe bağlı not eklenir, **WhatsApp'ta aç** sohbeti açar ve
   siparişi kaydeder.
4. **Mal gelir:** personel Hızlı sayım'da (ya da yönetici Gönderilenler'de) **Geldi** der. Fatura Paraşüt'e düşünce
   sabah eşitlemesi (ya da Şimdi eşitle) siparişi faturayla karşılaştırır (§7).

## 2. Formüller

Bütün miktarlar malzemenin kendi biriminde (gr, ml, adet, dilim); sayım birimi yalnız yuvarlama ve ekran içindir
(`src/lib/reorder/levels.ts`, `usage.ts`).

| Ad | Hesap |
|----|-------|
| **Günlük kullanım** | Son satış ayının (Genel bakış'taki ay) ModPOS satışı × ölçek + laffogato.net kafe siparişleri × online ölçeği + o ayın kayıtlı zayi ve ikramı × online ölçeği, reçeteye göre, ÷ 30. Ölçek her yerdeki "ayda" ile aynı (`salesBasis`): satışlar Ayarlar › ayda açık güne çekilir. Genel fire payı eklenmez; emniyet payı kayda geçmeyen kaybı karşılar |
| **Sayım aralığı** | Art arda iki sayım günü arasındaki en uzun ara: haftada bir gün 7, Pazartesi + Perşembe 4. Her sipariş bir sonraki sayıma kadar yetmeli |
| **Teslim süresi** | Kalemde yazılan; yoksa aynı tedarikçinin takipteki kalemlerinde en çok yazılan (eşitlikte uzun olan); yoksa Ayarlar'daki (varsayılan 2 gün) |
| **En az** | günlük × teslim × (1 + pay). Eldeki bunun altındaysa satır **Az kaldı**: şimdi verilen sipariş gelmeden bitebilir |
| **Hedef** | Elle yazılan; yoksa günlük × (teslim + sayım aralığı) × (1 + pay), sayım biriminde yukarı yuvarlı (KG ve LT 0,5'e, ADET ve DİLİM tama). Pay varsayılan %20. Satış verisi yoksa ya da kalem reçetede geçmiyorsa **Hedef yok**: elle yazılır |
| **Eldeki** | En yeni sayım: hızlı sayım ya da bu / geçen ayın Stok sayımı (hangisi yeniyse; ay sonu sayımı da listeyi tazeler). Sayıldığı andaki sayım birimi çarpanıyla |
| **Siparişte** | İptal edilmemiş, son 14 günde gönderilmiş ve sayıma girmemiş siparişlerin bu kalemi. Sayıma girmemiş: hiç gelmedi ya da sayımdan sonra geldi (Geldi işareti ya da eşleşen faturanın günü) |
| **Gereken** | hedef − eldeki − siparişte |
| **Önerilen** | gereken ÷ sipariş biriminin içeriği; küsur en az dörtte birse bir birim daha (5.000'lik bardak kolisi ancak gerçekten gerekince). Az kaldı ve gereken varken 0 çıktıysa 1. Gereken yoksa 0 |
| **Sayım eski** | Son sayım 4 günden eskiyse satır "Sayım eski" der; öneri yine hesaplanır, ekranın başı sayım ister |

**Örnek** (Excel verisi, Eylül 2026, 30 açık gün, ölçek 1, pay %20, haftada bir sayım):

- **Süt %2,5**: ayda 80,68 L → günde 2,69 L. Sütaş, teslim 1 gün. Hedef = 2,69 × (1 + 7) × 1,2 = 25,8 → **26 LT**;
  en az = 2,69 × 1 × 1,2 = **3,2 L**. Eldeki 6 LT → gereken 20 L. "1 koli = 12 LT" ise 20 ÷ 12 = 1,67 → **2 koli**;
  "1 adet = 1 LT" ise **20 adet**.
- **Espresso çekirdeği**: ayda 16,3 kg → günde 0,543 kg. Kaldi, teslim 2 gün. Hedef = 0,543 × 9 × 1,2 = 5,87 →
  **6 KG**; en az **1,3 KG**. Eldeki 2,5 KG → gereken 3,5 kg; 1 kg'lık paketle 3,5 → **4 adet**.

**Satışın kaynağı (ModPOS günlük dökümü).** Bugün tek kaynak aylık veridir. Günlük ürün dökümü için bir ağız var
(`loadDailyProductSales`, `src/server/data/daily-sales.ts`); bugün `null` döner ve mal siparişi aylık veriye düşer.
ModPOS'un günlük dökümü gelince yalnız o ağız doldurulur (tablo ve okuyucu) ve günlük kullanım son 28 günden
hesaplanır; ekranlar değişmez.

## 3. Sayım günleri

- Kalemler › Ayarlar › **Sayım günleri** (bir ya da birkaç gün; varsayılan Pazartesi). İki gün seçilirse her sipariş
  daha kısa bir aralığa yeter, hedefler küçülür.
- Gün 05:00'te döner (kasa raporu gibi): gece 01:00'de girilen sayım önceki günün sayımıdır.
- **Ayın son günü hızlı sayım istenmez**: o gün ay sonu Stok sayımı yapılır ve eldeki olarak okunur. Bugün satırı ve
  bildirim çıkmaz.
- **Gecikti:** son sayım sayım aralığı + 1 günden eskiyse (haftada birde 8 gün) Bugün satırı her gün "Gecikti" der.
- **Bildirim:** sayım günü sabah işinde (08:00–09:00), takipte kalem varsa ve hepsi sayılmadıysa "Sabah özeti" açık
  cihazlara "Bugün hızlı sayım günü" bildirimi gider (`src/server/notify/reorder-push.ts`; `job_runs` adımı `count`,
  yalnız gönderilince yazılır, en çok 8 sn).

## 4. Kalemin varsayılanları

| Alan | Varsayılan | Değiştirmek |
|------|------------|-------------|
| **Tedarikçi** | Bu hammaddenin en yeni bağlı Paraşüt kalemindeki tedarikçi ("son alınan"); yoksa Hammaddeler'deki tedarikçi metni Tedarikçiler'deki tek bir grupla eşleşirse o; yoksa seçilmemiş ("Tedarikçisi seçilmemiş" grubunda, gönderme düğmesi yok) | Kalemler › kaleme dokun › Tedarikçi (önce bu kalemi satanlar, sonra diğerleri) |
| **Sipariş birimi** | O tedarikçinin en yeni bağlı fatura kalemindeki birim ("Koli" → "koli") ve ürün bağlantısının çarpanı (1 koli = 12 LT); kalem yoksa "paket" ve hammaddenin paket boyu | Sipariş birimi ve "1 birim =" |
| **Mesajdaki ad** | O fatura kalemindeki ürün adı (tedarikçinin kendi adı); yoksa paket açıklaması; yoksa hammaddenin adı | Tedarikçideki adı |
| **Teslim süresi** | §2 | Kalemde ya da tedarikçinin satırındaki teslim düğmesiyle (o tedarikçinin bütün kalemleri) |

Tedarikçi adla saklanır ve her okumada Tedarikçiler'in gruplamasıyla çözülür (diğer adlar, vergi no): kart adı
değişse de kalem doğru tedarikçide kalır. Pasif ya da "Sayılmaz" yapılan hammadde Hızlı sayım'dan ve listeden düşer;
Kalemler'de soluk görünür, takipten çıkarılabilir. Su ve buz takip edilmez.

## 5. Mesaj ve telefon

```
Merhaba, *L'Affogato* siparişimiz:

• SÜT %2,5 YAĞLI 1 L: 2 koli
• KREMA 1 L: 6 adet

Not: Perşembe sabah 10'dan önce
Teşekkürler.
```

- İmza Kalemler › Ayarlar › **Mesajdaki ad** (varsayılan L'Affogato; WhatsApp'ta kalın). Yalnız miktarı 0'dan büyük
  kalemler yazılır.
- Telefon tedarikçinin kartından (Tedarikçiler › Düzenle › telefon). **Cep telefonuysa** WhatsApp doğrudan o kişiyle
  açılır. **Telefon yoksa ya da sabit hatsa** WhatsApp'ın paylaşım ekranı açılır, kişiyi siz seçersiniz; pencere
  bunu söyler: telefon yoksa **Telefonu ekle** tedarikçinin sayfasına götürür (Düzenle'den yazılır), sabit hatta
  **Ara** düğmesi çıkar.
- **Metni kopyala** kaydetmez; bildirimdeki **Gönderildi say** kaydeder (kanal "Kopyalandı"). Kaydedilemezse
  bildirim **Yeniden dene** der; aynı istek kimliğiyle gider, çift dokunuş ikinci sipariş açmaz.
- Gönderilen siparişin bildirimindeki **Geri al** siparişi iptal eder.
- Mesajda tutar yoktur; pencerede yönetici için son alış fiyatlarıyla yaklaşık tutar (KDV hariç) yazar.

## 6. Siparişin durumu

| Durum | Ne zaman |
|-------|----------|
| **Yolda · Çarşamba bekleniyor** | Açık; beklenen gün = gönderim günü + kalemlerin en uzun teslim süresi |
| **Gecikti · 28.10.2026 bekleniyordu** | Beklenen gün geçti, Geldi denmedi, fatura yok |
| **Geldi · fatura bekleniyor** | Geldi denildi (personel ya da yönetici) |
| **Fatura geldi · kalemler okunmadı** | Eşleşen faturanın kalemleri henüz okunmadı (kâğıt fatura, e-faturası okunmamış) |
| **Fatura geldi · 1 eksik, 1 fiyat farkı** | Faturayla karşılaştırıldı ve fark var (kırmızı: eksik, gelmedi ya da pahalı; sarı: fazla, ucuz, siparişte yoktu) |
| **Kapandı · not** | Kendiliğinden ("Faturayla tuttu", "45 günde fatura gelmedi") ya da elle (Kapat, not isteğe bağlı) |
| **İptal** | İptal edildi (gönderim bildirimindeki Geri al ya da İptal); siparişte sayılmaz |

Kapanan sipariş 30 gün içinde **Yeniden aç**ılabilir; karşılaştırma hemen yenilenir. Gönderilenler son 90 günü
gösterir; süzgeçler Açık · Fark var · Kapanan · Tümü ve tedarikçi (kartındaki **Bu tedarikçinin siparişleri**, adres
`?tedarikci=<tedarikçi sayfasının adresi>`).

## 7. Teslim kontrolü (faturayla karşılaştırma)

Paraşüt eşitlemesinin içinde, ürün bağlantıları uygulandıktan sonra çalışır (sabah işi, Şimdi eşitle, tedarikçinin
geçmiş faturaları); ürün bağlantısı kaydedilince ya da silinince ve kalemler okununca da yenilenir. Hatası
eşitlemeyi bozmaz, eşitlemenin süresi içinde kalır (`src/server/reorder/match.ts`, `src/lib/reorder/delivery.ts`).

- **Hangi fatura:** aynı tedarikçi (Tedarikçiler'in gruplaması), mal alışı ya da Diğer kategorisi (karaoke box ve
  Alp Koç faturaları değil), tarihi gönderim günü ile 10 gün sonrası arasında, başka bir siparişe bağlı değil.
  Kalemleri okunmuşsa en az bir sipariş kalemi faturada olmalı (hiç örtüşmeyen fatura başka bir teslimattır); kalemsiz
  fatura 3 gün bekledikten sonra eşleşir. Birden çoksa sipariş kalemleriyle en çok örtüşen, eşitlikte tarihi beklenen
  güne en yakın.
- **Bir fatura bir sipariş.** Yanlış eşleştiyse **Faturayı değiştir** (ya da "Fatura yok"): elle seçilen eşleşmeye
  eşitleme dokunmaz. Fatura silinirse (Paraşüt'te iptal) eşleşme kalkar ve elle seçilmiş olsa da sonraki eşitleme
  yeniden arar. Kendiliğinden eşleşen faturanın kategorisi kafe dışına geçerse ya da kalemleri okununca siparişle hiç
  örtüşmezse de eşleşme kalkar.
- **Karşılaştırma** malzemenin kendi biriminde, faturadaki ürünün hammadde bağlantısı ve çarpanıyla: hiç gelmediyse
  **Gelmedi**, %98'in altı **eksik**, %102'nin üstü **fazla**, arası **Tamam**. İade kalemi (eksi) miktarı düşürür;
  bedava kalem miktara girer, fiyata girmez.
- **Fiyat:** faturadaki birim fiyat (KDV hariç, iskonto düşülmüş) gönderim anında beklenenle karşılaştırılır (bu
  tedarikçinin son faturası, yoksa hammaddenin fiyatı); ±%3'ün dışı **fiyat farkı**. Beklenen fiyat yoksa ya da 0'sa
  (fiyatı girilmemiş kalem) fiyat karşılaştırılmaz ve tutar tahmini yazılmaz. Hammaddenin fiyatı **Tahmini**yse
  yalnız "~" tutar yazılır, fiyat farkı uyarısı çıkmaz.
- **Siparişte yoktu:** faturada bağlı ama sipariş edilmemiş hammadde. **Hammaddeye bağlı değil:** hiçbir hammaddeye
  bağlı olmayan ürün (nakliye gibi); kapanmayı engellemez.
- **Kendiliğinden kapanır** ("Faturayla tuttu", kapatan "Sistem"): kalemler okundu, her sipariş kalemi Tamam, fiyat
  farkı ve siparişte olmayan kalem yok. Yalnız karşılaştırma değişince denenir: elle yeniden açılan sipariş aynı
  faturayla hemen yeniden kapanmaz.
- **Toplu fatura:** kalemlerin çoğu siparişin en az 1,8 katıysa kart "birden çok siparişi kapsıyor olabilir" der.
  Gelen miktar siparişin yaklaşık tam katıysa (12 kat gibi) kart, ürün bağlantısının çarpanının yanlış olabileceğini
  söyler: çarpan Paraşüt entegrasyonu › Bağlı ürünler'de düzeltilir, karşılaştırma kendiliğinden yenilenir.
- Eşleşen ya da kalemleri okunan siparişte Geldi denmemişse mal faturanın günü 12:00'de gelmiş sayılır.
- **45 gün** faturası gelmeyen açık sipariş "45 günde fatura gelmedi" notuyla kapanır.

Eşitlemenin özeti "3 mal siparişi faturayla karşılaştırıldı · 2 kendiliğinden kapandı" der.

## 8. Nerede görünür

| Yer | Ne |
|-----|----|
| **Bugün** | `hizli-sayim` (iki rol): sayım günü "Bugün", yarım kaldıysa "5 / 14", gecikmişse "Gecikti"; hepsi sayılınca tamamlandı. `mal-siparisi` (yönetici), ilk uyan: teslim farkı (sorun), sipariş hazır (son sayım bugün ya da dün ve siparişi gönderilmemiş öneri var), beklenen günde gelmeyen ([BUGUN.md](BUGUN.md)) |
| **Zil** (yönetici, Faturalar) | "Teslim kontrolü: Sütaş" (fark değişince yeniden okunmamış olur) ve "Mal siparişi gelmedi mi: Kaldi" (beklenen günden 2 gün sonra hâlâ gelmediyse); en çok 5 ([BILDIRIMLER.md](BILDIRIMLER.md)) |
| **Telefon bildirimi** | Sayım günü sabahı (§3) |
| **Paraşüt eşitlemesi** | Özetteki karşılaştırma satırı ([PARASUT.md](PARASUT.md)) |

Genel bakış, sabah e-postası, Faturalar, Tutarlılık ve Stok sayımı değişmez.

## 9. Roller

- **Personel:** Hızlı sayım (sayar, Geldi der ya da geri alır). Fiyat, tutar ve sipariş listesi görmez; sayım ekranı
  ve yükleyicisi fiyat okumaz.
- **Yönetici:** hepsi: Kalemler ve ayarlar, sipariş listesi ve gönderme, Gönderilenler (Kapat, Faturayı değiştir,
  İptal, Yeniden aç).

Her eylem olay kaydına düşer ("Hızlı sayım", "Mal siparişi gönderildi", "Mal siparişi geldi", "Teslim kontrolü", …).

## 10. Veri

| Tablo / anahtar | İçerik |
|-----------------|--------|
| `reorder_items` | Takipteki kalem: hedef (kendi biriminde, yoksa önerilen), teslim süresi, tedarikçi adı, mesajdaki ad, sipariş birimi ve içeriği. Hammadde silinince gider |
| `quick_counts` | Kalem ve iş günü başına bir hızlı sayım: miktar (sayım biriminde) ve sayıldığı andaki çarpanı, sayan ve anı |
| `supplier_orders` | Gönderilen sipariş: istek kimliği (`request_id`, tekrarsız), tedarikçi, telefon, kanal, mesaj, not, kalemlerin gönderim anı kopyası (`lines`), beklenen gün, durum, Geldi, fatura (`invoice_id`, bir fatura bir sipariş), karşılaştırma (`delivery_check`), kapanış |
| `integration_state` › `reorder.settings` | Sayım günleri, emniyet payı, varsayılan teslim süresi, mesajdaki ad |

`db:reset` üç tabloyu boşaltır (hammaddeler ve faturalarla birlikte), `reorder.settings`'e dokunmaz. Yedek üç tabloyu
da alır ([YEDEK.md](YEDEK.md)).

## Dosyalar

- `src/lib/reorder/` (`types.ts` ayarlar ve tipler, `usage.ts` günlük kullanım, `levels.ts` hedef / öneri / liste,
  `message.ts` mesaj ve WhatsApp bağlantısı, `delivery.ts` teslim kontrolü, durum, zil)
- `src/server/data/reorder.ts` (ekranların verisi, zil, Bugün'ün olguları), `src/server/actions/reorder.ts`
  (eylemler), `src/server/reorder/match.ts` (faturayla eşleştirme), `src/server/notify/reorder-push.ts`
- `src/app/panel/hizli-sayim/`, `src/app/panel/mal-siparisi/` (sipariş listesi, `gonderilen/`, `kalemler/`)
- Tablolar `drizzle/0034_mal_siparisi.sql`
- Test: `tests/mal-siparisi.test.ts`, `tests/teslim-kontrolu.test.ts`

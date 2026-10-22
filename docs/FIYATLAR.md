# Menü fiyatları: toplu değişiklik, kasaya işle, fiyat geçmişi

Ekran: **Ürünler › Fiyatlar** (`/panel/urunler/fiyatlar`), üç sekme: **Toplu değiştir**, **Kasaya işle**
(`?sekme=kasa`) ve **Geçmiş** (`?sekme=gecmis`). Ürün kartında (`/panel/urunler/[id]`) **Fiyat geçmişi** kartı. Yalnız
yönetici (personel fiyat görmez; sahibin kararı D1). Ürünler başlığındaki **Fiyatlar** düğmesi kasada bekleyen fiyat
varken "Kasa 12" der ve doğrudan o listeyi açar; ürün listesinin **Toplu fiyat** düğmesi (telefonda süzgeç penceresinde
"Görünenlere toplu fiyat") listenin süzgeçleriyle Toplu değiştir'i açar. ⌘K'da "Fiyatlar".

## Geliştirilmiş istek (prompt)

> Sahibin önerisi (11): menüye zam yaparken fiyatlar tek tek değişiyor; bir fiyatın **ne zaman** ve **kim** tarafından
> değiştiği bilinmiyor; kasadaki (ModPOS) fiyatı değiştirmeyi hatırlatan tek şey kaybolup giden bir bildirim.
>
> - **Toplu değiştir:** ürünleri seç (kategori, boy, arama, tek tek çıkar), kuralı seç (yüzde, tutar ya da "önerilen
>   fiyata çek") ve yuvarlamayı; önizlemede her ürünün yeni fiyatı, maliyet oranı, birim kârı, durumu ve ayda kâra
>   etkisi görünsün, istenen fiyat elle yazılabilsin. Uygulayınca laffogato.net'e bağlı ürünler önce sitede, var olan
>   kalem kalem yazımla değişsin; sonuç neyin değişip neyin değişmediğini nedeniyle söylesin.
> - **Kasaya işle:** panelde, toplu ya da sitede değişen her fiyat, kasada elle değiştirilene kadar bir listede
>   dursun; değiştirdikçe işaretlensin, liste WhatsApp'a kopyalanabilsin.
> - **Geçmiş:** her satış fiyatı değişikliği (önceki, yeni, kaynak, kim, ne zaman) silinmeden saklansın; toplu
>   değişiklik oradan geri alınabilsin.
> - **Kapsam dışı:** sitede toplu yazma ucu (kalem kalem kalır), kasanın fiyatını satış raporundan denetlemek (indirim
>   ciroyu bozar), bir değişiklikte kategoriye göre farklı kural (iki değişiklik yapılır), sitedeki fiyat listesinin
>   tarihi (hatırlatma olarak kalır), Excel aktarımında fiyat geçmişi.

## Toplu değiştir

### Ürünler

- Süzgeçler adreste, ürün listesiyle aynı adlarla: `?kategori=3,5` (birden çok kategori), `?boy=M|L|Tek`, `?ara=`,
  `?pasif=1`. Pasif ürünler varsayılan olarak dışarıda; "Pasifleri de dahil et" ekler (sahibin kararı D5). Arama ürün
  listesininkiyle aynı metinde (`productSearchText`: ad, boy, kategori, not, site işareti); listenin aramasının yalnız
  pasiflerle eşleşip pasifleri gösterdiği durumda **Toplu fiyat** `?pasif=1` de taşır: liste ne gösteriyorsa o açılır
  (durum süzgeci taşınmaz).
- Önizlemede her satır işaretlidir; işareti kaldırılan satır değişmez ("Tümünü seç / Hiçbirini" başlıkta).
- Yeni fiyata dokununca alan açılır (Enter ya da alandan çıkmak yazar, Esc vazgeçer): elle yazılan fiyat kuralın yerine
  geçer ("elle" rozeti, "kurala dön"), aynı denetimlerden geçer.

### Kural ve yuvarlama (`src/lib/prices/bulk.ts`)

Bir toplu değişiklikte tek kural vardır; kahveye %10, tatlıya 5 ₺ için iki değişiklik yapılır.

| Kural | Yeni fiyat |
|-------|------------|
| **Yüzde** ("10", "%10", "+10", "-5", "7,5") | Fiyat × (1 + yüzde), **önce kuruşa** yuvarlanır, sonra adıma. İndirim %100'ü geçemez |
| **Tutar (₺)** ("5", "-5") | Fiyata eklenir (kuruşla), sonra adıma |
| **Önerilen fiyat** | Fiyat önerilenin altındaysa önerilen fiyat (hedef maliyet oranı, 5 ₺'ye yukarı), değilse aynı. Hiçbir fiyat düşmez (D8); reçetesiz ürünün önerileni 0, değişmez |

Yuvarlama: **5 ₺'ye yukarı** (artışta varsayılan), **5 ₺'ye en yakın**, **5 ₺'ye aşağı** (indirimde varsayılan; seçim
elle değiştirilmediyse eksi yazınca kendiliğinden döner; D4), **10 ₺'ye yukarı**, **Tam liraya (en yakın)**,
**Yuvarlama yok**. Bütün hesap tamsayı kuruşladır: 200 × 1,05 = 210,00000000000003 olur, önce kuruşa yuvarlanmasa
"5'e yukarı" 215 yazardı (test: 210).

### Önizleme

- Satır: şimdiki ve yeni fiyat, fark (₺ ve %), maliyet oranı önce → sonra (ürün listesinin renkleriyle), birim kâr önce
  → sonra, durum değişimi ("Dikkat → İyi"), aylık etki. Ekonomi `priceProduct`'ın formülleriyle hesaplanır
  (`economicsAt`; test bütün Excel ürünlerinde eşitliği sınar).
- Özet: **Değişecek** (kaçı sitede de), **Ortalama değişim**, **Maliyet oranı (ort.)** (reçeteli satırların basit
  ortalaması, ürün listesinin ORTALAMA satırıyla aynı kural), **Aylık brüt kâr**.
- **Aylık etki** = (yeni birim kâr − bugünkü) × ayda satılan adet. Adet zam etkisiyle aynı dayanaktan gelir
  (`salesBasis`, `src/lib/calc/price-loss.ts`): son satış ayının ürüne eşlenen ModPOS adedi + online kafe adedi,
  Ayarlar'daki ayda açık güne ölçekli. Dayanak cümlesi de aynı ("Eylül 2026 satışlarına göre (ayda 30 açık gün).
  Ürüne eşleşmeyen satışlar sayılmadı."). Satış verisi yoksa "–". Satış adedinin fiyatla değişmediği varsayılır.
- Yuvarlamayla aynı fiyatta kalan ürünler listelenmez; altta "Değişmeyen 5 ürün" açılır.
- **Engelli satırlar** (gösterilir, işaretlenemez; sunucu da yeniden reddeder):

| Neden | Metin |
|-------|-------|
| Yeni fiyat 0 ya da altı | Fiyat 0 ₺'ye ya da altına iner |
| Siteye bağlı ve sitenin tavanının (1.000.000 ₺) üstü | Sitenin üst sınırını aşıyor |
| L yuvası, kalem sitede tek boy | Site bağlantısı kopuk (sitede L fiyatı yok); önce bağlantıyı düzeltin |
| Bağlı kalem sitenin listesinde yok | Bağlı kalem sitede yok; bağlantı sonraki eşitlemede kalkar |
| Bağlı ama anahtar yok (`KARAOKE_SYNC_SECRET`) | Site bağlantısı kurulmamış; siteye bağlı ürünün fiyatı değiştirilemez |

  Maliyetin altına inmek engel değildir; satırda kırmızı **Zararına** rozeti çıkar.

### Uygula

"Fiyatları değiştir" → onay ("34 ürünün fiyatı değişsin mi?": kural, sitede değişecek sayı, kasada elle değişeceği,
düşen fiyat sayısı) → `applyBulkPrices` (en çok 200 ürün). Pencere sonuçtan önce kapanır. Sonuç kartı önizlemenin
yerine geçer: kaç fiyat değişti (kaçı sitede de), değişmeyenler nedeniyle ("Latte · L — Siteye ulaşılamadı; denenmedi.
Tekrar dene."), **Tekrar dene** (yalnız değişmeyenler, aynı toplu değişiklik kimliğiyle ve sayfanın tazelenen
fiyatlarıyla; geri alma ikisini birlikte kapsar), **Kasaya işle (N) →**, **Değişikliği geri al**, **Yeni toplu
değişiklik**. Sitede değişen varsa fiyat listesinin tarihi hatırlatılır (sitede Ayarlar → Vergi, elle).

## Site ile birlikte (`src/server/prices/batch.ts`)

Sitede toplu yazma ucu yok: bağlı her ürün tek fiyat yazımının yolundan (`pushSaleChange` → `applyPushed`,
`docs/SITE-MENU.md` › Panel → site yazımı) tek tek gider; sitenin döndürdüğü fiyat yazılır ve geçmişe girer.
Değişiklik bütünüyle atomik değildir (site dışarıda): yazılanlar kalır, yazılamayanlar nedeniyle döner.

1. **Bağlı olmayanlar** tek işlemde: önce menünün danışma kilidi (çekme ve bağlamayla aynı sıra, kilitlenme olmaz),
   her satır yalnız fiyatı hâlâ önizlemedeki fiyatsa ve hâlâ bağlı değilse yazılır (SQL'de iyimser denetim); arada
   değiştiyse "Fiyat bu sırada değişti; listeyi yenileyip tekrar dene".
2. **Bağlılar** site kalemine göre gruplanır: bir kalemin M ve L satırı **sırayla** gider (öteki boyu güncelleyen
   yanıt eski L fiyatını geri yazmasın); gruplar **dörder dörder**. Her satır yazımdan hemen önce yeniden okunur;
   fiyatı önizlemedekinden farklıysa siteye gitmeden durur.
3. **Devre kesici:** site kapalı görünürse (ağ, zaman aşımı, kurulmamış bağlantı, imza reddi 401, 5xx) sıradaki
   ürünler siteye hiç gönderilmez ("Siteye ulaşılamadı; denenmedi. Tekrar dene."); yoldakiler biter. 400 ve 404 gibi
   ürüne özgü hatalarda değişiklik sürer. Sıra, devre kesici ve süre saf `runSiteGroups`'ta (`src/lib/prices/bulk.ts`);
   testi sahte yazımla eşzamanlılığı, M/L sırasını, devre kesiciyi ve süreyi sınar.
4. **Süre:** 40 saniyeden sonra yeni ürün gönderilmez ("Süre doldu; denenmedi. Tekrar dene."); her yazım en çok 8
   saniye, sayfanın `maxDuration`'ı 60 (sunucu eylemleri sayfanınkini kullanır).

Her site yazımı sitenin pingini ve panelin bir çekmesini doğurur; site saati koruması eski listenin yeniyi ezmesini
önler, yazımdan sonraki çekme fark bulmaz (geçmişe ikinci satır düşmez).

## Kasaya işle (ModPOS)

Panelde ya da sitede değişen fiyat ModPOS'a kendiliğinden geçmez; kasada elle değiştirilir. Panel bunu ürün satırında
tutar (`src/lib/prices/pos.ts`, `posAfterPriceChange`):

- `products.pos_stale_price`: kasada hâlâ duran eski fiyat; boşsa kasa panelle aynı sayılır.
- `products.pos_stale_since`: kasanın geri kaldığı ilk an.

| Olay | Kasanın durumu |
|------|----------------|
| Var olan ürünün fiyatı değişti (fiyat hücresi, ürün kartı, zam önerisi, toplu, geri alma, sitenin çekmesi, bağlanan ürünün aldığı site fiyatı, aynı kalemin öteki boyu) | Kasa güncelse eski fiyat yazılır (o an); zaten geride ise eski fiyat ve ilk an korunur |
| Fiyat kasadaki fiyata geri döndü (ör. toplu değişiklik kasa değişmeden geri alındı) | Kendiliğinden boşalır |
| Kuruşu aynı fiyat | Hiçbir şey |
| Yeni ürün | Listeye girmez (kasaya zaten elle eklenir; D3) |
| İşaretlendi ("Kasada değiştirdim", satırdaki kutu, Hepsini işaretle) | Boşalır; bildirimdeki **Geri al** eski hâline getirir (bu arada listeye yeniden girmediyse ve fiyat hâlâ kasadakinden farklıysa). Yalnız fiyatı hâlâ listede (kartta) görülen fiyatsa: liste açıldıktan sonra fiyat yeniden değiştiyse kasaya eskimiş fiyat yazılmıştır, ürün işaretlenmez, bugünkü fiyatıyla listede kalır ("… işaretlenmedi: fiyatı bu sırada 280 ₺ oldu") |
| Ürün silindi | Satırla birlikte gider |

Yayından önce bütün fiyatların kasayla aynı olduğu varsayılır; eski işlem geçmişinden geriye dönük doldurma yok (D6).
Sitede değişen fiyat da listeye girer: kasa siteyle aynı olmalı (D7).

Liste kategori kategori (menü sırasıyla): "Latte · Medium  ~~195 ₺~~ → **205 ₺**", altında "Kasada: LATTE MEDİUM"
(satış raporunda eşleşmiş ModPOS adları; yoksa "Kasada adı bilinmiyor"), ne zamandır ve son değişikliğin kaynağı.
**Metni kopyala** panoya düz metin yazar (WhatsApp'a yapıştırılır):

```
Kasada (ModPOS) değişecek fiyatlar · 22 Ekim 2026
Espresso Bazlı
- LATTE MEDİUM: 195 → 205 ₺
Tatlılar
- Marlenka (Tek): 270 → 285 ₺
```

Tek fiyat değişikliğinden sonra bildirim kasayı söyler: bağlı olmayan üründe "Kasadaki (ModPOS) fiyatı da değiştir;
Fiyatlar › Kasaya işle listesine eklendi.", bağlı üründe sitenin hatırlatmasıyla birlikte; fiyat kasadakine döndüyse
kasa yazılmaz. **Zil** (yalnız yönetici, Uyarılar): "Kasada değişecek N fiyat", Kasaya işle'ye götürür; listeye yeni
fiyat girince yeniden okunmamış olur. Sabah e-postasına girmez (D2). Sayı ve en eski / en yeni an tek sorguyla
`posPendingSummary()`'den (Ürünler başlığı, sekme, zil; Bugün ekranı da bunu okuyacak).

## Geçmiş

Satış fiyatını yazan her yol, fiyatla **aynı işlemde** `recordPriceChange`'i çağırır (`src/server/prices/record.ts`):
geçmişe satır düşer, kasanın durumu güncellenir. Kuruşu aynı fiyat yazılmaz. `tests/fiyatlar.test.ts` ürün satırını
güncelleyen bütün dosyaları tarar: fiyat yazan ama geçmişe yazmayan yeni bir yol testi kırar.

| Kaynak | Ad | Nereden |
|--------|----|---------|
| `manual` | Elle | Ürün listesindeki fiyat hücresi, ürün kartının kaydı, zam önerisinin geri alması |
| `suggestion` | Zam önerisi | Hammadde zamları kartındaki "Fiyatı X yap" |
| `bulk` | Toplu | Toplu değiştir (ve Tekrar dene) |
| `undo` | Geri alındı | Toplu değişikliğin geri alması |
| `site` | laffogato.net | Sitenin çekmesi, bağlanan ürünün aldığı fiyat, bağlı yazımda aynı kalemin öteki boyu (`applyPlan`; yalnız fiyat değiştiyse ve satır gerçekten yazıldıysa: yalnız Satışta / Tükendi değişen satır geçmişe girmez) |
| `create` | Yeni ürün | Yeni ürün ve personelin yeni ürün önerisinin onayı (`insertProduct`; fiyat 0'dan büyükse, önceki fiyat boş) |

- **Geçmiş sekmesi:** son 500 değişiklik (sınıra denk gelen toplu değişikliğin bütün satırlarıyla), güne göre
  (Türkiye saati), sayfada 50 kayıt, ürün araması. Toplu değişiklik tek satırda katlanır ("Toplu: +%10 · 5 ₺'ye yukarı
  · Espresso Bazlı · 34 ürün", kim, kaçı sitede de); açılınca ürünleri.
- **Geri al:** toplu değişikliğin fiyatı hâlâ onun yazdığı fiyatta olan ürünleri, değişiklikten önceki fiyata döndürür
  (süre sınırı yok; D9). Sonradan değişen ürüne dokunulmaz ("Sonradan değişti (şimdi 210 ₺)"); geri alma da bir toplu
  değişikliktir (kaynak "Geri alındı", siteye aynı kalem kalem yolla) ve kendisi geri alınmaz. Kasa henüz
  değişmemişse geri alınan fiyat kasadakine döner ve listeden düşer; kasa değişmişse ürün yeniden listeye girer.
- **Ürün kartı:** son 20 değişiklik; kasada eski fiyat duruyorsa "Kasada (ModPOS) hâlâ 195 ₺, panelde 205 ₺ · 2
  gündür" ve **Kasada değiştirdim** (panelin fiyatı o arada değiştiyse işaretlenmez, uyarı yeni fiyatla kalır).

## Veri

| Yer | İçerik |
|-----|--------|
| `product_prices` | Ekleme yalnız: `product_id` (ürünle silinir), `price_before` (yeni üründe boş), `price`, `source`, `on_site` (panelin değişikliği sitede de yapıldı), `batch_id` (toplu değişiklik ve Tekrar dene'si; geri almanın kendi kimliği), `note` (kuralın özeti, en çok 200 karakter), `changed_by`, `changed_at` |
| `products.pos_stale_price`, `pos_stale_since` | Kasanın durumu (yukarıda); hesaplama modeli bu sütunları okumaz |

Ayrı bir toplu değişiklik tablosu yok: başlık satırlardan türer. Migration `fiyat_gecmisi` (numarası birleştirmede
verilir). `npm run db:reset` ürünlerle birlikte geçmişi de siler; tam yedek yeni tabloyu ve sütunları kendiliğinden
kapsar.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/prices/bulk.ts` | Kural, yuvarlama (tamsayı kuruş), ekonomi, engeller, önizleme, özet, kuralın metni, devre kesicinin hataları, siteye yazım sırası (`runSiteGroups`) (saf) |
| `src/lib/prices/pos.ts` | Kasanın durum geçişi, işaretlemenin fiyat denetimi (`splitPosDone`), bildirim metinleri, kategoriye göre gruplama, panoya kopyalanan metin (saf) |
| `src/lib/prices/history.ts` | Kaynakların adı, sitenin yazdığı değişikliğin kaydı, güne ve toplu değişikliğe göre gruplama, geri alma planı (saf) |
| `src/server/prices/record.ts` | `recordPriceChange`: geçmiş ve kasa durumu, çağıranın işleminde |
| `src/server/prices/write.ts` | `writeSalePrice`: tek ürünün fiyatı (bağlıysa önce site), toplu değişikliğin bağlı satırları için |
| `src/server/prices/batch.ts` | `applyPriceBatch`: yerel satırlar tek işlemde, bağlılar kaleme göre sırayla ve dörder, devre kesici, süre |
| `src/server/data/prices.ts` | `posPendingSummary`, kasa listesi, menünün ve ürünün fiyat geçmişi, toplu değişikliğin satırları |
| `src/server/actions/prices.ts` | `applyBulkPrices`, `undoPriceBatch`, `markPosDone`, `restorePosPending` (yönetici) |
| `src/app/panel/urunler/fiyatlar/` | Sayfa (`maxDuration = 60`), Toplu değiştir, Kasaya işle, Geçmiş, süzgeç yardımcıları |
| `src/app/panel/urunler/[id]/price-history-card.tsx` | Ürün kartındaki Fiyat geçmişi |
| `src/server/actions/products.ts`, `src/server/data/product-create.ts`, `src/server/site-menu/sync.ts` | Var olan yazım yolları geçmişe yazar (`updateProductPrice`, `saveRecipe`, `insertProduct`, `applyPlan`) |
| `tests/fiyatlar.test.ts` | Kural ve yuvarlama, ekonominin `priceProduct`'la eşitliği, engeller, önizleme, metinler, siteye yazım sırası (sahte yazımla), kasa ve işaretleme, geçmiş, geri alma, süzgeçler, kaynak kuralları |

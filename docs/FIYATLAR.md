# Menü fiyatları: toplu değişiklik, kasaya işle, fiyat geçmişi

Ekran: **Ürünler › Fiyatlar** (`/panel/urunler/fiyatlar`), üç sekme: **Toplu değiştir**, **Kasaya işle**
(`?sekme=kasa`) ve **Geçmiş** (`?sekme=gecmis`). Ürün kartında (`/panel/urunler/[id]`) **Fiyat geçmişi** kartı. Bu
ekranlar yönetici içindir; personel yalnız kasada değişecek satış fiyatlarını **Kasadaki fiyatlar**'da
(`/panel/kasa/fiyatlar`) görür ve işaretler (dalga 10, aşağıda). Ürünler başlığındaki **Fiyatlar** düğmesi kasada bekleyen fiyat
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
| İşaretlendi ("Kasada değiştirdim", satırdaki kutu, Hepsini işaretle; personelde Kasadaki fiyatlar'daki kutu) | Boşalır ve bir işaret kaydı (`pos_marks`) yazılır; bildirimdeki **Geri al** ya da Son işaretlenenler eski hâline getirir (geri alma kuralları aşağıda). Yalnız fiyatı hâlâ listede (kartta) görülen fiyatsa: liste açıldıktan sonra fiyat yeniden değiştiyse kasaya eskimiş fiyat yazılmıştır, ürün işaretlenmez, bugünkü fiyatıyla listede kalır ("… işaretlenmedi: fiyatı bu sırada 280 ₺ oldu") |
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
kasa yazılmaz. **Zil** (iki rolde): "Kasada değişecek N fiyat"; yöneticide Uyarılar'da, Kasaya işle'ye götürür,
personelde Kasa grubunda, Kasadaki fiyatlar'a. Kimlik iki rolde `kasa-fiyat-<en yeni geri kalış>`: bir fiyatın
işaretlenmesi zili yeniden okunmamış yapmaz, listeye yeni bir fiyat girmesi yapar. Sabah e-postasına girmez (D2). Sayı
ve en eski / en yeni an tek sorguyla `posPendingSummary()`'den (Ürünler başlığı, sekme, zil ve Bugün ekranının
"Kasadaki fiyatlar" satırı); personelinki `staffPosSummary()`'den (yalnız etkin ürünler).

### LafPOS'a geçiş gününden itibaren (denetim B11, E-39)

Kasa LafPOS olunca (Ayarlar › LafPOS › "LafPOS'a geçiş günü"; bugünün iş günü, 05:00 kuralı, o günden önce değilse)
siteye bağlı ürünün satış fiyatını LafPOS siteden kendisi alır: gün açıkken LafPOS sürüm sinyalinin (20 sn) `menu`
işaretiyle yaklaşık 20 sn içinde yeniden eşitler ve fiyatı imzalı panel listesinden alır (`withPanelPrices`); sinyal
yoksa yedek 15 dakikalık çekme (lafpos `server/jobs.ts`). Sitenin herkese açık menüsü `s-maxage=60`. Gece hiçbir şey
çekilmez; gece yapılan değişiklik gün açılınca geçer (LafPOS 03-ENTEGRASYON §2.1). Kural tek yerde (`src/lib/lafpos/kasa.ts` `tillScope`, `tillPriceManual`;
okuyucu `src/server/data/till-scope.ts` `tillProductFilter`, `tillSince`):

| | ModPOS günü (geçiş günü boş ya da bugün ondan önce) | LafPOS günü |
|---|---|---|
| Siteye bağlı ürünün fiyatı değişti (her yol: hücre, kart, toplu, geri alma, sitenin çekmesi) | Listeye girer (bugünkü gibi) | Kasanın (ModPOS) durumu yine yazılır ama hiçbir okuyucuda görünmez; fiyat geçmişine yazılır; bildirim "LafPOS yeni fiyatı siteden alır" (`posPending` false) |
| Siteye bağlı olmayan ürünün fiyatı panelde değişti | Listeye girer | Girer; tarihi en erken LafPOS'un başladığı an. Bildirim: "LafPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin; LafPOS'ta yerel ürünse orada elle değiştirin" (LafPOS siteden gelen ürünün fiyatını değiştirtmez) |
| Bekleyen eski (ModPOS) işaret: siteye bağlı ürünün, geçiş gününden sonra siteden ayrılan ürünün ya da fiyatı geçiş gününden beri panelde değişmeyen bağlı olmayan ürünün | Görünür | Hiçbir okuyucuda görünmez (Kasaya işle, Kasadaki fiyatlar, zil, Bugün, haftalık özetin kâr kaybı, ürün kartı, Ürünler'in "Kasa N"si); **silinmez**, geçiş günü kaldırılır ya da ileri alınırsa geri gelir |
| Görev kimde | Yönetici ve personel (Kasadaki fiyatlar, zil, Bugün) | Yalnız yönetici: LafPOS'ta ürün fiyatını yalnız menüyü yöneten (`menu.yonet`: patron, müdür) değiştirir, kasiyer değiştiremez. Personelin zilinde ve Bugün'ünde satır yok, Kasadaki fiyatlar "Fiyatları yönetici değiştirir" der, `markPosDone` personeli reddeder (kendi işaretini geri alması sürer) |
| "Kasada: …" adı | ModPOS listelerinde geçen ad | LafPOS'un gün sonlarında geçen ad |

LafPOS gününde listede görünme kuralı: ürün siteye bağlı değil **ve** geçmişinde geçiş gününün 05:00'inden sonra
yalnız panelde (`on_site` olmayan) bir fiyat değişikliği var. Kasanın durumu tektir (`products.pos_stale_*`, ModPOS
için tutulur); LafPOS'un yerel ürünü kurulurken fiyat panelden alındığı varsayılır. Bilinen sınır: geçiş gününden önce
ModPOS'ta kalmış bir işaretin üstüne LafPOS günü fiyat yeniden değişirse listede ModPOS'un eski fiyatı yazar (yapılacak
iş doğrudur: LafPOS'ta yeni fiyat); fiyat LafPOS günü ModPOS'taki eski fiyata geri dönerse işaret kalkar.

**Şube:** kasa, kasanın şubesinindir (seçili fiziksel şube; "Tümü"de ve istek dışında, ör. haftalık özette, Tuzla):
geçiş günü yalnız Marina'nın (LafPOS) kasasınındır, Tuzla seçiliyken ya da Tuzla'ya bağlı personelde liste ModPOS'a
göredir (`loadTillScope`; denetim 21 Kasım #5). İşaret (`pos_marks`, `products.pos_stale_*`) şubesizdir: siteye bağlı
olmayan, fiyatı geçiş gününden sonra değişen ürün bir şubede işaretlenince öbürünün listesinden de düşer (şube başına
işaret açık iş).

Geçiş günü değişince hiçbir kayıt yazılmaz ya da silinmez; yalnız okuyucular değişir. Fiyat yazımı da geçiş gününe göre
farklı bir şey saklamaz (yalnız bildirimin metni değişir). Metinlerin hepsi geçiş günü boşken bugünkünün aynısıdır
(`tests/lafpos-metin.test.ts`, veritabanında `tests/lafpos-metin-db.test.ts`).

### Personel: Kasadaki fiyatlar ve işaret kaydı (dalga 10 §2.2)

Fiyatı ModPOS'ta zaten personel değiştirir; onay ModPOS'u denetleyemez, yalnız listeyi bekletirdi. Bu yüzden personel
onaysız işaretler, her işaret kişinin adıyla kayıtlıdır ve geri alınabilir. Tek tek işaretleme bir sürtünmedir,
denetim değildir: denetim satır satır kayıt (`pos_marks`, İşlem geçmişi) ve yöneticinin Bugün'deki Tamamlananlar
satırıdır. Kalan risk: personel ModPOS'ta değiştirmeden işaretleyebilir; bu görünür ve geri alınır (panelden ModPOS
görünmez, onay da bunu yakalayamazdı).

- **Ekran** (`/panel/kasa/fiyatlar`; yönetici açarsa Kasaya işle'ye gider): kategori kategori "Latte · Medium
  ~~195 ₺~~ → 205 ₺", altında "Kasada: LATTE MEDİUM · 2 gündür" (ya da "Kasada adı bilinmiyor"). Kaynak, değiştiren
  kişi ve not yazılmaz; yalnız etkin ürünler. Dokununca satır gizlenir, bildirim 10 sn "Latte Medium kasada 205 ₺
  olarak işaretlendi" ve **Geri al**. Son 30 dakikanın işaretleri listenin **üstünde** ("Son işaretledikleriniz",
  Geri al). "Metni kopyala" var, "Hepsini işaretle" yok (bir seferde bir ürün, `posMarkMax`). Boşken "Kasa güncel".
- **Girişler:** Bugün'de personel satırı "Kasadaki fiyatlar" (zayiden önce, "Listeyi aç"), zil.
- **Yükleyici** `src/server/data/pos-staff.ts`: sabit sütun beyaz listesi (ürünün kimliği, adı, boyu, satış fiyatı,
  kasadaki eski fiyat ve anı, sırası, etkinliği; kategorinin adı ve sırası; ModPOS adı; kişinin kendi işaretleri).
  Fiyat geçmişi, kaynak, not, site alanları, reçete ve maliyet okunmaz (`tests/fiyatlar.test.ts` sabitler).
- **İşaret kaydı** `pos_marks`: ürün, kasaya yazılan fiyat, işaretten önce kasada duran fiyat ve anı, işaretleyen
  (hesap ve o anki adı), an; geri alınınca an ve geri alanın adı. Yöneticinin işaretleri de yazılır.
- **Geri alma** (`posUndoRefusal`; istemciden fiyat alınmaz, saklanan eski fiyat ve an ürüne geri yazılır):
  - personel yalnız kendi işaretini, 30 dakika içinde (`POS_UNDO_WINDOW_MS`); sonrası yöneticiye;
  - zaten geri alınmış, ürün silinmiş, ürün listeye yeniden girmiş (yeni fiyat işaretlenir) ya da fiyat kasadakine
    dönmüşse alınmaz;
  - yalnız ürünün **son** işareti ve güncel fiyat işaretin fiyatıyken: "Bu ürün sonra yeniden işaretlendi; son işareti
    geri alın" (M1 → fiyat değişti → M2 → M1'i geri almak kasaya yazılmış M2'yi kaybettirirdi).
- **Çekirdek** `src/server/prices/pos-marks.ts` (`markPos`, `undoPos`; veritabanını parametre alır): ürünler kimlik
  sırasıyla FOR UPDATE; geri almada önce işaretler, sonra ürünler, ürünün son işareti aynı kilit altında okunur.
  Personelde ürün etkin olmalı; eşzamanlı iki işaretten biri "zaten işaretlenmiş" olur (yalnız kimlik döner).
- **Yönetici:** Kasaya işle'nin altında **Son işaretlenenler** kartı (`#son-isaretlenenler`, son 14 gün; kişi ve gün
  başına "Ayşe · dün · 34 fiyat", açılır; telefonda kapalı gelir). Satır "Latte · Medium 195 → 205 ₺", altında kişi
  (İşlem geçmişindeki gibi: o anki ad, gerekirse e-postası), saat ve **Geri al**; geri alınamıyorsa nedeni, geri
  alınmışsa soluk "Geri alındı · Ali". Bugün'de bekleyen fiyat varken satırın sonuna "Ayşe dün 3 fiyatı kasada
  işaretledi." (son 48 saatin personel işaretleri); bekleyen yoksa satır Tamamlananlar'a düşer ve bu karta götürür.
  Onaylar'a kart eklenmez.
- **İşlem geçmişi:** "Kasaya işlendi" · Ayşe · "Latte M 205 ₺"; "Kasaya işlendi geri alındı" · Ali · "Latte M 205 ₺
  (Ayşe'nin işareti)".

## Geçmiş

Satış fiyatını yazan her yol, fiyatla **aynı işlemde** `recordPriceChange`'i çağırır (`src/server/prices/record.ts`):
geçmişe satır düşer, kasanın durumu güncellenir. Kuruşu aynı fiyat yazılmaz. `tests/fiyatlar.test.ts` ürün satırını
güncelleyen bütün dosyaları tarar: fiyat yazan ama geçmişe yazmayan yeni bir yol testi kırar.

| Kaynak | Ad | Nereden |
|--------|----|---------|
| `manual` | Elle | Ürün listesindeki fiyat hücresi, ürün kartının kaydı (yalnız fiyata dokunulduysa), zam önerisinin geri alması |
| `suggestion` | Zam önerisi | Hammadde zamları kartındaki "Fiyatı X yap" |
| `bulk` | Toplu | Toplu değiştir (ve Tekrar dene) |
| `undo` | Geri alındı | Toplu değişikliğin geri alması |
| `site` | laffogato.net | Sitenin çekmesi, bağlanan ürünün aldığı fiyat, bağlı yazımda aynı kalemin öteki boyu (`applyPlan`; yalnız fiyat değiştiyse ve satır gerçekten yazıldıysa: yalnız Satışta / Tükendi değişen satır geçmişe girmez) |
| `create` | Yeni ürün | Yeni ürün ve personelin yeni ürün önerisinin onayı (`insertProduct`; fiyat 0'dan büyükse, önceki fiyat boş) |

Açık kalmış ürün kartı, fiyat hücresi ve zam önerisi gördükleri fiyatı da gönderir (denetim E-11,
[SENKRON.md](SENKRON.md) › Çakışma): kartta dokunulmayan fiyat bu arada sitede, eşitlemede ya da burada toplu
değiştiyse kartın kaydı onu geri almaz, geçmişe ve Kasaya işle'ye kayıt düşürmez; dokunulan fiyat ya da hücrenin
yazdığı fiyat bu arada başka yerde de değiştiyse hiçbir şey yazılmaz. Kart "Fiyat bu arada başka bir yerde değişti:
şimdi 210 ₺ (kart açıldığında 200 ₺); değişiklikler kaydedilmedi. …" der ve fiyat alanının altında "… kalsın" / "…
yazılsın" seçimini gösterir; fiyat hücresi ve zam önerisi "Fiyat bu arada başka bir yerde 210 ₺ oldu; yazılmadı. Liste
güncellendi, istersen yeniden değiştir." der (hücre güncel fiyatı alır).
Kartın kaydı yalnız Satışta / Tükendi'yi siteye yazdığında sitenin yanıtı başka bir fiyat taşıyorsa (ping kaçmıştı) o
fiyat `site` kaynağıyla girer.

- **Geçmiş sekmesi:** son 500 değişiklik (sınıra denk gelen toplu değişikliğin bütün satırlarıyla), güne göre
  (Türkiye saati), sayfada 50 kayıt, ürün araması. Toplu değişiklik tek satırda katlanır ("Toplu: +%10 · 5 ₺'ye yukarı
  · Espresso Bazlı · 34 ürün", kim, kaçı sitede de); açılınca ürünleri.
- **Geri al:** toplu değişikliğin fiyatı hâlâ onun yazdığı fiyatta olan ürünleri, değişiklikten önceki fiyata döndürür
  (süre sınırı yok; D9). Sonradan değişen ürüne dokunulmaz ("Sonradan değişti (şimdi 210 ₺)"); geri alma da bir toplu
  değişikliktir (kaynak "Geri alındı", siteye aynı kalem kalem yolla) ve kendisi geri alınmaz. Kasa henüz
  değişmemişse geri alınan fiyat kasadakine döner ve listeden düşer; kasa değişmişse ürün yeniden listeye girer.
- **Ürün kartı:** son 20 değişiklik; kasada eski fiyat duruyorsa "Kasada (ModPOS) hâlâ 195 ₺, panelde 205 ₺ · 2
  gündür" ve **Kasada değiştirdim** (panelin fiyatı o arada değiştiyse işaretlenmez, uyarı yeni fiyatla kalır).

## Şube fiyatı (24 Kasım 2026)

Sahibin kararı (4 Kasım 2026, [SUBE.md](SUBE.md); yapımı 23 Kasım 2026'da onaylandı, hesap sözleşmesi §8 "ladmin
(LM-5)"): satış fiyatı şubeye göre değişebilir. Fiyat sitede tutulur (laffogato.net'in docs/PANEL-MENU.md "Şube
fiyatı"); panel yazar ve okur, LafPOS siteden alır.

- **Taban** sitenin kalemindeki fiyattır: Tuzla'nın (ana şube) ve kendi fiyatı olmayan her şubenin. Toplu değiştir'in
  "Tümü" seçimi ve ürün kartı bugünkü gibi tabanı (ve `products.price`'ı) yazar.
- **Şubenin fiyatı** sitede eklenen, silinmeyen bir satırdır: "25 Kas 05:00'ten Marina'da latte 205 / 225 ₺". Satır
  sonraki satırın anına dek geçerlidir; "Taban fiyata dön" satırı (`priceMinor: null`) şubeyi yeniden tabana bağlar.
  Anı gelmemiş satır **İptal** ile geri alınır; yürürlükteki satır geri alınmaz, yerine yeni satır yazılır. Panel
  ürünün fiyatına (`products.price`) ve satış fiyatı geçmişine dokunmaz: şube fiyatının geçmişi sitenin satırlarıdır.
- **Geçerlilik** varsayılanı sonraki iş günü 05:00 (İstanbul; gece 05:00'ten önce iş günü dündür, aynı sabahın
  05:00'i). En çok 5 dakika geçmişte (iki sunucunun saat farkı), en çok 90 gün ileride (sitenin kuralı).
- **Yalnız site duyurunca.** Site menü okumasında `writes.branchPrice` duyurmadıysa (eski site) Şube seçimi ve yazım
  yok, sekmeler yalnız okunur; eylem de yeniden denetler.
- **Seçenekler** (şurup, ekstra shot, alternatif süt) şubeye göre fiyatlanmaz; Tuzla şube fiyatı almaz.
- Bir kalemin M ve L'si tek istekte gider. Değişmeyen boy şubenin o anki kendi değerini taşır (kendi L'si yoksa taban
  L); kendi satırı yokken yalnız L değişirse M o anki fiyatında sabitlenir (satırın M'si boş olamaz).
- **Çakışma:** site aynı kalem, şube ve anda başka fiyatlı satır görürse 409 `stale` ve kalemin satırlarıyla döner;
  panel kopyasını onlarla yeniler, kullanıcı "aynı anda başka bir fiyatı var" görür. Aynı yazımın yeniden gönderimi
  (zaman aşımından sonra Tekrar dene) güvenlidir: site ikinci satır yazmaz.

### Ekranlar

- **Toplu değiştir › Şube** (Değişiklik kartının üstünde): "Tümü (taban fiyat)" ya da bir şube. Şube seçilince
  **Geçerlilik** alanı çıkar, önizlemenin bugünkü fiyatı şubenin o andaki fiyatıdır, yalnız siteye bağlı ürünler
  değişir (bağlı olmayan ve seçenek "engelli"). Uygulama kalem kalem siteye (devre kesici ve 40 sn sınırı tabanla
  aynı, `runSiteGroups`); sonuçta geri alma yok, "Şube fiyatı'nda gör (iptal)".
- **Şube fiyatı** (`?sekme=sube`, iki şube olunca `&sube=`): kalemler (seçenekler hariç), taban, şubede şu an geçerli
  fiyat ve anı, planlanan değişiklikler (İptal). **Değiştir**: M, L (kalem iki boyluysa), Geçerlilik, "Taban fiyata
  dön". Alanlar şubenin Geçerlilik anındaki fiyatını gösterir (arada planlı satır olabilir); yalnız kullanıcının yazdığı
  boy gönderilir, dokunulmayan boy yukarıdaki kuralla kalır (taban L'yi izleyen L sabitlenmez, planlı L ezilmez).
- **Eski fiyattan satılanlar** (`?sekme=eski`): şubenin fiyat değişiklikleri, boy boy (yalnız değişen boy), durumuyla;
  altında son 90 günde o gün geçerli fiyattan farklı liste fiyatıyla satılanlar (gün, kalem, satılan, olması gereken,
  adet, fark).

### Durum ve eski fiyat (`src/lib/prices/branch.ts`)

Kaynak yalnız LafPOS gün sonunun `lines[].listPrices`'ıdır (satılan parçaların dondurulan liste fiyatları;
[LAFPOS.md](LAFPOS.md) › Faz 2 alanları). `revenue / qty` liste fiyatı değildir (indirim, mutlu saat, ek), ondan
hiçbir şey çıkarılmaz. İş günü [D 05:00, D+1 05:00) İstanbul.

| Durum | Ne zaman |
|---|---|
| **Bekliyor** | Anı gelmedi ya da o andan sonra bu boy satılmadı |
| **Uygulandı · gün** | O andan (anı içeren gün dahil) sonra yeni fiyatla satılan ilk gün |
| **Uygulanmadı** | Yeni fiyatla satış yok; anından sonra başlayan tam bir günde yalnız başka fiyat (anı içeren günün eski fiyatı sayılmaz: andan önce satılmış olabilir) |
| **Bilinmiyor** | Yalnız liste fiyatı taşımayan gün sonu (eski LafPOS) |

Değişikliğin penceresi o boyun fiyatını değiştiren sonraki anda biter (şube satırı ya da izlenen tabanın
değişikliği); yalnız öteki boyu değiştiren satır kesmez. **Eski fiyattan satılan**: günün başında geçerli
fiyattan farklı liste fiyatı; gün içinde fiyat değiştiyse (şube satırı ya da tabanın değişikliği) iki fiyat da
doğrudur. Tabanın geçmişi siteye bağlı ürünün `product_prices`'ından (siteden gelen değişiklik panelin çektiği anla
kayıtlıdır, birkaç dakika geç düşebilir). Kasada gün 05:00'ten sonra kapanırsa o gecenin satırları ertesi günün
fiyatına göre denetlenir (yaklaşık; LafPOS iş gününü kendi açılış / kapanışıyla sayar).

Ekonomi (önerilen fiyat, zam etkisi, maliyet oranı) tabanla hesaplanır; şube fiyatı Satışlar'a LafPOS'un gerçek
cirosuyla zaten girer. Marina'nın basılı fiyat listesinin tarihi sitede tek (Tuzla'nın); kapsam dışı.

## Veri

| Yer | İçerik |
|-----|--------|
| `product_prices` | Ekleme yalnız: `product_id` (ürünle silinir), `price_before` (yeni üründe boş), `price`, `source`, `on_site` (panelin değişikliği sitede de yapıldı), `batch_id` (toplu değişiklik ve Tekrar dene'si; geri almanın kendi kimliği), `note` (kuralın özeti, en çok 200 karakter), `changed_by`, `changed_at` |
| `products.pos_stale_price`, `pos_stale_since` | Kasanın durumu (yukarıda); hesaplama modeli bu sütunları okumaz |
| `integration_state.menu_site_branch_prices` | Sitenin şube fiyatı satırları (`now`, `at`, `rows`), menü çekmesinde ve şube fiyatı yazımının yanıtıyla ([SITE-MENU.md](SITE-MENU.md)) |
| `pos_daily_sales.list_prices` | LafPOS gün sonu satırının liste fiyatları (`[{price, qty}]`, eski LafPOS'ta null); migration `0077_sube_fiyati` |

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
| `src/server/data/prices.ts` | `posPendingSummary`, kasa listesi, Son işaretlenenler (`loadRecentPosMarks`), Bugün'ün personel işaretleri (`staffPosMarksRecent`), menünün ve ürünün fiyat geçmişi, toplu değişikliğin satırları |
| `src/server/data/pos-staff.ts` | Personelin Kasadaki fiyatlar okumaları (sabit sütunlar, yalnız etkin ürünler) |
| `src/server/prices/pos-marks.ts` | `markPos`, `undoPos`: işaret kaydı ve geri alma (kilit sırası, son işaret kuralı) |
| `src/server/actions/prices.ts` | `applyBulkPrices`, `undoPriceBatch`, şube fiyatı: `setBranchPrice`, `cancelBranchPriceRow`, `applyBranchPrices` (yönetici) |
| `src/lib/prices/branch.ts` | Şube fiyatı: şubedeki fiyat (sitenin kuralı), Geçerlilik, yazımın gövdesi, toplu önizleme, durum ve eski fiyattan satılanlar (saf) |
| `src/server/prices/branch-write.ts` | Şube fiyatı yazımı, iptali ve toplu hâli (siteye, kopyayı yanıtla yeniler) |
| `src/server/data/branch-prices.ts` | Şube fiyatı ve Eski fiyattan satılanlar sekmelerinin verisi, Toplu değiştir'in Şube seçimi |
| `src/server/actions/pos-marks.ts` | `markPosDone`, `undoPosMarks` (iki rol, `requireUser`) |
| `src/components/panel/pos-checklist.tsx` | Kasaya işle listesi, iki yüz (yönetici; personel `staff`) |
| `src/app/panel/kasa/fiyatlar/` | Personelin Kasadaki fiyatlar sayfası |
| `src/app/panel/urunler/fiyatlar/` | Sayfa (`maxDuration = 60`), Toplu değiştir, Kasaya işle ve Son işaretlenenler, Geçmiş, süzgeç yardımcıları |
| `src/app/panel/urunler/[id]/price-history-card.tsx` | Ürün kartındaki Fiyat geçmişi |
| `src/server/actions/products.ts`, `src/server/data/product-create.ts`, `src/server/site-menu/sync.ts` | Var olan yazım yolları geçmişe yazar (`updateProductPrice`, `saveRecipe`, `insertProduct`, `applyPlan`) |
| `tests/sube-fiyat.test.ts`, `tests/sube-fiyat-db.test.ts` | Şube fiyatı: okuma ve duyuru, listPrices, Geçerlilik, gövde, engeller, durum, eski fiyat; sahte siteyle yazım, 409, yeniden gönderim, iptal, toplu, rapor |
| `tests/fiyatlar.test.ts` | Kural ve yuvarlama, ekonominin `priceProduct`'la eşitliği, engeller, önizleme, metinler, siteye yazım sırası (sahte yazımla), kasa ve işaretleme, geçmiş, geri alma, süzgeçler, kaynak kuralları |

# Plan: Cari hesapta elle borç ve ödeme ("cari")

Grup anahtarı: **cari** (Dalga 11). Taban: `main` @ 48a984c. Yığın: Next.js 16 (App Router; yazımdan sonra `refresh()` from `next/cache`), Drizzle + Postgres, Vercel. Arayüz Türkçe. Roller: yönetici ve personel.

Kod yazmadan önce `AGENTS.md` ve `node_modules/next/dist/docs/` okunur. Migration birleştirme anında üretilir: `npm run db:generate -- --name cari_hareket`. Bugün sıradaki numarayla dosya `drizzle/0036_cari_hareket.sql` olur. Başka bir dalga önce birleşirse numara kayar, ad aynı kalır.

Bu plan üç tasarımdan çıktı: ledger, minimal ve cashflow. İki hakem puanladı, bir itiraz saldırdı. İki hakemin toplam puanında **cashflow** kazandı: cashflow 39,0, ledger 36,5, minimal 36,5. Plan cashflow'un üzerine iki hakemin aşılarını ve itirazın geçerli maddelerini koyar (§2.2). Reddedilen maddeler de gerekçesiyle §2.2'de.

---

## 1. Amaç

Sahibin isteği (aynen):

> "Lafmaliyet sistemine ek olarak cari hesaplarda biz de borç ödeme girebilelim; belki elden almışızdır, fatura yok da olabilir çünkü?"

**Bugün nasıl:**

- Tedarikçi bakiyesi bir hesap defteri değildir. Yalnız `invoices` satırlarından, adla ya da vergi noyla gruplanarak hesaplanır.
- Ödeme her faturada evet/hayır işaretidir.
- Tedarikçinin hesabına faturadan başka bir şey girilemez:
  - faturasız alım girilemez;
  - hesaba ödeme, kısmi ödeme ve toptan ödeme girilemez;
  - eski borç girilemez.
- Kısmi ödeme yalnız Paraşüt'ten gelir ve salt okunurdur (`outstanding`).

**Bu planla tedarikçi sayfasında iki yeni düğme var:**

- **Borç ekle:** elden, veresiye ya da faturasız alınan mal veya hizmet; panelden önceki eski borç.
- **Ödeme ekle:** tek bir faturaya bağlı olmayan ödeme. Hesaba, kısmi, toptan, şoföre elden ya da kasadan olabilir. Ödeme en eski borçtan başlayarak, seçilen kalemlere ya da hiçbirine sayılır ("hesapta beklesin").

**Değişmeyen kurallar:**

- Ödeme hiçbir zaman gider ya da KDV olmaz.
- Her alımın gideri tek bir yerde durur: ya faturada ya da tek bir Aylık harcamalar kaydında.
- Aşağıdaki ekranların hepsi aynı kalan kuralını ve aynı mahsubu kullanır: Kalan borç, Ödemeler, Son ödenenler, Nakit planı, zil, sabah e-postası, Bugün, Genel bakış, Claude (MCP) ve Excel.
- Paraşüt salt okunur kalır.
- Hiç elle kayıt girilmemişse bütün rakamlar bugünküyle birebir aynıdır (§9 sabit testleri).
- Personel yeni bir ekran görmez. Tek fark Kasa'da iki etiket, bir ipucu ve bağlı satırın kilidi (§8).

**v1'de olmayanlar:**

- Tedarikçiden nakit iade ve faturasız iade (alacak dekontu). Şimdilik bugünkü gibi Faturalar'da eksi fatura girilir.
- Panelden önceki alacak ("açılış alacağı").
- Mal siparişinden "Cariye borç yaz".
- Personelin "Tedarikçiye ödeme" türü ve onay akışı (§8).
- Faturasız alımdan miktar ya da hammadde fiyatı okumak.
- Paraşüt'e ödeme yazmak.
- Tedarikçinin kendi ekstresiyle otomatik mutabakat. Yerine "Ekstreyi kopyala" var.

---

## 2. Kararlar

### 2.1 Karar tablosu

| # | Karar | Neden |
|---|---|---|
| K1 | Elle kayıtlar ayrı tabloda durur: `supplier_entries`. Bu tabloda iki tür kayıt var: borç ve ödeme. Hangi ödemenin hangi faturaya ya da borca sayıldığı ayrı bir tabloda durur: `supplier_allocations`. `invoices`'a elle kayıt yazılmaz. | minimal'in `invoices` içindeki türler üç gerçek açık bırakıyordu (hakem notları): (1) Paraşüt iptali kısmi ödeme parçalarını siler (`sync.ts:285`, `~1246`). (2) `findExisting` kural 3 faturasız satırı bağlar ama `kind`'ı yazmaz, KDV düşer. (3) `s.invoices` okuyan 33 yer `notCari` öğrenmek zorunda kalır. Ayrı tablo bunların hiçbirini doğurmaz. Paraşüt eşleştirmesi, Mal siparişi eşleşmesi (`invoice-linking.ts`), nakit planındaki mal tahmini (`goodsRows`) ve KDV (`kdv.ts`) elle kayıtları hiç görmez. |
| K2 | Kayıt tedarikçi kartına yabancı anahtarla bağlanır: `supplier_id`, ON DELETE RESTRICT. Kartsız tedarikçiye ilk kayıtta yalnız görünen adıyla bir kart açılır. Bu, `removeSupplier`'ın bugünkü kuralıdır: `nameMoves` engeli ve mesajı aynen geçerli. | cashflow tedarikçiyi ad metniyle tutuyordu. O durumda kart silinince ya da ad değişince kayıtlar gruplar arasında dağılır (itiraz 5A) ve kilit anahtarı kayar (5D). Kart kimliği değişmez. |
| K3 | Kalan kuralı tek bir saf modülde durur: `src/lib/cari/balance.ts`. `insights.ts` oradan yeniden dışa aktarır. `reminders.ts:195`'teki kopya kalkar ve `invoiceItem` bu modülü çağırır. | Bugün kuralın iki kopyası var: `insights.ts:771` ve `reminders.ts:195`. (`logic.ts:426` zaten `openBalance` çağırıyor; cashflow'un "üç kopya" demesi yanlıştı.) Yeni tür eklenince kopyalar ayrışır. |
| K4 | **Panel takibi fatura başına tutulur:** `invoices.ledger_base` (sayı ya da boş). **Boş:** bugünkü kural geçerli, Paraşüt'ün `outstanding`'i (Paraşüt'teki kalan) okunur. **Dolu:** kalan = Ödenecek − `ledger_base` − panelde sayılan; Paraşüt'ün kalanı yalnız ipucu olur. **Takip ne zaman başlar:** kart ilk ödeme kaydını alınca. O anda grubun her faturasına, Paraşüt'ün o ana kadar ödendi gösterdiği kısım yazılır. Takipli karta sonradan gelen fatura 0 ile açılır. | ledger'in "max" kuralı ve owner hakeminin aşı 5'i iki durumda borcu eksik gösterir. **2A:** muhasebeci bizim hesaba yaptığımız ödemeyi yeni faturaya işler. **2B:** muhasebeci aynı ödemeyi faturalara bizden farklı dağıtır. Bu itirazın R2a'sıdır. Takip başladıktan sonra tek kaynak panel olur; fark çıkarsa satırda ipucu görünür. |
| K5 | **Dağıtılmamış ödemenin mahsubu** ("hesapta duran" para): okuma anında yapılır, veritabanına hiçbir şey yazılmaz. Hepsi aynı saf `netCredit` fonksiyonunu kullanır: Ödemeler, Bugün, zil, e-posta, Nakit planı, Genel bakış ve tedarikçi kartları. Sıra en eski vadeden başlar. **Kalıcı dağıtım yalnız şu durumlarda yazılır:** kullanıcının bir eylemi (ödeme kaydı, "Borçlara say", ✓) ya da peşin çalışılan karta yeni fatura geldiğinde bir kez (K21). | Owner hakeminin aşı 1'i: avans kendiliğinden düşsün. İtirazın R7b'si: plan çıkmış parayı yeniden göstermesin. Böylece "eşitleme ödeme durumunu yazmaz" kuralı (TEDARIKCILER.md) düzenli işlerde korunur ve "geri aldım, eşitleme yeniden uyguladı" sorunu (4C) hiç doğmaz. |
| K6 | **Fatura "ödendi"ye geçerken önce hesaptaki para kullanılır**, kalan kısım işaretlenir. Kapsadığı yollar: ✓, toplu "Ödendi yap (N)", Ödemeler'deki **Ödendi**, ödeme penceresi, `saveInvoice` ve peşin kuralı. Tek faturanın ödeme penceresinde "Ayrıca ödendi" seçeneği vardır. | İtiraz R2b, örnekler 2C ve 2D: yoksa avans "Fazla ödeme" olarak kalır ve "Bu ay ödenen" aynı parayı iki kez sayar. Owner hakeminin ✓'deki sorusu toplu yollarda sorulamaz. Bu yüzden ne yapıldığı bildirimde söylenir ve "Geri al" sunulur. |
| K7 | **Ödendi işareti ile dağıtım birlikte yaşar:** yeni sütun `paid_by_ledger`. **Kapanış:** dağıtım faturayı tamamen karşılayınca fatura defterle kapanır. **Yeniden açılış:** karşılık düşerse yalnız defterin kapattığı fatura yeniden açılır; elle konan ✓'ye defter dokunmaz. **"Ödenmedi" engeli:** tamamen karşılanmış faturada "Ödenmedi" tek bir denetimle (`assertNotCovered`) reddedilir. Bu denetim dört yazıcının hepsinde var: `applyPayment`, `saveInvoice`, `restoreInvoicePayment` ve `undoRecentPaid`. | Kaynaklar: cashflow'un `resettle`'ı, itiraz R4a (dört yazıcı da işareti denetimsiz açıyordu) ve hakem 2'nin aşı 7'si (ödeme silinince yalnız değişmemiş işaret geri döner). |
| K8 | **Borcun gideri tek bir seçimle belirlenir.** Seçenekler: **Faturası gelecek**, **Faturası yok · gider yaz**, **Gideri zaten girildi** (var olan kaydı seç) ve **Eski borç (devir)**. **Varsayılan:** tedarikçinin son 90 günde Paraşüt'ten gelmiş faturası varsa "Faturası gelecek", yoksa "Faturası yok · gider yaz". | Owner hakemi varsayılansız zorunlu seçime karşıydı (aşı 2). İtiraz iki şeyi gösterdi: R3a, varsayılan "gider yaz"ın sonradan fatura kesen tedarikçide gideri çift saydığını; R3b, "zaten girildi"nin sahipsiz kalıp bağlanınca çift saydığını. |
| K9 | **"Faturası yok" borcun gideri** tek bir Aylık harcamalar kaydıdır. Kaydın sahibi borçtur: `expense_entries.supplier_entry_id`. Tutar KDV dahil, gün alım günü, KDV yok. **Kategori:** var olan "Nakit malzeme alımı" (mal/diğer) ya da tedarikçinin son borcunun kategorisi. Yeni kategori açılmaz. | Motor değişmez: `engine.ts` 1425–1430 mal bölümündeki harcamayı stok devrinden önce alışa ekler. `kdv.ts` harcama okumaz. Owner aşı 10: sahip iki benzer kategori görmesin. |
| K10 | **"Faturası geldi"** birden çok borcu tek faturaya bağlar (n → 1). Aynı işlemde: (1) borçlara sayılmış ödemeler faturaya geçer ve nereden geldikleri `origin_debt_id`'de saklanır; (2) borcun sahip olduğu gider kaydı silinir; (3) borcun önceki hâli `link_prev`'de saklanır. Bağ kaldırılınca ya da fatura silinince önceki hâl geri gelir. | Hakem 1 aşı 1-2: haftalık irsaliye, aylık fatura. İtiraz R4d: bağ kaldırılınca yalnız borçtan gelen ödemeler geri taşınır. |
| K11 | **Fatura silinmeden önce bağları çözülür** (`releaseInvoiceLinks`). Silme yolları: elle silme, Paraşüt iptali `sync.ts:285` ve e-fatura yolu `~1246`. Çözme adımları: (1) bağlı borçlar eski hâline döner; (2) borçtan gelen dağıtımlar borca geri taşınır; (3) kalan dağıtımlar CASCADE ile silinir ve para ödemenin hesaptaki kısmına geçer. Sonra fatura silinir. | İtiraz 5C'nin amacı. Mekanizması (silmek yerine ayırmak) reddedildi; gerekçe §2.2'de. |
| K12 | **Saklanan tek toplam `invoices.allocated`:** faturaya sayılan ödemelerin toplamı. Bu sütunu yalnız `src/server/cari/settle.ts` yazar ve her yazışta SUM ile yeniden hesaplar. Kaydın kendi dağıtım toplamı saklanmaz; okurken toplanır. | Faturayı okuyan her yer (`select().from(s.invoices)` dahil) sütunu kendiliğinden alır. Yazıcı tek yerde olduğu için bir test onu bekler. Kayıt tarafında saklanan toplam, CASCADE silmede bayat kalırdı (hakem 1 düzeltme 2, itiraz 5C). |
| K13 | **Kasadan yapılan ödeme her zaman bir Kasa satırıdır.** Satır türü `teslim`, Kime: tedarikçi. Yeni Kasa türü açılmaz. Pencere aynı günün eşleşen işlenmemiş satırını önceden seçer. Yeni satır yalnız "Bu ayrı bir ödeme" ile açılır. **Ödeme şekilleri:** Kasadan, Elden (kasa dışı), Havale / EFT, Kart, Çek / senet, Diğer. Kartta "Nakit" yazılıysa varsayılan "Elden" olur. | Akşamki kasa beklenen nakdi satırlardan doldurur (`cash-report.ts:83`). Teslim satırı hiç gider yazmaz (`cash-outs.ts:110`). İtiraz 1C ve R1b. Owner hakemi: sahibin kendi cebinden yaptığı ödeme kasada fazla göstermesin. |
| K14 | Kasadaki alışveriş satırı aslında tedarikçiye ödemeyse yönetici **Ödemeye çevir** der. Satırın gider kaydı silinir, satır Teslim olur ve ödeme açılır. | Hakem 1 aşı 4. Bugün personel şoföre verdiği parayı fişsiz alışveriş yazınca ikinci bir gider oluşuyor (`staffToExpenses`). |
| K15 | **Borç ekle'de Kasa denetimi:** aynı tedarikçiye ±3 gün içinde Kasa satırı varsa (tutara bakılmaz) kaydetmeden önce seçim zorunludur. **Alışveriş satırı için:** "Kasadan peşin ödendi (borç açma)" ya da "Ayrı alım". **Teslim satırı için:** "Borcu aç ve bu satırla kapat" ya da "Ayrı alım". | İtiraz R1a: 900 ₺ ile 905 ₺ örneğini ±1 ₺ ipucu kaçırıyordu. |
| K16 | Açık bir kalemin gününden sonra aynı tedarikçiye işlenmemiş bir Kasa satırı varsa kalem "Kasadan ödenmiş olabilir" der. Sabah e-postası o kalemi hatırlatmaz. | İtiraz R1c. |
| K17 | **Güçlü fatura adayı varken** fatura kalemi Ödemeler'de "Faturasız alımın faturası olabilir · Bağla" der; e-postada ve nakit planında yer almaz. Güçlü aday: tek bir borç ya da penceredeki borçların toplamı, faturayla en çok max(1 ₺, %2) farklı. "Ayrı alım" ile aday kapanır. Zayıf adaylar yalnız tedarikçi sayfasında şerit olarak görünür. | İtiraz R3c ve R7a: aynı mal iki kez ödenmesin. Zayıf aday ödeme hatırlatmasından düşürülmez, gerçek borç gizlenmesin. |
| K18 | **Geçmiş ay onayı:** geçmiş bir ayın giderini değiştiren her işlem o ayı adıyla sorar. Sunucu onay gelmeden reddeder. İşlem geçmişine "geçmiş ay değişti" düşer. | İtiraz R6. Panelde ay kilidi yok; Ekim'in kârı sonradan sessizce değişmesin. |
| K19 | Nakit planında bir tedarikçinin mal tahmini, o tedarikçinin açık "Faturası gelecek" borçları kadar düşürülür. | İtiraz R7c: haftalık irsaliyenin aylık faturası hem tahminde hem kesin kalemde sayılırdı. |
| K20 | **Eşitlemeden sonra yeniden dengeleme:** eşitlemede tutarı değişen ve dağıtımı olan faturalar çalışmanın sonunda yeniden dengelenir. Tutar düştüyse fazla sayılan para hesaba geçer. Tutar arttıysa ve faturayı defter kapatmışsa fatura yeniden açılır. | Hakem 2 aşı 6 ve itiraz R4e: iki yön de. |
| K21 | Peşin çalışılan kartın hesabında para varken Paraşüt'ten yeni fatura gelirse, önce hesaptaki para faturaya sayılır. Bunu "Sistem" bir kez yapar, fatura geldiği anda. | İtiraz 2D: yoksa peşin fatura ödendi gelir, para hesapta kalır ve "Bu ay ödenen" iki kez sayar. |
| K22 | **"Eski borç (devir)"** hiçbir zaman gider değildir. **Geçmiş faturaları al:** bu tarihten eski faturaları alırken durur ve onay ister. **Devir girerken uyarı:** o tarihten önceki ödenmemiş faturaları söyler. | İtiraz R3e'nin önerdiği küçük seçenek bu. Diğer seçenek ise reddedildi; gerekçesi §2.2'de. |
| K23 | **Kayıtlı kartın korunması.** Kaydı olan kart silinmez, yalnız listeden gizlenir. Açık borcu ya da hesapta parası olan kart gizlenemez. Ödenmiş faturayı başka gruba taşıyacak ad ya da diğer ad değişikliği reddedilir. Bağlı borcu olan faturada da aynı. Gizli tedarikçi şu durumlarda listeye kendiliğinden döner: açık kalemi olunca, hesapta parası olunca, gizlendiği günden sonra kaydı gelince. | İtiraz R5a (karta göre uyarlandı) ve R5b. |
| K24 | **Kilit sırası:** önce kart satırı `FOR UPDATE`, sonra faturalar, sonra kayıtlar. Faturalar ve kayıtlar kimlik sırasıyla `FOR UPDATE` alınır. | İtiraz R5d. Birleşim-bul grubunun anahtarı eşitlemeyle değişebilir, kart kimliği değişmez. |
| K25 | `UpcomingItem.source` artık `"reminder" \| "invoice" \| "cari"` olur. Her dal bir `switch` ile yazılır ve sonu `unreachable(x: never)` ile kapanır. | Hakem 1 aşı 3, owner aşı 12. Bugün `payment-ui.tsx:194` fatura olmayan her kalemi `markReminderDone`'a gönderir. |
| K26 | **Ekstre** ("Hesap hareketleri") okuma anında üretilir, saklanmaz. Geçmiş veri taşınmaz. Bugünkü ✓'ler "Faturada işaretli ödeme" satırı, Paraşüt'teki kısmi ödemeler "Paraşüt'te ödenen kısım" satırı olarak görünür. "Ekstreyi kopyala" mutabakat metni verir. | ledger'in örtük satırları ve hakem 2'nin aşı 8'i. Veri değişmeden son bakiye bugünkü sayıya eşit çıkar. |
| K27 | **Personel (v1):** yeni ekran ve eylem yok. Kasa'da iki etiket ve bir ipucu değişir. Yöneticinin ödemeye bağladığı Kasa satırını personel düzeltemez ve silemez. Personelin "Tedarikçiye ödeme" türü ve onayı Dalga 10'dan sonra ayrı plan. | Hakem 1 (minimal'den 1-2): Teslim kasayı zaten doğru tutuyor. İtiraz R9a-d. |
| K28 | `supplier_entries` doluysa `db:reset` durur. `--cari-sil` verilmeden çalışmaz. | İtiraz R8. CASCADE elle kayıtları siler, Kasa satırları kalır, faturalar ödenmemiş geri gelir ve iki kez ödenir. |
| K29 | Para double precision tutulur (evin kuralı). Yazarken kuruşa yuvarlanır (`round2`). Kapanış toleransı 0,005 ₺. Bir fatura ya da borç toplamın en çok 0,005 ₺ altına düşerse kapanmış sayılır. | Evin kuralı. |

### 2.2 Hakem aşıları ve itirazın değerlendirilmesi

**İtiraz (cashflow + owner aşıları üzerine)**

| Madde | Sonuç | Not |
|---|---|---|
| 1A / R1a: Kasa satırı varken Borç ekle | **Kabul** | K15, §3.1.5 |
| 1B / R1c: açık kaleme "Kasadan ödenmiş olabilir" | **Kabul** | K16. Ek olarak personelin Kasa penceresinde ad eşleşince "Teslim · ödeme'ye çevir" ipucu çıkar. Ad listesi borca göre süzülmez (R9d). |
| 1C / R1b: Kasadan ödemede var olan satırın önceden seçilmesi | **Kabul** | K13 |
| 2A, 2B / R2a: takip başlarken Paraşüt kısmının saklanması | **Kabul** | K4 |
| 2C, 2D / R2b: önce hesaptaki para | **Kabul** | K6 ve K21. Owner aşı 5'teki ✓ sorusu yerine sonuç bildirimi ve pencerede "Ayrıca ödendi" seçeneği gelir. |
| 3A / R3a: tedarikçiye göre varsayılan | **Kabul** | K8 |
| 3B / R3b: "zaten girildi" kaydı seçtirir | **Kabul** | K8, §3.1.3 |
| 3C / R3c: aday varken faturanın sessize alınması | **Kabul, daraltıldı** | Yalnız güçlü adayda uygulanır (K17). Zayıf aday da sessize alınsaydı gerçek bir borç e-postadan ve plandan düşerdi. |
| 3D / R3d: başka gruptaki faturaya bağlama | **Kabul** | Faturanın adı kartsızsa, onayla diğer ad olarak eklenir. Ad başka bir kartınsa bağ yine kurulur ama diğer ad eklenmez ve uyarı çıkar. |
| 3E / R3e: devir tarihinden eski faturaların 0 sayılması | **Ret.** İtirazın kendi önerdiği küçük seçenek alındı. | Faturayı 0 saymak, bakiye okuyan her yerde kart çözümü ister ve Faturalar ile Tedarikçiler'i ayrıştırır. Yerine K22 geldi: içe almada onay, devir girerken uyarı. |
| 4A / R4a: "Ödenmedi" denetimi tek yerde, defter kapanışları Son ödenenler'de ödeme olarak | **Kabul** | K7. Defterin kapattığı fatura Son ödenenler'e fatura olarak yazılmaz; ödeme kaydı (`cari`) yazılır. |
| 4B / R4b: geri yüklemede yeniden doğrulama | **Kabul** | §7.7 |
| 4C / R4c: ödemede "bekletme" işareti | **Ret** | Sistem düzenli olarak dağıtım yazmıyor (K5). Okuma anındaki mahsup hiçbir şey yazmaz; peşin varış yalnız bir kez olur. Geri alınan dağıtımı yeniden uygulayacak bir döngü olmadığı için işarete gerek yok. |
| 4D: bağ kaldırma yalnız borçtan gelenleri taşır | **Kabul** | `origin_debt_id` |
| 4E / R4e: Paraşüt tutarı artırırsa | **Kabul** | K20 |
| 5A / R5a: kart silinince kayıtların dağılması | **Uyarlandı** | Kayıtlar karta bağlı, ad değişince taşınmaz. Engel, ödenmiş faturayı gruptan çıkaran ad değişikliğine konur (K23). |
| 5B / R5b: gizli tedarikçinin geri dönmesi | **Kabul** | K23 |
| 5C / R5c: Paraşüt'te silinen faturayı silmek yerine ayırmak | **Ret.** Amacı kabul edildi. | Ayrılan bir iptal faturası gider ve borç olarak kalmaya devam ederdi. Yerine bağlar aynı işlemde çözülür, sonra fatura silinir (K11). `supplier_entries.allocated` sütunu tutulmaz. |
| 5D / R5d: kilit anahtarının kayması | **Kabul** | K24 |
| 6 / R6: geçmiş ay | **Kabul** | K18. Gelir-gider'e "Faturası beklenen alımlar" satırı da eklenir. |
| 7A: aday borç ve fatura ikisi de kesin kalem | **Kabul** | R3c ile aynı (K17) |
| 7B / R7b: dağıtılmamış ödeme mahsup edilmiyor | **Kabul** | K5 |
| 7C / R7c: mal tahmininin düşürülmesi | **Kabul** | K19 |
| 8 / R8: db:reset | **Kabul (durdurma)** | K28. Kayıtları tutup yeniden yazmak anlamsız: fatura kimlikleri baştan sayılıyor. |
| 9 / R9a: bağlı satırda personel kilidi | **Kabul** | §8 |
| 9 / R9b: personel verisi beyaz listeyle | **Kabul** | §8 |
| 9 / R9c: otomatik satırın metninde yalnız ad ve tutar | **Kabul** | §8 |
| 9 / R9d: ad listesi borca göre süzülmez | **Kabul** | §8 |

**Hakem 1 (kazananı ledger seçti) aşıları**

- cashflow'dan:
  - 1: n → 1 bağlama. **Kabul.**
  - 2: bağ çözülünce önceki hâlin geri gelmesi. **Kabul.**
  - 3: `switch`'lerin tam olması. **Kabul.**
  - 4: "Kasada zaten var" ve "Ödemeye çevir". **Kabul.**
  - 5: ✓'deki soru. R2b'nin bildirimi ile değiştirildi.
  - 6: bugünkü rakamları sabitleyen testler. **Kabul.**
  - 7: Gelir-gider satırı. **Kabul.**
  - 8: personel için ad listesi. v1'de yalnız ipucuna giriyor; seçici olarak v2'de gelir.
- minimal'den:
  - 1: aşamalı teslim. **Kabul.**
  - 2: personel Teslim'i kullanır. **Kabul.**
  - 3: canlı önizleme. **Kabul.**
  - 4: fotoğrafın faturaya taşınması. **Uyarlandı:** fotoğraf kopyalanmaz. `photos` ile `invoice_documents` ayrı depolar; fatura penceresi bağlı borcun fotoğrafını gösterir.
  - 5: `requireAdmin` testi. **Kabul.**
- ledger düzeltmeleri:
  - Risk 2'nin yönü. K4 ile geçersiz: takipli faturada Paraşüt artık kalanı belirlemiyor.
  - Kayıttaki `allocated` sütununun düşürülmesi. **Kabul** (K12).

**Hakem 2 (kazananı cashflow seçti) aşıları**

- 1: avansın kendiliğinden düşmesi. Okuma anında mahsup olarak alındı (K5). Yazan sürüm reddedildi: R4c sorununu doğurur.
- 2: tek anahtar. Dört seçenek ve varsayılanla değiştirildi (K8): R3a ve R3b tek anahtarın çift sayımını gösterdi.
- 3: kayıttan önce kopya uyarıları. **Kabul** (§3.1.6).
- 4: önizleme metinleri. **Kabul.**
- 5: `ledger_base`. R2a ile genişletildi (K4).
- 6: tutar düşünce fazlanın hesaba geçmesi. **Kabul.**
- 7: işaretin yalnız değişmemişse geri dönmesi. **Kabul.**
- 8: "Ekstreyi kopyala". **Kabul.**
- 9: "Beklemeye devam". **Kabul.**
- 10: kategori ve etiket. Var olan kategori kullanılır, "Alışveriş / ödeme" etiketi "Alışveriş" olur. **Kabul.**
- 11: "Listede yok". v2'ye.
- 12: tam `switch`. **Kabul.**

---

## 3. Kayıt türleri ve alanlar

Her iki kayıt da `supplier_entries`'e yazılır. Tedarikçi her zaman sunucuda çözülür: sayfanın kartı, ya da kartsız grubun anahtarı (`findGroup` gibi). İstemciden ad alınmaz. İstemciden gelen fatura ve borç kimlikleri yalnız o grubun içinden seçim yapmaya yarar.

### 3.1 Borç: **Borç ekle**

Pencerenin başlığı "Borç ekle"; alt satır "Faturasız ya da elden aldığınız mal veya hizmet, eski borç". Düzenlemede başlık "Borcu düzenle" olur.

#### 3.1.1 Alanlar

| Alan (etiket) | Kural | Varsayılan |
|---|---|---|
| **Alım günü** | YYYY-MM-DD. En çok yarın (`todayTR() + 1`). | Bugün |
| **Tutar (KDV dahil, ₺)** | > 0 ve en çok 100.000.000 (`zAmount`). Kuruşa yuvarlanır. Panelin sayı girişiyle yazılır ("1.250,50"). | Boş |
| **Ne alındı** | Zorunlu, 1–200 karakter. Ör. "12 kg kaşar, irsaliye 4411" | Boş |
| **Gider** | Dört seçenekten biri (§3.1.2) | K8'e göre |
| **Kategori** | Yalnız "Faturası yok · gider yaz" seçiliyken. Etkin harcama kategorilerinden biri. | Önce tedarikçinin son "Faturası yok" borcunun kategorisi. Yoksa adı "Nakit malzeme alımı" olan kategori. O da yoksa ilk etkin mal/diğer kategorisi. |
| **Harcama kaydı** | Yalnız "Gideri zaten girildi" seçiliyken (§3.1.3) | Tutarı en yakın aday |
| **Vade** | İsteğe bağlı. Alım gününden önce olamaz. | Boşsa alım günü + kartın vade günü, o da yoksa genel ayar. Kural `dueOf` ile aynı. |
| **Not** | En çok 1000 karakter | Boş |
| **Fotoğraf** (irsaliye / el fişi) | `photos` türü `fis`, 400 gün saklanır. Migration gerekmez. | Yok |
| **Hesaptaki ödemeyi say** (anahtar) | Yalnız kartın hesabında dağıtılmamış para varsa görünür. Açıksa para bu borca sayılır. | Açık |
| **Ödendi** (anahtar) | Açılınca **Nasıl ödendi** ve **Ödeme günü** sorulur (§3.2). Borç, ödeme ve tam dağıtım tek işlemde yazılır. | Kapalı |

#### 3.1.2 Gider seçimi

| Seçenek (etiket) | `cost_mode` | Gider | Ne zaman |
|---|---|---|---|
| **Faturası gelecek** | `fatura` | Şimdi yok. Fatura gelince fatura gider olur. Gelir-gider'de bilgi satırı çıkar (§5.6). | Tedarikçi sonradan fatura kesiyor. Tedarikçinin son 90 günde `origin = 'parasut'` faturası varsa bu seçenek varsayılandır. |
| **Faturası yok · gider yaz** | `gider` | Bir Aylık harcamalar kaydı yazılır; sahibi bu borçtur (K9). | Fatura hiç kesilmeyecek. Paraşüt faturası olmayan tedarikçide varsayılan. |
| **Gideri zaten girildi** | `mevcut` | Yeni gider yazılmaz. Seçilen kayıt borcun olur. | Sahip alımı Aylık harcamalar'a zaten elle yazmış. |
| **Eski borç (devir)** | `devir` | Hiçbir zaman gider değil. | Panelden önceki borç. Ya da gideri sahiplenilemeyen bir yerde duruyor (ör. Gelir-gider › DİĞER hücresi). |

Seçenekler dikey radyo listesi olarak görünür; her birinin altında bir satır açıklama var. Seçim değişince altındaki alanlar açılıp kapanır.

#### 3.1.3 "Gideri zaten girildi"

**Aday kayıtlar** şu koşulların hepsini taşıyan Aylık harcamalar kayıtlarıdır:

- alım gününün ±31 gün içinde;
- `supplier_entry_id` boş (başka bir borcun değil);
- `cash_out_id` boş. Kasa'dan yazılan kayıt peşin alımdır, borç olamaz (bkz. §3.1.5).

Liste mal bölümündeki kategoriler önce, sonra tutar farkı en küçük olan önce sıralanır.

**Seçilen kaydın tutarı ya da günü farklıysa** pencere şunu söyler ve onay ister: "Kaydı borca eşitle: 900,00 → 905,00 ₺, 03.10 → 05.10". Kaydedince kaydın tutarı ve günü borcunkiyle aynı olur ve kayıt kilitlenir (§6.9).

**Aday yoksa** pencere "Uygun harcama kaydı yok. Gideri başka yerdeyse **Eski borç (devir)** seçin" der.

#### 3.1.4 Doğrulama

Sunucu önce Zod ile denetler, sonra işlem içinde kilit altında yeniden denetler. Mesajlar:

- "Alım günü ileri bir tarih olamaz"
- "Vade alım gününden önce olamaz"
- "Kategori seçin" (gider)
- "Harcama kaydını seçin" (mevcut)
- "Bu harcama kaydı başka bir borca bağlı"
- Düzenlemede:
  - "Bu alıma 1.250,00 ₺ ödeme sayılmış; tutar bundan az olamaz"
  - Faturaya bağlı borç salt okunurdur: "Faturaya bağlı; önce bağı kaldırın"
- Kartsız grupta, `nameMoves` engeline takılırsa `removeSupplier`'ın mesajı aynen.

#### 3.1.5 Kasa denetimi (K15)

Kaydetmeden önce sunucu, grubun adlarıyla (`supplierMatchKey` ∈ grubun `keys`) eşleşen Kasa satırlarını arar. Aranan satırlar: alım gününün ±3 günü içinde, işlenmemiş (bir kayda bağlı değil ve `cari.kasa-ayri` listesinde değil). Bulursa kayıt yapılmaz ve pencere seçim ister. Seçim `kasaChoice` olarak geri gelir.

| Bulunan satır | Seçenek A | Seçenek B |
|---|---|---|
| Alışveriş (gider yazmış ya da yazmamış) | **Kasadan peşin ödendi (borç açma):** kayıt yapılmaz. Satır `cari.kasa-ayri`'ye yazılır. Bildirim: "Borç açılmadı; kasadaki satır gider olarak duruyor." | **Ayrı alım:** borç açılır, satır `cari.kasa-ayri`'ye yazılır. |
| Teslim | **Borcu aç ve bu satırla kapat:** borç, Kasadan ödeme (bu satıra bağlı) ve tam dağıtım tek işlemde. Satırın tutarı borçtan büyükse fark hesapta kalır. | **Ayrı alım** |

#### 3.1.6 Kopya uyarıları

Bu uyarılar kaydı engellemez. Yalnız "Faturası yok · gider yaz" seçiliyken gösterilir.

- **Aylık harcamalar'da benzer kayıt:** mal bölümündeki bir kategoride, ±3 gün ve ±1 ₺ içinde bir kayıt varsa: "05.10 Nakit malzeme alımı 900,00 ₺ zaten gider: bu alımsa 'Gideri zaten girildi'yi seçin". Yanındaki düğme seçeneği değiştirir ve kaydı seçili getirir.
- **DİĞER hücresi dolu:** o ayın Gelir-gider › "DİĞER (market / nakit alımlar)" hücresi (`manual:diger_mal`) doluysa: "Ekim'in DİĞER (market / nakit alımlar) hücresinde 3.400 ₺ var; bu alım oradaysa 'Eski borç' seçin ya da hücreyi düzeltin".

#### 3.1.7 Eski borç uyarısı (K22)

O tedarikçinin devir gününden önce tarihli ödenmemiş faturası varsa: "Bu tarihten önce 3 ödenmemiş fatura var (4.200,00 ₺); eski borç bunları da içeriyorsa önce onları ödendi yapın."

### 3.2 Ödeme: **Ödeme ekle**

Pencerenin başlığı "Ödeme ekle"; alt satır "Tek bir faturaya bağlı olmayan ödeme: hesaba, kısmi, toptan, elden". Düzenlemede başlık "Ödemeyi düzenle" olur.

| Alan (etiket) | Kural | Varsayılan |
|---|---|---|
| **Ödeme günü** | En çok yarın. Kasadan seçiliyse `businessDate()`'ten ileri olamaz; bu gün aynı zamanda Kasa'nın günüdür. | Bugün |
| **Tutar (₺)** | > 0, `zAmount`, kuruşa yuvarlanır | Ödemeler'den ya da faturadan açılınca o kalemin kalanı |
| **Nasıl ödendi** | Kasadan · Elden (kasa dışı) · Havale / EFT · Kart · Çek / senet · Diğer | Bkz. aşağıdaki "Nasıl ödendi varsayılanı" |
| **Kasa satırı** | Yalnız Kasadan seçiliyse görünür | Aşağıda |
| **Neye sayılsın** | En eski borçtan · Seçerek · Hesapta beklesin | En eski borçtan. Faturadan "Kısmi ödeme" ile açıldıysa Seçerek, o fatura seçili. |
| **Not** | En çok 500 karakter | Boş |
| **Fotoğraf** (dekont / makbuz) | `photos` türü `fis` | Yok |

**Nasıl ödendi varsayılanı:**

- O gün grubun adıyla eşleşen işlenmemiş bir Kasa satırı varsa: Kasadan, satır seçili (R1b).
- Yoksa kartın ödeme şekli. Kartta "Nakit" yazıyorsa Elden.
- Kartta şekil yoksa Havale / EFT.

**Kasa satırı** (yalnız Kasadan):

- Liste o günün işlenmemiş satırlarını gösterir: Teslim ve Alışveriş. Ad eşleşenler önce. Satır biçimi: "Teslim · Sütaş · 2.200,00 ₺ · Ayşe".
- **Satır seçilirse:** ödemenin tutarı satırın tutarı olur; satır ödemeye bağlanır.
- **Seçilen satır gider yazmış bir Alışveriş satırıysa** kaydetmeden önce onay sorulur: "Bu satırın gider kaydı silinir (ödeme gider değildir): Ekim · Nakit malzeme alımı −2.200,00 ₺". Onaylanınca satırın türü Teslim olur ve gider kaydı silinir. Silinen gider geçmiş aydaysa K18 onayı da istenir.
- **Liste altındaki bağlantı:** "Bu ayrı bir ödeme, kasaya yeni satır ekle". Seçilince Teslim türünde yeni bir satır açılır:
  - Kime: kartın adı
  - açıklama yok
  - tutar: ödemenin tutarı
  - gün: ödeme günü
  - `cash_out_created = true`

**Neye sayılsın:**

- **En eski borçtan:** ödeme açık kalemlere sırayla sayılır. Açık kalem: kalanı 0'dan büyük faturalar ve bağsız borçlar; iadeler hariç. Sıra: vade (kalemin kendi vadesi ya da tahmini vade), sonra tarih, sonra önce faturalar, sonra kimlik. Sayılamayan kısım hesapta kalır.
- **Seçerek:** her açık kalem bir satırdır: onay kutusu ve tutar alanı. Tutar alanı kalemin kalanıyla dolu gelir, istenirse küçültülür. Satırın altında kalem bilgisi: "SUT140 · 18.10 · kalan 1.800,00 ₺ · vade 17.11".
- **Hesapta beklesin:** hiçbir kaleme sayılmaz.

**Canlı önizleme** formun altında tek satırdır:

> "Kapanacak: SUT123 8.450,50 ₺ · Kısmen: SUT140 1.549,50 / 1.800,00 ₺ · Hesapta kalacak: 0,00 ₺"

Hesapta kalacak tutar 0'dan büyükse ikinci satır çıkar: "549,50 ₺ hesapta kalır; yeni borca ya da faturaya 'Borçlara say' ile sayılır."

**Doğrulama** (kilit altında yeniden):

- Dağıtımların toplamı ödeme tutarını aşamaz: "Sayılan tutar ödemeden fazla".
- Her dağıtım, kalemin kalanını aşamaz: "SUT140'ın kalanı 1.800,00 ₺".
- Hedef aynı gruptan olmalı.
- İade faturası ve bağlı borç hedef olamaz.
- Kasadan:
  - satır işlenmemiş olmalı: "Bu kasa satırı başka bir ödemeye bağlı";
  - satır aynı günden olmalı;
  - tutar satırla aynı olmalı.

### 3.3 Bağlar

| Kayıt | Bağlar |
|---|---|
| Borç | Aylık harcamalar kaydı (`expense_entries.supplier_entry_id`; yalnız `gider` ve `mevcut`) · fatura (`invoice_id`; "Faturası geldi", n → 1) · fotoğraf |
| Ödeme | Kasa satırı (`cash_out_id`, tekil; yalnız Kasadan) · dağıtımlar (`supplier_allocations` → fatura ya da borç) · fotoğraf |
| Dağıtım | ödeme · hedef (fatura ya da borç) · `origin_debt_id` (borçtan faturaya taşındıysa) |

Mal siparişiyle bağ yok (v1).

### 3.4 Düzeltme ve silme

**Borç**

- **Düzeltme:**
  - Tutar, borca sayılmış ödemelerden az olamaz.
  - Kip değişince gider kaydı açılır ya da silinir. Silinen ya da değişen kayıt geçmiş aydaysa K18 onayı istenir.
  - `gider` borcun tutarı, günü ve kategorisi değişince sahip olduğu kayıt da aynı işlemde güncellenir.
- **Silme:**
  - Faturaya bağlı borç silinemez.
  - Borca sayılmış ödemeler CASCADE ile kalkar; para ödemenin hesabına döner.
  - `gider` kaydı silinir.
  - `mevcut` kaydın yalnız sahipliği kalkar: `supplier_entry_id = null`, kayıt durur.

**Ödeme**

- **Düzeltme:**
  - Tutar, sayılmış toplamdan az olamaz: "Bu ödemenin 1.549,50 ₺'si faturalara sayılmış; önce 'Neye sayıldı'dan azaltın".
  - Kasadan ödemenin günü değişirse bağlı satırın günü de değişir.
  - Kasadan'dan başka bir şekle geçerken: ödemenin açtığı satır silinir (onay sorulur); var olan bir satıra bağlıysa satır işlenmemişe döner.
  - Başka bir şekilden Kasadan'a geçmek için bir satır seçmek gerekir.
- **Silme:**
  - Dağıtımlar silinir.
  - Defterin kapattığı ve o günden beri değişmemiş faturalar yeniden açılır (§4.5).
  - Ödemenin açtığı Kasa satırı silinir. Var olan bir satıra bağlıysa satır durur ve işlenmemişe döner.

---

## 4. Bakiye ve vade kuralları

Bütün kurallar saf modüllerde durur (`src/lib/cari/*`, §7.2). Her okuyucu bu modülleri çağırır; kuralı kendi içinde tekrar yazan yer kalmaz.

### 4.1 Faturanın kalanı (`openBalance`)

```ts
// src/lib/cari/balance.ts
type BalanceInvoice = { payable: number; unpaid: boolean; outstanding?: number | null; allocated?: number | null; ledgerBase?: number | null };

export function openBalance(i: BalanceInvoice): number {
  if (!i.unpaid) return 0;
  if (i.ledgerBase == null) {
    // Bugünkü kural, harfi harfine (iade dahil)
    return i.outstanding != null && i.outstanding > 0 ? i.outstanding : i.payable;
  }
  if (i.payable <= 0) return i.payable;              // iade: düşülecek alacak, dağıtım almaz
  return round2(Math.max(0, i.payable - i.ledgerBase - (i.allocated ?? 0)));
}
export const isPartiallyPaid = (i: BalanceInvoice) => {
  const b = openBalance(i);
  return i.unpaid && b > EPS && b < i.payable - EPS;
};
/** Dağıtım faturayı tamamen karşılıyor mu (takipli, P > 0) */
export const coveredByAllocations = (i: BalanceInvoice) =>
  i.ledgerBase != null && i.payable > 0 && i.payable - i.ledgerBase - (i.allocated ?? 0) <= EPS;
```

`EPS = 0.005`. Hiç kayıt yokken bütün faturalarda `ledgerBase` boş ve `allocated` 0'dır, yani sonuç bugünküyle aynıdır (§9 sabit testi).

### 4.2 Takibin başlaması (`ledger_base`)

**Ne zaman:** kartın ilk ödeme kaydı yazılırken (yöntem fark etmez), aynı işlemde `startTracking(tx, cardId)` çalışır.

**Ne yazar:** grubun `ledger_base`'i boş olan bütün faturalarına bir değer yazar:

- Ödenmemiş ve `outstanding > 0` olan fatura: `max(0, payable − outstanding)`. Bu, Paraşüt'ün o ana kadar ödendi gösterdiği kısımdır.
- Diğer bütün faturalar: 0.

**Takipli karta sonradan gelen fatura:**

- **Paraşüt eşitlemesi:** yeni satırın kartı takipliyse (`ctx.trackedCard(supplier, tax)`) `ledger_base = 0` yazılır. Takipli kart demek, `supplier_entries`'te ödeme kaydı olan kart demek; liste çalışmanın başında bir kez okunur. Fatura takip başlamadan önceki tarihliyse ("Geçmiş faturaları al" ya da geç girilmiş eski fatura; takibin başladığı gün kartın en eski ödeme kaydının günüdür) 0 yerine takip başlarken panelde olsaydı alacağı değer yazılır, yani Paraşüt'te o ana kadar ödenen kısım (`arrivalLedgerBase`, para-8).
- **Elle ve Excel'den eklenen fatura:** kart aynı çözümle bulunur, 0 yazılır.
- **Dağıtım yazılırken** `ledger_base` hâlâ boşsa o an yukarıdaki kuralla doldurulur. Örnek: fatura sonradan diğer ad eklenerek gruba girmiş.

**Eşitlemenin dokunmadığı sütunlar:** `ledger_base`, `allocated` ve `paid_by_ledger` eşitlemenin `common` nesnesinde yoktur (`sync.ts:~354`), eşitleme bunları yazmaz.

**Paraşüt ipucu** (yalnız tedarikçi sayfası ve Faturalar). Takipli ödenmemiş faturada `outstanding > 0` ve panelin kalanından 0,005 ₺'den fazla farklıysa:

- **Paraşüt daha az kalan gösteriyorsa:** "Paraşüt'te kalan 2.000,00 ₺; panelde 2.500,00 ₺. Panelde girilmemiş bir ödeme varsa Ödeme ekle." (düğme)
- **Paraşüt daha çok kalan gösteriyorsa:** "Paraşüt'te kalan 3.000,00 ₺ (ödememiz henüz işlenmemiş olabilir)." Gri.

Panelde ödendi görünen ama Paraşüt'te `parasutUnpaid = true` olan faturada: "Paraşüt'te açık görünüyor" (gri).

### 4.3 Borç, ödeme, tedarikçi

**Tek kayıt:**

- `debtRemaining(d)` = `d.invoiceId` doluysa 0; yoksa `round2(max(0, A − Σ borca sayılanlar))`.
- `paymentCredit(p)` = `round2(C − Σ ödemenin dağıtımları)`. Hiç negatif olmaz; doğrulama ve kırpma bunu korur.

**Tedarikçi** (`accountOf`, kartın grubu):

- **open** = Σ `openBalance` (grubun faturaları; ödenmemiş iade eksi olarak) + Σ `debtRemaining` (bağsız borçlar)
- **credit** = Σ `paymentCredit` (kartın ödemeleri)
- **balance** = open − credit

Ekstrenin son satırı her zaman `balance`'tır; bir test bunu rastgele örneklerde de denetler (§9).

**Dağıtım başka grupta kalırsa:** ad değişikliği gibi bir sebeple bir dağıtımın faturası artık bu grupta değilse, ödeme satırında uyarı çıkar: "Bu ödemenin 1.000,00 ₺'si artık başka tedarikçide görünen bir faturaya sayılı · Ödemeden çıkar". Para toplamda doğru kalır, iki sayfaya bölünür. K23 bu durumu ad değişikliğinde zaten engeller; uyarı eski veri içindir.

### 4.4 Okuma anında mahsup (`netCredit`)

Saf fonksiyon: `netCredit(items, credit) → { items: (item & { net, credited })[], covered: item[], left: number }`.

- **Kalemler:** kartın kalanı 0'dan büyük faturaları ve bağsız borçları. İadeler ve `quiet = "link"` kalemler (K17) hariç.
- **Sıra:** vade, sonra tarih, sonra önce faturalar, sonra kimlik. Ödeme dağıtımındaki sırayla aynı.
- **Hesap:** credit kalemlerden sırayla düşülür.
  - Tamamen karşılanan kalem `covered`'a gider.
  - Kısmen karşılanan kalemin `net`'i azalır, `credited` alanı dolar.
- **Kullananlar** (hepsi aynı sonucu verir):
  - Ödemeler'de `net`: listede, toplamlarda ve filtrelerde. `covered` ayrı kutuda.
  - Bugün, zil, sabah e-postası, Genel bakış ödemeleri ve nakit planındaki kesin kalemler: `net`.
  - Tedarikçi sayfasındaki "Vadesi geçen" ve "7 gün içinde": `net` (§4.6).
- Mahsup veritabanına hiçbir şey yazmaz. Kalıcı dağıtım için tedarikçi sayfasında şerit çıkar: "Hesapta 99,50 ₺ sayılmamış ödeme var · Borçlara say".

### 4.5 Ödendi işareti ve dağıtım (`resettle`, önce hesaptaki para)

`resettle(tx, invoiceIds)` her para işleminin sonunda çalışır.

1. `allocated`'ı SUM ile yeniden yazar.
2. **Kapatır:** ödenmemiş, `P > 0` ve `coveredByAllocations` olan faturada:
   - `unpaid = false`
   - `paidAt` = son dağıtım yapan ödemenin günü
   - `paidVia` = yöntem eşlemesi: kasa ve elden → `nakit`, havale → `havale`, kart → `kart`, çek → `cek`, diğer → `diger`
   - `paymentRequestedAt = null`
   - `paid_by_ledger = true`
3. **Açar:** `paid_by_ledger = true` olan ama artık tamamen karşılanmayan faturada:
   - `unpaid = true`
   - `paidAt = null`, `paidVia = null`
   - `paid_by_ledger = false`
4. Elle konmuş ✓'ye (`paid_by_ledger = false`) hiç dokunmaz.

**Kullanıcının yazması:** `applyPayment` (✓, pencere, toplu, Ödemeler) ve `saveInvoice` ödeme alanlarını her yazışında `paid_by_ledger = false` yapar. Ödeme günü elle düzeltilen fatura artık "defterin bıraktığı gibi" değildir. Ödeme silinince böyle bir fatura açılmaz; bildirim "1 fatura başka biçimde ödendi işaretli; olduğu gibi bırakıldı" der. Bu hakem 2'nin aşı 7'sidir.

**Önce hesaptaki para** (K6) `creditFirst(tx, cardId, invoiceIds)`. Bir fatura ödendiye geçerken:

1. Kartın hesabındaki para, en eski ödemeden başlayarak, faturanın kalanına kadar dağıtılır.
2. Tamamen karşılanırsa fatura defterle kapanır.
3. Karşılanmazsa kalan kısım bugünkü gibi işaretlenir: `unpaid = false`, `paid_by_ledger = false`, gün ve şekil kullanıcının girdiği.

Toplu işlemde para faturalara sırayla (vade sırası) dağıtılır. Kartsız gruplarda hesapta para olmaz; davranış bugünküyle aynıdır.

- Ödeme penceresinde, kartın hesabında para varsa radyo çıkar:
  - "Hesaptaki ödemeden say (99,50 ₺)" (varsayılan)
  - "Ayrıca ödendi". Seçilirse `separately: true` gönderilir ve hesaptaki para kullanılmaz.
- Bildirim örneği: "SUT151 ödendi · hesaptaki 99,50 ₺ sayıldı, kalan 3.000,50 ₺ ödendi işaretlendi" ve "Geri al".

**`assertNotCovered`** (K7): "Ödenmedi" ya da "Talep edildi" istenen fatura tamamen karşılanmışsa reddedilir. Mesaj: "Bu faturaya 22.10 ödemesinden 8.450,50 ₺ sayılmış; ödenmedi yapmak için Hesap hareketleri'nde 'Ödemeden çıkar'." Kısmen sayılmış bir faturada "Ödenmedi"ye izin verilir: yalnız işaretli kısım kalkar, kalan = P − base − allocated.

### 4.6 Vade, vadesi geçen, 7 gün içinde

- **Vade:** faturada `dueDate`, borçta `due_date`. Boşsa tarih + kartın vadesi, o da yoksa genel ayar (`dueOf`). Kısmi ödeme vadeyi değiştirmez.
- **Vadesi geçen:** `net > 0` ve vade < bugün. **7 gün içinde:** `net > 0` ve vade bugünden en çok 7 gün sonra (`SOON_DAYS`).
- İadeler ve hesaptaki para gecikmiş sayılmaz. Bugün de böyle: `logic.ts:430`.
- Faturası gelecek borç için 45 gün kuralı ayrıdır (§5.2): borç 45 gündür açıksa "Faturası 45 gündür gelmedi" uyarısı çıkar. Ödeme vadesiyle ilgisi yoktur.

### 4.7 Ödenen (Bu ay ödenen, Son ödeme)

`paymentEvents(invoices, payments)` ödeme olaylarını listeler:

- **Her ödeme kaydı:** tutarı C, günü ödeme günü, şekli. Hesapta kalan kısım da ödenmiş paradır.
- **Örtük olaylar:** ödenmiş, `paid_by_ledger = false`, `paidAt`'ı dolu her fatura için tutar `P − (ledgerBase ?? 0) − allocated`, sıfırdan büyükse.
  - Takipsiz faturada bu bugünkü gibi P'dir.
  - Defterin kapattığı fatura 0 katar; para ödeme kaydında zaten sayıldı. Çift sayım olmaz.
- Paraşüt'ün takip öncesi kısmı (`ledgerBase`) olay sayılmaz: günü bilinmiyor. Bugün de sayılmıyor.

**Bu ay ödenen** (Tedarikçiler listesi) = günü bu ayda olan olayların toplamı. Bu kural `breakdowns.ts:110 paidInMonth`'un yerini alır.

**Son ödeme** = en yeni olay günü; alt satırda o günün toplamı. Breakdown "Ödemeler" son 12 ödeme gününü gösterir. Ödeme satırı "Ödeme · Havale / EFT · 2 kaleme" biçiminde, fatura satırı bugünkü gibi.

Kayıt yokken sonuç bugünküyle aynıdır (§9 sabit testi).

### 4.8 Ekstre satırları

| Satır (etiket) | Borç | Ödeme | Gün |
|---|---|---|---|
| Fatura `<no>` | P (P > 0) | | fatura günü |
| İade faturası `<no>` | | \|P\| | fatura günü |
| İade düşüldü (ödenmiş iade) | \|P\| | | `paidAt` ya da fatura günü |
| Paraşüt'te ödenen kısım (gün bilinmiyor) | | `ledgerBase` (takipli, > 0) ya da P − o (takipsiz, ödenmemiş, o > 0) | fatura günü |
| Faturada işaretli ödeme · `<şekil>` | | P − base − allocated (ödenmiş, > 0, defter kapatmamış) | `paidAt`; boşsa fatura günü ve "(gün bilinmiyor)" |
| Faturasız alım · `<ne>` (faturası gelecek / gider yazıldı / gideri zaten girildi) | A | | alım günü |
| Eski borç (devir) · `<ne>` | A | | alım günü |
| Faturaya bağlandı → `<no>` | gri, etkisiz | | alım günü |
| Ödeme · `<şekil>` (Kasadan ise "Teslim · Sütaş") | | C | ödeme günü |

- Ödeme satırının altında, girintili küçük yazıyla neye sayıldığı yazar: "SUT123 8.450,50 · SUT140 1.549,50 · hesapta 0,00".
- **Sıra:** gün, sonra borç satırları, sonra ödeme satırları, sonra kimlik.
- **Bakiye sütunu** satır satır yürür.
- **Süzgeç:** "Son 3 ay · Bu yıl · Tümü". Süzgeçte ilk satır "Devreden bakiye" olur: süzgeç başlangıcından önceki bütün satırların toplamı.

### 4.9 Örnek: Sütaş (bugün 24.10.2026; 28.10 ve 30.10 adımları ileriye dönük)

**Kart:** Sütaş. Vade 30 gün, ödeme şekli Havale / EFT, peşin değil.

**Başlangıç** (bugünkü veri; hiçbir şey taşınmaz):

| Fatura | Gün | Ödenecek | Durum |
|---|---|---|---|
| F1 SUT098 | 01.10 | 4.000,00 | ödendi 10.10, havale |
| F2 SUT123 | 12.10 | 8.450,50 | ödenmedi, tahmini vade 11.11 |
| F3 SUT140 | 18.10 | 3.000,00 | ödenmedi, Paraşüt kalanı 1.800,00 (muhasebeci daha önce 1.200 işlemiş), tahmini vade 17.11 |

Bugünkü kuralla Kalan borç: 8.450,50 + 1.800,00 = **10.250,50**.

**Adımlar:**

| # | Gün | İşlem | Sonuç | Kalan borç |
|---|---|---|---|---|
| 1 | 20.10 | Borç ekle: B1 "süt, irsaliye 4411" 1.250,00. Sütaş'ın son 90 günde Paraşüt faturası var, varsayılan **Faturası gelecek** kalır. Vade 19.11. | Gider yok. Gelir-gider Ekim: "Faturası beklenen alımlar: 1.250,00 ₺". | 11.500,50 |
| 2 | 21.10 | Borç ekle: B2 "beyaz peynir, şoförden" 600,00. Sahip **Faturası yok · gider yaz** seçer, kategori Nakit malzeme alımı. Vade 20.11. | Aylık harcamalar Ekim'e "Sütaş · beyaz peynir" 600,00 yazılır (sahibi B2, KDV yok). | 12.100,50 |
| 3 | 22.10 | Ödeme ekle: 10.000,00 Havale / EFT, En eski borçtan. | Takip başlar. Yazılan `ledger_base`: F1 0, F2 0, F3 1.200. Dağıtım sırası vadeye göre: F2 (11.11), F3 (17.11), B1 (19.11), B2 (20.11). **F2** 8.450,50 alır ve defterle kapanır: ödendi 22.10, havale. **F3** 1.549,50 alır ve kalanı 3.000 − 1.200 − 1.549,50 = 250,50 olur. Hesapta 0. Önizleme: "Kapanacak: SUT123 8.450,50 ₺ · Kısmen: SUT140 1.549,50 / 1.800,00 ₺ · Hesapta kalacak: 0,00 ₺". | 2.100,50 |
| 4 | 23.10 | Muhasebeci aynı 1.549,50'yi Paraşüt'te SUT140'a işler. Eşitleme `outstanding = 250,50` yazar. | Takipli fatura Paraşüt kalanını okumaz: kalan 250,50 kalır. İpucu yok, çünkü iki taraf eşit. | 2.100,50 |
| 5 | 24.10 | Personel şoföre kasadan 2.200 verir ve "Teslim · ödeme", Kime: Sütaş yazar. Yönetici Ödeme ekle'yi açar: **Kasadan**, satır "Teslim · Sütaş · 2.200,00 ₺" önceden seçili, En eski borçtan. | **F3** 250,50 alır ve kapanır: ödendi 24.10, nakit. **B1** 1.250,00 ile kapanır. **B2** 600,00 ile kapanır. Hesapta **99,50** kalır. Kasa'da gider yazılmaz; satır zaten akşam raporunun "Gün içinde çıkan" toplamında. | **−99,50**: kartta "Alacak 99,50 ₺ · hesapta sayılmamış ödeme". Ödemeler'de Sütaş yok. |
| 6 | 28.10 | Eşitleme SUT149 getirir: 1.250,00 (net 1.136,36 + KDV 113,64). Kart takipli olduğu için `ledger_base = 0`. | B1 için güçlü aday (tutar aynı, gün pencerede). Ödemeler'de SUT149 sessiz görünür: "Faturasız alımın faturası olabilir (20.10 · süt) · Bağla". E-posta ve nakit planı onu göstermez. Sayfada şerit: "Faturası gelmiş olabilir: 28.10 · SUT149 · 1.250,00 ₺ · Bağla". | 1.150,50 (bağlanana kadar) |
| 7 | 28.10 | **Bağla:** B1 → SUT149. | B1'e 24.10 ödemesinden sayılan 1.250,00 faturaya geçer (`origin_debt_id = B1`). SUT149'un kalanı 0 olur ve defterle kapanır: ödendi 24.10, nakit. B1'in gider kaydı yok; "Faturası gelecek" idi. Gider artık SUT149'un neti 1.136,36 (Ekim); 113,64 KDV tahmine girer. Önizleme: "Ekim mal alışı 1.136,36 ₺ artar (KDV hariç; fatura zaten giderde) · KDV tahmini Ekim +113,64 ₺ · fark faturada 0,00 ₺". Geçmiş ay yok, ek onay sorulmaz. | −99,50 |
| 8 | 30.10 | Eşitleme SUT151 getirir: 3.100,00 (net 2.818,18 + KDV 281,82), vade 29.11. | Ödemeler, plan, e-posta ve zil SUT151'i **3.000,50** gösterir: "hesaptaki 99,50 ₺ düşüldü". Şerit: "Hesapta 99,50 ₺ sayılmamış ödeme var · Borçlara say". Basılınca 99,50 kalıcı olarak SUT151'e sayılır; rakamlar değişmez. Muhasebeci bu 99,50'yi önce Paraşüt'te işlemiş olsa da (o = 3.000,50) sonuç aynıdır. Bu itirazın 2A durumudur. | 3.000,50 |

**Ekstre (30.10, Tümü):**

| Gün | Hareket | Borç | Ödeme | Bakiye |
|---|---|---|---|---|
| 01.10 | Fatura SUT098 | 4.000,00 | | 4.000,00 |
| 10.10 | Faturada işaretli ödeme · Havale / EFT | | 4.000,00 | 0,00 |
| 12.10 | Fatura SUT123 | 8.450,50 | | 8.450,50 |
| 18.10 | Fatura SUT140 | 3.000,00 | | 11.450,50 |
| 18.10 | Paraşüt'te ödenen kısım (gün bilinmiyor) | | 1.200,00 | 10.250,50 |
| 20.10 | Faturasız alım · süt → SUT149'a bağlandı | *(1.250,00 gri)* | | 10.250,50 |
| 21.10 | Faturasız alım · beyaz peynir (gider yazıldı) | 600,00 | | 10.850,50 |
| 22.10 | Ödeme · Havale / EFT (SUT123 8.450,50 · SUT140 1.549,50) | | 10.000,00 | 850,50 |
| 24.10 | Ödeme · Kasadan, Teslim · Sütaş (SUT140 250,50 · SUT149 1.250,00 · beyaz peynir 600,00 · SUT151 99,50) | | 2.200,00 | −1.349,50 |
| 28.10 | Fatura SUT149 | 1.250,00 | | −99,50 |
| 30.10 | Fatura SUT151 | 3.100,00 | | **3.000,50** |

Son bakiye 3.000,50 ve Kalan borç da 3.000,50: ikisi eşit. 19.10 itibarıyla aynı ekstrenin bakiyesi 10.250,50, bugünkü sayı.

**Ekim'de ödenen** (Sütaş): F1 örtük 4.000,00 + 10.000,00 + 2.200,00 = **16.200,00**.

- Bugünkü kural yalnız ✓'lenen faturaların tamamını sayar. 1.549,50'lik kısmi ödemeyi ve hesapta kalan 99,50'yi göremezdi.
- F2, F3 ve SUT149 defterle kapandığı için örtük tutarları 0'dır. Çift sayım olmaz.

**Ekim gideri** (Sütaş):

- Mal alışları: F1, F2, F3, SUT149 (1.136,36) ve SUT151 (2.818,18) netleri, KDV hariç.
- Nakit malzeme alımı: 600,00, KDV dahil.
- B1 ve ödemeler: 0.
- KDV tahmini: yalnız faturaların KDV'si; B2'den KDV yok.

---

## 5. Maliyet ve KDV

### 5.1 Ne neyi gider yapar

| Kayıt | Gider | İndirilecek KDV | Borç | Kasa |
|---|---|---|---|---|
| Borç · Faturası gelecek | Yok (fatura gelince fatura) | Yok | Var | — |
| Borç · Faturası yok · gider yaz | Bir Aylık harcamalar kaydı: alım günü, KDV dahil tutar, seçilen kategori. `paymentMethod` boş, açıklama "Sütaş · süt", not "Cari · faturasız", `vat` boş, `supplier_entry_id` = borç. Mal bölümündeyse stok devrinden önce Mal alışları'na girer (`engine.ts` 1425–1430), genel bölümdeyse kendi satırına. | Yok (`kdv.ts` harcama okumaz) | Var | — |
| Borç · Gideri zaten girildi | Var olan kayıt (borcun olur) | Yok | Var | — |
| Borç · Eski borç (devir) | Hiçbir zaman | Yok | Var | — |
| Ödeme (her şekil) | Hiçbir zaman | Hiçbir zaman | Düşer | Kasadan: Teslim satırı, gider yazmaz (`cashOutWritesExpense` harcama dışında `false`) |

Ödemeler motora, `goodsPurchases`'a, Aylık harcamalar'a, `kdv.ts`'e ve Paraşüt'e hiçbir şey yazmaz.

### 5.2 "Faturası geldi" (bağlama) ve 45 gün

**Pencere:** "Faturası geldi" ya da "Faturaya bağla".

- **Borç tarafı:** 1–n bağsız borç seçilir. `fatura`, `gider` ve `mevcut` borçlar varsayılan listede; `devir` borçlar "Diğer"in altında.
- **Fatura tarafı:** tek bir fatura seçilir.
  - Önerilenler: aynı gruptan, en eski borcun gününden 7 gün önce ile en yeni borcun gününden 45 gün sonra arasındaki faturalar.
  - "Başka faturalar": bütün faturalarda arama (R3d). Seçilen faturanın adı kartsızsa pencere sorar: "‘SÜTAŞ SÜT ÜRÜNLERİ A.Ş.’ Sütaş'ın diğer adı olsun mu? (o adla 4 fatura bu karta geçer)". Varsayılan evet. Ad başka bir karttaysa diğer ad eklenmez; uyarı: "Fatura Pınar'da görünmeye devam eder."
- **Önizleme** (owner aşı 4'ün metni):
  > "Ekim gideri −600,00 ₺ (Nakit malzeme alımı), Kasım mal alışı faturada 545,45 ₺ (KDV hariç; zaten sayılıyor) · KDV tahmini Kasım +54,55 ₺ · fark faturada +0,00 ₺"
- **Devir borcu seçilmişse** ek uyarı: "Eski borç gider sayılmıyordu; fatura gider sayılır. Bu alımın gideri önceki aylarda başka yerde girildiyse (ör. Gelir-gider › DİĞER) orayı düzeltin, yoksa çift sayılır."

**İşlem sırası** (tek işlem; kilitler K24):

1. Her borca `link_prev` yazılır: `{ costMode, categoryId, expense?: { categoryId, description, note, amount, date } }`.
2. Borca `invoice_id` ve `linked_at` yazılır.
3. Borca sayılmış dağıtımlar faturaya geçer: `debt_id → null`, `invoice_id = fatura`, `origin_debt_id = borç`. Faturanın kalanından (P − base − allocated) fazlası kırpılır, en yeni dağıtımdan başlayarak. Kırpılan para ödemenin hesabına geçer.
4. Borcun gider kaydı silinir (`gider` ve `mevcut`).
5. `resettle(fatura)`.
6. Silinen gider geçmiş aydaysa K18 onayı gerekir.

**Bağ kaldırma** (`unlinkDebt`):

1. `origin_debt_id` = bu borç olan dağıtımlar borca geri döner. Yer yoksa kırpılır, para hesaba geçer.
2. `link_prev`'den kip ve kategori geri gelir; gider kaydı yeniden yazılır.
3. `invoice_id`, `linked_at` ve `link_prev` boşalır.
4. Fatura yeniden dengelenir.

**45 gün:** bağsız `fatura` kipindeki bir borç 45 gün açık kalırsa (`DEBT_INVOICE_WAIT_DAYS = 45`) ve `remind_after` geçmişse uyarı çıkar. Uyarı tedarikçi sayfasında şerit, Genel bakış'ta da uyarı olur:

> "Faturası 45 gündür gelmedi: 20.10 · süt · 1.250,00 ₺"

Düğmeler:

- **Gider olarak yaz:** kip `gider` olur, kayıt alım gününe yazılır, K18 onayı istenir.
- **Beklemeye devam:** `remind_after = bugün + 45`.

### 5.3 Çift sayım kuralları

1. **Aynı alım hem Aylık harcamalar'da hem borçta:** bu yolla gider yazan yalnız `gider` kipidir. `mevcut` var olan kaydı sahiplenir. `devir` hiç yazmaz. Kayıttan önce kopya uyarıları çıkar (§3.1.6).
2. **Aynı alım hem Kasa'da hem borçta:** borç eklenirken ±3 gün içindeki Kasa satırı zorunlu bir seçim ister (K15). Kasa'dan yazılmış harcama kaydı "zaten girildi" adayı olamaz; o peşin alımdır.
3. **Borç kasadan ödendi:** ödeme bir Teslim satırına bağlanır, gider yazılmaz. Satır alışveriş olarak girildiyse:
   - yönetici **Ödemeye çevir** ile gideri siler (K14);
   - sistem kalemde "Kasadan ödenmiş olabilir" ipucu gösterir (K16);
   - personel penceresi ad eşleşince Teslim'e çevirmeyi önerir (§8).
4. **Faturasız alımın faturası sonradan geldi:**
   - Bağlama, sahip olunan gideri siler (§5.2).
   - Bağlanana kadar güçlü aday fatura e-postadan ve plandan çıkar (K17).
   - Paraşüt'ün `findExisting`'i borçları hiç görmez. Yanlış ya da kendiliğinden bağ kurulmaz; bağ her zaman bilinçli bir tıklamadır.
5. **Sahte KDV:** borçlar ve sahip olunan kayıtlar KDV taşımaz. `kdv.ts` yalnız faturaları okur.
6. **Toptan ya da avans ödemesi:** eksi elle fatura girmeye gerek kalmaz; "Hesapta beklesin" kullanılır. Gideri ve KDV'yi etkilemez. Gerçek iade faturası bugünkü gibi eksi fatura olarak kalır.
7. **Nakit planı:**
   - Borçlar kesin kalemdir.
   - 8 haftalık mal tahmini yalnız faturaları okur (`goodsRows` değişmez). Tedarikçinin tahmini, açık "Faturası gelecek" borçları kadar düşürülür (K19).
   - Sahip olunan harcama kayıtları, bütün Aylık harcamalar gibi planın dışındadır.
   - Hesaptaki para mahsup edilir (K5).
8. **Ödenen tutar:** defterin kapattığı fatura "ödenen"e 0 katar. Ödeme kaydı sayılır (§4.7).
9. **Paraşüt ile panel aynı ödemeyi tutuyor:** takipli faturada Paraşüt'ün kalanı yok sayılır (K4). Aynı ödeme iki kez düşülmez.

### 5.4 Geçmiş ay onayı (K18)

**Hangi işlemler:** gider kaydı açan, silen ya da tutarını, gününü veya kategorisini değiştiren her cari işlem. Liste:

- borç ekle ve düzelt (`gider`, `mevcut` eşitleme)
- kip değişimi
- borç silme
- bağlama ve bağ kaldırma
- Ödemeye çevir
- 45 günde "Gider olarak yaz"
- Kasadan ödemede alışveriş satırının gideri

**Nasıl çalışır:**

- `pastMonthEffects(changes, todayTR())`, bugünün ayından eski ayları tutarlarıyla döner. Ör. `[{ month: "2026-09", delta: -1200 }]`.
- İstemci önizlemede gösterir: "Eylül 2026 gideri 1.200,00 ₺ azalır (geçmiş ay)". Onay kutusu: "Eylül 2026'nın kapanmış rakamlarının değişeceğini biliyorum".
- İstemci onaylanan ayları `confirmPast` olarak gönderir. Sunucu kendi hesabıyla karşılaştırır; eksik ay varsa `UserError` döner: "Bu değişiklik Eylül 2026 giderini değiştirir; onaylayın".
- İşlem geçmişi ayrıntısının sonuna eklenir: " · geçmiş ay değişti: Eylül 2026".

### 5.5 Nakit planı

- **Kesin kalemler:** `up.items`'tan fatura ve cari kalemleri, mahsuptan sonraki `net` ile. Cari kalemi:
  - anahtar `cari:<id>`
  - tür `invoice`
  - başlık "Sütaş · faturasız alım" ya da "Sütaş · fatura bekleniyor" ya da "Sütaş · eski borç"
  - gecikmişse bugüne taşınır
  - `href: /panel/hatirlaticilar?kaynak=cari`
- `quiet = "link"` kalemler girmez.
- **Mal tahmini (K19):** `CashPlanInput.expectedDebts: { keys: string[]; amount: number }[]`. Anahtarlar kartın adı ve diğer adları (`supplierMatchKey`), tutar açık "Faturası gelecek" borçlarının kalanı.
  - `supplierMatchKey(goods.supplier)` bu anahtarlardan birine uyan tedarikçinin ufuktaki tahmini (Σ `goodsParts`) T olsun.
  - Tahmin `(1 − min(T, X) / T)` oranıyla küçültülür.
  - Basis notu: "Sütaş'ın tahmini, faturası beklenen 1.250 ₺ kadar düşürüldü".
- **"Nasıl hesaplandı" metinleri:**
  - "Çift sayım": "Faturasız borçlar kesin kalemde; faturası beklenenler kadar mal tahmini düşürüldü."
  - "Dahil değil": "Aylık harcamalar'daki fatura dışı ödemeler (cari borçların gider kayıtları dahil)".
  - Yeni not: "Tedarikçinin hesabındaki sayılmamış ödeme borcundan düşüldü."

### 5.6 Gelir-gider bilgi satırı

Mal alışları bölümünün altında, ay görünümünde:

> "Faturası beklenen alımlar: 1.250,00 ₺ (bu ayın giderinde yok) · Tedarikçiler"

Tutar, o ayda tarihli bağsız `fatura` kipindeki borçların toplamıdır. Bağlantı en çok borcu olan tedarikçinin sayfasına gider. Satır yalnız bilgi verir, toplamlara katılmaz.

---

## 6. Ekranlar

Bütün cari ekranları ve eylemleri yalnız yöneticiye açıktır (`requireAdmin`). Telefon ölçüsü 390 px'tir. Her pencere telefonda alttan açılan bir sayfadır (en çok 90dvh); gövde kayar, altta yapışık "Kaydet" ve "Vazgeç" düğmeleri durur. Tutar alanlarında `inputMode="decimal"`. Sayfada yatay kaydırma olmaz.

### 6.1 Tedarikçi sayfası (`/panel/tedarikciler/[cari]`)

**Başlık**

- Düğmeler: **Ödeme ekle** (birincil) ve **Borç ekle**, mevcut Düzenle ve Sil'in yanında.
- 640 px'in altında iki düğme başlığın altında iki sütunlu bir satır olur, en az 44 px yükseklik.

**Kartlar** (dört kart; 390 px'te 2 × 2)

- **Kalan borç** = `balance`.
  - Alt satır: "3 fatura · 2 faturasız alım · hesapta 99,50 ₺".
  - Breakdown grupları:
    - Faturalar
    - Faturasız alımlar
    - Hesaptaki ödeme (eksi)
  - `balance < 0` ise etiket **Alacak (fazla ödeme)** olur, renk "good": "99,50 ₺ · hesapta sayılmamış ödeme".
- **Vadesi geçen:** mahsuptan sonra, borçlar dahil (§4.6).
- **2026 alımları:** faturalar + bağsız `fatura` / `gider` / `mevcut` borçlar. Devir hariç. Alt satır: "faturasız 1.850,00 ₺ dahil".
- **Son ödeme:** §4.7. Bilgi metni: "Ödeme kayıtları ve ödendi işaretleri; kısmi ödemeler ve hesaba ödemeler dahil."

**Şeritler** (kartların altında, öncelik sırasıyla)

1. "Hesapta 99,50 ₺ sayılmamış ödeme var · **Borçlara say**". Yalnız açık kalem varsa çıkar.
2. "Faturası gelmiş olabilir: 28.10 · SUT149 · 1.250,00 ₺ · **Bağla** · Ayrı alım". Güçlü ve zayıf adaylar ayrı satırlarda.
3. "Faturası 45 gündür gelmedi: … · **Gider olarak yaz** · Beklemeye devam".
4. "Kasadan bu tedarikçiye 1 ödeme hesaba işlenmedi: 24.10 Teslim · Sütaş 2.200,00 ₺ · **İşle** · Ayrı tut". Fişsiz alışveriş satırı için metin "Tedarikçi ödemesi miydi? · **Ödemeye çevir** · Ayrı alım".
5. "Bu ödemenin 1.000,00 ₺'si başka tedarikçide görünen bir faturaya sayılı · Ödemeden çıkar" (§4.3).
6. `invoices.allocated` ile dağıtım toplamı tutmuyorsa (§7.1, K12): "Dağıtım toplamı tutmuyor (2 fatura) · **Düzelt**".

**Sekmeler**

- Segmented: **Faturalar** | **Hesap hareketleri**. Adreste `?sekme=hareketler`.
- Faturalar sekmesi bugünkü liste ve iki ekle gelir:
  - Kısmen ödenmiş satırda: "Kısmen ödendi · kalan 250,50 ₺ · panelde ödenen 1.549,50 ₺". Bugün `r.outstanding` yazan satır `supplier-client.tsx:325`; artık `openBalance` kullanılır.
  - Paraşüt ipucu (§4.2).
  - Satır menüsüne **Kısmi ödeme** eklenir: Ödeme ekle penceresini o fatura seçili açar.
- **Boş durum:** "Fatura ya da kayıt yok. Elden aldıysanız Borç ekle, Paraşüt'te yoksa Faturalar'dan fatura ekleyin." Altında iki düğme.

**Hesap hareketleri** (ekstre, §4.8)

- **Masaüstü:** tablo. Sütunlar: Tarih · Hareket · Borç · Ödeme · Bakiye. Tutarlar her zaman iki ondalıklı (`tl(v, 2)`).
- **390 px:** liste.
  - 1. satır: gün · hareket (kayar, sarar).
  - 2. satır: sağda tutar (borç koyu, ödeme yeşil) ve "Bakiye 850,50".
  - Ödemenin dağıtımları girintili küçük yazıyla altında.
- **Süzgeç:** "Son 3 ay · Bu yıl · Tümü" ve "Devreden bakiye" satırı.
- **Satır menüsü:**
  - Borç: Düzenle · Sil · Faturası geldi · Bağı kaldır (bağlıysa).
  - Ödeme: Düzenle · Sil · **Neye sayıldı**. Neye sayıldı penceresi dağıtımı değiştirir; her dağıtımın yanında "Ödemeden çıkar".
  - Örtük satırlar: menü yok, gri.
- **Alt satır:** "Bakiye 3.000,50 ₺ (borcumuz)" ya da "99,50 ₺ alacak (hesapta)".
- **Ekstreyi kopyala:** ödeme talebi metni gibi bir WhatsApp metni panoya kopyalanır:

```
Sütaş · hesap özeti (01.08.2026 – 30.10.2026)
Devreden bakiye: 0,00 ₺
01.10.2026 · Fatura SUT098 · 4.000,00 ₺
10.10.2026 · Ödeme (havale) · −4.000,00 ₺
…
30.10.2026 · Fatura SUT151 · 3.100,00 ₺
Bakiye: 3.000,50 ₺ (borcumuz)
L'Affogato
```

### 6.2 Pencereler

| Pencere | Dosya | Açıldığı yer |
|---|---|---|
| Borç ekle / Borcu düzenle | `src/app/panel/tedarikciler/[cari]/debt-dialog.tsx` | Başlık · ekstre satırı · Ödemeler (cari kalem → Düzenle) |
| Ödeme ekle / Ödemeyi düzenle | `src/app/panel/tedarikciler/cari-payment-dialog.tsx`. Tedarikçi seçiciyle Kasa'dan da açılır. | Başlık · fatura satırı "Kısmi ödeme" · Ödeme durumu penceresi · şeritler · Kasa (yönetici) |
| Faturası geldi / Faturaya bağla | `[cari]/link-dialog.tsx` | Borç satırı · aday şeridi · Ödemeler'deki sessiz kalem "Bağla" |
| Neye sayıldı | `[cari]/allocation-dialog.tsx` | Ödeme satırı · şerit "Borçlara say" (önizlemeyle) |

**Ödeme durumu penceresi** (`payment-dialog.tsx`) dört değişiklik alır:

- Açıklama satırında kalan: "Kalan 250,50 ₺ (panelde ödenen 1.549,50 ₺)".
- **Bu faturaya sayılan ödemeler** listesi: "22.10 · Havale / EFT · 1.549,50 ₺". Her satırda "Ödemeden çıkar".
- Kartın hesabında para varsa §4.5'teki radyo.
- Tamamen karşılanan faturada "Ödenmedi" ve "Talep edildi" kapalıdır. İpucu: "22.10 havalesiyle kapandı; ödenmedi yapmak için Hesap hareketleri'nde ödemeden çıkarın."
- Yeni bağlantı: **Kısmi ödeme gir**.

**Ödeme talebi penceresi** (`request-dialog.tsx`)

- Faturalardan sonra "Faturasız alımlar (2)" bölümü gelir, borçlar seçilebilir.
- Tutarlar `net` değil, kalemin kalanıdır.
- Hesapta para varsa düşülecek satır: "Hesaptaki ödeme −99,50 ₺" (onay kutusu, varsayılan işaretli).
- Metne iki satır eklenir: "20.10.2026 · Faturasız alım (süt) · 1.250,00 ₺" ve "Hesaptaki ödeme: −99,50 ₺".

### 6.3 Tedarikçiler listesi (`/panel/tedarikciler`)

- **Satırdaki Kalan borç** = `balance`.
- **Rozetler:** "Faturasız borç" (amber), "Hesapta 99,50 ₺" (yeşil), "Kasadan işlenmedi" (mavi).
- **Üstteki Kalan borç toplamı** = Σ max(0, balance). Alt satır: "hesapta 99,50 ₺ sayılmamış ödeme (1 tedarikçi)".
- **"Borcu olanlar" süzgeci:** balance > 0.
- **Bu ay ödenen:** `paymentEvents` ile (§4.7).
- **Üst şerit:** "Kasadan tedarikçiye 2 ödeme hesaba işlenmedi (3.800,00 ₺) · İşle". Liste açılır, her satırda İşle ve Ayrı tut.
- **Listeden kaldırma** K23'e uyar:
  - "Hesapta 99,50 ₺ var; önce borca sayın ya da ödemeyi silin"
  - "2 açık faturasız borcu var"

### 6.4 Faturalar (`/panel/faturalar`)

- "Kalan" ve süzgeçler yeni `openBalance` ile hesaplanır. Bugün `outstanding` yazan iki yer: `invoices-client.tsx:517` ve `958`.
- Fatura penceresi (`invoice-dialog.tsx:657`) şunları gösterir:
  - **Bu faturaya sayılan ödemeler** (salt okunur);
  - **Bağlı faturasız alımlar** ve onların fotoğrafları: "İrsaliye fotoğrafı · 20.10 · süt".
- **Elle faturada tutar sınırı:** Ödenecek tutar `ledger_base + allocated`'tan küçük kaydedilemez: "Bu faturaya 1.549,50 ₺ ödeme sayılmış; tutar bundan az olamaz".
- **Ödemesi sayılmış fatura silinirken onay:** "Bu faturaya 1.549,50 ₺ ödeme sayılmış; silinirse para Sütaş'ın hesabına geçer. Bağlı 1 faturasız alım yeniden açılır."
- Elle kayıtlar bu listede görünmez; Faturalar faturaların listesi olarak kalır.

### 6.5 Ödemeler & hatırlatıcılar (`/panel/hatirlaticilar`) ve Son ödenenler

**Kaynak süzgeci:** yeni sekme **Faturasız borç** (`?kaynak=cari`). Mevcut `SOURCE_OF` eşlemesi `cari: "cari"` alır.

**Cari kalemi**

- Başlık: tedarikçi.
- Ayrıntı: "Faturasız alım · süt", "Fatura bekleniyor · süt" ya da "Eski borç".
- Tutar: `net`.
- Kısmi mahsupta ek: "hesaptaki 99,50 ₺ düşüldü".
- **Ödendi** (`payDebt`):
  1. Hesaptaki para önce borca sayılır.
  2. Kalan için ödeme kaydı açılır: tutar kalan, gün bugün, şekil kartın şekli ("Nakit" → Elden).
  3. Bildirim "Sütaş faturasız alım ödendi · 1.250,00 ₺ · Havale / EFT", "Geri al" ve "Düzelt" (sayfaya götürür).
- **Ertele:** borcun `due_date`'ini 1 hafta ya da 1 ay öteler (`postponeSupplierDebt`). Geri al: `setSupplierDebtDueDate`.

**Fatura kalemi** bugünküyle aynı, iki farkla:

- tutar `net`;
- **Ödendi** hesaptaki parayı önce kullanır (K6).

**İpuçları** (kalemin altında küçük satır):

- K17 sessiz kalem: "Faturasız alımın faturası olabilir (20.10 · süt) · Bağla · Ayrı alım".
- K16: "Kasadan ödenmiş olabilir: 24.10 Teslim · Sütaş 2.200,00 ₺ · İşle".

**Hesaptaki ödemeyle karşılananlar:** tamamen mahsup edilen kalemler listenin altında kapalı bir kutuda durur. Kutu açılınca her tedarikçi için "Borçlara say" düğmesi var.

**Son ödenenler:**

- Yeni tür `cari` (kimlik = ödeme kaydı).
- Satır: "Hesaba ödeme · Sütaş · 10.000,00 ₺ · Havale / EFT · 2 kalem".
- **Geri al** ödemeyi siler (§3.4). Ödeme sonradan düzenlendiyse (`updated_at` kaydın anından yeni) reddedilir: "Ödeme sonradan düzenlendi; Tedarikçiler'den silin".
- ✓'nin hesaptaki parayı kullandığı fatura kaydı `allocationIds` taşır. Geri alınınca önce o dağıtımlar silinir, sonra fatura ödenmedi olur.

### 6.6 Nakit planı (`/panel/hatirlaticilar/nakit`)

§5.5'teki kurallar. Kesin kalemlerde cari kalemleri tedarikçi adıyla görünür. "Nasıl hesaplandı" bölümündeki üç metin güncellenir.

### 6.7 Bugün, zil, sabah e-postası, Genel bakış

**Bugün** (`bugun/logic.ts:568`) ve **zil** (`notifications.ts:459`) kalemleri `loadUpcoming`'den alır; cari kalemleri ve ipuçları kendiliğinden gelir.

- **Zile (yalnız yönetici, "odeme" grubu) yeni bildirim:** "Kasadan tedarikçiye 2 ödeme hesaba işlenmedi (3.800,00 ₺)". Adres `/panel/tedarikciler?kasa=1`.
- **Personelin zili ve Bugün'ü değişmez.** Personel kolu ödeme okumuyor; `loadPanelNotifications`'ın personel dalı ve `today.ts` staffFacts aynen kalır.

**Sabah e-postası:**

- `dueNotifications`, `quiet` kalemleri atlar: hem `link` hem `kasa`.
- Cari kalemlerin anahtarı `cari:<id>:<vade>:<aşama>`.
- Metin değişmez; yalnız ayrıntı etiketi yeni.
- Yeni fatura bölümü değişmez.

**Genel bakış:**

- `paymentFacts`'a `debts: { count, total }` eklenir (`loadUpcoming().cari`'den). Görev satırı: "· 2 faturasız borç".
- `insights.ts:952`'deki "N fatura ödenmemiş" uyarısı yeni `openBalance` ile sayar: kalanı 0 olan takipli fatura sayılmaz.
- Yeni uyarılar:
  - "Faturası 45 gündür gelmeyen alım" (§5.2)
  - "Faturası gelmiş olabilir" (güçlü aday)

### 6.8 Kasa (`/panel/kasa`)

**Yönetici**

- Bir ödemeye bağlı satırda çip: "Sütaş ödemesi" → tedarikçi sayfası.
- İşlenmemiş ve adı eşleşen Teslim satırında: "Tedarikçiye ödeme mi? · **Hesaba işle**". Ödeme ekle penceresi Kasadan ve bu satırla açılır.
- Fişsiz Alışveriş satırında (`docType = 'yok'`; grubun o gün açık kalemi varsa): "Tedarikçi ödemesi miydi? · **Ödemeye çevir** · Ayrı alım".
- **Bağlı satırı düzeltmek:**
  - tutar ödemeye geçer; sayılmış toplamdan küçükse reddedilir;
  - gün ödemenin günü olur;
  - türü Alışveriş yapılamaz: "Ödemeye bağlı satır alışverişe çevrilemez; önce Tedarikçiler'de ödemeyi silin".
- **Bağlı satırı silmek** reddedilir: "Bu satır Sütaş'a ödemeye bağlı; ödemeyi Tedarikçiler'den silin (açtığı satırsa o da silinir)". FK ON DELETE RESTRICT da aynı şeyi korur.

**Personel:** §8.

**İki etiket** (hem personel hem yönetici):

- "Alışveriş / ödeme" → **Alışveriş**
- "Teslim" → **Teslim · ödeme**
- Kime yer tutucusu: "ör. patrona, bankaya, tedarikçiye (Sütaş)".
- Segmented'in altında ipucu: "Tedarikçinin şoförüne verilen borç ödemesi Teslim · ödeme'dir; gidere yazılmaz."
- `cashOutLabel` ve WhatsApp satırı değişmez: "Teslim (Sütaş) 2.200 ₺".

### 6.9 Aylık harcamalar ve Gelir-gider

**Aylık harcamalar:** sahibi bir borç olan kaydın rozeti "Cari · Sütaş" → tedarikçi sayfası.

- Tutar, gün ve kategori orada kilitli. `saveExpenseEntry`, `cashOutId` kuralı gibi reddeder: "Bu harcama Sütaş'ın faturasız alımından; tutarını, gününü ve kategorisini Tedarikçiler'de düzeltin".
- Silme de reddedilir: "Sütaş'ın faturasız alımının gideri; orada silin ya da 'Faturası gelecek' yapın".
- Açıklama ve not serbest.

**Gelir-gider:** §5.6'daki bilgi satırı.

### 6.10 Claude (MCP) ve Excel

**MCP `tedarikci_ozeti`** (`src/lib/mcp/answers/suppliers.ts`)

- Ek alanlar:
  - `faturasizBorc` (adet ve tutar)
  - `hesaptakiOdeme`
  - `netBakiye`
  - `sonOdemeler` (en çok 10: gün, tutar, şekil, sayıldığı kalem sayısı)
- Bakiye yeni kuralla hesaplanır.
- "Banka bağlı değil" notu şu olur: "Ödemeler panelde elle girilir; banka bağlı değil."

**MCP `odemeler`** (`tools.ts:114`, `answers/payments.ts`)

- `kaynak` girdisine `"cari"` eklenir.
- Çıktıda `tur: "cari borç"`.
- `isEstimatedDue` cari kalemleri için de vade tahminini tanır.
- Değişiklik yalnız eklemedir.

**Excel** (`workbook.ts`)

- Yeni sayfa "Cari hareketleri". Sütunlar: Tarih · Tedarikçi · Hareket · Açıklama · Borç · Ödeme · Şekil · Sayıldığı · Fatura bağı · Not.
- Faturalar sayfasına "Panelde ödenen" sütunu eklenir. "Kalan borç" yeni `openBalance` ile; `route.ts` artık `outstanding` haritası yerine faturanın kendisini geçirir.

---

## 7. Veri ve eylemler

### 7.1 Şema ve migration

`npm run db:generate -- --name cari_hareket` (bugün `drizzle/0036_cari_hareket.sql`). CHECK'ler şemada `check()` ile tanımlanır; repo bunu zaten yapıyor (ör. `schema.ts:186`). Elle eklenen SQL yok, `INSERT` yok: yeni kategori açılmıyor.

```ts
// src/server/db/schema.ts (yeni)
export const supplierEntries = pgTable(
  "supplier_entries",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["borc", "odeme"] }).notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    amount: doublePrecision("amount").notNull(),
    description: text("description"),
    note: text("note"),
    // borç
    costMode: text("cost_mode", { enum: ["fatura", "gider", "mevcut", "devir"] }),
    categoryId: integer("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
    dueDate: text("due_date"),
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    linkPrev: jsonb("link_prev").$type<LinkPrev>(),
    remindAfter: text("remind_after"),
    dismissedInvoiceIds: jsonb("dismissed_invoice_ids").$type<number[]>().notNull().default([]),
    // ödeme
    method: text("method", { enum: ["kasa", "elden", "havale", "kart", "cek", "diger"] }),
    cashOutId: integer("cash_out_id").references(() => cashOuts.id, { onDelete: "restrict" }),
    cashOutCreated: boolean("cash_out_created").notNull().default(false),
    // ortak
    photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("supplier_entries_supplier_idx").on(t.supplierId, t.date),
    index("supplier_entries_invoice_idx").on(t.invoiceId),
    uniqueIndex("supplier_entries_cash_out_uq").on(t.cashOutId),
    uniqueIndex("supplier_entries_photo_uq").on(t.photoId),
    check("supplier_entries_amount_ck", sql`${t.amount} > 0`),
    check(
      "supplier_entries_kind_ck",
      sql`(${t.kind} = 'borc' and ${t.costMode} is not null and ${t.method} is null and ${t.cashOutId} is null)
       or (${t.kind} = 'odeme' and ${t.method} is not null and ${t.costMode} is null and ${t.invoiceId} is null
           and ${t.dueDate} is null and ${t.categoryId} is null)`,
    ),
    check("supplier_entries_kasa_ck", sql`${t.kind} <> 'odeme' or ((${t.method} = 'kasa') = (${t.cashOutId} is not null))`),
    check("supplier_entries_gider_ck", sql`${t.costMode} is distinct from 'gider' or ${t.categoryId} is not null`),
  ],
);

export const supplierAllocations = pgTable(
  "supplier_allocations",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id").notNull().references(() => supplierEntries.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
    debtId: integer("debt_id").references(() => supplierEntries.id, { onDelete: "cascade" }),
    originDebtId: integer("origin_debt_id").references(() => supplierEntries.id, { onDelete: "set null" }),
    amount: doublePrecision("amount").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("supplier_allocations_payment_idx").on(t.paymentId),
    index("supplier_allocations_invoice_idx").on(t.invoiceId),
    index("supplier_allocations_debt_idx").on(t.debtId),
    check("supplier_allocations_amount_ck", sql`${t.amount} > 0`),
    check("supplier_allocations_target_ck", sql`num_nonnulls(${t.invoiceId}, ${t.debtId}) = 1`),
  ],
);
```

**Var olan tablolara eklenenler:**

- `invoices`:
  - `allocated: doublePrecision("allocated").notNull().default(0)`
  - `ledgerBase: doublePrecision("ledger_base")`
  - `paidByLedger: boolean("paid_by_ledger").notNull().default(false)`
- `expense_entries`:
  - `supplierEntryId: integer("supplier_entry_id").references(() => supplierEntries.id, { onDelete: "set null" })`
  - `uniqueIndex("expense_entries_supplier_entry_uq")`
- `cash_outs`: değişmez. Kasadan ödeme Teslim türünde satırdır.
- Yeni `integration_state` anahtarı: `cari.kasa-ayri`. Ayrı tutulan Kasa satırı kimlikleri, en çok 2000; yedeğe girer.

**Neden tek bir saklanan toplam var (K12):** `supplier_entries` dağıtım toplamını saklamaz. `invoices.allocated`'ı yalnız `settle.ts` yazar. Tedarikçi sayfasının yükleyicisi, grubun faturaları için `SUM(supplier_allocations.amount) GROUP BY invoice_id` ile `allocated`'ı karşılaştırır. Tutmazsa şerit ve **Düzelt** çıkar (`fixAllocatedDrift`).

**Mevcut faturalar** `allocated = 0` ve `ledger_base = null` ile kalır. Bakiye bugünküyle aynıdır.

### 7.2 Saf modüller (`src/lib/cari/`; istemci ve sunucu birlikte kullanır)

| Dosya | İçerik |
|---|---|
| `balance.ts` | `openBalance`, `isPartiallyPaid`, `coveredByAllocations`, `round2`, `EPS`, `paidViaOf(method)`, `METHOD_LABEL` |
| `account.ts` | Türler (`CariDebt`, `CariPayment`, `CariAllocation`, `OpenItem`) · `debtRemaining` · `paymentCredit` · `accountOf` (`SupplierSummary`'nin üst kümesi; `summarize` buna sarılır) · `netCredit` · `allocateFifo(items, amount)` · `validateManual(lines, items, amount)` · `allocationPreview(plan)` (önizleme metni) · `paymentEvents` |
| `statement.ts` | `statementRows(account, range)` (§4.8; devreden bakiye) · `statementText(...)` (Ekstreyi kopyala) |
| `match.ts` | `linkCandidates(debts, invoices)`: güçlü ve zayıf adaylar (§7.2.1) · `kasaMatches(lines, groups, opts)` (§7.2.2) · `expenseDuplicates` (§3.1.6) · `defaultCostMode(group, today)` (K8) |
| `months.ts` | `pastMonthEffects(changes, today)` · `linkPreview(debts, invoice, categories)` (§5.2 metni) |
| `src/lib/unreachable.ts` | `export function unreachable(x: never): never` |

#### 7.2.1 Fatura adayları

Adaylar şu kurallarla aranır:

- **Faturalar:** grubun faturaları; P > 0; kategori Komisyon değil ve `SEPARATE_CATEGORIES`'te değil; henüz bir borç bağlanmamış.
- **Borçlar:** grubun bağsız borçları; kip `fatura`, `gider` ya da `mevcut`.
- **Pencere:** faturanın günü, borcun gününden 7 gün önce ile 45 gün sonra arasında olmalı.
- **"Ayrı alım" denmiş çiftler atlanır:** borcun `dismissed_invoice_ids` listesinde o fatura varsa.

| Aday | Kural |
|---|---|
| Güçlü (a) | Tek bir borç ile fatura arasında \|A − P\| ≤ max(1, 0,02 · P) |
| Güçlü (b) | Penceredeki en az iki borcun toplamı için \|ΣA − P\| ≤ max(1, 0,02 · P). Alt küme aranmaz; penceredeki bütün borçlar alınır. |
| Zayıf | Pencerede bağsız bir `fatura` borcu var, ama güçlü kural tutmuyor |

#### 7.2.2 Kasa eşleşmesi

**Eşleşme:** `supplierMatchKey(line.store)` grubun anahtarlarından biri olan satır.

**İşlenmemiş satır:** `supplier_entries.cash_out_id` olarak hiçbir kayda bağlı değil ve `cari.kasa-ayri` listesinde değil.

| Nerede kullanılır | Hangi satırlar |
|---|---|
| Borç ekle (K15) | Alım gününün ±3 günü; Teslim ve Alışveriş |
| Kalem ipucu (K16) | Kalemin gününden sonra, son 60 gün; Teslim ya da `doc_type = 'yok'` Alışveriş |
| Liste şeridi ve zil | Son 60 gün; Teslim satırları ve fişsiz Alışveriş satırları (fişsiz olanlar yalnız grubun o gün açık kalemi varsa) |

### 7.3 Sunucu modülleri (`server-only`, `"use server"` değil)

**`src/server/cari/settle.ts`**: dağıtım ve ödeme durumu yazan tek yer.

- `lockCard(tx, cardId)`: kart satırını kilitler (K24).
- `ensureCard(tx, group)`: kartsız gruba kart açar; `nameMoves` engeli burada.
- `startTracking(tx, cardId, groupInvoiceIds)`: `ledger_base` (§4.2).
- `writeAllocations(tx, paymentId, lines)`
- `recomputeAllocated(tx, invoiceIds)`: SUM ile.
- `resettle(tx, invoiceIds)`
- `creditFirst(tx, cardId, invoiceIds)`
- `releaseInvoiceLinks(tx, invoiceId)`: dönen değer `{ allocations, debtIds }`.
- `reattachInvoiceLinks(tx, invoiceId, links)`
- `trimToFit(tx, invoiceIds)`: payable düştüyse en yeni dağıtımdan kırpar.
- `resettleAfterSync(invoiceIds)`: her kart için ayrı işlem, Sistem kaydı.
- `applyCreditOnArrival(invoiceIds)`: K21.

**`src/server/data/cari.ts`**

- `loadCariIndex()`: tek okuma. Döndürdükleri:
  - kartlar ve referanslar → `resolveCard(supplier, tax)`
  - vade günü (`loadTermDays`'in yerini alır, aynı sonucu verir)
  - takipli kartlar
  - kart başına hesaptaki para
  - açık borçlar
  - güçlü adaylar
  - işlenmemiş Kasa satırları
- `loadSupplierAccount(group)`: sayfa; kayıtlar, dağıtımlar, sapma denetimi.
- `loadExpectedDebts(month)`: Gelir-gider.
- `loadExpectedDebtsByCard()`: nakit planı.

**`src/server/data/suppliers.ts`**

- `LEDGER_COLUMNS` içine `allocated`, `ledgerBase` ve `paidByLedger` eklenir.
- `loadSupplierLedger` kayıtları da okur ve `groupSuppliers` sonucuna `account` ekler.

**`src/server/notify/digest.ts` `loadUpcoming`**

- `loadCariIndex()` kullanır.
- Fatura sorgusuna `allocated` ve `ledgerBase` eklenir.
- Kalemlere `supplierId`, `quiet` ve `hint` eklenir. `UpcomingItem`'a eklenen isteğe bağlı alanlar: `supplierId?`, `credited?`, `quiet?: "link" | "kasa"`, `hint?: { text, href }`.
- Cari kalemleri `cariItem()` ile kurulur.
- `netCredit` uygulanır.
- Dönen değer: `{ …, items, laterInvoices, covered, cari: { debts, debtTotal, credit, kasaPending } }`. `laterInvoiceItems` takvim için cari kalemleri de verir.

**`src/lib/reminders.ts`**

- `UnpaidInvoiceRow`'a `allocated?` ve `ledgerBase?` eklenir.
- `invoiceItem` tutarı `openBalance`'tan alır.
- `UpcomingItem.source` `"cari"` alır.

**`src/lib/recent-paid.ts`**

- `kind: "invoice" | "reminder" | "cari"`.
- Fatura kaydında isteğe bağlı `allocationIds?: number[]`.
- `parseRecentPaid` yeni türü kabul eder.
- `liveRecentPaid` cari kayıtları ödeme hâlâ varsa canlı sayar.

### 7.4 Yeni eylemler (`src/server/actions/cari.ts`, `"use server"`)

**Genel kurallar:**

- Her `export` `const me = await requireAdmin()` ile başlar.
- Sonra Zod ile ayrıştırır, işi `attempt` içinde yapar.
- Dosyada yardımcı `export` yoktur; saf mantık `src/lib/cari`'de, yazım `src/server/cari/settle.ts`'te.
- Her para eylemi tek bir işlemdir: önce kart kilidi, sonra hedefler kimlik sırasıyla, sonra yeniden denetim, yazım, `recomputeAllocated` ve `resettle`.
- İşlemden sonra sırasıyla: `rememberPaid` / `forgetPaid`, `logActivity`, `refresh()`.

| Eylem | Ne yapar |
|---|---|
| `saveSupplierDebt(input)` | Borç ekler ya da düzeltir. Girdiler: hedef `{cardId}` ya da `{key}`, `id?`, gün, tutar, açıklama, `costMode`, `categoryId?`, `adoptExpenseId?`, `dueDate?`, not, `photoId?`, `applyCredit`, `paid?: { method, date, cashOutId? }`, `kasaChoice?`, `confirmPast?`. Bir sonraki adım gerekiyorsa `{ needs: "kasa" \| "past", … }` döner. |
| `saveSupplierPayment(input)` | Ödeme ekler ya da düzeltir. Girdiler: hedef, `id?`, gün, tutar, yöntem, `cashOut?: { mode: "existing", id } \| { mode: "new" }`, `allocation: { mode: "auto" \| "manual" \| "none", lines? }`, not, `photoId?`, `confirmPast?`. Dönen değer `{ id, closed, partial, credit, preview }`. |
| `deleteSupplierEntry(id)` | Siler (§3.4). Geri alma için kopya döner: kayıt, dağıtımlar, gider kaydının alanları, açtığı Kasa satırının alanları ve fatura işaretleri. |
| `restoreSupplierEntry(snapshot)` | Kopyayı yeniden doğrular (R4b) ve kaydı aynı kimlikle geri yazar. Sığmayan dağıtım hesapta kalır. Açtığı Kasa satırı varsa o da aynı kimlikle geri gelir; kopyada `restoreId`, Kasa'nın deseni. |
| `applySupplierCredit({ supplierId })` | Borçlara say: hesaptaki parayı en eski vadeden dağıtır. |
| `setPaymentAllocation({ paymentId, mode, lines })` | Neye sayıldı: dağıtımı baştan yazar. |
| `removeAllocation({ allocationId })` | Ödemeden çıkar. |
| `linkDebtsToInvoice({ debtIds, invoiceId, addAlias, confirmPast })` | Faturası geldi (§5.2). |
| `unlinkDebt({ debtId, confirmPast })` | Bağı kaldır. |
| `dismissLinkCandidate({ debtIds, invoiceId })` | Ayrı alım: çifti borçların `dismissed_invoice_ids`'ine yazar. |
| `snoozeDebt({ debtId })` | Beklemeye devam. |
| `payDebt(debtId)` | Ödemeler'de cari kalemin "Ödendi"si (§6.5). |
| `postponeSupplierDebt(debtId, by)` · `setSupplierDebtDueDate(debtId, due)` | Ertele ve geri al. |
| `convertCashOutToPayment({ cashOutId, target, allocation, confirmPast })` | Ödemeye çevir. Satırın türü Teslim olur, gider kaydı silinir, ödeme açılır. Hepsi tek işlem. |
| `dismissCashOut({ cashOutId })` | Ayrı tut / Ayrı alım (`cari.kasa-ayri`). |
| `fixAllocatedDrift({ supplierId })` | Düzelt: grubun faturalarının toplamını yeniden yazar, sonra `resettle`. |

### 7.5 Değişen eylemler ve eşitleme

**`src/server/actions/invoices.ts`**

- `applyPayment` (`setInvoicePaid` ve `setInvoicePayment` bunu kullanır):
  - "paid" seçilince `creditFirst`; `separately: true` gelirse kullanılmaz.
  - "unpaid" ve "requested" için `assertNotCovered`.
  - Her yazımda `paid_by_ledger = false`.
  - Dönen `previous` değerine, ✓'nin yazdığı dağıtımların kimlikleri (`allocationIds`) eklenir.
- `restoreInvoicePayment(states, { allocationIds? })`: önce o dağıtımları siler, sonra `assertNotCovered`, sonra durumu yazar.
- `saveInvoice`:
  - yeni satırın kartı takipliyse `ledger_base = 0`;
  - Ödenecek tutar `ledger_base + allocated`'tan küçük olamaz;
  - `unpaid` için `assertNotCovered`;
  - ödendiye geçerken `creditFirst`.
- `deleteInvoice`:
  - işlem içinde `releaseInvoiceLinks`;
  - kopyaya `cari?: { allocations: { paymentId, amount, originDebtId }[]; debtIds }` eklenir; eski kopyada bu alan yoktur ve sorun değildir.
- `restoreInvoice`: yeni kimlikle yazar, sonra `reattachInvoiceLinks`. Borç hâlâ bağsızsa yeniden bağlanır; ödemenin hesabında yer varsa dağıtım yeniden yazılır, yoksa para hesapta kalır.
- `unignoreParasutBill`: bağları geri getirmez. Bildirim: "Ödemeler bu faturaya yeniden sayılmadı; Tedarikçiler'den Borçlara say".

**`src/server/actions/reminders.ts`**

- `undoRecentPaid`:
  - tür `z.enum(["invoice", "reminder", "cari"])`;
  - `invoice` için önce `allocationIds`, sonra `assertNotCovered`;
  - `cari` için `deleteSupplierEntry` mantığı.

**`src/server/actions/suppliers.ts`**

- `removeSupplier`:
  - kayıtlı kart silinmez, gizlenir;
  - açık borcu ya da hesapta parası olan kart engellenir (K23);
  - kartsız grubun kaydı olamaz (K2).
- `saveSupplier` (ad ve diğer adlar):
  - Değişiklikten sonra grubu yeniden çözer.
  - Ödemesi sayılmış bir fatura (`allocated > 0`) gruptan çıkıyorsa ya da gruptan çıkan faturaya borç bağlıysa reddeder: "‘SÜTAŞ A.Ş.’ adıyla 2 faturaya bu tedarikçinin ödemesi sayılmış; adı kaldırmak onları başka tedarikçiye taşır. Önce ödemeden çıkarın."
- `importSupplierHistory`: karttaki en eski devir borcunun gününden eski faturalar gelebilecekse `confirmDevir` ister: "Sütaş'ta 01.10.2026 tarihli eski borç (devir) var. Bu tarihten eski faturalar alınırsa borç iki kez sayılır. Yine de alınsın mı?"

**`src/app/panel/tedarikciler/logic.ts`**

- `isHiddenSupplier(card, summary, account)`: açık kalem, hesapta para ya da `hiddenOn`'dan sonra tarihli kayıt varsa `false` döner.

**`src/server/actions/cash-outs.ts`**

- `persist` ve `deleteCashOut` önce satırın bir kayda bağlı olup olmadığına bakar.
- Bağlıysa personel için: "Bu satır yöneticinin kaydına bağlı; düzeltmek için yöneticiye haber verin." Tutar söylenmez.
- Yönetici için §6.8'deki kurallar; tutar ve gün değişikliği ödemeye aynı işlemde geçer.
- Personel ödeme ya da dağıtım alanı gönderemez. Şema bu alanları tanımaz.

**`src/server/actions/expenses.ts`**

- `saveExpenseEntry` ve `deleteExpenseEntry`: sahibi bir borç olan kayıtta §6.9'daki engeller.

**`src/server/parasut/sync.ts`**

- **Yeni fatura:**
  - kartı takipliyse `ledger_base = 0`.
  - Peşin ve takipliyse kimlik `ctx.pesinTracked`'e yazılır; çalışmanın sonunda `applyCreditOnArrival` (K21).
- **Var olan satır güncellenirken** `match.payable !== d.payable` ise kimlik `ctx.payableChanged`'a yazılır; çalışmanın sonunda `resettleAfterSync` (K20).
- **`retire` (`origin === "parasut"` dalı) ve e-fatura silme (`~1246`):** silmeden önce aynı işlemde `releaseInvoiceLinks`. Satırın dağıtımı ya da bağlı borcu yoksa ek iş yok.
- Son adımlar `syncParasut` ve `syncSupplierHistory` içinde, `matchSupplierOrders`'ın yanında koşar. Özet satırı: "Cari: 1 faturada ödeme hesaba geçti, 1 peşin faturaya hesaptaki ödeme sayıldı".
- `findExisting`, `common` ve `newInvoicePayment` değişmez.

**Kaynak dallarının tamamı** (K25): her biri `switch (item.source)` olur ve sonu `unreachable` ile kapanır.

| Dosya | Satırlar |
|---|---|
| `payment-ui.tsx` | 137, 194, 223, 519, 533, 536 |
| `reminders-client.tsx` | 50 (`SOURCE_OF`), 122, 136, 140, 147, 186, 197 |
| `calendar-entries.ts` | 38, 43 |
| `dashboard-payments.tsx` | 70 |
| `lib/cash-plan.ts` | 502 |
| `server/data/cash-plan.ts` | 63 |
| `lib/mcp/answers/payments.ts` | 46, 55, 99 |
| `actions/reminders.ts` | 235 |
| `lib/recent-paid.ts` | 54, 111 |

### 7.6 Kilit ve eşzamanlılık

- **Kart kilidi:** her cari işlem önce `SELECT … FROM suppliers WHERE id = $1 FOR UPDATE` alır. Kart kimliği değişmez; aynı kartın iki ödemesi sırayla çalışır.
- **Hedef kilidi:** hedef faturalar ve borçlar kimlik sırasıyla `FOR UPDATE` alınır. Kalan, kilit altında yeniden hesaplanır; istemcinin önizlemesine güvenilmez.
- **İki kartlı işlem:** bağlamada fatura başka bir kartın grubundaysa her iki kart kimlik sırasıyla kilitlenir.
- **Eşitleme son adımları:** her kart için ayrı kısa işlem, aynı sırayla.

### 7.7 Geri al

- **Bildirimdeki "Geri al":** her ekleme, düzeltme, dağıtım, bağlama ve çevirme 8 saniye boyunca geri alınabilir. Evdeki süre `payment-ui.tsx`'te 8000 ms.
- **Ekleme ve silme:** geri almada kopya döner; `restoreSupplierEntry` onu yeniden doğrular (R4b).
- **Düzeltme ve dağıtım:** önceki dağıtım kümesi döner; `setPaymentAllocation` onu geri yazar.
- **Bağlama:** `unlinkDebt` geri alır.
- **Ödemeye çevir:** geri al, `deleteSupplierEntry`'yi çağırır ve Kasa satırını eski hâline döndürür. Kasa satırının eski türü ve gider kaydının alanları kopyadadır.
- **Son ödenenler:** cari ödemeleri ve ✓ ile hesaptaki paranın kullanıldığı faturaları 30 gün tutar (§6.5).

### 7.8 İşlem geçmişi (`logActivity`)

| Kayıt | Ayrıntı örneği |
|---|---|
| Cari borç eklendi | Sütaş · 20.10.2026 · 1.250,00 ₺ · faturası gelecek |
| Cari borç eklendi | Sütaş · 21.10.2026 · 600,00 ₺ · faturası yok · Nakit malzeme alımı'na yazıldı |
| Cari borç düzeltildi / silindi | Sütaş · 21.10.2026 · 600,00 → 650,00 ₺ |
| Cari ödeme eklendi | Sütaş · 22.10.2026 · 10.000,00 ₺ · Havale / EFT · 2 kaleme sayıldı (1 kapandı, 1 kısmen) · hesapta 0,00 ₺ |
| Cari ödeme eklendi | Sütaş · 24.10.2026 · 2.200,00 ₺ · Kasadan (Teslim · Sütaş) · 3 kalem kapandı · hesapta 99,50 ₺ |
| Cari ödeme düzeltildi / silindi | … · 1 fatura yeniden ödenmedi; 1 fatura başka biçimde ödendi işaretli, bırakıldı |
| Cari kaydı geri alındı | … |
| Hesaptaki ödeme borçlara sayıldı | Sütaş · 99,50 ₺ → SUT151 |
| Ödeme kalemden çıkarıldı | Sütaş · 24.10 ödemesi · SUT151 99,50 ₺ hesaba geçti |
| Faturasız alım faturaya bağlandı | Sütaş · 1 alım (1.250,00 ₺) → SUT149 (1.250,00 ₺) · fark 0,00 ₺ |
| Faturaya bağ kaldırıldı | Sütaş · SUT149 ← 20.10 süt · gider kaydı yeniden yazıldı |
| Kasadan çıkan ödemeye çevrildi | 24.10 · Sütaş · 2.200,00 ₺ · gider kaydı silindi (Ekim · Nakit malzeme alımı) |
| Kasa satırı ayrı tutuldu | 24.10 · Teslim · Sütaş |
| Faturası gelmeyen alım gidere yazıldı / Beklemeye alındı | Sütaş · 20.10 süt · 1.250,00 ₺ |
| Fatura ödendi (var olan) | … · hesaptaki 99,50 ₺ sayıldı |
| Sistem · Peşin faturaya hesaptaki ödeme sayıldı | Sütaş · SUT160 · 400,00 ₺ |
| Sistem · Fatura tutarı değişti | SUT140 3.000,00 → 2.950,00 ₺ · 50,00 ₺ hesaba geçti |
| Sistem · Paraşüt'te silinen fatura | SUT149 · 1.250,00 ₺ ödeme borca döndü · 20.10 süt yeniden açık |

Geçmiş ay etkilenirse ayrıntının sonuna " · geçmiş ay değişti: Eylül 2026" eklenir.

### 7.9 Yedek, geri yükleme, db:reset

- **Yedek:** yeni tablolar kendiliğinden yedeğe girer; `core.ts` tabloları `information_schema`'dan okur. Yedek tek bir REPEATABLE READ işlemidir (`core.ts:139`). `cari.kasa-ayri` anahtarı `integration_state` ile birlikte gider; hariç tutulan anahtar değil. `format.ts`'teki `TABLE_RULES`'a ekleme gerekmez.
- **Geri yükleme:** `orderTables` yabancı anahtar sırasıyla yazar. Döngü yoktur:
  - `supplier_entries` şunlara bakar: `suppliers`, `invoices`, `cash_outs`, `photos`, `users`, `expense_categories`.
  - `supplier_allocations` şunlara bakar: `supplier_entries`, `invoices`.
  - `expense_entries` şunlara bakar: `supplier_entries`, `cash_outs`.
  - Satırlar sütun değerleriyle yazıldığı için `allocated` doğru gelir.
  - Mevcut yedek ve geri yükleme testine (`yedek-geri-yukleme.test.ts`) iki kayıt ve bir dağıtım eklenir.
- **db:reset** (`scripts/seed.ts`): TRUNCATE'ten önce `select count(*) from supplier_entries` çalışır. Sıfır değilse ve `--cari-sil` verilmemişse durur: "Cari hareketleri var (N kayıt). db:reset onları siler, Kasa satırları kalır ve faturalar ödenmemiş geri gelir. Yedek alındı: <dosya>. Yine de silmek için: npm run db:reset -- --cari-sil". Bayrak verilirse TRUNCATE listesine `supplier_allocations` ve `supplier_entries` eklenir, `cari.kasa-ayri` silinir. `docs/YEDEK.md` güncellenir.

### 7.10 Belgeler

- `docs/TEDARIKCILER.md`: yeni "Hesap hareketleri: elle borç ve ödeme" bölümü.
  - "Paraşüt eşitlemesi ödeme durumuna dokunmaz" bölümüne üç istisna: peşin kartta hesaptaki para, tutar değişince yeniden dengeleme, iptalde bağların çözülmesi.
  - "Ödeme durumu" tablosuna "Hesaptaki ödemeden sayıldı".
  - "Bu ay ödenen" ve "Son ödeme"nin yeni anlamı: bu rakamlar değişecek.
- `docs/NAKIT-PLANI.md`: cari kalemleri, mahsup, mal tahmininin düşürülmesi.
- `docs/KASA-RAPORU.md` › "Gün içinde kasadan çıkanlar": Teslim · ödeme, ödemeye bağlı satır, Ödemeye çevir.
- `docs/BILDIRIMLER.md`: Son ödenenler'de `cari`, zil, e-postadaki sessiz kalemler.
- `docs/PARASUT.md`: eşitlemenin son adımları, takipli fatura.
- `docs/CLAUDE-BAGLANTISI.md`: yeni MCP alanları.
- `docs/YEDEK.md`: db:reset engeli.
- `docs/MAL-SIPARISI.md` §7: "Fatura yok" ile kapanan sipariş hâlâ para yazmaz; borcu Tedarikçiler › Borç ekle'den girin.
- `docs/planlar/KALAN-ISLER.md`: v2 maddeleri (§8, §1 kapsam dışı).

### 7.11 Commit sırası (tek PR, her adım yeşil)

1. **Çekirdek**
   - şema ve migration
   - `src/lib/cari/*` ve `unreachable`
   - `settle.ts` ve `data/cari.ts`
   - `openBalance`'ın taşınması ve okuyucuların yeni sütunları seçmesi
   - mevcut eylemlerin korumaları: `assertNotCovered`, silmede bağların çözülmesi, eşitleme son adımları, db:reset
   - sabit testleri
2. **Tedarikçi sayfası:** eylemler, pencereler, ekstre, kartlar, şeritler, Ödeme durumu ve Ödeme talebi.
3. **Okuyucular:** `loadUpcoming`, Ödemeler, Son ödenenler, plan, zil, e-posta, Bugün, Genel bakış, MCP, Excel, Gelir-gider, Faturalar. Tam `switch`'ler.
4. **Kasa bağları:** yönetici ipuçları, Ödemeye çevir, Kasa denetimi, personel kilidi, etiketler ve ipucu. Ardından belgeler.

---

## 8. Personel

**Karar:** v1'de personel için yeni bir akış yok. Para ile ilgili her şey yöneticidedir:

- tedarikçi sayfaları ve ekstre;
- bakiyeler;
- borç ve ödeme eklemek, düzeltmek, dağıtmak;
- bağlama;
- Ödemeye çevir;
- MCP.

Bunların hepsi `requireAdmin` ile korunur. Personel hiçbir bakiyeyi, borcu, ödemeyi ya da fatura tutarını görmez.

**Personelin gördüğü tek değişiklik:** Kasa › "Gün içinde çıkan" penceresi.

1. **Etiketler:**
   - "Alışveriş / ödeme" → **Alışveriş**
   - "Teslim" → **Teslim · ödeme**
   - Kime yer tutucusu "ör. patrona, bankaya, tedarikçiye (Sütaş)".
   - İpucu: "Tedarikçinin şoförüne verilen borç ödemesi Teslim · ödeme'dir; gidere yazılmaz."
2. **Ad ipucu** (R1c, R9d):
   - Personele `supplierNames: string[]` gider: kartların adları ve diğer adları. Yalnız adlar; tutar, borç ya da fatura yok. Borca göre süzülmez.
   - Şu üç koşulda ipucu çıkar: tür Alışveriş, belge "yok", Yer alanı listedeki bir adla eşleşiyor (`supplierMatchKey`).
   - İpucu: "Sütaş tedarikçimiz. Borç ödemesiyse 'Teslim · ödeme' seçin; alışverişse böyle kalsın." Yanında **Teslim · ödeme'ye çevir** düğmesi.
3. **Kilit** (R9a): yöneticinin bir ödemeye bağladığı satırı personel düzeltemez ve silemez. Mesaj sabittir, tutar içermez: "Bu satır yöneticinin kaydına bağlı; düzeltmek için yöneticiye haber verin." Satırda küçük bir kilit simgesi çıkar.
4. **Veri** (R9b): Kasa sayfasında personelin satır verisi beyaz listeyle kurulur. Bugün yalnız `categoryName` siliniyor (`kasa/page.tsx:135`). Beyaz listedeki alanlar:
   - `id`, `date`, `kind`, `amount`, `store`, `description`
   - `receiptDate`, `receiptNo`, `vat`, `docType`
   - `photo`, `createdByName`
   - `categoryId` / `categoryName` (bugünkü kural)
   - `locked: boolean`

   Ödeme bağı, tedarikçi kimliği ve dağıtımlar personele gitmez.
5. **Satır metni** (R9c): yöneticinin ödemesinin açtığı satırda yalnız Kime (tedarikçi adı) ve tutar bulunur; açıklama yazılmaz.

**Personel kasadan ödeme yaptığında:** **Teslim · ödeme** girer. Satır gider yazmaz ve akşam kasasına hemen girer (`cash-report.ts:83`). Yönetici satırı şuradan ödemeye bağlar: Tedarikçiler şeridi, zil ya da Kasa'daki "Hesaba işle".

**v2 (bu planın dışında, Dalga 10'dan sonra):** Kasa'da "Tedarikçiye ödeme" türü.

- ad listesinden seçici ve "Listede yok" serbest metni;
- yönetici onayına kadar "onay bekliyor";
- `/panel/onaylar`'da "Kasadan ödemeler" sekmesi;
- personelin "Veresiye aldık" önerisi.

Veri modeli bunu kaldırır: `status` sütunu eklenir, başka hiçbir şey değişmez.

---

## 9. Testler

Testler node:test ile koşar: `npm test` = `tsx --test tests/*.test.ts`. Veritabanı testi kendi geçici veritabanını açar; desen `parasut-esitleme-db.test.ts`.

### 9.1 Yeni test dosyaları

| Dosya | Ne sınar |
|---|---|
| `tests/cari-bakiye.test.ts` | `openBalance`: `ledgerBase` boşken bugünkü fonksiyonla aynı sonucu verir. Örnek seti: `insights.test.ts` ve `tedarikciler.test.ts` örnekleri + 500 rastgele. Takipli kural; iade; tolerans; `isPartiallyPaid`; `coveredByAllocations`; `paidViaOf`. |
| `tests/cari-hesap.test.ts` | `allocateFifo` sırası (vade, gün, önce fatura, kimlik); `validateManual` mesajları; hesapta kalan; önizleme metni (§3.2 aynen). `accountOf` kimliği: rastgele örneklerde (tohumlu) ekstrenin son satırı = open − credit. `netCredit`: tam, kısmi, `quiet` atlanır. `paymentEvents` ve Bu ay ödenen: defterin kapattığı fatura 0 katar. **§4.9'un bütün rakamları:** 10.250,50 → 11.500,50 → 12.100,50 → 2.100,50 → 2.100,50 → −99,50 → 1.150,50 → −99,50 → 3.000,50; Ekim'de ödenen 16.200,00; ekstre tablosu satır satır. |
| `tests/cari-ekstre.test.ts` | `statementRows`: örtük satırlar, sıra, devreden bakiye, gri bağlı borç. `statementText` biçimi. |
| `tests/cari-eslesme.test.ts` | `linkCandidates`: güçlü (a), güçlü (b) n → 1, zayıf, pencere sınırları, Ayrı alım. `kasaMatches`: ±3 gün, tutardan bağımsız (900 ile 905); ayrı tutulanlar; fişsiz harcama yalnız açık kalem varken. `expenseDuplicates`. `defaultCostMode`: 90 gün kuralı. |
| `tests/cari-ay.test.ts` | `pastMonthEffects`: bugünün ayı onay istemez, önceki ay ister. `linkPreview` metni (§5.2 aynen). |
| `tests/cari-sabit.test.ts` | **Hiç kayıt yokken bugünkü rakamlar değişmez.** Kalan borç, vadesi geçen, 7 gün (`summarize`); `upcomingItems` tutarları ve sırası; `buildCashPlan` toplamları; `paidInMonth` ile yeni Bu ay ödenen; Son ödeme; Excel Kalan borç sütunu; `unpaidSummary`; Genel bakış uyarısı. Mevcut örnek verileriyle, eski ve yeni fonksiyon yan yana. |
| `tests/cari-guvenlik.test.ts` | Kaynak taraması: `src/server/actions/cari.ts`'teki her `export async function` ilk satırda `requireAdmin()` çağırır, yardımcı `export` yoktur. `supplierAllocations` ve `invoices.allocated` / `ledgerBase` / `paidByLedger` yazımları yalnız `src/server/cari/settle.ts`'te. `source === "invoice"` ve `source !== "invoice"` karşılaştırması `switch` dışında kalmamış. Kasa sayfasının personel verisi beyaz listede: anahtar kümesi sabitlenir. |
| `tests/cari-db.test.ts` (`CARI_TEST_DATABASE_URL`) | Gerçek Postgres'te geçici veritabanı, migration uygulanır. İki eşzamanlı ödeme aynı faturayı aşırı ödemez (kart kilidi). CHECK'ler. Ödeme silinince CASCADE ve `allocated`. `releaseInvoiceLinks`: Paraşüt `retire` yolu, borç eski hâline döner, gider kaydı yeniden yazılır, para hesaba geçer. `resettleAfterSync`: tutar düşer (fazla hesaba geçer) ve artar (defterin kapattığı açılır). `applyCreditOnArrival`. `assertNotCovered`: dört yazıcı. `restoreSupplierEntry` sığmayanı hesapta bırakır. db:reset engeli. Yedek ve geri yükleme turu. |

### 9.2 Güncellenen test dosyaları

| Dosya | Değişiklik |
|---|---|
| `tedarikciler.test.ts` | `summarize` → `accountOf`; `isHiddenSupplier` yeni kurallar; Bu ay ödenen |
| `reminders.test.ts` | `invoiceItem` `openBalance` ile; `cariItem`; `dueNotifications` `quiet` atlar; cari anahtarı |
| `nakit-plani.test.ts` | cari kesin kalemler; `quiet = link` hariç; K19 düşürme; notlar |
| `recent-paid.test.ts` | `cari` türü; `allocationIds`; `liveRecentPaid` |
| `kasa-raporu.test.ts` | Teslim · ödeme etiketi; bağlı satır; `cashOutWritesExpense` Teslim için `false` |
| `aylik-harcamalar.test.ts` | sahibi borç olan kayıt kilidi ve silme engeli |
| `kdv-tahmini.test.ts` | borçlar, ödemeler ve sahip olunan kayıtlar KDV tahminini değiştirmez |
| `invoices.test.ts` | Ödenecek tutar sınırı; silmede kopya |
| `claude-araclar.test.ts` | `tedarikci_ozeti` ek alanları; `odemeler` `kaynak = "cari"`; `isEstimatedDue` |
| `export-workbook.test.ts` | "Cari hareketleri" sayfası; "Panelde ödenen" |
| `dashboard-tasks.test.ts` | `paymentFacts.debts` |
| `parasut-esitleme-db.test.ts` | takipli kartın yeni faturası `ledger_base = 0` alır; `retire` bağları çözer |
| `yedek-geri-yukleme.test.ts` | yeni tablolar tur atar |
| `migrations.test.ts` | yeni migration günlükte |

### 9.3 Komutlar

`npx tsc --noEmit`, `npm run lint`, `npm test`. Veritabanı testi için:

```
CARI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/cari-db.test.ts
```

Ardından `npm run build`.

---

## 10. Doğrulama

Uygulayıcı kendi çalışma kopyasında ve kendi yerel veritabanında doğrular. Üretim veritabanına dokunulmaz.

**1. Sabit rakamlar**

- Üretim yedeğinin yerel kopyası `npm run db:restore` ile migration'dan önce yüklenir.
- Şu rakamlar not edilir:
  - Tedarikçiler toplam Kalan borç, Vadesi geçen, Bu ay ödenen;
  - 3 tedarikçinin sayfa kartları;
  - Ödemeler sayısı ve toplamı;
  - Nakit planı 6 haftalık çıkış;
  - Genel bakış ödemeler satırı;
  - Faturalar Kalan.
- Migration uygulanır (`npm run db:migrate`). Hiç kayıt girmeden aynı rakamlar bire bir aynı çıkmalı.

**2. Örnek (yönetici, 1440 px)**

- Sütaş için §4.9'un faturaları elle kurulur, günleri bu aya kaydırılır. F3'e yerel veritabanında yalnız doğrulama için `source = origin = 'parasut'`, `external_id = 'T-140'`, `outstanding = 1800` yazılır.
- Adım adım şunlar girilir: B1, B2, ödeme, `outstanding = 250,50`, kasada Teslim · Sütaş 2.200 ve Kasadan ödeme, SUT149 (elle `parasut` olarak), Bağla, SUT151, Borçlara say.
- Her adımdan sonra şu ekranlar §4.9'daki sayılarla karşılaştırılır:
  - Tedarikçi kartları ve ekstre
  - Tedarikçiler listesi (rozetler, Bu ay ödenen)
  - Ödemeler (sessiz kalem, mahsup, karşılananlar kutusu)
  - Son ödenenler
  - Nakit planı
  - zil
  - Bugün
  - Genel bakış
  - Faturalar (Kalan, pencere)
  - Aylık harcamalar ("Cari · Sütaş", kilit)
  - Gelir-gider (Faturası beklenen alımlar 1.250 → 0; Mal alışları)
  - KDV tahmini (yalnız faturalar)
  - Kasa (çip, akşam raporunun "Gün içinde çıkan" toplamı)
  - Excel indirmesi
  - Claude `tedarikci_ozeti` ve `odemeler`
- Her eylemde "Geri al" denenir. Son ödenenler'den cari ödeme geri alınır.
- Geçmiş ay onayı: geçen aya tarihli bir "Faturası yok" borç eklenir; onay istenmeli, işlem geçmişinde "geçmiş ay değişti" görünmeli.
- Ödenmedi engeli: SUT123'te "Ödenmedi" denenir; reddedilmeli.
- İptal: SUT149 silinir; para B1'e dönmeli, B1 yeniden açık olmalı.

**3. 390 px (yönetici)**

- Aynı akış telefon ölçüsünde tekrarlanır.
- Yatay kaydırma olmamalı.
- Başlıkta iki düğme iki sütun olmalı.
- Pencereler alttan açılmalı, yapışık Kaydet görünmeli, tutar klavyesi ondalıklı açılmalı.
- Ekstre liste görünümünde olmalı; dağıtımlar okunabilir olmalı.
- Seçerek dağıtım satırları tam genişlikte olmalı.
- Şeritler sarmalı ve düğmeleri en az 44 px olmalı.
- Ödemeler'deki ipuçları taşmamalı.
- Ekran görüntüleri PR gövdesine eklenir.

**4. Personel**

- Personel hesabıyla giriş yapılır.
- `/panel/tedarikciler`, `/panel/faturalar`, `/panel/harcamalar` açılmamalı (bugünkü yönlendirme).
- Zil ve Bugün ödeme göstermemeli.
- Kasa'da:
  - iki yeni etiket ve ipucu görünmeli;
  - Yer "Sütaş", tür Alışveriş, belge yok → ipucu ve çevir düğmesi çıkmalı;
  - yöneticinin bağladığı satırda kilit ve sabit mesaj görünmeli; düzeltme ve silme reddedilmeli;
  - tarayıcının ağ sekmesinde Kasa verisinde ödeme ya da tedarikçi kimliği bulunmamalı.

**5. Komutlar:** tip denetimi, lint, testler, veritabanı testi ve `npm run build` temiz geçmeli.

---

## 11. Sahibe sorular

Varsayılanlar uygulanır; cevap farklıysa küçük bir değişiklik yeter.

1. **Kategori adı.** Faturasız (veresiye dahil) alımların gideri var olan "Nakit malzeme alımı" kategorisine yazılacak. Adı "Faturasız malzeme alımı" olarak değiştirelim mi? Personel Kasa'da da bu adı görür.
   *Varsayılan: ad değişmez.*
2. **Personelin tedarikçiye ödeme kaydı.** Personel kasadan tedarikçiye verdiği parayı tedarikçi adını listeden seçerek girsin ve siz onaylayın mı (§8 v2)?
   *Varsayılan: hayır. Personel Teslim · ödeme girer, siz Tedarikçiler'den "Hesaba işle" ile bağlarsınız.*
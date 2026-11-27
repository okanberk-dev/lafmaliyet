# Mutabakat (banka ve tedarikçi ekstresi, POS hakedişi)

Ekran: **Kâr & ödemeler › Mutabakat** (`/panel/mutabakat`, yalnız yönetici; ⌘K'da "mutabakat", "banka ekstresi", "cari
ekstre", "POS hakediş"). İki sekme:

- **Banka & tedarikçi**: bankanın hesap hareketleri ya da tedarikçinin cari ekstresi yüklenir, hareketler panel
  kayıtlarıyla eşleşir.
- **POS hakediş** (`?sekme=pos`): kasa raporlarının kart satışı (gün gün, şube şube) bankaya gelen POS parasıyla
  karşılaştırılır: beklenen net, gelen, fark, geciken.

Mutabakat bir **karşılaştırmadır**: panel kaydına (fatura, harcama, cari ödeme, kasa) hiçbir şey yazmaz; faturayı
"ödendi" yapmaz, ödeme kaydı açmaz. Eşleşme her açılışta yeniden hesaplanır: panelde bir kayıt düzeltilince ya da
eklenince ekran kendiliğinden güncellenir. Saklanan yalnız ekstrenin hareketleri ve yöneticinin kararlarıdır.

Kod: saf modüller `src/lib/mutabakat/parse.ts` (okuma), `match.ts` (eşleştirme), `pos.ts` (POS hakedişi), `view.ts`
(ekran kuralları); sunucu `src/server/mutabakat/{file,load,store}.ts`, eylemler `src/server/actions/mutabakat.ts`,
ekran `src/app/panel/mutabakat/`. Testler: `tests/mutabakat.test.ts` (saf), `tests/mutabakat-db.test.ts` (Postgres).

## Ekstre yükleme

**Ekstre yükle** penceresi: tür (Banka hesabı / Tedarikçi cari ekstresi), hesap ya da tedarikçi, dosya. Dosya seçilince
önizleme gelir: hareket sayısı, dönem (ilk ve son hareket), giren ve çıkan toplam (tedarikçide fatura ve ödeme), ilk
sekiz hareket, atlanan satırlar ve bu hesaba önceden yüklenmiş hareket sayısı. **Kaydet** dosyayı yeniden okur ve
hareketleri yazar; önizleme hiçbir şey yazmaz.

- **Biçim:** `.xlsx` (exceljs; en çok satırı olan sayfa okunur, kapak sayfası atlanır), `.csv`, `.txt`, `.tsv`. Eski
  `.xls` biçimi okunmaz: "dosyayı tablo programında açıp .xlsx olarak kaydedin ya da bankadan CSV indirin" denir. En çok 4 MB
  (Server Action sınırı 4,5 MB) ve 3.000 hareket.
- **CSV:** ayraç kendiliğinden (sekme, noktalı virgül, dikey çizgi, virgül; virgül ondalık da olabileceği için en son),
  tırnaklı hücre, UTF-8 (BOM'lu ya da değil) değilse Windows-1254 (Türk bankalarının eski dışa aktarımı).
- **Sütunlar başlıktan tanınır** (`detectColumns`): ilk 40 satırda tarih sütunu ile tutar (ya da Borç / Alacak) sütunu
  taşıyan ilk satır başlıktır; üstteki hesap bilgisi, dönem ve boş satırlar atlanır. Tanınan adlar: tarih ("İşlem
  Tarihi"; "Valör" yalnız işlem tarihi yoksa), açıklama ("Açıklama", "İşlem", "Karşı hesap", "Ünvan"…), tek tutar
  ("Tutar", "İşlem tutarı"), Borç / Alacak ("Borç", "Çıkan", "Alacak", "Giren", "Tahsilat"…), bakiye, belge no ("Dekont
  No", "Evrak No", "Fatura No", "Referans"…). Borç / Alacak varsa tek tutar sütunu kullanılmaz.
- **Elle eşleme:** sütunlar tanınmazsa (ya da yönetici "Sütunları değiştir" derse) başlık satırı ve her sütun dosyanın
  ilk 40 satırından seçilir, "Bu sütunlarla yeniden oku".
- **Sayılar:** "1.234,56", "1,234.56", "-1.234,56", "1.234,56-", "(1.234,56)", "1.234,56 TL", "₺1.234"; tek ayraçta
  ardından tam üç rakam geliyorsa binliktir ("1.234" = 1234). **Tarihler:** gün.ay.yıl ("05.11.2026", "5/11/2026
  14:32", "05-11-26"), ISO, tablo dosyasının tarih hücresi (ya da seri numarası; saatli hücre Türkiye günü). Ay/gün/yıl (ABD)
  biçimi desteklenmez.
- **İşaret:** banka: + hesaba giren, − çıkan (Borç / Alacak'ta alacak − borç); tedarikçi: + borcumuzu artıran (fatura),
  − azaltan (ödeme, iade) (borç − alacak). Bazı bankalar borcu eksi yazar: sütun yönü belirler, işaret değil. Ters
  görünüyorsa **İşareti çevir**.
- Tarihi ya da tutarı okunamayan satır (ara toplam, devir, sayfa altı) atlanır ve sayılır; tutarı 0 olan satır yazılmaz.
- **Hesap:** banka ekstresinde hesabın adı yazılır ("Garanti TL"; önceki adlar önerilir). Aynı hesabın ekstresini hep
  aynı adla yükleyin: ad sadeleştirilerek karşılaştırılır ("garanti  tl" aynı hesap). Tedarikçi ekstresinde tedarikçi
  Tedarikçiler'deki listeden seçilir (kart ya da faturalardaki adlar; `resolveSupplier`).
- **Aynı hareket ikinci kez yazılmaz:** her hareketin parmak izi (gün, tutar, sadeleşmiş açıklama, belge no, bakiye)
  hesap başına benzersizdir (`recon_lines.scope` + `fingerprint`, benzersiz indeks). Dönemler örtüşen ekstreler
  yüklenebilir: yalnız yeni hareketler yazılır, ekstrenin kartı "N hareket önceki yüklemede vardı" der. Hepsi önceden
  yazılmışsa ekstre açılmaz. Dosyada birebir aynı iki hareket (aynı gün iki eşit POS girişi) sıra numarasıyla ayrılır.

## Eşleştirme

Bir panel kaydı en çok bir harekete gider. **Havuz:** bütün banka hesapları tek havuzdur (panel kaydı hangi hesaptan
ödendiğini bilmez; aynı ödeme iki hesabın ekstresinde eşleşmesin), tedarikçi ekstreleri tedarikçi başına.

**Banka hareketinin adayları** (ekstrelerin döneminin 45 gün öncesinden sonrasına):

| Kayıt | Hangileri | Yön |
|-------|-----------|-----|
| Harcama | Aylık harcamalar'da ödeme şekli kart, havale ya da diğer; kasadan çıkan fişin kaydı ve cari borcun gider kaydı hariç | − |
| Tedarikçi ödemesi | Tedarikçiler'deki cari ödeme kaydı; havale, kart, çek, diğer (kasadan ve elden hariç). Ad: kartın adı, unvanı, hesap sahibi, diğer adları | − |
| Fatura ödemesi | "Ödendi" işaretli fatura (ödeme günüyle); nakit ödenen ve cari ödemeyle kapanan hariç (onun ödemesi cari kayıttır) | − |
| Kasadan teslim | Kasa raporundaki teslim satırı (bankaya yatırılan para; Kime'si ad) | + |

**Tedarikçi ekstresinin adayları:** grubun faturaları (Ödenecek, KDV dahil; +), "Ödendi" işaretli faturaların ödemesi
(cari ödemeyle kapanan hariç; −) ve kartın cari ödemeleri (her şekli: kasadan, elden, havale; −).

**Sıra** (`matchLines`): (0) yöneticinin kararları; (1) belge numarası (kaydın en az 5 karakterli numarası hareketin
belge no'sunda ya da açıklamasında geçiyorsa; tutar tutuyorsa eşleşti, tutmuyorsa tutarı farklı); (2) aynı tutar ve
açıklamada adın ayırt eden bir sözcüğü (en az 4 harf; "Ltd", "Gıda", "Ödeme" gibi sözcükler sayılmaz); (3) aynı tutar,
en yakın gün; (4) tutarı farklı: aynı yön, gün içinde, fark büyüğün %20'sini geçmiyor ve bankada açıklamada ad geçiyor
(tedarikçi ekstresinde bütün kayıtlar aynı tedarikçinin: ad şartı yok). Gün penceresi bankada ±5, tedarikçide ±7 gün.
Tutar 1 kuruşa kadar aynı sayılır. Giriş hiçbir zaman çıkış kaydıyla eşleşmez.

Ekranda her hareketin durumu: **Eşleşti** (dayanağıyla: elle, belge numarasından, ad ve tutardan, tutar ve günden),
**Tutarı farklı** (Fark = ekstredeki − paneldeki, mutlak tutarlarla), **Eşleşmedi**, **Yok sayıldı**, bankada **POS
hakedişi**. Süzgeç (`?durum=`) ve sayaçlar üstte. **Panelde var, ekstrede yok:** ekstrenin döneminde hiçbir harekete
gitmeyen adaylar (birden çok banka hesabı varsa öteki hesaptan ödenen kayıt da burada görünür; o hesabın ekstresi
yüklenince eşleşir).

## Kararlar

Hareketin düğmeleri (`lineActions`):

| Düğme | Ne yapar | Karar |
|-------|----------|-------|
| Eşleştir / Değiştir | Pencerede satırın yönünde, ±45 gün içinde boşta kalan kayıtlar (önce tutarı tutan, sonra günü yakın; en çok 40) | `elle` |
| Yok say | Hareket listeden düşer (masraf, virman, kişisel) | `yoksay` |
| Ayır | Kendiliğinden eşleşmeyi bırakır; POS satırında "POS değil" | `ayir` |
| POS hakedişi | Bankada eşleşmeyen giriş POS hakedişi sayılır | `pos` |
| Geri al | Kararı kaldırır, kendiliğinden eşleşmeye döner | – |

Elle seçilen kayıt satırın havuzunda olmalı, yönü tutmalı ve başka bir satıra elle bağlı olmamalı (sunucu denetler).
Elle eşleştirilen kayıt sonradan silinirse satır "Elle eşleştirilen kayıt artık yok" der. Her karar İşlem geçmişine
yazılır ("Mutabakat"). Ekstre silinince hareketleri ve kararları gider; panel kayıtları değişmez.

## POS hakediş

`src/lib/mutabakat/pos.ts` `posReconciliation`:

- **Kart satışı:** kasa raporundan, şube şube: banka gün sonu fişi yazıldıysa o (POS cihazından geçen), yoksa Z
  raporunun kart satırı (tabloda "(Z)"). Yemek kartı ve platform hakedişi burada değil, Komisyon & hakediş'te
  ([KOMISYON.md](KOMISYON.md)).
- **Beklenen net** = kart satışı × (1 − şubenin banka POS oranı; Şubeler'de, `branches.pos_rate`, varsayılan %2).
- **Valör günü** = satış günü + **bloke günü** (sekmenin altındaki "Hesap" kartında; varsayılan 1, 0–60; ayar
  `settings.mutabakatPosBlokeGunu`); cumartesi ya da pazara denk gelirse pazartesi. Resmi tatiller bilinmez: tatil
  sonrasına kayan ödeme "Geç geldi" görünür. Aynı valöre düşen günler ve şubeler tek satırdır (banka tek tutar yatırır).
- **Gelen:** banka ekstrelerinin POS hakedişi satırları, gün gün toplanır (+ hakediş; − ayrı kesilen komisyon, iade).
  POS satırı: açıklamasında POS / üye işyeri / hakediş / bloke çözüm geçen **giriş**; çıkışta yalnız POS komisyonu,
  kesintisi, iadesi. Şirket kartıyla alışveriş ("POS alışveriş", çıkış) hakediş değildir. Yönetici kararıyla değişir
  (POS hakedişi / POS değil). POS satırları banka eşleştirmesine girmez.
- **Durumlar:** Tamam (fark ≤ 1 ₺ ya da beklenenin binde 5'i), Fark var, Geç geldi (valörde gelmedi, sonraki 5 gün
  içinde beklenene eşit ve başka valöre denk gelmeyen giriş), Gecikti (ekstrenin son gününe kadar gelmedi), Ekstre
  bekleniyor (valör ekstrenin kapsadığı günlerden sonra ya da ekstrenin son günü), Beklenmeyen giriş (hiçbir valöre denk
  gelmeyen POS girişi).
- **Kapsam:** bütün banka ekstrelerinin ilk ve son hareketi arası; ondan önceki valörler karşılaştırılmaz (para
  ekstreden önce gelmiştir). Ekstre yokken son 30 günün satışı "Ekstre bekleniyor" görünür.
- Karolar: beklenen net (altında kart satışı), bankaya gelen (altında gerçekleşen kesinti oranı = 1 − gelen ÷ brüt,
  parası gelen günlerde), fark (gelen − beklenen), geciken (gün sayısı ve tutar).

## KVKK ve saklama (karar, 26 Kasım 2026)

En tutucu, geri alınabilir varsayılan seçildi:

- **Yüklenen dosya hiç saklanmaz:** yalnız sunucunun belleğinde okunur (`src/server/mutabakat/file.ts`); diske, Blob
  deposuna ya da veritabanına yazılmaz. Dosyanın yalnız adı ekstrenin kartında durur.
- **Hareketler en az veriyle:** gün, açıklama, tutar, bakiye, belge no ve dosyadaki satır numarası. Banka
  açıklamasındaki IBAN, kart numarası ve 11 hane ve üstü rakam dizisi (TCKN, hesap no) son dört hanesi kalacak biçimde
  yazılmadan örtülür (`maskSensitive`); karşı tarafın adı kalır (eşleşme ona bakar). Açıklama en çok 300 harf.
- **90 gün:** ekstre ve hareketleri yüklendiği günden 90 gün sonra günlük işte silinir (`purgeExpiredStatements`,
  `/api/cron/gunluk`; `recon_statements.expires_on`). Süre bir ay sonu kapanışı ve ertesi ayın kontrolüne yeter;
  hareketler kişi adı taşıyabilir, gerektiğinden uzun tutulmaz. Ekranda her ekstrenin "N gün sonra silinir" yazısı var.
  Daha uzun saklama gerekirse `KEEP_DAYS` (`src/lib/mutabakat/match.ts`) değişir; var olan ekstrelerin günü
  yüklemede yazıldığı için onlarınki değişmez.
- Yönetici ekstreyi istediği an silebilir. Tam yedek (Ayarlar › Yedek) hareketleri de içerir.

## Şube

Ekstre işletme genelidir ([SUBE.md](SUBE.md) › Neyi süzer): banka hesabı ve cari hesap şubeye bölünmez, eşleşme her
zaman bütün şubelerin kayıtlarıyla yapılır. POS hakedişinde kart satışı şube şube kendi oranıyla hesaplanır, "Tümü"de
valör satırı birden çok şubenin satışını gösterir.

27 Kasım 2026'dan beri (şube ayrımı parça 5, [SUBE.md › Alanlar: Vergi, Tutarlılık, Mutabakat, Stok değeri](SUBE.md#alanlar-vergi-tutarlılık-mutabakat-stok-değeri-parça-5))
şube seçiliyken ekran kişinin şube görünümüyle (Mutabakat alanı; "firma geneli" notunun yerinde görünüm çipi). Firma
geneli kipinde bugünkü gibi. **Yalnız şube** kipinde eşleşme aynıdır, gösterim ayrılır (`src/lib/mutabakat/branch.ts`):

- Hareketler: şubenin kaydıyla (harcamanın, faturanın, kasadan teslimin şubesi) eşleşenler üstte; eşleşmeyen, şubesi boş
  kayıtla (işletme geneli harcama ve fatura, cari ödeme) ve öbür şubenin kaydıyla eşleşenler **İşletme geneli** grubunda.
  Öbür şubenin kaydı adı, bağlantısı ve belge numarası olmadan "Öbür şubenin kaydı" yazar.
- "Panelde var, ekstrede yok": yalnız şubenin kayıtları; işletme geneli ve öbür şubelerinki sayı olarak.
- POS hakediş: şubenin kart satışı ve beklenen neti valör gününe göre, "Günün durumu (firma geneli)" firmanın
  karşılaştırmasından. Karolar: şubenin beklenen neti, **Bankaya gelen** (firmanın, terminal → şube eşlemesi yok),
  **Geciken** (günün durumu "Gecikti" olan şubenin valör günleri ve şubenin o günlerdeki beklenen neti) ve **Ekstre
  bekleniyor** (ekstrenin kapsamadığı şubenin beklenen neti). **Fark** (gelen − beklenen) şubeye bölünemez: yalnız firma
  kipinde ve "Tümü"de (şube ayrımı doğrulaması, 27 Kasım 2026: önceden şube kipinde firmanın farkı ve geciken tutarı
  yazıyordu, Tuzla'nın kart satışı Marina'nın ekranındaki farka giriyordu). Öbür şubenin satışı ve oranı görünmez.
- Ekstre yükleme penceresinin tedarikçileri: şube kipinde yalnız şubenin ya da işletme genelinin faturası olan
  tedarikçiler, o faturaların sayısıyla (`loadSupplierOptions(kapsam)`); öbürleri firma geneli kipinde. Pencere bunu
  yazar.
- Elle eşleştirme penceresi firmanın havuzuyla çalışır (eylem `loadRecon()`'u kapsamsız çağırır).

Şube ayrımı parça 6 ile bitti (27 Kasım 2026): ekstrenin kendisi ve bankaya gelen POS parası Hesabım'daki **Her zaman
firma geneli** listesindedir (firmanın hesabı ve parası; kayıtta `vergi.beyan` gibi `yalniz-firma`). Kalan sınır: POS
parası terminal → şube eşlemesi gelene kadar şubeye ayrılmaz; ekstre dışa aktarıma girmez (Dışa aktar'da sayfası yok).

## Şema

Migration `0091_mutabakat` (entegrasyonda numara yeniden üretilebilir):

- `recon_statements`: tür (`banka` / `tedarikci`), hesap adı, tedarikçi kartı (`supplier_card_id`, kart silinirse boş)
  ve ad anahtarları (`supplier_names`, kartsız tedarikçiyi bulmak için), dosya adı, dönem, satır ve önceden var olan
  satır sayısı, yüklendiği gün, saklamanın son günü (`expires_on`), yükleyen.
- `recon_lines`: ekstre (`ON DELETE CASCADE`), hesabın kimliği (`scope`) ve parmak izi (benzersiz), satır no, gün,
  açıklama, işaretli tutar (0 olamaz), bakiye, belge no, karar (`elle` / `yoksay` / `ayir` / `pos`), elle eşleşmede
  kaydın türü ve kimliği (yabancı anahtar değil: kayıt beş ayrı tablodan; silinince satır "artık yok" der), kararı
  veren ve anı.
- Ayar `settings.mutabakatPosBlokeGunu` (sayı; yoksa 1).

## Bilinen sınırlar

- `.xls`, PDF ve ay/gün/yıl tarihli dosya okunmaz.
- Döviz hesabı ayrılmaz: tutar hangi para birimindeyse öyle okunur; TL kayıtlarla eşleşmez.
- Resmi tatil takvimi yok (POS'ta "Geç geldi").
- Ekstre bakiyesi panelde bir bakiyeyle karşılaştırılmaz (panelde banka bakiyesi yok; Nakit planı'nın başlangıç
  bakiyesi elle).
- Yemek kartı ve platform hakedişleri banka hareketinden otomatik işaretlenmez (Komisyon & hakediş'te elle).
- Paraşüt'te kısmen ödenmiş faturanın ödemesi aday değildir: panelde yalnız kalan tutar var, ödemenin günü ve tutarı
  yok. Böyle bir hareket "Eşleşmedi" kalır; elle eşleştirilir ya da yok sayılır.
- Birden çok faturayı kapatan tek havale (toplu ödeme) tek kayıtla eşleşir: cari ödeme kaydı olarak girildiyse o kayıtla
  eşleşir, faturalara tek tek "Ödendi" denmişse tutarı farklı ya da eşleşmedi görünür.

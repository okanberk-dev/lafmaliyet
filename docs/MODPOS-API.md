# ModPOS kasa föyü (API)

Panel, kafenin bugünkü kasası ModPOS'un (Gafdigi) **kasa föyünü** API'den kendisi çeker: her kasa gününün cirosu,
ödeme yöntemleri (banka kırılımıyla), açılış ve sayım, giderler, cari tahsilatlar, ara kasalar, kasa farkı ve ModPOS'un
uyarıları. Yönetici her günün kasa raporunu föyle yan yana görür; personelin yazdığı ModPOS Z rakamı föyden farklıysa
zil ve Bugün söyler. API'nin belgesi: [modpos-kasa-foyu-api.md](modpos-kasa-foyu-api.md). Eski plan (ürün satırlı API
varsayımı): [planlar/modpos-api.md](planlar/modpos-api.md).

> **Durum (3 Kasım 2026).** Kod hazır, canlıda anahtar yok: `MODPOS_API_KEY` Vercel'e eklenince ilk föy ertesi sabah
> 08:00'de gelir. Bu oturumun ağı `api.gafdigi.com`'a izin vermediği için kafenin gerçek bir föyü henüz okunmadı;
> ayrıştırıcı kitapçığın örnek yanıtıyla ve uç durumlarla sınandı (`tests/modpos-foy.test.ts`).

## 1. Kurulum

1. Gafdigi'nin verdiği anahtarı Vercel › lafmaliyet › Settings › Environment Variables'a **yalnız Production** olarak
   `MODPOS_API_KEY` adıyla ekleyin ve yeniden yayınlayın (önizlemeler canlının veritabanını paylaşır, çekmez).
   Anahtar depoya, belgeye ya da sohbete yazılmaz.
2. Anahtara **IP kısıtı koydurmayın**: Vercel işlevlerinin sabit çıkış IP'si yok (`403 IP_IZINSIZ`).
3. Ayarlar › **ModPOS (kasa föyü)** kartı "Henüz çekilmedi" der. İsterseniz **Bu günü çek** ile dünü hemen alın
   (günün 2 hakkından birini kullanır); yoksa ertesi sabah kendiliğinden gelir.
4. İsteğe bağlı ortam değişkenleri: `MODPOS_SYNC_FROM` (ModPOS'un ilk ciro günü, `YYYY-MM-DD`: geçmiş tam bu günden
   ileriye çekilir, öncesi hiç çekilmez; yoksa geçmiş `2026-07-01`'den başlar ve ilk ciro günü kendiliğinden bulunur,
   §2), `MODPOS_API_URL` (ucun adresi; yoksa belgedeki adres).

## 2. Kota ve çekme sırası

API her anahtara **günde 2 başarılı istek** verir (Türkiye saatiyle gece yarısı yenilenir; 400 / 401 / 403 hakkı
düşürmez, 500'de hak geri verilir). Bir istek tek bir kasa günüdür. Bu yüzden:

- **Sabah işi** (08:00–09:00, `/api/cron/gunluk`, yeni cron yok) sırayla (src/lib/modpos/plan.ts; sahibin kuralı,
  3 Kasım 2026: her sabah önce dün, öteki hak geçmişe, ModPOS'un ilk ciro gününden başlayıp bitene kadar):
  1. **dünün föyü** (kasa günü 07:00'den sonra kesinleşir; sabah işi bu saatten sonradır);
  2. **henüz çekilmemiş bir eski gün**, ModPOS'un **ilk ciro gününden ileriye**, eskiden yeniye (geçmiş ilk günden
     bugüne doğru dolar). İlk ciro günü (`historyStart`, src/server/modpos/store.ts `loadModposHistoryStart`):
     `MODPOS_SYNC_FROM` kuruluysa o; yoksa Satışlar'daki ilk cirolu ayın açık gün sayısına göre en geç açılış günü
     (Temmuz 2026: 23 açık gün → **9 Temmuz**); ondan önce satışlı (kasası açılmış ya da föysüz satışlı) bir föy
     saklandıysa o gün. Geçmişin ilk günüyle ilk ciro günü arasındaki günler (1–8 Temmuz: büyük olasılıkla kasa
     açılmamış) **en sona** kalır, yine eskiden yeniye: hiçbir gün atlanmaz, arada kapalı gün yüzünden tahmin geç
     kaldıysa o günler de gelir. Ayarlar kartı ilk ciro gününü, nereden bilindiğini ve sıradaki günü yazar;
  3. eksik gün kalmadıysa son 14 günün kesin olmayan föyleri (gün açıkken ya da 07:00'den önce elle alınanlar);
  4. hiçbiri yoksa son 7 günün en eski kontrol edilen föyü (kapanıştan sonra düzeltme olduysa görünsün).
  Hak bitince durur. Yani her sabah dün + bir geçmiş gün gelir (9 Temmuz, 10 Temmuz, …): Temmuz'dan bu yana ~125 gün
  ~4 ayda tamamlanır.
  **Daha hızlı geçmiş için** Gafdigi'den birkaç günlüğüne daha yüksek kota istenebilir; kod hakkı yanıt başlığından
  okur (`X-Kota-Hak`, `X-Kota-Kalan`), değişiklik gerekmez.
- **Bu günü çek** (Ayarlar, yalnız yönetici): seçilen günü hemen çeker; kalan hakkı onay penceresinde söyler. Bugün
  seçilirse açık kasa o anki tutarlarla gelir ("Kesin değil"); ertesi sabah kendiliğinden yeniden çekilir.
- Sayfa açılışı, zil ya da Kasa ekranı **hiçbir zaman** istek göndermez: yalnız saklanan föyü okur.
- İstemci yeniden denemez (hak harcanmasın). Hak dolduysa (`429 KOTA_DOLDU`) hiçbir istek gitmez; kalan hak son
  yanıttan bilinir (integration_state › `modpos`).
- **Alınamayan gün** (bozuk yanıt, 500…) her sabah yeniden denenmez: 2, 4, 8… gün (en çok 32) bekler, geçmiş onda
  takılmaz, sıradaki eksik güne geçer; iki kez alınamayan gün kartta yazar. Yanıt 2xx ama okunamıyorsa (bozuk, çok
  büyük, yarıda kesik) çalışma durur: sorun büyük olasılıkla her günde aynıdır, ikinci hak harcanmaz.
- **LafPOS'a geçiş gününden** itibaren föy çekilmez (o günleri hiçbir yer okumaz); geçmiş yalnız ondan önceye tamamlanır.
- **Aynı anda tek çekim** (integration_state › `modpos.kira`, 90 sn): sabah işi iki kez tetiklenirse ya da **Bu günü
  çek** sabah işiyle çakışırsa ikincisi istek göndermez ("Başka bir ModPOS çekimi sürüyor"). Bu günü çek'in yanıtı yolda
  kaybolursa pencere kapanır ve sayfayı yenileyip kalan hakka bakmak önerilir (çekim yapılmış olabilir).
- Gece yarısından sonra **Bu günü çek**'in ilk günü kesinleşmiş son gündür (07:00'den önce dün değil önceki gün); dün
  seçilirse pencere föyün kesin olmayacağını ve sabah işinin yeniden çekeceğini söyler.

## 3. Ne çekilir, ne çekilmez

Saklanan (her şey, kişisel ad dışında): kasa günü, föyün hazırlandığı an, her kasa için şube ve kasa adı, gün no, Z no,
durum (açık / kapalı / 06:00'da kendiliğinden kapandı), açılış ve kapanış zamanı ve nakdi, ciro, ciro dışı (ikram,
ödenmez…), adisyon ve kişi sayısı, bahşiş, her ödeme yöntemi (satış, cari tahsilat, sistem, defter, fark, banka / kurum
kırılımı), kasa defteri girildi mi, giderler (kategori, açıklama, tutar), cari tahsilatlar (tutar, yöntem, zaman), nakit
mutabakatı (dayanak, açılış, nakit satış, nakit cari tahsilat, gider, beklenen, sayılan, fark), ara kasalar, kapanış ve
fark notları, uyarılar, kasası açılmamış satış (föysüz gün) ve özet.

**Bilerek saklanmayan:** personel adları (açılış, kapanış, ara kasa) ve cari tahsilatın müşteri adı (KVKK;
[LAFPOS.md](LAFPOS.md) › Güvenlik ve KVKK'daki kural). Gerekirse sahibin kararıyla eklenir.

**API'nin vermediği** (panelde bugünkü gibi elle kalır): ürün ürün satış (Satışlar'a aylık liste), KDV dökümü,
indirim tutarı, saatlik dağılım, adisyon ayrıntısı, yazarkasanın (banka POS) mali Z'si, banka gün sonu, personelin
teslimi.

## 4. Eşleme: föy → kasa raporunun alanları

| Kasa raporu | Föyden |
|---|---|
| Z no | `zNo` (tek kasada; birden çok kasada boş) |
| Fiş sayısı | Σ `adisyonSayisi` |
| Toplam satış | Σ `satis.ciro` |
| Nakit | `NAKIT` ödemesinin `satis`'i |
| Kredi / banka kartı | `KREDI_KARTI` (cari tahsilat hariç: `satis`, `sistem` değil) |
| Yemek kartı | `YEMEK_KARTI`, `MULTINET`, `PLUXEE`, `SODEXO`, `SETCARD`, `EDENRED`, `TOKENFLEX`, `PAYE`, `METROPOL` |
| Online | `ONLINE_WEB`, `TRENDYOL_ONLINE`, `YEMEK_SEPETI_ONLINE`, `MIGROS_YEMEK_ONLINE`, `GETIR_ONLINE` |
| Diğer | `MOBIL_ODEME`, `HAVALE`, `CARI_HESAP`, `FIYUU`, `SADAKAT_PUANI`, `DIGER` ve tanınmayan kod (ciroya dahilse) |
| Ödenmez / ikram | `satis.ciroDisi` |
| Açılış | `nakitKasa.acilis` |
| Gün içinde çıkan | `nakitKasa.gider` (bilgi: panelin kaynağı Kasadan çıkanlar) |
| Gün içinde giren | `nakitKasa.nakitCariTahsilat` (bilgi) |
| Sayılan nakit | `nakitKasa.sayilan`, yalnız dayanak `Z_RAPORU` iken (gün açıkken ya da kendiliğinden kapandıysa sayım yok) |

Tutarlar noktalı ondalıkla okunur; kayan nokta artığı ve üs (`17620.500000000004`, `-1.1e-13`) iki ondalığa
yuvarlanır, virgüllü tutar (`1.234,50`) ve ofsetsiz zaman reddedilir (alanın yoluyla). Sayısal karakter başvuruları
(`&#305;`) çözülür. Ciroya dahil olmayan yöntemler (`IKRAM`, `ODENMEZ`, `HEDIYE_KARTI`, `SADAKAT_IKRAMI`,
`DEGISIM_MAHSUBU`, `ZAYI`) ödeme alanına girmez. Ödemelerin ciroya dahil toplamı ciroyu tutmuyorsa föy kendi içinde tutmuyor demektir: gün
görünümünde uyarı satırı çıkar. Kasası açılmamış ama satışı olan gün ("föysüz") tutarlarını föysüz satıştan alır, kasa
alanları boştur. Kod: `src/lib/modpos/z.ts` (`foyZ`, `modposBucket`).

## 5. Nerede görünür

- **Ayarlar › ModPOS (kasa föyü)** (yalnız yönetici): durum (gri Kurulmadı / Önizleme, turuncu Henüz çekilmedi /
  Uyarı, yeşil Bağlı, mavi Hak doldu, kırmızı Hata / Anahtar bozuk; hak dolması olağandır, hata değil),
  bugünkü kalan hak ve yenilenme saati, kapsam ("1 Temmuz – 2 Kasım arası 14 günün föyü var · 111 gün henüz yok"),
  son çekim ve son hata, **Bu günü çek**, son çekilen günler ve **Ay rakamına yedek** anahtarı (§6).
- **Kasa** (yalnız yönetici; personelin ekranı değişmez):
  - Gün görünümünde (`?gun=`), kasa raporu formunun altında üç bölüm (sahibin isteği, 3 Kasım 2026;
    src/app/panel/kasa/modpos-sheet.tsx `ModposSections`):
    1. **ModPOS** (kasa föyü): künye (Z no, durum, kesin mi, ModPOS'ta hazırlandığı ve panele alındığı an, sürüm);
       karolar: ciro, adisyon sayısı ve ortalama adisyon, kişi sayısı ve kişi başı, ciro dışı (ödenmez / ikram),
       bahşiş, kasa farkı; ödeme dağılımı (kanal kanal tutar ve ciroya göre pay, ödemelerin toplamı ciroyla tutuyor
       mu); nakit kasa (açılış + nakit satış + nakit cari tahsilat − gider = beklenen, sayılan ve dayanağı, fark,
       kartla cari tahsilat); her kasanın açılış / kapanış saati ve açık kalma süresi, ödeme yöntemleri (ModPOS'taki
       adıyla) ve banka kırılımı, giderler, cari tahsilatlar, ara kasalar, notlar; ModPOS'un uyarıları, föysüz satış,
       föy değiştiyse önceki sürüm. Föy yoksa ne zaman geleceği.
    2. **ladmin** (panelde yazılan kasa raporu; src/app/panel/kasa/ladmin-report.tsx, src/lib/cash-ladmin.ts, föyü
       bilmez): künye (gönderen ve anı, kasayı sayan, sürüm ve son değişiklik, fotoğraf sayısı, e-posta); karolar: Z
       toplamı ve Z no, fiş sayısı ve ortalama fiş, ödenmez / ikram, indirim, kasa farkı, ertesi güne devreden; ödemeler
       (pay ve Z toplamıyla tutuyor mu); nakit kasa (açılış önceki raporun devriyle tutuyor mu, + nakit satış + giren −
       çıkan = olması gereken, sayılan, fark, teslim, devreden ertesi raporun açılışıyla tutuyor mu); kart (Z kartı,
       banka POS gün sonu, yazarkasa kartı, kart farkı); yazarkasa Z'si; kasadan çıkanlar (satır satır, toplam); not.
    3. **Karşılaştırma** (ModPOS föyü ↔ ladmin raporu): rozet (raporla aynı / N alan farklı / rapor yok / gün açıkken
       alındı), özet satırı ("16 satır aynı · farklı yazılan alan yok"), farklı yazılanların uyarısı ve alan alan
       tablo (Alan | ladmin | ModPOS | Fark; fark ModPOS − ladmin). Çekirdeğin satırlarına iki bilgi satırı eklenir:
       ödemelerin toplamı ve raporda banka POS yazıldıysa banka POS ↔ ModPOS kartı (kartla cari tahsilat dahil).
       ModPOS'ta kasa açılmamış ama raporda satış yazılıysa para uyarısı.
    Anahtar kurulmamışken ve föy de yokken üç bölüm de çıkmaz (ladmin'in bilgisi formda zaten var).
  - Günden güne listede rozet **ModPOS'tan farklı**; raporu girilmemiş günde föyün cirosu.
- **Zil** (yönetici): son 7 günde "Kasa raporu ModPOS föyünden farklı" (gün · farklı alanlar); anahtar çalışmıyorsa
  "ModPOS kasa föyü çekilemiyor". **Bugün**: dünün kasa satırı "ModPOS föyünden farklı" işaretiyle "Sorun var" olur.
- **Sabah işi** (Ayarlar › Günlük işler): adım "ModPOS kasa föyü" (alındı / çekilecek gün yok / hak doldu / hata).
  Yalnız anahtar varken yazılır; hata "Sabah işinde bir adım hata verdi" uyarısına gider.

Karşılaştırma kuralları (`src/lib/modpos/compare.ts`): Z alanları, açılış ve sayılan nakit 1 kuruş hassasiyetle
"farklı yazılan"dır (personel bunları ModPOS'un Z'sinden yazar; fark yanlış yazım ya da kapanıştan sonraki düzeltmedir).
Raporda boş bırakılan isteğe bağlı alan (Z no, fiş sayısı, ödenmez) farklı sayılmaz. Gider ↔ gün içinde çıkan,
nakit cari tahsilat ↔ gün içinde giren, olması gereken ve kasa farkı yalnız bilgidir. LafPOS'a geçiş gününden
itibaren kasa LafPOS'tur: föy karşılaştırılmaz. Kasası hâlâ açıkken alınmış föy (gün içinde **Bu günü çek**)
karşılaştırılmaz: o anki tutarlardır, ModPOS bölümünde "Föy gün açıkken alındı" yazar, rozet ve zil çıkmaz; ertesi
sabah kapanmış föy kendiliğinden gelir. Kasası açılmamış (föysüz) gün de kesinleşmeden karşılaştırılmaz.

## 6. Ay rakamına yedek (isteğe bağlı, varsayılan kapalı)

Ayarlar › ModPOS kartındaki anahtar (`settings › modposAyYedegi`). Açıkken kasa raporu (ve LafPOS gün sonu) olmayan
günün **kapanmış** föyü ayın açık gün, ciro, ödenmez ve kart payına girer (LafPOS'un yedek satırıyla aynı kural, G6):
gün yine "rapor yok" sayılır, rapor girilince rapor kazanır. İndirim föyde olmadığı için o günlerin indirimi
bilinmez. Elle yazılan ay bilgisi her zaman kazanır (yalnız föyden gelen ayda elle yazılan 0 da silinmez). Kapalıyken
föy hiçbir hesaba girmez.

Raporlar başlamadan önceki föyler yalnız **ilk rapora kesintisiz uzanan kısımla** sayılır: arada föyü olmayan gün varsa
(alınamadı, henüz çekilmedi) ondan öncesi sayılmaz, boşluk dolunca kendiliğinden sayılır; kesintisiz kısmın başladığı
ay yarımdır (toplamı uygulanmaz, "ModPOS föyleri 6 Ekim'den itibaren var"). Tek tek elle çekilmiş eski bir gün ayı
yanlış "tam" yapmaz. Geçmiş ilk ciro gününden ileriye çekildiği için (§2) Temmuz'dan gelen föyler, geçmiş ilk rapora
ulaşınca bir kerede sayılmaya başlar; o güne kadar ay rakamları bugünkü gibi kalır. Kasası açılmamış, satışsız kesin gün (kafe kapalı) sıfır satırdır: kesintiyi bozmaz, ciroya bir şey
katmaz. Eksik gün uyarıları yalnız ilk kasa raporundan itibaren aranır: raporlardan önceki föy günleri "eksik rapor"
sayılmaz.

## 7. Saklama

- `modpos_cash_sheets`: kasa günü başına bir satır; föyün okunmuş hâli (`sheet`, kişisel adsız), durum, kesin mi,
  parmak izi, sürüm, önceki sürümün özeti, hazırlanma / çekilme / değişme anları. Aynı gün yeniden çekilince içerik
  aynıysa yalnız çekilme anı değişir; değiştiyse sürüm artar ve "önceki" özet kalır.
- `integration_state › modpos`: son kota, son başarılı / başarısız çekim, son 10 çalışma. Anahtar burada değil.
- İkisi de yedeğe girer (kişisel ad yok). Migration: `drizzle/0050_modpos_kasa_foyu.sql` (yalnız yeni tablo).

## 8. Sorun giderme

| Kartta / zilde | Ne yapılır |
|---|---|
| Kurulmadı | `MODPOS_API_KEY`'i Vercel'e (Production) ekleyip yeniden yayınlayın |
| Anahtar geçersiz / kapalı / süresi dolmuş | Gafdigi'den anahtarı kontrol ettirin, yenisini Vercel'e yazın |
| IP kısıtı | Gafdigi'den anahtarın IP kısıtını kaldırtın |
| Rapor yetkisi yok / kapsam geçersiz | Gafdigi'den anahtara kasa föyü yetkisi ve işletme bağı verdirin |
| Hak doldu | Olağan; gece yarısı yenilenir. Sabah işi ertesi gün devam eder |
| Föy hazırlanamadı / servis kullanılamıyor | Sonraki sabah kendiliğinden yeniden denenir |
| Yanıt okunamadı (alan adı) | ModPOS yanıtının biçimi değişmiş olabilir: `npm run modpos:foy -- --dosya yanit.xml` ile bakın |

Komut satırı (yerelde, anahtar ortamda): `npm run modpos:foy -- 2026-11-02` bir günü çekip özetini yazar (veritabanına
yazmaz, bir hak kullanır); `--dosya yanit.xml` yalnız dosyayı okur (istek yok); `--kaydet` veritabanına da yazar.

## 9. Sonraya

- **Komisyon & hakediş**: yemek kartı firmaları ve platformlar föyde ayrı (`MULTINET`, `PLUXEE`, `TRENDYOL_ONLINE`…);
  kanal kanal satış föyden alınabilir (`modposChannels`, `src/lib/modpos/z.ts`). Kaynak sırası elle > lafpos > modpos
  > tek olur.
- **Kasa formunda "ModPOS'tan doldur"**: föyü saklanan günde (geç rapor, ertesi gün girilen rapor) form föyden
  dolabilir (`CashPrefill.source: "modpos"` hazır). Akşam kapanışta doldurmak günün ikinci hakkını harcar; kota
  artırılırsa açılır.
- Satış tahmini, nakit planı ve haftalık özetin günlük cirosu (bugün yalnız kasa raporundan).

## 10. Dosyalar

- Saf: `src/lib/modpos/foy.ts` (XML → föy, güvenli ayrıştırma), `z.ts` (eşleme, Z özeti), `request.ts` (anahtar,
  kota, hata metinleri), `plan.ts` (hangi gün), `status.ts` (durum, kart özeti, yedek ayarı), `compare.ts` (rapor ↔
  föy).
  `ayarlar.ts` (kartın ve "Bu günü çek"in metinleri).
- Sunucu: `src/server/modpos/client.ts` (istek), `store.ts` (saklama, okuma, durum), `sync.ts` (çekme), `status.ts`
  (kartın verisi), `admin.ts` (yedek ayarının yazımı); eylemler `src/server/actions/modpos.ts`; kart
  `src/app/panel/ayarlar/modpos-card.tsx` ve `modpos-client.tsx`; sabah adımı `src/app/api/cron/gunluk/route.ts`
  (`modposP`) ve `src/lib/job-health.ts` (`modposStep`); komut satırı `scripts/modpos-foy.ts`.
- Kasa gün görünümü: `src/app/panel/kasa/modpos-sheet.tsx` (`ModposSections`: ModPOS, ladmin, Karşılaştırma),
  `ladmin-report.tsx` (ladmin bölümü), `day-parts.tsx` (ortak karo ve satır parçaları), `modpos-diffs.tsx`; saf
  yardımcılar `src/lib/cash-modpos.ts` (ModPOS ve karşılaştırma) ve `src/lib/cash-ladmin.ts` (ladmin; föyü bilmez);
  okuyucu `src/server/data/modpos-day.ts`. Testi `tests/modpos-kasa.test.ts`.
- Testler: `tests/modpos-foy.test.ts` (saf), `tests/modpos-sabah.test.ts` (sabah adımı), `tests/modpos-ayarlar.test.ts`;
  veritabanıyla (`MODPOS_TEST_DATABASE_URL`): `tests/modpos-db.test.ts`, `tests/modpos-ayarlar-db.test.ts` ve sabah
  adımının DB bölümü.
- Fikstürler: `tests/fixtures/modpos/` (kitapçığın örneği ve uç durumlar; kafenin verisi değil).

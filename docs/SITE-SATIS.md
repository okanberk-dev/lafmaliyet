# laffogato.net online satışları: kâr-zarar, tüketim ve kasa raporu

Ekranlar: **Gelir-gider** (`/panel/gelir-gider`; "laffogato.net online satışları" kartı ve tablonun Maliyet
bölümündeki satırlar), **Tutarlılık** (`/panel/tutarlilik`; online tüketim), **Kasa raporu** (`/panel/kasa`; günün
bilgi satırı) ve **Ayarlar › laffogato.net** (bağlantının durumu).

**Kullananlar** (sözleşmeye dokunan bir değişiklik bunların hepsine bakar): kâr-zarar ve tüketim (hesap motoru,
`src/lib/calc/engine.ts`), kasa raporunun günlük bilgi satırı (`src/server/site-sales/sync.ts`), **Nakit planı › KDV
tahmini** (satış KDV'sine sitenin KDV'si de girer: `siteVat` `src/lib/site-sales/calc.ts`, okuyan `src/lib/kdv.ts`;
[NAKIT-PLANI.md](NAKIT-PLANI.md)). Sözleşmenin sitedeki kopyası: laffogato deposunda
`docs/PANEL-SALES.md` (uç, alanlar, KDV kuralı, hata kodları; sitenin kuralı `src/lib/panel/sales-export-core.ts`).

## Geliştirilmiş istek (prompt)

> Operatör (22 Eki 2026): _"laffogato admin ile lafmaliyette paralel çalışabilecek neler varsa ... beraber
> çalışsın"_.
>
> Panelin cirosu kasanınkidir (ModPOS). Sitenin aldığı para (uygulama ve web kafe siparişleri, mağaza kolileri, ön
> ödemeli karaoke) kasadan geçmediği için panelin hiçbir rakamında yok; uygulama siparişinin harcadığı süt ve kahve de
> tüketim kontrolünde eksik. Bunu düzelt:
>
> - **Kâr-zarar:** ay ay imzalı `GET /api/panel/sales?month=YYYY-MM`; ay başına bir kayıt (yeniden çekmek üzerine
>   yazar). Ayrı, KDV hariç gelir satırları; kâr bunlarla hesaplansın. ModPOS cirosuna ve POS komisyonu formülüne
>   dokunulmasın. Rakamın nereden geldiği görünsün; hiç çekilmemiş ay **boş** kalsın (0 değil).
> - **Ne zaman:** günlük işte bir adım (içinde bulunulan ay; ayın ilk günlerinde geçen ay da: geç gelen iadeler) ve
>   elle **Siteden yenile**. Yeni Vercel cron'u yok.
> - **Tüketim:** kafe satırları menü bağlantısıyla panelin ürünlerine eşlensin (L → L yuvası, M ve tek boy → M) ve
>   ayrı bir kaynak olarak tüketime girsin (ModPOS satışlarına karışmasın); eşlenmeyen satırlar listelensin.
> - **Kasa raporu:** o günün online toplamı bilgi satırı olarak görünsün ("kasadan geçmez"); kasa rakamlarını asla
>   değiştirmesin, site düşük ya da yavaşsa (8 sn) satır hiç görünmesin, rapor hiç beklemesin.
> - **KVKK:** siteden yalnız toplamlar ve ürün satırları; müşteri adı, sipariş numarası yok.

## Nasıl çalışır

```
laffogato.net                                    ladmin.laffogato.net (bu panel)
─────────────                                    ──────────────────────────────
GET /api/panel/sales?month=2026-10  ◀──────────  günlük iş (bu ay; ayın ilk 7 gününde geçen ay da)
  {now, version:1, from, to, closed,               ya da Gelir-gider › Siteden yenile (bu ay ve geçen ay)
   cafe:{…, lines:[…]}, shop:{…},                  ├─ doğrula (sürüm 1, dönem aynı, tamsayı kuruş)
   karaoke:{…}, manual:{…}}                        └─ integration_state site_sales:2026-10 (üzerine yazar)
                                                         └─ hesap motoru: kâr-zarar satırları, online tüketim

GET /api/panel/sales?from=2026-10-21&to=2026-10-21  ◀──  Kasa raporu açılınca / gönderilince / e-postada
  (o günün toplamı; saklanmaz)                            8 sn'de gelmezse satır yok, rapor beklemez
```

Ping yok: online satış ayın sonunda bir kez kesinleşmez (geç iade kapanmış ayı da düşürür), panel günde bir çeker.

### Kâr-zarar (Gelir-gider)

Tablonun Maliyet bölümünde, **AYLIK CİRO (KDV hariç)** satırının altında, yalnız gösterilen aylardan en az biri
siteden çekildiyse:

| Satır | Ne |
|-------|----|
| KAFE ONLİNE (SİTE + UYGULAMA) | Uygulama ve web kafe siparişleri (masa, gel-al, kurye), iadeler düşülmüş. Panelden elle girilen siparişler ModPOS'ta olduğu için girmez (`manual`) |
| MAĞAZA (ONLİNE) | Sitenin mağaza kolileri (kargo ücreti dahil), iadeler düşülmüş |
| KARAOKE (ÖN ÖDEMELİ) | Sitede ödenen karaoke rezervasyonlarının köşkte kalan tutarı, parasının alındığı ayda |
| TOPLAM CİRO (KDV hariç) | ModPOS cirosu (KDV hariç) + üç online satır |

- **KDV hariç** (sözleşmenin formülü): `netMinor − kdvMinor − unknownKdvNetMinor × r / (100 + r)`. `r` panelin
  varsayılan oranı (Ayarlar › Oranlar): kafe ve mağaza için satış KDV'si (%10), karaoke için hizmet satışı KDV'si
  (%20). Site her siparişin satıldığı oranı saklar; 17 Ekim 2026 öncesi siparişlerde oran yoktur, panel onları bu
  oranla ayırır. Ödül kuponuyla bedava verilen içeceğin faturası tam fiyattan KDV doğurur: o ay KDV hariç gelir eksi
  çıkabilir, doğrudur. Site kuruş gönderir, panel TL gösterir.
- **Hiç çekilmemiş ay boş kalır** (0 değil): o ayın kârı yalnız ModPOS'la hesaplanır. Çekilmiş ama satışsız ay 0'dır.
- **KÂR / ZARAR** = toplam ciro − giderler; **oranlar** (maliyet oranı, kira oranı, …) toplam ciroya göre. Genel
  bakışın kârı, yıllık eğilim, ay ay döküm ve Excel'e aktarım aynı toplamı kullanır.
- **Dokunulmayanlar:** AYLIK CİRO (KDV dahil – POS) elle girilen ModPOS cirosu olarak kalır, AYLIK CİRO (KDV hariç)
  yalnız ondan hesaplanır (kasada çalınan karaoke, yani Satışlar'da HİZMET işaretli satırlar, hizmet KDV'siyle: bkz.
  aşağıda "Kasadaki karaoke"); POS komisyonu formülü aynen ModPOS cirosundan. Online satırlar düzenlenemez,
  gelir-gider düzeltmesi almaz (kaynak sitedir).
- **Kaynak görünür:** satırların açıklaması nereden geldiğini söyler; tablonun üstündeki **laffogato.net online
  satışları** kartı ayı ayı gösterir: kafe / mağaza / karaoke (KDV hariç) ve sipariş sayıları, "Ay kapandı" / "Ay
  sürüyor" (sitenin `closed`'ı), ne zaman çekildiği, panelden elle girilip eklenmeyen siparişler (KDV dahil), panel
  ürününe bağlı olmayan satır sayısı, son hata. **Siteden yenile** bu ayı ve geçen ayı, satırdaki ↻ o ayı, **Başka bir
  ay** bu yılın herhangi bir ayını (Ocak 2026'dan bu aya) çeker. Kartın altında **laffogato.net paneli ↗**.
- Telefonda ay özeti "+ online X (laffogato.net)" der.
- **Karaoke box ile karaoke odası ayrı işlerdir:** Faturalar'daki "Karaoke box" kategorisi MaviBahçe AVM'deki karaoke
  box'ların faturalarıdır (Opera Gayrimenkul; `SEPARATE_CATEGORIES`, [PARASUT.md](PARASUT.md) §6a-1), kafenin
  gelir-giderine girmez. Sitenin karaoke odası ise köşkün kendi odasıdır: ön ödemeli rezervasyonu KARAOKE (ÖN
  ÖDEMELİ) satırında, kasada çalınanı ModPOS cirosunda kafenin kâr-zararına girer.

### Kasadaki karaoke (hizmet satışı KDV'si)

Köşkte kasadan (ModPOS) çalınan karaoke ("Karaoke Kişi başı", "Karaoke Toplu") Satışlar'da **HİZMET** olarak
işaretlenir: malzeme maliyeti yoktur ve KDV'si %20'dir (kafenin yiyecek-içeceği %10). Panel bu satırları kendi oranıyla
ayırır (Ayarlar › Oranlar › **Hizmet satışı KDV oranı**, varsayılan %20; `settings.kdvHizmet`):

- **Satış raporu:** HİZMET satırının neti `ciro ÷ (1 + hizmet KDV)`, ürünlerinki `ciro ÷ (1 + satış KDV)`.
- **Gelir-gider:** AYLIK CİRO (KDV hariç) = (POS cirosu − hizmet payı) ÷ (1 + satış KDV) + hizmet payı ÷ (1 + hizmet
  KDV). Hizmet payı, ayın satış listesindeki HİZMET satırlarının cirosudur (ay cirosundan büyük olamaz); satış listesi
  yüklenmemiş ayda bütün ciro satış KDV'siyle ayrılır.
- Excel tek oran kullanıyordu: Eylül 2026'nın 2.050 ₺'lik karaokesi yüzünden net ciro ve kâr 155,30 ₺ düşer
  (`tests/calc.test.ts`; Excel'le birebir karşılaştırma Excel'in tek oranlı varsayımıyla yapılır). Hizmet oranı satış
  oranına eşitlenirse hesap Excel'inkine döner.

### Tüketim (Tutarlılık)

Sitenin kafe satırları (`cafe.lines`: iptal edilmeyen, tamamen iade edilmemiş siparişlerin satırları) menü
bağlantısıyla ürünlere eşlenir ([SITE-MENU.md](SITE-MENU.md)): satırın kalemi `products.site_menu_id`, boyu yuvası
(`L` → L yuvası; `M` ve tek boy → M yuvası). Eşlenen satırın adedi ürünün reçetesiyle malzemeye çevrilir ve
**ayrı bir kaynak** olarak tüketime eklenir (`sales_lines`'a yazılmaz; ModPOS yapıştırması online satışı ezmez,
online satış ModPOS satışını şişirmez):

- Beklenen kullanım = ModPOS satışları + online kafe siparişleri; kartta ve tabloda "ModPOS x · online y".
- **Online satışlar** kartı: ayın online tüketimi, eşlenen satırlar ve **panel ürününe bağlı olmayanlar** (ad, boy,
  adet; malzemesi tüketime girmez). **Ürünleri bağla** eşleştirme ekranına götürür. Satır başka boya düşülmez
  (yanlış boyun reçetesi tüketimi yanlış gösterirdi).
- Bağlı olmayan satır varsa zilde uyarı: "N online satış satırı panel ürününe bağlı değil".
- Ay çekilmediyse kart bunu söyler ve Gelir-gider'e (Siteden yenile) götürür; o ayın beklenen kullanımı yalnız
  ModPOS'tandır.

### Kasa raporu satırı

Kasa raporu açılınca, gönderilince ve e-postası (yeniden) gönderilince o günün toplamı ayrıca sorulur:
`GET /api/panel/sales?from=GÜN&to=GÜN`. Satır:

> **laffogato.net · 21 Ekim Çarşamba:** Online (site + uygulama) 1.331,02 ₺ · Karaoke ön ödeme 410 ₺ — kasadan geçmez.
> Bilgi için: kasa farkına ve Z raporuna girmez; ModPOS'un "Online" ödemesi (Yemeksepeti, Getir…) ayrı. Sitenin günü
> gece yarısında biter.

- Tutarlar KDV dahil, iadeler düşülmüş (`netMinor`): online = kafe + mağaza. Personel karaoke tutarını görmez
  (karaoke tutarları personele gösterilmez); yöneticiye giden e-postada ikisi de var ("laffogato.net (kasadan
  geçmez)" bölümü; düz metinde son satır). WhatsApp metnine girmez.
- **Hiçbir kasa rakamını değiştirmez**: kasa farkı, Z kontrolü, devir aynen.
- **Raporu asla bekletmez:** sayfada satır akışla sonradan gelir (form hemen açılır); gönderimde istek kayıtla aynı
  anda başlar, yalnız e-posta onu bekler. Site düşük, yavaş (8 saniye; gövdeyle en çok 8,5) ya da yanıtı bozuksa satır
  hiç görünmez, rapor satırsız kaydedilir ve gider. Saklanmaz.
- Gün sınırı: kasanın günü gece 05:00'e kadar sürer (geç kapanış bir önceki güne yazılır), sitenin günü gece yarısında
  biter. Satır raporun tarihindeki **sitenin günüdür**; gece yarısından sonra verilen online sipariş ertesi günün
  satırındadır (satır bunu söyler).

## Saklama

| Anahtar (`integration_state`) | İçerik |
|-------------------------------|--------|
| `site_sales:YYYY-MM` | Ayın kaydı: sitenin yanıtı (toplamlar, kafe satırları, `closed`, `now`) + `month`, `pulledAt`. Yeniden çekmek üzerine yazar; sitenin saatine (`now`) göre daha eski bir yanıt yenisinin üstüne yazılmaz. Çekme başarısızsa önceki kayıt kalır |
| `site_sales_sync` | `lastPullAt` (son deneme), `lastOkAt` (son başarılı), `lastError` (ay ay), `lastMonth` |

Günlük kasa satırı saklanmaz. `npm run db:reset` bu kayıtları silmez (sitenin verisi; Excel'den gelmez). Elle çekme
işlem geçmişine yazılır ("laffogato.net online satışları çekildi · Ekim 2026").

## Ne zaman çekilir

| Tetikleyici | Aylar |
|-------------|-------|
| Günlük iş (`/api/cron/gunluk`, sabah; ayrı ve yalıtılmış bir adım, hata öteki adımları durdurmaz) | Bu ay; ayın ilk 7 gününde geçen ay da (geç gelen iade kapanmış ayı düşürür) |
| Gelir-gider › **Siteden yenile** | Bu ay ve geçen ay |
| Ay satırındaki ↻ ya da **Başka bir ay › Siteden çek** | O ay (bu yılın Ocak 2026'dan bu aya kadarki ayları; istek başına en çok 3) |

Aylar aynı anda sorulur: site yavaşsa günlük iş en çok 8 saniye bekler. Elle çekme yalnız yöneticinin
(`src/server/actions/site-sales.ts`).

## Kurulum

1. Karaoke bağlantısı kuruluysa ek bir şey gerekmez: aynı `KARAOKE_SYNC_SECRET` ve `LAFFOGATO_URL`
   ([KARAOKE.md](KARAOKE.md) › Kurulum). Migration gerekmez (kayıtlar `integration_state`'te).
2. Sitenin satış ucu yayında olmalı (laffogato `src/app/api/panel/sales/route.ts`).
3. Gelir-gider › **Siteden yenile**: bu ay ve geçen ay gelir; önceki aylar için **Başka bir ay**. Tutarlılıkta online
   tüketim için ürünlerin menüye bağlı olması gerekir (Ürünler › Site menüsü).

## Güvenlik ve kişisel veri

- İstek karaoke bağlantısının imzasıyla (`src/lib/karaoke/signature.ts`); sorgu dizesi imzanın içindedir, imzalanandan
  başka bir dönem istenemez.
- Yanıt sıkı doğrulanır (`src/lib/site-sales/schema.ts`): tanınmayan sürüm, istenen dönemden farklı `from` / `to`,
  eksi ya da kesirli tutar, bilinmeyen boy reddedilir (bütün ay; kâr-zararı sessizce yanlış bir ay, hiç çekilmemiş
  bir aydan kötüdür). Satır adları kısaltılır, bilinmeyen alanlar atılır.
- Siteden yalnız toplamlar ve ürün satırları gelir: müşteri adı, e-posta, telefon, adres, sipariş numarası yok.

## Sorun giderme

| Mesaj | Ne yapılır |
|-------|------------|
| Site 8 saniyede yanıt vermedi / Siteye ulaşılamadı | Geçici; **Siteden yenile** ile yeniden deneyin (önceki kayıt duruyor) |
| Site isteği reddetti (imza) | İki projedeki `KARAOKE_SYNC_SECRET` aynı mı, ikisi de yeniden yayımlandı mı, sunucu saatleri doğru mu? |
| Sitede panel satış ucu yok | laffogato.net güncel değil (satış bağlantısı yayımlanmamış) |
| Site dönemi kabul etmedi | Dönem bozuk (panel hatası); işlem geçmişiyle birlikte bildirin |
| Dönemde çok sipariş var | Sitenin sınırı (dönemde 20 000'den çok sipariş). Panel ayı gün gün bölmez; bu hacimde gün gün çekme eklenmeli |
| Sitede KARAOKE_SYNC_SECRET tanımlı değil ya da sitenin veritabanı okunamadı | Siteye değişkeni ekleyin; sürüyorsa sitenin günlüğüne bakın |
| Sitenin satış yanıtı … (sürüm / dönem / tutar) | Site sözleşmeyi değiştirmiş: paneli güncelleyin |

Kasa raporunda satır yoksa: bağlantı kurulu mu (Ayarlar › laffogato.net), site o an yanıt verdi mi? Satır
bilgidir; yokluğu raporu etkilemez.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/site-sales/schema.ts` | Sitenin yanıtının doğrulanması, ayın dönemi, saklanan kaydın okunması (saf) |
| `src/lib/site-sales/calc.ts` | KDV hariç gelir, çekilecek aylar, satır → ürün eşlemesi, kasa satırı ve zaman sınırı (saf) |
| `src/server/site-sales/sync.ts` | Ayları çekme ve saklama, durum, kasa satırının isteği |
| `src/server/actions/site-sales.ts` | Siteden yenile (yönetici) |
| `src/app/api/cron/gunluk/route.ts` | Günlük işin online satış adımı |
| `src/lib/calc/engine.ts`, `insights.ts` | Kâr-zarar satırları ve toplam ciro; online tüketim; uyarı |
| `src/server/data/dataset.ts` | Kayıtların hesap motoruna verilmesi |
| `src/app/panel/gelir-gider/site-sales-card.tsx` | laffogato.net online satışları kartı |
| `src/app/panel/tutarlilik/` | Online tüketim kartı, "ModPOS · online" ayrımı |
| `src/app/panel/kasa/page.tsx`, `src/server/actions/cash-report.ts`, `src/server/notify/cash-report-template.ts` | Kasa raporu satırı, gönderim, e-posta |
| `tests/site-satis.test.ts` | Şema, KDV hariç formül, aylar, eşleme, kasa satırının zaman sınırı, motor satırları |

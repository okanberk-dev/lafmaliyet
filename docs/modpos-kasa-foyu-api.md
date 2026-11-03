# ModPOS (Gafdigi) Kasa Föyü API: belge özeti ve canlıda görülenler

Sahibin 3 Kasım 2026'da verdiği kitapçığın ("Kasa Föyü API") aktarımı ve canlı denemede görülenler. Panelin
entegrasyonu ve kararları: [MODPOS-API.md](MODPOS-API.md). Örnek yanıt ve hata örneği test fikstürüdür
(`tests/fixtures/modpos/belge-ornegi.xml`, `hata-kota.xml`): kitapçıktaki uydurma bir işletmenindir, kafenin verisi değil.

> **Anahtar.** API anahtarı (`sk_…`) yalnız sunucuda, yalnız Vercel'in Production ortamında `MODPOS_API_KEY` olarak
> durur ([DEPLOY.md](DEPLOY.md) › Ortam değişkenleri). Depoya, belgeye, sohbete ya da tarayıcıya yazılmaz.

## 1. Genel

Servis, işletmenin bir **kasa gününe** ait kasa föyünü XML olarak verir: kasa açılış ve kapanışı, ödeme yöntemlerine
göre tutarlar, kasa defteri, giderler, cari tahsilatlar, ara kasalar ve kasa farkı. **Ürün satırı, KDV dökümü, saatlik
dağılım, indirim tutarı ve adisyon ayrıntısı yoktur.**

Kasa günü, kasanın açıldığı günün tarihidir. Gece yarısından sonra alınan ödemeler kasa kapanana kadar aynı kasa gününe
yazılır. Kasa kapatılmazsa gün sabah **06:00**'da kendiliğinden kapanır (panelin iş günü 05:00'te döner; kasa günü
kasanın açıldığı gün olduğu için ikisi aynı güne düşer).

## 2. Kimlik doğrulama

Her istekte API anahtarı `x-api-key` başlığında gönderilir. Rapor anahtarın tanımlandığı işletmenin verisidir.
Anahtara IP kısıtı tanımlandıysa istek yalnız izinli adreslerden kabul edilir (`403 IP_IZINSIZ`; Vercel işlevlerinin
sabit çıkış IP'si yoktur, kısıt istenmez). Anahtar sunucu tarafında saklanmalıdır.

## 3. İstek

```
GET https://api.gafdigi.com/api/v2/external/raporlar/kasa-foyu?tarih=2026-11-01
x-api-key: <API anahtarı>
```

| Parametre | Zorunlu | Açıklama |
|---|---|---|
| `tarih` | Evet | Kasa günü, `YYYY-AA-GG`. İleri tarih kabul edilmez. Bugünün tarihi gönderilirse açık kasa o anki tutarlarla gelir. |

Her istek tek bir kasa gününü kapsar; tarih aralığı gönderilemez. İstemci zaman aşımı 60 saniye önerilir.

## 4. Kullanım sınırı (kota)

- Her anahtar **bir günde en çok 2 başarılı istek** yapabilir. Gün Türkiye saatiyle 00:00'da başlar; sınır isteğin
  yapıldığı güne göre sayılır, istenen kasa gününe göre değil.
- Hatalı istekler (400, 401, 403) sınırdan düşülmez. Sunucu raporu üretemezse (500) hak geri verilir. Sınır dolunca
  `429 KOTA_DOLDU`.
- Kalan hak her yanıtta başlıklarla gelir:

| Başlık | Açıklama |
|---|---|
| `X-Kota-Hak` | Günlük hak (2) |
| `X-Kota-Kalan` | Bu istekten sonra kalan hak |
| `X-Kota-Yenilenme` | Hakkın yenileneceği zaman |

Başarılı yanıtın gövdesinde de `<kota>` vardır: `gunlukHak`, `kullanilan`, `kalan`, `yenilenme`.

## 5. Yanıt

`application/xml; charset=utf-8`. Başarılı yanıtın kökü `<kasaFoyu>`, hatalınınki `<hata>`.

- Tekrar eden öğeler aynı adla art arda gelir (her kasa için bir `<kasa>`, her ödeme yöntemi için bir `<odeme>`).
  Kayıt yoksa öğe hiç gelmez.
- Değeri olmayan alan boş öğedir (`<defter/>`).
- Tutarlar Türk lirası, ondalık ayırıcı nokta (`28450.5`).
- Zamanlar Türkiye saatiyle, ofsetli (`2026-11-01T09:42:10+03:00`).
- Evet / hayır alanları `true` / `false`.

### 5.1 `kasaFoyu`

| Öğe | Açıklama |
|---|---|
| `kasaGunu` | İstenen kasa günü |
| `olusturulma` | Raporun hazırlandığı an |
| `kasa` | Her kasa için bir öğe (§5.2) |
| `foysuzGun` | O gün satış yapılmış ama kasa açılmamış şube: `sube`, `ciro`, `adisyonSayisi`, `odeme` |
| `ozet` | Bütün kasaların toplamı (§5.6) |
| `kota` | `gunlukHak`, `kullanilan`, `kalan`, `yenilenme` |

### 5.2 `kasa`

| Öğe | Açıklama |
|---|---|
| `sube` | Şube adı |
| `kasaAdi` | Kasa adı |
| `gunNo` | Kasanın gün sıra numarası |
| `zNo` | Z raporu numarası (metin; baştaki sıfırlar korunur: `0312`) |
| `durum` | `ACIK`: gün sürüyor, tutarlar değişebilir. `KAPALI`: gün kapandı |
| `otomatikKapandi` | Gün 06:00'da kendiliğinden kapandıysa `true` |
| `acilis` | `zaman`, `personel`, `nakit` |
| `kapanis` | `zaman`, `personel`, `nakit`; gün açıksa boş |
| `satis` | `ciro`, `ciroDisi` (ikram, ödenmez vb.), `adisyonSayisi`, `kisiSayisi`, `bahsis` |
| `odeme` | Her ödeme yöntemi için bir öğe (§5.3) |
| `defterGirildi` | Kasa defteri girildiyse `true` |
| `giderler` | `toplam` ve her gider için `gider`: `kategori`, `aciklama`, `tutar` |
| `cariTahsilatlar` | `toplam`, `nakit` ve her tahsilat için `tahsilat`: `musteri`, `tutar`, `yontem`, `zaman` |
| `nakitKasa` | Nakit mutabakatı (§5.4) |
| `araKasa` | Her ara kasa için: `no`, `zaman`, `personel`, `ciro`, `nakit`, `adisyonSayisi`, `gider`, `beklenen`, `sayilan`, `fark` |
| `notlar` | `kapanis` ve `fark` açıklaması |
| `uyari` | Her uyarı için bir öğe (§5.5) |

Bir kasa günü `sube` + `kasaAdi` + `kasaGunu` ile tanımlanır.

### 5.3 `odeme`

| Öğe | Açıklama |
|---|---|
| `yontem` | Ödeme yönteminin adı |
| `kod` | Ödeme yöntemi kodu (§6) |
| `ciroyaDahil` | Tutar ciroya dahilse `true` |
| `satis` | Satışlardan gelen tutar |
| `cariTahsilat` | Aynı yöntemle alınan cari tahsilat |
| `sistem` | Sistemde görünen toplam (satış + cari tahsilat) |
| `defter` | Kasa defterine yazılan tutar. Nakitte: sayılan + gider − açılış. Defter girilmediyse boş |
| `fark` | Defter − sistem. Eksi kasa açığıdır |
| `kirilim` | Banka ya da kurum bazında tutar: `ad`, `tutar` |

### 5.4 `nakitKasa`

Beklenen nakit = açılış + nakit satış + nakit cari tahsilat − gider. Fark = sayılan − beklenen.

| `dayanak` | Açıklama |
|---|---|
| `Z_RAPORU` | Değerler kasiyerin aldığı Z raporundan |
| `CANLI` | Gün açık, değerler anlık |
| `OTOMATIK_KAPANIS` | Gün kendiliğinden kapandı, sayım yerine defterdeki nakit kullanıldı |

Alanlar: `dayanak`, `acilis`, `nakitSatis`, `nakitCariTahsilat`, `gider`, `beklenen`, `sayilan`, `fark`.

### 5.5 `uyari`

Alt öğeler: `kod`, `mesaj`, varsa `tutar`.

| Kod | Açıklama |
|---|---|
| `GUN_ACIK` | Gün henüz kapanmadı |
| `OTOMATIK_KAPANDI` | Gün kendiliğinden kapandı |
| `KAPANISTAN_SONRA_CIRO_DEGISTI` | Kapanıştan sonra ciroda değişiklik oldu (gün yeniden sorgulanabilir) |
| `Z_BEKLENEN_NAKIT_TUTMUYOR` | Güncel beklenen nakit Z raporundakinden farklı |
| `DEFTER_GIRILMEMIS` | Kasa defteri girilmemiş |
| `KASA_FARKI` | Kasada fark var |
| `DEGISIM_DENKLESMEDI` | Ürün değişimi mahsubu denkleşmemiş |

### 5.6 `ozet`

`kasaSayisi`, `acikKasa`, `kapaliKasa`, `otomatikKapanan`, `ciro`, `ciroDisi`, `adisyonSayisi`, `kisiSayisi`, `bahsis`,
`gider`, `cariTahsilat`, `kasaFarki`, her yöntem için bir `odeme` (`yontem`, `kod`, `tutar`), `foysuzGunSayisi`,
`foysuzCiro`.

## 6. Ödeme yöntemi kodları

| Kod | Yöntem | Ciroya dahil |
|---|---|---|
| `NAKIT` | Nakit | Evet |
| `KREDI_KARTI` | Kredi Kartı | Evet |
| `MOBIL_ODEME` | Mobil Ödeme | Evet |
| `HAVALE` | Havale | Evet |
| `YEMEK_KARTI` | Yemek Kartı | Evet |
| `MULTINET`, `PLUXEE`, `SODEXO`, `SETCARD`, `EDENRED`, `TOKENFLEX`, `PAYE`, `METROPOL` | Yemek kartı firmaları | Evet |
| `ONLINE_WEB`, `TRENDYOL_ONLINE`, `YEMEK_SEPETI_ONLINE`, `MIGROS_YEMEK_ONLINE`, `GETIR_ONLINE` | Online ödemeler | Evet |
| `CARI_HESAP` | Cari Hesap | Evet |
| `FIYUU` | Kurye tahsilatı | Evet |
| `SADAKAT_PUANI` | Sadakat Puanı | Evet |
| `IKRAM` | İkram | Hayır |
| `ODENMEZ` | Ödenmez | Hayır |
| `HEDIYE_KARTI` | Hediye Kartı | Hayır |
| `SADAKAT_IKRAMI` | Sadakat İkramı | Hayır |
| `DEGISIM_MAHSUBU` | Değişim Mahsubu | Hayır |
| `ZAYI` | Zayi | Hayır |
| `DIGER` | Diğer | `ciroyaDahil` öğesine bakılır |

Listeye ileride kod eklenebilir: tanınmayan kod "diğer" sayılır (ciroya dahil olup olmadığı `ciroyaDahil`'den).

## 7. Hatalar

Hata durumunda HTTP durum koduyla birlikte:

```xml
<hata>
  <kod>KOTA_DOLDU</kod>
  <mesaj>Günlük kasa föyü çekim hakkı (2) doldu</mesaj>
  <ayrinti><gunlukHak>2</gunlukHak><yenilenme>2026-11-03T00:00:00+03:00</yenilenme></ayrinti>
</hata>
```

| HTTP | Kod | Açıklama |
|---|---|---|
| 400 | `TARIH_GEREKLI` | `tarih` gönderilmedi |
| 400 | `TARIH_GECERSIZ` | `tarih` geçerli bir gün değil |
| 400 | `ILERI_TARIH` | İleri tarih gönderildi |
| 401 | `ANAHTAR_GEREKLI` | API anahtarı gönderilmedi |
| 401 | `ANAHTAR_GECERSIZ` | API anahtarı geçersiz |
| 403 | `ANAHTAR_PASIF` | Anahtar kullanıma kapalı |
| 403 | `ANAHTAR_SURESI_DOLDU` | Anahtarın süresi dolmuş |
| 403 | `IP_IZINSIZ` | İzin verilmeyen IP adresi |
| 403 | `YETKI_YOK` | Anahtarın rapor yetkisi yok |
| 403 | `KAPSAM_GECERSIZ` | Anahtar bir marka ya da şubeye bağlı değil |
| 429 | `KOTA_DOLDU` | Günlük hak doldu |
| 429 | `COK_FAZLA_ISTEK` | Kısa sürede çok fazla istek |
| 500 | `RAPOR_URETILEMEDI` | Rapor hazırlanamadı (hak geri verilir) |
| 503 | `SERVIS_KULLANILAMIYOR` | Servis geçici olarak kullanılamıyor |

## 8. Notlar (kitapçıktan)

- Kesinleşmiş veri için önceki günün raporu sabah **07:00'den sonra** alınmalı.
- `ACIK` kasanın tutarları gün içinde değişebilir.
- Kapanıştan sonra düzeltme yapılınca `KAPANISTAN_SONRA_CIRO_DEGISTI` gelir; gün yeniden sorgulanabilir.

## 9. Canlıda görülenler (3 Kasım 2026)

Denemeler bir Vercel kum havuzundan (Frankfurt, `fra1`) yapıldı; bu oturumun kendi ağı `api.gafdigi.com`'a izin
vermiyordu.

- `tarih` olmadan istek: `400`, `<hata><kod>TARIH_GEREKLI</kod><mesaj>tarih parametresi gerekli (YYYY-AA-GG)</mesaj></hata>`.
  İleri tarih (`2026-12-31`) de `400` döndü. İkisinde de anahtar ve IP denetimine gelinmeden yanıt döndüğü için bu
  denemeler anahtarın ve IP'nin geçerliliğini kanıtlamaz; hak da düşmez.
- Sunucu Cloudflare arkasında (`server: cloudflare`); yanıt ~0,4 sn. Yanıtta `access-control-allow-origin:
  http://localhost:3250` var: tarayıcıdan çağrılmak için değil, sunucudan çağrılır (panel de öyle yapar).
- `2026-11-02` için gerçek bir istek gönderildi; yanıtı bu oturuma aktarılamadı (aktarım güvenlik denetimince
  durduruldu). O gün (3 Kasım) için 2 haktan biri kullanılmış olabilir.

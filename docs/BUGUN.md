# Bugün

Ekran: **Bugün** (`/panel/bugun`; menüde Genel bakış'ın hemen altında, telefonda alt menüde **Bugün**). "Bugün ne
yapmam gerekiyor, ne bitti?" sorusunun cevabı tek ekranda. Personel girişte burada açılır; yöneticinin ana sayfası
Genel bakış olarak kalır.

Ekranda yeni bir yazma eylemi yok: her satır ilgili ekranın doğru yerine götürür, hatırlatıcıyı tamamlamak ve ödemeyi
"Ödendi" yapmak var olan eylemlerle yapılır.

## Düzen

Başlıkta takvim günü ve durum: "23 Ekim Cuma · 3 iş bekliyor (1 sorun) · 2 hatırlatıcı", "Şimdilik iş yok · 2 iş
sonra" ya da "Bugünün işleri tamam".

| Kart | Kimde | İçerik |
|------|-------|--------|
| **Yapılacaklar** | İkisi | Üç bölüm: **Şimdi** (sorunlu ve yapılacak işler), **Sonra** (zamanı gelmemiş), kapalı **Tamamlananlar**. İlk sorunlu iş (yoksa ilk yapılacak) **sıradaki**dir: siyah çerçeve ve "Sıradaki: Raporu gir →" hapı. Yöneticide altta "Bu ayın işleri Genel bakış'ta →" |
| **Hatırlatıcılarım** | İkisi | Geciken ve bugünkü hatırlatıcılar (en çok 6; fazlası "Tümü (14)"). ✓ ile tamamlanır, bildirimde "Geri al" |
| **Yaklaşan ödemeler** | Yönetici | Genel bakış'taki kartın aynısı: geciken ve 7 gün içindekiler, tek dokunuşla "Ödendi" |
| **Bugün kafede** | İkisi | Karaoke odası (süren oturum ya da "Süre doldu", iş gününün rezervasyonları ve rezervasyonsuz oturumları, sıradaki; ödenmemiş tutma ve iptal sayılmaz) ve uygulama siparişleri ("2 açık uygulama siparişi · 1 teslime hazır"; yalnız sayı, liste son 30 dakikada siteden doğrulanmadıysa yazılmaz: bağlantı kopmuş olabilir); "Bar ekranı" düğmesi. Tutar ve sipariş sahibinin adı yazmaz. laffogato.net bağlı değilse ve bugün oturum yoksa görünmez |

Geniş ekranda (xl) solda Yapılacaklar, sağda öteki kartlar; telefonda tek sütun, bu sırayla.

## Satırlar

Durumlar Genel bakış'taki "Bu ayın işleri"yle aynı: **Tamam**, **Yapılacak**, **Sorun var**, **Sonra**. Satırlar
bu sırayla yazılır; bölümler sırayı korur.

| Satır | Kimde | Kural |
|-------|-------|-------|
| Günlük işler (`isler`) | Yönetici | Yalnız canlıda: sabah işi çalışmadı / hata verdi / yarıda kesildi, Paraşüt işi hata verdi, CRON_SECRET yok (Genel bakış şeridinin "ciddi" uyarıları, `src/server/jobs/alerts.ts`) → sorun var, en üstte, Ayarlar › Günlük işler. Paraşüt eşitlemesinin hatası burada söylenir (Faturalar satırında değil); zildeki gibi ayrı bir "Paraşüt eşitlemesi başarısız" satırı olmadığı için yinelenme denetimi yapılmaz |
| Dünkü kasa raporu (`kasa-dun`) | İkisi | Yönetici: farkı (eksik sorun, fazla yapılacak, tutuyorsa tamam), "Mehmet · Z … · nakit … · kart …", güncellendiyse ve not. **Açılış devirle tutmuyor** ya da **Ertesi gün düzeltildi** satırı "sorun var" yapar. Girilmediyse yapılacak (personel bugün de girebilir). Personel yalnız girilmediyse görür: "Kafe açıktıysa bugün girin; yarın yalnız yönetici girebilir." Kasa hiç kullanılmadıysa ya da ilk rapor dünden sonraysa satır yok |
| Ödemeler (`odeme`) | Yönetici | Geciken sorun var ("Ödendiyse işaretleyin"), bugünkü yapılacak, ikisi de yoksa tamam (yaklaşanlar bilgi) |
| Faturalar (`fatura`) | Yönetici | Kontrol bekleyen fatura varsa yapılacak, yoksa tamam |
| Ürün bağlantıları (`urun`) | Yönetici | Hammaddeye bağlanmayı bekleyen fatura ürünü varsa |
| Fiyatı girilmemiş hammaddeler (`fiyat-yok`) | Yönetici | Paket fiyatı 0 olan etkin hammadde varsa (çoğu sayımda "Listeye ekle" ile eklenen) |
| Reçete onayları (`onay`) | Yönetici | Personelin önerdiği değişiklik ya da yeni ürün varsa |
| Fiyat onayı (`fiyat-onay`) | Yönetici | Paraşüt faturasında %40'tan fazla farklı gelen, onay bekleyen hammadde fiyatı varsa (Hammaddeler › Onay bekleyen fiyatlar) |
| Hammadde zammı (`zam`) | Yönetici | Fiyatı önerilenin altında kalan ürün varsa; metin Genel bakış ve zil ile aynı (zammın ayda kaç lira kâr götürdüğü) |
| Kasadaki fiyatlar (`modpos`) | Yönetici | "Kasada değişecek 3 fiyat": ModPOS'ta elle değiştirilip Fiyatlar › Kasaya işle'de işaretlenecekler |
| Geçen ayın stok sayımı (`sayim-gecen`) | İkisi | Ayın ilk 10 gününde geçen ayın sayımı yoksa |
| Zayi & ikram (`zayi`) | Personel | Gün içinde "Gün içinde" (bilgi), akşam rapor gönderilmeden "Rapordan önce" (yapılacak), rapor gönderilince tamam. Günün kayıt sayısı ve özeti |
| Kasa raporu (`kasa`) | İkisi | Gündüz "Akşam" (sonra), 20:00'den sonra yapılacak, gönderilince personelde "Gönderildi" (tamam), yöneticide farkı ve bütünlüğü (dünkü gibi) |
| Ay sonu stok sayımı (`sayim-son`) | İkisi | Ayın son günü: başlamadıysa "Sayıma başla", yarıdaysa "12 / 40", bittiyse tamam (sayım formundaki "kalem sayıldı" ile aynı kural) |

Yöneticiye zayi satırı gösterilmez (zayi ve ikram kasa raporu e-postasında gelir). Personel maliyet, ödeme, fatura,
fiyat ve karaoke tutarı görmez; kasa farkı personelin Kasa ekranında zaten gördüğü bilgidir. Yöneticinin olguları
personel için hiç yüklenmez (`adminFacts` / `staffFacts`; `tests/bugun.test.ts` kaynaktan denetler), satır mantığı da
rolü ayrıca denetler.

## Saatler (Türkiye)

- **İş günü 05:00'te döner:** kasa ve zayi satırları Kasa ve Zayi ekranlarıyla aynı güne bakar. Gece 05:00'ten önce
  açıklama hangi güne baktığını tarihle söyler ("22 Ekim Perşembe · …"); başlıktaki tarih takvim günüdür.
- **Akşam 20:00:** bugünün kasa raporu bundan sonra beklenir. Zil de aynı kurala bakar (`isCashEvening`,
  `src/lib/cash-report.ts`).
- **Takvim günü:** ödemeler, hatırlatıcılar ve sayım. 1 Kasım 00:30'da ay sonu satırı çıkmaz; Ekim sayılmadıysa
  "Geçen ayın stok sayımı" çıkar.
- Ekran 00:00, 05:00 ve 20:00'de ve karaoke oturumu başlayınca ya da bitince kendiliğinden yenilenir; sekme bir
  dakikadan uzun gizli kalıp görünür olunca da. Başka ekrana gidilip geri tuşuyla dönülünce korunan eski hâli
  yenilenir (Kasa'da gönderilen rapor, Ödemeler'de ödenen kayıt görünsün); menüden ya da alt menüden açılınca zaten
  yeniden çizilir. Bildirim gelince (yeni rezervasyon, uygulama siparişi), saatli hatırlatma uyarısından "Tamamlandı"
  denince ve süresi dolan oturum uyarıdan bitirilip uzatılınca da yenilenir.

## Bir kaynak okunamazsa

Sayfa yine açılır. Kasa ve ödemeler "Okunamadı" diye gri satır çıkarır; ötekiler sessizce düşer, hata sunucu
günlüğüne yazılır (`[bugun]`).

## Yeni satır eklemek

1. **Olgu:** `DayFacts`'e isteğe bağlı bir alan (`src/app/panel/bugun/logic.ts`). Yöneticiye aitse yalnız
   `adminFacts`'te, personele aitse yalnız `staffFacts`'te, ikisine aitse `loadToday`'de yüklenir
   (`src/server/data/today.ts`). Her yükleyici `safe(…)` ile sarılır.
2. **Fonksiyon:** satırı üreten küçük bir fonksiyon (olgu yoksa ya da sayı 0 ise `null`); `ADMIN_ROWS` /
   `STAFF_ROWS`'ta yerine. İkinci paketin yuvaları yorum olarak orada: kontrol (`liste-dun`, `liste-{şablon}`),
   komisyon (`komisyon`), siparis (`hizli-sayim`, `mal-siparisi`).
3. **Test:** `tests/bugun.test.ts`'e bir senaryo; yönetici yükleyicisiyse kaynak denetimindeki listeye adı.

Satırın saati varsa (ör. açılış listesi 08:00'de açılır) `nextRefreshAt(now, [an])` ekranı o an yeniler.

Dosyalar: `src/app/panel/bugun/` (sayfa, `logic.ts`, kartlar), `src/server/data/today.ts`, durum görünümü
`src/app/panel/task-style.tsx` (Genel bakış'ın "Bu ayın işleri" ile ortak). Test: `tests/bugun.test.ts`.

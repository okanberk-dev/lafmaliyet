# Koyu tema: finans paneli görsel dili

Kaynak: Dribbble "Finance Dashboard - Fintech Web App" (Ronas IT). Yalnız görsel dil alındı: renk, düzen, bileşen
biçimi, grafik gösterimi. Marka adı, logo, illüstrasyon, kişi fotoğrafları ve örnek metinler alınmadı; veri ve metin
bizim (Türkçe, TL). İncelenen: dört görsel (ana panel düz, eğik görünüm, tipografi + palet sayfası, kapanış).

## Renkler (görseldeki paletten ve ekrandan ölçülen)
| Rol | Değer | Not |
| --- | --- | --- |
| Sayfa zemini | `#050302` | Saf siyaha çok yakın, hafif sıcak |
| Kart yüzeyi | `#1E1C1B` | Sıcak nötr koyu gri; kenarlık ve gölge yok, ayrım ton farkıyla |
| Yükseltilmiş / ikon kutusu / yuvarlak düğme | `#2B2928` civarı | Kartın bir ton açığı |
| Segment rayı (sekme kabı) | `#2B2928` civarı | İçinde etkin seçenek beyaz hap |
| Ayraç | `#2E2C2B` civarı, 1 px | Liste satırları arasında, kart kenarına değmeden |
| Ana metin | `#FFFFFF` | Başlık ve rakam |
| İkincil metin | `#A3A09D` civarı | Tarih/saat, eksen, alt etiket |
| Soluk metin | `#6F6C69` civarı | Kuruş kısmı, "/$3,400" gibi ek |
| Vurgu (buz mavisi) | `#BCE1FF` | Ana kart degradesi, grafik tepesi, gösterge yayı |
| Vurgu degradesi | `#BCE1FF → #EAF5FF → #8EC3F5` | Tek "kahraman" kartta; üstünde siyah metin |
| Grafik ikincil tonlar | `#7E8FA3`, `#58616B`, `#3C4045` | Yığılmış çubuğun alt katmanları (mavi-gri) |
| Gösterge renkleri | camgöbeği `#19C6D1`, pembe `#F08BE6`, beyaz | Kategori yayları ve nokta lejant |

Bizim uyarlamamızda vurgu: L'Affogato yeşili (marka) + buz mavisinin yerini alan sakin yeşil-nane degrade yerine **buz
mavisi bilgi/grafik rengi korunur**, ana eylem yeşil kalır. Bordo hiç yok.

## Tipografi
- Yazı: Google Sans Flex (geometrik grotesk). Bizde Inter kalır; ağırlık ve ölçek taklit edilir.
- Başlıklar normal ağırlık (400), büyük: kart başlığı ~22 px, beyaz. Kalın başlık yok; hiyerarşi boyutla.
- Rakamlar çok büyük ve ince-normal (400): kahraman ~64 px, KPI ~34 px. **Ondalık kısım küçük ve soluk** ("2.436" büyük
  beyaz, ",00" yarı boyda gri). Para işareti rakamla aynı boyda.
- Etiketler küçük (12-13 px), ikincil gri. Tablo sayıları sağa hizalı, tabular.

## Kart yapısı
- Köşe yarıçapı ~24 px (kartlar), ~32 px dış çerçeve. Kartlar arası 12 px boşluk; iç boşluk 24 px.
- Kart başlığı solda; sağ üstte 44 px yuvarlak "↗" düğmesi (`#2B2928` zemin, beyaz ikon): ayrıntıya git.
- KPI kartı: üstte başlık (sol) + değişim hapı (sağ: koyu hap, küçük ▲/▼ üçgen + "10%"); altta büyük rakam.
- Kahraman kart: buz mavisi degrade, siyah metin; altta beyaz haplar ("▲ 10%", "+ $2,780.00"); sağ altta ince dikey
  çubuklardan mini grafik (siyah, 2 px).
- Hedef kartı: arka planda ilerlemeyi gösteren açık ton dolgu bloğu (yüzde kadar genişlik).

## Haplar ve rozetler
- Tam yuvarlak, 24-28 px yükseklik, 12 px yazı. Koyu kartta hap zemini `#2B2928`, yazı beyaz/açık gri; renk yalnız
  üçgende değil, işaret ve okla da (▲ artış, ▼ düşüş).
- Açık zeminde (kahraman kart) hap beyaz, yazı siyah.

## Sekmeler ve gezinme
- Üst çubuk: solda marka, ortada hap biçimli gezinme rayı (koyu zemin, etkin sekme beyaz hap + siyah yazı + ikon,
  ötekiler beyaz yazı + ince çizgi ikon), sağda 44-56 px yuvarlak ikon düğmeleri ve avatar.
- Kart içi segment (Tümü / Gelir / Gider): koyu ray, etkin seçenek beyaz hap.

## Grafikler
- Yığılmış çubuk: geniş, köşeleri 6-8 px yuvarlak, katmanlar arasında 3-4 px boşluk; en üst katman buz mavisi, alt
  katmanlar mavi-gri tonlar. Izgara çizgisi yok; yalnız solda küçük gri eksen etiketleri (6K, 4K, 2K, 0) ve altta ay
  adları. Lejant altta, küçük nokta + gri metin.
- Yarım daire gösterge: kalın olmayan (4-6 px) renkli yaylar, ortada büyük rakam; altında nokta lejant + sağa hizalı yüzde.
- Mini grafik: ince dikey çubuklar (sparkline yerine), artan yoğunluk.

## Liste satırları (işlem geçmişi)
- 44 px yuvarlatılmış kare ikon kutusu (`#2B2928`, 12 px köşe), yanında başlık (beyaz, 500) ve alt satır (gri, tarih ·
  saat). Tutar sağda beyaz; satırlar arası 1 px ayraç. Satır yüksekliği ~80 px.

## İkonlar
- İnce çizgi (1.5 px), yuvarlak uçlu; beyaz. Lucide ile uyumlu.

## Boşluk ritmi
- 4'ün katları: 8 / 12 / 16 / 24 / 32. Kartlar arası 12, kart içi 24, satır içi 16.

---

## Uyarlama: ladmin (bu depo)

Yukarıdaki not görsel dilin kaynağıdır (LafPOS için yazıldı). ladmin'de şöyle uygulandı:

- **Yazı tipi:** Geist kalır (notta Inter yazıyor; ladmin'in yazısı baştan Geist). Ağırlık ve ölçü taklit edilir.
- **Seçim:** Ayarlar › Görünüm ve profil menüsünde (kenar çubuğunun altı, telefonda "Tümü" çekmecesinin altı)
  **Sistem · Açık · Koyu**. Varsayılan Sistem: cihaz koyuysa panel koyu açılır. Seçim bu tarayıcıda saklanır
  (`localStorage` › `ladmin-tema`), hesaba bağlı değildir. QR menü (`/menu`) müşterinin ekranı olduğu için hep açık.
- **Beyaz parlama yok:** kök düzende (`src/app/layout.tsx`) `<head>` içindeki küçük betik (`THEME_SCRIPT`,
  `src/lib/theme.ts`) sayfa boyanmadan önce `<html class="dark" data-theme="dark">` yapar; sistem tercihi ve başka
  sekmedeki seçim değişince de günceller. Panelde CSP yok; ileride eklenirse betiğe nonce ya da karma gerekir.
- **Açık tema değişmez.** Bütün koyu kurallar `html.dark` altında ya da `dark:` önekiyle. `dark:` öneki işletim
  sisteminin tercihine değil `html.dark`'a bağlı (`@custom-variant dark`, globals.css) ve yalnız ekranda: baskı hep açık.

### Belirteçler (globals.css › "Koyu tema")

| Rol | Sınıf | Koyu değer |
|---|---|---|
| Sayfa | `bg-canvas`, `bg-background` | `#050302` |
| Kart / panel | `bg-panel`, `bg-chart-card-bg` | `#1E1C1B` |
| Yükseltilmiş: kontrol, kuyu, ikon kutusu, menü | `bg-surface`, `bg-chart-metric-bg` | `#2B2928` |
| İz / şerit | `bg-panel-deep` | `#3A3735` |
| Ayraç | `border-line` | beyaz %8 (kartta ≈ `#2F2D2C`) |
| Metin | `text-ink` · `text-ink-soft` · `text-ink-mute` · `text-ink-quiet` | `#FFFFFF` · `#D6D3D0` · `#A8A5A2` · `#94918E` |
| Kuruş / ek (yalnız büyük rakamda) | `text-ink-faint` | `#7A7774` |
| Ana eylem (Button primary, Fab) | `bg-primary text-on-primary` | `#5FCF98` / `#04140C` |
| Dolu zeminde yazı (`bg-ink`, `bg-bad`, `bg-warn`, `bg-good`) | `text-on-solid` | `#0B0A09` |
| Olumlu · düşüş · uyarı · bilgi | `text-good` · `text-bad` · `text-warn` · `text-info` | `#72D6A3` · `#FF8278` · `#F2B451` · `#BCE1FF` |
| Grafik serileri | `SERIES` (`charts.tsx`), Arc `--series-*` | buz mavisi `#BCE1FF`, mavi-gri `#7E8FA3`, yeşil `#72D6A3` |
| Eski "bordo" (açıkta mor) | `bordo-*` | mavi-gri aile (`#1C232B` / `#7E8FA3` / `#C4D0DC`) |

Gövde metni olan her belirteç üç zeminde (sayfa, kart, yükseltilmiş) en az 4,5:1, arayüz öğeleri (ana eylem, grafik
serisi, kuruş, odak çizgisi) en az 3:1; koyu belirteçlerde ton 280-355° arası doygun renk (mor / bordo) yok.
`tests/koyu-tema.test.ts` bunları globals.css'i okuyarak ölçer, açık temanın değerlerinin aynı kaldığını da denetler.

### Kod yazarken

- Renk belirteçle verilir (`bg-panel`, `text-ink-mute`, `text-bad`…); bunlar iki temada da doğru çalışır. `bg-white`,
  `text-black/…`, `#hex` yazılmaz; zorunluysa yanına `dark:` karşılığı eklenir.
- `bg-ink` (seçili hap, etkin sayfa) üstündeki yazı `text-on-solid`'dir, `text-white` değil: koyuda `bg-ink` beyaz hap
  olur, yazısı koyulaşır. Test (`bg-ink` + `text-white`) bunu yakalar.
- Sayfanın ana eylemi `Button variant="primary"` (açıkta siyah, koyuda yeşil); elle `bg-ink` düğme yazılmaz.
- Büyük rakam `Stat` ile ya da `Figure` (`ui/misc.tsx`) içinde: koyuda kuruş küçük ve soluk, açıkta aynı. `text-xl` ve
  üstü `tabular` + `font-semibold` rakamlar koyuda kendiliğinden normal ağırlığa iner (globals.css).
- Büyüme hapı `GrowthPill`: koyuda koyu hap + renkli ▲ / ▼; metin zaten ok taşıyorsa (Kıyas) `marker={false}`.
- Grafik rengi `SERIES` / `var(--viz-*)` ile; SVG özniteliğine sabit renk yazılmaz. Göstergede (`ui/gauge.tsx`) açık
  renk öznitelikte kalır, koyu renk `dark:stroke-…` sınıfıyla ezilir.
- Arka plan perdesi (pencere, çekmece, palet) koyuda `bg-black/60`: `bg-ink/20` koyuda sayfayı açardı.

### Bilerek bırakılanlar

- QR menü (`/menu`) ve e-posta şablonları (`src/server/notify/*`) koyu temaya girmez.
- Kahraman kart (buz mavisi degrade) ve sağ üstteki "↗" yuvarlak düğme notta var, ladmin'de karşılığı olan bir kart
  yok; eklenmedi (işlev ve düzen değişmesin).
- AkmanOS'tan alınıp panelde kullanılmayan bileşenler (`src/components/akmanos/**`'ın çoğu) koyu tema için gözden
  geçirilmedi; panelde kullanılanlar (profil menüsü, palet, gösterge kapsamları) belirteçlerle koyulaşır.

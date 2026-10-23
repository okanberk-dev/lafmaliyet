# Tasarım dili: L'Affogato yönetim paneli (ladmin.laffogato.net)

Panel, [AkmanOS](https://akmanos.com) kütüphanesinin (GFA Studio) açık teması ve bileşenleriyle kuruldu. Bileşenlerin
kaynağı `src/components/akmanos/` altında; her biri sitenin "Copy markdown" dışa aktarımından
(`https://akmanos.com/api/markdown/<id>`) olduğu gibi alındı (bkz. o klasördeki README). Kafenin kimliği
laffogato.net'ten geliyor: **L'Af logosu** (`src/components/brand.tsx`, `src/components/laf-paths.ts`) ve uygulama
ikonu (`src/app/icon.png`, `apple-icon.png`, `favicon.ico`).

İlke: **açık, sade, gelişmiş.** Beyaz zemin, zinc-100 kartlar, beyaz kontroller, siyah etkin durumlar, Geist yazı
tipi, yaylı (spring) küçük hareketler. Renk yalnızca anlam taşırken kullanılır.

## 1. Renk (Tailwind sınıfı → değer)

| Rol | Sınıf | Değer | AkmanOS karşılığı |
|-----|-------|-------|-------------------|
| Sayfa zemini | `bg-canvas` / `bg-background` | `#ffffff` | `--background` |
| Kontrol, kuyu, menü | `bg-surface` | `#ffffff` | `--chart-metric-bg` |
| Kart / panel | `bg-panel` | `#f4f4f5` | `--chart-card-bg` |
| İz, şerit | `bg-panel-deep` | `#e4e4e7` | `--border` |
| Mürekkep | `text-ink` | `#171717` | `--foreground` |
| İkincil metin | `text-ink-soft` | `#3f3f46` | — |
| Etiket, açıklama | `text-ink-mute` | `#71717a` | `--chart-muted` |
| Yalnızca ikon/çizgi | `text-ink-quiet` | `#a1a1aa` | — |
| Çizgi | `border-line` (%7) / `border-line-strong` (`#e4e4e7`) | | `--border` |
| Olumlu rozet | `bg-lime text-good-ink` (dolu) / `Badge tone="green"` (%25) | `#c0f21e` / `#1f3a08` | büyüme rozeti |
| Olumlu değer | `text-good` | `#3f6212` | |
| Olumsuz | `text-bad`, `bg-bad-soft` | `#dc2626` / `#fef2f2` | `red-600` / `red-50` |
| Uyarı | `text-warn`, `bg-warn-soft`, `brass-*` (turuncu ölçek) | `#c2410c` / `#fff7ed` | `#f97316` |
| Bilgi | `text-info`, `bg-info-soft` | `#2563eb` / `#eff6ff` | |
| Grafik serileri | `SERIES` (`charts.tsx`) | mavi `#2563eb`, turuncu `#e8590c`, yeşil `#16a34a` | doğrulandı |

- Birincil düğme **siyah** (`Button variant="primary"` = `bg-ink`), ikincil beyaz, vurgulu tek çağrı limon (`accent`).
- `coffee-*`, `crema`, `paper` adları eski; sayfalarda kullanılmaz. Tailwind'in `emerald/rose/amber/sky/violet`
  ölçekleri yalnızca paylaşılan bileşenlerin içinde (pastel karolar) kullanılır.
- Negatif tutar `text-bad` ya da `<Signed>`. Renk tek başına anlam taşımaz: yanında işaret, rozet metni ya da ikon.

## 2. Yazı

- **Geist Sans** her yerde (`font-sans`; `font-display` da Geist'e bağlı), rakamlar `tabular`. **Geist Mono** kod,
  kısayol (`kbd`) ve SKU gibi kimlikler için.
- Sayfa başlığı 24–28px `font-semibold tracking-tight`; kart başlığı 16px semibold; gövde 14px; etiket 13–14px
  `text-ink-mute`; büyük rakam 24px (`Stat`) ya da 30px (`Gauge`) semibold.
- Büyük harf yalnızca kenar çubuğundaki küçük "SAYFALAR" etiketi ve palet grup başlıklarında.

## 3. Kabuk (AkmanOS "App Shell" + "Sidebar")

- Solda 17.5rem zinc-100 kenar çubuğu: L'Af karosu + ad + **bildirim zili** (Ödemeler · Faturalar · Uyarılar
  başlıkları, altta Ödemeler ve Genel bakış düğmeleri; `notifications.tsx`), geniş **⌘K arama** (AkmanOS Command
  Palette: ekranlar, ürünler, hammaddeler), beyaz kapta ikon karolu menü (yaylı açılan alt listeler, fareyi izleyen
  tek vurgu), altta **profil menüsü** (sıvı metal avatar; Hesabım, Ayarlar, Yardım, laffogato.net, QR menü önizleme,
  Çıkış).
- İçerik beyaz zeminde, `max-w-[1400px]`.
- **Telefon ve tablet kabuğu (lg altı, `bottom-nav.tsx`, `sidebar.tsx`):** üstte 56px yapışkan çubuk (L'Af karosu →
  ana sayfa, sayfa başlığı, arama, zil), altta 64px + güvenli alan **alt menü**, beş öğe (`BOTTOM_NAV`; yönetici:
  Genel bakış · Bugün · Kasa · Ödemeler (gecikmiş sayısı rozeti) · Menü; personel: Bugün · Karaoke · Kasa · Zayi ·
  Reçeteler, öteki ekranları üst çubuktaki menü düğmesiyle açılan çekmecede). "Menü" kenar çubuğunun içeriğini yaylı
  çekmecede açar (odak çekmecede döner, Esc kapatır). Ekran klavyesi açıkken alt menü gizlenir.
- Kabuk değişkenleri (`globals.css`): `--mobile-nav-h` alt menünün yüksekliği (güvenli alan dahil; lg ve üstünde ve
  klavye açıkken 0): yüzen/yapışkan alt öğeler `bottom-[calc(var(--mobile-nav-h)+0.75rem)]`; `--mobile-nav-space`
  içeriğin altındaki boşluk (klavyeyle değişmez); `--mobile-top-h` üst çubuk (56px, lg ve üstünde 0): yapışkan araç
  çubukları `sticky top-(--mobile-top-h)`; `--vvh` görünür alanın yüksekliği, `--keyboard-inset` iOS'ta klavyenin
  düzenin altından örttüğü pay; `html[data-keyboard="open"]` klavye açık.
- Bildirimler (`TopLayerToaster`, `toast-layout.ts`) üst katmanda: telefonda alt menünün üstünde ("Geri al"
  başparmakta, dokunmatikte 44px); açık bir pencere varken pencerenin içinde ve ekranın üst kenarında (pencerenin
  başlığını örtmez, dokunulabilir); tablette üst çubuğun altında.
- Ana ekrana eklenebilir (`src/app/manifest.ts`, `public/icons/`); QR menü (`/menu`) bu bildirimi ve uygulama
  etiketlerini kapatır.
- Menü ağacı `src/components/panel/nav.ts` (`NAV_TREE`): Genel bakış · Bugün · Karaoke · Menü (Ürünler, Hammaddeler,
  Reçete defteri, Reçete onayları) · Satış & gider (Kasa raporları, Satışlar, Faturalar, Tedarikçiler, Gelir-gider,
  Giderler & personel, Ödemeler & hatırlatıcılar) · Stok (Stok sayımı, Zayi & ikram, Tutarlılık) · Hatırlatıcılarım ·
  Analiz & senaryo · Ayarlar (Genel ayarlar, Kullanıcılar & roller, Paraşüt entegrasyonu) · Yardım.
  Bölüm sekmeleri (`SECTION_TABS`, sayfa başında): Giderler & personel → Sabit giderler, Aylık harcamalar, Personel
  (son ikisinin menüde ayrı öğesi yok); Stok → Sayım, Tutarlılık. Personel yalnız kendi ekranlarını görür
  (`src/lib/roles.ts` STAFF_PATHS); ağacının ilk öğesi Bugün, girişte o açılır.

## 4. Bileşenler

Sayfalar önce `src/components/ui/*` ve `src/components/panel/*`'ı kullanır (bunlar AkmanOS'un görünümünü taşır);
özel bir AkmanOS bileşeni gerekiyorsa doğrudan `@/components/akmanos/<ad>`'dan alınır.

| Bileşen | AkmanOS kaynağı | Kullanım |
|---------|-----------------|----------|
| `PageHeader({ title, description, eyebrow, excel, actions, tabs })` | — | Her sayfanın başı. |
| `SectionTabs({ section, current })`, `Segmented`, `SegmentedLinks` | sidebar vurgusu | Beyaz seçili parça yaylı kayar (`layoutId`). |
| `Card`, `CardHeader({ icon, title, description, meta, actions })`, `CardContent`, `CardFooter`, `Well` | chart-card / list-table başlığı | `rounded-3xl bg-panel`; başlıkta kenarlıklı beyaz ikon kutusu. |
| `Stat({ icon, label, value, sub, tone, info, badge, children })`, `GrowthPill` | statistic-cards, growth-badge | `rounded-2xl bg-panel p-3.5`, kenarlıklı ikon kutusu, 24px rakam, limon/kırmızı rozet. |
| `StatBreakdown({ title, description, groups, total, empty, children })` (`ui/stat-breakdown.tsx`) | — | Stat kartını görünümünü değiştirmeden tıklanır yapar (sağ üstte "Döküm ›"); dokununca o rakamın dökümü `Dialog`'da açılır (satırlar büyükten küçüğe, pay %, toplam satırı; kafe dışı ayrı grup). Faturalar, Tedarikçiler, Aylık harcamalar ve Gelir-gider kartlarında; veri sunucuda `src/lib/breakdown.ts` ile hazırlanır. |
| `TableWrap`, `Table`, `TH`, `TR`, `TD`, `TFootRow`, `SortButton` | user-list-table / product-list-table | Kalın 14px başlık, ⇅ sıralama, ince satır çizgisi. |
| `Pagination`, `usePaged` | list-table/pagination | "Sayfa 1 / 6", koyu etkin sayfa. |
| `IconButton({ label, tone })` | list-table/icon-action-button | Satır eylemleri: göz, kalem, kırmızı çöp. |
| `Badge({ tone, dot })`, `StatusBadge` | hap rozetler | 11px. |
| `IconTile`, `Avatar`, `toneFor` | avatar karoları | %15 renkli zemin; ton sırası 0 yeşil · 1 turuncu · 2 mavi · 3 kırmızı · 4 mor · 5 gök. |
| `ActivityList`, `ActivityItem({ icon, tone, title, description, aside, href, dot })` | recent-activity | iOS doygun ikon kuyuları, mavi okunmamış noktası. |
| `TASK_STYLE`, `TASK_BAR` (`src/app/panel/task-style.tsx`) | — | İş listelerinin durum görünümü (Tamam, Yapılacak, Sorun var, Sonra: ikon, kuyu rengi, rozet, özet şeridi). Genel bakış'ın "Bu ayın işleri" ve Bugün'ün "Yapılacaklar" kartı ortak kullanır; sunucu ve istemci bileşenleri içe aktarır. |
| `Gauge({ value, target, label, display, tone })` | gauge | Siyahtan griye çubuklar, açılışta dolar; hedef turuncu işaret. |
| `SegmentStrip({ segments })` | system-status-page | 12 aylık kâr/zarar şeridi. |
| Isı haritası (`karaoke/doluluk/heatmap.tsx`) | — | Tek renk (mürekkep) beş basamak: `ink/[.06]`, `/20`, `/40`, `/65`, `/90` (son ikisinde beyaz yazı); kapalı saat beyaz zeminde 45° tarama, oda saatleri dışında dolu hücrede nokta. Renk tek başına anlam taşımaz: rakam hücrede (boş hücre yazısız; sütun çoksa xl altında gizli), her hücre düğme, seçilenin ayrıntısı altta (`aria-live`; telefonda alt menünün üstünde asılı). Telefonda satırlar saat, sütunlar gün (yatay kaydırma yok). |
| `EmptyState({ title, description, action, icon })` | empty-state | Süzülen kayıt kartı yığını. |
| `Dialog` | — | `rounded-3xl`, gölge `0 12px 40px rgba(0,0,0,.14)`. Telefonda (sm altı) alttan açılan sayfa: tutamaçtan aşağı çekince kapanır, altbilgi düğmeleri 48px ve satırı eşit paylaşır; `footerStartOnPhone="body"` ikincil eylemleri (Sil, Durdur) formun sonuna alır. Dokunmatikte alan kendiliğinden odaklanmaz (`data-autofocus="always"` hariç). |
| `Fab` (`ui/fab.tsx`) | — | Telefon ve tabletin yüzen ekleme düğmesi: alt menünün üstünde, aşağı kaydırırken ve klavye açıkken gizlenir. |
| `FloatingBar` | — | Kaydedilmemiş değişiklik çubuğu; açıkken sayfanın sonuna çubuk kadar boşluk eklenir. |
| `@/components/akmanos/range-slider` | range-slider | Senaryo ve fiyat simülatöründe kaydırıcılar. |
| `@/components/akmanos/bouncy-accordion` | bouncy-accordion | Yardım sayfasında SSS. |
| `@/components/akmanos/bounce-sidebar` (`BounceSidebarNav`) | bounce-sidebar | Uzun ayar sayfalarında bölüm gezinmesi. |
| `@/components/akmanos/streak` | streak | Şu an kullanılmıyor (sayım yapılan aylar için ayrılmış desen). |
| `@/components/akmanos/capacity-allocation-card`, `agent-limits-card` | bölümlü kullanım çubuğu | Gider dağılımı gibi parçalı toplamlar için desen. |
| `charts.tsx` | — | Recharts; serileri `SERIES[i]` ile, grafikler `Well` içinde. |

## 5. Sadeleştirme ilkeleri

1. **Her şey kalır, gürültü gider.** Excel'deki her alan, hesap ve eylem yerinde kalır; tekrar eden açıklamalar
   `InfoTip`'e, nadir ayrıntı sekmeye ya da `<details>`'e.
2. **Bir ekranda bir soru**: en üstte o ekranın asıl cevabı.
3. **Liste = AkmanOS tablosu**: başlıkta ikon + ad + sayaç, sağda küçük düğmeler, tek satır arama/filtre, satır sonu
   ikon eylemleri, sayfalama, boş durum.
4. **Hareket ölçülü**: yaylı vurgu, açılış dolması, sırayla belirme; `prefers-reduced-motion`'a uyulur.
5. **Erişilebilirlik**: ikon düğmelerinde `label`, alanlarda etiket, görünür odak (`ring-ink/30`).

## 6. Telefon desenleri

- **Dokunma alanı en az 44px** (`pointer-coarse:`): `Button`, `IconButton`, `Input`/`Select`, `SearchField`,
  `FilterChip`, `InfoTip` (görünmez kenarla) bunu kendisi verir; sayfalar `pointer-coarse:h-10`/`size-10` geçmez.
- **Listeler:** sm (ya da tablo genişse md/lg) altında tablo yerine kart; kart her değeri tablo kadar gösterir.
  Sayfa değişince liste başı ekrana gelir (`Pagination`, `[data-page-top]`).
- **Süzgeçler:** arama + "Süzgeç" düğmesi + etkin süzgeç çipleri; seçimler alttan açılan sayfada (Ürünler,
  Hammaddeler: `urunler/filter-sheet.tsx`; Faturalar, Satışlar, Gelir-gider: `ui/mobile-filters.tsx`).
- **Gelir-gider** telefonda tek ay görünümü (ay seçici yapışkan), hücre düzenleme alttan açılan sayfada.
- Yazı alanları telefonda en az 16px (iOS yakınlaştırmasın); eksi değer girilebilecek alanlarda `inputMode="text"`
  (iOS ondalık klavyesinde eksi yok), gün sayısı gibi tam sayılarda `inputMode="numeric"`.
- Masaüstü yardım metni ("tıklayın", "Enter kaydeder") telefonda dokunmaya göre yazılır.

### Telefonda uygulama hissi (kontrol listesi)

- Görünüm: `viewport-fit=cover`, `interactive-widget=resizes-content` (`src/app/layout.tsx`); yakınlaştırma asla
  kapatılmaz (`user-scalable=no`, `maximum-scale` yok).
- Dokunma vurgusu yok (`-webkit-tap-highlight-color: transparent`); basılan düğme hafifçe küçülür (`active:scale-[0.98]`).
- Kontrollerde `touch-action: manipulation`: dokunuşa beklemeden tepki.
- Düğme, sekme, anahtar, seçenek, menü öğesi ve açılır başlığın yazısı seçilmez, uzun basınca balon açılmaz
  (`globals.css`); içerik (IBAN, fatura no, tutar) seçilebilir kalır, `body`'ye asla.
- `text-size-adjust: 100%`: iOS yan çevrilince yazıyı büyütmez.
- Kabuk ve pencere yükseklikleri `dvh`; `100vh` / `h-screen` yok.
- Güvenli alan payı (`env(safe-area-inset-*)`): alt menü, üst çubuk, çekmece, alttan açılan pencere, bildirim, yüzen
  çubuk.
- Pencere, zil, ⌘K, çekmece ve pencere içindeki kayan listeler `overscroll-contain`; sayfanın dikey yenilemesi kalır
  (kökte yalnız `overscroll-behavior-x: none`).
- Üzerine gelme yalnız `(hover: hover)` ile: Tailwind'in `hover:` öneki zaten öyle; elle yazılan `:hover` (ör.
  `has-[…:hover]`) `[@media(hover:hover)]:` ile sarılır.
- Sayı alanlarında `inputMode` (yukarıdaki kural); dokunmatikte yazı alanı en az 16px.
- Açık tema: `themeColor` beyaz, `colorScheme: light`.
- **Son kontrol gerçek telefonda** (iPhone Safari, Android Chrome): yazı büyütme, uzun basma, kopyalama ve klavye
  tarayıcının telefon görünümünde denenemez.

## 7. Kodlama kuralları (Next.js 16)

- `cacheComponents` açık: veritabanı, çerez ya da `searchParams` okuyan her şey `<Suspense>` içinde; sayfa bileşeni
  senkron, içerik `async function …Content()` içinde.
- `PageProps<"/panel/...">` ve `LayoutProps` tipleri (`npx next typegen`).
- Sunucu eylemleri (`src/server/actions/*`) ve hesaplama motoru (`src/lib/calc/*`) görünüm işinde değişmez.
- `src/components/akmanos/**` ESLint dışında (olduğu gibi alınmış kaynak); TypeScript denetiminden geçer.

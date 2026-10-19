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

- Solda 17.5rem zinc-100 kenar çubuğu: L'Af karosu + ad + **bildirim zili** (son ayın uyarıları), geniş **⌘K
  arama** (AkmanOS Command Palette: ekranlar, ürünler, hammaddeler), beyaz kapta ikon karolu menü (yaylı açılan alt
  listeler, fareyi izleyen tek vurgu), altta **profil menüsü** (sıvı metal avatar; Hesabım, Ayarlar, Yardım,
  laffogato.net, QR menü önizleme, Çıkış).
- İçerik beyaz zeminde, `max-w-[1400px]`. Mobilde üst çubuk + yaylı çekmece.
- Menü ağacı `src/components/panel/nav.ts` (`NAV_TREE`): Genel bakış · Menü (Ürünler, Hammaddeler, Reçete defteri) ·
  Satış & gider (Satışlar, Faturalar, Gelir-gider, Giderler & personel) · Stok (Stok sayımı, Tutarlılık) ·
  Analiz & senaryo · Ayarlar · Yardım. Personel yalnızca Reçete defteri ve Stok sayımı'nı görür.

## 4. Bileşenler

Sayfalar önce `src/components/ui/*` ve `src/components/panel/*`'ı kullanır (bunlar AkmanOS'un görünümünü taşır);
özel bir AkmanOS bileşeni gerekiyorsa doğrudan `@/components/akmanos/<ad>`'dan alınır.

| Bileşen | AkmanOS kaynağı | Kullanım |
|---------|-----------------|----------|
| `PageHeader({ title, description, eyebrow, excel, actions, tabs })` | — | Her sayfanın başı. |
| `SectionTabs({ section, current })`, `Segmented`, `SegmentedLinks` | sidebar vurgusu | Beyaz seçili parça yaylı kayar (`layoutId`). |
| `Card`, `CardHeader({ icon, title, description, meta, actions })`, `CardContent`, `CardFooter`, `Well` | chart-card / list-table başlığı | `rounded-3xl bg-panel`; başlıkta kenarlıklı beyaz ikon kutusu. |
| `Stat({ icon, label, value, sub, tone, info, badge, children })`, `GrowthPill` | statistic-cards, growth-badge | `rounded-2xl bg-panel p-3.5`, kenarlıklı ikon kutusu, 24px rakam, limon/kırmızı rozet. |
| `TableWrap`, `Table`, `TH`, `TR`, `TD`, `TFootRow`, `SortButton` | user-list-table / product-list-table | Kalın 14px başlık, ⇅ sıralama, ince satır çizgisi. |
| `Pagination`, `usePaged` | list-table/pagination | "Sayfa 1 / 6", koyu etkin sayfa. |
| `IconButton({ label, tone })` | list-table/icon-action-button | Satır eylemleri: göz, kalem, kırmızı çöp. |
| `Badge({ tone, dot })`, `StatusBadge` | hap rozetler | 11px. |
| `IconTile`, `Avatar`, `toneFor` | avatar karoları | %15 renkli zemin; ton sırası 0 yeşil · 1 turuncu · 2 mavi · 3 kırmızı · 4 mor · 5 gök. |
| `ActivityList`, `ActivityItem({ icon, tone, title, description, aside, href, dot })` | recent-activity | iOS doygun ikon kuyuları, mavi okunmamış noktası. |
| `Gauge({ value, target, label, display, tone })` | gauge | Siyahtan griye çubuklar, açılışta dolar; hedef turuncu işaret. |
| `SegmentStrip({ segments })` | system-status-page | 12 aylık kâr/zarar şeridi. |
| `EmptyState({ title, description, action, icon })` | empty-state | Süzülen kayıt kartı yığını. |
| `Dialog` | — | `rounded-3xl`, gölge `0 12px 40px rgba(0,0,0,.14)`. |
| `@/components/akmanos/range-slider` | range-slider | Senaryo ve fiyat simülatöründe kaydırıcılar. |
| `@/components/akmanos/bouncy-accordion` | bouncy-accordion | Yardım sayfasında SSS. |
| `@/components/akmanos/bounce-sidebar` (`BounceSidebarNav`) | bounce-sidebar | Uzun ayar sayfalarında bölüm gezinmesi. |
| `@/components/akmanos/streak` | streak | Stok sayımı düzeni (sayım yapılan aylar). |
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

## 6. Kodlama kuralları (Next.js 16)

- `cacheComponents` açık: veritabanı, çerez ya da `searchParams` okuyan her şey `<Suspense>` içinde; sayfa bileşeni
  senkron, içerik `async function …Content()` içinde.
- `PageProps<"/panel/...">` ve `LayoutProps` tipleri (`npx next typegen`).
- Sunucu eylemleri (`src/server/actions/*`) ve hesaplama motoru (`src/lib/calc/*`) görünüm işinde değişmez.
- `src/components/akmanos/**` ESLint dışında (olduğu gibi alınmış kaynak); TypeScript denetiminden geçer.

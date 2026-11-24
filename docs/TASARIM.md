# Tasarım dili: L'Affogato yönetim paneli (ladmin.laffogato.net)

Panel, [AkmanOS](https://akmanos.com) kütüphanesinin (GFA Studio) açık teması ve bileşenleriyle kuruldu. Bileşenlerin
kaynağı `src/components/akmanos/` altında; her biri sitenin "Copy markdown" dışa aktarımından
(`https://akmanos.com/api/markdown/<id>`) olduğu gibi alındı (bkz. o klasördeki README). Kafenin kimliği
laffogato.net'ten geliyor: **L'Af logosu** (`src/components/brand.tsx`, `src/components/laf-paths.ts`) ve uygulama
ikonu (`src/app/icon.png`, `apple-icon.png`, `favicon.ico`).

İlke: **açık, sade, gelişmiş.** Beyaz zemin, zinc-100 kartlar, beyaz kontroller, siyah etkin durumlar, Geist yazı
tipi, yaylı (spring) küçük hareketler. Renk yalnızca anlam taşırken kullanılır.

**Koyu tema** (Sistem / Açık / Koyu; finans paneli görünümü): [KOYU-TEMA.md](KOYU-TEMA.md). Aşağıdaki tablo açık
temanın değerleridir; sınıflar aynı kalır, koyu değerler `html.dark` altında. Dolu `bg-ink` üstünde yazı `text-on-solid`,
ana eylem `bg-primary text-on-primary` (açıkta ikisi de eski siyah / beyaz).

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
| Uyarı kutusunun mürekkebi (kırmızı) | `text-bad-ink` | `#b91c1c` (bad-soft üstünde 5,91; beyazda 6,47) | |
| Uyarı kutusunun mürekkebi (turuncu) | `text-warn-ink` | `#9a3412` (warn-soft üstünde 6,88; beyazda 7,31) | |
| Nötr not zemini | `bg-note` | `rgb(23 23 23 / 0.045)` (beyazda `#f5f5f5`, panelde `#eaeaeb` gibi) | |
| Grafik serileri | `SERIES` (`charts.tsx`) | mavi `#2563eb`, turuncu `#e8590c`, yeşil `#16a34a` | doğrulandı |

- Birincil düğme **siyah** (`Button variant="primary"` = `bg-ink`), ikincil beyaz, vurgulu tek çağrı limon (`accent`).
- `coffee-*`, `crema`, `paper` adları eski; sayfalarda kullanılmaz. Tailwind'in `emerald/rose/amber/sky/violet`
  ölçekleri yalnızca paylaşılan bileşenlerin içinde (pastel karolar) kullanılır.
- Negatif tutar `text-bad` ya da `<Signed>`. Renk tek başına anlam taşımaz: yanında işaret, rozet metni ya da ikon.
- Uyarı kutusunda metin `text-bad` / `text-warn` ile yazılmaz: açık zeminde AA'nın altında ya da sınırında
  (`text-bad` bad-soft üstünde 4,41); kutunun mürekkebi `text-bad-ink` / `text-warn-ink`, başlık `text-ink`.
- **Mavi (`bg-info-soft`) uyarı rengi değildir**: yalnız seçim, hücre ve rozet. Bilgi notu nötr (`bg-note`).

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
  Genel bakış · Bugün · Kasa · Ödemeler (gecikmiş sayısı rozeti) · **Tümü**, panel asistanı açıkken Bugün · Kasa ·
  **Asistan** · Ödemeler · Tümü (Genel bakış üst çubuğun L'Af karosunda ve çekmecede; docs/ASISTAN.md › Telefonda); personel: Bugün · Karaoke · Kasa · Zayi ·
  Reçeteler, öteki ekranları üst çubuktaki menü düğmesiyle açılan çekmecede). "Tümü" kenar çubuğunun içeriğini yaylı
  çekmecede açar (odak çekmecede döner, Esc kapatır; yalnız etkin grup açık gelir, etkin satır kutunun içine kayar). Ekran klavyesi açıkken alt menü gizlenir.
- Kabuk değişkenleri (`globals.css`): `--mobile-nav-h` alt menünün yüksekliği (güvenli alan dahil; lg ve üstünde ve
  klavye açıkken 0; yapılmamış hatırlatmaların köşe kartı açıkken kartın yüksekliği kadar fazlası, `--reminder-dock-h`,
  docs/HATIRLATICILAR.md): yüzen/yapışkan alt öğeler `bottom-[calc(var(--mobile-nav-h)+0.75rem)]`; `--mobile-nav-space`
  içeriğin altındaki boşluk (klavyeyle değişmez); `--mobile-top-h` üst çubuk (56px, lg ve üstünde 0): yapışkan araç
  çubukları `sticky top-(--mobile-top-h)`; `--vvh` görünür alanın yüksekliği, `--keyboard-inset` iOS'ta klavyenin
  düzenin altından örttüğü pay; `html[data-keyboard="open"]` klavye açık.
- Bildirimler (`TopLayerToaster`, `toast-layout.ts`) üst katmanda: telefonda alt menünün üstünde ("Geri al"
  başparmakta, dokunmatikte 44px); açık bir pencere varken pencerenin içinde ve ekranın üst kenarında (pencerenin
  başlığını örtmez, dokunulabilir); tablette üst çubuğun altında.
- Ana ekrana eklenebilir (`src/app/manifest.ts`, `public/icons/`); QR menü (`/menu`) bu bildirimi ve uygulama
  etiketlerini kapatır.
- Menü ağacı `src/components/panel/nav.ts` (`NAV_TREE`; konu başlıkları 26 Eki 2026, adlar 29 Eki 2026,
  [planlar/ux-sade.md](planlar/ux-sade.md) §3). Yönetici: en sık açılan dört ekran tek tıkla üst düzeyde, **Genel bakış
  · Bugün · Onaylar · Kasa raporu**; gerisi konu başlıkları altında: **Kafe** (Karaoke, Kontrol listeleri, Satış
  tahmini, Hatırlatıcılarım) · **Menü** (Ürünler & kârlılık, Fiyatlar, Hammaddeler, Reçete defteri) · **Stok** (Stok
  sayımı, Zayi & ikram, Tutarlılık) · **Satış** (Satışlar, Komisyon & hakediş, Analiz & senaryo) · **Alış & gider**
  (Faturalar, Tedarikçiler, Giderler & maaşlar) · **Kâr & ödemeler** (Gelir-gider, Ödemeler, Nakit planı) · **Vergi,
  KDV, SGK** (Özet, Vergi kârı, Demirbaş, Muhasebeci) · **Ayarlar** (Genel ayarlar, Kullanıcılar & roller, Paraşüt
  entegrasyonu) · Yardım. Kapalıyken "KDV" sözcüğü görünür; "Vergi, KDV, SGK" ve "Kâr & ödemeler" kesilmeden sığar.
  Önce işletme (Kafe, Menü, Stok), sonra para (gelen, giden, kâr, devlete). Başlık satırı yalnız grubu açıp kapatır,
  kendisi bir ekran açmaz; etkin sayfanın grubu kendiliğinden açık (`activeGroupOf`; alt ekran ve sekme de: Aylık
  harcamalar ve Maaşlar Alış & gider'i açar), başka bölüme gidince önceki grup açık kalır (`keepGroupOpen`). Grup
  içinde aynı anda **tek alt öğe** yanar: adresle eşleşenlerden en uzun `href` (`activeChildOf`; Nakit planı'nda
  Ödemeler, Fiyatlar'da Ürünler yanmaz). Etkin satır kenar çubuğunun kaydırma kutusunun içine getirilir (`revealDelta`).
  Bir grup iki ile beş alt sayfa tutar; yeni ekran uygun başlığın altına girer, sık açılmıyorsa yeni üst düzey öğe
  açılmaz. Personelin ağacı: Bugün · Karaoke · Kasa raporu · Kontrol listeleri · Özel günler · Reçete defteri · Stok
  (Stok sayımı, Zayi & ikram) · Hatırlatıcılarım · Yardım; tek alt sayfası kalan grup o sayfanın bağlantısına döner
  (`navTreeFor`: personelde Menü → Reçete defteri), alt sayfası kalmayan başlık hiç çizilmez. Komut paleti
  (`NAV_GROUPS` + `NAV_FOOTER`) aynı başlıklarla aynı sırada; kare adresli kayıtlar ("KDV" → `/panel/vergi#kdv`, "SGK
  primi", "Kâr / zarar", "SGK oranı", "İşlem geçmişi", "Yedek" …) var olan bir çapaya iner, eski adlar `keywords`'te
  (kas hafızası aramayla bulur); aksanlı sorgu ("kâr") aksanlı başlığı öne alır.
- **Bir ekran bir ad:** kenar çubuğu = H1 = ⌘K; sekme ve telefon üst çubuğu yalnız kısaltabilir ("Ürünler & kârlılık" →
  "Ürünler"). Grubun giriş ekranı ağaçta ve sekmede "Özet" olabilir, H1'i grubun adıdır ("Vergi, KDV, SGK").
  `metadata.title` H1'le aynı. `tests/sayfa-basligi.test.ts` tutar.
- **Bağlam satırı** (H1'in üstündeki küçük satır): elle yazılmaz, ağaçtan türer (`groupLabelOf(path, role)`: bu adresi
  açan grubun adı); üst düzey ekranda ve grubun adını taşıyan giriş ekranında çizilmez, telefonda hiç yok (üst çubuk
  adı yazıyor). Başlıklarda "Excel: …" yok; Excel karşılığı Yardım'ın "Ekranlar" tablosunda ve ⌘K alt satırında.
  `tests/kenar-cubugu.test.ts` iki ağacı, tek tıkla açılan ekranları, `src/app/panel` altındaki her ekranın menüden
  açıldığını ve paletin her ekranının rolünün ağacında da olduğunu sabitler.
  Bölüm sekmeleri (`SECTION_TABS`, sayfa başında): Giderler & maaşlar → Sabit giderler, Aylık harcamalar, Maaşlar
  (son ikisinin menüde ayrı öğesi yok); Ödeme → Ödemeler, Nakit planı; Vergi → Özet, Vergi kârı, Demirbaş, Muhasebeci
  (ağaçtan); Stok → Sayım, Zayi & ikram, Tutarlılık: kenar çubuğunun Stok grubundan türer
  (aynı sıra, aynı roller; denetim E-56), üç sayfada da çizilir, personel Sayım ve Zayi & ikram'ı görür (`sectionTabsFor`,
  tek sekme kalırsa çubuk çizilmez; sayfa yüklenirken iki rolün ortak sekmeleri, yükleme başlığı yüklenen başlıkla aynı
  boyda: açıklama ve ay seçicinin yeri iskeletle tutulur, sekme satırı içerik gelince kaymaz). Kaldırılan ekranların eski adresleri
  (`/panel/hizli-sayim/**`, `/panel/mal-siparisi/**`) Stok sayımı'na yönlenir (`src/lib/roles.ts` › `retiredRedirect`,
  proxy). Kontrol listeleri bölüm
  sekmesi yerine kendi sekmelerini taşır (`SegmentedLinks`: Bugün · Geçmiş · Listeler, yalnız yönetici). Personel
  yalnız kendi ekranlarını görür
  (`src/lib/roles.ts` STAFF_PATHS); ağacının ilk öğesi Bugün, girişte o açılır.

## 4. Bileşenler

Sayfalar önce `src/components/ui/*` ve `src/components/panel/*`'ı kullanır (bunlar AkmanOS'un görünümünü taşır);
özel bir AkmanOS bileşeni gerekiyorsa doğrudan `@/components/akmanos/<ad>`'dan alınır.

| Bileşen | AkmanOS kaynağı | Kullanım |
|---------|-----------------|----------|
| `PageHeader({ title, description, path, role, more, meta, actions, tabs })` | — | Her sayfanın başı. Bağlam satırı `path` ve `role`'den (ağaç); açıklama tek cümle, "ne yaparsınız", ≤ 100 harf; eski uzun metin `more` ile ⓘ "Nasıl çalışır?" içinde (yalnız yönetici ekranında); `meta` açıklamanın altında tek satır (satış kaynağı: `SalesSourceLine`, `src/lib/sales-source.ts`). |
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
| `FaqChat({ items, value, onValueChange, anchors })` (`ui/faq-chat.tsx`) | rare-ui faq (uyarlama) | Yardım'ın "Nasıl yapılır?" listesi (yönetici ve personel): soru solda beyaz balon (başında tek renk konu ikonu), açılınca siyah; cevap sağda `bg-brand-100` balonda L'Af karosuyla, bağlantılar balonun içinde. Kapalı cevap DOM'da yok, her soru sunucu HTML'inde; soru kimliği çapa (`/panel/yardim#claude`). ↑ ↓ Home End sorular arasında; `useCalmMotion`. |
| `NotificationBell({ count, badgeClassName })` (`ui/notification-bell.tsx`) | rare-ui notification-bell (uyarlama) | Kenar çubuğu ve üst çubuktaki zilin tetiği (`notifications.tsx`): lucide zil çizimi, okunmamış sayısı sayfa açıkken artınca tepesinden sallanır, dili gecikmeyle izler; rozet panelin siyah rozeti, rakamı kayan sayaçla döner, 9'dan fazlası "9+". İlk okuma (`count` null → sayı) çaldırmaz. Etiket "Bildirimler, N okunmamış"; `useCalmMotion`. |
| `ToastIcon`, `TOAST_ICONS` (`ui/toast-icon.tsx`) | rare-ui toast (uyarlama) | Bildirim kartının (sonner) 36 px ikon karosu; `TopLayerToaster` sonner'ın `icons`'ıyla verir, `toast.*` çağıranlar değişmedi. Karo rengi `TONE_TILE` (bilgi nötr), işaret kart oturunca çizilir; "yükleniyor"dan sonuca geçişte bir kez kabarır. Kart 21 px köşe, `--shadow-lift`, eylem düğmesi gri (dokunmatikte 44 px), kapat farede üstüne gelince görünür (globals.css › "Bildirim kartı"); hareket azaltmada duruk. |
| `PasswordInput({ value, visible, onVisibleChange, toggle, strength, plain, after })` (`ui/password-input.tsx`), `FloatingPasswordField` (`giris/auth-ui.tsx`) | rare-ui password-input (uyarlama) | Paneldeki her parola alanı (giriş, Claude bağlantı onayı, davet / sıfırlama, Hesabım, kullanıcı ekle / düzenle, parola onay penceresi). Gizliyken karakterler DOM'a hiç yazılmaz (alan React'e `value` olarak verilmez, `value` özniteliği de yok); göster / gizle anında noktalar harfe dönüşür, göz kapağı açılır. "Parolayı göster" / "Parolayı gizle", 44 px. Parola gücü yalnız yeni parola alanında: "Parola gücü" Zayıf / Orta / İyi / Güçlü (`passwordProblem` ile uyumlu). |
| `@/components/akmanos/bouncy-accordion` | bouncy-accordion | Şu an kullanılmıyor (Yardım'ın SSS'i 24 Kas 2026'dan beri `FaqChat`). |
| `@/components/akmanos/bounce-sidebar` (`BounceSidebarNav`) | bounce-sidebar | Uzun ayar sayfalarında bölüm gezinmesi. |
| `@/components/akmanos/streak` | streak | Şu an kullanılmıyor (sayım yapılan aylar için ayrılmış desen). |
| `@/components/akmanos/capacity-allocation-card`, `agent-limits-card` | bölümlü kullanım çubuğu | Gider dağılımı gibi parçalı toplamlar için desen. |
| `charts.tsx` | — | Recharts; serileri `SERIES[i]` ile, grafikler `Well` içinde. |
| `YearLineChart`, `DailyRevenueBars`, `MoneySparkline` (`panel/arc-charts.tsx`) | [Arc UI](https://uiarc.dev) ücretsiz `line-chart`, `bar-chart`, `sparkline` (`src/components/arc/`, README) | Genel bakış'ın yıllık gelir-gider çizgisi ve ayın günlük ciro çubukları (ortalama çizgisi, kasa raporlarından), Bugün'ün şube kartında son sekiz gün. İstemci sarmalayıcısı biçimleyiciyi (`tl`) ve renkleri taşır; sunucu yalnız düz veri verir. Arc belirteçleri yalnız `.arc` kabında (`arc/foundation.css`, AkmanOS değerleriyle; panel düzeni içe aktarır); seriler `SERIES` ile aynı renkler. CSS modülleri Tailwind yükleyicisinden geçmez (`next.config.ts`). |
| `Notice({ tone, title, text, children, tech, action, risk, size, live, defaultOpen })`, `NoticeGroup`, `NoticeLink`, `foldPlan`, `TONE_ICON`, `TONE_LABEL`, `TONE_TILE` (`ui/notice.tsx`) | — | Panelin **tek uyarı bileşeni** (ayrıntı aşağıda). Dört ton (bad · warn · neutral · good), üç boy (md sayfa, sm kart ve pencere içi, line kutusuz satır), başlık + isteğe bağlı ikinci satır + kapalı "Ayrıntı" + tek eylem. Sunucu bileşeni, `<details>` ile JavaScript'siz açılır. Zil, "Dikkat edilmesi gerekenler" kartı ve iş listeleri ikon ve kuyuyu `TONE_ICON` / `TONE_TILE`'dan alır. |

### Uyarılar (`Notice`)

Elle renkli kutu, elle uyarı ikonu ve elle `role="alert|status|note"` yazılmaz; uyarı `Notice`'tir
(`tests/uyari-goc.test.ts` bekçisi; izinli istisnalar orada: rozet, hap, form içi onay bloğu, başlık ikonu). Alanın
kendi hata satırı (`Field`), rozetler, toast'lar, `ErrorView` ve `ConfirmDialog` bileşenin dışındadır.

**Ton seçme kuralı** (yukarıdan aşağı, ilk "evet" kazanır):

| Soru | Ton | `risk` | Eylem |
|---|---|---|---|
| İşlem yapılamadı, kaydedilmedi, okunamadı | `bad` (kullanıcının eylemine cevapsa `live="assertive"`) | – | yeniden dene / düzelt |
| Para, yasal son gün ya da barın işleyişi **şimdi** bozuk (gecikmiş ödeme, kasa eksiği, sipariş gelmiyor, onaylanamaz istek) | `bad` | varsa yaz | varsa |
| Ay sonu rakamını bozan eksik veri, çift sayılma riski, geri alınamaz işlemden önceki dikkat, onay bekleyen istek, oran farkı | `warn` | para / hukuk / veri sonucu varsa **zorunlu** | **zorunlu**: `action` ya da `text`'te ne yapılacağı |
| Durum, kurulum, bağlantı, kaynak, tahmin kalitesi, nasıl çalışır | `neutral` | – | isteğe bağlı |
| Tutarlı, tamam, kaydedildi | `good` | – | – |

- **Kompakt hâl parayı, son günü, kaybı asla gizlemez**: tutar, gün ve sonuç başlıkta (≤ 10 sözcük, sonda nokta yok);
  ikinci satır (`text`, ≤ 18 sözcük) ne yapılacağı; "Ayrıntı"ya yalnız neden, varsayım, liste.
- `risk` (para · hukuk · veri · bar) taşıyan `warn` ve her `bad` **hiç katlanmaz**; aynı yerdeki birden çok uyarı
  `NoticeGroup`'ta, ötekilerden ilk ikisi görünür, kalanı "+{n} uyarı daha" (`foldPlan`).
- `<details>` kapalı başlar; açık başlar yalnız satır başına eylemi olan liste ve kullanıcının eylemine cevap veren
  hata dökümü (`defaultOpen`).
- Rol: `live` yoksa `note`, `polite` → `status`, `assertive` → `alert`; `live` yalnız istemcide sonradan beliren
  uyarıya, sayfayla sunucudan gelene hiç verilmez. Ayrıntısı olan canlı uyarıda rol kökten başlık + ikinci satır
  sarmalayıcısına iner: "Ayrıntı" ve eylem canlı bölgenin dışında (canlı bölge atomiktir; açıp kapamak bütün uyarıyı
  yeniden okuturdu). Her tonun kendi ikon şekli ve başlığın başında ekran okuyucu öneki ("Önemli: ", "Dikkat: ",
  "Bilgi: ", "Tamam: ") var.
- Yerleşim: eylem başlığın sağında, sığmazsa ikon hizasına iner; başlık ve eylem satırda dikeyde ortalı. Telefonda
  eylem ve "Ayrıntı" birlikteyse ikisi aynı (ikinci) satırda: solda "Ayrıntı ⌄", sağda eylem; açılınca gövde tam
  genişlikte, eylem onun altına iner, özet yerinde kalır. Eylemin görünmez dokunma kenarı komşu özetinkinin üstündedir.
  `NoticeLink` satır yüksekliğinde (20 px) + 12 px kenar = 44 px; "Teknik ayrıntı" özeti 16 + 2 × 14 = 44 px ve
  metni `text-ink-soft` (12 px'te `text-ink-mute` nötr kutunun panel zemininde 4,4:1).
- Vergi bandı (`TaxBanner`, `vergi/ui.tsx`) uyarı değil, kutusuz tek satır `role="note"`: "Tahmin, beyanname değil" +
  ⓘ (tam feragat), kapsam çipi, Muhasebeci çipi. Bekçide izinli tek elle rol; tam metin Muhasebeci'nin sonunda bir kez
  ([VERGI.md](VERGI.md) §3.2).
- Geliştirici dili (anahtar adı, Vercel, komut, `docs/…` yolu) yalnız `tech`'te ("Teknik ayrıntı (geliştirici
  için)", Ayrıntı'nın içinde kapalı); personelin açtığı ekranda `tech` hiç verilmez, yönetici talimatı yerine "sorun
  sürerse yöneticiye haber verin". Turuncu yalnız uyarıdır: iş listelerinin "Yapılacak" durumu gri.

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
- **Uyarı bütçesi** (390×844): sayfanın asıl cevabından önce katlanabilir uyarı (`bad` ve `risk` taşıyanlar hariç)
  + iş listesi + ipucu toplamı ≤ 90 px (Genel bakış ≤ 300, Bugün ≤ 340); 1440×900'de ≤ 60 px. Katlanamayan uyarılar
  bütçeye girmez ama her biri Ayrıntı kapalıyken ≤ 60 px. Eylem başlığın yanına sığmazsa ikon hizasına iner; kutu
  iki satırı geçmez. Ölçü `[data-notice]` / `[data-risk]` öznitelikleriyle (docs/planlar/ux-sade.md §13).
- **Yüzen öğe içerik örtmez**: sesli uyarıların kilidi sayfanın içinde (`#ses-yuvasi`, `Notice` "Sesli uyarılar
  kapalı" + "Sesi aç"). Ses ilk dokunuşta açılır ama satır o anda kalkmaz: sayfa değişene kadar aynı yükseklikte
  "Sesli uyarılar açık" olarak kalır (`soundRow`, `src/lib/live-poll.ts`), içerik dokunuşun altında kaymaz. İş
  listelerinde telefonda sıradaki iş tam kart, ötekiler "Diğer {n} iş" arkasında (sıradaki iş yoksa hepsi tek satır,
  düğme yok); Bugün'de "Sonra (n)", "Tamamlananlar (n)" ve "Ayın işleri" bağlantısı en altta yan yana tek satır.

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
- **Uzun formda her tuş yalnız yazılan satırı çizer** (Stok sayımı, ~72 kalem; denetim E-21): satır `memo`'lu ve
  yalnız kendi değerini alır (`CountRow`), işleyiciler sabittir (`useCallback`, işlevsel `setState`); sayaçlar,
  toplamlar ve FIFO payı `useDeferredValue` ile tuşlar arasında boşta güncellenir, döküm yalnız penceresi açılınca
  kurulur (`StatBreakdown`'a işlev olarak). Ekranda olmayan sayaç ve tutar kaymaz; telefonda gizli kalacak parça
  (masaüstü kaydetme kapsülü, "Tümü / Sayılmayanlar" seçicisi) hiç kurulmaz. Kaydetme ve taslak ertelenmiş değeri
  değil, güncel değeri kullanır. Ölçü (27 Eki 2026, üretim derlemesi, 390 px, 4× yavaş işlemci, Playwright Event
  Timing, aynı makinede önce / sonra): tuş olayının ortancası yönetici 144-264 → 72-136 ms, personel 128-184 → 64-80
  ms; odaklandıktan sonraki ilk tuş 352-680 → 120-224 ms. Kalan süre çoğunlukla tarayıcının boyamasıdır.
- Açık tema: `themeColor` beyaz, `:root { color-scheme: light }`. Koyu tema (Ayarlar › Görünüm, profil menüsü):
  [KOYU-TEMA.md](KOYU-TEMA.md); `colorScheme: "light dark"`, betik koyuda çubuğu `#050302` yapar.
- **Son kontrol gerçek telefonda** (iPhone Safari, Android Chrome): yazı büyütme, uzun basma, kopyalama ve klavye
  tarayıcının telefon görünümünde denenemez.

## 7. Kodlama kuralları (Next.js 16)

- `cacheComponents` açık: veritabanı, çerez ya da `searchParams` okuyan her şey `<Suspense>` içinde; sayfa bileşeni
  senkron, içerik `async function …Content()` içinde.
- `PageProps<"/panel/...">` ve `LayoutProps` tipleri (`npx next typegen`).
- Sunucu eylemleri (`src/server/actions/*`) ve hesaplama motoru (`src/lib/calc/*`) görünüm işinde değişmez.
- `src/components/akmanos/**` ESLint dışında (olduğu gibi alınmış kaynak); TypeScript denetiminden geçer.

## 8. Tasarım denemesi: Design Lab becerisi

Yeni bir ekran ya da bileşen tasarlarken veya mevcut olanı yeniden düşünürken Claude Code'da `/design-lab [hedef]`
çalıştırılır (`.claude/skills/design-lab/`, kaynak [0xdesign/design-plugin](https://github.com/0xdesign/design-plugin),
MIT). Beceri kısa bir görüşme yapar, bu belgedeki dili ve `globals.css` belirteçlerini kullanarak beş farklı varyant
üretir, `http://localhost:3000/design-lab` adresinde yan yana gösterir; sayfadaki geri bildirim katmanıyla öğelere
yorum bırakılır, beğenilen yönler birleştirilip yinelenir.

- Geçici dosyalar `src/app/design-lab/`, `src/app/design-preview/` ve `.claude-design/` altında; hepsi `.gitignore`'da,
  depoya ve yayına girmez. Bu rotalar `src/proxy.ts` eşleşmesinin dışında (girişsiz açılır), bu yüzden yalnızca
  örnek veri kullanılır: veritabanı, sunucu eylemi, gerçek ciro ya da kişi verisi yok.
- Bitince geçici dosyalar silinir, uygulama planı `docs/planlar/<hedef>-tasarim-plani.md` olarak yazılır, kalıcı
  kararlar onayla bu belgeye eklenir. Yarıda kalırsa `/design-lab-cleanup`.

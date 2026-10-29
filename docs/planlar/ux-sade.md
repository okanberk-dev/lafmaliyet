# UX sadeleştirme: anlaşılır kenar çubuğu, kompakt uyarılar, sade Vergi (`ux-sade`)

Dal: `claude/ux-sade` · Taban: `origin/main` @ 1947c7c (Vergi bölümü #68 birleşik) · Tek PR, üç bölüm (§3, §4-§6,
§7-§10). Durum: **son karar**; iki öneri (`oneri-A.md`, `oneri-B.md`), dört analiz (`analiz-nav.md`,
`analiz-uyari.md`, `analiz-vergi.md`, `analiz-akis.md`) ve iki hakemin kararından derlendi (29 Ekim 2026). Uygulayan
yeniden karar vermez; belirsizlik çıkarsa en yakın kararın gerekçesine göre davranır ve PR gövdesine yazar.

Sahibin istekleri (29 Eki 2026):
- "kdv vs gibi sidebarı daha anlaşılır yap ve uyarıları daha kompakt yapıp sistemi de anlaşılır UX ile kurgula"
- "devam et … hızlandırmaya çalış en iyi şekilde yapıp ve vergi sayfasını da daha basitleştir ve diğer kısımlarda da
  gereksiz gördüklerini kaldır veya basitleştirebilirsin … sonra maine merge et. sonrasında modpos api gelecek …
  ona göre bir kurgu yapman gerekiyorsa öyle yap"

Sahip tek kafe işletiyor, muhasebeci değil, paneli çoğu zaman telefondan açıyor, sakin ve sade ekran istiyor.
Personel (rol `staff`) Bugün, Kasa raporu, Karaoke, Kontrol listeleri, Zayi, Reçete defteri ve Sayım'ı kullanır; fiyat,
maliyet, vergi, tutar gibi yönetici verisini **hiçbir zaman** görmez.

Uygulamadan önce okunacaklar: `AGENTS.md` (bu Next.js eğitim verisindekinden farklı), `docs/TASARIM.md` §1-§7,
`docs/VERGI.md` §1 (taslak tutar takvime ve nakit planına yazılmaz), `src/components/panel/nav.ts`,
`tests/kenar-cubugu.test.ts`, `tests/mobile-nav.test.ts`, `tests/yardim.test.ts`, `tests/yardim-personel.test.ts`,
`tests/roller.test.ts`, `tests/vergi-kaynak.test.ts`, `tests/vergi-takvim.test.ts`.

Kanıt: `ux/inventory.md`, `ux/inventory.json`, `ux/components.md`, `ux/analiz/measure.json` (önce ölçüleri),
`ux/shots/` (önce görüntüleri), `ux/spec-tools/locs.json` (göç tablosunun kaynağı). `ux/` =
`/tmp/claude-0/-home-user/96380d97-d5e6-5fba-be4a-02c854f741af/scratchpad/ux/`. Satır numaraları **main @ 1947c7c**;
kayarsa metinle bulunur.

---

## 0. Özet: on değişiklik

| # | Değişiklik | Bölüm |
|---|---|---|
| 1 | Kenar çubuğunda **"Vergi, KDV, SGK"** kendi grubu (Özet · Vergi kârı · Demirbaş · Muhasebeci); "Finans" → **"Kâr & ödemeler"** (Gelir-gider · Ödemeler · Nakit planı); Menü'ye **Fiyatlar**; KDV kapalı kenar çubuğunda adıyla görünür | 1 |
| 2 | Bir ekran bir ad: kenar çubuğu = H1 = ⌘K = sekme = telefon başlığı (sekme ve telefon yalnız kısaltır) | 1 |
| 3 | ⌘K'da adıyla: KDV, SGK primi, Maaş vergileri, Kâr vergisi, Eksik belgeler, Kâr / zarar, Maaşlar, SGK oranı, Aylık harcamalar, Tutarlılık, KDV ve komisyon oranları, İşlem geçmişi, Yedek; "kâr" araması Karaoke'yi öne almaz | 1 |
| 4 | Bağlam satırı ağaçtan (elle yazılmaz), telefonda gizli; "Excel: …" başlıktan kalkar (Yardım'da ve ⌘K'da kalır) | 1 |
| 5 | Tek uyarı bileşeni **`Notice`**: 4 ton (bad · warn · neutral · good), başlık + isteğe bağlı satır + "Ayrıntı" + tek eylem; para, hukuk, veri ve bar riski taşıyan uyarı **asla katlanmaz** (`risk` + `foldPlan`) | 2 |
| 6 | 290 kutu / rol konumu (Ek A) ile yardımcı, kutusuz ⚠ ve gri bilgi kutuları (§6.2, §6.3, §6.5) tek bileşene iner; bekçi testi yeni elle kutuyu kırmızı yapar | 2 |
| 7 | Telefonda ilk ekran rakama döner: Genel bakış ve Bugün iş listesinde sıradaki iş tam kart, ötekiler "Diğer N iş" arkasında; "Yapılacak" griye döner, kırmızı yalnız gerçek sorunda | 2 |
| 8 | **Vergi sadeleşir**: Özet'in ilk ekranı iki rakam + takvim; Hazırlık karosu, iki tam feragat kopyası ve ayrı iki kâr vergisi kartı kalkar; Başlarken tek satıra iner; KDV satırı kendi cevabını yazar; SGK iki günü yan yana yazar | 3 |
| 9 | Gereksiz tekrarlar kalkar ya da bir dokunuşa iner (§9 defteri: 26 madde, her birinin nedeni ve nerede kaldığı) | 3 |
| 10 | **Satış kaynağı** tek satırla ve tek yerde (ModPOS raporu / LafPOS / geçiş / ileride ModPOS bağlantısı); hiçbir ekran "elle aylık yükleme tek kaynak" varsaymaz | 3 |

Ölçülebilir hedefler (ayrıntı §13): telefonda (390×844) ilk ekranda katlanabilir uyarı + iş listesi + ipucu Genel
bakış 592 → ≤ 300 px, Bugün 652 / 645 → ≤ 340 px, Vergi Özet 200 → ≤ 90 px, Muhasebeci 171 → ≤ 40 px; §13'te ayrıca
listelenmeyen her sayfada ≤ 90 px (1440'ta ≤ 60 px); personelin 14 ekranında yüzen öğe hiçbir hedefi örtmez.

---

## 1. Kararlar (kesin)

| # | Karar | Kaynak |
|---|---|---|
| K1 | Taban öneri **B** (az dokunuş, grup kimlikleri ve satır sayısı korunur, 4 tonlu `Notice`); A'dan: vergi grubunun kapalı kenar çubuğunda görünmesi, `risk` + `foldPlan`, `--color-bad-ink` / `--color-warn-ink` jetonları, Vergi sadeleştirmeleri, bağlam satırının ağaçtan türemesi, `activeChildOf`, geliştirici sözcüğü bekçisi, telefon bütçeleri | iki hakem |
| K2 | Para grubunun adı **"Kâr & ödemeler"** (kimlik `finans` kalır). "Para" ve "Finans" tek başına bir şey söylemiyor (analiz-nav S2); gruptaki iki soru (kâr ettim mi, ne ödeyeceğim / param yeter mi) adda. "&" diğer adlarla aynı biçim (Alış & gider, Zayi & ikram) | sentez |
| K3 | Vergi grubu **"Vergi, KDV, SGK"**, kimlik `vergi`, ikon `Landmark`, Kâr & ödemeler'in hemen altında. Alt öğeler Özet · Vergi kârı · Demirbaş · Muhasebeci (B'nin ölçtüğü sekme seti, 390/375/360 px'te 328 px, kaydırmasız) | hakem 1 + 2 |
| K4 | "Giderler & personel" **tek alt öğe kalır**, adı **"Giderler & maaşlar"**; sekmesi "Personel" → **"Maaşlar"**. Alış & gider'i 5 satıra çıkarmayız (sakinlik); Maaşlar, Aylık harcamalar ve SGK oranı ⌘K'da adıyla | hakem 1 |
| K5 | Menü grubuna **Fiyatlar** (`/panel/urunler/fiyatlar`); "Ürünler" → **"Ürünler & kârlılık"** (H1 zaten bu) | A + B |
| K6 | Alt menü (telefon) son öğe "Menü" → **"Tümü"** (kenar çubuğundaki Menü grubuyla çakışıyordu); kimlik `menu`, ikon aynı | A + B |
| K7 | Ödemeler ve Nakit planı yeni bölüm sekmesi `odeme` ile birbirine bağlanır; Ödemeler başlığındaki "Nakit planı" düğmesi kalkar | hakem 1 |
| K8 | Grup altına ipucu satırı **yok** (11 px, gürültü; hakem 1 ve 2) | hakem 1 + 2 |
| K9 | "Komisyon & hakediş" adı **kalır**; açıklama "size ödeyecekleri para (hakediş)" der. Yeniden adlandırma sahibe sorulur (§16) | hakem 1 + 2 |
| K10 | Uyarı bileşeni B'nin küçük API'si + A'nın `risk` alanı ve `foldPlan` kuralı; ayrı error/urgent düzeyi, `NoticeDot`, `NoticeList`, `EstimateLine`, `localStorage` ile kapatma ve 14 günlük "Menü sadeleşti" notu **yok** | hakem 1 + 2 |
| K11 | Ton seçimi ve yeniden düzeylendirme **görünüm katmanında**: `src/lib/calc/**` ve `src/server/actions/**` değişmez (TASARIM §7). `src/lib/tax/view.ts` ve `edit.ts`'e yalnız eklemeli alanlar ve metinler (§7) | hakem 1 + 2 |
| K12 | Vergi takviminde geçmiş dönem grubu ve ay ay ara toplam **yok**; Ödemeler'de günü geçmiş vergi / SGK hatırlatıcısı varsa takvimin üstünde **tek `warn` satırı** (risk para) | hakem 1 + 2 |
| K13 | Vergi satırında "Ödedim" düğmesi yok, `VatCarryDialog` Vergi'ye taşınmaz; KDV satırı cevabı yazar, döküm ve devreden KDV girişi bir dokunuşla Nakit planı'nda | hakem 1 + 2 |
| K14 | Geçici ve kurumlar vergisi tek kartta: **"Şirketin kâr vergisi"** (iki bölüm, bir cümlelik açıklama) | A, hakem 1 + 2 |
| K15 | Feragat her sekmede kutusuz tek satır; tam metin ⓘ'de ve Muhasebeci sekmesinin sonunda **bir kez** | A + B |
| K16 | Takvim rozetleri üç tür: "Muhasebeciden" (yeşil), "Eksik bilgi" (turuncu, eski "Taslak"), "yalnız damga" (gri, eski "sabit tutar"); kaynak bilgisi alt satıra iner. Veri değerleri (`source`, `badge`) değişmez, yalnız çizim | A, sentez |
| K17 | Sade söz önce, resmî terim parantezde; tek kaynak yeni `src/lib/tax/glossary.ts`; yalnız vergi ekranlarında | A, hakem 1 + 2 |
| K18 | Ödeme düğmesi "Ödendi" → **"Ödedim"** (boş daire); yeşil "Ödendi" yalnız durum rozeti (analiz-akış #4: gecikmiş satırın yanında ödenmiş gibi okunuyordu) | A + B |
| K19 | Personelin ağacı, alt menüsü, paleti ve açabildiği ekranlar **bayt bayt aynı**; personele yeni ekran, veri ya da metin eklenmez, yalnız azalır | iki hakem |
| K20 | Satış kaynağı tek yerden (`salesSourceOf`, §10); "yükleyin" diyen her metin kaynağa bağlıdır | hakem 1 + 2 |
| K21 | Muhasebeci sekmesinde "Listeyi kopyala / Paylaş" düğmeleri bu PR'da **yok** (hız; hakem 2); sahibe sorulur | hakem 2 |
| K22 | Genel bakış'ın ay listesinden "Ödemeler · bugün" çıkar; gecikmiş ödeme varsa sayfanın başında tek `bad` satırı (risk para). Ödemeler zaten Bugün'de, alt menü rozetinde ve "Yaklaşan ödemeler"de | hakem 1 |

---

## 2. Değişmeyenler

- **Bütün adresler** (`?ay=`, `?gun=`, `?ceyrek=`, `?yil=`, `#kdv` (Nakit planı), `#sorular`, `#bilgi`,
  `#siniflandir`, `#kdv-beyannamesi`, `#baslarken`, `#gecici`, `#oranlar`, `#gecmis`, `#yedek`, `#lafpos` dahil). Yalnız
  yeni çapa eklenir (§3.7).
- Personelin ağacı (`tests/kenar-cubugu.test.ts` "personelin ağacı değişmedi" anahattı), `BOTTOM_NAV.staff`,
  `STAFF_PATHS`, personelin palet kümesi, personelin Yardım'ı (`staffPathOf` çıktıları).
- Hesap motoru `src/lib/calc/**`, sunucu eylemleri `src/server/actions/**`, şema, göç (migration yok), cron, e-posta
  gönderim mantığı (yalnız iki altbilgi metni), bağımlılıklar (yeni paket yok; yalnız kurulu `lucide-react` 1.59.0
  ikonları: `Scale`, `FileWarning`, `History`, `HardDriveDownload` yeni içe aktarılır, hepsi denetlendi).
- **Her uyarının koşulu**: hiçbir uyarının görünme koşulu değişmez; değişen yalnız görünümü, yeri ve sözü. Bilinçli
  istisnalar, hepsi **ekleme** ya da önem düzeltmesi: Vergi Özet'te günü geçmiş vergi hatırlatıcısı satırı (K12, §7.2),
  Genel bakış'ın başındaki gecikmiş ödeme satırı (K22; aynı koşul, ay listesinden taşındı), muhtasar satırının kapalıyken
  "{n} giderde vergi kesintisi seçilmedi" demesi (§7.5; bilgi açık gövdeden yukarı çıkar). Önemi değişenler: Gelir-gider
  sayım notu gri → turuncu (U4), `alertTone`'un üç maddesi (§4.7), Nakit planı KDV satırının "Gecikmiş" rozeti tutarı
  0 iken kırmızı → amber "Damga ödendi mi?" (§7.10), Vergi kârı "sayımı yok" kırmızı → turuncu (U16; risk=hukuk, hep
  görünür).
- Vergi kuralları: taslak tutar takvimin tutar sütununa ve nakit planına yazılmaz (`docs/VERGI.md` §1); kasa cirosuna
  "vergi esasında gelir" denmez; kapsam ("yalnız kafe", `SCOPE_WARNING`), "en az / en çok", "Eksik bilgi" sebepleri
  görünür kalır.
- Kasa eksiği kırmızısı, Ödemeler'in kırmızı "Gecikmiş" sayaç kartı, barın "süre doldu" alarmı
  (`live/alert-center.tsx:489`), eksi tutarın kırmızısı (TASARIM §1), toast'lar (`toast.error` / `toast.warning`).
- Test dosyalarında **personel bölümleri**: `kenar-cubugu.test.ts` personel anahattı (satır 148-164'ün anahat kısmı),
  `mobile-nav.test.ts` 23-45 ve 74-87, `yardim-personel.test.ts`, `personel-yetkileri.test.ts`.

---
## 3. Bölüm 1: gezinme ve adlar

### 3.1 `NAV_TREE` (tam; `src/components/panel/nav.ts`)

Kapalı kenar çubuğu (yönetici, 13 satır; bugün 12):

```
Genel bakış · Bugün · Onaylar · Kasa raporu
Kafe ›  Menü ›  Stok ›  Satış ›  Alış & gider ›  Kâr & ödemeler ›  Vergi, KDV, SGK ›  Ayarlar ›  Yardım
```

```ts
export const NAV_TREE: NavNode[] = [
  { id: "genel", label: "Genel bakış", icon: LayoutDashboard, href: "/panel", roles: ["admin"] },
  { id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun", roles: ["admin", "staff"] },
  { id: "onaylar", label: "Onaylar", icon: ClipboardCheck, href: "/panel/onaylar", roles: ["admin"] },
  { id: "karaoke", label: "Karaoke", icon: MicVocal, href: "/panel/karaoke", roles: ["staff"] },
  { id: "kasa", label: "Kasa raporu", icon: Banknote, href: "/panel/kasa", roles: ["admin", "staff"] },
  { id: "kontrol", label: "Kontrol listeleri", icon: ListChecks, href: "/panel/kontrol", roles: ["staff"] },
  { id: "ozel-gunler", label: "Özel günler", icon: CalendarHeart, href: "/panel/ozel-gunler", roles: ["staff"] },
  {
    id: "kafe", label: "Kafe", icon: Store, roles: ["admin"],
    children: [ /* değişmez: karaoke-yonetici, kontrol-listeleri, tahmin, hatirlaticilarim-yonetici */ ],
  },
  {
    id: "menu", label: "Menü", icon: Coffee, roles: ["admin", "staff"],
    children: [
      { id: "urunler", label: "Ürünler & kârlılık", href: "/panel/urunler", roles: ["admin"] },
      { id: "fiyatlar", label: "Fiyatlar", href: "/panel/urunler/fiyatlar", roles: ["admin"] },
      { id: "hammaddeler", label: "Hammaddeler", href: "/panel/hammaddeler", roles: ["admin"] },
      { id: "receteler", label: "Reçete defteri", href: "/panel/receteler", roles: ["admin", "staff"] },
    ],
  },
  { id: "stok", /* değişmez */ },
  { id: "satis", /* değişmez: Satışlar, Komisyon & hakediş, Analiz & senaryo */ },
  {
    id: "alis", label: "Alış & gider", icon: Truck, roles: ["admin"],
    children: [
      { id: "faturalar", label: "Faturalar", href: "/panel/faturalar", roles: ["admin"] },
      { id: "tedarikciler", label: "Tedarikçiler", href: "/panel/tedarikciler", roles: ["admin"] },
      { id: "giderler", label: "Giderler & maaşlar", href: "/panel/giderler", roles: ["admin"], match: ["/panel/personel", "/panel/harcamalar"] },
    ],
  },
  {
    // Kâr ve ödemeler: aylık tablo (kâr ettim mi), ödemeler (ne ödeyeceğim), nakit planı (param yeter mi)
    id: "finans", label: "Kâr & ödemeler", icon: Scale, roles: ["admin"],
    children: [
      { id: "gelir-gider", label: "Gelir-gider", href: "/panel/gelir-gider", roles: ["admin"] },
      { id: "hatirlaticilar", label: "Ödemeler", href: "/panel/hatirlaticilar", roles: ["admin"] },
      { id: "nakit", label: "Nakit planı", href: "/panel/hatirlaticilar/nakit", roles: ["admin"] },
    ],
  },
  {
    // Devlete ödemeler (dalga 12, docs/VERGI.md): dört ekran, sekmeleri bu gruptan türer (SECTION_TABS.vergi)
    id: "vergi", label: "Vergi, KDV, SGK", icon: Landmark, roles: ["admin"],
    children: [
      { id: "vergi-ozet", label: "Özet", href: "/panel/vergi", roles: ["admin"] },
      { id: "vergi-kari", label: "Vergi kârı", href: "/panel/vergi/gelir-gider", roles: ["admin"] },
      { id: "demirbas", label: "Demirbaş", href: "/panel/vergi/demirbas", roles: ["admin"] },
      { id: "muhasebeci", label: "Muhasebeci", href: "/panel/vergi/kurallar", roles: ["admin"] },
    ],
  },
  { id: "hatirlaticilarim", label: "Hatırlatıcılarım", icon: AlarmClock, href: "/panel/hatirlaticilarim", roles: ["staff"] },
  { id: "ayarlar", /* değişmez */ },
  { id: "yardim", label: "Yardım", icon: HelpCircle, href: "/panel/yardim", roles: ["admin"] },
  { id: "yardim-personel", label: "Yardım", icon: HelpCircle, href: "/panel/yardim/personel", roles: ["staff"] },
];
```

- `NAV_TREE`'nin üstündeki yorum güncellenir (26 Eki gruplaması + 29 Eki: Kâr & ödemeler, Vergi, KDV, SGK; Fiyatlar
  ve Nakit planı menüde).
- Personelin gördüğü düğümler (`bugun, karaoke, kasa, kontrol, ozel-gunler, menu, stok, hatirlaticilarim,
  yardim-personel`) aynı göreli sırada; araya girenlerin hepsi `roles: ["admin"]`. `menu` personelde tek alt öğeyle
  (Reçete defteri) bağlantıya döner, ikon `Coffee` aynı. Personelin anahattı değişmez.
- Grup başına 2-5 alt öğe kuralı korunur (en uzun Menü ve Vergi, KDV, SGK: 4).
- Genişlik: "Vergi, KDV, SGK" ve "Kâr & ödemeler" bugün sığan "Ödemeler & hatırlatıcılar"dan kısa; kesilmeden sığar
  (doğrulama §14'te `scrollWidth === clientWidth`).

### 3.2 Yardımcılar (`nav.ts`)

```ts
/** Grubun etkin alt öğesi: adresle eşleşenlerden en uzun href (Fiyatlar'da Ürünler, Nakit planı'nda Ödemeler, Muhasebeci'de Özet yanmaz) */
export function activeChildOf(children: NonNullable<NavNode["children"]>, pathname: string): string | undefined {
  return children.filter((c) => pathMatches(pathname, c.href, c.match)).sort((a, b) => b.href.length - a.href.length)[0]?.id;
}

/** Sayfa başlığının bağlam satırı: rolün ağacında bu adresi açan grubun adı; üst düzey ekranda ya da ağaçta yoksa undefined */
export function groupLabelOf(pathname: string, role: "admin" | "staff"): string | undefined {
  const tree = navTreeFor(role);
  const id = activeGroupOf(tree, pathname);
  return tree.find((n) => n.id === id)?.label;
}
```

`sidebar-nav.tsx`: alt öğenin `active`'i `child.id === activeChildOf(item.children, pathname)` olur (satır 181 civarı);
`activeGroupOf` ve `keepGroupOpen` aynı. Test `const activeParent = activeGroupOf(items, pathname);` satırını arıyor,
o satır kalır.

### 3.3 Bölüm sekmeleri (`SECTION_TABS`)

```ts
const TAB_LABELS: Record<string, string> = { "/panel/sayim": "Sayım" };

export const SECTION_TABS: Record<"giderler" | "stok" | "vergi" | "odeme", readonly SectionTab[]> = {
  giderler: [
    { href: "/panel/giderler", label: "Sabit giderler", roles: ["admin"] },
    { href: "/panel/harcamalar", label: "Aylık harcamalar", roles: ["admin"] },
    { href: "/panel/personel", label: "Maaşlar", roles: ["admin"] },
  ],
  stok: treeTabs("stok"),
  vergi: treeTabs("vergi"), // Özet · Vergi kârı · Demirbaş · Muhasebeci (328 px)
  odeme: [
    { href: "/panel/hatirlaticilar", label: "Ödemeler", roles: ["admin"] },
    { href: "/panel/hatirlaticilar/nakit", label: "Nakit planı", roles: ["admin"] },
  ],
};
```

- `odeme` sekmeleri Ödemeler (`reminders-client.tsx` başlığı) ve Nakit planı (`cash-plan-client.tsx` başlığı ve
  `nakit/page.tsx` yükleme başlığı) sayfalarında `tabs={<SectionTabs section="odeme" current=… role="admin" />}`.
- `SECTION_TABS`'ın yorumundaki "Vergi'nin dört ekranı … tek öğedir" cümlesi güncellenir (artık kendi grubu, sekmeler
  ağaçtan).

### 3.4 Komut paleti (`NAV_GROUPS` + `NAV_FOOTER`)

Başlıklar ağacın yönetici grup başlıklarıyla aynı sırada (test türetir): `["Genel", "Kafe", "Menü", "Stok", "Satış",
"Alış & gider", "Kâr & ödemeler", "Vergi, KDV, SGK"]`. Değişen ve eklenen kayıtlar (hepsi `roles: ["admin"]`; eski ad
`keywords`'e eklenir, kas hafızası aramayla bulur):

| Grup | Etiket → adres | İkon | `keywords` (bugünkülere ek) | Durum |
|---|---|---|---|---|
| Menü | **Ürünler & kârlılık** → `/panel/urunler` | `Coffee` | "ürünler kâr düşük az kazandıran" | etiket |
| Stok | Stok sayımı → `/panel/sayim` | `ClipboardList` | – | `match: ["/panel/tutarlilik"]` **kalkar** |
| Stok | **Tutarlılık** → `/panel/tutarlilik` | `ClipboardList` | "tutarlılık kontrolü fark sapma reçeteden fazla alım" | yeni |
| Alış & gider | **Giderler & maaşlar** → `/panel/giderler` | `Wallet` | "giderler & personel sabit gider kira aidat" | etiket (`match` ve `excel` aynı) |
| Alış & gider | **Aylık harcamalar** → `/panel/harcamalar` | `Wallet` | "harcama reklam influencer nakit alım bakım fatura dışı" | yeni |
| Alış & gider | **Maaşlar** → `/panel/personel` (`excel: "Personel"`) | `UserRound` | "personel maaş net brüt bordro çalışan işveren maliyeti" | yeni |
| Alış & gider | **SGK oranı** → `/panel/personel#sgk-oranlari` | `Percent` | "sgk oranı işveren payı işsizlik prim oranı" | yeni |
| Kâr & ödemeler | Gelir-gider → `/panel/gelir-gider` | `CalendarRange` | – | – |
| Kâr & ödemeler | **Kâr / zarar** → `/panel/gelir-gider#kar-zarar` | `Scale` | "kâr zarar kar zarar net kâr yıl" | yeni |
| Kâr & ödemeler | **Ödemeler** → `/panel/hatirlaticilar` | `BellRing` | "ödemeler & hatırlatıcılar ödeme ekle ödendi" | etiket |
| Kâr & ödemeler | Nakit planı → `/panel/hatirlaticilar/nakit` | `ChartNoAxesColumn` | "kdv hesabı devreden kdv param yeter mi" | – |
| Vergi, KDV, SGK | **Vergi, KDV, SGK** → `/panel/vergi` | `Landmark` | "vergi özet vergi takvimi devlete ödemeler" | etiket ("Vergi") |
| Vergi, KDV, SGK | **KDV** → `/panel/vergi#kdv` | `Percent` | "kdv katma değer bu ay ne kadar devreden indirilecek hesaplanan beyanname damga" | yeni |
| Vergi, KDV, SGK | **SGK primi** → `/panel/vergi#sgk` | `Users` | "sgk prim işveren sigorta tahakkuk" | yeni |
| Vergi, KDV, SGK | **Maaş vergileri (muhtasar)** → `/panel/vergi#muhtasar` | `Receipt` | "muhtasar stopaj ücret gelir vergisi prim hizmet" | yeni |
| Vergi, KDV, SGK | **Kâr vergisi (geçici, kurumlar)** → `/panel/vergi#kar-vergisi` | `Landmark` | "geçici vergi kurumlar vergisi peşin mahsup matrah" | yeni |
| Vergi, KDV, SGK | **Vergi kârı** → `/panel/vergi/gelir-gider` | `Receipt` | "vergiye göre gelir-gider vergiye göre kâr kurum kazancı matrah çeyrek" | etiket |
| Vergi, KDV, SGK | **Eksik belgeler** → `/panel/vergi/gelir-gider#siniflandir` | `FileWarning` | "belgesi seçilmemiş sınıflandır stopaj vergi kesintisi" | yeni |
| Vergi, KDV, SGK | **Demirbaş** → `/panel/vergi/demirbas` | `Package` | "demirbaş & amortisman varlık" | etiket |
| Vergi, KDV, SGK | **Muhasebeci** → `/panel/vergi/kurallar` | `BookOpen` | "vergi kuralları vergi ayarları şirket nasıl kuruldu" | etiket |
| Vergi, KDV, SGK | Muhasebeciye sorulacaklar → `/panel/vergi/kurallar#sorular` | `ListChecks` | – | – |
| `NAV_FOOTER` | **KDV ve komisyon oranları** → `/panel/ayarlar#oranlar` | `Percent` | "kdv oranı %10 %20 hizmet pos komisyon oranı" | yeni |
| `NAV_FOOTER` | **İşlem geçmişi** → `/panel/ayarlar#gecmis` | `History` | "kim neyi değiştirdi kayıt geçmiş log" | yeni |
| `NAV_FOOTER` | **Yedek** → `/panel/ayarlar#yedek` | `HardDriveDownload` | "yedek indir excel" | yeni |
| `NAV_FOOTER` | **Fatura kalemini hammaddeye bağla** → `/panel/parasut#urun-baglantilari` | `Plug` | "ürün hammadde bağlantısı eşleştir fatura kalemi" | yeni |

`NAV_FOOTER` yalnız paletin kaynağı (profil menüsü ayrı; `sidebar.tsx:118`), kare adresli kayıtlar başka yere sızmaz.

**Sıralama düzeltmesi** (`command-palette.tsx`): `buildEntries` her kayda katlanmamış küçük harfli başlığı da yazar
(`raw: p.label.toLocaleLowerCase("tr-TR")`); `score(e, q, words, rawQuery)` sorgu aksanlıysa (`rawQuery !==
fold(rawQuery)`) ve başlığın hiçbir sözcüğü aksanlı sorguyla başlamıyorsa puana +0,5 ekler. `score` dışa aktarılır
(test). Sonuç: "kâr" → Kâr / zarar ilk (Karaoke sonra); "kar" → Karaoke yine üstte; "kdv" → KDV ilk; "sgk" → SGK
primi / SGK oranı; "maaş" → Maaşlar; "geçmiş" → İşlem geçmişi.

### 3.5 Telefon: alt menü, üst çubuk, çekmece

- `BOTTOM_NAV.admin`: Genel bakış · Bugün · Kasa · Ödemeler (rozet) · **Tümü** (`id: "menu"`, `LayoutGrid`).
  `BOTTOM_NAV.staff` değişmez. `nav.ts`'teki `BottomNavItem` yorumundaki "Menü" → "Tümü".
- `SHORT_TITLES` değişenler: `/panel/vergi` "Vergi, KDV, SGK" · `/panel/vergi/gelir-gider` "Vergi kârı" ·
  `/panel/vergi/kurallar` "Muhasebeci" · `/panel/personel` "Maaşlar". Ötekiler aynı ("Ödemeler", "Nakit planı",
  "Ürünler", "Fiyatlar", "Harcamalar", "Komisyonlar", "Demirbaş", "Doluluk" …).
- Çekmece kenar çubuğuyla aynı ağaç; yalnız etkin grup açık gelir. Kapalı hâlde bir satır uzar (Vergi grubu).

### 3.6 Bir ekran bir ad (son tablo)

Kural: kenar çubuğu = H1 = ⌘K; sekme ve telefon üst çubuğu yalnız kısaltabilir. Grubun giriş ekranı ağaçta ve
sekmede "Özet" olabilir, H1'i grubun adıdır.

| Adres | Kenar çubuğu | H1 | ⌘K | Sekme | Telefon |
|---|---|---|---|---|---|
| `/panel/urunler` | Ürünler & kârlılık | Ürünler & kârlılık | Ürünler & kârlılık | – | Ürünler |
| `/panel/urunler/fiyatlar` | Fiyatlar | Fiyatlar | Fiyatlar | – | Fiyatlar |
| `/panel/tutarlilik` | Tutarlılık | **Tutarlılık** (eski "Tutarlılık kontrolü") | Tutarlılık | Tutarlılık | Tutarlılık |
| `/panel/giderler` | Giderler & maaşlar | Sabit giderler | Giderler & maaşlar | Sabit giderler | Sabit giderler |
| `/panel/harcamalar` | (Giderler & maaşlar) | Aylık harcamalar | Aylık harcamalar | Aylık harcamalar | Harcamalar |
| `/panel/personel` | (Giderler & maaşlar) | **Maaşlar** | Maaşlar | Maaşlar | Maaşlar |
| `/panel/gelir-gider` | Gelir-gider | Gelir-gider | Gelir-gider | – | Gelir-gider |
| `/panel/hatirlaticilar` | Ödemeler | **Ödemeler** | Ödemeler | Ödemeler | Ödemeler |
| `/panel/hatirlaticilar/nakit` | Nakit planı | Nakit planı | Nakit planı | Nakit planı | Nakit planı |
| `/panel/vergi` | Özet | **Vergi, KDV, SGK** | Vergi, KDV, SGK | Özet | Vergi, KDV, SGK |
| `/panel/vergi/gelir-gider` | Vergi kârı | **Vergi kârı** | Vergi kârı | Vergi kârı | Vergi kârı |
| `/panel/vergi/demirbas` | Demirbaş | **Demirbaş** | Demirbaş | Demirbaş | Demirbaş |
| `/panel/vergi/kurallar` | Muhasebeci | **Muhasebeci** | Muhasebeci | Muhasebeci | Muhasebeci |

`metadata.title` (sekme başlığı) H1 ile aynı: `vergi/page.tsx` "Vergi, KDV, SGK", `vergi/gelir-gider/page.tsx`
"Vergi kârı", `vergi/demirbas/page.tsx` "Demirbaş", `vergi/kurallar/page.tsx` "Muhasebeci",
`hatirlaticilar/page.tsx` "Ödemeler", `personel/page.tsx` "Maaşlar", `tutarlilik/page.tsx` "Tutarlılık" (Genel bakış'taki
"Tutarlılık kontrolü" bağlantı metni, `page.tsx:627`, de "Tutarlılık"; Excel sayfa adı aynı).

### 3.7 Yeni çapalar

| Çapa | Yer | Not |
|---|---|---|
| `#kdv`, `#sgk`, `#muhtasar` | `vergi/tax-calendar.tsx`: her türün **ilk** takvim satırının `<li>`'si (`kdv1`, `sgk`, `mphb`) | `scroll-mt-20 target:ring-2 target:ring-ink/20 target:ring-inset`; satır kapalı kalır (JS yok) |
| `#kar-vergisi` | Şirketin kâr vergisi kartı (§7.5) | eski `#gecici` kartın içindeki geçici bölümüne taşınır (`id="gecici"` kalır, Başlarken ona bağlanabilir) |
| `#sgk-oranlari` | `personel/staff-editor.tsx` SGK oranları bölümü | adres bu çapaysa bölüm açık başlar (`useEffect` + `hashchange`; Ayarlar `section-card.tsx:73-99` deseni) |
| `#kar-zarar` | `gelir-gider/page.tsx` yıl kartlarının kabı | `scroll-mt-20` |
| `#baglanti` | `karaoke/karaoke-admin.tsx` "laffogato.net bağlantısı" kartı | U6'nın eylemi |
| `#urun-baglantilari` | **var** (`parasut/breakdowns.ts` `LINKS_ID`, ürün bağlantıları kartı) | yalnız ⌘K kaydı eklenir |
| `#kurallar` | `vergi/kurallar/page.tsx` kural tablosu kartı (§7.9) | adres bu çapaysa kapalı gövde açık başlar; bayat kural uyarısının eylemi |
| `#feragat` | `vergi/kurallar/page.tsx` sondaki tam feragat (§7.4) | – |

Kare adresler `mobileTitleFor`'u etkilemez (yalnız yol eşleşir).

### 3.8 `PageHeader` (`src/components/panel/page-header.tsx`)

```ts
export function PageHeader(props: {
  title: string;
  description?: ReactNode;
  /** Eski uzun açıklama ("nasıl çalışır"): açıklamanın sonunda ⓘ (InfoTip, etiketi "Nasıl çalışır?") */
  more?: string;
  /** Açıklamanın altında tek satır: satış kaynağı (§10) */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Bağlam satırı ağaçtan: groupLabelOf(path, role); üst düzey ekranda çizilmez */
  path?: string;
  role?: "admin" | "staff"; // varsayılan "admin"
  tabs?: ReactNode;
}): JSX.Element;
```

- `eyebrow` ve `excel` prop'ları ve `EYEBROW_ALIAS` **kalkar** (TypeScript bütün çağrıları gösterir; ~48 dosya). Her
  çağrı `path="/panel/…"` alır; iki rolün açtığı sayfada `role={user.role}` (yükleme iskeletinde `role="staff"`, ortak
  olan en dar bağlam). `VergiHeader` `path={current}` verir.
- Bağlam satırı `max-sm:hidden` (telefonda üst çubuk zaten adı yazıyor). "Excel: …" hiçbir başlıkta yok; Excel
  karşılığı Yardım'ın "Ekranlar" tablosunda (`excelFor`) ve ⌘K alt satırında ("Ekran · Excel: …") kalır.
- `more` verilirse açıklamanın sonunda `InfoTip` ("Nasıl çalışır?"); içeriği bugünkü uzun açıklama, metin aynı
  ("Patron (ModPOS)" → "ModPOS" ve "Excel" sözcükleri hariç). Personel ekranında yönetici kavramı içeren `more` verilmez.
- `meta` açıklamanın altında `mt-1 text-[13px] text-ink-mute` tek satır.

### 3.9 Yardım (`src/app/panel/yardim/nav-paths.ts`, `yardim/page.tsx`)

- `excelFor`: sekmenin Excel parçası bulunamazsa kaydın kendi `excel`'ine düşer
  (`return parts.find(...) ?? NAV_ITEMS.find((n) => n.href === href)?.excel;`): "Maaşlar" sekmesi Excel'de "Personel".
- Yorumlardaki örnek adlar güncellenir ("Giderler & maaşlar → Sabit giderler, Aylık harcamalar, Maaşlar").
- `yardim/page.tsx`: `<Path>` ağaçtan çözülür, kendiliğinden düzelir. Elle yazılmış eski adlar değişir: "Vergi ›
  Vergiye göre" → "Vergi, KDV, SGK › Vergi kârı", "Kurallar" (sekme) → "Muhasebeci", "Ödemeler & hatırlatıcılar" →
  "Ödemeler", "Giderler & personel" → "Giderler & maaşlar", "Personel" (sekme) → "Maaşlar". "Bu ay ne kadar KDV
  ödeyeceğim?" sorusu önce `<Path href="/panel/vergi" />`'ye (KDV satırı), döküm için Nakit planı'na gönderir.
  "Satış raporunu yükleyin" adımı (`page.tsx:104`) "Satış raporunu yükleyin (ModPOS raporuyla çalışan aylarda)" olur.
- Personelin Yardım'ı (`/panel/yardim/personel`) **değişmez**.

### 3.10 Metinlerdeki eski adlar (yalnız söz; davranış aynı)

| Dosya:satır (main) | Bugün | Yeni |
|---|---|---|
| `src/server/notify/weekly-template.ts:14` | "Ödemeler & hatırlatıcılar ›" | "Ödemeler ›" |
| `src/server/notify/digest-template.ts:281` | "Ödemeler & hatırlatıcılar sayfasında" | "Ödemeler sayfasında" |
| `src/app/panel/faturalar/invoice-dialog.tsx:658` | "Ödemeler & hatırlatıcılar'a düşer" | "Ödemeler'e düşer" |
| `src/app/panel/hatirlaticilar/reminder-sheet.tsx:561` | "Giderler & personel sayfasında" | "Giderler & maaşlar › Sabit giderler sayfasında" |
| `src/app/panel/hatirlaticilar/reminders-client.tsx:350, 487, 593` ve `all-reminders.tsx:131` | "Hatırlatıcı ekle" | **"Ödeme ekle"** (Bugün'deki kişisel "Hatırlatıcı ekle", `bugun/today-reminders.tsx:113`, kalır) |
| `src/app/panel/hatirlaticilar/nakit/vat-card.tsx:88` | "Hatırlatıcı ekle" | "Ödemeler'e ekle" |
| `src/app/panel/gelir-gider/page.tsx:263-265` | "Vergiye göre karşılığı: Vergi › Vergiye göre" | "Vergi hesabındaki karşılığı: Vergi kârı ›" (aynı bağlantı) |
| `src/app/panel/vergi/tax-cards.tsx:127` | "Vergiye göre'yi aç" | "Vergi kârını aç" |
| `src/lib/tax/pnl.ts:991` (`SCOPE_HINT`) | "… Vergiye göre › Düzeltme ekle'den girin." | "… Vergi kârı › Düzeltme ekle'den girin." |
| `src/lib/tax/rules-2026.ts:122` | "Vergiye göre › Düzeltmeler'e" | "Vergi kârı › Düzeltmeler'e" |
| `src/app/api/export/workbook.ts:1247` | "(Vergi › Vergiye göre)" | "(Vergi, KDV, SGK › Vergi kârı)" |
| `src/lib/tax/edit.ts:349-366` (SGK notu) | "Ayarlar'da işveren SGK …", "Personel › SGK oranları", "(Kurallar › SGK işveren payı)" | "Maaşlar'da işveren SGK …", "Maaşlar › SGK oranları", "(Muhasebeci › SGK işveren payı)" |

Kod yorumlarındaki eski adlar (ör. "Vergiye göre", "Ödemeler & hatırlatıcılar") dokunulan dosyalarda düzeltilir;
dokunulmayan dosyaların yorumları bu PR'ın işi değil.

### 3.11 Bölüm 1'in testleri

Güncellenecekler (her biri bilerek; personel bölümleri aynen kalır):

| Test | Satır (main) | Değişiklik |
|---|---|---|
| `tests/kenar-cubugu.test.ts` | 116-117 `reaches` | adresin `?…`/`#…` kısmını atar: `pathMatches(pathname.replace(/[?#].*$/, ""), …)` |
| | 119-138 | yönetici anahattı: `"Menü › Ürünler & kârlılık, Fiyatlar, Hammaddeler, Reçete defteri"`, `"Alış & gider › Faturalar, Tedarikçiler, Giderler & maaşlar"`, `"Kâr & ödemeler › Gelir-gider, Ödemeler, Nakit planı"`, `"Vergi, KDV, SGK › Özet, Vergi kârı, Demirbaş, Muhasebeci"` (Ayarlar'dan önce) |
| | 148-164 anahat | **dokunulmaz** |
| | 152 başlık listesi | personelde olmaması gereken başlıklar yöneticinin ağacından türer: `NAV_TREE.filter((n) => n.children && !n.roles.includes("staff")).map((n) => n.label)` + "Genel bakış", "Onaylar", "Menü" (bugünkü sabit liste boşa düşmesin) |
| | 175 | `["kafe", "satis", "alis", "finans", "vergi", "ayarlar"]` |
| | 182-188 `ADMIN_PAGES` | + `/panel/urunler/fiyatlar`, `/panel/hatirlaticilar/nakit`, `/panel/vergi/gelir-gider`, `/panel/vergi/demirbas`, `/panel/vergi/kurallar` |
| | 237-249 | `/panel/hatirlaticilar/nakit` → "Kâr & ödemeler"; dört vergi adresi → "Vergi, KDV, SGK"; yorumlar |
| `tests/mobile-nav.test.ts` | 11-21 | son etiket "Tümü"; test adı |
| | 115-153 | `/panel/vergi` "Vergi, KDV, SGK", `/panel/vergi/gelir-gider` "Vergi kârı", `/panel/vergi/kurallar` "Muhasebeci", `/panel/personel` "Maaşlar" |
| | 23-45, 74-87 | **dokunulmaz** |
| `tests/yardim.test.ts` | 18-19, 31, 36-37 | `["Alış & gider", "Giderler & maaşlar"]`, `["Kâr & ödemeler", "Ödemeler"]`, `["Kâr & ödemeler", "Gelir-gider"]`, `[…, "Giderler & maaşlar", "Aylık harcamalar"]`, `[…, "Giderler & maaşlar", "Maaşlar"]` |
| | 44, 50-53 | `excelFor("/panel/personel")` yine "Personel" (yedekten); `tabsOf("/panel/giderler")` → `["Sabit giderler", "Aylık harcamalar", "Maaşlar"]` |
| | 111-112 | `pathOf("/panel/vergi")` → `["Vergi, KDV, SGK", "Özet"]`; `/panel/vergi/kurallar` → `["Vergi, KDV, SGK", "Muhasebeci"]` |
| `tests/roller.test.ts` | 66-67 | `!staffIds.includes("vergi") && !staffIds.includes("finans")` aynı; ikinci satır `navTreeFor("admin").find((n) => n.id === "vergi")?.children?.some((c) => c.href === "/panel/vergi")` |
| `tests/vergi-eylemler.test.ts` | 363, 378, 385 | SGK notunun yeni metni (§3.10); `/Vergi hesabındaki karşılığı:/` |
| `tests/vergi-kaynak.test.ts` | 271 | "Yalnız toplam; kalemler panelde (Vergi, KDV, SGK › Vergi kârı)" |

Yeni (Bölüm 1):

- `tests/kenar-cubugu.test.ts` sonuna: (a) `activeChildOf`: `/panel/hatirlaticilar/nakit` → `nakit`,
  `/panel/hatirlaticilar` → `hatirlaticilar`, `/panel/urunler/fiyatlar` → `fiyatlar`, `/panel/urunler/12` →
  `urunler`, `/panel/vergi/kurallar` → `muhasebeci`, `/panel/vergi` → `vergi-ozet`; (b) "KDV" adıyla bulunur: kapalı
  ağaçta etiketi "KDV" içeren bir grup, palette etiketi "KDV" ile başlayan bir kayıt; (c) `score`: "kâr" sorgusunda
  "Kâr / zarar" "Karaoke"den önce, "kar"da Karaoke önce; (d) `groupLabelOf`: yönetici `/panel/karaoke` "Kafe",
  personel `/panel/karaoke` undefined, personel `/panel/zayi` "Stok", `/panel/kasa` undefined, `/panel/vergi/demirbas`
  "Vergi, KDV, SGK"; (e) `sectionTabsFor("vergi", "admin")` etiketleri `["Özet", "Vergi kârı", "Demirbaş", "Muhasebeci"]`,
  `sectionTabsFor("odeme", "staff")` boş.
- `tests/sayfa-basligi.test.ts` (yeni): `src/app/panel/**` içinde `eyebrow=` ve `excel=` yok; `page-header.tsx`'te
  bağlam satırı `max-sm:hidden` taşır; §8 tablosundaki sabit açıklama dizeleri ≤ 100 harf (dosyadaki `DESCRIPTION`
  sabitleri ve `description="…"` düz metinleri; dinamikler hariç).
- Sekme genişliği: `oneriB/tools/measure-tabs.cjs` deseniyle §14'te tarayıcıda ölçülür (≤ 358 px, 390 px ekranda
  kaydırmasız); birim testi değil.

---
## 4. Bölüm 2: kompakt uyarı sistemi

### 4.1 Bileşen (`src/components/ui/notice.tsx`, yeni)

Sunucu bileşeni (`"use client"` yok), açılma `<details>` ile, JavaScript'siz çalışır; istemci bileşenlerinden de
kullanılır (eylem ve çocuklar `ReactNode`, işlev prop'u yok). Sayfalar `@/components/ui/notice`'ten alır.

```ts
import type { LucideIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

export type NoticeTone = "bad" | "warn" | "neutral" | "good";
/** Kompakt hâlde bile katlanmayan sonuç: para, yasal yükümlülük, veri kaybı, barın işleyişi */
export type NoticeRisk = "para" | "hukuk" | "veri" | "bar";

/** Tek ikon eşlemesi: sayfa, zil, "Dikkat edilmesi gerekenler" kartı ve iş listeleri aynı tabloyu kullanır */
export const TONE_ICON: Record<NoticeTone, LucideIcon>; // bad CircleAlert · warn TriangleAlert · neutral Info · good CircleCheck
/** Ekran okuyucu öneki (sr-only) */
export const TONE_LABEL: Record<NoticeTone, string>; // "Önemli" · "Dikkat" · "Bilgi" · "Tamam"
/** İkon kuyusu (zil, iş listesi, "Dikkat" kartı) */
export const TONE_TILE: Record<NoticeTone, string>; // §4.2

export interface NoticeProps {
  tone: NoticeTone;
  /** Sonuç: konu + tutar / sayı / gün + ne olur. ≤ 10 sözcük, sonda nokta yok */
  title: ReactNode;
  /** Her zaman görünen ikinci satır: ne yapılacak, zorunlu bilgi. ≤ 18 sözcük */
  text?: ReactNode;
  /** "Ayrıntı" altında, kapalı: neden, varsayım, liste */
  children?: ReactNode;
  /** Geliştirici dili (anahtar adı, Vercel, komut, belge yolu): Ayrıntı'nın içinde "Teknik ayrıntı (geliştirici için)" altında. Personelin açtığı ekranda VERİLMEZ */
  tech?: ReactNode;
  /** Tek birincil eylem: <NoticeLink> ya da <Button size="xs" variant="secondary">. İki düğme yalnız pencere içinde (sm) */
  action?: ReactNode;
  risk?: NoticeRisk;
  /** md: sayfa düzeyi · sm: kart ve pencere içi · line: kutusuz tek satır (alan, satır, hücre altı) */
  size?: "md" | "sm" | "line"; // varsayılan "md"
  /** Yalnız istemcide sonradan beliren uyarıda: assertive → role="alert" (eylem / form hatası), polite → role="status"; yoksa role="note" */
  live?: "polite" | "assertive";
  /** Ayrıntı açık başlasın (satır başına eylemi olan liste, kullanıcının eylemine cevap veren hata dökümü) */
  defaultOpen?: boolean;
  detailsLabel?: string; // varsayılan "Ayrıntı"
  id?: string;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}
export function Notice(props: NoticeProps): ReactNode;

export interface NoticeItem extends NoticeProps { key: string }
/**
 * Katlama planı (saf, test edilir). Sıra: bad > warn > neutral > good, aynı tonda yazıldığı sıra (kararlı).
 * Hiç katlanmaz: her `bad`, `risk` taşıyan her `warn`. Geri kalanlardan ilk `max` (varsayılan 2) görünür, kalanı katlanır.
 */
export function foldPlan(items: readonly Pick<NoticeItem, "key" | "tone" | "risk">[], max?: number): { shown: string[]; folded: string[] };
/** Aynı yerdeki birden çok uyarı: foldPlan'a göre; katlananlar "+{n} uyarı daha" (hepsi neutral/good ise "+{n} not daha") <details>'inde */
export function NoticeGroup(props: { items: readonly NoticeItem[]; max?: number; label?: string /* "Uyarılar" */; className?: string }): ReactNode;
/** Uyarının eylem bağlantısı: kalın, altı çizili; görünür 20 px, dokunma alanı 44 px */
export function NoticeLink(props: { href: string; children: ReactNode }): ReactNode;
```

İki yerleşim:
1. **Eylemli ya da ayrıntısız**: satır = ikon · başlık · eylem (`flex flex-wrap`; eylem sığmazsa başlığın altına,
   ikon hizasına iner); `text` altında; Ayrıntı varsa en altta "Ayrıntı ⌄".
2. **Eylemsiz ve ayrıntılı**: bütün kutu tek `<details>`; `<summary>` = ikon · başlık · sağda "Ayrıntı ⌄". Özette
   etkileşimli öğe yok (vergi takviminin kuralı).

`size="line"`: kutu, zemin ve dolgu yok; ikon + başlık tonun mürekkep renginde (`text-bad-ink` / `text-warn-ink`),
`text` ve Ayrıntı olabilir; kart içi ⚠ cümlelerinin yerine.

### 4.2 Görsel tarif (Tailwind; `docs/TASARIM.md` §1)

Yeni jetonlar (`src/app/globals.css` `@theme`): `--color-bad-ink: #b91c1c`, `--color-warn-ink: #9a3412`,
`--color-note: rgb(23 23 23 / 0.045)` (nötr zemin; beyazda #f5f5f5, panelde #eaeaeb gibi görünür, ikisinde de ayrışır).
TASARIM §1 tablosuna üç satır eklenir.

| Parça | Sınıflar |
|---|---|
| Kök (md) | `flex flex-col gap-1 rounded-2xl px-3.5 py-2.5 text-[13px] leading-5` · `data-notice={tone}` · `data-risk={risk}` |
| Kök (sm) | aynı, `rounded-xl px-3 py-2` |
| Kök (line) | `flex flex-col gap-0.5 text-[13px] leading-5` (zemin yok) |
| Zemin | bad `bg-bad-soft` · warn `bg-warn-soft` · neutral `bg-note` · good `bg-good-soft`; halka, gölge, mavi zemin yok |
| İkon | `TONE_ICON[tone]`, `size-4 mt-0.5 shrink-0`, `strokeWidth={1.75}`, `aria-hidden`; renk bad `text-bad-ink` · warn `text-warn-ink` · neutral `text-ink-mute` · good `text-good` |
| Başlık | md/sm: `min-w-0 flex-1 basis-48 font-medium text-ink text-pretty break-words`; line: `font-medium` + tonun mürekkebi |
| `text` | `pl-6 text-ink-soft` |
| Eylem kabı | `ml-auto shrink-0 self-center max-sm:ml-6` |
| "Ayrıntı" özeti | `relative inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-soft underline decoration-current/40 underline-offset-2 outline-none [&::-webkit-details-marker]:hidden focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] pointer-fine:after:-inset-y-1`; ok `ChevronDown size-3.5 motion-safe:transition-transform group-open/n:rotate-180`; açıkken metin "Gizle" |
| Ayrıntı gövdesi | `mt-1.5 space-y-1 pl-6 text-ink-soft [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs` |
| Teknik ayrıntı | Ayrıntı'nın içinde ikinci `<details>`: özet "Teknik ayrıntı (geliştirici için)" `text-xs text-ink-mute`; gövde `font-mono text-xs break-words` |
| `NoticeLink` | `relative font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']` |
| `NoticeGroup` | `<section aria-label={label}>` + `space-y-2`; özet "+{n} uyarı daha" `min-h-11 text-[13px] font-medium text-ink-mute underline`; sayfa başında grubun altında `mb-4` |
| `TONE_TILE` | bad `bg-bad-soft text-bad-ink` · warn `bg-warn-soft text-warn-ink` · neutral `bg-note text-ink-mute` · good `bg-good-soft text-good` |
| Baskı | `print:bg-transparent print:px-0`; eylem `no-print` |

Yükseklik: tek satır md 40 px, sm 36 px, line 20 px; "Ayrıntı" satırıyla 60 / 56 px.

Kontrast (hesaplandı, 13 px metin AA 4,5:1): başlık `text-ink` bad-soft 16,4 · warn-soft 16,9 · note (panelde) 14,9;
`text-ink-soft` bad-soft 9,55 · warn-soft 9,84 · good-soft 9,62 · note (beyazda) 9,58 · note (panelde) 8,69;
`text-bad-ink` bad-soft 5,91 · beyaz 6,47 · panel 5,89; `text-warn-ink` warn-soft 6,88 · beyaz 7,31 · panel 6,65;
ikon `text-ink-mute` note üstünde 4,84 / 4,39 (ikon için 3:1 yeter); `text-good` good-soft 6,52. Bugünkü `text-bad`
bad-soft üstünde 4,41 (AA altı) ve `text-warn` warn-soft üstünde 4,88: yeni kutularda metin bunlarla yazılmaz.

**Mavi (`bg-info-soft`) artık uyarı rengi değildir**: yalnız seçim, hücre ve rozet için kalır (Ek A'nın "D" satırları).

### 4.3 Ton seçme kuralı (yukarıdan aşağı; ilk "evet" kazanır)

| Soru | Ton | `risk` | Eylem |
|---|---|---|---|
| İşlem yapılamadı, kaydedilmedi, okunamadı (form / eylem hatası, sayfa verisi okunamadı) | `bad` (+ `live="assertive"` kullanıcının eylemine cevapsa) | – | yeniden dene / düzelt |
| Para, yasal son gün ya da barın işleyişi **şimdi** bozuk: gecikmiş ödeme, kasa eksiği, "para yetmeyebilir", sipariş / bildirim gelmiyor, onaylanamaz istek, sistem işi çalışmadı | `bad` | varsa yaz | varsa |
| Ay sonu rakamını bozan eksik veri, yanlış / çift sayılma riski, geri alınamaz işlemden önceki dikkat, onay bekleyen istek, oran farkı | `warn` | para / hukuk / veri sonucu varsa **zorunlu** | **zorunlu**: `action` ya da `text`'te ne yapılacağı |
| Durum, kurulum, bağlantı, kaynak, tahmin kalitesi, nasıl çalışır | `neutral` | – | isteğe bağlı |
| Tutarlı, tamam, kaydedildi | `good` | – | – |

Ek kurallar:
- Kompakt hâl parayı, son günü, kaybı asla gizlemez: tutar, gün ve sonuç **başlıkta**; Ayrıntı'ya yalnız neden,
  varsayım, liste ve teknik ayrıntı.
- Turuncu yalnız uyarıdır: iş listelerinin "Yapılacak" durumu gri (§4.7).
- Bir ekranda bir gerçek bir kez (§9 defteri; görünüm katmanında süzülür).
- Geliştirici sözcükleri (`Vercel`, `*_KEY`, `*_SECRET`, `openssl`, `docs/…`, `npm`) yalnız `tech`'te; personelin
  açtığı ekranda `tech` hiç verilmez, yönetici talimatı yerine "sorun sürerse yöneticiye haber verin".

### 4.4 Gruplama ve açılma

- Sayfanın başındaki birden çok uyarı tek `NoticeGroup`'ta (varsayılan `max={2}`); `bad` ve riskli `warn` hep görünür.
- `<details>` kapalı başlar; açık başlar yalnız: satır başına eylemi olan liste (Ödemeler'deki tutar farkı listesi),
  kullanıcının eylemine cevap veren hata dökümü (`defaultOpen`).
- Kart ve pencere içinde `size="sm"`, grup yok. Alan ve satır altındaki ⚠ cümleleri `size="line"`.
- `Field` (form alanının kendi hata / ipucu satırı), rozetler, toast'lar, `ErrorView` ve `ConfirmDialog` bu
  bileşenin dışında kalır.

### 4.5 Erişilebilirlik

- Rol: `live` yoksa `role="note"`; `polite` → `role="status"`; `assertive` → `role="alert"`. Sunucuda sayfayla gelen
  uyarıya `alert` verilmez (bugün `system-banner.tsx:16` `alert`; `note` olur, içerik aynı).
- Renk tek başına anlam taşımaz: her tonun kendi ikon şekli ve başlığın başında `sr-only` öneki (`TONE_LABEL` + ": ").
- Odak: "Ayrıntı" özeti doğal odaklanır (`ring-2 ring-ink/30`); form hatalarında bugünkü `alertRef` deseni korunur
  (`ref` köke iner; React 19'da işlev bileşeninde `ref` sıradan prop).
- Hareket: yalnız okun dönüşü, `motion-safe:`.
- Dokunma: özet ve `NoticeLink` 44 px görünmez kenar (TASARIM §6).

### 4.6 Telefon

- **İlk ekran bütçesi** (390×844): sayfanın asıl cevabından önce katlanabilir uyarı (`bad` ve `risk` taşıyanlar
  hariç) + iş listesi + ipucu ≤ 90 px (Genel bakış ≤ 300, Bugün ≤ 340); 1440×900'de ≤ 60 px. Katlanamayan uyarılar
  (`bad`, `risk`'li `warn`) bütçeye girmez ama her biri Ayrıntı kapalıyken ≤ 60 px. Sayfa sayfa §13.
- Eylem başlığın yanına sığmazsa ikon hizasına iner; kutu iki satırı geçmez (Ayrıntı kapalıyken).
- **Yüzen öğe içerik örtmez**: personelin "Sesli uyarılar için dokunun" hapı (`live/alert-center.tsx:538-549`,
  `fixed …`) kalkar. `app/panel/layout.tsx`'te `<main>`'in içindeki kabın ilk çocuğu `<div id="ses-yuvasi" />`;
  `AlertCenter` sesi kilitliyken oraya `createPortal` ile `Notice tone="neutral" size="sm" title="Sesli uyarılar
  kapalı" action={<Button size="xs" variant="secondary" onClick={unlockAudio}>Sesi aç</Button>}` çizer (44 px
  düğme). Sayfayla kayar; ilk dokunuşta kaybolur (bugünkü `unlockAudio`). Yuva yoksa (ör. pencere) hiçbir şey çizmez.
- Ayarlar akordeonunun özet satırı önemi taşır: `SectionCard`'a `summaryTone?: "warn" | "bad"` (özet tonun
  mürekkebi + `TONE_ICON`); Yedek bölümünde yedek yoksa ya da eskiyse `warn`; su faturası girilmediyse Oranlar ve
  ölçüler bölümünde `warn`.

### 4.7 Ortak düzey eşlemesi (zil, "Dikkat" kartı, iş listeleri)

| Yer | Bugün | Yeni |
|---|---|---|
| Zil `components/panel/notifications.tsx:28-32` `KIND` | danger `AlertTriangle` + `bg-red-500/15`, warning `AlertCircle` + amber (ikonlar ters) | danger → `TONE_ICON.bad` + `TONE_TILE.bad`, warning → warn, info → neutral; "Uyarılar" grubundaki maddeler `alertTone` (aşağıda) ile çizilir. Gruplama, sayılar, okundu bilgisi, `overdueCount` **aynı** |
| `dashboard-alerts.tsx:13-17` `STYLE` | Önemli / Uyarı / Bilgi | bad "Önemli" / warn "Dikkat" / neutral "Bilgi", ikon ve kuyu `TONE_ICON` / `TONE_TILE`; kartın ikon `TriangleAlert` → `ListChecks` (uyarı ikonu yalnız uyarıda); kart başlığı aynı |
| `task-style.tsx:13-21` | todo turuncu kuyu + amber rozet, `TASK_BAR.todo` turuncu | done aynı · **todo `well: "bg-note text-ink-soft"`, `tone: "gray"`**, ikon `CircleDashed`, etiket "Yapılacak" · warn `well: "bg-bad-soft text-bad-ink"`, ikon `TONE_ICON.bad` · later aynı · `TASK_BAR.todo: "bg-ink/40"` |
| `hammaddeler/page.tsx:236` Stat ikonu, `hammaddeler/price-holds.tsx:205`, `faturalar/page.tsx:176`, `tutarlilik/page.tsx:164` | başlık / rakam ikonu olarak uyarı ikonu | değişmez (kart başlığı ikonu; bekçinin izin listesinde) |

**`alertTone` (görünüm katmanı, yeni `src/app/panel/alert-tone.ts`, saf):** `alertTone(a: { level; title; href? }):
NoticeTone`. `danger → bad`, `warning → warn`, `info → neutral`; üç düzeltme (aynı gerçek her yüzeyde aynı önemde;
`src/lib/calc/insights.ts` **değişmez**):
- başlık `/ürünün kârı düşük$/` (insights 1007, danger) → `warn` (süresi olmayan öneri);
- başlık `"Su ve buz maliyeti"` ile başlıyor (1085, 1091, info) → `warn`;
- başlık `"Geçen ayın stok sayımı yok"` (1102, info) → `warn`.

`dashboard-alerts.tsx` sıralama (`RANK`) `alertTone`'a göre. Zil de aynı işlevi kullanır.

### 4.8 İş listeleri (telefon deseni)

- **Genel bakış "Bu ayın işleri"** (`dashboard-checklist.tsx`, `dashboard-checklist-tasks.tsx`):
  - Başlık **"{Ay Yıl} işleri"** ("Eylül 2026 işleri"; 29 Ekim'de Eylül açılıp "Bu ayın" demesi yanlıştı).
  - Liste `tasks.filter((t) => t.key !== "odeme")` alır (K22). `page.tsx` ödeme işini başta tek satıra çevirir:
    `status === "warn"` → `Notice tone="bad" risk="para" title="{n} ödeme gecikti · {toplam}" action={<NoticeLink
    href="/panel/hatirlaticilar">Ödemelere bak</NoticeLink>}` (n ve toplam ödeme işini kuran aynı olgulardan; yeni saf
    yardımcı `overdueNotice(facts)` `dashboard-tasks.tsx`'te); `status === "later"` (liste okunamadı) → `Notice
    tone="neutral" size="sm" title="Ödeme listesi şu an okunamadı"`; `todo` (yalnız yaklaşan) → satır yok ("Yaklaşan
    ödemeler" kartı zaten gösterir). `monthTasks` ve `taskSummary` **değişmez** (testleri aynı).
  - Telefonda sıradaki iş tam kart; ötekiler bugün tek satır olarak açık, artık **"Diğer {n} iş"** düğmesinin arkasında
    (`max-sm:hidden` until açılır; aynı `toggle`, `aria-expanded` / `aria-controls`); açıkken düğme "Gizle".
    `phoneChecklist` mantığı aynı (test `mobil-genel` aynı). Masaüstü aynı.
  - Kartın açık başlaması bugünkü kural (`monthOpen > 0`).
- **Bugün "Yapılacaklar"** (`bugun/today-tasks.tsx`): telefonda aynı desen: "Şimdi"nin ilk işi tam kart, ötekiler tek
  satır (ad + rozet + ok; açıklama `sr-only`) "Diğer {n} iş" arkasında; "Sonra" grubu kapalı `<details>`
  ("Sonra ({n})"); masaüstü aynı. Alttaki bağlantı "Bu ayın işleri Genel bakış'ta" → **"Ayın işleri Genel bakış'ta"**.
- **"Dikkat edilmesi gerekenler"** (Genel bakış): gelirken bir gerçeği ikinci kez söyleyen madde süzülür (görünüm,
  `page.tsx:198` bugünkü süzgecin yanına): ay listesinde `su` işi açıkken (`todo` / `warn`) başlığı "Su ve buz
  maliyeti" ile başlayan madde çizilmez.

---

## 5. Bölüm 2: göç kuralı

- Göç mekaniktir: kutunun sınıfları ve elle ikonu kalkar, `<Notice tone size title text action risk tech>{Ayrıntı}</Notice>`
  gelir; `role` ve `ref` prop'a taşınır; metin Ek A / §6'daki gibi ("metin aynı" = dinamik ya da zaten kısa).
- Uzun bir metin bölünürken **ilk cümle (ya da ilk iki nokta üst üsteye kadar)** başlık olur; tutar, gün ve sonuç
  başlıkta kalır; geri kalanı aynen Ayrıntı'ya. Hiçbir cümle silinmez (Ek A'da açıkça "kalkar" yazanlar hariç).
- Kapsam: `bg-(warn|bad|info|good)-soft`, `bg-lime/25`, `role="alert|status|note"` taşıyan 290 konum (Ek A; 172
  Notice, 15 form / eylem hatası, 103 dokunulmaz) + yardımcı kullanımları (§6.2) + kutusuz ⚠ satırları (§6.3) + gri
  bilgi kutuları (§6.5). Ek A'da "→ §6.1" yazan satırın metni §6.1'de, "bkz. §6.2" yazanınki §6.2'de, "bkz. §7.x"
  yazanınki Bölüm 3'te.
- Yerel yardımcılar silinir: `gelir-gider/pnl-grid.tsx` `Warn`, `tedarikciler/[cari]/debt-dialog.tsx` `Warn`,
  `kasa/okc-card.tsx` `Note`, `tedarikciler/[cari]/cari-strips.tsx` `Strip`, `vergi/ui.tsx` `NoteList`'in `tone`
  parametresi (tonsuz `NoteList` döküm notu olarak kalır). Ortak yeni `kasa/check-notices.tsx` `CheckNotices`
  (`cash-photos.tsx:48` ve `cash-out-dialog.tsx:430`'un aynı listesi).

---

## 6. Bölüm 2: göç tabloları

### 6.1 Sayfa düzeyi ve öne çıkan uyarılar (Ek A'da "→ §6.1" olanlar ve uyarı yerine geçen ipuçları)

Biçim: **başlık** · text · Ayrıntı · eylem · tech. `{…}` dinamik.

| Kod | Yer (main) | Yeni |
|---|---|---|
| U1 | Ödemeler kırmızı "Gecikmiş" sayaç kartı (`reminders-client.tsx:373`) | **değişmez** (durum rakamın kendisinde) |
| U2 | Nakit planı mavi şerit (`nakit/cash-plan-client.tsx:170`) | `neutral·md` · **"Bakiye girilmedi: bugün en az {tutar} gerekir"** · text "En sıkışık gün {gün}." · eylem yok (başlıktaki "Bakiyeyi gir" tek giriş) |
| U2b | Nakit planı kırmızı şerit (`:162`) | `bad·md` risk=para · **"{gün} para yetmeyebilir: tahmini {tutar}"** · Ayrıntı "O gün: {kalemler}" (bugünkü metin) |
| U2c | Nakit planı yeşil şerit (`:180`) | `good·md` · **"{n} hafta boyunca para yetiyor"** · text "En sıkışık gün {gün}: {tutar}." |
| U3 | Gelir-gider SGK kutusu (`gelir-gider/sgk-rate-notice.tsx:21`; metin `lib/tax/edit.ts:349-366`) | `warn·md` risk=para · **"SGK oranı: Maaşlar'da {a}, vergide {b}"** · eylem `canApply` ise bugünkü düğme "Oranı {b} yap", değilse `NoticeLink` "Muhasebeciye sor" → `/panel/vergi/kurallar#sorular` · Ayrıntı bugünkü `text` (§3.10'daki yer adlarıyla) + `NoticeLink` "Maaşlar › SGK oranları" → `/panel/personel#sgk-oranlari`. `edit.ts`'in döndürdüğü nesneye eklemeli `current: number` (Maaşlar'daki oran) |
| U4 | Gelir-gider 12 px gri not (`gelir-gider/page.tsx:338`) | sayım eksikse `warn·sm` risk=para · **"{aylar} sayımı yok: mal maliyeti tahmini"** · eylem `NoticeLink` "Sayım gir" → `/panel/sayim?ay={sayımsız son ay}` · Ayrıntı "Kapanış stoğu 0 sayıldı; alınan malın tamamı maliyet." · yalnız ciro notu varsa gri satır kalır: "Yıl kartları POS cirosu girilmiş {n} ayın toplamı." |
| U5 | Bildirim izni kapalı (`components/panel/live/device-alerts.tsx:137`; iki rol) | `bad·sm` · **"Bu cihazda bildirim izni kapalı: uyarılar gelmez"** · Ayrıntı "Adres çubuğundaki site ayarları simgesinden (kilit) Bildirimler'i "İzin ver" yapın, sonra sayfayı yenileyin. {note}" |
| U6 | Karaoke yönetici mavi kutu (`karaoke/karaoke-board.tsx:154`) + gri satır (`karaoke/orders-board.tsx:208-214`) | tek `neutral·md` · **"Site bağlantısı kurulmadı: rezervasyon ve sipariş gelmiyor"** · text "Hızlı sayaç çalışır." · eylem `NoticeLink` "Bağlantı" → `#baglanti` · tech "İki projeye (laffogato.net ve bu panel) aynı KARAOKE_SYNC_SECRET eklenince rezervasyon ve siparişler buraya kendiliğinden gelir." · **gri satır kalkar** (iki rolde) |
| U7 | Karaoke personel mavi kutu + gri satır | tek `neutral·md` · **"Site bağlı değil: rezervasyon ve sipariş buraya gelmez"** · text "Hızlı sayacı kullanın." · tech yok, yönetici talimatı yok |
| U8 | Kasa raporu e-posta (`kasa/cash-settings.tsx:53`) | `neutral·sm` · **"E-posta gönderimi kurulmadı: raporlar WhatsApp'la gider"** · tech "Vercel'de RESEND_API_KEY tanımlı değil. Raporlar yine kaydedilir." |
| U9 | Satış tahmini 41 sözcük (`tahmin/page.tsx:66`; `lib/forecast/text.ts`) | `neutral·md` · başlık yeni `qualityTitle(f)`: kip "ay" → **"Kaba tahmin: {n} günlük kasa raporu var"** (rapor yoksa **"Kaba tahmin: kasa raporu yok"**), "ortalama" → **"Hafta günü farkları varsayılan: son 14 günde {n} rapor"**, "karma" → **"{gün} için {n} rapor yok: ortalama gün kullanıldı"** · Ayrıntı bugünkü `qualityBanner(f)` (değişmez) |
| U15 | Vergi bandı | §7.4 |
| U16 | Vergi kârı "sayımı yok" (`vergi/gelir-gider/page.tsx:130`, metin `lib/tax/pnl.ts`) | `warn·sm` risk=hukuk · başlık uyarının ilk virgülüne kadarı (**"30 Eylül sayımı yok: stok 0 sayıldı"**) · Ayrıntı kalanı · eylem `NoticeLink` "Sayım gir" → `/panel/sayim?ay={ay}` |
| U17 | Vergi kârı "Yönetim verisi (ModPOS), mali belge değil" rozeti (`quarter-table.tsx:103`, `quarter-phone.tsx:65`) | rozet turuncu → **gri**, metin `plainBadge()`: **"Kasa programının rakamı ({kasa}), resmî belge değil"** (uyarı değil, kaynak) |
| H1 | Vergi kârı "Bu çeyrekte {X} gider sayılmadı ({n} kalem) · {Y} demirbaş olabilir" (`classify-list.tsx` CardHeader açıklaması) | sayfanın başında `warn·md` risk=hukuk · **"{X} gider vergi hesabına girmedi ({n} kalem)"** · text "{Y}'lik {m} fatura demirbaş olabilir." (varsa) · eylem `NoticeLink` "Belgesini seç" → `#siniflandir`; kartın açıklaması kalkar (tekrar), kartın başlığı **"Eksik belgeler"** |
| H3 | Su faturası (Ayarlar gri ipucu; Hammaddeler ⓘ) | Ayarlar Oranlar ve ölçüler bölümü: `warn·sm` risk=para · **"Su faturası girilmedi: su ve buz maliyetsiz"** · eylem `NoticeLink` "Gelir-gider'de gir" → `/panel/gelir-gider?ara=su+gideri`; Hammaddeler: mevcut ⓘ `InfoTip tone="warn"` olur |
| H4 | Kurulum talimatları: Site menüsü (`urunler/site`, 232 px), Gelir-gider site kartı, Karaoke Bağlantı kartı | Site menüsü: `neutral·md` · **"Site bağlantısı kurulmadı: eşleştirme yapılamaz"** · tech bugünkü talimat; Gelir-gider: `neutral·sm` · **"Site bağlantısı kurulmadı: online satış satırları görünmez"** · tech bugünkü; Karaoke Bağlantı kartı: liste `<details>` "Teknik ayrıntı (geliştirici için)" içine. Tam talimatın evi Ayarlar › laffogato.net (değişmez) |
| H5 | Cihaz ipuçları ×4 (`device-alerts.tsx:197`, `output-picker.tsx:91`) | tek `<details>` **"Ses ve bildirim ipuçları (4)"**, metinler aynen içinde |
| H6 | Reçete defteri ürün notu ×19 (personel de görüyor; `receteler/page.tsx:106`, `recipe-book.tsx:340-456`) | yönetici aynen; **personel görünümünde ürünün `note`'u çizilmez** (reçete satırları ve hazırlama notu aynı) |
| H7 | Ayarlar "Yedek yok" (telefon özeti gri) | `SectionCard summaryTone="warn"`: özet "Yedek yok" turuncu + ⚠ |
| Y1 | Personelin 14 ekranında yüzen ses hapı | §4.6 ses yuvası |
| Sistem | `system-banner.tsx:16` (kırmızı, `role="alert"`) | madde başına `bad·md` risk=veri · başlık `{title}` · text `{body}` (metin aynı) · `role="note"`; birden çoksa `NoticeGroup` |
| Genel bakış | "Ödemeler · bugün" iş kartı | §4.8 (K22) |
| Vergi Özet | Ödemeler'de günü geçmiş vergi / SGK hatırlatıcısı | §7.2 (K12) |

### 6.2 Yardımcı kullanımları

| Yardımcı (main) | Kullanım | Yeni |
|---|---|---|
| `vergi/ui.tsx` `TaxBanner` | `vergi/page.tsx:67,89`, `gelir-gider/page.tsx:88,113`, `demirbas/page.tsx:94`, `kurallar/page.tsx:69` | §7.4 (ad aynı kalır: test `<TaxBanner data={banner} />` arar) |
| `vergi/ui.tsx` `DisclaimerBody` | `vergi/page.tsx:126`, `kurallar/page.tsx:71` | Özet'ten **kalkar**; Muhasebeci'de sayfanın **sonunda**, her genişlikte (`sm:hidden` kalkar) |
| `NoteList tone="warn"` | `vergi/page.tsx:108` (Özet uyarıları), `tax-calendar.tsx:85` (K4 farkı), `demirbas/page.tsx:109` (ömür girilmedi), `:184` (satır uyarısı), `gelir-gider/page.tsx:131` | `Notice tone="warn" size="sm" risk="para"`; liste ≥ 2 ise ilk not başlık, kalanı Ayrıntı. `demirbas:109` eylem "Ömrü gir" (bugünkü düzenleme düğmesine götürür); `tax-calendar:85` satırın açık gövdesinde `size="line"` |
| `NoteList tone="bad"` | `demirbas/page.tsx:114` (`ORPHAN_ASSET_WARNING`), `gelir-gider/page.tsx:130` (U16) | `demirbas:114` → `warn·sm` risk=hukuk · **"{ad}: faturası silinmiş demirbaş"** · text "Listeden çıkarın; yoksa iki kez gider sayılır." (bugünkü metnin anlamı) · eylem bugünkü düğme; `:130` → U16 |
| tonsuz `NoteList` | `bridge-card.tsx:31,38`, `gelir-gider/page.tsx:132`, `tax-calendar.tsx:86`, `tax-cards.tsx:122,171` | **değişmez** (döküm notu, uyarı değil) |
| `pnl-grid.tsx` `Warn` (pencere içi ⚠) | `:514, :516, :518` | `Notice tone="warn" size="line"` (metinler aynı) |
| `debt-dialog.tsx` `Warn` | `:399, :414, :465, :470` | `Notice tone="warn" size="sm"` (metinler aynı) |
| `okc-card.tsx` `Note` | `:179, :182, :188` | `Notice size="sm"`: good → good, info → neutral, warn → warn |
| `cari-strips.tsx` `Strip` | `:99, :115, :137, :160, :181, :202, :218` | `Notice size="md"`: good → good, info → neutral, warn → warn (risk=para: borç ve ödeme şeritleri), gray → neutral; `:204` `CircleAlert` ikonu kalkar |
| `payment-ui.tsx` `HintLine` | `:695` | **değişmez** (satır içi, eylemli; iyi desen); ikonu `TONE_ICON.warn` |
| `CheckNotices` (yeni, `kasa/check-notices.tsx`) | `cash-photos.tsx:48`, `cash-out-dialog.tsx:430` | `Notice size="sm"`: `level === "warn"` → warn, öteki → neutral (metin aynı) |
| `InfoTip tone="warn"` | `pnl-grid.tsx:344`, `vergi/ui.tsx:91` | `pnl-grid` kalır; `ui.tsx:91` bant değişince kalkar (bayatlık ayrı satır, §7.4) |

### 6.3 Kutusuz ⚠ satırları (renkli sınıfsız; Ek A'da yok)

Hepsi `Notice size="line"`, metin aynı; ton satırdaki renkten.

| Yer (main) | Ton |
|---|---|
| `parasut/parasut-client.tsx:1500`, `:1511` (çarpan / paket adı sorusu) | warn |
| `parasut/parasut-client.tsx:904` (kontrol edilecek bağlantılar başlığı) | Ek A 162. satırın parçası |
| `onaylar/kasa-cards.tsx:200` (`monthPassed`) | warn |
| `onaylar/kasa-cards.tsx:377-379` (aynı listenin uyarı satırı) | warn |
| `onaylar/kasa-closed-cards.tsx:60` (`lines.red`) | bad |
| `onaylar/kasa-closed-cards.tsx:66` (`lines.warn`) | warn |
| `onaylar/kasa-out-cards.tsx:161` (`c.flags`) | bad |
| `onaylar/ops-cards.tsx:177` | Ek A 150. satırın parçası |
| `onaylar/review-list.tsx:239, 474, 480, 683, 694` | Ek A 151-156'nın parçası |
| `personel/staff-editor.tsx:721` (`check.formError`) | bad |
| `faturalar/invoice-lines.tsx:143` ("Faturanın KDV hariç tutarı … tutmuyor") | warn |
| `gelir-gider/month-view.tsx:320` (hücre `c.warn`), `:613` (`cell.warn`), `:646` (`freezeWarn`, `aria-live` kalır) | warn |
| `giderler/history-ui.tsx:72` (`effect.warn`) | warn |
| `karaoke/doluluk/page.tsx:289` ("Son deneme: {hata}") | bad |
| `kasa/closed-day.tsx:120`, `kontrol/duzenle/[id]/template-editor.tsx:336`, `sayim/add-item.tsx:187`, `sayim/stock-form.tsx:1067`, `satislar/page.tsx:322`, `satislar/sales-client.tsx:404, 528, 977, 1959`, `kullanicilar/close-guard.tsx:28`, `kullanicilar/access-sheet.tsx:201`, `tedarikciler/card-dialog.tsx:392`, `tedarikciler/[cari]/link-dialog.tsx:304, 314`, `tedarikciler/[cari]/debt-dialog.tsx:561`, `tedarikciler/request-dialog.tsx:190, 252, 259`, `karaoke/orders-board.tsx:235`, `karaoke/karaoke-board.tsx:162`, `kasa/cash-photos.tsx:99, 188`, `gelir-gider/sgk-rate-notice.tsx:23`, `hatirlaticilar/nakit/cash-plan-client.tsx:163`, `system-banner.tsx:17` | Ek A'daki kutularının elle ikonları: kutuyla birlikte kalkar (ikon Notice'ten) |

### 6.4 Bekçi (yeni `tests/uyari-goc.test.ts`)

- `src/app/panel/**` ve `src/components/panel/**` `.tsx` dosyalarında bir `className` dizesinde
  `bg-(warn|bad|info|good)-soft` ya da `bg-lime/25` **ve** dolgu (`px-` / `py-` / `p-`) birlikte yalnız izin listesindeki
  dosya:satırlarda (Ek A'nın "D" satırları + `ui/notice.tsx`; satır kayabileceği için izin `dosya + sınıf dizesinin bir
  parçası` ile tutulur).
- Aynı dosyalarda `<TriangleAlert`, `<AlertTriangle`, `<CircleAlert`, `<AlertCircle` JSX'i yalnız: `ui/notice.tsx`,
  `ui/info-tip.tsx`, `panel/error-view.tsx`, kart / rakam başlığı ikonu olarak §4.7'deki dört yer.
- `text-bad` ile `bg-bad-soft` aynı `className`'de yok (kontrast).
- Geliştirici sözcüğü bekçisi: `src/app/panel/**` ve `src/components/panel/**` `.tsx` dosyalarında, yorumlar ve
  `import` satırları atıldıktan sonra `Vercel`, `openssl`, `docs/[A-Z]` ve ortam değişkeni adı
  (`/\b[A-Z][A-Z0-9_]*_(SECRET|API_KEY)\b/`, önünde `process.env.` yoksa) yalnız şu yerlerde geçer: (a) bir `tech={…}`
  ifadesinin içinde (son `tech={`'ten eşleşmeye kadar açık süslü parantez sayısı > 0), (b) satır sonunda
  `// tech-metni` işareti olan satırda (değişkene alınıp yalnız `tech`'te kullanılan metin, ör.
  `hatirlaticilar/notifications-section.tsx:111`), (c) kurulumun evi olan yönetici ekranlarında:
  `src/app/panel/ayarlar/**`, `src/app/panel/parasut/**`, `src/app/panel/yardim/page.tsx`. Bugün bu kuralı bozan ve
  bu PR'da `tech`'e taşınan yerler: `kasa/cash-settings.tsx:54`, `kullanicilar/access-sheet.tsx:186`,
  `urunler/[id]/site-menu-card.tsx:125`, `urunler/site/site-menu-matching.tsx:598-605`,
  `gelir-gider/site-sales-card.tsx:124-125`, `karaoke/karaoke-admin.tsx:173-179`, `karaoke/karaoke-board.tsx:156`,
  `hatirlaticilar/notifications-section.tsx:196-203`.
- `<Notice` çağrılarında düz metin `title="…"` ≤ 10 sözcük, `text="…"` ≤ 18 sözcük.
- Personelin açtığı ekran dosyalarında (`STAFF_PATHS` sayfaları ve içe aktardıkları `src/app/panel/{bugun,kasa,karaoke,
  kontrol,zayi,receteler,sayim,hatirlaticilarim,ozel-gunler}/**`) `tech=` yalnız yönetici dalında (`role === "admin"`
  ya da `isAdmin` ile koşullu) geçer.

### 6.5 Gri bilgi kutuları (renk sınıfsız, Ek A dışında; öz denetimde bulundu)

Uyarı ya da durum söyleyenler `Notice`'e geçer; önizleme, boş durum ve form bilgisi olduğu gibi kalır.

| Yer (main) | Bugün | Yeni |
|---|---|---|
| `onaylar/kasa-cards.tsx:385` `{blocked}` | gri, onayı engelliyor | `bad·sm` (metin aynı) |
| `onaylar/kasa-out-cards.tsx:151` "Satır silinmiş; isteği reddedin." | gri | `bad·sm` (metin aynı) |
| `onaylar/kasa-out-cards.tsx:284` `{card.refusal}; isteği reddedin.` | gri | `bad·sm` (metin aynı) |
| `onaylar/kasa-cards.tsx:152` "Rapor zaten bu hâlde; isteği kapatın." | gri | `neutral·sm` |
| `onaylar/karaoke-cards.tsx:82` "Sayaç zaten silinmiş" · `onaylar/ops-cards.tsx:174` "Kayıt zaten silinmiş" | gri | `neutral·sm` |
| `onaylar/kasa-cards.tsx:377-379` "Devir zincirinin tutması kanıt değildir …" (gri ⚠ satırı) | gri, ⚠ | `neutral·line` (uyarı ikonu kalkar; `Info`) |
| `karaoke/orders-board.tsx:183` "Bu cihazda sipariş zili kapalı …" + düğme | gri | `neutral·sm` · eylem bugünkü düğme (personel de görür; metin aynı) |
| `karaoke/orders-board.tsx:212` (bağlantı yok satırı) | gri | **kalkar** (U6 / U7) |
| `kasa/cash-requests.tsx:100`, `kasa/late-report.tsx:77` (onay bekleyen istekler) | gri | `neutral·sm` (metin aynı) |
| `kasa/cash-form.tsx:926` "Ertesi günün raporu girildi …" + düğme | gri | `neutral·sm` · eylem bugünkü düğme |
| `kullanicilar/users-client.tsx:1098` "Kendi hesabınızı pasif yapamazsınız." | gri | `neutral·sm` |
| `karaoke/doluluk/page.tsx:218` "Oda saatleri varsayılan …" + düğme | gri | `neutral·md` · eylem `HoursButton` |
| `ayarlar/photo-card.tsx:63` "Bu ortamda ANTHROPIC_API_KEY yok …" | gri | `neutral·sm` · **"Fotoğraftan okuma bu ortamda kapalı"** · tech bugünkü metin |
| `ayarlar/jobs-card.tsx:97` "Günlük işler yalnız canlı sitede (Vercel Cron) çalışır …" | gri | `neutral·sm` · **"Günlük işler yalnız canlı sitede çalışır"** · tech "Vercel Cron; yerelde uyarı verilmez." |
| Önizleme, boş durum, form bilgisi: `komisyonlar/channel-card.tsx:112,128`, `zayi/waste-board.tsx:229`, `parasut/parasut-client.tsx:1698,1702`, `analiz/analysis-client.tsx:973`, `receteler/new-product-sheet.tsx:277`, `receteler/my-requests.tsx:104`, `kullanicilar/users-client.tsx:837`, `hesap/two-factor.tsx:249`, `page.tsx:889,1239`, `onaylar/review-list.tsx:233,468,496,710,727`, `hammaddeler/price-holds.tsx:226`, `hammaddeler/ingredients-client.tsx:1370`, `urunler/fiyatlar/bulk-editor.tsx:351,961`, `urunler/[id]/price-history-card.tsx:127`, `urunler/[id]/site-menu-card.tsx:175`, `urunler/site/site-new-product.tsx:126`, `ayarlar/backup-client.tsx:73`, `ayarlar/lafpos-card.tsx:68`, `ayarlar/page.tsx:162`, `ayarlar/stock-valuation.tsx:168`, `ayarlar/photo-card.tsx:53`, `gelir-gider/site-sales-card.tsx:162`, `gelir-gider/month-view.tsx:280`, `tedarikciler/cari-payment-dialog.tsx:454,482,546`, `tedarikciler/[cari]/link-dialog.tsx:311`, `tedarikciler/[cari]/allocation-dialog.tsx:218`, `karaoke/orders-board.tsx:198`, `karaoke/sold-out-card.tsx:233`, `tahmin/forecast-settings.tsx:134` | gri | **değişmez** (uyarı değil) |

---
## 7. Bölüm 3: Vergi sadeleştirme

Amaç: sahip Vergi'yi açınca üç soruya ilk ekranda cevap alır: **"ne zaman, ne kadar ödeyeceğim?"** (iki rakam +
takvim), **"KDV ödeyecek miyim?"** (KDV satırının kendisi), **"rakam neden yüksek / eksik?"** (tek turuncu satır).
Hesap motoru, takvimin içeriği, uyarıların koşulu ve `docs/VERGI.md` §1 kuralı (taslak tutar takvimin tutar sütununa ve
nakit planına yazılmaz) **değişmez**. Değişen: ne çizildiği, sırası, adı.

### 7.1 Özet (`/panel/vergi`, `vergi/page.tsx`): yeni sıra

| # | Blok | Bugün | Yeni |
|---|---|---|---|
| 1 | Başlık | H1 "Vergi", bağlam "Finans", açıklama `OZET_DESCRIPTION` | H1 **"Vergi, KDV, SGK"**, bağlam ağaçtan (telefonda yok), açıklama §8; sekmeler Özet · Vergi kârı · Demirbaş · Muhasebeci |
| 2 | Bant | 102 px gri kutu (§7.4) | tek satır (§7.4) |
| 3 | Gecikmiş vergi satırı (yeni, K12) | yok | §7.2 |
| 4 | Üç rakam | Sıradaki ödeme · Önümüzdeki 30 gün · **Hazırlık 0 / 4** (bağlantılı karo) | **iki rakam**: Sıradaki ödeme · Önümüzdeki 30 gün; `grid grid-cols-2 gap-2` her genişlikte (telefonda yan yana). Hazırlık karosu ve `#baslarken` bağlantısı **kalkar** (sayı Başlarken satırında) |
| 5 | Başlarken | 4 satırlık kart (telefonda ~389 px) | **tek satır** (§7.3); bitince bugünkü "Hazırlık tamam · yeniden aç" satırı |
| 6 | Özet uyarıları (`view.warnings`) | gri `role="note"` kutu + `NoteList tone="warn"` + düğme | `Notice tone="warn" size="sm" risk="para"` (Ek A, `vergi/page.tsx:107`); ilk uyarı başlık, kalanı Ayrıntı; `orphans` varsa eylem `NoticeLink` "Demirbaş'ı aç" → `/panel/vergi/demirbas` |
| 7 | Takvim kartı (sol, `lg:col-span-2`) | "Sıradaki vergi ödemeleri" | §7.5 |
| 8 | Sağ sütun | iki kart: geçici vergi katkısı + kurumlar vergisi | **tek kart "Şirketin kâr vergisi"** (§7.6) |
| 9 | Sondaki tam feragat | `DisclaimerBody` (telefonda) | **kalkar** (tam metin bandın ⓘ'sinde ve Muhasebeci'nin sonunda) |

Bandın altındaki iki uyarı (bayat kurallar §7.4, gecikmiş vergi §7.2) tek `NoticeGroup`'ta (gecikmiş satır `risk`'li,
hep görünür). `!view.hasData` dalı: başlık + bant + bugünkü "Hesap için veri yok" kartı (metin aynı). Yükleme iskeleti
(`Suspense fallback`) yeni H1 ve açıklamayla.

### 7.2 Gecikmiş vergi / SGK satırı (yeni, yalnız ekleme)

- Kaynak: `loadTaxView`'un zaten okuduğu `reminders` (yeni sorgu yok). Yeni saf işlev `overdueTaxReminders(reminders,
  today)` (`src/lib/tax/overdue.ts`, yeni dosya; `src/lib/calc/**` değil): `active` ve `dueDate < today` olan, sınıfı
  vergi ya da SGK olan hatırlatıcılar (`reminderCategory(kind, title) === "sgk"`, `isVatReminder`,
  `isVatWithholdingReminder`, `isMuhtasarReminder`, `isProvisionalTaxReminder`, `isKvReminder`, `kind === "vergi"`),
  güne göre sıralı. Sınıflayıcılar var olanlar: `src/lib/reminders.ts` (`reminderCategory`, `isVatReminder`,
  `isVatWithholdingReminder`, `isMuhtasarReminder`, `isProvisionalTaxReminder`) ve `src/lib/tax/view.ts` (`isKvReminder`).
  Ödemeler'in "Gecikti" grubuyla aynı kural (aynı kayıtlar).
- Varsa bandın hemen altında: `Notice tone="warn" size="sm" risk="para"` · başlık **"Ödemeler'de günü geçmiş {n}
  vergi ödemesi"** (n = 1 ise **"Ödemeler'de günü geçmiş vergi ödemesi: {başlık}"**) · `text`: her biri için
  "{başlık} {gün ay}" virgülle (en çok 3, fazlası "+{k}") · Ayrıntı: yasal son günü bugünden sonra olanlar için
  **"{başlık}: Ödemeler'deki gün {26 Ekim}, yasal son gün {2 Kasım}."** (yasal gün takvimdeki aynı dönemin `due`'sundan;
  bulunamazsa cümle yazılmaz) · eylem `NoticeLink` **"Ödemeler'de aç"** → `/panel/hatirlaticilar`.
- Neden `warn`, `bad` değil: Ödemeler'deki gün çoğu zaman yasal günden erken (SGK 26 ↔ 2 Kasım); kırmızı ve ödeme
  düğmesi Ödemeler'de kalır (K12, K13). Ödenince (Ödemeler'de "Ödedim") satır kendiliğinden kalkar.
- Takvim satırının kendisi de iki günü yazar: §7.5 "Gün farkı".

### 7.3 Başlarken tek satır (`tax-cards.tsx` `GettingStartedCard`)

- `done < total`: `<Card id="baslarken">` içinde tek `<details>`; özet (44 px dokunma, `min-h-12 px-5`):
  `ListChecks` ikonu · **"Başlarken: {done} / {total}"** · `text-ink-mute` "sıradaki: {ilk bitmemiş adımın başlığı}"
  (telefonda `max-sm:hidden`) · sağda `ChevronDown`. Açılınca bugünkü adım listesi ve bugünkü açıklama cümlesi
  ("Hesabın asıl belirleyicisi bu adımlar; bitene kadar geçici ve kurumlar vergisi taslaktır.") listenin üstünde.
- `done === total`: bugünkü katlanmış "Hazırlık tamam · yeniden aç" aynen.
- Adımların verisi (`view.gettingStarted`) değişmez; yalnız `view.ts:973` metni "fatura **varlık** listesinde değil" →
  "fatura **demirbaş** listesinde değil" ve "varlığın ömrü girilmedi" → "demirbaşın ömrü girilmedi" (K17;
  `tests/vergi-takvim.test.ts:267` güncellenir).

### 7.4 Bant: her sekmede kutusuz tek satır (`vergi/ui.tsx` `TaxBanner`)

```
ⓘ Tahmin, beyanname değil    [Kapsam: yalnız kafe ⓘ]    [Muhasebeciye sorulacaklar: 0 / 8]   (son ikisi çip)
```

- Kök: `role="note" aria-label="Vergi tahmini hakkında"` (aynı) ve
  `mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] leading-5 text-ink-soft`; zemin ve dolgu yok.
- İlk öğe: `TAX_DISCLAIMER_SHORT` + `InfoTip text={full}` (`full` = bugünkü gibi `TAX_DISCLAIMER` + `compiled` +
  `stale`). Telefonda ve masaüstünde aynı (bugünkü iki dal birleşir; `max-sm:hidden` / `sm:hidden` kalkar).
- Kapsam çipi metni `data.scope.text` (aynı), ⓘ aynı. Muhasebeci çipi: masaüstünde aynı, telefonda `max-sm:hidden`
  (sekme "Muhasebeci" zaten görünür; bugün yatay kaydırmada ekran dışına kayıyordu).
- Bayat kurallar (`data.stale.length > 0`): bandın altında ayrı `Notice tone="warn" size="sm"` · başlık **"Vergi
  kuralları güncel olmayabilir"** · Ayrıntı: `stale` cümleleri · eylem `NoticeLink` "Kural tablosu" →
  `/panel/vergi/kurallar#kurallar`. `InfoTip tone="warn"` (`ui.tsx:91`) kalkar.
- Test bekçisi aynen geçer: `<TaxBanner data={banner} />` (dört sayfa), `{TAX_DISCLAIMER}` ve `{TAX_DISCLAIMER_SHORT}`
  `ui.tsx`'te (`TAX_DISCLAIMER` artık `full`'un içinde ve `DisclaimerBody`'de JSX olarak geçer: `{TAX_DISCLAIMER}`
  dizesi `DisclaimerBody`'de kalır), `role="note"`.
- Ölçü: masaüstünde 102 → ≤ 32 px, telefonda 48 → ≤ 28 px (dört sekme).

`DisclaimerBody`: yalnız Muhasebeci'nin **sonunda**, her genişlikte (`sm:hidden` kalkar), `id="feragat"`; Özet'ten
kalkar.

### 7.5 Takvim kartı (`tax-calendar.tsx`)

**Kart başlığı** "Sıradaki vergi ödemeleri" → **"Vergi ve SGK ödemeleri"**; açıklama → **"Önümüzdeki 100 gün, yasal son
günle. Satıra dokunun: döküm ve dayanak."**

**Satır başlığı (sade ad).** Yeni `src/lib/tax/glossary.ts` `calendarTitle(row: Pick<TaxCalendarRow, "kind" | "period"
| "title">): string`; `Row` `row.title` yerine bunu çizer. `view.ts` `titleOfKind` **değişmez** (Excel dışa aktarımı
muhasebeciye gider, resmî adla kalır; `tests/vergi-takvim.test.ts` satır listesi aynı):

| Tür | Bugün (`row.title`) | Ekranda |
|---|---|---|
| `kdv1` | KDV (Ekim) | **KDV (Ekim satışları)** |
| `kdv2` | KDV-2 (Eylül) | KDV-2 (Eylül) (aynı; açılınca ilk not glossary'den: "Faturadaki KDV'nin sizin ödediğiniz kısmı (tevkifat) ve yurt dışı hizmetin KDV'si.") |
| `mphb` | Muhtasar ve prim hizmet (Ekim) | **Maaş vergileri ve stopaj (muhtasar, Ekim)** |
| `sgk` | SGK (Eylül) | **SGK primi (Eylül maaşları)** |
| `gecici` | Geçici vergi 2026/3 | **Kâr vergisi peşinatı: 3. çeyrek 2026 (geçici vergi)** |
| `kv` | Kurumlar vergisi 2026 | **Yıllık kâr vergisi 2026 (kurumlar vergisi)** |
| `ctv` | ÇTV 2026 2. taksit | **Çevre temizlik vergisi (ÇTV) 2026, 2. taksit** |
| `yerel` | İlan ve reklam vergisi | **Tabela vergisi (ilan ve reklam vergisi)** |

**Rozet (K16).** Veri (`row.badge`, `row.source`) aynı; çizim:

| `row.badge` | Rozet | Alt satıra eklenen söz |
|---|---|---|
| `Muhasebeci` | **Muhasebeciden** (green) | – |
| `Taslak` | **Eksik bilgi** (amber) | – (sebep zaten alt satırda / açık gövdede) |
| `sabit tutar` | **yalnız damga** (gray) | – |
| `Ödemeler'de` | rozet yok | "Ödemeler'deki tutar" |
| `2026 kuralları` | rozet yok | "geçen yılın damga tutarıyla" |

**KDV satırı kendi cevabını yazar (K13).** `view.ts` KDV-1 dalına yalnız ekleme: `vr.amount === 0` iken satıra
`carryOut: vr.estimate?.carryOut ?? null` (yeni isteğe bağlı alan `TaxCalendarRow.carryOut?: number | null`).
`Row` `source === "sabit tutar"` satırında alt satıra **"Ödeme yok"** + (`carryOut > 0` ise) **" · ≈ {tl(carryOut)}
sonraki aya geçer"** yazar; tutar sütunu "791 ₺" + "yalnız damga" rozeti (aynı). Böylece satır kapalıyken
"KDV (Ekim satışları) · Son gün 28 Kasım Cumartesi → 30 Kasım · Ödeme yok · ≈ 98.100 ₺ sonraki aya geçer · 791 ₺ ·
yalnız damga" okunur. `row.note` `null` kalır (test `:404`, `:409` aynı). Açık gövdede "Ödeme beklenmez (devreden);
yalnız damga." notu artık tekrar: `view.ts`'te bu dize `export const NOTE_VAT_NONE` sabitine alınır (metin aynı, test
`:232` aynı) ve `Row` bu notu çizmez.

**Döküm etiketleri** (açık gövde, `DetailList`; çizimde `glossary.ts` `plainLabel()` ile, veri aynı): "KDV (nakit
planı)" → "Bu ayın KDV'si (tahmin)" · "Beyanname damgası" → "Beyanname ücreti (damga vergisi)". Bilinmeyen etiket
olduğu gibi geçer.

**Gün farkı (yalnız ekleme).** `ReminderHit`'e `date: string` (hatırlatıcının `originalDueOf` günü) eklenir;
`kdv1`, `kdv2`, `mphb`, `sgk` dallarında hatırlatıcı varsa satıra `reminderDue: hit.date` (yeni isteğe bağlı alan).
`Row`: `reminderDue && reminderDue !== row.due` ise alt satıra **"Ödemeler'de {26 Ekim}"** eklenir (yasal gün zaten
`shift`'te ya da tarih karosunda). Hesap, tutar ve "Nakit planında 31 Ekim'de." notu aynı.

**Muhtasar satırının riski kapalıyken görünür.** `row.kind === "mphb" && row.atLeast` ise alt satıra **"{n} giderde
vergi kesintisi (stopaj) seçilmedi"** (n: notlardaki "{n} kalemin stopajı bilinmiyor" cümlesinden; yeni isteğe bağlı
alan `unknownWithholding?: number` `view.ts`'te aynı yerden doldurulur) ve açık gövdenin eylemlerine `ButtonLink`
**"Kesintiyi seç"** → `/panel/vergi/gelir-gider#siniflandir`. Satır notu "Tahmin; kesin tutar tahakkuk fişindedir."
(`view.ts:513`) **silinir** (≈ ve bant söylüyor; testte yok).

**Satır eylemleri.** `kdv1`: iki düğme ("Nakit planında aç", "Devreden KDV'yi gir"; ikisi de `nakit#kdv`) → **tek
düğme "Döküm ve devreden KDV"** → `/panel/hatirlaticilar/nakit#kdv`. `kdv2`: "Nakit planında aç" aynı. "Ödemeler'e
ekle" / "Ödemeler'de aç" aynı. `FilingButton`, `PayrollButton` aynı.

**Çapalar (§3.7).** Her türün ilk satırının `<li>`'si: `kdv1` → `id="kdv"`, `sgk` → `id="sgk"`, `mphb` →
`id="muhtasar"`; `scroll-mt-20 target:ring-2 target:ring-ink/20 target:ring-inset`.

**"Sonra" kutusu → tek satır.** Kutu (`ring-1` kart) kalkar; takvimin altında `px-5 pt-3 text-[13px] text-ink-mute`:
**"Sonra: {calendarTitle} · {gün}"** maddeleri " · " ile; `kv` maddesinin sonunda "Tutarı bilinmiyor" yerine
`Link` **"tahmin kartta"** → `#kar-vergisi` (kart aynı ekranda ≈ tutarı veriyor; bugünkü çelişki kalkar). `gecici`
maddesinde "Tutarı bilinmiyor" aynı.

**Altbilgi** ("Enflasyon düzeltmesi 2026'da yapılmaz (VUK geçici 37) · Bu kafede hesaplanmayanlar") aynı.

### 7.6 Şirketin kâr vergisi kartı (`tax-cards.tsx`, K14)

`GeciciCardView` + `KvCardView` yerine tek `ProfitTaxCard({ gecici, kv, filings, rules })` (iki eski bileşen silinir;
`view.geciciCard` / `view.kvCard` verisi aynı, test `:277`, `:296` aynı).

```
[Landmark] Şirketin kâr vergisi (2026)                                   (id="kar-vergisi")
3 ayda bir peşin ödenir (geçici vergi); Nisan'da yıl kapanır (kurumlar vergisi), peşinler düşülür.
Rakamlar yalnız kafenin payı; şirketin vergisi muhasebecinin beyannamesindedir.

[⚠ Notice warn·sm risk=hukuk] Eksik belgeler var: rakam yüksek çıkabilir          [Belgesini seç]
     808.610 ₺ gider henüz hesaba girmedi (15 kalem) · 69.780 ₺ demirbaş olabilir (2 fatura)

Peşinat: 3. çeyrek 2026 (geçici vergi)                         [Eksik bilgi]    (id="gecici")
2026/3 · 25 Haziran–30 Eylül · son gün 17 Kasım Salı
Giderler sınıflandırılınca netleşir · şimdilik en çok ≈ 68.900 ₺
  (DetailList: plain etiketler) · notlar · altbilgi · [Muhasebecinin rakamı] [Vergi kârını aç] · Nasıl hesaplandı ⌄

Yıl sonu: 2026 (kurumlar vergisi)                              [Eksik bilgi]
Bugüne kadarki kârla
  (DetailList: plain etiketler) · notlar · altbilgi · [Muhasebecinin rakamı] · Nasıl hesaplandı ⌄
```

- `CardHeader`: ikon `Landmark`, başlık **"Şirketin kâr vergisi ({kv.year})"**, açıklama iki cümle (yukarıda;
  `scope === "kafe_elle"` ise ikinci cümle "Rakamlar kafenin ve elle girilen kafe dışı işlerin payı; …").
- Uyarı: `gecici.state === "taslak" && !gecici.calc.filing && gecici.subline` iken `Notice` (başlık sabit, `text`
  = `gecici.subline`, eylem `NoticeLink` "Belgesini seç" → `/panel/vergi/gelir-gider#siniflandir`). Bugünkü birincil
  "Giderleri sınıflandır" düğmesinin yerine (aynı hedef).
- Bölüm başlıkları `h3 text-sm font-semibold text-ink`, ikinci bölüm `border-t border-line pt-4`. Rozet: `card.badge`
  §7.5'teki eşlemeyle ("Ödemeler'de" burada rozet olarak kalır: kartta büyük rakamın kaynağıdır).
- Gövde: bugünkü `headline` / `subline` (subline uyarıya taşındıysa tekrar yazılmaz), `DetailList rows={card.rows}`
  `plainLabel()` ile, `NoteList notes={card.notes}`, `footer`, `FilingButton` (aynı), `Explain` (aynı içerik; yerel
  etiketleri glossary'ye göre: "Dönemin sonucu (amortisman öncesi)" → "Kâr (demirbaş payı düşülmeden)", "Amortisman" →
  "Demirbaş payı (amortisman)", "Dönem kazancı" → "Bu çeyreğin kârı (dönem kazancı)", "Kümülatif kurum kazancı" →
  "Yılbaşından beri kâr (kurum kazancı)", "Matrah" → "Vergi hesabındaki kâr (matrah)", "Kafenin katkısı" → "Kafenin
  payı"). "Vergiye göre'yi aç" → **"Vergi kârını aç"**.
- `plainLabel` eşlemesi (`card.rows` ve takvim dökümü): "Kümülatif kurum kazancı" → "Yılbaşından beri kâr (kurum
  kazancı)" · "Önceki dönemler" → "Önceki peşinatlar" · "Kafenin katkısı" → "Kafenin payı" · "Beyanname damgası" →
  "Beyanname ücreti (damga vergisi)" · "Matrah" → "Vergi hesabındaki kâr (matrah)" · "Hesaplanan" → "Hesaplanan vergi" ·
  "Mahsup edilecek geçici vergi (yalnız ödendi işaretli)" → "Düşülecek peşinat (mahsup; yalnız ödendi işaretli)" ·
  "İade / mahsup alacağı" → "Fazla ödenen (iade ya da mahsup)" · "Ödenecek (Ödemeler'deki tutar, damga dahil)" aynı ·
  "Oluşan zarar (sonraki 5 yılın kazancından düşülür)" aynı. Kapsam uyarısı (`SCOPE_WARNING`), "en çok", "Taslak"
  sebepleri ve "muhasebecinin rakamı girilmedi" notları **aynen** görünür.

### 7.7 Vergi kârı (`/panel/vergi/gelir-gider`)

- H1 **"Vergi kârı"**, `metadata.title` aynı; açıklama §8; eski uzun açıklama `more` (ⓘ "Nasıl çalışır?").
- H1 uyarısı (§6.1 H1): sayfanın başında; `ClassifyList` kartının başlığı **"Eksik belgeler"**, açıklaması kalkar
  (tekrar), `#siniflandir` aynı; seçim etiketi "Stopaj" → **"Vergi kesintisi (stopaj)"**.
- Çeyrek kartı: rozet "Taslak" → **"Eksik bilgi"**, "Hazır" aynı; "Taslak: {sebepler}." → **"Eksik bilgi:
  {sebepler}."** (gri, aynı yer).
- Tablo (`gelir-gider/grid.ts`, çizim katmanı): sütun "Kümülatif (yılbaşından)" → **"Yılbaşından beri"**; "Sonuç
  (amortisman öncesi)" → **"Kâr (demirbaş payı düşülmeden)"**; "Amortisman ({yöntem})" → **"Demirbaş payı,
  amortisman ({yöntem})"**; "Doğrudan gider yazılan demirbaş" → **"Bu yıl gider yazılan demirbaş"**; "Dönem kazancı" →
  **"Bu çeyreğin kârı (dönem kazancı)"**; "Kurum kazancı (kümülatif)" → **"Yılbaşından beri kâr (kurum kazancı)"**.
  `tests/vergi-kaynak.test.ts:105` sütun adı güncellenir.
- Köprü kartı (`bridge-card.tsx`): başlık "Gelir-gider'den vergiye" → **"Gelir-gider'den neden farklı?"**; açıklama
  → **"Gelir-gider ekranındaki gider, vergi hesabında nasıl değişiyor ({çeyrek}, KDV hariç)"**. Yeri aynı.
  `pnl.ts:703` köprü satırı "Vergiye göre gider" → **"Vergi hesabındaki gider"**.
- "Bu yıl hesap döneminde değil" boş durumu: "Kurallar › Vergi ayarları'ndan" → **"Muhasebeci › Şirketin vergi
  ayarları'ndan"**.

### 7.8 Demirbaş (`/panel/vergi/demirbas`)

- H1 **"Demirbaş"** (`metadata.title` aynı), açıklama §8.
- "Varlık" sözcüğü ekranda **"demirbaş"** olur (yalnız metin): Stat "Varlıklar (maliyet)" → "Demirbaşlar (maliyet)",
  alt "{n} varlık" → "{n} demirbaş"; kart "Varlıklar" → **"Demirbaş listesi"**, meta aynı biçim; düğme "Varlık ekle" →
  **"Demirbaş ekle"**, "Varlık olarak ekle" → **"Listeye ekle"**; tablo başlığı "Varlık" → "Demirbaş"; boş durum
  "Varlık listesi boş. …" → "Demirbaş listesi boş. Kuruluş & Demirbaş faturalarını aşağıdan ekleyin."; kart "Varlık
  listesine eklenmemiş demirbaş faturaları" → **"Listeye eklenmemiş demirbaş faturaları"**, açıklama "… varlık olarak
  eklenene kadar …" → "… listeye eklenene kadar …"; satır "eşlenmemiş: {tutar}" → **"listede değil: {tutar}"**; "Bütün
  demirbaş faturaları varlık listesinde." → "Bütün demirbaş faturaları listede."; ömür "Doğrudan gider" → **"Bu yıl gider
  yazıldı"**; `asset-dialog.tsx` başlık "Varlık" / "Varlık ekle" → "Demirbaş" / "Demirbaş ekle", toast'lar ve onay
  ("Varlık kaldırılsın mı?" → "Demirbaş listeden kaldırılsın mı?"); `asset-actions.tsx` düğme "Doğrudan gider" →
  **"Bu yıl gider yaz"**. `ASSET_METHOD_LABELS` (`lib/tax/assets.ts`) **değişmez** (Excel ve kayıt); ekranda
  `dogrudan_gider` için "Bu yıl gider yazıldı" çizilir.
- Uyarılar: §6.2 (`demirbas:109`, `:114`, `:184`).
- "(Kurallar › Vergi ayarları)" (`demirbas/page.tsx:268`) → "(Muhasebeci › Şirketin vergi ayarları)".
- Testler: `tests/vergi-demirbas.test.ts` ekran metni arıyorsa güncellenir (koşup bakın; veri testleri aynı).

### 7.9 Muhasebeci (`/panel/vergi/kurallar`)

Sıra (adres ve çapalar aynı):
1. **Muhasebeciye sorulacaklar** (`#sorular`, bugünkü kart, ilk sırada; açıklama aynı).
2. **Şirketin vergi ayarları** (bugünkü "Vergi ayarları" kartı; başlık değişir, form aynı; açıklama **"Şirket nasıl
   kuruldu, muhtasar dönemi, asgari ücret desteği; değişince bütün vergi sayfaları ve nakit planı yeniden
   hesaplanır."**).
3. **Kural tablosu ({yıl})** (`id="kurallar"`): `CardHeader` aynı; gövde `<details>` içinde kapalı, özet **"Kural
   tablosunu göster ({n} kural)"** (`min-h-11`, Ayrıntı özetinin sınıfları). Adres `#kurallar` ise açık başlar
   (`useEffect` + `hashchange`, Ayarlar `section-card.tsx` deseni; küçük istemci sarmalayıcı `rules-details.tsx`).
4. **Bu kafede hesaplanmayanlar** (`#bilgi`): **açık** kalır (takvimin altbilgisi buraya bağlanır; kapalı `<details>`
   içine çapa atlamasın).
5. Tam feragat `DisclaimerBody` (`id="feragat"`, her genişlikte).

Açıklama §8; bant §7.4. Metin: `corporate.ts:166` "(Kurallar › Vergi ayarları)" → **"(Muhasebeci › Şirketin vergi
ayarları)"** (`tests/vergi-kurumlar.test.ts:159`); `edit.ts:362` "(Kurallar › SGK işveren payı)" → "(Muhasebeci › SGK
işveren payı)" (§3.10'da); `settings-form.tsx:37` toast "Vergi ayarları kaydedildi" aynı.

### 7.10 Nakit planı, Ödemeler, Gelir-gider'deki vergi dokunuşları

- **Nakit planı KDV kartı** (`nakit/vat-card.tsx`): satır gecikmişse ve tutarı 0 ise (`r.overdue && r.amount === 0`)
  kırmızı "Gecikmiş" rozeti yerine **amber "Damga ödendi mi?"** (gecikmiş olan beyanname ücreti; "Ödeme beklenmez" ile
  çelişki kalkar). Tutarı olan gecikmiş satırda kırmızı "Gecikmiş" aynı. "Hatırlatıcı ekle" → "Ödemeler'e ekle"
  (§3.10). Kart başlığı ve döküm aynı. `PageHeader` `tabs` = `odeme` sekmeleri (§3.3).
- **Ödemeler** (`hatirlaticilar/payment-ui.tsx:491-509`, K18): ödeme düğmesi limon dolu onay + "Ödendi" → boş daire
  (`Circle`) + **"Ödedim"**, `variant="secondary"`; yeşil "Ödendi" yalnız durum rozeti. Geri alma (8 sn), "Son
  ödenenler", toast metinleri aynı. Aynı düğme Bugün'ün ve Genel bakış'ın "Yaklaşan ödemeler"inde de bu bileşenden
  çizilir (tek yer). Başlıktaki "Nakit planı" düğmesi kalkar (sekme var; K7).
- **Gelir-gider**: SGK kutusu U3, sayım notu U4 (§6.1); "Vergiye göre karşılığı" §3.10.

### 7.11 Sözlük (`src/lib/tax/glossary.ts`, yeni, K17)

Tek kaynak: `TERMS` (resmî terim → { ekranda, tanım }), `calendarTitle()`, `plainLabel()`, `badgeLabel()`. Yalnız
yöneticinin vergi ekranları ve Nakit planı KDV kartı kullanır; personel dosyaları içe aktarmaz (`tests/roller` sızıntı
bekçisi değişmez). Kural: ekranda ilk geçtiği yerde "sade söz (resmî terim)", sonra yalnız sade söz; tanım ⓘ'de.

| Resmî terim | Ekranda | ⓘ tanımı |
|---|---|---|
| Hesaplanan KDV | Satışlarda topladığınız KDV | Müşteriden alıp devlete ödediğiniz KDV |
| İndirilecek KDV | Alışlarda ödediğiniz KDV | Satışların KDV'sinden düşülür |
| Devreden KDV | Önceki aylardan kalan KDV (devreden) | Alışların KDV'si satışlarınkini aşınca sonraki aya geçer |
| Muhtasar | Maaş vergileri ve stopaj (muhtasar) | Maaştan ve bazı ödemelerden kesip devlete ödediğiniz vergiler |
| Stopaj | Vergi kesintisi (stopaj) | Kira, serbest meslek gibi ödemelerden sizin kesip yatırdığınız vergi |
| Tahakkuk fişi | Ödeme belgesi (tahakkuk fişi) | Muhasebecinin beyannameden sonra verdiği, ödenecek tutarı yazan belge |
| Beyanname damgası | Beyanname ücreti (damga vergisi) | Her beyannamede ödenen sabit tutar |
| Geçici vergi | Kâr vergisi peşinatı (geçici vergi) | 3 ayda bir ödenir, yıl sonunda kurumlar vergisinden düşülür |
| Kurumlar vergisi | Yıllık kâr vergisi (kurumlar vergisi) | Nisan'da ödenir; peşinatlar düşülür |
| Mahsup | Düşülür (mahsup) | – |
| Matrah | Vergi hesabındaki kâr (matrah) | Verginin hesaplandığı tutar |
| Kurum kazancı (kümülatif) | Yılbaşından beri kâr (kurum kazancı) | – |
| Amortisman | Demirbaş payı (amortisman) | Demirbaşın bedeli yıllara bölünerek gider yazılır |
| Faydalı ömür | Kaç yıl kullanılacak (faydalı ömür) | – |
| Özel maliyet | Kiralık yere yapılan tadilat (özel maliyet) | Kira süresine bölünerek gider yazılır |
| Tevkifat | Faturadaki KDV'nin sizin ödediğiniz kısmı (tevkifat) | – |
| Sınıflandırılmamış gider | Belgesi seçilmemiş gider | – |
| Yönetim verisi (ModPOS) | Kasa programının rakamı ({kasa}) | Resmî belge değil (U17) |
| Taslak | Eksik bilgi | Sebebi yanında yazar |

Takvim satırlarının, kartın ve Vergi kârı tablosunun yukarıdaki metinleri bu tablodan okunur. Kanun kısaltmaları (VUK,
KVK, GVK …) yalnız "Kullanılan kurallar ve kaynaklar" açılırında kalır.

---

## 8. Sayfa başlıkları (H1, açıklama, `more`, `meta`)

Kural: açıklama tek cümle, "ne yaparsınız", ≤ 100 harf (test §3.11); eski uzun açıklama silinmez, `more` ile ⓘ "Nasıl
çalışır?" içine iner (yalnız yönetici ekranında). Bağlam satırı `groupLabelOf(path, role)` (telefonda yok). `meta` =
§10'daki satış kaynağı satırı. "aynı" = metin değişmez.

| Adres | H1 | Açıklama (yeni) | `more` | `meta` |
|---|---|---|---|---|
| `/panel` | Genel bakış | aynı (dinamik) | – | satış kaynağı (§10) |
| `/panel/bugun` | Bugün | aynı (dinamik) | – | – |
| `/panel/onaylar` | Onaylar | aynı (`tests/onay-kuyrugu.test.ts`) | – | – |
| `/panel/kasa` (yönetici) | Kasa raporu | **Personelin akşam raporları: eksik, fazla ve gelmeyen günler.** | eski | – |
| `/panel/kasa` (personel) | Kasa raporu | **Kapanışta Z raporunu alın, kasadaki nakdi sayın ve buraya girin.** | – | – |
| `/panel/kasa/fiyatlar` | Kasadaki fiyatlar | aynı | – | – |
| `/panel/karaoke` | Karaoke | **Barın ekranı: uygulama siparişleri, karaoke rezervasyonları ve oda sayacı.** | yön.: eski | – |
| `/panel/karaoke/doluluk` | Karaoke doluluğu | **Oda hangi gün ve saatte dolu, hangisinde boş; saat başına gelir.** | eski | – |
| `/panel/kontrol` | Kontrol listeleri | **Açılış ve kapanışta maddeleri işaretleyin; her dokunuş hemen kaydedilir.** | – | – |
| `/panel/kontrol/gecmis`, `/duzenle`, `[id]` | aynı | aynı | – | – |
| `/panel/tahmin` | Satış tahmini | **Önümüzdeki 7 günün beklenen satışı, kaç kişi çalışmalı, kaç tatlı hazırlanmalı.** | eski | – |
| `/panel/ozel-gunler` | Özel günler | aynı | – | – |
| `/panel/hatirlaticilarim` | Hatırlatıcılarım | **Kendinize notlar: sipariş, temizlik, aranacaklar. Yalnız siz görürsünüz.** | – | – |
| `/panel/urunler` | Ürünler & kârlılık | **Her ürünün fiyatı, maliyeti ve kârı; ürüne dokunun, reçete kartı açılır.** | eski | satış kaynağı |
| `/panel/urunler/[id]` | (ürün adı) | aynı | – | – |
| `/panel/urunler/fiyatlar` | Fiyatlar | **Menü fiyatlarını toplu değiştirin; kasada değiştirdiklerinizi işaretleyin.** | eski | – |
| `/panel/urunler/site` | Site menüsü | **Panel ürünlerini laffogato.net menüsüne bağlayın; fiyat iki yerde aynı kalır.** | eski | – |
| `/panel/hammaddeler` | Hammaddeler | **Malzemelerin paket fiyatları (KDV hariç); değişince maliyetler güncellenir.** | eski | – |
| `/panel/receteler` (yönetici) | Reçete defteri | **Baristaların reçeteleri; personelin önerileri Onaylar'a gelir.** | – | – |
| `/panel/receteler` (personel) | Reçete defteri | **Her ürünün her boyunda ne kadar malzeme; değişiklik önerin, yönetici onaylar.** | – | – |
| `/panel/sayim` | Stok sayımı | aynı (dinamik `COUNT_RULE`) | – | – |
| `/panel/zayi` | Zayi & ikram | **Atılan, bozulan (zayi) ve ödenmeden verilen (ikram) ürünleri girin.** ("Tutarlılık ekranı" sözü kalkar: personel açamaz) | – | – |
| `/panel/tutarlilik` | **Tutarlılık** (eski "Tutarlılık kontrolü") | **Satış, alış ve reçete tutuyor mu: hangi malzeme fazla gidiyor.** | eski | satış kaynağı |
| `/panel/satislar` | Satışlar | kaynağa göre (§10): ModPOS raporu **Ay sonunda ModPOS ürün satış raporunu yükleyin, eşleşmeyen ürünleri bağlayın.** · LafPOS **LafPOS'un gün sonları her gece gelir; eşleşmeyen ürünleri bağlayın.** · geçiş **Geçiş ayı: önce ModPOS raporu, sonra LafPOS gün sonları; eşleşmeyenleri bağlayın.** | eski üç `DESCRIPTION*` ("Patron (ModPOS)" → "ModPOS") | satış kaynağı |
| `/panel/komisyonlar` | Komisyon & hakediş | **Yemek kartı ve platformların kestiği komisyon ve size ödeyecekleri para (hakediş).** | eski | – |
| `/panel/analiz` | Analiz & senaryo | **Hangi ürünü öne çıkarmalı, hangisine zam yapmalı; fiyat değişirse ay sonu ne olur.** | eski | satış kaynağı |
| `/panel/faturalar` | Faturalar | **Alış faturaları Paraşüt'ten her sabah gelir; elle de ekleyebilirsiniz.** | eski | – |
| `/panel/tedarikciler` (+ `[cari]`) | Tedarikçiler | **Tedarikçilerin bilgileri ve borçları: ödendi, ödenmedi, ödeme talebi.** | eski | – |
| `/panel/giderler` | Sabit giderler | **Her ay aynı olan giderler: kira, aidat, internet (KDV hariç).** | eski | – |
| `/panel/harcamalar` | Aylık harcamalar | **Her ay değişen ve faturasız giderler: reklam, influencer, nakit alım, bakım.** | eski | – |
| `/panel/personel` | **Maaşlar** | **Çalışanların net maaşı, brüt maaşı ve size maliyeti; SGK oranları en altta.** | eski | – |
| `/panel/gelir-gider` | Gelir-gider | **Ay ay gelir, gider ve kâr / zarar (KDV hariç); su faturası gibi tutarları yazın.** | eski | satış kaynağı |
| `/panel/hatirlaticilar` | **Ödemeler** | **Kira, vergi, SGK, maaş ve fatura ödemeleri; zamanı gelenler sabah e-postayla gelir.** | – | – |
| `/panel/hatirlaticilar/nakit` | Nakit planı | aynı | – | – |
| `/panel/vergi` | **Vergi, KDV, SGK** | **Devlete ödenecekler: KDV, SGK, maaş vergileri ve kâr vergisi; tahmini tutar ve son gün.** | – | – |
| `/panel/vergi/gelir-gider` | **Vergi kârı** | **Vergi hesabına göre bu çeyreğin kârı: belgeli gelir ve gider, KDV hariç.** | eski | – |
| `/panel/vergi/demirbas` | **Demirbaş** | **Makine, mobilya gibi yıllarca kullanılan alımlar; gideri yıllara bölünür (amortisman).** | eski | – |
| `/panel/vergi/kurallar` | **Muhasebeci** | **Muhasebecinize sorulacaklar, şirketin vergi ayarları ve hesabın kullandığı kurallar.** | eski | – |
| `/panel/ayarlar` | Ayarlar | **Oranlar, ölçüler ve bağlantılar; değiştirince etkisi hemen altta görünür.** | eski | – |
| `/panel/kullanicilar` | Kullanıcılar & roller | **Panele kim girer, neyi görür: kullanıcı ekleyin ya da davet gönderin.** | eski | – |
| `/panel/parasut` | Paraşüt entegrasyonu | **Paraşüt'teki faturalar her sabah gelir; fatura kalemlerini hammaddeye bağlayın.** | eski | – |
| `/panel/yardim` | Yardım | **Ne zaman ne yapılır, sık sorular ve Excel'deki sayfaların karşılıkları.** | – | – |
| `/panel/yardim/personel`, `/panel/hesap` | aynı | aynı | – | – |

Uzunluk denetimi: tablodaki her yeni açıklama ≤ 100 harf (Satışlar'ın üçü dahil); `tests/sayfa-basligi.test.ts`.

---

## 9. Kaldırılan / sadeleşen (defter)

Kural: veri, adres ve sahibin kullandığı yetenek silinmez; kalkan blok ya gerçekten tekrardır ya da bir dokunuş
uzaktadır. Her madde: ne · neden · nerede kalır.

| # | Kalkan / sadeleşen | Neden | Nerede kalır (en çok bir dokunuş) |
|---|---|---|---|
| 1 | Vergi Özet "Hazırlık 0 / 4" karosu | Para sorusuna ayrılmış yerde ilerleme sayısı; Başlarken'in tekrarı | Başlarken satırı "{done} / {total}" (§7.3); `view.stats.readiness` hesaplanmaya devam eder |
| 2 | Başlarken'in açık 4 satırlık kartı | Telefonda ilk ekranın 389 px'i | Aynı kart, tek satır `<details>`; adımlar ve bağlantıları aynı |
| 3 | Vergi bandının iki cümle + derleme günü (her sekmede 102 px) | Aynı feragat dört sekmede | Bandın ⓘ'si (tam metin), Muhasebeci'nin sonu |
| 4 | Özet'in sonundaki ve Muhasebeci'nin başındaki tam feragat kopyaları | İki kez aynı paragraf | Muhasebeci'nin sonunda bir kez (`#feragat`) + bant ⓘ |
| 5 | Bandın telefondaki Muhasebeci çipi | Yatay kaydırmada ekran dışına kayıyordu; sekme aynı yere gidiyor | Sekme "Muhasebeci", ⌘K "Muhasebeciye sorulacaklar" |
| 6 | İki ayrı kâr vergisi kartı | Aynı vergi iki kartta, "matrah", "katkı" | Tek "Şirketin kâr vergisi" kartı, iki bölüm, bütün satırlar ve "Nasıl hesaplandı" (§7.6) |
| 7 | Takvimin "Sonra" kutusu | Kurumlar vergisi için "Tutarı bilinmiyor" derken kart ≈ tutar veriyordu | Takvimin altında tek satır + "tahmin kartta" bağlantısı |
| 8 | KDV satırında aynı yere giden iki düğme | "Nakit planında aç" ve "Devreden KDV'yi gir" ikisi de `nakit#kdv` | Tek düğme "Döküm ve devreden KDV" |
| 9 | KDV satır notu "Ödeme beklenmez (devreden); yalnız damga." (açık gövdede) | Kapalı satır artık aynı cevabı yazıyor | Kapalı satırın alt satırı "Ödeme yok · ≈ … sonraki aya geçer"; veri ve test aynı |
| 10 | Muhtasar satır notu "Tahmin; kesin tutar tahakkuk fişindedir." | ≈ işareti ve bant söylüyor | Bant ⓘ |
| 11 | Takvim rozetleri "Ödemeler'de", "2026 kuralları" | Beş tür rozet; ikisi kaynak bilgisi | Satırın alt satırında söz olarak |
| 12 | Vergi kârı "Vergi hesabına girmeyen giderler" kartının açıklaması | Sayfa başındaki uyarıyla aynı rakam | Sayfa başı `Notice` (H1); kart başlığı "Eksik belgeler" |
| 13 | Muhasebeci'nin açık kural tablosu (telefonda ~15.000 px) | Kanun tablosu her ziyarette gerekmiyor | Aynı kart, kapalı `<details>`; `#kurallar` adresi açık getirir |
| 14 | Başlıklardaki "Excel: …" | Bağlam satırını uzatıyor, günlük işte gereksiz | Yardım › Ekranlar tablosu (`excelFor`), ⌘K alt satırı |
| 15 | Elle yazılan bağlam adları ("Günlük", "Sistem", "Genel", "Finans", "Personel") ve `EYEBROW_ALIAS` | Menüde olmayan adlar | Ağaçtan türeyen bağlam satırı (masaüstü) |
| 16 | Bağlam satırı telefonda | Üst çubuk aynı adı yazıyor | Telefon üst çubuğu, çekmece |
| 17 | Uzun sayfa açıklamaları (≤ 3 satır) | İlk ekranı itiyor | ⓘ "Nasıl çalışır?" (`more`; metin aynı) |
| 18 | Genel bakış ay listesindeki "Ödemeler · bugün" işi | Aynı ödemeler Bugün'de, alt menü rozetinde ve "Yaklaşan ödemeler"de | Gecikme varsa sayfa başında tek `bad` satırı (K22); Ödemeler, Bugün |
| 19 | Ödemeler başlığındaki "Nakit planı" düğmesi | Sekme aynı işi görüyor | `odeme` sekmesi "Nakit planı" (K7) |
| 20 | Karaoke'deki gri "bağlantı yok" satırı (`orders-board.tsx:212`) | Mavi kutuyla aynı gerçek | Tek `Notice` (U6 / U7) |
| 21 | Ekran gövdesindeki kurulum talimatları (anahtar adları, Vercel, `openssl`) | Sahibin işi değil; personel de görüyordu | `tech` ("Teknik ayrıntı (geliştirici için)", yalnız yönetici); Ayarlar › laffogato.net |
| 22 | Personelin yüzen ses hapı | 14 ekranda içerik örtüyordu | Sayfa içi ses yuvası (§4.6) |
| 23 | Personelin Reçete defterinde fiyat kaynağı notu (×19) | Yönetici notu (fiyat, ModPOS); personelin işi değil | Yönetici görünümü aynen; personelde yalnız notu `/fiyat|maliyet|modpos|patron|₺|\btl\b/i` içeren ürünlerde çizilmez (başka not, ör. hazırlama sözü, kalır) |
| 24 | Bugün "Sonra" grubunun açık listesi ve iş kartlarının açıklamaları (telefonda) | İlk ekranın %77'si iş listesi | "Sonra ({n})" kapalı, "Diğer {n} iş" arkasında (§4.8); masaüstü aynı |
| 25 | Cihaz ipuçları ×4 (ses, bildirim) | Dört ayrı gri kutu | Tek `<details>` "Ses ve bildirim ipuçları (4)", metinler aynı (H5) |
| 26 | Onaylar'daki boş reçete önerisi kutusu (260 px) | Boş durum için büyük kutu | Tek satır "Onay bekleyen reçete önerisi yok" (`text-[13px] text-ink-mute`) |

Ayrıca **sadeleşen ama kalkmayan** (defterin dışında, yalnız biçim): Satış tahmini 41 sözcüklük şerit (U9, başlık +
Ayrıntı), Nakit planı şeritleri (U2), Gelir-gider SGK kutusu (U3), "Ödendi" → "Ödedim" (K18), Kontrol listeleri boş
durumu (yönetici ve personel **"Bugün açık liste yok · Açılış listesi yarın {saat}'de başlar"**; saat şablondan,
`kontrol/page.tsx:68-81`), Sayım (personel) "Hammaddelerde olmayan …" → **"Listede olmayan bir şey varsa buraya
ekleyin; fiyatını yönetici girer."**, Genel bakış KPI "Başabaş günlük ciro" → **"Zarar etmemek için günlük satış
(başabaş)"** (yalnız etiket).

Bilerek **kalan**: "Döküm ›" bağlantıları (24 yer), "Komisyon & hakediş" adı (K9), "Patron" sözcüğü gövde metinlerinde
(ModPOS'un rapor programının adı; yalnız açıklamalardan kalkar), "hammadde / malzeme" ikiliği (sahibe, §16), Vergi
kârı köprü kartının yeri.

---

## 10. ModPOS API için yer (satış kaynağı)

Sahip: "sonrasında modpos api gelecek, orda cafe açılışından beri satılan ürünler, para vs. yazacak". Bu PR ModPOS
bağlantısını **kurmaz** (API yok, şema ve göç yok); ekranların hiçbirinin "satış = ay sonunda elle yüklenen ModPOS
raporu" varsaymamasını ve bağlantı geldiğinde tek yerden açılmasını sağlar.

**Tek kaynak (yeni, saf): `src/lib/sales-source.ts`**

```ts
export type SalesSourceKind = "modpos-rapor" | "lafpos" | "gecis" | "modpos-baglanti";
export interface SalesSource {
  kind: SalesSourceKind;
  /** Kısa ad: "ModPOS raporu" · "LafPOS" · "ModPOS raporu + LafPOS" · "ModPOS bağlantısı" */
  label: string;
  /** Başlığın altındaki tek satır (meta): "Satışlar: ModPOS raporu (elle, ay sonunda)" … */
  line: string;
  /** Satış verisi yokken ne yapılır: "Satışlar'a ürün satış raporunu yükleyin" · "LafPOS gün sonları her gece gelir" · "ModPOS bağlantısı bu ayı henüz getirmedi" */
  missing: string;
  /** Elle yükleme bu ayın kaynağı mı (ImportCard ve "Satış raporu" işi bunu okur) */
  manual: boolean;
}
/** Ayın satış kaynağı; bugün `salesMonthKasa` üstüne kurulur. `connectedMonths` ileride ModPOS bağlantısının getirdiği aylar (bugün hiçbir çağıran vermez) */
export function salesSourceOf(month: string, switchDay: string | null, lafposSales: { months: readonly LafposSalesMonth[] } | undefined, connectedMonths?: ReadonlySet<string>): SalesSource;
```

| `kind` | Ne zaman | `line` |
|---|---|---|
| `modpos-rapor` | geçiş günü yok ya da ay geçişten önce (bugünkü `MODPOS_MONTH`) | **"Satışlar: ModPOS raporu (ay sonunda elle yüklenir)"** |
| `lafpos` | ay tamamen LafPOS | **"Satışlar: LafPOS (her gece kendiliğinden)"** |
| `gecis` | geçiş ayı | **"Satışlar: {monthKasa.long}"** (ör. "Kasa (ModPOS 1–9 Kasım · LafPOS 10–30 Kasım)") |
| `modpos-baglanti` | `connectedMonths.has(month)` (ileride) | **"Satışlar: ModPOS bağlantısı (kendiliğinden)"** |

Öncelik: `modpos-baglanti` > `lafpos` / `gecis` > `modpos-rapor` (bağlantı geldiğinde açılıştan bu yana bütün aylar
ondan okunur; aynı ay için elle yüklenmiş rapor varsa hangisinin sayılacağı **bağlantı PR'ının kararı**dır, bu PR
yalnız etiketi ayırır).

**Bugün bağlanan yerler (bu PR):**
1. `SalesSourceLine` (`src/components/panel/sales-source-line.tsx`, sunucu bileşeni): `PageHeader meta`'sına tek satır
   `line`. Kullanılır: Genel bakış, Satışlar, Gelir-gider, Ürünler & kârlılık, Tutarlılık, Analiz & senaryo (§8
   tablosunda "satış kaynağı"). Yalnız yönetici ekranları; personel dosyaları içe aktarmaz.
2. Satışlar açıklaması `kind`'a göre (§8; bugünkü üç `DESCRIPTION*` `more`'a iner).
3. "Satış verisi yok, yükleyin" diyen ekran metinleri `missing`'i kullanır: `analiz/page.tsx:57`,
   `urunler/fiyatlar/bulk-editor.tsx:478`, `urunler/price-impact-panel.tsx:166`, `tahmin/forecast-desserts.tsx:31`,
   `tutarlilik/page.tsx:356`, `tutarlilik/consistency-client.tsx:931` (düğme etiketi `manual` ise "Satış raporu yükle",
   değilse "Satışlar'a git"). Ay belli değilse (`tahmin`, fiyat paneli) bugünün ayı.
4. Genel bakış "Satış raporu" işi (`dashboard-tasks.tsx:268-340`): `manual === false` olan ayda iş "yükle" demez
   (bugün LafPOS ayında zaten böyle; kural `salesSourceOf`'a bağlanır, `monthTasks`'ın sonucu bugünkü verilerde aynı,
   `tests/dashboard-tasks.test.ts` aynı).
5. Yardım "Satış raporunu yükleyin (ModPOS raporuyla çalışan aylarda)" (§3.9).

**Bilerek bağlanmayan** (bugün doğru, bağlantı PR'ının işi): `src/lib/calc/insights.ts:1087` (hesap katmanı, K11),
`src/lib/weekly/items.ts:50` (haftalık e-posta), `src/lib/lafpos/sales.ts` (ModPOS listesi ile LafPOS çakışma
cümleleri: zaten "ModPOS listesi" der), `dashboard-tasks.tsx:336-337` "Patron'dan … yükleyin" (ModPOS'un rapor
programının adı; yalnız `manual` aylarda görünür).

**Bağlantı geldiğinde açılacak yerler (bu PR'da yer ayrılır, kod yazılmaz):**
- Ayarlar › Bağlantılar: LafPOS kartının (`#lafpos`) yanında "ModPOS bağlantısı" kartı, çapa **`#modpos`** (bu PR'da
  çapa ve kart yok; ad ve yer burada sabitlenir). ⌘K kaydı ("ModPOS bağlantısı" → `/panel/ayarlar#modpos`) kart gelince
  eklenir.
- `salesSourceOf(…, connectedMonths)`: bağlantının yazdığı ayların kümesi; ekranların hepsi kendiliğinden "ModPOS
  bağlantısı" der, "yükleyin" metinleri `missing`'e döner.
- Satışlar `ImportCard`: `manual === false` ayda kart "Bu ayın satışı ModPOS bağlantısından geldi" der, elle yükleme
  "Raporu yine de yükle" ikincil düğmesine iner (bağlantı PR'ı).
- Kasa raporu ModPOS Z karşılaştırması ve Genel bakış "Kasa · {kaynak}" etiketleri `monthKasa` üstünden zaten aydan
  türer; bağlantı `monthSource`'a dördüncü değer eklerse etiketler tek yerden değişir (`docs/LAFPOS.md` › Metinler).
- Kenar çubuğu, ⌘K grupları ve adresler **değişmez**: Satışlar "Satış" grubunda kalır; geçmiş aylar (açılıştan beri)
  aynı ay seçiciyle açılır.

`tests/satis-kaynagi.test.ts` (yeni): dört `kind`'ın `line` / `missing` / `manual` değerleri; geçiş günü yokken her ay
`modpos-rapor`; `connectedMonths` verilince o ay `modpos-baglanti`; personel dosyalarında `sales-source` içe aktarımı yok.

---
## 11. Uygulama: tek PR, üç bölüm (üç commit), sonra `main`

Dal `claude/ux-sade` (`origin/main`'den). PR başlığı **"Panel sadeleştirme: anlaşılır menü, kompakt uyarılar, sade
Vergi"**, gövdede bu belgenin §0'ı, §9 defteri ve §13 ölçü tablosu (önce → sonra). Her bölüm kendi commit'i ve kendi
sonunda yeşil: `npx tsc --noEmit`, `npm run lint`, `npm test`. Son bölümden sonra `npm run build`, §14, PR, CI yeşil,
inceleme bulguları, **`main`'e birleştirme** (sahibin isteği), canlıda §14'ün kısa turu. Başka bir iş akışının
`/home/user/wt/vergi` ve `/home/user/lafmaliyet` kopyalarına dokunulmaz: yeni worktree açılır.

### Bölüm 1 (commit 1): gezinme ve adlar (§3)
- `src/components/panel/nav.ts` (§3.1-§3.5; içe aktarma: `Scale`, `FileWarning`, `History`, `HardDriveDownload`),
  `sidebar-nav.tsx` (`activeChildOf`), `command-palette.tsx` (`raw`, `score` dışa aktarılır), `page-header.tsx`
  (§3.8 API; `more`, `meta`, `path`, `role`; `eyebrow`, `excel`, `EYEBROW_ALIAS` kalkar).
- Bütün `PageHeader` çağrıları (48 dosya, §8'deki adresler; `VergiHeader` `path={current}`): yalnız `eyebrow` /
  `excel` → `path` / `role`. Açıklama metinleri **Bölüm 3'te**.
- `metadata.title` ve H1'ler (§3.6), `SECTION_TABS` çağrıları (`odeme`: `reminders-client.tsx`, `cash-plan-client.tsx`,
  `nakit/page.tsx`); Ödemeler başlığındaki "Nakit planı" düğmesi kalkar (K7).
- Çapalar (§3.7): `tax-calendar.tsx` (`#kdv`, `#sgk`, `#muhtasar`), `vergi/page.tsx` sağ sütunu `<div id="kar-vergisi">`
  (Bölüm 3'te karta taşınır), `personel/staff-editor.tsx` (`#sgk-oranlari` + açık başlama), `gelir-gider/page.tsx`
  (`#kar-zarar`), `karaoke/karaoke-admin.tsx` (`#baglanti`). (`#urun-baglantilari` zaten var.)
- `yardim/nav-paths.ts`, `yardim/page.tsx` (§3.9); metinlerdeki eski adlar (§3.10).
- Testler §3.11.

### Bölüm 2 (commit 2): kompakt uyarı sistemi ve göç (§4-§6)
- Yeni: `src/components/ui/notice.tsx` (`Notice`, `NoticeGroup`, `NoticeLink`, `foldPlan`, `TONE_ICON`, `TONE_LABEL`,
  `TONE_TILE`), `src/app/panel/alert-tone.ts`, `src/app/panel/kasa/check-notices.tsx`; `src/app/globals.css` üç jeton.
- Ortak düzey (§4.7): `components/panel/notifications.tsx`, `app/panel/dashboard-alerts.tsx`, `task-style.tsx`.
- İş listeleri (§4.8): `dashboard-checklist.tsx`, `dashboard-checklist-tasks.tsx`, `dashboard-tasks.tsx`
  (`overdueNotice`), `app/panel/page.tsx`, `bugun/today-tasks.tsx`.
- Telefon (§4.6): `app/panel/layout.tsx` (`ses-yuvasi`), `components/panel/live/alert-center.tsx` (portal),
  `ayarlar/section-card.tsx` + `ayarlar/page.tsx` (`summaryTone`).
- Göç: Ek A'nın her N ve E satırı (§5 kuralı), §6.1 (U, H, Y, Sistem; `tahmin/page.tsx` + `lib/forecast/text.ts`
  `qualityTitle`, `gelir-gider/sgk-rate-notice.tsx` + `lib/tax/edit.ts` `current`), §6.2 yardımcılar, §6.3 kutusuz ⚠
  satırları, §6.5 gri kutular, `tech`'e taşınanlar (§6.4). Ek A'da "bkz. §7.x" yazanlar (vergi bandı) Bölüm 3'te.
- `docs/TASARIM.md`: §1'e üç jeton, §4'e `Notice` satırı ve ton kuralı (§4.3), §6'ya "Uyarı bütçesi" (§4.6).
- Testler §12.

### Bölüm 3 (commit 3): Vergi, kaldırılanlar, başlıklar, satış kaynağı, belgeler (§7-§10)
- Vergi: `vergi/page.tsx`, `vergi/ui.tsx` (`TaxBanner`, `DisclaimerBody`, `VergiHeader`, `OZET_DESCRIPTION`),
  `tax-calendar.tsx`, `tax-cards.tsx` (`ProfitTaxCard`, `GettingStartedCard`), `vergi/gelir-gider/{page,grid,
  bridge-card,classify-list}.tsx`, `vergi/demirbas/page.tsx`, `vergi/asset-{dialog,actions}.tsx`,
  `vergi/kurallar/page.tsx` + yeni `kurallar/rules-details.tsx`, `hatirlaticilar/nakit/vat-card.tsx`,
  `hatirlaticilar/payment-ui.tsx` (K18); yeni `src/lib/tax/glossary.ts`, `src/lib/tax/overdue.ts`; `src/lib/tax/view.ts`
  (yalnız: `carryOut`, `reminderDue`, `unknownWithholding` alanları, `ReminderHit.date`, `NOTE_VAT_NONE` sabiti,
  `:513` notunun silinmesi, `:973` metni), `src/lib/tax/pnl.ts:703`, `src/lib/tax/corporate.ts:166`.
- Başlık metinleri (§8): aynı 48 dosyada `description` / `more` / `meta`.
- Defter (§9): `receteler/recipe-book.tsx` (personel not süzgeci), `onaylar/` boş reçete satırı, `kontrol/page.tsx`
  boş durumu, `sayim` personel metni, Genel bakış KPI etiketi, `bugun/today-tasks.tsx` "Sonra", `device-alerts.tsx` +
  `output-picker.tsx` (H5).
- Satış kaynağı (§10): yeni `src/lib/sales-source.ts`, `src/components/panel/sales-source-line.tsx`; altı ekran metni
  (§10 madde 3), `dashboard-tasks.tsx` "Satış raporu" işi.
- Belgeler: bu dosya `docs/planlar/ux-sade.md` olarak (ekleriyle); `docs/TASARIM.md` §3 (menü ağacı, alt menü "Tümü",
  bir ekran bir ad, bağlam satırı); `docs/VERGI.md` (sekme adları, Özet'in yeni düzeni, bant, sözlük, gecikmiş satır;
  §1 kuralı aynen); `docs/BUGUN.md` (telefon deseni, "Diğer N iş"); `docs/NAKIT-PLANI.md` (sekmeler, "Ödemeler'e ekle",
  "Damga ödendi mi?"); `docs/LAFPOS.md` › Metinler (`salesSourceOf`); `docs/planlar/KALAN-ISLER.md` (ModPOS bağlantısı:
  §10'un "açılacak yerler" listesi). Belgeyi okuyan testler (`tests/ayni-rakam.test.ts:375` NAKIT-PLANI,
  `tests/lafpos.test.ts:522` LAFPOS, `tests/predeploy.test.ts:144` ve `tests/veritabani-baglanti.test.ts:672-678`
  KALAN-ISLER) yeşil kalmalı: belgeye **ekle**, aradıkları cümleleri silme.
- Testler §12.

---

## 12. Testler (Bölüm 2 ve 3; Bölüm 1'inkiler §3.11)

**Güncellenecekler** (bilerek):

| Test | Satır (main) | Değişiklik |
|---|---|---|
| `tests/arayuz-duzeltmeleri.test.ts` | 70 | `confirm-password-dialog.tsx`'in notu `Notice`'e geçti (Ek A 272): `/\{notice \? \(\s+<Notice[^>]*live="polite"[^>]*title=\{notice\}/` |
| `tests/vergi-takvim.test.ts` | 267 | "4 fatura demirbaş listesinde değil" |
| | 232 | aynı metin, ama `NOTE_VAT_NONE` sabitiyle karşılaştırılabilir (isteğe bağlı) |
| `tests/vergi-kurumlar.test.ts` | 159 | "(Muhasebeci › Şirketin vergi ayarları)" |
| `tests/vergi-kaynak.test.ts` | 105 | sütun "Yılbaşından beri" |
| | 41-58 | **aynen geçmeli** (`<TaxBanner data={banner} />`, `{TAX_DISCLAIMER}`, `{TAX_DISCLAIMER_SHORT}`, `role="note"`) |
| `tests/vergi-demirbas.test.ts` | ekran metni arıyorsa | "Varlık" → "Demirbaş" sözleri (§7.8) |
| `tests/kdv-tahmini.test.ts` | – | **aynen** (`vatSubText`, `VAT_DISCLAIMER` değişmez) |
| `tests/mobil-genel.test.ts`, `tests/dashboard-tasks.test.ts` | – | **aynen** (`phoneChecklist`, `monthTasks`, `taskSummary` değişmez); "Bu ayın işleri"ni arayan doğrulama yok (29 Eki'de denetlendi, yalnız yorumlar) |
| `tests/satis-tahmini.test.ts` | – | `qualityBanner` aynen; `qualityTitle` için yeni beklentiler |
| `tests/siparis-planli.test.ts` | 98 | **aynen** (`orders-board.tsx`'in satır içi `text-warn`'ı kutu değil, Ek A'da D) |

**Yeni:**

- `tests/uyari.test.ts`:
  - `foldPlan`: `bad` hiç katlanmaz; `risk` taşıyan `warn` hiç katlanmaz; ötekilerden ilk `max` (2) görünür, kalan
    katlanır; sıra `bad > warn > neutral > good`, aynı tonda yazıldığı sıra; boş liste.
  - `TONE_ICON` tek kaynak: `notifications.tsx`, `dashboard-alerts.tsx`, `task-style.tsx` onu
    `@/components/ui/notice`'ten içe aktarır, kendi uyarı ikonu eşlemesi yok.
  - `notice.tsx` kaynağı: `sr-only` önekleri (`TONE_LABEL`), rol kuralı (`live` yoksa `note`, `polite` → `status`,
    `assertive` → `alert`), `text-bad-ink` ve `text-warn-ink` kullanılır, `text-bad` / `text-warn` metin rengi yok.
  - `alertTone`: üç düzeltme (§4.7) ve üç doğrudan eşleme.
  - `overdueNotice`: gecikmiş iki ödeme → "2 ödeme gecikti · {toplam}"; `later` → nötr satır; `todo` → satır yok.
- `tests/uyari-goc.test.ts` (bekçi, §6.4): kutu sınıfı izin listesi; uyarı ikonu izin listesi; `text-bad` +
  `bg-bad-soft` yok; geliştirici sözcüğü bekçisi; `<Notice` düz metin başlık ≤ 10, `text` ≤ 18 sözcük; personel
  dosyalarında `tech=` yalnız yönetici dalında; **her uyarı yeni bileşende**: Ek A'nın N ve E satırlarının dosyaları
  (test içinde sabit liste, `NOTICE_FILES`) `@/components/ui/notice`'ten içe aktarır ve `role="alert|status|note"`'u
  elle yazmaz (izin: `ui/notice.tsx`, `vergi/ui.tsx` `TaxBanner`, Ek A'nın D satırları).
- `tests/vergi-sade.test.ts`:
  - `calendarTitle` (8 tür, §7.5 tablosu), `plainLabel` (§7.6 eşlemesi; bilinmeyen etiket aynen), `badgeLabel`
    (5 değer).
  - `overdueTaxReminders`: `active` ve günü geçmiş vergi / SGK hatırlatıcıları, ödenmiş ya da pasif olan yok, sıralı.
  - Excel verisinde 24.10.2026: `kdv1:2026-09` satırında `carryOut` (testi koşup değeri yazın) ve `note === null`;
    `sgk:2026-09`'da hatırlatıcı 26'sındaysa `reminderDue === "2026-10-26"`; `mphb:2026-09` `unknownWithholding === 4`.
  - Kaynak bekçisi: `vergi/page.tsx`'te `readiness` ve `DisclaimerBody` yok; `kurallar/page.tsx`'te `DisclaimerBody`
    sayfanın sonunda ve `sm:hidden` yok; `ui.tsx`'te `TaxBanner` `bg-panel` taşımaz; `tax-cards.tsx`'te
    `GeciciCardView` / `KvCardView` yok, `ProfitTaxCard` var; `tax-calendar.tsx`'te "Devreden KDV&apos;yi gir" düğmesi
    yok.
- `tests/satis-kaynagi.test.ts` (§10).
- `tests/sayfa-basligi.test.ts` (§3.11): Bölüm 3'te §8'deki açıklamalar eklendikten sonra uzunluk denetimi de koşar.
- **Personelin ağacı testi** (`tests/kenar-cubugu.test.ts` 148-164 anahat), `tests/yardim-personel.test.ts`,
  `tests/personel-yetkileri.test.ts`, `tests/mobile-nav.test.ts` 23-45 ve 74-87 her bölümün sonunda **dokunulmadan**
  yeşil.

---

## 13. Kabul ölçütleri (ölçülebilir)

Ölçü: ilk ekran = 390×844 ve 1440×900'ün ilk görünümünde katlanabilir uyarı + iş listesi + ipucu kutularının toplam
yüksekliği (px); "önce" `ux/analiz/measure.json` (`fold`), "sonra" aynı araçla (§14). `ux/tools/collect.cjs`'in
seçicilerine `[data-notice]` eklenir; `[data-notice="bad"]` ve `[data-risk]` taşıyanlar bütçeye sayılmaz, ayrıca her
biri Ayrıntı kapalıyken ≤ 60 px olmalı (ör. Vergi Özet'te seed'in gecikmiş SGK satırı, Gelir-gider'in SGK ve sayım
uyarıları). "Önce" sütunu bugünkü bütün renkli kutuları sayar; fark bilinçlidir: hedef, katlanabilir gürültünün
ilk ekrandan çekilmesidir.

| Sayfa | Görünüm | Önce | Hedef |
|---|---|---|---|
| `/panel` | yönetici 390 | 592 | ≤ 300; ilk KPI rakamı ilk ekranda |
| `/panel` | yönetici 1440 | 404 | ≤ 404 ("Yapılacak" gri, kırmızı yalnız sorun) |
| `/panel/bugun` | yönetici 390 / personel 390 | 652 / 645 | ≤ 340 / ≤ 340 |
| `/panel/bugun` | yönetici 1440 / personel 1440 | 541 / 481 | ≤ 541 / ≤ 481 (masaüstü desen aynı) |
| `/panel/vergi` | 390 / 1440 | 200 / 454 | ≤ 90 / ≤ 100 |
| `/panel/vergi/gelir-gider` | 390 / 1440 | 148 / 142 | ≤ 90 / ≤ 90 (H1 uyarısı risk=hukuk: sayılır ama tek satır) |
| `/panel/vergi/demirbas` | 390 / 1440 | 48 / 122 | ≤ 40 / ≤ 60 |
| `/panel/vergi/kurallar` | 390 / 1440 | 171 / 158 | ≤ 40 / ≤ 40 |
| `/panel/gelir-gider` | 390 / 1440 | 192 / 160 | ≤ 120 / ≤ 90 (iki para uyarısı, ikisi tek satır) |
| `/panel/karaoke` | yönetici 390 / personel 390 | 298 / 238 | ≤ 120 / ≤ 90 (U6 / U7 tek kutu) |
| `/panel/tahmin` | 390 / 1440 | 144 / 64 | ≤ 60 / ≤ 40 |
| `/panel/hatirlaticilar/nakit` | 390 / 1440 | 140 / 158 | ≤ 60 / ≤ 60 |
| `/panel/hatirlaticilar` | 390 / 1440 | 114 / 114 | ≤ 90 / ≤ 60 |
| `/panel/urunler/site` | 390 / 1440 | 286 / 272 | ≤ 60 / ≤ 60 |
| `/panel/hatirlaticilarim` | personel 1440 | 324 | ≤ 240 (yüzen hap kalktı; ipuçları aynı) |
| `/panel/kasa` | yönetici 1440 | 139,5 | ≤ 90 |
| Listelenmeyen her yönetici / personel sayfası | 390 / 1440 | – | ≤ 90 / ≤ 60 ya da bugünkünden az |
| Personelin 14 ekranı | 390 | yüzen düğme (44 px) içerik örtüyor | `float = 0` (yüzen öğe yok) |

Ötekiler (evet / hayır):
1. Kenar çubuğu kapalıyken "KDV" sözcüğü görünür (yönetici); ⌘K "kdv" ilk sonuç "KDV", "kâr" ilk sonuç "Kâr / zarar",
   "sgk", "maaş", "geçmiş", "yedek" adıyla bulur.
2. Bir ekran bir ad: §3.6 tablosundaki her adreste kenar çubuğu, H1, ⌘K, sekme ve telefon başlığı tabloyla aynı.
3. Grup içinde aynı anda tek alt öğe yanar (Nakit planı'nda Ödemeler yanmaz, Fiyatlar'da Ürünler yanmaz).
4. Her `bad` ve `warn` uyarının başlığında tutar / gün / sonuç var ve ya eylemi ya da `text`'te ne yapılacağı var;
   para, hukuk, veri, bar riski taşıyan hiçbir uyarı katlanmış değil.
5. Bir sayfanın başında en çok iki `bad` dışı renkli uyarı görünür, gerisi "+{n} uyarı daha".
6. Vergi feragati her sekmede tek satır; tam metin bir kez (Muhasebeci'nin sonu) ve ⓘ'de.
7. Vergi Özet'te kapalı KDV satırı ödeme olup olmadığını yazar; SGK satırı Ödemeler'deki günü ve yasal günü birlikte
   gösterir; gecikmiş vergi hatırlatıcısı varsa takvimin üstünde tek turuncu satır.
8. Personel: ağacı, alt menüsü, paleti, açabildiği adresler aynı (`tests/kenar-cubugu.test.ts` personel anahattı);
   `scripts/personel-sizinti.ts` temiz; personel görünümünde "Vercel", anahtar adı, `docs/`, "Teknik ayrıntı" yok.
9. Hiçbir adres değişmedi: `/panel/**` rota listesi PR öncesi ve sonrası aynı (`find src/app/panel -name page.tsx`).
10. `src/lib/calc/**`, `src/server/actions/**`, `src/server/db/schema.ts`, `drizzle/` ve `package.json`
    bağımlılıkları değişmedi (`git diff --stat origin/main -- src/lib/calc src/server/actions src/server/db drizzle
    package.json package-lock.json` boş).
11. Sekme şeritleri 390 ve 360 px'te kaydırmasız (Vergi 328 px, Giderler, Ödeme); "Vergi, KDV, SGK" ve "Kâr &
    ödemeler" kenar çubuğunda kesilmeden (`scrollWidth === clientWidth`).
12. Telefonda bağlam satırı ve "Excel:" yok; masaüstünde bağlam satırı ağaçtan (üst düzey ekranlarda yok).

---

## 14. Tarayıcıda doğrulama (yerel, iki rol, 1440 + 390)

Yalnız yerel: Postgres `postgres://postgres:postgres@localhost:5432/<yeni db>` (kapalıysa
`sudo pg_ctlcluster 16 main start`); üretime ve sırlara dokunulmaz, sır yazdırılmaz. Playwright CommonJS
`require('playwright')` ile (Chromium kurulu; `playwright install` koşulmaz).

1. Yeni veritabanı (ör. `lafmaliyet_uxsade`), `npm run db:migrate`, `npm run db:seed`, ardından
   `ux/seed-extra.sql` (anketin gecikmiş SGK, KDV, sayımsız ay, taslak vergi, LafPOS geçiş günü verisi). Dev sunucusu
   boş bir portta. "Bugün" sistem saatidir: anket 29 Ekim 2026'da ölçüldü; başka bir gün ölçülürse `seed-extra.sql`'in
   günleri (gecikmiş SGK 26 Ekim, KDV 28 Ekim, kasa raporları 23-26 Ekim) aynı farkla kaydırılır, yoksa gecikme ve iş
   listesi başka görünür.
2. **Önce** görüntüleri zaten var (`ux/shots/`, `ux/inventory.json`). **Sonra**: `ux/tools/capture.cjs` ve
   `ux/tools/collect.cjs` (yönetici ve personel oturumu: `ux/tools/login.cjs`, `state-admin.json`,
   `state-staff.json`), 47 adres × {390×844, 1440×900}; `ux/analiz/measure.py` ile §13 tablosu. Çıktılar
   `ux/after/` altına.
3. Kabuk: `ux/tools/shell.cjs`: kenar çubuğu kapalı / açık (yönetici, personel), çekmece, alt menü ("Tümü"), ⌘K
   "kdv", "kâr", "kar", "sgk", "maaş", "geçmiş"; `oneriB/tools/measure-tabs.cjs` ile Vergi, Giderler ve Ödeme
   sekmelerinin 390 / 375 / 360 px genişliği.
4. Elle bakılacak akışlar (her biri iki genişlikte, görüntüsüyle PR gövdesine):
   - Vergi Özet: bant tek satır, ⓘ tam metni açar; gecikmiş SGK satırı → "Ödemeler'de aç"; KDV satırı kapalıyken
     "Ödeme yok · …", açınca tek "Döküm ve devreden KDV" düğmesi `nakit#kdv`'ye iner; Başlarken satırı açılıp
     kapanır; "Şirketin kâr vergisi" kartı uyarı + iki bölüm; `#kdv`, `#sgk`, `#muhtasar`, `#kar-vergisi`
     adresleri doğru satıra iner.
   - Muhasebeci: sıra §7.9; `#kurallar` adresi tabloyu açık getirir; `#bilgi` açık; feragat sonda.
   - Genel bakış (390): gecikmiş ödeme satırı başta; "{Ay Yıl} işleri"; sıradaki iş tam kart, "Diğer N iş" açılır /
     kapanır; ilk KPI ilk ekranda.
   - Bugün (yönetici ve personel 390): "Diğer N iş", "Sonra (N)"; ses yuvası (personel) içerik örtmez, "Sesi aç"
     44 px.
   - Bir `Notice` "Ayrıntı" klavyeyle açılır (Tab + Enter), odak halkası görünür; ekran okuyucu önekinin DOM'da
     olduğu (`.sr-only`).
   - Ödemeler: "Ödedim" düğmesi, geri alma; sekmeler Ödemeler · Nakit planı.
   - Satışlar: başlık altı satış kaynağı satırı (ModPOS ayı ve LafPOS / geçiş ayı).
5. Personel turu (`state-staff.json`): 14 ekran; zayi, kasa, sayım, reçete defteri (fiyat notu yok), karaoke (U7
   metni, tech yok); `npx tsx scripts/personel-sizinti.ts` dev sunucusuna karşı temiz.
6. `npm run build` (yerelde `NODE_ENV` set etmeden) ve `npm test` tam; CI yeşil; birleştirmeden sonra canlıda yönetici
   olarak `/panel`, `/panel/vergi`, `/panel/hatirlaticilar` ve ⌘K "kdv" bir kez (yalnız okuma; veri değiştirilmez).

---

## 15. Kapsam dışı (bu PR'da yok)

- ModPOS bağlantısının kendisi (API istemcisi, ayar kartı, geçmiş ayların aktarımı, elle rapor ile çakışma kuralı)
  (§10 yalnız yeri ayırır).
- Vergi satırında "Ödedim", `VatCarryDialog`'un Vergi'ye taşınması, muhtasar / geçici / kurumlar için varsayılan
  hatırlatıcı, takvimde geçmiş dönem grubu ve ay ay ara toplam (K12, K13).
- Uyarı kimlikleri, kişi başına "Anladım / Sonra hatırlat", `localStorage` ile kapatma, "Menü sadeleşti" notu (K10).
- Grup altı ipucu satırı (K8), "Komisyon & hakediş"in yeniden adlandırılması (K9), "Muhasebeci" listesinin kopyala /
  paylaş düğmeleri (K21).
- Genel bakış'ın varsayılan ayının değişmesi, Satışlar'ın adım adım akışa bölünmesi, Faturalar'ın süzgeçle açılması,
  Kasa raporunun telefonda yeniden düzeni, Vergi kârı köprü kartının tablonun üstüne taşınması.
- "Kâr" rakamlarının tek tabana inmesi, Genel bakış'a vergi kartı, bekleyen hakedişin Nakit planı'na girmesi (hesap
  işi).
- POS cirosu ve kartlı satış oranının çift girişi (Satışlar / Gelir-gider, Ayarlar / Satışlar).
- Personel Yardım'ı, personelin ağacı, e-posta şablonlarının tasarımı (yalnız iki altbilgi metni değişir).
- `src/lib/calc/**`, `src/server/actions/**`, şema, göç, cron, yeni bağımlılık.

---

## 16. Sahibe sorulacaklar (uygulamayı beklemez; varsayılan karar parantezde)

1. Para grubunun adı "Kâr & ödemeler" mi, "Para" mı? (Kâr & ödemeler; kimlik `finans`, değiştirmek tek satır.)
2. "Komisyon & hakediş" → "Yemek kartı & platform" olsun mu? (şimdilik aynı.)
3. SGK hatırlatıcısının her ayın 26'sı olması bilinçli mi, yoksa yasal son güne (izleyen ayın sonu) mi çekilsin?
   (gün değişmez; iki gün birlikte yazılır.)
4. Vergi satırında da "Ödedim" düğmesi olsun mu? (yok; Ödemeler'de.)
5. POS cirosu iki yerde girilebiliyor (Satışlar, Gelir-gider): tek yere inilsin mi? (bu PR'da aynı.)
6. "Hammadde" mi "malzeme" mi? (menü adı "Hammaddeler" kalır.)
7. Genel bakış süren ayla mı açılsın? (son satış ayı kalır; başlık ayı doğru adlandırır.)
8. Muhasebeciye sorulacaklar listesine "kopyala / paylaş" eklensin mi? (sonraki tur.)
9. Personel Reçete defterinde ürün notlarını görmeli mi? (fiyat / ModPOS geçen notları görmez, ötekileri görür.)
10. ModPOS bağlantısı geldiğinde, elle yüklenmiş eski aylar bağlantının rakamıyla değiştirilsin mi? (bağlantı PR'ının
    kararı; §10.)

---

## Ek A. Göç tablosu: 290 kutu / rol konumunun hepsi

Kaynak `ux/spec-tools/locs.json` (main @ 1947c7c; `bg-(warn|bad|info|good)-soft`, `bg-lime/25`,
`role="alert|status|note"`, `components/akmanos` hariç). Sütunlar: Bugün = desen (warn / bad / info / good / lime / r-…)
ve ne olduğu; Yeni = **D** dokunulmaz (rozet, seçim, hücre, form alanı, içerik vurgusu), **Notice {ton}·{boy}** (risk ve
`live` ile), **E** form / eylem hatası = `Notice bad·sm live=assertive`, "→ §6.1" metni §6.1'de, "bkz. §6.2"
yardımcı, "bkz. §7.4" Vergi bandı, "aynı öğe" bir üst satırın parçası. Sayım: **D 103 · N 172 · E 15**. Satır kayarsa
metinle bulunur.

| # | Konum (main 1947c7c) | Bugün | Yeni | Yeni metin · Ayrıntı · eylem ("metin aynı" = dinamik ya da zaten kısa) |
|---|---|---|---|---|
| 1 | `src/app/baglan/consent-form.tsx:32` | r-status · — | D | panel dışı: /baglan |
| 2 | `src/app/davet/set-password-form.tsx:51` | r-status · — | D | panel dışı: /davet |
| 3 | `src/app/giris/auth-ui.tsx:48` | r-alert · giriş hatası | D | giriş ekranının kendi kartı, panel dışı |
| 4 | `src/app/giris/login-form.tsx:116` | r-status · — | D | panel dışı: giriş |
| 5 | `src/app/giris/login-form.tsx:128` | r-status · — | D | panel dışı: giriş |
| 6 | `src/app/giris/login-form.tsx:216` | r-status · — | D | panel dışı: giriş |
| 7 | `src/app/giris/login-form.tsx:262` | r-status · — | D | panel dışı: giriş |
| 8 | `src/app/menu/page.tsx:82` | warn · QR menü önizleme şeridi | D | panel dışı müşteri sayfası |
| 9 | `analiz/analysis-client.tsx:216` | warn,r-note · reçetesi boş ürünler gruplara girmedi | Notice warn·md | başlık metin aynı ("Reçetesi boş {n} ürün gruplara girmedi") · Ayrıntı bugünkü açıklama |
| 10 | `analiz/analysis-client.tsx:788` | info · kaydırıcı değer hapı | D | – |
| 11 | `ayarlar/jobs-card.tsx:64` | bad · işin hata mesajı | Notice bad·sm | metin aynı |
| 12 | `ayarlar/jobs-card.tsx:91` | bad · `CRON_SECRET` tanımlı değil | Notice bad·sm risk=veri | **"Günlük işler çalışmıyor: zamanlayıcı anahtarı yok"** · tech "`CRON_SECRET` tanımlı değil; Vercel › Settings › Environment Variables'a ekleyip yeniden yayınlayın (docs/DEPLOY.md § 4)." |
| 13 | `ayarlar/jobs-card.tsx:108` | bad · durum okunamadı | Notice bad·sm | metin aynı |
| 14 | `ayarlar/lafpos-card.tsx:38` | bad · LafPOS durumu okunamadı | Notice bad·sm | metin aynı |
| 15 | `ayarlar/lafpos-card.tsx:48` | bad · reddedilen günler (bağlıyken kırmızı) | Notice (linked ? bad : neutral)·sm | ilk satır başlık, gerisi Ayrıntı (metin aynı) |
| 16 | `ayarlar/lafpos-card.tsx:84` | warn · "LafPOS'tan Gönder bekleniyor" | Notice (linked ? warn : neutral)·sm | **"LafPOS'tan Gönder bekleniyor · {tarih}"** · text `clearedText` |
| 17 | `ayarlar/lafpos-card.tsx:110` | warn · doğrulanmamış gönderim | Notice (loud ? warn : neutral)·sm | metin aynı |
| 18 | `ayarlar/lafpos-client.tsx:112` | warn · bağlantı kurulmadı (geçiş günü penceresi) | Notice warn·sm | **"Bağlantı kurulmadı: anahtar girilene kadar LafPOS günleri gelmez"** |
| 19 | `ayarlar/page.tsx:191` | bad · yedek bilgisi okunamadı | Notice bad·sm | metin aynı |
| 20 | `ayarlar/page.tsx:333` | bad · bağlantı hatası | Notice bad·sm | metin aynı |
| 21 | `ayarlar/photo-card.tsx:68` | warn · depo 1 GB'a yaklaşıyor | Notice warn·sm risk=veri | metin aynı |
| 22 | `ayarlar/settings-client.tsx:710` | r-status · — | Notice warn·line risk=veri | Değişiklikler kaydedilmedi · Kaydet'e basın |
| 23 | `ayarlar/stock-valuation.tsx:146` | warn · tablo satırı vurgusu | D | – |
| 24 | `faturalar/cash-out-invoices.tsx:191` | bad · bölüm başlığı "Faturası geldi, …iki kez sayılıyor" | D | liste başlığı; satırlarda rozet var |
| 25 | `faturalar/cash-out-invoices.tsx:198` | bad · ikon karosu | D | – |
| 26 | `faturalar/document-sheet.tsx:63` | r-alert · satır içi hata | D | kutusuz tek satır, zaten kompakt |
| 27 | `faturalar/document-sheet.tsx:284` | r-status · — | D | yükleniyor durumu |
| 28 | `faturalar/document-sheet.tsx:296` | r-alert · belge hatası + Yeniden dene | D | boş durumun içi |
| 29 | `faturalar/invoice-dialog.tsx:362` | bad · Sil düğmesi | D | – |
| 30 | `faturalar/invoice-dialog.tsx:423` | info · kasadan gelen faturanın bilgisi (fotoğraflı) | D (nötre) | fotoğraf küçük resmi olduğu için kalır; `bg-info-soft text-info` → `bg-ink/[0.04] text-ink-soft` |
| 31 | `faturalar/invoices-client.tsx:88` | lime/25 · kategori hapı (yeşil) | D | – |
| 32 | `faturalar/invoices-client.tsx:89` | info · kategori hapı (mavi) | D | – |
| 33 | `faturalar/invoices-client.tsx:1482` | warn,r-status · kategori tahminle yazıldı (pencere) | Notice warn·sm | metin aynı |
| 34 | `faturalar/review-notice.tsx:35` | warn,r-status · N fatura kategorisi tahmin | Notice warn·md | **"{n} faturanın kategorisi tahmin: kontrol edin"** · text "Doğruysa onaylayın, değilse kategoriyi değiştirin." · eylem bugünkü |
| 35 | `gelir-gider/month-view.tsx:450` | info · hücre (üzerine yazılmış) | D | – |
| 36 | `gelir-gider/month-view.tsx:551` | bad · Temizle düğmesi | D | – |
| 37 | `gelir-gider/month-view.tsx:607` | bad · Temizle düğmesi (telefon) | D | – |
| 38 | `gelir-gider/page.tsx:338` | r-note · U4 | Notice → §6.1 | bkz. §6.1 (U4) |
| 39 | `gelir-gider/pnl-grid.tsx:322` | bad · geçersiz hücre | D | – |
| 40 | `gelir-gider/pnl-grid.tsx:379` | info · üzerine yazılmış hücre | D | – |
| 41 | `gelir-gider/pnl-grid.tsx:452` | bad · Notu sil | D | – |
| 42 | `gelir-gider/pnl-grid.tsx:564` | bad · Notu sil | D | – |
| 43 | `gelir-gider/pnl-grid.tsx:981` | info · lejant | D | – |
| 44 | `gelir-gider/sgk-rate-notice.tsx:21` | warn,r-note · U3 | Notice → §6.1 | bkz. §6.1 (U3) |
| 45 | `gelir-gider/site-sales-card.tsx:130` | bad · son hata | Notice bad·sm | metin aynı |
| 46 | `giderler/expenses-client.tsx:117` | lime/25 · satır parlaması | D | – |
| 47 | `giderler/expenses-client.tsx:317` | info · ikon karosu | D | – |
| 48 | `giderler/expenses-client.tsx:1183` | bad · Sil | D | – |
| 49 | `giderler/expenses-client.tsx:1570` | bad · Sil | D | – |
| 50 | `hammaddeler/ingredients-client.tsx:133` | warn · tahmini satır zemini | D | – |
| 51 | `hammaddeler/ingredients-client.tsx:656` | info,r-status · arama yalnız pasiflerle eşleşti | Notice neutral·sm | metin aynı |
| 52 | `hammaddeler/ingredients-client.tsx:1016` | warn · silme engeli (onay penceresi) | Notice warn·sm risk=para | metin aynı (silinememe nedeni okunmalı) |
| 53 | `hammaddeler/ingredients-client.tsx:1258` | bad · Sil | D | – |
| 54 | `hammaddeler/ingredients-client.tsx:1366` | warn,r-status · reçete uyarısı | Notice warn·sm | metin aynı |
| 55 | `hammaddeler/ingredients-client.tsx:1425` | warn,r-status · sayım uyarısı | Notice warn·sm | metin aynı |
| 56 | `hammaddeler/ingredients-client.tsx:1495` | r-alert · alan hatası | D | `Field` hata satırı |
| 57 | `hammaddeler/ingredients-client.tsx:1507` | warn,r-status · faturadan yeni fiyat onay bekliyor | Notice warn·sm | **"Faturadan yeni fiyat onay bekliyor: {fiyat}"** · text "{tedarikçi}, {tarih}" · eylem bugünkü düğme |
| 58 | `hammaddeler/price-holds.tsx:418` | warn,info · öneri (okuma / çakışma) | Notice (reading ? neutral : warn)·sm | başlık `suggestion.text` · eylem çarpan düğmesi |
| 59 | `hammaddeler/price-holds.tsx:435` | r-status · — | D | okunuyor durumu |
| 60 | `harcamalar/monthly-expenses.tsx:270` | warn,r-status · her ay girilecek kategoriler girilmedi | Notice warn·md risk=para | **"{kategoriler} {ay} için girilmedi"** · text "Girilmezse ayın gideri eksik görünür." |
| 61 | `harcamalar/monthly-expenses.tsx:609` | warn · tedarikçinin faturasız alımından | Notice warn·sm | metin aynı · eylem bugünkü |
| 62 | `harcamalar/monthly-expenses.tsx:625` | info · kasa fişinden | Notice neutral·sm | metin aynı · eylem bugünkü |
| 63 | `hatirlaticilar/nakit/cash-plan-client.tsx:162` | bad,r-status · U2b | Notice → §6.1 | bkz. §6.1 (U2b) |
| 64 | `hatirlaticilar/nakit/cash-plan-client.tsx:170` | info,r-status · U2 | Notice → §6.1 | bkz. §6.1 (U2) |
| 65 | `hatirlaticilar/nakit/cash-plan-client.tsx:180` | good,r-status · U2c | Notice → §6.1 | bkz. §6.1 (U2c) |
| 66 | `hatirlaticilar/notifications-section.tsx:191` | info,r-note · Resend anahtarı girilmedi | Notice neutral·md | **"E-posta gönderimi kurulmadı"** · text "Adresler ve ayarlar şimdiden kaydedilebilir." · tech "…" (bugünkü metin) |
| 67 | `hatirlaticilar/payment-ui.tsx:417` | bad · menü öğesi (tehlikeli) | D | – |
| 68 | `hatirlaticilar/payment-ui.tsx:471` | bad · menü öğesi (tehlikeli) | D | – |
| 69 | `hatirlaticilar/payment-ui.tsx:684` | info · "Sıradaki dönem" hapı | D | rozet |
| 70 | `hatirlaticilar/reminder-sheet.tsx:347` | bad · Sil | D | – |
| 71 | `hatirlaticilar/reminders-client.tsx:373` | bad · Gecikmiş kartı (U1) | D | iyi desen |
| 72 | `hatirlaticilar/reminders-client.tsx:403` | warn,r-status · hatırlatıcı tutarı sabit giderden farklı + liste | Notice warn·md defaultOpen risk=para | **"{n} hatırlatıcının tutarı sabit giderden farklı"** · text "Nakit planı hatırlatıcıdaki tutarı öder." · Ayrıntı (açık): liste ve satır eylemleri |
| 73 | `hesap/connections.tsx:89` | bad · Kaldır | D | – |
| 74 | `hesap/page.tsx:104` | bad · bağlı uygulamalar okunamadı | Notice bad·sm | metin aynı |
| 75 | `hesap/password-form.tsx:106` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 76 | `hesap/password-form.tsx:155` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 77 | `hesap/two-factor.tsx:53` | warn,r-status · kurtarma kodu azaldı | Notice warn·sm risk=veri | **"Kurtarma kodunuz azaldı: yenilerini oluşturun"** · text "Güvenli bir yere kaydedin." |
| 78 | `karaoke/doluluk/history-button.tsx:33` | r-status · — | D | okunuyor durumu |
| 79 | `karaoke/doluluk/page.tsx:206` | info · geçmiş rezervasyonlar alınıyor | Notice neutral·md | metin aynı · eylem bugünkü |
| 80 | `karaoke/karaoke-admin.tsx:161` | bad · eşitleme hatası | Notice bad·sm | metin aynı |
| 81 | `karaoke/karaoke-board.tsx:154` | info,r-status · U6 / U7 | Notice → §6.1 | bkz. §6.1 (U6, U7) |
| 82 | `karaoke/karaoke-board.tsx:161` | warn,r-status · bayat veri | Notice warn·md risk=bar | metin aynı |
| 83 | `karaoke/karaoke-board.tsx:383` | warn · çakışma "Dikkat: …" | Notice warn·sm | "Dikkat:" öneki kalkar (ton söylüyor), metin aynı |
| 84 | `karaoke/orders-board.tsx:232` | warn,r-status · sipariş çekme satırları | Notice warn·sm risk=bar | ilk satır başlık, kalanı Ayrıntı (metin aynı; personel metni ayrı kalır) |
| 85 | `karaoke/orders-board.tsx:302` | warn · yeni masa siparişi kartı vurgusu | D | – |
| 86 | `karaoke/orders-board.tsx:325` | warn · müşterinin notu | D | içerik vurgusu, uyarı değil |
| 87 | `kasa/cash-form.tsx:893` | bad,lime/25 · e-posta durumu (kırmızı / yeşil / gri) | Notice bad / good / neutral·sm | metin aynı · eylem "Yeniden dene" |
| 88 | `kasa/cash-form.tsx:904` | info · LafPOS kasadan çıkanlar | Notice neutral·sm | metin aynı |
| 89 | `kasa/cash-form.tsx:905` | info · sonraki not | Notice neutral·sm | metin aynı |
| 90 | `kasa/cash-form.tsx:1099` | info,r-note · geç rapor notu | Notice neutral·md | **"Geç rapor · {tarih}: yönetici onaylayınca kayda geçer"** · text kip metninin ikinci cümlesi ("Z raporunun fotoğrafı ve Z no zorunlu; gün içinde kasadan çıkanı elle yazın." / LafPOS kipleri aynı) |
| 91 | `kasa/cash-form.tsx:1113` | info,r-note · düzeltme önerisi | Notice neutral·md | **"{gün} kasa raporu · düzeltme önerisi"** · text bugünkü cümle |
| 92 | `kasa/cash-form.tsx:1128` | info,r-note · LafPOS gün sonu | Notice neutral·md | **"LafPOS gün sonu · Z {no} · {saat}"** · text `lafposNote` · eylem bugünkü |
| 93 | `kasa/cash-form.tsx:1181` | warn · ödeme türleri Z toplamından farklı | Notice warn·sm | **"Ödeme türleri Z toplamından {fark} {fazla/az}"** · text "Bir tutarı yanlış yazmış olabilirsiniz…" (bugünkü kalan) |
| 94 | `kasa/cash-form.tsx:1192` | warn,r-status · açılış devirle tutmuyor | Notice warn·sm risk=para | **"Önceki raporun devri {tutar} ({gün}); yazdığınız {fark}"** · text "Kasaya para kondu ya da alındıysa nedenini nota yazın." · eylem "Devri yaz" |
| 95 | `kasa/cash-form.tsx:1279` | warn · kasadan çıkan uyarısı | Notice warn·sm | metin aynı |
| 96 | `kasa/cash-form.tsx:1280` | info · LafPOS kasadan çıkanlar | Notice neutral·sm | metin aynı |
| 97 | `kasa/cash-form.tsx:1292` | info · bir banka fişi daha okundu | Notice neutral·sm | başlık metin aynı · text `unsure` · eylem iki düğme (pencere içi istisna) |
| 98 | `kasa/cash-form.tsx:1347` | info · LafPOS teslimi kasadan çıkanlarda yok | Notice neutral·sm | metin aynı |
| 99 | `kasa/cash-history.tsx:323` | bad · e-posta gitmedi | Notice bad·sm | **"E-posta gitmedi: {hata}"** |
| 100 | `kasa/cash-out-dialog.tsx:332` | info · istek bilgisi | Notice neutral·sm | metin aynı |
| 101 | `kasa/cash-out-dialog.tsx:371` | info · tedarikçi ipucu | Notice neutral·sm | **"{tedarikçi} tedarikçimiz"** · text "Borç ödemesiyse "Teslim · ödeme" seçin; alışverişse böyle kalsın." · eylem bugünkü |
| 102 | `kasa/cash-out-dialog.tsx:411` | info · faturalı, Aylık harcamalar'a yazılmadı | Notice neutral·sm | metin aynı |
| 103 | `kasa/cash-out-dialog.tsx:417` | info · yöneticinin kaydına bağlı | Notice neutral·sm | metin aynı |
| 104 | `kasa/cash-out-dialog.tsx:430` | warn,info · fiş kontrolleri | CheckNotices (Notice·sm; warn→warn, öteki→neutral) | metin aynı |
| 105 | `kasa/cash-photos.tsx:48` | warn,info · fotoğraf kontrolleri | CheckNotices (Notice·sm; warn→warn, öteki→neutral) | metin aynı |
| 106 | `kasa/cash-photos.tsx:98` | r-status · — | Notice warn·line | (okuma hatası metni aynı) |
| 107 | `kasa/cash-photos.tsx:187` | warn · fotoğraftan farklı yazılan | Notice warn·sm | **"Fotoğraftan farklı yazılan: …"** (metin aynı) |
| 108 | `kasa/cash-requests.tsx:66` | warn,r-status · düzeltme öneriniz onay bekliyor | Notice neutral·sm (kendi isteğinin durumu) | **"Düzeltme öneriniz onay bekliyor · {zaman}"** · text satırlar (görünür) |
| 109 | `kasa/cash-requests.tsx:88` | warn,r-status · silme isteğiniz onay bekliyor | Notice neutral·sm | **"Silme isteğiniz onay bekliyor · {zaman}"** · text "Neden: …" · eylem "Geri çek" |
| 110 | `kasa/cash-settings.tsx:53` | warn · U8 | Notice → §6.1 | bkz. §6.1 (U8) |
| 111 | `kasa/cash-settings.tsx:58` | bad,r-note · engellenen alıcılar | Notice bad·sm | **"Bu adreslere rapor gitmez"** · text adres ve neden listesi (görünür) |
| 112 | `kasa/cash-summary.tsx:38` | warn,r-note · LafPOS'tan farklı yazılan | Notice warn·sm | **"LafPOS'tan farklı yazılan {n} alan"** · text liste |
| 113 | `kasa/cash-summary.tsx:148` | warn · ödeme türleri Z'den farklı | Notice warn·sm risk=para | metin aynı |
| 114 | `kasa/cash-summary.tsx:256` | warn,info,lime/25 · özet satırları (warn / good / info) | Notice·sm (tonu satırdan: warn→warn, good→good, info→neutral) | metin aynı |
| 115 | `kasa/closed-day.tsx:36` | r-note · kafe kapalı işaretli | Notice neutral·md | metin aynı |
| 116 | `kasa/closed-day.tsx:93` | r-note · kafe kapalıydı satırı + düğme | Notice neutral·md | metin aynı · eylem bugünkü |
| 117 | `kasa/closed-day.tsx:117` | warn · yöneticiye uyarılar (pencere) | Notice warn·sm | ilk uyarı başlık, kalanı text |
| 118 | `kasa/late-report.tsx:165` | warn,r-alert · reddedildi | Notice warn·md live=assertive | **"Reddedildi · {kişi}: {not}"** · text "Önceki değerleriniz formda; düzeltip yeniden gönderebilirsiniz." |
| 119 | `kasa/okc-card.tsx:144` | warn · "Ayrıntılar" açılır düğmesi turuncu | D | açılır düğmenin durumu |
| 120 | `kasa/okc-card.tsx:201` | warn,info,lime/25 · `Note` | bkz. §6.2 | yerel yardımcı kalkar, yerine Notice (bkz. §6.2) |
| 121 | `kasa/page.tsx:304` | warn,r-note · yöneticiye bekleyen istekler | Notice warn·md | **"Bu gün için {n} personel isteği bekliyor"** · text istek satırları (bağlantılı, görünür) |
| 122 | `kasa/page.tsx:607` | info,r-note · laffogato.net online satışı | Notice neutral·md | **"laffogato.net · {tarih}: online {tutar}, kasadan geçmez"** (yöneticide "· karaoke ön ödeme {tutar}") · Ayrıntı "Kasa farkına ve Z raporuna girmez; ModPOS'un "Online" ödemesi (Yemeksepeti, Getir…) ayrı. Sitenin günü gece yarısında biter." |
| 123 | `kontrol/[id]/page.tsx:96` | warn,r-note · dünün listesi 05:30'a kadar | Notice warn·md | **"Dünün listesi: 05:30'a kadar bitirilebilir"** · text "Yeni gün 05:00'te başladı." |
| 124 | `kontrol/[id]/photo-item.tsx:181` | r-alert · yüklenemedi + Tekrar dene | Notice bad·sm live=assertive | **"Yüklenemedi: {mesaj}"** · eylem "Tekrar dene" |
| 125 | `kontrol/[id]/run-form.tsx:161` | lime/25,r-status · liste tamam | Notice good·md | **"Liste tamam · {saat} · {kim}"** · eylem "Bugün'e dön" (bugünkü) |
| 126 | `kontrol/[id]/run-form.tsx:205` | r-status · — | D | ilerleme sayacı |
| 127 | `kontrol/[id]/run-form.tsx:338` | warn · "Sorun: {not}" | Notice warn·sm | metin aynı · eylem "Düzelt" |
| 128 | `kontrol/[id]/run-form.tsx:411` | bad,lime/25 · değer hapı (aralık dışı) | D | rozet |
| 129 | `kontrol/[id]/run-form.tsx:475` | warn · aralık dışı değer + not alanı | D | form içi soru bloğu |
| 130 | `kontrol/duzenle/[id]/page.tsx:54` | info,r-note · fotoğraf deposu kurulu değil | Notice neutral·md | **"Fotoğraf deposu kurulmadı: fotoğraflı maddeler görünmez"** · Ayrıntı "Depo bağlanana kadar fotoğraf isteyen maddeler listede görünmez." |
| 131 | `kontrol/duzenle/[id]/template-editor.tsx:132` | r-alert · form hatası | Notice bad·sm live=assertive | – |
| 132 | `kontrol/duzenle/[id]/template-editor.tsx:144` | bad · Listeyi sil | D | – |
| 133 | `kontrol/duzenle/[id]/template-editor.tsx:335` | bad,r-alert · form hatası (alertRef) | Notice bad·sm live=assertive | `ref={alertRef}` korunur |
| 134 | `kontrol/duzenle/page.tsx:42` | info,r-note · fotoğraf deposu kurulu değil | Notice neutral·md | `:54` ile aynı başlık |
| 135 | `kontrol/duzenle/templates-client.tsx:145` | r-alert · form hatası | Notice bad·sm live=assertive | – |
| 136 | `kontrol/run-view.tsx:200` | warn · "Sorun: {not}" | Notice warn·sm | metin aynı |
| 137 | `kontrol/run-view.tsx:210` | bad · değer hapı | D | – |
| 138 | `kullanicilar/access-sheet.tsx:179` | r-status · — | Notice neutral·sm | E-posta kapalı · bağlantıyı kopyalayın ya da WhatsApp'la iletin |
| 139 | `kullanicilar/access-sheet.tsx:200` | warn · parola / bağlantı bir daha gösterilmez | Notice warn·sm risk=veri | **"Parola bir daha gösterilmez"** / **"Bağlantı bir daha gösterilmez"** · text bugünkü ikinci cümle |
| 140 | `kullanicilar/close-guard.tsx:27` | warn,r-alert · kaydedilmemiş değişiklik sorusu | Notice warn·sm live=assertive | başlık `{title}` · text `{description}` |
| 141 | `kullanicilar/password-field.tsx:123` | r-status · — | D | yalnız ekran okuyucu |
| 142 | `kullanicilar/users-client.tsx:1032` | bad · Sil | D | – |
| 143 | `onaylar/karaoke-cards.tsx:84` | warn · istekten sonra değişti | Notice warn·sm | **"İstekten sonra değişti"** · text satırlar |
| 144 | `onaylar/kasa-cards.tsx:249` | warn · silme sonucu | Notice warn·sm risk=veri | **"Silinince rapor ve önceki sürümleri gider"** · text "Değerleri işlem geçmişinde kalır, fotoğraflar 30 gün saklanır." + `{next}` |
| 145 | `onaylar/kasa-cards.tsx:344` | info · LafPOS Z satırı | Notice neutral·sm | metin aynı |
| 146 | `onaylar/kasa-cards.tsx:346` | warn · LafPOS gün sonu gelmedi | Notice warn·sm | **"LafPOS'un bu gün sonu gelmedi: Z fotoğrafından kontrol edin"** |
| 147 | `onaylar/kasa-cards.tsx:349` | warn · fotoğraf okunmadı | Notice warn·sm | **"Fotoğraf okunmadı: tarihi ve rakamları fotoğraftan kontrol edin"** |
| 148 | `onaylar/kasa-cards.tsx:387` | warn · açılış devirle tutmuyor, not yok | Notice bad·sm (onayı engelliyor) | **"Açılış devirle tutmuyor ve not yok: bu hâliyle kaydedilemez"** · text "Düzeltip onaylayın ve nedeni nota yazın." |
| 149 | `onaylar/kasa-out-cards.tsx:153` | warn · istekten sonra değişti | Notice warn·sm | **"İstekten sonra değişti"** · text "Satır, fişi ya da bağlı gider kaydı. Günü açıp bakın; onaylarsanız istenen hâl yazılır." |
| 150 | `onaylar/ops-cards.tsx:176` | warn · kayıt kasa e-postasına girdi | Notice warn·sm | **"Bu kayıt o günün kasa e-postasında"** · text "Silinirse e-postadaki özetle tutmaz." |
| 151 | `onaylar/review-list.tsx:238` | warn,r-status · reçete öneriden sonra değişti | Notice warn·sm | **"Reçete bu öneriden sonra değişti"** · text ""Önce" sütunu öneri anındaki reçete; onaylarken bugünkü hâliyle karşılaştırın." |
| 152 | `onaylar/review-list.tsx:473` | bad,r-status · malzeme artık yok | Notice bad·sm | **"{adlar} hammaddelerde yok: onaylanamaz, reddedin"** |
| 153 | `onaylar/review-list.tsx:479` | bad,r-status · pasif malzeme | Notice bad·sm | başlık `{inactive}` · eylem `NoticeLink` "Pasif malzemeler" |
| 154 | `onaylar/review-list.tsx:491` | info · iki boy aynı adla | Notice neutral·sm | metin aynı |
| 155 | `onaylar/review-list.tsx:682` | bad,r-status · miktar sorunları | Notice bad·sm | metin aynı |
| 156 | `onaylar/review-list.tsx:693` | warn,r-status · paket fiyatı girilmemiş | Notice warn·sm risk=para | **"{adlar} için paket fiyatı yok: maliyet eksik"** · eylem `NoticeLink` "Fiyat gir" → `/panel/hammaddeler?durum=fiyatsiz` |
| 157 | `parasut/parasut-client.tsx:432` | info,r-status · e-faturalar doğrudan alındı | Notice neutral·md | başlık metin aynı · Ayrıntı bugünkü ikinci paragraf |
| 158 | `parasut/parasut-client.tsx:449` | warn,r-status · içeri alınmamış e-fatura (yapılacak iş yok) | Notice neutral·md | **"Paraşüt'te içeri alınmamış ≈ {n} e-fatura: sonraki eşitlemede gelir"** · Ayrıntı "Paraşüt'te "içeri al" yapmanız gerekmez. Örnek: …" |
| 159 | `parasut/parasut-client.tsx:607` | warn,r-status · tedarikçiye iade panele girmedi | Notice warn·md risk=para | **"Tedarikçiye {n} iade panele girmedi"** · Ayrıntı liste |
| 160 | `parasut/parasut-client.tsx:631` | info,r-status · satış iadeleri gider sayılmadı | Notice neutral·md | başlık metin aynı · Ayrıntı açıklama |
| 161 | `parasut/parasut-client.tsx:882` | r-status · — | D | okuma ilerlemesi |
| 162 | `parasut/parasut-client.tsx:902` | warn,r-status · kontrol edilecek bağlantılar | Notice warn·md | **"Kontrol edilecek bağlantılar · {n}"** · text "Paket boyu çarpandan farklı; çarpan doğruysa olduğu gibi bırakın." |
| 163 | `personel/staff-editor.tsx:71` | lime/25 · satır parlaması | D | – |
| 164 | `personel/staff-editor.tsx:964` | bad · Sil | D | – |
| 165 | `receteler/change-editor.tsx:170` | warn · bekleyen öneriniz var | Notice neutral·sm | **"{boy} için bekleyen öneriniz var"** · text "Gönderirseniz öneri güncellenir; bugünkü reçeteye geri getirirseniz geri çekilir." |
| 166 | `receteler/recipe-book.tsx:186` | warn,r-status · onay bekleyen öneriler (yönetici) | Notice warn·md | başlık `pendingSummary(...)` · eylem bugünkü |
| 167 | `satislar/page.tsx:315` | info,r-note · geçiş ayı bilgisi | Notice neutral·md | metin aynı |
| 168 | `satislar/page.tsx:321` | warn,r-note · ay uyarıları (her biri kutu) | Notice warn·md (her ay uyarısı ayrı Notice, grup katlamaz: risk=veri) | metin aynı |
| 169 | `satislar/sales-client.tsx:370` | info · kasa kipinde hücre | D | – |
| 170 | `satislar/sales-client.tsx:401` | r-status · — | aynı öğe | 402. satırdaki şeridin kökü: 402'nin kararı geçerli |
| 171 | `satislar/sales-client.tsx:402` | warn,info · kasa şeridi (warn / info) | Notice warn / neutral·sm | metin aynı · bağlantı eylem |
| 172 | `satislar/sales-client.tsx:521` | warn,good · tutarlı / tutmuyor | Notice good / warn·sm risk=para | metin aynı |
| 173 | `satislar/sales-client.tsx:523` | r-status · — | aynı öğe | 521. satırdaki kutunun rolü: 521'in kararı geçerli |
| 174 | `satislar/sales-client.tsx:610` | warn · eşleşmedi düğmesi tonu | D | – |
| 175 | `satislar/sales-client.tsx:611` | info · hizmet düğmesi tonu | D | – |
| 176 | `satislar/sales-client.tsx:892` | lime/25 · önerilen eşleşme düğmesi | D | – |
| 177 | `satislar/sales-client.tsx:976` | bad,r-alert · listede toplam satırı var | Notice bad·md live=assertive risk=para | **"Listede toplam satırı var: ciro ve kâr iki kat görünür"** · text "Silin." · Ayrıntı (açık) satır düğmeleri |
| 178 | `satislar/sales-client.tsx:1803` | info · LafPOS'tan geliyor | Notice neutral·md | metin aynı |
| 179 | `satislar/sales-client.tsx:1823` | bad · Ayı temizle | D | – |
| 180 | `satislar/sales-client.tsx:1899` | bad · Ayı temizle | D | – |
| 181 | `satislar/sales-client.tsx:1935` | info,r-status · atlanan satırlar | Notice neutral·sm | **"{skippedText}: ürün sayılmaz"** · Ayrıntı "Ay cirosu iki kez sayılmasın diye yüklenmez." + liste |
| 182 | `satislar/sales-client.tsx:1958` | warn,r-alert · toplam satırı olabilir | Notice warn·sm live=assertive risk=para | **""{ad}" toplam satırı olabilir"** · text "Cirosu diğer satırların toplamına eşit; ürün değilse çıkarın, yoksa ay cirosu iki kat görünür." · eylem "Listeden çıkar" |
| 183 | `satislar/sales-client.tsx:1972` | warn · şüpheli satır zemini | D | – |
| 184 | `satislar/sales-client.tsx:2008` | warn · şüpheli satır zemini | D | – |
| 185 | `sayim/add-item.tsx:186` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 186 | `sayim/stock-form.tsx:1065` | warn · gelir-giderde stok elle girildi | Notice warn·sm risk=para | **"Gelir-giderde {ay} stoğu elle {tutar}: kâr-zarar bu sayımı kullanmaz"** · eylem bugünkü bağlantı |
| 187 | `sayim/stock-form.tsx:1870` | warn,r-status · eski ayı yalnız yönetici açar (personel) | Notice neutral·md | **"{ay} sayımını yalnız yönetici açar; {bu ay} açıldı"** · text "Eski bir ayda düzeltme gerekiyorsa yöneticiye haber verin." |
| 188 | `sayim/stock-form.tsx:1875` | info,r-status · kaydedilmemiş taslak | Notice neutral·md | **"Bu cihazda kaydedilmemiş {n} kalemlik sayım var"** · eylem "Geri yükle" |
| 189 | `sayim/stock-form.tsx:2105` | warn,r-status · başkası da kaydetti | Notice warn·sm risk=veri | **"Bu liste siz yazarken başkası tarafından da kaydedildi"** · text "{adlar} için sizin yazdığınız duruyor; kaydederseniz onunkinin yerine geçer." |
| 190 | `sayim/stock-form.tsx:2111` | warn,r-status · listede de var | Notice warn·sm risk=para | **"{adlar} sayım listesinde de var: stok iki kez sayılabilir"** · text "Aynı kalemse miktarı listedeki satıra yazın ve buradan kaldırın." |
| 191 | `system-banner.tsx:16` | bad,r-alert · sistem uyarıları | Notice → §6.1 | bkz. §6.1 (sistem uyarıları) |
| 192 | `tahmin/page.tsx:66` | info,r-status · U9 | Notice → §6.1 | bkz. §6.1 (U9) |
| 193 | `tahmin/special-days.tsx:256` | bad,r-alert · form hatası (alertRef) | Notice bad·sm live=assertive | – |
| 194 | `task-style.tsx:14` | lime/25 · iş durumu kuyusu (Tamam) | D | – |
| 195 | `task-style.tsx:15` | warn · iş durumu kuyusu (Yapılacak) | D (griye döner) | §4.7: `well: "bg-note text-ink-soft"`, `tone: "gray"`, ikon `CircleDashed` |
| 196 | `task-style.tsx:16` | bad · iş durumu kuyusu (Sorun var) | D | ikon `TONE_ICON.bad` |
| 197 | `tedarikciler/[cari]/allocation-dialog.tsx:223` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 198 | `tedarikciler/[cari]/cari-strips.tsx:33` | good · `Strip` tonu | bkz. §6.2 | yerel yardımcı kalkar, yerine Notice (bkz. §6.2) |
| 199 | `tedarikciler/[cari]/cari-strips.tsx:34` | info · `Strip` tonu | bkz. §6.2 | yerel yardımcı kalkar, yerine Notice (bkz. §6.2) |
| 200 | `tedarikciler/[cari]/cari-strips.tsx:35` | warn · `Strip` tonu | bkz. §6.2 | yerel yardımcı kalkar, yerine Notice (bkz. §6.2) |
| 201 | `tedarikciler/[cari]/cari-strips.tsx:41` | r-status · — | bkz. §6.2 | `Strip`'in kökü (`role="status"`): Strip kalkar, her şerit `Notice` (bkz. §6.2) |
| 202 | `tedarikciler/[cari]/debt-dialog.tsx:450` | warn · onay kutulu "Kaydı borca eşitle" | D | form içi onay bloğu |
| 203 | `tedarikciler/[cari]/debt-dialog.tsx:549` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 204 | `tedarikciler/[cari]/debt-dialog.tsx:560` | warn,r-status · `Warn` | bkz. §6.2 | yerel yardımcı kalkar, yerine Notice (bkz. §6.2) |
| 205 | `tedarikciler/[cari]/debt-dialog.tsx:603` | info · kasa denetimi fieldset | D (nötre) | form; zemin `bg-ink/[0.04]`, metin `text-ink-soft` |
| 206 | `tedarikciler/[cari]/entry-confirm.tsx:80` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 207 | `tedarikciler/[cari]/link-dialog.tsx:303` | warn,r-status · fatura öbür tedarikçide kalır | Notice warn·sm | metin aynı |
| 208 | `tedarikciler/[cari]/link-dialog.tsx:313` | warn,r-status · eski borç gider sayılmıyordu | Notice warn·sm risk=para | **"Eski borç gider sayılmıyordu; fatura gider sayılır"** · text "Gideri önceki aylarda başka yerde girildiyse (ör. Gelir-gider › DİĞER) orayı düzeltin, yoksa çift sayılır." |
| 209 | `tedarikciler/[cari]/link-dialog.tsx:322` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 210 | `tedarikciler/[cari]/supplier-client.tsx:115` | info · satır parlaması | D | – |
| 211 | `tedarikciler/[cari]/supplier-client.tsx:762` | bad · Sil | D | – |
| 212 | `tedarikciler/[cari]/supplier-client.tsx:783` | r-status · — | Notice neutral·md | {ad} listeden kaldırıldı · yeni faturası gelirse döner · [Listeye geri al] |
| 213 | `tedarikciler/[cari]/supplier-client.tsx:943` | r-status · — | Notice warn·md risk=para | Paraşüt'te ödenmiş {n} fatura panelde ödenmedi ({tutar}) · [Ödendi işaretle] |
| 214 | `tedarikciler/[cari]/supplier-client.tsx:1404` | r-status · — | Notice neutral·md | ({n.text} aynı) · [Sayfasına git] |
| 215 | `tedarikciler/[cari]/supplier-client.tsx:1512` | warn · IBAN girilmemiş (tam genişlik düğme) | Notice warn·sm | **"IBAN girilmemiş: ödeme talebinde gerekir"** · eylem "Ekle" (bugünkü `onEdit`) |
| 216 | `tedarikciler/card-dialog.tsx:268` | bad · Tedarikçiyi sil | D | – |
| 217 | `tedarikciler/card-dialog.tsx:286` | info · faturadan doldur | Notice neutral·sm | metin aynı · eylem "Faturadan doldur" |
| 218 | `tedarikciler/card-dialog.tsx:391` | warn,r-status · IBAN değişiyor (dolandırıcılık uyarısı) | Notice warn·sm risk=para | **"IBAN değişiyor: tedarikçiyi bildiğiniz numaradan arayıp teyit edin"** · text "E-postayla ya da mesajla gelen "IBAN'ımız değişti" bildirimi sık kullanılan bir dolandırıcılık yoludur. Değişiklik işlem geçmişine yazılır." (görünür; Ayrıntı'ya saklanmaz) |
| 219 | `tedarikciler/cari-payment-dialog.tsx:475` | warn · onay kutulu gider silinir | D | form içi onay bloğu |
| 220 | `tedarikciler/cari-payment-dialog.tsx:488` | warn · kasa satırı silinir / kalır | Notice warn·sm | metin aynı |
| 221 | `tedarikciler/cari-payment-dialog.tsx:560` | bad,r-alert · form hatası | Notice bad·sm live=assertive | – |
| 222 | `tedarikciler/cari-ui.tsx:30` | warn,r-alert · `PastConfirm` (onay kutulu, `role="alert"`) | D | form içi onay bloğu; rol kalır |
| 223 | `tedarikciler/payment-dialog.tsx:206` | r-status · — | D | küçük durum metni |
| 224 | `tedarikciler/request-dialog.tsx:189` | warn · iade faturası var | Notice warn·sm | **"Bu tedarikçinin iade faturası var"** · text "Ödenmedi duranlar seçili gelir; ötekiler daha önce düşülmediyse seçin." |
| 225 | `tedarikciler/request-dialog.tsx:251` | info,r-status · ödenecek tutar yok (mavi zeminde ⚠) | Notice warn·sm (talep oluşmaz) | **"Seçilen iadeler faturaları karşılıyor: ödenecek tutar yok"** · text "İadeyi ya da faturaları değiştirin." |
| 226 | `tedarikciler/request-dialog.tsx:258` | warn,r-status · IBAN girilmemiş | Notice warn·sm | **"IBAN girilmemiş: metinde "(girilmemiş)" yazar"** · eylem "IBAN'ı ekleyin" |
| 227 | `tedarikciler/suppliers-client.tsx:246` | info,r-status · kasadan ödeme hesaba işlenmedi | Notice warn·md (borç bakiyesi yanlış görünür) risk=para | **"Kasadan tedarikçiye {n} ödeme hesaba işlenmedi ({tutar})"** · eylem "İşle" |
| 228 | `tutarlilik/consistency-client.tsx:625` | warn,r-status · alım girilmeli | Notice warn·md | **"{n} malzemede alım girilmeli"** · text "{hepsi} Paraşüt'teki ürünlere bağlı ve bu ay faturası yok. Bu ay alınmadıysa tek dokunuşla 0 yazın." · eylem bugünkü |
| 229 | `tutarlilik/consistency-client.tsx:1048` | bad · Alımı sil | D | – |
| 230 | `tutarlilik/consistency-client.tsx:1108` | info · bu ay zaten girilmiş + onay kutusu | D (nötre) | form içi |
| 231 | `tutarlilik/consistency-client.tsx:1495` | bad · Sil | D | – |
| 232 | `tutarlilik/page.tsx:143` | warn · onay bekleyen zayi / ikram | Notice warn·md | **"Bu ay {n} zayi / ikram isteği onay bekliyor"** · eylem `NoticeLink` "Onaylar" |
| 233 | `tutarlilik/page.tsx:341` | warn,good · satış tutarlı / değil | Notice good / warn·md | metin aynı |
| 234 | `tutarlilik/page.tsx:393` | good · her şey yolunda | Notice good·md | metin aynı |
| 235 | `tutarlilik/page.tsx:476` | warn · online satır panel ürününe bağlı değil | Notice warn·md risk=para | **"{n} online satır panel ürününe bağlı değil: malzemesi tüketime girmedi"** · Ayrıntı liste |
| 236 | `tutarlilik/page.tsx:489` | good · bütün online satırlar bağlı | Notice good·sm | metin aynı |
| 237 | `urunler/[id]/price-history-card.tsx:92` | warn,r-status · kasada hâlâ eski fiyat | Notice warn·md | **"Kasada ({kasa}) hâlâ {eski}, panelde {yeni}"** · text `staleForText` · eylem bugünkü |
| 238 | `urunler/[id]/recipe-editor.tsx:720` | r-status · — | aynı öğe | 723. satırdaki kutunun rolü: 723'ün kararı geçerli |
| 239 | `urunler/[id]/recipe-editor.tsx:723` | warn,info · hammadde zammı | Notice (needsPrice ? warn : neutral)·md | metin aynı |
| 240 | `urunler/[id]/recipe-editor.tsx:1073` | info · parametre kodu çipi | D | – |
| 241 | `urunler/[id]/recipe-editor.tsx:1136` | bad · Ürünü sil | D | – |
| 242 | `urunler/[id]/recipe-editor.tsx:1260` | warn,r-alert · fiyat başka yerde değişti | Notice warn·sm live=assertive | **"Fiyat bu arada {yeni} oldu (kart açılınca {eski}): hangisi kalsın?"** · eylem iki düğme |
| 243 | `urunler/[id]/recipe-editor.tsx:1684` | warn,r-status · kaydedilmemiş değişiklik (kopya penceresi) | Notice warn·sm risk=veri | **"Kartta kaydedilmemiş değişiklik var"** · text "Kopyaya son kaydedilen reçete geçer; değişiklikler de geçsin istiyorsanız önce Vazgeç'e basıp kaydedin." |
| 244 | `urunler/[id]/site-menu-card.tsx:124` | warn · site bağlantısı kurulmamış | Notice (link ? warn : neutral)·sm | bağlıysa **"Site bağlantısı kurulmadı: fiyat ve menü durumu şimdi değiştirilemez"** · değilse **"Site bağlantısı kurulmadı: fiyat ve menü durumu yalnız panelde"** · Ayrıntı teknik (`KARAOKE_SYNC_SECRET`, "anahtarı ekleyin ya da bağlantıyı kaldırın") |
| 245 | `urunler/[id]/site-menu-card.tsx:146` | bad,r-alert · bağlantı kopuk | Notice bad·sm | **"Bağlantı kopuk: {ad} sitede tek boy"** · text "Fiyat ve menü durumu değiştirilemez; bağlantıyı kaldırın ya da kalemin tek fiyatına bağlayın." |
| 246 | `urunler/[id]/site-menu-card.tsx:151` | warn,r-status · kalem sitenin listesinde yok | Notice warn·sm | **"{id} sitenin son listesinde yok"** · text "Sonraki eşitlemede bağlantı kaldırılır; fiyat ve durum kalır." |
| 247 | `urunler/[id]/site-menu-card.tsx:163` | bad · Bağlantıyı kaldır | D | – |
| 248 | `urunler/fiyatlar/bulk-editor.tsx:463` | r-status · — | D | boş önizleme (uyarı değil) |
| 249 | `urunler/fiyatlar/bulk-editor.tsx:946` | bad · değişmeyen ürünler | Notice bad·md | **"{n} ürün {değişmedi / geri alınamadı}"** · text liste (görünür) |
| 250 | `urunler/page.tsx:163` | warn · "Kasa N" rozeti (Fiyatlar düğmesinde) | D | rozet |
| 251 | `urunler/price-impact-panel.tsx:192` | good · etkilenen ürünler hedefte | Notice good·md | metin aynı |
| 252 | `urunler/products-table.tsx:911` | info,r-status · arama yalnız pasiflerle eşleşti | Notice neutral·sm | metin aynı |
| 253 | `urunler/site-link-dialog.tsx:191` | bad,r-alert · yükleme hatası + Tekrar dene | Notice bad·sm live=assertive | eylem "Tekrar dene" |
| 254 | `urunler/site-link-dialog.tsx:268` | warn,r-status · fiyat başka ürüne bağlı | Notice warn·sm | metin aynı |
| 255 | `urunler/site/site-menu-matching.tsx:231` | bad · Kaldır | D | – |
| 256 | `urunler/site/site-menu-matching.tsx:245` | info,r-status · site menüsü alınmadı | Notice neutral·md | **"Sitenin menüsü henüz alınmadı"** · text "Sağdaki "Siteyle eşitle" ile listeyi alın; öneriler ondan sonra görünür." |
| 257 | `urunler/site/site-menu-matching.tsx:381` | bad · Kaldır | D | – |
| 258 | `urunler/site/site-menu-matching.tsx:562` | bad · son hata | Notice bad·sm | metin aynı |
| 259 | `urunler/site/site-menu-matching.tsx:578` | warn · silindiği için bağlantısı kaldırılanlar (`<details>`) | Notice warn·sm | **"Sitede silindiği için bağlantısı kaldırılanlar ({n})"** · Ayrıntı liste |
| 260 | `urunler/site/site-new-product.tsx:211` | warn · kalem sitede Tükendi (turuncu zeminde ⓘ) | Notice neutral·sm | metin aynı |
| 261 | `urunler/site/site-new-product.tsx:217` | info · önerilen ürün var | Notice neutral·sm | metin aynı |
| 262 | `vergi/adjustment-dialog.tsx:223` | warn · düzeltme uyarıları | Notice warn·sm | ilk uyarı başlık, kalanı text |
| 263 | `vergi/gelir-gider/classify-list.tsx:172` | warn · belgesi olmayan giderler notu | Notice warn·md risk=hukuk | metin aynı |
| 264 | `vergi/gelir-gider/classify-list.tsx:189` | warn · kaydedilmemiş satır zemini | D | – |
| 265 | `vergi/page.tsx:107` | r-note · — | Notice warn·sm risk=para | Özet'in uyarıları (K4 tutar farkı, faturası silinen demirbaş): ilk uyarı başlık, kalanı Ayrıntı (metin aynı) · eylem varsa `NoticeLink` "Demirbaş'ı aç" → /panel/vergi/demirbas. `role="note"` kutusu ve `NoteList tone="warn"` kalkar |
| 266 | `vergi/ui.tsx:57` | lime/25 · "gözden geçirildi" çipi | D | çip |
| 267 | `vergi/ui.tsx:73` | r-note · — | bkz. §7.4 | `TaxBanner` kutusuz tek satıra iner (bkz. §7.4); `role="note"` satırda kalır |
| 268 | `zayi/page.tsx:185` | warn · bu gün istek onay bekliyor | Notice warn·md | **"Bu gün {n} istek onay bekliyor"** · eylem `NoticeLink` "Onaylar" |
| 269 | `zayi/waste-board.tsx:219` | info · LafPOS notu | Notice neutral·sm | metin aynı |
| 270 | `zayi/waste-board.tsx:221` | info · LafPOS ikram notu | Notice neutral·sm | metin aynı |
| 271 | `c/panel/command-palette.tsx:416` | r-status · — | D | sonuç yok durumu |
| 272 | `c/panel/confirm-password-dialog.tsx:81` | warn,r-status · parola penceresi notu | Notice warn·sm | metin aynı |
| 273 | `c/panel/error-view.tsx:32` | r-alert · sayfa hatası (`role="alert"`) | D | sayfa hata görünümü, ayrı desen |
| 274 | `c/panel/error-view.tsx:33` | bad · hata ikon karosu | D | – |
| 275 | `c/panel/live/alert-center.tsx:489` | r-alert · karaoke süresi doldu (sabit kırmızı) | D | barın "Şimdi" alarmı |
| 276 | `c/panel/live/device-alerts.tsx:137` | bad · U5 | Notice → §6.1 | bkz. §6.1 (U5) |
| 277 | `c/panel/live/output-picker.tsx:122` | warn · hoparlör uyarısı | Notice warn·sm | metin aynı |
| 278 | `c/panel/notifications.tsx:218` | r-alert · zil okunamadı | D | zil panelinin kendi satırı (ikonu `TONE_ICON.bad`) |
| 279 | `c/panel/photo-picker.tsx:114` | r-alert · satır içi hata | D | kutusuz tek satır |
| 280 | `c/panel/photo-picker.tsx:134` | r-alert · okuma hatası + Yeniden dene | D | kutusuz tek satır |
| 281 | `c/panel/recipe-diff.tsx:12` | bad · çıkarılan satır | D | diff |
| 282 | `c/panel/recipe-diff.tsx:13` | warn · değişen satır | D | diff |
| 283 | `c/ui/badge.tsx:10` | lime/25 · — | D | rozet tonu (Badge green) |
| 284 | `c/ui/badge.tsx:11` | warn · — | D | rozet tonu (Badge amber) |
| 285 | `c/ui/badge.tsx:12` | bad · — | D | rozet tonu (Badge red) |
| 286 | `c/ui/badge.tsx:13` | info · — | D | rozet tonu (Badge blue) |
| 287 | `c/ui/button.tsx:80` | bad · `IconButton tone="danger"` | D | – |
| 288 | `c/ui/form.tsx:12` | warn,bad · — | D | alanın kendi geçersiz / uyarı durumu (Field), kutu değil |
| 289 | `c/ui/misc.tsx:35` | r-status · — | D | EmptyState kendi rolü |
| 290 | `c/ui/misc.tsx:90` | bad · `GrowthPill` | D | – |

---

## Ek B. Kontrol (bu belgenin kendi denetimi, 29 Eki 2026)

Belge yazıldıktan sonra main @ 1947c7c'ye karşı (`ux/main-src/`) aşağıdakiler tek tek arandı. "Doğrulandı" = kodda ya
da testte görüldü; "varsayım" = uygulayan ölçerek kapatır.

**Uyarı kapsamı (her uyarı yeni bileşende).**
- `bg-(warn|bad|info|good)-soft`, `bg-lime/25`, `role="alert|status|note"` deseni `src/` altında (akmanos hariç) **290
  konum**; hepsi Ek A'da (B'nin tablosu 258, A'nınki 284 konumu kapsıyordu; ikisinde de olmayan 6 konum elle karara
  bağlandı: `form.tsx:12`, `badge.tsx:10-13`, `cari-strips.tsx:41`, `vergi/ui.tsx:73`, `sales-client.tsx:401/523`,
  `recipe-editor.tsx:720`, `vergi/page.tsx:107`). Eski satır numaraları main'e `difflib` ile taşındı (`locs.py`).
- Renk sınıfı olmayan uyarılar ayrıca arandı: `<TriangleAlert|AlertTriangle|CircleAlert|AlertCircle` JSX'i **72 yer**:
  hepsi ya Ek A'nın dosyalarında, ya §6.2-§6.3 listelerinde, ya bekçinin izin listesinde (`ui/info-tip.tsx`,
  `panel/error-view.tsx`, §4.7'deki dört başlık ikonu), ya panel dışında (`src/app/davet/problem.tsx:38`,
  `giris/auth-ui.tsx`, `baglan/consent-form.tsx`: panel kabuğu dışı, **D**; bekçinin kapsamı `src/app/panel` ve
  `src/components/panel`).
- `InfoTip tone="warn"`: 2 yer (`pnl-grid.tsx:344` kalır, `vergi/ui.tsx:91` bantla kalkar). `toast.warning`: 31 yer,
  bilerek dokunulmaz (§4.4). `text-warn` / `text-bad` satır içi renkli söz 95 dosyada: sayaç, durum sözü, eksi tutar;
  kutu değil, dokunulmaz; yalnız ⚠ cümleleri (§6.3) `Notice size="line"` olur.
- Gri bilgi kutuları (renk sınıfsız) `rounded-* bg-panel|bg-surface` + uyarı sözcüğü aranarak bulundu (§6.5): durum /
  ret söyleyenler `Notice`'e, önizleme ve boş durum olduğu gibi.
- Geliştirici sözcükleri (`Vercel`, `openssl`, `docs/`, `*_SECRET`, `*_API_KEY`) `src/app/panel` ve
  `src/components/panel` gövdelerinde 8 dosyada; hepsi §6.4'te `tech`'e taşınanlar listesinde ya da izinli evde
  (Ayarlar, Paraşüt, Yardım).

**Sabitlenmiş testler.** Satır satır okundu: `kenar-cubugu` (116-117, 119-138, 152, 175, 182-188, 237-249; personel
anahattı 148-164 dokunulmaz), `mobile-nav` (11-21, 115-153; 23-45 ve 74-87 dokunulmaz), `yardim` (18-19, 31, 36-37,
44, 50-53, 111-112), `roller` (66-67), `vergi-eylemler` (363, 378, 385), `vergi-kaynak` (41-58 aynen geçer: dört
sayfada `<TaxBanner data={banner} />`, `ui.tsx`'te `{TAX_DISCLAIMER}` (`DisclaimerBody`'de), `{TAX_DISCLAIMER_SHORT}`,
`role="note"`; 105 ve 271 güncellenir), `vergi-takvim` (satır listesi 204-219 **aynen**: `titleOfKind` değişmez, sade ad
çizimde; 232, 404, 409 aynen: `note` `null` kalır, not metni sabite alınır; 259 "Hazırlık" aynen: hesap sürer; 267
güncellenir; 277 ve 296 kart başlıkları aynen: veri değişmez), `vergi-kurumlar:159`, `vergi-muhtasar:58` (aynen),
`arayuz-duzeltmeleri:70` (öz denetimde bulundu: parola penceresinin `role="status"` notu Ek A 272'de `Notice` olur,
regex güncellenir), `siparis-planli:98` (aynen: satır içi renk). Belgeyi okuyan testler (`ayni-rakam:375`,
`lafpos:522`, `predeploy:144`, `veritabani-baglanti:672-678`) için kural: belgeye ekle, aranan cümleyi silme. "Bu
ayın işleri" başlığını doğrulayan test yok (yalnız yorumlar).

**Personelin ağacı.** Yeni ya da yeniden adlanan bütün düğümler (`fiyatlar`, `nakit`, `vergi` grubu ve alt öğeleri,
`finans` adı, `giderler` adı) `roles: ["admin"]`; personelin dokuz düğümü (`bugun, karaoke, kasa, kontrol,
ozel-gunler, menu, stok, hatirlaticilarim, yardim-personel`) aynı göreli sırada, `menu`'nün personeldeki tek alt öğesi
Reçete defteri, ikon `Coffee` aynı. `BOTTOM_NAV.staff`, `STAFF_PATHS`, personel paleti ve Yardım'ı değişmez.
Personelin gördüğü yalnız azalır: yüzen hap (Y1), fiyat kaynaklı ürün notu (§9 #23), karaoke bağlantı satırı (U7).
`tech` personel dalında verilmez (bekçi). `sales-source`, `glossary`, `overdue` personel dosyalarına girmez.

**Adresler.** `page.tsx` ve `route.ts` eklenmez, silinmez, taşınmaz. Yeni çapalar §3.7'de (`#kdv`, `#sgk`, `#muhtasar`
Vergi'de; `#kar-vergisi`, `#kurallar`, `#feragat`, `#sgk-oranlari`, `#kar-zarar`, `#baglanti`). Var olduğu kodda
görülenler: `#oranlar`, `#gecmis` (`ayarlar/settings-client.tsx`), `#yedek` (`ayarlar/page.tsx`), `#lafpos`
(`ayarlar/lafpos-card.tsx`), `#sorular`, `#bilgi` (`vergi/kurallar`), `#siniflandir` (`classify-list.tsx`),
`#kdv-beyannamesi`, `#kdv` (Nakit planı `vat-card.tsx`), `#urun-baglantilari` (`parasut/breakdowns.ts`), `#baslarken`
ve `#gecici` (`tax-cards.tsx`, kalır). Kapalı kap içine atlayan çapa: Ayarlar akordeonu (var olan `section-card.tsx`
deseni), `#sgk-oranlari` ve `#kurallar` (aynı desenle açılır); `#bilgi` bilerek açık bırakıldı; `#baglanti` karaoke
kartı katlanmaz (`karaoke-admin.tsx:136`).

**Uyarı koşulları.** Hiçbir uyarının görünme koşulu değişmez; istisnalar ve önemi değişenler §2'de tek listede (hepsi
ekleme ya da önem düzeltmesi, hiçbiri gizleme). `src/lib/calc/insights.ts` değişmez; önem düzeltmesi görünüm
katmanında (`alertTone`). Vergi'nin "en az / en çok", "Eksik bilgi" sebepleri, kapsam uyarısı, "muhasebecinin rakamı
girilmedi", K4 tutar farkı, faturası silinen demirbaş, bayat kurallar ve SGK oranı farkı görünür kalır (§7).

**Bağımlılık, ikon, kontrast.** Yeni paket yok. Kullanılan ikonlar kurulu `lucide-react` 1.59.0'da var (denendi):
`Scale, FileWarning, History, HardDriveDownload, Landmark, CircleDashed, LayoutGrid, CircleAlert, TriangleAlert, Info,
CircleCheck, ListChecks, Circle, ChevronDown, Percent, Users, Receipt, Package, BookOpen, Plug, Wallet, UserRound,
CalendarRange, BellRing, ChartNoAxesColumn, Coffee, ClipboardList`. Kontrast oranları §4.2'de hesaplandı (13 px metin
için hepsi ≥ 4,5:1; `--color-ink-mute` `#6b6b74`).

**Metin.** §8'deki yeni açıklamaların hepsi ≤ 87 harf (betikle sayıldı). Sade ad tablosu (§7.11) tek kaynakta;
resmî ad Excel dışa aktarımında kalır.

**Hakem kararlarıyla eşleşme.** Alınan (A'dan): kapalı kenar çubuğunda görünen vergi grubu (K3), `risk` + `foldPlan`
(K10), `--color-bad-ink` / `--color-warn-ink`, Vergi sadeleştirmeleri (§7), ağaçtan bağlam satırı, `activeChildOf`,
geliştirici sözcüğü bekçisi, telefon bütçeleri. B'nin tabanı: 4 tonlu `Notice`, grup kimlikleri ve satır sayısı, tek
alt öğeli "Giderler & maaşlar" (K4). Bırakılan: grup altı ipucu (K8), Komisyon'un yeniden adı (K9), `localStorage`
kapatma ve 14 günlük not (K10), satırda "Ödedim", `VatCarryDialog` taşıması, kırmızı geçmiş grup ve ay ay gruplama
(K12, K13), kopyala / paylaş (K21), `src/lib/calc` ve `src/server/actions` değişikliği (K11).

**Açık kalan (uygulayan ölçerek kapatır).**
1. §13'teki "sonra" hedefleri tahmindir; ölçü yöntemi aynı araçla (`collect.cjs` + `[data-notice]`).
2. `kdv1:2026-09`'un `carryOut` değeri (test koşulunca yazılır).
3. `ux/tools/*.cjs` anket worktree'si için yazıldı (port, oturum dosyaları); yeni worktree'de yol ve port ayarı gerekir.
4. `ProfitTaxCard`'ın masaüstünde sağ sütuna sığması (bugünkü iki kartın toplam yüksekliğinden kısa olmalı; görüntüyle
   doğrulanır).
5. Bölüm 1'de `#kar-vergisi` geçici olarak sağ sütunun sarmalayıcısında; Bölüm 3'te karta taşınır (ara commit'te ⌘K
   kaydı doğru yere iner).

---

## Ek C. Uygulama notları (belgeyle karar arasında kalan, gerekçesiyle)

Uygulayan yeniden karar vermez; aşağıdakiler belgenin iki maddesi çatıştığı ya da sustuğu yerde en yakın kararın
gerekçesiyle seçildi. Her biri PR gövdesine de yazılır.

**Bölüm 1 (29 Eki 2026)**

1. **`tests/yardim-personel.test.ts`'in `GENERIC` kümesine "KDV" eklendi** (§2 ve §12 bu testi "dokunulmadan yeşil"
   ister). Neden: §3.4'ün palet kaydı "KDV" (`/panel/vergi#kdv`, yalnız yönetici) testin "yöneticinin ekran adları
   personelin Yardım'ında yok" denetimine ad olarak girdi; personelin Yardım'ı ise Z raporu fişinin "KDV dökümü"
   satırını anlatır (K19: o metin değişmez). "KDV" bir ekran adı değil, vergi türünün adı; test "Kafe" ve "Satış" için
   aynı istisnayı zaten tanıyor. Personelin Yardım'ı, ağacı, alt menüsü ve paleti bayt bayt aynı; testin geri kalanı
   değişmedi.
2. **Nakit planı başlığındaki "Ödemeler" düğmesi de kalktı** (K7 yalnız Ödemeler'deki "Nakit planı" düğmesini anar).
   Neden: K7'nin gerekçesi ("sekme aynı işi görüyor") iki yönde de geçerli; `odeme` sekmesi iki sayfada da "Ödemeler"
   ve "Nakit planı"nı gösterir. Boş plan durumundaki "Ödemelere git" düğmesi kalır.
3. **Karaoke ve Hatırlatıcılarım başlıkları `Suspense`'in içine alındı** (yükleme iskeletinde `role="staff"`, yüklenince
   `role={user.role}`). Neden: başlık `Suspense`'in dışındaydı, rolü bilmiyordu; §3.8 iki rolün açtığı sayfada
   kullanıcının rolünü ister. Yöneticide bağlam satırı ("Kafe") içerik gelince çizilir (yalnız masaüstü; telefonda
   bağlam satırı yok). Sayım, Zayi, Kontrol listeleri ve Reçete defteri aynı deseni zaten izliyordu.
4. **`reminder-sheet.tsx:255`'teki ikinci eski ad da düzeldi** ("Giderler & personel sayfasındaki sabit giderler" →
   "Giderler & maaşlar › Sabit giderler sayfasındaki giderler"); §3.10 aynı dosyanın 561. satırını anıyordu.
5. **Sabah e-postasının dört şablon özeti (`tests/hatirlaticilar-digest.test.ts`) yenilendi**: §3.10'un altbilgi metni
   ("Ödemeler sayfasından") şablonun bayt özetini değiştirir; testte eski altbilgiyle dört özetin eskisiyle aynı olduğu
   denetlendi, yalnız değerler yazıldı.
6. **`tests/sayfa-basligi.test.ts`'in açıklama uzunluğu denetimi (≤ 100 harf, §3.11) Bölüm 3'te eklenir.** Neden: §11
   açıklama metinlerini Bölüm 3'e bırakır ("Açıklama metinleri Bölüm 3'te"); bugünkü açıklamaların çoğu 100 harfi aşar,
   denetim Bölüm 1'de eklense her bölümün kendi sonunda yeşil olması (§11) bozulurdu. Testin öbür dört denetimi (elle
   bağlam ve Excel yok, her başlıkta `path`, bir ekran bir ad, paletin kare adresleri var olan çapaya iner) Bölüm 1'de.
7. **Çapalı adresler sayfa akınca iner: `HashScroll` ortak bileşen oldu ve takvim listesi `overflow-clip`.** §3.7'nin
   çapaları tarayıcıda ölçüldü (§14): ⌘K başka sayfadan açınca Next kaydırmayı sayfa sunucudan akmadan yapabiliyor;
   `#sgk`, `#muhtasar` ve `#siniflandir` kimi açılışta hedefe inmedi (hedef henüz yoktu). Komisyon'daki `HashScroll`
   (içerik çizilince bir kez kaydırır) `src/components/panel/hash-scroll.tsx`'e taşındı; ⌘K'nın kare adresli
   kayıtlarının açtığı her sayfanın akan içeriğinde var (Vergi Özet, Vergi kârı, Muhasebeci, Gelir-gider, Paraşüt; Nakit
   planı `#kdv` için de) ya da bölüm kendi hash dinleyicisini taşıyor (Maaşlar'ın SGK oranları, Ayarlar'ın bölümleri);
   `tests/sayfa-basligi.test.ts` tutar. Takvimin `<ul>`'u `overflow-hidden` yerine `overflow-clip`: hidden bir kaydırma
   kabı olduğu için Chrome ilk satırın `scroll-mt-20` payını kırpıyor, `#sgk` (ilk satır) telefonun üst çubuğunun
   altında kalıyordu; köşeler aynı.

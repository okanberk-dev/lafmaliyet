# Öneri 13 · "Bugün" ekranı ve telefonda alt menüde Kasa

## 1. Amaç

Yönetici ve personel, panel açıldığında "bugün ne yapmam gerekiyor, ne bitti" sorusunun cevabını tek ekranda görür.
Yeni ekran **Bugün** (`/panel/bugun`) şu anki kaynaklardan günün işlerini ve her birinin durumunu toplar: kasa raporu
(bugün ve dün), zayi / ikram, ay sonu stok sayımı ve kişinin kendi hatırlatıcıları. Yöneticiye ayrıca ödemeler (geciken /
bugün), fatura kontrolü ve Paraşüt eşitlemesi, hammaddeye bağlanmayı bekleyen ürünler, reçete onayları ve hammadde zammı
gösterilir. Bunun yanında bugünün karaoke rezervasyonları ve açık uygulama siparişleri de görünür. Her satır ilgili
ekranın doğru yerine götürür. Ekranda yeni bir yazma eylemi yok: hatırlatıcıyı tamamlamak ve ödemeyi "Ödendi" yapmak
var olan sunucu eylemleriyle yapılır. Telefonun alt menüsü iki rol için de yeniden düzenlenir. Yöneticinin çubuğuna
**Bugün** ve **Kasa** girer; personelin çubuğuna **Bugün** girer ve personel girişte Bugün ekranında açılır. Çubuk yine
beş öğedir. Ayda bir kullanılan ekranlar (Satışlar, Faturalar, personelde Sayım) çekmeceye geçer ve gerektiği gün Bugün
ekranında satır olarak görünür.

Şema değişikliği, yeni bağımlılık ve yeni sunucu eylemi yok.

## 2. Kullanıcının gördüğü

### 2.1 Gezinme

| | Şimdi | Sonra |
|---|---|---|
| Yönetici alt menü | Genel bakış · Satışlar · Faturalar · Ödemeler (rozet) · Menü | **Genel bakış · Bugün · Kasa · Ödemeler (rozet) · Menü** |
| Personel alt menü | Karaoke · Kasa · Zayi · Sayım · Reçeteler | **Bugün · Karaoke · Kasa · Zayi · Reçeteler** |
| Personelin girişte açılan ekranı (`STAFF_HOME`) | `/panel/sayim` | **`/panel/bugun`** |
| Yöneticinin ana sayfası (`homeFor("admin")`) | `/panel` | `/panel` (değişmez, bkz. 9. bölümdeki karar 1) |
| Kenar çubuğu ağacı (`NAV_TREE`) | — | Genel bakış'ın hemen altında **Bugün** (iki rol). Personelde ağacın ilk öğesi |
| ⌘K paleti (yönetici) | — | "Bugün" ekranı ("bugün yapılacaklar günün işleri" sözcükleriyle bulunur) |
| Telefonun üst çubuk başlığı | — | "Bugün" |

- Beş öğe sınırı korunur: 390 px'te hücre başına 78 px düşer, "Genel bakış" 11 px yazıyla sığar (`truncate` yedek
  olarak zaten var).
- Yöneticide Satışlar (ayda bir yükleme) ve Faturalar (Paraşüt her sabah getirir; kontrol bekleyenler Bugün'de satır
  olarak görünür) çubuktan çıkar, çekmece (Menü) ve ⌘K'da kalır. Ödemeler'in gecikmiş rozeti olduğu gibi kalır.
- Personelde Sayım ayda bir yapıldığı için çubuktan çıkar. Ay sonunda Bugün'de "Ay sonu stok sayımı" satırı olarak
  çıkar ve üst çubuktaki menü düğmesiyle açılan çekmecede kalır.
- Bugün öğesinde rozet yok. Zil zaten okunmamışları sayıyor, iki rozet aynı şeyi söylemesin (karar 6).

### 2.2 Bugün ekranı (`/panel/bugun`)

`PageHeader`: eyebrow "Günlük", title "Bugün", description `"{22 Ekim Çarşamba} · {başlık}"`. Başlık şunlardan biridir:

- `"3 iş bekliyor (1 sorun)"`: açık iş varsa; sorun yoksa parantez yazılmaz.
- `"Şimdilik iş yok · 2 iş sonra"`: yalnız "sonra" durumunda iş varsa.
- `"Bugünün işleri tamam"`.
- Gecikmiş ya da bugünkü hatırlatıcı varsa sona `" · 2 hatırlatıcı"` eklenir.

Gece 05:00'ten önce iş günü dündür (`businessDate`). Bu durumda kasa ve zayi satırlarının açıklaması tarihle başlar
("21 Ekim Salı · …"), başlıktaki tarih takvim günüdür.

**Telefonda (390 px) sıra, tek sütun:**

1. **Yapılacaklar kartı.** `Card` + `CardHeader`: ikon `ListTodo`, başlık "Yapılacaklar", `meta`'da durum çizgileri ve
   "2 / 5 tamam" ("Bu ayın işleri" kartındaki şeritle aynı). Kartın içinde üç bölüm var:
   - **Şimdi** (sorunlu ve yapılacak işler): her satır bütünüyle bir `Link`. Solda durum kuyusu (ikon ve renk Genel
     bakış'taki kontrol listesiyle aynı), başlık, sağda `Badge`, altında bir iki satırlık açıklama, en altta eylem
     ("Raporu gir →"). İlk sorunlu iş, yoksa ilk yapılacak iş **sıradaki** sayılır: siyah çerçeve ve siyah hap
     ("Sıradaki: Raporu gir →"). Telefonda bu hap 44 px yüksekliğindedir. Bölüm boşsa yazılmaz.
   - **Sonra** (henüz zamanı gelmemiş, gri): rozet satırın kendi sözcüğüdür ("Akşam", "Gün içinde").
   - **Tamamlananlar (n)**: kapalı `<details>` (özet satırı en az 44 px). İçinde yeşil satırlar.
   - Kartın altında soluk bir bağlantı durur, yalnız yöneticide: "Bu ayın işleri Genel bakış'ta →" (`/panel`).
2. **Hatırlatıcılarım kartı** (iki rol). İkon `AlarmClock`, başlık "Hatırlatıcılarım", açıklama "Geciken ve bugünkü".
   Sağda `ButtonLink` "Tümü" bulunur, en çok 6 satır gösterilir, fazlası varsa "Tümü (14)" yazar. Her satırda solda
   44 px yuvarlak ✓ düğmesi (`aria-label="{başlık} tamamlandı"`), başlık, "Bugün 15:00" / "Gecikti · Dün" rozeti ve not
   (tek satır, `truncate`) bulunur. Dokununca satır hemen kaybolur (`useOptimistic`) ve "… tamamlandı" ya da tekrar
   edenlerde "…: sıradaki 23.10" bildirimi çıkar. Bildirimde "Geri al" vardır. Boşken tek satır: "Bugün için
   hatırlatıcınız yok." + `ButtonLink` (ghost, sm) "Hatırlatıcı ekle" → `/panel/hatirlaticilarim`.
3. **Yaklaşan ödemeler** (yalnız yönetici): var olan `DashboardPayments` bileşeni olduğu gibi kullanılır (geciken ve 7
   gün içindekiler, tek dokunuşla "Ödendi", 8 sn geri al). Gösterilecek ödeme yoksa bileşen kendini çizmez.
4. **Bugün kafede kartı** (iki rol). İkon `MicVocal`, başlık "Bugün kafede", sağda `ButtonLink` "Bar ekranı" →
   `/panel/karaoke`. `ActivityList` satırları:
   - Karaoke (oturum varsa): "Oda dolu · bitiş 22:15" ya da "Süre doldu: odaya haber verin".
   - Karaoke (her zaman): "Bugün 3 rezervasyon · 1 rezervasyonsuz" ya da "Bugün karaoke rezervasyonu yok".
   - Karaoke (sıradaki varsa): "Sıradaki 20:00 · 4 kişi · Ayşe".
   - Uygulama siparişi: "2 açık uygulama siparişi". Yalnız bağlantı kuruluysa ve son liste 30 dakikadan yeniyse
     gösterilir.
   - Kartın tamamı yalnız şu durumda gizlenir: laffogato.net bağlantısı kurulu değil, bugün oturum yok ve açık sipariş
     yok.
   - Tutar hiçbir rolde gösterilmez (README: karaoke tutarı personele gösterilmez; burada yöneticiye de gerekmiyor).

**Geniş ekranda (xl ve üstü)** `grid xl:grid-cols-[minmax(0,1fr)_360px]` kullanılır (Kasa sayfasının düzeni): solda
Yapılacaklar, sağda Hatırlatıcılarım, Yaklaşan ödemeler ve Bugün kafede alt alta. lg'de kenar çubuğuyla içerik yaklaşık
750 px kaldığı için tek sütun.

`Suspense` geri dönüşü: `PageHeader` (eyebrow "Günlük", title "Bugün", description "Yükleniyor…") + `PageSkeleton rows={6}`.

Bugün ekranında pencere (dialog) yok; "Ödendi" ve "Tamamlandı" yalnız bildirim (toast) açar. Bu yüzden "pencere
gezinmeden önce kapanmalı" kuralı burada sorun çıkarmaz. Kapalı `<details>`'in açık kalması Activity ile korunur;
bu istenen davranıştır.

### 2.3 Satırlar ve kuralları (Türkçe metinler kesin)

Kısaltmalar: `day` = `businessDate(now)` (05:00'te döner), `yesterday` = `addDays(day, -1)`, `today` = `todayTR(now)`,
`evening` = `isCashEvening(now)` (Türkiye saatiyle 20:00 ve sonrası ya da 05:00'ten önce). Durumlar `TaskStatus` ile
aynı: `done` / `todo` / `warn` / `later`. Rozet verilmezse durumun kendi adı yazılır: Tamam / Yapılacak / Sorun var /
Sonra.

**Sıra:**

- Yönetici: kasa-dun, odeme, fatura, urun, onay, zam, sayim-gecen, kasa, sayim-son.
- Personel: kasa-dun, sayim-gecen, zayi, kasa, sayim-son.

Ekranda satırlar Şimdi / Sonra / Tamam bölümlerine ayrılır, her bölümün içinde bu sıra korunur.

| Anahtar | Rol | Kural → durum, başlık, rozet, açıklama, adres, eylem |
|---|---|---|
| `kasa-dun` | Yönetici | Kasa okunamadı → `later`, "Dünkü kasa raporu", rozet "Okunamadı", "Kasa raporları şu an okunamadı.", `/panel/kasa`, "Kasa raporu". Dün raporu var: fark eksikse `warn`, fazlaysa `todo`, tutuyorsa `done`. Rozet = `diffText(cashDiff)` ("120 ₺ eksik", "30 ₺ fazla", "Kasa tutuyor"). Açıklama: `"{ad} · Z {money(zTotal)} · nakit {money(cash)} · kart {money(card)}"` + revizyon > 1 ise `" · güncellendi"` + not varsa `" · Not: {not}"`. Adres `/panel/kasa?gun={yesterday}`, eylem "Rapora bak". Rapor yok ve (hiç rapor yok ya da `yesterday < ilk rapor günü`) → satır yok. Rapor yok, öbür durum → `todo`, rozet "Girilmedi", `"{longDateTR(yesterday)} raporu girilmedi. Kafe açıktıysa personel bugün de girebilir; daha sonra yalnız siz girersiniz."`, `/panel/kasa?gun={yesterday}`, "Raporu gir" |
| `kasa-dun` | Personel | Yalnız dün raporu yoksa ve yukarıdaki "ilk rapor" kuralı tutuyorsa: `todo`, "Dünkü kasa raporu", rozet "Girilmedi", `"{longDateTR(yesterday)} raporu girilmedi. Kafe açıktıysa bugün girin; yarın yalnız yönetici girebilir."`, `/panel/kasa?gun={yesterday}`, "Dünü gir" |
| `odeme` | Yönetici | Liste okunamadı → `later`, "Ödemeler", "Okunamadı", "Ödeme listesi şu an okunamadı.", `/panel/hatirlaticilar`, "Ödemeler". Geciken var → `warn`, rozet "{n} gecikti", `"{n} ödeme gecikti ({money}). Ödendiyse işaretleyin."` + bugün olan varsa `" Bugün: {m} ({money})."`, eylem "Ödemelere bak". Bugün olan var → `todo`, rozet "Bugün", `"{m} ödeme bugün ({money}): {ilk iki başlık}{…}"`. Hiçbiri yok → `done`, `"Bugün ödenecek yok."` + yaklaşan varsa `" Yaklaşan {k} ödeme ({money})."` Adres her durumda `/panel/hatirlaticilar` |
| `fatura` | Yönetici | Son günlük eşitleme (`trigger ≠ "history"`) hatalı ve 48 saatten yeni → `warn`, "Faturalar", rozet "Eşitleme hatası", `"Paraşüt eşitlemesi {dateTimeTR} hata verdi; yeni faturalar gelmemiş olabilir."` + kontrol bekleyen varsa `" {n} fatura da kontrol bekliyor."`, `/panel/parasut`, "Paraşüt'e bak". Kontrol bekleyen var → `todo`, rozet "{n} kontrol", `"{n} fatura kontrol bekliyor: kategorisi tahminle yazıldı, doğruysa tek dokunuşla onaylayın."`, `/panel/faturalar?durum=kontrol`, "Kontrol et". Hiçbiri yok → `done`, Paraşüt bağlıysa `"Kontrol bekleyen fatura yok · son eşitleme {dateTimeTR(lastOkAt)}."`, değilse `"Kontrol bekleyen fatura yok."`, `/panel/faturalar`, "Faturalar" |
| `urun` | Yönetici | Yalnız sayı > 0 ise: `todo`, "Ürün bağlantıları", rozet "{n} bekliyor", `"{n} fatura ürünü hammaddeye bağlanmayı bekliyor; bir kez bağlanınca fiyat ve miktar sonraki faturalardan kendiliğinden gelir."`, `/panel/parasut?durum=bekleyen`, "Bağla" |
| `onay` | Yönetici | Yalnız sayı > 0 ise: `todo`, "Reçete onayları", rozet "{n} bekliyor", `"Personelin önerdiği {n} değişiklik onay bekliyor: {en çok 3 ürün adı}{…}"`, `/panel/onaylar`, "İncele" |
| `zam` | Yönetici | Yalnız `priceAlert(...)` boş değilse: `todo`, "Hammadde zammı", rozet "{actionable} ürün", açıklama `priceAlert.detail`, adres `priceAlert.href` (`/panel/urunler#zamlar`), "Fiyatlara bak" |
| `sayim-gecen` | İkisi | Ayın 1–10. günü (`COUNT_GRACE_DAYS`) ve geçen ayın sayımı yoksa (`stock_counts` ya da `stock_extras`'ta o ay için satır yok; `stockSheet().hasData` ile aynı kural): `todo`, "Geçen ayın stok sayımı", rozet "Girilmedi", `/panel/sayim?ay={prev}`, "Sayım gir". Açıklama yöneticide `"{monthLabel(prev)} sayımı yok: devreden stok 0 sayılır, alınan malın tamamı o ayın maliyeti olur."`, personelde `"{monthLabel(prev)} ay sonu sayımı girilmedi; bu ekrandan girebilirsiniz."` |
| `zayi` | Personel | Kayıtlar okunamadı → satır yok. Bugünün kasa raporu gönderildi → `done`: n > 0 ise `"{n} kayıt · {özet}"`, değilse `"Bugün kayıt yok."` Akşam ve rapor yok → `todo`, rozet "Rapordan önce": n > 0 ise `"{n} kayıt · {özet}. Eksik varsa kasa raporundan önce ekleyin."`, değilse `"Bugün kayıt yok. Atılan ya da ikram edilen olduysa kasa raporundan önce girin."` Gündüz → `later`, rozet "Gün içinde": n > 0 ise `"{n} kayıt · {özet}"`, değilse `"Atılan, dökülen ya da ödenmeden verilen olursa o an girin; kasa raporuna geçer."` Adres `/panel/zayi`, eylem "Zayi / ikram ekle". Özet = `["İkram: …", "Zayi: …"]` (`dayWaste`), en çok 140 karakter, fazlası "…" ile kesilir |
| `kasa` | Personel | Okunamadı (dün satırı zaten "okunamadı" demiyorsa) → `later` "Okunamadı". Bugünün raporu var → `done`, rozet "Gönderildi", `"{ad} gönderdi · {diffText}"`, `/panel/kasa?gun={day}`, "Raporu aç". Akşam ve rapor yok → `todo`, "Kasa raporu", `"Kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayıp girin."`, `/panel/kasa`, "Raporu gir". Gündüz → `later`, rozet "Akşam", `"Kapanışta girilir: Z raporu ve kasa sayımı."`, `/panel/kasa`, "Kasa raporu" |
| `kasa` | Yönetici | Başlık "Bugünkü kasa raporu". Rapor var → farka göre `warn` / `todo` / `done` (`kasa-dun` ile aynı), rozet `diffText`, `"{ad} · Z {money}"`, `/panel/kasa?gun={day}`, "Raporu aç". Akşam ve rapor yok → `todo`, rozet "Girilmedi", `"Henüz girilmedi; personel kapanışta girer."`, `/panel/kasa?gun={day}`, "Kasa raporu". Gündüz → `later`, rozet "Akşam", `"Personel kapanışta girer."` |
| `sayim-son` | İkisi | Yalnız `today` ayın son günüyse. Bu ayın sayılan kalemi n, sayılacak kalem toplamı T (etkin ve sayım birimi olan hammaddeler). n = 0 → `todo`, "Ay sonu stok sayımı", rozet "Bugün", `"Bugün ayın son günü: kapanıştan sonra sayın. Telefondan grup grup girilir."`, "Sayıma başla". 0 < n < T → `todo`, rozet "{n} / {T}", `"{n} / {T} kalem sayıldı; kalanları da girin."`, "Sayıma devam". n ≥ T → `done`, `"{T} kalemin hepsi sayıldı."`, "Sayımı aç". Adres `/panel/sayim?ay={ay}` |

**Bilerek dışarıda bırakılanlar:**

- "Bu ayın işleri"nin satırları ayın işleridir, günün değil; Genel bakış'ta zaten en üstte duruyorlar. Bugün'de yalnız
  alttaki bağlantı vardır, aynı liste iki yerde hesaplanmaz.
- Yöneticiye zayi satırı gösterilmez (karar 7).
- Personelin reçete önerilerinin sonucu zilde kalır.
- laffogato.net'in günlük online satışı 8 saniyelik dış istek gerektirir, eklenmez.

Gece yarısından sonra: 1 Kasım 00:30'da `today` ayın son günü olmadığı için `sayim-son` çıkmaz. Ekim sayılmadıysa
`sayim-gecen` çıkar (Ekim). Kapanıştan sonraki sayım doğru aya yönlenir.

## 3. Veri modeli

Değişiklik yok. Okunan tablolar ve yardımcılar (hepsi var olan):

- `cash_reports`: `cashReportsBetween`, `firstCashReportDate`
- `waste_entries`: `dayWaste`
- `stock_counts`, `stock_extras`, `ingredients`: yeni küçük sayım sorgusu
- `user_reminders`: `loadDueReminders`
- `karaoke_sessions`: `loadSessions`
- `integration_state`: `readOrdersSnapshot`
- `reminders` + `invoices`: `loadUpcoming`
- `invoices.needs_review`
- `parasut_sync_runs`
- Ürün bağlantıları: `countUnlinkedProducts`
- `recipe_change_requests`: `countPendingRequests`, `loadReviewQueue(0)`
- Fiyat geçmişi: `loadModel` + `loadPriceAlerts`

## 4. Sunucu mantığı

### 4.1 `src/lib/cash-report.ts` (paylaşılan, küçük ekleme)

```ts
/** Kasa raporunun "akşam" sayıldığı saat (zil de bunu kullanır) */
export const CASH_EVENING_HOUR = 20;
/** Türkiye saatiyle saat (0–23) */
export function trHour(now: Date = new Date()): number
/** Akşam (20:00 ve sonrası) ya da gece 05:00'ten önce: bugünün kasa raporu beklenir */
export function isCashEvening(now: Date = new Date()): boolean
```

`businessDate` içindeki saat okuması `trHour` kullanacak biçimde sadeleşir; davranış aynı kalır.

İsteğe bağlı: `src/server/actions/notifications.ts` › `cashNotifications`'daki `hour >= 5 && hour < 20` kontrolü
`!isCashEvening(now)` olur. Böylece zil ve Bugün aynı kurala bakar. Tek satırlık değişiklik; öneri 4 de bu dosyaya
dokunuyor, birleştirmede dikkat edilmeli.

### 4.2 `src/app/panel/bugun/logic.ts` (yeni, saf, testli)

Veritabanı ve tarayıcı kullanmaz. Tür içe aktarımları `import type` ile yapılır: `UserReminderDTO`, `ParasutFacts`
(`../dashboard-tasks`), `UpcomingItem`, `KaraokeSessionDTO`.

```ts
import type { TaskStatus } from "../dashboard-tasks";

export type DayTaskKey = "kasa-dun" | "odeme" | "fatura" | "urun" | "onay" | "zam" | "sayim-gecen" | "zayi" | "kasa" | "sayim-son";
export interface DayTask { key: DayTaskKey; title: string; status: TaskStatus; badge?: string; detail: string; href: string; action: string }

export interface CashLite { date: string; cashDiff: number; zTotal: number; cash: number; card: number; submittedByName: string; revision: number; note: string | null }

export interface DayFacts {
  role: "admin" | "staff";
  now: Date;
  /** null: okunamadı */
  cash: { today: CashLite | null; yesterday: CashLite | null; firstDate: string | null } | null;
  waste: { count: number; zayi: string | null; ikram: string | null } | null;          // personel
  stock: { month: string; counted: number; total: number; prevMonth: string; prevHasData: boolean } | null;
  // Yalnız yönetici (personel olgularında hiç doldurulmaz; mantık da rolü denetler)
  payments?: UpcomingItem[] | null;
  invoices?: { review: number; unlinked: number; parasut: ParasutFacts | null } | null;
  approvals?: { count: number; names: string[] } | null;
  prices?: { title: string; detail: string; href: string } | null;
}

export function dayContext(now: Date): { today: string; day: string; yesterday: string; evening: boolean; dayOfMonth: number; lastDay: boolean }
export function dayTasks(f: DayFacts): DayTask[]              // 2.3'teki tablo; her satır küçük bir fonksiyon (kasaYesterday, payments, …)
export function splitTasks(tasks: DayTask[]): { now: DayTask[]; later: DayTask[]; done: DayTask[]; next: DayTask | null }
export function daySummary(tasks: DayTask[], reminders: number): { open: number; warn: number; done: number; total: number; headline: string }
export function clip(text: string, max: number): string

// Bugün kafede
export function businessDayRange(day: string): { from: Date; to: Date }   // [day 05:00, day+1 05:00) Türkiye
export interface KaraokeToday { reservations: number; walkIns: number; active: { until: string; overtime: boolean } | null; next: { time: string; guests: number | null; name: string | null } | null }
export function karaokeToday(sessions: KaraokeSessionDTO[], day: string, nowMs: number): KaraokeToday
export function cafeLines(k: KaraokeToday | null, openOrders: number | null): { key: string; text: string; tone: "info" | "warn" }[]

// Kendiliğinden yenileme: sıradaki 05:00, 20:00 ya da 00:00 (Türkiye)
export function nextRefreshAt(now: Date): number
```

- `karaokeToday` şu oturumları sayar: `isPlayable(s)`, `phase(s, now)` ne `cancelled` ne `held`, başlangıcı iş günü
  aralığında. Sitenin rezervasyonu `source === "site"`, rezervasyonsuz sayaç `source === "panel"`. `active` = `phase`
  `active` ya da `overtime` olan ilk oturum, `until` = `trClock(sessionEnd(s)).time`. `next` = başlangıç sırasıyla ilk
  `upcoming` oturum.
- Admin'e özel satır fonksiyonları `f.role === "admin"` değilse hiç çalışmaz. Personel olgusunda `payments` yanlışlıkla
  dolu gelse de satır çıkmaz; bu testle denetlenir.
- Gelecekteki satırlar (öneri 4, 7, 10, 11) için genişleme noktası: `DayFacts`'e isteğe bağlı bir alan ve
  `dayTasks`'taki diziye bir fonksiyon (bkz. 7. bölüm).

### 4.3 `src/server/data/today.ts` (yeni, `import "server-only"`)

```ts
export interface TodayData {
  facts: DayFacts;
  reminders: UserReminderDTO[];      // geciken + bugünkü (dueGroup), en çok 50
  payments: UpcomingItem[] | null;   // yalnız yönetici (DashboardPayments'a gider)
  cafe: { karaoke: KaraokeToday | null; openOrders: number | null; configured: boolean };
  renderedAt: string;
}
export async function loadToday(user: CurrentUser): Promise<TodayData>
```

- `now = new Date()` çağrısı `requireUser()`'dan (çerez okuması) sonra yapılır. Cache Components'ta önceden render
  sırasında şimdiki zamanı okuma hatası (`next-prerender-current-time`) çıkmasın diye; sayfa zaten dinamik.
- Her kaynak `safe(p)` ile sarılır: `p.catch(e => { console.error("[bugun]", e); return null; })`. Bir kaynak düşerse
  sayfa yine açılır ve ilgili satır "okunamadı" der ya da hiç çıkmaz.
- Paralel okunanlar, iki rol için ortak:
  - `cashReportsBetween(yesterday, day)` ve `firstCashReportDate()`
  - `stockProgress(month, prevMonth)` (aynı dosyada, yeni)
  - `loadDueReminders(user.id, today)`, ardından `dueGroup` ile `overdue | today` süzülür
  - `loadSessions(range.from, range.to, { admin })`
  - `readOrdersSnapshot()` (yalnız `karaokeSecret()` doluysa)
- Yalnız personel: `dayWaste(day)` (yalnız `count`, `zayi`, `ikram` kullanılır; `ikramValue` gösterilmez).
- Yalnız yönetici, aynı `Promise.all` içinde:
  - `loadUpcoming()`
  - `invoices.needs_review` sayısı
  - `parasutFacts()`: `isParasutConfigured()` ise son `trigger ≠ "history"` çalışma ve son başarılı çalışma.
    `src/app/panel/page.tsx` › `loadParasut` ile aynı sorgu, oraya dokunulmaz. Öneri 4 iş sağlığı modülü getirirse
    ikisi de onu kullanır.
  - `countUnlinkedProducts()`
  - `countPendingRequests()` ve sayı > 0 ise `loadReviewQueue(0)` ile ürün adları
  - `loadModel()` ve ardından `loadPriceAlerts(model)` ile `priceAlert(...)`
- `stockProgress`: iki sorgu.
  1. `select month, count(*) from stock_counts sc join ingredients i on i.id = sc.ingredient_id where sc.month = $m and
     i.active and i.count_unit is not null`: bu ay sayılan, sayılacak kalemlerden. `stockSheet`'in "countable" kuralı:
     `countUnit && active`.
  2. Sayılacak toplam: `select count(*) from ingredients where active and count_unit is not null`.
  3. Geçen ay için `exists(stock_counts where month = $prev) or exists(stock_extras where month = $prev)`
     (`hasData` ile aynı).

  Personelde `loadModel` çağrılmaz.
- `orders`: `snapshot.at` 30 dakikadan eskiyse `openOrders = null`. Sayı `snapshot.orders.length`. Tutar ya da ad
  taşınmaz.

## 5. Dosyalar

**Yeni**

| Dosya | İçerik |
|---|---|
| `src/app/panel/bugun/page.tsx` | Senkron sayfa + `Suspense` + `async TodayContent`. `requireUser()`, `loadToday(user)`, `dayTasks`, `splitTasks`, `daySummary`, ardından `PageHeader` ve 2.2'deki düzen. `export const metadata = { title: "Bugün" }` |
| `src/app/panel/bugun/logic.ts` | 4.2 |
| `src/app/panel/bugun/today-tasks.tsx` | Sunucu bileşeni: Yapılacaklar kartı (Şimdi / Sonra / `<details>` Tamamlananlar). Satır görünümü `ChecklistTasks`'in geniş ekran kartıyla aynı sınıflar; sıradaki iş `ring-2 ring-ink`, siyah hap. Durum stilleri `../task-style` |
| `src/app/panel/bugun/today-reminders.tsx` | `"use client"`: liste, `useOptimistic` ile kaldırma, `completeUserReminder` ve "Geri al" için `restoreUserReminder`, ardından `refreshLive()` (`my-reminders.tsx`'teki `complete()` deseninin kopyası, yaklaşık 25 satır). 30 sn'lik saatle `dueGroup` / `whenLabel` yeniden hesaplanır |
| `src/app/panel/bugun/today-cafe.tsx` | Sunucu bileşeni: `cafeLines` → `ActivityList` / `ActivityItem` |
| `src/app/panel/bugun/today-refresh.tsx` | `"use client"`, `null` döner. `renderedAt` prop'u değişince yeniden kurulur. `nextRefreshAt(now)`'a kadar (+5 sn) `setTimeout(router.refresh)`, sekme 60 sn'den uzun gizli kalıp görünür olunca `router.refresh()`. Activity sayfayı gizleyince efekt temizlenir, gizli sayfada zamanlayıcı kalmaz |
| `src/server/data/today.ts` | 4.3 |
| `src/app/panel/task-style.tsx` | `TASK_STYLE` (ikon, kuyu, ton, etiket) ve `TASK_BAR` (şerit renkleri). `dashboard-checklist-tasks.tsx` ve `dashboard-checklist.tsx`'teki iki haritadan taşınır. `"use client"` yok, sunucu ve istemci bileşenleri birlikte kullanır |
| `tests/bugun.test.ts` | 8. bölüm |
| `docs/BUGUN.md` | Satırlar ve kuralları (2.3'ün kısa hâli), yeni satır nasıl eklenir |

**Değişen**

| Dosya | Değişiklik |
|---|---|
| `src/components/panel/nav.ts` *(paylaşılan)* | `ListTodo` içe aktarılır. `NAV_GROUPS` › "Günlük" başına `{ href: "/panel/bugun", label: "Bugün", icon: ListTodo, roles: ["admin","staff"], keywords: "bugün yapılacaklar günün işleri liste kontrol kasa zayi sayım" }`. `NAV_TREE`'de `genel`'in hemen arkasına `{ id: "bugun", label: "Bugün", icon: ListTodo, href: "/panel/bugun", roles: ["admin","staff"] }`. `BOTTOM_NAV.admin` = genel, **bugun** (`/panel/bugun`, `ListTodo`), **kasa** (`/panel/kasa`, `Banknote`, etiket "Kasa"), odemeler (rozetli), menu. `BOTTOM_NAV.staff` = **bugun**, karaoke, kasa, zayi, receteler. `BottomNavItem` yorumu güncellenir ("Personel: günün beş ekranı; Sayım ve Hatırlatıcılarım çekmecede") |
| `src/lib/roles.ts` *(paylaşılan)* | `STAFF_PATHS`'e `"/panel/bugun"`; `STAFF_HOME = "/panel/bugun"`; yorumlar güncellenir |
| `src/lib/cash-report.ts` *(paylaşılan)* | 4.1 |
| `src/app/panel/dashboard-checklist-tasks.tsx`, `dashboard-checklist.tsx` | Yerel `STYLE` ve `BAR` haritaları kaldırılır, `./task-style`'dan alınır. Görünüm aynı kalır |
| `src/components/panel/live/alert-center.tsx` *(paylaşılan)* | `refreshScreen`: `/panel/bugun` de yenilensin (karaoke, hatırlatıcı ya da bildirim değişince) |
| `src/components/panel/sidebar.tsx` *(paylaşılan)* | Zilin tazelendiği "çıkılan sayfa" listesine `/panel/bugun` eklenir. Bugün'de ödeme "Ödendi" yapılınca alt menüdeki gecikmiş rozeti güncellenir |
| `src/server/actions/notifications.ts` *(paylaşılan, isteğe bağlı)* | `isCashEvening` kullanımı (4.1) |
| `src/app/manifest.ts` *(isteğe bağlı)* | Kısayollar: Bugün, Kasa raporu, Ödemeler, Karaoke, Stok sayımı (Satışlar ve Faturalar çıkar; personel yöneticinin ekranına dokunursa proxy onu Bugün'e götürür) |
| `tests/mobile-nav.test.ts`, `tests/roller.test.ts` | 8. bölüm |
| `README.md`, `docs/TASARIM.md`, `docs/KASA-RAPORU.md` | 10. bölüm |

`src/app/panel/page.tsx` (Genel bakış), `dashboard-tasks.ts` ve `src/server/notify/digest.ts`'e dokunulmaz.

## 6. Uç durumlar ve var olan özelliklerle ilişki

- **İş günü / takvim günü.** Kasa ve zayi `businessDate` (05:00) kullanır, Kasa ve Zayi ekranlarıyla aynı. Ödemeler ve
  hatırlatıcılar `todayTR` kullanır, Ödemeler ve Hatırlatıcılarım ekranlarıyla aynı. 00:00–05:00 arasında kasa satırı
  dünü (iş gününü) anlatır ve açıklama tarihle başlar.
- **Kapalı gün.** Dün kafe kapalıysa "Dünkü kasa raporu girilmedi" `todo` çıkar ve ertesi gün kendiliğinden kaybolur.
  Yöneticinin zilinde bugün de aynı uyarı var. Kapalı gün işareti yok (karar 5).
- **Kasa hiç kullanılmamış kurulum.** `firstCashReportDate()` boşsa dün satırı çıkmaz. Yerel veritabanında rapor yok;
  ekran sakin açılır.
- **Personel ve yetki.** Yönetici olguları personel için hiç yüklenmez (4.3). Mantık da rolü ayrıca denetler, test
  edilir. Personelde maliyet, ödeme, fatura ve karaoke tutarı yoktur. Kasa farkı (`diffText`) personelin zaten Kasa
  ekranındaki "Son 7 gün"de gördüğü bilgidir.
- **Girişte açılan ekran.** `requireAdmin` personeli `STAFF_HOME`'a, yani Bugün'e yönlendirir. Proxy izinsiz adreste
  `homeFor` kullanır. Giriş sonrası `next` yoksa Bugün açılır. Ana ekrana eklenmiş uygulamanın `start_url`'i `/panel`;
  personel için proxy Bugün'e yönlendirir. Önceden Sayım açılıyordu.
- **Alt menü etkin öğe.** `bottomNavActive(admin, "/panel/satislar")` artık "Menü" döner, kural değişmedi.
  `/panel/kasa?gun=…` "Kasa"yı yakar (yalnız yol karşılaştırılır).
- **Yönetici Kasa'yı alt menüden açınca** Günden güne görünümü gelir (değişmedi). Bugünün raporu bu görünümün sağ
  sütunundaki "Bugün" kartındadır (telefonda altta).
- **Activity (gizli rotalar korunur).** Bugün'den başka ekrana gidip geri dönülünce `Link` gezinmesi dinamik veriyi
  yeniden ister. Geri tuşunda korunan DOM görünür, `TodayRefresh` sekme görünürlüğünde ve saat sınırlarında yeniler.
  Sunucu eylemleri (`completeUserReminder`, ödeme eylemleri) zaten `refresh()` çağırır.
- **Zil ve rozet.** Zil değişmez (aynı olgular kendi metinleriyle orada da var). Bugün'de "Ödendi" yapılınca
  `sidebar.tsx` rozeti tazeler.
- **Karaoke.** Bugün kafede kartı statiktir, sayaç ve alarm Bar ekranında kalır. Uyarı motoru (`alert-center.tsx`)
  canlı veri değişince Bugün'ü yeniler. Askıdaki (ödenmemiş tutma) ve iptal rezervasyonlar sayılmaz.
- **Ödenmez / ikram ve kasa raporu ilişkisi.** Zayi satırı akşam "Rapordan önce" der, çünkü günün zayi / ikram özeti
  rapor gönderilirken e-postaya ve WhatsApp metnine girer.
- **Sayım ilerlemesi.** Arşivlenmiş (pasif ya da "Sayılmaz") kalemler `n`'e sayılmaz. Sayım formundaki "{n} /
  {toplam} kalem sayıldı" ile aynı kural.
- **Çok sayıda hatırlatıcı.** İlk 6 satır gösterilir, "Tümü (n)" bağlantısı vardır. Sunucuda en çok 50 kayıt okunur.
- **Okunamayan kaynak.** Kasa ve ödemeler "Okunamadı" diye gri satır çıkarır (Genel bakış'taki "Ödeme listesi şu an
  okunamadı" ile aynı desen). Diğerleri sessizce düşer, sunucu günlüğüne yazılır.
- **Performans.** Personel: yaklaşık 8 küçük sorgu, model yok. Yönetici: modelle birlikte yaklaşık 12 sorgu; zilin her
  kabuk açılışında yaptığından fazla değil, hepsi paralel.

## 7. Diğer önerilerle birleşme noktaları (bu iş yapmaz, yer bırakır)

- **Öneri 4 (sessiz hatalar):** `DayFacts.jobs?: { stale: string[]; failed: string[] }` ve yönetici sırasının başına
  `isler` satırı ("Günlük işler dün çalışmadı" → `warn`). `fatura` satırındaki Paraşüt sorgusu onların sağlık
  modülüne geçer.
- **Öneri 7 (şüpheli fiyat güncellemesi onayı):** `DayFacts.priceHolds?: number` ve `zam`'dan önce `fiyat-onay`
  satırı ("{n} fiyat değişikliği onayınızı bekliyor").
- **Öneri 10 (kasa bütünlüğü):** `CashLite.flags?: string[]` ("Açılış devirle tutmuyor", "2 kez değiştirildi").
  Yönetici `kasa-dun` açıklamasına eklenir ve `warn` yapar.
- **Öneri 11 (toplu fiyat + ModPOS kontrol listesi):** `DayFacts.posPending?: number` ve `modpos` satırı ("ModPOS'ta
  değiştirilecek {n} fiyat").

Her biri `dayTasks` dizisine bir fonksiyon ve `tests/bugun.test.ts`'e bir senaryo ekler.

## 8. Testler

**`tests/bugun.test.ts`** (yeni; `npx tsx --test tests/bugun.test.ts`). Saatler sabit `Date` ile verilir:
`new Date("2026-10-22T11:00:00Z")` Türkiye'de 14:00.

1. Personel gündüz, hiç rapor yok, `firstDate` boş: anahtarlar `["zayi","kasa"]`, ikisi `later`, rozetler "Gün içinde"
   ve "Akşam". `next` boş, başlık "Şimdilik iş yok · 2 iş sonra".
2. `firstDate` dünden önce ve dün raporu yok: `kasa-dun` `todo`, adres `?gun=2026-10-21`, `next` o. `firstDate` bugün
   ya da dünden sonraysa satır yok.
3. Personel 21:00: `zayi` `todo` "Rapordan önce" ve `kasa` `todo`. `next` = `zayi` (sıra). Rapor gönderilince ikisi
   `done`.
4. 01:30 (iş günü dün): `kasa` satırı iş gününe gider, açıklama tarihle başlar, `evening` doğru.
5. Yönetici `kasa-dun`: −120 → `warn`, rozet "120 ₺ eksik". +30 → `todo`. 0,5 → `done` "Kasa tutuyor". `revision` 2
   → "güncellendi". Not açıklamada.
6. Sayım: 31 Ekim n = 0 → `sayim-son` `todo` "Sayıma başla". n = 12 / T = 40 → rozet "12 / 40". n = 40 → `done`.
   3 Kasım ve Ekim sayılmadı → `sayim-gecen` adres `?ay=2026-10`. 11 Kasım → yok. 1 Kasım 00:30 → `sayim-son` yok,
   `sayim-gecen` var.
7. Ödemeler: geciken → `warn` (bugünkü de anılır). Yalnız bugün → `todo`. Hiçbiri yok → `done` ("Yaklaşan …" ekli).
   `null` → `later` "Okunamadı".
8. Faturalar: 30 saat önceki hata → `warn`. 50 saat önceki hata ve kontrol yok → `done`. Kontrol 3 → `todo` adres
   `?durum=kontrol`. Paraşüt bağlı değil → açıklamada "son eşitleme" yok.
9. `urun`, `onay`, `zam` yalnız sayı > 0 iken. Personel olgusuna `payments`, `invoices`, `approvals`, `prices`
   doldurulsa da hiçbir yönetici satırı çıkmaz.
10. `splitTasks` / `daySummary`: bölümler, sıra, sorun sayısı; hatırlatıcı eki " · 2 hatırlatıcı"; hepsi tamam →
    "Bugünün işleri tamam".
11. `karaokeToday`: iş günü aralığı (04:30'da başlayan dünkü sayılır, 05:30 bugünkü), tutma ve iptal sayılmaz, aktif
    oturum "bitiş HH:MM", sıradaki seçimi, rezervasyonsuz sayaç ayrı sayılır. `cafeLines` 30 dakikadan eski sipariş
    listesi için satır üretmez, tutar içermez (`/₺/` yok).
12. `nextRefreshAt`: 14:00 → 20:00, 20:30 → 00:00, 00:30 → 05:00 (Türkiye).
13. `isCashEvening` / `trHour`: 19:59 hayır, 20:00 evet, 04:59 evet, 05:00 hayır. Ayrıca `businessDate` davranışı
    aynı kalır (`tests/kasa-raporu.test.ts` geçmeye devam eder).
14. `clip`: 140 karakter sınırı ve "…".

**`tests/mobile-nav.test.ts`** (güncellenir):

- Yönetici çubuğu `["Genel bakış","Bugün","Kasa","Ödemeler","Menü"]`, adresleri
  `["/panel","/panel/bugun","/panel/kasa","/panel/hatirlaticilar",null]`; Ödemeler rozeti aynı.
- Personel çubuğu `[Bugün, Karaoke, Kasa, Zayi, Reçeteler]`. Çubukta olmayan personel ekranları
  `["/panel/hatirlaticilarim","/panel/hesap","/panel/sayim"]`.
- Etkin öğe:
  - Yönetici: `bottomNavActive(admin,"/panel/bugun") === "bugun"`, `"/panel/kasa"` → `"kasa"`,
    `"/panel/satislar"` ve `"/panel/faturalar"` → `"menu"`.
  - Personel: `"/panel/sayim"` → `null`, `"/panel/bugun"` → `"bugun"`.
- `mobileTitleFor("/panel/bugun") === "Bugün"`.

**`tests/roller.test.ts`** (güncellenir): `canOpen("staff","/panel/bugun")`, `STAFF_HOME === "/panel/bugun"`. Mevcut
"menüdeki her öğenin rolü erişim kuralıyla aynı" ve "her personel ekranı menüde" denetimleri yeni öğeyi kendiliğinden
kapsar.

**Kaynak denetimi** (`tests/bugun.test.ts` içinde, depodaki `readFileSync` deseni):

- `src/app/panel/bugun/page.tsx` `requireUser` kullanır, `requireAdmin` kullanmaz.
- `src/server/data/today.ts`'te `loadUpcoming`, `loadModel`, `countUnlinkedProducts` ve `countPendingRequests` yalnız
  `adminFacts` fonksiyonunun gövdesinde geçer. Yükleyici `staffFacts` / `adminFacts` diye iki fonksiyona bölünür ki
  denetim kolay olsun.

Mevcut testler değişmeden geçmeli: `dashboard-tasks` (stil taşındı, mantık aynı), `kenar-cubugu` (her adres bir kez),
`yardim` (`pathOf`; yeni üst öğe "Bugün").

Elle doğrulama: `npm run dev` ile 390 px ve 1280 px'te yönetici ve personel hesaplarıyla Bugün, alt menü, çekmece; 20:00
öncesi ve sonrası (sistem saati ya da `now` enjekte edilerek). `npm run lint`, `npx tsc --noEmit`, `npm test`.

## 9. Sahibinin kararı (önerilen varsayılanla; iş beklemez)

1. **Yöneticinin girişte açılan ekranı:** Genel bakış mı Bugün mü? *Varsayılan: Genel bakış kalır.* Bugün telefonda
   ikinci öğe. İstenirse `homeFor("admin")` tek satırla `/panel/bugun` olur.
2. **Yönetici alt menüsü:** Genel bakış · Bugün · Kasa · Ödemeler · Menü (Satışlar ve Faturalar çekmeceye). *Varsayılan
   bu.* Seçenek: Ödemeler yerine Faturalar; o durumda gecikmiş rozeti Bugün'e taşınır.
3. **Personel alt menüsü:** Bugün · Karaoke · Kasa · Zayi · Reçeteler (Sayım çekmecede ve ay sonunda Bugün'de).
   *Varsayılan bu.*
4. **"Akşam" saati:** kasa raporu 20:00'den sonra "yapılacak" olur (zil de 20:00). *Varsayılan 20:00.*
5. **Kapalı gün:** "Dün kafe kapalıydı" işareti ya da haftalık kapalı gün ayarı. *Varsayılan: yok;* eksik dün satırı
   ertesi gün kendiliğinden kalkar.
6. **Bugün öğesinde rozet:** *Varsayılan: yok* (zil sayıyor). Seçenek: açık iş varken küçük nokta.
7. **Yöneticiye zayi satırı:** *Varsayılan: yok* (zayi / ikram kasa raporu e-postasında geliyor).
8. **Ortak görev listesi** (yöneticinin personele iş ataması, açılış / kapanış kontrol listesi): bu işin dışında, şema
   ister. *Varsayılan: yok;* herkes kendi hatırlatıcısını kullanır.

## 10. Belgeler

- **README.md:** Ekranlar tablosuna yeni satır: "Bugün: günün işleri ve durumu (dünkü / bugünkü kasa raporu, zayi /
  ikram, ay sonu sayımı; yöneticiye ödemeler, fatura kontrolü ve Paraşüt, ürün bağlantıları, reçete onayları, hammadde
  zammı), Hatırlatıcılarım (tamamlandı), Bugün kafede (karaoke, uygulama siparişleri)" | `/panel/bugun` | — (yeni).
  Menü paragrafında telefon çubukları 2.1'deki gibi. Personel paragrafında **Bugün** eklenir, "girişte Bugün açılır" ve
  yeni çubuk yazılır.
- **docs/TASARIM.md §3:** Alt menü listeleri (personel listesi şu an zaten eski: "Sayım · Reçeteler · Hesabım"), menü
  ağacına Bugün. §4'e `task-style.tsx` (durum stilleri iki listede ortak) için bir satır.
- **docs/KASA-RAPORU.md:** "Telefonda alt menüde Kasa" artık iki rol için geçerli. Zil bölümünün yanına "Bugün ekranında
  kasa satırı: gündüz 'Akşam', 20:00'den sonra 'Yapılacak', yöneticiye dünkü raporun farkı".
- **docs/ZAYI-IKRAM.md:** Bugün'deki zayi satırı ("Rapordan önce") için bir cümle.
- **docs/BUGUN.md (yeni):** Satır tablosu, saat kuralları (05:00, 20:00, ay sonu ve ilk 10 gün), roller, yeni satır
  ekleme (olgu + fonksiyon + test).
- **Yardım sayfası:** dokunulmaz (personel açamıyor; yöneticiye menüde görünür).

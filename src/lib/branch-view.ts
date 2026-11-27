/**
 * Şube görünümü (şube ayrımı D, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı). Sahibin isteği: "ladmin'de bir şube seçince
 * sadece o şubeye ait bilgiler çıksın, diğerleri çıkmasın"; bugün bilerek firma geneli olan ekranlar (Vergi, Nakit
 * planı, Tutarlılık, Mutabakat, tedarikçi bakiyeleri, stok değeri, Ödemeler) için "kullanıcının ayarlarından duruma göre
 * değiştirilebilir yap, isteyen istediği gibi ayarlasın".
 *
 * Saf: kurallar burada; okuma `src/server/branch-scope.ts` (`currentBranchView`, `areaScope`), yazma
 * `src/server/actions/branch-view.ts` (`saveBranchView`), ekran Hesabım › Şube görünümü ve ekranların çipi
 * (`src/components/panel/branch-view-chip.tsx`).
 *
 * - **Alan** (`VIEW_AREAS`): ekran ekran iki kip, "sube" (yalnız seçili şube) ve "firma" (firmanın tamamı). İki alanın
 *   seçenek adı başka: Şubeleri yan yana ("Yalnız seçili şube | Yan yana"), İşletme geneli giderler ("Yalnız not |
 *   Tutarla göster"); saklanan değer yine "sube" / "firma".
 * - **Tercih** kişinin hesabında (`users.branch_view`, jsonb nesne: `{"vergi":"firma"}`); eksik anahtar rolün varsayılanı.
 * - **Kilitli hesap** (müdür, şubesi seçilmiş personel) hep "sube": tercih okunmaz, yazılamaz. Müdürün kilidi ayrıca
 *   okumanın kendisinde (`currentBranchScope`), son savunma odur.
 * - **"Tümü"** seçiliyken kip anlamsız: okuma zaten firmanın tamamı, çip çizilmez.
 */

import { ALL_BRANCHES, type BranchScope } from "./branches";
import type { Role } from "./constants";
import { accusativeTR } from "./format";
import { can, canOpen } from "./roles";

export const VIEW_MODES = ["sube", "firma"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Alanların sırası: Hesabım'daki kartın satır sırası */
export const VIEW_AREA_KEYS = ["odemeler", "nakit", "vergi", "tutarlilik", "mutabakat", "tedarikciler", "stok_degeri", "komisyon", "karsilastirma", "ortak_gider"] as const;
export type ViewArea = (typeof VIEW_AREA_KEYS)[number];

/** Kişinin tercihi: yalnız seçtiği alanlar (eksik alan rolün varsayılanı) */
export type BranchViewPrefs = Partial<Record<ViewArea, ViewMode>>;

export interface ViewAreaDef {
  /** Kartın satırı ve çipin adı */
  label: string;
  /** Kartta satırın altındaki tek satır: kipler ne gösterir */
  help: string;
  /** Segmentli seçimin seçenek adları */
  modes: Record<ViewMode, string>;
  /** Şube kipinde de firmanın kalan (çipte ve kartta ayrı satır); yoksa null */
  firmOnly: string | null;
  /** Varsayılan kip: yönetici (müdür ve personelde de bu, ama onlar kilitli) ve muhasebeci */
  defaults: { admin: ViewMode; accountant: ViewMode };
  /** Alanın ekranları (çipin çizildiği sayfalar). Rol bunlardan birini açabiliyorsa Hesabım'daki kartında satırı çıkar */
  screens: readonly string[];
}

const SUBE_FIRMA = { sube: "Yalnız şube", firma: "Firma geneli" } as const;

export const VIEW_AREAS: Record<ViewArea, ViewAreaDef> = {
  odemeler: {
    label: "Ödemeler ve faturalar",
    help: "Yalnız şube: şubenin ve işletme genelinin ödemeleri, şubeye seçilmiş faturalar; Bugün, zil, Genel bakış ve e-posta da.",
    modes: SUBE_FIRMA,
    firmOnly: "Faturasız cari borç ve dağıtılmamış ödeme her görünümde firmanın (İşletme geneli bölümünde)",
    defaults: { admin: "sube", accountant: "sube" },
    screens: ["/panel/hatirlaticilar"],
  },
  nakit: {
    label: "Nakit planı",
    help: "Yalnız şube: şubenin nakit akışı (satış tahmini, kasa devri, ödemeleri, faturaları, maaşları, sabit giderleri); vergi, SGK ve işletme geneli tek satırda.",
    modes: SUBE_FIRMA,
    firmOnly: "Açılış bakiyesi her görünümde firmanın",
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/hatirlaticilar/nakit"],
  },
  vergi: {
    label: "Vergi",
    help: "Yalnız şube: üstte şubenin payı (bilgi): satış KDV'si, şubenin faturalarının KDV'si, şube personelinin SGK'sı ve stopajı, şubenin amortismanı.",
    modes: SUBE_FIRMA,
    firmOnly: "Beyan tutarları (KDV, muhtasar, geçici ve kurumlar vergisi) ve takvim her görünümde firmanın",
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/vergi", "/panel/vergi/gelir-gider", "/panel/vergi/demirbas"],
  },
  tutarlilik: {
    label: "Tutarlılık",
    help: "Yalnız şube: şubenin satışı ve Z'si, reçete kullanımı, sayımı ve zayisi; alım yalnız şubeye seçilmiş faturalardan.",
    modes: SUBE_FIRMA,
    firmOnly: "Bulgular her görünümde firmanın (şube sütunu yok)",
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/tutarlilik"],
  },
  mutabakat: {
    label: "Mutabakat",
    help: "Yalnız şube: şubenin POS hakedişi; ekstrede şubenin kayıtlarıyla eşleşen satırlar üstte, gerisi İşletme geneli'nde.",
    modes: SUBE_FIRMA,
    firmOnly: "Ekstrenin kendisi ve gelen POS parası her görünümde firmanın",
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/mutabakat"],
  },
  tedarikciler: {
    label: "Tedarikçi bakiyeleri",
    help: "Yalnız şube: şubenin faturaları, onlara yapılan ödemeler ve şubenin kasasından ödemeler; faturasız borç İşletme geneli satırında.",
    modes: SUBE_FIRMA,
    firmOnly: null,
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/tedarikciler"],
  },
  stok_degeri: {
    label: "Stok değeri (FIFO)",
    help: "Yalnız şube: şubenin ve işletme genelinin faturalarındaki partilerle; sayım tutarı, Ayarlar önizlemesi ve dışa aktarımın Stok sayfası.",
    modes: SUBE_FIRMA,
    firmOnly: null,
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/sayim"],
  },
  komisyon: {
    label: "Komisyon ve hakediş",
    help: "Yalnız şube: şubenin payı ana görünüm, firmanın raporu katlı ekte; Bugün'ün Hakedişler satırı da.",
    modes: SUBE_FIRMA,
    firmOnly: null,
    defaults: { admin: "sube", accountant: "sube" },
    screens: ["/panel/komisyonlar"],
  },
  karsilastirma: {
    label: "Şubeleri yan yana",
    help: "Şube karşılaştırma, İşçilik / ciro ve Bugün'ün Şubelerde gün kartı: yalnız seçili şube ya da bütün şubeler yan yana.",
    modes: { sube: "Yalnız seçili şube", firma: "Yan yana" },
    firmOnly: null,
    defaults: { admin: "sube", accountant: "sube" },
    screens: ["/panel/raporlar", "/panel/raporlar/iscilik"],
  },
  ortak_gider: {
    label: "İşletme geneli giderler",
    help: "Yalnız not: işletme geneli giderler bu şubenin kârına girmez (Tümü'de sayılır), tutar yazılmaz. Tutarla göster: İşletme geneli payı (bilgi) satırı.",
    modes: { sube: "Yalnız not", firma: "Tutarla göster" },
    firmOnly: null,
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/gelir-gider", "/panel/harcamalar", "/panel/giderler"],
  },
};

export function isViewArea(v: unknown): v is ViewArea {
  return typeof v === "string" && (VIEW_AREA_KEYS as readonly string[]).includes(v);
}

export function isViewMode(v: unknown): v is ViewMode {
  return v === "sube" || v === "firma";
}

/**
 * Veritabanındaki tercihin (users.branch_view) okunması: bilinmeyen anahtar ve değer düşer, nesne değilse boş. Eski bir
 * sürümün yazdığı ya da elle bozulmuş değer ekranı düşürmez, varsayılana döner
 */
export function parseBranchView(raw: unknown): BranchViewPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: BranchViewPrefs = {};
  for (const area of VIEW_AREA_KEYS) {
    if (!Object.hasOwn(raw, area)) continue;
    const v = (raw as Record<string, unknown>)[area];
    if (isViewMode(v)) out[area] = v;
  }
  return out;
}

/** Rolün varsayılan kipi (müdür ve personel yöneticininkini alır; onlar zaten kilitli ya da para ekranı görmez) */
export function defaultView(area: ViewArea, role: Role): ViewMode {
  const d = VIEW_AREAS[area].defaults;
  return role === "accountant" ? d.accountant : d.admin;
}

/**
 * Alanın geçerli kipi. Kilitli hesap (müdür, şubesi seçilmiş personel) hep "sube"; bütün şubeleri göremeyen rolün
 * (şubesiz personel) tercihi okunmaz, varsayılan geçer; öteki hesapta tercih, yoksa rolün varsayılanı. "Tümü"
 * seçiliyken sonuç anlamsızdır (okuma zaten firmanın tamamı; `viewScope`)
 */
export function effectiveView(area: ViewArea, role: Role, locked: boolean, prefs: BranchViewPrefs): ViewMode {
  if (locked) return "sube";
  if (!can(role, "sube.tumu")) return defaultView(area, role);
  return prefs[area] ?? defaultView(area, role);
}

/** Okumanın kapsamı: firma kipinde "Tümü", şube kipinde seçim (src/server/branch-scope.ts › areaScope) */
export function viewScope(scope: BranchScope, mode: ViewMode): BranchScope {
  return mode === "firma" ? ALL_BRANCHES : scope;
}

/**
 * Hesabım'daki kartta rolün satırları: bütün şubeleri gören rolde, açabildiği ekranları olan alanlar (muhasebeci:
 * Vergi ve İşletme geneli giderler). Öteki roller boş
 */
export function viewAreasFor(role: Role): ViewArea[] {
  if (!can(role, "sube.tumu")) return [];
  return VIEW_AREA_KEYS.filter((a) => VIEW_AREAS[a].screens.some((p) => canOpen(role, p)));
}

/**
 * Hesabım › Şube görünümü kartının hâli: tek şube açıkken ya da para ekranı olmayan rolde yok (seçici de çizilmez),
 * şubesine kilitli hesapta tek satır, öteki hesapta kart
 */
export function branchViewCardState(o: { role: Role; locked: boolean; activeBranches: number }): "yok" | "kilitli" | "kart" {
  if (o.activeBranches < 2) return "yok";
  if (o.locked) return "kilitli";
  return viewAreasFor(o.role).length ? "kart" : "yok";
}

/** Kilitli hesabın tek satırı (Hesabım) */
export function lockedViewLine(branchName: string): string {
  return `Hesabınız ${branchName} şubesine bağlı: her ekran yalnız ${accusativeTR(branchName)} gösterir.`;
}

/** Ekranın çipi çizilir mi: tek şube seçili, birden çok şube açık, rol bütün şubeleri görür, hesap kilitli değil */
export function showViewChip(o: { scope: BranchScope; activeBranches: number; role: Role; locked: boolean }): boolean {
  return o.scope !== ALL_BRANCHES && o.activeBranches >= 2 && can(o.role, "sube.tumu") && !o.locked;
}

export interface ViewChipText {
  /** "Marina görünümü" ya da "Firma geneli · Marina seçili" */
  title: string;
  /** Düğme: öbür kipe geçer */
  switchLabel: string;
  switchTo: ViewMode;
  /** Şube kipinde de firmanın kalan (yalnız şube kipinde); yoksa null */
  firmOnly: string | null;
}

/** Ekranın çipinin metni (alanın kipine ve seçili şubenin adına göre) */
export function viewChipText(area: ViewArea, mode: ViewMode, branchName: string): ViewChipText {
  const only = `Yalnız ${accusativeTR(branchName)} göster`;
  if (area === "karsilastirma") {
    return mode === "sube"
      ? { title: `${branchName} görünümü`, switchLabel: "Şubeleri yan yana göster", switchTo: "firma", firmOnly: null }
      : { title: `Şubeler yan yana · ${branchName} seçili`, switchLabel: only, switchTo: "sube", firmOnly: null };
  }
  if (area === "ortak_gider") {
    return mode === "sube"
      ? { title: `${branchName} görünümü · işletme geneli giderler yalnız not`, switchLabel: "Tutarla göster", switchTo: "firma", firmOnly: null }
      : { title: `İşletme geneli giderler tutarıyla · ${branchName} seçili`, switchLabel: "Yalnız not", switchTo: "sube", firmOnly: null };
  }
  return mode === "sube"
    ? { title: `${branchName} görünümü`, switchLabel: "Firma geneline geç", switchTo: "firma", firmOnly: VIEW_AREAS[area].firmOnly }
    : { title: `Firma geneli · ${branchName} seçili`, switchLabel: only, switchTo: "sube", firmOnly: null };
}

/** Hesabım'daki kartın başlığı ve açıklaması */
export const BRANCH_VIEW_TITLE = "Şube görünümü";
export const BRANCH_VIEW_DESCRIPTION =
  "Soldan bir şube seçtiğinizde bu ekranlar yalnız o şubeyi mi, firmanın tamamını mı göstersin? Tercih yalnız sizin hesabınızda saklanır.";

/** Çipin Hesabım bağlantısı (kartın çapası) */
export const BRANCH_VIEW_HREF = "/panel/hesap#sube-gorunumu";
/** Bütün şubeleri göremeyen hesabın kaydı (eylem reddeder) */
export const BRANCH_VIEW_LOCKED = "Hesabınız şubenize bağlı";

/** Kartın toplu düğmeleri */
export type BulkView = "sube" | "firma" | "varsayilan";

/**
 * Toplu düğmenin yazacağı tercih: "Hepsi yalnız şube" / "Hepsi firma geneli" rolün kartındaki bütün alanları yazar
 * (`users.branch_view || yama`); "Varsayılanlara dön" tercihi boşaltır (null)
 */
export function bulkViewPatch(kind: BulkView, role: Role): BranchViewPrefs | null {
  if (kind === "varsayilan") return null;
  return Object.fromEntries(viewAreasFor(role).map((a) => [a, kind])) as BranchViewPrefs;
}

// ---------------------------------------------------------------- Hep firma geneli kalanlar

/**
 * Hesabım'daki "Her zaman firma geneli" listesi (ayarı yok): neyin, neden şube seçiliyken de firmanın kaldığı. Kodun
 * kaydı aşağıda (`COMPANY_WIDE_READS`); bu liste kişiye anlatılan özetidir
 */
export const ALWAYS_COMPANY_WIDE: readonly { title: string; reason: string }[] = [
  { title: "Tam yedek", reason: "Geri yüklenebilir yedek bütün veritabanını ister (ortak tablolar ve aralarındaki bağlar)." },
  { title: "Vergi beyan tutarları ve vergi takvimi", reason: "Firmanın tek vergi numarası var." },
  { title: "Banka ve cari ekstresi, nakit açılış bakiyesi", reason: "Firmanın hesabı ve parasıdır." },
  { title: "Paraşüt eşitlemesi", reason: "Hesap başınadır; ortak hesap “hesap geneli” yazar." },
  { title: "Hammadde fiyatı, menü, reçete, tedarikçi kütüğü", reason: "Şubelerin ortak verisi." },
  { title: "Su + buz litre fiyatı", reason: "Tek faturadan gelir; şube şube döküm yine görünür." },
  { title: "Silme engelleri", reason: "Bütünlük denetimidir, hiçbir ekranda veri olarak görünmez." },
  { title: "Tükendi, uygulama siparişleri, masa çağrıları", reason: "Site şubeyi göndermiyor; site değişene kadar “Bütün şubeler” yazar." },
  { title: "Firmaya giden sabah ve haftalık e-postası, aylık muhasebeci paketi e-postası", reason: "Alıcı firmanın kendisi." },
  { title: "Tutarlılık bulguları", reason: "Bulgunun henüz şubesi yok." },
];

// ---------------------------------------------------------------- Kodun kaydı (tests/sube-ayrimi.test.ts)

/**
 * Şube seçiliyken de firmanın tamamını okuyan yerlerin türü:
 * - `yalniz-firma`: hep firmanın (beyan, ekstre, firmaya giden e-posta, tam yedek);
 * - `alan`: kişinin tercihine bağlı (`areaScope(alan)`);
 * - `butunluk`: silme engeli gibi denetim, veri olarak gösterilmez;
 * - `ortak-veri`: şubelerin ortak verisi ya da işletmenin günü;
 * - `sozlesme`: sitenin sözleşmesinde şube yok;
 * - `hesap`: Paraşüt hesabı başına;
 * - `gecici`: bilinen geçici istisna;
 * - `yazim`: okuma değil, kaydın hedefi işletme geneli;
 * - `bekliyor`: şube ayrımının sonraki parçası (`part`) kapsamla okuyacak ya da alana bağlayacak.
 */
export type CompanyWideKind = "yalniz-firma" | "alan" | "butunluk" | "ortak-veri" | "sozlesme" | "hesap" | "gecici" | "yazim" | "bekliyor";

export interface CompanyWideRead {
  /** İşaretin kimliği: okumanın üstündeki `// şube-ayrımı: <id>` */
  id: string;
  /** "dosya#işlev" (birden çok yerse "; " ile) */
  where: string;
  kind: CompanyWideKind;
  /** `alan` ve alana bağlanacak `bekliyor` kaydının alanı */
  area?: ViewArea;
  /** `bekliyor`: hangi parça kapatır (docs/SUBE.md › Şube ayrımı › Sıra) */
  part?: 2 | 3 | 4 | 5 | 6;
  reason: string;
}

/** Okumanın üstündeki işaret: `// şube-ayrımı: <id>` */
export const READ_MARKER = "şube-ayrımı:";

/**
 * Şube seçimini bilerek aşan okumaların kaydı. Kaynak taraması (tests/sube-ayrimi.test.ts) her
 * `withBranchScope(ALL_BRANCHES`, `scope: ALL_BRANCHES`, kapsamsız `loadUpcoming()` / `unlinkedProducts(n)` /
 * `countUnlinkedProducts()` ve `areaScope(…)` çağrısının üstünde buradaki bir kimliğin işaretini ister; buradaki her
 * kimlik de en az bir yerde kullanılır (eskimiş kayıt kalmaz).
 */
export const COMPANY_WIDE_READS: readonly CompanyWideRead[] = [
  // Hep firma geneli
  {
    id: "eposta.firma",
    where: "src/server/notify/digest.ts#runReminderDigest; src/server/actions/reminders.ts#previewDigest; src/server/weekly/collect.ts#collectWeekly",
    kind: "yalniz-firma",
    reason: "Sabah ve haftalık e-postası işletmenin tamamı için kurulur; şubeye bağlı alıcı kendi şubesinin grubunu alır",
  },
  { id: "muhasebe.paket-eposta", where: "src/server/muhasebe/paket.ts#loadPackageData", kind: "yalniz-firma", reason: "Aylık muhasebeci paketi firmanın (elle indirmenin şubesi parça 6'da)" },
  // Bütünlük ve ortak veri
  { id: "costs.dataMonths", where: "src/server/actions/costs.ts#dataMonths", kind: "butunluk", reason: "Personelin ve sabit giderin silme engeli bütün şubelerin aylarına bakar" },
  { id: "dataset.companyMonths", where: "src/server/data/dataset.ts#loadDataset", kind: "ortak-veri", reason: "İşletmenin günü: işletme geneli giderler Tümü'nün açık günüyle oranlanır" },
  { id: "dataset.companyWaterSales", where: "src/server/data/dataset.ts#companyWaterSales", kind: "ortak-veri", reason: "Su + buz litre fiyatı tek faturadan, bütün şubelerin litresine bölünür" },
  { id: "asistan.isletme-geneli", where: "src/server/assistant-ops/resolve.ts#expenseBranch", kind: "yazim", reason: "Okuma değil: asistanın yazdığı gider ve hatırlatıcının işletme geneli hedefi" },
  // Sonraki parçalar (şube ayrımı 3–6; parça 2 kendi üç kaydını kapattı: eşlenmemiş Paraşüt ürünleri, kanal seçiliyken
  // kasa zili, kayıp önleme)
  { id: "nakit.sayfa", where: "src/app/panel/hatirlaticilar/nakit/page.tsx#CashPlanContent; src/server/data/cash-plan.ts#loadCashPlan", kind: "bekliyor", area: "nakit", part: 4, reason: "Nakit planı bugün firmanın" },
  { id: "nakit.genel-bakis", where: "src/app/panel/page.tsx#DashboardContent", kind: "bekliyor", area: "nakit", part: 4, reason: "Genel bakış'ın nakit planı kartı bugün firmanın" },
  { id: "nakit.mcp", where: "src/server/mcp/tools.ts#odemeler", kind: "bekliyor", area: "nakit", part: 4, reason: "Bağlantının ödemeler aracındaki nakit planı bugün firmanın" },
  { id: "komisyon.sayfa", where: "src/server/data/commission.ts#loadCommissionReports", kind: "bekliyor", area: "komisyon", part: 4, reason: "Komisyon ekranının ana raporu bugün firmanın" },
  { id: "komisyon.hafif", where: "src/server/data/commission.ts#loadLightReport", kind: "bekliyor", area: "komisyon", part: 4, reason: "Zil, Bugün ve e-postanın hakediş raporu bugün firmanın" },
  { id: "vergi.sayfa", where: "src/app/panel/vergi/page.tsx#TaxContent; src/app/panel/vergi/gelir-gider/page.tsx#TaxPnlContent; src/app/panel/vergi/demirbas/page.tsx#TaxAssetsContent", kind: "bekliyor", area: "vergi", part: 5, reason: "Vergi ekranları bugün firmanın" },
  { id: "tutarlilik.sayfa", where: "src/app/panel/tutarlilik/page.tsx#ConsistencyContent", kind: "bekliyor", area: "tutarlilik", part: 5, reason: "Tutarlılık bugün firmanın" },
  { id: "stok-degeri.ayarlar", where: "src/app/panel/ayarlar/page.tsx#SettingsContent", kind: "bekliyor", area: "stok_degeri", part: 5, reason: "Ayarlar'ın stok değerleme önizlemesi bugün firmanın" },
  { id: "karsilastirma.sayfa", where: "src/server/data/sube-karsilastirma.ts#loadBranchCompare", kind: "bekliyor", area: "karsilastirma", part: 6, reason: "Şube karşılaştırma bugün şubeleri yan yana okuyor" },
  { id: "karsilastirma.iscilik", where: "src/server/data/iscilik.ts#loadLaborReport", kind: "bekliyor", area: "karsilastirma", part: 6, reason: "İşçilik / ciro bugün şubeleri yan yana okuyor" },
  { id: "karsilastirma.sube-gunu", where: "src/server/data/branch-day.ts#loadBranchDay", kind: "bekliyor", area: "karsilastirma", part: 6, reason: "Bugün'ün Şubelerde gün kartı bugün bütün şubelerin föyünü okuyor" },
  { id: "vergi.disa-aktar", where: "src/app/api/export/route.ts#exportWorkbook", kind: "bekliyor", area: "vergi", part: 6, reason: "Dışa aktarımın Vergi sayfası bugün firmanın" },
  { id: "tedarikciler.disa-aktar", where: "src/app/api/export/route.ts#exportWorkbook", kind: "bekliyor", area: "tedarikciler", part: 6, reason: "Dışa aktarımın Cari hareketleri sayfası bugün firmanın" },
];

/**
 * Şube görünümü (şube ayrımı D, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı). Sahibin isteği: "ladmin'de bir şube seçince
 * sadece o şubeye ait bilgiler çıksın, diğerleri çıkmasın"; bugün bilerek firma geneli olan ekranlar (Nakit planı,
 * Tutarlılık, Mutabakat, tedarikçi bakiyeleri, stok değeri, Ödemeler) için "kullanıcının ayarlarından duruma göre
 * değiştirilebilir yap, isteyen istediği gibi ayarlasın".
 *
 * **Vergi şubeye bölünmez** (sahibin kararı, 27 Kasım 2026: "Vergi ile ilgili olan kısımları tamamen çıkar, o bölüm
 * olmadan ilerleyelim; hem sistemi bölmez, yanlış hesaplama riskini de azaltmış oluruz"): Vergi'nin alanı yok; Vergi
 * bölümü aynı gün tümden kaldırıldı (vergiyi muhasebeci yürütüyor). Nakit planının şube kipinde vergi hatırlatıcıları ve
 * SGK yok (src/lib/cash-plan-branch.ts). Eski sürümün yazdığı `vergi` anahtarı okurken düşer (`parseBranchView`).
 *
 * Saf: kurallar burada; okuma `src/server/branch-scope.ts` (`currentBranchView`, `areaScope`), yazma
 * `src/server/actions/branch-view.ts` (`saveBranchView`), ekran Hesabım › Şube görünümü ve ekranların çipi
 * (`src/components/panel/branch-view-chip.tsx`).
 *
 * - **Alan** (`VIEW_AREAS`): ekran ekran iki kip, "sube" (yalnız seçili şube) ve "firma" (firmanın tamamı). İki alanın
 *   seçenek adı başka: Şubeleri yan yana ("Yalnız seçili şube | Yan yana"), İşletme geneli giderler ("Yalnız not |
 *   Tutarla göster"); saklanan değer yine "sube" / "firma".
 * - **Tercih** kişinin hesabında (`users.branch_view`, jsonb nesne: `{"nakit":"firma"}`); eksik anahtar rolün varsayılanı.
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
export const VIEW_AREA_KEYS = ["odemeler", "nakit", "tutarlilik", "mutabakat", "tedarikciler", "stok_degeri", "komisyon", "karsilastirma", "ortak_gider"] as const;
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
    help: "Yalnız şube: şubenin nakit akışı (satış tahmini, kasa devri, ödemeleri, faturaları, maaşları, sabit giderleri); işletme geneli tek satırda. Vergi ve SGK ödemeleri firma geneli: Tümü'de görünür.",
    modes: SUBE_FIRMA,
    firmOnly: "Açılış bakiyesi, vergi ve SGK ödemeleri her görünümde firmanın",
    defaults: { admin: "sube", accountant: "firma" },
    screens: ["/panel/hatirlaticilar/nakit"],
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
    screens: ["/panel/tedarikciler", "/panel/tedarikciler/[cari]"],
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
    help: "Yalnız not: işletme geneli giderler bu şubenin kârına girmez (Tümü'de sayılır); tutarları ve kalemleri yazılmaz (Gelir-gider, Genel bakış, Aylık harcamalar, Sabit giderler, dışa aktarım). Tutarla göster: İşletme geneli payı (bilgi) satırı ve tutarları. Şubenin kârı iki kipte aynı.",
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
 * İşletme geneli giderler). Öteki roller boş
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

/**
 * Bağlantının ve panel asistanının `kapsam` satırı (şube ayrımı parça 4): şube seçiliyken alanların kipi de yazılır
 * ("Marina · ödemeler ve faturalar: Yalnız şube · nakit planı: Firma geneli"); "Tümü"de yalnız "Tümü"
 */
export function areaKapsam(label: string, scope: BranchScope, parts: readonly { area: ViewArea; mode: ViewMode }[]): string {
  if (scope === ALL_BRANCHES || !parts.length) return label;
  return [label, ...parts.map((p) => `${VIEW_AREAS[p.area].label.toLocaleLowerCase("tr")}: ${VIEW_AREAS[p.area].modes[p.mode]}`)].join(" · ");
}

/** Okunan kapsamdan alanın kipi: "Tümü" okunduysa firma, tek şube okunduysa şube */
export const modeOfScope = (read: BranchScope): ViewMode => (read === ALL_BRANCHES ? "firma" : "sube");

// ---------------------------------------------------------------- Parça 6: Şubeleri yan yana, İşletme geneli giderler

/**
 * Şubeleri yan yana koyan raporların şubeleri (Şubeleri yan yana alanı, şube ayrımı parça 6): Şube karşılaştırma, İşçilik
 * / ciro ve Bugün'ün "Şubelerde gün" kartı. `read` alanın kapsamı (`areaScope("karsilastirma")`): "Yan yana" kipinde ve
 * "Tümü"de bütün şubeler, "Yalnız seçili şube" kipinde yalnız seçili şube (online kanal seçiliyse boş: kanalın kasası yok)
 */
export function compareBranchesIn<T extends { id: string }>(branches: readonly T[], read: BranchScope): T[] {
  return read === ALL_BRANCHES ? [...branches] : branches.filter((b) => b.id === read);
}

/**
 * Şubeleri yan yana raporunun boş hâli: online kanal seçiliyken (kanalın kasası yok; "Yalnız seçili şube" kipinde rapor
 * boş kalır) kanalın metni, öteki hâlde "Açık şube yok"
 */
export function compareEmptyText(scope: BranchScope, known: readonly { id: string; name: string; kind: string }[]): { title: string; description: string } {
  const b = scope === ALL_BRANCHES ? null : known.find((x) => x.id === scope);
  if (b && b.kind !== "fiziksel") {
    return { title: `${b.name} seçili: kanalın kasası yok`, description: "Rapor fiziksel şubelerin kasasıyla kurulur. Soldan bir şube seçin ya da şubeleri yan yana gösterin." };
  }
  return { title: "Açık şube yok", description: "Ayarlar › Şubeler'de açık bir fiziksel şube olmalı." };
}

/**
 * İşletme geneli giderler alanının "Yalnız not" kipindeki metni (şube ayrımı parça 6): şube seçiliyken işletme geneli
 * giderlerin tutarı yazılmaz, yalnız bu not. "Tutarla göster" kipinde bugünkü "İşletme geneli payı (bilgi)" satırı
 */
export const SHARED_COSTS_NOTE = "İşletme geneli giderler bu şubenin kârına girmez (Tümü'de sayılır)";

/**
 * İşletme geneli giderlerin tutarı gizli mi: tek şube seçili ve alan "Yalnız not" kipinde. "Tümü"de gizlenecek bir şey
 * yok (işletme geneli giderler bölümlerinde bir kez sayılır)
 */
export function sharedCostsHidden(branchSelected: boolean, mode: ViewMode): boolean {
  return branchSelected && mode === "sube";
}

/**
 * Sitenin şubesiz gönderdiği kayıtların rozeti (Tükendi, uygulama siparişleri, masa çağrıları; şube ayrımı parça 6): tek
 * şube seçili ve birden çok şube açıkken "Bütün şubeler" (site şubeyi göndermiyor, liste süzülemez); öteki hâlde yok
 */
export function siteWideBadge(scope: BranchScope, activeBranches: number): string | null {
  return scope !== ALL_BRANCHES && activeBranches >= 2 ? "Bütün şubeler" : null;
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
  {
    title: "Vergi ve SGK ödemeleri: Ödemeler'deki vergi hatırlatıcıları ve SGK, nakit planında",
    reason: "Vergi beyanı firmanın tek vergi numarasıyla; şubeye bölünmez (vergiyi muhasebeci yürütür).",
  },
  { title: "Banka ve cari ekstresi, nakit açılış bakiyesi", reason: "Firmanın hesabı ve parasıdır." },
  { title: "Paraşüt eşitlemesi", reason: "Hesap başınadır; ortak hesap “hesap geneli” yazar." },
  { title: "Hammadde fiyatı, menü, reçete, tedarikçi kütüğü", reason: "Şubelerin ortak verisi." },
  { title: "Su + buz litre fiyatı", reason: "Tek faturadan gelir; şube şube döküm yine görünür." },
  { title: "Silme engelleri", reason: "Bütünlük denetimidir, hiçbir ekranda veri olarak görünmez." },
  { title: "Tükendi, uygulama siparişleri, masa çağrıları", reason: "Site şubeyi göndermiyor; site değişene kadar “Bütün şubeler” yazar." },
  {
    title: "Firmaya giden sabah ve haftalık e-postası, aylık muhasebeci paketi e-postası",
    reason: "Alıcı firmanın kendisi; şubeye bağlı alıcı kendi şubesinin e-postasını alır, paketin elle indirmesi seçili şubenin.",
  },
  { title: "Tutarlılık bulguları ve elle yazılan alım miktarları", reason: "Henüz şubeleri yok; dışa aktarımda “Firma geneli” yazar." },
];

// ---------------------------------------------------------------- Kodun kaydı (tests/sube-ayrimi.test.ts)

/**
 * Şube seçiliyken de firmanın tamamını okuyan yerlerin türü:
 * - `yalniz-firma`: hep firmanın (ekstre, nakit açılış bakiyesi, firmaya giden e-posta, tam yedek);
 * - `alan`: kişinin tercihine bağlı (`areaScope(alan)`);
 * - `butunluk`: silme engeli gibi denetim, veri olarak gösterilmez;
 * - `ortak-veri`: şubelerin ortak verisi ya da işletmenin günü;
 * - `sozlesme`: sitenin sözleşmesinde şube yok;
 * - `hesap`: Paraşüt hesabı başına;
 * - `gecici`: bilinen geçici istisna;
 * - `yazim`: okuma değil, kaydın hedefi işletme geneli.
 * Parça 1–5'in `bekliyor` kayıtları (sonraki parçanın kapatacağı okumalar) parça 6'da bitti (27 Kasım 2026).
 */
export type CompanyWideKind = "yalniz-firma" | "alan" | "butunluk" | "ortak-veri" | "sozlesme" | "hesap" | "gecici" | "yazim";

export interface CompanyWideRead {
  /** İşaretin kimliği: okumanın üstündeki `// şube-ayrımı: <id>` */
  id: string;
  /** "dosya#işlev" (birden çok yerse "; " ile) */
  where: string;
  kind: CompanyWideKind;
  /** `alan` kaydının alanı */
  area?: ViewArea;
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
    where:
      "src/server/notify/digest.ts#runReminderDigest; src/server/actions/reminders.ts#previewDigest; src/server/weekly/collect.ts#collectWeekly; src/server/data/commission.ts#loadCommissionDigest",
    kind: "yalniz-firma",
    reason: "Sabah ve haftalık e-postası işletmenin tamamı için kurulur; şubeye bağlı alıcı kendi şubesinin grubunu alır",
  },
  {
    id: "muhasebe.paket-eposta",
    where: "src/server/muhasebe/paket.ts#sendAccountingPackage",
    kind: "yalniz-firma",
    reason: "Aylık muhasebeci paketi e-postası firmanın (alıcı muhasebe şirketi); elle indirme şube seçiliyken şubenin paketi",
  },
  // Bütünlük ve ortak veri
  { id: "costs.dataMonths", where: "src/server/actions/costs.ts#dataMonths", kind: "butunluk", reason: "Personelin ve sabit giderin silme engeli bütün şubelerin aylarına bakar" },
  { id: "dataset.companyMonths", where: "src/server/data/dataset.ts#loadDataset", kind: "ortak-veri", reason: "İşletmenin günü: işletme geneli giderler Tümü'nün açık günüyle oranlanır" },
  { id: "dataset.companyWaterSales", where: "src/server/data/dataset.ts#companyWaterSales", kind: "ortak-veri", reason: "Su + buz litre fiyatı tek faturadan, bütün şubelerin litresine bölünür" },
  { id: "asistan.isletme-geneli", where: "src/server/assistant-ops/resolve.ts#expenseBranch", kind: "yazim", reason: "Okuma değil: asistanın yazdığı gider ve hatırlatıcının işletme geneli hedefi" },
  // Alanlar (kişinin tercihi; areaScope): parça 4 Ödemeler, Nakit planı, Tedarikçiler, Komisyon
  {
    id: "alan.odemeler",
    where:
      "src/app/panel/hatirlaticilar/page.tsx#RemindersContent; src/app/panel/page.tsx#DashboardContent; src/server/data/today.ts#adminFacts; src/server/actions/notifications.ts#loadPanelNotifications; src/server/mcp/tools.ts#odemeler",
    kind: "alan",
    area: "odemeler",
    reason: "Ödemeler, Bugün, zil, Genel bakış ve bağlantının ödemeler aracı: firma kipinde bütün şubelerin ödemeleri ve faturaları",
  },
  {
    id: "alan.nakit",
    where: "src/app/panel/hatirlaticilar/nakit/page.tsx#CashPlanContent; src/app/panel/page.tsx#DashboardContent; src/server/mcp/tools.ts#odemeler",
    kind: "alan",
    area: "nakit",
    reason: "Nakit planı ekranı, Genel bakış'ın kartı ve bağlantının nakit planı: firma kipinde firmanın planı",
  },
  {
    id: "alan.tedarikciler",
    where:
      "src/app/panel/tedarikciler/page.tsx#SuppliersContent; src/app/panel/tedarikciler/[cari]/page.tsx#SupplierContent; src/server/mcp/tools.ts#tedarikci_ozeti; src/app/api/export/route.ts#exportWorkbook",
    kind: "alan",
    area: "tedarikciler",
    reason: "Tedarikçi bakiyeleri ve dışa aktarımın Cari hareketleri sayfası: firma kipinde tedarikçinin bütün faturaları ve carisi",
  },
  {
    id: "alan.komisyon",
    where: "src/server/data/commission.ts#loadCommissionReports; src/server/data/commission.ts#loadCommissionAlerts; src/server/data/commission.ts#loadOverduePayouts",
    kind: "alan",
    area: "komisyon",
    reason: "Komisyon ekranı, zil ve Bugün'ün Hakedişler satırı: firma kipinde bütün kanalların hakedişi",
  },
  {
    id: "nakit.bakiye",
    where: "src/server/data/cash-plan.ts#loadAreaCashPlan",
    kind: "yalniz-firma",
    reason: "Nakit açılış bakiyesi firmanın parası: şubenin akışında da firmanın planından okunur (bakiye ve İşletme geneli satırı)",
  },
  // Alanlar: parça 5 Tutarlılık, Mutabakat, Stok değeri
  {
    id: "alan.tutarlilik",
    where: "src/app/panel/tutarlilik/page.tsx#ConsistencyContent; src/app/api/export/route.ts#exportWorkbook",
    kind: "alan",
    area: "tutarlilik",
    reason: "Tutarlılık ve dışa aktarımın Tutarlılık sayfası: firma kipinde bütün şubelerin satışı, sayımı ve bütün faturaların alımı",
  },
  {
    id: "alan.mutabakat",
    where: "src/app/panel/mutabakat/page.tsx#ReconContent",
    kind: "alan",
    area: "mutabakat",
    reason: "Mutabakat: firma kipinde ekstrenin bütün hareketleri ve bütün şubelerin POS hakedişi tek listede",
  },
  {
    id: "alan.stok_degeri",
    where:
      "src/server/data/dataset.ts#readDataset; src/app/panel/sayim/page.tsx#StockContent; src/app/panel/sayim/actions.ts#saveStaffStockExtras; src/app/panel/ayarlar/page.tsx#SettingsContent",
    kind: "alan",
    area: "stok_degeri",
    reason: "Stok değeri: firma kipinde FIFO havuzu bütün faturalar, devir işletme geneli, ek kalem fiyatı bütün şubelerin geçmişi",
  },
  {
    id: "komisyon.oran",
    where: "src/server/data/commission.ts#loadLightReport; src/server/data/commission.ts#loadCommissionReports",
    kind: "ortak-veri",
    reason: "Komisyon oranı ve hakediş işletmenin: bütün faturalar ÷ bütün şubelerin satışı; şubenin payı ve hakediş satırları bununla",
  },
  // Alanlar: parça 6 Şubeleri yan yana (İşletme geneli giderler okumayı değiştirmez: kip veri kümesinin bayrağı,
  // sharedCostsHidden; şubenin kârı iki kipte aynı)
  {
    id: "alan.karsilastirma",
    where: "src/server/data/sube-karsilastirma.ts#loadBranchCompare; src/server/data/iscilik.ts#loadLaborReport; src/server/data/branch-day.ts#loadBranchDay",
    kind: "alan",
    area: "karsilastirma",
    reason: "Şube karşılaştırma, İşçilik / ciro ve Bugün'ün Şubelerde gün kartı: Yan yana kipinde bütün şubeler, Yalnız seçili şube kipinde seçim",
  },
];

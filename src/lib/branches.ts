/**
 * Şubeler ve kanallar (docs/SUBE.md): kafenin fiziksel şubeleri (Tuzla, Marina) ile laffogato.net'in online kanalı
 * TEK listede durur. Ciro, kasa ve giderler bu kimliğe göre ayrılır; menü, reçete ve hammadde ortaktır (sahibin
 * kararı, 4 Kasım 2026) — yalnız satış fiyatı ile "Satışta / Tükendi" şubeye göre değişebilir (dalga 2).
 *
 * Saf: veritabanına ve Next'e bağlı değil, kurallar burada ve `tests/subeler.test.ts` doğrudan çalıştırır.
 */

/** Panelin varsayılan şubesi; şubesiz geçmiş veri bununla işaretlendi (migration 0054) */
export const DEFAULT_BRANCH_ID = "tuzla";
/** laffogato.net: fiziksel şube değil, kendi cirosu olan ayrı satış kanalı */
export const ONLINE_BRANCH_ID = "online";
/** Silinemeyen, pasife alınamayan kayıtlar: panel bunlar olmadan ciroyu bölemez */
export const FIXED_BRANCH_IDS: readonly string[] = [DEFAULT_BRANCH_ID, ONLINE_BRANCH_ID];

export const BRANCH_ID_MAX = 24;
export const BRANCH_NAME_MAX = 60;
/** Kimlik adreste ve çerezde geçer: harfle başlar, küçük harf / rakam / tire */
export const BRANCH_ID_PATTERN = /^[a-z][a-z0-9-]{1,23}$/;

export type BranchKind = (typeof BRANCH_KINDS)[number];
export const BRANCH_KINDS = ["fiziksel", "online"] as const;
export const BRANCH_KIND_LABEL: Record<BranchKind, string> = { fiziksel: "Şube", online: "Online kanal" };

/** Gün sonu hangi sistemden gelir (docs/SUBE.md › Kasa kaynağı) */
export type BranchPosSource = (typeof BRANCH_POS_SOURCES)[number];
export const BRANCH_POS_SOURCES = ["modpos", "lafpos", "yok"] as const;
export const BRANCH_POS_SOURCE_LABEL: Record<BranchPosSource, string> = {
  modpos: "ModPOS (Gafdigi)",
  lafpos: "LafPOS",
  yok: "Kasa yok",
};

export interface BranchRow {
  id: string;
  name: string;
  kind: BranchKind;
  posSource: BranchPosSource;
  active: boolean;
  /** Açılış günü (YYYY-MM-DD); boşsa "başından beri" */
  openedOn: string | null;
  sortOrder: number;
  /**
   * Banka POS komisyon oranı (0,02 = %2; branches.pos_rate, varsayılan %2): banka POS komisyonu şube şube bu oranla
   * (engine.ts posCommission). Tohum ve eski okuyucular vermez (veritabanının varsayılanı)
   */
  posRate?: number;
}

/** İlk kurulumda ve boş veritabanında yazılan kayıtlar (idempotent; scripts/seed.ts) */
export const DEFAULT_BRANCHES: readonly Omit<BranchRow, "active">[] = [
  { id: DEFAULT_BRANCH_ID, name: "Tuzla", kind: "fiziksel", posSource: "modpos", openedOn: null, sortOrder: 1 },
  { id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", openedOn: null, sortOrder: 2 },
  { id: ONLINE_BRANCH_ID, name: "laffogato.net", kind: "online", posSource: "yok", openedOn: null, sortOrder: 3 },
];
/** Tohumun bir kez çalıştığının işareti (integration_state) */
export const BRANCH_SEED_KEY = "branches_seeded";

/** Şube süzgecinin "Tümü" değeri: işletme geneli */
export const ALL_BRANCHES = "hepsi";
/** Seçili şube: tek bir şubenin kimliği ya da "hepsi" */
export type BranchScope = string;
/** Seçimi taşıyan çerez ve sorgu parametresi */
export const BRANCH_COOKIE = "laf_sube";
export const BRANCH_PARAM = "sube";

/** Kimliğin kuralı; sorun yoksa null (yeni şube formu ve eylem aynı metni verir) */
export function branchIdError(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "Şube kimliği gerekli";
  const id = raw.trim();
  if (id.length > BRANCH_ID_MAX) return `Şube kimliği en çok ${BRANCH_ID_MAX} karakter olabilir`;
  if (!BRANCH_ID_PATTERN.test(id)) return "Şube kimliği harfle başlamalı; yalnız küçük harf, rakam ve tire içerebilir";
  if (id === ALL_BRANCHES) return "Bu kimlik ayrılmış; başka bir kimlik seçin";
  return null;
}

/** Addan kimlik önerir: "Laffogato Marina" -> "laffogato-marina" */
export function suggestBranchId(name: string): string {
  const harita: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u" };
  const temiz = [...name.toLocaleLowerCase("tr-TR")].map((h) => harita[h] ?? h).join("");
  return temiz
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^([^a-z])/, "s$1")
    .slice(0, BRANCH_ID_MAX);
}

/**
 * Şubenin varsayılan banka POS komisyon oranı (branches.pos_rate; sahibin kararı, 23 Kasım 2026: iki şube %2). Yönetici
 * Şubeler'den değiştirir; banka POS komisyonu şube şube kart × oran (src/lib/calc/engine.ts posCommission)
 */
export const DEFAULT_POS_RATE = 0.02;
/** Oranın üst sınırı (%10): bankaların POS oranı bunun çok altında, yazım hatası (2 yerine 20) kaydedilmesin */
export const POS_RATE_MAX = 0.1;

/** POS oranı geçerli mi (0 ile %10 arası, 0 dahil: komisyonsuz anlaşma); geçersizse nedeni */
export function posRateError(rate: number): string | null {
  if (!Number.isFinite(rate) || rate < 0) return "POS oranını yüzde olarak yazın (ör. 2)";
  if (rate > POS_RATE_MAX) return `POS oranı en çok %${POS_RATE_MAX * 100} olabilir`;
  return null;
}

/** Tip ile kasa kaynağı birbirine uymalı: online kanalın kasası olmaz, fiziksel şube kasasız kalmaz */
export function branchSourceError(kind: BranchKind, posSource: BranchPosSource): string | null {
  if (kind === "online" && posSource !== "yok") return "Online kanalın kasası olmaz; kasa kaynağını “Kasa yok” seçin";
  if (kind === "fiziksel" && posSource === "yok") return "Şubenin kasa kaynağını seçin (ModPOS ya da LafPOS)";
  return null;
}

/**
 * Var olan bir kaydın değiştirilmesi serbest mi (docs/SUBE.md › Kurallar): kimlik veriye yazılıdır, değişmez;
 * Tuzla ve laffogato.net silinemez, pasife alınamaz ve tipi değişmez; son etkin fiziksel şube kapatılamaz.
 */
export function branchChangeError(
  current: BranchRow,
  next: { kind: BranchKind; posSource: BranchPosSource; active: boolean },
  others: readonly BranchRow[],
): string | null {
  const sabit = FIXED_BRANCH_IDS.includes(current.id);
  if (sabit && next.kind !== current.kind) return `${current.name} kaydının türü değiştirilemez`;
  if (sabit && !next.active) return `${current.name} kapatılamaz: panelin ciroyu bölmesi buna bağlı`;
  const uyumsuz = branchSourceError(next.kind, next.posSource);
  if (uyumsuz) return uyumsuz;
  if (!next.active && current.active && next.kind === "fiziksel") {
    const kalan = others.filter((b) => b.kind === "fiziksel" && b.active);
    if (!kalan.length) return "En az bir şube açık kalmalı";
  }
  return null;
}

/** Silinebilir mi: sabit kayıtlar ve üzerinde verisi olan şube silinmez (veri sayısı çağırandan gelir) */
export function branchDeleteError(branch: BranchRow, usageCount: number): string | null {
  if (FIXED_BRANCH_IDS.includes(branch.id)) return `${branch.name} silinemez`;
  if (usageCount > 0) return `${branch.name} silinemez: bu şubeye yazılmış ${usageCount} kayıt var. Önce kapatın`;
  return null;
}

/** Listeyi ekranda ve seçicide görünen sıraya koyar (sıra, sonra ad) */
export function sortBranches<T extends { sortOrder: number; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
}

/**
 * Kasası olan şubeler: etkin fiziksel şubeler, ekrandaki sırayla (online kanalın kasası olmaz). "Tümü"de birden çoksa
 * kasa raporu okuyan ekranlar (Bugün, zil, Claude) her kasayı ayrı gösterir: aynı güne iki rapor düşer
 */
export function tillBranches<T extends Pick<BranchRow, "kind" | "active" | "sortOrder" | "name">>(rows: readonly T[]): T[] {
  return sortBranches(rows.filter((b) => b.kind === "fiziksel" && b.active));
}

/** Kasadan ödemenin kasası belirsizken (Tümü ya da online kanal, birden çok kasa) eylemin ve formun metni */
export const TILL_REQUIRED = "Kasadan ödeme hangi şubenin kasasından çıktı? Şubeyi seçin";

/**
 * Tedarikçiye kasadan ödemenin yeni Teslim satırının varsayılan kasası (docs/SUBE.md › Yazarken hangi şube): seçili
 * fiziksel şube; tek kasa açıksa o. "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa null: pencere şubeyi
 * sorar. Tedarikçiler işletme geneli bir ekrandır ve çoğu zaman "Tümü"de açılır; satır sessizce Tuzla'ya inseydi iki
 * şubenin kasa farkı da ödeme kadar şaşardı (denetim 21 Kasım #31).
 */
export function defaultTill(scope: BranchScope, branches: readonly BranchRow[]): string | null {
  const tills = tillBranches(branches);
  if (tills.some((b) => b.id === scope)) return scope;
  if (tills.length === 1) return tills[0].id;
  return tills.length ? null : DEFAULT_BRANCH_ID;
}

/**
 * Eylemin kararı: pencerede seçilen kasa etkin bir fiziksel şube olmalı; seçim gelmediyse `defaultTill`, o da
 * belirsizse kayıt reddedilir (seçimsiz kayıt "Tümü"de Tuzla'ya inmez).
 */
export function chooseTill(raw: string | null | undefined, scope: BranchScope, branches: readonly BranchRow[]): { id: string } | { error: string } {
  if (raw) return tillBranches(branches).some((b) => b.id === raw) ? { id: raw } : { error: "Şube bulunamadı ya da pasif (sayfayı yenileyin)" };
  const id = defaultTill(scope, branches);
  return id ? { id } : { error: TILL_REQUIRED };
}

/**
 * Kasanın adı ve kimliği metinlerde ve bağlantılarda (kasa e-postası, WhatsApp metni, "Panelde aç"): birden çok kasa
 * açıkken şube, tek kasada null (metin ve bağlantı bugünkü gibi). Zil (src/server/bell/kasa.ts) aynı kuralla yazar
 */
export function namedTill(rows: readonly BranchRow[], id: string): { id: string; name: string } | null {
  if (tillBranches(rows).length < 2) return null;
  return { id, name: rows.find((b) => b.id === id)?.name ?? id };
}

/**
 * Formun gönderdiği kasa (kasa raporu, geç rapor, düzeltme ve silme isteği, kasadan çıkan; docs/SUBE.md › Yazarken hangi
 * şube): yazım formun gösterdiği kasaya iner, gönderim anındaki seçime değil (seçim başka bir sekmede değişmiş
 * olabilir; çerez sekmeler arasında ortak). Kasa etkin bir fiziksel şube olmalı; şubesine kilitli personel yalnız kendi
 * şubesine yazar (`lock`). Sorun yoksa null, varsa kullanıcının göreceği metin.
 */
export function formTillError(raw: string, known: readonly BranchRow[], lock: string | null): string | null {
  return formPhysicalError(raw, known, lock, { has: "kasası", to: "kasasına" });
}

/**
 * Formun gönderdiği sayım şubesi (stok sayımı, "Listede olmayanlar", "Listeye ekle"; docs/SUBE.md › Yazarken hangi
 * şube): `formTillError`'ın sayım karşılığı. Sayım formun gösterdiği şubeye iner, gönderim anındaki seçime değil; şube
 * etkin bir fiziksel şube olmalı (kanalın stoğu olmaz), şubesine kilitli personel yalnız kendi şubesini sayar.
 */
export function formCountError(raw: string, known: readonly BranchRow[], lock: string | null): string | null {
  return formPhysicalError(raw, known, lock, { has: "stoğu", to: "sayımına" });
}

/** Kasa ve sayım formlarının ortak kuralı; metinler yalnız neye yazıldığını söyler */
function formPhysicalError(raw: string, known: readonly BranchRow[], lock: string | null, words: { has: string; to: string }): string | null {
  const b = known.find((x) => x.id === raw);
  if (!b || !b.active) return "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin";
  if (b.kind !== "fiziksel") return `${b.name} kanalının ${words.has} olmaz; sayfayı yenileyin`;
  if (lock !== null && raw !== lock) return `Hesabınız ${known.find((x) => x.id === lock)?.name ?? lock} şubesinde; ${b.name} ${words.to} yazamazsınız`;
  return null;
}

/**
 * Kimliğiyle açılan kaydın şubesi (kasadan çıkan, zayi, kasa raporu, kasa ve fiş fotoğrafı; docs/SUBE.md › Personel
 * hesabının şubesi): şubesine kilitli personel (`lock`) başka şubenin kaydını düzeltemez, silemez, isteğe konu edemez,
 * fotoğrafını göremez. Kimlikler sıralıdır ve eylem kimliği istemci paketindedir; seçicinin kilidi yalnız ekranı
 * süzüyordu (21 Kasım denetimi #14). Kilit yoksa (yönetici, şubesiz personel, şubesi pasif) ya da kaydın şubesi yoksa
 * null; başka şubeninse kullanıcının göreceği metin.
 */
export function otherBranchError(branchId: string | null | undefined, known: readonly BranchRow[], lock: string | null): string | null {
  if (lock === null || branchId == null || branchId === lock) return null;
  const name = (id: string) => known.find((x) => x.id === id)?.name ?? id;
  return `Bu kayıt ${name(branchId)} şubesinin; hesabınız ${name(lock)} şubesinde`;
}

/**
 * Adresten / çerezden gelen seçim: tanınmayan, kapalı ya da boş değer "hepsi"ye düşer. Seçim veriyi süzer,
 * yetki vermez: yetki `requireAdmin`/`requireUser` ile ayrıca denetlenir.
 */
export function parseBranchScope(raw: unknown, known: readonly BranchRow[]): BranchScope {
  if (typeof raw !== "string" || !raw) return ALL_BRANCHES;
  if (raw === ALL_BRANCHES) return ALL_BRANCHES;
  return known.some((b) => b.id === raw && b.active) ? raw : ALL_BRANCHES;
}

/** Derin bağlantının (`?sube=`) seçicideki adımı (`branchLinkStep`) */
export interface BranchLinkStep {
  /** Seçicinin saklayacağı anahtar: adreste `?sube=` varken bağlantının kendisi (yol + sorgu), yoksa null */
  key: string | null;
  /** Yapılacak iş; null: adreste `?sube=` yok, şube kilitli ya da bu bağlantı zaten benimsendi */
  adopt: {
    /** Çereze yazılacak seçim; çerez zaten bu seçimdeyse null (yalnız adres temizlenir) */
    scope: BranchScope | null;
    /** `?sube=` düşürülmüş adres; öteki sorgu alanları sırasıyla korunur */
    href: string;
  } | null;
}

/**
 * Paylaşılan bağlantıdaki `?sube=`'nin çereze benimsetilmesi (docs/SUBE.md › Seçici). Seçici her adres ya da seçim
 * değişiminde bunu çağırır, dönen `key`'i saklar ve sonraki çağrıya `adopted` olarak verir:
 * - anahtar BAĞLANTININ KENDİSİDİR, seçilen değer değil: her bağlantı bir kez benimsenir; adreste `?sube=` kalmayınca
 *   anahtar sıfırlanır, yani aynı bağlantı sonradan yeniden açılınca yine benimsenir;
 * - `?sube=` çerezle aynı olsa da adresten düşer: adreste kalmış eski `?sube=` seçiciden sonradan yapılan seçimi geri
 *   almaz (denetim 21 Kasım #22);
 * - şubesi kilitli personelde benimsenmez (sunucu da reddeder).
 */
export function branchLinkStep(o: {
  pathname: string;
  /** Adresin sorgusu (`useSearchParams().toString()`; baştaki `?` olsa da olur) */
  search: string;
  /** Çerezdeki seçim (sunucunun verdiği) */
  scope: BranchScope;
  branches: readonly BranchRow[];
  locked: boolean;
  /** Önceki çağrının anahtarı */
  adopted: string | null;
}): BranchLinkStep {
  const params = new URLSearchParams(o.search);
  if (o.locked || !params.has(BRANCH_PARAM)) return { key: null, adopt: null };
  const key = `${o.pathname}?${params.toString()}`;
  if (o.adopted === key) return { key, adopt: null };
  const istenen = parseBranchScope(params.get(BRANCH_PARAM), o.branches);
  params.delete(BRANCH_PARAM);
  const qs = params.toString();
  return { key, adopt: { scope: istenen === o.scope ? null : istenen, href: qs ? `${o.pathname}?${qs}` : o.pathname } };
}

/** Seçimin ekrandaki adı ("Tümü", "Marina") */
export function branchScopeLabel(scope: BranchScope, known: readonly BranchRow[]): string {
  if (scope === ALL_BRANCHES) return "Tümü";
  return known.find((b) => b.id === scope)?.name ?? "Tümü";
}

/** Seçime giren şube kimlikleri: "hepsi" bütün etkinleri, tek seçim yalnız kendini verir */
export function branchScopeIds(scope: BranchScope, known: readonly BranchRow[]): string[] {
  if (scope === ALL_BRANCHES) return sortBranches(known.filter((b) => b.active)).map((b) => b.id);
  return known.some((b) => b.id === scope) ? [scope] : [];
}

/**
 * Elle girilmiş Gelir-gider hücrelerinden şube görünümünde kalanlar (pnl_entries şubesiz, işletmenin tutarlarıdır):
 * - `manual:*` (su, doğalgaz, harici…) işletme genelidir: şube görünümünde kâra girmez, "İşletme geneli payı (bilgi)"
 *   satırının toplamındadır (Faz 5; su litresinin fiyatı için de okunur);
 * - `fixed:` / `stopaj:` yalnız şubenin ya da işletme genelinin kalemiyse (silinmiş kalemin girişi işletme geneli);
 * - `personnel:*`, `commission:pos`, `stock:*` işletmenin toplamıdır: şubede hesaplanan değer geçer.
 */
export function branchPnlEntry(rowKey: string, fixedInScope: ReadonlySet<number>, fixedAll: ReadonlySet<number>): boolean {
  if (rowKey.startsWith("manual:")) return true;
  const fixed = /^(?:fixed|stopaj):(\d+)$/.exec(rowKey);
  if (fixed) {
    const id = Number(fixed[1]);
    return fixedInScope.has(id) || !fixedAll.has(id);
  }
  return false;
}

/** İşletmenin toplamı olan Gelir-gider hücresi (devir, personel, POS komisyonu): tek şube seçiliyken elle yazılmaz */
export function companyPnlKey(rowKey: string): boolean {
  return /^(?:personnel|commission|stock):/.test(rowKey);
}

/**
 * "Tümü"de aylık ciro ve açık gün yazılmaz (birden çok kasa açıkken): Tümü şubelerin toplamıdır (src/lib/cash-month.ts
 * resolveBranchMonths), yazılan ise tek şubenin (Tuzla) ay satırına inerdi; öteki şubenin cirosu ya iki kez sayılır ya da
 * hücre yazılandan farklı bir rakam gösterirdi, "kasaya dön" yalnız Tuzla'yı boşaltırdı. Gelir-gider hücreyi kilitler,
 * sunucu reddeder (setMonthField). Tek şube seçiliyken ya da tek kasa varken "Tümü" o şubedir, yazılır. Satışlar'ın ay
 * formu "Tümü"de yazdığı şubeyi adıyla söyleyip onun satırını gösterir
 */
export function monthTotalsLocked(scope: BranchScope, known: readonly BranchRow[]): boolean {
  return scope === ALL_BRANCHES && tillBranches(known).length > 1;
}

/** Kilitli ciro ve açık gün hücresinin açıklaması (monthTotalsLocked) */
export const MONTH_TOTALS_LOCKED_TEXT = "Tümü'de şubelerin toplamı görünür: ciro ve açık günü yazmak için soldan şubeyi seçin.";

/**
 * Gelir-gider'de "Tümü" seçiliyken ay bilgisinin notu (docs/SUBE.md › Yazarken hangi şube): ciro ve açık gün şubelerin
 * toplamıdır, yazılmaz (monthTotalsLocked); ay notu şube başınadır, "Tümü"nde varsayılan şubeye (Tuzla) iner, Satışlar'daki
 * ay bilgisi gibi. Yalnız birden çok kasa açıkken; tek şube seçiliyken ya da tek kasa varken null (yazılan zaten
 * gösterilen satırdır)
 */
export function monthWriteNote(scope: BranchScope, known: readonly BranchRow[]): string | null {
  if (!monthTotalsLocked(scope, known)) return null;
  const name = known.find((b) => b.id === DEFAULT_BRANCH_ID)?.name ?? "Tuzla";
  return `Tümü seçili: aylık ciro ve açık gün şubelerin toplamıdır, burada yazılmaz; yazmak için soldan şubeyi seçin. Ay notu ${name} şubesinin ay satırına yazılır.`;
}

/**
 * Şube görünümünün bilgi notu (Gelir-gider, Genel bakış): neyin şubenin, neyin işletme genelinin olduğu
 * (docs/SUBE.md › Şube görünümünde maliyet)
 */
export function branchViewNote(b: { name: string; kind: BranchKind }): { title: string; text: string } {
  const [what, to, of] = b.kind === "online" ? ["kanal", "kanala", "kanalın"] : ["şube", "şubeye", "şubenin"];
  return {
    title: `${b.name} seçili: yalnız bu ${what}; işletme geneli giderler bilgi olarak`,
    text:
      `Ciro, kasa, personel ve bu ${to} bağlı giderler yalnız bu ${of}. İşletme geneli giderler (şubesi seçilmemiş harcama ve sabit ` +
      `gider, Gelir-gider'e elle yazılan tutarlar, komisyon faturaları) ${of} kârına girmez: "İşletme geneli payı (bilgi)" satırında ` +
      `toplamı görünür, Tümü'de bir kez sayılır (bölüştürme yok). Mal maliyeti ${of} satışından reçeteye göre (faturalar ve stok devri ` +
      `işletme genelinde). İşletmenin toplamı, sayımlı mal maliyeti ve elle yazılan tutarlar için soldan Tümü'nü seçin.`,
  };
}

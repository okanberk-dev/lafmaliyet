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
 * Adresten / çerezden gelen seçim: tanınmayan, kapalı ya da boş değer "hepsi"ye düşer. Seçim veriyi süzer,
 * yetki vermez: yetki `requireAdmin`/`requireUser` ile ayrıca denetlenir.
 */
export function parseBranchScope(raw: unknown, known: readonly BranchRow[]): BranchScope {
  if (typeof raw !== "string" || !raw) return ALL_BRANCHES;
  if (raw === ALL_BRANCHES) return ALL_BRANCHES;
  return known.some((b) => b.id === raw && b.active) ? raw : ALL_BRANCHES;
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
 * - `manual:*` (su, doğalgaz, harici…) işletme geneli gider gibi her şubede görünür;
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
 * Şube görünümünün bilgi notu (Gelir-gider, Genel bakış): neyin şubenin, neyin işletme genelinin olduğu
 * (docs/SUBE.md › Şube görünümünde maliyet)
 */
export function branchViewNote(b: { name: string; kind: BranchKind }): { title: string; text: string } {
  const [what, to, of] = b.kind === "online" ? ["kanal", "kanala", "kanalın"] : ["şube", "şubeye", "şubenin"];
  return {
    title: `${b.name} seçili: yalnız bu ${what} ve işletme geneli giderler`,
    text:
      `Ciro, kasa, personel ve bu ${to} bağlı giderler yalnız bu ${of}. İşletme geneli giderler (şubesi seçilmemiş harcama ve sabit ` +
      `gider, Gelir-gider'e elle yazılan tutarlar) her şubede sayılır; faturalar ortaktır. Mal maliyeti ${of} satışından reçeteye göre ` +
      `(stok devri işletme genelinde). İşletmenin toplamı ve sayımlı mal maliyeti için soldan Tümü'nü seçin.`,
  };
}

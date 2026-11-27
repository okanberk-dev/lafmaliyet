/**
 * Şubeler ve kanallar (docs/SUBE.md): kafenin fiziksel şubeleri (Tuzla, Marina) ile laffogato.net'in online kanalı
 * TEK listede durur. Ciro, kasa ve giderler bu kimliğe göre ayrılır; menü, reçete ve hammadde ortaktır (sahibin
 * kararı, 4 Kasım 2026) — yalnız satış fiyatı ile "Satışta / Tükendi" şubeye göre değişebilir (dalga 2).
 *
 * Saf: veritabanına ve Next'e bağlı değil, kurallar burada ve `tests/subeler.test.ts` doğrudan çalıştırır.
 */

import { z } from "zod";

/** Panelin varsayılan şubesi; şubesiz geçmiş veri bununla işaretlendi (migration 0054) */
export const DEFAULT_BRANCH_ID = "tuzla";
/** laffogato.net: fiziksel şube değil, kendi cirosu olan ayrı satış kanalı */
export const ONLINE_BRANCH_ID = "online";
/** Silinemeyen, pasife alınamayan kayıtlar: panel bunlar olmadan ciroyu bölemez */
export const FIXED_BRANCH_IDS: readonly string[] = [DEFAULT_BRANCH_ID, ONLINE_BRANCH_ID];
/**
 * Karaokenin şubesi dışındaki şubeye kilitli personelin karaoke ekranı ve eylemleri. Karaokenin şubesi sabit değil, şube
 * özelliğinden okunur (`branches.features`, src/lib/branch-features.ts › karaokeBranchOf; sahibin varsayılanı Tuzla)
 */
export const KARAOKE_ELSEWHERE = "Karaoke bu şubede kullanılmıyor";

export const BRANCH_ID_MAX = 24;
export const BRANCH_NAME_MAX = 60;
/** Kimlik adreste ve çerezde geçer: harfle başlar, küçük harf / rakam / tire */
export const BRANCH_ID_PATTERN = /^[a-z][a-z0-9-]{1,23}$/;

export type BranchKind = (typeof BRANCH_KINDS)[number];
export const BRANCH_KINDS = ["fiziksel", "online"] as const;
export const BRANCH_KIND_LABEL: Record<BranchKind, string> = { fiziksel: "Şube", online: "Online kanal" };

/** Gün sonu hangi sistemden gelir (docs/SUBE.md › Kasa kaynağı) */
export type BranchPosSource = (typeof BRANCH_POS_SOURCES)[number];
export const BRANCH_POS_SOURCES = ["modpos", "asilpos", "yok"] as const;
export const BRANCH_POS_SOURCE_LABEL: Record<BranchPosSource, string> = {
  modpos: "ModPOS (Gafdigi)",
  asilpos: "AsilPOS",
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
  /**
   * Şubenin açık özellikleri (branches.features: karaoke, uygulama siparişi, garson çağır, yemek kartı; şube kapsamı B6,
   * src/lib/branch-features.ts). Okunmamışsa (eski okuyucu, test verisi) bugünkü davranış: `branchFeatures`
   */
  features?: string[];
}

/** İlk kurulumda ve boş veritabanında yazılan kayıtlar (idempotent; scripts/seed.ts) */
export const DEFAULT_BRANCHES: readonly Omit<BranchRow, "active">[] = [
  // Özellikler sahibin varsayılanı (src/lib/branch-features.ts): karaoke Tuzla'da, sipariş, garson ve yemek kartı her şubede
  { id: DEFAULT_BRANCH_ID, name: "Tuzla", kind: "fiziksel", posSource: "modpos", openedOn: null, sortOrder: 1, features: ["karaoke", "siparis", "garson", "yemek_karti"] },
  // Marina'nın kasası AsilPOS (sahibin kararı, 27 Kasım 2026: Marina'da ModPOS tamamen bitti; göç 0099 canlıdakini çevirir)
  { id: "marina", name: "Marina", kind: "fiziksel", posSource: "asilpos", openedOn: null, sortOrder: 2, features: ["siparis", "garson", "yemek_karti"] },
  { id: ONLINE_BRANCH_ID, name: "laffogato.net", kind: "online", posSource: "yok", openedOn: null, sortOrder: 3, features: [] },
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
  if (kind === "fiziksel" && posSource === "yok") return "Şubenin kasa kaynağını seçin (ModPOS ya da AsilPOS)";
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

/** Şubenin e-postası başka bir hesapta (createBranch, sendBranchInstall) */
export const BRANCH_EMAIL_TAKEN = "Bu e-posta başka bir hesapta kayıtlı; şube için ayrı bir adres yazın";

/**
 * Şubenin e-postası var olan bir hesapta mı (kurulum o hesabı şubenin panel hesabı sayar, AsilPOS kurulum bağlantısı
 * oraya gider; docs/ASILPOS.md › Şube kurulumu). Beyaz liste: yalnız personel hesabı kabul edilir, o da şubesizse ya da
 * bu şubedeyse. Yönetici, müdür, muhasebeci ve tanınmayan rol hep reddedilir (varsayılan kapalı)
 */
export function branchEmailTaken(dup: { role: string; branchId: string | null } | null | undefined, branchId: string): boolean {
  return !!dup && (dup.role !== "staff" || (dup.branchId !== null && dup.branchId !== branchId));
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

/**
 * Seçim bir online kanal mı (şube ayrımı, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Ayarsız sızıntılar): kanalın kasası,
 * stoğu ve vardiyası yoktur. Kanal seçiliyken Bugün, zil ve kasa listeleri Tuzla'nın kasasını göstermez; "Bu kanalın
 * kasası ve stoğu yok" der. Kanalın satırı; "Tümü", fiziksel şube ya da bilinmeyen kimlikte null
 */
export function selectedChannel<T extends Pick<BranchRow, "id" | "kind">>(scope: BranchScope, known: readonly T[]): T | null {
  if (scope === ALL_BRANCHES) return null;
  return known.find((b) => b.id === scope && b.kind === "online") ?? null;
}

/** Online kanal seçiliyken kasa ve stok satırlarının yerindeki tek metin (Bugün, Kasadaki fiyatlar) */
export const CHANNEL_NO_TILL = "Bu kanalın kasası ve stoğu yok";

/**
 * İşletme geneli ekranda gösterilen kasa satırları (Tedarikçiler'in işlenmemiş kasa ödemeleri; docs/SUBE.md › Ödemeler):
 * her satır kasasının adını (birden çok kasa açıkken, `namedTill`) ve seçili kapsamda olup olmadığını taşır. Tek şube
 * seçiliyken ekran yalnız o şubenin satırlarını gösterir, öbür şubelerinkini yalnız sayar ("Öbür şubede N satır daha");
 * "Tümü"de hepsi kapsamdadır. Cari işletme genelidir: satırın kendisi süzülmez, yalnız gösterim.
 */
export function tillRowsInScope<T extends { branchId: string }>(
  rows: readonly T[],
  scope: BranchScope,
  known: readonly BranchRow[],
): (T & { tillName: string | null; inScope: boolean })[] {
  return rows.map((r) => ({ ...r, tillName: namedTill(known, r.branchId)?.name ?? null, inScope: scope === ALL_BRANCHES || r.branchId === scope }));
}

/**
 * Personel isteğinin (Onaylar kartı, zil satırı, sabah e-postasının "Onay bekleyenler"i) seçili kapsamda olup olmadığı
 * (docs/SUBE.md › Onaylar): "Tümü"de hepsi; tek şube seçiliyken yalnız o şubenin istekleri. Şubesi bilinmeyen istek
 * (mal taslağı, kaydı silinmiş eski istek) her kapsamda görünür: onay bekleyen bir iş gizlenmesin
 */
export function requestInScope(branchId: string | null, scope: BranchScope): boolean {
  return scope === ALL_BRANCHES || branchId === null || branchId === scope;
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
  if (!b || !b.active) return FORM_BRANCH_GONE;
  if (b.kind !== "fiziksel") return `${b.name} kanalının ${words.has} olmaz; sayfayı yenileyin`;
  return lockError(raw, b.name, known, lock, words.to);
}

const FORM_BRANCH_GONE = "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin";

/** Şubesine kilitli personel yalnız kendi şubesine yazar; değilse null */
function lockError(raw: string, name: string, known: readonly BranchRow[], lock: string | null, to: string): string | null {
  if (lock === null || raw === lock) return null;
  return `Hesabınız ${known.find((x) => x.id === lock)?.name ?? lock} şubesinde; ${name} ${to} yazamazsınız`;
}

/**
 * Formun şubesinin türü (docs/SUBE.md › Yazarken hangi şube; `formBranch`, src/server/branch-scope.ts):
 * - `till`, `count`, `waste`: kasa, stok sayımı, zayi ve ikram. Etkin fiziksel şube (kanalın kasası, stoğu, zayisi olmaz);
 * - `sales`: Satışlar ve Gelir-gider'in ay bilgisi (ciro, açık gün, not) ve satış listesi. Etkin fiziksel şube: online
 *   kanalın kasa satışı yoktur, kanal seçiliyken yazılan ay "online" şubesine inmesin;
 * - `expense`: aylık harcama ve cari giderleri. Etkin herhangi bir şube ya da açıkça işletme geneli (`EXPENSE_SHARED`);
 * - `checklist`: bütün şubelerin kontrol listesinin günlük kaydı (şube ayrımı, 27 Kasım 2026). Etkin fiziksel şube: her
 *   şube listeyi kendi kaydına doldurur; şubeli listenin kaydı hep listenin şubesindedir (bu kapıdan geçmez).
 */
export type FormBranchKind = "till" | "count" | "waste" | "sales" | "expense" | "checklist";

/** Gider formunun "İşletme geneli" seçimi: şubesiz gider (sahibin kararı 4 Kasım 2026) */
export const EXPENSE_SHARED = "isletme";

/** "Tümü" seçiliyken (birden çok kasa açık) şubeye özgü yazımın şubesi gelmediyse: sessizce Tuzla'ya inmez */
export const BRANCH_REQUIRED = "Hangi şubeye yazılsın? Şubeyi seçin";

/** Formun gösterdiği kapsam ile seçim ayrıştı (çerez sekmeler arasında ortak; `shownScopeError`) */
export const SCOPE_CHANGED = "Şube seçimi başka sekmede değişti; sayfayı yenileyin";

/** Online kanal seçiliyken satış yazımı (kanalın kasa satışı yok) */
export function salesChannelError(name: string): string {
  return `${name} kanalının kasa satışı yok; şube seçiciden şubeyi seçin`;
}

/**
 * Formun gönderdiği şube kimliği (boş değil) türüne uyuyor mu (`FormBranchKind`); şubesine kilitli personel yalnız
 * kendi şubesine yazar. Sorun yoksa null, varsa kullanıcının göreceği metin. Kasa ve sayım metinleri `formTillError`,
 * `formCountError` ile aynı.
 */
export function formBranchError(raw: string, kind: FormBranchKind, known: readonly BranchRow[], lock: string | null): string | null {
  if (kind === "till") return formTillError(raw, known, lock);
  if (kind === "count") return formCountError(raw, known, lock);
  if (kind === "waste") return formPhysicalError(raw, known, lock, { has: "zayisi", to: "zayisine" });
  if (kind === "checklist") return formPhysicalError(raw, known, lock, { has: "kontrol listesi", to: "kontrol listesine" });
  if (kind === "expense" && raw === EXPENSE_SHARED) {
    return lock === null ? null : `Hesabınız ${known.find((x) => x.id === lock)?.name ?? lock} şubesinde; işletme geneline yazamazsınız`;
  }
  const b = known.find((x) => x.id === raw);
  if (!b || !b.active) return FORM_BRANCH_GONE;
  if (kind === "sales" && b.kind !== "fiziksel") return salesChannelError(b.name);
  return lockError(raw, b.name, known, lock, kind === "sales" ? "satışına" : "giderine");
}

/**
 * Yazımın şubesinin kararı (saf; `formBranch` sunucuda bunu çağırır, tests/form-sube.test.ts kural tablosunu sınar):
 * - form şubeyi gönderdiyse (`raw`) o şube, `formBranchError`'dan geçerse. Gider formunda `EXPENSE_SHARED` işletme
 *   genelidir (`id: null`);
 * - göndermediyse (eski sekme) bugünkü kural, seçimden: kasa, sayım ve zayide seçili fiziksel şube (yoksa varsayılan
 *   şube); satışta seçili şube ("Tümü"de varsayılan şube), online kanal seçiliyken red; giderde seçili şube ("Tümü"de
 *   işletme geneli);
 * - `requireExplicit`: "Tümü" (ya da kasa ve sayımda online kanal) seçiliyken ve birden çok kasa açıkken şube gelmediyse
 *   red (`BRANCH_REQUIRED`), varsayılana düşülmez. Gider bundan etkilenmez ("Tümü"de işletme geneli bir seçimdir).
 */
export function pickFormBranch(o: {
  raw: string | null | undefined;
  kind: FormBranchKind;
  scope: BranchScope;
  known: readonly BranchRow[];
  lock: string | null;
  requireExplicit?: boolean;
}): { id: string | null } | { error: string } {
  if (o.raw) {
    const error = formBranchError(o.raw, o.kind, o.known, o.lock);
    if (error) return { error };
    return { id: o.kind === "expense" && o.raw === EXPENSE_SHARED ? null : o.raw };
  }
  if (o.kind === "expense") return { id: o.scope === ALL_BRANCHES ? null : o.scope };
  const chosen = o.known.find((b) => b.id === o.scope);
  const many = tillBranches(o.known).length > 1;
  if (o.kind === "sales") {
    if (chosen && chosen.kind !== "fiziksel") return { error: salesChannelError(chosen.name) };
    if (o.scope !== ALL_BRANCHES) return { id: o.scope };
    return o.requireExplicit && many ? { error: BRANCH_REQUIRED } : { id: DEFAULT_BRANCH_ID };
  }
  if (chosen?.kind === "fiziksel") return { id: chosen.id };
  return o.requireExplicit && many ? { error: BRANCH_REQUIRED } : { id: DEFAULT_BRANCH_ID };
}

/**
 * Formun gösterdiği kapsam (sayfa çizilirken seçili olan: şube kimliği ya da "hepsi") ile eylem anındaki seçim tutuyor
 * mu. Kapsamla silen yazımlar (Satışlar › Ayı temizle) bunu sorar: çerez sekmeler arasında ortaktır, Marina'nın
 * penceresi "Tümü"de onaylanınca iki şubenin listesi giderdi. Tutarsa null
 */
export function shownScopeError(shown: unknown, current: BranchScope): string | null {
  return typeof shown === "string" && shown === current ? null : SCOPE_CHANGED;
}

/** Form şube kimliğinin girdi kuralı (sunucu eylemleri; boş: eski sekme göndermedi) */
export const zFormBranch = z.string().max(BRANCH_ID_MAX).nullish();

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

/**
 * Claude bağlantısının ve panel asistanının `sube` girdisi (şube kapsamı C P2-13): şubenin kimliği ya da adı (büyük-küçük
 * harf ve Türkçe harfler fark etmez) ya da "hepsi" / "tümü". Kapalı ya da bilinmeyen şube Claude'a seçenekleriyle söylenir
 */
export function mcpBranchScope(raw: string, known: readonly BranchRow[]): { scope: BranchScope } | { error: string } {
  const fold = (v: string) => v.trim().toLocaleLowerCase("tr-TR");
  const want = fold(raw);
  if (want === ALL_BRANCHES || want === "tümü" || want === "tumu") return { scope: ALL_BRANCHES };
  const open = sortBranches(known.filter((b) => b.active));
  const hit = open.find((b) => b.id === want || fold(b.name) === want);
  if (hit) return { scope: hit.id };
  return { error: `Şube bulunamadı: "${raw}". Seçenekler: ${[...open.map((b) => b.name), "hepsi"].join(", ")}` };
}

/** Seçimin ekrandaki adı ("Tümü", "Marina") */
export function branchScopeLabel(scope: BranchScope, known: readonly BranchRow[]): string {
  if (scope === ALL_BRANCHES) return "Tümü";
  return known.find((b) => b.id === scope)?.name ?? "Tümü";
}

/**
 * Telefonun üst çubuğundaki şube satırı (docs/SUBE.md › Telefonda üst çubuk): birden çok şube açıkken seçili kapsamın
 * adı ("Tümü", "Marina"); tek şube açıkken null (seçici de çizilmez, satır gürültü olurdu)
 */
export function topBarBranchLabel(scope: BranchScope, known: readonly BranchRow[]): string | null {
  if (known.filter((b) => b.active).length < 2) return null;
  return branchScopeLabel(scope, known);
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
export const MONTH_TOTALS_LOCKED_TEXT = "Tümü'de şubelerin toplamı görünür: ciro ve açık günü yazmak için şube seçiciden şubeyi seçin.";

/**
 * Ay bilgisi (ciro, açık gün, ay notu) bu seçimde yazılamıyorsa nedeni: "Tümü"de birden çok kasa açıkken şubelerin
 * toplamıdır (`monthTotalsLocked`); online kanalın kasa satışı yoktur (ay "online" şubesine inmesin; sunucu da reddeder,
 * `formBranch(…, "sales")`). Yazılabiliyorsa null
 */
export function monthWriteLock(scope: BranchScope, known: readonly BranchRow[]): string | null {
  if (monthTotalsLocked(scope, known)) return MONTH_TOTALS_LOCKED_TEXT;
  const b = known.find((x) => x.id === scope);
  if (b && b.kind !== "fiziksel") return `${b.name} kanalının kasa satışı yok: ciro, açık gün ve ay notu şubelerde yazılır; şube seçiciden şubeyi seçin.`;
  return null;
}

/**
 * Gelir-gider'in ay hücrelerinin (ciro, açık gün, ay notu) yazdığı şube: tek şube seçiliyken o şube, "Tümü"de tek kasa
 * açıkken o kasa. Yazılamıyorsa (`monthWriteLock`) null: form şube göndermez, sunucu reddeder
 */
export function monthWriteBranch(scope: BranchScope, known: readonly BranchRow[]): string | null {
  if (monthWriteLock(scope, known)) return null;
  if (scope !== ALL_BRANCHES) return scope;
  return tillBranches(known)[0]?.id ?? DEFAULT_BRANCH_ID;
}

/**
 * Gelir-gider'de "Tümü" seçiliyken ay bilgisinin notu (docs/SUBE.md › Yazarken hangi şube): ciro, açık gün ve ay notu
 * şube başınadır; "Tümü" şubelerin toplamıdır, yazılmaz (monthTotalsLocked). Önceden ay notu "Tümü"nde sessizce Tuzla'nın
 * ay satırına iniyordu (24 Kasım şube kapsamı). Yalnız birden çok kasa açıkken; tek şube seçiliyken ya da tek kasa varken
 * null (yazılan zaten gösterilen satırdır)
 */
export function monthWriteNote(scope: BranchScope, known: readonly BranchRow[]): string | null {
  if (!monthTotalsLocked(scope, known)) return null;
  return "Tümü seçili: aylık ciro, açık gün ve ay notu şubelerin toplamıdır, burada yazılmaz; yazmak için şube seçiciden şubeyi seçin.";
}

/**
 * Firma geneli ekranlar (şube kapsamı C P1-12, P2-1): şube seçiliyken de bütün şubelerin verisini gösterir. Şube ayrımı
 * (27 Kasım 2026) bu ekranların hepsini kişinin şube görünümüne bağladı (çip, src/components/panel/branch-view-chip.tsx);
 * not bugün hiçbir ekranda çizilmez, hep firma geneli kalacak bir ekran için durur (tests/sube-ayrimi.test.ts › (c))
 */
export type CompanyWideScreen = "vergi" | "nakit" | "tedarikciler" | "tutarlilik" | "mutabakat";

const COMPANY_WIDE_TEXT: Record<CompanyWideScreen, string> = {
  vergi: "Vergi ve KDV firmanın: bütün şubelerin satışı, faturaları ve giderleri birlikte hesaplanır (tek vergi numarası).",
  nakit: "Nakit planı firmanın: bütün şubelerin kasası, ödemeleri ve faturaları birlikte.",
  tedarikciler:
    "Tedarikçilerin cari hesabı firmanındır; borç ve ödemeler şubeye bölünmez. Faturanın şubesi tedarikçi sayfasında rozetinde; kasadan yapılan ödemeler kasanın şubesiyle ayrılır.",
  tutarlilik: "Tutarlılık işletme geneli: alınan mal şubeye bölünmez; sayım, satış ve zayi bütün şubelerden birlikte karşılaştırılır.",
  mutabakat:
    "Banka hesabı ve tedarikçi cari hesabı firmanındır: ekstreler bütün şubelerin kayıtlarıyla eşleşir. POS hakedişinde kart satışı şube şube, kendi POS oranıyla hesaplanır.",
};

/**
 * Firma geneli ekranın notu (şube kapsamı C P1-12, P2-1; sahibin varsayılanı 24 Kasım 2026: tek firma, Paraşüt hesabı
 * ortak): tek şube seçiliyken ekran yine bütün şubeleri gösterir ve bunu söyler; "Tümü"de not yok (null). Paraşüt ve
 * Faturalar bu listede değil: seçili şubenin hesabını ve faturalarını gösterir (docs/SUBE.md › Faturanın şubesi)
 */
export function companyWideNote(screen: CompanyWideScreen, scope: BranchScope, known: readonly BranchRow[]): { title: string; text: string } | null {
  if (scope === ALL_BRANCHES) return null;
  const b = known.find((x) => x.id === scope);
  if (!b) return null;
  return { title: `${b.name} seçili: bu ekran firma geneli`, text: COMPANY_WIDE_TEXT[screen] };
}

/**
 * Şube görünümünün bilgi notu (Gelir-gider, Genel bakış): neyin şubenin, neyin işletme genelinin olduğu
 * (docs/SUBE.md › Şube görünümünde maliyet)
 */
export function branchViewNote(b: { name: string; kind: BranchKind }, opts: { sharedHidden?: boolean } = {}): { title: string; text: string } {
  const [what, to, of] = b.kind === "online" ? ["kanal", "kanala", "kanalın"] : ["şube", "şubeye", "şubenin"];
  // İşletme geneli giderler alanı (şube ayrımı parça 6): "Yalnız not" kipinde tutar yazılmaz, "Tutarla göster" kipinde
  // bilgi satırı (Faz 5)
  const shared = opts.sharedHidden
    ? `${of} kârına girmez, tutarı burada yazılmaz; Tümü'de bir kez sayılır (bölüştürme yok; tutarıyla görmek için Hesabım › Şube görünümü › İşletme geneli giderler: Tutarla göster).`
    : `${of} kârına girmez: "İşletme geneli payı (bilgi)" satırında toplamı görünür, Tümü'de bir kez sayılır (bölüştürme yok).`;
  return {
    title: `${b.name} seçili: yalnız bu ${what}; işletme geneli giderler ${opts.sharedHidden ? "yalnız not" : "bilgi olarak"}`,
    text:
      `Ciro, kasa, personel ve bu ${to} bağlı giderler yalnız bu ${of}. İşletme geneli giderler (şubesi seçilmemiş harcama ve sabit ` +
      `gider, işletme geneli faturalar, Gelir-gider'e elle yazılan tutarlar, komisyon faturaları) ${shared} Bu ${to} seçilmiş faturalar ${of} giderinde; ` +
      `şubesi seçilmemiş faturalar hiçbir şubede yok (Faturalar › Tümü'de "Şubesi seçilmemiş" kutusu). Mal maliyeti ${of} satışından ` +
      `reçeteye göre (stok devri işletme genelinde). İşletmenin toplamı, sayımlı mal maliyeti ve elle yazılan tutarlar için soldan Tümü'nü seçin.`,
  };
}

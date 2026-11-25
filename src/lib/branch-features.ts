/**
 * Şube özellikleri (docs/SUBE.md › Şube özellikleri; şube kapsamı B6): bir şubede hangi işin yapıldığı. Karaoke odası,
 * laffogato.net'in uygulama siparişleri, masadaki "Garson çağır" ve yemek kartı / platform satışı her şubede olmayabilir.
 * Kapalı özelliğin menüsü, kartı ve bildirimi o şube seçiliyken gizlenir ya da "Bu şubede kullanılmıyor" satırına iner;
 * şubesine kilitli personele ne ekranı ne bildirimi gider.
 *
 * Değer `branches.features`'ta (metin dizisi, migration 0084). Yönetici Şube ayarları'ndan (/panel/subeler/[id]) açar
 * ve kapatır. Sahibin varsayılanları (25 Kasım 2026): karaoke Tuzla'da (varsayılan şube); uygulama siparişi, garson
 * çağır ve yemek kartı bugünkü gibi her şubede açık. Online kanalın (laffogato.net) özelliği yoktur.
 *
 * Saf: veritabanına ve Next'e bağlı değil; `tests/sube-ozellik.test.ts` doğrudan çalıştırır.
 */

import { ALL_BRANCHES, type BranchRow, type BranchScope, DEFAULT_BRANCH_ID } from "./branches";

export type BranchFeature = (typeof BRANCH_FEATURE_IDS)[number];
export const BRANCH_FEATURE_IDS = ["karaoke", "siparis", "garson", "yemek_karti"] as const;

export interface BranchFeatureInfo {
  id: BranchFeature;
  label: string;
  description: string;
  /** Yalnız bir şubede açık olabilir (sitenin tek karaoke odası var; rezervasyon şube söylemez) */
  single?: boolean;
}

/** Şube ayarları ekranının sırası ve metinleri */
export const BRANCH_FEATURES: readonly BranchFeatureInfo[] = [
  {
    id: "karaoke",
    label: "Karaoke",
    description: "Karaoke odası: rezervasyonlar, oda sayacı, alarm ve personel e-postası. Yalnız bir şubede açık olabilir.",
    single: true,
  },
  { id: "siparis", label: "Uygulama siparişleri", description: "laffogato.net'ten (uygulama ve web) gelen kafe siparişleri, zili ve bildirimi." },
  { id: "garson", label: "Garson çağır", description: "Masadaki QR'dan gelen masa çağrıları, zili ve bildirimi." },
  { id: "yemek_karti", label: "Yemek kartı ve platformlar", description: "Komisyon & hakediş ekranı, uyarıları ve sabah e-postasındaki bölümü." },
];

/**
 * Yeni şubenin özellikleri (sütunun varsayılanı, migration 0084): bugünkü davranış, karaoke hariç. Karaoke tek şubede
 * açık olabileceği için yeni şubeye kendiliğinden gelmez
 */
export const NEW_BRANCH_FEATURES: readonly BranchFeature[] = ["siparis", "garson", "yemek_karti"];
/** Varsayılan şubenin (Tuzla) özellikleri: yenilerinkine karaoke eklenir */
export const DEFAULT_BRANCH_FEATURES: readonly BranchFeature[] = ["karaoke", ...NEW_BRANCH_FEATURES];

/** Özelliği kapalı şubede ekran ve eylemin metni */
export const FEATURE_ELSEWHERE = "Bu şubede kullanılmıyor";

export function isBranchFeature(raw: unknown): raw is BranchFeature {
  return typeof raw === "string" && (BRANCH_FEATURE_IDS as readonly string[]).includes(raw);
}

export function featureLabel(id: BranchFeature): string {
  return BRANCH_FEATURES.find((f) => f.id === id)?.label ?? id;
}

/** Kayıttaki dizi: tanınmayan değer atılır, sıra ekranın sırası, tekrar yok */
export function parseFeatures(raw: unknown): BranchFeature[] {
  if (!Array.isArray(raw)) return [];
  return BRANCH_FEATURE_IDS.filter((id) => raw.includes(id));
}

type FeatureBranch = Pick<BranchRow, "id" | "kind" | "active"> & { features?: readonly string[] | null };

/**
 * Şubenin açık özellikleri. Online kanalın özelliği yoktur. Özelliği okunmamış satır (eski okuyucu, test verisi) bugünkü
 * davranışı alır: varsayılan şubede karaoke dahil hepsi, öbür şubede karaoke dışında hepsi
 */
export function branchFeatures(b: FeatureBranch): BranchFeature[] {
  if (b.kind !== "fiziksel") return [];
  if (b.features == null) return [...(b.id === DEFAULT_BRANCH_ID ? DEFAULT_BRANCH_FEATURES : NEW_BRANCH_FEATURES)];
  return parseFeatures(b.features);
}

export function hasFeature(b: FeatureBranch, feature: BranchFeature): boolean {
  return branchFeatures(b).includes(feature);
}

/** Özelliğin açık olduğu etkin şubeler (kütüğün sırasıyla) */
export function featureBranches<T extends FeatureBranch>(branches: readonly T[], feature: BranchFeature): T[] {
  return branches.filter((b) => b.active && hasFeature(b, feature));
}

/**
 * Karaoke odasının şubesi: karaokesi açık ilk etkin şube; hiçbir şubede açık değilse null (karaoke hiçbir yerde
 * gösterilmez, bildirimi gitmez). Personel e-postasının vardiyası, kapalı günün izi ve isteğin şubesi buna göre
 */
export function karaokeBranchOf(branches: readonly FeatureBranch[]): string | null {
  return featureBranches(branches, "karaoke")[0]?.id ?? null;
}

/**
 * Online kanal seçiliyken "Tümü" gibi davranan özellikler: sitenin siparişi ve masa çağrısı siteden gelir; kanal
 * görünümünde susarsa siparişin zili ve alarmı kesilirdi (inceleme bulgusu, 25 Kasım 2026). Karaoke ve yemek kartı
 * kanalda yok
 */
const CHANNEL_FEATURES: readonly BranchFeature[] = ["siparis", "garson"];

/**
 * Seçili kapsamda özellik var mı: tek şube seçiliyse o şubede açık mı; "Tümü"de herhangi bir etkin şubede açık mı.
 * Online kanal seçiliyken kanalın kasası, karaokesi ve yemek kartı yok; site siparişi ve masa çağrısı "Tümü"deki gibi
 * (herhangi bir şubede açıksa; CHANNEL_FEATURES)
 */
export function featureInScope(feature: BranchFeature, scope: BranchScope, branches: readonly FeatureBranch[]): boolean {
  if (scope === ALL_BRANCHES) return featureBranches(branches, feature).length > 0;
  const b = branches.find((x) => x.id === scope);
  if (b && b.kind !== "fiziksel") return CHANNEL_FEATURES.includes(feature) && featureBranches(branches, feature).length > 0;
  return Boolean(b?.active && hasFeature(b, feature));
}

/**
 * Özelliğin kitlesi (bildirim ve e-posta): yönetici, şubesiz personel (bütün şubelerde çalışır) ve özelliğin açık
 * olduğu şubenin personeli. Şubesi pasif ya da kütükte olmayan personel şubesiz sayılır (seçicinin kilidi gibi). Özellik
 * hiçbir şubede açık değilse kimse
 */
export function featureAudience<U extends { role: "admin" | "staff"; branchId: string | null }>(
  users: readonly U[],
  branches: readonly FeatureBranch[],
  feature: BranchFeature,
): U[] {
  const on = new Set(featureBranches(branches, feature).map((b) => b.id));
  if (!on.size) return [];
  const active = new Set(branches.filter((b) => b.active).map((b) => b.id));
  return users.filter((u) => u.role === "admin" || u.branchId === null || !active.has(u.branchId) || on.has(u.branchId));
}

/**
 * Fiziksel şubede kapalı özelliklerin adları (Şubeler listesinin ve Ayarlar'ın çipi: "Garson çağır, Yemek kartı ve
 * platformlar"). Tek şubelik özellik (karaoke) sayılmaz: bir şubede açık, öbürlerinde kapalı olması olağan
 */
export function offFeatureLabels(b: FeatureBranch): string[] {
  if (b.kind !== "fiziksel") return [];
  return BRANCH_FEATURES.filter((f) => !f.single && !hasFeature(b, f.id)).map((f) => f.label);
}

/** Kapalı özelliğin eylem metni ("Garson çağır bu şubede kullanılmıyor") */
export function featureOffText(feature: BranchFeature): string {
  return `${featureLabel(feature)} ${FEATURE_ELSEWHERE.toLocaleLowerCase("tr-TR")}`;
}

/**
 * Personelin özelliğin eylemini (sipariş aşaması, masa çağrısında "Gördüm") çağırıp çağıramayacağı; sorun yoksa null.
 * Ekran zaten gizler, eylem kimliği istemci paketinde olduğu için uç da sorar. Yönetici serbest; özellik hiçbir şubede
 * açık değilse personel reddedilir; şubesine kilitli personel (`lock`, etkin şubesi) yalnız kendi şubesinde açıksa
 */
export function staffFeatureError(
  me: { role: string },
  lock: string | null,
  branches: readonly FeatureBranch[],
  feature: BranchFeature,
): string | null {
  if (me.role === "admin") return null;
  const on = featureBranches(branches, feature);
  if (!on.length || (lock !== null && !on.some((b) => b.id === lock))) return featureOffText(feature);
  return null;
}

/**
 * Özelliği açıp kapatmanın kuralı; sorun yoksa null. Online kanalın özelliği olmaz; tek şubelik özellik (karaoke) başka
 * bir etkin şubede açıksa açılamaz (önce oradan kapatılır: sitenin tek odası iki şubede görünmesin)
 */
export function featureChangeError(
  branch: FeatureBranch & { name: string },
  feature: BranchFeature,
  on: boolean,
  others: readonly (FeatureBranch & { name: string })[],
): string | null {
  if (branch.kind !== "fiziksel") return "Online kanalın şube özelliği yok";
  if (!on) return null;
  const info = BRANCH_FEATURES.find((f) => f.id === feature);
  if (info?.single) {
    const holder = others.find((b) => b.id !== branch.id && b.active && hasFeature(b, feature));
    if (holder) return `${info.label} ${holder.name} şubesinde açık; önce oradan kapatın (yalnız bir şubede olabilir)`;
  }
  return null;
}

/** Özelliği açılmış ya da kapatılmış dizi (sıra ekranın sırası) */
export function withFeature(current: readonly string[] | null | undefined, feature: BranchFeature, on: boolean): BranchFeature[] {
  const set = new Set(parseFeatures(current ?? []));
  if (on) set.add(feature);
  else set.delete(feature);
  return BRANCH_FEATURE_IDS.filter((id) => set.has(id));
}

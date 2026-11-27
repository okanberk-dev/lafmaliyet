/**
 * Ay bazlı ayarlar (docs/AYARLAR.md; P5, 27 Kasım 2026): parayı etkileyen oranlar ve tutarlar "şu aydan itibaren"
 * sürümlerle saklanır (`setting_versions`), hesap her ayı kendi ayarıyla yapar. Excel'den kalan "tek ayar" modelinde bir
 * oran değişince geçmiş aylar da yeniden hesaplanıyordu; artık değişiklik yalnız seçilen aydan (ya da yalnız o aydan)
 * itibaren geçer.
 *
 * Kural (personel ve sabit gider sürümleriyle aynı, engine.ts versionAt): ayda geçerli değer `fromMonth` ≤ ay olan en son
 * sürümdür; sürümü olmayan anahtar ve ilk sürümden önceki aylar taban değeri okur (`settings` tablosu ya da varsayılan,
 * şubenin POS oranında `branches.pos_rate`). Göç (0101) bugünkü değerleri ilk aydan (`BASE_MONTH`) geçerli sürüm olarak
 * yazdı: hiçbir ayın rakamı değişmedi. Saf modül: motor, sunucu ve istemci kullanır; tests/ay-ayarlari.test.ts.
 */

import type { Settings } from "./calc/types";

/** Ay bazlı saklanan genel ayarlar (hepsi sayı) */
export const MONTH_SETTING_KEYS = [
  "kdv",
  "kdvHizmet",
  "komisyon",
  "kartOrani",
  "fire",
  "isciSgk",
  "isciIssizlik",
  "isverenSgk",
  "isverenIssizlik",
  "mealCardDaily",
  "mealCardDays",
  "alisKdvAmbalaj",
  "alisKdvGida",
] as const satisfies readonly (keyof Settings)[];

export type MonthSettingKey = (typeof MONTH_SETTING_KEYS)[number];

/** Şube başına ay bazlı ayar: banka POS komisyon oranı (Şubeler › POS oranı) */
export const POS_RATE_KEY = "posRate";

/** Sürümün anahtarı: genel ayarlardan biri ya da şubenin POS oranı */
export type VersionKey = MonthSettingKey | typeof POS_RATE_KEY;

/** Göçün yazdığı başlangıç sürümünün ayı: "ilk aydan" (panelde bundan önce veri yok) */
export const BASE_MONTH = "2000-01";

export const isMonthSettingKey = (k: unknown): k is MonthSettingKey => typeof k === "string" && (MONTH_SETTING_KEYS as readonly string[]).includes(k);
export const isVersionKey = (k: unknown): k is VersionKey => k === POS_RATE_KEY || isMonthSettingKey(k);

type Kind = "pct" | "tl" | "int";

/** Ekrandaki ad, biçim ve geçerli aralık (Ayarlar formunun ve eylemin sınırlarıyla aynı) */
export const VERSION_KEY_INFO: Record<VersionKey, { label: string; kind: Kind; max: number; min?: number }> = {
  kdv: { label: "Satış KDV", kind: "pct", max: 1 },
  kdvHizmet: { label: "Hizmet satışı KDV", kind: "pct", max: 1 },
  komisyon: { label: "POS komisyonu (kasa kartı olmayan ay)", kind: "pct", max: 1 },
  kartOrani: { label: "Kartlı satış oranı", kind: "pct", max: 1 },
  fire: { label: "Fire payı", kind: "pct", max: 1 },
  isciSgk: { label: "İşçi SGK", kind: "pct", max: 1 },
  isciIssizlik: { label: "İşçi işsizlik", kind: "pct", max: 1 },
  isverenSgk: { label: "İşveren SGK", kind: "pct", max: 1 },
  isverenIssizlik: { label: "İşveren işsizlik", kind: "pct", max: 1 },
  mealCardDaily: { label: "Yemek kartı günlük", kind: "tl", max: 100_000 },
  mealCardDays: { label: "Yemek kartı ayda gün", kind: "int", max: 31, min: 1 },
  alisKdvAmbalaj: { label: "Ambalajın alış KDV'si", kind: "pct", max: 1 },
  alisKdvGida: { label: "Gıdanın alış KDV'si", kind: "pct", max: 1 },
  posRate: { label: "POS oranı", kind: "pct", max: 0.1 },
};

/** Saklanan sürüm: genel ayarda `branchId` boş metin */
export interface SettingVersion {
  id?: number;
  key: string;
  branchId: string;
  /** YYYY-MM: bu aydan itibaren (sonraki sürüme kadar) */
  fromMonth: string;
  value: number;
  note?: string | null;
  createdBy?: string | null;
  /** ISO */
  createdAt?: string | null;
}

/** Değişikliğin biçimi: "şu aydan itibaren" (sonraki kayıtlı değişikliğe kadar) ya da "yalnız bu ay" */
export type ChangeMode = "from" | "only";
export const CHANGE_MODE_LABELS: Record<ChangeMode, string> = { from: "Şu aydan itibaren", only: "Yalnız bu ay" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);

/** "2026-12" → "2027-01" (delta ay kaydırır) */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Değer anahtarın aralığında mı (bozuk sürüm yok sayılır, hesap NaN olmasın) */
export function versionValueValid(key: VersionKey, v: unknown): v is number {
  const info = VERSION_KEY_INFO[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < (info.min ?? 0) || v > info.max) return false;
  return info.kind !== "int" || Number.isInteger(v);
}

/** Bir anahtarın (ve şubenin) sürümleri, ayına göre sıralı; geçersiz değer ve ay atlanır */
export function versionsOf(versions: readonly SettingVersion[] | undefined, key: VersionKey, branchId = ""): SettingVersion[] {
  return (versions ?? [])
    .filter((v) => v.key === key && (v.branchId ?? "") === branchId && isMonth(v.fromMonth) && versionValueValid(key, v.value))
    .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
}

/** Sıralı sürümlerde ayın değeri: fromMonth ≤ ay olan en son sürüm; yoksa taban */
export function valueAt(sorted: readonly SettingVersion[], base: number, month: string): number {
  let out = base;
  for (const v of sorted) {
    if (v.fromMonth > month) break;
    out = v.value;
  }
  return out;
}

/**
 * Ayın ayarları: ay bazlı anahtarlar o ayda geçerli sürümden, ötekiler tabandan. Sürüm yoksa tabanın kendisi döner
 * (aynı nesne): sürümsüz veri kümesi (testler, ilk aktarım) bugünkü gibi hesaplanır
 */
export function settingsAt<T extends Settings>(base: T, versions: readonly SettingVersion[] | undefined, month: string): T {
  if (!versions?.length) return base;
  let out: T | null = null;
  for (const key of MONTH_SETTING_KEYS) {
    const list = versionsOf(versions, key);
    if (!list.length) continue;
    const v = valueAt(list, base[key], month);
    if (v !== base[key]) {
      out ??= { ...base };
      (out as Settings)[key] = v;
    }
  }
  return out ?? base;
}

/**
 * Ay ay ayar çözücü (motor, vergi ve nakit planı): ay başına bir kez hesaplanır. `base` sürümsüz ayarlar (settings tablosu
 * ve varsayılanlar), `versions` bütün sürümler (şubelerin POS oranı dahil)
 */
export function monthSettingsResolver<T extends Settings>(base: T, versions: readonly SettingVersion[] | undefined): (month: string) => T {
  if (!versions?.length) return () => base;
  const cache = new Map<string, T>();
  return (month: string) => {
    let s = cache.get(month);
    if (!s) {
      s = settingsAt(base, versions, month);
      cache.set(month, s);
    }
    return s;
  };
}

/** Şubenin ayda geçerli POS oranı: şubenin sürümlerinden, yoksa `branches.pos_rate` */
export function branchPosRateAt(versions: readonly SettingVersion[] | undefined, branchId: string, baseRate: number, month: string): number {
  return valueAt(versionsOf(versions, POS_RATE_KEY, branchId), baseRate, month);
}

// ---------------------------------------------------------------- Değişikliğin planı

export interface ChangePlan {
  /** Yazılacak (ay → değer) sürümler; aynı ayda sürüm varsa üzerine */
  upserts: { fromMonth: string; value: number }[];
  /** Silinecek sürümlerin ayları (önceki değerle aynı olan gereksiz sürüm) */
  deletes: string[];
  /** Değeri değişen aylar: `from`'dan `through`'ya (null = sonu yok, sonraki değişiklik de yok) */
  affected: { from: string; through: string | null };
  /** Değişiklikten önceki değer (seçilen ayda) */
  before: number;
}

/**
 * Bir değişikliğin planı (saf; eylem işlemin içinde uygular). Seçilen ayda değer zaten aynıysa null.
 * - "from": seçilen aydan sonraki kayıtlı değişikliğe kadar (o ay ve sonrası kendi değerinde kalır).
 * - "only": yalnız seçilen ay; ertesi ayda sürüm yoksa ertesi aya eski değer yazılır.
 * Ardından önceki sürümle aynı değeri taşıyan gereksiz sürümler silinir (ilk sürüm hiç silinmez).
 */
export function planChange(sorted: readonly SettingVersion[], base: number, value: number, month: string, mode: ChangeMode): ChangePlan | null {
  const before = valueAt(sorted, base, month);
  if (Math.abs(before - value) < 1e-12) return null;
  const next = sorted.find((v) => v.fromMonth > month)?.fromMonth ?? null;
  const upserts: ChangePlan["upserts"] = [{ fromMonth: month, value }];
  let through: string | null = next ? addMonths(next, -1) : null;
  if (mode === "only") {
    const after = addMonths(month, 1);
    through = month;
    const atAfter = sorted.some((v) => v.fromMonth === after);
    const afterValue = valueAt(sorted, base, after);
    if (!atAfter && Math.abs(afterValue - value) >= 1e-12) upserts.push({ fromMonth: after, value: afterValue });
  }
  // Uygulandıktan sonraki liste: gereksiz sürümleri bul
  const merged = new Map(sorted.map((v) => [v.fromMonth, v.value]));
  for (const u of upserts) merged.set(u.fromMonth, u.value);
  return { upserts, deletes: redundantMonths(merged), affected: { from: month, through }, before };
}

/** Önceki sürümle aynı değeri taşıyan sürümlerin ayları (ilk sürüm hariç) */
export function redundantMonths(values: ReadonlyMap<string, number>): string[] {
  const out: string[] = [];
  let prev: number | null = null;
  for (const m of [...values.keys()].sort()) {
    const v = values.get(m)!;
    if (prev !== null && Math.abs(prev - v) < 1e-12) out.push(m);
    else prev = v;
  }
  return out;
}

/** Sürümü kaldırmanın etkisi: değeri değişen aylar (sürümün ayından sonraki sürüme kadar) ve geri dönülen değer */
export function removalEffect(sorted: readonly SettingVersion[], base: number, month: string): { from: string; through: string | null; back: number } {
  const next = sorted.find((v) => v.fromMonth > month)?.fromMonth ?? null;
  return { from: month, through: next ? addMonths(next, -1) : null, back: valueAt(sorted.filter((v) => v.fromMonth < month), base, month) };
}

/**
 * Kapalı dönem kilidi (docs/DONEM-KAPANISI.md): değişikliğin değiştirdiği aylardan kapalı olan ilki; yoksa null. Ayar
 * kapalı ayın rakamını sessizce değiştirmesin diye eylem bunu reddeder
 */
export function closedMonthIn(affected: { from: string; through: string | null }, closed: Iterable<string>): string | null {
  let first: string | null = null;
  for (const m of closed) {
    if (m >= affected.from && (affected.through === null || m <= affected.through) && (first === null || m < first)) first = m;
  }
  return first;
}

// ---------------------------------------------------------------- Metinler

const pctText = (v: number) => `%${(Math.round(v * 1_000_000) / 10_000).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}`;

/** Değerin ekrandaki yazılışı: "%19,75", "330 ₺", "26 gün" */
export function versionValueText(key: VersionKey, v: number): string {
  const kind = VERSION_KEY_INFO[key].kind;
  if (kind === "pct") return pctText(v);
  if (kind === "int") return `${v.toLocaleString("tr-TR")} gün`;
  return `${v.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺`;
}

const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
/** "2026-10" → "Ekim 2026"; başlangıç sürümü "ilk ay" */
export function fromMonthText(month: string): string {
  if (month <= BASE_MONTH) return "ilk ay";
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Sayının ayrılma hâli eki, okunuşunun son sesine göre: 2026'dan, 2027'den, 2025'ten, 2040'tan */
export function numberAblative(n: number): string {
  const last = n % 10;
  if (last !== 0) return ["", "den", "den", "ten", "ten", "ten", "dan", "den", "den", "dan"][last];
  const tens = Math.floor(n / 10) % 10;
  if (tens !== 0) return ["", "dan", "den", "dan", "tan", "den", "tan", "ten", "den", "dan"][tens];
  // yüz, bin: "yüzden", "binden"
  return "den";
}

/** "Ekim 2026'dan itibaren", "Ocak 2027'den itibaren", "ilk aydan itibaren" */
export function fromMonthAblative(month: string): string {
  if (month <= BASE_MONTH) return "ilk aydan";
  const y = Number(month.slice(0, 4));
  return `${fromMonthText(month)}'${numberAblative(y)}`;
}

/** Etkilenen ayların yazılışı: "Ekim 2026", "Ekim 2026 – Kasım 2026", "Ekim 2026'dan itibaren" */
export function affectedText(a: { from: string; through: string | null }): string {
  if (a.through === null) return `${fromMonthAblative(a.from)} itibaren`;
  if (a.through === a.from) return fromMonthText(a.from);
  return `${fromMonthText(a.from)} – ${fromMonthText(a.through)}`;
}

/** İşlem geçmişinin satırı: "İşveren SGK %15,75 → %19,75 (Ocak 2027'den itibaren)" */
export function changeLogText(key: VersionKey, before: number, after: number, affected: { from: string; through: string | null }, branchName?: string | null): string {
  const who = branchName ? `${branchName} ` : "";
  return `${who}${VERSION_KEY_INFO[key].label} ${versionValueText(key, before)} → ${versionValueText(key, after)} (${affectedText(affected)})`;
}

/** Geçmiş satırı (Ayarlar › Ay bazlı ayarlar) */
export interface HistoryRow {
  id: number | null;
  fromMonth: string | null;
  value: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

/**
 * Anahtarın geçmişi: en başta taban (sürümü yoksa ya da ilk sürüm ilk aydan sonraysa "ilk değer"), ardından sürümler
 * sırasıyla. Ekran yeni → eski gösterir
 */
export function historyOf(versions: readonly SettingVersion[] | undefined, key: VersionKey, base: number, branchId = ""): HistoryRow[] {
  const list = versionsOf(versions, key, branchId);
  const rows: HistoryRow[] = [];
  if (!list.length || list[0].fromMonth > BASE_MONTH) rows.push({ id: null, fromMonth: null, value: base, note: null, createdBy: null, createdAt: null });
  for (const v of list) rows.push({ id: v.id ?? null, fromMonth: v.fromMonth, value: v.value, note: v.note ?? null, createdBy: v.createdBy ?? null, createdAt: v.createdAt ?? null });
  return rows;
}

/** Bugünden sonraki ilk kayıtlı değişiklik (ör. "Ocak 2027'den itibaren %19,75"); yoksa null */
export function upcomingChange(versions: readonly SettingVersion[] | undefined, key: VersionKey, currentMonth: string, branchId = ""): SettingVersion | null {
  return versionsOf(versions, key, branchId).find((v) => v.fromMonth > currentMonth) ?? null;
}

/**
 * Değişikliğin seçilebileceği aylar (eskiden yeniye): verinin ilk ayından bu aydan 12 ay sonrasına. Veri yoksa bu ay
 */
export function changeMonthOptions(firstDataMonth: string | null, currentMonth: string): string[] {
  const start = firstDataMonth && firstDataMonth < currentMonth ? firstDataMonth : currentMonth;
  const end = addMonths(currentMonth, 12);
  const out: string[] = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) out.push(m);
  return out;
}

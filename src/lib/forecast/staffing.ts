/**
 * Satış tahmininin ayarları ve kaç kişi önerisi (saf; tests/satis-tahmini.test.ts). Ayarlar integration_state
 * "forecast.settings"te; tatlı kategorileri kimlikle değil adla tutulur (db:reset kimlikleri baştan sayar).
 */

export interface ForecastSettings {
  /** Bir kişinin günde karşıladığı satış (₺) */
  perPerson: number;
  /** Sakin günde bile çalışan sayısı */
  minStaff: number;
  maxStaff: number;
  /** Tatlı sayılan kategorilerin ADLARI; null: adında "tatlı" geçenler */
  dessertCategories: string[] | null;
  /** MET Norway'den hava durumu */
  weather: boolean;
  /** Personel Bugün ekranında yoğunluğu ve tatlı sayısını görür (tutar ve kişi önerisi asla) */
  staffSeesLevel: boolean;
  /** Zaten giden sabah e-postasına tahmin kutusu */
  emailLine: boolean;
}

export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = {
  perPerson: 10_000,
  minStaff: 2,
  maxStaff: 6,
  dessertCategories: null,
  weather: true,
  staffSeesLevel: true,
  emailLine: true,
};

export const PER_PERSON_MIN = 1_000;
export const PER_PERSON_MAX = 200_000;
export const STAFF_MAX = 20;
export const MAX_DESSERT_CATEGORIES = 30;

const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Kayıtlı değer: bozuk ya da eksik alan varsayılana döner; en çok kişi en azdan küçükse en aza eşitlenir */
export function parseForecastSettings(raw: unknown): ForecastSettings {
  const d = DEFAULT_FORECAST_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const perPerson = typeof r.perPerson === "number" && Number.isFinite(r.perPerson) && r.perPerson >= PER_PERSON_MIN && r.perPerson <= PER_PERSON_MAX ? r.perPerson : d.perPerson;
  const minStaff = int(r.minStaff, 0, STAFF_MAX) ?? d.minStaff;
  const maxRaw = int(r.maxStaff, 0, STAFF_MAX) ?? d.maxStaff;
  const names = Array.isArray(r.dessertCategories)
    ? [...new Set(r.dessertCategories.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))].slice(0, MAX_DESSERT_CATEGORIES)
    : [];
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  return {
    perPerson,
    minStaff,
    maxStaff: Math.max(minStaff, maxRaw),
    dessertCategories: names.length ? names : null,
    weather: bool(r.weather, d.weather),
    staffSeesLevel: bool(r.staffSeesLevel, d.staffSeesLevel),
    emailLine: bool(r.emailLine, d.emailLine),
  };
}

/**
 * Kaç kişi: günün tahmini ÷ kişi başı satış, yukarı yuvarlanır, en az / en çok arasında. Aralığın üstü (yoğun geçerse)
 * daha çok kişi gerektiriyorsa `ifBusy`. Kapalı gün 0.
 */
export function staffFor(day: { amount: number; high: number; closed: unknown }, s: Pick<ForecastSettings, "perPerson" | "minStaff" | "maxStaff">): { count: number; ifBusy: number | null } {
  if (day.closed) return { count: 0, ifBusy: null };
  const clamp = (v: number) => Math.min(s.maxStaff, Math.max(s.minStaff, v));
  const count = clamp(Math.ceil(day.amount / s.perPerson - 1e-9));
  const busy = clamp(Math.ceil(day.high / s.perPerson - 1e-9));
  return { count, ifBusy: busy > count ? busy : null };
}

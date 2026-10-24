/**
 * 7 günlük satış tahmini (saf; tests/satis-tahmini.test.ts). Hedef kasanın Z toplamı (KDV dahil, indirimden sonra,
 * ikram hariç; laffogato.net online kasadan geçmediği için yok). Model bilerek basit: son haftaların normal günlerinden
 * hafta günü tabanı × adı konmuş çarpanlar (takvim, hava, yöneticinin özel günleri, son 2 hafta eğilimi); her sayı
 * ekranda tek Türkçe cümleyle açıklanır. Çarpanlar varsayılandır: geçmişten öğrenme sonraki bir tura bırakıldı (kafenin
 * birkaç haftalık verisiyle bayram ya da yağmur etkisi öğrenilemez). Ayrıntı: docs/SATIS-TAHMINI.md.
 *
 * Gün iş günüdür (05:00'te döner, src/lib/cash-report.ts businessDate); `today`'in kendi Z'si bugünün tahminine hiç
 * girmez (sızıntı yok). Tarihler "YYYY-MM-DD", hesaplar Date.UTC ile: yaz saati yok.
 */

import { addDays } from "@/lib/reminders";

import { calendarDay, weekdayOf, type CalendarDay, type EventKind, type SeasonKind, type SpecialKind } from "./calendar";
import { weatherKind, type WeatherDay, type WeatherKind } from "./weather";

export const MODEL_VERSION = "t1";
export const HORIZON_DAYS = 7;
/** Hafta günü tabanı: son 6 hafta (kafe yeni, büyüyor) */
export const BASE_WINDOW_DAYS = 42;
/** "Ortalama gün" yedeği */
export const LEVEL_WINDOW_DAYS = 28;
/** Son 2 haftanın eğilimi */
export const TREND_WINDOW_DAYS = 14;
/** Geçmişin okunduğu gün sayısı: taban (42) ve aralığın geçmiş oranları (56) için yeter */
export const HISTORY_DAYS = 60;
/** Bir hafta günü bu kadar normal günle kendi verisinden hesaplanır */
export const MIN_WEEKDAY_DAYS = 3;
export const MIN_LEVEL_DAYS = 7;
export const MIN_TREND_DAYS = 5;
/** Eğilim tabandan en az bu kadar saparsa çarpan olur; çarpan bu aralıkta kalır */
export const TREND_MIN_GAP = 0.1;
export const TREND_CLAMP = [0.8, 1.25] as const;
/** Ortalama normal güne oran: üstü Yüksek, altı Düşük */
export const BUSY = { high: 1.12, low: 0.88 } as const;
/** Bütün çarpanların çarpımı bu aralıkta kalır (kapalı gün hariç) */
export const FACTOR_CLAMP = [0.4, 2.5] as const;
/** Aralık geçmiş tahmin sapmalarından en az bu kadar günle */
export const MIN_SPREAD_RATIOS = 14;
/** Veri azken aralık: kendi hafta günü verisiyle ±%15, kaba tabanla ±%25; takvim olayı varsa 5 puan daha */
export const SPREAD = { own: 0.15, rough: 0.25, event: 0.05 } as const;
/** Pazar … Cumartesi: AVM içindeki kafe için varsayılan hafta günü payları (ortalaması 1) */
export const DEFAULT_WEEKDAY = [1.15, 0.85, 0.85, 0.9, 0.95, 1.05, 1.25] as const;
export const DEFAULT_FACTORS: Readonly<Record<EventKind | SeasonKind | "yagmur" | "sicak", number>> = {
  resmi: 1.2, // yalnız hafta içi (hafta sonu 1)
  arife: 1.1, // yalnız hafta içi
  "ramazan-bayrami": 1.15,
  "kurban-bayrami": 1.0, // şehir dışına gidenler / kalanlar: bilinmiyor, nötr
  ramazan: 0.92,
  "okul-tatili": 1.1, // yalnız hafta içi
  yagmur: 1.05, // gün içi (09–23) 5 mm ve üstü
  sicak: 1.05, // en yüksek 35 °C ve üstü
};

/** Özel günün türünün adı */
export const SPECIAL_KIND_LABEL: Record<SpecialKind, string> = {
  derbi: "Derbi / maç",
  avm: "AVM etkinliği",
  kampanya: "Kampanya",
  kapali: "Kafe kapalı",
  diger: "Diğer",
};

/** Bir günün kasa raporundaki Z toplamı (0: kafe kapalı) */
export interface DayTotal {
  date: string;
  total: number;
}

/** Yöneticinin girdiği özel gün (special_days); effect −0,30 … +0,30, kapalıda −1 */
export interface SpecialDay {
  id: number;
  dateFrom: string;
  dateTo: string;
  kind: SpecialKind;
  title: string;
  effect: number;
  note?: string | null;
}

/** Ayın elle yazılan ya da Excel'den gelen bilgisi: POS cirosu ve açık gün (months) */
export interface MonthLevel {
  month: string;
  openDays: number;
  posRevenue: number;
}

export interface ForecastInput {
  /** İş günü (businessDate) */
  today: string;
  /** Kasa raporlarının Z toplamları; `today` ve sonrası yok sayılır */
  history: readonly DayTotal[];
  months: readonly MonthLevel[];
  special: readonly SpecialDay[];
  /** null: hava durumu ayarı kapalı */
  weather: readonly WeatherDay[] | null;
  /** Geçmiş günlerin gerçekleşen ÷ o sabahki tahmin oranları (accuracy.ts pastRatios) */
  pastRatios: readonly number[];
  days?: number;
}

export type FactorSource = "varsayilan" | "sizin" | "egilim";

export interface Factor {
  key: string;
  /** Açıklamadaki ad: "Cumhuriyet Bayramı (hafta içi resmî tatil)" */
  label: string;
  /** Etiketteki kısa ad: "Cumhuriyet Bayramı", "Yağmur", özel günün adı */
  chip: string;
  value: number;
  source: FactorSource;
}

export type BaseSource = "hafta-gunu" | "ortalama" | "ay";
export type ForecastQuality = "yok" | "ay" | "ortalama" | "karma" | "tam";
export type ForecastLevel = "yuksek" | "normal" | "dusuk" | "kapali";

/** Hafta günü olmayan taban: son günlerin ortalaması ya da ayın POS cirosu, varsayılan hafta günü payıyla */
export interface LevelBase {
  source: "ortalama" | "ay";
  /** Ortalama gün (₺) */
  value: number;
  /** ortalama: kullanılan normal gün ve pencere; ay: ay ve açık gün */
  n?: number;
  windowDays?: number;
  month?: string;
  openDays?: number;
}

export interface DayBase {
  amount: number;
  source: BaseSource;
  /** hafta-gunu: kullanılan gün sayısı; ortalama: kullanılan normal gün; ay: açık gün */
  n: number;
  /** Varsayılan hafta günü payı (ortalama / ay) */
  share?: number;
}

export interface ForecastDay {
  date: string;
  weekday: number;
  /** 0 = bugün */
  offset: number;
  calendar: CalendarDay;
  /** Günü kapsayan özel günler (kapalı dahil) */
  special: SpecialDay[];
  weather: (WeatherDay & { kind: WeatherKind | null }) | null;
  closed: { title: string } | null;
  base: DayBase;
  factors: Factor[];
  /** Çarpanların sınırlanmış çarpımı */
  factor: number;
  amount: number;
  low: number;
  high: number;
  /** Varsayılan aralığın yüzdesi (geçmiş sapmalardan gelen aralıkta null) */
  spreadPct: number | null;
  level: ForecastLevel;
}

export interface Forecast {
  today: string;
  days: ForecastDay[];
  quality: ForecastQuality;
  /** Kendi verisi olmayan hafta günleri (karma) */
  missingWeekdays: number[];
  /** Hafta günü tabanlarının ortalaması: yoğunluğun ölçüsü */
  normalDay: number;
  /** Son 42 gündeki normal gün, son 28 gündeki normal gün ve okunan bütün raporlar */
  reports: { normal: number; last28: number; total: number };
  /** Hafta günü payları (Pazar…Cumartesi): kendi verisinden ya da varsayılan */
  shares: { weekday: number; value: number; own: boolean }[];
  level: LevelBase | null;
  bases: (DayBase | null)[];
  trend: number | null;
  spread: { kind: "gecmis" | "varsayilan"; n: number; low?: number; high?: number };
}

/** Kayıtlı tahminin ayrıntısı (forecast_snapshots.detail) */
export interface SnapshotDetail {
  v: string;
  quality: ForecastQuality;
  base: { amount: number; source: BaseSource; n: number };
  factors: { key: string; value: number }[];
  weather: WeatherKind | null;
}

// ---------------------------------------------------------------- Yardımcılar

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isWeekday = (w: number) => w >= 1 && w <= 5;
/** Yuvarlamalar (kayan nokta artığı 17.000'i 16.500'e düşürmesin) */
export const round100 = (v: number) => Math.round(v / 100 + 1e-9) * 100;
export const floor500 = (v: number) => Math.max(0, Math.floor(v / 500 + 1e-9) * 500);
export const ceil500 = (v: number) => Math.ceil(v / 500 - 1e-9) * 500;

/** Uç değere dayanıklı ortalama: 5 ve üstü günde en yüksek ve en düşük atılır, 3–4 günde ortanca */
export function robustMean(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length >= 5) return mean(s.slice(1, -1));
  if (s.length >= 3) return quantile(s, 0.5);
  return mean(s);
}

/** Doğrusal aradeğerli yüzdelik (0–1) */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const covers = (e: { dateFrom: string; dateTo: string }, date: string) => e.dateFrom <= date && date <= e.dateTo;

/** Takvim olayının çarpanı: resmî tatil ve arife yalnız hafta içi; bayram her gün. Etkisizse (1) null */
export function eventFactor(cal: CalendarDay): Factor | null {
  const e = cal.event;
  if (!e) return null;
  if ((e.kind === "resmi" || e.kind === "arife") && !isWeekday(cal.weekday)) return null;
  const value = DEFAULT_FACTORS[e.kind];
  if (value === 1) return null;
  const label = e.kind === "resmi" ? `${e.name} (hafta içi resmî tatil)` : e.kind === "arife" ? `${e.name} (yarım gün tatil)` : e.name;
  return { key: e.kind, label, chip: e.short, value, source: "varsayilan" };
}

/** Mevsim çarpanları: Ramazan her gün, okul tatili yalnız hafta içi */
export function seasonFactors(cal: CalendarDay): Factor[] {
  return cal.seasons
    .filter((s) => s.kind === "ramazan" || isWeekday(cal.weekday))
    .map((s) => ({
      key: s.kind,
      label: s.kind === "okul-tatili" ? `${s.name} (okullar kapalı, hafta içi)` : s.name,
      chip: s.short,
      value: DEFAULT_FACTORS[s.kind],
      source: "varsayilan" as const,
    }))
    .filter((f) => f.value !== 1);
}

/** Hava çarpanı: yağmurlu ya da çok sıcak gün */
export function weatherFactor(kind: WeatherKind | null): Factor | null {
  if (kind === "yagmur") return { key: "yagmur", label: "Yağmurlu gün (AVM kalabalıklaşır)", chip: "Yağmur", value: DEFAULT_FACTORS.yagmur, source: "varsayilan" };
  if (kind === "sicak") return { key: "sicak", label: "Çok sıcak gün (35 °C ve üstü)", chip: "Sıcak", value: DEFAULT_FACTORS.sicak, source: "varsayilan" };
  return null;
}

/** Özel günün çarpanı (kapalı ve etkisi bilinmeyen hariç) */
export function specialFactor(d: SpecialDay): Factor | null {
  if (d.kind === "kapali" || !d.effect) return null;
  return { key: `ozel:${d.id}`, label: `${d.title} (${SPECIAL_KIND_LABEL[d.kind]})`, chip: d.title, value: 1 + d.effect, source: "sizin" };
}

const product = (fs: readonly Factor[]) => fs.reduce((a, f) => a * f.value, 1);

// ---------------------------------------------------------------- Tahmin

interface Annotated {
  date: string;
  weekday: number;
  total: number;
  normal: boolean;
  /** Mevsim ve havadan arındırılmış Z */
  v: number;
}

/**
 * Önümüzdeki `days` günün tahmini. Adımlar (docs/SATIS-TAHMINI.md › Model):
 * 1. Geçmiş: açık (Z > 0), takvim olayı ve özel günü olmayan gün "normal"dır; Ramazan, okul tatili ve havanın çarpanına
 *    bölünür (taban mevsimden etkilenmesin).
 * 2. Hafta günü tabanı: son 42 günde o günden en az 3 normal gün varsa dayanıklı ortalaması.
 * 3. Yetmeyen günlerde ortalama gün × varsayılan pay: son 28 günde en az 7 normal gün, yoksa son ayın POS cirosu ÷ açık
 *    gün, o da yoksa son 42 günün (en az 3) normal günü; hiçbiri yoksa tahmin yok.
 * 4. Kendi verisi varken son 2 haftanın tabandan sapması %10'u geçerse eğilim çarpanı (×0,8–1,25).
 * 5. Günün çarpanları: takvim olayı, mevsim, hava, özel günler, eğilim; çarpım ×0,4–2,5.
 * 6. Kapalı işaretli gün 0. Tutar 100 ₺'ye yuvarlanır, aralık 500 ₺'ye; yoğunluk ortalama normal güne oranla.
 */
export function buildForecast(input: ForecastInput): Forecast {
  const { today } = input;
  const horizon = input.days ?? HORIZON_DAYS;
  const useWeather = input.weather !== null;
  const weatherBy = new Map((input.weather ?? []).map((w) => [w.date, w]));
  const coveredBy = (date: string) => input.special.filter((s) => covers(s, date));

  // 1. Geçmiş (bugün ve sonrası yok sayılır)
  const from = addDays(today, -HISTORY_DAYS);
  const seen = new Map<string, number>();
  for (const h of input.history) if (h.date < today && h.date >= from && Number.isFinite(h.total)) seen.set(h.date, h.total);
  const annotated: Annotated[] = [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => {
      const cal = calendarDay(date);
      const wf = useWeather ? weatherFactor(weatherKind(weatherBy.get(date))) : null;
      const normal = total > 0 && !cal.event && !coveredBy(date).length;
      return { date, weekday: cal.weekday, total, normal, v: total / (product(seasonFactors(cal)) * (wf?.value ?? 1)) };
    });
  const normal = annotated.filter((a) => a.normal);
  const baseFrom = addDays(today, -BASE_WINDOW_DAYS);
  const inBase = normal.filter((a) => a.date >= baseFrom);
  const last28 = normal.filter((a) => a.date >= addDays(today, -LEVEL_WINDOW_DAYS));

  // 2. Hafta günü tabanları
  const own: (DayBase | null)[] = Array.from({ length: 7 }, (_, w) => {
    const vs = inBase.filter((a) => a.weekday === w).map((a) => a.v);
    return vs.length >= MIN_WEEKDAY_DAYS ? { amount: robustMean(vs), source: "hafta-gunu" as const, n: vs.length } : null;
  });
  const ownCount = own.filter(Boolean).length;

  // 3. Yetmeyen günlerin yedeği
  const levelFrom = (days: Annotated[], windowDays: number): LevelBase => ({
    source: "ortalama",
    value: mean(days.map((a) => a.v / DEFAULT_WEEKDAY[a.weekday])),
    n: days.length,
    windowDays,
  });
  let level: LevelBase | null = null;
  if (ownCount < 7) {
    if (last28.length >= MIN_LEVEL_DAYS) level = levelFrom(last28, LEVEL_WINDOW_DAYS);
    else {
      const month = [...input.months]
        .filter((m) => m.month <= today.slice(0, 7) && m.openDays > 0 && m.posRevenue > 0)
        .sort((a, b) => b.month.localeCompare(a.month))[0];
      if (month) level = { source: "ay", value: month.posRevenue / month.openDays, month: month.month, openDays: month.openDays };
      else if (inBase.length >= MIN_WEEKDAY_DAYS) level = levelFrom(inBase, BASE_WINDOW_DAYS);
    }
  }
  const bases: (DayBase | null)[] = own.map(
    (b, w) =>
      b ??
      (level
        ? { amount: level.value * DEFAULT_WEEKDAY[w], source: level.source, n: level.source === "ay" ? (level.openDays ?? 0) : (level.n ?? 0), share: DEFAULT_WEEKDAY[w] }
        : null),
  );
  const reports = { normal: inBase.length, last28: last28.length, total: annotated.length };
  const empty = (quality: ForecastQuality): Forecast => ({
    today,
    days: [],
    quality,
    missingWeekdays: [],
    normalDay: 0,
    reports,
    shares: DEFAULT_WEEKDAY.map((value, weekday) => ({ weekday, value, own: false })),
    level: null,
    bases,
    trend: null,
    spread: { kind: "varsayilan", n: input.pastRatios.length },
  });
  if (bases.some((b) => !b)) return empty("yok");
  const full = bases as DayBase[];
  const quality: ForecastQuality = ownCount === 7 ? "tam" : ownCount > 0 ? "karma" : level!.source;
  const normalDay = mean(full.map((b) => b.amount));

  // 4. Eğilim (yalnız kendi verisiyle)
  let trend: number | null = null;
  if (quality === "tam" || quality === "karma") {
    const recent = normal.filter((a) => a.date >= addDays(today, -TREND_WINDOW_DAYS));
    if (recent.length >= MIN_TREND_DAYS) {
      const r = mean(recent.map((a) => a.v / full[a.weekday].amount));
      if (Math.abs(r - 1) >= TREND_MIN_GAP - 1e-9) trend = clamp(r, TREND_CLAMP[0], TREND_CLAMP[1]);
    }
  }

  // Aralık: geçmiş sapmalar yeterliyse onların %20–%80'i, yoksa varsayılan yüzde
  const ratios = input.pastRatios.filter((r) => Number.isFinite(r) && r > 0);
  const spread: Forecast["spread"] =
    ratios.length >= MIN_SPREAD_RATIOS
      ? { kind: "gecmis", n: ratios.length, low: Math.min(quantile(ratios, 0.2), 0.95), high: Math.max(quantile(ratios, 0.8), 1.05) }
      : { kind: "varsayilan", n: ratios.length };
  const roughPct = quality === "tam" || quality === "karma" ? SPREAD.own : SPREAD.rough;

  // 5–6. Günler
  const days: ForecastDay[] = [];
  for (let offset = 0; offset < horizon; offset++) {
    const date = addDays(today, offset);
    const weekday = weekdayOf(date);
    const cal = calendarDay(date);
    const special = coveredBy(date);
    const closedBy = special.find((s) => s.kind === "kapali");
    const w = useWeather ? (weatherBy.get(date) ?? null) : null;
    const kind = weatherKind(w);
    const ev = eventFactor(cal);
    const factors = [
      ...(ev ? [ev] : []),
      ...seasonFactors(cal),
      ...(useWeather ? [weatherFactor(kind)].filter((f): f is Factor => f !== null) : []),
      ...special.map(specialFactor).filter((f): f is Factor => f !== null),
      ...(trend !== null ? [{ key: "egilim", label: "Son 2 hafta eğilimi", chip: "Eğilim", value: trend, source: "egilim" as const }] : []),
    ];
    const factor = clamp(product(factors), FACTOR_CLAMP[0], FACTOR_CLAMP[1]);
    const base = full[weekday];
    const day: ForecastDay = {
      date,
      weekday,
      offset,
      calendar: cal,
      special,
      weather: w ? { ...w, kind } : null,
      closed: closedBy ? { title: closedBy.title } : null,
      base,
      factors,
      factor,
      amount: 0,
      low: 0,
      high: 0,
      spreadPct: null,
      level: "kapali",
    };
    if (!closedBy) {
      day.amount = round100(base.amount * factor);
      if (spread.kind === "gecmis") {
        day.low = floor500(day.amount * spread.low!);
        day.high = ceil500(day.amount * spread.high!);
      } else {
        // Takvim olayının etkisi henüz bu kafenin verisiyle sınanmadı: aralık 5 puan geniş
        day.spreadPct = roughPct + (ev ? SPREAD.event : 0);
        day.low = floor500(day.amount * (1 - day.spreadPct));
        day.high = ceil500(day.amount * (1 + day.spreadPct));
      }
      const ratio = normalDay > 0 ? day.amount / normalDay : 1;
      day.level = ratio >= BUSY.high - 1e-9 ? "yuksek" : ratio <= BUSY.low + 1e-9 ? "dusuk" : "normal";
    }
    days.push(day);
  }

  return {
    today,
    days,
    quality,
    missingWeekdays: own.map((b, w) => (b ? -1 : w)).filter((w) => w >= 0),
    normalDay,
    reports,
    shares: full.map((b, weekday) => (own[weekday] ? { weekday, value: b.amount / normalDay, own: true } : { weekday, value: DEFAULT_WEEKDAY[weekday], own: false })),
    level,
    bases: full,
    trend,
    spread,
  };
}

/** Günün kayıtlı tahmininin ayrıntısı */
export function snapshotDetail(f: Forecast, d: ForecastDay): SnapshotDetail {
  return {
    v: MODEL_VERSION,
    quality: f.quality,
    base: { amount: Math.round(d.base.amount), source: d.base.source, n: d.base.n },
    factors: d.factors.map((x) => ({ key: x.key, value: Math.round(x.value * 1000) / 1000 })),
    weather: d.weather?.kind ?? null,
  };
}
